function createPixelCityMilitary(world, entries) {
  const key = (cell) => cell.y * world.width + cell.x;
  // Plans only grow by appending, so plan-derived shapes are reused until an entry's plan changes length.
  const shapes = new WeakMap();
  const shape = (entry) => {
    const plan = entry.scenario.plan;
    let cached = shapes.get(entry);
    if (!cached || cached.plan !== plan || cached.length !== plan.length) {
      let left = Infinity, right = -Infinity;
      const roof = new Map();
      for (const cell of plan) {
        if (cell.x < left) left = cell.x;
        if (cell.x > right) right = cell.x;
        if (!roof.has(cell.x) || roof.get(cell.x) > cell.y) roof.set(cell.x, cell.y);
      }
      cached = { plan, length: plan.length, bounds: { left, right }, roof,
        columns: [...roof.keys()].sort((a, b) => a - b) };
      shapes.set(entry, cached);
    }
    return cached;
  };
  const bounds = (entry) => shape(entry).bounds;
  let reservation = null, surfaceCache = new Map(), surfaceRevision = -1;
  const reservations = () => {
    const signature = entries.map((entry) => [entry, entry.scenario.plan, entry.scenario.plan.length,
      entry.basementCells, entry.basementCells ? entry.basementCells.length : 0]);
    if (reservation && reservation.signature.length === signature.length &&
        reservation.signature.every((parts, index) => parts.every((part, at) => part === signature[index][at]))) return reservation;
    const planOwners = new Map();
    entries.forEach((entry, index) => {
      for (const cell of entry.scenario.plan) {
        const cellKey = key(cell), previous = planOwners.get(cellKey);
        planOwners.set(cellKey, previous === undefined || previous === index ? index : -1);
      }
    });
    const reservedGround = new Set(planOwners.keys());
    for (const entry of entries) for (const cell of entry.basementCells || []) reservedGround.add(key(cell));
    reservation = { signature, planOwners, reservedGround };
    return reservation;
  };
  const available = (entry) => entry.scenario.finished && !entry.scenario.coreDestroyed;
  const devices = [
    { type: 'turret', width: 3, height: 2 },
    { type: 'missile-launcher', width: 3, height: 3 },
    { type: 'interceptor', width: 3, height: 3 },
    { type: 'guard', width: 1, height: 2 },
  ];
  return {
    inspect() {
      const placements = [], bases = [], occupied = new Set();
      const { planOwners, reservedGround } = reservations();
      if (world.terrainRevision === undefined || surfaceRevision !== world.terrainRevision) {
        surfaceCache = new Map(); surfaceRevision = world.terrainRevision;
      }
      const surfaces = surfaceCache;
      const surface = (x) => {
        if (!surfaces.has(x)) {
          let y = 0;
          while (y < world.height && world.at(x, y) !== PARTICLE_TERRAIN) y += 1;
          surfaces.set(x, y);
        }
        return surfaces.get(x);
      };
      function mount(device, x, rows, material, reserved, metadata) {
        if (rows.some((row) => row === undefined || row >= world.height) ||
            Math.max(...rows) - Math.min(...rows) > 2) return null;
        const y = Math.min(...rows), anchors = [], clearance = [];
        for (let dx = 0; dx < device.width; dx += 1) {
          anchors.push({ x: x + dx, y: rows[dx] });
          for (let row = y - device.height; row < rows[dx]; row += 1) clearance.push({ x: x + dx, y: row });
        }
        if (y - device.height < 0 || x < 0 || x + device.width > world.width ||
            anchors.some((cell) => world.at(cell.x, cell.y) !== material || reserved.has(key(cell))) ||
            clearance.some((cell) => world.at(cell.x, cell.y) !== PARTICLE_EMPTY ||
              reserved.has(key(cell)) || occupied.has(key(cell)))) return null;
        return { ...metadata, type: device.type, x, y: y - device.height, width: device.width,
          height: device.height, anchors, cells: clearance, state: 'placement preview' };
      }
      function place(placement, state) {
        placement.cells.forEach((cell) => occupied.add(key(cell)));
        placements.push(placement); state.placements += 1;
      }
      for (const [owner, base] of entries.entries()) {
        if (!base.building || base.building.type !== 'military') continue;
        const level = base.building.level, reach = 40 + 4 * (level - 1), origin = bounds(base);
        const neighborLimit = level === 7 ? 4 : level >= 4 ? 3 : 2;
        const spacing = 12 - level;
        const state = { owner, level, reach, neighborLimit, groundSpacing: spacing, state: available(base) ? 'ready' :
          base.scenario.coreDestroyed ? 'core destroyed' : 'construction pending', hosts: [], ground: [], placements: 0 };
        bases.push(state);
        if (!available(base)) continue;
        const neighbors = entries.map((entry, index) => {
          const host = bounds(entry);
          return { entry, index, gap: Math.max(0, host.left - origin.right - 1, origin.left - host.right - 1) };
        }).filter(({ entry, gap }) => entry !== base && entry.building &&
          ['population', 'farm'].includes(entry.building.type) && gap <= reach)
          .sort((a, b) => a.gap - b.gap || a.index - b.index).slice(0, neighborLimit);
        const hosts = [{ entry: base, index: owner, gap: 0 }, ...neighbors];
        for (const { entry, index: host, gap } of hosts) {
          const hostState = { host, type: entry.building.type, gap, placed: 0, missing: [],
            state: available(entry) ? 'ready' : entry.scenario.coreDestroyed ? 'core destroyed' : 'construction pending' };
          state.hosts.push(hostState);
          if (!available(entry)) continue;
          const { roof, columns } = shape(entry);

          const otherPlans = { has: (cellKey) => {
            const planOwner = planOwners.get(cellKey);
            return planOwner !== undefined && planOwner !== host;
          } };
          const sections = [];
          for (const x of columns) {
            const previous = sections[sections.length - 1];
            if (!previous || x !== previous.right + 1 || Math.abs(roof.get(x) - roof.get(previous.right)) > 2) {
              sections.push({ left: x, right: x });
            } else previous.right = x;
          }
          for (const facing of [-1, 1]) {
            const section = facing < 0 ? sections[0] : sections[sections.length - 1];
            if (!section) continue;
            const device = devices[0], x = facing < 0 ? section.left : section.right - device.width + 1;
            const placement = section.right - section.left + 1 < device.width ? null :
              mount(device, x, Array.from({ length: device.width }, (_, dx) => roof.get(x + dx)),
                PARTICLE_BARRIER, otherPlans, { id: `${owner}:${host}:corner:${section.left}:${facing}`,
                  owner, host, surface: 'roof', corner: true, facing });
            if (!placement) hostState.missing.push({ type: 'turret', count: 1, reason: 'No intact, clear roof-corner slot.' });
            else { place(placement, state); hostState.placed += 1; }
          }
          for (const device of devices.slice(1)) {
            const wanted = host !== owner ? 1 : device.type === 'guard' ? 2 + Math.floor((level - 1) / 2) :
              1 + Math.floor((level - 1) / 3);
            for (let count = 0; count < wanted; count += 1) {
              let placement = null;
              for (const x of columns) {
                placement = mount(device, x, Array.from({ length: device.width }, (_, dx) => roof.get(x + dx)),
                  PARTICLE_BARRIER, otherPlans, { id: `${owner}:${host}:${device.type}:${count}`,
                    owner, host, surface: 'roof', corner: false, facing: x < (origin.left + origin.right) / 2 ? -1 : 1 });
                if (placement) break;
              }
              if (!placement) {
                hostState.missing.push({ type: device.type, count: wanted - count, reason: 'No intact, clear rooftop slot.' });
                break;
              }
              place(placement, state); hostState.placed += 1;
            }
          }
          if (hostState.missing.length) hostState.state = 'limited rooftop space';
        }
        for (const [band, device] of devices.entries()) {
          const inner = Math.floor(reach * (3 - band) / 4) + 1, outer = Math.floor(reach * (4 - band) / 4);
          const wanted = Math.max(1, Math.floor((outer - inner + 1) / spacing));
          for (const facing of [-1, 1]) {
            const summary = { type: device.type, facing, inner, outer, wanted, placed: 0, missing: 0 };
            state.ground.push(summary);
            for (let count = 0; count < wanted; count += 1) {
              const last = outer - device.width + 1;
              const ideal = inner + (count + 0.5) * (last - inner + 1) / wanted - 0.5;
              const distances = Array.from({ length: Math.max(0, last - inner + 1) }, (_, dx) => inner + dx)
                .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b);
              let placement = null;
              for (const distance of distances) {
                const x = facing < 0 ? origin.left - distance - device.width + 1 : origin.right + distance;
                if (x < 0 || x + device.width > world.width ||
                    placements.some((other) => other.owner === owner && other.surface === 'ground' &&
                      other.facing === facing && other.band === band && Math.abs(other.distance - distance) < spacing)) continue;
                placement = mount(device, x, Array.from({ length: device.width }, (_, dx) => surface(x + dx)),
                  PARTICLE_TERRAIN, reservedGround, { id: `${owner}:ground:${device.type}:${facing}:${count}`,
                    owner, host: null, surface: 'ground', corner: false, facing, distance, band });
                if (placement) break;
              }
              if (placement) { place(placement, state); summary.placed += 1; }
              else summary.missing += 1;
            }
          }
        }
      }
      return { mode: 'lab-only-placement', combat: false, bases, placements };
    },
  };
}

function createPixelMilitaryDemoCity() {
  const heights = Array.from({ length: 600 }, (_, x) => 400 + (x % 3) * 4);
  for (const pole of [60, 80, 100, 200, 220, 240, 400, 420, 440]) {
    for (let dx = 0; dx < 3; dx += 1) heights[pole + dx] = 400;
  }
  for (const x of [369, 370]) heights[x] = 416;
  const source = { width: 600, height: 160, cellSize: 4, heights,
    waterLevels: Array.from({ length: 600 }, (_, x) => [369, 370].includes(x) ? 400 : null), tunnels: [] };
  const city = createSharedPixelMapConstruction(source, { seedGrowth: true });
  for (const [x, type, level] of [[280, 'military', 7], [340, 'population', 1], [380, 'farm', 7]]) {
    const result = city.addSeed(x, false, { type, level });
    if (!result.ok) throw new Error(`Military demo ${type} placement failed: ${result.reason}`);
  }
  city.verify();
  return city;
}
