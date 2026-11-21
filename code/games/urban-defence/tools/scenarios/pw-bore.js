// A supply line's bore (N17; run with --page=pixel-world.html --params=det=1&seed=N): open air
// inside the casing that only smoke and fire pass. A stretch of a line is dug open from above, as a
// blast would leave it, and water, sand, thrown debris, steam and dust are put into the pit: none of
// it goes along the bore past the break. Smoke and flame put in the bore travel along it; water in
// a bore leaves it into open space, never along it; a lump of debris caught in it stays put (it
// cannot flow along) until it is burnt off at a core (PW.boreBurn - the cargo pushes it there: see
// pw-pipes); a shaft cut down through a line is open ground there. No water is lost.
const { world, pipes, particles } = pwApp;
const { M, FLAG } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const W = world.width;
const id = (x, y) => PW.get(world, x, y) & 63;
const hollow = (x, y) => (PW.getFlags(world, x, y) & FLAG.HOLLOW) !== 0;
const sealed = (x, y) => PW.boreAt(world, y * W + x);
const waterAll = () => { const F = particles.F; let n = pwApp.countWater(); for (let i = 0; i < particles.count; i += 1) if (particles.flags[i] & F.WATER) n += 1; return n; };
const gasOrOpen = (k) => PW.mat.phase[k] <= PW.PHASE.GAS;

// 1. The bore's bits are its flags where it is shut in: never a bit without the flag, and only where
// its casing has been broken through - a building's footings laid over a well, say - a flag
// without the bit.
let flagged = 0, bits = 0, stray = 0;
for (const line of pipes.lines) for (let k = 0; k < line.ys.length; k += 5) {
  const x = line.x0 + k;
  for (let y = line.ys[k]; y < line.ys[k] + pipes.BORE; y += 1) {
    const f = hollow(x, y), b = sealed(x, y);
    flagged += f ? 1 : 0; bits += b ? 1 : 0; stray += b && !f ? 1 : 0;
  }
}
check(flagged > 300 && stray === 0 && bits >= flagged * 0.97, `the bore is kept as one bit a cell where it is shut in (${bits} of ${flagged} flagged cells sampled; ${stray} bits without the flag)`);

// A flat, whole stretch of a line, 120 columns, a good way under the ground.
let at = null;
for (const line of pipes.lines) {
  for (let k = 200; k < line.ys.length - 300 && !at; k += 7) {
    const x = line.x0 + k, y = line.ys[k];
    let flat = true;
    for (let d = 0; d < 120 && flat; d += 1) flat = line.ys[k + d] === y && !line.broken[k + d] && sealed(x + d, y + 1) && sealed(x + d, y + 3) && id(x + d, y) === M.PIPE;
    if (flat && y > world.groundTop[x + 40] + 10) at = { line, x, y };
  }
  if (at) break;
}
if (!at) check(false, 'a flat, whole stretch of a supply line to dig open');
else {
  const { x, y } = at;   // y: the casing's top row; the lanes at y+1, y+3, y+5
  const p0 = x + 30, p1 = x + 49;        // the pit
  const c0 = x + 95, c1 = x + 99;        // the shaft (last)
  const lumpX = x + 70;
  // (what is in the line's bore along the stretch, not at a break: anything but gas and its steel)
  const along = () => {
    const n = {};
    for (let yy = y; yy < y + pipes.BORE; yy += 1) for (let xx = x; xx < x + 120; xx += 1) {
      if (!hollow(xx, yy) || (xx >= p0 - 1 && xx <= p1 + 1) || (xx >= c0 - 1 && xx <= c1 + 1) || (xx === lumpX && yy === y + 3)) continue;
      const k = id(xx, yy);
      if (!gasOrOpen(k) && k !== M.PIPE) { const name = PW.mat.names[k]; n[name] = (n[name] || 0) + 1; }
    }
    return n;
  };
  // 2. The pit: from the surface down through the top casing over 20 columns - the top lane open
  // to it there, as a blast leaves a line - and into it water, sand, steam, dust and thrown debris.
  for (let xx = p0; xx <= p1; xx += 1) for (let yy = world.groundTop[xx] - 1; yy <= y; yy += 1) if (!hollow(xx, yy)) PW.set(world, xx, yy, M.AIR);
  for (let xx = p0 + 1; xx < p1; xx += 1) {
    for (let yy = y - 24; yy < y - 12; yy += 1) PW.set(world, xx, yy, M.WATER);
    for (let yy = y - 32; yy < y - 26; yy += 1) PW.set(world, xx, yy, M.SAND);
  }
  // (the water in the world now; steam put in may condense back to water as it cools)
  const water0 = waterAll();
  let steam = 0;
  for (let xx = p0 + 2; xx < p1 - 1; xx += 3) { PW.set(world, xx, y - 2, M.STEAM | 3 << 6); PW.set(world, xx + 1, y - 1, M.DUST | 3 << 6); steam += 1; }
  for (let k = 0; k < 40; k += 1) particles.spawn(p0 + 1 + (k % 18), y - 44, (k % 7 - 3) * 12, 60, M.DEBRIS, 0, particles.F.LAND, 6);
  pwApp.stepWorld(60 * 6);
  const kept = along();
  const pitWater = (() => { let n = 0; for (let yy = y - 40; yy <= y + 1; yy += 1) for (let xx = p0; xx <= p1; xx += 1) if (id(xx, yy) === M.WATER) n += 1; return n; })();
  check(Object.keys(kept).length === 0 && pitWater > 100,
    `water, sand, thrown debris, steam and dust put into a pit dug onto a supply line go no further than the break: none of it runs along the bore beyond it (in the bore along the stretch after 6 s: ${JSON.stringify(kept)}; ${pitWater} water standing in the pit)`);
  await view('bore-pit', (p0 + p1) / 2, y - 10, 7);

  // 3. Smoke and flame go along it: put in its top lane to the side of the pit, they spread along it.
  const s0 = x + 2, s1 = x + 13;
  for (let xx = s0; xx <= s1; xx += 1) PW.set(world, xx, y + 1, M.SMOKE | 3 << 6);
  for (let k = 0; k < 6; k += 1) particles.spawn(x + 6 + k * 0.5, y + 1.5, 40, 0, 0, PW.abgr(180, 90, 40, 200), particles.F.FIRE, 1.2);
  let flameFar = -Infinity, smokeFar = 0;
  for (let t = 0; t < 60 * 8; t += 1) {
    pwApp.stepWorld(1);
    const F = particles.F;
    for (let i = 0; i < particles.count; i += 1) if ((particles.flags[i] & F.FIRE) && particles.py[i] >= y + 1 && particles.py[i] < y + 2) flameFar = Math.max(flameFar, particles.px[i]);
    // (how far along the lane, either way, beyond where it was put)
    for (let xx = x - 20; xx <= p0; xx += 1) if (id(xx, y + 1) === M.SMOKE) smokeFar = Math.max(smokeFar, xx > s1 ? xx - s1 : xx < s0 ? s0 - xx : 0);
  }
  check(smokeFar >= 6 && flameFar - (x + 6) >= 3,
    `smoke and flame pass the bore: smoke put in its top lane spreads along it (${s1 - s0 + 1} cells put in, the furthest ${smokeFar} cells beyond them), a flame thrown along the lane runs it (${Number.isFinite(flameFar) ? (flameFar - (x + 6)).toFixed(0) : '-'} cells on)`);

  // 4. Water already in a bore (as the cargo spills it at a cut) leaves it into the open space beside
  // it, never along it; sand coming down onto it lies on it. (A strip of bore of the test's own,
  // out in the open air - room cleared round it - not a line's: the line's bookkeeping is left
  // alone.) And a lump of debris caught in the line's bore does not move along it.
  const sx0 = x - 70, sy = world.groundTop[sx0] - 40;
  for (let yy = sy - 10; yy <= sy + 10; yy += 1) for (let xx = sx0 - 3; xx < sx0 + 23; xx += 1) { PW.set(world, xx, yy, M.AIR); PW.setLayer(world, 'deco', xx, yy, 0); }
  for (let xx = sx0; xx < sx0 + 20; xx += 1) PW.setFlag(world, xx, sy, FLAG.HOLLOW);
  for (let xx = sx0 + 1; xx < sx0 + 5; xx += 1) PW.set(world, xx, sy, M.WATER);
  for (let xx = sx0 + 9; xx < sx0 + 12; xx += 1) PW.set(world, xx, sy - 4, M.SAND);
  PW.set(world, lumpX, y + 3, M.DEBRIS);
  pwApp.stepWorld(60 * 4);
  let spilled = 0, sandIn = 0, sandOn = 0;
  for (let xx = sx0; xx < sx0 + 20; xx += 1) { const k = id(xx, sy); if (k === M.WATER) spilled += 1; if (k === M.SAND) sandIn += 1; if (id(xx, sy - 1) === M.SAND) sandOn += 1; }
  for (let xx = sx0; xx < sx0 + 20; xx += 1) PW.setFlag(world, xx, sy, FLAG.HOLLOW, false);
  check(spilled === 0 && sandIn === 0 && sandOn > 0 && id(lumpX, y + 3) === M.DEBRIS && id(lumpX - 1, y + 3) === M.AIR && id(lumpX + 1, y + 3) === M.AIR,
    `water in a bore leaves it into the open space under it (${spilled} of 4 left in it after 4 s); sand coming down onto a bore lies on it (${sandOn} grains on it, ${sandIn} in it); a lump of debris caught in a line's bore stays where it is (${PW.mat.names[id(lumpX, y + 3)]} at its place)`);
  // 5. ...until it is burnt off at a core.
  const hot0 = PW.heatAt(world, lumpX, y + 3);
  const burnt = PW.boreBurn(world, lumpX, y + 3);
  const hot1 = PW.heatAt(world, lumpX, y + 3);
  let flames = 0;
  { const F = particles.F; for (let i = 0; i < particles.count; i += 1) if ((particles.flags[i] & F.FIRE) && Math.abs(particles.px[i] - lumpX) < 3 && Math.abs(particles.py[i] - (y + 3)) < 3) flames += 1; }
  check(burnt && id(lumpX, y + 3) !== M.DEBRIS && hot1 > hot0 + 300 && flames > 0 && !PW.boreBurn(world, lumpX, y),
    `debris pushed to a core comes apart and catches (PW.boreBurn): the lump is gone in ${flames} flame pixels, its cell ${PW.mat.names[id(lumpX, y + 3)]} at ${hot1.toFixed(0)} C; the casing is never burnt`);
  pwApp.stepWorld(60 * 3);
  const water1 = waterAll();
  // (4 cells put in the test's own bore on top; the steam's water back, or some of it)
  check(water1 >= water0 + 4 - 1 && water1 <= water0 + 4 + steam + 1, `no water lost or made (${water0} + 4 put in -> ${water1}, ${steam} steam cells that may have condensed)`);
  await view('bore-after', (p0 + p1) / 2, y - 10, 7);

  // 6. A shaft cut down through the line (as a crater or a dig leaves it): its casing and dividers
  // broken, the bore there is open ground's air - water poured in runs down through the cut - while
  // the bore beside the cut stays shut to it.
  for (let xx = c0; xx <= c1; xx += 1) for (let yy = world.groundTop[xx] - 1; yy <= y + pipes.BORE + 3; yy += 1) if (id(xx, yy) !== M.AIR) PW.set(world, xx, yy, M.AIR);
  for (let xx = c0; xx <= c1; xx += 1) for (let yy = y - 14; yy < y - 6; yy += 1) PW.set(world, xx, yy, M.WATER);
  pwApp.stepWorld(60 * 2);
  let through = 0, beside = 0;
  for (let xx = c0; xx <= c1; xx += 1) for (let yy = y + 1; yy <= y + pipes.BORE + 3; yy += 1) if (id(xx, yy) === M.WATER) through += 1;
  for (const xx of [c0 - 2, c0 - 3, c1 + 2, c1 + 3]) for (let yy = y + 1; yy < y + pipes.BORE - 1; yy += 1) if (id(xx, yy) === M.WATER) beside += 1;
  check(through > 15 && beside === 0, `a shaft cut down through a line is open ground there: water poured in runs down through the cut (${through} cells of it in the cut and under the line), the bore beside the cut stays shut to it (${beside} in it)`);
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
