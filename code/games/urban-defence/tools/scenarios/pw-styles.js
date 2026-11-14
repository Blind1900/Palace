// Faction styling (run with --page=pixel-world.html --params=seed=N): developed tunnels, runways and
// units each take their side's style (asian, gothic, modern).
const { world } = pwApp;
const { M, FLAG } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const styles = world.styles;
const T = PW.tunnels.state(world);
const unpack = (c) => [c & 255, c >>> 8 & 255, c >>> 16 & 255];

// 1. Every network carries its side's style.
check(T.networks.length >= 4 && T.networks.every((n) => n.style === styles[n.side]),
  `tunnel networks take their side's style (${T.networks.map((n) => `${n.side}:${n.style}`).join(', ')})`);

// 2. Develop everything; each style's tunnels show their own fit-out.
PW.tunnels.advanceTo(world, T.time + 4000);
const looks = {};
const signature = {
  modern: [[84, 92, 62], [191, 123, 25]],          // olive dado, hazard stripe
  asian: [[140, 42, 34], [206, 58, 40]],           // lacquer, lantern
  gothic: [[40, 38, 48], [146, 142, 156]],         // lancet niche, rib
};
for (const net of T.networks) {
  const seen = looks[net.style] || (looks[net.style] = { cells: 0, hits: {} });
  const segs = T.segments.filter((s) => s.net === net.id && s.kind !== 'shaft');
  for (const s of segs) {
    for (let y = s.y0; y <= s.y1; y += 1) for (let x = s.x0; x <= s.x1; x += 1) {
      if (!(PW.getFlags(world, x, y) & FLAG.DEVELOPED)) continue;
      const back = PW.getLayer(world, 'back', x, y);
      if (!back) continue;
      seen.cells += 1;
      const [r, g, b] = unpack(back);
      for (const [i, sig] of signature[net.style].entries()) {
        if (Math.abs(r - sig[0]) + Math.abs(g - sig[1]) + Math.abs(b - sig[2]) < 30) seen.hits[i] = (seen.hits[i] || 0) + 1;
      }
    }
  }
}
for (const [style, seen] of Object.entries(looks)) {
  check(seen.cells > 500 && Object.keys(seen.hits).length === signature[style].length,
    `developed ${style} tunnels show the ${style} fit-out (${seen.cells} cells, signature hits ${JSON.stringify(seen.hits)})`);
}
// The lining keeps stopping other sides whatever its looks.
const lined = T.networks.map((n) => n.lined);
check(lined.every((v) => v > 0), `every network lines its rock (${lined.join(', ')} cells)`);

// 3. Runways in each base's style.
const runwayLook = {};
for (const s of world.settlements.filter((q) => q.runway)) {
  const x = Math.round((s.runway.from + s.runway.to) / 2) + 7;
  runwayLook[s.style] = PW.getLayer(world, 'paint', x, s.runway.y + 1);
}
check(new Set(Object.values(runwayLook)).size === Object.keys(runwayLook).length && Object.keys(runwayLook).length === 2,
  `the two bases' runways are paved differently (${JSON.stringify(Object.fromEntries(Object.entries(runwayLook).map(([k, v]) => [k, unpack(v)])))})`);

// 4. Troopers dressed by faction: their colours differ, and none uses the guards' lavender.
const looksOf = (style) => {
  const s = PW.unitArt.sprite('trooper', 'walk', 0, style);
  const data = s.canvas.getContext('2d').getImageData(0, 0, s.width, s.height).data;
  const colours = new Set();
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  return colours;
};
const sets = Object.fromEntries(['asian', 'gothic', 'modern'].map((s) => [s, looksOf(s)]));
const overlap = (a, b) => [...a].filter((c) => b.has(c)).length / Math.min(a.size, b.size);
check(overlap(sets.asian, sets.gothic) < 0.3 && overlap(sets.asian, sets.modern) < 0.3 && overlap(sets.gothic, sets.modern) < 0.3,
  `each faction's troopers are dressed differently (colours ${Object.values(sets).map((s) => s.size).join('/')}, overlaps ${overlap(sets.asian, sets.gothic).toFixed(2)} ${overlap(sets.asian, sets.modern).toFixed(2)} ${overlap(sets.gothic, sets.modern).toFixed(2)})`);
const lavender = [...sets.asian, ...sets.gothic, ...sets.modern].filter((c) => { const [r, g, b] = c.split(',').map(Number); return b > g + 30 && r > g + 15; });
check(lavender.length === 0, `no faction trooper wears the guards' lavender (${lavender.length} colours)`);

// Screenshots: a line-up of each faction's trooper, guard and miner in front of its own town, then
// the developed tunnels.
const left = world.settlements.find((s) => s.side === 'left');
const at = { x: Math.round((left.streetLeft + left.streetRight) / 2) + 200, y: 0 };
at.y = world.groundTop[at.x];
const order = ['asian', 'gothic', 'modern'];
PW.drawUnitsHook = (renderer) => {
  order.forEach((style, k) => {
    const x0 = at.x - 120 + k * 90;
    PW.unitArt.draw(renderer, PW.unitArt.sprite('trooper', 'walk', 0, style), x0, at.y, 1);
    PW.unitArt.draw(renderer, PW.unitArt.sprite('trooper', 'crouch', 2, style), x0 + 22, at.y, -1);
    PW.unitArt.draw(renderer, PW.unitArt.sprite('guard', 'walk', 2, style), x0 + 44, at.y, 1);
    PW.unitArt.draw(renderer, PW.unitArt.sprite('miner', 'walk', 1, style), x0 + 64, at.y, 1);
  });
};
await view('st-units', at.x - 10, at.y - 14, 8);
await view('st-units-wide', at.x - 10, at.y - 30, 6);
PW.drawUnitsHook = null;
for (const s of world.settlements) {
  const op = (world.miningOps || []).find((o) => o.side === s.side && o.riser.x > s.streetLeft - 600 && o.riser.x < s.streetRight + 600);
  if (op) await view(`st-tunnel-${s.side}-${s.style}-${s.site.x0}`, (op.room.x0 + op.room.x1) / 2, op.floor - 30, 6);
  const drift = s.core && s.core.mine && s.core.mine.drift;
  if (drift) await view(`st-drift-${s.side}-${s.style}`, (drift.x0 + drift.x1) / 2, (drift.top + drift.bottom) / 2, 5);
  if (s.runway) await view(`st-runway-${s.side}-${s.style}`, Math.round((s.runway.from + s.runway.to) / 2), s.runway.y - 20, 5);
}
return { checks, styles, shots: shots.length };
