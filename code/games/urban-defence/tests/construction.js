(function () {
  const checks = [];
  function check(name, run) {
    try { run(); checks.push(`PASS ${name}`); }
    catch (error) { checks.push(`FAIL ${name}: ${error.message}`); }
  }
  function assert(value, message) { if (!value) throw new Error(message); }
  check('released water visually reaches the completed wall in both oscillation phases', () => {
    const build = createConstructionScenario(), scenario = build.scenario;
    scenario.breachBasin();
    for (let i = 0; i < 1200; i += 1) build.step();
    const { world, model, scale } = scenario;
    const wall = model.sections.find((s) => s.row === model.rows - 1 && s.column === 0);
    const x = Math.floor((wall.x + model.size / 2) / scale), y = 72;
    const states = [];
    for (let phase = 0; phase < 2; phase += 1) {
      states.push(world.at(x - 1, y));
      const canvas = document.createElement('canvas');
      canvas.width = world.width * scale; canvas.height = world.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1facc8';
      for (let col = x - 2; col <= x; col += 1) {
        if (world.at(col, y) === PARTICLE_WATER) ctx.fillRect(col * scale, y * scale, scale, scale);
      }
      drawParticleWaterContacts(ctx, scenario);
      const pixels = ctx.getImageData((x - 1) * scale, y * scale + 1, scale + 1, 1).data;
      assert(Array.from({ length: scale + 1 }, (_, i) => pixels[i * 4 + 3]).every((a) => a > 0),
        `visible gap remained during phase ${phase}`);
      assert(world.waterCount === 220 && world.countWater(x + 1, 0, world.width - 1, world.height - 1) === 0,
        'water was lost or passed through the intact wall');
      build.step();
    }
    assert(states.includes(PARTICLE_WATER) && states.includes(PARTICLE_EMPTY),
      'test did not exercise both particle oscillation phases');
  });
  check('released water damages an unfinished frame only when enabled', () => {
    function run(enabled) {
      const build = createConstructionScenario(), scenario = build.scenario;
      scenario.setWaterDamageEnabled(enabled);
      assert(scenario.breachBasin() > 0 && scenario.breachBasin() === 0, 'basin breach is not repeatable');
      for (let i = 0; i < 240; i += 1) build.step();
      const wall = scenario.model.sections.find((s) => s.row === scenario.model.rows - 1 && s.column === 0);
      return { build, scenario, wall };
    }
    const dryMode = run(false), wetMode = run(true);
    assert(dryMode.wall.health === 100 && wetMode.wall.health < 99 &&
      wetMode.wall.attached && wetMode.scenario.world.waterCount === 220 &&
      wetMode.scenario.hm === 200 && wetMode.build.blueprintProgress === 1,
    'water damage, conservation or blueprint accounting incorrect');
    for (let i = 0; i < 60; i += 1) wetMode.build.step();
    assert(wetMode.build.result.spent === wetMode.build.result.completed * wetMode.scenario.model.repairCost &&
      wetMode.build.result.completed > 0 && wetMode.wall.health < 100 &&
      wetMode.build.result.siteBlockers.includes('water') &&
      wetMode.scenario.hm === 200 - wetMode.build.result.spent,
    'wet anchor did not stay blocked while dry branches advanced');
  });
  check('parallel branches respect the starting frontier and account for each member', () => {
    const build = createConstructionScenario(), scenario = build.scenario, model = scenario.model;
    for (let i = 0; i < 300; i += 1) build.step();
    const built = model.sections.filter((s) => s.attached && !s.anchored);
    assert(built.length > 1 && [0, 3, 6].every((column) =>
      built.some((s) => s.row === model.rows - 2 && s.column === column)),
    'independent foundation branches did not grow together');
    assert(!model.sections.some((s) => s.attached && s.row < model.rows - 2),
      'new work immediately supported another generation');
    assert(build.result.completed === built.length &&
      build.result.spent === built.length * model.repairCost &&
      scenario.hm === 200 - build.result.spent, 'parallel work cost incorrect');
  });
  check('a wet branch does not stop dry branches and blocked work costs nothing', () => {
    const scenario = createConstructionScenario().scenario, model = scenario.model;
    const wet = model.sections.find((s) => s.row === model.rows - 2 && s.column === 0);
    scenario.world.set(Math.floor((wet.x + model.size / 2) / scenario.scale),
      Math.floor((wet.y + model.size / 2) / scenario.scale), PARTICLE_WATER);
    const first = scenario.repairFrontier();
    assert(first.completed > 1 && first.siteBlockers.includes('water') && !wet.attached &&
      model.sections.some((s) => s.attached && s.row === model.rows - 2 && s.column === 6),
    'wet branch stopped independent work or was not reported alongside progress');
    let result = first;
    for (let i = 0; i < model.sections.length && result.spent; i += 1) result = scenario.repairFrontier();
    const hm = scenario.hm;
    assert(result.state === 'Blocked' && result.siteBlockers.includes('water') &&
      result.spent === 0 && !wet.attached && scenario.world.waterCount === 221,
    'blocked wet branch did not report its obstruction');
    assert(scenario.repairFrontier().spent === 0 && scenario.hm === hm,
      'blocked work consumed resources');
    const worldSnapshot = scenario.world.snapshot();
    const wetX = Math.floor((wet.x + model.size / 2) / scenario.scale);
    const wetY = Math.floor((wet.y + model.size / 2) / scenario.scale);
    assert(worldSnapshot.cells[0] === PARTICLE_EMPTY, 'test destination is occupied');
    worldSnapshot.cells[wetY * scenario.world.width + wetX] = PARTICLE_EMPTY;
    worldSnapshot.cells[0] = PARTICLE_WATER;
    scenario.world.restore(worldSnapshot);
    const resumed = scenario.repairFrontier();
    assert(resumed.completed > 0 && resumed.siteBlockers.length === 0 && wet.attached &&
      scenario.world.waterCount === 221,
      'cleared obstacle remained in later diagnostics or stopped work');
  });
  check('parallel work stops at the available HM budget', () => {
    const original = createConstructionScenario().scenario;
    const saved = original.snapshot();
    saved.hm = original.model.repairCost * 2;
    const scenario = createParticleBuildingScenario(saved, { rows: 9, minimumWallThicknessFactor: 1.5 });
    const result = scenario.repairFrontier();
    assert(result.state === 'Waiting for HM' && result.completed === 2 &&
      result.spent === saved.hm && scenario.hm === 0 &&
      scenario.model.sections.filter((section) => section.attached).length === 5,
    'parallel repair exceeded or misreported the resource budget');
  });
  check('wall thickness option rejects invalid values without changing default models', () => {
    const standard = createParticleBuildingScenario().model;
    assert(standard.wallThickness === standard.thickness, 'default model width changed');
    for (const factor of [0.5, NaN, Infinity, 'wide']) {
      let failed = false;
      try { createParticleBuildingScenario(undefined, { minimumWallThicknessFactor: factor }); }
      catch (error) { failed = true; }
      assert(failed, 'invalid wall thickness factor accepted');
    }
  });
  check('blasting a construction anchor creates debris without spending HM', () => {
    const build = createConstructionScenario(), scenario = build.scenario;
    assert(scenario.blastLeftWall(), 'left anchor survived blast');
    assert(!scenario.foundationStatus()[0].anchored && scenario.model.fragments.length > 0 &&
      scenario.hm === 200 && scenario.world.waterCount === 220, 'blast changed resources or missed support');
    assert(scenario.clearBuildingDebris() > 0, 'loose blast debris could not be cleared');
    for (let i = 0; i < 600 && !scenario.foundationStatus()[0].anchored; i += 1) build.step();
    assert(scenario.foundationStatus()[0].anchored && scenario.hm < 200,
      'cleared anchor did not rebuild after blueprint and paid work');
  });
  check('each structural height builds, uses supports and preserves resource accounting', () => {
    const sizes = [5, 9, 11], counts = [], wallWidths = [];
    for (const rows of sizes) {
      const build = createConstructionScenario(rows), scenario = build.scenario, model = scenario.model;
      counts.push(model.sections.length);
      wallWidths.push(model.wallThickness);
      assert(model.rows === rows && scenario.foundationStatus().length === 3 &&
        scenario.foundationStatus().every((site) => site.groundPresent && site.anchored),
      `${rows}-row foundation incorrect`);
      const vertical = model.sections.find((s) => s.vertical && !s.horizontal);
      assert(model.wallThickness > model.thickness &&
        Math.abs(model.sectionBounds(vertical).right - model.sectionBounds(vertical).left - model.wallThickness) < 1e-8,
      `${rows}-row vertical collision geometry is not thicker`);
      assert(model.sections.every((s) => s.y >= 0), `${rows}-row frame exceeds world`);
      const restored = createParticleBuildingScenario(JSON.parse(JSON.stringify(scenario.snapshot())),
        { rows, minimumWallThicknessFactor: 1.5 });
      assert(JSON.stringify(restored.snapshot()) === JSON.stringify(scenario.snapshot()) &&
        restored.model.wallThickness === model.wallThickness, `${rows}-row snapshot changed`);
      for (let i = 0; i < 240; i += 1) build.step();
      assert(build.blueprintProgress === 1 && scenario.hm === 200, `${rows}-row reveal cost resources`);
      for (let i = 0; i < 60; i += 1) build.step();
      const newMembers = model.sections.filter((section) => section.attached).length - 3;
      assert(newMembers > 1 && scenario.hm === 200 - newMembers * model.repairCost,
        `${rows}-row parallel construction cadence or cost changed`);
      for (let i = 0; i < 6000 && !build.finished; i += 1) build.step();
      assert(build.finished && model.sections.every((section) => section.attached && section.health === 100) &&
        model.bonds.every((bond) => bond.active), `${rows}-row frame did not finish`);
      assert(scenario.hm === 200 - (model.sections.length - 3) * model.repairCost,
        `${rows}-row completion cost incorrect`);
      scenario.undermine(1);
      build.step();
      assert(!scenario.foundationStatus()[1].groundPresent && !scenario.foundationStatus()[1].anchored,
        `${rows}-row anchor survived excavation`);
    }
    assert(counts[0] < counts[1] && counts[1] < counts[2], 'frame heights did not change structure');
    assert(wallWidths[0] === wallWidths[1] && wallWidths[2] > wallWidths[1],
      'tall supports did not retain their additional thickness');
    let failed = false;
    try { createConstructionScenario(12); } catch (error) { failed = true; }
    assert(failed, 'invalid construction height accepted');
  });
  check('each silhouette can change height without shifting its footprint', () => {
    for (const name of buildingSilhouetteNames) {
      const short = createBuildingSilhouette(name, 10, 100, 40, 30);
      const tall = createBuildingSilhouette(name, 10, 100, 40, 60);
      assert(short.length === tall.length, `${name} changed its structure`);
      short.forEach((point, index) => {
        assert(point.x === tall[index].x &&
          Math.abs((100 - tall[index].y) - 2 * (100 - point.y)) < 1e-8,
        `${name} did not scale vertically`);
      });
      assert(Math.min(...tall.map((point) => point.y)) <
        Math.min(...short.map((point) => point.y)), `${name} did not become taller`);
    }
  });
  check('reference-inspired silhouettes are distinct, bounded and independent', () => {
    assert(buildingSilhouetteNames.length === 7 && new Set(buildingSilhouetteNames).size === 7,
      'expected seven named concepts');
    const signatures = new Set();
    for (const name of buildingSilhouetteNames) {
      const points = createBuildingSilhouette(name, 10, 100, 40, 60);
      assert(points.length >= 4 && points[0].x === 10 && points[0].y === 100 &&
        points[points.length - 1].x === 50 && points[points.length - 1].y === 100,
      `${name} does not meet the ground at both edges`);
      assert(points.every((point) => point.x >= 10 && point.x <= 50 && point.y >= 40 && point.y <= 100),
        `${name} escaped its footprint`);
      signatures.add(JSON.stringify(points));
      points[0].x = -1;
      assert(createBuildingSilhouette(name, 10, 100, 40, 60)[0].x === 10, `${name} shared mutable points`);
    }
    assert(signatures.size === 7, 'silhouettes are not distinct');
    let failed = false;
    try { createBuildingSilhouette('unknown', 0, 0, 10, 10); } catch (error) { failed = true; }
    assert(failed, 'unknown silhouette accepted');
    failed = false;
    try { createBuildingSilhouette('Slab', 0, 0, 0, 10); } catch (error) { failed = true; }
    assert(failed, 'invalid dimensions accepted');
  });
  check('blueprint dots stay evenly spaced and unique throughout branching', () => {
    const build = createConstructionScenario();
    const { blueprint, scenario } = build;
    const spacing = scenario.model.size / 4;
    const before = JSON.stringify(scenario.snapshot());
    const key = (dot) => `${dot.x},${dot.y}`;
    let previous = new Set();
    for (let tick = 0; tick <= 240; tick += 1) {
      const dots = blueprint.dots(tick / 240);
      const keys = new Set(dots.map(key));
      assert(keys.size === dots.length, `overlapping dots at tick ${tick}`);
      for (const point of previous) assert(keys.has(point), `dot moved or disappeared at tick ${tick}`);
      for (let i = 0; i < dots.length; i += 1) {
        for (let j = i + 1; j < dots.length; j += 1) {
          assert(Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y) >= spacing - 1e-8,
            `dots too close at tick ${tick}`);
        }
      }
      previous = keys;
    }
    assert(blueprint.spacing === spacing && scenario.model.thickness < spacing,
      'dot width or spacing is incorrect');
    const complete = blueprint.dots(1);
    const completeKeys = new Set(complete.map(key));
    for (const segment of blueprint.segments(1)) {
      const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
      const steps = Math.round(length / spacing);
      assert(Math.abs(steps * spacing - length) < 1e-8, 'segment is not aligned to dot grid');
      for (let i = 0; i <= steps; i += 1) {
        const x = segment.x1 + (segment.x2 - segment.x1) * i / steps;
        const y = segment.y1 + (segment.y2 - segment.y1) * i / steps;
        assert(completeKeys.has(`${x},${y}`), 'completed blueprint has uneven or missing dots');
      }
    }
    assert(JSON.stringify(scenario.snapshot()) === before, 'drawing blueprint changed simulation');
  });
  check('blueprint branches from foundation joints and reaches every planned segment', () => {
    const root = { row: 2, column: 1, horizontal: true, vertical: true, anchored: true, cleared: false };
    const planned = [
      { row: 2, column: 0, horizontal: true, cleared: true },
      { row: 2, column: 2, horizontal: true, cleared: true },
      { row: 1, column: 1, vertical: true, cleared: true },
      { row: 0, column: 1, horizontal: true, vertical: true, cleared: true },
      { row: 0, column: 0, horizontal: true, cleared: true },
      { row: 0, column: 2, horizontal: true, cleared: true },
    ];
    const blueprint = createConstructionBlueprint({
      left: 0, ground: 30, rows: 3, size: 10, sections: [root, ...planned],
    });
    assert(blueprint.segments(0).length === 0, 'blueprint appeared before reveal');
    const early = blueprint.segments(1 / 12);
    assert(early.length === 3, 'foundation did not produce three initial branches');
    assert(early.every((line) => Math.abs(Math.hypot(line.x2 - line.x1, line.y2 - line.y1) - 2.5) < 1e-8),
      'branches did not grow continuously from the foundation');
    assert(!early.some((line) => line.y1 < 15 || line.y2 < 15), 'upper lines appeared disconnected');
    const length = (segments) => segments.reduce((sum, line) =>
      sum + Math.hypot(line.x2 - line.x1, line.y2 - line.y1), 0);
    const half = length(blueprint.segments(0.5)), full = length(blueprint.segments(1));
    assert(half > length(early) && half < full && Math.abs(full - 70) < 1e-8,
      'reveal did not grow to cover every planned line');
    let failed = false;
    try { blueprint.segments(1.1); } catch (error) { failed = true; }
    assert(failed, 'invalid progress accepted');
    planned[0].cleared = false;
    assert(Math.abs(length(blueprint.segments(1)) - 60) < 1e-8, 'completed line stayed dotted');
  });
  check('construction starts with three free anchors and empty blueprint slots', () => {
    const build = createConstructionScenario();
    const { model } = build.scenario;
    assert(model.sections.filter((section) => section.attached && section.anchored).length === 3,
      'expected three anchors');
    assert(model.sections.filter((section) => section.cleared).length === model.sections.length - 3,
      'unfinished slots are not empty');
    assert(model.fragments.length === 0 && build.scenario.hm === 200, 'seed created debris or spent HM');
  });
  check('blueprint reveals first and building keeps its one-second cadence', () => {
    const build = createConstructionScenario();
    assert(build.blueprintProgress === 0, 'blueprint was initially visible');
    for (let i = 0; i < 120; i += 1) build.step();
    assert(build.blueprintProgress === 0.5 && build.scenario.hm === 200 &&
      build.scenario.model.sections.filter((s) => s.attached).length === 3,
      'halfway reveal changed construction');
    for (let i = 0; i < 120; i += 1) build.step();
    assert(build.blueprintProgress === 1 && build.ticks === 0 && build.scenario.hm === 200,
      'blueprint phase did not finish before work');
    for (let i = 0; i < 59; i += 1) build.step();
    assert(build.scenario.hm === 200 && build.scenario.model.sections.filter((s) => s.attached).length === 3,
      'work completed early');
    build.step();
    const count = build.scenario.model.sections.filter((s) => s.attached).length - 3;
    assert(count > 1 && build.scenario.hm === 200 - count * build.scenario.model.repairCost,
      'supported branches did not build together');
  });
  check('excavation releases the anchor and restoration alone does not reattach it', () => {
    const build = createConstructionScenario();
    const scenario = build.scenario;
    scenario.undermine(1);
    assert(scenario.foundationStatus()[1].anchored, 'anchor released before stepping');
    build.step();
    assert(!scenario.foundationStatus()[1].anchored, 'unsupported anchor survived');
    scenario.clearBuildingDebris();
    assert(scenario.restoreGround(1).ok, 'ground restoration failed');
    assert(!scenario.foundationStatus()[1].anchored, 'ground restoration reattached the anchor');
    for (let i = 0; i < 840 && !scenario.foundationStatus()[1].anchored; i += 1) build.step();
    assert(scenario.foundationStatus()[1].anchored, 'supported anchor did not rebuild');
  });
  check('destroyed foundation cannot spend resources rebuilding', () => {
    const build = createConstructionScenario();
    for (let i = 0; i < 3; i += 1) build.scenario.undermine(i);
    for (let i = 0; i < 300; i += 1) build.step();
    assert(build.result.state === 'Destroyed' && build.scenario.hm === 200 &&
      build.scenario.model.sections.every((s) => !s.attached), 'destroyed frame rebuilt or spent HM');
  });
  check('intact frame completes and automatic construction stops', () => {
    const build = createConstructionScenario();
    for (let i = 0; i < 6000 && !build.finished; i += 1) build.step();
    const model = build.scenario.model;
    assert(build.finished && build.result.state === 'Complete' &&
      model.sections.every((section) => section.attached && section.health === 100) &&
      model.bonds.every((bond) => bond.active), 'construction did not complete');
    assert(build.scenario.hm === 200 - (model.sections.length - 3) * model.repairCost,
      'completed work cost was incorrect');
    build.scenario.undermine(1);
    for (let i = 0; i < 120; i += 1) build.step();
    assert(build.finished && !build.scenario.foundationStatus()[1].anchored &&
      build.scenario.hm === 200 - (model.sections.length - 3) * model.repairCost,
      'work restarted after completion');
  });
  const results = document.getElementById('results');
  results.textContent = checks.join('\n');
  results.dataset.failed = String(checks.filter((item) => item.startsWith('FAIL')).length);
}());
