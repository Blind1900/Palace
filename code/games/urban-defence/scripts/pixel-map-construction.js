function createPixelMapConstructionScenario(source, options = {}) {
  if (!options || (options.deliveryMode !== undefined && !['outside', 'inside'].includes(options.deliveryMode))) {
    throw new Error('Invalid imported construction delivery mode');
  }
  if (options.buriedCore !== undefined && typeof options.buriedCore !== 'boolean') {
    throw new Error('Invalid imported buried-core option');
  }
  const buriedCore = options.buriedCore === true;
  if (options.connectingFloors !== undefined && typeof options.connectingFloors !== 'boolean' ||
      options.connectingFloors === true && !buriedCore) {
    throw new Error('Connecting floors require buried cores');
  }
  const connectingFloors = options.connectingFloors === true;
  if (!source || !Number.isInteger(source.width) || source.width < 160 ||
      !Number.isInteger(source.height) || source.height < 90 || source.cellSize !== 4 ||
      !Array.isArray(source.heights) || source.heights.length !== source.width ||
      !source.heights.every(Number.isFinite) ||
      !Array.isArray(source.waterLevels) || source.waterLevels.length !== source.width ||
      !source.waterLevels.every((level) => level === null || Number.isFinite(level)) ||
      !Array.isArray(source.tunnels)) {
    throw new Error('Invalid generated construction map source');
  }
  const groundRows = source.heights.map((height) => Math.ceil(height / source.cellSize - 0.5));
  for (let left = 60; left <= source.width - 100; left += 1) {
    const foundations = [0, 20, 40].map((dx) => groundRows[left + dx]);
    const ground = Math.min(...foundations), originY = ground - (buriedCore ? 72 : 75), originX = left - 60;
    const sourceColumns = buriedCore ? [left + 3, left + 5, left + 17, left + 25, left + 37, left + 39]
      : [0, 20, 40].flatMap((dx) => [left + dx - 3, left + dx + 5]);
    if (originY < 0 || originY + 90 > source.height ||
        foundations.some((row) => row > ground + 12) ||
        ![0, 20, 40].every((dx, index) => [0, 1, 2].every((offset) => {
          const x = left + dx + offset;
          return groundRows[x] === foundations[index] &&
            (source.waterLevels[x] === null || source.waterLevels[x] > (foundations[index] - 0.5) * 4);
        })) ||
        !Array.from({ length: 43 }, (_, dx) => left + dx).every((x) =>
          groundRows[x] >= ground &&
          (source.waterLevels[x] === null || source.waterLevels[x] > (ground - 0.5) * 4)) ||
        !sourceColumns.every((x) => groundRows[x] - originY >= 1 && groundRows[x] - originY <= 90 &&
          (source.waterLevels[x] === null || source.waterLevels[x] > (groundRows[x] - 0.5) * 4))) continue;
    const importOptions = { width: 160, height: 90, cellSize: 4,
      originX: originX * 4, originY: originY * 4, skipEmptyChunks: true, supportCapacity: 128 };
    const column = (x) => Math.floor(x / source.cellSize);
    const world = createParticleWorldFromSurfaceWaterAndTunnels(
      { heightAt: (x) => source.heights[column(x)] },
      (x) => source.waterLevels[column(x)], source.tunnels, importOptions);
    const foundationRows = foundations.map((row) => row - originY);
    const deliveryRows = sourceColumns.map((x) => groundRows[x] - originY + (buriedCore ? 2 : -1));
    const coreDelivery = buriedCore && options.deliveryMode === 'inside';
    const importedTerrain = world.snapshot();
    const tunnelCells = new Set();
    importedTerrain.cells.forEach((material, index) => {
      const x = index % world.width, y = Math.floor(index / world.width);
      if (material === PARTICLE_EMPTY &&
          (originY + y + 0.5) * 4 >= source.heights[originX + x]) tunnelCells.add(index);
    });
    const basementCells = [];
    const foundation = new Map(), floorSections = [];
    if (connectingFloors) {
      for (let index = 0; index < 2; index += 1) {
        const y = Math.max(foundationRows[index], foundationRows[index + 1]) + 3;
        floorSections.push({ left: 60 + index * 20, right: 82 + index * 20, y });
        for (let x = 60 + index * 20; x <= 82 + index * 20; x += 1) {
          foundation.set(y * world.width + x, { x, y });
        }
        for (const base of [index, index + 1]) {
          for (let row = foundationRows[base] + 3; row < y; row += 1) {
            for (let dx = 0; dx < 3; dx += 1) {
              const x = 60 + base * 20 + dx;
              foundation.set(row * world.width + x, { x, y: row });
            }
          }
        }
      }
      if ([...foundation.values()].some((cell) => cell.y >= world.height - 1 ||
          world.at(cell.x, cell.y) !== PARTICLE_TERRAIN) ||
          floorSections.some((section) => Array.from({ length: section.right - section.left + 1 }, (_, dx) =>
            section.left + dx).some((x) => world.at(x, section.y + 1) !== PARTICLE_TERRAIN))) continue;
      sourceColumns.forEach((x, index) => {
        deliveryRows[index] = floorSections[x < left + 20 ? 0 : 1].y - 1;
      });
    }
    if (buriedCore) {
      for (let x = left + 3; x < left + 40; x += 1) {
        if (x >= left + 20 && x < left + 23) continue;
        const floor = connectingFloors ? floorSections[x < left + 20 ? 0 : 1].y
          : groundRows[x] - originY + 3;
        for (let y = groundRows[x] - originY; y < floor; y += 1) {
          basementCells.push({ x: x - originX, y });
        }
      }
      if (basementCells.some((cell) => cell.y < 0 || cell.y >= world.height) ||
          ![60, 80, 100].every((pole, index) => [0, 1, 2].every((dx) =>
            [0, 1, 2, 3].every((dy) => foundationRows[index] + dy < world.height &&
              world.at(pole + dx, foundationRows[index] + dy) === PARTICLE_TERRAIN))) ||
          !coreDelivery && !sourceColumns.every((x, index) => deliveryRows[index] + 1 < world.height &&
            world.at(x - originX, deliveryRows[index]) === PARTICLE_TERRAIN &&
            world.at(x - originX, deliveryRows[index] + 1) === PARTICLE_TERRAIN)) continue;
      for (const cell of basementCells) {
        if (world.at(cell.x, cell.y) === PARTICLE_TERRAIN) world.excavate(cell.x, cell.y, cell.x, cell.y);
      }
    }
    if (![60, 80, 100].every((pole, index) => [0, 1, 2].every((dx) =>
      world.at(pole + dx, foundationRows[index]) === PARTICLE_TERRAIN)) ||
        !coreDelivery && !sourceColumns.every((x, index) => deliveryRows[index] + 1 < world.height &&
          world.at(x - originX, deliveryRows[index]) === PARTICLE_EMPTY &&
          world.at(x - originX, deliveryRows[index] + 1) === PARTICLE_TERRAIN)) continue;
    const scenario = createPixelConstructionScenario(5, { world, foundationRows, deliveryRows,
      deliveryMode: options.deliveryMode, buriedCore, foundationCells: [...foundation.values()] });
    const terrainIntegrity = verifyPixelMapPlacementTerrain(scenario, importedTerrain, basementCells);
    return { scenario, originX, originY, initialWater: world.waterCount, basementCells, floorSections, terrainIntegrity, tunnelCells };
  }
  throw new Error('No clear, supported frame site found; generate another map. Terrain was not flattened.');
}

function verifyPixelMapPlacementTerrain(scenario, original, basementCells) {
  const { world } = scenario;
  if (!original || original.width !== world.width || original.height !== world.height ||
      !Array.isArray(original.cells) || original.cells.length !== world.width * world.height) {
    throw new Error('Imported terrain baseline does not match the construction world');
  }
  if (!original.cells.every((material) =>
    [PARTICLE_EMPTY, PARTICLE_TERRAIN, PARTICLE_WATER].includes(material))) {
    throw new Error('Imported terrain baseline contains invalid material');
  }
  const validCell = (cell) => cell && Number.isInteger(cell.x) && Number.isInteger(cell.y) &&
    cell.x >= 0 && cell.x < world.width && cell.y >= 0 && cell.y < world.height;
  if (!Array.isArray(basementCells) || !basementCells.every(validCell)) {
    throw new Error('Invalid basement audit coordinates');
  }
  const basement = new Set(basementCells.map((cell) => cell.y * world.width + cell.x));
  const foundationCells = scenario.plan.filter((cell) => cell.distance === 0);
  if (!foundationCells.every(validCell)) throw new Error('Invalid foundation audit coordinates');
  const foundation = new Set(foundationCells
    .map((cell) => cell.y * world.width + cell.x));
  if (basement.size !== basementCells.length || foundation.size !== scenario.freeMaterial ||
      [...foundation].some((index) => basement.has(index) || original.cells[index] === PARTICLE_WATER)) {
    throw new Error('Invalid basement or foundation audit footprint');
  }
  let excavated = 0, terrain = 0, water = 0;
  for (let index = 0; index < original.cells.length; index += 1) {
    const x = index % world.width, y = Math.floor(index / world.width);
    const removedTerrain = basement.has(index) && original.cells[index] === PARTICLE_TERRAIN;
    const expected = foundation.has(index) ? PARTICLE_BARRIER :
      removedTerrain ? PARTICLE_EMPTY : original.cells[index];
    if (world.at(x, y) !== expected) {
      throw new Error(`Generated terrain placement mismatch at (${x}, ${y}): expected material ${expected}, found ${world.at(x, y)}`);
    }
    if (removedTerrain) excavated += 1;
    if (expected === PARTICLE_TERRAIN) terrain += 1;
    if (expected === PARTICLE_WATER) water += 1;
  }
  return { checked: original.cells.length, excavated, terrain, water, foundation: foundation.size };
}

function restorePixelMapTerrain(world, original) {
  if (!original || original.width !== world.width || original.height !== world.height ||
      !original.cells || original.cells.length !== world.width * world.height) {
    throw new Error('Original terrain crop does not match the construction world');
  }
  let restored = 0, blocked = 0;
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      if (original.cells[y * world.width + x] !== PARTICLE_TERRAIN) continue;
      const material = world.at(x, y);
      if (material === PARTICLE_EMPTY) { world.set(x, y, PARTICLE_TERRAIN); restored += 1; }
      else if (material !== PARTICLE_TERRAIN) blocked += 1;
    }
  }
  return { restored, blocked };
}

function excavatePixelFloorGround(imported, index) {
  if (!imported || !Array.isArray(imported.floorSections) || !Number.isInteger(index) ||
      index < 0 || index >= imported.floorSections.length) {
    throw new Error('Invalid floor excavation selection');
  }
  const floor = imported.floorSections[index], world = imported.scenario.world;
  const center = Math.floor((floor.left + floor.right) / 2), y = floor.y + 1;
  if (![floor.left, floor.right, floor.y].every(Number.isInteger) ||
      floor.left > floor.right || floor.left < 0 || floor.right >= world.width ||
      center - 1 < 0 || center + 1 >= world.width || y < 0 || y >= world.height) {
    throw new Error('Invalid floor excavation bounds');
  }
  let removed = 0;
  const cells = [];
  for (let x = center - 1; x <= center + 1; x += 1) {
    const material = world.at(x, y);
    if (material === PARTICLE_TERRAIN) removed += world.excavate(x, y, x, y);
    cells.push({ x, y, material });
  }
  return { removed, cells };
}

function inspectPixelMapDiagnostics(imported) {
  const { scenario, floorSections } = imported, { world } = scenario;
  const deliveries = scenario.inspectDeliveries(), sites = scenario.inspectSites();
  const blockers = new Map();
  for (const delivery of deliveries) {
    if (delivery.blocker) blockers.set(delivery.blocker.y * world.width + delivery.blocker.x, delivery.blocker);
  }
  for (const site of sites) {
    if (!['available', 'incoming'].includes(site.state)) {
      blockers.set(site.y * world.width + site.x, site);
    }
  }
  return {
    sites, deliveries, sources: scenario.inspectSources(), blockers: [...blockers.values()],
    stranded: deliveries.filter((delivery) => delivery.blocker && delivery.blocker.location === 'current position').length,
    waiting: deliveries.filter((delivery) => delivery.state.startsWith('waiting')).length,
    yielding: deliveries.filter((delivery) => delivery.state === 'waiting: yielding to delivery traffic').length,
    stopped: deliveries.filter((delivery) => delivery.state.startsWith('stopped')).length,
    floors: floorSections.map((floor) => {
      let settled = 0, contacts = 0, peak = null, missingLoads = false;
      for (let x = floor.left; x <= floor.right; x += 1) {
        if (world.at(x, floor.y + 1) === PARTICLE_TERRAIN) contacts += 1;
        if (world.at(x, floor.y) !== PARTICLE_BARRIER) continue;
        settled += 1;
        const load = world.structuralLoadAt(x, floor.y);
        if (!load) missingLoads = true;
        else if (!peak || load.load > peak.load) peak = { ...load };
      }
      return { ...floor, total: floor.right - floor.left + 1, settled, contacts,
        peak: missingLoads ? null : peak };
    }),
  };
}

function pixelBuildingReservations(entries, width) {
  return new Set(entries.flatMap((entry) => {
    const sources = typeof entry.scenario.inspectSources === 'function'
      ? entry.scenario.inspectSources() : [];
    return [...entry.scenario.plan, ...entry.basementCells, ...sources]
      .map((cell) => cell.y * width + cell.x);
  }));
}

// Plans and basements only grow by appending; reuse their reservation set until one changes.
const pixelPlanReservationCache = new WeakMap();
function cachedPlanReservations(entries, width) {
  const signature = entries.map((entry) => [entry, entry.scenario.plan, entry.scenario.plan.length,
    entry.basementCells, entry.basementCells.length]);
  const cached = pixelPlanReservationCache.get(entries);
  if (cached && cached.width === width && cached.signature.length === signature.length &&
      cached.signature.every((parts, index) => parts.every((part, at) => part === signature[index][at]))) return cached.set;
  const set = new Set();
  for (const entry of entries) {
    for (const cell of entry.scenario.plan) set.add(cell.y * width + cell.x);
    for (const cell of entry.basementCells) set.add(cell.y * width + cell.x);
  }
  pixelPlanReservationCache.set(entries, { width, signature, set });
  return set;
}

// Adds paid, physical style ornaments (pixel-building-styles.js) to a compact styled site.
// Ornaments that would touch another building's reservation keep the unornamented frame.
function stylePixelAdaptiveSite(world, entries, site) {
  if (!site.ok || !site.metadata.style || site.metadata.ornamentCount !== undefined) return site;
  if (typeof stylePixelBuildingGeometry !== 'function') throw new Error('Styled full-map buildings require pixel-building-styles.js');
  const styled = stylePixelBuildingGeometry(world, site, site.metadata.style);
  const original = new Set(site.geometry.frameCells.map((cell) => cell.y * world.width + cell.x));
  const reserved = pixelBuildingReservations(entries, world.width);
  const added = styled.geometry.frameCells.filter((cell) => !original.has(cell.y * world.width + cell.x));
  if (added.some((cell) => reserved.has(cell.y * world.width + cell.x))) return site;
  const ornamentKeys = new Set(styled.ornamentCells.map((cell) => cell.y * world.width + cell.x));
  // Paid style structure (crown bodies) counts toward the tower height; ornaments do not.
  const height = site.metadata.height && site.seedPlacement ? Math.min(...site.seedPlacement.map((cell) => cell.groundY)) -
    Math.min(...styled.geometry.frameCells.filter((cell) => !ornamentKeys.has(cell.y * world.width + cell.x)).map((cell) => cell.y)) : null;
  return { ...styled, metadata: { ...styled.metadata, ...(height ? { height } : {}),
    ornamentCells: styled.ornamentCells.map((cell) => ({ ...cell })) } };
}

// Stable per-site pick, so the same seed column always grows the same silhouette.
function pixelSiteVariant(site, variants) {
  let hash = 2166136261;
  for (const char of `${site.metadata.owner}|${site.metadata.style}|${site.geometry.poles.join(',')}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return variants[(hash >>> 0) % variants.length];
}

// Replaces a trooper-scale compact population tower with a style-lab silhouette (pixel-building-shapes.js).
// Every shaped pixel must be empty, outside other buildings' plans and 3-cell clearance margins and pass
// `blocked` (farmland); the hashed variant is tried first, then the others, and the compact tower is the fallback.
function shapePixelPopulationSite(world, entries, site, blocked = () => false) {
  if (!site.ok || site.shape || site.metadata.type !== 'population' || !site.metadata.height ||
      typeof shapePixelBuilding !== 'function') return site;
  const variants = PIXEL_BUILDING_VARIANTS.population, first = pixelSiteVariant(site, variants);
  const width = world.width, key = (x, y) => y * width + x, reserved = pixelBuildingReservations(entries, width);
  const margins = entries.map((entry) => {
    let left = Infinity, right = -Infinity;
    for (const cell of entry.scenario.plan) { left = Math.min(left, cell.x); right = Math.max(right, cell.x); }
    return [left - 3, right + 3];
  });
  // Shapes stand on one level slab at the highest seed row: terrain above it inside the footprint is cut
  // into the excavated basement and lower seeds get pole stubs up to the slab (both at most 8 rows).
  const seeds = site.geometry.seeds, base = Math.min(...seeds.map((seed) => seed.y)), poles = site.geometry.poles;
  const lo = poles[0] - 40, hi = poles[poles.length - 1] + 42;
  const view = { width, height: world.height, at: (x, y) => x >= lo && x <= hi && y <= base &&
    world.at(x, y) === PARTICLE_TERRAIN ? PARTICLE_EMPTY : world.at(x, y) };
  const lifted = { ...site, surfaceY: base + 1, geometry: { ...site.geometry, seeds: seeds.map((seed) => ({ x: seed.x, y: base })) } };
  const stubs = seeds.flatMap((seed) => Array.from({ length: seed.y - base }, (_, dy) => ({ x: seed.x, y: base + 1 + dy })));
  if (seeds.some((seed) => seed.y - base > 8) || stubs.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY)) return site;
  for (const variant of [first, ...variants.filter((name) => name !== first)]) {
    let shaped;
    try { shaped = shapePixelBuilding(view, lifted, variant); }
    catch (error) { if (/[Ss]hape (pixel|does not cover)/.test(error.message)) continue; throw error; }
    const { left, right } = shaped.geometry.bounds, cut = [];
    for (let x = left; x <= right; x += 1) {
      for (let y = base; y >= 1 && world.at(x, y) === PARTICLE_TERRAIN; y -= 1) cut.push({ x, y });
    }
    const cutKeys = new Set(cut.map((cell) => key(cell.x, cell.y)));
    const cells = [...shaped.geometry.frameCells, ...stubs];
    if (cut.some((cell) => base - cell.y >= 8) ||
        cells.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY && !cutKeys.has(key(cell.x, cell.y))) ||
        [...cells, ...cut].some((cell) => reserved.has(key(cell.x, cell.y)) ||
          margins.some(([from, to]) => cell.x >= from && cell.x <= to)) || blocked([...cells, ...cut])) continue;
    const roof = Math.min(...cells.map((cell) => cell.y)), ground = Math.min(...site.seedPlacement.map((cell) => cell.groundY));
    return { ...shaped, geometry: { ...shaped.geometry, frameCells: cells, seeds: seeds.map((seed) => ({ ...seed })) },
      basementCells: [...site.basementCells, ...cut],
      metadata: { ...shaped.metadata, width: right - left + 1, height: ground - roof } };
  }
  return site;
}

// Decor-only style-lab facade (pixel-building-styles.js windows and wall detail; no physics). Shaped towers
// use their storeys; compact frames get one pseudo storey per floor pitch up from the seed row.
function pixelSiteFacade(world, site) {
  const style = site.metadata.style;
  if (!site.ok || !style || typeof pixelWallDetail !== 'function' || typeof PIXEL_INTERIOR === 'undefined') return null;
  let shape = site.shape;
  if (!shape) {
    const cells = site.geometry.frameCells, pitch = Math.max(PIXEL_INTERIOR.floorPitch, site.metadata.floorHeight || 0);
    const left = Math.min(...cells.map((cell) => cell.x)), right = Math.max(...cells.map((cell) => cell.x));
    const roof = Math.min(...cells.map((cell) => cell.y)), base = site.surfaceY - 1, floors = [];
    for (let y = base, storey = 0; storey === 0 || y - pitch >= roof - 1; y -= pitch, storey += 1) {
      floors.push({ storey, y, left: left + 3, right: right - 3, outerLeft: left, outerRight: right, accessible: true });
    }
    shape = { floorPitch: pitch, floors, oneWay: new Set(), passThrough: new Set() };
  }
  const subject = { ...site, shape }, hex = (color) => `#${color.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  const windows = pixelBuildingWindows(subject, style, world.width), floorY = new Map(shape.floors.map((floor) => [floor.storey, floor.y]));
  const spans = [];
  if (site.shape) {
    for (const floor of shape.floors) {
      const top = floor.y - shape.floorPitch, last = spans[spans.length - 1];
      if (last && last.left === floor.outerLeft && last.right === floor.outerRight + 1 && last.top === floor.y) last.top = top;
      else spans.push({ left: floor.outerLeft, right: floor.outerRight + 1, top, bottom: floor.y + 1 });
    }
  }
  return { style, shaped: Boolean(site.shape), spans,
    wall: new Map([...pixelWallDetail(subject, style, world.width)].map(([cell, color]) => [cell, hex(color)])),
    side: new Map(windows.side.map((cell) => [cell.y * world.width + cell.x, hex(pixelWindowColor(cell.part, 'side', style))])),
    back: site.shape ? windows.back.map((cell) => ({ x: cell.x, y: cell.y, floorY: floorY.get(cell.storey),
      color: hex(pixelWindowColor(cell.part, 'back', style)) })) : [],
    stairs: new Set(shape.oneWay), doors: new Set(shape.passThrough) };
}

function withPixelSiteFacade(world, site) {
  if (!site.ok) return site;
  const facade = pixelSiteFacade(world, site);
  return facade ? { ...site, metadata: { ...site.metadata, facade } } : site;
}

function inspectPixelUrbanDetails(world, entries, roads, farms) {
  if (!roads.length) return [];
  const planned = cachedPlanReservations(entries, world.width), sources = new Set();
  for (const entry of entries) {
    if (typeof entry.scenario.inspectSources !== 'function') continue;
    for (const cell of entry.scenario.inspectSources()) sources.add(cell.y * world.width + cell.x);
  }
  const reserved = { has: (cellKey) => planned.has(cellKey) || sources.has(cellKey) }, details = [];
  for (const road of roads) {
    if (road.cells.length < 2 || road.cells.length > 12) continue;
    const clear = (cell, height) => Array.from({ length: height }, (_, dy) => ({ x: cell.x, y: cell.y - dy }))
      .every((pixel) => pixel.y >= 1 && !reserved.has(pixel.y * world.width + pixel.x) &&
        world.at(pixel.x, pixel.y) === PARTICLE_EMPTY && !farms.populationBlocked([pixel]));
    if (!road.cells.every((cell) => world.at(cell.x, cell.y + 1) === PARTICLE_TERRAIN && clear(cell, 3))) continue;
    details.push({ type: 'paving', from: road.from, to: road.to, cells: road.cells.map((cell) => ({ ...cell })),
      mode: 'logical-decoration', material: false, obstructsAccess: false });
    const place = (type, index, height) => {
      const cell = road.cells[index];
      details.push({ type, from: road.from, to: road.to,
        cells: Array.from({ length: height }, (_, dy) => ({ x: cell.x, y: cell.y - dy })),
        mode: 'logical-decoration', material: false, obstructsAccess: false });
    };
    place('lamp', 0, 3);
    if (road.cells.length >= 5) place('utility-box', road.cells.length - 1, 2);
    if (road.cells.length >= 8) place('planter', Math.floor(road.cells.length / 2), 2);
  }
  return details;
}

function prepareMilitaryInterlock(world, entries, frame, poles, reserved) {
  const extensions = new Map(), hosts = [];
  const key = (cell) => cell.y * world.width + cell.x;
  const clear = (x, y) => x >= 3 && x < world.width - 3 && y >= 1 && y < world.height - 1 &&
    !reserved.has(y * world.width + x) && world.at(x, y) === PARTICLE_EMPTY;
  const left = poles[0], right = poles[poles.length - 1] + 2;
  for (const [index, entry] of entries.entries()) {
    if (!entry.building || entry.building.type !== 'population' || !entry.scenario.finished || entry.scenario.coreDestroyed) continue;
    const cells = entry.scenario.plan.filter((cell) => cell.y < entry.seedPlacement[0].groundY);
    const hostLeft = Math.min(...cells.map((cell) => cell.x)), hostRight = Math.max(...cells.map((cell) => cell.x));
    const gap = hostLeft > right ? hostLeft - right - 1 : left > hostRight ? left - hostRight - 1 : 0;
    if (gap > 6) continue;
    const onRight = hostLeft > right, edge = onRight ? hostLeft : hostRight;
    const roof = Math.min(...cells.filter((cell) => Math.abs(cell.x - edge) <= 2).map((cell) => cell.y));
    const candidates = cells.map((cell) => ({ x: cell.x + (onRight ? 1 : -1), y: cell.y }))
      .filter((cell) => cell.x > hostLeft + 2 && cell.x < hostRight - 2 && cell.y >= roof &&
        cell.y < entry.seedPlacement[0].groundY - 2 && Math.abs(cell.x - edge) <= 8 && clear(cell.x, cell.y))
      .sort((a, b) => a.y - b.y || Math.abs(a.x - edge) - Math.abs(b.x - edge));
    if (!candidates.length) continue;
    const target = candidates[0], minX = Math.min(left, hostLeft) - 1, maxX = Math.max(right, hostRight) + 1;
    const frameTop = Math.min(...[...frame.values()].map((cell) => cell.y));
    const minY = Math.max(1, Math.min(roof, frameTop) - 2);
    const maxY = Math.max(target.y, frameTop);
    const starts = [...frame.values()].filter((cell) => cell.y >= minY && cell.y <= maxY &&
      cell.x >= minX && cell.x <= maxX);
    const queue = starts.map((cell) => ({ ...cell })), parents = new Map(starts.map((cell) => [key(cell), null]));
    let found = null;
    for (let i = 0; i < queue.length && queue.length <= 3000; i += 1) {
      const cell = queue[i];
      if (cell.x === target.x && cell.y === target.y) { found = cell; break; }
      for (const [x, y] of [[cell.x, cell.y - 1], [cell.x + (onRight ? 1 : -1), cell.y],
        [cell.x, cell.y + 1], [cell.x - (onRight ? 1 : -1), cell.y]]) {
        const next = { x, y }, nextKey = key(next);
        if (x < minX || x > maxX || y < minY || y > maxY || parents.has(nextKey) || !clear(x, y)) continue;
        parents.set(nextKey, cell); queue.push(next);
      }
    }
    if (!found) continue;
    while (parents.get(key(found))) {
      if (!frame.has(key(found))) extensions.set(key(found), { x: found.x, y: found.y });
      found = parents.get(key(found));
    }
    hosts.push(index);
  }
  return { cells: [...extensions.values()], hosts };
}

function prepareAdaptivePixelSeed(world, source, originX, originY, entries, x, building) {
  if (!building || !['population', 'military', 'farm'].includes(building.type) ||
      !Number.isInteger(building.level) || building.level < 1 || building.level > 7) {
    throw new Error('Invalid adaptive building type or level');
  }
  const count = building.type === 'farm' ? 1 : building.type === 'military'
    ? building.level >= 4 ? 4 : 3 : Math.min(5, 2 + Math.floor((building.level - 1) / 2));
  let left = 3, right = world.width - 6;
  const reserved = pixelBuildingReservations(entries, world.width);
  for (const entry of entries) {
    const columns = entry.scenario.plan.map((cell) => cell.x);
    const interlocking = building.type === 'military' && entry.building && entry.building.type === 'population';
    const a = Math.min(...columns) - (interlocking ? 0 : 3), b = Math.max(...columns) + (interlocking ? 0 : 3);
    if (x >= a && x <= b) return { ok: false, reason: 'Seed overlaps an existing building or its clearance margin.' };
    if (b < x) left = Math.max(left, b + 1);
    if (a > x) right = Math.min(right, a - 1);
  }
  const ground = (column) => world.debrisMergeTicks ? world.surfaceRow(column) :
    Math.ceil(source.heights[originX + column] / 4 - 0.5) - originY;
  const first = Math.floor((count - 1) / 2);
  const compact = !!source.populationScale;
  const owner = building.owner || (x < world.width * 0.2 ? 'left' : x >= world.width * 0.8 ? 'right' : 'neutral');
  const style = building.style || (source.architectureStyles && source.architectureStyles[owner]) || 'modern';
  const troopBay = compact && building.type === 'population' && source.populationScale.trooperWidth;
  const minimumSpacing = compact ? troopBay ? troopBay + 1 : 6 : building.type === 'military' ? 12 : 8;
  const maximumSpacing = compact ? troopBay ? troopBay + 2 : 8 : 24;
  const farm = building.type === 'farm';
  const desiredSilos = 1 + Math.floor((building.level - 1) / 2);
  const layouts = farm ? Array.from({ length: desiredSilos }, (_, index) =>
    ({ spacing: 24, silos: desiredSilos - index })) :
    Array.from({ length: maximumSpacing - minimumSpacing + 1 }, (_, index) =>
      ({ spacing: maximumSpacing - index, radius: 0 }));
  for (const { spacing, silos } of layouts) {
    const poles = Array.from({ length: count }, (_, index) => x - 1 + (index - first) * spacing);
    if (poles[0] < left || poles[count - 1] + 2 > right) continue;
    const siloCenters = farm ? Array.from({ length: silos }, (_, index) =>
      x + (index - Math.floor((silos - 1) / 2)) * 6) : [];
    if (farm && (siloCenters[0] - 2 < left || siloCenters[silos - 1] + 2 > right)) continue;
    const surfaceRows = poles.map((pole) => [0, 1, 2].map((dx) => ground(pole + dx)));
    const military = building.type === 'military';
    if (surfaceRows.some((rows) => Math.max(...rows) - Math.min(...rows) > (military ? 4 : 2))) continue;
    const foundationRows = surfaceRows.map((rows) => Math.max(...rows));
    if (Math.max(...foundationRows) - Math.min(...foundationRows) > (military ? 32 : 24) ||
        foundationRows.some((row) => row < 24 || row > world.height - 5)) continue;
    const spans = count === 1 ? [{ left: farm ? siloCenters[0] - 2 : poles[0],
      right: farm ? siloCenters[silos - 1] + 2 : poles[0] + 2 }]
      : poles.slice(0, -1).map((pole, index) => ({ left: pole, right: poles[index + 1] + 2 }));
    const floorSections = spans.map((span) => ({ ...span,
      y: Math.max(...Array.from({ length: span.right - span.left + 1 }, (_, dx) => ground(span.left + dx))) + 3 }));
    if (floorSections.some((span) => span.y >= world.height - 1)) continue;
    const roofs = spans.map((span) =>
      Math.min(...Array.from({ length: span.right - span.left + 1 }, (_, dx) => ground(span.left + dx))) - 12);
    if (roofs.some((row) => row < 0)) continue;
    if (building.type === 'population' && roofs.some((row) => row - 2 * (building.level - 1) < 1)) continue;
    if (farm && floorSections[0].y - 3 - (roofs[0] + 12) > 6) continue;
    const key = (cell) => cell.y * world.width + cell.x;
    const cores = poles.flatMap((pole, index) => [0, 1, 2].flatMap((dx) =>
      [0, 1, 2].map((dy) => ({ x: pole + dx, y: foundationRows[index] + dy }))));
    const coreKeys = new Set(cores.map(key)), frame = new Map(), foundation = new Map(), basement = new Map();
    const siloPlans = [];
    const put = (map, x, y) => map.set(y * world.width + x, { x, y });
    const seedPlacement = poles.flatMap((pole, index) => [0, 1, 2].map((dx) =>
      ({ x: pole + dx, y: surfaceRows[index][dx] - 1,
        groundY: surfaceRows[index][dx], sourceColumn: originX + pole + dx })));
    for (const [index, pole] of poles.entries()) {
      const roof = Math.min(...roofs.slice(Math.max(0, index - 1), Math.min(roofs.length, index + 1)));
      for (let dx = 0; dx < 3; dx += 1) {
        for (let y = roof; y < surfaceRows[index][dx]; y += 1) put(frame, pole + dx, y);
        for (let y = surfaceRows[index][dx]; y < foundationRows[index]; y += 1) put(foundation, pole + dx, y);
      }
    }
    for (const [index, span] of floorSections.entries()) {
      for (let column = span.left; column <= span.right; column += 1) {
        put(foundation, column, span.y);
        if (!farm) for (const offset of [0, 4, 8]) put(frame, column, roofs[index] + offset);
        const base = poles.findIndex((pole) => column >= pole && column <= pole + 2);
        if (base >= 0) {
          for (let y = foundationRows[base] + 3; y < span.y; y += 1) put(foundation, column, y);
        } else {
          for (let y = ground(column); y < span.y; y += 1) put(basement, column, y);
        }
        if (building.type === 'population' && building.level > 1) {
          for (const [index, pole] of poles.entries()) {
            const baseRoof = Math.min(...roofs.slice(Math.max(0, index - 1), Math.min(roofs.length, index + 1)));
            const towerRoof = baseRoof - 2 * (building.level - 1);
            for (let y = towerRoof; y < baseRoof; y += 1) {
              put(frame, pole, y); put(frame, pole + 2, y);
              if ((y - towerRoof) % 2 === 0) put(frame, pole + 1, y);
            }
          }
        }
      }
    }
    if (farm) {
      frame.clear();
      const span = spans[0], roof = roofs[0], base = roof + 11;
      for (let column = span.left; column <= span.right; column += 1) put(frame, column, base);
      for (const center of siloCenters) {
        const cells = new Map();
        const siloCell = (column, row) => {
          put(frame, column, row); put(cells, column, row);
        };
        for (let dx = -2; dx <= 2; dx += 1) {
          for (let row = roof + Math.abs(dx); row <= roof + 2; row += 1) siloCell(center + dx, row);
          siloCell(center + dx, base);
          if (Math.abs(dx) === 2) {
            for (let row = roof + 3; row < ground(center + dx); row += 1) siloCell(center + dx, row);
          }
        }
        siloPlans.push({ left: center - 2, right: center + 2, roof, base,
          cells: [...cells.values()], capacity: 100 });
      }
      for (let dx = 0; dx < 3; dx += 1) {
        for (let row = base; row < surfaceRows[0][dx]; row += 1) put(frame, poles[0] + dx, row);
      }
    }
    const extra = [...foundation.values()].filter((cell) => !coreKeys.has(key(cell)));
    const populationScale = building.type === 'population' && source.populationScale;
    const tower = populationScale ? createPixelPopulationFrame(poles, foundationRows,
      pixelPopulationHeight(populationScale, building.level), Math.ceil(populationScale.trooperHeight),
      surfaceRows, style, populationScale.trooperClearance || 0) : null;
    if (tower && tower.roof < 1) continue;
    const frameCells = tower ? tower.cells : [...frame.values()];
    for (const silo of siloPlans) {
      silo.storageCells = [];
      for (let row = silo.roof + 3; row < silo.base; row += 1) {
        for (let column = silo.left + 1; column < silo.right; column += 1) {
          if (!frame.has(key({ x: column, y: row }))) silo.storageCells.push({ x: column, y: row });
        }
      }
    }
    if ([...frameCells, ...cores, ...extra, ...basement.values()].some((cell) => reserved.has(key(cell))) ||
        frameCells.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY) ||
        [...cores, ...extra].some((cell) => world.at(cell.x, cell.y) !== PARTICLE_TERRAIN) ||
        [...basement.values()].some((cell) => ![PARTICLE_EMPTY, PARTICLE_TERRAIN].includes(world.at(cell.x, cell.y))) ||
        floorSections.some((span) => Array.from({ length: span.right - span.left + 1 }, (_, dx) =>
          world.at(span.left + dx, span.y + 1)).some((material) => material !== PARTICLE_TERRAIN))) continue;
    const interlock = building.type === 'military' ? prepareMilitaryInterlock(world, entries, frame, poles, reserved) : { cells: [], hosts: [] };
    frameCells.push(...interlock.cells);
    return { ok: true, foundationRows, seedPlacement, basementCells: [...basement.values()], floorSections,
      geometry: { poles, frameCells, seeds: seedPlacement.map(({ x, y }) => ({ x, y })),
        bounds: { left: Math.min(spans[0].left, ...interlock.cells.map((cell) => cell.x)),
          right: Math.max(spans[spans.length - 1].right, ...interlock.cells.map((cell) => cell.x)) } },
      foundationCells: extra, metadata: { type: building.type, level: building.level, cores: count,
        ...(compact ? { owner, style } : {}),
        ...(tower ? { height: tower.height, trooperHeight: populationScale.trooperHeight,
          floorHeight: tower.floorHeight } : {}),
        width: spans[spans.length - 1].right - spans[0].left + 1, spacing,
        ...(!farm ? { poles: [...poles] } : {}),
        ...(building.type === 'military' ? { interlockingHosts: interlock.hosts,
          interlockingCells: interlock.cells.map((cell) => ({ ...cell })) } : {}),
        ...(farm ? { silos: siloPlans, desiredSilos } : {}) }, surfaceY: ground(x) };
  }
  return { ok: false, reason: `Not enough dry, supported space for ${count} ${building.type} cores. ` +
    `Small core slopes up to ${building.type === 'military' ? 4 : 2} cells and overall height differences up to ` +
    `${building.type === 'military' ? 32 : 24} cells are allowed; neighbors, water and tunnels still block placement.` };
}

function createSharedPixelMapConstruction(source, options = {}) {
    if (!options || (options.seedGrowth !== undefined && typeof options.seedGrowth !== 'boolean') ||
        (options.fullMap !== undefined && typeof options.fullMap !== 'boolean') ||
        (options.economy !== undefined && !['funded', 'mined'].includes(options.economy)) ||
        (options.crew !== undefined && (!options.crew || typeof options.crew !== 'object')) ||
        (options.waterCaves !== undefined && typeof options.waterCaves !== 'boolean')) {
      throw new Error('Invalid shared seed-growth option');
    }
    const minedEconomy = options.economy === 'mined';
    const pace = options.crew ? { crew: options.crew.crew, stride: options.crew.stride,
      deliveryInterval: options.crew.deliveryInterval } : {};
    // Faction buildings (outer fifths of the map) start empty and grow only from mined HM deliveries.
    const funding = (worldWidth, centerX, fundedHM) => ({ ...pace,
      ...(minedEconomy && (centerX < worldWidth * 0.2 || centerX >= worldWidth * 0.8) ?
        { initialHM: 0, paidGrowth: true } : fundedHM === undefined ? {} : { initialHM: fundedHM }) });
    if (!source || !Number.isInteger(source.width) || source.width < 300 ||
        !Array.isArray(source.heights) || source.heights.length !== source.width ||
        !Array.isArray(source.waterLevels) || source.waterLevels.length !== source.width ||
        !Array.isArray(source.tunnels) || !Number.isInteger(source.height) || source.height < 90 ||
        source.cellSize !== 4 || !source.heights.every(Number.isFinite) ||
        !source.waterLevels.every((level) => level === null || Number.isFinite(level))) {
      throw new Error('Shared generated construction requires at least 300 source columns');
    }
    const candidates = [];
    const siteSearch = { scanned: 0, slope: 0, unevenBase: 0, wetSeed: 0, footprint: 0, suitable: 0 };
    for (let offset = 0; offset <= source.width - 160; offset += 1) {
        siteSearch.scanned += 1;
        const rows = [60, 80, 100].map((x) => Math.ceil(source.heights[offset + x] / 4 - 0.5));
        if (Math.max(...rows) - Math.min(...rows) > 12) { siteSearch.slope += 1; continue; }
        if (![60, 80, 100].every((pole, index) => [0, 1, 2].every((dx) =>
          Math.ceil(source.heights[offset + pole + dx] / 4 - 0.5) === rows[index]))) {
          siteSearch.unevenBase += 1; continue;
        }
        if (![60, 80, 100].every((pole, index) => [0, 1, 2].every((dx) => {
              const x = offset + pole + dx;
              return source.waterLevels[x] === null || source.waterLevels[x] > (rows[index] - 0.5) * 4;
            }))) { siteSearch.wetSeed += 1; continue; }
        const crop = { ...source, width: 160,
          heights: source.heights.slice(offset, offset + 160),
          waterLevels: source.waterLevels.slice(offset, offset + 160),
          tunnels: source.tunnels.map((tunnel) => ({ ...tunnel,
            points: tunnel.points.map((point) => ({ x: point.x - offset * 4, y: point.y })) })) };
        try {
          candidates.push({ offset, entry: createPixelMapConstructionScenario(crop,
            { deliveryMode: 'inside', buriedCore: true, connectingFloors: true }) });
        } catch (error) {
          if (!error.message.startsWith('No clear, supported frame site')) throw error;
          siteSearch.footprint += 1;
          continue;
        }
    }
    siteSearch.suitable = candidates.length;
    for (let first = 0; first < candidates.length; first += 1) {
      let group = null;
      if (options.fullMap) {
        group = [];
        for (const candidate of candidates) {
          if (!group.length || candidate.offset - group[group.length - 1].offset >= 110) group.push(candidate);
        }
        if (group.length < 3) break;
      }
      for (let second = first + 1; second < candidates.length && !group; second += 1) {
        if (candidates[second].offset - candidates[first].offset > 500) break;
        if (candidates[second].offset - candidates[first].offset < 55) continue;
        for (let third = second + 1; third < candidates.length; third += 1) {
          if (candidates[third].offset - candidates[first].offset > 500) break;
          if (candidates[third].offset - candidates[second].offset < 55) continue;
          const prospective = [candidates[first], candidates[second], candidates[third]];
          const origin = Math.min(...prospective.map(({ entry }) => entry.originY));
          if (prospective.some(({ entry }) => entry.floorSections.some((floor) =>
            floor.y + entry.originY - origin >= 89))) continue;
          group = prospective; break;
        }
      }
      if (!group) continue;
      const start = options.fullMap ? 0 : group[0].offset;
      const width = options.fullMap ? source.width : group[2].offset - start + 160;
      const height = options.fullMap ? source.height : 90;
      const prepared = group.map(({ entry }) => entry);
      const originY = options.fullMap ? 0 : Math.min(...prepared.map((entry) => entry.originY));
      if (prepared.some((entry) => entry.floorSections.some((floor) =>
        floor.y + entry.originY - originY >= height - 1))) continue;
      const world = createParticleWorldFromSurfaceWaterAndTunnels(
        { heightAt: (x) => source.heights[Math.floor(x / 4)] },
        (x) => source.waterLevels[Math.floor(x / 4)], source.tunnels,
        { width, height, cellSize: 4, originX: start * 4, originY: originY * 4,
          supportCapacity: source.populationScale && options.fullMap ? 1024 : 128, skipEmptyChunks: true });
      if (options.fullMap) world.configureDebrisMerging(600);
      // Underground water pockets are part of the generated terrain, so carve them before the baseline snapshot.
      const waterCaves = options.fullMap && options.waterCaves !== false ? carvePixelWaterCaves(world) : [];
      const baseline = world.snapshot(), entries = [];
      for (let index = 0; index < prepared.length; index += 1) {
        if (options.fullMap && source.populationScale) {
          // The compact tower may not fit at the exact candidate column on this terrain, so try nearby centers
          // (each still fully validated against neighbors, water and tunnels) before giving up.
          let site = null;
          for (let shift = 0; shift <= 40 && !(site && site.ok); shift += 1) {
            for (const sign of shift ? [1, -1] : [1]) {
              const attempt = prepareAdaptivePixelSeed(world, source, start, originY, entries,
                group[index].offset + 80 + sign * shift, { type: 'population', level: 3 });
              if (!site || attempt.ok) site = attempt;
              if (site.ok) break;
            }
          }
          if (!site.ok) throw new Error(`Compact population placement failed: ${site.reason}`);
          site = withPixelSiteFacade(world, stylePixelAdaptiveSite(world, entries, shapePixelPopulationSite(world, entries, site)));
          for (const cell of site.basementCells) {
            if (world.at(cell.x, cell.y) === PARTICLE_TERRAIN) world.excavate(cell.x, cell.y, cell.x, cell.y);
          }
          const scenario = createPixelConstructionScenario(5, { world, geometry: site.geometry,
            foundationRows: site.foundationRows, deliveryMode: 'inside', buriedCore: true,
            foundationCells: site.foundationCells, ...funding(width, (site.geometry.bounds.left + site.geometry.bounds.right) / 2,
              site.geometry.frameCells.length + 1000) });
          entries.push({ scenario, basementCells: site.basementCells, tunnelCells: new Set(),
            seedPlacement: site.seedPlacement, floorSections: site.floorSections, building: site.metadata });
          continue;
        }
        const entry = prepared[index], dx = group[index].offset - start, dy = entry.originY - originY;
        const translate = (cell) => ({ x: cell.x + dx, y: cell.y + dy });
        const basementCells = entry.basementCells.map(translate);
        for (const cell of basementCells) {
          if (world.at(cell.x, cell.y) === PARTICLE_TERRAIN) world.excavate(cell.x, cell.y, cell.x, cell.y);
        }
        const foundationRows = [60, 80, 100].map((pole) =>
          Math.min(...entry.scenario.inspectCore().cells.filter((cell) => cell.x === pole).map((cell) => cell.y)) + dy);
        const seedPlacement = [60, 80, 100].flatMap((pole, base) => [0, 1, 2].map((offset) => {
          const x = pole + dx + offset, groundY = foundationRows[base], y = groundY - 1;
          if (baseline.cells[y * width + x] !== PARTICLE_EMPTY ||
              baseline.cells[groundY * width + x] !== PARTICLE_TERRAIN) {
            throw new Error(`Shared seed placement requires dry local surface at (${x}, ${y})`);
          }
          return { x, y, groundY, sourceColumn: start + x };
        }));
        const poles = [60, 80, 100].map((pole) => pole + dx);
        const scale = options.fullMap && source.populationScale;
        const tower = scale ? createPixelPopulationFrame(poles, foundationRows,
          pixelPopulationHeight(scale, 3), Math.ceil(scale.trooperHeight), undefined, 'modern',
          scale.trooperClearance || 0) : null;
        if (tower && (tower.roof < 1 || tower.cells.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY))) {
          throw new Error('Population skyscraper needs clear sky above its complete physical footprint');
        }
        const scenario = createPixelConstructionScenario(5, { world, poleOffset: dx, foundationRows,
          deliveryMode: 'inside', buriedCore: true, foundationCells: entry.scenario.foundationCells.map(translate),
          ...(tower ? { geometry: { poles, frameCells: tower.cells, seeds: seedPlacement,
            bounds: { left: poles[0], right: poles[poles.length - 1] + 2 } } } : {}),
          ...funding(width, dx + 81, tower ? tower.cells.length + 1000 : undefined) });
        const tunnelCells = new Set([...entry.tunnelCells].map((key) => {
          const cell = translate({ x: key % 160, y: Math.floor(key / 160) });
          return cell.y * world.width + cell.x;
        }));
        entries.push({ scenario, basementCells, tunnelCells, seedPlacement,
          ...(tower ? { building: { type: 'population', level: 3, cores: poles.length, poles, spacing: 20,
            width: poles[poles.length - 1] - poles[0] + 3, height: tower.height,
            trooperHeight: scale.trooperHeight, floorHeight: tower.floorHeight } } : {}),
          floorSections: entry.floorSections.map((floor) =>
            ({ left: floor.left + dx, right: floor.right + dx, y: floor.y + dy })) });
      }
      const combined = { world, plan: entries.flatMap(({ scenario }) => scenario.plan),
        freeMaterial: entries.reduce((sum, { scenario }) => sum + scenario.freeMaterial, 0) };
      const terrainIntegrity = verifyPixelMapPlacementTerrain(combined, baseline, entries.flatMap((entry) => entry.basementCells));
      const original = world.snapshot(), initialWater = world.waterCount;
      if (options.seedGrowth === true) {
        world.restore(baseline);
        entries.forEach((entry) => entry.scenario.startFoundationGrowth(entry.basementCells));
      }
      let destroyed = 0, cleared = 0;
      let combat = null;
      let upkeep = null;
      const farms = createPixelCityFarms(world, entries, (x) =>
        world.debrisMergeTicks ? world.surfaceRow(x) : Math.ceil(source.heights[start + x] / 4 - 0.5) - originY, waterCaves);
      const military = createPixelCityMilitary(world, entries);
      let roads = [];
      function roadAvailable(road) {
        if (![road.from, road.to].every((index) =>
          entries[index].scenario.finished && !entries[index].scenario.coreDestroyed)) return false;
        const reserved = new Set(entries.filter((entry, index) => index !== road.from && index !== road.to)
          .flatMap((entry) => [...entry.scenario.plan, ...entry.basementCells].map((cell) => cell.y * width + cell.x)));
        return !farms.populationBlocked(road.cells) && road.cells.every((cell) =>
          cell.y >= 1 && world.at(cell.x, cell.y) === PARTICLE_EMPTY &&
          world.at(cell.x, cell.y + 1) === PARTICLE_TERRAIN && !reserved.has(cell.y * width + cell.x));
      }
      function updateRoads() {
        const population = entries.filter((entry) => entry.building && entry.building.type === 'population')
          .sort((a, b) => a.building.poles[0] - b.building.poles[0]);
        roads = [];
        for (let i = 1; i < population.length; i += 1) {
          const a = population[i - 1], b = population[i];
          if (!a.scenario.finished || !b.scenario.finished || a.scenario.coreDestroyed || b.scenario.coreDestroyed) continue;
          const left = a.building.poles[a.building.poles.length - 1] + 3, right = b.building.poles[0] - 1;
          if (right < left || right - left + 1 > 40) continue;
          const path = Array.from({ length: right - left + 1 }, (_, dx) => {
            const x = left + dx; return { x, y: (world.debrisMergeTicks ? world.surfaceRow(x) :
              Math.ceil(source.heights[start + x] / 4 - 0.5) - originY) - 1 };
          });
          const road = { from: entries.indexOf(a), to: entries.indexOf(b), cells: path };
          if (!roadAvailable(road) || path.some((cell, index) =>
              index > 0 && Math.abs(cell.y - path[index - 1].y) > 2)) continue;
          roads.push(road);
        }
      }
      function inspectUrbanDetails() {
        return inspectPixelUrbanDetails(world, entries, roads.filter(roadAvailable), farms);
      }
      const transported = () => entries.reduce((sum, { scenario }) => sum + scenario.transportedMaterialCount, 0);
      let verifiedPlans = null;
      function verify() {
        const plans = entries.map(({ scenario }) => [scenario.plan, scenario.plan.length]);
        if (!verifiedPlans || verifiedPlans.length !== plans.length ||
            plans.some(([plan, length], index) => verifiedPlans[index][0] !== plan || verifiedPlans[index][1] !== length)) {
          const owners = new Set();
          for (const entry of entries) for (const cell of entry.scenario.plan) {
            const key = cell.y * width + cell.x;
            if (owners.has(key)) throw new Error('Shared structural pixel has more than one building owner');
            owners.add(key);
          }
          verifiedPlans = plans;
        }
        const spent = entries.reduce((sum, { scenario }) => sum + scenario.spent, 0);
        const combatState = combat && combat.inspect({ sprites: false });
        const impactMaterial = combatState ? combatState.terrainDebris + combatState.issuedAmmoDebris : 0;
        const material = world.barrierCount + world.constructionCount + world.debrisCount + world.mergedDebrisCount +
          transported() + destroyed + cleared;
        const expected = entries.reduce((sum, { scenario }) => sum + scenario.freeMaterial, 0) + spent + impactMaterial;
        const hmBroken = entries.findIndex(({ scenario }) => scenario.hm !== scenario.initialHM + (scenario.received || 0) -
          scenario.spent - (scenario.growthPaid || 0) - (scenario.issued || 0));
        if (world.waterCount !== initialWater || material !== expected || hmBroken >= 0) {
          throw new Error('Shared generated terrain material, water or HM accounting failed' +
            ` (water ${world.waterCount}/${initialWater}, material ${material}/${expected}, HM building ${hmBroken})`);
        }
      }
      function selected(index) {
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) throw new Error('Invalid shared building selection');
        return entries[index];
      }
      verify();
      const city = { world, entries, original, initialWater, terrainIntegrity, siteSearch: { ...siteSearch }, originX: start, originY,
        waterCaves, waterCavesEnabled: Boolean(options.fullMap && options.waterCaves !== false),
        inspectAquifers: () => farms.inspectAquifers(),
        attachCombat(model) {
          if (combat || !model || model.world !== world || typeof model.inspect !== 'function') {
            throw new Error('Shared city combat must use this world and attach only once');
          }
          combat = model;
          verify();
        },
        verify, inspectFarm: (index) => farms.inspect(index),
        enableUpkeep() {
          if (!upkeep) upkeep = createPixelCityUpkeep(world, entries, farms);
          return upkeep;
        },
        inspectUpkeep: () => upkeep ? upkeep.inspect() : null,
        isSupplied: (index) => upkeep ? upkeep.supplied(index) : true,
        spendBuildingSM: (index, amount) => upkeep ? upkeep.spend(index, amount) : true,
        buildingSM: (index) => upkeep ? upkeep.sm(index) : Infinity,
        inspectSMStorage: () => farms.inspectStorage(), spendSM: (amount) => farms.spendSM(amount),
        inspectMilitary: () => military.inspect(),
        repairBuilding(index) {
          verify();
          const { scenario } = selected(index);
          const reject = (reason) => ({ ok: false, reason });
          if (!scenario.finished || scenario.coreDestroyed) return reject('Manual repair requires a completed building with a living core.');
          const missing = scenario.plan.filter((cell) => world.at(cell.x, cell.y) !== PARTICLE_BARRIER);
          if (!missing.length) return reject('The selected frame is already intact.');
          if (missing.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY)) {
            return reject('Clear debris, water or other occupied repair targets before repairing the frame.');
          }
          if (missing.length > scenario.hm) return reject('Not enough remaining HM to repair the complete frame.');
          scenario.extendStructure([]);
          verify();
          return { ok: true, repairPixels: missing.length };
        },
        inspectRoads: () => roads.filter(roadAvailable)
          .map((road) => ({ ...road, cells: road.cells.map((cell) => ({ ...cell })) })),
        inspectUrbanDetails,
        levelUpPopulation(index) {
          const entry = selected(index);
          if (!entry.building || entry.building.type !== 'population') {
            return { ok: false, reason: 'Select an added population building to level up.' };
          }
          return city.levelUpBuilding(index);
        },
        levelUpMilitary(index) {
          const entry = selected(index);
          if (!entry.building || entry.building.type !== 'military') {
            return { ok: false, reason: 'Select an added military building to level up.' };
          }
          return city.levelUpBuilding(index);
        },
        levelUpBuilding(index) {
          verify();
          const entry = selected(index), building = entry.building, scenario = entry.scenario;
          const reject = (reason) => ({ ok: false, reason });
          if (!building || !['population', 'military'].includes(building.type)) return reject('Select an added population or military building to level up.');
          if (building.level >= 7) return reject('Building is already at level 7.');
          if (building.variant) return reject('Shaped towers keep their style-lab silhouette; they cannot level up yet.');
          if (!scenario.finished || scenario.coreDestroyed) return reject('Finish construction with a living core before leveling up.');
          if (!city.isSupplied(index)) return reject('Population growth and military expansion wait for delivered SM upkeep.');
          const isMilitary = building.type === 'military';
          const troopBay = source.populationScale && !isMilitary && source.populationScale.trooperWidth;
          const minimumSpacing = source.populationScale ? troopBay ? troopBay + 1 : 6 : isMilitary ? 12 : 8;
          const level = building.level + 1, target = isMilitary ? level >= 4 ? 4 : 3 : Math.min(5, 2 + Math.floor((level - 1) / 2));
          const key = (cell) => cell.y * width + cell.x;
          const oldKeys = new Set(scenario.plan.map(key)), frame = new Map();
          const put = (map, x, y) => { if (!oldKeys.has(y * width + x)) map.set(y * width + x, { x, y }); };
          const poles = [...building.poles], ground = (x) => world.debrisMergeTicks &&
            !building.poles.some((pole) => x >= pole && x <= pole + 2) ? world.surfaceRow(x) :
            Math.ceil(source.heights[start + x] / 4 - 0.5) - originY;
          const coreGround = (pole) => Math.max(...[0, 1, 2].map((dx) => ground(pole + dx)));
          const interlockKeys = new Set((building.interlockingCells || []).map(key));
          const ornamentKeys = new Set((building.ornamentCells || []).map(key));
          const body = scenario.plan.filter((cell) => !interlockKeys.has(key(cell)) && !ornamentKeys.has(key(cell)));
          const oldRight = Math.max(...body.map((cell) => cell.x));
          const oldRoof = Math.min(...body.filter((cell) => !isMilitary || cell.x === oldRight).map((cell) => cell.y));
          const towerHeight = building.trooperHeight ? pixelPopulationHeight(source.populationScale, level) : null;
          const roof = oldRoof - (isMilitary ? 0 : towerHeight ? towerHeight - building.height : 2);
          if (roof < 1) return reject('The next skyscraper floor exceeds the preview crop height.');
          if (isMilitary && world.at(oldRight, roof) !== PARTICLE_BARRIER) {
            return reject('Repair the military boundary before expanding its connected annex.');
          }
          let extension = null;
          const basement = [], free = new Map();
          if (poles.length < target) {
            const pole = poles[poles.length - 1] + Math.min(12, building.spacing,
              width - 6 - poles[poles.length - 1]);
            if (pole - poles[poles.length - 1] < minimumSpacing) return reject(`No space for the next descendant core with minimum ${building.type} spacing.`);
            if (pole + 5 >= width) return reject('No space in this crop for the next descendant core.');
            const rows = [0, 1, 2].map((dx) => ground(pole + dx)), groundY = Math.max(...rows);
            if (Math.max(...rows) - Math.min(...rows) > (isMilitary ? 4 : 2) || groundY > height - 5 ||
                (isMilitary ? Math.max(...poles.map(coreGround), groundY) -
                  Math.min(...poles.map(coreGround), groundY) > 32 :
                  Math.abs(groundY - ground(poles[poles.length - 1])) > 24)) {
              return reject(`Next descendant core needs dry supported terrain within ${building.type} slope limits.`);
            }
            const floor = Math.max(...Array.from({ length: pole - poles[poles.length - 1] + 3 },
              (_, dx) => ground(poles[poles.length - 1] + dx))) + 3;
            if (floor >= height - 1) return reject('Next descendant floor exceeds the crop.');
            const oldRight = poles[poles.length - 1] + 2;
            const oldFloor = entry.floorSections[entry.floorSections.length - 1].y;
            for (let y = Math.min(oldFloor, floor); y <= Math.max(oldFloor, floor); y += 1) put(free, oldRight, y);
            for (let x = oldRight + 1; x <= pole + 2; x += 1) {
              put(free, x, floor);
              for (let y = ground(x); y < floor; y += 1) {
                if (x >= pole) put(free, x, y);
                else basement.push({ x, y });
              }
            }
            const coreCells = [0, 1, 2].flatMap((dx) => [0, 1, 2].map((dy) => ({ x: pole + dx, y: groundY + dy })));
            const seeds = [0, 1, 2].map((dx) => ({ x: pole + dx, y: rows[dx] - 1 }));
            for (const cell of [...coreCells, ...seeds]) put(free, cell.x, cell.y);
            extension = { pole, groundY, coreCells, seeds, freeCells: [...free.values()], basementCells: basement,
              floorSection: { left: oldRight, right: pole + 2, y: floor } };
            poles.push(pole);
          }
          if (towerHeight) {
            const surfaceRows = poles.map((pole) => [0, 1, 2].map((dx) => ground(pole + dx)));
            const tower = createPixelPopulationFrame(poles, poles.map(coreGround), towerHeight,
              building.floorHeight, surfaceRows, building.style || 'modern', source.populationScale.trooperClearance || 0);
            for (const cell of tower.cells) if (!free.has(key(cell))) put(frame, cell.x, cell.y);
          }
          const framePoles = towerHeight ? [] : isMilitary ? poles.slice(building.poles.length) : poles;
          for (const pole of framePoles) for (let dx = 0; dx < 3; dx += 1) {
            for (let y = roof; y < ground(pole + dx); y += 1) {
              if (y > roof && y < oldRoof && dx === 1) continue;
              if (!free.has((y * width + pole + dx))) put(frame, pole + dx, y);
            }
          }
          if (extension && !towerHeight) {
            for (let x = building.poles[building.poles.length - 1]; x <= poles[poles.length - 1] + 2; x += 1) {
              for (let y = oldRoof; y <= oldRoof + 8; y += 4) put(frame, x, y);
            }
          }
          const right = isMilitary ? extension ? poles[poles.length - 1] + 2 : oldRight + 2 : poles[poles.length - 1] + 2;
          if (isMilitary && !extension) {
            if (right >= width - 3) return reject('The wider military annex exceeds the preview crop.');
            const rows = [ground(oldRight), ground(oldRight + 1), ground(right)];
            if (Math.max(...rows) - Math.min(...rows) > 4 ||
                Math.max(...poles.map(coreGround), ...rows) -
                  Math.min(...poles.map(coreGround), ...rows) > 32) {
              return reject('Wider military annex needs terrain within military slope limits.');
            }
            for (let x = oldRight + 1; x <= right; x += 1) {
              if (ground(x) <= roof || ground(x) >= height - 1 || world.at(x, ground(x)) !== PARTICLE_TERRAIN) {
                return reject('Wider military annex needs intact dry ground support.');
              }
              for (let y = roof; y < ground(x); y += 1) put(frame, x, y);
            }
          }
          const others = pixelBuildingReservations(entries.filter((other) => other !== entry), width);
          let newOrnaments = [];
          if (building.ornamentCells && building.style) {
            const seeds = [...entry.seedPlacement, ...(extension ? extension.seeds : [])];
            const frameCells = [...body, ...frame.values(), ...free.values()].filter((cell) => cell.y < ground(cell.x));
            const center = Math.floor((poles[0] + poles[poles.length - 1] + 2) / 2);
            const styled = stylePixelBuildingGeometry(world, { ok: true, geometry: { poles, frameCells,
              seeds: seeds.map(({ x, y }) => ({ x, y })),
              bounds: { left: Math.min(...frameCells.map((cell) => cell.x)), right: Math.max(...frameCells.map((cell) => cell.x)) } },
              foundationCells: [], basementCells: [...entry.basementCells, ...basement], foundationRows: poles.map(coreGround),
              metadata: { type: building.type, silos: building.silos }, surfaceY: ground(center) }, building.style);
            const added = [...styled.ornamentCells, ...styled.structureCells].filter((cell) => !oldKeys.has(key(cell)));
            if (!added.some((cell) => others.has(key(cell)))) {
              for (const cell of added) put(frame, cell.x, cell.y);
              newOrnaments = styled.ornamentCells.filter((cell) => !oldKeys.has(key(cell)));
            }
          }
          const cells = [...frame.values(), ...free.values()];
          if (cells.some((cell) => others.has(key(cell)) || (free.has(key(cell))
              ? ![PARTICLE_TERRAIN, PARTICLE_EMPTY].includes(world.at(cell.x, cell.y))
              : world.at(cell.x, cell.y) !== PARTICLE_EMPTY)) ||
              basement.some((cell) => others.has(key(cell)) || ![PARTICLE_TERRAIN, PARTICLE_EMPTY].includes(world.at(cell.x, cell.y))) ||
              !isMilitary && farms.populationBlocked([...cells, ...basement])) {
            return reject('Level-up footprint is blocked by another building, farmland, water or debris.');
          }
          if (extension && (extension.coreCells.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_TERRAIN) ||
              extension.freeCells.some((cell) => !extension.seeds.some((seed) => key(seed) === key(cell)) &&
                world.at(cell.x, cell.y) !== PARTICLE_TERRAIN) ||
              extension.seeds.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY ||
                world.at(cell.x, cell.y + 1) !== PARTICLE_TERRAIN) ||
              Array.from({ length: extension.floorSection.right - extension.floorSection.left + 1 }, (_, dx) =>
                world.at(extension.floorSection.left + dx, extension.floorSection.y + 1)).some((material) => material !== PARTICLE_TERRAIN))) {
            return reject('Descendant core and floor need intact dry terrain support.');
          }
          const paid = [...frame.values()].filter((cell) => !free.has(key(cell)));
          const repairs = scenario.plan.filter((cell) => world.at(cell.x, cell.y) !== PARTICLE_BARRIER);
          if (repairs.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY)) {
            return reject('Clear occupied damaged frame pixels before leveling up.');
          }
          if (paid.length + repairs.length > scenario.hm) return reject('Not enough remaining HM for the complete level-up frame and existing repairs.');
          scenario.extendStructure(paid, extension);
          if (isMilitary) farms.clearMilitary([...cells, ...basement]);
          if (extension) {
            entry.basementCells.push(...basement);
            entry.floorSections.push(extension.floorSection);
            entry.seedPlacement.push(...extension.seeds.map((cell) => ({ ...cell, groundY: cell.y + 1, sourceColumn: start + cell.x })));
            for (const cell of basement) if (original.cells[key(cell)] === PARTICLE_TERRAIN) original.cells[key(cell)] = PARTICLE_EMPTY;
            for (const cell of free.values()) original.cells[key(cell)] = PARTICLE_BARRIER;
          }
          Object.assign(building, { level, poles, cores: poles.length, width: right - poles[0] + 1,
            ...(towerHeight ? { height: towerHeight } : {}),
            ...(building.ornamentCells ? { ornamentCells: [...building.ornamentCells, ...newOrnaments.map((cell) => ({ ...cell }))],
              ornamentCount: building.ornamentCells.length + newOrnaments.length } : {}) });
          verify();
          return { ok: true, level, cores: poles.length, paidPixels: paid.length, repairPixels: repairs.length };
        },
        get destroyed() { return destroyed; }, get cleared() { return cleared; },
        step(options = {}) {
          if (!options || options.onDebrisMove !== undefined && typeof options.onDebrisMove !== 'function') {
            throw new Error('Invalid shared physics step observer');
          }
          world.step(undefined, false, options.onDebrisMove);
          entries.forEach(({ scenario }) => scenario.step({ advanceWorld: false }));
          farms.step();
          if (upkeep) upkeep.step();
          updateRoads();
          verify();
        },
        addSeed(x, previewOnly = false, building = null) {
          verify();
          const reject = (reason) => ({ ok: false, reason });
          if (!Number.isInteger(x) || (building ? x < 4 || x + 5 >= world.width : x < 24 || x + 25 >= world.width)) {
            return reject('The complete building and delivery footprint must fit inside this crop.');
          }
          let adaptive = null;
          if (building) {
            adaptive = withPixelSiteFacade(world, stylePixelAdaptiveSite(world, entries, shapePixelPopulationSite(world, entries,
              prepareAdaptivePixelSeed(world, source, start, originY, entries, x, building), (cells) => farms.populationBlocked(cells))));
            if (!adaptive.ok) return adaptive;
          }
          const offset = start + x - 81;
          if (!adaptive && (offset < 0 || offset + 160 > source.width)) return reject('Site extends beyond the source map.');
          const crop = { ...source, width: 160,
            heights: source.heights.slice(offset, offset + 160),
            waterLevels: source.waterLevels.slice(offset, offset + 160),
            tunnels: source.tunnels.map((tunnel) => ({ ...tunnel,
              points: tunnel.points.map((point) => ({ x: point.x - offset * 4, y: point.y })) })) };
          let template;
          try {
            if (!adaptive) {
            template = createPixelMapConstructionScenario(crop,
              { deliveryMode: 'inside', buriedCore: true, connectingFloors: true });
            }
          } catch (error) {
            if (!error.message.startsWith('No clear, supported frame site')) throw error;
            return reject('Site needs dry, level three-column bases, a seed-height range of at most 12 cells, clear floors and intact support.');
          }
          const dx = adaptive ? 0 : x - 81, dy = adaptive ? 0 : template.originY - originY;
          const translate = (cell) => ({ x: cell.x + dx, y: cell.y + dy });
          const plan = adaptive ? [...adaptive.geometry.frameCells,
            ...adaptive.foundationCells, ...adaptive.geometry.poles.flatMap((pole, index) =>
              [0, 1, 2].flatMap((dx) => [0, 1, 2].map((dy) =>
                ({ x: pole + dx, y: adaptive.foundationRows[index] + dy }))))]
            : template.scenario.plan.map(translate);
          const basementCells = adaptive ? adaptive.basementCells : template.basementCells.map(translate);
          if ((!building || building.type !== 'military') && farms.populationBlocked([...plan, ...basementCells])) {
            return reject('Population buildings and farm silos cannot be placed on farmland. Military buildings may occupy fields.');
          }
          const occupied = pixelBuildingReservations(entries, width);
          if ([...plan, ...basementCells].some((cell) => cell.y < 0 || cell.y >= height - 1 ||
              occupied.has(cell.y * width + cell.x))) {
            return reject('The site overlaps an existing building/basement or exceeds the shared vertical crop.');
          }
          const foundationRows = adaptive ? adaptive.foundationRows : [60, 80, 100].map((pole) =>
            Math.min(...template.scenario.inspectCore().cells.filter((cell) => cell.x === pole).map((cell) => cell.y)) + dy);
          const seedPlacement = adaptive ? adaptive.seedPlacement : [60, 80, 100].flatMap((pole, base) => [0, 1, 2].map((part) =>
            ({ x: pole + dx + part, y: foundationRows[base] - 1,
              groundY: foundationRows[base], sourceColumn: start + pole + dx + part })));
          if (seedPlacement.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY ||
              world.at(cell.x, cell.groundY) !== PARTICLE_TERRAIN) ||
              basementCells.some((cell) => ![PARTICLE_EMPTY, PARTICLE_TERRAIN].includes(world.at(cell.x, cell.y)))) {
            return reject('Current seed sites or basement are occupied, flooded or missing original terrain support.');
          }
          const snapshot = world.snapshot();
          const trial = createParticleWorld(width, height, { supportCapacity: 128, skipEmptyChunks: true });
          trial.restore(snapshot);
          const options = { poleOffset: dx, foundationRows, deliveryMode: 'inside',
            buriedCore: true, foundationCells: adaptive ? adaptive.foundationCells : template.scenario.foundationCells.map(translate),
            ...funding(width, x, adaptive && (adaptive.metadata.height || adaptive.metadata.ornamentCount) ?
              adaptive.geometry.frameCells.length + 1000 : undefined),
            geometry: adaptive ? adaptive.geometry : undefined };
          for (const cell of basementCells) {
            if (trial.at(cell.x, cell.y) === PARTICLE_TERRAIN) trial.excavate(cell.x, cell.y, cell.x, cell.y);
          }
          try { createPixelConstructionScenario(5, { ...options, world: trial }); }
          catch (error) {
            if (!error.message.startsWith('Pixel construction requires clear sites') &&
                !error.message.startsWith('Connecting foundation requires supported cells')) throw error;
            return reject('Current building footprint is obstructed or lacks terrain support.');
          }
          if (previewOnly) return { ok: true, surfaceY: adaptive ? adaptive.surfaceY : foundationRows[1],
            building: adaptive ? adaptive.metadata : null };
          for (const cell of basementCells) {
            if (world.at(cell.x, cell.y) === PARTICLE_TERRAIN) world.excavate(cell.x, cell.y, cell.x, cell.y);
          }
          const scenario = createPixelConstructionScenario(5, { ...options, world });
          world.restore(snapshot);
          scenario.startFoundationGrowth(basementCells);
          if (building && building.type === 'military') farms.clearMilitary([...plan, ...basementCells]);
          const tunnelCells = adaptive ? new Set() : new Set([...template.tunnelCells].map((key) => {
            const cell = translate({ x: key % 160, y: Math.floor(key / 160) });
            return cell.y * width + cell.x;
          }));
          entries.push({ scenario, basementCells, seedPlacement, tunnelCells,
            building: adaptive ? adaptive.metadata : null,
            floorSections: adaptive ? adaptive.floorSections : template.floorSections.map((floor) =>
              ({ left: floor.left + dx, right: floor.right + dx, y: floor.y + dy })) });
          for (const cell of basementCells) {
            if (original.cells[cell.y * width + cell.x] === PARTICLE_TERRAIN) original.cells[cell.y * width + cell.x] = PARTICLE_EMPTY;
          }
          for (const cell of scenario.plan.filter((cell) => cell.distance === 0)) {
            original.cells[cell.y * width + cell.x] = PARTICLE_BARRIER;
          }
          verify();
          return { ok: true, index: entries.length - 1, building: adaptive ? adaptive.metadata : null };
        },
        blastCore(index, core) {
          const entry = selected(index);
          verify();
          const before = world.barrierCount + world.constructionCount + world.debrisCount + transported();
          const removed = entry.scenario.blastCore(core);
          destroyed += before - world.barrierCount - world.constructionCount - world.debrisCount - transported();
          verify(); return removed;
        },
        excavateFloor(index, floor) { const result = excavatePixelFloorGround(selected(index), floor); verify(); return result; },
        clearDebris() { const removed = entries[0].scenario.clearDebris(); cleared += removed; verify(); return removed; },
        restoreTerrain() {
          if (entries.some(({ scenario }) => !scenario.foundationGrowth.complete)) {
            throw new Error('Terrain restoration is unavailable during seed growth');
          }
          const result = restorePixelMapTerrain(world, original); verify(); return result;
        },
      };
      return city;
    }
    throw new Error((options.fullMap ? 'No three separated supported full-world building sites found; ' :
      'No three compatible generated building sites found; ') + 'generate another map. Terrain was not flattened. ' +
      `Checked ${siteSearch.scanned} sites: ${siteSearch.slope} exceed the 12-cell seed-height range; ` +
      `${siteSearch.unevenBase} have uneven 3-column bases; ${siteSearch.wetSeed} have flooded seeds; ` +
      `${siteSearch.footprint} fail full footprint/crop/support clearance (including water or tunnels); ` +
      `${siteSearch.suitable} pass individually but do not form ${options.fullMap ? 'a separated full-world group' : 'a compatible spaced triple in one crop'}.`);
  }
function inspectPixelMapCell(imported, original, x, y) {
  const { scenario, floorSections, basementCells } = imported, { world } = scenario;
  if (!Number.isInteger(x) || !Number.isInteger(y) ||
      x < 0 || x >= world.width || y < 0 || y >= world.height) {
    throw new Error('Cell inspection requires integer coordinates inside the crop');
  }
  if (!original || original.width !== world.width || original.height !== world.height ||
      !original.cells || original.cells.length !== world.width * world.height) {
    throw new Error('Cell inspection baseline does not match the construction world');
  }
  const atCell = (cell) => cell.x === x && cell.y === y;
  const names = ['empty', 'terrain', 'water', 'settled building', 'fallen debris', 'moving construction'];
  const core = scenario.inspectCore().cells.some(atCell);
  const floors = floorSections.map((floor, index) => ({ ...floor, index }))
    .filter((floor) => floor.y === y && x >= floor.left && x <= floor.right).map((floor) => floor.index + 1);
  const planned = scenario.plan.some(atCell);
  const role = core ? 'original 3-by-3 core position' : floors.length ? `connecting floor ${floors.join(' and ')}` :
    scenario.foundationCells.some(atCell) ? 'pillar extension' : planned ? 'building plan' :
      imported.tunnelCells.has(y * world.width + x) ? 'original imported tunnel space' :
        basementCells.some(atCell) ? 'intentional basement space' : 'outside building earthworks';
  const material = world.at(x, y), originalMaterial = original.cells[y * world.width + x];
  const sources = scenario.inspectSources().filter(atCell);
  const deliveries = scenario.inspectDeliveries().filter(atCell);
  const load = world.inspectStructuralLoads().find(atCell);
  const incoming = scenario.deliveries.filter((delivery) => delivery.target && atCell(delivery.target));
  const site = scenario.inspectSites().find(atCell);
  return { x, y, tick: scenario.ticks, material: names[material],
    initialMaterial: names[originalMaterial], changed: material !== originalMaterial,
    role, core, planned, floors, sourceSlots: sources.length,
    usableSourceSlots: sources.filter((source) => source.ready).length,
    paidDeliveries: deliveries.length, deliveryStates: deliveries.map((delivery) => delivery.state),
    incomingDeliveries: incoming.length, repairState: site ? site.state : null,
    blockerDescriptions: deliveries.filter((delivery) => delivery.blocker)
      .map((delivery) => delivery.blockerDescription),
    load: load ? { load: load.load, capacity: load.capacity } : null };
}
