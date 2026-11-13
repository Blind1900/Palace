(function () {
  const lines = [], selected = new URLSearchParams(location.search).get('check');
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const check = (name, run) => {
    if (selected && !name.includes(selected)) return;
    try { run(); lines.push(`PASS ${name}`); } catch (error) { lines.push(`FAIL ${name}: ${error.message}`); }
  };
  const packs = [
    ['tank', PIXEL_TANK_REFERENCE, ['move', 'aim']],
    ['hopper', PIXEL_HOPPER_REFERENCE, ['idle', 'jump', 'boost', 'fall']],
    ['jet', PIXEL_JET_REFERENCE, ['fly', 'shoot', 'down']],
  ];
  const art = (kind) => {
    const pack = packs.find((entry) => entry[0] === kind);
    return createPixelUnitArtwork(pack[1], { roles: pack[2], inPlace: kind === 'hopper' });
  };
  function flat(ground = 220, options = {}) {
    const world = createParticleWorld(800, 400, options);
    for (let x = 0; x < world.width; x += 1) for (let y = ground; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    return world;
  }
  function vehicle(kind, world = flat(), extra = {}) {
    const artwork = art(kind);
    return createPixelVehicleUnit(world, artwork, { kind, x: 200, y: 220 - artwork.footRow, facing: 1, ...extra });
  }
  function simpleTrooper() {
    const standing = { durationMs: 80, runs: Array.from({ length: 4 }, (_, y) => [0, y, 4, -16777216]) };
    const crouched = { durationMs: 80, runs: [[0, 2, 4, -16777216], [0, 3, 4, -16777216]] };
    const clip = (frames) => ({ width: 4, height: 4, frames });
    return createPixelUnitArtwork({ version: 1, nativeFacing: 1, clips: {
      walk: clip([standing]), jump: clip([standing]), crouch: clip([standing, crouched]), crouchWalk: clip([crouched]),
    } });
  }
  function pool() {
    const world = createParticleWorld(200, 140);
    for (let x = 0; x < world.width; x += 1) {
      const bottom = x >= 60 && x < 160 ? 110 : 80;
      for (let y = bottom; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      if (bottom === 110) for (let y = 80; y < 110; y += 1) world.set(x, y, PARTICLE_WATER);
    }
    return world;
  }
  check('vehicle artwork preserves every supplied pixel, source delay, role and exact facing', () => {
    for (const [kind, reference, roles] of packs) {
      const artwork = createPixelUnitArtwork(reference, { roles });
      for (const role of roles) for (let index = 0; index < artwork.frameCount(role); index += 1) {
        const source = reference.clips[role].frames[index];
        const expected = source.runs.flatMap(([x, y, length, color]) => Array.from({ length }, (_, dx) => ({ x: x + dx, y, color })));
        const native = artwork.frame(role, index, reference.nativeFacing);
        assert(native.durationMs === source.durationMs && JSON.stringify(native.pixels) === JSON.stringify(expected), `${kind}/${role} changed source pixels or timing`);
        assert(JSON.stringify(artwork.frame(role, index, -reference.nativeFacing).pixels.map((pixel) =>
          ({ ...pixel, x: artwork.width - 1 - pixel.x }))) === JSON.stringify(expected), `${kind}/${role} mirroring changed silhouette`);
      }
    }
  });
  check('partial water permits half-speed movement while full submersion drowns and sinks without changing mass', () => {
    const dry = pool(), shallow = pool(), artwork = simpleTrooper();
    for (let x = 0; x < 50; x += 1) for (let y = 78; y < 80; y += 1) shallow.set(x, y, PARTICLE_WATER);
    const a = createPixelTerrainUnit(dry, artwork, { x: 10, y: 76, facing: 1 });
    const b = createPixelTerrainUnit(shallow, artwork, { x: 10, y: 76, facing: 1 });
    const before = JSON.stringify(shallow.snapshot());
    a.input.right = true; b.input.right = true;
    for (let tick = 0; tick < 60; tick += 1) { a.step(); b.step(); }
    assert(a.inspect().x === 34 && b.inspect().x === 22 && b.inspect().state === 'wading' && !b.inspect().drowned,
      'partial submersion stopped movement or failed exact 50% slowdown');
    assert(JSON.stringify(shallow.snapshot()) === before, 'wading displaced water or altered physical mass');
    const deep = pool(), initial = JSON.stringify(deep.snapshot());
    const sunk = createPixelTerrainUnit(deep, artwork, { x: 90, y: 84, facing: 1 });
    sunk.input.right = true; sunk.input.jump = true;
    for (let tick = 0; tick < 180; tick += 1) sunk.step();
    assert(sunk.inspect().drowned && sunk.inspect().x === 90 && sunk.inspect().y === 106 &&
      sunk.inspect().state === 'drowned on bottom', 'submerged body swam, escaped drowning or stopped above the real bottom');
    assert(JSON.stringify(deep.snapshot()) === initial, 'sinking modified particle water or terrain');
    const drained = deep.snapshot();
    drained.cells = drained.cells.map((material) => material === PARTICLE_WATER ? PARTICLE_EMPTY : material); deep.restore(drained);
    sunk.step(); assert(sunk.inspect().drowned && sunk.inspect().x === 90, 'draining water revived a drowned unit');
  });
  check('automated ground units wait at the edge and manual units may enter a deep basin', () => {
    const world = pool(), artwork = simpleTrooper(), before = JSON.stringify(world.snapshot());
    const automatic = createPixelTerrainUnit(world, artwork, { x: 10, y: 76, facing: 1, automated: true });
    automatic.input.right = true;
    for (let tick = 0; tick < 240; tick += 1) automatic.step();
    assert(automatic.inspect().state === 'waiting at water edge' && automatic.inspect().x === 56 &&
      !automatic.inspect().water.wet && !automatic.inspect().drowned, 'automatic troop stepped into water or oscillated at shoreline');
    const manual = createPixelTerrainUnit(world, artwork, { x: 10, y: 76, facing: 1 });
    manual.input.right = true;
    for (let tick = 0; tick < 360; tick += 1) manual.step();
    assert(manual.inspect().drowned && manual.inspect().y === 106, 'manual troop was incorrectly blocked from entering or never sank');
    assert(JSON.stringify(world.snapshot()) === before, 'water-edge policy mutated world');
  });
  check('tank acceleration reaches maximum after 1.5 seconds and aiming stays independent of rolling', () => {
    const world = flat(), unit = vehicle('tank', world), before = JSON.stringify(world.snapshot());
    unit.input.right = true; unit.input.aimUp = true;
    for (let tick = 0; tick < 90; tick += 1) unit.step();
    const data = unit.inspect();
    assert(Math.abs(data.vx - 36) < 1e-8 && data.x === 227 && data.aim === 5 && data.aimBottom >= 0,
      'tank speed ramp, movement distance or aim range mismatch');
    assert(data.pixels.filter((pixel) => pixel.y <= data.aimBottom).length ===
      art('tank').frame('aim', 5, 1).pixels.filter((pixel) => pixel.y <= data.aimBottom).length,
      'tank duplicated moving/aiming barrels instead of composing the aim region');
    unit.input.aimUp = false; unit.input.aimDown = true;
    for (let tick = 0; tick < 60; tick += 1) unit.step();
    assert(unit.inspect().aim === 0 && unit.inspect().x === 263 && JSON.stringify(world.snapshot()) === before,
      'reverse aiming halted tracks or changed physical material');
  });
  check('hopper holds idle frame loops default art on ground and uses flight art for jumps and grounded boost coasting', () => {
    const world = flat(), unit = vehicle('hopper', world), before = JSON.stringify(world.snapshot());
    for (let tick = 0; tick < 60; tick += 1) unit.step();
    assert(unit.inspect().frame === 0 && unit.inspect().animation === 'idle' && !unit.inspect().moving,
      'stationary hopper looped instead of holding its first default frame');
    unit.input.right = true;
    let top = unit.inspect().y;
    let loopAdvanced = false;
    for (let tick = 0; tick < 120; tick += 1) {
      unit.step(); top = Math.min(top, unit.inspect().y); loopAdvanced = loopAdvanced || unit.inspect().frame > 0;
    }
    assert(top === 220 - art('hopper').footRow && unit.inspect().x === 296 && unit.inspect().charges === 2 &&
      unit.inspect().animation === 'idle' && loopAdvanced,
      'ground walking did not use the default loop or incorrectly used airborne movement');
    const boosted = vehicle('hopper', world);
    boosted.input.right = true; boosted.input.boost = true;
    for (let tick = 0; tick < 10; tick += 1) boosted.step();
    assert(boosted.inspect().charges === 1, 'held boost spent more than one charge');
    boosted.input.boost = false; boosted.step(); boosted.input.boost = true; boosted.step();
    assert(boosted.inspect().charges === 0, 'second boost did not spend the second charge');
    boosted.input.boost = false; boosted.input.right = false;
    let slide = false;
    for (let tick = 0; tick < 240; tick += 1) {
      boosted.step();
      if (boosted.inspect().slideTime > 0) { slide = true; assert(boosted.inspect().slideTime <= 2 + 1e-8, 'ground coast exceeded two seconds'); }
    }
    assert(slide && boosted.inspect().slideTime <= 1e-8, 'post-boost ground coast was absent or did not expire');
    const glider = vehicle('hopper', world); glider.input.jump = true; glider.input.glide = true;
    for (let tick = 0; tick < 360; tick += 1) glider.step();
    assert(glider.inspect().charges === 1 && glider.inspect().glideTime <= 1e-8 && glider.inspect().grounded,
      'elevated jump/glide did not consume one charge, exhaust two-second glide or land');
    assert(JSON.stringify(world.snapshot()) === before, 'hopper movement added structural material');
  });
  check('jet changes heading along an aerial arc rather than snapping facing or following ground gravity', () => {
    const world = flat(), artwork = art('jet');
    const unit = createPixelVehicleUnit(world, artwork, { kind: 'jet', x: 200, y: 70, facing: 1 });
    unit.input.right = true;
    for (let tick = 0; tick < 30; tick += 1) unit.step();
    assert(unit.inspect().x === 232 && unit.inspect().y === 70 && !unit.inspect().grounded, 'jet used ground walking or gravity in dry flight');
    unit.input.right = false; unit.input.left = true; unit.step();
    assert(unit.inspect().heading > 0 && unit.inspect().heading < Math.PI && unit.inspect().vx > 0, 'jet reversed instantly instead of turning');
    for (let tick = 0; tick < 100; tick += 1) unit.step();
    assert(unit.inspect().vx < 0 && unit.inspect().y > 70 &&
      !findPixelUnitContact(world, unit.inspect().x, unit.inspect().y, unit.inspect().collision), 'jet failed its arc or penetrated terrain');
  });
  check('hopper removes walking root resets and plays each jump once while retaining exact pixel poses and collision', () => {
    const source = JSON.stringify(PIXEL_HOPPER_REFERENCE);
    for (const cellScale of [1, 2]) {
      const native = createPixelUnitArtwork(PIXEL_HOPPER_REFERENCE, { roles: ['idle', 'jump', 'boost', 'fall'], cellScale });
      const aligned = createPixelUnitArtwork(PIXEL_HOPPER_REFERENCE, { roles: ['idle', 'jump', 'boost', 'fall'], cellScale, inPlace: true });
      for (const role of ['idle', 'jump', 'boost', 'fall']) for (let index = 0; index < aligned.frameCount(role); index += 1) {
        const frame = aligned.frame(role, index, -1), original = native.frame(role, index, -1);
        assert(frame.durationMs === original.durationMs && JSON.stringify(frame.pixels.map((pixel) =>
          ({ ...pixel, x: pixel.x - frame.rootOffset.x, y: pixel.y - frame.rootOffset.y }))) === JSON.stringify(original.pixels),
          'root-motion removal changed source pose, palette, vertical movement or delay');
        const center = frame.pixels.reduce((sum, pixel) => sum + pixel.x, 0) / frame.pixels.length;
        assert(Math.round((center - (cellScale - 1) / 2) / cellScale) * cellScale === aligned.rootAnchor.x,
          'opaque body root jumped to the back on a frame/loop transition');
        const mirror = aligned.frame(role, index, 1);
        assert(JSON.stringify(mirror.pixels.map((pixel) => ({ ...pixel, x: aligned.width - 1 - pixel.x }))) === JSON.stringify(frame.pixels),
          'in-place alignment broke exact mirroring');
        const mask = new Set(aligned.mask('standing', -1).map((pixel) => `${pixel.x},${pixel.y}`));
        assert(frame.pixels.every((pixel) => mask.has(`${pixel.x},${pixel.y}`)), 'normalized frame escaped its collision mask');
      }
      const world = flat(300), before = JSON.stringify(world.snapshot());
      const unit = createPixelVehicleUnit(world, aligned, { kind: 'hopper', x: 200, y: 300 - aligned.footRow, facing: 1 });
      unit.input.right = true; let previousRoot = null, wraps = 0, previousFrame = 0;
      for (let tick = 0; tick < 120; tick += 1) {
        unit.step(); const state = unit.inspect();
        const root = state.x + aligned.width - 1 - aligned.rootAnchor.x;
        if (previousRoot !== null) assert(root >= previousRoot && root - previousRoot <= 2,
          'walking root teleported or moved backwards instead of following the forward stride');
        if (state.frame < previousFrame) wraps += 1;
        previousRoot = root; previousFrame = state.frame;
      }
      assert(wraps >= 4 && unit.inspect().x === 296 && JSON.stringify(world.snapshot()) === before,
        'walking did not traverse several loops or changed physical cells');
    }
    const world = flat(), unit = vehicle('hopper', world); unit.input.jump = true;
    let lastFrame = 0, held = 0, landed = false;
    for (let tick = 0; tick < 240; tick += 1) {
      unit.step(); const state = unit.inspect();
      if (state.animation === 'jump') {
        assert(state.frame >= lastFrame, 'jump clip restarted while ascending');
        lastFrame = state.frame;
        if (state.frame === art('hopper').frameCount('jump') - 1) held += 1;
      }
      if (tick > 0 && state.grounded) { landed = true; break; }
    }
    assert(lastFrame === 3 && held > 10 && landed, 'jump did not hold its final frame then land');
    unit.input.jump = false; unit.step(); unit.input.jump = true; unit.step();
    assert(unit.inspect().animation === 'jump' && unit.inspect().frame === 0, 'a new jump failed to restart its one-shot clip');
    assert(JSON.stringify(PIXEL_HOPPER_REFERENCE) === source, 'in-place artwork mutated the source GIF data');
  });
  check('hopper walks smoothly and bursts on ground or in air with intact complete poses', () => {
    for (const cellScale of [1, 2]) for (const facing of [-1, 1]) {
      const artwork = createPixelUnitArtwork(PIXEL_HOPPER_REFERENCE,
        { roles: ['idle', 'jump', 'boost', 'fall'], cellScale, inPlace: true });
      assert(JSON.stringify(Array.from({ length: 5 }, (_, index) => artwork.frame('idle', index, facing).forwardTravel)) ===
        JSON.stringify([6, 7, 32, 24, 6].map((distance) => distance * cellScale)),
      'locomotion lost the supplied GIF stride or treated the wrap reset as backward travel');
      const world = flat(300), unit = createPixelVehicleUnit(world, artwork,
        { kind: 'hopper', x: 300, y: 300 - artwork.footRow, facing });
      unit.input[facing === 1 ? 'right' : 'left'] = true;
      let previous = unit.inspect(), cycles = 0, speeds = new Set();
      for (let tick = 0; tick < 120; tick += 1) {
        unit.step(); const state = unit.inspect();
        speeds.add(Math.round(Math.abs(state.vx) * 10));
        assert(Math.max(...state.pixels.map((pixel) => pixel.y + 1)) === artwork.footRow,
          'walking feet bobbed away from the ground between source frames');
        assert((state.x - previous.x) * facing >= 0 && Math.abs(state.x - previous.x) <= 2,
          'stride moved backward or teleported');
        if (state.frame < previous.frame) {
          cycles += 1;
          assert(Math.abs(state.vx - previous.vx) < 1e-8, 'forward momentum reset at the loop seam');
        }
        previous = state;
      }
      assert(cycles === 5 && speeds.size === 1 && unit.inspect().x === 300 + facing * 96,
        'walk speed pulsed between frames, loop timing drifted or average 48 cells/s changed');
      const boosted = createPixelVehicleUnit(world, artwork,
        { kind: 'hopper', x: 300, y: 300 - artwork.footRow, facing });
      boosted.input[facing === 1 ? 'right' : 'left'] = true; boosted.input.boost = true;
      const start = boosted.inspect(), snapshot = JSON.stringify(world.snapshot());
      let coasting = false, lastSpeed = 192, peakSpeed = 0;
      for (let tick = 0; tick < 180; tick += 1) {
        boosted.step(); const state = boosted.inspect();
        peakSpeed = Math.max(peakSpeed, Math.abs(state.vx));
        if (tick === 0) boosted.input.left = boosted.input.right = false;
        assert(state.y === start.y && state.grounded && state.vy === 0 && state.charges === 1,
          'boost lifted off the ground or held input spent another charge');
        assert(!findPixelUnitContact(world, state.x, state.y, state.collision), 'ground boost overlapped solid terrain');
        const mask = new Set(state.collision.map((pixel) => `${pixel.x},${pixel.y}`));
        assert(state.pixels.every((pixel) => mask.has(`${pixel.x},${pixel.y}`)), 'ground boost art escaped collision/water geometry');
        if (state.animation === 'boost') {
          assert(state.pixels.reduce((bottom, pixel) => Math.max(bottom, pixel.y + 1), 0) === artwork.footRow,
            'boost GIF visibly floated above its ground anchor');
        }
        if (state.slideTime > 0) {
          coasting = true;
          assert(state.animation === 'boost' && state.frame === artwork.frameCount('boost') - 1,
            'boost did not hold its final pose throughout the ground slide');
          assert(Math.abs(state.vx) <= lastSpeed + 1e-8, 'coasting gained speed without another boost');
          lastSpeed = Math.abs(state.vx);
        }
      }
      const end = boosted.inspect();
      assert(coasting && peakSpeed === 192 && (end.x - start.x) * facing >= 220 &&
        (end.x - start.x) * facing <= 230 && end.vx === 0 && end.slideTime === 0 &&
        JSON.stringify(world.snapshot()) === snapshot, 'burst was too slow, coast failed to stop or physical material changed');
      const jumper = createPixelVehicleUnit(world, artwork,
        { kind: 'hopper', x: 300, y: 300 - artwork.footRow, facing });
      jumper.input.jump = true;
      for (let tick = 0; tick < 12; tick += 1) jumper.step();
      const airborne = jumper.inspect();
      jumper.input[facing === 1 ? 'right' : 'left'] = true; jumper.input.boost = true; jumper.step();
      const burst = jumper.inspect();
      assert(!burst.grounded && burst.charges === airborne.charges - 1 &&
        burst.vy >= airborne.vy && burst.boostTime > 0 && Math.abs(burst.vx) === 192 &&
        burst.animation === 'boost' && burst.state === 'air boosting',
        'air burst failed, changed vertical impulse or did not use the complete boost clip');
      const stages = new Set([burst.animation]), frames = new Set([burst.frame]);
      for (let tick = 0; tick < 60; tick += 1) {
        jumper.step(); const state = jumper.inspect();
        stages.add(state.animation);
        if (state.animation === 'boost') frames.add(state.frame);
        const mask = new Set(state.collision.map((pixel) => `${pixel.x},${pixel.y}`));
        assert(state.pixels.every((pixel) => mask.has(`${pixel.x},${pixel.y}`)),
          'air boost art escaped its collision/water silhouette');
        assert(state.charges === 0, 'held air boost spent or regenerated charges');
      }
      assert(frames.size === artwork.frameCount('boost') && (stages.has('jump') || stages.has('fall')),
        'boost clip failed to blend back into the airborne animation sequence');
    }
  });
  check('hopper resting feet contact terrain and airborne poses preserve intact source frames', () => {
    for (const cellScale of [1, 2]) for (const facing of [-1, 1]) {
      const artwork = createPixelUnitArtwork(PIXEL_HOPPER_REFERENCE,
        { roles: ['idle', 'jump', 'boost', 'fall'], cellScale, inPlace: true });
      const world = flat(300), unit = createPixelVehicleUnit(world, artwork,
        { kind: 'hopper', x: 300, y: 300 - artwork.footRow, facing });
      const idle = unit.inspect();
      const bottom = Math.max(...idle.pixels.map((pixel) => idle.y + pixel.y));
      assert(bottom === 299 && idle.pixels.some((pixel) => idle.y + pixel.y === bottom &&
        world.at(idle.x + pixel.x, bottom + 1) === PARTICLE_TERRAIN), 'resting hopper floats above its support');
      unit.input.jump = true;
      const jumpFrames = new Set(), fallFrames = new Set();
      for (let tick = 0; tick < 240; tick += 1) {
        unit.step(); const state = unit.inspect();
        if (state.animation === 'jump' || state.animation === 'fall') {
          const source = artwork.frame(state.animation, state.frame, facing).pixels;
          const offset = state.pixels[0].y - source[0].y;
          const normalize = (pixels) => pixels.map((pixel) =>
            `${pixel.x},${pixel.y - offset},${pixel.color}`).sort().join(';');
          assert(normalize(state.pixels) === source.map((pixel) =>
            `${pixel.x},${pixel.y},${pixel.color}`).sort().join(';'),
          `airborne ${state.animation} frame ${state.frame} was stitched, clipped or duplicated`);
          if (state.animation === 'jump') jumpFrames.add(state.frame);
          else fallFrames.add(state.frame);
        }
        if (tick > 0 && state.grounded) break;
      }
      assert(jumpFrames.size === artwork.frameCount('jump') && fallFrames.size > 0,
        'airborne motion did not display jump and fall source frames');
    }
  });
  check('combat cursor aim maps the zoomed and panned preview into exact world cells', () => {
    const canvas = { getBoundingClientRect: () => ({ left: -2957, top: 82, width: 4840, height: 871 }) };
    const point = getPixelUnitAimPoint(canvas, { width: 1000, height: 180 },
      { clientX: -2957 + 4840 * 0.75, clientY: 82 + 871 * 0.5 });
    assert(point.x === 750 && point.y === 90, 'zoom/pan changed the aimed world cell');
    let rejected = false;
    try { getPixelUnitAimPoint(canvas, { width: 1000, height: 180 }, { clientX: 99999, clientY: 10 }); }
    catch (error) { rejected = error.message.includes('outside'); }
    assert(rejected, 'outside-world aim was silently accepted');
  });
  check('patrol reverses units at crop ends without changing shoreline rules and jets retain curved turns', () => {
    const world = createParticleWorld(80, 50);
    for (let x = 0; x < 80; x += 1) for (let y = 40; y < 50; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const unit = createPixelTerrainUnit(world, simpleTrooper(), { x: 30, y: 36, facing: 1 });
    unit.input.right = true; let turns = 0;
    for (let tick = 0; tick < 600; tick += 1) {
      if (updatePixelUnitLabPatrol(unit, world)) turns += 1;
      unit.step(); const state = unit.inspect();
      assert(state.x >= 0 && state.x + state.width <= world.width && !state.blocker, 'patrol hit or crossed a crop edge');
    }
    assert(turns >= 3, 'ground unit failed to reverse at both ends');
    const flight = createParticleWorld(300, 260);
    for (let x = 0; x < 300; x += 1) for (let y = 240; y < 260; y += 1) flight.set(x, y, PARTICLE_TERRAIN);
    const jet = createPixelVehicleUnit(flight, art('jet'), { kind: 'jet', x: 120, y: 40, facing: 1 });
    let jetTurns = 0;
    for (let tick = 0; tick < 900; tick += 1) {
      const before = jet.inspect().heading;
      if (updatePixelUnitLabPatrol(jet, flight, 40)) jetTurns += 1;
      jet.step(); const state = jet.inspect();
      assert(Math.abs(state.heading - before) <= 1.8 / 60 + 1e-8 &&
        !(state.blocker && state.blocker.reason === 'crop edge'), 'jet snapped its heading or escaped during a patrol turn');
    }
    assert(jetTurns >= 2, 'jet failed repeated edge turns');
  });
  function combatFixture(enemyOwner = 'opposing') {
    const world = flat(300), artwork = simpleTrooper(), combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    const shooter = createPixelTerrainUnit(world, artwork, { x: 20, y: 100, facing: 1, ownerId: 'friendly' });
    const enemy = createPixelTerrainUnit(world, artwork, { x: 650, y: 100, facing: -1, ownerId: enemyOwner });
    combat.register('shooter', shooter, 'trooper', 'friendly');
    combat.register('enemy', enemy, 'trooper', enemyOwner);
    return { world, combat, shooter, enemy };
  }
  check('combat bullets retain visible reference pixels and travel beyond the GIF before a unit hit', () => {
    const { combat, enemy } = combatFixture();
    assert(combat.fire('shooter', { x: 652, y: 102 }).ok, 'valid cursor shot was rejected');
    for (let tick = 0; tick < 90; tick += 1) combat.step();
    const shot = combat.inspect().shots[0];
    assert(shot && shot.age > 1.12 && shot.x > 350 && shot.pixels.length > 0, 'shot stopped or vanished with the GIF');
    for (let tick = 0; tick < 90; tick += 1) combat.step();
    assert(combat.health('enemy').health === PIXEL_LAB_WEAPONS.trooper.health - PIXEL_LAB_WEAPONS.trooper.damage &&
      combat.inspect().shots.length === 0 &&
      combat.inspect().impacts.some((hit) => hit.targetId === 'enemy') && !enemy.inspect().killed,
    'travelling bullet failed its unit hit or wrong damage');
  });
  check('combat swept shots aim diagonally without tunneling through terrain and friendly fire stays disabled', () => {
    const { world, combat } = combatFixture();
    for (let y = 50; y < 180; y += 1) world.set(80, y, PARTICLE_TERRAIN);
    const result = combat.fire('shooter', { x: 150, y: 130 });
    const shot = combat.inspect().shots[0];
    assert(Math.abs((result.target.x - result.muzzle.x) * shot.dy -
      (result.target.y - result.muzzle.y) * shot.dx) < 1e-8, 'shot heading missed the clicked aim point');
    for (let tick = 0; tick < 10; tick += 1) combat.step(0.1);
    assert(combat.inspect().impacts[0].reason === 'material' && combat.inspect().terrainDebris > 0 &&
      combat.health('enemy').health === 100, 'fast shot tunneled through a one-cell terrain wall');
    const friendly = combatFixture('friendly');
    friendly.combat.fire('shooter', { x: 652, y: 102 });
    for (let tick = 0; tick < 240; tick += 1) friendly.combat.step();
    assert(friendly.combat.health('enemy').health === 100 && friendly.combat.inspect().shots.length === 0,
      'friendly fire damaged an ally or a crop-exiting shot leaked');
  });
  check('combat hit deaths latch and reject shooting and movement commands', () => {
    const { world, combat, enemy } = combatFixture();
    for (let hit = 0; hit < Math.ceil(PIXEL_LAB_WEAPONS.trooper.health / PIXEL_LAB_WEAPONS.trooper.damage); hit += 1) {
      assert(combat.fire('shooter', { x: 652, y: 102 }).ok, 'reloaded shot was rejected');
      for (let tick = 0; tick < 180; tick += 1) { world.step(); combat.step(); }
    }
    assert(combat.health('enemy').health === 0 && enemy.inspect().killed &&
      !combat.fire('enemy', { x: 10, y: 10 }).ok, 'zero HP did not latch destruction or firing was still enabled');
    const x = enemy.inspect().x; enemy.input.left = enemy.input.jump = true;
    for (let tick = 0; tick < 30; tick += 1) enemy.step();
    assert(enemy.inspect().x === x && enemy.inspect().vy >= 0, 'destroyed unit moved or jumped under new commands');
  });
  check('combat building and terrain impacts make engine debris with exact material and water accounting', () => {
    const world = flat(300, { supportCapacity: 128 }), combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE), artwork = simpleTrooper();
    const building = addPixelCombatTargetBuilding(world, 80, 300, 30, 60), terrain = world.terrainCount;
    const unit = createPixelTerrainUnit(world, artwork, { x: 20, y: 260, facing: 1, ownerId: 'friendly' });
    combat.register('shooter', unit, 'trooper', 'friendly');
    combat.fire('shooter', { x: 80, y: 262 });
    for (let tick = 0; tick < 30; tick += 1) { world.step(); combat.step(); }
    let audit = combat.inspect();
    assert(audit.damagedStructure > 0 && world.debrisCount > 0 && audit.issuedAmmoDebris > 0,
      'building hit only changed a visual overlay or erased its physical frame');
    combat.fire('shooter', { x: 30, y: 310 });
    for (let tick = 0; tick < 60; tick += 1) { world.step(); combat.step(); }
    audit = combat.inspect();
    assert(audit.terrainDebris > 0 && world.terrainCount + audit.terrainDebris === terrain &&
      world.barrierCount + world.constructionCount + world.debrisCount === building.issued + audit.terrainDebris + audit.issuedAmmoDebris &&
      world.waterCount === 0, 'impact mass ledger failed for terrain/frame/ammo debris');
    const wet = createParticleWorld(20, 22, { skipEmptyChunks: true });
    for (let x = 0; x < 20; x += 1) for (let y = 20; y < 22; y += 1) wet.set(x, y, PARTICLE_TERRAIN);
    for (let x = 1; x < 19; x += 1) for (let y = 10; y < 20; y += 1) wet.set(x, y, PARTICLE_WATER);
    const water = wet.waterCount;
    assert(wet.emitDebris(10, 9).ok, 'physical fragment could not be emitted');
    for (let tick = 0; tick < 120; tick += 1) wet.step();
    assert(wet.at(10, 9) !== PARTICLE_DEBRIS && wet.debrisCount === 1 && wet.waterCount === water,
      'engine debris failed to fall/displace water or lost mass');
  });
  check('bullets and missiles physically damage the same building frame with their distinct impact sizes', () => {
    function attackWithBullet() {
      const world = flat(300, { supportCapacity: 128 });
      addPixelCombatTargetBuilding(world, 80, 300, 60, 70);
      const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
      const shooter = createPixelTerrainUnit(world, simpleTrooper(), {
        x: 20, y: 260, facing: 1, ownerId: 'friendly',
      });
      combat.register('shooter', shooter, 'trooper', 'friendly');
      assert(combat.fire('shooter', { x: 90, y: 262 }).ok, 'bullet shot was rejected');
      for (let tick = 0; tick < 90; tick += 1) { world.step(); combat.step(); }
      const audit = combat.inspect();
      return { world, audit };
    }
    function attackWithMissile() {
      const world = flat(300, { supportCapacity: 128 });
      addPixelCombatTargetBuilding(world, 80, 300, 60, 70);
      const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
      assert(combat.launch('friendly', { x: 30, y: 262 }, { x: 90, y: 262 }).ok,
        'missile launch was rejected');
      for (let tick = 0; tick < 90; tick += 1) { world.step(); combat.step(); }
      const audit = combat.inspect();
      return { world, audit };
    }
    const bullet = attackWithBullet(), missile = attackWithMissile();
    assert(bullet.audit.impacts.some((hit) => hit.kind === 'bullet' && hit.reason === 'material') &&
      bullet.audit.damagedStructure > 0 && bullet.world.debrisCount > 0,
    'bullet impact did not damage the physical building frame');
    assert(missile.audit.impacts.some((hit) => hit.kind === 'missile' && hit.reason === 'material') &&
      missile.audit.damagedStructure > 0 && missile.world.debrisCount > 0,
    'missile impact did not damage the physical building frame');
    assert(missile.audit.damagedStructure >= bullet.audit.damagedStructure,
      'larger missile impact damaged fewer frame cells than a bullet');
  });
  check('combat every unit has an appropriate weapon and jet GIF streaks are preview-only', () => {
    const world = flat(300), combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
    const troop = createPixelTerrainUnit(world, simpleTrooper(), { x: 20, y: 100, facing: 1, ownerId: 'friendly' });
    combat.register('trooper', troop, 'trooper', 'friendly');
    for (const [kind] of packs) combat.register(kind, vehicle(kind, world, { x: 150, y: 30, ownerId: 'friendly' }), kind, 'friendly');
    for (const kind of ['trooper', 'tank', 'hopper', 'jet']) {
      // Tank shells fly a gravity arc with a limited reach, so the tank lays its gun on a target within range.
      const target = kind === 'tank' ? { x: 400, y: 60 } : { x: 700, y: 120 };
      if (kind === 'tank') combat.layGun(kind, target);
      const fired = combat.fire(kind, target);
      assert(fired.ok && fired.kind === PIXEL_LAB_WEAPONS[kind].kind &&
        !combat.fire(kind, target).ok, `${kind} weapon kind or reload failed: ${fired.reason}`);
    }
    const shots = combat.inspect().shots, missile = shots.find((shot) => shot.kind === 'missile'), bullet = shots.find((shot) => shot.kind === 'bullet');
    assert(missile.pixels.length > bullet.pixels.length, 'missile did not retain its heavier reference silhouette');
    const jet = vehicle('jet', world, { y: 30 });
    jet.input.shoot = true;
    for (let tick = 0; tick < 12; tick += 1) jet.step();
    const state = jet.inspect();
    assert(state.previewPixels.length > 0 && state.pixels.length === 92 && state.water.totalCells === state.pixels.length,
      'detached jet GIF streak became a hittable body/water pixel instead of a preview');
  });
  check('vehicles move slower in shallow water and all submerged vehicle bodies sink to solid support', () => {
    for (const [kind] of packs) {
      const dry = flat(), wet = flat();
      const waterRow = kind === 'hopper' ? 190 : kind === 'jet' ? 208 : 210;
      for (let x = 0; x < wet.width; x += 1) for (let y = waterRow; y < 220; y += 1) wet.set(x, y, PARTICLE_WATER);
      const a = vehicle(kind, dry), b = vehicle(kind, wet);
      a.input.right = true; b.input.right = true;
      for (let tick = 0; tick < 60; tick += 1) { a.step(); b.step(); }
      assert(b.inspect().x > 200 && b.inspect().x - 200 <= (a.inspect().x - 200) * 0.5 + 1 && !b.inspect().drowned,
        `${kind} stopped in shallow water or did not slow down`);
      const deep = flat();
      for (let x = 0; x < deep.width; x += 1) for (let y = 1; y < 220; y += 1) deep.set(x, y, PARTICLE_WATER);
      const artwork = art(kind), drowned = vehicle(kind, deep, { y: 30 });
      const before = JSON.stringify(deep.snapshot()); drowned.input.right = true;
      for (let tick = 0; tick < 240; tick += 1) drowned.step();
      assert(drowned.inspect().drowned && drowned.inspect().grounded && drowned.inspect().x === 200 &&
        drowned.inspect().y === 220 - artwork.footRow && JSON.stringify(deep.snapshot()) === before,
        `${kind} failed to drown/sink or changed water/material`);
    }
  });
  check('bullet reference animation stays exact and derived missiles are three times longer and twice as thick', () => {
    const artwork = createPixelProjectileArtwork(PIXEL_BULLET_REFERENCE);
    assert(artwork.frameCount === 14, 'bullet GIF frame count changed');
    for (let index = 0; index < artwork.frameCount; index += 1) {
      const bullet = artwork.frame(index, -1), missile = artwork.frame(index, -1, 'missile');
      const source = PIXEL_BULLET_REFERENCE.clips.fly.frames[index];
      assert(bullet.durationMs === 80 && missile.durationMs === bullet.durationMs &&
        bullet.pixels.length === source.runs.reduce((sum, run) => sum + run[2], 0) &&
        missile.pixels.length === bullet.pixels.length * 6 &&
        missile.width === bullet.width * 3 && missile.height === bullet.height * 2, 'missile size or source bullet timing/pixels changed');
    }
  });
  check('automated tanks and hoppers wait dry at water and accept an existing dry bridge deck', () => {
    for (const kind of ['tank', 'hopper']) for (const bridge of [false, true]) {
      const world = createParticleWorld(800, 400);
      for (let x = 0; x < 800; x += 1) {
        const floor = x >= 400 && x < 700 ? 360 : 220;
        for (let y = floor; y < 400; y += 1) world.set(x, y, PARTICLE_TERRAIN);
        if (floor === 360) for (let y = 220; y < 360; y += 1) world.set(x, y, PARTICLE_WATER);
      }
      if (bridge) {
        const deck = world.snapshot();
        for (let x = 400; x < 700; x += 1) deck.cells[220 * 800 + x] = PARTICLE_BARRIER;
        world.restore(deck);
      }
      const before = JSON.stringify(world.snapshot()), unit = vehicle(kind, world, { automated: true });
      unit.input.right = true;
      for (let tick = 0; tick < 480; tick += 1) unit.step();
      assert(!unit.inspect().drowned && !unit.inspect().water.wet && (bridge ? unit.inspect().x > 400 :
        unit.inspect().state === 'waiting at water edge' && unit.inspect().x < 400), `${kind} entered water or rejected supported bridge`);
      assert(JSON.stringify(world.snapshot()) === before, `${kind} modified bridge/water to resolve its route`);
    }
  });
  check('comparison UI advances one shared world tick then all four units and preserves water accounting', () => {
    const scene = document.getElementById('comparison-scene');
    try {
      for (const fixture of ['flat', 'steps', 'water', 'submerged']) {
        scene.value = fixture; scene.dispatchEvent(new Event('change'));
        document.getElementById('move-right').click(); document.getElementById('comparison-second').click();
        const audit = document.getElementById('comparison-audit').textContent;
        assert(audit.includes('Shared tick 60; unit ticks 60/60/60/60') &&
          !document.getElementById('comparison-message').textContent.includes('stopped') &&
          document.getElementById('comparison-states').children.length === 4, 'comparison failed, omitted a unit or double-stepped shared physics');
        if (fixture === 'submerged') assert([...document.getElementById('comparison-states').children].every((row) =>
          row.textContent.includes('drowned')), 'submerged comparison did not mark all four drowned');
      }
    } finally { scene.value = 'flat'; scene.dispatchEvent(new Event('change')); }
  });
  check('friendly units overlap but opposing swept silhouettes block movement without physical material changes', () => {
    const world = flat(), group = createPixelUnitCollisionGroup(world), artwork = simpleTrooper();
    const a = createPixelTerrainUnit(world, artwork, { x: 10, y: 216, facing: 1, ownerId: 'a', collisionGroup: group });
    const b = createPixelTerrainUnit(world, artwork, { x: 10, y: 216, facing: 1, ownerId: 'a', collisionGroup: group });
    const enemy = createPixelTerrainUnit(world, artwork, { x: 25, y: 216, facing: -1, ownerId: 'b', collisionGroup: group });
    const before = JSON.stringify(world.snapshot());
    a.input.right = true; b.input.right = true; enemy.input.left = true;
    for (let tick = 0; tick < 60; tick += 1) { a.step(); b.step(); enemy.step(); }
    assert(a.inspect().x === b.inspect().x && a.inspect().state === 'blocked by opposing unit' &&
      enemy.inspect().x >= a.inspect().x + 4, 'friendly overlap was rejected or opponents passed through each other');
    assert(JSON.stringify(world.snapshot()) === before, 'unit collision added particles or removed physical material');
    let rejected = false;
    try { createPixelTerrainUnit(world, artwork, { x: a.inspect().x, y: 216, facing: 1, ownerId: 'b', collisionGroup: group }); }
    catch (error) { rejected = error.message.includes('opposing unit'); }
    assert(rejected, 'opposing spawn overwrote an existing body');
    const tankWorld = flat(), tankGroup = createPixelUnitCollisionGroup(tankWorld);
    const tank = vehicle('tank', tankWorld, { ownerId: 'a', collisionGroup: tankGroup });
    const foe = createPixelTerrainUnit(tankWorld, artwork, { x: 280, y: 216, facing: -1, ownerId: 'b', collisionGroup: tankGroup });
    tank.input.right = true;
    for (let tick = 0; tick < 180; tick += 1) tank.step();
    assert(tank.inspect().state === 'blocked by opposing unit' &&
      !tank.inspect().collision.some((pixel) => foe.inspect().collision.some((other) =>
        tank.inspect().x + pixel.x === foe.inspect().x + other.x && tank.inspect().y + pixel.y === foe.inspect().y + other.y)),
      'tank swept through an opposing trooper');
  });
  check('comparison defaults enlarge vehicles and the preview precedes options stats explanations and checks', () => {
    const scene = document.getElementById('comparison-scene');
    const choose = (value) => { scene.value = value; scene.dispatchEvent(new Event('change')); };
    choose('flat');
    const rows = [...document.getElementById('comparison-states').children].map((row) => row.textContent);
    assert(rows[1].includes('120x120') && rows[2].includes('240x240') && rows[3].includes('180x180'),
      'visual tank hopper or cockpit scale default missing');
    const ids = ['viewport', 'comparison-options', 'comparison-statistics', 'comparison-explanations', 'comparison-results'];
    for (let i = 1; i < ids.length; i += 1) assert(document.getElementById(ids[i - 1]).compareDocumentPosition(
      document.getElementById(ids[i])) & Node.DOCUMENT_POSITION_FOLLOWING, 'lab section order differs from requested layout');
    choose('friendly');
    document.getElementById('move-right').click(); document.getElementById('comparison-second').click();
    assert(!document.getElementById('comparison-message').textContent.includes('stopped'), 'friendly overlap fixture failed');
    choose('opposing');
    assert(document.getElementById('comparison-states').children.length === 5, 'opposing unit fixture missing');
    choose('flat');
  });
  check('automated unit lookahead at crop boundaries reports blockers instead of querying outside the particle world', () => {
    for (const kind of ['tank', 'hopper']) {
      const world = flat(), unit = vehicle(kind, world, { automated: true });
      unit.input.right = true;
      let sawCropBlocker = false;
      for (let tick = 0; tick < 1000; tick += 1) {
        unit.step();
        const state = unit.inspect();
        if (state.blocker && state.blocker.reason === 'crop edge') sawCropBlocker = true;
      }
      assert(sawCropBlocker && unit.inspect().x < world.width,
        `${kind} escaped or failed to report crop boundary`);
    }
  });
  check('preview Settings contains all simulation options and view zoom leaves ticks and material unchanged', () => {
    const shell = document.querySelector('.lab-preview-shell'), settings = shell.querySelector('.lab-preview-settings');
    const controls = ['comparison-scene', 'tank-size', 'hopper-size', 'jet-size', 'automated', 'move-right', 'boost-hopper',
      'comparison-run', 'comparison-second', 'fire-preview'];
    assert(controls.every((id) => settings.contains(document.getElementById(id))), 'simulation controls are outside the preview Settings panel');
    const canvas = document.getElementById('comparison-canvas'), rect = canvas.getBoundingClientRect();
    const windowBefore = document.getElementById('viewport').getBoundingClientRect();
    const before = document.getElementById('comparison-audit').textContent, zoom = Number(shell.dataset.zoom);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: rect.left + 100, clientY: rect.top + 100,
      cancelable: true, bubbles: true }));
    assert(Number(shell.dataset.zoom) > zoom && document.getElementById('comparison-audit').textContent === before,
      'view zoom failed or advanced/modified simulation');
    const windowAfter = document.getElementById('viewport').getBoundingClientRect();
    assert(windowBefore.width === windowAfter.width && windowBefore.height === windowAfter.height && windowAfter.height === 640,
      'zoom resized the preview window instead of just the scene');
    const reset = [...settings.querySelectorAll('button')].find((button) => button.textContent === 'Reset view');
    reset.click();
    assert(Number(shell.dataset.zoom) <= 1, 'reset view did not fit the enlarged comparison');
  });
  if (!lines.length) lines.push(`FAIL no checks match ${selected}`);
  const results = document.getElementById('comparison-results');
  results.textContent = lines.join('\n'); results.dataset.failed = String(lines.filter((line) => line.startsWith('FAIL')).length);
}());
