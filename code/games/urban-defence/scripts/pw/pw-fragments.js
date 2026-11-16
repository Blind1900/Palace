'use strict';
// Rigid falling pieces of buildings. A piece is a set of cells lifted out of the grid (structure,
// with the back walls and deco that belong to it), moving as one solid body. It either hinges
// about a pivot - crushing the overloaded stump it swings down into - or moves free, turning.
// What it strikes pushes back on it where they touch, so it bounces, slides and turns over what
// it lands on; hard blows break off the corner that took them and crack it into chunks that go on
// from where they were, each with its own part of the motion - so a building breaks apart as it
// comes down, part by part. Struck structures are chipped (which can bring them down too), dust is
// driven out along the ground the way it was going, and big blows leave the rubble smouldering.
// What comes to rest big enough stays as ruin, part of the ground; small bits heap as rubble.
// Pieces are drawn by re-sampling onto the cell grid: cells are never rotated as pixels.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, structural, hardness, breaksTo, palettes } = PW.mat;

  const RELEASE = 0.95;       // a hinging piece swings free after this much rotation (radians)
  const SPLIT_MIN = 300;      // pieces at least this big can crack into chunks
  const CHUNK_MIN = 36;       // chunks smaller than this turn straight into debris
  const MAX_PIECES = 100;
  const OUTLINE_MAX = 480;    // contact points tested per sub-step
  // A piece (or a chunk of one) at least RUIN_MIN cells big comes to rest whole where it lands -
  // tilted, misplaced, cracked at its edges - as a ruin, part of the ground.
  const RUIN_MIN = 60;
  const FLORA_MIN = 14;       // a piece of a plant with less wood than this comes apart as it falls
  // A building is mostly air. Its weight and strength are in its frame - pillars, floors, outer
  // walls; a cell of back wall (marked THIN in a piece) is a light panel behind its rooms: it goes
  // along with the frame, weighing THIN_WEIGHT of a frame cell, strikes nothing, and broken up only
  // one in WALL_RUBBLE of them leaves a grain of rubble (the rest goes to dust).
  const THIN = 2, THIN_WEIGHT = 0.1, WALL_RUBBLE = 4;
  const weightOf = (solid) => (solid === 1 ? 1 : solid === THIN ? THIN_WEIGHT : 0);

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
    // (a cell of a piece broken up: does it leave a grain of rubble? Structure does; back wall one
    // in WALL_RUBBLE - the rest goes up as a little dust)
    const rubbleFrom = (solid, x, y) => solid === 1 || (solid === THIN && (PW.hash2(x | 0, y | 0) % WALL_RUBBLE) === 0);
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
          // A building's back wall is part of its frame: it has weight and it strikes what it
          // falls on. But it is a thin panel: broken up, it leaves far less rubble than the
          // pillars, floors and outer walls (THIN, see wallBits).
          const heavy = phase[id] >= PW.PHASE.POWDER;
          const wall = !heavy && back !== 0 && spec.owner && owners && owners[l] === spec.owner;
          const solid = heavy || wall;
          // (ground keeps the look it had in the world: its strata, its depth, its grain)
          const paint = heavy ? ((paints && paints[l]) || (world.colorAt && PW.mat.terrain[id] ? world.colorAt(x, y) : palettes[id][(m >> 6) * 2 + (PW.hash2(x, y) & 1)])) : 0;
          const color = deco || paint || back;
          if (!color && !solid) continue;
          data.x[k] = x; data.y[k] = y; data.color[k] = color; data.byte[k] = wall ? M.DEBRIS : solid ? m : 0; data.solid[k] = heavy ? 1 : wall ? THIN : 0;
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
      // (its weight is in its frame: a back wall weighs little - see THIN)
      let mass = 0, heavy = 0, thin = 0, sx = 0, sy = 0;
      for (let k = 0; k < n; k += 1) {
        const w = weightOf(data.solid[k]);
        if (!w) continue;
        mass += w; sx += (data.x[k] + 0.5) * w; sy += (data.y[k] + 0.5) * w;
        if (data.solid[k] === 1) heavy += 1; else thin += 1;
      }
      // A part of a piece (a chunk it broke into, what is left of it) goes on from just where it
      // was in the piece, turned as it was, and - unless told otherwise - moving as that part of it
      // was moving: its cells are kept as they were in the building, never re-drawn.
      const parent = spec.parent || null;
      const here = () => (parent ? place(parent, data, ...cosSin(parent)) : data);
      // (a piece of a plant - a tree, a bough - is light and comes to rest as it is: its wood is
      // what it strikes with, its leaves go along)
      if (spec.flora) {
        // (a twig with its leaves is too slight to fall as one piece: it comes apart as it falls,
        // leaves fluttering down, splinters dropping)
        if (mass < FLORA_MIN && PW.flora && PW.flora.shed) {
          const at = here();
          for (let k = 0; k < at.x.length; k += 1) PW.flora.shed(particles, at.x[k], at.y[k], at.color[k], (spec.vx || 0) * 0.5, (spec.vy || 0) * 0.5, false, world);
          return null;
        }
        if (list.length >= MAX_PIECES) { if (PW.flora) PW.flora.land(world, particles, here(), null); return null; }
      } else {
        // (too little frame to hold together - a scrap, or a panel of back wall with nothing
        // round it: it comes apart where it is)
        if (mass < CHUNK_MIN || heavy < CHUNK_MIN / 2) { settle(here(), spec.vx || 0, spec.vy || 0); return null; }
        if (list.length >= MAX_PIECES) { settle(here(), spec.vx || 0, spec.vy || 0); return null; }
      }
      const cx = sx / mass, cy = sy / mass;
      const ax = Math.floor(cx), ay = Math.floor(cy);
      // Local grid around the anchor cell (ax, ay), for drawing and contact.
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (let k = 0; k < n; k += 1) { const u = data.x[k] - ax, v = data.y[k] - ay; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const gw = u1 - u0 + 1, gh = v1 - v0 + 1;
      const grid = new Int32Array(gw * gh);
      for (let k = 0; k < n; k += 1) grid[(data.y[k] - ay - v0) * gw + (data.x[k] - ax - u0)] = k + 1;
      // What it strikes with is its frame - pillars, floors, outer walls (a tree's wood). A
      // building is mostly air: its rooms are open, the back wall only a panel behind them, so
      // what it falls on can come into its rooms (and a piece hollow enough breaks up the easier).
      const solidAt = (u, v) => { if (u < u0 || u > u1 || v < v0 || v > v1) return false; const g = grid[(v - v0) * gw + (u - u0)]; return g > 0 && data.solid[g - 1] === 1; };
      // (the open space outside it: everything not frame reached from the edges of its box)
      const outside = new Uint8Array(gw * gh), fill = [];
      for (let gv = 0; gv < gh; gv += 1) for (let gu = 0; gu < gw; gu += 1) {
        if (gu > 0 && gv > 0 && gu < gw - 1 && gv < gh - 1) continue;
        if (!solidAt(gu + u0, gv + v0)) { outside[gv * gw + gu] = 1; fill.push(gv * gw + gu); }
      }
      for (let q = 0; q < fill.length; q += 1) {
        const g = fill[q], gu = g % gw, gv = (g / gw) | 0;
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nu = gu + du, nv = gv + dv;
          if (nu < 0 || nv < 0 || nu >= gw || nv >= gh) continue;
          const j = nv * gw + nu;
          if (outside[j] || solidAt(nu + u0, nv + v0)) continue;
          outside[j] = 1; fill.push(j);
        }
      }
      const isOutside = (u, v) => u < u0 || u > u1 || v < v0 || v > v1 || outside[(v - v0) * gw + (u - u0)] === 1;
      // Outline: frame cells with an open side (where it touches the world first), and which way
      // each faces (out through its open sides). Its outer faces are tested closely, the faces of
      // its rooms more sparsely.
      const outer = [], inner = [];
      let inertia = 0;
      for (let k = 0; k < n; k += 1) {
        const wgt = weightOf(data.solid[k]);
        if (!wgt) continue;
        const u = data.x[k] - ax, v = data.y[k] - ay;
        inertia += wgt * ((u + 0.5 - (cx - ax)) ** 2 + (v + 0.5 - (cy - ay)) ** 2);
        if (data.solid[k] !== 1) continue;
        const l = solidAt(u - 1, v), r = solidAt(u + 1, v), t = solidAt(u, v - 1), b = solidAt(u, v + 1);
        if (l && r && t && b) continue;
        const out = (!l && isOutside(u - 1, v)) || (!r && isOutside(u + 1, v)) || (!t && isOutside(u, v - 1)) || (!b && isOutside(u, v + 1));
        (out ? outer : inner).push(u + 0.5, v + 0.5, (l ? 0 : -1) + (r ? 0 : 1), (t ? 0 : -1) + (b ? 0 : 1));
      }
      const picked = [];
      for (const [set, share] of [[outer, 0.75], [inner, 0.25]]) {
        const stride = Math.max(1, Math.ceil(set.length / 4 / (OUTLINE_MAX * share)));
        for (let k = 0; k < set.length; k += 4 * stride) picked.push(set[k], set[k + 1], set[k + 2], set[k + 3]);
      }
      const points = new Float32Array(picked.length / 2), faces = new Float32Array(picked.length / 2);
      for (let k = 0, j = 0; k < picked.length; k += 4, j += 2) {
        points[j] = picked[k]; points[j + 1] = picked[k + 1];
        const len = Math.hypot(picked[k + 2], picked[k + 3]) || 1;
        faces[j] = picked[k + 2] / len; faces[j + 1] = picked[k + 3] / len;
      }
      // data.x/y are world cells as they were when the piece was formed, (ox0, oy0) its anchor
      // cell then; (px, py) is where that anchor's corner is now.
      const piece = { data, n, mass, inertia, grid, gw, gh, u0, v0, points, faces, owner: spec.owner || 0, from: spec.from || spec.owner || 0, generation: spec.generation || 0,
        ox0: ax, oy0: ay, px: ax, py: ay, gx: cx - ax, gy: cy - ay, angle: 0, omega: spec.omega || 0, vx: spec.vx || 0, vy: spec.vy || 0,
        mode: spec.pivot ? 'hinge' : spec.drop ? 'drop' : 'fly', dir: spec.dir || 1, age: 0, flora: !!spec.flora,
        yf: spec.pivot ? spec.pivot.y : spec.floor || 0, crushedRows: 0, base: spec.base ?? H, h0: spec.h0 || gh, still: 0, touched: -1, sunk: spec.sunk || 0,
        hollow: heavy + thin ? thin / (heavy + thin) : 0 };
      if (parent) {
        const [c, s] = cosSin(parent);
        [piece.px, piece.py] = toWorld(parent, c, s, ax - parent.ox0, ay - parent.oy0);
        piece.angle = parent.angle;
        if (spec.inherit) {
          const [wx, wy] = toWorld(piece, c, s, piece.gx, piece.gy), [vx, vy] = velocityAt(parent, wx, wy);
          piece.vx += vx; piece.vy += vy; piece.omega += parent.omega;
        }
      }
      if (spec.pivot) {
        // (where its anchor is from the pivot, before it turned)
        piece.hx = spec.pivot.x; piece.hy = spec.pivot.y;
        // (coming down through the stump under it first - see pancake)
        piece.stage = 'stump'; piece.row = Math.floor(spec.pivot.y); piece.into = 0; piece.vd = 0;
        const c = Math.cos(piece.angle), s = Math.sin(piece.angle), dx = piece.px - piece.hx, dy = piece.py - piece.hy;
        piece.rx = dx * c + dy * s; piece.ry = -dx * s + dy * c;
      }
      // (its foot: the storeys at its bottom, crushed into the ground as it leans over)
      piece.footBand = Math.max(10, Math.min(80, gh * 0.2));
      piece.footV = v0 + gh - piece.footBand;
      piece.eaten = 0;
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
    const motion = (p) => {
      // (a plant's leaves reach far out round its wood: its turning is reckoned at its wood)
      const reach = p.flora ? Math.min(20, Math.hypot(p.gw, p.gh) / 2) : Math.hypot(p.gw, p.gh) / 2;
      return p.mode === 'hinge' ? Math.abs(p.omega) * (Math.hypot(p.rx, p.ry) + reach) : Math.hypot(p.vx, p.vy) + Math.abs(p.omega) * reach;
    };
    const was = { px: 0, py: 0, angle: 0 };
    function step(dt) {
      const t0 = performance.now();
      time += dt;
      for (let k = list.length - 1; k >= 0; k -= 1) {
        const p = list[k];
        p.age += dt;
        const speed = motion(p);
        const sub = Math.min(p.mass > 2000 ? 12 : 6, Math.max(1, Math.ceil(speed * dt)));
        const h = dt / sub;
        // (going through the air, it drives the air along with it: the dust about it goes its way)
        if (!p.flora && speed > 90 && world.air && ((world.tick || 0) + k) % 4 === 0) {
          const [cx, cy] = centre(p), [vx, vy] = velocityAt(p, cx, cy);
          if (Math.hypot(vx, vy) > 60) world.air.gust(cx, cy, Math.min(80, Math.hypot(p.gw, p.gh) * 0.4 + 12), vx * 0.6, vy * 0.6);
        }
        let done = false;
        for (let s = 0; s < sub && !done; s += 1) {
          was.px = p.px; was.py = p.py; was.angle = p.angle;
          if (p.mode === 'hinge') {
            // Its weight crushes what it stands on as it leans (see pancake); and gravity's turning
            // moment about the pivot, plus the lean towards the failed side, turns it over.
            pancake(p, h);
            const [cx, cy] = centre(p);
            const dx = cx - p.hx, r2 = dx * dx + (cy - p.hy) ** 2;
            const alpha = G * (dx + p.dir * 3) / (p.inertia / p.mass + r2);
            p.omega += alpha * h;
            p.angle += p.omega * h;
            const c = Math.cos(p.angle), sn = Math.sin(p.angle);
            p.px = p.hx + p.rx * c - p.ry * sn;
            p.py = p.hy + p.rx * sn + p.ry * c;
            if (Math.abs(p.angle) > RELEASE) {
              // (what is left of it, its foot crushed away, goes on free as a piece of its own)
              if (p.eaten) { done = rebuild(p); break; }
              const [wx, wy] = centre(p);
              [p.vx, p.vy] = velocityAt(p, wx, wy);
              p.mode = 'fly';
            }
          } else {
            // Free: its centre of mass flies on and it turns about that.
            const [c0, s0] = cosSin(p);
            p.vy += G * h;
            const cx = p.px + p.gx * c0 - p.gy * s0 + p.vx * h, cy = p.py + p.gx * s0 + p.gy * c0 + p.vy * h;
            p.angle += p.omega * h;
            const c = Math.cos(p.angle), sn = Math.sin(p.angle);
            p.px = cx - (p.gx * c - p.gy * sn); p.py = cy - (p.gx * sn + p.gy * c);
          }
          done = contact(p, h);
        }
        if (!done && p.footTouch) { p.footTouch = false; if (p.mode === 'hinge') eatFoot(p); }
        if (!done) {
          // At rest on what it lies on (barely moving, and touching something lately) for a moment:
          // it stays there.
          // (not one just setting off from rest: that is slow and touching too, but gaining speed)
          // (gaining: its speed rising steadily, tick after tick - not the jitter of resting contact)
          const now = motion(p);
          p.gain = (p.gain || 0) * 0.7 + (now - (p.lastMotion ?? now)) * 0.3;
          p.lastMotion = now;
          const gaining = p.age < 1 && p.gain > 1.5;
          if (now > REST_SPEED * 2 || gaining) p.still = 0;
          else if (now < REST_SPEED && p.age - p.touched < 0.25 && p.age > 0.3) p.still += dt;
          if (p.py > H + 400) done = true;
          else if (p.still > 0.3 || p.age > MAX_AGE || (p.age > 10 && now < 40)) { finish(p); done = true; }
        }
        if (done) list.splice(k, 1);
      }
      stats.ms = performance.now() - t0;
    }
    // A building leaning over on its pivot presses its foot into the ground: the storeys there are
    // crushed under it, bursting out as rubble and dust, so it goes on over rather than standing
    // propped on its corner. (Its cells are taken out of it where it is; it is made over when it
    // goes free - see rebuild.)
    function eatFoot(p) {
      const [c, s] = cosSin(p);
      const { grid, gw, gh, u0, v0, data } = p;
      let eaten = 0, lost = 0;
      for (let v = Math.max(v0, Math.ceil(p.footV)); v < v0 + gh; v += 1) {
        for (let u = u0; u < u0 + gw; u += 1) {
          const gi = (v - v0) * gw + (u - u0), g = grid[gi];
          if (!g || !data.solid[g - 1]) continue;
          const [wx, wy] = toWorld(p, c, s, u + 0.5, v + 0.5);
          const x = Math.floor(wx), y = Math.floor(wy);
          if (!blocking(x, y)) continue;
          // (its own stump under it is crushed instead)
          if (p.owner && y < p.base && PW.getOwner(world, x, y) === p.owner && (mat[y * W + x] & ID_MASK) !== M.CORE) { crush(x, y, p.owner); continue; }
          const k = g - 1;
          // (out at the surface above it)
          let ty = y;
          while (ty > 1 && blocking(x, ty) && y - ty < 24) ty -= 1;
          if ((eaten & 1) === 0 && rubbleFrom(data.solid[k], u, v)) particles.spawn(x + 0.5, ty + 0.5, p.dir * (30 + random() * 140) + (random() - 0.5) * 60, -20 - random() * 60, debrisOf(data.byte[k]), data.color[k] || 0, F.LAND | F.DAMAGE, 6);
          else if ((eaten & 3) === 1) puff(x, ty - 2, 2, 5, 3);
          lost += weightOf(data.solid[k]);
          grid[gi] = 0; data.solid[k] = 0; data.color[k] = 0;
          eaten += 1;
        }
      }
      if (!eaten) return;
      p.mass = Math.max(1, p.mass - lost); p.eaten += eaten;
      p.omega *= Math.max(0.98, 1 - eaten * 0.00004);
      stats.footCrushed = (stats.footCrushed || 0) + eaten;
    }
    // A tipping top far heavier than what it stands on does not just swing over on its pivot: its
    // weight crushes the storeys under it as it leans - it pancakes. The hinge comes down through
    // its own building's stump, row by row across the whole width of it, each crushed row bursting
    // out of its sides as rubble and dust; at the ground it comes on down through the piece's own
    // lowest storeys, along its own floors. So it comes down storey by storey as it goes over. Each
    // row resists by what in it carries load down - its walls and pillars, the frame that runs on
    // up or down from it (a floor slab is crushed, it carries nothing down) - against the weight on
    // it: a light top stalls on a stump that can hold it; a heavy one comes on down.
    const PANCAKE_MIN = 1200;     // frame cells: lighter tops only hinge
    const CRUSH_RESIST = 1.3e5;   // how hard a row resists, per load-bearing cell in it, over the weight on it
    const MEMBER = 6;             // a cell carries load down if the frame runs on this far beyond it
    const SELF_MAX = 0.4;         // the share of its own height a piece crushes of itself, at most
    function pancake(p, h) {
      if (p.flora || !p.owner || p.mass < PANCAKE_MIN || p.pancaked) return;
      p.vd = Math.max(0, p.vd + (G - (p.resist || 0)) * h);
      let go = p.vd * h;
      while (go > 1e-6) {
        const left = 1 - p.into;
        if (go < left) { p.into += go; lower(p, go); return; }
        lower(p, left); go -= left; p.into = 0; p.resist = 0;
        const row = nextRow(p);
        if (!row) return;
        // (it cannot break the next row - not with its weight, not with the speed it has: that
        // holds it)
        const resist = CRUSH_RESIST * row.weight / p.mass;
        if (resist > G && p.vd * p.vd < 2 * (resist - G)) { p.vd = 0; p.pancaked = true; return; }
        crushRow(p, row);
        p.resist = resist;
      }
    }
    // (the hinge comes down by d: through the stump the pivot goes down; through itself the piece
    // goes down past the pivot, along its own height - and its foot, what it presses into the
    // ground as it leans, is the bottom of what is left of it)
    function lower(p, d) {
      if (p.stage === 'self') { p.ry += d; p.footV = Math.min(p.footV, -p.ry - p.footBand); }
      else { p.hy += d; p.yf = p.hy; }
    }
    // The next row it comes down into: a row of its stump (the cells its building owns, across the
    // piece's width either side of the pivot), or at the ground - its building's floor, or ground
    // at the pivot - a row of its own, from the bottom up. Null when it has crushed all of itself
    // it will.
    function nextRow(p) {
      if (p.stage === 'stump') {
        const y = p.row + 1;
        // (solid ground at the pivot that is not its building's; rubble lying on the stump is not
        // ground, it is ploughed aside)
        let ground = y >= p.base;
        for (let x = Math.floor(p.hx) - 3; x <= p.hx + 3 && !ground; x += 1) {
          const id = mat[y * W + x] & ID_MASK;
          if (PW.mat.terrain[id] && phase[id] === PW.PHASE.SOLID && PW.getOwner(world, x, y) !== p.owner) ground = true;
        }
        if (!ground) {
          const xs = [];
          let weight = 0;
          const span = p.gw + 8;
          for (let x = Math.max(1, Math.floor(p.hx - span)); x <= Math.min(W - 2, p.hx + span); x += 1) {
            if (PW.getOwner(world, x, y) !== p.owner) continue;
            const id = mat[y * W + x] & ID_MASK;
            if (id === M.CORE) continue;
            if (structural[id] && !PW.mat.terrain[id]) {
              xs.push(x);
              const below = Math.min(H - 1, y + MEMBER), bid = mat[below * W + x] & ID_MASK;
              if (structural[bid] && !PW.mat.terrain[bid]) weight += 1;
            } else if (PW.getLayer(world, 'back', x, y) || PW.getLayer(world, 'deco', x, y)) xs.push(x);
          }
          p.row = y;
          return { y, xs, weight };
        }
        // (at the ground: from here it is its own storeys that give way)
        p.stage = 'self'; p.row = Math.ceil(-p.ry); p.into = 0;
        stats.pancakeGround = (stats.pancakeGround || 0) + 1;
      }
      const v = p.row - 1;
      if (p.v0 + p.gh - 1 - v > SELF_MAX * p.gh || v < p.v0) { p.pancaked = true; return null; }
      let weight = 0;
      const base = (v - p.v0) * p.gw, up = v - MEMBER >= p.v0 ? (v - MEMBER - p.v0) * p.gw : -1;
      if (v < p.v0 + p.gh) for (let gu = 0; gu < p.gw; gu += 1) {
        const g = p.grid[base + gu];
        if (!g || p.data.solid[g - 1] !== 1 || up < 0) continue;
        const a = p.grid[up + gu];
        if (a && p.data.solid[a - 1] === 1) weight += 1;
      }
      p.row = v;
      return { v, weight };
    }
    // Crush the row it came down into: a row of its stump bursts into rubble and dust where it
    // stands; a row of its own is torn out of it, thrown out of its sides. Every few rows the air
    // and dust in the storey it crushed are blown out of both sides, low.
    function crushRow(p, row) {
      let x0 = Infinity, x1 = -Infinity, y = 0, n = 0;
      if (row.xs) {
        y = row.y;
        for (const x of row.xs) {
          const id = mat[y * W + x] & ID_MASK;
          if (structural[id] && !PW.mat.terrain[id]) crush(x, y, p.owner);
          else {
            const back = PW.getLayer(world, 'back', x, y);
            PW.setLayer(world, 'back', x, y, 0); PW.setLayer(world, 'deco', x, y, 0); PW.setOwner(world, x, y, 0);
            if (back && (PW.hash2(x, y) % (WALL_RUBBLE * 2)) === 0) particles.spawn(x + 0.5, y + 0.5, (random() - 0.5) * 80, -20 - random() * 40, M.DEBRIS, back, F.LAND, 5);
          }
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          n += 1;
        }
      } else {
        const [c, s] = cosSin(p), v = row.v, base = (v - p.v0) * p.gw;
        let lost = 0;
        if (v < p.v0 + p.gh) for (let gu = 0; gu < p.gw; gu += 1) {
          const g = p.grid[base + gu];
          if (!g) continue;
          const k = g - 1, u = p.u0 + gu;
          const [wx, wy] = toWorld(p, c, s, u + 0.5, v + 0.5);
          const side = (u - p.gx) * c - (v - p.gy) * s > 0 ? 1 : -1;
          if (p.data.solid[k] && (n & 1) === 0 && rubbleFrom(p.data.solid[k], u, v)) {
            particles.spawn(wx, wy, side * (40 + random() * 120) + (random() - 0.5) * 40, -20 - random() * 50, debrisOf(p.data.byte[k]), p.data.color[k] || 0, F.LAND | F.DAMAGE, 6);
          } else if ((n & 7) === 3) puff(wx, wy - 1, 1);
          lost += weightOf(p.data.solid[k]);
          p.grid[base + gu] = 0; p.data.solid[k] = 0; p.data.color[k] = 0;
          if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
          y = Math.max(y, wy);
          n += 1;
        }
        p.mass = Math.max(1, p.mass - lost);
        p.eaten += n;
      }
      if (!n) return;
      stats.pancaked = (stats.pancaked || 0) + n;
      if ((p.crushedRows += 1) % 5 === 0) blowOut(x0, x1, Math.round(y), Math.max(60, p.vd * 1.5), 0.5);
    }
    // What is left of a piece, made over as a piece of its own going on just as it was (free).
    function rebuild(p) {
      const ks = [];
      for (let k = 0; k < p.data.x.length; k += 1) if (p.data.solid[k] || p.data.color[k]) ks.push(k);
      spawn({ data: pick(p.data, ks), parent: p, inherit: true, owner: p.owner, from: p.from, generation: p.generation, h0: p.h0, floor: p.yf, base: p.base, dir: p.dir });
      return true;
    }
    // A piece come to rest: a big enough one lies where it is as a ruin, a small one heaps as
    // rubble; a tree lies as it fell.
    function finish(p) {
      const [c, s] = cosSin(p);
      if (p.flora) { if (PW.flora) PW.flora.land(world, particles, place(p, p.data, c, s), p); stats.landedPlants = (stats.landedPlants || 0) + 1; return; }
      if (p.mass >= RUIN_MIN) ruin(p, c, s);
      else settle(p.data, 0, 0, p);
    }
    // Test the piece's outline against the world. A hinging piece crushes the stump of its own
    // building as it swings down into it; anything else it strikes pushes back on it where they
    // touch (see strike). True when the piece is gone (come to rest, broken up, or replaced by what
    // is left of it).
    function contact(p, h) {
      const [c, s] = cosSin(p);
      const pts = p.points, faces = p.faces;
      const c0 = Math.cos(was.angle), s0 = Math.sin(was.angle);
      let crushed = 0, smashed = 0, n = 0, sx = 0, sy = 0, fx = 0, fy = 0, hs = 0, wet = 0;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let k = 0; k < pts.length; k += 2) {
        // (the storeys of it already crushed under its hinge are gone)
        if (p.stage === 'self' && p.mode === 'hinge' && pts[k + 1] >= -p.ry) continue;
        const [wx, wy] = toWorld(p, c, s, pts[k], pts[k + 1]);
        const x = Math.floor(wx), y = Math.floor(wy);
        if (!blocking(x, y)) {
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          // (in water: see soak)
          if ((mat[y * W + x] & ID_MASK) === M.WATER) { if (wet < WET_MAX) { wetAt[wet * 2] = x; wetAt[wet * 2 + 1] = y; } wet += 1; }
          // Whatever stands in the open where it passes is swept away: trees and bushes are
          // knocked down, lamps, railings and furniture smashed.
          if (PW.getLayer(world, 'deco', x, y) && PW.getOwner(world, x, y) !== p.owner) sweep(x, y, p.flora ? 1 : 8);
          continue;
        }
        // (something it was in already before this sub-step - rubble come to lie where the piece
        // is - is not struck anew: loose stuff is pushed out of its way, and it moves on out of
        // anything else)
        const ox = was.px + pts[k] * c0 - pts[k + 1] * s0, oy = was.py + pts[k] * s0 + pts[k + 1] * c0;
        const inside = Math.floor(ox) === x && Math.floor(oy) === y;
        // Loose debris is ploughed aside by a swinging or fast piece rather than landed on.
        if (phase[mat[y * W + x] & ID_MASK] === PW.PHASE.POWDER && (inside || p.mode === 'hinge' || Math.hypot(...velocityAt(p, wx, wy)) > 70)) {
          const byte = mat[y * W + x];
          PW.set(world, x, y, M.AIR);
          const [vx, vy] = velocityAt(p, wx, wy);
          particles.spawn(x + 0.5, y + 0.5, vx * 0.6 + (random() - 0.5) * 60, Math.min(vy, 0) * 0.4 - 20 - random() * 40, byte, 0, F.LAND, 5);
          continue;
        }
        const own = p.owner && PW.getOwner(world, x, y) === p.owner;
        // (only above its building's floor: the cores and footings in the ground stay)
        const grinds = !p.flora && (p.mode === 'hinge' || p.mode === 'drop') && y < p.base && (mat[y * W + x] & ID_MASK) !== M.CORE;
        if (grinds && (own || (y >= p.yf - 1 && y <= p.yf + 8 && !PW.mat.terrain[mat[y * W + x] & ID_MASK]))) {
          crush(x, y, p.owner);
          crushed += 1;
          continue;
        }
        // A heavy piece coming down hard goes through a building's walls and floors that are
        // weaker than the blow: they are crushed under it (a falling tower flattens the house it
        // falls on; a chunk of rubble only dents it).
        const id = mat[y * W + x] & ID_MASK;
        if (!p.flora && structural[id] && !PW.mat.terrain[id] && id !== M.CORE && !inside) {
          const [vx, vy] = velocityAt(p, wx, wy);
          if (hardness[id] < Math.hypot(vx, vy) / 300 * Math.min(1, p.mass / 3000)) { crush(x, y, PW.getOwner(world, x, y)); smashed += 1; continue; }
        }
        if (p.mode === 'hinge' && PW.mat.terrain[mat[y * W + x] & ID_MASK] && y >= p.yf && Math.abs(x - p.hx) < 6) continue;   // seated on its pivot
        // (a building leaning over presses its foot into the ground: see eatFoot)
        if (p.mode === 'hinge' && !p.flora && pts[k + 1] > p.footV) { p.footTouch = true; continue; }
        if (inside) continue;
        if (n < OUTLINE_MAX) { went[n * 2] = wx - ox; went[n * 2 + 1] = wy - oy; }
        n += 1; sx += wx; sy += wy; hs += hardness[mat[y * W + x] & ID_MASK];
        if (wx < bx0) bx0 = wx; if (wx > bx1) bx1 = wx; if (wy < by0) by0 = wy; if (wy > by1) by1 = wy;
        // (which way the surface it struck faces there - out through its open sides - and, less,
        // the other way from the side of the piece that struck it)
        let gx = 0, gy = 0;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && !blocking(x + dx, y + dy)) { gx += dx; gy += dy; }
        const gl = Math.hypot(gx, gy);
        if (gl > 0) { fx += gx / gl; fy += gy / gl; }
        fx -= (faces[k] * c - faces[k + 1] * s) * 0.5; fy -= (faces[k] * s + faces[k + 1] * c) * 0.5;
      }
      if (crushed && p.mode === 'hinge') p.omega *= Math.max(0.9, 1 - crushed * 0.001);   // crushing the stump slows the swing
      if (smashed) { const f = Math.max(0.85, 1 - smashed * 3 / p.mass); p.vx *= f; p.vy *= f; p.omega *= f; stats.smashed = (stats.smashed || 0) + smashed; }
      if (crushed && p.mode === 'drop') {
        // Grinding down through its own floors: it slows a little at each, and the air and dust
        // under it blast out of its sides, low and wide.
        p.vy *= Math.max(0.85, 1 - crushed * 0.0015);
        const [, by] = toWorld(p, c, s, 0, p.v0 + p.gh);
        const footY = Math.min(H - 2, Math.round(by));
        if ((p.crushedRows += 1) % 4 === 0) {
          const [lx] = toWorld(p, c, s, p.u0, 0), [rx] = toWorld(p, c, s, p.u0 + p.gw, 0);
          blowOut(Math.min(lx, rx), Math.max(lx, rx), footY, Math.max(60, p.vy), 0.4);
        }
      }
      if (wet && !p.flora) soak(p, wet, pts.length / 2, h);
      if (!n) { p.jam = 0; return false; }
      wentN = Math.min(n, OUTLINE_MAX);
      return strike(p, sx / n, sy / n, fx / n, fy / n, hs / n, Math.hypot(bx1 - bx0, by1 - by0));
    }
    // (how far each point that struck something moved this sub-step)
    const went = new Float32Array(OUTLINE_MAX * 2);
    let wentN = 0;
    // (where its outline is in water)
    const WET_MAX = 64, wetAt = new Int32Array(WET_MAX * 2);
    // In water a piece is held back by the water it pushes aside - the more of it is in, the more
    // - and where it comes in fast the water splashes up and out round it.
    function soak(p, wet, outline, h) {
      const share = Math.min(1, wet / Math.max(1, outline));
      const k = Math.max(0, 1 - share * 5 * h);
      if (p.mode !== 'hinge') { p.vx *= k; p.vy *= k; }
      p.omega *= k;
      if (p.splashed) return;
      p.splashed = true;
      const speed = motion(p);
      if (speed < 40) return;
      // (the water at the surface over where it came in is thrown up: it falls back as water)
      const count = Math.min(400, Math.round(speed * Math.min(wet, WET_MAX) / 6));
      for (let q = 0; q < count; q += 1) {
        const w = Math.floor(random() * Math.min(wet, WET_MAX));
        const x = wetAt[w * 2] + Math.round((random() - 0.5) * 6);
        let y = wetAt[w * 2 + 1];
        if (x < 1 || x >= W - 1) continue;
        while (y > 1 && (mat[(y - 1) * W + x] & ID_MASK) === M.WATER) y -= 1;
        if ((mat[y * W + x] & ID_MASK) !== M.WATER) continue;
        PW.set(world, x, y, M.AIR);
        particles.spawn(x + 0.5, y - 0.5, p.vx * 0.3 + (random() - 0.5) * speed * 0.8, -speed * (0.3 + random() * 0.6), M.WATER, 0, F.WATER, 6);
      }
      stats.splashes = (stats.splashes || 0) + 1;
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

    function sweep(x, y, power = 8) {
      // (a falling piece of a building is heavy: it breaks branches and trunks it passes through;
      // a falling tree only the twigs)
      if (PW.flora && PW.flora.strike(world, particles, x, y, power)) { stats.swept = (stats.swept || 0) + 1; return; }
      // (the fitting's building checks what is left of its fittings: a gate's beam without its posts)
      const owner = PW.getOwner(world, x, y);
      if (owner > 0 && owner < 50000 && world.onDamage) world.onDamage(owner, 0, x, y);
      const color = PW.getLayer(world, 'deco', x, y);
      PW.setLayer(world, 'deco', x, y, 0);
      if (PW.streetProps) PW.streetProps.struck(world, x, y);
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
        if (random() < 0.6) particles.spawn(x + 0.5, y - 0.5, vx * 0.3 + (random() - 0.5) * (80 + r * 20), -50 - random() * (60 + r * 15), breaksTo[id] || M.LOOSE_SOIL, 0, F.LAND, 5);
        stats.dented = (stats.dented || 0) + 1;
      }
    }

    // ---- Striking -------------------------------------------------------------------------------
    // Where a piece strikes something the two push on each other at the point where they touch,
    // as one solid body against the world: a push that stops it going on into what it struck (it
    // bounces back a little) and friction along it. So it bounces, slides, or turns over that point
    // - a tower tipping onto the ground keeps on over until it lies on its side. A hard enough blow
    // breaks off the corner or edge that took it, thrown on the way the piece was going, and a
    // harder one cracks the piece right through into chunks that go on from where they were, each
    // with its own part of the motion: it breaks apart as it comes down, part by part, never all at
    // once.
    // What it strikes decides how hard the blow is: rock and concrete give nothing, so the piece
    // takes all of it - it breaks more, and what breaks off bounces away fast and far; soil and sand
    // give way under it (they are dented and thrown up instead), and a rubble heap softens the
    // landing most. (The blow is the speed it struck at times 0.55 + the struck ground's hardness.)
    const BOUNCE = 0.12;          // share of its speed into what it struck that it bounces back with
    const FRICTION = 0.7;
    const REST_SPEED = 16;        // cells/s: slower than this, and touching, it is coming to rest
    const CRUMBLE_SPEED = 45;     // a blow harder than this breaks the corner that took it...
    const SPLIT_SPEED = 80;       // ...and harder than this (and more for each time it broke before)
                                  // cracks it right through,
    const MAX_CRACKS = 3;         // ...this many times at most: the last chunks stay whole, as ruins
    const SNAP_SPEED = 30;        // a long piece landing across something narrow (a ridge, a rock, a
    const SNAP_SLENDER = 2.2;     // building's corner) snaps over it, if it is this many times as
                                  // long as it is thick
    const MAX_AGE = 24;
    // (wx, wy): the middle of where it touches; (fx, fy): which way, all told, what it struck
    // pushes back on it there; hard: how hard that is (the element table's hardness); spread: how
    // far apart the places it touches are.
    function strike(p, wx, wy, fx, fy, hard = 0.5, spread = 0) {
      const hx = Math.floor(wx), hy = Math.floor(wy);
      const [vx, vy] = velocityAt(p, wx, wy);
      // A big piece coming straight down into its own footprint sinks into it storey by storey.
      if (p.mode === 'drop' && p.mass >= SPLIT_MIN * 4 && Math.abs(vx) < Math.abs(vy) * 0.6 && Math.abs(p.angle) < 0.6) { sink(p, vx, vy, wx, wy, hx, hy); return true; }
      // From now on it moves free, about whatever it rests on or strikes (made over first if its
      // foot was crushed away).
      if (p.mode === 'hinge') {
        if (p.eaten) { p.px = was.px; p.py = was.py; p.angle = was.angle; return rebuild(p); }
        const [cx, cy] = centre(p); [p.vx, p.vy] = velocityAt(p, cx, cy);
      }
      p.mode = 'fly';
      p.touched = p.age;
      const fl = Math.hypot(fx, fy);
      const [nx, ny] = fl > 0.3 ? [fx / fl, fy / fl] : normalAt(hx, hy, vx, vy);
      const hit = -(vx * nx + vy * ny);
      if (hit <= 0) return false;            // (touching it, but already moving off it)
      // (it does not sink into what it struck: it is put back out, the way that faces, as far as
      // it went in this sub-step - going on turning and sliding as it was)
      let depth = 0;
      for (let q = 0; q < wentN; q += 1) depth = Math.max(depth, -(went[q * 2] * nx + went[q * 2 + 1] * ny));
      p.px += nx * Math.min(depth, 3); p.py += ny * Math.min(depth, 3);
      // (held fast where it is, sub-step after sub-step, getting nowhere - wedged: it stops there)
      const [cx, cy] = centre(p);
      p.jam = (p.jam || 0) + 1;
      if (p.jam === 1) { p.jamX = cx; p.jamY = cy; }
      else if (p.jam % 240 === 0) {
        if (Math.hypot(cx - p.jamX, cy - p.jamY) < 3) { p.vx = 0; p.vy = 0; p.omega = 0; return false; }
        p.jamX = cx; p.jamY = cy;
      }
      const rx = wx - cx, ry = wy - cy;
      const invM = 1 / p.mass, invI = 1 / Math.max(1, p.inertia);
      const rn = rx * ny - ry * nx;
      const firm = 0.55 + hard, felt = hit * firm;
      const j = (1 + (felt > CRUMBLE_SPEED ? BOUNCE * (0.4 + hard * 1.2) : 0)) * hit / (invM + rn * rn * invI);
      const tx = -ny, ty = nx, vt = vx * tx + vy * ty, rt = rx * ty - ry * tx;
      const fwd = Math.sign(vt) || (random() < 0.5 ? 1 : -1);
      // A hollow piece - a building, mostly air - folds up where it lands, like a box (see crumple).
      if (p.hollow > HOLLOW && felt >= FOLD_SPEED && p.mass >= SPLIT_MIN && p.crumpled !== world.tick) {
        blow(hx, hy, vx, vy, hit, j * hit, tx * fwd, ty * fwd, Math.abs(vt), hard);
        if (crumple(p, wx, wy, nx, ny, felt, spread, vt)) return true;
      }
      const jt = Math.max(-FRICTION * j, Math.min(FRICTION * j, -vt / (invM + rt * rt * invI)));
      const ix = j * nx + jt * tx, iy = j * ny + jt * ty;
      p.vx += ix * invM; p.vy += iy * invM;
      p.omega += (rx * iy - ry * ix) * invI;
      // (a falling tree or bough rolls and slides over what it strikes until it lies still - see
      // finish - and breaks nothing: one tree coming down does not set off the next)
      if (p.flora) { p.omega *= 0.7; p.vx *= 0.92; p.vy *= 0.92; return false; }
      if (felt < SNAP_SPEED) return false;
      // A blow: what it struck feels it, and the piece breaks where it took it.
      if (felt >= CRUMBLE_SPEED && p.crumpled !== world.tick) blow(hx, hy, vx, vy, hit, j * hit, tx * fwd, ty * fwd, Math.abs(vt), hard);
      return breaks(p, wx, wy, vx, vy, nx, ny, felt, hard, spread);
    }
    // A building is a box of thin floors and walls round open rooms. Where it lands hard, the rooms
    // nearest the blow give way - their floors and walls fold in, bursting out of the sides of the
    // fold as rubble and dust - and the rest of it comes on into the room they left, slowed but
    // still going, to give way again: it collapses storey by storey wherever and however it lands
    // (the harder, the more at once), never bouncing off whole like a block. (False when nothing
    // was there to fold.)
    const HOLLOW = 0.25;          // a piece at least this much room (back wall) to frame folds up,
    const FOLD_SPEED = 30;        // under a blow harder than this - up to a storey at a time
    function crumple(p, wx, wy, nx, ny, felt, spread, vt) {
      const [c, s] = cosSin(p);
      const band = Math.max(4, Math.min(40, felt / 6 * (0.3 + p.hollow)));
      const lateral = spread / 2 + band * 2 + 8;
      const tx = -ny, ty = nx;
      const d = p.data, n = d.x.length;
      const folded = [], rest = [];
      let lost = 0;
      for (let k = 0; k < n; k += 1) {
        const [x, y] = toWorld(p, c, s, d.x[k] - p.ox0 + 0.5, d.y[k] - p.oy0 + 0.5);
        const ex = x - wx, ey = y - wy;
        // (how high above what it struck, and how far along it; the fold is ragged)
        const h = ex * nx + ey * ny, a = ex * tx + ey * ty;
        const edge = band + ((PW.hash2(d.x[k] >> 2, d.y[k] >> 2) & 7) - 3.5) * 0.6;
        if (h < edge && Math.abs(a) < lateral) { folded.push(k); lost += weightOf(d.solid[k]); } else rest.push(k);
      }
      if (lost < 4 || !rest.length) return false;
      const go = (40 + felt * 0.8);
      for (const k of folded) {
        const [x, y] = toWorld(p, c, s, d.x[k] - p.ox0 + 0.5, d.y[k] - p.oy0 + 0.5);
        if (!d.solid[k]) { if ((k & 15) === 0) puff(x, y, 1); continue; }
        if (!rubbleFrom(d.solid[k], d.x[k], d.y[k])) { if ((k & 3) === 0) puff(x, y, 1); continue; }
        // (out of whichever side of the fold it is nearer, low along what it struck)
        const a = (x - wx) * tx + (y - wy) * ty, side = Math.sign(a) || (random() < 0.5 ? 1 : -1);
        const out = side * go * (0.3 + random() * 0.9) + vt * 0.5, up = 15 + random() * 45;
        particles.spawn(x, y, tx * out + nx * up, ty * out + ny * up, debrisOf(d.byte[k]), d.color[k] || 0, F.LAND | F.DAMAGE, 6);
        stats.folded = (stats.folded || 0) + 1;
      }
      // The air in the rooms that folded is driven out of both sides, with their dust.
      for (const side of [-1, 1]) {
        const ex = wx + tx * side * lateral, ey = wy + ty * side * lateral;
        jet(ex, ey - 2, Math.round(10 + Math.min(80, folded.length / 30)), tx * side * go, ty * side * go - 15, 0.4);
        if (world.air) world.air.gust(ex + tx * side * 12, ey - 6, 24, tx * side * go * 0.8, ty * side * go * 0.8 - 10);
      }
      if (folded.length > 400) smoulder(wx, wy, 24 + Math.min(30, folded.length / 300), 20 + Math.sqrt(folded.length) * 0.6);
      // What is left comes on into the space, slowed by as much as the folding took up: the more
      // of its frame folded, the more of its speed into what it struck is spent.
      const piece = spawn({ data: pick(d, rest), parent: p, inherit: true, owner: p.owner, from: p.from, generation: p.generation, h0: p.h0, floor: p.yf, base: p.base, sunk: p.sunk });
      if (piece) {
        const vn = piece.vx * nx + piece.vy * ny, spent = Math.min(0.65, lost / p.mass * 2.5);
        if (vn < 0) { piece.vx -= nx * vn * spent; piece.vy -= ny * vn * spent; }
        piece.omega *= 0.85;
        piece.crumpled = world.tick;
      }
      stats.crumples = (stats.crumples || 0) + 1;
      return true;
    }
    // Which way the surface at (x, y) faces: away from the solid cells about it (deep inside
    // something, back the way the piece came).
    function normalAt(x, y, vx, vy) {
      let gx = 0, gy = 0;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) if ((dx || dy) && blocking(x + dx, y + dy)) { gx -= dx; gy -= dy; }
      const len = Math.hypot(gx, gy);
      if (len > 0.5) return [gx / len, gy / len];
      const v = Math.hypot(vx, vy) || 1;
      return [-vx / v, -vy / v];
    }
    // What a piece strikes at (hx, hy) feels the blow (`energy`: the push times the speed it
    // stopped): the ground is dented and shaken, and looked at for what lost its footing; a struck
    // building gives way around the point of impact. Dust is driven out along the ground the way the
    // piece was going (fx, fy, at `along`), and a big blow leaves the rubble smouldering.
    function blow(hx, hy, vx, vy, hit, energy, fx, fy, along, hard = 0.5) {
      stats.shattered += 1;
      const speed = hit;
      // (soft ground takes the blow in a dent, its clods thrown up; rock hardly)
      if (PW.mat.terrain[mat[hy * W + hx] & ID_MASK]) dent(hx, hy, energy * Math.max(0.1, 1.3 - hard * 1.5), vx);
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
      const dust = Math.min(1400, Math.round(energy / 30000));
      if (dust > 4) {
        puff(hx, hy - 2, Math.round(dust * 0.4), 10 + Math.sqrt(dust) * 1.5, 4 + Math.sqrt(dust) * 0.4);
        const go = Math.max(50, along * 0.7 + hit * 0.3);
        jet(hx, hy - 2, Math.round(dust * 0.5), fx * go, fy * go - 20, 0.6);
        if (world.air) world.air.gust(hx + fx * 20, hy - 10, 30 + Math.sqrt(dust) * 2, fx * go, -15);
      }
      if (energy > 4e7) smoulder(hx, hy, 24 + Math.min(36, energy / 4e6), 20 + Math.sqrt(energy) / 600);
    }
    // The piece took a blow at (wx, wy), going (vx, vy) into a surface facing (nx, ny), felt as
    // `felt` (see BOUNCE): the corner or edge there crumbles - its cells thrown off along the
    // surface the way the piece was going, and up off it, faster and farther off hard ground - and
    // a hard enough blow cracks the rest right through, along jagged lines, into chunks. A long
    // piece that lands across something narrow snaps over it. (False when nothing came of it.)
    function breaks(p, wx, wy, vx, vy, nx, ny, felt, hard = 0.5, spread = 0) {
      const [c, s] = cosSin(p);
      // (the point struck, in the piece's own cells)
      const dx = wx - p.px, dy = wy - p.py;
      const lu = dx * c + dy * s, lv = -dx * s + dy * c;
      const { grid, gw, gh, u0, v0, data } = p;
      const gone = new Uint8Array(data.x.length);
      let lost = 0;
      // (a hollow piece - thin walls round its rooms - gives way the more readily)
      if (felt >= CRUMBLE_SPEED) {
        const r = Math.min(14, (2 + (felt - CRUMBLE_SPEED) / 22) * (1 + p.hollow * 0.6));
        for (let v = Math.floor(lv - r); v <= lv + r; v += 1) for (let u = Math.floor(lu - r); u <= lu + r; u += 1) {
          if (u < u0 || v < v0 || u >= u0 + gw || v >= v0 + gh || (u + 0.5 - lu) ** 2 + (v + 0.5 - lv) ** 2 > r * r) continue;
          const g = grid[(v - v0) * gw + (u - u0)];
          if (!g || (PW.hash3(u, v, p.generation) & 3) === 0) continue;    // (raggedly)
          gone[g - 1] = 1; lost += 1;
        }
      }
      const room = p.mass >= SPLIT_MIN && list.length < MAX_PIECES - 4;
      const cracks = room && felt > (SPLIT_SPEED + p.generation * 45) * (1 - p.hollow * 0.35) && p.generation < MAX_CRACKS;
      // (snaps: long for its thickness, struck at one narrow place away from its ends)
      const long = gw >= gh ? gw : gh, thick = gw >= gh ? gh : gw;
      const along = gw >= gh ? (lu - u0) / gw : (lv - v0) / gh;
      const snaps = room && !cracks && p.generation <= MAX_CRACKS && long >= thick * SNAP_SLENDER && spread < long * 0.25 && along > 0.18 && along < 0.82;
      if (!lost && !cracks && !snaps) return false;
      // What crumbles off is thrown along the surface the way the piece was going and bounces up
      // off it - off rock fast and far, off soft ground barely.
      const tx = -ny, ty = nx, vt = vx * tx + vy * ty;
      const kick = 0.3 + hard * 1.2;
      for (let k = 0; k < gone.length; k += 1) {
        if (!gone[k]) continue;
        const [x, y] = toWorld(p, c, s, data.x[k] - p.ox0 + 0.5, data.y[k] - p.oy0 + 0.5);
        if (!rubbleFrom(data.solid[k], data.x[k], data.y[k])) { if ((k & 3) === 0) puff(x, y, 1); continue; }
        const f = 0.4 + random() * 0.8, up = felt * kick * (0.1 + random() * 0.35);
        const side = (random() - 0.5) * (40 + 120 * hard);
        particles.spawn(x, y, tx * (vt * f + side) + nx * up, ty * (vt * f + side) + ny * up - random() * 20, debrisOf(data.byte[k]), data.color[k] || 0, F.LAND | F.DAMAGE, 6);
        stats.crumbled = (stats.crumbled || 0) + 1;
      }
      // (and dust with it, the same way)
      if (lost) jet(wx, wy - 1, Math.round(lost / 2), tx * vt * 0.6 + nx * felt * 0.15, ty * vt * 0.6 + ny * felt * 0.15 - 10, 0.8);
      const ks = [];
      for (let k = 0; k < gone.length; k += 1) if (!gone[k]) ks.push(k);
      if (cracks) breakUp(p, ks, Math.max(14, Math.min(64, Math.sqrt(p.mass) / 2.6)), 1);
      else if (snaps) snap(p, ks, gw >= gh, gw >= gh ? lu : lv);
      else spawn({ data: pick(data, ks), parent: p, inherit: true, owner: p.owner, from: p.from, generation: p.generation, h0: p.h0, floor: p.yf, base: p.base });
      return true;
    }
    // A long piece snaps across where it struck (at `at` along its long side - its own u if `wide`,
    // else v): a jagged crack right across it, a band of it crumbling there, and the two halves go
    // on each with its own part of the motion - the one hanging over falls on round the break.
    function snap(p, ks, wide, at) {
      const d = p.data, [c, s] = cosSin(p);
      const a = [], b = [];
      for (const k of ks) {
        const u = d.x[k] - p.ox0, v = d.y[k] - p.oy0;
        const along = wide ? u : v, across = wide ? v : u;
        const line = at + ((PW.hash2(Math.floor(across / 3), p.generation + 11) & 7) - 3.5);
        if (Math.abs(along - line) < 1.5 && d.solid[k]) {
          // (the crack itself crumbles)
          const [x, y] = toWorld(p, c, s, u + 0.5, v + 0.5);
          if ((k & 1) === 0 && rubbleFrom(d.solid[k], d.x[k], d.y[k])) particles.spawn(x, y, (random() - 0.5) * 60, -20 - random() * 40, debrisOf(d.byte[k]), d.color[k] || 0, F.LAND, 6);
          else if ((k & 7) === 1) puff(x, y, 1);
          continue;
        }
        (along < line ? a : b).push(k);
      }
      for (const part of [a, b]) if (part.length) spawn({ data: pick(d, part), parent: p, inherit: true, owner: 0, from: p.from || p.owner, h0: p.h0, generation: p.generation + 1 });
      stats.snapped = (stats.snapped || 0) + 1;
    }
    // A big piece coming straight down into its own footprint does not burst all at once: only its
    // bottom storey or so is crushed where it strikes, bursting out of its sides, and the rest
    // comes on down into it, slowed, to be crushed in turn - it sinks into its own rubble, breaking
    // apart as it goes. What is left of it at last (its top floors) settles on the heap in a few big
    // chunks that come to rest, misplaced, as ruins.
    function sink(p, vx, vy, wx, wy, hx, hy) {
      const [c, s] = cosSin(p);
      const speed = Math.hypot(vx, vy);
      if (p.sunk >= 3 && (speed < 50 || p.gh < p.h0 * 0.45)) {
        const all = [];
        for (let k = 0; k < p.data.x.length; k += 1) all.push(k);
        breakUp(p, all, 30 + random() * 14, 0.4);
        puff(hx, hy - 2, Math.min(600, Math.round(Math.sqrt(p.mass) * 4)), 30 + Math.sqrt(p.mass), 12);
        return;
      }
      const placed = place(p, p.data, c, s);
      let lowest = -Infinity;
      for (let j = 0; j < placed.x.length; j += 1) if (placed.solid[j]) lowest = Math.max(lowest, placed.y[j]);
      // (a few rows at a time, each crushed band bursting out of its sides as it goes - the
      // harder it comes down, the harder)
      const band = Math.max(6, Math.round(p.gh * 0.05));
      const crushedKs = [], restKs = [];
      for (let j = 0; j < placed.x.length; j += 1) (placed.y[j] >= lowest - band ? crushedKs : restKs).push(j);
      const [mid] = centre(p);
      scatter(pick(placed, crushedKs), vx * 0.3, 0, 0, mid, wy, 0.45, undefined, undefined, undefined, Math.min(2.2, 0.6 + speed / 220));
      let restMass = 0;
      for (const k of restKs) if (p.data.solid[k]) restMass += 1;
      if (restMass >= CHUNK_MIN) {
        spawn({ data: pick(p.data, restKs), parent: p, owner: p.owner, from: p.from, vx: vx * 0.4, vy: Math.max(30, vy * 0.65), omega: p.omega * 0.5,
          drop: true, floor: p.yf, base: p.base, generation: p.generation, sunk: p.sunk + 1, h0: p.h0 });
        stats.crushSteps = (stats.crushSteps || 0) + 1;
      } else if (restKs.length) settle(pick(placed, restKs), vx, vy);
      // The air under it is driven out of its sides: dust and grit blast out low and wide.
      let x0 = Infinity, x1 = -Infinity;
      for (const k of crushedKs) if (placed.solid[k]) { if (placed.x[k] < x0) x0 = placed.x[k]; if (placed.x[k] > x1) x1 = placed.x[k]; }
      if (x1 >= x0) blowOut(x0, x1, Math.round(wy), speed, 1);
      puff(hx, hy - 2, Math.min(900, Math.round(band * Math.sqrt(p.mass) / 2)), 30 + Math.sqrt(p.mass) * 1.2, 10 + band);
      if (world.stability) world.stability.shock(hx, hy, crushedKs.length * speed * speed / 40);
      // (the crushed storeys smoulder in the heap)
      if (crushedKs.length > 400) smoulder(hx, hy, 24 + Math.min(30, crushedKs.length / 300), 20 + Math.sqrt(crushedKs.length) * 0.6);
    }
    // A floor coming down drives the air out from under it: dust and grit blast out of both its
    // sides (x0..x1) at row y, low along the ground - the faster it comes down, the harder.
    function blowOut(x0, x1, y, speed, k) {
      const go = Math.min(420, 80 + speed * 1.3);
      for (const [ex, dir] of [[x0 - 3, -1], [x1 + 3, 1]]) {
        jet(ex, y - 3, Math.round((10 + speed / 8) * k), dir * go, -go * 0.08, 0.35);
        puff(ex + dir * 6, y - 4, Math.round(12 * k), 10, 5);
        if (world.air) world.air.gust(ex + dir * 16, y - 8, 24, dir * go * 0.8, -go * 0.05);
      }
    }
    // Dust thrown out as grains going about (vx, vy) (give or take `spread` of that): they slow in
    // the air and settle into the cloud where they stop.
    function jet(x, y, count, vx, vy, spread) {
      const v = Math.hypot(vx, vy);
      for (let k = 0; k < count; k += 1) {
        const f = 0.4 + random() * 0.8;
        particles.spawn(x + (random() - 0.5) * 6, y - random() * 4, vx * f + (random() - 0.5) * v * spread, vy * f + (random() - 0.5) * v * spread * 0.4,
          M.DUST | (2 + (random() < 0.5 ? 1 : 0)) << 6, 0, F.LAND, 0.25 + random() * 0.6);
        stats.dust += 1;
      }
    }
    // (rubble smouldering at (x, y): one patch for the heap, however many pieces came down on it)
    function smoulder(x, y, seconds, width) {
      if (!PW.addSmoulder) return;
      for (const s of world.smoulders || []) {
        if (Math.abs(s.x - x) < 60 && Math.abs(s.y - y) < 60) { s.left = Math.max(s.left, seconds); s.life = Math.max(s.life, seconds); s.width = Math.max(s.width, width); return; }
      }
      PW.addSmoulder(world, x, y, seconds, width);
    }
    // Break a piece into chunks about S across (of its cells `ks`) along jagged lines - running
    // along its own courses, as built - each going on from just where it was, turned as it was,
    // with the motion of its own part of the piece and a little more (`kick`). (Fewer, bigger
    // chunks when there are many pieces about already.)
    function breakUp(p, ks, S, kick) {
      const d = p.data;
      const jag = (a, b) => (PW.hash2(Math.floor(a / 3), b) & 7) - 3.5;
      let groups = null;
      for (let tries = 0; tries < 4; tries += 1, S *= 1.5) {
        groups = new Map();
        for (const k of ks) {
          const key = Math.floor((d.x[k] + jag(d.y[k], 1)) / S) * 4096 + Math.floor((d.y[k] + jag(d.x[k], 2)) / S);
          let g = groups.get(key);
          if (!g) { g = []; groups.set(key, g); }
          g.push(k);
        }
        if (list.length + groups.size <= MAX_PIECES) break;
      }
      for (const g of groups.values()) {
        spawn({ data: pick(d, g), parent: p, inherit: true, owner: 0, from: p.from || p.owner, h0: p.h0, generation: p.generation + 1,
          vx: (random() - 0.5) * 30 * kick, vy: (random() - 0.5) * 20 * kick, omega: (random() - 0.5) * 0.8 * kick });
        stats.chunks += 1;
      }
      // (dust bursts from the cracks)
      const [c, s] = cosSin(p);
      for (let q = 0; q < Math.min(60, ks.length / 40); q += 1) {
        const k = ks[Math.floor(random() * ks.length)];
        const [x, y] = toWorld(p, c, s, d.x[k] - p.ox0 + 0.5, d.y[k] - p.oy0 + 0.5);
        puff(x, y, 2, 3, 2);
      }
    }
    // A piece come to rest whole: its structure and walls stay where they lie as ruin, keeping the
    // building's colours (a little dulled with dust), cracked at its edges - glass shatters and
    // the ragged edge and anything left with no room crumble off as debris. It is part of the
    // ground now: what it leaves hanging breaks loose, and the town's builders will clear it.
    const ruinTone = (color, x, y) => {
      const c = PW.unpack(color), k = 0.8 + (PW.hash2(x, y) & 15) / 100;
      return PW.abgr(c[0] * k + 10, c[1] * k + 9, c[2] * k + 8);
    };
    function ruin(p, c, s) {
      // (the world cells it covers as it lies: each takes the piece's cell found by turning back
      // through its rotation, as it is drawn - a tilted ruin has no gaps)
      const { grid, gw, gh, u0, v0, data } = p;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const [u, v] of [[u0, v0], [u0 + gw, v0], [u0, v0 + gh], [u0 + gw, v0 + gh]]) {
        const [wx, wy] = toWorld(p, c, s, u, v);
        bx0 = Math.min(bx0, wx); bx1 = Math.max(bx1, wx); by0 = Math.min(by0, wy); by1 = Math.max(by1, wy);
      }
      bx0 = Math.max(1, Math.floor(bx0)); by0 = Math.max(1, Math.floor(by0)); bx1 = Math.min(W - 2, Math.ceil(bx1)); by1 = Math.min(H - 2, Math.ceil(by1));
      const at = [], here = new Set();
      for (let y = by0; y <= by1; y += 1) for (let x = bx0; x <= bx1; x += 1) {
        const ux = x + 0.5 - p.px, uy = y + 0.5 - p.py;
        const u = Math.floor(ux * c + uy * s) - u0, v = Math.floor(-ux * s + uy * c) - v0;
        if (u < 0 || v < 0 || u >= gw || v >= gh) continue;
        const g = grid[v * gw + u];
        if (!g) continue;
        at.push(y * W + x, g - 1);
        if (data.solid[g - 1] === 1) here.add(y * W + x);
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cells = 0;
      for (let q = 0; q < at.length; q += 2) {
        const i = at[q], j = at[q + 1], x = i % W, y = (i / W) | 0;
        if (!data.solid[j]) { if ((q & 31) === 0) puff(x, y, 1); continue; }
        // (its rooms stay open: the back wall behind them stays as a wall, dulled with dust)
        if (data.solid[j] === THIN) {
          if ((mat[i] & ID_MASK) === M.AIR && data.color[j]) PW.setLayer(world, 'back', x, y, ruinTone(data.color[j], x, y));
          continue;
        }
        const byte = data.byte[j];
        const edge = !here.has(i - 1) || !here.has(i + 1) || !here.has(i - W) || !here.has(i + W);
        const room = !blocking(x, y);
        if ((byte & ID_MASK) === M.GLASS || !room || (edge && (PW.hash2(x, y) & 3) === 0)) {
          if (rubbleFrom(data.solid[j], x, y)) particles.spawn(x + 0.5, y - 0.5, (random() - 0.5) * 60, -20 - random() * 40, debrisOf(byte), data.color[j] || 0, F.LAND, 6);
          else if ((q & 7) === 0) puff(x, y, 1);
          continue;
        }
        put(x, y, M.RUIN | (PW.hash2(x, y) & 3) << 6);
        if (data.color[j]) PW.setLayer(world, 'paint', x, y, ruinTone(data.color[j], x, y));
        cells += 1;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (!cells) return;
      (world.ruins || (world.ruins = [])).push({ from: p.from || p.owner, x0, y0, x1, y1, cells });
      stats.ruins = (stats.ruins || 0) + cells;
      if (world.stability) world.stability.disturb(x0, y0, x1, y1);
    }
    // (a cell of rubble or ruin put down where water is: the water is pushed up out of its way, to
    // the surface - never lost)
    function put(x, y, byte) {
      if ((mat[y * W + x] & ID_MASK) === M.WATER) particles.spawn(x + 0.5, y + 0.5, 0, -30, M.WATER, 0, F.WATER, 6);
      PW.set(world, x, y, byte);
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
    // (burst: thrown out sideways, low, away from (cx, cy), this hard - a storey crushed under the
    // weight above it bursts out of its sides rather than up)
    function scatter(data, vx, vy, omega, cx, cy, thrown, p, c, s, burst = 0) {
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
        if (!rubbleFrom(data.solid[k], data.x[k], data.y[k])) { if ((k & 3) === 0) puff(x, y, 1); continue; }
        const byte = debrisOf(data.byte[k]);
        if (random() < thrown) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (burst) particles.spawn(x + 0.5, y - 0.5, Math.sign(dx || random() - 0.5) * (60 + random() * 180) * burst + vx * 0.3, -10 - random() * 45 * burst, byte, data.color[k] || 0, F.LAND | F.DAMAGE, 6);
          else particles.spawn(x + 0.5, y - 0.5, vx * 0.5 - omega * dy * 0.5 + (random() - 0.5) * 160, -Math.abs(vy) * 0.3 - random() * 120 + omega * dx * 0.2, byte, 0, F.LAND | F.DAMAGE, 6);
        } else if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !blocking(x, y) && support.get(x) - y <= HEAP) {
          put(x, y, byte);
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
