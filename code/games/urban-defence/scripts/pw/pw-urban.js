'use strict';
// Made ground: under a town's streets, runway and buildings the natural ground is replaced, from
// below the paving down to the bed of its supply lines, by the ground a town is built on. The
// lines are the divider: above them urban ground, below them the land as it was. Each faction
// builds its own:
//   modern - a concrete road slab, a crushed-aggregate base, compacted fill and a concrete duct
//            bank carrying power and data cables.
//   asian  - as under the Forbidden City's courtyards (laid so deep that nobody could tunnel in):
//            white stone slabs on a lime-sand bed, courses of grey city brick, sticky-rice lime
//            mortar, then rammed-earth lifts of uneven thickness, each with its tamped crust,
//            broken brick-and-tile layers between them, a foundation of long granite blocks,
//            cypress piles, and older lime-clay-sand earth further down.
//   gothic - a granite base under the setts, then old red-brick courses and clinker rubble, as
//            under a London square.
// Where a town ends (and where a farm's field begins) the made ground is not cut off: its layers
// are cut back along a wandering face that leans in with depth, and past it every layer carries on
// into the natural ground on its own, thinning and breaking up into lumps until only scattered
// pieces are left, the way strata pinch out in a geological section. Beyond the town the layers
// stay level with its street, under the land's own topsoil. The supply lines stay the clean
// divider below; where no line runs the bottom frays out downwards too. Under a stage on stilts
// the slope keeps its topsoil and the made ground starts below it.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;
  const rgb = (c) => PW.abgr(c[0] | 0, c[1] | 0, c[2] | 0);

  const FULL = 96;        // depth of made ground where no supply line runs (the water main's bed)
  const PAVED = 4;        // street paving rows (asphalt and road bed) stay as they are
  const KEEP_SOIL = 6;    // an unpaved column (under a stage) keeps this much of its topsoil
  const SCATTER = 150;    // the furthest a cut-off layer frays out into the natural ground
  const SINK = 40;        // how far the bottom frays down where no line runs
  const DRAPE = 9;        // fraying layers bend up to this many rows, like the strata around them
  // The cut-off face: CUT cells in from the town's end at the top, LEAN cells further in per row
  // down, wandering up to WANDER cells either way.
  const CUT = 4, LEAN = 0.35, WANDER = 6;
  const faceAt = (d) => CUT + d * LEAN + WANDER;   // past this distance from an end the ground is whole
  const natural = new Uint8Array(64);
  for (const id of [M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.SAND, M.LOOSE_SOIL, M.LOOSE_STONE]) natural[id] = 1;

  // The asian sequence, row by row from the street down (the same under every column, so its
  // layers run on unbroken): which kind of layer, the row within it, and which layer it is.
  const A = { SLAB: 1, BED: 2, BRICK: 3, MORTAR: 4, RICE: 5, EARTH: 6, SHARDS: 7, GRANITE: 8, TRIAD: 9 };
  const ASIAN = (() => {
    const N = 1600, kind = new Uint8Array(N), row = new Uint8Array(N), unit = new Int16Array(N), rows = new Uint8Array(N);
    let d = 0, u = 0;
    const put = (k, n) => { for (let r = 0; r < n && d < N; r += 1, d += 1) { kind[d] = k; row[d] = r; unit[d] = u; rows[d] = n; } u += 1; };
    put(A.SLAB, 8);                                      // (the paving rows, then the stone slabs)
    put(A.BED, 3);
    for (let c = 0; c < 4; c += 1) { put(A.BRICK, 2); put(A.MORTAR, 1); }
    put(A.RICE, 3);
    const random = PW.createRandom(0xa51a7);
    let lifts = 0, granite = 0, deepBrick = false;
    while (d < N) {
      // (the granite footing sits high enough for its piles to stand clear above the lines)
      if (!granite && d >= 30) { put(A.GRANITE, 3); put(A.GRANITE, 3); granite = d; continue; }
      if (!deepBrick && d >= 84) { for (let c = 0; c < 3; c += 1) { put(A.BRICK, 2); put(A.MORTAR, 1); } deepBrick = true; continue; }
      put(d >= 124 && lifts % 2 ? A.TRIAD : A.EARTH, random.int(4, 7));
      lifts += 1;
      if (lifts % 3 === 0) put(A.SHARDS, random.int(2, 3));
    }
    return { kind, row, unit, rows, piles: granite };
  })();
  function asianLayer(x, d, h, speck) {
    const kind = ASIAN.kind[d], row = ASIAN.row[d], unit = ASIAN.unit[d];
    const age = 1 - Math.min(0.2, d / 600);
    const aged = (c) => [c[0] * age, c[1] * age, c[2] * age];
    // Cypress piles under the granite, every 52 columns, tapering to a point.
    const p0 = ASIAN.piles;
    if (d >= p0 && d < p0 + 62) {
      const p = x % 52, w = d < p0 + 56 ? 3 : d < p0 + 60 ? 2 : 1;
      if (p < w) return { id: M.COURSE, color: aged((d - p0) % 9 === 8 ? [92, 54, 34] : p === 0 ? [138, 84, 52] : p === 1 ? [122, 72, 46] : [100, 58, 38]) };
    }
    switch (kind) {
      case A.SLAB: {
        // White stone slabs (long blocks, dark joints), lit along the top.
        const joint = (x + (unit & 1) * 7) % 14 === 0;
        const c = joint ? [112, 114, 112] : row <= 4 ? [196, 198, 194] : row === 7 ? [150, 152, 148] : speck([178, 180, 176], [190, 192, 188], [164, 166, 162]);
        return { id: M.SLAB, color: c };
      }
      case A.BED: return { id: M.FILL, color: aged(speck([200, 190, 160], [214, 204, 176], [184, 172, 142])) };
      case A.BRICK: {
        // Grey city brick, each brick its own tone, head joints staggered course by course.
        const along = x + (unit % 4) * 4, brick = Math.floor(along / 9);
        if (along % 9 === 0) return { id: M.COURSE, color: aged([168, 162, 148]) };
        const k = 0.92 + (PW.hash2(brick, unit) & 15) / 100;
        const c = row === 0 ? [114, 120, 126] : [100, 106, 112];
        return { id: M.COURSE, color: aged([c[0] * k, c[1] * k, c[2] * k]) };
      }
      case A.MORTAR: return { id: M.COURSE, color: aged(speck([168, 162, 148], [180, 174, 160], [150, 144, 132])) };
      case A.RICE: return { id: M.FILL, color: aged(speck([214, 206, 184], [222, 216, 196], [200, 192, 170])) };
      case A.GRANITE: {
        // Long granite foundation blocks, two courses, speckled.
        const along = x + (unit & 1) * 11;
        if (along % 22 === 0 || row === 2) return { id: M.SLAB, color: aged([96, 94, 90]) };
        return { id: M.SLAB, color: aged((h & 15) < 2 ? [92, 90, 88] : (h & 15) < 4 ? [190, 186, 180] : row === 0 ? [160, 156, 150] : [146, 142, 136]) };
      }
      case A.SHARDS: {
        // Broken grey brick and red tile set in lime, in pieces two or three cells long.
        const piece = PW.hash2(Math.floor((x + row * 2) / 3), unit * 7 + row) & 7;
        return { id: M.FILL, color: aged(piece < 3 ? [108, 114, 120] : piece < 5 ? [148, 84, 60] : piece < 7 ? [196, 188, 164] : [130, 120, 100]) };
      }
      case A.TRIAD:
        return { id: M.FILL, color: aged(row === 0 ? [138, 128, 108] : speck([162, 152, 130], [196, 190, 172], [140, 130, 110])) };
      default: {
        // Rammed loess earth: each lift's top is its tamped crust (with the rammer's dimples),
        // and the earth is flecked with lime nodules.
        if (row === 0) return { id: M.FILL, color: aged(x % 6 === 0 ? [126, 106, 76] : [148, 126, 90]) };
        if ((h & 63) === 0) return { id: M.FILL, color: aged([222, 214, 190]) };
        const tint = (unit & 1) ? [182, 158, 112] : [170, 148, 104];
        return { id: M.FILL, color: aged(speck(tint, [tint[0] + 12, tint[1] + 12, tint[2] + 10], [tint[0] - 14, tint[1] - 14, tint[2] - 12])) };
      }
    }
  }

  // Material and colour of made ground `d` cells below the street surface at column x.
  function layer(style, x, d) {
    const h = PW.hash2(x, d * 17 + 3);
    const speck = (base, lit, dark) => ((h & 7) === 0 ? lit : (h & 7) === 1 ? dark : base);
    if (style === 'modern') {
      if (d < 8) return { id: M.SLAB, color: x % 24 === 0 ? [96, 96, 92] : d === 4 ? [162, 162, 154] : speck([150, 150, 144], [158, 158, 150], [138, 138, 132]) };
      if (d < 13) return { id: M.FILL, color: speck([122, 116, 106], [148, 142, 130], [92, 88, 82]) };
      if (d >= 15 && d < 20) {
        // Duct bank: concrete round two cables (a black power cable, a braided data cable).
        if (d === 17) return { id: M.SLAB, color: x % 36 === 0 ? [180, 60, 40] : [26, 26, 28] };
        if (d === 18) return { id: M.SLAB, color: x % 2 ? [176, 120, 70] : [96, 62, 36] };
        return { id: M.SLAB, color: d === 15 ? [146, 146, 140] : [134, 134, 128] };
      }
      // A buried basement slab, then engineered fill pierced by concrete piles.
      if (d >= 34 && d < 38) return { id: M.SLAB, color: x % 40 === 0 ? [100, 100, 96] : d === 34 ? [154, 154, 146] : [140, 140, 134] };
      if (d >= 38 && d < 60 && x % 64 < 3) return { id: M.SLAB, color: x % 64 === 0 ? [158, 158, 150] : x % 64 === 2 ? [120, 120, 114] : [142, 142, 136] };
      if (d >= 38) return { id: M.FILL, color: speck([98, 92, 82], [114, 108, 96], [84, 78, 70]) };
      return { id: M.FILL, color: speck([108, 98, 84], [124, 114, 98], [90, 82, 70]) };
    }
    if (style === 'asian') return asianLayer(x, Math.min(d, ASIAN.kind.length - 1), h, speck);
    // Gothic: granite under the setts, brick courses and clinker, then centuries of rubble with
    // ash lenses and broken brick.
    if (d < 7) return { id: M.SLAB, color: speck([134, 124, 126], [152, 142, 144], [110, 102, 104]) };
    if (d < 43) {
      const cycle = (d - 7) % 6, course = Math.floor((d - 7) / 6);
      if (cycle < 2) {
        const joint = (x + (course & 1) * 4 + cycle * 9) % 9 === 0;
        return { id: M.COURSE, color: joint ? [104, 96, 88] : speck([128, 72, 54], [146, 86, 64], [108, 60, 46]) };
      }
      if (cycle === 2) return { id: M.COURSE, color: [104, 96, 88] };
      return { id: M.FILL, color: (h & 15) === 0 ? [140, 82, 62] : speck([88, 80, 76], [104, 96, 90], [72, 66, 62]) };
    }
    if ((PW.hash2(x >> 4, d >> 2) & 7) === 0) return { id: M.FILL, color: speck([70, 68, 66], [84, 82, 78], [58, 56, 54]) };   // ash lens
    return { id: M.FILL, color: (h & 15) < 2 ? [132, 78, 58] : speck([82, 74, 68], [96, 88, 80], [68, 62, 58]) };
  }

  // A style's made ground in bands: runs of rows of one material (at most 12 rows; for the asian
  // ground its own layers), each of which frays out on its own. Per depth: the band's number,
  // first and last row.
  const bandCache = {};
  function bandsOf(style) {
    if (bandCache[style]) return bandCache[style];
    const N = 1600, index = new Int16Array(N), top = new Int16Array(N), bottom = new Int16Array(N);
    // (sampled at a column clear of the piles and joints)
    const key = (d) => (style === 'asian' ? ASIAN.unit[d] : layer(style, 10, d).id);
    let start = 0, band = 0, prev = key(0);
    for (let d = 1; d <= N; d += 1) {
      const id = d < N ? key(d) : -1;
      if (id === prev && d - start < 12) continue;
      for (let r = start; r < d; r += 1) { index[r] = band; top[r] = start; bottom[r] = d - 1; }
      band += 1; start = d; prev = id;
    }
    return (bandCache[style] = { index, top, bottom, N });
  }

  function lay(world) {
    const { mat, width: W } = world;
    const pipes = world.pipes;
    // The bottom of the made ground at x: the bed under the deepest supply line there.
    const bed = pipes ? pipes.BED : 2, bore = pipes ? pipes.BORE : 7;
    // A fraying band swells and thins along its length, breaks into lenses, and leaves a few thin
    // stray lenses past its reach: all smooth along the band, never speckled.
    const swell = PW.createNoise1D(0x51ca77, 23), breaks = PW.createNoise1D(0x7e1a5, 16), strays = PW.createNoise1D(0x3391f, 11);
    const wander = PW.createNoise1D(0x2be117, 19);     // the cut-off face and the bottom wander
    const drape = PW.createNoise1D(0x4d2a9, 130);      // and the frayed layers bend with the land
    // The land under whatever stands on it (a building's floors and footings are passed down to
    // the ground they stand on).
    const { terrain, ground } = PW.mat;
    const landAt = (x) => {
      let g = world.groundTop[x];
      for (let n = 0; n < 400 && g < world.height - 1; n += 1, g += 1) {
        const id = mat[g * W + x] & ID_MASK, o = PW.getOwner(world, x, g);
        if (ground[id] && (terrain[id] || !(o > 0 && o < 50000))) break;
      }
      return g;
    };
    // The natural ground's own colour (as the renderer tones it with depth), for far-out pieces to
    // weather towards.
    const surface0 = world.surface0 || world.groundTop, palettes = PW.mat.palettes;
    const soilTone = (x, y, m) => {
      const c = PW.unpack(palettes[m & ID_MASK][(m >> 6) * 2]), k = 1 - Math.min(0.28, Math.max(0, y - surface0[x]) / 1260);
      return [c[0] * k, c[1] * k, c[2] * k];
    };
    const report = [], loose = [];
    for (const settlement of world.settlements || []) {
      const spans = [[settlement.streetLeft, settlement.streetRight]];
      if (settlement.runway) spans.push([Math.min(settlement.runway.from, settlement.runway.to), Math.max(settlement.runway.from, settlement.runway.to)]);
      // (farmland is no town ground: a farm's lot and fields keep their natural soil)
      const fields = settlement.buildings.flatMap((b) => [b.field, b.lotField]).filter(Boolean).map((f) => [f.x0, f.x1]);
      const t0 = Math.min(...spans.map((s) => s[0])), t1 = Math.max(...spans.map((s) => s[1]));
      const margin = Math.ceil(SCATTER * 1.6) + CUT;
      const x0 = Math.max(1, t0 - margin), x1 = Math.min(W - 2, t1 + margin), n = x1 - x0 + 1;
      const inTown = new Uint8Array(n);
      for (const [a, b] of spans) for (let x = Math.max(a, x0); x <= Math.min(b, x1); x += 1) inTown[x - x0] = 1;
      for (const [a, b] of fields) for (let x = Math.max(a, x0); x <= Math.min(b, x1); x += 1) inTown[x - x0] = 0;
      // Signed distance from the town's edge (inside > 0, outside <= 0) and the end column it is
      // measured from (the end's street level and its own fraying pattern).
      const lastIn = new Int32Array(n), lastOut = new Int32Array(n), nextIn = new Int32Array(n), nextOut = new Int32Array(n);
      for (let k = 0, i = -1e6, o = -1e6; k < n; k += 1) { if (inTown[k]) i = k; else o = k; lastIn[k] = i; lastOut[k] = o; }
      for (let k = n - 1, i = 1e6, o = 1e6; k >= 0; k -= 1) { if (inTown[k]) i = k; else o = k; nextIn[k] = i; nextOut[k] = o; }
      const ends = [];
      for (let k = 1; k < n; k += 1) if (inTown[k] !== inTown[k - 1]) ends.push(x0 + (inTown[k] ? k : k - 1));
      const lines = pipes ? pipes.lines.filter((l) => l.settlement === settlement) : [];
      const { index: bandIndex, top: bandTop, bottom: bandBottom, N: DEEPEST } = bandsOf(settlement.style);
      // One smooth level for the whole town to measure its layers from, so they run on unbroken
      // past steps, plinths and terraces: the highest land within LEVEL columns, averaged over
      // the same reach (never below any column's own land, so no column starts above its layers).
      const land = new Int32Array(n);
      for (let k = 0; k < n; k += 1) land[k] = landAt(x0 + k);
      const LEVEL = 48, peak = new Float64Array(n), level = new Int32Array(n);
      {
        // (sliding minimum over the town's columns, then a windowed mean by prefix sums)
        const value = (j) => (inTown[j] ? land[j] : Infinity);
        const queue = new Int32Array(n);
        let head = 0, tail = 0, next = 0;
        for (let k = 0; k < n; k += 1) {
          for (; next <= Math.min(n - 1, k + LEVEL); next += 1) {
            while (tail > head && value(queue[tail - 1]) >= value(next)) tail -= 1;
            queue[tail++] = next;
          }
          while (queue[head] < k - LEVEL) head += 1;
          peak[k] = value(queue[head]);
        }
        const sum = new Float64Array(n + 1), count = new Int32Array(n + 1);
        for (let k = 0; k < n; k += 1) { sum[k + 1] = sum[k] + (inTown[k] ? peak[k] : 0); count[k + 1] = count[k] + inTown[k]; }
        for (let k = 0; k < n; k += 1) {
          if (!inTown[k]) continue;
          const a = Math.max(0, k - LEVEL), b = Math.min(n - 1, k + LEVEL);
          level[k] = Math.floor((sum[b + 1] - sum[a]) / (count[b + 1] - count[a]));
        }
      }
      let cells = 0, frayed = 0;
      for (let k = 0; k < n; k += 1) {
        const x = x0 + k;
        let e, end;
        if (inTown[k]) {
          const l = k - lastOut[k], r = nextOut[k] - k;
          e = Math.min(l, r); end = l <= r ? lastOut[k] + 1 : nextOut[k] - 1;
        } else {
          const l = k - lastIn[k], r = nextIn[k] - k;
          e = 1 - Math.min(l, r); end = l <= r ? lastIn[k] : nextIn[k];
        }
        if (CUT - e > SCATTER * 1.6) continue;
        const ex = x0 + end, own = land[k];
        // Layers are measured from the town's level: inside the town from its own column's,
        // beyond it from its end's, so they run on level under the land there.
        const s = level[e > 0 ? k : end];
        if ((mat[own * W + x] & ID_MASK) === M.WATER || (e <= 0 && (mat[land[end] * W + ex] & ID_MASK) === M.WATER)) continue;
        const top = mat[own * W + x] & ID_MASK;
        const covered = own > world.groundTop[x];     // something stands on the land here
        const paved = e > 0 && ((PW.getFlags(world, x, own) & FLAG.ROAD) || top === M.ASPHALT || top === M.ROADBED || top === M.FOUNDATION);
        // The town's ground keeps its full depth (the cross-section refs): the bundle runs
        // through its upper metre, and the made ground never ends above the bundle's bed.
        let lineBed = -1;
        for (const line of lines) if (x >= line.x0 && x <= line.x1) lineBed = Math.max(lineBed, line.ys[x - line.x0] + bore - 1 + bed);
        const soft = s + FULL + Math.round(wander(x + 4001) * 8);
        const start = covered ? own : e > 0 ? own + (paved ? PAVED : KEEP_SOIL) : Math.max(s + PAVED, own + KEEP_SOIL);
        const last = Math.max(lineBed, soft + SINK);
        // Past the face the layers bend with the land, more the further out they reach.
        const bend = Math.round(Math.min(1, Math.max(0, CUT - e) / SCATTER) * DRAPE * drape(x + ex * 0.5));
        for (let y = start; y <= last; y += 1) {
          if (y - s < 0) continue;
          const m = mat[y * W + x], id = m & ID_MASK;
          if (!natural[id] || PW.getOwner(world, x, y) || (PW.getFlags(world, x, y) & FLAG.TUNNEL)) continue;
          // How far past the whole made ground this cell lies: across the cut-off face (along its
          // own band, which runs out at its own reach) and below a line-less bottom.
          const d = Math.max(0, y - s - bend);
          if (d >= DEEPEST) continue;
          const b = bandIndex[d];
          const across = (CUT + d * LEAN + wander(d * 2.5 + ex * 0.37) * WANDER - e) /
            (SCATTER * (0.35 + 0.65 * (PW.hash3(b, ex, 41) & 255) / 255));
          const below = (y - soft) / SINK;
          const t = Math.max(across, below);
          let fade = 0;
          if (t > 0) {
            if (t >= 1.4) continue;
            // Past the face a band pinches out like a lens: it thins towards its reach (edge rows
            // first, its edges swelling and narrowing along it) and parts into separate lenses
            // with rounded ends, more and shorter the further out; past its reach a few thin
            // stray lenses are left.
            const half = (bandBottom[d] - bandTop[d] + 1) / 2, mid = (bandTop[d] + bandBottom[d] + 1) / 2;
            const off = Math.abs(d + 0.5 - mid) / half;
            const thick = t < 1 ? Math.pow(1 - t, 0.7) * (1 + 0.3 * swell(x + b * 397) * Math.min(1, t * 3)) : 0;
            const whole = off < thick && breaks(x + b * 613) - 0.6 * off > -1 + 1.7 * Math.pow(t, 1.2);
            const stray = !whole && t > 0.5 && off < 0.45 && strays(x + b * 229) - 0.8 * off > 0.62;
            if (!whole && !stray) continue;
            fade = Math.min(1, t);
            frayed += 1;
            loose.push(x, y, m);
          }
          let { id: made, color } = layer(settlement.style, x, d);
          // Pieces far out weather towards the soil they lie in.
          if (fade > 0) { const soil = soilTone(x, y, m), w = fade * 0.45; color = color.map((c, i) => c + (soil[i] - c) * w); }
          PW.set(world, x, y, made | (PW.hash2(x, y) & 3) << 6, { quiet: true });
          PW.setLayer(world, 'paint', x, y, rgb(color));
          cells += 1;
        }
      }
      // A frayed cell left on its own (where a lens tapered to a point) goes back to the ground it
      // replaced: the pieces are lenses, never specks.
      const isMade = (x, y) => { const id = mat[y * W + x] & ID_MASK; return id === M.FILL || id === M.SLAB || id === M.COURSE; };
      for (let i = 0; i < loose.length; i += 3) {
        const x = loose[i], y = loose[i + 1];
        if (isMade(x - 1, y) || isMade(x + 1, y) || isMade(x, y - 1) || isMade(x, y + 1)) continue;
        PW.set(world, x, y, loose[i + 2], { quiet: true });
        PW.setLayer(world, 'paint', x, y, 0);
        cells -= 1; frayed -= 1;
      }
      loose.length = 0;
      settlement.madeGround = { x0: t0, x1: t1, cells, frayed, ends };
      report.push({ side: settlement.side, style: settlement.style, x0: t0, x1: t1, cells, frayed });
    }
    return report;
  }

  PW.urban = { lay, layer, bandsOf, faceAt, FULL, PAVED, SCATTER, SINK };
})();
