function createPixelCombatRoads(world, segments) {
  const cells = [], lookup = new Map();
  for (const segment of segments) for (let x = segment.left; x <= segment.right; x += 1) {
    const y = segment.surfaceRows ? segment.surfaceRows[x] : segment.y;
    if (world.at(x, y) !== PARTICLE_TERRAIN || world.at(x, y - 1) !== PARTICLE_EMPTY) continue;
    const cell = { x, y, owner: segment.owner };
    cells.push(cell); lookup.set(y * world.width + x, cell);
  }
  return {
    cells,
    multiplier(state) {
      if (!state.grounded || state.vy < 0 || state.kind === 'jet' || state.water.wet || state.killed || state.drowned) return 1;
      const y = state.y + state.footRow;
      if (y < 1 || y >= world.height || state.x < 0 || state.x + state.width > world.width) return 1;
      for (let x = state.x; x < state.x + state.width; x += 1) {
        const road = lookup.get(y * world.width + x);
        if (!road || road.owner !== state.ownerId || world.at(x, y) !== PARTICLE_TERRAIN ||
            world.at(x, y - 1) !== PARTICLE_EMPTY) return 1;
      }
      return 1.25;
    },
  };
}

function getPixelCombatBounds(state) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const pixel of state.collision) {
    left = Math.min(left, state.x + pixel.x); right = Math.max(right, state.x + pixel.x);
    top = Math.min(top, state.y + pixel.y); bottom = Math.max(bottom, state.y + pixel.y);
  }
  return { left, right, top, bottom, x: (left + right) / 2, y: (top + bottom) / 2 };
}

function getPixelHopperStrategy(state, target, memory, ticks, shots, path, aggressive = false, advanceDirection) {
  if (advanceDirection !== undefined && ![-1, 0, 1].includes(advanceDirection)) throw new Error('Invalid hopper assault direction');
  if (!target) {
    memory.phase = 'seek'; memory.targetId = null; memory.lastShot = 0; memory.lastAttack = ticks;
    return { direction: advanceDirection === undefined ? state.facing : advanceDirection,
      jump: false, fire: false, acceptRisk: aggressive, reason: 'advancing toward enemy base' };
  }
  if (memory.targetId !== target.id) {
    memory.targetId = target.id;
    if (memory.phase !== 'commit') { memory.phase = 'seek'; memory.until = 0; }
    memory.cooldown = ticks; memory.lastShot = Math.max(0, ...shots.map((shot) => shot.id));
  }
  const body = getPixelCombatBounds(state), opponent = getPixelCombatBounds(target.state);
  const toward = Math.sign(opponent.x - body.x) || state.facing, distance = Math.abs(opponent.x - body.x);
  if (aggressive) {
    memory.phase = 'assault';
    const reach = (body.right - body.left + opponent.right - opponent.left) / 2 + 12;
    const vertical = Math.abs(opponent.y - body.y);
    // Mechs circle a nearby enemy while firing: hold a flank point on one side, then hop over to the other.
    if (distance < reach + 150 && vertical < 160) {
      const radius = reach + 48;
      if (![-1, 1].includes(memory.orbitSide)) {
        memory.orbitSide = Math.sign(body.x - opponent.x) || -toward; memory.orbitFlip = ticks + 150;
      }
      const flank = opponent.x + memory.orbitSide * radius;
      if (Math.abs(flank - body.x) <= 8 || ticks >= memory.orbitFlip) {
        memory.orbitSide = -memory.orbitSide; memory.orbitFlip = ticks + 150;
      }
      const direction = Math.sign(opponent.x + memory.orbitSide * radius - body.x) || memory.orbitSide;
      const crossing = Math.sign(opponent.x - body.x) === direction;
      return { direction, jump: state.grounded && (crossing ? distance < radius + 24 : ticks % 45 < 2),
        fire: true, acceptRisk: true, reason: 'aggressive assault: circling enemy while firing' };
    }
    memory.orbitSide = undefined;
    return { direction: advanceDirection === undefined ? distance > reach || !path.clear ? toward : 0 : advanceDirection,
      jump: state.grounded && (advanceDirection === undefined ? state.charges > 0 : ticks % 60 < 2) && distance < 280,
      fire: true, acceptRisk: true, reason: advanceDirection !== undefined ? 'aggressive assault: advancing toward enemy base; accepting incoming damage' :
        path.clear ? 'aggressive assault: accepting incoming damage' :
        'aggressive assault: advancing for a clear shot' };
  }
  if (memory.lastAttack === undefined) memory.lastAttack = ticks;
  if (memory.phase === 'commit' && ticks >= memory.until) {
    memory.phase = 'seek'; memory.lastAttack = ticks; memory.cooldown = ticks + 180;
  }
  if (memory.phase !== 'commit' && ticks - memory.lastAttack >= 240) {
    memory.phase = 'commit'; memory.until = ticks + 90;
  }
  if (memory.phase === 'commit') return { direction: distance > 60 || !path.clear ? toward : 0,
    jump: state.grounded && state.charges > 0 && distance < 280,
    fire: true, acceptRisk: true, reason: 'committed attack: accepting risk to break stalemate' };
  const behind = (body.x - opponent.x) * target.state.facing < -(opponent.right - opponent.left) / 2 - 8;
  const above = body.bottom < opponent.top - 4 && distance < 100;
  const observedShot = shots.some((shot) => shot.shooterId === target.id && shot.id > memory.lastShot);
  memory.lastShot = Math.max(memory.lastShot, ...shots.filter((shot) => shot.shooterId === target.id).map((shot) => shot.id));
  if (memory.phase === 'bait' && observedShot) {
    memory.phase = 'retreat'; memory.until = ticks + 24;
  } else if ((memory.phase === 'bait' || memory.phase === 'retreat') && ticks >= memory.until) {
    memory.phase = 'counter'; memory.until = ticks + 60; memory.cooldown = ticks + 180;
  } else if (memory.phase === 'counter' && ticks >= memory.until) memory.phase = 'seek';
  if (memory.phase === 'bait') return { direction: 0, jump: false, fire: false, reason: 'baiting opponent shot' };
  if (memory.phase === 'retreat') return { direction: -toward, jump: state.grounded && state.charges > 0,
    fire: false, reason: 'bait worked: retreating before counter' };
  if (memory.phase === 'counter') return { direction: distance > 100 ? toward : 0,
    jump: state.grounded && state.charges > 0, fire: true, reason: 'counterattacking after bait' };
  if (above) return { direction: distance > 35 ? toward : 0, jump: false, fire: true, reason: 'attacking from above' };
  if (behind && distance < 220) return { direction: distance > 100 ? toward : 0,
    jump: false, fire: true, reason: 'attacking from behind' };
  if (state.grounded && distance < 180 && path.clear && ticks >= memory.cooldown) {
    memory.phase = 'bait'; memory.until = ticks + 36;
    return { direction: 0, jump: false, fire: false, reason: 'baiting opponent shot' };
  }
  const rearX = opponent.x - target.state.facing *
    ((opponent.right - opponent.left + body.right - body.left) / 2 + 24);
  return { direction: Math.sign(rearX - body.x), jump: state.grounded && state.charges > 0 && distance < 280,
    fire: true, reason: state.grounded ? 'seeking overhead approach' : 'flanking toward opponent rear' };
}

const PIXEL_GROUND_ENGAGEMENT = Object.freeze({
  trooper: Object.freeze({ engage: 150, minimum: 70, contact: 45 }),
  tank: Object.freeze({ engage: 210, minimum: 100, contact: 50 }),
});

// Troops and tanks advance until an enemy is in weapon range, halt to fire, and back off when it closes in.
// Without a clear shot (terrain, cover or out of arc range) they always reposition toward the nearest enemy,
// accepting the risk of closing in rather than stalling where they cannot fire.
function getPixelGroundEngagement(kind, state, target, memory, path, advanceDirection) {
  const range = PIXEL_GROUND_ENGAGEMENT[kind];
  if (!range) throw new Error('Ground engagement requires a trooper or tank');
  if (!target) { memory.retreating = false; return { direction: advanceDirection, hold: false, reason: 'advancing' }; }
  const body = getPixelCombatBounds(state), opponent = getPixelCombatBounds(target);
  const gap = Math.max(0, Math.max(opponent.left - body.right, body.left - opponent.right));
  const toward = Math.sign(opponent.x - body.x) || state.facing;
  if (!path.clear) {
    memory.retreating = false;
    if (gap < range.contact || path.reason === 'target below barrel depression' ||
        path.reason === 'target under the barrel') {
      return { direction: -toward, hold: false, reason: 'enemy too close under the gun: backing off to bring it to bear' };
    }
    return { direction: toward, hold: false, reason: gap > range.engage ? 'advancing' :
      `enemy detected: repositioning for a clear shot past ${path.reason || 'cover'}` };
  }
  if (gap > range.engage) { memory.retreating = false; return { direction: advanceDirection, hold: false, reason: 'advancing' }; }
  if (gap < range.contact || gap < range.minimum || memory.retreating && gap < range.minimum + 20) {
    memory.retreating = true;
    return { direction: -toward, hold: false, reason: 'enemy too close: backing off while firing' };
  }
  memory.retreating = false;
  return { direction: 0, hold: true, reason: 'enemy detected: holding distance and firing' };
}

// Troops that reach water they cannot cross roam the shore: wander back inland a varied distance, idle a moment,
// then stroll to the edge again. Engagement still wins: holding to fire, or any move away from the water, stays as is.
const PIXEL_SHORE_ROAM = Object.freeze({ minDistance: 14, maxDistance: 56, minIdle: 40, maxIdle: 160, stuckTicks: 20 });

// Shots at an enemy core may dig through settled rubble (merged into terrain) this close to the aim point.
const PIXEL_CORE_DIG_RADIUS = 20;
// Units must close to this horizontal distance before opening fire on a core: no cross-map sniping.
const PIXEL_CORE_ASSAULT_RANGE = 200;

// Ground units caught inside a glowing mech wreck's blast zone run straight away from it until they are clear.
const PIXEL_BLAST_ESCAPE_MARGIN = 8;

function getPixelBlastEscape(state, threats) {
  const body = getPixelCombatBounds(state);
  let best = null;
  for (const threat of threats) {
    const dx = Math.max(0, body.left - threat.center.x, threat.center.x - body.right);
    const dy = Math.max(0, body.top - threat.center.y, threat.center.y - body.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance > threat.radius + PIXEL_BLAST_ESCAPE_MARGIN || best && distance >= best.distance) continue;
    best = { distance, direction: Math.sign(body.x - threat.center.x) || state.facing || 1 };
  }
  return best && { direction: best.direction, reason: 'Fleeing mech blast zone' };
}

function createPixelShoreMemory(id) {
  let seed = 2166136261;
  for (const character of String(id)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  return { shoreSeed: seed, shore: null };
}

function getPixelShoreRoam(memory, state, desired, ticks, waiting) {
  const roam = PIXEL_SHORE_ROAM, x = state.x + state.width / 2;
  const roll = (span) => {
    memory.shoreSeed = (Math.imul(memory.shoreSeed === undefined ? 0x9e3779b1 : memory.shoreSeed, 1103515245) + 12345) >>> 0;
    return (memory.shoreSeed >>> 8) % (span + 1);
  };
  if (waiting && desired) {
    memory.shore = { side: desired, edgeX: x, phase: 'inland', lastX: x, still: 0, until: 0,
      distance: roam.minDistance + roll(roam.maxDistance - roam.minDistance) };
  }
  const shore = memory.shore;
  if (!shore) return null;
  if (desired === -shore.side) { memory.shore = null; return null; }
  if (desired === 0) return null;
  shore.still = Math.abs(x - shore.lastX) < 0.5 ? shore.still + 1 : 0; shore.lastX = x;
  if (shore.phase === 'inland' && (Math.abs(x - shore.edgeX) >= shore.distance || shore.still >= roam.stuckTicks)) {
    shore.phase = 'idle'; shore.until = ticks + roam.minIdle + roll(roam.maxIdle - roam.minIdle);
  }
  if (shore.phase === 'idle' && ticks >= shore.until) shore.phase = 'shore';
  const direction = shore.phase === 'inland' ? -shore.side : shore.phase === 'idle' ? 0 : shore.side;
  return { direction, reason: shore.phase === 'idle' ? 'Idling near water: cannot cross' :
    shore.phase === 'inland' ? 'Roaming the shore: cannot cross water' : 'Wandering back to the water edge' };
}

// Tank crew: the turret tracks the target independently of the hull, the barrel steps through its aim frames toward
// the ballistic elevation, and backing off is done in reverse so the hull keeps facing the enemy.
function operatePixelTank(entry, combat, point, direction) {
  const unit = entry.unit, state = unit.inspect({ sprites: false }), center = state.x + state.width / 2;
  const toward = point ? Math.sign(point.x - center) : 0;
  if (toward && Math.abs(point.x - center) > 2) unit.setTurret(toward);
  else if (!point) unit.setTurret(null);
  unit.input.reverse = Boolean(direction && toward && direction !== toward && state.facing === toward);
  const solution = point ? combat.ballistics(entry.id, point) : null;
  const desired = solution && solution.direction === unit.inspect({ sprites: false }).turret ? solution.aim : state.aim;
  unit.input.aimUp = state.aim < desired; unit.input.aimDown = state.aim > desired;
  return solution;
}

function getPixelCombatAwareness(world, state, owner, target, shots, path) {
  const { left, right, top, bottom } = getPixelCombatBounds(state);
  const direction = target ? Math.sign(target.x - (left + right) / 2) || state.facing : owner === 'blue' ? 1 : -1;
  for (let y = Math.max(0, top - 48); y < top; y += 1) {
    for (let x = Math.max(0, left - 4); x <= Math.min(world.width - 1, right + 4); x += 1) {
      if (world.at(x, y) !== PARTICLE_DEBRIS) continue;
      if ([-1, 0, 1].some((dx) => x + dx >= 0 && x + dx < world.width &&
          [PARTICLE_EMPTY, PARTICLE_WATER].includes(world.at(x + dx, y + 1)))) {
        return { direction: -direction, reason: 'retreating from falling debris', evade: true };
      }
    }
  }
  if (state.kind === 'hopper') for (const shot of shots) {
    if (shot.ownerId === owner || isPixelInterceptorShot(shot)) continue;
    const vx = shot.dx * shot.speed, vy = shot.dy * shot.speed;
    let enter = 0, leave = 0.65;
    for (const [position, velocity, low, high] of [
      [shot.x, vx, left - 8, right + 8], [shot.y, vy, top - 8, bottom + 8],
    ]) {
      if (Math.abs(velocity) < 1e-8) {
        if (position < low || position > high) { leave = -1; break; }
      } else {
        const a = (low - position) / velocity, b = (high - position) / velocity;
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter <= leave) return { direction: -direction, reason: 'dodging projectile backward', evade: true };
  }
  return { direction, reason: path && !path.clear ? `repositioning: ${path.reason} blocks fire` :
    target ? 'tracking target' : 'advancing', evade: false };
}

function createPixelCombatFixture(options = {}) {
  const terrain = options.terrain === undefined ? 'original' : options.terrain;
  if (!['original', 'dry-route'].includes(terrain)) throw new Error('Invalid combat terrain scenario');
  const world = createParticleWorld(1100, 400, { skipEmptyChunks: true });
  world.configureDebrisMerging(600);
  const ground = 330, ownership = new Map(), buildings = [], bases = [], units = [];
  const packs = [
    ['trooper', PIXEL_UNIT_REFERENCE, undefined],
    ['tank', PIXEL_TANK_REFERENCE, ['move', 'aim']],
    ['hopper', PIXEL_HOPPER_REFERENCE, ['idle', 'jump', 'boost', 'fall']],
    ['jet', PIXEL_JET_REFERENCE, ['fly', 'shoot', 'down']],
  ];
  const artworks = new Map(packs.map(([kind, reference, roles]) => [kind,
    createPixelUnitArtwork(reference, { roles, cellScale: PIXEL_UNIT_RELATIVE_SCALES[kind],
      cellReduction: 4, inPlace: kind === 'hopper' })]));
  const surfaceRows = [];
  for (let x = 0; x < world.width; x += 1) {
    const hill = Math.max(0, 28 - Math.floor(Math.abs(x - 410) / 2));
    const mountain = Math.max(0, 70 - Math.abs(x - 710));
    const basin = terrain === 'original' && x >= 525 && x < 625;
    const surface = terrain === 'dry-route' ? ground : basin ? 375 : ground - Math.max(hill, mountain);
    surfaceRows.push(surface);
    for (let y = surface; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    if (basin) for (let y = 340; y < surface; y += 1) world.set(x, y, PARTICLE_WATER);
  }
  function building(type, left, width, height, owner) {
    const item = { id: `${owner}-${type}`, type, left, width, top: ground - height, bottom: ground - 1,
      owner, cells: [], core: [], details: [], windows: [] };
    function cell(x, y, role = 'frame') {
      const key = y * world.width + x;
      if (ownership.has(key)) {
        if (ownership.get(key).building !== item) throw new Error('Fixture building ownership overlap');
        return;
      }
      if (world.at(x, y) !== PARTICLE_EMPTY) throw new Error('Fixture structure overlaps terrain or water');
      if (!world.emitConstruction(x, y).ok) throw new Error('Fixture material issuance failed');
      ownership.set(key, { building: item, role }); item.cells.push({ x, y, role });
      if (role === 'core') item.core.push({ x, y });
    }
    for (let y = item.top; y < ground; y += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const doorHeight = artworks.get('trooper').height + 1;
        const door = type !== 'farm' && y >= ground - 1 - doorHeight && y < ground - 1;
        const cap = type === 'farm' ? Math.floor(Math.abs(dx - (width - 1) / 2) / 4) : 0;
        if (y >= item.top + cap) {
          if (!door || owner !== 'red') cell(left + dx, y);
          if (!door || owner !== 'blue') cell(left + width - 1 - dx, y);
        }
      }
    }
    for (let x = left; x < left + width; x += 1) {
      const cap = type === 'farm' ? Math.floor(Math.abs((x - left) - (width - 1) / 2) / 4) : 0;
      cell(x, item.top + cap); cell(x, item.top + cap + 1); cell(x, ground - 1);
      if (type === 'population') for (let y = item.top + 24; y < ground - 10; y += 24) cell(x, y);
    }
    // A core is its own singly-owned physical pixel cluster, not another frame overlay.
    const coreLeft = owner === 'red' && type === 'military' ? left + width - 9 : left + 3;
    for (let y = ground - 11; y < ground - 5; y += 1) for (let x = coreLeft; x < coreLeft + 6; x += 1) cell(x, y, 'core');
    if (type === 'population') {
      for (let y = item.top + 8; y < ground - 16; y += 24) for (let x = left + 8; x < left + width - 7; x += 10) {
        item.details.push({ x, y, width: 4, height: 8, color: '#617f85' });
      }
    }
    if (type !== 'farm') {
      for (let y = item.top + 10; y < ground - 8; y += 24) {
        item.windows.push({ x: left + 6, y, width: width - 12,
          height: y + 24 >= ground - 8 ? ground - 1 - y : 12 });
      }
    }
    if (type === 'farm') {
      for (let y = ground - 40; y < ground - 2; y += 1) {
        item.details.push({ x: left + 4, y, width: width - 8, height: 1, color: '#d6a953' });
      }
      for (let x = left - 14; x < left; x += 3) item.details.push({ x, y: ground - 9, width: 1, height: 8, color: '#e6cd72' });
    }
    let pending = item.cells.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    while (pending.length) {
      const remaining = pending.filter((cell) => !world.settleConstruction(cell.x, cell.y).ok);
      if (remaining.length === pending.length) throw new Error('Unsupported fixture structure');
      pending = remaining;
    }
    buildings.push(item); return item;
  }
  for (const [owner, left] of [['blue', 110], ['red', 825]]) {
    const frame = building('military', left, 165, 175, owner);
    const tower = building('population', owner === 'blue' ? 20 : 1030, 50, 145, owner);
    building('farm', owner === 'blue' ? 76 : 995, 28, 62, owner);
    bases.push({ owner, frame, tower, spawned: 0, nextSpawn: 0, nextMissile: 0, nextIntercept: 0, nextKind: 0,
      origin: { x: left + 80, y: frame.top - 16 } });
  }
  const buildingLayers = createPixelBuildingLayers(world, () => buildings.map((building) => ({
    owner: building.owner, cells: building.cells, core: building.core, left: building.left, right: building.left + building.width,
    top: building.top, bottom: ground, windows: building.windows,
    intact: () => building.core.some((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER),
  })));
  const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE, { cellReduction: 4, buildingLayers });
  const collisionGroup = createPixelUnitCollisionGroup(world);
  world.configureDebrisMergeOccupancy(collisionGroup.isOccupied);
  const roads = createPixelCombatRoads(world, [
    { left: 275, right: 510, owner: 'blue', surfaceRows },
    { left: 640, right: 824, owner: 'red', surfaceRows },
  ]);
  const initial = { water: world.waterCount, terrain: world.terrainCount, material: world.barrierCount };
  let ticks = 0, serial = 0, spawning = true, devices = true, fighting = true, transporting = true;
  const transport = { loaded: 0, deployed: 0, lost: 0, hatchShots: 0, events: [] };
  const airlift = createPixelTankAirlift(world, units, combat, (entry) => entry.owner === 'blue' ? 1 : -1,
    { combatActive: () => fighting });
  const livingCount = (owner) => units.filter((entry) => entry.owner === owner &&
    combat.health(entry.id).health > 0).reduce((count, entry) => count + 1 + entry.cargo.length, 0);
  function transportEvent(entry, action, count) {
    transport.events.push({ tick: ticks, id: entry.id, action, count });
    if (transport.events.length > 32) transport.events.shift();
  }
  const activeCore = (base) => base.frame.core.every((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER);
  const spawnLayouts = new Map();
  for (const base of bases) for (const [kind, art] of artworks) {
    const options = { kind, x: base.frame.left + 16,
      y: kind === 'jet' ? base.frame.top - art.height - 12 :
        ground - (kind === 'trooper' ? 1 : 0) - art.footRow,
      facing: base.owner === 'blue' ? 1 : -1, ownerId: base.owner, automated: true,
      speedScale: 1.8, treadRate: 2, forwardLunge: 1.8, groundSpeedMultiplier: roads.multiplier,
      ...(kind === 'tank' ? { hatchArtwork: artworks.get('trooper') } : {}),
      ...buildingLayers.contactOptions(kind, base.owner) };
    const probe = kind === 'trooper' ? createPixelTerrainUnit(world, art, options) : createPixelVehicleUnit(world, art, options);
    spawnLayouts.set(`${base.owner}-${kind}`, { options, collision: probe.inspect().collision });
  }
  function issue(base, kind, placement, id = `${base.owner}-${kind}-${++serial}`) {
    const art = artworks.get(kind), options = { ...placement, collisionGroup, assault: kind === 'hopper',
      ...buildingLayers.contactOptions(kind, base.owner),
      onBuildingImpact: (hit, velocity) => combat.crashUnit(id, hit, velocity) };
    const unit = kind === 'trooper' ? createPixelTerrainUnit(world, art, options) : createPixelVehicleUnit(world, art, options);
    combat.register(id, unit, kind, base.owner);
    const entry = { id, kind, owner: base.owner, unit, homeY: placement.y, deadAt: null,
      tactic: 'advancing', evadeUntil: 0, evadeDirection: 0, targetId: null, path: null,
      awarenessPhase: serial % 6, strategy: null, debrisDamage: 0, damageMask: null,
      cargo: [], transportPhase: 'loading', nextDeploy: 0, transportStatus: '',
      strategyMemory: { targetId: null, phase: 'seek', until: 0, cooldown: 0, lastShot: 0 } };
    units.push(entry);
    return entry;
  }
  function spawn(base, kind = packs[base.nextKind % packs.length][0]) {
    const reject = (reason) => {
      base.spawnStatus = `Waiting: ${reason}`;
      return { ok: false, reason };
    };
    if (!activeCore(base)) return reject('base core destroyed');
    if (livingCount(base.owner) >= 4) {
      return reject('four living units per base');
    }
    if (base.spawned >= 64) return reject('64 lifetime units per base');
    const art = artworks.get(kind);
    if (!art) throw new Error('Invalid fixture spawn type');
    const layout = spawnLayouts.get(`${base.owner}-${kind}`), { x, y } = layout.options;
    const blocked = findPixelUnitContact(world, x, y, layout.collision, false, layout.options.ignoreMaterial) ||
      collisionGroup.contact(base.owner, x, y, layout.collision);
    const wet = inspectPixelUnitWater(world, x, y, layout.collision).wet;
    if (blocked || wet) {
      return reject(`${kind} spawn blocked by ${blocked ? blocked.reason : 'water'}`);
    }
    const entry = issue(base, kind, layout.options);
    base.spawned += 1; base.nextKind += 1;
    base.spawnStatus = `Issued ${entry.id}`;
    return { ok: true, entry };
  }
  function loadTank(entry) {
    if (entry.kind !== 'tank' || entry.transportPhase !== 'loading' || !transporting) return;
    const base = bases.find((base) => base.owner === entry.owner), state = entry.unit.inspect({ sprites: false });
    if (!activeCore(base) || !state.grounded || state.x < base.frame.left ||
        state.x + state.width > base.frame.left + base.frame.width) return;
    const reserveHopper = spawning && world.waterCount > 0 && !units.some((other) => other.owner === entry.owner && other.kind === 'hopper');
    const count = Math.max(0, Math.min(3, 4 - livingCount(entry.owner) - Number(reserveHopper), 64 - base.spawned));
    for (let index = 0; index < count; index += 1) {
      entry.cargo.push({ id: `${entry.owner}-trooper-${++serial}` });
      base.spawned += 1; transport.loaded += 1;
    }
    entry.transportPhase = count ? 'carrying' : 'empty';
    entry.transportStatus = count ? `Carrying ${count}/3 troops to enemy approach` : 'No passenger slots available';
    if (count) transportEvent(entry, 'loaded', count);
  }
  function deployTank(entry) {
    const state = entry.unit.inspect({ sprites: false }), body = getPixelCombatBounds(state);
    const enemy = bases.find((base) => base.owner !== entry.owner), direction = entry.owner === 'blue' ? 1 : -1;
    const dropX = direction > 0 ? enemy.frame.left - 160 : enemy.frame.left + enemy.frame.width + 160;
    const nearFrontline = direction * (body.x - world.width / 2) >= -120 && units.some((other) => {
      if (other.owner === entry.owner || combat.health(other.id).health === 0) return false;
      const opponent = getPixelCombatBounds(other.unit.inspect({ sprites: false }));
      return Math.abs(opponent.x - body.x) <= 200 && Math.abs(opponent.y - body.y) <= 100;
    });
    const health = combat.health(entry.id), damaged = health.health < health.maxHealth * 0.6;
    // A badly damaged carrier bails its passengers out where it is rather than taking them down with it.
    if (!state.grounded || direction * (body.x - dropX) < 0 && !nearFrontline && !damaged) {
      entry.transportStatus = `Carrying ${entry.cargo.length}/3; ${state.state}; destination x=${dropX}`;
      return direction;
    }
    entry.transportPhase = 'deploying';
    entry.transportStatus = `Deploying: ${entry.cargo.length} troops remaining`;
    if (ticks < entry.nextDeploy) return 0;
    const art = artworks.get('trooper'), exitDirection = -direction, mask = art.mask('standing', exitDirection);
    const occupied = new Set();
    for (const other of units) {
      if (other === entry || combat.health(other.id).health === 0) continue;
      const pose = other.unit.inspect({ sprites: false });
      for (const pixel of pose.collision) occupied.add((pose.y + pixel.y) * world.width + pose.x + pixel.x);
    }
    const x = Math.round((direction > 0 ? body.left : body.right) - art.width / 2);
    const y = state.y + state.footRow - art.footRow;
    const blocked = findPixelUnitContact(world, x, y, mask, true) || inspectPixelUnitWater(world, x, y, mask).wet ||
      mask.some((pixel) => occupied.has((y + pixel.y) * world.width + x + pixel.x));
    const support = blocked ? null : findPixelUnitContact(world, x, y + 1, mask, true);
    if (!blocked && support && [PARTICLE_TERRAIN, PARTICLE_BARRIER].includes(support.material)) {
      const base = bases.find((base) => base.owner === entry.owner);
      const troop = issue(base, 'trooper', { ...spawnLayouts.get(`${entry.owner}-trooper`).options,
        x, y, facing: exitDirection }, entry.cargo[0].id);
      troop.deployedFrom = entry.id; troop.exitUntil = ticks + 30; troop.exitDirection = exitDirection;
      entry.cargo.shift(); transport.deployed += 1; transportEvent(entry, 'deployed from rear hatch', 1);
      entry.nextDeploy = ticks + 30;
      if (!entry.cargo.length) {
        entry.transportPhase = 'complete'; entry.transportStatus = 'Deployment complete; joining combat';
      }
      return 0;
    }
    entry.nextDeploy = ticks + 30;
    entry.transportStatus = 'Waiting: rear hatch blocked, wet or unsupported';
    return 0;
  }
  const center = (entry) => {
    const state = entry.unit.inspect(), pixels = state.pixels;
    const pixel = pixels[Math.floor(pixels.length / 2)];
    return { x: state.x + pixel.x, y: state.y + pixel.y };
  };
  // A living enemy core as an attack objective: aim at its surviving cell nearest the attacker.
  function coreObjective(base, state) {
    const cells = base.frame.core.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER);
    if (!cells.length) return null;
    const middle = state ? state.x + state.width / 2 : base.frame.left + base.frame.width / 2;
    const point = cells.reduce((best, cell) => Math.abs(cell.x - middle) < Math.abs(best.x - middle) ? cell : best);
    return { id: `${base.owner}-core`, core: true, owner: base.owner, point: { x: point.x, y: point.y },
      state: { x: 0, y: 0, width: 0, height: 0, facing: base.owner === 'red' ? -1 : 1, grounded: true, charges: 0,
        collision: cells.map((cell) => ({ x: cell.x, y: cell.y })) } };
  }
  function targetPoint(entry) {
    if (!entry.targetId) return null;
    const base = bases.find((item) => `${item.owner}-core` === entry.targetId);
    if (base) {
      const core = coreObjective(base, entry.unit.inspect({ sprites: false }));
      return core && core.point;
    }
    const target = units.find((other) => other.id === entry.targetId);
    return target ? center(target) : null;
  }
  // Enemy structure never stalls an assault: fire blocked only by an enemy building's wall, roof or core
  // is a breaching shot that chips through toward the target instead of a reason to hold fire. Against a core,
  // rubble that has settled into terrain right over it is dug out the same way.
  function breachPath(entry, path, core = null) {
    if (core) {
      const state = entry.unit.inspect({ sprites: false });
      if (Math.abs(core.x - (state.x + state.width / 2)) > PIXEL_CORE_ASSAULT_RANGE) {
        return { clear: false, reason: 'enemy core out of assault range' };
      }
    }
    if (!path || path.clear || !Number.isFinite(path.x) || !Number.isFinite(path.y)) return path;
    const material = world.at(path.x, path.y);
    const building = [PARTICLE_BARRIER, PARTICLE_CONSTRUCTION].includes(material) && buildingLayers.at(path.x, path.y);
    const buried = core && material === PARTICLE_TERRAIN &&
      Math.hypot(path.x - core.x, path.y - core.y) <= PIXEL_CORE_DIG_RADIUS;
    if (!buried && (!building || building.owner === entry.owner)) return path;
    return { ...path, clear: true, breach: true, reason: `breaching enemy ${path.reason}` };
  }
  function audit() {
    const state = combat.inspect({ sprites: false });
    if (transport.loaded !== transport.deployed + transport.lost +
        units.reduce((count, entry) => count + entry.cargo.length, 0)) {
      throw new Error('Tank passenger accounting failed');
    }
    if (world.waterCount !== initial.water || world.terrainCount + state.terrainDebris - world.mergedDebrisCount !== initial.terrain ||
        world.barrierCount + world.constructionCount + world.debrisCount + world.mergedDebrisCount !==
          initial.material + state.terrainDebris + state.issuedAmmoDebris) {
      throw new Error('Shared combat fixture conservation failed');
    }
    return state;
  }
  function step() {
    ticks += 1;
    buildingLayers.refresh();
    const fallingTargets = new Map();
    for (const entry of units) {
      const state = entry.unit.inspect({ sprites: false });
      const pose = `${state.facing}:${state.posture}`;
      if (!entry.damageMask || entry.damageMask.pose !== pose) {
        const rows = new Map();
        for (const pixel of state.collision) {
          if (!rows.has(pixel.x) || pixel.y < rows.get(pixel.x)) rows.set(pixel.x, pixel.y);
        }
        entry.damageMask = { pose, rows };
      }
      const topRows = new Map(), body = { entry, hits: 0, topRows };
      for (const [x, y] of entry.damageMask.rows) topRows.set(state.x + x, state.y + y);
      for (const [x, y] of topRows) {
        const key = y * world.width + x;
        if (!fallingTargets.has(key)) fallingTargets.set(key, []);
        fallingTargets.get(key).push(body);
      }
    }
    world.step(undefined, false, (x, y, nx, ny) => {
      const targets = fallingTargets.get(ny * world.width + nx);
      if (!targets) return;
      for (const body of targets) {
        if (body.hits >= 4 || body.topRows.has(x) && y >= body.topRows.get(x)) continue;
        body.hits += 1;
        body.entry.debrisDamage += combat.fallingDebrisDamage(body.entry.id, 5);
      }
    });
    const shots = combat.inspect({ sprites: false }).shots;
    const airlifted = airlift.step();
    for (let i = units.length - 1; i >= 0; i -= 1) {
      const entry = units[i], state = entry.unit.inspect({ sprites: false });
      if (combat.health(entry.id).health === 0 || state.drowned || state.killed) {
        if (entry.deadAt === null) {
          combat.destroyUnit(entry.id, state.drowned ? 'drowned' : 'destroyed');
          if (entry.cargo.length) {
            transport.lost += entry.cargo.length; transportEvent(entry, 'carrier lost', entry.cargo.length);
            entry.cargo.length = 0;
          }
          entry.deadAt = ticks; collisionGroup.unregister(entry.unit); combat.unregister(entry.id); units.splice(i, 1);
        }
        continue;
      }
      loadTank(entry);
      if (airlifted.has(entry)) continue;
      if ((ticks + entry.awarenessPhase) % 6 === 0 || !entry.path) {
        const enemies = units.filter((other) => other.owner !== entry.owner &&
          combat.health(other.id).health > 0 && !other.unit.inspect({ sprites: false }).drowned);
        const ground = entry.kind === 'trooper' || entry.kind === 'tank';
        const distanceTo = (other) => Math.abs(center(other).x - (state.x + state.width / 2));
        const nearby = enemies.filter((other) => other.kind !== 'jet').sort((a, b) => distanceTo(a) - distanceTo(b));
        const enemyBase = bases.find((base) => base.owner !== entry.owner);
        const unitTarget = ground ? nearby[0] || enemies[0] : enemies.find((other) => other.kind === entry.kind) || enemies[0];
        const core = coreObjective(enemyBase, state);
        // The enemy core is the objective: attack it whenever no enemy unit is closer (or none is left).
        const target = core && (!unitTarget || entry.kind !== 'jet' && Math.abs(core.point.x - (state.x + state.width / 2)) <
          distanceTo(unitTarget)) ? core : unitTarget;
        entry.targetId = target ? target.id : null;
        const point = target ? target.core ? target.point : center(target) : null;
        entry.path = point && fighting ? breachPath(entry, combat.firingPath(entry.id, point), target.core ? point : null) :
          { clear: false, reason: 'no active target' };
        const awareness = getPixelCombatAwareness(world, { ...state, kind: entry.kind }, entry.owner, point, shots, entry.path);
        const assaultDirection = Math.sign(enemyBase.frame.left + enemyBase.frame.width / 2 - (state.x + state.width / 2));
        const targetState = target ? target.core ? target.state : target.unit.inspect({ sprites: false }) : null;
        entry.strategy = entry.kind === 'hopper' ? getPixelHopperStrategy(state,
          target ? { id: target.id, state: targetState } : null,
          entry.strategyMemory, ticks, shots, entry.path, true, assaultDirection) : null;
        if (entry.strategy && entry.strategy.acceptRisk) {
          entry.evadeUntil = ticks;
          entry.tactic = entry.strategy.reason; entry.direction = entry.strategy.direction;
        } else if (awareness.evade) {
          entry.evadeUntil = ticks + 30; entry.evadeDirection = awareness.direction;
          entry.tactic = awareness.reason;
        } else if (ticks >= entry.evadeUntil) {
          entry.tactic = entry.strategy ? entry.strategy.reason : awareness.reason;
          entry.direction = entry.strategy ? entry.strategy.direction : awareness.direction;
          if (ground) {
            const engagement = getPixelGroundEngagement(entry.kind, state,
              target && target.kind !== 'jet' ? targetState : null,
              entry.engagement || (entry.engagement = {}), entry.path, awareness.direction);
            entry.direction = engagement.direction;
            if (engagement.reason !== 'advancing') entry.tactic = engagement.reason;
          }
        }
      }
      const evading = ticks < entry.evadeUntil;
      let direction = evading ? entry.evadeDirection : entry.direction === undefined ?
        (entry.owner === 'blue' ? 1 : -1) : entry.direction;
      if (entry.cargo.length) {
        direction = deployTank(entry);
        entry.tactic = entry.transportStatus;
      }
      if (entry.exitUntil && ticks < entry.exitUntil) {
        direction = entry.exitDirection; entry.tactic = 'Exiting tank rear hatch';
      }
      if (entry.kind === 'trooper' && !evading) {
        const roam = getPixelShoreRoam(entry.shoreMemory || (entry.shoreMemory = createPixelShoreMemory(entry.id)),
          state, direction, ticks, state.state === 'waiting at water edge');
        if (roam) { direction = roam.direction; entry.tactic = roam.reason; }
      }
      if (entry.kind === 'trooper' || entry.kind === 'tank') {
        const escape = getPixelBlastEscape(state, combat.wreckThreats());
        if (escape) { direction = escape.direction; entry.tactic = escape.reason; }
      }
      if (entry.kind === 'jet') {
        entry.unit.input.right = state.x < 900; entry.unit.input.left = state.x >= 900;
        if (entry.owner === 'red') { entry.unit.input.left = state.x > 190; entry.unit.input.right = state.x <= 190; }
        updatePixelUnitLabPatrol(entry.unit, world, entry.homeY);
        if (evading || fighting && entry.targetId && !entry.path.clear) {
          entry.unit.input.right = direction > 0; entry.unit.input.left = direction < 0;
          entry.unit.input.up = true; entry.unit.input.down = false;
        }
      } else {
        entry.unit.input.right = direction > 0; entry.unit.input.left = direction < 0;
        entry.unit.input.jump = entry.kind === 'hopper' && Boolean(evading ||
          (entry.strategy ? entry.strategy.jump : ticks % 240 < 2));
        if (entry.kind === 'hopper') entry.unit.input.boost = evading;
        entry.unit.input.glide = entry.kind === 'hopper';
      }
      if (entry.kind === 'tank') {
        const point = fighting ? targetPoint(entry) : null;
        entry.unit.setHatch(entry.cargo.length > 0);
        entry.gunnery = operatePixelTank(entry, combat, point, direction);
      }
      entry.unit.step();
      if (entry.kind === 'trooper' && entry.unit.inspect({ sprites: false }).state === 'waiting at water edge') {
        entry.tactic = 'Waiting at water edge';
      }
    }
    for (const base of bases) {
      if (!activeCore(base)) continue;
      if (spawning && ticks >= base.nextSpawn) {
        const needsHopper = airlift.needsCarrier(base.owner) || world.waterCount > 0 &&
          units.some((entry) => entry.owner === base.owner && entry.cargo.length) &&
          !units.some((entry) => entry.owner === base.owner && entry.kind === 'hopper');
        const result = needsHopper ? spawn(base, 'hopper') :
          transporting && base.nextKind === 0 ? spawn(base, 'tank') : spawn(base);
        base.nextSpawn = ticks + (result.ok ? 45 : 60);
      }
      if (devices && ticks >= base.nextMissile) {
        const enemy = bases.find((other) => other !== base);
        combat.launch(base.owner, base.origin, { x: enemy.frame.left + 80, y: enemy.frame.top },
          { shooterId: `${base.owner}-launcher` });
        base.nextMissile = ticks + 150;
      }
      if (devices && ticks >= base.nextIntercept) {
        const shots = combat.inspect({ sprites: false }).shots;
        const threat = findPixelInterceptorThreat(shots, base.owner, base.origin);
        const jet = threat ? null : findPixelAntiAirTarget(units, shots, base.owner, base.origin);
        if (threat) {
          combat.launch(base.owner, { x: base.origin.x + 24, y: base.origin.y }, threat,
            { targetShotId: threat.id, shooterId: `${base.owner}-interceptor` });
          base.nextIntercept = ticks + 75;
        } else if (jet) {
          combat.launch(base.owner, { x: base.origin.x + 24, y: base.origin.y }, jet.point,
            { targetUnitId: jet.entry.id, shooterId: `${base.owner}-interceptor` });
          base.nextIntercept = ticks + 75;
        }
      }
    }
    if (fighting) for (const entry of units) {
      const point = targetPoint(entry), corePoint = point && /-core$/.test(entry.targetId) ? point : null;
      // Passengers man the top hatch: a carrying tank's rifleman fires on his own reload while the tank drives.
      if (entry.kind === 'tank' && entry.cargo.length && point && !entry.airlift &&
          combat.health(entry.id).hatchReload <= 1e-8) {
        if (breachPath(entry, combat.firingPath(entry.id, point, { weapon: 'hatch' }), corePoint).clear) {
          const result = combat.fire(entry.id, point, { weapon: 'hatch' });
          if (result.ok) transport.hatchShots += 1;
        }
      }
      if (!entry.airlift && (!entry.cargo.length || entry.kind === 'tank') && (!entry.exitUntil || ticks >= entry.exitUntil) &&
          point && entry.path && entry.path.clear && ticks >= entry.evadeUntil &&
          (!entry.strategy || entry.strategy.fire) &&
          combat.health(entry.id).reload <= 1e-8) {
        entry.path = breachPath(entry, combat.firingPath(entry.id, point), corePoint);
        const result = entry.path.clear ? combat.fire(entry.id, point) : { ok: false };
        if (result.ok && entry.kind === 'hopper') entry.strategyMemory.lastAttack = ticks;
        if (result.ok && 'shoot' in entry.unit.input) entry.unit.input.shoot = true;
        else if ('shoot' in entry.unit.input && combat.health(entry.id).reload < 0.05) entry.unit.input.shoot = false;
      }
      else if ('shoot' in entry.unit.input) entry.unit.input.shoot = false;
    }
    combat.step();
    if (ticks % 60 === 0) audit();
  }
  return { world, buildings, bases, units, combat, airlift, artworks, ownership, surfaceRows, roads, initial,
    buildingLayers, spawn, step, audit, activeCore,
    transport, terrain, livingCount,
    get ticks() { return ticks; },
    configure(options) {
      if (options.spawning !== undefined) spawning = Boolean(options.spawning);
      if (options.devices !== undefined) devices = Boolean(options.devices);
      if (options.fighting !== undefined) fighting = Boolean(options.fighting);
      if (options.transporting !== undefined) transporting = Boolean(options.transporting);
    },
    mode: 'bounded-physical-combat-fixture-not-generated-city' };
}
