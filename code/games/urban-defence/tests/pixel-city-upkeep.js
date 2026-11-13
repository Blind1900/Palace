function runPixelCityUpkeepChecks() {
  const lines = [], assert = (ok, message) => { if (!ok) throw new Error(message); };
  const check = (name, run) => {
    if (typeof pixelCheckFilter !== 'undefined' && !name.includes(pixelCheckFilter)) return;
    try { run(); lines.push(`PASS ${name}`); } catch (error) { lines.push(`FAIL ${name}: ${error.message}`); }
  };
  function fixture() {
    const world = createParticleWorld(100, 30);
    for (let x = 0; x < world.width; x += 1) world.set(x, 20, PARTICLE_TERRAIN);
    const make = (type, x, owner = 'left') => ({ building: { type, level: 2, owner },
      seedPlacement: [{ x, y: 19, groundY: 20 }, { x: x + 2, y: 19, groundY: 20 }],
      scenario: { world, finished: true, coreDestroyed: false, hm: 35 } });
    const entries = [make('farm', 5), make('population', 30), make('military', 55)];
    let food = 20;
    const farms = { inspect: () => ({ storageSilos: [{ stored: food }] }),
      spendSM(amount) { assert(amount > 0 && amount <= food, 'invalid farm debit'); food -= amount; } };
    const model = createPixelCityUpkeep(world, entries, farms);
    return { world, entries, model, food: () => food };
  }
  check('ground debris merges exactly after 600 resting ticks with conserved pixels, water and snapshot timers', () => {
    const world = createParticleWorld(20, 30, { skipEmptyChunks: true });
    world.configureDebrisMerging(600);
    for (let x = 0; x < 20; x += 1) for (let y = 20; y < 30; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    world.set(2, 19, PARTICLE_WATER);
    for (const [x, y] of [[9, 19], [10, 19], [11, 19], [10, 18]]) {
      assert(world.emitDebris(x, y).ok, 'test rubble emission failed');
    }
    const terrain = world.terrainCount;
    for (let tick = 0; tick < 599; tick += 1) world.step();
    assert(world.debrisCount === 4 && world.mergedDebrisCount === 0 && world.surfaceRow(10) === 20,
      'rubble merged before ten seconds at rest');
    const restored = createParticleWorld(20, 30, { skipEmptyChunks: true });
    restored.restore(world.snapshot());
    world.step(); restored.step();
    assert(world.debrisCount === 0 && world.mergedDebrisCount === 4 &&
      world.terrainCount === terrain + 4 && world.waterCount === 1 && world.surfaceRow(10) === 18 &&
      world.at(10, 18) === PARTICLE_TERRAIN &&
      JSON.stringify(world.snapshot()) === JSON.stringify(restored.snapshot()),
    'conversion lost material/water, failed to raise the surface or lost its timer on restore');
  });
  check('falling resets debris rest age and roof-supported debris remains rubble', () => {
    const world = createParticleWorld(20, 30);
    world.configureDebrisMerging(600);
    for (let x = 0; x < 20; x += 1) for (let y = 20; y < 30; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    world.emitDebris(10, 19);
    for (let tick = 0; tick < 300; tick += 1) world.step();
    world.excavate(10, 20, 10, 20); world.step();
    for (let tick = 0; tick < 599; tick += 1) world.step();
    assert(world.at(10, 20) === PARTICLE_DEBRIS && world.mergedDebrisCount === 0,
      'old resting age survived a fall');
    world.step();
    assert(world.at(10, 20) === PARTICLE_TERRAIN && world.mergedDebrisCount === 1,
      'debris did not merge after a new full rest interval');
    world.set(9, 18, PARTICLE_TERRAIN); world.set(9, 19, PARTICLE_TERRAIN);
    for (const x of [9, 8, 10, 11, 12]) {
      assert(world.emitConstruction(x, 17).ok && world.settleConstruction(x, 17).ok, 'test roof unsupported');
    }
    world.emitDebris(10, 16);
    for (let tick = 0; tick < 650; tick += 1) world.step();
    assert(world.at(10, 16) === PARTICLE_DEBRIS && world.mergedDebrisCount === 1,
      'roof rubble became floating terrain');
  });
  check('population and military upkeep pauses until farm SM physically arrives and resumes after delivery', () => {
    const scene = fixture();
    assert(!scene.model.supplied(1) && !scene.model.supplied(2), 'empty pantry operated');
    scene.model.step();
    assert(scene.model.inspect().carried === 10 && scene.food() === 10 &&
      !scene.model.supplied(1) && !scene.model.supplied(2), 'SM teleported or was charged incorrectly');
    for (let i = 0; i < 240; i += 1) scene.model.step();
    const state = scene.model.inspect();
    assert(scene.model.supplied(1) && scene.model.supplied(2) && state.upkeepPerMinute === 6,
      'delivered SM failed to enable buildings or total upkeep was wrong');
    for (let i = 0; i < 1900; i += 1) scene.model.step();
    assert(scene.model.inspect().consumed === 2 && scene.entries.every((entry) => entry.scenario.hm === 35),
      'level-scaled upkeep rate wrong or SM delivery altered HM repair stock');
    scene.model.audit();
  });
  check('SM couriers retain blocked cargo and never deliver across factions', () => {
    const scene = fixture();
    scene.entries[2].building.owner = 'right'; scene.model.step();
    const agent = scene.model.inspect().transporters[0], snapshot = scene.world.snapshot();
    assert(scene.model.inspect().carried === 5, 'opposing faction received farm supplies');
    scene.world.set(agent.x, agent.y, PARTICLE_WATER);
    for (let i = 0; i < 120; i += 1) scene.model.step();
    assert(scene.model.inspect().carried === 5 && !scene.model.supplied(1) &&
      scene.model.inspect().transporters[0].state.includes('cargo retained'), 'flooded courier lost cargo or delivered');
    scene.world.restore(snapshot);
    for (let i = 0; i < 300; i += 1) scene.model.step();
    assert(scene.model.supplied(1) && !scene.model.supplied(2), 'unblocked courier did not resume safely');
    scene.model.audit();
  });
  check('depleted SM pauses output without removing buildings, HM or existing population/unit state', () => {
    const scene = fixture();
    scene.model.step();
    scene.entries[0].scenario.finished = false;
    for (let i = 0; i < 12000; i += 1) scene.model.step();
    assert(!scene.model.supplied(1) && !scene.model.supplied(2) &&
      scene.model.inspect().consumed === 10 && scene.entries.length === 3 &&
      scene.entries.every((entry) => !entry.scenario.coreDestroyed && entry.scenario.hm === 35),
      'shortage failed to pause or damaged buildings/repair supplies');
    scene.model.audit();
  });
  check('real generated building frames receive real farm SM, gate growth and preserve local HM repair budgets', () => {
    const city = createPixelMilitaryDemoCity();
    for (let i = 0; i < 18000 && city.entries.some(({ scenario }) => !scenario.finished); i += 1) city.step();
    assert(city.entries.every(({ scenario }) => scenario.finished), 'real demo construction did not finish');
    const hm = city.entries.map(({ scenario }) => scenario.hm);
    city.enableUpkeep();
    assert(!city.isSupplied(3) && !city.isSupplied(4) && !city.levelUpBuilding(4).ok,
      'real population growth ignored an empty pantry');
    const initialFood = city.inspectSMStorage();
    let fedMilitary = false, fedPopulation = false;
    for (let i = 0; i < 6000; i += 1) {
      city.step();
      fedMilitary = fedMilitary || city.isSupplied(3); fedPopulation = fedPopulation || city.isSupplied(4);
    }
    const state = city.inspectUpkeep(), farms = city.inspectSMStorage();
    assert(fedMilitary && fedPopulation && state.drawn > 0 && state.consumed > 0,
      'real farm couriers did not feed military and population: ' + JSON.stringify(state));
    assert(farms.totalProduced === farms.sm + farms.totalSpent && farms.totalSpent >= state.drawn &&
      city.entries.every(({ scenario }, index) => scenario.hm === hm[index]),
      'real SM or HM budget conservation failed');
    assert(farms.totalProduced >= initialFood.totalProduced, 'farm production stopped unexpectedly');
    city.verify();
    city.world.configureDebrisMerging(600);
    const beforeMerge = city.world.mergedDebrisCount;
    city.blastCore(0, 0);
    for (let tick = 0; tick < 1000; tick += 1) city.step();
    assert(city.world.mergedDebrisCount > beforeMerge && city.world.waterCount === city.initialWater,
      'shared city collapse did not become conserved physical ground');
    city.verify();
  });
  check('skyscraper source adds real sky without changing terrain, water, tunnels or native unit proportions', () => {
    const source = { width: 160, height: 390, cellSize: 4, heights: Array(160).fill(400),
      waterLevels: Array(160).fill(null), tunnels: [{ interiorWidth: 8, points: [{ x: 100, y: 480 }, { x: 300, y: 480 }] }] };
    source.waterLevels[10] = 392;
    const before = JSON.stringify(source), raised = preparePixelSkyscraperSource(source, PIXEL_UNIT_REFERENCE);
    assert(JSON.stringify(source) === before && raised.populationScale.trooperHeight === 6.25 &&
      raised.height === 431 && raised.populationScale.skyPadding === 41,
      'source mutated or transparent padding was included in scale');
    const padding = raised.populationScale.skyPadding;
    const importWorld = (data) => createParticleWorldFromSurfaceWaterAndTunnels(
      { heightAt: (x) => data.heights[Math.floor(x / 4)] }, (x) => data.waterLevels[Math.floor(x / 4)],
      data.tunnels, { width: data.width, height: data.height, cellSize: 4, originX: 0, originY: 0, skipEmptyChunks: true });
    const original = importWorld(source).snapshot().cells, actual = importWorld(raised).snapshot().cells;
    assert(actual.slice(0, padding * source.width).every((cell) => cell === PARTICLE_EMPTY) &&
      original.every((cell, index) => actual[padding * source.width + index] === cell),
      'sky addition changed imported terrain/water/tunnel cells');
    for (let level = 1; level <= 7; level += 1) {
      const height = pixelPopulationHeight(raised.populationScale, level);
      assert(height >= 94 && height <= 125, 'level height outside fifteen to twenty standing troops');
    }
    const sloped = createParticleWorld(160, 650);
    const heights = Array.from({ length: 160 }, (_, x) => (550 + x % 3) * 4);
    for (let x = 0; x < 160; x += 1) {
      for (let y = heights[x] / 4; y < sloped.height; y += 1) sloped.set(x, y, PARTICLE_TERRAIN);
    }
    for (const level of [1, 7]) {
      const site = prepareAdaptivePixelSeed(sloped, { heights, populationScale: { trooperHeight: 6.25 } },
        0, 0, [], 60, { type: 'population', level });
      assert(site.ok, 'sloped skyscraper placement failed');
      const height = Math.min(...site.seedPlacement.map((cell) => cell.groundY)) -
        Math.min(...site.geometry.frameCells.map((cell) => cell.y));
      assert(height === (level === 1 ? 94 : 125), 'sloped seed padding changed measured tower height');
      assert(site.metadata.width <= 35 && site.metadata.spacing <= 8 && site.metadata.floorHeight === 7,
        'population frame retained oversized footprint or hollow floor gaps');
    }
  });
  for (const style of ['asian', 'gothic', 'modern']) check(
    `${style} compact skyscraper uses funded real roof cells with connected foundations and stable support`, () => {
    const world = createParticleWorld(160, 650, { supportCapacity: 1024, skipEmptyChunks: true });
    for (let x = 0; x < 160; x += 1) for (let y = 550; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const source = { heights: Array(160).fill(2200), populationScale: { trooperHeight: 6.25 },
      architectureStyles: { left: style, neutral: style, right: style } };
    const site = prepareAdaptivePixelSeed(world, source, 0, 0, [], 60, { type: 'population', level: 1 });
    assert(site.ok && site.metadata.height === 94 && site.metadata.width === 11 &&
      site.metadata.style === style, 'real compact styled skyscraper placement failed');
    for (const cell of site.basementCells) world.excavate(cell.x, cell.y, cell.x, cell.y);
    const scenario = createPixelConstructionScenario(5, { world, buriedCore: true, deliveryMode: 'inside',
      foundationRows: site.foundationRows, foundationCells: site.foundationCells,
      geometry: site.geometry, initialHM: site.geometry.frameCells.length + 1000 });
    let ticks = 0;
    while (!scenario.finished && ticks < (typeof pixelConstructionLimit === 'undefined' ? 400000 : pixelConstructionLimit)) {
      scenario.step(); ticks += 1;
    }
    assert(scenario.finished && world.structuralLoad.failed === 0 && !world.debrisCount &&
      Math.min(...scenario.plan.map((cell) => cell.y)) === 456 &&
      site.geometry.frameCells.every((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER) &&
      scenario.hm === scenario.initialHM - scenario.spent && scenario.hm >= 1000,
      'tower construction failed, unsupported, clipped or unfunded at tick ' + ticks +
      `: ${scenario.message}; spent ${scenario.spent}; failed ${world.structuralLoad.failed}; debris ${world.debrisCount}; ` +
      `remaining ${scenario.plan.filter((cell) => world.at(cell.x, cell.y) !== PARTICLE_BARRIER).length}; ` +
      JSON.stringify(scenario.deliveries.map((agent) => ({ x: agent.x, y: agent.y, target: agent.target, distance: agent.path.length }))));
    const art = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellScale: 1, cellReduction: 4 });
    const unit = createPixelTerrainUnit(world, art, { x: 100, y: 550 - art.footRow, facing: 1 });
    unit.step();
    assert(unit.inspect().width === 8 && unit.inspect().grounded, 'quarter-size ground trooper was not supported');
    assert(findPixelUnitContact(world, site.geometry.poles[0] + 1, 460, [{ x: 0, y: 0 }]),
      'tower is only a rendered overlay rather than collision material');
  });
  return lines;
}
