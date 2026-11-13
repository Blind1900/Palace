const pixelConstructionReservations = new WeakMap();

function createPixelConstructionWorld(width = 160, supportCapacity = 128) {
  const world = createParticleWorld(width, 90, { skipEmptyRows: true, supportCapacity });
  for (let y = 75; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) world.set(x, y, PARTICLE_TERRAIN);
  }
  for (let y = 65; y < 75; y += 1) {
    for (let x = 8; x < 30; x += 1) world.set(x, y, PARTICLE_WATER);
    world.set(7, y, PARTICLE_TERRAIN); world.set(30, y, PARTICLE_TERRAIN);
  }
  return world;
}

function createPixelConstructionScenario(rows = 9, options = {}) {
  if (![5, 9, 11].includes(rows)) throw new Error('Invalid pixel construction height');
  if (!options || (options.poleOffset !== undefined && !Number.isInteger(options.poleOffset)) ||
      (options.deliveryMode !== undefined && !['outside', 'inside'].includes(options.deliveryMode)) ||
      (options.buriedCore !== undefined && typeof options.buriedCore !== 'boolean') ||
      (options.layout !== undefined && !['standard', 'narrow-left', 'narrow-right'].includes(options.layout))) {
    throw new Error('Invalid pixel construction placement');
  }
  const world = options.world || createPixelConstructionWorld();
  const initialHM = options.initialHM === undefined ? 1000 : options.initialHM;
  if (!Number.isInteger(initialHM) || initialHM < 0) throw new Error('Invalid initial construction HM stockpile');
  const paidGrowth = options.paidGrowth === true;
  const deliveryMode = options.deliveryMode || 'outside', insideDelivery = deliveryMode === 'inside';
  const buriedCore = options.buriedCore === true;
  // Builder pacing: carrier cap, ticks per carrier step and ticks between delivery checks.
  const crew = options.crew === undefined ? 6 : options.crew;
  const stride = options.stride === undefined ? 3 : options.stride;
  const deliveryInterval = options.deliveryInterval === undefined ? 60 : options.deliveryInterval;
  if (![crew, stride, deliveryInterval].every((value) => Number.isInteger(value) && value >= 1)) {
    throw new Error('Invalid construction crew pacing');
  }
  const geometry = options.geometry;
  if (geometry && (!buriedCore || !insideDelivery || !Array.isArray(geometry.poles) ||
      geometry.poles.length < 1 || geometry.poles.length > 5 ||
      geometry.poles.some((pole, index) => !Number.isInteger(pole) ||
        index > 0 && pole - geometry.poles[index - 1] < 6) ||
      !Array.isArray(geometry.frameCells) || !Array.isArray(geometry.seeds) ||
      geometry.seeds.length !== geometry.poles.length * 3)) {
    throw new Error('Invalid adaptive construction geometry');
  }
  const coreCount = geometry ? geometry.poles.length : 3;
  const foundationRows = options.foundationRows === undefined ? [75, 75, 75] : options.foundationRows;
  if (!Array.isArray(foundationRows) || foundationRows.length !== coreCount ||
      !foundationRows.every((row) => Number.isInteger(row) && row >= rows * 4 &&
        row <= world.height - (buriedCore ? 4 : 3))) {
    throw new Error('Invalid pixel foundation rows');
  }
  const groundRows = foundationRows.slice();
  const deliveryRows = options.deliveryRows === undefined
    ? groundRows.flatMap((row) => [row - 1, row - 1]) : options.deliveryRows;
  if (!Array.isArray(deliveryRows) || deliveryRows.length !== coreCount * 2 ||
      !deliveryRows.every((row) => Number.isInteger(row) && row >= 0 && row < world.height)) {
    throw new Error('Invalid pixel delivery rows');
  }
  const scale = 4, surfaceRow = Math.min(...groundRows), top = surfaceRow - rows * 4;
  const layout = options.layout || 'standard';
  const middlePole = layout === 'narrow-left' ? 72 : layout === 'narrow-right' ? 88 : 80;
  const poles = geometry ? geometry.poles.slice() :
    [60, middlePole, 100].map((x) => x + (options.poleOffset || 0));
  const lastPole = poles[poles.length - 1], initialCore = Math.floor((poles.length - 1) / 2);
  const frameLeft = geometry && geometry.bounds ? geometry.bounds.left : poles[0];
  const frameRight = geometry && geometry.bounds ? geometry.bounds.right : lastPole + 2;
  if (!Number.isInteger(frameLeft) || !Number.isInteger(frameRight) || frameLeft < 3 ||
      frameRight + 3 >= world.width || frameLeft > poles[0] || frameRight < lastPole + 2) {
    throw new Error('Invalid adaptive frame bounds');
  }
  const plan = new Map(), agents = [];
  const coreCells = buriedCore ? poles.flatMap((pole, index) => [0, 1, 2].flatMap((dx) =>
    [0, 1, 2].map((dy) => ({ x: pole + dx, y: groundRows[index] + dy })))) : [];
  const coreKeys = new Set(coreCells.map((cell) => cell.y * world.width + cell.x));
  const foundationCells = options.foundationCells === undefined ? [] : options.foundationCells;
  if (!Array.isArray(foundationCells) || (foundationCells.length && !buriedCore) ||
      foundationCells.some((cell) => !cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) ||
        cell.x < frameLeft || cell.x > frameRight || cell.y < (geometry ? 0 : surfaceRow) || cell.y >= world.height - 1) ||
      new Set(foundationCells.map((cell) => cell.y * world.width + cell.x)).size !== foundationCells.length ||
      foundationCells.some((cell) => coreKeys.has(cell.y * world.width + cell.x))) {
    throw new Error('Invalid connecting foundation cells');
  }
  const extraFoundation = foundationCells.map((cell) => ({ x: cell.x, y: cell.y }));
  const extraKeys = new Set(extraFoundation.map((cell) => cell.y * world.width + cell.x));
  if (world.height < 90 || poles[0] - 3 < 0 || lastPole + 5 >= world.width) {
    throw new Error('Pixel construction placement exceeds world bounds');
  }
  const key = (x, y) => y * world.width + x;
  const neighbors = (x, y) => [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]]
    .filter(([nx, ny]) => nx >= 0 && nx < world.width && ny >= 0 && ny < world.height);
  function add(x, y) { plan.set(key(x, y), { x, y, distance: Infinity }); }
  if (geometry) {
    for (const cell of [...geometry.frameCells, ...geometry.seeds, ...coreCells]) {
      if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < frameLeft ||
          cell.x > frameRight || cell.y < 0 || cell.y >= world.height) {
        throw new Error('Invalid adaptive frame cell');
      }
      add(cell.x, cell.y);
    }
  } else {
  for (const [index, pole] of poles.entries()) {
    for (let y = top; y < groundRows[index] + (buriedCore ? 3 : 0); y += 1) {
      for (let dx = 0; dx < 3; dx += 1) add(pole + dx, y);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    if (row !== 0 && row !== rows - 1 && row % 3 !== 0) continue;
    for (let x = poles[0]; x <= lastPole + 2; x += 1) add(x, top + row * 4 + 2);
  }
  }
  if (extraFoundation.some((cell) => plan.has(key(cell.x, cell.y)))) {
    throw new Error('Connecting foundation overlaps existing building plan');
  }
  for (const cell of extraFoundation) add(cell.x, cell.y);
  const coreDelivery = buriedCore && insideDelivery;
  const sources = coreDelivery ? poles.flatMap((pole, index) =>
    [0, 1].map(() => ({ x: pole + 1, y: groundRows[index] + 1 }))) :
    (buriedCore ? [poles[0] + 3, poles[0] + 5, poles[1] - 3,
    poles[1] + 5, poles[2] - 3, poles[2] - 1] : poles.flatMap((x) => [x - 3, x + 5]))
    .map((x, index) => ({ x, y: deliveryRows[index] }));
  function deliverySources() {
    if (!coreDelivery) return sources;
    return sources.map((source, index) => {
      if (world.at(source.x, source.y) === PARTICLE_BARRIER) return source;
      const replacement = coreCells.slice(Math.floor(index / 2) * 9, Math.floor(index / 2) * 9 + 9)
        .find((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER);
      return replacement || source;
    });
  }
  function sourceReady(source) {
    return world.at(source.x, source.y) === (coreDelivery ? PARTICLE_BARRIER : PARTICLE_EMPTY);
  }
  const reserved = pixelConstructionReservations.get(world) || new Set();
  const placement = [...plan.values(), ...sources];
  if (placement.some((cell) => reserved.has(key(cell.x, cell.y)))) {
    throw new Error('Pixel construction plans or delivery points overlap');
  }
  if (placement.some((cell) => extraKeys.has(key(cell.x, cell.y))
      ? ![PARTICLE_TERRAIN, PARTICLE_EMPTY].includes(world.at(cell.x, cell.y)) : world.at(cell.x, cell.y) !==
      (coreKeys.has(key(cell.x, cell.y)) ? PARTICLE_TERRAIN : PARTICLE_EMPTY)) ||
      poles.some((pole, index) => [0, 1, 2].some((dx) =>
        world.at(pole + dx, groundRows[index] + (buriedCore ? 3 : 0)) !== PARTICLE_TERRAIN))) {
    throw new Error('Pixel construction requires clear sites and terrain beneath every free seed');
  }
  const preparedFoundation = [...coreCells, ...extraFoundation].sort((a, b) => b.y - a.y);
  const preparedKeys = new Set(preparedFoundation.map((cell) => key(cell.x, cell.y))), supportedKeys = new Set();
  for (const cell of preparedFoundation) {
    if (!neighbors(cell.x, cell.y).some(([x, y]) => supportedKeys.has(key(x, y)) ||
        !preparedKeys.has(key(x, y)) && [PARTICLE_TERRAIN, PARTICLE_BARRIER].includes(world.at(x, y)))) {
      throw new Error('Connecting foundation requires supported cells');
    }
    supportedKeys.add(key(cell.x, cell.y));
  }
  for (const cell of placement) reserved.add(key(cell.x, cell.y));
  pixelConstructionReservations.set(world, reserved);
  if (buriedCore) {
    for (const cell of [...coreCells, ...extraFoundation]) {
      if (world.at(cell.x, cell.y) === PARTICLE_TERRAIN) world.excavate(cell.x, cell.y, cell.x, cell.y);
    }
    for (const cell of preparedFoundation) {
      if (!world.emitConstruction(cell.x, cell.y).ok || !world.settleConstruction(cell.x, cell.y).ok) {
        throw new Error('Buried core could not be constructed');
      }
    }
  }
  const queue = [];
  const seeds = geometry ? geometry.seeds : poles.flatMap((pole, index) =>
    [0, 1, 2].map((dx) => ({ x: pole + dx, y: groundRows[index] - 1 })));
  for (const seed of seeds) {
      const cell = plan.get(key(seed.x, seed.y));
      if (!world.emitConstruction(cell.x, cell.y).ok || !world.settleConstruction(cell.x, cell.y).ok) {
        throw new Error('Pixel foundation could not be constructed');
      }
      cell.distance = 0; queue.push(cell);
  }
  for (const cell of [...coreCells, ...extraFoundation]) {
    const planned = plan.get(key(cell.x, cell.y));
    planned.distance = 0; queue.push(planned);
  }
  for (let i = 0; i < queue.length; i += 1) {
    for (const [x, y] of neighbors(queue[i].x, queue[i].y)) {
      const cell = plan.get(key(x, y));
      if (!cell || cell.distance !== Infinity) continue;
      cell.distance = queue[i].distance + 1; queue.push(cell);
    }
  }
  if (queue.length !== plan.size) throw new Error('Disconnected pixel construction plan');
  let maxDistance = Math.max(...queue.map((cell) => cell.distance));
  let ticks = 0, hm = initialHM, spent = 0, finished = false, message = 'Revealing branching blueprint';
  let deliveryChecks = 0, productiveChecks = 0, lastDeliveryTick = null, completedTick = null;
  let coreDestroyed = false;
  let growth = null, grownMaterial = 0, coreFormed = false, received = 0, growthPaid = 0, issued = 0;
  function survivingCore() { return coreCells.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER).length; }
  function checkCore() {
    if (buriedCore && (!growth || coreFormed) && !coreDestroyed && survivingCore() === 0) {
      coreDestroyed = true;
      for (const agent of agents) { agent.target = null; agent.path = []; }
      message = 'All buried cores destroyed; construction and repair permanently disabled';
    }
  }
  function growFoundation() {
    if (!growth || growth.complete || ticks % 2 !== 0) return;
    const event = growth.events[growth.index];
    const pending = event.cells.filter((cell) => !growth.placed.has(key(cell.x, cell.y)));
    const cell = pending[0];
    if (cell && ![PARTICLE_EMPTY, PARTICLE_TERRAIN].includes(world.at(cell.x, cell.y))) {
      growth.blocked = 'occupied foundation site'; message = 'Seed growth waiting: water or debris blocks foundation'; return;
    }
    if (cell) {
      if (!supported(cell)) {
        growth.blocked = 'missing support'; message = 'Seed growth waiting: foundation needs support'; return;
      }
      if (paidGrowth && hm < 1) {
        growth.blocked = 'waiting for HM'; message = 'Seed growth waiting: HM delivery'; return;
      }
      if (world.at(cell.x, cell.y) === PARTICLE_TERRAIN) world.excavate(cell.x, cell.y, cell.x, cell.y);
      if (paidGrowth) { hm -= 1; growthPaid += 1; }
      if (!world.emitConstruction(cell.x, cell.y).ok || !world.settleConstruction(cell.x, cell.y).ok) {
        throw new Error('Seed foundation growth could not settle supported material');
      }
      growth.placed.add(key(cell.x, cell.y)); grownMaterial += 1;
      if (coreKeys.has(key(cell.x, cell.y))) coreFormed = true;
    }
    for (const ground of event.excavate) {
      if (!event.cells.some((part) => part.x === ground.x && !growth.placed.has(key(part.x, part.y))) &&
          world.at(ground.x, ground.y) === PARTICLE_TERRAIN) {
        world.excavate(ground.x, ground.y, ground.x, ground.y);
        growth.excavated.add(key(ground.x, ground.y));
      }
    }
    growth.blocked = null;
    if (pending.length <= 1) growth.index += 1;
    growth.complete = growth.index === growth.events.length;
    message = growth.complete ? 'Seed foundation grown; revealing paid construction blueprint' : `Seed growth: ${event.phase}`;
  }
  function blastAt(x, y, radius) {
    let removed = world.blast(x, y, radius);
    if (insideDelivery) {
      for (let i = agents.length - 1; i >= 0; i -= 1) {
        if ((agents[i].x - x) ** 2 + (agents[i].y - y) ** 2 > radius ** 2) continue;
        agents.splice(i, 1); removed += 1;
      }
    }
    checkCore();
    return removed;
  }
  function supported(cell) {
    return neighbors(cell.x, cell.y).some(([x, y]) => {
      const material = world.at(x, y);
      return material === PARTICLE_BARRIER || material === PARTICLE_TERRAIN;
    });
  }
  function onOutline(x, y) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= world.width ||
            y + dy < 0 || y + dy >= world.height) continue;
        const material = world.at(x + dx, y + dy);
        if (material === PARTICLE_BARRIER || material === PARTICLE_TERRAIN) return true;
      }
    }
    return false;
  }
  function passable(x, y, target) {
    const material = world.at(x, y);
    if (!insideDelivery) return material === PARTICLE_EMPTY && onOutline(x, y);
    if (material === PARTICLE_BARRIER) return true;
    if (material !== PARTICLE_EMPTY) return false;
    if (target && x === target.x && y === target.y) return onOutline(x, y);
    // Ground access leads onto solid building cells, not up their outside edges.
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (x + dx >= 0 && x + dx < world.width && y + dy >= 0 && y + dy < world.height &&
            world.at(x + dx, y + dy) === PARTICLE_TERRAIN) return true;
      }
    }
    return false;
  }
  function retained(agent) { return insideDelivery || world.at(agent.x, agent.y) === PARTICLE_CONSTRUCTION; }
  function pathFrom(source, target) {
    if (insideDelivery && !passable(source.x, source.y, source)) return null;
    const start = key(source.x, source.y), end = key(target.x, target.y);
    const previous = new Map([[start, start]]);
    const search = [start];
    for (let i = 0; i < search.length; i += 1) {
      const cell = search[i];
      if (cell === end) {
        const path = [];
        for (let at = end; at !== start; at = previous.get(at)) {
          path.push({ x: at % world.width, y: Math.floor(at / world.width) });
        }
        return path.reverse();
      }
      for (const [x, y] of neighbors(cell % world.width, Math.floor(cell / world.width))) {
        const next = key(x, y);
        if (previous.has(next) || !passable(x, y, target)) continue;
        previous.set(next, cell); search.push(next);
      }
    }
    return null;
  }
  function currentLayer() {
    const unfinished = queue.filter((cell) => world.at(cell.x, cell.y) !== PARTICLE_BARRIER);
    const distance = unfinished.length ? Math.min(...unfinished.map((cell) => cell.distance)) : Infinity;
    return unfinished.filter((cell) => cell.distance === distance);
  }
  function frontier() {
    const reserved = new Set(agents.filter((agent) => agent.target).map((agent) => key(agent.target.x, agent.target.y)));
    return currentLayer().filter((cell) => world.at(cell.x, cell.y) === PARTICLE_EMPTY &&
      !reserved.has(key(cell.x, cell.y)) && supported(cell));
  }
  function assign(agent) {
    const available = frontier();
    let nearest = null;
    for (const cell of available) {
      const path = pathFrom(agent, cell);
      if (!path) continue;
      if (!insideDelivery) { agent.target = cell; agent.path = path; return true; }
      if (!nearest || path.length < nearest.path.length) nearest = { cell, path };
    }
    if (nearest) { agent.target = nearest.cell; agent.path = nearest.path; return true; }
    return false;
  }
  function validTarget(agent, layer) {
    return agent.target && layer.includes(agent.target) && supported(agent.target) &&
      (world.at(agent.target.x, agent.target.y) === PARTICLE_EMPTY ||
        (!insideDelivery && agent.x === agent.target.x && agent.y === agent.target.y &&
          world.at(agent.x, agent.y) === PARTICLE_CONSTRUCTION));
  }
  function makeRoom(agent) {
    const next = neighbors(agent.x, agent.y).find(([x, y]) =>
      world.at(x, y) === PARTICLE_EMPTY && !plan.has(key(x, y)) && onOutline(x, y));
    if (!next) return;
    const result = world.moveConstruction(agent.x, agent.y, next[0], next[1]);
    if (result.ok) { agent.x = next[0]; agent.y = next[1]; agent.target = null; agent.path = []; }
  }
  function moveAgents() {
    const layer = currentLayer();
    // Release all stale reservations before any agent chooses a replacement.
    for (let i = agents.length - 1; i >= 0; i -= 1) {
      const agent = agents[i];
      if (!retained(agent)) { agents.splice(i, 1); continue; }
      if (agent.target && !validTarget(agent, layer)) { agent.target = null; agent.path = []; }
    }
    for (let i = agents.length - 1; i >= 0; i -= 1) {
      const agent = agents[i];
      if (insideDelivery) {
        if (!passable(agent.x, agent.y, agent)) continue;
        if (!agent.target && !assign(agent)) continue;
        if (agent.path.length) {
          const next = agent.path[0];
          if (!passable(next.x, next.y, agent.target)) {
            agent.path = pathFrom(agent, agent.target);
            if (!agent.path) { agent.target = null; agent.path = []; }
            continue;
          }
          agent.x = next.x; agent.y = next.y; agent.path.shift();
        }
        if (!agent.path.length && validTarget(agent, currentLayer())) {
          const emitted = world.emitConstruction(agent.x, agent.y);
          if (!emitted.ok) throw new Error(`Inside delivery settlement failed: ${emitted.reason}`);
          const settled = world.settleConstruction(agent.x, agent.y);
          if (!settled.ok) throw new Error(`Inside delivery support changed during settlement: ${settled.reason}`);
          agents.splice(i, 1);
        }
        continue;
      }
      if (!agent.target && !assign(agent)) { makeRoom(agent); continue; }
      if (agent.path.length) {
        const next = agent.path[0];
        const result = onOutline(next.x, next.y)
          ? world.moveConstruction(agent.x, agent.y, next.x, next.y)
          : { ok: false, reason: 'lost outline' };
        if (!result.ok) {
          agent.path = pathFrom(agent, agent.target);
          if (!agent.path) { agent.target = null; agent.path = []; makeRoom(agent); }
          else if (agent.path.length) {
            const detour = agent.path.shift();
            const moved = world.moveConstruction(agent.x, agent.y, detour.x, detour.y);
            if (!moved.ok) throw new Error('Construction detour became occupied during movement');
            agent.x = detour.x; agent.y = detour.y;
          }
          continue;
        }
        agent.x = next.x; agent.y = next.y; agent.path.shift();
      }
      if (!agent.path.length) {
        const result = world.settleConstruction(agent.x, agent.y);
        if (result.ok) agents.splice(i, 1);
        else { agent.target = null; agent.path = []; }
      }
    }
  }
  return {
    world, scale, rows, surfaceRow, layout, deliveryMode, plan: queue,
    extendStructure(cells, extension = null) {
      if (!buriedCore || !insideDelivery || !finished || coreDestroyed) {
        throw new Error('Building expansion requires a completed, living buried-core structure');
      }
      const additions = new Map();
      const free = extension ? extension.freeCells : [];
      const freeKeys = new Set(free.map((cell) => key(cell.x, cell.y)));
      for (const cell of [...cells, ...free]) {
        if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 ||
            cell.x >= world.width || cell.y < 0 || cell.y >= world.height) throw new Error('Invalid building expansion cell');
        const id = key(cell.x, cell.y);
        if (plan.has(id)) continue;
        if (reserved.has(id) || !(freeKeys.has(id) ? [PARTICLE_EMPTY, PARTICLE_TERRAIN] : [PARTICLE_EMPTY])
          .includes(world.at(cell.x, cell.y))) {
          throw new Error('Building expansion requires clear, unreserved cells');
        }
        additions.set(id, { x: cell.x, y: cell.y, distance: Infinity });
      }
      const pending = [...queue];
      for (let i = 0; i < pending.length; i += 1) {
        for (const [x, y] of neighbors(pending[i].x, pending[i].y)) {
          const cell = additions.get(key(x, y));
          if (!cell || cell.distance !== Infinity) continue;
          cell.distance = pending[i].distance + 1; pending.push(cell);
        }
      }
      if ([...additions.values()].some((cell) => cell.distance === Infinity)) {
        throw new Error('Building expansion must connect to the existing frame');
      }
      if (extension && (!growth || !growth.complete || extension.pole <= poles[poles.length - 1] + 5)) {
        throw new Error('Core expansion requires completed growth and an outward descendant site');
      }
      for (const [id, cell] of additions) { plan.set(id, cell); reserved.add(id); queue.push(cell); }
      if (extension) {
        const parent = poles.length - 1;
        poles.push(extension.pole); groundRows.push(extension.groundY);
        const newCore = extension.coreCells.map((cell) => ({ ...cell }));
        coreCells.push(...newCore); newCore.forEach((cell) => coreKeys.add(key(cell.x, cell.y)));
        seeds.push(...extension.seeds);
        const extras = free.filter((cell) => !newCore.some((core) => key(core.x, core.y) === key(cell.x, cell.y)) &&
          !extension.seeds.some((seed) => key(seed.x, seed.y) === key(cell.x, cell.y)));
        extraFoundation.push(...extras); extras.forEach((cell) => extraKeys.add(key(cell.x, cell.y)));
        sources.push(...[0, 1].map(() => ({ x: extension.pole + 1, y: extension.groundY + 1 })));
        const coreIndex = poles.length - 1;
        growth.parents.push(parent);
        for (const x of [...new Set(free.map((cell) => cell.x))].sort((a, b) => a - b)) {
          const cells = free.filter((cell) => cell.x === x && !growth.placed.has(key(cell.x, cell.y)))
            .sort((a, b) => b.y - a.y);
          cells.forEach((cell) => { plan.get(key(cell.x, cell.y)).distance = 0; });
          growth.events.push({ phase: `level-up branch from core ${parent + 1} toward core ${coreIndex + 1}`,
            cells, excavate: extension.basementCells.filter((cell) => cell.x === x) });
        }
        growth.excavationTotal += extension.basementCells.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_TERRAIN).length;
        growth.complete = false;
      }
      maxDistance = Math.max(...queue.map((cell) => cell.distance));
      finished = false; completedTick = null;
      message = additions.size ? 'Level-up frame expanding through paid repair delivery' :
        'Repairing damaged frame through paid repair delivery';
      return additions.size;
    },
    get freeMaterial() { return growth ? grownMaterial : seeds.length + coreCells.length + extraFoundation.length; },
    get foundationGrowth() {
      return { enabled: Boolean(growth), complete: !growth || growth.complete,
        phase: !growth ? 'instant foundation' : growth.complete ? 'complete' :
          growth.events[growth.index].phase, blocked: growth ? growth.blocked : null,
        placed: growth ? grownMaterial : seeds.length + coreCells.length + extraFoundation.length,
        total: seeds.length + coreCells.length + extraFoundation.length };
    },
    inspectFoundationGrowth() {
      const event = growth && !growth.complete ? growth.events[growth.index] : null;
      const cell = event ? event.cells.find((part) => !growth.placed.has(key(part.x, part.y))) : null;
      const material = cell ? world.at(cell.x, cell.y) : null;
      const blocker = cell && !coreDestroyed
        ? ![PARTICLE_EMPTY, PARTICLE_TERRAIN].includes(material) ? { ...cell, material, reason: 'occupied material' }
          : !supported(cell) ? { ...cell, material, reason: 'missing support' } : null
        : null;
      return {
        tick: ticks, enabled: Boolean(growth), complete: !growth || growth.complete, stopped: coreDestroyed,
        next: cell && !coreDestroyed ? { ...cell, material } : null, blocker,
        cores: poles.map((pole, index) => {
          const cells = coreCells.slice(index * 9, index * 9 + 9);
          const formed = growth ? cells.filter((part) => growth.placed.has(key(part.x, part.y))) : cells;
          return { x: pole, parent: growth ? growth.parents[index] : null, formed: formed.length, pending: cells.length - formed.length,
            surviving: cells.filter((part) => world.at(part.x, part.y) === PARTICLE_BARRIER).length };
        }),
        excavation: { removed: growth ? growth.excavated.size : 0,
          total: growth ? growth.excavationTotal : 0 },
      };
    },
    startFoundationGrowth(basementCells) {
      if (!buriedCore || !insideDelivery || ticks !== 0 || growth ||
          coreCells.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_TERRAIN)) {
        throw new Error('Seed foundation growth requires untouched buried-core terrain before simulation');
      }
      const free = queue.filter((cell) => cell.distance === 0);
      const claimed = new Set(), events = [];
      const event = (phase, cells, excavate = []) => {
        const unique = cells.filter((cell) => !claimed.has(key(cell.x, cell.y)))
          .sort((a, b) => b.y - a.y || a.x - b.x);
        unique.forEach((cell) => claimed.add(key(cell.x, cell.y)));
        if (unique.length || excavate.length) events.push({ phase, cells: unique, excavate });
      };
      const firstPole = poles[initialCore];
      event('middle core forming', coreCells.slice(initialCore * 9, initialCore * 9 + 9));
      event('middle pillar extending to floors', extraFoundation.filter((cell) =>
        cell.x >= firstPole && cell.x <= firstPole + 2));
      const parents = poles.map(() => null);
      if (geometry) {
        if (poles.length === 1) {
          for (let distance = 1; distance <= Math.max(firstPole - frameLeft, frameRight - firstPole - 2); distance += 1) {
            for (const x of [firstPole - distance, firstPole + 2 + distance]) {
              event('farm floors branching outward', extraFoundation.filter((cell) => cell.x === x),
                basementCells.filter((cell) => cell.x === x));
            }
          }
        }
        for (let distance = 1; distance < poles.length; distance += 1) {
          for (const index of [initialCore - distance, initialCore + distance]) {
            if (index < 0 || index >= poles.length) continue;
            const parent = index < initialCore ? index + 1 : index - 1;
            parents[index] = parent;
            const direction = index < parent ? -1 : 1;
            const start = direction < 0 ? poles[parent] - 1 : poles[parent] + 3;
            const end = direction < 0 ? poles[index] : poles[index] + 2;
            for (let x = start; direction < 0 ? x >= end : x <= end; x += direction) {
              event(`branching from core ${parent + 1} toward core ${index + 1}`,
                extraFoundation.filter((cell) => cell.x === x), basementCells.filter((cell) => cell.x === x));
            }
            event(`descendant core ${index + 1} forming from core ${parent + 1}`,
              coreCells.slice(index * 9, index * 9 + 9));
          }
        }
      } else {
      for (let distance = 0; distance <= Math.max(firstPole - poles[0], lastPole - firstPole) + 2; distance += 1) {
        const columns = new Set([firstPole - distance, firstPole + 2 + distance]);
        event('floors branching outward', extraFoundation.filter((cell) => columns.has(cell.x)),
          basementCells.filter((cell) => columns.has(cell.x)));
      }
      event('adjacent cores forming', coreCells.filter((cell) => cell.x < firstPole || cell.x > firstPole + 2));
      }
      event('surface pillar seeds forming', free);
      if (claimed.size !== free.length) throw new Error('Seed growth does not cover the complete foundation');
      growth = { events, index: 0, placed: new Set(), complete: false, blocked: null,
        parents,
        excavated: new Set(), excavationTotal: basementCells.filter((cell) =>
          world.at(cell.x, cell.y) === PARTICLE_TERRAIN).length };
      message = 'Seed dropped; middle core will form first';
    },
    get foundationCells() { return extraFoundation.map((cell) => ({ ...cell })); },
    get coreDestroyed() { return coreDestroyed; },
    inspectCore() {
      return { enabled: buriedCore, destroyed: coreDestroyed, surviving: survivingCore(), total: coreCells.length,
        cells: coreCells.map((cell) => ({ ...cell, material: world.at(cell.x, cell.y) })) };
    },
    inspectSources() {
      return deliverySources().map((source) => ({ ...source,
        material: world.at(source.x, source.y), ready: !coreDestroyed && !finished &&
          (!growth || growth.complete) && sourceReady(source) }));
    },
    get transportedMaterialCount() { return insideDelivery ? agents.length : 0; },
    get initialHM() { return initialHM; },
    get hm() { return hm; }, get spent() { return spent; },
    get received() { return received; }, get growthPaid() { return growthPaid; },
    get paidGrowth() { return paidGrowth; }, get issued() { return issued; },
    // HM drawn for unit production and missile/interceptor ammunition rather than frame construction.
    issueHM(amount) {
      if (!Number.isInteger(amount) || amount < 0) throw new Error('Invalid HM issue');
      if (hm < amount) return false;
      hm -= amount; issued += amount; return true;
    },
    receiveHM(amount) {
      if (!Number.isInteger(amount) || amount < 0) throw new Error('Invalid HM delivery');
      hm += amount; received += amount; return hm;
    },
    get ticks() { return ticks; }, get finished() { return finished; },
    get deliveryStats() {
      const elapsedTicks = Math.max(0, (completedTick === null ? ticks : completedTick) - 240);
      return { elapsedTicks, deliveryChecks, productiveChecks, lastDeliveryTick, completedTick,
        paidPixels: spent, pixelsPerMinute: elapsedTicks ? spent * 3600 / elapsedTicks : 0 };
    },
    get deliveries() { return agents.map((agent) => ({ x: agent.x, y: agent.y,
      target: agent.target ? { ...agent.target } : null, path: agent.path.map((cell) => ({ ...cell })) })); },
    get message() { return message; },
    inspectTerrain() {
      const foundationGround = poles.flatMap((pole, index) => [0, 1, 2].map((dx) =>
        ({ x: pole + dx, y: groundRows[index], material: world.at(pole + dx, groundRows[index]) })));
      const names = ['empty', 'terrain', 'water', 'settled building', 'fallen debris', 'moving material'];
      const counts = new Map();
      for (const cell of foundationGround) counts.set(cell.material, (counts.get(cell.material) || 0) + 1);
      return {
        planTerrain: queue.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_TERRAIN)
          .map((cell) => ({ x: cell.x, y: cell.y })),
        foundationTerrain: counts.get(PARTICLE_TERRAIN) || 0,
        foundationGround,
        foundationDescription: Array.from(counts, ([material, count]) => `${count} ${names[material]}`).join(', '),
        blockedDeliveries: deliverySources().filter((cell) => !sourceReady(cell))
          .map((cell) => ({ x: cell.x, y: cell.y, material: world.at(cell.x, cell.y) })),
      };
    },
    inspectRecovery() {
      const layer = currentLayer(), available = frontier();
      function findRoute(source, candidates) {
        let nearest = null;
        for (const target of candidates) {
          const path = pathFrom(source, target);
          if (!path) continue;
          const route = { target: { x: target.x, y: target.y }, steps: path.length };
          if (!insideDelivery) return route;
          if (!nearest || route.steps < nearest.steps) nearest = route;
        }
        return nearest;
      }
      const phase = coreDestroyed ? 'core destroyed' : growth && !growth.complete ? 'seed growth' :
        finished ? 'complete' : ticks <= 240 ? 'revealing' : 'constructing';
      return {
        tick: ticks,
        phase,
        hm, agentSlots: Math.max(0, crew - agents.length),
        sources: deliverySources().map((source) => {
          const material = world.at(source.x, source.y);
          const route = phase === 'constructing' && sourceReady(source)
            ? findRoute(source, available) : null;
          const state = phase !== 'constructing' ? phase :
            !sourceReady(source) ? (coreDelivery ? 'core source destroyed' : 'occupied') :
              hm < 1 ? 'waiting for HM' : agents.length >= crew ? 'agent limit reached' :
                route ? 'ready for next delivery check' :
                  available.length ? 'no route to eligible sites' : 'no eligible sites';
          return { ...source, material, state, route };
        }),
        agents: agents.filter(retained).map((agent) => {
          const candidates = [...available];
          if (validTarget(agent, layer)) {
            candidates.unshift(agent.target);
          }
          const route = coreDestroyed ? null : findRoute(agent, candidates);
          return { x: agent.x, y: agent.y, touchingOutline: onOutline(agent.x, agent.y),
            state: coreDestroyed ? 'core destroyed' : route ? 'route available' : candidates.length ? 'no route to eligible sites' : 'no eligible sites',
            route };
        }),
      };
    },
    inspectDeliveries() {
      const layer = currentLayer();
      const obstacles = { [PARTICLE_WATER]: 'water', [PARTICLE_TERRAIN]: 'terrain',
        [PARTICLE_BARRIER]: 'settled building', [PARTICLE_DEBRIS]: 'fallen debris',
        [PARTICLE_CONSTRUCTION]: 'moving material' };
      return agents.filter(retained).map((agent) => {
        const next = agent.path[0];
        const currentBlocked = insideDelivery && !passable(agent.x, agent.y, agent);
        const targetOccupied = agent.target && world.at(agent.target.x, agent.target.y) !== PARTICLE_EMPTY &&
          !(!insideDelivery && agent.x === agent.target.x && agent.y === agent.target.y);
        const blockedCell = currentBlocked ? agent : targetOccupied ? agent.target :
          next && (insideDelivery ? !passable(next.x, next.y, agent.target) :
            world.at(next.x, next.y) !== PARTICLE_EMPTY) ? next : null;
        const blocker = blockedCell ? { x: blockedCell.x, y: blockedCell.y,
          location: currentBlocked ? 'current position' : targetOccupied ? 'target' : 'next step',
          material: world.at(blockedCell.x, blockedCell.y),
          kind: world.at(blockedCell.x, blockedCell.y) === PARTICLE_CONSTRUCTION ? 'delivery traffic' : 'occupied material' } : null;
        let state = 'waiting for assignment';
        if (coreDestroyed) state = 'stopped: core destroyed';
        else if (currentBlocked) state = `waiting: current position occupied by ${obstacles[world.at(agent.x, agent.y)] || 'lost surface'}`;
        else if (agent.target) {
          state = !supported(agent.target) ? 'waiting: lost target support' :
            !layer.includes(agent.target) ? 'waiting: earlier layer needs repair' :
              !validTarget(agent, layer) ? `waiting: target occupied by ${obstacles[world.at(agent.target.x, agent.target.y)]}` :
            !next ? 'ready to settle' :
              (insideDelivery ? !passable(next.x, next.y, agent.target) : world.at(next.x, next.y) !== PARTICLE_EMPTY)
                ? `waiting: ${obstacles[world.at(next.x, next.y)] || 'lost surface'}` :
                !insideDelivery && !onOutline(next.x, next.y) ? 'waiting: lost outline' : 'route ready';
        }
        return { x: agent.x, y: agent.y, state, touchingOutline: onOutline(agent.x, agent.y), blocker,
          blockerDescription: blocker ? `${blocker.kind}: ${blocker.location} (${blocker.x}, ${blocker.y}) ${obstacles[blocker.material] || 'lost surface'}` : '' };
      });
    },
    inspectSites() {
      if (ticks < 240 || finished || coreDestroyed || growth && !growth.complete) return [];
      const reserved = new Set(agents.filter((agent) => agent.target).map((agent) => key(agent.target.x, agent.target.y)));
      const occupied = { [PARTICLE_WATER]: 'water', [PARTICLE_TERRAIN]: 'terrain',
        [PARTICLE_DEBRIS]: 'fallen debris', [PARTICLE_CONSTRUCTION]: 'moving material' };
      return currentLayer().map((cell) => {
        const material = world.at(cell.x, cell.y);
        const state = occupied[material] || (!supported(cell) ? 'missing support' :
          reserved.has(key(cell.x, cell.y)) ? 'incoming' : 'available');
        return { x: cell.x, y: cell.y, distance: cell.distance, state };
      });
    },
    get blueprintProgress() { return Math.min(1, ticks / 240); },
    blueprintCells() {
      if (growth && !growth.complete) return [];
      const reach = Math.min(1, ticks / 240) * maxDistance;
      return queue.filter((cell) => !coreDestroyed && cell.distance <= reach &&
        world.at(cell.x, cell.y) === PARTICLE_EMPTY);
    },
    breachBasin() { return world.excavate(30, 65, 30, surfaceRow - 1); },
    blastFoundation() {
      return blastAt(poles[0], groundRows[0] - 1, 3);
    },
    blastCore(index) {
      if (!buriedCore || !Number.isInteger(index) || index < 0 || index >= poles.length) {
        throw new Error('Invalid buried core selection');
      }
      return blastAt(poles[index] + 1, groundRows[index] + 1, 2);
    },
    excavateFoundationGround() {
      let removed = 0;
      for (let x = poles[0]; x < poles[0] + 3; x += 1) {
        if (world.at(x, groundRows[0]) === PARTICLE_TERRAIN) {
          removed += world.excavate(x, groundRows[0], x, groundRows[0]);
        }
      }
      return removed;
    },
    restoreFoundation() {
      let restored = 0;
      const blockedCells = [];
      for (let y = groundRows[0]; y <= groundRows[0] + 2; y += 1) {
        for (let x = poles[0] - 3; x <= poles[0] + 3; x += 1) {
          if ((x - poles[0]) ** 2 + (y - (groundRows[0] - 1)) ** 2 > 9) continue;
          const material = world.at(x, y);
          if (material === PARTICLE_EMPTY) {
            world.set(x, y, PARTICLE_TERRAIN); restored += 1;
          } else if (material !== PARTICLE_TERRAIN) blockedCells.push({ x, y, material });
        }
      }
      return { restored, blocked: blockedCells.length, blockedCells };
    },
    clearDebris() { return world.clearDebris(0, 0, world.width - 1, world.height - 1); },
    step({ advanceWorld = true } = {}) {
      if (typeof advanceWorld !== 'boolean') throw new Error('Invalid pixel world stepping option');
      checkCore();
      if (advanceWorld) world.step();
      checkCore();
      ticks += 1;
      if (growth && !growth.complete) {
        if (!coreDestroyed) growFoundation();
        checkCore();
        return;
      }
      if (ticks <= 240 || finished || coreDestroyed) return;
      if (ticks % stride === 0) moveAgents();
      if (queue.every((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER)) {
        finished = true; completedTick = ticks;
        message = 'Frame complete; automatic material delivery stopped'; return;
      }
      if (ticks % deliveryInterval !== 0) return;
      deliveryChecks += 1;
      let emitted = 0;
      for (const source of deliverySources()) {
        if (agents.length >= crew || hm < 1 || !sourceReady(source)) continue;
        const agent = { ...source, target: null, path: [] };
        if (!assign(agent)) continue;
        if (!insideDelivery) {
          const result = world.emitConstruction(agent.x, agent.y);
          if (!result.ok) throw new Error(`Material delivery failed: ${result.reason}`);
        }
        hm -= 1; spent += 1; emitted += 1; agents.push(agent);
      }
      if (emitted) { productiveChecks += 1; lastDeliveryTick = ticks; }
      message = emitted ? `Delivered ${emitted} material pixels; branches crawl independently` :
        hm < 1 ? 'Waiting for HM' : agents.length ? 'Material crawling; obstructed routes wait' :
          'No reachable supported site; water, terrain, debris or lost support may block construction';
    },
  };
}
