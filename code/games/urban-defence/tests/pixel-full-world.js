function runPixelFullWorldChecks(city, simulation, source) {
  const results = [], assert = (condition, message) => { if (!condition) throw new Error(message); };
  function check(name, run) {
    try { run(); results.push(`PASS ${name}`); }
    catch (error) { results.push(`FAIL ${name}: ${error.message}`); }
  }
  check('complete pixel world preserves every imported terrain, water and tunnel cell before growth', () => {
    assert(city.world.width === source.width && city.world.height === source.height &&
      city.world.width === 2400 && city.world.height ===
        (source.populationScale ? source.populationScale.originalHeight + source.populationScale.skyPadding : 390) &&
      city.originX === 0 && city.originY === 0,
    'full-map extent or cell count changed');
    const baseline = createParticleWorldFromSurfaceWaterAndTunnels(
      { heightAt: (x) => source.heights[Math.floor(x / 4)] },
      (x) => source.waterLevels[Math.floor(x / 4)], source.tunnels,
      { width: source.width, height: source.height, cellSize: 4, originX: 0, originY: 0, skipEmptyChunks: true });
    const caves = city.waterCaves && city.waterCaves.length ? carvePixelWaterCaves(baseline) : [];
    assert(JSON.stringify(caves) === JSON.stringify(city.waterCaves || []), 'underground water caves are not reproducible');
    const original = baseline.snapshot().cells, actual = city.world.snapshot().cells;
    assert(original.every((cell, index) => cell === actual[index]),
      'generation flattened terrain, drained water, filled tunnels or prebuilt structures');
  });
  check('all factions have population, military and farms with unique physical ownership and styles', () => {
    assert(new Set(Object.values(simulation.styles)).size === 3, 'faction styles are duplicated');
    const owned = new Set();
    for (const owner of ['left', 'right', 'neutral']) for (const type of ['population', 'military', 'farm']) {
      assert(city.entries.some((entry) => entry.building.owner === owner && entry.building.type === type),
        `missing ${owner} ${type}`);
    }
    for (const entry of city.entries) for (const cell of entry.scenario.plan) {
      assert(entry.building.style === simulation.styles[entry.building.owner],
        'building architecture does not match its team assignment');
      const key = cell.y * city.world.width + cell.x;
      assert(!owned.has(key), 'building plans share an owned physical pixel');
      assert(cell.x >= 0 && cell.x < city.world.width && cell.y >= 0 && cell.y < city.world.height,
        'building plan extends beyond the world');
      owned.add(key);
    }
    city.verify();
  });
  if (city.waterCavesEnabled) check('underground water caves stay sealed pockets with an air gap that farm pumps can draw from', () => {
    const caves = city.waterCaves || [];
    assert(caves.length >= 8, 'full map has too few underground water caves');
    for (const cave of caves) {
      assert(cave.top - city.world.surfaceRow(cave.x) >= 30 && cave.water > 0 && cave.water < cave.cells,
        `cave ${cave.id} is shallow, dry or has no air gap`);
      for (let x = cave.left; x <= cave.right; x += 1) {
        assert(city.world.at(x, cave.top - 1) === PARTICLE_TERRAIN, 'cave roof shell is breached');
        for (let y = cave.top; y < cave.waterline; y += 1) assert(city.world.at(x, y) !== PARTICLE_WATER, 'cave air gap is flooded');
      }
    }
    const pumps = city.entries.map((entry, index) => entry.building.type === 'farm' ? city.inspectFarm(index) : null)
      .filter(Boolean).flatMap((farm) => farm.sources).filter((source) => source.kind === 'pump');
    assert(pumps.every((source) => caves.some((cave) => cave.id === source.cave) &&
      city.world.at(source.intake.x, source.intake.y - 1) === PARTICLE_EMPTY), 'pump intake is not in a cave air gap');
  });
  check('construction and combat advance one shared physics tick without spending foundation HM', () => {
    const before = city.world.snapshot().tick, sourceBefore = JSON.stringify(source);
    simulation.step();
    assert(city.world.snapshot().tick === before + 1 && simulation.combat.inspect().ticks === 1 &&
      city.entries.every(({ scenario }) => scenario.ticks === 1 && scenario.hm === scenario.initialHM && scenario.spent === 0),
    'physics advanced per building, clocks diverged or free foundations charged HM');
    assert(JSON.stringify(source) === sourceBefore, 'simulation mutated the generated source');
    city.verify();
  });
  if (source.populationScale) check('compact population towers span 15 to 20 quarter-size trooper heights with a real ground reference', () => {
    const scale = source.populationScale;
    assert(scale.trooperHeight === 6.25 && scale.cellReduction === 4 && scale.originalHeight === 390,
      'quarter-size standing dimensions or original extent changed');
    for (const entry of city.entries.filter((entry) => entry.building.type === 'population')) {
      const ornaments = new Set((entry.building.ornamentCells || []).map((cell) => cell.y * city.world.width + cell.x));
      const roof = Math.min(...entry.scenario.plan.filter((cell) => !ornaments.has(cell.y * city.world.width + cell.x)).map((cell) => cell.y));
      const height = Math.min(...entry.seedPlacement.map((cell) => cell.groundY)) - roof;
      assert(height / scale.trooperHeight >= 15 && height / scale.trooperHeight <= 20 && roof >= 16,
        'population tower height or sky clearance outside required range');
      assert(entry.building.ornamentCount === ornaments.size && ornaments.size > 0 &&
        [...ornaments].every((key) => entry.scenario.plan.some((cell) => cell.y * city.world.width + cell.x === key)) &&
        Math.min(...entry.scenario.plan.map((cell) => cell.y)) >= 1,
        'styled tower ornaments are missing, unpaid or outside the world');
      assert(entry.building.height === height &&
        (entry.scenario.paidGrowth || entry.scenario.initialHM > entry.scenario.plan.length),
        'tower metadata or finite construction allowance insufficient');
      assert(entry.building.spacing <= (scale.trooperWidth ? scale.trooperWidth + 2 : 8) && entry.building.width <= 35 &&
        entry.building.floorHeight === Math.max(7, (scale.trooperClearance || 0) + 2),
        'full-map tower lost compact spacing or actual trooper clearance');
    }
    const reference = simulation.scaleTrooper;
    assert(reference && simulation.units.includes(reference) && reference.unit.inspect().width === 8 &&
      reference.unit.inspect().pixels.length > 0 && !reference.unit.inspect().water.wet,
      'missing real native-artwork scale trooper');
  });
  if (source.populationScale && source.populationScale.trooperClearance) {
    check('population doors and interior bays fit complete infantry but not larger vehicles', () => {
      const world = createParticleWorld(128, 180), art = simulation.artworks.get('trooper');
      for (let x = 0; x < 128; x += 1) for (let y = 150; y < 180; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      const spacing = art.width + 2, poles = [40, 40 + spacing, 40 + spacing * 2];
      const tower = createPixelPopulationFrame(poles, [150, 150, 150], 100, 7, undefined, 'modern', art.height);
      const snapshot = world.snapshot();
      for (const cell of tower.cells) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
      world.restore(snapshot);
      const right = poles[2] + 3, troop = createPixelTerrainUnit(world, art,
        { x: right + 3, y: 149 - art.footRow, facing: -1 });
      troop.input.left = true;
      for (let tick = 0; tick < 60; tick += 1) troop.step();
      assert(troop.inspect().x + art.width < right && troop.inspect().grounded &&
        !findPixelUnitContact(world, troop.inspect().x, troop.inspect().y, troop.inspect().collision),
      'the doorway or first interior bay does not fit a real standing troop');
      for (const kind of ['tank', 'hopper']) {
        const vehicleArt = simulation.artworks.get(kind);
        const vehicle = createPixelVehicleUnit(world, vehicleArt,
          { kind, x: right + 3, y: 150 - vehicleArt.footRow, facing: -1 });
        vehicle.input.left = true;
        for (let tick = 0; tick < 60; tick += 1) vehicle.step();
        const state = vehicle.inspect();
        assert(state.x + Math.max(...state.collision.map((pixel) => pixel.x)) >= right &&
          !findPixelUnitContact(world, state.x, state.y, state.collision),
          `${kind} fitted through an infantry-only population entrance`);
      }
      city.verify();
    });
  }
  check('bullets and missiles retain fading trails after impact and expire without altering material', () => {
    for (const kind of ['bullet', 'missile']) {
      const world = createParticleWorld(220, 120);
      for (let y = 0; y < world.height; y += 1) world.set(100, y, PARTICLE_TERRAIN);
      const model = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
      const shot = model.launch('left', { x: 10, y: 60 }, { x: 100, y: 60 }, { kind });
      assert(shot.ok, 'test shot rejected');
      for (let tick = 0; tick < 30; tick += 1) model.step();
      const state = model.inspect({ sprites: false });
      assert(state.impacts.some((hit) => hit.shotId === shot.id) &&
        state.trails.some((trail) => trail.shotId === shot.id && trail.age > 0 && trail.age < trail.lifetime),
      `${kind} left no fading trail after its impact`);
      const sample = state.trails[0];
      sample.age = -1;
      assert(model.inspect({ sprites: false }).trails.every((trail) => trail.age >= 0), 'trail inspection mutated simulation');
      for (let tick = 0; tick < 180; tick += 1) model.step();
      assert(model.inspect({ sprites: false }).trails.length === 0, `${kind} trails did not expire`);
      const accounting = model.inspect({ sprites: false });
      assert(world.terrainCount + accounting.terrainDebris === 120 &&
        world.debrisCount === accounting.terrainDebris + accounting.issuedAmmoDebris,
      'visual trails changed the physical material accounting');
    }
  });
  return results;
}
