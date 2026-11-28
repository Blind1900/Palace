// N161 (the user's, 2026-11-27): a pipe joining the main pipe never joins it near a core, nor over
// one - a branch whose tee would fall by a core runs along at its own depth to a clear column first.
// Checked as the world is made and again after the towns have grown a while. (pixel-world, det=1)
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world } = pwApp;
const M = PW.M, CLEAR = 60;
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const audit = (when) => {
  const bad = [], fed = [];
  let tees = 0;
  for (const line of world.pipes.lines) {
    for (const r of line.risers) {
      if (r.kind === 'core') continue;
      tees += 1;
      if (r.fedFrom !== undefined) fed.push(r);
      const near = line.cores.reduce((d, c) => Math.min(d, Math.abs(c.x - r.x)), Infinity);
      // (and no core's cell inside the riser's own casing)
      let over = 0;
      for (let y = r.y0; y <= r.y1; y += 1) for (let dx = -4; dx <= 4; dx += 1) if ((PW.get(world, r.x + dx, y) & 63) === M.CORE) over += 1;
      if (near < CLEAR || over) bad.push({ x: r.x, kind: r.kind, near, over });
    }
  }
  check(tees > 0 && bad.length === 0, `${when}: no branch joins the main within ${CLEAR} of a core or over one (${tees} tees, ${fed.length} run along to a clear column${bad.length ? `; ${bad.slice(0, 4).map((b) => `${b.kind} at ${b.x}: ${b.near} from a core${b.over ? `, ${b.over} core cells under it` : ''}`).join('; ')}` : ''})`);
  // (and each run along is a real pipe, from the branch's own column to the tee's - cased in the
  // ground, or fixed to the wall where it crosses a tunnel's open space, as the main is)
  const runs = fed.map((r) => {
    let pipe = 0, n = 0;
    for (let x = Math.min(r.x, r.fedFrom); x <= Math.max(r.x, r.fedFrom); x += 1) {
      n += 1;
      if ((PW.get(world, x, r.anchorY) & 63) === M.PIPE || PW.getLayer(world, 'pipe', x, r.anchorY)) pipe += 1;
    }
    return { r, share: n ? pipe / n : 1 };
  });
  if (runs.length) check(runs.every((q) => q.share >= 0.9), `${when}: each run along is pipe all the way (${runs.map((q) => `${q.r.kind} ${q.r.fedFrom}->${q.r.x} ${Math.round(q.share * 100)}%`).join(', ')})`);
  return fed;
};
const fed0 = audit('as the world is made');
if (fed0[0]) await view('n161-tee-run-along', (fed0[0].x + fed0[0].fedFrom) / 2, fed0[0].anchorY, 5);
for (let k = 0; k < 300; k += 1) pwApp.stepWorld(60);
info(`after ${Math.round((world.tick || 0) / 60)} s: ${world.pipes.lines.map((l) => `${l.side} ${l.x0}..${l.x1}: ${l.cores.length} cores, ${l.risers.filter((r) => r.kind !== 'core').length} tees`).join(' | ')}`);
const fed1 = audit('after five minutes of growth');
if (fed1[0]) await view('n161-tee-run-along-grown', (fed1[0].x + fed1[0].fedFrom) / 2, Math.min(fed1[0].anchorY, fed1[0].y0) + 20, 5);
return { checks, shots };
