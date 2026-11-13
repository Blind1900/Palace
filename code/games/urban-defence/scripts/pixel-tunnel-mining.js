// Miners that open a connected resource node, dig their own storage room, and haul HM into it.
function createPixelTunnelMining(network, options = {}) {
  const settings = {
    miners: 2, load: 5, harvestTicks: 30, moveTicks: 2, digTicks: 3, capacity: 100,
    chamberWidth: 19, chamberHeight: 5, ...options,
  };
  const r = network.radius;
  const sites = [], miners = [], log = [];
  const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  function planStorage(node, segment) {
    const faceIndex = segment.line.findIndex((cell) => cell.x === node.face.x && cell.y === node.face.y);
    const { chamberWidth: w, chamberHeight: h } = settings;
    const miss = { flat: 0, shallow: 0, shaft: 0, chamber: 0, reason: '' };
    planStorage.miss = miss;
    for (let i = (faceIndex < 0 ? segment.line.length - 1 : faceIndex) - r - 2; i > 0; i -= 1) {
      const c = segment.line[i], prev = segment.line[i - 1], next = segment.line[i + 1];
      if (!next || prev.y !== c.y || next.y !== c.y) continue;
      miss.flat += 1;
      for (let depth = h + 2; depth <= h + (settings.storageBelow ? 40 : 10); depth += 1) {
        const bottom = c.y + depth + r;
        // Storage must sit under any line the caller needs to keep clear (e.g. the HM pipeline).
        if (settings.storageBelow && [c.x - r, c.x + r - w + 1].some((left) =>
          bottom - h <= settings.storageBelow(Math.round((left + left + w - 1) / 2)))) { miss.shallow += 1; continue; }
        const shaft = network.plan({ kind: 'shaft', from: segment.id, crew: `miners:${node.id}`, owner: segment.owner,
          label: `${node.id} storage shaft`, points: [{ x: c.x, y: c.y }, { x: c.x, y: c.y + depth }] });
        if (!shaft.ok) { miss.shaft += 1; miss.reason = shaft.reason; continue; }
        for (const entry of ['left', 'right']) {
          const left = entry === 'left' ? c.x - r : c.x + r - w + 1;
          const spec = { kind: 'chamber', from: shaft.segment.id, crew: `miners:${node.id}`, owner: segment.owner,
            label: `${node.id} storage`, entry, rect: { left, top: bottom - h + 1, right: left + w - 1, bottom } };
          const dry = network.plan(spec, { dryRun: true });
          if (dry.ok) {
            const chamber = network.plan(spec).segment;
            const drop = { x: Math.round((left + left + w - 1) / 2), y: bottom - r };
            return { shaft: shaft.segment, chamber, drop };
          }
          miss.chamber += 1; miss.reason = dry.reason;
        }
        network.unplan(shaft.segment);
      }
    }
    return null;
  }
  function openSite(event) {
    const { node, segment, face } = event;
    const storage = planStorage(node, segment);
    const site = { node, owner: segment.owner, face: { ...face }, stored: 0, withdrawn: 0, capacity: settings.capacity,
      ready: false, shaft: storage ? storage.shaft : null, chamber: storage ? storage.chamber : null,
      drop: storage ? storage.drop : null, state: storage ? 'digging storage' : 'no storage site',
      storageMiss: storage ? null : { ...planStorage.miss } };
    sites.push(site);
    log.push({ tick: network.ticks, text: `${node.id} connected by ${segment.label}` +
      (storage ? `; storage planned at x ${storage.drop.x}` : '; no room for storage') });
    for (let i = 0; i < settings.miners; i += 1) {
      const take = Math.min(settings.load, node.remaining);
      node.remaining -= take;
      miners.push({ id: `${node.id}-miner-${i + 1}`, site, x: face.x, y: face.y, carried: take, path: null,
        target: null, moveClock: 0, workClock: 0, state: 'hauling first load', delivered: 0 });
    }
  }
  const activeDig = (site) => [site.shaft, site.chamber].find((segment) => segment && segment.phase === 'line') || null;
  const reserved = (site) => miners.reduce((sum, miner) => sum + (miner.site === site ? miner.carried : 0), 0);
  function moveToward(miner, target) {
    if (miner.x === target.x && miner.y === target.y) { miner.path = null; return true; }
    if (!miner.target || miner.target.x !== target.x || miner.target.y !== target.y || !miner.path || !miner.path.length) {
      miner.target = { ...target };
      miner.path = network.route({ x: miner.x, y: miner.y }, target);
      if (!miner.path) { miner.state = 'no route'; return false; }
    }
    miner.moveClock += 1;
    if (miner.moveClock >= settings.moveTicks) {
      miner.moveClock = 0;
      const next = miner.path.shift();
      const footing = network.standing(next.x, next.y);
      if (!footing.clear) { miner.path = null; return false; }
      miner.x = next.x; miner.y = next.y;
    }
    return miner.x === target.x && miner.y === target.y;
  }
  function updateMiner(miner) {
    const { site } = miner, node = site.node;
    if (!site.shaft) { miner.state = 'waiting: no storage site'; return; }
    if (!site.ready) {
      const segment = activeDig(site);
      if (!segment) { miner.state = 'waiting for storage to settle'; return; }
      const next = network.nextDigCell(segment);
      const front = network.digFront(segment);
      if (chebyshev(miner, next) > r + 2) { moveToward(miner, front); miner.state = 'walking to dig face'; return; }
      miner.path = null; miner.workClock += 1; miner.state = `digging ${segment.label}`;
      if (miner.workClock >= settings.digTicks) { miner.workClock = 0; network.dig(segment, 1); }
      return;
    }
    if (miner.carried > 0) {
      miner.state = 'hauling HM to storage';
      if (moveToward(miner, site.drop)) {
        site.stored += miner.carried; miner.delivered += miner.carried; miner.carried = 0;
      }
      return;
    }
    const free = site.capacity - site.stored - reserved(site);
    if (node.remaining <= 0 || free <= 0) {
      miner.state = node.remaining <= 0 ? 'node exhausted' : 'storage full';
      return;
    }
    miner.state = 'returning to node';
    if (!moveToward(miner, site.face)) return;
    miner.state = 'mining HM'; miner.workClock += 1;
    if (miner.workClock < settings.harvestTicks) return;
    miner.workClock = 0;
    const take = Math.min(settings.load, node.remaining, free);
    node.remaining -= take; miner.carried = take;
  }
  function step() {
    network.step();
    for (const event of network.takeEvents()) {
      log.push({ tick: event.tick, text: event.type === 'node-connected'
        ? `${event.node.id} reached at (${event.face.x}, ${event.face.y})`
        : `${event.segment.label} complete` });
      if (event.type === 'node-connected') openSite(event);
    }
    for (const site of sites) {
      if (!site.ready && site.chamber && site.chamber.phase === 'complete') {
        site.ready = true; site.state = 'storage ready';
        log.push({ tick: network.ticks, text: `${site.node.id} storage ready (${site.capacity} HM)` });
      }
    }
    for (const miner of miners) updateMiner(miner);
  }
  function audit() {
    return sites.map((site) => {
      const carried = reserved(site);
      return { node: site.node.id, initial: site.node.initial, remaining: site.node.remaining, stored: site.stored,
        carried, withdrawn: site.withdrawn,
        conserved: site.node.remaining + site.stored + carried + site.withdrawn === site.node.initial,
        withinCapacity: site.stored + carried <= site.capacity || !site.ready };
    });
  }
  return {
    sites, miners, log, settings, step, audit,
    storageFor(nodeId) { return sites.find((site) => site.node.id === nodeId) || null; },
    withdraw(site, amount) {
      const take = Math.max(0, Math.min(amount, site.stored));
      site.stored -= take; site.withdrawn += take; return take;
    },
  };
}
