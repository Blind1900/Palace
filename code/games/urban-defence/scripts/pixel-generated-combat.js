// Health order (pixel-unit-combat.js): trooper 100 < jet 150 < tank 400 < hopper 600; costs follow it.
const PIXEL_PRODUCTION_COSTS = Object.freeze({
  trooper: Object.freeze({ hm: 15, sm: 1 }),
  jet: Object.freeze({ hm: 40, sm: 2 }),
  tank: Object.freeze({ hm: 60, sm: 3 }),
  hopper: Object.freeze({ hm: 90, sm: 4 }),
  'missile-launcher': Object.freeze({ hm: 12, sm: 0 }),
  interceptor: Object.freeze({ hm: 4, sm: 0 }),
});
function createPixelGeneratedCombat(city, source) {
  if (!city || city.world.width !== source.width || city.world.height !== source.height ||
      city.originX !== 0 || city.originY !== 0) throw new Error('Generated combat requires the complete source world');
  const world = city.world, styles = source.architectureStyles || createFactionArchitectureStyles();
  const ownerAt = (x) => x < world.width * 0.2 ? 'left' : x >= world.width * 0.8 ? 'right' : 'neutral';
  for (const entry of city.entries) {
    const poles = entry.seedPlacement.filter((cell, index) => index % 3 === 0).map((cell) => cell.x);
    entry.building = { ...entry.building, type: 'population', level: 3, cores: poles.length, poles,
      spacing: poles.length > 1 ? poles[1] - poles[0] : 0,
      width: poles[poles.length - 1] - poles[0] + 3, owner: entry.building.owner || ownerAt(poles[0]) };
  }
  const generation = [];
  for (const owner of ['left', 'neutral', 'right']) for (const type of ['population', 'military', 'farm']) {
    // Generated towers follow terrain; seed a faction's missing tower through normal paid placement.
    if (type === 'population' && city.entries.some((entry) =>
      entry.building.owner === owner && entry.building.type === 'population')) continue;
    let placed = null, lastReason = '';
    for (let x = 8; x < world.width - 8; x += 8) {
      if (ownerAt(x) !== owner) continue;
      const result = city.addSeed(x, false, { type, level: 3 });
      if (!result.ok) { lastReason = result.reason; continue; }
      placed = city.entries[result.index];
      placed.building.owner = owner;
      break;
    }
    if (!placed) throw new Error(`No supported ${owner} ${type} site: ${lastReason}`);
    generation.push(`${owner} ${type}`);
  }
  let facadePlans = [], facades = [];
  const buildingLayers = createPixelBuildingLayers(world, () => {
    const plans = city.entries.flatMap((entry) => [entry.scenario.plan, entry.scenario.plan.length,
      entry.building.owner, entry.scenario.finished, entry.scenario.coreDestroyed]);
    if (plans.length === facadePlans.length && plans.every((value, index) => value === facadePlans[index])) return facades;
    facadePlans = plans;
    facades = city.entries.map((entry) => {
      const cells = entry.scenario.plan, left = Math.min(...cells.map((cell) => cell.x));
      const right = Math.max(...cells.map((cell) => cell.x)) + 1, top = Math.min(...cells.map((cell) => cell.y));
      const bottom = Math.max(...entry.seedPlacement.map((cell) => cell.groundY));
      const windows = [], story = Math.max(12, entry.building.floorHeight || 12);
      const shaped = entry.building.facade && entry.building.facade.shaped;
      for (let y = top + 4; !shaped && y + 5 < bottom; y += story) {
        if (right - left > 6) windows.push({ x: left + 2, y, width: right - left - 4, height: 5 });
      }
      const core = entry.scenario.inspectCore ? entry.scenario.inspectCore().cells.map(({ x, y }) => ({ x, y })) : [];
      return { owner: entry.building.owner, cells, core, left, right, top, bottom, windows,
        ...(shaped ? { spans: entry.building.facade.spans } : {}),
        intact: () => entry.scenario.finished && !entry.scenario.coreDestroyed };
    });
    return facades;
  });
  const combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE,
    { cellReduction: source.populationScale ? source.populationScale.cellReduction : 1, buildingLayers });
  city.attachCombat(combat);
  const collisionGroup = createPixelUnitCollisionGroup(world), units = [], cooldowns = new Map();
  const airDefense = { missileLaunches: 0, jetLaunches: 0 };
  world.configureDebrisMergeOccupancy(collisionGroup.isOccupied);
  const packs = [
    ['trooper', PIXEL_UNIT_REFERENCE, undefined], ['tank', PIXEL_TANK_REFERENCE, ['move', 'aim']],
    ['hopper', PIXEL_HOPPER_REFERENCE, ['idle', 'jump', 'boost', 'fall']],
    ['jet', PIXEL_JET_REFERENCE, ['fly', 'shoot', 'down']],
  ];
  const artworks = new Map(packs.map(([kind, reference, roles]) =>
    [kind, createPixelUnitArtwork(reference, { roles, cellScale: PIXEL_UNIT_RELATIVE_SCALES[kind],
      cellReduction: source.populationScale ? source.populationScale.cellReduction : 1,
      inPlace: kind === 'hopper' })]));
  let serial = 0, ticks = 0, spawning = false, fighting = false, devices = false;
  function placeScaleTrooper() {
    const art = artworks.get('trooper'), reserved = new Set(city.entries.flatMap((entry) =>
      entry.scenario.plan.map((cell) => cell.y * world.width + cell.x)));
    const tower = city.entries.find((entry) => entry.building.owner === 'left' && entry.building.type === 'population');
    if (!tower) throw new Error('Scale comparison requires a population tower');
    const left = Math.min(...tower.scenario.plan.map((cell) => cell.x));
    const right = Math.max(...tower.scenario.plan.map((cell) => cell.x));
    for (let gap = 8; gap <= 120; gap += 4) for (const x of [right + gap, left - gap - art.width]) {
      if (x < 0 || x + art.width >= world.width) continue;
      const ground = Math.min(...Array.from({ length: art.width }, (_, offset) => world.surfaceRow(x + offset)));
      const y = ground - art.footRow, mask = art.mask('standing', 1);
      if (mask.some((cell) => reserved.has((y + cell.y) * world.width + x + cell.x))) continue;
      let unit;
      try { unit = createPixelTerrainUnit(world, art, { x, y, facing: 1, ownerId: 'left', collisionGroup }); }
      catch (error) {
        if (!/^Unit spawn blocked by|^Unit placement is blocked/.test(error.message)) throw error;
        continue;
      }
      if (unit.inspect().water.wet) { collisionGroup.unregister(unit); continue; }
      combat.register('left-scale-trooper', unit, 'trooper', 'left');
      const entry = { id: 'left-scale-trooper', kind: 'trooper', owner: 'left', unit, base: null,
        scaleReference: true, towerIndex: city.entries.indexOf(tower), debrisDamage: 0, tactic: 'Quarter-size standing scale reference' };
      units.push(entry); return entry;
    }
    throw new Error('No dry clear ground beside a population tower for the native scale trooper');
  }
  const scaleTrooper = source.populationScale ? placeScaleTrooper() : null;
  const bases = city.entries.filter((entry) => entry.building.type === 'military').map((entry) =>
    ({ entry, owner: entry.building.owner, spawned: 0, nextKind: 0, nextSpawn: 0, status: 'Construction pending' }));
  const assaultGoal = (entry) => {
    if (!entry.assaultBase) entry.assaultBase = bases.filter((base) => base.owner !== entry.owner).sort((a, b) =>
      Math.abs(a.entry.building.poles[1] - entry.unit.inspect().x) -
      Math.abs(b.entry.building.poles[1] - entry.unit.inspect().x))[0];
    return entry.assaultBase;
  };
  function coreObjective(base, state) {
    if (!base.entry.scenario.finished || base.entry.scenario.coreDestroyed || !base.entry.scenario.inspectCore) return null;
    const cells = base.entry.scenario.inspectCore().cells.filter((cell) => cell.material === PARTICLE_BARRIER);
    if (!cells.length) return null;
    const middle = state.x + state.width / 2;
    const point = cells.reduce((best, cell) => Math.abs(cell.x - middle) < Math.abs(best.x - middle) ? cell : best);
    return { id: `${base.owner}-core`, core: true, point: { x: point.x, y: point.y },
      state: { x: 0, y: 0, width: 0, height: 0, facing: base.owner === 'right' ? -1 : 1, grounded: true, charges: 0,
        collision: cells.map((cell) => ({ x: cell.x, y: cell.y })) } };
  }
  // Fire blocked only by an enemy building's structure breaches it (and buried-core rubble is dug out) rather than holding fire.
  function breachPath(entry, path, core = null) {
    if (core) {
      const state = entry.unit.inspect({ sprites: false });
      if (Math.abs(core.x - (state.x + state.width / 2)) > PIXEL_CORE_ASSAULT_RANGE) {
        return { clear: false, reason: 'enemy core out of assault range' };
      }
    }
    if (!path || path.clear || !Number.isFinite(path.x) || !Number.isFinite(path.y)) return path;
    const material = world.at(path.x, path.y);
    const building = [PARTICLE_BARRIER, PARTICLE_CONSTRUCTION].includes(material) &&
      (buildingLayers.at(path.x, path.y) || buildingLayers.coreAt(path.x, path.y));
    const buried = core && material === PARTICLE_TERRAIN &&
      Math.hypot(path.x - core.x, path.y - core.y) <= PIXEL_CORE_DIG_RADIUS;
    if (!buried && (!building || building.owner === entry.owner)) return path;
    return { ...path, clear: true, breach: true, reason: `breaching enemy ${path.reason}` };
  }
  const airlift = createPixelTankAirlift(world, units, combat, (entry) => {
    const base = assaultGoal(entry), state = entry.unit.inspect({ sprites: false });
    return base ? Math.sign(base.entry.building.poles[1] - (state.x + state.width / 2)) : entry.owner === 'right' ? -1 : 1;
  }, { combatActive: () => fighting });
  city.enableUpkeep();
  const active = (base) => base.entry.scenario.finished && !base.entry.scenario.coreDestroyed &&
    city.isSupplied(city.entries.indexOf(base.entry));
  const ownedRoads = new Map();
  let roadCacheTick = -1;
  function roadMultiplier(state) {
    if (!state.grounded || state.vy < 0 || state.kind === 'jet' || state.water.wet ||
        state.drowned || state.killed) return 1;
    if (roadCacheTick !== ticks) { roadCacheTick = ticks; ownedRoads.clear(); }
    if (!ownedRoads.has(state.ownerId)) ownedRoads.set(state.ownerId, new Set(city.inspectRoads().filter((road) =>
      city.entries[road.from].building.owner === state.ownerId &&
      city.entries[road.to].building.owner === state.ownerId).flatMap((road) =>
      road.cells.map((cell) => (cell.y + 1) * world.width + cell.x))));
    const owned = ownedRoads.get(state.ownerId);
    const feet = state.y + state.footRow;
    for (let x = state.x; x < state.x + state.width; x += 1) {
      if (!owned.has(feet * world.width + x)) return 1;
    }
    return 1.25;
  }
  function spawn(owner, kind) {
    buildingLayers.refresh();
    const base = bases.find((item) => item.owner === owner), art = artworks.get(kind);
    if (!base || !art) throw new Error('Invalid generated-world spawn faction or unit');
    const reject = (reason) => { base.status = reason; return { ok: false, reason }; };
    if (!base.entry.scenario.finished || base.entry.scenario.coreDestroyed) {
      return reject('Finish the military frame with a living core before spawning.');
    }
    if (!active(base)) return reject('Unit production paused: waiting for SM delivery from a farm.');
    if (base.spawned >= 64 || units.filter((entry) => entry.base === base).length >= 4) {
      return reject('Base limit: four living units and 64 lifetime units.');
    }
    const cost = PIXEL_PRODUCTION_COSTS[kind], baseIndex = city.entries.indexOf(base.entry);
    if (base.entry.scenario.hm < cost.hm) {
      return reject(`Production waiting for HM: ${kind} needs ${cost.hm}, base holds ${base.entry.scenario.hm}.`);
    }
    if (city.buildingSM(baseIndex) < cost.sm) {
      return reject(`Production waiting for SM: ${kind} needs ${cost.sm}, base holds ${city.buildingSM(baseIndex)}.`);
    }
    const center = base.entry.building.poles[1], facing = owner === 'right' ? -1 : 1;
    let reason = 'No clear dry spawn space for the complete native sprite.';
    for (let distance = 32; distance <= 320; distance += 8) for (const direction of [facing, -facing]) {
      const x = center + direction * distance - Math.floor(art.width / 2);
      if (x < 0 || x + art.width >= world.width) continue;
      const ground = Math.min(...Array.from({ length: art.width }, (_, offset) => world.surfaceRow(x + offset)));
      const y = kind === 'jet' ? ground - art.height - 12 : ground - art.footRow;
      if (y < 1 || y + art.height >= world.height) continue;
      const options = { kind, x, y, facing, ownerId: owner, automated: true, assault: kind === 'hopper',
        collisionGroup, speedScale: 1.8, treadRate: 2, forwardLunge: 1.8, groundSpeedMultiplier: roadMultiplier,
        ...buildingLayers.contactOptions(kind, owner) };
      const id = `${owner}-${kind}-${serial + 1}`;
      options.onBuildingImpact = (hit, velocity) => combat.crashUnit(id, hit, velocity);
      let unit;
      try {
        unit = kind === 'trooper' ? createPixelTerrainUnit(world, art, options) : createPixelVehicleUnit(world, art, options);
      } catch (error) {
        if (!/^(Vehicle|Unit) spawn blocked by|^Unit placement is blocked/.test(error.message)) throw error;
        reason = error.message;
        continue;
      }
      if (unit.inspect().water.wet) {
        collisionGroup.unregister(unit);
        reason = 'Native sprite spawn overlaps water.';
        continue;
      }
      serial += 1;
      if (!base.entry.scenario.issueHM(cost.hm) || !city.spendBuildingSM(baseIndex, cost.sm)) {
        throw new Error('Unit production cost changed between check and issue');
      }
      base.issuedHM = (base.issuedHM || 0) + cost.hm; base.issuedSM = (base.issuedSM || 0) + cost.sm;
      combat.register(id, unit, kind, owner);
      const entry = { id, kind, owner, unit, base, homeY: y, tactic: 'Advancing', debrisDamage: 0,
        strategyMemory: { targetId: null, phase: 'seek', until: 0, cooldown: 0, lastShot: 0 } };
      units.push(entry); base.spawned += 1; base.nextKind += 1; base.status = `Issued ${id}`;
      return { ok: true, entry };
    }
    return reject(reason);
  }
  const aim = (unit) => {
    const state = unit.inspect(), pixel = state.pixels[Math.floor(state.pixels.length / 2)];
    return { x: state.x + pixel.x, y: state.y + pixel.y };
  };
  function step() {
    ticks += 1;
    buildingLayers.refresh();
    const falling = new Map(), unitX = new Map();
    const nearest = (candidates, x) => {
      let best = null, distance = Infinity;
      for (const candidate of candidates) {
        const gap = Math.abs(unitX.get(candidate) - x);
        if (gap < distance) { best = candidate; distance = gap; }
      }
      return best;
    };
    for (const entry of units) {
      const state = entry.unit.inspect({ sprites: false }), rows = new Map();
      unitX.set(entry, state.x);
      for (const pixel of state.collision) {
        const x = state.x + pixel.x, y = state.y + pixel.y;
        if (!rows.has(x) || y < rows.get(x)) rows.set(x, y);
      }
      const body = { entry, rows, hits: 0 };
      for (const [x, y] of rows) {
        const key = y * world.width + x;
        if (!falling.has(key)) falling.set(key, []);
        falling.get(key).push(body);
      }
    }
    city.step({ onDebrisMove: (x, y, nx, ny) => {
      for (const body of falling.get(ny * world.width + nx) || []) {
        if (body.hits >= 4 || body.rows.has(x) && y >= body.rows.get(x)) continue;
        body.hits += 1; body.entry.debrisDamage += combat.fallingDebrisDamage(body.entry.id, 5);
      }
    } });
    const shots = combat.inspect({ sprites: false }).shots;
    const airlifted = airlift.step();
    for (let index = units.length - 1; index >= 0; index -= 1) {
      const entry = units[index], state = entry.unit.inspect({ sprites: false });
      if (combat.health(entry.id).health === 0 || state.drowned || state.killed) {
        combat.destroyUnit(entry.id, state.drowned ? 'drowned' : 'destroyed');
        collisionGroup.unregister(entry.unit); combat.unregister(entry.id); units.splice(index, 1); continue;
      }
      if (entry.scaleReference) { entry.unit.step(); continue; }
      if (airlifted.has(entry)) continue;
      const ground = entry.kind === 'trooper' || entry.kind === 'tank';
      const enemies = units.filter((other) => !other.scaleReference && other.owner !== entry.owner);
      const unitTarget = nearest(ground && enemies.some((other) => other.kind !== 'jet') ?
        enemies.filter((other) => other.kind !== 'jet') : enemies, state.x);
      const enemyBase = assaultGoal(entry);
      const core = !unitTarget && enemyBase ? coreObjective(enemyBase, state) : null;
      const target = unitTarget || core;
      const point = unitTarget ? aim(unitTarget.unit) : core && core.point;
      const path = point ? breachPath(entry, combat.firingPath(entry.id, point), core && core.point) : { clear: false };
      const targetState = unitTarget ? unitTarget.unit.inspect({ sprites: false }) : core && core.state;
      const awareness = getPixelCombatAwareness(world, state, entry.owner === 'left' ? 'blue' : 'red', point, shots, path);
      const assaultDirection = enemyBase ? Math.sign(enemyBase.entry.building.poles[1] - (state.x + state.width / 2)) :
        entry.owner === 'right' ? -1 : 1;
      const strategy = entry.kind === 'hopper' ? getPixelHopperStrategy(state,
        target ? { id: target.id, state: targetState } : null,
        entry.strategyMemory, ticks, shots, path, true, assaultDirection) : null;
      const evade = awareness.evade && !(strategy && strategy.acceptRisk);
      let direction = strategy && !evade ? strategy.direction : target ? awareness.direction : entry.owner === 'right' ? -1 : 1;
      entry.tactic = strategy && !evade ? strategy.reason : awareness.reason;
      if (ground && !evade) {
        const engagement = getPixelGroundEngagement(entry.kind, state,
          target && target.kind !== 'jet' ? targetState : null,
          entry.engagement || (entry.engagement = {}), path, direction);
        direction = engagement.direction;
        if (engagement.reason !== 'advancing') entry.tactic = engagement.reason;
      }
      if (entry.kind === 'trooper' && !evade) {
        const roam = getPixelShoreRoam(entry.shoreMemory || (entry.shoreMemory = createPixelShoreMemory(entry.id)),
          state, direction, ticks, state.state === 'waiting at water edge');
        if (roam) { direction = roam.direction; entry.tactic = roam.reason; }
      }
      if (ground) {
        const escape = getPixelBlastEscape(state, combat.wreckThreats());
        if (escape) { direction = escape.direction; entry.tactic = escape.reason; }
      }
      entry.unit.input.right = direction > 0; entry.unit.input.left = direction < 0;
      if (entry.kind === 'jet') {
        updatePixelUnitLabPatrol(entry.unit, world, entry.homeY);
      } else if (entry.kind === 'hopper') {
        entry.unit.input.jump = evade || Boolean(strategy ? strategy.jump : target && !path.clear && ticks % 240 < 2);
        entry.unit.input.boost = evade; entry.unit.input.glide = true;
      }
      if (entry.kind === 'tank') operatePixelTank(entry, combat, fighting ? point : null, direction);
      entry.unit.step();
      if (entry.kind === 'trooper' && entry.unit.inspect({ sprites: false }).state === 'waiting at water edge') {
        entry.tactic = 'Waiting at water edge';
      }
      if (fighting && point && path.clear && !evade && (!strategy || strategy.fire) && combat.health(entry.id).reload <= 1e-8) {
        const shotPoint = unitTarget ? aim(unitTarget.unit) : point;
        const result = breachPath(entry, combat.firingPath(entry.id, shotPoint), core && core.point).clear ? combat.fire(entry.id, shotPoint) :
          { ok: false, reason: 'cover blocks firing path' };
        if (result.ok && entry.kind === 'hopper') entry.strategyMemory.lastAttack = ticks;
        if (!result.ok) entry.tactic = result.reason;
      }
    }
    for (const base of bases) if (spawning && active(base) && ticks >= base.nextSpawn) {
      spawn(base.owner, airlift.needsCarrier(base.owner) ? 'hopper' : packs[base.nextKind % packs.length][0]);
      base.nextSpawn = ticks + 120;
    }
    if (devices) for (const placement of city.inspectMilitary().placements) {
      if (ticks < (cooldowns.get(placement.id) || 0)) continue;
      const owner = city.entries[placement.owner].building.owner;
      const missileDevice = placement.type === 'missile-launcher' || placement.type === 'interceptor';
      const origin = { x: placement.x + 1, y: Math.max(missileDevice ? 6 : 1, placement.y - (missileDevice ? 6 : 2)) };
      const threat = findPixelInterceptorThreat(shots, owner, origin);
      if (placement.type === 'guard' || placement.type === 'turret') {
        const target = units.find((entry) => entry.owner !== owner && unitX.has(entry) &&
          Math.abs(unitX.get(entry) - origin.x) < 100);
        if (!target) continue;
        const result = combat.launch(owner, origin, aim(target.unit), { kind: 'bullet', shooterId: placement.id });
        if (result.ok) cooldowns.set(placement.id, ticks + 24);
      } else if (placement.type === 'interceptor') {
        // Missiles first (960 range); otherwise hunt a hostile jet inside the 240 anti-air radius.
        const jet = threat ? null : findPixelAntiAirTarget(units, shots, owner, origin);
        if (!threat && !jet) continue;
        const ammo = PIXEL_PRODUCTION_COSTS.interceptor.hm, scenario = city.entries[placement.owner].scenario;
        if (scenario.hm < ammo) { cooldowns.set(placement.id, ticks + 60); continue; }
        const result = threat ? combat.launch(owner, origin, threat, { targetShotId: threat.id, shooterId: placement.id }) :
          combat.launch(owner, origin, jet.point, { targetUnitId: jet.entry.id, shooterId: placement.id });
        if (result.ok) {
          scenario.issueHM(ammo); cooldowns.set(placement.id, ticks + 90);
          airDefense[threat ? 'missileLaunches' : 'jetLaunches'] += 1;
        }
      } else {
        const opposing = owner === 'left' ? 'right' : owner === 'right' ? 'left' : null;
        const enemy = city.entries.filter((entry) => entry.building.owner !== owner &&
          (!opposing || entry.building.owner === opposing) && entry.scenario.finished &&
          !entry.scenario.coreDestroyed).sort((a, b) =>
            Math.abs(a.seedPlacement[0].x - origin.x) - Math.abs(b.seedPlacement[0].x - origin.x))[0];
        if (!enemy) continue;
        const cell = enemy.scenario.plan.find((cell) => cell.y < enemy.seedPlacement[0].groundY &&
          world.at(cell.x, cell.y) === PARTICLE_BARRIER);
        if (!cell || placement.type !== 'missile-launcher') continue;
        const ammo = PIXEL_PRODUCTION_COSTS['missile-launcher'].hm, scenario = city.entries[placement.owner].scenario;
        const base = bases.find((item) => item.entry === city.entries[placement.owner]);
        if (scenario.hm < ammo) {
          cooldowns.set(placement.id, ticks + 60);
          if (base) base.status = `Missile waiting for HM: needs ${ammo}, base holds ${scenario.hm}.`;
          continue;
        }
        const result = combat.launch(owner, origin, cell, { shooterId: placement.id });
        if (result.ok) scenario.issueHM(ammo);
        cooldowns.set(placement.id, ticks + (result.ok ? 180 : 60));
        if (!result.ok && base) base.status = result.reason;
      }
    }
    combat.step();
    city.verify();
  }
  return { combat, airlift, units, bases, styles, generation, spawn, step, aim, scaleTrooper, artworks, buildingLayers, airDefense,
    configure(options) {
      for (const value of Object.values(options)) if (typeof value !== 'boolean') throw new Error('Invalid generated combat controls');
      spawning = options.spawning; fighting = options.fighting; devices = options.devices;
    },
    get ticks() { return ticks; } };
}
