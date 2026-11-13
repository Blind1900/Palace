function createPixelConstructionWorkload() {
  const entries = Array.from({ length: 3 }, (_, index) => {
    const scenario = createPixelConstructionScenario(11);
    for (let tick = 0; tick < 2400; tick += 1) scenario.step();
    scenario.breachBasin();
    const { world } = scenario;
    const before = world.barrierCount + world.constructionCount + world.debrisCount;
    if (index === 1) scenario.blastFoundation();
    const destroyed = before - world.barrierCount - world.constructionCount - world.debrisCount;
    return { scenario, destroyed };
  });
  function verify() {
    entries.forEach(({ scenario, destroyed }, index) => {
      const { world } = scenario;
      if (world.barrierCount + world.constructionCount + world.debrisCount + destroyed !== 9 + scenario.spent ||
          scenario.hm !== 1000 - scenario.spent || world.waterCount !== 220) {
        throw new Error(`Building ${index + 1}: workload material, HM or water accounting failed`);
      }
    });
  }
  verify();
  return {
    entries,
    renderScenarios: entries.map(({ scenario }) => scenario),
    verify,
    step() {
      for (const { scenario } of entries) scenario.step();
      verify();
    },
  };
}

function createSharedPixelConstructionWorkload(options = {}) {
  if (!options || (options.natural !== undefined && typeof options.natural !== 'boolean') ||
      (options.layout !== undefined && !['standard', 'asymmetric'].includes(options.layout)) ||
      (options.ground !== undefined && !['flat', 'raised'].includes(options.ground))) {
    throw new Error('Invalid shared construction experiment');
  }
  const natural = options.natural === true;
  const layout = options.layout || 'standard';
  const ground = options.ground || 'flat';
  const capacity = options.supportCapacity === undefined ? 128 : options.supportCapacity;
  const world = createPixelConstructionWorld(240, capacity);
  let cleared = 0;
  const entries = [-20, 50, 120].map((poleOffset, index) => ({
    scenario: createPixelConstructionScenario(11, {
      world, poleOffset, layout: layout === 'asymmetric' ? ['standard', 'narrow-left', 'narrow-right'][index] : 'standard',
    }), destroyed: 0,
  }));
  if (ground === 'raised') {
    const terrainCells = entries.flatMap(({ scenario }) => {
      const left = Math.min(...scenario.plan.filter((cell) => cell.distance === 0).map((cell) => cell.x));
      return [1, 2, 3].flatMap((height, index) => Array.from({ length: height }, (_, row) =>
        ({ x: left - 5 + index, y: scenario.surfaceRow - 1 - row })));
    });
    if (terrainCells.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY)) {
      throw new Error('Raised-terrain experiment requires empty delivery-side terrain cells');
    }
    for (const cell of terrainCells) world.set(cell.x, cell.y, PARTICLE_TERRAIN);
  }
  function step() {
    world.step();
    for (const { scenario } of entries) scenario.step({ advanceWorld: false });
    verify();
  }
  function verify() {
    const paid = entries.reduce((sum, { scenario }) => sum + scenario.spent, 0);
    const destroyed = entries.reduce((sum, entry) => sum + entry.destroyed, 0);
    if (world.barrierCount + world.constructionCount + world.debrisCount + destroyed + cleared !== 27 + paid ||
        world.waterCount !== 220 || entries.some(({ scenario }) => scenario.hm !== 1000 - scenario.spent)) {
      throw new Error('Shared workload material, HM or water accounting failed');
    }
  }
  function selectedEntry(index) {
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
      throw new Error('Invalid shared building selection');
    }
    return entries[index];
  }
  function restoreFoundation(index) {
    const entry = selectedEntry(index);
    verify();
    const result = entry.scenario.restoreFoundation();
    verify();
    return result;
  }
  function blastBuilding(index) {
    const entry = selectedEntry(index);
    verify();
    const before = world.barrierCount + world.constructionCount + world.debrisCount;
    const removed = entry.scenario.blastFoundation();
    const destroyed = before - world.barrierCount - world.constructionCount - world.debrisCount;
    entry.destroyed += destroyed;
    verify();
    return { removed, destroyed };
  }
  function excavateFoundationGround(index) {
    const entry = selectedEntry(index);
    verify();
    const removed = entry.scenario.excavateFoundationGround();
    verify();
    return removed;
  }
  function clearDebris() {
    verify();
    const removed = world.clearDebris(0, 0, world.width - 1, world.height - 1);
    cleared += removed;
    verify();
    return removed;
  }
  function breachBasin() {
    verify();
    const removed = entries[0].scenario.breachBasin();
    verify();
    return removed;
  }
  if (!natural) {
    for (let tick = 0; tick < 2400; tick += 1) step();
    breachBasin();
    blastBuilding(1);
  }
  verify();
  return {
    entries, step, verify, blastBuilding, clearDebris, restoreFoundation, excavateFoundationGround, breachBasin,
    natural, layout, ground,
    get cleared() { return cleared; },
    renderScenarios: [{ world, blueprintCells: () => entries.flatMap(({ scenario }) => scenario.blueprintCells()) }],
  };
}
