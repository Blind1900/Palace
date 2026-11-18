'use strict';
// Free-flying cells: blast ejecta, building debris, water droplets, sparks, leaves and smoke.
// Each particle is traced cell by cell through the grid; landing particles turn back into world
// cells (water droplets always do, so water is conserved), fast debris chips structures it hits.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, structural, hardness, breaksTo, palettes, weight, advection } = PW.mat;

  const GRAVITY = 260;      // cells/s^2 (about 1.9 g at 7 cm per cell: snappy but readable)
  const MAX_SPEED = 1500;   // cells/s: nothing flies faster
  const SLIDE_KEEP = 0.94;  // share of its speed rubble keeps each time it strikes the slope it runs down
  // BUBBLE: air in water. It rises (buoyancy against drag gives ~0.5 m/s), wobbles, slides along
  // anything solid above it and pops when it reaches open air. It never leaves the water.
  // LOOSE: a grain of stuff already loose - running down a slope, falling, blown up off the
  // ground - flies as a grain, never gathered into a chunk (see breakage).
  // SMOKE and FIRE: a pixel of smoke, or of a fireball's flame, after The Powder Toy's gases (our
  // own code): carried by the air - the weather's wind and a blast's - losing its own speed fast,
  // rising (fire faster), sliding along what it meets, never into it. Fire glows white-hot, then
  // yellow, orange, dark red as its life runs out, and dies - as a pixel of smoke, of the colour it
  // carries, if that colour is not see-through (alpha 0: it leaves nothing). Smoke fades out as its
  // life runs out.
  const F = Object.freeze({ LAND: 1, DAMAGE: 2, WATER: 4, GLOW: 8, SMOKE: 16, LEAF: 32, BUBBLE: 64, LOOSE: 128, FIRE: 256 });
  const FIRE_RISE = 70, SMOKE_RISE = 16;   // cells/s each rises at, in still air
  const GAS_BRAKE = 7, GAS_LOSS = 3;       // per s: how fast one thrown out loses its own speed, at first and then
  const SMOKE_LIFE = [2.4, 4.6];           // s: what a fire pixel's smoke lives
  // (the flame's colour over its life: white-hot first, dark red last)
  const FLAME = [[255, 252, 236], [255, 240, 170], [255, 214, 104], [255, 178, 60], [248, 136, 40], [226, 96, 30], [184, 64, 26], [124, 40, 22]]
    .map((c) => PW.abgr(c[0], c[1], c[2]));
  // Heat is its own property of every pixel, beside what the pixel is (see PW.glowAt): each
  // carries its temperature, and hot it glows, cooling back to its own colour. Fire is a pixel of
  // its own - a flame, coloured by its life (white-hot as it bursts out, dark red as it dies: see
  // FLAME) - and it is hot too (FIRE_HOT, falling to FIRE_END over its life), so the smoke it dies
  // into is born red-hot and cools at SMOKE_COOL to its own shade within a moment. Sparks and
  // shrapnel, a blast's hot rubble, embers glow and cool as they fly (in COOL_SPARK, COOL_DEBRIS:
  // seconds to lose most of their heat over the air), and what lands hot is still hot in the
  // heap. A liquid does not glow: hot enough, a drop of water flashes to steam.
  const FIRE_HOT = 1500, FIRE_END = 560, SMOKE_COOL = 500;
  const COOL_SPARK = 1.2, COOL_DEBRIS = 2.5;
  const AMBIENT = PW.AMBIENT, GLOW_FROM = PW.GLOW_FROM;
  const BUBBLE_RISE = 7;    // cells/s terminal rise speed

  function createParticles(world, capacity = 32768) {
    const { mat, width: W, height: H } = world;
    const px = new Float32Array(capacity), py = new Float32Array(capacity);
    const vx = new Float32Array(capacity), vy = new Float32Array(capacity);
    const life = new Float32Array(capacity), age = new Float32Array(capacity);
    const cell = new Uint8Array(capacity), flags = new Uint16Array(capacity);
    const color = new Uint32Array(capacity), owner = new Uint16Array(capacity);
    const painted = new Uint8Array(capacity);   // carries its own colour (a piece of a building)
    const temp = new Float32Array(capacity);    // °C
    // Shock energy of strikes, gathered over 16x16-cell tiles until the vibration system takes it.
    const impacts = new Map();
    function drainImpacts(fn) {
      for (const [key, energy] of impacts) fn(((key % 4096) << 4) + 8, ((key / 4096 | 0) << 4) + 8, energy);
      impacts.clear();
    }
    let count = 0;
    const listeners = { chip: null, hitUnit: null };
    const stats = { count: 0, landed: 0, chipped: 0, chunks: 0 };

    // A chunk: a particle that is a clump of cells flying together (see breakage). Its cells are
    // kept as offsets from its anchor (its bottom row, in the middle), the particle's position.
    const CHUNKS = 2048, CHUNK_CELLS = 256;
    const chunkOf = new Int16Array(capacity).fill(-1);
    const chunkN = new Uint16Array(CHUNKS);
    const chunkDx = new Int8Array(CHUNKS * CHUNK_CELLS), chunkDy = new Int8Array(CHUNKS * CHUNK_CELLS);
    const chunkColor = new Uint32Array(CHUNKS * CHUNK_CELLS), chunkByte = new Uint8Array(CHUNKS * CHUNK_CELLS);
    const freeChunks = [];
    for (let k = CHUNKS - 1; k >= 0; k -= 1) freeChunks.push(k);

    // (`heat`: its temperature, °C; left out, a fire pixel is white-hot, smoke, a leaf or a bubble
    // is at the air's, and anything else is as hot as where it came from)
    function spawn(x, y, svx, svy, byte, rgba, fl, lifeSeconds = 6, own = 0, heat = 0) {
      // (what breaks off in the same tick is gathered first, to go as chunks - see breakage)
      if ((fl & F.LAND) && !(fl & (F.WATER | F.LEAF | F.GLOW | F.SMOKE | F.BUBBLE | F.LOOSE)) && kindOf(byte) !== KIND.NONE) {
        if (pend.n >= PEND_MAX) flushDebris();
        const k = pend.n++;
        pend.x[k] = x; pend.y[k] = y; pend.vx[k] = svx; pend.vy[k] = svy; pend.byte[k] = byte;
        pend.rgba[k] = rgba || 0; pend.fl[k] = fl; pend.life[k] = lifeSeconds; pend.own[k] = own; pend.heat[k] = heat || heatHere(x, y);
        return -1;
      }
      return spawnNow(x, y, svx, svy, byte, rgba, fl, lifeSeconds, own, heat);
    }
    const heatHere = (x, y) => PW.heatAt(world, x | 0, y | 0);
    function spawnNow(x, y, svx, svy, byte, rgba, fl, lifeSeconds = 6, own = 0, heat = 0) {
      if (!heat) heat = fl & F.FIRE ? FIRE_HOT : fl & (F.SMOKE | F.LEAF | F.BUBBLE) ? AMBIENT : heatHere(x, y);
      if (count >= capacity) {
        // Over capacity: settle land particles straight into the grid, drop cosmetic ones.
        if (fl & (F.LAND | F.WATER)) deposit(x, y, byte, fl, rgba, heat);
        return -1;
      }
      const i = count++;
      px[i] = x; py[i] = y; vx[i] = svx; vy[i] = svy;
      cell[i] = byte; flags[i] = fl; color[i] = rgba || paletteColor(byte, x, y); painted[i] = rgba ? 1 : 0;
      life[i] = lifeSeconds; age[i] = 0; owner[i] = own; chunkOf[i] = -1; temp[i] = heat;
      return i;
    }

    // ---- Breakage ---------------------------------------------------------------------------------
    // Things do not break into a fine powder only: what breaks off together flies as chunks, as
    // its kind of stuff breaks. Earth falls as a smooth powder with an odd clod in it; rock and
    // concrete break into sharp, jagged lumps with dust and grit; a building's frame into slabs of
    // its floors, lengths of its pillars and blocks of its walls, with shrapnel and dust; wood into
    // lengths of trunk and branch, with splinters. Everything breaking off in one tick is gathered,
    // then cut along jagged lines into tiles (smaller for harder stuff); the cells of a tile that
    // touch each other and are flying the same way are one chunk, so a chunk takes the shape of
    // what it broke from - a slab off a floor, a length off a pillar - and goes with their speed.
    const KIND = Object.freeze({ NONE: 0, EARTH: 1, ROCK: 2, MASONRY: 3, METAL: 4, WOOD: 5 });
    const kindTable = new Uint8Array(256);
    for (let v = 0; v < 4; v += 1) {
      const b = (id) => (id | v << 6) & 255;
      for (const id of [M.LOOSE_SOIL, M.SAND, M.ASH, M.SOIL, M.TOPSOIL, M.CLAY, M.GRASS]) kindTable[b(id)] = KIND.EARTH;
      for (const id of [M.LOOSE_STONE, M.GRAVEL, M.STONE, M.ORE]) kindTable[b(id)] = KIND.ROCK;
      for (const id of [M.RUBBLE, M.RUIN]) kindTable[b(id)] = KIND.MASONRY;
    }
    kindTable[M.DEBRIS | PW.DEBRIS_KIND.CONCRETE << 6] = KIND.MASONRY;
    kindTable[M.DEBRIS | PW.DEBRIS_KIND.BRICK << 6] = KIND.MASONRY;
    kindTable[M.DEBRIS | PW.DEBRIS_KIND.METAL << 6] = KIND.METAL;
    kindTable[M.DEBRIS | PW.DEBRIS_KIND.WOOD << 6] = KIND.WOOD;
    const kindOf = (byte) => kindTable[byte & 255];
    // Per kind: how it breaks into tiles - blocks `big` cells across, each left whole (share
    // `whole`), cut in two each way (`halves`) or in three, along lines as jagged as `jag` (cells) -
    // so its chunks come in a range of sizes, concrete and rock from a few cells to a slab; the
    // share of tiles that hold together (the rest fall as grains); the share of cells that go as
    // dust, and thrown off as shrapnel or splinters (faster grains). And how hard a chunk of it
    // strikes something and still comes to rest whole, as a lump (cells/s): see the step.
    const BREAK = [];
    BREAK[KIND.EARTH] = { big: 6, whole: 0.1, halves: 0.3, jag: 2, chunky: 0.1, dust: 0, shard: 0, lands: 60 };
    BREAK[KIND.ROCK] = { big: 16, whole: 0.3, halves: 0.4, jag: 4, chunky: 0.92, dust: 0.1, shard: 0.05, lands: 170 };
    BREAK[KIND.MASONRY] = { big: 16, whole: 0.3, halves: 0.4, jag: 3, chunky: 0.92, dust: 0.08, shard: 0.06, lands: 160 };
    BREAK[KIND.METAL] = { big: 8, whole: 0.2, halves: 0.4, jag: 2, chunky: 0.3, dust: 0, shard: 0.6, lands: 200 };
    BREAK[KIND.WOOD] = { big: 12, whole: 0.4, halves: 0.4, jag: 2, chunky: 0.92, dust: 0, shard: 0.1, lands: 150 };
    const CRACK_MIN = 8;          // a chunk of this many cells or more cracks into chunks; smaller, into grains
    const PEND_MAX = 32768;
    const pend = { n: 0, x: new Float32Array(PEND_MAX), y: new Float32Array(PEND_MAX), vx: new Float32Array(PEND_MAX), vy: new Float32Array(PEND_MAX),
      byte: new Uint8Array(PEND_MAX), rgba: new Uint32Array(PEND_MAX), fl: new Uint16Array(PEND_MAX), life: new Float32Array(PEND_MAX), own: new Uint16Array(PEND_MAX), heat: new Float32Array(PEND_MAX) };
    const jag = (a, b, amp) => ((PW.hash2(Math.floor(a / 3), b) & 7) / 7 - 0.5) * amp;
    // (the jagged tile the cell (x, y) of a kind breaks off in: its block, cut as the block is cut)
    function tileOf(x, y, kind, rule, out) {
      const jx = x + jag(y, 7, rule.jag), jy = y + jag(x, 9, rule.jag);
      const bx = Math.floor(jx / rule.big), by = Math.floor(jy / rule.big);
      const h = (PW.hash3(bx, by, kind + 31) & 1023) / 1024;
      const cuts = h < rule.whole ? 1 : h < rule.whole + rule.halves ? 2 : 3, size = rule.big / cuts;
      out[0] = bx * 3 + Math.min(cuts - 1, Math.floor((jx - bx * rule.big) / size));
      out[1] = by * 3 + Math.min(cuts - 1, Math.floor((jy - by * rule.big) / size));
      return out;
    }
    const TILE = [0, 0];
    // Debris broken off over a few ticks, piece by piece next to each other - a storey crushed row
    // by row, the foot of a building ground away - is held back and let go together, so it goes as
    // chunks too (slabs of its floors, lumps of its walls), not grain by grain.
    const HOLD_TICKS = 4, HOLD_MAX = 16384;
    const held = { n: 0, x: new Float32Array(HOLD_MAX), y: new Float32Array(HOLD_MAX), vx: new Float32Array(HOLD_MAX), vy: new Float32Array(HOLD_MAX),
      byte: new Uint8Array(HOLD_MAX), rgba: new Uint32Array(HOLD_MAX), fl: new Uint16Array(HOLD_MAX), life: new Float32Array(HOLD_MAX), own: new Uint16Array(HOLD_MAX), heat: new Float32Array(HOLD_MAX) };
    let heldFor = 0;
    function hold(x, y, svx, svy, byte, rgba, fl, lifeSeconds = 6, own = 0, heat = 0) {
      if (held.n >= HOLD_MAX || !(fl & F.LAND) || kindOf(byte) === KIND.NONE) return spawn(x, y, svx, svy, byte, rgba, fl, lifeSeconds, own, heat);
      const k = held.n++;
      held.x[k] = x; held.y[k] = y; held.vx[k] = svx; held.vy[k] = svy; held.byte[k] = byte;
      held.rgba[k] = rgba || 0; held.fl[k] = fl; held.life[k] = lifeSeconds; held.own[k] = own; held.heat[k] = heat || heatHere(x, y);
      return -1;
    }
    function release() {
      for (let k = 0; k < held.n; k += 1) {
        if (pend.n >= PEND_MAX) flushDebris();
        const j = pend.n++;
        pend.x[j] = held.x[k]; pend.y[j] = held.y[k]; pend.vx[j] = held.vx[k]; pend.vy[j] = held.vy[k]; pend.byte[j] = held.byte[k];
        pend.rgba[j] = held.rgba[k]; pend.fl[j] = held.fl[k]; pend.life[j] = held.life[k]; pend.own[j] = held.own[k]; pend.heat[j] = held.heat[k];
      }
      held.n = 0;
    }
    function flushDebris() {
      if (held.n && (heldFor += 1) >= HOLD_TICKS) { heldFor = 0; release(); }
      const n = pend.n;
      if (!n) return;
      pend.n = 0;
      // (each cell's tile: its kind, and the jagged tile it falls in)
      const groups = new Map();
      for (let k = 0; k < n; k += 1) {
        const kind = kindOf(pend.byte[k]), rule = BREAK[kind];
        const x = Math.floor(pend.x[k]), y = Math.floor(pend.y[k]);
        const [tx, ty] = tileOf(x, y, kind, rule, TILE);
        const key = (kind * 65536 + (ty & 65535)) * 65536 + (tx & 65535);
        let g = groups.get(key);
        if (!g) { g = []; g.tx = tx; g.ty = ty; groups.set(key, g); }
        g.push(k);
      }
      for (const g of groups.values()) {
        const kind = kindOf(pend.byte[g[0]]), rule = BREAK[kind];
        const holds = g.length > 1 && (PW.hash3(g.tx, g.ty, kind + 17) & 1023) < rule.chunky * 1024;
        // (cells of the tile that touch each other are one chunk)
        const at = new Map();
        for (const k of g) at.set(Math.floor(pend.y[k]) * 65536 + Math.floor(pend.x[k]), k);
        const done = new Set();
        for (const k of g) {
          if (done.has(k)) continue;
          const part = [k];
          done.add(k);
          if (holds) for (let q = 0; q < part.length && part.length < CHUNK_CELLS; q += 1) {
            const cx = Math.floor(pend.x[part[q]]), cy = Math.floor(pend.y[part[q]]);
            for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
              const j = at.get((cy + dy) * 65536 + cx + dx);
              if (j !== undefined && !done.has(j) && part.length < CHUNK_CELLS) { done.add(j); part.push(j); }
            }
          }
          launch(part, kind, rule);
        }
      }
    }
    // Send the cells `part` (pending entries) off as one chunk - or, a single cell, as a grain; some
    // go as dust, some as shrapnel thrown off faster.
    function launch(part, kind, rule) {
      let keep = part;
      if (part.length > 1 && (rule.dust || rule.shard)) {
        keep = [];
        for (const k of part) {
          const h = (PW.hash3(Math.floor(pend.x[k]), Math.floor(pend.y[k]), 0xd5) & 1023) / 1024;
          if (h < rule.dust) {
            const x = Math.floor(pend.x[k]), y = Math.floor(pend.y[k]);
            if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && (mat[y * W + x] & ID_MASK) === M.AIR) PW.set(world, x, y, M.DUST | 2 << 6, { quiet: true });
          } else if (h < rule.dust + rule.shard) {
            spawnNow(pend.x[k], pend.y[k], pend.vx[k] * 1.35, pend.vy[k] * 1.2 - 15, pend.byte[k], pend.rgba[k], pend.fl[k], pend.life[k], pend.own[k], pend.heat[k]);
          } else keep.push(k);
        }
      }
      if (!keep.length) return;
      if (keep.length === 1 || !freeChunks.length || count >= capacity) {
        stats.grains = (stats.grains || 0) + keep.length;
        for (const k of keep) spawnNow(pend.x[k], pend.y[k], pend.vx[k], pend.vy[k], pend.byte[k], pend.rgba[k], pend.fl[k], pend.life[k], pend.own[k], pend.heat[k]);
        return;
      }
      // (its anchor: the middle of its bottom row; it goes as one of its cells was thrown - so
      // chunks fly as far and as variously as the grains would have)
      let sx = 0, bottom = -Infinity, lifeMax = 0, fl = 0, heat = 0;
      for (const k of keep) {
        sx += Math.floor(pend.x[k]); bottom = Math.max(bottom, Math.floor(pend.y[k]));
        lifeMax = Math.max(lifeMax, pend.life[k]); fl |= pend.fl[k]; heat += pend.heat[k];
      }
      const ax = Math.round(sx / keep.length), m = keep.length;
      const k0 = keep[0], kv = keep[PW.hash2(ax, bottom) % m];
      // (a lump is as hot as its cells were, together)
      const i = spawnNow(ax + 0.5, bottom + 0.5, pend.vx[kv], pend.vy[kv], pend.byte[k0], pend.rgba[k0], fl, lifeMax, pend.own[k0], heat / m);
      if (i < 0) return;
      const c = freeChunks.pop(), base = c * CHUNK_CELLS;
      chunkOf[i] = c; chunkN[c] = m;
      const cells = new Set();
      for (let q = 0; q < m; q += 1) {
        const k = keep[q];
        chunkDx[base + q] = Math.max(-127, Math.min(127, Math.floor(pend.x[k]) - ax));
        chunkDy[base + q] = Math.max(-127, Math.floor(pend.y[k]) - bottom);
        chunkByte[base + q] = pend.byte[k];
        chunkColor[base + q] = pend.rgba[k] || paletteColor(pend.byte[k], pend.x[k], pend.y[k]);
        cells.add(chunkDy[base + q] * 256 + chunkDx[base + q]);
      }
      // (a lump of something: lit along its top and left edges, in shadow along its bottom and
      // right - it reads as a solid lump, in the air and where it comes to rest)
      if (m >= 4) {
        for (let q = 0; q < m; q += 1) {
          const dx = chunkDx[base + q], dy = chunkDy[base + q];
          const top = !cells.has((dy - 1) * 256 + dx), lft = !cells.has(dy * 256 + dx - 1);
          const bot = !cells.has((dy + 1) * 256 + dx), rgt = !cells.has(dy * 256 + dx + 1);
          const k = top ? LUMP_LIT : bot ? LUMP_SHADE : lft ? (LUMP_LIT + 1) / 2 : rgt ? (LUMP_SHADE + 1) / 2 : 1;
          if (k !== 1) chunkColor[base + q] = shade(chunkColor[base + q], k);
        }
      }
      stats.chunks += 1;
      stats.chunkCells = (stats.chunkCells || 0) + m;
      if (m >= 30) stats.bigChunks = (stats.bigChunks || 0) + 1;
      stats.maxChunk = Math.max(stats.maxChunk || 0, m);
    }
    const LUMP_LIT = 1.22, LUMP_SHADE = 0.68;
    const shade = (rgba, k) => {
      const c = PW.unpack(rgba);
      return PW.abgr(Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k));
    };
    // A chunk come to rest with its anchor at (x, y): its cells into the grid, from its bottom row
    // up. It lies there whole, a lump the shape it broke off in - each of its cells where it is,
    // on what it came down on (held as loose stuff lying still is: see pw-sim) - but for what of
    // it is inside something, which settles on the heap as its stuff does.
    function depositChunk(i, x, y) {
      const c = chunkOf[i], base = c * CHUNK_CELLS, m = chunkN[c];
      const order = [];
      for (let q = 0; q < m; q += 1) order.push(q);
      order.sort((a, b) => chunkDy[base + b] - chunkDy[base + a]);
      for (const q of order) {
        const gx = x + chunkDx[base + q], gy = y + chunkDy[base + q], byte = chunkByte[base + q];
        if (gx >= 1 && gy >= 1 && gx < W - 1 && gy < H - 1 && (mat[gy * W + gx] & ID_MASK) === M.AIR) {
          PW.set(world, gx, gy, byte);
          // (keeping its look: a piece of a building its colours, dulled with dust; any lump its
          // light and shadow - see launch)
          if ((byte & ID_MASK) === M.DEBRIS) PW.setLayer(world, 'paint', gx, gy, rubbleTone(chunkColor[base + q], gx, gy));
          else if (m >= 4) PW.setLayer(world, 'paint', gx, gy, chunkColor[base + q]);
          keepHeat(gx, gy, temp[i]);
          stats.landed += 1;
          continue;
        }
        const [cx, cy] = cellOf(c, q, x, y);
        deposit(cx, cy, byte, flags[i], chunkColor[base + q], temp[i]);
      }
      stats.lumps = (stats.lumps || 0) + 1;
      stats.lumpCells = (stats.lumpCells || 0) + m;
    }
    // (a piece of a building's colour as rubble: a little dulled with dust)
    const rubbleTone = (paint, x, y) => {
      const c = PW.unpack(paint), k = 0.78 + (PW.hash2(x, y) & 15) / 100;
      return PW.abgr(c[0] * k + 18, c[1] * k + 16, c[2] * k + 14);
    };
    function paletteColor(byte, x, y) {
      if (!byte) return PW.abgr(255, 255, 255);
      return palettes[byte & ID_MASK][(byte >> 6) * 2 + (PW.hash2(x | 0, y | 0) & 1)];
    }
    function kill(i) {
      if (chunkOf[i] >= 0) { freeChunks.push(chunkOf[i]); chunkOf[i] = -1; }
      const last = --count;
      if (i === last) return;
      px[i] = px[last]; py[i] = py[last]; vx[i] = vx[last]; vy[i] = vy[last];
      life[i] = life[last]; age[i] = age[last]; cell[i] = cell[last]; flags[i] = flags[last];
      color[i] = color[last]; owner[i] = owner[last]; painted[i] = painted[last]; temp[i] = temp[last];
      chunkOf[i] = chunkOf[last]; chunkOf[last] = -1;
    }
    // (colour c a share k of the way to colour d, and the more solid the more of d)
    const mix = (c, d, k) => {
      const r = (c & 255) + ((d & 255) - (c & 255)) * k, g = (c >>> 8 & 255) + ((d >>> 8 & 255) - (c >>> 8 & 255)) * k, b = (c >>> 16 & 255) + ((d >>> 16 & 255) - (c >>> 16 & 255)) * k;
      return (Math.max(c >>> 24, Math.round(255 * k)) << 24 | Math.round(b) << 16 | Math.round(g) << 8 | Math.round(r)) >>> 0;
    };
    // (what comes to rest hot is still hot where it lies: its heat goes into the cell - see pw-heat)
    const keepHeat = (x, y, t) => { if (t > AMBIENT + 30 && t > PW.heatAt(world, x, y)) PW.setHeat(world, x, y, t); };
    // Chunk i, at (x, y) going `speed`, breaks into its grains: each from its own cell, going on
    // as the chunk was going (a little apart from each other) - so each bounces or runs on down the
    // slope as a grain does. (The blow was the chunk's: its grains do no more damage.)
    function shatter(i, x, y, speed) {
      const c = chunkOf[i], base = c * CHUNK_CELLS, ax = Math.floor(x), ay = Math.floor(y);
      const kick = Math.min(30, speed * 0.1);
      for (let q = 0; q < chunkN[c]; q += 1) {
        const [gx, gy] = cellOf(c, q, ax, ay);
        const h = PW.hash3(gx, gy, q);
        const jx = ((h & 255) / 255 - 0.5) * 2 * kick, jy = ((h >>> 8 & 255) / 255 - 0.5) * kick;
        spawnNow(gx + 0.5, gy + 0.5, vx[i] + jx, vy[i] + jy, chunkByte[base + q], chunkColor[base + q], (flags[i] | F.LOOSE) & ~F.DAMAGE, life[i], owner[i], temp[i]);
      }
      stats.shattered = (stats.shattered || 0) + 1;
    }
    // Chunk i, at (x, y) going `speed`, struck hard: it cracks across - along a jagged line through
    // its middle, at a slant - into two smaller chunks (a big one into three), crumbling a little
    // as they come apart (see launch), each bouncing off what it struck the way the chunk was going,
    // the parts thrown a little apart. (False if it cannot: then it shatters.)
    function crack(i, x, y, speed, blockedX) {
      const c = chunkOf[i], base = c * CHUNK_CELLS, m = chunkN[c], ax = Math.floor(x), ay = Math.floor(y);
      if (pend.n + m > PEND_MAX || freeChunks.length < 3) return false;
      const kind = kindOf(chunkByte[base]), rule = BREAK[kind];
      const h = PW.hash3(ax, ay, m), a = (h & 1023) / 1024 * Math.PI, nx = Math.cos(a), ny = Math.sin(a);
      const parts = m >= 60 ? 3 : 2;
      // (off a wall it bounces back; off the ground, up)
      const bvx = blockedX ? -vx[i] * 0.3 : vx[i] * 0.7, bvy = blockedX ? vy[i] * 0.7 : -Math.abs(vy[i]) * 0.3;
      // (its cells, as pending debris after the last of the tick's: see flushDebris)
      const k0 = pend.n, t = new Float32Array(m);
      let mx = 0, my = 0;
      for (let q = 0; q < m; q += 1) {
        const [gx, gy] = cellOf(c, q, ax, ay), k = k0 + q;
        pend.x[k] = gx + 0.5; pend.y[k] = gy + 0.5; pend.byte[k] = chunkByte[base + q]; pend.rgba[k] = chunkColor[base + q];
        pend.fl[k] = flags[i] & ~F.DAMAGE; pend.life[k] = life[i]; pend.own[k] = owner[i]; pend.heat[k] = temp[i];
        mx += gx; my += gy;
      }
      mx /= m; my /= m;
      let lo = Infinity, hi = -Infinity;
      for (let q = 0; q < m; q += 1) {
        const px0 = pend.x[k0 + q], py0 = pend.y[k0 + q];
        t[q] = (px0 - mx) * nx + (py0 - my) * ny + jag(px0 + py0, 13, rule.jag);
        if (t[q] < lo) lo = t[q]; if (t[q] > hi) hi = t[q];
      }
      const groups = Array.from({ length: parts }, () => []);
      for (let q = 0; q < m; q += 1) groups[Math.min(parts - 1, Math.floor((t[q] - lo) / (hi - lo + 1e-6) * parts))].push(k0 + q);
      groups.forEach((g, p) => {
        const apart = (p - (parts - 1) / 2) * (15 + speed * 0.12);
        for (const k of g) { pend.vx[k] = bvx + nx * apart; pend.vy[k] = bvy + ny * apart - 10; }
        if (g.length) launch(g, kind, rule);
      });
      stats.cracked = (stats.cracked || 0) + 1;
      return true;
    }
    // Where cell q of chunk c (anchored at ax, ay) is in the world - or, if it is inside something
    // solid (the chunk's anchor is what it struck with: the rest of it may have swung into a
    // wall), at the anchor.
    function cellOf(c, q, ax, ay) {
      const base = c * CHUNK_CELLS, gx = ax + chunkDx[base + q], gy = ay + chunkDy[base + q];
      if (gx < 1 || gy < 1 || gx >= W - 1 || gy >= H - 1 || !OPEN[mat[gy * W + gx] & ID_MASK]) return [ax, ay];
      return [gx, gy];
    }
    // Particle i comes to rest at (x, y) in the grid (a chunk, all its cells).
    function land(i, x, y) {
      if (chunkOf[i] >= 0) { depositChunk(i, Math.floor(x), Math.floor(y)); return true; }
      return deposit(x, y, cell[i], flags[i], painted[i] ? color[i] : 0, temp[i]);
    }
    // A grain coming to rest in water takes the place of the water it lands in, and that water
    // goes up to the top of the column it stands in: the surface rises by the grain's volume.
    // (false where the water is shut in and cannot rise)
    function displace(cx, cy) {
      let top = cy;
      while (top > 0 && phase[mat[(top - 1) * W + cx] & ID_MASK] === PW.PHASE.LIQUID && cy - top < 512) top -= 1;
      if (top === 0 || !OPEN[mat[(top - 1) * W + cx] & ID_MASK]) return false;
      PW.set(world, cx, top - 1, mat[cy * W + cx]);
      return true;
    }
    // Put a landed particle into the first open cell at or above (x, y): air, or water it is heavy
    // enough to sink in (a light one rests on the surface). (A grain that came to rest and was
    // buried by the rest of the heap landing on it goes to the top of the heap.)
    function deposit(x, y, byte, fl, paint = 0, heat = AMBIENT) {
      let cx = Math.max(1, Math.min(W - 2, Math.floor(x))), cy = Math.min(H - 1, Math.floor(y));
      for (let k = 0; k < 400 && cy >= 0; k += 1, cy -= 1) {
        const id = mat[cy * W + cx] & ID_MASK;
        const sinks = (fl & F.WATER) === 0 && phase[id] === PW.PHASE.LIQUID && weight[id] < weight[byte & ID_MASK];
        if (OPEN[id] || (sinks && displace(cx, cy))) {
          // Rubble and earth landing on a heap roll off it, down its slope, so falling debris builds
          // a heap spreading out wide rather than a column: earth settles at about 45°, building
          // rubble flatter, about 1 in 3.
          if (!(fl & F.WATER) && OPEN[id] && phase[byte & ID_MASK] !== PW.PHASE.GAS) {
            const first = (cx + cy) & 1 ? 1 : -1, reach = (byte & ID_MASK) === M.DEBRIS ? 3 : 1;
            const free = (x, y) => x >= 1 && x < W - 1 && y < H - 1 && OPEN[mat[y * W + x] & ID_MASK];
            for (let roll = 0; roll < 160; roll += 1) {
              if (free(cx, cy + 1)) { cy += 1; continue; }
              let moved = false;
              for (const d of [first, -first]) {
                for (let k = 1; k <= reach && !moved; k += 1) {
                  if (!free(cx + d * k, cy)) break;
                  if (free(cx + d * k, cy + 1)) { cx += d * k; cy += 1; moved = true; }
                }
                if (moved) break;
              }
              if (!moved) break;
            }
          }
          // (smoke or dust lying there is pushed up out of its way, not lost)
          const there = mat[cy * W + cx];
          if (phase[there & ID_MASK] === PW.PHASE.GAS) {
            // (up through the cloud to clear air over it; in a thick cloud, out to its side)
            let moved = false;
            for (let up = cy - 1; up > 0 && cy - up <= 200 && !moved; up -= 1) if ((mat[up * W + cx] & ID_MASK) === M.AIR) { PW.set(world, cx, up, there, { quiet: true }); moved = true; }
            for (let k = 1; k <= 160 && !moved; k += 1) for (const sx of [cx - k, cx + k]) {
              if (!moved && sx > 0 && sx < W - 1 && (mat[cy * W + sx] & ID_MASK) === M.AIR) { PW.set(world, sx, cy, there, { quiet: true }); moved = true; }
            }
            stats.gasLost = (stats.gasLost || 0) + (moved ? 0 : 1);
          }
          PW.set(world, cx, cy, byte);
          keepHeat(cx, cy, heat);
          // (landing, it stirs the heap it lands on: the heap settles to its slope)
          if (!(fl & F.WATER)) PW.stir(world, cx, cy, cx, cy);
          // (a piece of a building keeps its colours as rubble, a little dulled with dust)
          if (paint && (byte & ID_MASK) === M.DEBRIS) {
            const c = PW.unpack(paint), k = 0.78 + (PW.hash2(cx, cy) & 15) / 100;
            PW.setLayer(world, 'paint', cx, cy, PW.abgr(c[0] * k + 18, c[1] * k + 16, c[2] * k + 14));
          }
          stats.landed += 1;
          return true;
        }
      }
      return false;
    }
    const OPEN = PW.mat.open;
    const open = (id, fl) => OPEN[id] === 1 || (id === M.WATER && (fl & F.WATER) === 0);
    // A pixel of smoke or flame moves as the air takes it (see F): towards the air's own motion and
    // its rise, losing the speed it was thrown with, a little restless; cell by cell, sliding along
    // anything not open to it (water too), never into it.
    const NO_WIND = [0, 0];
    const gasOpen = (x, y) => {
      if (x < 1 || x >= W - 1 || y >= H - 1) return false;
      if (y < 0) return true;
      const id = mat[(y | 0) * W + (x | 0)] & ID_MASK;
      return OPEN[id] === 1 && id !== M.WATER;
    };
    function stepGas(i, fl, dt) {
      const fire = (fl & F.FIRE) !== 0;
      const x = px[i], y = py[i];
      const wind = world.air && world.air.wind ? world.air.wind(x | 0, y | 0) : NO_WIND;
      const brake = Math.exp(-(age[i] < 0.4 ? GAS_BRAKE : GAS_LOSS) * dt);
      // (a flame bursting out spreads first and rises as it slows: the heat lifts it once it has
      // stopped being thrown)
      const rise = fire ? FIRE_RISE * Math.min(1, age[i] * 2.5) * (0.4 + life[i] / (age[i] + life[i])) : SMOKE_RISE;
      const h = PW.hash3(i, (age[i] * 20) | 0, 77), jitter = fire ? 16 : 30;
      const tx = wind[0], ty = wind[1] - rise;
      vx[i] = tx + (vx[i] - tx) * brake + ((h & 255) / 255 - 0.5) * jitter * dt;
      vy[i] = ty + (vy[i] - ty) * brake + ((h >>> 8 & 255) / 255 - 0.5) * jitter * dt;
      const dx = vx[i] * dt, dy = vy[i] * dt;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      let cx = x, cy = y, sx = dx / steps, sy = dy / steps;
      for (let s = 0; s < steps; s += 1) {
        if (sx) { if (gasOpen(cx + sx, cy)) cx += sx; else { vx[i] *= -0.15; sx = 0; } }
        if (sy) { if (gasOpen(cx, cy + sy)) cy += sy; else { vy[i] *= -0.15; sy = 0; } }
      }
      px[i] = cx; py[i] = cy;
      if (cy < -H * 0.3) life[i] = 0;
    }

    function step(dt) {
      flushDebris();
      const keepSpark = Math.exp(-dt / COOL_SPARK), keepDebris = Math.exp(-dt / COOL_DEBRIS);
      for (let i = count - 1; i >= 0; i -= 1) {
        const fl = flags[i];
        age[i] += dt;
        life[i] -= dt;
        // Its heat: a flame's falls as its life burns; anything else hot cools - smoke at once to
        // its own colour, a spark or a lump over a second or two.
        if (fl & F.FIRE) temp[i] = FIRE_HOT - (FIRE_HOT - FIRE_END) * Math.min(1, age[i] / (age[i] + Math.max(0, life[i])));
        else if (temp[i] > AMBIENT + 0.5) temp[i] = fl & F.SMOKE ? Math.max(AMBIENT, temp[i] - SMOKE_COOL * dt) : AMBIENT + (temp[i] - AMBIENT) * (fl & F.GLOW ? keepSpark : keepDebris);
        // (a drop of water as hot as boiling flashes to steam)
        if ((fl & F.WATER) && temp[i] >= 100) {
          const cx = px[i] | 0, cy = py[i] | 0;
          // (no room for its steam where it is: it flies on, at the boil, and tries again)
          if (cx > 0 && cy > 0 && cx < W - 1 && cy < H - 1 && (mat[cy * W + cx] & ID_MASK) === M.AIR) {
            PW.set(world, cx, cy, M.STEAM | 3 << 6); PW.setHeat(world, cx, cy, temp[i]);
            kill(i);
            continue;
          }
        }
        if (fl & (F.SMOKE | F.FIRE)) {
          if (life[i] <= 0) {
            // (a flame dies as a pixel of smoke, if it carries one - still red-hot, cooling)
            if ((fl & F.FIRE) && (color[i] >>> 24)) {
              flags[i] = F.SMOKE; age[i] = 0; temp[i] = FIRE_END;
              life[i] = SMOKE_LIFE[0] + (PW.hash2(i, count) & 255) / 255 * (SMOKE_LIFE[1] - SMOKE_LIFE[0]);
              vx[i] *= 0.5; vy[i] *= 0.5;
            } else kill(i);
            continue;
          }
          stepGas(i, fl, dt);
          continue;
        }
        if (fl & F.BUBBLE) {
          // Rise towards terminal speed, wobbling; water currents are not modelled per cell.
          vy[i] += (-BUBBLE_RISE - vy[i]) * Math.min(1, 4 * dt);
          vx[i] += (Math.sin(age[i] * 6 + i * 1.7) * 3 - vx[i]) * Math.min(1, 3 * dt);
          const ox = px[i], oy = py[i];
          let nx = ox + vx[i] * dt, ny = oy + vy[i] * dt;
          const at = (x, y) => (y < 0 || y >= H || x < 0 || x >= W) ? M.BEDROCK : mat[(y | 0) * W + (x | 0)] & ID_MASK;
          let here = at(nx, ny);
          if (here !== M.WATER && here !== M.AIR) {
            // Blocked above: slip sideways along the ceiling towards a way up.
            ny = oy;
            const side = Math.sin(i * 12.9898) > 0 ? 1 : -1;
            nx = ox + side * BUBBLE_RISE * dt;
            here = at(nx, ny);
            if (here !== M.WATER) { nx = ox; here = at(nx, ny); }
          }
          px[i] = nx; py[i] = ny;
          if (here !== M.WATER || life[i] <= 0) kill(i);   // reached air: pop
          continue;
        }
        // (a leaf lying on something - stopped dead there - stays till its time is up, unless what
        // it lies on is gone)
        if ((fl & F.LEAF) && vx[i] === 0 && vy[i] === 0) {
          const cx = px[i] | 0, cy = (py[i] | 0) + 1;
          if (cy >= H || cx < 1 || cx >= W - 1 || !open(mat[cy * W + cx] & ID_MASK, fl)) {
            if (life[i] <= 0) kill(i);
            continue;
          }
        }
        // What it is, and what it is flying through. In a liquid the weight of what it pushes
        // aside holds it up: a stone sinks slower, ash floats up (the element table's weights).
        const own = cell[i] & ID_MASK;
        const around = (() => {
          const cx = px[i] | 0, cy = py[i] | 0;
          return cy >= 0 && cy < H && cx >= 0 && cx < W ? mat[cy * W + cx] & ID_MASK : M.AIR;
        })();
        const inLiquid = phase[around] === PW.PHASE.LIQUID;
        // (a hot lump in water is quenched: its heat goes into the water about it, which boils)
        if (inLiquid && temp[i] > 100) { PW.addHeat(world, px[i] | 0, py[i] | 0, (temp[i] - 100) * 0.5); temp[i] = 100 + (temp[i] - 100) * 0.5; }
        let g = GRAVITY * (fl & F.LEAF ? 0.25 : 1);
        if (inLiquid && own && !(fl & F.WATER)) g *= 1 - weight[around] / Math.max(1, weight[own]);
        const buoyant = g < 0;
        vy[i] += g * dt;
        // Drag: what the air takes hold of most (the table's `wind`) is slowed most - ash and
        // grit drift down, a stone flies on.
        const drag = inLiquid ? 3.5 : fl & F.LEAF ? 1.6 : own ? 0.12 + 2.5 * advection[own] : 0.12;
        vx[i] *= Math.max(0, 1 - drag * dt); vy[i] *= Math.max(0, 1 - drag * dt);
        // A falling leaf sways as it sinks - with the leaves about it, in the same eddy - so a mass
        // of them comes down together like a heavy gas, swirling and spreading a little as it
        // settles; each flutters a little on its own as well.
        if (fl & F.LEAF) {
          const eddy = age[i] * 2.2 + px[i] * 0.045 + py[i] * 0.03;
          vx[i] += (Math.sin(eddy) * 26 + Math.sin(age[i] * 6 + i * 1.7) * 8) * dt;
          vy[i] += Math.cos(eddy * 1.3) * 14 * dt;
        }
        // (sinking or floating through water, each grain is turned this way and that by the
        // eddies it makes, so a mass of them spreads out)
        else if (inLiquid && own) { vx[i] += Math.sin(age[i] * 4 + i * 1.7) * 40 * dt; vy[i] += Math.cos(age[i] * 3 + i * 2.3) * 25 * dt; }
        // Light things ride the wind above ground.
        const ride = fl & F.LEAF ? 1.5 : own && !inLiquid ? 3 * advection[own] : 0;
        if (ride) {
          const gx = Math.max(0, Math.min(W - 1, px[i] | 0));
          if (py[i] < world.groundTop[gx]) vx[i] += ((world.wind || 0) * 1.5 - vx[i]) * Math.min(1, ride * dt);
        }
        // A blast wave's wind pushes what flies through it: leaves are carried off, splinters and
        // grit pushed along, heavy rubble barely (as the element table's `wind` says).
        if (world.air && world.air.busy()) {
          const a = world.air.at(px[i], py[i]);
          if (a[0] || a[1]) {
            const k = (fl & F.LEAF ? 0.7 : Math.max(0.03, PW.mat.advection[cell[i] & ID_MASK])) * Math.min(1, 6 * dt);
            vx[i] += (a[0] - vx[i]) * k; vy[i] += (a[1] - vy[i]) * k;
          }
        }
        // (nothing flies faster than MAX_SPEED: a bad push can never stall the step)
        if (!(Math.abs(vx[i]) <= MAX_SPEED)) vx[i] = Math.sign(vx[i]) * MAX_SPEED || 0;
        if (!(Math.abs(vy[i]) <= MAX_SPEED)) vy[i] = Math.sign(vy[i]) * MAX_SPEED || 0;
        let x = px[i], y = py[i];
        const nx = x + vx[i] * dt, ny = y + vy[i] * dt;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(nx - x), Math.abs(ny - y))));
        const sx = (nx - x) / steps, sy = (ny - y) / steps;
        let removed = false;
        for (let s = 0; s < steps; s += 1) {
          const tx = x + sx, ty = y + sy;
          const cx = Math.floor(tx), cy = Math.floor(ty);
          if (cx < 1 || cx >= W - 1) {
            if (fl & (F.LAND | F.WATER)) { vx[i] = -vx[i] * 0.3; break; }
            kill(i); removed = true; break;
          }
          if (cy < 0) { x = tx; y = ty; continue; }          // above the grid: open sky
          if (cy >= H) { kill(i); removed = true; break; }
          const id = mat[cy * W + cx] & ID_MASK;
          // (floating up, it stops at the surface and rests there)
          if (buoyant && OPEN[id]) {
            if (land(i, x, y)) { kill(i); removed = true; break; }
          }
          if (open(id, fl)) {
            // Fast heavy debris knocks down plants and smashes lamps and fittings it flies through.
            if ((fl & F.DAMAGE) && (Math.abs(vx[i]) + Math.abs(vy[i])) > 110 && PW.getLayer(world, 'deco', cx, cy)) {
              // (the blow: its speed and weight - a fast lump of rubble about 1.5)
              const blow = Math.hypot(vx[i], vy[i]) / 200 * Math.max(0.2, weight[cell[i] & ID_MASK] / 80);
              if (!(PW.flora && PW.flora.strike(world, api, cx, cy, blow))) {
                PW.setLayer(world, 'deco', cx, cy, 0);
                if (PW.streetProps) PW.streetProps.struck(world, cx, cy);
                const owner = PW.getOwner(world, cx, cy);
                if (owner > 0 && owner < 50000 && world.onDamage) world.onDamage(owner, 0, cx, cy);
              }
              vx[i] *= 0.8; vy[i] *= 0.8;
            }
            x = tx; y = ty; continue;
          }
          // Collision with cell (cx, cy). The shock of the strike adds to the vibration where it
          // lands (its kinetic energy: the weight of what struck, times its speed squared).
          const speed = Math.hypot(vx[i], vy[i]);
          // (a chunk's shock is its grains', struck as it shatters: it is not counted twice)
          if (fl & (F.LAND | F.DAMAGE) && speed > 40 && chunkOf[i] < 0) {
            const key = (cy >> 4) * 4096 + (cx >> 4);
            impacts.set(key, (impacts.get(key) || 0) + speed * speed * (PW.mat.weight[cell[i] & ID_MASK] / 80) / 40);
          }
          if ((fl & F.DAMAGE) && speed > 90 && structural[id] && id !== M.CORE) chip(cx, cy, id, speed, i);   // (cores break only to blasts)
          const blockedX = Math.floor(x + sx) !== Math.floor(x) && !open(mat[Math.floor(y) * W + cx] & ID_MASK, fl);
          // A chunk striking something gently enough for its stuff comes to rest whole, a lump;
          // harder, it cracks into smaller chunks that bounce on; a small one shatters, its grains
          // going on from where they were, tumbling on along what it struck (and running and
          // settling as loose stuff does). (Whole or cracked, its shock is all its cells'.)
          if (chunkOf[i] >= 0) {
            const c = chunkOf[i], rule = BREAK[kindOf(chunkByte[c * CHUNK_CELLS])];
            const shock = () => {
              const key = (cy >> 4) * 4096 + (cx >> 4);
              impacts.set(key, (impacts.get(key) || 0) + speed * speed * (PW.mat.weight[chunkByte[c * CHUNK_CELLS] & ID_MASK] / 80) / 40 * chunkN[c]);
            };
            if (speed < rule.lands) { if (speed > 40) shock(); if (land(i, x, y)) { kill(i); removed = true; break; } }
            if (chunkN[c] >= CRACK_MIN) { shock(); if (crack(i, x, y, speed, blockedX)) { kill(i); removed = true; break; } }
            shatter(i, x, y, speed); kill(i); removed = true; break;
          }
          if ((fl & F.WATER) || ((fl & F.LAND) && speed < 45)) {
            if (land(i, x, y)) { kill(i); removed = true; break; }
          }
          // Bounce: reflect the blocked component, keep some of the other.
          // Rubble and earth striking a slope do not bounce: they run on down it, a stream of
          // rock and earth that keeps its speed on a steep slope, loses it on a gentle one and
          // spreads to a stop at the foot, throwing up dust as it goes.
          let downhill = 0;
          if (!blockedX && (fl & F.LAND) && vy[i] > 0) {
            const row = cy * W, l = open(mat[row + cx - 1] & ID_MASK, fl), r = open(mat[row + cx + 1] & ID_MASK, fl);
            downhill = l && r ? (Math.sign(vx[i]) || (i & 1 ? 1 : -1)) : l ? -1 : r ? 1 : 0;
          }
          if (downhill) {
            const run = Math.max(speed * SLIDE_KEEP, 30);
            vx[i] = downhill * run; vy[i] = 12;
            x = cx + 0.5 + downhill; y = cy - 0.5;
            if (run > 110 && (PW.hash3(cx, cy, age[i] * 60 | 0) & 7) === 0 && open(mat[(cy - 3) * W + cx] & ID_MASK, fl) && (mat[(cy - 3) * W + cx] & ID_MASK) === M.AIR) {
              PW.set(world, cx, cy - 3, M.DUST | 2 << 6, { quiet: true });
            }
            break;
          }
          if (blockedX) { vx[i] = -vx[i] * 0.25; vy[i] *= 0.75; } else { vy[i] = -vy[i] * 0.25; vx[i] *= 0.7; }
          // (a leaf come down onto something lies on it a while - the rest of its life - before
          // it is gone)
          if ((fl & F.LEAF) && !blockedX && speed < 60) { vx[i] = 0; vy[i] = 0; life[i] = Math.max(life[i], 2 + (i & 3) * 0.5); break; }
          if (!(fl & (F.LAND | F.WATER)) && speed < 30) { kill(i); removed = true; }
          break;
        }
        if (removed) continue;
        px[i] = x; py[i] = y;
        if (life[i] <= 0) {
          // (a leaf still in the air drifts on down until it comes to the ground: nothing hangs in
          // the air, nor goes before it lands)
          if ((fl & F.LEAF) && age[i] < 30) {
            const cx = Math.floor(x), cy = Math.floor(y) + 1;
            if (cy < H && cx > 0 && cx < W - 1 && OPEN[mat[cy * W + cx] & ID_MASK]) { life[i] = 0.5; continue; }
          }
          if (fl & (F.LAND | F.WATER)) land(i, x, y);
          kill(i);
        }
      }
      stats.count = count;
    }
    // A fast heavy fragment breaks the structure cell it hits (harder cells resist).
    function chip(cx, cy, id, speed, i) {
      const energy = speed / 400;
      if (energy < hardness[id] * (0.6 + (PW.hash2(cx, cy) & 255) / 640)) return;
      // (a building going up shrugs off flying rubble: only a heavy blow breaks into it)
      if (PW.growing(world, cx, cy)) return;
      const ownerId = PW.getOwner(world, cx, cy);
      PW.set(world, cx, cy, M.AIR);
      PW.clearPaintAt(world, cx, cy);
      const jitter = ((PW.hash3(cx, cy, world.tick) & 255) / 255 - 0.5) * 40;
      spawn(cx + 0.5, cy + 0.5, vx[i] * 0.4 + jitter, vy[i] * 0.3 - 30, breaksTo[id] || M.DEBRIS, 0, F.LAND, 5, ownerId);
      stats.chipped += 1;
      if (listeners.chip) listeners.chip(ownerId, cx, cy);
    }

    // Draw cell-aligned particles, batched by colour.
    function draw(renderer) {
      const { ctx, camera, view } = renderer;
      const z = camera.zoom;
      const size = Math.max(1, Math.round(z));
      const x0 = camera.x, y0 = camera.y, x1 = x0 + view.width / z, y1 = y0 + view.height / z;
      const groups = new Map();
      const put = (c, x, y) => {
        let list = groups.get(c);
        if (!list) { list = []; groups.set(c, list); }
        list.push(Math.round((x - x0) * z), Math.round((y - y0) * z));
      };
      for (let i = 0; i < count; i += 1) {
        const x = px[i], y = py[i];
        if (x < x0 - 64 || x > x1 + 64 || y < y0 - 64 || y > y1 + 64) continue;
        if (chunkOf[i] >= 0) {
          // (a chunk: each of its cells, on the grid)
          const c = chunkOf[i], base = c * CHUNK_CELLS, ax = Math.floor(x), ay = Math.floor(y);
          const t = temp[i], hot = t > GLOW_FROM;
          for (let q = 0; q < chunkN[c]; q += 1) put(hot ? PW.glowing(chunkColor[base + q], t) : chunkColor[base + q], ax + chunkDx[base + q], ay + chunkDy[base + q]);
          continue;
        }
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        let c = color[i];
        const t = temp[i], fl = flags[i];
        if (fl & F.FIRE) {
          // (a flame, its own pixel: its colour by how much of its life is gone)
          c = FLAME[Math.min(FLAME.length - 1, (age[i] / (age[i] + life[i]) * FLAME.length) | 0)];
        } else if (fl & F.SMOKE) {
          // (its own shade, see-through as it was made, fading out over its last second and a half;
          // still red-hot from the flame it was, a moment, as it cools to that shade)
          const fade = Math.max(0, Math.min(1, life[i] / 1.5));
          const a = Math.round((c >>> 24) * fade / 32) * 32;
          if (a < 24) continue;
          c = (c & 0x00ffffff | Math.min(255, a) << 24) >>> 0;
          if (t > GLOW_FROM) c = mix(c, FLAME[FLAME.length - 1], Math.min(1, (t - GLOW_FROM) / (FIRE_END - GLOW_FROM)));
        } else if (fl & F.GLOW) {
          // (a spark is all light: its colour is its heat; spent, it is gone)
          if (t > GLOW_FROM) c = PW.glowAt(t);
          else if (t > AMBIENT + 30) continue;
        } else if (t > GLOW_FROM) c = PW.glowing(c, t);
        put(c, Math.floor(x), Math.floor(y));
      }
      for (const [c, list] of groups) {
        const a = (c >>> 24) / 255;
        ctx.fillStyle = `rgba(${c & 255},${c >>> 8 & 255},${c >>> 16 & 255},${a})`;
        ctx.beginPath();
        for (let k = 0; k < list.length; k += 2) ctx.rect(list[k], list[k + 1], size, size);
        ctx.fill();
      }
    }
    const api = { spawn, hold, step, draw, drainImpacts, flush: flushDebris, F, stats, listeners, get count() { return count + pend.n + held.n; }, capacity, px, py, vx, vy, flags };
    return api;
  }

  PW.createParticles = createParticles;
  PW.PARTICLE = F;
  PW.GRAVITY = GRAVITY;
})();
