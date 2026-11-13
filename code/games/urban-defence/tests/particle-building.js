(function () {
  const checks = [];
  function check(name, run) {
    try { run(); checks.push(`PASS ${name}`); }
    catch (error) { checks.push(`FAIL ${name}: ${error.message}`); }
  }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  check('supported water notch beside a wall renders without a gap or changing water', () => {
    for (const direction of [-1, 1]) {
      const scenario = createParticleBuildingScenario(undefined, { minimumWallThicknessFactor: 1.5 });
      const { world, model, scale } = scenario;
      const wall = model.sections.find((s) => s.row === 7 && s.column === 0);
      const x = Math.floor((wall.x + model.size / 2) / scale);
      const y = Math.floor((wall.y + model.size / 2) / scale);
      const neighbor = x + direction;
      world.set(neighbor + direction, y, PARTICLE_WATER);
      world.set(neighbor, y + 1, PARTICLE_WATER);
      const before = JSON.stringify(scenario.snapshot());
      const canvas = document.createElement('canvas');
      canvas.width = world.width * scale; canvas.height = world.height * scale;
      const ctx = canvas.getContext('2d');
      drawParticleWaterContacts(ctx, scenario);
      const data = ctx.getImageData(neighbor * scale, y * scale, scale, scale).data;
      assert(Array.from({ length: scale * scale }, (_, i) => data[i * 4 + 3]).every((a) => a === 255),
        `supported ${direction} notch retained a gap`);
      const wallEdge = direction < 0 ? x * scale : (x + 1) * scale - 1;
      assert(ctx.getImageData(wallEdge, y * scale + 1, 1, 1).data[3] > 0,
        'notch did not reach wall edge');
      assert(JSON.stringify(scenario.snapshot()) === before && world.waterCount === 222,
        'rendering modified or created water particles');
    }
  });
  check('water notch smoothing does not fill unsupported or obstructed cells', () => {
    for (const condition of ['unsupported', 'diagonal', 'terrain']) {
      const scenario = createParticleBuildingScenario(undefined, { minimumWallThicknessFactor: 1.5 });
      const { world, model, scale } = scenario;
      const wall = model.sections.find((s) => s.row === 7 && s.column === 0);
      const x = Math.floor((wall.x + model.size / 2) / scale);
      const y = Math.floor((wall.y + model.size / 2) / scale);
      world.set(x - 2, y - (condition === 'diagonal' ? 1 : 0), PARTICLE_WATER);
      if (condition !== 'unsupported') world.set(x - 1, y + 1, PARTICLE_WATER);
      if (condition === 'terrain') world.set(x - 1, y, PARTICLE_TERRAIN);
      const canvas = document.createElement('canvas');
      canvas.width = world.width * scale; canvas.height = world.height * scale;
      const ctx = canvas.getContext('2d');
      drawParticleWaterContacts(ctx, scenario);
      assert(ctx.getImageData((x - 1) * scale + 1, y * scale + 1, 1, 1).data[3] === 0,
        `${condition} gap was incorrectly filled`);
    }
  });
  check('water can flow under the bottom beam up to the vertical wall', () => {
    const scenario = createParticleBuildingScenario(undefined, { minimumWallThicknessFactor: 1.5 });
    const { world } = scenario;
    for (const [x, y] of [[57, 72], [57, 73], [58, 73], [59, 73]]) {
      world.set(x, y, PARTICLE_TERRAIN);
    }
    world.set(58, 72, PARTICLE_WATER);
    scenario.step();
    assert(world.at(59, 72) === PARTICLE_WATER && world.at(60, 72) !== PARTICLE_WATER &&
      world.waterCount === 221, 'bottom beam blocked the open space or water crossed the upright wall');
  });
  check('thicker walls retain water until blasted at every construction height', () => {
    for (const rows of [5, 9, 11]) {
      const scenario = createParticleBuildingScenario(undefined, { rows, minimumWallThicknessFactor: 1.5 });
      const { world } = scenario, x = scenario.anchorColumns[0];
      scenario.breachBasin();
      for (let i = 0; i < 300; i += 1) scenario.step();
      assert(world.countWater(x - 1, 73, x - 1, 74) > 0 &&
        world.countWater(x + 1, 0, world.width - 1, world.height - 1) === 0,
      `${rows}-row wall did not hold adjacent water`);
      assert(scenario.blastLeftWall(), `${rows}-row wall did not detach`);
      for (let i = 0; i < 300; i += 1) scenario.step();
      assert(world.countWater(x + 1, 0, world.width - 1, world.height - 1) > 0 &&
        world.waterCount === 220, `${rows}-row breach blocked or lost water`);
    }
  });
  check('water contact rendering reaches upright walls and floors without changing particles', () => {
    const scenario = createParticleBuildingScenario(undefined, { minimumWallThicknessFactor: 1.5 });
    const { world, model } = scenario;
    const wall = model.sections.find((s) => s.row === 7 && s.column === 0);
    const floor = model.sections.find((s) => s.row === 6 && s.column === 1);
    assert(model.wallThickness > model.thickness, 'vertical support is not thicker');
    const x = Math.floor((wall.x + model.size / 2) / scenario.scale);
    const y = Math.floor((wall.y + model.size / 2) / scenario.scale);
    const fx = Math.floor((floor.x + model.size / 2) / scenario.scale);
    const fy = Math.floor((floor.y + model.size / 2) / scenario.scale);
    world.set(x - 1, y, PARTICLE_WATER);
    world.set(fx, fy - 1, PARTICLE_WATER);
    const before = JSON.stringify(scenario.snapshot());
    const canvas = document.createElement('canvas');
    canvas.width = world.width * scenario.scale;
    canvas.height = world.height * scenario.scale;
    const ctx = canvas.getContext('2d');
    drawParticleWaterContacts(ctx, scenario);
    const alpha = (px, py) => ctx.getImageData(px, py, 1, 1).data[3];
    assert(alpha(x * scenario.scale, y * scenario.scale + 1) > 0 &&
      alpha(fx * scenario.scale + 1, fy * scenario.scale) > 0,
    'water did not reach a wall or floor edge');
    assert(alpha((x + 1) * scenario.scale - 1, y * scenario.scale + 1) === 0 &&
      alpha(fx * scenario.scale + 1, (fy + 1) * scenario.scale - 1) === 0,
    'contact fill crossed a member without water on the other side');
    assert(JSON.stringify(scenario.snapshot()) === before, 'contact rendering changed simulation state');
    const old = scenario.snapshot();
    delete old.waterBlocksAttached;
    const throughWalls = createParticleBuildingScenario(old, { minimumWallThicknessFactor: 1.5 });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawParticleWaterContacts(ctx, throughWalls);
    assert(alpha(x * scenario.scale, y * scenario.scale + 1) === 0,
      'contact fill appeared with attached water blocking disabled');
  });
  check('water contact rendering does not cross solids or bridge diagonals', () => {
    function alphaFor(terrain, diagonal) {
      const scenario = createParticleBuildingScenario(undefined, { minimumWallThicknessFactor: 1.5 });
      const { world, model, scale } = scenario;
      const wall = model.sections.find((s) => s.row === 7 && s.column === 0);
      const x = Math.floor((wall.x + model.size / 2) / scale);
      const y = Math.floor((wall.y + model.size / 2) / scale);
      world.set(x - 1, y - (diagonal ? 1 : 0), PARTICLE_WATER);
      if (terrain) world.set(x, y, PARTICLE_TERRAIN);
      const canvas = document.createElement('canvas');
      canvas.width = world.width * scale; canvas.height = world.height * scale;
      const ctx = canvas.getContext('2d');
      drawParticleWaterContacts(ctx, scenario);
      return ctx.getImageData(x * scale, y * scale + 1, 1, 1).data[3];
    }
    assert(alphaFor(true, false) === 0 && alphaFor(false, true) === 0,
      'contact fill crossed terrain or joined diagonal water');
  });
  check('water damage scales with depth and does not affect dry members', () => {
    function scene(depth, enabled) {
      const scenario = createParticleBuildingScenario();
      const base = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
      const x = scenario.anchorColumns[1] - 1;
      for (let y = 74; y > 74 - depth; y -= 1) scenario.world.set(x, y, PARTICLE_WATER);
      scenario.setWaterDamageEnabled(enabled);
      scenario.step();
      return { scenario, base };
    }
    const dry = scene(0, true), shallow = scene(1, true), deep = scene(5, true), disabled = scene(5, false);
    const shallowDamage = 100 - shallow.base.health;
    const deepDamage = 100 - deep.base.health;
    assert(dry.base.health === 100 && disabled.base.health === 100, 'dry or disabled damage changed health');
    assert(Math.abs(shallowDamage - 0.4 / 60) < 1e-9 &&
      Math.abs(deepDamage - 5 * 0.4 / 60) < 1e-9, 'damage did not scale with water depth');
    assert(deep.scenario.world.waterCount === 225, 'damage changed water count');
  });
  check('water damage requires unobstructed edge contact, not a diagonal', () => {
    function damageAt(x, y, solid) {
      const scenario = createParticleBuildingScenario();
      const slab = scenario.model.sections.find((s) => s.row === 0 && s.column === 1);
      slab.x = 400; slab.y = 101;
      slab.previousX = slab.x; slab.previousY = slab.y;
      if (solid) {
        const state = scenario.world.snapshot();
        state.cells[28 * scenario.world.width + 100] = solid;
        scenario.world.restore(state);
      }
      scenario.world.set(x, y, PARTICLE_WATER);
      scenario.setWaterDamageEnabled(true);
      scenario.step();
      return 100 - slab.health;
    }
    assert(damageAt(101, 28, false) > 0, 'overlapping water did not damage the slab');
    assert(damageAt(99, 28, false) > 0, 'water across an open edge did not damage the slab');
    for (const material of [PARTICLE_TERRAIN, PARTICLE_BARRIER, PARTICLE_DEBRIS]) {
      assert(damageAt(99, 28, material) === 0, `water damaged the slab through material ${material}`);
    }
    assert(damageAt(99, 27, false) === 0, 'diagonal water damaged the slab');
  });
  check('water damage uses continuous depth and the deepest contact only', () => {
    function measure(columns) {
      const scenario = createParticleBuildingScenario();
      const base = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
      for (const [offset, rows] of columns) {
        for (const y of rows) scenario.world.set(scenario.anchorColumns[1] + offset, y, PARTICLE_WATER);
      }
      scenario.setWaterDamageEnabled(true);
      scenario.step();
      return 100 - base.health;
    }
    const two = measure([[-1, [73, 74]]]);
    const broken = measure([[-1, [70, 71, 73, 74]]]);
    const both = measure([[-1, [73, 74]], [1, [73, 74]]]);
    assert(Math.abs(two - 0.8 / 60) < 1e-9 &&
      Math.abs(broken - two) < 1e-9 && Math.abs(both - two) < 1e-9,
      'disconnected columns or multiple contacts inflated damage');
  });
  check('cached water depths match direct scans during flooding and restore', () => {
    const optimized = createParticleBuildingScenario();
    const snapshot = optimized.world.snapshot();
    for (let x = 56; x <= 85; x += 1) {
      for (let y = 35; y < 75; y += 1) {
        if ((x * 7 + y * 11) % 17 !== 0) snapshot.cells[y * optimized.world.width + x] = PARTICLE_WATER;
      }
    }
    optimized.world.restore(snapshot);
    optimized.setWaterDamageEnabled(true);
    let reference = createParticleBuildingScenario(JSON.parse(JSON.stringify(optimized.snapshot())));
    reference.setWaterDamageEnabled(false);
    function directDamage(scenario) {
      const { world, model, scale } = scenario;
      const entries = [];
      for (const section of model.sections) {
        if (!section.attached) continue;
        const bounds = model.sectionBounds(section);
        const minX = Math.max(0, Math.floor(bounds.left / scale) - 1);
        const maxX = Math.min(world.width - 1, Math.floor(bounds.right / scale) + 1);
        const minY = Math.max(0, Math.floor(bounds.top / scale) - 1);
        const maxY = Math.min(world.height - 1, Math.floor(bounds.bottom / scale) + 1);
        let depth = 0;
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            if (world.at(x, y) !== PARTICLE_WATER) continue;
            let contact = model.touchesRect(section, x * scale, y * scale, scale, scale);
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
              if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height) continue;
              const material = world.at(nx, ny);
              if ((material === PARTICLE_EMPTY || material === PARTICLE_WATER) &&
                  model.touchesRect(section, nx * scale, ny * scale, scale, scale)) contact = true;
            }
            if (!contact) continue;
            let count = 1;
            while (y - count >= 0 && world.at(x, y - count) === PARTICLE_WATER) count += 1;
            depth = Math.max(depth, count);
          }
        }
        if (depth) entries.push({ section, amount: depth * 0.4 / 60 });
      }
      model.damageAttached(entries);
    }
    for (let i = 0; i < 40; i += 1) {
      if (i === 20) {
        optimized.world.restore(JSON.parse(JSON.stringify(optimized.world.snapshot())));
        reference = createParticleBuildingScenario(JSON.parse(JSON.stringify(reference.snapshot())));
      }
      directDamage(reference);
      optimized.step();
      reference.step();
      assert(JSON.stringify(optimized.model.saveState()) === JSON.stringify(reference.model.saveState()) &&
        JSON.stringify(optimized.world.snapshot()) === JSON.stringify(reference.world.snapshot()),
        `cached damage diverged from direct scan at step ${i}`);
    }
  });
  check('released basin water gradually damages the intact wall', () => {
    const scenario = createParticleBuildingScenario();
    scenario.setWaterDamageEnabled(true);
    scenario.breachBasin();
    for (let i = 0; i < 300; i += 1) scenario.step();
    const wall = scenario.model.sections.find((s) => s.row === 8 && s.column === 0);
    assert(wall.attached && wall.health < 98 && scenario.world.waterCount === 220,
      'basin water did not damage the wall while conserving water');
  });
  check('water damage breaks a weakened support and repair needs a dry site', () => {
    const scenario = createParticleBuildingScenario();
    const base = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
    base.health = 0.001;
    const x = scenario.anchorColumns[1];
    scenario.world.set(x, 70, PARTICLE_WATER);
    scenario.setWaterDamageEnabled(true);
    scenario.step();
    assert(!base.attached && !base.anchored && scenario.model.fragments.includes(base),
      'water did not detach the weakened support');
    base.x = 500; base.y = 20;
    scenario.repair();
    assert(!base.attached, 'wet support site was repaired');
    const state = scenario.world.snapshot();
    for (let i = 0; i < state.cells.length; i += 1) {
      if (state.cells[i] === PARTICLE_WATER && i % scenario.world.width > 35) state.cells[i] = PARTICLE_EMPTY;
    }
    scenario.world.restore(state);
    let spent = 0;
    for (let i = 0; i < 10 && !base.attached; i += 1) spent += scenario.repair().spent;
    assert(spent > 0 && base.attached && base.health === 100,
      'dry support could not be repaired');
  });
  check('water damage mode and damage restore deterministically and old saves stay off', () => {
    const scenario = createParticleBuildingScenario();
    const x = scenario.anchorColumns[1] - 1;
    for (let y = 70; y <= 74; y += 1) scenario.world.set(x, y, PARTICLE_WATER);
    scenario.setWaterDamageEnabled(true);
    scenario.step();
    let restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(scenario.snapshot())));
    assert(restored.waterDamageEnabled, 'water damage mode did not restore');
    for (let i = 0; i < 20; i += 1) {
      scenario.step(); restored.step();
      assert(JSON.stringify(scenario.snapshot()) === JSON.stringify(restored.snapshot()),
        `water damage diverged after restore at ${i}`);
    }
    const old = scenario.snapshot();
    delete old.waterDamageEnabled;
    assert(!createParticleBuildingScenario(old).waterDamageEnabled, 'old save enabled water damage');
    old.waterDamageEnabled = 'true';
    let failed = false;
    try { createParticleBuildingScenario(old); } catch (error) { failed = true; }
    assert(failed, 'invalid water damage mode accepted');
  });
  check('structural damage validates atomically and thicker walls resist damage', () => {
    const model = createCollapseModel();
    const section = model.sections.find((s) => s.anchored);
    const before = JSON.stringify(model.saveState());
    let failed = false;
    try { model.damageAttached([{ section, amount: 10 }, { section, amount: NaN }]); }
    catch (error) { failed = true; }
    assert(failed && before === JSON.stringify(model.saveState()), 'invalid batch changed structure');
    const tall = createCollapseModel({ rows: 11 });
    const thick = tall.sections.find((s) => s.anchored);
    model.damageAttached([{ section, amount: 10 }]);
    tall.damageAttached([{ section: thick, amount: 10 }]);
    assert(section.health === 90 && thick.health === 95, 'thick wall resistance was not applied');
  });
  check('intact particle terrain supports all anchors', () => {
    const scenario = createParticleBuildingScenario();
    for (let i = 0; i < 30; i += 1) scenario.step();
    assert(scenario.model.sections.filter((section) => section.anchored).length === 3, 'intact anchors were released');
    assert(scenario.model.fragments.length === 0, 'intact frame collapsed');
  });
  check('removing one footprint releases only its anchor', () => {
    const scenario = createParticleBuildingScenario();
    assert(scenario.undermine(1) === 121, 'expected terrain was not excavated');
    assert(scenario.step() === 1, 'lost anchor not detected');
    assert(scenario.model.sections.filter((section) => section.anchored).length === 2, 'other anchors were released');
    assert(scenario.step() === 0, 'anchor released twice');
  });
  check('foundation display tracks ground and anchor independently without changing state', () => {
    const scenario = createParticleBuildingScenario();
    const before = JSON.stringify(scenario.snapshot());
    const initial = scenario.foundationStatus();
    assert(initial.length === 3 && initial.every((site) => site.groundPresent && site.anchored),
      'intact foundations were reported incorrectly');
    assert(JSON.stringify(scenario.snapshot()) === before, 'inspection changed the simulation');
    scenario.undermine(1);
    let middle = scenario.foundationStatus()[1];
    assert(!middle.groundPresent && middle.anchored, 'pending support update not represented');
    scenario.step();
    middle = scenario.foundationStatus()[1];
    assert(!middle.groundPresent && !middle.anchored, 'released anchor not represented');
    const base = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
    base.x = 500; base.y = 20;
    assert(scenario.restoreGround(1).ok, 'failed to restore foundation');
    middle = scenario.foundationStatus()[1];
    assert(middle.groundPresent && !middle.anchored, 'restored ground implied automatic anchoring');
    const restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(scenario.snapshot())));
    assert(JSON.stringify(restored.foundationStatus()) === JSON.stringify(scenario.foundationStatus()),
      'foundation display changed after load');
    let spent = 0;
    for (let i = 0; i < 10 && !restored.foundationStatus()[1].anchored; i += 1) {
      spent += restored.repair().spent;
    }
    assert(spent > 0 && restored.foundationStatus()[1].anchored,
      'repaired anchor was not shown as anchored');
    const repairedSnapshot = JSON.stringify(restored.snapshot());
    restored.foundationStatus();
    assert(JSON.stringify(restored.snapshot()) === repairedSnapshot, 'inspection changed repaired state');
  });
  check('removing all footprints releases the connected frame', () => {
    const scenario = createParticleBuildingScenario();
    for (let i = 0; i < 3; i += 1) scenario.undermine(i);
    assert(scenario.step() === 3, 'not all anchors were released');
    assert(scenario.model.sections.every((section) => !section.attached), 'unsupported frame remained attached');
  });
  check('repair waits for foundation and resumes after clear ground is restored', () => {
    const scenario = createParticleBuildingScenario();
    const base = scenario.model.sections.find((s) => s.anchored && s.column === 3);
    scenario.undermine(1);
    scenario.model.updateFoundationSupport((section) => section.column !== 3);
    base.x = 500; base.y = 20;
    const before = scenario.hm;
    const blocked = scenario.repair();
    assert(blocked.state === 'Blocked' && blocked.siteBlockers.includes('missing foundation') &&
      scenario.hm === before && !base.attached,
      'unsupported foundation was repaired or charged');
    const fill = scenario.restoreGround(1);
    assert(fill.ok && fill.placed === 121, 'ground was not restored');
    const result = scenario.repair();
    assert(result.spent === scenario.model.repairCost && scenario.hm === before - result.spent &&
      base.attached && base.anchored, 'supported foundation did not repair correctly');
    scenario.step();
    assert(base.anchored, 'repaired anchor did not stay supported');
  });
  check('wet repair site and occupied ground restoration do not spend or destroy water', () => {
    const scenario = createParticleBuildingScenario();
    const base = scenario.model.sections.find((s) => s.anchored && s.column === 3);
    scenario.undermine(1);
    scenario.model.updateFoundationSupport((section) => section.column !== 3);
    base.x = 500; base.y = 20;
    const x = scenario.anchorColumns[1];
    scenario.world.set(x, scenario.surfaceRow, PARTICLE_WATER);
    const before = scenario.world.snapshot();
    assert(!scenario.restoreGround(1).ok &&
      JSON.stringify(scenario.world.snapshot()) === JSON.stringify(before), 'ground restoration overwrote water');
    assert(scenario.repair().state === 'Blocked' && scenario.hm === 200, 'wet unsupported repair charged HM');
    const dry = createParticleBuildingScenario();
    const dryBase = dry.model.sections.find((s) => s.anchored && s.column === 3);
    dry.model.blast(dryBase.x + 13, dryBase.y + 13, 1, 150);
    dryBase.x = 500; dryBase.y = 20;
    const waterX = dry.anchorColumns[1];
    dry.world.set(waterX, 70, PARTICLE_WATER);
    const count = dry.world.waterCount;
    const result = dry.repair();
    assert(result.state === 'Blocked' && result.siteBlockers.includes('water') && result.spent === 0 && dry.hm === 200 &&
      dry.world.waterCount === count && !dryBase.attached, 'wet wall site was repaired or water was lost');
  });
  check('restoring an undermined site cannot overwrite a building member', () => {
    const scenario = createParticleBuildingScenario();
    const base = scenario.model.sections.find((s) => s.anchored && s.column === 3);
    scenario.undermine(1);
    scenario.step();
    base.x = scenario.anchorColumns[1] * scenario.scale - scenario.model.size / 2;
    base.y = scenario.surfaceRow * scenario.scale;
    const before = scenario.world.snapshot();
    assert(!scenario.restoreGround(1).ok && JSON.stringify(scenario.world.snapshot()) === JSON.stringify(before),
      'restoration overlapped a loose member');
  });
  check('restored lab retains all anchor controls and spent repair resources', () => {
    const scenario = createParticleBuildingScenario();
    const base = scenario.model.sections.find((s) => s.anchored && s.column === 3);
    scenario.undermine(1); scenario.step();
    base.x = 500; base.y = 20;
    const pending = createParticleBuildingScenario(JSON.parse(JSON.stringify(scenario.snapshot())));
    assert(pending.anchorColumns.length === 3, 'lost anchor changed the available controls');
    assert(pending.restoreGround(1).ok && pending.repair().spent > 0, 'restored scene could not repair');
    const restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(pending.snapshot())));
    assert(restored.hm === pending.hm && restored.anchorColumns.length === 3, 'resources or controls changed on load');
  });
  check('repair respects resource limits and older combined saves', () => {
    const scenario = createParticleBuildingScenario();
    const base = scenario.model.sections.find((s) => s.anchored && s.column === 3);
    scenario.undermine(1);
    scenario.model.updateFoundationSupport((section) => section.column !== 3);
    base.x = 500; base.y = 20;
    assert(scenario.restoreGround(1).ok, 'could not prepare foundation');
    const state = scenario.snapshot();
    state.hm = 0;
    const noFunds = createParticleBuildingScenario(state);
    assert(noFunds.repair().state === 'Waiting for HM' && noFunds.hm === 0, 'repair ignored resource limit');
    delete state.hm;
    const old = createParticleBuildingScenario(state);
    assert(old.hm === 200, 'older lab save did not retain default lab resources');
  });
  check('terrain and particle debris also block a wall repair site', () => {
    for (const material of [PARTICLE_TERRAIN, PARTICLE_DEBRIS]) {
      const scenario = createParticleBuildingScenario();
      const base = scenario.model.sections.find((s) => s.anchored && s.column === 3);
      scenario.model.blast(base.x + 13, base.y + 13, 1, 150);
      base.x = 500; base.y = 20;
      const snapshot = scenario.world.snapshot();
      snapshot.cells[70 * scenario.world.width + scenario.anchorColumns[1]] = material;
      scenario.world.restore(snapshot);
      const result = scenario.repair();
      assert(result.state === 'Blocked' &&
        result.siteBlockers.includes(material === PARTICLE_TERRAIN ? 'terrain' : 'particle debris') &&
        result.spent === 0 && !base.attached,
        `material ${material} failed to block repair`);
    }
  });
  check('water blocks repairs to damaged attached members as well as detached ones', () => {
    const scenario = createParticleBuildingScenario();
    const slab = scenario.model.sections.find((s) => s.row === 0 && s.column === 1);
    const centerX = slab.x + scenario.model.size / 2;
    const centerY = slab.y + scenario.model.size / 2;
    scenario.model.blast(centerX, centerY, 1, 30);
    assert(slab.attached && slab.health < 100, 'slab was not damaged in place');
    scenario.world.set(Math.floor(centerX / scenario.scale), Math.floor(centerY / scenario.scale), PARTICLE_WATER);
    const water = scenario.world.waterCount;
    const result = scenario.repair();
    assert(result.state === 'Blocked' && result.siteBlockers.includes('water') && result.spent === 0 && slab.health < 100 &&
      scenario.world.waterCount === water, 'wet attached slab was repaired or water was lost');
  });
  check('repair reports blockers only when no other site can be repaired', () => {
    const scenario = createParticleBuildingScenario();
    const wet = scenario.model.sections.find((s) => s.row === 0 && s.column === 1);
    const dry = scenario.model.sections.find((s) => s.row === 0 && s.column === 5);
    wet.health = 60;
    dry.health = 60;
    scenario.world.set(Math.floor((wet.x + scenario.model.size / 2) / scenario.scale),
      Math.floor((wet.y + scenario.model.size / 2) / scenario.scale), PARTICLE_WATER);
    const result = scenario.repair();
    assert(result.state === 'Rebuilding' && result.spent === scenario.model.repairCost &&
      dry.health === 100 && wet.health === 60 && result.siteBlockers === undefined,
      'blocked site prevented an eligible repair or gave misleading blocked feedback');
    const blocked = scenario.repair();
    assert(blocked.state === 'Blocked' && blocked.siteBlockers.includes('water') && blocked.spent === 0,
      'remaining wet repair did not report its obstruction');
  });
  check('slabs fall into excavated terrain but stop on intact edges', () => {
    const scenario = createParticleBuildingScenario();
    scenario.undermine(1);
    const heights = Array.from({ length: scenario.world.width }, (_, x) => {
      let y = 0;
      while (y < scenario.world.height && scenario.world.at(x, y) !== PARTICLE_TERRAIN) y += 1;
      return y * scenario.scale;
    });
    check('undermined crowded frame stays above the particle surface', () => {
      const scenario = createParticleBuildingScenario();
      for (let i = 0; i < 3; i += 1) scenario.undermine(i);
      for (let step = 0; step < 240; step += 1) {
        scenario.step();
        const { model } = scenario;
        for (let i = 0; i < model.sections.length; i += 1) {
          assert(model.groundPenetration(model.sections[i]) < 0.02, `terrain penetration at step ${step}`);
          for (let j = i + 1; j < model.sections.length; j += 1) {
            const hit = model.sectionOverlap(model.sections[i], model.sections[j]);
            assert(!hit || hit.depth < 0.75, `members overlap at step ${step}`);
          }
        }
      }
    });
    const make = (x, angle) => {
      const model = createCollapseModel({ columns: 3, rows: 1, size: 20, left: 100,
        ground: 300, surfaceGrid: { cellSize: scenario.scale,
          heightAt: (column) => heights[Math.max(0, Math.min(heights.length - 1, column))] } });
      const slab = model.sections[1];
      model.blast(130, 290, 1, 150);
      Object.assign(slab, { x, y: 245, vx: 0, vy: 0, angle, angularVelocity: 0 });
      for (let i = 0; i < 180; i += 1) {
        model.step(1 / 60);
        assert(model.groundPenetration(slab) < 0.02, 'slab penetrated terrain');
      }
      return { model, slab };
    };
    const edgeX = (scenario.anchorColumns[1] - 5) * scenario.scale;
    const inside = make(edgeX + 8, 0);
    assert(Math.abs(inside.model.sectionBounds(inside.slab).bottom - 344) < 0.1,
      'slab did not reach the bottom of the excavated opening');
    const bridged = make(edgeX - 10, 0);
    assert(Math.abs(bridged.model.sectionBounds(bridged.slab).bottom - 300) < 0.1,
      'slab crossed the intact edge of the opening');
    const rotated = make(edgeX - 10, 0.2);
    assert(rotated.model.sectionBounds(rotated.slab).bottom < 320,
      'rotated slab crossed the intact terrain edge');
  });
  check('particle surface and ordinary collapse saves cannot be mixed', () => {
    const scenario = createParticleBuildingScenario();
    const ordinary = createCollapseModel({ ground: 300, loadEnabled: true });
    const before = JSON.stringify(ordinary.saveState());
    let failed = false;
    try { ordinary.loadState(scenario.model.saveState()); } catch (error) { failed = true; }
    assert(failed && before === JSON.stringify(ordinary.saveState()), 'incompatible terrain save was accepted');
  });
  check('water is conserved through excavation and support loss', () => {
    const scenario = createParticleBuildingScenario();
    const initial = scenario.world.waterCount;
    for (let i = 0; i < 3; i += 1) scenario.undermine(i);
    for (let i = 0; i < 80; i += 1) scenario.step();
    assert(scenario.world.waterCount === initial &&
      scenario.world.countWater(0, 0, scenario.world.width - 1, scenario.world.height - 1) === initial,
    'water count changed');
  });
  check('basin breach sends conserved water toward the undermined building', () => {
    const scenario = createParticleBuildingScenario();
    const initial = scenario.world.waterCount;
    for (let i = 0; i < 80; i += 1) scenario.step();
    assert(scenario.world.countWater(31, 0, 159, 89) === 0, 'water leaked through intact basin');
    assert(scenario.breachBasin() === 10 && scenario.breachBasin() === 0, 'basin breach removed the wrong cells');
    scenario.undermine(0);
    for (let i = 0; i < 240; i += 1) scenario.step();
    assert(scenario.world.countWater(35, 0, 159, 89) > 0, 'water did not flow toward the building');
    assert(scenario.world.waterCount === initial &&
      scenario.world.countWater(0, 0, 159, 89) === initial, 'breach lost water');
  });
  check('intact wall blocks basin water and a breach lets it flow through', () => {
    const scenario = createParticleBuildingScenario();
    const x = scenario.anchorColumns[0];
    scenario.breachBasin();
    for (let i = 0; i < 180; i += 1) scenario.step();
    assert(scenario.world.countWater(x + 1, 0, 159, 89) === 0, 'water crossed the intact wall');
    assert(scenario.blastLeftWall(), 'wall blast did not detach the lower wall');
    for (let i = 0; i < 260; i += 1) scenario.step();
    assert(scenario.world.countWater(x + 1, 0, 159, 89) > 0, 'water did not cross the broken wall');
    assert(scenario.world.waterCount === 220 &&
      scenario.world.countWater(0, 0, 159, 89) === 220, 'water was lost at the wall');
  });
  check('water blocker conserves trapped water and avoids blocked debris swaps', () => {
    const world = createParticleWorld(1, 2);
    const snapshot = world.snapshot();
    snapshot.cells = [PARTICLE_DEBRIS, PARTICLE_WATER];
    world.restore(snapshot);
    world.step(new Uint8Array([1, 0]));
    assert(world.at(0, 0) === PARTICLE_DEBRIS && world.at(0, 1) === PARTICLE_WATER,
      'debris displaced water into a blocked cell');
    world.step(new Uint8Array(2));
    assert(world.at(0, 0) === PARTICLE_WATER && world.at(0, 1) === PARTICLE_DEBRIS &&
      world.waterCount === 1, 'unblocked debris swap lost water');
    world.step(new Uint8Array([1, 0]));
    assert(world.waterCount === 1, 'water already in a blocked cell was lost');
    const before = JSON.stringify(world.snapshot());
    let failed = false;
    try { world.step(new Uint8Array(3)); } catch (error) { failed = true; }
    assert(failed && before === JSON.stringify(world.snapshot()), 'invalid blocker modified world');
  });
  check('overlapping water moves only to an adjacent free cell or remains trapped', () => {
    const world = createParticleWorld(3, 3);
    world.set(1, 1, PARTICLE_WATER);
    const mask = new Uint8Array(9);
    mask[4] = 1;
    for (const [x, y] of [[1, 2], [0, 1], [2, 1]]) world.set(x, y, PARTICLE_TERRAIN);
    world.step(mask, true);
    assert(world.at(1, 0) === PARTICLE_WATER && world.at(1, 1) === PARTICLE_EMPTY &&
      world.waterCount === 1, 'overlap was not displaced upward into the only free neighbor');
    const trapped = createParticleWorld(1, 1);
    trapped.set(0, 0, PARTICLE_WATER);
    trapped.step(new Uint8Array([1]), true);
    assert(trapped.at(0, 0) === PARTICLE_WATER && trapped.waterCount === 1, 'trapped water was lost');
    const before = JSON.stringify(world.snapshot());
    let failed = false;
    try { world.step(undefined, true); } catch (error) { failed = true; }
    assert(failed && before === JSON.stringify(world.snapshot()), 'invalid displacement mutated world');
  });
  check('displacement matches optimized scanning across chunk boundaries', () => {
    const full = createParticleWorld(40, 8);
    const fast = createParticleWorld(40, 8, { skipEmptyRows: true, skipEmptyChunks: true });
    const mask = new Uint8Array(40 * 8);
    for (const world of [full, fast]) {
      for (let x = 25; x < 36; x += 1) world.set(x, 4, PARTICLE_WATER);
      for (let x = 0; x < 40; x += 1) world.set(x, 7, PARTICLE_TERRAIN);
    }
    for (let x = 26; x < 35; x += 1) mask[4 * 40 + x] = 1;
    for (let i = 0; i < 80; i += 1) {
      full.step(mask, true); fast.step(mask, true);
      assert(JSON.stringify(full.snapshot()) === JSON.stringify(fast.snapshot()) &&
        full.waterCount === 11, `displacement scan or conservation mismatch at ${i}`);
    }
  });
  check('displacement pushes a connected overlapping chain into a free cell', () => {
    const full = createParticleWorld(40, 1);
    const fast = createParticleWorld(40, 1, { skipEmptyRows: true, skipEmptyChunks: true });
    const mask = new Uint8Array(40);
    mask[30] = mask[31] = mask[32] = 1;
    for (const world of [full, fast]) {
      for (let x = 0; x < 40; x += 1) {
        if (x === 30 || x === 31 || x === 32) world.set(x, 0, PARTICLE_WATER);
        else if (x !== 33) world.set(x, 0, PARTICLE_TERRAIN);
      }
      world.step(mask, true);
      assert(world.at(30, 0) === PARTICLE_EMPTY && world.at(31, 0) === PARTICLE_WATER &&
        world.at(32, 0) === PARTICLE_WATER && world.at(33, 0) === PARTICLE_WATER &&
        world.waterCount === 3, 'water chain did not move into the adjacent opening');
    }
    assert(JSON.stringify(full.snapshot()) === JSON.stringify(fast.snapshot()), 'chain bookkeeping differed');
    const restored = createParticleWorld(40, 1, { skipEmptyRows: true, skipEmptyChunks: true });
    restored.restore(JSON.parse(JSON.stringify(fast.snapshot())));
    for (let i = 0; i < 12; i += 1) {
      full.step(mask, true); fast.step(mask, true); restored.step(mask, true);
      assert(JSON.stringify(full.snapshot()) === JSON.stringify(fast.snapshot()) &&
        JSON.stringify(fast.snapshot()) === JSON.stringify(restored.snapshot()) &&
        full.waterCount === 3, `chain continuation diverged at ${i}`);
    }
  });
  check('displacement cannot push through solids or unblocked water', () => {
    const world = createParticleWorld(4, 1);
    world.set(0, 0, PARTICLE_WATER);
    world.set(1, 0, PARTICLE_TERRAIN);
    world.set(2, 0, PARTICLE_WATER);
    const mask = new Uint8Array([1, 1, 0, 0]);
    world.step(mask, true);
    assert(world.at(0, 0) === PARTICLE_WATER && world.at(1, 0) === PARTICLE_TERRAIN &&
      world.waterCount === 2, 'water crossed a solid obstruction');
    const blockedByWater = createParticleWorld(3, 1);
    blockedByWater.set(0, 0, PARTICLE_WATER);
    blockedByWater.set(1, 0, PARTICLE_WATER);
    blockedByWater.step(new Uint8Array([1, 0, 0]), true);
    assert(blockedByWater.at(0, 0) === PARTICLE_WATER && blockedByWater.waterCount === 2,
      'displacement pushed through unblocked water');
  });
  check('displacement chain is limited to eight cell moves per step', () => {
    const world = createParticleWorld(10, 1);
    const mask = new Uint8Array(10);
    for (let x = 0; x < 9; x += 1) {
      world.set(x, 0, PARTICLE_WATER);
      mask[x] = 1;
    }
    world.step(mask, true);
    assert(world.at(0, 0) === PARTICLE_WATER && world.at(1, 0) === PARTICLE_EMPTY &&
      world.at(9, 0) === PARTICLE_WATER && world.waterCount === 9,
      'chain exceeded its distance limit or did not use an eligible shorter path');
  });
  check('optional loose members block and displace water and their mode persists', () => {
    const scenario = createParticleBuildingScenario();
    const section = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
    scenario.model.updateFoundationSupport((s) => s !== section);
    section.x = 480; section.y = 120; section.angle = 0;
    section.previousX = section.x; section.previousY = section.y; section.previousAngle = 0;
    const x = Math.floor((section.x + scenario.model.size / 2) / scenario.scale);
    const y = Math.floor((section.y + 4) / scenario.scale);
    scenario.world.set(x, y, PARTICLE_WATER);
    const count = scenario.world.waterCount;
    scenario.setWaterBlocksLoose(true);
    const restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(scenario.snapshot())));
    assert(restored.waterBlocksLoose, 'experimental mode did not survive load');
    scenario.step(); restored.step();
    assert(scenario.world.at(x, y) === PARTICLE_EMPTY && scenario.world.waterCount === count &&
      JSON.stringify(scenario.snapshot()) === JSON.stringify(restored.snapshot()),
      'loose-member overlap was not displaced deterministically');
    const legacy = scenario.snapshot();
    delete legacy.waterBlocksLoose;
    assert(!createParticleBuildingScenario(legacy).waterBlocksLoose, 'old save enabled the experiment');
    legacy.waterBlocksLoose = 'yes';
    let failed = false;
    try { createParticleBuildingScenario(legacy); } catch (error) { failed = true; }
    assert(failed, 'invalid experimental mode was accepted');
  });
  check('loose slab blocks falling water only while experiment is enabled', () => {
    const scenario = createParticleBuildingScenario();
    const section = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
    scenario.model.updateFoundationSupport((s) => s !== section);
    section.x = 480; section.y = 120; section.angle = 0;
    section.previousX = section.x; section.previousY = section.y; section.previousAngle = 0;
    const x = Math.floor((section.x + scenario.model.size / 2) / scenario.scale);
    const y = Math.floor((section.y + scenario.model.size / 2) / scenario.scale) - 1;
    scenario.world.set(x, y, PARTICLE_WATER);
    const enabled = createParticleBuildingScenario(scenario.snapshot());
    enabled.setWaterBlocksLoose(true);
    scenario.step(); enabled.step();
    assert(scenario.world.at(x, y + 1) === PARTICLE_WATER &&
      enabled.world.at(x, y + 1) !== PARTICLE_WATER &&
      enabled.world.countWater(x - 1, y, x + 1, y) === 1,
      'loose slab did not block falling water in the enabled mode');
  });
  check('loose member sweep blocks water between endpoints and survives save', () => {
    const scenario = createParticleBuildingScenario();
    const section = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
    scenario.model.updateFoundationSupport((s) => s !== section);
    section.x = 460; section.y = 120; section.angle = 0;
    section.previousX = 380; section.previousY = 120; section.previousAngle = 0;
    const x = 110, y = 32;
    scenario.world.set(x, y, PARTICLE_WATER);
    const enabled = createParticleBuildingScenario(JSON.parse(JSON.stringify(scenario.snapshot())));
    enabled.setWaterBlocksLoose(true);
    const restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(enabled.snapshot())));
    scenario.step(); enabled.step(); restored.step();
    assert(scenario.world.at(x, y + 1) === PARTICLE_WATER &&
      enabled.world.at(x, y + 1) !== PARTICLE_WATER &&
      enabled.world.waterCount === 221 &&
      JSON.stringify(enabled.snapshot()) === JSON.stringify(restored.snapshot()),
      'swept water contact was missed, lost water, or changed on restore');
    const oldX = 105;
    enabled.world.set(oldX, y, PARTICLE_WATER);
    enabled.step();
    assert(enabled.world.at(oldX, y + 1) === PARTICLE_WATER,
      'old swept path blocked water for more than one particle step');
  });
  check('loose member rotation sweep covers intermediate angles', () => {
    const scenario = createParticleBuildingScenario();
    const section = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
    scenario.model.updateFoundationSupport((s) => s !== section);
    section.x = 480; section.y = 120;
    section.previousX = section.x; section.previousY = section.y;
    section.previousAngle = 0; section.angle = Math.PI / 2;
    const x = 125, y = 34;
    scenario.world.set(x, y, PARTICLE_WATER);
    const enabled = createParticleBuildingScenario(scenario.snapshot());
    enabled.setWaterBlocksLoose(true);
    scenario.step(); enabled.step();
    assert(scenario.world.at(x, y + 1) === PARTICLE_WATER &&
      enabled.world.at(x, y + 1) !== PARTICLE_WATER &&
      enabled.world.waterCount === 221,
      'rotating member did not affect water along its intermediate path');
  });
  check('a fast simulated fragment interacts with water along its prior path', () => {
    const scenario = createParticleBuildingScenario();
    const section = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
    scenario.model.updateFoundationSupport((s) => s !== section);
    section.x = 400; section.y = 100; section.vx = 1000; section.vy = 0;
    section.previousX = section.x; section.previousY = section.y;
    scenario.model.step(1 / 60);
    assert(section.x > 416 && section.previousX === 400, 'fragment did not move as expected');
    const x = 101, y = 27;
    scenario.world.set(x, y, PARTICLE_WATER);
    const enabled = createParticleBuildingScenario(scenario.snapshot());
    enabled.setWaterBlocksLoose(true);
    scenario.step(); enabled.step();
    assert(scenario.world.at(x, y + 1) === PARTICLE_WATER &&
      enabled.world.at(x, y + 1) !== PARTICLE_WATER &&
      enabled.world.waterCount === 221, 'simulated fragment missed water in its swept path');
  });
  check('experimental flooded collapse conserves water and restores its future', () => {
    const first = createParticleBuildingScenario();
    first.setWaterBlocksLoose(true);
    first.breachBasin();
    for (let i = 0; i < 80; i += 1) first.step();
    first.blastLeftWall();
    let restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(first.snapshot())));
    for (let i = 0; i < 100; i += 1) {
      first.step(); restored.step();
      if (i === 50) restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(restored.snapshot())));
      assert(first.world.waterCount === 220 && first.world.countWater(0, 0, 159, 89) === 220 &&
        JSON.stringify(first.snapshot()) === JSON.stringify(restored.snapshot()),
        `experimental collapse lost water or diverged at ${i}`);
    }
  });
  check('loose water blocking turns off when debris is cleared', () => {
    const scenario = createParticleBuildingScenario();
    const section = scenario.model.sections.find((s) => s.row === 8 && s.column === 3);
    scenario.model.updateFoundationSupport((s) => s !== section);
    section.x = 480; section.y = 120; section.angle = 0;
    section.previousX = section.x; section.previousY = section.y; section.previousAngle = 0;
    scenario.setWaterBlocksLoose(true);
    scenario.step();
    scenario.clearBuildingDebris();
    const x = Math.floor((section.x + scenario.model.size / 2) / scenario.scale);
    const y = Math.floor((section.y + scenario.model.size / 2) / scenario.scale) - 1;
    scenario.world.set(x, y, PARTICLE_WATER);
    scenario.step();
    assert(scenario.world.at(x, y + 1) === PARTICLE_WATER, 'cleared member left a stale water blocker');
  });
  check('water blockers match optimized and full scans and allow old saves', () => {
    const full = createParticleWorld(35, 8);
    const fast = createParticleWorld(35, 8, { skipEmptyRows: true, skipEmptyChunks: true });
    for (const world of [full, fast]) {
      for (let x = 0; x < 35; x += 1) world.set(x, 7, PARTICLE_TERRAIN);
      for (let x = 5; x < 15; x += 1) world.set(x, 3, PARTICLE_WATER);
    }
    const blockers = new Uint8Array(35 * 8);
    for (let y = 0; y < 7; y += 1) blockers[y * 35 + 17] = 1;
    for (let i = 0; i < 100; i += 1) {
      full.step(blockers); fast.step(blockers);
      assert(JSON.stringify(full.snapshot()) === JSON.stringify(fast.snapshot()), `mask search mismatch at step ${i}`);
    }
    const scenario = createParticleBuildingScenario();
    const saved = scenario.snapshot();
    delete saved.waterBlocksAttached;
    const old = createParticleBuildingScenario(saved);
    assert(!old.waterBlocksAttached && !createParticleBuildingScenario(old.snapshot()).waterBlocksAttached,
      'old water interaction mode was not preserved');
  });
  check('cached water blockers match rebuilt masks after frame changes and reload', () => {
    const scenario = createParticleBuildingScenario();
    scenario.breachBasin();
    for (let i = 0; i < 80; i += 1) {
      if (i === 10) scenario.model.sections[0].x += 4;
      if (i === 20) scenario.model.sections[0].angle = 0.3;
      if (i === 30) scenario.blastLeftWall();
      if (i === 50) scenario.repair();
      const rebuilt = createParticleBuildingScenario(JSON.parse(JSON.stringify(scenario.snapshot())));
      scenario.step();
      rebuilt.step();
      assert(JSON.stringify(scenario.snapshot()) === JSON.stringify(rebuilt.snapshot()),
        `cached mask or continuation differed at step ${i}`);
    }
  });
  check('moving an attached member opens its previously blocked cells', () => {
    const scenario = createParticleBuildingScenario();
    scenario.step();
    const roof = scenario.model.sections.find((s) => s.row === 0 && s.column === 0);
    roof.x += scenario.model.size * 2;
    const x = Math.floor((scenario.model.left + scenario.model.size / 2) / scenario.scale);
    const y = Math.floor((roof.y + scenario.model.size / 2) / scenario.scale) - 1;
    scenario.world.set(x, y, PARTICLE_WATER);
    scenario.step();
    assert(scenario.world.at(x, y + 1) === PARTICLE_WATER, 'stale mask blocked the vacated roof cell');
  });
  check('particle debris clearing preserves other materials and scan bookkeeping', () => {
    const full = createParticleWorld(40, 6);
    const fast = createParticleWorld(40, 6, { skipEmptyRows: true, skipEmptyChunks: true });
    const state = full.snapshot();
    state.cells[1] = PARTICLE_TERRAIN;
    state.cells[2] = PARTICLE_WATER;
    state.cells[3] = PARTICLE_BARRIER;
    state.cells[4] = PARTICLE_DEBRIS;
    state.cells[34] = PARTICLE_DEBRIS;
    state.cells[40 + 34] = PARTICLE_WATER;
    for (const world of [full, fast]) {
      world.restore(state);
      const before = JSON.stringify(world.snapshot());
      let failed = false;
      try { world.clearDebris(0, 0, 40, 5); } catch (error) { failed = true; }
      assert(failed && before === JSON.stringify(world.snapshot()), 'invalid clearing changed the world');
      assert(world.clearDebris(0, 0, 10, 5) === 1 && world.debrisCount === 1,
        'bounded clearing removed the wrong debris');
      assert(world.at(1, 0) === PARTICLE_TERRAIN && world.at(2, 0) === PARTICLE_WATER &&
        world.at(3, 0) === PARTICLE_BARRIER && world.waterCount === 2,
        'clearing damaged another material');
      assert(!world.snapshot().supportsDirty, 'clearing unnecessarily invalidated barrier support');
    }
    for (let i = 0; i < 20; i += 1) {
      full.step(); fast.step();
      assert(JSON.stringify(full.snapshot()) === JSON.stringify(fast.snapshot()), `scan mismatch at step ${i}`);
    }
    assert(full.at(3, 0) === PARTICLE_BARRIER, 'clearing released an unrelated barrier');
  });
  check('lab clears particle debris without removing loose building members', () => {
    const scenario = createParticleBuildingScenario();
    scenario.undermine(1);
    scenario.step();
    const loose = scenario.model.fragments.length;
    const state = scenario.world.snapshot();
    const x = scenario.anchorColumns[1];
    state.cells[scenario.surfaceRow * scenario.world.width + x] = PARTICLE_DEBRIS;
    scenario.world.restore(state);
    const water = scenario.world.waterCount;
    assert(!scenario.restoreGround(1).ok, 'debris did not block ground restoration');
    assert(scenario.clearParticleDebris() === 1 && scenario.world.debrisCount === 0 &&
      scenario.world.waterCount === water && scenario.model.fragments.length === loose,
      'clearing changed water or building debris');
    const saved = createParticleBuildingScenario(JSON.parse(JSON.stringify(scenario.snapshot())));
    assert(saved.world.debrisCount === 0 && saved.model.fragments.length === loose,
      'cleared state did not survive a save');
  });
  check('clearing particle debris lets a dry wall repair resume', () => {
    const scenario = createParticleBuildingScenario();
    const base = scenario.model.sections.find((s) => s.anchored && s.column === 3);
    scenario.model.blast(base.x + 13, base.y + 13, 1, 150);
    base.x = 500; base.y = 20;
    const state = scenario.world.snapshot();
    state.cells[70 * scenario.world.width + scenario.anchorColumns[1]] = PARTICLE_DEBRIS;
    scenario.world.restore(state);
    assert(scenario.repair().state === 'Blocked' && scenario.hm === 200, 'debris did not block repair');
    assert(scenario.clearParticleDebris() === 1, 'debris was not cleared');
    const result = scenario.repair();
    assert(result.spent > 0 && base.attached && scenario.hm === 200 - result.spent,
      'repair did not resume after debris was cleared');
  });
  check('cleared building debris stays absent and can be rebuilt after loading', () => {
    const scenario = createParticleBuildingScenario();
    const base = scenario.model.sections.find((s) => s.anchored && s.column === 3);
    scenario.undermine(1);
    scenario.step();
    const water = scenario.world.waterCount;
    assert(!scenario.restoreGround(1).ok, 'loose base did not block ground restoration');
    base.x = 500; base.y = 20;
    const loose = scenario.model.fragments.length;
    assert(loose > 0 && scenario.clearBuildingDebris() === loose &&
      scenario.model.fragments.length === 0 && base.cleared, 'loose base was not cleared');
    const clearedX = base.x, clearedY = base.y, health = base.health;
    scenario.model.blast(clearedX + 13, clearedY + 13, 1, 150);
    scenario.step();
    assert(base.x === clearedX && base.y === clearedY && base.health === health &&
      scenario.world.waterCount === water, 'cleared member moved, took damage, or lost water');
    let restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(scenario.snapshot())));
    const restoredBase = restored.model.sections.find((s) => s.row === restored.model.rows - 1 && s.column === 3);
    assert(restoredBase.cleared && restored.model.fragments.length === 0, 'cleared member returned on load');
    assert(restored.restoreGround(1).ok, 'cleared member still blocked ground restoration');
    let spent = 0;
    for (let i = 0; i < 5 && !restoredBase.attached; i += 1) spent += restored.repair().spent;
    assert(spent > 0 && restoredBase.attached && !restoredBase.cleared &&
      restored.hm === 200 - spent, 'cleared member did not rebuild for HM');
    restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(restored.snapshot())));
    assert(restored.model.sections.find((s) => s.row === restored.model.rows - 1 && s.column === 3).attached,
      'rebuilt member was not saved');
  });
  check('clearing cannot rebuild a destroyed frame and old saves restore debris', () => {
    const scenario = createParticleBuildingScenario();
    scenario.undermine(0); scenario.undermine(1); scenario.undermine(2); scenario.step();
    const old = scenario.snapshot();
    for (const section of old.model.sections) delete section.cleared;
    const restored = createParticleBuildingScenario(old);
    assert(restored.model.fragments.length === scenario.model.fragments.length,
      'old save did not retain loose members');
    const count = restored.clearBuildingDebris();
    assert(count > 0 && restored.clearBuildingDebris() === 0 &&
      restored.repair().state === 'Destroyed' && restored.hm === 200,
      'clearing recreated a destroyed frame or charged HM');
    const invalid = createParticleBuildingScenario().snapshot();
    invalid.model.sections[0].cleared = true;
    let failed = false;
    try { createParticleBuildingScenario(invalid); } catch (error) { failed = true; }
    assert(failed, 'an attached cleared member was accepted on load');
  });
  check('cleared members do not collide with or support remaining members', () => {
    for (const optimizeCollisionSearch of [false, true]) {
      const model = createCollapseModel({ optimizeCollisionSearch });
      const base = model.sections.find((s) => s.anchored && s.column === 3);
      model.updateFoundationSupport((s) => s !== base);
      assert(model.clearLooseMembers() === 1, 'expected one cleared base');
      const other = model.sections.find((s) => s.attached && !s.anchored);
      base.x = other.x; base.y = other.y;
      assert(!model.sectionOverlap(base, other) &&
        !model.touchesRect(base, other.x, other.y, model.size, model.size),
        'cleared member still has collision geometry');
      const state = model.saveState();
      const farState = JSON.parse(JSON.stringify(state));
      const index = model.sections.indexOf(base);
      farState.sections[index].x = -1000;
      farState.sections[index].y = -1000;
      const far = createCollapseModel({ optimizeCollisionSearch });
      far.loadState(farState);
      for (let i = 0; i < 10; i += 1) {
        model.step(1 / 60); far.step(1 / 60);
        for (let j = 0; j < model.sections.length; j += 1) {
          if (j === index) continue;
          assert(JSON.stringify(model.saveState().sections[j]) === JSON.stringify(far.saveState().sections[j]),
            `cleared member influenced physics at step ${i}`);
        }
      }
    }
  });
  check('cached surface refreshes after terrain changes and snapshot restore', () => {
    const scenario = createParticleBuildingScenario();
    const { world, model } = scenario;
    const x = 130;
    const original = world.snapshot();
    const revision = world.terrainRevision;
    world.set(120, 10, PARTICLE_WATER);
    assert(world.terrainRevision === revision, 'water changed terrain revision');
    world.excavate(x, scenario.surfaceRow, x, scenario.surfaceRow + 4);
    assert(world.terrainRevision > revision, 'excavation did not mark terrain changed');
    scenario.step();
    assert(model.surfaceAt(x * scenario.scale + 1) === (scenario.surfaceRow + 5) * scenario.scale,
      'excavated surface was not refreshed');
    const changed = world.terrainRevision;
    world.restore(original);
    assert(world.terrainRevision > changed, 'restored terrain did not invalidate surface');
    scenario.step();
    assert(model.surfaceAt(x * scenario.scale + 1) === scenario.surfaceRow * scenario.scale,
      'restored surface was stale');
  });
  check('identical combined worlds remain deterministic', () => {
    const first = createParticleBuildingScenario();
    const second = createParticleBuildingScenario();
    for (let i = 0; i < 80; i += 1) {
      if (i === 10) { first.undermine(1); second.undermine(1); }
      if (i === 30) {
        first.undermine(0); first.undermine(2);
        second.undermine(0); second.undermine(2);
      }
      first.step(); second.step();
      assert(JSON.stringify(first.model.saveState()) === JSON.stringify(second.model.saveState()),
        `frame mismatch at step ${i}`);
      assert(JSON.stringify(first.world.snapshot()) === JSON.stringify(second.world.snapshot()),
        `particle mismatch at step ${i}`);
    }
  });
  check('combined saves restore terrain, water and frame before and after support loss', () => {
    const original = createParticleBuildingScenario();
    original.undermine(1);
    let restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(original.snapshot())));
    assert(original.step() === restored.step(), 'pending support loss did not restore');
    for (let i = 0; i < 80; i += 1) {
      if (i === 10) { original.undermine(0); restored.undermine(0); }
      if (i === 20) { original.undermine(2); restored.undermine(2); }
      original.step(); restored.step();
      if (i === 40) restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(restored.snapshot())));
      assert(JSON.stringify(original.snapshot()) === JSON.stringify(restored.snapshot()),
        `save continuation diverged at step ${i}`);
    }
  });
  check('invalid combined saves are rejected', () => {
    const scenario = createParticleBuildingScenario();
    const saved = scenario.snapshot();
    saved.model.sections[0].x = null;
    let failed = false;
    try { createParticleBuildingScenario(saved); } catch (error) { failed = true; }
    assert(failed, 'invalid model snapshot was accepted');
    saved.model = scenario.model.saveState();
    saved.world.cells[0] = 99;
    failed = false;
    try { createParticleBuildingScenario(saved); } catch (error) { failed = true; }
    assert(failed, 'invalid particle snapshot was accepted');
  });
  check('invalid support check leaves every anchor unchanged', () => {
    const scenario = createParticleBuildingScenario();
    const before = JSON.stringify(scenario.model.saveState());
    let failed = false;
    try { scenario.model.updateFoundationSupport((section) => section.column === 0 ? false : 'invalid'); }
    catch (error) { failed = true; }
    assert(failed && JSON.stringify(scenario.model.saveState()) === before, 'invalid support result changed frame');
  });
  check('normal collapse model does not lose anchors without an explicit support update', () => {
    const model = createCollapseModel();
    model.step(1 / 60);
    assert(model.sections.filter((section) => section.anchored).length === 3, 'standalone anchors changed');
  });
  document.getElementById('results').textContent = checks.join('\n');
}());
