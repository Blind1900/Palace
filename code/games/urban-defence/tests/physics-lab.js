(function () {
  const results = document.getElementById('results');
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
  function close(actual, expected, tolerance = 1e-8) {
    assert(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
  }
  function carve(world, left, top, right, bottom) {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) world.setSolid(x, y, false);
    }
  }
  function advance(world, count) {
    for (let i = 0; i < count; i += 1) world.step();
  }
  check('fixed step is independent of frame partitioning', () => {
    let a = 0;
    let b = 0;
    const first = createFixedStepClock((delta) => { a += delta; });
    const second = createFixedStepClock((delta) => { b += delta; });
    first.advance(0);
    second.advance(0);
    for (let t = 10; t <= 1000; t += 10) first.advance(t);
    for (let t = 50; t <= 1000; t += 50) second.advance(t);
    close(a, 1);
    close(b, 1);
  });
  check('long frames are bounded', () => {
    let elapsed = 0;
    const clock = createFixedStepClock((delta) => { elapsed += delta; });
    clock.advance(0);
    clock.advance(10000);
    close(elapsed, 0.1);
  });
  check('clock exposes interpolation between fixed updates', () => {
    let updates = 0;
    const clock = createFixedStepClock(() => { updates += 1; }, 0.02, 0.1);
    close(clock.advance(0), 0);
    close(clock.advance(10), 0.5);
    assert(updates === 0, 'simulation advanced before a full step');
    close(clock.advance(20), 0);
    assert(updates === 1, 'simulation did not advance after a full step');
  });
  check('water stays contained until a wall is breached', () => {
    const world = createPhysicsTestWorld(12, 8);
    carve(world, 1, 1, 4, 6);
    carve(world, 6, 3, 10, 6);
    world.setWater(4, 6, 1);
    advance(world, 400);
    close(world.waterAt(6, 6), 0);
    world.setSolid(5, 6, false);
    advance(world, 1000);
    assert(world.waterAt(6, 6) > 0.01, 'water did not cross the breach');
    close(world.totalWater(), 1);
  });
  check('gravity moves water down into an opening', () => {
    const world = createPhysicsTestWorld(3, 5);
    carve(world, 1, 0, 1, 4);
    world.setWater(1, 0, 0.75);
    advance(world, 120);
    close(world.waterAt(1, 4), 0.75);
    close(world.totalWater(), 0.75);
  });
  check('water transfer is bounded per step and conserves volume', () => {
    const world = createPhysicsTestWorld(1, 2);
    carve(world, 0, 0, 0, 1);
    world.setWater(0, 0, 1);
    world.step();
    close(world.waterAt(0, 1), 0.12);
    close(world.totalWater(), 1);
    advance(world, 200);
    close(world.waterAt(0, 1), 1);
    close(world.totalWater(), 1);
  });
  check('15% flood threshold and drainage by extending a tunnel', () => {
    const world = createPhysicsTestWorld(22, 6);
    carve(world, 1, 1, 8, 4);
    for (let x = 1; x <= 5; x += 1) world.setWater(x, 4, 1);
    advance(world, 3000);
    assert(world.isTunnelBlocked(4, 1, 4), '15.625% water should block the tunnel');
    const volume = world.totalWater();
    carve(world, 9, 1, 20, 4);
    advance(world, 6000);
    assert(!world.isTunnelBlocked(4, 1, 4), 'extension should drain below 15%');
    close(world.totalWater(), volume);
    world.setWater(1, 4, 0.6);
    assert(world.isTunnelBlocked(1, 1, 4), 'exactly 15% should block the tunnel');
    world.setWater(1, 4, 0.599);
    assert(!world.isTunnelBlocked(1, 1, 4), 'below 15% should remain usable');
  });
  check('solid cells cannot silently remove water', () => {
    const world = createPhysicsTestWorld(1, 1);
    world.setSolid(0, 0, false);
    world.setWater(0, 0, 0.5);
    let rejected = false;
    try { world.setSolid(0, 0, true); } catch (error) { rejected = true; }
    assert(rejected, 'expected a rejection');
    close(world.totalWater(), 0.5);
  });
  check('lab basin floods and its extension drains the tunnel', () => {
    const world = createPhysicsTestWorld(32, 16);
    carve(world, 1, 1, 7, 9);
    carve(world, 12, 10, 19, 13);
    for (let y = 8; y <= 9; y += 1) {
      for (let x = 2; x <= 7; x += 1) world.setWater(x, y, 1);
    }
    const volume = world.totalWater();
    carve(world, 8, 8, 12, 13);
    advance(world, 360);
    assert(world.isTunnelBlocked(16, 10, 13), 'breach did not flood the tunnel');
    advance(world, 840);
    carve(world, 20, 10, 30, 13);
    advance(world, 360);
    assert(!world.isTunnelBlocked(16, 10, 13), 'extension did not drain the tunnel');
    close(world.totalWater(), volume);
  });
  check('particle water falls under gravity and is conserved', () => {
    const water = createWaterLabModel();
    const count = water.particles.length;
    water.breach();
    for (let i = 0; i < 180; i += 1) water.step();
    assert(water.particles.length === count, 'water particles were lost');
    assert(water.particles.some((p) => p.x >= 90 && p.y >= 100), 'water did not fall through the breach');
    assert(water.particles.every((p) => !water.solid[p.y * water.width + p.x]), 'water entered solid terrain');
    assert(new Set(water.particles.map((p) => p.y * water.width + p.x)).size === count, 'particles overlap');
  });
  check('spilling water carries sideways momentum while accelerating downward', () => {
    const water = createWaterLabModel();
    water.breach();
    let particle;
    for (let i = 0; i < 200 && !particle; i += 1) {
      water.step();
      particle = water.particles.find((p) => p.x >= 80 && p.y === 99 && p.vx > 0.5);
    }
    assert(particle, 'no moving particle reached the spillway');
    const start = { x: particle.x, y: particle.y };
    for (let i = 0; i < 4; i += 1) water.step();
    const middle = { x: particle.x, y: particle.y };
    for (let i = 0; i < 8; i += 1) water.step();
    assert(particle.x > start.x + 2, 'spill lost its sideways motion');
    assert((particle.y - middle.y) / 8 > (middle.y - start.y) / 4, 'spill did not accelerate downwards');
  });
  check('particle flood blocks the tunnel and extension drains it', () => {
    const water = createWaterLabModel();
    water.breach();
    for (let i = 0; i < 2200; i += 1) water.step();
    assert(water.floodFraction(16, 10, 13) >= 0.15, 'particle water did not block the tunnel');
    water.extend();
    for (let i = 0; i < 1800; i += 1) water.step();
    assert(water.floodFraction(16, 10, 13) < 0.15, 'particle water did not drain after extension');
  });
  results.textContent = checks.join('\n');
  results.dataset.failed = String(checks.filter((item) => item.startsWith('FAIL')).length);

  const canvas = document.getElementById('lab');
  const ctx = canvas.getContext('2d');
  const fps = createLabFps(document.getElementById('fps'));
  const status = document.getElementById('status');
  const terrain = document.createElement('canvas');
  terrain.width = canvas.width;
  terrain.height = canvas.height;
  const terrainContext = terrain.getContext('2d');
  let world;
  function drawTerrain() {
    terrainContext.clearRect(0, 0, terrain.width, terrain.height);
    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) {
        if (world.solid[y * world.width + x]) {
          terrainContext.fillStyle = (x * 13 + y * 7) % 17 < 3 ? '#3d5535' : '#304629';
          terrainContext.fillRect(x * 2, y * 2, 2, 2);
        }
      }
    }
  }
  function reset() {
    world = createWaterLabModel();
    drawTerrain();
  }
  document.getElementById('breach').addEventListener('click', () => { world.breach(); drawTerrain(); });
  document.getElementById('extend').addEventListener('click', () => { world.extend(); drawTerrain(); });
  document.getElementById('reset').addEventListener('click', reset);
  const waterColors = ['#52b9da', '#65c9e6', '#77d4e9', '#58c0dd', '#89dded'];
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain, 0, 0);
    for (const particle of world.particles) {
      ctx.fillStyle = waterColors[particle.shade];
      ctx.fillRect(particle.x * 2, particle.y * 2, 2, 2);
    }
    const depth = world.floodFraction(16, 10, 13);
    status.textContent = `Tunnel depth: ${(depth * 100).toFixed(1)}% (${depth >= 0.15 ? 'blocked' : 'usable'}). Water particles: ${world.particles.length}.`;
  }
  reset();
  const clock = createFixedStepClock(() => world.step());
  function frame(timestamp) {
    clock.advance(timestamp);
    draw();
    fps.record();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}());
