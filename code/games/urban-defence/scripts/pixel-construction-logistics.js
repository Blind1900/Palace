function findPixelMaterialRoute(world, from, to) {
  const key = (cell) => cell.y * world.width + cell.x;
  const clear = (x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height &&
    world.at(x, y) === PARTICLE_EMPTY;
  if (!clear(from.x, from.y) || !clear(to.x, to.y)) return null;
  const start = key(from), goal = key(to);
  const parents = new Int32Array(world.width * world.height); parents.fill(-1);
  const queue = [start]; parents[start] = start;
  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index], x = cell % world.width, y = Math.floor(cell / world.width);
    if (cell === goal) {
      const path = [];
      for (let next = goal; next !== start; next = parents[next]) {
        path.push({ x: next % world.width, y: Math.floor(next / world.width) });
      }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!clear(nx, ny)) continue;
      const next = ny * world.width + nx;
      if (parents[next] !== -1) continue;
      parents[next] = cell; queue.push(next);
    }
  }
  return null;
}

function createPixelConstructionLogistics(world, supplies) {
  if (!world || !Array.isArray(supplies) || !supplies.length ||
      supplies.some((supply) => !['tunnel', 'core'].includes(supply.kind) ||
        !Number.isInteger(supply.x) || !Number.isInteger(supply.y) ||
        typeof supply.available !== 'function' || typeof supply.take !== 'function')) {
    throw new Error('Invalid construction logistics supplies');
  }
  const jobs = [], transporters = [], reservations = new Set();
  let ticks = 0, drawn = 0, spent = 0, serial = 0;
  const drawnFrom = { tunnel: 0, core: 0 };
  const key = (cell) => cell.y * world.width + cell.x;
  const clear = (x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height &&
    world.at(x, y) === PARTICLE_EMPTY;
  const route = (from, to) => findPixelMaterialRoute(world, from, to);
  function request(kind, cells) {
    if (!['population', 'military', 'farm', 'road'].includes(kind) || !Array.isArray(cells) ||
        !cells.length || cells.some((cell) => !Number.isInteger(cell.x) || !Number.isInteger(cell.y))) {
      throw new Error('Invalid seed or road delivery request');
    }
    const keys = cells.map(key);
    if (new Set(keys).size !== cells.length || cells.some((cell) => !clear(cell.x, cell.y) ||
        ![PARTICLE_TERRAIN, PARTICLE_BARRIER].includes(world.at(cell.x, cell.y + 1)) ||
        reservations.has(key(cell)))) {
      return { ok: false, reason: 'placement needs distinct dry supported unreserved cells' };
    }
    const job = { id: ++serial, kind, cells: cells.map((cell) => ({ ...cell })), delivered: 0,
      placed: 0, state: 'waiting for HM transport', required: cells.length };
    jobs.push(job); keys.forEach((cell) => reservations.add(cell));
    return { ok: true, job };
  }
  function dispatch(job) {
    if (transporters.some((agent) => agent.job === job)) return;
    if (job.delivered >= job.required) return;
    const target = job.cells[job.delivered];
    for (const supply of [...supplies].sort((a, b) => Number(a.kind === 'core') - Number(b.kind === 'core'))) {
      const available = supply.available();
      if (!Number.isInteger(available) || available < 0) throw new Error('Invalid logistics stockpile balance');
      if (!available) continue;
      const path = route(supply, target);
      if (path === null) continue;
      const load = Math.min(5, available, job.required - job.delivered);
      const result = supply.take(load);
      if (!result || !result.ok) throw new Error(`HM stockpile withdrawal failed: ${result && result.reason}`);
      drawn += load; drawnFrom[supply.kind] += load;
      transporters.push({ job, x: supply.x, y: supply.y, carried: load, source: supply.kind,
        route: path, state: 'carrying HM to placement' });
      job.state = `receiving HM from ${supply.kind}`;
      return;
    }
    job.state = 'waiting: no reachable stocked supply';
  }
  function place(job) {
    if (job.delivered !== job.required || job.placed === job.required) return;
    if (transporters.some((agent) => job.cells.some((cell) => cell.x === agent.x && cell.y === agent.y))) {
      job.state = 'waiting: transporter must clear placement'; return;
    }
    if (job.cells.some((cell) => !clear(cell.x, cell.y) ||
        ![PARTICLE_TERRAIN, PARTICLE_BARRIER].includes(world.at(cell.x, cell.y + 1)))) {
      job.state = 'waiting: placement flooded, occupied or unsupported'; return;
    }
    for (const cell of job.cells) {
      const emitted = world.emitConstruction(cell.x, cell.y);
      if (!emitted.ok) throw new Error(`Delivered seed/road material failed: ${emitted.reason}`);
      const settled = world.settleConstruction(cell.x, cell.y);
      if (!settled.ok) throw new Error(`Delivered seed/road support failed: ${settled.reason}`);
      job.placed += 1; spent += 1;
      reservations.delete(key(cell));
    }
    job.state = job.kind === 'road' ? 'road placed' : 'seed placed';
  }
  function audit() {
    const carried = transporters.reduce((total, agent) => total + agent.carried, 0);
    const delivered = jobs.reduce((total, job) => total + job.delivered - job.placed, 0);
    if (drawn !== carried + delivered + spent) throw new Error('Construction logistics HM conservation failed');
    return { drawn, carried, delivered, spent, tunnelDrawn: drawnFrom.tunnel, coreDrawn: drawnFrom.core };
  }
  function step() {
    ticks += 1;
    for (const job of jobs) {
      if (ticks % 30 === 1) dispatch(job);
      place(job);
    }
    for (let index = transporters.length - 1; index >= 0; index -= 1) {
      const agent = transporters[index], target = agent.job.cells[agent.job.delivered];
      if (!clear(agent.x, agent.y)) {
        agent.route = []; agent.state = 'waiting: current position blocked or flooded'; continue;
      }
      if (agent.x === target.x && agent.y === target.y) {
        agent.job.delivered += agent.carried;
        agent.carried = 0; transporters.splice(index, 1); place(agent.job); continue;
      }
      if (ticks % 2) continue;
      if (!agent.route.length || !clear(agent.route[0].x, agent.route[0].y)) {
        if (ticks % 30) { agent.state = 'waiting: replanning route'; continue; }
        agent.route = route(agent, target) || [];
        if (!agent.route.length) { agent.state = 'waiting: no dry route; cargo retained'; continue; }
      }
      const next = agent.route.shift(); agent.x = next.x; agent.y = next.y;
      agent.state = 'carrying HM to placement';
    }
    audit();
  }
  return { request, step, audit, jobs, transporters, get ticks() { return ticks; } };
}
