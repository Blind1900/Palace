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
  function rejects(test) {
    let failed = false;
    try { test(); } catch (error) { failed = true; }
    assert(failed, 'expected invalid operation to fail');
  }

  check('render FPS measures completed draws over elapsed time and resets', () => {
    const meter = createFrameRateMeter(100);
    for (let i = 0; i < 30; i += 1) meter.record();
    assert(meter.sample(600) === 60, 'frame rate did not use elapsed time');
    assert(meter.sample(1600) === 0, 'idle counter did not reach zero');
    meter.record();
    assert(meter.sample(1600) === null, 'zero-duration sample should wait');
    assert(meter.sample(2600) === 1, 'zero-duration sample discarded a draw');
    meter.record();
    meter.reset(3000);
    assert(meter.sample(4000) === 0, 'reset retained stale draws');
  });
  check('lab FPS warns strictly below the forty-frame threshold', () => {
    assert(formatLabFps(39.99).includes('Below 40 FPS') &&
      formatLabFps(0).includes('Below 40 FPS'), 'low FPS did not trigger a review warning');
    assert(!formatLabFps(40).includes('Below 40 FPS') &&
      !formatLabFps(60).includes('Below 40 FPS'), 'FPS at or above forty triggered a warning');
    rejects(() => formatLabFps(NaN));
    rejects(() => formatLabFps(-1));
  });
  check('heightfield import samples cell centers and preserves source terrain', () => {
    const surface = createTerrainSurface(16, 4, (x) => 4 + x / 2);
    const world = createParticleWorldFromSurface(surface,
      { width: 4, height: 5, cellSize: 4, originX: 0, originY: 0 });
    const rows = [1, 2, 2, 3];
    for (let x = 0; x < world.width; x += 1) {
      for (let y = 0; y < world.height; y += 1) {
        assert(world.at(x, y) === (y >= rows[x] ? PARTICLE_TERRAIN : PARTICLE_EMPTY),
          `incorrect imported cell ${x},${y}`);
      }
    }
    assert(surface.revision === 0 && world.waterCount === 0, 'import changed source or created water');
    world.excavate(0, 1, 0, 1);
    assert(surface.heightAt(2) === 5 && surface.revision === 0, 'particle edit changed source');
  });
  check('terrain import handles cropped origins, craters, and clipped heights', () => {
    const surface = createTerrainSurface(24, 4, () => 10);
    const options = { width: 3, height: 4, cellSize: 4, originX: 8, originY: 8 };
    const prior = createParticleWorldFromSurface(surface, options);
    surface.crater(12, 8, 8);
    const world = createParticleWorldFromSurface(surface, options);
    assert(world.at(0, 1) === PARTICLE_EMPTY && world.at(0, 2) === PARTICLE_TERRAIN &&
      world.at(1, 1) === PARTICLE_EMPTY && world.at(1, 2) === PARTICLE_TERRAIN &&
      world.at(2, 0) === PARTICLE_EMPTY && world.at(2, 1) === PARTICLE_TERRAIN,
      'crater or offset import was incorrect');
    assert(prior.at(0, 0) === PARTICLE_TERRAIN && prior.at(1, 0) === PARTICLE_TERRAIN,
      'source changes modified an existing snapshot');
    const above = createParticleWorldFromSurface({ heightAt: () => -100 },
      { width: 1, height: 2, cellSize: 4, originX: 0, originY: 0 });
    const below = createParticleWorldFromSurface({ heightAt: () => 100 },
      { width: 1, height: 2, cellSize: 4, originX: 0, originY: 0 });
    assert(above.terrainCount === 2 && below.terrainCount === 0, 'out-of-window heights were not clipped');
  });
  check('terrain generation fills every underground cell across steep slopes, fractional boundaries and crop seams', () => {
    const surface = createTerrainSurface(1280, 4, (x) =>
      210 + Math.sin(x * 0.017) * 150 + Math.cos(x * 0.11) * 17);
    const options = { width: 160, height: 120, cellSize: 4, originX: 0, originY: 0, skipEmptyChunks: true };
    const whole = createParticleWorldFromSurfaceAndWater(surface, () => 100, { ...options, width: 320 });
    for (const originX of [0, 320, 640]) {
      const crop = createParticleWorldFromSurfaceAndWater(surface, () => 100, { ...options, originX });
      for (let x = 0; x < crop.width; x += 1) {
        const ground = surface.heightAt(originX + (x + 0.5) * 4);
        for (let y = 0; y < crop.height; y += 1) {
          const centerY = (y + 0.5) * 4;
          const expected = centerY >= ground ? PARTICLE_TERRAIN :
            centerY >= 100 ? PARTICLE_WATER : PARTICLE_EMPTY;
          assert(crop.at(x, y) === expected && crop.at(x, y) === whole.at(originX / 4 + x, y),
            `terrain gap, water overwrite or crop seam at ${originX / 4 + x},${y}`);
        }
      }
    }
    for (const height of [1.999999, 2, 2.000001, 5.999999, 6, 6.000001]) {
      const world = createParticleWorldFromSurface({ heightAt: () => height },
        { width: 3, height: 10, cellSize: 4, originX: 0, originY: 0 });
      for (let x = 0; x < 3; x += 1) {
        for (let y = 0; y < 10; y += 1) {
          assert(world.at(x, y) === ((y + 0.5) * 4 >= height ? PARTICLE_TERRAIN : PARTICLE_EMPTY),
            'fractional surface rounding introduced an underground gap');
        }
      }
    }
  });
  check('terrain import rejects invalid and changing surfaces', () => {
    const options = { width: 2, height: 2, cellSize: 4, originX: 0, originY: 0 };
    rejects(() => createParticleWorldFromSurface({ heightAt: () => NaN }, options));
    rejects(() => createParticleWorldFromSurface({ heightAt: () => 1 }, { ...options, cellSize: 0 }));
    rejects(() => createParticleWorldFromSurface({ heightAt: () => 1 }, { ...options, originX: Infinity }));
    rejects(() => createParticleWorldFromSurface({ heightAt: () => 1 }, { ...options, skipEmptyChunks: 'yes' }));
    const changing = { revision: 0, heightAt() { this.revision += 1; return 1; } };
    rejects(() => createParticleWorldFromSurface(changing, options));
  });
  check('surface water import samples wet columns and respects terrain', () => {
    const surface = { revision: 0, heightAt: (x) => x < 8 ? 14 : 6 };
    const sampled = [];
    const world = createParticleWorldFromSurfaceAndWater(surface, (x) => {
      sampled.push(x);
      return x < 4 ? 6 : x < 8 ? null : 2;
    }, { width: 3, height: 5, cellSize: 4, originX: 0, originY: 0 });
    const expected = [
      [PARTICLE_EMPTY, PARTICLE_WATER, PARTICLE_WATER, PARTICLE_TERRAIN, PARTICLE_TERRAIN],
      [PARTICLE_EMPTY, PARTICLE_EMPTY, PARTICLE_EMPTY, PARTICLE_TERRAIN, PARTICLE_TERRAIN],
      [PARTICLE_WATER, PARTICLE_TERRAIN, PARTICLE_TERRAIN, PARTICLE_TERRAIN, PARTICLE_TERRAIN],
    ];
    for (let x = 0; x < 3; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        assert(world.at(x, y) === expected[x][y], `incorrect material at ${x},${y}`);
      }
    }
    assert(sampled.join(',') === '2,6,10' && world.waterCount === 3 && world.terrainCount === 8,
      'water sampler or counts incorrect');
  });
  check('surface water import clips to window and restores deterministically', () => {
    const surface = { heightAt: () => 22 };
    const options = { width: 3, height: 3, cellSize: 4, originX: 8, originY: 10 };
    const world = createParticleWorldFromSurfaceAndWater(surface, (x) => x < 12 ? -100 : x < 16 ? 100 : 16, options);
    assert(world.waterCount === 5 && world.terrainCount === 0, 'water clipping or origin incorrect');
    const restored = createParticleWorld(3, 3, { skipEmptyRows: true });
    restored.restore(JSON.parse(JSON.stringify(world.snapshot())));
    for (let i = 0; i < 30; i += 1) {
      world.step();
      restored.step();
      assert(JSON.stringify(world.snapshot()) === JSON.stringify(restored.snapshot()), 'restored import diverged');
      assert(world.waterCount === 5, 'imported water was lost');
    }
  });
  check('surface water import rejects invalid samplers and changing terrain', () => {
    const options = { width: 2, height: 2, cellSize: 4, originX: 0, originY: 0 };
    const surface = { revision: 0, heightAt: () => 10 };
    rejects(() => createParticleWorldFromSurfaceAndWater(surface, null, options));
    rejects(() => createParticleWorldFromSurfaceAndWater(surface, () => undefined, options));
    rejects(() => createParticleWorldFromSurfaceAndWater(surface, () => Infinity, options));
    rejects(() => createParticleWorldFromSurfaceAndWater(surface, () => { throw new Error('source error'); }, options));
    rejects(() => createParticleWorldFromSurfaceAndWater(surface, () => { surface.revision += 1; return 2; }, options));
  });
  check('tunnel import carves round polyline interiors at cell centers', () => {
    const tunnel = { interiorWidth: 4, points: [{ x: 6, y: 2 }, { x: 6, y: 10 }, { x: 14, y: 10 }] };
    const before = JSON.stringify(tunnel);
    const world = createParticleWorldFromSurfaceWaterAndTunnels({ heightAt: () => 0 }, () => null,
      [tunnel], { width: 5, height: 5, cellSize: 4, originX: 0, originY: 0 });
    const empty = ['1,0', '1,1', '1,2', '2,2', '3,2'];
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        assert(world.at(x, y) === (empty.includes(`${x},${y}`) ? PARTICLE_EMPTY : PARTICLE_TERRAIN),
          `incorrect tunnel cell ${x},${y}`);
      }
    }
    assert(JSON.stringify(tunnel) === before && world.terrainCount === 20, 'source or terrain count changed');
  });
  check('tunnel import handles diagonal, joined, repeated and cropped paths', () => {
    const options = { width: 4, height: 4, cellSize: 4, originX: 8, originY: 8 };
    const tunnels = [
      { interiorWidth: 1, points: [{ x: 6, y: 6 }, { x: 26, y: 26 }] },
      { interiorWidth: 4, points: [{ x: 18, y: 10 }, { x: 18, y: 10 }, { x: 18, y: 18 }] },
      { interiorWidth: 4, points: [{ x: -100, y: -100 }, { x: -90, y: -90 }] },
    ];
    const world = createParticleWorldFromSurfaceWaterAndTunnels({ heightAt: () => 0 }, () => null, tunnels, options);
    const empty = ['0,0', '1,1', '2,2', '3,3', '2,0', '2,1'];
    for (let x = 0; x < 4; x += 1) {
      for (let y = 0; y < 4; y += 1) {
        assert(world.at(x, y) === (empty.includes(`${x},${y}`) ? PARTICLE_EMPTY : PARTICLE_TERRAIN),
          `incorrect diagonal or cropped cell ${x},${y}`);
      }
    }
  });
  check('imported tunnels preserve water and permit flooding after restore', () => {
    const surface = { heightAt: () => 10 };
    const tunnel = { interiorWidth: 4, points: [{ x: 6, y: 6 }, { x: 6, y: 18 }] };
    const world = createParticleWorldFromSurfaceWaterAndTunnels(surface, () => 2, [tunnel],
      { width: 3, height: 6, cellSize: 4, originX: 0, originY: 0 });
    assert(world.waterCount === 6 && world.at(1, 1) === PARTICLE_WATER &&
      world.at(1, 2) === PARTICLE_EMPTY, 'tunnel erased water or did not open shaft');
    const restored = createParticleWorld(3, 6, { skipEmptyRows: true });
    restored.restore(JSON.parse(JSON.stringify(world.snapshot())));
    for (let i = 0; i < 20; i += 1) {
      world.step(); restored.step();
      assert(world.waterCount === 6 && JSON.stringify(world.snapshot()) === JSON.stringify(restored.snapshot()),
        'flooding lost water or restored world diverged');
    }
    assert(world.at(1, 4) === PARTICLE_WATER, 'water did not reach the tunnel');
  });
  check('tunnel import rejects malformed geometry before sampling sources', () => {
    let samples = 0;
    const surface = { heightAt: () => { samples += 1; return 0; } };
    const options = { width: 2, height: 2, cellSize: 4, originX: 0, originY: 0 };
    const run = (tunnels) => createParticleWorldFromSurfaceWaterAndTunnels(surface, () => null, tunnels, options);
    rejects(() => run(null));
    rejects(() => run([{ interiorWidth: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]));
    rejects(() => run([{ interiorWidth: 2, points: [{ x: 0, y: 0 }] }]));
    rejects(() => run([{ interiorWidth: 2, points: [{ x: 0, y: 0 }, { x: NaN, y: 1 }] }]));
    rejects(() => run([{ interiorWidth: 2, points: [{ x: -1e308, y: 0 }, { x: 1e308, y: 0 }] }]));
    assert(samples === 0, 'invalid tunnel was accepted or sampled terrain');
  });
  check('tunnel import snapshots path data before sampling and keeps edge cells', () => {
    const tunnel = { interiorWidth: 8, points: [{ x: 6, y: 6 }, { x: 6, y: 14 }] };
    const world = createParticleWorldFromSurfaceWaterAndTunnels({ heightAt: () => 0 }, () => {
      tunnel.points[0].x = 100;
      tunnel.points[1].x = 100;
      return null;
    }, [tunnel], { width: 4, height: 5, cellSize: 4, originX: 0, originY: 0 });
    assert(world.at(0, 1) === PARTICLE_EMPTY && world.at(2, 1) === PARTICLE_EMPTY &&
      world.at(3, 1) === PARTICLE_TERRAIN, 'path snapshot or inclusive edge was incorrect');
  });
  check('bounded tunnel scans match direct geometry across varied paths', () => {
    let seed = 98423;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const options = { width: 24, height: 19, cellSize: 4, originX: -20, originY: 12 };
    const segments = [
      [{ x: -40, y: -8 }, { x: 100, y: 120 }, 8],
      [{ x: 40, y: 120 }, { x: 40, y: 0 }, 4],
      [{ x: 100, y: 32 }, { x: -50, y: 32 }, 8],
      [{ x: 10, y: 22 }, { x: 10, y: 22 }, 8],
    ];
    for (let i = 0; i < 80; i += 1) {
      segments.push([
        { x: random() * 180 - 60, y: random() * 150 - 20 },
        { x: random() * 180 - 60, y: random() * 150 - 20 },
        1 + random() * 16,
      ]);
    }
    for (const [a, b, width] of segments) {
      const world = createParticleWorldFromSurfaceWaterAndTunnels({ heightAt: () => -1000 }, () => null,
        [{ points: [a, b], interiorWidth: width }], options);
      const dx = b.x - a.x, dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      for (let x = 0; x < options.width; x += 1) {
        for (let y = 0; y < options.height; y += 1) {
          const px = options.originX + (x + 0.5) * options.cellSize;
          const py = options.originY + (y + 0.5) * options.cellSize;
          const t = lengthSquared ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSquared)) : 0;
          const inside = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)) <= width / 2;
          assert(world.at(x, y) === (inside ? PARTICLE_EMPTY : PARTICLE_TERRAIN),
            `geometry mismatch at ${x},${y} for ${JSON.stringify([a, b, width])}`);
        }
      }
    }
  });
  check('imported worlds with optional chunk skipping match through flooding and restore', () => {
    const surface = { heightAt: () => 30 };
    const tunnels = [{ interiorWidth: 6, points: [{ x: 126, y: 22 }, { x: 126, y: 46 }, { x: 150, y: 46 }] }];
    const options = { width: 70, height: 18, cellSize: 4, originX: 0, originY: 0 };
    const waterLevel = (x) => x >= 110 && x <= 146 ? 18 : null;
    const standard = createParticleWorldFromSurfaceWaterAndTunnels(surface, waterLevel, tunnels, options);
    const chunked = createParticleWorldFromSurfaceWaterAndTunnels(surface, waterLevel, tunnels,
      { ...options, skipEmptyChunks: true });
    const initialWater = standard.waterCount;
    assert(initialWater > 0 && JSON.stringify(standard.snapshot()) === JSON.stringify(chunked.snapshot()),
      'initial imports differ');
    let flooded = false;
    for (let i = 0; i < 130; i += 1) {
      if (i === 40) {
        standard.excavate(30, 11, 34, 11);
        chunked.excavate(30, 11, 34, 11);
      }
      if (i === 65) chunked.restore(JSON.parse(JSON.stringify(chunked.snapshot())));
      standard.step(); chunked.step();
      flooded = flooded || standard.at(31, 8) === PARTICLE_WATER;
      assert(standard.waterCount === initialWater && chunked.waterCount === initialWater,
        `water changed at step ${i}`);
      assert(JSON.stringify(standard.snapshot()) === JSON.stringify(chunked.snapshot()),
        `chunked import diverged at step ${i}`);
    }
    assert(flooded, 'imported tunnel did not flood');
  });
  check('terrain-only and water import accept optional chunk skipping', () => {
    const surface = { heightAt: () => 10 };
    const options = { width: 4, height: 5, cellSize: 4, originX: 0, originY: 0 };
    for (const create of [
      (settings) => createParticleWorldFromSurface(surface, settings),
      (settings) => createParticleWorldFromSurfaceAndWater(surface, () => 2, settings),
    ]) {
      const standard = create(options);
      const chunked = create({ ...options, skipEmptyChunks: true });
      for (let i = 0; i < 10; i += 1) {
        standard.step(); chunked.step();
        assert(JSON.stringify(standard.snapshot()) === JSON.stringify(chunked.snapshot()),
          'scan modes produced different imported worlds');
      }
      rejects(() => create({ ...options, skipEmptyChunks: 1 }));
    }
  });
  check('water falls once per step and respects solid cells', () => {
    const world = createParticleWorld(3, 5);
    world.set(1, 0, PARTICLE_WATER);
    world.set(1, 3, PARTICLE_TERRAIN);
    world.step();
    assert(world.at(1, 1) === PARTICLE_WATER, 'water did not fall exactly one cell');
    assert(world.waterCount === 1 && world.terrainCount === 1, 'particle count changed');
    for (let i = 0; i < 10; i += 1) world.step();
    assert(world.at(1, 3) === PARTICLE_TERRAIN, 'water displaced terrain');
    assert(world.countWater(0, 0, 2, 4) === 1, 'water was lost or duplicated');
  });
  check('excavation and blasts do not erase water', () => {
    const world = createParticleWorld(5, 5);
    world.set(2, 2, PARTICLE_WATER);
    world.set(2, 3, PARTICLE_TERRAIN);
    world.set(3, 3, PARTICLE_TERRAIN);
    assert(world.blast(2, 2, 1) === 1, 'blast removed incorrect terrain');
    assert(world.at(2, 2) === PARTICLE_WATER && world.waterCount === 1, 'blast removed water');
    assert(world.excavate(0, 0, 4, 4) === 1 && world.terrainCount === 0, 'excavation removed incorrect terrain');
  });
  check('invalid input cannot silently overwrite particles', () => {
    const world = createParticleWorld(2, 2);
    world.set(0, 0, PARTICLE_WATER);
    rejects(() => world.set(0, 0, PARTICLE_TERRAIN));
    rejects(() => world.set(0, 0, PARTICLE_EMPTY));
    rejects(() => world.at(-1, 0));
    rejects(() => world.excavate(0, 0, 2, 1));
    rejects(() => world.blast(0, 0, 0));
    assert(world.waterCount === 1 && world.at(0, 0) === PARTICLE_WATER, 'invalid input changed world');
  });
  check('basin breach floods the tunnel and conserves water', () => {
    const scenario = createParticleLabScenario();
    const world = scenario.world;
    const initialWater = world.waterCount;
    for (let i = 0; i < 200; i += 1) world.step();
    assert(scenario.tunnelWater() === 0, 'water crossed intact terrain');
    assert(scenario.breach() > 0, 'breach removed no terrain');
    for (let i = 0; i < 1400; i += 1) world.step();
    assert(scenario.tunnelWater() > 0, 'water did not enter tunnel');
    assert(world.waterCount === initialWater, 'water count changed');
    assert(world.countWater(0, 0, world.width - 1, world.height - 1) === initialWater, 'grid and water count disagree');
  });
  check('monitored depth uses tunnel height and the 15% threshold', () => {
    const scenario = createParticleLabScenario();
    const { world, tunnel, monitoredColumn } = scenario;
    assert(scenario.floodDepth() === 0, 'empty column is flooded');
    world.set(monitoredColumn, tunnel.bottom, PARTICLE_WATER);
    assert(scenario.floodDepth() === 1 / 7 && scenario.floodDepth() < 0.15, 'one-cell depth should be usable');
    world.set(monitoredColumn, tunnel.bottom - 1, PARTICLE_WATER);
    assert(scenario.floodDepth() === 2 / 7 && scenario.floodDepth() >= 0.15, 'two-cell depth should be blocked');
  });
  check('extending the tunnel drains the monitored column without losing water', () => {
    const scenario = createParticleLabScenario();
    const { world } = scenario;
    const water = world.waterCount;
    scenario.breach();
    for (let i = 0; i < 700; i += 1) world.step();
    assert(scenario.floodDepth() >= 0.15, 'column did not become blocked');
    const before = scenario.tunnelWater();
    assert(scenario.extend() > 0 && scenario.extended, 'extension was not carved');
    assert(scenario.extend() === 0, 'repeating extension changed terrain');
    for (let i = 0; i < 1800; i += 1) world.step();
    assert(scenario.floodDepth() < 0.15, 'column did not drain below threshold');
    assert(scenario.tunnelWater() < before, 'water did not reach extension');
    assert(world.waterCount === water, 'water counter changed');
    assert(world.countWater(0, 0, world.width - 1, world.height - 1) === water, 'water was lost or duplicated');
  });
  check('barrier blocks flowing water, then blast damage lets it through', () => {
    const scenario = createParticleLabScenario();
    const { world, tunnel, barrierColumn } = scenario;
    const water = world.waterCount;
    const built = scenario.constructBarrier();
    assert(built.ok && built.placed === 7 && world.barrierCount === 7, 'barrier not constructed');
    assert(scenario.constructBarrier().reason === 'complete', 'complete barrier rebuilt');
    scenario.breach();
    for (let i = 0; i < 1000; i += 1) world.step();
    assert(world.countWater(barrierColumn + 1, tunnel.top, tunnel.right, tunnel.bottom) === 0, 'water crossed intact barrier');
    world.blast(barrierColumn, tunnel.bottom - 1, 1);
    assert(world.barrierCount === 4, 'blast did not remove expected barrier particles');
    for (let i = 0; i < 1000; i += 1) world.step();
    assert(world.countWater(barrierColumn + 1, tunnel.top, tunnel.right, tunnel.bottom) > 0, 'water did not pass through damage');
    assert(world.waterCount === water && world.countWater(0, 0, world.width - 1, world.height - 1) === water, 'water lost or duplicated');
  });
  check('repair rejects moving water atomically and resumes on a dry site', () => {
    const scenario = createParticleLabScenario();
    const { world, tunnel, barrierColumn } = scenario;
    assert(scenario.constructBarrier().ok, 'initial barrier construction failed');
    world.blast(barrierColumn, tunnel.bottom - 1, 1);
    const repaired = scenario.constructBarrier();
    assert(repaired.ok && repaired.placed === 3 && world.barrierCount === 7, 'dry barrier damage not repaired');
    world.blast(barrierColumn, tunnel.bottom - 1, 1);
    scenario.breach();
    let ticks = 0;
    while (world.countWater(barrierColumn, tunnel.top, barrierColumn, tunnel.bottom) === 0 && ticks < 1500) {
      world.step();
      ticks += 1;
    }
    assert(ticks < 1500, 'water did not reach damaged barrier');
    const count = world.barrierCount;
    const water = world.waterCount;
    const result = scenario.constructBarrier();
    assert(!result.ok && result.reason === 'water' && result.placed === 0, 'wet repair was not rejected');
    assert(world.barrierCount === count && world.waterCount === water, 'failed repair modified particles');
    assert(world.countWater(0, 0, world.width - 1, world.height - 1) === water, 'repair erased water');
  });
  check('barrier construction rejects damaged support and occupied terrain', () => {
    const scenario = createParticleLabScenario();
    const { world, tunnel, barrierColumn } = scenario;
    world.blast(barrierColumn, tunnel.top - 1, 1);
    const unsupported = scenario.constructBarrier();
    assert(!unsupported.ok && unsupported.reason === 'missing-support' && world.barrierCount === 0, 'damaged roof accepted');
    const other = createParticleLabScenario();
    other.world.set(other.barrierColumn, other.tunnel.top + 2, PARTICLE_TERRAIN);
    const obstructed = other.constructBarrier();
    assert(!obstructed.ok && obstructed.reason === 'terrain' && other.world.barrierCount === 0, 'terrain obstruction accepted');
  });
  check('unsupported barrier becomes falling debris; one anchor remains sufficient', () => {
    const scenario = createParticleLabScenario();
    const { world, barrierColumn, tunnel } = scenario;
    assert(scenario.constructBarrier().ok, 'barrier construction failed');
    world.excavate(barrierColumn, tunnel.top - 1, barrierColumn, tunnel.top - 1);
    world.step();
    assert(world.barrierCount === 7 && world.debrisCount === 0, 'floor-anchored barrier fell');
    scenario.damageBarrierSupports();
    world.step();
    assert(world.barrierCount === 0 && world.debrisCount === 7, 'unsupported barrier did not detach');
    assert(world.at(barrierColumn, tunnel.bottom + 1) === PARTICLE_DEBRIS, 'debris did not fall into damaged floor');
    const unsupported = scenario.constructBarrier();
    assert(!unsupported.ok && unsupported.reason === 'missing-support', 'construction accepted damaged supports');
  });
  check('falling debris displaces water and remains an obstruction', () => {
    const world = createParticleWorld(3, 7);
    world.set(1, 0, PARTICLE_TERRAIN);
    world.set(1, 4, PARTICLE_TERRAIN);
    world.set(1, 5, PARTICLE_TERRAIN);
    world.set(0, 4, PARTICLE_TERRAIN);
    world.set(2, 4, PARTICLE_TERRAIN);
    world.set(0, 5, PARTICLE_TERRAIN);
    world.set(2, 5, PARTICLE_TERRAIN);
    assert(world.constructBarrier(1, 1, 3).ok, 'barrier construction failed');
    world.excavate(1, 0, 1, 0);
    world.excavate(1, 4, 1, 4);
    world.set(1, 4, PARTICLE_WATER);
    world.step();
    assert(world.at(1, 4) === PARTICLE_DEBRIS, 'debris did not fall through water');
    assert(world.at(1, 1) === PARTICLE_WATER, 'water was not displaced upward');
    assert(world.waterCount === 1 && world.countWater(0, 0, 2, 6) === 1, 'water was lost or duplicated');
    assert(world.debrisCount === 3 && world.barrierCount === 0, 'debris count incorrect');
    world.set(1, 0, PARTICLE_TERRAIN);
    world.excavate(1, 4, 1, 4);
    world.set(1, 4, PARTICLE_TERRAIN);
    const result = world.constructBarrier(1, 1, 3);
    assert(!result.ok && result.reason === 'water', 'occupied repair site accepted');
    assert(world.waterCount === 1 && world.debrisCount === 2, 'invalid repair modified particles');
  });
  check('repair refuses debris without partially building', () => {
    const world = createParticleWorld(1, 7);
    world.set(0, 0, PARTICLE_TERRAIN);
    world.set(0, 4, PARTICLE_TERRAIN);
    assert(world.constructBarrier(0, 1, 3).ok, 'barrier construction failed');
    world.excavate(0, 0, 0, 0);
    world.excavate(0, 4, 0, 4);
    world.step();
    world.set(0, 0, PARTICLE_TERRAIN);
    world.set(0, 5, PARTICLE_TERRAIN);
    const result = world.constructBarrier(0, 1, 4);
    assert(!result.ok && result.reason === 'debris' && result.placed === 0, 'debris did not block repair');
    assert(world.barrierCount === 0 && world.debrisCount === 3, 'repair modified particles');
  });
  check('save restores a damaged flooded scenario and its deterministic future', () => {
    const original = createParticleLabScenario();
    assert(original.constructBarrier().ok, 'barrier construction failed');
    original.breach();
    original.extend();
    for (let i = 0; i < 500; i += 1) original.world.step();
    assert(original.tunnelWater() > 0, 'test scenario did not flood');
    original.damageBarrierSupports();
    const saved = JSON.parse(JSON.stringify(original.snapshot()));
    const restored = createParticleLabScenario(saved);
    assert(restored.extended && restored.isPassage(66, 75) && restored.isPassage(180, 110), 'passage flags lost');
    assert(JSON.stringify(restored.snapshot()) === JSON.stringify(saved), 'world state changed during restore');
    for (const [material, count] of [[PARTICLE_TERRAIN, restored.world.terrainCount],
      [PARTICLE_WATER, restored.world.waterCount], [PARTICLE_BARRIER, restored.world.barrierCount],
      [PARTICLE_DEBRIS, restored.world.debrisCount]]) {
      assert(saved.world.cells.filter((cell) => cell === material).length === count, 'restored count disagrees with grid');
    }
    original.world.step();
    restored.world.step();
    assert(restored.world.barrierCount === 0 && restored.world.debrisCount === 7, 'pending support check lost');
    for (let i = 0; i < 300; i += 1) { original.world.step(); restored.world.step(); }
    assert(JSON.stringify(restored.snapshot()) === JSON.stringify(original.snapshot()), 'restored simulation diverged');
    assert(restored.world.waterCount === original.world.waterCount &&
      restored.world.countWater(0, 0, restored.world.width - 1, restored.world.height - 1) === original.world.waterCount,
    'restored water count disagrees with grid');
  });
  check('invalid snapshots are rejected without changing the current world', () => {
    const scenario = createParticleLabScenario();
    const before = JSON.stringify(scenario.snapshot());
    const bad = JSON.parse(before);
    bad.world.cells[100] = 99;
    rejects(() => scenario.world.restore(bad.world));
    assert(JSON.stringify(scenario.snapshot()) === before, 'invalid material changed the world');
    bad.world.cells[100] = PARTICLE_EMPTY;
    bad.world.cells.pop();
    rejects(() => scenario.world.restore(bad.world));
    bad.version = 2;
    rejects(() => createParticleLabScenario(bad));
    rejects(() => createParticleLabScenario(null));
    assert(JSON.stringify(scenario.snapshot()) === before, 'invalid save changed the scenario');
  });
  check('empty-row optimization matches full scan through flooding, debris and restore', () => {
    const scenario = createParticleLabScenario();
    const full = scenario.world;
    const optimized = createParticleWorld(full.width, full.height, { skipEmptyRows: true });
    optimized.restore(full.snapshot());
    function compare() {
      assert(JSON.stringify(full.snapshot()) === JSON.stringify(optimized.snapshot()), 'optimized world diverged');
    }
    for (let i = 0; i < 500; i += 1) {
      if (i === 0) {
        assert(full.constructBarrier(110, 88, 94).ok && optimized.constructBarrier(110, 88, 94).ok, 'barrier failed');
      }
      if (i === 10) {
        full.excavate(64, 65, 68, 87);
        optimized.excavate(64, 65, 68, 87);
      }
      if (i === 80) {
        for (const y of [87, 95]) {
          full.excavate(110, y, 110, y);
          optimized.excavate(110, y, 110, y);
        }
      }
      if (i === 120) {
        full.blast(100, 65, 7);
        optimized.blast(100, 65, 7);
      }
      if (i === 180) optimized.restore(JSON.parse(JSON.stringify(optimized.snapshot())));
      if (i === 240) {
        full.excavate(170, 88, 193, 114);
        optimized.excavate(170, 88, 193, 114);
      }
      full.step();
      optimized.step();
      compare();
    }
    assert(full.debrisCount > 0 && scenario.tunnelWater() > 0, 'test did not exercise debris and flooding');
  });
  check('empty-row optimization tracks water displaced by debris and tick rollover', () => {
    const full = createParticleWorld(3, 7);
    for (const [x, y] of [[1, 0], [1, 4], [1, 5], [0, 4], [2, 4], [0, 5], [2, 5]]) {
      full.set(x, y, PARTICLE_TERRAIN);
    }
    assert(full.constructBarrier(1, 1, 3).ok, 'barrier construction failed');
    full.excavate(1, 0, 1, 0);
    full.excavate(1, 4, 1, 4);
    full.set(1, 4, PARTICLE_WATER);
    const saved = full.snapshot();
    saved.tick = 0xffffffff;
    full.restore(saved);
    const optimized = createParticleWorld(3, 7, { skipEmptyRows: true });
    optimized.restore(saved);
    for (let i = 0; i < 10; i += 1) {
      if (i === 2) {
        full.excavate(1, 4, 1, 4);
        optimized.excavate(1, 4, 1, 4);
      }
      full.step();
      optimized.step();
      if (i === 0) assert(full.at(1, 4) === PARTICLE_DEBRIS && full.at(1, 1) === PARTICLE_WATER, 'debris did not displace water');
      assert(JSON.stringify(full.snapshot()) === JSON.stringify(optimized.snapshot()), 'optimized swap or rollover diverged');
      assert(full.waterCount === optimized.waterCount && full.debrisCount === optimized.debrisCount, 'counts diverged');
    }
  });
  check('chunk skipping matches full scan on varied terrain over 1200 steps', () => {
    for (let shape = 0; shape < 3; shape += 1) {
      const width = 97, height = 64;
      const full = createParticleWorld(width, height);
      for (let x = 0; x < width; x += 1) {
        const surface = shape === 0 ? 23 + Math.floor(x / 12) :
          shape === 1 ? 23 + Math.floor(Math.abs(x - 48) / 8) : 26 + Math.floor((x % 19) / 4);
        for (let y = surface; y < height; y += 1) full.set(x, y, PARTICLE_TERRAIN);
      }
      full.excavate(2, 42, 94, 48);
      for (const x of [30, 64]) assert(full.constructBarrier(x, 42, 48).ok, 'barrier construction failed');
      for (let y = 44; y <= 48; y += 1) {
        for (let x = 4; x <= 16; x += 1) full.set(x, y, PARTICLE_WATER);
      }
      const initialWater = full.waterCount;
      const chunked = createParticleWorld(width, height, { skipEmptyRows: true, skipEmptyChunks: true });
      chunked.restore(full.snapshot());
      let debrisSeen = false;
      for (let step = 0; step < 1200; step += 1) {
        for (const world of [full, chunked]) {
          if (step === 20) world.excavate(30, 41, 30, 41);
          if (step === 40) world.excavate(30, 49, 30, 49);
          if (step === 100) world.blast(64, 45, 2);
          if (step === 200) world.excavate(80, 35, 83, 41);
          if (step === 300) world.blast(0, 27, 4);
          if (step === 500) world.excavate(2, 49, 16, 55);
          world.step();
        }
        if (step === 600) chunked.restore(JSON.parse(JSON.stringify(chunked.snapshot())));
        debrisSeen = debrisSeen || full.debrisCount > 0;
        const expected = full.snapshot();
        const actual = chunked.snapshot();
        assert(JSON.stringify(expected) === JSON.stringify(actual), `shape ${shape}, step ${step}: grid diverged`);
        assert(full.waterCount === initialWater && chunked.waterCount === initialWater, 'water count changed');
        for (const [material, count] of [[PARTICLE_TERRAIN, chunked.terrainCount],
          [PARTICLE_WATER, chunked.waterCount], [PARTICLE_BARRIER, chunked.barrierCount],
          [PARTICLE_DEBRIS, chunked.debrisCount]]) {
          assert(actual.cells.filter((cell) => cell === material).length === count, 'material count disagrees with grid');
        }
      }
      assert(debrisSeen, 'test did not release debris');
      assert(full.countWater(0, 0, width - 1, height - 1) === initialWater, 'water was lost');
    }
  });
  check('chunk skipping handles debris displacing water across a chunk boundary', () => {
    const full = createParticleWorld(65, 7);
    for (const [x, y] of [[31, 2], [31, 4], [31, 5], [30, 5], [33, 5], [31, 6], [32, 6], [33, 6]]) {
      full.set(x, y, PARTICLE_TERRAIN);
    }
    assert(full.constructBarrier(31, 3, 3).ok, 'barrier failed');
    full.excavate(31, 2, 31, 2);
    full.excavate(31, 4, 31, 4);
    full.set(32, 5, PARTICLE_WATER);
    const chunked = createParticleWorld(65, 7, { skipEmptyChunks: true });
    chunked.restore(full.snapshot());
    for (let step = 0; step < 20; step += 1) {
      full.step();
      chunked.step();
      assert(JSON.stringify(full.snapshot()) === JSON.stringify(chunked.snapshot()), `diverged at step ${step}`);
      if (step === 1) {
        assert(full.at(32, 5) === PARTICLE_DEBRIS && full.at(31, 4) === PARTICLE_WATER,
          'debris did not displace water across the boundary');
      }
    }
    assert(full.waterCount === 1 && chunked.waterCount === 1, 'water count changed');
  });
  check('chunk skipping tracks horizontal water across a boundary', () => {
    const full = createParticleWorld(65, 5);
    for (let x = 0; x < full.width; x += 1) full.set(x, 3, PARTICLE_TERRAIN);
    full.set(31, 2, PARTICLE_WATER);
    const chunked = createParticleWorld(65, 5, { skipEmptyChunks: true });
    chunked.restore(full.snapshot());
    for (let step = 0; step < 100; step += 1) {
      full.step();
      chunked.step();
      assert(JSON.stringify(full.snapshot()) === JSON.stringify(chunked.snapshot()), `diverged at step ${step}`);
      if (step === 0) assert(full.at(32, 2) === PARTICLE_WATER, 'water did not cross chunk boundary');
    }
  });
  check('route search respects connectivity, flooding and obstructions without mutation', () => {
    const world = createParticleWorld(9, 8);
    const passage = new Uint8Array(72);
    for (let x = 1; x <= 7; x += 1) {
      for (let y = 2; y <= 6; y += 1) passage[y * 9 + x] = 1;
    }
    const start = { x: 1, y: 3 }, end = { x: 7, y: 3 };
    const before = JSON.stringify(world.snapshot());
    const route = findParticlePassageRoute(world, passage, start, end);
    assert(route.state === 'route found' && route.path.length === 7 &&
      route.path[0].x === 1 && route.path[6].x === 7, 'dry route incorrect');
    assert(JSON.stringify(world.snapshot()) === before, 'route search changed world');
    world.set(4, 6, PARTICLE_WATER);
    assert(findParticlePassageRoute(world, passage, start, end).state === 'no route',
      'flooded cross-section was crossed');
    const dry = createParticleWorld(9, 8);
    dry.set(4, 4, PARTICLE_TERRAIN);
    assert(findParticlePassageRoute(dry, passage, start, end).state === 'no route',
      'obstructed cross-section was crossed');
    assert(findParticlePassageRoute(dry, passage, { x: 4, y: 3 }, end).state === 'blocked endpoint',
      'blocked endpoint accepted');
    const diagonal = new Uint8Array(72);
    diagonal[1 * 9 + 1] = 1; diagonal[2 * 9 + 2] = 1;
    assert(findParticlePassageRoute(createParticleWorld(9, 8), diagonal,
      { x: 1, y: 1 }, { x: 2, y: 2 }).state === 'no route', 'diagonal-only cells connected');
    assert(findParticlePassageRoute(createParticleWorld(9, 8), diagonal,
      { x: 1, y: 1 }, { x: 1, y: 1 }).path.length === 1, 'same-cell route failed');
    rejects(() => findParticlePassageRoute(world, passage, start, { x: 9, y: 0 }));
  });
  check('swept debris box detects tunnel walls, ceiling and floor at speed', () => {
    const world = createParticleWorld(12, 12);
    for (let i = 1; i <= 10; i += 1) {
      world.set(i, 2, PARTICLE_TERRAIN);
      world.set(i, 9, PARTICLE_TERRAIN);
    }
    for (let y = 3; y < 9; y += 1) {
      world.set(1, y, PARTICLE_TERRAIN);
      world.set(10, y, PARTICLE_TERRAIN);
    }
    world.set(6, 5, PARTICLE_WATER);
    const box = { x: 4, y: 4, width: 2, height: 2 };
    const before = JSON.stringify(world.snapshot());
    const right = sweepParticleDebrisBox(world, box, 20, 0);
    const left = sweepParticleDebrisBox(world, box, -20, 0);
    const up = sweepParticleDebrisBox(world, box, 0, -20);
    const down = sweepParticleDebrisBox(world, box, 0, 20);
    assert(right.x === 8 && right.hitX && left.x === 2 && left.hitX, 'wall collision failed');
    assert(up.y === 3 && up.hitY && down.y === 7 && down.hitY, 'ceiling or floor collision failed');
    const diagonal = sweepParticleDebrisBox(world, box, 20, 20);
    assert(diagonal.x === 8 && diagonal.y === 7 && diagonal.hitX && diagonal.hitY, 'corner sweep failed');
    const water = sweepParticleDebrisBox(world, box, 1, 0);
    assert(water.x === 5 && !water.hitX, 'water blocked the box');
    assert(JSON.stringify(world.snapshot()) === before, 'sweep changed world');
    rejects(() => sweepParticleDebrisBox(world, { x: 1, y: 4, width: 2, height: 2 }, 1, 0));
    const empty = createParticleWorld(8, 8);
    empty.set(2, 4, PARTICLE_TERRAIN);
    const fractional = sweepParticleDebrisBox(empty, { x: 3.5, y: 4.25, width: 0.5, height: 0.5 }, -2, 0);
    assert(fractional.x === 3 && fractional.hitX, 'fractional left sweep missed a wall');
    const edge = sweepParticleDebrisBox(empty, { x: 5, y: 1, width: 1, height: 1 }, 9, -9);
    assert(edge.x === 7 && edge.y === 0 && edge.hitX && edge.hitY, 'world edge was not solid');
  });
  check('passage inspection uses the 15 percent depth threshold', () => {
    const world = createParticleWorld(3, 24);
    const passage = new Uint8Array(3 * 24);
    for (let y = 2; y <= 21; y += 1) passage[y * 3 + 1] = 1;
    let result = inspectParticlePassage(world, passage, 1, 10);
    assert(result.top === 2 && result.bottom === 21 && result.depth === 0 && !result.flooded && !result.obstruction,
      'dry passage classification incorrect');
    world.set(1, 19, PARTICLE_WATER);
    result = inspectParticlePassage(world, passage, 1, 10);
    assert(result.depth === 0.15 && result.flooded, '15% threshold not inclusive');
    const dryWorld = createParticleWorld(3, 24);
    dryWorld.set(1, 20, PARTICLE_WATER);
    result = inspectParticlePassage(dryWorld, passage, 1, 10);
    assert(result.depth === 0.1 && !result.flooded, 'sub-threshold water incorrectly blocked');
    assert(inspectParticlePassage(dryWorld, passage, 0, 10) === null, 'non-passage reported as a tunnel');
    dryWorld.set(1, 12, PARTICLE_TERRAIN);
    result = inspectParticlePassage(dryWorld, passage, 1, 10);
    assert(result.obstruction && result.depth === 0.1, 'solid obstruction was not reported');
    rejects(() => inspectParticlePassage(dryWorld, passage, -1, 0));
    rejects(() => inspectParticlePassage(dryWorld, new Uint8Array(1), 1, 10));
  });
  check('passage inspection tracks flooding after snapshot restoration', () => {
    const world = createParticleWorld(3, 8);
    const passage = new Uint8Array(24);
    for (let y = 2; y <= 6; y += 1) passage[y * 3 + 1] = 1;
    world.set(1, 1, PARTICLE_WATER);
    const initial = world.snapshot();
    assert(!inspectParticlePassage(world, passage, 1, 4).flooded, 'water outside tunnel counted');
    world.step();
    assert(inspectParticlePassage(world, passage, 1, 4).flooded, 'entering water did not update inspection');
    world.restore(initial);
    assert(!inspectParticlePassage(world, passage, 1, 4).flooded, 'restored inspection retained water');
  });
  check('imported map uses particle lab colors and outlines around flooded passages', () => {
    const width = 9, height = 10, cellSize = 4;
    const heights = new Array(width).fill(12);
    const world = createParticleWorldFromSurfaceWaterAndTunnels({ heightAt: () => 12 }, () => null,
      [{ interiorWidth: 4, points: [{ x: 10, y: 10 }, { x: 10, y: 22 }, { x: 26, y: 22 }] }],
      { width, height, cellSize, originX: 0, originY: 0 });
    const initial = world.snapshot();
    const mask = createImportedPassageMask(initial.cells, width, height, cellSize, heights);
    const image = { data: new Uint8ClampedArray(width * height * 4) };
    const passageAt = (x, y) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1;
    const color = (x, y) => Array.from(image.data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)).join(',');
    assert(!passageAt(2, 2) && passageAt(2, 3) && passageAt(4, 5), 'import passage mask incorrect');
    world.set(4, 5, PARTICLE_WATER);
    renderParticleCells(world.snapshot().cells, width, height, image, passageAt);
    assert(color(0, 3) === '42,162,71', 'surface is not green');
    assert(color(0, 8) === '2,2,2', 'solid terrain is not black');
    assert(color(4, 5) === '31,172,200', 'water is not cyan');
    assert(color(4, 4) === '215,181,96' && color(4, 6) === '215,181,96',
      'flooded tunnel is not outlined');
    assert(color(2, 6) === '215,181,96', 'shaft bottom rendered as surface');
    world.restore(initial);
    renderParticleCells(world.snapshot().cells, width, height, image, passageAt);
    assert(color(4, 5) === '2,2,2' && color(4, 4) === '215,181,96', 'restore changed passage style');
  });
  check('surface and tunnel outlines follow simulated terrain', () => {
    const scenario = createParticleLabScenario();
    const { world } = scenario;
    const image = { data: new Uint8ClampedArray(world.width * world.height * 4) };
    const color = (x, y) => Array.from(image.data.slice((y * world.width + x) * 4, (y * world.width + x) * 4 + 3)).join(',');
    renderParticleLab(scenario, image);
    assert(color(0, 55) === '42,162,71', 'surface is not green');
    assert(color(5, 80) === '2,2,2', 'solid underground is not black');
    assert(color(100, 87) === '215,181,96' && color(100, 95) === '215,181,96', 'tunnel is not outlined');
    assert(color(66, 70) === '31,172,200', 'water is not visible');
    world.blast(20, 55, 7);
    renderParticleLab(scenario, image);
    assert(color(20, 63) === '42,162,71', 'surface did not follow crater');
    scenario.breach();
    for (let i = 0; i < 1400; i += 1) world.step();
    renderParticleLab(scenario, image);
    assert(color(100, 95) === '215,181,96', 'flooding hid tunnel outline');
    assert(color(66, 95) === '215,181,96', 'shaft bottom rendered as surface');
  });
  check('surface is connected across slopes, water and craters', () => {
    const scenario = createParticleLabScenario();
    const { world } = scenario;
    const image = { data: new Uint8ClampedArray(world.width * world.height * 4) };
    function verify() {
      renderParticleLab(scenario, image);
      const green = (x, y) => {
        const i = (y * world.width + x) * 4;
        return image.data[i] === 42 && image.data[i + 1] === 162 && image.data[i + 2] === 71;
      };
      const queue = [];
      const visited = new Uint8Array(world.width * world.height);
      for (let y = 0; y < world.height; y += 1) {
        if (green(0, y)) { queue.push([0, y]); visited[y * world.width] = 1; }
      }
      for (let i = 0; i < queue.length; i += 1) {
        const [x, y] = queue[i];
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height) continue;
          const index = ny * world.width + nx;
          if (!visited[index] && green(nx, ny)) { visited[index] = 1; queue.push([nx, ny]); }
        }
      }
      for (let x = 0; x < world.width; x += 1) {
        assert(queue.some(([px]) => px === x), `surface disconnected at column ${x}`);
      }
    }
    verify();
    world.blast(100, 65, 7);
    verify();
  });
  const results = document.getElementById('results');
  results.textContent = checks.join('\n');
  results.dataset.failed = String(checks.filter((item) => item.startsWith('FAIL')).length);
}());
