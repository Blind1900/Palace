// Road earthworks lab (testing lane). Each terrain is run three ways - no road, the road planner alone,
// and earthworks (grading + mountain tunnel) followed by the road planner - and a trooper and a tank drive the
// whole route. A card passes when both units reach the far end.
// Query: ?ticks=N runs headless and writes a summary to body[data-earth]. Debug: &debug=1 (stuck probe), &trace=1
// (mech state history + overhead-jump check), &ascii=X,Y (cell map with the mech mask), &lip=0|1 (portal lintel lip).
(() => {
  const query = new URLSearchParams(location.search);
  const grid = document.getElementById('earth-grid'), statusLabel = document.getElementById('earth-status');
  if (query.has('cols')) grid.style.gridTemplateColumns = `repeat(${Number(query.get('cols'))}, 1fr)`;
  // ?sky=N adds N rows of headroom (tall units such as the mech otherwise hit the world ceiling over peaks).
  const SKY = Number(query.get('sky')) || 0;
  const W = 360, H = 150 + SKY, BASE = 112 + SKY, START = 10, END = W - 11;
  const art = {
    trooper: createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellReduction: 4 }),
    tank: createPixelUnitArtwork(PIXEL_TANK_REFERENCE, { roles: ['move', 'aim'], cellScale: PIXEL_UNIT_RELATIVE_SCALES.tank, cellReduction: 4 }),
    hopper: typeof PIXEL_HOPPER_REFERENCE === 'undefined' ? null : createPixelUnitArtwork(PIXEL_HOPPER_REFERENCE,
      { roles: ['idle', 'jump', 'boost', 'fall'], cellScale: PIXEL_UNIT_RELATIVE_SCALES.hopper, cellReduction: 4, inPlace: true }),
  };
  // ?units=trooper,tank,hopper picks the movers (hopper = mech); ?clearance=N sets the tunnel bore height.
  const UNITS = (query.get('units') || 'trooper,tank').split(',').filter((kind) => art[kind]);
  const EARTH = { ...(query.has('clearance') ? { clearance: Number(query.get('clearance')) } : {}), ...(query.has('lip') ? { portalLip: query.get('lip') !== '0' } : {}) };
  const bump = (x, c, w, hgt) => hgt * Math.max(0, 1 - Math.abs(x - c) / w);
  const smooth = (x, c, w, hgt) => hgt * Math.exp(-(((x - c) / w) ** 2));
  const TERRAINS = [
    { id: 'rolling', title: 'Rolling ground', at: (x) => 5 * Math.sin(x / 9) + 3 * Math.sin(x / 4) },
    { id: 'hill', title: 'Steep small hill (14 px)', at: (x) => bump(x, 180, 10, 14) },
    { id: 'cliff', title: 'Cliff up to a plateau (18 px)', at: (x) => (x > 170 ? 18 : 0) + (x > 172 ? Math.sin(x / 6) : 0) },
    { id: 'mountain', title: 'Mountain (65 px)', at: (x) => bump(x, 180, 60, 65) + 3 * Math.sin(x / 5) * (Math.abs(x - 180) < 60 ? 1 : 0) },
    { id: 'crevice', title: 'Crevice then mountain', at: (x) => -(Math.abs(x - 80) < 5 ? 22 : 0) + smooth(x, 220, 40, 60) },
    { id: 'twin', title: 'Twin peaks with a valley', at: (x) => bump(x, 120, 45, 55) + bump(x, 250, 45, 60) },
  ];
  const MODES = [
    { id: 'raw', label: 'no road' },
    { id: 'road', label: 'road planner only' },
    { id: 'graded', label: 'earthworks + road' },
  ];
  // ?fuzz=N: N seeded random terrains (bumps, mountains, cliffs, crevices), earthworks + road only, alternating direction.
  const FUZZ = Number(query.get('fuzz')) || 0;
  if (FUZZ) {
    TERRAINS.length = 0;
    const seed0 = Number(query.get('seed')) || 1;
    for (let k = 0; k < FUZZ; k += 1) {
      let a = (seed0 * 7919 + k * 104729) >>> 0;
      const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const features = [];
      const count = 2 + Math.floor(rnd() * 4);
      for (let f = 0; f < count; f += 1) {
        const type = ['bump', 'mountain', 'cliff', 'crevice', 'smooth'][Math.floor(rnd() * 5)];
        features.push({ type, c: 40 + rnd() * (W - 80), w: 6 + rnd() * 50, h: type === 'crevice' ? 8 + rnd() * 20 : 6 + rnd() * 60, s: rnd() < 0.5 ? 1 : -1 });
      }
      const noise = rnd() * 4, phase = rnd() * 10;
      TERRAINS.push({ id: `fuzz${seed0}-${k}`, title: `Random ${seed0}-${k}: ${features.map((f) => f.type).join(', ')}`, reverse: k % 2 === 1,
        at: (x) => Math.min(80, Math.max(-25, noise * Math.sin(x / 7 + phase) + features.reduce((t, f) => t + (
          f.type === 'bump' ? bump(x, f.c, f.w / 3, f.h / 3)
            : f.type === 'mountain' ? bump(x, f.c, f.w, f.h)
              : f.type === 'smooth' ? smooth(x, f.c, f.w, f.h)
                : f.type === 'cliff' ? (f.s * (x - f.c) > 0 ? f.h / 3 : 0)
                  : -(Math.abs(x - f.c) < f.w / 8 ? f.h : 0)), 0))) });
    }
    MODES.splice(0, 2);
    if (query.has('only')) { const keep = query.get('only').split(',').map(Number); const kept = TERRAINS.filter((_, i) => keep.includes(i)); TERRAINS.length = 0; TERRAINS.push(...kept); }
  }
  const COLORS = { sky: [24, 30, 42], dug: [44, 50, 64], soil: [92, 70, 50], grass: [86, 120, 64], wall: [150, 150, 158],
    road: [90, 94, 102], mark: [220, 200, 90], bridge: [130, 120, 108], tunnelAir: [36, 34, 38] };
  const TINT = { trooper: (c) => [Math.min(255, ((c >> 16) & 255) + 40), Math.min(255, ((c >> 8) & 255) + 120), c & 255],
    tank: (c) => [(c >> 16) & 255, (c >> 8) & 255, Math.min(255, (c & 255) + 90)],
    hopper: (c) => [Math.min(255, ((c >> 16) & 255) + 110), (c >> 8) & 255, Math.min(255, (c & 255) + 60)] };
  let cards = [], running = false;

  function makeWorld(terrain) {
    const world = createParticleWorld(W, H);
    for (let x = 0; x < W; x += 1) {
      const g = Math.round(BASE - terrain.at(x));
      for (let y = Math.max(1, g); y < H; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    }
    return world;
  }

  function setup(entry) {
    const { terrain, mode } = entry;
    const world = makeWorld(terrain);
    const roads = createPixelSurfaceRoads(world, {});
    const spec = terrain.reverse ? { owner: 'blue', label: 'route', from: { x: END }, to: { x: START } } : { owner: 'blue', label: 'route', from: { x: START }, to: { x: END } };
    entry.dir = terrain.reverse ? -1 : 1;
    entry.world = world; entry.roads = roads; entry.dug = new Set(); entry.tunnelCells = new Set();
    if (mode.id === 'road') {
      entry.road = roads.plan(spec);
      if (entry.road.ok) roads.buildNow(entry.road.road);
    } else if (mode.id === 'graded') {
      const result = planPixelGradedRoad(world, roads, spec, EARTH);
      entry.graded = result;
      if (result.earthworks && result.earthworks.ok) for (const c of result.earthworks.columns) {
        for (const y of c.cut) entry.dug.add(`${c.x},${y}`);
        if (c.part === 'tunnel') for (let y = c.deck - 1; y > c.lining[0]; y -= 1) entry.tunnelCells.add(`${c.x},${y}`);
      }
      entry.road = result.road || { ok: false, reason: result.reason, at: result.at };
      if (result.ok) roads.buildNow(result.road.road);
    }
    entry.movers = UNITS.map((kind) => spawn(entry, kind));
    entry.ticks = 0;
  }

  function spawn(entry, kind) {
    const { world } = entry, dir = entry.dir;
    const make = (o) => kind === 'trooper' ? createPixelTerrainUnit(world, art[kind], o) : createPixelVehicleUnit(world, art[kind], { kind, ...(kind === 'hopper' ? { automated: true, assault: true } : {}), ...o });
    const mask = make({ x: 2, y: 1, facing: dir }).inspect({ sprites: false }).collision;
    const left = Math.min(...mask.map((p) => p.x)), right = Math.max(...mask.map((p) => p.x)), bottom = Math.max(...mask.map((p) => p.y));
    const x0 = dir > 0 ? START + 2 - left : END - 2 - right;
    let top = H;
    const road = entry.roads.roads[0];
    for (let cx = x0 + left; cx <= x0 + right; cx += 1) {
      const deck = road && road.deck.get(cx);
      if (deck !== undefined) { top = Math.min(top, deck); continue; }
      let y = 0; while (y < H - 1 && world.at(cx, y) === PARTICLE_EMPTY) y += 1; top = Math.min(top, y);
    }
    return { kind, unit: make({ x: x0, y: top - 1 - bottom, facing: dir }), best: -Infinity, idle: 0, reached: 0, error: null };
  }

  function stepCard(entry) {
    if (entry.error) return;
    entry.ticks += 1;
    for (const m of entry.movers) {
      if (m.reached || m.error) continue;
      try {
        m.unit.input.right = entry.dir > 0; m.unit.input.left = entry.dir < 0;
        m.unit.step(1 / 60);
      } catch (error) { m.error = error.message; continue; }
      const s = m.unit.inspect({ sprites: false });
      const xs = s.collision.map((p) => s.x + p.x);
      const lead = entry.dir > 0 ? Math.max(...xs) : -Math.min(...xs);
      m.lead = lead; m.state = s;
      if (query.has('trace') && m.kind === 'hopper' && entry.ticks % 10 === 0) { (m.trace = m.trace || []).push(`${entry.ticks}:${Math.round(s.x)},${Math.round(s.y)} ${s.animation || ''} g${s.grounded ? 1 : 0} c${s.charges} v${Math.round(s.vx)},${Math.round(s.vy)} ${s.state || ''}`); if (m.trace.length > 30) m.trace.shift(); }
      if (lead > m.best + 0.5) { m.best = lead; m.idle = 0; } else m.idle += 1;
      if (entry.dir > 0 ? lead >= END - 2 : -lead <= START + 2) m.reached = entry.ticks;
    }
  }

  // Debug: unit bottom row and, per column ahead of the lead, the rows of the top 3 solid cells (W=wall, T=terrain).
  function probe(entry, m) {
    const s = m.state; if (!s) return '';
    const xs = s.collision.map((p) => s.x + p.x), bottom = s.y + Math.max(...s.collision.map((p) => p.y));
    const lead = entry.dir > 0 ? Math.max(...xs) : Math.min(...xs);
    const cols = [];
    for (let k = -2; k <= 4; k += 1) {
      const x = lead + entry.dir * k, cells = [];
      for (let y = bottom - 6; y <= bottom + 4 && cells.length < 4; y += 1) { const v = entry.world.at(x, y); if (v !== PARTICLE_EMPTY) cells.push(`${y}${v === PARTICLE_WALL ? 'W' : v === PARTICLE_TERRAIN ? 'T' : v}`); }
      cols.push(`${x}:${cells.join('/')}`);
    }
    const hits = [];
    for (const p of s.collision) {
      const x = s.x + p.x + entry.dir, y = s.y + p.y, v = entry.world.at(x, y);
      if (v !== PARTICLE_EMPTY && hits.length < 6) hits.push(`${x},${y}${v === PARTICLE_WALL ? 'W' : v === PARTICLE_TERRAIN ? 'T' : v}(h${Math.max(...s.collision.map((q) => q.y)) - p.y})`);
    }
    const tunnel = (entry.graded && entry.graded.earthworks && entry.graded.earthworks.columns || []).find((c) => c.x === lead && c.part === 'tunnel');
    return `[pos ${s.x.toFixed(1)},${s.y.toFixed(1)} bottom ${bottom} lead ${lead} top ${s.y + Math.min(...s.collision.map((p) => p.y))}` +
      ` | ${cols.join(' ')} | next-step hits ${hits.join(' ') || 'none'}${tunnel ? ` | tunnel deck ${tunnel.deck} roof ${tunnel.lining[0]}` : ''}]`;
  }

  function summary(entry) {
    if (entry.error) return { ok: false, text: `ERROR ${entry.error}`, compact: `${entry.terrain.id}/${entry.mode.id}:ERROR` };
    const lines = [];
    if (entry.mode.id !== 'raw') {
      const r = entry.road;
      lines.push(r && r.ok ? `road ok: cut ${r.cut || 0}, fill ${r.filled || 0}, bridges ${r.bridges || 0}, grade ${r.grade}`
        : `road FAILED: ${r ? r.reason : '?'}${r && r.at !== undefined ? ` at x ${r.at}` : ''}`);
    }
    if (entry.graded && entry.graded.earthworks && entry.graded.earthworks.ok) {
      const e = entry.graded.earthworks;
      lines.push(`earthworks: cut ${e.cut}, deepest open cut ${e.maxOpenCut}px, tunnels ${e.tunnels.map((t) => `${t.from}-${t.to} (${t.length}px)`).join(', ') || 'none'}`);
      if (query.has('debug')) lines.push(`spans ${JSON.stringify(e.spans)}`);
    }
    const unitText = entry.movers.map((m) => m.reached ? `${m.kind} reached the end in ${m.reached} ticks`
      : m.error ? `${m.kind} ERROR ${m.error}` : `${m.kind} stuck at x ${Math.abs(Math.round(m.best))}${query.has('debug') ? ` ${probe(entry, m)} {${m.state && m.state.state}; ${m.state && m.state.navigation}; grounded ${m.state && m.state.grounded}}` : ''}`);
    for (const m of entry.movers) if (m.trace) {
      const s = m.state; let lift = 0, hit = null;
      for (let l = 1; l <= 18 && !hit; l += 1) { hit = findPixelUnitContact(entry.world, s.x, s.y - l, s.collision, true); lift = l; }
      unitText.push(`jumpClear ${hit ? `blocked at lift ${lift} by ${JSON.stringify(hit)}` : 'clear'}`);
      if (query.has('ascii')) {
        const keys = new Set(s.collision.map((p) => `${Math.round(s.x + p.x)},${Math.round(s.y + p.y)}`));
        const [ax, ay] = query.get('ascii').split(',').map(Number), rows = [];
        for (let y = ay; y < ay + 90; y += 1) {
          let row = `${y}`.padStart(3) + ' ';
          for (let x = ax; x < ax + 90; x += 1) {
            const c = entry.world.at(x, y), mine = keys.has(`${x},${y}`);
            row += mine ? (c === PARTICLE_EMPTY ? 'm' : '!') : c === PARTICLE_EMPTY ? '.' : c === PARTICLE_TERRAIN ? '#' : String(c);
          }
          rows.push(row);
        }
        unitText.push(`ascii from x ${ax}\n${rows.join('\n')}`);
      }
      unitText.push(`trace ${m.trace.join(' | ')}`);
    }
    const ok = entry.movers.every((m) => m.reached);
    return { ok, text: [...lines, ...unitText].join('\n'),
      compact: `${entry.terrain.id}/${entry.mode.id}:${ok ? 'PASS' : 'FAIL'}[${entry.mode.id === 'raw' ? '' : entry.road && entry.road.ok ? 'road,' : 'noroad,'}${entry.movers.map((m) => `${m.kind}=${m.reached || `x${Math.abs(Math.round(m.best))}`}`).join(',')}${entry.graded && entry.graded.earthworks && entry.graded.earthworks.ok ? `,tunnels=${entry.graded.earthworks.tunnels.length},opencut=${entry.graded.earthworks.maxOpenCut}` : ''}]` };
  }

  function draw(entry) {
    const { canvas } = entry;
    if (!entry.world) { entry.statusEl.textContent = summary(entry).text; return; }
    const { world } = entry;
    canvas.width = W; canvas.height = H;
    const context = canvas.getContext('2d'), image = context.createImageData(W, H), data = image.data;
    const set = (x, y, [r, g, b]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; };
    const deck = new Map();
    for (const road of entry.roads.roads) for (const c of road.columns) deck.set(`${c.x},${c.deck}`, c);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const m = world.at(x, y), k = `${x},${y}`;
      let color = entry.tunnelCells.has(k) ? COLORS.tunnelAir : entry.dug.has(k) ? COLORS.dug : COLORS.sky;
      if (m === PARTICLE_WALL) color = COLORS.wall;
      else if (m === PARTICLE_TERRAIN) color = world.at(x, y - 1) === PARTICLE_EMPTY ? COLORS.grass : COLORS.soil;
      const c = deck.get(k);
      if (c && m !== PARTICLE_EMPTY) color = c.bridge ? COLORS.bridge : x % 6 < 3 ? COLORS.mark : COLORS.road;
      set(x, y, color);
    }
    for (const m of entry.movers || []) {
      const s = m.unit.inspect();
      for (const p of s.pixels) set(s.x + p.x, s.y + p.y, TINT[m.kind](p.color));
    }
    context.putImageData(image, 0, 0);
    const result = summary(entry);
    entry.statusEl.textContent = result.text;
    entry.card.classList.toggle('passed', result.ok);
    entry.card.classList.toggle('failed', !result.ok && entry.ticks > 0 && entry.movers.every((m) => m.reached || m.idle > 200 || m.error));
  }

  function createCard(terrain, mode) {
    const card = document.createElement('section');
    card.className = 'earth-card';
    card.innerHTML = `<h2>${terrain.title} - ${mode.label}</h2><canvas></canvas><div class="status"></div>`;
    grid.appendChild(card);
    const entry = { terrain, mode, card, canvas: card.querySelector('canvas'), statusEl: card.querySelector('.status') };
    try { setup(entry); } catch (error) { entry.error = error.message; }
    draw(entry);
    return entry;
  }
  function build() {
    grid.innerHTML = '';
    cards = [];
    for (const terrain of TERRAINS) for (const mode of MODES) cards.push(createCard(terrain, mode));
    statusLabel.textContent = 'Ready - press Run units';
  }
  const finished = (entry) => entry.error || entry.movers.every((m) => m.reached || m.error || m.idle > 240) || entry.ticks >= 3000;
  function loop() {
    if (!running) return;
    for (const entry of cards) if (!finished(entry)) { stepCard(entry); stepCard(entry); }
    cards.forEach(draw);
    if (cards.every(finished)) { running = false; statusLabel.textContent = 'Done'; return; }
    requestAnimationFrame(loop);
  }
  document.getElementById('earth-run').addEventListener('click', () => { if (!running) { running = true; statusLabel.textContent = 'Running...'; requestAnimationFrame(loop); } });
  document.getElementById('earth-reset').addEventListener('click', () => { running = false; build(); });
  // ?perf=W1,W2,..[&perfH=H]: time earthworks planning, building and the road planner on wide random worlds
  // (no units), median of 5 runs each; written to body[data-earth].
  if (query.has('perf')) {
    const PH = Number(query.get('perfH')) || 220, out = [];
    for (const PW of query.get('perf').split(',').map(Number)) {
      let a = PW >>> 0;
      const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const peaks = Array.from({ length: Math.max(2, Math.round(PW / 160)) }, () => ({ c: 40 + rnd() * (PW - 80), w: 20 + rnd() * 60, h: 10 + rnd() * 70 }));
      const at = (x) => 4 * Math.sin(x / 7) + peaks.reduce((t, p) => t + bump(x, p.c, p.w, p.h), 0);
      const make = () => {
        const world = createParticleWorld(PW, PH);
        for (let x = 0; x < PW; x += 1) for (let y = Math.max(1, Math.round(PH - 40 - Math.min(PH - 70, at(x)))); y < PH; y += 1) world.set(x, y, PARTICLE_TERRAIN);
        return world;
      };
      const spec = { owner: 'blue', label: 'route', from: { x: 10 }, to: { x: PW - 11 } };
      const times = { plan: [], build: [], road: [], raw: [] };
      let info = '';
      for (let rep = 0; rep < 5; rep += 1) {
        let world = make(), roads = createPixelSurfaceRoads(world, {});
        let t0 = performance.now();
        const plan = planPixelRoadEarthworks(world, spec.from, spec.to, EARTH);
        const t1 = performance.now();
        if (!plan.ok) { info = `earthworks failed: ${plan.reason}`; break; }
        buildPixelRoadEarthworks(world, plan);
        const t2 = performance.now();
        const road = roads.plan(spec);
        const t3 = performance.now();
        times.plan.push(t1 - t0); times.build.push(t2 - t1); times.road.push(t3 - t2);
        world = make(); roads = createPixelSurfaceRoads(world, {});
        t0 = performance.now(); roads.plan(spec); times.raw.push(performance.now() - t0);
        info = `tunnels ${plan.tunnels.length} cut ${plan.cut} road ${road.ok ? 'ok' : road.reason}`;
      }
      const med = (list) => list.length ? [...list].sort((p, q) => p - q)[list.length >> 1].toFixed(2) : '-';
      out.push(`W${PW}xH${PH}: plan ${med(times.plan)}ms build ${med(times.build)}ms road ${med(times.road)}ms rawRoad ${med(times.raw)}ms (${info})`);
    }
    document.body.dataset.earth = out.join(' || ');
    statusLabel.textContent = 'Perf done';
    return;
  }
  build();
  if (query.has('ticks')) {
    const ticks = Number(query.get('ticks')) || 3000;
    for (const entry of cards) for (let t = 0; t < ticks && !finished(entry); t += 1) stepCard(entry);
    cards.forEach(draw);
    document.body.dataset.earth = cards.map((entry) => summary(entry).compact).join(' ');
    statusLabel.textContent = 'Done';
  } else if (query.has('run')) { running = true; requestAnimationFrame(loop); }
})();
