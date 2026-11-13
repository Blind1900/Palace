// Logical pipeline highway buried just under the surface line, with two separate transport lines per faction.
// Each line is a 3 px tube: a 1 px channel the cargo particles travel in, wrapped in a 1 px casing. The SM
// channel runs 2 px below the surface (taps rise to buildings and silos) and the HM channel 5 px below (taps
// drop to underground storage), so the tubes never touch or cross. Lines follow terrain-distance contours,
// which stay apart even at cliffs. Like farm pipes it never consumes world water; channel cells only need
// intact ground (or a tunnel bridge). Broken pipe cells repair themselves after a short delay.
function createPixelPipelineNetwork(world, options = {}) {
  const { width, height } = world;
  const lineDepth = { SM: 2, HM: 5, ...options.lineDepth };
  if (lineDepth.SM < 1 || lineDepth.HM - lineDepth.SM < 3) {
    throw new Error('Pipeline tubes need a casing pixel each: SM depth >= 1 and HM at least 3 px below SM');
  }
  const surfaceAt = options.surfaceAt || ((x) => world.surfaceRow(x));
  const isBridge = options.isBridge || (() => false);
  const settings = { dispatchTicks: 10, batch: 5, speed: 2, spacing: 2, repairDelay: 40, repairTicks: 3, ...options };
  const key = (x, y) => y * width + x;
  const pipes = new Map(), casing = new Map(), breaks = new Map(), repairs = [];
  const lines = new Map(), endpoints = [], particles = [];
  const ledger = { dispatched: { HM: 0, SM: 0 }, delivered: { HM: 0, SM: 0 }, repaired: 0 };
  let ticks = 0, nextParticle = 1;
  const surfaceRow = (x) => surfaceAt(Math.max(0, Math.min(width - 1, x)));

  // Pixels below the surface line, measured as Chebyshev distance to open air (0 = surface pixel).
  function depthAt(x, y) {
    if (y < surfaceRow(x)) return -1;
    let best = Infinity;
    for (let dx = -8; dx <= 8; dx += 1) {
      const sx = x + dx;
      if (sx < 0 || sx >= width) continue;
      best = Math.min(best, Math.max(Math.abs(dx), y - surfaceRow(sx) + 1));
    }
    return best - 1;
  }
  const lineKey = (owner, resource) => `${owner}:${resource}`;
  function lineFor(owner, resource) {
    const id = lineKey(owner, resource);
    if (!lines.has(id)) lines.set(id, { owner, resource, left: Infinity, right: -Infinity, cells: [] });
    return lines.get(id);
  }
  function traceLine(line, taken) {
    const depth = lineDepth[line.resource], wanted = new Set();
    for (let x = line.left; x <= line.right; x += 1) {
      for (let y = surfaceRow(x); y < Math.min(height - 1, surfaceRow(x) + depth + 48); y += 1) {
        if (!taken.has(key(x, y)) && depthAt(x, y) === depth) wanted.add(key(x, y));
      }
    }
    const search = (starts, allowed) => {
      if (!starts.length) return null;
      const parents = new Map([[starts[0], -1]]), queue = [starts[0]];
      for (let i = 0; i < queue.length; i += 1) {
        const cell = queue[i], x = cell % width;
        if (x === line.right) {
          const path = [];
          for (let k = cell; k !== -1; k = parents.get(k)) path.push(k);
          return path.reverse();
        }
        for (const next of [cell - 1, cell + 1, cell - width, cell + width]) {
          const nx = next % width;
          if (next < 0 || next >= width * height || Math.abs(nx - x) > 1 || nx < line.left || nx > line.right ||
              parents.has(next) || !allowed(next)) continue;
          parents.set(next, cell); queue.push(next);
        }
      }
      return null;
    };
    const exactStarts = [...wanted].filter((k) => k % width === line.left).sort((a, b) => a - b);
    const deep = (k) => !taken.has(k) && depthAt(k % width, Math.floor(k / width)) >= depth;
    const deepStarts = [];
    for (let y = surfaceRow(line.left) + depth; y < height; y += 1) if (deep(key(line.left, y))) { deepStarts.push(key(line.left, y)); break; }
    return search(exactStarts, (k) => wanted.has(k)) || search(deepStarts, deep) || [];
  }
  function rebuild() {
    pipes.clear();
    const ordered = [...lines.values()].sort((a, b) => lineDepth[a.resource] - lineDepth[b.resource]);
    const taken = new Set();
    for (const line of ordered) {
      line.cells = traceLine(line, taken);
      for (const k of line.cells) { taken.add(k); pipes.set(k, { owner: line.owner, resource: line.resource, kind: 'line' }); }
    }
    for (const endpoint of endpoints) {
      const line = lines.get(lineKey(endpoint.owner, endpoint.resource));
      const column = line.cells.filter((k) => k % width === endpoint.x).map((k) => Math.floor(k / width));
      endpoint.blocked = !column.length;
      if (endpoint.blocked) continue;
      const from = endpoint.resource === 'SM' ? Math.min(...column) : Math.max(...column);
      const to = endpoint.tapEnd.y;
      for (let y = Math.min(from, to); y <= Math.max(from, to); y += 1) {
        const k = key(endpoint.x, y), existing = pipes.get(k);
        if (existing && (existing.owner !== endpoint.owner || existing.resource !== endpoint.resource)) {
          endpoint.blocked = true; break;
        }
        if (!existing) pipes.set(k, { owner: endpoint.owner, resource: endpoint.resource, kind: 'tap' });
      }
      if (endpoint.blocked) endpoint.state = 'tap blocked by another line';
    }
    casing.clear();
    for (const [k, pipe] of pipes) {
      const x = k % width, y = Math.floor(k / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const cx = x + dx, cy = y + dy, ck = key(cx, cy);
          if (cx < 0 || cy < 0 || cx >= width || cy >= height || pipes.has(ck) || casing.has(ck) || cy < surfaceRow(cx)) continue;
          casing.set(ck, { owner: pipe.owner, resource: pipe.resource, kind: 'casing' });
        }
      }
    }
    for (const k of [...breaks.keys()]) if (!pipes.has(k) && !casing.has(k)) breaks.delete(k);
  }
  function layTrunk(owner, resource, fromX, toX) {
    if (!['HM', 'SM'].includes(resource)) throw new Error('Pipeline lines carry HM or SM');
    const line = lineFor(owner, resource);
    line.left = Math.max(1, Math.min(line.left, fromX, toX));
    line.right = Math.min(width - 2, Math.max(line.right, fromX, toX));
    rebuild();
    return line;
  }
  // SM taps rise to a surface footing; HM taps drop to an underground room ceiling at tapY.
  function addEndpoint(endpoint) {
    if (!endpoint || !['HM', 'SM'].includes(endpoint.resource) || !['source', 'sink'].includes(endpoint.role) ||
        !Number.isInteger(endpoint.x)) throw new Error('Invalid pipeline endpoint');
    if (endpoint.resource === 'HM' && !(Number.isInteger(endpoint.tapY) && endpoint.tapY > surfaceRow(endpoint.x) + lineDepth.HM)) {
      throw new Error('HM taps must drop to underground storage below the HM line');
    }
    const tapEnd = { x: endpoint.x, y: endpoint.resource === 'HM' ? endpoint.tapY : surfaceRow(endpoint.x) };
    const entry = { ...endpoint, tapEnd, state: 'idle' };
    endpoints.push(entry);
    const line = lineFor(endpoint.owner, endpoint.resource);
    line.left = Math.max(1, Math.min(line.left, endpoint.x));
    line.right = Math.min(width - 2, Math.max(line.right, endpoint.x));
    rebuild();
    return entry;
  }
  function intact(k) {
    const x = k % width, y = Math.floor(k / width), material = world.at(x, y);
    if (material === PARTICLE_TERRAIN || material === PARTICLE_WALL) return true;
    return material === PARTICLE_EMPTY && isBridge(x, y);
  }
  function findSource(sink) {
    const start = key(sink.tapEnd.x, sink.tapEnd.y);
    if (sink.blocked || !intact(start)) return null;
    const sources = new Map();
    for (const source of endpoints) {
      if (source.role === 'source' && !source.blocked && source.owner === sink.owner &&
          source.resource === sink.resource && source.available() > 0) {
        sources.set(key(source.tapEnd.x, source.tapEnd.y), source);
      }
    }
    const parents = new Map([[start, -1]]), queue = [start];
    for (let i = 0; i < queue.length; i += 1) {
      const cell = queue[i];
      if (sources.has(cell)) {
        const path = [];
        for (let k = cell; k !== -1; k = parents.get(k)) path.push({ x: k % width, y: Math.floor(k / width) });
        return { source: sources.get(cell), path };
      }
      const x = cell % width;
      for (const next of [cell - 1, cell + 1, cell - width, cell + width]) {
        if (Math.abs(next % width - x) > 1 || parents.has(next)) continue;
        const pipe = pipes.get(next);
        if (!pipe || pipe.owner !== sink.owner || pipe.resource !== sink.resource || !intact(next)) continue;
        parents.set(next, cell); queue.push(next);
      }
    }
    return null;
  }
  function dispatch() {
    for (const sink of endpoints) {
      if (sink.role !== 'sink' || particles.some((particle) => particle.sink === sink)) continue;
      const want = Math.min(settings.batch, sink.demand());
      if (want <= 0) { sink.state = 'stocked'; continue; }
      const found = findSource(sink);
      if (!found) { sink.state = sink.blocked ? 'tap blocked' : `no ${sink.resource} supply connected`; continue; }
      const amount = found.source.take(Math.min(want, found.source.available()));
      if (amount <= 0) continue;
      ledger.dispatched[sink.resource] += amount;
      sink.state = `receiving ${sink.resource}`;
      let leader = null;
      for (let i = 0; i < amount; i += 1) {
        const particle = { id: nextParticle, resource: sink.resource, owner: sink.owner, sink, source: found.source,
          path: found.path, index: 0, delay: Math.ceil(i * settings.spacing / settings.speed), leader,
          done: false, state: 'loading', ...found.path[0] };
        nextParticle += 1;
        particles.push(particle);
        leader = particle;
      }
    }
  }
  // Broken tube cells (blasted or dug out without a tunnel bridge) are noticed, then refilled one at a time:
  // channel cells first, oldest first. Rubble is cleared into the bed; flooded cells wait for the water to drain.
  function repairStep() {
    for (const map of [pipes, casing]) {
      for (const [k, pipe] of map) {
        if (intact(k)) { breaks.delete(k); continue; }
        if (!breaks.has(k)) breaks.set(k, { x: k % width, y: Math.floor(k / width), since: ticks, owner: pipe.owner,
          resource: pipe.resource, channel: map === pipes, state: 'awaiting repair crew' });
      }
    }
    for (let i = repairs.length - 1; i >= 0; i -= 1) if (ticks - repairs[i].tick > 20) repairs.splice(i, 1);
    if (!breaks.size || ticks % settings.repairTicks !== 0) return;
    const due = [...breaks.values()].filter((entry) => ticks - entry.since >= settings.repairDelay)
      .sort((a, b) => (b.channel - a.channel) || (a.since - b.since) || (a.y - b.y) || (a.x - b.x));
    const crews = new Set();
    for (const entry of due) {
      if (crews.has(entry.owner)) continue;
      const material = world.at(entry.x, entry.y);
      if (material === PARTICLE_WATER) { entry.state = 'flooded - waiting for water to clear'; continue; }
      if (material === PARTICLE_DEBRIS) world.clearDebris(entry.x, entry.y, entry.x, entry.y);
      if (world.at(entry.x, entry.y) !== PARTICLE_EMPTY) { entry.state = 'blocked by a structure'; continue; }
      world.set(entry.x, entry.y, PARTICLE_TERRAIN);
      breaks.delete(key(entry.x, entry.y));
      repairs.push({ x: entry.x, y: entry.y, tick: ticks, owner: entry.owner, resource: entry.resource });
      ledger.repaired += 1;
      crews.add(entry.owner);
    }
    for (const entry of breaks.values()) {
      if (ticks - entry.since < settings.repairDelay) entry.state = `repair in ${settings.repairDelay - (ticks - entry.since)} ticks`;
    }
  }
  function step() {
    ticks += 1;
    repairStep();
    if (settings.dispatchTicks === 1 || ticks % settings.dispatchTicks === 1) dispatch();
    for (const particle of particles) {
      if (particle.delay > 0) { particle.delay -= 1; continue; }
      particle.state = 'moving';
      for (let n = 0; n < settings.speed && particle.index < particle.path.length - 1; n += 1) {
        const next = particle.path[particle.index + 1];
        if (!intact(key(next.x, next.y))) { particle.state = 'waiting at pipe break'; break; }
        const leader = particle.leader;
        if (leader && !leader.done && leader.index <= particle.index + 1) { particle.state = 'queued'; break; }
        particle.index += 1; particle.x = next.x; particle.y = next.y;
      }
      if (particle.index === particle.path.length - 1) {
        particle.sink.give(particle.resource, 1);
        ledger.delivered[particle.resource] += 1;
        particle.done = true;
      }
    }
    for (let i = particles.length - 1; i >= 0; i -= 1) if (particles[i].done) particles.splice(i, 1);
  }
  return {
    pipes, casing, breaks, repairs, lines, endpoints, particles, ledger, lineDepth, depthAt, layTrunk, addEndpoint, step,
    get ticks() { return ticks; },
    isPipe(x, y) { return pipes.has(key(x, y)); },
    pipeAt(x, y) { return pipes.get(key(x, y)) || null; },
    casingAt(x, y) { return casing.get(key(x, y)) || null; },
    intactAt(x, y) { return intact(key(x, y)); },
    inTransit(resource) { return particles.reduce((sum, particle) => sum + (particle.resource === resource ? 1 : 0), 0); },
  };
}

function pixelTunnelRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

// Self-contained seeded test world: two factions with an entrance, an ore node, buildings with
// underground HM cellars, a farm with SM silos, a water basin and a mountain to tunnel through.
function createPixelTunnelLabWorld(seed = 1, options = {}) {
  const width = options.width || 360, height = options.height || 180;
  const random = pixelTunnelRandom(seed);
  const world = createParticleWorld(width, height);
  const phases = [random() * 6.28, random() * 6.28, random() * 6.28];
  const base = Math.round(height * (options.groundRatio || 0.3));
  const heights = new Int32Array(width);
  for (let x = 0; x < width; x += 1) {
    heights[x] = Math.round(base + 6 * Math.sin(x / 37 + phases[0]) + 3 * Math.sin(x / 13 + phases[1]) +
      1.5 * Math.sin(x / 5 + phases[2]));
  }
  const factions = [
    { owner: 'blue', entranceX: 40 + Math.floor(random() * 10), direction: 1 },
    { owner: 'red', entranceX: width - 50 + Math.floor(random() * 10), direction: -1 },
  ];
  const buildings = [];
  const flatten = (left, right) => {
    const y = Math.round(heights.slice(left, right + 1).reduce((a, b) => a + b, 0) / (right - left + 1));
    for (let x = left; x <= right; x += 1) heights[x] = y;
    return y;
  };
  const consumes = { population: { HM: 1, SM: 1 }, military: { HM: 2, SM: 0 }, farm: { HM: 0, SM: 0 } };
  for (const faction of factions) {
    const d = faction.direction, ex = faction.entranceX;
    // Terraced building strip: each pad stays within a climbable step of the previous one and the gaps
    // between pads are ramped, so a surface road can link the entrance and every building front.
    let prev = { y: flatten(ex - 4, ex + 4), edge: ex + d * 4 };
    const terrace = (left, right) => {
      let y = flatten(left, right);
      const near = d > 0 ? left : right, gap = Math.abs(near - prev.edge);
      const step = Math.max(1, Math.floor(gap / 2));
      if (Math.abs(y - prev.y) > step) {
        y = prev.y + Math.sign(y - prev.y) * step;
        for (let x = left; x <= right; x += 1) heights[x] = y;
      }
      for (let i = 1; i < gap; i += 1) heights[prev.edge + d * i] = Math.round(prev.y + (y - prev.y) * i / gap);
      prev = { y, edge: d > 0 ? right : left };
      return y;
    };
    // options.plots: [{ kind, w, h }] laid out from the entrance (e.g. real styled-building footprints).
    let cursor = 8;
    const plots = options.plots ? options.plots.map((plot) => {
      const at = ex + d * (cursor + Math.floor(plot.w / 2));
      cursor += plot.w + (options.plotGap || 6);
      return { ...plot, at };
    }) : [
      { kind: 'population', at: ex + d * 16, w: 12 },
      { kind: 'military', at: ex + d * 34, w: 14 },
      { kind: 'farm', at: ex + d * 56, w: 18 },
    ];
    for (const plot of plots) {
      const left = plot.at - Math.floor(plot.w / 2), right = left + plot.w - 1;
      const y = terrace(left, right);
      buildings.push({ id: `${faction.owner}-${plot.kind}`, owner: faction.owner, kind: plot.kind, left, right,
        ground: y, top: y - (plot.h || (plot.kind === 'farm' ? 3 : 10)), bottom: y - 1, stock: { SM: 0 }, capacity: 30,
        consumes: { ...consumes[plot.kind] }, consumed: { HM: 0, SM: 0 }, cellar: null });
    }
  }
  const centre = Math.round(width / 2);
  const mountain = { left: centre - 56, right: centre - 20, peak: 36 };
  const mid = (mountain.left + mountain.right) / 2, half = (mountain.right - mountain.left) / 2;
  // Level both feet of the mountain so a ground-level pass (and a road through it) can run straight across.
  const foot = Math.round((heights[mountain.left - 8] + heights[mountain.right + 6]) / 2);
  for (let x = mountain.left - 8; x <= mountain.right + 6; x += 1) {
    const t = x < mountain.left - 2 ? (x - (mountain.left - 8)) / 6 : x > mountain.right + 2 ? (mountain.right + 6 - x) / 4 : 1;
    heights[x] = Math.round(heights[x] + (foot - heights[x]) * t);
  }
  for (let x = mountain.left; x <= mountain.right; x += 1) {
    const t = 1 - Math.abs(x - mid) / half;
    heights[x] -= Math.round(mountain.peak * Math.min(1, t * 1.25) + 2 * Math.sin(x / 3 + phases[1]) * t);
  }
  const basin = { left: centre - 15, right: centre + 15, depth: 14 };
  for (let x = 0; x < width; x += 1) {
    let top = heights[x];
    if (x >= basin.left && x <= basin.right) top += Math.round(basin.depth * Math.sin(Math.PI * (x - basin.left) / (basin.right - basin.left)));
    for (let y = top; y < height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    if (x > basin.left && x < basin.right) {
      for (let y = heights[x] + 2; y < top; y += 1) world.set(x, y, PARTICLE_WATER);
    }
  }
  for (let i = 0; i < 40; i += 1) world.step();
  const surface = Int32Array.from(heights);
  const surfaceAt = (x) => surface[Math.max(0, Math.min(width - 1, x))];
  const network = createPixelTunnelNetwork(world, { surfaceAt, ...options.network });
  const nodes = factions.map((faction, index) => network.addNode({
    id: `${faction.owner}-ore`, owner: faction.owner, remaining: 300,
    x: faction.entranceX + faction.direction * (60 + Math.floor(random() * 20)),
    y: surface[faction.entranceX] + 40 + Math.floor(random() * 25) + index * 2,
  }));
  const layouts = factions.map((faction, index) => ({ owner: faction.owner, entranceX: faction.entranceX, depth: 22,
    ladderSide: faction.direction > 0 ? 'left' : 'right', nodes: [nodes[index]] }));
  const plans = generatePixelTunnelSystem(network, layouts);
  const pipeline = createPixelPipelineNetwork(world, { surfaceAt, isBridge: (x, y) => network.isCarved(x, y) });
  // Delivered HM is stored in a sealed underground cellar under each HM-using building.
  for (const building of buildings) {
    if (!building.consumes.HM) continue;
    // Cellars span the footprint, capped at 16 px wide and centred under wide buildings.
    const span = Math.min(building.right - building.left - 1, 16);
    const cellarLeft = Math.round((building.left + building.right - span) / 2);
    for (let top = building.ground + 8; top <= building.ground + 12 && !building.cellar; top += 1) {
      const plan = network.plan({ kind: 'chamber', from: 'standalone', owner: building.owner,
        label: `${building.id} HM cellar`, rect: { left: cellarLeft, top, right: cellarLeft + span - 1, bottom: top + 4 } });
      if (plan.ok && network.buildNow(plan.segment)) {
        building.cellar = { segment: plan.segment, rect: plan.segment.rect, stored: 0, capacity: building.capacity };
      }
    }
  }
  const mining = createPixelTunnelMining(network, options.mining);
  const silos = [];
  for (const building of buildings) {
    if (building.cellar) {
      const cellar = building.cellar;
      pipeline.addEndpoint({ id: `${building.id}-hm`, owner: building.owner, resource: 'HM', role: 'sink',
        x: Math.round((building.left + building.right) / 2) - 1, tapY: cellar.rect.top - 1,
        demand: () => cellar.capacity - cellar.stored, give: (_, n) => { cellar.stored += n; } });
    }
    if (building.kind === 'farm') {
      for (const [index, x] of [building.left + 3, building.right - 3].entries()) {
        const silo = { id: `${building.id}-silo-${index + 1}`, owner: building.owner, x, stock: 20, capacity: 60,
          produced: 20, taken: 0 };
        silos.push(silo);
        pipeline.addEndpoint({ id: silo.id, owner: building.owner, resource: 'SM', role: 'source', x,
          available: () => silo.stock,
          take: (n) => { const t = Math.min(n, silo.stock); silo.stock -= t; silo.taken += t; return t; } });
      }
    } else if (building.consumes.SM) {
      pipeline.addEndpoint({ id: `${building.id}-sm`, owner: building.owner, resource: 'SM', role: 'sink',
        x: Math.round((building.left + building.right) / 2) + 1,
        demand: () => building.capacity - building.stock.SM, give: (_, n) => { building.stock.SM += n; } });
    }
  }
  // Surface roads: one per faction from beside the entrance shaft, past the building fronts, to beyond the farm.
  let roads = null;
  if (options.roads !== false && typeof createPixelSurfaceRoads === 'function') {
    roads = createPixelSurfaceRoads(world, { network, buildings,
      protect: (x, y) => pipeline.isPipe(x, y) || Boolean(pipeline.casingAt(x, y)), ...options.roadOptions });
    for (const faction of factions) {
      const d = faction.direction, ex = faction.entranceX, own = buildings.filter((b) => b.owner === faction.owner);
      const far = d > 0 ? Math.max(...own.map((b) => b.right)) : Math.min(...own.map((b) => b.left));
      for (let extra = 8; extra >= 0; extra -= 2) {
        const plan = roads.plan({ owner: faction.owner, label: `${faction.owner} main road`,
          from: { x: ex + d * 6 }, to: { x: far + d * (4 + extra) } });
        if (plan.ok) { roads.buildNow(plan.road); break; }
      }
    }
  }
  const linkedStorage = new Set();
  const lab = {
    seed, world, network, mining, pipeline, buildings, silos, plans, nodes, surface, basin, mountain, factions, roads, ticks: 0,
    step() {
      lab.ticks += 1;
      world.step();
      if (roads) roads.step();
      mining.step();
      for (const site of mining.sites) {
        if (!site.ready || linkedStorage.has(site)) continue;
        linkedStorage.add(site);
        pipeline.addEndpoint({ id: `${site.node.id}-storage`, owner: site.owner, resource: 'HM', role: 'source',
          x: site.drop.x, tapY: site.chamber.rect.top - 1,
          available: () => site.stored, take: (n) => mining.withdraw(site, n) });
        mining.log.push({ tick: network.ticks, text: `${site.node.id} storage linked to the ${site.owner} HM line` });
      }
      if (lab.ticks % 20 === 0) {
        for (const silo of silos) {
          const add = Math.min(2, silo.capacity - silo.stock); silo.stock += add; silo.produced += add;
        }
      }
      if (lab.ticks % 60 === 0) {
        for (const building of buildings) {
          if (building.cellar) {
            const use = Math.min(building.consumes.HM, building.cellar.stored);
            building.cellar.stored -= use; building.consumed.HM += use;
          }
          const use = Math.min(building.consumes.SM, building.stock.SM);
          building.stock.SM -= use; building.consumed.SM += use;
        }
      }
      pipeline.step();
    },
  };
  return lab;
}
