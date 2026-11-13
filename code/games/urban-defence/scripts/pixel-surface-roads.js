// Surface roads for the pixel world. A road is a graded deck one pixel thick that follows the ground
// between two columns: bumps are cut, dips are filled with terrain, deep gaps and water get a wall-pixel
// bridge with pillars, and ground-level tunnel passes are followed along their floor. Building pads,
// tunnel floors, road joins and the two ends are pinned; between pins the grade never exceeds `grade`
// pixels of rise per column. Roads are built column by column, repair themselves after damage, and give
// allied ground units a speed bonus.
const PIXEL_ROAD_DEFAULTS = Object.freeze({
  grade: 0.5, maxGrade: 1, maxCut: 14, maxFill: 6, headroom: 3, jump: 10, pillarEvery: 6, maxPillar: 24,
  buildTicks: 2, repairDelay: 40, repairTicks: 4, speed: 1.25, snapReach: 5, endReach: 12, endRise: 16, maxHatch: 7,
});
const PIXEL_BRIDGE_STYLES = Object.freeze(['asian', 'gothic', 'modern']);

function createPixelSurfaceRoads(world, options = {}) {
  const settings = { ...PIXEL_ROAD_DEFAULTS, ...options };
  const { width, height } = world;
  const network = options.network || null;
  const buildings = options.buildings || [];
  const protect = options.protect || (() => false);
  const carved = (x, y) => Boolean(network && network.isCarved(x, y));
  // While planning over earthworks, `overlayCells` holds the cells those works would change (index -> material).
  let overlayCells = null;
  const at = (x, y) => (x < 0 || x >= width || y >= height ? PARTICLE_TERRAIN : y < 0 ? PARTICLE_EMPTY
    : overlayCells && overlayCells.has(y * width + x) ? overlayCells.get(y * width + x) : world.at(x, y));
  const solid = (m) => m === PARTICLE_TERRAIN || m === PARTICLE_WALL;
  const roads = [], columnRoad = new Int32Array(width).fill(-1);
  const breaks = new Map(), repairs = [], log = [];
  const ledger = { cut: 0, filled: 0, bridged: 0, repaired: 0, hatched: 0, earthCut: 0, earthFilled: 0, lined: 0 };
  let ticks = 0;

  // Rows a unit could stand on in column x: solid or debris with open air above (tunnel floors included).
  function standings(x) {
    const list = [];
    for (let y = 1; y < height; y += 1) {
      const m = at(x, y);
      if (at(x, y - 1) !== PARTICLE_EMPTY) continue;
      if (solid(m) || m === PARTICLE_DEBRIS) list.push({ y, kind: carved(x, y - 1) ? 'tunnel' : 'ground' });
      else if (m === PARTICLE_WATER) list.push({ y, kind: 'water' });
    }
    return list;
  }
  function nearestStanding(x, y, kinds) {
    let best = null;
    for (const s of standings(x)) {
      if (kinds && !kinds.includes(s.kind)) continue;
      if (!best || Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
    }
    return best;
  }
  const deckOf = (road, x) => road.deck.get(x);
  const endsOf = (road) => [road.columns[0], road.columns[road.columns.length - 1]];

  // An end is open when no other road already joins there, so it can still be extended.
  function openEnds(road) {
    return endsOf(road).filter((end) => !roads.some((other) => other !== road && endsOf(other).some((e) => e.x === end.x && e.deck === end.deck)));
  }

  // Snap a clicked point onto an open road end (strongest), a ground-level tunnel floor, or the ground.
  // Hovering over a road's deck snaps to that road's nearest open end, so any road can be extended.
  function snapPoint(point, snapOptions = {}) {
    const px = Math.max(1, Math.min(width - 2, Math.round(point.x))), py = Math.round(point.y);
    const reach = snapOptions.reach === undefined ? settings.snapReach : snapOptions.reach;
    let best = null;
    for (const road of roads) {
      if (road.id === snapOptions.exclude) continue;
      const ends = openEnds(road);
      for (const end of ends) {
        const d = Math.abs(end.x - px) + Math.abs(end.deck - py) * 0.5;
        if (Math.abs(end.x - px) <= settings.endReach && Math.abs(end.deck - py) <= settings.endRise && (!best || d < best.d)) {
          best = { type: 'road', x: end.x, y: end.deck, road: road.id, d, end: end.x === road.columns[0].x ? 'start' : 'end' };
        }
      }
      const deck = road.deck.get(px);
      if (!best && deck !== undefined && Math.abs(deck - py) <= settings.endRise && ends.length) {
        const end = ends.reduce((a, b) => (Math.abs(a.x - px) <= Math.abs(b.x - px) ? a : b));
        best = { type: 'road', x: end.x, y: end.deck, road: road.id, d: Infinity, end: end.x === road.columns[0].x ? 'start' : 'end', fromDeck: true };
      }
    }
    if (best) return best;
    for (let d = 0; d <= reach && !best; d += 1) {
      for (const x of d ? [px - d, px + d] : [px]) {
        if (x < 1 || x >= width - 1) continue;
        const s = nearestStanding(x, py, ['tunnel']);
        if (s && Math.abs(s.y - py) <= 6) { best = { type: 'tunnel', x, y: s.y }; break; }
      }
    }
    if (best) return best;
    // Plain ground: this column, else the nearest dry column within reach (e.g. when the mouse is over a puddle).
    for (let d = 0; d <= reach; d += 1) {
      for (const x of d ? [px - d, px + d] : [px]) {
        if (x < 1 || x >= width - 1) continue;
        const ground = nearestStanding(x, py, ['ground']);
        if (ground && (d === 0 || Math.abs(ground.y - py) <= 12)) return { type: 'ground', x, y: ground.y };
      }
    }
    return { type: 'none', x: px, y: py };
  }

  // Cells an earthworks plan (pixel-road-earthworks.js) would change, mirroring buildPixelRoadEarthworks.
  function earthworksOverlay(works) {
    const cells = new Map(), counts = { cut: 0, filled: 0, walls: 0 };
    const real = (x, y) => (cells.has(y * width + x) ? cells.get(y * width + x) : world.at(x, y));
    for (const c of works.columns) {
      for (const y of c.cut) {
        const m = real(c.x, y);
        if (m === PARTICLE_TERRAIN || m === PARTICLE_DEBRIS) { cells.set(y * width + c.x, PARTICLE_EMPTY); counts.cut += 1; }
      }
      for (const y of c.fill || []) {
        const m = real(c.x, y);
        if (m === PARTICLE_EMPTY || m === PARTICLE_DEBRIS) { cells.set(y * width + c.x, PARTICLE_TERRAIN); counts.filled += 1; }
      }
      for (const y of c.lining) {
        const m = y >= 0 ? real(c.x, y) : null;
        if (m === PARTICLE_EMPTY || m === PARTICLE_TERRAIN) { cells.set(y * width + c.x, PARTICLE_WALL); counts.walls += 1; }
      }
    }
    for (const p of works.portals) {
      const m = real(p.x, p.y);
      if (m === PARTICLE_EMPTY || m === PARTICLE_TERRAIN) { cells.set(p.y * width + p.x, PARTICLE_WALL); counts.walls += 1; }
    }
    return { cells, counts };
  }
  const earthworkReasons = /needs earthworks|too deep|too steep: ramp/;
  // Returns { ok, reason, columns, cost, ... }; dryRun validates without reserving columns.
  // A route the plain planner can't grade (cliffs, crevices, mountains, bridges up a flank) is graded first:
  // the road is planned over the earthworks (cut, backfill, lined mountain tunnels), which are then dug
  // column by column as the road is built.
  function plan(spec, planOptions = {}) {
    if (spec.noEarthworks || typeof planPixelRoadEarthworks !== 'function') return planRoute(spec, planOptions);
    const direct = planRoute(spec, { ...planOptions, dryRun: true });
    const needed = direct.ok ? direct.gaps > 0 : earthworkReasons.test(direct.reason);
    if (!needed) return planOptions.dryRun ? direct : planRoute(spec, planOptions);
    const works = planPixelRoadEarthworks(world, spec.from, spec.to, { network, protect });
    let result = null;
    if (works.ok) {
      const overlay = earthworksOverlay(works);
      const first = works.columns[0], last = works.columns[works.columns.length - 1];
      overlayCells = overlay.cells;
      try {
        result = planRoute({ ...spec, noPortal: true, from: { x: first.x, y: first.deck }, to: { x: last.x, y: last.deck } },
          planOptions, { works, counts: overlay.counts });
      } finally { overlayCells = null; }
      if (result.ok) return result;
    }
    if (direct.ok) return planOptions.dryRun ? direct : planRoute(spec, planOptions);
    return { ...direct, earthworks: works, reason: works.ok ? result.reason : `${direct.reason} (earthworks: ${works.reason})` };
  }
  function planRoute(spec, planOptions = {}, earthworks = null) {
    // A road ending beside a shaft mouth stops at the top of a portal ramp (pixel-road-tunnel-seam.js) instead.
    let portal = null;
    if (network && network.surface && typeof findPixelShaftMouths === 'function' && !spec.noPortal) {
      const mouths = findPixelShaftMouths(world, network);
      for (const key of ['to', 'from']) {
        const end = spec[key], other = spec[key === 'to' ? 'from' : 'to'];
        const mouth = mouths.find((m) => Math.round(end.x) >= m.left - 6 && Math.round(end.x) <= m.right + 6);
        if (!mouth) continue;
        const side = Math.sign(Math.round(other.x) - mouth.x);
        const attempt = side ? planPixelRoadPortal(world, network, mouth, side, { protect }) : null;
        if (!attempt || !attempt.ok) continue;
        portal = { ...attempt, end: key };
        spec = { ...spec, [key]: { x: attempt.roadEnd.x, y: attempt.roadEnd.y } };
        break;
      }
    }
    const owner = spec.owner || 'neutral';
    const x0 = Math.round(spec.from.x), x1 = Math.round(spec.to.x);
    const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
    if (x0 < 1 || x1 < 1 || x0 >= width - 1 || x1 >= width - 1) return fail('road leaves the world');
    if (Math.abs(x1 - x0) < 3) return fail('road is too short');
    const dir = x1 > x0 ? 1 : -1, n = Math.abs(x1 - x0) + 1, xs = [];
    for (let i = 0; i < n; i += 1) xs.push(x0 + dir * i);
    // Reference line: follow the standing surface nearest the previous column (keeps to one level,
    // so a road at ground level enters a tunnel pass instead of climbing the mountain above it).
    const ref = new Float64Array(n), kind = [];
    let prev = Number.isFinite(spec.from.y) ? spec.from.y : world.surfaceRow(x0);
    for (let i = 0; i < n; i += 1) {
      // An open tunnel mouth at road level (a surface shaft): bridge it with a hatch instead of diving in.
      const py = Math.round(prev);
      if (i > 0 && carved(xs[i], py) && at(xs[i], py) === PARTICLE_EMPTY) { kind.push('hatch'); ref[i] = prev; continue; }
      const s = nearestStanding(xs[i], prev);
      if (s && Math.abs(s.y - prev) <= settings.jump) {
        kind.push(s.kind); ref[i] = s.kind === 'water' ? s.y - 2 : s.y;
        if (s.kind !== 'water') prev = s.y;
      } else { kind.push('gap'); ref[i] = prev; }
    }
    const endKinds = ['water', 'gap', 'hatch'];
    if (endKinds.includes(kind[0]) || endKinds.includes(kind[n - 1])) {
      if (kind[0] === 'gap' || kind[n - 1] === 'gap') return fail('too steep - the route needs earthworks');
      return fail('roads must start and end on solid ground');
    }
    for (let i = 0, run = 0; i < n; i += 1) {
      run = kind[i] === 'hatch' ? run + 1 : 0;
      if (run > settings.maxHatch) return fail('tunnel opening is too wide to cover with a hatch', { at: xs[i] });
    }
    const pins = [], uppers = [];
    const pin = (i, y, why) => pins.push({ i, y: Math.round(y), why });
    const joinAt = (x) => { const id = columnRoad[x]; return id >= 0 ? roads[id] : null; };
    for (const [i, x] of [[0, x0], [n - 1, x1]]) {
      const joined = joinAt(x);
      if (joined) {
        const end = endsOf(joined).find((c) => c.x === x);
        if (!end) return fail('roads can only join at a road end');
        pin(i, end.deck, 'road join');
      } else pin(i, i === 0 && Number.isFinite(spec.from.y) && kind[0] !== 'gap' ? ref[0] : ref[i], 'road end');
    }
    for (let i = 0; i < n; i += 1) {
      const x = xs[i];
      if (kind[i] === 'tunnel') pin(i, ref[i], 'tunnel floor');
      if (kind[i] === 'hatch') pin(i, ref[i], 'tunnel hatch');
      if (kind[i] === 'water') uppers.push({ i, y: ref[i] });
      for (const b of buildings) if (x >= b.left && x <= b.right && kind[i] === 'ground' && Math.abs(ref[i] - b.ground) <= settings.jump) pin(i, b.ground, `${b.id || 'building'} pad`);
      // Never cut into protected cells (pipeline tubes): the deck may sit on them, not below them.
      for (let y = Math.round(ref[i]) - 2; y <= Math.round(ref[i]) + settings.maxCut; y += 1) {
        if (y >= 0 && y < height && protect(x, y)) { uppers.push({ i, y }); break; }
      }
    }
    // Grade the deck: prefer the gentle grade, steepen ramps (up to maxGrade) only if the pins demand it.
    function grade(g) {
      const f = Float64Array.from(ref), k = Float64Array.from(ref);
      for (let i = 1; i < n; i += 1) { f[i] = Math.min(f[i], f[i - 1] + g); k[i] = Math.max(k[i], k[i - 1] - g); }
      for (let i = n - 2; i >= 0; i -= 1) { f[i] = Math.min(f[i], f[i + 1] + g); k[i] = Math.max(k[i], k[i + 1] - g); }
      const out = new Int32Array(n);
      for (let i = 0; i < n; i += 1) {
        let lo = -Infinity, hi = Infinity, loWhy = null, hiWhy = null;
        for (const p of pins) {
          const reach = g * Math.abs(i - p.i);
          if (p.y - reach > lo) { lo = p.y - reach; loWhy = p; }
          if (p.y + reach < hi) { hi = p.y + reach; hiWhy = p; }
        }
        for (const u of uppers) if (u.y + g * Math.abs(i - u.i) < hi) { hi = u.y + g * Math.abs(i - u.i); hiWhy = { why: 'clearance' }; }
        if (lo > hi + 1e-9) {
          const why = [loWhy, hiWhy].find((p) => p && p.why !== 'road end') || loWhy;
          return { at: xs[i], reason: why && why.why === 'clearance' ? 'too steep to clear the water or pipeline here'
            : `too steep: ramp would exceed 1:${Math.max(1, Math.round(1 / g))} near the ${why ? why.why : 'pinned points'}` };
        }
        out[i] = Math.round(Math.max(lo, Math.min(hi, (f[i] + k[i]) / 2)));
      }
      return { deck: out, grade: g };
    }
    let graded = null;
    for (let g = settings.grade; g <= settings.maxGrade + 1e-9; g += 0.25) {
      graded = grade(g);
      if (graded.deck) break;
    }
    if (!graded.deck) return fail(graded.reason, { at: graded.at });
    const deck = graded.deck;
    // Per-column work: cut above the deck, then fill or bridge below it.
    const columns = [];
    let cost = 0;
    for (let i = 0; i < n; i += 1) {
      const x = xs[i], D = deck[i];
      const failAt = (reason) => fail(reason, { at: x, deck: Array.from(deck), xs });
      if (D < settings.headroom + 1 || D >= height - 2) return failAt('road leaves the world');
      if (columnRoad[x] >= 0) {
        const other = roads[columnRoad[x]];
        if (!((i === 0 || i === n - 1) && deckOf(other, x) === D)) return failAt('road crosses another road');
      }
      const m = at(x, D);
      if (m === PARTICLE_WATER) return failAt('road would sit in water');
      if (m === PARTICLE_BARRIER || m === PARTICLE_CONSTRUCTION) return failAt('a building is in the way');
      for (let h = 1; h <= settings.headroom; h += 1) {
        const above = at(x, D - h);
        if (above === PARTICLE_WATER) return failAt('road would run under water');
        if (above === PARTICLE_WALL || above === PARTICLE_BARRIER || above === PARTICLE_CONSTRUCTION) {
          return failAt('no headroom under a tunnel roof or structure');
        }
      }
      const cut = [];
      for (let y = D - 1; y >= 0 && (at(x, y) === PARTICLE_TERRAIN || at(x, y) === PARTICLE_DEBRIS); y -= 1) {
        if (protect(x, y)) return failAt('road would cut the pipeline');
        cut.push(y);
      }
      if (cut.length > settings.maxCut) return failAt(`cut of ${cut.length}px is too deep - the route needs earthworks or a tunnel pass`);
      const fill = [], pillar = [];
      let bridge = false, hatch = false;
      if (kind[i] === 'hatch' && m === PARTICLE_EMPTY && carved(x, D)) {
        // Hatch over a tunnel mouth: a solid deck pixel walkers cross; climbers use the manhole on the ladder.
        hatch = true;
      } else if (m === PARTICLE_EMPTY || m === PARTICLE_DEBRIS) {
        if (carved(x, D)) return failAt('road would cover a tunnel entrance');
        let depth = 0;
        while (D + depth < height && at(x, D + depth) === PARTICLE_EMPTY && !carved(x, D + depth)) depth += 1;
        if (D + depth < height && carved(x, D + depth)) return failAt('road would cover a tunnel entrance');
        const support = at(x, D + depth);
        if (m === PARTICLE_DEBRIS || (depth <= settings.maxFill && support !== PARTICLE_WATER)) {
          for (let y = D; y < D + Math.max(1, depth); y += 1) fill.push(y);
        } else {
          bridge = true;
          if (i % settings.pillarEvery === 0 && solid(support) && depth <= settings.maxPillar) {
            for (let y = D + 1; y < D + depth; y += 1) pillar.push(y);
          }
        }
      }
      const manhole = hatch && network && (network.isLadder(x, D) || network.isLadder(x, D + 1));
      cost += cut.length + fill.length + (bridge ? 2 : 0) + pillar.length + (hatch ? 3 : 0);
      columns.push({ x, deck: D, cut, fill, bridge, pillar, kind: kind[i], hatch, manhole: Boolean(manhole) });
    }
    const portalCost = portal ? portal.columns.reduce((s, c) => s + c.cut.length + c.fill.length + 1, 0) +
      portal.wall.length + portal.lid.length + portal.rail.length : 0;
    cost += portalCost;
    const works = earthworks ? earthworks.works : null;
    if (earthworks) cost += earthworks.counts.cut + earthworks.counts.filled + earthworks.counts.walls;
    const summary = { ok: true, reason: 'valid', columns, cost, owner, dir, grade: graded.grade,
      bridges: columns.filter((c) => c.bridge).length, cut: columns.reduce((s, c) => s + c.cut.length, 0),
      filled: columns.reduce((s, c) => s + c.fill.length, 0),
      hatches: columns.filter((c) => c.hatch).length,
      tunnel: columns.filter((c) => c.kind === 'tunnel').length, portal,
      gaps: kind.filter((k) => k === 'gap').length, earthworks: works,
      earthworksCost: earthworks ? { ...earthworks.counts, tunnels: works.tunnels.length } : null };
    if (planOptions.dryRun) return summary;
    const road = { id: roads.length, owner, label: spec.label || `road ${roads.length}`, columns, dir,
      style: PIXEL_BRIDGE_STYLES.includes(spec.style) ? spec.style : (settings.styleOf && settings.styleOf(owner)) || 'modern',
      left: Math.min(x0, x1), right: Math.max(x0, x1), deck: new Map(columns.map((c) => [c.x, c.deck])),
      built: 0, phase: 'building', state: 'queued', cost, grade: graded.grade, tick: 0, portal, portalLedger: null,
      earthworks: works, earthworksAt: works ? earthworksByColumn(works) : null };
    roads.push(road);
    bridgeDecor(road);
    for (const c of columns) if (columnRoad[c.x] < 0) columnRoad[c.x] = road.id;
    return { ...summary, reason: 'planned', road };
  }

  // UI helper: snap both ends, then plan (dry run). A full-map plan costs ~9 ms, so drag previews
  // reuse the last result while the snapped ends, options and world are unchanged.
  let routeMemo = null;
  function routeRoad(start, target, extra = {}) {
    const a = snapPoint(start), b = snapPoint(target, { exclude: a.type === 'road' ? a.road : undefined });
    if (a.type === 'none') return { ok: false, reason: 'start on solid ground', from: a, to: b };
    if (b.type === 'none') return { ok: false, reason: 'end on solid ground', from: a, to: b };
    const spec = { ...extra, from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } };
    const key = [a.x, a.y, b.x, b.y, world.terrainRevision, world.barrierCount, world.waterCount, roads.length,
      network ? network.segments.length : 0, JSON.stringify(extra)].join('|');
    if (routeMemo && routeMemo.key === key) return routeMemo.result;
    const result = { ...plan(spec, { dryRun: true }), spec, from: a, to: b };
    routeMemo = { key, result };
    return result;
  }

  function earthworksByColumn(works) {
    const byX = new Map(works.columns.map((c) => [c.x, { column: c, portals: [], done: false }]));
    for (const p of works.portals) if (byX.has(p.x)) byX.get(p.x).portals.push(p);
    return byX;
  }
  // Dig this column's share of the road's earthworks (cut, backfill, tunnel lining, portal headwall) once.
  function digEarthworks(road, x) {
    const entry = road.earthworksAt && road.earthworksAt.get(x);
    if (!entry || entry.done) return;
    entry.done = true;
    const part = buildPixelRoadEarthworks(world, { ok: true, columns: [entry.column], portals: entry.portals });
    ledger.earthCut += part.cut; ledger.earthFilled += part.filled; ledger.lined += part.lined + part.portal;
  }
  function buildColumn(road, c) {
    const { x, deck: D } = c;
    for (let h = 0; h <= settings.headroom; h += 1) {
      const m = at(x, D - h);
      if (m === PARTICLE_BARRIER || m === PARTICLE_CONSTRUCTION) return 'blocked: structure on the road';
    }
    digEarthworks(road, x);
    if (at(x, D) === PARTICLE_WATER) return 'blocked: flooded';
    for (const y of c.cut) {
      const m = at(x, y);
      if (m === PARTICLE_TERRAIN) ledger.cut += world.excavate(x, y, x, y);
      else if (m === PARTICLE_DEBRIS) world.clearDebris(x, y, x, y);
    }
    if (at(x, D) === PARTICLE_DEBRIS) world.clearDebris(x, D, x, D);
    if (c.hatch) {
      if (at(x, D) === PARTICLE_EMPTY && world.placeWall(x, D).ok) ledger.hatched += 1;
      // Rungs no longer stand up into the roadway; the ladder now ends at the manhole lid.
      for (let y = D - 1; y >= 0 && network.isCarved(x, y); y -= 1) network.removeLadder(x, y);
    } else if (c.bridge) {
      if (at(x, D) === PARTICLE_EMPTY && world.placeWall(x, D).ok) ledger.bridged += 1;
      for (const y of c.pillar) if (at(x, y) === PARTICLE_EMPTY) world.placeWall(x, y);
    } else {
      for (const y of c.fill) {
        if (at(x, y) === PARTICLE_DEBRIS) world.clearDebris(x, y, x, y);
        if (at(x, y) === PARTICLE_EMPTY && !carved(x, y)) { world.set(x, y, PARTICLE_TERRAIN); ledger.filled += 1; }
      }
    }
    return null;
  }
  // The portal is dug once the road reaching it is paved, so the ramp never opens onto an unfinished road.
  function finishPortal(road) {
    if (road.portal && !road.portalLedger) road.portalLedger = buildPixelRoadPortal(world, network, road.portal);
  }
  function buildNow(road) {
    while (road.built < road.columns.length) {
      const blocked = buildColumn(road, road.columns[road.built]);
      if (blocked) { road.state = blocked; return false; }
      road.built += 1;
    }
    finishPortal(road);
    road.phase = 'complete'; road.state = 'complete';
    return true;
  }
  function intactColumn(c) {
    return solid(at(c.x, c.deck)) && at(c.x, c.deck - 1) !== PARTICLE_DEBRIS;
  }
  function repairColumn(c) {
    const { x, deck: D } = c;
    if (c.hatch) {
      world.clearDebris(x, Math.max(0, D - settings.headroom), x, D);
      if (at(x, D) === PARTICLE_EMPTY) world.placeWall(x, D);
      return solid(at(x, D)) ? null : 'hatch frame blocked';
    }
    if (carved(x, D)) return 'cut by a tunnel';
    for (let h = 0; h <= settings.headroom; h += 1) {
      const m = at(x, D - h);
      if (m === PARTICLE_WATER) return 'flooded - waiting for water to clear';
      if (m === PARTICLE_BARRIER || m === PARTICLE_CONSTRUCTION) return 'blocked by a structure';
    }
    world.clearDebris(x, Math.max(0, D - settings.headroom), x, D);
    if (solid(at(x, D))) return null;
    let depth = 0;
    while (D + depth < height && at(x, D + depth) === PARTICLE_EMPTY && !carved(x, D + depth)) depth += 1;
    if (!c.bridge && depth <= settings.maxFill && at(x, D + depth) !== PARTICLE_WATER && !carved(x, D + depth)) {
      for (let y = D; y < D + depth; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    } else world.placeWall(x, D);
    return null;
  }
  function step() {
    ticks += 1;
    for (const road of roads) {
      if (road.phase !== 'building' || ticks % settings.buildTicks) continue;
      const c = road.columns[road.built];
      const blocked = buildColumn(road, c);
      if (blocked) { road.state = blocked; continue; }
      road.built += 1; road.state = 'paving';
      if (road.built === road.columns.length) {
        finishPortal(road);
        road.phase = 'complete'; road.state = 'complete';
        log.push({ tick: ticks, text: `${road.label} complete (${road.columns.length} px, ${road.cost} HM)` });
      }
    }
    if (ticks % settings.repairTicks) return;
    for (const road of roads) {
      const done = road.phase === 'complete' ? road.columns.length : road.built;
      let repaired = false;
      for (let i = 0; i < done; i += 1) {
        const c = road.columns[i];
        if (intactColumn(c)) { breaks.delete(c.x); continue; }
        if (!breaks.has(c.x)) { breaks.set(c.x, { x: c.x, y: c.deck, road: road.id, since: ticks, state: 'damaged' }); continue; }
        const entry = breaks.get(c.x);
        if (repaired || ticks - entry.since < settings.repairDelay) continue;
        const blocked = repairColumn(c);
        entry.state = blocked || 'repaired';
        if (!blocked) {
          breaks.delete(c.x); repaired = true; ledger.repaired += 1;
          repairs.push({ x: c.x, y: c.deck, tick: ticks });
        }
      }
    }
    while (repairs.length && ticks - repairs[0].tick > 30) repairs.shift();
  }
  // Speed multiplier for a ground unit standing on row `standRow` across columns left..right.
  function multiplier(left, right, standRow, owner) {
    for (let x = left; x <= right; x += 1) {
      const id = x >= 0 && x < width ? columnRoad[x] : -1;
      if (id < 0) return 1;
      const road = roads[id], c = road.columns[Math.abs(x - road.columns[0].x)];
      const built = road.phase === 'complete' || Math.abs(x - road.columns[0].x) < road.built;
      if (!c || !built || road.owner !== owner || c.deck !== standRow || !intactColumn(c)) return 1;
    }
    return settings.speed;
  }
  function roadAt(x) {
    const id = x >= 0 && x < width ? columnRoad[x] : -1;
    if (id < 0) return null;
    const road = roads[id];
    return { road, column: road.columns[Math.abs(x - road.columns[0].x)] };
  }
  // 0..1: how built-up the land around column x is (population counts most, farms least).
  const URBAN_WEIGHT = { population: 1, military: 0.7, farm: 0.15 };
  function urbanity(x) {
    let score = 0;
    for (const b of buildings) {
      const d = x < b.left ? b.left - x : x > b.right ? x - b.right : 0;
      score += (URBAN_WEIGHT[b.kind] === undefined ? 0.5 : URBAN_WEIGHT[b.kind]) * Math.max(0, 1 - d / 40);
    }
    return Math.min(1, score);
  }
  const markingAt = (x) => (urbanity(x) >= 0.5 ? 'white' : 'yellow');

  // ---------- Styled bridge superstructure (visual decor; only the deck and land pillars are real wall pixels) ----------
  // Returns [{x, y, part}] for every bridge span of `road`, in its style. Cells only ever occupy open air or water.
  function bridgeSpans(road) {
    const sorted = [...road.columns].sort((p, q) => p.x - q.x), spans = [];
    for (const c of sorted) {
      const last = spans[spans.length - 1];
      if (!c.bridge) continue;
      if (last && last.b === c.x - 1) { last.b = c.x; last.cols.push(c); } else spans.push({ a: c.x, b: c.x, cols: [c] });
    }
    return spans;
  }
  function bridgeDecor(road) {
    if (road.decor) return road.decor;
    const cells = new Map(), reserved = new Set();
    for (const c of road.columns) { reserved.add(c.deck * width + c.x); for (const y of c.pillar) reserved.add(y * width + c.x); }
    const deckAt = (x) => (road.deck.has(x) ? road.deck.get(x) : null);
    const add = (x, y, part) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= width || y >= height || reserved.has(y * width + x)) return;
      const m = at(x, y);
      if ((m !== PARTICLE_EMPTY && m !== PARTICLE_WATER) || carved(x, y)) return;
      cells.set(y * width + x, { x, y, part });
    };
    const bedBelow = (x, D) => { let y = D + 1; while (y < height && !solid(at(x, y))) y += 1; return y; };
    for (const span of bridgeSpans(road)) {
      const { a, b } = span, L = b - a + 1;
      const D = Math.min(...span.cols.map((c) => c.deck));
      // Above-deck parts hang off the highest deck row; below-deck parts follow each column's own deck.
      const low = Math.max(...span.cols.map((c) => c.deck));
      const dk = (x) => (deckAt(x) === null ? low : deckAt(x));
      const depthAt = (x) => bedBelow(x, deckAt(x) === null ? D : deckAt(x)) - D - 1;
      const minDepth = Math.min(...span.cols.map((c) => depthAt(c.x)));
      if (road.style === 'modern') {
        // Tied through-arch with hanger cables, slim girder and Y piers (reference: white arch bridge).
        for (let x = a; x <= b; x += 1) add(x, dk(x) + 1, 'girder');
        const count = Math.max(0, Math.round(L / 12) - 1);
        for (let k = 1; k <= count; k += 1) {
          const p = a + Math.round(k * L / (count + 1));
          for (let y = dk(p) + 2; y < bedBelow(p, dk(p)); y += 1) add(p, y, 'pier');
          add(p - 1, dk(p) + 2, 'cap'); add(p + 1, dk(p) + 2, 'cap'); add(p - 1, dk(p) + 3, 'pier'); add(p + 1, dk(p) + 3, 'pier');
        }
        const H = Math.max(5, Math.min(16, Math.round(L / 4)));
        const archY = (x) => D - 1 - Math.round(H * Math.sin(Math.PI * (x - a + 0.5) / L));
        for (let x = a - 1; x <= b + 1; x += 1) {
          const y0 = x < a || x > b ? D - 1 : archY(x), y1 = x + 1 > b ? D - 1 : archY(Math.min(b, x + 1));
          for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) add(x, y, 'arch');
          if (x >= a && x <= b && (x - a) % 3 === 1) for (let y = y0 + 1; y <= D - 2; y += 1) add(x, y, 'cable');
        }
      } else if (road.style === 'gothic') {
        // Stone viaduct: masonry arches between thick piers, balustrade with finials, spired towers and an arcade.
        const arches = Math.max(1, Math.round(L / 14)), piers = [];
        for (let k = 1; k < arches; k += 1) piers.push(a + Math.round(k * L / arches));
        const edges = [a - 1, ...piers, b + 1];
        for (const p of piers) for (let x = p - 1; x <= p + 1; x += 1) for (let y = dk(x) + 1; y < bedBelow(x, dk(x)); y += 1) add(x, y, 'pier');
        for (let k = 0; k < edges.length - 1; k += 1) {
          const le = edges[k] + (k ? 2 : 1), re = edges[k + 1] - (k + 1 < edges.length - 1 ? 2 : 1), w = re - le + 1;
          const r = Math.max(1, Math.min(Math.floor(w / 2), minDepth - 3)), c = (le + re) / 2, spring = low + 3 + r;
          for (let x = le; x <= re; x += 1) {
            const u = (x - c) / (w / 2), top = spring - Math.round(r * Math.sqrt(Math.max(0, 1 - u * u)));
            for (let y = dk(x) + 1; y < top; y += 1) add(x, y, y === top - 1 ? 'voussoir' : 'stone');
            if (Math.abs(x - c) < 0.6) add(x, top - 1, 'keystone');
          }
        }
        for (let x = a - 2; x <= b + 2; x += 1) {
          if (x % 2 === 0) { add(x, D - 2, 'baluster'); add(x, D - 3, 'baluster'); }
          add(x, D - 4, 'balRail');
        }
        const towers = L >= 16 ? [a + 2, b - 2] : [];
        if (!towers.length) for (const p of piers) { add(p, D - 5, 'finial'); add(p, D - 6, 'finial'); }
        for (const t of towers) {
          for (let y = D - 2; y >= D - 12; y -= 1) for (let x = t - 2; x <= t + 2; x += 1) {
            const lancet = Math.abs(x - t) <= 1 && y <= D - 5 && y >= D - 9 && !(y === D - 9 && x !== t);
            add(x, y, lancet ? 'tracery' : Math.abs(x - t) === 2 ? 'buttress' : 'tower');
          }
          for (let h = 1; h <= 6; h += 1) add(t, D - 12 - h, 'spire');
          add(t - 1, D - 13, 'spire'); add(t + 1, D - 13, 'spire'); add(t - 2, D - 13, 'finial'); add(t + 2, D - 13, 'finial');
        }
        if (towers.length && towers[1] - towers[0] > 8) {
          for (let x = towers[0] + 3; x <= towers[1] - 3; x += 1) {
            const k = (x - towers[0] - 3) % 4;
            add(x, D - 11, 'cornice'); add(x, D - 12, (x % 2) ? 'roof' : 'cornice');
            if (k === 0) for (let y = D - 5; y >= D - 10; y -= 1) add(x, y, 'stone');
            else add(x, k === 2 ? D - 10 : D - 9, 'tracery');
          }
        }
      } else {
        const red = 'redTimber';
        if (L < 22) {
          // Moon bridge: a single high red arch with a stone spandrel (reference: arched river bridge).
          const r = Math.max(2, minDepth - 1);
          for (let x = a; x <= b; x += 1) {
            const top = low + 2 + Math.round(r * (1 - Math.sin(Math.PI * (x - a + 0.5) / L)));
            for (let y = dk(x) + 1; y < top; y += 1) add(x, y, 'stone');
            add(x, top, 'archRed');
            if (x % 3 === 0) { add(x, D - 2, red); add(x, D - 3, red); }
            add(x, D - 4, 'lattice');
          }
          for (const t of [a - 2, b + 2]) {
            for (let y = D - 1; y >= D - 6; y -= 1) { add(t - 2, y, red); add(t + 2, y, red); }
            for (let x = t - 4; x <= t + 4; x += 1) add(x, D - 7, 'eave');
            add(t - 5, D - 8, 'eave'); add(t + 5, D - 8, 'eave');
            for (let x = t - 3; x <= t + 3; x += 1) add(x, D - 8, 'roof');
            for (let x = t - 1; x <= t + 1; x += 1) add(x, D - 9, 'ridge');
            add(t, D - 10, 'finial');
          }
        } else {
          // Covered "wind and rain" gallery bridge on stone piers with stepped timber brackets and pagodas.
          for (let x = a; x <= b; x += 1) add(x, dk(x) + 1, red);
          for (let p = a + 5; p <= b - 5; p += 10) {
            for (let x = p - 1; x <= p + 1; x += 1) for (let y = dk(x) + 3; y < bedBelow(x, dk(x)); y += 1) add(x, y, 'pier');
            for (let x = p - 3; x <= p + 3; x += 1) add(x, dk(x) + 2, 'bracket');
          }
          for (let x = a; x <= b; x += 1) {
            if ((x - a) % 3 === 0) for (let y = D - 2; y >= D - 5; y -= 1) add(x, y, red);
            else add(x, D - 2, (x % 2) ? 'lattice' : red);
          }
          for (let x = a - 2; x <= b + 2; x += 1) add(x, D - 6, x === a - 2 || x === b + 2 ? 'eave' : 'roof');
          add(a - 3, D - 7, 'eave'); add(b + 3, D - 7, 'eave');
          for (let x = a; x <= b; x += 1) add(x, D - 7, x % 2 ? 'roof' : 'tile');
          for (let x = a + 1; x <= b - 1; x += 1) add(x, D - 8, 'ridge');
          const pagoda = (c, tiers) => {
            let y = D - 9, half = tiers === 2 ? 4 : 3;
            for (let tier = 0; tier < tiers; tier += 1) {
              for (let h = 0; h < 3; h += 1) { add(c - half + 1, y - h, red); add(c + half - 1, y - h, red); for (let x = c - half + 2; x <= c + half - 2; x += 1) add(x, y - h, 'lattice'); }
              y -= 3;
              for (let x = c - half - 1; x <= c + half + 1; x += 1) add(x, y, 'roof');
              add(c - half - 2, y - 1, 'eave'); add(c + half + 2, y - 1, 'eave');
              for (let x = c - half; x <= c + half; x += 1) add(x, y - 1, 'tile');
              y -= 2; half -= 1;
            }
            add(c, y, 'finial'); add(c, y - 1, 'finial');
          };
          pagoda(Math.round((a + b) / 2), 2);
          if (L >= 40) { pagoda(a + 4, 1); pagoda(b - 4, 1); }
        }
      }
    }
    road.decor = [...cells.values()];
    return road.decor;
  }
  return {
    settings, roads, breaks, repairs, log, ledger, urbanity, markingAt, bridgeSpans, bridgeDecor,
    get ticks() { return ticks; },
    standings, snapPoint, plan, routeRoad, buildNow, step, multiplier, roadAt,
    intact(x) { const hit = roadAt(x); return Boolean(hit && intactColumn(hit.column)); },
    // Hatch over a tunnel mouth at (x, y): walkers treat it as solid deck; `manhole` marks the ladder lid climbers pass.
    hatchAt(x, y) {
      for (const road of roads) {
        const c = road.deck.get(x) === y ? road.columns[Math.abs(x - road.columns[0].x)] : null;
        if (c && c.hatch) return { road: road.id, x, y, manhole: c.manhole };
      }
      return null;
    },
    inspect() {
      return roads.map((road) => ({ id: road.id, label: road.label, owner: road.owner, left: road.left, right: road.right,
        progress: `${road.built}/${road.columns.length}`, state: road.state, cost: road.cost,
        bridges: road.columns.filter((c) => c.bridge).length, hatches: road.columns.filter((c) => c.hatch).length }));
    },
  };
}
