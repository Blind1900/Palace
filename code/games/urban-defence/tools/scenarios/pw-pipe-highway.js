// N162 (the user's, 2026-11-27): one pipe design for every resource, its lane's colour the sign of
// what it carries. A branch carries one resource and shows as one lane; the main is the highway,
// two lanes or three along its length by which branches have merged in - a resource's lane open
// over the stretch its sources and its takers span, painted shut beyond (the bore inside is the
// same open channel as ever). Packets only ever travel open lanes. (pixel-world, det=1)
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world } = pwApp;
const P = world.pipes, LANES = PW.PIPE_LANES;
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
// (what the eye sees there: a cased cell's own paint; an open lane's back wall; a pipe fixed to a
// tunnel's wall its pipe layer)
const paintAt = (x, y) => ((PW.get(world, x, y) & 63) === PW.M.PIPE ? PW.getLayer(world, 'paint', x, y)
  : PW.getLayer(world, 'pipe', x, y) || PW.getLayer(world, 'back', x, y));
const hue = (c) => { const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255; return [r, g, b]; };
// (a lane cell's colour reads as its lane's channel: the strongest of its three channels matches)
const reads = (c, lane) => { const [r, g, b] = hue(c), [cr, cg, cb] = lane.channel; const k = [cr, cg, cb].indexOf(Math.max(cr, cg, cb)); return [r, g, b][k] === Math.max(r, g, b) && Math.max(r, g, b) > 40; };
const dull = (c) => { const [r, g, b] = hue(c); return Math.max(r, g, b) - Math.min(r, g, b) < 24; };
for (let k = 0; k < 120; k += 1) pwApp.stepWorld(60);

// 1. The main: each lane open only over its own span.
let shown = { 1: 0, 2: 0, 3: 0 }, wrong = [];
for (const line of P.lines) {
  const spans = line.lanes || {};
  for (let x = line.x0 + 30; x <= line.x1 - 30; x += 23) {
    const k = x - line.x0, y = line.ys[k];
    // (a fitting at a level change and a core's pass-through keep their own lane hardware)
    if (line.ys[k - 1] !== y || line.ys[k + 1] !== y || line.cores.some((c) => Math.abs(c.x - x) <= 12)) continue;
    let open = 0;
    for (const lane of LANES) {
      const sp = spans[lane.resource], on = !!sp && x >= sp[0] && x <= sp[1];
      const c = paintAt(x, y + lane.row);
      if (!c) continue;
      if (on) open += 1;
      if (on ? !reads(c, lane) && !dull(c) : !dull(c)) wrong.push(`${line.side} ${x} ${lane.resource} ${on ? 'open' : 'shut'}`);
    }
    if (open) shown[open] = (shown[open] || 0) + 1;
  }
}
info(`the main's columns by lanes open: ${JSON.stringify(shown)}; spans ${P.lines.map((l) => `${l.side} ${l.x0}..${l.x1} ${JSON.stringify(l.lanes)}`).join(' | ')}`);
check(wrong.length <= 3, `each lane is painted open only over the stretch its sources and takers span, shut beyond (${wrong.length} cells read otherwise${wrong.length ? `: ${wrong.slice(0, 4).join(', ')}` : ''})`);
check(Object.keys(shown).some((k) => Number(k) < 3 && shown[k] > 0), `the main narrows where a resource has no more takers (columns with fewer than three lanes open: ${(shown[1] || 0) + (shown[2] || 0)})`);
// 2. A branch: one resource, one lane in its colour.
const branches = P.lines.flatMap((l) => l.risers.filter((r) => r.flow === 'out' && r.resource));
const share = (r) => {
  const lane = LANES.find((l) => l.resource === r.resource);
  let hit = 0, n = 0;
  // (clear of the tee's band at the main, where the valve and the socket are hardware, not lane)
  for (let y = r.y0 + 2; y <= r.y1 - 2; y += 3) {
    if (y >= r.tTop && y <= r.tBot) continue;
    for (const row of [1, 3, 5]) { const c = paintAt(r.x - 3 + row, y); if (!c) continue; n += 1; if (reads(c, lane)) hit += 1; }
  }
  return n ? hit / n : 1;
};
const oneLane = branches.filter((r) => share(r) >= 0.8);
check(branches.length > 0 && oneLane.length === branches.length, `every branch shows one lane in its resource's colour (${oneLane.length}/${branches.length}: ${branches.map((r) => `${r.resource}@${r.x} ${Math.round(share(r) * 100)}%`).join(', ')})`);
// 3. Cargo only in open lanes.
let stray = 0, seen = 0;
for (const line of P.lines) for (const p of line.packets) {
  if (p.done || p.stage !== 1) continue;
  seen += 1;
  const sp = (line.lanes || {})[p.resource];
  if (sp && (p.x < sp[0] - 2 || p.x > sp[1] + 2)) stray += 1;
}
check(stray === 0, `cargo travels only its open lanes (${seen} packets on the main, ${stray} outside their lane's span)`);
const b0 = branches[0];
if (b0) await view('n162-branch-lane', b0.x, (b0.y0 + b0.y1) / 2, 5);
const l0 = P.lines[0];
if (l0 && l0.lanes) {
  const edge = Object.values(l0.lanes).filter(Boolean).map((s) => s[1]).sort((a, b) => a - b)[0];
  if (edge) await view('n162-main-narrows', edge, l0.ys[Math.max(0, Math.min(l0.ys.length - 1, edge - l0.x0))], 5);
}
return { checks, shots };
