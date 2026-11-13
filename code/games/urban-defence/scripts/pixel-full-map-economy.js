// Full-map HM economy built from the testing lane's tunnel, mining and pipeline modules (used unchanged).
// Each faction gets an entrance shaft, a trunk and a branch to an ore node; miners dig a storage room and haul
// HM into it; an HM pipeline line buried below every basement carries it to a sealed cellar under each faction
// building, and the cellar hands HM to that building's construction scenario. Neutral buildings stay pre-funded.
function createPixelFullMapEconomy(city, options = {}) {
  if (!city || !city.world || !Array.isArray(city.entries)) throw new Error('Full-map economy needs a shared city');
  const world = city.world, { width, height } = world;
  const settings = {
    nodeHM: 40000, cellarCapacity: 240, workingHM: 60, transferTicks: 10, rescanTicks: 120,
    mining: { miners: 6, load: 12, harvestTicks: 24, capacity: 600 },
    pipeline: { batch: 20, speed: 3, dispatchTicks: 6 },
    ...options,
  };
  const key = (x, y) => y * width + x;
  // Frozen original surface: later craters and building basements must not move the buried lines.
  const surface = new Int32Array(width);
  for (let x = 0; x < width; x += 1) surface[x] = world.surfaceRow(x);
  const surfaceAt = (x) => surface[Math.max(0, Math.min(width - 1, x))];
  const factionOf = (x) => x < width * 0.2 ? 'left' : x >= width * 0.8 ? 'right' : 'neutral';
  const zones = { left: [12, Math.floor(width * 0.2) - 1], right: [Math.ceil(width * 0.8), width - 13] };

  const reservations = () => pixelBuildingReservations(city.entries, width);
  function reservationDepths(reserved) {
    const depth = new Int32Array(width).fill(-1), used = new Uint8Array(width);
    for (const k of reserved) {
      const x = k % width, y = Math.floor(k / width);
      used[x] = 1;
      if (y >= surface[x]) depth[x] = Math.max(depth[x], y - surface[x]);
    }
    return { depth, used };
  }
  const entryBounds = (entry) => {
    let left = Infinity, right = -Infinity, bottom = -Infinity;
    for (const cell of [...entry.scenario.plan, ...entry.basementCells]) {
      if (cell.x < left) left = cell.x;
      if (cell.x > right) right = cell.x;
      if (cell.y > bottom) bottom = cell.y;
    }
    return { left, right, bottom, center: Math.round((left + right) / 2) };
  };

  let reserved = reservations();
  let { depth: resDepth, used: resUsed } = reservationDepths(reserved);
  let deepest = 0;
  for (const owner of ['left', 'right']) {
    for (let x = zones[owner][0]; x <= zones[owner][1]; x += 1) deepest = Math.max(deepest, resDepth[x]);
  }
  // HM line (and its casing) sits fully below the deepest basement or foundation in either faction zone.
  const hmDepth = Math.max(5, deepest + 3);
  // The pipeline follows a slope-limited copy of the surface (never shallower than the real one) so its
  // fixed-depth contour stays continuous past cliffs instead of falling back to a straight deep run.
  const pipeSurface = Int32Array.from(surface);
  for (let x = 1; x < width; x += 1) pipeSurface[x] = Math.max(pipeSurface[x], pipeSurface[x - 1] - 1);
  for (let x = width - 2; x >= 0; x -= 1) pipeSurface[x] = Math.max(pipeSurface[x], pipeSurface[x + 1] - 1);
  const pipeSurfaceAt = (x) => pipeSurface[Math.max(0, Math.min(width - 1, x))];
  const network = createPixelTunnelNetwork(world, { surfaceAt });
  const pipeline = createPixelPipelineNetwork(world, { surfaceAt: pipeSurfaceAt, ...settings.pipeline,
    lineDepth: { SM: hmDepth - 3, HM: hmDepth },
    // Reserved building space counts as bridged so pipe repairs never refill a basement.
    isBridge: (x, y) => network.isCarved(x, y) || reserved.has(key(x, y)) });

  function columnsClear(left, right, margin) {
    for (let x = left - margin; x <= right + margin; x += 1) if (x < 1 || x >= width - 1 || resUsed[x]) return false;
    return true;
  }
  function solidColumn(x, top, bottom) {
    for (let y = top; y <= bottom; y += 1) {
      const material = world.at(x, y);
      if (material !== PARTICLE_TERRAIN) return false;
    }
    return true;
  }
  function segmentCells(segment) {
    const cells = [...segment.own];
    for (const step of segment.steps) cells.push(...step.walls);
    return cells;
  }
  // Water caves keep a rock buffer: tunnels, ore nodes and their storage rooms must never breach them.
  const caves = city.waterCaves || [];
  const nearCave = (x, y, pad) => caves.some((cave) =>
    x >= cave.left - pad && x <= cave.right + pad && y >= cave.top - pad && y <= cave.bottom + pad);
  const breachesCave = (segment) => caves.length > 0 &&
    segmentCells(segment).some((k) => nearCave(k % width, Math.floor(k / width), 6));
  // A node's storage room is dug a little below its branch and must end up under the HM line, which runs
  // deep wherever the slope-limited pipe surface sags (e.g. beside an edge trench).
  const storageRoom = (nx, ny) => {
    let line = 0;
    for (let x = nx - 30; x <= nx + 30; x += 1) line = Math.max(line, pipeSurfaceAt(x) + hmDepth);
    return line <= ny + 20;
  };
  function planFaction(owner) {
    const [low, high] = zones[owner];
    const own = city.entries.filter((entry) => entry.scenario.paidGrowth && factionOf(entryBounds(entry).center) === owner);
    const anchor = own.length ? Math.round(own.reduce((sum, entry) => sum + entryBounds(entry).center, 0) / own.length)
      : Math.round((low + high) / 2);
    const r = network.radius, depth = Math.max(22, deepest + 8);
    const candidates = [];
    for (let x = low; x <= high; x += 1) candidates.push(x);
    candidates.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor));
    const reasons = new Map();
    const note = (reason) => reasons.set(reason, (reasons.get(reason) || 0) + 1);
    for (const ex of candidates) {
      if (!columnsClear(ex - r - 1, ex + r + 1, 6)) { note('building nearby'); continue; }
      if (Math.abs(surface[ex - 2] - surface[ex]) > 2 || Math.abs(surface[ex + 2] - surface[ex]) > 2) { note('uneven'); continue; }
      if (world.at(ex, surface[ex] - 1) === PARTICLE_WATER) { note('flooded'); continue; }
      for (const direction of [ex - low > high - ex ? -1 : 1, ex - low > high - ex ? 1 : -1]) {
        for (const reach of [70, 90, 55, 110]) {
          const nx = ex + direction * reach, trunkY = surface[ex] + depth, ny = trunkY + 18;
          if (nx < 10 || nx >= width - 10 || ny + 40 >= height - 2) { note('node outside world'); continue; }
          if (!solidColumn(nx, ny - 4, ny + 4)) { note('node not in solid ground'); continue; }
          if (nearCave(nx, ny, 16)) { note('node too close to a water cave'); continue; }
          if (!storageRoom(nx, ny)) { note('node storage would sit above the HM line'); continue; }
          const node = { id: `${owner}-ore`, x: nx, y: ny, radius: 3 };
          const before = network.segments.length;
          const plans = generatePixelTunnelSystem(network, [{ owner, entranceX: ex, depth,
            ladderSide: direction > 0 ? 'left' : 'right', nodes: [node] }]);
          const added = network.segments.slice(before);
          const failed = plans.find((plan) => !plan.ok);
          const conflict = !failed && added.some((segment) => segmentCells(segment).some((k) => reserved.has(k)));
          const flooded = !failed && !conflict && added.some(breachesCave);
          if (!failed && !conflict && !flooded && added.length === 3) {
            const registered = network.addNode({ id: node.id, owner, x: nx, y: ny, remaining: settings.nodeHM });
            return { ok: true, owner, entranceX: ex, depth, node: registered, segments: added };
          }
          note(failed ? failed.reason : conflict ? 'tunnel would cross a building reservation' :
            flooded ? 'tunnel would breach a water cave' : 'incomplete tunnel layout');
          for (let index = added.length - 1; index >= 0; index -= 1) network.unplan(added[index]);
        }
      }
    }
    return { ok: false, owner, reason: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([reason, count]) => `${reason} (${count})`).join(', ') || 'no faction zone' };
  }
  const factions = ['left', 'right'].map(planFaction);
  for (const faction of factions) if (faction.ok) Object.assign(faction, { nodes: [faction.node], prospect: null });
  const mining = createPixelTunnelMining(network, { ...settings.mining,
    storageBelow: (x) => pipeSurfaceAt(x) + hmDepth });

  // When the working node runs low, survey a fresh node deeper down and dig a branch to it off the existing
  // trunk (or off the shaft foot for the opposite side), so mining never stops for good.
  const prospectAt = settings.prospectAt === undefined ? Math.floor(settings.nodeHM / 10) : settings.prospectAt;
  function prospect(faction) {
    const [shaft, trunk] = faction.segments;
    const ex = faction.entranceX, trunkY = trunk.line[0].y, r = network.radius;
    const trunkEnd = trunk.line[trunk.line.length - 1].x, side = Math.sign(trunkEnd - ex) || 1;
    const generation = faction.nodes.length, [low, high] = zones[faction.owner];
    const reasons = new Map();
    const note = (reason) => reasons.set(reason, (reasons.get(reason) || 0) + 1);
    function attempt(parent, points, nx, ny, direction) {
      if (nx < Math.max(10, low - 40) || nx > Math.min(width - 11, high + 40) || ny + 12 >= height - 2) { note('outside zone'); return null; }
      if (network.nodes.some((node) => Math.abs(node.x - nx) < 14 && Math.abs(node.y - ny) < 14)) { note('too close to an old node'); return null; }
      if (!solidColumn(nx, ny - 4, ny + 4)) { note('node not in solid ground'); return null; }
      if (nearCave(nx, ny, 16)) { note('node too close to a water cave'); return null; }
      if (!storageRoom(nx, ny)) { note('node storage would sit above the HM line'); return null; }
      const id = `${faction.owner}-ore-${generation + 1}`;
      const planned = network.plan({ kind: 'tunnel', from: parent.id, label: `${faction.owner} branch to ${id}`,
        ladderSide: direction > 0 ? 'left' : 'right', points });
      if (!planned.ok) { note(planned.reason); return null; }
      if (breachesCave(planned.segment)) { network.unplan(planned.segment); note('tunnel would breach a water cave'); return null; }
      if (segmentCells(planned.segment).some((k) => reserved.has(k))) {
        network.unplan(planned.segment); note('tunnel would cross a building reservation'); return null;
      }
      const node = network.addNode({ id, owner: faction.owner, x: nx, y: ny, radius: 3, remaining: settings.nodeHM });
      faction.nodes.push(node); faction.node = node; faction.segments.push(planned.segment);
      return { ok: true, node: id };
    }
    for (const deeper of [12, 24, 6, 36, 48]) for (const direction of [side, -side]) for (const reach of [60, 80, 100, 120, 45, 140]) {
      const nx = ex + direction * reach, ny = trunkY + 18 + deeper;
      const bx = nx - direction * (3 + 2 * r + 4), stop = nx - direction * (3 + r + 1);
      const onTrunk = direction === side;
      const startX = onTrunk ? Math.min(Math.max(bx, Math.min(ex, trunkEnd)), Math.max(ex, trunkEnd)) : ex;
      const points = [{ x: startX, y: trunkY }];
      if (bx !== startX) points.push({ x: bx, y: trunkY });
      points.push({ x: bx, y: ny }, { x: stop, y: ny });
      const result = attempt(onTrunk ? trunk : shaft, points, nx, ny, direction);
      if (result) return result;
    }
    // Fallback: sink a deeper branch off the end of an earlier ore branch (newest first), where ground is solid.
    for (const branch of faction.segments.slice(2).reverse()) {
      const end = branch.line[branch.line.length - 1];
      for (const drop of [22, 34, 46, 58]) for (const direction of [side, -side]) for (const run of [14, 26, 40]) {
        const ny = end.y + drop, nx = end.x + direction * (run + 3 + r + 1);
        const points = [{ x: end.x, y: end.y }, { x: end.x, y: ny }, { x: end.x + direction * run, y: ny }];
        const result = attempt(branch, points, nx, ny, direction);
        if (result) return result;
      }
    }
    return { ok: false, reason: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([reason, count]) => `${reason} (${count})`).join(', ') };
  }

  const cellars = new Map(), cellarFailures = new Map();
  let transferred = 0;
  function addCellar(entry) {
    const bounds = entryBounds(entry), owner = factionOf(bounds.center);
    if (owner === 'neutral') return null;
    const span = Math.max(network.interior, Math.min(bounds.right - bounds.left - 1, 16));
    const left = Math.round((bounds.left + bounds.right - span) / 2), right = left + span - 1;
    let lineFloor = 0;
    for (let x = left - 8; x <= right + 8; x += 1) lineFloor = Math.max(lineFloor, pipeSurfaceAt(x) + hmDepth + 8);
    const first = Math.max(bounds.bottom + 6, lineFloor + 2);
    for (let top = first; top <= first + 10 && top + 6 < height - 1; top += 1) {
      const rect = { left, top, right, bottom: top + 4 };
      const spec = { kind: 'chamber', from: 'standalone', owner, label: `building ${city.entries.indexOf(entry) + 1} HM cellar`, rect };
      if (!network.plan(spec, { dryRun: true }).ok) continue;
      const plan = network.plan(spec);
      if (!plan.ok || !network.buildNow(plan.segment)) continue;
      const cellar = { entry, owner, segment: plan.segment, rect, stored: 0, received: 0, transferred: 0,
        capacity: settings.cellarCapacity, endpoint: null };
      cellar.endpoint = pipeline.addEndpoint({ id: `cellar-${city.entries.indexOf(entry)}`, owner, resource: 'HM',
        role: 'sink', x: bounds.center - 1 >= left && bounds.center - 1 <= right ? bounds.center - 1 : left + 1,
        tapY: top - 1, demand: () => cellar.capacity - cellar.stored,
        give: (_, amount) => { cellar.stored += amount; cellar.received += amount; } });
      cellars.set(entry, cellar);
      return cellar;
    }
    cellarFailures.set(entry, (cellarFailures.get(entry) || 0) + 1);
    return null;
  }
  function scanBuildings() {
    const before = reserved.size;
    reserved = reservations();
    if (reserved.size !== before) ({ depth: resDepth, used: resUsed } = reservationDepths(reserved));
    for (const entry of city.entries) {
      if (!entry.scenario.paidGrowth || cellars.has(entry) || (cellarFailures.get(entry) || 0) >= 3) continue;
      addCellar(entry);
    }
  }
  scanBuildings();

  // Tunnel pricing: each segment costs HM for its built area - newly dug interior plus newly placed lining.
  // Plain rock costs 1 HM per 5 px; a step that bridges an open gap/cave or runs under a building costs 1 HM per 4 px.
  // The starting faction systems, building cellars and each faction's first storage room are prepaid by world
  // generation. Later AI tunnels are billed as debt that the faction's mine storage pays first; player orders
  // are prepaid one chunk at a time before the builders may dig it.
  const tunnelRates = { plain: settings.tunnelPlainRate || 5, premium: settings.tunnelPremiumRate || 4 };
  const playerTunnels = settings.tunnels !== 'ai';
  const claimed = new Set(), billedSegments = new Set();
  const tunnelLedger = { prepaid: 0, billed: 0, paid: 0, debt: { left: 0, right: 0 }, segments: 0 };
  let billedIndex = 0;
  const inNode = (x, y) => network.nodes.some((node) => Math.max(Math.abs(x - node.x), Math.abs(y - node.y)) <= node.radius);
  function claim(segment) {
    for (const k of segment.own) claimed.add(k);
    for (const step of segment.steps) for (const k of step.walls) claimed.add(k);
  }
  function priceSegment(segment) {
    let cost = 0, area = 0, premiumArea = 0;
    for (const step of segment.steps) {
      let cells = 0, premium = false;
      const count = (k, wall) => {
        if (claimed.has(k)) return;
        const x = k % width, y = Math.floor(k / width);
        if (network.isCarved(x, y)) return;
        const material = world.at(x, y), under = y >= surface[x];
        const gap = material === PARTICLE_EMPTY && under;
        if (wall ? !(material === PARTICLE_TERRAIN || gap) || inNode(x, y)
          : material === PARTICLE_WATER || (material === PARTICLE_EMPTY && !under)) return;
        cells += 1;
        if (gap || (under && resUsed[x])) premium = true;
      };
      for (const k of step.cells) count(k, false);
      for (const k of step.walls) count(k, true);
      area += cells;
      if (premium) premiumArea += cells;
      cost += cells / (premium ? tunnelRates.premium : tunnelRates.plain);
    }
    return { price: area ? Math.max(1, Math.ceil(cost - 1e-9)) : 0, area, premiumArea };
  }
  const firstStorageCrews = new Set(factions.filter((faction) => faction.ok).map((faction) => `miners:${faction.nodes[0].id}`));
  function billNewSegments() {
    billedIndex = Math.min(billedIndex, network.segments.length);
    for (; billedIndex < network.segments.length; billedIndex += 1) {
      const segment = network.segments[billedIndex];
      if (billedSegments.has(segment)) continue;
      const { price } = priceSegment(segment);
      claim(segment); billedSegments.add(segment);
      segment.priceHM = price;
      const owner = segment.owner;
      if (segment.from === 'standalone' || firstStorageCrews.has(segment.crew) || !(owner in tunnelLedger.debt)) {
        tunnelLedger.prepaid += price; continue;
      }
      tunnelLedger.billed += price; tunnelLedger.debt[owner] += price; tunnelLedger.segments += 1;
    }
  }
  for (const segment of network.segments) {
    const { price } = priceSegment(segment);
    claim(segment); billedSegments.add(segment); segment.priceHM = price; tunnelLedger.prepaid += price;
  }
  billedIndex = network.segments.length;
  const ownerSites = (owner) => mining.sites.filter((site) => site.owner === owner && site.ready);
  const ownerStock = (owner) => ownerSites(owner).reduce((sum, site) => sum + site.stored, 0);
  function withdrawFor(owner, amount) {
    let taken = 0;
    for (const site of ownerSites(owner)) {
      if (taken >= amount) break;
      taken += mining.withdraw(site, amount - taken);
    }
    tunnelLedger.paid += taken;
    return taken;
  }
  function payDebts() {
    for (const owner of ['left', 'right']) {
      if (tunnelLedger.debt[owner] > 0) tunnelLedger.debt[owner] -= withdrawFor(owner, tunnelLedger.debt[owner]);
    }
  }

  // Player tunnel orders: start on the faction's ground or its own tunnel wall, stay within its zone +-40 columns,
  // keep 6 px of rock from water caves, avoid building reservations and enemy tunnels.
  const orders = [];
  let nextOrder = 1;
  const orderChunk = settings.tunnelChunk || 24;
  const zoneLimits = (owner) => [Math.max(1, zones[owner][0] - 40), Math.min(width - 2, zones[owner][1] + 40)];
  let anchorCache = null, anchorSignature = '';
  function anchors() {
    const signature = `${network.excavated}|${network.lined}|${network.segments.length}`;
    if (signature !== anchorSignature) { anchorSignature = signature; anchorCache = network.digAnchors(); }
    return anchorCache;
  }
  function anchorNear(owner, point, reach = 6) {
    if (!(owner in zones) || !point) return null;
    const [low, high] = zoneLimits(owner);
    let best = null, bestDistance = Infinity;
    for (const anchor of anchors()) {
      if (anchor.x < low || anchor.x > high) continue;
      if (anchor.type === 'wall' && network.segments[anchor.segment].owner !== owner) continue;
      const d = Math.max(Math.abs(anchor.x - point.x), Math.abs(anchor.y - point.y));
      // Prefer tunnel walls over the surface when both are equally close.
      if (d <= reach && (d < bestDistance || (d === bestDistance && anchor.type === 'wall'))) { best = anchor; bestDistance = d; }
    }
    return best;
  }
  function placementProblem(owner, segment) {
    const [low, high] = zoneLimits(owner), cells = segmentCells(segment);
    if (cells.some((k) => k % width < low || k % width > high)) return 'tunnel leaves your zone (+-40 columns)';
    if (cells.some((k) => reserved.has(k))) return 'tunnel would cross a building reservation';
    if (breachesCave(segment)) return 'tunnel must keep 6 px of rock from water caves';
    const enemy = network.segments.filter((other) => other !== segment && other.owner !== owner);
    if (enemy.length && segment.steps.some((step) => step.cells.some((k) => enemy.some((other) => other.own.has(k))))) {
      return 'tunnel would cut into enemy tunnels';
    }
    return null;
  }
  function quoteTunnel(owner, anchor, target) {
    const fail = (reason, extra = {}) => ({ ok: false, reason, price: 0, area: 0, line: [], ...extra });
    if (!playerTunnels) return fail('player tunnels are disabled (AI-only mode)');
    const faction = factions.find((entry) => entry.owner === owner);
    if (!faction || !faction.ok) return fail('this faction has no tunnel network');
    if (!anchor || !target) return fail('pick a start and a target');
    const [low, high] = zoneLimits(owner);
    if (anchor.x < low || anchor.x > high || target.x < low || target.x > high) return fail('stay within your zone (+-40 columns)');
    if (anchor.type === 'wall' && (!network.segments[anchor.segment] || network.segments[anchor.segment].owner !== owner)) {
      return fail('start on your own tunnel wall');
    }
    billNewSegments();
    const routed = network.routeDig(anchor, { x: Math.round(target.x), y: Math.round(target.y) },
      { owner, crew: 'builders', label: `${owner} player tunnel` });
    const line = routed.spec ? network.centerline(routed.spec.points) : [];
    if (!routed.ok) return fail(routed.reason, { line });
    if (Number.isInteger(routed.spec.from) && network.segments[routed.spec.from].owner !== owner) {
      return fail('start on your own tunnel wall', { line });
    }
    let planned;
    try { planned = network.plan(routed.spec); } catch (error) { planned = { ok: false, reason: error.message }; }
    if (!planned.ok) return fail(planned.reason, { line });
    const problem = placementProblem(owner, planned.segment);
    const { price, area, premiumArea } = priceSegment(planned.segment);
    network.unplan(planned.segment);
    return { ok: !problem, reason: problem || routed.reason, price, area, premiumArea, spec: routed.spec, line,
      chunks: Math.ceil((line.length - 1) / orderChunk), stock: ownerStock(owner) };
  }
  function orderTunnel(owner, anchor, target) {
    const quote = quoteTunnel(owner, anchor, target);
    if (!quote.ok) return quote;
    const chunks = [];
    for (let start = 0; start < quote.line.length - 1; start += orderChunk) {
      const cells = quote.line.slice(start, Math.min(quote.line.length, start + orderChunk + 1));
      const points = [cells[0]];
      for (let i = 1; i < cells.length - 1; i += 1) {
        const a = cells[i - 1], b = cells[i], c = cells[i + 1];
        if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) points.push(b);
      }
      points.push(cells[cells.length - 1]);
      chunks.push(points.map((point) => ({ x: point.x, y: point.y })));
    }
    const order = { id: nextOrder, owner, from: quote.spec.from, ladderSide: quote.spec.ladderSide || 'left', chunks,
      line: quote.line, estimate: quote.price, next: 0, segments: [], paid: 0, waiting: 0, done: false, blocked: false,
      state: 'queued' };
    nextOrder += 1;
    orders.push(order);
    processOrder(order);
    return { ...quote, ok: true, order: order.id };
  }
  function processOrder(order) {
    if (order.done || order.blocked) return;
    const prev = order.segments[order.segments.length - 1];
    if (order.next >= order.chunks.length) {
      if (prev.phase === 'complete') { order.done = true; order.state = 'complete'; } else order.state = `digging (${prev.state})`;
      return;
    }
    // The next chunk is paid once the builders have broken ground on the previous one.
    if (prev && prev.dug === 0 && prev.phase !== 'complete') { order.state = `segment ${order.next}/${order.chunks.length}: ${prev.state}`; return; }
    const spec = { kind: 'tunnel', from: prev ? prev.id : order.from, owner: order.owner, crew: 'builders',
      label: `${order.owner} tunnel order ${order.id} (${order.next + 1}/${order.chunks.length})`,
      ladderSide: order.ladderSide, points: order.chunks[order.next] };
    let planned;
    try { planned = network.plan(spec); } catch (error) { planned = { ok: false, reason: error.message }; }
    const block = (reason) => { order.blocked = true; order.waiting = 0; order.state = `blocked: ${reason}`; };
    if (!planned.ok) { block(planned.reason); return; }
    const problem = placementProblem(order.owner, planned.segment);
    if (problem) { network.unplan(planned.segment); block(problem); return; }
    const { price } = priceSegment(planned.segment), stock = ownerStock(order.owner);
    if (stock < price) {
      network.unplan(planned.segment);
      order.waiting = price; order.state = `waiting for ${price} HM (storage holds ${stock})`;
      return;
    }
    const taken = withdrawFor(order.owner, price);
    tunnelLedger.billed += taken; tunnelLedger.segments += 1;
    claim(planned.segment); billedSegments.add(planned.segment);
    planned.segment.priceHM = taken;
    order.segments.push(planned.segment); order.paid += taken; order.waiting = 0; order.next += 1;
    order.state = `paid segment ${order.next}/${order.chunks.length} (${taken} HM)`;
  }
  const reserveFor = (owner) => orders.reduce((sum, order) => sum + (order.owner === owner ? order.waiting : 0), 0);
  function cancelOrder(id) {
    const order = orders.find((entry) => entry.id === id);
    if (!order || order.done || order.blocked) return false;
    // Paid segments are already dug or queued; cancelling only stops the unpaid remainder.
    order.blocked = true; order.waiting = 0; order.state = `cancelled after ${order.next}/${order.chunks.length} segments`;
    return true;
  }

  const linked = new Set();
  let ticks = 0;
  function transfer(checkDamage) {
    for (const cellar of cellars.values()) {
      const scenario = cellar.entry.scenario;
      if (scenario.coreDestroyed || !cellar.stored) continue;
      // Under construction the building draws a small working stock; once finished it keeps the cellar half
      // full as a visible repair cache and banks the rest toward level-ups, units and ammunition.
      let amount = scenario.finished ? Math.max(0, cellar.stored - Math.floor(cellar.capacity / 2))
        : Math.min(cellar.stored, Math.max(0, settings.workingHM - scenario.hm));
      if (scenario.finished && checkDamage) {
        // A damaged frame empties the repair cache into the building until the missing pixels are covered.
        let missing = 0;
        for (const cell of scenario.plan) if (world.at(cell.x, cell.y) !== PARTICLE_BARRIER) missing += 1;
        cellar.damage = missing;
        if (missing > scenario.hm) amount = Math.max(amount, Math.min(cellar.stored, missing - scenario.hm));
      }
      if (!amount) continue;
      cellar.stored -= amount; cellar.transferred += amount; transferred += amount;
      scenario.receiveHM(amount);
    }
  }
  function audit() {
    const sites = mining.audit();
    const withdrawn = sites.reduce((sum, site) => sum + site.withdrawn, 0);
    const delivered = [...cellars.values()].reduce((sum, cellar) => sum + cellar.received, 0);
    const stored = [...cellars.values()].reduce((sum, cellar) => sum + cellar.stored, 0);
    const received = city.entries.reduce((sum, entry) => sum + (cellars.has(entry) ? entry.scenario.received : 0), 0);
    const inTransit = pipeline.inTransit('HM');
    const checks = {
      mined: sites.every((site) => site.conserved),
      dispatched: withdrawn === pipeline.ledger.dispatched.HM + tunnelLedger.paid,
      tunnels: tunnelLedger.billed === tunnelLedger.paid + tunnelLedger.debt.left + tunnelLedger.debt.right &&
        tunnelLedger.debt.left >= 0 && tunnelLedger.debt.right >= 0,
      transit: pipeline.ledger.dispatched.HM === pipeline.ledger.delivered.HM + inTransit,
      delivered: delivered === pipeline.ledger.delivered.HM,
      cellars: delivered === stored + transferred,
      scenarios: transferred === received,
    };
    return { ok: Object.values(checks).every(Boolean), checks, withdrawn, inTransit, delivered, stored, transferred,
      tunnelHM: { ...tunnelLedger, debt: { ...tunnelLedger.debt }, rates: { ...tunnelRates } } };
  }
  function step() {
    ticks += 1;
    mining.step();
    for (const site of mining.sites) {
      if (!site.ready || linked.has(site)) continue;
      linked.add(site);
      // Mine storage holds back HM reserved for a waiting tunnel order before feeding the building pipeline.
      pipeline.addEndpoint({ id: `${site.node.id}-storage`, owner: site.owner, resource: 'HM', role: 'source',
        x: site.drop.x, tapY: site.chamber.rect.top - 1,
        available: () => Math.max(0, site.stored - reserveFor(site.owner)), take: (amount) => mining.withdraw(site, amount) });
    }
    billNewSegments();
    payDebts();
    if (ticks % settings.transferTicks === 0) for (const order of orders) processOrder(order);
    pipeline.step();
    if (ticks % settings.transferTicks === 0) transfer(ticks % 60 === 0);
    if (ticks % settings.rescanTicks === 0) {
      scanBuildings();
      for (const faction of factions) {
        if (!faction.ok || faction.node.remaining > prospectAt) continue;
        // A failed survey is retried every 10 rescans in case buildings or craters moved.
        if (faction.prospect && !faction.prospect.ok && ticks < faction.prospect.retry) continue;
        faction.prospect = { ...prospect(faction), retry: ticks + settings.rescanTicks * 10 };
      }
      billNewSegments();
    }
    if (ticks % 60 === 0) {
      const result = audit();
      if (!result.ok) {
        throw new Error(`Full-map HM economy accounting failed: ${Object.entries(result.checks)
          .filter(([, ok]) => !ok).map(([name]) => name).join(', ')}`);
      }
    }
  }

  // Render data: static ops ([color, x, y, w, h] in cells) rebuild only when tunnels or pipes change.
  let staticOps = [], staticSignature = '';
  const COLORS = { casing: '#4a5560', pipe: '#e6cd72', ladder: '#c58b4a', marker: '#8bc6d6', node: '#ffa414',
    cellar: '#ffa414', particle: '#fff2a8', miner: '#ff8a3d', brokenPipe: '#ef6473', order: '#7fd4ff' };
  function overlay() {
    const signature = `${network.excavated}|${network.lined}|${network.markers.size}|${pipeline.pipes.size}|${pipeline.casing.size}`;
    if (signature !== staticSignature) {
      staticSignature = signature;
      staticOps = [];
      for (const k of pipeline.casing.keys()) staticOps.push(COLORS.casing, k % width, Math.floor(k / width), 1, 1);
      for (const k of pipeline.pipes.keys()) staticOps.push(COLORS.pipe, k % width, Math.floor(k / width), 1, 1);
      for (const k of network.markers) staticOps.push(COLORS.marker, k % width, Math.floor(k / width), 1, 1);
      for (const segment of network.segments) {
        for (const step of segment.steps.slice(0, segment.dug)) {
          for (const k of step.ladders) {
            if (network.isLadder(k % width, Math.floor(k / width))) staticOps.push(COLORS.ladder, k % width, Math.floor(k / width), 1, 1);
          }
        }
      }
    }
    const dynamic = [];
    for (const node of network.nodes) {
      if (node.remaining > 0) dynamic.push(COLORS.node, node.x - node.radius, node.y - node.radius, node.radius * 2 + 1, node.radius * 2 + 1);
    }
    for (const site of mining.sites) {
      if (!site.ready || !site.stored) continue;
      const rect = site.chamber.rect, rows = rect.bottom - rect.top + 1;
      const fill = Math.max(1, Math.round(rows * site.stored / site.capacity));
      dynamic.push(COLORS.cellar, rect.left, rect.bottom - fill + 1, rect.right - rect.left + 1, fill);
    }
    for (const cellar of cellars.values()) {
      if (!cellar.stored) continue;
      const { rect } = cellar, rows = rect.bottom - rect.top + 1;
      const fill = Math.max(1, Math.round(rows * cellar.stored / cellar.capacity));
      dynamic.push(COLORS.cellar, rect.left, rect.bottom - fill + 1, rect.right - rect.left + 1, fill);
    }
    for (const entry of pipeline.breaks.values()) dynamic.push(COLORS.brokenPipe, entry.x, entry.y, 1, 1);
    // Ordered but not yet paid tunnel route: a dotted centre line.
    for (const order of orders) {
      if (order.done || order.blocked) continue;
      const paidCells = order.next * orderChunk;
      for (let i = paidCells; i < order.line.length; i += 2) dynamic.push(COLORS.order, order.line[i].x, order.line[i].y, 1, 1);
    }
    for (const particle of pipeline.particles) dynamic.push(COLORS.particle, particle.x, particle.y, 1, 1);
    for (const miner of mining.miners) {
      if (miner.state !== 'node exhausted') dynamic.push(COLORS.miner, miner.x - 1, miner.y - 1, 3, 3);
    }
    return { staticOps, dynamic };
  }
  function inspect() {
    const result = audit();
    return {
      ...result, ticks, hmDepth,
      factions: factions.map((faction) => faction.ok ? { owner: faction.owner, ok: true, entranceX: faction.entranceX,
        node: { id: faction.node.id, x: faction.node.x, y: faction.node.y, remaining: faction.node.remaining,
          connected: faction.node.connected }, nodes: faction.nodes.length,
        prospect: faction.prospect && (faction.prospect.ok ? `surveyed ${faction.prospect.node}` : `survey failed: ${faction.prospect.reason}`) }
        : { owner: faction.owner, ok: false, reason: faction.reason }),
      tunnels: network.inspect(),
      sites: mining.sites.map((site) => ({ node: site.node.id, ready: site.ready, stored: site.stored,
        capacity: site.capacity, state: site.state, ...(site.storageMiss ? { storageMiss: site.storageMiss } : {}) })),
      miners: mining.miners.map((miner) => miner.state),
      cellars: [...cellars.values()].map((cellar) => ({ index: city.entries.indexOf(cellar.entry), owner: cellar.owner,
        stored: cellar.stored, capacity: cellar.capacity, transferred: cellar.transferred,
        state: cellar.endpoint.state, buildingHM: cellar.entry.scenario.hm })),
      unserved: city.entries.filter((entry) => entry.scenario.paidGrowth && !cellars.has(entry))
        .map((entry) => city.entries.indexOf(entry)),
      playerTunnels,
      orders: orders.map((order) => ({ id: order.id, owner: order.owner, segments: `${order.next}/${order.chunks.length}`,
        estimate: order.estimate, paid: order.paid, waiting: order.waiting, done: order.done, blocked: order.blocked,
        state: order.state })),
    };
  }
  return { network, mining, pipeline, cellars, factions, settings, hmDepth, step, audit, inspect, overlay,
    priceSegment, quoteTunnel, orderTunnel, cancelOrder, anchorNear, orders, playerTunnels, zoneLimits,
    get ticks() { return ticks; } };
}
