// Roster roles: troopers screen infantry (50 DPS), jets hunt (120 DPS), tanks one-shot infantry (100 DPS, slow reload),
// mechs fire heavy missiles plus shrapnel (100 DPS + fragments). Health order trooper < jet < tank < mech.
const PIXEL_LAB_WEAPONS = Object.freeze({
  trooper: Object.freeze({ kind: 'bullet', speed: 240, damage: 15, radius: 1, cooldown: 0.3, health: 100 }),
  // Tank shells are ballistic: gravity plus the barrel's top aim frame bound the reachable range (~v^2 sin 2θmax / g).
  tank: Object.freeze({ kind: 'shell', speed: 185, gravity: 90, damage: 110, radius: 3, cooldown: 1.1, health: 400,
    minimumElevation: -0.15 }),
  hopper: Object.freeze({ kind: 'missile', speed: 180, damage: 80, radius: 4, cooldown: 0.8, health: 600 }),
  jet: Object.freeze({ kind: 'bullet', speed: 320, damage: 18, radius: 1, cooldown: 0.15, health: 150 }),
});

// Armor classes: tanks and mechs are armored. Small-arms rounds only partly penetrate them; shells, missiles and
// mech reactor blasts deal full damage. Unarmored targets (troopers, jets) always take full damage.
const PIXEL_ARMORED_UNITS = Object.freeze(['tank', 'hopper']);
const PIXEL_ARMOR_PENETRATION = Object.freeze({ bullet: 0.25, jetBullet: 0.5, fragment: 0.5, shell: 1, missile: 1 });
function pixelArmorDamage(targetKind, shot) {
  if (!PIXEL_ARMORED_UNITS.includes(targetKind)) return shot.damage;
  const key = shot.kind === 'bullet' && shot.sourceKind === 'jet' ? 'jetBullet' : shot.kind;
  const factor = PIXEL_ARMOR_PENETRATION[key] === undefined ? 1 : PIXEL_ARMOR_PENETRATION[key];
  return Math.max(1, Math.round(shot.damage * factor));
}

// A destroyed mech becomes a blackened wreck whose reactor cracks glow brighter until it detonates. The blast radius
// is the mech's general body size (mean of its collision width and height); damage falls off linearly to the rim.
const PIXEL_MECH_EXPLOSION = Object.freeze({ fuse: 1.5, damage: 220, sparks: 56, flash: 0.35 });

// A passenger riding in a tank can fire a trooper rifle from the top hatch on its own reload.
const PIXEL_LAB_HATCH_WEAPON = Object.freeze({ kind: 'bullet', speed: 240, damage: 15, radius: 1, cooldown: 0.3 });

// Low-arc launch for a gravity projectile from origin to target, or null when the speed cannot reach it.
function solvePixelBallisticArc(origin, target, speed, gravity) {
  const dx = Math.abs(target.x - origin.x), rise = origin.y - target.y;
  if (dx < 1) return null;
  const discriminant = speed ** 4 - gravity * (gravity * dx * dx + 2 * rise * speed * speed);
  if (discriminant < 0) return null;
  const elevation = Math.atan((speed * speed - Math.sqrt(discriminant)) / (gravity * dx));
  const direction = Math.sign(target.x - origin.x);
  const vx = direction * speed * Math.cos(elevation), vy = -speed * Math.sin(elevation);
  return { elevation, direction, vx, vy, duration: dx / Math.abs(vx) };
}

const PIXEL_LAB_INTERCEPTOR_RANGE = 960;
// Interceptor sites also engage hostile jets, but only inside this shorter anti-air radius; missiles always come first.
const PIXEL_LAB_ANTI_AIR_RANGE = 240;

// Interceptors pursue a missile (targetShotId) or a jet (targetUnitId); neither is itself an attack missile.
function isPixelInterceptorShot(shot) {
  return shot.targetShotId !== undefined || shot.targetUnitId !== undefined;
}

function findPixelInterceptorThreat(shots, ownerId, origin) {
  let nearest = null, distance = PIXEL_LAB_INTERCEPTOR_RANGE;
  for (const shot of shots) {
    if (shot.kind !== 'missile' || shot.ownerId === ownerId || isPixelInterceptorShot(shot)) continue;
    const gap = Math.hypot(shot.x - origin.x, shot.y - origin.y);
    if (gap <= distance) { nearest = shot; distance = gap; }
  }
  return nearest;
}

// Nearest hostile live jet inside anti-air range that is not already being chased by one of this owner's interceptors.
function findPixelAntiAirTarget(units, shots, ownerId, origin) {
  const chased = new Set(shots.filter((shot) => shot.ownerId === ownerId && shot.targetUnitId !== undefined)
    .map((shot) => shot.targetUnitId));
  let nearest = null, distance = PIXEL_LAB_ANTI_AIR_RANGE;
  for (const entry of units) {
    if (entry.kind !== 'jet' || entry.owner === ownerId || chased.has(entry.id)) continue;
    const state = entry.unit.inspect({ sprites: false });
    if (state.killed || state.drowned) continue;
    const gap = Math.hypot(state.x + state.width / 2 - origin.x, state.y + state.height / 2 - origin.y);
    if (gap <= distance) { nearest = { entry, point: { x: state.x + state.width / 2, y: state.y + state.height / 2 } }; distance = gap; }
  }
  return nearest;
}

function getPixelUnitAimPoint(canvas, world, event) {
  const bounds = canvas.getBoundingClientRect();
  if (![event.clientX, event.clientY, bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 || bounds.height <= 0) throw new Error('Invalid aim viewport');
  const x = Math.floor((event.clientX - bounds.left) * world.width / bounds.width);
  const y = Math.floor((event.clientY - bounds.top) * world.height / bounds.height);
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) throw new Error('Pointer is outside the lab world');
  return { x, y };
}

function addPixelCombatTargetBuilding(world, left, ground, width = 60, height = 70) {
  if (![left, ground, width, height].every(Number.isInteger) || width < 6 || height < 4 ||
      left < 0 || left + width >= world.width || ground - height < 1 || ground >= world.height) {
    throw new Error('Invalid target building footprint');
  }
  let issued = 0;
  const place = (x, y) => {
    if (world.at(x, y) === PARTICLE_BARRIER) return;
    const emitted = world.emitConstruction(x, y);
    if (!emitted.ok) throw new Error(`Target building emission failed: ${emitted.reason}`);
    const settled = world.settleConstruction(x, y);
    if (!settled.ok) throw new Error(`Target building settling failed: ${settled.reason}`);
    issued += 1;
  };
  for (let y = ground - 1; y >= ground - height; y -= 1) {
    for (const x of [left, left + 1, left + width - 2, left + width - 1]) place(x, y);
  }
  for (let y = ground - height + 1; y >= ground - height; y -= 1) {
    for (let x = left + 2; x < left + width - 2; x += 1) place(x, y);
  }
  return { left, top: ground - height, right: left + width - 1, bottom: ground - 1, issued,
    mode: 'free-lab-target-frame' };
}

function createPixelUnitCombat(world, reference, options = {}) {
  const cellReduction = options.cellReduction === undefined ? 1 : options.cellReduction;
  if (!Number.isInteger(cellReduction) || cellReduction < 1 || cellReduction > 4) {
    throw new Error('Invalid combat projectile cell reduction');
  }
  const buildingLayers = options.buildingLayers;
  if (buildingLayers && typeof buildingLayers.ignores !== 'function') throw new Error('Invalid combat building layers');
  if (!world || typeof world.impact !== 'function' || typeof world.emitDebris !== 'function') {
    throw new Error('Combat requires particle impact and debris physics');
  }
  const artwork = createPixelProjectileArtwork(reference), fighters = new Map(), glyphs = new Map();
  let shots = [], nextId = 1, ticks = 0, damagedStructure = 0, terrainDebris = 0, issuedAmmoDebris = 0, fired = 0, intercepted = 0;
  let scattered = 0, suppressedFragments = 0;
  const impacts = [];
  let trails = [];
  let deathParticles = [], deaths = 0, suppressedDeathParticles = 0;
  const deathEvents = [];
  let wrecks = [], blasts = [], explosions = 0;
  for (const kind of ['bullet', 'shell']) {
    const frames = Array.from({ length: artwork.frameCount }, (_, index) => {
      const pose = artwork.frame(index, 1, 'bullet');
      const pixels = kind === 'shell' ? pose.pixels.flatMap((pixel) =>
        [0, 1].flatMap((dy) => [0, 1].map((dx) =>
          ({ ...pixel, x: pixel.x * 2 + dx, y: pixel.y * 2 + dy })))) : pose.pixels;
      if (!pixels.length) return { pixels: null, durationMs: pose.durationMs };
      const cx = Math.round(pixels.reduce((sum, pixel) => sum + pixel.x, 0) / pixels.length);
      const cy = Math.round(pixels.reduce((sum, pixel) => sum + pixel.y, 0) / pixels.length);
      return { pixels: pixels.map((pixel) => ({ ...pixel, x: pixel.x - cx, y: pixel.y - cy })), durationMs: pose.durationMs };
    });
    const visible = frames.find((frame) => frame.pixels);
    if (!visible) throw new Error('Projectile reference has no visible frames');
    let previous = visible.pixels;
    glyphs.set(kind, frames.map((frame) => { if (frame.pixels) previous = frame.pixels; return { ...frame, pixels: previous }; }));
  }
  const particleColor = glyphs.get('bullet')[0].pixels[0].color;
  const missileBody = [];
  for (let x = -4; x <= 3; x += 1) for (let y = -1; y <= 1; y += 1) {
    missileBody.push({ x, y, color: particleColor });
  }
  missileBody.push({ x: 4, y: 0, color: particleColor }, { x: -4, y: -2, color: particleColor }, { x: -4, y: 2, color: particleColor });
  glyphs.set('missile', [{ durationMs: Infinity, pixels: missileBody }]);
  glyphs.set('fragment', [{ durationMs: Infinity, pixels: [{ x: 0, y: 0, color: particleColor }] }]);
  if (cellReduction > 1) for (const frames of glyphs.values()) for (const frame of frames) {
    const pixels = frame.pixels.map((pixel) => ({ ...pixel,
      x: Math.round(pixel.x / cellReduction), y: Math.round(pixel.y / cellReduction) }));
    frame.pixels = [...new Map(pixels.map((pixel) => [`${pixel.x},${pixel.y}`, pixel])).values()];
  }
  function fighter(id) {
    const entry = fighters.get(id);
    if (!entry) throw new Error(`Unknown firing unit: ${id}`);
    return entry;
  }
  function interceptionPoint(origin, target, speed) {
    let time = Math.min(0.75, Math.hypot(target.x - origin.x, target.y - origin.y) / speed);
    let point = target;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      point = { x: target.x + (target.vx === undefined ? target.dx * target.speed : target.vx) * time,
        y: target.y + (target.vy === undefined ? target.dy * target.speed : target.vy) * time +
          0.5 * (target.gravity || 0) * time * time };
      time = Math.min(0.75, Math.hypot(point.x - origin.x, point.y - origin.y) / speed);
    }
    return point;
  }
  function geometry(shot) {
    const frames = glyphs.get(shot.kind);
    let frame = 0, elapsed = shot.age * 1000;
    while (frame < frames.length - 1 && elapsed >= frames[frame].durationMs) {
      elapsed -= frames[frame].durationMs; frame += 1;
    }
    const pixels = frames[frame].pixels.map((pixel) => ({ ...pixel,
      x: Math.round(pixel.x * shot.dx - pixel.y * shot.dy),
      y: Math.round(pixel.x * shot.dy + pixel.y * shot.dx) }));
    return [...new Map(pixels.map((pixel) => [`${pixel.x},${pixel.y}`, pixel])).values()];
  }
  function missileArc(origin, target, speed, rise) {
    const duration = Math.max(0.35, Math.min(6, Math.hypot(target.x - origin.x, target.y - origin.y) / speed));
    const vx = (target.x - origin.x) / duration, vy = (target.y - origin.y - 4 * rise) / duration;
    const magnitude = Math.hypot(vx, vy);
    return { vx, vy, gravity: 8 * rise / (duration * duration), duration,
      speed: magnitude, dx: vx / magnitude, dy: vy / magnitude, homing: false };
  }
  function clearMissileArc(origin, target, arc) {
    const shot = { kind: 'missile', age: 0, x: origin.x, y: origin.y, dx: arc.dx, dy: arc.dy };
    const targetMaterial = world.at(Math.floor(target.x), Math.floor(target.y));
    const steps = Math.max(1, Math.ceil((Math.abs(target.x - origin.x) +
      Math.abs(target.y - origin.y) + arc.gravity * arc.duration * arc.duration / 4) * 2));
    // Same frame as geometry() at age 0; duplicate offsets cannot change the first hit without occupants.
    const frames = glyphs.get('missile');
    let frame = 0, elapsed = 0;
    while (frame < frames.length - 1 && elapsed >= frames[frame].durationMs) {
      elapsed -= frames[frame].durationMs; frame += 1;
    }
    const source = frames[frame].pixels, rotated = source.map(() => ({ x: 0, y: 0 }));
    for (let step = 0; step <= steps; step += 1) {
      const time = arc.duration * step / steps;
      shot.x = origin.x + arc.vx * time;
      shot.y = origin.y + arc.vy * time + 0.5 * arc.gravity * time * time;
      const vy = arc.vy + arc.gravity * time, heading = Math.atan2(vy, arc.vx);
      shot.dx = Math.cos(heading); shot.dy = Math.sin(heading);
      for (let index = 0; index < source.length; index += 1) {
        const pixel = source[index];
        rotated[index].x = Math.round(pixel.x * shot.dx - pixel.y * shot.dy);
        rotated[index].y = Math.round(pixel.x * shot.dy + pixel.y * shot.dx);
      }
      const hit = hitAt(shot, rotated, []);
      if (!hit) continue;
      return targetMaterial !== PARTICLE_EMPTY && hit.reason === 'material' &&
        hit.material === targetMaterial && Math.hypot(hit.x - target.x, hit.y - target.y) <= 8;
    }
    return true;
  }
  function particlesAt(x, y, radius, emitAmmo = true) {
    const impact = world.impact(x, y, radius);
    damagedStructure += impact.structure; terrainDebris += impact.terrain;
    if (!emitAmmo) return { structure: impact.structure, terrain: impact.terrain, ammo: 0 };
    let fragments = 0;
    for (let ring = 1; ring <= radius + 2 && fragments < 4; ring += 1) {
      for (const [dx, dy] of [[-ring, -ring], [ring, -ring], [-ring, 0], [ring, 0]]) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= world.width || py >= world.height) continue;
        if (world.at(px, py) === PARTICLE_EMPTY) {
          const emitted = world.emitDebris(px, py);
          if (!emitted.ok) throw new Error(`Ammo fragment emission failed: ${emitted.reason}`);
          fragments += 1; issuedAmmoDebris += 1;
          if (fragments === 4) break;
        }
      }
    }
    return { structure: impact.structure, terrain: impact.terrain, ammo: fragments };
  }
  function occupiedCells() {
    const cells = [];
    for (const entry of fighters.values()) {
      const state = entry.unit.inspect();
      if (entry.health === 0 || state.killed || state.drowned) continue;
      const occupied = new Set();
      for (const pixel of state.pixels) {
        occupied.add((state.y + pixel.y) * world.width + state.x + pixel.x);
      }
      cells.push({ entry, state, occupied });
    }
    return cells;
  }
  function burst(entry, count, hitPoint, velocity = { vx: 0, vy: 0 }) {
    const state = entry.unit.inspect(), effect = entry.kind === 'trooper' ? 'red-burst' : 'sparks';
    let emitted = 0;
    for (let index = 0; index < count; index += 1) {
      if (deathParticles.length >= 512) { suppressedDeathParticles += 1; continue; }
      const pixel = state.pixels[Math.floor(index * state.pixels.length / count)];
      const angle = index * Math.PI * 2 / count, speed = 10 + index % 7 * 4;
      deathParticles.push({ x: hitPoint ? hitPoint.x : state.x + pixel.x,
        y: hitPoint ? hitPoint.y : state.y + pixel.y,
        vx: Math.cos(angle) * speed + velocity.vx * 0.35, vy: Math.sin(angle) * speed - 12 + velocity.vy * 0.35,
        age: 0, lifetime: hitPoint ? 0.3 : effect === 'sparks' ? 0.4 + index % 5 * 0.1 : 0.7 + index % 5 * 0.1,
        effect, color: effect === 'sparks' ? ['#fff1aa', '#ffbd55', '#ff743b'][index % 3] :
          ['#f04444', '#bd202c', '#ff6961'][index % 3] });
      emitted += 1;
    }
    return emitted;
  }
  function destroy(entry, reason, velocity) {
    if (entry.deathEmitted) return;
    entry.health = 0; entry.deathEmitted = true; entry.unit.kill(); deaths += 1;
    const mech = entry.kind === 'hopper';
    const emitted = burst(entry, entry.kind === 'trooper' ? 48 : mech ? 16 : 64, null, velocity);
    deathEvents.push({ id: entry.id, kind: entry.kind, tick: ticks, reason,
      effect: entry.kind === 'trooper' ? 'red-burst' : 'sparks', emitted, ...(mech ? { fuse: PIXEL_MECH_EXPLOSION.fuse } : {}) });
    if (deathEvents.length > 32) deathEvents.shift();
    if (mech) {
      const state = entry.unit.inspect({ sprites: false });
      const xs = state.collision.map((pixel) => pixel.x), ys = state.collision.map((pixel) => pixel.y);
      const width = Math.max(...xs) - Math.min(...xs) + 1, height = Math.max(...ys) - Math.min(...ys) + 1;
      wrecks.push({ id: entry.id, ownerId: entry.ownerId, unit: entry.unit, age: 0, fuse: PIXEL_MECH_EXPLOSION.fuse,
        radius: Math.max(2, Math.round((width + height) / 4)), lastTicks: state.ticks, reason });
    }
  }
  function wreckCenter(state) {
    const count = state.collision.length;
    return { x: Math.round(state.x + state.collision.reduce((sum, pixel) => sum + pixel.x, 0) / count),
      y: Math.round(state.y + state.collision.reduce((sum, pixel) => sum + pixel.y, 0) / count) };
  }
  function detonate(wreck) {
    const state = wreck.unit.inspect({ sprites: false }), center = wreckCenter(state);
    center.x = Math.max(0, Math.min(world.width - 1, center.x)); center.y = Math.max(0, Math.min(world.height - 1, center.y));
    explosions += 1;
    const particles = particlesAt(center.x, center.y, wreck.radius, false);
    let damage = 0;
    const casualties = [];
    for (const target of fighters.values()) {
      if (target.health === 0) continue;
      const body = target.unit.inspect({ sprites: false });
      let nearest = Infinity, point = null;
      for (const pixel of body.collision) {
        const x = body.x + pixel.x, y = body.y + pixel.y, distance = Math.hypot(x - center.x, y - center.y);
        if (distance < nearest) { nearest = distance; point = { x, y }; }
      }
      if (nearest > wreck.radius) continue;
      const amount = Math.max(1, Math.round(PIXEL_MECH_EXPLOSION.damage * (1 - nearest / (wreck.radius + 1))));
      const dealt = damageUnit(target, amount, 'mech explosion', point);
      damage += dealt; casualties.push({ id: target.id, damage: dealt });
    }
    let emitted = 0;
    for (let index = 0; index < PIXEL_MECH_EXPLOSION.sparks; index += 1) {
      if (deathParticles.length >= 512) { suppressedDeathParticles += 1; continue; }
      // Drag of 2.5/s means horizontal reach ~ v / 2.5, so the fastest sparks carry out to the blast rim.
      const angle = index * Math.PI * 2 / PIXEL_MECH_EXPLOSION.sparks + (index % 3) * 0.07;
      const speed = wreck.radius * (1.1 + (index % 7) * 0.24);
      deathParticles.push({ x: center.x, y: center.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 10,
        age: 0, lifetime: 0.35 + (index % 5) * 0.08, effect: 'sparks',
        color: ['#ffffff', '#fff1aa', '#ffbd55', '#ff743b'][index % 4] });
      emitted += 1;
    }
    blasts.push({ id: wreck.id, x: center.x, y: center.y, radius: wreck.radius, age: 0, lifetime: PIXEL_MECH_EXPLOSION.flash });
    impacts.push({ shotId: null, tick: ticks, shooterId: wreck.id, ownerId: wreck.ownerId, kind: 'explosion',
      reason: 'mech explosion', x: center.x, y: center.y, radius: wreck.radius, damage, casualties,
      particles, fragments: 0, targetId: null, material: null, health: null, emitted });
    if (impacts.length > 32) impacts.shift();
  }
  // Blackened wreck body plus white light cones bursting outward in every direction. Each cone lengthens and
  // widens through the fuse while its light fades along its length.
  function wreckSprite(wreck) {
    const state = wreck.unit.inspect(), progress = Math.min(1, wreck.age / wreck.fuse);
    const offset = pixelUnitGroundArtworkOffset({ ...state, kind: 'hopper' }), body = [];
    for (const pixel of state.pixels) for (const detail of pixel.details || [{ x: 0, y: 0, size: 1 }]) {
      body.push({ x: state.x + pixel.x + detail.x, y: state.y + pixel.y + detail.y + offset, size: detail.size });
    }
    const center = wreckCenter(state), streaks = [], count = 6 + Math.floor(progress * 6);
    const origin = { x: center.x + 0.5, y: center.y + 0.5 + offset };
    for (let index = 0; index < count; index += 1) {
      const angle = index * Math.PI * 2 / count + Math.sin(index * 2.399 + wreck.age * 1.3) * 0.18;
      const flicker = 0.85 + 0.15 * Math.sin(wreck.age * 40 + index * 1.7);
      const length = wreck.radius * (0.35 + 0.85 * progress) * (0.8 + 0.2 * ((index * 7) % 5) / 4) * flicker;
      streaks.push({ x: origin.x, y: origin.y, angle, length, spread: 0.05 + 0.2 * progress,
        glow: Math.min(1, (0.25 + 0.75 * progress * progress) * flicker) });
    }
    return { body, streaks, heat: progress ** 3 };
  }
  function damageUnit(entry, amount, reason, point) {
    const damage = Math.min(entry.health, amount);
    if (!damage) return 0;
    entry.health -= damage; entry.hitFlash = 0.12;
    const state = point ? null : entry.unit.inspect();
    const pixel = state && state.pixels[Math.floor(state.pixels.length / 2)];
    burst(entry, 12, point || { x: state.x + pixel.x, y: state.y + pixel.y });
    if (entry.health === 0) destroy(entry, reason);
    return damage;
  }
  function hitAt(shot, pixels, occupied) {
    for (const pixel of pixels) {
      const x = Math.round(shot.x) + pixel.x, y = Math.round(shot.y) + pixel.y;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) return { reason: 'crop edge', x, y };
      const material = world.at(x, y);
      const shooter = fighters.get(shot.shooterId);
      const sourceKind = shot.sourceKind || (shooter && shooter.kind);
      const behindFriendlyBuilding = buildingLayers &&
        buildingLayers.ignores(sourceKind, shot.ownerId, x, y, material);
      // Loose rubble never stops a round: shots pass through resting or falling debris to what lies beneath.
      if (material !== PARTICLE_EMPTY && material !== PARTICLE_WATER && material !== PARTICLE_DEBRIS && !behindFriendlyBuilding) {
        return { reason: 'material', material, x, y };
      }
      for (const body of occupied) {
        if (body.entry.health === 0 || body.entry.ownerId === shot.ownerId || x < body.state.x || y < body.state.y ||
            x >= body.state.x + body.state.width || y >= body.state.y + body.state.height) continue;
        if (body.occupied.has(y * world.width + x)) return { reason: 'unit', target: body.entry, x, y };
      }
    }
    return null;
  }
  function aimedShot(entry, target, hatch = null) {
    const state = entry.unit.inspect(), weapon = hatch ? PIXEL_LAB_HATCH_WEAPON : PIXEL_LAB_WEAPONS[entry.kind];
    if (!target || ![target.x, target.y].every(Number.isFinite) || target.x < 0 || target.y < 0 ||
        target.x >= world.width || target.y >= world.height) throw new Error('Aim must be inside the lab world');
    if (hatch) {
      const length = Math.hypot(target.x - hatch.muzzle.x, target.y - hatch.muzzle.y);
      if (length < 1) return null;
      const dx = (target.x - hatch.muzzle.x) / length, dy = (target.y - hatch.muzzle.y) / length;
      return { shooterId: entry.id, ownerId: entry.ownerId, sourceKind: 'trooper', kind: weapon.kind, hatch: true,
        x: hatch.muzzle.x + dx * 2, y: hatch.muzzle.y + dy * 2, dx, dy, age: 0,
        speed: weapon.speed, damage: weapon.damage, radius: Math.max(1, Math.ceil(weapon.radius / cellReduction)) };
    }
    const cx = state.x + state.pixels.reduce((sum, pixel) => sum + pixel.x, 0) / state.pixels.length;
    const cy = state.y + state.pixels.reduce((sum, pixel) => sum + pixel.y, 0) / state.pixels.length;
    const length = Math.hypot(target.x - cx, target.y - cy);
    if (length < 1) return null;
    const dx = (target.x - cx) / length, dy = (target.y - cy) / length;
    const muzzle = Math.max(...state.pixels.map((pixel) =>
      (state.x + pixel.x - cx) * dx + (state.y + pixel.y - cy) * dy)) + 2;
    return { shooterId: entry.id, ownerId: entry.ownerId, sourceKind: entry.kind, kind: weapon.kind,
      x: cx + dx * muzzle, y: cy + dy * muzzle, dx, dy, age: 0,
      speed: weapon.speed, damage: weapon.damage, radius: Math.max(1, Math.ceil(weapon.radius / cellReduction)) };
  }
  const ballistic = (entry) => Boolean(PIXEL_LAB_WEAPONS[entry.kind].gravity) && typeof entry.unit.barrel === 'function' &&
    Boolean(entry.unit.barrel());
  // Turret side, nearest aim frame and exact launch for a tank shell; the muzzle is the tip of that frame's barrel.
  function ballisticAim(entry, target) {
    const weapon = PIXEL_LAB_WEAPONS[entry.kind];
    if (!target || ![target.x, target.y].every(Number.isFinite) || target.x < 0 || target.y < 0 ||
        target.x >= world.width || target.y >= world.height) throw new Error('Aim must be inside the lab world');
    const state = entry.unit.inspect({ sprites: false });
    const direction = Math.sign(target.x - (state.x + state.width / 2)) || state.turret || state.facing;
    let barrel = entry.unit.barrel(direction), solution = null;
    for (let pass = 0; pass < 2; pass += 1) {
      solution = solvePixelBallisticArc(barrel.muzzle, target, weapon.speed, weapon.gravity);
      if (!solution || solution.direction !== direction) break;
      const nearest = barrel.angles.reduce((best, angle, index) =>
        Math.abs(angle - solution.elevation) < Math.abs(barrel.angles[best] - solution.elevation) ? index : best, 0);
      barrel = entry.unit.barrel(direction, nearest);
    }
    const base = { direction, aim: barrel.aim, angles: barrel.angles, muzzle: barrel.muzzle };
    if (!solution || solution.direction !== direction) {
      return { ok: false, reason: solution ? 'target under the barrel' : 'target beyond shell arc range', ...base };
    }
    const maximum = barrel.angles[barrel.angles.length - 1];
    if (solution.elevation > maximum + 1e-6) return { ok: false, reason: 'target beyond shell arc range', ...base,
      elevation: solution.elevation };
    if (solution.elevation < weapon.minimumElevation) return { ok: false, reason: 'target below barrel depression', ...base,
      elevation: solution.elevation };
    if (barrel.muzzle.x < 0 || barrel.muzzle.y < 0 || barrel.muzzle.x >= world.width || barrel.muzzle.y >= world.height) {
      return { ok: false, reason: 'muzzle outside the lab world', ...base };
    }
    return { ok: true, reason: 'ballistic solution', ...base, elevation: solution.elevation,
      vx: solution.vx, vy: solution.vy, duration: solution.duration };
  }
  function shellShot(entry, solution) {
    const weapon = PIXEL_LAB_WEAPONS[entry.kind], speed = Math.hypot(solution.vx, solution.vy);
    return { shooterId: entry.id, ownerId: entry.ownerId, sourceKind: entry.kind, kind: weapon.kind,
      x: solution.muzzle.x, y: solution.muzzle.y, dx: solution.vx / speed, dy: solution.vy / speed, age: 0,
      speed, vx: solution.vx, vy: solution.vy, gravity: weapon.gravity,
      damage: weapon.damage, radius: Math.max(1, Math.ceil(weapon.radius / cellReduction)) };
  }
  const pathAim = (solution) => ({ arc: true, direction: solution.direction, aim: solution.aim, elevation: solution.elevation });
  // Swept test along the shell's actual gravity arc up to the target column.
  function arcPath(entry, target, solution) {
    const shot = shellShot(entry, solution), bodies = occupiedCells(), start = { x: shot.x, y: shot.y };
    const step = 0.5 / shot.speed, limit = Math.min(8, solution.duration + step);
    let previousX = null, previousY = null;
    for (let time = 0; time <= limit; time += step) {
      shot.x = start.x + solution.vx * time;
      shot.y = start.y + solution.vy * time + 0.5 * shot.gravity * time * time;
      const x = Math.round(shot.x), y = Math.round(shot.y);
      if (x === previousX && y === previousY) continue;
      previousX = x; previousY = y;
      const vy = solution.vy + shot.gravity * time, speed = Math.hypot(solution.vx, vy);
      shot.dx = solution.vx / speed; shot.dy = vy / speed;
      const hit = hitAt(shot, geometry(shot), bodies);
      if (hit && hit.reason === 'unit') return { clear: true, reason: 'hostile unit under shell arc', ...pathAim(solution) };
      if (hit && hit.reason === 'material' && Math.hypot(hit.x - target.x, hit.y - target.y) <= shot.radius + 3) {
        return { clear: true, reason: 'shell splash reaches target', ...pathAim(solution) };
      }
      if (hit) return { clear: false, reason: hit.reason === 'material' ?
        ['empty', 'terrain', 'water', 'structure', 'debris', 'construction'][hit.material] : hit.reason,
        x: hit.x, y: hit.y, ...pathAim(solution) };
    }
    return { clear: true, reason: 'clear shell arc', ...pathAim(solution) };
  }
  function straightPath(shot, target) {
    const pixels = geometry(shot), startX = shot.x, startY = shot.y;
    const bodies = occupiedCells();
    const stride = world.width * 2 + 1;
    const occupied = new Set(pixels.map((pixel) => pixel.y * stride + pixel.x)), leadingEdges = [];
    let previousX = null, previousY = null;
    const distance = Math.max(0, (target.x - startX) * shot.dx + (target.y - startY) * shot.dy);
    const steps = Math.ceil(distance * 2);
    for (let step = 0; step <= steps; step += 1) {
      const travel = Math.min(distance, step / 2);
      shot.x = startX + shot.dx * travel; shot.y = startY + shot.dy * travel;
      const x = Math.round(shot.x), y = Math.round(shot.y);
      if (x === previousX && y === previousY) continue;
      let candidates = pixels;
      if (previousX !== null) {
        const dx = x - previousX, dy = y - previousY, key = (dy + 1) * 3 + dx + 1;
        candidates = leadingEdges[key];
        if (!candidates) {
          // Previously covered cells are already clear; only the swept leading edge is new.
          candidates = pixels.filter((pixel) => !occupied.has((pixel.y + dy) * stride + pixel.x + dx));
          leadingEdges[key] = candidates;
        }
      }
      previousX = x; previousY = y;
      const hit = hitAt(shot, candidates, bodies);
      if (hit && hit.reason === 'unit') return { clear: true, reason: 'hostile unit in firing path' };
      if (hit) return { clear: false, reason: hit.reason === 'material' ?
        ['empty', 'terrain', 'water', 'structure', 'debris', 'construction'][hit.material] : hit.reason,
        x: hit.x, y: hit.y };
    }
    return { clear: true, reason: 'clear firing path' };
  }
  return {
    world,
    fallingDebrisDamage(id, amount) {
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid falling debris damage');
      return damageUnit(fighter(id), amount, 'falling debris');
    },
    destroyUnit(id, reason = 'destroyed') { destroy(fighter(id), reason); },
    wreckThreats() {
      return wrecks.map((wreck) => ({ id: wreck.id, center: wreckCenter(wreck.unit.inspect({ sprites: false })),
        radius: wreck.radius, remaining: Math.max(0, wreck.fuse - wreck.age) }));
    },
    crashUnit(id, hit, velocity) {
      const entry = fighter(id);
      if (entry.kind !== 'jet' || !hit || !velocity || ![hit.x, hit.y, velocity.vx, velocity.vy].every(Number.isFinite)) {
        throw new Error('Invalid plane building impact');
      }
      if (entry.deathEmitted) return;
      const particles = particlesAt(hit.x, hit.y, 3, false);
      destroy(entry, 'building crash', velocity);
      impacts.push({ shotId: null, tick: ticks, shooterId: id, ownerId: entry.ownerId, kind: 'crash',
        reason: 'building crash', x: hit.x, y: hit.y, damage: PIXEL_LAB_WEAPONS.jet.health,
        particles, fragments: 0, targetId: id, material: hit.material, health: 0 });
      if (impacts.length > 32) impacts.shift();
    },
    unregister(id) { return fighters.delete(id); },
    firingPath(id, target, options = {}) {
      const entry = fighter(id);
      if (options.weapon === 'hatch') {
        const hatch = typeof entry.unit.hatch === 'function' ? entry.unit.hatch() : null;
        if (!hatch) return { clear: false, reason: 'no hatch gunner aboard' };
        const shot = aimedShot(entry, target, hatch);
        return shot ? straightPath(shot, target) : { clear: false, reason: 'aim overlaps hatch gunner' };
      }
      if (ballistic(entry)) {
        const solution = ballisticAim(entry, target);
        if (!solution.ok) return { clear: false, reason: solution.reason, arc: true, direction: solution.direction,
          aim: solution.aim };
        return arcPath(entry, target, solution);
      }
      const shot = aimedShot(entry, target);
      if (!shot) return { clear: false, reason: 'aim overlaps firing unit center' };
      return straightPath(shot, target);
    },
    ballistics(id, target) {
      const entry = fighter(id);
      if (!ballistic(entry)) throw new Error('Only tank shells use ballistic aiming');
      return ballisticAim(entry, target);
    },
    // Manual labs lay the turret and barrel onto a target immediately; the autonomous AI steps the aim frames instead.
    layGun(id, target) {
      const entry = fighter(id);
      if (!ballistic(entry)) return null;
      const solution = ballisticAim(entry, target);
      entry.unit.setTurret(solution.direction); entry.unit.setAim(solution.aim);
      return solution;
    },
    launch(ownerId, origin, target, options = {}) {
      if (typeof ownerId !== 'string' || !ownerId || !origin || !target ||
          ![origin.x, origin.y, target.x, target.y].every(Number.isFinite) ||
          [origin, target].some((point) => point.x < 0 || point.y < 0 || point.x >= world.width || point.y >= world.height) ||
          options.targetShotId !== undefined && !Number.isInteger(options.targetShotId) ||
          options.targetUnitId !== undefined && (!fighters.has(options.targetUnitId) || options.targetShotId !== undefined) ||
          options.kind !== undefined && !['bullet', 'missile'].includes(options.kind) ||
          options.kind === 'bullet' && (options.targetShotId !== undefined || options.targetUnitId !== undefined)) {
        throw new Error('Invalid lab missile launch');
      }
      if (shots.length >= 128) return { ok: false, reason: '128-shot lab limit reached' };
      const length = Math.hypot(target.x - origin.x, target.y - origin.y);
      if (length < 1) return { ok: false, reason: 'aim overlaps launcher' };
      const kind = options.kind || 'missile';
      const intercept = options.targetShotId !== undefined || options.targetUnitId !== undefined;
      const shot = { id: nextId++, shooterId: options.shooterId || 'launcher', ownerId, kind,
        x: origin.x, y: origin.y, dx: (target.x - origin.x) / length, dy: (target.y - origin.y) / length,
        age: 0, speed: intercept ? 360 : 240,
        damage: kind === 'bullet' ? 12 : 75, radius: kind === 'bullet' ? 1 : Math.ceil(5 / cellReduction),
        homing: kind === 'missile', targetPoint: { ...target }, targetShotId: options.targetShotId,
        ...(options.targetUnitId !== undefined ? { targetUnitId: options.targetUnitId } : {}) };
      // Jet hunters leave the launcher vertically and turn onto the jet in clear sky, rather than flying through their own building.
      if (options.targetUnitId !== undefined) { shot.dx = 0; shot.dy = -1; }
      if (kind === 'missile' && !intercept) {
        const maximumRise = Math.min(origin.y, target.y) < 6 ? 0 :
          (Math.sqrt(origin.y - 6) + Math.sqrt(target.y - 6)) ** 2 / 4;
        const rise = Math.min(Math.max(24, Math.abs(target.x - origin.x) * 0.2), maximumRise);
        let chosen = null;
        for (const height of new Set([rise, rise + 24, rise + 48, rise + 96, rise + 192, maximumRise]
          .map((value) => Math.min(maximumRise, value)))) {
          const arc = missileArc(origin, target, shot.speed, height);
          if (clearMissileArc(origin, target, arc)) { chosen = arc; break; }
        }
        if (!chosen) return { ok: false, reason: 'Missile trajectory blocked: no clear arc within available sky' };
        Object.assign(shot, chosen);
      } else if (options.targetShotId !== undefined) {
        const pursued = shots.find((other) => other.id === options.targetShotId);
        if (pursued) {
          const point = interceptionPoint(origin, pursued, shot.speed);
          const heading = Math.atan2(point.y - origin.y, point.x - origin.x);
          shot.dx = Math.cos(heading); shot.dy = Math.sin(heading);
        }
      }
      shots.push(shot); fired += 1;
      return { ok: true, id: shot.id };
    },
    register(id, unit, kind, ownerId) {
      if (typeof id !== 'string' || !id || fighters.has(id) || !['trooper', 'tank', 'hopper', 'jet'].includes(kind) ||
          typeof ownerId !== 'string' || !ownerId || !unit || typeof unit.inspect !== 'function' ||
          typeof unit.kill !== 'function' || unit.inspect().ownerId !== ownerId) {
        throw new Error('Invalid combat unit registration');
      }

      fighters.set(id, { id, kind, ownerId, unit, health: PIXEL_LAB_WEAPONS[kind].health, reload: 0, hatchReload: 0, hitFlash: 0 });
    },
    fire(id, target, options = {}) {
      const entry = fighter(id), state = entry.unit.inspect(), weapon = PIXEL_LAB_WEAPONS[entry.kind];
      if (options.weapon !== undefined && options.weapon !== 'hatch') throw new Error('Invalid unit weapon selection');
      if (options.weapon === 'hatch') {
        const hatch = typeof entry.unit.hatch === 'function' ? entry.unit.hatch() : null;
        const aimed = hatch ? aimedShot(entry, target, hatch) : null;
        if (entry.health === 0 || state.killed || state.drowned) return { ok: false, reason: 'unit destroyed or drowned' };
        if (!hatch) return { ok: false, reason: 'no hatch gunner aboard' };
        if (entry.hatchReload > 1e-8) return { ok: false, reason: 'hatch gunner reloading' };
        if (shots.length >= 128) return { ok: false, reason: '128-shot lab limit reached' };
        if (!aimed) return { ok: false, reason: 'aim overlaps hatch gunner' };
        const shot = { id: nextId++, ...aimed };
        shots.push(shot); fired += 1; entry.hatchReload = PIXEL_LAB_HATCH_WEAPON.cooldown;
        return { ok: true, id: shot.id, muzzle: { x: shot.x, y: shot.y }, target: { ...target }, kind: shot.kind, weapon: 'hatch' };
      }
      if (ballistic(entry)) {
        const solution = ballisticAim(entry, target);
        if (entry.health === 0 || state.killed || state.drowned) return { ok: false, reason: 'unit destroyed or drowned' };
        if (entry.reload > 1e-8) return { ok: false, reason: 'weapon reloading' };
        if (shots.length >= 128) return { ok: false, reason: '128-shot lab limit reached' };
        if (!solution.ok) return { ok: false, reason: solution.reason };
        if (state.turret !== solution.direction) return { ok: false, reason: 'turret turning toward target' };
        if (state.aim !== solution.aim) return { ok: false, reason: 'barrel elevating to firing angle' };
        const shot = { id: nextId++, ...shellShot(entry, solution) };
        shots.push(shot); fired += 1; entry.reload = weapon.cooldown;
        return { ok: true, id: shot.id, muzzle: { x: shot.x, y: shot.y }, target: { ...target }, kind: shot.kind,
          elevation: solution.elevation, aim: solution.aim };
      }
      const aimed = aimedShot(entry, target);
      if (entry.health === 0 || state.killed || state.drowned) return { ok: false, reason: 'unit destroyed or drowned' };
      if (entry.reload > 1e-8) return { ok: false, reason: 'weapon reloading' };
      if (shots.length >= 128) return { ok: false, reason: '128-shot lab limit reached' };
      if (!aimed) return { ok: false, reason: 'aim overlaps firing unit center' };
      const shot = { id: nextId++, ...aimed };
      shots.push(shot); fired += 1; entry.reload = weapon.cooldown;
      return { ok: true, id: shot.id, muzzle: { x: shot.x, y: shot.y }, target: { ...target }, kind: shot.kind };
    },
    step(dt = 1 / 60) {
      if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new Error('Combat step requires a positive delta of at most 0.1 seconds');
      ticks += 1;
      trails = trails.filter((trail) => {
        trail.age += dt;
        return trail.age < trail.lifetime;
      });
      deathParticles = deathParticles.filter((particle) => {
        particle.age += dt;
        if (particle.age >= particle.lifetime) return false;
        const wet = world.at(Math.floor(particle.x), Math.floor(particle.y)) === PARTICLE_WATER;
        const travelTime = dt * (wet ? 0.5 : 1);
        particle.vx *= Math.exp(-2.5 * travelTime);
        const dx = particle.vx * travelTime;
        const dy = particle.vy * travelTime + 130 * travelTime * travelTime;
        particle.vy += 260 * travelTime;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
        const startX = particle.x, startY = particle.y;
        for (let step = 1; step <= steps; step += 1) {
          const x = startX + dx * step / steps, y = startY + dy * step / steps;
          if (x < 0 || x >= world.width || y < 0 || y >= world.height) return false;
          const material = world.at(Math.floor(x), Math.floor(y));
          if (material !== PARTICLE_EMPTY && material !== PARTICLE_WATER) {
            particle.vx *= 0.4;
            particle.vy = Math.abs(particle.vy) > 14 ? -particle.vy * 0.25 : 0;
            break;
          }
          particle.x = x; particle.y = y;
        }
        return particle.age < particle.lifetime && particle.x >= 0 && particle.x < world.width &&
          particle.y >= 0 && particle.y < world.height;
      });
      blasts = blasts.filter((blast) => (blast.age += dt) < blast.lifetime);
      for (const wreck of [...wrecks]) {
        // Owners usually stop stepping a dead unit; keep the wreck under gravity unless someone else still steps it.
        if (wreck.unit.inspect({ sprites: false }).ticks === wreck.lastTicks) wreck.unit.step(dt);
        wreck.lastTicks = wreck.unit.inspect({ sprites: false }).ticks;
        wreck.age += dt;
        if (wreck.age >= wreck.fuse) { wrecks.splice(wrecks.indexOf(wreck), 1); detonate(wreck); }
      }
      for (const entry of fighters.values()) {
        const state = entry.unit.inspect({ sprites: false });
        if (state.killed || state.drowned) destroy(entry, state.drowned ? 'drowned' : 'destroyed');
      }
      for (const entry of fighters.values()) {
        entry.reload = Math.max(0, entry.reload - dt);
        entry.hatchReload = Math.max(0, entry.hatchReload - dt);
        entry.hitFlash = Math.max(0, entry.hitFlash - dt);
      }
      if (!shots.length) return;
      const occupied = occupiedCells(), remaining = [], destroyed = new Set(), fragments = [];
      for (const shot of shots) {
        if (destroyed.has(shot.id)) continue;
        const startX = shot.x, startY = shot.y;
        shot.age += dt;
        if (shot.age > (shot.kind === 'fragment' ? 0.7 : 8)) continue;
        let pursued = null, hunted = null;
        if (shot.homing) {
          pursued = shot.targetShotId === undefined ? null : shots.find((other) => other.id === shot.targetShotId &&
            other.ownerId !== shot.ownerId && other.kind === 'missile' && !isPixelInterceptorShot(other) && !destroyed.has(other.id));
          if (shot.targetShotId !== undefined && !pursued) continue;
          if (shot.targetUnitId !== undefined) {
            // A jet hunter self-destructs harmlessly once its quarry is gone, like a missile interceptor.
            const quarry = fighters.get(shot.targetUnitId), body = quarry && quarry.health > 0 && quarry.unit.inspect({ sprites: false });
            if (!body || body.killed || body.drowned) continue;
            hunted = { entry: quarry, x: body.x + body.width / 2, y: body.y + body.height / 2,
              reach: Math.max(body.width, body.height) / 2 + 4 };
            shot.targetPoint = interceptionPoint(shot, { x: hunted.x, y: hunted.y,
              vx: body.vx || 0, vy: body.vy || 0 }, shot.speed);
          }
          const target = pursued ? interceptionPoint(shot, pursued, shot.speed) : shot.targetPoint;
          const heading = Math.atan2(shot.dy, shot.dx), desired = Math.atan2(target.y - shot.y, target.x - shot.x);
          const turn = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
          const next = heading + Math.max(-3 * dt, Math.min(3 * dt, turn));
          shot.dx = Math.cos(next); shot.dy = Math.sin(next);
        }
        let pixels = geometry(shot);
        const wet = pixels.some((pixel) => {
          const x = Math.round(shot.x) + pixel.x, y = Math.round(shot.y) + pixel.y;
          return x >= 0 && y >= 0 && x < world.width && y < world.height && world.at(x, y) === PARTICLE_WATER;
        });
        const travelTime = (wet ? 0.5 : 1) * dt;
        let travelX = shot.dx * shot.speed * travelTime, travelY = shot.dy * shot.speed * travelTime;
        if (shot.gravity !== undefined) {
          travelX = shot.vx * travelTime;
          travelY = shot.vy * travelTime + 0.5 * shot.gravity * travelTime * travelTime;
          shot.vy += shot.gravity * travelTime;
          shot.speed = Math.hypot(shot.vx, shot.vy);
          if (shot.speed > 0) { shot.dx = shot.vx / shot.speed; shot.dy = shot.vy / shot.speed; }
          pixels = geometry(shot);
        }
        const steps = Math.max(1, Math.ceil(Math.hypot(travelX, travelY) * 2));
        let hit = null;
        for (let step = 0; step <= steps; step += 1) {
          shot.x = startX + travelX * step / steps;
          shot.y = startY + travelY * step / steps;
          if (pursued && Math.hypot(shot.x - pursued.x, shot.y - pursued.y) <= 9) {
            destroyed.add(pursued.id); intercepted += 1;
            hit = { reason: 'interception', x: Math.round(shot.x), y: Math.round(shot.y) }; break;
          }
          // Proximity fuze: a jet hunter bursts once it is inside the jet's hull envelope (+4 px), not only on a pixel-exact strike.
          if (hunted && Math.hypot(shot.x - hunted.x, shot.y - hunted.y) <= hunted.reach) {
            hit = { reason: 'unit', target: hunted.entry, x: Math.round(shot.x), y: Math.round(shot.y) }; break;
          }
          hit = hitAt(shot, pixels, occupied);
          if (hit) break;
        }
        if (shot.kind !== 'fragment' && Math.hypot(shot.x - startX, shot.y - startY) > 0) {
          trails.push({ shotId: shot.id, kind: shot.kind, ownerId: shot.ownerId,
            x1: startX, y1: startY, x2: shot.x, y2: shot.y, age: 0,
            lifetime: shot.kind === 'missile' ? 1.2 : 0.24 });
          if (trails.length > 4096) trails.shift();
        }
        if (!hit) { remaining.push(shot); continue; }
        let damage = 0;
        if (hit.reason === 'unit') {
          damage = damageUnit(hit.target, pixelArmorDamage(hit.target.kind, shot), 'projectile', hit);
        }
        const particles = hit.reason === 'crop edge' ? { structure: 0, terrain: 0, ammo: 0 } :
          particlesAt(hit.x, hit.y, hit.reason === 'interception' ? 1 : shot.radius,
            shot.kind !== 'missile' && shot.kind !== 'fragment');
        let fragmentCount = 0;
        if (shot.kind === 'missile' && hit.reason !== 'crop edge') {
          for (let index = 0; index < 12; index += 1) {
            if (shots.length + fragments.length >= 128) { suppressedFragments += 1; continue; }
            const angle = index * Math.PI * 2 / 12;
            const rim = hit.reason === 'interception' ? 2 : shot.radius + 1;
            fragments.push({ id: nextId++, shooterId: shot.shooterId, ownerId: shot.ownerId, sourceKind: shot.sourceKind, kind: 'fragment',
              x: hit.x + Math.cos(angle) * rim, y: hit.y + Math.sin(angle) * rim,
              dx: Math.cos(angle), dy: Math.sin(angle), age: 0, speed: 160, damage: 12, radius: 1 });
            fragmentCount += 1; scattered += 1;
          }
        }
        impacts.push({ shotId: shot.id, tick: ticks, shooterId: shot.shooterId, ownerId: shot.ownerId,
          kind: shot.kind, reason: hit.reason, x: hit.x, y: hit.y, damage, particles, fragments: fragmentCount,
          targetId: hit.target ? hit.target.id : null, material: hit.material,
          health: hit.target ? hit.target.health : null });
        if (impacts.length > 32) impacts.shift();
      }
      shots = remaining.filter((shot) => !destroyed.has(shot.id)).concat(fragments);
    },
    health(id) {
      const entry = fighter(id);
      return { health: entry.health, maxHealth: PIXEL_LAB_WEAPONS[entry.kind].health,
        reload: entry.reload, hatchReload: entry.hatchReload, hitFlash: entry.hitFlash };
    },
    inspect(options = {}) {
      return { ticks, fired, intercepted, scattered, suppressedFragments, damagedStructure, terrainDebris, issuedAmmoDebris,
        deaths, suppressedDeathParticles,
        deathParticles: deathParticles.map((particle) => ({ ...particle })),
        deathEvents: deathEvents.map((event) => ({ ...event })),
        explosions,
        wrecks: wrecks.map((wreck) => ({ id: wreck.id, ownerId: wreck.ownerId, age: wreck.age, fuse: wreck.fuse,
          radius: wreck.radius, center: wreckCenter(wreck.unit.inspect({ sprites: false })),
          ...(options.sprites === false ? {} : wreckSprite(wreck)) })),
        blasts: blasts.map((blast) => ({ ...blast })),
        trails: trails.map((trail) => ({ ...trail })),
        impacts: impacts.map((hit) => ({ ...hit, particles: { ...hit.particles } })),
        shots: shots.map((shot) => ({ ...shot, ...(options.sprites === false ? {} :
          { pixels: geometry(shot), collision: [], tintColor: '#e6cd72' }) })),
        units: [...fighters.values()].map((entry) => ({ id: entry.id, ownerId: entry.ownerId, kind: entry.kind,
          health: entry.health, maxHealth: PIXEL_LAB_WEAPONS[entry.kind].health,
          reload: entry.reload, hitFlash: entry.hitFlash })),
        cellReduction, mode: 'lab-only-swept-projectiles', material: false };
    },
  };
}

function drawPixelUnitDeathEffects(ctx, particles, effects = {}) {
  ctx.save();
  for (const wreck of effects.wrecks || []) {
    if (!wreck.body) continue;
    ctx.globalAlpha = 1; ctx.fillStyle = '#060606';
    for (const cell of wreck.body) ctx.fillRect(cell.x, cell.y, cell.size, cell.size);
    if (wreck.heat > 0.02) {
      ctx.globalAlpha = wreck.heat * 0.55; ctx.fillStyle = '#ffffff';
      for (const cell of wreck.body) ctx.fillRect(cell.x, cell.y, cell.size, cell.size);
    }
    for (const streak of wreck.streaks) {
      const reach = Math.max(0.5, streak.length);
      const tip = { x: streak.x + Math.cos(streak.angle) * reach, y: streak.y + Math.sin(streak.angle) * reach };
      const gradient = ctx.createLinearGradient(streak.x, streak.y, tip.x, tip.y);
      gradient.addColorStop(0, `rgba(255,255,255,${streak.glow})`);
      gradient.addColorStop(0.45, `rgba(255,255,255,${streak.glow * 0.45})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.moveTo(streak.x, streak.y);
      ctx.arc(streak.x, streak.y, reach, streak.angle - streak.spread, streak.angle + streak.spread);
      ctx.closePath(); ctx.fill();
    }
  }
  for (const blast of effects.blasts || []) {
    const fade = 1 - blast.age / blast.lifetime, radius = blast.radius * (0.6 + 0.4 * blast.age / blast.lifetime);
    ctx.globalAlpha = fade * 0.85; ctx.fillStyle = '#ffbd55';
    ctx.beginPath(); ctx.arc(blast.x + 0.5, blast.y + 0.5, radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = fade; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(blast.x + 0.5, blast.y + 0.5, radius * 0.55, 0, Math.PI * 2); ctx.fill();
  }
  for (const particle of particles) {
    ctx.globalAlpha = 1 - particle.age / particle.lifetime;
    ctx.fillStyle = particle.color;
    ctx.fillRect(Math.round(particle.x), Math.round(particle.y), 1, 1);
    if (particle.effect === 'sparks') {
      ctx.strokeStyle = particle.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(particle.x - particle.vx * 0.025, particle.y - particle.vy * 0.025); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPixelProjectileTrails(ctx, trails) {
  ctx.save();
  for (const trail of trails) {
    ctx.globalAlpha = 1 - trail.age / trail.lifetime;
    ctx.strokeStyle = trail.kind === 'missile' ? '#f8a66a' : '#e6cd72';
    ctx.lineWidth = trail.kind === 'missile' ? 1.5 : 0.7;
    ctx.beginPath();
    ctx.moveTo(trail.x1, trail.y1);
    ctx.lineTo(trail.x2, trail.y2);
    ctx.stroke();
  }
  ctx.restore();
}
