'use strict';
// Made ground: under a town's streets, runway and buildings the natural ground is replaced, from
// below the paving down to the bed of its supply lines, by the ground a town is built on. The
// lines are the divider: above them urban ground, below them the land as it was. Each faction
// builds its own:
//   modern - a concrete road slab, a crushed-aggregate base, compacted fill and a concrete duct
//            bank carrying power and data cables.
//   asian  - alternating courses of grey brick and rammed lime-earth, as under the Forbidden
//            City's courtyards (laid so deep that nobody could tunnel in).
//   gothic - a granite base under the setts, then old red-brick courses and clinker rubble, as
//            under a London square.
// The made ground tapers out at 45° where the town ends; under a stage on stilts the slope keeps its
// topsoil and the made ground starts below it.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;
  const rgb = (c) => PW.abgr(c[0] | 0, c[1] | 0, c[2] | 0);

  const FULL = 96;        // depth of made ground where no supply line runs (the water main's bed)
  const PAVED = 4;        // street paving rows (asphalt and road bed) stay as they are
  const KEEP_SOIL = 6;    // an unpaved column (under a stage) keeps this much of its topsoil
  const natural = new Uint8Array(64);
  for (const id of [M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.SAND, M.LOOSE_SOIL, M.LOOSE_STONE]) natural[id] = 1;

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
    if (style === 'asian') {
      // Two rows of grey brick (joints staggered course by course), three of rammed lime-earth,
      // all the way down; the deeper courses are older and darker.
      const cycle = (d - PAVED) % 5, course = Math.floor((d - PAVED) / 5), age = 1 - Math.min(0.18, course * 0.016);
      if (cycle < 2) {
        const joint = (x + (course & 1) * 5) % 10 === 0;
        return { id: M.COURSE, color: (joint ? [150, 146, 136] : cycle === 0 ? [118, 122, 126] : [104, 108, 114]).map((c) => c * age) };
      }
      return { id: M.FILL, color: (cycle === 4 ? [158, 140, 102] : speck([176, 158, 116], [186, 168, 124], [164, 146, 106])).map((c) => c * age) };
    }
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

  function lay(world) {
    const { mat, width: W } = world;
    const pipes = world.pipes;
    // The bottom of the made ground at x: the bed under the deepest supply line there.
    const bed = pipes ? pipes.BED : 2, bore = pipes ? pipes.BORE : 7;
    const report = [];
    for (const settlement of world.settlements || []) {
      const spans = [[settlement.streetLeft, settlement.streetRight]];
      if (settlement.runway) spans.push([Math.min(settlement.runway.from, settlement.runway.to), Math.max(settlement.runway.from, settlement.runway.to)]);
      const fields = settlement.buildings.filter((b) => b.field).map((b) => [b.field.x0, b.field.x1]);
      const x0 = Math.min(...spans.map((s) => s[0])), x1 = Math.max(...spans.map((s) => s[1]));
      const inTown = new Uint8Array(x1 - x0 + 1);
      for (const [a, b] of spans) for (let x = a; x <= b; x += 1) inTown[x - x0] = 1;
      for (const [a, b] of fields) for (let x = Math.max(a, x0); x <= Math.min(b, x1); x += 1) inTown[x - x0] = 0;
      // Distance to the edge of the town, for the 45° taper.
      const edge = new Int32Array(inTown.length);
      for (let k = 0, d = 0; k < inTown.length; k += 1) { d = inTown[k] ? d + 1 : 0; edge[k] = d; }
      for (let k = inTown.length - 1, d = 0; k >= 0; k -= 1) { d = inTown[k] ? d + 1 : 0; edge[k] = Math.min(edge[k], d); }
      const lines = pipes ? pipes.lines.filter((l) => l.settlement === settlement) : [];
      let cells = 0;
      for (let x = Math.max(1, x0); x <= Math.min(W - 2, x1); x += 1) {
        const k = x - x0;
        if (!inTown[k]) continue;
        const s = world.groundTop[x];
        const top = mat[s * W + x] & ID_MASK;
        if (top === M.WATER) continue;
        const paved = (PW.getFlags(world, x, s) & FLAG.ROAD) || top === M.ASPHALT || top === M.ROADBED || top === M.FOUNDATION;
        // Down to the bed of the deepest line here; a full depth where no line runs.
        let bottom = -1;
        for (const line of lines) if (x >= line.x0 && x <= line.x1) bottom = Math.max(bottom, line.ys[x - line.x0] + bore - 1 + bed);
        if (bottom < 0) bottom = s + FULL;
        const start = s + (paved ? PAVED : KEEP_SOIL);
        const end = Math.min(bottom, start + edge[k] - 1);
        for (let y = start; y <= end; y += 1) {
          const id = mat[y * W + x] & ID_MASK;
          if (!natural[id] || PW.getOwner(world, x, y) || (PW.getFlags(world, x, y) & FLAG.TUNNEL)) continue;
          const { id: made, color } = layer(settlement.style, x, y - s);
          PW.set(world, x, y, made | (PW.hash2(x, y) & 3) << 6, { quiet: true });
          PW.setLayer(world, 'paint', x, y, rgb(color));
          cells += 1;
        }
      }
      settlement.madeGround = { x0, x1, cells };
      report.push({ side: settlement.side, style: settlement.style, x0, x1, cells });
    }
    return report;
  }

  PW.urban = { lay, layer, FULL, PAVED };
})();
