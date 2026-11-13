(function () {
  const checks = [];
  function check(name, test) {
    try {
      test();
      checks.push(`PASS ${name}`);
    } catch (error) {
      checks.push(`FAIL ${name}: ${error.message}`);
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function advance(model, count) {
    for (let i = 0; i < count; i += 1) model.step(1 / 60);
  }
  check('building has anchored poles, connected floors, roof and open bays', () => {
    const model = createCollapseModel();
    assert(model.sections.some((s) => s.row === 0 && s.column === 1), 'roof missing');
    assert(model.sections.some((s) => s.row === 3 && s.column === 1), 'floor missing');
    assert(model.sections.some((s) => s.row === 1 && s.column === 3), 'center pole missing');
    assert(!model.sections.some((s) => s.row === 1 && s.column === 1), 'bay should be open');
    assert(model.sections.filter((s) => s.anchored).length === 3, 'expected three anchored poles');
    advance(model, 180);
    assert(model.fragments.length === 0, 'intact frame collapsed');
    assert(model.sections.filter((s) => s.anchored).every((s) => s.y === model.ground - model.size), 'anchors moved');
  });
  check('partial damage leaves supported sections standing', () => {
    const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 0, ground: 60 });
    const roof = model.sections.find((s) => s.row === 0 && s.column === 0);
    model.blast(10, 10, 5, 30);
    assert(roof.health === 70, 'hit did not reduce section health');
    assert(model.sections.every((s) => s.attached), 'a supported section fell');
  });
  check('taller buildings have thicker, stronger walls throughout the frame', () => {
    const short = createCollapseModel({ columns: 3, rows: 9, size: 20, left: 100, ground: 300 });
    const medium = createCollapseModel({ columns: 3, rows: 10, size: 20, left: 100, ground: 300 });
    const tall = createCollapseModel({ columns: 3, rows: 11, size: 20, left: 100, ground: 300 });
    assert(medium.wallThickness === short.thickness * 1.5 && tall.wallThickness === short.thickness * 2,
      'wall width does not scale with height');
    const shortWall = short.sections.find((s) => s.row === 1 && s.column === 0);
    const tallWall = tall.sections.find((s) => s.row === 1 && s.column === 0);
    assert(!short.touchesRect(shortWall, shortWall.x + 11.3, shortWall.y + 4, 0.1, 1) &&
      tall.touchesRect(tallWall, tallWall.x + 11.3, tallWall.y + 4, 0.1, 1),
    'wall collision did not reflect the visible width');
    for (const model of [short, tall]) {
      for (const row of [1, model.rows - 2, model.rows - 1]) {
        const wall = model.sections.find((s) => s.row === row && s.column === 0);
        assert(Math.abs(model.sectionBounds(wall).right - model.sectionBounds(wall).left -
          (wall.horizontal ? model.size : model.wallThickness)) < 0.001, 'wall geometry has the wrong width');
        model.blast(wall.x + 10, wall.y + 10, 1, 30);
        assert(Math.abs(wall.health - (model === tall ? 85 : 70)) < 0.001, 'wall damage did not scale');
      }
    }
    const restored = createCollapseModel({ columns: 3, rows: 11, size: 20, left: 100, ground: 300 });
    restored.loadState(JSON.parse(JSON.stringify(tall.saveState())));
    assert(restored.wallThickness === tall.wallThickness &&
      restored.sections.find((s) => s.row === 10 && s.column === 0).health === 85, 'wall restore changed width or health');
    restored.repair(1, 10);
    assert(restored.sections.find((s) => s.row === 10 && s.column === 0).health === 100, 'damaged wall did not repair');
    const base = restored.sections.find((s) => s.row === 10 && s.column === 0);
    restored.blast(base.x + 10, base.y + 10, 1, 250);
    assert(!base.attached, 'thick wall could not be destroyed');
    base.x = 500; base.y = 20;
    restored.repair(1, 10);
    assert(base.attached && base.health === 100 && restored.wallThickness === short.thickness * 2,
      'destroyed wall did not rebuild at its original thickness');
  });
  check('thicker walls provide more load capacity', () => {
    const short = createCollapseModel({ columns: 1, rows: 9, size: 20, left: 100,
      ground: 300, loadEnabled: true, capacityFactor: 0.7 });
    const tall = createCollapseModel({ columns: 1, rows: 11, size: 20, left: 100,
      ground: 300, loadEnabled: true, capacityFactor: 0.7 });
    advance(short, 180);
    advance(tall, 180);
    assert(short.fragments.length > 0 && tall.fragments.length === 0,
      'thicker walls did not support the load that fails ordinary walls');
  });
  check('lost foundations release separate falling pieces', () => {
    const model = createCollapseModel();
    model.blast(320, 300, 95, 220);
    assert(model.fragments.length > 10, 'frame did not release its pieces');
    const above = model.fragments.find((s) => s.row === 0);
    const start = above.y;
    advance(model, 30);
    assert(above.y > start + 5, 'roof did not fall under gravity');
  });
  check('remaining anchor holds a connected frame', () => {
    const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 0, ground: 60 });
    const anchor = model.sections.find((s) => s.row === 2 && s.column === 0);
    model.blast(10, 50, 1, 150);
    assert(!anchor.attached, 'targeted anchor survived');
    assert(model.sections.some((s) => s.row === 0 && s.attached), 'connected roof detached');
    assert(model.fragments.length === 1, 'unexpected debris');
  });
  check('middle damage drops the roof and debris damages lower floors', () => {
    const model = createCollapseModel();
    advance(model, 60);
    model.blast(320, 190, 100, 175);
    const health = model.sections.map((s) => s.health);
    const roof = model.sections.filter((s) => s.row === 0);
    const roofHeight = roof.reduce((sum, s) => sum + s.y, 0) / roof.length;
    advance(model, 120);
    assert(model.sections.some((s) => s.anchored), 'undamaged anchors detached');
    assert(roof.reduce((sum, s) => sum + s.y, 0) / roof.length > roofHeight + 50, 'roof did not fall');
    assert(model.sections.some((s, i) => s.health < health[i]), 'falling pieces did not damage the frame');
  });
  check('settled members remain visible and can be scattered', () => {
    const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 100, ground: 120 });
    const beam = model.sections.find((s) => s.row === 0 && s.column === 1);
    model.blast(130, 70, 1, 150);
    advance(model, 240);
    assert(model.fragments.includes(beam), 'resting beam disappeared');
    const bounds = model.sectionBounds(beam);
    assert(bounds.right - bounds.left > model.thickness * 5, 'beam lost its length');
    assert(bounds.bottom - bounds.top < model.thickness * 2, 'beam became a block');
    model.blast(beam.x, beam.y + 10, 10, 150);
    assert(Math.abs(beam.vx) + Math.abs(beam.vy) > 1, 'beam did not scatter');
  });
  check('grounded debris slows down quickly but blasts can move it again', () => {
    const model = createCollapseModel({ columns: 1, rows: 1, size: 20, left: 100, ground: 120 });
    const piece = model.sections[0];
    model.blast(110, 110, 1, 150);
    piece.x = 100;
    piece.y = model.ground - model.size;
    piece.vx = 120;
    piece.vy = 0;
    const start = piece.x;
    advance(model, 60);
    assert(piece.x - start < 20 && piece.x > start, `ground slide distance ${piece.x - start}`);
    assert(Math.abs(piece.vx) < 1, `ground slide speed ${piece.vx}`);
    model.blast(piece.x + 5, piece.y + 10, 10, 100);
    assert(Math.abs(piece.vx) > 10, 'new blast did not scatter resting debris');
  });
  check('friction does not slow debris while airborne', () => {
    const model = createCollapseModel({ columns: 1, rows: 1, size: 20, left: 100, ground: 300 });
    const piece = model.sections[0];
    model.blast(110, 290, 1, 150);
    piece.x = 100;
    piece.y = 100;
    piece.vx = 120;
    piece.vy = 0;
    advance(model, 6);
    assert(piece.vx > 90, `airborne debris slowed excessively: ${piece.vx}`);
  });
  check('sliding slabs settle along flat and sloping ground', () => {
    for (const terrain of ['flat', 'uphill-right', 'downhill-right', 'valley']) {
      const model = createCollapseModel({ columns: 3, rows: 1, size: 20, left: 100, ground: 300, terrain });
      const slab = model.sections.find((s) => s.column === 1);
      model.blast(slab.x + 10, slab.y + 10, 1, 150);
      slab.x = 300; slab.y = 250; slab.angle = 0.3; slab.vx = 50; slab.vy = 0;
      slab.y -= model.groundPenetration(slab);
      advance(model, 240);
      const center = slab.x + model.size / 2;
      const slope = Math.atan2(model.surfaceAt(center + 1) - model.surfaceAt(center - 1), 2);
      assert(Math.abs(slab.angle - slope) < 0.01, `${terrain} slab did not settle to its surface`);
      assert(Math.abs(model.groundPenetration(slab)) < 0.02, `${terrain} slab left or penetrated ground`);
    }
  });
  check('impacting slabs eventually settle flat without overlap', () => {
    for (const offset of [-8, 8]) {
      const { model, upper, lower } = createCollapseImpactScenario(offset);
      advance(model, 500);
      assert(Math.abs(upper.angle) < 0.01 && Math.abs(lower.angle) < 0.01,
        `offset ${offset} slabs retained a tilt`);
      const hit = model.sectionOverlap(upper, lower);
      assert(!hit || hit.depth < 0.1, 'settled impact slabs overlap');
    }
  });
  check('a tilted slab settles onto a stationary slab without penetrating it', () => {
    const { model, upper, lower } = createCollapseImpactScenario(0);
    Object.assign(lower, { x: 200, y: 280, angle: 0, vx: 0, vy: 0, angularVelocity: 0 });
    lower.y -= model.groundPenetration(lower);
    Object.assign(upper, { x: 200, y: lower.y - 6, angle: 0.25, vx: 0, vy: 0, angularVelocity: 0 });
    for (let i = 0; i < 360; i += 1) {
      model.step(1 / 60);
      const hit = model.sectionOverlap(upper, lower);
      assert(!hit || hit.depth < 0.1, 'stacked slabs penetrated while settling');
    }
    assert(Math.abs(upper.angle - lower.angle) < 0.01 && upper.y < lower.y,
      'upper slab did not settle on its support');
  });
  check('airborne slabs do not flatten toward distant ground', () => {
    const model = createCollapseModel({ columns: 3, rows: 1, size: 20, left: 100, ground: 300 });
    const slab = model.sections.find((s) => s.column === 1);
    model.blast(slab.x + 10, slab.y + 10, 1, 150);
    slab.x = 300; slab.y = 50; slab.angle = 0.3; slab.vx = 0; slab.vy = 0; slab.angularVelocity = 0;
    advance(model, 6);
    assert(Math.abs(slab.angle - 0.3) < 0.001, 'airborne slab was flattened');
  });
  check('an off-center blast spins a falling line-shaped beam', () => {
    const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 100, ground: 200 });
    const beam = model.sections.find((s) => s.row === 0 && s.column === 1);
    model.blast(beam.x + 17, beam.y + 7, 5, 200);
    assert(!beam.attached && Math.abs(beam.angularVelocity) > 0.1, 'off-center blast imparted no spin');
    beam.x = 300; beam.y = 30; beam.vx = 0; beam.vy = 0;
    advance(model, 10);
    assert(Math.abs(beam.angle) > 0.02, 'airborne beam did not rotate');
    assert(model.thickness < model.size / 4, 'beam lost line geometry');
  });
  check('opposite blast offsets spin beams in opposite directions', () => {
    const spins = [3, 10, 17].map((offset) => {
      const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 100, ground: 200 });
      const beam = model.sections.find((s) => s.row === 0 && s.column === 1);
      model.blast(beam.x + offset, beam.y + 7, 5, 200);
      return beam.angularVelocity;
    });
    check('experimental impact spin responds to offset without overlap in an isolated pair', () => {
      const angles = [];
      for (const offset of [-8, 0, 8]) {
        const { model, upper, lower } = createCollapseImpactScenario(offset);
        let largest = 0;
        let maxOverlap = 0;
        for (let i = 0; i < 20; i += 1) {
          model.step(1 / 60);
          if (Math.abs(upper.angle) > Math.abs(largest)) largest = upper.angle;
          const hit = model.sectionOverlap(upper, lower);
          if (hit) maxOverlap = Math.max(maxOverlap, hit.depth);
        }
        assert(maxOverlap < 0.1, `isolated impact overlap ${maxOverlap}`);
        angles.push(largest);
      }
      assert(angles[0] < -0.01 && Math.abs(angles[1]) < 0.001 && angles[2] > 0.01,
        `unexpected impact angles ${angles.join(', ')}`);
    });
    check('experimental impact spin matches spatial search and restores its mode', () => {
      const full = createCollapseImpactScenario(8);
      const indexed = createCollapseImpactScenario(8, { optimizeCollisionSearch: true });
      for (let i = 0; i < 40; i += 1) {
        full.model.step(1 / 60);
        indexed.model.step(1 / 60);
        assert(JSON.stringify(full.model.saveState()) === JSON.stringify(indexed.model.saveState()), `impact search mismatch at ${i}`);
        if (i === 10) indexed.model.loadState(JSON.parse(JSON.stringify(indexed.model.saveState())));
      }
      const ordinary = createCollapseModel({ columns: 3, rows: 4, size: 20, left: 100, ground: 300 });
      const before = JSON.stringify(ordinary.saveState());
      let rejected = false;
      try { ordinary.loadState(full.model.saveState()); } catch (error) { rejected = true; }
      assert(rejected, 'experimental save loaded into a different simulation mode');
      assert(JSON.stringify(ordinary.saveState()) === before, 'failed load changed the current model');
      const oldSave = ordinary.saveState();
      delete oldSave.experimentalImpactSpin;
      ordinary.loadState(oldSave);
      assert(JSON.stringify(ordinary.saveState()) === before, 'older normal-mode save failed to load');
    });
    assert(spins[0] < -0.1 && Math.abs(spins[1]) < 0.001 && spins[2] > 0.1,
      `unexpected blast rotations: ${spins.join(', ')}`);
  });
  check('supported debris slows on a ledge and on sloping terrain', () => {
    const ledge = createCollapseModel({ columns: 1, rows: 2, size: 20, left: 100, ground: 100 });
    const top = ledge.sections.find((s) => s.row === 0);
    ledge.blast(110, 70, 1, 150);
    top.x = 100; top.y = 59.9; top.vx = 5; top.vy = 0;
    advance(ledge, 60);
    assert(top.x - 100 < 1 && Math.abs(top.vx) < 1, 'ledge debris did not slow');
    for (const terrain of ['uphill-right', 'downhill-right', 'valley']) {
      const model = createCollapseModel({ columns: 1, rows: 1, size: 20, left: 100, ground: 120, terrain });
      const piece = model.sections[0];
      model.blast(110, model.ground - 10, 5, 150);
      piece.x = 100; piece.y = 50;
      piece.y -= model.groundPenetration(piece);
      piece.vx = 100; piece.vy = 0;
      advance(model, 60);
      assert(piece.x - 100 < 20 && Math.abs(piece.vx) < 1, `${terrain}: debris did not slow`);
    }
  });
  check('blasts and collision use the line, not its surrounding cell', () => {
    const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 100, ground: 120 });
    const beam = model.sections.find((s) => s.row === 0 && s.column === 1);
    model.blast(122, 62, 1, 150);
    assert(beam.health === 100, 'empty corner damaged the beam');
    assert(!model.touchesRect(beam, 121, 61, 3, 3), 'empty corner collided');
    assert(model.touchesRect(beam, 125, 68, 3, 4), 'beam did not collide');
    const parallel = { ...beam, y: beam.y + 5 };
    assert(!model.sectionOverlap(beam, parallel), 'separate parallel lines collided as squares');
    parallel.y = beam.y + model.thickness / 2;
    assert(model.sectionOverlap(beam, parallel), 'overlapping lines did not collide');
    model.blast(130, 70, 1, 150);
    assert(!beam.attached, 'hit on the line missed');
    beam.angle = Math.PI / 4;
    assert(model.touchesRect(beam, 135, 75, 2, 2), 'rotated beam collision missed');
    assert(!model.touchesRect(beam, 135, 63, 2, 2), 'rotated beam retained a square hitbox');
  });
  check('empty portions of a debris cell do not injure the trooper', () => {
    const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 100, ground: 120 });
    const beam = model.sections.find((s) => s.row === 0 && s.column === 1);
    model.blast(130, 70, 1, 150);
    const trooper = createCollapseTrooper(model, 100, 1);
    beam.x = 100; beam.y = 50; beam.previousX = 100; beam.previousY = 50;
    beam.vx = 100; beam.vy = 0; beam.impactSpeed = 100;
    trooper.x = 110; trooper.y = 54;
    trooper.step(1 / 60);
    assert(trooper.health === 100, 'empty corner caused an injury');
  });
  check('loose members tip and fall when their center passes a ledge', () => {
    const model = createCollapseModel({ columns: 1, rows: 2, size: 20, left: 100, ground: 100 });
    const top = model.sections.find((s) => s.row === 0);
    model.blast(110, 70, 1, 150);
    top.x = 112;
    top.y = 59.9;
    top.vx = 0;
    top.vy = 0;
    let maxAngle = 0;
    for (let i = 0; i < 100; i += 1) {
      model.step(1 / 60);
      maxAngle = Math.max(maxAngle, top.angle);
    }
    assert(top.x > 120 && top.y > 70, 'overhanging piece did not fall off the edge');
    assert(maxAngle > 0.02, 'overhanging piece did not tip');
    assert(Math.abs(top.angularVelocity) < 0.01, 'piece kept spinning after landing');
  });
  check('center-supported debris stays on its ledge', () => {
    const model = createCollapseModel({ columns: 1, rows: 2, size: 20, left: 100, ground: 100 });
    const top = model.sections.find((s) => s.row === 0);
    model.blast(110, 70, 1, 150);
    top.x = 100;
    top.y = 59.9;
    top.vx = 0;
    top.vy = 0;
    advance(model, 100);
    assert(top.y < 60.5 && Math.abs(top.x - 100) < 1, 'supported piece slipped off');
  });
  check('debris also falls from the left edge', () => {
    const model = createCollapseModel({ columns: 1, rows: 2, size: 20, left: 100, ground: 100 });
    const top = model.sections.find((s) => s.row === 0);
    model.blast(110, 70, 1, 150);
    top.x = 88;
    top.y = 59.9;
    top.vx = 0;
    top.vy = 0;
    let minAngle = 0;
    for (let i = 0; i < 100; i += 1) {
      model.step(1 / 60);
      minAngle = Math.min(minAngle, top.angle);
    }
    assert(top.x < 80 && top.y > 70 && minAngle < -0.02, 'piece did not tip and fall left');
  });
  check('members collide and do not pass through each other', () => {
    const model = createCollapseModel({ columns: 1, rows: 2, size: 20, left: 100, ground: 60 });
    model.blast(110, 50, 100, 200);
    advance(model, 300);
    const [a, b] = model.sections;
    const hit = model.sectionOverlap(a, b);
    assert(!hit || hit.depth < 0.75, 'members overlapped after settling');
    assert(model.sections.every((member) => model.sectionBounds(member).bottom <= model.ground + 0.01), 'member fell through ground');
  });
  check('rotated debris stays separated and stops spinning', () => {
    const model = createCollapseModel();
    model.blast(320, 300, 95, 220);
    for (let step = 0; step < 400; step += 1) {
      model.step(1 / 60);
      for (let i = 0; i < model.sections.length; i += 1) {
        const a = model.sections[i];
        for (let j = i + 1; j < model.sections.length; j += 1) {
          const b = model.sections[j];
          const hit = model.sectionOverlap(a, b);
          assert(!hit || hit.depth < 0.75, `visible members overlap by ${hit && hit.depth.toFixed(2)} pixels`);
        }
      }
    }
    assert(model.fragments.every((s) => Math.abs(s.angularVelocity) < 0.05), 'debris continues spinning');
  });
  check('trooper reaches each floor and returns from the roof', () => {
    const model = createCollapseModel({ columns: 11, rows: 11, size: 26, left: 177, ground: 310, shaftColumn: 1, openGround: true });
    const trooper = createCollapseTrooper(model, 177, 1);
    assert(!model.sections.some((s) => s.row === 10 && s.column === 1), 'ground-floor entrance is blocked');
    for (const row of [0, 3, 6, 9]) {
      const section = model.sections.find((s) => s.row === row && s.column === 1);
      assert(section && section.attached && section.horizontal, `ladder interrupted structural floor ${row}`);
      const left = model.sections.find((s) => s.row === row && s.column === 0);
      const right = model.sections.find((s) => s.row === row && s.column === 2);
      assert(model.bonds.some((bond) => bond.active && bond.a === left && bond.b === section) &&
        model.bonds.some((bond) => bond.active && bond.a === section && bond.b === right),
      `floor ${row} is not connected through the ladder`);
    }
    for (const floor of [0, 1, 2, 3, 4, 0]) {
      trooper.requestFloor(floor);
      for (let i = 0; i < 1400 && trooper.state === 'Moving'; i += 1) {
        model.step(1 / 60);
        trooper.step(1 / 60);
      }
      assert(trooper.floor === floor && trooper.state === 'At destination', `failed to reach floor ${floor}`);
    }
  });
  check('destroyed landing blocks the trooper route', () => {
    const model = createCollapseModel({ columns: 11, rows: 11, size: 26, left: 177, ground: 310, shaftColumn: 1, openGround: true });
    const trooper = createCollapseTrooper(model, 177, 1);
    const landing = model.sections.find((s) => s.row === 6 && s.column === 2);
    model.blast(landing.x + 13, landing.y + 13, 1, 150);
    trooper.requestFloor(4);
    trooper.step(1 / 60);
    assert(trooper.state === 'Route blocked by collapse', 'trooper used a destroyed landing');
  });
  check('trooper can change destination while climbing', () => {
    const model = createCollapseModel({ columns: 11, rows: 11, size: 26, left: 177, ground: 310, shaftColumn: 1, openGround: true });
    const trooper = createCollapseTrooper(model, 177, 1);
    trooper.requestFloor(4);
    for (let i = 0; i < 160; i += 1) trooper.step(1 / 60);
    assert(trooper.y < model.ground - 10, 'trooper did not start climbing');
    trooper.requestFloor(0);
    for (let i = 0; i < 600 && trooper.state === 'Moving'; i += 1) trooper.step(1 / 60);
    assert(trooper.state === 'At destination' && Math.abs(trooper.y - model.ground) < 0.1, 'trooper did not return to ground');
  });
  check('connectors resist small strain and snap under large strain', () => {
    const model = createCollapseModel({ columns: 1, rows: 2, size: 20, left: 100, ground: 100 });
    const bond = model.bonds[0];
    bond.a.x += 1;
    model.step(1 / 120);
    assert(bond.active && bond.a.attached, 'small strain broke the frame');
    bond.a.x += 12;
    model.step(1 / 120);
    assert(!bond.active && !bond.a.attached, 'large strain did not break the connector');
  });
  check('partial collapse rebuilds with HM and restores its ladder and connectors', () => {
    const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 100, ground: 120 });
    const section = model.sections.find((s) => s.row === 1 && s.column === 0);
    model.blast(110, 90, 1, 150);
    assert(!model.ladderSegment(1), 'damaged ladder survived');
    let hm = 20;
    for (let i = 0; i < 300; i += 1) {
      model.step(1 / 60);
      const result = model.repair(1 / 60, hm);
      hm -= result.spent;
      if (result.state === 'Complete') break;
    }
    assert(section.attached && model.ladderSegment(1), 'ladder was not rebuilt');
    assert(model.bonds.some((bond) => bond.active && (bond.a === section || bond.b === section)), 'connectors were not restored');
    assert(hm === 20 - model.repairCost && section.health === 100, 'repair did not spend the expected HM');
    assert(!model.fragments.includes(section), 'rebuilt section remained as debris');
  });
  check('rebuilding waits for HM and blocked sites, then resumes', () => {
    const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 100, ground: 120 });
    const section = model.sections.find((s) => s.row === 0 && s.column === 0);
    model.blast(110, 70, 1, 150);
    assert(model.repair(2, 0).state === 'Waiting for HM' && !section.attached, 'repair ignored insufficient HM');
    assert(model.repair(2, 4, () => true).state === 'Blocked' && !section.attached, 'repair ignored an occupied site');
    const result = model.repair(1, 4);
    assert(result.spent === model.repairCost && section.attached, 'repair did not resume');
  });
  check('fully destroyed buildings do not rebuild', () => {
    const model = createCollapseModel({ columns: 1, rows: 1, size: 20, left: 100, ground: 120 });
    model.blast(110, 110, 1, 150);
    const result = model.repair(10, 100);
    assert(result.state === 'Destroyed' && result.spent === 0 && !model.sections[0].attached,
      'destroyed building rebuilt');
  });
  check('a broken connector between surviving sections can be repaired', () => {
    const model = createCollapseModel({ columns: 3, rows: 3, size: 20, left: 100, ground: 120 });
    const bond = model.bonds.find((item) => item.a.row === 0 && item.b.row === 0);
    bond.active = false;
    const result = model.repair(1, 4);
    assert(result.spent === model.repairCost && bond.active && bond.stress === 0, 'connector was not repaired');
  });
  check('the lab middle blast can be fully rebuilt', () => {
    const model = createCollapseModel({ columns: 11, rows: 11, size: 26, left: 177, ground: 310, shaftColumn: 1, openGround: true });
    model.blast(320, 190, 100, 175);
    let hm = 200;
    for (let i = 0; i < 3600; i += 1) {
      model.step(1 / 60);
      const result = model.repair(1 / 60, hm);
      hm -= result.spent;
      if (result.state === 'Complete') break;
    }
    assert(model.sections.every((section) => section.attached && section.health === 100),
      'middle blast did not fully rebuild');
    assert(hm >= 0 && hm < 200, 'rebuilding did not charge HM');
  });
  check('manual controls move and climb only on intact ladder segments', () => {
    const model = createCollapseModel({ columns: 11, rows: 11, size: 26, left: 177, ground: 310, shaftColumn: 1, openGround: true });
    const trooper = createCollapseTrooper(model, 177, 1);
    const start = trooper.x;
    trooper.input.right = true;
    for (let i = 0; i < 55; i += 1) trooper.step(1 / 60);
    assert(trooper.x > start + 50, 'trooper did not move right');
    trooper.input.right = false;
    trooper.input.left = true;
    for (let i = 0; i < 55; i += 1) trooper.step(1 / 60);
    assert(Math.abs(trooper.x - start) < 1, 'trooper did not move left');
    trooper.input.left = false;
    trooper.x = 177 + 1.5 * model.size;
    trooper.input.up = true;
    for (let i = 0; i < 60; i += 1) trooper.step(1 / 60);
    assert(trooper.y < model.ground - 40, 'trooper did not climb');
    for (let i = 0; i < 250; i += 1) trooper.step(1 / 60);
    assert(trooper.y < model.ground - 200, 'intact floor lines blocked ladder climbing');
    trooper.input.up = false;
    const heldHeight = trooper.y;
    for (let i = 0; i < 30; i += 1) trooper.step(1 / 60);
    assert(Math.abs(trooper.y - heldHeight) < 0.1, 'trooper could not pause on ladder');
    trooper.input.down = true;
    for (let i = 0; i < 10; i += 1) trooper.step(1 / 60);
    assert(trooper.y > heldHeight + 5, 'trooper could not climb down');
    trooper.input.down = false;
    trooper.input.up = true;
    const row = Math.floor((trooper.y - 1 - (model.ground - model.rows * model.size)) / model.size);
    const support = model.sections.find((s) => s.row === row && s.column === 0);
    model.blast(support.x + 13, support.y + 13, 1, 320);
    assert(!model.ladderSegment(row), 'destroyed frame retained its ladder');
    const before = trooper.y;
    for (let i = 0; i < 15; i += 1) trooper.step(1 / 60);
    assert(trooper.y > before, 'trooper remained suspended on destroyed ladder');
  });
  check('moving debris damages the trooper but resting debris does not', () => {
    const model = createCollapseModel({ columns: 1, rows: 1, size: 20, left: 100, ground: 100 });
    const trooper = createCollapseTrooper(model, 100, 1);
    const block = model.sections[0];
    model.blast(110, 90, 1, 150);
    trooper.x = 110; trooper.y = 90;
    block.x = 100; block.y = 65; block.previousX = 100; block.previousY = 55;
    block.vx = 0; block.vy = 120; block.impactSpeed = 120;
    trooper.step(1 / 60);
    assert(trooper.health < 100, 'moving debris caused no damage');
    const health = trooper.health;
    trooper.step(1 / 60);
    assert(trooper.health === health, 'same contact caused repeated damage');
    block.x = 200; block.previousX = 200;
    trooper.step(1 / 60);
    block.x = 100; block.previousX = 100; block.vy = 0; block.impactSpeed = 0;
    trooper.step(1 / 60);
    assert(trooper.health === health, 'stationary debris caused damage');
  });
  check('intact supports hold their load but weak supports progressively fail', () => {
    const model = createCollapseModel({ loadEnabled: true });
    advance(model, 180);
    assert(model.fragments.length === 0, 'intact building failed under its own weight');
    const support = model.sections.find((s) => s.row === model.rows - 1 && s.column === 3);
    support.health = 20;
    advance(model, 600);
    assert(!support.attached, 'overloaded support did not fail');
    assert(model.fragments.length > 1, 'failure did not propagate');
  });
  check('sloped and valley sites generate stable frames and keep debris above the surface', () => {
    for (const terrain of ['uphill-right', 'downhill-right', 'valley']) {
      const model = createCollapseModel({ terrain, loadEnabled: true });
      advance(model, 60);
      assert(model.fragments.length === 0, `${terrain} frame collapsed without damage`);
      model.blast(320, model.ground - 10, 95, 220);
      advance(model, 120);
      for (const section of model.fragments) {
        assert(model.groundPenetration(section) < 0.1, `${terrain} debris fell through ground`);
      }
    }
  });
  check('save restores moving fragments, bonds and repair progress', () => {
    const options = { terrain: 'uphill-right', loadEnabled: true };
    const original = createCollapseModel(options);
    original.blast(320, original.ground - 100, 40, 120);
    advance(original, 10);
    original.sections.find((section) => section.attached).health = 80;
    const result = original.repair(0.25, 1000);
    assert(result.state === 'Rebuilding', 'repair did not start');
    const saved = JSON.parse(JSON.stringify(original.saveState()));
    assert(saved.repairProgress === 0.25, 'repair progress was not saved');
    const restored = createCollapseModel(options);
    restored.loadState(saved);
    assert(JSON.stringify(restored.saveState()) === JSON.stringify(saved), 'snapshot did not round-trip');
    advance(original, 30);
    advance(restored, 30);
    assert(JSON.stringify(restored.saveState()) === JSON.stringify(original.saveState()), 'continuation diverged');
    saved.sections[0].x = null;
    let rejected = false;
    try { restored.loadState(saved); } catch (error) { rejected = true; }
    assert(rejected, 'invalid save was accepted');
  });
  check('larger frames cost more to repair', () => {
    const small = createCollapseModel({ columns: 3, rows: 3 });
    const large = createCollapseModel({ columns: 11, rows: 11 });
    assert(small.repairCost >= 1 && large.repairCost > small.repairCost, 'repair cost did not scale');
  });
  check('optimized support search matches full search through collapse and rebuilding', () => {
    for (const terrain of ['flat', 'uphill-right', 'downhill-right', 'valley']) {
      const options = { columns: 11, rows: 11, size: 26, left: 177, ground: 310,
        shaftColumn: 1, openGround: true, terrain, loadEnabled: true };
      const full = createCollapseModel({ ...options, optimizeSupportSearch: false });
      const optimized = createCollapseModel({ ...options, optimizeCollisionSearch: true });
      let debrisSeen = false;
      for (let step = 0; step < 240; step += 1) {
        for (const model of [full, optimized]) {
          if (step === 10) model.blast(320, 190, 100, 175);
          if (step === 120) model.blast(260, 260, 35, 100);
          model.step(1 / 60);
        }
        const repairFull = full.repair(1 / 60, 1000);
        const repairOptimized = optimized.repair(1 / 60, 1000);
        assert(JSON.stringify(repairFull) === JSON.stringify(repairOptimized), `${terrain}: repair diverged at ${step}`);
        assert(JSON.stringify(full.saveState()) === JSON.stringify(optimized.saveState()), `${terrain}: state diverged at ${step}`);
        debrisSeen = debrisSeen || full.fragments.length > 0;
        if (step === 150) optimized.loadState(JSON.parse(JSON.stringify(optimized.saveState())));
      }
      assert(debrisSeen, `${terrain}: no debris generated`);
    }
  });
  check('spatial collision lookup preserves rotated and crowded debris behavior', () => {
    const options = { columns: 5, rows: 5, size: 20, left: 150, ground: 200 };
    const full = createCollapseModel({ ...options, optimizeSupportSearch: false });
    const indexed = createCollapseModel({ ...options, optimizeCollisionSearch: true });
    for (const model of [full, indexed]) {
      model.blast(200, 190, 100, 300);
      model.fragments.forEach((section, i) => {
        section.x = 185 + (i % 5) * 7;
        section.y = 95 + Math.floor(i / 5) * 8;
        section.angle = (i % 7 - 3) * Math.PI / 8;
        section.vx = (i % 3 - 1) * 40;
        section.vy = 35;
      });
    }
    assert(full.fragments.length > 10, 'test did not create crowded debris');
    for (let step = 0; step < 160; step += 1) {
      if (step === 40) {
        full.blast(200, 150, 45, 80);
        indexed.blast(200, 150, 45, 80);
      }
      full.step(1 / 60);
      indexed.step(1 / 60);
      assert(JSON.stringify(full.saveState()) === JSON.stringify(indexed.saveState()), `crowded debris diverged at ${step}`);
    }
  });
  const results = document.getElementById('results');
  results.textContent = checks.join('\n');
  results.dataset.failed = String(checks.filter((item) => item.startsWith('FAIL')).length);
}());
