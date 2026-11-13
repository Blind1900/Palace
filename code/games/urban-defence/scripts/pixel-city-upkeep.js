function createPixelCityUpkeep(world, entries, farms) {
  const stocks = new Map(), transporters = [];
  let ticks = 0, drawn = 0, consumed = 0;
  const active = (entry) => entry.scenario.finished && !entry.scenario.coreDestroyed;
  // Triangular upkeep (L1 1, L3 6, L7 28 SM/min) so one farm feeds an early faction but a levelled city needs 2-4.
  const upkeepRate = (entry) => entry.building.level * (entry.building.level + 1) / 2;
  const pantry = (entry) => upkeepRate(entry) * 2 + 5;
  function stock(entry) {
    if (!stocks.has(entry)) stocks.set(entry, { sm: 0, progress: 0, supplied: false });
    return stocks.get(entry);
  }
  const consumers = () => entries.filter((entry) => entry.building &&
    ['population', 'military'].includes(entry.building.type));
  function dock(entry) {
    const left = Math.min(...entry.seedPlacement.map((cell) => cell.x));
    const right = Math.max(...entry.seedPlacement.map((cell) => cell.x));
    for (const x of [left - 2, right + 2]) {
      const root = x < left ? entry.seedPlacement[0] : entry.seedPlacement[entry.seedPlacement.length - 1];
      const y = root.groundY - 1;
      if (x >= 0 && x < world.width && y >= 0 && y < world.height &&
          world.at(x, y) === PARTICLE_EMPTY) return { x, y };
    }
    return null;
  }
  function dispatch(entry) {
    if (!active(entry) || transporters.some((agent) => agent.entry === entry)) return;
    const state = stock(entry), capacity = pantry(entry);
    if (state.sm >= capacity) return;
    const target = dock(entry);
    if (!target) return;
    for (const [index, farm] of entries.entries()) {
      if (!farm.building || farm.building.type !== 'farm' || !active(farm) ||
          farm.building.owner !== entry.building.owner) continue;
      const inspection = farms.inspect(index);
      const available = inspection.storageSilos.reduce((total, silo) => total + silo.stored, 0);
      if (!available) continue;
      const origin = dock(farm);
      if (!origin) continue;
      const route = findPixelMaterialRoute(world, origin, target);
      if (route === null) continue;
      const carried = Math.min(5, available, capacity - state.sm);
      farms.spendSM(carried, index); drawn += carried;
      transporters.push({ entry, target, x: origin.x, y: origin.y, carried, route, state: 'carrying SM from farm' });
      return;
    }
  }
  function audit() {
    const stored = [...stocks.values()].reduce((total, value) => total + value.sm, 0);
    const carried = transporters.reduce((total, agent) => total + agent.carried, 0);
    if (drawn !== stored + carried + consumed) throw new Error('Building SM supply conservation failed');
    return { drawn, stored, carried, consumed };
  }
  function step() {
    ticks += 1;
    if (ticks % 60 === 1) {
      // Scarce SM goes to the emptiest pantry first so one hungry high-level building cannot starve the rest.
      const fill = (entry) => stock(entry).sm / pantry(entry);
      for (const entry of consumers().sort((a, b) => fill(a) - fill(b))) dispatch(entry);
    }
    for (const entry of consumers()) {
      const state = stock(entry);
      if (!active(entry)) { state.supplied = false; continue; }
      state.supplied = state.sm > 0;
      if (!state.supplied) continue;
      state.progress += upkeepRate(entry);
      if (state.progress >= 3600) {
        state.sm -= 1; consumed += 1; state.progress -= 3600;
        state.supplied = state.sm > 0;
      }
    }
    for (let index = transporters.length - 1; index >= 0; index -= 1) {
      const agent = transporters[index];
      if (!active(agent.entry)) { agent.state = 'waiting: destination inactive; cargo retained'; continue; }
      if (world.at(agent.x, agent.y) !== PARTICLE_EMPTY) {
        agent.route = []; agent.state = 'waiting: flooded or blocked; cargo retained'; continue;
      }
      if (agent.x === agent.target.x && agent.y === agent.target.y) {
        const state = stock(agent.entry);
        state.sm += agent.carried; state.supplied = true;
        transporters.splice(index, 1); continue;
      }
      if (ticks % 2) continue;
      if (!agent.route.length || world.at(agent.route[0].x, agent.route[0].y) !== PARTICLE_EMPTY) {
        if (ticks % 60) continue;
        agent.route = findPixelMaterialRoute(world, agent, agent.target) || [];
        if (!agent.route.length) { agent.state = 'waiting: no dry route; cargo retained'; continue; }
      }
      const next = agent.route.shift(); agent.x = next.x; agent.y = next.y;
      agent.state = 'carrying SM from farm';
    }
    audit();
  }
  function inspect() {
    const buildings = consumers().map((entry) => {
      const state = stock(entry);
      return { index: entries.indexOf(entry), type: entry.building.type, sm: state.sm,
        capacity: pantry(entry), upkeepPerMinute: active(entry) ? upkeepRate(entry) : 0,
        supplied: active(entry) && state.sm > 0, dock: dock(entry),
        hm: entry.scenario.hm, hmCapacity: entry.scenario.initialHM,
        state: !active(entry) ? 'construction pending or core destroyed' :
          state.sm ? 'supplied' : 'SM shortage: growth / unit production paused' };
    });
    return { buildings, transporters: transporters.map((agent) => ({ x: agent.x, y: agent.y,
      carried: agent.carried, state: agent.state })), upkeepPerMinute: buildings.reduce((total, value) =>
      total + value.upkeepPerMinute, 0), ...audit() };
  }
  return { step, inspect, audit, sm: (index) => stock(entries[index]).sm, spend(index, amount) {
    const entry = entries[index];
    if (!entry || !entry.building || !['population', 'military'].includes(entry.building.type) ||
        !Number.isInteger(amount) || amount < 0) throw new Error('Invalid upkeep SM spend');
    const state = stock(entry);
    if (!active(entry) || state.sm < amount) return false;
    state.sm -= amount; consumed += amount; state.supplied = state.sm > 0;
    return true;
  }, supplied: (index) => {
    const entry = entries[index];
    if (!entry || !entry.building || !['population', 'military'].includes(entry.building.type)) {
      throw new Error('Invalid upkeep building selection');
    }
    return active(entry) && stock(entry).sm > 0;
  } };
}
