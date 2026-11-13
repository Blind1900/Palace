'use strict';
// Development bootstrap for the pixel world: generate, simulate at a fixed 60 Hz step, render, and
// a sandbox tool bar (material brushes and blasts). Left drag uses the tool; right/middle drag pans.
(function () {
  const PW = window.PW;
  const params = new URL(window.location.href).searchParams;
  const canvas = document.getElementById('world-canvas');
  const status = document.getElementById('world-status');
  const toolbar = document.getElementById('world-tools');
  const seed = Number(params.get('seed')) || (Math.random() * 1e9) >>> 0;

  const timings = {};
  let t = performance.now();
  const world = PW.createWorld(16384, 4096);
  world.random = PW.createRandom(seed + 99);
  world.effects = [];
  timings.allocate = performance.now() - t; t = performance.now();
  const gallery = params.has('gallery');
  const gallerySet = params.get('gallery') === '1' ? 'population' : params.get('gallery');
  const layout = gallery ? PW.generateGallery(world, seed, gallerySet) : PW.generateTerrain(world, seed);
  timings.terrain = performance.now() - t; t = performance.now();
  // Settlements first (pads, buildings, mines), then wild growth on the final ground, then cave
  // formations.
  if (PW.generateSettlements && !gallery) {
    PW.generateSettlements(world, layout, seed);
    timings.settlements = performance.now() - t; t = performance.now();
  }
  if (PW.generateVegetation && !gallery) {
    PW.generateVegetation(world, layout, seed);
    timings.vegetation = performance.now() - t; t = performance.now();
  }
  if (PW.props && !gallery) {
    PW.props.decorateCaves(world, layout, PW.createRandom(seed + 313));
    timings.props = performance.now() - t; t = performance.now();
  }
  // Generation leaves the simulation idle: the world starts settled.
  world.activeList.length = 0;
  world.simActive.fill(0);
  for (let c = 0; c < world.chunkCount; c += 1) PW.clearSimRect(world, c);
  const renderer = PW.createRenderer(canvas, world, { seed });
  renderer.refreshOverview(Infinity);
  timings.overview = performance.now() - t;
  const sim = PW.createSim(world);
  const particles = PW.createParticles(world);
  // Bubbles the water simulation releases: one or two cells of pale air, rising to pop.
  const BUBBLE_COLORS = [PW.abgr(206, 232, 248, 230), PW.abgr(168, 210, 238, 210), PW.abgr(232, 244, 252, 240)];
  world.emitBubble = (x, y) => {
    const h = PW.hash3(x, y, world.tick);
    particles.spawn(x + 0.5, y + 0.5, ((h & 15) - 7.5) * 0.6, -2, 0, BUBBLE_COLORS[h % 3], PW.PARTICLE.BUBBLE, 25);
  };

  // ---- Sandbox tools -----------------------------------------------------------------------------
  const { M } = PW;
  const tools = {
    pan: null,
    water: () => M.WATER, sand: () => M.SAND, soil: () => M.LOOSE_SOIL,
    debris: () => M.DEBRIS | (world.random.int(0, 3) << 6), concrete: () => M.CONCRETE, erase: () => M.AIR,
    blastS: { radius: 22, power: 0.9 }, blastM: { radius: 48, power: 1.1 }, blastL: { radius: 90, power: 1.35 },
  };
  let tool = 'pan', brush = 10, paused = false;
  function paint(x, y, radius, make) {
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const cx = Math.round(x + dx), cy = Math.round(y + dy);
      if (!PW.inside(world, cx, cy)) continue;
      const id = PW.id(world, cx, cy);
      const value = make();
      if (id === M.BEDROCK) continue;
      if (value !== M.AIR && id !== M.AIR) continue;     // brushes only fill empty space
      PW.set(world, cx, cy, value);
    }
  }
  function explode(x, y, radius, power = 1) { return PW.explode(world, particles, { x, y, radius, power }); }
  // Dig a raw tunnel box for a side: it joins that side's network if it touches one, otherwise it
  // starts a new network rooted here. Another side's developed lining blocks it.
  let devSpeed = 1, lastDig = '';
  function dig(side, x0, y0, x1, y1) {
    let net = null;
    for (let y = Math.min(y0, y1) - 2; y <= Math.max(y0, y1) + 2 && !net; y += 1) {
      for (let x = Math.min(x0, x1) - 2; x <= Math.max(x0, x1) + 2; x += 1) {
        const found = PW.tunnels.networkAt(world, x, y);
        if (found && found.side === side) { net = found; break; }
      }
    }
    if (!net) net = PW.tunnels.createNetwork(world, { side, x: (x0 + x1) / 2, y: Math.max(y0, y1) });
    const result = PW.tunnels.digBox(world, net, x0, y0, x1, y1);
    lastDig = result.blocked ? `dig ${side}: blocked by developed lining` : `dig ${side}: ${result.cells} cells${result.breached.length ? ', broke into a raw tunnel' : ''}`;
    if (result.blocked) world.effects.push({ kind: 'flash', x: result.at.x, y: result.at.y, radius: 18, age: 0, life: 0.5 });
    return result;
  }
  if (toolbar) {
    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.tool) { tool = button.dataset.tool; toolbar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b === button)); }
      if (button.dataset.action === 'pause') { paused = !paused; button.classList.toggle('on', paused); }
      if (button.dataset.action === 'develop') { devSpeed = devSpeed === 1 ? 20 : 1; button.classList.toggle('on', devSpeed > 1); }
      if (button.dataset.action === 'step') stepWorld(1);
    });
    const size = toolbar.querySelector('#brush-size');
    if (size) size.addEventListener('input', () => { brush = Number(size.value); });
  }

  // ---- Input ------------------------------------------------------------------------------------
  const drag = { active: false, pan: false, x: 0, y: 0 };
  const toWorld = (event) => {
    const rect = canvas.getBoundingClientRect();
    return renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  };
  function useTool(event) {
    const p = toWorld(event);
    const spec = tools[tool];
    if (typeof spec === 'function') paint(p.x, p.y, brush, spec);
  }
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    drag.active = true; drag.x = event.clientX; drag.y = event.clientY;
    drag.pan = event.button !== 0 || tool === 'pan';
    canvas.setPointerCapture(event.pointerId);
    if (!drag.pan) {
      const spec = tools[tool];
      const p = toWorld(event);
      if (tool === 'digL' || tool === 'digR') dig(tool === 'digL' ? 'left' : 'right', Math.round(p.x - 30), Math.round(p.y - 18), Math.round(p.x + 30), Math.round(p.y + 18));
      else if (spec && typeof spec === 'object') explode(p.x, p.y, spec.radius, spec.power);
      else useTool(event);
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag.active) return;
    if (drag.pan) renderer.panByDevice((event.clientX - drag.x) * renderer.view.dpr, (event.clientY - drag.y) * renderer.view.dpr);
    else if (typeof tools[tool] === 'function') useTool(event);
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

  // ---- Loop: fixed 60 Hz simulation, render every frame -------------------------------------------
  const DT = 1 / 60;
  const simTimes = [];
  function stepWorld(n) {
    for (let k = 0; k < n; k += 1) {
      const s = performance.now();
      sim.step(3);
      particles.step(DT);
      if (PW.tunnels) PW.tunnels.step(world, DT * devSpeed);
      simTimes.push(performance.now() - s);
      if (simTimes.length > 240) simTimes.shift();
    }
  }
  let frames = 0, fpsClock = performance.now(), fps = 0, last = performance.now(), accumulator = 0;
  function frame(now) {
    accumulator = Math.min(accumulator + (now - last) / 1000, DT * 3);
    last = now;
    if (!paused) while (accumulator >= DT) { stepWorld(1); accumulator -= DT; }
    renderer.beginFrame();
    renderer.drawSky();
    renderer.drawBase();
    if (PW.drawUnitsHook) PW.drawUnitsHook(renderer);
    renderer.drawDeco();
    particles.draw(renderer);
    PW.drawEffects(world, renderer, (now - (frame.prev || now)) / 1000);
    frame.prev = now;
    frames += 1;
    if (now - fpsClock >= 500) {
      fps = frames * 1000 / (now - fpsClock);
      frames = 0; fpsClock = now;
      const s = renderer.stats();
      const sorted = simTimes.slice().sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
      status.textContent = `seed ${seed} | ${fps.toFixed(0)} fps | zoom ${s.zoom.toFixed(3)} | sim ${sim.stats.ms.toFixed(1)}ms ` +
        `(p95 ${p95.toFixed(1)}) active ${sim.stats.active} moves ${sim.stats.moves} | particles ${particles.count} | ` +
        `tunnels ${tunnelSummary()}${lastDig ? ` (${lastDig})` : ''} | ` +
        `gen ${Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' ')}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function tunnelSummary() {
    if (!world.tunnels) return '-';
    let cells = 0, developed = 0;
    for (const net of world.tunnels.networks) { cells += net.cells; developed += net.developed; }
    return `${cells ? Math.round(developed / cells * 100) : 0}% developed${devSpeed > 1 ? ' x20' : ''}`;
  }

  window.pwApp = { world, layout, renderer, sim, particles, seed, timings, ready: true,
    explode, dig, setDevelopSpeed: (k) => { devSpeed = k; },
    paint: (x, y, radius, material) => paint(x, y, radius, () => material),
    stepWorld, countWater: () => sim.countWater(), simTimes,
    setPaused: (value) => { paused = value; },
    focus: (x, y, zoomIndex) => renderer.focus(x, y, zoomIndex),
    focusWorld: (x, y, zoomIndex) => renderer.focus(x, y, zoomIndex),
    // Viewport (client) coordinates of a world cell, for real mouse input in harness scenarios.
    toClient: (x, y) => {
      const rect = canvas.getBoundingClientRect();
      const screen = renderer.worldToScreen(x + 0.5, y + 0.5);
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    } };
})();
