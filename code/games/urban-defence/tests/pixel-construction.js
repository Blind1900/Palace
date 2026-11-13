(function () {
  const checks = [];
  const selectedCheck = new URLSearchParams(location.search).get('check');
  function assert(value, message) { if (!value) throw new Error(message); }
  function check(name, run) {
    if (selectedCheck && !name.includes(selectedCheck)) return;
    try { run(); checks.push(`PASS ${name}`); }
    catch (error) { checks.push(`FAIL ${name}: ${error.message}`); }
  }
  check('blueprint squares match every empty planned cell across all heights and reveal stages', () => {
    for (const rows of [5, 9, 11]) {
      const scenario = createPixelConstructionScenario(rows);
      for (let tick = 0; tick <= 240; tick += 1) {
        const dots = scenario.blueprintCells();
        const positions = new Set(dots.map((cell) => `${cell.x},${cell.y}`));
        assert(positions.size === dots.length && dots.every((cell) => Number.isInteger(cell.x) &&
          Number.isInteger(cell.y) && scenario.world.at(cell.x, cell.y) === PARTICLE_EMPTY),
          'blueprint squares were duplicated or included occupied cells');
        if (tick < 240) scenario.step();
      }
      const dots = scenario.blueprintCells();
      assert(dots.length === scenario.plan.length - 9, 'blueprint omitted planned building cells');
      for (const x of [60, 61, 62, 80, 81, 82, 100, 101, 102]) {
        const ys = dots.filter((cell) => cell.x === x).map((cell) => cell.y).sort((a, b) => a - b);
        assert(ys.length > 1 && ys.slice(1).every((y, i) => y - ys[i] === 1),
          'vertical cells have uneven spacing');
      }
      const topBeam = scenario.surfaceRow - rows * 4 + 2;
      const xs = dots.filter((cell) => cell.y === topBeam).map((cell) => cell.x).sort((a, b) => a - b);
      assert(xs.length === 43 && xs.slice(1).every((x, i) => x - xs[i] === 1),
        'horizontal cells have uneven spacing or a beam was omitted');
    }
  });
  check('blueprint borders occupy exact cell bounds and never remain over occupied material', () => {
    const world = createParticleWorld(160, 90), cell = { x: 60, y: 50 };
    for (const scale of [2, 4, 6]) {
      const canvas = document.createElement('canvas');
      canvas.width = world.width * scale; canvas.height = world.height * scale;
      const renderer = createPixelConstructionRenderer(canvas);
      const scenario = { world, blueprintCells: () => [cell] };
      const size = scale >= 4 ? scale - 1 : scale;
      renderer.draw(scenario);
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let borderCount = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const i = (y * canvas.width + x) * 4;
          const border = data[i] === 82 && data[i + 1] === 99 && data[i + 2] === 74;
          const dx = x - cell.x * scale, dy = y - cell.y * scale;
          const expected = dx >= 0 && dx < size && dy >= 0 && dy < size &&
            (dx === 0 || dx === size - 1 || dy === 0 || dy === size - 1);
          assert(border === expected, 'blueprint leaked outside cell or did not match its perimeter');
          if (border) borderCount += 1;
        }
      }
      assert(borderCount === size * 4 - 4, 'square perimeter had wrong size');
      for (const material of [PARTICLE_WATER, PARTICLE_BARRIER, PARTICLE_DEBRIS, PARTICLE_CONSTRUCTION]) {
        const snapshot = world.snapshot();
        snapshot.cells[cell.y * world.width + cell.x] = material;
        world.restore(snapshot);
        renderer.draw(scenario);
        const occupied = canvas.getContext('2d').getImageData(cell.x * scale, cell.y * scale, scale, scale).data;
        for (let i = 0; i < occupied.length; i += 4) {
          assert(!(occupied[i] === 82 && occupied[i + 1] === 99 && occupied[i + 2] === 74),
            'occupied cell retained a partial blueprint border');
        }
      }
      const snapshot = world.snapshot();
      snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_EMPTY;
      world.restore(snapshot);
    }
  });
  check('site inspection identifies obstacles without changing the world', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    assert(scenario.inspectSites().length === 0, 'inspection started before reveal');
    for (let i = 0; i < 240; i += 1) scenario.step();
    const sites = scenario.inspectSites();
    assert(sites.length >= 3 && sites.every((site) => site.state === 'available'),
      'initial frontier was not available');
    const snapshot = world.snapshot();
    const materials = [PARTICLE_WATER, PARTICLE_TERRAIN, PARTICLE_DEBRIS];
    materials.forEach((material, i) => { snapshot.cells[sites[i].y * world.width + sites[i].x] = material; });
    world.restore(snapshot);
    const before = JSON.stringify(world.snapshot()), hm = scenario.hm;
    const states = scenario.inspectSites().map((site) => site.state);
    assert(['water', 'terrain', 'fallen debris'].every((state) => states.includes(state)),
      'occupied site reason was incorrect');
    assert(before === JSON.stringify(world.snapshot()) && scenario.hm === hm,
      'inspection changed material or resources');
    const unsupported = createPixelConstructionScenario(5);
    for (let i = 0; i < 240; i += 1) unsupported.step();
    unsupported.world.excavate(55, 75, 107, 89);
    unsupported.step(); unsupported.clearDebris();
    assert(unsupported.inspectSites().some((site) => site.state === 'missing support'),
      'lost support was not reported');
  });
  check('paid material resumes after terrain blocks and then clears a crawling step', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let i = 0; i < 300; i += 1) scenario.step();
    const agent = scenario.deliveries.find((delivery) => delivery.path.length);
    assert(agent && agent.target, 'no paid crawling route to interrupt');
    const next = agent.path[0], paid = scenario.spent;
    world.set(next.x, next.y, PARTICLE_TERRAIN);
    for (let i = 0; i < 12; i += 1) scenario.step();
    assert(world.at(next.x, next.y) === PARTICLE_TERRAIN &&
      scenario.spent === paid && world.barrierCount + world.constructionCount + world.debrisCount === 9 + paid,
      'blocked route overwrote terrain, lost material or charged again');
    world.excavate(next.x, next.y, next.x, next.y);
    for (let i = 0; i < 60000 && !scenario.finished; i += 1) scenario.step();
    assert(scenario.finished && scenario.spent === scenario.plan.length - 9 &&
      world.constructionCount === 0 && world.waterCount === 220,
      'cleared route did not finish using correctly accounted material');
  });
  check('delivery inspection reports next-step obstacles without changing paid material', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let i = 0; i < 300; i += 1) scenario.step();
    assert(scenario.inspectDeliveries().every((delivery) => delivery.state === 'route ready'),
      'fresh delivery routes were not ready');
    const agent = scenario.deliveries.find((delivery) => delivery.path.length), next = agent.path[0];
    const dry = world.snapshot();
    for (const [material, name] of [[PARTICLE_WATER, 'water'], [PARTICLE_TERRAIN, 'terrain'],
      [PARTICLE_DEBRIS, 'fallen debris'], [PARTICLE_CONSTRUCTION, 'moving material']]) {
      const snapshot = world.snapshot();
      snapshot.cells = dry.cells.slice();
      snapshot.cells[next.y * world.width + next.x] = material;
      world.restore(snapshot);
      const before = JSON.stringify(world.snapshot()), paid = scenario.spent;
      assert(scenario.inspectDeliveries().some((delivery) => delivery.x === agent.x &&
        delivery.y === agent.y && delivery.state === `waiting: ${name}`), 'wrong next-step obstacle');
      assert(before === JSON.stringify(world.snapshot()) && scenario.spent === paid,
        'delivery inspection changed world or HM');
    }
    world.restore(dry);
    assert(scenario.inspectDeliveries().every((delivery) => delivery.state === 'route ready'),
      'cleared steps were not reported ready');
  });
  check('retained paid material recovers after foundation support is restored', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let i = 0; i < 300; i += 1) scenario.step();
    const paid = scenario.spent, retained = world.constructionCount;
    world.excavate(55, 75, 107, 89);
    world.step();
    assert(scenario.inspectDeliveries().every((delivery) => delivery.state === 'waiting: lost target support'),
      'lost target support was not reported before reassignment');
    const cleared = scenario.clearDebris();
    assert(cleared === 9, 'fixture did not release exactly nine free foundation pixels');
    for (let i = 0; i < 120; i += 1) scenario.step();
    assert(scenario.spent === paid && world.constructionCount === retained &&
      scenario.inspectDeliveries().every((delivery) => delivery.state === 'waiting for assignment'),
      'unsupported waiting lost material or spent HM');
    for (let y = 75; y < 90; y += 1) {
      for (let x = 55; x <= 107; x += 1) world.set(x, y, PARTICLE_TERRAIN);
    }
    let resumed = false;
    for (let i = 0; i < 60000 && !scenario.finished; i += 1) {
      scenario.step();
      if (world.barrierCount > 0) resumed = true;
    }
    assert(resumed && scenario.finished && scenario.spent === scenario.plan.length &&
      world.barrierCount === 9 + scenario.spent - cleared && world.constructionCount === 0 &&
      world.waterCount === 220 && scenario.hm === 1000 - scenario.spent,
      'restored support did not recover with exact destroyed-material accounting');
  });
  check('flooded layer is reported and resumes after water is relocated', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let i = 0; i < 240; i += 1) scenario.step();
    const dry = world.snapshot(), wet = world.snapshot();
    for (const site of scenario.inspectSites()) wet.cells[site.y * world.width + site.x] = PARTICLE_WATER;
    const added = wet.cells.filter((material) => material === PARTICLE_WATER).length - 220;
    world.restore(wet);
    assert(scenario.inspectSites().every((site) => site.state === 'water'), 'flooded layer not detected');
    const relocated = world.snapshot();
    relocated.cells = dry.cells.slice();
    for (let x = 8; x < 8 + added; x += 1) relocated.cells[64 * world.width + x] = PARTICLE_WATER;
    world.restore(relocated);
    for (let i = 0; i < 60000 && !scenario.finished; i += 1) scenario.step();
    assert(scenario.finished && world.waterCount === 220 + added &&
      scenario.spent === scenario.plan.length - 9,
      'dry layer failed to resume or lost conserved water');
  });
  check('blueprint precedes material delivery and supports are three cells thick', () => {
    const scenario = createPixelConstructionScenario(), { world } = scenario;
    assert(world.barrierCount === 9 && world.constructionCount === 0 && scenario.hm === 1000,
      'foundation or starting resources incorrect');
    for (let i = 0; i < 240; i += 1) scenario.step();
    assert(scenario.blueprintProgress === 1 && scenario.spent === 0 && world.barrierCount === 9,
      'construction began before blueprint finished');
    const plan = new Set(scenario.plan.map((cell) => `${cell.x},${cell.y}`));
    for (const x of [60, 80, 100]) {
      assert([0, 1, 2].every((dx) => plan.has(`${x + dx},50`)) && !plan.has(`${x + 3},50`),
        'vertical support is not exactly three cells thick');
    }
    assert(plan.has('70,41') && !plan.has('70,40') && !plan.has('70,42'),
      'horizontal beam is not one cell thick');
    for (let i = 0; i < 60; i += 1) scenario.step();
    assert(world.constructionCount > 1 && scenario.spent === world.constructionCount &&
      scenario.hm === 1000 - scenario.spent, 'independent paid material was not delivered');
  });
  check('material moves only through empty edge-adjacent cells and settles on support', () => {
    const world = createParticleWorld(8, 8);
    world.set(3, 5, PARTICLE_TERRAIN);
    assert(world.emitConstruction(2, 4).ok, 'material emission failed');
    world.set(2, 3, PARTICLE_WATER);
    assert(!world.moveConstruction(2, 4, 2, 3).ok && world.waterCount === 1,
      'moving material overwrote water');
    assert(!world.settleConstruction(2, 4).ok, 'unsupported material settled');
    assert(world.moveConstruction(2, 4, 3, 4).ok && world.settleConstruction(3, 4).ok,
      'material could not move and settle on terrain');
    assert(world.barrierCount === 1 && world.constructionCount === 0 && world.at(3, 4) === PARTICLE_BARRIER,
      'settled material is not in the world grid');
    const before = JSON.stringify(world.snapshot());
    let failed = false;
    try { world.moveConstruction(3, 4, 5, 4); } catch (error) { failed = true; }
    assert(failed && before === JSON.stringify(world.snapshot()), 'invalid move modified the world');
  });
  check('delivery routes crawl around constructed outlines instead of crossing open air', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    let climbed = false, corner = false;
    function outline(x, y) {
      let touching = false, edge = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((!dx && !dy) || x + dx < 0 || x + dx >= world.width || y + dy < 0 || y + dy >= world.height) continue;
          const material = world.at(x + dx, y + dy);
          if (material !== PARTICLE_BARRIER && material !== PARTICLE_TERRAIN) continue;
          touching = true;
          if (!dx || !dy) edge = true;
        }
      }
      if (touching && !edge) corner = true;
      return touching;
    }
    for (let i = 0; i < 2400; i += 1) {
      scenario.step();
      for (const agent of scenario.deliveries) {
        assert(outline(agent.x, agent.y), 'material is crawling in unsupported open air');
        if (agent.y < scenario.surfaceRow - 4) climbed = true;
        let previous = agent;
        for (const cell of agent.path) {
          assert(Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y) === 1 &&
            outline(cell.x, cell.y), 'route teleported or took an open-air shortcut');
          previous = cell;
        }
      }
    }
    assert(climbed && corner, 'test did not exercise climbing and exterior corners');
  });
  check('moving and settled material restore and unsupported building pixels fall', () => {
    const world = createParticleWorld(8, 8);
    world.set(3, 5, PARTICLE_TERRAIN);
    world.emitConstruction(3, 4); world.settleConstruction(3, 4);
    world.emitConstruction(1, 1);
    const restored = createParticleWorld(8, 8);
    restored.restore(world.snapshot());
    assert(restored.constructionCount === 1 && restored.barrierCount === 1,
      'material counters did not restore');
    world.excavate(3, 5, 3, 5); restored.excavate(3, 5, 3, 5);
    world.step(); restored.step();
    assert(world.barrierCount === 0 && world.debrisCount === 1 &&
      world.constructionCount === 1 && JSON.stringify(world.snapshot()) === JSON.stringify(restored.snapshot()),
    'disconnected building did not become grid debris deterministically');
  });
  check('all heights build entirely from paid material in the same grid', () => {
    for (const rows of [5, 9, 11]) {
      const scenario = createPixelConstructionScenario(rows), { world } = scenario;
      for (let i = 0; i < 60000 && !scenario.finished; i += 1) scenario.step();
      assert(scenario.finished && scenario.plan.every((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER),
        `${rows}-row frame did not complete`);
      assert(scenario.spent === scenario.plan.length - 9 && world.constructionCount === 0 &&
        world.barrierCount === scenario.plan.length && scenario.hm === 1000 - scenario.spent,
      `${rows}-row material accounting incorrect`);
      const spent = scenario.spent;
      scenario.blastFoundation();
      for (let i = 0; i < 120; i += 1) scenario.step();
      assert(scenario.spent === spent, 'completed frame restarted delivery');
    }
  });
  check('flooded construction conserves water and never overwrites occupied sites', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    scenario.breachBasin();
    for (let i = 0; i < 1800; i += 1) scenario.step();
    assert(world.waterCount === 220 && world.barrierCount + world.constructionCount + world.debrisCount === 9 + scenario.spent,
      'flooded construction created or lost material');
    assert(scenario.hm === 1000 - scenario.spent && scenario.spent < scenario.plan.length,
      'blocked construction exhausted resources without material');
  });
  check('three-building workload retains independent worlds and conserved damaged material', () => {
    const workload = createPixelConstructionWorkload();
    assert(new Set(workload.entries.map(({ scenario }) => scenario.world)).size === 3,
      'workload reused one authoritative world');
    assert(workload.entries.every(({ scenario }) => scenario.rows === 11 &&
      scenario.ticks === 2400 && scenario.world.constructionCount > 0),
      'tall workload did not prepare active crawling material');
    assert(workload.entries[1].destroyed > 0 &&
      workload.entries[0].destroyed === 0 && workload.entries[2].destroyed === 0,
      'damage ledger was not isolated to middle building');
    for (let tick = 0; tick < 1200; tick += 1) workload.step();
    assert(workload.entries[1].scenario.world.debrisCount > 0,
      'damaged workload did not exercise falling material');
    workload.entries[0].scenario.world.excavate(60, 74, 102, 74);
    let failed = false;
    try { workload.verify(); } catch (error) { failed = true; }
    assert(failed, 'unaccounted material loss was not detected');
  });
  check('shared placements reject overlap, bounds and occupied sites without mutation', () => {
    const world = createPixelConstructionWorld(240);
    createPixelConstructionScenario(11, { world, poleOffset: -20 });
    for (const options of [{ world, poleOffset: -19 }, { world, poleOffset: -80 }]) {
      const before = JSON.stringify(world.snapshot());
      let failed = false;
      try { createPixelConstructionScenario(11, options); } catch (error) { failed = true; }
      assert(failed && before === JSON.stringify(world.snapshot()), 'invalid placement changed shared cells');
    }
    const occupied = world.snapshot();
    occupied.cells[50 * world.width + 110] = PARTICLE_DEBRIS;
    world.restore(occupied);
    const before = JSON.stringify(world.snapshot());
    let failed = false;
    try { createPixelConstructionScenario(11, { world, poleOffset: 50 }); } catch (error) { failed = true; }
    assert(failed && before === JSON.stringify(world.snapshot()), 'occupied placement was not atomic');
    world.excavate(110, 50, 110, 50);
    createPixelConstructionScenario(11, { world, poleOffset: 50 });
    assert(world.barrierCount === 18, 'failed placement kept phantom reservations');
  });
  check('shared buildings step one particle clock and conserve water, agents and HM', () => {
    const workload = createSharedPixelConstructionWorkload();
    const world = workload.entries[0].scenario.world;
    assert(workload.entries.every(({ scenario }) => scenario.world === world && scenario.ticks === 2400) &&
      world.snapshot().tick === 2400 && workload.renderScenarios.length === 1,
      'shared preparation advanced particles per building or copied worlds');
    for (let tick = 0; tick < 1800; tick += 1) workload.step();
    assert(world.snapshot().tick === 4200 &&
      workload.entries.every(({ scenario }) => scenario.ticks === 4200),
      'shared particle clock advanced more than once');
    const agents = workload.entries.flatMap(({ scenario }) => scenario.deliveries);
    assert(new Set(agents.map((agent) => `${agent.x},${agent.y}`)).size === agents.length &&
      agents.every((agent) => world.at(agent.x, agent.y) === PARTICLE_CONSTRUCTION),
      'building agents overlapped or lost authoritative material');
    assert(world.countWater(31, 65, 109, 74) > 0 && world.debrisCount > 0,
      'shared basin did not reach building region or blast did not release debris');
    const budgets = workload.entries.map(({ scenario }) => scenario.hm);
    world.excavate(180, 74, 222, 74);
    let failed = false;
    try { workload.verify(); } catch (error) { failed = true; }
    assert(failed && workload.entries.every(({ scenario }, i) => scenario.hm === budgets[i]),
      'untracked shared destruction was accepted or refunded HM');
  });
  check('three dry shared buildings complete with separate exact HM accounting', () => {
    const world = createPixelConstructionWorld(240);
    const scenarios = [-20, 50, 120].map((poleOffset) =>
      createPixelConstructionScenario(5, { world, poleOffset }));
    for (let tick = 0; tick < 60000 && scenarios.some((scenario) => !scenario.finished); tick += 1) {
      world.step();
      for (const scenario of scenarios) scenario.step({ advanceWorld: false });
    }
    assert(scenarios.every((scenario) => scenario.finished && scenario.spent === scenario.plan.length - 9 &&
      scenario.hm === 1000 - scenario.spent && scenario.deliveries.length === 0) &&
      world.barrierCount === scenarios.reduce((sum, scenario) => sum + scenario.plan.length, 0) &&
      world.constructionCount === 0 && world.waterCount === 220,
      'shared dry construction failed to complete or charged another building');
  });
  check('weight capacity holds its exact limit and additional building mass causes failure', () => {
    function tower(capacity, top) {
      const world = createParticleWorld(9, 10, { supportCapacity: capacity, skipEmptyChunks: true });
      world.set(4, 8, PARTICLE_TERRAIN);
      for (let y = 7; y >= top; y -= 1) {
        assert(world.emitConstruction(4, y).ok && world.settleConstruction(4, y).ok, 'tower fixture failed');
      }
      return world;
    }
    const limit = tower(5, 3);
    limit.step();
    assert(limit.barrierCount === 5 && limit.structuralLoad.maximum === 5 &&
      limit.structuralLoad.failed === 0, 'capacity limit did not hold exactly');
    const heavy = tower(5, 2);
    heavy.step();
    assert(heavy.structuralLoad.maximum === 6 && heavy.structuralLoad.failed === 1 &&
      heavy.barrierCount + heavy.debrisCount === 6, 'added weight did not overload the support');
    heavy.step();
    assert(heavy.barrierCount === 0 && heavy.debrisCount === 6,
      'disconnected overloaded tower did not fall conservatively');
    const restored = tower(5, 3);
    restored.restore(limit.snapshot()); restored.step();
    assert(restored.structuralLoad.maximum === 5 && restored.barrierCount === 5,
      'restored weight model failed to recompute');
    let failed = false;
    try { createParticleWorld(5, 5, { supportCapacity: 0 }); } catch (error) { failed = true; }
    assert(failed, 'invalid capacity accepted');
  });
  check('parallel supports share weight and losing one support overloads its neighbor', () => {
    const world = createParticleWorld(9, 10, { supportCapacity: 5 });
    for (const x of [4, 5]) {
      world.set(x, 8, PARTICLE_TERRAIN);
      for (let y = 7; y >= 3; y -= 1) {
        world.emitConstruction(x, y); world.settleConstruction(x, y);
      }
    }
    world.step();
    assert(world.barrierCount === 10 && world.structuralLoad.maximum === 5,
      'thicker support did not share mass through parallel paths');
    world.excavate(4, 8, 4, 8);
    world.step();
    assert(world.structuralLoad.maximum === 10 && world.structuralLoad.failed > 0 &&
      world.barrierCount + world.debrisCount === 10,
      'load did not redistribute after losing one terrain contact');
    world.step();
    assert(world.barrierCount === 0 && world.debrisCount === 10,
      'damaged support did not release the remaining structure');
  });
  check('default tall pixel frame holds its weight but fails when reduced to one ground contact', () => {
    const scenario = createPixelConstructionScenario(11), { world } = scenario;
    const snapshot = world.snapshot();
    for (const cell of scenario.plan) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
    world.restore(snapshot); world.step();
    assert(world.barrierCount === scenario.plan.length && world.structuralLoad.failed === 0 &&
      world.structuralLoad.maximum > 1 && world.structuralLoad.maximum <= 128,
      'intact tall frame did not carry its own weight');
    world.excavate(57, 75, 80, 75);
    world.excavate(82, 75, 107, 75);
    world.step();
    assert(world.structuralLoad.maximum > 128 && world.structuralLoad.failed > 0 &&
      world.barrierCount + world.debrisCount === scenario.plan.length,
      'default-capacity frame stayed supported by a severely overloaded ground contact');
  });
  check('selected shared blasts preserve budgets and track repeated material losses', () => {
    const workload = createSharedPixelConstructionWorkload();
    const world = workload.entries[0].scenario.world;
    const budgets = workload.entries.map(({ scenario }) => scenario.hm);
    const initialMiddle = workload.entries[1].destroyed;
    const before = world.barrierCount + world.constructionCount + world.debrisCount;
    const left = workload.blastBuilding(0);
    const right = workload.blastBuilding(2);
    assert(left.destroyed > 0 && right.destroyed > 0 && left.removed > left.destroyed &&
      workload.entries[1].destroyed === initialMiddle &&
      before - world.barrierCount - world.constructionCount - world.debrisCount === left.destroyed + right.destroyed,
      'selected blasts counted terrain or damaged the wrong ledger');
    const repeated = workload.blastBuilding(0);
    assert(repeated.removed === 0 && repeated.destroyed === 0,
      'repeated blast charged already-removed material');
    assert(workload.entries.every(({ scenario }, index) => scenario.hm === budgets[index]),
      'blast changed an HM budget');
    for (let tick = 0; tick < 120; tick += 1) workload.step();
    const snapshot = JSON.stringify(world.snapshot()), ledger = workload.entries.map((entry) => entry.destroyed);
    for (const index of [-1, 3, 0.5]) {
      let failed = false;
      try { workload.blastBuilding(index); } catch (error) { failed = true; }
      assert(failed && snapshot === JSON.stringify(world.snapshot()) &&
        workload.entries.every((entry, i) => entry.destroyed === ledger[i]),
        'invalid damage selection changed shared state');
    }
  });
  check('shared debris clearing conserves retained material and records removal without refunds', () => {
    const workload = createSharedPixelConstructionWorkload();
    for (let tick = 0; tick < 120; tick += 1) workload.step();
    const world = workload.entries[0].scenario.world;
    const before = world.snapshot(), debris = world.debrisCount;
    const budgets = workload.entries.map(({ scenario }) => scenario.hm);
    const ledgers = workload.entries.map((entry) => entry.destroyed);
    assert(debris > 0, 'no fallen debris in clearing fixture');
    assert(workload.clearDebris() === debris && workload.cleared === debris && world.debrisCount === 0,
      'cleared ledger did not count exactly removed debris');
    const after = world.snapshot();
    assert(before.cells.every((material, index) =>
      after.cells[index] === (material === PARTICLE_DEBRIS ? PARTICLE_EMPTY : material)) &&
      workload.entries.every(({ scenario, destroyed }, index) =>
        scenario.hm === budgets[index] && destroyed === ledgers[index]),
      'clearing changed other material, refunded HM or altered blast ledgers');
    assert(workload.clearDebris() === 0 && workload.cleared === debris,
      'repeated clearing double-counted removal');
    for (let tick = 0; tick < 600; tick += 1) workload.step();
    workload.blastBuilding(2);
    for (let tick = 0; tick < 120; tick += 1) workload.step();
    const next = world.debrisCount, removed = workload.clearDebris();
    assert(removed === next && workload.cleared === debris + next,
      'later blast and clearing failed cumulative conservation');
    workload.verify();
    assert(createSharedPixelConstructionWorkload().cleared === 0,
      'restart retained the previous cleared-material ledger');
  });
  check('foundation restoration preserves occupied ground and exact radius without free building pixels', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    scenario.blastFoundation();
    world.set(60, 75, PARTICLE_WATER);
    const before = world.snapshot(), hm = scenario.hm;
    const result = scenario.restoreFoundation();
    const after = world.snapshot();
    assert(result.restored === 10 && result.blocked === 1 && world.at(60, 75) === PARTICLE_WATER,
      'restoration overwrote water or restored wrong ground count');
    assert(before.cells.every((material, index) => {
      const x = index % world.width, y = Math.floor(index / world.width);
      const eligible = material === PARTICLE_EMPTY && y >= 75 && (x - 60) ** 2 + (y - 74) ** 2 <= 9;
      return after.cells[index] === (eligible ? PARTICLE_TERRAIN : material);
    }) && scenario.hm === hm, 'restoration modified out-of-radius or building material');
    const repeat = scenario.restoreFoundation();
    assert(repeat.restored === 0 && repeat.blocked === 1, 'repeat restoration ignored blockage');
  });
  check('shared paid repair material resumes after clearing and foundation restoration', () => {
    const workload = createSharedPixelConstructionWorkload();
    for (let tick = 0; tick < 120; tick += 1) workload.step();
    const entry = workload.entries[1], world = entry.scenario.world;
    const retained = entry.scenario.deliveries.map((agent) => `${agent.x},${agent.y}`);
    assert(retained.length > 0, 'recovery fixture has no retained material');
    workload.clearDebris();
    const paid = entry.scenario.spent, budgets = workload.entries.map(({ scenario }) => scenario.hm);
    const destroyed = entry.destroyed, cleared = workload.cleared;
    const result = workload.restoreFoundation(1);
    assert(result.restored === 11 && result.blocked === 0 &&
      workload.entries.every(({ scenario }, i) => scenario.hm === budgets[i]) &&
      entry.destroyed === destroyed && workload.cleared === cleared,
      'terrain restoration altered payment/removal ledgers');
    assert(workload.restoreFoundation(1).restored === 0, 'repeat restored terrain twice');
    let resumed = false;
    for (let tick = 0; tick < 120; tick += 1) {
      workload.step();
      if (entry.scenario.deliveries.some((agent) => !retained.includes(`${agent.x},${agent.y}`))) resumed = true;
    }
    assert(resumed && entry.scenario.plan.some((cell) => cell.distance === 0 &&
      world.at(cell.x, cell.y) === PARTICLE_BARRIER) && entry.scenario.spent >= paid,
      'existing paid material did not resume and rebuild foundation');
    workload.verify();
    const before = JSON.stringify(world.snapshot());
    let failed = false;
    try { workload.restoreFoundation(3); } catch (error) { failed = true; }
    assert(failed && before === JSON.stringify(world.snapshot()), 'invalid restoration changed shared world');
  });
  check('carried load inspection and colors are exact, read-only and exclude stale values', () => {
    const world = createParticleWorld(160, 90, { supportCapacity: 10 });
    world.set(60, 75, PARTICLE_TERRAIN);
    for (let y = 74; y >= 65; y -= 1) {
      world.emitConstruction(60, y); world.settleConstruction(60, y);
    }
    assert(world.inspectStructuralLoads().length === 0, 'stale loads exposed before update');
    world.step();
    const before = JSON.stringify(world.snapshot()), loads = world.inspectStructuralLoads();
    assert(loads.length === 10 && loads.find((cell) => cell.y === 74).load === 10 &&
      loads.find((cell) => cell.y === 65).load === 1, 'tower load values incorrect');
    loads[0].load = 900;
    assert(world.inspectStructuralLoads().every((cell) => cell.load <= 10) &&
      before === JSON.stringify(world.snapshot()), 'load inspection modified physics');
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const renderer = createPixelConstructionRenderer(canvas);
    renderer.draw({ world, blueprintCells: () => [] });
    renderer.markLoads(world);
    const ctx = canvas.getContext('2d');
    for (const [y, color] of [[74, [237, 121, 94]], [69, [230, 205, 114]], [65, [188, 231, 123]]]) {
      const pixel = ctx.getImageData(60 * 4, y * 4, 1, 1).data;
      assert(color.every((value, i) => pixel[i] === value), 'load color threshold incorrect');
    }
    world.excavate(60, 75, 60, 75);
    assert(world.inspectStructuralLoads().length === 0, 'stale values shown after support damage');
    world.step();
    assert(world.inspectStructuralLoads().length === 0, 'debris included in load colors');
  });
  check('asymmetric beam weight loads the nearer support without artificial equal sharing', () => {
    const world = createParticleWorld(14, 12, { supportCapacity: 8 });
    for (const x of [4, 5]) {
      world.set(x, 8, PARTICLE_TERRAIN);
      for (let y = 7; y >= 4; y -= 1) {
        world.emitConstruction(x, y); world.settleConstruction(x, y);
      }
    }
    for (let x = 6; x <= 9; x += 1) {
      world.emitConstruction(x, 4); world.settleConstruction(x, 4);
    }
    world.step();
    const loads = world.inspectStructuralLoads();
    assert(loads.find((cell) => cell.x === 4 && cell.y === 7).load === 4 &&
      loads.find((cell) => cell.x === 5 && cell.y === 7).load === 8 &&
      world.barrierCount === 12, 'asymmetric weight was shared artificially or failed at capacity');
    world.excavate(4, 8, 4, 8); world.step();
    assert(world.structuralLoad.maximum === 12 && world.structuralLoad.failed > 0 &&
      world.barrierCount + world.debrisCount === 12, 'damage did not transfer asymmetric load');
  });
  check('cantilever capacity counts beam mass and mirrored layouts behave identically', () => {
    for (const mirrored of [false, true]) {
      const world = createParticleWorld(18, 12, { supportCapacity: 9 });
      const xAt = (x) => mirrored ? 17 - x : x;
      world.set(xAt(4), 8, PARTICLE_TERRAIN);
      for (let y = 7; y >= 4; y -= 1) {
        world.emitConstruction(xAt(4), y); world.settleConstruction(xAt(4), y);
      }
      for (let x = 5; x <= 9; x += 1) {
        world.emitConstruction(xAt(x), 4); world.settleConstruction(xAt(x), 4);
      }
      world.step();
      assert(world.barrierCount === 9 && world.structuralLoad.maximum === 9,
        'cantilever did not carry exact beam weight');
      world.emitConstruction(xAt(10), 4); world.settleConstruction(xAt(10), 4);
      world.step();
      assert(world.structuralLoad.maximum === 10 && world.structuralLoad.failed === 1 &&
        world.barrierCount + world.debrisCount === 10, 'extra cantilever mass did not cause overload');
      world.step();
      assert(world.barrierCount === 0 && world.debrisCount === 10,
        'overloaded cantilever did not release all material');
    }
  });
  check('paid deliveries rebuild a preloaded frame after overload and ground restoration', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const retained = world.constructionCount, paid = scenario.spent;
    // Preplaced fixture mass is accounted separately from the real paid deliveries.
    const injected = scenario.plan.length - 9, snapshot = world.snapshot();
    for (const cell of scenario.plan) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
    world.restore(snapshot);
    world.excavate(57, 75, 80, 75); world.excavate(82, 75, 107, 75);
    for (let tick = 0; tick < 6; tick += 1) scenario.step();
    assert(world.structuralLoad.failed > 0 && world.debrisCount > 0 &&
      scenario.spent === paid && world.constructionCount === retained,
      'overload did not retain paid material');
    const cleared = scenario.clearDebris();
    for (let x = 57; x <= 107; x += 1) {
      if (world.at(x, 75) === PARTICLE_EMPTY) world.set(x, 75, PARTICLE_TERRAIN);
    }
    for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
    assert(scenario.finished && world.constructionCount === 0 && world.debrisCount === 0 &&
      world.barrierCount + cleared === 9 + injected + scenario.spent &&
      world.waterCount === 220 && scenario.hm === 1000 - scenario.spent,
      'overload recovery failed or lost fixture/paid material accounting');
  });
  check('repeated shared damage and restoration cycles retain exact cumulative ledgers', () => {
    const workload = createSharedPixelConstructionWorkload();
    const entry = workload.entries[1];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      if (cycle > 0) workload.blastBuilding(1);
      for (let tick = 0; tick < 120; tick += 1) workload.step();
      const budgets = workload.entries.map(({ scenario }) => scenario.hm);
      const previousCleared = workload.cleared, previousDestroyed = entry.destroyed;
      const removed = workload.clearDebris();
      workload.restoreFoundation(1);
      assert(workload.cleared === previousCleared + removed && entry.destroyed === previousDestroyed &&
        workload.entries.every(({ scenario }, i) => scenario.hm === budgets[i]),
        'cycle refunded HM or changed the wrong removal ledger');
      for (let tick = 0; tick < 1200; tick += 1) workload.step();
      assert(entry.scenario.plan.filter((cell) => cell.distance === 0).every((cell) =>
        entry.scenario.world.at(cell.x, cell.y) === PARTICLE_BARRIER) &&
        entry.scenario.hm < budgets[1], 'cycle did not restore foundation through paid repair');
      workload.verify();
    }
    assert(workload.cleared > 0 && entry.destroyed > 11,
      'cycles did not accumulate actual removed material');
  });
  check('weak natural construction overloads real paid material without preloaded mass', () => {
    const workload = createSharedPixelConstructionWorkload({ natural: true, supportCapacity: 16 });
    const world = workload.entries[0].scenario.world;
    assert(world.barrierCount === 27 && world.constructionCount === 0 &&
      world.structuralLoad.capacity === 16 && workload.entries.every(({ scenario, destroyed }) =>
        scenario.ticks === 0 && scenario.spent === 0 && destroyed === 0), 'natural mode preloaded material');
    let failedAt = 0;
    for (let tick = 0; tick < 18000; tick += 1) {
      workload.step();
      if (world.structuralLoad.failed > 0) { failedAt = tick + 1; break; }
    }
    assert(failedAt > 240 && world.debrisCount > 0 && world.constructionCount > 0 &&
      workload.entries.some(({ scenario }) => scenario.spent > 0),
      'weak natural construction did not overload retained paid material');
    const budgets = workload.entries.map(({ scenario }) => scenario.hm);
    const cleared = workload.clearDebris();
    assert(cleared > 0 && workload.entries.every(({ scenario }, i) => scenario.hm === budgets[i]),
      'natural overload clearing refunded material');
    for (let tick = 0; tick < 600; tick += 1) workload.step();
    workload.verify();
    assert(world.waterCount === 220 && workload.entries.every(({ destroyed }) => destroyed === 0),
      'natural mode introduced blast destruction or lost water');
  });
  check('standard and strong natural presets complete with exact individual HM balances', () => {
    for (const capacity of [128, 256]) {
      const workload = createSharedPixelConstructionWorkload({ natural: true, supportCapacity: capacity });
      for (let tick = 0; tick < 60000 && workload.entries.some(({ scenario }) => !scenario.finished); tick += 1) {
        workload.step();
      }
      const world = workload.entries[0].scenario.world;
      assert(workload.entries.every(({ scenario, destroyed }) => scenario.finished &&
        scenario.spent === scenario.plan.length - 9 && scenario.hm === 1000 - scenario.spent &&
        destroyed === 0) && world.structuralLoad.failed === 0 && world.debrisCount === 0 &&
        world.waterCount === 220, 'preset did not complete normal paid construction');
    }
    for (const options of [{ natural: 'yes' }, { supportCapacity: 0 }, { supportCapacity: NaN }]) {
      let failed = false;
      try { createSharedPixelConstructionWorkload(options); } catch (error) { failed = true; }
      assert(failed, 'invalid experiment options accepted');
    }
  });
  check('paid agents without outline contact are explicitly reported and retained', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const paid = scenario.spent, count = world.constructionCount;
    world.excavate(55, 75, 107, 89);
    world.step(); scenario.clearDebris();
    for (let tick = 0; tick < 12; tick += 1) scenario.step();
    const before = JSON.stringify(world.snapshot());
    assert(scenario.inspectDeliveries().length === count &&
      scenario.inspectDeliveries().every((agent) => !agent.touchingOutline) &&
      scenario.spent === paid && before === JSON.stringify(world.snapshot()),
      'stranded agent reporting changed paid material or claimed an outline');
  });
  check('isolated repair openings show the full material-cell footprint at every display scale', () => {
    for (const scale of [2, 4, 6]) {
      for (const vertical of [false, true]) {
        const world = createParticleWorld(160, 90);
        const snapshot = world.snapshot(), x = 60, y = 50;
        const neighbors = vertical ? [[x, y - 1], [x, y + 1]] : [[x - 1, y], [x + 1, y]];
        for (const [nx, ny] of neighbors) snapshot.cells[ny * world.width + nx] = PARTICLE_BARRIER;
        world.restore(snapshot);
        const canvas = document.createElement('canvas');
        canvas.width = world.width * scale; canvas.height = world.height * scale;
        const renderer = createPixelConstructionRenderer(canvas);
        const scenario = { world, blueprintCells: () => [{ x, y }] };
        const before = JSON.stringify(world.snapshot());
        renderer.draw(scenario);
        const ctx = canvas.getContext('2d'), gap = ctx.getImageData(x * scale, y * scale, scale, scale).data;
        for (let i = 0; i < gap.length; i += 4) {
          assert(gap[i] === 2 && gap[i + 1] === 2 && gap[i + 2] === 2,
            'blueprint border narrowed the repair opening');
        }
        assert(before === JSON.stringify(world.snapshot()), 'gap rendering changed physics');
        if (scale >= 4) {
          const clearance = vertical
            ? ctx.getImageData(x * scale, y * scale - 1, scale - 1, scale + 1).data
            : ctx.getImageData(x * scale - 1, y * scale, scale + 1, scale - 1).data;
          for (let i = 0; i < clearance.length; i += 4) {
            assert(clearance[i] === 2 && clearance[i + 1] === 2 && clearance[i + 2] === 2,
              'repair opening lacked the extra visual clearance beside its neighbor');
          }
        }
        const movingNeighbor = world.snapshot();
        movingNeighbor.cells[neighbors[0][1] * world.width + neighbors[0][0]] = PARTICLE_CONSTRUCTION;
        world.restore(movingNeighbor); renderer.draw(scenario);
        const movingGap = ctx.getImageData(x * scale, y * scale, scale, scale).data;
        for (let i = 0; i < movingGap.length; i += 4) {
          assert(movingGap[i] === 2 && movingGap[i + 1] === 2 && movingGap[i + 2] === 2,
            'moving neighbor caused blueprint to narrow the opening');
        }
        world.restore(snapshot);
        assert(world.emitConstruction(x, y).ok && world.settleConstruction(x, y).ok,
          'full-size repair material did not fit opening');
        renderer.draw(scenario);
        const filled = ctx.getImageData(x * scale, y * scale, scale, scale).data;
        const size = scale >= 4 ? scale - 1 : scale;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const i = (dy * scale + dx) * 4;
            const color = dx < size && dy < size ? [188, 231, 123] : [2, 2, 2];
            assert(color.every((value, channel) => filled[i + channel] === value),
              'repair did not preserve its visible square and clearance');
          }
        }
      }
    }
  });
  check('uneven-span plans preserve mirrored cell footprints and reject invalid placement atomically', () => {
    for (const rows of [5, 9, 11]) {
      const left = createPixelConstructionScenario(rows, { layout: 'narrow-left' });
      const right = createPixelConstructionScenario(rows, { layout: 'narrow-right' });
      const standard = createPixelConstructionScenario(rows);
      const mirrored = new Set(right.plan.map((cell) => `${cell.x},${cell.y}`));
      assert(left.plan.length === standard.plan.length && right.plan.length === standard.plan.length &&
        left.plan.every((cell) => mirrored.has(`${162 - cell.x},${cell.y}`)) &&
        left.world.barrierCount === 9 && right.world.barrierCount === 9,
        'uneven plan changed total mass, seed count or mirrored footprint');
    }
    const world = createPixelConstructionWorld();
    const before = JSON.stringify(world.snapshot());
    let rejected = false;
    try { createPixelConstructionScenario(11, { world, layout: 'invalid' }); }
    catch (error) { rejected = true; }
    assert(rejected && before === JSON.stringify(world.snapshot()), 'invalid layout mutated world');
    const first = createPixelConstructionScenario(11, { world, layout: 'narrow-left' });
    const occupied = JSON.stringify(world.snapshot());
    rejected = false;
    try { createPixelConstructionScenario(11, { world, layout: 'narrow-right' }); }
    catch (error) { rejected = true; }
    assert(rejected && occupied === JSON.stringify(world.snapshot()) && first.spent === 0,
      'overlapping mirrored plan changed existing material');
    rejected = false;
    try { createSharedPixelConstructionWorkload({ layout: 'invalid' }); }
    catch (error) { rejected = true; }
    assert(rejected, 'shared workload accepted invalid layout');
  });
  check('uneven-span shared construction completes with mirrored, unequal foundation loads', () => {
    const workload = createSharedPixelConstructionWorkload({ natural: true, layout: 'asymmetric' });
    const world = workload.entries[0].scenario.world;
    assert(workload.layout === 'asymmetric' && workload.entries.map(({ scenario }) => scenario.layout).join(',') ===
      'standard,narrow-left,narrow-right', 'shared comparison selected incorrect layouts');
    for (let tick = 0; tick < 60000 && workload.entries.some(({ scenario }) => !scenario.finished); tick += 1) {
      workload.step();
    }
    world.step();
    assert(workload.entries.every(({ scenario, destroyed }) => scenario.finished && destroyed === 0 &&
      scenario.spent === scenario.plan.length - 9 && scenario.hm === 1000 - scenario.spent) &&
      world.constructionCount === 0 && world.debrisCount === 0 && world.structuralLoad.failed === 0,
      'uneven-span construction failed completion, capacity or paid-material accounting');
    const loads = world.inspectStructuralLoads();
    const byCell = new Map(loads.map((cell) => [`${cell.x},${cell.y}`, cell.load]));
    for (const cell of workload.entries[1].scenario.plan) {
      assert(Math.abs(byCell.get(`${cell.x},${cell.y}`) - byCell.get(`${332 - cell.x},${cell.y}`)) < 1e-8,
        'mirrored frames carried different static loads');
    }
    const foundationLoad = (from, to) => loads.filter((cell) => cell.y === 74 &&
      cell.x >= from && cell.x <= to).reduce((sum, cell) => sum + cell.load, 0);
    assert(foundationLoad(150, 152) > foundationLoad(110, 112) &&
      Math.abs(foundationLoad(110, 152) - workload.entries[1].scenario.plan.length) < 1e-8,
      'unequal spans did not redistribute full building weight between foundations');
    workload.verify();
    workload.blastBuilding(1);
    for (let tick = 0; tick < 120; tick += 1) workload.step();
    workload.clearDebris(); workload.restoreFoundation(1); workload.verify();
  });
  check('building, delivery and diagnostic squares retain uniform visual clearance without changing physics', () => {
    for (const width of [160, 240]) {
      for (const scale of [2, 4, 6]) {
        const world = createParticleWorld(width, 90, { supportCapacity: 4 });
        world.set(60, 51, PARTICLE_TERRAIN);
        assert(world.emitConstruction(60, 50).ok && world.settleConstruction(60, 50).ok &&
          world.emitConstruction(62, 50).ok, 'clearance fixture placement failed');
        world.step();
        const canvas = document.createElement('canvas');
        canvas.width = width * scale; canvas.height = 90 * scale;
        const renderer = createPixelConstructionRenderer(canvas, width);
        const scenario = { world, blueprintCells: () => [{ x: 61, y: 50 }] };
        const before = JSON.stringify(world.snapshot()), size = scale >= 4 ? scale - 1 : scale;
        const ctx = canvas.getContext('2d');
        const inspect = (x, color, marked = false) => {
          const data = ctx.getImageData(x * scale, 50 * scale, scale, scale).data;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              const i = (dy * scale + dx) * 4;
              if (dx >= size || dy >= size) {
                assert(data[i] === 2 && data[i + 1] === 2 && data[i + 2] === 2,
                  'material or diagnostic overlay filled visual gutter');
              } else if (!marked) {
                assert(color.every((value, channel) => data[i + channel] === value),
                  'building and delivery squares differ in visible dimensions');
              }
            }
          }
        };
        renderer.draw(scenario);
        assert(renderer.pixelSize === size, 'renderer reported wrong visible square size');
        inspect(60, [188, 231, 123]); inspect(62, [239, 249, 177]);
        renderer.markWaiting([{ x: 62, y: 50, state: 'waiting for assignment' }]);
        inspect(62, null, true);
        assert(before === JSON.stringify(world.snapshot()), 'clearance rendering changed original occupancy');
        world.emitConstruction(60, 49); world.settleConstruction(60, 49); world.step();
        const overlayBefore = JSON.stringify(world.snapshot());
        renderer.draw(scenario); renderer.markLoads(world);
        inspect(60, null, true);
        assert(overlayBefore === JSON.stringify(world.snapshot()), 'load overlay changed physics');
        let rejected = false;
        try { world.set(60, 50, PARTICLE_WATER); } catch (error) { rejected = true; }
        assert(rejected && overlayBefore === JSON.stringify(world.snapshot()),
          'visual gutter allowed water into building cell');
      }
    }
  });
  check('junctions and adjacent missing cells preserve square clearance and exact blueprint placement', () => {
    for (const scale of [2, 4, 6]) {
      const world = createParticleWorld(160, 90), snapshot = world.snapshot();
      const solids = [[60, 49], [60, 50], [60, 51], [59, 50], [63, 50], [64, 50]];
      for (const [x, y] of solids) snapshot.cells[y * world.width + x] = PARTICLE_BARRIER;
      world.restore(snapshot);
      const canvas = document.createElement('canvas');
      canvas.width = 160 * scale; canvas.height = 90 * scale;
      const renderer = createPixelConstructionRenderer(canvas);
      const scenario = { world, blueprintCells: () => [{ x: 61, y: 50 }, { x: 62, y: 50 }] };
      const before = JSON.stringify(world.snapshot()), size = renderer.pixelSize;
      renderer.draw(scenario);
      const ctx = canvas.getContext('2d');
      for (const [x, y] of [...solids, [61, 50], [62, 50]]) {
        const data = ctx.getImageData(x * scale, y * scale, scale, scale).data;
        const solid = world.at(x, y) === PARTICLE_BARRIER;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const i = (dy * scale + dx) * 4;
            const interior = dx < size && dy < size;
            const border = interior && (dx === 0 || dy === 0 || dx === size - 1 || dy === size - 1);
            const color = solid && interior ? [188, 231, 123] :
              !solid && border ? [82, 99, 74] : [2, 2, 2];
            assert(color.every((value, channel) => data[i + channel] === value),
              'junction or adjacent opening distorted visible cell dimensions');
          }
        }
      }
      assert(before === JSON.stringify(world.snapshot()), 'junction render changed occupancy');
      assert(world.emitConstruction(61, 50).ok && world.settleConstruction(61, 50).ok &&
        world.emitConstruction(62, 50).ok && world.settleConstruction(62, 50).ok,
        'adjacent repairs failed to fit their physics cells');
      renderer.draw(scenario);
      assert(world.barrierCount === solids.length + 2 && world.constructionCount === 0,
        'adjacent repairs changed material accounting');
    }
  });
  check('corner movement redraws remove old material without leaving clearance or color trails', () => {
    const world = createParticleWorld(160, 90), snapshot = world.snapshot();
    for (const [x, y] of [[60, 50], [61, 50], [60, 51]]) {
      snapshot.cells[y * world.width + x] = PARTICLE_BARRIER;
    }
    world.restore(snapshot); world.emitConstruction(59, 51);
    const path = [[59, 50], [59, 49], [60, 49], [61, 49], [62, 49], [62, 50]];
    for (const scale of [2, 4, 6]) {
      const canvas = document.createElement('canvas');
      canvas.width = 160 * scale; canvas.height = 90 * scale;
      const renderer = createPixelConstructionRenderer(canvas), scenario = { world, blueprintCells: () => [] };
      const initial = world.snapshot();
      let previous = { x: 59, y: 51 };
      for (const [x, y] of path) {
        renderer.draw(scenario);
        assert(world.moveConstruction(previous.x, previous.y, x, y).ok, 'cardinal corner move failed');
        const before = JSON.stringify(world.snapshot());
        renderer.draw(scenario);
        const ctx = canvas.getContext('2d'), old = ctx.getImageData(previous.x * scale, previous.y * scale, scale, scale).data;
        assert(Array.from(old).every((value, i) => value === (i % 4 === 3 ? 255 : 2)),
          'previous moving cell retained a visual trail');
        const current = ctx.getImageData(x * scale, y * scale, scale, scale).data;
        let bright = 0;
        for (let i = 0; i < current.length; i += 4) {
          if (current[i] === 239 && current[i + 1] === 249 && current[i + 2] === 177) bright += 1;
        }
        assert(bright === renderer.pixelSize ** 2 && before === JSON.stringify(world.snapshot()) &&
          world.barrierCount === 3 && world.constructionCount === 1, 'corner redraw changed size or material');
        previous = { x, y };
      }
      world.restore(initial);
    }
  });
  check('responsive sizing snaps narrow and high-density displays without changing the scenario', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    const host = document.createElement('div'), canvas = document.createElement('canvas');
    host.style.position = 'absolute'; host.style.left = '-10000px';
    host.appendChild(canvas); document.body.appendChild(host);
    const scenario = createPixelConstructionScenario(5);
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const before = JSON.stringify(scenario.world.snapshot()), spent = scenario.spent, hm = scenario.hm;
    const renderer = createPixelConstructionRenderer(canvas);
    try {
      for (const ratio of [1, 1.25, 1.5, 2, 3]) {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: ratio });
        for (const width of [240, 319, 320, 479, 640, 960]) {
          host.style.width = `${width}px`;
          renderer.resize(); renderer.draw(scenario);
          const expected = 320 * Math.max(1, Math.floor(width * ratio / 320));
          assert(canvas.width === expected && canvas.height === expected * 90 / 160 &&
            canvas.width / 160 % 2 === 0 && Math.abs(parseFloat(canvas.style.width) - expected / ratio) < 0.001,
            'responsive display produced uneven cells or incorrect high-density sizing');
          assert(width * ratio >= 320 ? parseFloat(canvas.style.width) <= width :
            parseFloat(canvas.style.width) > width, 'narrow display did not preserve minimum scale for scrolling');
        }
      }
      assert(before === JSON.stringify(scenario.world.snapshot()) && scenario.hm === hm && scenario.spent === spent,
        'resizing changed material or charged HM');
    } finally {
      if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor);
      else delete window.devicePixelRatio;
      host.remove();
    }
  });
  check('terrain inspection reports modified ground and occupied delivery points without changing the plan', () => {
    for (const layout of ['standard', 'narrow-left', 'narrow-right']) {
      const scenario = createPixelConstructionScenario(5, { layout }), { world } = scenario;
      const original = scenario.inspectTerrain();
      assert(original.foundationTerrain === 9 && original.planTerrain.length === 0 &&
        original.blockedDeliveries.length === 0, 'initial terrain report incorrect');
      const site = scenario.plan.find((cell) => cell.distance === 1);
      world.set(site.x, site.y, PARTICLE_TERRAIN);
      world.set(57, 74, PARTICLE_TERRAIN); world.set(65, 74, PARTICLE_WATER);
      world.excavate(60, 75, 62, 75);
      const before = JSON.stringify(world.snapshot()), plan = JSON.stringify(scenario.plan);
      const report = scenario.inspectTerrain();
      assert(report.foundationTerrain === 6 && report.planTerrain.length === 1 &&
        report.planTerrain[0].x === site.x && report.planTerrain[0].y === site.y &&
        report.blockedDeliveries.length === 2 &&
        report.blockedDeliveries.some((cell) => cell.material === PARTICLE_WATER) &&
        report.blockedDeliveries.some((cell) => cell.material === PARTICLE_TERRAIN),
        'modified terrain, excavation or occupied source omitted');
      report.planTerrain[0].x = 0; report.blockedDeliveries[0].y = 0;
      assert(before === JSON.stringify(world.snapshot()) && plan === JSON.stringify(scenario.plan) &&
        scenario.spent === 0 && scenario.inspectTerrain().planTerrain[0].x === site.x,
        'inspection mutated world, plan or returned shared mutable cells');
    }
  });
  check('terrain inside an unfinished plan retains paid material and clearing it permits exact rebuilding', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const sites = scenario.inspectSites().filter((cell) => world.at(cell.x, cell.y) === PARTICLE_EMPTY);
    assert(sites.length > 0 && world.constructionCount > 0, 'no paid terrain obstruction fixture');
    const paid = scenario.spent, hm = scenario.hm, plan = JSON.stringify(scenario.plan);
    for (const cell of sites) world.set(cell.x, cell.y, PARTICLE_TERRAIN);
    for (let tick = 0; tick < 1200; tick += 1) scenario.step();
    assert(!scenario.finished && scenario.spent === paid && scenario.hm === hm &&
      world.barrierCount + world.constructionCount + world.debrisCount === 9 + paid &&
      sites.every((cell) => world.at(cell.x, cell.y) === PARTICLE_TERRAIN) &&
      scenario.inspectTerrain().planTerrain.length === sites.length &&
      plan === JSON.stringify(scenario.plan), 'terrain was overwritten, plan shifted or paid material lost');
    for (const cell of sites) world.excavate(cell.x, cell.y, cell.x, cell.y);
    for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
    assert(scenario.finished && scenario.spent === scenario.plan.length - 9 &&
      world.barrierCount === scenario.plan.length && world.constructionCount === 0 &&
      world.debrisCount === 0 && world.waterCount === 220 && scenario.hm === 1000 - scenario.spent,
      'cleared terrain obstruction did not resume exact paid construction');
  });
  check('terrain-blocked delivery points stop emission and clearing them resumes unchanged construction', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    const sources = [57, 65, 77, 85, 97, 105];
    for (const x of sources) world.set(x, 74, PARTICLE_TERRAIN);
    for (let tick = 0; tick < 600; tick += 1) scenario.step();
    assert(scenario.spent === 0 && scenario.hm === 1000 && world.barrierCount === 9 &&
      world.constructionCount === 0 && scenario.inspectTerrain().blockedDeliveries.length === 6,
      'occupied delivery points were overwritten or charged HM');
    for (const x of sources) world.excavate(x, 74, x, 74);
    for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
    assert(scenario.finished && scenario.spent === scenario.plan.length - 9 &&
      scenario.hm === 1000 - scenario.spent && world.waterCount === 220,
      'cleared delivery points did not resume construction');
  });
  check('repair route audits preserve assignments and separate blocked sites from route availability', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    assert(scenario.inspectRecovery().phase === 'revealing' &&
      scenario.inspectRecovery().agents.length === 0, 'audit ignored reveal phase');
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const before = JSON.stringify(world.snapshot()), deliveries = JSON.stringify(scenario.deliveries);
    const hm = scenario.hm, spent = scenario.spent;
    const report = scenario.inspectRecovery();
    assert(report.phase === 'constructing' && report.tick === 300 && report.agents.length > 0 &&
      report.agents.every((agent) => agent.state === 'route available' && agent.route &&
        Number.isInteger(agent.route.steps) && agent.route.steps >= 0),
      'audit did not include retained agents own valid routes');
    for (const agent of report.agents) {
      const cell = scenario.plan.find((cell) => cell.x === agent.route.target.x && cell.y === agent.route.target.y);
      assert(cell && scenario.inspectSites().some((site) => site.distance === cell.distance),
        'audit routed to a later unfinished layer');
    }
    report.agents[0].route.target.x = 0;
    assert(before === JSON.stringify(world.snapshot()) && deliveries === JSON.stringify(scenario.deliveries) &&
      scenario.hm === hm && scenario.spent === spent &&
      scenario.inspectRecovery().agents.every((agent) => agent.route.target.x !== 0),
      'route audit mutated material, assignments, HM or shared target coordinates');
    for (const cell of scenario.inspectSites()) {
      if (world.at(cell.x, cell.y) === PARTICLE_EMPTY) world.set(cell.x, cell.y, PARTICLE_TERRAIN);
    }
    const blocked = scenario.inspectRecovery();
    assert(blocked.agents.every((agent) => agent.state === 'no eligible sites' && agent.route === null),
      'audit treated terrain-occupied targets as eligible repair sites');
  });
  check('restored terrain reconnects retained paid agents without teleporting or refunding material', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const spent = scenario.spent, hm = scenario.hm, retained = world.constructionCount;
    world.excavate(55, 75, 107, 89);
    world.step();
    const cleared = scenario.clearDebris();
    for (let tick = 0; tick < 12; tick += 1) scenario.step();
    const stranded = scenario.inspectRecovery();
    assert(stranded.agents.length === retained && stranded.agents.every((agent) =>
      !agent.touchingOutline && agent.route === null), 'lost outline was not diagnosed');
    const positions = JSON.stringify(scenario.deliveries.map(({ x, y }) => ({ x, y })));
    for (let x = 55; x <= 107; x += 1) world.set(x, 75, PARTICLE_TERRAIN);
    const restored = scenario.inspectRecovery();
    assert(restored.agents.some((agent) => agent.route) && scenario.hm === hm && scenario.spent === spent &&
      positions === JSON.stringify(scenario.deliveries.map(({ x, y }) => ({ x, y }))),
      'terrain restoration failed route recovery or moved/refunded agents');
    for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
    assert(scenario.finished && world.barrierCount + world.constructionCount + world.debrisCount + cleared ===
      9 + scenario.spent && scenario.hm === 1000 - scenario.spent && world.waterCount === 220,
      'retained paid agents did not rebuild with exact cleared-material accounting');
  });
  check('raised-terrain preset keeps blueprints and ground contacts clear while occupying one source per building', () => {
    const baseline = createSharedPixelConstructionWorkload({ natural: true });
    const workload = createSharedPixelConstructionWorkload({ natural: true, ground: 'raised', layout: 'asymmetric' });
    const world = workload.entries[0].scenario.world;
    assert(baseline.ground === 'flat' && workload.ground === 'raised' &&
      world.terrainCount === baseline.entries[0].scenario.world.terrainCount + 18 &&
      world.barrierCount === 27 && world.waterCount === 220,
      'terrain preset changed seeds, basin or number of terrain cells');
    for (const { scenario } of workload.entries) {
      const report = scenario.inspectTerrain();
      assert(report.planTerrain.length === 0 && report.foundationTerrain === 9 &&
        report.blockedDeliveries.length === 1 && report.blockedDeliveries[0].material === PARTICLE_TERRAIN &&
        scenario.spent === 0 && scenario.hm === 1000, 'raised steps obstructed plan or charged HM');
    }
    let rejected = false;
    try { createSharedPixelConstructionWorkload({ ground: 'invalid' }); } catch (error) { rejected = true; }
    assert(rejected, 'invalid terrain preset accepted');
  });
  check('natural raised-terrain construction completes all frames without overwriting terrain', () => {
    const workload = createSharedPixelConstructionWorkload({ natural: true, ground: 'raised', layout: 'asymmetric' });
    const world = workload.entries[0].scenario.world;
    const terrain = world.snapshot().cells.map((material, index) => material === PARTICLE_TERRAIN ? index : -1)
      .filter((index) => index >= 0);
    for (let tick = 0; tick < 120000 && workload.entries.some(({ scenario }) => !scenario.finished); tick += 1) {
      workload.step();
    }
    assert(workload.entries.every(({ scenario }) => scenario.finished &&
      scenario.spent === scenario.plan.length - 9 && scenario.hm === 1000 - scenario.spent) &&
      world.constructionCount === 0 && world.debrisCount === 0 && world.structuralLoad.failed === 0 &&
      terrain.every((index) => world.at(index % world.width, Math.floor(index / world.width)) === PARTICLE_TERRAIN),
      'raised terrain blocked completion, was overwritten or broke material/weight accounting');
    workload.verify();
  });
  check('raised-terrain damaged foundation resumes paid rebuilding after debris clearing and ground restoration', () => {
    const workload = createSharedPixelConstructionWorkload({ ground: 'raised', layout: 'asymmetric' });
    const selected = workload.entries[1].scenario, world = selected.world;
    for (let tick = 0; tick < 120; tick += 1) workload.step();
    workload.clearDebris();
    const before = selected.hm, destroyed = workload.entries[1].destroyed;
    const restored = workload.restoreFoundation(1);
    assert(restored.restored === 11 && selected.hm === before && destroyed > 0 &&
      workload.entries[1].destroyed === destroyed &&
      selected.inspectTerrain().planTerrain.length === 0,
      'raised terrain changed original ground restoration or refunded HM');
    for (let tick = 0; tick < 6000; tick += 1) workload.step();
    assert(selected.plan.filter((cell) => cell.distance === 0).every((cell) =>
      world.at(cell.x, cell.y) === PARTICLE_BARRIER) && selected.hm < before &&
      world.waterCount === 220, 'modified-terrain foundation did not resume paid rebuilding');
    workload.verify();
  });
  check('partial restoration identifies every occupied material and retries only cleared ground cells', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    scenario.blastFoundation();
    const snapshot = world.snapshot();
    const blockers = [
      { x: 58, y: 75, material: PARTICLE_WATER },
      { x: 59, y: 75, material: PARTICLE_DEBRIS },
      { x: 60, y: 75, material: PARTICLE_BARRIER },
      { x: 61, y: 75, material: PARTICLE_CONSTRUCTION },
    ];
    for (const cell of blockers) snapshot.cells[cell.y * world.width + cell.x] = cell.material;
    world.restore(snapshot);
    const before = world.snapshot(), hm = scenario.hm, spent = scenario.spent;
    const result = scenario.restoreFoundation();
    assert(result.restored === 7 && result.blocked === 4 && result.blockedCells.length === 4 &&
      blockers.every((cell) => result.blockedCells.some((reported) => reported.x === cell.x &&
        reported.y === cell.y && reported.material === cell.material)),
      'partial result omitted coordinates or misidentified blocking material');
    const after = world.snapshot();
    for (let index = 0; index < before.cells.length; index += 1) {
      if (before.cells[index] !== after.cells[index]) {
        const x = index % world.width, y = Math.floor(index / world.width);
        assert(before.cells[index] === PARTICLE_EMPTY && after.cells[index] === PARTICLE_TERRAIN &&
          y >= 75 && (x - 60) ** 2 + (y - 74) ** 2 <= 9, 'restoration changed an occupied or out-of-region cell');
      }
    }
    result.blockedCells[0].x = 0;
    const repeat = scenario.restoreFoundation();
    assert(repeat.restored === 0 && repeat.blocked === 4 && repeat.blockedCells[0].x === 58 &&
      JSON.stringify(after) === JSON.stringify(world.snapshot()), 'repeat restoration changed blockers or shared report cells');
    // Removing fixture blockers is explicit test setup, not a restoration feature.
    const cleared = world.snapshot();
    for (const cell of blockers) cleared.cells[cell.y * world.width + cell.x] = PARTICLE_EMPTY;
    world.restore(cleared);
    const retry = scenario.restoreFoundation();
    assert(retry.restored === 4 && retry.blocked === 0 && retry.blockedCells.length === 0 &&
      scenario.restoreFoundation().restored === 0 && scenario.hm === hm && scenario.spent === spent,
      'retry did not restore only newly cleared cells or changed HM');
  });
  check('delivery-source audit distinguishes reveal, occupancy, reservations and the active agent limit', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    let report = scenario.inspectRecovery();
    assert(report.hm === 1000 && report.agentSlots === 6 && report.sources.length === 6 &&
      report.sources.every((source) => source.state === 'revealing' && source.route === null),
      'source audit offered emission before blueprint reveal');
    for (let tick = 0; tick < 241; tick += 1) scenario.step();
    report = scenario.inspectRecovery();
    assert(report.sources.every((source) => source.state === 'ready for next delivery check' &&
      source.route && source.material === PARTICLE_EMPTY), 'clear sources lacked eligible routes');
    world.set(57, 74, PARTICLE_TERRAIN);
    report = scenario.inspectRecovery();
    assert(report.sources[0].state === 'occupied' && report.sources[0].material === PARTICLE_TERRAIN &&
      report.sources[0].route === null, 'terrain source was marked ready');
    world.excavate(57, 74, 57, 74);
    for (let tick = 241; tick < 303; tick += 1) scenario.step();
    assert(scenario.deliveries.length === 6, 'agent-limit fixture did not emit six paid pixels');
    const before = JSON.stringify(world.snapshot()), assignments = JSON.stringify(scenario.deliveries);
    const hm = scenario.hm, spent = scenario.spent;
    report = scenario.inspectRecovery();
    const reserved = new Set(scenario.deliveries.filter((agent) => agent.target)
      .map((agent) => `${agent.target.x},${agent.target.y}`));
    assert(report.agentSlots === 0 && report.hm === hm &&
      report.sources.some((source) => source.material === PARTICLE_EMPTY) &&
      report.sources.filter((source) => source.material === PARTICLE_EMPTY).every((source) =>
        source.state === 'agent limit reached') &&
      report.sources.every((source) => !source.route ||
        !reserved.has(`${source.route.target.x},${source.route.target.y}`)),
      'source audit ignored slots or routed to another agents reserved target');
    const routed = report.sources.find((source) => source.route);
    if (routed) routed.route.target.x = 0;
    assert(before === JSON.stringify(world.snapshot()) && assignments === JSON.stringify(scenario.deliveries) &&
      scenario.hm === hm && scenario.spent === spent, 'source audit modified reservations or economy');
  });
  check('raised-terrain source audit exposes one occupied source per building without changing the world', () => {
    for (const ground of ['flat', 'raised']) {
      const workload = createSharedPixelConstructionWorkload({ natural: true, ground, layout: 'asymmetric' });
      for (let tick = 0; tick < 241; tick += 1) workload.step();
      const world = workload.entries[0].scenario.world, before = JSON.stringify(world.snapshot());
      for (const { scenario } of workload.entries) {
        const report = scenario.inspectRecovery();
        assert(report.sources.filter((source) => source.state === 'occupied').length === (ground === 'raised' ? 1 : 0) &&
          report.sources.some((source) => source.state === 'ready for next delivery check') &&
          scenario.spent === 0 && scenario.hm === 1000, 'terrain/source availability comparison incorrect');
      }
      assert(before === JSON.stringify(world.snapshot()), 'source comparison mutated shared terrain');
      workload.verify();
    }
  });
  check('delivery metrics exclude reveal, measure paid emissions and freeze at completion', () => {
    const scenario = createPixelConstructionScenario(5);
    assert(scenario.deliveryStats.elapsedTicks === 0 && scenario.deliveryStats.deliveryChecks === 0 &&
      scenario.deliveryStats.lastDeliveryTick === null, 'initial delivery metrics incorrect');
    for (let tick = 0; tick < 240; tick += 1) scenario.step();
    assert(scenario.deliveryStats.elapsedTicks === 0 && scenario.deliveryStats.pixelsPerMinute === 0,
      'reveal time counted as construction time');
    for (let tick = 240; tick < 300; tick += 1) scenario.step();
    const stats = scenario.deliveryStats;
    assert(stats.elapsedTicks === 60 && stats.deliveryChecks === 1 && stats.productiveChecks === 1 &&
      stats.lastDeliveryTick === 300 && stats.paidPixels === 6 && stats.pixelsPerMinute === 360,
      'delivery rate or first productive check incorrect');
    const before = JSON.stringify(scenario.world.snapshot()), assignments = JSON.stringify(scenario.deliveries);
    stats.productiveChecks = 0;
    assert(scenario.deliveryStats.productiveChecks === 1 && before === JSON.stringify(scenario.world.snapshot()) &&
      assignments === JSON.stringify(scenario.deliveries), 'metrics exposed mutable state or changed construction');
    for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
    assert(scenario.finished && scenario.deliveryStats.completedTick === scenario.ticks &&
      scenario.deliveryStats.paidPixels === scenario.plan.length - 9, 'completion metrics incorrect');
    const completed = JSON.stringify(scenario.deliveryStats);
    scenario.blastFoundation();
    for (let tick = 0; tick < 120; tick += 1) scenario.step();
    assert(completed === JSON.stringify(scenario.deliveryStats), 'post-completion damage changed frozen timing');
  });
  check('blocked-source metrics count unproductive checks and reset on new construction', () => {
    const scenario = createPixelConstructionScenario(5);
    for (const x of [57, 65, 77, 85, 97, 105]) scenario.world.set(x, 74, PARTICLE_TERRAIN);
    for (let tick = 0; tick < 600; tick += 1) scenario.step();
    const stats = scenario.deliveryStats;
    assert(stats.elapsedTicks === 360 && stats.deliveryChecks === 6 && stats.productiveChecks === 0 &&
      stats.lastDeliveryTick === null && stats.paidPixels === 0 && stats.pixelsPerMinute === 0 &&
      scenario.hm === 1000, 'blocked-source checks charged material or claimed productivity');
    const fresh = createPixelConstructionScenario(5).deliveryStats;
    assert(fresh.elapsedTicks === 0 && fresh.deliveryChecks === 0 && fresh.completedTick === null,
      'new scenario retained prior throughput metrics');
  });
  check('damage releases later-layer assignments before paid agents resume earliest-layer repair', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let tick = 0; tick < 1800; tick += 1) scenario.step();
    assert(scenario.deliveries.some((agent) => agent.target &&
      scenario.plan.find((cell) => cell.x === agent.target.x && cell.y === agent.target.y).distance > 0),
      'damage fixture had no later-layer target');
    const spent = scenario.spent, hm = scenario.hm, snapshot = world.snapshot();
    snapshot.cells[74 * world.width + 100] = PARTICLE_EMPTY;
    world.restore(snapshot);
    assert(scenario.inspectDeliveries().some((agent) => agent.state === 'waiting: earlier layer needs repair'),
      'stale later-layer assignment was not diagnosed');
    for (let tick = 0; tick < 3; tick += 1) scenario.step({ advanceWorld: false });
    assert(scenario.deliveries.every((agent) => !agent.target ||
      scenario.plan.find((cell) => cell.x === agent.target.x && cell.y === agent.target.y).distance === 0) &&
      scenario.spent === spent && scenario.hm === hm &&
      world.barrierCount + world.constructionCount + world.debrisCount + 1 === 9 + spent,
      'later-layer reservations persisted or reassignment lost/charged paid material');
    let repaired = world.at(100, 74) === PARTICLE_BARRIER;
    for (let tick = 0; tick < 3000 && !repaired; tick += 1) {
      scenario.step(); repaired = world.at(100, 74) === PARTICLE_BARRIER;
    }
    assert(repaired && world.barrierCount + world.constructionCount + world.debrisCount + 1 ===
      9 + scenario.spent && scenario.hm === 1000 - scenario.spent,
      'earliest-layer repair failed or broke accounting');
  });
  check('terrain-occupied targets release reservations without moving or refunding their material for free', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const target = scenario.deliveries[0].target;
    world.set(target.x, target.y, PARTICLE_TERRAIN);
    const spent = scenario.spent, hm = scenario.hm;
    assert(scenario.inspectDeliveries().some((agent) => agent.state === 'waiting: target occupied by terrain'),
      'occupied target lacked explicit diagnostic');
    for (let tick = 0; tick < 3; tick += 1) scenario.step({ advanceWorld: false });
    assert(scenario.deliveries.every((agent) => !agent.target ||
      agent.target.x !== target.x || agent.target.y !== target.y) &&
      world.at(target.x, target.y) === PARTICLE_TERRAIN &&
      scenario.spent === spent && scenario.hm === hm &&
      world.barrierCount + world.constructionCount + world.debrisCount === 9 + spent,
      'occupied target retained reservation, overwrote terrain or lost material');
  });
  check('water and debris occupying assigned targets retain paid agents and release reservations before recovery', () => {
    for (const material of [PARTICLE_WATER, PARTICLE_DEBRIS]) {
      const scenario = createPixelConstructionScenario(5), { world } = scenario;
      for (let tick = 0; tick < 300; tick += 1) scenario.step();
      const target = scenario.deliveries[0].target, spent = scenario.spent, hm = scenario.hm;
      const snapshot = world.snapshot(), targetIndex = target.y * world.width + target.x;
      snapshot.cells[targetIndex] = material;
      world.restore(snapshot);
      const injectedMass = material === PARTICLE_DEBRIS ? 1 : 0;
      const water = material === PARTICLE_WATER ? 221 : 220;
      const expected = material === PARTICLE_WATER ? 'water' : 'fallen debris';
      assert(scenario.inspectDeliveries().some((agent) =>
        agent.state === `waiting: target occupied by ${expected}`), 'target blocker material not identified');
      for (let tick = 0; tick < 3; tick += 1) scenario.step({ advanceWorld: false });
      assert(scenario.deliveries.every((agent) => !agent.target ||
        agent.target.x !== target.x || agent.target.y !== target.y) &&
        world.at(target.x, target.y) === material && world.waterCount === water &&
        scenario.spent === spent && scenario.hm === hm &&
        world.barrierCount + world.constructionCount + world.debrisCount === 9 + spent + injectedMass,
        'occupied target kept reservation or overwrote/lost fixture or paid material');
      // Remove only injected fixture material; live clearing must use its own ledger.
      const cleared = world.snapshot();
      cleared.cells[targetIndex] = PARTICLE_EMPTY;
      world.restore(cleared);
      for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
      assert(scenario.finished && scenario.spent === scenario.plan.length - 9 &&
        world.barrierCount === scenario.plan.length && world.waterCount === 220 &&
        world.debrisCount === 0 && world.constructionCount === 0 && scenario.hm === 1000 - scenario.spent,
        'cleared water/debris target did not recover with exact paid accounting');
    }
  });
  check('repeated foundation damage during active shared repairs preserves unique earliest-layer targets', () => {
    const workload = createSharedPixelConstructionWorkload({ natural: true, ground: 'raised', layout: 'asymmetric' });
    for (let tick = 0; tick < 1800; tick += 1) workload.step();
    const selected = workload.entries[1].scenario, world = selected.world;
    for (let cycle = 0; cycle < 2; cycle += 1) {
      assert(!selected.finished, 'damage fixture had already completed');
      const result = workload.blastBuilding(1);
      assert(result.destroyed > 0, 'repeat damage did not remove building material');
      for (let tick = 0; tick < 60; tick += 1) workload.step();
      const hm = selected.hm;
      workload.clearDebris(); workload.restoreFoundation(1);
      assert(selected.hm === hm, 'clearing/restoration refunded HM');
      let repaired = false;
      for (let tick = 0; tick < 6000 && !repaired; tick += 1) {
        workload.step();
        if (selected.ticks % 3 === 0) {
          const targets = selected.deliveries.filter((agent) => agent.target).map((agent) => agent.target);
          assert(new Set(targets.map((cell) => `${cell.x},${cell.y}`)).size === targets.length,
            'repair agents shared a reserved target');
        }
        repaired = selected.plan.filter((cell) => cell.distance === 0).every((cell) =>
          world.at(cell.x, cell.y) === PARTICLE_BARRIER);
      }
      assert(repaired && !selected.finished && selected.hm < hm, 'active repair did not rebuild paid foundations');
      workload.verify();
    }
    assert(workload.entries[1].destroyed > 11 && workload.cleared > 0 && world.waterCount === 220,
      'repeated active damage did not accumulate exact ledgers');
  });
  check('traffic diagnostics distinguish target and next-step blockers without changing paid agents', () => {
    for (const location of ['target', 'next step']) {
      for (const material of [PARTICLE_CONSTRUCTION, PARTICLE_TERRAIN]) {
        const scenario = createPixelConstructionScenario(5), { world } = scenario;
        for (let tick = 0; tick < 300; tick += 1) scenario.step();
        const agent = scenario.deliveries.find((agent) => agent.target && agent.path.length > 1);
        assert(agent, 'no multi-step delivery route for traffic fixture');
        const cell = location === 'target' ? agent.target : agent.path[0];
        const snapshot = world.snapshot();
        snapshot.cells[cell.y * world.width + cell.x] = material;
        world.restore(snapshot);
        const before = JSON.stringify(world.snapshot()), assignments = JSON.stringify(scenario.deliveries);
        const hm = scenario.hm, spent = scenario.spent;
        const inspect = () => scenario.inspectDeliveries().find((delivery) =>
          delivery.x === agent.x && delivery.y === agent.y);
        const report = inspect(), blocker = report.blocker;
        assert(blocker && blocker.x === cell.x && blocker.y === cell.y &&
          blocker.location === location && blocker.material === material &&
          blocker.kind === (material === PARTICLE_CONSTRUCTION ? 'delivery traffic' : 'occupied material') &&
          report.blockerDescription.includes(`(${cell.x}, ${cell.y})`),
          'blocker classification or coordinates incorrect');
        blocker.x = 0;
        assert(inspect().blocker.x === cell.x && before === JSON.stringify(world.snapshot()) &&
          assignments === JSON.stringify(scenario.deliveries) && scenario.hm === hm && scenario.spent === spent,
          'traffic diagnostic mutated assignments, blocker cells or HM');
        if (location === 'next step') {
          assert(!world.moveConstruction(agent.x, agent.y, cell.x, cell.y).ok &&
            before === JSON.stringify(world.snapshot()), 'moving material entered occupied next step');
        }
        for (let tick = 0; tick < 3; tick += 1) scenario.step({ advanceWorld: false });
        assert(world.at(cell.x, cell.y) === material && scenario.hm === hm && scenario.spent === spent &&
          world.barrierCount + world.constructionCount + world.debrisCount ===
            9 + spent + (material === PARTICLE_CONSTRUCTION ? 1 : 0),
          'traffic response overwrote blocker or lost/refunded material');
        if (location === 'target') {
          assert(scenario.deliveries.every((delivery) => !delivery.target ||
            delivery.target.x !== cell.x || delivery.target.y !== cell.y),
            'moving-material target retained reservation');
        }
      }
    }
  });
  check('ground-only excavation preserves non-terrain materials and all shared ledgers', () => {
    const workload = createSharedPixelConstructionWorkload({ natural: true });
    const scenario = workload.entries[1].scenario, world = scenario.world;
    const hm = workload.entries.map(({ scenario }) => scenario.hm);
    const before = world.snapshot(), removed = workload.excavateFoundationGround(1);
    assert(removed === 3 && scenario.inspectTerrain().foundationTerrain === 6 &&
      workload.entries.every(({ scenario, destroyed }, index) => scenario.hm === hm[index] &&
        scenario.spent === 0 && destroyed === 0) && workload.cleared === 0,
      'ground excavation changed budgets, ledgers or wrong terrain count');
    const after = world.snapshot();
    for (let index = 0; index < before.cells.length; index += 1) {
      if (before.cells[index] !== after.cells[index]) {
        assert(Math.floor(index / world.width) === 75 && index % world.width >= 110 &&
          index % world.width <= 112 && before.cells[index] === PARTICLE_TERRAIN &&
          after.cells[index] === PARTICLE_EMPTY, 'ground tool removed out-of-scope material');
      }
    }
    assert(workload.excavateFoundationGround(1) === 0, 'repeat excavation removed new material');
    const snapshot = world.snapshot();
    const materials = [PARTICLE_WATER, PARTICLE_DEBRIS, PARTICLE_CONSTRUCTION];
    materials.forEach((material, index) => { snapshot.cells[75 * world.width + 110 + index] = material; });
    world.restore(snapshot);
    const occupied = JSON.stringify(world.snapshot());
    assert(scenario.excavateFoundationGround() === 0 && occupied === JSON.stringify(world.snapshot()),
      'ground-only tool removed occupied non-terrain cells');
    world.restore(after);
    let rejected = false;
    try { workload.excavateFoundationGround(3); } catch (error) { rejected = true; }
    assert(rejected && JSON.stringify(after) === JSON.stringify(world.snapshot()),
      'invalid ground-tool selection modified shared world');
    assert(workload.restoreFoundation(1).restored === 3 &&
      scenario.inspectTerrain().foundationTerrain === 9, 'ground-only excavation did not restore exact cells');
    workload.verify();
  });
  check('partial foundation excavation redistributes carried weight and restoration recomputes original loads', () => {
    const workload = createSharedPixelConstructionWorkload({ natural: true, layout: 'asymmetric', supportCapacity: 256 });
    for (let tick = 0; tick < 60000 && workload.entries.some(({ scenario }) => !scenario.finished); tick += 1) {
      workload.step();
    }
    const world = workload.entries[0].scenario.world;
    assert(workload.entries.every(({ scenario }) => scenario.finished), 'weight fixture did not complete');
    world.step();
    const loads = () => world.inspectStructuralLoads().filter((cell) => cell.x >= 110 && cell.x <= 152);
    const initial = loads(), budgets = workload.entries.map(({ scenario }) => scenario.hm);
    const intact = world.snapshot();
    const rootLoad = (cells) => cells.filter((cell) => cell.y === 74 && cell.x >= 122)
      .reduce((sum, cell) => sum + cell.load, 0);
    const material = world.barrierCount + world.debrisCount + world.constructionCount;
    assert(workload.excavateFoundationGround(1) === 3 && world.inspectStructuralLoads().length === 0,
      'excavation showed stale load cache');
    workload.step();
    const redistributed = loads();
    assert(rootLoad(redistributed) > rootLoad(initial) && world.structuralLoad.failed === 0 &&
      world.barrierCount + world.debrisCount + world.constructionCount === material,
      'remaining supports did not pick up weight or material was lost');
    assert(workload.restoreFoundation(1).restored === 3, 'partial ground failed exact restoration');
    workload.step();
    const restored = new Map(loads().map((cell) => [`${cell.x},${cell.y}`, cell.load]));
    assert(initial.every((cell) => Math.abs(restored.get(`${cell.x},${cell.y}`) - cell.load) < 1e-8) &&
      workload.entries.every(({ scenario }, index) => scenario.hm === budgets[index]),
      'ground restoration did not restore original static loads or altered HM');
    workload.verify();
    const standard = createParticleWorld(240, 90, { supportCapacity: 128 });
    standard.restore(intact);
    standard.step();
    for (let x = 110; x <= 112; x += 1) standard.excavate(x, 75, x, 75);
    standard.step();
    assert(standard.structuralLoad.maximum > 128 && standard.structuralLoad.failed > 0 &&
      standard.debrisCount > 0 && standard.barrierCount + standard.debrisCount === material,
      'standard capacity did not fail under redistributed weight or lost material');
  });
  check('shared basin breach opens only outlet terrain and preserves budgets and repeated-action accounting', () => {
    const workload = createSharedPixelConstructionWorkload({ natural: true });
    const world = workload.entries[0].scenario.world, before = world.snapshot();
    assert(workload.breachBasin() === 10, 'basin breach removed incorrect outlet size');
    const after = world.snapshot();
    for (let index = 0; index < before.cells.length; index += 1) {
      if (before.cells[index] !== after.cells[index]) {
        assert(index % world.width === 30 && Math.floor(index / world.width) >= 65 &&
          Math.floor(index / world.width) < 75 && before.cells[index] === PARTICLE_TERRAIN &&
          after.cells[index] === PARTICLE_EMPTY, 'breach removed non-outlet material');
      }
    }
    assert(workload.breachBasin() === 0 && JSON.stringify(after) === JSON.stringify(world.snapshot()) &&
      workload.entries.every(({ scenario, destroyed }) => scenario.spent === 0 && scenario.hm === 1000 &&
        destroyed === 0) && world.waterCount === 220, 'repeat breach changed material or economy');
    for (let tick = 0; tick < 120; tick += 1) workload.step();
    assert(world.snapshot().cells.some((material, index) => material === PARTICLE_WATER &&
      index % world.width > 30), 'water never moved through the breached outlet');
    workload.verify();
  });
  check('water falls into excavated foundation ground and blocks restoration without being removed', () => {
    const workload = createSharedPixelConstructionWorkload({ natural: true });
    const scenario = workload.entries[0].scenario, world = scenario.world;
    workload.blastBuilding(0);
    const snapshot = world.snapshot();
    // Relocate one existing basin particle above the blasted cavity; physics must move it into ground.
    snapshot.cells[65 * world.width + 8] = PARTICLE_EMPTY;
    snapshot.cells[74 * world.width + 40] = PARTICLE_WATER;
    world.restore(snapshot);
    workload.verify();
    assert(world.at(40, 75) === PARTICLE_EMPTY, 'flood fixture did not have excavated ground');
    workload.step();
    const flooded = [];
    for (let y = 75; y <= 77; y += 1) {
      for (let x = 37; x <= 43; x += 1) {
        if ((x - 40) ** 2 + (y - 74) ** 2 <= 9 && world.at(x, y) === PARTICLE_WATER) {
          flooded.push({ x, y });
        }
      }
    }
    assert(flooded.length > 0 && world.waterCount === 220, 'particle physics did not flood the foundation cavity');
    const hm = scenario.hm, spent = scenario.spent;
    const result = workload.restoreFoundation(0);
    assert(result.blockedCells.some((cell) => cell.material === PARTICLE_WATER) &&
      flooded.every((cell) => world.at(cell.x, cell.y) === PARTICLE_WATER),
      'restoration overwrote flowing water or omitted blockage');
    workload.excavateFoundationGround(0); workload.clearDebris();
    assert(flooded.every((cell) => world.at(cell.x, cell.y) === PARTICLE_WATER) &&
      world.waterCount === 220 && scenario.hm === hm && scenario.spent === spent,
      'ground/debris tools removed water or refunded HM');
    workload.verify();
  });
  check('live foundation occupancy distinguishes empty ground and every blocking material without mutation', () => {
    const scenario = createPixelConstructionScenario(5), world = scenario.world;
    const snapshot = world.snapshot();
    const materials = [PARTICLE_EMPTY, PARTICLE_WATER, PARTICLE_DEBRIS,
      PARTICLE_CONSTRUCTION, PARTICLE_BARRIER];
    const positions = [60, 61, 62, 80, 81];
    materials.forEach((material, index) => { snapshot.cells[75 * world.width + positions[index]] = material; });
    world.restore(snapshot);
    const before = JSON.stringify(world.snapshot()), report = scenario.inspectTerrain();
    assert(report.foundationGround.length === 9 && report.foundationTerrain === 4 &&
      materials.every((material, index) => report.foundationGround.some((cell) =>
        cell.x === positions[index] && cell.y === 75 && cell.material === material)) &&
      report.foundationDescription.includes('1 empty') && report.foundationDescription.includes('1 water') &&
      report.foundationDescription.includes('4 terrain'), 'live occupancy omitted a material or counted incorrect terrain');
    report.foundationGround[0].material = PARTICLE_TERRAIN;
    assert(scenario.inspectTerrain().foundationGround[0].material === PARTICLE_EMPTY &&
      before === JSON.stringify(world.snapshot()) && scenario.spent === 0 && scenario.hm === 1000,
      'live report changed world, returned shared cells or altered economy');
  });
  check('water moving away from foundation ground permits restoration without draining or refunding material', () => {
    const workload = createSharedPixelConstructionWorkload({ natural: true });
    const scenario = workload.entries[0].scenario, world = scenario.world;
    workload.blastBuilding(0);
    const snapshot = world.snapshot();
    // Relocate one conserved water particle; all subsequent water movement uses physics.
    snapshot.cells[65 * world.width + 8] = PARTICLE_EMPTY;
    snapshot.cells[74 * world.width + 40] = PARTICLE_WATER;
    world.restore(snapshot); workload.verify(); workload.step();
    assert(world.at(40, 75) === PARTICLE_WATER &&
      scenario.inspectTerrain().foundationGround.some((cell) => cell.x === 40 &&
        cell.material === PARTICLE_WATER), 'water did not enter original ground position');
    const blocked = workload.restoreFoundation(0);
    assert(blocked.blockedCells.some((cell) => cell.x === 40 && cell.y === 75 &&
      cell.material === PARTICLE_WATER), 'restoration did not report flooded ground');
    // Explicit test excavation opens space below the water, not a new automatic drainage tool.
    world.excavate(40, 76, 40, 78);
    workload.step();
    assert(world.at(40, 75) === PARTICLE_EMPTY && world.at(40, 76) === PARTICLE_WATER &&
      scenario.inspectTerrain().foundationGround.some((cell) => cell.x === 40 &&
        cell.material === PARTICLE_EMPTY), 'live report did not update after water fell away');
    const hm = scenario.hm, spent = scenario.spent;
    const restored = workload.restoreFoundation(0);
    assert(restored.restored > 0 && world.at(40, 75) === PARTICLE_TERRAIN &&
      world.at(40, 76) === PARTICLE_WATER && world.waterCount === 220 &&
      scenario.inspectTerrain().foundationTerrain === 9 && scenario.hm === hm && scenario.spent === spent,
      'restoring newly empty ground drained water, failed restoration or altered HM');
    workload.verify();
  });
  check('paid repair completes with partially restored ground while trapped water remains conserved', () => {
    const scenario = createPixelConstructionScenario(5), { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const initialMass = world.barrierCount + world.constructionCount + world.debrisCount;
    scenario.blastFoundation();
    const destroyed = initialMass - world.barrierCount - world.constructionCount - world.debrisCount;
    for (let tick = 0; tick < 12; tick += 1) scenario.step();
    const cleared = scenario.clearDebris();
    const snapshot = world.snapshot();
    // A conserved basin particle occupies one ground cell before partial restoration encloses it.
    snapshot.cells[65 * world.width + 8] = PARTICLE_EMPTY;
    snapshot.cells[75 * world.width + 60] = PARTICLE_WATER;
    world.restore(snapshot);
    const hm = scenario.hm, spent = scenario.spent;
    const result = scenario.restoreFoundation();
    assert(result.restored === 10 && result.blocked === 1 &&
      result.blockedCells[0].x === 60 && result.blockedCells[0].y === 75 &&
      result.blockedCells[0].material === PARTICLE_WATER &&
      scenario.inspectTerrain().foundationTerrain === 8 && scenario.hm === hm && scenario.spent === spent,
      'partial restoration removed water, required all nine contacts or changed HM');
    const before = JSON.stringify(world.snapshot()), assignments = JSON.stringify(scenario.deliveries);
    const audit = scenario.inspectRecovery();
    assert(audit.agents.some((agent) => agent.route) ||
      audit.sources.some((source) => source.state === 'ready for next delivery check'),
      'partial terrain did not reopen any paid repair route');
    assert(before === JSON.stringify(world.snapshot()) && assignments === JSON.stringify(scenario.deliveries),
      'partial-ground route inspection mutated repair material');
    for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
    world.step();
    assert(scenario.finished && world.at(60, 75) === PARTICLE_WATER &&
      world.waterCount === 220 && scenario.inspectTerrain().foundationTerrain === 8 &&
      world.structuralLoad.failed === 0 && world.structuralLoad.maximum <= 128 &&
      world.constructionCount === 0 && world.debrisCount === 0 &&
      world.barrierCount + cleared + destroyed === 9 + scenario.spent &&
      scenario.hm === 1000 - scenario.spent,
      'partial-ground repair failed, lost trapped water or broke weight/material accounting');
    const final = JSON.stringify(world.snapshot());
    const repeat = scenario.restoreFoundation();
    assert(repeat.restored === 0 && repeat.blocked === 1 &&
      final === JSON.stringify(world.snapshot()), 'repeat restoration overwrote water after repair completed');
  });
  check('one flooded ground contact changes load and respects the exact partial-foundation capacity', () => {
    for (const capacity of [87, 88]) {
      const world = createPixelConstructionWorld(160, capacity);
      const scenario = createPixelConstructionScenario(11, { world });
      const snapshot = world.snapshot();
      // Preplaced frame mass is a strength fixture, not free material from restoration.
      for (const cell of scenario.plan) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
      const fixtureMass = scenario.plan.length - 9;
      world.restore(snapshot); world.step();
      assert(world.structuralLoad.maximum === 86.5 && world.structuralLoad.failed === 0,
        'intact strength fixture did not hold at its expected load');
      const flooded = world.snapshot();
      flooded.cells[65 * world.width + 8] = PARTICLE_EMPTY;
      flooded.cells[75 * world.width + 60] = PARTICLE_WATER;
      world.restore(flooded);
      const result = scenario.restoreFoundation();
      assert(result.restored === 0 && result.blocked === 1 &&
        result.blockedCells[0].material === PARTICLE_WATER,
        'ground restoration overwrote the flooded strength fixture');
      world.step();
      const failures = capacity === 87 ? 1 : 0;
      assert(world.structuralLoad.maximum === 88 && world.structuralLoad.failed === failures &&
        world.debrisCount === failures && world.barrierCount === scenario.plan.length - failures &&
        scenario.inspectTerrain().foundationTerrain === 8 &&
        world.at(60, 75) === (failures ? PARTICLE_DEBRIS : PARTICLE_WATER) &&
        (!failures || world.at(61, 74) === PARTICLE_WATER) && world.waterCount === 220 &&
        world.barrierCount + world.debrisCount + world.constructionCount === 9 + fixtureMass &&
        scenario.hm === 1000 && scenario.spent === 0,
        'partial-ground capacity boundary, conserved fixture mass or economy changed');
      const after = JSON.stringify(world.snapshot());
      const repeat = scenario.restoreFoundation();
      assert(repeat.restored === 0 && repeat.blocked === 1 &&
        repeat.blockedCells[0].material === (failures ? PARTICLE_DEBRIS : PARTICLE_WATER) &&
        after === JSON.stringify(world.snapshot()),
        'restoration removed the current water/debris blocker after weight recomputation');
    }
  });
  check('generated terrain crop preserves source geometry and supports paid construction on uneven foundations', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(448), waterLevels: Array(240).fill(null),
      tunnels: [{ interiorWidth: 4, points: [{ x: 520, y: 450 }, { x: 600, y: 450 }] }] };
    [100, 104, 108].forEach((row, index) => {
      for (let dx = 0; dx < 3; dx += 1) source.heights[60 + index * 20 + dx] = row * 4;
    });
    for (let x = 8; x < 30; x += 1) source.waterLevels[x] = 408;
    const before = JSON.stringify(source);
    const imported = createPixelMapConstructionScenario(source), { scenario } = imported, { world } = scenario;
    assert(imported.originX === 0 && imported.originY === 25 &&
      scenario.inspectTerrain().foundationGround.every((cell, index) =>
        cell.y === [75, 79, 83][Math.floor(index / 3)] && cell.material === PARTICLE_TERRAIN),
      'crop relocated or flattened the uneven seed contacts');
    const expected = createParticleWorldFromSurfaceWaterAndTunnels(
      { heightAt: (x) => source.heights[Math.floor(x / 4)] },
      (x) => source.waterLevels[Math.floor(x / 4)], source.tunnels,
      { width: 160, height: 90, cellSize: 4, originX: 0, originY: 100, supportCapacity: 128, skipEmptyChunks: true });
    const seeds = new Set(scenario.plan.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER)
      .map((cell) => cell.y * world.width + cell.x));
    assert(world.snapshot().cells.every((material, index) =>
      seeds.has(index) ? material === PARTICLE_BARRIER && expected.snapshot().cells[index] === PARTICLE_EMPTY :
        material === expected.at(index % world.width, Math.floor(index / world.width))) &&
      world.terrainCount === expected.terrainCount && imported.initialWater === expected.waterCount &&
      JSON.stringify(source) === before, 'crop changed source terrain, tunnels, water or source arrays');
    for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
    world.step();
    assert(scenario.finished && world.barrierCount === scenario.plan.length &&
      world.constructionCount === 1 && scenario.deliveries.length === 1 &&
      world.debrisCount === 0 && world.structuralLoad.failed === 0 &&
      world.waterCount === imported.initialWater &&
      world.barrierCount + world.constructionCount === 9 + scenario.spent &&
      scenario.hm === 1000 - scenario.spent && JSON.stringify(source) === before,
      'uneven imported frame failed paid completion or conservation');
    const hm = scenario.hm, spent = scenario.spent, retained = JSON.stringify(scenario.deliveries);
    for (let tick = 0; tick < 60; tick += 1) scenario.step();
    assert(scenario.hm === hm && scenario.spent === spent && JSON.stringify(scenario.deliveries) === retained,
      'completed imported frame emitted more material, refunded or removed the retained paid pixel');
  });
  check('invalid or unsupported imported placement fails explicitly without changing source or world', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(0), tunnels: [] };
    const before = JSON.stringify(source);
    let rejected = false;
    try { createPixelMapConstructionScenario(source); } catch (error) {
      rejected = error.message.includes('No clear, supported frame site');
    }
    assert(rejected && JSON.stringify(source) === before, 'flooded source silently succeeded or mutated');
    for (const foundationRows of [null, [], [75, 75], [19, 75, 75], [75, 75, 88], [75, 75, 75.5]]) {
      const world = createPixelConstructionWorld(), snapshot = JSON.stringify(world.snapshot());
      rejected = false;
      try { createPixelConstructionScenario(5, { world, foundationRows }); } catch (error) {
        rejected = error.message === 'Invalid pixel foundation rows';
      }
      assert(rejected && JSON.stringify(world.snapshot()) === snapshot, 'invalid foundation rows mutated placement');
    }
    for (const deliveryRows of [null, [], [74, 74, 74, 74, 74, 90], [74, 74, 74, 74, 74, -1]]) {
      const world = createPixelConstructionWorld(), snapshot = JSON.stringify(world.snapshot());
      rejected = false;
      try { createPixelConstructionScenario(5, { world, deliveryRows }); } catch (error) {
        rejected = error.message === 'Invalid pixel delivery rows';
      }
      assert(rejected && JSON.stringify(world.snapshot()) === snapshot, 'invalid delivery rows mutated placement');
    }
  });
  check('original crop restoration preserves imported tunnels and occupied ground without charging HM', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null),
      tunnels: [{ interiorWidth: 4, points: [{ x: 520, y: 410 }, { x: 600, y: 410 }] }] };
    const { scenario } = createPixelMapConstructionScenario(source), { world } = scenario;
    const original = world.snapshot();
    scenario.blastFoundation();
    world.set(60, 75, PARTICLE_WATER);
    const water = world.waterCount, hm = scenario.hm;
    const restored = restorePixelMapTerrain(world, original);
    assert(restored.restored > 0 && restored.blocked === 1 &&
      world.at(60, 75) === PARTICLE_WATER && world.at(130, 77) === PARTICLE_EMPTY &&
      world.waterCount === water && scenario.hm === hm && scenario.spent === 0,
      'original restoration flattened tunnels, removed water or charged HM');
    const before = JSON.stringify(world.snapshot()), repeated = restorePixelMapTerrain(world, original);
    assert(repeated.restored === 0 && repeated.blocked === 1 && JSON.stringify(world.snapshot()) === before,
      'repeat original restoration changed occupied ground');
    let rejected = false;
    try { restorePixelMapTerrain(world, { ...original, width: 159 }); } catch (error) {
      rejected = error.message.includes('does not match');
    }
    assert(rejected && JSON.stringify(world.snapshot()) === before, 'mismatched original crop changed world');
  });
  check('map search skips a flooded lower support and finds another site without flattening the source', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(448), waterLevels: Array(240).fill(null), tunnels: [] };
    [100, 104, 108].forEach((row, index) => {
      for (let dx = 0; dx < 3; dx += 1) source.heights[60 + index * 20 + dx] = row * 4;
    });
    for (let x = 100; x < 103; x += 1) source.waterLevels[x] = 424;
    const before = JSON.stringify(source), imported = createPixelMapConstructionScenario(source);
    assert(imported.originX === 46 && imported.initialWater === 6 &&
      imported.scenario.inspectTerrain().foundationTerrain === 9 &&
      imported.scenario.world.barrierCount === 9 && imported.scenario.spent === 0 &&
      JSON.stringify(source) === before,
      'lower-support flooding aborted map search, erased water or mutated source geometry');
  });
  check('maximum imported support-height difference completes with all paid surplus material retained', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(448), waterLevels: Array(240).fill(null), tunnels: [] };
    [100, 106, 112].forEach((row, index) => {
      for (let dx = 0; dx < 3; dx += 1) source.heights[60 + index * 20 + dx] = row * 4;
    });
    const { scenario } = createPixelMapConstructionScenario(source), { world } = scenario;
    assert(scenario.inspectTerrain().foundationGround.every((cell, index) =>
      cell.y === [75, 81, 87][Math.floor(index / 3)]), 'maximum-rise crop did not keep seed heights');
    const sourceAudit = scenario.inspectRecovery();
    assert(sourceAudit.sources.every((source) => source.y === 86),
      'delivery sources did not follow nearby ground below raised supports');
    for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
    world.step();
    assert(scenario.finished && scenario.ticks === 20388 && scenario.spent === 330 &&
      world.barrierCount === scenario.plan.length && world.constructionCount === 3 &&
      scenario.deliveries.length === 3 && world.barrierCount + world.constructionCount === 9 + scenario.spent &&
      world.debrisCount === 0 && world.structuralLoad.failed === 0 && world.structuralLoad.maximum === 60.5 &&
      scenario.hm === 670, 'maximum-rise delivery, completion, load or paid surplus changed');
    const retained = JSON.stringify(scenario.deliveries);
    for (let tick = 0; tick < 60; tick += 1) scenario.step();
    assert(scenario.spent === 330 && scenario.hm === 670 &&
      JSON.stringify(scenario.deliveries) === retained, 'completed steep frame deleted or refunded paid surplus');
    // The first placement now exceeds the rise limit; the same map may have a later suitable site.
    for (let dx = 0; dx < 3; dx += 1) source.heights[100 + dx] = 452;
    const later = createPixelMapConstructionScenario(source);
    assert(later.originX === 20 &&
      Math.max(...later.scenario.inspectTerrain().foundationGround.map((cell) => cell.y)) -
      Math.min(...later.scenario.inspectTerrain().foundationGround.map((cell) => cell.y)) <= 12,
      'thirteen-cell rise was accepted instead of searching a later compatible site');
  });
  check('active imported repair preserves flooded ground through partial original-terrain restoration', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    for (let x = 8; x < 30; x += 1) { source.heights[x] = 448; source.waterLevels[x] = 400; }
    const imported = createPixelMapConstructionScenario(source), { scenario } = imported, { world } = scenario;
    const original = world.snapshot();
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const before = world.barrierCount + world.constructionCount + world.debrisCount;
    scenario.blastFoundation();
    const destroyed = before - world.barrierCount - world.constructionCount - world.debrisCount;
    for (let tick = 0; tick < 12; tick += 1) scenario.step();
    const cleared = scenario.clearDebris(), snapshot = world.snapshot();
    // Relocate one conserved basin particle above blasted ground; physics moves it into the opening.
    snapshot.cells[snapshot.cells.indexOf(PARTICLE_WATER)] = PARTICLE_EMPTY;
    snapshot.cells[74 * world.width + 60] = PARTICLE_WATER;
    world.restore(snapshot); scenario.step();
    assert(world.at(60, 75) === PARTICLE_WATER, 'water did not fall into the imported foundation opening');
    const hm = scenario.hm, spent = scenario.spent, restored = restorePixelMapTerrain(world, original);
    assert(restored.restored === 10 && restored.blocked === 1 && world.waterCount === imported.initialWater &&
      scenario.hm === hm && scenario.spent === spent && scenario.inspectTerrain().foundationTerrain === 8,
      'partial original-terrain restoration erased water, altered economy or flattened ground');
    const auditBefore = JSON.stringify(world.snapshot()), deliveries = JSON.stringify(scenario.deliveries);
    assert(scenario.inspectRecovery().agents.some((agent) => agent.route),
      'partial original-terrain restoration reopened no retained paid route');
    assert(JSON.stringify(world.snapshot()) === auditBefore && JSON.stringify(scenario.deliveries) === deliveries,
      'imported recovery audit changed material or assignments');
    for (let tick = 0; tick < 60000 && !scenario.finished; tick += 1) scenario.step();
    world.step();
    assert(scenario.finished && scenario.spent > spent && world.at(60, 75) === PARTICLE_WATER &&
      world.waterCount === imported.initialWater && world.structuralLoad.failed === 0 &&
      world.barrierCount + world.constructionCount + world.debrisCount + destroyed + cleared === 9 + scenario.spent &&
      scenario.hm === 1000 - scenario.spent,
      'imported flooded-ground repair did not finish with conserved water and exact paid accounting');
    const repeat = restorePixelMapTerrain(world, original);
    assert(repeat.restored === 0 && repeat.blocked === 1 && world.at(60, 75) === PARTICLE_WATER,
      'repeat restoration replaced water after the repaired frame completed');
  });
  check('inside deliveries overlap and cross settled structure with cardinal motion and exact paid settlement', () => {
    const scenario = createPixelConstructionScenario(5, { deliveryMode: 'inside', buriedCore: true }), { world } = scenario;
    let overlap = false, inside = false;
    for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) {
      scenario.step();
      const agents = scenario.deliveries, reserved = agents.filter((agent) => agent.target)
        .map((agent) => agent.target.y * world.width + agent.target.x);
      overlap = overlap || new Set(agents.map((agent) => agent.y * world.width + agent.x)).size < agents.length;
      inside = inside || agents.some((agent) => world.at(agent.x, agent.y) === PARTICLE_BARRIER);
      for (const agent of agents) {
        let previous = agent;
        for (const cell of agent.path) {
          assert(Math.abs(previous.x - cell.x) + Math.abs(previous.y - cell.y) === 1,
            'inside route jumped or moved diagonally');
          previous = cell;
        }
      }
      assert(new Set(reserved).size === reserved.length && world.constructionCount === 0 &&
        world.barrierCount + world.debrisCount + scenario.transportedMaterialCount === scenario.freeMaterial + scenario.spent &&
        scenario.hm === 1000 - scenario.spent && world.waterCount === 220,
        'overlapping deliveries shared targets, occupied world cells or broke accounting');
    }
    assert(overlap && inside && scenario.finished && world.barrierCount === scenario.plan.length &&
      scenario.transportedMaterialCount === 0 && world.structuralLoad.failed === 0,
      'inside mode did not demonstrate overlap, building traversal and supported completion');
    const before = JSON.stringify(world.snapshot()), deliveries = JSON.stringify(scenario.deliveries);
    scenario.inspectRecovery(); scenario.inspectDeliveries();
    assert(JSON.stringify(world.snapshot()) === before && JSON.stringify(scenario.deliveries) === deliveries,
      'inside audit mutated world or deliveries');
  });
  check('inside deliveries cannot overwrite water or debris in a repair target and resume after explicit clearance', () => {
    for (const material of [PARTICLE_WATER, PARTICLE_DEBRIS]) {
      const scenario = createPixelConstructionScenario(5, { deliveryMode: 'inside' }), { world } = scenario;
      for (let tick = 0; tick < 300; tick += 1) scenario.step();
      const agent = scenario.deliveries.find((delivery) => delivery.target);
      assert(agent, 'inside fixture emitted no paid delivery');
      const target = agent.target, snapshot = world.snapshot();
      if (material === PARTICLE_WATER) snapshot.cells[65 * world.width + 8] = PARTICLE_EMPTY;
      snapshot.cells[target.y * world.width + target.x] = material;
      world.restore(snapshot);
      assert(scenario.inspectDeliveries().some((delivery) => delivery.blocker &&
        delivery.blocker.location === 'target' && delivery.blocker.material === material),
        'inside audit hid occupied repair target');
      for (let tick = 0; tick < 60; tick += 1) scenario.step({ advanceWorld: false });
      assert(world.at(target.x, target.y) === material &&
        !scenario.deliveries.some((delivery) => delivery.target &&
          delivery.target.x === target.x && delivery.target.y === target.y),
        'inside delivery entered blocked target or retained invalid reservation');
      const cleared = world.snapshot();
      cleared.cells[target.y * world.width + target.x] = PARTICLE_EMPTY;
      if (material === PARTICLE_WATER) cleared.cells[65 * world.width + 8] = PARTICLE_WATER;
      world.restore(cleared);
      for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) scenario.step();
      assert(scenario.finished && world.waterCount === 220 && world.debrisCount === 0 &&
        world.barrierCount + scenario.transportedMaterialCount === 9 + scenario.spent &&
        scenario.hm === 1000 - scenario.spent,
        'inside blocked-target recovery lost material or water');
    }
  });
  check('inside current-position obstruction strands paid material rather than moving through it', () => {
    const scenario = createPixelConstructionScenario(5, { deliveryMode: 'inside' }), { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const agent = scenario.deliveries[0], snapshot = world.snapshot();
    snapshot.cells[65 * world.width + 8] = PARTICLE_EMPTY;
    snapshot.cells[agent.y * world.width + agent.x] = PARTICLE_WATER;
    world.restore(snapshot);
    const report = scenario.inspectDeliveries().find((delivery) => delivery.x === agent.x && delivery.y === agent.y);
    assert(report.blocker.location === 'current position' && report.blocker.material === PARTICLE_WATER,
      'inside audit omitted water beneath travelling material');
    scenario.step({ advanceWorld: false }); scenario.step({ advanceWorld: false }); scenario.step({ advanceWorld: false });
    assert(scenario.deliveries.some((delivery) => delivery.x === agent.x && delivery.y === agent.y) &&
      world.at(agent.x, agent.y) === PARTICLE_WATER && world.waterCount === 220,
      'inside transport escaped or erased its water obstruction');
  });
  check('inside blast destroys travelling layer in radius and imported mode preserves world accounting', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source, { deliveryMode: 'inside' });
    const { scenario } = imported, { world } = scenario;
    assert(scenario.deliveryMode === 'inside', 'importer ignored selected delivery mode');
    for (let tick = 0; tick < 306; tick += 1) scenario.step();
    const before = world.barrierCount + world.constructionCount + world.debrisCount + scenario.transportedMaterialCount;
    const inRadius = scenario.deliveries.filter((agent) =>
      (agent.x - 60) ** 2 + (agent.y - 74) ** 2 <= 9).length;
    assert(inRadius > 0, 'blast fixture has no travelling material in its radius');
    scenario.blastFoundation();
    const destroyed = before - world.barrierCount - world.constructionCount - world.debrisCount - scenario.transportedMaterialCount;
    assert(!scenario.deliveries.some((agent) => (agent.x - 60) ** 2 + (agent.y - 74) ** 2 <= 9) &&
      destroyed >= inRadius && scenario.hm === 1000 - scenario.spent,
      'blast left travelling material in radius or refunded it');
    for (let tick = 0; tick < 12; tick += 1) scenario.step();
    const cleared = scenario.clearDebris();
    scenario.restoreFoundation();
    for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) scenario.step();
    assert(scenario.finished && world.barrierCount + world.debrisCount + scenario.transportedMaterialCount +
      destroyed + cleared === 9 + scenario.spent && world.waterCount === imported.initialWater,
      'inside blast recovery lost paid layer material');
  });
  check('inside renderer distinguishes overlap without changing solid occupancy', () => {
    const scenario = createPixelConstructionScenario(5, { deliveryMode: 'inside', buriedCore: true }), { world } = scenario;
    let overlap;
    for (let tick = 0; tick < 5000 && !overlap; tick += 1) {
      scenario.step();
      const agents = scenario.deliveries;
      overlap = agents.find((agent, index) => agents.some((other, otherIndex) =>
        index !== otherIndex && agent.x === other.x && agent.y === other.y));
    }
    assert(overlap, 'renderer fixture did not produce overlapping deliveries');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const renderer = createPixelConstructionRenderer(canvas), before = JSON.stringify(world.snapshot());
    renderer.draw(scenario); renderer.markTransported(scenario);
    const pixel = canvas.getContext('2d').getImageData(overlap.x * 4 + 1, overlap.y * 4 + 1, 1, 1).data;
    assert(pixel[0] === 255 && pixel[1] === 255 && pixel[2] === 255 &&
      JSON.stringify(world.snapshot()) === before && world.constructionCount === 0,
      'renderer hid overlap or modified physical material');
    const snapshot = world.snapshot();
    snapshot.cells[65 * world.width + 8] = PARTICLE_EMPTY;
    snapshot.cells[overlap.y * world.width + overlap.x] = PARTICLE_WATER;
    world.restore(snapshot);
    renderer.draw(scenario); renderer.markTransported(scenario);
    const blocked = canvas.getContext('2d').getImageData(overlap.x * 4 + 1, overlap.y * 4 + 1, 1, 1).data;
    assert(blocked[0] === 31 && blocked[1] === 172 && blocked[2] === 200 && world.waterCount === 220,
      'overlap overlay concealed water below waiting deliveries');
  });
  check('invalid inside-delivery mode rejects placement before creating free seeds or charges', () => {
    const world = createPixelConstructionWorld(), before = JSON.stringify(world.snapshot());
    let rejected = false;
    try { createPixelConstructionScenario(5, { world, deliveryMode: 'overlap' }); } catch (error) {
      rejected = error.message === 'Invalid pixel construction placement';
    }
    assert(rejected && JSON.stringify(world.snapshot()) === before, 'invalid mode mutated construction world');
    rejected = false;
    try { createPixelMapConstructionScenario({}, { deliveryMode: 'overlap' }); } catch (error) {
      rejected = error.message === 'Invalid imported construction delivery mode';
    }
    assert(rejected, 'imported mode silently fell back to a different delivery behavior');
  });
  check('buried bases extend exactly three cells and basement excavation changes only intended terrain', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [
        { interiorWidth: 4, points: [{ x: 260, y: 404 }, { x: 280, y: 404 }] },
      ] };
    const before = JSON.stringify(source);
    const imported = createPixelMapConstructionScenario(source, { deliveryMode: 'inside', buriedCore: true });
    const { scenario } = imported, { world } = scenario, core = scenario.inspectCore();
    assert(core.enabled && !core.destroyed && core.surviving === 27 && core.total === 27 &&
      core.cells.every((cell) => cell.y >= 72 && cell.y <= 74 && cell.material === PARTICLE_BARRIER) &&
      scenario.freeMaterial === 36 && world.barrierCount === 36 && scenario.hm === 1000 && scenario.spent === 0 &&
      imported.basementCells.length === 102 && imported.originY === 28,
      'buried-core dimensions, crop, free material or placement economy incorrect');
    const expected = createParticleWorldFromSurfaceWaterAndTunnels(
      { heightAt: (x) => source.heights[Math.floor(x / 4)] }, () => null, source.tunnels,
      { width: 160, height: 90, cellSize: 4, originX: 0, originY: 112, supportCapacity: 128 });
    const basement = new Set(imported.basementCells.map((cell) => cell.y * world.width + cell.x));
    const free = new Set(scenario.plan.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER)
      .map((cell) => cell.y * world.width + cell.x));
    assert(world.snapshot().cells.every((material, index) => {
      if (free.has(index)) return material === PARTICLE_BARRIER;
      const previous = expected.at(index % world.width, Math.floor(index / world.width));
      return material === (basement.has(index) && previous === PARTICLE_TERRAIN ? PARTICLE_EMPTY : previous);
    }) && JSON.stringify(source) === before, 'basement altered source data or terrain outside its three-cell footprint');
    const original = world.snapshot();
    const restored = restorePixelMapTerrain(world, original);
    assert(restored.restored === 0 && restored.blocked === 0 &&
      imported.basementCells.every((cell) => world.at(cell.x, cell.y) === PARTICLE_EMPTY),
      'original terrain restoration filled the intended basement or buried bases');
  });
  check('buried-core frame completes with weighted foundations and exact free-plus-paid accounting', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source, { deliveryMode: 'inside', buriedCore: true });
    const { world } = scenario;
    for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) {
      scenario.step();
      assert(world.barrierCount + world.constructionCount + world.debrisCount +
        scenario.transportedMaterialCount === scenario.freeMaterial + scenario.spent &&
        scenario.hm === 1000 - scenario.spent, 'buried-core construction lost free or paid material');
    }
    world.step();
    assert(scenario.finished && !scenario.coreDestroyed && scenario.inspectCore().surviving === 27 &&
      world.barrierCount === scenario.plan.length && world.structuralLoad.failed === 0 &&
      world.structuralLoad.maximum > 0 && world.structuralLoad.maximum <= 128,
      'buried-core frame could not complete or did not carry foundation weight');
  });
  check('one surviving buried pixel permits repair but complete core loss permanently freezes paid deliveries', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    for (const deliveryMode of ['inside', 'outside']) {
      const { scenario } = createPixelMapConstructionScenario(source, { deliveryMode, buriedCore: true });
      const { world } = scenario, original = world.snapshot();
      for (let tick = 0; tick < 306; tick += 1) scenario.step();
      let destroyed = 0;
      const core = scenario.inspectCore(), last = core.cells[core.cells.length - 1];
      for (const cell of core.cells.slice(0, -1)) destroyed += world.excavate(cell.x, cell.y, cell.x, cell.y);
      scenario.step({ advanceWorld: false });
      assert(!scenario.coreDestroyed && scenario.inspectCore().surviving === 1 &&
        scenario.inspectRecovery().phase === 'constructing', 'partial core damage disabled repair too early');
      destroyed += world.excavate(last.x, last.y, last.x, last.y);
      const spent = scenario.spent, hm = scenario.hm;
      scenario.step({ advanceWorld: false });
      const frozen = JSON.stringify(scenario.deliveries);
      assert(scenario.coreDestroyed && scenario.inspectCore().surviving === 0 &&
        scenario.inspectRecovery().phase === 'core destroyed' &&
        scenario.inspectRecovery().sources.every((source) => !source.route && source.state === 'core destroyed') &&
        scenario.inspectRecovery().agents.every((agent) => !agent.route && agent.state === 'core destroyed') &&
        scenario.inspectDeliveries().every((agent) => agent.state === 'stopped: core destroyed') &&
        scenario.inspectSites().length === 0 && scenario.blueprintCells().length === 0,
        'core loss failed to disable repair targets, route audits or blueprint');
      for (let tick = 0; tick < 120; tick += 1) scenario.step({ advanceWorld: false });
      restorePixelMapTerrain(world, original);
      assert(scenario.spent === spent && scenario.hm === hm && JSON.stringify(scenario.deliveries) === frozen &&
        world.barrierCount + world.constructionCount + world.debrisCount +
        scenario.transportedMaterialCount + destroyed === scenario.freeMaterial + scenario.spent,
        'core-dead building moved/settled deliveries, spent/refunded HM or lost material');
      // Explicit fixture replacement tests the irreversible latch, not a gameplay revival tool.
      for (const cell of core.cells.slice().sort((a, b) => b.y - a.y)) {
        assert(world.emitConstruction(cell.x, cell.y).ok && world.settleConstruction(cell.x, cell.y).ok,
          'replacement fixture could not reconstruct supported core');
      }
      for (let tick = 0; tick < 60; tick += 1) scenario.step({ advanceWorld: false });
      assert(scenario.coreDestroyed && scenario.spent === spent && scenario.hm === hm &&
        JSON.stringify(scenario.deliveries) === frozen, 'replacing cores or terrain revived permanently dead repair');
    }
  });
  check('buried-base blasts detect total loss immediately and preserve destroyed-material accounting', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source, { deliveryMode: 'inside', buriedCore: true });
    const { world } = scenario;
    let destroyed = 0;
    for (let index = 0; index < 3; index += 1) {
      const before = world.barrierCount + world.debrisCount + world.constructionCount + scenario.transportedMaterialCount;
      scenario.blastCore(index);
      destroyed += before - world.barrierCount - world.debrisCount - world.constructionCount - scenario.transportedMaterialCount;
      assert(scenario.inspectCore().surviving === 27 - (index + 1) * 9 &&
        scenario.coreDestroyed === (index === 2), 'base blast disabled too early or delayed total core loss');
    }
    const hm = scenario.hm;
    for (let tick = 0; tick < 60; tick += 1) scenario.step();
    const cleared = scenario.clearDebris();
    assert(world.barrierCount + world.debrisCount + world.constructionCount + scenario.transportedMaterialCount +
      destroyed + cleared === scenario.freeMaterial + scenario.spent && scenario.hm === hm && scenario.coreDestroyed,
      'post-core-loss physics or debris clearing broke conservation or revived repair');
    const before = JSON.stringify(world.snapshot());
    let rejected = false;
    try { scenario.blastCore(3); } catch (error) { rejected = error.message === 'Invalid buried core selection'; }
    assert(rejected && JSON.stringify(world.snapshot()) === before, 'invalid core selection mutated world');
  });
  check('surviving buried cores permit paid rebuilding of a fully destroyed pillar base', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source, { deliveryMode: 'inside', buriedCore: true });
    const { world } = scenario, original = world.snapshot();
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const before = world.barrierCount + world.debrisCount + scenario.transportedMaterialCount;
    scenario.blastCore(0);
    const destroyed = before - world.barrierCount - world.debrisCount - scenario.transportedMaterialCount;
    assert(scenario.inspectCore().surviving === 18 && !scenario.coreDestroyed,
      'losing one complete buried base disabled a building with other surviving cores');
    for (let tick = 0; tick < 12; tick += 1) scenario.step();
    const cleared = scenario.clearDebris(), paid = scenario.spent;
    restorePixelMapTerrain(world, original);
    for (let tick = 0; tick < 30000 && !scenario.finished; tick += 1) scenario.step();
    assert(scenario.finished && !scenario.coreDestroyed && scenario.inspectCore().surviving === 27 &&
      scenario.spent > paid && world.barrierCount + world.debrisCount + world.constructionCount +
      scenario.transportedMaterialCount + destroyed + cleared === scenario.freeMaterial + scenario.spent &&
      scenario.hm === 1000 - scenario.spent, 'partial core loss did not permit exact paid base repair');
  });
  check('invalid buried-core placement refuses occupied underground cells before world mutation', () => {
    const world = createPixelConstructionWorld(), snapshot = world.snapshot();
    snapshot.cells[76 * world.width + 60] = PARTICLE_WATER;
    world.restore(snapshot);
    const before = JSON.stringify(world.snapshot());
    let rejected = false;
    try { createPixelConstructionScenario(5, { world, buriedCore: true }); } catch (error) {
      rejected = error.message.includes('requires clear sites');
    }
    assert(rejected && JSON.stringify(world.snapshot()) === before,
      'buried base overwrote water, excavated terrain or emitted seeds before rejecting placement');
    rejected = false;
    try { createPixelMapConstructionScenario({}, { buriedCore: 'yes' }); } catch (error) {
      rejected = error.message === 'Invalid imported buried-core option';
    }
    assert(rejected, 'invalid buried-core option silently changed placement behavior');
  });
  check('stepped floors are level below deeper cores, connect pillars and preserve surrounding terrain', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array.from({ length: 240 }, (_, x) => 4 * (x < 80 ? 100 : x < 100 ? 104 : 108)),
      waterLevels: Array(240).fill(null), tunnels: [] };
    const sourceBefore = JSON.stringify(source);
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario;
    assert(imported.originX === 0 &&
      JSON.stringify(imported.floorSections) === JSON.stringify([
        { left: 60, right: 82, y: 79 }, { left: 80, right: 102, y: 83 }]) &&
      scenario.foundationCells.length === 67 && scenario.freeMaterial === 103 &&
      world.barrierCount === 103 && scenario.inspectCore().total === 27 &&
      scenario.hm === 1000 && scenario.spent === 0,
      'level floors, unique extension material, free cost or core count incorrect');
    for (const floor of imported.floorSections) {
      for (let x = floor.left; x <= floor.right; x += 1) {
        assert(world.at(x, floor.y) === PARTICLE_BARRIER &&
          world.at(x, floor.y + 1) === (x >= 80 && x <= 82 && floor.y === 79
            ? PARTICLE_BARRIER : PARTICLE_TERRAIN),
          'floor lacks intact ground or connecting pillar below it');
      }
    }
    assert([60, 61, 62].every((x) => [75, 76, 77, 78].every((y) => world.at(x, y) === PARTICLE_BARRIER)) &&
      [80, 81, 82].every((x) => [79, 80, 81, 82].every((y) => world.at(x, y) === PARTICLE_BARRIER)),
      'shallower pillar did not extend to each connecting floor');
    const expected = createParticleWorldFromSurfaceAndWater(
      { heightAt: (x) => source.heights[Math.floor(x / 4)] }, () => null,
      { width: 160, height: 90, cellSize: 4, originX: 0, originY: imported.originY * 4 });
    const changed = new Set([...imported.basementCells, ...scenario.foundationCells, ...scenario.inspectCore().cells,
      ...scenario.plan.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER)]
      .map((cell) => cell.y * world.width + cell.x));
    assert(world.snapshot().cells.every((material, index) => changed.has(index) ||
      material === expected.at(index % world.width, Math.floor(index / world.width))) &&
      JSON.stringify(source) === sourceBefore, 'floors flattened terrain outside the building footprint');
    const baseline = world.snapshot();
    assert(restorePixelMapTerrain(world, baseline).restored === 0 &&
      imported.basementCells.every((cell) => world.at(cell.x, cell.y) === PARTICLE_EMPTY),
      'restoration filled the basement or overwrote level floor cells');
    for (let tick = 0; tick < 20000 && !scenario.finished && !scenario.coreDestroyed; tick += 1) scenario.step();
    world.step();
    assert(scenario.finished && !scenario.coreDestroyed && world.structuralLoad.failed === 0 &&
      world.structuralLoad.maximum <= 128 && world.barrierCount + world.debrisCount + world.constructionCount +
      scenario.transportedMaterialCount === scenario.freeMaterial + scenario.spent &&
      scenario.hm === 1000 - scenario.spent, 'stepped floor completion failed support or material accounting');
  });
  check('inside paid deliveries originate at surviving core cells and destroyed bases stop emitting', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const core = scenario.inspectCore(), keys = new Set(core.cells.map((cell) => cell.y * world.width + cell.x));
    assert(scenario.deliveries.length > 0 && scenario.deliveries.every((agent) =>
      keys.has(agent.y * world.width + agent.x) && world.at(agent.x, agent.y) === PARTICLE_BARRIER) &&
      scenario.spent === scenario.deliveries.length && world.constructionCount === 0,
      'paid emission did not originate on intact core material or charged the wrong amount');
    assert(scenario.deliveries.every((agent) => [61, 81, 101].includes(agent.x) && agent.y === 73) &&
      scenario.inspectRecovery().sources.every((source) => [61, 81, 101].includes(source.x) && source.y === 73) &&
      core.total === 27 && [60, 80, 100].every((pole) => core.cells.filter((cell) =>
        cell.x >= pole && cell.x <= pole + 2 && cell.y >= 72 && cell.y <= 74).length === 9),
      'delivery origins are not the innermost pixels of three exact 3-by-3 cores');
    world.excavate(61, 73, 61, 73);
    assert(scenario.inspectRecovery().sources.slice(0, 2).every((source) =>
      source.material === PARTICLE_BARRIER && !(source.x === 61 && source.y === 73)),
      'destroyed center did not fall back within its surviving core');
    const damaged = core.cells.filter((cell) => cell.x >= 60 && cell.x <= 62);
    for (const cell of damaged.slice(1)) world.excavate(cell.x, cell.y, cell.x, cell.y);
    const audit = scenario.inspectRecovery();
    assert(audit.sources.slice(0, 2).every((source) => source.x === damaged[0].x && source.y === damaged[0].y &&
      source.material === PARTICLE_BARRIER), 'source did not fall back to a surviving pixel in its own core');
    world.excavate(damaged[0].x, damaged[0].y, damaged[0].x, damaged[0].y);
    scenario.step({ advanceWorld: false });
    const lost = scenario.inspectRecovery();
    assert(!scenario.coreDestroyed && lost.sources.slice(0, 2).every((source) =>
      source.state === 'core source destroyed' && source.route === null) &&
      lost.sources.slice(2).every((source) => source.material === PARTICLE_BARRIER),
      'destroyed base continued emitting or prevented other live cores from supplying repairs');
  });
  check('floor repairs stay paid and a surviving connecting floor cannot revive total core loss', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { world } = scenario, baseline = world.snapshot();
    let destroyed = world.excavate(70, 75, 70, 75);
    for (let tick = 0; tick < 600 && world.at(70, 75) !== PARTICLE_BARRIER; tick += 1) scenario.step();
    assert(world.at(70, 75) === PARTICLE_BARRIER && scenario.spent >= 1 && !scenario.coreDestroyed &&
      world.barrierCount + scenario.transportedMaterialCount + world.debrisCount + destroyed ===
      scenario.freeMaterial + scenario.spent, 'floor damage did not receive exactly accounted paid replacement');
    for (const cell of scenario.inspectCore().cells) destroyed += world.excavate(cell.x, cell.y, cell.x, cell.y);
    scenario.step({ advanceWorld: false });
    const spent = scenario.spent, hm = scenario.hm, deliveries = JSON.stringify(scenario.deliveries);
    assert(scenario.coreDestroyed && scenario.foundationCells.some((cell) =>
      world.at(cell.x, cell.y) === PARTICLE_BARRIER), 'floor material was incorrectly counted as a live core');
    restorePixelMapTerrain(world, baseline);
    for (let tick = 0; tick < 120; tick += 1) scenario.step({ advanceWorld: false });
    assert(scenario.coreDestroyed && scenario.spent === spent && scenario.hm === hm &&
      JSON.stringify(scenario.deliveries) === deliveries &&
      world.barrierCount + world.debrisCount + world.constructionCount + scenario.transportedMaterialCount +
      destroyed === scenario.freeMaterial + scenario.spent,
      'floor or terrain restoration revived core-dead repairs or lost paid material');
  });
  check('connecting foundation rejects occupied or unsupported cells before excavation and free emission', () => {
    const world = createPixelConstructionWorld(), before = JSON.stringify(world.snapshot());
    let rejected = false;
    try { createPixelConstructionScenario(5, { world, buriedCore: true, foundationCells: [{ x: 70, y: 74 }] }); }
    catch (error) { rejected = error.message === 'Invalid connecting foundation cells'; }
    assert(rejected && JSON.stringify(world.snapshot()) === before, 'invalid floor partially excavated world');
    const flooded = world.snapshot(); flooded.cells[75 * world.width + 70] = PARTICLE_WATER;
    world.restore(flooded);
    const waterBefore = JSON.stringify(world.snapshot());
    rejected = false;
    try { createPixelConstructionScenario(5, { world, buriedCore: true, foundationCells: [{ x: 70, y: 75 }] }); }
    catch (error) { rejected = error.message.includes('requires clear sites'); }
    assert(rejected && JSON.stringify(world.snapshot()) === waterBefore, 'floor overwrote water during placement');
    const unsupported = createPixelConstructionWorld();
    unsupported.excavate(69, 75, 71, 77);
    const unsupportedBefore = JSON.stringify(unsupported.snapshot());
    rejected = false;
    try { createPixelConstructionScenario(5, { world: unsupported, buriedCore: true,
      foundationCells: [{ x: 70, y: 76 }] }); }
    catch (error) { rejected = error.message === 'Connecting foundation requires supported cells'; }
    assert(rejected && JSON.stringify(unsupported.snapshot()) === unsupportedBefore,
      'unsupported floor failed after mutating the world');
  });
  check('floor ground excavation is bounded, terrain-only and reversible without paid material changes', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario, original = world.snapshot();
    const before = JSON.stringify(original);
    for (const index of [-1, 2, 0.5]) {
      let rejected = false;
      try { excavatePixelFloorGround(imported, index); } catch (error) {
        rejected = error.message === 'Invalid floor excavation selection';
      }
      assert(rejected && JSON.stringify(world.snapshot()) === before, 'invalid selection changed terrain');
    }
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const paid = scenario.spent, mass = world.barrierCount + world.debrisCount +
      world.constructionCount + scenario.transportedMaterialCount;
    const peak = world.structuralLoad.maximum;
    const edgeLoads = () => world.inspectStructuralLoads().filter((cell) =>
      cell.y === 75 && [69, 73].includes(cell.x)).map((cell) => cell.load);
    assert(JSON.stringify(edgeLoads()) === '[1,1]', 'intact floor edge loads differ from the unit-weight fixture');
    const result = excavatePixelFloorGround(imported, 0);
    assert(result.removed === 3 && result.cells.every((cell) => cell.y === 76 &&
      cell.x >= 70 && cell.x <= 72 && world.at(cell.x, cell.y) === PARTICLE_EMPTY) &&
      world.at(69, 76) === PARTICLE_TERRAIN && world.at(73, 76) === PARTICLE_TERRAIN &&
      [70, 71, 72].every((x) => world.at(x, 75) === PARTICLE_BARRIER),
      'excavation missed its exact terrain footprint or removed the floor');
    scenario.step();
    assert(scenario.spent === paid && scenario.hm === 1000 - paid &&
      world.barrierCount + world.debrisCount + world.constructionCount +
      scenario.transportedMaterialCount === mass && scenario.inspectCore().surviving === 27 &&
      world.structuralLoad.failed === 0 && Number.isFinite(world.structuralLoad.maximum) &&
      peak > 0, 'local floor ground loss broke paid mass, cores or supported load calculation');
    assert(JSON.stringify(edgeLoads()) === '[2.5,2.5]' && world.structuralLoad.maximum === peak,
      'ground excavation failed to redistribute floor weight to neighboring terrain contacts');
    assert(excavatePixelFloorGround(imported, 0).removed === 0 &&
      restorePixelMapTerrain(world, original).restored === 3,
      'repeat excavation removed material or original ground failed to restore');
  });
  check('floor excavation preserves water, debris and barrier blockers exactly', () => {
    for (const blocker of [PARTICLE_WATER, PARTICLE_DEBRIS, PARTICLE_BARRIER]) {
      const source = { width: 240, height: 160, cellSize: 4,
        heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
      const imported = createPixelMapConstructionScenario(source,
        { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
      const world = imported.scenario.world, fixture = world.snapshot();
      fixture.cells[76 * world.width + 71] = blocker;
      world.restore(fixture);
      const result = excavatePixelFloorGround(imported, 0);
      assert(result.removed === 2 && world.at(71, 76) === blocker &&
        world.at(71, 75) === PARTICLE_BARRIER && imported.scenario.spent === 0,
        'floor excavation destroyed an occupied blocker or charged material');
    }
  });
  check('one surviving core pixel supplies overlapping paid emissions without reviving destroyed bases', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { world } = scenario, survivor = scenario.inspectCore().cells[0];
    let destroyed = 0;
    for (const cell of scenario.inspectCore().cells.slice(1)) {
      destroyed += world.excavate(cell.x, cell.y, cell.x, cell.y);
    }
    for (let tick = 0; tick < 300; tick += 1) scenario.step({ advanceWorld: false });
    assert(scenario.inspectCore().surviving === 1 && !scenario.coreDestroyed &&
      scenario.deliveries.length === 2 && scenario.deliveries.every((agent) =>
        agent.x === survivor.x && agent.y === survivor.y) && scenario.spent === 2 &&
      scenario.hm === 998 && world.constructionCount === 0 &&
      world.barrierCount + scenario.transportedMaterialCount + destroyed ===
      scenario.freeMaterial + scenario.spent,
      'single-pixel source failed to emit two separate paid overlapping deliveries');
  });
  check('flooded floor waits and receives paid repair only after water moves to explicit clearance', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { world } = scenario;
    const destroyed = world.excavate(70, 75, 70, 75);
    world.set(70, 75, PARTICLE_WATER);
    for (let tick = 0; tick < 600; tick += 1) scenario.step({ advanceWorld: false });
    assert(world.at(70, 75) === PARTICLE_WATER && world.waterCount === 1 &&
      !scenario.finished && !scenario.coreDestroyed, 'floor repair overwrote water or completed with a flooded gap');
    const paid = scenario.spent;
    world.excavate(70, 76, 70, 76);
    for (let tick = 0; tick < 2000 && world.at(70, 75) !== PARTICLE_BARRIER; tick += 1) scenario.step();
    assert(world.at(70, 75) === PARTICLE_BARRIER && world.waterCount === 1 &&
      scenario.spent >= paid && scenario.spent > 0 && scenario.hm === 1000 - scenario.spent &&
      world.barrierCount + world.debrisCount + world.constructionCount +
      scenario.transportedMaterialCount + destroyed === scenario.freeMaterial + scenario.spent,
      'water clearance failed to allow conserved paid floor repair');
  });
  check('wide flat-floor support loss completes with overlapping cardinal deliveries and exact paid mass', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    let removed = 0, overlap = 0;
    for (const floor of imported.floorSections) {
      removed += world.excavate(floor.left + 3, floor.y + 1, floor.right - 3, floor.y + 1);
    }
    for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) {
      scenario.step();
      const agents = scenario.deliveries;
      overlap = Math.max(overlap, agents.length - new Set(agents.map((agent) =>
        agent.y * world.width + agent.x)).size);
      const targets = agents.filter((agent) => agent.target).map((agent) =>
        agent.target.y * world.width + agent.target.x);
      assert(new Set(targets).size === targets.length, 'overlapping deliveries shared a reserved target');
      for (const agent of agents) {
        let previous = agent;
        for (const cell of agent.path) {
          assert(Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y) === 1,
            'floor traffic used a non-cardinal route');
          previous = cell;
        }
      }
    }
    assert(removed === 34 && scenario.finished && overlap > 0 &&
      scenario.inspectCore().surviving === 27 && world.structuralLoad.failed === 0 &&
      world.structuralLoad.maximum <= 128 && scenario.hm === 1000 - scenario.spent &&
      world.barrierCount + world.debrisCount + world.constructionCount +
      scenario.transportedMaterialCount === scenario.freeMaterial + scenario.spent,
      'wide flat-floor support loss failed completion, overlap or material conservation');
  });
  check('wide stepped-floor support loss overloads honestly and repairs after explicit debris/terrain clearance', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array.from({ length: 240 }, (_, x) => 4 * (x < 80 ? 100 : x < 100 ? 104 : 108)),
      waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario, original = world.snapshot();
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    for (const floor of imported.floorSections) {
      world.excavate(floor.left + 3, floor.y + 1, floor.right - 3, floor.y + 1);
    }
    let firstFailurePeak = 0;
    for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) {
      scenario.step();
      if (world.structuralLoad.failed && !firstFailurePeak) firstFailurePeak = world.structuralLoad.maximum;
    }
    assert(firstFailurePeak > 128 && world.structuralLoad.failed === 1 && !scenario.finished &&
      world.debrisCount === 1 && scenario.inspectSites().some((site) =>
        site.x === 80 && site.y === 81 && site.state === 'fallen debris') &&
      scenario.inspectCore().surviving === 27,
      'stepped overloaded floor silently held or failed to expose the debris repair blocker');
    const paid = scenario.spent, cleared = scenario.clearDebris();
    const restored = restorePixelMapTerrain(world, original);
    assert(cleared === 1 && restored.restored === 34 && restored.blocked === 0 &&
      scenario.spent === paid && scenario.hm === 1000 - paid,
      'explicit clearance removed wrong material or refunded HM');
    for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) scenario.step();
    assert(scenario.finished && scenario.spent > paid && !scenario.coreDestroyed &&
      scenario.inspectCore().surviving === 27 && world.waterCount === 0 &&
      world.barrierCount + world.debrisCount + world.constructionCount +
      scenario.transportedMaterialCount + cleared === scenario.freeMaterial + scenario.spent &&
      scenario.hm === 1000 - scenario.spent,
      'restored stepped frame failed paid completion or lost cleared-material accounting');
  });
  check('flooded core center strands its overlapping deliveries while same-core fallback remains live', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { world } = scenario;
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const destroyed = world.excavate(61, 73, 61, 73);
    world.set(61, 73, PARTICLE_WATER);
    const spent = scenario.spent;
    for (let tick = 0; tick < 30; tick += 1) scenario.step({ advanceWorld: false });
    const stranded = scenario.inspectDeliveries().filter((agent) => agent.x === 61 && agent.y === 73);
    assert(stranded.length === 2 && stranded.every((agent) =>
      agent.state === 'waiting: current position occupied by water') &&
      scenario.inspectRecovery().sources.slice(0, 2).every((source) =>
        source.material === PARTICLE_BARRIER && !(source.x === 61 && source.y === 73)) &&
      scenario.inspectCore().surviving === 26 && !scenario.coreDestroyed &&
      world.waterCount === 1 && scenario.spent === spent && scenario.hm === 1000 - spent &&
      world.barrierCount + world.debrisCount + world.constructionCount +
      scenario.transportedMaterialCount + destroyed === scenario.freeMaterial + spent,
      'flooded core teleported overlapping agents, killed fallback or lost water/paid mass');
  });
  check('connecting floors permit paid partial-base rebuilding without counting floors as cores', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { world } = scenario, original = world.snapshot();
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const mass = world.barrierCount + world.debrisCount + scenario.transportedMaterialCount;
    scenario.blastCore(0);
    const destroyed = mass - world.barrierCount - world.debrisCount - scenario.transportedMaterialCount;
    assert(scenario.inspectCore().surviving === 18 && !scenario.coreDestroyed,
      'floor-connected partial base loss disabled surviving core repair');
    for (let tick = 0; tick < 12; tick += 1) scenario.step();
    const cleared = scenario.clearDebris(), paid = scenario.spent;
    restorePixelMapTerrain(world, original);
    for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) scenario.step();
    assert(scenario.finished && scenario.inspectCore().surviving === 27 && scenario.spent > paid &&
      world.barrierCount + world.debrisCount + world.constructionCount +
      scenario.transportedMaterialCount + destroyed + cleared === scenario.freeMaterial + scenario.spent &&
      scenario.hm === 1000 - scenario.spent,
      'floor-connected base rebuilding failed paid completion or conserved accounting');
  });
  check('map diagnostics expose exact floor contacts, source slots and unavailable dirty loads without mutation', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario;
    const before = JSON.stringify(world.snapshot()), paid = scenario.spent, tick = scenario.ticks;
    let diagnostics = inspectPixelMapDiagnostics(imported);
    assert(diagnostics.sources.length === 6 && diagnostics.sources.every((cell) =>
      cell.ready && [61, 81, 101].includes(cell.x) && cell.y === 73) &&
      diagnostics.floors.every((floor) => floor.total === 23 && floor.settled === 23 &&
        floor.contacts === 23 && floor.peak === null) &&
      JSON.stringify(world.snapshot()) === before && scenario.spent === paid && scenario.ticks === tick,
      'diagnostics changed simulation or reported stale initial loads/source origins');
    for (let i = 0; i < 300; i += 1) scenario.step();
    excavatePixelFloorGround(imported, 0);
    diagnostics = inspectPixelMapDiagnostics(imported);
    assert(diagnostics.floors[0].contacts === 20 && diagnostics.floors[0].peak === null,
      'dirty floor report claimed valid loads or counted excavated terrain');
    scenario.step();
    diagnostics = inspectPixelMapDiagnostics(imported);
    assert(diagnostics.floors[0].peak.load === 5 && diagnostics.floors[0].peak.x === 80 &&
      diagnostics.floors[0].peak.capacity === 128 && diagnostics.floors[1].contacts === 23,
      'floor peak failed to include actual span/pillar-junction load');
  });
  check('inside settled-surface paths are route ready rather than falsely reported as lost outside outlines', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario;
    for (let i = 0; i < 300; i += 1) scenario.step();
    const agents = scenario.deliveries, reports = scenario.inspectDeliveries();
    const interior = agents.map((agent, index) => ({ agent, report: reports[index] })).filter(({ agent }) =>
      agent.path.length && world.at(agent.path[0].x, agent.path[0].y) === PARTICLE_BARRIER);
    assert(interior.length > 0 && interior.every(({ report }) => report.state === 'route ready'),
      'inside barrier-surface route incorrectly required an empty outside outline');
  });
  check('stranded counts and blocker outlines preserve water/debris interiors and simulation state', () => {
    for (const blocker of [PARTICLE_WATER, PARTICLE_DEBRIS]) {
      const source = { width: 240, height: 160, cellSize: 4,
        heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
      const imported = createPixelMapConstructionScenario(source,
        { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
      const { scenario } = imported, { world } = scenario;
      for (let i = 0; i < 300; i += 1) scenario.step();
      const fixture = world.snapshot();
      fixture.cells[73 * world.width + 61] = blocker;
      world.restore(fixture);
      const before = JSON.stringify(world.snapshot()), agents = JSON.stringify(scenario.deliveries), paid = scenario.spent;
      const diagnostics = inspectPixelMapDiagnostics(imported);
      assert(diagnostics.stranded === 2 && diagnostics.waiting >= 2 &&
        diagnostics.blockers.some((cell) => cell.x === 61 && cell.y === 73) &&
        diagnostics.sources.slice(0, 2).every((cell) => cell.ready && cell.x === 60 && cell.y === 72),
        'stranded overlap count, blocker location or same-core source fallback incorrect');
      const canvas = document.createElement('canvas');
      canvas.width = 960; canvas.height = 540;
      const renderer = createPixelConstructionRenderer(canvas), ctx = canvas.getContext('2d');
      renderer.draw(scenario); renderer.markCore(scenario); renderer.markTransported(scenario);
      const interior = Array.from(ctx.getImageData(61 * 6 + 2, 73 * 6 + 2, 1, 1).data);
      renderer.markWaiting(diagnostics.deliveries); renderer.markDiagnostics(diagnostics);
      assert(JSON.stringify(Array.from(ctx.getImageData(61 * 6 + 2, 73 * 6 + 2, 1, 1).data)) ===
        JSON.stringify(interior) && JSON.stringify(world.snapshot()) === before &&
        JSON.stringify(scenario.deliveries) === agents && scenario.spent === paid,
        'diagnostic outlines concealed blocker interiors or mutated paid simulation');
    }
  });
  check('repeated early floor damage cycles retain exact paid repair and diagnostics accounting', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario;
    let destroyed = 0;
    for (const x of [70, 90, 70]) {
      const spent = scenario.spent;
      destroyed += world.excavate(x, 75, x, 75);
      assert(inspectPixelMapDiagnostics(imported).floors[x < 80 ? 0 : 1].settled === 22,
        'damaged floor occupancy not reported');
      for (let tick = 0; tick < 2000 && world.at(x, 75) !== PARTICLE_BARRIER; tick += 1) scenario.step();
      assert(world.at(x, 75) === PARTICLE_BARRIER && scenario.spent > spent &&
        !scenario.finished && scenario.inspectCore().surviving === 27 &&
        world.barrierCount + world.debrisCount + world.constructionCount +
        scenario.transportedMaterialCount + destroyed === scenario.freeMaterial + scenario.spent &&
        scenario.hm === 1000 - scenario.spent,
        'repeated floor repair was free, stalled or lost material');
    }
  });
  check('initial terrain placement audit protects every non-basement cell and detects unintended holes', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null),
      tunnels: [{ interiorWidth: 4, points: [{ x: 500, y: 420 }, { x: 580, y: 420 }] }] };
    for (const buriedCore of [false, true]) {
      const imported = createPixelMapConstructionScenario(source,
        { deliveryMode: 'inside', buriedCore, connectingFloors: buriedCore });
      const { scenario } = imported, { world } = scenario;
      const original = createParticleWorldFromSurfaceWaterAndTunnels(
        { heightAt: (x) => source.heights[Math.floor(x / 4)] },
        (x) => source.waterLevels[Math.floor(x / 4)], source.tunnels,
        { width: 160, height: 90, cellSize: 4,
          originX: imported.originX * 4, originY: imported.originY * 4, supportCapacity: 128 }).snapshot();
      const before = JSON.stringify(world.snapshot());
      const audit = verifyPixelMapPlacementTerrain(scenario, original, imported.basementCells);
      assert(audit.checked === 14400 && audit.excavated === (buriedCore ? 102 : 0) &&
        JSON.stringify(audit) === JSON.stringify(imported.terrainIntegrity) &&
        JSON.stringify(world.snapshot()) === before,
        'placement audit changed terrain or miscounted intended basement excavation');
      const cell = { x: 120, y: 85 };
      assert(world.at(cell.x, cell.y) === PARTICLE_TERRAIN, 'hole fixture is not solid terrain');
      world.excavate(cell.x, cell.y, cell.x, cell.y);
      let rejected = false;
      try { verifyPixelMapPlacementTerrain(scenario, original, imported.basementCells); }
      catch (error) { rejected = error.message.includes('placement mismatch at (120, 85)'); }
      assert(rejected, 'unintended underground gap was not detected at its exact location');
    }
  });
  check('pixel terrain surface is cardinally connected over steep slopes without filling intentional underground holes', () => {
    const world = createParticleWorld(160, 90);
    for (let x = 0; x < world.width; x += 1) {
      const row = 25 + (x % 32) + (x >= 80 ? 5 : 0);
      for (let y = row; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    }
    world.excavate(110, 75, 130, 77);
    const before = JSON.stringify(world.snapshot());
    for (const scale of [2, 4, 6]) {
      const canvas = document.createElement('canvas');
      canvas.width = world.width * scale; canvas.height = world.height * scale;
      const renderer = createPixelConstructionRenderer(canvas);
      renderer.draw({ world, blueprintCells: () => [] });
      const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const green = (x, y) => {
        const index = (y * scale * canvas.width + x * scale) * 4;
        return image[index] === 63 && image[index + 1] === 193 && image[index + 2] === 95;
      };
      const queue = [], visited = new Set(), columns = new Set();
      for (let y = 0; y < world.height; y += 1) {
        if (green(0, y)) { queue.push({ x: 0, y }); visited.add(y * world.width); }
      }
      for (let index = 0; index < queue.length; index += 1) {
        const { x, y } = queue[index]; columns.add(x);
        assert(world.at(x, y) === PARTICLE_TERRAIN, 'surface renderer painted a bridge over an empty hole');
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height) continue;
          const key = ny * world.width + nx;
          if (!visited.has(key) && green(nx, ny)) { visited.add(key); queue.push({ x: nx, y: ny }); }
        }
      }
      assert(columns.size === world.width && world.at(120, 76) === PARTICLE_EMPTY &&
        !green(120, 76) && JSON.stringify(world.snapshot()) === before,
        'green terrain surface has a steep-slope gap, filled tunnel or mutated terrain');
    }
  });
  check('stepped wet terrain retains tunnels, crop edges and all cells outside explicit basement/foundation geometry', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array.from({ length: 240 }, (_, x) => 4 * (x < 80 ? 100 : x < 100 ? 104 : 108)),
      waterLevels: Array.from({ length: 240 }, (_, x) => x >= 8 && x < 20 ? 380 : null),
      tunnels: [{ interiorWidth: 4, points: [{ x: 500, y: 450 }, { x: 580, y: 450 }] }] };
    const sourceBefore = JSON.stringify(source);
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario;
    const baseline = createParticleWorldFromSurfaceWaterAndTunnels(
      { heightAt: (x) => source.heights[Math.floor(x / 4)] },
      (x) => source.waterLevels[Math.floor(x / 4)], source.tunnels,
      { width: 160, height: 90, cellSize: 4, originX: imported.originX * 4,
        originY: imported.originY * 4, supportCapacity: 128 }).snapshot();
    const basement = new Set(imported.basementCells.map((cell) => cell.y * world.width + cell.x));
    const foundation = new Set(scenario.plan.filter((cell) => cell.distance === 0)
      .map((cell) => cell.y * world.width + cell.x));
    let tunnelCells = 0;
    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const key = y * world.width + x, material = baseline.cells[key];
        if (foundation.has(key)) assert(world.at(x, y) === PARTICLE_BARRIER, 'free foundation missing');
        else if (basement.has(key) && material === PARTICLE_TERRAIN) {
          assert(world.at(x, y) === PARTICLE_EMPTY, 'intended stepped basement filled');
        } else assert(world.at(x, y) === material, `unintended terrain change at ${x},${y}`);
        const underground = (imported.originY + y + 0.5) * 4 >= source.heights[imported.originX + x];
        if (underground && material === PARTICLE_EMPTY) {
          tunnelCells += 1;
          assert(world.at(x, y) === PARTICLE_EMPTY, 'imported tunnel filled by placement');
        }
      }
    }
    assert(tunnelCells > 0 && world.waterCount === 60 && imported.initialWater === 60 &&
      imported.terrainIntegrity.checked === 14400 && JSON.stringify(source) === sourceBefore,
      'wet stepped fixture lost tunnels, water, source geometry or complete audit coverage');
  });
  check('placement audit rejects accidental water removal and filling of tunnels or basement without repairing them silently', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400),
      waterLevels: Array.from({ length: 240 }, (_, x) => x >= 8 && x < 20 ? 380 : null),
      tunnels: [{ interiorWidth: 4, points: [{ x: 500, y: 420 }, { x: 580, y: 420 }] }] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario, placed = world.snapshot();
    const baseline = createParticleWorldFromSurfaceWaterAndTunnels(
      { heightAt: (x) => source.heights[Math.floor(x / 4)] },
      (x) => source.waterLevels[Math.floor(x / 4)], source.tunnels,
      { width: 160, height: 90, cellSize: 4, originX: imported.originX * 4,
        originY: imported.originY * 4 }).snapshot();
    const waterKey = baseline.cells.findIndex((material) => material === PARTICLE_WATER);
    const tunnelKey = baseline.cells.findIndex((material, key) => material === PARTICLE_EMPTY &&
      (imported.originY + Math.floor(key / world.width) + 0.5) * 4 >= 400);
    const basementCell = imported.basementCells.find((cell) =>
      baseline.cells[cell.y * world.width + cell.x] === PARTICLE_TERRAIN);
    assert(waterKey >= 0 && tunnelKey >= 0 && basementCell, 'corruption fixtures are missing');
    for (const [key, material] of [
      [waterKey, PARTICLE_EMPTY], [tunnelKey, PARTICLE_TERRAIN],
      [basementCell.y * world.width + basementCell.x, PARTICLE_TERRAIN],
    ]) {
      world.restore(placed);
      const corrupted = world.snapshot(); corrupted.cells[key] = material; world.restore(corrupted);
      const before = JSON.stringify(world.snapshot()), spent = scenario.spent;
      const coordinate = `(${key % world.width}, ${Math.floor(key / world.width)})`;
      let rejected = false;
      try { verifyPixelMapPlacementTerrain(scenario, baseline, imported.basementCells); }
      catch (error) { rejected = error.message.includes(`placement mismatch at ${coordinate}`); }
      assert(rejected && JSON.stringify(world.snapshot()) === before && scenario.spent === spent,
        'corrupted terrain passed audit or was silently filled/charged');
    }
  });
  check('terrain placement audit rejects malformed metadata and never authorizes coordinate aliases', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario;
    const baseline = createParticleWorldFromSurface({ heightAt: () => 400 },
      { width: 160, height: 90, cellSize: 4, originX: imported.originX * 4,
        originY: imported.originY * 4 }).snapshot();
    const before = JSON.stringify(world.snapshot()), spent = scenario.spent;
    for (const cells of [null, [{ x: 160, y: 71 }], [{ x: -1, y: 72 }],
      [{ x: 63, y: 72.5 }], [{ x: 63, y: 90 }], [null],
      [...imported.basementCells, imported.basementCells[0]], [{ x: 60, y: 72 }]]) {
      let rejected = false;
      try { verifyPixelMapPlacementTerrain(scenario, baseline, cells); }
      catch (error) { rejected = /Invalid basement/.test(error.message); }
      assert(rejected, 'malformed basement audit footprint passed or failed ambiguously');
    }
    for (const material of [NaN, undefined, -1, 6, PARTICLE_BARRIER]) {
      const invalid = { ...baseline, cells: baseline.cells.slice() };
      invalid.cells[0] = material;
      let rejected = false;
      try { verifyPixelMapPlacementTerrain(scenario, invalid, imported.basementCells); }
      catch (error) { rejected = error.message === 'Imported terrain baseline contains invalid material'; }
      assert(rejected, 'invalid source material passed the terrain audit');
    }
    const audit = verifyPixelMapPlacementTerrain(scenario, baseline, imported.basementCells);
    assert(audit.terrain === world.terrainCount && audit.water === world.waterCount &&
      audit.foundation === scenario.freeMaterial && audit.foundation === world.barrierCount &&
      JSON.stringify(world.snapshot()) === before && scenario.spent === spent,
      'audit material breakdown disagrees with actual particles or mutates the simulation');
  });
  check('connected surface rendering preserves water beside steep terrain and open tunnel pixels', () => {
    const world = createParticleWorldFromSurfaceAndWater(
      { heightAt: (x) => x < 320 ? 200 : 240 }, () => 180,
      { width: 160, height: 90, cellSize: 4, originX: 0, originY: 0 });
    world.excavate(100, 70, 110, 70);
    const before = JSON.stringify(world.snapshot());
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const renderer = createPixelConstructionRenderer(canvas);
    renderer.draw({ world, blueprintCells: () => [] });
    const image = canvas.getContext('2d').getImageData(0, 0, 640, 360).data;
    const color = (x, y) => {
      const index = (y * 4 * 640 + x * 4) * 4;
      return Array.from(image.slice(index, index + 3)).join(',');
    };
    for (let y = 50; y <= 60; y += 1) {
      assert(color(79, y) === '63,193,95', 'wet slope has a missing vertical terrain edge');
      if (y < 60) assert(color(80, y) === '31,172,200', 'terrain edge concealed neighboring water');
    }
    assert(color(105, 70) === '2,2,2' && world.at(105, 70) === PARTICLE_EMPTY &&
      JSON.stringify(world.snapshot()) === before, 'wet terrain rendering filled a tunnel or mutated particles');
  });
  check('cell inspection distinguishes core/floor/basement roles and paid overlaps without mutation', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario, original = world.snapshot();
    const basement = inspectPixelMapCell(imported, original, 70, 73);
    const floor = inspectPixelMapCell(imported, original, 70, 75);
    const core = inspectPixelMapCell(imported, original, 61, 73);
    assert(basement.role === 'intentional basement space' && basement.material === 'empty' &&
      !basement.changed && !basement.planned && basement.paidDeliveries === 0 &&
      floor.role === 'connecting floor 1' && floor.planned && !floor.core &&
      floor.load === null && core.core && core.sourceSlots === 2 && core.usableSourceSlots === 2,
      'cell inspection conflated deliberate space, floor, core or dirty load');
    for (let tick = 0; tick < 300; tick += 1) scenario.step();
    const before = JSON.stringify(world.snapshot()), agents = JSON.stringify(scenario.deliveries), paid = scenario.spent;
    const overlap = inspectPixelMapCell(imported, original, 61, 73);
    const loaded = inspectPixelMapCell(imported, original, 70, 75);
    assert(overlap.paidDeliveries === 2 && overlap.deliveryStates.length === 2 &&
      overlap.tick === 300 && overlap.material === 'settled building' &&
      loaded.load.load === 1 && loaded.load.capacity === 128 &&
      JSON.stringify(world.snapshot()) === before && JSON.stringify(scenario.deliveries) === agents &&
      scenario.spent === paid && scenario.ticks === 300,
      'inspection lost overlap/load details or changed simulation');
    world.excavate(70, 76, 70, 76);
    const hole = inspectPixelMapCell(imported, original, 70, 76);
    assert(hole.material === 'empty' && hole.initialMaterial === 'terrain' && hole.changed &&
      hole.role === 'outside building earthworks', 'later digging mislabeled as original basement');
    world.set(70, 76, PARTICLE_WATER);
    assert(inspectPixelMapCell(imported, original, 70, 76).material === 'water',
      'inspection concealed water in an excavated cell');
  });
  check('cell inspection rejects invalid boundaries and identifies stepped pillar extensions', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array.from({ length: 240 }, (_, x) => 4 * (x < 80 ? 100 : x < 100 ? 104 : 108)),
      waterLevels: Array(240).fill(null), tunnels: [] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario, original = world.snapshot();
    const before = JSON.stringify(original);
    for (const [x, y] of [[-1, 0], [160, 0], [0, -1], [0, 90], [1.5, 0], [NaN, 0]]) {
      let rejected = false;
      try { inspectPixelMapCell(imported, original, x, y); }
      catch (error) { rejected = error.message.includes('integer coordinates inside the crop'); }
      assert(rejected, 'invalid cell coordinate aliased another cell');
    }
    assert(inspectPixelMapCell(imported, original, 61, 76).role === 'pillar extension' &&
      inspectPixelMapCell(imported, original, 159, 89).material === 'terrain' &&
      inspectPixelMapCell(imported, original, 0, 0).material === 'empty' &&
      JSON.stringify(world.snapshot()) === before && scenario.spent === 0,
      'extension/boundary inspection mislabeled cells or mutated the world');
  });
  check('cell inspector identifies imported tunnels and reserved repair targets, including flooded source fallback', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null),
      tunnels: [{ interiorWidth: 4, points: [{ x: 500, y: 420 }, { x: 580, y: 420 }] }] };
    const imported = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { scenario } = imported, { world } = scenario, original = world.snapshot();
    const key = [...imported.tunnelCells][0];
    assert(Number.isInteger(key) && inspectPixelMapCell(imported, original,
      key % world.width, Math.floor(key / world.width)).role === 'original imported tunnel space',
      'original underground opening was not identified as a tunnel');
    for (let i = 0; i < 300; i += 1) scenario.step();
    const target = scenario.deliveries[0].target;
    const incoming = inspectPixelMapCell(imported, original, target.x, target.y);
    assert(incoming.incomingDeliveries === 1 && incoming.repairState === 'incoming',
      'inspected repair target lost its unique incoming reservation');
    world.excavate(61, 73, 61, 73); world.set(61, 73, PARTICLE_WATER);
    const before = JSON.stringify(world.snapshot()), agents = JSON.stringify(scenario.deliveries), paid = scenario.spent;
    const flooded = inspectPixelMapCell(imported, original, 61, 73);
    const fallback = inspectPixelMapCell(imported, original, 60, 72);
    assert(flooded.changed && flooded.material === 'water' && flooded.paidDeliveries === 2 &&
      flooded.blockerDescriptions.length === 2 && flooded.blockerDescriptions.every((text) =>
        text.includes('current position (61, 73) water')) && flooded.sourceSlots === 0 &&
      fallback.usableSourceSlots === 2 && JSON.stringify(world.snapshot()) === before &&
      JSON.stringify(scenario.deliveries) === agents && scenario.spent === paid,
      'damaged-cell inspection lost blocker/fallback details or mutated material');
  });
  check('selected-cell outline scales without concealing blocker interiors or changing particles', () => {
    const world = createPixelConstructionWorld();
    const before = JSON.stringify(world.snapshot());
    for (const scale of [2, 4, 6]) {
      const canvas = document.createElement('canvas'); canvas.width = 160 * scale; canvas.height = 90 * scale;
      const renderer = createPixelConstructionRenderer(canvas), ctx = canvas.getContext('2d');
      renderer.draw({ world, blueprintCells: () => [] });
      const cell = { x: 10, y: 68 }, inset = Math.floor(scale / 2);
      const interior = Array.from(ctx.getImageData(cell.x * scale + inset, cell.y * scale + inset, 1, 1).data);
      renderer.markSelected(cell);
      assert(Array.from(ctx.getImageData(cell.x * scale, cell.y * scale, 1, 1).data).slice(0, 3).join(',') === '158,220,240',
        'selection border is not at the scaled cell origin');
      if (scale >= 4) assert(JSON.stringify(Array.from(ctx.getImageData(
        cell.x * scale + inset, cell.y * scale + inset, 1, 1).data)) === JSON.stringify(interior),
        'selection border concealed water inside the inspected cell');
      assert(JSON.stringify(world.snapshot()) === before, 'selection renderer mutated particles');
    }
  });
  check('inside deliveries follow shortest clear routes and overlap immediately without traffic waits', () => {
    const source = { width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
    const { scenario } = createPixelMapConstructionScenario(source,
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { world } = scenario;
    let overlapMoves = 0;
    for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) {
      const before = scenario.deliveries;
      scenario.step();
      const after = scenario.deliveries;
      for (const agent of after) {
        if (!agent.target) continue;
        const previous = before.find((candidate) => candidate.target &&
          candidate.target.x === agent.target.x && candidate.target.y === agent.target.y);
        if (!previous) continue;
        const moved = agent.x !== previous.x || agent.y !== previous.y;
        if (moved) {
          assert(Math.abs(agent.x - previous.x) + Math.abs(agent.y - previous.y) === 1,
            'shortest-route delivery teleported a sprite');
          assert(previous.path.length && agent.x === previous.path[0].x && agent.y === previous.path[0].y,
            'delivery took a traffic detour instead of the next shortest-route cell');
          if (after.some((other) => other !== agent && other.x === agent.x && other.y === agent.y)) {
            overlapMoves += 1;
          }
        }
        if (scenario.ticks % 3 === 0 && previous.path.length) {
          assert(moved, 'delivery yielded on its physically clear movement tick');
        }
      }
      const targets = after.filter((agent) => agent.target).map((agent) =>
        agent.target.y * world.width + agent.target.x);
      assert(new Set(targets).size === targets.length &&
        world.barrierCount + world.debrisCount + world.constructionCount +
        scenario.transportedMaterialCount === scenario.freeMaterial + scenario.spent &&
        scenario.hm === 1000 - scenario.spent,
        'overlap broke target uniqueness or paid-material conservation');
    }
    assert(scenario.finished && overlapMoves > 0 &&
      scenario.inspectCore().surviving === 27 && world.structuralLoad.failed === 0,
      'shortest-route fixture failed to overlap and complete safely');
  });
  check('inside assignment chooses the nearest reachable target rather than the first blueprint target', () => {
    const { scenario } = createPixelMapConstructionScenario({ width: 240, height: 160, cellSize: 4,
      heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] },
      { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
    const { world } = scenario;
    while (scenario.ticks < 300) scenario.step();
    const origin = scenario.deliveries[scenario.deliveries.length - 1];
    const unfinished = scenario.plan.filter((cell) => world.at(cell.x, cell.y) !== PARTICLE_BARRIER);
    const layer = Math.min(...unfinished.map((cell) => cell.distance));
    const neighbors = (x, y) => [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]]
      .filter(([nx, ny]) => nx >= 0 && nx < world.width && ny >= 0 && ny < world.height);
    const candidates = unfinished.filter((cell) => cell.distance === layer &&
      world.at(cell.x, cell.y) === PARTICLE_EMPTY && neighbors(cell.x, cell.y).some(([x, y]) =>
        [PARTICLE_TERRAIN, PARTICLE_BARRIER].includes(world.at(x, y))));
    const routes = candidates.map((target) => {
      const search = [{ x: origin.x, y: origin.y, steps: 0 }];
      const seen = new Set([origin.y * world.width + origin.x]);
      for (let i = 0; i < search.length; i += 1) {
        const cell = search[i];
        if (cell.x === target.x && cell.y === target.y) return { target, steps: cell.steps };
        for (const [x, y] of neighbors(cell.x, cell.y)) {
          const key = y * world.width + x;
          if (seen.has(key)) continue;
          const material = world.at(x, y);
          const groundAccess = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) =>
            x + dx >= 0 && x + dx < world.width && y + dy >= 0 && y + dy < world.height &&
            world.at(x + dx, y + dy) === PARTICLE_TERRAIN));
          if (material !== PARTICLE_BARRIER &&
              !(material === PARTICLE_EMPTY && (groundAccess || x === target.x && y === target.y))) continue;
          seen.add(key); search.push({ x, y, steps: cell.steps + 1 });
        }
      }
      return null;
    }).filter(Boolean);
    const nearest = routes.reduce((best, route) => route.steps < best.steps ? route : best);
    assert(nearest.steps < routes[0].steps, 'nearest-target fixture does not distinguish blueprint-first routing');
    for (let tick = 0; tick < 3; tick += 1) scenario.step();
    const assigned = scenario.deliveries.find((agent) => agent.target &&
      agent.target.x === nearest.target.x && agent.target.y === nearest.target.y);
    assert(assigned && assigned.path.length === nearest.steps - 1 &&
      Math.abs(assigned.x - origin.x) + Math.abs(assigned.y - origin.y) === 1,
      'first assigned delivery did not choose an independently verified nearest shortest route');
  });
  check('physical blockers stop freely overlapping deliveries and preserve stranded paid pixels', () => {
    for (const location of ['current', 'next']) {
      for (const material of [PARTICLE_WATER, PARTICLE_DEBRIS]) {
        const source = { width: 240, height: 160, cellSize: 4,
          heights: Array(240).fill(400), waterLevels: Array(240).fill(null), tunnels: [] };
        const imported = createPixelMapConstructionScenario(source,
          { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
        const { scenario } = imported, { world } = scenario;
        let travelling = null;
        for (let tick = 0; tick < 4000 && !travelling; tick += 1) {
          scenario.step();
          travelling = scenario.deliveries.find((agent) => agent.target &&
            agent.path.length && world.at(agent.path[0].x, agent.path[0].y) === PARTICLE_BARRIER &&
            !scenario.inspectCore().cells.some((cell) => cell.x === agent.x && cell.y === agent.y));
        }
        assert(travelling, 'fixture did not produce a travelling delivery before a physical blocker');
        const position = location === 'current' ? travelling : travelling.path[0];
        const baseline = world.snapshot(), fixture = world.snapshot();
        fixture.cells[position.y * world.width + position.x] = material;
        world.restore(fixture);
        const materialOffset = material === PARTICLE_DEBRIS ? 0 : 1;
        const paid = scenario.spent;
        const diagnostics = inspectPixelMapDiagnostics(imported);
        assert(diagnostics.yielding === 0, 'freely overlapping deliveries reported traffic yielding');
        for (let tick = 0; tick < 3; tick += 1) scenario.step({ advanceWorld: false });
        const agent = scenario.deliveries.find((candidate) => candidate.x === travelling.x && candidate.y === travelling.y);
        assert(agent && world.at(position.x, position.y) === material &&
          world.barrierCount + world.debrisCount + world.constructionCount +
          scenario.transportedMaterialCount + materialOffset === scenario.freeMaterial + scenario.spent &&
          scenario.spent === paid && scenario.hm === 1000 - paid &&
          world.waterCount === (material === PARTICLE_WATER ? 1 : 0),
          'overlap bypassed physical material or broke fixture accounting');
        if (location === 'current') {
          const report = scenario.inspectDeliveries().find((delivery) =>
            delivery.x === travelling.x && delivery.y === travelling.y);
          assert(report.blocker && report.blocker.location === 'current position' &&
            report.state.includes(material === PARTICLE_WATER ? 'water' : 'fallen debris'),
            'physical blocker was mislabeled as traffic');
        }
        // Restore the explicit injected blocker fixture, not a gameplay refund.
        const clearedFixture = world.snapshot();
        clearedFixture.cells[position.y * world.width + position.x] =
          baseline.cells[position.y * world.width + position.x];
        world.restore(clearedFixture);
        for (let tick = 0; tick < 15000 && !scenario.finished; tick += 1) scenario.step();
        assert(scenario.finished && scenario.inspectCore().surviving === 27 &&
          world.barrierCount + world.debrisCount + world.constructionCount +
          scenario.transportedMaterialCount === scenario.freeMaterial + scenario.spent,
          'traffic failed to recover after the fixture obstacle was removed');
      }
    }
  });
  check('generated city shares one physical world while seeds follow dry local terrain and budgets remain independent', () => {
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array.from({ length: 400 }, (_, x) => 4 * (100 + Math.floor(x / 80))),
      waterLevels: Array.from({ length: 400 }, (_, x) => x >= 8 && x < 20 ? 380 : null), tunnels: [] };
    const before = JSON.stringify(source), city = createSharedPixelMapConstruction(source);
    assert(city.entries.length === 3 && city.entries.every((entry) =>
      entry.scenario.world === city.world && entry.scenario.hm === 1000 &&
      entry.scenario.inspectCore().surviving === 27 && entry.seedPlacement.length === 9) &&
      city.terrainIntegrity.checked === city.world.width * 90 &&
      city.initialWater > 0 && JSON.stringify(source) === before, 'city did not share terrain, preserve source or retain independent seed budgets');
    const original = createParticleWorldFromSurfaceAndWater(
      { heightAt: (x) => source.heights[Math.floor(x / 4)] },
      (x) => source.waterLevels[Math.floor(x / 4)],
      { width: city.world.width, height: 90, cellSize: 4, originX: city.originX * 4, originY: city.originY * 4 });
    const planKeys = city.entries.flatMap(({ scenario }) => scenario.plan.map((cell) =>
      cell.y * city.world.width + cell.x));
    assert(new Set(planKeys).size === planKeys.length, 'shared city building footprints overlap');
    for (const entry of city.entries) {
      for (const cell of entry.seedPlacement) {
        const row = Math.ceil(source.heights[cell.sourceColumn] / 4 - 0.5) - city.originY;
        assert(cell.groundY === row && cell.y === row - 1 &&
          original.at(cell.x, cell.y) === PARTICLE_EMPTY && original.at(cell.x, row) === PARTICLE_TERRAIN &&
          city.world.at(cell.x, cell.y) === PARTICLE_BARRIER,
          'seed floated, flattened terrain or overwrote occupied surface');
      }
    }
    for (let tick = 0; tick < 300; tick += 1) city.step();
    assert(city.world.snapshot().tick === 300 && city.entries.every(({ scenario }) =>
      scenario.ticks === 300 && scenario.spent === 6 && scenario.hm === 994),
      'shared physics stepped once per building or charged another building budget');
    for (let tick = 0; tick < 15000 && city.entries.some(({ scenario }) => !scenario.finished); tick += 1) city.step();
    assert(city.entries.every(({ scenario }) => scenario.finished) &&
      city.world.waterCount === city.initialWater && JSON.stringify(source) === before,
      'shared generated construction failed full completion or conservation');
    city.verify();
  });
  check('selected city core damage is local and total core loss stops only its owner', () => {
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source);
    for (let tick = 0; tick < 300; tick += 1) city.step();
    const others = [city.entries[0], city.entries[2]].map(({ scenario }) =>
      ({ hm: scenario.hm, spent: scenario.spent, agents: JSON.stringify(scenario.deliveries) }));
    for (let core = 0; core < 3; core += 1) city.blastCore(1, core);
    assert(city.entries[1].scenario.coreDestroyed && [0, 2].every((index, i) => {
      const scenario = city.entries[index].scenario;
      return !scenario.coreDestroyed && scenario.inspectCore().surviving === 27 &&
        scenario.hm === others[i].hm && scenario.spent === others[i].spent &&
        JSON.stringify(scenario.deliveries) === others[i].agents;
    }), 'selected city damage changed another building or failed owner core death');
    const paid = city.entries[1].scenario.spent;
    city.clearDebris(); city.restoreTerrain();
    for (let tick = 0; tick < 120; tick += 1) city.step();
    assert(city.entries[1].scenario.spent === paid && city.entries[1].scenario.coreDestroyed &&
      [0, 2].every((index) => city.entries[index].scenario.spent > others[index === 0 ? 0 : 1].spent),
      'dead owner continued repairs or blocked live neighbor construction');
    const before = JSON.stringify(city.world.snapshot());
    let rejected = false;
    try { city.blastCore(3, 0); } catch (error) { rejected = error.message === 'Invalid shared building selection'; }
    assert(rejected && before === JSON.stringify(city.world.snapshot()), 'invalid city selection mutated terrain');
    city.verify();
  });
  check('shared seed search rejects flooded terrain rather than flattening or draining it', () => {
    const source = { width: 300, height: 160, cellSize: 4,
      heights: Array(300).fill(400), waterLevels: Array(300).fill(380), tunnels: [] };
    const before = JSON.stringify(source);
    let rejected = false;
    try { createSharedPixelMapConstruction(source); } catch (error) {
      rejected = error.message.startsWith('No three compatible generated building sites');
    }
    assert(rejected && JSON.stringify(source) === before, 'shared seed placement drained or flattened a flooded site');
  });
  check('seed growth forms middle cores, branches floors and excavates progressively before side cores or paid delivery', () => {
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    const { world } = city, scenario = city.entries[0].scenario;
    assert(world.barrierCount === 0 && scenario.freeMaterial === 0 && !scenario.coreDestroyed &&
      world.at(70, 73) === PARTICLE_TERRAIN && scenario.blueprintCells().length === 0,
      'seed growth preplaced foundations/excavation or killed an unformed core');
    for (let tick = 1; tick <= 18; tick += 1) {
      city.step();
      assert(scenario.freeMaterial === Math.floor(tick / 2) &&
        scenario.inspectCore().surviving === Math.floor(tick / 2),
        'middle core popped into place instead of growing one pixel every two ticks');
    }
    assert(scenario.inspectCore().surviving === 9 && scenario.freeMaterial === 9 &&
      scenario.inspectCore().cells.filter((cell) => cell.material === PARTICLE_BARRIER)
        .every((cell) => cell.x >= 80 && cell.x <= 82) && scenario.spent === 0,
      'middle 3-by-3 core was not first');
    while (scenario.ticks < 80) city.step();
    assert(world.at(70, 73) === PARTICLE_EMPTY && world.at(63, 73) === PARTICLE_TERRAIN &&
      world.at(70, 75) === PARTICLE_BARRIER && world.at(63, 75) === PARTICLE_TERRAIN &&
      scenario.inspectCore().surviving === 9 && scenario.spent === 0 &&
      scenario.inspectSources().every((cell) => !cell.ready),
      'floors did not dig progressively or side cores/paid emission started early');
    while (scenario.ticks < 158) {
      const before = city.entries.map(({ scenario: other }) => other.freeMaterial);
      city.step();
      assert(city.entries.every(({ scenario: other }, index) =>
        other.freeMaterial - before[index] >= 0 && other.freeMaterial - before[index] <= 1),
        'floor or side core grew as an instant cluster');
    }
    assert(scenario.foundationGrowth.complete && scenario.freeMaterial === 79 &&
      scenario.inspectCore().surviving === 27 && scenario.hm === 1000 &&
      world.barrierCount === 237 && city.entries.every(({ scenario: other }) => other.foundationGrowth.complete),
      'growth failed to create exact free foundations and side cores');
    while (scenario.ticks < 300) city.step();
    assert(city.entries.every(({ scenario: other }) => other.spent === 6 && other.hm === 994) &&
      world.snapshot().tick === 300, 'paid construction gating or shared tick count changed');
    for (let tick = 0; tick < 15000 && city.entries.some(({ scenario: other }) => !other.finished); tick += 1) city.step();
    assert(city.entries.every(({ scenario: other }) => other.finished), 'staged foundations failed full construction');
    city.verify();
  });
  check('seed growth preserves a flooded future floor, waits without HM and resumes after explicit water clearance', () => {
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    const scenario = city.entries[0].scenario, { world } = city;
    // Injected one-water fixture exercises future obstruction without modifying city generation.
    const fixture = world.snapshot(); fixture.cells[75 * world.width + 70] = PARTICLE_WATER; world.restore(fixture);
    for (let tick = 0; tick < 450; tick += 1) {
      world.step();
      city.entries.forEach(({ scenario: other }) => other.step({ advanceWorld: false }));
    }
    assert(world.at(70, 75) === PARTICLE_WATER && world.waterCount === 1 &&
      scenario.foundationGrowth.blocked === 'occupied foundation site' && scenario.spent === 0 &&
      scenario.inspectCore().surviving === 9 && world.at(63, 73) === PARTICLE_TERRAIN,
      'seed floor overwrote water, spent HM or excavated ahead of obstruction');
    assert(city.entries.slice(1).every(({ scenario: other }) =>
      other.foundationGrowth.complete && other.spent > 0 && other.hm === 1000 - other.spent),
      'one flooded seed stopped or charged neighboring growth');
    const clearance = world.snapshot(); clearance.cells[75 * world.width + 70] = PARTICLE_TERRAIN;
    clearance.cells[80 * world.width + 10] = PARTICLE_WATER; world.restore(clearance);
    for (let tick = 0; tick < 150 && !scenario.foundationGrowth.complete; tick += 1) {
      world.step(); city.entries.forEach(({ scenario: other }) => other.step({ advanceWorld: false }));
    }
    assert(scenario.foundationGrowth.complete && scenario.inspectCore().surviving === 27 &&
      world.waterCount === 1 && world.at(70, 75) === PARTICLE_BARRIER &&
      world.barrierCount + world.debrisCount + world.constructionCount +
      city.entries.reduce((sum, { scenario: other }) => sum + other.transportedMaterialCount, 0) ===
      city.entries.reduce((sum, { scenario: other }) => sum + other.freeMaterial + other.spent, 0),
      'cleared seed growth failed to resume or lost fixture water/material');
  });
  check('destroying the first formed core stops future free growth without stopping neighboring seeds', () => {
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    for (let tick = 0; tick < 18; tick += 1) city.step();
    city.blastCore(0, 1);
    const scenario = city.entries[0].scenario;
    assert(scenario.coreDestroyed && scenario.freeMaterial === 9, 'initial formed-core loss did not latch death');
    for (let tick = 0; tick < 300; tick += 1) city.step();
    assert(scenario.freeMaterial === 9 && scenario.spent === 0 &&
      city.entries.slice(1).every(({ scenario: other }) => other.foundationGrowth.complete && other.spent > 0),
      'dead seed created side cores for free or stopped neighboring growth');
    let rejected = false;
    try { city.restoreTerrain(); } catch (error) {
      rejected = error.message === 'Terrain restoration is unavailable during seed growth';
    }
    assert(rejected, 'restoration preempted unfinished/dead seed earthworks');
    city.verify();
  });
  check('uneven seed growth completes deep extensions without premature excavation or filling original tunnels', () => {
    const source = { width: 400, height: 180, cellSize: 4,
      heights: Array.from({ length: 400 }, (_, x) => 400 + Math.floor(x / 20) % 3 * 16),
      waterLevels: Array(400).fill(null),
      tunnels: [{ interiorWidth: 4, points: [{ x: 40, y: 460 }, { x: 180, y: 460 }] }] };
    const before = JSON.stringify(source);
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    const initial = city.world.snapshot();
    const tunnelKeys = new Set(city.entries.flatMap((entry) => [...entry.tunnelCells]));
    assert(tunnelKeys.size > 0 && city.entries.every((entry) =>
      new Set(entry.seedPlacement.map((cell) => cell.groundY)).size === 3),
      'uneven-growth fixture lacks different seed heights or imported tunnels');
    const columns = city.entries.flatMap((entry) =>
      [...new Set(entry.basementCells.map((cell) => cell.x))].map((x) => ({
        ground: entry.basementCells.filter((cell) => cell.x === x),
        foundation: entry.scenario.foundationCells.filter((cell) => cell.x === x),
      })));
    assert(city.entries.some(({ scenario }) => scenario.foundationCells.some((cell) =>
      scenario.foundationCells.filter((part) => part.x === cell.x).length > 3)),
      'uneven-growth fixture lacks deep pillar extensions');
    let ticks = 0;
    while (ticks < 300 && city.entries.some(({ scenario }) => !scenario.foundationGrowth.complete)) {
      const previous = city.entries.map(({ scenario }) => scenario.freeMaterial);
      city.step(); ticks += 1;
      assert(city.entries.every(({ scenario }, index) =>
        scenario.freeMaterial - previous[index] >= 0 && scenario.freeMaterial - previous[index] <= 1 &&
        scenario.spent === 0 && !scenario.coreDestroyed),
        'uneven seed batched growth, spent HM early or lost its formed core');
      assert(columns.every((column) => column.ground.every((cell) => {
        const original = initial.cells[cell.y * city.world.width + cell.x];
        if (original !== PARTICLE_TERRAIN || city.world.at(cell.x, cell.y) === original) return true;
        return city.world.at(cell.x, cell.y) === PARTICLE_EMPTY && column.foundation.every((part) =>
          city.world.at(part.x, part.y) === PARTICLE_BARRIER);
      })), 'basement column opened before its whole floor/extension column grew');
      assert([...tunnelKeys].every((key) =>
        city.world.at(key % city.world.width, Math.floor(key / city.world.width)) === PARTICLE_EMPTY),
        'seed growth filled an original imported tunnel');
    }
    assert(ticks === 206 && city.entries.every(({ scenario }) =>
      scenario.foundationGrowth.complete && scenario.freeMaterial === 103 &&
      scenario.inspectCore().surviving === 27) &&
      city.world.snapshot().cells.every((material, index) => material === city.original.cells[index]) &&
      JSON.stringify(source) === before,
      'uneven staged placement differs from audited final terrain/foundation or changed the source');
    const restored = city.restoreTerrain();
    assert(restored.restored === 0 && restored.blocked === 0, 'restoration undid completed seed earthworks');
    city.verify();
  });
  check('losing the only pixel of a partially formed core cannot revive free seed growth', () => {
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    city.step(); city.step();
    const scenario = city.entries[0].scenario;
    assert(scenario.inspectCore().surviving === 1 && scenario.freeMaterial === 1,
      'fixture skipped the partially formed middle core');
    city.blastCore(0, 1); city.clearDebris();
    for (let tick = 0; tick < 300; tick += 1) city.step();
    assert(scenario.coreDestroyed && scenario.inspectCore().surviving === 0 &&
      scenario.freeMaterial === 1 && scenario.spent === 0 && !scenario.foundationGrowth.complete &&
      city.entries.slice(1).every(({ scenario: other }) =>
        !other.coreDestroyed && other.foundationGrowth.complete && other.spent > 0),
      'clearing debris revived an interrupted core or stopped neighboring seeds');
    city.verify();
  });
  check('placement search reports exact rejection totals and preserves the twelve-cell slope limit', () => {
    const source = { width: 400, height: 180, cellSize: 4,
      heights: Array.from({ length: 400 }, (_, x) => 400 + Math.floor(x / 20) % 3 * 24),
      waterLevels: Array(400).fill(null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    const search = city.siteSearch;
    assert(search.scanned === 241 && search.suitable > 0 &&
      search.scanned === search.slope + search.unevenBase + search.wetSeed + search.footprint + search.suitable &&
      city.entries.some((entry) => {
        const rows = entry.seedPlacement.map((cell) => cell.groundY);
        return Math.max(...rows) - Math.min(...rows) === 12;
      }), 'placement statistics do not balance or rejected the allowed twelve-cell height range');
    const steep = { ...source,
      heights: Array.from({ length: 400 }, (_, x) => 400 + Math.floor(x / 20) % 3 * 26) };
    let reason = '';
    try { createSharedPixelMapConstruction(steep); } catch (error) { reason = error.message; }
    assert(reason.includes('241 exceed the 12-cell seed-height range') &&
      reason.includes('0 pass individually'), 'steep-site rejection lacks truthful height-range explanation');
    const flooded = { ...source, heights: Array(400).fill(400), waterLevels: Array(400).fill(380) };
    try { createSharedPixelMapConstruction(flooded); } catch (error) { reason = error.message; }
    assert(reason.includes('241 have flooded seeds'), 'flooded-site rejection was mislabeled as slope or tunnel failure');
  });
  check('placement preview outlines planned seeds, cores and earthworks without mutating simulation', () => {
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] }, { seedGrowth: true });
    const entry = city.entries[0];
    const canvas = document.createElement('canvas');
    canvas.width = city.world.width * 4; canvas.height = city.world.height * 4;
    const renderer = createPixelConstructionRenderer(canvas, city.world.width);
    const before = JSON.stringify({ world: city.world.snapshot(), entries: city.entries.map(({ scenario }) =>
      ({ hm: scenario.hm, ticks: scenario.ticks, growth: scenario.foundationGrowth, plan: scenario.plan })) });
    renderer.draw({ world: city.world, blueprintCells: () => [] });
    const context = canvas.getContext('2d');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    renderer.markPlacement(entry);
    const preview = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const core = entry.scenario.inspectCore().cells[0];
    const interior = ((core.y * 4 + 2) * canvas.width + core.x * 4 + 2) * 4;
    assert(preview.some((value, index) => value !== pixels[index]) &&
      [0, 1, 2, 3].every((offset) => preview[interior + offset] === pixels[interior + offset]) &&
      before === JSON.stringify({ world: city.world.snapshot(), entries: city.entries.map(({ scenario }) =>
        ({ hm: scenario.hm, ticks: scenario.ticks, growth: scenario.foundationGrowth, plan: scenario.plan })) }),
      'footprint preview filled an interior, failed to draw or mutated simulation/accounting');
    city.verify();
  });
  check('dry seed bases still reject water between bases and tunnel-cut floor support without changing the source', () => {
    const base = { width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] };
    const fixtures = [
      { source: { ...base, waterLevels: Array.from({ length: 400 }, (_, x) => x % 20 === 10 ? 380 : null) },
        wet: 36, footprint: 205 },
      { source: { ...base, tunnels: [
        { interiorWidth: 4, points: [{ x: 0, y: 416 }, { x: 1600, y: 416 }] },
      ] }, wet: 0, footprint: 241 },
    ];
    for (const { source, wet, footprint } of fixtures) {
      const before = JSON.stringify(source);
      let reason = '';
      try { createSharedPixelMapConstruction(source, { seedGrowth: true }); } catch (error) { reason = error.message; }
      assert(reason.includes(`${wet} have flooded seeds`) &&
        reason.includes(`${footprint} fail full footprint/crop/support clearance`) &&
        reason.includes('0 pass individually') && JSON.stringify(source) === before,
        'clearance accepted flooded inter-base terrain/tunnel-cut support or changed source during rejection');
    }
  });
  check('switching placement previews at two- and four-pixel scales clears old outlines and leaves all building ledgers unchanged', () => {
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] }, { seedGrowth: true });
    const before = JSON.stringify({ world: city.world.snapshot(), entries: city.entries.map(({ scenario }) =>
      ({ hm: scenario.hm, spent: scenario.spent, ticks: scenario.ticks, growth: scenario.foundationGrowth })) });
    for (const scale of [2, 4]) {
      const canvas = document.createElement('canvas');
      canvas.width = city.world.width * scale; canvas.height = city.world.height * scale;
      const renderer = createPixelConstructionRenderer(canvas, city.world.width);
      const context = canvas.getContext('2d');
      renderer.draw({ world: city.world, blueprintCells: () => [] });
      const clean = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let previous = null;
      for (const entry of city.entries) {
        renderer.draw({ world: city.world, blueprintCells: () => [] });
        renderer.markPlacement(entry);
        const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
        assert(image.some((value, index) => value !== clean[index]), 'scaled selected footprint did not draw');
        if (previous) {
          const cells = previous.scenario.plan;
          const left = Math.min(...cells.map((cell) => cell.x)) * scale;
          const right = (Math.max(...cells.map((cell) => cell.x)) + 1) * scale + 1;
          const top = Math.min(...cells.map((cell) => cell.y)) * scale;
          const bottom = (Math.max(...cells.map((cell) => cell.y)) + 1) * scale + 1;
          for (let y = top; y <= bottom; y += 1) {
            for (let x = left; x <= right; x += 1) {
              const index = (y * canvas.width + x) * 4;
              assert([0, 1, 2, 3].every((offset) => image[index + offset] === clean[index + offset]),
                'switching selected building retained an old footprint outline');
            }
          }
        }
        previous = entry;
      }
    }
    assert(before === JSON.stringify({ world: city.world.snapshot(), entries: city.entries.map(({ scenario }) =>
      ({ hm: scenario.hm, spent: scenario.spent, ticks: scenario.ticks, growth: scenario.foundationGrowth })) }),
      'switching/scaling previews changed simulation state');
    city.verify();
  });
  check('taller city preview retains square integer pixels and legacy labs retain automatic sizing', () => {
    const parent = document.createElement('div'), canvas = document.createElement('canvas');
    parent.style.width = '600px'; parent.append(canvas); document.body.append(parent);
    try {
      const renderer = createPixelConstructionRenderer(canvas, 659);
      renderer.resize(576);
      const ratio = window.devicePixelRatio || 1;
      assert(parseFloat(canvas.style.height) === 576 &&
        canvas.width / 659 === canvas.height / 90 && canvas.width % (659 * 2) === 0 &&
        parseFloat(canvas.style.width) > parent.clientWidth &&
        parseFloat(canvas.style.width) / 659 === parseFloat(canvas.style.height) / 90,
        'tall preview shrank below minimum, distorted pixels or failed to allow horizontal overflow');
      renderer.resize();
      assert(canvas.width === 659 * 2 * Math.max(1, Math.floor(parent.clientWidth * ratio / (659 * 2))),
        'minimum city height changed default sizing for other labs');
    } finally { parent.remove(); }
  });
  check('growth inspection distinguishes formed, pending and destroyed cores without advancing or mutating the city', () => {
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] }, { seedGrowth: true });
    const scenario = city.entries[0].scenario;
    let report = scenario.inspectFoundationGrowth();
    assert(report.tick === 0 && report.next.x === 80 && report.next.y === 74 &&
      !report.blocker && report.cores.every((core) => core.formed === 0 && core.pending === 9) &&
      report.excavation.removed === 0 && report.excavation.total === 102,
      'initial growth inspection fabricated a core, excavation or next coordinate');
    city.step();
    assert(scenario.inspectFoundationGrowth().cores[1].formed === 0, 'one-tick step formed a pixel early');
    city.step();
    report = scenario.inspectFoundationGrowth();
    assert(report.tick === 2 && report.cores[1].formed === 1 && report.cores[1].pending === 8 &&
      report.cores[1].surviving === 1 && report.next.x === 81 && report.next.y === 74,
      'partial middle core inspection or next pixel is incorrect');
    const before = JSON.stringify({ world: city.world.snapshot(), report, hm: scenario.hm, plan: scenario.plan });
    for (let i = 0; i < 10; i += 1) scenario.inspectFoundationGrowth();
    assert(before === JSON.stringify({ world: city.world.snapshot(),
      report: scenario.inspectFoundationGrowth(), hm: scenario.hm, plan: scenario.plan }),
      'read-only growth inspection mutated world, growth, HM or blueprint');
    city.blastCore(0, 1);
    report = scenario.inspectFoundationGrowth();
    assert(report.stopped && report.next === null && report.blocker === null &&
      report.cores[1].formed === 1 && report.cores[1].surviving === 0 && report.cores[1].pending === 8,
      'core destruction mislabeled lost formed pixels as pending or offered further growth');
    city.verify();
  });
  check('growth inspection reports current blockers immediately and counts only terrain actually dug by growth', () => {
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] }, { seedGrowth: true });
    const scenario = city.entries[0].scenario, world = city.world;
    const initial = world.snapshot(), next = scenario.inspectFoundationGrowth().next;
    const fixture = world.snapshot(); fixture.cells[next.y * world.width + next.x] = PARTICLE_WATER;
    world.restore(fixture);
    const blocked = scenario.inspectFoundationGrowth();
    assert(blocked.blocker.reason === 'occupied material' && blocked.blocker.material === PARTICLE_WATER &&
      blocked.blocker.x === next.x && blocked.blocker.y === next.y && blocked.tick === 0 &&
      scenario.freeMaterial === 0 && scenario.foundationGrowth.blocked === null,
      'inspection waited for a movement tick or changed growth while detecting water');
    world.restore(initial);
    assert(scenario.inspectFoundationGrowth().blocker === null, 'inspection retained a removed blocker');
    while (!scenario.foundationGrowth.complete) city.step();
    const complete = scenario.inspectFoundationGrowth();
    assert(complete.complete && complete.next === null && complete.excavation.removed === 102 &&
      complete.excavation.total === 102 && complete.cores.every((core) =>
        core.formed === 9 && core.pending === 0 && core.surviving === 9),
      'completed growth inspection miscounted terrain excavation or cores');
    city.verify();
  });
  check('adding a seed beside existing city buildings rejects overlaps atomically and starts independent late growth', () => {
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] }, { seedGrowth: true });
    for (let tick = 0; tick < 300; tick += 1) city.step();
    const before = JSON.stringify(city.world.snapshot());
    const preview = city.addSeed(240, true);
    assert(preview.ok && preview.surfaceY === 72 && city.entries.length === 3 &&
      before === JSON.stringify(city.world.snapshot()),
      'validity preview changed physical state or did not report the seed surface');
    const rejected = city.addSeed(81);
    assert(!rejected.ok && rejected.reason.includes('overlaps') &&
      before === JSON.stringify(city.world.snapshot()) && city.entries.length === 3,
      'overlapping seed modified existing world or registered another building');
    const added = city.addSeed(240);
    const previous = JSON.parse(before), current = city.world.snapshot();
    assert(added.ok && added.index === 3 && city.entries.length === 4 &&
      city.entries[3].scenario.freeMaterial === 0 && city.entries[3].scenario.hm === 1000 &&
      city.entries[3].scenario.ticks === 0 && previous.tick === current.tick &&
      JSON.stringify(previous.cells) === JSON.stringify(current.cells),
      'late seed preplaced material, reset the shared world or inherited another budget');
    for (let tick = 0; tick < 300; tick += 1) city.step();
    assert(city.entries[3].scenario.foundationGrowth.complete &&
      city.entries[3].scenario.inspectCore().surviving === 27 &&
      city.entries[3].scenario.hm === 994 && city.entries[0].scenario.ticks === 600 &&
      city.entries[3].scenario.ticks === 300 && city.world.snapshot().tick === 600,
      'late seed did not grow independently or stepped shared physics extra times');
    city.verify();
  });
  check('adaptive seed type and level determine core limits, variable width and descendant-parent growth', () => {
    for (const [type, level, count] of [['farm', 7, 1], ['population', 1, 2], ['population', 2, 2],
      ['population', 3, 3], ['population', 5, 4], ['population', 7, 5], ['military', 1, 3], ['military', 4, 4]]) {
      const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
        heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] }, { seedGrowth: true });
      const before = JSON.stringify(city.world.snapshot().cells);
      const preview = city.addSeed(235, true, { type, level });
      assert(preview.ok && preview.building.cores === count && city.entries.length === 3 &&
        JSON.stringify(city.world.snapshot().cells) === before, 'adaptive preview changed world or chose wrong core count');
      const added = city.addSeed(235, false, { type, level });
      assert(added.ok && added.building.cores === count && added.building.width <= 45 &&
        (type !== 'military' || added.building.spacing >= 12), 'adaptive building did not fit its available space');
      const scenario = city.entries[3].scenario;
      for (let tick = 0; tick < 1000 && !scenario.foundationGrowth.complete; tick += 1) {
        city.step();
        const cores = scenario.inspectFoundationGrowth().cores;
        assert(cores.every((core) => core.formed === 0 || core.parent === null || cores[core.parent].formed === 9),
          'descendant core appeared before its neighboring parent formed');
      }
      const cores = scenario.inspectFoundationGrowth().cores;
      assert(scenario.foundationGrowth.complete && scenario.inspectCore().surviving === count * 9 &&
        cores.every((core) => core.pending === 0) &&
        (count < 4 || cores.some((core) => core.parent !== null && cores[core.parent].parent !== null)),
        'adaptive foundation stalled, lost core mass or forced all branches to the original core');
      city.verify();
    }
  });
  check('adaptive sloped foundations follow local surfaces and stepped outlines without flattening or changing neighbors', () => {
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array.from({ length: 400 }, (_, x) => x < 215 ? 400 : 400 - Math.min(80, (x - 215) * 4)),
      waterLevels: Array(400).fill(null), tunnels: [] };
    const before = JSON.stringify(source);
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    const result = city.addSeed(235, false, { type: 'population', level: 3 });
    assert(result.ok, 'adaptive placement rejected supported one-cell-per-column slope');
    const entry = city.entries[3], rows = entry.seedPlacement.map((cell) => cell.groundY);
    assert(Math.max(...rows) - Math.min(...rows) > 12 && rows[0] !== rows[1] &&
      entry.seedPlacement.every((cell) => city.world.at(cell.x, cell.y) === PARTICLE_EMPTY &&
        city.world.at(cell.x, cell.groundY) === PARTICLE_TERRAIN),
      'adaptive fixture did not accept uneven core columns or larger terrain slope');
    const beforeGrowth = city.world.snapshot();
    for (let tick = 0; tick < 1000 && !entry.scenario.foundationGrowth.complete; tick += 1) city.step();
    assert(entry.scenario.foundationGrowth.complete && entry.scenario.inspectCore().surviving === 27 &&
      JSON.stringify(source) === before && city.world.waterCount === city.initialWater &&
      city.world.at(240, 70) === beforeGrowth.cells[70 * city.world.width + 240],
      'adaptive growth altered untouched terrain, map source or water');
    for (let tick = 0; tick < 15000 && !entry.scenario.finished; tick += 1) city.step();
    assert(entry.scenario.finished && !entry.scenario.coreDestroyed,
      'stepped adaptive frame failed paid completion');
    city.verify();
  });
  check('farms use deterministic water-limited fields, long basin pipes and independent farmland reservations', () => {
    function fixture(level) {
      const world = createParticleWorld(300, 90);
      for (let x = 0; x < 300; x += 1) for (let y = 60; y < 90; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      for (const left of [75, 155]) for (let x = left; x < left + 12; x += 1) {
        for (let y = 55; y < 60; y += 1) world.set(x, y, PARTICLE_WATER);
      }
      const siloWorld = world.snapshot();
      siloWorld.cells[59 * 300 + 40] = PARTICLE_BARRIER;
      world.restore(siloWorld);
      const entry = { building: { type: 'farm', level, desiredSilos: 1,
        silos: [{ cells: [{ x: 40, y: 59 }], capacity: 100 }] }, seedPlacement: [
        { x: 39, y: 59 }, { x: 40, y: 59 }, { x: 41, y: 59 }],
      scenario: { finished: true, coreDestroyed: false, plan: [
        { x: 39, y: 59 }, { x: 40, y: 59 }, { x: 41, y: 59 }] } };
      return { world, entry, farms: createPixelCityFarms(world, [entry], () => 60) };
    }
    const low = fixture(1), high = fixture(3), replay = fixture(3);
    const baseline = JSON.stringify(high.world.snapshot());
    for (let tick = 0; tick < 3600; tick += 1) {
      low.farms.step(); high.farms.step(); replay.farms.step();
    }
    const farm = high.farms.inspect(0), smaller = low.farms.inspect(0);
    assert(farm.sources.length === 2 && farm.sources[1].distance === 115, 'pipes did not reach the second distant basin');
    assert(farm.fields.length <= farm.capacity && farm.fields.length > smaller.fields.length, 'level and water failed to limit acreage');
    assert(farm.rate > smaller.rate && farm.food > smaller.food, 'higher levels failed to increase production');
    assert(JSON.stringify(farm) === JSON.stringify(replay.farms.inspect(0)), 'equal simulation ticks produced unequal state');
    assert(JSON.stringify(high.world.snapshot()) === baseline, 'farms created physical materials or consumed water');
    const field = farm.fields[0];
    assert(high.farms.populationBlocked([{ x: field.x, y: 20 }]), 'population footprint overlap did not reserve the field column');
    high.farms.clearMilitary([{ x: field.x, y: 20 }]);
    assert(!high.farms.populationBlocked([{ x: field.x, y: 20 }]) &&
      high.farms.inspect(0).fields.length === farm.fields.length - 1, 'military occupation failed to clear wheat');
    high.entry.scenario.coreDestroyed = true;
    const food = high.farms.inspect(0).food;
    for (let tick = 0; tick < 120; tick += 1) high.farms.step();
    assert(high.farms.inspect(0).food === food && high.farms.inspect(0).rate === 0, 'dead cores continued production');
    const dry = fixture(3);
    const empty = dry.world.snapshot();
    empty.cells = empty.cells.map((material) => material === PARTICLE_WATER ? PARTICLE_EMPTY : material);
    dry.world.restore(empty);
    for (let tick = 0; tick < 120; tick += 1) dry.farms.step();
    assert(dry.farms.inspect(0).fields.length === 0 && dry.farms.inspect(0).food === 0, 'dry farms grew crops or produced food');
    const blocked = fixture(3), blockedWorld = blocked.world.snapshot();
    blockedWorld.cells[59 * 300 + 50] = PARTICLE_DEBRIS;
    blocked.world.restore(blockedWorld);
    for (let tick = 0; tick < 120; tick += 1) blocked.farms.step();
    assert(blocked.farms.inspect(0).sources.length === 0 && blocked.farms.inspect(0).capacity === 0,
      'pipes supplied crops through physical debris');
  });
  check('an added one-core farm produces wheat in the real shared physical city', () => {
    const wet = (x) => (x >= 220 && x <= 228) || (x >= 255 && x <= 264);
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array.from({ length: 400 }, (_, x) => wet(x) ? 420 : 400),
      waterLevels: Array.from({ length: 400 }, (_, x) => wet(x) ? 400 : null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    const added = city.addSeed(235, false, { type: 'farm', level: 3 });
    assert(added.ok, 'dry farm seed was rejected beside two basins');
    const water = city.world.waterCount;
    for (let tick = 0; tick < 5000; tick += 1) city.step();
    const farm = city.inspectFarm(added.index);
    assert(city.entries[added.index].scenario.finished && farm.fields.length > 0 &&
      farm.sources.length === 2 && farm.food > 0, 'completed farm failed to grow irrigated wheat from two basins');
    assert(city.world.waterCount === water, 'irrigation changed physical basin water');
    assert(farm.fields.every((field) => !added.building.silos.some((silo) =>
      field.x >= silo.left && field.x <= silo.right)), 'silos overlapped wheat fields');
    city.verify();
  });
  check('farm land blocks full population footprints but accepts military occupation atomically', () => {
    const wet = (x) => x >= 220 && x <= 221;
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array.from({ length: 400 }, (_, x) => wet(x) ? 460 : 400),
      waterLevels: Array.from({ length: 400 }, (_, x) => wet(x) ? 400 : null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    assert(city.addSeed(228, false, { type: 'farm', level: 1 }).ok, 'farm fixture rejected');
    for (let tick = 0; tick < 5000; tick += 1) city.step();
    const before = JSON.stringify(city.world.snapshot()), fields = city.inspectFarm(3).fields.length;
    const population = city.addSeed(235, true, { type: 'population', level: 1 });
    assert(!population.ok && population.reason.includes('farmland') &&
      !city.addSeed(235, false, { type: 'population', level: 1 }).ok &&
      JSON.stringify(city.world.snapshot()) === before, 'population farmland preview/click was not rejected atomically');
    const silo = city.addSeed(236, true, { type: 'farm', level: 1 });
    assert(!silo.ok && silo.reason.includes('farmland') &&
      !city.addSeed(236, false, { type: 'farm', level: 1 }).ok &&
      city.inspectFarm(3).fields.length === fields, 'new silos overlapped or cleared wheat fields');
    const military = city.addSeed(250, true, { type: 'military', level: 1 });
    assert(military.ok && JSON.stringify(city.world.snapshot()) === before &&
      city.inspectFarm(3).fields.length === fields, 'military farmland preview changed physical or crop state');
    const accepted = city.addSeed(250, false, { type: 'military', level: 1 });
    assert(accepted.ok && city.inspectFarm(3).fields.length < fields &&
      JSON.stringify(city.world.snapshot().cells) === JSON.stringify(JSON.parse(before).cells),
      'accepted military did not replace wheat independently of physical material');
    city.verify();
  });
  check('farm silos have even roofs, level-based counts and supported paid construction', () => {
    const source = { width: 400, height: 160, cellSize: 4, heights: Array(400).fill(400),
      waterLevels: Array(400).fill(null), tunnels: [] };
    for (const [level, target] of [[1, 1], [3, 2], [5, 3], [7, 4]]) {
      const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
      const x = 235;
      const before = JSON.stringify(city.world.snapshot());
      const preview = city.addSeed(x, true, { type: 'farm', level });
      assert(preview.ok && JSON.stringify(city.world.snapshot()) === before, 'preview mutated physical state');
      const added = city.addSeed(x, false, { type: 'farm', level }), entry = city.entries[added.index];
      assert(added.ok && added.building.silos.length === target && added.building.desiredSilos === target &&
        JSON.stringify(preview.building) === JSON.stringify(added.building) &&
        entry.scenario.inspectCore().total === 9, 'silo count, preview or core count incorrect');
      assert(city.inspectSMStorage().capacity === 0, 'unbuilt silos provided storage');
      for (const silo of added.building.silos) {
        const profile = Array.from({ length: 5 }, (_, dx) =>
          Math.min(...silo.cells.filter((cell) => cell.x === silo.left + dx).map((cell) => cell.y)) - silo.roof);
        assert(profile.join(',') === '2,1,0,1,2' && silo.roof === added.building.silos[0].roof,
          'silo cap was asymmetric or roofs had unequal heights');
      }
      for (let tick = 0; tick < 15000 && !entry.scenario.finished; tick += 1) city.step();
      assert(entry.scenario.finished && !entry.scenario.coreDestroyed && city.world.debrisCount === 0 &&
        entry.scenario.inspectCore().surviving === 9 && city.inspectSMStorage().capacity === target * 100,
        'silos failed supported construction, storage capacity or lateral floor growth');
      city.verify();
    }
    const wet = (x) => x >= 220 && x <= 228;
    const narrow = createSharedPixelMapConstruction({ ...source,
      heights: source.heights.map((height, x) => wet(x) ? 420 : height),
      waterLevels: source.waterLevels.map((level, x) => wet(x) ? 400 : level) }, { seedGrowth: true });
    const small = narrow.addSeed(232, false, { type: 'farm', level: 7 });
    assert(small.ok && small.building.silos.length < 4, 'farm did not reduce silo count beside water');
    for (let tick = 0; tick < 10000 && !narrow.entries[small.index].scenario.finished; tick += 1) narrow.step();
    assert(narrow.entries[small.index].scenario.finished && narrow.world.waterCount === narrow.initialWater,
      'narrow farm failed construction or damaged its neighboring basin');
    narrow.verify();
  });
  check('interlocking military frames enter population tower gaps with independent cores and single pixel ownership', () => {
    const heights = Array.from({ length: 500 }, (_, x) => 400 + (x % 3) * 4);
    for (const pole of [60, 80, 100, 200, 220, 240, 400, 420, 440]) {
      for (let dx = 0; dx < 3; dx += 1) heights[pole + dx] = 400;
    }
    const source = { width: 500, height: 160, cellSize: 4,
      heights, waterLevels: Array(500).fill(null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    const population = city.addSeed(305, false, { type: 'population', level: 3 });
    assert(population.ok, `population interlocking host rejected: ${population.reason}`);
    for (let tick = 0; tick < 7000 && !city.entries.every(({ scenario }) => scenario.finished); tick += 1) city.step();
    const host = city.entries[population.index], before = JSON.stringify(city.world.snapshot());
    const clocks = city.entries.map(({ scenario }) => [scenario.ticks, scenario.hm, scenario.spent]);
    const preview = city.addSeed(356, true, { type: 'military', level: 1 });
    assert(preview.ok && preview.building.interlockingCells.length > 0 &&
      preview.building.interlockingHosts.includes(population.index), 'hover did not fit a military frame inside a population tower gap');
    assert(JSON.stringify(city.world.snapshot()) === before &&
      JSON.stringify(city.entries.map(({ scenario }) => [scenario.ticks, scenario.hm, scenario.spent])) === JSON.stringify(clocks),
    'interlocking hover spent materials or changed clocks/world');
    const added = city.addSeed(356, false, { type: 'military', level: 1 });
    assert(added.ok && JSON.stringify(added.building) === JSON.stringify(preview.building), 'click disagreed with interlocking hover');
    for (let tick = 0; tick < 6000; tick += 1) city.step();
    const military = city.entries[added.index], keys = new Set(host.scenario.plan.map((cell) => `${cell.x},${cell.y}`));
    assert(military.scenario.finished && military.building.interlockingCells.every((cell) =>
      city.world.at(cell.x, cell.y) === PARTICLE_BARRIER && !keys.has(`${cell.x},${cell.y}`)),
    'interlocking was only an overlay, failed construction, or duplicated a host pixel');
    assert(host.scenario.inspectCore().total === 27 && military.scenario.inspectCore().total === 27,
      'interlocking merged core counts');
    const reservations = new Set([...host.scenario.plan, ...host.basementCells].map((cell) => `${cell.x},${cell.y}`));
    assert([...military.scenario.plan, ...military.basementCells].every((cell) => !reservations.has(`${cell.x},${cell.y}`)),
      'interlocking excavated or reserved host basement/core pixels');
    const world = JSON.stringify(city.world.snapshot()), accounts = city.entries.map(({ scenario }) => [scenario.hm, scenario.spent]);
    const rejected = city.addSeed(305, false, { type: 'military', level: 1 });
    assert(!rejected.ok && JSON.stringify(city.world.snapshot()) === world &&
      JSON.stringify(city.entries.map(({ scenario }) => [scenario.hm, scenario.spent])) === JSON.stringify(accounts),
    'physical seed/core collision was not rejected atomically');
    const hostHM = host.scenario.hm, hostSpent = host.scenario.spent;
    const repairTarget = military.scenario.plan.find((cell) => cell.x === 355 &&
      cell.y < military.seedPlacement[0].groundY - 6 && !military.building.interlockingCells.some((part) =>
        part.x === cell.x && part.y === cell.y));
    city.world.impact(repairTarget.x, repairTarget.y, 1);
    for (let tick = 0; tick < 120; tick += 1) city.step();
    city.clearDebris();
    const militarySpent = military.scenario.spent;
    const repaired = city.repairBuilding(added.index);
    assert(repaired.ok, `independent military repair rejected: ${repaired.reason}`);
    for (let tick = 0; tick < 7000 && !military.scenario.finished; tick += 1) city.step();
    assert(military.scenario.finished && military.scenario.spent - militarySpent === repaired.repairPixels &&
      host.scenario.hm === hostHM && host.scenario.spent === hostSpent,
    'military paid repair borrowed population materials or failed its own repair ledger');
    city.verify();
    for (let core = 0; core < 3; core += 1) city.blastCore(added.index, core);
    assert(military.scenario.coreDestroyed && !host.scenario.coreDestroyed &&
      host.scenario.hm === hostHM && host.scenario.spent === hostSpent &&
      !city.repairBuilding(added.index).ok, 'military death spent host repair budget, killed host or revived dead cores');
    city.verify();
  });
  check('urban narrow population gaps get read-only surface detail without water wheat or reservation obstruction', () => {
    const heights = Array.from({ length: 500 }, (_, x) => 400 + (x % 3) * 4);
    for (const pole of [60, 80, 100, 200, 220, 240, 400, 420, 440]) {
      for (let dx = 0; dx < 3; dx += 1) heights[pole + dx] = 400;
    }
    const source = { width: 500, height: 160, cellSize: 4,
      heights, waterLevels: Array(500).fill(null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    const a = city.addSeed(275, false, { type: 'population', level: 1 });
    const b = city.addSeed(309, false, { type: 'population', level: 1 });
    assert(a.ok && b.ok, `narrow population gap fixtures rejected: ${a.reason || b.reason}`);
    for (let tick = 0; tick < 7000 && !city.entries.every(({ scenario }) => scenario.finished); tick += 1) city.step();
    const details = city.inspectUrbanDetails();
    assert(details.some((detail) => detail.type === 'paving') && details.some((detail) => detail.type === 'lamp') &&
      details.some((detail) => detail.type === 'utility-box'), 'compact gap detail was not generated');
    const before = JSON.stringify(city.world.snapshot()), accounts = city.entries.map(({ scenario }) => [scenario.hm, scenario.spent]);
    const reserved = new Set(city.entries.flatMap((entry) => [...entry.scenario.plan, ...entry.basementCells])
      .map((cell) => `${cell.x},${cell.y}`));
    assert(details.every((detail) => detail.mode === 'logical-decoration' && !detail.material && !detail.obstructsAccess &&
      detail.cells.every((cell) => city.world.at(cell.x, cell.y) === PARTICLE_EMPTY && !reserved.has(`${cell.x},${cell.y}`))),
    'decorative details obstructed a physical access cell or core');
    details[0].cells[0].x = -1;
    assert(city.inspectUrbanDetails()[0].cells[0].x >= 0 && JSON.stringify(city.world.snapshot()) === before &&
      JSON.stringify(city.entries.map(({ scenario }) => [scenario.hm, scenario.spent])) === JSON.stringify(accounts),
    'detail inspection shared mutable state or spent HM');
    const road = city.inspectRoads().find((item) => item.from === a.index && item.to === b.index);
    const wheat = new Set([road.cells[0].x]);
    assert(inspectPixelUrbanDetails(city.world, city.entries, [road], {
      populationBlocked: (cells) => cells.some((cell) => wheat.has(cell.x)),
    }).length === 0, 'detail ignored a reserved farmland column');
    const plantRoad = { ...road, cells: Array.from({ length: 8 }, (_, dx) => ({ x: 350 + dx,
      y: Math.ceil(source.heights[350 + dx] / 4 - 0.5) - city.originY - 1 })) };
    assert(inspectPixelUrbanDetails(city.world, city.entries, [plantRoad], { populationBlocked: () => false })
      .some((item) => item.type === 'planter'), 'clear wider narrow gap did not receive a small planter');
    city.world.set(road.cells[0].x, road.cells[0].y, PARTICLE_WATER);
    assert(!city.inspectUrbanDetails().some((item) => item.from === a.index && item.to === b.index),
      'surface detail persisted over blocked water');
    const farms = createPixelCityFarms(city.world, city.entries, () => 60);
    assert(!farms.populationBlocked(road.cells), 'dry population-only fixture unexpectedly reserved wheat');
  });
  check('farm storage border encloses SM fill with different colors and preserves accounting after destruction', () => {
    const wet = (x) => (x >= 220 && x <= 228) || (x >= 255 && x <= 264);
    const source = { width: 400, height: 160, cellSize: 4,
      heights: Array.from({ length: 400 }, (_, x) => wet(x) ? 420 : 400),
      waterLevels: Array.from({ length: 400 }, (_, x) => wet(x) ? 400 : null), tunnels: [] };
    const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
    const added = city.addSeed(235, false, { type: 'farm', level: 3 });
    assert(added.ok, 'storage border farm fixture rejected');
    for (let tick = 0; tick < 5000; tick += 1) city.step();
    const farm = city.inspectFarm(added.index), world = city.world;
    assert(farm.storage.sm > 0 && farm.storageSilos.some((silo) => silo.intact && silo.stored > 0),
      'completed silos failed to expose stored-food interiors');
    for (const silo of added.building.silos) {
      const frame = new Set(city.entries[added.index].scenario.plan.map((cell) => `${cell.x},${cell.y}`));
      assert(silo.storageCells.length > 0 && silo.storageCells.every((cell) =>
        !frame.has(`${cell.x},${cell.y}`) && cell.x > silo.left && cell.x < silo.right &&
        cell.y > silo.roof + 2 && cell.y < silo.base), 'food occupied its physical shell or a core');
      const visited = new Set();
      for (const start of silo.storageCells) {
        const queue = [start];
        for (let i = 0; i < queue.length; i += 1) {
          const cell = queue[i], key = `${cell.x},${cell.y}`;
          if (visited.has(key) || world.at(cell.x, cell.y) === PARTICLE_BARRIER) continue;
          visited.add(key);
          assert(cell.x > silo.left && cell.x < silo.right && cell.y > silo.roof + 2 && cell.y < silo.base,
            'food has an open path through the shell to the outside');
          queue.push({ x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y },
            { x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y + 1 });
        }
      }
    }
    const snapshot = JSON.stringify(world.snapshot()), storage = JSON.stringify(city.inspectSMStorage());
    const canvas = document.createElement('canvas'), renderer = createPixelConstructionRenderer(canvas, world.width, world.height);
    canvas.width = world.width * 2; canvas.height = world.height * 2;
    renderer.markFarmStorage(farm, world);
    const silo = farm.storageSilos.find((item) => item.intact && item.stored > 0);
    const food = silo.storageCells.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_EMPTY)
      .sort((a, b) => b.y - a.y || a.x - b.x)[0];
    const border = silo.borderCells.find((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER);
    const scale = canvas.width / world.width;
    const rgb = (cell) => [...canvas.getContext('2d').getImageData(
      Math.floor((cell.x + 0.5) * scale), Math.floor((cell.y + 0.5) * scale), 1, 1).data].slice(0, 3).join(',');
    assert(rgb(border) === '139,198,214' && rgb(food) === '214,169,83', 'food and physical shell do not have their distinct visible colors');
    assert(JSON.stringify(world.snapshot()) === snapshot && JSON.stringify(city.inspectSMStorage()) === storage,
      'storage rendering changed physics or SM');
    city.verify();
    const stored = city.inspectSMStorage().sm;
    city.blastCore(added.index, 0);
    assert(city.inspectSMStorage().sm === stored &&
      city.inspectFarm(added.index).storageSilos.every((item) => !item.intact && item.stored === 0),
    'broken storage erased food or still displayed protected fill');
    city.verify();
  });
  check('farm SM storage pools completed silos, stops at full capacity and resumes after spending', () => {
    const world = createParticleWorld(300, 90);
    for (let x = 0; x < 300; x += 1) for (let y = 60; y < 90; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    for (let x = 120; x < 130; x += 1) for (let y = 55; y < 60; y += 1) world.set(x, y, PARTICLE_WATER);
    const snapshot = world.snapshot();
    snapshot.cells[59 * 300 + 40] = PARTICLE_BARRIER;
    snapshot.cells[59 * 300 + 200] = PARTICLE_BARRIER;
    world.restore(snapshot);
    const entries = [40, 200].map((x) => ({ building: { type: 'farm', level: 3, desiredSilos: 1,
      silos: [{ cells: [{ x, y: 59 }], capacity: 100 }] },
    seedPlacement: [{ x: x - 1, y: 59 }, { x, y: 59 }, { x: x + 1, y: 59 }],
    scenario: { finished: true, coreDestroyed: false, plan: [{ x, y: 59 }] } }));
    const farms = createPixelCityFarms(world, entries, () => 60);
    assert(farms.inspectStorage().capacity === 200, 'storage failed to pool both farms');
    for (let tick = 0; tick < 40000; tick += 1) farms.step();
    assert(farms.inspectStorage().sm === 200 && farms.inspectStorage().totalProduced === 200,
      'production did not stop exactly at shared capacity');
    farms.step();
    assert(farms.inspect(0).rate === 0 && farms.inspect(1).rate === 0, 'full silos continued production');
    farms.spendSM(25);
    for (let tick = 0; tick < 1000; tick += 1) farms.step();
    assert(farms.inspectStorage().sm > 175 && farms.inspectStorage().sm <= 200, 'spending failed to resume production');
    entries[0].scenario.coreDestroyed = true;
    const stored = farms.inspectStorage().sm;
    assert(farms.inspectStorage().capacity === 100 && farms.inspectStorage().overflow === stored - 100,
      'destroyed storage erased SM or failed to reduce capacity');
    for (let tick = 0; tick < 120; tick += 1) farms.step();
    assert(farms.inspectStorage().sm === stored, 'overflow allowed further production');
    for (const amount of [0, -1, 0.5, stored + 1]) {
      let rejected = false;
      try { farms.spendSM(amount); } catch (error) { rejected = true; }
      assert(rejected && farms.inspectStorage().sm === stored, 'invalid spending mutated storage');
    }
    const damaged = world.snapshot();
    damaged.cells[59 * 300 + 200] = PARTICLE_EMPTY;
    world.restore(damaged);
    assert(farms.inspectStorage().capacity === 0 && farms.inspectStorage().sm === stored,
      'incomplete silo retained capacity or deleted stored SM');
    assert(stored === farms.inspectStorage().totalProduced - farms.inspectStorage().totalSpent,
      'shared SM accounting failed');
  });
  check('population level-ups preserve identity and accounting while growing taller and branching descendant cores', () => {
    const heights = Array.from({ length: 600 }, (_, x) => 400 + (x % 3) * 4);
    for (const pole of [60, 80, 100, 200, 220, 240, 400, 420, 440]) {
      for (let dx = 0; dx < 3; dx += 1) heights[pole + dx] = 400;
    }
    const city = createSharedPixelMapConstruction({ width: 600, height: 160, cellSize: 4,
      heights, waterLevels: Array(600).fill(null), tunnels: [] }, { seedGrowth: true });
    const short = prepareAdaptivePixelSeed(city.world, { heights }, city.originX, city.originY,
      city.entries, 270, { type: 'population', level: 1 });
    const tall = prepareAdaptivePixelSeed(city.world, { heights }, city.originX, city.originY,
      city.entries, 270, { type: 'population', level: 7 });
    assert(short.ok && tall.ok && Math.min(...tall.geometry.frameCells.map((cell) => cell.y)) ===
      Math.min(...short.geometry.frameCells.map((cell) => cell.y)) - 12, 'placement level did not affect skyscraper height');
    const added = city.addSeed(270, false, { type: 'population', level: 1 });
    assert(added.ok, 'population fixture rejected');
    const entry = city.entries[added.index], scenario = entry.scenario;
    for (let level = 1; level <= 7; level += 1) {
      for (let tick = 0; tick < 18000 && !scenario.finished; tick += 1) city.step();
      assert(scenario.finished && !scenario.coreDestroyed && city.world.debrisCount === 0, 'population upgrade failed stable completion');
      if (level === 7) break;
      const before = JSON.stringify(city.world.snapshot()), roof = Math.min(...scenario.plan.map((cell) => cell.y));
      const hm = scenario.hm, spent = scenario.spent, ticks = scenario.ticks;
      const levelUp = city.levelUpPopulation;
      const result = levelUp(added.index);
      assert(result.ok && result.level === level + 1 && scenario === entry.scenario &&
        scenario.hm === hm && scenario.spent === spent && scenario.ticks === ticks &&
        Math.min(...scenario.plan.map((cell) => cell.y)) === roof - 2 &&
        JSON.stringify(city.world.snapshot()) === before, 'upgrade reset identity, mass, clocks, cost or failed height growth');
      assert(entry.building.cores === Math.min(5, 2 + Math.floor(level / 2)), 'threshold did not add a descendant core');
      if (level === 2) assert(scenario.inspectFoundationGrowth().cores[2].parent === 1,
        'new core did not branch from a descendant');
      const pending = JSON.stringify(city.world.snapshot());
      assert(!city.levelUpPopulation(added.index).ok && pending === JSON.stringify(city.world.snapshot()),
        'unfinished upgrade accepted another level');
      city.verify();
    }
    assert(scenario.hm === 1000 - scenario.spent && scenario.inspectCore().surviving === 45 &&
      !city.levelUpPopulation(added.index).ok, 'upgrade accounting, original cores or maximum level changed');
  });
  check('population damaged upgrades include repair budgets and preserve occupied targets and physical collapse blockers', () => {
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array.from({ length: 400 }, (_, x) => x < 10 ? 388 : null),
      tunnels: [] }, { seedGrowth: true });
    const added = city.addSeed(235, false, { type: 'population', level: 1 });
    assert(added.ok, 'damaged population fixture rejected');
    for (let tick = 0; tick < 18000 && city.entries.some(({ scenario }) => !scenario.finished); tick += 1) city.step();
    const entry = city.entries[added.index], scenario = entry.scenario;
    assert(scenario.finished, 'damaged population fixture did not finish');
    city.blastCore(added.index, 0);
    const missing = scenario.plan.filter((cell) => city.world.at(cell.x, cell.y) !== PARTICLE_BARRIER);
    const damaged = city.world.snapshot(), flooded = city.world.snapshot();
    const water = flooded.cells.indexOf(PARTICLE_WATER);
    const target = missing[0];
    assert(missing.length > 0 && !scenario.coreDestroyed && water >= 0, 'damaged upgrade fixture lost all cores or water');
    flooded.cells[water] = PARTICLE_EMPTY; flooded.cells[target.y * city.world.width + target.x] = PARTICLE_WATER;
    city.world.restore(flooded);
    const before = JSON.stringify(city.world.snapshot()), building = JSON.stringify(entry.building), plan = JSON.stringify(scenario.plan);
    assert(!city.repairBuilding(added.index).ok && !city.levelUpPopulation(added.index).ok &&
      JSON.stringify(city.world.snapshot()) === before && JSON.stringify(entry.building) === building &&
      JSON.stringify(scenario.plan) === plan, 'occupied original repair target was overwritten or changed upgrade state');
    city.world.restore(damaged);
    const hm = scenario.hm, free = scenario.freeMaterial, ticks = scenario.ticks;
    const neighbors = city.entries.slice(0, 3).map(({ scenario }) => scenario.hm);
    const upgrade = city.levelUpPopulation(added.index);
    assert(upgrade.ok && upgrade.repairPixels === missing.length && upgrade.paidPixels > 0 &&
      scenario.hm === hm && scenario.freeMaterial === free && scenario.ticks === ticks &&
      entry.building.cores === 2 && JSON.stringify(city.world.snapshot()) === JSON.stringify(damaged),
      'upgrade did not include existing repairs or mutated immediate mass, budget or clocks');
    for (let tick = 0; tick < 6000 && !scenario.finished; tick += 1) city.step();
    assert(!scenario.finished && scenario.hm === hm && scenario.freeMaterial === free &&
      JSON.stringify(city.entries.slice(0, 3).map(({ scenario }) => scenario.hm)) === JSON.stringify(neighbors) &&
      city.world.debrisCount > 0 && city.world.structuralLoad.failed > 0 &&
      scenario.message.includes('No reachable supported site'),
      'damaged population upgrade bypassed physical collapse blockers or spent unsupported repair material');
    city.verify();
  });
  check('population roads connect nearby completed buildings without changing physical materials', () => {
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array(400).fill(null), tunnels: [] }, { seedGrowth: true });
    assert(city.addSeed(218, false, { type: 'population', level: 1 }).ok &&
      city.addSeed(250, false, { type: 'population', level: 1 }).ok, 'road fixtures did not fit');
    assert(city.inspectRoads().length === 0, 'unfinished buildings connected prematurely');
    for (let tick = 0; tick < 18000 && city.entries.slice(3).some((entry) => !entry.scenario.finished); tick += 1) city.step();
    assert(city.inspectRoads().length === 1, 'nearby completed population buildings did not connect');
    const road = city.inspectRoads()[0], snapshot = JSON.stringify(city.world.snapshot());
    city.inspectRoads()[0].cells[0].x = 0;
    assert(city.inspectRoads()[0].cells[0].x === road.cells[0].x &&
      JSON.stringify(city.world.snapshot()) === snapshot, 'road inspection mutated model or physical world');
    const canvas = document.createElement('canvas');
    canvas.width = city.world.width * 4; canvas.height = 360;
    const renderer = createPixelConstructionRenderer(canvas, city.world.width);
    renderer.draw({ world: city.world, blueprintCells: () => [] });
    renderer.markRoads([road]);
    const gray = road.cells.find((cell) => cell.x % 4 !== 0);
    const color = canvas.getContext('2d').getImageData(gray.x * 4 + 1, gray.y * 4 + 1, 1, 1).data;
    assert(color[0] === 146 && color[1] === 151 && color[2] === 142 &&
      JSON.stringify(city.world.snapshot()) === snapshot, 'road overlay was not visible or mutated physics');
    const cell = road.cells[0];
    city.world.excavate(cell.x, cell.y + 1, cell.x, cell.y + 1);
    city.step();
    assert(city.inspectRoads().length === 0, 'road remained over unsupported ground');
    city.world.set(cell.x, cell.y + 1, PARTICLE_TERRAIN); city.step();
    assert(city.inspectRoads().length === 1, 'road failed to reconnect after ground restoration');
    city.levelUpPopulation(3);
    for (let tick = 0; tick < 18000 && !city.entries[3].scenario.finished; tick += 1) city.step();
    const blockedWorld = JSON.stringify(city.world.snapshot()), blockedBuilding = JSON.stringify(city.entries[3].building);
    assert(!city.levelUpPopulation(3).ok && JSON.stringify(city.world.snapshot()) === blockedWorld &&
      JSON.stringify(city.entries[3].building) === blockedBuilding, 'blocked descendant expansion changed world or level');
    city.blastCore(3, 0); city.blastCore(3, 1);
    assert(city.inspectRoads().length === 0, 'paused roads remained connected after core death');
    city.step();
    assert(city.inspectRoads().length === 0, 'roads remained connected to a dead building');
    city.verify();
  });
  check('military level-ups widen paid frames and preserve cores, clocks, neighbors and ledgers', () => {
    const heights = Array.from({ length: 600 }, (_, x) => 400 + (x % 3) * 4);
    for (const pole of [60, 80, 100, 200, 220, 240, 400, 420, 440]) {
      for (let dx = 0; dx < 3; dx += 1) heights[pole + dx] = 400;
    }
    const city = createSharedPixelMapConstruction({ width: 600, height: 160, cellSize: 4,
      heights, waterLevels: Array(600).fill(null), tunnels: [] }, { seedGrowth: true });
    const added = city.addSeed(270, false, { type: 'military', level: 1 });
    assert(added.ok, 'military upgrade fixture rejected');
    const entry = city.entries[added.index], scenario = entry.scenario;
    const originalCores = scenario.inspectCore().cells.map(({ x, y }) => ({ x, y }));
    const neighborPlans = JSON.stringify(city.entries.slice(0, 3).map((entry) => entry.scenario.plan));
    for (let level = 1; level <= 7; level += 1) {
      for (let tick = 0; tick < 18000 && !scenario.finished; tick += 1) city.step();
      assert(scenario.finished && !scenario.coreDestroyed && city.world.debrisCount === 0,
        `military level ${level} failed stable paid completion`);
      if (level === 7) break;
      const before = JSON.stringify(city.world.snapshot()), width = entry.building.width;
      const hm = scenario.hm, spent = scenario.spent, ticks = scenario.ticks, planLength = scenario.plan.length;
      const oldRight = Math.max(...scenario.plan.map((cell) => cell.x));
      const result = city.levelUpMilitary(added.index);
      assert(result.ok && result.level === level + 1 && entry.scenario === scenario &&
        entry.building.width > width && scenario.hm === hm && scenario.spent === spent && scenario.ticks === ticks &&
        JSON.stringify(city.world.snapshot()) === before, 'military upgrade reset identity, clocks, mass or budget');
      assert(entry.building.cores === (level + 1 >= 4 ? 4 : 3) && result.paidPixels > 0,
        'military upgrade used wrong core limit or free upper frame');
      if (level === 3) {
        const core = scenario.inspectFoundationGrowth().cores[3];
        assert(core.parent === 2 && core.x - scenario.inspectFoundationGrowth().cores[2].x >= 12,
          'fourth military core did not branch from the last descendant with military spacing');
      } else assert(entry.building.width === width + 2 &&
        scenario.plan.slice(planLength).every((cell) => cell.x > oldRight),
        'non-core military upgrade did not widen by two columns or rewrote older roof spans');
      assert(city.inspectMilitary().placements.every((device) => device.owner !== added.index),
        'military preview remained active during expansion');
      assert(!city.levelUpMilitary(added.index).ok, 'unfinished military expansion accepted another level');
      city.verify();
    }
    assert(scenario.inspectCore().surviving === 36 && originalCores.every((cell) =>
      city.world.at(cell.x, cell.y) === PARTICLE_BARRIER) &&
      neighborPlans === JSON.stringify(city.entries.slice(0, 3).map((entry) => entry.scenario.plan)) &&
      !city.levelUpMilitary(added.index).ok && !city.levelUpPopulation(added.index).ok,
      'military expansion moved original cores, changed neighboring plans or exceeded level/type limits');
    const before = JSON.stringify(city.world.snapshot());
    const defenses = city.inspectMilitary();
    assert(defenses.mode === 'lab-only-placement' && defenses.combat === false && defenses.placements.length > 0 &&
      JSON.stringify(city.world.snapshot()) === before, 'finished military inspection altered world or claimed combat');
    city.verify();
  });
  check('production and ammunition HM issues stay inside the shared HM ledger', () => {
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array.from({ length: 400 }, (_, x) => x < 10 ? 388 : null),
      tunnels: [] }, { seedGrowth: true });
    const added = city.addSeed(249, false, { type: 'military', level: 1 });
    assert(added.ok, 'production ledger fixture rejected');
    const scenario = city.entries[added.index].scenario, before = scenario.hm;
    assert(scenario.issueHM(12) && scenario.hm === before - 12 && scenario.issued === 12,
      'issued HM did not leave the building stock');
    assert(!scenario.issueHM(before) && scenario.hm === before - 12, 'unaffordable HM issue changed the stock');
    city.verify();
  });
  check('military blocked upgrades reject atomically without overwriting neighbors or water', () => {
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights: Array(400).fill(400), waterLevels: Array.from({ length: 400 }, (_, x) => x < 10 ? 388 : null),
      tunnels: [] }, { seedGrowth: true });
    const added = city.addSeed(249, false, { type: 'military', level: 1 });
    assert(added.ok, 'blocked military fixture rejected');
    const entry = city.entries[added.index];
    for (let tick = 0; tick < 18000 && !entry.scenario.finished; tick += 1) city.step();
    assert(entry.scenario.finished, 'blocked military fixture did not finish');
    const x = Math.max(...entry.scenario.plan.map((cell) => cell.x)) + 1;
    const y = Math.min(...entry.scenario.plan.map((cell) => cell.y));
    const neighbor = { scenario: { plan: [{ x, y }] }, basementCells: [] };
    city.entries.push(neighbor);
    const snapshot = JSON.stringify(city.world.snapshot()), building = JSON.stringify(entry.building);
    const plan = JSON.stringify(entry.scenario.plan);
    // Reservation-only neighbor isolates ownership validation without issuing physical material.
    neighbor.scenario.spent = 0; neighbor.scenario.hm = 1000; neighbor.scenario.initialHM = 1000;
    neighbor.scenario.freeMaterial = 0; neighbor.scenario.transportedMaterialCount = 0;
    assert(!city.levelUpMilitary(added.index).ok && JSON.stringify(city.world.snapshot()) === snapshot &&
      JSON.stringify(entry.building) === building && JSON.stringify(entry.scenario.plan) === plan,
      'neighbor reservation was overwritten or rejected upgrade changed state');
    city.entries.pop();
    const flooded = city.world.snapshot(), waterCell = flooded.cells.indexOf(PARTICLE_WATER);
    assert(waterCell >= 0, 'military obstruction fixture has no conserved water');
    flooded.cells[waterCell] = PARTICLE_EMPTY; flooded.cells[y * city.world.width + x] = PARTICLE_WATER;
    city.world.restore(flooded);
    const wet = JSON.stringify(city.world.snapshot());
    assert(!city.levelUpMilitary(added.index).ok && JSON.stringify(city.world.snapshot()) === wet &&
      JSON.stringify(entry.building) === building && JSON.stringify(entry.scenario.plan) === plan,
      'flooded annex was overwritten or rejected upgrade changed state');
    city.world.restore(JSON.parse(snapshot));
    city.world.set(x, y, PARTICLE_TERRAIN);
    const blocked = JSON.stringify(city.world.snapshot());
    assert(!city.levelUpMilitary(added.index).ok && JSON.stringify(city.world.snapshot()) === blocked &&
      JSON.stringify(entry.building) === building && JSON.stringify(entry.scenario.plan) === plan,
      'occupied annex was overwritten or changed state');
    city.world.excavate(x, y, x, y);
    city.verify();
  });
  check('military defense placements share neighboring rooftops deterministically without physical writes', () => {
    const world = createParticleWorld(240, 90);
    const entries = [];
    function host(type, left, right, level = 1) {
      const plan = Array.from({ length: right - left + 1 }, (_, dx) => ({ x: left + dx, y: 60 }));
      entries.push({ building: { type, level }, scenario: { plan, finished: true, coreDestroyed: false } });
      return entries.length - 1;
    }
    host('military', 20, 64, 7);
    host('population', 75, 105);
    host('farm', 115, 139);
    host('military', 150, 194, 7);
    const snapshot = world.snapshot();
    for (const entry of entries) for (const cell of entry.scenario.plan) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
    world.restore(snapshot);
    const model = createPixelCityMilitary(world, entries), before = JSON.stringify(world.snapshot());
    const inspection = model.inspect();
    const deterministic = JSON.stringify(inspection);
    assert(inspection.combat === false && inspection.placements.length > 0 &&
      [0, 1, 2].every((index) => ['turret', 'guard', 'missile-launcher', 'interceptor'].every((type) =>
        inspection.placements.some((device) => device.owner === 0 && device.host === index && device.type === type))),
      'military base failed to place all four defense types on itself, population and farm');
    const allCells = inspection.placements.flatMap((device) => device.cells.map((cell) => cell.y * world.width + cell.x));
    assert(new Set(allCells).size === allCells.length && inspection.placements.every((device) =>
      device.anchors.every((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER) &&
      device.cells.every((cell) => world.at(cell.x, cell.y) === PARTICLE_EMPTY)) &&
      JSON.stringify(model.inspect()) === JSON.stringify(inspection) && JSON.stringify(world.snapshot()) === before,
      'defense placements overlap, lack support, mutate physics or vary nondeterministically');
    inspection.placements[0].cells[0].x = 0; inspection.bases[0].hosts[0].missing.push({ type: 'bad' });
    assert(JSON.stringify(model.inspect()) === deterministic && JSON.stringify(world.snapshot()) === before,
      'inspection exposed persistent military state');
    entries[1].scenario.finished = false;
    assert(model.inspect().placements.every((device) => device.host !== 1), 'unfinished host kept defenses');
    entries[1].scenario.finished = true;
    entries[0].scenario.coreDestroyed = true;
    assert(model.inspect().placements.every((device) => device.owner !== 0), 'dead base retained defenses');
    entries[0].scenario.coreDestroyed = false;
    const device = model.inspect().placements.find((device) => device.host === 2);
    const damaged = world.snapshot(), anchor = device.anchors[0];
    damaged.cells[anchor.y * world.width + anchor.x] = PARTICLE_EMPTY; world.restore(damaged);
    assert(model.inspect().placements.every((device) => !device.anchors.some((cell) =>
      cell.x === anchor.x && cell.y === anchor.y)), 'destroyed anchor retained a military mount');
    const obstruction = model.inspect().placements[0].cells[0];
    world.set(obstruction.x, obstruction.y, PARTICLE_WATER);
    assert(model.inspect().placements.every((device) => !device.cells.some((cell) =>
      cell.x === obstruction.x && cell.y === obstruction.y)), 'military placement concealed water');
    world.restore(snapshot);
    const canvas = document.createElement('canvas');
    canvas.width = world.width * 4; canvas.height = 360;
    const renderer = createPixelConstructionRenderer(canvas, world.width);
    renderer.draw({ world, blueprintCells: () => [] }); renderer.markMilitary(model.inspect());
    for (const [type, color] of [['turret', [239, 173, 103]], ['guard', [214, 152, 232]],
      ['missile-launcher', [241, 126, 120]], ['interceptor', [139, 217, 238]]]) {
      const device = model.inspect().placements.find((device) => device.type === type);
      const x = device.x * 4 + (type === 'guard' ? 1 : 2), y = (device.y + device.height) * 4 - (type === 'guard' ? 4 : 1);
      const pixel = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
      assert(color.every((value, index) => pixel[index] === value), `${type} overlay was not visibly distinct`);
    }
    assert(JSON.stringify(world.snapshot()) === before, 'military rendering altered the physical world');
  });
  check('military ground defenses use ordered evenly spaced level bands, overlap crops and preserve farms', () => {
    const world = createParticleWorld(600, 90);
    for (let x = 0; x < world.width; x += 1) for (let y = 60; y < 90; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const plan = Array.from({ length: 43 }, (_, dx) => ({ x: 280 + dx, y: 48 }));
    const entries = [{ building: { type: 'military', level: 1 }, scenario: { plan, finished: true, coreDestroyed: false } }];
    const snapshot = world.snapshot();
    for (const cell of plan) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
    world.restore(snapshot);
    const model = createPixelCityMilitary(world, entries), before = JSON.stringify(world.snapshot());
    const counts = [];
    for (let level = 1; level <= 7; level += 1) {
      entries[0].building.level = level;
      const inspection = model.inspect(), base = inspection.bases[0];
      const ground = inspection.placements.filter((device) => device.surface === 'ground');
      counts.push(ground.length);
      assert(base.reach === 40 + 4 * (level - 1) && base.groundSpacing === 12 - level &&
        base.neighborLimit === (level === 7 ? 4 : level >= 4 ? 3 : 2) &&
        base.ground.every((band) => band.placed === band.wanted && band.missing === 0),
        `level ${level} did not evenly fill clear ground or use level range/density/neighbor limits`);
      for (const facing of [-1, 1]) {
        const groups = ['turret', 'missile-launcher', 'interceptor', 'guard'].map((type) =>
          ground.filter((device) => device.facing === facing && device.type === type));
        assert(groups.every((group) => group.length > 0) && groups.slice(1).every((group, index) =>
          Math.max(...group.map((device) => device.distance + device.width - 1)) <
            Math.min(...groups[index].map((device) => device.distance))),
          'ground order was not turret, missile, interceptor, guard from outside inward');
        for (const group of groups) {
          const distances = group.map((device) => device.distance).sort((a, b) => a - b);
          assert(distances.slice(1).every((distance, index) => distance - distances[index] >= base.groundSpacing),
            'ground defenses ignored level-based average spacing');
        }
      }
      assert(ground.every((device) => device.host === null &&
        device.distance + device.width - 1 <= base.reach &&
        device.anchors.every((cell) => world.at(cell.x, cell.y) === PARTICLE_TERRAIN)) &&
        JSON.stringify(model.inspect()) === JSON.stringify(inspection) && JSON.stringify(world.snapshot()) === before,
        'ground range, terrain support or deterministic read-only behavior changed');
    }
    assert(counts[6] > counts[0] && counts.every((count, index) => index === 0 || count >= counts[index - 1]),
      'higher levels did not increase ground density');
    const farmPlan = Array.from({ length: 5 }, (_, dx) => ({ x: 228 + dx, y: 48 }));
    const farm = { building: { type: 'farm', level: 7, desiredSilos: 1,
      silos: [{ cells: farmPlan, capacity: 100 }] },
      scenario: { plan: farmPlan, finished: true, coreDestroyed: false },
      seedPlacement: [{ x: 229, y: 59 }, { x: 230, y: 59 }, { x: 231, y: 59 }] };
    entries.push(farm);
    const farmWorld = world.snapshot();
    for (const cell of farmPlan) farmWorld.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
    for (let x = 190; x < 200; x += 1) for (let y = 55; y < 60; y += 1) {
      farmWorld.cells[y * world.width + x] = PARTICLE_WATER;
    }
    world.restore(farmWorld);
    const farms = createPixelCityFarms(world, entries, () => 60);
    for (let tick = 0; tick < 3600; tick += 1) farms.step();
    const fields = farms.inspect(1), storage = farms.inspectStorage(), physical = JSON.stringify(world.snapshot());
    const preview = model.inspect();
    assert(fields.fields.length > 0 && preview.placements.some((device) => device.surface === 'ground' &&
      device.cells.some((cell) => fields.fields.some((field) => field.x === cell.x))),
      'ground military defenses failed to overlap logical farm crops');
    const allCells = preview.placements.flatMap((device) => device.cells.map((cell) => cell.y * world.width + cell.x));
    assert(new Set(allCells).size === allCells.length &&
      preview.placements.filter((device) => device.surface === 'ground').every((device) =>
        !device.cells.some((cell) => entries.some((entry) => entry.scenario.plan.some((part) => part.x === cell.x && part.y === cell.y)))),
      'ground defense overlapped another placement or physical structure');
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 360;
    const renderer = createPixelConstructionRenderer(canvas, world.width);
    renderer.draw({ world, blueprintCells: () => [] }); renderer.markFarm(fields); renderer.markMilitary(preview);
    assert(JSON.stringify(farms.inspect(1)) === JSON.stringify(fields) &&
      JSON.stringify(farms.inspectStorage()) === JSON.stringify(storage) && JSON.stringify(world.snapshot()) === physical,
      'ground overlap removed crops or changed farm production, SM or physical mass');
    const ground = preview.placements.find((device) => device.surface === 'ground');
    const blocked = world.snapshot(), obstacle = ground.cells[0];
    blocked.cells[obstacle.y * world.width + obstacle.x] = PARTICLE_WATER; world.restore(blocked);
    assert(model.inspect().placements.every((device) => !device.cells.some((cell) =>
      cell.x === obstacle.x && cell.y === obstacle.y)), 'ground placement concealed physical water');
    world.restore(farmWorld);
    const unsupported = model.inspect().placements.find((device) => device.surface === 'ground').anchors[0];
    world.excavate(unsupported.x, unsupported.y, unsupported.x, unsupported.y);
    assert(model.inspect().placements.every((device) => !device.anchors.some((cell) =>
      cell.x === unsupported.x && cell.y === unsupported.y)), 'ground placement retained missing terrain support');
  });
  check('military roof corners face their own outer edges and level-scaled neighbors stay bounded', () => {
    const world = createParticleWorld(400, 90), entries = [];
    for (const [index, left] of [100, 140, 180, 220, 260, 300].entries()) {
      entries.push({ building: { type: index === 0 ? 'military' : 'population', level: 7 },
        scenario: { plan: Array.from({ length: 23 }, (_, dx) => ({ x: left + dx, y: 60 })),
          finished: true, coreDestroyed: false } });
    }
    const snapshot = world.snapshot();
    for (const entry of entries) for (const cell of entry.scenario.plan) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
    world.restore(snapshot);
    const model = createPixelCityMilitary(world, entries);
    for (const [level, limit] of [[1, 2], [4, 3], [7, 4]]) {
      entries[0].building.level = level;
      // Keep four neighbors inside every level's range to isolate the neighbor cap.
      for (let i = 1; i < entries.length; i += 1) {
        const left = 124 + (i - 1) * 3;
        entries[i].scenario.plan = [{ x: left, y: 60 }];
      }
      assert(model.inspect().bases[0].hosts.length === limit + 1,
        'neighbor limit did not increase at levels 4 and 7');
    }
    entries.splice(1);
    const inspection = model.inspect(), corners = inspection.placements.filter((device) => device.corner);
    assert(corners.length === 2 && corners[0].x === 100 && corners[0].facing === -1 &&
      corners[1].x === 120 && corners[1].facing === 1, 'turrets were not attached to outward-facing roof corners');
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 360;
    const renderer = createPixelConstructionRenderer(canvas, world.width);
    renderer.draw({ world, blueprintCells: () => [] }); renderer.markMilitary(inspection);
    for (const turret of corners) {
      const ctx = canvas.getContext('2d');
      const outward = ctx.getImageData(turret.x * 4 + (turret.facing < 0 ? 1 : 10), turret.y * 4 + 1, 1, 1).data;
      const inward = ctx.getImageData(turret.x * 4 + (turret.facing < 0 ? 10 : 1), turret.y * 4 + 1, 1, 1).data;
      assert(outward[0] > inward[0] && outward[0] > 100, 'turret barrel did not visibly point toward its roof edge');
    }
  });
  check('military ground multi-base previews stay unique across damage, water, slopes and crop-edge truncation', () => {
    const world = createParticleWorld(420, 100), entries = [];
    for (let x = 0; x < world.width; x += 1) {
      const row = 70 + x % 3;
      for (let y = row; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    }
    const snapshot = world.snapshot();
    for (const [owner, left] of [8, 120, 195, 370].entries()) {
      const plan = Array.from({ length: 30 }, (_, dx) => ({ x: left + dx, y: 50 }));
      entries.push({ building: { type: 'military', level: 7 }, scenario: { plan, finished: true, coreDestroyed: false } });
      for (const cell of plan) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
    }
    for (let x = 160; x < 180; x += 1) for (let y = 66; y < 70; y += 1) snapshot.cells[y * world.width + x] = PARTICLE_WATER;
    snapshot.cells[65 * world.width + 105] = PARTICLE_DEBRIS;
    snapshot.cells[65 * world.width + 310] = PARTICLE_CONSTRUCTION;
    world.restore(snapshot);
    const model = createPixelCityMilitary(world, entries), before = JSON.stringify(world.snapshot());
    const first = model.inspect(), expected = JSON.stringify(first);
    const validate = (inspection) => {
      const cells = inspection.placements.flatMap((device) => device.cells.map((cell) => cell.y * world.width + cell.x));
      assert(new Set(cells).size === cells.length, 'bases claimed duplicate ground/roof slots');
      assert(inspection.placements.every((device) =>
        device.cells.every((cell) => cell.x >= 0 && cell.x < world.width && cell.y >= 0 &&
          world.at(cell.x, cell.y) === PARTICLE_EMPTY) &&
        device.anchors.every((cell) => world.at(cell.x, cell.y) === (device.surface === 'ground' ? PARTICLE_TERRAIN : PARTICLE_BARRIER))),
        'multi-base placement hid physical material or lacked intact anchors');
      assert(JSON.stringify(world.snapshot()) === before, 'military inspection changed water, structures or terrain');
    };
    validate(first);
    assert(first.bases.some((base) => base.ground.some((band) => band.missing > 0)) &&
      first.placements.filter((device) => device.surface === 'ground').length > 0,
      'crop-edge/obstruction fixture did not expose explicit partial placement');
    first.placements[0].anchors[0].x = 0; first.bases[0].ground[0].wanted = 999;
    assert(JSON.stringify(model.inspect()) === expected, 'multi-base inspection exposed mutable placement state');
    entries[1].scenario.coreDestroyed = true;
    const dead = model.inspect(); validate(dead);
    assert(dead.placements.every((device) => device.owner !== 1), 'dead owner retained any ground or roof devices');
    entries[1].scenario.coreDestroyed = false;
    entries[2].scenario.finished = false;
    const unfinished = model.inspect(); validate(unfinished);
    assert(unfinished.placements.every((device) => device.owner !== 2), 'unfinished owner spawned ground defenses');
    entries[2].scenario.finished = true;
    assert(JSON.stringify(model.inspect()) === expected, 'restoring eligible bases failed deterministic slot restoration');
  });
  check('military deterministic demo builds actual silo defense integration with unchanged HM and SM storage', () => {
    const city = createPixelMilitaryDemoCity();
    assert(city.entries.length === 6 && city.world.width === 500 && city.inspectMilitary().placements.length === 0 &&
      city.entries.every(({ scenario }) => scenario.spent === 0 && scenario.ticks === 0),
      'military demo spawned paid construction or skipped gradual seed growth');
    for (let tick = 0; tick < 18000 && city.entries.some(({ scenario }) => !scenario.finished); tick += 1) city.step();
    assert(city.entries.every(({ scenario }) => scenario.finished && !scenario.coreDestroyed) &&
      city.world.debrisCount === 0 && city.world.structuralLoad.failed === 0,
      'military demo failed stable physical construction');
    const before = JSON.stringify(city.world.snapshot()), budgets = city.entries.map(({ scenario }) => scenario.hm);
    const storage = JSON.stringify(city.inspectSMStorage()), farm = JSON.stringify(city.inspectFarm(5));
    const military = city.inspectMilitary();
    const totalPlacements = military.placements.length;
    assert(totalPlacements >= 23 && military.bases[0].hosts.length === 3 &&
      [3, 4, 5].every((host) => ['interceptor', 'missile-launcher', 'turret', 'guard'].every((type) =>
        military.placements.some((device) => device.host === host && device.type === type))),
      'real population/silo geometry did not support all four defense types');
    assert(military.placements.some((device) => device.host === 5 &&
      device.anchors.some((anchor) => anchor.y > device.y + device.height)), 'silo caps did not use stepped mounting legs');
    const canvas = document.createElement('canvas');
    canvas.width = city.world.width * 4; canvas.height = 360;
    const renderer = createPixelConstructionRenderer(canvas, city.world.width);
    renderer.draw({ world: city.world, blueprintCells: () => [] }); renderer.markMilitary(military);
    assert(JSON.stringify(city.world.snapshot()) === before &&
      JSON.stringify(city.entries.map(({ scenario }) => scenario.hm)) === JSON.stringify(budgets) &&
      JSON.stringify(city.inspectSMStorage()) === storage && JSON.stringify(city.inspectFarm(5)) === farm &&
      city.inspectSMStorage().capacity === 400, 'defense inspection/render changed physical ownership, HM, SM or silos');
    assert(!city.repairBuilding(3).ok, 'intact military frame accepted an unnecessary repair');
    const base = city.entries[3], scenario = base.scenario, plan = JSON.stringify(scenario.plan);
    const destroyed = city.destroyed, free = scenario.freeMaterial, hm = scenario.hm, ticks = scenario.ticks;
    const others = city.entries.filter((_, index) => index !== 3).map(({ scenario }) => scenario.hm);
    city.blastCore(3, 0);
    const damaged = JSON.stringify(city.world.snapshot()), storageBefore = JSON.stringify(city.inspectSMStorage());
    const repair = city.repairBuilding(3);
    assert(repair.ok && repair.repairPixels === city.destroyed - destroyed && scenario.hm === hm &&
      scenario.ticks === ticks && scenario.freeMaterial === free && base.building.level === 7 &&
      JSON.stringify(scenario.plan) === plan && JSON.stringify(city.world.snapshot()) === damaged &&
      JSON.stringify(city.inspectSMStorage()) === storageBefore && city.inspectMilitary().placements.length === 0,
      'manual repair changed level, plan, clocks, free material, immediate HM/SM or defense availability');
    assert(!city.repairBuilding(3).ok, 'ongoing repair accepted another repair request');
    for (let tick = 0; tick < 6000 && !scenario.finished; tick += 1) city.step();
    assert(scenario.finished && base.scenario === scenario && scenario.inspectCore().surviving === 36 &&
      scenario.hm === hm - repair.repairPixels && scenario.freeMaterial === free &&
      JSON.stringify(scenario.plan) === plan && city.inspectMilitary().placements.length === totalPlacements &&
      JSON.stringify(city.entries.filter((_, index) => index !== 3).map(({ scenario }) => scenario.hm)) === JSON.stringify(others) &&
      city.inspectSMStorage().totalSpent === 0 && city.world.debrisCount === 0,
      'manual repair failed physical completion, did not restore defenses or corrupted owner HM/materials');
    city.blastCore(5, 0);
    assert(city.inspectMilitary().placements.every((device) => device.host !== 5) &&
      city.inspectSMStorage().capacity === 0, 'dead farm retained defense mounts or silo storage');
    const stored = city.inspectSMStorage().sm;
    assert(stored > 0 && city.inspectSMStorage().overflow === stored, 'farm damage deleted stored SM rather than preserving overflow');
    assert(!city.repairBuilding(5).ok, 'manual repair revived a dead farm');
    for (let core = 0; core < 4; core += 1) city.blastCore(3, core);
    assert(city.inspectMilitary().placements.length === 0 &&
      city.inspectMilitary().bases[0].state === 'core destroyed', 'dead military base retained neighboring defenses');
    assert(!city.repairBuilding(3).ok, 'manual repair revived a dead military base');
    city.verify();
  });
  check('military limited slots and future host reservations are explicit and read-only', () => {
    const world = createParticleWorld(160, 90);
    const plan = [0, 1, 2].map((dx) => ({ x: 60 + dx, y: 60 }));
    const entries = [{ building: { type: 'military', level: 1 }, scenario: { plan, finished: true, coreDestroyed: false } }];
    const snapshot = world.snapshot();
    for (const cell of plan) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
    world.restore(snapshot);
    const model = createPixelCityMilitary(world, entries);
    const limited = model.inspect();
    assert(limited.placements.length === 1 && limited.bases[0].hosts[0].state === 'limited rooftop space' &&
      limited.placements[0].type === 'turret' && limited.placements[0].corner &&
      limited.bases[0].hosts[0].missing.some((item) => item.type === 'missile-launcher'),
      'limited rooftop silently pretended to install unavailable equipment');
    entries.push({ building: { type: 'population', level: 1 }, scenario: {
      plan: [{ x: 61, y: 59 }], finished: false, coreDestroyed: false } });
    const before = JSON.stringify(world.snapshot()), reserved = model.inspect();
    assert(reserved.placements.every((device) =>
      device.cells.every((cell) => cell.x !== 61 || cell.y !== 59)) &&
      reserved.bases[0].hosts.some((host) => host.host === 1 && host.state === 'construction pending') &&
      JSON.stringify(world.snapshot()) === before, 'military preview occupied another owner future reservation');
    entries[0].scenario.finished = false;
    assert(model.inspect().placements.length === 0, 'unfinished base kept defense placements');
  });
  check('military accepted seeds invalidate conflicting population roads before physical growth', () => {
    const heights = Array.from({ length: 600 }, (_, x) => 400 + (x % 3) * 4);
    for (const pole of [60, 80, 100, 200, 220, 240, 400, 420, 440]) {
      for (let dx = 0; dx < 3; dx += 1) heights[pole + dx] = 400;
    }
    const city = createSharedPixelMapConstruction({ width: 600, height: 160, cellSize: 4,
      heights, waterLevels: Array(600).fill(null), tunnels: [] }, { seedGrowth: true });
    assert(city.addSeed(270, false, { type: 'population', level: 1 }).ok &&
      city.addSeed(330, false, { type: 'population', level: 1 }).ok, 'military road fixtures did not fit');
    for (let tick = 0; tick < 18000 && city.entries.slice(3).some(({ scenario }) => !scenario.finished); tick += 1) city.step();
    assert(city.inspectRoads().length === 1, 'military road fixture had no connection to interrupt');
    const snapshot = JSON.stringify(city.world.snapshot()), budgets = city.entries.map(({ scenario }) => scenario.hm);
    const accepted = city.addSeed(312, false, { type: 'military', level: 1 });
    assert(accepted.ok && city.entries[accepted.index].scenario.ticks === 0 &&
      JSON.stringify(city.world.snapshot()) === snapshot && city.inspectRoads().length === 0 &&
      JSON.stringify(city.entries.slice(0, -1).map(({ scenario }) => scenario.hm)) === JSON.stringify(budgets),
      'accepted military reservation retained a conflicting road or changed host physics/budgets');
    city.step();
    assert(city.inspectRoads().length === 0, 'road reappeared across military seed growth');
    city.verify();
  });
  check('military exact terrain limits preserve four-cell cores and thirty-two-cell ranges with physical blockers', () => {
    function fixture(local, range) {
      const rows = Array.from({ length: 180 }, (_, x) => x < 90 ? 38 : x < 110 ? 54 : 38 + range);
      rows[100] += local;
      const source = { heights: rows.map((row) => row * 4) };
      const world = createParticleWorld(180, 90);
      for (let x = 0; x < 180; x += 1) for (let y = rows[x]; y < 90; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      return { world, source };
    }
    const allowed = fixture(4, 32), before = JSON.stringify(allowed.world.snapshot());
    const preview = prepareAdaptivePixelSeed(allowed.world, allowed.source, 0, 0, [], 100, { type: 'military', level: 1 });
    assert(preview.ok && Math.max(...preview.foundationRows) - Math.min(...preview.foundationRows) === 32 &&
      preview.seedPlacement.some((cell) => cell.groundY === 58) &&
      JSON.stringify(allowed.world.snapshot()) === before, 'exact military terrain limits were rejected or preview excavated terrain');
    for (const [local, range] of [[5, 32], [4, 33]]) {
      const blocked = fixture(local, range), state = JSON.stringify(blocked.world.snapshot());
      assert(!prepareAdaptivePixelSeed(blocked.world, blocked.source, 0, 0, [], 100, { type: 'military', level: 1 }).ok &&
        JSON.stringify(blocked.world.snapshot()) === state, 'military exceeded its core/range limit or changed rejected terrain');
    }
    allowed.world.set(100, 57, PARTICLE_WATER);
    assert(!prepareAdaptivePixelSeed(allowed.world, allowed.source, 0, 0, [], 100, { type: 'military', level: 1 }).ok,
      'lenient military footprint accepted water at the middle seed');
    const unsupported = fixture(4, 32);
    unsupported.world.excavate(100, 58, 100, 58);
    assert(!prepareAdaptivePixelSeed(unsupported.world, unsupported.source, 0, 0, [], 100, { type: 'military', level: 1 }).ok,
      'lenient military footprint accepted a missing core support cell');
  });
  check('military placement is more lenient than population on uneven core surfaces', () => {
    const heights = Array(400).fill(400);
    heights[248] = 408; heights[249] = 416;
    const city = createSharedPixelMapConstruction({ width: 400, height: 160, cellSize: 4,
      heights, waterLevels: Array(400).fill(null), tunnels: [] }, { seedGrowth: true });
    const military = city.addSeed(249, true, { type: 'military', level: 1 });
    const population = city.addSeed(249, true, { type: 'population', level: 1 });
    assert(military.ok && !population.ok, 'military did not accept a slope rejected by population');
    const before = JSON.stringify(city.world.snapshot());
    city.addSeed(249, true, { type: 'military', level: 1 });
    assert(JSON.stringify(city.world.snapshot()) === before, 'military slope preview mutated terrain');
  });
  const results = document.getElementById('results');
  if (!checks.length) checks.push(`FAIL no checks matched: ${selectedCheck}`);
  results.textContent = checks.join('\n');
  results.dataset.failed = String(checks.filter((line) => line.startsWith('FAIL')).length);
}());
