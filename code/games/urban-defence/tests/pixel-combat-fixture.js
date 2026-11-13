function runPixelCombatFixtureChecks() {
  const lines = [], assert = (value, message) => { if (!value) throw new Error(message); };
  const check = (name, run) => {
    try { run(); lines.push(`PASS ${name}`); } catch (error) { lines.push(`FAIL ${name}: ${error.message}`); }
  };
  check('quarter-size native artwork has bounded unique collision pixels and integer foot anchors for all units', () => {
    for (const [reference, roles, inPlace] of [
      [PIXEL_UNIT_REFERENCE, undefined, false], [PIXEL_TANK_REFERENCE, ['move', 'aim'], false],
      [PIXEL_HOPPER_REFERENCE, ['idle', 'jump', 'boost', 'fall'], true],
      [PIXEL_JET_REFERENCE, ['fly', 'shoot', 'down'], false],
    ]) {
      const options = { roles, inPlace, cellScale: 1 };
      const original = createPixelUnitArtwork(reference, options);
      const reduced = createPixelUnitArtwork(reference, { ...options, cellReduction: 4 });
      assert(reduced.width === Math.ceil(original.width / 4) && reduced.height === Math.ceil(original.height / 4) &&
        Number.isInteger(reduced.footRow), 'artwork dimensions or foot anchor did not shrink physically');
      for (const role of roles || ['walk', 'jump', 'crouch', 'crouchWalk']) {
        for (let index = 0; index < reduced.frameCount(role); index += 1) for (const facing of [-1, 1]) {
          const pixels = reduced.frame(role, index, facing).pixels;
          assert(pixels.length > 0 && pixels.every((pixel) =>
            Number.isInteger(pixel.x) && Number.isInteger(pixel.y) &&
            pixel.x >= 0 && pixel.x < reduced.width && pixel.y >= 0 && pixel.y < reduced.height) &&
            new Set(pixels.map((pixel) => pixel.y * reduced.width + pixel.x)).size === pixels.length,
          'reduced frame has missing, fractional, duplicated or out-of-bounds pixels');
          const visible = pixels.flatMap((pixel) => pixel.details.map((detail) =>
            `${Math.round((pixel.x + detail.x) * 4)},${Math.round((pixel.y + detail.y) * 4)},${detail.color}`)).sort();
          const native = original.frame(role, index, facing);
          const padding = facing === (reference.nativeFacing === undefined ? -1 : reference.nativeFacing) ?
            0 : reduced.width * 4 - original.width;
          const expected = native.pixels.map((pixel) => `${pixel.x + padding},${pixel.y},${pixel.color}`).sort();
          assert(JSON.stringify(visible) === JSON.stringify(expected) &&
            reduced.frame(role, index, facing).durationMs === native.durationMs,
          'fine-resolution artwork lost or altered source pixels, colors, alpha or GIF timing');
        }
      }
      for (const facing of [-1, 1]) {
        const mask = new Set(reduced.mask('standing', facing).map((pixel) => pixel.y * reduced.width + pixel.x));
        for (const role of roles || ['walk', 'jump']) for (let index = 0; index < reduced.frameCount(role); index += 1) {
          assert(reduced.frame(role, index, facing).pixels.every((pixel) => mask.has(pixel.y * reduced.width + pixel.x)),
            'collision mask does not contain reduced artwork');
        }
      }
      const world = createParticleWorld(320, 180);
      for (let x = 0; x < world.width; x += 1) for (let y = 150; y < world.height; y += 1) {
        world.set(x, y, PARTICLE_TERRAIN);
      }
      const kind = reference === PIXEL_UNIT_REFERENCE ? 'trooper' : reference === PIXEL_TANK_REFERENCE ? 'tank' :
        reference === PIXEL_HOPPER_REFERENCE ? 'hopper' : 'jet';
      const placement = { kind, x: 70, y: kind === 'jet' ? 90 : 150 - reduced.footRow, facing: 1 };
      const unit = kind === 'trooper' ? createPixelTerrainUnit(world, reduced, placement) :
        createPixelVehicleUnit(world, reduced, placement);
      unit.input.right = true;
      for (let tick = 0; tick < 120; tick += 1) {
        unit.step();
        const state = unit.inspect();
        assert(Number.isInteger(state.x) && Number.isInteger(state.y) &&
          !findPixelUnitContact(world, state.x, state.y, state.collision),
        `${kind} reduced moving collision mask overlaps terrain or has a fractional position`);
        if (kind !== 'jet') {
          const bottom = Math.max(...state.pixels.flatMap((pixel) => pixel.details.map((detail) =>
            state.y + pixel.y + detail.y + detail.size + pixelUnitGroundArtworkOffset(state))));
          assert(state.grounded && state.y + state.footRow === 150 && bottom === 150,
            `${kind} feet/treads are not planted on the physical ground`);
        }
      }
    }
  });
  check('fixture has singly-owned physical towers, silos, hangars, separate cores, hills and a genuine water basin', () => {
    const scene = createPixelCombatFixture();
    assert(scene.buildings.length === 6 && scene.ownership.size === scene.initial.material, 'building ownership is duplicated');
    const cells = new Uint8Array(scene.world.width * scene.world.height);
    scene.world.copyCells(cells);
    assert(cells[350 * scene.world.width + 575] === PARTICLE_WATER, 'raster copy omitted water');
    cells[350 * scene.world.width + 575] = PARTICLE_EMPTY;
    assert(scene.world.at(575, 350) === PARTICLE_WATER, 'raster copy mutated the physical world');
    for (const type of ['population', 'farm', 'military']) assert(scene.buildings.filter((b) => b.type === type).length === 2, `missing ${type}`);
    assert(scene.world.at(575, 350) === PARTICLE_WATER && scene.world.at(575, 375) === PARTICLE_TERRAIN &&
      scene.world.at(710, 260) === PARTICLE_TERRAIN && scene.world.at(410, 302) === PARTICLE_TERRAIN, 'basin or mountains are only cosmetic');
    for (const base of scene.bases) for (const cell of base.frame.core) {
      assert(scene.ownership.get(cell.y * scene.world.width + cell.x).role === 'core', 'core is also frame material');
    }
    scene.configure({ spawning: false, devices: false, fighting: false });
    for (let i = 0; i < 60; i += 1) scene.step();
    assert(scene.world.barrierCount === scene.initial.material && scene.bases.every(scene.activeCore), 'generated frame is unsupported');
    scene.audit();
  });
  check('all types emerge from real clear base space; living/core/lifetime limits gate spawning', () => {
    const scene = createPixelCombatFixture(), base = scene.bases[0];
    for (const kind of ['trooper', 'tank', 'hopper', 'jet']) {
      const result = scene.spawn(base, kind), state = result.entry.unit.inspect();
      assert(result.ok && !findPixelUnitContact(scene.world, state.x, state.y, state.collision, false,
        scene.buildingLayers.contactOptions(kind, base.owner).ignoreMaterial), `${kind} overlaps a blocking factory layer`);
      assert(state.x >= base.frame.left && state.x + state.width <= base.frame.left + base.frame.width, 'unit larger than base');
    }
    assert(!scene.spawn(base).ok, 'living limit ignored');
    base.spawned = 64; assert(!scene.spawn(base).ok, 'lifetime limit ignored');
    const other = scene.bases[1], core = other.frame.core[0];
    scene.combat.launch('blue', { x: core.x - 22, y: core.y }, core);
    scene.configure({ spawning: false, devices: false, fighting: false });
    for (let i = 0; i < 60 && scene.activeCore(other); i += 1) scene.step();
    assert(!scene.activeCore(other) && !scene.spawn(other).ok, 'dead core still produces');
    scene.audit();
  });
  check('all four original artwork types fire their weapon AND take real damage', () => {
    const assets = createPixelCombatFixture().artworks;
    for (const kind of ['trooper', 'tank', 'hopper', 'jet']) {
      const world = createParticleWorld(800, 360, { skipEmptyChunks: true });
      for (let x = 0; x < world.width; x += 1) for (let y = 330; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      const art = assets.get(kind);
      const make = (x, facing, ownerId) => kind === 'trooper' ?
        createPixelTerrainUnit(world, art, { x, y: 100, facing, ownerId }) :
        createPixelVehicleUnit(world, art, { kind, x, y: 100, facing, ownerId });
      const a = make(100, 1, 'blue'), b = make(430, -1, 'red'), combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
      combat.register('a', a, kind, 'blue'); combat.register('b', b, kind, 'red');
      const aim = (unit) => {
        const state = unit.inspect(), pixel = state.pixels[Math.floor(state.pixels.length / 2)];
        return { x: state.x + pixel.x, y: state.y + pixel.y };
      };
      if (kind === 'tank') { combat.layGun('a', aim(b)); combat.layGun('b', aim(a)); }
      assert(combat.fire('a', aim(b)).ok && combat.fire('b', aim(a)).ok, `${kind} cannot shoot`);
      for (let i = 0; i < 180; i += 1) { world.step(); combat.step(); }
      assert(combat.health('a').health < combat.health('a').maxHealth && combat.health('b').health < combat.health('b').maxHealth,
        `${kind} shot did not damage both owners`);
      assert(kind === 'hopper' ? combat.inspect().issuedAmmoDebris === 0 :
        combat.inspect().issuedAmmoDebris > 0, 'unit ammunition debris rule incorrect');
      const hits = combat.inspect({ sprites: false }).impacts.filter((hit) => hit.reason === 'unit' && hit.kind !== 'fragment');
      assert(hits.length === 2 && hits.every((hit) => hit.damage === PIXEL_LAB_WEAPONS[kind].damage &&
        hit.health === PIXEL_LAB_WEAPONS[kind].health - hit.damage && hit.tick > 0 &&
        hit.shooterId && hit.ownerId && (kind === 'hopper' ? hit.particles.ammo === 0 : hit.particles.ammo > 0)),
      'damage log does not match actual hits');
      const copy = combat.inspect({ sprites: false }).impacts;
      copy[0].particles.ammo = -1;
      assert(combat.inspect({ sprites: false }).impacts[0].particles.ammo >= 0, 'inspection mutated impact accounting');
    }
  });
  check('blocked or flooded spawn masks wait without consuming units and retry after clearance', () => {
    for (const kind of ['trooper', 'tank', 'hopper', 'jet']) {
      const scene = createPixelCombatFixture(), base = scene.bases[0], art = scene.artworks.get(kind);
      const x = base.frame.left + 16, y = kind === 'jet' ? base.frame.top - art.height - 12 :
        (kind === 'trooper' ? 329 : 330) - art.footRow;
      const options = { x, y, facing: 1, ...scene.buildingLayers.contactOptions(kind, base.owner) };
      const probe = kind === 'trooper' ? createPixelTerrainUnit(scene.world, art, options) :
        createPixelVehicleUnit(scene.world, art, { ...options, kind });
      const pixel = probe.inspect().collision[0], px = x + pixel.x, py = y + pixel.y;
      assert(scene.world.at(px, py) === PARTICLE_EMPTY, 'probe is not in empty hangar space');
      const clear = scene.world.snapshot();
      for (const material of [PARTICLE_TERRAIN, PARTICLE_WATER]) {
        scene.world.set(px, py, material);
        for (let i = 0; i < 3; i += 1) {
          const result = scene.spawn(base, kind);
          assert(!result.ok && result.reason.includes(material === PARTICLE_WATER ? 'water' : 'terrain'),
            `${kind} spawned inside occupied mask`);
        }
        assert(base.spawned === 0 && base.nextKind === 0 && scene.units.length === 0 &&
          scene.combat.inspect({ sprites: false }).units.length === 0, 'rejection consumed or registered a unit');
        scene.world.restore(clear);
      }
      const result = scene.spawn(base, kind);
      assert(result.ok && result.entry.id === `blue-${kind}-1` && base.spawned === 1, 'clear spawn did not retry cleanly');
      scene.configure({ spawning: false, devices: false, fighting: false });
      scene.step(); scene.audit();
    }
  });
  check('firing paths detect thin cover and automatic units reposition without firing through hills', () => {
    const scene = createPixelCombatFixture();
    const a = scene.spawn(scene.bases[0], 'trooper').entry;
    const b = scene.spawn(scene.bases[1], 'trooper').entry;
    const state = b.unit.inspect(), pixel = state.pixels[Math.floor(state.pixels.length / 2)];
    const path = scene.combat.firingPath(a.id, { x: state.x + pixel.x, y: state.y + pixel.y });
    assert(!path.clear && path.reason === 'terrain', 'hill did not block sight');
    const start = a.unit.inspect().x;
    scene.configure({ spawning: false, devices: false, fighting: true });
    for (let i = 0; i < 30; i += 1) scene.step();
    assert(scene.combat.inspect({ sprites: false }).fired === 0 && a.unit.inspect().x > start &&
      a.tactic.startsWith('repositioning:'), 'unit fired through hill or did not reposition');
    scene.audit();
    const world = createParticleWorld(600, 350), art = scene.artworks.get('trooper');
    const unit = createPixelTerrainUnit(world, art, { x: 100, y: 100, facing: 1, ownerId: 'blue' });
    const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    combat.register('probe', unit, 'trooper', 'blue');
    const aim = { x: 500, y: 115 }, clear = world.snapshot();
    assert(combat.firingPath('probe', aim).clear, 'empty path was blocked');
    for (let y = 0; y < world.height; y += 1) world.set(300, y, PARTICLE_TERRAIN);
    assert(!combat.firingPath('probe', aim).clear && combat.inspect().fired === 0, 'thin cover missed or sight query fired ammo');
    world.restore(clear);
    assert(combat.firingPath('probe', aim).clear, 'cleared cover still blocked sight');
  });
  check('falling debris triggers retreat and hoppers dodge only incoming hostile projectiles backward', () => {
    const world = createParticleWorld(600, 400), art = createPixelCombatFixture().artworks.get('hopper');
    for (let x = 0; x < world.width; x += 1) for (let y = 330; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const unit = createPixelVehicleUnit(world, art, { kind: 'hopper', x: 180, y: 329 - art.footRow, facing: 1 });
    unit.step(); unit.step();
    const state = unit.inspect();
    const left = Math.min(...state.collision.map((p) => state.x + p.x));
    const right = Math.max(...state.collision.map((p) => state.x + p.x));
    const top = Math.min(...state.collision.map((p) => state.y + p.y));
    const target = { x: 500, y: 300 }, path = { clear: true };
    const shot = { ownerId: 'red', x: right + 60, y: top + 10, dx: -1, dy: 0, speed: 240 };
    const decide = (shots) => getPixelCombatAwareness(world, state, 'blue', target, shots, path);
    assert(!decide([{ ...shot, ownerId: 'blue' }]).evade && !decide([{ ...shot, dx: 1 }]).evade,
      'friendly or departing shot caused dodge');
    assert(!decide([{ ...shot, y: top - 50 }]).evade, 'non-intersecting shot caused dodge');
    const dodge = decide([shot]);
    assert(dodge.evade && dodge.direction === -1 && dodge.reason.includes('projectile'), 'incoming shot did not cause backward dodge');
    const clear = world.snapshot();
    assert(world.emitDebris(left + 4, top - 8).ok, 'cannot create debris threat');
    assert(decide([]).reason.includes('falling debris'), 'falling debris was ignored');
    for (const dx of [-1, 0, 1]) world.set(left + 4 + dx, top - 7, PARTICLE_TERRAIN);
    assert(!decide([]).evade, 'supported debris caused retreat');
    world.restore(clear);
    unit.input.left = true; unit.input.boost = true;
    for (let i = 0; i < 18; i += 1) unit.step();
    assert(unit.inspect().x < state.x - 10, 'backward dodge input did not move hopper');
  });
  check('optimized firing-path leading edges match a full swept sprite scan', () => {
    const assets = createPixelCombatFixture().artworks;
    for (const kind of ['trooper', 'hopper', 'jet']) for (const y of [70, 150, 280]) {
      const world = createParticleWorld(600, 350), art = assets.get(kind);
      for (let row = 100; row <= 180; row += 1) world.set(300, row, PARTICLE_TERRAIN);
      const options = { kind, x: 70, y: 100, facing: 1, ownerId: 'blue' };
      const unit = kind === 'trooper' ? createPixelTerrainUnit(world, art, options) : createPixelVehicleUnit(world, art, options);
      const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
      combat.register('probe', unit, kind, 'blue');
      const target = { x: 500, y }, path = combat.firingPath('probe', target);
      assert(combat.fire('probe', target).ok, 'reference projectile failed');
      const shot = combat.inspect().shots[0];
      const distance = Math.max(0, (target.x - shot.x) * shot.dx + (target.y - shot.y) * shot.dy);
      let blocked = false;
      for (let step = 0; step <= Math.ceil(distance * 2); step += 1) {
        const travel = Math.min(distance, step / 2);
        if (findPixelUnitContact(world, Math.round(shot.x + shot.dx * travel),
          Math.round(shot.y + shot.dy * travel), shot.pixels)) { blocked = true; break; }
      }
      assert(path.clear === !blocked, `${kind} diagonal swept path mismatch at target row ${y}`);
    }
  });
  check('tank shells fly a true gravity arc from the elevated barrel frame and have a limited reach', () => {
    const art = createPixelCombatFixture().artworks.get('tank');
    let blockedCases = 0, clearCases = 0;
    for (const [tx, ty] of [[250, 150], [330, 90], [360, 130], [300, 85], [240, 100]]) {
      const world = createParticleWorld(600, 350);
      for (let row = 105; row <= 180; row += 1) world.set(200, row, PARTICLE_TERRAIN);
      const unit = createPixelVehicleUnit(world, art, { kind: 'tank', x: 70, y: 100, facing: 1, ownerId: 'blue' });
      const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
      combat.register('probe', unit, 'tank', 'blue');
      const target = { x: tx, y: ty }, solution = combat.ballistics('probe', target);
      assert(solution.ok, `no ballistic solution for an in-range target ${tx},${ty}: ${solution.reason}`);
      const path = combat.firingPath('probe', target);
      assert(path.arc && path.aim === solution.aim, 'firing path did not use the shell arc');
      if (solution.aim !== unit.inspect().aim) {
        assert(combat.fire('probe', target).reason === 'barrel elevating to firing angle', 'fired at the wrong elevation');
      }
      combat.layGun('probe', target);
      const state = unit.inspect(), fired = combat.fire('probe', target);
      assert(fired.ok && state.aim === fired.aim && state.turret === 1, `laid gun did not fire: ${fired.reason}`);
      const barrel = unit.barrel();
      assert(Math.abs(fired.elevation - barrel.elevation) < 0.1 &&
        Math.hypot(fired.muzzle.x - barrel.muzzle.x, fired.muzzle.y - barrel.muzzle.y) < 1e-6,
      'shell did not leave the tip of the elevated barrel frame at its angle');
      const shot = combat.inspect().shots[0];
      assert(shot.gravity > 0 && shot.vy < 0, 'shell was not lobbed upward under gravity');
      let blocked = false;
      for (let time = 0; time <= solution.duration; time += 0.25 / shot.speed) {
        const x = Math.round(shot.x + shot.vx * time), y = Math.round(shot.y + shot.vy * time + 0.5 * shot.gravity * time * time);
        if (findPixelUnitContact(world, x, y, shot.pixels)) { blocked = true; break; }
      }
      assert(path.clear === !blocked, `arc path mismatch for target ${tx},${ty}: ${path.reason}`);
      if (blocked) blockedCases += 1; else clearCases += 1;
      let nearest = Infinity;
      for (let tick = 0; tick < 240 && combat.inspect().shots.length; tick += 1) {
        combat.step();
        for (const flying of combat.inspect().shots) nearest = Math.min(nearest, Math.hypot(flying.x - tx, flying.y - ty));
      }
      assert(blocked || nearest < 4, `clear shell arc missed its target by ${nearest.toFixed(1)} cells`);
    }
    assert(blockedCases > 0 && clearCases > 0, `arc cases did not cover both cover and lobbing over it (${blockedCases}/${clearCases})`);
    const world = createParticleWorld(900, 350), unit = createPixelVehicleUnit(world, art, { kind: 'tank', x: 50, y: 100, facing: 1, ownerId: 'blue' });
    const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    combat.register('far', unit, 'tank', 'blue');
    const far = { x: 880, y: 115 };
    assert(combat.ballistics('far', far).reason === 'target beyond shell arc range' &&
      combat.firingPath('far', far).reason === 'target beyond shell arc range' && !combat.fire('far', far).ok,
    'tank shell reached beyond its arc range');
  });
  check('tanks reverse while keeping hull facing, flip the turret and fire from the hatch with troops aboard', () => {
    const art = createPixelCombatFixture().artworks, tankArt = art.get('tank');
    const world = createParticleWorld(700, 360);
    for (let x = 0; x < world.width; x += 1) for (let y = 330; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const unit = createPixelVehicleUnit(world, tankArt, { kind: 'tank', x: 300, y: 329 - tankArt.footRow, facing: 1,
      ownerId: 'blue', hatchArtwork: art.get('trooper') });
    const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    combat.register('tank', unit, 'tank', 'blue');
    for (let tick = 0; tick < 10; tick += 1) unit.step();
    const start = unit.inspect();
    unit.input.left = true; unit.input.reverse = true;
    for (let tick = 0; tick < 60; tick += 1) unit.step();
    const reversed = unit.inspect();
    assert(reversed.x < start.x - 5 && reversed.facing === 1 && reversed.reversing,
      `tank did not back up while facing forward (x ${start.x} -> ${reversed.x}, facing ${reversed.facing})`);
    const ahead = { x: reversed.x + 220, y: 300 };
    combat.layGun('tank', ahead);
    assert(combat.fire('tank', ahead).ok, 'tank could not fire while reversing');
    const forward = new Set(unit.inspect().pixels.map((p) => p.x));
    unit.setTurret(-1); unit.setAim(0);
    const flipped = unit.inspect(), mask = new Set(flipped.collision.map((p) => p.y * flipped.width + p.x));
    assert(flipped.turret === -1 && flipped.facing === 1 &&
      flipped.pixels.every((p) => mask.has(p.y * flipped.width + p.x)), 'flipped turret escaped the collision mask');
    const barrel = unit.barrel();
    assert(barrel.direction === -1 && barrel.muzzle.x < flipped.x + flipped.width / 2, 'flipped barrel does not point rearward');
    const behind = { x: flipped.x - 200, y: 300 };
    for (let tick = 0; tick < Math.ceil(PIXEL_LAB_WEAPONS.tank.cooldown * 60) + 2; tick += 1) combat.step();
    combat.layGun('tank', behind);
    const rear = combat.fire('tank', behind);
    assert(rear.ok && rear.muzzle.x < flipped.x + flipped.width / 2 && unit.inspect().facing === 1,
      `turret did not fire opposite the treads: ${rear.reason}`);
    assert(!unit.hatch() && combat.fire('tank', behind, { weapon: 'hatch' }).reason === 'no hatch gunner aboard',
      'hatch fired with nobody aboard');
    const closed = unit.inspect().pixels.length;
    unit.setHatch(true);
    const open = unit.inspect(), hatch = unit.hatch();
    assert(open.hatch && open.pixels.length > closed && hatch && hatch.muzzle.y < open.y + 20 &&
      open.pixels.every((p) => new Set(open.collision.map((c) => c.y * open.width + c.x)).has(p.y * open.width + p.x)),
    'hatch gunner did not appear on top of the turret inside the mask');
    const gun = combat.fire('tank', ahead, { weapon: 'hatch' });
    assert(gun.ok && gun.weapon === 'hatch' && combat.inspect().shots.some((shot) => shot.hatch && shot.kind === 'bullet'),
      'hatch gunner did not fire a bullet');
    assert(forward.size > 0, 'forward turret had no pixels');
  });
  check('automated units reposition toward the nearest enemy when terrain blocks the shot', () => {
    const at = (x) => ({ x, y: 300, width: 10, height: 10, facing: 1, collision: [{ x: 0, y: 0 }, { x: 9, y: 9 }] });
    for (const kind of ['trooper', 'tank']) {
      const range = PIXEL_GROUND_ENGAGEMENT[kind];
      for (const gap of [range.minimum - 20, range.minimum + 20, range.engage - 10, range.engage + 60]) {
        for (const side of [-1, 1]) {
          const result = getPixelGroundEngagement(kind, at(500), at(500 + side * (gap + 10)), {},
            { clear: false, reason: 'terrain' }, -side);
          assert(result.direction === side && !result.hold,
            `${kind} did not move toward a covered enemy at gap ${gap} (side ${side}): ${result.reason}`);
        }
      }
      const out = getPixelGroundEngagement(kind, at(0), at(range.minimum + 20), {},
        { clear: false, reason: 'target beyond shell arc range' }, -1);
      assert(out.direction === 1, `${kind} did not close to bring an out-of-range enemy within reach`);
    }
  });
  check('automated hoppers see thin obstacles ahead, back away and reject jumps under low ceilings', () => {
    const art = createPixelCombatFixture().artworks.get('hopper');
    for (const direction of [-1, 1]) {
      const world = createParticleWorld(700, 400);
      for (let x = 0; x < world.width; x += 1) for (let y = 330; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      const unit = createPixelVehicleUnit(world, art, { kind: 'hopper', x: 280, y: 329 - art.footRow,
        facing: direction, automated: true, speedScale: 1.8, ownerId: 'blue' });
      unit.step(); unit.step();
      const start = unit.inspect();
      const edge = direction > 0 ? Math.max(...start.collision.map((p) => start.x + p.x)) :
        Math.min(...start.collision.map((p) => start.x + p.x));
      const wall = edge + direction * 8;
      for (let y = 0; y < 330; y += 1) world.set(wall, y, PARTICLE_TERRAIN);
      unit.input.right = direction > 0; unit.input.left = direction < 0; unit.input.boost = true;
      for (let i = 0; i < 16; i += 1) {
        unit.step();
        assert(!findPixelUnitContact(world, unit.inspect().x, unit.inspect().y, unit.inspect().collision),
          'hopper entered the obstacle');
      }
      assert((unit.inspect().x - start.x) * direction < 0 && unit.inspect().navigation.includes('backing'),
        `hopper kept pushing toward the wall: direction ${direction}, x ${start.x} -> ${unit.inspect().x}, ${unit.inspect().navigation}`);
    }
    const world = createParticleWorld(700, 400);
    for (let x = 0; x < world.width; x += 1) for (let y = 330; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const unit = createPixelVehicleUnit(world, art, { kind: 'hopper', x: 200, y: 329 - art.footRow,
      facing: 1, automated: true, ownerId: 'blue' });
    for (let i = 0; i < 30; i += 1) unit.step();
    const start = unit.inspect(), top = Math.min(...start.collision.map((p) => start.y + p.y));
    for (let x = 180; x < 400; x += 1) world.set(x, top - 5, PARTICLE_TERRAIN);
    unit.input.jump = true;
    unit.step();
    assert(unit.inspect().charges === start.charges && unit.inspect().vy >= 0 &&
      unit.inspect().navigation.includes('overhead'), `hopper jumped into a ceiling: grounded ${start.grounded}, ${unit.inspect().navigation}`);
  });
  check('launcher missile homing, impact and actual interceptor destruction', () => {
    const world = createParticleWorld(500, 150), combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    const incoming = combat.launch('red', { x: 80, y: 70 }, { x: 440, y: 70 });
    for (let i = 0; i < 10; i += 1) combat.step();
    const target = combat.inspect({ sprites: false }).shots[0];
    const interceptor = combat.launch('blue', { x: 260, y: 90 }, target, { targetShotId: incoming.id });
    assert(interceptor.ok, 'interceptor rejected');
    for (let i = 0; i < 80; i += 1) combat.step();
    assert(combat.inspect().intercepted === 1 && combat.inspect().shots.length === 0,
      'missile/interceptor were not both destroyed: ' + JSON.stringify(combat.inspect({ sprites: false })));
    for (let y = 20; y < 130; y += 1) world.set(350, y, PARTICLE_TERRAIN);
    combat.launch('red', { x: 100, y: 50 }, { x: 350, y: 90 });
    for (let i = 0; i < 100; i += 1) combat.step();
    assert(combat.inspect().terrainDebris > 0, 'homing missile failed physical terrain impact');
  });
  check('launcher missiles rise and descend toward either opposing side with no ammunition residue', () => {
    for (const direction of [-1, 1]) {
      const world = createParticleWorld(600, 250), combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
      const origin = { x: direction > 0 ? 50 : 550, y: 180 };
      const target = { x: direction > 0 ? 550 : 50, y: 180 };
      for (let y = 165; y < world.height; y += 1) world.set(target.x, y, PARTICLE_TERRAIN);
      const launch = combat.launch('attacker', origin, target);
      let highest = origin.y, ascending = false, descending = false, previousX = origin.x;
      for (let tick = 0; tick < 200; tick += 1) {
        combat.step();
        const shot = combat.inspect({ sprites: false }).shots.find((entry) => entry.id === launch.id);
        if (!shot) continue;
        assert((shot.x - previousX) * direction >= 0 && Number.isFinite(shot.x) && Number.isFinite(shot.y),
          'arc reversed horizontal direction or produced invalid coordinates');
        previousX = shot.x; highest = Math.min(highest, shot.y);
        ascending = ascending || shot.dy < 0; descending = descending || shot.dy > 0;
      }
      const state = combat.inspect({ sprites: false });
      assert(ascending && descending && highest < origin.y - 50 &&
        state.impacts.some((hit) => hit.shotId === launch.id && hit.reason === 'material') &&
        state.scattered === 12 && state.terrainDebris > 0 && state.issuedAmmoDebris === 0 &&
        state.impacts.every((hit) => hit.particles.ammo === 0) &&
        world.debrisCount === state.terrainDebris,
      'missile did not complete a physical arc, scatter, preserve terrain debris or suppress ammunition residue');
    }
  });
  check('interceptors detect hostile offensive missiles through the expanded 960-cell boundary', () => {
    const origin = { x: 100, y: 100 };
    const missile = (id, x, ownerId = 'red', targetShotId) =>
      ({ id, x, y: 100, ownerId, targetShotId, kind: 'missile' });
    assert(findPixelInterceptorThreat([missile(1, 100 + 960)], 'blue', origin).id === 1,
      'missile at expanded boundary not detected');
    assert(!findPixelInterceptorThreat([missile(1, 100 + 961)], 'blue', origin),
      'out-of-range missile detected');
    assert(!findPixelInterceptorThreat([missile(1, 200, 'blue'), missile(2, 220, 'red', 10)], 'blue', origin),
      'friendly missile or enemy interceptor selected');
    assert(findPixelInterceptorThreat([missile(1, 900), missile(2, 800)], 'blue', origin).id === 2,
      'nearest long-range offensive threat not selected');
  });
  check('interceptors hunt hostile jets only inside the 240-cell anti-air radius without being mistaken for attack missiles', () => {
    const world = createParticleWorld(700, 200, { skipEmptyChunks: true });
    for (let x = 0; x < world.width; x += 1) for (let y = 185; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE), art = createPixelCombatFixture().artworks.get('jet');
    const jet = createPixelVehicleUnit(world, art, { kind: 'jet', x: 300, y: 40, facing: -1, ownerId: 'red' });
    const far = createPixelVehicleUnit(world, art, { kind: 'jet', x: 600, y: 40, facing: -1, ownerId: 'red' });
    combat.register('jet', jet, 'jet', 'red'); combat.register('far', far, 'jet', 'red');
    const units = [{ id: 'jet', kind: 'jet', owner: 'red', unit: jet }, { id: 'far', kind: 'jet', owner: 'red', unit: far }];
    const origin = { x: 200, y: 150 };
    const pick = findPixelAntiAirTarget(units, [], 'blue', origin);
    assert(pick && pick.entry.id === 'jet', 'nearest jet inside anti-air range not chosen');
    assert(!findPixelAntiAirTarget(units.slice(1), [], 'blue', origin), 'jet beyond 240 cells was targeted');
    assert(!findPixelAntiAirTarget(units, [], 'red', origin), 'friendly jet targeted');
    const launch = combat.launch('blue', origin, pick.point, { targetUnitId: 'jet', shooterId: 'aa' });
    assert(launch.ok, 'jet interceptor rejected');
    const flying = combat.inspect({ sprites: false }).shots;
    assert(isPixelInterceptorShot(flying[0]) && !findPixelInterceptorThreat(flying, 'red', { x: 300, y: 50 }),
      'a jet interceptor was mistaken for an attack missile');
    assert(findPixelAntiAirTarget(units, flying, 'blue', origin) === null || findPixelAntiAirTarget(units, flying, 'blue', origin).entry.id !== 'jet',
      'a jet already being chased drew a second interceptor');
    for (let i = 0; i < 120 && combat.health('jet').health === PIXEL_LAB_WEAPONS.jet.health; i += 1) {
      updatePixelUnitLabPatrol(jet, world, 40); jet.step(); combat.step();
    }
    const hit = combat.inspect({ sprites: false }).impacts.find((impact) => impact.targetId === 'jet');
    assert(hit && hit.kind === 'missile' && hit.damage === 75 && combat.health('far').health === PIXEL_LAB_WEAPONS.jet.health,
      'interceptor failed to hit the manoeuvring jet for full missile damage');
    // Interceptor 4 HM per shot vs jet 40 HM (PIXEL_PRODUCTION_COSTS in pixel-generated-combat.js).
    assert(Math.ceil(PIXEL_LAB_WEAPONS.jet.health / 75) * 4 < 40, 'killing a jet with interceptors must cost less HM than the jet');
  });
  check('launchers redirect to a higher clear arc and hold fire when terrain seals every trajectory', () => {
    const world = createParticleWorld(600, 250), combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    for (let y = 60; y < world.height; y += 1) world.set(250, y, PARTICLE_TERRAIN);
    for (let y = 165; y < world.height; y += 1) world.set(550, y, PARTICLE_TERRAIN);
    const before = world.snapshot();
    const result = combat.launch('blue', { x: 50, y: 180 }, { x: 550, y: 180 });
    assert(result.ok && JSON.stringify(before) === JSON.stringify(world.snapshot()),
      'clearance planning rejected an available arc or changed terrain');
    const arc = combat.inspect({ sprites: false }).shots[0];
    const rise = arc.gravity * arc.duration * arc.duration / 8;
    assert(rise > 100, 'launcher did not raise its aim above the blocking hill');
    for (let tick = 0; tick < 160; tick += 1) combat.step();
    const hit = combat.inspect({ sprites: false }).impacts.find((entry) => entry.shotId === result.id);
    assert(hit && hit.x === 550 && hit.reason === 'material' && world.at(250, 80) === PARTICLE_TERRAIN,
      'redirected missile hit or excavated the intervening terrain instead of the target');
    const sealed = createParticleWorld(600, 250), blocked = createPixelUnitCombat(sealed, PIXEL_BULLET_REFERENCE);
    for (let y = 0; y < sealed.height; y += 1) sealed.set(250, y, PARTICLE_TERRAIN);
    const terrain = JSON.stringify(sealed.snapshot());
    const rejected = blocked.launch('blue', { x: 50, y: 180 }, { x: 550, y: 180 });
    assert(!rejected.ok && rejected.reason.includes('trajectory blocked') &&
      blocked.inspect().fired === 0 && blocked.inspect().shots.length === 0 &&
      JSON.stringify(sealed.snapshot()) === terrain,
    'blocked launcher fired, consumed ammunition or changed physical terrain');
    const stepped = createParticleWorld(600, 250), uphill = createPixelUnitCombat(stepped, PIXEL_BULLET_REFERENCE);
    for (let y = 70; y < stepped.height; y += 1) stepped.set(250, y, PARTICLE_TERRAIN);
    for (let y = 35; y < stepped.height; y += 1) stepped.set(550, y, PARTICLE_TERRAIN);
    const highTarget = uphill.launch('blue', { x: 50, y: 200 }, { x: 550, y: 40 });
    assert(highTarget.ok, 'launcher failed to use available sky for a higher-elevation target');
    for (let tick = 0; tick < 160; tick += 1) uphill.step();
    assert(uphill.inspect().impacts.some((entry) => entry.shotId === highTarget.id && entry.x === 550),
      'uphill arc hit the intervening terrain or left the sky bounds');
  });
  check('all unit types cross resting debris slowly and recover after clearing without deleting material', () => {
    const assets = createPixelCombatFixture().artworks;
    for (const kind of ['trooper', 'tank', 'hopper', 'jet']) {
      const world = createParticleWorld(800, 400), art = assets.get(kind);
      for (let x = 0; x < 800; x += 1) for (let y = 330; y < 400; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      const options = { kind, x: 100, y: 330 - art.footRow, facing: 1, ownerId: 'blue' };
      const make = () => kind === 'trooper' ? createPixelTerrainUnit(world, art, options) :
        createPixelVehicleUnit(world, art, options);
      const clear = world.snapshot(), normal = make();
      normal.input.right = true;
      for (let i = 0; i < 120; i += 1) normal.step();
      const normalDistance = normal.inspect().x - 100;
      world.restore(clear);
      const slow = make(), initial = slow.inspect();
      for (const pixel of initial.collision) {
        const x = initial.x + pixel.x, y = initial.y + pixel.y;
        if (world.at(x, y) === PARTICLE_EMPTY) assert(world.emitDebris(x, y).ok, 'debris fixture emission failed');
      }
      const issued = world.debrisCount;
      assert(pixelUnitDebrisDrag(world, initial.x, initial.y, initial.collision) === 0.35, 'overlap did not slow');
      slow.input.right = true;
      for (let i = 0; i < 120; i += 1) slow.step();
      assert(slow.inspect().x > 100 && slow.inspect().x - 100 < normalDistance &&
        world.debrisCount === issued, `${kind} failed to escape slowly or deleted debris`);
      world.restore(clear);
      assert(pixelUnitDebrisDrag(world, slow.inspect().x, slow.inspect().y, slow.inspect().collision) === 1,
        'speed did not recover after full clearance');
    }
  });
  check('only falling debris entering the unit deals damage; embedded debris does not repeat damage', () => {
    const scene = createPixelCombatFixture(), entry = scene.spawn(scene.bases[0], 'trooper').entry;
    scene.configure({ spawning: false, fighting: false, devices: false });
    const state = entry.unit.inspect();
    const pixel = state.collision.reduce((a, b) => a.y < b.y ? a : b);
    const x = state.x + pixel.x, y = state.y + pixel.y;
    assert(scene.world.emitDebris(x, y - 1).ok, 'cannot issue falling test debris');
    scene.initial.material += 1;
    scene.step();
    assert(entry.debrisDamage === 5 && scene.combat.health(entry.id).health === 95, 'falling entry did not damage');
    scene.step();
    assert(entry.debrisDamage === 5, 'debris already inside caused repeated damage');
    scene.audit();
  });
  check('hopper strategy seeks overhead/rear angles and bounds bait, retreat and counterattack phases', () => {
    const state = { x: 100, y: 200, facing: 1, grounded: true, charges: 2,
      collision: [{ x: 0, y: 0 }, { x: 20, y: 30 }] };
    const target = { id: 'red-target', state: { x: 240, y: 210, facing: -1,
      collision: [{ x: 0, y: 0 }, { x: 20, y: 20 }] } };
    const memory = { phase: 'seek', targetId: null, lastShot: 0, cooldown: 0, until: 0 };
    const decide = (tick, shots = [], current = state, path = { clear: true }) =>
      getPixelHopperStrategy(current, target, memory, tick, shots, path);
    assert(!decide(1).fire && memory.phase === 'bait', 'nearby hopper did not bait');
    assert(memory.until === 37 && decide(20).direction === 0, 'bait wait was not bounded');
    const shot = { id: 1, shooterId: target.id };
    const retreat = decide(21, [shot]);
    assert(memory.phase === 'retreat' && retreat.direction === -1 && !retreat.fire, 'baited shot did not trigger retreat');
    const counter = decide(45, [shot]);
    assert(memory.phase === 'counter' && counter.fire && counter.reason.includes('counter'), 'retreat did not lead to counterattack');
    assert(decide(106).fire && memory.phase !== 'bait', 'cooldown immediately restarted bait');
    memory.phase = 'seek'; memory.cooldown = 0; memory.lastAttack = 230;
    decide(230);
    assert(decide(266).fire && memory.phase === 'counter', 'unresponsive opponent caused endless bait');
    memory.phase = 'seek'; memory.cooldown = 1000;
    const overhead = decide(300, [], { ...state, x: 240, y: 140, grounded: false });
    assert(overhead.fire && overhead.reason.includes('above'), 'overhead position was not exploited');
    const rear = decide(301, [], { ...state, x: 300 });
    assert(rear.fire && rear.reason.includes('behind'), 'rear position was not exploited');
    const approach = decide(302, [], state, { clear: false });
    assert(approach.jump && approach.reason.includes('overhead'), 'hopper did not seek an elevated approach');
    assert(!decide(303, [], { ...state, charges: 0 }, { clear: false }).jump, 'strategy ignored jump charges');
    target.state.facing = 1;
    assert(decide(304).reason.includes('behind'), 'rear strategy did not mirror target facing');
    assert(!getPixelHopperStrategy(state, null, memory, 305, [], { clear: false }).fire &&
      memory.targetId === null, 'lost target retained attack state');
  });
  check('hopper attack commitment breaks defensive stalling but preserves blocked firing paths', () => {
    const state = { x: 100, y: 200, facing: 1, grounded: true, charges: 1,
      collision: [{ x: 0, y: 0 }, { x: 20, y: 30 }] };
    const target = { id: 'opponent', state: { x: 210, y: 200, facing: -1,
      collision: [{ x: 0, y: 0 }, { x: 20, y: 30 }] } };
    const memory = { targetId: target.id, phase: 'retreat', until: 900, cooldown: 0, lastShot: 0, lastAttack: 0 };
    const commit = getPixelHopperStrategy(state, target, memory, 240, [], { clear: true });
    assert(commit.acceptRisk && commit.fire && commit.direction === 1 && memory.phase === 'commit',
      'endless retreat did not become an attack');
    assert(getPixelHopperStrategy(state, target, memory, 300, [], { clear: true }).acceptRisk,
      'commit window ended prematurely');
    const blocked = getPixelHopperStrategy(state, target, memory, 310, [], { clear: false });
    assert(blocked.direction === 1 && blocked.acceptRisk, 'cover caused committed hopper to stop advancing');
    assert(getPixelHopperStrategy(state, { ...target, id: 'replacement' }, memory, 320, [], { clear: true }).acceptRisk &&
      memory.until === 330, 'retargeting restarted the commitment deadline');
    assert(!getPixelHopperStrategy(state, target, memory, 330, [], { clear: true }).acceptRisk,
      'commit window never released defensive behavior');
    const scene = createPixelCombatFixture();
    const hopper = scene.spawn(scene.bases[0], 'hopper').entry;
    scene.spawn(scene.bases[1], 'trooper');
    hopper.strategyMemory.lastAttack = -240; hopper.evadeUntil = 1000; hopper.evadeDirection = -1;
    scene.configure({ spawning: false, devices: false, fighting: true }); scene.step();
    assert(hopper.tactic.includes('aggressive assault') && hopper.evadeUntil <= scene.ticks,
      'fixture evasion overrode continuous aggressive assault');
    assert(scene.combat.inspect().fired === 0, 'committed attack bypassed physical hill cover');
    scene.audit();
  });
  check('collision occupancy keeps overlapping friends when another moves and clears deregistered opponents', () => {
    const world = createParticleWorld(100, 50), group = createPixelUnitCollisionGroup(world);
    const stateA = { x: 10, y: 10, collision: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };
    const stateB = { x: 10, y: 10, collision: [{ x: 0, y: 0 }] };
    const a = { inspect: () => stateA }, b = { inspect: () => stateB };
    group.register(a, 'blue'); group.register(b, 'blue');
    stateA.x = 20; group.sync(a);
    assert(group.contact('red', 10, 10, [{ x: 0, y: 0 }]) &&
      !group.contact('blue', 10, 10, [{ x: 0, y: 0 }]), 'moving friend removed shared occupancy');
    group.unregister(b);
    assert(!group.contact('red', 10, 10, [{ x: 0, y: 0 }]), 'deregistered unit remained occupied');
    assert(!group.contact('red', 120, 9, [{ x: 0, y: 0 }]), 'outside coordinate aliased a valid occupied cell');
    stateA.collision = [{ x: 1, y: 0 }]; group.sync(a);
    assert(!group.contact('red', 20, 10, [{ x: 0, y: 0 }]) &&
      group.contact('red', 21, 10, [{ x: 0, y: 0 }]), 'same-position changing mask stayed stale');
    group.unregister(a);
    assert(!group.contact('red', 21, 10, [{ x: 0, y: 0 }]), 'opposing occupancy leaked after unregister');
  });
  check('missiles stay compact in flight and impact fragments scatter as real damaging projectiles', () => {
    const world = createParticleWorld(800, 300), combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    combat.launch('blue', { x: 80, y: 150 }, { x: 700, y: 150 });
    const first = combat.inspect().shots[0].pixels;
    for (let i = 0; i < 60; i += 1) combat.step();
    const flight = combat.inspect();
    assert(flight.impacts.length === 0 && flight.scattered === 0 &&
      flight.shots[0].pixels.length <= 27 && first.length <= 27 &&
      flight.shots[0].pixels.every((pixel) => Math.hypot(pixel.x, pixel.y) <= 5),
    'reference animation exploded in mid-air');
    const art = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE);
    const victim = createPixelTerrainUnit(world, art, { x: 460, y: 50, facing: -1, ownerId: 'red' });
    combat.register('fragment-target', victim, 'trooper', 'red');
    for (let y = 0; y < world.height; y += 1) world.set(500, y, PARTICLE_TERRAIN);
    while (combat.inspect({ sprites: false }).scattered === 0) {
      combat.step();
      assert(combat.inspect({ sprites: false }).ticks < 180, 'missile never impacted');
    }
    const blast = combat.inspect({ sprites: false });
    assert(blast.scattered === 12 && blast.shots.filter((shot) => shot.kind === 'fragment').length === 12 &&
      new Set(blast.shots.map((shot) => Math.atan2(shot.dy, shot.dx).toFixed(2))).size === 12,
      'impact fragments did not scatter radially');
    assert(blast.impacts.some((hit) => hit.kind === 'missile' && hit.reason === 'material' && hit.fragments === 12),
      'fragment explosion was not tied to impact');
    for (let i = 0; i < 60; i += 1) combat.step();
    assert(combat.inspect({ sprites: false }).shots.length === 0 && combat.inspect().terrainDebris > 0,
      'fragments did not expire or damage terrain');
    assert(combat.health('fragment-target').health < 100 &&
      combat.inspect().impacts.some((hit) => hit.targetId === 'fragment-target' && hit.kind === 'fragment' && hit.damage === 12),
      'scattered fragments failed to damage an off-axis unit');
  });
  check('faster movement, smoother moving treads, and stronger forward hopper lunge are opt-in', () => {
    const assets = createPixelCombatFixture().artworks;
    for (const kind of ['trooper', 'tank', 'hopper', 'jet']) {
      const world = createParticleWorld(1000, 400), art = assets.get(kind);
      for (let x = 0; x < world.width; x += 1) for (let y = 330; y < 400; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      const make = (extra) => {
        const options = { kind, x: 100, y: kind === 'jet' ? 50 : 330 - art.footRow, facing: 1, ...extra };
        return kind === 'trooper' ? createPixelTerrainUnit(world, art, options) : createPixelVehicleUnit(world, art, options);
      };
      const original = make({}), faster = make({ speedScale: 1.8, treadRate: 2, forwardLunge: 1.8 });
      original.input.right = faster.input.right = true;
      if (kind === 'hopper') original.input.jump = faster.input.jump = true;
      let originalTransitions = 0, fasterTransitions = 0;
      for (let i = 0; i < 60; i += 1) {
        const before = original.inspect().frame, fastBefore = faster.inspect().frame;
        original.step(); faster.step();
        if (original.inspect().frame !== before) originalTransitions += 1;
        if (faster.inspect().frame !== fastBefore) fasterTransitions += 1;
      }
      assert(faster.inspect().x - 100 > (original.inspect().x - 100) * 1.5, `${kind} did not become faster`);
      if (kind === 'hopper') assert(faster.inspect().x - original.inspect().x > 50, 'hopper lacks forward lunge');
      if (kind === 'tank') assert(fasterTransitions > originalTransitions, 'moving tread animation did not update more frequently');
    }
  });
  check('unit masks collide with real hills and basin water; water conserves through live impacts', () => {
    const scene = createPixelCombatFixture(), art = scene.artworks.get('trooper');
    const unit = createPixelTerrainUnit(scene.world, art, { x: 565, y: 342, facing: 1 });
    unit.input.right = true; unit.step();
    assert(unit.inspect().drowned && unit.inspect().water.fullySubmerged, 'basin water did not affect actual unit');
    assert(findPixelUnitContact(scene.world, 705, 265, art.mask('standing', 1)), 'mountain collision missing');
    scene.combat.launch('blue', { x: 500, y: 340 }, { x: 540, y: 380 });
    for (let i = 0; i < 120; i += 1) scene.step();
    scene.audit(); assert(scene.world.waterCount === scene.initial.water, 'combat lost basin water');
  });
  check('generated roads increase friendly ground movement only and lose their bonus after damage', () => {
    const world = createParticleWorld(800, 360), art = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE);
    for (let x = 0; x < world.width; x += 1) for (let y = 330; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const roads = createPixelCombatRoads(world, [{ left: 0, right: 799, y: 330, owner: 'blue' }]);
    const make = (ownerId, road) => createPixelTerrainUnit(world, art, {
      x: 100, y: 330 - art.footRow, ownerId, groundSpeedMultiplier: road ? roads.multiplier : undefined });
    const friendly = make('blue', true), enemy = make('red', true), offroad = make('blue', false);
    for (const unit of [friendly, enemy, offroad]) unit.input.right = true;
    for (let tick = 0; tick < 120; tick += 1) for (const unit of [friendly, enemy, offroad]) unit.step();
    assert(friendly.inspect().x > offroad.inspect().x && enemy.inspect().x === offroad.inspect().x,
      'road speed was cosmetic or boosted enemy movement');
    const state = friendly.inspect();
    assert(roads.multiplier({ ...state, grounded: false }) === 1 &&
      roads.multiplier({ ...state, kind: 'jet' }) === 1 &&
      roads.multiplier({ ...state, water: { wet: true } }) === 1, 'road boosted airborne, flying or wet units');
    world.excavate(state.x, 330, state.x, 330);
    assert(roads.multiplier(state) === 1, 'broken road still provided speed');
    const snapshot = world.snapshot();
    snapshot.cells[329 * world.width + state.x] = PARTICLE_WATER;
    world.restore(snapshot);
    assert(roads.multiplier(state) === 1, 'flooded road still provided speed');
  });
  check('debris drag scales with exact collision-mask coverage instead of any-contact slowdown', () => {
    const world = createParticleWorld(40, 40), mask = [];
    for (let y = 0; y < 10; y += 1) for (let x = 0; x < 10; x += 1) mask.push({ x, y });
    for (const count of [0, 1, 25, 50, 100]) {
      while (world.debrisCount < count) {
        const pixel = mask[world.debrisCount];
        assert(world.emitDebris(10 + pixel.x, 10 + pixel.y).ok, 'coverage emission failed');
      }
      assert(world.countUnitDebris(10, 10, mask) === count &&
        Math.abs(pixelUnitDebrisDrag(world, 10, 10, mask) - (1 - 0.65 * count / 100)) < 1e-10,
      `incorrect speed at ${count}% coverage`);
    }
    assert(pixelUnitDebrisDrag(world, 25, 25, mask) === 1, 'drag remained outside debris');
  });
  check('every unit flashes on real damage and emits short-lived hit particles', () => {
    const scene = createPixelCombatFixture();
    for (const kind of ['trooper', 'tank', 'hopper', 'jet']) {
      const entry = scene.spawn(scene.bases[0], kind).entry;
      assert(scene.combat.fallingDebrisDamage(entry.id, 5) === 5, 'hit did not damage');
      assert(scene.combat.health(entry.id).hitFlash === 0.12, 'hit flash was not latched');
    }
    assert(scene.combat.inspect().deathParticles.length === 48 && scene.combat.inspect().deaths === 0,
      'nonlethal hits did not emit twelve particles each or emitted deaths');
    for (let tick = 0; tick < 9; tick += 1) scene.combat.step();
    assert(scene.units.every((entry) => scene.combat.health(entry.id).hitFlash === 0), 'flash did not expire');
    for (let tick = 0; tick < 20; tick += 1) scene.combat.step();
    assert(scene.combat.inspect().deathParticles.length === 0, 'hit particles did not expire');
    scene.audit();
  });
  check('death fragments survive unregister, collide with thin world cells and preserve mass', () => {
    const world = createParticleWorld(256, 220), art = createPixelCombatFixture().artworks.get('trooper');
    for (let x = 0; x < world.width; x += 1) for (let y = 180; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    for (let y = 179; y >= 1; y -= 1) {
      assert(world.emitConstruction(150, y).ok && world.settleConstruction(150, y).ok, 'wall emission failed');
    }
    const unit = createPixelTerrainUnit(world, art, { x: 120, y: 100, ownerId: 'blue' });
    const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE), mass = world.terrainCount + world.barrierCount;
    combat.register('test', unit, 'trooper', 'blue'); combat.destroyUnit('test'); combat.destroyUnit('test');
    assert(combat.inspect().deaths === 1 && combat.inspect().deathParticles.length === 48, 'death duplicated');
    combat.unregister('test');
    let bounced = false;
    for (let tick = 0; tick < 12; tick += 1) {
      combat.step(0.1);
      for (const particle of combat.inspect().deathParticles) {
        assert(particle.x < 150 && world.at(Math.floor(particle.x), Math.floor(particle.y)) === PARTICLE_EMPTY,
          'fragment tunneled through a thin wall or ground');
        if (particle.y > 175 && particle.vy < 0) bounced = true;
      }
    }
    assert(bounced, 'death fragments did not bounce on real ground');
    combat.step(0.1);
    assert(combat.inspect().deathParticles.length === 0 && world.terrainCount + world.barrierCount === mass &&
      world.debrisCount === 0 && combat.inspect().issuedAmmoDebris === 0, 'effect lifetime or mass accounting changed');
  });
  check('death particles stay close to the body and fall under strong gravity', () => {
    const world = createParticleWorld(256, 220), art = createPixelCombatFixture().artworks.get('trooper');
    for (let x = 0; x < world.width; x += 1) for (let y = 200; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const unit = createPixelTerrainUnit(world, art, { x: 120, y: 60, ownerId: 'blue' });
    const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    combat.register('short', unit, 'trooper', 'blue'); combat.destroyUnit('short'); combat.unregister('short');
    const origins = combat.inspect().deathParticles.map((particle) => ({ x: particle.x, y: particle.y }));
    let previousVy = null, farthest = 0, maxRise = 0;
    for (let tick = 0; tick < 10; tick += 1) {
      combat.step(1 / 60);
      const particles = combat.inspect().deathParticles;
      particles.forEach((particle, index) => {
        farthest = Math.max(farthest, Math.abs(particle.x - origins[index].x));
        maxRise = Math.max(maxRise, origins[index].y - particle.y);
      });
      const meanVy = particles.reduce((sum, particle) => sum + particle.vy, 0) / particles.length;
      if (previousVy !== null) assert(meanVy - previousVy > 3.5, 'particles were not accelerated downward by gravity');
      previousVy = meanVy;
    }
    for (let tick = 0; tick < 90 && combat.inspect().deathParticles.length; tick += 1) {
      combat.step(1 / 60);
      for (const particle of combat.inspect().deathParticles) {
        farthest = Math.max(farthest, Math.abs(particle.x - 120 - art.width / 2));
      }
    }
    assert(farthest < 22 && maxRise < 6, `death particles travelled too far: ${farthest.toFixed(1)} across, ${maxRise.toFixed(1)} up`);
  });
  check('automated troops stop dry at the basin bank and wait instead of falling in', () => {
    const scene = createPixelCombatFixture(), art = scene.artworks.get('trooper');
    const unit = createPixelTerrainUnit(scene.world, art, { x: 490, y: 330 - 1 - art.footRow, facing: 1,
      ownerId: 'blue', automated: true });
    unit.input.right = true;
    for (let tick = 0; tick < 360; tick += 1) unit.step();
    const state = unit.inspect({ sprites: false });
    assert(!state.water.wet && state.grounded && state.x < 525 && state.state === 'waiting at water edge',
      `troop walked into the basin: x ${state.x}, ${state.state}`);
  });
  check('troops that cannot cross roam inland, idle and return to the shore instead of freezing at the edge', () => {
    const scene = createPixelCombatFixture(), art = scene.artworks.get('trooper');
    const unit = createPixelTerrainUnit(scene.world, art, { x: 490, y: 330 - 1 - art.footRow, facing: 1,
      ownerId: 'blue', automated: true });
    const memory = createPixelShoreMemory('blue-trooper-1'), phases = new Set();
    let edgeVisits = 0, idleTicks = 0, minX = Infinity, maxX = -Infinity, wasWaiting = false;
    for (let tick = 0; tick < 1800; tick += 1) {
      const state = unit.inspect({ sprites: false }), waiting = state.state === 'waiting at water edge';
      const roam = getPixelShoreRoam(memory, state, 1, tick, waiting);
      const direction = roam ? roam.direction : 1;
      if (roam) phases.add(roam.reason);
      if (waiting && !wasWaiting) edgeVisits += 1;
      wasWaiting = waiting;
      if (roam && direction === 0) idleTicks += 1;
      unit.input.right = direction > 0; unit.input.left = direction < 0;
      unit.step();
      const next = unit.inspect({ sprites: false });
      assert(!next.water.wet && !next.drowned, 'roaming troop walked into the water');
      if (memory.shore) { minX = Math.min(minX, next.x); maxX = Math.max(maxX, next.x); }
    }
    assert(edgeVisits >= 3 && idleTicks >= 80 && maxX - minX >= PIXEL_SHORE_ROAM.minDistance - 2 && phases.size === 3,
      `troop did not roam the shore: visits ${edgeVisits}, idle ${idleTicks}, span ${maxX - minX}`);
    const held = getPixelShoreRoam(memory, unit.inspect({ sprites: false }), 0, 1800, false);
    const away = getPixelShoreRoam(memory, unit.inspect({ sprites: false }), -1, 1801, false);
    assert(held === null && away === null && memory.shore === null,
      'shore roaming overrode firing holds or blocked moving away from the water');
  });
  check('ground engagement advances, halts in range to fire and backs off from close enemies', () => {
    const at = (x) => ({ x, y: 300, width: 10, height: 10, facing: 1, collision: [{ x: 0, y: 0 }, { x: 9, y: 9 }] });
    for (const kind of ['trooper', 'tank']) {
      const range = PIXEL_GROUND_ENGAGEMENT[kind], memory = {};
      const far = getPixelGroundEngagement(kind, at(0), at(range.engage + 40), memory, { clear: true }, 1);
      const hold = getPixelGroundEngagement(kind, at(0), at(range.minimum + 40), memory, { clear: true }, 1);
      const close = getPixelGroundEngagement(kind, at(0), at(range.minimum - 10), memory, { clear: true }, 1);
      const still = getPixelGroundEngagement(kind, at(0), at(range.minimum + 15), memory, { clear: true }, 1);
      assert(far.direction === 1 && hold.direction === 0 && hold.hold && close.direction === -1 && still.direction === -1,
        `${kind} engagement did not advance, hold, then back off with hysteresis`);
      const covered = getPixelGroundEngagement(kind, at(0), at(range.minimum + 20), {}, { clear: false, reason: 'terrain' }, 1);
      const touching = getPixelGroundEngagement(kind, at(0), at(range.contact + 5), {}, { clear: false, reason: 'terrain' }, 1);
      assert(covered.direction === 1 && !covered.hold && touching.direction === -1,
        `${kind} stalled behind cover at standoff range or closed into contact`);
    }
    const scene = createPixelCombatFixture({ terrain: 'dry-route' });
    scene.configure({ spawning: false, devices: false, fighting: true, transporting: false });
    const troop = scene.spawn(scene.bases[0], 'trooper').entry, tank = scene.spawn(scene.bases[1], 'tank').entry;
    let minimumGap = Infinity, held = 0;
    for (let tick = 0; tick < 1500 && scene.combat.health(troop.id).health > 0 && scene.combat.health(tank.id).health > 0; tick += 1) {
      scene.step();
      const a = getPixelCombatBounds(troop.unit.inspect()), b = getPixelCombatBounds(tank.unit.inspect());
      minimumGap = Math.min(minimumGap, Math.max(b.left - a.right, a.left - b.right));
      if (troop.tactic.includes('holding distance') || tank.tactic.includes('holding distance')) held += 1;
    }
    assert(minimumGap > 40 && held > 30 && scene.combat.inspect().fired > 0,
      `ground units ran into each other or never held to fire (gap ${minimumGap}, held ${held})`);
    scene.audit();
  });
  check('roster roles: health order, DPS by role and armor that resists small arms', () => {
    const W = PIXEL_LAB_WEAPONS, dps = (kind) => W[kind].damage / W[kind].cooldown;
    assert(W.trooper.health < W.jet.health && W.jet.health < W.tank.health && W.tank.health < W.hopper.health,
      'health order must be trooper < jet < tank < mech');
    assert(dps('trooper') < dps('tank') && dps('trooper') < dps('hopper') && dps('trooper') < dps('jet'),
      'troopers must deal the least damage per second');
    assert(W.tank.damage >= W.trooper.health, 'a tank shell must one-shot a trooper');
    assert(W.tank.cooldown > W.hopper.cooldown && W.hopper.cooldown > W.trooper.cooldown && W.trooper.cooldown > W.jet.cooldown,
      'heavier weapons must reload slower');
    const rifle = { kind: 'bullet', sourceKind: 'trooper', damage: W.trooper.damage };
    const cannon = { kind: 'bullet', sourceKind: 'jet', damage: W.jet.damage };
    const shell = { kind: 'shell', sourceKind: 'tank', damage: W.tank.damage };
    assert(pixelArmorDamage('trooper', rifle) === W.trooper.damage && pixelArmorDamage('jet', cannon) === W.jet.damage,
      'unarmored targets lost damage');
    assert(pixelArmorDamage('tank', rifle) < W.trooper.damage / 2 && pixelArmorDamage('hopper', cannon) === Math.round(W.jet.damage / 2) &&
      pixelArmorDamage('tank', shell) === W.tank.damage, 'armor multipliers wrong');
    const world = createParticleWorld(400, 200, { skipEmptyChunks: true });
    for (let x = 0; x < world.width; x += 1) for (let y = 180; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const assets = createPixelCombatFixture().artworks;
    const shooter = createPixelTerrainUnit(world, assets.get('trooper'), { x: 40, y: 100, facing: 1, ownerId: 'blue' });
    const tank = createPixelVehicleUnit(world, assets.get('tank'), { kind: 'tank', x: 200, y: 100, facing: -1, ownerId: 'red' });
    const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    combat.register('rifle', shooter, 'trooper', 'blue'); combat.register('tank', tank, 'tank', 'red');
    const state = tank.inspect(), pixel = state.pixels[Math.floor(state.pixels.length / 2)];
    assert(combat.fire('rifle', { x: state.x + pixel.x, y: state.y + pixel.y }).ok, 'rifle could not fire at the tank');
    for (let i = 0; i < 120; i += 1) combat.step();
    const hit = combat.inspect({ sprites: false }).impacts.find((impact) => impact.targetId === 'tank');
    assert(hit && hit.damage === pixelArmorDamage('tank', rifle) &&
      combat.health('tank').health === W.tank.health - hit.damage, 'live rifle hit ignored tank armor');
  });
  check('mechs have the most health and circle a nearby enemy while firing', () => {
    assert(['trooper', 'tank', 'jet'].every((kind) => PIXEL_LAB_WEAPONS.hopper.health > PIXEL_LAB_WEAPONS[kind].health),
      'mechs are not the toughest unit');
    const scene = createPixelCombatFixture({ terrain: 'dry-route' });
    // Firing disabled so the target survives long enough to observe several circling passes.
    scene.configure({ spawning: false, devices: false, fighting: false, transporting: false });
    const hopper = scene.spawn(scene.bases[0], 'hopper').entry, troop = scene.spawn(scene.bases[1], 'trooper').entry;
    const sides = new Set();
    let reversals = 0, previous = 0, circling = 0, firing = true;
    for (let tick = 0; tick < 2400; tick += 1) {
      scene.step();
      if (!hopper.tactic.includes('circling')) continue;
      circling += 1; firing = firing && hopper.strategy.fire;
      const h = getPixelCombatBounds(hopper.unit.inspect()), t = getPixelCombatBounds(troop.unit.inspect());
      sides.add(Math.sign(h.x - t.x));
      const direction = Number(hopper.unit.input.right) - Number(hopper.unit.input.left);
      if (direction && previous && direction !== previous) reversals += 1;
      if (direction) previous = direction;
    }
    assert(circling > 0 && sides.has(-1) && sides.has(1) && reversals >= 2 && firing,
      `mech did not keep moving around its target while firing (sides ${[...sides]}, reversals ${reversals})`);
    scene.audit();
  });
  check('simultaneous deaths share a bounded particle pool and report suppression', () => {
    const scene = createPixelCombatFixture(), art = scene.artworks.get('trooper');
    for (let index = 0; index < 40; index += 1) {
      const unit = createPixelTerrainUnit(scene.world, art, { x: 300, y: 100, ownerId: 'blue' });
      scene.combat.register(`burst-${index}`, unit, 'trooper', 'blue');
      scene.combat.destroyUnit(`burst-${index}`); scene.combat.unregister(`burst-${index}`);
    }
    const state = scene.combat.inspect();
    assert(state.deathParticles.length === 512 && state.suppressedDeathParticles === 40 * 48 - 512 &&
      state.deathEvents.length === 32 && state.deaths === 40, 'death cap, history or suppression is incorrect');
    for (let tick = 0; tick < 80; tick += 1) scene.combat.step();
    assert(scene.combat.inspect().deathParticles.length === 0, 'capped effects leaked');
  });
  check('hands-off tanks carry accounted quarter-size troops and deploy directly from rear hatches', () => {
    const scene = createPixelCombatFixture({ terrain: 'dry-route' });
    scene.configure({ fighting: false, devices: false });
    const seen = new Set(), issued = new Set();
    for (let tick = 0; tick < 1000 && scene.transport.deployed < 6; tick += 1) {
      scene.step();
      assert(scene.bases.every((base) => scene.livingCount(base.owner) <= 4), 'passengers bypassed living cap');
      for (const entry of scene.units) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        const state = entry.unit.inspect();
        assert(scene.artworks.get(entry.kind).cellReduction === 4, 'unit scale differs from current city labs');
        if (!entry.deployedFrom) continue;
        const carrier = scene.units.find((other) => other.id === entry.deployedFrom);
        assert(carrier && carrier.owner === entry.owner, 'troop belongs to wrong or missing tank');
        const tank = carrier.unit.inspect(), body = getPixelCombatBounds(tank);
        const hatch = carrier.owner === 'blue' ? body.left : body.right;
        assert(Math.abs(state.x + state.width / 2 - hatch) <= 2 &&
          state.y + state.footRow === tank.y + tank.footRow &&
          state.facing === (entry.owner === 'blue' ? -1 : 1), 'troop spawned away from its rear hatch');
        assert(!findPixelUnitContact(scene.world, state.x, state.y, state.collision) &&
          !state.water.wet && state.grounded, 'troop deployed into material, water or unsupported space');
        issued.add(entry.id);
      }
    }
    assert(scene.transport.loaded === 6 && scene.transport.deployed === 6 && issued.size === 6 &&
      scene.bases.every((base) => base.spawned === 4) && scene.units.length === 8,
    'automatic multi-passenger deployment failed or reissued passengers');
    scene.audit();
  });
  check('a blocked rear hatch retains passengers instead of spawning at a distant clear spot', () => {
    const scene = createPixelCombatFixture({ terrain: 'dry-route' });
    scene.configure({ fighting: false, devices: false });
    let carrier;
    for (let tick = 0; tick < 600; tick += 1) {
      scene.step();
      carrier = scene.units.find((entry) => entry.kind === 'tank' && entry.cargo.length &&
        entry.transportPhase === 'deploying');
      if (carrier) break;
    }
    assert(carrier, 'tank never reached its deployment area');
    const tank = carrier.unit.inspect(), body = getPixelCombatBounds(tank), art = scene.artworks.get('trooper');
    const direction = carrier.owner === 'blue' ? -1 : 1;
    const x = Math.round((carrier.owner === 'blue' ? body.left : body.right) - art.width / 2);
    const y = tank.y + tank.footRow - art.footRow;
    for (const pixel of art.mask('standing', direction)) {
      if (scene.world.at(x + pixel.x, y + pixel.y) === PARTICLE_EMPTY) {
        assert(scene.world.emitDebris(x + pixel.x, y + pixel.y).ok, 'hatch block failed');
        scene.initial.material += 1;
      }
    }
    carrier.nextDeploy = scene.ticks + 1;
    const count = carrier.cargo.length, deployed = scene.transport.deployed;
    scene.step();
    assert(carrier.cargo.length === count && scene.transport.deployed === deployed &&
      carrier.transportStatus.includes('rear hatch blocked'), 'blocked hatch teleported a passenger');
    scene.audit();
  });
  check('carrier destruction accounts passenger losses once and frees living but not lifetime slots', () => {
    const scene = createPixelCombatFixture(), base = scene.bases[0], entry = scene.spawn(base, 'tank').entry;
    scene.configure({ spawning: false, devices: false, fighting: false });
    scene.step();
    assert(entry.cargo.length === 3 && base.spawned === 4 && scene.livingCount('blue') === 4, 'cargo was not accounted');
    assert(!scene.spawn(base, 'trooper').ok, 'embarked troops bypassed base cap');
    scene.combat.destroyUnit(entry.id); scene.step(); scene.step();
    assert(scene.transport.lost === 3 && scene.transport.deployed === 0 && scene.livingCount('blue') === 0 &&
      base.spawned === 4 && scene.combat.inspect().deaths === 1 &&
      scene.combat.inspect().deathEvents[0].effect === 'sparks', 'carrier loss duplicated or erased issuance');
    assert(scene.spawn(base, 'trooper').ok && base.spawned === 5, 'carrier loss did not free living slots');
  });
  check('aggressive hoppers press attacks at low health without damage-risk retreat or baiting', () => {
    const scene = createPixelCombatFixture({ terrain: 'dry-route' });
    scene.configure({ spawning: false, devices: false, transporting: false });
    const entry = scene.spawn(scene.bases[0], 'hopper').entry;
    scene.spawn(scene.bases[1], 'hopper');
    scene.combat.fallingDebrisDamage(entry.id, PIXEL_LAB_WEAPONS.hopper.health - 5);
    const state = entry.unit.inspect(), body = getPixelCombatBounds(state);
    assert(scene.world.emitDebris(Math.floor(body.x), Math.floor(body.top - 12)).ok, 'risk fixture failed');
    scene.initial.material += 1;
    scene.step();
    assert(scene.combat.health(entry.id).health === 5 && entry.strategy.acceptRisk && entry.strategy.fire &&
      entry.unit.input.right && scene.ticks >= entry.evadeUntil && entry.tactic.includes('aggressive assault'),
    'low-health hopper feared damage, baited or retreated');
    const memory = {};
    const decision = getPixelHopperStrategy(state,
      { id: 'target', state: { ...state, x: state.x + 250 } }, memory, 0, [], { clear: false }, true);
    assert(decision.direction === 1 && decision.jump && decision.fire && decision.acceptRisk &&
      memory.phase === 'assault', 'blocked attack did not seek a clear forward shot');
    scene.audit();
  });
  check('rubble cannot harden inside living unit cells and merges after they clear', () => {
    const world = createParticleWorld(40, 40), group = createPixelUnitCollisionGroup(world);
    for (let x = 0; x < 40; x += 1) for (let y = 30; y < 40; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const unit = { inspect: () => ({ x: 10, y: 29, collision: [{ x: 0, y: 0 }] }) };
    group.register(unit, 'blue'); world.configureDebrisMerging(2);
    world.configureDebrisMergeOccupancy(group.isOccupied);
    assert(world.emitDebris(10, 29).ok, 'rubble emission failed');
    for (let tick = 0; tick < 4; tick += 1) world.step();
    assert(world.at(10, 29) === PARTICLE_DEBRIS && world.mergedDebrisCount === 0,
      'rubble became solid inside a living collision cell');
    group.unregister(unit); world.step();
    assert(world.at(10, 29) === PARTICLE_TERRAIN && world.mergedDebrisCount === 1 && world.debrisCount === 0,
      'clear rubble did not resume normal conserved merging');
  });
  check('shared combat preserves comparison-relative tank3 mech2 plane4 proportions at map scale', () => {
    const scene = createPixelCombatFixture();
    for (const [kind, reference, roles] of [
      ['trooper', PIXEL_UNIT_REFERENCE, undefined], ['tank', PIXEL_TANK_REFERENCE, ['move', 'aim']],
      ['hopper', PIXEL_HOPPER_REFERENCE, ['idle', 'jump', 'boost', 'fall']],
      ['jet', PIXEL_JET_REFERENCE, ['fly', 'shoot', 'down']],
    ]) {
      const expected = createPixelUnitArtwork(reference, { roles, cellScale: PIXEL_UNIT_RELATIVE_SCALES[kind],
        cellReduction: 4, inPlace: kind === 'hopper' }), actual = scene.artworks.get(kind);
      assert(actual.width === expected.width && actual.height === expected.height &&
        actual.footRow === expected.footRow && actual.cellScale === PIXEL_UNIT_RELATIVE_SCALES[kind],
      `${kind} was flattened to the same scale as infantry`);
    }
  });
  check('troops fit actual building doors; enemy tanks drive behind the hangar and mechs pass its walls', () => {
    const scene = createPixelCombatFixture({ terrain: 'dry-route' }), base = scene.bases[0];
    const art = scene.artworks.get('trooper'), x = base.frame.left + base.frame.width + 4;
    const troop = createPixelTerrainUnit(scene.world, art, { x, y: 329 - art.footRow, facing: -1 });
    troop.input.left = true;
    for (let tick = 0; tick < 60; tick += 1) troop.step();
    assert(troop.inspect().x + art.width < base.frame.left + base.frame.width, 'troop could not walk through real door');
    const coreRight = Math.max(...base.frame.core.map((cell) => cell.x));
    for (const kind of ['tank', 'hopper']) {
      const vehicleArt = scene.artworks.get(kind);
      const vehicle = createPixelVehicleUnit(scene.world, vehicleArt, { kind, x,
        y: 330 - vehicleArt.footRow, facing: -1, ownerId: 'red',
        ...scene.buildingLayers.contactOptions(kind, 'red') });
      vehicle.input.left = true;
      for (let tick = 0; tick < 900; tick += 1) vehicle.step();
      const state = vehicle.inspect();
      assert(state.x + state.width < base.frame.left + base.frame.width - 3, `${kind} could not pass the enemy wall`);
      if (kind === 'tank') {
        assert(state.blocker && scene.buildingLayers.coreAt(state.blocker.x, state.blocker.y) &&
          state.x > coreRight - 2, 'tank drove through the enemy core instead of stopping at it');
      }
    }
    scene.audit();
  });
  check('vehicles pass behind any building but never through enemy cores, terrain or loose debris physics', () => {
    const scene = createPixelCombatFixture(), building = scene.bases[0].frame;
    const wall = building.cells.find((cell) => cell.x === building.left && cell.y === building.top + 20);
    const core = building.core[0];
    for (const kind of ['tank', 'hopper']) {
      const friendly = scene.buildingLayers.contactOptions(kind, 'blue').ignoreMaterial;
      const enemy = scene.buildingLayers.contactOptions(kind, 'red').ignoreMaterial;
      assert(!findPixelUnitContact(scene.world, wall.x, wall.y, [{ x: 0, y: 0 }], true, friendly) &&
        !findPixelUnitContact(scene.world, wall.x, wall.y, [{ x: 0, y: 0 }], true, enemy),
      `${kind} was blocked by a building wall`);
      assert(!findPixelUnitContact(scene.world, core.x, core.y, [{ x: 0, y: 0 }], true, friendly) &&
        findPixelUnitContact(scene.world, core.x, core.y, [{ x: 0, y: 0 }], true, enemy),
      `${kind} did not stop at an enemy core`);
      assert(findPixelUnitContact(scene.world, 300, 350, [{ x: 0, y: 0 }], true, friendly).material === PARTICLE_TERRAIN,
        'background route bypassed physical ground');
      assert(!friendly(wall.x, wall.y, PARTICLE_DEBRIS), 'background route erased loose debris physics');
      assert(!scene.buildingLayers.ignores(kind, 'red', wall.x, wall.y, PARTICLE_BARRIER),
        `${kind} shots acquired the enemy background layer`);
    }
    for (const kind of ['trooper', 'jet']) {
      assert(!scene.buildingLayers.ignores(kind, 'blue', wall.x, wall.y, PARTICLE_BARRIER) &&
        !scene.buildingLayers.contactOptions(kind, 'red').ignoreMaterial(wall.x, wall.y, PARTICLE_BARRIER) &&
        !scene.buildingLayers.contactOptions(kind, 'red').platformAt,
      `${kind} incorrectly acquired the vehicle background layer`);
    }
  });
  check('hoppers land on building roofs and walk along them like platforms', () => {
    const scene = createPixelCombatFixture({ terrain: 'dry-route' });
    scene.configure({ spawning: false, devices: false, fighting: false });
    for (const owner of ['blue', 'red']) {
      const frame = scene.bases[0].frame, art = scene.artworks.get('hopper');
      const hopper = createPixelVehicleUnit(scene.world, art, { kind: 'hopper', x: frame.left + 60,
        y: frame.top - art.height - 20, facing: 1, ownerId: owner,
        ...scene.buildingLayers.contactOptions('hopper', owner) });
      const feet = () => { const s = hopper.inspect(); return s.y + Math.max(...s.collision.map((pixel) => pixel.y)); };
      for (let tick = 0; tick < 120; tick += 1) hopper.step();
      assert(hopper.inspect().grounded && feet() === frame.top - 1, `${owner} hopper did not land on the roof (${feet()})`);
      const startX = hopper.inspect().x;
      hopper.input.right = true;
      for (let tick = 0; tick < 40; tick += 1) hopper.step();
      assert(hopper.inspect().x > startX + 10 && hopper.inspect().grounded && feet() === frame.top - 1,
        `${owner} hopper did not walk along the roof`);
      for (let tick = 0; tick < 900 && hopper.inspect().x < frame.left + frame.width + 4; tick += 1) hopper.step();
      hopper.input.right = false;
      for (let tick = 0; tick < 240; tick += 1) hopper.step();
      assert(hopper.inspect().x > frame.left + frame.width && feet() >= 328,
        `${owner} hopper did not walk off the roof edge down to the ground`);
    }
    scene.audit();
  });
  check('hands-off units close in, breach enemy structure and destroy the enemy core', () => {
    const scene = createPixelCombatFixture({ terrain: 'dry-route' });
    scene.configure({ spawning: false, devices: false });
    const [blue, red] = scene.bases;
    for (const kind of ['tank', 'trooper', 'hopper']) assert(scene.spawn(blue, kind).ok, `${kind} spawn failed`);
    const surviving = () => red.frame.core.filter((cell) => scene.world.at(cell.x, cell.y) === PARTICLE_BARRIER).length;
    let firstHit = null;
    for (let tick = 0; tick < 2400 && surviving(); tick += 1) {
      scene.step();
      if (firstHit === null && surviving() < red.frame.core.length) {
        firstHit = tick;
        const closest = Math.min(...scene.units.map((entry) => {
          const state = entry.unit.inspect({ sprites: false });
          return Math.abs(state.x + state.width / 2 - red.frame.core[0].x);
        }));
        assert(closest <= PIXEL_CORE_ASSAULT_RANGE + 40, `core was sniped from ${closest} cells away`);
      }
    }
    assert(surviving() === 0 && !scene.activeCore(red), 'enemy core survived the hands-off assault');
    assert(scene.activeCore(blue), 'friendly core was damaged');
    scene.audit();
  });
  check('tank and mech shots pass friendly buildings but enemy buildings still intercept them', () => {
    const scene = createPixelCombatFixture({ terrain: 'dry-route' });
    const tank = scene.spawn(scene.bases[0], 'tank').entry;
    const friendlyWall = scene.bases[0].frame.cells.find((cell) => cell.x === 110 && cell.y === 310);
    assert(friendlyWall, 'friendly wall fixture missing');
    const clear = scene.combat.firingPath(tank.id, { x: 90, y: 310 });
    assert(clear.clear, 'tank cannot shoot through its own background building');
    // A blue tank within shell range of the red building: its arc must be stopped by the hostile structure.
    const red = scene.bases[1].frame, art = scene.artworks.get('tank');
    const probe = createPixelVehicleUnit(scene.world, art, { kind: 'tank', x: red.left - 200,
      y: 330 - art.footRow - 40, facing: 1, ownerId: 'blue', ...scene.buildingLayers.contactOptions('tank', 'blue') });
    scene.combat.register('probe-tank', probe, 'tank', 'blue');
    const inside = { x: red.left + Math.floor(red.width / 2), y: 300 };
    const hostile = scene.combat.firingPath('probe-tank', inside);
    assert(hostile.arc && !hostile.clear && hostile.reason === 'structure',
      `tank shot passed hostile building: ${hostile.reason}`);
    scene.combat.unregister('probe-tank');
    const troop = scene.spawn(scene.bases[0], 'trooper').entry;
    assert(!scene.combat.firingPath(troop.id, { x: 90, y: 310 }).clear, 'troop shot bypassed foreground wall');
  });
  check('planes sweep into buildings, crash once, damage actual structure and conserve material', () => {
    for (const owner of ['blue', 'red']) {
      const scene = createPixelCombatFixture({ terrain: 'dry-route' });
      scene.configure({ spawning: false, devices: false, fighting: false });
      const art = scene.artworks.get('jet'), building = scene.bases[0].frame;
      const unit = createPixelVehicleUnit(scene.world, art, { kind: 'jet',
        x: building.left + building.width + 10, y: building.top + 30,
        facing: -1, ownerId: owner, speedScale: 1.8, ...scene.buildingLayers.contactOptions('jet', owner),
        onBuildingImpact: (hit, velocity) => scene.combat.crashUnit('crash', hit, velocity) });
      scene.combat.register('crash', unit, 'jet', owner); unit.input.left = true;
      for (let tick = 0; tick < 180 && !unit.inspect().killed; tick += 1) { unit.step(0.1); scene.combat.step(0.1); }
      const state = scene.combat.inspect();
      assert(unit.inspect().killed && scene.combat.health('crash').health === 0 &&
        state.deaths === 1 && state.deathEvents[0].reason === 'building crash' &&
        state.damagedStructure > 0 && state.impacts.some((hit) => hit.kind === 'crash'),
      `${owner} plane did not crash into physical building pixels`);
      scene.combat.crashUnit('crash', { x: 110, y: 200 }, { vx: 90, vy: 0 });
      assert(scene.combat.inspect().deaths === 1 && scene.combat.inspect().damagedStructure === state.damagedStructure,
        'plane collision emitted repeated damage/death effects');
      scene.audit();
    }
  });
  check('base-directed hoppers never reverse for targets behind them or thin obstacles ahead', () => {
    const scene = createPixelCombatFixture({ terrain: 'dry-route' });
    scene.configure({ spawning: false, devices: false, fighting: false, transporting: false });
    const hopper = scene.spawn(scene.bases[0], 'hopper').entry;
    let previous = hopper.unit.inspect().x;
    for (let tick = 0; tick < 360; tick += 1) {
      scene.step();
      const state = hopper.unit.inspect();
      assert(state.x >= previous && !hopper.unit.input.left &&
        !state.navigation.includes('backing'), 'assault hopper reversed away from the enemy base');
      previous = state.x;
    }
    const state = hopper.unit.inspect(), decision = getPixelHopperStrategy(state,
      { id: 'behind', state: { ...state, x: state.x - 400 } }, {}, 400, [], { clear: false }, true, 1);
    assert(decision.direction === 1 && decision.acceptRisk, 'distant rear target reversed the base objective');
    scene.audit();
    const world = createParticleWorld(420, 240), art = scene.artworks.get('hopper');
    for (let x = 0; x < world.width; x += 1) for (let y = 190; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    for (let y = 176; y < 190; y += 1) world.set(100, y, PARTICLE_TERRAIN);
    const unit = createPixelVehicleUnit(world, art,
      { kind: 'hopper', x: 20, y: 190 - art.footRow, facing: 1, automated: true, assault: true });
    unit.input.right = true;
    previous = 20;
    for (let tick = 0; tick < 240; tick += 1) {
      unit.step();
      assert(unit.inspect().x >= previous && !unit.inspect().navigation.includes('backing'),
        'low-level route avoidance reversed assault at a thin obstacle');
      previous = unit.inspect().x;
    }
  });
  check('wet-route passenger reservation never issues negative cargo when all living slots are occupied', () => {
    const scene = createPixelCombatFixture();
    scene.configure({ spawning: true, devices: false, fighting: false, transporting: true });
    for (let index = 0; index < 4; index += 1) assert(scene.spawn(scene.bases[0], 'tank').ok, 'capacity setup failed');
    scene.step();
    assert(scene.transport.loaded === 0 && scene.livingCount('blue') === 4 &&
      scene.units.filter((entry) => entry.owner === 'blue').every((entry) =>
        entry.cargo.length === 0 && entry.transportPhase === 'empty') &&
      !scene.transport.events.some((event) => event.count < 0),
    'reserved hopper slot produced negative or unaccounted cargo');
    scene.audit();
  });
  function airliftScene(direction = 1) {
    const world = createParticleWorld(420, 240);
    for (let x = 0; x < world.width; x += 1) {
      const river = x >= 128 && x < 228;
      for (let y = river ? 220 : 190; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      if (river) for (let y = 190; y < 220; y += 1) world.set(x, y, PARTICLE_WATER);
    }
    const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE), units = [];
    for (const [kind, reference, roles, x] of [
      ['tank', PIXEL_TANK_REFERENCE, ['move', 'aim'], direction > 0 ? 90 : 258],
      ['hopper', PIXEL_HOPPER_REFERENCE, ['idle', 'jump', 'boost', 'fall'], direction > 0 ? 30 : 330],
    ]) {
      const art = createPixelUnitArtwork(reference, { roles, cellReduction: 4,
        cellScale: PIXEL_UNIT_RELATIVE_SCALES[kind], inPlace: kind === 'hopper' });
      const unit = createPixelVehicleUnit(world, art,
        { kind, x, y: 190 - art.footRow, facing: direction, ownerId: 'blue', assault: kind === 'hopper' });
      const entry = { id: kind, kind, owner: 'blue', unit, art, cargo: kind === 'tank' ? ['troop-a', 'troop-b'] : [] };
      units.push(entry); combat.register(kind, unit, kind, entry.owner);
    }
    const manager = createPixelTankAirlift(world, units, combat, () => direction);
    return { world, combat, units, manager, tank: units[0], hopper: units[1] };
  }
  check('hoppers automatically grip and fly loaded tanks over water in both directions without teleporting', () => {
    for (const direction of [-1, 1]) {
      const scene = airliftScene(direction), before = scene.world.waterCount;
      let composed = false;
      for (let tick = 0; tick < 1000 && !scene.manager.inspect().deliveries; tick += 1) {
        const previous = scene.units.map((entry) => entry.unit.inspect());
        const managed = scene.manager.step();
        for (const entry of scene.units) if (!managed.has(entry)) entry.unit.step();
        for (let index = 0; index < scene.units.length; index += 1) {
          const s = scene.units[index].unit.inspect();
          assert(Math.abs(s.x - previous[index].x) <= 1 && Math.abs(s.y - previous[index].y) <= 1 &&
            !s.water.wet && !s.killed, 'airlift teleported or submerged a live unit');
        }
        const h = scene.hopper.unit.inspect(), t = scene.tank.unit.inspect();
        if (h.transportPhase === 'cross') {
          const source = scene.hopper.art.frame('fall', h.frame, h.facing).pixels;
          const shift = h.footRow - Math.max(...source.map((pixel) => pixel.y + 1));
          composed = composed || h.animation === 'fall' && JSON.stringify(h.pixels) ===
            JSON.stringify(source.map((pixel) => ({ ...pixel, y: pixel.y + shift })));
          assert(h.y + h.footRow === t.y + Math.min(...t.collision.map((pixel) => pixel.y)),
            'tank is not suspended immediately beneath the gripping feet');
        }
      }
      const state = scene.tank.unit.inspect(), result = scene.manager.inspect();
      assert(result.pickups === 1 && result.deliveries === 1 && result.active === 0 && composed &&
        state.grounded && (direction > 0 ? state.x >= 228 : state.x + state.width <= 128) &&
        scene.tank.cargo.join(',') === 'troop-a,troop-b' && scene.world.waterCount === before,
      'loaded tank did not land safely with its passengers and composed carry animation');
    }
  });
  check('airlift collision sweeps wait at a sealed route without penetrating walls or dropping the tank', () => {
    const scene = airliftScene();
    const snapshot = scene.world.snapshot();
    for (let y = 0; y < 190; y += 1) snapshot.cells[y * scene.world.width + 200] = PARTICLE_BARRIER;
    scene.world.restore(snapshot);
    for (let tick = 0; tick < 700; tick += 1) scene.manager.step();
    assert(scene.manager.inspect().pickups === 1 && scene.manager.inspect().deliveries === 0 &&
      scene.manager.inspect().active === 1 && scene.tank.unit.inspect().x < 200 &&
      !scene.tank.unit.inspect().water.wet && scene.tank.airliftStatus.includes('clearance blocked'),
    'blocked airlift penetrated a one-cell wall, dropped cargo or silently claimed delivery');
  });
  check('loaded flights ease velocity, blend whole jump and fall frames and render both units as one rigid attachment', () => {
    for (const direction of [-1, 1]) {
      const scene = airliftScene(direction);
      let previous = null, grip = null, fractional = false, accelerated = false, braked = false;
      let settled = 0;
      for (let tick = 0; tick < 1000 && !scene.manager.inspect().deliveries; tick += 1) {
        scene.manager.step();
        const h = scene.hopper.unit.inspect(), t = scene.tank.unit.inspect();
        if (!h.transportPhase) continue;
        if (previous) {
          assert(Math.abs(h.vx - previous.vx) <= 3.000001 && Math.abs(h.vy - previous.vy) <= 3.000001,
            'unobstructed airlift exceeded its 180-cell/s² acceleration budget');
          assert(Math.abs(h.renderX - previous.renderX) <= 1.25 && Math.abs(h.renderY - previous.renderY) <= 1.25,
            'rendered airlift position jumped at a waypoint');
          accelerated = accelerated || Math.abs(h.vx) > Math.abs(previous.vx);
          braked = braked || Math.abs(h.vx) < Math.abs(previous.vx);
        }
        assert(Math.abs(h.vx) <= 60 && Math.abs(h.vy) <= 60 &&
          Math.abs(h.renderX - h.x) <= 1 && Math.abs(h.renderY - h.y) <= 1,
        'smooth preview exceeded the swept position or flight speed limit');
        fractional = fractional || !Number.isInteger(h.renderX) || !Number.isInteger(h.renderY);
        const source = scene.hopper.art.frame(h.animation, h.frame, h.facing).pixels;
        const shift = h.footRow - Math.max(...source.map((pixel) => pixel.y + 1));
        assert(['jump', 'fall'].includes(h.animation) && JSON.stringify(h.pixels) ===
          JSON.stringify(source.map((pixel) => ({ ...pixel, y: pixel.y + shift }))),
        'carry pose spliced or stacked sprite parts instead of showing one whole animation frame');
        const sequence = (h.animation === 'fall' ? 10 : 0) + h.frame;
        if (grip !== null && h.transportPhase !== 'approach') {
          assert(sequence >= grip, 'carry animation snapped backward instead of blending jump into fall');
        }
        if (h.transportPhase !== 'approach') grip = sequence;
        if (h.transportPhase === 'lift' || h.transportPhase === 'cross' || h.transportPhase === 'land') {
          assert(Math.abs((t.renderX - h.renderX) - (t.x - h.x)) < 1e-8 &&
            Math.abs((t.renderY - h.renderY) - (t.y - h.y)) < 1e-8 && t.frame === 0,
          'payload render offset or moving treads destabilized the attachment');
        }
        if (h.transportPhase === 'cross' && h.frame === scene.hopper.art.frameCount('fall') - 1) {
          if (previous && previous.transportPhase === 'cross') {
            assert(h.frame >= previous.frame, 'loaded-flight animation loop snapped back to takeoff');
          }
          settled += 1;
        }
        previous = h;
      }
      assert(scene.manager.inspect().deliveries === 1 && fractional && accelerated && braked && settled > 12,
        'eased flight did not demonstrate subcell motion, braking and a settled carrying pose');
    }
  });
  check('mechs only pick up tanks when they are not fighting and call off an ungripped pickup when engaged', () => {
    const scene = airliftScene();
    const art = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellReduction: 4, cellScale: PIXEL_UNIT_RELATIVE_SCALES.trooper });
    const enemyUnit = createPixelTerrainUnit(scene.world, art, { x: 60, y: 189 - art.footRow, facing: -1, ownerId: 'red' });
    const enemy = { id: 'enemy', kind: 'trooper', owner: 'red', unit: enemyUnit, cargo: [] };
    scene.units.push(enemy); scene.combat.register('enemy', enemyUnit, 'trooper', 'red');
    for (let tick = 0; tick < 120; tick += 1) scene.manager.step();
    assert(scene.manager.inspect().active === 0 && scene.manager.inspect().pickups === 0 && !scene.hopper.airlift &&
      scene.tank.airliftStatus.includes('fighting'), 'a fighting mech still flew off to pick up a tank');
    scene.units.splice(scene.units.indexOf(enemy), 1); scene.combat.unregister('enemy');
    for (let tick = 0; tick < 40 && !scene.manager.inspect().active; tick += 1) scene.manager.step();
    assert(scene.manager.inspect().active === 1 && scene.hopper.airlift, 'idle mech did not start the pickup');
    scene.units.push(enemy); scene.combat.register('enemy', enemyUnit, 'trooper', 'red');
    scene.manager.step();
    const events = scene.manager.inspect().events;
    assert(scene.manager.inspect().active === 0 && !scene.hopper.airlift && !scene.tank.airlift &&
      scene.manager.inspect().losses === 0 && events[events.length - 1].reason.includes('called off') &&
      scene.hopper.unit.inspect().transportPhase === null, 'engaged mech kept approaching an ungripped tank');
  });
  check('destroyed mechs blacken, beam fading light cones outward, then explode at half body size while troops flee', () => {
    const world = createParticleWorld(400, 240);
    for (let x = 0; x < world.width; x += 1) for (let y = 190; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    const hopperArt = createPixelUnitArtwork(PIXEL_HOPPER_REFERENCE, { roles: ['idle', 'jump', 'boost', 'fall'],
      cellReduction: 4, cellScale: PIXEL_UNIT_RELATIVE_SCALES.hopper, inPlace: true });
    const troopArt = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellReduction: 4, cellScale: PIXEL_UNIT_RELATIVE_SCALES.trooper });
    // Killed in mid-air so the wreck must fall under gravity during its fuse.
    const group = createPixelUnitCollisionGroup(world);
    const mech = createPixelVehicleUnit(world, hopperArt, { kind: 'hopper', x: 180, y: 120, facing: 1, ownerId: 'blue', collisionGroup: group });
    assert(group.has(mech), 'mech was not tracked by its collision group');
    const near = createPixelTerrainUnit(world, troopArt, { x: 205, y: 189 - troopArt.footRow, facing: -1, ownerId: 'red' });
    const runner = createPixelTerrainUnit(world, troopArt, { x: 214, y: 189 - troopArt.footRow, facing: -1,
      ownerId: 'red', automated: true });
    const far = createPixelTerrainUnit(world, troopArt, { x: 360, y: 189 - troopArt.footRow, facing: -1, ownerId: 'red' });
    combat.register('mech', mech, 'hopper', 'blue'); combat.register('near', near, 'trooper', 'red');
    combat.register('far', far, 'trooper', 'red'); combat.register('runner', runner, 'trooper', 'red');
    const startY = mech.inspect().y, before = world.terrainCount;
    combat.destroyUnit('mech'); combat.unregister('mech'); group.unregister(mech);
    let state = combat.inspect();
    const wreck = state.wrecks[0], collision = mech.inspect().collision;
    assert(getPixelBlastEscape(runner.inspect({ sprites: false }), combat.wreckThreats()),
      'troop beside the wreck did not register it was inside the blast zone');
    const size = Math.round((Math.max(...collision.map((p) => p.x)) - Math.min(...collision.map((p) => p.x)) + 1 +
      Math.max(...collision.map((p) => p.y)) - Math.min(...collision.map((p) => p.y)) + 1) / 4);
    assert(state.wrecks.length === 1 && wreck.radius === size && wreck.fuse === PIXEL_MECH_EXPLOSION.fuse &&
      state.deathEvents[0].fuse === PIXEL_MECH_EXPLOSION.fuse, 'mech death did not arm a half-body-sized fuse');
    const coverage = (list) => {
      const angles = list.map((streak) => ((streak.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
      return Math.max(...angles.map((angle, index) => (index + 1 < angles.length ? angles[index + 1] : angles[0] + Math.PI * 2) - angle));
    };
    assert(wreck.body.length === mech.inspect().pixels.reduce((sum, p) => sum + (p.details || [p]).length, 0) &&
      wreck.streaks.length >= 6 && coverage(wreck.streaks) < Math.PI / 2 &&
      wreck.streaks.every((streak) => streak.length > 0 && streak.spread > 0),
    'wreck did not keep its blackened body with light cones pointing in every direction');
    let glow = Math.max(...wreck.streaks.map((streak) => streak.glow)), streaks = wreck.streaks.length, brighter = 0;
    let reach = Math.max(...wreck.streaks.map((streak) => streak.length)), spread = wreck.streaks[0].spread, wider = 0;
    for (let tick = 1; tick < Math.round(PIXEL_MECH_EXPLOSION.fuse * 60) - 1; tick += 1) {
      const escape = getPixelBlastEscape(runner.inspect({ sprites: false }), combat.wreckThreats());
      runner.input.right = Boolean(escape && escape.direction > 0); runner.input.left = Boolean(escape && escape.direction < 0);
      runner.step();
      combat.step();
      state = combat.inspect();
      assert(state.wrecks.length === 1 && state.explosions === 0 && world.terrainCount === before,
        'mech exploded before its fuse ran out');
      const current = state.wrecks[0];
      if (tick % 15 === 0) {
        const peak = Math.max(...current.streaks.map((streak) => streak.glow));
        const longest = Math.max(...current.streaks.map((streak) => streak.length));
        if (peak > glow && current.streaks.length >= streaks) brighter += 1;
        if (longest > reach && current.streaks[0].spread > spread && coverage(current.streaks) < Math.PI / 2) wider += 1;
        glow = peak; streaks = current.streaks.length; reach = longest; spread = current.streaks[0].spread;
      }
    }
    assert(brighter >= 4 && wider >= 4 && state.wrecks[0].heat > 0.5 && mech.inspect().y > startY,
      'light cones did not keep brightening and widening outward or the wreck ignored gravity');
    const calls = [], gradients = [];
    drawPixelUnitDeathEffects({ save() {}, restore() {}, beginPath() {}, closePath() {}, fill() { calls.push('fill'); },
      moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, arc(...args) { calls.push(args); },
      createLinearGradient() { const stops = []; gradients.push(stops); return { addColorStop: (at, color) => stops.push([at, color]) }; },
    }, [], state);
    assert(gradients.length === state.wrecks[0].streaks.length && gradients.every((stops) =>
      stops[0][0] === 0 && !stops[0][1].endsWith(',0)') && stops[stops.length - 1][0] === 1 &&
      stops[stops.length - 1][1].endsWith(',0)')) && calls.filter((call) => Array.isArray(call)).length >= gradients.length,
    'light cones were not drawn as wedges fading out toward their tips');
    for (let tick = 0; tick < 4; tick += 1) combat.step();
    state = combat.inspect();
    const blast = state.impacts.find((hit) => hit.kind === 'explosion');
    assert(state.wrecks.length === 0 && state.explosions === 1 && state.blasts.length === 1 && blast &&
      blast.radius === size && world.terrainCount === before - blast.particles.terrain,
    `mech did not detonate with conserved terrain damage: ${JSON.stringify({ wrecks: state.wrecks.length,
      explosions: state.explosions, blasts: state.blasts.length, radius: blast && blast.radius, size,
      particles: blast && blast.particles, center: blast && [blast.x, blast.y] })}`);
    assert(combat.health('near').health < PIXEL_LAB_WEAPONS.trooper.health &&
      combat.health('far').health === PIXEL_LAB_WEAPONS.trooper.health &&
      combat.health('runner').health === PIXEL_LAB_WEAPONS.trooper.health &&
      blast.casualties.length === 1 && blast.casualties[0].id === 'near',
    'blast damage ignored its radius or a fleeing troop could not get clear in time');
    for (let tick = 0; tick < 60; tick += 1) combat.step();
    assert(combat.inspect().blasts.length === 0 && combat.inspect().explosions === 1, 'blast flash leaked or repeated');
  });
  check('destroying an airborne hopper releases the tank to real gravity and records only one interruption', () => {
    const scene = airliftScene();
    for (let tick = 0; tick < 700; tick += 1) {
      scene.manager.step();
      const tank = scene.tank.unit.inspect();
      if (tank.x > 140 && tank.x < 195 && scene.manager.inspect().pickups) break;
    }
    scene.combat.destroyUnit(scene.hopper.id);
    scene.manager.step(); scene.manager.step();
    assert(scene.manager.inspect().losses === 1 && !scene.tank.airlift &&
      scene.tank.unit.inspect().transportPhase === null, 'carrier loss repeated or retained an invisible attachment');
    for (let tick = 0; tick < 180; tick += 1) scene.tank.unit.step();
    assert(scene.tank.unit.inspect().drowned && scene.tank.cargo.length === 2,
      'released tank did not fall into real water or passengers were teleported out');
  });
  check('loose debris embedded in a live enemy does not make that enemy invulnerable to fire', () => {
    const world = createParticleWorld(240, 140), art = createPixelUnitArtwork(PIXEL_TANK_REFERENCE,
      { roles: ['move', 'aim'], cellReduction: 4, cellScale: 3 });
    for (let x = 0; x < world.width; x += 1) for (let y = 130; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const model = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE, { cellReduction: 4 });
    const shooter = createPixelVehicleUnit(world, art, { kind: 'tank', x: 40, y: 100, facing: 1, ownerId: 'blue' });
    const target = createPixelVehicleUnit(world, art, { kind: 'tank', x: 110, y: 100, facing: -1, ownerId: 'red' });
    model.register('shooter', shooter, 'tank', 'blue'); model.register('target', target, 'tank', 'red');
    const state = target.inspect(), body = getPixelCombatBounds(state);
    for (const pixel of state.pixels) assert(world.emitDebris(state.x + pixel.x, state.y + pixel.y).ok, 'embedded rubble setup failed');
    const point = { x: body.x, y: body.y };
    assert(model.firingPath('shooter', point).clear && model.fire('shooter', point).ok,
      'embedded rubble suppressed the firing decision');
    for (let tick = 0; tick < 120; tick += 1) model.step();
    assert(model.health('target').health < model.health('target').maxHealth &&
      model.inspect().impacts.some((hit) => hit.reason === 'unit'), 'embedded rubble prevented real unit damage');
  });
  return lines;
}
if (typeof document !== 'undefined') {
  const results = document.getElementById('combat-results');
  const lines = runPixelCombatFixtureChecks();
  results.textContent = lines.join('\n'); results.dataset.failed = String(lines.filter((line) => line.startsWith('FAIL')).length);
}
