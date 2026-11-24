'use strict';
// Vision (N2, N6, N123). A side sees what its holdings see: circles of sight from the tops of its
// buildings' antennas and of its units' heads (the user's, 2026-11-23: troopers see least, then
// tanks, then mechs, then drones; a military antenna between a mech's and a drone's; a population
// tower's as far as a mech's), cut off only by mountains - a ridge between a sight and the ground
// beyond it hides that ground, nothing else does. Seeds may only be cast into that sight, and the
// match draws the fog of war from it: ground never seen is black, ground seen once but out of sight
// now is grey and shows what it was when last seen; the other side's units show only in sight.
// A side that has hacked a population building of the enemy's sees what the enemy sees for a
// while (N6, the user's): world.visionGrants holds { to, from, until } - until in world ticks.
// The sight is kept on a grid of TILE x TILE cells, column by column (a circle is a run of tiles
// in each column it crosses), worked out afresh every quarter second of world time.
(function () {
  const PW = window.PW;

  // Sight radius in cells, by holding (troop < tank < mech < military antenna < drone).
  const RANGE = { troop: 300, tank: 380, mech: 470, military: 600, jet: 720, building: 470, farm: 360, core: 260, defence: 520, city: 470 };
  const HEIGHT = { troop: 25, tank: 34, mech: 60, jet: 0, defence: 20 };
  const UNIT_LISTS = [['troops', 'troop'], ['tanks', 'tank'], ['mechs', 'mech'], ['jets', 'jet'], ['defence', 'defence']];
  const TILE = 16;
  const EVERY = 15;   // ticks between workings-out

  const same = (a, b) => (a || null) === (b || null);

  // The grid of a world: column-major tiles; per side `vis` (in sight now) and `seen` (ever).
  function gridOf(world) {
    let g = world.visionGrid;
    if (g && g.world === world) return g;
    const tw = Math.ceil(world.width / TILE), th = Math.ceil(world.height / TILE);
    // (mountain columns: a ridge there may hide what lies beyond it)
    const ridge = new Uint8Array(tw);
    for (const m of (world.layout && world.layout.mountains) || []) {
      for (let t = Math.max(0, Math.floor((m.x - m.half) / TILE)); t <= Math.min(tw - 1, Math.ceil((m.x + m.half) / TILE)); t += 1) ridge[t] = 1;
    }
    g = world.visionGrid = { world, tw, th, ridge, sides: new Map(), chunkVis: new Map() };
    return g;
  }
  function sideOf(g, side) {
    let s = g.sides.get(side);
    if (!s) { s = { vis: new Uint8Array(g.tw * g.th), seen: new Uint8Array(g.tw * g.th), tick: -1e9 }; g.sides.set(side, s); }
    return s;
  }

  // Every source of sight a side holds: [x, y (the eye), radius, blocked-by-ridges]; and whole
  // columns given it (visionExtra: the gameplay test's own third while it chooses its start).
  function sourcesOf(world, side, out, cols) {
    const eng = world.capitalGrowth;
    const seats = new Set();
    for (const b of world.buildings || []) {
      // (a building going up watches from its site as well - a site is 'ruined' by its health alone)
      if (!b || !b.body || (b.ruined && !b.underConstruction) || b.dismantled || b.body.left < 0 || !same(b.faction ?? b.side, side)) continue;
      const kind = b.type === 'military' ? 'military' : b.type === 'farm' ? 'farm' : b.type === 'core' ? 'building' : 'building';
      // (the higher the antenna, the further it sees: its reach over the ground is its range
      // however tall the tower - the circle grows by the eye's height over the ground)
      const eye = b.body.top - 6;
      out.push([(b.body.left + b.body.right) / 2, eye, RANGE[kind] + Math.max(0, (b.ground ?? eye) - eye)]);
      seats.add(b.id);
    }
    // a city watches over all the ground it has claimed and a city's sight past it, its towers
    // risen or not (the antennas of the lots it is laying out)
    if (eng && eng.cities) {
      for (const c of eng.cities) {
        if (!same(c.faction, side) || c.fallen) continue;
        const l = Math.min(c.edge.left, c.capEdge ? c.capEdge.left : c.x), r = Math.max(c.edge.right, c.capEdge ? c.capEdge.right : c.x);
        const mid = Math.round((l + r) / 2);
        out.push([mid, (world.groundTop[mid] || 0) - 20, RANGE.city + Math.max(0, (r - l) / 2)]);
      }
    }
    void seats;
    for (const q of world.seedCores || []) if (same(q.side, side)) out.push([q.x, (q.y ?? world.groundTop[Math.round(q.x)]) - 10, RANGE.core]);
    for (const g of world.visionExtra || []) if (same(g.side, side)) cols.push([g.x0, g.x1]);
    for (const [list, kind] of UNIT_LISTS) {
      const R = RANGE[kind], h = (kind === 'mech' && PW.mechs && PW.mechs.HEIGHT) || HEIGHT[kind] || 0;
      for (const u of world[list] || []) {
        if (!u || u.dead || !same(u.side, side)) continue;
        const g = world.groundTop[Math.max(0, Math.min(world.width - 1, Math.round(u.x)))] || 0;
        const eye = (u.y ?? g) - h - (u.lift || 0);
        out.push([u.x, eye, R + Math.max(0, Math.min(400, g - eye))]);
      }
    }
  }
  // The sides whose sight this side shares just now: its own, and any it has hacked its way into.
  function sharers(world, side) {
    const out = [side];
    for (const g of world.visionGrants || []) if (same(g.to, side) && (world.tick || 0) < g.until && !out.includes(g.from)) out.push(g.from);
    return out;
  }
  // Lay one circle of sight into vis: in each tile column it reaches, the run of tiles inside the
  // circle and above the line over the highest ridge between (a mountain hides what is behind it).
  function lay(world, g, vis, sx, sy, R) {
    const { tw, th, ridge } = g;
    const tx = Math.floor(sx / TILE), ty = sy / TILE, r = R / TILE;
    const reach = Math.ceil(r);
    for (const dir of [1, -1]) {
      let slope = -Infinity;   // (rise per tile across of the highest ridge seen so far, from the eye)
      for (let k = dir > 0 ? 0 : 1; k <= reach; k += 1) {
        const c = tx + dir * k;
        if (c < 0 || c >= tw) break;
        const half = Math.sqrt(Math.max(0, r * r - k * k));
        let top = Math.max(0, Math.floor(ty - half)), bottom = Math.min(th - 1, Math.ceil(ty + half));
        if (k > 0 && slope > -Infinity) bottom = Math.min(bottom, Math.floor(ty - slope * k));
        if (bottom >= top) vis.fill(1, c * th + top, c * th + bottom + 1);
        if (ridge[c] && k > 0) {
          const crest = (ty - world.groundTop[Math.min(world.width - 1, c * TILE + (TILE >> 1))] / TILE) / k;
          if (crest > slope) slope = crest;
        }
      }
    }
  }
  function work(world, side) {
    const g = gridOf(world), s = sideOf(g, side), tick = world.tick || 0;
    // (worked out again at once when a holding is added - a city seeded, a building placed, a
    // stretch given - not a quarter second later: a seed may be cast into new sight straight away)
    const eng = world.capitalGrowth;
    const sig = `${eng && eng.cities ? eng.cities.length : 0}:${(world.buildings || []).length}:${(world.seedCores || []).length}:${(world.visionExtra || []).length}:${(world.visionGrants || []).length}`;
    if (tick - s.tick < EVERY && tick >= s.tick && s.sig === sig) return s;
    s.tick = tick; s.sig = sig;
    s.vis.fill(0);
    const src = [], cols = [];
    for (const who of sharers(world, side)) sourcesOf(world, who, src, cols);
    for (const [x, y, R] of src) lay(world, g, s.vis, x, y, R);
    for (const [a, b] of cols) {
      const c0 = Math.max(0, Math.floor(a / TILE)), c1 = Math.min(g.tw - 1, Math.floor(b / TILE));
      s.vis.fill(1, c0 * g.th, (c1 + 1) * g.th);
    }
    const { vis, seen } = s;
    for (let i = 0; i < vis.length; i += 1) if (vis[i]) seen[i] = 1;
    g.chunkVis.delete(side);
    s.count = src.length;
    return s;
  }

  // In the side's sight now, at (x, y) - y the ground's top there when not given.
  function sees(world, side, x, y) {
    if (side === null || side === undefined) return true;   // a sideless hand is not fogged
    const g = gridOf(world), s = work(world, side);
    const yy = y === undefined ? (world.groundTop[Math.max(0, Math.min(world.width - 1, Math.round(x)))] || 0) - 4 : y;
    const tx = Math.floor(x / TILE), ty = Math.floor(yy / TILE);
    if (tx < 0 || tx >= g.tw) return false;
    return !!s.vis[tx * g.th + Math.max(0, Math.min(g.th - 1, ty))];
  }
  // Seen ever (the grey of the fog), at (x, y).
  function seenAt(world, side, x, y) {
    if (side === null || side === undefined) return true;
    const g = gridOf(world), s = work(world, side);
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || tx >= g.tw || ty < 0 || ty >= g.th) return false;
    return !!s.seen[tx * g.th + ty];
  }
  // The side's sight at the surface as merged spans [x0, x1] - the minimap's fog and the old
  // one-dimensional callers.
  function spans(world, side) {
    const g = gridOf(world), s = work(world, side);
    const out = [];
    for (let c = 0; c < g.tw; c += 1) {
      const gy = world.groundTop[Math.min(world.width - 1, c * TILE + (TILE >> 1))] || 0;
      const ty = Math.max(0, Math.min(g.th - 1, Math.floor((gy - 4) / TILE)));
      if (!s.vis[c * g.th + ty]) continue;
      const a = c * TILE, b = a + TILE - 1, last = out[out.length - 1];
      if (last && last[1] >= a - 1) last[1] = b; else out.push([a, b]);
    }
    return out;
  }
  // Is anything of chunk c (CHUNK cells square) in the side's sight now? The renderer holds a
  // chunk out of sight at the picture it last had (the grey shows what was last seen).
  function chunkInSight(world, side, c) {
    const g = gridOf(world), s = work(world, side);
    let m = g.chunkVis.get(side);
    if (!m) { m = new Map(); g.chunkVis.set(side, m); }
    let v = m.get(c);
    if (v !== undefined) return v;
    const n = PW.CHUNK / TILE, cx = c % world.chunksX, cy = (c / world.chunksX) | 0;
    v = false;
    for (let i = 0; i < n && !v; i += 1) {
      const col = cx * n + i;
      if (col >= g.tw) break;
      for (let j = 0; j < n; j += 1) { const row = cy * n + j; if (row < g.th && s.vis[col * g.th + row]) { v = true; break; } }
    }
    m.set(c, v);
    return v;
  }
  // The fog over a view: per tile column, runs of [state, row0, row1] - 0 never seen (black),
  // 1 seen but out of sight (grey); tiles in sight are left out.
  function fogRuns(world, side, x0, y0, x1, y1, emit) {
    const g = gridOf(world), s = work(world, side);
    const c0 = Math.max(0, Math.floor(x0 / TILE)), c1 = Math.min(g.tw - 1, Math.floor(x1 / TILE));
    const r0 = Math.max(0, Math.floor(y0 / TILE)), r1 = Math.min(g.th - 1, Math.floor(y1 / TILE));
    for (let c = c0; c <= c1; c += 1) {
      let state = -1, from = r0;
      for (let r = r0; r <= r1 + 1; r += 1) {
        const i = c * g.th + r;
        const st = r > r1 ? -2 : s.vis[i] ? -1 : s.seen[i] ? 1 : 0;
        if (st !== state) { if (state >= 0) emit(state, c, from, r - 1); state = st; from = r; }
      }
    }
  }
  // (a hack's grant: `to` sees what `from` sees for the given seconds)
  function grant(world, to, from, seconds) {
    const list = world.visionGrants || (world.visionGrants = []);
    list.push({ to, from, until: (world.tick || 0) + Math.round(seconds * 60) });
    const g = gridOf(world), s = g.sides.get(to);
    if (s) s.tick = -1e9;
  }
  // (fresh sight now: a test, or a match's start)
  function refresh(world, side) { const s = sideOf(gridOf(world), side); s.tick = -1e9; return work(world, side); }

  // (one eye's sight alone, for the suites: at (x, y), in sight?)
  function sightOf(world, sx, sy, R) {
    const g = gridOf(world), vis = new Uint8Array(g.tw * g.th);
    lay(world, g, vis, sx, sy, R);
    return (x, y) => { const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE); return tx >= 0 && tx < g.tw && ty >= 0 && ty < g.th && !!vis[tx * g.th + ty]; };
  }

  PW.vision = { sees, seenAt, spans, chunkInSight, fogRuns, grant, refresh, sightOf, RANGE, TILE };
})();
