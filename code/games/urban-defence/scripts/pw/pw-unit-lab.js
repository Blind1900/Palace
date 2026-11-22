'use strict';
// N92: the tunnel and traversal lab. A hill between two plains with a course of tunnels under it,
// dug before your eyes from a portal on the left to an exit on the right - narrow hallways, a room
// (longer, its floor dipping to its middle, its roof higher: the user's room shape), low bumps of
// sandbags along a hallway's floor (cover for a man crouched behind them: the user's design), a
// crawl under a low roof, a ladder shaft down to a lower level, a slope, a natural cave the tunnel
// breaks into, a ladder shaft up, stairs out - and, off the lower level, a flooded sump with a room
// beyond it that no trooper will take (a flooded tunnel is no way). The tunnels are lined (developed)
// as they would be in the world, at the lab's speed. A squad of troopers is sent through the course
// as soon as it is dug, each finding its own way (PW.troops.goTo); click GO to send them anywhere.
// Until the world's own tunnel generation lays rooms and hallways this way (WGM's), the course is
// laid here; the traversal is the troopers' own.
(function () {
  const PW = window.PW;
  const { M } = PW;
  const params = new URL(window.location.href).searchParams;
  const canvas = document.getElementById('world-canvas');
  const status = document.getElementById('world-status');
  const toolbar = document.getElementById('world-tools');
  const seed = Number(params.get('seed')) || 7;
  for (const f of (params.get('flags') || '').split(',')) {
    if (!f) continue;
    const [name, v] = f.split(':');
    PW[name] = v === undefined ? true : v !== '0';
  }

  const world = PW.createWorld(6144, 2048);
  world.random = PW.createRandom(seed + 31);
  world.effects = [];
  world.buildings = [];
  world.settlements = [];

  // ---- The land: a plain, a broad hill, a plain; a cave in the hill -------------------------------------
  // (the hill's flanks are cliffs no man climbs: the way across is under it - a mech leaps them)
  const CONTROLS = [[0, 900], [1500, 900], [1520, 640], [2300, 610], [3300, 625], [4050, 640], [4070, 900], [6143, 900]];
  function surfaceAt(x) {
    let a = CONTROLS[0], b = CONTROLS[CONTROLS.length - 1];
    for (let i = 1; i < CONTROLS.length; i += 1) if (CONTROLS[i][0] >= x) { a = CONTROLS[i - 1]; b = CONTROLS[i]; break; }
    const t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
    return a[1] + (b[1] - a[1]) * t * t * (3 - 2 * t);
  }
  const CAVE = { x: 3350, y: 1085, a: 200, b: 65 };
  function labTerrain() {
    const { mat, width: W, height: H } = world;
    for (let x = 0; x < W; x += 1) {
      const s = Math.round(surfaceAt(x) + ((PW.hash2(x >> 2, seed) & 7) - 3.5) * 0.4);
      for (let y = 0; y < H; y += 1) {
        let id;
        if (y < s) id = M.AIR;
        else if (y >= H - 26) id = M.BEDROCK;
        else if (y < s + 3) id = M.GRASS;
        else if (y < s + 16) id = M.TOPSOIL;
        else if (y < s + 240) id = M.SOIL;
        else id = M.STONE;
        mat[y * W + x] = id | (PW.hash2(x >> 3, y >> 3) & 3) << 6;
      }
    }
    // (the cave: a rough-walled hollow, as the ground left it)
    for (let y = CAVE.y - CAVE.b - 6; y <= CAVE.y + CAVE.b + 6; y += 1) for (let x = CAVE.x - CAVE.a - 8; x <= CAVE.x + CAVE.a + 8; x += 1) {
      const ang = Math.atan2((y - CAVE.y) / CAVE.b, (x - CAVE.x) / CAVE.a), rough = 1 + 0.04 * Math.sin(ang * 7 + seed) + 0.025 * Math.sin(ang * 13 + 2 * seed);
      const d = ((x - CAVE.x) / CAVE.a) ** 2 + ((y - CAVE.y) / CAVE.b) ** 2;
      if (d < rough * rough) mat[y * W + x] = M.AIR;
    }
  }
  const timings = {};
  let t0 = performance.now();
  labTerrain();
  PW.rebuildGroundTop(world);
  world.surface0 = Int32Array.from(world.groundTop);
  timings.terrain = performance.now() - t0;
  world.activeList.length = 0;
  world.simActive.fill(0);
  for (let c = 0; c < world.chunkCount; c += 1) PW.clearSimRect(world, c);

  const renderer = PW.createRenderer(canvas, world, { seed });
  world.colorAt = renderer.colorAt;
  renderer.refreshOverview(Infinity);
  world.windSeed = seed;
  const sim = PW.createSim(world);
  const particles = PW.createParticles(world);
  const heat = world.heatSystem = PW.createHeat(world);
  world.particles = particles;
  const fragments = world.fragments = PW.createFragments ? PW.createFragments(world, particles) : null;
  const stability = world.stability = PW.createStability ? PW.createStability(world, particles) : null;
  const air = world.air = PW.createAir ? PW.createAir(world, particles) : null;

  // ---- The course: every dig in order, a strip at a time ---------------------------------------------------
  // (y: the row a trooper's feet stand on - the last open row over the floor; a hallway is 32 rows)
  const HALL = 32;
  const net = PW.tunnels.createNetwork(world, { side: 'left', style: params.get('style') || 'modern', x: 1500, y: 899, use: 'military' });
  const steps = [], marks = {};
  const box = (x0, y0, x1, y1, kind = 'drift') => steps.push({ box: [x0, y0, x1, y1, kind] });
  const mark = (name, x, y) => { marks[name] = { x, y }; };
  // (a hallway from x0 to x1, h tall, in strips - at the hill's face, a column at a time from the
  // surface down: the sky is not dug)
  const hall = (x0, x1, floor, h = HALL) => {
    for (let x = x0; x <= x1; x += 8) {
      const xe = Math.min(x1, x + 7), top = floor - h + 1;
      let open = false;
      for (let q = x; q <= xe; q += 1) if (world.groundTop[q] > top) open = true;
      if (!open) { box(x, top, xe, floor); continue; }
      for (let q = x; q <= xe; q += 1) { const tq = Math.max(top, world.groundTop[q]); if (tq <= floor) box(q, tq, q, floor); }
    }
  };
  // (stairs: from the top (x, y), two rows down for every three along, `dir`-ward, down to toY; dug
  // going down - or, `up`, the other way, from their foot)
  const stairs = (x, y, toY, dir, up = false) => {
    const out = [];
    while (y < toY) {
      const step = Math.min(2, toY - y), nx = x + dir * 3;
      out.push({ box: [Math.min(x, nx), y + step - HALL + 1, Math.max(x, nx), y + step, 'incline'] });
      x = nx; y += step;
    }
    if (up) out.reverse();
    steps.push(...out);
    return x;
  };
  // (a strip-by-strip floor: f(x) the floor row at x, h(x) how tall)
  const shaped = (x0, x1, f, h, w = 4) => { for (let x = x0; x <= x1; x += w) { const xe = Math.min(x1, x + w - 1); let fl = -Infinity, hh = 0; for (let q = x; q <= xe; q += 1) { fl = Math.max(fl, f(q)); hh = Math.max(hh, h(q)); } box(x, fl - hh + 1, xe, fl, 'room'); } };
  const PLAIN = 899, A = 999, B = 1159, B2 = 1119;
  // 1. The portal: an adit into the foot of the hill's cliff, then stairs down inside the hill.
  mark('start', 1000, PLAIN);
  hall(1490, 1560, PLAIN);
  const down = stairs(1560, PLAIN, A, 1);
  // 2. A hallway, then a room - longer, its floor dipping to its middle, its roof higher.
  hall(down, 1760, A);
  const dip = (x) => Math.round(12 * Math.sin(Math.PI * (x - 1760) / 250));
  shaped(1760, 2010, (x) => A + dip(x), (x) => 60 + dip(x));
  mark('room', 1885, A + 12);
  // 3. A hallway with bumps of sandbags along its floor: cover for a man crouched behind them.
  hall(2010, 2300, A);
  for (const x of [2080, 2160, 2240]) steps.push({ cover: [x, A] });
  mark('cover', 2160, A);
  // 4. A crawl under a low roof: 21 rows - a man crouched (17) gets through, standing (25) does not.
  hall(2300, 2420, A, 21);
  mark('crawl', 2360, A);
  // 5. A hallway to a ladder shaft down to the lower level.
  hall(2420, 2551, A);
  box(2552, A - HALL + 1, 2567, B, 'shaft');
  steps.push({ ladder: [2554, A + 1, B] });
  mark('shaftDown', 2560, A);
  // 6. The lower level: off to the left, a flooded sump with a room beyond it (no way through);
  // to the right, a hallway, a slope up, a short hallway into the cave.
  hall(2500, 2551, B);
  const sumpF = (x) => B + Math.round(40 * Math.sin(Math.PI * (2500 - x) / 120));
  shaped(2380, 2499, sumpF, () => HALL);
  hall(2300, 2379, B, 40);
  steps.push({ water: [2380, 2499, B + 1, sumpF] });
  mark('beyondSump', 2330, B);
  hall(2568, 2900, B);
  shaped(2900, 3099, (x) => B - Math.round(40 * (x - 2900) / 200), () => HALL);
  hall(3100, 3192, B2);
  mark('cave', CAVE.x, CAVE.y + CAVE.b);
  // 7. Out of the cave's far side, a hallway to a ladder shaft up to the first level.
  hall(3508, 3699, B2);
  box(3700, A - HALL + 1, 3715, B2, 'shaft');
  steps.push({ ladder: [3702, A + 1, B2] });
  mark('shaftUp', 3708, B2);
  // 8. A hallway, stairs up inside the hill, and an adit out through the foot of its far cliff.
  hall(3716, 3840, A);
  stairs(3990, PLAIN, A, -1, true);
  hall(3990, 4100, PLAIN);
  mark('exit', 4500, PLAIN);
  let dug = 0, digClock = 0;
  const DIG_RATE = 40;          // strips a second (at x1), as the miners go
  function digNext() {
    const s = steps[dug++];
    if (s.box) { const [x0, y0, x1, y1, kind] = s.box; PW.tunnels.digBox(world, net, x0, y0, x1, y1, { kind }); }
    else if (s.cover) {
      // (sandbags: 6 across, 16 high - a man crouched behind them is hidden; standing, his chest
      // shows over them)
      const [x, floor] = s.cover;
      for (let y = floor - 15; y <= floor; y += 1) for (let dx = -3; dx <= 2; dx += 1) {
        const c = ((x + dx + (y >> 1)) % 6 === 0 || y % 3 === 0) ? PW.abgr(150, 132, 92) : PW.abgr(176, 156, 112);
        PW.set(world, x + dx, y, M.COVER_SAND);
        PW.setLayer(world, 'paint', x + dx, y, c);
      }
    } else if (s.ladder) { const [x, y0, y1] = s.ladder; PW.settlementTools.ladder(world, x, y0, y1); }
    else if (s.water) {
      const [x0, x1, yTop, f] = s.water;
      for (let x = x0; x <= x1; x += 1) for (let y = yTop; y <= f(x); y += 1) if ((PW.get(world, x, y) & PW.ID_MASK) === M.AIR) PW.set(world, x, y, M.WATER);
    }
    if (dug === steps.length) onDug();
  }

  // ---- The squad ---------------------------------------------------------------------------------------------
  const squad = [];
  for (let k = 0; k < 4; k += 1) squad.push(PW.troops.create(world, { x: marks.start.x - k * 14 + 0.5, side: 'left', style: ['modern', 'asian', 'gothic', 'modern'][k], facing: 1 }));
  let sentAt = -1;
  function send(x, y, who = squad) {
    let n = 0;
    for (const t of who) if (!t.dead && PW.troops.goTo(world, t, x, y)) n += 1;
    return n;
  }
  function onDug() {
    timings.dug = world.tick || 0;
    // (drills left lying in the tunnels, for a trooper to pick up - as the world's are)
    if (PW.pickups) PW.pickups.placeDrills(world, PW.createRandom(seed + 727));
    if (params.get('go') !== '0') { sentAt = world.tick || 0; send(marks.exit.x, marks.exit.y); }
  }
  // A skirmish: a squad of ours and one of theirs meet down the long hallway, each fighting on its
  // own (PW.units' sentry): spotting, firing, getting down behind the bumps, a grenade round a corner.
  // (theirs come from the crawl's end; ours from the room)
  function skirmish(n = 4) {
    const made = { ours: [], theirs: [] };
    for (let k = 0; k < n; k += 1) {
      const a = PW.troops.create(world, { x: marks.cover.x - 120 - k * 12 + 0.5, y: marks.cover.y, side: 'left', style: 'modern', facing: 1, order: { type: 'auto', at: 0 } });
      const b = PW.troops.create(world, { x: marks.cover.x + 110 + k * 12 + 0.5, y: marks.cover.y, side: 'right', style: 'gothic', facing: -1, order: { type: 'auto', at: 0 } });
      made.ours.push(a); made.theirs.push(b);
    }
    return made;
  }

  // ---- Tools -------------------------------------------------------------------------------------------------------
  let tool = 'go', speed = 16, paused = PW.DETERMINISTIC, showRoutes = true;
  function explode(x, y, radius, power = 1) { return PW.explode(world, particles, { x, y, radius, power }); }
  if (toolbar) toolbar.addEventListener('click', (event) => {
    const b = event.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) { tool = b.dataset.tool; toolbar.querySelectorAll('[data-tool]').forEach((o) => o.classList.toggle('on', o === b)); }
    if (b.dataset.speed !== undefined) { speed = Number(b.dataset.speed); toolbar.querySelectorAll('[data-speed]').forEach((o) => o.classList.toggle('on', o === b)); }
    const a = b.dataset.action;
    if (a === 'pause') { paused = !paused; b.classList.toggle('on', paused); }
    if (a === 'step') stepWorld(1);
    if (a === 'routes') { showRoutes = !showRoutes; b.classList.toggle('on', showRoutes); }
    if (a === 'reset') window.location.reload();
    if (a === 'send') send(marks.exit.x, marks.exit.y);
    if (a === 'skirmish') { skirmish(); renderer.focus(marks.cover.x, marks.cover.y - 10, 4); }
  });
  window.addEventListener('keydown', (event) => {
    if (event.target.closest?.('input, textarea, select')) return;
    if (event.code === 'Space' && !event.repeat) { event.preventDefault(); paused = !paused; const b = toolbar && toolbar.querySelector('[data-action="pause"]'); if (b) b.classList.toggle('on', paused); return; }
    if (PW.troops.key(event)) event.preventDefault();
  });
  const drag = { active: false, pan: false, x: 0, y: 0, at: null };
  const toWorld = (event) => { const r = canvas.getBoundingClientRect(); return renderer.screenToWorld(event.clientX - r.left, event.clientY - r.top); };
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    drag.active = true; drag.x = event.clientX; drag.y = event.clientY;
    drag.pan = event.button !== 0 || tool === 'pan';
    canvas.setPointerCapture(event.pointerId);
    if (drag.pan) return;
    const p = toWorld(event);
    drag.at = p;
    if (tool === 'go') {
      const n = send(p.x, p.y);
      if (PW.notify) PW.notify.flash(n ? `${n} troopers on their way` : 'No way there', n ? 'good' : 'bad', 2);
    } else if (tool === 'troop') PW.troops.tool(world, p.x, p.y, event.shiftKey);
    // (a sentry of theirs: holding where it stands, firing at ours it sees - see PW.units)
    else if (tool === 'enemy') { const t = PW.troops.tool(world, p.x, p.y, true); if (t) { t.side = 'right'; t.facing = -1; t.style = 'gothic'; PW.troops.hold(null); PW.units.order(world, t, { type: 'hold' }); } }
    else if (tool === 'miner') { const t = PW.troops.tool(world, p.x, p.y, true); if (t) { t.unit = 'miner'; t.look = 'miner'; t.drill = 1; t.grenades = 0; t.slot = 'drill'; t.side = 'left'; } }
    else if (tool === 'water') { for (let y = Math.round(p.y) - 10; y <= Math.round(p.y) + 10; y += 1) for (let x = Math.round(p.x) - 10; x <= Math.round(p.x) + 10; x += 1) if ((PW.get(world, x, y) & PW.ID_MASK) === M.AIR) PW.set(world, x, y, M.WATER); }
    else if (tool === 'blast') explode(p.x, p.y, 12, 0.9);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag.active) return;
    if (drag.pan) renderer.panByDevice((event.clientX - drag.x) * renderer.view.dpr, (event.clientY - drag.y) * renderer.view.dpr);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  const release = (event) => {
    if (drag.active && !drag.pan && tool === 'dig' && drag.at) {
      const p = toWorld(event), a = drag.at;
      PW.tunnels.digBox(world, net, Math.min(a.x, p.x), Math.min(a.y, p.y), Math.max(a.x, p.x), Math.max(a.y, p.y));
    }
    drag.active = false;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { drag.active = false; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const r = canvas.getBoundingClientRect();
    renderer.setZoomIndex(renderer.camera.zoomIndex + (event.deltaY < 0 ? 1 : -1), (event.clientX - r.left) * renderer.view.dpr, (event.clientY - r.top) * renderer.view.dpr);
  }, { passive: false });
  new ResizeObserver(() => renderer.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);

  // ---- Loop ---------------------------------------------------------------------------------------------------------
  const DT = 1 / 60;
  function stepWorld(n) {
    for (let k = 0; k < n; k += 1) {
      // (the miners, at the lab's speed)
      if (dug < steps.length) { digClock += DT * speed * DIG_RATE / 16; while (digClock >= 1 && dug < steps.length) { digClock -= 1; digNext(); } }
      PW.tunnels.step(world, DT * speed);
      sim.step(3);
      particles.step(DT);
      heat.step(1);
      if (fragments) fragments.step(DT);
      PW.tanks.step(world, DT);   // (the units and their rounds step inside it - see pw-tank)
      if (stability) stability.step();
      if (air) air.step();
      if (PW.stepSmokeBursts) PW.stepSmokeBursts(world, DT);
      if (PW.stepSmoulders) PW.stepSmoulders(world, DT);
    }
  }
  // (the way each trooper is going: dots along its legs)
  function drawRoutes() {
    const { ctx, camera } = renderer, z = camera.zoom;
    ctx.fillStyle = 'rgba(232,214,120,0.85)';
    for (const t of world.troops || []) {
      if (!t.route || t.dead) continue;
      let px = t.x, py = t.y - 2;
      for (let q = t.route.at; q < t.route.legs.length; q += 1) {
        const l = t.route.legs[q], qx = l.x + 0.5, qy = l.y - 2, len = Math.hypot(qx - px, qy - py), n = Math.ceil(len / 8);
        for (let s = 0; s <= n; s += 1) { const x = px + (qx - px) * s / Math.max(1, n), y = py + (qy - py) * s / Math.max(1, n); ctx.fillRect(Math.round((x - camera.x) * z) - 1, Math.round((y - camera.y) * z) - 1, 2, 2); }
        px = qx; py = qy;
      }
    }
  }
  let frames = 0, fpsClock = performance.now(), fps = 0, last = performance.now(), accumulator = 0;
  function frame(now) {
    accumulator = Math.min(accumulator + (now - last) / 1000, DT * 3);
    last = now;
    if (!paused) {
      const t = performance.now();
      while (accumulator >= DT) { stepWorld(1); accumulator -= DT; if (performance.now() - t > 12) { accumulator = 0; break; } }
    }
    renderer.beginFrame();
    renderer.drawSky();
    renderer.drawBase();
    if (fragments) fragments.draw(renderer);
    renderer.drawDeco();
    heat.draw(renderer, now / 1000);
    particles.draw(renderer);
    if (PW.drawUnitsHook) PW.drawUnitsHook(renderer);
    if (showRoutes) drawRoutes();
    PW.drawEffects(world, renderer, (now - (frame.prev || now)) / 1000);
    frame.prev = now;
    frames += 1;
    if (now - fpsClock >= 500) {
      fps = frames * 1000 / (now - fpsClock); frames = 0; fpsClock = now;
      const ours = (world.troops || []).filter((t) => t.side === 'left' && !t.dead);
      status.textContent = `TUNNEL LAB seed ${seed} | ${fps.toFixed(0)} fps | x${speed}${paused ? ' (paused)' : ''} | dug ${dug}/${steps.length}`
        + (net.cells ? ` | lined ${Math.round(100 * net.developed / net.cells)}%` : '')
        + ` | troopers ${ours.length}, under cover ${ours.filter((t) => PW.troops.underground(world, t)).length}, on their way ${ours.filter((t) => t.route).length}, arrived ${ours.filter((t) => t.arrived && !t.route).length}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  renderer.focus(marks.start.x + 400, 880, 2);

  window.pwLab = { world, renderer, sim, particles, seed, timings, ready: true, net, steps, marks, squad, CAVE,
    stepWorld, explode, send, skirmish, sentAt: () => sentAt, dug: () => dug, digAll: () => { while (dug < steps.length) digNext(); },
    setSpeed: (k) => { speed = k; }, setPaused: (v) => { paused = v; }, focus: (x, y, zoomIndex) => renderer.focus(x, y, zoomIndex) };
})();
