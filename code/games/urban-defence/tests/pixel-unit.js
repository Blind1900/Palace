(function () {
  const checks = [], selected = new URLSearchParams(location.search).get('check');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  function check(name, run) {
    if (selected && !name.includes(selected)) return;
    try { run(); checks.push(`PASS ${name}`); }
    catch (error) { checks.push(`FAIL ${name}: ${error.message}`); }
  }
  const artwork = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE);
  function worldAt(ground = 80) {
    const world = createParticleWorld(240, 140);
    for (let x = 0; x < world.width; x += 1) for (let y = ground; y < world.height; y += 1) {
      world.set(x, y, PARTICLE_TERRAIN);
    }
    return world;
  }
  const noPenetration = (world, unit) => unit.inspect().collision.every((pixel) =>
    [PARTICLE_EMPTY, PARTICLE_WATER].includes(world.at(unit.inspect().x + pixel.x, unit.inspect().y + pixel.y)));
  check('reference GIF pixel runs, frame order, transparency and exact mirroring are preserved', () => {
    for (const [name, count] of [['walk', 5], ['jump', 3], ['crouch', 4], ['crouchWalk', 4]]) {
      const clip = PIXEL_UNIT_REFERENCE.clips[name];
      assert(clip.sourceWidth === 1024 && clip.sourceHeight === 1024 && clip.pixelScale === 32 &&
        artwork.frameCount(name) === count, 'reference grid/frame count changed');
      for (let index = 0; index < count; index += 1) {
        const expected = clip.frames[index].runs.flatMap(([x, y, length, color]) =>
          Array.from({ length }, (_, dx) => ({ x: x + dx, y, color })));
        const left = artwork.frame(name, index, -1), right = artwork.frame(name, index, 1);
        assert(left.durationMs === 80 && JSON.stringify(left.pixels) === JSON.stringify(expected) &&
          JSON.stringify(right.pixels.map((pixel) => ({ ...pixel, x: 31 - pixel.x }))) === JSON.stringify(expected),
          'frame pixels, palette, opacity or facing changed from source run arrangement');
      }
    }
    assert(artwork.mask('standing', -1).length < 32 * 29 &&
      artwork.mask('crouched', -1).length < artwork.mask('standing', -1).length,
      'collision mask became a filled rectangle instead of an artwork silhouette');
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 560;
    const world = worldAt(), renderer = createPixelConstructionRenderer(canvas, 240, 140);
    const unit = createPixelTerrainUnit(world, artwork, { x: 20, y: 49, facing: -1 });
    const before = JSON.stringify(world.snapshot()), data = unit.inspect();
    renderer.draw({ world, blueprintCells: () => [] }); renderer.markUnit(data);
    const ctx = canvas.getContext('2d'), occupied = new Set(data.pixels.map((pixel) => pixel.y * 32 + pixel.x));
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const pixel = ctx.getImageData((data.x + x) * 4 + 1, (data.y + y) * 4 + 1, 1, 1).data;
      if (occupied.has(y * 32 + x)) assert(pixel[0] === 188 && pixel[1] === 231 && pixel[2] === 123,
        'reference pixel was not rendered at its exact world cell');
      else if (data.y + y < 80) assert(pixel[0] === 2 && pixel[1] === 2 && pixel[2] === 2, 'transparent sprite padding was pasted onto world');
    }
    assert(JSON.stringify(world.snapshot()) === before, 'unit rendering altered world cells');
  });
  check('walking uses fixed-step movement and original eighty-millisecond frame timing', () => {
    const world = worldAt(), unit = createPixelTerrainUnit(world, artwork, { x: 20, y: 49, facing: 1 });
    const before = JSON.stringify(world.snapshot()); unit.input.right = true;
    for (let tick = 0; tick < 4; tick += 1) unit.step();
    assert(unit.inspect().frame === 0, 'walk animation advanced before original GIF frame delay');
    unit.step();
    assert(unit.inspect().frame === 1, 'walk animation missed original GIF frame boundary');
    for (let tick = 5; tick < 60; tick += 1) unit.step();
    assert(unit.inspect().x === 44 && unit.inspect().grounded && noPenetration(world, unit),
      'one second walking did not move exactly 24 clear cells');
    unit.input.right = false; unit.step();
    assert(unit.inspect().frame === 0 && !unit.inspect().moving && JSON.stringify(world.snapshot()) === before,
      'idle advanced animation, moved unit or modified physical mass');
    const simulate = (fps) => {
      const next = createPixelTerrainUnit(world, artwork, { x: 20, y: 49, facing: 1 });
      next.input.right = true;
      const clock = createFixedStepClock(() => next.step());
      for (let index = 0; index <= fps; index += 1) clock.advance(index * 1000 / fps);
      return next.inspect();
    };
    assert(JSON.stringify(simulate(30)) === JSON.stringify(simulate(144)), 'render frame rate changed movement/animation timing');
  });
  check('trooper climbs only small steps and respects cliffs, water and unit-world bounds', () => {
    const world = worldAt();
    for (let x = 65; x < 90; x += 1) for (let y = 78; y < 80; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    for (let x = 100; x < 120; x += 1) for (let y = 60; y < 80; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const unit = createPixelTerrainUnit(world, artwork, { x: 20, y: 49, facing: 1 });
    unit.input.right = true;
    for (let tick = 0; tick < 240; tick += 1) { unit.step(); assert(noPenetration(world, unit), 'step climbing penetrated terrain'); }
    assert(unit.inspect().x > 40 && unit.inspect().x < 100 && unit.inspect().state === 'blocked by terrain',
      'trooper rejected all small steps or scaled a steep cliff');
    const wet = worldAt();
    for (let y = 50; y < 80; y += 1) wet.set(65, y, PARTICLE_WATER);
    const other = createPixelTerrainUnit(wet, artwork, { x: 20, y: 49, facing: 1, automated: true }); other.input.right = true;
    for (let tick = 0; tick < 120; tick += 1) other.step();
    assert(other.inspect().state === 'waiting at water edge' && !other.inspect().water.wet && noPenetration(wet, other), 'automated trooper walked into water');
    const edge = createPixelTerrainUnit(worldAt(), artwork, { x: 0, y: 49, facing: -1 }); edge.input.left = true;
    for (let tick = 0; tick < 120; tick += 1) edge.step();
    assert(edge.inspect().state === 'blocked by crop edge', 'trooper escaped unit world bounds');
  });
  check('jumping sweeps collisions, lands on roofs and falls when real support disappears', () => {
    const world = worldAt(), unit = createPixelTerrainUnit(world, artwork, { x: 20, y: 49, facing: 1 });
    unit.input.jump = true; let top = 49;
    for (let tick = 0; tick < 120; tick += 1) {
      unit.step(); top = Math.min(top, unit.inspect().y); assert(noPenetration(world, unit), 'jump penetrated terrain');
    }
    assert(top < 49 && unit.inspect().y === 49 && unit.inspect().grounded && unit.inspect().animation === 'walk',
      'jump did not rise/land or held jump repeatedly relaunched');
    const ceilingWorld = worldAt(), ceiling = ceilingWorld.snapshot();
    for (let x = 0; x < 80; x += 1) ceiling.cells[43 * 240 + x] = PARTICLE_BARRIER;
    ceilingWorld.restore(ceiling);
    const ceilingUnit = createPixelTerrainUnit(ceilingWorld, artwork, { x: 20, y: 49, facing: 1 });
    ceilingUnit.input.jump = true; let hit = false;
    for (let tick = 0; tick < 120; tick += 1) {
      ceilingUnit.step();
      hit = hit || ceilingUnit.inspect().state === 'blocked by structure';
      assert(noPenetration(ceilingWorld, ceilingUnit), 'jump tunneled through overhead structure');
    }
    assert(hit && ceilingUnit.inspect().grounded, 'jump failed to hit overhead roof and land afterward');
    const roofWorld = worldAt(), snapshot = roofWorld.snapshot();
    for (let x = 10; x < 70; x += 1) snapshot.cells[50 * 240 + x] = PARTICLE_BARRIER;
    roofWorld.restore(snapshot);
    const roofUnit = createPixelTerrainUnit(roofWorld, artwork, { x: 20, y: 19, facing: 1 });
    assert(roofUnit.inspect().grounded, 'unit did not stand on actual barrier roof');
    const removed = roofWorld.snapshot();
    for (let x = 10; x < 70; x += 1) removed.cells[50 * 240 + x] = PARTICLE_EMPTY;
    roofWorld.restore(removed);
    for (let tick = 0; tick < 60; tick += 1) roofUnit.step(0.1);
    assert(roofUnit.inspect().y === 49 && roofUnit.inspect().grounded && noPenetration(roofWorld, roofUnit),
      'fast falling tunneled through terrain or unit remained anchored to vanished roof');
  });
  check('crouch references traverse low tunnels and cannot stand through a ceiling', () => {
    const world = worldAt();
    for (let x = 65; x < 140; x += 1) for (let y = 45; y < 70; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const unit = createPixelTerrainUnit(world, artwork, { x: 20, y: 49, facing: 1 }); unit.input.right = true;
    for (let tick = 0; tick < 60; tick += 1) unit.step();
    assert(unit.inspect().state === 'blocked by terrain', 'standing unit entered low tunnel');
    unit.input.crouch = true;
    for (let tick = 0; tick < 240; tick += 1) { unit.step(); assert(noPenetration(world, unit), 'crouch transition penetrated tunnel'); }
    assert(unit.inspect().x > 60 && unit.inspect().posture === 3 && unit.inspect().animation === 'crouchWalk',
      'trooper did not combine crouch transition and crouch-walking references');
    unit.input.crouch = false; unit.input.right = false;
    for (let tick = 0; tick < 60; tick += 1) unit.step();
    assert(unit.inspect().posture > 0 && unit.inspect().state === 'blocked by terrain' && noPenetration(world, unit),
      'uncrouching pushed opaque pixels through ceiling');
    unit.input.crouch = true; unit.input.right = true;
    for (let tick = 0; tick < 480; tick += 1) unit.step();
    unit.input.crouch = false; unit.input.right = false;
    for (let tick = 0; tick < 60; tick += 1) unit.step();
    assert(unit.inspect().posture === 0 && unit.inspect().grounded, 'unit failed to stand after leaving low tunnel');
  });
  check('physical overlap stops the unit explicitly and inspections never mutate water or material', () => {
    for (const material of [PARTICLE_DEBRIS, PARTICLE_CONSTRUCTION, PARTICLE_BARRIER]) {
      const world = worldAt(), unit = createPixelTerrainUnit(world, artwork, { x: 20, y: 49, facing: 1 });
      const data = unit.inspect(), cell = data.pixels[0], snapshot = world.snapshot();
      snapshot.cells[(data.y + cell.y) * 240 + data.x + cell.x] = material; world.restore(snapshot);
      const before = JSON.stringify(world.snapshot()); unit.input.right = true; unit.step();
      assert(unit.inspect().state.startsWith('overlapped by') && unit.inspect().x === 20 &&
        JSON.stringify(world.snapshot()) === before, 'unit silently displaced overlapping physical material');
      const inspection = unit.inspect(); inspection.pixels[0].x = 100; inspection.collision[0].y = 100;
      assert(unit.inspect().pixels[0].x !== 100 && unit.inspect().collision[0].y !== 100, 'unit inspection exposed live pixel mask');
    }
    let rejected = false;
    try { createPixelTerrainUnit(worldAt(), artwork, { x: 20, y: 80, facing: 1 }); }
    catch (error) { rejected = error.message.includes('spawn blocked'); }
    assert(rejected, 'invalid spawn silently overwrote terrain');
  });
  check('replacement artwork changes dimensions, facing, tint, frame count and collision without movement edits', () => {
    const frame = (x, y, length, color = -16777216) => ({ durationMs: 40, runs: [[x, y, length, color]] });
    const clip = (frames) => ({ width: 12, height: 16, frames });
    const replacement = createPixelUnitArtwork({ version: 1, nativeFacing: 1, tintColor: '#008800', footRow: 12,
      clips: { walk: clip([frame(3, 11, 4), frame(4, 11, 4)]), jump: clip([frame(3, 8, 4), frame(3, 11, 4)]),
        crouch: clip([frame(3, 11, 4), frame(2, 11, 5), frame(1, 11, 6)]),
        crouchWalk: clip([frame(1, 11, 6), frame(2, 11, 6)]), shoot: clip([frame(5, 5, 2, -65536)]) } });
    assert(replacement.width === 12 && replacement.height === 16 && replacement.crouchSteps === 2 &&
      replacement.frameCount('shoot') === 1 &&
      replacement.frame('walk', 0, 1).pixels[0].x === 3 && replacement.frame('walk', 0, -1).pixels[0].x === 8,
      'replacement dimensions, extra clip or native right-facing art were hardcoded');
    const world = worldAt(), unit = createPixelTerrainUnit(world, replacement, { x: 20, y: 68, facing: 1 });
    unit.input.crouch = true;
    for (let tick = 0; tick < 6; tick += 1) unit.step();
    assert(unit.inspect().posture === 2 && unit.inspect().width === 12 && unit.inspect().height === 16 &&
      noPenetration(world, unit), 'replacement crouch frame count/delays or foot anchor were hardcoded');
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 560;
    const renderer = createPixelConstructionRenderer(canvas, 240, 140);
    renderer.draw({ world, blueprintCells: () => [] }); renderer.markUnit(unit.inspect());
    const data = unit.inspect(), pixel = data.pixels[0];
    const color = canvas.getContext('2d').getImageData((data.x + pixel.x) * 4 + 1, (data.y + pixel.y) * 4 + 1, 1, 1).data;
    assert(color[0] === 0 && color[1] === 136 && color[2] === 0, 'replacement tint was not honored');
    const before = JSON.stringify(world.snapshot());
    renderer.markUnit({ ...data, pixels: replacement.frame('shoot', 0, 1).pixels });
    assert(JSON.stringify(world.snapshot()) === before, 'replacement art added physical mass');
    const staticReference = JSON.parse(JSON.stringify(PIXEL_UNIT_REFERENCE));
    staticReference.clips.crouch.frames = [staticReference.clips.crouch.frames[3]];
    staticReference.cellScale = 2;
    const staticArtwork = createPixelUnitArtwork(staticReference), staticWorld = worldAt();
    const staticUnit = createPixelTerrainUnit(staticWorld, staticArtwork, { x: 20, y: 80 - staticArtwork.footRow, facing: 1 });
    staticUnit.input.crouch = true;
    for (let tick = 0; tick < 10; tick += 1) staticUnit.step();
    assert(staticUnit.inspect().posture === 1 && staticUnit.inspect().frame === 0 && noPenetration(staticWorld, staticUnit),
      'single-frame replacement crouch failed to change stance at a resized scale');
    staticUnit.input.crouch = false;
    for (let tick = 0; tick < 10; tick += 1) staticUnit.step();
    assert(staticUnit.inspect().posture === 0 && staticUnit.inspect().grounded, 'single-frame crouch could not return to standing');
  });
  check('unit size scales exact pixels, palette, mirroring, animation and physical clearance together', () => {
    const source = JSON.stringify(PIXEL_UNIT_REFERENCE);
    for (const cellScale of [2, 3, 4]) {
      const scaled = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellScale });
      assert(scaled.width === 32 * cellScale && scaled.height === 32 * cellScale &&
        scaled.footRow === artwork.footRow * cellScale, 'scaled canvas or foot anchor mismatch');
      for (const name of ['walk', 'jump', 'crouch', 'crouchWalk']) {
        assert(scaled.frameCount(name) === artwork.frameCount(name), 'resizing changed animation frame count');
        for (let index = 0; index < artwork.frameCount(name); index += 1) {
          const native = artwork.frame(name, index, -1), large = scaled.frame(name, index, -1);
          const cells = new Map(large.pixels.map((pixel) => [`${pixel.x},${pixel.y}`, pixel.color]));
          assert(large.durationMs === native.durationMs && cells.size === native.pixels.length * cellScale * cellScale,
            'resizing changed timing, opacity or pixel count');
          for (const pixel of native.pixels) for (let dy = 0; dy < cellScale; dy += 1) for (let dx = 0; dx < cellScale; dx += 1) {
            assert(cells.get(`${pixel.x * cellScale + dx},${pixel.y * cellScale + dy}`) === pixel.color,
              'resizing blurred, dropped or recolored a source pixel');
          }
          assert(JSON.stringify(scaled.frame(name, index, 1).pixels.map((pixel) =>
            ({ ...pixel, x: scaled.width - 1 - pixel.x }))) === JSON.stringify(large.pixels), 'resized facing is not an exact mirror');
        }
      }
      const world = worldAt(130), before = JSON.stringify(world.snapshot());
      const unit = createPixelTerrainUnit(world, scaled, { x: 20, y: 130 - scaled.footRow, facing: 1, automated: true });
      assert(unit.inspect().grounded && noPenetration(world, unit), 'scaled unit spawned through terrain or lost foot support');
      unit.input.right = true;
      for (let tick = 0; tick < 10; tick += 1) unit.step();
      assert(unit.inspect().x === 24 && noPenetration(world, unit), 'resizing altered speed or left collision cells behind');
      const next = unit.inspect(), edge = next.collision.reduce((right, pixel) => Math.max(right, pixel.x), 0);
      const obstruction = next.collision.find((pixel) => pixel.x === edge);
      world.set(next.x + edge + 1, next.y + obstruction.y, PARTICLE_WATER);
      for (let tick = 0; tick < 60; tick += 1) unit.step();
      assert(unit.inspect().x === next.x && noPenetration(world, unit) && world.waterCount === 1,
        'scaled collision walked through or displaced water');
      const restored = world.snapshot();
      restored.cells[(next.y + obstruction.y) * world.width + next.x + edge + 1] = PARTICLE_EMPTY;
      world.restore(restored);
      assert(JSON.stringify(world.snapshot()) === before, 'resizing or movement changed physical terrain');
    }
    for (const cellScale of [0, -1, 0.5, 9, NaN, '2', null]) {
      let rejected = false;
      try { createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellScale }); } catch (error) { rejected = error.message.includes('cell scale'); }
      assert(rejected, 'invalid or oversize scale was silently accepted');
    }
    const configured = createPixelUnitArtwork({ ...PIXEL_UNIT_REFERENCE, cellScale: 2 });
    assert(configured.width === 64 && createPixelUnitArtwork({ ...PIXEL_UNIT_REFERENCE, cellScale: 2 }, { cellScale: 1 }).width === 32 &&
      JSON.stringify(PIXEL_UNIT_REFERENCE) === source, 'size defaults/overrides changed source artwork');
  });
  check('unit lab size controls reset safely in every scene and real tunnel clearance matches the preview', () => {
    const scene = document.getElementById('scene'), size = document.getElementById('size'), canvas = document.getElementById('lab');
    const status = () => document.getElementById('status').textContent;
    const choose = (element, value) => { element.value = value; element.dispatchEvent(new Event('change')); };
    const ticks = (count = 60) => document.getElementById(count === 1 ? 'step' : 'step-sixty').click();
    const key = (name, pressed) => canvas.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', { key: name }));
    try {
      for (const scale of ['1', '2', '3', '4']) for (const fixture of ['steps', 'tunnel', 'roof', 'water']) {
        choose(size, scale); choose(scene, fixture);
        assert(status().includes('Tick 0 / world 0: ready') &&
          status().includes(`Size ${scale}x: ${32 * Number(scale)}-by-${32 * Number(scale)} cells`) &&
          status().includes(`${170 * Number(scale) ** 2} rendered pixels`) &&
          status().includes('supported'), 'size control left stale pixels, world state or invalid spawn');
        ticks(1);
        assert(status().includes('Tick 1 / world 1') && !document.getElementById('message').textContent.includes('stopped'),
          'resized scene failed or advanced world more than once');
      }
      choose(size, '1'); choose(scene, 'tunnel');
      key('D', true); key('ArrowRight', true); key('s', true); key('D', false);
      for (let i = 0; i < 6; i += 1) ticks();
      assert(status().includes('crouch walking, (129, 79)'), 'tunnel is solid or releasing one movement alias cleared the other');
      key('ArrowRight', false); key('s', false); ticks();
      assert(status().includes('blocked by terrain, (129, 79)') && status().includes('Reference crouch, frame 4'),
        'unit stood through the actual lab ceiling');
      choose(scene, 'steps');
      key('D', true); canvas.dispatchEvent(new Event('blur')); ticks();
      assert(status().includes('(55, 79)'), 'blur retained held movement input');
      const before = status(), ledger = document.getElementById('accounting').textContent;
      const overlay = document.getElementById('collision'), original = overlay.checked;
      overlay.checked = !original; overlay.dispatchEvent(new Event('change'));
      assert(status() === before && document.getElementById('accounting').textContent === ledger,
        'collision overlay changed unit or world state');
      overlay.checked = original; overlay.dispatchEvent(new Event('change'));
    } finally {
      choose(size, '1'); choose(scene, 'steps');
    }
  });
  check('invalid references and movement inputs report explicit errors without partial world changes', () => {
    const world = worldAt(), before = JSON.stringify(world.snapshot());
    for (const options of [null, { x: 20.5, y: 49 }, { x: 20, y: 49, facing: 0 }]) {
      let rejected = false;
      try { createPixelTerrainUnit(world, artwork, options); } catch (error) { rejected = error.message.includes('Invalid terrain unit'); }
      assert(rejected, 'invalid spawn options were accepted');
    }
    const unit = createPixelTerrainUnit(world, artwork, { x: 20, y: 49, facing: 1 });
    for (const delta of [0, -1, NaN, 0.2]) {
      let rejected = false;
      try { unit.step(delta); } catch (error) { rejected = error.message.includes('Unit step requires'); }
      assert(rejected && unit.inspect().ticks === 0, 'invalid time step changed unit state');
    }
    unit.input.right = 1;
    let invalidInput = false;
    try { unit.step(); } catch (error) { invalidInput = error.message.includes('Invalid unit movement'); }
    assert(invalidInput && unit.inspect().ticks === 0, 'invalid input advanced the unit');
    const bad = JSON.parse(JSON.stringify(PIXEL_UNIT_REFERENCE));
    bad.clips.walk.frames[0].runs.push([...bad.clips.walk.frames[0].runs[0]]);
    let rejectedArt = false;
    try { createPixelUnitArtwork(bad); } catch (error) { rejectedArt = error.message.includes('Overlapping unit pixel runs'); }
    assert(rejectedArt && JSON.stringify(world.snapshot()) === before, 'bad artwork was silently accepted or validation changed physics');
  });
  if (!checks.length) checks.push(`FAIL no checks match ${selected}`);
  const results = document.getElementById('results');
  results.textContent = checks.join('\n'); results.dataset.failed = String(checks.filter((line) => line.startsWith('FAIL')).length);
}());
