// A core's white energy as a Game of Life of its own (D15; run with --page=pixel-world.html
// --params=det=1&seed=N): the world's rule (B3/S23) on the core's disc, sparked from its heart,
// most at the poles; it keeps alive at rest, smothers where rubble fills its disc, dies away in a
// dead core, and is shaken by a blast. Stepped and drawn here by hand as pw-cores does it.
const { world, cores } = pwApp;
const { M } = PW;
const CL = PW.coreLife;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
pwApp.setPaused(true);
const W = world.width;
const ticks = (core, n, vigor = 1, pure = false) => { for (let t = 0; t < n; t += 1) CL.step(world, core, vigor, pure); };
const cells = (core) => { const out = []; for (let dy = -9; dy <= 9; dy += 1) for (let dx = -9; dx <= 9; dx += 1) if (CL.at(core, dx, dy)) out.push(`${dx},${dy}`); return out.sort().join(' '); };
// (a core of the test's own in the open air: a disc of sky over the wilds)
const zone = pwApp.layout.wilds[0];
const fx = Math.round((zone.x0 + zone.x1) / 2), fy = world.groundTop[fx] - 60;
for (let y = fy - 12; y <= fy + 12; y += 1) for (let x = fx - 12; x <= fx + 12; x += 1) { PW.set(world, x, y, M.AIR); PW.setLayer(world, 'deco', x, y, 0); }

// 1. The rule is the world's Life: a blinker blinks, a block stands.
{
  const core = { x: fx, y: fy };
  const st = CL.state(core);
  const put = (dx, dy) => { st.a[(dy + 9) * 19 + dx + 9] = 1; };
  [[5, -1], [5, 0], [5, 1]].forEach(([dx, dy]) => put(dx, dy));
  [[-6, -1], [-5, -1], [-6, 0], [-5, 0]].forEach(([dx, dy]) => put(dx, dy));
  ticks(core, CL.EVERY, 1, true);
  const one = cells(core);
  ticks(core, CL.EVERY, 1, true);
  const two = cells(core);
  check(one === '-5,-1 -5,0 -6,-1 -6,0 4,0 5,0 6,0' && two === '-5,-1 -5,0 -6,-1 -6,0 5,-1 5,0 5,1',
    `the core's Life is the world's rule, B3/S23: a blinker on its ring blinks (${one} | ${two}), a block stands`);
}

// 2. At rest it keeps alive, sparked from the heart, most at the poles.
const live = [];
for (const b of world.buildings || []) for (const c of b.cores || []) if (!c.standing && !c.dead) live.push(c);
for (const s of world.seedCores || []) if (!s.building && !s.dead) live.push(s);
const core = live[0] || { x: fx, y: fy };
{
  let gens = 0, alive = 0, polar = 0, equator = 0, prev = null;
  for (let t = 0; t < 60 * 12; t += 1) {
    CL.step(world, core, 1);
    const st = core.lifeState;
    if (prev && st.gen !== prev.gen) {
      gens += 1; if (st.pop > 0) alive += 1;
      for (let k = 0; k < st.a.length; k += 1) if (st.a[k] && !prev.a[k]) { const dx = (k % 19) - 9, dy = ((k / 19) | 0) - 9; if (Math.abs(dy) > Math.abs(dx)) polar += 1; else equator += 1; }
    }
    if (!prev || st.gen !== prev.gen) prev = { gen: st.gen, a: st.a.slice() };
  }
  check(gens >= 170 && alive >= gens * 0.85 && polar > equator * 1.25 &&polar + equator > gens * 2,
    `at rest a core's Life keeps going - ${gens} generations in 12 s, alive in ${alive} of them, ${polar + equator} births - sparked from its heart, most at the poles (${polar} births polar, ${equator} round its equator)`);
}

// 3. Rubble filling its disc smothers it there; 4. a dead core's Life dies away.
{
  const fake = { x: fx, y: fy };
  for (let y = fy - 10; y <= fy + 10; y += 1) for (let x = fx - 10; x < fx; x += 1) PW.set(world, x, y, M.SAND, { quiet: true });
  ticks(fake, 60 * 4, 1);
  let left = 0, right = 0;
  for (let dy = -9; dy <= 9; dy += 1) for (let dx = -9; dx <= 9; dx += 1) if (CL.at(fake, dx, dy)) { if (dx < 0) left += 1; else right += 1; }
  for (let y = fy - 10; y <= fy + 10; y += 1) for (let x = fx - 10; x < fx; x += 1) PW.set(world, x, y, M.AIR, { quiet: true });
  const before = fake.lifeState.pop;
  ticks(fake, 60 * 2, 0);
  check(left === 0 && right > 0 && fake.lifeState.pop === 0,
    `rubble filling half a core's disc smothers its Life there (${left} live cells under the sand, ${right} in the open half); a dead core's Life dies away (${before} -> ${fake.lifeState.pop} live cells in 2 s)`);
}

// 5. A blast shakes it: the cores in its reach take the shock (PW.explode passes it on).
{
  let told = 0;
  const blast0 = CL.blast;
  CL.blast = (...a) => { told += 1; return blast0(...a); };
  pwApp.explode(fx, fy + 40, 6, 0.6);
  CL.blast = blast0;
  ticks(core, 60, 1);
  const st = core.lifeState, pop0 = st.pop, gen0 = st.gen;
  CL.blast(world, core.x + 12, core.y, 10, 1.2);
  const shock = st.shock;
  ticks(core, CL.EVERY, 1);
  let born = 0;
  for (let k = 0; k < st.a.length; k += 1) if (st.a[k] && st.age[k] === 0) born += 1;
  check(told === 1 && shock > 0.5 && st.stirred > 0 && st.gen === gen0 + 1,
    `a blast shakes the cores in its reach (PW.explode tells the core Life: ${told}): a blast 12 cells off strikes this one at ${shock.toFixed(2)} - its cells blown out and a burst of sparks thrown in (${pop0} live before, ${st.pop} after, ${born} newborn), stirred for a while`);
}

// 6. What it costs: a core's tick, and drawing twenty at zoom 8.
{
  const best = (n, each, work) => { let min = Infinity; for (let b = 0; b < n; b += 1) { const t0 = performance.now(); for (let k = 0; k < each; k += 1) work(); min = Math.min(min, (performance.now() - t0) / each); } return min; };
  const stepMs = best(5, 400, () => CL.step(world, core, 1));
  const r = { ctx: document.createElement('canvas').getContext('2d'), camera: { x: core.x - 50, y: core.y - 28, zoom: 8 }, view: { width: 800, height: 450 } };
  const drawMs = best(5, 10, () => { for (let k = 0; k < 20; k += 1) CL.draw(r, core); });
  check(stepMs < 0.02 && drawMs < 2, `a core's Life costs little: ${(stepMs * 1000).toFixed(1)} us a tick, ${drawMs.toFixed(2)} ms to draw twenty at zoom 8`);
}

// (a look: the cores stepped and drawn as pw-cores will, the world running)
{
  const list = () => { const out = []; for (const b of world.buildings || []) for (const c of b.cores || []) if (!c.standing && !c.dead) out.push(c); for (const s of world.seedCores || []) if (!s.building && !s.dead) out.push(s); return out; };
  const step0 = cores.step, draw0 = cores.draw;
  cores.step = (...a) => { const r = step0.apply(cores, a); for (const c of list()) CL.step(world, c, 1); return r; };
  cores.draw = (renderer) => { for (const c of list()) CL.draw(renderer, c); };
  pwApp.setPaused(false);
  pwApp.focus(core.x, core.y, 9);
  for (let t = 0; t < 12; t += 1) await sleep(100);
  shots.push(await shot('core-life'));
  cores.step = step0; cores.draw = draw0;
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
