// Sealed underground water pockets: an irregular rock cavity with real water below and a thin air gap on
// top, wrapped in an intact rock shell so nothing leaks until something physically breaches it.
function carvePixelWaterCaves(world, options = {}) {
  const { width, height } = world;
  const spacing = options.spacing || 220, cover = options.cover === undefined ? 30 : options.cover;
  const air = options.air === undefined ? 3 : options.air, shell = 3;
  const hash = (a, b) => {
    let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const caves = [];
  for (let target = Math.floor(spacing / 2); target < width - 20; target += spacing) {
    for (const shift of [0, 24, -24, 48, -48, 72, -72]) {
      const cx = target + shift;
      const rx = 13 + Math.floor(hash(target, 1) * 8), ry = 6 + Math.floor(hash(target, 2) * 3);
      if (cx - rx - shell < 1 || cx + rx + shell >= width - 1) continue;
      let ground = 0;
      for (let x = cx - rx - shell; x <= cx + rx + shell; x += 1) ground = Math.max(ground, world.surfaceRow(x));
      const cy = ground + cover + shell + ry + Math.floor(hash(target, 3) * 10);
      if (cy + ry + shell >= height - 2) continue;
      const within = (x, y, grow, jitter) => {
        const dx = (x - cx) / (rx + grow), dy = (y - cy) / (ry + grow);
        return dx * dx + dy * dy <= 1 + (jitter ? (hash(x, y >> 2) - 0.5) * 0.25 : 0);
      };
      const cells = [];
      let sealed = true;
      for (let y = cy - ry - shell; y <= cy + ry + shell && sealed; y += 1) {
        for (let x = cx - rx - shell; x <= cx + rx + shell; x += 1) {
          if (!within(x, y, shell, false)) continue;
          if (world.at(x, y) !== PARTICLE_TERRAIN) { sealed = false; break; }
          if (within(x, y, 0, true)) cells.push({ x, y });
        }
      }
      if (!sealed || cells.length < 40 || (options.avoid && cells.some((cell) => options.avoid(cell.x, cell.y)))) continue;
      const top = Math.min(...cells.map((cell) => cell.y)), waterline = top + air;
      let water = 0;
      for (const cell of cells) {
        world.excavate(cell.x, cell.y, cell.x, cell.y);
        if (cell.y >= waterline) { world.set(cell.x, cell.y, PARTICLE_WATER); water += 1; }
      }
      caves.push({ id: `cave-${caves.length + 1}`, x: cx, y: cy, left: cx - rx - 1, right: cx + rx + 1,
        top: top - 1, bottom: cy + ry + 2, waterline, cells: cells.length, water });
      break;
    }
  }
  return caves;
}

function createPixelCityFarms(world, entries, surfaceRow, aquifers = []) {
  const PIPE_MATERIALS = [PARTICLE_EMPTY, PARTICLE_WATER, PARTICLE_BARRIER];
  const PUMP_WELL_MATERIALS = [...PIPE_MATERIALS, PARTICLE_TERRAIN];
  const farmland = new Map();
  let ticks = 0;
  let sm = 0, totalProduced = 0, totalSpent = 0;
  const completedSilos = (entry) => entry.scenario.coreDestroyed ? [] :
    entry.building.silos.filter((silo) => silo.cells.every((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER));
  const storageCapacity = () => entries.filter((entry) => entry.building && entry.building.type === 'farm')
    .reduce((sum, entry) => sum + farmCapacity(entry), 0);
  const farmCapacity = (entry) => completedSilos(entry).reduce((capacity, silo) => capacity + silo.capacity, 0);
  const farmStock = (entry) => entry.farm ? entry.farm.stored : 0;
  const root = (entry) => entry.seedPlacement[1];
  const bounds = (entry) => {
    const xs = entry.scenario.plan.map((cell) => cell.x);
    return { left: Math.min(...xs), right: Math.max(...xs) };
  };
  function basins() {
    const seen = new Set(), result = [];
    for (let x = 0; x < world.width; x += 1) {
      for (let y = 0; y < Math.min(world.height, surfaceRow(x)); y += 1) {
        const start = y * world.width + x;
        if (seen.has(start) || world.at(x, y) !== PARTICLE_WATER) continue;
        const cells = [start]; seen.add(start);
        for (let i = 0; i < cells.length; i += 1) {
          const cx = cells[i] % world.width, cy = Math.floor(cells[i] / world.width);
          for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
            const key = ny * world.width + nx;
            if (nx < 0 || nx >= world.width || ny < 0 || ny >= surfaceRow(nx) ||
                seen.has(key) || world.at(nx, ny) !== PARTICLE_WATER) continue;
            seen.add(key); cells.push(key);
          }
        }
        const tops = new Map();
        for (const key of cells) {
          const column = key % world.width, row = Math.floor(key / world.width);
          tops.set(column, Math.min(tops.has(column) ? tops.get(column) : world.height, row));
        }
        result.push({ volume: cells.length, cells, tops });
      }
    }
    return result;
  }
  // Live water state of each underground pocket: volume and the top water row per column.
  function aquiferPools() {
    const pools = [];
    for (const cave of aquifers) {
      const tops = new Map();
      let volume = 0;
      for (let x = Math.max(0, cave.left); x <= Math.min(world.width - 1, cave.right); x += 1) {
        for (let y = Math.max(1, cave.top); y <= Math.min(world.height - 1, cave.bottom); y += 1) {
          if (world.at(x, y) !== PARTICLE_WATER) continue;
          volume += 1;
          if (!tops.has(x)) tops.set(x, y);
        }
      }
      if (volume) pools.push({ cave, volume, tops });
    }
    return pools;
  }
  function sources(entry, pools, caves = []) {
    const origin = root(entry), reach = 120 + entry.building.level * 12;
    const maxLift = 50 + entry.building.level * 10;
    const otherPlans = new Set(entries.filter((other) => other !== entry)
      .flatMap((other) => other.scenario.plan.map((cell) => cell.y * world.width + cell.x)));
    const route = (toX, tops) => {
      const path = [{ x: origin.x, y: origin.y }];
      const direction = toX >= origin.x ? 1 : -1;
      const append = (x, y) => {
        const last = path[path.length - 1];
        if (y < last.y) {
          for (let row = last.y - 1; row >= y; row -= 1) path.push({ x: last.x, y: row });
          path.push({ x, y });
        } else {
          path.push({ x, y: last.y });
          for (let row = last.y + 1; row <= y; row += 1) path.push({ x, y: row });
        }
      };
      for (let x = origin.x + direction; direction > 0 ? x <= toX : x >= toX; x += direction) {
        const waterTop = tops && tops.has(x) ? tops.get(x) : world.height;
        append(x, waterTop < world.height ? waterTop : surfaceRow(x) - 1);
      }
      return { path, append };
    };
    // The farm's own pipework may run through its own structure (e.g. a cave directly beneath it).
    const ownPlan = new Set(entry.scenario.plan.map((cell) => cell.y * world.width + cell.x));
    const blocked = (cell, well) => cell.y < 0 || cell.y >= world.height ||
      otherPlans.has(cell.y * world.width + cell.x) ||
      (!ownPlan.has(cell.y * world.width + cell.x) &&
      !(well ? PUMP_WELL_MATERIALS : PIPE_MATERIALS).includes(world.at(cell.x, cell.y)));
    const basinSources = pools.map((pool) => {
      const key = pool.cells.reduce((best, key) =>
        Math.abs(key % world.width - origin.x) < Math.abs(best % world.width - origin.x) ? key : best);
      const intake = { x: key % world.width, y: Math.floor(key / world.width) };
      const distance = Math.abs(intake.x - origin.x);
      if (distance > reach) return null;
      const { path, append } = route(intake.x, pool.tops);
      append(intake.x, intake.y);
      if (path.some((cell) => blocked(cell, false))) return null;
      return { kind: 'basin', intake, distance, volume: pool.volume, path,
        capacity: Math.sqrt(pool.volume) * 2 * (1 - 0.6 * distance / reach) };
    });
    // A pump drills a cased well from the surface straight down into a cave's air gap and draws from the
    // water top; deeper lifts and longer pipes deliver less. When neighbouring buildings block the surface
    // run, the pump sits at the farm and a buried line passes under their foundations to the well.
    const footing = new Map();
    for (const other of entries) if (other !== entry) {
      for (const cell of other.scenario.plan) footing.set(cell.x, Math.max(footing.get(cell.x) || 0, cell.y));
    }
    const pumpSources = caves.map((pool) => {
      let well = null;
      for (const [x, top] of pool.tops) {
        if (world.at(x, top - 1) !== PARTICLE_EMPTY) continue;
        const distance = Math.abs(x - origin.x);
        if (!well || distance < well.distance) well = { x, top, distance };
      }
      if (!well || well.distance > reach) return null;
      const source = (path, pump) => {
        const lift = well.top - (pump.y + 1);
        if (pump.y < 0 || lift > maxLift) return null;
        return { kind: 'pump', cave: pool.cave.id, intake: { x: well.x, y: well.top }, pump, lift,
          distance: well.distance, volume: pool.volume, path,
          capacity: Math.sqrt(pool.volume) * 2 * (1 - 0.6 * well.distance / reach) * (1 - 0.4 * lift / maxLift) };
      };
      const ground = surfaceRow(well.x);
      const { path, append } = route(well.x, null);
      const surfaceSteps = path.length;
      append(well.x, well.top);
      if (ground >= 1 && !path.some((cell, index) =>
        blocked(cell, index >= surfaceSteps && cell.x === well.x && cell.y >= ground))) {
        return source(path, { x: well.x, y: ground - 1 });
      }
      const direction = well.x >= origin.x ? 1 : -1;
      let floor = origin.y;
      for (let x = origin.x; x !== well.x + direction; x += direction) {
        floor = Math.max(floor, surfaceRow(x), footing.get(x) || 0);
      }
      for (const below of [2, 5, 9, 14, 20]) {
        const trench = floor + below;
        if (trench >= well.top - 1) break;
        const buried = [];
        for (let y = origin.y; y <= trench; y += 1) buried.push({ x: origin.x, y });
        for (let x = origin.x + direction; x !== well.x + direction; x += direction) buried.push({ x, y: trench });
        for (let y = trench + 1; y <= well.top; y += 1) buried.push({ x: well.x, y });
        if (!buried.some((cell, index) => index > 0 && blocked(cell, true))) {
          return source(buried, { x: origin.x, y: origin.y - 1 });
        }
      }
      return null;
    });
    return [...basinSources, ...pumpSources].filter(Boolean).sort((a, b) => a.distance - b.distance)
      .slice(0, Math.min(3, entry.building.level));
  }
  function grow(entry) {
    const farm = entry.farm, center = bounds(entry);
    for (const direction of [-1, 1]) {
      let x = direction < 0 ? center.left - 1 : center.right + 1;
      while (farmland.get(x) === entry) x += direction;
      if (x < 0 || x >= world.width) continue;
      const y = surfaceRow(x);
      if (y < 3 || y >= world.height || farmland.has(x) ||
          world.at(x, y) !== PARTICLE_TERRAIN || [1, 2, 3].some((dy) => world.at(x, y - dy) !== PARTICLE_EMPTY) ||
          entries.some((other) => {
            if (other === entry) return false;
            const b = bounds(other); return x >= b.left - 1 && x <= b.right + 1;
          })) continue;
      farmland.set(x, entry); farm.fields.push({ x, y }); return;
    }
  }
  return {
    inspectAquifers() {
      const live = new Map(aquiferPools().map((pool) => [pool.cave, pool.volume]));
      return aquifers.map((cave) => ({ ...cave, volume: live.get(cave) || 0 }));
    },
    inspectStorage() {
      const capacity = storageCapacity();
      return { sm, capacity, full: sm >= capacity, overflow: Math.max(0, sm - capacity), totalProduced, totalSpent };
    },
    // Each farm stores its own SM in its own silos; `index` draws from one farm, otherwise farms are drawn in order.
    spendSM(amount, index) {
      if (!Number.isInteger(amount) || amount <= 0) throw new Error('SM spending requires a positive integer');
      const sources = index === undefined ? entries.filter((entry) => entry.building && entry.building.type === 'farm')
        : [entries[index]];
      if (sources.some((entry) => !entry || !entry.building || entry.building.type !== 'farm')) {
        throw new Error('SM spending requires a farm');
      }
      if (amount > sources.reduce((sum, entry) => sum + farmStock(entry), 0)) throw new Error('Not enough stored SM');
      let remaining = amount;
      for (const entry of sources) {
        const take = Math.min(remaining, farmStock(entry));
        if (take) { entry.farm.stored -= take; remaining -= take; }
      }
      sm -= amount; totalSpent += amount;
      return this.inspectStorage();
    },
    populationBlocked(cells) { return cells.some((cell) => farmland.has(cell.x)); },
    clearMilitary(cells) {
      const columns = new Set(cells.map((cell) => cell.x));
      for (const x of columns) {
        const owner = farmland.get(x);
        if (!owner) continue;
        owner.farm.fields = owner.farm.fields.filter((cell) => cell.x !== x);
        farmland.delete(x);
      }
    },
    step() {
      ticks += 1;
      const farms = entries.filter((entry) => entry.building && entry.building.type === 'farm');
      for (const entry of farms) {
        if (!entry.farm) entry.farm = { fields: [], sources: [], capacity: 0, food: 0, progress: 0, rate: 0, stored: 0 };
      }
      if (ticks % 60 === 0) {
        const pools = farms.length ? basins() : [], caves = farms.length ? aquiferPools() : [];
        for (const entry of farms) {
          entry.farm.sources = sources(entry, pools, caves);
          entry.farm.capacity = Math.min(12 + entry.building.level * 8,
            Math.floor(entry.farm.sources.reduce((sum, source) => sum + source.capacity, 0)));
        }
      }
      for (const entry of farms) {
        const farm = entry.farm;
        farm.fields = farm.fields.filter((cell) => {
          const intact = world.at(cell.x, cell.y) === PARTICLE_TERRAIN &&
            [1, 2, 3].every((dy) => world.at(cell.x, cell.y - dy) === PARTICLE_EMPTY);
          if (!intact) farmland.delete(cell.x);
          return intact;
        });
        const active = entry.scenario.finished && !entry.scenario.coreDestroyed && farm.capacity > 0;
        if (active && ticks % 30 === 0 && farm.fields.length < farm.capacity) grow(entry);
        const capacity = farmCapacity(entry);
        // Gentle level bonus (L7 = 1.6x): late-game factions need 2-4 farms rather than one levelled farm.
        farm.rate = active && farm.stored < capacity ? Math.min(farm.fields.length, farm.capacity) * (1 + (entry.building.level - 1) * 0.1) : 0;
        farm.progress += farm.rate / 3600;
        const produced = Math.min(Math.floor(farm.progress), Math.max(0, capacity - farm.stored));
        farm.food += produced; totalProduced += produced; sm += produced; farm.stored += produced; farm.progress -= produced;
        if (farm.stored >= capacity) farm.progress = 0;
      }
    },
    inspect(index) {
      const entry = entries[index];
      if (!entry) throw new Error('Invalid farm inspection selection');
      const farm = entry.farm;
      if (!entry.building || entry.building.type !== 'farm') return null;
      const storageSilos = [];
      let remaining = farmStock(entry);
      const completed = new Set(completedSilos(entry));
      for (const silo of entry.building.silos) {
        const intact = completed.has(silo), stored = intact ? Math.min(remaining, silo.capacity) : 0;
        remaining -= stored;
        storageSilos.push({ intact, stored, capacity: silo.capacity,
          borderCells: silo.cells.map((cell) => ({ ...cell })),
          storageCells: (silo.storageCells || []).map((cell) => ({ ...cell })) });
      }
      return { level: entry.building.level, reach: 120 + entry.building.level * 12,
        silos: entry.building.silos.length, desiredSilos: entry.building.desiredSilos,
        completedSilos: completedSilos(entry).length, storage: this.inspectStorage(), storageSilos,
        fields: farm ? farm.fields.map((cell) => ({ ...cell })) : [],
        sources: farm ? farm.sources.map((source) => ({ ...source, intake: { ...source.intake },
          ...(source.pump ? { pump: { ...source.pump } } : {}),
          path: source.path.map((cell) => ({ ...cell })) })) : [],
        capacity: farm ? farm.capacity : 0, food: farm ? farm.food : 0, rate: farm ? farm.rate : 0,
        state: entry.scenario.coreDestroyed ? 'core destroyed' : !entry.scenario.finished ? 'building farm structure' :
          !farm || !farm.capacity ? 'waiting for reachable water' :
            farmStock(entry) >= farmCapacity(entry) ? 'SM storage full' : 'irrigated' };
    },
  };
}
