'use strict';
// The slow "life" lane: a pass over the surface, a few dozen columns per tick (the whole map about
// every 9 s). Scorch marks fade, ash weathers into rich soil, fresh tufts sprout on grass, and farm
// fields grow from green shoots to golden wheat.
// And the Game of Life runs on the world's own grid (Conway's B3/S23, our own code): live cells are
// pixels in open air - born in an empty cell with three live neighbours, living on with two or
// three, dying of loneliness or crowding - and they are part of the world: they die where the air
// is filled (rubble, ground, water, a building), are burnt by heat and blown away by a blast. Two
// kinds run side by side, never counting each other: the green of regrowth, and the white the
// sandbox paints (see seed).
// Ground grows back by Life. Bare soil beside grass now and then sprouts a little green soup in
// the few cells over the surface; it lives by Life's rules - flickering, crawling along the
// ground as its patterns grow and break up - and the soil under each green cell lying on it turns
// to grass; it lives only a while (still lifes too), and dies away leaving the grass. Where trees
// and bushes were lost, once the grass is back, the plants still standing round it seed it again:
// a sapling or a young bush that grows up, slowly, to the size of what was lost.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;

  const COLUMNS_PER_TICK = 32;
  const TUFT = 0.05, SCORCH_FADE = 0.06, ASH_WEATHERS = 0.2;
  const CHIPS_ROT = 0.3;          // chance a visit (each column about every 9 s) the top of a litter of splinters rots a cell
  // Rubble lying out on the land weathers into it (N100): a cell of the heap a visit, now and then,
  // from its surface down, turns to dirt - one in WEATHER_KEEP stays, a lump of what it was, gone
  // dark with the dirt round it - down to WEATHER_DEPTH under the surface (what is buried deeper
  // stays). A heap is ground in some minutes, a mound of dirt with the ruin showing through it.
  const WEATHER = 0.25, WEATHER_DEPTH = 8, WEATHER_KEEP = 4;
  const WEATHER_TINT = [70, 58, 46];   // what a lump left in the dirt goes dark towards
  const WEATHER_FENCE = 96, WEATHER_FENCE_DOWN = 120;   // cells round a building being rebuilt it is left for the crews
  // The Game of Life.
  const LIFE_EVERY = 8;           // ticks per generation (7.5 a second)
  const GREEN = 1, WHITE = 2;     // the two kinds: regrowth, and the sandbox's
  const GROW_BAND = 6;            // cells over the ground a green cell can live in
  const GREEN_AGE = 60;           // generations a green cell lives at most
  const GREEN_GRASS = 0.12;       // chance a generation that a green cell lying on bare soil grasses it
  const SPROUT = 0.08;            // chance a visit that bare soil beside grass or green sprouts soup...
  const SPROUT_ALONE = 0.004;     // ...and bare soil with neither near
  const LIFE_MAX = 40000;         // live cells, at most
  const LIFE_HOT = 120;           // °C: a live cell this hot dies
  const GREEN_TONES = [[206, 255, 132], [158, 238, 96], [104, 196, 70]].map((c) => PW.abgr(c[0], c[1], c[2]));
  const WHITE_TONE = PW.abgr(232, 240, 236);
  const CROP_EVERY = 600, CROP_STEP = 0.05;   // fields grow by 5% every 10 s
  // Regrowth (see regrow and grow below).
  const REGROW_DELAY = 60 * 40;   // ticks after a plant is lost before anything takes where it stood
  const REGROW_EVERY = 10;        // ticks between looks at a place a plant was lost...
  const GROW_LOOK_EVERY = 10;     // ...and at a young plant
  const PARENT_REACH = 260;       // cells: a seedling comes from a grown plant standing this near
  const SPACING = { tree: 26, bush: 14 };   // no seedling closer than this to a plant standing
  const SEEDLING = { tree: 0.22, bush: 0.45 };   // what share of its full size it starts at
  const SEEDLING_MIN = { tree: 26, bush: 8 };
  const GROW_EVERY = 60 * 30;     // ticks between a young plant's growth steps
  const GROW_STEP = 0.13;         // ...each this share of its full size
  const LOST_EXPIRE = 60 * 600;   // ticks a place waits for grass and a plant near enough to seed it
  const YOUNG_MAX = 240;          // young plants growing at once, at most (on a map 16384 wide: so many to the width)
  // (N82: regrowth goes at the same pace on any map - each place a plant was lost, and each young
  // plant, is looked at about every LOOK_EACH ticks, however many there are; and what is big - a
  // seedling coming up, a young plant drawn again bigger - happens out of sight, never where the
  // player is looking: see view. Not in a deterministic run, which must not depend on the camera)
  const LOOK_EACH = 120;
  const LOOKS_MAX = 64;           // places or plants looked at a tick, at most
  const OUT_OF_SIGHT = 60;        // cells round the view still in sight

  // The live cells: world cell index -> a value (never 0), in typed arrays - a generation makes
  // some hundred thousand lookups, far quicker so than in a Map. The cells are listed in the
  // order they were put in (cells[0..n), -1 where one was taken out; vals alongside), so they are
  // walked as a Map would walk them, neighbours together; an open-addressed table finds a cell's
  // place in the list.
  const EMPTY = -1, GONE = -2;
  function createCells() {
    const t = { cells: new Int32Array(1024), vals: new Int32Array(1024), n: 0, size: 0, keys: null, at: null, used: 0, shift: 0 };
    const table = (cap) => { t.keys = new Int32Array(cap).fill(EMPTY); t.at = new Int32Array(cap); t.used = 0; t.shift = 32 - Math.log2(cap); };
    table(2048);
    const home = (i) => Math.imul(i, 0x9e3779b1) >>> t.shift;
    function find(i) {
      const K = t.keys, mask = K.length - 1;
      for (let s = home(i); ; s = (s + 1) & mask) { const k = K[s]; if (k === i) return t.at[s]; if (k === EMPTY) return -1; }
    }
    function index(i, p) {
      const K = t.keys, mask = K.length - 1;
      let s = home(i);
      while (K[s] !== EMPTY) s = (s + 1) & mask;
      K[s] = i; t.at[s] = p; t.used += 1;
    }
    t.get = (i) => { const p = find(i); return p < 0 ? 0 : t.vals[p]; };
    t.has = (i) => find(i) >= 0;
    t.set = (i, v) => {
      const p0 = find(i);
      if (p0 >= 0) { t.vals[p0] = v; return; }
      if (t.n === t.cells.length) {
        const c = new Int32Array(t.n * 2), w = new Int32Array(t.n * 2);
        c.set(t.cells); w.set(t.vals); t.cells = c; t.vals = w;
      }
      if ((t.used + 1) * 2 > t.keys.length) {
        // (the table full enough: laid out again, bigger if the list has grown)
        table(Math.max(t.keys.length, 1 << Math.ceil(Math.log2((t.size + 1) * 4))));
        for (let p = 0; p < t.n; p += 1) if (t.cells[p] >= 0) index(t.cells[p], p);
      }
      t.cells[t.n] = i; t.vals[t.n] = v;
      index(i, t.n);
      t.n += 1; t.size += 1;
    };
    t.delete = (i) => {
      const K = t.keys, mask = K.length - 1;
      for (let s = home(i); K[s] !== EMPTY; s = (s + 1) & mask) {
        if (K[s] === i) { t.cells[t.at[s]] = -1; K[s] = GONE; t.size -= 1; return; }
      }
    };
    t.clear = () => { if (t.n) { t.keys.fill(EMPTY); t.used = 0; t.n = 0; t.size = 0; } };
    return t;
  }

  function createLife(world) {
    const W = world.width;
    let cursor = 0, tick = 0;
    const stats = { regrown: 0, tufts: 0, unscorched: 0 };
    const rnd = (x, salt) => (PW.hash3(x, salt, tick) & 1023) / 1023;
    const topId = (x) => PW.get(world, x, world.groundTop[x]) & ID_MASK;
    // (wood splinters - loose, or packed as rubble - by the whole byte)
    const CHIPS = M.DEBRIS | PW.DEBRIS_KIND.WOOD << 6, PACKED_CHIPS = M.RUBBLE | PW.DEBRIS_KIND.WOOD << 6;
    const chipsAt = (x, y) => { const b = PW.get(world, x, y); return b === CHIPS || b === PACKED_CHIPS; };
    // (the top of a litter of splinters over or at the ground in column x - the ground's top as
    // the world keeps it is under loose splinters, on packed ones - rotted a cell, if it is its time)
    function rot(x, y) {
      let ty = chipsAt(x, y) ? y : chipsAt(x, y - 1) ? y - 1 : -1;
      if (ty < 0) return false;
      for (let k = 0; k < 80 && ty > 1 && chipsAt(x, ty - 1); k += 1) ty -= 1;
      // (it rots on the ground: splinters afloat on water are left as they are)
      let by = ty;
      while (by < world.height - 2 && chipsAt(x, by + 1)) by += 1;
      if ((PW.get(world, x, by + 1) & ID_MASK) === M.WATER) return true;
      if (rnd(x, 13) >= CHIPS_ROT) return true;
      const under = PW.get(world, x, ty + 1) & ID_MASK;
      if (under === M.TOPSOIL || under === M.SOIL || under === M.GRASS) PW.set(world, x, ty, M.TOPSOIL | (PW.hash2(x, ty) & 3) << 6, { quiet: true });
      else PW.set(world, x, ty, M.AIR, { quiet: true });
      stats.rotted = (stats.rotted || 0) + 1;
      return true;
    }
    // Rubble out on the land weathers into it (see WEATHER): in column x, ground's top at y, the
    // first cell of rubble from the surface down - under dirt it made, or lumps it left - turns to
    // dirt (topsoil at the surface), unless it is one of those it leaves; the lumps left over it go
    // dark as the dirt closes round them. Only rubble lying on the land itself - not on made ground
    // (a street, a pad, a bridge, the fill over the pipes), not in water, never against a supply
    // line's bore - and never where a ruined building is being rebuilt or re-founded (its crews
    // take the rubble for its stuff, and a core coming up shoulders rubble aside where dirt would
    // hold it - see fences).
    const NATURAL = new Uint8Array(64);
    for (const id of [M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.BEDROCK, M.SAND, M.LOOSE_SOIL, M.LOOSE_STONE]) NATURAL[id] = 1;
    const kept = (x, y) => (PW.hash3(x, y, 0x3a7) % WEATHER_KEEP) === 0;
    let fences = [], fencedAt = -1e9;
    function fenced(x, y) {
      if (tick - fencedAt >= 60) {
        fencedAt = tick; fences = [];
        const jobs = world.repair && world.repair.jobs;
        for (const b of world.buildings || []) {
          if (!b || !b.body) continue;
          if (!(b.ruined || b.underConstruction || b.coresOpen || b.refoundPending || (jobs && jobs.has && jobs.has(b.id)))) continue;
          fences.push([b.body.left - WEATHER_FENCE, b.body.right + WEATHER_FENCE, b.body.top, (b.ground ?? b.body.bottom) + WEATHER_FENCE_DOWN]);
        }
      }
      for (const [x0, x1, y0, y1] of fences) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
      return false;
    }
    // (a supply line's bore beside it: its pipe, its hollow, or a cell of the line)
    function byBore(x, y) {
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const id = PW.get(world, x + dx, y + dy) & ID_MASK;
        if (id === M.PIPE || (PW.getFlags(world, x + dx, y + dy) & FLAG.HOLLOW) || PW.getOwner(world, x + dx, y + dy) >= 60000) return true;
      }
      return false;
    }
    function weather(x, y) {
      let yc = -1;
      for (let d = 0; d < WEATHER_DEPTH; d += 1) {
        const b = PW.get(world, x, y + d), id = b & ID_MASK;
        if (id === M.RUBBLE && b !== PACKED_CHIPS && !kept(x, y + d)) { yc = y + d; break; }
        if (id !== M.RUBBLE && !NATURAL[id]) return false;   // (dirt it made, or lumps it left, over it - nothing else)
      }
      if (yc < 0) return false;
      // (what the heap lies on: the land - not made ground, not water)
      let by = yc + 1;
      while (by < world.height - 1 && by - yc < 64 && (PW.get(world, x, by) & ID_MASK) === M.RUBBLE) by += 1;
      if (!NATURAL[PW.get(world, x, by) & ID_MASK]) return true;
      if (PW.getOwner(world, x, yc) || fenced(x, yc) || byBore(x, yc)) return true;
      if (rnd(x, 17) >= WEATHER) return true;
      PW.set(world, x, yc, (yc === y ? M.TOPSOIL : M.SOIL) | (PW.hash2(x, yc) & 3) << 6, { quiet: true });
      PW.setLayer(world, 'paint', x, yc, 0);
      // (the lumps left just over it, gone dark)
      for (let yy = yc - 1; yy >= y && (PW.get(world, x, yy) & ID_MASK) === M.RUBBLE; yy -= 1) {
        const p = PW.getLayer(world, 'paint', x, yy);
        if (!p) continue;
        const r = p & 255, g = (p >>> 8) & 255, bl = (p >>> 16) & 255;
        PW.setLayer(world, 'paint', x, yy, PW.abgr(Math.round(r * 0.55 + WEATHER_TINT[0] * 0.45), Math.round(g * 0.55 + WEATHER_TINT[1] * 0.45), Math.round(bl * 0.55 + WEATHER_TINT[2] * 0.45), (p >>> 24) & 255));
      }
      stats.weatheredRubble = (stats.weatheredRubble || 0) + 1;
      return true;
    }
    // ---- The Game of Life -----------------------------------------------------------------------------
    const H = world.height, mat = world.mat;
    let live = createCells(), spare = createCells();   // world cell index -> kind | age << 2 (age in generations)
    const NEAR = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    // (can a cell of `kind` live at (x, y)? Open air - air or gas, not inside a building - and,
    // green, in the band just over the ground)
    const { CHUNK_SHIFT: CS, CHUNK_MASK: CM } = PW, chunksX = world.chunksX, phase = PW.mat.phase, GAS = PW.PHASE.GAS;
    function room(x, y, kind) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      // (on a core's disc the white lives in the core's own body - see the cores' energy below - and
      // never in its nucleus or just past its rim)
      if (kind === WHITE && discOf.size) {
        const i = y * W + x, e = discOf.get(i);
        if (e) return e.vigor > 0 && coreHome(world, x, y);
        if (edgeOf.has(i)) return false;
      }
      const id = mat[y * W + x] & ID_MASK;
      if (id !== M.AIR && phase[id] !== GAS) return false;
      const backs = world.back[(y >> CS) * chunksX + (x >> CS)];
      if (backs && backs[(y & CM) << CS | (x & CM)]) return false;
      if (kind === GREEN) { const g = world.groundTop[x]; return y < g && y >= g - GROW_BAND; }
      return true;
    }
    const hot = (x, y) => world.heatList && world.heatList.length && PW.heatAt(world, x, y) > LIFE_HOT;
    // (burnt by the heat - not on a core's disc: the core's own energy, the god's metal's)
    const burns = (i, x, y) => hot(x, y) && !(discOf.size && discOf.has(i));
    // (a fire anywhere close: warm air or ground within a few cells - nothing grows back there yet)
    function warmNear(x, y) {
      if (!world.heatList || !world.heatList.length) return false;
      for (let dy = -8; dy <= 4; dy += 4) for (let dx = -12; dx <= 12; dx += 4) if (PW.heatAt(world, x + dx, y + dy) > 45) return true;
      return false;
    }
    // A little green soup sprouting over bare ground at column x (ground top y): a few cells of
    // the band over it, about half of them alive.
    function sprout(x, y) {
      if (live.size >= LIFE_MAX) return;
      for (let dx = -4; dx <= 4; dx += 1) {
        for (let dy = 1; dy <= 4; dy += 1) {
          const cx = x + dx, cy = world.groundTop[Math.max(0, Math.min(W - 1, cx))] - dy;
          if ((PW.hash3(cx, cy, tick) & 1023) < 520 && room(cx, cy, GREEN)) live.set(cy * W + cx, GREEN);
        }
      }
      stats.sprouted = (stats.sprouted || 0) + 1;
      void y;
    }
    // (the neighbour counts: kept in blocks of 32 x 32 cells, a byte a cell - green's count in its
    // low four bits, white's in the high four - and each cell whose count comes to three is listed
    // as it does, so births are looked for only there. A generation is a few passes over the live
    // cells, however many there are; the blocks are kept for the next one.)
    const BS = 5, BN = 1 << BS, BM = BN - 1, BW = Math.ceil(W / BN);
    const NEAR_B = [-BN - 1, -BN, -BN + 1, -1, 1, BN - 1, BN, BN + 1], NEAR_X = [-1, 0, 1, -1, 1, -1, 0, 1], NEAR_Y = [-1, -1, -1, 0, 0, 1, 1, 1];
    const blocks = new Map(), pool = [];
    let threes = new Int32Array(4096), nThrees = 0;
    // (the live cells come round in clusters: the last block looked up is kept to hand)
    let lastKey = -1, lastBlock = null;
    function blockOf(x, y) {
      const key = (y >> BS) * BW + (x >> BS);
      if (key === lastKey) return lastBlock;
      let b = blocks.get(key);
      if (!b) { b = pool.pop() || new Uint8Array(BN * BN); blocks.set(key, b); }
      lastKey = key; lastBlock = b;
      return b;
    }
    function three(i, kind) {
      if (nThrees === threes.length) { const t = new Int32Array(nThrees * 2); t.set(threes); threes = t; }
      threes[nThrees++] = i * 4 + kind;
    }
    function countAt(x, y, shift) {
      const key = (y >> BS) * BW + (x >> BS), b = key === lastKey ? lastBlock : blocks.get(key);
      if (!b) return 0;
      lastKey = key; lastBlock = b;
      return (b[(y & BM) << BS | (x & BM)] >> shift) & 15;
    }
    // One generation of Life for every live cell at once (each kind counting its own only).
    function generation() {
      if (!live.size) return;
      nThrees = 0;
      const K = live.cells, V = live.vals, n0 = live.n;
      for (let s = 0; s < n0; s += 1) {
        const i = K[s];
        if (i < 0) continue;
        const kind = V[s] & 3, add = kind === GREEN ? 1 : 16, shift = kind === GREEN ? 0 : 4;
        const x = i % W, y = (i / W) | 0, lx = x & BM, ly = y & BM;
        if (lx > 0 && lx < BM && ly > 0 && ly < BM) {
          // (inside its block: all eight neighbours are in it too)
          const b = blockOf(x, y), l = ly << BS | lx;
          for (let k = 0; k < 8; k += 1) {
            const c = b[l + NEAR_B[k]] + add;
            b[l + NEAR_B[k]] = c;
            if ((c >> shift & 15) === 3) three(i + NEAR[k], kind);
          }
        } else {
          for (let k = 0; k < 8; k += 1) {
            const nx = x + NEAR_X[k], ny = y + NEAR_Y[k], b = blockOf(nx, ny), l = (ny & BM) << BS | (nx & BM);
            const c = b[l] + add;
            b[l] = c;
            if ((c >> shift & 15) === 3) three(i + NEAR[k], kind);
          }
        }
      }
      const next = spare;
      next.clear();
      // (live on with two or three neighbours, where it still has room, not burnt, not too old)
      for (let s = 0; s < n0; s += 1) {
        const i = K[s];
        if (i < 0) continue;
        const v = V[s], kind = v & 3, age = v >> 2;
        const x = i % W, y = (i / W) | 0, n = countAt(x, y, kind === GREEN ? 0 : 4);
        if ((n === 2 || n === 3) && room(x, y, kind) && !(kind === GREEN && age >= GREEN_AGE) && !burns(i, x, y)) next.set(i, kind | (age + 1) << 2);
      }
      // (born in an empty cell with exactly three - still three: a count that went on past it is not)
      for (let t = 0; t < nThrees && next.size < LIFE_MAX; t += 1) {
        const key = threes[t], i = key >> 2, kind = key & 3;
        const x = i % W, y = (i / W) | 0;
        if (countAt(x, y, kind === GREEN ? 0 : 4) !== 3 || live.has(i) || next.has(i)) continue;
        if (room(x, y, kind) && !burns(i, x, y)) next.set(i, kind);
      }
      for (const b of blocks.values()) { b.fill(0); pool.push(b); }
      blocks.clear(); lastKey = -1; lastBlock = null;
      spare = live; live = next;
      // (green lying on bare soil grasses it)
      const LK = live.cells, LV = live.vals;
      for (let s = 0, n1 = live.n; s < n1; s += 1) {
        const i = LK[s];
        if (i < 0 || (LV[s] & 3) !== GREEN) continue;
        const x = i % W, y = (i / W) | 0;
        if (y !== world.groundTop[x] - 1) continue;
        const gid = mat[(y + 1) * W + x] & ID_MASK;
        // (not ground still scorched or warm from a fire: it would only feed the fire again)
        if ((gid !== M.TOPSOIL && gid !== M.SOIL) || PW.getOwner(world, x, y + 1) || (PW.getFlags(world, x, y + 1) & (FLAG.ROAD | FLAG.FIELD | FLAG.SCORCH))) continue;
        if (warmNear(x, y)) continue;
        if ((PW.hash3(x, y, tick) & 1023) >= GREEN_GRASS * 1024) continue;
        PW.set(world, x, y + 1, M.GRASS | (PW.hash2(x, y) & 3) << 6, { quiet: true });
        PW.setLayer(world, 'paint', x, y + 1, 0);
        stats.regrown += 1;
      }
      stats.live = live.size;
      stats.generations = (stats.generations || 0) + 1;
    }
    // The sandbox's Life: white cells painted in a disc (about half of its open cells alive).
    function seed(x, y, radius, kind = WHITE) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius || live.size >= LIFE_MAX) continue;
          const cx = Math.round(x + dx), cy = Math.round(y + dy);
          if ((PW.hash3(cx, cy, tick) & 1023) < 512 && room(cx, cy, kind)) live.set(cy * W + cx, kind);
        }
      }
    }
    // A blast blows away the live cells it reaches.
    function clear(x0, y0, x1, y1) {
      if (!live.size) return;
      const K = live.cells;
      for (let s = 0, n = live.n; s < n; s += 1) {
        const i = K[s];
        if (i < 0) continue;
        const x = i % W, y = (i / W) | 0;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) live.delete(i);
      }
    }
    // Live cells drawn as the world's pixels: green by its age (bright when new), white.
    function draw(renderer) {
      const { ctx, camera, view } = renderer;
      const z = camera.zoom, size = Math.max(1, Math.round(z));
      const x0 = camera.x, y0 = camera.y, x1 = x0 + view.width / z, y1 = y0 + view.height / z;
      // (what the player sees: big regrowth waits until it is out of it - see inSight)
      sight = { x0: x0 - OUT_OF_SIGHT, y0: y0 - OUT_OF_SIGHT, x1: x1 + OUT_OF_SIGHT, y1: y1 + OUT_OF_SIGHT };
      if (!live.size) return;
      const groups = new Map(), K = live.cells, V = live.vals;
      for (let s = 0, n = live.n; s < n; s += 1) {
        const i = K[s];
        if (i < 0) continue;
        const x = i % W, y = (i / W) | 0;
        if (x < x0 - 1 || x > x1 || y < y0 - 1 || y > y1) continue;
        const v = V[s], kind = v & 3, age = v >> 2;
        const c = kind === WHITE ? WHITE_TONE : GREEN_TONES[age < 6 ? 0 : age < 20 ? 1 : 2];
        let list = groups.get(c);
        if (!list) groups.set(c, list = []);
        list.push(Math.round((x - x0) * z), Math.round((y - y0) * z));
      }
      for (const [c, list] of groups) {
        ctx.fillStyle = `rgb(${c & 255},${c >>> 8 & 255},${c >>> 16 & 255})`;
        ctx.beginPath();
        for (let k = 0; k < list.length; k += 2) ctx.rect(list[k], list[k + 1], size, size);
        ctx.fill();
      }
    }
    // (tilled ground carries the FIELD flag on its surface)
    function inField(x) {
      const y = world.groundTop[x];
      return (PW.getFlags(world, x, y) & PW.FLAG.FIELD) !== 0 || (PW.getFlags(world, x - 1, world.groundTop[Math.max(0, x - 1)]) & PW.FLAG.FIELD) !== 0;
    }
    function visit(x) {
      const y = world.groundTop[x];
      if (y <= 0 || y >= world.height - 1) return;
      const id = topId(x);
      const flags = PW.getFlags(world, x, y);
      // Scorch fades from the surface and the rock just under it. (A building keeps its scorch
      // until it is repaired.)
      for (let d = 0; d < 4; d += 1) {
        const owner = PW.getOwner(world, x, y + d);
        if (owner > 0 && owner < 50000) continue;
        if ((PW.getFlags(world, x, y + d) & FLAG.SCORCH) && rnd(x, 11 + d) < SCORCH_FADE) {
          PW.setLayer(world, 'paint', x, y + d, 0);
          PW.setFlag(world, x, y + d, FLAG.SCORCH, false);
          stats.unscorched += 1;
        }
      }
      if (flags & FLAG.ROAD || PW.getOwner(world, x, y)) return;
      // Wood splinters lying out in the open rot away (N85): the top of a litter of them goes a
      // cell at a visit now and then - to nothing, or, the last of it lying on soil, into the soil,
      // making it rich - until the ground shows again and the green comes back over it.
      if (rot(x, y)) return;
      // Rubble lying out on the land weathers into it (N100).
      if (weather(x, y)) return;
      // Ash left by a fire weathers into the soil under it, and makes it rich.
      if (id === M.ASH) {
        const under = PW.get(world, x, y + 1) & ID_MASK;
        if ((under === M.TOPSOIL || under === M.SOIL || under === M.GRASS || under === M.ASH) && rnd(x, 7) < ASH_WEATHERS) {
          // (still a burn scar: the green comes back once its scorch has faded)
          PW.set(world, x, y, M.TOPSOIL | (PW.hash2(x, y) & 3) << 6, { quiet: true });
          PW.setFlag(world, x, y, FLAG.SCORCH);
          stats.weathered = (stats.weathered || 0) + 1;
        }
        return;
      }
      if ((id === M.TOPSOIL || id === M.SOIL) && !inField(x)) {
        // Bare soil sprouts a little green Life soup over it, beside grass now and then, and
        // rarely on its own (once its scorch has faded): the soup grasses it (see generation).
        let near = false;
        for (let dx = -3; dx <= 3 && !near; dx += 1) {
          if (!dx || x + dx < 0 || x + dx >= W) continue;
          const g = world.groundTop[x + dx];
          if (topId(x + dx) === M.GRASS && Math.abs(g - y) <= 3) near = true;
          for (let dy = 1; dy <= GROW_BAND && !near; dy += 1) if ((live.get((g - dy) * W + x + dx) & 3) === GREEN) near = true;
        }
        if (rnd(x, 3) < (near ? SPROUT : SPROUT_ALONE) && !(PW.getFlags(world, x, y) & FLAG.SCORCH)) sprout(x, y);
        return;
      }
      if (id === M.GRASS && rnd(x, 5) < TUFT && PW.flora && !PW.getLayer(world, 'deco', x, y - 1)
        && (PW.get(world, x, y - 1) & ID_MASK) === M.AIR) {
        if (PW.flora.tuft(world, x, y, 2 + (PW.hash3(x, y, tick) & 3))) stats.tufts += 1;
      }
    }
    // ---- Regrowth -----------------------------------------------------------------------------------
    const kindOf = (type) => (type === 'bush' ? 'bush' : 'tree');
    // (is a plant alive - not a burnt snag: some leaf of it still green? Looked at sparsely, and
    // remembered a while)
    function living(r) {
      if (r.liveAt !== undefined && tick - r.liveAt < 600) return r.live;
      const { mask, x: x0, y: y0, width: w, height: h } = r, n = w * h;
      let live = false;
      for (let k = (PW.hash2(r.anchorX, tick) % 13), seen = 0; k < n && seen < 400 && !live; k += 13) {
        if (!(mask[k >> 3] >> (k & 7) & 1)) continue;
        seen += 1;
        const f = PW.getFlags(world, x0 + (k % w), y0 + ((k / w) | 0));
        if ((f & FLAG.FLORA) && !(f & (FLAG.WOOD | FLAG.CHARRED))) live = true;
      }
      r.liveAt = tick; r.live = live;
      return live;
    }
    // A grown, living tree or bush near x (of `type`, if one stands near enough), nearest first.
    function parentNear(x, type) {
      let best = null, bestD = PARENT_REACH, same = null, sameD = PARENT_REACH;
      for (const r of world.flora || []) {
        if (r.felled || r.fallen || (r.kind !== 'tree' && r.kind !== 'bush') || r.type === 'deadTree') continue;
        if (r.grow && r.size < r.grow.full * 0.5) continue;
        const d = Math.abs(r.anchorX - x);
        if (d >= bestD && (d >= sameD || r.type !== type)) continue;
        if (!living(r)) continue;
        if (d < bestD) { best = r; bestD = d; }
        if (r.type === type && d < sameD) { same = r; sameD = d; }
      }
      return same || best;
    }
    // Is column x ground a plant can take on: grass, gentle, open over it, no road or field or
    // building, and no tree or bush standing too near?
    function takes(x, kind) {
      if (x < 2 || x >= W - 2) return false;
      const y = world.groundTop[x];
      if ((PW.get(world, x, y) & ID_MASK) !== M.GRASS || PW.getOwner(world, x, y)) return false;
      if (PW.getFlags(world, x, y) & (FLAG.ROAD | FLAG.FIELD | FLAG.NOBUILD)) return false;
      if (Math.abs(world.groundTop[Math.min(W - 1, x + 6)] - world.groundTop[Math.max(0, x - 6)]) > 8) return false;
      for (let d = 1; d <= 30; d += 1) if ((PW.get(world, x, y - d) & ID_MASK) !== M.AIR || PW.getLayer(world, 'back', x, y - d)) return false;
      const gap = SPACING[kind];
      for (const r of world.flora || []) {
        if (r.felled || r.fallen || (r.kind !== 'tree' && r.kind !== 'bush')) continue;
        if (Math.abs(r.anchorX - x) < Math.max(gap, SPACING[r.kind] || gap)) return false;
      }
      return true;
    }
    // (the player's view, as last drawn - null before the first frame)
    let sight = null;
    const inSight = (x0, y0, x1, y1) => !PW.DETERMINISTIC && !!sight && x1 >= sight.x0 && x0 <= sight.x1 && y1 >= sight.y0 && y0 <= sight.y1;
    // (so many looks this time that each of `count` comes round about every LOOK_EACH ticks)
    const looksFor = (count, every) => Math.min(LOOKS_MAX, Math.max(1, Math.ceil(count * every / LOOK_EACH)));
    const youngMax = () => Math.max(24, Math.round(YOUNG_MAX * W / 16384));
    // The places plants were lost are looked at in turn: in time, once grass is back on one, a
    // grown plant standing near seeds it - of the kind that was lost, if one of that kind is near
    // enough.
    let lostAt = 0;
    function regrow() {
      const lost = world.floraLost;
      if (!lost || !lost.length || !PW.flora || !PW.flora.plant) return;
      for (let k = 0, n = looksFor(lost.length, REGROW_EVERY); k < n && lost.length; k += 1) regrowOne(lost);
    }
    function regrowOne(lost) {
      if ((world.floraYoung || []).length >= youngMax()) return;
      if (lostAt >= lost.length) lostAt = 0;
      const spot = lost[lostAt];
      if ((world.tick || 0) - spot.at < REGROW_DELAY) { lostAt += 1; return; }
      // (a place waits for the grass to come back over it - see the Game of Life - and for a plant
      // near enough to seed it; left bare or out of reach that long, it is given up)
      if ((world.tick || 0) - spot.at > LOST_EXPIRE) { lost.splice(lostAt, 1); return; }
      // (and for the player to look away: a seedling does not come up before his eyes)
      const gy = world.groundTop[Math.max(0, Math.min(W - 1, spot.x))];
      if (inSight(spot.x - 40, gy - 80, spot.x + 40, gy)) { lostAt += 1; return; }
      const parent = parentNear(spot.x, spot.type);
      if (parent) {
        const type = parent.type, kind = kindOf(type);
        for (let t = 0; t < 4; t += 1) {
          const x = spot.x + ((PW.hash3(spot.x, t, tick) % 25) - 12);
          if (!takes(x, kind)) continue;
          const full = type === spot.type ? spot.size : parent.size * (0.8 + (PW.hash2(x, 7) & 15) / 75);
          const size = Math.max(SEEDLING_MIN[kind], full * SEEDLING[kind]);
          const record = PW.flora.plant(world, type, x, { size, seed: PW.hash3(x, tick, 31) || 1, look: type === spot.type ? spot.look || undefined : parent.look || undefined, unveil: true });
          record.grow = { full: Math.max(size, full), at: world.tick || 0 };
          (world.floraYoung || (world.floraYoung = [])).push(record);
          lost.splice(lostAt, 1);
          stats.seeded = (stats.seeded || 0) + 1;
          return;
        }
      }
      lostAt += 1;
    }
    // Pull a plant's drawing out of the world (to draw it again bigger).
    function uproot(r) {
      const { mask, x: x0, y: y0, width: w, height: h } = r;
      for (let k = 0; k < w * h; k += 1) {
        if (!(mask[k >> 3] >> (k & 7) & 1)) continue;
        const x = x0 + (k % w), y = y0 + ((k / w) | 0);
        if (!(PW.getFlags(world, x, y) & FLAG.FLORA)) continue;
        PW.setLayer(world, 'deco', x, y, 0);
        PW.setFlag(world, x, y, FLAG.FLORA | FLAG.WOOD | FLAG.CHARRED, false);
      }
      const i = world.flora.indexOf(r);
      if (i >= 0) world.flora.splice(i, 1);
      world.floraIndex = null;
    }
    // The young plants are looked at in turn: now and then, while one stands whole and green on its
    // ground, it grows a step towards its full size - drawn again a little bigger where it stands,
    // out of the player's sight. (Struck, burnt, felled or fallen, it grows no more.)
    let youngAt = 0;
    function grow() {
      const young = world.floraYoung;
      if (!young || !young.length) return;
      for (let k = 0, n = looksFor(young.length, GROW_LOOK_EVERY); k < n && young.length; k += 1) growOne(young);
    }
    function growOne(young) {
      if (youngAt >= young.length) youngAt = 0;
      const r = young[youngAt];
      if (r.felled || r.fallen || r.hit || !world.flora.includes(r) || !living(r)) { young.splice(youngAt, 1); return; }
      if ((world.tick || 0) - r.grow.at < GROW_EVERY) { youngAt += 1; return; }
      if (inSight(r.x - r.width, r.y - r.height, r.x + 2 * r.width, r.y + r.height)) { youngAt += 1; return; }
      const size = Math.min(r.grow.full, r.size + r.grow.full * GROW_STEP);
      const x = r.anchorX, row = world.groundTop[x];
      // (its ground gone from under it: the plants' footing sees to it)
      if (Math.abs(row - r.row) > 3) { r.grow.at = world.tick || 0; youngAt += 1; return; }
      uproot(r);
      const next = PW.flora.plant(world, r.type, x, { row, size, seed: r.seed, look: r.look || undefined, unveil: true });
      stats.grown = (stats.grown || 0) + 1;
      if (size < r.grow.full) { next.grow = { full: r.grow.full, at: world.tick || 0 }; young[youngAt] = next; youngAt += 1; }
      else young.splice(youngAt, 1);
    }
    // ---- The cores' energy (D15): this same Life, white, on each core's disc ---------------------------
    // A core stepped (PW.coreLife.step, from the cores' own step) is entered here with its disc - the
    // ring of world cells round its nucleus (CORE_RING_AT) - and the white Life of the world lives on
    // that ring in the core's own body: its cells, its steel bed and the open air about it (room),
    // never burnt by its heat (burns), never in its black nucleus nor out past its rim (CORE_EDGE_AT:
    // the ring is its whole world). Its energy comes out of its heart: each generation, now and then,
    // a spark of white cells at the nucleus's edge, mostly at the poles, more when it runs low and
    // the more stirred the core is; a dead core's disc is no home (its Life dies at once). The
    // world's Life does the rest - the rule, the blast that blows cells away (clear), the look (draw).
    // When the ball moves (rising, sinking home) its disc goes with it, its live cells carried along.
    const coreOf = new Map();        // core -> its entry { core, x, y, vigor, seen, shock, stirred }
    const discOf = new Map();        // world cell of a disc's ring -> its entry
    const edgeOf = new Map();        // world cell of a disc's nucleus or just past its rim -> its entry
    const cellsAt = (offs) => (e, fn) => {
      for (let k = 0; k < offs.length; k += 2) {
        const x = e.x + offs[k], y = e.y + offs[k + 1];
        if (x >= 1 && y >= 1 && x < W - 1 && y < H - 1) fn(y * W + x, x, y);
      }
    };
    const ringCells = cellsAt(CORE_RING_AT), edgeCells = cellsAt(CORE_EDGE_AT);
    function enter(e) { ringCells(e, (i) => discOf.set(i, e)); edgeCells(e, (i) => { if (!edgeOf.has(i)) edgeOf.set(i, e); }); }
    function leave(e) {
      ringCells(e, (i) => { if (discOf.get(i) === e) discOf.delete(i); });
      edgeCells(e, (i) => { if (edgeOf.get(i) === e) edgeOf.delete(i); });
      // (a disc it overlapped takes its cells back)
      for (const o of coreOf.values()) if (o !== e && Math.abs(o.x - e.x) <= 2 * CORE_H + 4 && Math.abs(o.y - e.y) <= 2 * CORE_H + 4) enter(o);
    }
    function coreTick(core, vigor) {
      const cx = Math.round(core.x), cy = Math.round(core.y);
      let e = coreOf.get(core);
      if (!e) { e = { core, x: cx, y: cy, vigor, seen: tick, shock: 0, stirred: 0 }; coreOf.set(core, e); enter(e); }
      e.vigor = vigor; e.seen = tick;
      if (cx !== e.x || cy !== e.y) {
        const moved = [];
        ringCells(e, (i) => { if (discOf.get(i) !== e) return; const v = live.get(i); if (v) { moved.push(i, v); live.delete(i); } });
        leave(e);
        const shift = (cy - e.y) * W + (cx - e.x);
        e.x = cx; e.y = cy;
        enter(e);
        for (let k = 0; k < moved.length; k += 2) if (!live.has(moved[k] + shift)) live.set(moved[k] + shift, moved[k + 1]);
      }
    }
    function coreSpark(e, h, anywhere) {
      const u = (h & 1023) / 1023, w = (h >>> 10 & 1023) / 1023;
      const a = !anywhere && u < CORE_POLES ? ((h >>> 20) & 1 ? -1 : 1) * Math.PI / 2 + (w - 0.5) * 0.7 : w * Math.PI * 2;
      const sx = e.x + Math.round(Math.cos(a) * (CORE_IN + 1.2)), sy = e.y + Math.round(Math.sin(a) * (CORE_IN + 1.2));
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const x = sx + dx, y = sy + dy, i = y * W + x;
        if (discOf.get(i) !== e || (PW.hash3(h, dx, dy) & 1023) >= 560 || live.has(i) || live.size >= LIFE_MAX || !room(x, y, WHITE)) continue;
        live.set(i, WHITE);
      }
    }
    function coreSparks() {
      const gen = stats.generations || 0;
      for (const e of coreOf.values()) {
        // (a core no longer stepped - sealed home in its vault, gone: its disc is let go)
        if (tick - e.seen > LIFE_EVERY * 2) { leave(e); coreOf.delete(e.core); continue; }
        if (e.vigor <= 0) continue;
        const salt = (e.x * 7 + e.y * 13) | 0;
        if (e.shock > 0) {
          for (let s = 0, n = 2 + Math.round(e.shock * 5); s < n; s += 1) coreSpark(e, PW.hash3(salt, gen, 900 + s), true);
          e.stirred = Math.max(e.stirred, Math.round(e.shock * 8));   // (generations: about a second)
          e.shock = 0;
        }
        let pop = 0;
        ringCells(e, (i) => { if (live.has(i)) pop += 1; });
        const stir = e.vigor + (e.stirred > 0 ? 1 : 0);
        if (e.stirred > 0) e.stirred -= 1;
        const p = Math.min(1, CORE_SPARK * stir + (pop < CORE_LOW ? 0.6 : 0));
        if ((PW.hash3(salt, gen, 77) & 1023) / 1023 < p) coreSpark(e, PW.hash3(salt, gen, 78), false);
      }
    }
    // (a blast shakes the cores in its reach: a burst of sparks next generation, stirred a while -
    // the cells it blows away, clear does)
    function coreShock(x, y, r, power) {
      const reach = r * 3 + CORE_OUT;
      for (const e of coreOf.values()) {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < reach) e.shock = Math.max(e.shock, Math.min(1, power * (1 - d / reach)));
      }
    }
    const coreCells = (core) => { const e = coreOf.get(core); let n = 0; if (e) ringCells(e, (i) => { if (live.has(i)) n += 1; }); return n; };
    // (where no page runs this Life - the capital lab - the cores' step runs it for the cores alone,
    // a generation at the same rhythm, and each core's disc is drawn as draw draws the white)
    function stepCores() {
      tick += 1;
      if (tick % LIFE_EVERY === 0) { generation(); if (coreOf.size) coreSparks(); }
    }
    function drawCore(renderer, core) {
      const e = coreOf.get(core);
      if (!e) return;
      const { ctx, camera } = renderer, z = camera.zoom, size = Math.max(1, Math.round(z));
      ctx.fillStyle = `rgb(${WHITE_TONE & 255},${WHITE_TONE >>> 8 & 255},${WHITE_TONE >>> 16 & 255})`;
      ctx.beginPath();
      ringCells(e, (i, x, y) => { if (discOf.get(i) === e && (live.get(i) & 3) === WHITE) ctx.rect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), size, size); });
      ctx.fill();
    }
    function step() {
      tick += 1;
      if (tick % LIFE_EVERY === 0) { generation(); if (coreOf.size) coreSparks(); }
      if (tick % REGROW_EVERY === 0) regrow();
      if (tick % GROW_LOOK_EVERY === 5) grow();
      // (every column comes round as often on a wider map: about every 8.5 s)
      for (let k = 0, n = Math.ceil(COLUMNS_PER_TICK * W / 16384); k < n; k += 1) {
        visit(cursor);
        cursor = (cursor + 1) % W;
      }
      if (tick % CROP_EVERY === 0 && PW.settlementTools) {
        for (const b of world.buildings || []) {
          for (const field of [b.field, b.lotField]) {
            if (!field || field.growth >= 1) continue;
            field.growth = Math.min(1, field.growth + CROP_STEP);
            PW.settlementTools.drawCrop(world, field);
          }
        }
      }
      return stats;
    }
    // Run many passes at once (tests, fast-forward).
    function advance(ticks) { for (let t = 0; t < ticks; t += 1) step(); return stats; }
    // (one live cell put exactly, where it has room: patterns for the tests)
    const put = (x, y, kind = WHITE) => { if (room(x, y, kind)) live.set(y * W + x, kind); };
    const api = { step, advance, stats, seed, put, clear, draw, sprout, generation, parentNear, living, inSight, get cells() { return live.size; }, at: (x, y) => live.get(y * W + x) || 0, GREEN, WHITE,
      coreTick, coreShock, coreCells, coreSparks, stepCores, drawCore, coreEntry: (core) => coreOf.get(core) || null, get cores() { return coreOf.size; } };
    world.lifeGame = api;
    return api;
  }

  PW.createLife = createLife;

  // ---- The core's energy (D15) ------------------------------------------------------------------------
  // A core's white energy is the world's own Game of Life (createLife above: its code, its rule
  // B3/S23, its physics, its look), living on the core's disc: the ring round its black nucleus out
  // to the rim of its bed's recess (CORE_IN < r <= CORE_OUT cells from its centre), at the world's
  // rhythm, white as the LIFE tool paints it. Its energy comes out of the white heart: now and then a
  // spark of white cells is struck at the nucleus's edge, most often at the poles (the lightning
  // crowds the poles), and Life takes it from there - flaring, crawling out along the ring, breaking
  // up, dying at the rim; a spark whenever the ring runs low, and more of them the more stirred the
  // core is (vigor: 0 a dead core - no home for its Life, the ball goes dark - 1 at rest, 2 rising or
  // floating). It lives by the world's Life's physics, in the core's context: in the core's own body,
  // its steel bed and the open air about it; where rubble, ground or water fill a cell of its disc,
  // the Life there is smothered (a core buried in a heap goes dim); a blast near it blows its cells
  // away as it blows any Life away, and shakes it - a burst of sparks, and stirred a while.
  // PW.coreLife is the cores' handle on it: step (each tick, from the cores' own step), draw (the
  // world's Life draws the cells; only where no page runs it does the core draw its own disc) and
  // blast (from PW.explode).
  const CORE_IN = 2.4, CORE_OUT = 8.4, CORE_H = 9, CORE_EDGE = 1.5;
  const CORE_SPARK = 0.5, CORE_LOW = 10, CORE_POLES = 0.8;
  // (the disc's cells as (dx, dy) pairs from its centre: the ring, and its edge - the nucleus and a
  // band just past the rim, where its Life is never born)
  const CORE_RING_AT = [], CORE_EDGE_AT = [];
  for (let dy = -CORE_H - 2; dy <= CORE_H + 2; dy += 1) for (let dx = -CORE_H - 2; dx <= CORE_H + 2; dx += 1) {
    const r = Math.hypot(dx, dy);
    if (r > CORE_IN && r <= CORE_OUT) CORE_RING_AT.push(dx, dy);
    else if (r <= CORE_OUT + CORE_EDGE) CORE_EDGE_AT.push(dx, dy);
  }
  // (its home: the core's body, steel, or open air - not rubble, ground, water or anything else)
  function coreHome(world, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
    const id = world.mat[y * world.width + x] & ID_MASK;
    return id === M.CORE || id === M.STEEL || PW.mat.phase[id] <= PW.PHASE.GAS;
  }
  // (the world's Life - or, on a page that runs none, one the cores run for themselves)
  function lifeOf(world) {
    if (world.lifeGame && world.lifeGame.coreTick) return world.lifeGame;
    if (!world.groundTop || !world.back) return null;
    const life = createLife(world);
    life.coresOnly = true; life.ranAt = -1;
    return life;
  }
  const DRAWS_OWN = new WeakMap();   // core -> the cores-only Life that draws its disc
  function coreStep(world, core, vigor = 1) {
    const life = lifeOf(world);
    if (!life) return;
    if (life.coresOnly) {
      if (life.ranAt !== world.tick) { life.ranAt = world.tick; life.stepCores(); }
      DRAWS_OWN.set(core, life);
    } else if (DRAWS_OWN.has(core)) DRAWS_OWN.delete(core);   // (the page has since run its own)
    life.coreTick(core, vigor);
  }
  function coreDraw(renderer, core) {
    const life = DRAWS_OWN.get(core);
    if (life) life.drawCore(renderer, core);
  }
  // A blast shakes the cores in its reach: the nearer and harder, the more.
  function coreBlast(world, x, y, r, power = 1) {
    if (world.lifeGame && world.lifeGame.coreShock) world.lifeGame.coreShock(x, y, r, power);
  }
  PW.coreLife = { step: coreStep, draw: coreDraw, blast: coreBlast, home: coreHome, IN: CORE_IN, OUT: CORE_OUT,
    cells: (world, core) => (world.lifeGame && world.lifeGame.coreCells ? world.lifeGame.coreCells(core) : 0) };
})();
