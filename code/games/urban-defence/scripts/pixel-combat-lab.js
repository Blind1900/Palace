(function () {
  const canvas = document.getElementById('combat-canvas'), context = canvas.getContext('2d');
  const raster = document.createElement('canvas'); raster.width = canvas.width; raster.height = canvas.height;
  const rasterContext = raster.getContext('2d'), image = rasterContext.createImageData(canvas.width, canvas.height);
  const spriteCache = new Map(), status = document.getElementById('combat-status'), selection = document.getElementById('combat-unit');
  const targetSelection = document.getElementById('combat-target'), fireStatus = document.getElementById('combat-fire-status');
  const ownerColors = new Uint32Array(canvas.width * canvas.height);
  const materialCells = new Uint8Array(canvas.width * canvas.height);
  canvas.width *= 4; canvas.height *= 4;
  context.scale(4, 4);
  const measurement = document.getElementById('combat-measurement'), run = document.getElementById('combat-run');
  const viewport = canvas.parentElement, zoomSelection = document.getElementById('combat-zoom');
  let previewZoom = null, pan = null, suppressClick = false;
  let fixture, running = true, failed = false, previous = null, accumulator = 0, rasterTick = -1, diagnosticTime = -Infinity;
  let samples = null, completed = null;
  function controls() {
    run.textContent = running ? 'Pause' : 'Run'; run.setAttribute('aria-pressed', String(running));
    document.getElementById('combat-step').disabled = running || failed;
  }
  function action(operation) {
    try { operation(); }
    catch (error) {
      failed = true; running = false; controls();
      status.textContent = `STOPPED: ${error.message}`; console.error(error);
      if (samples) finishBenchmark(performance.now());
    }
  }
  function zoom() {
    const value = zoomSelection.value;
    previewZoom = value === 'fit' ? null : Number(value);
    canvas.style.width = value === 'fit' ? '100%' : `${raster.width * Number(value)}px`;
    document.getElementById('combat-zoom-status').textContent = value === 'fit' ? 'Fit area' : `${Math.round(previewZoom * 100)}%`;
  }
  function zoomAt(value, clientX, clientY) {
    const bounds = canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width, y = (clientY - bounds.top) / bounds.height;
    previewZoom = Math.max(0.25, Math.min(8, value));
    canvas.style.width = `${raster.width * previewZoom}px`;
    zoomSelection.value = Array.from(zoomSelection.options).some((option) =>
      option.value === String(previewZoom)) ? String(previewZoom) : 'custom';
    const resized = canvas.getBoundingClientRect();
    viewport.scrollLeft += resized.left + x * resized.width - clientX;
    viewport.scrollTop += resized.top + y * resized.height - clientY;
    document.getElementById('combat-zoom-status').textContent = `${Math.round(previewZoom * 100)}%`;
  }
  function reset() {
    if (samples) { samples = null; measurement.textContent = 'Measurement cancelled by fixture reset.'; }
    fixture = createPixelCombatFixture({ terrain: document.getElementById('combat-scenario').value });
    spriteCache.clear(); running = true; failed = false; previous = null;
    document.getElementById('combat-spawn-status').textContent = '';
    fireStatus.textContent = '';
    selection.replaceChildren(); targetSelection.replaceChildren();
    ownerColors.fill(0);
    for (const [key, owned] of fixture.ownership) {
      ownerColors[key] = owned.role === 'core' ? 0xff72cde6 : owned.building.type === 'farm' ?
        0xffd6c68b : owned.building.owner === 'blue' ? 0xffa29361 : 0xff6c739e;
    }
    accumulator = 0; rasterTick = -1; diagnosticTime = -Infinity;
    if (!document.getElementById('combat-spawning').checked ||
        !document.getElementById('combat-transporting').checked) {
      for (const base of fixture.bases) fixture.spawn(base, 'trooper');
    }
    applyControls(); controls();
  }
  function applyControls() {
    fixture.configure({ spawning: document.getElementById('combat-spawning').checked,
      devices: document.getElementById('combat-devices').checked, fighting: document.getElementById('combat-fighting').checked,
      transporting: document.getElementById('combat-transporting').checked });
  }
  function sprite(state, key, loadPixels) {
    let cached = spriteCache.get(key);
    if (!cached) {
      state = { ...state, pixels: loadPixels() };
      if (spriteCache.size >= 512) spriteCache.clear();
      const minX = Math.min(...state.pixels.map((pixel) => pixel.x)), minY = Math.min(...state.pixels.map((pixel) => pixel.y));
      const maxX = Math.max(...state.pixels.map((pixel) => pixel.x)), maxY = Math.max(...state.pixels.map((pixel) => pixel.y));
      const sourceScale = state.cellReduction, width = maxX - minX + 1, height = maxY - minY + 1;
      const art = document.createElement('canvas'); art.width = width * sourceScale; art.height = height * sourceScale;
      const ctx = art.getContext('2d');
      let groundBottom = 0;
      for (const pixel of state.pixels) for (const detail of pixel.details || [{ x: 0, y: 0, size: 1, color: pixel.color }]) {
        const rgb = detail.color & 0xffffff;
        ctx.fillStyle = state.hitFlash ? '#ff3535' : rgb === 0 ? state.tintColor : `#${rgb.toString(16).padStart(6, '0')}`;
        ctx.globalAlpha = (detail.color >>> 24) / 255;
        ctx.fillRect((pixel.x + detail.x - minX) * sourceScale, (pixel.y + detail.y - minY) * sourceScale,
          detail.size * sourceScale, detail.size * sourceScale);
        groundBottom = Math.max(groundBottom, pixel.y + detail.y + detail.size);
      }
      cached = { art, x: minX, y: minY, width, height, groundBottom }; spriteCache.set(key, cached);
    }
    const offset = state.grounded && state.kind !== 'jet' ? state.footRow - cached.groundBottom : 0;
    context.drawImage(cached.art, state.x + cached.x, state.y + cached.y + offset, cached.width, cached.height);
    return { ...cached, y: cached.y + offset };
  }
  function draw() {
    if (rasterTick < 0 || fixture.ticks - rasterTick >= 2) {
      const colors = [0xff1d1910, 0xff384b44, 0xffc8ac1f, 0xff7be7bc, 0xff5990c4, 0xffb1f9ef, 0xff197bbf];
      const buffer = new Uint32Array(image.data.buffer);
      fixture.world.copyCells(materialCells);
      for (let y = 0; y < fixture.world.height; y += 1) for (let x = 0; x < fixture.world.width; x += 1) {
        const key = y * fixture.world.width + x, material = materialCells[key];
        buffer[key] = material === PARTICLE_BARRIER && ownerColors[key] ? ownerColors[key] : colors[material];
        if (material === PARTICLE_TERRAIN && y > 0 && materialCells[key - fixture.world.width] !== PARTICLE_TERRAIN) buffer[key] = 0xff5fc13f;
      }
      rasterContext.putImageData(image, 0, 0);
      drawPixelBuildingFacades(rasterContext, fixture.world, fixture.buildingLayers);
      for (const building of fixture.buildings) {
        if (!building.core.every((cell) => fixture.world.at(cell.x, cell.y) === PARTICLE_BARRIER)) continue;
        for (const detail of building.details) {
          rasterContext.fillStyle = detail.color; rasterContext.fillRect(detail.x, detail.y, detail.width, detail.height);
        }
      }
      for (const base of fixture.bases) {
        rasterContext.fillStyle = fixture.activeCore(base) ? '#ffa414' : '#ed795e';
        rasterContext.font = '11px system-ui';
        rasterContext.fillText(`${base.owner.toUpperCase()} HANGAR`, base.frame.left + 32, base.frame.top + 20);
        rasterContext.fillStyle = '#8bc6d6';
        rasterContext.fillRect(base.origin.x - 5, base.origin.y + 5, 10, 11);
        rasterContext.fillRect(base.origin.x + 21, base.origin.y + 6, 7, 10);
      }
      for (const road of fixture.roads.cells) {
        if (fixture.world.at(road.x, road.y) !== PARTICLE_TERRAIN ||
            fixture.world.at(road.x, road.y - 1) !== PARTICLE_EMPTY) continue;
        rasterContext.fillStyle = road.owner === 'blue' ? '#8babb2' : '#bc8d85';
        rasterContext.fillRect(road.x, road.y - 1, 1, 1);
      }
      rasterTick = fixture.ticks;
    }
    context.imageSmoothingEnabled = false; context.drawImage(raster, 0, 0);
    for (const entry of fixture.units) {
      const physical = entry.unit.inspect({ sprites: false }), health = fixture.combat.health(entry.id);
      const state = physical.transportPhase ? { ...physical, x: physical.renderX, y: physical.renderY } : physical;
      const flashing = health.hitFlash > 0;
      const visible = withPixelBuildingOcclusion(context, fixture.world, { ...state, kind: entry.kind },
        entry.owner, fixture.buildingLayers, () => sprite({ ...state, kind: entry.kind, cellReduction: fixture.artworks.get(entry.kind).cellReduction,
        hitFlash: flashing, tintColor: entry.owner === 'blue' ? '#8bc6d6' : '#ed795e' },
        `${entry.kind}:${state.animation}:${state.frame}:${state.facing}:${state.aim}:${state.turret}:${state.hatch}:${state.heading}:${entry.owner}:${flashing}:${state.transportPhase}:${state.carryFrame}`,
        () => entry.unit.inspect().pixels));
      const left = state.x + visible.x, top = state.y + visible.y, width = visible.width;
      context.fillStyle = '#ed795e'; context.fillRect(left, top - 4, width, 2);
      context.fillStyle = '#3fc15f'; context.fillRect(left, top - 4, width * health.health / health.maxHealth, 2);
      if (entry.kind === 'tank') {
        context.fillStyle = '#fff1aa'; context.font = '10px system-ui';
        context.fillText(`Troops ${entry.cargo.length}/3`, left, top - 8);
      }
      if (entry.id === selection.value || entry.id === targetSelection.value) {
        context.strokeStyle = entry.id === selection.value ? '#8bc6d6' : '#e6cd72';
        context.strokeRect(left - 2.5, top - 6.5, width + 5, visible.height + 9);
      }
    }
    const combat = fixture.combat.inspect();
    drawPixelProjectileTrails(context, combat.trails);
    drawPixelUnitDeathEffects(context, combat.deathParticles, combat);
    for (const shot of combat.shots) {
      context.fillStyle = shot.kind === 'fragment' ? '#ed795e' : !isPixelInterceptorShot(shot) ? '#e6cd72' : '#8bc6d6';
      for (const pixel of shot.pixels) context.fillRect(Math.round(shot.x) + pixel.x, Math.round(shot.y) + pixel.y, 1, 1);
    }
    for (const hit of combat.impacts) {
      if (combat.ticks - hit.tick > 20 || hit.reason === 'crop edge') continue;
      context.strokeStyle = hit.reason === 'unit' ? '#ed795e' : hit.reason === 'interception' ? '#8bc6d6' : '#e6cd72';
      context.strokeRect(hit.x - 3.5, hit.y - 3.5, 7, 7);
    }
  }
  function updateOptions(select, ids) {
    if (Array.from(select.options).map((option) => option.value).join() === ids.join()) return;
    const chosen = select.value;
    select.replaceChildren(...ids.map((id) => new Option(id, id)));
    if (ids.includes(chosen)) select.value = chosen;
  }
  function selectedUnits() {
    updateOptions(selection, fixture.units.map((entry) => entry.id));
    const shooter = fixture.units.find((entry) => entry.id === selection.value);
    updateOptions(targetSelection, fixture.units.filter((entry) => shooter && entry.owner !== shooter.owner).map((entry) => entry.id));
    const target = fixture.units.find((entry) => entry.id === targetSelection.value);
    document.getElementById('combat-fire-target').disabled = failed || !shooter || !target;
    document.getElementById('combat-selected').textContent = [shooter, target].filter(Boolean).map((entry) => {
      const state = entry.unit.inspect({ sprites: false }), health = fixture.combat.health(entry.id);
      return `${entry === shooter ? 'Firing' : 'Target'} ${entry.id}: HP ${health.health}/${health.maxHealth}, reload ${health.reload.toFixed(2)}s; ` +
        `position ${state.x}, ${state.y}; road speed ${fixture.roads.multiplier(state).toFixed(2)}x; ${entry.tactic}` +
        `; debris speed ${pixelUnitDebrisDrag(fixture.world, state.x, state.y, state.collision).toFixed(2)}x; falling damage ${entry.debrisDamage}` +
        (entry.kind === 'hopper' ? `; strategy: ${entry.strategyMemory.phase}; route: ${state.navigation}` : '');
    }).join('\n') || 'No living units available.';
  }
  function fireAt(point) {
    if (failed) return;
    const shooter = fixture.units.find((entry) => entry.id === selection.value);
    if (!shooter) {
      fireStatus.textContent = 'Cannot fire: selected unit is no longer alive.';
      selectedUnits(); return;
    }
    fixture.combat.layGun(shooter.id, point);
    const result = fixture.combat.fire(shooter.id, point);
    fireStatus.textContent = result.ok ? `${shooter.id} fired at ${Math.round(point.x)}, ${Math.round(point.y)}.` : `Cannot fire: ${result.reason}.`;
    selectedUnits();
  }
  function diagnostics(time) {
    if (time - diagnosticTime < 250) return;
    diagnosticTime = time;
    const audit = fixture.audit();
    selectedUnits();
    document.getElementById('combat-impacts').textContent = audit.impacts.slice(-8).reverse().map((hit) => {
      const material = ['empty', 'terrain', 'water', 'structure', 'debris', 'construction'][hit.material];
      const destination = hit.targetId ? `${hit.targetId}: -${hit.damage} HP, ${hit.health} remaining` :
        hit.reason === 'material' ? material : hit.reason;
      return `Tick ${hit.tick} ${hit.shooterId} ${hit.kind} -> ${destination} at ${hit.x}, ${hit.y}; ` +
        `debris: ${hit.particles.structure} structure + ${hit.particles.terrain} terrain + ${hit.particles.ammo} ammo; scattered ${hit.fragments}`;
    }).join('\n') || 'No projectile impacts yet.';
    document.getElementById('combat-behavior').textContent =
      `Passengers loaded ${fixture.transport.loaded}, deployed ${fixture.transport.deployed}, lost with carrier ${fixture.transport.lost}.\n` +
      fixture.units.filter((entry) => entry.kind === 'tank').map((entry) =>
        `${entry.id}: ${entry.cargo.length}/3 onboard; ${entry.airliftStatus || entry.transportStatus || 'Awaiting automatic loading'}`).join('\n') +
      `\nHopper airlifts: ${fixture.airlift.inspect().pickups} pickups, ${fixture.airlift.inspect().deliveries} safe landings, ` +
        `${fixture.airlift.inspect().active} active, ${fixture.airlift.inspect().losses} interrupted.\n` +
      fixture.airlift.inspect().events.slice(-4).map((event) =>
        `${event.hopperId} + ${event.tankId}: ${event.reason}`).join('\n') +
      `\nDeaths ${audit.deaths}; visible effect particles ${audit.deathParticles.length}/512; cap-suppressed ${audit.suppressedDeathParticles}.\n` +
      audit.deathEvents.slice(-6).reverse().map((event) =>
        `Tick ${event.tick}: ${event.id} ${event.effect} (${event.reason})`).join('\n') +
      '\n' + fixture.transport.events.slice(-6).reverse().map((event) =>
        `Tick ${event.tick}: ${event.id} ${event.action}: ${event.count}`).join('\n');
    status.textContent = `Tick ${fixture.ticks}; ${fixture.livingCount('blue') + fixture.livingCount('red')}/8 living units (including passengers); shots ${audit.fired}, in flight ${audit.shots.length}/128; interceptions ${audit.intercepted}; fragments ${audit.scattered} (${audit.suppressedFragments} suppressed by cap).\n` +
      fixture.bases.map((base) => `${base.owner}: ${fixture.activeCore(base) ? 'living core' : 'DESTROYED CORE'}, issued ${base.spawned}/64; ${base.spawnStatus}`).join(' | ') + '\n' +
      `Water ${fixture.world.waterCount}/${fixture.initial.water}; terrain + converted - merged ${fixture.world.terrainCount + audit.terrainDebris - fixture.world.mergedDebrisCount}/${fixture.initial.terrain}.\n` +
      `Material including merged ground ${fixture.world.barrierCount + fixture.world.constructionCount + fixture.world.debrisCount + fixture.world.mergedDebrisCount}/` +
      `${fixture.initial.material + audit.terrainDebris + audit.issuedAmmoDebris}; building hits ${audit.damagedStructure}; terrain debris ${audit.terrainDebris}; ammo debris ${audit.issuedAmmoDebris}; merged ground ${fixture.world.mergedDebrisCount}.\n` +
      fixture.units.map((entry) => `${entry.id}: HP ${fixture.combat.health(entry.id).health} ${entry.unit.inspect({ sprites: false }).state}`).join(' | ');
  }
  function startBenchmark() {
    if (samples) return false;
    reset();
    for (const id of ['combat-spawning', 'combat-devices', 'combat-fighting']) document.getElementById(id).checked = true;
    applyControls();
    samples = { start: performance.now(), startTick: fixture.ticks, frames: 0, intervals: [], costs: [], hidden: false,
      last: null, unitTicks: 0, maxUnits: 0, maxShots: 0 };
    completed = null; measurement.textContent = 'Measuring 30 seconds of ACTIVE combat, including physics, canvas and diagnostics…';
    return true;
  }
  function finishBenchmark(time) {
    const duration = (time - samples.start) / 1000, audit = fixture.audit();
    const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] || 0;
    completed = { durationSeconds: duration, frames: samples.frames, renderFPS: samples.frames / duration,
      simulationHz: (fixture.ticks - samples.startTick) / duration, p95FrameMs: percentile(samples.intervals, 0.95),
      p95WorkMs: percentile(samples.costs, 0.95), fired: audit.fired, interceptions: audit.intercepted,
      unitTicks: samples.unitTicks, maxUnits: samples.maxUnits, maxShots: samples.maxShots,
      damagedStructure: audit.damagedStructure, terrainDebris: audit.terrainDebris,
      valid: !samples.hidden && !failed && audit.fired > 0 && samples.unitTicks > 0, error: failed };
    completed.meets60FPSBudget = completed.valid && completed.renderFPS >= 60 && completed.simulationHz >= 59 &&
      completed.p95FrameMs <= 1000 / 60 && completed.p95WorkMs <= 1000 / 60;
    measurement.textContent = JSON.stringify(completed, null, 2) +
      '\nActual measured rates; a rate below 60 is below target, not rounded up or capped to 60. Headless results are not a hardware-independent guarantee.';
    samples = null;
  }
  function frame(time) {
    const workStart = performance.now();
    try {
      if (!failed) {
        if (previous !== null && running && !document.hidden) {
          accumulator += Math.min(100, time - previous);
          while (accumulator + 1e-8 >= 1000 / 60) {
            fixture.step(); accumulator -= 1000 / 60;
            if (samples) samples.unitTicks += fixture.units.length;
          }
        }
        previous = time; draw(); diagnostics(time);
        if (samples) {
          samples.frames += 1; samples.hidden = samples.hidden || document.hidden;
          if (samples.last !== null) samples.intervals.push(time - samples.last);
          samples.last = time; samples.costs.push(performance.now() - workStart);
          const audit = fixture.combat.inspect({ sprites: false });
          samples.maxUnits = Math.max(samples.maxUnits, fixture.units.length);
          samples.maxShots = Math.max(samples.maxShots, audit.shots.length);
          if (performance.now() - samples.start >= 30000) finishBenchmark(performance.now());
        }
      }
    } catch (error) {
      failed = true; running = false; controls(); status.textContent = `STOPPED: ${error.message}`; console.error(error);
      if (samples) finishBenchmark(performance.now());
    }
    requestAnimationFrame(frame);
  }
  run.addEventListener('click', () => { if (!failed) { running = !running; previous = null; controls(); } });
  document.getElementById('combat-step').addEventListener('click', () => action(() => { fixture.step(); rasterTick = -1; diagnosticTime = -Infinity; diagnostics(performance.now()); draw(); }));
  document.getElementById('combat-reset').addEventListener('click', () => action(reset));
  zoomSelection.addEventListener('change', () => { if (zoomSelection.value !== 'custom') zoom(); });
  canvas.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
    zoomAt((previewZoom === null ? bounds.width / raster.width : previewZoom) * Math.exp(-delta * 0.0015),
      event.clientX, event.clientY);
  }, { passive: false });
  document.getElementById('combat-fit').addEventListener('click', () => {
    zoomSelection.value = 'fit'; zoom(); viewport.scrollLeft = 0; viewport.scrollTop = 0;
  });
  canvas.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    if (event.button !== 1 && !(event.button === 0 && event.shiftKey)) return;
    event.preventDefault();
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: viewport.scrollLeft, top: viewport.scrollTop, button: event.button };
    canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pan || pan.id !== event.pointerId) return;
    viewport.scrollLeft = pan.left - (event.clientX - pan.x);
    viewport.scrollTop = pan.top - (event.clientY - pan.y);
  });
  const endPan = (event) => {
    if (!pan || pan.id !== event.pointerId) return;
    suppressClick = event.type === 'pointerup' && pan.button === 0;
    pan = null; canvas.style.cursor = '';
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  canvas.addEventListener('lostpointercapture', endPan);
  for (const select of [selection, targetSelection]) select.addEventListener('change', () => action(() => { selectedUnits(); draw(); }));
  document.getElementById('combat-fire-target').addEventListener('click', () => action(() => {
    const target = fixture.units.find((entry) => entry.id === targetSelection.value);
    if (!target) {
      fireStatus.textContent = 'Cannot fire: selected target is no longer alive.';
      selectedUnits(); return;
    }
    const state = target.unit.inspect();
    const pixel = state.pixels[Math.floor(state.pixels.length / 2)];
    fireAt({ x: state.x + pixel.x, y: state.y + pixel.y });
  }));
  document.getElementById('combat-spawn').addEventListener('click', () => action(() => {
    if (failed) return;
    const owner = document.getElementById('combat-owner').value;
    const base = fixture.bases.find((entry) => entry.owner === owner);
    const result = fixture.spawn(base, document.getElementById('combat-kind').value);
    document.getElementById('combat-spawn-status').textContent = result.ok ?
      `Spawned ${result.entry.id}.` : `Cannot spawn: ${result.reason}.`;
    diagnosticTime = -Infinity; diagnostics(performance.now()); draw();
  }));
  for (const id of ['combat-spawning', 'combat-devices', 'combat-fighting', 'combat-transporting']) document.getElementById(id).addEventListener('change', applyControls);
  document.getElementById('combat-scenario').addEventListener('change', () => action(reset));
  document.getElementById('combat-benchmark').addEventListener('click', () => action(startBenchmark));
  document.getElementById('combat-core').addEventListener('click', () => action(() => {
    if (failed) return;
    const base = fixture.bases[0], core = base.frame.core[0];
    // Use the shared impact issuance audit, rather than silently deleting fixture material.
    const result = fixture.combat.launch('red', { x: core.x + 20, y: core.y }, core, { shooterId: 'red-core-test' });
    if (!result.ok) status.textContent = `Cannot launch core impact: ${result.reason}`;
    rasterTick = -1;
  }));
  canvas.addEventListener('click', (event) => {
    if (suppressClick || event.shiftKey) { suppressClick = false; return; }
    if (failed) return;
    action(() => fireAt(getPixelUnitAimPoint(canvas, fixture.world, event)));
  });
  document.addEventListener('visibilitychange', () => { if (samples) samples.hidden = true; previous = null; });
  window.pixelCombatLab = { startBenchmark, get measurement() { return completed; }, get fixture() { return fixture; }, get failed() { return failed; } };
  const scenario = new URLSearchParams(location.search).get('scenario');
  if (scenario === 'dry-route') {
    document.getElementById('combat-scenario').value = scenario;
    document.getElementById('combat-devices').checked = false;
  }
  zoom(); reset(); requestAnimationFrame(frame);
}());
