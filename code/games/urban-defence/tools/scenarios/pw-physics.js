// Ground physics (run with --page=pixel-world.html --params=seed=N): rock shields a blast far more
// than soil does, a mountain blown open comes down in a rockslide, and a collapsed piece of a
// building rains down into a wide heap instead of standing in the air.
const { world, layout, stability } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const W = world.width;
const id = (x, y) => PW.get(world, x, y) & 63;
const openAt = (x, y) => PW.mat.open[id(x, y)] === 1;

// 1. The same blast takes out far less rock than soil, and a town's made ground stands it nearly as
// well as rock. Test blocks of stone, soil and made ground are laid deep under the middle of the
// wild zones (below the reach of anything built), and each is blown up from its middle.
const holes = {};
const blocks = [[M.STONE, 'stone'], [M.SOIL, 'soil'], [M.FILL, 'made ground']];
blocks.forEach(([kind, name], k) => {
  const zone = layout.wilds[k % layout.wilds.length];
  const bx = Math.round((zone.x0 + zone.x1) / 2) + (k >= layout.wilds.length ? 400 : 0), by = world.groundTop[bx] + 700;
  for (let y = by - 90; y <= by + 90; y += 1) for (let x = bx - 120; x <= bx + 120; x += 1) PW.set(world, x, y, kind, { quiet: true });
  pwApp.explode(bx, by, 48, 1.1);
  let n = 0;
  for (let y = by - 60; y <= by + 60; y += 1) for (let x = bx - 70; x <= bx + 70; x += 1) if (openAt(x, y)) n += 1;
  holes[name] = n;
});
check(holes.stone > 0 && holes.soil > holes.stone * 3, `a blast in rock chips a small hole, in soil it blows out a wide crater (${holes.stone} cells opened in stone, ${holes.soil} in soil)`);
check(holes['made ground'] < holes.soil * 0.5, `a town's made ground stands a blast far better than soil (${holes['made ground']} cells opened, ${holes.soil} in soil)`);

// 2. A mountain flank blown open again and again comes down: the rock left hanging over the hole
// breaks loose and slides away down the mountainside.
const m = layout.mountains.slice().sort((a, b) => b.height - a.height)[0];
const fx = Math.round(m.x - m.half * 0.45), fy = world.groundTop[fx] + 30;
await view('ph-mountain-before', fx, fy - 60, 4);
const brokenBefore = stability.stats.broken;
for (const [dx, dy] of [[0, 0], [30, -10], [-25, 15], [10, -30], [45, 10]]) { pwApp.explode(fx + dx, fy + dy, 60, 1.35); pwApp.stepWorld(20); }
pwApp.stepWorld(60 * 14);
const slid = stability.stats.broken - brokenBefore;
// Nothing is left hanging: no ground over a void deeper than the rock's reach, in the area.
let hanging = 0;
for (let x = fx - 80; x <= fx + 120; x += 2) {
  for (let y = world.groundTop[x]; y < fy + 80; y += 1) {
    if (!PW.mat.terrain[id(x, y)] || PW.mat.phase[id(x, y)] !== PW.PHASE.SOLID || PW.getOwner(world, x, y)) continue;
    let gap = 0;
    while (gap < 30 && openAt(x, y + 1 + gap)) gap += 1;
    if (gap < 30) continue;
    // (held from the side within its cohesion is fine)
    let held = false;
    for (let k = 1; k <= PW.mat.cohesion[id(x, y)] && !held; k += 1) for (const d of [-1, 1]) if (!openAt(x + d * k, y + 1) && !openAt(x + d * k, y)) held = true;
    if (!held) hanging += 1;
  }
}
check(slid > 500 && hanging === 0, `a mountain blown open comes down in a rockslide (${slid} cells broke loose, ${hanging} left hanging)`);
// Vibration comes from the shock of strikes - the blasts, the slide coming down, the rock raining
// onto the slope - and loosens what the element table says is loose enough.
check((stability.stats.shocks || 0) > 5 && stability.stats.loosened > 0, `blasts, the slide and falling rock all shake the ground (${stability.stats.shocks || 0} shocks, ${stability.stats.loosened} cells shaken loose)`);
await view('ph-mountain-after', fx, fy - 60, 4);
check((stability.stats.maxMs || 0) < 8, `looking for ground that lost its footing stays in budget (worst ${(stability.stats.maxMs || 0).toFixed(1)} ms)`);

// 3. Untouched ground stays put: natural caves and overhangs elsewhere do not fall in by themselves.
const before = stability.stats.broken;
pwApp.stepWorld(60 * 5);
check(stability.stats.broken === before, `ground nobody disturbed stands (${stability.stats.broken - before} cells broke loose by themselves)`);
pwApp.setPaused(false);
return { checks, shots: shots.length, holes, stability: stability.stats };
