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
// A plant's piece is its wood and leaves: its limbs bend where they strike something and spring
// back, its branches snap off as pieces of their own, and the air tears its leaves off.
// Pieces are drawn by re-sampling onto the cell grid: cells are never rotated as pixels.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, structural, hardness, breaksTo, palettes } = PW.mat;

  const RELEASE = 0.95;       // a hinging piece swings free after this much rotation (radians)
  const SPLIT_MIN = 300;      // pieces at least this big can crack into chunks
  const CHUNK_MIN = 36;       // chunks smaller than this turn straight into debris
  const MAX_PIECES = 100;
  const OUTLINE_MAX = 720;    // contact points tested per sub-step
  const GHOSTS = 0.15;        // share of its outline over cells no longer there before it is made over,
  const RESHAPE_EVERY = 0.2;  // ...no oftener than this (s)
  const RESHAPE_LOST = 0.005; // share of its weight lost (any way) before it is made over, in case it hangs in parts now
  const BIG_REMAKE = 2000;    // frame cells: pieces this big are made over one a tick at most
  const PARTS_EVERY = 0.25;   // s: how often a piece losing cells is looked at for hanging in parts
  const PARTS_NOW = 20000;    // grid cells: a piece's box bigger than this is looked at the tick after it is made
  // A piece (or a chunk of one) at least RUIN_MIN cells big comes to rest whole where it lands -
  // tilted, misplaced, cracked at its edges - as a ruin, part of the ground.
  const RUIN_MIN = 60;
  const RUIN_CRACK = 2500;    // a building's piece of more frame than this comes to rest cracked into several
  // (the hitbox debug view: a blow this hard, cells/s, shows red; it fades at HIT_FADE per second)
  const HIT_FULL = 300, HIT_FADE = 1.2;
  const touched = new Int32Array(480);   // (the outline points touching in a contact test - debug view only)
  let nTouched = 0, lastFelt = 0;
  const FLORA_MIN = 14;       // a piece of a plant with less wood than this comes apart as it falls
  // A building is mostly air. Its weight and strength are in its frame - pillars, floors, outer
  // walls; a cell of back wall (marked THIN in a piece) is a light panel behind its rooms: it goes
  // along with the frame, weighing THIN_WEIGHT of a frame cell, strikes nothing, and broken up only
  // one in WALL_RUBBLE of them leaves a grain of rubble (the rest goes to dust).
  const THIN = 2, THIN_WEIGHT = 0.1, WALL_RUBBLE = 3;
  // A building coming down bursts outward: what gives way under its weight is squeezed out of its
  // sides, low and wide, not thrown up. SPILL scales how far out (sideways speed) rubble from its
  // crushed storeys and its breaking pieces is thrown; LOFT how much of it goes up.
  const SPILL = 2, LOFT = 0.55;
  const weightOf = (solid) => (solid === 1 ? 1 : solid === THIN ? THIN_WEIGHT : 0);
  // (a plant's wood cells weighted by the girth of the stem each hangs from, over the mean, so
  // they weigh as many cells in all)
  function girthWeights(solid, girth) {
    const n = solid.length, wt = new Float32Array(n);
    let sum = 0, count = 0;
    for (let k = 0; k < n; k += 1) if (solid[k]) { wt[k] = Math.max(1, girth[k]); sum += wt[k]; count += 1; }
    if (sum) for (let k = 0; k < n; k += 1) wt[k] *= count / sum;
    return wt;
  }
  // A building going up (b.growing: being built or repaired) holds against falling pieces lighter
  // than this (frame cells) - rubble, a chunk of wall - but not against the top of a building.
  const GROW_HEAVY = 3000;

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
    // (a cell of a piece broken up: does it leave rubble? Structure does; back wall comes away in
    // panels - whole patches of it, one in WALL_RUBBLE, breaking off as chunks with the building -
    // the rest goes up as a little dust)
    const rubbleFrom = (solid, x, y) => solid === 1 || (solid === THIN && (PW.hash2(((x | 0) + (Math.imul(y >> 1, 0x9e3779b1) >>> 30)) / 5 | 0, (y | 0) / 5 | 0) % WALL_RUBBLE) === 0);
    // (of what is crushed or ground off, the half that bursts out as debris - rather than dropping
    // where it was, or going to dust - is a block at a time, BURST_W x BURST_H cells, so it holds
    // together as chunks)
    const BURST_W = 8, BURST_H = 4;
    const bursts = (x, y, salt) => (PW.hash3(Math.floor(x / BURST_W), Math.floor(y / BURST_H), salt) & 3) < 2;
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
        // (its ground and frame are cleared to air straight in the grid too, and what has to be
        // kept in step with that - the sky line, the light, the drawing - is done once a column
        // or a chunk, after: what PW.set does a cell)
        const { CHUNK_SHIFT, CHUNK_MASK } = PW, groundTop = world.groundTop, chunksX = world.chunksX, cells = spec.cells;
        const BACK = world.back, DECO = world.deco, PAINT = world.paint, OWNER = world.owner, terrain = PW.mat.terrain, POWDER = PW.PHASE.POWDER;
        const DX = data.x, DY = data.y, DC = data.color, DB = data.byte, DS = data.solid;
        const touched = new Set(), shaded = new Set(), skyline = [];
        // (the chunk's layers, kept while the cells run on in the same chunk)
        let lastChunk = -1, lastShaded = -1, backs = null, decos = null, paints = null, owners = null;
        for (let q = 0; q < n; q += 1) {
          const i = cells[q], y = (i / W) | 0, x = i - y * W;
          const c = (y >> CHUNK_SHIFT) * chunksX + (x >> CHUNK_SHIFT), l = (y & CHUNK_MASK) << CHUNK_SHIFT | (x & CHUNK_MASK);
          if (c !== lastChunk) { backs = BACK[c]; decos = DECO[c]; paints = PAINT[c]; owners = OWNER[c]; touched.add(c); lastChunk = c; }
          const m = mat[i], id = m & ID_MASK;
          // (a core is held where it is by its own field, as the bedrock is by the earth: no piece
          // ever carries it off - what falls breaks away around it)
          if (id === M.CORE) { stats.coreSpared = (stats.coreSpared || 0) + 1; continue; }
          const back = backs ? backs[l] : 0, deco = decos ? decos[l] : 0;
          // A building's back wall is part of its frame: it has weight and it strikes what it
          // falls on. But it is a thin panel: broken up, it leaves far less rubble than the
          // pillars, floors and outer walls (THIN, see wallBits).
          const heavy = phase[id] >= POWDER;
          const wall = !heavy && back !== 0 && spec.owner && owners && owners[l] === spec.owner;
          const solid = heavy || wall;
          // (ground keeps the look it had in the world: its strata, its depth, its grain)
          const paint = heavy ? ((paints && paints[l]) || (world.colorAt && terrain[id] ? world.colorAt(x, y) : palettes[id][(m >> 6) * 2 + (PW.hash2(x, y) & 1)])) : 0;
          const color = deco || paint || back;
          if (!color && !solid) continue;
          DX[k] = x; DY[k] = y; DC[k] = color; DB[k] = wall ? M.DEBRIS : solid ? m : 0; DS[k] = heavy ? 1 : wall ? THIN : 0;
          k += 1;
          if (heavy) {
            mat[i] = M.AIR;
            if (paints) paints[l] = 0;
            if (groundTop[x] === y) skyline.push(x);
            if (c !== lastShaded) { shaded.add(c); lastShaded = c; }
          }
          if (backs) backs[l] = 0;
          if (decos) decos[l] = 0;
          if (owners) owners[l] = 0;
        }
        // Re-raster every chunk the piece left (both layers, its whole area).
        for (const c of touched) {
          const cx = (c % world.chunksX) << CHUNK_SHIFT, cy = ((c / world.chunksX) | 0) << CHUNK_SHIFT, e = (1 << CHUNK_SHIFT) - 1;
          PW.markDirty(world, cx, cy, PW.DIRTY_BASE | PW.DIRTY_DECO);
          PW.markDirty(world, cx + e, cy + e, PW.DIRTY_BASE | PW.DIRTY_DECO);
          if (shaded.has(c)) PW.shapeChanged(world, cx, cy);
        }
        // (a column whose top it took: its sky line goes down to what is left under it)
        for (const x of skyline) PW.touchGroundTop(world, x, groundTop[x], M.AIR);
        for (const key of ['x', 'y', 'color', 'byte', 'solid', 'girth']) if (data[key]) data[key] = data[key].slice(0, k);
      }
      const n = data.x.length, X = data.x, Y = data.y, SOL = data.solid;
      // (its weight is in its frame: a back wall weighs little - see THIN. A plant's is in its
      // wood, the more the thicker the stem: a cell across a stem g thick stands for g of its
      // round cross-section, so its trunk and foot weigh far more, cell for cell, than its twigs -
      // in all as much as its wood cells, spread by girth)
      const wt = spec.flora && data.girth ? girthWeights(SOL, data.girth) : null;
      const wOf = wt ? (k) => wt[k] : (k) => weightOf(SOL[k]);
      let mass = 0, heavy = 0, thin = 0, sx = 0, sy = 0;
      for (let k = 0; k < n; k += 1) {
        const w = wOf(k);
        if (!w) continue;
        mass += w; sx += (X[k] + 0.5) * w; sy += (Y[k] + 0.5) * w;
        if (SOL[k] === 1) heavy += 1; else thin += 1;
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
      let cx = sx / mass, cy = sy / mass;
      const ax = Math.floor(cx), ay = Math.floor(cy);
      // Local grid around the anchor cell (ax, ay), for drawing and contact.
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (let k = 0; k < n; k += 1) { const u = X[k] - ax, v = Y[k] - ay; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
      const gw = u1 - u0 + 1, gh = v1 - v0 + 1, N = gw * gh;
      const grid = new Int32Array(N);
      for (let k = 0; k < n; k += 1) grid[(Y[k] - ay - v0) * gw + (X[k] - ax - u0)] = k + 1;
      // A piece is what hangs together. Cells of it not joined to the rest - a chunk cut across a
      // room, what crushing or grinding has left either side of a gap - are pieces of their own,
      // each going its own way: what has come apart is never one body. (A plant comes apart by
      // branch instead: see PW.flora.splitPiece.)
      // (its greatest part goes on as this piece; the others are pieces of their own, made from
      // their cells - none of it is copied over again but them)
      // (a great one is looked at on the ticks after, one a tick, not in the moment it breaks away
      // with everything else - see step)
      const partsLater = !spec.flora && !spec.pivot && !spec.flex && !spec.joined && N > PARTS_NOW;
      if (!spec.flora && !spec.pivot && !spec.flex && !spec.joined && !partsLater) {
        const parts = partsOf(grid, gw, gh, SOL);
        if (parts) {
          const weights = parts.map((ks) => { let w = 0; for (const k of ks) w += wOf(k); return w; });
          let main = 0;
          for (let q = 1; q < parts.length; q += 1) if (weights[q] > weights[main]) main = q;
          if (weights[main] < CHUNK_MIN) {
            for (const ks of parts) spawn({ ...spec, cells: null, data: pick(data, ks), joined: true });
            stats.parted = (stats.parted || 0) + parts.length;
            return null;
          }
          for (let q = 0; q < parts.length; q += 1) {
            if (q === main) continue;
            spawn({ ...spec, cells: null, data: pick(data, parts[q]), joined: true });
            for (const k of parts[q]) { grid[(Y[k] - ay - v0) * gw + (X[k] - ax - u0)] = 0; SOL[k] = 0; data.color[k] = 0; }
          }
          stats.parted = (stats.parted || 0) + parts.length - 1;
          mass = 0; sx = 0; sy = 0;
          for (const k of parts[main]) { const w = wOf(k); if (!w) continue; mass += w; sx += (X[k] + 0.5) * w; sy += (Y[k] + 0.5) * w; }
          cx = sx / mass; cy = sy / mass;
        }
      }
      // (a plant's piece is one body of wood too: wood with a gap in it - a bough lifted across a
      // fork, a twig cut short - goes as a piece for each part of it, its leaves with them)
      if (spec.flora && !spec.pivot && !spec.flex && !spec.joined) {
        const parts = partsOf(grid, gw, gh, SOL);
        if (parts) {
          for (const ks of parts) spawn({ ...spec, cells: null, data: pick(data, ks), joined: true });
          stats.parted = (stats.parted || 0) + parts.length;
          return null;
        }
      }
      // What it strikes with is its frame - pillars, floors, outer walls (a tree's wood). A
      // building is mostly air: its rooms are open, the back wall only a panel behind them, so
      // what it falls on can come into its rooms (and a piece hollow enough breaks up the easier).
      // (a building's piece is tens of thousands of cells, made over again as it is crushed: all
      // of this is flat arrays, read by grid index)
      let inertia = 0;
      const gcx = cx - ax, gcy = cy - ay;
      for (let k = 0; k < n; k += 1) {
        const wgt = wOf(k);
        if (!wgt) continue;
        inertia += wgt * ((X[k] - ax + 0.5 - gcx) ** 2 + (Y[k] - ay + 0.5 - gcy) ** 2);
      }
      // (a great piece of a building just lifted out of the world waits a tick before it moves -
      // see below - and has its outline made then, when it first needs it: it is drawn from its
      // grid)
      const waits = !spec.data && !spec.flora && N > PARTS_NOW;
      const outline = waits ? NO_OUTLINE : outlineOf(grid, gw, gh, u0, v0, data, ax, ay), { points, faces, ptCell } = outline;
      // data.x/y are world cells as they were when the piece was formed, (ox0, oy0) its anchor
      // cell then; (px, py) is where that anchor's corner is now.
      const piece = { data, n, mass, inertia, grid, gw, gh, u0, v0, points, faces, ptCell, owner: spec.owner || 0, from: spec.from || spec.owner || 0, generation: spec.generation || 0,
        ox0: ax, oy0: ay, px: ax, py: ay, gx: cx - ax, gy: cy - ay, angle: 0, omega: spec.omega || 0, vx: spec.vx || 0, vy: spec.vy || 0,
        mode: spec.flex ? 'flex' : spec.pivot ? 'hinge' : spec.drop ? 'drop' : 'fly', dir: spec.dir || 1, age: 0, flora: !!spec.flora, wreck: !!spec.wreck,
        spring: spec.flex ? spec.flex.spring : 0, damp: spec.flex ? spec.flex.damp : 0,
        yf: spec.pivot ? spec.pivot.y : spec.floor || 0, crushedRows: 0, base: spec.base ?? H, h0: spec.h0 || gh, still: 0, touched: -1, sunk: spec.sunk || 0,
        hollow: heavy + thin ? thin / (heavy + thin) : 0, shapeMass: mass, partsDue: partsLater, frame: outline.frame || 0,
        // (a great piece of a building just lifted out of the world starts to move on the tick
        // after: the lifting is the work of a tick in itself)
        waits, outlineDue: waits };
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
      if (piece.flora) plantOf(piece);
      if (!parent) pushed(piece);
      list.push(piece);
      stats.spawned += 1;
      return piece;
    }

    // A piece's outline: its frame cells with an open side (where it touches the world first), and
    // which way each faces (out through its open sides), and the cell of its grid under each (one
    // ground off, crushed or shaken loose is no longer there to strike with - see contact). Its
    // outer faces are tested closely, the faces of its rooms more sparsely. (A building's piece is
    // tens of thousands of cells, its outline made again as it crumbles: flat arrays, kept and
    // reused, read by grid index.)
    const OUT = { frame: new Uint8Array(0), outside: new Uint8Array(0), fill: new Int32Array(0), outer: new Int32Array(0), inner: new Int32Array(0) };
    // (an outline still to be made: see spawn)
    const NO_OUTLINE = { points: new Float32Array(0), faces: new Float32Array(0), ptCell: new Int32Array(0) };
    function outlineOf(grid, gw, gh, u0, v0, data, ax, ay) {
      const N = gw * gh, n = data.x.length, X = data.x, Y = data.y, SOL = data.solid;
      if (OUT.frame.length < N) { OUT.frame = new Uint8Array(N); OUT.outside = new Uint8Array(N); OUT.fill = new Int32Array(N); }
      if (OUT.outer.length < n) { OUT.outer = new Int32Array(n); OUT.inner = new Int32Array(n); }
      const { frame, outside, fill, outer, inner } = OUT;
      frame.fill(0, 0, N); outside.fill(0, 0, N);
      for (let g = 0; g < N; g += 1) if (grid[g] && SOL[grid[g] - 1] === 1) frame[g] = 1;
      // (the open space outside it: everything not frame reached from the edges of its box)
      let tail = 0;
      for (let gu = 0; gu < gw; gu += 1) for (const g of [gu, N - gw + gu]) if (!frame[g] && !outside[g]) { outside[g] = 1; fill[tail++] = g; }
      for (let gv = 1; gv < gh - 1; gv += 1) for (const g of [gv * gw, gv * gw + gw - 1]) if (!frame[g] && !outside[g]) { outside[g] = 1; fill[tail++] = g; }
      for (let q = 0; q < tail; q += 1) {
        const g = fill[q], gu = g % gw;
        if (gu > 0 && !frame[g - 1] && !outside[g - 1]) { outside[g - 1] = 1; fill[tail++] = g - 1; }
        if (gu < gw - 1 && !frame[g + 1] && !outside[g + 1]) { outside[g + 1] = 1; fill[tail++] = g + 1; }
        if (g >= gw && !frame[g - gw] && !outside[g - gw]) { outside[g - gw] = 1; fill[tail++] = g - gw; }
        if (g < N - gw && !frame[g + gw] && !outside[g + gw]) { outside[g + gw] = 1; fill[tail++] = g + gw; }
      }
      // (each kept as cell index and which of its sides are frame - left 1, right 2, top 4, bottom 8)
      // (and how many cells of frame it has, all told: see the step)
      let outers = 0, inners = 0, frameCells = 0;
      for (let k = 0; k < n; k += 1) {
        if (SOL[k] !== 1) continue;
        const u = X[k] - ax, v = Y[k] - ay, gu = u - u0, gv = v - v0, g = gv * gw + gu;
        if (grid[g] !== k + 1) continue;
        frameCells += 1;
        const l = gu > 0 && frame[g - 1] === 1, r = gu < gw - 1 && frame[g + 1] === 1;
        const t = gv > 0 && frame[g - gw] === 1, b = gv < gh - 1 && frame[g + gw] === 1;
        if (l && r && t && b) continue;
        const out = (!l && (gu === 0 || outside[g - 1] === 1)) || (!r && (gu === gw - 1 || outside[g + 1] === 1))
          || (!t && (gv === 0 || outside[g - gw] === 1)) || (!b && (gv === gh - 1 || outside[g + gw] === 1));
        const e = k << 4 | (l ? 1 : 0) | (r ? 2 : 0) | (t ? 4 : 0) | (b ? 8 : 0);
        if (out) outer[outers++] = e; else inner[inners++] = e;
      }
      const picked = [];
      for (const [set, count, share] of [[outer, outers, 0.75], [inner, inners, 0.25]]) {
        const stride = Math.max(1, Math.ceil(count / (OUTLINE_MAX * share)));
        for (let q = 0; q < count; q += stride) {
          const e = set[q], k = e >> 4;
          picked.push(X[k] - ax + 0.5, Y[k] - ay + 0.5, (e & 1 ? 0 : -1) + (e & 2 ? 0 : 1), (e & 4 ? 0 : -1) + (e & 8 ? 0 : 1));
        }
      }
      const points = new Float32Array(picked.length / 2), faces = new Float32Array(picked.length / 2);
      const ptCell = new Int32Array(picked.length / 4);
      for (let k = 0, j = 0; k < picked.length; k += 4, j += 2) {
        points[j] = picked[k]; points[j + 1] = picked[k + 1];
        const len = Math.hypot(picked[k + 2], picked[k + 3]) || 1;
        faces[j] = picked[k + 2] / len; faces[j + 1] = picked[k + 3] / len;
        ptCell[j >> 1] = (Math.floor(points[j + 1]) - v0) * gw + (Math.floor(points[j]) - u0);
      }
      return { points, faces, ptCell, frame: frameCells };
    }
    // (a piece that has lost cells: its outline made again from what is left of it, where it is -
    // the hitbox debug view's strike marks start afresh)
    function reoutline(p) {
      const o = outlineOf(p.grid, p.gw, p.gh, p.u0, p.v0, p.data, p.ox0, p.oy0);
      p.points = o.points; p.faces = o.faces; p.ptCell = o.ptCell; p.hitV = null;
      p.frame = o.frame;
      p.outlinedAt = time;
      stats.reoutlined = (stats.reoutlined || 0) + 1;
    }
    // (the separate parts of a piece - each a list of its cells' indices - or null when it is all
    // one. Its frame and its back wall hold it together, cell to cell, corners too; a fitting or a
    // lick of paint holds nothing, and goes with the part it is on)
    const PART_LABEL = { buf: new Int32Array(0), queue: new Int32Array(0) };
    // (is it all one? Its frame's runs along each row - unbroken stretches of it - each joined to
    // the runs it touches in the row above, corners too: most often it hangs together, and that
    // is all there is to know - a cell read each, not a search round every cell)
    const RUNS = { x0: new Int32Array(0), x1: new Int32Array(0), root: new Int32Array(0) };
    function onePart(grid, gw, gh, solid) {
      const most = ((gw + 1) >> 1) * gh + 1;
      if (RUNS.x0.length < most) { RUNS.x0 = new Int32Array(most); RUNS.x1 = new Int32Array(most); RUNS.root = new Int32Array(most); }
      const { x0, x1, root } = RUNS;
      const find = (r) => { while (root[r] !== r) { root[r] = root[root[r]]; r = root[r]; } return r; };
      let n = 0, parts = 0, prev = 0, prevEnd = 0;
      for (let v = 0, g = 0; v < gh; v += 1) {
        const start = n;
        let p = prev;
        for (let u = 0; u < gw; u += 1, g += 1) {
          if (!grid[g] || !solid[grid[g] - 1]) continue;
          const a = u;
          while (u + 1 < gw && grid[g + 1] && solid[grid[g + 1] - 1]) { u += 1; g += 1; }
          x0[n] = a; x1[n] = u; root[n] = n; parts += 1;
          // (the runs above it that reach from a - 1 to u + 1)
          while (p < prevEnd && x1[p] < a - 1) p += 1;
          for (let q = p; q < prevEnd && x0[q] <= u + 1; q += 1) {
            const ra = find(q), rb = find(n);
            if (ra !== rb) { root[rb] = ra; parts -= 1; }
          }
          n += 1;
        }
        prev = start; prevEnd = n;
      }
      return parts <= 1;
    }
    function partsOf(grid, gw, gh, solid) {
      if (onePart(grid, gw, gh, solid)) return null;
      const N = gw * gh;
      if (PART_LABEL.buf.length < N) { PART_LABEL.buf = new Int32Array(N); PART_LABEL.queue = new Int32Array(N); }
      const lab = PART_LABEL.buf, queue = PART_LABEL.queue;
      lab.fill(0, 0, N);
      let parts = 0;
      const flood = (head, tail, holds) => {
        while (head < tail) {
          const g = queue[head++], u = g % gw, v = (g / gw) | 0;
          for (let dv = -1; dv <= 1; dv += 1) for (let du = -1; du <= 1; du += 1) {
            const nu = u + du, nv = v + dv;
            if ((!du && !dv) || nu < 0 || nv < 0 || nu >= gw || nv >= gh) continue;
            const j = nv * gw + nu, k = grid[j] - 1;
            if (k >= 0 && !lab[j] && (!holds || solid[k])) { lab[j] = lab[g]; queue[tail++] = j; }
          }
        }
        return tail;
      };
      for (let g0 = 0; g0 < N; g0 += 1) {
        const k = grid[g0] - 1;
        if (k < 0 || lab[g0] || !solid[k]) continue;
        parts += 1;
        queue[0] = g0; lab[g0] = parts;
        flood(0, 1, true);
      }
      if (parts <= 1) return null;
      // (the fittings and paint: each patch of them goes with the part it touches - or the first,
      // touching none)
      for (let g0 = 0; g0 < N; g0 += 1) {
        if (!grid[g0] || lab[g0]) continue;
        let head = 0, tail = 0, label = 0;
        queue[tail++] = g0; lab[g0] = -1;
        while (head < tail) {
          const g = queue[head++], u = g % gw, v = (g / gw) | 0;
          for (let dv = -1; dv <= 1; dv += 1) for (let du = -1; du <= 1; du += 1) {
            const nu = u + du, nv = v + dv;
            if ((!du && !dv) || nu < 0 || nv < 0 || nu >= gw || nv >= gh) continue;
            const j = nv * gw + nu;
            if (!grid[j]) continue;
            if (lab[j] > 0) { if (!label) label = lab[j]; } else if (!lab[j]) { lab[j] = -1; queue[tail++] = j; }
          }
        }
        for (let q = 0; q < tail; q += 1) lab[queue[q]] = label || 1;
      }
      const lists = Array.from({ length: parts }, () => []);
      for (let g = 0; g < N; g += 1) if (grid[g]) lists[(lab[g] || 1) - 1].push(grid[g] - 1);
      return lists;
    }
    // A falling piece of a building comes apart as it goes, not one block until it lands: what is
    // barely held at its edges - a cell with few of its neighbours left in it, the more readily
    // the weaker its stuff (glass, timber, brick before concrete) - is shaken loose as it falls
    // and turns, the more the faster it turns and the harder it was struck, and goes on by itself
    // as rubble. So it crumbles a pixel at a time from the moment it breaks loose, and the faces it
    // is left with are worked at in their turn (its outline is made over as it goes: see contact).
    const SHED = 2;               // per second: an edge cell held by one neighbour comes loose, falling still
    const SHED_SPIN = 1.5;        // ...times more for each 10 cells/s its far edge swings about its middle
    const SHED_SHAKE = 8;         // ...at most this many times more
    const SHED_EVERY = 3;         // ticks between looks at a piece's edges (each for that long)
    function shed(p, dt) {
      // (a vehicle's wreck is welded armour: nothing comes loose of it as it flies)
      if (p.wreck) return;
      const { grid, gw, gh, data, ptCell } = p;
      const [c, s] = cosSin(p);
      const spin = Math.abs(p.omega) * Math.hypot(gw, gh) / 2;
      const blow = (p.feltV || 0) * Math.exp(-(p.age - (p.feltAt || 0)) * 3);
      const shake = Math.min(SHED_SHAKE, 1 + spin / 10 * SHED_SPIN + blow / 60);
      let lost = 0, n = 0;
      for (let j = 0; j < ptCell.length; j += 1) {
        const g = ptCell[j], k = grid[g] - 1;
        if (k < 0 || data.solid[k] !== 1) continue;
        const gu = g % gw, gv = (g / gw) | 0;
        let held = 0;
        for (let dv = -1; dv <= 1; dv += 1) for (let du = -1; du <= 1; du += 1) {
          const nu = gu + du, nv = gv + dv;
          if ((du || dv) && nu >= 0 && nv >= 0 && nu < gw && nv < gh && grid[nv * gw + nu]) held += 1;
        }
        const loose = (8 - held) / 8;
        if (random() >= SHED * loose * loose * shake / (0.25 + hardness[data.byte[k] & ID_MASK]) * dt) continue;
        const [x, y] = toWorld(p, c, s, data.x[k] - p.ox0 + 0.5, data.y[k] - p.oy0 + 0.5);
        const [vx, vy] = velocityAt(p, x, y);
        particles.spawn(x, y, vx + (random() - 0.5) * 24, vy + (random() - 0.5) * 24, debrisOf(data.byte[k]), data.color[k] || 0, F.LAND | F.DAMAGE, 6);
        lost += weightOf(data.solid[k]);
        grid[g] = 0; data.solid[k] = 0; data.color[k] = 0;
        n += 1;
      }
      if (!n) return;
      p.mass = Math.max(1, p.mass - lost);
      p.frame = Math.max(0, (p.frame ?? n) - n);
      stats.shed = (stats.shed || 0) + n;
    }
    // A falling plant's wood holds only as much as its girth lets it. Where it strikes something,
    // the wood that took the blow - the thinnest it struck with - bears its share of it; if that is
    // more than the wood can bear (its strength goes with the girth of the stem it hangs from,
    // cubed: a twig hardly anything, a limb a good deal), that branch snaps off there, with its
    // leaves, and falls on by itself (a twig comes apart: see spawn) - and the plant comes on down
    // past it. Its trunk (a bough's thickest wood) never snaps. So a light bough rests on its
    // twigs, but a whole tree crashing down breaks up the crown it lands on and comes to lie on its
    // trunk and stoutest limbs, not standing propped on its branch tips. And the air takes hold of
    // all of it, leaves and all (see airDrag).
    // Kept per outline point: its cell in the piece's grid and the girth of its stem; and the
    // plant's trunk girth, and its size and middle, all of it, for the air.
    const RIGID = 0.65;           // wood this share of the plant's thickest (or 2 cells) never snaps
    const WOOD_BLOW = 1500;       // the blow (weight x cells/s) wood a cell thick takes, x girth^3,
    const WOOD_LOAD = 10000;      // ...and the weight (x cells/s^2) it bears
    const SNAPS_PER_TICK = 3;     // branches a plant breaks off at most a tick
    const WOOD_DEBRIS = M.DEBRIS | PW.DEBRIS_KIND.WOOD << 6;
    const LEAF_REACH = 6;         // a branch that snaps off takes the leaves this near it,
    const SNAP_REACH = 10, SNAP_REACH_GIRTH = 5;   // ...and its wood this far (+ per cell of girth)
    const FLORA_SPIN = 2.5;       // rad/s: a plant striking something turns no faster than this,
    const FLORA_DRAG = 1.5;       // ...and its turning slowed this much (per second) while it touches
    function plantOf(p) {
      const { data, grid, gw, u0, v0, points } = p, girth = data.girth;
      const count = points.length / 2;
      p.ptCell = new Int32Array(count); p.ptGirth = new Uint8Array(count);
      let most = 1;
      if (girth) {
        // (its thickest wood: the girth a twentieth of its wood is at least - its trunk, not the
        // flare of its roots)
        const hist = new Int32Array(16);
        let wood = 0;
        for (let k = 0; k < p.n; k += 1) if (data.solid[k]) { hist[Math.min(15, girth[k])] += 1; wood += 1; }
        for (let g = 15, sum = 0; g >= 1; g -= 1) { sum += hist[g]; if (sum >= wood * 0.05) { most = g; break; } }
      }
      p.rigidGirth = Math.min(most, Math.max(2, Math.ceil(most * RIGID)));
      for (let j = 0; j < points.length; j += 2) {
        const gi = (Math.floor(points[j + 1]) - v0) * gw + (Math.floor(points[j]) - u0);
        p.ptCell[j >> 1] = gi;
        p.ptGirth[j >> 1] = girth ? girth[grid[gi] - 1] || 1 : most;
      }
      let au = 0, av = 0;
      for (let k = 0; k < p.n; k += 1) { au += data.x[k] - p.ox0 + 0.5; av += data.y[k] - p.oy0 + 0.5; }
      p.area = p.n; p.au = au / p.n; p.av = av / p.n;
    }
    // The branch of a plant at outline point k snaps off: its wood out from there no thicker than
    // it there, and its leaves (those near it, not nearer other wood), go on as a piece of their
    // own, moving as they were; the plant goes on without them - and, if that leaves it in parts,
    // each part goes on as a piece of its own (see remake). (False if there was nothing to break
    // off.)
    function snapBranch(p, k) {
      const { grid, gw, gh, data } = p, girth = data.girth;
      if (p.snapTick !== world.tick) { p.snapTick = world.tick; p.snaps = 0; }
      if (p.snaps >= SNAPS_PER_TICK) return false;
      const start = p.ptCell[k >> 1];
      if (!grid[start]) return false;
      const g0 = girth[grid[start] - 1];
      const mine = new Uint8Array(gw * gh), cells = [start];
      mine[start] = 1;
      const each = (gi, visit) => {
        const gu = gi % gw, gv = (gi / gw) | 0;
        for (let dv = -1; dv <= 1; dv += 1) {
          for (let du = -1; du <= 1; du += 1) {
            const nu = gu + du, nv = gv + dv;
            if ((du || dv) && nu >= 0 && nv >= 0 && nu < gw && nv < gh) visit(nv * gw + nu);
          }
        }
      };
      // (the end of it that struck: what is joined to it out to a reach that goes with its girth -
      // a crown's twigs all cross one another, so not all that is joined to it)
      const su = start % gw, sv = (start / gw) | 0, reach2 = (SNAP_REACH + SNAP_REACH_GIRTH * g0) ** 2;
      for (let q = 0; q < cells.length; q += 1) {
        each(cells[q], (ni) => {
          const c = grid[ni];
          if (mine[ni] || !c || data.solid[c - 1] !== 1 || girth[c - 1] > g0) return;
          if ((ni % gw - su) ** 2 + (((ni / gw) | 0) - sv) ** 2 > reach2) return;
          mine[ni] = 1; cells.push(ni);
        });
      }
      const wood = cells.length;
      // (its leaves: out from its wood, a cell at a time, through leaves not touching other wood)
      let ring = cells.slice();
      for (let d = 0; d < LEAF_REACH && ring.length; d += 1) {
        const next = [];
        for (const gi of ring) {
          each(gi, (ni) => {
            const c = grid[ni];
            if (mine[ni] || !c || data.solid[c - 1] || !data.color[c - 1]) return;
            let other = false;
            each(ni, (mi) => { const e = grid[mi]; if (e && data.solid[e - 1] === 1 && !mine[mi]) other = true; });
            if (other) return;
            mine[ni] = 1; next.push(ni); cells.push(ni);
          });
        }
        ring = next;
      }
      // (it goes on by itself from where it broke, moving as it was there - its own weight, its own
      // outline: what it strikes it strikes, apart from the plant; a twig comes apart - see spawn.
      // Splinters fly from the break)
      const ks = cells.map((gi) => grid[gi] - 1);
      const [c, s] = cosSin(p);
      if (spawn({ data: pick(data, ks), parent: p, inherit: true, flora: true, generation: p.generation + 1 })) stats.brokeOff = (stats.brokeOff || 0) + 1;
      const [bx, by] = toWorld(p, c, s, p.points[k], p.points[k + 1]), [vx] = velocityAt(p, bx, by);
      for (let q = Math.min(6, 1 + (wood >> 3)); q > 0; q -= 1) {
        const j = ks[Math.floor(random() * Math.min(wood, ks.length))];
        particles.spawn(bx, by - 1, vx * 0.3 + (random() - 0.5) * 80, -30 - random() * 60, WOOD_DEBRIS, data.color[j] || 0, F.LAND, 6);
      }
      for (const gi of cells) { const q = grid[gi] - 1; data.solid[q] = 0; data.color[q] = 0; grid[gi] = 0; }
      p.mass = Math.max(1, p.mass - wood);
      p.snaps += 1;
      p.reshape = true;
      stats.snapped = (stats.snapped || 0) + 1;
      return true;
    }
    // A plant that lost branches is made over at the end of the tick, where it is: what no longer
    // hangs together, wood to wood, comes apart - its greatest part goes on as it is, the others
    // each a piece of its own, with the leaves nearest them, moving as that part of it was (leaves
    // left with no wood at all flutter down) - and what is left has its weight, its middle and its
    // outline made again, going on just as it was, its limbs still bent and springing as they were.
    // (True when nothing of it is left.)
    function remake(p) {
      p.reshape = false;
      const { data, grid, gw, gh } = p;
      const kind = new Uint8Array(gw * gh), shown = new Uint8Array(data.x.length);
      for (let g = 0; g < kind.length; g += 1) { const k = grid[g] - 1; if (k >= 0 && (data.solid[k] || data.color[k])) { kind[g] = data.solid[k] ? 1 : 2; shown[k] = 1; } }
      const [c, s] = cosSin(p);
      const drop = (k) => {
        const [x, y] = toWorld(p, c, s, data.x[k] - p.ox0 + 0.5, data.y[k] - p.oy0 + 0.5);
        PW.flora.shed(particles, x, y, data.color[k], p.vx, p.vy, false, null);
        const g = cellOf(p, data.x[k], data.y[k]);
        if (g >= 0 && grid[g] === k + 1) grid[g] = 0;
        data.solid[k] = 0; data.color[k] = 0;
      };
      // (a cell of a limb bent in over the plant's other cells - see bendLimb - is shaken off it)
      for (let k = 0; k < data.x.length; k += 1) if (!shown[k] && (data.solid[k] || data.color[k])) drop(k);
      const { parts, loose } = PW.flora.splitPiece(kind, gw, gh, false);
      for (const g of loose) drop(grid[g] - 1);
      if (!parts.length) return true;
      let main = 0, most = -1;
      parts.forEach((part, q) => { let w = 0; for (const g of part) if (kind[g] === 1) w += 1; if (w > most) { most = w; main = q; } });
      for (let q = 0; q < parts.length; q += 1) {
        if (q === main) continue;
        const ks = parts[q].map((g) => grid[g] - 1);
        const kid = spawn({ data: pick(data, ks), parent: p, inherit: true, flora: true, generation: p.generation, dir: p.dir, base: p.base });
        if (kid) Object.assign(kid, { age: p.age, touched: p.touched, still: p.still, rigidGirth: Math.min(kid.rigidGirth, p.rigidGirth) });
        for (const g of parts[q]) { const k = grid[g] - 1; grid[g] = 0; data.solid[k] = 0; data.color[k] = 0; }
      }
      if (parts.length > 1) stats.parted = (stats.parted || 0) + parts.length - 1;
      reweigh(p);
      return false;
    }
    // (a plant that lost cells: its weight, its middle and how it turns, moving on as it was - and
    // its outline, made again where it is, its limbs' share of it with them)
    function reweigh(p) {
      const { data } = p, n = data.x.length, wt = girthWeights(data.solid, data.girth || data.solid);
      let mass = 0, sx = 0, sy = 0;
      for (let k = 0; k < n; k += 1) { const w = wt[k]; if (!w) continue; mass += w; sx += (data.x[k] - p.ox0 + 0.5) * w; sy += (data.y[k] - p.oy0 + 0.5) * w; }
      if (!mass) return;
      const gx = sx / mass, gy = sy / mass;
      const [c, s] = cosSin(p), [wx, wy] = toWorld(p, c, s, gx, gy), [vx, vy] = velocityAt(p, wx, wy);
      let inertia = 0;
      for (let k = 0; k < n; k += 1) { const w = wt[k]; if (w) inertia += w * ((data.x[k] - p.ox0 + 0.5 - gx) ** 2 + (data.y[k] - p.oy0 + 0.5 - gy) ** 2); }
      Object.assign(p, { mass, gx, gy, vx, vy, inertia: Math.max(1, inertia), shapeMass: mass });
      const rigid = p.rigidGirth;
      reoutline(p);
      plantOf(p);
      p.rigidGirth = rigid;
      for (const l of p.limbs || []) limbOutline(p, l);
    }
    // ---- A plant's limbs bend --------------------------------------------------------------------
    // Wood gives before it breaks. A limb of a falling plant - a branch or twig thinner than its
    // trunk and stoutest boughs (see RIGID) - that strikes something bends back about where it
    // grows from stouter wood (its joint), rather than the plant striking there: what it struck
    // holds its end, and the plant comes on, pressing it over, held back by the spring of it. It
    // bends along its length as a branch held at its root bends under a load at its end - hardly at
    // all near the joint, most at its tip - as stiff as its girth lets it (the ring of a standing
    // plant's limb swinging: see PW.flora's bend), and springs back, ringing down, once what pressed
    // it is gone. Bent as far as it goes (the less the stouter it is), it bears on the plant like the
    // rest of its wood - or, struck harder than its wood takes, it snaps (see snapBranch). Its cells
    // are moved in the piece's own grid to where it bends to (see bendLimb), so it is drawn and
    // strikes where it is, a cell at a time.
    const LIMB_MIN = 8;           // wood cells: a limb smaller than this is too slight to bend apart from its branch,
    const LIMB_CELLS = 400;       // ...and one bigger than this (a crown's twigs crossing into one another) too tangled
    const LIMBS_MAX = 24;         // limbs of a piece that bend, at most
    const LIMB_LEAVES = 6;        // a limb's leaves: those this near its wood
    const LIMB_BEND = 0.35, LIMB_BEND_THIN = 0.6;  // radians its tip bends at most: LIMB_BEND + LIMB_BEND_THIN / girth
    const LIMB_DAMP = 0.22;       // share of critical damping (a standing limb's: see PW.flora's bend)
    const LIMB_FREE = 0.1;        // s: bent all the way and pressed no longer for this long, it springs back
    const LIMB_DRAWS = 16;        // limbs moved to where they bend to in a tick, at most (the rest the tick after)
    let contacts = 0, nBent = 0, nLimbPts = 0, limbDraws = 0;
    const bent = [], limbPt = new Float32Array(OUTLINE_MAX * 3);
    // (world cell (X, Y), as the piece was formed, in its grid; -1 outside it)
    const cellOf = (p, X, Y) => {
      const gu = X - p.ox0 - p.u0, gv = Y - p.oy0 - p.v0;
      return gu < 0 || gv < 0 || gu >= p.gw || gv >= p.gh ? -1 : gv * p.gw + gu;
    };
    // (the share of its tip's bend a cell s out from the joint of a limb L long is turned by: a
    // branch held at its root, loaded at its end, is bent over its length as s^2 (3L - s))
    const bendShare = (s, L) => { const t = Math.min(1, s / L); return t * (3 - t) / 2; };
    // The limb of a plant whose wood is at its outline point j, made the first time it strikes
    // something: its wood joined to the wood there no stouter than it, out from the stouter wood it
    // grows from, with its leaves. (Null: there is none - too slight, or wood that does not bend.)
    function limbAt(p, j) {
      const { grid, gw, gh, data } = p, girth = data.girth;
      const c0 = grid[p.ptCell[j]] - 1;
      if (c0 < 0 || !girth || data.solid[c0] !== 1) return null;
      const of = p.limbOf || (p.limbOf = new Int16Array(data.x.length));
      if (of[c0]) return of[c0] > 0 ? p.limbs[of[c0] - 1] : null;
      const limbs = p.limbs || (p.limbs = []);
      if (limbs.length >= LIMBS_MAX) return null;
      const g0 = Math.max(1, girth[c0]);
      const each = (g, visit) => {
        const gu = g % gw, gv = (g / gw) | 0;
        for (let dv = -1; dv <= 1; dv += 1) for (let du = -1; du <= 1; du += 1) {
          const nu = gu + du, nv = gv + dv;
          if ((du || dv) && nu >= 0 && nv >= 0 && nu < gw && nv < gh) visit(nv * gw + nu);
        }
      };
      // (the wood joined to g no stouter than it, in no other limb, out from g a cell at a time -
      // each with the one it was reached from - and whether there was more of it than a limb's)
      const wood = (g) => {
        const cells = [g], from = [-1], seen = new Set(cells);
        for (let q = 0; q < cells.length && cells.length <= LIMB_CELLS; q += 1) {
          each(cells[q], (ni) => {
            const k = grid[ni] - 1;
            if (seen.has(ni) || k < 0 || data.solid[k] !== 1 || girth[k] > g0 || of[k]) return;
            seen.add(ni); cells.push(ni); from.push(q);
          });
        }
        return { cells, from, more: cells.length > LIMB_CELLS };
      };
      // (its joint: going along its wood from where it struck, the first cell by stouter wood - or,
      // none, the one nearest the plant's middle)
      const start = p.ptCell[j], near = wood(start);
      const mu = p.gx - p.u0, mv = p.gy - p.v0;
      let joint = -1, best = Infinity;
      for (let q = 0; q < near.cells.length && joint < 0; q += 1) {
        each(near.cells[q], (ni) => { const k = grid[ni] - 1; if (k >= 0 && data.solid[k] === 1 && girth[k] > g0) joint = near.cells[q]; });
      }
      if (joint < 0) for (const g of near.cells) { const d = (g % gw + 0.5 - mu) ** 2 + (((g / gw) | 0) + 0.5 - mv) ** 2; if (d < best) { best = d; joint = g; } }
      // (all that grows out from there: a limb bends whole - or, a crown's twigs crossing one
      // another into too much of it, none of it bends apart)
      const out = near.more ? near : wood(joint);
      if (out.more || out.cells.length < LIMB_MIN) { for (const g of near.cells) of[grid[g] - 1] = -1; return null; }
      const { cells, from } = out, nWood = cells.length;
      // (its leaves: out from its wood, a cell at a time, through leaves not touching other wood)
      const mine = new Set(cells);
      let ring = cells.slice();
      for (let d = 0; d < LIMB_LEAVES && ring.length; d += 1) {
        const next = [];
        for (const g of ring) {
          each(g, (ni) => {
            const k = grid[ni] - 1;
            if (mine.has(ni) || k < 0 || data.solid[k] || !data.color[k] || of[k]) return;
            let other = false;
            each(ni, (mi) => { const e = grid[mi] - 1; if (e >= 0 && data.solid[e] === 1 && !mine.has(mi)) other = true; });
            if (other) return;
            mine.add(ni); next.push(ni); cells.push(ni);
          });
        }
        ring = next;
      }
      const id = limbs.length + 1, n = cells.length, kj = grid[joint] - 1, jx = data.x[kj], jy = data.y[kj];
      const ks = new Int32Array(n), up = new Int32Array(n).fill(-1), rx = new Float32Array(n), ry = new Float32Array(n), f = new Float32Array(n), qOf = new Map();
      let L = 2, I = 0;
      for (let q = 0; q < n; q += 1) {
        const k = grid[cells[q]] - 1;
        ks[q] = k; rx[q] = data.x[k] - jx; ry[q] = data.y[k] - jy; of[k] = id; qOf.set(k, q);
        if (q < nWood) { up[q] = from[q]; const r2 = rx[q] * rx[q] + ry[q] * ry[q]; I += r2; L = Math.max(L, Math.sqrt(r2)); }
      }
      for (let q = 0; q < n; q += 1) f[q] = bendShare(Math.hypot(rx[q], ry[q]), L);
      const l = { id, ks, up, qOf, rx, ry, f, jx, jy, L, g0, I: Math.max(1, I), ring: Math.max(5, Math.min(16, 3 + 2.5 * g0)), max: LIMB_BEND + LIMB_BEND_THIN / g0,
        theta: 0, omega: 0, drawn: 0, stiff: false, pressedAt: 0, hitAt: -1, n: 0, sx: 0, sy: 0, fx: 0, fy: 0, k: 0 };
      limbOutline(p, l);
      limbs.push(l);
      stats.limbs = (stats.limbs || 0) + 1;
      return l;
    }
    // (a limb's points of the plant's outline, and which way each faces unbent)
    function limbOutline(p, l) {
      const pts = [], ptQ = [], fu = [], fv = [];
      for (let j = 0; j < p.ptCell.length; j += 1) {
        const k = p.grid[p.ptCell[j]] - 1;
        if (k < 0 || p.limbOf[k] !== l.id) continue;
        const q = l.qOf.get(k), a = -l.drawn * l.f[q], c = Math.cos(a), s = Math.sin(a);
        pts.push(j); ptQ.push(q); fu.push(p.faces[j * 2] * c - p.faces[j * 2 + 1] * s); fv.push(p.faces[j * 2] * s + p.faces[j * 2 + 1] * c);
      }
      Object.assign(l, { pts: Int32Array.from(pts), ptQ: Int32Array.from(ptQ), fu: Float32Array.from(fu), fv: Float32Array.from(fv) });
    }
    // (outline point k of a plant, in a cell it struck at (x, y): on a limb that bends, noted for
    // flexOn - true; on wood that does not, or a limb bent as far as it goes, it strikes as the
    // plant's wood)
    function limbHit(p, k, wx, wy, x, y) {
      const l = limbAt(p, k >> 1);
      if (!l) return false;
      if (l.stiff) { l.pressedAt = time; return false; }
      if (l.hitAt !== contacts) { l.hitAt = contacts; l.n = 0; l.sx = 0; l.sy = 0; l.fx = 0; l.fy = 0; bent[nBent++] = l; }
      // (which way the surface it struck faces there: out through its open sides - see touch)
      let gx = 0, gy = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && !blocking(x + dx, y + dy)) { gx += dx; gy += dy; }
      const gl = Math.hypot(gx, gy);
      if (gl > 0) { l.fx += gx / gl; l.fy += gy / gl; }
      l.n += 1; l.sx += wx; l.sy += wy; l.k = k;
      if (nLimbPts < OUTLINE_MAX) { const q = nLimbPts * 3; limbPt[q] = wx; limbPt[q + 1] = wy; limbPt[q + 2] = l.id; nLimbPts += 1; }
      return true;
    }
    // A limb that struck something this sub-step: what it struck stops its end going on into it -
    // the limb bends instead, and bends back out of it as far as it lies in it - and the limb,
    // bent, pushes the plant back there, as hard as the spring of it (it is light: what pushes on
    // it, it passes on). Too hard a blow snaps it.
    function flexOn(p, l, c, s, h) {
      const n = l.n, mx = l.sx / n, my = l.sy / n;
      const [jx, jy] = toWorld(p, c, s, l.jx - p.ox0 + 0.5, l.jy - p.oy0 + 0.5);
      const rx = mx - jx, ry = my - jy, share = bendShare(Math.hypot(rx, ry), l.L);
      const [bvx, bvy] = velocityAt(p, mx, my);
      const vx = bvx - l.omega * share * ry, vy = bvy + l.omega * share * rx;
      const fl = Math.hypot(l.fx, l.fy);
      const [nx, ny] = fl > 0.3 * n ? [l.fx / fl, l.fy / fl] : normalAt(Math.floor(mx), Math.floor(my), vx, vy);
      p.touched = p.age;
      // (how far a radian more of bend takes it out of what it struck; struck by its joint, it
      // cannot bend away - it bears there as the plant's wood)
      const lever = share * (rx * ny - ry * nx);
      if (Math.abs(lever) < 1) { l.stiff = true; l.pressedAt = time; return; }
      const into = -(vx * nx + vy * ny);
      if (into > 0) {
        // (the blow: its weight at its end times the speed stopped there)
        if (into * l.I / (lever * lever) > WOOD_BLOW * l.g0 ** 3 && snapBranch(p, l.k)) return;
        l.omega += into / lever;
      }
      let deep = 0;
      for (let q = 0; q < nLimbPts; q += 1) if (limbPt[q * 3 + 2] === l.id) deep = Math.max(deep, depthAt(limbPt[q * 3], limbPt[q * 3 + 1], nx, ny));
      if (deep > REST_DEPTH) l.theta += Math.min(1, deep - REST_DEPTH) / lever;
      if (Math.abs(l.theta) >= l.max) { l.theta = Math.sign(l.theta) * l.max; l.omega = 0; l.stiff = true; l.pressedAt = time; }
      const push = l.I * l.ring * l.ring * l.theta / lever * h;
      if (push <= 0) return;
      const [cx, cy] = centre(p), ax = mx - cx, ay = my - cy;
      p.vx += push * nx / p.mass; p.vy += push * ny / p.mass;
      p.omega += (ax * ny - ay * nx) * push / Math.max(1, p.inertia);
      p.omega = Math.max(-FLORA_SPIN, Math.min(FLORA_SPIN, p.omega));
    }
    // (each limb's spring brings it back, ringing down - one bent all the way stays so while it is
    // pressed there)
    function springLimbs(p, h) {
      for (const l of p.limbs) {
        if (l.stiff) { if (time - l.pressedAt > LIMB_FREE) l.stiff = false; else continue; }
        if (!l.theta && !l.omega) continue;
        l.omega += (-l.ring * l.ring * l.theta - 2 * LIMB_DAMP * l.ring * l.omega) * h;
        l.theta += l.omega * h;
        if (Math.abs(l.theta) > l.max) { l.theta = Math.sign(l.theta) * l.max; l.omega = 0; }
        if (Math.abs(l.theta) < 1e-3 && Math.abs(l.omega) < 1e-2) { l.theta = 0; l.omega = 0; }
      }
    }
    // A limb's cells moved in the piece's grid to where it is bent to (its tip moved half a cell or
    // more since): out of where they were, into where they go - never over the plant's other cells
    // (its wood over its own leaves); a cell with nowhere to go is not drawn until it has. Its wood
    // stays joined, cell to cell, out from its joint: each cell of it goes next to the one it
    // grows from, where it is nearest to where it bends to - room there first. Its outline points
    // go with its wood, turned as it is turned there. (The grid is made bigger when a limb bends
    // out of it.)
    function bendLimb(p, l) {
      const { data } = p, { ks, up, rx, ry, f } = l, n = ks.length;
      for (let q = 0; q < n; q += 1) {
        const k = ks[q], g = cellOf(p, data.x[k], data.y[k]);
        if (g >= 0 && p.grid[g] === k + 1) p.grid[g] = 0;
      }
      // (room for cell k at (X, Y): nothing there, or - for wood - a leaf, crushed under it: a bent
      // limb's wood is never left out of the plant where it swings into the crown, or it would hang
      // in two parts there)
      const room = (k, X, Y) => {
        const g = cellOf(p, X, Y), there = g < 0 ? -1 : p.grid[g] - 1;
        return there < 0 || (data.solid[k] && !data.solid[there]);
      };
      for (let q = 0; q < n; q += 1) {
        const k = ks[q];
        if (!data.solid[k] && !data.color[k]) continue;
        const a = l.theta * f[q], c = Math.cos(a), s = Math.sin(a);
        const ex = rx[q] * c - ry[q] * s, ey = rx[q] * s + ry[q] * c;
        let X = l.jx + Math.round(ex), Y = l.jy + Math.round(ey);
        const kp = up[q] >= 0 ? ks[up[q]] : -1;
        if (kp >= 0 && data.solid[kp] && (Math.abs(X - data.x[kp]) > 1 || Math.abs(Y - data.y[kp]) > 1 || !room(k, X, Y))) {
          let best = Infinity;
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const cx = data.x[kp] + dx, cy = data.y[kp] + dy;
            const d = (cx - l.jx - ex) ** 2 + (cy - l.jy - ey) ** 2 + (room(k, cx, cy) ? 0 : 100);
            if (d < best) { best = d; X = cx; Y = cy; }
          }
        }
        data.x[k] = X; data.y[k] = Y;
        let g = cellOf(p, X, Y);
        if (g < 0) { growGrid(p, X, Y); g = cellOf(p, X, Y); }
        if (room(k, X, Y)) p.grid[g] = k + 1;
      }
      const { points, faces, ptCell } = p;
      for (let q = 0; q < l.pts.length; q += 1) {
        const j = l.pts[q], k = ks[l.ptQ[q]], a = l.theta * f[l.ptQ[q]], c = Math.cos(a), s = Math.sin(a);
        points[j * 2] = data.x[k] - p.ox0 + 0.5; points[j * 2 + 1] = data.y[k] - p.oy0 + 0.5;
        ptCell[j] = cellOf(p, data.x[k], data.y[k]);
        faces[j * 2] = l.fu[q] * c - l.fv[q] * s; faces[j * 2 + 1] = l.fu[q] * s + l.fv[q] * c;
      }
      l.drawn = l.theta;
      stats.limbBends = (stats.limbBends || 0) + 1;
    }
    function growGrid(p, X, Y) {
      const m = 8, u = X - p.ox0, v = Y - p.oy0;
      const u0 = Math.min(p.u0, u - m), v0 = Math.min(p.v0, v - m);
      const gw = Math.max(p.u0 + p.gw, u + m + 1) - u0, gh = Math.max(p.v0 + p.gh, v + m + 1) - v0;
      const grid = new Int32Array(gw * gh), du = p.u0 - u0, dv = p.v0 - v0;
      for (let g = 0; g < p.grid.length; g += 1) if (p.grid[g]) grid[(((g / p.gw) | 0) + dv) * gw + (g % p.gw) + du] = p.grid[g];
      for (let j = 0; j < p.ptCell.length; j += 1) { const g = p.ptCell[j]; p.ptCell[j] = (((g / p.gw) | 0) + dv) * gw + (g % p.gw) + du; }
      Object.assign(p, { grid, gw, gh, u0, v0 });
    }
    // (each limb of a plant that has bent on since it was last moved: see bendLimb)
    function drawLimbs(p) {
      for (const l of p.limbs) {
        if (limbDraws >= LIMB_DRAWS) return;
        if (Math.abs(l.theta - l.drawn) * l.L < 0.5) continue;
        bendLimb(p, l);
        limbDraws += 1;
      }
    }
    // The air tears leaves off a plant going through it fast - its drag on a leaf goes with the
    // square of the speed - from the edge of its crown in (a leaf with open air beside it): a tree
    // flung by a blast loses many on the way, one toppling over hardly any.
    const LEAF_TEAR = 0.25;       // per second, a leaf at the crown's edge going 100 cells/s through still air
    const LEAF_TEAR_SPEED = 70;   // cells/s: slower than this through the air, it loses none
    function stripLeaves(p, dt) {
      const { grid, gw, gh, data } = p;
      const [c, s] = cosSin(p), [cx, cy] = centre(p);
      const wind = world.air && world.air.wind ? world.air.wind(Math.floor(cx), Math.floor(cy)) : NO_WIND;
      let n = 0;
      for (let g = 0; g < grid.length; g += 1) {
        const k = grid[g] - 1;
        if (k < 0 || data.solid[k] || !data.color[k]) continue;
        const gu = g % gw, gv = (g / gw) | 0;
        if (gu > 0 && gv > 0 && gu < gw - 1 && gv < gh - 1 && grid[g - 1] && grid[g + 1] && grid[g - gw] && grid[g + gw]) continue;
        const [x, y] = toWorld(p, c, s, gu + p.u0 + 0.5, gv + p.v0 + 0.5);
        const vx = p.vx - p.omega * (y - cy), vy = p.vy + p.omega * (x - cx);
        const rx = vx - wind[0], ry = vy - wind[1];
        if (random() >= LEAF_TEAR * (rx * rx + ry * ry) / 1e4 * dt) continue;
        PW.flora.shed(particles, x, y, data.color[k], vx * 0.8, vy * 0.8, false, null);
        grid[g] = 0; data.color[k] = 0;
        n += 1;
      }
      if (!n) return;
      p.area = Math.max(1, p.area - n);
      stats.stripped = (stats.stripped || 0) + n;
    }
    // The air on a falling plant drags on all of it against the way it goes through the air (the
    // wind's way, less its own): a leafy twig flutters down slowly and is carried off on the wind, a
    // whole tree falls nearly free. Dragging at the middle of all of it rather than of its weight
    // (its wood), the air turns it as well - the leafy crown trails, the heavy wood leads - and
    // slows its turning.
    const SPIN_DRAG = 0.3;        // per second (spinning about its middle, which the drag on its
                                  // middle does not slow)
    const NO_WIND = [0, 0];
    function airDrag(p, h) {
      const [c, s] = cosSin(p);
      const [ax, ay] = toWorld(p, c, s, p.au, p.av);
      const [vx, vy] = velocityAt(p, ax, ay);
      const wind = world.air && world.air.wind ? world.air.wind(Math.floor(ax), Math.floor(ay)) : NO_WIND;
      const rx = wind[0] - vx, ry = wind[1] - vy, rel = Math.hypot(rx, ry);
      if (rel > 1e-3) {
        // (the push over its weight; never more than brings it to the air's speed in the step)
        const k = Math.min(PW.flora.AIR_DRAG * p.area * rel / p.mass, 0.5 / h);
        const fx = k * rx, fy = k * ry;
        const [cx, cy] = centre(p);
        if (pinned(p)) {
          const r2 = (cx - p.hx) ** 2 + (cy - p.hy) ** 2;
          p.omega += ((ax - p.hx) * fy - (ay - p.hy) * fx) / (p.inertia / p.mass + r2) * h;
        } else {
          p.vx += fx * h; p.vy += fy * h;
          p.omega += ((ax - cx) * fy - (ay - cy) * fx) / Math.max(1, p.inertia / p.mass) * h;
        }
      }
      p.omega *= Math.max(0, 1 - SPIN_DRAG * h);
    }

    // A blast throws back what it breaks loose: a piece that comes away within a moment of a blast
    // near it - a building's top whose supports it blew out, a tree it felled - sets off already
    // going away from it, the harder the nearer and the stronger the blast, and the lighter the
    // piece (the push is the blast wave's on it, over its weight: a tree is thrown, a tower's top
    // hardly stirred). A piece hinging on what is left of its foot is tipped over faster if the
    // blast is on the side it is not falling to - it can only go over the way its pivot lets it.
    // (The strongest of the blasts near it is what pushes it; `only`: just that blast, now.)
    const PUSH = 150;             // cells/s given to a light piece at the edge of a blast of power 1
    const PUSH_MASS = 1500;       // a piece of more frame (or wood) than this is pushed the less, as its weight
    const PUSH_TICKS = 90;        // a blast throws back what comes away up to this long after it
    const PUSH_REACH = 4;         // ...out to this many times its radius
    const PUSH_SPIN = 0.25;       // share of its push a building's piece is turned by, at its edge
    function pushed(p, only = null) {
      const log = only ? [only] : world.blastLog;
      if (!log || !log.length) return;
      const [cx, cy] = centre(p), now = world.tick || 0;
      let px = 0, py = 0, best = 0;
      for (const b of log) {
        if (!only && now - b.tick > PUSH_TICKS) continue;
        const dx = cx - b.x, dy = cy - b.y, d = Math.hypot(dx, dy) || 1;
        // (what lies within the blast's reach, from the near side of the piece)
        const near = Math.max(b.r, d - Math.hypot(p.gw, p.gh) * 0.35);
        if (near > b.r * PUSH_REACH) continue;
        const v = PUSH * b.power * (b.r / near) * Math.min(1, PUSH_MASS / Math.max(1, p.mass));
        if (v <= best) continue;
        best = v;
        // (it takes the blast wave over all its height: out from the blast, sideways, at least
        // as much as up or down)
        px = (Math.sign(dx) || 1) * v * Math.max(0.6, Math.abs(dx) / d);
        py = dy / d * v;
      }
      if (!best) return;
      if (p.mode === 'flex') {
        // (a bent limb is swung by the wave, either way)
        p.omega += px / Math.max(20, Math.hypot(cx - p.hx, cy - p.hy));
      } else if (p.mode === 'hinge') {
        // (a push sideways on a top standing over its pivot tips it on over, the way it falls)
        if (Math.sign(px) !== p.dir) return;
        p.omega += px / Math.max(20, p.hy - cy);
      } else {
        // (free, it is thrown - and, pushed hardest high up where the wave meets the most of it,
        // turned over away from the blast: a plant, its crown taking the wave, end over end; a
        // building's piece, the wave on its face all but through its middle, by PUSH_SPIN of that)
        p.vx += px; p.vy += Math.min(py, 0) - Math.abs(px) * 0.15;
        p.omega += (p.flora ? 1 : PUSH_SPIN) * px / Math.max(30, Math.hypot(p.gw, p.gh) * 0.5);
      }
      stats.pushed = (stats.pushed || 0) + 1;
    }
    // A blast reaching pieces already falling or flying - a tree it or an earlier one threw, a
    // chunk of a building on its way down - throws them back again, and tears into what it
    // reaches: a plant loses most of the leaves in its reach and the wood in the heart of it, and
    // comes apart into what still hangs together, and close to the blast by branch; a building's
    // piece crumbles where the blast meets it and cracks into chunks. Each part is thrown by the
    // blast as its own weight lets it (see pushed).
    const TEAR = 1.2;             // a blast tears into a piece within this many radii of it
    function blast(bx, by, r, power = 1) {
      const b = { x: bx, y: by, r, power };
      for (const p of list.slice()) {
        const [cx, cy] = centre(p), d = Math.hypot(cx - bx, cy - by);
        const near = Math.max(r * 0.3, d - Math.hypot(p.gw, p.gh) * 0.35);
        if (near > r * PUSH_REACH) continue;
        const parts = near < r * TEAR ? tear(p, b, near < r && power >= 0.5) : null;
        for (const q of parts || [p]) pushed(q, b);
      }
    }
    // (the parts it is torn into, going on as it was; null if it held together, untouched)
    function tear(p, b, deep) {
      const [c, s] = cosSin(p), { data, grid, gw, gh, ox0, oy0 } = p;
      const n = data.x.length, gone = new Uint8Array(n);
      const heart = b.r * 0.5 * Math.min(1.2, b.power);
      let lost = 0;
      for (let k = 0; k < n; k += 1) {
        if (!data.solid[k] && !data.color[k]) continue;
        const [x, y] = toWorld(p, c, s, data.x[k] - ox0 + 0.5, data.y[k] - oy0 + 0.5);
        const e = Math.hypot(x - b.x, y - b.y), out = e || 1;
        const v = Math.min(240, b.power * 9000 / (e + 40)), vx = (x - b.x) / out * v, vy = (y - b.y) / out * v * 0.6 - v * 0.2;
        if (p.flora) {
          // (most of the leaves it reaches, and its wood in the heart of it, as splinters)
          const leaf = !data.solid[k];
          const share = leaf ? Math.max(0, 0.95 - (e / b.r) * 0.3) : e < heart ? 1 : 0;
          if (share <= 0 || (PW.hash3(data.x[k], data.y[k], 5) & 255) / 255 >= share) continue;
          if (PW.flora) PW.flora.shed(particles, x, y, data.color[k], vx, vy, !leaf, null);
        } else {
          if (e >= heart || !data.solid[k]) continue;
          if (rubbleFrom(data.solid[k], data.x[k], data.y[k])) particles.spawn(x, y, vx, vy, debrisOf(data.byte[k]), data.color[k] || 0, F.LAND | F.DAMAGE, 6);
          else if ((k & 3) === 0) puff(x, y, 1);
        }
        gone[k] = 1; lost += 1;
      }
      const split = deep && list.length < MAX_PIECES - 8 && (p.flora || p.mass >= SPLIT_MIN);
      if (!lost && !split) return null;
      const before = list.length;
      list.splice(list.indexOf(p), 1);
      if (p.flora && PW.flora && PW.flora.splitPiece) {
        const kind = new Uint8Array(gw * gh);
        for (let g = 0; g < kind.length; g += 1) { const k = grid[g] - 1; if (k >= 0 && !gone[k] && (data.solid[k] || data.color[k])) kind[g] = data.solid[k] ? 1 : 2; }
        const { parts, loose } = PW.flora.splitPiece(kind, gw, gh, split);
        for (const g of loose) {
          const k = grid[g] - 1, [x, y] = toWorld(p, c, s, data.x[k] - ox0 + 0.5, data.y[k] - oy0 + 0.5);
          PW.flora.shed(particles, x, y, data.color[k], 0, 0, false, null);
        }
        for (const part of parts) spawn({ data: pick(data, part.map((g) => grid[g] - 1)), parent: p, inherit: true, flora: true, generation: p.generation + 1 });
      } else {
        const ks = [];
        for (let k = 0; k < n; k += 1) if (!gone[k] && (data.solid[k] || data.color[k])) ks.push(k);
        if (ks.length && split) breakUp(p, ks, Math.max(14, Math.min(64, Math.sqrt(p.mass) / 2.6)), 1.5);
        else if (ks.length) spawn({ data: pick(data, ks), parent: p, inherit: true, owner: p.owner, from: p.from, generation: p.generation, h0: p.h0, floor: p.yf, base: p.base });
      }
      stats.torn = (stats.torn || 0) + 1;
      return list.slice(before - 1);
    }

    // ---- Motion ---------------------------------------------------------------------------------
    const cosSin = (p) => [Math.cos(p.angle), Math.sin(p.angle)];
    // World position of local point (u, v) (relative to the anchor cell's corner).
    const toWorld = (p, c, s, u, v) => [p.px + u * c - v * s, p.py + u * s + v * c];
    // The piece's centre of mass in the world.
    const centre = (p) => { const [c, s] = cosSin(p); return toWorld(p, c, s, p.gx, p.gy); };
    // A tank in a falling piece's way (N82) - drawn over the grid, not in it - is struck by it
    // (PW.tanks.struck: a heavy or fast one dents it) and the piece glances off its plate: thrown
    // back off it as off a sloped face, losing most of its speed; come to rest on it, it slides off
    // its end, as it would off a car's roof. (Its outline, a point in every few, against each tank
    // near it.)
    const GLANCE_KEEP = 0.25;     // of its speed into the plate a piece keeps, thrown back off it
    const SLIDE_OFF = 50;         // cells/s a piece too slow to bounce slides off a tank's back or nose at
    function glance(p, h) {
      const T = PW.tanks, pts = p.points;
      if (!T || !T.touches || !pts.length) return false;
      const [c, s] = cosSin(p), [cx, cy] = centre(p), reach = Math.hypot(p.gw, p.gh) / 2 + 4;
      const stride = Math.max(2, (pts.length >> 6) << 1);
      for (const t of world.tanks) {
        if (t.dead || Math.abs(t.x - cx) > 64 + reach || cy < t.y - 50 - reach || cy > t.y + 8 + reach) continue;
        for (let k = 0; k < pts.length; k += stride) {
          const [wx, wy] = toWorld(p, c, s, pts[k], pts[k + 1]);
          const part = T.touches(t, wx, wy);
          if (!part) continue;
          // (its plate's face there: out from the middle of its hull)
          let nx = wx - t.x, ny = wy - (t.y - 18);
          const nl = Math.hypot(nx, ny) || 1;
          nx /= nl; ny /= nl;
          const [vx, vy] = velocityAt(p, wx, wy), vn = vx * nx + vy * ny;
          if (vn < 0) {
            // (the blow is what it drives into the plate - a plant's wood weighs a quarter of
            // masonry, cell for cell - and it is thrown back off it, most of that speed lost)
            if (vn < -20) T.struck(world, t, wx, wy, part, p.mass * (p.flora ? 0.25 : 1), vn * nx, vn * ny);
            p.vx -= (1 + GLANCE_KEEP) * vn * nx; p.vy -= (1 + GLANCE_KEEP) * vn * ny;
            p.omega *= 0.6;
          }
          // (out of its plate, a cell at a time; what it slides along it it keeps, a little rubbed off)
          p.px += nx; p.py += ny;
          p.vx *= 0.95; p.omega *= 0.95;
          // (come to rest on top of it, it slides off its nearer end)
          if (ny < -0.5 && Math.abs(p.vx) < SLIDE_OFF) p.vx = Math.sign(cx - t.x || 1) * SLIDE_OFF;
          p.touched = p.age;
          stats.glanced = (stats.glanced || 0) + 1;
          return true;
        }
      }
      return false;
    }
    function velocityAt(p, wx, wy) {
      if (pinned(p)) return [-p.omega * (wy - p.hy), p.omega * (wx - p.hx)];
      const [cx, cy] = centre(p);
      return [p.vx - p.omega * (wy - cy), p.vy + p.omega * (wx - cx)];
    }
    const motion = (p) => {
      // (a plant's leaves reach far out round its wood: its turning is reckoned at its wood)
      const reach = p.flora ? Math.min(20, Math.hypot(p.gw, p.gh) / 2) : Math.hypot(p.gw, p.gh) / 2;
      return pinned(p) ? Math.abs(p.omega) * (Math.hypot(p.rx, p.ry) + reach) : Math.hypot(p.vx, p.vy) + Math.abs(p.omega) * reach;
    };
    // (swinging about a pin: a hinging top, a bent limb)
    function pinned(p) { return p.mode === 'hinge' || p.mode === 'flex'; }
    // (a bent limb swung on into something solid this sub-step: an outline point of it now in what
    // it was not in before)
    const SWING_BOUNCE = 0.3;     // share of its swing it springs back off what it swung into with
    function swingsInto(p, c, s) {
      const pts = p.points, c0 = Math.cos(was.angle), s0 = Math.sin(was.angle);
      for (let k = 0; k < pts.length; k += 2) {
        if (!blocking(Math.floor(p.px + pts[k] * c - pts[k + 1] * s), Math.floor(p.py + pts[k] * s + pts[k + 1] * c))) continue;
        if (!blocking(Math.floor(was.px + pts[k] * c0 - pts[k + 1] * s0), Math.floor(was.py + pts[k] * s0 + pts[k + 1] * c0))) return true;
      }
      return false;
    }
    const was = { px: 0, py: 0, angle: 0 };
    function step(dt) {
      const t0 = performance.now();
      time += dt;
      // (a great piece is made over at most one a tick: the rest wait their turn - see reshape)
      let bigRemakes = 0;
      limbDraws = 0;
      for (let k = list.length - 1; k >= 0; k -= 1) {
        const p = list[k];
        if (p.waits) { p.waits = false; continue; }
        if (p.outlineDue) {
          p.outlineDue = false;
          const o = outlineOf(p.grid, p.gw, p.gh, p.u0, p.v0, p.data, p.ox0, p.oy0);
          p.points = o.points; p.faces = o.faces; p.ptCell = o.ptCell; p.frame = o.frame;
        }
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
          // (a bent limb's damping is the air's on its leaves already: see its spring)
          if (p.flora && p.mode !== 'flex') airDrag(p, h);
          if (p.limbs) springLimbs(p, h);
          if (p.mode === 'flex') {
            // A limb of a standing plant, bent: pinned where it grows from the stouter wood, its
            // own spring brings it back, ringing down (its stiffness and damping: see PW.flora's
            // bend). It passes through the leaves it swings by; swinging into the ground, a wall,
            // a heap, it stops against it and springs back off it.
            p.omega += (-p.spring * p.angle - p.damp * p.omega) * h;
            p.angle += p.omega * h;
            const c = Math.cos(p.angle), sn = Math.sin(p.angle);
            p.px = p.hx + p.rx * c - p.ry * sn;
            p.py = p.hy + p.rx * sn + p.ry * c;
            if (swingsInto(p, c, sn)) { p.angle = was.angle; p.px = was.px; p.py = was.py; p.omega *= -SWING_BOUNCE; }
            continue;
          }
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
          if (!done && p.mode === 'fly' && world.tanks && world.tanks.length) glance(p, h);
        }
        if (p.mode === 'flex') {
          // (rung down - or ringing on too long - it is put back as it grew)
          if ((p.age > 0.2 && Math.abs(p.angle) < 0.004 && Math.abs(p.omega) < 0.03) || p.age > 8) {
            p.angle = 0; p.omega = 0;
            if (PW.flora && PW.flora.unflex) PW.flora.unflex(world, p.data);
            list.splice(k, 1);
          }
          continue;
        }
        // (a building's piece in the air crumbles at its edges - see shed; once it has come down
        // on something, what breaks off it is what the blow breaks - see strike)
        if (!done && !p.flora && (p.mode === 'fly' || p.mode === 'drop') && ((world.tick || 0) + k) % SHED_EVERY === 0 && p.age - p.touched > 0.25 && motion(p) > REST_SPEED) shed(p, dt * SHED_EVERY);
        // (a plant's: its limbs are drawn where they have bent to, and the air tears leaves off it -
        // see bendLimb, stripLeaves)
        if (!done && p.limbs) drawLimbs(p);
        if (!done && p.flora && p.mode === 'fly' && ((world.tick || 0) + k) % SHED_EVERY === 0 && motion(p) > LEAF_TEAR_SPEED) stripLeaves(p, dt * SHED_EVERY);
        // A plant that lost branches is made over at once. A building's piece that has lost cells -
        // shaken loose, ground or crushed off, folded up - has its outline made again from what is
        // left (see reoutline), and is looked at for hanging in parts now: if it does, it is made
        // over, each part a piece of its own (see spawn). (No oftener than RESHAPE_EVERY and
        // PARTS_EVERY, however fast it crumbles; a great piece one a tick.)
        if (!done && p.reshape && p.flora) done = remake(p);
        else if (!done && !p.flora) {
          const big = p.mass >= BIG_REMAKE, turn = !big || bigRemakes < 1;
          // (one sinking storey by storey into its own footprint loses only its bottom: it is
          // looked at when first made, and again once it goes free)
          const lost = p.mode !== 'drop' && p.mass < p.shapeMass * (1 - RESHAPE_LOST);
          if (turn && (p.partsDue || lost) && (p.partsDue || time - (p.partsAt ?? -1) >= PARTS_EVERY)) {
            p.partsAt = time; p.partsDue = false;
            if (big) bigRemakes += 1;
            const parts = partsOf(p.grid, p.gw, p.gh, p.data.solid);
            if (parts) done = detach(p, parts);
            else regather(p, null);
            // (shaken down to too little frame to hold together, it comes apart as rubble - see spawn)
            if (!done && p.mass < CHUNK_MIN) { finish(p); done = true; }
          }
          if (!done && p.reshape && turn && time - (p.outlinedAt ?? -1) >= RESHAPE_EVERY) {
            if (big) bigRemakes += 1;
            p.reshape = false;
            reoutline(p);
          }
          // (its frame shaken off but for a few cells - all but panels of back wall, which strike
          // nothing: it can hold together no longer, and comes apart where it is, as a scrap made
          // so does - see spawn. Kept whole, its last few cells of frame are all that could ever
          // stop it, and a few cells slip through the ground)
          if (!done && !p.outlineDue && (!p.points.length || p.frame < CHUNK_MIN / 2)) {
            const [c, s] = cosSin(p);
            settle(place(p, p.data, c, s), p.vx, p.vy);
            stats.frameless = (stats.frameless || 0) + 1;
            done = true;
          }
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
          // (a plant floating on the water comes to rest there once it has stopped bobbing)
          const held = p.age - p.touched < 0.25 || (p.floatedAt !== undefined && p.age - p.floatedAt < 0.25);
          if (now > REST_SPEED * 2 || gaining) p.still = 0;
          else if (now < REST_SPEED && held && p.age > 0.3) p.still += dt;
          if (p.py > H + 400) { done = true; stats.fellOut = (stats.fellOut || 0) + 1; }
          else if (p.still > (p.floatedAt !== undefined && p.age - p.floatedAt < 0.25 ? 1.2 : 0.3) || p.age > MAX_AGE || (p.age > 10 && now < 40)) { finish(p); done = true; }
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
      const [mid] = centre(p);
      let eaten = 0, lost = 0;
      for (let v = Math.max(v0, Math.ceil(p.footV)); v < v0 + gh; v += 1) {
        for (let u = u0; u < u0 + gw; u += 1) {
          const gi = (v - v0) * gw + (u - u0), g = grid[gi];
          if (!g || !data.solid[g - 1]) continue;
          const x = Math.floor(p.px + (u + 0.5) * c - (v + 0.5) * s), y = Math.floor(p.py + (u + 0.5) * s + (v + 0.5) * c);
          if (!blocking(x, y)) continue;
          // (its own stump under it is crushed instead)
          if (p.owner && y < p.base && PW.getOwner(world, x, y) === p.owner && (mat[y * W + x] & ID_MASK) !== M.CORE) { crush(x, y, p.owner, mid); continue; }
          const k = g - 1;
          // (out at the surface above it, mostly the way it is going over, some the other way)
          let ty = y;
          while (ty > 1 && blocking(x, ty) && y - ty < 24) ty -= 1;
          const out = random() < 0.7 ? p.dir : -p.dir;
          // (each cell as far over the surface as it was pressed under it: what bursts out together
          // keeps its shape, and goes as chunks)
          if (bursts(u, v, p.from) && rubbleFrom(data.solid[k], u, v)) particles.hold(x + 0.5, Math.max(1, ty - (y - ty)) + 0.5, out * (30 + random() * 140) * SPILL + (random() - 0.5) * 60, -(20 + random() * 60) * LOFT, debrisOf(data.byte[k]), data.color[k] || 0, F.LAND | F.DAMAGE, 6);
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
        const [mid] = centre(p);
        for (const x of row.xs) {
          const id = mat[y * W + x] & ID_MASK;
          if (structural[id] && !PW.mat.terrain[id]) crush(x, y, p.owner, mid);
          else {
            const back = PW.getLayer(world, 'back', x, y);
            PW.setLayer(world, 'back', x, y, 0); PW.setLayer(world, 'deco', x, y, 0); PW.setOwner(world, x, y, 0);
            if (back && rubbleFrom(THIN, x, y)) particles.spawn(x + 0.5, y + 0.5, (Math.sign(x + 0.5 - mid) || 1) * (20 + random() * 80) * SPILL, -(20 + random() * 40) * LOFT, M.DEBRIS, back, F.LAND, 5);
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
            particles.spawn(wx, wy, side * (40 + random() * 120) * SPILL + (random() - 0.5) * 40, -(20 + random() * 50) * LOFT, debrisOf(p.data.byte[k]), p.data.color[k] || 0, F.LAND | F.DAMAGE, 6);
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
      // (one coming straight down into its own footprint goes on doing so - see sink)
      spawn({ data: pick(p.data, ks), parent: p, inherit: true, owner: p.owner, from: p.from, generation: p.generation, h0: p.h0, floor: p.yf, base: p.base, dir: p.dir, drop: p.mode === 'drop', sunk: p.sunk });
      return true;
    }
    // A piece come to rest: a big enough one lies where it is as a ruin, a small one heaps as
    // rubble; a tree lies as it fell; a spire of rock that toppled lies broken, as talus that runs
    // on down the slope and settles there.
    function finish(p) {
      const [c, s] = cosSin(p);
      if (p.flora) { if (PW.flora) PW.flora.land(world, particles, place(p, p.data, c, s), p); stats.landedPlants = (stats.landedPlants || 0) + 1; return; }
      // (a great piece of a building does not come to rest whole: its own weight coming down has
      // cracked it through, and it lies as several ruins, broken along jagged lines)
      if (!p.flora && (p.owner || p.from) && p.mass >= RUIN_CRACK && p.generation < MAX_CRACKS && list.length < MAX_PIECES - 8) {
        const ks = [];
        for (let k = 0; k < p.data.x.length; k += 1) if (p.data.solid[k] || p.data.color[k]) ks.push(k);
        breakUp(p, ks, Math.max(40, Math.min(90, Math.sqrt(p.mass) / 1.6)), 0.2);
        stats.restCracked = (stats.restCracked || 0) + 1;
        return;
      }
      // (a vehicle's wreck comes to rest as a building's piece does: see PW.tanks)
      if (p.mass >= RUIN_MIN && (p.owner || p.from || p.wreck)) ruin(p, c, s);
      else settle(p.data, 0, 0, p);
    }
    // Test the piece's outline against the world. A hinging piece crushes the stump of its own
    // building as it swings down into it; anything else it strikes pushes back on it where they
    // touch (see strike). True when the piece is gone (come to rest, broken up, or replaced by what
    // is left of it).
    // (the points of its outline that touched something this sub-step: how many, their middle,
    // which way what they struck faces, how hard it is, and their spread - see touch)
    let tN = 0, tSX = 0, tSY = 0, tFX = 0, tFY = 0, tHS = 0, tBX0 = 0, tBY0 = 0, tBX1 = 0, tBY1 = 0, tLoose = 0;
    function touch(p, k, wx, wy, x, y, ox, oy, c, s) {
      if (tN < OUTLINE_MAX) { went[tN * 2] = wx - ox; went[tN * 2 + 1] = wy - oy; at[tN * 2] = wx; at[tN * 2 + 1] = wy; }
      tN += 1; tSX += wx; tSY += wy; tHS += hardness[mat[y * W + x] & ID_MASK];
      if (phase[mat[y * W + x] & ID_MASK] === PW.PHASE.POWDER) tLoose += 1;
      if (PW.debugHitboxes && nTouched < OUTLINE_MAX) touched[nTouched++] = k >> 1;
      // (a plant: the thinnest wood it struck with - see snapBranch)
      if (p.flora && (weakest < 0 || p.ptGirth[k >> 1] < p.ptGirth[weakest >> 1])) weakest = k;
      if (wx < tBX0) tBX0 = wx; if (wx > tBX1) tBX1 = wx; if (wy < tBY0) tBY0 = wy; if (wy > tBY1) tBY1 = wy;
      // (which way the surface it struck faces there - out through its open sides - and, less,
      // the other way from the side of the piece that struck it)
      let gx = 0, gy = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && !blocking(x + dx, y + dy)) { gx += dx; gy += dy; }
      const gl = Math.hypot(gx, gy);
      if (gl > 0) { tFX += gx / gl; tFY += gy / gl; }
      const faces = p.faces;
      tFX -= (faces[k] * c - faces[k + 1] * s) * 0.5; tFY -= (faces[k] * s + faces[k + 1] * c) * 0.5;
    }
    const biteAt = new Float32Array(OUTLINE_MAX * 4);
    let embedded = false;          // (this sub-step: it lies in what it struck, not just against it)
    function contact(p, h) {
      const [c, s] = cosSin(p);
      const pts = p.points;
      const c0 = Math.cos(was.angle), s0 = Math.sin(was.angle);
      let crushed = 0, smashed = 0, wet = 0, wsx = 0, tested = 0, ghosts = 0, nb = 0;
      tN = 0; tSX = 0; tSY = 0; tFX = 0; tFY = 0; tHS = 0; tBX0 = Infinity; tBY0 = Infinity; tBX1 = -Infinity; tBY1 = -Infinity; tLoose = 0;
      embedded = false;
      const [mid] = toWorld(p, c, s, p.gx, p.gy);   // (what it crushes is squeezed out away from this)
      weakest = -1; nTouched = 0;
      contacts += 1; nBent = 0; nLimbPts = 0;
      for (let k = 0; k < pts.length; k += 2) {
        // (the storeys of it already crushed under its hinge are gone; a plant's branches snapped
        // off it; a cell of it crushed, ground off or shaken loose - no longer there to strike with
        // until its outline is made over: see reshape)
        if (p.stage === 'self' && p.mode === 'hinge' && pts[k + 1] >= -p.ry) continue;
        if (!p.grid[p.ptCell[k >> 1]]) { ghosts += 1; continue; }
        const [wx, wy] = toWorld(p, c, s, pts[k], pts[k + 1]);
        const x = Math.floor(wx), y = Math.floor(wy);
        tested += 1;
        if (!blocking(x, y)) {
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          // (in water: see soak, and for a plant buoy)
          if ((mat[y * W + x] & ID_MASK) === M.WATER) { if (wet < WET_MAX) { wetAt[wet * 2] = x; wetAt[wet * 2 + 1] = y; } wet += 1; wsx += wx; }
          // Whatever stands in the open where it passes is swept away: trees and bushes are
          // knocked down, lamps, railings and furniture smashed. (A falling plant breaks twigs
          // and thin branches only with its trunk and stoutest limbs.)
          if (PW.getLayer(world, 'deco', x, y) && PW.getOwner(world, x, y) !== p.owner && (!p.flora || p.ptGirth[k >> 1] >= p.rigidGirth)) sweep(x, y, p.flora ? 2 : 8);
          continue;
        }
        // (something it was in already before this sub-step - rubble come to lie where the piece
        // is - is not struck anew: loose stuff is pushed out of its way, and it moves on out of
        // anything else)
        const ox = was.px + pts[k] * c0 - pts[k + 1] * s0, oy = was.py + pts[k] * s0 + pts[k + 1] * c0;
        const inside = Math.floor(ox) === x && Math.floor(oy) === y;
        // Loose debris is ploughed aside by a swinging or fast piece rather than landed on - and
        // what it throws aside takes its share of the piece's motion there (see plough). Rubble
        // that has come to lie where the piece is, is squeezed out from under it sideways, away
        // from its middle, clear of it (thrown up, it would only land back under it).
        if (phase[mat[y * W + x] & ID_MASK] === PW.PHASE.POWDER && (inside || p.mode === 'hinge' || Math.hypot(...velocityAt(p, wx, wy)) > 70)) {
          const byte = mat[y * W + x];
          PW.set(world, x, y, M.AIR);
          const [vx, vy] = velocityAt(p, wx, wy);
          if (inside) particles.spawn(x + 0.5, y + 0.5, vx * 0.6 + Math.sign(x + 0.5 - mid || random() - 0.5) * (50 + random() * 70), Math.min(vy, 0) * 0.4 - 10 - random() * 20, byte, 0, F.LAND | F.LOOSE, 5);
          else particles.spawn(x + 0.5, y + 0.5, vx * 0.6 + (random() - 0.5) * 60, Math.min(vy, 0) * 0.4 - 20 - random() * 40, byte, 0, F.LAND | F.LOOSE, 5);
          if (!pinned(p)) plough(p, wx, wy, vx, vy);
          continue;
        }
        const own = p.owner && PW.getOwner(world, x, y) === p.owner;
        // (only above its building's floor: the cores and footings in the ground stay)
        // (another building going up holds against all but a heavy piece: see GROW_HEAVY)
        const spared = !own && p.mass < GROW_HEAVY && PW.growing(world, x, y);
        const grinds = !p.flora && !spared && (p.mode === 'hinge' || p.mode === 'drop') && y < p.base && (mat[y * W + x] & ID_MASK) !== M.CORE;
        if (grinds && (own || (y >= p.yf - 1 && y <= p.yf + 8 && !PW.mat.terrain[mat[y * W + x] & ID_MASK]))) {
          crush(x, y, p.owner, mid);
          crushed += 1;
          continue;
        }
        // A heavy piece coming down hard goes through a building's walls and floors that are
        // weaker than the blow: they are crushed under it (a falling tower flattens the house it
        // falls on; a chunk of rubble only dents it).
        const id = mat[y * W + x] & ID_MASK;
        if (!p.flora && !spared && structural[id] && !PW.mat.terrain[id] && id !== M.CORE && !inside) {
          const [vx, vy] = velocityAt(p, wx, wy);
          if (hardness[id] < Math.hypot(vx, vy) / 300 * Math.min(1, p.mass / 3000)) { crush(x, y, PW.getOwner(world, x, y), mid); smashed += 1; continue; }
        }
        if (p.mode === 'hinge' && PW.mat.terrain[mat[y * W + x] & ID_MASK] && y >= p.yf && Math.abs(x - p.hx) < 6) continue;   // seated on its pivot
        // (a building leaning over presses its foot into the ground: see eatFoot)
        if (p.mode === 'hinge' && !p.flora && pts[k + 1] > p.footV) { p.footTouch = true; continue; }
        // (bitten into it - already inside it, or deep in it - it grinds off there: see grind. A
        // plant does not grind: it is pushed back out like anything it strikes)
        if (!p.flora && (inside || (blocking(x - 1, y) && blocking(x + 1, y) && blocking(x, y - 1) && blocking(x, y + 1)))) {
          if (nb < OUTLINE_MAX) { bites[nb] = k; const q = nb * 4; biteAt[q] = wx; biteAt[q + 1] = wy; biteAt[q + 2] = ox; biteAt[q + 3] = oy; nb += 1; }
          continue;
        }
        // (a plant's limb that struck it bends - see flexOn - rather than the plant striking it there)
        if (p.flora && p.ptGirth[k >> 1] < p.rigidGirth && limbHit(p, k, wx, wy, x, y)) continue;
        touch(p, k, wx, wy, x, y, ox, oy, c, s);
      }
      for (let q = 0; q < nBent; q += 1) flexOn(p, bent[q], c, s, h);
      // (its outline has many points over cells no longer there: it is made over from what is left)
      if (ghosts >= Math.max(3, (pts.length >> 1) * GHOSTS) && !p.flora) p.reshape = true;
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
      if (wet) {
        if (p.flora) buoy(p, wet / Math.max(1, tested), wsx / wet, h);
        soak(p, wet, p.flora ? tested : pts.length / 2, h);
      }
      if (nb) {
        const ground = grind(p, nb, c, s, mid);
        if (ground === true) return true;
        // (where it ground nothing off - too small a piece to, worn as far as it wears, or only
        // resting there - what it is in is struck like anything else, and puts it back out: a
        // piece never sinks on through the ground)
        if (!ground) {
          for (let b = 0; b < nb; b += 1) {
            const q = b * 4, wx = biteAt[q], wy = biteAt[q + 1];
            touch(p, bites[b], wx, wy, Math.floor(wx), Math.floor(wy), biteAt[q + 2], biteAt[q + 3], c, s);
          }
          // (and one lying in it - come to rest pressed into it, or broken off a piece that was -
          // is worked back out of it, a cell a sub-step: see strike)
          embedded = true;
        }
      }
      const n = tN;
      if (!n) { p.jam = 0; return false; }
      wentN = Math.min(n, OUTLINE_MAX);
      stepH = h;
      // (how wide a face it rests on, for its turning: what it touches, or - come down in loose
      // rubble or earth, which gives under it and closes round it - as wide as it is: see strike)
      const spread = Math.hypot(tBX1 - tBX0, tBY1 - tBY0);
      faceSpan = Math.max(spread, tLoose / n * 2 * Math.sqrt(p.inertia / p.mass));
      const gone = strike(p, tSX / n, tSY / n, tFX / n, tFY / n, tHS / n, spread);
      // (the debug view: how hard each outline point that touched was struck - see drawHitboxes)
      if (PW.debugHitboxes) {
        if (!p.hitV || p.hitV.length !== pts.length / 2) { p.hitV = new Float32Array(pts.length / 2); p.hitT = new Float32Array(pts.length / 2); }
        for (let q = 0; q < nTouched; q += 1) { const j = touched[q]; if (lastFelt >= p.hitV[j] * Math.exp(-(time - p.hitT[j]) * HIT_FADE)) { p.hitV[j] = lastFelt; p.hitT[j] = time; } }
      }
      nTouched = 0;
      return gone;
    }
    // A piece does not slide on through what it has bitten into - the ground, another building:
    // where it is moving into it, its own cells round each point that bit in are ground off,
    // breaking away as rubble and dust thrown out along the surface. So the bottom of a falling
    // top breaks apart against what it comes down on. (A hinging piece's are taken out of it where
    // they are; a free one is made over from what is left every so often, so its outline follows
    // what it has lost. True when it was made over.)
    // (It grinds only where it is driving into what it bit - not sliding along it, nor resting on
    // it - and wears away no more than a share of itself: what is left comes to rest whole, as a
    // ruin.)
    const GRIND = 1;              // cells round each point that bit in
    const GRIND_SPEED = 12;       // cells/s into the surface: slower than this, it is only resting there
    const GRIND_REMAKE = 24;      // cells ground off before a free piece is made over...
    const GRIND_EVERY = 0.1;      // ...at most this often (s)
    const GRIND_FLOOR = 400;      // frame cells: a smaller piece does not grind
    const WEAR_MAX = 0.3;         // share of itself, at most, a piece wears away grinding
    const bites = new Int32Array(OUTLINE_MAX);
    function grind(p, nb, c, s, mid) {
      const { grid, gw, gh, u0, v0, data, points } = p;
      if (p.m0 === undefined) p.m0 = p.mass;
      if (p.mass < GRIND_FLOOR || (p.worn || 0) >= p.m0 * WEAR_MAX) return false;
      let lost = 0, n = 0;
      for (let b = 0; b < nb; b += 1) {
        const k = bites[b];
        const [wx, wy] = toWorld(p, c, s, points[k], points[k + 1]);
        const [vx, vy] = velocityAt(p, wx, wy);
        const [nx, ny] = normalAt(Math.floor(wx), Math.floor(wy), vx, vy);
        if (-(vx * nx + vy * ny) < GRIND_SPEED) continue;
        const cu = Math.floor(points[k]), cv = Math.floor(points[k + 1]);
        for (let v = cv - GRIND; v <= cv + GRIND; v += 1) for (let u = cu - GRIND; u <= cu + GRIND; u += 1) {
          if (u < u0 || v < v0 || u >= u0 + gw || v >= v0 + gh) continue;
          const gi = (v - v0) * gw + (u - u0), g = grid[gi];
          if (!g) continue;
          const q = g - 1;
          const [x, y] = toWorld(p, c, s, u + 0.5, v + 0.5);
          if (data.solid[q] && bursts(u, v, p.from) && rubbleFrom(data.solid[q], u, v)) {
            const out = Math.sign(x - mid) || (random() < 0.5 ? -1 : 1);
            particles.hold(x, y - 1, vx * 0.35 + out * (20 + random() * 70) * SPILL * 0.6, -(10 + random() * 40) * LOFT, debrisOf(data.byte[q]), data.color[q] || 0, F.LAND, 6);
          } else if ((n & 7) === 3) puff(x, y - 1, 1);
          lost += weightOf(data.solid[q]);
          grid[gi] = 0; data.solid[q] = 0; data.color[q] = 0;
          n += 1;
        }
      }
      if (!n) return false;
      p.mass = Math.max(1, p.mass - lost);
      p.worn = (p.worn || 0) + lost;
      stats.ground = (stats.ground || 0) + n;
      { const [gx, gy] = toWorld(p, c, s, points[bites[0]], points[bites[0] + 1]); crushedAt(gx, gy, n, p.from || p.owner); }
      // (the cells it ground off, when it was not made over: see contact)
      if (p.mode === 'hinge') { p.eaten += n; return n; }
      p.grit = (p.grit || 0) + n;
      if (p.grit < GRIND_REMAKE || time - (p.remadeAt ?? -1) < GRIND_EVERY) return n;
      remadeFrom(p);
      return true;
    }
    // A piece found hanging in parts: its greatest part goes on as it is, where it is, as it was
    // moving; each of the others breaks away as a piece of its own, moving as that part of it was.
    // (Its greatest part keeps its cells: only the lesser ones are copied out. True when nothing
    // of it is left worth a piece: it was made over whole - see remadeFrom.)
    function detach(p, parts) {
      const { data, grid, gw, u0, v0, ox0, oy0 } = p;
      const weights = parts.map((ks) => { let w = 0; for (const k of ks) w += weightOf(data.solid[k]); return w; });
      let main = 0;
      for (let q = 1; q < parts.length; q += 1) if (weights[q] > weights[main]) main = q;
      if (weights[main] < CHUNK_MIN) return remadeFrom(p);
      for (let q = 0; q < parts.length; q += 1) {
        if (q === main) continue;
        const kid = spawn({ data: pick(data, parts[q]), parent: p, inherit: true, owner: p.owner, from: p.from, generation: p.generation, h0: p.h0,
          floor: p.yf, base: p.base, dir: p.dir, drop: p.mode === 'drop', sunk: p.sunk, joined: true });
        if (kid) Object.assign(kid, { age: p.age, touched: p.touched, still: p.still, m0: p.m0, worn: p.worn, crumpled: p.crumpled });
        for (const k of parts[q]) { grid[(data.y[k] - oy0 - v0) * gw + (data.x[k] - ox0 - u0)] = 0; data.solid[k] = 0; data.color[k] = 0; }
      }
      stats.parted = (stats.parted || 0) + parts.length - 1;
      regather(p, parts[main]);
      reoutline(p);
      return false;
    }
    // (what is left of a piece - its cells `ks`, or all it still has: its weight, its middle and how
    // it turns, moving on as it was)
    function regather(p, ks) {
      const { data, ox0, oy0 } = p, n = ks ? ks.length : data.x.length;
      let mass = 0, sx = 0, sy = 0;
      for (let q = 0; q < n; q += 1) { const k = ks ? ks[q] : q, w = weightOf(data.solid[k]); if (!w) continue; mass += w; sx += (data.x[k] - ox0 + 0.5) * w; sy += (data.y[k] - oy0 + 0.5) * w; }
      if (!mass) return;
      const gx = sx / mass, gy = sy / mass;
      const [c, s] = cosSin(p), [wx, wy] = toWorld(p, c, s, gx, gy);
      if (!pinned(p)) { [p.vx, p.vy] = velocityAt(p, wx, wy); }
      let inertia = 0;
      for (let q = 0; q < n; q += 1) { const k = ks ? ks[q] : q, w = weightOf(data.solid[k]); if (w) inertia += w * ((data.x[k] - ox0 + 0.5 - gx) ** 2 + (data.y[k] - oy0 + 0.5 - gy) ** 2); }
      Object.assign(p, { mass, gx, gy, inertia: Math.max(1, inertia), shapeMass: mass });
    }
    // Make a piece over from what is left of it (after it was ground, or shook cells loose - see
    // reshape): its parts that still hang together go on, each as a piece of its own, just as they
    // were moving - with its age, its rest and its wear.
    function remadeFrom(p) {
      const before = list.length;
      rebuild(p);
      for (let k = before; k < list.length; k += 1) Object.assign(list[k], { remadeAt: time, age: p.age, touched: p.touched, still: p.still, m0: p.m0, worn: p.worn, crumpled: p.crumpled });
      return true;
    }
    // (how far each point that struck something moved this sub-step, and where it is)
    const went = new Float32Array(OUTLINE_MAX * 2), at = new Float32Array(OUTLINE_MAX * 2);
    let wentN = 0, stepH = 1 / 60, faceSpan = 0;
    // (a plant: its outline point with the thinnest wood that struck something this sub-step)
    let weakest = -1;
    // (where its outline is in water)
    const WET_MAX = 64, wetAt = new Int32Array(WET_MAX * 2);
    // A plant is lighter than water (PW.mat.WOOD_WEIGHT against water's): the water it pushes aside
    // holds it up, as much as the share of it under the surface (its outline's share in the water),
    // so it floats with some of it out, bobbing, the water damping it (see soak); and the lift is
    // at the middle of what is under, so it turns to lie along the water. (`bx`: that middle's x.)
    const WOOD_LIFT = PW.mat.weight[M.WATER] / PW.mat.WOOD_WEIGHT;
    function buoy(p, share, bx, h) {
      const lift = G * share * WOOD_LIFT;
      const [cx] = centre(p);
      p.vy -= lift * h;
      p.omega -= (bx - cx) * lift / Math.max(1, p.inertia / p.mass) * h;
      p.floatedAt = p.age;
    }
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
    // (squeezed out from under the weight on it, away from `from` - the middle of what came down
    // on it - low and wide, in its own colours; the rest drops where it was. Which goes is decided
    // a block at a time - see bursts - and it is let go with the rows crushed next to it, so it
    // bursts out in chunks: slabs of its floors, lumps of its walls - see PW particles' hold.)
    function crush(x, y, owner, from = x) {
      const m = mat[y * W + x], paint = PW.getLayer(world, 'paint', x, y);
      PW.set(world, x, y, M.AIR);
      PW.setOwner(world, x, y, 0);
      // (the wall behind it is crushed with it: never left standing in the air on its own)
      if (PW.getLayer(world, 'back', x, y)) PW.setLayer(world, 'back', x, y, 0);
      stats.crushed += 1;
      if (bursts(x, y, owner)) {
        const out = Math.sign(x + 0.5 - from) || (random() < 0.5 ? -1 : 1);
        particles.hold(x + 0.5, y + 0.5, out * (40 + random() * 110) * SPILL, -(10 + random() * 60) * LOFT, debrisOf(m), paint, F.LAND, 5, owner);
      } else if (y + 1 < H && !blocking(x, y + 1)) PW.set(world, x, y, debrisOf(m));
      if ((PW.hash3(x, y, 7) & 3) === 0) puff(x, y - 1, 1);
      if (world.onDamage && owner) world.onDamage(owner, 1, x, y);
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
    const BREAK_SPIN = 0.25;      // share of a blow's turn the parts of what it breaks take with them
    const MAX_AGE = 24;
    // (wx, wy): the middle of where it touches; (fx, fy): which way, all told, what it struck
    // pushes back on it there; hard: how hard that is (the element table's hardness); spread: how
    // far apart the places it touches are.
    function strike(p, wx, wy, fx, fy, hard = 0.5, spread = 0) {
      const hx = Math.floor(wx), hy = Math.floor(wy);
      const [vx, vy] = velocityAt(p, wx, wy);
      lastFelt = Math.hypot(vx, vy);
      // A big piece coming straight down into its own footprint sinks into it storey by storey.
      if (p.mode === 'drop' && p.mass >= SPLIT_MIN * 4 && Math.abs(vx) < Math.abs(vy) * 0.6 && Math.abs(p.angle) < 0.6) { sink(p, vx, vy, wx, wy, hx, hy); return true; }
      // A plant: if the thinnest wood that took the blow cannot bear its share of it - of the blow
      // that would stop it there, or of its weight resting there - that branch snaps off and the
      // plant comes on past it (see snapBranch).
      if (p.flora && weakest >= 0 && p.ptGirth[weakest >> 1] < p.rigidGirth) {
        const fl = Math.hypot(fx, fy);
        const [nx, ny] = fl > 0.3 ? [fx / fl, fy / fl] : normalAt(hx, hy, vx, vy);
        const hit = -(vx * nx + vy * ny);
        const [cx, cy] = centre(p), rn = (wx - cx) * ny - (wy - cy) * nx;
        const blow = hit / (1 / p.mass + rn * rn / Math.max(1, p.inertia)) / wentN, g3 = p.ptGirth[weakest >> 1] ** 3;
        if (hit > 0 && (blow > WOOD_BLOW * g3 || p.mass * G / wentN > WOOD_LOAD * g3) && snapBranch(p, weakest)) return false;
      }
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
      // (a lump too small to grind lying in what it struck - see contact - is worked back out of it,
      // a cell a tick; a greater piece grinds where it bites, and rests where it lies)
      if (embedded && p.mass < GRIND_FLOOR && p.embedTick !== world.tick) { p.embedTick = world.tick; p.px += nx; p.py += ny; }
      // (a plant pressed into what it struck - slid or turned in over it - is put back out of it the
      // way that faces, as deep as its wood that touches lies in it on the whole, a cell a sub-step
      // at most: it lies on the ground, never sinks on into it)
      // (or the way it came, if that is the shorter way out: the face of what it touches, turned
      // wrong over a hollow under a pond's edge, never presses it on into the ground)
      if (p.flora) {
        let deep = 0, ox = nx, oy = ny;
        for (let q = 0; q < wentN; q += 1) deep += depthAt(at[q * 2], at[q * 2 + 1], nx, ny);
        deep /= wentN;
        const v = Math.hypot(vx, vy);
        if (deep > REST_DEPTH && v > 0) {
          let back = 0;
          for (let q = 0; q < wentN; q += 1) back += depthAt(at[q * 2], at[q * 2 + 1], -vx / v, -vy / v);
          back /= wentN;
          if (back < deep) { deep = back; ox = -vx / v; oy = -vy / v; }
        }
        if (deep > REST_DEPTH) { const d = Math.min(1, deep - REST_DEPTH); p.px += ox * d; p.py += oy * d; }
      }
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
      lastFelt = felt;
      // (how hard it was struck, and when: it shakes it - see shed)
      if (felt > (p.feltV || 0) * Math.exp(-(p.age - (p.feltAt || 0)) * 3)) { p.feltV = felt; p.feltAt = p.age; }
      // (a plant's wood and leaves take the blow up: it does not bounce)
      const j = (1 + (felt > CRUMBLE_SPEED && !p.flora ? BOUNCE * (0.4 + hard * 1.2) : 0)) * hit / (invM + rn * rn * invI);
      const tx = -ny, ty = nx, vt = vx * tx + vy * ty, rt = rx * ty - ry * tx;
      const fwd = Math.sign(vt) || (random() < 0.5 ? 1 : -1);
      // A hollow piece - a building, mostly air - folds up where it lands, like a box (see crumple).
      if (p.hollow > HOLLOW && felt >= FOLD_SPEED && p.mass >= SPLIT_MIN && p.crumpled !== world.tick) {
        blow(hx, hy, vx, vy, hit, j * hit, tx * fwd, ty * fwd, Math.abs(vt), hard, !p.owner && !p.from && !p.flora, p.mass >= GROW_HEAVY);
        if (crumple(p, wx, wy, nx, ny, felt, spread, vt)) return true;
      }
      const jt = Math.max(-FRICTION * j, Math.min(FRICTION * j, -vt / (invM + rt * rt * invI)));
      const ix = j * nx + jt * tx, iy = j * ny + jt * ty, omega0 = p.omega;
      p.vx += ix * invM; p.vy += iy * invM;
      p.omega += (rx * iy - ry * ix) * invI;
      // It lies on a face, not a point: the push spreads over all of the face that touches, as it
      // must to keep that face flush, and turns the piece about it only once the turning is more
      // than the push can hold across the face (its middle to either edge). So what lands flat
      // stays flat and slides to a stop, what lands on a corner tips over it, and what has its
      // weight out past the edge it rests on tips over that edge - nothing rolls on a face; and
      // come down in a heap of rubble, which closes round it, it stops turning (see faceSpan).
      const flat = j * faceSpan / 2 * invI;
      p.omega = Math.abs(p.omega) <= flat ? 0 : p.omega - Math.sign(p.omega) * flat;
      // (a falling tree or bough turns and slides over what it strikes until it lies still - see
      // finish - never set spinning by it, and breaks nothing: one tree coming down does not set
      // off the next)
      if (p.flora) {
        // (its branches drag on what it lies on: it does not roll on over it)
        p.omega = Math.max(-FLORA_SPIN, Math.min(FLORA_SPIN, p.omega * Math.max(0, 1 - FLORA_DRAG * stepH)));
        return false;
      }
      if (felt < SNAP_SPEED) return false;
      // A blow: what it struck feels it, and the piece breaks where it took it.
      if (felt >= CRUMBLE_SPEED && p.crumpled !== world.tick) blow(hx, hy, vx, vy, hit, j * hit, tx * fwd, ty * fwd, Math.abs(vt), hard, !p.owner && !p.from && !p.flora, p.mass >= GROW_HEAVY);
      // (what breaks under the blow spends it in breaking: the parts it comes apart into are not
      // swung round as the whole would have been, pivoting on what it struck - they take only
      // BREAK_SPIN of that turn, and each strikes on by itself)
      const omega1 = p.omega;
      p.omega = omega0 + (omega1 - omega0) * BREAK_SPIN;
      if (breaks(p, wx, wy, vx, vy, nx, ny, felt, hard, spread)) return true;
      p.omega = omega1;
      return false;
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
      const d = p.data, n = d.x.length, X = d.x, Y = d.y;
      const folded = [], rest = [];
      let lost = 0;
      // (toWorld, cell by cell)
      const ox = p.ox0 - 0.5, oy = p.oy0 - 0.5, px = p.px, py = p.py;
      for (let k = 0; k < n; k += 1) {
        const u = X[k] - ox, v = Y[k] - oy;
        const ex = px + u * c - v * s - wx, ey = py + u * s + v * c - wy;
        // (how high above what it struck, and how far along it; the fold is ragged)
        const h = ex * nx + ey * ny, a = ex * tx + ey * ty;
        if (h >= band + 2.1 || Math.abs(a) >= lateral) { rest.push(k); continue; }
        const edge = band + ((PW.hash2(X[k] >> 2, Y[k] >> 2) & 7) - 3.5) * 0.6;
        if (h < edge) { folded.push(k); lost += weightOf(d.solid[k]); } else rest.push(k);
      }
      if (lost < 4 || !rest.length) return false;
      const go = (40 + felt * 0.8);
      for (const k of folded) {
        const [x, y] = toWorld(p, c, s, d.x[k] - p.ox0 + 0.5, d.y[k] - p.oy0 + 0.5);
        if (!d.solid[k]) { if ((k & 15) === 0) puff(x, y, 1); continue; }
        if (!rubbleFrom(d.solid[k], d.x[k], d.y[k])) { if ((k & 3) === 0) puff(x, y, 1); continue; }
        // (out of whichever side of the fold it is nearer, low along what it struck)
        const a = (x - wx) * tx + (y - wy) * ty, side = Math.sign(a) || (random() < 0.5 ? 1 : -1);
        const out = side * go * (0.3 + random() * 0.9) * SPILL + vt * 0.5, up = (15 + random() * 45) * LOFT;
        particles.spawn(x, y, tx * out + nx * up, ty * out + ny * up, debrisOf(d.byte[k]), d.color[k] || 0, F.LAND | F.DAMAGE, 6);
        stats.folded = (stats.folded || 0) + 1;
      }
      // The air in the rooms that folded is driven out of both sides, with their dust.
      for (const side of [-1, 1]) {
        const ex = wx + tx * side * lateral, ey = wy + ty * side * lateral;
        jet(ex, ey - 2, Math.round(10 + Math.min(80, folded.length / 30)), tx * side * go, ty * side * go - 15, 0.4);
        if (world.air) world.air.gust(ex + tx * side * 12, ey - 6, 24, tx * side * go * 0.8, ty * side * go * 0.8 - 10);
      }
      crushedAt(wx, wy, folded.length, p.from || p.owner);
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
    // A piece ploughing through loose rubble throws it aside: each cell it throws takes the momentum
    // it is given out of the piece, at the point that threw it - so a piece comes to a stop in a
    // heap, and one turning as it ploughs is slowed in its turning. (A cell of rubble weighs some
    // PLOUGH_WEIGHT cells of a building's frame, which is mostly air; it is thrown on at about
    // PLOUGH_THROW of the speed of what struck it.)
    const PLOUGH_WEIGHT = 3, PLOUGH_THROW = 0.6;
    function plough(p, wx, wy, vx, vy) {
      const v = Math.hypot(vx, vy);
      if (v < 1e-3) return;
      const [cx, cy] = centre(p), rx = wx - cx, ry = wy - cy, ux = vx / v, uy = vy / v;
      const invM = 1 / p.mass, invI = 1 / Math.max(1, p.inertia), rn = rx * uy - ry * ux;
      // (as the point strikes a lump that moves off with it: never more than stops the point)
      const m = PLOUGH_WEIGHT * PLOUGH_THROW, k = m / (1 + m * (invM + rn * rn * invI));
      const ix = -ux * v * k, iy = -uy * v * k;
      p.vx += ix * invM; p.vy += iy * invM;
      p.omega += (rx * iy - ry * ix) * invI;
      stats.ploughed = (stats.ploughed || 0) + 1;
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
    // How deep (wx, wy) lies in what it is in, out the way (nx, ny): half a cell at a time, DEEP_MAX
    // at most.
    const DEEP_MAX = 4;
    const REST_DEPTH = 0.75;      // cells: a plant lying no deeper than this in what it touches, on the whole, rests on it
    function depthAt(wx, wy, nx, ny) {
      let d = 0;
      while (d < DEEP_MAX && blocking(Math.floor(wx + nx * d), Math.floor(wy + ny * d))) d += 0.5;
      return d;
    }
    // What a piece strikes at (hx, hy) feels the blow (`energy`: the push times the speed it
    // stopped): the ground is dented and shaken, and looked at for what lost its footing; a struck
    // building gives way around the point of impact. Dust is driven out along the ground the way the
    // piece was going (fx, fy, at `along`), and a big blow leaves the rubble smouldering. (`rock`:
    // the piece is of the ground itself - a column that toppled - and nothing topples for its blow.)
    // (`heavy`: a piece heavy enough to break into a building going up - see GROW_HEAVY)
    function blow(hx, hy, vx, vy, hit, energy, fx, fy, along, hard = 0.5, rock = false, heavy = true) {
      stats.shattered += 1;
      const speed = hit;
      if (PW.debugHitboxes) noteHit(PW.getOwner(world, hx, hy), hit);
      // (soft ground takes the blow in a dent, its clods thrown up; rock hardly)
      if (PW.mat.terrain[mat[hy * W + hx] & ID_MASK]) dent(hx, hy, energy * Math.max(0.1, 1.3 - hard * 1.5), vx);
      // The shock of it shakes the ground around, and the ground it struck is looked at for what
      // lost its footing.
      if (world.stability) {
        world.stability.shock(hx, hy, energy / 40);
        world.stability.disturb(hx - 40, hy - 60, hx + 40, hy + 30, { noTopple: rock });
      }
      const rr = Math.min(10, 1 + Math.sqrt(energy) / 900);
      for (let y = Math.floor(hy - rr); y <= hy + rr; y += 1) for (let x = Math.floor(hx - rr); x <= hx + rr; x += 1) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || (x - hx) ** 2 + (y - hy) ** 2 > rr * rr) continue;
        const m = mat[y * W + x], id = m & ID_MASK;
        if (!structural[id] || id === M.CORE || hardness[id] > 0.2 + speed / 300) continue;
        if (!heavy && PW.growing(world, x, y)) continue;
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
      // (a vehicle's wreck is armour plate and steel castings: it lands whole, as it is)
      if (p.wreck) return false;
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
        const f = 0.4 + random() * 0.8, up = felt * kick * (0.1 + random() * 0.35) * LOFT;
        const side = (random() - 0.5) * (40 + 120 * hard) * SPILL;
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
          if ((k & 1) === 0 && rubbleFrom(d.solid[k], d.x[k], d.y[k])) particles.spawn(x, y, (random() - 0.5) * 60 * SPILL, -(20 + random() * 40) * LOFT, debrisOf(d.byte[k]), d.color[k] || 0, F.LAND, 6);
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
      const placed = place(p, p.data, c, s, true);
      let lowest = -Infinity;
      for (let j = 0; j < placed.x.length; j += 1) if (placed.solid[j]) lowest = Math.max(lowest, placed.y[j]);
      // (a few rows at a time, each crushed band bursting out of its sides as it goes - the
      // harder it comes down, the harder)
      const band = Math.max(6, Math.round(p.gh * 0.05));
      const crushedKs = [], restKs = [];
      for (let j = 0; j < placed.x.length; j += 1) (placed.y[j] >= lowest - band ? crushedKs : restKs).push(j);
      const [mid] = centre(p);
      scatter(pick(placed, crushedKs, true), vx * 0.3, 0, 0, mid, wy, 0.6, undefined, undefined, undefined, Math.min(1.6, 0.6 + speed / 220));
      let restMass = 0;
      for (const k of restKs) if (p.data.solid[k]) restMass += 1;
      if (restMass >= CHUNK_MIN) {
        spawn({ data: pick(p.data, restKs), parent: p, owner: p.owner, from: p.from, vx: vx * 0.4, vy: Math.max(30, vy * 0.65), omega: p.omega * 0.5,
          drop: true, floor: p.yf, base: p.base, generation: p.generation, sunk: p.sunk + 1, h0: p.h0 });
        stats.crushSteps = (stats.crushSteps || 0) + 1;
      } else if (restKs.length) settle(pick(placed, restKs, true), vx, vy);
      // The air under it is driven out of its sides: dust and grit blast out low and wide.
      let x0 = Infinity, x1 = -Infinity;
      for (const k of crushedKs) if (placed.solid[k]) { if (placed.x[k] < x0) x0 = placed.x[k]; if (placed.x[k] > x1) x1 = placed.x[k]; }
      if (x1 >= x0) blowOut(x0, x1, Math.round(wy), speed, 1);
      puff(hx, hy - 2, Math.min(900, Math.round(band * Math.sqrt(p.mass) / 2)), 30 + Math.sqrt(p.mass) * 1.2, 10 + band);
      if (world.stability) world.stability.shock(hx, hy, crushedKs.length * speed * speed / 40);
      // (the crushed storeys smoulder in the heap)
      crushedAt(hx, hy, crushedKs.length, p.from || p.owner);
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
    // (cells of a building crushed at (x, y) - folded, ground, crushed under a piece: its heap
    // smoulders once enough of it has been crushed, however many pieces it came down in - one
    // great piece or a shower of small ones - the longer the more of it; see SMOULDER_CELLS)
    const crushedHeaps = new Map();
    const SMOULDER_CELLS = 400;
    function crushedAt(x, y, cells, from = 0) {
      if (cells <= 0) return;
      const key = from ? -from : (Math.floor(y) >> 6) * 1024 + (Math.floor(x) >> 6);
      if (crushedHeaps.size > 4096 && !crushedHeaps.has(key)) crushedHeaps.clear();
      // (all that has been crushed there so far: the more, the longer and wider it smoulders - each
      // patch of its heap smouldering already as long as the whole of it calls for)
      let h = crushedHeaps.get(key);
      if (!h) crushedHeaps.set(key, h = { n: 0, spots: [] });
      h.n += cells;
      if (h.n < SMOULDER_CELLS) return;
      // (its plume hangs over the place a minute or more after a great collapse - see PW.addSmoulder)
      const seconds = 30 + Math.min(60, h.n / 200);
      const s = smoulder(x, y, seconds, 20 + Math.sqrt(h.n) * 0.6);
      if (s && !h.spots.includes(s)) h.spots.push(s);
      for (const t of h.spots) { t.left = Math.max(t.left, seconds - t.age); t.life = Math.max(t.life, seconds); }
    }
    // (rubble smouldering at (x, y): one patch for the heap, however many pieces came down on it)
    function smoulder(x, y, seconds, width) {
      if (!PW.addSmoulder) return null;
      for (const s of world.smoulders || []) {
        if (Math.abs(s.x - x) < 60 && Math.abs(s.y - y) < 60) { s.left = Math.max(s.left, seconds); s.life = Math.max(s.life, seconds); s.width = Math.max(s.width, width); return s; }
      }
      PW.addSmoulder(world, x, y, seconds, width);
      return world.smoulders ? world.smoulders[world.smoulders.length - 1] : null;
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
          if ((mat[i] & ID_MASK) === M.AIR && data.color[j]) { PW.setLayer(world, 'back', x, y, ruinTone(data.color[j], x, y)); PW.setFlag(world, x, y, PW.FLAG.PANEL); }
          continue;
        }
        const byte = data.byte[j];
        const edge = !here.has(i - 1) || !here.has(i + 1) || !here.has(i - W) || !here.has(i + W);
        let room = !blocking(x, y);
        // (lying in a heap of loose rubble, it pushes the rubble out of its way: it lies in the heap)
        if (!room && phase[mat[i] & ID_MASK] === PW.PHASE.POWDER && (byte & ID_MASK) !== M.GLASS) {
          const loose = mat[i], paint = PW.getLayer(world, 'paint', x, y);
          PW.set(world, x, y, M.AIR);
          particles.spawn(x + 0.5, y - 0.5, (random() - 0.5) * 40, -25 - random() * 35, loose, paint, F.LAND | F.LOOSE, 5);
          room = true;
        }
        // (a building's ruin is cracked at its edges; a wreck's armour is not)
        if ((byte & ID_MASK) === M.GLASS || !room || (edge && !p.wreck && (PW.hash2(x, y) & 3) === 0)) {
          if (rubbleFrom(data.solid[j], x, y)) particles.spawn(x + 0.5, y - 0.5, (random() - 0.5) * 60 * SPILL, -(20 + random() * 40) * LOFT, debrisOf(byte), data.color[j] || 0, F.LAND, 6);
          else if ((q & 7) === 0) puff(x, y, 1);
          continue;
        }
        put(x, y, (p.wreck ? M.WRECK : M.RUIN) | (PW.hash2(x, y) & 3) << 6);
        if (data.color[j]) PW.setLayer(world, 'paint', x, y, ruinTone(data.color[j], x, y));
        cells += 1;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (!cells) return;
      (world.ruins || (world.ruins = [])).push({ from: p.from || p.owner, x0, y0, x1, y1, cells, wreck: p.wreck || undefined });
      stats.ruins = (stats.ruins || 0) + cells;
      if (world.stability) world.stability.disturb(x0, y0, x1, y1);
    }
    // (a cell of rubble or ruin put down where water is: the water is pushed up out of its way, to
    // the surface - never lost)
    function put(x, y, byte) {
      // (steam there condenses on it: a drop of water as well)
      const there = mat[y * W + x] & ID_MASK;
      if (there === M.WATER || there === M.STEAM) particles.spawn(x + 0.5, y + 0.5, 0, -30, M.WATER, 0, F.WATER, 6);
      PW.set(world, x, y, byte);
      PW.stir(world, x, y, x, y);   // (rubble just come down settles to its slope)
    }
    // (grow-only scratch arrays, for cells only read where they are made - a sink's placing and its
    // crushed band, a scatter's world places: no garbage from one piece coming down to the next)
    const SCRATCH = new Map();
    function scratch(key, Type, n) {
      let a = SCRATCH.get(key);
      if (!a || a.length < n) { a = new Type(Math.ceil(n * 1.25) + 64); SCRATCH.set(key, a); }
      return a.subarray(0, n);
    }
    // The piece's cells at their present places in the world, as data for a new piece (or, temp,
    // in scratch arrays, to be read on the spot).
    function place(p, part, c, s, temp = false) {
      const n = part.x.length, out = { x: temp ? scratch('placeX', Int32Array, n) : new Int32Array(n), y: temp ? scratch('placeY', Int32Array, n) : new Int32Array(n),
        color: part.color, byte: part.byte, solid: part.solid, girth: part.girth };
      // (toWorld, cell by cell)
      const ox = p.ox0 - 0.5, oy = p.oy0 - 0.5, px = p.px, py = p.py;
      for (let j = 0; j < n; j += 1) {
        const u = part.x[j] - ox, v = part.y[j] - oy;
        out.x[j] = Math.floor(px + u * c - v * s); out.y[j] = Math.floor(py + u * s + v * c);
      }
      return out;
    }
    function pick(data, ks, temp = false) {
      const n = ks.length;
      const out = temp
        ? { x: scratch('pickX', Int32Array, n), y: scratch('pickY', Int32Array, n), color: scratch('pickC', Uint32Array, n), byte: scratch('pickB', Uint8Array, n), solid: scratch('pickS', Uint8Array, n) }
        : { x: new Int32Array(n), y: new Int32Array(n), color: new Uint32Array(n), byte: new Uint8Array(n), solid: new Uint8Array(n) };
      for (let j = 0; j < n; j += 1) { const k = ks[j]; out.x[j] = data.x[k]; out.y[j] = data.y[k]; out.color[j] = data.color[k]; out.byte[j] = data.byte[k]; out.solid[j] = data.solid[k]; }
      if (data.girth) { out.girth = temp ? scratch('pickG', Uint8Array, n) : new Uint8Array(n); for (let j = 0; j < n; j += 1) out.girth[j] = data.girth[ks[j]]; }
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
      const n = data.x.length, wxs = scratch('scatterX', Int32Array, n), wys = scratch('scatterY', Int32Array, n);
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
          if (burst) particles.spawn(x + 0.5, y - 0.5, Math.sign(dx || random() - 0.5) * (60 + random() * 180) * burst * SPILL + vx * 0.3, -(10 + random() * 45 * burst) * LOFT, byte, data.color[k] || 0, F.LAND | F.DAMAGE, 6);
          else particles.spawn(x + 0.5, y - 0.5, vx * 0.5 - omega * dy * 0.5 + (random() - 0.5) * 160 * SPILL, -Math.abs(vy) * 0.3 - random() * 120 * LOFT + omega * dx * 0.2, byte, 0, F.LAND | F.DAMAGE, 6);
        } else if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !blocking(x, y) && !PW.boreAt(world, y * W + x) && support.get(x) - y <= HEAP) {
          put(x, y, byte);
          if (data.color[k] && (byte & ID_MASK) === M.DEBRIS) PW.setLayer(world, 'paint', x, y, rubbleTone(data.color[k], x, y));
          stats.debris += 1;
        } else if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !blocking(x, y) && !PW.boreAt(world, y * W + x)) {
          // (the higher it falls from, the wider it spreads)
          const spread = (70 + (support.get(x) - y) * 0.45) * SPILL;
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
    // (one canvas and one image the size of it, kept and grown as needed: each piece is drawn into
    // its top-left corner - nothing new is made each frame for each piece)
    let canvas = null, ctx2 = null, image = null, px32 = null;
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
          // (grown in steps of 128, so a run of pieces a little bigger each does not remake it each time)
          const cw = Math.ceil(Math.max(iw, canvas ? canvas.width : 0) / 128) * 128, ch = Math.ceil(Math.max(ih, canvas ? canvas.height : 0) / 128) * 128;
          canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          ctx2 = canvas.getContext('2d');
          image = ctx2.createImageData(cw, ch);
          px32 = new Uint32Array(image.data.buffer);
        }
        const stride = canvas.width;
        const { grid, gw, gh, u0, v0, data } = p;
        for (let j = 0; j < ih; j += 1) {
          const wy = y0 + j * step + 0.5 - p.py, row = j * stride;
          px32.fill(0, row, row + iw);
          for (let i = 0; i < iw; i += 1) {
            const wx = x0 + i * step + 0.5 - p.px;
            const u = Math.floor(wx * c + wy * s), v = Math.floor(-wx * s + wy * c);
            const gu = u - u0, gv = v - v0;
            if (gu < 0 || gv < 0 || gu >= gw || gv >= gh) continue;
            const g = grid[gv * gw + gu];
            if (g) px32[row + i] = data.color[g - 1];
          }
        }
        ctx2.putImageData(image, 0, 0, 0, 0, iw, ih);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvas, 0, 0, iw, ih, Math.round((x0 - vx0) * z), Math.round((y0 - vy0) * z), Math.round(iw * step * z), Math.round(ih * step * z));
      }
    }

    // ---- The hitbox debug view (the toolbar's HITBOX) --------------------------------------------------
    // Drawn over the world when PW.debugHitboxes is on: each standing building's frame outline,
    // each falling piece's contact outline (the points it is tested against the world with), and
    // each ruin's outline - every one from green to red by how hard it was struck lately (the
    // blow felt, cells/s, fading over a second or so). Off, it costs nothing.
    function noteHit(owner, v) {
      if (!owner || owner >= 50000) return;
      const hits = world.hits || (world.hits = new Map());
      const h = hits.get(owner), now = time;
      if (!h || v >= h.v * Math.exp(-(now - h.t) * HIT_FADE)) hits.set(owner, { v, t: now });
    }
    PW.noteHit = noteHit;
    const HIT_COLORS = Array.from({ length: 9 }, (_, k) => {
      const t = k / 8, a = t < 0.5 ? [70, 230, 90] : [240, 220, 60], b = t < 0.5 ? [240, 220, 60] : [240, 40, 40], f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
    });
    const hitLevel = (v, t) => (v > 0 ? Math.max(0, Math.min(8, Math.round(v * Math.exp(-(time - t) * HIT_FADE) / HIT_FULL * 8))) : 0);
    let hitDraws = 0;
    // (the outline of what an owner holds in a box - its frame, or a ruin's cells - as cell
    // indices, made again every so often while it is in view)
    function outline(rec, x0, y0, x1, y1, inside) {
      if (rec._hit && hitDraws - rec._hit.at < 30) return rec._hit.cells;
      const cells = [];
      x0 = Math.max(1, x0); y0 = Math.max(1, y0); x1 = Math.min(W - 2, x1); y1 = Math.min(H - 2, y1);
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
        if (!inside(x, y)) continue;
        if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) cells.push(y * W + x);
      }
      rec._hit = { at: hitDraws, cells };
      return cells;
    }
    function drawHitboxes(renderer) {
      hitDraws += 1;
      const { ctx, camera, view } = renderer;
      const z = camera.zoom, size = Math.max(1, Math.round(z));
      const vx0 = camera.x - 2, vy0 = camera.y - 2, vx1 = camera.x + view.width / z + 2, vy1 = camera.y + view.height / z + 2;
      const groups = HIT_COLORS.map(() => []);
      const put = (lev, x, y) => { if (x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1) groups[lev].push(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z)); };
      // Standing buildings: their frame.
      for (const b of world.buildings || []) {
        if (b.body.right < vx0 || b.body.left > vx1 || b.body.top > vy1 || b.ground + 60 < vy0) continue;
        const cells = outline(b, b.body.left - 6, b.body.top - 6, b.body.right + 6, b.ground + 60,
          (x, y) => PW.getOwner(world, x, y) === b.id && structural[mat[y * W + x] & ID_MASK]);
        const h = world.hits && world.hits.get(b.id), lev = h ? hitLevel(h.v, h.t) : 0;
        for (const i of cells) put(lev, i % W, (i / W) | 0);
      }
      // Ruins lying where they fell.
      for (const r of world.ruins || []) {
        if (r.x1 < vx0 || r.x0 > vx1 || r.y1 < vy0 || r.y0 > vy1) continue;
        const cells = outline(r, r.x0, r.y0, r.x1, r.y1, (x, y) => (mat[y * W + x] & ID_MASK) === M.RUIN);
        const h = world.hits && world.hits.get(r.from), lev = h ? hitLevel(h.v, h.t) : 0;
        for (const i of cells) put(lev, i % W, (i / W) | 0);
      }
      // Falling pieces: the points of their outline, each by how hard it struck.
      for (const p of list) {
        const [c, s] = cosSin(p), pts = p.points;
        for (let k = 0; k < pts.length; k += 2) {
          const [wx, wy] = toWorld(p, c, s, pts[k], pts[k + 1]);
          put(p.hitV ? hitLevel(p.hitV[k >> 1], p.hitT[k >> 1]) : 0, wx, wy);
        }
      }
      for (let g = 0; g < groups.length; g += 1) {
        const l = groups[g];
        if (!l.length) continue;
        ctx.fillStyle = HIT_COLORS[g];
        ctx.beginPath();
        for (let k = 0; k < l.length; k += 2) ctx.rect(l[k], l[k + 1], size, size);
        ctx.fill();
      }
    }

    // (crush and sweep for whatever else drives through things: a tank ramming - see PW.tanks)
    return { spawn, step, draw, blast, drawHitboxes, list, stats, puff, crush, sweep };
  }

  PW.createFragments = createFragments;
})();
