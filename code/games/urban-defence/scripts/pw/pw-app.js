'use strict';
// Development bootstrap for the pixel world: generate, simulate at a fixed 60 Hz step, render, and
// a sandbox tool bar (material brushes and blasts). Left drag uses the tool; right/middle drag pans.
// N6: the same bootstrap runs the game. mode=game (or a page that sets PW.GAME_PAGE first, as the
// game's own page does) opens on the match menu instead, makes the world chosen there behind a
// loading screen, and hands the match to PW.game (its rules and the computer players) and
// PW.gameUI (the menu, the HUD and the game bar); the sandbox tools stay on the dev page.
(function () {
  const PW = window.PW;
  const params = new URL(window.location.href).searchParams;
  const canvas = document.getElementById('world-canvas');
  const status = document.getElementById('world-status');
  const toolbar = document.getElementById('world-tools');
  const gameMode = params.get('mode') === 'game' || !!PW.GAME_PAGE;
  // Engine switches from the URL, for the labs and the suite runner: flags=PIPE_CAVITY turns
  // PW.PIPE_CAVITY on (flags=REBUILD_RUINS:0 turns one off) before anything is generated.
  for (const f of (params.get('flags') || '').split(',')) {
    if (!f) continue;
    const [name, v] = f.split(':');
    PW[name] = v === undefined ? true : v !== '0';
  }

  // The world and the systems that work it, made by the generation stages below.
  let seed = 0, world = null, layout = null, gallery = false, pipes = null, renderer = null;
  let sim = null, particles = null, heat = null, life = null, fragments = null, structure = null;
  let repair = null, cores = null, growth = null, capital = null, stability = null, air = null;
  let match = null;   // N6: the match on the game page (PW.game), null on the dev page
  const timings = {};

  // ---- Generation, in stages -------------------------------------------------------------------
  // Making the world is a fixed list of stages, run in order. The dev page runs them back to back
  // as it loads; the game page runs one a frame behind its loading screen (N8). Nothing else runs
  // in between, so it is the same world either way.
  function genStages(opts) {
    seed = opts.seed;
    gallery = opts.gallery !== null && opts.gallery !== undefined;   // (?gallery, with or without a set)
    const gallerySet = opts.gallery === '1' ? 'population' : opts.gallery;
    const wild = () => !gallery;
    return [
      { name: 'allocate', label: 'Laying out the map', run() {
        // 2.2 times the first map's width (16384), in whole chunks: room for the towns to spread into.
        world = PW.createWorld(opts.width || 36096, 4096);
        world.random = PW.createRandom(seed + 99);
        world.effects = [];
      } },
      { name: 'terrain', label: 'Shaping the land', run() {
        layout = gallery ? PW.generateGallery(world, seed, gallerySet) : PW.generateTerrain(world, seed);
      } },
      // Settlements first (pads, buildings, mines), then wild growth on the final ground, then cave
      // formations.
      { name: 'settlements', label: 'Founding the towns', when: () => wild() && PW.generateSettlements, run() {
        // (N115: the test's sides found their own; N118: the person's side in its chosen aesthetic)
        // (N120: a match's sides start with no territory - no home towns - unless towns=1, the suites'
        // fixtures; the sandbox keeps them)
        PW.generateSettlements(world, layout, seed, { homes: opts.homes !== false, style: opts.style || null });
        if (PW.bunkers) PW.bunkers.generate(world, layout, seed);
      } },
      { name: 'vegetation', label: 'Growing the wilds', when: () => wild() && PW.generateVegetation, run() {
        PW.generateVegetation(world, layout, seed);
      } },
      { name: 'props', label: 'Furnishing the caves', when: () => wild() && PW.props, run() {
        PW.props.decorateCaves(world, layout, PW.createRandom(seed + 313));
      } },
      // Supply lines under each base, connecting its buildings, pump and mining operations (and
      // first the drills left here and there in the tunnels, for troops to pick up).
      { name: 'pipes', label: 'Laying the supply lines', run() {
        if (PW.pickups && !gallery) PW.pickups.placeDrills(world, PW.createRandom(seed + 727));
        pipes = PW.createPipes ? PW.createPipes(world) : null;
        if (pipes && !gallery) pipes.build();
      } },
      // Made ground under the towns, down to their supply lines.
      { name: 'urban', label: 'Making the ground under the towns', when: () => wild() && PW.urban, run() {
        world.madeGround = PW.urban.lay(world);
      } },
      { name: 'overview', label: 'Drawing the map', run() {
        // With the world finally standing, every pump's cells become its repair print (N50).
        if (PW.capturePumpPrints && !gallery) PW.capturePumpPrints(world);
        // Generation leaves the simulation idle: the world starts settled.
        world.activeList.length = 0;
        world.simActive.fill(0);
        for (let c = 0; c < world.chunkCount; c += 1) PW.clearSimRect(world, c);
        renderer = PW.createRenderer(canvas, world, { seed });
        world.colorAt = renderer.colorAt;
        renderer.refreshOverview(Infinity);
      } },
      { name: 'systems', label: 'Starting the world', run: makeSystems },
    ];
  }
  function runStage(stage) {
    const t = performance.now();
    stage.run();
    timings[stage.name] = performance.now() - t;
  }
  const due = (stage) => !stage.when || stage.when();
  // (back to back: the dev page)
  function generateNow(opts) {
    for (const stage of genStages(opts)) if (due(stage)) runStage(stage);
  }
  // (one a frame, reporting each before it runs so the loading screen shows what is under way)
  async function generateStaged(opts, progress) {
    const stages = genStages(opts);
    for (let i = 0; i < stages.length; i += 1) {
      if (!due(stages[i])) continue;
      if (progress) progress(i / stages.length, stages[i].label);
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      runStage(stages[i]);
    }
    if (progress) progress(1, 'Ready');
  }

  // The systems that work the world once it is made.
  function makeSystems() {
    world.windSeed = seed;
    sim = PW.createSim(world);
    particles = PW.createParticles(world);
    heat = world.heatSystem = PW.createHeat(world);
    life = PW.createLife(world);
    world.particles = particles;
    // Damage brings buildings down: blasts and flying debris report the cells they break, the
    // structure is analysed and what fails falls as rigid pieces.
    fragments = PW.createFragments ? PW.createFragments(world, particles) : null;
    structure = fragments && PW.createStructure ? PW.createStructure(world, fragments) : null;
    world.fragments = fragments;   // (trees and boughs that break off fall as rigid pieces too)
    // Repair through the cores: a damaged building rebuilds itself from its blueprint (step F).
    repair = world.repair = PW.createRepair ? PW.createRepair(world, particles) : null;
    if (structure) {
      world.onDamage = (id) => { structure.notify(id); if (repair) repair.notify(id); };
      particles.listeners.chip = (owner) => { if (owner) { structure.notify(owner); if (repair) repair.notify(owner); } };
    }
    // A ruined building's cores lie open in their vaults, kept clear of rubble.
    cores = PW.createCores ? PW.createCores(world, particles) : null;
    // The city grows by itself: seeds carried past the street's end, towers grown by repair (step H).
    growth = PW.createGrowth && !gallery ? PW.createGrowth(world) : null;
    // N2/N3: the capital-growth engine in the live world - the whole lab system (rings, levels,
    // spacing, earthworks, farms, military spread, merge joints) runs any city dropped with the
    // SEED tools. Idle until a seed lands: with no cities its step is a no-op, so nothing in the
    // world changes until the player plants one.
    capital = PW.createCapitalGrowth && !gallery ? PW.createCapitalGrowth(world, { seed }) : null;
    if (capital) world.capitalGrowth = capital;
    // N3: the standing worldgen towns join the growth engine (level-ups, infill, joints and
    // appends like any seed city). Default OFF (flags=ADOPT_TOWNS turns it on): the adopted
    // towns' aging re-seats out-churn the bundle mend on their long worldgen lines - until a
    // re-seat heals its own cut (rather than leaving it for the slow crews), adoption stays
    // behind the flag. The groundwork, the crash guards and the richer mend draught ship on.
    // N3: ON by default since the adoption-era pipe freeze fell (a re-seat heals its own cut -
    // releaseBuilding lays the leaving bed's span, connectCore clears its window; the frozen
    // pool of ~350 breaks drained to ~13 on the seed-7 probe). flags=STANDING_TOWNS turns it off.
    if (capital && PW.ADOPT_TOWNS !== false && !PW.STANDING_TOWNS) capital.adoptSettlements();
    // N103: the world's own turret bases - before its military on the land, in its bases' rooms
    // (laid once the towns have joined the growth: their grading would take a plate laid before).
    // The game's world only: the sandbox is the physics' bench, its ground as it was made.
    if (PW.mounts && !gallery && gameMode) world.mountsSeeded = PW.mounts.seed(world);
    // Ground that loses its footing breaks loose: cave-ins, landslides and avalanches.
    stability = world.stability = PW.createStability ? PW.createStability(world, particles) : null;
    // Air pressure and wind, worked only where a blast has stirred it.
    air = world.air = PW.createAir ? PW.createAir(world, particles) : null;
    // Bubbles the water simulation releases: one or two cells of pale air, rising to pop.
    const BUBBLE_COLORS = [PW.abgr(206, 232, 248, 230), PW.abgr(168, 210, 238, 210), PW.abgr(232, 244, 252, 240)];
    world.emitBubble = (x, y) => {
      const h = PW.hash3(x, y, world.tick);
      particles.spawn(x + 0.5, y + 0.5, ((h & 15) - 7.5) * 0.6, -2, 0, BUBBLE_COLORS[h % 3], PW.PARTICLE.BUBBLE, 25);
    };
  }

  // ---- Sandbox tools -----------------------------------------------------------------------------
  const { M } = PW;
  const tools = {
    pan: null,
    water: () => M.WATER, sand: () => M.SAND, soil: () => M.LOOSE_SOIL,
    debris: () => M.DEBRIS | (world.random.int(0, 3) << 6), concrete: () => M.CONCRETE, erase: () => M.AIR,
    blastS: { radius: 22, power: 0.9 }, blastM: { radius: 32, power: 1.1 }, blastL: { radius: 90, power: 1.35 },   // (N142, the user's: the medium blast 32)
    smoke: () => M.SMOKE | 3 << 6,
  };
  // Torch: heat the brush disc to flame temperature (ignites grass, plants and wood; boils water).
  const torch = (x, y) => heat.heatDisc(x, y, Math.max(3, brush), 900);
  // (a deterministic run - see PW.DETERMINISTIC - starts paused: the world steps only when it is
  // told to, never by however many frames happen to pass before a test takes hold of it)
  let tool = 'pan', brush = 10, paused = PW.DETERMINISTIC;
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
  function explode(x, y, radius, power = 1) {
    const r = PW.explode(world, particles, { x, y, radius, power });
    // (the growth engine's storm cover reads recent blasts from this ring - as the lab feeds it)
    (world.labBlasts = world.labBlasts || []).push({ x, y, t: world.tick || 0 });
    if (world.labBlasts.length > 24) world.labBlasts.shift();
    // (the lines look at the struck columns next tick instead of waiting for the watch window)
    if (pipes && pipes.notifyDamage) pipes.notifyDamage(x - radius - 14, x + radius + 14);
    // (and any core or seed near the blast looks at its support - N18O, event-driven)
    if (cores && cores.supportLost) cores.supportLost(x - radius - 14, y - radius - 14, x + radius + 14, y + radius + 14);
    return r;
  }
  // Dig a raw tunnel box for a side: it joins that side's network if it touches one, otherwise it
  // starts a new network rooted here. Another side's developed lining blocks it.
  let devSpeed = 1, lastDig = '';
  const TEST_BUILD_SPEED = 4;   // N115: the gameplay test builds four times as fast (the user's)
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
    // Reaching a vein opens a mining operation there.
    if (result.ok && PW.mining) {
      const op = PW.mining.afterDig(world, net, { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
      if (op && !op.blocked) {
        if (pipes) pipes.attach(op);
        result.operation = op;
        lastDig += ', mining operation opened';
        if (PW.notify) PW.notify.flash(`Mining operation opened on an HM ${op.node.tier}`, 'good', 3);
      }
    }
    return result;
  }
  // (roads are laid by the towns as they grow, never by hand)
  // Planning a dig with the DIG tools: what the tunnel at the cursor would do.
  const preview = { box: null, node: null, note: '', tone: '' };
  function planDig(side, p) {
    const box = { x0: Math.round(p.x - 30), y0: Math.round(p.y - 18), x1: Math.round(p.x + 30), y1: Math.round(p.y + 18) };
    preview.box = box; preview.node = null;
    let blocked = false, breach = false;
    for (let y = box.y0; y <= box.y1 && !blocked; y += 2) for (let x = box.x0; x <= box.x1; x += 2) {
      const net = PW.tunnels.networkAt(world, x, y);
      if (!net || net.side === side) continue;
      if ((PW.get(world, x, y) & 63) === PW.M.REINFORCED) { blocked = true; break; }
      breach = true;
    }
    const hit = !blocked && PW.mining ? PW.mining.veinNear(world, box) : null;
    if (blocked) { preview.note = 'Blocked: enemy tunnel lining (developed)'; preview.tone = 'bad'; }
    else if (hit) {
      preview.node = hit.node;
      preview.note = `Reaches HM ${hit.node.tier} (~${hit.node.amount} ore) - opens a mining operation`;
      preview.tone = 'good';
    } else if (breach) { preview.note = 'Breaks into an enemy raw tunnel'; preview.tone = 'bad'; }
    else { preview.note = 'Dig raw tunnel (develops over time)'; preview.tone = ''; }
    if (PW.notify) PW.notify.cursor(preview.note, preview.tone);
  }
  function drawPreview(time) {
    if (!preview.box) return;
    const { ctx, camera } = renderer, z = camera.zoom, size = Math.max(1, Math.round(z));
    if (preview.node && PW.mining) PW.mining.drawHighlight(renderer, world, preview.node, time);
    // The tunnel to be dug, as a dashed cell outline.
    const b = preview.box;
    ctx.fillStyle = preview.tone === 'bad' ? 'rgba(255,120,100,0.85)' : 'rgba(255,236,170,0.85)';
    ctx.beginPath();
    for (let x = b.x0; x <= b.x1; x += 1) if ((x & 3) < 2) { ctx.rect(Math.round((x - camera.x) * z), Math.round((b.y0 - camera.y) * z), size, size); ctx.rect(Math.round((x - camera.x) * z), Math.round((b.y1 - camera.y) * z), size, size); }
    for (let y = b.y0; y <= b.y1; y += 1) if ((y & 3) < 2) { ctx.rect(Math.round((b.x0 - camera.x) * z), Math.round((y - camera.y) * z), size, size); ctx.rect(Math.round((b.x1 - camera.x) * z), Math.round((y - camera.y) * z), size, size); }
    ctx.fill();
  }
  if (toolbar) {
    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.tool) {
        tool = button.dataset.tool;
        toolbar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b === button));
        if (tool !== 'digL' && tool !== 'digR') { preview.box = null; preview.node = null; if (PW.notify) PW.notify.clear(); }
      }
      if (button.dataset.action === 'pause') { paused = !paused; button.classList.toggle('on', paused); }
      if (button.dataset.action === 'develop') { devSpeed = devSpeed === 1 ? 20 : 1; button.classList.toggle('on', devSpeed > 1); }
      if (button.dataset.action === 'step') stepWorld(1);
      // (the physics debug view: hitboxes, green to red by how hard they are struck - see pw-fragments)
      if (button.dataset.action === 'hitbox') { PW.debugHitboxes = !PW.debugHitboxes; button.classList.toggle('on', PW.debugHitboxes); }
    });
    const size = toolbar.querySelector('#brush-size');
    if (size) size.addEventListener('input', () => { brush = Number(size.value); });
  }
  // The held unit's keys, pressed and let go (N102: a unit moves only while its key is held - so
  // its module hears the key come up as well as go down). The drive keys follow the SELECTED tank
  // too, not only the tank tool (N78); the troops', jets', batteries' and mechs' modules each
  // answer only for the unit they hold, and selection holds one at a time.
  function unitKey(event) {
    if ((tool === 'tank' || (selected && selected.kind === 'tank'))
      && PW.tanks && PW.tanks.key && PW.tanks.key(event)) return true;   // (N10 drive keys)
    for (const mod of [PW.troops, PW.jets, PW.defence, PW.mechs]) {
      if (mod && mod.key && mod.key(event)) return true;
    }
    return false;
  }
  // P pauses and resumes, as the PAUSE button does (Space is a unit's jump since N102).
  window.addEventListener('keydown', (event) => {
    if (!world) return;   // (the game page's menu and loading screen come first)
    if (event.code === 'F3') { event.preventDefault(); togglePerf(); return; }   // N8: the costs
    // N78 (in a match the game's hand lets the selection go - its selection and the one in hand together)
    if (event.code === 'Escape' && selected && !match) { select(null); return; }
    if (event.target.closest?.('input, textarea, select')) return;
    // (N6: a key a held unit takes puts it in the person's hands - off its own way for a while)
    if (unitKey(event)) { event.preventDefault(); if (match && PW.gameUI) PW.gameUI.tookControl(); return; }
    // N6: the game's own keys (pan the view, put the selection down)
    if (match && PW.gameUI && PW.gameUI.key(event)) { event.preventDefault(); return; }
    if (event.code === 'Space') { event.preventDefault(); return; }   // (never a focused button's press)
    if (event.code !== 'KeyP' || event.repeat) return;
    event.preventDefault();
    paused = !paused;
    const button = toolbar && toolbar.querySelector('[data-action="pause"]');
    if (button) button.classList.toggle('on', paused);
  });
  window.addEventListener('keyup', (event) => {
    if (!world || event.target.closest?.('input, textarea, select')) return;
    if (unitKey(event) || event.code === 'Space') event.preventDefault();
  });
  // (a key let go outside the window would leave a unit walking: on losing the focus, let go)
  window.addEventListener('blur', () => {
    for (const mod of [PW.troops, PW.tanks, PW.mechs, PW.jets]) if (mod && mod.release) mod.release();
  });

  // ---- N78: unit selection --------------------------------------------------------------------
  // Click a unit to select it: a pulsing bracket marks it in the world, and the side panel
  // shows what it is, how it stands, and its control keys. Tanks are the units standing
  // today; ground troops join the same panel - with their item bar - when their entities
  // land (M5/M6). Selecting a tank also takes it in hand (PS's PW.tanks.hold), so the
  // drive keys follow the selection.
  const unitPanel = document.getElementById('unit-panel');
  const TANK_NAMES = { modern: 'M1 ABRAMS', asian: 'TYPE 99', gothic: 'T-64' };
  // (N118: in the game an aesthetic goes by its letter - R, B, P - the sandbox keeps the names)
  const styleTag = (s) => (gameMode && PW.gameUI && PW.gameUI.STYLE_LETTER && PW.gameUI.STYLE_LETTER[s]) || (s || '').toUpperCase();
  const DEFENCE_NAMES = { launcher: 'ROCKET LAUNCHER', dome: 'IRON DOME', patriot: 'PATRIOT', turret: 'TURRET' };
  let selected = null;   // { kind: 'tank' | 'troop' | 'jet' | 'defence', t }
  // Every unit kind the selection knows (PS's modules, one API each): its list on the world,
  // its module, the box a click finds it by and the box its bracket frames. The small ones
  // come first - a trooper beside a tank is the one picked.
  const defenceBox = (u) => {
    const half = ((PW.defence && PW.defence.TYPES[u.type]) || { length: 100 }).length / 2;
    return [u.x - half, u.y - 30, u.x + half, u.y];
  };
  const UNITS = [
    { kind: 'troop', list: () => world.troops, mod: () => PW.troops,
      box: (t) => [t.x - 6, t.y - (t.crouch ? 19 : 27), t.x + 6, t.y + 3] },
    { kind: 'mech', list: () => world.mechs, mod: () => PW.mechs,
      box: (m) => [m.x - 18, m.y - ((PW.mechs && PW.mechs.HEIGHT) || 74) - (m.lift || 0), m.x + 18, m.y + 3] },
    { kind: 'jet', list: () => world.jets, mod: () => PW.jets,
      box: (j) => { const half = ((PW.jets && PW.jets.LENGTH) || 150) / 2 + 3; return [j.x - half, j.y - 22, j.x + half, j.y + 20]; } },
    { kind: 'defence', list: () => world.defence, mod: () => PW.defence,
      box: (u) => { const [x0, y0, x1, y1] = defenceBox(u); return [x0 - 2, y0 - 20, x1 + 2, y1 + 3]; } },
    { kind: 'tank', list: () => world.tanks, mod: () => PW.tanks,
      box: (t) => [t.x - 64, t.y - 50, t.x + 64, t.y + 8] },
  ];
  const unitAt = (x, y) => {
    for (const U of UNITS) {
      for (const t of U.list() || []) {
        if (t.dead) continue;
        const [x0, y0, x1, y1] = U.box(t);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { kind: U.kind, t };
      }
    }
    return null;
  };
  function renderUnitPanel() {
    if (!unitPanel) return;
    if (!selected) { unitPanel.classList.remove('on'); unitPanel.innerHTML = ''; return; }
    unitPanel.classList.add('on');
    if (selected.kind === 'tank') {
      const t = selected.t;
      const hp = Math.max(0, Math.round(t.hp ?? 100));
      const tone = hp < 30 ? 'grave' : hp < 60 ? 'hurt' : '';
      const state = t.blocked ? `stopped: ${t.blocked}` : (t.reload || 0) > 0.05 ? `reloading ${t.reload.toFixed(1)}s` : 'ready';
      unitPanel.innerHTML = `<h3>${TANK_NAMES[t.style] || (t.style || 'tank').toUpperCase()} — ${(t.side || '').toUpperCase()}</h3>` +
        `<div>armour ${hp}/100</div><div class="bar"><i class="${tone}" style="width:${hp}%"></i></div>` +
        `<div>round <kbd>${(t.ammo || 'he').toUpperCase()}</kbd> · ${state}</div>` +
        `<div class="keys">` +
        `<div><kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd> drive (held)</div>` +
        `<div><kbd>S</kbd><kbd>↓</kbd> stop</div>` +
        `<div>left click: aim + fire there</div><div>right click: other round</div>` +
        `<div><kbd>F</kbd> fire <kbd>R</kbd> HE/AP</div>` +
        `<div><kbd>P</kbd> pause <kbd>Esc</kbd> free</div>` +
        `</div>`;
    } else if (selected.kind === 'troop') {
      // The trooper's item bar: the loadout the user designed (rifle, grenades, drills),
      // read off the entity (PS's PW.troops).
      const u = selected.t, hp = Math.max(0, Math.round(u.hp ?? 100));
      const tone = hp < 30 ? 'grave' : hp < 60 ? 'hurt' : '';
      const state = u.climbing ? 'on a ladder' : u.swim ? 'swimming' : u.crouch ? 'crouched' : (u.reload || 0) > 0.05 ? `reloading ${u.reload.toFixed(1)}s` : 'ready';
      const items = [{ n: 'RIFLE', count: `${u.mag ?? 0}/${u.ammo ?? 0}` }, { n: 'GRND', count: u.grenades ?? 0 }, { n: 'DRILL', count: '' }];
      unitPanel.innerHTML = `<h3>TROOPER — ${(u.side || '').toUpperCase()}</h3>` +
        `<div>health ${hp}/100 · ${state}</div><div class="bar"><i class="${tone}" style="width:${hp}%"></i></div>` +
        `<div class="items">${items.map((it) => `<div class="slot"><b>${it.n}</b>${it.count !== '' ? `${it.count}` : ''}</div>`).join('')}</div>` +
        `<div class="keys">` +
        `<div><kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd> walk (held)</div>` +
        `<div><kbd>Space</kbd><kbd>W</kbd><kbd>↑</kbd> jump/climb</div>` +
        `<div><kbd>S</kbd><kbd>↓</kbd> crouch</div>` +
        `<div>left click: aim + fire there</div><div>right click: grenade</div>` +
        `<div><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> item <kbd>F</kbd> use</div>` +
        `<div><kbd>R</kbd> reload <kbd>P</kbd> pause</div><div><kbd>Esc</kbd> free</div>` +
        `</div>`;
    } else if (selected.kind === 'mech') {
      const m = selected.t, hp = Math.max(0, Math.round(m.hp ?? 100));
      const tone = hp < 30 ? 'grave' : hp < 60 ? 'hurt' : '';
      const state = !m.onGround ? (m.boosting ? 'boosting' : 'in the air') : (m.reload || 0) > 0.05 ? `reloading ${m.reload.toFixed(1)}s` : 'ready';
      unitPanel.innerHTML = `<h3>MECH — ${styleTag(m.style)} ${(m.side || '').toUpperCase()}</h3>` +
        `<div>armour ${hp}/100 · ${state}</div><div class="bar"><i class="${tone}" style="width:${hp}%"></i></div>` +
        `<div>cannon <kbd>${m.mag ?? 0}/${m.ammo ?? 0}</kbd> · missiles <kbd>${m.missiles ?? 0}</kbd></div>` +
        `<div class="keys">` +
        `<div><kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd> walk (held)</div>` +
        `<div><kbd>Space</kbd><kbd>W</kbd><kbd>↑</kbd> leap / jets</div>` +
        `<div><kbd>S</kbd><kbd>↓</kbd> jets off <kbd>E</kbd> dash</div>` +
        `<div>left click: aim + cannon there</div><div>right click: missile</div>` +
        `<div><kbd>R</kbd> reload <kbd>P</kbd> pause</div><div><kbd>Esc</kbd> free</div>` +
        `</div>`;
    } else if (selected.kind === 'jet') {
      const j = selected.t, hp = Math.max(0, Math.round(j.hp ?? 100));
      const tone = hp < 30 ? 'grave' : hp < 60 ? 'hurt' : '';
      const state = j.down ? 'going down' : j.onGround ? `rolling ${Math.round(j.v)}` : `${Math.round(j.v)} cells/s`;
      unitPanel.innerHTML = `<h3>DRONE — ${styleTag(j.style)} ${(j.side || '').toUpperCase()}</h3>` +
        `<div>airframe ${hp}/100 · ${state}</div><div class="bar"><i class="${tone}" style="width:${hp}%"></i></div>` +
        `<div class="keys">` +
        `<div><kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd> turn about</div>` +
        `<div><kbd>Space</kbd><kbd>W</kbd><kbd>↑</kbd> climb (held)</div>` +
        `<div><kbd>S</kbd><kbd>↓</kbd> dive (held)</div>` +
        // (N126, PS's drones: no guns - sent in, it dives into the spot; or it circles over one)
        `<div>left click: send it in (kamikaze)</div><div>right click: circle there</div>` +
        `<div><kbd>P</kbd> pause <kbd>Esc</kbd> free</div>` +
        `</div>`;
    } else if (selected.kind === 'defence') {
      const u = selected.t, T = (PW.defence && PW.defence.TYPES[u.type]) || { hp: 60 };
      const hp = Math.max(0, Math.round(100 * (u.hp ?? T.hp) / T.hp));
      const tone = hp < 30 ? 'grave' : hp < 60 ? 'hurt' : '';
      const state = u.hold ? 'holding fire' : u.salvo > 0 ? 'firing' : 'ready';
      unitPanel.innerHTML = `<h3>${DEFENCE_NAMES[u.type] || 'BATTERY'} — ${(u.side || '').toUpperCase()}</h3>` +
        `<div>condition ${hp}% · ${state}</div><div class="bar"><i class="${tone}" style="width:${hp}%"></i></div>` +
        `<div>rounds <kbd>${u.ammo ?? 0}</kbd></div>` +
        `<div class="keys">` +
        (u.type === 'launcher' ? `<div>left click: salvo there</div><div><kbd>F</kbd> salvo</div>`
          : u.type === 'turret' ? `<div>left click: burst there</div>` : `<div><kbd>F</kbd> hold / free fire</div>`) +
        `<div><kbd>P</kbd> pause <kbd>Esc</kbd> free</div>` +
        `</div>`;
    }
  }
  // A click for the unit in hand (N102): its module fires at the spot - true if it took the click.
  const MODULE_OF = { troop: () => PW.troops, tank: () => PW.tanks, mech: () => PW.mechs, jet: () => PW.jets, defence: () => PW.defence };
  function clickUnit(sel, p, button) {
    const mod = sel && MODULE_OF[sel.kind] && MODULE_OF[sel.kind]();
    return !!(mod && mod.click && mod.click(world, p.x, p.y, button));
  }
  // (N102, the user's change: the aim is the left click's - a left click lays the gun on the spot
  // and fires there, a right click its second fire; the pointer moving over the world turns
  // nothing, and a key's fire (F, G) goes where the last click laid it - each module's click()
  // lays the aim before it fires)
  // Selecting takes the unit in hand in its own module (PS's hold()), and lets go of
  // whatever any other module held - so the keys follow exactly one unit.
  function select(next) {
    selected = next;
    for (const U of UNITS) {
      const mod = U.mod();
      if (mod && mod.hold) mod.hold(next && next.kind === U.kind ? next.t : null);
    }
    renderUnitPanel();
  }
  // A battery placed by hand serves the side whose buildings stand nearest (as a dropped
  // trooper does in PS's module).
  const nearestSide = (x) => {
    let side = null, best = Infinity;
    for (const b of world.buildings || []) {
      const s = b.faction || b.side, bx = b.body ? (b.body.left + b.body.right) / 2 : b.x;
      if (s && s !== 'neutral' && Number.isFinite(bx) && Math.abs(bx - x) < best) { best = Math.abs(bx - x); side = s; }
    }
    return side;
  };
  const battery = (type) => ({ kind: 'defence', use: (p) => PW.defence && PW.defence.tool(world, p.x, p.y, type, nearestSide(p.x)) });
  const UNIT_TOOLS = {
    troop: { kind: 'troop', use: (p, shift) => PW.troops && PW.troops.tool(world, p.x, p.y, shift), miss: 'troop: no room to stand there' },
    jet: { kind: 'jet', use: (p, shift) => PW.jets && PW.jets.tool(world, p.x, p.y, shift), miss: 'jet: click on or near a runway' },
    mech: { kind: 'mech', use: (p, shift) => PW.mechs && PW.mechs.tool(world, p.x, p.y, shift), miss: 'mech: no room to stand there' },
    rocket: battery('launcher'), dome: battery('dome'), patriot: battery('patriot'),
  };
  let panelAt = 0;
  function drawSelection(renderer2) {
    if (!selected) return;
    const t = selected.t, U = UNITS.find((u) => u.kind === selected.kind);
    if (!t || t.dead || !U || !(U.list() || []).includes(t)) { select(null); return; }
    // (the panel's live readings - health, rounds, state - refresh a few times a second)
    const now = performance.now();
    if (now - panelAt > 250) { panelAt = now; renderUnitPanel(); }
    const { ctx, camera } = renderer2, z = camera.zoom;
    const [bx0, by0, bx1, by1] = U.box(t);
    const x0 = (bx0 - camera.x) * z, x1 = (bx1 - camera.x) * z;
    const y0 = (by0 - camera.y) * z, y1 = (by1 - camera.y) * z;
    const arm = Math.max(4, Math.min(9 * z, (x1 - x0) / 3, (y1 - y0) / 3)), pulse = 0.68 + 0.27 * Math.sin(now / 280);
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.moveTo(cx + dx * arm, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * arm);
    }
    // a dark under-stroke keeps the bracket readable over lit facades
    ctx.strokeStyle = 'rgba(5, 8, 10, 0.75)';
    ctx.lineWidth = Math.max(3, Math.round(z) + 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(228, 240, 200, ${pulse.toFixed(3)})`;
    ctx.lineWidth = Math.max(1, Math.round(z));
    ctx.stroke();
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
    if (tool === 'torch') torch(p.x, p.y);
    else if (tool === 'life') life.seed(p.x, p.y, Math.max(3, brush));
    else if (typeof spec === 'function') paint(p.x, p.y, brush, spec);
  }
  // N2: a seed dropped by hand - the capital-growth engine grows a capital, farm or military
  // base from it by the growth rules (the lab's whole system, live in the world). The style
  // follows the nearest town's; the engine answers with why a spot refuses a seed.
  function dropSeed(which, p) {
    if (!capital) return;
    const kind = which === 'seedF' ? 'farm' : which === 'seedM' ? 'military' : 'capital';
    // (the engine knows its own cities' claims; the standing worldgen towns are guarded here)
    for (const s of world.settlements || []) {
      if (p.x > s.streetLeft - 220 && p.x < s.streetRight + 220) { lastDig = 'seed: claimed by a standing town'; return; }
    }
    for (const o of [...(world.outposts || []), ...(world.bunkers || [])]) {
      for (const f of o.footprints || []) if (p.x > f[0] - 90 && p.x < f[1] + 90) { lastDig = 'seed: claimed by the military'; return; }
    }
    let near = null;
    for (const s of world.settlements || []) {
      const d = Math.abs((s.streetLeft + s.streetRight) / 2 - p.x);
      if (!near || d < near.d) near = { s, d };
    }
    // N2: a seed goes anywhere IN VISION - the side must see the ground it casts onto
    // (its cities, buildings, planted cores, and tanks driven forward all carry sight).
    const side = near ? near.s.side : null;
    if (PW.vision && side && !PW.vision.sees(world, side, p.x)) { lastDig = 'seed: beyond the side\'s vision'; return; }
    // The nearest town lends the seed its style AND its faction side: the growing city
    // threads its cores onto that side's bundle lot by lot (connect on place, release on
    // re-seat), which also heals any cut the foundation work makes landing over the line.
    const r = capital.drop(Math.round(p.x), kind, near ? near.s.style : 'modern', side);
    lastDig = r.ok ? `seed: ${kind} ${r.city ? r.city.id : ''} planted` : `seed: ${r.note}`;
  }
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    if (!renderer) return;   // (the game page's menu and loading screen come first)
    // N6: in a match the game's own hand (PW.gameUI: selection, orders, the tools in hand) takes
    // the click; what it leaves is a drag that pans the view
    if (match && PW.gameUI) {
      if (PW.gameUI.pointerDown(event, toWorld(event))) return;
      drag.active = true; drag.pan = true; drag.x = event.clientX; drag.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    // N102: with a unit in hand and the hand empty (PAN), a click that lands on no other unit is
    // the unit's - left its weapon at the spot, right its second (PS's module.click). With a unit
    // tool up, its tool() takes the left click (it aims and fires as well); the right is still the
    // unit's second fire, not a pan.
    const unitToolUp = tool === 'tank' || !!UNIT_TOOLS[tool];
    if (selected && ((tool === 'pan' && event.button === 0) || ((tool === 'pan' || unitToolUp) && event.button === 2))) {
      const p = toWorld(event);
      if (!unitAt(p.x, p.y) && clickUnit(selected, p, event.button)) return;
    }
    drag.active = true; drag.x = event.clientX; drag.y = event.clientY;
    drag.pan = event.button !== 0 || tool === 'pan';
    canvas.setPointerCapture(event.pointerId);
    if (!drag.pan) {
      const spec = tools[tool];
      const p = toWorld(event);
      if (tool === 'tank' && PW.tanks) {
        // tool() holds, aims, lets go or drops - selection mirrors whatever it returns (N78)
        const h = PW.tanks.tool(world, p.x, p.y, event.shiftKey);   // (N10: once per click, like a seed)
        select(h ? { kind: 'tank', t: h } : null);
        return;
      }
      // N78: a click on a unit SELECTS it, whatever tool is up - the seed or charge in
      // hand is not spent on a friend's hull
      const hit = unitAt(p.x, p.y);
      // The troop, jet and battery tools (PS's modules): their own tool() drops, takes in
      // hand, aims or lets go, as the tank's does; a click on another kind of unit selects it.
      const unitTool = UNIT_TOOLS[tool];
      if (unitTool && (!hit || hit.kind === unitTool.kind)) {
        const h = unitTool.use(p, event.shiftKey);
        select(h ? { kind: unitTool.kind, t: h } : null);
        if (!h && !hit && unitTool.miss) lastDig = unitTool.miss;
        return;
      }
      if (hit) { select(hit); return; }
      if (tool === 'digL' || tool === 'digR') dig(tool === 'digL' ? 'left' : 'right', Math.round(p.x - 30), Math.round(p.y - 18), Math.round(p.x + 30), Math.round(p.y + 18));
      else if (tool === 'seedC' || tool === 'seedF' || tool === 'seedM') dropSeed(tool, p);
      else if (spec && typeof spec === 'object') explode(p.x, p.y, spec.radius, spec.power);
      else useTool(event);
    } else if (event.button === 0) {
      // N78: panning hand - a click on a unit still selects it; empty ground lets it go
      const p = toWorld(event);
      const hit = unitAt(p.x, p.y);
      if (hit) select(hit);
      else if (selected) select(null);
    }
  });
  // (N126: the cursor over the world, handed to PS's missile aim each frame - null off the canvas)
  let cursorWorld = null;
  canvas.addEventListener('pointerleave', () => { cursorWorld = null; });
  canvas.addEventListener('pointermove', (event) => {
    if (!renderer) return;
    cursorWorld = toWorld(event);
    if (match && PW.gameUI) PW.gameUI.pointerMove(event, toWorld(event));
    if (tool === 'digL' || tool === 'digR') planDig(tool === 'digL' ? 'left' : 'right', toWorld(event));
    if (!drag.active) return;
    if (drag.pan) renderer.panByDevice((event.clientX - drag.x) * renderer.view.dpr, (event.clientY - drag.y) * renderer.view.dpr);
    else if (typeof tools[tool] === 'function' || tool === 'torch' || tool === 'life') useTool(event);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  const release = () => { drag.active = false; };
  canvas.addEventListener('pointerup', (event) => {
    release();
    if (match && PW.gameUI && renderer) PW.gameUI.pointerUp(event, toWorld(event));
  });
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (!renderer) return;
    const rect = canvas.getBoundingClientRect();
    const ax = (event.clientX - rect.left) * renderer.view.dpr, ay = (event.clientY - rect.top) * renderer.view.dpr;
    renderer.setZoomIndex(renderer.camera.zoomIndex + (event.deltaY < 0 ? 1 : -1), ax, ay);
  }, { passive: false });

  // ---- Loop: fixed 60 Hz simulation, render every frame -------------------------------------------
  const DT = 1 / 60;
  const simTimes = [];
  // N8: what each part of the world costs a frame. A stopwatch runs through the ticks and the draw;
  // each part's time is summed over the frame and the last 240 frames kept, for its p95 against
  // its budget (M9's, plus heat and the town services). F3 shows them over the game.
  const BUDGET = { sim: 3, heat: 1, particles: 2, integrity: 1, fragments: 1.5, units: 2, services: 1.5, raster: 3, draw: 3 };
  const PERF_FRAMES = 240;
  const perf = { frame: {}, rings: {}, n: 0 };
  for (const k of Object.keys(BUDGET)) { perf.frame[k] = 0; perf.rings[k] = new Float32Array(PERF_FRAMES); }
  let lap = 0;
  const charge = (k) => { const t = performance.now(); perf.frame[k] += t - lap; lap = t; };
  function perfReport() {
    const out = {};
    const n = Math.min(perf.n, PERF_FRAMES);
    for (const k of Object.keys(BUDGET)) {
      const sorted = Array.from(perf.rings[k].subarray(0, n)).sort((a, b) => a - b);
      out[k] = { p95: n ? sorted[Math.floor(n * 0.95)] : 0, max: n ? sorted[n - 1] : 0, budget: BUDGET[k] };
    }
    return { frames: n, parts: out };
  }
  function stepWorld(n) {
    for (let k = 0; k < n; k += 1) {
      const s = performance.now();
      lap = s;
      sim.step(3); charge('sim');
      particles.step(DT); charge('particles');
      if (PW.tunnels) PW.tunnels.step(world, DT * devSpeed);
      charge('services');
      heat.step(1); charge('heat');
      if (structure) structure.step(1.5);
      charge('integrity');
      if (fragments) fragments.step(DT);
      charge('fragments');
      if (PW.tanks) PW.tanks.step(world, DT);
      charge('units');
      // (N77 rounds step inside PW.tanks.step - the suites' scenarios manual-step it, so
      // the loop does not claim them with the looped flag; PS's default stands)
      if (PW.streetProps) PW.streetProps.step(world, particles);
      if (PW.flora && PW.flora.step) PW.flora.step(world, particles);
      if (cores) cores.step();
      charge('services');
      if (stability) stability.step();
      charge('integrity');
      if (air) air.step();
      if (PW.stepSmokeBursts) PW.stepSmokeBursts(world, DT);
      if (PW.stepSmoulders) PW.stepSmoulders(world, DT);
      charge('particles');
      if (PW.mining) PW.mining.step(world, DT);
      if (pipes) pipes.step();
      // (N115: the test's build speed - the crews, the growth and the workings' clock, not the physics)
      const build = world.buildSpeed || 1;
      if (repair) repair.step(DT * build);
      // N103: a turret on every base that stands - in the game (the sandbox's roofs keep their bases
      // bare: it is the physics' bench; the capital lab shows them, silent)
      if (PW.mounts && gameMode) PW.mounts.step(world, { armed: !!match });
      // N104: the mountain road tunnels' bores go on; their barricades are kept
      if (PW.roadTunnels) PW.roadTunnels.step(world, DT * devSpeed);
      if (growth) growth.step(DT);
      // (seed cities grow at the dev speed, like the lab's controllable speeds)
      if (capital) capital.step(DT * devSpeed * build);
      if (match) PW.game.step(match, DT);   // N6: the match's rules and its computer players
      life.step();
      charge('services');
      simTimes.push(performance.now() - s);
      if (simTimes.length > 240) simTimes.shift();
    }
  }
  let frames = 0, fpsClock = performance.now(), fps = 0, last = performance.now(), accumulator = 0;
  let speed = 1;   // N6: a watched match may run fast (the game bar's speed)
  function frame(now) {
    accumulator = Math.min(accumulator + (now - last) / 1000 * speed, DT * 3 * speed);
    last = now;
    // (the frame's own costs from here: whatever ticks a test ran between frames are not this one's)
    for (const k in perf.frame) perf.frame[k] = 0;
    // A heavy moment runs the world a touch slow instead of stuttering: once the ticks this
    // frame have eaten ~12 ms the rest of the backlog is dropped, so one expensive tick can
    // never snowball into owing two or three more next frame (the perf pass's blast hitch).
    if (!paused) {
      const t0 = performance.now();
      while (accumulator >= DT) {
        stepWorld(1); accumulator -= DT;
        if (performance.now() - t0 > 12) { accumulator = 0; break; }
      }
    }
    lap = performance.now();
    renderer.beginFrame();
    renderer.drawSky();
    renderer.drawBase();
    charge('raster');
    if (pipes) pipes.draw(renderer, now / 1000);
    if (fragments) fragments.draw(renderer);
    if (PW.mining) PW.mining.draw(renderer, world, now / 1000);
    if (PW.defence && PW.defence.pointer) PW.defence.pointer(world, cursorWorld ? cursorWorld.x : null, cursorWorld ? cursorWorld.y : null);
    if (PW.drawUnitsHook) {
      // N123: the other side's units are drawn only where the watching side sees them
      const fog = world.fogSide && PW.vision ? world.fogSide : null, kept = [];
      if (fog) {
        for (const list of ['troops', 'tanks', 'mechs', 'jets', 'defence']) {
          const all = world[list];
          if (!all || !all.length) continue;
          kept.push([list, all]);
          world[list] = all.filter((u) => u.side === fog || PW.vision.sees(world, fog, u.x, (u.y ?? 0) - 12));
        }
      }
      try { PW.drawUnitsHook(renderer); } finally { for (const [list, all] of kept) world[list] = all; }
    }
    drawSelection(renderer);   // N78: the selected unit's bracket
    if (selected && (frames & 7) === 0) renderUnitPanel();   // and its live readout
    renderer.drawDeco();
    if (renderer.drawLeaves) renderer.drawLeaves(now / 1000);   // N9: the crowns sway
    heat.draw(renderer, now / 1000);
    drawPreview(now / 1000);
    particles.draw(renderer);
    if (life.draw) life.draw(renderer);
    if (cores && cores.draw) cores.draw(renderer, now);
    // (the growth engine's labels and blocked-edge marks are the dev page's, not the game's)
    if (capital && capital.draw && (!gameMode || params.get('dev') === '1')) capital.draw(renderer, now / 1000);
    if (PW.debugHitboxes && fragments && fragments.drawHitboxes) fragments.drawHitboxes(renderer);
    PW.drawEffects(world, renderer, (now - (frame.prev || now)) / 1000);
    if (match && PW.gameUI) PW.gameUI.drawWorld(renderer, now);   // N6: the match's marks over the world
    charge('draw');
    const slot = perf.n % PERF_FRAMES;
    for (const k in perf.frame) perf.rings[k][slot] = perf.frame[k];
    perf.n += 1;
    if (perfPanel && perfPanel.style.display !== 'none' && (perf.n & 15) === 0) showPerf();
    frame.prev = now;
    frames += 1;
    if (now - fpsClock >= 500) {
      fps = frames * 1000 / (now - fpsClock);
      frames = 0; fpsClock = now;
    }
    if (frames === 0 && status) {
      const s = renderer.stats();
      const sorted = simTimes.slice().sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
      status.textContent = `seed ${seed} | ${fps.toFixed(0)} fps | zoom ${s.zoom.toFixed(3)} | sim ${sim.stats.ms.toFixed(1)}ms ` +
        `(p95 ${p95.toFixed(1)}) active ${sim.stats.active} moves ${sim.stats.moves} | particles ${particles.count} | ` +
        `tunnels ${tunnelSummary()}${lastDig ? ` (${lastDig})` : ''} | ` +
        `wind ${(world.wind / 14).toFixed(1)} m/s fire ${heat.stats.burning} heat ${heat.stats.chunks}ch ${heat.stats.ms.toFixed(1)}ms | ` +
        `gen ${Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' ')}`;
    }
    requestAnimationFrame(frame);
  }

  // F3: each part's p95 over the last frames against its budget, red where it runs over.
  let perfPanel = null;
  function togglePerf() {
    if (!perfPanel) {
      perfPanel = document.createElement('div');
      perfPanel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:30;font:12px Consolas,monospace;color:#c8dcb0;'
        + 'background:#05080ae8;border:2px solid #2c4030;padding:6px 8px;pointer-events:none;white-space:pre';
      document.body.appendChild(perfPanel);
    } else perfPanel.style.display = perfPanel.style.display === 'none' ? '' : 'none';
    showPerf();
  }
  function showPerf() {
    const r = perfReport();
    let total = 0;
    const lines = Object.entries(r.parts).map(([k, v]) => {
      total += v.p95;
      const over = v.p95 > v.budget;
      return `<span style="color:${over ? '#ff9a80' : '#c8dcb0'}">${k.padEnd(10)} ${v.p95.toFixed(2).padStart(6)} / ${v.budget} ms  max ${v.max.toFixed(1)}</span>`;
    });
    perfPanel.innerHTML = `${fps.toFixed(0)} fps · p95 per part (ms a frame)\n${lines.join('\n')}\nsum of p95s ${total.toFixed(1)} ms`;
  }

  function tunnelSummary() {
    if (!world.tunnels) return '-';
    let cells = 0, developed = 0;
    for (const net of world.tunnels.networks) { cells += net.cells; developed += net.developed; }
    return `${cells ? Math.round(developed / cells * 100) : 0}% developed${devSpeed > 1 ? ' x20' : ''}`;
  }

  // ---- Start ------------------------------------------------------------------------------------
  // Once the world is made: the view follows the window, the loop runs, and the harness and the
  // game's own modules get their handle on it all (pwApp).
  function start() {
    new ResizeObserver(() => renderer.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);
    window.pwApp = { world, layout, renderer, sim, particles, seed, timings, ready: true, gameMode,
      explode, dig, planDig, preview, pipes, setDevelopSpeed: (k) => { devSpeed = k; }, heat, life, structure, fragments, cores, stability, air,
      dropSeed: (which, x) => { dropSeed(which, { x }); return lastDig; },   // N2: the hand's seed path (vision-gated)
      selectAt: (x, y) => { const hit = unitAt(x, y); select(hit); return hit; },   // N78
      selected: () => selected, clearSelection: () => select(null), select, clickUnit,
      setBrush: (b) => { brush = b; },
      paint: (x, y, radius, material) => paint(x, y, radius, () => material),
      stepWorld, countWater: () => sim.countWater(), simTimes,
      setPaused: (value) => { paused = value; }, paused: () => paused,
      setSpeed: (k) => { speed = k; }, speed: () => speed, fps: () => fps,
      perf: perfReport, togglePerf, BUDGET,   // N8
      match: () => match,
      focus: (x, y, zoomIndex) => renderer.focus(x, y, zoomIndex),
      focusWorld: (x, y, zoomIndex) => renderer.focus(x, y, zoomIndex),
      // Viewport (client) coordinates of a world cell, for real mouse input in harness scenarios.
      toClient: (x, y) => {
        const rect = canvas.getBoundingClientRect();
        const screen = renderer.worldToScreen(x + 0.5, y + 0.5);
        return { x: rect.left + screen.x, y: rect.top + screen.y };
      } };
    requestAnimationFrame(frame);
  }

  // N6: a match - the world the menu chose, made behind the loading screen, then the match's
  // rules and players set going on it, and the HUD and game bar over it.
  // N115: the gameplay test - the sides' home towns are not built (each places its own starting
  // capital) and everything is built four times as fast.
  async function startMatch(choice) {
    const ui = PW.gameUI;
    const style = choice.style && choice.mode === 'versus' ? { side: choice.human, style: choice.style } : null;
    await generateStaged({ seed: choice.seed, width: choice.width, homes: !!choice.towns, style }, ui.loading);
    if (choice.test) world.buildSpeed = TEST_BUILD_SPEED;
    start();
    match = PW.game.create(world, { ...choice, app: window.pwApp });
    ui.attach(match, window.pwApp);
  }

  const urlSeed = Number(params.get('seed')) || (Math.random() * 1e9) >>> 0;
  if (!gameMode) {
    generateNow({ seed: urlSeed, width: Number(params.get('width')) || 0, gallery: params.has('gallery') ? params.get('gallery') : null });
    start();
  } else {
    // (the sandbox's tools and readout are the dev page's; dev=1 keeps them for a look under the hood)
    if (toolbar && params.get('dev') !== '1') toolbar.style.display = 'none';
    if (status && params.get('dev') !== '1') status.style.display = 'none';
    PW.gameUI.menu({ seed: urlSeed, params, onStart: startMatch });
  }
})();
