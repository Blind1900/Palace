// N83/N84 suite (run with det=1): the resource lanes inside every supply pipe are continuous, as
// the outer shell must be - generation never cuts them - and the shell wears its armoured jacket.
//  1. Every run column: each lane row is an open channel of its line - carved (open, HOLLOW,
//     the line's own), a sleeve (paint through works the line may cross) or wall-face paint.
//     Solid PIPE or anyone's material in a lane row is a CUT (a riser laid over the trunk, a
//     neighbour's works, a filler, a fitting re-laid over the run).
//  2. Every bend and level change (a step of more than one row) has a fitting, and each lane,
//     flood-filled through cells of ITS OWN colour only, reaches its own slot on the run beyond
//     - no dead end, no lane swapped into another's channel.
//  3. Both hold at generation and after a minute of the living world (heals, re-threads).
//  4. N84: the cased runs in the ground wear the jacket ring above and below the casing.
const { world, pipes } = pwApp;
const { M, FLAG } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const id = (x, y) => PW.get(world, x, y) & 63;
const BORE = pipes.BORE, HOP = 11;
const NAME = Object.fromEntries(Object.entries(M).map(([k, v]) => [v, k]));
const W = world.width;
const fittings = (line) => [...(line.wells || []), ...(line.joints || [])];
const inFitting = (line, x, y) => fittings(line).some((w) => w.cells.has(y * W + x));
const unpack = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];   // abgr
// A lane colour is saturated; greys (casing, jacket, divider) and ink are not lanes.
const laneOf = (c) => {
  const [r, g, b] = c;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return Math.max(r, g, b) < 34 ? 'ink' : 'body';
  if (g > r && g > b) return 'sm';
  if (b > g && r > g) return 'hm';
  if (b >= g && g > r) return 'water';
  return 'body';
};
const RES = { 1: 'hm', 3: 'sm', 5: 'water' };
const carvedOwn = (line, x, y) => {
  const i = id(x, y);
  return (PW.mat.open[i] || i === M.WATER) && (PW.getFlags(world, x, y) & FLAG.HOLLOW) && PW.getOwner(world, x, y) === line.owner;
};
const laneForm = (line, x, y) => {
  if (carvedOwn(line, x, y)) return 'carved';
  if ((PW.getFlags(world, x, y) & FLAG.FIXTURE) && PW.getLayer(world, 'paint', x, y) && id(x, y) !== M.PIPE) return 'sleeve';
  if (PW.getLayer(world, 'pipe', x, y) && id(x, y) !== M.PIPE) return 'wallface';
  return null;
};
// The lane a cell carries: a carved channel by its back wall (ink = a slim intake's blacked
// lane, any lane), wall-face and sleeve paint by their colour. undefined = not a channel.
const cellLane = (line, x, y) => {
  let l;
  if (carvedOwn(line, x, y)) { l = laneOf(unpack(PW.getLayer(world, 'back', x, y))); return l === 'ink' ? null : l === 'body' ? undefined : l; }
  const p = PW.getLayer(world, 'pipe', x, y);
  if (p && id(x, y) !== M.PIPE) l = laneOf(unpack(p));
  else if ((PW.getFlags(world, x, y) & FLAG.FIXTURE) && PW.getLayer(world, 'paint', x, y) && id(x, y) !== M.PIPE) l = laneOf(unpack(PW.getLayer(world, 'paint', x, y)));
  return l && l !== 'ink' && l !== 'body' ? l : undefined;
};

let firstCut = null;
function scan(tag) {
  const cuts = [];
  let cols = 0;
  for (const line of pipes.lines) {
    for (let k = 4; k < line.ys.length - 4; k += 1) {
      const x = line.x0 + k;
      if (line.broken[k]) continue;
      if (line.cores.some((c) => Math.abs(x - c.x) <= HOP - 1)) continue;   // (carried inside the bed)
      if ((line.wells || []).some((w) => x >= w.xa && x <= w.xb)) continue;   // (a shaft: part 2 judges it)
      cols += 1;
      const top = line.ys[k];
      for (const r of [1, 3, 5]) {
        if (laneForm(line, x, top + r)) continue;
        cuts.push({ line: line.id, x, y: top + r, r, what: NAME[id(x, top + r)] || id(x, top + r), own: PW.getOwner(world, x, top + r) });
      }
    }
  }
  const hist = {};
  for (const c of cuts) { const key = `${c.what}${c.own >= 60000 ? ' (line)' : c.own ? ' (building)' : ''}`; hist[key] = (hist[key] || 0) + 1; }
  checks.push(`INFO ${tag}: ${cols} run columns, ${cuts.length} cut lane cells ${JSON.stringify(hist)}`);
  for (const c of cuts.slice(0, 6)) checks.push(`INFO ${tag} cut: line#${c.line} (${c.x},${c.y}) lane ${RES[c.r]} is ${c.what}`);
  if (cuts.length && !firstCut) firstCut = cuts[0];
  return { cols, cuts: cuts.length };
}

function flood(line, sx, sy, goal, lane, x0, x1, y0, y1) {
  const seen = new Set([sy * W + sx]); const q = [[sx, sy]];
  while (q.length) {
    const [cx, cy] = q.pop();
    if (cx === goal[0] && cy === goal[1]) return true;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      const key = ny * W + nx;
      if (seen.has(key)) continue;
      const l = cellLane(line, nx, ny);
      if (l === undefined || (l !== null && l !== lane)) continue;
      seen.add(key); q.push([nx, ny]);
    }
  }
  return false;
}
function joints(tag) {
  let steps = 0, tested = 0, beds = 0, bare = 0, fails = 0;
  const seen = new Set();
  const notes = [];
  for (const line of pipes.lines) {
    const cased = (k) => {
      if (k < 0 || k >= line.ys.length || line.broken[k]) return false;
      const x = line.x0 + k, top = line.ys[k];
      if (line.cores.some((c) => Math.abs(x - c.x) <= HOP - 1)) return false;
      return [1, 3, 5].every((r) => laneForm(line, x, top + r) && !inFitting(line, x, top + r));
    };
    for (let k = 1; k < line.ys.length; k += 1) {
      if (Math.abs(line.ys[k] - line.ys[k - 1]) < 2) continue;
      steps += 1;
      const x = line.x0 + k;
      const fit = fittings(line).find((w) => k >= w.k && k <= w.kl);
      if (!fit) { bare += 1; notes.push(`bare step: line#${line.id} x${x} ${line.ys[k - 1]}->${line.ys[k]}`); continue; }
      if (seen.has(fit)) continue;
      seen.add(fit);
      let kL = fit.k - 5, kR = fit.kl + 4;
      while (kL > fit.k - 40 && !cased(kL)) kL -= 1;
      while (kR < fit.kl + 40 && !cased(kR)) kR += 1;
      if (!cased(kL) || !cased(kR)) { beds += 1; continue; }   // (between core beds: part 1 judges its runs)
      tested += 1;
      const xL = line.x0 + kL, xR = line.x0 + kR;
      for (const r of [1, 3, 5]) {
        if (flood(line, xL, line.ys[kL] + r, [xR, line.ys[kR] + r], RES[r], xL, xR, fit.y0 - 3, fit.y1 + 3)) continue;
        fails += 1;
        notes.push(`dead lane: line#${line.id} fitting x${fit.x} (${line.ys[k - 1]}->${line.ys[k]}) ${RES[r]} from x${xL} never reaches x${xR}`);
        if (!firstCut) firstCut = { x: fit.x, y: (fit.y0 + fit.y1) >> 1 };
      }
    }
  }
  checks.push(`INFO ${tag}: ${steps} level changes, ${tested} fittings flood-tested, ${beds} between core beds, ${fails} dead lane paths, ${bare} bare steps`);
  for (const n of notes.slice(0, 8)) checks.push(`INFO ${tag} ${n}`);
  return { tested, bad: fails + bare };
}

// N84: the jacket. A run column cased in the ground (both casing rows its own PIPE) wears its
// jacket ring above and below unless that cell is somebody else's (a road, a building, ore, a
// tunnel) or open air - those it may not take.
function jacket() {
  let cased = 0, worn = 0, barred = 0;
  for (const line of pipes.lines) {
    for (let k = 4; k < line.ys.length - 4; k += 1) {
      const x = line.x0 + k, top = line.ys[k];
      if (line.broken[k] || line.cores.some((c) => Math.abs(x - c.x) <= HOP + 4)) continue;
      if (fittings(line).some((w) => x >= w.xa - 1 && x <= w.xb + 1)) continue;
      const own = (y) => id(x, y) === M.PIPE && PW.getOwner(world, x, y) === line.owner;
      if (!own(top) || !own(top + BORE - 1)) continue;
      for (const y of [top - 1, top + BORE]) {
        cased += 1;
        if (own(y)) { worn += 1; continue; }
        const i = id(x, y), o = PW.getOwner(world, x, y);
        if ((o && o < 60000) || !PW.mat.terrain[i] || i === M.ORE || i === M.BEDROCK || (PW.getFlags(world, x, y) & FLAG.TUNNEL)) barred += 1;
      }
    }
  }
  return { cased, worn, barred, bare: cased - worn - barred };
}

const s0 = scan('frame0'), j0 = joints('frame0'), jk = jacket();
check(s0.cols > 20000 && s0.cuts === 0, `every run lane is an open channel at generation (${s0.cuts} cut cells in ${s0.cols} columns)`);
check(j0.tested > 5 && j0.bad === 0, `every lane passes every bend and level change at generation (${j0.bad} failures in ${j0.tested} fittings)`);
check(jk.cased > 20000 && jk.bare === 0, `the cased runs wear their armoured jacket (${jk.worn} of ${jk.cased} rows, ${jk.barred} barred by others' works, ${jk.bare} missing)`);
pwApp.stepWorld(60 * 60);
const s1 = scan('after60s'), j1 = joints('after60s');
check(s1.cuts === 0, `every run lane is still open after a minute of the living world (${s1.cuts} cut cells)`);
check(j1.bad === 0, `every lane still passes every bend and level change after a minute (${j1.bad} failures)`);
if (firstCut) {
  pwApp.focus(firstCut.x, firstCut.y, 8);
  for (let t = 0; t < 8; t += 1) await sleep(100);
  shots.push(await shot('pipe-lanes-first-cut'));
}
return { checks, shots };
