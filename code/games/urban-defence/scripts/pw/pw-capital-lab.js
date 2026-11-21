'use strict';
// N44: the capital-growth lab. A sandbox world holding every land mass the growth rules face -
// plain, rolling hills, a lake, a small pond, a plateau behind cliff steps, a mountain with a
// buildable shoulder, and a high plain - where capital, farm and military seeds are dropped by
// hand and grow at controllable speeds (pw-capital-growth). Left click drops the chosen seed;
// right/middle drag pans; SPEED buttons scale growth time only, physics stays 60 Hz.
(function () {
  const PW = window.PW;
  const { M } = PW;
  const params = new URL(window.location.href).searchParams;
  const canvas = document.getElementById('world-canvas');
  const status = document.getElementById('world-status');
  const toolbar = document.getElementById('world-tools');
  const seed = Number(params.get('seed')) || 7;
  // Engine switches from the URL, as in the live app: flags=NAME turns PW.NAME on,
  // flags=NAME:0 off, before anything is generated (probes A/B the lab with these).
  for (const f of (params.get('flags') || '').split(',')) {
    if (!f) continue;
    const [name, v] = f.split(':');
    PW[name] = v === undefined ? true : v !== '0';
  }

  const world = PW.createWorld(12288, 2304);
  world.random = PW.createRandom(seed + 99);
  world.effects = [];
  world.buildings = [];
  world.settlements = [];

  // ---- The lab's land -----------------------------------------------------------------------
  // Height control points, smoothstepped between: [x, surface row]. Slopes are tuned so the
  // hills stay ploughable, the lake and pond shores stay gentle (their water is the barrier),
  // and the cliff steps and mountain flanks read as mountain barriers.
  const CONTROLS = [
    [0, 1500], [2400, 1500],                                        // plain A
    [2550, 1494], [2700, 1454], [2950, 1518], [3200, 1464],         // rolling hills
    [3450, 1528], [3700, 1468], [3950, 1512], [4150, 1500],
    [4330, 1500], [4830, 1655], [5330, 1500],                       // the lake basin
    [5460, 1488], [6300, 1488],                                     // plain B...
    [6322, 1503], [6344, 1503], [6366, 1488],                       // ...with a small pond
    [7300, 1488],
    [7360, 1390], [7850, 1390],                                     // cliff step one, a shelf
    [7910, 1262], [8950, 1260],                                     // cliff step two, the plateau
    [9150, 1400],                                                   // the saddle under the mountain
    [9500, 1205], [9660, 1205],                                     // the mountain's shoulder shelf
    [9960, 830],                                                    // the peak
    [10260, 1240], [10500, 1395], [10700, 1450],                    // down the far flank
    [11600, 1480], [12287, 1495],                                   // high plain
  ];
  const LAKES = [{ x0: 4330, x1: 5330, top: 1500 }, { x0: 6300, x1: 6366, top: 1488 }];
  function surfaceAt(x) {
    let a = CONTROLS[0], b = CONTROLS[CONTROLS.length - 1];
    for (let i = 1; i < CONTROLS.length; i += 1) if (CONTROLS[i][0] >= x) { a = CONTROLS[i - 1]; b = CONTROLS[i]; break; }
    const t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
    const s = t * t * (3 - 2 * t);
    return a[1] + (b[1] - a[1]) * s;
  }
  function labTerrain() {
    const { mat, width: W, height: H } = world;
    for (let x = 0; x < W; x += 1) {
      const inLake = LAKES.some((l) => x >= l.x0 && x <= l.x1);
      const ripple = inLake ? 0 : ((PW.hash2(x >> 2, seed) & 7) - 3.5) * 0.45;
      const s = Math.round(surfaceAt(x) + ripple);
      const rocky = s < 1150;                       // bare stone high up the mountain
      for (let y = 0; y < H; y += 1) {
        let id;
        if (y < s) id = M.AIR;
        else if (y >= H - 26) id = M.BEDROCK;
        else if (rocky) id = M.STONE;
        else if (y < s + 3) id = M.GRASS;
        else if (y < s + 16) id = M.TOPSOIL;
        else if (y < s + 260) id = M.SOIL;
        else id = M.STONE;
        mat[y * W + x] = id | (PW.hash2(x >> 3, y >> 3) & 3) << 6;
      }
    }
    // The water: fill each basin up to its shore line.
    for (const lake of LAKES) {
      for (let x = lake.x0; x <= lake.x1; x += 1) {
        for (let y = lake.top; y < H - 26; y += 1) {
          const id = mat[y * W + x] & 63;
          if (id !== M.AIR) break;
          mat[y * W + x] = M.WATER;
        }
      }
    }
  }
  const timings = {};
  let t0 = performance.now();
  labTerrain();
  PW.rebuildGroundTop(world);
  world.surface0 = Int32Array.from(world.groundTop);
  timings.terrain = performance.now() - t0; t0 = performance.now();

  // Generation leaves the simulation idle: the world starts settled.
  world.activeList.length = 0;
  world.simActive.fill(0);
  for (let c = 0; c < world.chunkCount; c += 1) PW.clearSimRect(world, c);

  const renderer = PW.createRenderer(canvas, world, { seed });
  world.colorAt = renderer.colorAt;
  renderer.refreshOverview(Infinity);
  timings.overview = performance.now() - t0;
  world.windSeed = seed;

  const sim = PW.createSim(world);
  const particles = PW.createParticles(world);
  const heat = world.heatSystem = PW.createHeat(world);
  // D15: the cores' white IS the world's own Game of Life now (PS's half in pw-life) -
  // the lab runs the real module, so the discs, the repair's white foam and any future
  // LIFE play all share one simulation (coreLife's cores-only fallback steps aside).
  const life = PW.createLife ? PW.createLife(world) : null;
  world.particles = particles;
  const fragments = PW.createFragments ? PW.createFragments(world, particles) : null;
  const structure = fragments && PW.createStructure ? PW.createStructure(world, fragments) : null;
  world.fragments = fragments;
  // N73: the lab builds the way the game does - repair raises what the growth engine stages
  // (cores first, the body out of the translator). With no stock here, the translators work free.
  const repair = world.repair = PW.createRepair ? PW.createRepair(world, particles) : null;
  if (structure) {
    world.onDamage = (id) => { structure.notify(id); if (repair) repair.notify(id); };
    particles.listeners.chip = (owner) => { if (owner) { structure.notify(owner); if (repair) repair.notify(owner); } };
  }
  const cores = PW.createCores ? PW.createCores(world, particles) : null;
  const stability = world.stability = PW.createStability ? PW.createStability(world, particles) : null;
  const air = world.air = PW.createAir ? PW.createAir(world, particles) : null;
  // N75: the lab runs the one pipeline too. No settlements here, so build() lays nothing -
  // the FIRST seed founds the line, and every later seed threads the same bundle.
  const pipes = PW.createPipes && !PW.NO_LAB_PIPES ? PW.createPipes(world) : null;
  if (pipes) pipes.build();

  const growth = PW.createCapitalGrowth(world, { seed });

  // ---- Tools --------------------------------------------------------------------------------
  let tool = 'capital', style = 'modern', speed = 4, paused = PW.DETERMINISTIC;
  function explode(x, y, radius, power = 1) {
    const r = PW.explode(world, particles, { x, y, radius, power });
    if (cores && cores.supportLost) cores.supportLost(x - radius - 14, y - radius - 14, x + radius + 14, y + radius + 14);
    // N60: the growth system keeps clear of fresh craters - no restamp over a live collapse
    (world.labBlasts = world.labBlasts || []).push({ x, y, t: world.tick || 0 });
    if (world.labBlasts.length > 24) world.labBlasts.shift();
    return r;
  }
  const blasts = { blastS: { radius: 22, power: 0.9 }, blastM: { radius: 48, power: 1.1 } };
  if (toolbar) {
    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.tool) {
        tool = button.dataset.tool;
        toolbar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b === button));
      }
      if (button.dataset.style) {
        style = button.dataset.style;
        toolbar.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('on', b === button));
      }
      if (button.dataset.speed !== undefined) {
        speed = Number(button.dataset.speed);
        toolbar.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', b === button));
      }
      if (button.dataset.action === 'pause') { paused = !paused; button.classList.toggle('on', paused); }
      if (button.dataset.action === 'step') stepWorld(1);
      if (button.dataset.action === 'reset') window.location.reload();
      if (button.dataset.action === 'hitbox') { PW.debugHitboxes = !PW.debugHitboxes; button.classList.toggle('on', PW.debugHitboxes); }
    });
  }
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat || event.target.closest?.('input, textarea, select')) return;
    event.preventDefault();
    paused = !paused;
    const button = toolbar && toolbar.querySelector('[data-action="pause"]');
    if (button) button.classList.toggle('on', paused);
  });

  // ---- Input --------------------------------------------------------------------------------
  const drag = { active: false, pan: false, x: 0, y: 0 };
  const toWorld = (event) => {
    const rect = canvas.getBoundingClientRect();
    return renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  };
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    drag.active = true; drag.x = event.clientX; drag.y = event.clientY;
    drag.pan = event.button !== 0 || tool === 'pan';
    canvas.setPointerCapture(event.pointerId);
    if (drag.pan) return;
    const p = toWorld(event);
    if (blasts[tool]) { explode(p.x, p.y, blasts[tool].radius, blasts[tool].power); return; }
    if (tool === 'capital' || tool === 'farm' || tool === 'military') {
      const r = growth.drop(p.x, tool, style);
      if (PW.notify) PW.notify.flash(r.ok ? `${tool} seed dropped (${style})` : `No: ${r.note}`, r.ok ? 'good' : 'bad', 2.5);
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag.active) return;
    if (drag.pan) renderer.panByDevice((event.clientX - drag.x) * renderer.view.dpr, (event.clientY - drag.y) * renderer.view.dpr);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  const release = () => { drag.active = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const ax = (event.clientX - rect.left) * renderer.view.dpr, ay = (event.clientY - rect.top) * renderer.view.dpr;
    renderer.setZoomIndex(renderer.camera.zoomIndex + (event.deltaY < 0 ? 1 : -1), ax, ay);
  }, { passive: false });
  new ResizeObserver(() => renderer.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);

  // ---- Loop ---------------------------------------------------------------------------------
  const DT = 1 / 60;
  function stepWorld(n) {
    for (let k = 0; k < n; k += 1) {
      sim.step(3);
      particles.step(DT);
      heat.step(1);
      if (structure) structure.step(1.5);
      if (fragments) fragments.step(DT);
      if (cores) cores.step();
      // (repair and the pipeline ride the lab's speed, in step with the growth clock)
      if (repair) repair.step(DT * speed);
      if (pipes) pipes.step(DT * speed);
      if (PW.tanks) PW.tanks.step(world, DT);   // (N3 vehicle rule: tanks test the lab's streets;
      // N77 rounds step inside it - the lab stays the suites' bench, so no looped flag here)
      if (stability) stability.step();
      if (air) air.step();
      if (PW.stepSmokeBursts) PW.stepSmokeBursts(world, DT);
      if (PW.stepSmoulders) PW.stepSmoulders(world, DT);
      // N68: the lab steps the flora too - without this, a tree stranded by the growth's
      // earthworks (a regrade, a runway pad) never noticed its footing was gone and hung
      // in the air; the live world always stepped it.
      if (life) life.step();
      if (PW.flora && PW.flora.step) PW.flora.step(world, particles);
      growth.step(DT * speed);
    }
  }
  let frames = 0, fpsClock = performance.now(), fps = 0, last = performance.now(), accumulator = 0;
  function frame(now) {
    accumulator = Math.min(accumulator + (now - last) / 1000, DT * 3);
    last = now;
    if (!paused) {
      const t = performance.now();
      while (accumulator >= DT) {
        stepWorld(1); accumulator -= DT;
        if (performance.now() - t > 12) { accumulator = 0; break; }
      }
    }
    renderer.beginFrame();
    renderer.drawSky();
    renderer.drawBase();
    if (fragments) fragments.draw(renderer);
    renderer.drawDeco();
    if (renderer.drawLeaves) renderer.drawLeaves(now / 1000);   // N9: the crowns sway
    heat.draw(renderer, now / 1000);
    particles.draw(renderer);
    if (cores && cores.draw) cores.draw(renderer, now);
    if (life && life.draw) life.draw(renderer);   // (D15: the discs' white is the world Life)
    if (pipes) pipes.draw(renderer, now / 1000);   // (N75: the cargo moves in the lab too)
    growth.draw(renderer, now / 1000);
    if (PW.debugHitboxes && fragments && fragments.drawHitboxes) fragments.drawHitboxes(renderer);
    if (PW.drawUnitsHook) PW.drawUnitsHook(renderer);   // N77: the lab shows its tanks too
    PW.drawEffects(world, renderer, (now - (frame.prev || now)) / 1000);
    frame.prev = now;
    frames += 1;
    if (now - fpsClock >= 500) {
      fps = frames * 1000 / (now - fpsClock);
      frames = 0; fpsClock = now;
      status.textContent = `CAPITAL LAB seed ${seed} | ${fps.toFixed(0)} fps | growth x${speed}${paused ? ' (paused)' : ''} | ${growth.describe()}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.pwLab = { world, renderer, sim, particles, growth, seed, timings, ready: true,
    stepWorld, explode,
    // N75: every lab seed carries the one lab faction, so they all thread a single pipeline
    // (free of any purse - the lab has no stock).
    drop: (x, kind, s) => growth.drop(x, kind, s || style, 'lab'),
    setSpeed: (k) => { speed = k; },
    setPaused: (value) => { paused = value; },
    focus: (x, y, zoomIndex) => renderer.focus(x, y, zoomIndex) };
})();
