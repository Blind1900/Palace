// Made ground transitions (run with --page=pixel-world.html --params=seed=N): a town's made ground
// runs in unbroken layers under its streets and buildings, and where the town ends its layers do
// not stop at a cut but fray out into the natural ground, each band to its own reach, smoothly (in
// lenses, never speckled), the way strata pinch out.
const { world } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const MADE = new Set([M.FILL, M.SLAB, M.COURSE]);
const madeAt = (x, y) => MADE.has(PW.get(world, x, y) & 63) && !PW.getOwner(world, x, y);
// (pipe beds and warning tapes are made ground too, but they are the lines', not the town's layers)
const tone = (c, k) => PW.abgr(Math.min(255, c[0] * k) | 0, Math.min(255, c[1] * k) | 0, Math.min(255, c[2] * k) | 0);
const lineGround = new Set([tone([170, 156, 118], 1), tone([170, 156, 118], 0.88), ...PW.PIPE_LINES.map((l) => tone(l.tape, 0.72))]);
const layerAt = (x, y) => madeAt(x, y) && !lineGround.has(PW.getLayer(world, 'paint', x, y));

for (const s of world.settlements) {
  const m = s.madeGround;
  const tag = `${s.side}@${s.site.x0} (${s.style})`;
  // 1. Unbroken layers: neighbouring columns carry the same layer in the same row.
  let pairs = 0, aligned = 0;
  for (let x = s.streetLeft + 4; x < s.streetRight - 4; x += 5) {
    if (m.ends.some((e) => Math.abs(e - x) < PW.urban.faceAt(100) + 4)) continue;
    const g = world.groundTop[x];
    let both = 0, same = 0;
    for (let y = g + 6; y < g + 96; y += 1) {
      if (!layerAt(x, y) || !layerAt(x + 1, y)) continue;
      both += 1;
      if ((PW.get(world, x, y) & 63) === (PW.get(world, x + 1, y) & 63)) same += 1;
    }
    if (both < 30) continue;
    pairs += 1;
    if (same >= both * 0.9) aligned += 1;
  }
  check(pairs >= 20 && aligned >= pairs * 0.8, `${tag}: the layers run on unbroken from column to column (${aligned}/${pairs} neighbouring columns line up)`);

  // 2. The ends fray out: every band runs past the end to its own reach, and the fraying is smooth.
  let reachMax = 0, varied = 0, isolated = 0, frayed = 0, judged = 0;
  const spreads = [];
  // (town ground: the streets and runway, less the farms' fields)
  const runway = s.runway ? [Math.min(s.runway.from, s.runway.to), Math.max(s.runway.from, s.runway.to)] : null;
  const inside = (x) => ((x >= s.streetLeft && x <= s.streetRight) || (runway && x >= runway[0] && x <= runway[1]))
    && !s.buildings.some((b) => [b.field, b.lotField].some((f) => f && x >= f.x0 && x <= f.x1));
  for (const end of m.ends) {
    // Which way is out of the town; and how far out until town ground again (a field between two
    // stretches of street).
    const out = inside(end - 1) ? 1 : -1;
    let span = 1;
    while (span < 240 && !inside(end + out * span)) span += 1;
    if (span < 120) continue;
    const g = world.groundTop[end - out * 4];
    const reaches = [];
    for (let d = 8; d < 90; d += 1) {
      let reach = 0;
      for (let t = 1; t < span; t += 1) if (layerAt(end + out * t, g + d)) reach = t;
      reaches.push(reach);
    }
    judged += 1;
    reachMax = Math.max(reachMax, Math.max(...reaches));
    const spread = Math.max(...reaches) - Math.min(...reaches);
    spreads.push(spread);
    if (spread >= 20) varied += 1;
    for (let t = 1; t < span; t += 1) for (let d = 8; d < 120; d += 1) {
      const x = end + out * t, y = g + d;
      if (!layerAt(x, y)) continue;
      frayed += 1;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => layerAt(x + dx, y + dy)).length;
      if (n === 0) isolated += 1;
    }
  }
  check(judged > 0 && reachMax >= 40 && varied >= judged * 0.8, `${tag}: past each end the layers carry on into the natural ground, each band to its own reach (furthest ${reachMax} cells; bands' reaches differ by ${spreads.join(', ')} at ${judged} ends)`);
  check(frayed > 200 && isolated <= frayed * 0.02, `${tag}: the fraying is smooth, no speckle (${isolated} lone cells of ${frayed} frayed)`);
  for (const end of m.ends.slice(0, 2)) await view(`mg-${s.side}-${s.style}-${end}`, end, world.groundTop[end] + 50, 5);
}

// 3. The asian made ground has the Forbidden City's layers: stone slabs, brick courses, rammed
// earth, a granite foundation, cypress piles.
const asian = world.settlements.find((s) => s.style === 'asian');
if (asian) {
  const x0 = Math.round((asian.streetLeft * 2 + asian.streetRight) / 3);
  let best = null;
  for (let x = x0; x < x0 + 200; x += 1) {
    const g = world.groundTop[x];
    if (!(PW.getFlags(world, x, g) & PW.FLAG.ROAD)) continue;
    const paints = new Set(), ids = new Set();
    let granite = 0;
    for (let y = g + 4; y < g + 100; y += 1) {
      if (!layerAt(x, y)) continue;
      paints.add(PW.getLayer(world, 'paint', x, y)); ids.add(PW.get(world, x, y) & 63);
      if ((PW.get(world, x, y) & 63) === M.SLAB && y - g > 20) granite += 1;      // (below the paving slabs)
    }
    if (!best || paints.size > best.paints) best = { x, paints: paints.size, ids: ids.size, granite };
  }
  // (a cypress pile: a column of brown timber, crossed by the supply lines on its way down)
  let pile = 0;
  for (let x = x0; x < x0 + 200 && !pile; x += 1) {
    const g = world.groundTop[x];
    let rows = 0;
    for (let y = g + 30; y < g + 140; y += 1) {
      if ((PW.get(world, x, y) & 63) !== M.COURSE || !layerAt(x, y)) continue;
      const c = PW.unpack(PW.getLayer(world, 'paint', x, y));
      if (c[0] - c[2] > 50 && c[0] > 70 && c[1] < c[0] * 0.75) rows += 1;
    }
    if (rows >= 8) pile = x;
  }
  check(best && best.paints >= 30 && best.ids === 3 && best.granite > 0 && pile > 0,
    `the asian made ground is layered like the Forbidden City's (${best ? `${best.paints} tones, ${best.ids} materials, granite ${best.granite} rows` : 'no street'}, cypress pile ${pile ? `at ${pile}` : 'none'})`);
  await view('mg-asian-section', x0 + 60, world.groundTop[x0 + 60] + 45, 7);
}
return { checks, shots: shots.length };
