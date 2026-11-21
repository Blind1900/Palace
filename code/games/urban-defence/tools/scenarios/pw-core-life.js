// A core's white energy is the world's own Game of Life (D15; run with --page=pixel-world.html
// --params=det=1&seed=N): pw-life's Life - its rule B3/S23, its physics, its look - living on the
// core's disc, sparked from its heart, most at the poles; it keeps alive at rest, smothers where
// rubble fills its disc, dies in a dead core, and is blown and shaken by a blast. The world held
// still; the cores and the Life stepped by hand as the app steps them.
const { world, cores, life } = pwApp;
const { M } = PW;
const CL = PW.coreLife;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
pwApp.setPaused(true);
const W = world.width;
const at = (core, dx, dy) => life.at(Math.round(core.x) + dx, Math.round(core.y) + dy);
const cells = (core) => { const out = []; for (let dy = -11; dy <= 11; dy += 1) for (let dx = -11; dx <= 11; dx += 1) if (at(core, dx, dy)) out.push(`${dx},${dy}`); return out.sort().join(' '); };
const tickWith = (n, ...list) => { for (let t = 0; t < n; t += 1) { for (const c of list) CL.step(world, c, c.vigor ?? 1); life.step(); } };
// (a core of the test's own in the open air: a disc of sky over the wilds)
const zone = pwApp.layout.wilds[0];
const fx = Math.round((zone.x0 + zone.x1) / 2), fy = world.groundTop[fx] - 60;
const sky = () => { for (let y = fy - 14; y <= fy + 14; y += 1) for (let x = fx - 14; x <= fx + 14; x += 1) { PW.set(world, x, y, M.AIR, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); } life.clear(fx - 14, fy - 14, fx + 14, fy + 14); };
sky();

// 1. The rule is the world's Life's own: a blinker blinks, a block stands - and a blinker at the
// rim dies there, never born past it.
{
  const fake = { x: fx, y: fy };
  CL.step(world, fake, 1);
  const put = (dx, dy) => life.put(fx + dx, fy + dy, life.WHITE);
  [[5, -1], [5, 0], [5, 1]].forEach(([dx, dy]) => put(dx, dy));
  [[-6, -1], [-5, -1], [-6, 0], [-5, 0]].forEach(([dx, dy]) => put(dx, dy));
  [[-1, -8], [0, -8], [1, -8]].forEach(([dx, dy]) => put(dx, dy));
  const white = (at(fake, 5, 0) & 3) === life.WHITE;
  life.generation();
  const one = cells(fake);
  life.generation();
  const two = cells(fake);
  check(white && one === '-5,-1 -5,0 -6,-1 -6,0 0,-7 0,-8 4,0 5,0 6,0' && two === '-5,-1 -5,0 -6,-1 -6,0 5,-1 5,0 5,1',
    `the core's energy is the world's Life itself (pw-life's generation, its white cells): on the ring a blinker blinks and a block stands (${one} | ${two}); the blinker at the rim is never born past it and dies there`);
  life.clear(fx - 14, fy - 14, fx + 14, fy + 14);
}

// 2. At rest it keeps alive, sparked from the heart, most at the poles.
const live = [];
for (const b of world.buildings || []) for (const c of b.cores || []) if (!c.standing && !c.dead) live.push(c);
for (const s of world.seedCores || []) if (!s.building && !s.dead) live.push(s);
const core = live[0];
{
  let gens = 0, alive = 0, polar = 0, equator = 0, g0 = life.stats.generations || 0, prev = new Set();
  const cx = Math.round(core.x), cy = Math.round(core.y);
  for (let t = 0; t < 60 * 12; t += 1) {
    cores.step(); life.step();
    if ((life.stats.generations || 0) === g0) continue;
    g0 = life.stats.generations;
    gens += 1;
    const now = new Set();
    for (let dy = -9; dy <= 9; dy += 1) for (let dx = -9; dx <= 9; dx += 1) if (life.at(cx + dx, cy + dy)) now.add(dy * 64 + dx);
    if (now.size) alive += 1;
    for (const k of now) if (!prev.has(k)) { const dy = Math.round(k / 64), dx = k - dy * 64; if (Math.abs(dy) > Math.abs(dx)) polar += 1; else equator += 1; }
    prev = now;
  }
  check(core && gens >= 85 && alive >= gens * 0.85 && polar > equator * 1.25 && polar + equator > gens * 2,
    `at rest a core's Life keeps going in its own body, stepped by the cores as the game steps them - ${gens} generations in 12 s, alive in ${alive} of them, ${polar + equator} births - sparked from its heart, most at the poles (${polar} births polar, ${equator} round its equator)`);
}

// 3. Rubble filling its disc smothers it there; 4. a dead core's Life dies.
{
  sky();
  const fake = { x: fx, y: fy, vigor: 1 };
  for (let y = fy - 12; y <= fy + 12; y += 1) for (let x = fx - 12; x < fx; x += 1) PW.set(world, x, y, M.SAND, { quiet: true });
  tickWith(60 * 4, fake);
  let left = 0, right = 0;
  for (let dy = -9; dy <= 9; dy += 1) for (let dx = -9; dx <= 9; dx += 1) if (at(fake, dx, dy)) { if (dx < 0) left += 1; else right += 1; }
  for (let y = fy - 12; y <= fy + 12; y += 1) for (let x = fx - 12; x < fx; x += 1) PW.set(world, x, y, M.AIR, { quiet: true });
  const before = life.coreCells(fake);
  fake.vigor = 0;
  tickWith(20, fake);
  const after = life.coreCells(fake);
  check(left === 0 && right > 0 && after === 0,
    `rubble filling half a core's disc smothers its Life there (${left} live cells under the sand, ${right} in the open half); a dead core's disc is no home - its Life dies (${before} -> ${after} live cells by the next generation)`);
}

// 5. A blast blows its cells away and shakes it: PW.explode tells the core Life.
{
  sky();
  const fake = { x: fx, y: fy, vigor: 1 };
  tickWith(60 * 2, fake);
  let told = 0;
  const blast0 = CL.blast;
  CL.blast = (...a) => { told += 1; return blast0(...a); };
  // (a block on the side it will strike)
  [[6, 0], [7, 0], [6, 1], [7, 1]].forEach(([dx, dy]) => life.put(fx + dx, fy + dy, life.WHITE));
  const pop0 = life.coreCells(fake);
  const side = () => { let n = 0; for (let dy = -9; dy <= 9; dy += 1) for (let dx = 5; dx <= 9; dx += 1) if (at(fake, dx, dy)) n += 1; return n; };
  const near0 = side();
  pwApp.explode(fx + 12, fy, 5, 0.9);
  CL.blast = blast0;
  const near = side();
  const e = life.coreEntry(fake), shock = e ? e.shock : 0, gen0 = life.stats.generations || 0;
  const pop1 = life.coreCells(fake);
  let t = 0;
  while ((life.stats.generations || 0) === gen0 && t < 20) { tickWith(1, fake); t += 1; }
  check(told === 1 && near0 >= 4 && near === 0 && shock > 0.3 && e.stirred > 0,
    `a blast blows a core's Life away as it blows any (${pop0} live cells before, ${pop1} after: ${near0} -> ${near} on the side it struck) and shakes it - struck at ${shock.toFixed(2)}, a burst of sparks thrown in (${life.coreCells(fake)} live the next generation), stirred for a while (${e && e.stirred} generations)`);
  sky();
}

// 6. Its look is the LIFE tool's: the white cells drawn by the world's Life, its white.
{
  const fake = { x: fx, y: fy, vigor: 1 };
  tickWith(60, fake);
  let lx = 0, ly = 0;
  for (let dy = -9; dy <= 9 && !lx; dy += 1) for (let dx = -9; dx <= 9; dx += 1) if (at(fake, dx, dy)) { lx = fx + dx; ly = fy + dy; break; }
  const cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
  const r = { ctx: cv.getContext('2d'), camera: { x: fx - 12, y: fy - 12, zoom: 8 }, view: { width: 200, height: 200 } };
  life.draw(r);
  CL.draw(r, fake);
  const px = r.ctx.getImageData(Math.round((lx - r.camera.x) * 8) + 3, Math.round((ly - r.camera.y) * 8) + 3, 1, 1).data;
  const ref = document.createElement('canvas').getContext('2d');
  // (and a cell the LIFE tool paints in the open sky by it, out of the core's reach - not before a
  // backdrop, where the world's white has no room)
  let tx = 0, ty = 0;
  for (const [dx, dy] of [[-13, 13], [13, 13], [-13, -13], [13, -13], [0, -13], [0, 13]]) { life.put(fx + dx, fy + dy, life.WHITE); if (life.at(fx + dx, fy + dy)) { tx = fx + dx; ty = fy + dy; break; } }
  const r2 = { ctx: ref, camera: { x: tx - 1, y: ty - 1, zoom: 8 }, view: { width: 24, height: 24 } };
  life.draw(r2);
  const tool = ref.getImageData(11, 11, 1, 1).data;
  check(lx && tx && px[0] === tool[0] && px[1] === tool[1] && px[2] === tool[2] && px[3] === 255,
    `a core's live cell looks as the LIFE tool's white looks, drawn by the world's Life (rgb ${px[0]},${px[1]},${px[2]} on the core, ${tool[0]},${tool[1]},${tool[2]} painted by the tool)`);
  life.clear(fx - 40, fy - 14, fx + 14, fy + 14);
}

// 7. What it costs: a core's tick, and the sparks of every core a generation.
{
  const best = (n, each, work) => { let min = Infinity; for (let b = 0; b < n; b += 1) { const t0 = performance.now(); for (let k = 0; k < each; k += 1) work(); min = Math.min(min, (performance.now() - t0) / each); } return min; };
  for (const c of live) CL.step(world, c, 1);
  const stepMs = best(5, 400, () => CL.step(world, core, 1));
  const sparkMs = best(5, 20, () => life.coreSparks());
  check(stepMs < 0.01 && sparkMs < 0.5, `a core's Life costs little: ${(stepMs * 1000).toFixed(1)} us a core a tick, ${sparkMs.toFixed(3)} ms a generation to spark all ${life.cores} cores`);
}

// (a look: the world running, the cores' Life in the world's Life)
{
  pwApp.setPaused(false);
  pwApp.focus(core.x, core.y, 9);
  for (let t = 0; t < 12; t += 1) await sleep(100);
  shots.push(await shot('core-life'));
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
