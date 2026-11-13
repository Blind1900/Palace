// Road / tunnel-entrance seam lab (testing lane). Each card is its own small world with one entrance shaft:
// a bare mouth, a road passing over it (the road planner's hatch) and roads ending at it (portal landings,
// scripts/pixel-road-tunnel-seam.js). Troopers and tanks drive at the mouth from the road side and from the
// far side; the card passes when nobody drops into the shaft and everyone ends where the seam says they should.
// Query: ?ticks=N runs headless and writes a summary to body[data-seam].
(() => {
  const query = new URLSearchParams(location.search);
  const grid = document.getElementById('seam-grid'), statusLabel = document.getElementById('seam-status');
  const W = 260, H = 110, BASE = 52, DEPTH = 24;
  const art = {
    trooper: createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellReduction: 4 }),
    tank: typeof PIXEL_TANK_REFERENCE !== 'undefined' ? createPixelUnitArtwork(PIXEL_TANK_REFERENCE,
      { roles: ['move', 'aim'], cellScale: PIXEL_UNIT_RELATIVE_SCALES.tank, cellReduction: 4 }) : null,
  };
  // expect: what each mover should do - cross (pass over the mouth), landing (stop on the portal landing),
  // rail (stop at the guard rail on the far side), any (demonstration only).
  const SCENARIOS = [
    { id: 'bare3', title: 'Bare mouth, 3 px shaft (no road)', ex: 130, interior: 3, road: 'none', expect: 'any',
      note: 'Baseline: what units do at an unprotected entrance today.' },
    { id: 'bare5', title: 'Bare mouth, 5 px shaft (no road)', ex: 130, interior: 5, road: 'none', expect: 'any',
      note: 'Baseline: a wider mouth snags troopers - why entrances under roads need a seam.' },
    { id: 'over3', title: 'Road passes over (hatch), 3 px', ex: 130, interior: 3, road: 'over', expect: 'cross',
      note: 'Road planner hatch: solid lid flush with the deck, ladder ends at a manhole.' },
    { id: 'over5', title: 'Road passes over (hatch), 5 px', ex: 130, interior: 5, road: 'over', expect: 'cross',
      note: 'Same hatch over the wider mouth.' },
    { id: 'portalR', title: 'Road ends at entrance - portal (road from the right)', ex: 60, interior: 3, road: 'portal', side: 1,
      expect: 'landing', note: 'Ramp 1:2 down into a pit beside the shaft; lid over the mouth; rail on the far edge.' },
    { id: 'portalL', title: 'Road ends at entrance - portal (road from the left)', ex: 200, interior: 3, road: 'portal', side: -1,
      expect: 'landing', note: 'Mirror image: ladder on the other side of the shaft.' },
    { id: 'portalSlope', title: 'Portal on rolling ground, 5 px shaft', ex: 60, interior: 5, road: 'portal', side: 1, amp: 2,
      expect: 'landing', note: 'Uneven ground is cut and filled to the ramp profile.' },
  ];
  const COLORS = { sky: [24, 30, 42], soil: [92, 70, 50], grass: [86, 120, 64], wall: [120, 124, 132], bore: [34, 30, 28],
    ladder: [176, 122, 60], road: [90, 94, 102], mark: [220, 200, 90], ramp: [201, 162, 39], landing: [178, 142, 34],
    lid: [138, 150, 168], manhole: [224, 230, 239], rail: [217, 79, 61] };
  const UNIT_TINT = { trooper: (c) => [Math.min(255, ((c >> 16) & 255) + 40), Math.min(255, ((c >> 8) & 255) + 120), c & 255],
    tank: (c) => [(c >> 16) & 255, (c >> 8) & 255, Math.min(255, (c & 255) + 90)] };

  let cards = [], running = false;

  function makeWorld(scenario) {
    const world = createParticleWorld(W, H);
    const heights = new Int32Array(W);
    for (let x = 0; x < W; x += 1) heights[x] = BASE + Math.round((scenario.amp || 0) * Math.sin(x / 7) + (scenario.amp ? Math.sin(x / 3) : 0));
    for (let x = 0; x < W; x += 1) for (let y = heights[x]; y < H; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const network = createPixelTunnelNetwork(world, { interior: scenario.interior, surfaceAt: (x) => heights[Math.max(0, Math.min(W - 1, x))] });
    const r = network.radius, ex = scenario.ex;
    const shaft = network.plan({ kind: 'shaft', from: 'surface', owner: 'blue', label: 'entrance',
      points: [{ x: ex, y: heights[ex] - r - 1 }, { x: ex, y: heights[ex] + DEPTH }], ladderSide: scenario.side < 0 ? 'right' : 'left' });
    if (!shaft.ok) throw new Error(`shaft: ${shaft.reason}`);
    network.buildNow(shaft.segment);
    const trunk = network.plan({ kind: 'tunnel', from: shaft.segment.id, label: 'gallery',
      points: [{ x: ex, y: heights[ex] + DEPTH }, { x: ex + (scenario.side || 1) * -30, y: heights[ex] + DEPTH }] });
    if (trunk.ok) network.buildNow(trunk.segment);
    return { world, network, heights };
  }

  function createCard(scenario) {
    const card = document.createElement('section');
    card.className = 'seam-card';
    card.innerHTML = `<h2>${scenario.title}</h2><p>${scenario.note}</p><canvas></canvas><div class="status"></div>`;
    grid.appendChild(card);
    const entry = { scenario, card, canvas: card.querySelector('canvas'), statusEl: card.querySelector('.status') };
    try { setup(entry); } catch (error) { entry.error = error.message; card.classList.add('failed'); }
    return entry;
  }

  function setup(entry) {
    const { scenario } = entry;
    const { world, network } = makeWorld(scenario);
    const roads = createPixelSurfaceRoads(world, { network });
    const mouth = findPixelShaftMouths(world, network)[0];
    if (!mouth) throw new Error('no shaft mouth found');
    let portal = null, roadResult = null, ledger = null;
    if (scenario.road === 'over') {
      roadResult = roads.plan({ owner: 'blue', label: 'main road', from: { x: mouth.x - 80 }, to: { x: mouth.x + 80 } });
      if (!roadResult.ok) throw new Error(`road: ${roadResult.reason}`);
      roads.buildNow(roadResult.road);
    } else if (scenario.road === 'portal') {
      portal = planPixelRoadPortal(world, network, mouth, scenario.side);
      if (!portal.ok) throw new Error(`portal: ${portal.reason} at ${portal.at}`);
      roadResult = roads.plan({ owner: 'blue', label: 'main road', from: { x: portal.roadEnd.x + scenario.side * 70 }, to: { x: portal.roadEnd.x } });
      if (!roadResult.ok) throw new Error(`road: ${roadResult.reason} at ${roadResult.at}`);
      roads.buildNow(roadResult.road);
      ledger = buildPixelRoadPortal(world, network, portal);
    }
    Object.assign(entry, { world, network, roads, mouth, portal, roadResult, ledger, cells: portal ? pixelRoadPortalCells(portal) : [] });
    entry.pitCells = new Set();
    if (portal) for (const c of portal.columns) for (let y = portal.ground + 1; y < c.floor; y += 1) entry.pitCells.add(`${c.x},${y}`);
    spawnMovers(entry);
    draw(entry);
  }

  // Movers: from the road side (or the left, for pass-over cards) towards the mouth, and from the far side.
  function spawnMovers(entry) {
    const { scenario, mouth, world } = entry;
    const toward = scenario.road === 'portal' ? -scenario.side : 1;
    const nearStart = scenario.road === 'portal' ? entry.portal.roadEnd.x + scenario.side * 40 : mouth.x - 70;
    const farStart = mouth.x + toward * 45;
    entry.movers = [];
    for (const kind of ['trooper', 'tank']) {
      if (!art[kind]) continue;
      const roadSide = scenario.road === 'portal' ? 'landing' : scenario.expect;
      entry.movers.push(spawn(entry, kind, nearStart, toward, roadSide, 'road side'));
      if (scenario.road === 'portal') entry.movers.push(spawn(entry, kind, farStart, -toward, 'rail', 'far side'));
    }
    entry.ticks = 0;
  }
  function spawn(entry, kind, x, facing, expect, label) {
    const { world } = entry;
    const make = (options) => kind === 'trooper' ? createPixelTerrainUnit(world, art[kind], options) : createPixelVehicleUnit(world, art[kind], { kind, ...options });
    const probe = make({ x: 2, y: 1, facing }).inspect({ sprites: false }).collision;
    const left = Math.min(...probe.map((p) => p.x)), right = Math.max(...probe.map((p) => p.x)), bottom = Math.max(...probe.map((p) => p.y));
    const x0 = Math.max(2 - left, Math.min(W - 3 - right, Math.round(x - (left + right) / 2)));
    let top = H;
    for (let cx = x0 + left; cx <= x0 + right; cx += 1) { let y = 0; while (y < H - 1 && world.at(cx, y) === PARTICLE_EMPTY) y += 1; top = Math.min(top, y); }
    const unit = make({ x: x0, y: top - 1 - bottom, facing });
    return { unit, kind, facing, expect, label, startBottom: top - 1, maxBottom: top - 1, fell: false, best: -Infinity, idle: 0, mask: probe };
  }

  function stepCard(entry) {
    if (entry.error) return;
    entry.ticks += 1;
    const { network, mouth } = entry;
    for (const mover of entry.movers) {
      const { unit } = mover;
      unit.input.right = mover.facing > 0; unit.input.left = mover.facing < 0;
      unit.step(1 / 60);
      const state = unit.inspect({ sprites: false });
      const bottom = state.y + Math.max(...state.collision.map((p) => p.y));
      mover.maxBottom = Math.max(mover.maxBottom, bottom);
      // Dropped into the shaft: any body pixel inside the bore below the mouth's ground row.
      if (state.collision.some((p) => network.isCarved(state.x + p.x, state.y + p.y) && state.y + p.y > mouth.ground)) mover.fell = true;
      if (entry.portal && mover.expect === 'rail' && state.collision.some((p) => entry.pitCells.has(`${state.x + p.x},${state.y + p.y}`))) mover.inPit = true;
      const progress = state.x * mover.facing;
      if (progress > mover.best + 0.5) { mover.best = progress; mover.idle = 0; } else mover.idle += 1;
      mover.state = state; mover.bottom = bottom;
    }
  }

  function verdict(entry, mover) {
    const { mouth, portal } = entry, s = mover.state;
    if (!s) return { ok: false, text: 'not run' };
    const xs = s.collision.map((p) => s.x + p.x);
    // Lead/tail from the running gear (lowest rows): a gun barrel may overhang the rail, the tracks may not.
    const low = Math.max(...s.collision.map((p) => p.y));
    const feet = s.collision.filter((p) => p.y >= low - 2).map((p) => s.x + p.x);
    const lead = mover.facing > 0 ? Math.max(...feet) : Math.min(...feet);
    const tail = mover.facing > 0 ? Math.min(...xs) : Math.max(...xs);
    if (mover.fell) return { ok: mover.expect === 'any' && false, text: 'FELL into shaft' };
    if (mover.expect === 'cross' || mover.expect === 'any') {
      const crossed = mover.facing > 0 ? tail > mouth.lining.right : tail < mouth.lining.left;
      return { ok: crossed, text: crossed ? 'crossed' : `stuck at x ${Math.round(lead)} (mouth ${mouth.left}-${mouth.right})` };
    }
    if (mover.expect === 'landing') {
      const onFloor = mover.bottom === portal.floor - 1;
      const inside = Math.min(...xs) >= portal.landing.left - 1 && Math.max(...xs) <= portal.landing.right + 1;
      const ok = onFloor && inside && mover.idle > 30;
      return { ok, text: ok ? `parked on landing (floor ${portal.floor})` : `bottom ${mover.bottom} vs floor ${portal.floor - 1}, x ${Math.min(...xs)}-${Math.max(...xs)}, idle ${mover.idle}` };
    }
    // rail: stopped at the pit edge and no body pixel ever entered the pit (below ground level over the landing).
    const dropped = mover.inPit;
    const gap = (portal.edge - lead) * mover.facing;
    const ok = !dropped && mover.idle > 30 && gap >= 0 && gap <= 3;
    return { ok, text: ok ? `stopped at rail (gap ${gap})` : dropped ? 'entered the pit' : `lead x ${Math.round(lead)}, rail ${portal.edge}, idle ${mover.idle}` };
  }

  function summary(entry) {
    if (entry.error) return { ok: false, text: `ERROR ${entry.error}` };
    const results = entry.movers.map((mover) => ({ mover, ...verdict(entry, mover) }));
    const demo = entry.scenario.expect === 'any';
    const ok = demo || results.every((r) => r.ok);
    const lines = results.map((r) => `${demo ? '-' : r.ok ? 'ok' : 'XX'} ${r.mover.label} ${r.mover.kind}: ${r.text}`);
    const extras = [];
    if (entry.roadResult) extras.push(`road ${entry.roadResult.ok ? `ok, hatches ${entry.roadResult.hatches || 0}` : entry.roadResult.reason}`);
    if (entry.portal) extras.push(`portal: ramp ${entry.portal.ramp.from}-${entry.portal.ramp.to}, landing ${entry.portal.landing.left}-${entry.portal.landing.right}, cut ${entry.ledger.cut}, fill ${entry.ledger.filled}, lid ${entry.ledger.lid}, rail ${entry.ledger.rail}`);
    return { ok, demo, text: [...extras, ...lines].join('\n'), compact: `${entry.scenario.id}:${demo ? 'demo' : ok ? 'PASS' : 'FAIL'}[${results.map((r) => `${r.mover.label.split(' ')[0]}-${r.mover.kind}=${r.ok ? 'ok' : r.text.replace(/\s+/g, '_')}`).join(',')}]` };
  }

  function draw(entry) {
    const { world, network, canvas } = entry;
    if (!world) { entry.statusEl.textContent = summary(entry).text; return; }
    canvas.width = W; canvas.height = H;
    const context = canvas.getContext('2d'), image = context.createImageData(W, H), data = image.data;
    const set = (x, y, [r, g, b]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; };
    const deck = new Map();
    for (const road of entry.roads.roads) for (const c of road.columns) deck.set(`${c.x},${c.deck}`, c);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const m = world.at(x, y);
      let color = COLORS.sky;
      if (network.isLadder(x, y) && m === PARTICLE_EMPTY) color = COLORS.ladder;
      else if (network.isCarved(x, y) && m === PARTICLE_EMPTY) color = COLORS.bore;
      else if (m === PARTICLE_WALL) color = COLORS.wall;
      else if (m === PARTICLE_TERRAIN) color = world.at(x, y - 1) === PARTICLE_EMPTY ? COLORS.grass : COLORS.soil;
      const road = deck.get(`${x},${y}`);
      if (road && m !== PARTICLE_EMPTY) color = road.hatch ? (road.manhole ? COLORS.manhole : COLORS.lid) : (x % 6 < 3 ? COLORS.mark : COLORS.road);
      set(x, y, color);
    }
    for (const cell of entry.cells) if (world.at(cell.x, cell.y) !== PARTICLE_EMPTY) set(cell.x, cell.y, COLORS[cell.part]);
    for (const mover of entry.movers || []) {
      const state = mover.unit.inspect();
      for (const pixel of state.pixels) set(state.x + pixel.x, state.y + pixel.y, UNIT_TINT[mover.kind](pixel.color));
    }
    context.putImageData(image, 0, 0);
    const result = summary(entry);
    entry.statusEl.textContent = result.text;
    entry.card.classList.toggle('passed', !result.demo && result.ok && entry.ticks > 0);
    entry.card.classList.toggle('failed', !result.ok);
  }

  function build() {
    grid.innerHTML = '';
    cards = SCENARIOS.map(createCard);
    statusLabel.textContent = 'Ready - press Run units';
  }
  function loop() {
    if (!running) return;
    for (const entry of cards) stepCard(entry);
    cards.forEach(draw);
    if (cards.every((entry) => entry.error || entry.ticks >= 900)) { running = false; statusLabel.textContent = 'Done'; return; }
    requestAnimationFrame(loop);
  }
  document.getElementById('seam-run').addEventListener('click', () => { if (!running) { running = true; statusLabel.textContent = 'Running...'; requestAnimationFrame(loop); } });
  document.getElementById('seam-reset').addEventListener('click', () => { running = false; build(); });
  build();
  if (query.has('ticks')) {
    const ticks = Number(query.get('ticks')) || 900;
    for (let t = 0; t < ticks; t += 1) for (const entry of cards) stepCard(entry);
    cards.forEach(draw);
    document.body.dataset.seam = cards.map((entry) => summary(entry).compact).join(' ');
    statusLabel.textContent = 'Done';
  } else if (query.has('run')) { running = true; requestAnimationFrame(loop); }
})();
