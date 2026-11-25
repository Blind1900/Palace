// Bridge piers in water (run with --page=pixel-world.html --params=seed=N&det=1): a bridge's legs
// (FLAG.BRIDGE) stand in the water as piers do - the world is a slice, the water all round them in
// depth - so a lake sloshing about a leg does not press it over; a front running at one pushes on it
// by its drag: it knocks out a leg one cell thick, and one two cells thick holds (see pw-sim's pushOn).
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const id = (x, y) => PW.get(world, x, y) & 63;
const BRIDGE = PW.FLAG.BRIDGE;
// (a stretch of the wilds, cleared to a stone floor)
let X0 = -1;
for (const z of layout.wilds || []) if (X0 < 0 && z.x1 - z.x0 > 1600) X0 = z.x0 + 100;
let g = Infinity;
if (X0 >= 0) for (let x = X0; x < X0 + 1400; x += 1) g = Math.min(g, world.groundTop[x]);
const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); } };
// (a bridge's leg, `w` cells thick, from `top` down to the floor: pillar, flagged as the bridge's)
const leg = (x, w, top) => { for (let y = top; y < g; y += 1) for (let k = 0; k < w; k += 1) { PW.set(world, x + k, y, M.PILLAR, { quiet: true }); PW.setFlag(world, x + k, y, BRIDGE); } };
const left = (x, w, top) => { let n = 0; for (let y = top; y < g; y += 1) for (let k = 0; k < w; k += 1) if (id(x + k, y) === M.PILLAR) n += 1; return n; };
if (X0 < 0) check(false, 'a stretch of the wilds 1600 wide for the piers');
else {
  fill(X0, g - 300, X0 + 1400, g - 1, M.AIR);
  fill(X0, g, X0 + 1400, g + 20, M.STONE);
  // 1. A lake 400 wide and 120 deep, walled at its ends; a leg one cell thick in its middle, up out
  // of it; a mass of water let fall into one end sets the lake sloshing for 12 s.
  const L0 = X0 + 20, L1 = L0 + 400, LX = L0 + 200;
  fill(L0 - 10, g - 160, L0 - 1, g - 1, M.STONE); fill(L1 + 1, g - 160, L1 + 10, g - 1, M.STONE);
  fill(L0, g - 120, L1, g - 1, M.WATER);
  leg(LX, 1, g - 150);
  const lake0 = left(LX, 1, g - 150);
  fill(L0 + 5, g - 200, L0 + 60, g - 150, M.WATER);
  PW.wakeArea(world, L0 - 10, g - 220, L1 + 10, g);
  const surface = (x) => { let y = g - 220; while (y < g && id(x, y) !== M.WATER) y += 1; return y; };
  let wave = 0;
  for (let t = 0; t < 60 * 12; t += 1) {
    pwApp.stepWorld(1);
    if (t % 10 === 0) wave = Math.max(wave, Math.abs(surface(LX - 3) - surface(LX + 3)));
  }
  const lake1 = left(LX, 1, g - 150);
  await view('piers-lake', LX, g - 80, 5);
  // (a wave front off the mass let fall may knock a cell off it where it breaks against the leg)
  check(lake1 >= lake0 * 0.97 && wave >= 3,
    `a bridge's leg one cell thick stands in a lake sloshing round it (${lake1} of its ${lake0} cells left after 12 s; the water up to ${wave} cells higher on one side of it than the other)`);
  // 2. A dam break: a reservoir 200 wide and 140 deep behind a gate, and beyond it a dry channel - a
  // leg one cell thick 46 past the gate, one two cells thick 166 past it, each 60 tall. The gate goes.
  const R0 = X0 + 600, R1 = R0 + 200, GX = R1 + 1, P1 = GX + 46, P2 = GX + 166;
  fill(R0 - 10, g - 180, R0 - 1, g - 1, M.STONE);
  fill(R0, g - 140, R1, g - 1, M.WATER);
  fill(GX, g - 180, GX + 5, g - 1, M.STONE);
  fill(GX + 400, g - 100, GX + 410, g - 1, M.STONE);
  leg(P1, 1, g - 60); leg(P2, 2, g - 60);
  const one0 = left(P1, 1, g - 60), two0 = left(P2, 2, g - 60);
  pwApp.stepWorld(30);
  fill(GX, g - 180, GX + 5, g - 1, M.AIR);
  PW.wakeArea(world, R0 - 10, g - 200, GX + 420, g);
  for (let t = 0; t < 60 * 8; t += 1) pwApp.stepWorld(1);
  const one1 = left(P1, 1, g - 60), two1 = left(P2, 2, g - 60);
  await view('piers-dam-break', GX + 100, g - 60, 5);
  check(one1 < one0 * 0.9 && two1 === two0,
    `a dam break's front knocks out a leg one cell thick by its drag (${one1} of ${one0} cells left) and a leg two cells thick holds (${two1} of ${two0})`);
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
