(function () {
  const canvas = document.getElementById('lab');
  let renderer = createPixelConstructionRenderer(canvas, 300);
  const fps = createLabFps(document.getElementById('fps')), message = document.getElementById('message');
  const controls = ['pause', 'step', 'blast', 'excavate', 'clear', 'restore'].map((id) => document.getElementById(id));
  let city = null, running = false, busy = false, failed = false;
  let worldCombat = null;
  let seedPointer = null, seedPreview = null, previewColumn = null, previewTick = null, previewTime = 0;
  let zoom = 1, baseWidth = 0, baseHeight = 0;
  let fullMap = new URLSearchParams(location.search).get('fullMap') === '1';
  // ?economy=mined: faction buildings start without HM and grow only from mined, piped deliveries.
  const economyMode = new URLSearchParams(location.search).get('economy') === 'mined' ? 'mined' : 'funded';
  // Full-map builder crew "carriers,stride,interval": tall towers need a larger, faster crew than the 6/3/60 lab default.
  const crewParam = (new URLSearchParams(location.search).get('crew') || '18,2,60').split(',').map(Number);
  const buildCrew = crewParam.length === 3 && crewParam.every((value) => Number.isInteger(value) && value >= 1) ?
    { crew: crewParam[0], stride: crewParam[1], deliveryInterval: crewParam[2] } : { crew: 18, stride: 2, deliveryInterval: 60 };
  let economy = null;
  // Manual tunnel tool state: the chosen anchor, the pointer cell and a memoised route quote.
  let digStart = null, digPointer = null, digQuote = null, digQuoteKey = '', digQuoteTime = 0, digOps = [];
  const seedBuilding = () => ({ type: document.getElementById('seed-type').value,
    level: Number(document.getElementById('seed-level').value) });
  const rootSeed = (entry) => entry.seedPlacement[Math.floor((entry.seedPlacement.length / 3 - 1) / 2) * 3 + 1];
  function applyZoom() {
    canvas.style.width = `${baseWidth * zoom}px`;
    canvas.style.height = `${baseHeight * zoom}px`;
    document.getElementById('zoom').textContent = `Map zoom: ${Math.round(zoom * 100)}%`;
  }
  function resizePreview() {
    renderer.resize(576, fullMap ? 4 : 2);
    baseWidth = parseFloat(canvas.style.width);
    baseHeight = parseFloat(canvas.style.height);
    applyZoom();
  }
  const selection = () => Number(document.getElementById('building').value);
  const advance = () => {
    if (worldCombat) worldCombat.step(); else city.step();
    if (economy) economy.step();
  };
  function fitMap() {
    const viewport = document.getElementById('viewport');
    zoom = Math.min(1, viewport.clientWidth / baseWidth, viewport.clientHeight / baseHeight);
    applyZoom();
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }
  function updateControls() {
    document.getElementById('generate').disabled = busy;
    document.getElementById('generate-full').disabled = busy;
    document.getElementById('enable-upkeep').disabled = busy || failed || !city || Boolean(city.inspectUpkeep());
    document.getElementById('fit-map').disabled = busy || failed || !city;
    document.getElementById('world-spawn').disabled = busy || failed || !worldCombat;
    document.getElementById('military-demo').disabled = busy;
    document.getElementById('build-preview').disabled = busy || failed || !city ||
      city.entries.every(({ scenario }) => scenario.finished || scenario.coreDestroyed);
    controls.forEach((button) => { button.disabled = busy || failed || !city; });
    controls[0].textContent = running ? 'Pause' : 'Run simulation';
    controls[0].setAttribute('aria-pressed', String(running));
    controls[1].disabled = controls[1].disabled || running;
    document.getElementById('step-one').disabled = busy || failed || !city || running;
    document.getElementById('focus').disabled = busy || failed || !city;
    document.getElementById('spend-sm').disabled = busy || failed || !city || city.inspectSMStorage().sm < 25;
    const selected = city && city.entries[selection()];
    document.getElementById('level-up').disabled = busy || failed || !selected || !selected.building ||
      !['population', 'military'].includes(selected.building.type) || selected.building.level >= 7 ||
      !selected.scenario.finished || selected.scenario.coreDestroyed;
    if (selected && selected.building && ['population', 'military'].includes(selected.building.type) &&
        !city.isSupplied(selection())) document.getElementById('level-up').disabled = true;
    document.getElementById('level-up').textContent = selected && selected.building && selected.building.type === 'military'
      ? 'Widen / level up military' : 'Level up population';
    document.getElementById('repair-building').disabled = busy || failed || !selected ||
      !selected.scenario.finished || selected.scenario.coreDestroyed ||
      selected.scenario.plan.every((cell) => city.world.at(cell.x, cell.y) === PARTICLE_BARRIER);
    document.getElementById('place-seed').disabled = busy || failed || !city;
    controls[5].disabled = controls[5].disabled || Boolean(economy) || Boolean(city &&
      city.entries.some(({ scenario }) => !scenario.foundationGrowth.complete));
    if (city) {
      const entry = city.entries[selection()];
      for (const [id, count] of [['core', entry.scenario.inspectCore().total / 9], ['floor', entry.floorSections.length]]) {
        const select = document.getElementById(id);
        if (select.options.length !== count) {
          select.replaceChildren();
          for (let index = 0; index < count; index += 1) {
            const option = document.createElement('option');
            option.value = String(index); option.textContent = `${id === 'core' ? 'Core' : 'Span'} ${index + 1}`;
            select.append(option);
          }
        }
      }
    }
  }
  function fail(error) {
    running = false; failed = true; updateControls();
    message.textContent = `City experiment stopped: ${error.message}`; console.error(error);
  }
  let lastText = -Infinity;
  const setText = (id, text) => { const element = document.getElementById(id); if (element.textContent !== text) element.textContent = text; };
  const digActive = () => Boolean(economy && economy.playerTunnels && !busy && !failed &&
    document.getElementById('dig-tunnel').checked);
  // Builds the tunnel-tool overlay (anchor marker plus the routed, priced centre line). Routing costs several ms
  // on the full map, so a quote is only recomputed when the pointer reaches a new cell, at most every 120 ms.
  function updateDigPreview() {
    if (!digActive()) { digOps = []; return false; }
    const owner = document.getElementById('dig-owner').value, [low, high] = economy.zoneLimits(owner);
    digOps = [];
    if (!digStart) {
      const anchor = digPointer && economy.anchorNear(owner, digPointer);
      if (anchor) digOps.push('#7dffb0', anchor.x - 1, anchor.y - 1, 3, 3);
      else if (digPointer) digOps.push('#ff5c5c', digPointer.x - 1, digPointer.y - 1, 3, 3);
      setText('dig-status', anchor ? `Start on ${anchor.type === 'wall' ? 'your tunnel wall' : 'the ground'} at (${anchor.x}, ` +
        `${anchor.y}); click to set it.` : `Point at your ground or tunnel wall within columns ${low}-${high}.`);
      return true;
    }
    digOps.push('#7dffb0', digStart.x - 1, digStart.y - 1, 3, 3);
    if (digPointer) {
      const quoteKey = `${owner}|${digPointer.x}|${digPointer.y}`, now = performance.now();
      if (quoteKey !== digQuoteKey && now - digQuoteTime >= 120) {
        digQuote = economy.quoteTunnel(owner, digStart, digPointer); digQuoteKey = quoteKey; digQuoteTime = now;
      }
    }
    if (digQuote) {
      const color = digQuote.ok ? '#7fd4ff' : '#ff5c5c';
      for (const cell of digQuote.line) digOps.push(color, cell.x, cell.y, 1, 1);
      setText('dig-status', digQuote.ok ? `Route ${digQuote.line.length} cells, ${digQuote.area} px built ` +
        `(${digQuote.premiumArea} px at the gap/building rate): about ${digQuote.price} HM in ${digQuote.chunks} segment(s); ` +
        `storage holds ${digQuote.stock} HM. Click to order.` : `Invalid route: ${digQuote.reason}`);
    } else setText('dig-status', 'Move to a target and click to order the tunnel.');
    return true;
  }
  function draw(throttled = false) {
    if (!city) return;
    // Status text is costly DOM work; the animation loop refreshes it at 4 Hz while actions refresh it immediately.
    const now = performance.now(), updateText = !throttled || now - lastText >= 250;
    if (updateText) lastText = now;
    const scenarios = city.entries.map((entry) => entry.scenario);
    const viewport = canvas.parentElement, shown = canvas.getBoundingClientRect(), port = viewport.getBoundingClientRect();
    const sx = canvas.width / (shown.width || 1), sy = canvas.height / (shown.height || 1);
    const left = Math.max(shown.left, port.left), top = Math.max(shown.top, port.top);
    renderer.setView({ left: (left - shown.left) * sx, top: (top - shown.top) * sy,
      width: (Math.min(shown.right, port.left + viewport.clientWidth) - left) * sx,
      height: (Math.min(shown.bottom, port.top + viewport.clientHeight) - top) * sy });
    renderer.draw({ world: city.world, blueprintCells: () => scenarios.flatMap((scenario) => scenario.blueprintCells()) });
    renderer.markRoads(city.inspectRoads());
    if (economy) {
      const overlay = economy.overlay();
      renderer.markEconomy(updateDigPreview() ? { staticOps: overlay.staticOps, dynamic: overlay.dynamic.concat(digOps) } : overlay);
      if (updateText) {
        const state = economy.inspect(), tunnelHM = state.tunnelHM;
        document.getElementById('economy-status').textContent = `Mined HM economy (tick ${state.ticks}, line ${state.hmDepth} px deep): ` +
          state.factions.map((faction) => faction.ok ? `${faction.owner} entrance x${faction.entranceX}, ore ` +
            `${faction.node.remaining} left${faction.node.connected ? '' : ' (tunnelling)'}` :
            `${faction.owner} tunnels failed: ${faction.reason}`).join('; ') + '. ' +
          state.sites.map((site) => `${site.node} storage ${site.stored}/${site.capacity} (${site.state})`).join('; ') +
          `. Piped ${state.withdrawn}, in transit ${state.inTransit}, cellars ${state.stored}, handed to buildings ` +
          `${state.transferred}; audit ${state.ok ? 'conserved' : 'FAILED'}. ` +
          state.cellars.map((cellar) => `B${cellar.index + 1} cellar ${cellar.stored}/${cellar.capacity}, ` +
            `building ${cellar.buildingHM} HM (${cellar.state})`).join('; ') +
          (state.unserved.length ? `. No cellar for buildings ${state.unserved.map((index) => index + 1).join(', ')}` : '') +
          `. Tunnels (${state.playerTunnels ? 'player and AI' : 'AI only'}): prepaid ${tunnelHM.prepaid} HM, billed ` +
          `${tunnelHM.billed}, paid ${tunnelHM.paid}, debt blue ${tunnelHM.debt.left} / red ${tunnelHM.debt.right}` +
          (state.orders.length ? '; orders ' + state.orders.map((order) => `#${order.id} ${order.owner} ${order.segments} ` +
            `paid ${order.paid}/${order.estimate} HM (${order.state})`).join('; ') : '');
      }
    }
    renderer.markUrbanDetails(city.inspectUrbanDetails());
    const upkeep = city.inspectUpkeep();
    renderer.markBuildingSupplies(city.entries, upkeep);
    if (updateText) document.getElementById('supply-status').textContent = upkeep ?
      `Total upkeep ${upkeep.upkeepPerMinute} SM/min; in buildings ${upkeep.stored}, carried ${upkeep.carried}, ` +
      `consumed ${upkeep.consumed}. ` + upkeep.buildings.map((entry) =>
        `${entry.type} ${entry.index + 1}: ${entry.sm}/${entry.capacity} SM, ${entry.hm} HM; ${entry.state}`).join('; ') :
      'SM supply simulation is enabled in the full-map lab; smaller legacy construction fixtures remain unchanged.';
    for (let index = 0; index < city.entries.length; index += 1) {
      const farm = city.inspectFarm(index);
      if (farm) { renderer.markFarm(farm); renderer.markFarmStorage(farm, city.world); }
    }
    if (worldCombat) {
      worldCombat.buildingLayers.refresh();
      renderer.markBuildingFacades(city.world, worldCombat.buildingLayers);
      renderer.markArchitecture(city.entries, worldCombat.styles);
    }
    renderer.markLoads(city.world);
    const military = city.inspectMilitary();
    if (document.getElementById('defenses').checked) renderer.markMilitary(military);
    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      renderer.markCore(scenario); renderer.markTransported(scenario);
      if (!scenario.foundationGrowth.complete) renderer.markSelected(rootSeed(city.entries[index]));
    }
    if (worldCombat) {
      const combatState = worldCombat.combat.inspect();
      renderer.markProjectileTrails(combatState.trails);
      renderer.markUnitDeathEffects(combatState.deathParticles, combatState);
      for (const entry of worldCombat.units) renderer.markUnit({ ...entry.unit.inspect(),
        kind: entry.kind, hitFlash: worldCombat.combat.health(entry.id).hitFlash > 0 }, false,
        { snap: true, world: city.world, buildingLayers: worldCombat.buildingLayers });
      for (const shot of combatState.shots) renderer.markUnit({ ...shot, x: Math.round(shot.x), y: Math.round(shot.y) }, false, { snap: true });
      const selector = document.getElementById('world-unit');
      const ids = worldCombat.units.map((entry) => entry.id);
      if ([...selector.options].map((option) => option.value).join() !== ids.join()) {
        const value = selector.value;
        selector.replaceChildren(...ids.map((id) => new Option(id, id)));
        if (ids.includes(value)) selector.value = value;
      }
      if (updateText) document.getElementById('world-combat-status').textContent =
        `Styles: blue ${worldCombat.styles.left}, red ${worldCombat.styles.right}, neutral ${worldCombat.styles.neutral}. ` +
        `Units ${worldCombat.units.length}; fired ${combatState.fired}; in flight ${combatState.shots.length}; ` +
        `retained trails ${combatState.trails.length}; intercepted ${combatState.intercepted}; ` +
        `structure hits ${combatState.damagedStructure}, terrain debris ${combatState.terrainDebris}, ammo debris ${combatState.issuedAmmoDebris}. ` +
        `Airlifts: ${worldCombat.airlift.inspect().pickups} pickups, ${worldCombat.airlift.inspect().deliveries} safe landings. ` +
        worldCombat.bases.map((base) => `${base.owner} base: ${base.status}`).join('; ') +
        worldCombat.units.filter((entry) => entry.airliftStatus || entry.kind === 'hopper').map((entry) =>
          `; ${entry.id}: ${entry.airliftStatus || entry.tactic}`).join('') +
        (worldCombat.scaleTrooper ? `; scale trooper beside population ${worldCombat.scaleTrooper.towerIndex + 1}, ` +
          `standing artwork ${worldCombat.scaleTrooper.unit.inspect().pixels.length} occupied pixels; tower ` +
          `${city.entries[worldCombat.scaleTrooper.towerIndex].building.height} cells / ${city.entries[worldCombat.scaleTrooper.towerIndex].building.trooperHeight} cells tall.` : '');
    }
    const diagnostics = inspectPixelMapDiagnostics(city.entries[selection()]);
    renderer.markWaiting(diagnostics.deliveries); renderer.markDiagnostics(diagnostics);
    if (document.getElementById('preview').checked) renderer.markPlacement(city.entries[selection()]);
    const growthInspection = scenarios[selection()].inspectFoundationGrowth();
    if (growthInspection.next) renderer.markSelected(growthInspection.next);
    if (updateText) {
    const next = growthInspection.next;
    const blocker = growthInspection.blocker;
    document.getElementById('growth').textContent =
      `Selected building ${selection() + 1} growth at tick ${growthInspection.tick}: ` +
      (growthInspection.stopped ? 'permanently stopped' : growthInspection.complete ? 'foundation complete' :
        next ? `next pixel (${next.x}, ${next.y})` : 'finishing excavation column') +
      (blocker ? `; blocked at (${blocker.x}, ${blocker.y}): ${blocker.reason}, ` +
        `${['empty', 'terrain', 'water', 'settled building', 'fallen debris', 'moving material'][blocker.material]}` : '') +
      `. Cores: ${growthInspection.cores.map((core, index) =>
        `${index + 1}: ${core.formed} formed, ${core.pending} pending, ${core.surviving} surviving` +
        (core.parent === null ? '' : ` (branches from ${core.parent + 1})`)).join('; ')}. ` +
      `Terrain cells dug by seed growth: ${growthInspection.excavation.removed}/${growthInspection.excavation.total}.`;
    document.getElementById('status').textContent = scenarios.map((scenario, index) => {
      const core = scenario.inspectCore();
      const settled = scenario.plan.filter((cell) => city.world.at(cell.x, cell.y) === PARTICLE_BARRIER).length;
      const growth = scenario.foundationGrowth;
      return `Building ${index + 1} | Tick ${scenario.ticks} | Settled ${settled}/${scenario.plan.length} | ` +
        `Moving ${scenario.transportedMaterialCount} | HM ${scenario.hm} | Core ${core.surviving}/${core.total} | ` +
        (city.entries[index].building ? `${city.entries[index].building.type} level ${city.entries[index].building.level}` +
          `${city.entries[index].building.variant ? ` (${city.entries[index].building.variant})` : ''}, ` +
          `${city.entries[index].building.cores} cores, width ${city.entries[index].building.width} | ` : '') +
        (core.destroyed ? 'Core destroyed: permanently stopped' : !growth.complete
          ? `Seed growth ${growth.placed}/${growth.total}: ${growth.phase}${growth.blocked ? `; ${growth.blocked}` : ''}`
          : scenario.finished ? 'Complete' : scenario.message);
    }).join('\n');
    const free = scenarios.reduce((sum, scenario) => sum + scenario.freeMaterial, 0);
    const paid = scenarios.reduce((sum, scenario) => sum + scenario.spent, 0);
    document.getElementById('accounting').textContent =
      `Accounting verified: ${city.initialWater} shared water conserved; physical material + all paid deliveries + ` +
      `${city.destroyed} destroyed + ${city.cleared} cleared = ${free} free foundation + ${paid} paid material. Independent HM charges verified.`;
    if (worldCombat) {
      const state = worldCombat.combat.inspect({ sprites: false });
      document.getElementById('accounting').textContent +=
        ` Combat additions accounted separately: ${state.terrainDebris} converted terrain + ${state.issuedAmmoDebris} ammo debris.`;
      document.getElementById('accounting').textContent +=
        ` ${city.world.mergedDebrisCount} settled rubble pixels retained as new ground.`;
    }
    const farm = city.inspectFarm(selection());
    const storage = city.inspectSMStorage();
    document.getElementById('sm-storage').textContent =
      `Shared SM storage: ${storage.sm}/${storage.capacity}. Produced ${storage.totalProduced}, spent ${storage.totalSpent}.` +
      (storage.overflow ? ` ${storage.overflow} SM overflow after storage damage; production paused.` : '');
    document.getElementById('roads').textContent =
      `Automatic population roads: ${city.inspectRoads().length} connections across dry gaps of at most 40 columns.`;
    document.getElementById('military').textContent = military.bases.length ? military.bases.map((base) =>
      `Military ${base.owner + 1}, level ${base.level}: ${base.state}; ${base.placements} defense placements, range ${base.reach} columns, ` +
      `up to ${base.neighborLimit} roof neighbors, ground spacing at least ${base.groundSpacing} columns. ` +
      base.hosts.map((host) => `Building ${host.host + 1} (${host.type}): ${host.placed} placements, ${host.state}` +
        (host.missing.length ? `; unavailable ${host.missing.map((item) => `${item.count} ${item.type}`).join(', ')}: no intact, clear roof slot` : '')).join('; ') +
      '\nGround outer-to-inner: ' + ['turret', 'missile-launcher', 'interceptor', 'guard'].map((type) => {
        const bands = base.ground.filter((band) => band.type === type);
        return `${type} ${bands.reduce((sum, band) => sum + band.placed, 0)}/${bands.reduce((sum, band) => sum + band.wanted, 0)}` +
          (bands.some((band) => band.missing) ? ' (space, water or support limited)' : '');
      }).join('; ')
    ).join('\n') + '\nPlacement preview only: no firing, interception, troop movement, hacking, HM or SM charges.'
      : 'No added military base. Place a military seed and complete construction to preview rooftop defenses.';
    document.getElementById('farm').textContent = farm
      ? `Farm level ${farm.level}: ${farm.completedSilos}/${farm.silos} completed silos (${farm.desiredSilos} level target); ${farm.state}. Wheat fields ${farm.fields.length}/${farm.capacity} water-supported columns; ` +
        `${farm.sources.filter((source) => source.kind !== 'pump').length} basin and ` +
        `${farm.sources.filter((source) => source.kind === 'pump').length} cave-pump connections` +
        (farm.sources.some((source) => source.kind === 'pump') ? ` (lift ${farm.sources.filter((source) => source.kind === 'pump')
          .map((source) => source.lift).join('/')} cells)` : '') + `, pipe reach ${farm.reach} cells. ` +
        `Shared SM ${farm.storage.sm}/${farm.storage.capacity}; this farm produced ${farm.food} SM; current rate ${farm.rate.toFixed(2)} SM/minute. ` +
        (farm.storage.overflow ? `${farm.storage.overflow} SM above damaged storage capacity; spend it before production resumes. ` : '') +
        'Crops and pipes are a separate lab farm layer, not structural material or an HM charge.'
      : '';
    document.getElementById('selected').textContent =
      `Selected building ${selection() + 1}: ${diagnostics.stranded} stranded, ${diagnostics.yielding} yielding; ` +
      `shared peak load ${city.world.structuralLoad.maximum.toFixed(2)}/128; ${city.world.structuralLoad.failed} overload failures. ` +
      `Selected floor terrain contacts: ${diagnostics.floors.map((floor) => `${floor.contacts}/${floor.total}`).join('; ')}. ` +
      `Original seed sites (x, y) directly above local ground: ${city.entries[selection()].seedPlacement
        .filter((cell, index) => index % 3 === 0).map((cell) =>
          `(${cell.x}-${cell.x + 2}, ${cell.y}), original ground row ${cell.groundY}`).join('; ')}. ` +
      'Seed growth creates the free foundation allowance progressively; later deliveries cost HM.';
    }
    updateControls();
    if (seedPointer && document.getElementById('place-seed').checked) {
      const x = Math.floor(seedPointer.x), tick = city.entries[0].scenario.ticks;
      if (x !== previewColumn || tick !== previewTick && performance.now() - previewTime >= 200) {
        seedPreview = city.addSeed(x, true, seedBuilding());
        previewColumn = x; previewTick = tick; previewTime = performance.now();
      }
      let surfaceY = seedPreview.surfaceY;
      if (surfaceY === undefined) {
        surfaceY = 0;
        while (surfaceY < city.world.height &&
          ![PARTICLE_TERRAIN, PARTICLE_BARRIER].includes(city.world.at(x, surfaceY))) surfaceY += 1;
      }
      renderer.markSeedGuide(seedPointer, surfaceY, seedPreview.ok);
      document.getElementById('placement').textContent = seedPreview.ok
        ? `Valid seed site at column ${x}: ${seedPreview.building.cores} cores, width ${seedPreview.building.width}. Click to begin growth.`
        : `Invalid seed site at column ${x}: ${seedPreview.reason}`;
    } else document.getElementById('placement').textContent = '';
  }
  let clock = createFixedStepClock(() => { if (running && city && !busy && !failed) advance(); });
  function action(operation) {
    try { operation(); city.verify(); draw(); } catch (error) { fail(error); }
  }
  async function generate() {
    busy = true; failed = false; running = false; city = null; worldCombat = null; economy = null; updateControls();
    document.getElementById('world-combat-controls').hidden = !fullMap;
    document.getElementById('tunnel-controls').hidden = true;
    digStart = null; digPointer = null; digQuote = null; digQuoteKey = '';
    document.getElementById('world-combat-status').textContent = '';
    document.getElementById('world-combat-message').textContent = '';
    seedPointer = null; seedPreview = null; previewColumn = null;
    const buildings = document.getElementById('building');
    while (buildings.options.length > 3) buildings.remove(3);
    buildings.value = '0';
    ['source', 'status', 'accounting', 'selected', 'growth', 'farm', 'placement', 'sm-storage', 'roads', 'military'].forEach((id) => { document.getElementById(id).textContent = ''; });
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    message.textContent = fullMap ? 'Importing the full pixel world and searching for supported building sites...'
      : 'Generating terrain and searching for three compatible building sites...';
    const frame = document.createElement('iframe'); frame.hidden = true; frame.title = 'Isolated city terrain generator';
    frame.src = 'index.html?particleMapLab=1';
    let timeout;
    try {
      const loaded = new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('City map generator timed out')), 15000);
        frame.onload = resolve; frame.onerror = () => reject(new Error('Could not load city terrain generator'));
      });
      document.body.append(frame); await loaded;
      if (typeof frame.contentWindow.readParticleMapSource !== 'function') throw new Error('City terrain generator did not initialize');
      const originalSource = frame.contentWindow.readParticleMapSource();
      const source = fullMap ? preparePixelSkyscraperSource(originalSource, PIXEL_UNIT_REFERENCE) : originalSource;
      if (fullMap) source.architectureStyles = createFactionArchitectureStyles();
      city = createSharedPixelMapConstruction(source, { seedGrowth: true, fullMap,
        economy: fullMap ? economyMode : 'funded', crew: fullMap ? buildCrew : undefined,
        waterCaves: new URLSearchParams(location.search).get('caves') !== '0' });
      economy = null;
      if (fullMap) {
        worldCombat = createPixelGeneratedCombat(city, source);
        const checks = runPixelFullWorldChecks(city, worldCombat, source);
        document.getElementById('world-results').textContent = checks.join('\n');
        if (checks.some((line) => line.startsWith('FAIL'))) throw new Error('Full-world regression failed; inspect the results.');
        configureCombat();
        if (economyMode === 'mined') {
          const nodeHM = Number(new URLSearchParams(location.search).get('nodeHM'));
          economy = createPixelFullMapEconomy(city, { ...(Number.isInteger(nodeHM) && nodeHM > 0 ? { nodeHM } : {}),
            tunnels: new URLSearchParams(location.search).get('tunnels') === 'ai' ? 'ai' : 'player' });
          document.getElementById('tunnel-controls').hidden = !economy.playerTunnels;
        }
      }
      buildings.replaceChildren();
      city.entries.forEach((entry, index) => {
        const option = document.createElement('option');
        option.value = String(index); option.textContent = `Building ${index + 1}`;
        buildings.append(option);
      });
      buildings.value = '0';
      renderer = createPixelConstructionRenderer(canvas, city.world.width, city.world.height);
      document.getElementById('source').textContent =
        `${fullMap ? 'Full pixel world' : 'Shared crop'} ${city.world.width}-by-${city.world.height}, ` +
        `${city.entries.length} physical building plans, origin (${city.originX * 4}, ${city.originY * 4}) world units; ` +
        `all ${city.terrainIntegrity.checked} planned placement cells audited. ` +
        `${city.terrainIntegrity.excavated} terrain cells scheduled for intentional progressive basement excavation. ` +
        `Placement search: ${city.siteSearch.suitable}/${city.siteSearch.scanned} individually suitable sites; ` +
        `${city.siteSearch.slope} height-range, ${city.siteSearch.unevenBase} uneven-base, ` +
        `${city.siteSearch.wetSeed} flooded-seed and ${city.siteSearch.footprint} full-clearance rejections.`;
      clock = createFixedStepClock(() => { if (running && !busy && !failed) advance(); });
      zoom = 1;
      fps.reset(performance.now()); resizePreview();
      if (fullMap) fitMap();
      draw();
      message.textContent = `${city.entries.length} seed sites ready, paused. Run to grow middle cores, outward floors and adjacent cores before paid construction.`;
    } catch (error) { fail(error); }
    finally { clearTimeout(timeout); frame.remove(); busy = false; updateControls(); }
  }
  document.getElementById('generate').addEventListener('click', () => { fullMap = false; generate(); });
  // Read-only hooks for headless checks of the mined economy.
  window.pixelCityMapLab = { get city() { return city; }, get economy() { return economy; },
    get combat() { return worldCombat; }, advance };
  document.getElementById('generate-full').addEventListener('click', () => { fullMap = true; generate(); });
  document.getElementById('enable-upkeep').addEventListener('click', () => action(() => {
    city.enableUpkeep();
    message.textContent = 'SM couriers enabled: growth and new unit production wait for farm deliveries; repair HM is preserved.';
  }));
  document.getElementById('fit-map').addEventListener('click', fitMap);
  function configureCombat() {
    if (!worldCombat) return;
    worldCombat.configure({ spawning: document.getElementById('world-spawning').checked,
      fighting: document.getElementById('world-fighting').checked, devices: document.getElementById('world-devices').checked });
  }
  for (const id of ['world-spawning', 'world-fighting', 'world-devices']) {
    document.getElementById(id).addEventListener('change', configureCombat);
  }
  document.getElementById('world-spawn').addEventListener('click', () => action(() => {
    const result = worldCombat.spawn(document.getElementById('world-owner').value, document.getElementById('world-kind').value);
    document.getElementById('world-combat-message').textContent = result.ok ? `Spawned ${result.entry.id}.` : `Spawn rejected: ${result.reason}`;
  }));
  document.getElementById('world-fire').addEventListener('change', () => {
    if (document.getElementById('world-fire').checked) {
      document.getElementById('place-seed').checked = false; document.getElementById('dig-tunnel').checked = false;
    }
  });
  document.getElementById('place-seed').addEventListener('change', () => {
    if (document.getElementById('place-seed').checked) {
      document.getElementById('world-fire').checked = false; document.getElementById('dig-tunnel').checked = false;
    }
  });
  const resetDig = () => { digStart = null; digQuote = null; digQuoteKey = ''; };
  document.getElementById('dig-tunnel').addEventListener('change', () => {
    if (document.getElementById('dig-tunnel').checked) {
      document.getElementById('world-fire').checked = false; document.getElementById('place-seed').checked = false;
    } else document.getElementById('dig-status').textContent = '';
    resetDig(); if (city) draw();
  });
  document.getElementById('dig-owner').addEventListener('change', () => { resetDig(); if (city) draw(); });
  const canvasCell = (event) => {
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.floor((event.clientX - bounds.left) * city.world.width / bounds.width),
      y: Math.floor((event.clientY - bounds.top) * city.world.height / bounds.height) };
  };
  canvas.addEventListener('pointermove', (event) => { if (city && digActive()) digPointer = canvasCell(event); });
  canvas.addEventListener('click', (event) => {
    if (!city || !digActive()) return;
    action(() => {
      const owner = document.getElementById('dig-owner').value, point = canvasCell(event);
      if (!digStart) {
        const anchor = economy.anchorNear(owner, point);
        if (anchor) { digStart = anchor; digQuote = null; digQuoteKey = ''; }
        message.textContent = anchor ? `Tunnel start set at (${anchor.x}, ${anchor.y}); click a target.`
          : 'No valid tunnel start here: pick your faction\'s ground or tunnel wall inside its zone.';
        return;
      }
      const result = economy.orderTunnel(owner, digStart, point);
      message.textContent = result.ok ? `Tunnel order #${result.order}: about ${result.price} HM in ${result.chunks} ` +
        'prepaid segment(s), paid from mine storage as the builders reach each one.' : `Tunnel rejected: ${result.reason}`;
      if (result.ok) resetDig();
    });
  });
  canvas.addEventListener('contextmenu', (event) => {
    if (!digActive() || !digStart) return;
    event.preventDefault(); resetDig(); draw();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && digStart) { resetDig(); if (city) draw(); }
  });
  canvas.addEventListener('click', (event) => {
    if (!worldCombat || busy || failed || !document.getElementById('world-fire').checked) return;
    action(() => {
      const id = document.getElementById('world-unit').value;
      if (!id) {
        document.getElementById('world-combat-message').textContent = 'Spawn and select a firing unit first.';
        return;
      }
      const point = getPixelUnitAimPoint(canvas, city.world, event);
      worldCombat.combat.layGun(id, point);
      const result = worldCombat.combat.fire(id, point);
      document.getElementById('world-combat-message').textContent =
        result.ok ? `${id} fired at (${point.x}, ${point.y}).` : `Shot rejected: ${result.reason}`;
    });
  });
  document.getElementById('military-demo').addEventListener('click', () => {
    running = false; failed = false;
    try {
      city = createPixelMilitaryDemoCity();
      worldCombat = null; economy = null;
      document.getElementById('world-combat-controls').hidden = true;
      document.getElementById('tunnel-controls').hidden = true;
      digStart = null; digQuote = null;
      seedPointer = null; seedPreview = null; previewColumn = null;
      const buildings = document.getElementById('building');
      buildings.replaceChildren();
      city.entries.forEach((entry, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = entry.building ? `${entry.building.type} ${index + 1}` : `Original ${index + 1}`;
        buildings.append(option);
      });
      buildings.value = '3';
      renderer = createPixelConstructionRenderer(canvas, city.world.width);
      clock = createFixedStepClock(() => { if (running && !busy && !failed) advance(); });
      zoom = 1; fps.reset(performance.now()); resizePreview(); draw();
      document.getElementById('source').textContent =
        `Deterministic military integration demo: ${city.world.width}-by-90 shared crop, ` +
        'level 7 military base, level 1 population and level 7 farm. Original three buildings retained.';
      message.textContent = 'Military demo ready, paused at tick 0. Run or build the preview to grow foundations and deliver paid frame pixels.';
    } catch (error) { fail(error); }
  });
  document.getElementById('build-preview').addEventListener('click', async () => {
    running = false; busy = true; updateControls();
    try {
      let ticks = 0;
      while (ticks < 18000 && city.entries.some(({ scenario }) => !scenario.finished && !scenario.coreDestroyed)) {
        for (let tick = 0; tick < 120; tick += 1) { advance(); ticks += 1; }
        draw();
        message.textContent = `Building preview through actual simulation: advanced ${ticks} ticks. HM is charged by paid delivery.`;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const pending = city.entries.filter(({ scenario }) => !scenario.finished && !scenario.coreDestroyed).length;
      message.textContent = pending ? `Preview advanced ${ticks} ticks; ${pending} buildings still blocked or unfinished. Inspect growth and delivery diagnostics.`
        : `Preview construction finished after ${ticks} ticks. Military symbols are placement previews, not combat.`;
    } catch (error) { fail(error); }
    finally { busy = false; updateControls(); }
  });
  controls[0].addEventListener('click', () => { running = !running; updateControls(); });
  controls[1].addEventListener('click', () => action(() => { for (let i = 0; i < 60; i += 1) advance(); }));
  document.getElementById('step-one').addEventListener('click', () => action(() => advance()));
  controls[2].addEventListener('click', () => action(() => {
    message.textContent = `Selected core blast removed ${city.blastCore(selection(), Number(document.getElementById('core').value))} material cells. No refunds.`;
  }));
  controls[3].addEventListener('click', () => action(() => {
    message.textContent = `Excavated ${city.excavateFloor(selection(), Number(document.getElementById('floor').value)).removed} terrain cells beneath the selected building's floor.`;
  }));
  controls[4].addEventListener('click', () => action(() => { message.textContent = `Cleared ${city.clearDebris()} shared debris cells. No refunds.`; }));
  controls[5].addEventListener('click', () => action(() => {
    const result = city.restoreTerrain();
    message.textContent = `Restored ${result.restored} terrain cells; ${result.blocked} occupied cells preserved.`;
  }));
  document.getElementById('building').addEventListener('change', draw);
  document.getElementById('level-up').addEventListener('click', () => action(() => {
    const type = city.entries[selection()].building.type;
    const result = type === 'military' ? city.levelUpMilitary(selection()) : city.levelUpPopulation(selection());
    message.textContent = result.ok ? `${type === 'military' ? 'Military' : 'Population'} level ${result.level}: ${result.cores} cores; ` +
      `${result.paidPixels} new frame pixels and ${result.repairPixels} existing repairs queued for paid construction.` : `Cannot level up: ${result.reason}`;
  }));
  document.getElementById('repair-building').addEventListener('click', () => action(() => {
    const result = city.repairBuilding(selection());
    message.textContent = result.ok ? `${result.repairPixels} missing frame pixels queued for paid repair. Level and original plan are unchanged.`
      : `Cannot repair: ${result.reason}`;
  }));
  document.getElementById('spend-sm').addEventListener('click', () => action(() => {
    const storage = city.spendSM(25);
    message.textContent = `Spent 25 lab SM; shared storage ${storage.sm}/${storage.capacity}.`;
  }));
  document.getElementById('preview').addEventListener('change', draw);
  document.getElementById('defenses').addEventListener('change', draw);
  document.getElementById('place-seed').addEventListener('change', draw);
  for (const id of ['seed-type', 'seed-level']) {
    document.getElementById(id).addEventListener('change', () => { previewColumn = null; draw(); });
  }
  canvas.addEventListener('pointermove', (event) => {
    if (!city || busy || failed || !document.getElementById('place-seed').checked) return;
    const bounds = canvas.getBoundingClientRect();
    seedPointer = { x: (event.clientX - bounds.left) * city.world.width / bounds.width,
      y: (event.clientY - bounds.top) * city.world.height / bounds.height };
    if (seedPointer.x < 0 || seedPointer.x >= city.world.width) seedPointer = null;
  });
  canvas.addEventListener('pointerleave', () => { seedPointer = null; digPointer = null; });
  canvas.addEventListener('wheel', (event) => {
    if (!city || busy || failed || event.ctrlKey) return;
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
    zoom = Math.max(0.25, Math.min(4, zoom * Math.exp(-delta * 0.0015)));
    applyZoom();
    const resized = canvas.getBoundingClientRect();
    const viewport = document.getElementById('viewport');
    viewport.scrollLeft += resized.left + x * resized.width - event.clientX;
    viewport.scrollTop += resized.top + y * resized.height - event.clientY;
    const updated = canvas.getBoundingClientRect();
    seedPointer = document.getElementById('place-seed').checked
      ? { x: (event.clientX - updated.left) * city.world.width / updated.width,
        y: (event.clientY - updated.top) * city.world.height / updated.height } : null;
    draw();
  }, { passive: false });
  canvas.addEventListener('click', (event) => {
    if (!city || busy || failed || !document.getElementById('place-seed').checked) return;
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) * city.world.width / bounds.width);
    action(() => {
      const result = city.addSeed(x, false, seedBuilding());
      previewColumn = null;
      if (!result.ok) { message.textContent = `Seed placement rejected at column ${x}: ${result.reason}`; return; }
      if (worldCombat) {
        city.entries[result.index].building.owner = x < city.world.width * 0.2 ? 'left' :
          x >= city.world.width * 0.8 ? 'right' : 'neutral';
      }
      const option = document.createElement('option');
      option.value = String(result.index); option.textContent = `Added building ${result.index + 1}`;
      document.getElementById('building').append(option);
      document.getElementById('building').value = option.value;
      message.textContent = `Seed added at column ${x}; independent growth and 1000 lab HM ready.`;
    });
  });
  document.getElementById('focus').addEventListener('click', () => {
    const seed = rootSeed(city.entries[selection()]);
    const viewport = document.getElementById('viewport');
    const pixelScale = canvas.getBoundingClientRect().width / city.world.width;
    viewport.scrollLeft = (seed.x + 0.5) * pixelScale - viewport.clientWidth / 2;
    viewport.scrollIntoView({ block: 'center' });
  });
  new ResizeObserver(() => { resizePreview(); draw(); }).observe(canvas.parentElement);
  // Frames paint only the visible region, so newly scrolled-in pixels are repainted immediately.
  canvas.parentElement.addEventListener('scroll', () => { try { if (!failed) draw(true); } catch (error) { fail(error); } },
    { passive: true });
  function frame(time) {
    try { if (!failed) { clock.advance(time); draw(true); if (city) fps.record(); } }
    catch (error) { fail(error); }
    requestAnimationFrame(frame);
  }
  resizePreview(); requestAnimationFrame(frame); generate();
}());
