(function () {
  const canvas = document.getElementById('comparison-canvas'), message = document.getElementById('comparison-message');
  let renderer;
  const terrainCanvas = document.createElement('canvas'), terrainContext = terrainCanvas.getContext('2d');
  let terrainTick = -1, sharedTick = 0;
  const fps = createLabFps(document.getElementById('comparison-fps'));
  const packs = [
    { kind: 'trooper', reference: PIXEL_UNIT_REFERENCE },
    { kind: 'tank', reference: PIXEL_TANK_REFERENCE, roles: ['move', 'aim'] },
    { kind: 'hopper', reference: PIXEL_HOPPER_REFERENCE, roles: ['idle', 'jump', 'boost', 'fall'] },
    { kind: 'jet', reference: PIXEL_JET_REFERENCE, roles: ['fly', 'shoot', 'down'] },
  ];
  const projectiles = createPixelProjectileArtwork(PIXEL_BULLET_REFERENCE);
  let world, units, combat, aim, clock, initial, running = false, failed = false, pulses = [], weaponFrame = 0, weaponTime = 0, weaponActive = false;
  function controls() {
    document.getElementById('comparison-run').textContent = running ? 'Pause simulation' : 'Run simulation';
    document.getElementById('comparison-run').setAttribute('aria-pressed', String(running));
    for (const id of ['comparison-step', 'comparison-second']) document.getElementById(id).disabled = running || failed;
  }
  function draw() {
    if (terrainTick !== sharedTick || terrainCanvas.width !== canvas.width || terrainCanvas.height !== canvas.height) {
      renderer.draw({ world, blueprintCells: () => [] });
      terrainCanvas.width = canvas.width; terrainCanvas.height = canvas.height;
      terrainContext.drawImage(canvas, 0, 0); terrainTick = sharedTick;
    } else canvas.getContext('2d').drawImage(terrainCanvas, 0, 0);
    const overlay = document.getElementById('comparison-collision').checked;
    const table = document.getElementById('comparison-states');
    if (table.children.length !== units.length) {
      table.replaceChildren(...units.map(() => {
        const row = document.createElement('tr');
        for (let i = 0; i < 8; i += 1) row.appendChild(document.createElement('td'));
        return row;
      }));
    }
    for (const [index, entry] of units.entries()) {
      const state = entry.unit.inspect();
      const health = combat.health(entry.kind), tintColor = state.drowned || health.health === 0 ? '#ed795e' : state.tintColor;
      renderer.markUnit({ ...state, tintColor, hitFlash: health.hitFlash > 0 }, overlay);
      if (state.previewPixels && state.previewPixels.length) renderer.markUnit({ ...state, pixels: state.previewPixels, tintColor, collision: [] });
      const row = table.children[index];
      const special = entry.kind === 'tank' ? `aim ${state.aim + 1}/6` : entry.kind === 'hopper' ?
        `${state.charges} boosts; air glide ${state.glideTime.toFixed(2)}s; ground coast ${state.slideTime.toFixed(2)}s` :
        entry.kind === 'jet' ? `heading ${(state.heading * 180 / Math.PI).toFixed(1)} degrees` : '';
      const values = [entry.kind, `${state.width}x${state.height}`, state.state,
        `${state.x - entry.startX} cells`, `${state.vy.toFixed(2)} cells/s`, `${state.animation} ${state.frame + 1}`,
        `${state.water.wetCells}/${state.water.totalCells}${state.drowned ? ' drowned' : ''}`,
        `${special}${special ? '; ' : ''}HP ${health.health}/${health.maxHealth}`];
      for (let i = 0; i < values.length; i += 1) {
        if (row.children[i].textContent !== values[i]) row.children[i].textContent = values[i];
      }
    }
      const combatState = combat.inspect();
      renderer.markProjectileTrails(combatState.trails);
      renderer.markUnitDeathEffects(combatState.deathParticles, combatState);
      for (const shot of combatState.shots) renderer.markUnit({ ...shot, x: Math.round(shot.x), y: Math.round(shot.y) });
      if (aim) renderer.markSelected(aim);
      const hit = combatState.impacts[combatState.impacts.length - 1];
      document.getElementById('combat-audit').textContent =
        `Shots ${combatState.fired}; in flight ${combatState.shots.length}. Broken structure ${combatState.damagedStructure}; ` +
        `terrain converted to debris ${combatState.terrainDebris}; issued ammo debris ${combatState.issuedAmmoDebris}. ` +
        (hit ? `Last shot: ${hit.kind} hit ${hit.targetId || (hit.reason === 'crop edge' ? 'crop edge' : ['empty', 'terrain', 'water', 'building', 'debris', 'construction'][hit.material])}` +
          `${hit.health === null ? '' : `; HP ${hit.health}`}.` : 'No impacts yet.');
    for (const [kind, x] of [['bullet', 40], ['missile', 150]]) {
      const art = projectiles.frame(weaponFrame, 1, kind);
      renderer.markUnit({ ...art, x, y: 0, collision: [] });
    }
    document.getElementById('comparison-audit').textContent =
      `Shared tick ${sharedTick}; unit ticks ${units.map((entry) => entry.unit.inspect().ticks).join('/')}. ` +
      `Water ${world.waterCount}/${initial.water}; barrier + construction + debris ` +
      `${world.barrierCount + world.constructionCount + world.debrisCount}/${initial.material + combatState.terrainDebris + combatState.issuedAmmoDebris}` +
      ` (frame + converted terrain + issued ammo); unit structural mass 0. No HM/SM/save changes.`;
  }
  function step() {
    world.step();
    sharedTick += 1;
    units.forEach((entry) => { updatePixelUnitLabPatrol(entry.unit, world, entry.startY); entry.unit.step(); });
    combat.step();
    for (const pulse of pulses) {
      pulse.ticks -= 1;
      if (pulse.ticks <= 0) pulse.input[pulse.key] = false;
    }
    pulses = pulses.filter((pulse) => pulse.ticks > 0);
    if (weaponActive) {
      weaponTime += 1000 / 60;
      while (weaponTime + 1e-8 >= projectiles.frame(weaponFrame, 1).durationMs) {
        weaponTime -= projectiles.frame(weaponFrame, 1).durationMs;
        if (weaponFrame === projectiles.frameCount - 1) { weaponActive = false; break; }
        weaponFrame += 1;
      }
    }
    const audit = combat.inspect();
    if (world.waterCount !== initial.water ||
        world.barrierCount + world.constructionCount + world.debrisCount !== initial.material + audit.terrainDebris + audit.issuedAmmoDebris ||
        world.terrainCount + audit.terrainDebris !== initial.terrain) {
      throw new Error('Comparison changed physical water or material accounting');
    }
  }
  function action(operation) {
    try { operation(); draw(); }
    catch (error) { running = false; failed = true; message.textContent = `Comparison stopped: ${error.message}`; controls(); console.error(error); }
  }
  function reset() {
    running = false; failed = false; pulses = []; weaponFrame = 0; weaponTime = 0; weaponActive = false;
    sharedTick = 0; terrainTick = -1; aim = null;
    document.getElementById('glide-hopper').checked = false;
    const artworks = packs.map((pack) => createPixelUnitArtwork(pack.reference, {
      ...(pack.roles ? { roles: pack.roles } : {}),
      inPlace: pack.kind === 'hopper',
      cellScale: pack.kind === 'trooper' ? 1 : Number(document.getElementById(`${pack.kind}-size`).value),
    }));
    const groundRow = Math.max(320, ...artworks.map((art) => art.height + 85));
    const scene = document.getElementById('comparison-scene').value;
    const unitSpan = artworks.reduce((sum, art) => sum + art.width + 30, 0);
    const worldWidth = Math.max(1100, unitSpan + 500) + (scene === 'targets' ? unitSpan + 150 : 0);
    const waterLeft = artworks.reduce((sum, art) => sum + art.width + 30, 80), waterRight = worldWidth - 50;
    const bottomRow = groundRow + Math.max(...artworks.map((art) => art.height)) + 45;
    world = createParticleWorld(worldWidth, bottomRow + 30, { skipEmptyChunks: true, supportCapacity: scene === 'targets' ? 128 : undefined });
    renderer = createPixelConstructionRenderer(canvas, world.width, world.height);
    renderer.resize(640);
    const collisionGroup = createPixelUnitCollisionGroup(world);
    for (let x = 0; x < world.width; x += 1) {
      const floor = scene === 'submerged' ? bottomRow : scene === 'water' && x >= waterLeft && x < waterRight ? bottomRow :
        scene === 'steps' && x >= waterLeft ? x < waterLeft + 25 ? groundRow - 2 - Math.floor((x - waterLeft) / 5) * 2 :
          x < waterLeft + 90 ? groundRow - 8 : groundRow - 40 : groundRow;
      for (let y = floor; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      if (scene === 'water' && x >= waterLeft && x < waterRight || scene === 'submerged' && x > 0 && x < world.width - 1) {
        for (let y = scene === 'submerged' ? 1 : groundRow; y < bottomRow; y += 1) world.set(x, y, PARTICLE_WATER);
      }
    }
    if (scene === 'submerged') {
      for (let y = 1; y < bottomRow; y += 1) { world.set(0, y, PARTICLE_TERRAIN); world.set(world.width - 1, y, PARTICLE_TERRAIN); }
    }
    const automated = document.getElementById('automated').checked;
    let x = 30;
    units = packs.map((pack, index) => {
      const art = artworks[index];
      const friendlyOverlap = scene === 'friendly' && pack.kind === 'tank';
      const spawnX = friendlyOverlap ? 30 : x;
      const options = { kind: pack.kind, x: spawnX, y: (pack.kind === 'jet' ? groundRow - 100 : groundRow) - art.footRow,
        facing: 1, automated, collisionGroup, ownerId: 'friendly', speedScale: 1.8, treadRate: 2, forwardLunge: 1.8 };
      const unit = pack.kind === 'trooper' ? createPixelTerrainUnit(world, art, options) : createPixelVehicleUnit(world, art, options);
      const entry = { kind: pack.kind, unit, startX: spawnX, startY: options.y };
      x += art.width + 30; return entry;
    });
    if (scene === 'opposing') {
      const art = artworks[0], enemyX = waterLeft - 20;
      const unit = createPixelTerrainUnit(world, art, { x: enemyX, y: groundRow - art.footRow, facing: -1,
        collisionGroup, ownerId: 'opposing', speedScale: 1.8 });
      units.push({ kind: 'opposing trooper', unit, startX: enemyX, startY: groundRow - art.footRow });
    }
    if (scene === 'targets') {
      let enemyX = waterLeft + 80;
      for (const [index, pack] of packs.entries()) {
        const art = artworks[index];
        const options = { kind: pack.kind, x: enemyX, y: (pack.kind === 'jet' ? groundRow - 100 : groundRow) - art.footRow,
          facing: -1, automated: true, collisionGroup, ownerId: 'opposing', speedScale: 1.8, treadRate: 2, forwardLunge: 1.8 };
        const unit = pack.kind === 'trooper' ? createPixelTerrainUnit(world, art, options) : createPixelVehicleUnit(world, art, options);
        units.push({ kind: `opposing ${pack.kind}`, unit, startX: enemyX, startY: options.y }); enemyX += art.width + 30;
      }
      addPixelCombatTargetBuilding(world, enemyX + 40, groundRow);
    }
    combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    for (const entry of units) combat.register(entry.kind, entry.unit, entry.kind.replace('opposing ', ''), entry.unit.inspect().ownerId);
    initial = { water: world.waterCount, terrain: world.terrainCount, material: world.barrierCount + world.constructionCount + world.debrisCount };
    clock = createFixedStepClock(() => { if (running) step(); });
    message.textContent = 'Choose a firing unit and click the preview to aim/fire. Run or Step advances shots and physics. Use Shooting targets to test enemies/building/terrain.';
    controls(); draw(); fps.reset(performance.now());
  }
  const command = (left, right) => units.forEach(({ unit }) => {
    if (unit.inspect().ownerId === 'friendly') { unit.input.left = left; unit.input.right = right; }
  });
  function pulse(kind, key, ticks = 1) {
    const entry = units.find((unit) => unit.kind === kind);
    if (!entry || !(key in entry.unit.input)) throw new Error(`Unsupported comparison command: ${kind}/${key}`);
    entry.unit.input[key] = true; pulses.push({ input: entry.unit.input, key, ticks });
  }
  document.getElementById('comparison-reset').addEventListener('click', () => action(reset));
  document.getElementById('comparison-scene').addEventListener('change', () => action(reset));
  document.getElementById('automated').addEventListener('change', () => action(reset));
  for (const kind of ['tank', 'hopper', 'jet']) document.getElementById(`${kind}-size`).addEventListener('change', () => action(reset));
  document.getElementById('comparison-collision').addEventListener('change', () => action(() => {}));
  document.getElementById('comparison-run').addEventListener('click', () => { if (!failed) { running = !running; controls(); } });
  document.getElementById('comparison-step').addEventListener('click', () => action(step));
  document.getElementById('comparison-second').addEventListener('click', () => action(() => { for (let tick = 0; tick < 60; tick += 1) step(); }));
  document.getElementById('move-left').addEventListener('click', () => action(() => command(true, false)));
  document.getElementById('move-right').addEventListener('click', () => action(() => command(false, true)));
  document.getElementById('move-stop').addEventListener('click', () => action(() => {
    units.forEach(({ unit }) => Object.keys(unit.input).forEach((key) => { unit.input[key] = false; })); pulses = [];
  }));
  document.getElementById('jump-units').addEventListener('click', () => action(() => { pulse('trooper', 'jump'); pulse('hopper', 'jump'); }));
  document.getElementById('boost-hopper').addEventListener('click', () => action(() => pulse('hopper', 'boost')));
  document.getElementById('glide-hopper').addEventListener('change', (event) => action(() => {
    units.find((entry) => entry.kind === 'hopper').unit.input.glide = event.target.checked;
  }));
  for (const [id, key] of [['jet-up', 'up'], ['jet-down', 'down']]) {
    document.getElementById(id).addEventListener('click', () => action(() => {
      const entry = units.find((entry) => entry.kind === 'jet'), state = entry.unit.inspect();
      entry.startY = Math.max(0, Math.min(world.height - state.height, entry.startY + (key === 'up' ? -64 : 64)));
    }));
  }
  for (const [id, key] of [['aim-up', 'aimUp'], ['aim-down', 'aimDown']]) {
    document.getElementById(id).addEventListener('click', () => action(() => pulse('tank', key, 30)));
  }
  document.getElementById('fire-preview').addEventListener('click', () => action(() => {
    weaponFrame = 0; weaponTime = 0; weaponActive = true; pulse('jet', 'shoot', 60); pulse('tank', 'shoot', 60);
  }));
  function fire() {
    if (!aim) { message.textContent = 'Click a point on the preview to aim first.'; return; }
    const kind = document.getElementById('firing-unit').value;
    combat.layGun(kind, aim);
    const result = combat.fire(kind, aim);
    message.textContent = result.ok ? `${kind} fired ${result.kind} toward (${aim.x}, ${aim.y}). Run or Step to advance it.` : result.reason;
    if (result.ok && kind === 'jet') pulse('jet', 'shoot', 24);
  }
  document.getElementById('fire-aim').addEventListener('click', () => action(fire));
  canvas.addEventListener('click', (event) => action(() => {
    aim = getPixelUnitAimPoint(canvas, world, event); fire();
  }));
  new ResizeObserver(() => { if (renderer && world) { renderer.resize(640); draw(); } }).observe(canvas.parentElement);
  function frame(time) {
    try { if (!failed) { clock.advance(time); draw(); fps.record(); } }
    catch (error) { running = false; failed = true; controls(); message.textContent = `Comparison stopped: ${error.message}`; console.error(error); }
    requestAnimationFrame(frame);
  }
  reset(); renderer.resize(640); requestAnimationFrame(frame);
}());
