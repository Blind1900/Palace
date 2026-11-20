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
    // Made ground under towns, down to the supply lines: compacted fill (and pipe bedding), buried
    // concrete slabs, and brick courses. Ground like any other, dug and blasted by its hardness.
    FILL: 37, SLAB: 38, COURSE: 39,
    // Gases (variant bits = density 0-3) and the ash left by fire.
    SMOKE: 40, STEAM: 41, DUST: 42, ASH: 43,
    // A piece of a wrecked building that came to rest whole: part of the ground now (it can slide
    // and break loose), keeping the building's colours, until a town's builders clear it for HM.
    RUIN: 44,
  });
  // Gases sit between air and liquids: anything heavier moves through them as through air.
  const PHASE = Object.freeze({ AIR: 0, GAS: 1, LIQUID: 2, POWDER: 3, SOLID: 4 });
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
  const open = new Uint8Array(64);         // air or gas: free space other cells move into
  // Thermal properties. conduct: share of a temperature difference exchanged with a neighbour per
  // heat tick (15 Hz); ignite: °C at which it catches fire (0 = never); burn: seconds of fuel;
  // burnsTo: what is left (0 = keep, scorched); boil: °C at which it turns to steam.
  const conduct = new Float32Array(64).fill(0.06);
  const ignite = new Uint16Array(64), burnTime = new Float32Array(64), burnsTo = new Uint8Array(64);
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
  // (dark humus-rich topsoil, a chernozem, clearly darker than the subsoil under it)
  define(M.TOPSOIL, 'topsoil', { ground: true, hardness: 0.2, breaksTo: M.LOOSE_SOIL },
    [[66, 50, 36], [59, 45, 33], [70, 53, 38], [62, 47, 34], [64, 49, 35], [57, 44, 32], [73, 56, 40], [61, 46, 33]]);
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
  define(M.ASPHALT, 'asphalt', { ground: true, hardness: 0.5, breaksTo: M.LOOSE_STONE },
    [[58, 60, 62], [54, 56, 58], [62, 64, 66], [52, 53, 55]]);
  define(M.ROADBED, 'road bed', { ground: true, hardness: 0.45, breaksTo: M.LOOSE_STONE },
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
  define(M.FILL, 'made ground', { ground: true, hardness: 0.5, breaksTo: M.LOOSE_STONE },
    [[112, 104, 92], [104, 96, 85], [118, 110, 97], [98, 91, 81]]);
  define(M.SLAB, 'buried slab', { ground: true, hardness: 0.65, breaksTo: debris(DEBRIS_KIND.CONCRETE) },
    [[146, 144, 136], [138, 136, 129], [152, 150, 142], [132, 130, 124]]);
  define(M.COURSE, 'brick course', { ground: true, hardness: 0.55, breaksTo: debris(DEBRIS_KIND.BRICK) },
    [[124, 84, 66], [116, 78, 62], [130, 90, 70], [110, 74, 58]]);
  for (const id of [M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.BEDROCK, M.SAND, M.ORE, M.WATER,
    M.LOOSE_SOIL, M.LOOSE_STONE, M.RUBBLE, M.ASPHALT, M.ROADBED, M.LINING, M.PIPE, M.REINFORCED, M.FILL, M.SLAB, M.COURSE]) skyline[id] = 1;
  for (const id of [M.AIR, M.WATER, M.COVER_ROCK, M.COVER_WOOD, M.COVER_METAL, M.COVER_SAND]) passable[id] = 1;
  // Gases: smoke from fires and blasts, steam from boiling water (it condenses back into water,
  // so water is never lost), dust thrown up by blasts and collapses. Ash is what fire leaves.
  // (smoke is a warm grey lighter than the night sky, so plumes read against it: thin wisps
  // pale, thick billows darker, as in the strike references)
  define(M.SMOKE, 'smoke', { phase: PHASE.GAS, hardness: 0 },
    [[132, 126, 120], [124, 118, 112], [114, 108, 102], [106, 100, 96], [98, 92, 88], [90, 86, 82], [82, 78, 76], [76, 72, 70]]);
  define(M.STEAM, 'steam', { phase: PHASE.GAS, hardness: 0 }, [[220, 228, 234], [210, 220, 228], [228, 234, 238], [214, 222, 230]]);
  define(M.DUST, 'dust', { phase: PHASE.GAS, hardness: 0 }, [[150, 132, 104], [138, 122, 96], [158, 140, 110], [144, 126, 100]]);
  define(M.ASH, 'ash', { phase: PHASE.POWDER, ground: true, hardness: 0.03 },
    [[96, 94, 90], [82, 80, 77], [108, 106, 101], [74, 72, 70], [100, 98, 93], [88, 86, 82], [70, 68, 66], [92, 90, 86]]);
  skyline[M.ASH] = 1; terrain[M.ASH] = 1;
  define(M.RUIN, 'ruin', { ground: true, hardness: 0.35, breaksTo: M.DEBRIS },
    [[128, 126, 120], [112, 110, 105], [140, 132, 122], [104, 98, 92], [120, 114, 106], [96, 92, 88], [134, 128, 118], [108, 104, 98]]);
  skyline[M.RUIN] = 1; terrain[M.RUIN] = 1;
  for (const id of [M.SMOKE, M.STEAM, M.DUST]) passable[id] = 1;
  open[M.AIR] = 1; open[M.SMOKE] = 1; open[M.STEAM] = 1; open[M.DUST] = 1;
  // (daylight passes through what is open, and through water)
  const passesLight = new Uint8Array(64);
  for (let id = 0; id < 64; id += 1) passesLight[id] = open[id] || id === M.WATER ? 1 : 0;
  for (let id = 1; id < 64; id += 1) if (names[id] && phase[id] >= PHASE.POWDER && id !== M.GLASS) stopsShots[id] = 1;
  // Thermal table (temperatures in °C, ambient 20).
  const thermal = (ids, props) => { for (const id of ids) {
    if (props.conduct !== undefined) conduct[id] = props.conduct;
    if (props.ignite) { ignite[id] = props.ignite; burnTime[id] = props.burn; burnsTo[id] = props.to ?? 0; }
  } };
  thermal([M.AIR, M.SMOKE, M.STEAM, M.DUST], { conduct: 0.22 });
  thermal([M.WATER], { conduct: 0.14 });
  thermal([M.STEEL, M.BRIDGE, M.PIPE, M.COVER_METAL, M.CORE], { conduct: 0.24 });
  thermal([M.CONCRETE, M.MASONRY, M.FOUNDATION, M.PILLAR, M.REINFORCED, M.LINING, M.BRICK, M.TILE, M.PLATFORM, M.GLASS], { conduct: 0.08 });
  thermal([M.GRASS], { conduct: 0.05, ignite: 260, burn: 3, to: M.TOPSOIL });
  thermal([M.WOOD], { conduct: 0.04, ignite: 380, burn: 40, to: M.ASH });
  thermal([M.COVER_WOOD], { conduct: 0.04, ignite: 320, burn: 25, to: M.ASH });
  thermal([M.COVER_SAND], { conduct: 0.04 });
  for (const id of [M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.BEDROCK, M.SAND, M.ORE,
    M.LOOSE_SOIL, M.LOOSE_STONE, M.DEBRIS, M.RUBBLE, M.FILL, M.SLAB, M.COURSE]) terrain[id] = 1;
  thermal([M.SLAB, M.COURSE], { conduct: 0.08 });

  // ---- Element physics (after The Powder Toy's element model; our own code and numbers) ----------
  // weight: what sinks through what (heavier displaces lighter: debris sinks through water, smoke
  //   rises through air). blastResist: blast strength lost per cell of it the blast passes through,
  //   so rock shields what lies behind it and a blast in a mountain chips a small hole where in
  //   soil it blows out a wide crater. cohesion: how many cells ground of it holds out over a void
  //   before it breaks loose (an overhang of soil drops at once; stone spans a cave mouth).
  // advection: how much of the wind's (or a blast wave's) speed a cell of it takes on - smoke and
  //   steam go with the air, dust and ash drift, sand and grit barely stir, solids not at all.
  // shake: how readily vibration (a blast, an avalanche, a collapse, felt from a distance) sets it
  //   moving - dry sand and ash run at the slightest shaking, loose rubble settles, a heap slumps,
  //   bare soil ravels on a steep face, rock and buildings stand (glass cracks).
  // How things move (every moving cell, in the grid or flying, goes by these):
  // slide: the chance a resting grain runs off a slope each tick (dry sand always, building
  //   rubble often, so its heaps are rough). repose: the steepest slope a heap of it stands at,
  //   as [rise, run] in cells - its angle of repose, as measured for the dry stuff: sand 2 in 3
  //   (34 degrees), earth and ash 3 in 4 (37), broken stone 5 in 6 (40), rubble 3 in 4 (37). A
  //   grain on a steeper slope runs off it - in the grid, or landing, or rolling where it lands
  //   (see pw-sim's stepPowder, pw-particles). settlesTo: what loose stuff
  //   resting on natural ground for a while packs down into. buoyancy: how fast a gas rises (cells
  //   per tick, as a chance; below zero it sinks). fade: the chance a gas thins each tick.
  //   Heavier sinks through lighter: grains sink through water unless lighter than it (ash floats),
  //   a gas rises through water and through a heavier gas. Anything with a long way to fall flies
  //   (gravity, drag and the wind, as the table says), and lands back in the grid.
  const weight = new Uint8Array(64), blastResist = new Float32Array(64), cohesion = new Uint8Array(64);
  const advection = new Float32Array(64), shake = new Float32Array(64);
  const slide = new Float32Array(64), settlesTo = new Int16Array(64).fill(-1);
  const reposeRise = new Uint8Array(64).fill(1), reposeRun = new Uint8Array(64).fill(1);
  const buoyancy = new Float32Array(64), fade = new Float32Array(64);
  const physics = (ids, props) => { for (const id of ids) {
    if (props.weight !== undefined) weight[id] = props.weight;
    if (props.resist !== undefined) blastResist[id] = props.resist;
    if (props.cohesion !== undefined) cohesion[id] = props.cohesion;
    if (props.advection !== undefined) advection[id] = props.advection;
    if (props.shake !== undefined) shake[id] = props.shake;
    if (props.slide !== undefined) slide[id] = props.slide;
    if (props.repose !== undefined) { reposeRise[id] = props.repose[0]; reposeRun[id] = props.repose[1]; }
    if (props.settlesTo !== undefined) settlesTo[id] = props.settlesTo;
    if (props.buoyancy !== undefined) buoyancy[id] = props.buoyancy;
    if (props.fade !== undefined) fade[id] = props.fade;
  } };
  for (let id = 1; id < 64; id += 1) if (names[id]) physics([id], { weight: phase[id] === PHASE.SOLID ? 100 : 50, resist: 0.03 });
  physics([M.STEAM], { weight: 1, resist: 0 }); physics([M.SMOKE], { weight: 2, resist: 0 }); physics([M.DUST], { weight: 4, resist: 0 });
  physics([M.WATER], { weight: 30, resist: 0.025 });
  physics([M.ASH], { weight: 40, resist: 0.004 });
  physics([M.SAND], { weight: 70, resist: 0.008, cohesion: 0 });
  physics([M.LOOSE_SOIL], { weight: 72, resist: 0.008, cohesion: 0 });
  physics([M.DEBRIS], { weight: 80, resist: 0.01, cohesion: 0 });
  physics([M.LOOSE_STONE], { weight: 85, resist: 0.012, cohesion: 0 });
  physics([M.GRASS, M.TOPSOIL], { resist: 0.012, cohesion: 4 });
  physics([M.SOIL], { resist: 0.012, cohesion: 3 });
  physics([M.CLAY], { resist: 0.02, cohesion: 6 });
  physics([M.GRAVEL], { resist: 0.02, cohesion: 2 });
  physics([M.RUBBLE], { resist: 0.012, cohesion: 2 });
  // (a ruin is the frame of a wrecked building round its open rooms: its slabs still span a room
  // or so, cracked; wider ones sag in and fall)
  physics([M.RUIN], { resist: 0.025, cohesion: 14, shake: 0.12 });
  physics([M.STONE], { resist: 0.045, cohesion: 16 });
  physics([M.ORE], { resist: 0.05, cohesion: 20 });
  physics([M.BEDROCK], { resist: 1, cohesion: 255 });
  // (a town's ground - compacted fill, buried slabs, brick courses, paving and its road base - is
  // made to carry its weight, and stands a blast nearly as well as rock)
  physics([M.FILL], { resist: 0.035, cohesion: 6 });
  physics([M.COURSE, M.BRICK], { resist: 0.045, cohesion: 10 });
  physics([M.ASPHALT], { resist: 0.045, cohesion: 12 });
  physics([M.ROADBED], { resist: 0.04, cohesion: 8 });
  physics([M.LINING], { resist: 0.05, cohesion: 40 });
  physics([M.REINFORCED], { resist: 0.08, cohesion: 60 });
  physics([M.CONCRETE, M.SLAB], { resist: 0.055, cohesion: 20 });
  physics([M.MASONRY, M.PILLAR], { resist: 0.055 });
  physics([M.FOUNDATION], { resist: 0.06 });
  physics([M.STEEL, M.BRIDGE], { resist: 0.06 });
  physics([M.GLASS], { resist: 0.004 });
  physics([M.WOOD, M.COVER_WOOD], { resist: 0.015 });
  physics([M.TILE], { resist: 0.02 });
  physics([M.PIPE, M.PLATFORM], { resist: 0.03 });
  physics([M.CORE], { resist: 0.1 });
  physics([M.COVER_ROCK], { resist: 0.065 }); physics([M.COVER_METAL], { resist: 0.04 }); physics([M.COVER_SAND], { resist: 0.03 });
  // Wind and vibration.
  physics([M.AIR], { advection: 1 });
  physics([M.STEAM], { advection: 0.95 }); physics([M.SMOKE], { advection: 0.9 }); physics([M.DUST], { advection: 0.8, shake: 1 });
  physics([M.ASH], { advection: 0.35, shake: 0.9 });
  physics([M.SAND], { advection: 0.06, shake: 0.9 });
  physics([M.LOOSE_SOIL], { advection: 0.04, shake: 0.7 });
  physics([M.LOOSE_STONE], { advection: 0.02, shake: 0.6 });
  physics([M.DEBRIS], { advection: 0.03, shake: 0.5 });
  physics([M.WATER], { advection: 0.05, shake: 0.3 });
  physics([M.RUBBLE], { shake: 0.25 });
  physics([M.GRAVEL], { shake: 0.08 });
  physics([M.GRASS, M.TOPSOIL, M.SOIL], { shake: 0.03 });
  physics([M.CLAY, M.FILL], { shake: 0.01 });
  physics([M.GLASS], { shake: 0.6 });
  // Movement.
  physics([M.SAND], { slide: 1, repose: [2, 3] });
  physics([M.ASH], { slide: 0.8, weight: 20, repose: [3, 4] });   // (light and fluffy: it floats on water)
  physics([M.LOOSE_SOIL], { slide: 0.6, settlesTo: M.SOIL, repose: [3, 4] });
  physics([M.LOOSE_STONE], { slide: 0.45, settlesTo: M.GRAVEL, repose: [5, 6] });
  physics([M.DEBRIS], { slide: 0.7, settlesTo: M.RUBBLE, repose: [3, 4] });
  physics([M.SMOKE], { buoyancy: 0.65, fade: 1 / 150 });
  physics([M.STEAM], { buoyancy: 0.8 });
  // (dust from blasts and collapses hangs in the air a long while, settling slowly)
  physics([M.DUST], { buoyancy: -0.12, fade: 1 / 900 });
  // What a cell weighs by its whole byte, variant and all: what floats and what sinks goes by this.
  // Wood is lighter than water - splinters of it are debris, but where brick and concrete rubble
  // sink, wood floats, as charcoal does; leaves are lighter still, and lie on the surface. (Against
  // water's 30: wood about 0.6 of it, a leaf a third; plants falling whole float by WOOD_WEIGHT.)
  const WOOD_WEIGHT = 18, LEAF_WEIGHT = 10;
  const byteWeight = new Uint8Array(256);
  for (let b = 0; b < 256; b += 1) byteWeight[b] = weight[b & ID_MASK];
  byteWeight[M.DEBRIS | DEBRIS_KIND.WOOD << 6] = WOOD_WEIGHT;
  // (floats[byte]: a loose grain lighter than water - it lies on the surface, a thin skin of
  // flotsam that the light and air of the surface still reach under)
  const floats = new Uint8Array(256);
  for (let b = 0; b < 256; b += 1) floats[b] = phase[b & ID_MASK] === PHASE.POWDER && byteWeight[b] < weight[M.WATER] ? 1 : 0;

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
      // A supply pipe crossing open space underground (a tunnel, a shaft, a cave), fixed to the
      // wall face: drawn over the bare wall, behind everything standing in front of it.
      pipe: new Array(chunkCount).fill(null),
      // Sparse per-cell data: owning building/infrastructure id, and FLAG bits.
      owner: new Array(chunkCount).fill(null),
      flags: new Array(chunkCount).fill(null),
      // Top-most natural ground cell per column; air above it is open sky.
      groundTop: new Int32Array(width).fill(height),
      chunkDirty: new Uint8Array(chunkCount),
      chunkVersion: new Uint32Array(chunkCount),
      // (the same, counting only changes that are not just air and gas trading places or thinning:
      // smoke and dust drifting through change nothing else in how a chunk is drawn)
      chunkHardVersion: new Uint32Array(chunkCount),
      // Changed cell rectangle per chunk since the last full-resolution redraw (local coords).
      dirtyRect: new Int16Array(chunkCount * 4).fill(-1),
      // Chunks where something opened up or closed off (daylight in caves and hollows round about
      // changes with it), listed once each until the renderer takes them.
      shapeFlag: new Uint8Array(chunkCount),
      shapeChanged: [],
      // Simulation: chunks with moving cells, and the cell rectangle that may still move.
      simActive: new Uint8Array(chunkCount),
      simRect: new Int32Array(chunkCount * 4),
      simIdle: new Uint16Array(chunkCount),
      activeList: [],
      // Temperature (see heatAt): sparse chunks, and the list of chunks holding heat.
      heat: new Array(chunkCount).fill(null),
      heatActive: new Uint8Array(chunkCount),
      heatList: [],
      heatBox: new Int16Array(chunkCount * 4),
      tick: 0,
    };
    for (let c = 0; c < chunkCount; c += 1) { clearSimRect(world, c); clearHeatBox(world, c); }
    return world;
  }
  function clearSimRect(world, c) {
    const r = world.simRect;
    r[c * 4] = CHUNK; r[c * 4 + 1] = CHUNK; r[c * 4 + 2] = -1; r[c * 4 + 3] = -1;
  }
  function chunkIndex(world, x, y) { return (y >> CHUNK_SHIFT) * world.chunksX + (x >> CHUNK_SHIFT); }
  function inside(world, x, y) { return x >= 0 && y >= 0 && x < world.width && y < world.height; }

  // (gasOnly: the change was air or gas becoming air or gas - see chunkHardVersion)
  function markDirty(world, x, y, bits = DIRTY_BASE, gasOnly = false) {
    const c = chunkIndex(world, x, y);
    world.chunkDirty[c] |= bits;
    world.chunkVersion[c] += 1;
    if (!gasOnly) world.chunkHardVersion[c] += 1;
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

  // Loose stuff at rest - rubble, earth, sand - holds where it lies, even in a straight-up stack,
  // until something stirs it: a shake, a gust, grains landing on it or moving about it. Where it was
  // stirred lately (by 16-cell tile, the tick until which it stays stirred) it slides and spreads to
  // its angle of repose; once all has been still there a while it holds again.
  const STIR_SHIFT = 4, STIR = 90;   // (ticks a stir lasts)
  function stir(world, x0, y0, x1, y1, ticks = STIR) {
    const tw = world.width >> STIR_SHIFT, th = world.height >> STIR_SHIFT;
    const stirred = world.stirred || (world.stirred = new Uint32Array(tw * th));
    const until = (world.tick || 0) + ticks;
    const tx0 = Math.max(0, x0 >> STIR_SHIFT), tx1 = Math.min(tw - 1, x1 >> STIR_SHIFT);
    const ty0 = Math.max(0, y0 >> STIR_SHIFT), ty1 = Math.min(th - 1, y1 >> STIR_SHIFT);
    let any = false;
    for (let ty = ty0; ty <= ty1; ty += 1) for (let tx = tx0; tx <= tx1; tx += 1) {
      const k = ty * tw + tx;
      if (stirred[k] < until) { if (stirred[k] < (world.tick || 0)) any = true; stirred[k] = until; }
    }
    // (what lay still there is looked at again)
    if (any) wakeArea(world, tx0 << STIR_SHIFT, ty0 << STIR_SHIFT, ((tx1 + 1) << STIR_SHIFT) - 1, ((ty1 + 1) << STIR_SHIFT) - 1);
  }
  function stirred(world, x, y) {
    const s = world.stirred;
    return !!s && s[(y >> STIR_SHIFT) * (world.width >> STIR_SHIFT) + (x >> STIR_SHIFT)] >= (world.tick || 0);
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
    if (world.groundTop[x] !== top) groundTopMoved(world, x, top, world.groundTop[x]);
  }
  // The ground line of column x moved from a to b: open air between went from sky to underground
  // (drawn dark, as a cave) or back, so it is drawn again.
  function groundTopMoved(world, x, a, b) {
    let y0 = Math.min(a, b);
    const y1 = Math.min(world.height - 1, Math.max(a, b));
    while (y0 <= y1) {
      const end = Math.min(y1, y0 | CHUNK_MASK);
      markDirty(world, x, y0); markDirty(world, x, end);
      y0 = end + 1;
    }
  }
  // (cell (x, y) opened up or closed off)
  function shapeChanged(world, x, y) {
    const c = chunkIndex(world, x, y);
    if (!world.shapeFlag[c]) { world.shapeFlag[c] = 1; world.shapeChanged.push(c); }
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
    if (passesLight[before] !== passesLight[after]) shapeChanged(world, x, y);
    if (!options || !options.keepPaint) clearPaintAt(world, x, y);
    if (before === M.WATER || after === M.WATER) markWaterDirty(world, x, y);
    else markDirty(world, x, y, DIRTY_BASE, phase[before] <= PHASE.GAS && phase[after] <= PHASE.GAS);
    if (!options || !options.quiet) wake(world, x, y);
    else if (before !== after && phase[after] >= PHASE.GAS && phase[after] <= PHASE.POWDER) wake(world, x, y);
  }
  // Sink column x by one cell between rows yTop and yBottom: everything in rows yTop..yBottom-1
  // moves down a row - its material, colours, back wall, pipe, owner, fittings and flags - into
  // yBottom (the hollow it sinks into, or ground pressed out from under it), and yTop opens. A
  // plant's cells stay where they are (plants are moved whole: see the sag in pw-stability).
  const SINKS = ['paint', 'back', 'pipe', 'owner'];
  function copyCell(layer, c, l, c2, l2, wide) {
    const from = layer[c2], v = from ? from[l2] : 0;
    let to = layer[c];
    if (!to) { if (!v) return; to = layer[c] = wide ? new Uint32Array(CHUNK_CELLS) : new Uint16Array(CHUNK_CELLS); }
    to[l] = v;
  }
  function sinkColumn(world, x, yTop, yBottom) {
    if (yBottom <= yTop) return;
    const { mat, width: W } = world;
    const PLANT = FLAG.FLORA | FLAG.WOOD | FLAG.CHARRED;
    const at = (y) => [chunkIndex(world, x, y), (y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK];
    const plantAt = (c, l) => world.flags[c] && (world.flags[c][l] & PLANT);
    for (let y = yBottom; y > yTop; y -= 1) {
      const [c, l] = at(y), [c2, l2] = at(y - 1);
      mat[y * W + x] = mat[(y - 1) * W + x];
      for (const name of SINKS) copyCell(world[name], c, l, c2, l2, name !== 'owner');
      if (!plantAt(c, l) && !plantAt(c2, l2)) { copyCell(world.deco, c, l, c2, l2, true); copyCell(world.flags, c, l, c2, l2, true); }
    }
    const [c, l] = at(yTop);
    mat[yTop * W + x] = M.AIR;
    for (const name of SINKS) if (world[name][c]) world[name][c][l] = 0;
    if (!plantAt(c, l)) { if (world.deco[c]) world.deco[c][l] = 0; if (world.flags[c]) world.flags[c][l] = 0; }
    const top = world.groundTop[x];
    if (top >= yTop && top <= yBottom) { refreshGroundTop(world, x, top); if (world.groundTop[x] !== top) groundTopMoved(world, x, top, world.groundTop[x]); }
    for (let y0 = yTop; y0 <= yBottom;) {
      const end = Math.min(yBottom, y0 | CHUNK_MASK);
      markDirty(world, x, y0, DIRTY_BASE | DIRTY_DECO); markDirty(world, x, end, DIRTY_BASE | DIRTY_DECO);
      y0 = end + 1;
    }
    shapeChanged(world, x, yTop); shapeChanged(world, x, yBottom);
    wake(world, x, yTop); wake(world, x, yBottom);
  }
  // Swap two cells by flat index (the cell automaton's move). Paint stays put: moving cells
  // (water, powders, gases) are coloured from their material palette. Temperature moves with the
  // material, so hot steam carries its heat as it rises.
  function swapCells(world, i, j) {
    const mat = world.mat, W = world.width;
    const a = mat[i], b = mat[j];
    mat[i] = b; mat[j] = a;
    const xi = i % W, yi = (i / W) | 0, xj = j % W, yj = (j / W) | 0;
    const ai = a & ID_MASK, bi = b & ID_MASK;
    touchGroundTop(world, xi, yi, bi);
    touchGroundTop(world, xj, yj, ai);
    if (passesLight[ai] !== passesLight[bi]) { shapeChanged(world, xi, yi); shapeChanged(world, xj, yj); }
    if (ai === M.WATER || bi === M.WATER) { markWaterDirty(world, xi, yi); markWaterDirty(world, xj, yj); }
    else { const gas = phase[ai] <= PHASE.GAS && phase[bi] <= PHASE.GAS; markDirty(world, xi, yi, DIRTY_BASE, gas); markDirty(world, xj, yj, DIRTY_BASE, gas); }
    // (rubble carries its colours with it as it slides and falls)
    if (phase[ai] === PHASE.POWDER || phase[bi] === PHASE.POWDER) {
      const pi = getLayer(world, 'paint', xi, yi), pj = getLayer(world, 'paint', xj, yj);
      if (pi !== pj) { setLayer(world, 'paint', xi, yi, pj); setLayer(world, 'paint', xj, yj, pi); }
    }
    const ci = chunkIndex(world, xi, yi), cj = chunkIndex(world, xj, yj);
    if (world.heat[ci] || world.heat[cj]) {
      const ta = heatAt(world, xi, yi), tb = heatAt(world, xj, yj);
      if (ta !== tb) { setHeat(world, xi, yi, tb); setHeat(world, xj, yj, ta); }
    }
  }

  // ---- Temperature ------------------------------------------------------------------------------------
  // Sparse per-chunk Float32 temperatures (°C). Chunks without an array are at ambient. Chunks that
  // hold heat are listed in heatList for the heat module to diffuse, cool and drop when cold.
  const AMBIENT = 20;
  // Heat is a property of every pixel and tints it: hot enough, a pixel glows into the heat's
  // colour - a dull red from about GLOW_FROM, through cherry, orange and yellow to white-hot at
  // GLOW_FULL - the more the hotter, its own grain showing through until it is white-hot, and as
  // it cools it goes back to its own colour. (A cell of the grid - see pw-heat's glow - or a
  // flying pixel - see pw-particles.) glowAt(t): the tint at t °C, its strength in the alpha
  // byte; 0 below GLOW_FROM. glowing(c, t): colour c tinted so.
  const GLOW_FROM = 480, GLOW_FULL = 1400;
  // ([°C, r, g, b, strength]: how hot iron and rock look - after the colours smiths go by)
  const GLOW_STOPS = [[480, 110, 14, 0, 0], [560, 150, 24, 0, 0.22], [700, 205, 42, 6, 0.5], [850, 245, 96, 16, 0.7], [1000, 255, 160, 52, 0.82],
    [1200, 255, 222, 140, 0.9], [1400, 255, 248, 228, 0.95]];
  const GLOW_LUT = new Uint32Array(256);
  for (let k = 0; k < 256; k += 1) {
    const t = GLOW_FROM + (GLOW_FULL - GLOW_FROM) * k / 255;
    let s = 1;
    while (s < GLOW_STOPS.length - 1 && GLOW_STOPS[s][0] < t) s += 1;
    const [t0, r0, g0, b0, a0] = GLOW_STOPS[s - 1], [t1, r1, g1, b1, a1] = GLOW_STOPS[s], f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    const mixc = (u, v) => Math.round(u + (v - u) * f);
    GLOW_LUT[k] = (mixc(a0 * 255, a1 * 255) << 24 | mixc(b0, b1) << 16 | mixc(g0, g1) << 8 | mixc(r0, r1)) >>> 0;
  }
  const GLOW_SCALE = 255 / (GLOW_FULL - GLOW_FROM);
  const glowAt = (t) => (t > GLOW_FROM ? GLOW_LUT[Math.min(255, ((t - GLOW_FROM) * GLOW_SCALE) | 0)] : 0);
  function glowing(c, t) {
    const g = glowAt(t), a = (g >>> 24) / 255;
    if (!a) return c;
    const r = (c & 255) + ((g & 255) - (c & 255)) * a, gg = (c >>> 8 & 255) + ((g >>> 8 & 255) - (c >>> 8 & 255)) * a, b = (c >>> 16 & 255) + ((g >>> 16 & 255) - (c >>> 16 & 255)) * a;
    return ((c >>> 24) << 24 | Math.round(b) << 16 | Math.round(gg) << 8 | Math.round(r)) >>> 0;
  }
  function heatAt(world, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return AMBIENT;
    const chunk = world.heat[chunkIndex(world, x, y)];
    return chunk ? chunk[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] : AMBIENT;
  }
  function heatChunk(world, c) {
    let chunk = world.heat[c];
    if (!chunk) { chunk = world.heat[c] = new Float32Array(CHUNK_CELLS).fill(AMBIENT); }
    if (!world.heatActive[c]) { world.heatActive[c] = 1; world.heatList.push(c); }
    return chunk;
  }
  // (heatBox: for each chunk, the bounds of the cells set since the heat module last worked it -
  // so it works them wherever they are, and works only them in a chunk that has just warmed)
  function clearHeatBox(world, c) { const B = world.heatBox, k = c << 2; B[k] = CHUNK; B[k + 1] = CHUNK; B[k + 2] = -1; B[k + 3] = -1; }
  function setHeat(world, x, y, t) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
    const c = chunkIndex(world, x, y);
    if (!world.heat[c] && Math.abs(t - AMBIENT) < 0.5) return;
    const lx = x & CHUNK_MASK, ly = y & CHUNK_MASK, B = world.heatBox, k = c << 2;
    heatChunk(world, c)[ly << CHUNK_SHIFT | lx] = t;
    if (lx < B[k]) B[k] = lx;
    if (ly < B[k + 1]) B[k + 1] = ly;
    if (lx > B[k + 2]) B[k + 2] = lx;
    if (ly > B[k + 3]) B[k + 3] = ly;
  }
  function addHeat(world, x, y, dt) { setHeat(world, x, y, heatAt(world, x, y) + dt); }
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
    RAW: 256, FIXTURE: 512, DEVELOPED: 1024, OVERBREAK: 2048,
    // FLORA: a deco cell that is part of a plant (it can burn); CHARRED: burnt, no fuel left.
    // FIELD: tilled farm ground (a surface like ROAD, never on the same cell as one); it yields SM.
    FLORA: 4096, CHARRED: 8192, FIELD: 16384,
    // FITTING: this back-wall cell is something standing in front of the wall face (a timber set,
    // a lamp and its cable): a pipe along the wall passes behind it.
    FITTING: 32768,
    // WOOD: this plant cell is wood (trunk, bough, twig), whatever colour it shows - leaves grow in
    // front of the branches they are on, but the wood is still there behind them.
    WOOD: 65536,
    // PANEL: this back-wall cell is a panel of wall a ruin came down with: it stands only while
    // solid holds it (see pw-stability).
    PANEL: 131072,
    // HOLLOW: this cell is the inside of a supply line's bore (N17F) - carved to open air, with
    // the lane's colour behind it (PW.PIPE_CAVITY, N38). The line's own bookkeeping, set and cleared
    // with the bore by pw-pipes (its take-up and repair): the physics sees only the open cells.
    HOLLOW: 262144 });
  // Does a pipe fixed to the wall show at open cell (x, y)? Over the wall face (a finished
  // tunnel's too, clamped to it), or across a cave's rock; not behind a fitting, a ladder's rails
  // and rungs, a rail or a belt - but between a ladder's rungs, yes.
  const HIDES_PIPE = FLAG.FITTING | FLAG.FIXTURE;
  function pipeShows(world, x, y) {
    return getLayer(world, 'pipe', x, y) !== 0 && !(getLayer(world, 'back', x, y) && (getFlags(world, x, y) & HIDES_PIPE))
      && !getLayer(world, 'deco', x, y);
  }
  function getOwner(world, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 0;
    const chunk = world.owner[chunkIndex(world, x, y)];
    return chunk ? chunk[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] : 0;
  }
  // A building is being built (b.growing, set by whatever builds or repairs it) while the work
  // touched it within GROW_HOLD ticks (b.grewAt: see pw-structure) - the work pauses between
  // batches. (pw-structure makes it a construction site, judged by what stands.)
  const GROW_HOLD = 120;
  const isGrowing = (world, b) => !!b && (!!b.growing || (world.tick || 0) - (b.grewAt ?? -1e9) <= GROW_HOLD);
  // Is the cell (x, y) part of a building going up - being built and still far from whole
  // (under GROW_SHIELD of it standing: a ruin rising again, a seed growing, not a whole building
  // having a wound patched)? Such a building shrugs off light blows (see pw-particles' chip and
  // pw-fragments): only something heavy breaks into it.
  const GROW_SHIELD = 0.9;
  function growing(world, x, y) {
    const owner = getOwner(world, x, y);
    if (owner <= 0 || owner >= 50000 || !world.buildings) return false;
    const b = world.buildings[owner - 1];
    return isGrowing(world, b) && (b.health ?? 1) < GROW_SHIELD;
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
    if (!chunk) { if (!on) return; chunk = world.flags[c] = new Uint32Array(CHUNK_CELLS); }
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
  PW.mat = { phase, structural, ground, skyline, hardness, breaksTo, passable, stopsShots, terrain, open,
    conduct, ignite, burnTime, burnsTo, palettes, names, weight, blastResist, cohesion, advection, shake,
    slide, reposeRise, reposeRun, settlesTo, buoyancy, fade, passesLight, byteWeight, floats, WOOD_WEIGHT, LEAF_WEIGHT };
  PW.CHUNK = CHUNK;
  PW.CHUNK_SHIFT = CHUNK_SHIFT;
  // The simulation keeps to a few milliseconds a tick (the powder sim, the structure checks, the
  // plants settling): on a slow or busy machine it runs behind, a chunk or a building put off to
  // the next tick, rather than dropping frames - so the same world played twice can come out a
  // little differently. DETERMINISTIC (?det=1, or set by a test) drops those time limits: every
  // tick does all its work, and a world comes out the same on any machine.
  PW.DETERMINISTIC = typeof location !== 'undefined' && /[?&]det=1(&|$)/.test(location.search);
  PW.CHUNK_MASK = CHUNK_MASK;
  PW.CHUNK_CELLS = CHUNK_CELLS;
  PW.WATER_REACH = WATER_REACH;
  PW.DIRTY_BASE = DIRTY_BASE;
  PW.DIRTY_DECO = DIRTY_DECO;
  PW.FLAG = FLAG;
  PW.pipeShows = pipeShows;
  PW.HIDES_PIPE = HIDES_PIPE;
  Object.assign(PW, {
    abgr, unpack, hash2, hash3, createRandom, createNoise1D, createNoise2D,
    createWorld, chunkIndex, inside, markDirty, markWaterDirty, wake, wakeCell, wakeArea, clearSimRect, stir, stirred,
    get, id, set, swapCells, sinkColumn, touchGroundTop, refreshGroundTop, rebuildGroundTop, shapeChanged,
    getLayer, setLayer, layerCell, clearPaintAt, isSolid, isOpen, groundBelow, supportBelow, traceShot,
    getOwner, setOwner, growing, isGrowing, getFlags, setFlag, AMBIENT, heatAt, setHeat, addHeat, heatChunk, clearHeatBox,
    GLOW_FROM, GLOW_FULL, glowAt, glowing,
  });
})();
