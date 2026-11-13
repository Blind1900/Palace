// M1 settlements check (run with --page=pixel-world.html --params=seed=N).
const { world } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const settle = async (ms = 1200) => { for (let t = 0; t < ms; t += 100) await sleep(100); };
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); await settle(); shots.push(await shot(name)); };

const settlements = world.settlements || [];
check(settlements.length === 5, `5 settlements (got ${settlements.length})`);
const styles = world.styles || {};
check(new Set([styles.left, styles.right, styles.neutral]).size === 3, `three distinct styles ${JSON.stringify(styles)}`);
for (const s of settlements) {
  const list = s.buildings.slice().sort((a, b) => a.body.left - b.body.left);
  let overlap = 0;
  for (let i = 1; i < list.length; i += 1) if (list[i].body.left <= list[i - 1].body.right) overlap += 1;
  check(overlap === 0, `${s.side}@${s.site.x0}: no overlapping building bodies (${list.length} buildings)`);
  let floating = 0;
  for (const b of list) {
    if (b.type === 'core') continue;
    const shaftX = b.workings ? b.workings.x : null;   // a mine's shaft mouth is meant to be open
    for (let x = b.body.left + 4; x <= b.body.right - 4; x += 6) {
      if (shaftX !== null && Math.abs(x - shaftX) <= 20) continue;
      const id = PW.get(world, x, b.ground) & 63;
      if (!PW.mat.ground[id] && !PW.mat.structural[id]) floating += 1;
    }
  }
  check(floating === 0, `${s.side}@${s.site.x0}: ground under every building (${floating} open columns)`);
  check(list.every((b) => b.style === s.style), `${s.side}: buildings share the ${s.style} style`);
}
// Starter shafts reach ore through open tunnel.
for (const s of settlements.filter((item) => item.core)) {
  const shaft = s.core.mine.shaft;
  const W = world.width;
  const seen = new Uint8Array(1 << 22);
  const key = (x, y) => ((y - shaft.top + 64) & 2047) * 2048 + ((x - shaft.x + 1024) & 2047);
  const queue = [[shaft.x, shaft.top + 2]];
  let found = false;
  for (let q = 0; q < queue.length && q < 400000 && !found; q += 1) {
    const [x, y] = queue[q];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      const id = world.mat[ny * W + nx] & 63;
      if (id === M.ORE) { found = true; break; }
      if (id !== M.AIR) continue;
      const k = key(nx, ny);
      if (seen[k]) continue;
      seen[k] = 1;
      queue.push([nx, ny]);
    }
  }
  check(found, `${s.side} starter shaft reaches ore`);
  check(Boolean(s.runway), `${s.side} has a runway`);
  const devices = s.buildings.flatMap((b) => b.devices);
  const want = s.side === 'left' ? 1 : -1;
  check(devices.length > 0 && devices.every((d) => d.facing === want), `${s.side} defences face the enemy (${devices.length} devices)`);
}
const neutralDevices = settlements.filter((s) => s.side === 'neutral').flatMap((s) => s.buildings.flatMap((b) => b.devices));
check(new Set(neutralDevices.map((d) => d.facing)).size === 2, `neutral defences face both ways (${neutralDevices.length})`);

// Screenshots.
for (const s of settlements) {
  const mid = (s.streetLeft + s.streetRight) / 2;
  await view(`set-${s.side}-${s.site.x0}`, mid, s.padY - 200, 3);
}
const left = settlements.find((s) => s.side === 'left');
for (const [index, b] of left.buildings.entries()) await view(`set-left-${index}-${b.type}`, (b.body.left + b.body.right) / 2, b.ground - 150, 5);
await view('set-left-mine', left.core.mine.drift.x0 + 100, left.core.mine.drift.top, 5);
const neutral = settlements.find((s) => s.side === 'neutral');
await view('set-neutral-close', (neutral.streetLeft + neutral.streetRight) / 2, neutral.padY - 160, 5);
return { checks, districts: (world.districts || []).map((d) => `${d.gap}: ${d.props.join(', ')}`), shots: shots.length,
  timings: pwApp.timings };
