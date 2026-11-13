const PARTICLE_EMPTY = 0;
const PARTICLE_TERRAIN = 1;
const PARTICLE_WATER = 2;
const PARTICLE_BARRIER = 3;
const PARTICLE_DEBRIS = 4;
const PARTICLE_CONSTRUCTION = 5;
// Static tunnel lining: solid like terrain, but not counted as terrain.
const PARTICLE_WALL = 6;

function createParticleWorld(width, height, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Particle world dimensions must be positive integers');
  }
  if (!options || (options.skipEmptyRows !== undefined && typeof options.skipEmptyRows !== 'boolean') ||
      (options.skipEmptyChunks !== undefined && typeof options.skipEmptyChunks !== 'boolean')) {
    throw new Error('Invalid particle world options');
  }
  const skipEmptyRows = options.skipEmptyRows === true;
  const supportCapacity = options.supportCapacity;
  if (supportCapacity !== undefined && (!Number.isFinite(supportCapacity) || supportCapacity <= 0)) {
    throw new Error('Invalid particle support capacity');
  }
  let loadReport = { enabled: supportCapacity !== undefined, capacity: supportCapacity, maximum: 0, failed: 0 };
  let carriedLoads = null;
  let loadList = [], loadListSource = null;
  const skipEmptyChunks = options.skipEmptyChunks === true;
  const chunkSize = 32;
  const chunksPerRow = Math.ceil(width / chunkSize);
  const chunkIndex = (x, y) => y * chunksPerRow + Math.floor(x / chunkSize);
  const cells = new Uint8Array(width * height);
  const updated = new Uint32Array(cells.length);
  const waterRows = new Uint32Array(height);
  const debrisRows = new Uint32Array(height);
  const waterChunks = skipEmptyChunks ? new Uint32Array(height * chunksPerRow) : null;
  const debrisChunks = skipEmptyChunks ? new Uint32Array(height * chunksPerRow) : null;
  let tick = 0;
  let waterCount = 0;
  let terrainCount = 0;
  let terrainRevision = 0;
  let barrierCount = 0;
  let debrisCount = 0;
  let constructionCount = 0;
  let wallCount = 0;
  let supportsDirty = false;
  let debrisMergeTicks = 0, mergedDebrisCount = 0;
  let debrisMergeOccupied = null;
  const debrisRest = new Map();
  let surfaceRevision = -1;
  const surfaceRows = new Int32Array(width);
  const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
  function index(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inside(x, y)) {
      throw new Error('Particle position is outside the world');
    }
    return y * width + x;
  }
  function isEmpty(x, y, waterBlockers) {
    return inside(x, y) && cells[y * width + x] === PARTICLE_EMPTY &&
      (!waterBlockers || !waterBlockers[y * width + x]);
  }
  function move(from, x, y) {
    const to = y * width + x;
    const fromY = Math.floor(from / width);
    if (skipEmptyChunks) {
      waterChunks[chunkIndex(from % width, fromY)] -= 1;
      waterChunks[chunkIndex(x, y)] += 1;
    }
    if (fromY !== y) { waterRows[fromY] -= 1; waterRows[y] += 1; }
    cells[to] = PARTICLE_WATER;
    cells[from] = PARTICLE_EMPTY;
    updated[to] = tick;
  }
  function displaceWater(start, direction, waterBlockers) {
    const queue = [{ cell: start, parent: -1, distance: 0 }];
    const visited = new Set([start]);
    for (let i = 0; i < queue.length; i += 1) {
      const current = queue[i];
      const x = current.cell % width, y = Math.floor(current.cell / width);
      for (const [nx, ny] of [[x, y + 1], [x + direction, y], [x - direction, y], [x, y - 1]]) {
        if (!inside(nx, ny)) continue;
        const next = ny * width + nx;
        if (isEmpty(nx, ny, waterBlockers)) {
          let destination = next;
          let path = i;
          while (path !== -1) {
            const from = queue[path].cell;
            move(from, destination % width, Math.floor(destination / width));
            destination = from;
            path = queue[path].parent;
          }
          return;
        }
        if (current.distance < 7 && queue.length < 64 && waterBlockers[next] &&
            cells[next] === PARTICLE_WATER && updated[next] !== tick && !visited.has(next)) {
          visited.add(next);
          queue.push({ cell: next, parent: i, distance: current.distance + 1 });
        }
      }
    }
  }
  function removeTerrain(cell, updateSupports = true) {
    if (cells[cell] !== PARTICLE_TERRAIN && cells[cell] !== PARTICLE_BARRIER &&
        cells[cell] !== PARTICLE_DEBRIS && cells[cell] !== PARTICLE_CONSTRUCTION &&
        cells[cell] !== PARTICLE_WALL) return false;
    if (cells[cell] === PARTICLE_TERRAIN) { terrainCount -= 1; terrainRevision += 1; }
    else if (cells[cell] === PARTICLE_WALL) { wallCount -= 1; terrainRevision += 1; }
    else if (cells[cell] === PARTICLE_BARRIER) barrierCount -= 1;
    else if (cells[cell] === PARTICLE_CONSTRUCTION) constructionCount -= 1;
    else {
      debrisCount -= 1;
      debrisRest.delete(cell);
      const y = Math.floor(cell / width);
      debrisRows[y] -= 1;
      if (skipEmptyChunks) debrisChunks[chunkIndex(cell % width, y)] -= 1;
    }
    cells[cell] = PARTICLE_EMPTY;
    if (updateSupports) supportsDirty = true;
    return true;
  }
  // Support passes run on every structural change, so their map-sized buffers are allocated once and reused.
  let supportVisited = null, supportComponent = [], weightQueue = [], weightFailures = [];
  let weightDistance = null, weightStamp = null, weightGeneration = 0, weightLoads = null, loadRevision = 0;
  const solidSupport = (cell) => cells[cell] === PARTICLE_TERRAIN || cells[cell] === PARTICLE_WALL;
  function releaseUnsupportedBarriers() {
    if (!supportsDirty) return;
    supportsDirty = false;
    if (!supportVisited) supportVisited = new Uint8Array(cells.length);
    else supportVisited.fill(0);
    const visited = supportVisited, component = supportComponent;
    for (let start = cells.indexOf(PARTICLE_BARRIER); start !== -1; start = cells.indexOf(PARTICLE_BARRIER, start + 1)) {
      if (visited[start]) continue;
      component.length = 0; component.push(start);
      let supported = false;
      visited[start] = 1;
      for (let i = 0; i < component.length; i += 1) {
        const cell = component[i];
        const x = cell % width;
        for (let side = 0; side < 4; side += 1) {
          let neighbor;
          if (side === 0) { if (x === 0) continue; neighbor = cell - 1; }
          else if (side === 1) { if (x === width - 1) continue; neighbor = cell + 1; }
          else if (side === 2) { if (cell < width) continue; neighbor = cell - width; }
          else { if (cell >= cells.length - width) continue; neighbor = cell + width; }
          const material = cells[neighbor];
          if (material === PARTICLE_TERRAIN || material === PARTICLE_WALL) supported = true;
          else if (material === PARTICLE_BARRIER && !visited[neighbor]) {
            visited[neighbor] = 1;
            component.push(neighbor);
          }
        }
      }
      if (!supported) {
        for (const cell of component) {
          cells[cell] = PARTICLE_DEBRIS;
          debrisRows[Math.floor(cell / width)] += 1;
          if (skipEmptyChunks) debrisChunks[chunkIndex(cell % width, Math.floor(cell / width))] += 1;
        }
        barrierCount -= component.length;
        debrisCount += component.length;
      }
    }
  }
  function applyBuildingWeight() {
    if (!weightDistance) {
      weightDistance = new Int32Array(cells.length); weightStamp = new Uint32Array(cells.length);
      weightLoads = new Float64Array(cells.length);
    }
    weightGeneration = (weightGeneration + 1) >>> 0;
    if (weightGeneration === 0) { weightStamp.fill(0); weightGeneration = 1; }
    const generation = weightGeneration, distance = weightDistance, stamp = weightStamp, loads = weightLoads;
    // A cell's distance is only valid when stamped in this pass; every other cell reads as unreached (-1).
    const reached = (cell) => stamp[cell] === generation;
    const queue = weightQueue;
    queue.length = 0;
    const neighborAt = (cell, side) => {
      const x = cell % width;
      if (side === 0) return x > 0 ? cell - 1 : -1;
      if (side === 1) return x < width - 1 ? cell + 1 : -1;
      if (side === 2) return cell >= width ? cell - width : -1;
      return cell < cells.length - width ? cell + width : -1;
    };
    for (let cell = cells.indexOf(PARTICLE_BARRIER); cell !== -1; cell = cells.indexOf(PARTICLE_BARRIER, cell + 1)) {
      loads[cell] = 1;
      for (let side = 0; side < 4; side += 1) {
        const next = neighborAt(cell, side);
        if (next >= 0 && solidSupport(next)) { distance[cell] = 0; stamp[cell] = generation; queue.push(cell); break; }
      }
    }
    for (let i = 0; i < queue.length; i += 1) {
      for (let side = 0; side < 4; side += 1) {
        const next = neighborAt(queue[i], side);
        if (next >= 0 && cells[next] === PARTICLE_BARRIER && !reached(next)) {
          distance[next] = distance[queue[i]] + 1; stamp[next] = generation; queue.push(next);
        }
      }
    }
    let maximum = 0;
    const failures = weightFailures;
    failures.length = 0;
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      const cell = queue[i], load = loads[cell], own = distance[cell];
      maximum = Math.max(maximum, load);
      if (load > supportCapacity) failures.push(cell);
      let count = 0;
      for (let side = 0; side < 4; side += 1) {
        const next = neighborAt(cell, side);
        if (next >= 0 && reached(next) && distance[next] < own) count += 1;
      }
      for (let side = 0; side < 4; side += 1) {
        const next = neighborAt(cell, side);
        if (next >= 0 && reached(next) && distance[next] < own) loads[next] += load / count;
      }
    }
    for (const cell of failures) {
      cells[cell] = PARTICLE_DEBRIS;
      const y = Math.floor(cell / width);
      debrisRows[y] += 1;
      if (skipEmptyChunks) debrisChunks[chunkIndex(cell % width, y)] += 1;
    }
    barrierCount -= failures.length;
    debrisCount += failures.length;
    loadReport = { enabled: true, capacity: supportCapacity, maximum, failed: loadReport.failed + failures.length };
    // Only barrier entries are meaningful; the shared buffer is identified by revision for the cached list.
    carriedLoads = loads; loadRevision += 1;
    if (failures.length) supportsDirty = true;
  }
  return {
    width,
    height,
    get structuralLoad() { return { ...loadReport }; },
    // Changes whenever inspectStructuralLoads() would return different values; null while no loads are exposed.
    get structuralLoadRevision() {
      return supportCapacity === undefined || supportsDirty || !carriedLoads ? null : loadRevision;
    },
    // Single-cell form of inspectStructuralLoads() for callers that only need a few cells.
    structuralLoadAt(x, y) {
      if (supportCapacity === undefined || supportsDirty || !carriedLoads || !inside(x, y)) return null;
      const cell = y * width + x;
      return cells[cell] === PARTICLE_BARRIER ? { x, y, load: carriedLoads[cell], capacity: supportCapacity } : null;
    },
    inspectStructuralLoads() {
      if (supportCapacity === undefined || supportsDirty || !carriedLoads) return [];
      // Barrier cells only change while supports are dirty, so a list built for this load array stays exact.
      if (loadListSource !== loadRevision) {
        loadList = [];
        for (let cell = cells.indexOf(PARTICLE_BARRIER); cell !== -1; cell = cells.indexOf(PARTICLE_BARRIER, cell + 1)) {
          loadList.push([cell % width, Math.floor(cell / width), carriedLoads[cell]]);
        }
        loadListSource = loadRevision;
      }
      return loadList.map(([x, y, load]) => ({ x, y, load, capacity: supportCapacity }));
    },
    at(x, y) { return cells[index(x, y)]; },
    copyCells(target) {
      if (!(target instanceof Uint8Array) || target.length !== cells.length) {
        throw new Error('Particle cell copy requires a world-sized Uint8Array');
      }
      target.set(cells);
    },
    overlapsDebris(x, y, pixels) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Array.isArray(pixels)) throw new Error('Invalid debris overlap query');
      if (!debrisCount) return false;
      for (const pixel of pixels) {
        const px = x + pixel.x, py = y + pixel.y;
        if (px >= 0 && py >= 0 && px < width && py < height && debrisRows[py] &&
            cells[py * width + px] === PARTICLE_DEBRIS) return true;
      }
      return false;
    },
    countUnitDebris(x, y, pixels) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Array.isArray(pixels)) throw new Error('Invalid debris coverage query');
      if (!debrisCount) return 0;
      let count = 0;
      for (const pixel of pixels) {
        const px = x + pixel.x, py = y + pixel.y;
        if (px >= 0 && py >= 0 && px < width && py < height && debrisRows[py] &&
            cells[py * width + px] === PARTICLE_DEBRIS) count += 1;
      }
      return count;
    },
    findUnitContact(x, y, pixels, ignoreDebris = false, ignoreMaterial) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Array.isArray(pixels)) throw new Error('Invalid unit contact query');
      for (const pixel of pixels) {
        const px = x + pixel.x, py = y + pixel.y;
        if (px < 0 || py < 0 || px >= width || py >= height) return { x: px, y: py, reason: 'crop edge', material: null };
        const material = cells[py * width + px];
        if (material !== PARTICLE_EMPTY && material !== PARTICLE_WATER && !(ignoreDebris && material === PARTICLE_DEBRIS)) {
          if (ignoreMaterial && ignoreMaterial(px, py, material)) continue;
          return { x: px, y: py, reason: ['empty', 'terrain', 'water', 'structure', 'debris', 'construction', 'wall'][material], material };
        }
      }
      return null;
    },
    set(x, y, material) {
      const cell = index(x, y);
      if (material !== PARTICLE_EMPTY && material !== PARTICLE_TERRAIN && material !== PARTICLE_WATER) {
        throw new Error('Invalid particle material');
      }
      if (cells[cell] !== PARTICLE_EMPTY && material !== cells[cell]) {
        throw new Error('Cannot replace an occupied particle cell');
      }
      if (cells[cell] === material) return;
      cells[cell] = material;
      if (material === PARTICLE_WATER) {
        waterCount += 1;
        waterRows[y] += 1;
        if (skipEmptyChunks) waterChunks[chunkIndex(x, y)] += 1;
      }
      if (material === PARTICLE_TERRAIN) { terrainCount += 1; terrainRevision += 1; supportsDirty = true; }
    },
    excavate(left, top, right, bottom) {
      if (![left, top, right, bottom].every(Number.isInteger) ||
          left > right || top > bottom || !inside(left, top) || !inside(right, bottom)) {
        throw new Error('Invalid excavation bounds');
      }
      let removed = 0;
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          if (removeTerrain(y * width + x)) removed += 1;
        }
      }
      return removed;
    },
    clearDebris(left, top, right, bottom) {
      if (![left, top, right, bottom].every(Number.isInteger) ||
          left > right || top > bottom || !inside(left, top) || !inside(right, bottom)) {
        throw new Error('Invalid debris clearing bounds');
      }
      let removed = 0;
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const cell = y * width + x;
          if (cells[cell] === PARTICLE_DEBRIS && removeTerrain(cell, false)) removed += 1;
        }
      }
      return removed;
    },
    emitConstruction(x, y) {
      const cell = index(x, y);
      if (cells[cell] !== PARTICLE_EMPTY) return { ok: false, reason: 'occupied' };
      cells[cell] = PARTICLE_CONSTRUCTION;
      constructionCount += 1;
      return { ok: true, reason: 'emitted' };
    },
    moveConstruction(x, y, nextX, nextY) {
      const from = index(x, y), to = index(nextX, nextY);
      if (Math.abs(x - nextX) + Math.abs(y - nextY) !== 1) throw new Error('Construction moves must share an edge');
      if (cells[from] !== PARTICLE_CONSTRUCTION) throw new Error('No construction material at source');
      if (cells[to] !== PARTICLE_EMPTY) return { ok: false, reason: 'occupied' };
      cells[from] = PARTICLE_EMPTY;
      cells[to] = PARTICLE_CONSTRUCTION;
      return { ok: true, reason: 'moved' };
    },
    settleConstruction(x, y) {
      const cell = index(x, y);
      if (cells[cell] !== PARTICLE_CONSTRUCTION) throw new Error('No construction material to settle');
      const supported = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) =>
        inside(nx, ny) && (cells[ny * width + nx] === PARTICLE_TERRAIN || cells[ny * width + nx] === PARTICLE_BARRIER ||
          cells[ny * width + nx] === PARTICLE_WALL));
      if (!supported) return { ok: false, reason: 'missing support' };
      cells[cell] = PARTICLE_BARRIER;
      constructionCount -= 1;
      barrierCount += 1;
      supportsDirty = true;
      return { ok: true, reason: 'settled' };
    },
    constructBarrier(x, top, bottom) {
      if (!Number.isInteger(x) || !Number.isInteger(top) || !Number.isInteger(bottom) ||
          top > bottom || !inside(x, top - 1) || !inside(x, bottom + 1)) {
        throw new Error('Invalid barrier bounds');
      }
      if (cells[(top - 1) * width + x] !== PARTICLE_TERRAIN ||
          cells[(bottom + 1) * width + x] !== PARTICLE_TERRAIN) {
        return { ok: false, reason: 'missing-support', placed: 0 };
      }
      for (let y = top; y <= bottom; y += 1) {
        const material = cells[y * width + x];
        if (material === PARTICLE_WATER) return { ok: false, reason: 'water', placed: 0 };
        if (material === PARTICLE_DEBRIS) return { ok: false, reason: 'debris', placed: 0 };
        if (material !== PARTICLE_EMPTY && material !== PARTICLE_BARRIER) {
          return { ok: false, reason: 'terrain', placed: 0 };
        }
      }
      let placed = 0;
      for (let y = top; y <= bottom; y += 1) {
        const cell = y * width + x;
        if (cells[cell] === PARTICLE_EMPTY) {
          cells[cell] = PARTICLE_BARRIER;
          barrierCount += 1;
          placed += 1;
        }
      }
      if (placed) supportsDirty = true;
      return { ok: true, reason: placed ? 'built' : 'complete', placed };
    },
    blast(centerX, centerY, radius) {
      if (!Number.isInteger(centerX) || !Number.isInteger(centerY) || !inside(centerX, centerY) ||
          !Number.isInteger(radius) || radius < 1) throw new Error('Invalid blast');
      let removed = 0;
      for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
        for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
          if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2 && removeTerrain(y * width + x)) {
            removed += 1;
          }
        }
      }
      return removed;
    },
    emitDebris(x, y) {
      const cell = index(x, y);
      if (cells[cell] !== PARTICLE_EMPTY) return { ok: false, reason: 'occupied' };
      cells[cell] = PARTICLE_DEBRIS; debrisCount += 1; debrisRows[y] += 1;
      if (skipEmptyChunks) debrisChunks[chunkIndex(x, y)] += 1;
      return { ok: true, reason: 'emitted' };
    },
    impact(centerX, centerY, radius) {
      if (!Number.isInteger(centerX) || !Number.isInteger(centerY) || !inside(centerX, centerY) ||
          !Number.isInteger(radius) || radius < 1) throw new Error('Invalid particle impact');
      let terrain = 0, structure = 0, wall = 0;
      for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
        for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
          if ((x - centerX) ** 2 + (y - centerY) ** 2 > radius ** 2) continue;
          const cell = y * width + x, material = cells[cell];
          if (![PARTICLE_TERRAIN, PARTICLE_BARRIER, PARTICLE_CONSTRUCTION, PARTICLE_WALL].includes(material)) continue;
          if (material === PARTICLE_TERRAIN) { terrainCount -= 1; terrainRevision += 1; terrain += 1; }
          else if (material === PARTICLE_WALL) { wallCount -= 1; terrainRevision += 1; wall += 1; }
          else if (material === PARTICLE_BARRIER) { barrierCount -= 1; structure += 1; }
          else { constructionCount -= 1; structure += 1; }
          cells[cell] = PARTICLE_DEBRIS; debrisCount += 1; debrisRows[y] += 1;
          if (skipEmptyChunks) debrisChunks[chunkIndex(x, y)] += 1;
        }
      }
      if (terrain || structure || wall) supportsDirty = true;
      return wall ? { terrain, structure, wall } : { terrain, structure };
    },
    countWater(left, top, right, bottom) {
      if (![left, top, right, bottom].every(Number.isInteger) ||
          left > right || top > bottom || !inside(left, top) || !inside(right, bottom)) {
        throw new Error('Invalid water count bounds');
      }
      let count = 0;
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          if (cells[y * width + x] === PARTICLE_WATER) count += 1;
        }
      }
      return count;
    },
    get waterCount() { return waterCount; },
    get terrainCount() { return terrainCount; },
    get terrainRevision() { return terrainRevision; },
    get debrisMergeTicks() { return debrisMergeTicks; },
    get mergedDebrisCount() { return mergedDebrisCount; },
    configureDebrisMerging(delay) {
      if (!Number.isInteger(delay) || delay < 0 || delay > 65535) throw new Error('Invalid debris merge delay');
      debrisMergeTicks = delay;
      debrisRest.clear();
    },
    configureDebrisMergeOccupancy(isOccupied) {
      if (typeof isOccupied !== 'function') throw new Error('Invalid debris merge occupancy query');
      debrisMergeOccupied = isOccupied;
    },
    surfaceRow(x) {
      if (!Number.isInteger(x) || x < 0 || x >= width) throw new Error('Invalid surface column');
      if (surfaceRevision !== terrainRevision) {
        for (let column = 0; column < width; column += 1) {
          let row = 0;
          while (row < height && cells[row * width + column] !== PARTICLE_TERRAIN &&
            cells[row * width + column] !== PARTICLE_WALL) row += 1;
          surfaceRows[column] = row;
        }
        surfaceRevision = terrainRevision;
      }
      return surfaceRows[x];
    },
    get barrierCount() { return barrierCount; },
    get debrisCount() { return debrisCount; },
    get constructionCount() { return constructionCount; },
    get wallCount() { return wallCount; },
    placeWall(x, y) {
      const cell = index(x, y);
      if (cells[cell] === PARTICLE_WALL) return { ok: true, reason: 'complete' };
      if (cells[cell] !== PARTICLE_TERRAIN && cells[cell] !== PARTICLE_EMPTY) return { ok: false, reason: 'occupied' };
      if (cells[cell] === PARTICLE_TERRAIN) terrainCount -= 1;
      cells[cell] = PARTICLE_WALL;
      wallCount += 1; terrainRevision += 1; supportsDirty = true;
      return { ok: true, reason: 'lined' };
    },
    snapshot() {
      return { width, height, tick, supportsDirty, cells: Array.from(cells),
        ...(debrisMergeTicks || mergedDebrisCount ? {
          debrisMergeTicks, mergedDebrisCount, debrisRest: [...debrisRest] } : {}) };
    },
    restore(snapshot) {
      if (!snapshot || snapshot.width !== width || snapshot.height !== height ||
          !Number.isInteger(snapshot.tick) || snapshot.tick < 0 || snapshot.tick > 0xffffffff ||
          typeof snapshot.supportsDirty !== 'boolean' || !Array.isArray(snapshot.cells) ||
          snapshot.cells.length !== cells.length) {
        throw new Error('Invalid particle world snapshot');
      }
      const counts = [0, 0, 0, 0, 0, 0, 0];
      const mergeDelay = snapshot.debrisMergeTicks === undefined ? 0 : snapshot.debrisMergeTicks;
      const merged = snapshot.mergedDebrisCount === undefined ? 0 : snapshot.mergedDebrisCount;
      const rest = snapshot.debrisRest === undefined ? [] : snapshot.debrisRest;
      if (!Number.isInteger(mergeDelay) || mergeDelay < 0 || mergeDelay > 65535 ||
          !Number.isSafeInteger(merged) || merged < 0 || !Array.isArray(rest) ||
          rest.some((entry) => !Array.isArray(entry) || entry.length !== 2 ||
            !Number.isInteger(entry[0]) || entry[0] < 0 || entry[0] >= cells.length ||
            snapshot.cells[entry[0]] !== PARTICLE_DEBRIS ||
            !Number.isInteger(entry[1]) || entry[1] < 1 || entry[1] > mergeDelay) ||
          new Set(rest.map((entry) => entry[0])).size !== rest.length) {
        throw new Error('Invalid debris merging snapshot');
      }
      const restoredWaterRows = new Uint32Array(height);
      const restoredDebrisRows = new Uint32Array(height);
      const restoredWaterChunks = skipEmptyChunks ? new Uint32Array(waterChunks.length) : null;
      const restoredDebrisChunks = skipEmptyChunks ? new Uint32Array(debrisChunks.length) : null;
      for (let i = 0; i < snapshot.cells.length; i += 1) {
        const material = snapshot.cells[i];
        if (!Number.isInteger(material) || material < PARTICLE_EMPTY || material > PARTICLE_WALL) {
          throw new Error('Invalid particle material in snapshot');
        }
        counts[material] += 1;
        if (material === PARTICLE_WATER) restoredWaterRows[Math.floor(i / width)] += 1;
        if (material === PARTICLE_DEBRIS) restoredDebrisRows[Math.floor(i / width)] += 1;
        if (skipEmptyChunks && material === PARTICLE_WATER) restoredWaterChunks[chunkIndex(i % width, Math.floor(i / width))] += 1;
        if (skipEmptyChunks && material === PARTICLE_DEBRIS) restoredDebrisChunks[chunkIndex(i % width, Math.floor(i / width))] += 1;
      }
      cells.set(snapshot.cells);
      debrisMergeTicks = mergeDelay; mergedDebrisCount = merged;
      debrisRest.clear();
      for (const [cell, age] of rest) debrisRest.set(cell, age);
      waterRows.set(restoredWaterRows);
      debrisRows.set(restoredDebrisRows);
      if (skipEmptyChunks) {
        waterChunks.set(restoredWaterChunks);
        debrisChunks.set(restoredDebrisChunks);
      }
      updated.fill(0);
      tick = snapshot.tick;
      supportsDirty = snapshot.supportsDirty;
      terrainCount = counts[PARTICLE_TERRAIN];
      terrainRevision += 1;
      waterCount = counts[PARTICLE_WATER];
      barrierCount = counts[PARTICLE_BARRIER];
      debrisCount = counts[PARTICLE_DEBRIS];
      constructionCount = counts[PARTICLE_CONSTRUCTION];
      wallCount = counts[PARTICLE_WALL];
      if (supportCapacity !== undefined) {
        supportsDirty = true;
        loadReport = { enabled: true, capacity: supportCapacity, maximum: 0, failed: 0 };
        carriedLoads = null;
      }
    },
    step(waterBlockers, displaceOverlaps = false, onDebrisFall) {
      if (onDebrisFall !== undefined && typeof onDebrisFall !== 'function') throw new Error('Invalid debris fall observer');
      if (waterBlockers !== undefined &&
          (!(waterBlockers instanceof Uint8Array) || waterBlockers.length !== cells.length)) {
        throw new Error('Invalid water blocker grid');
      }
      if (typeof displaceOverlaps !== 'boolean' || (displaceOverlaps && waterBlockers === undefined)) {
        throw new Error('Invalid water displacement mode');
      }
      tick = (tick + 1) >>> 0;
      if (tick === 0) {
        updated.fill(0);
        tick = 1;
      }
      const structureChanged = supportsDirty;
      releaseUnsupportedBarriers();
      if (structureChanged && supportCapacity !== undefined) applyBuildingWeight();
      for (let y = height - 1; y >= 0; y -= 1) {
        if (skipEmptyRows && waterRows[y] === 0) continue;
        for (let n = 0; n < width; n += 1) {
          const x = tick % 2 ? n : width - n - 1;
          if (skipEmptyChunks && waterChunks[chunkIndex(x, y)] === 0) {
            n += Math.min(width - n, tick % 2 ? chunkSize - x % chunkSize : x % chunkSize + 1) - 1;
            continue;
          }
          const cell = y * width + x;
          if (cells[cell] !== PARTICLE_WATER || updated[cell] === tick) continue;
          const direction = ((x * 73 + y * 151 + Math.floor(tick / 13)) % 2) ? 1 : -1;
          if (displaceOverlaps && waterBlockers[cell]) {
            displaceWater(cell, direction, waterBlockers);
            continue;
          }
          if (isEmpty(x, y + 1, waterBlockers)) move(cell, x, y + 1);
          else if (isEmpty(x + direction, y + 1, waterBlockers)) move(cell, x + direction, y + 1);
          else if (isEmpty(x - direction, y + 1, waterBlockers)) move(cell, x - direction, y + 1);
          else {
            let chosen = 0;
            for (const dir of [direction, -direction]) {
              for (let distance = 1; distance <= 24; distance += 1) {
                const nextX = x + dir * distance;
                if (!isEmpty(nextX, y, waterBlockers)) break;
                if (isEmpty(nextX, y + 1, waterBlockers)) { chosen = dir; break; }
              }
              if (chosen) break;
            }
            if (!chosen && isEmpty(x + direction, y, waterBlockers)) chosen = direction;
            if (!chosen && isEmpty(x - direction, y, waterBlockers)) chosen = -direction;
            if (chosen) move(cell, x + chosen, y);
          }
        }
      }
      if (!debrisCount) return;
      for (let y = height - 2; y >= 0; y -= 1) {
        if (skipEmptyRows && debrisRows[y] === 0) continue;
        for (let n = 0; n < width; n += 1) {
          const x = tick % 2 ? n : width - n - 1;
          if (skipEmptyChunks && debrisChunks[chunkIndex(x, y)] === 0) {
            n += Math.min(width - n, tick % 2 ? chunkSize - x % chunkSize : x % chunkSize + 1) - 1;
            continue;
          }
          const cell = y * width + x;
          if (cells[cell] !== PARTICLE_DEBRIS) continue;
          let moved = false;
          const direction = (x + y + tick) % 2 ? 1 : -1;
          for (const nx of [x, x + direction, x - direction]) {
            if (!inside(nx, y + 1)) continue;
            const target = (y + 1) * width + nx;
            if (cells[target] !== PARTICLE_EMPTY && cells[target] !== PARTICLE_WATER) continue;
            if (cells[target] === PARTICLE_WATER) {
              if (waterBlockers && waterBlockers[cell]) continue;
              waterRows[y + 1] -= 1;
              waterRows[y] += 1;
              if (skipEmptyChunks) {
                waterChunks[chunkIndex(nx, y + 1)] -= 1;
                waterChunks[chunkIndex(x, y)] += 1;
              }
            }
            debrisRows[y] -= 1;
            debrisRows[y + 1] += 1;
            if (skipEmptyChunks) {
              debrisChunks[chunkIndex(x, y)] -= 1;
              debrisChunks[chunkIndex(nx, y + 1)] += 1;
            }
            cells[cell] = cells[target];
            cells[target] = PARTICLE_DEBRIS;
            debrisRest.delete(cell); debrisRest.delete(target);
            moved = true;
            if (onDebrisFall) onDebrisFall(x, y, nx, y + 1);
            break;
          }
          if (!moved && debrisMergeTicks) {
            const age = Math.min(debrisMergeTicks, (debrisRest.get(cell) || 0) + 1);
            debrisRest.set(cell, age);
            if (age >= debrisMergeTicks && cells[cell + width] === PARTICLE_TERRAIN &&
                (!debrisMergeOccupied || !debrisMergeOccupied(x, y))) {
              removeTerrain(cell, false);
              cells[cell] = PARTICLE_TERRAIN;
              terrainCount += 1; terrainRevision += 1; mergedDebrisCount += 1;
              supportsDirty = true;
            }
          }
        }
      }
    },
  };
}
