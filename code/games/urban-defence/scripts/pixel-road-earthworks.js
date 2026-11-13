// Road earthworks (testing-lane prototype). Before a surface road is laid, the route is graded so every
// unit that can use the road can drive it:
//  1. narrow dips (< `bridgeSpan` wide) are bridged over by the design line (the road planner fills/bridges them),
//  2. the design line never rises or falls faster than `grade` px per column - bumps are cut down to it,
//  3. where that cut would be deeper than a vehicle bore plus a roof, the cut becomes a lined road tunnel
//     through the mountain instead of an open trench.
// The result is handed to createPixelSurfaceRoads().plan(), which then follows the graded floor (and the
// tunnel floor, because its reference line keeps to the level nearest the previous column).
const PIXEL_ROAD_EARTHWORKS_DEFAULTS = Object.freeze({
  grade: 0.5, bridgeSpan: 24, clearance: 26, vehicleLength: 32, lining: 2, cover: 3, maxOpenCut: 0, mergeGap: 6, backfill: true, portalLip: false,
});

// Open cut deeper than this becomes a tunnel: the bore, its lining and some rock cover must fit under the ground.
function pixelRoadTunnelDepth(settings) {
  return settings.maxOpenCut || settings.clearance + settings.lining + settings.cover;
}

function planPixelRoadEarthworks(world, from, to, options = {}) {
  const s = { ...PIXEL_ROAD_EARTHWORKS_DEFAULTS, ...options };
  const protect = options.protect || (() => false);
  const carved = options.network ? (x, y) => options.network.isCarved(x, y) : () => false;
  const fail = (reason, at) => ({ ok: false, reason, at });
  const x0 = Math.round(from.x), x1 = Math.round(to.x);
  if (x0 < 1 || x1 < 1 || x0 > world.width - 2 || x1 > world.width - 2) return fail('route leaves the world');
  if (Math.abs(x1 - x0) < 3) return fail('route is too short');
  const dir = x1 > x0 ? 1 : -1, n = Math.abs(x1 - x0) + 1;
  const xs = Array.from({ length: n }, (_, i) => x0 + dir * i);
  const top = (x) => { let y = 0; while (y < world.height - 1 && (world.at(x, y) === PARTICLE_EMPTY || world.at(x, y) === PARTICLE_DEBRIS)) y += 1; return y; };
  const ground = xs.map(top);
  // Heights (up = positive) so "cut" means lowering.
  const h = ground.map((y) => -y);
  // Closing (dilate then erode) bridges dips narrower than bridgeSpan so they don't drag the road down.
  const half = Math.floor(s.bridgeSpan / 2);
  const window = (arr, fn) => arr.map((_, i) => { let v = arr[i]; for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j += 1) v = fn(v, arr[j]); return v; });
  const closed = window(window(h, Math.max), Math.min).map((v, i) => Math.max(v, h[i]));
  // Cut-only grading: the highest line under `closed` whose slope never exceeds `grade`.
  const design = closed.slice();
  for (let i = 1; i < n; i += 1) design[i] = Math.min(design[i], design[i - 1] + s.grade);
  for (let i = n - 2; i >= 0; i -= 1) design[i] = Math.min(design[i], design[i + 1] + s.grade);
  const deck = design.map((v) => Math.ceil(-v - 1e-9));
  const tunnelDepth = pixelRoadTunnelDepth(s);
  let isTunnel = deck.map((d, i) => d - ground[i] > tunnelDepth);
  const spans = [];
  // A mountain too steep to grade: instead of following the graded peak inside the mountain, run the deck
  // straight from foot to foot (the lowest design points either side of the deep cut) and bore through.
  for (let i = 0; i < n; i += 1) {
    if (!isTunnel[i]) continue;
    let j = i; while (j + 1 < n && isTunnel[j + 1]) j += 1;
    // Walk to each foot of the hump: climb over the summit if needed, then descend; short level steps
    // (integer ground) don't count as the foot.
    const walk = (k, step) => {
      let q = k;
      while (q + step >= 0 && q + step < n && design[q + step] >= design[q] - 1e-9) q += step;
      let at = q, flat = 0;
      for (q += step; q >= 0 && q < n; q += step) {
        if (design[q] < design[q - step] - 1e-9) { at = q; flat = 0; } else if (design[q] <= design[q - step] + 1e-9 && ++flat <= s.bridgeSpan) continue;
        else break;
      }
      return at;
    };
    const L = walk(i, -1), R = walk(j, 1);
    spans.push({ run: [xs[i], xs[j]], feet: [xs[L], xs[R]], design: [design[L], design[i], design[j], design[R]].map((v) => Math.round(-v)) });
    for (let k = L + 1; k < R; k += 1) {
      const chord = design[L] + (design[R] - design[L]) * (k - L) / (R - L);
      deck[k] = Math.max(deck[k], Math.ceil(-chord - 1e-9));
    }
    i = R;
  }
  isTunnel = deck.map((d, i) => d - ground[i] > tunnelDepth);
  // Merge tunnel runs separated by a short gap (cut-and-cover), so the road doesn't pop out for a few columns.
  for (let i = 0; i < n; i += 1) {
    if (isTunnel[i] || !isTunnel[i - 1]) continue;
    let j = i; while (j < n && !isTunnel[j]) j += 1;
    if (j < n && j - i <= s.mergeGap) for (let k = i; k < j; k += 1) isTunnel[k] = true;
  }
  const columns = [], tunnels = [];
  for (let i = 0; i < n; i += 1) {
    const x = xs[i], D = deck[i], G = ground[i];
    const tunnel = isTunnel[i];
    // A rigid hull on a grade rides on its highest wheel, so the roof clears the highest deck within a hull length.
    let topDeck = D;
    for (let j = Math.max(0, i - s.vehicleLength); j <= Math.min(n - 1, i + s.vehicleLength); j += 1) topDeck = Math.min(topDeck, deck[j]);
    const roof = topDeck - s.clearance - 1;
    const cutTop = tunnel ? roof + 1 : Math.min(G, D);
    const cut = [];
    for (let y = cutTop; y < D; y += 1) {
      const m = world.at(x, y);
      if (m === PARTICLE_EMPTY) continue;
      if (carved(x, y)) return fail('road earthworks would break into a tunnel network', x);
      if (protect(x, y)) return fail('road earthworks would cut the pipeline', x);
      if (m === PARTICLE_WATER) return fail('road earthworks would flood', x);
      if (m === PARTICLE_BARRIER || m === PARTICLE_CONSTRUCTION) return fail('a building is in the way', x);
      cut.push(y);
    }
    // Headroom check for open cuts too: nothing solid may hang over the road within the clearance.
    if (!tunnel) for (let y = D - s.clearance; y < Math.min(G, D); y += 1) {
      const m = world.at(x, y);
      if (m === PARTICLE_BARRIER || m === PARTICLE_CONSTRUCTION || m === PARTICLE_WALL) return fail('no headroom for the road', x);
    }
    const lining = [];
    if (tunnel) for (let k = 0; k < s.lining; k += 1) lining.push(roof - k);
    columns.push({ x, ground: G, deck: D, cut, lining, part: tunnel ? 'tunnel' : D > G ? 'cut' : D < G ? 'fill' : 'grade',
      depth: D - G });
  }
  // Backfill narrow dips (crevices) with the excavated spoil so the deck is solid ground; wider dips stay for bridges.
  for (let i = 0; s.backfill && i < n; i += 1) {
    if (columns[i].deck >= columns[i].ground) continue;
    let j = i; while (j + 1 < n && columns[j + 1].deck < columns[j + 1].ground) j += 1;
    if (j - i + 1 <= s.bridgeSpan) for (let k = i; k <= j; k += 1) {
      const c = columns[k];
      for (let y = c.deck; y < c.ground; y += 1) {
        const m = world.at(c.x, y);
        if (carved(c.x, y) || protect(c.x, y) || (m !== PARTICLE_EMPTY && m !== PARTICLE_DEBRIS)) { c.fill = []; break; }
        (c.fill = c.fill || []).push(y);
      }
    }
    i = j;
  }  for (let i = 0; i < n; i += 1) {
    if (!isTunnel[i] || isTunnel[i - 1]) continue;
    let j = i; while (j + 1 < n && isTunnel[j + 1]) j += 1;
    if (i === 0 || j === n - 1) return fail('a road cannot start or end inside a mountain tunnel', xs[i === 0 ? 0 : j]);
    tunnels.push({ from: xs[i], to: xs[j], length: j - i + 1, maxCover: Math.max(...columns.slice(i, j + 1).map((c) => c.lining[c.lining.length - 1] - c.ground)) });
  }
  // Portal headwalls: a wall facade above each tunnel mouth up to the mountain face.
  const portals = [];
  for (const t of tunnels) for (const x of [t.from, t.to]) {
    const c = columns[Math.abs(x - x0)];
    const outer = x === t.from ? -dir : dir;
    const top0 = c.lining[c.lining.length - 1] - 1;
    for (let y = top0; y >= Math.max(c.ground, top0 - 3); y -= 1) portals.push({ x, y });
    // The optional lintel lip overhangs the mouth by a pixel; tall units (the mech) can snag on it, so it is off by default.
    if (s.portalLip) portals.push({ x: x + outer, y: c.lining[0] });
  }
  return { ok: true, reason: 'planned', from: x0, to: x1, dir, columns, tunnels, portals, spans,
    cut: columns.reduce((t, c) => t + c.cut.length, 0),
    fill: columns.reduce((t, c) => t + (c.fill ? c.fill.length : 0), 0),
    fillNeeded: columns.reduce((t, c) => t + Math.max(0, c.ground - c.deck - (c.fill ? c.fill.length : 0)), 0),
    maxOpenCut: Math.max(0, ...columns.filter((c) => c.part !== 'tunnel').map((c) => c.depth)),
    tunnelDepth };
}

function buildPixelRoadEarthworks(world, plan) {
  if (!plan || !plan.ok) throw new Error('Earthworks plan is not valid');
  const ledger = { cut: 0, lined: 0, portal: 0, filled: 0 };
  for (const c of plan.columns) {
    for (const y of c.cut) {
      const m = world.at(c.x, y);
      if (m === PARTICLE_TERRAIN) ledger.cut += world.excavate(c.x, y, c.x, y);
      else if (m === PARTICLE_DEBRIS) world.clearDebris(c.x, y, c.x, y);
    }
    for (const y of c.fill || []) {
      if (world.at(c.x, y) === PARTICLE_DEBRIS) world.clearDebris(c.x, y, c.x, y);
      if (world.at(c.x, y) === PARTICLE_EMPTY) { world.set(c.x, y, PARTICLE_TERRAIN); ledger.filled += 1; }
    }
    for (const y of c.lining) if (y >= 0 && world.at(c.x, y) !== PARTICLE_WALL && world.placeWall(c.x, y).ok) ledger.lined += 1;
  }
  for (const p of plan.portals) {
    const m = world.at(p.x, p.y);
    if ((m === PARTICLE_EMPTY || m === PARTICLE_TERRAIN) && world.placeWall(p.x, p.y).ok) ledger.portal += 1;
  }
  return ledger;
}

// Grade the route, then lay the road along it. Returns { ok, earthworks, road, ledger } or a failure.
function planPixelGradedRoad(world, roads, spec, options = {}) {
  const earthworks = planPixelRoadEarthworks(world, spec.from, spec.to, options);
  if (!earthworks.ok) return { ok: false, stage: 'earthworks', reason: earthworks.reason, at: earthworks.at, earthworks };
  const ledger = buildPixelRoadEarthworks(world, earthworks);
  const road = roads.plan(spec);
  if (!road.ok) return { ok: false, stage: 'road', reason: road.reason, at: road.at, earthworks, ledger };
  return { ok: true, earthworks, ledger, road };
}
