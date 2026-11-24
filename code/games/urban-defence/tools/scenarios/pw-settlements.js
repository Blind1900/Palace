// M1 settlements check (run with --page=pixel-world.html --params=seed=N).
const { world } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const settle = async (ms = 1200) => { for (let t = 0; t < ms; t += 100) await sleep(100); };
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); await settle(); shots.push(await shot(name)); };

const settlements = world.settlements || [];
// (N124: the middle town gave the centre to the map's great mountain or lake - two bases, two towns)
check(settlements.length === 4, `4 settlements (got ${settlements.length})`);
// N124 (the user's): open country at both ends - no mountain within 22% of either end - and the
// centre the map's great barrier, a larger mountain than any other or a wide lake; a lake near
// each end.
{
  const L = pwApp.layout, W = world.width, [fl, fr] = L.flatEnd;
  const intrude = L.mountains.filter((m) => m.x - m.half < fl || m.x + m.half > fr);
  check(Math.abs(fl - W * 0.22) < 2 && intrude.length === 0, `no mountain within 22% of either end (${fl} and ${W - fr} cells of open country; ${intrude.length} intruding)`);
  let flatL = 0, flatR = 0;
  for (let x = 80; x < fl; x += 16) if (Math.abs(world.groundTop[x] - world.groundTop[x - 16]) <= 12) flatL += 1;
  for (let x = W - 80; x > fr; x -= 16) if (Math.abs(world.groundTop[x] - world.groundTop[x + 16]) <= 12) flatR += 1;
  const nL = Math.floor((fl - 80) / 16), nR = Math.floor((W - 80 - fr) / 16);
  check(flatL > nL * 0.85 && flatR > nR * 0.85, `and it is flat: ${Math.round(flatL / nL * 100)}% / ${Math.round(flatR / nR * 100)}% of its 16-cell steps rise 12 or less`);
  const c = L.centre;
  const tallest = Math.max(...L.mountains.filter((m) => !m.centre).map((m) => m.height), 0);
  check(!!c && Math.abs(c.x - W / 2) < W * 0.04 && (c.kind === 'lake' ? c.half >= 800 : c.height > tallest),
    `the centre is the great barrier: a ${c ? c.kind : 'nothing'} at ${c ? c.x : '-'} (${c && c.kind === 'mountain' ? `${Math.round(c.height)} high, the next tallest ${Math.round(tallest)}` : c ? `${Math.round(c.half * 2)} wide` : ''})`);
  // N133 (the user's): one or two high mountains; three lakes at most (the ends', and the centre's
  // if it is a lake); every slope one a tank can climb (43 degrees), the land's own profile
  // measured over 8 columns at a time, lakes' bowls aside
  const lakes = L.lakes.filter((l) => !l.river);
  check(L.mountains.length >= 1 && L.mountains.length <= 2 && lakes.length <= 3 && !L.lakes.some((l) => l.river),
    `${L.mountains.length} high mountain(s), ${lakes.length} lakes, no rivers (${L.hills.length} ranges worn to hills)`);
  const S = L.surface, wetAt = (x) => L.lakes.some((l) => Math.abs(x - l.x) < l.half * 1.3);
  let steep = 0, worst = 0, at = 0;
  for (let x = 8; x < W; x += 4) {
    if (wetAt(x) || wetAt(x - 8)) continue;
    const g = Math.abs(S[x] - S[x - 8]) / 8;
    if (g > worst) { worst = g; at = x; }
    if (g > Math.tan(43 * Math.PI / 180)) steep += 1;
  }
  check(steep === 0, `no slope steeper than a tank climbs (steepest ${Math.round(Math.atan(worst) * 180 / Math.PI)} degrees, at ${at})`);
  const ends = L.lakes.filter((l) => l.pond);
  const wet = (l) => { let n = 0; for (let x = Math.round(l.x - l.half); x <= l.x + l.half; x += 4) { const y = world.groundTop[x]; for (let k = -6; k < 4; k += 1) if ((PW.get(world, x, y + k) & 63) === PW.M.WATER) { n += 1; break; } } return n; };
  check(ends.length === 2 && ends.every((l) => wet(l) > 20) && ends[0].x < W * 0.05 && ends[1].x > W * 0.95, `a lake near each end (${ends.map((l) => `at ${Math.round(l.x)}, ${wet(l)} wet columns`).join('; ')})`);
}
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
