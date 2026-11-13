'use strict';
// Urban Defence pixel world core.
// One cell grid holds terrain, water, debris, roads and structures. One cell is one pixel of the
// trooper reference art (about 7 cm), and every system in the game draws on this same grid.
//
// Layers (all addressed by the same cell coordinates):
//   mat   - full Uint8Array, the physical material of every cell (bits 0-5 id, bits 6-7 variant).
//   paint - sparse per-chunk Uint32 colours (ABGR) for artwork on physical cells (buildings, roads,
//           tunnel linings, bridges). 0 means "use the material palette".
//   back  - sparse per-chunk colours drawn behind empty cells (building interiors, tunnel walls).
//   deco  - sparse per-chunk colours drawn in front of units (trees, grass, lamps, cables, defences).
(function () {
  const PW = window.PW = window.PW || {};

  // ---- Materials ---------------------------------------------------------------------------
  const ID_MASK = 63;
  const M = Object.freeze({
    AIR: 0, GRASS: 1, TOPSOIL: 2, SOIL: 3, CLAY: 4, GRAVEL: 5, STONE: 6, BEDROCK: 7, SAND: 8, ORE: 9,
    WATER: 10, LOOSE_SOIL: 11, LOOSE_STONE: 12, DEBRIS: 13,
    // Debris that came to rest on the ground and compacted into it (keeps its rubble colours).
    RUBBLE: 14,
    CONCRETE: 16, BRICK: 17, STEEL: 18, GLASS: 19, WOOD: 20, TILE: 21, MASONRY: 22, FOUNDATION: 23,
    ASPHALT: 24, ROADBED: 25, LINING: 26, BRIDGE: 27, PILLAR: 28, PIPE: 29, CORE: 30,
    // Stairs and stairwell floors: units stand on them from above but climb up through them.
    PLATFORM: 31,
    // Cover: boulders, stalagmites, barrels, crates, mine cars and sandbags. Units walk past them
    // (they stand at another depth) but they stop bullets, so troops duck behind them.
    COVER_ROCK: 32, COVER_WOOD: 33, COVER_METAL: 34, COVER_SAND: 35,
    // Reinforced concrete lining of a developed tunnel: another side cannot dig through it.
    REINFORCED: 36,
  });
  const PHASE = Object.freeze({ AIR: 0, LIQUID: 1, POWDER: 2, SOLID: 3 });
  // Debris variants (bits 6-7 of a DEBRIS cell) pick the rubble palette.
  const DEBRIS_KIND = Object.freeze({ CONCRETE: 0, BRICK: 1, WOOD: 2, METAL: 3 });

  const phase = new Uint8Array(64);
  const structural = new Uint8Array(64);   // part of a building's load path
  const ground = new Uint8Array(64);       // counts as ground for footing
  const skyline = new Uint8Array(64);      // natural ground that ends the open sky (bridges and roof debris don't)
  const hardness = new Float32Array(64);   // 0 = no resistance to blasts, 1 = indestructible
  const breaksTo = new Uint8Array(64);     // cell byte left behind (or flung) when shattered
  const passable = new Uint8Array(64);     // units move through it (air, water, cover)
  const stopsShots = new Uint8Array(64);   // bullets and shells stop in it (glass lets them through)
  const terrain = new Uint8Array(64);      // natural ground and loose heaps: nothing is drawn over it
  const palettes = new Array(64);
  const names = new Array(64).fill('');

  function abgr(r, g, b, a = 255) {
    return ((a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | (r & 255)) >>> 0;
  }
  function unpack(color) {
    return [color & 255, color >>> 8 & 255, color >>> 16 & 255, color >>> 24 & 255];
  }
  function define(id, name, props, colors) {
    names[id] = name;
    phase[id] = props.phase ?? PHASE.SOLID;
    structural[id] = props.structural ? 1 : 0;
    ground[id] = props.ground ? 1 : 0;
    hardness[id] = props.hardness ?? 0.3;
    breaksTo[id] = props.breaksTo ?? 0;
    // Eight shades: index = variant * 2 + (hash & 1). Fewer colours repeat.
    const shades = new Uint32Array(8);
    for (let i = 0; i < 8; i += 1) {
      const c = colors[i % colors.length];
      shades[i] = abgr(c[0], c[1], c[2], c[3] ?? 255);
    }
    palettes[id] = shades;
  }
  const debris = (kind) => M.DEBRIS | kind << 6;

  // Natural colours follow the tunnel network lab (grass, soil, wavy brown rock, purple ore, blue water).
  define(M.AIR, 'air', { phase: PHASE.AIR, hardness: 0 }, [[0, 0, 0, 0]]);
  define(M.GRASS, 'grass', { ground: true, hardness: 0.15, breaksTo: M.LOOSE_SOIL },
    [[88, 124, 54], [64, 96, 42], [92, 128, 56], [70, 102, 45], [84, 120, 52], [60, 92, 40], [96, 132, 58], [66, 98, 43]]);
  define(M.TOPSOIL, 'topsoil', { ground: true, hardness: 0.2, breaksTo: M.LOOSE_SOIL },
    [[104, 80, 52], [94, 72, 47], [108, 83, 54], [98, 75, 49], [101, 78, 51], [92, 70, 46], [110, 85, 55], [96, 74, 48]]);
  define(M.SOIL, 'soil', { ground: true, hardness: 0.25, breaksTo: M.LOOSE_SOIL },
    [[92, 72, 48], [88, 69, 46], [95, 74, 50], [86, 67, 45], [93, 73, 49], [89, 70, 47], [97, 76, 51], [85, 66, 44]]);
  define(M.CLAY, 'clay', { ground: true, hardness: 0.35, breaksTo: M.LOOSE_SOIL },
    [[100, 70, 48], [95, 66, 45], [104, 73, 50], [92, 64, 44], [101, 71, 49], [96, 67, 46], [106, 75, 51], [93, 65, 45]]);
  define(M.GRAVEL, 'gravel', { ground: true, hardness: 0.4, breaksTo: M.LOOSE_STONE },
    [[104, 88, 66], [94, 79, 59], [110, 94, 71], [90, 76, 57], [106, 90, 68], [96, 81, 61], [114, 97, 74], [92, 78, 58]]);
  define(M.STONE, 'stone', { ground: true, hardness: 0.7, breaksTo: M.LOOSE_STONE },
    [[86, 76, 64], [82, 72, 61], [90, 80, 67], [78, 69, 58], [87, 77, 65], [83, 73, 62], [92, 82, 69], [79, 70, 59]]);
  define(M.BEDROCK, 'bedrock', { ground: true, hardness: 1 },
    [[42, 37, 33], [38, 34, 30], [46, 41, 36], [36, 32, 29]]);
  define(M.SAND, 'sand', { phase: PHASE.POWDER, ground: true, hardness: 0.1 },
    [[168, 146, 102], [156, 135, 94], [174, 152, 107], [150, 130, 91], [170, 148, 104], [160, 139, 97], [178, 156, 110], [154, 133, 93]]);
  // Ore uses three facet tones per variant; variant 3 holds the bright sparkles.
  define(M.ORE, 'ore', { ground: true, hardness: 0.6, breaksTo: M.LOOSE_STONE },
    [[192, 107, 252], [155, 86, 203], [155, 86, 203], [127, 71, 167], [192, 107, 252], [127, 71, 167], [240, 210, 255], [192, 107, 252]]);
  define(M.WATER, 'water', { phase: PHASE.LIQUID, hardness: 0 },
    [[52, 120, 200], [50, 116, 194], [54, 124, 204], [48, 112, 190]]);
  define(M.LOOSE_SOIL, 'loose soil', { phase: PHASE.POWDER, ground: true, hardness: 0.05 },
    [[110, 86, 58], [100, 78, 53], [116, 90, 61], [96, 75, 50], [112, 88, 59], [104, 81, 55], [120, 94, 63], [98, 76, 51]]);
  define(M.LOOSE_STONE, 'loose stone', { phase: PHASE.POWDER, ground: true, hardness: 0.1 },
    [[114, 104, 92], [100, 91, 80], [124, 113, 100], [94, 86, 76], [118, 108, 95], [106, 96, 85], [128, 117, 103], [97, 89, 78]]);
  // Rubble palettes by variant: concrete, brick, wood, metal/glass.
  define(M.DEBRIS, 'debris', { phase: PHASE.POWDER, ground: true, hardness: 0.05 },
    [[138, 136, 128], [116, 114, 108], [150, 92, 70], [128, 78, 60], [120, 88, 58], [98, 72, 48], [120, 134, 144], [94, 104, 112]]);
  define(M.CONCRETE, 'concrete', { structural: true, hardness: 0.45, breaksTo: debris(DEBRIS_KIND.CONCRETE) },
    [[150, 148, 140], [142, 140, 133], [158, 156, 147], [136, 134, 127]]);
  define(M.BRICK, 'brick', { structural: true, hardness: 0.4, breaksTo: debris(DEBRIS_KIND.BRICK) },
    [[146, 86, 64], [138, 80, 60], [154, 92, 68], [130, 76, 57]]);
  define(M.STEEL, 'steel', { structural: true, hardness: 0.6, breaksTo: debris(DEBRIS_KIND.METAL) },
    [[112, 120, 128], [104, 112, 120], [120, 128, 136], [98, 106, 114]]);
  define(M.GLASS, 'glass', { structural: true, hardness: 0.08, breaksTo: debris(DEBRIS_KIND.METAL) },
    [[96, 138, 160], [88, 128, 150], [104, 148, 170], [82, 120, 142]]);
  define(M.WOOD, 'wood', { structural: true, hardness: 0.25, breaksTo: debris(DEBRIS_KIND.WOOD) },
    [[120, 82, 52], [112, 76, 48], [128, 88, 56], [104, 71, 45]]);
  define(M.TILE, 'roof tile', { structural: true, hardness: 0.3, breaksTo: debris(DEBRIS_KIND.BRICK) },
    [[110, 70, 58], [102, 64, 54], [118, 76, 62], [96, 60, 51]]);
  define(M.MASONRY, 'masonry', { structural: true, hardness: 0.5, breaksTo: debris(DEBRIS_KIND.CONCRETE) },
    [[128, 122, 112], [120, 114, 105], [136, 130, 119], [114, 108, 100]]);
  define(M.FOUNDATION, 'foundation', { structural: true, ground: true, hardness: 0.75, breaksTo: debris(DEBRIS_KIND.CONCRETE) },
    [[104, 102, 96], [98, 96, 90], [110, 108, 101], [94, 92, 87]]);
  define(M.ASPHALT, 'asphalt', { ground: true, hardness: 0.4, breaksTo: M.LOOSE_STONE },
    [[58, 60, 62], [54, 56, 58], [62, 64, 66], [52, 53, 55]]);
  define(M.ROADBED, 'road bed', { ground: true, hardness: 0.35, breaksTo: M.LOOSE_STONE },
    [[104, 96, 84], [98, 90, 79], [110, 101, 88], [94, 86, 76]]);
  define(M.LINING, 'tunnel lining', { ground: true, hardness: 0.6, breaksTo: debris(DEBRIS_KIND.CONCRETE) },
    [[191, 123, 25], [180, 116, 24], [200, 130, 28], [172, 110, 22]]);
  define(M.BRIDGE, 'bridge steel', { structural: true, ground: true, hardness: 0.55, breaksTo: debris(DEBRIS_KIND.METAL) },
    [[96, 104, 112], [90, 98, 106], [102, 110, 118], [86, 93, 100]]);
  define(M.PILLAR, 'pillar', { structural: true, ground: true, hardness: 0.6, breaksTo: debris(DEBRIS_KIND.CONCRETE) },
    [[132, 130, 124], [126, 124, 118], [138, 136, 129], [120, 118, 113]]);
  define(M.PIPE, 'pipe', { ground: true, hardness: 0.5, breaksTo: debris(DEBRIS_KIND.METAL) },
    [[120, 124, 92], [112, 116, 86], [128, 132, 98], [106, 110, 82]]);
  define(M.CORE, 'core', { structural: true, hardness: 0.85, breaksTo: debris(DEBRIS_KIND.METAL) },
    [[255, 164, 20], [236, 148, 16], [255, 186, 60], [222, 136, 14]]);
  define(M.PLATFORM, 'platform', { structural: true, hardness: 0.4, breaksTo: debris(DEBRIS_KIND.CONCRETE) },
    [[120, 116, 108], [112, 108, 101], [128, 124, 115], [106, 102, 96]]);
  define(M.RUBBLE, 'rubble', { ground: true, hardness: 0.15, breaksTo: M.DEBRIS },
    [[124, 122, 115], [104, 102, 97], [135, 83, 63], [115, 70, 54], [108, 79, 52], [88, 65, 43], [108, 120, 130], [85, 94, 101]]);
  // Cover props carry their own paint; the palettes show through only on unpainted (damaged) cells.
  define(M.COVER_ROCK, 'cover rock', { hardness: 0.65, breaksTo: M.LOOSE_STONE },
    [[112, 104, 94], [96, 89, 80], [124, 116, 104], [88, 82, 74]]);
  define(M.COVER_WOOD, 'cover wood', { hardness: 0.25, breaksTo: debris(DEBRIS_KIND.WOOD) },
    [[132, 96, 60], [112, 80, 50], [146, 108, 68], [100, 72, 46]]);
  define(M.COVER_METAL, 'cover metal', { hardness: 0.45, breaksTo: debris(DEBRIS_KIND.METAL) },
    [[96, 84, 72], [80, 70, 60], [110, 98, 84], [72, 64, 56]]);
  define(M.COVER_SAND, 'sandbags', { hardness: 0.5, breaksTo: M.SAND },
    [[176, 158, 112], [150, 134, 94], [196, 178, 130], [140, 124, 88]]);
  define(M.REINFORCED, 'reinforced lining', { ground: true, hardness: 0.85, breaksTo: debris(DEBRIS_KIND.CONCRETE) },
    [[132, 134, 130], [124, 126, 122], [140, 142, 138], [118, 120, 116]]);
  for (const id of [M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.BEDROCK, M.SAND, M.ORE, M.WATER,
    M.LOOSE_SOIL, M.LOOSE_STONE, M.RUBBLE, M.ASPHALT, M.ROADBED, M.LINING, M.PIPE, M.REINFORCED]) skyline[id] = 1;
  for (const id of [M.AIR, M.WATER, M.COVER_ROCK, M.COVER_WOOD, M.COVER_METAL, M.COVER_SAND]) passable[id] = 1;
  for (let id = 1; id < 64; id += 1) if (names[id] && phase[id] >= PHASE.POWDER && id !== M.GLASS) stopsShots[id] = 1;
  for (const id of [M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.BEDROCK, M.SAND, M.ORE,
    M.LOOSE_SOIL, M.LOOSE_STONE, M.DEBRIS, M.RUBBLE]) terrain[id] = 1;

  // ---- Hashing and random numbers ------------------------------------------------------------
  function hash2(x, y) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
    h = Math.imul(h ^ h >>> 15, 0x85ebca6b);
    h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
    return (h ^ h >>> 16) >>> 0;
  }
  function hash3(x, y, z) { return hash2(x ^ Math.imul(z | 0, 0x9e3779b1), y + z | 0); }
  function createRandom(seed) {
    let state = seed >>> 0 || 1;
    const next = () => {
      state = state + 0x6d2b79f5 | 0;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    next.range = (min, max) => min + next() * (max - min);
    next.int = (min, max) => Math.floor(min + next() * (max - min + 1));
    next.pick = (list) => list[Math.floor(next() * list.length)];
    next.chance = (p) => next() < p;
    return next;
  }
  // Smooth 1D value noise in [-1, 1] with a seeded lattice.
  function createNoise1D(seed, period) {
    const random = createRandom(seed);
    const size = 1024;
    const lattice = new Float32Array(size);
    for (let i = 0; i < size; i += 1) lattice[i] = random() * 2 - 1;
    return (x) => {
      const p = x / period;
      const i = Math.floor(p);
      const t = p - i;
      const s = t * t * (3 - 2 * t);
      const a = lattice[(i % size + size) % size];
      const b = lattice[((i + 1) % size + size) % size];
      return a + (b - a) * s;
    };
  }
  // Smooth 2D value noise in [-1, 1].
  function createNoise2D(seed, period) {
    const random = createRandom(seed);
    const size = 256;
    const lattice = new Float32Array(size * size);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = random() * 2 - 1;
    return (x, y) => {
      const px = x / period, py = y / period;
      const ix = Math.floor(px), iy = Math.floor(py);
      const tx = px - ix, ty = py - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const x0 = (ix % size + size) % size, y0 = (iy % size + size) % size;
      const x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
      const a = lattice[y0 * size + x0], b = lattice[y0 * size + x1];
      const c = lattice[y1 * size + x0], d = lattice[y1 * size + x1];
      const top = a + (b - a) * sx, bottom = c + (d - c) * sx;
      return top + (bottom - top) * sy;
    };
  }

  // ---- World ---------------------------------------------------------------------------------
  const CHUNK_SHIFT = 7;
  const CHUNK = 1 << CHUNK_SHIFT;
  const CHUNK_MASK = CHUNK - 1;
  const CHUNK_CELLS = CHUNK * CHUNK;
  // Render dirty bits per chunk.
  const DIRTY_BASE = 1, DIRTY_DECO = 2;

  function createWorld(width, height) {
    if (width % CHUNK || height % CHUNK) throw new Error('World size must be a multiple of the chunk size');
    const chunksX = width >> CHUNK_SHIFT;
    const chunksY = height >> CHUNK_SHIFT;
    const chunkCount = chunksX * chunksY;
    const world = {
      width, height, chunksX, chunksY, chunkCount,
      mat: new Uint8Array(width * height),
      paint: new Array(chunkCount).fill(null),
      back: new Array(chunkCount).fill(null),
      deco: new Array(chunkCount).fill(null),
      // Sparse per-cell data: owning building/infrastructure id, and FLAG bits.
      owner: new Array(chunkCount).fill(null),
      flags: new Array(chunkCount).fill(null),
      // Top-most natural ground cell per column; air above it is open sky.
      groundTop: new Int32Array(width).fill(height),
      chunkDirty: new Uint8Array(chunkCount),
      chunkVersion: new Uint32Array(chunkCount),
      // Changed cell rectangle per chunk since the last full-resolution redraw (local coords).
      dirtyRect: new Int16Array(chunkCount * 4).fill(-1),
      // Simulation: chunks with moving cells, and the cell rectangle that may still move.
      simActive: new Uint8Array(chunkCount),
      simRect: new Int32Array(chunkCount * 4),
      simIdle: new Uint16Array(chunkCount),
      activeList: [],
      tick: 0,
    };
    for (let c = 0; c < chunkCount; c += 1) clearSimRect(world, c);
    return world;
  }
  function clearSimRect(world, c) {
    const r = world.simRect;
    r[c * 4] = CHUNK; r[c * 4 + 1] = CHUNK; r[c * 4 + 2] = -1; r[c * 4 + 3] = -1;
  }
  function chunkIndex(world, x, y) { return (y >> CHUNK_SHIFT) * world.chunksX + (x >> CHUNK_SHIFT); }
  function inside(world, x, y) { return x >= 0 && y >= 0 && x < world.width && y < world.height; }

  function markDirty(world, x, y, bits = DIRTY_BASE) {
    const c = chunkIndex(world, x, y);
    world.chunkDirty[c] |= bits;
    world.chunkVersion[c] += 1;
    const r = world.dirtyRect, o = c * 4, lx = x & CHUNK_MASK, ly = y & CHUNK_MASK;
    if (r[o] < 0) { r[o] = lx; r[o + 1] = ly; r[o + 2] = lx; r[o + 3] = ly; return; }
    if (lx < r[o]) r[o] = lx; if (ly < r[o + 1]) r[o + 1] = ly;
    if (lx > r[o + 2]) r[o + 2] = lx; if (ly > r[o + 3]) r[o + 3] = ly;
  }
  // Water is shaded by its distance to open air (up to WATER_REACH cells in any direction), so a
  // water change dirties that whole neighbourhood, clipped into each chunk it overlaps.
  const WATER_REACH = 24;
  function markWaterDirty(world, x, y) {
    const x0 = Math.max(0, x - WATER_REACH), x1 = Math.min(world.width - 1, x + WATER_REACH);
    const y0 = Math.max(0, y - WATER_REACH), y1 = Math.min(world.height - 1, y + WATER_REACH);
    for (let cy = y0 >> CHUNK_SHIFT; cy <= y1 >> CHUNK_SHIFT; cy += 1) {
      for (let cx = x0 >> CHUNK_SHIFT; cx <= x1 >> CHUNK_SHIFT; cx += 1) {
        const left = Math.max(x0, cx << CHUNK_SHIFT), right = Math.min(x1, (cx << CHUNK_SHIFT) + CHUNK_MASK);
        const top = Math.max(y0, cy << CHUNK_SHIFT), bottom = Math.min(y1, (cy << CHUNK_SHIFT) + CHUNK_MASK);
        markDirty(world, left, top);
        markDirty(world, right, bottom);
      }
    }
  }
  // Wake the simulation around a cell (its chunk, plus neighbours when on a chunk edge).
  function wake(world, x, y) {
    const lx = x & CHUNK_MASK, ly = y & CHUNK_MASK;
    wakeCell(world, x, y);
    if (lx === 0 && x > 0) wakeCell(world, x - 1, y);
    if (lx === CHUNK_MASK && x < world.width - 1) wakeCell(world, x + 1, y);
    if (ly === 0 && y > 0) wakeCell(world, x, y - 1);
    if (ly === CHUNK_MASK && y < world.height - 1) wakeCell(world, x, y + 1);
  }
  function wakeCell(world, x, y) {
    const c = chunkIndex(world, x, y);
    const lx = x & CHUNK_MASK, ly = y & CHUNK_MASK;
    const r = world.simRect, o = c * 4;
    if (!world.simActive[c]) { world.simActive[c] = 1; world.activeList.push(c); }
    world.simIdle[c] = 0;
    if (lx - 1 < r[o]) r[o] = Math.max(0, lx - 1);
    if (ly - 1 < r[o + 1]) r[o + 1] = Math.max(0, ly - 1);
    if (lx + 1 > r[o + 2]) r[o + 2] = Math.min(CHUNK_MASK, lx + 1);
    if (ly + 1 > r[o + 3]) r[o + 3] = Math.min(CHUNK_MASK, ly + 1);
  }
  function wakeArea(world, x0, y0, x1, y1) {
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
    x1 = Math.min(world.width - 1, x1 | 0); y1 = Math.min(world.height - 1, y1 | 0);
    if (x1 < x0 || y1 < y0) return;
    for (let cy = y0 >> CHUNK_SHIFT; cy <= y1 >> CHUNK_SHIFT; cy += 1) {
      for (let cx = x0 >> CHUNK_SHIFT; cx <= x1 >> CHUNK_SHIFT; cx += 1) {
        const left = Math.max(x0, cx << CHUNK_SHIFT), right = Math.min(x1, (cx << CHUNK_SHIFT) + CHUNK_MASK);
        const top = Math.max(y0, cy << CHUNK_SHIFT), bottom = Math.min(y1, (cy << CHUNK_SHIFT) + CHUNK_MASK);
        wakeCell(world, left, top);
        wakeCell(world, right, bottom);
      }
    }
  }

  function get(world, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return M.BEDROCK;
    return world.mat[y * world.width + x];
  }
  function id(world, x, y) { return get(world, x, y) & ID_MASK; }

  // Keep the sky line of column x right after cell (x, y) became material `id`.
  function touchGroundTop(world, x, y, id) {
    const top = world.groundTop[x];
    if (skyline[id]) { if (y < top) world.groundTop[x] = y; }
    else if (top === y) refreshGroundTop(world, x, y + 1);
  }
  // Set a cell's material. Keeps groundTop, render dirtiness and simulation activity in step.
  function set(world, x, y, value, options) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
    const index = y * world.width + x;
    const previous = world.mat[index];
    if (previous === value) return;
    world.mat[index] = value;
    const before = previous & ID_MASK, after = value & ID_MASK;
    if (before !== after) touchGroundTop(world, x, y, after);
    if (!options || !options.keepPaint) clearPaintAt(world, x, y);
    if (before === M.WATER || after === M.WATER) markWaterDirty(world, x, y);
    else markDirty(world, x, y);
    if (!options || !options.quiet) wake(world, x, y);
    else if (before !== after && phase[after] >= PHASE.LIQUID && phase[after] <= PHASE.POWDER) wake(world, x, y);
  }
  // Swap two cells by flat index (the cell automaton's move). Paint stays put: moving cells
  // (water, powders) are coloured from their material palette.
  function swapCells(world, i, j) {
    const mat = world.mat, W = world.width;
    const a = mat[i], b = mat[j];
    mat[i] = b; mat[j] = a;
    const xi = i % W, yi = (i / W) | 0, xj = j % W, yj = (j / W) | 0;
    const ai = a & ID_MASK, bi = b & ID_MASK;
    touchGroundTop(world, xi, yi, bi);
    touchGroundTop(world, xj, yj, ai);
    if (ai === M.WATER || bi === M.WATER) { markWaterDirty(world, xi, yi); markWaterDirty(world, xj, yj); }
    else { markDirty(world, xi, yi); markDirty(world, xj, yj); }
  }
  function refreshGroundTop(world, x, from = 0) {
    const { mat, width, height } = world;
    let y = Math.max(0, from);
    for (; y < height; y += 1) if (skyline[mat[y * width + x] & ID_MASK]) break;
    world.groundTop[x] = y;
  }
  function rebuildGroundTop(world) {
    for (let x = 0; x < world.width; x += 1) refreshGroundTop(world, x);
  }

  // ---- Sparse typed data layers (owner ids, flags) ------------------------------------------------
  // RAW marks the inside of a tunnel that is still timbered (undeveloped), DEVELOPED one that has
  // been lined, and FIXTURE back-wall fittings (rails, signs) that development must keep.
  // OVERBREAK marks rock that broke away beyond a raw tunnel's planned profile (filled with concrete
  // when the stretch is developed).
  const FLAG = Object.freeze({ LADDER: 1, ROAD: 2, TUNNEL: 4, NOBUILD: 8, SCORCH: 16, CARVED: 32, BRIDGE: 64, HATCH: 128,
    RAW: 256, FIXTURE: 512, DEVELOPED: 1024, OVERBREAK: 2048 });
  function getOwner(world, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 0;
    const chunk = world.owner[chunkIndex(world, x, y)];
    return chunk ? chunk[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] : 0;
  }
  function setOwner(world, x, y, id) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
    const c = chunkIndex(world, x, y);
    let chunk = world.owner[c];
    if (!chunk) { if (!id) return; chunk = world.owner[c] = new Uint16Array(CHUNK_CELLS); }
    chunk[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] = id;
  }
  function getFlags(world, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 0;
    const chunk = world.flags[chunkIndex(world, x, y)];
    return chunk ? chunk[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] : 0;
  }
  function setFlag(world, x, y, bit, on = true) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
    const c = chunkIndex(world, x, y);
    let chunk = world.flags[c];
    if (!chunk) { if (!on) return; chunk = world.flags[c] = new Uint16Array(CHUNK_CELLS); }
    const i = (y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK;
    chunk[i] = on ? chunk[i] | bit : chunk[i] & ~bit;
  }

  // ---- Sparse colour layers -------------------------------------------------------------------
  function layerCell(world, layer, x, y, create) {
    const c = chunkIndex(world, x, y);
    let chunk = world[layer][c];
    if (!chunk) {
      if (!create) return null;
      chunk = world[layer][c] = new Uint32Array(CHUNK_CELLS);
    }
    return chunk;
  }
  function getLayer(world, layer, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 0;
    const chunk = world[layer][chunkIndex(world, x, y)];
    return chunk ? chunk[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] : 0;
  }
  function setLayer(world, layer, x, y, color) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
    const chunk = layerCell(world, layer, x, y, color !== 0);
    if (!chunk) return;
    const index = (y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK;
    if (chunk[index] === color) return;
    chunk[index] = color;
    markDirty(world, x, y, layer === 'deco' ? DIRTY_DECO : DIRTY_BASE);
  }
  function clearPaintAt(world, x, y) {
    const chunk = world.paint[chunkIndex(world, x, y)];
    if (chunk) chunk[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] = 0;
  }

  // ---- Queries --------------------------------------------------------------------------------
  function isSolid(m) { return phase[m & ID_MASK] >= PHASE.POWDER; }
  function isOpen(m) { const p = phase[m & ID_MASK]; return p === PHASE.AIR; }
  // Highest solid ground cell at or below y (for footing). Returns height if none.
  function groundBelow(world, x, y) {
    if (x < 0 || x >= world.width) return world.height;
    const { mat, width, height } = world;
    for (let row = Math.max(0, y | 0); row < height; row += 1) {
      const m = mat[row * width + x] & ID_MASK;
      if (ground[m]) return row;
    }
    return height;
  }
  // First cell at or below y that something could rest on (any solid or powder; water is passed
  // through when `throughWater` is set, so reeds and pipes find the lake bed).
  function supportBelow(world, x, y, throughWater = false) {
    if (x < 0 || x >= world.width) return world.height;
    const { mat, width, height } = world;
    for (let row = Math.max(0, y | 0); row < height; row += 1) {
      const id = mat[row * width + x] & ID_MASK;
      if (phase[id] >= PHASE.POWDER) return row;
      if (id === M.WATER && !throughWater) return row;
    }
    return height;
  }
  // Follow a shot cell by cell from (x0, y0) towards (x1, y1). Returns the first cell that stops
  // it ({ x, y, id }) or null when the line is clear. Cover stops shots even though units walk
  // through it, which is what lets a crouched trooper hide behind a barrel or a boulder.
  function traceShot(world, x0, y0, x1, y1) {
    let x = Math.round(x0), y = Math.round(y0);
    const tx = Math.round(x1), ty = Math.round(y1);
    const dx = Math.abs(tx - x), dy = -Math.abs(ty - y), sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 65536; guard += 1) {
      const id = get(world, x, y) & ID_MASK;
      if (stopsShots[id]) return { x, y, id };
      if (x === tx && y === ty) return null;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return null;
  }

  PW.M = M;
  PW.PHASE = PHASE;
  PW.DEBRIS_KIND = DEBRIS_KIND;
  PW.ID_MASK = ID_MASK;
  PW.mat = { phase, structural, ground, skyline, hardness, breaksTo, passable, stopsShots, terrain, palettes, names };
  PW.CHUNK = CHUNK;
  PW.CHUNK_SHIFT = CHUNK_SHIFT;
  PW.CHUNK_MASK = CHUNK_MASK;
  PW.CHUNK_CELLS = CHUNK_CELLS;
  PW.WATER_REACH = WATER_REACH;
  PW.DIRTY_BASE = DIRTY_BASE;
  PW.DIRTY_DECO = DIRTY_DECO;
  PW.FLAG = FLAG;
  Object.assign(PW, {
    abgr, unpack, hash2, hash3, createRandom, createNoise1D, createNoise2D,
    createWorld, chunkIndex, inside, markDirty, markWaterDirty, wake, wakeCell, wakeArea, clearSimRect,
    get, id, set, swapCells, touchGroundTop, refreshGroundTop, rebuildGroundTop,
    getLayer, setLayer, layerCell, clearPaintAt, isSolid, isOpen, groundBelow, supportBelow, traceShot,
    getOwner, setOwner, getFlags, setFlag,
  });
})();
