// Garrisoned buildings: guard troops man the side windows of a population building and shoot out at
// opposing units. Side windows are load-bearing glass panes that units cannot walk through but gunfire
// passes, so each window is a firing port. Every port is manned by a guard from the same storey: guards
// walk along their floor (straight through the one-way stair flights) to the wall under the window and
// face out. Reserves on that storey take over a port whose guard falls. Enemies advance on foot, hold at
// a standoff range and fire back at manned windows; shots are traced pixel by pixel, so walls, roofs and
// terrain block them and only glass lets them through.
const PIXEL_GARRISON = Object.freeze({
  guardHealth: 4, enemyHealth: 2, guardRange: 170, enemyRange: 150, bulletSpeed: 4,
  guardReload: [34, 56], enemyReload: [70, 110], standoff: [34, 60], spawnEvery: 150, maxEnemies: 4,
  aimSpread: 0.04, enemySpread: 0.1, corpseTicks: 50,
});

// Walks a straight line from `from` to `to` and returns the first blocking pixel (null when clear).
// `transparent` holds the glass keys that gunfire passes through.
function tracePixelShot(world, from, to, transparent) {
  const dx = to.x - from.x, dy = to.y - from.y, steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 1; i <= steps; i += 1) {
    const x = Math.round(from.x + dx * i / steps), y = Math.round(from.y + dy * i / steps);
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return { x, y, reason: 'edge' };
    const material = world.at(x, y);
    if (material === PARTICLE_TERRAIN || (material === PARTICLE_BARRIER && !transparent.has(y * world.width + x))) {
      return { x, y, reason: material === PARTICLE_TERRAIN ? 'terrain' : 'structure' };
    }
  }
  return null;
}

// options: building (from createPixelStyledBuilding with windows), guards (units in unitWorld), art,
// spawn { left, right, groundAt(x) }, seed. Enemies walk in the plain particle world, so closed walls
// and door panes stop them; guards walk in the building's one-way unit world.
function createPixelGarrisonBattle(options) {
  const { building, guards, art } = options;
  if (!building || !building.windows || !Array.isArray(guards) || !art || !options.spawn) {
    throw new Error('Garrison battle requires a windowed building, guards, unit art and spawn edges');
  }
  const { world, unitWorld } = building, W = world.width;
  const glass = new Set(building.windows.side.filter((cell) => cell.part !== 'frame').map((cell) => cell.y * W + cell.x));
  let seed = (options.seed || 1) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const between = ([low, high]) => Math.round(low + random() * (high - low));
  const bounds = building.styled.geometry.bounds;
  const box = (unit) => {
    const state = unit.inspect({ sprites: false }), xs = state.collision.map((p) => p.x), ys = state.collision.map((p) => p.y);
    return { left: state.x + Math.min(...xs), right: state.x + Math.max(...xs), top: state.y + Math.min(...ys),
      bottom: state.y + Math.max(...ys), state };
  };
  const ports = building.windows.ports.map((port) => ({ ...port, guard: null, flash: 0 }));
  const defenders = guards.map((unit) => ({ unit, health: PIXEL_GARRISON.guardHealth, post: null, arrived: false,
    reload: between(PIXEL_GARRISON.guardReload), idle: 0, lastX: null, dead: 0 }));
  const enemies = [], bullets = [], sparks = [];
  const stats = { ticks: 0, shots: 0, enemyShots: 0, hits: 0, kills: 0, guardsLost: 0, blockedAims: 0, spawned: 0 };
  let spawnSide = 1;

  const feetOf = (unit) => box(unit).bottom;
  const onStorey = (defender, port) => {
    const feet = feetOf(defender.unit);
    return feet <= port.floorY - 1 && feet >= port.floorY - 1 - PIXEL_INTERIOR.stepRise - 1;
  };
  function assignPosts() {
    for (const port of ports) {
      if (port.guard && !port.guard.dead) continue;
      port.guard = null;
      let best = null, bestDistance = Infinity;
      for (const defender of defenders) {
        if (defender.dead || defender.post || !onStorey(defender, port)) continue;
        const distance = Math.abs(box(defender.unit).state.x - port.innerX);
        if (distance < bestDistance) { best = defender; bestDistance = distance; }
      }
      if (best) { port.guard = best; best.post = port; best.arrived = false; best.idle = 0; }
    }
  }
  function moveGuard(defender) {
    const { unit, post } = defender;
    unit.input.left = false; unit.input.right = false;
    if (post && !defender.arrived) {
      const b = box(unit), gap = post.outward < 0 ? b.left - post.innerX - 1 : post.innerX - 1 - b.right;
      if (gap <= 0 || defender.idle > 6) defender.arrived = true;
      else { unit.input.left = post.outward < 0; unit.input.right = post.outward > 0; }
    }
    // Anchor below the sole: sideways moves pass through stair flights, but the guard still stands on
    // floors, stairwell pixels and steps, so it walks along its own storey without climbing.
    const state = unit.inspect({ sprites: false });
    unitWorld.anchor(-1, state.y + 1, state.collision);
    unit.step(1 / 60);
    const x = unit.inspect({ sprites: false }).x;
    defender.idle = x === defender.lastX && (unit.input.left || unit.input.right) ? defender.idle + 1 : 0;
    defender.lastX = x;
  }
  function fire(from, target, owner, spread) {
    const angle = Math.atan2(target.y - from.y, target.x - from.x) + (random() - 0.5) * 2 * spread;
    bullets.push({ x: from.x, y: from.y, vx: Math.cos(angle), vy: Math.sin(angle), owner, life: 90 });
  }
  function guardShoots(defender) {
    const port = defender.post;
    if (!port || !defender.arrived || defender.dead) return;
    if (defender.reload > 0) { defender.reload -= 1; return; }
    const guard = box(defender.unit);
    const muzzle = { x: port.outerX + port.outward, y: Math.max(port.top, Math.min(port.bottom, guard.top + 3)) };
    const targets = enemies.filter((enemy) => !enemy.dead).map((enemy) => ({ enemy, b: box(enemy.unit) }))
      .filter(({ b }) => ((b.left + b.right) / 2 - muzzle.x) * port.outward > 0 &&
        Math.abs((b.left + b.right) / 2 - muzzle.x) <= PIXEL_GARRISON.guardRange)
      .sort((a, b) => Math.abs(a.b.left - muzzle.x) - Math.abs(b.b.left - muzzle.x));
    for (const { b } of targets) {
      const aim = { x: (b.left + b.right) / 2, y: b.top + 3 };
      if (tracePixelShot(world, muzzle, aim, glass)) { stats.blockedAims += 1; continue; }
      // Fire from inside the room, so the round visibly leaves through the pane.
      fire({ x: port.innerX - port.outward, y: muzzle.y }, aim, 'guard', PIXEL_GARRISON.aimSpread);
      stats.shots += 1; port.flash = 4; defender.reload = between(PIXEL_GARRISON.guardReload);
      return;
    }
    defender.reload = 6;
  }
  function spawnEnemy() {
    const side = spawnSide; spawnSide = -spawnSide;
    const { left, right, groundAt } = options.spawn;
    const xs = art.mask('standing', -side).map((p) => p.x), bottom = Math.max(...art.mask('standing', -side).map((p) => p.y));
    const x = side < 0 ? left - Math.min(...xs) : right - Math.max(...xs);
    try {
      const unit = createPixelTerrainUnit(world, art, { x, y: groundAt(x + 2) - 1 - bottom, facing: -side });
      enemies.push({ unit, side, health: PIXEL_GARRISON.enemyHealth, standoff: between(PIXEL_GARRISON.standoff),
        reload: between(PIXEL_GARRISON.enemyReload), dead: 0 });
      stats.spawned += 1;
    } catch (error) { /* spawn point occupied */ }
  }
  function stepEnemy(enemy) {
    const { unit } = enemy;
    unit.input.left = false; unit.input.right = false;
    if (enemy.dead) { enemy.dead += 1; unit.step(1 / 60); return; }
    const b = box(unit), wall = enemy.side < 0 ? bounds.left - b.right : b.left - bounds.right;
    const manned = ports.filter((port) => port.guard && !port.guard.dead && port.outward === enemy.side);
    const aims = manned.map((port) => ({ x: port.innerX - port.outward * 2, y: Math.round((port.top + port.bottom) / 2), port }));
    const muzzle = { x: enemy.side < 0 ? b.right + 1 : b.left - 1, y: b.top + 3 };
    const clear = aims.filter((aim) => Math.hypot(aim.x - muzzle.x, aim.y - muzzle.y) <= PIXEL_GARRISON.enemyRange &&
      !tracePixelShot(world, muzzle, { x: aim.port.outerX + aim.port.outward, y: aim.y }, glass));
    if (wall > enemy.standoff || (!clear.length && wall > 4)) { unit.input.left = enemy.side > 0; unit.input.right = enemy.side < 0; }
    if (clear.length) {
      if (enemy.reload > 0) enemy.reload -= 1;
      else {
        const aim = clear[Math.floor(random() * clear.length)];
        fire(muzzle, aim, 'enemy', PIXEL_GARRISON.enemySpread);
        stats.enemyShots += 1; enemy.reload = between(PIXEL_GARRISON.enemyReload);
      }
    }
    unit.step(1 / 60);
  }
  function stepBullets() {
    const enemyBoxes = enemies.filter((enemy) => !enemy.dead).map((enemy) => ({ target: enemy, b: box(enemy.unit) }));
    const guardBoxes = defenders.filter((defender) => !defender.dead).map((defender) => ({ target: defender, b: box(defender.unit) }));
    for (const bullet of bullets) {
      for (let s = 0; s < PIXEL_GARRISON.bulletSpeed && bullet.life > 0; s += 1) {
        bullet.x += bullet.vx; bullet.y += bullet.vy;
        const x = Math.round(bullet.x), y = Math.round(bullet.y);
        if (x < 0 || y < 0 || x >= W || y >= world.height) { bullet.life = 0; break; }
        const material = world.at(x, y);
        if (material === PARTICLE_TERRAIN || (material === PARTICLE_BARRIER && !glass.has(y * W + x))) {
          sparks.push({ x, y, age: 0, kind: 'ricochet' }); bullet.life = 0; break;
        }
        const pool = bullet.owner === 'guard' ? enemyBoxes : guardBoxes;
        const hit = pool.find(({ target, b }) => !target.dead && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
        if (hit) {
          bullet.life = 0; sparks.push({ x, y, age: 0, kind: 'hit' });
          hit.target.health -= 1;
          if (bullet.owner === 'guard') stats.hits += 1;
          if (hit.target.health <= 0) {
            hit.target.dead = 1; hit.target.unit.kill();
            if (bullet.owner === 'guard') stats.kills += 1;
            else { stats.guardsLost += 1; if (hit.target.post) { hit.target.post.guard = null; hit.target.post = null; } }
          }
        }
      }
      bullet.life -= 1;
    }
    for (let i = bullets.length - 1; i >= 0; i -= 1) if (bullets[i].life <= 0) bullets.splice(i, 1);
  }

  return {
    ports, defenders, enemies, bullets, sparks, stats, glass,
    step() {
      stats.ticks += 1;
      assignPosts();
      const alive = enemies.filter((enemy) => !enemy.dead).length;
      if (stats.ticks % PIXEL_GARRISON.spawnEvery === 1 && alive < PIXEL_GARRISON.maxEnemies) spawnEnemy();
      for (const defender of defenders) if (!defender.dead) { moveGuard(defender); guardShoots(defender); }
      for (const enemy of enemies) stepEnemy(enemy);
      stepBullets();
      for (const port of ports) if (port.flash > 0) port.flash -= 1;
      for (const spark of sparks) spark.age += 1;
      for (let i = sparks.length - 1; i >= 0; i -= 1) if (sparks[i].age > 6) sparks.splice(i, 1);
      for (let i = enemies.length - 1; i >= 0; i -= 1) if (enemies[i].dead > PIXEL_GARRISON.corpseTicks) enemies.splice(i, 1);
      for (let i = defenders.length - 1; i >= 0; i -= 1) {
        if (defenders[i].dead) defenders[i].dead += 1;
        if (defenders[i].dead > PIXEL_GARRISON.corpseTicks) defenders.splice(i, 1);
      }
    },
    manned() { return ports.filter((port) => port.guard && port.guard.arrived && !port.guard.dead).length; },
  };
}
