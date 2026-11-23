// N100 suite (det=1): the mountain a rebuilt building left. A tower whose ground floor is blown
// comes down in a heap; its cores re-found it on the heap's top (N87). Then, the user's four:
// 1. the crews do not start while the wreck is still falling - only once it has come to rest;
// 2. they take the heap into the rebuild, two of its cells for each one built;
// 3. as the heap is used up the building comes down with it, to the ground it first stood on;
// 4. no mound of made ground is left behind it (what is left of the heap is rubble, and PS's
//    weathering turns it to dirt - pw-weather).
const { world } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const id = (x, y) => PW.get(world, x, y) & 63;
const repair = world.repair;
const towers = (side) => world.buildings.filter((b) => b.type === 'population' && b.side === side && !b.ruined
  && (b.cores || []).some((c) => c.vault && !c.orb) && !(b.cores || []).some((c) => c.orb));
const A = towers('left').sort((a, b) => (a.ground - a.body.top) - (b.ground - b.body.top)).pop();
const home = A.ground, mid = Math.round((A.body.left + A.body.right) / 2);
const fx0 = A.body.left - 96, fx1 = A.body.right + 96;
const HEAP = new Set([M.DEBRIS, M.RUBBLE, M.RUIN, M.FILL]);
// (the heap: unowned wreck lying over the ground the tower stood on, across its lot - with the
// mound the re-found packed of it, made ground)
const count = (ids) => {
  let n = 0;
  for (let x = fx0; x <= fx1; x += 1) for (let y = home - 500; y < home - 2; y += 1) if (ids.has(id(x, y)) && !PW.getOwner(world, x, y)) n += 1;
  return n;
};
const fill0 = count(new Set([M.FILL]));
await view('n100-0-before', mid, home - 120, 4);
const stats0 = { eaten: repair.stats.eaten || 0, fromHeap: repair.stats.fromHeap || 0 };
for (let x = A.body.left + 6; x <= A.body.right - 6; x += 14) pwApp.explode(x, A.ground - 16, 14, 1.3);

// (anything still coming down over the lot, looked at three times a second: a piece of it in the
// air, the heap's surface across the lot shifting - and a look of the ground's own pending)
let tops0 = null;
const look = () => {
  const x0 = A.body.left - 96, x1 = A.body.right + 96, y0 = Math.min(A.body.top, home - 200) - 40, y1 = Math.max(A.ground, home) + 120;
  let piece = false;
  for (const p of (world.fragments ? world.fragments.list : [])) {
    const cs = Math.cos(p.angle), sn = Math.sin(p.angle), cx = p.px + p.gx * cs - p.gy * sn, cy = p.py + p.gx * sn + p.gy * cs;
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) { piece = true; break; }
  }
  const tops = [];
  for (let x = x0; x <= x1; x += 3) tops.push(world.groundTop[x]);
  const moved = tops0 && tops0.length === tops.length ? tops.filter((y, i) => Math.abs(y - tops0[i]) > 2).length : Infinity;
  tops0 = tops;
  const settling = !!(world.stability && world.stability.settling && world.stability.settling(x0, y0, x1, y1));
  return { piece, steady: moved <= Math.max(2, tops.length * 0.05), settling };
};
let quietLooks = 0, steadyLooks = 0;
let job = null, built = 0, firstBuild = -1, restAt = -1, refoundT = -1, groundRef = null, heap0 = 0, healthRef = 0, midShot = false, doneT = -1, builtFalling = 0;
const LIMIT = 60 * 280;
for (let t = 0; t < LIMIT; t += 1) {
  pwApp.stepWorld(1);
  const j = repair.jobs.get(A.id);
  if (j !== job) { job = j; built = j ? j.built || 0 : 0; }
  const now = j ? j.built || 0 : 0;
  if (now > built && firstBuild < 0) firstBuild = t;
  // (cells built for it while the tower is still coming down, before its balls even re-found it)
  if (now > built && refoundT < 0 && !A.refounded) builtFalling += now - built;
  built = now;
  if (restAt < 0 && t % 20 === 0) {
    const l = look();
    quietLooks = l.steady && !l.piece && !l.settling ? quietLooks + 1 : 0;
    steadyLooks = l.steady && !l.piece ? steadyLooks + 1 : 0;
    if (quietLooks >= 3 || steadyLooks >= 12) restAt = t;
  }
  if (A.refounded && refoundT < 0) {
    refoundT = t; groundRef = A.ground; heap0 = count(HEAP); healthRef = A.health || 0;
    await view('n100-1-refounded-on-heap', mid, home - 120, 4);
  }
  if (refoundT >= 0 && !midShot && A.ground >= groundRef + (home - groundRef) / 2 && home - groundRef > 8) {
    midShot = true;
    await view('n100-2-coming-down', mid, home - 120, 4);
  }
  if (refoundT >= 0 && !j && t - refoundT > 300) { doneT = t; break; }
}
info(`tower #${A.id} ground ${home} -> re-founded at ${groundRef} -> ${A.ground} (sunk ${A.sunk || 0}); heap at the re-found ${heap0} cells; wreck at rest at ${restAt}, first cell rebuilt at ${firstBuild}, re-found at ${refoundT}, work done at ${doneT}`);
check(refoundT >= 0 && groundRef < home - 8, `the tower came down in a heap and was re-founded on top of it (ground ${home} -> ${groundRef})`);
// 1. no rebuilding before rest
check(builtFalling === 0, `1 - nothing is rebuilt while the tower is still coming down (${builtFalling} cells)`);
check(firstBuild >= 0 && restAt >= 0 && firstBuild >= restAt - 20, `1 - the crews start only once the wreck has come to rest (still from tick ${restAt}, first cell at ${firstBuild})`);
// 2. two for one
const eaten = (repair.stats.eaten || 0) - stats0.eaten, fromHeap = (repair.stats.fromHeap || 0) - stats0.fromHeap;
check(fromHeap > 200 && eaten >= 2 * fromHeap - 2 && eaten <= 2 * fromHeap + 4000, `2 - the heap goes into the rebuild two cells to one (${eaten} heap cells taken, ${fromHeap} cells built from them)`);
// 3. the building comes down with its heap, to the ground it first stood on
if (Math.abs(A.ground - home) > 3) {
  // (what holds it up: the first cells under its foot where the descent stopped)
  const j = repair.jobs.get(A.id), held = [];
  const foot = (lx) => { for (let y = Math.min(world.height - 3, A.oy + A.canvas.height); y >= A.oy; y -= 1) if (PW.getOwner(world, A.ox + lx, y) === A.id) return y; return -1; };
  for (let lx = 0; lx < A.canvas.width && held.length < 8; lx += 1) {
    const f = foot(lx);
    if (f < 0) continue;
    const x = A.ox + lx, under = [];
    for (let y = f + 1; y <= f + 3; y += 1) under.push(`${PW.mat.names[id(x, y)]}${PW.getOwner(world, x, y) ? `/o${PW.getOwner(world, x, y)}` : ''}${PW.getFlags(world, x, y) & PW.FLAG.TUNNEL ? '/T' : ''}`);
    if (under.some((s) => !/^(air|rubble|debris|made ground|pipe|dust|smoke|ruin|loose)/.test(s) || /\/o|\/T/.test(s))) held.push(`x${x} foot ${f}: ${under.join(' ')}`);
  }
  const cores = (A.cores || []).map((q) => `${q.free ? 'free ' : ''}${q.settled ? 'settled ' : ''}${q.lost ? 'lost ' : ''}${q.dead ? 'dead ' : ''}y${q.y}/${q.homeY}`).join(', ');
  info(`held up by: ${held.join(' | ') || '(nothing found)'}; job ${j ? `credit ${j.heapCredit} calm ${j.calm} q ${j.queue.length} parked ${!!j.parked} sinkAt ${j.sinkAt} tick ${world.tick}` : 'none'}; cores ${cores}`);
}
check(Math.abs(A.ground - home) <= 3, `3 - the building came down with the heap to where it first stood (ground ${A.ground}, first ${home})`);
const heap1 = count(HEAP);
check(heap1 <= heap0 * 0.3, `3 - the heap under and round it is used up (${heap0} -> ${heap1} cells of wreck and mound over the old ground line)`);
// (and it stands on what it came down onto - no gap left under the bed)
let seams = 0, cols = 0;
for (let x = A.body.left; x <= A.body.right; x += 3) {
  let low = -1;
  for (let y = A.ground + 80; y >= A.ground - 4; y -= 1) if (PW.getOwner(world, x, y) === A.id) { low = y; break; }
  if (low < 0) continue;
  cols += 1;
  const fl = PW.getFlags(world, x, low + 1);
  if (PW.mat.phase[id(x, low + 1)] <= PW.PHASE.GAS && !(fl & PW.FLAG.HOLLOW) && !(fl & PW.FLAG.TUNNEL)) { seams += 1; if (seams <= 4) info(`seam at x${x} under ${low}: ${[1, 2, 3, 4, 5, 6].map((d) => PW.mat.names[id(x, low + d)]).join(' ')}`); }
}
check(cols > 5 && seams === 0, `3 - the footing bears on the ground under it, no air seam (${seams} of ${cols} columns)`);
// 4. no hill of made ground
const fill1 = count(new Set([M.FILL]));
{
  const zones = {};
  for (let x = fx0; x <= fx1; x += 1) for (let y = home - 500; y < home - 2; y += 1) {
    if (id(x, y) !== M.FILL || PW.getOwner(world, x, y)) continue;
    const lx = x - A.ox, z = lx < 0 ? 'left of canvas' : lx >= A.canvas.width ? 'right of canvas' : x < A.body.left || x > A.body.right ? 'canvas margin' : 'under body';
    const k = `${z} rows ${Math.floor((home - y) / 10) * 10}+`;
    zones[k] = (zones[k] || 0) + 1;
  }
  info(`fill left: ${Object.entries(zones).map(([k, n]) => `${k}: ${n}`).join(', ')}`);
}
check(fill1 - fill0 <= 300, `4 - no mound of made ground left on the lot (${fill0} -> ${fill1} cells of fill over the old ground line)`);
// (the heap pays for half of what it was; the rest of the tower is the side's HM - the work goes on)
check(A.health > healthRef + 0.04, `the crews raise the tower again from its old ground (health ${healthRef.toFixed(2)} at the re-found -> ${A.health.toFixed(2)})`);
await view('n100-3-rebuilt-home', mid, home - 120, 4);
return { checks, shots };
