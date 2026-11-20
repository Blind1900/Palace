// N38 part 4 probe (run with --page=pixel-world.html "--params=det=1&seed=7&flags=PIPE_CAVITY"):
// with PW.PIPE_CAVITY on, the bore is REAL space - casing and dividers solid M.PIPE, each lane
// row carved to air with the lane's ribbed colour as its back wall - and everything the pipes
// do (lay, carry, break, spill, regrow, take up) works on the real tube. Off (the default) the
// world is byte-identical to before; this scenario guards the ON half until the physics track
// flips its side (pw-heat's hollowAt, pw-particles' gasOpen PIPE case and intoMouths) and the
// flag goes on for good. Not in run-pw-suites' list yet: run it by hand, and add it at the flip.
const { world, pipes } = pwApp;
const { M, FLAG } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
const id = (x, y) => PW.get(world, x, y) & 63;
const BORE = pipes.BORE;

check(PW.PIPE_CAVITY === true, 'PW.PIPE_CAVITY is on (the flags= hook took)');

// 1. The straight in-ground run is a real tube: lanes open on their back-wall colour, marked
// HOLLOW under the line's owner, between solid casing and dividers.
const line = pipes.lines.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a), pipes.lines[0]);
const clearOf = (x) => !line.cores.some((c) => Math.abs(x - c.x) < 44)
  && !line.risers.some((r) => Math.abs(x - r.x) < 12)
  && !(line.wells || []).some((w) => Math.abs(w.x - x) < 12);
let sampled = 0, carved = 0, firstGood = 0;
for (let x = line.x0 + 8; x <= line.x1 - 8; x += 3) {
  if (!clearOf(x)) continue;
  const top = line.ys[x - line.x0];
  // (an open-space span or a sleeve is drawn, not cells: judge only columns cased in the ground)
  if (id(x, top) !== M.PIPE || id(x, top + BORE - 1) !== M.PIPE) continue;
  sampled += 1;
  let ok = id(x, top + 2) === M.PIPE && id(x, top + 4) === M.PIPE;
  for (const r of [1, 3, 5]) {
    const y = top + r;
    ok = ok && id(x, y) === M.AIR && !!PW.getLayer(world, 'back', x, y)
      && (PW.getFlags(world, x, y) & FLAG.HOLLOW) !== 0 && PW.getOwner(world, x, y) === line.owner;
  }
  if (ok && !firstGood) firstGood = x;
  carved += ok ? 1 : 0;
}
check(sampled > 200 && carved >= sampled * 0.98,
  `the in-ground bore is a real tube: open lanes on their back colour between solid casing and dividers (${carved}/${sampled} columns)`);
check(pipes.stats.broken === 0 && pipes.lines.every((l) => ![...l.broken].some(Boolean)),
  `the carved bundles read whole as laid (${pipes.stats.broken} broken columns)`);
if (firstGood) await view('pc-bore', firstGood, line.ys[firstGood - line.x0] + 3, 8);

// 2. Cargo still flows the carved tube into the cores' stock (ore is slow: give it time).
const stocked = () => ['left', 'right'].every((side) => { const st = (world.stock || {})[side] || {}; return st.water > 0 && st.sm > 0 && st.hm > 0; });
for (let t = 0; t < 12 && !stocked(); t += 1) pwApp.stepWorld(60 * 5);
check(stocked(), `cargo crosses the carved tube into stock (${JSON.stringify(world.stock)})`);

// 3. A blast cuts the carved bundle; the regrowth closes the real tube and takes up every stray.
const water = pipes.lines.find((l) => l.risers.some((r) => r.kind === 'pump')) || line;
const pump = water.risers.find((r) => r.kind === 'pump') || { x: water.x0 + 60 };
const town = water.coreX;
const dir0 = Math.sign(town - pump.x) || 1;
let cutX = 0;
for (let d = 0; d < Math.abs(town - pump.x) - 240 && !cutX; d += 1) {
  const x = pump.x + dir0 * (140 + d);
  const k = x - water.x0;
  if (k < 8 || k >= water.ys.length - 8) break;
  if (!water.cores.some((c) => Math.abs(x - c.x) < 60) && !water.risers.some((r) => Math.abs(x - r.x) < 60)
    && !(water.wells || []).some((w) => Math.abs(w.x - x) < 30) && id(x, water.ys[k]) === M.PIPE) cutX = x;
}
check(cutX > 0, `a straight cased stretch to cut (${cutX})`);
const air = () => (pwApp.particles && pwApp.particles.airWater ? pwApp.particles.airWater() : 0);
const before = pwApp.countWater() + air();
const cutY = water.ys[cutX - water.x0] + 3;
pwApp.explode(cutX, cutY, 12, 1);
pwApp.stepWorld(60);
const broken = [...water.broken].filter(Boolean).length;
check(broken > 0, `a blast cuts the carved bundle (${broken} columns)`);
pwApp.stepWorld(60 * 2);
check(pipes.stats.spilled > 0, `the cut spills the cargo in the span (${pipes.stats.spilled} spilled)`);
await view('pc-break', cutX, cutY - 4, 7);
for (let s = 0; s < 40 && [...water.broken].some(Boolean); s += 1) pwApp.stepWorld(60);
check(![...water.broken].some(Boolean), `the broken ends regrow and the real tube closes (${pipes.stats.repaired} cells)`);
// (the tidy comb runs ten seconds after the last column heals: let it, then look for leavings)
pwApp.stepWorld(60 * 11);
let strayCarve = 0, strayPipe = 0;
for (let x = cutX - 90; x <= cutX + 90; x += 1) {
  const k = x - water.x0;
  if (k < 1 || k >= water.ys.length) continue;
  if (water.cores.some((c) => Math.abs(x - c.x) < 40)) continue;
  if (water.risers.some((r) => Math.abs(x - r.x) <= 8)) continue;
  for (let y = water.ys[k] - 60; y < water.ys[k] + 70; y += 1) {
    if (y >= water.ys[k] - 1 && y <= water.ys[k] + BORE) continue;
    if ((water.wells || []).some((w) => Math.abs(x - w.x) <= 3 && y >= w.y0 && y <= w.y1)) continue;
    if (PW.getOwner(world, x, y) !== water.owner) continue;
    if (id(x, y) === M.PIPE) strayPipe += 1;
    else if (PW.getFlags(world, x, y) & FLAG.HOLLOW) strayCarve += 1;
  }
}
check(strayPipe === 0 && strayCarve === 0,
  `the old tube is taken up whole - no stray casing, no stray carved voids (${strayPipe} pipe, ${strayCarve} carved)`);
const after = pwApp.countWater() + air();
check(after >= before - 2, `no water lost through the cut and the mend (${before} -> ${after} cells, spills may add)`);
await view('pc-repaired', cutX, cutY - 4, 7);
return { checks, stats: pipes.stats, stock: world.stock, shots: shots.length };
