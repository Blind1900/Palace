'use strict';
// Rigid falling pieces of buildings. A piece is a set of cells lifted out of the grid (structure,
// with the back walls and deco that belong to it). It either hinges about a pivot - crushing the
// overloaded stump it swings down into - or flies free, spinning. Where it strikes the ground or
// another building it shatters: the bigger it is and the harder it lands, the more it breaks into
// chunks that fly on with their own share of its motion; the rest is thrown wide as debris or
// heaps where it falls as rubble. Struck structures are chipped (which can bring them down too),
// a dust cloud rolls out low and wide, and big impacts leave the rubble smouldering.
// Pieces are drawn by re-sampling onto the cell grid: cells are never rotated as pixels.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, structural, hardness, breaksTo, palettes } = PW.mat;

  const RELEASE = 0.95;       // a hinging piece swings free after this much rotation (radians)
  const SETTLE_SPEED = 38;    // landing slower than this, a piece slumps where it lies as rubble
  const SPLIT_MIN = 300;      // pieces at least this big break into chunks when they land hard
  const CHUNK_MIN = 36;       // chunks smaller than this turn straight into debris
  const MAX_PIECES = 40;
  const OUTLINE_MAX = 360;    // contact points tested per sub-step

  function createFragments(world, particles) {
    const { mat, width: W, height: H } = world;
    const G = PW.GRAVITY;
    const F = PW.PARTICLE;
    const list = [];
    const stats = { spawned: 0, shattered: 0, chunks: 0, debris: 0, dust: 0, crushed: 0, chipped: 0, ms: 0 };
    const random = PW.createRandom(9173);
    let time = 0;

    // Cells a piece collides with: anything powder or heavier (rubble heaps stop it too).
    const blocking = (x, y) => {
      if (x < 1 || x >= W - 1 || y >= H - 1) return true;
      if (y < 0) return false;
      return phase[mat[y * W + x] & ID_MASK] >= PW.PHASE.POWDER;
    };
    const debrisOf = (byte) => {
      const id = byte & ID_MASK;
      if (structural[id] || id === M.FOUNDATION) return breaksTo[id] || M.DEBRIS;
      return breaksTo[id] || byte;
    };

    // ---- Spawning -------------------------------------------------------------------------------
    // spec: { cells: world cell indices (structure and the back/deco cells that go with it), owner,
    //   pivot: { x, y } (hinge) or null (free), dir (-1 / +1: the side it falls to), vx, vy, omega,
    //   generation, keep (an existing piece's cell data, for chunks) }
    function spawn(spec) {
      let data = spec.data;
      if (!data) {
        // Lift the cells out of the world: remember how each looked, then clear it.
        const n = spec.cells.length;
        data = { x: new Int32Array(n), y: new Int32Array(n), color: new Uint32Array(n), byte: new Uint8Array(n), solid: new Uint8Array(n) };
        let k = 0;
        // (the layers are read and cleared straight from their chunks: a whole building can be
        // tens of thousands of cells)
        const { CHUNK_SHIFT, CHUNK_MASK } = PW;
        const touched = new Set();
        for (const i of spec.cells) {
          const x = i % W, y = (i / W) | 0;
          const c = (y >> CHUNK_SHIFT) * world.chunksX + (x >> CHUNK_SHIFT), l = (y & CHUNK_MASK) << CHUNK_SHIFT | (x & CHUNK_MASK);
          const backs = world.back[c], decos = world.deco[c], paints = world.paint[c], owners = world.owner[c];
          const m = mat[i], id = m & ID_MASK;
          const back = backs ? backs[l] : 0, deco = decos ? decos[l] : 0;
          // A building's back wall is part of its frame: it has weight, it strikes what it falls
          // on, and it breaks into debris like the rest.
          const heavy = phase[id] >= PW.PHASE.POWDER;
          const wall = !heavy && back !== 0 && spec.owner && owners && owners[l] === spec.owner;
          const solid = heavy || wall;
          const paint = heavy ? ((paints && paints[l]) || palettes[id][(m >> 6) * 2 + (PW.hash2(x, y) & 1)]) : 0;
          const color = deco || paint || back;
          if (!color && !solid) continue;
          data.x[k] = x; data.y[k] = y; data.color[k] = color; data.byte[k] = wall ? M.DEBRIS : solid ? m : 0; data.solid[k] = solid ? 1 : 0;
          k += 1;
          if (heavy) PW.set(world, x, y, M.AIR, { quiet: true });
          if (backs) backs[l] = 0;
          if (decos) decos[l] = 0;
          if (owners) owners[l] = 0;
          touched.add(c);
        }
        // Re-raster every chunk the piece left (both layers, its whole area).
        for (const c of touched) {
          const cx = (c % world.chunksX) << CHUNK_SHIFT, cy = ((c / world.chunksX) | 0) << CHUNK_SHIFT, e = (1 << CHUNK_SHIFT) - 1;
          PW.markDirty(world, cx, cy, PW.DIRTY_BASE | PW.DIRTY_DECO);
          PW.markDirty(world, cx + e, cy + e, PW.DIRTY_BASE | PW.DIRTY_DECO);
        }
        for (const key of ['x', 'y', 'color', 'byte', 'solid']) data[key] = data[key].slice(0, k);
      }
      const n = data.x.length;
      let mass = 0, sx = 0, sy = 0;
      for (let k = 0; k < n; k += 1) if (data.solid[k]) { mass += 1; sx += data.x[k] + 0.5; sy += data.y[k] + 0.5; }
      if (mass < CHUNK_MIN) { settle(data, spec.vx || 0, spec.vy || 0); return null; }
      if (list.length >= MAX_PIECES) { scatter(data, 0, 0, 0, sx / mass, sy / mass, 0.5); return null; }
      const cx = sx / mass, cy = sy / mass;
      const ax = Math.floor(cx), ay = Math.floor(cy);
      // Local grid around the anchor cell (ax, ay), for drawing and contact.
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (let k = 0; k < n; k += 1) { const u = data.x[k] - ax, v = data.y[k] - ay; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const gw = u1 - u0 + 1, gh = v1 - v0 + 1;
      const grid = new Int32Array(gw * gh);
      for (let k = 0; k < n; k += 1) grid[(data.y[k] - ay - v0) * gw + (data.x[k] - ax - u0)] = k + 1;
      const solidAt = (u, v) => { if (u < u0 || u > u1 || v < v0 || v > v1) return false; const g = grid[(v - v0) * gw + (u - u0)]; return g > 0 && data.solid[g - 1] === 1; };
      // Outline: solid cells with an open side (where it touches the world first).
      const outline = [];
      let inertia = 0;
      for (let k = 0; k < n; k += 1) {
        if (!data.solid[k]) continue;
        const u = data.x[k] - ax, v = data.y[k] - ay;
        inertia += (u + 0.5 - (cx - ax)) ** 2 + (v + 0.5 - (cy - ay)) ** 2;
        if (!solidAt(u - 1, v) || !solidAt(u + 1, v) || !solidAt(u, v - 1) || !solidAt(u, v + 1)) outline.push(u + 0.5, v + 0.5);
      }
      const stride = Math.max(1, Math.ceil(outline.length / 2 / OUTLINE_MAX));
      const points = new Float32Array(Math.ceil(outline.length / 2 / stride) * 2);
      for (let k = 0, j = 0; k < outline.length; k += 2 * stride, j += 2) { points[j] = outline[k]; points[j + 1] = outline[k + 1]; }
      // data.x/y are world cells as they were when the piece was formed, (ox0, oy0) its anchor
      // cell then; (px, py) is where that anchor's corner is now.
      const piece = { data, n, mass, inertia, grid, gw, gh, u0, v0, points, owner: spec.owner || 0, generation: spec.generation || 0,
        ox0: ax, oy0: ay, px: ax, py: ay, gx: cx - ax, gy: cy - ay, angle: 0, omega: spec.omega || 0, vx: spec.vx || 0, vy: spec.vy || 0,
        mode: spec.pivot ? 'hinge' : spec.drop ? 'drop' : 'fly', dir: spec.dir || 1, age: 0,
        yf: spec.pivot ? spec.pivot.y : spec.floor || 0, crushedRows: 0, base: spec.base ?? H };
      if (spec.pivot) { piece.hx = spec.pivot.x; piece.hy = spec.pivot.y; piece.rx = ax - spec.pivot.x; piece.ry = ay - spec.pivot.y; }
      list.push(piece);
      stats.spawned += 1;
      return piece;
    }

    // ---- Motion ---------------------------------------------------------------------------------
    const cosSin = (p) => [Math.cos(p.angle), Math.sin(p.angle)];
    // World position of local point (u, v) (relative to the anchor cell's corner).
    const toWorld = (p, c, s, u, v) => [p.px + u * c - v * s, p.py + u * s + v * c];
    // The piece's centre of mass in the world.
    const centre = (p) => { const [c, s] = cosSin(p); return toWorld(p, c, s, p.gx, p.gy); };
    function velocityAt(p, wx, wy) {
      if (p.mode === 'hinge') return [-p.omega * (wy - p.hy), p.omega * (wx - p.hx)];
      const [cx, cy] = centre(p);
      return [p.vx - p.omega * (wy - cy), p.vy + p.omega * (wx - cx)];
    }
    function step(dt) {
      const t0 = performance.now();
      time += dt;
      for (let k = list.length - 1; k >= 0; k -= 1) {
        const p = list[k];
        p.age += dt;
        const reach = Math.hypot(p.gw, p.gh) / 2;
        const speed = p.mode === 'hinge' ? Math.abs(p.omega) * Math.hypot(p.rx, p.ry) + Math.abs(p.omega) * reach : Math.hypot(p.vx, p.vy) + Math.abs(p.omega) * reach;
        const sub = Math.min(p.mass > 2000 ? 12 : 6, Math.max(1, Math.ceil(speed * dt)));
        const h = dt / sub;
        let done = false;
        for (let s = 0; s < sub && !done; s += 1) {
          if (p.mode === 'hinge') {
            // Gravity's turning moment about the pivot, plus the lean towards the failed side.
            const [cx, cy] = centre(p);
            const dx = cx - p.hx, r2 = dx * dx + (cy - p.hy) ** 2;
            const alpha = G * (dx + p.dir * 3) / (p.inertia / p.mass + r2);
            p.omega += alpha * h;
            p.angle += p.omega * h;
            const c = Math.cos(p.angle), sn = Math.sin(p.angle);
            p.px = p.hx + p.rx * c - p.ry * sn;
            p.py = p.hy + p.rx * sn + p.ry * c;
            if (Math.abs(p.angle) > RELEASE) {
              const [wx, wy] = centre(p);
              [p.vx, p.vy] = velocityAt(p, wx, wy);
              p.mode = 'fly';
            }
          } else {
            p.vy += G * h;
            p.px += p.vx * h; p.py += p.vy * h;
            p.angle += p.omega * h;
          }
          done = contact(p);
        }
        if (done || p.py > H + 400 || p.age > 30) { list.splice(k, 1); if (!done) settle(p.data, 0, 0, p); }
      }
      stats.ms = performance.now() - t0;
    }
    // Test the piece's outline against the world. A hinging piece crushes the stump of its own
    // building as it swings down into it; anything else it strikes, it lands on.
    function contact(p) {
      const [c, s] = cosSin(p);
      const pts = p.points;
      let crushed = 0;
      for (let k = 0; k < pts.length; k += 2) {
        const [wx, wy] = toWorld(p, c, s, pts[k], pts[k + 1]);
        const x = Math.floor(wx), y = Math.floor(wy);
        if (!blocking(x, y)) {
          // Whatever stands in the open where it passes is swept away: trees and bushes are
          // knocked down, lamps, railings and furniture smashed.
          if (x > 0 && y > 0 && x < W && y < H && PW.getLayer(world, 'deco', x, y) && PW.getOwner(world, x, y) !== p.owner) sweep(x, y);
          continue;
        }
        // Loose debris is ploughed aside by a swinging or fast piece rather than landed on.
        if (phase[mat[y * W + x] & ID_MASK] === PW.PHASE.POWDER && (p.mode === 'hinge' || Math.hypot(...velocityAt(p, wx, wy)) > 70)) {
          const byte = mat[y * W + x];
          PW.set(world, x, y, M.AIR);
          const [vx, vy] = velocityAt(p, wx, wy);
          particles.spawn(x + 0.5, y + 0.5, vx * 0.6 + (random() - 0.5) * 60, Math.min(vy, 0) * 0.4 - 20 - random() * 40, byte, 0, F.LAND, 5);
          continue;
        }
        const own = p.owner && PW.getOwner(world, x, y) === p.owner;
        // (only above its building's floor: the cores and footings in the ground stay)
        const grinds = (p.mode === 'hinge' || p.mode === 'drop') && y < p.base && (mat[y * W + x] & ID_MASK) !== M.CORE;
        if (grinds && (own || (y >= p.yf - 1 && y <= p.yf + 8 && !PW.mat.terrain[mat[y * W + x] & ID_MASK]))) {
          crush(x, y, p.owner);
          crushed += 1;
          continue;
        }
        if (p.mode === 'hinge' && PW.mat.terrain[mat[y * W + x] & ID_MASK] && y >= p.yf && Math.abs(x - p.hx) < 6) continue;   // seated on its pivot
        impact(p, wx, wy, x, y);
        return true;
      }
      if (crushed && p.mode === 'hinge') p.omega *= Math.max(0.6, 1 - crushed * 0.004);   // crushing the stump slows the swing
      if (crushed && p.mode === 'drop') {
        // Grinding down through its own floors: it slows a little at each, and dust blasts out
        // sideways at its foot, low and wide.
        p.vy *= Math.max(0.85, 1 - crushed * 0.0015);
        const [, by] = toWorld(p, c, s, 0, p.v0 + p.gh);
        const footY = Math.min(H - 2, Math.round(by));
        if ((p.crushedRows += 1) % 3 === 0) {
          const [lx] = toWorld(p, c, s, p.u0, 0), [rx] = toWorld(p, c, s, p.u0 + p.gw, 0);
          for (const ex of [lx - 4, rx + 4]) puff(ex, footY - 3, 18, 26, 6);
        }
      }
      return false;
    }
    // A stump cell crushed under a swinging piece: it bursts into debris and dust.
    function crush(x, y, owner) {
      const m = mat[y * W + x], id = m & ID_MASK;
      PW.set(world, x, y, M.AIR);
      PW.setOwner(world, x, y, 0);
      stats.crushed += 1;
      if ((PW.hash3(x, y, stats.crushed) & 3) === 0) particles.spawn(x + 0.5, y + 0.5, (random() - 0.5) * 120, -40 - random() * 60, debrisOf(m), 0, F.LAND, 5, owner);
      else if (y + 1 < H && !blocking(x, y + 1)) PW.set(world, x, y, debrisOf(m));
      if ((PW.hash3(x, y, 7) & 3) === 0) puff(x, y - 1, 1);
      if (world.onDamage && owner) world.onDamage(owner, 1, x, y);
      void id;
    }

    function sweep(x, y) {
      if (PW.flora && PW.flora.strike(world, particles, x, y)) { stats.swept = (stats.swept || 0) + 1; return; }
      // (the fitting's building checks what is left of its fittings: a gate's beam without its posts)
      const owner = PW.getOwner(world, x, y);
      if (owner > 0 && owner < 50000 && world.onDamage) world.onDamage(owner, 0, x, y);
      const color = PW.getLayer(world, 'deco', x, y);
      PW.setLayer(world, 'deco', x, y, 0);
      if ((PW.hash2(x, y) & 3) === 0) particles.spawn(x + 0.5, y + 0.5, (random() - 0.5) * 140, -40 - random() * 80, 0, color, F.LEAF, 1.5);
      stats.swept = (stats.swept || 0) + 1;
    }
    // A heavy landing on open ground: the ground gives way in a dent, thrown up as clods.
    function dent(hx, hy, energy, vx) {
      const r = Math.min(9, Math.sqrt(energy) / 1500);
      if (r < 1.5) return;
      for (let y = Math.floor(hy - 1); y <= hy + r * 0.6; y += 1) for (let x = Math.floor(hx - r); x <= hx + r; x += 1) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const nx = (x - hx) / r, ny = (y - hy) / (r * 0.6);
        if (nx * nx + ny * ny > 1) continue;
        const m = mat[y * W + x], id = m & ID_MASK;
        if (!PW.mat.terrain[id] || hardness[id] > 0.5 || PW.getOwner(world, x, y)) continue;
        PW.set(world, x, y, M.AIR);
        if (random() < 0.4) particles.spawn(x + 0.5, y - 0.5, vx * 0.2 + (random() - 0.5) * 120, -60 - random() * 90, breaksTo[id] || M.LOOSE_SOIL, 0, F.LAND, 5);
        stats.dented = (stats.dented || 0) + 1;
      }
    }

    // ---- Landing --------------------------------------------------------------------------------
    function impact(p, wx, wy, hx, hy) {
      const [vx, vy] = velocityAt(p, wx, wy);
      const speed = Math.hypot(vx, vy);
      stats.shattered += 1;
      // The struck structure gives way around the point of impact (another building's wall, a
      // bridge...): heavier and faster pieces break more.
      const energy = p.mass * speed * speed;
      if (PW.mat.terrain[mat[hy * W + hx] & ID_MASK]) dent(hx, hy, energy, vx);
      // The shock of it shakes the ground around, and the ground it struck is looked at for what
      // lost its footing.
      if (world.stability) {
        world.stability.shock(hx, hy, energy / 40);
        world.stability.disturb(hx - 40, hy - 60, hx + 40, hy + 30);
      }
      const rr = Math.min(10, 1 + Math.sqrt(energy) / 900);
      for (let y = Math.floor(hy - rr); y <= hy + rr; y += 1) for (let x = Math.floor(hx - rr); x <= hx + rr; x += 1) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || (x - hx) ** 2 + (y - hy) ** 2 > rr * rr) continue;
        const m = mat[y * W + x], id = m & ID_MASK;
        if (!structural[id] || id === M.CORE || hardness[id] > 0.2 + speed / 300) continue;
        const owner = PW.getOwner(world, x, y);
        PW.set(world, x, y, M.AIR);
        particles.spawn(x + 0.5, y + 0.5, vx * 0.3 + (random() - 0.5) * 80, -Math.abs(vy) * 0.2 - 30, debrisOf(m), 0, F.LAND, 5, owner);
        stats.chipped += 1;
        if (owner && world.onDamage) world.onDamage(owner, 1, x, y);
      }
      const [c, s] = cosSin(p);
      // A big piece coming straight down (a building dropping into its own footprint) does not
      // burst all at once: only its bottom storey or so is crushed where it strikes, heaping up as
      // rubble, and the rest comes on down into it, slowed, to be crushed in turn - it sinks into
      // its own debris, breaking apart as it goes.
      if (p.mass >= SPLIT_MIN * 4 && Math.abs(vx) < Math.abs(vy) * 0.6 && Math.abs(p.omega) < 0.5 && Math.abs(p.angle) < 0.6) {
        const placed = place(p, p.data, c, s);
        let lowest = -Infinity;
        for (let j = 0; j < placed.x.length; j += 1) if (placed.solid[j]) lowest = Math.max(lowest, placed.y[j]);
        const band = Math.max(8, Math.round(p.gh * 0.08));
        const crushedKs = [], restKs = [];
        for (let j = 0; j < placed.x.length; j += 1) (placed.y[j] >= lowest - band ? crushedKs : restKs).push(j);
        scatter(pick(placed, crushedKs), vx * 0.3, 0, 0, wx, wy, 0.18);
        const rest = pick(placed, restKs);
        let restMass = 0;
        for (let j = 0; j < rest.x.length; j += 1) restMass += rest.solid[j];
        if (restMass >= CHUNK_MIN) {
          spawn({ data: rest, owner: p.owner, vx: vx * 0.4, vy: Math.max(30, vy * 0.65), omega: p.omega * 0.5,
            drop: true, floor: p.yf, base: p.base, generation: p.generation });
          stats.crushSteps = (stats.crushSteps || 0) + 1;
        } else if (rest.x.length) settle(rest, vx, vy);
        puff(hx, hy - 2, Math.min(900, Math.round(band * Math.sqrt(p.mass) / 2)), 30 + Math.sqrt(p.mass) * 1.2, 10 + band);
        // (the crushed storeys smoulder in the heap)
        const crushed = crushedKs.length;
        if (PW.addSmoulder && crushed > 400) PW.addSmoulder(world, hx, hy, 12 + Math.min(30, crushed / 300), 20 + Math.sqrt(crushed) * 0.6);
        return;
      }
      if (speed < SETTLE_SPEED || p.mass < SPLIT_MIN || p.generation >= 2) {
        // Small or slow: it breaks up where it lies, a fraction thrown off the impact.
        scatter(p.data, vx, vy, p.omega, ...centre(p), speed < SETTLE_SPEED ? 0.08 : 0.3, p, c, s);
      } else {
        // Big and fast: it breaks into chunks along jagged lines, each flying on with the motion
        // of its own part of the piece.
        const S = Math.max(18, Math.min(48, Math.sqrt(p.mass) / 2));
        const groups = new Map();
        const jag = (a, b) => (PW.hash2(Math.floor(a / 3), b) & 7) - 3.5;
        for (let k = 0; k < p.n; k += 1) {
          const key = Math.floor((p.data.x[k] + jag(p.data.y[k], 1)) / S) * 4096 + Math.floor((p.data.y[k] + jag(p.data.x[k], 2)) / S);
          let g = groups.get(key);
          if (!g) { g = []; groups.set(key, g); }
          g.push(k);
        }
        for (const ks of groups.values()) {
          // Where this chunk is now, and how fast that part of the piece was moving: chunks by the
          // point of impact bounce off it, the rest fly on.
          const placed = place(p, pick(p.data, ks), c, s);
          let mx = 0, my = 0, solidCount = 0;
          for (let j = 0; j < placed.x.length; j += 1) if (placed.solid[j]) { mx += placed.x[j] + 0.5; my += placed.y[j] + 0.5; solidCount += 1; }
          if (!solidCount) continue;
          mx /= solidCount; my /= solidCount;
          const [cvx, cvy] = velocityAt(p, mx, my);
          const near = Math.hypot(mx - wx, my - wy) < S * 1.5;
          const kick = 0.75 + random() * 0.3;
          spawn({ data: placed, owner: 0, vx: cvx * kick + (random() - 0.5) * 60,
            vy: near ? -Math.abs(cvy) * 0.25 - random() * 40 : cvy * kick,
            omega: p.omega * 0.6 + (random() - 0.5) * 3, generation: p.generation + 1 });
          stats.chunks += 1;
        }
      }
      // A dust cloud rolls out from where it came down, wide and low; big impacts leave the rubble
      // smouldering.
      puff(hx, hy - 2, Math.min(2600, Math.round(p.mass / 2)), 36 + Math.sqrt(p.mass) * 1.8, 12 + Math.sqrt(p.mass) * 0.4);
      if (p.mass > 1500 && PW.addSmoulder) PW.addSmoulder(world, hx, hy, 14 + Math.min(36, p.mass / 400), 30 + Math.sqrt(p.mass) * 0.6);
    }
    // The piece's cells at their present places in the world, as data for a new piece.
    function place(p, part, c, s) {
      const out = { x: new Int32Array(part.x.length), y: new Int32Array(part.x.length), color: part.color, byte: part.byte, solid: part.solid };
      for (let j = 0; j < part.x.length; j += 1) {
        const u = part.x[j] - p.ox0 + 0.5, v = part.y[j] - p.oy0 + 0.5;
        const [wx, wy] = toWorld(p, c, s, u, v);
        out.x[j] = Math.floor(wx); out.y[j] = Math.floor(wy);
      }
      return out;
    }
    function pick(data, ks) {
      const n = ks.length;
      const out = { x: new Int32Array(n), y: new Int32Array(n), color: new Uint32Array(n), byte: new Uint8Array(n), solid: new Uint8Array(n) };
      ks.forEach((k, j) => { out.x[j] = data.x[k]; out.y[j] = data.y[k]; out.color[j] = data.color[k]; out.byte[j] = data.byte[k]; out.solid[j] = data.solid[k]; });
      return out;
    }
    // Break a set of cells up where they are: most heap as rubble in open cells, a share is thrown
    // off with the motion they had (and spread wide).
    // A piece never stands as a block of debris in the air: only what lies on (or just above) what
    // holds it up heaps where it is; everything higher pours down in a rain of debris that piles
    // up on it, spreading a little as it falls.
    const HEAP = 10;
    // (a piece's colour as rubble: a little dulled with dust)
    const rubbleTone = (color, x, y) => {
      const c = PW.unpack(color), k = 0.78 + (PW.hash2(x, y) & 15) / 100;
      return PW.abgr(c[0] * k + 18, c[1] * k + 16, c[2] * k + 14);
    };
    function scatter(data, vx, vy, omega, cx, cy, thrown, p, c, s) {
      const n = data.x.length, wxs = new Int32Array(n), wys = new Int32Array(n);
      const lowest = new Map();
      for (let k = 0; k < n; k += 1) {
        let x = data.x[k], y = data.y[k];
        if (p) { const [wx, wy] = toWorld(p, c, s, data.x[k] - p.ox0 + 0.5, data.y[k] - p.oy0 + 0.5); x = Math.floor(wx); y = Math.floor(wy); }
        wxs[k] = x; wys[k] = y;
        if (data.solid[k] && (!lowest.has(x) || y > lowest.get(x))) lowest.set(x, y);
      }
      // (the row each column's debris comes to rest on)
      const support = new Map();
      for (const [x, low] of lowest) {
        let y = low + 1;
        while (y < H - 1 && y < low + 400 && !blocking(x, y)) y += 1;
        support.set(x, y);
      }
      for (let k = 0; k < n; k += 1) {
        const x = wxs[k], y = wys[k];
        if (!data.solid[k]) { if ((k & 15) === 0) puff(x, y, 1); continue; }
        const byte = debrisOf(data.byte[k]);
        if (random() < thrown) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          particles.spawn(x + 0.5, y - 0.5, vx * 0.5 - omega * dy * 0.5 + (random() - 0.5) * 160, -Math.abs(vy) * 0.3 - random() * 120 + omega * dx * 0.2, byte, 0, F.LAND | F.DAMAGE, 6);
        } else if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !blocking(x, y) && support.get(x) - y <= HEAP) {
          PW.set(world, x, y, byte);
          if (data.color[k] && (byte & ID_MASK) === M.DEBRIS) PW.setLayer(world, 'paint', x, y, rubbleTone(data.color[k], x, y));
          stats.debris += 1;
        } else if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !blocking(x, y)) {
          // (the higher it falls from, the wider it spreads)
          const spread = 70 + (support.get(x) - y) * 0.45;
          particles.spawn(x + 0.5, y + 0.5, vx * 0.2 + (random() - 0.5) * spread, 10 + random() * 40, byte, data.color[k] || 0, F.LAND, 6);
          stats.rained = (stats.rained || 0) + 1;
        } else {
          particles.spawn(x + 0.5, y - 1.5, (random() - 0.5) * 60, -30 - random() * 40, byte, 0, F.LAND, 6);
        }
      }
    }
    function settle(data, vx, vy, p) { scatter(data, vx, vy, 0, 0, 0, 0.05, p, ...(p ? cosSin(p) : [1, 0])); }
    // Dust: real gas cells in open air around (x, y), in a flat ellipse.
    function puff(x, y, count = 1, rx = 3, ry = 2) {
      for (let k = 0; k < count; k += 1) {
        const a = random() * Math.PI * 2, d = Math.sqrt(random());
        const dx = Math.round(Math.cos(a) * rx * d), dy = Math.round(Math.sin(a) * ry * d - ry * 0.3);
        const tx = Math.round(x) + dx, ty = Math.round(y) + dy;
        if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) continue;
        if ((mat[ty * W + tx] & ID_MASK) !== M.AIR) continue;
        PW.set(world, tx, ty, M.DUST | (2 + (random() < 0.5 ? 1 : 0)) << 6, { quiet: true });
        stats.dust += 1;
      }
    }

    // ---- Drawing ---------------------------------------------------------------------------------
    // Each world cell the piece covers takes the colour of the piece's cell found by turning back
    // through the piece's rotation (nearest cell), so the piece stays on the cell grid.
    let canvas = null, ctx2 = null;
    function draw(renderer) {
      if (!list.length) return;
      const { ctx, camera, view } = renderer;
      const z = camera.zoom;
      const step = Math.max(1, Math.floor(1 / z));
      const vx0 = camera.x, vy0 = camera.y, vx1 = vx0 + view.width / z, vy1 = vy0 + view.height / z;
      for (const p of list) {
        const [c, s] = cosSin(p);
        // Bounds of the rotated piece.
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [u, v] of [[p.u0, p.v0], [p.u0 + p.gw, p.v0], [p.u0, p.v0 + p.gh], [p.u0 + p.gw, p.v0 + p.gh]]) {
          const [wx, wy] = toWorld(p, c, s, u, v);
          x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
        }
        x0 = Math.max(Math.floor(x0), Math.floor(vx0)); y0 = Math.max(Math.floor(y0), Math.floor(vy0));
        x1 = Math.min(Math.ceil(x1), Math.ceil(vx1)); y1 = Math.min(Math.ceil(y1), Math.ceil(vy1));
        if (x1 <= x0 || y1 <= y0) continue;
        const iw = Math.ceil((x1 - x0) / step), ih = Math.ceil((y1 - y0) / step);
        if (!canvas || canvas.width < iw || canvas.height < ih) {
          canvas = document.createElement('canvas');
          canvas.width = Math.max(iw, canvas ? canvas.width : 0); canvas.height = Math.max(ih, canvas ? canvas.height : 0);
          ctx2 = canvas.getContext('2d');
        }
        const image = ctx2.createImageData(iw, ih);
        const px32 = new Uint32Array(image.data.buffer);
        const { grid, gw, gh, u0, v0, data } = p;
        for (let j = 0; j < ih; j += 1) {
          const wy = y0 + j * step + 0.5 - p.py;
          for (let i = 0; i < iw; i += 1) {
            const wx = x0 + i * step + 0.5 - p.px;
            const u = Math.floor(wx * c + wy * s), v = Math.floor(-wx * s + wy * c);
            const gu = u - u0, gv = v - v0;
            if (gu < 0 || gv < 0 || gu >= gw || gv >= gh) continue;
            const g = grid[gv * gw + gu];
            if (g) px32[j * iw + i] = data.color[g - 1];
          }
        }
        ctx2.clearRect(0, 0, canvas.width, canvas.height);
        ctx2.putImageData(image, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvas, 0, 0, iw, ih, Math.round((x0 - vx0) * z), Math.round((y0 - vy0) * z), Math.round(iw * step * z), Math.round(ih * step * z));
      }
    }

    return { spawn, step, draw, list, stats, puff };
  }

  PW.createFragments = createFragments;
})();
