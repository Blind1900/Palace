// N86 + N87 suite (det=1): a core rising out of its wreck climbs at least 50 cells clear of the
// rubble over it, floats, and comes back down at the speed it went up (N86) - into a NEW bed laid
// flush with the surface as it now lies (N87): the building re-founds on the rubble heap or in
// the crater, its gift set on packed ground, its bundle re-threaded, the ball its building's
// again (N80), and the crews raise the body from there. Two scenes: a tower whose ground floor
// is blown (a heap), and one blasted from below its ground line (a crater).
const { world } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const id = (x, y) => PW.get(world, x, y) & 63;
const towers = (side) => world.buildings.filter((b) => b.type === 'population' && b.side === side && !b.ruined
  && (b.cores || []).some((c) => c.vault && !c.orb) && !(b.cores || []).some((c) => c.orb));

async function scene(name, A, blast) {
  // (every ball is followed: a blast can blow some apart, and the one that rises is judged)
  const balls = A.cores.filter((c) => c.vault && !c.orb).map((c) => ({ c, home0: c.y, freeTick: -1, clear: null, up: 0, upT: 0, down: 0, downT: 0, lastY: c.y, settleTick: -1 }));
  const ground0 = A.ground;
  const threaded0 = world.pipes.lines.some((l) => l.cores.some((c) => c.building === A.id));
  blast(A);
  // (the ball's lowest cell on its axis - its white disc has gaps, so not the first gap down)
  const ballBottom = (c) => { let low = c.y; for (let y = c.y; y <= c.y + 14; y += 1) if (id(c.x, y) === M.CORE && !PW.getOwner(world, c.x, y)) low = y; return low; };
  const rubbleTop = (c) => { let y = ballBottom(c) + 1; while (y < world.height - 2 && PW.mat.phase[id(c.x, y)] <= PW.PHASE.GAS) y += 1; return y; };
  for (let t = 0; t < 60 * 150; t += 1) {
    pwApp.stepWorld(1);
    for (const B of balls) {
      const c = B.c, y = c.y;
      if (y < B.lastY) { B.up += B.lastY - y; B.upT += 1; }
      // (the travelled descent only - a ball over a void FALLS, which is gravity, not its pace)
      const sunk = c.sunk || 0;
      if (B.sunk0 === undefined) B.sunk0 = sunk;
      if (sunk > B.sunk0) { B.down += sunk - B.sunk0; B.downT += 1; B.sunk0 = sunk; }
      B.lastY = y;
      // (its clearance is the station it keeps, read over the second of its two seconds afloat -
      // grit raining in can land under it the very tick it frees, and the field sweeps it off; a
      // chunk of the wreck still coming down can heap up under it just after, and it climbs away
      // from that at its rising pace: seed 3's crater)
      if (c.free && B.freeTick < 0) { B.freeTick = t; B.gaps = []; }
      if (B.gaps && t - B.freeTick >= 60 && t - B.freeTick < 120 && c.free) B.gaps.push(rubbleTop(c) - ballBottom(c) - 1);
      if (B.gaps && t - B.freeTick === 120) { const g = [...B.gaps].sort((p, q) => p - q); B.clear = g[g.length >> 1]; }
      if (B.freeTick >= 0 && c.settled && B.settleTick < 0) B.settleTick = t;
    }
    const riser = balls.reduce((p, q) => (q.up > p.up ? q : p));
    if (riser.up > 0 && riser.settleTick >= 0) break;
  }
  const B = balls.reduce((p, q) => (q.up > p.up ? q : p)), core = B.c;
  const clearAtFree = B.clear, riseRows = B.up, riseTicks = B.upT, downRows = B.down, downTicks = B.downT;
  info(`${name}: tower #${A.id} ground ${ground0} -> ${A.ground} (${A.refounded || 0} re-found${A.refoundWait ? `, ${A.refoundWait}` : ''}); ball x${core.x} rose ${riseRows}, home ${B.home0} -> ${core.homeY}; free at ${B.freeTick} ${clearAtFree} clear; settled at ${B.settleTick}`);
  // (the rule's one exception: something that is not its own wreck bars the way overhead - an
  // overhang, a neighbour's floor - and caps the climb where it stands)
  const cappedBy = core.capped || '';
  const capLegit = cappedBy && !cappedBy.endsWith(`:o${A.id}`);
  check(clearAtFree !== null && (clearAtFree >= 50 || capLegit), `${name} - N86: the ball rises at least 50 cells clear of the rubble over it (${clearAtFree}${cappedBy ? `, capped by ${cappedBy}` : ''})`);
  const up = riseTicks ? riseRows / riseTicks : 0, down = downTicks ? downRows / downTicks : 0;
  check(riseRows > 0, `${name} - a ball rises out of the wreck (${riseRows} rows)`);
  check(downTicks > 5 && Math.abs(up - down) < 0.15, `${name} - N86: it comes back down at the speed it went up (${(up * 60).toFixed(0)} rows/s up, ${(down * 60).toFixed(0)} down)`);
  check(A.refounded > 0 || A.ground === ground0, `${name} - N87: the bed is laid at the surface as it lies (ground ${ground0} -> ${A.ground})`);
  let seams = 0, cols = 0;
  const seamAt = [];
  for (let x = A.body.left; x <= A.body.right; x += 3) {
    let low = -1;
    for (let y = A.ground + 80; y >= A.ground - 4; y -= 1) if (PW.getOwner(world, x, y) === A.id) { low = y; break; }
    if (low < 0) continue;
    cols += 1;
    // (the bundle's own open lanes and a tunnel running under the footing are passages, not seams)
    const fl = PW.getFlags(world, x, low + 1);
    if (PW.mat.phase[id(x, low + 1)] <= PW.PHASE.GAS && !(fl & PW.FLAG.HOLLOW) && !(fl & PW.FLAG.TUNNEL)) { seams += 1; seamAt.push(`${x},${low + 1}`); }
  }
  check(cols > 5 && seams === 0, `${name} - N87: the new footing bears on packed ground, no air seam under it (${seams} of ${cols} columns${seamAt.length ? ` at ${seamAt.slice(0, 4).join(' ')}` : ''})`);
  check(core.settled && core.y === core.homeY, `${name} - N87: the ball settles into its new bed (y ${core.y}, home ${core.homeY})`);
  const threaded = world.pipes.lines.some((l) => l.cores.some((c) => c.building === A.id && Math.abs(c.y - core.homeY) <= 1));
  check(!threaded0 || threaded, `${name} - N87: the bundle threads the new bed`);
  let touch = 0;
  for (let y = core.y - 14; y <= core.y + 14; y += 1) for (let x = core.x - 14; x <= core.x + 14; x += 1) if (PW.getOwner(world, x, y) === A.id && id(x, y) !== M.CORE) touch += 1;
  check(touch > 40, `${name} - N80: the settled ball is its building's again, attached (${touch} owned cells round it)`);
  const h0 = A.health;
  for (let k = 0; k < 20; k += 1) pwApp.stepWorld(60);
  check(A.health > h0, `${name} - the crews raise the body again from the new bed (health ${h0.toFixed(2)} -> ${A.health.toFixed(2)})`);
  await view(`refound-${name}`, core.x, A.ground - 60, 5);
}

const tallest = (list) => list.sort((a, b) => (a.ground - a.body.top) - (b.ground - b.body.top)).pop();
// The heap: the tallest tower on the left loses its whole ground floor.
await scene('heap', tallest(towers('left')), (A) => {
  for (let x = A.body.left + 6; x <= A.body.right - 6; x += 14) pwApp.explode(x, A.ground - 16, 14, 1.3);
});
// The crater: the shortest tower on the right blasted from deep below its vaults - it drops into
// the hole it blew, its balls riding up out of it, and its bed is laid wherever the wreck comes
// to rest in the hole (even the shortest tower's wreck still heaps over the old ground line).
const shortest = (list) => list.sort((a, b) => (b.ground - b.body.top) - (a.ground - a.body.top)).pop();
await scene('crater', shortest(towers('right')), (A) => {
  for (let x = A.body.left + 4; x <= A.body.right - 4; x += 14) pwApp.explode(x, A.ground + 52, 30, 2.2);
  for (let x = A.body.left + 6; x <= A.body.right - 6; x += 14) pwApp.explode(x, A.ground - 16, 14, 1.3);
});
return { checks, shots };
