'use strict';
// Settlements: the two bases and three neutral clusters, placed on terraced pads that blend into
// the terrain, with streets through the ground floors, runways, farm fields, pumps, starter mine
// tunnels down to the ore nodes and ground defences facing the enemy.
(function () {
  const PW = window.PW;
  const { M, FLAG } = PW;
  const K = PW.buildingKit;
  const { tone, mix, S } = K;
  const rgb = (c) => PW.abgr(c[0], c[1], c[2]);

  // ---- Plans ---------------------------------------------------------------------------------------
  function shuffleStyles(random) {
    const styles = ['asian', 'gothic', 'modern'];
    for (let i = styles.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [styles[i], styles[j]] = [styles[j], styles[i]];
    }
    return { left: styles[0], right: styles[1], neutral: styles[2] };
  }
  // Rear (map edge, pond side) to front (towards the enemy).
  function basePlan(random) {
    const pick = (list) => list[Math.floor(random() * list.length)];
    return [
      { type: 'farm', variant: pick(['silos', 'barn', 'homestead']), level: 2, rear: true, field: true },
      { type: 'core' },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 3 },
      { type: 'farm', variant: 'greenhouse', level: 2 },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 2 },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 4, optional: true },
      { type: 'military', variant: pick(PW.MILITARY_VARIANTS), level: 3, front: true },
    ];
  }
  // Tight neutral cluster with every building type (they start out under construction).
  function neutralPlan(random) {
    const pick = (list) => list[Math.floor(random() * list.length)];
    return [
      { type: 'farm', variant: pick(['silos', 'barn', 'homestead']), level: 1, field: true },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 1 },
      { type: 'military', variant: pick(PW.MILITARY_VARIANTS), level: 1 },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 1 },
      { type: 'mine' },
    ];
  }

  // ---- Terrain shaping -------------------------------------------------------------------------------
  // Level the ground to padY over [x0, x1] and blend it back into the land on either side. The cut
  // or fill at each edge fades out over a batter, with a rounded shoulder and toe, adding no more
  // than `ramp` cells a column to the land's own slope: past the pad the land keeps its own shape
  // (a mountain beside a pad is not regraded), and no sheer earth face is left anywhere. Lakes and
  // ponds are left alone (no soil laid on water, no bed cut out from under it), and so is anything
  // built, paved or sown. Returns the span it shaped.
  function terracePad(world, x0, x1, padY, ramp = 0.9) {
    const W = world.width;
    // The land as it was, for the edges and the batters.
    const lo = Math.max(1, x0 - 900), hi = Math.min(W - 2, x1 + 900);
    const land = world.groundTop.slice(lo, hi + 1), natural = (x) => land[x - lo];
    const smoothstep = (t) => t * t * (3 - 2 * t);
    const goals = new Map();
    for (let x = Math.max(lo, x0); x <= Math.min(hi, x1); x += 1) goals.set(x, padY);
    let from = x0, to = x1;
    for (const side of [-1, 1]) {
      const edge = side < 0 ? x0 : x1;
      if (edge < lo || edge > hi) continue;
      const h = padY - natural(edge);
      const L = Math.min(880, Math.ceil(Math.abs(h) * 1.5 / ramp));
      for (let d = 1; d <= L; d += 1) {
        const x = edge + side * d;
        if (x < lo || x > hi) break;
        goals.set(x, Math.round(natural(x) + h * (1 - smoothstep(d / L))));
        if (side < 0) from = x; else to = x;
      }
    }
    for (const [x, goal] of goals) shapeColumn(world, x, goal, x >= x0 && x <= x1);
    // Plants and rocks that lost the ground under them (a hilltop cut away) fall, as after a blast.
    const box = { x0: from, y0: padY - 1200, x1: to, y1: padY + 300 };
    if (PW.flora) PW.flora.afterBlast(world, null, box);
    if (PW.props) PW.props.afterBlast(world, null, box);
    (world.pads || (world.pads = [])).push({ x0, x1, y: padY, from, to, edges: [padY - natural(Math.max(lo, x0)), padY - natural(Math.min(hi, x1))] });
    return { from, to };
  }
  // Cut or fill column x so its surface is at row `goal`: under a pad (or a field) topsoil, beyond
  // it grass. Water is left alone (no soil laid on water, no bed cut out from under it), and so is
  // anything built, paved or sown: nothing is dug out from under (or buried) that already stands
  // there, like a pump's plinth, and a street, a runway or a field is not re-levelled.
  function shapeColumn(world, x, goal, pad) {
    const { mat, width: W } = world;
    const natural = world.groundTop[x];
    if (goal === natural || (mat[natural * W + x] & 63) === M.WATER) return false;
    if (PW.getOwner(world, x, natural) || PW.getOwner(world, x, natural - 1)) return false;
    if (PW.getFlags(world, x, natural) & (FLAG.ROAD | FLAG.FIELD)) return false;
    if (goal > natural) {
      // Cut: remove ground above the goal, then re-grass the new surface.
      for (let y = natural; y < goal; y += 1) {
        const id = mat[y * W + x] & 63;
        if (id !== M.AIR && id !== M.WATER) PW.set(world, x, y, M.AIR, { quiet: true });
      }
      for (let y = goal; y < goal + 3; y += 1) {
        if ((mat[y * W + x] & 63) === M.WATER) continue;
        PW.set(world, x, y, (pad ? M.TOPSOIL : M.GRASS) | (PW.hash2(x, y) & 3) << 6, { quiet: true });
      }
      for (let y = goal - 200; y < goal; y += 1) PW.setLayer(world, 'deco', x, y, 0);
    } else {
      // Fill: soil up to the goal, grass on top outside the pads.
      for (let y = goal; y < natural; y += 1) {
        const id = y < goal + 3 && !pad ? M.GRASS : y < goal + 14 ? M.TOPSOIL : M.SOIL;
        PW.set(world, x, y, id | (PW.hash2(x, y) & 3) << 6, { quiet: true });
        PW.setLayer(world, 'deco', x, y, 0);   // whatever stood here is buried by the fill
      }
    }
    // Wild deco above the new ground in the pad is cleared (grass regrows on the shoulders).
    if (pad) for (let y = goal - 60; y < goal + 4; y += 1) PW.setLayer(world, 'deco', x, y, 0);
    return true;
  }
  // The deepest cut or fill a pad laid out on the land may take (about 1.4 m): deeper than that,
  // the pad does not belong there.
  const PAD_DEPTH = 20;
  // How far the ground over [x0, x1] strays from the level padY (the deepest cut or fill a pad
  // there would need).
  function padDepth(world, x0, x1, padY) {
    let worst = 0;
    for (let x = x0; x <= x1; x += 1) worst = Math.max(worst, Math.abs(world.groundTop[x] - padY));
    return worst;
  }
  // How far from x towards `dir` (up to `limit`) the land stays dry and gentle enough to plough:
  // no steeper than about 1 in 2, judged over 16 columns (the land's small ripples don't count).
  function ploughable(world, x, dir, limit) {
    let d = 0;
    for (; d < limit; d += 1) {
      const k = x + dir * d;
      if (k < 40 || k > world.width - 40 || (PW.get(world, k, world.groundTop[k]) & 63) === M.WATER) break;
      if (d >= 16 && Math.abs(world.groundTop[k] - world.groundTop[k - dir * 16]) > 9) break;
    }
    return d;
  }
  // The level that needs the least earthwork over [x0, x1]: the median of the ground there.
  function medianGround(world, x0, x1) {
    const rows = [];
    for (let x = x0; x <= x1; x += 1) rows.push(world.groundTop[x]);
    rows.sort((p, q) => p - q);
    return rows[rows.length >> 1];
  }

  // ---- Street paving (district paving palettes from the style lab, scaled) ----------------------------
  const PAVING = {
    gothic: { paving: [128, 122, 118], joint: [80, 74, 72], base: [70, 62, 58] },
    asian: { paving: [176, 156, 120], joint: [120, 70, 50], base: [96, 80, 60] },
    modern: { paving: [64, 66, 72], joint: [226, 190, 60], base: [44, 44, 48] },
  };
  // ---- Road foundations -------------------------------------------------------------------------------
  // Under the paving a road is built up in courses, as in a road cutting: a base course of crushed
  // stone (dark grey with pale chips), a sub-base of sand and gravel with pebbles, then the subgrade,
  // the land itself compacted (darker, with fine cracks), whose foot wanders into the undisturbed
  // ground. Each style lays its own upper courses: setts sit on a sand bed and broken-granite
  // hardcore, stone slabs on a lime-sand bed and a tamped earth crust. The base and sub-base are
  // wider than the paving, their edges battered back into the ground beside the road.
  const BASE_ROWS = 4, SUBBASE_ROWS = 3, SUBGRADE_ROWS = 3;
  const ROAD_DEPTH = 4 + BASE_ROWS + SUBBASE_ROWS + SUBGRADE_ROWS;   // (paving rows first)
  function naturalColor(world, x, y, m) {
    const id = m & 63, c = PW.unpack(PW.mat.palettes[id][(m >> 6) * 2]);
    const soil = world.soil, k = 1 - Math.min(0.28, Math.max(0, y - (world.surface0 || world.groundTop)[x]) / 1260);
    const t = soil && (id === M.SOIL || id === M.CLAY || id === M.LOOSE_SOIL) ? [soil.tint[x * 3] / 256, soil.tint[x * 3 + 1] / 256, soil.tint[x * 3 + 2] / 256] : [1, 1, 1];
    return [c[0] * t[0] * k, c[1] * t[1] * k, c[2] * t[2] * k];
  }
  // The course `row` cells below the street's top (4 = first row under the paving) at (x, y).
  function roadCourse(world, style, x, y, row, m) {
    const h = PW.hash2(x, y * 7 + 3), piece = PW.hash2(x >> 1, y);   // (chips and pebbles two cells long)
    if (row < 4 + BASE_ROWS) {
      if (style === 'gothic' && row === 4) return { id: M.FILL, color: (h & 3) ? [176, 160, 124] : [190, 176, 140] };       // setts' sand bed
      if (style === 'asian') return { id: M.FILL, color: row < 7 ? ((h & 7) ? [206, 198, 172] : [222, 214, 192]) : (x % 6 === 0 ? [126, 106, 76] : [148, 126, 90]) };   // lime-sand bed, tamped crust
      if (style === 'gothic') return { id: M.FILL, color: (piece & 7) === 0 ? [138, 82, 62] : (piece & 7) < 3 ? [124, 120, 118] : [86, 82, 80] };   // hardcore
      return { id: M.FILL, color: (piece & 7) < 2 ? [172, 170, 162] : (piece & 7) < 4 ? [114, 116, 118] : (h & 1) ? [62, 64, 68] : [74, 76, 80] };   // crushed stone
    }
    if (row < 4 + BASE_ROWS + SUBBASE_ROWS) {
      const pebble = PW.hash2(x >> 1, y >> 1) & 15;
      return { id: M.FILL, color: pebble === 0 ? [122, 112, 100] : pebble === 1 ? [148, 98, 70] : pebble === 2 ? [196, 184, 160] : (h & 3) ? [170, 146, 106] : [184, 160, 120] };
    }
    // Subgrade: the land itself, compacted; fine cracks run down through it.
    const c = naturalColor(world, x, y, m), crack = PW.hash2(x - (y >> 1), y >> 2) % 19 === 0;
    const k = crack ? 0.62 : 0.84;
    return { id: m & 63, color: [c[0] * k, c[1] * k, c[2] * k], natural: true };
  }
  function layRoadBase(world, x, top, style, rows = ROAD_DEPTH) {
    const { mat, width: W } = world;
    // (the subgrade's foot wanders a row or two into the ground under it)
    const last = Math.min(rows, ROAD_DEPTH - 2 + (PW.hash2(x >> 2, 0x5b6) % 3));
    for (let row = 4; row < last; row += 1) {
      const y = top + row;
      if (y >= world.height - 30) break;
      const m = mat[y * W + x], id = m & 63;
      if (!PW.mat.terrain[id] || id === M.FILL || id === M.SLAB || id === M.COURSE || id === M.ORE || id === M.BEDROCK || id === M.WATER) continue;
      if (PW.getOwner(world, x, y) || (PW.getFlags(world, x, y) & (FLAG.TUNNEL | FLAG.ROAD))) continue;
      const course = roadCourse(world, style, x, y, row, m);
      if (!course.natural) PW.set(world, x, y, course.id | (PW.hash2(x, y) & 3) << 6, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(course.color.map((v) => Math.round(v))));
    }
  }
  // Where a run of road ends, its base and sub-base reach on under the ground beside it, battered
  // back at about 1:1.2 (deeper rows reach further).
  function flareRoadBase(world, end, side, top, style) {
    const { mat, width: W } = world;
    for (let d = 1; d <= 6; d += 1) {
      const x = end + side * d;
      if (x < 1 || x >= W - 1 || (PW.getFlags(world, x, world.groundTop[x]) & FLAG.ROAD)) break;
      for (let row = 4 + Math.ceil(d * 1.2); row < 4 + BASE_ROWS + SUBBASE_ROWS; row += 1) {
        const y = top + row;
        if (y < world.groundTop[x] + 2) continue;
        const m = mat[y * W + x], id = m & 63;
        if (!PW.mat.terrain[id] || id === M.FILL || id === M.SLAB || id === M.COURSE || id === M.ORE || id === M.WATER) continue;
        if (PW.getOwner(world, x, y) || (PW.getFlags(world, x, y) & FLAG.TUNNEL)) continue;
        const course = roadCourse(world, style, x, y, row, m);
        PW.set(world, x, y, course.id | (PW.hash2(x, y) & 3) << 6, { quiet: true });
        PW.setLayer(world, 'paint', x, y, rgb(course.color.map((v) => Math.round(v))));
      }
    }
  }
  // The street's top row is padY, or padY(x) where it follows the ground (null: no street there).
  function paveStreet(world, x0, x1, padY, styleAt) {
    const topAt = (x) => (typeof padY === 'function' ? padY(x) : padY);
    for (const [end, side] of [[x0, -1], [x1, 1]]) {
      const top = topAt(end);
      if (top !== null && top !== undefined) flareRoadBase(world, end, side, top, styleAt(end));
    }
    for (let x = x0; x <= x1; x += 1) {
      const top = topAt(x);
      if (top === null || top === undefined) continue;
      const style = styleAt(x);
      layRoadBase(world, x, top, style);
      const P = PAVING[style];
      for (let row = 0; row < 4; row += 1) {
        const y = top + row;
        const id = PW.get(world, x, y) & 63;
        if (!PW.mat.ground[id] || id === M.WATER) continue;
        let color;
        if (row === 3) color = P.base;
        else if (style === 'modern') color = row === 0 && x % 48 < 24 ? (x % 48 < 2 ? P.joint : P.paving) : row === 1 && x % 24 < 12 ? tone(P.paving, 0.86) : P.paving;
        else if (style === 'gothic') color = (x + row * 6) % 9 === 0 || row === 2 ? P.joint : tone(P.paving, (PW.hash2(x >> 3, row) & 1) ? 1.06 : 0.95);
        else color = (x + row * 9) % 18 === 0 || row === 2 ? P.joint : tone(P.paving, (PW.hash2(x / 18 | 0, row) & 1) ? 1.04 : 0.96);
        if (row === 0 && (PW.hash2(x, y) & 15) === 0) color = tone(color, 0.9);
        PW.set(world, x, y, row === 0 ? M.ASPHALT : M.ROADBED, { quiet: true });
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.ROAD);
      }
    }
  }
  // Runways by faction: modern - pale concrete slabs with white markings and blue edge lights;
  // asian - dark asphalt with a yellow dashed centre line and white edges, amber lights; gothic -
  // worn asphalt patched with darker repairs, faded markings, warm white lights.
  const RUNWAY = {
    modern: { top: [146, 144, 136], seam: [112, 110, 104], base: [96, 94, 90], mark: [236, 236, 230], centre: [236, 236, 230], light: [110, 180, 255], slab: 20 },
    asian: { top: [52, 54, 58], seam: [44, 46, 50], base: [36, 36, 40], mark: [232, 232, 226], centre: [232, 196, 52], light: [255, 176, 70], slab: 0 },
    gothic: { top: [72, 72, 74], seam: [56, 56, 58], base: [44, 44, 46], mark: [198, 196, 188], centre: [198, 196, 188], light: [255, 228, 170], slab: 0, patched: true },
  };
  function paveRunway(world, from, direction, length, padY, style = 'modern') {
    const R = RUNWAY[style] || RUNWAY.modern;
    for (let i = 0; i < length; i += 1) {
      const x = from + direction * i;
      for (let row = 0; row < 4; row += 1) {
        const y = padY + row;
        let color = row === 3 ? R.base : R.top;
        if (R.slab && row < 3 && mod(x, R.slab) === 0) color = R.seam;                             // slab joints
        if (R.patched && row < 2 && (PW.hash2(Math.floor(x / 14), 3) % 4) === 0) color = tone(R.top, 0.82);   // repairs
        if (row === 0 && i % 60 < 30 && i > 20 && i < length - 40) color = R.centre;               // centre line
        if (row === 0 && i > length - 30 && i % 6 < 3) color = R.mark;                              // threshold bars
        if (R.patched && row === 0 && color === R.mark && (PW.hash2(x, 9) & 3) === 0) color = tone(R.mark, 0.7);   // worn paint
        if (row === 1 && (PW.hash2(x, y) & 7) === 0) color = tone(color, 1.12);
        PW.set(world, x, y, row === 0 ? M.ASPHALT : M.ROADBED, { quiet: true });
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.ROAD);
      }
      for (let y = padY - 60; y < padY; y += 1) PW.setLayer(world, 'deco', x, y, 0);
      // Edge lights on short posts.
      if (i % 30 === 6) { PW.setLayer(world, 'deco', x, padY - 1, rgb([40, 40, 44])); PW.setLayer(world, 'deco', x, padY - 2, rgb(R.light)); }
    }
  }
  const mod = (a, n) => ((a % n) + n) % n;

  // ---- Farms: wheat field and shore pump ----------------------------------------------------------------
  // A field is a surface, like a road: its tilled rows carry the FIELD flag. A field never goes
  // over a road, and never over anything a building owns (a building standing on a field keeps it
  // under its floor). field.columns is what was sown, field.alive what is still field: together
  // with the crop's growth they set the farm's SM output. A field follows the land: `surface` is its
  // row, or a function giving its row at each column (field.ys; field.y is its middle row).
  const fieldY = (field, x) => (field.ys ? field.ys[Math.max(0, Math.min(field.ys.length - 1, x - field.x0))] : field.y);
  function sowField(world, x0, x1, surface, random) {
    const ys = new Int32Array(x1 - x0 + 1);
    for (let x = x0; x <= x1; x += 1) ys[x - x0] = typeof surface === 'function' ? surface(x) : surface;
    const sorted = Array.from(ys).sort((p, q) => p - q);
    const field = { x0, x1, y: sorted[sorted.length >> 1], ys, growth: 0.55 + random() * 0.4, stalks: [], columns: 0, alive: 0 };
    let first = -1, last = -1;
    for (let x = x0; x <= x1; x += 1) {
      const padY = ys[x - x0];
      if (PW.getFlags(world, x, padY) & FLAG.ROAD) continue;
      if (PW.getOwner(world, x, padY)) continue;
      let sown = false;
      for (let row = 0; row < 3; row += 1) {
        const y = padY + row;
        if (!PW.mat.ground[PW.get(world, x, y) & 63] || PW.getOwner(world, x, y)) continue;
        PW.set(world, x, y, M.TOPSOIL | (row << 6), { quiet: true });
        const furrow = (x % 6) < 3;                                   // dark furrows between the rows
        PW.setLayer(world, 'paint', x, y, rgb(row === 0 ? (furrow ? [48, 37, 28] : [82, 63, 45]) : [64, 49, 35]));
        PW.setFlag(world, x, y, FLAG.FIELD);
        sown = true;
      }
      if (sown) { field.columns += 1; if (first < 0) first = x; last = x; }
    }
    // The field ends where its sowing ends: a road or a yard at its edge trims it, never
    // stands inside it unsown (seed 11: a street end over farm 24's first five columns).
    if (first > x0 || (last >= 0 && last < x1)) {
      field.ys = ys.slice(first - x0, last - x0 + 1);
      field.x0 = first; field.x1 = last;
    }
    field.alive = field.columns;
    drawCrop(world, field);
    return field;
  }
  // Columns of a field still under crop (a road laid over part of it takes those away).
  function recountField(world, field) {
    let alive = 0;
    for (let x = field.x0; x <= field.x1; x += 1) if (PW.getFlags(world, x, fieldY(field, x)) & FLAG.FIELD) alive += 1;
    field.alive = alive;
    return alive;
  }
  // Draw (or redraw) a field's wheat at its current growth: green shoots when young, golden ears
  // when ripe. Stalks only grow from tilled soil that is still there, into open air.
  // The crop: maize in dense rows, as in the field references. Young plants are short green shoots;
  // grown ones are tall green stalks (taller than a trooper) with leaves arching out and golden
  // tassels on top; ripe ones dry to straw gold. Nothing is drawn inside a building or over a yard
  // prop, and only on ground that is still field.
  const MAIZE = { stalk: [[66, 108, 44], [80, 124, 50]], leaf: [[92, 146, 58], [70, 118, 46], [108, 160, 66]],
    tassel: [[226, 200, 112], [204, 174, 92], [240, 216, 132]], straw: [[196, 168, 96], [176, 148, 80]], strawLeaf: [[170, 142, 74], [150, 124, 64]],
    husk: [[220, 196, 120], [196, 170, 100]] };
  function drawCrop(world, field) {
    const { x0, x1, growth } = field;
    const base = (x) => fieldY(field, x);
    const open = (x, y) => (PW.get(world, x, y) & 63) === M.AIR && !(PW.getFlags(world, x, y) & FLAG.CHARRED)
      && !PW.getLayer(world, 'back', x, y) && !PW.getOwner(world, x, y) && (!PW.getLayer(world, 'deco', x, y) || (PW.getFlags(world, x, y) & FLAG.FLORA));
    for (let x = x0 - 4; x <= x1 + 4; x += 1) {
      const b = base(x);
      for (let i = 1; i <= 36; i += 1) {
        if (PW.getFlags(world, x, b - i) & FLAG.FLORA) { PW.setLayer(world, 'deco', x, b - i, 0); PW.setFlag(world, x, b - i, FLAG.FLORA | FLAG.WOOD | FLAG.CHARRED, false); }
      }
    }
    field.stalks = [];
    const put = (x, y, color) => {
      if (x < x0 - 3 || x > x1 + 3 || !open(x, y)) return false;
      PW.setLayer(world, 'deco', x, y, rgb(color));
      PW.setFlag(world, x, y, FLAG.FLORA);
      return true;
    };
    const ripe = growth >= 0.85, young = growth < 0.4;
    for (let x = x0; x <= x1; x += 2) {
      const padY = base(x);
      if (!(PW.getFlags(world, x, padY) & FLAG.FIELD)) continue;
      const full = 24 + (PW.hash2(x, 41) % 9);                      // 1.7-2.3 m
      const h = Math.max(2, Math.round(full * Math.min(1, growth * 1.1)));
      field.stalks.push({ x, h });
      const pick = (list, k) => list[PW.hash2(x, k) % list.length];
      for (let i = 1; i <= h; i += 1) {
        const top = i > h - 4 && !young;
        const color = young ? pick(MAIZE.leaf, i) : top ? (ripe ? pick(MAIZE.husk, i) : pick(MAIZE.tassel, i)) : ripe ? pick(MAIZE.straw, i) : pick(MAIZE.stalk, i);
        if (!put(x, padY - i, color)) break;
        // Leaves arch out from the stalk every few cells, on alternating sides, drooping at the tip.
        if (!top && i > 3 && (i + (PW.hash2(x, 7) & 3)) % 5 === 0) {
          const side = ((i / 5) | 0) % 2 ? 1 : -1, leaf = ripe ? pick(MAIZE.strawLeaf, i) : pick(MAIZE.leaf, i + 1);
          put(x + side, padY - i - 1, leaf); put(x + 2 * side, padY - i - 1, leaf); put(x + 3 * side, padY - i, leaf);
          if (!young) put(x + 4 * side, padY - i + 1, leaf);
        }
        // An ear of corn halfway up a grown stalk.
        if (!young && i === Math.round(h * 0.55)) put(x + 1, padY - i, pick(MAIZE.husk, i));
      }
      // The tassel's side spikes.
      if (!young && h > 6) { put(x - 1, padY - h + 1, pick(MAIZE.tassel, 3)); put(x + 1, padY - h + 2, pick(MAIZE.tassel, 4)); }
    }
  }
  // The lake pump, from below: a pump chamber dug in under the lake bed, reached by nothing but its
  // pipes. The basin's water comes down into it through a strainer set into the bed and a
  // bell-mouthed suction pipe with its gate valve, into a centrifugal pump on its bedplate and
  // plinth (after the refs: a polished volute, the coupling guard, a finned motor and its fan cowl),
  // whose discharge goes on down through the chamber floor to the water main under the basin.
  // The pump only measures its lake: no water is taken out of it.
  const CHAMBER = Object.freeze({ half: 28, height: 30, wall: 4, cover: 10 });
  const VOLUTE = [206, 210, 212], VOLUTE_MID = [170, 174, 176], VOLUTE_RIM = [118, 122, 126];
  const MOTOR = [42, 150, 110], MOTOR_LIT = [70, 186, 140], MOTOR_DARK = [26, 104, 76], GUARD = [214, 160, 40];
  const PUMP_STEEL = [122, 130, 136], PUMP_DARK = [66, 70, 76];
  // Where a pump would sit on this lake: wholly under the lake floor, where the floor over it
  // is gentle, nearest the given shore (under the deepest spot, if the floor is uneven
  // everywhere). Split out of lakePump for N62: a lake that already has its one pump still
  // RESERVES the strip a second would have taken, so the wild growth sees the same world.
  function pumpSite(world, lake, towardX, taken = () => false) {
    const near = towardX < lake.x ? -1 : 1, shore = near < 0 ? lake.left : lake.right;
    const bedAt = (x) => PW.supportBelow(world, x, world.groundTop[x], true);
    const wetAt = (x) => (PW.get(world, x, world.groundTop[x]) & 63) === M.WATER;
    const reach = CHAMBER.half + CHAMBER.wall;
    let best = null, deepest = null;
    for (let x = lake.left + reach + 4; x <= lake.right - reach - 4; x += 2) {
      if (taken(x)) continue;
      let top = Infinity, low = -Infinity, wet = true;
      for (let k = -reach; k <= reach; k += 1) {
        const b = bedAt(x + k);
        top = Math.min(top, b); low = Math.max(low, b);
        if (!wetAt(x + k)) wet = false;
      }
      if (!wet) continue;
      if (!deepest || low > deepest.low) deepest = { x, top, low };
      if (low - top > 24) continue;
      const score = Math.abs(x - shore) + (low - top) * 2;
      if (!best || score < best.score) best = { x, score, top, low };
    }
    const at = best || deepest;
    if (!at) return null;
    return { cx: at.x, near, low: at.low, left: at.x - reach, right: at.x + reach };
  }
  function lakePump(world, lake, towardX, style, owner, taken = () => false) {
    const site = pumpSite(world, lake, towardX, taken);
    if (!site) return null;
    const near = site.near, cx = site.cx;
    const bedAt = (x) => PW.supportBelow(world, x, world.groundTop[x], true);
    const put = (x, y, id, color) => {
      PW.set(world, x, y, id, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
      PW.setOwner(world, x, y, owner);
    };
    const { half, height, wall, cover } = CHAMBER;
    // Rows: the roof slab under `cover` rows of ground below the lowest bed point, the chamber, its
    // floor slab.
    const roof = site.low + cover, top = roof + wall, floor = top + height - 1;
    const back = (x, y, c) => {
      if ((PW.get(world, x, y) & 63) !== M.AIR) PW.set(world, x, y, M.AIR, { quiet: true });
      PW.setLayer(world, 'back', x, y, rgb(c));
      PW.setOwner(world, x, y, owner);
    };
    // The chamber: concrete walls round a dry room, lit by a lamp under its roof.
    for (let y = roof; y <= floor + wall; y += 1) for (let x = cx - half - wall; x <= cx + half + wall; x += 1) {
      const inside = Math.abs(x - cx) <= half && y >= top && y <= floor;
      if (inside) {
        const glow = Math.max(0, 1 - Math.hypot(x - cx, (y - top) * 1.6) / 46);
        back(x, y, tone((x - cx + half) % 12 === 0 ? [50, 52, 56] : [62, 64, 68], 1 + glow * 0.6));
      } else {
        const face = Math.abs(x - cx) === half + 1 || y === top - 1 || y === floor + 1;
        put(x, y, M.FOUNDATION, face ? [150, 148, 142] : (x + y) % 7 === 0 ? [100, 98, 94] : [122, 120, 114]);
      }
    }
    for (let x = cx - 3; x <= cx + 3; x += 1) PW.setLayer(world, 'back', x, top, rgb(Math.abs(x - cx) < 2 ? [255, 236, 190] : [120, 120, 116]));
    // The pump on its plinth and bedplate: volute on the axis, coupling guard and motor on the side
    // away from the farm, fan cowl at the motor's end (its discharge goes the farm's way).
    const steel = (x, y, c) => put(x, y, M.STEEL, c);
    for (let y = floor - 2; y <= floor; y += 1) for (let u = -26; u <= 14; u += 1) put(cx + near * u, y, M.FOUNDATION, y === floor - 2 ? [166, 166, 160] : [150, 150, 144]);
    for (let u = -26; u <= 10; u += 1) steel(cx + near * u, floor - 3, PUMP_DARK);
    const vy = floor - 11, r = 7;
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > r + 0.3) continue;
      steel(cx + dx, vy + dy, d > r - 1 ? VOLUTE_RIM : d < 2 ? [96, 100, 104] : dx * near + dy < -3 ? VOLUTE : VOLUTE_MID);
    }
    for (let y = vy + r; y <= floor - 4; y += 1) for (let dx = -4; dx <= 4; dx += 1) steel(cx + dx, y, PUMP_DARK);   // its pedestal
    const toward = (u0, u1, y0, y1, c) => { for (let y = y0; y <= y1; y += 1) for (let u = u0; u <= u1; u += 1) steel(cx + near * u, y, typeof c === 'function' ? c(u, y) : c); };
    toward(-11, -8, vy - 3, vy + 3, (u, y) => (y === vy - 3 ? [236, 184, 60] : GUARD));
    toward(-24, -12, vy - 6, vy + 6, (u, y) => (y === vy - 6 ? MOTOR_LIT : y === vy + 6 ? MOTOR_DARK : (y - vy) & 1 ? MOTOR : [34, 128, 94]));
    toward(-20, -16, vy - 9, vy - 7, (u, y) => (y === vy - 9 ? MOTOR_LIT : MOTOR));
    toward(-26, -25, vy - 5, vy + 5, (u, y) => ((y - vy) & 1 ? [60, 64, 66] : [150, 154, 156]));
    for (let y = vy + 7; y <= floor - 4; y += 1) toward(-22, -14, y, y, PUMP_DARK);   // the motor's feet
    // The suction: a strainer set into the lake floor, a bell mouth under it, the pipe down
    // through the ground and the roof into the volute's eye, with its gate valve.
    const pipe = (x, y, k) => put(x, y, M.PIPE, k === 0 ? [150, 156, 160] : k === 2 ? [70, 76, 82] : [118, 124, 130]);
    const bed = bedAt(cx);
    for (let dx = -5; dx <= 5; dx += 1) put(cx + dx, bedAt(cx + dx), M.STEEL, (dx & 1) ? [40, 46, 52] : PUMP_STEEL);
    for (let y = bed + 1; y < vy - r; y += 1) {
      const bell = y - bed <= 3 ? 4 - (y - bed) : 0;
      for (let dx = -1 - bell; dx <= 1 + bell; dx += 1) pipe(cx + dx, y, dx === -1 - bell ? 0 : dx === 1 + bell ? 2 : 1);
    }
    for (let y = top + 6; y <= top + 9; y += 1) for (let dx = -3; dx <= 3; dx += 1) steel(cx + dx, y, y === top + 6 || y === top + 9 ? PUMP_DARK : PUMP_STEEL);
    for (let dx = -4; dx <= 4; dx += 1) steel(cx + dx, top + 4, [176, 40, 32]);
    for (let y = top + 4; y <= top + 5; y += 1) steel(cx, y, [176, 40, 32]);
    // The discharge: out of the volute on the farm's side, along and down through the plinth and
    // the floor slab to the water main.
    const outX = cx + near * 12;
    for (let u = r; u <= 12; u += 1) for (let dy = -1; dy <= 1; dy += 1) pipe(cx + near * u, vy + dy, dy + 1);
    for (let y = vy + 2; y <= floor + wall; y += 1) for (let dx = -1; dx <= 1; dx += 1) pipe(outX + dx, y, dx + 1);
    // N50: the pump's own small core, sunk in an armoured pocket in the floor on the farm's
    // side and cabled to the bedplate - a half-size heart that keeps the pump regenerating.
    const KIT = PW.buildingKit;
    const coreX = cx + near * 21, coreY = floor - 5, heartY = coreY - 2;
    for (let dy = -7; dy <= 2; dy += 1) for (let dx = -6; dx <= 6; dx += 1) {
      const rim = Math.abs(dx) === 6 || dy === -7 || dy === 2;
      if (rim) put(coreX + dx, coreY + dy, M.FOUNDATION, ((dx + dy) & 1) ? [196, 164, 58] : [58, 58, 62]);
      else back(coreX + dx, coreY + dy, (dx & 1) ? [30, 32, 40] : [24, 26, 32]);
    }
    for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > 3.4) continue;
      put(coreX + dx, heartY + dy, M.CORE, d < 1.3 ? [255, 255, 255] : d < 2.4 ? (KIT ? KIT.CORE_COLOR : [168, 236, 255]) : (KIT ? KIT.CORE_SHADE : [96, 170, 214]));
    }
    for (const u of [15, 16, 17]) steel(cx + near * u, floor - 3, u === 16 ? [60, 64, 66] : PUMP_DARK);   // the cable to the pocket
    let bedTop = bed;
    for (let dx = -5; dx <= 5; dx += 1) bedTop = Math.min(bedTop, bedAt(cx + dx));
    const left = cx - half - wall, right = cx + half + wall;
    return { x: outX, y: floor + 1, left, right, lake, intakeX: cx, chamber: { x0: cx - half, x1: cx + half, top, floor },
      span: [left, right], core: { x: coreX, y: heartY },
      box: { x0: left - 1, x1: right + 1, y0: bedTop - 2, y1: floor + wall + 1 } };
  }
  // N50: a world-drawn work (the lake pump) captured as a print - the cells repair rebuilds
  // it from, the way a canvas serves a stamped building. Owner-filtered over the given box;
  // solid cells keep their material and paint, room cells their back wall.
  function capturePrint(world, owner, box) {
    const cells = [];
    for (let y = box.y0; y <= box.y1; y += 1) for (let x = box.x0; x <= box.x1; x += 1) {
      if (PW.getOwner(world, x, y) !== owner) continue;
      const mat = PW.get(world, x, y);
      const back = PW.getLayer(world, 'back', x, y);
      if (!(mat & 63) && !back) continue;
      cells.push({ x, y, mat: (mat & 63) ? mat : 0, paint: PW.getLayer(world, 'paint', x, y), back });
    }
    return { box, cells };
  }
  // Called once generation is COMPLETE (after pipes and made ground): every pump's cells, as
  // the world finally stands, become the print its repair rebuilds from (N50).
  function capturePumpPrints(world) {
    for (const b of world.buildings || []) {
      if (!b || !b.pump || b.prints) continue;
      b.prints = [capturePrint(world, b.id, b.pump.box)];
      b.printList = null;
    }
  }

  // ---- Tunnels: lined shafts, drifts and rooms (tunnel network lab look) ---------------------------------
  const TUNNEL = { back: [24, 23, 22], floor: [44, 36, 28], prop: [76, 54, 32], lamp: [255, 220, 140], rail: [150, 112, 62], rung: [214, 178, 112] };
  // Carve an axis-aligned interior box; line its rim with orange LINING where it meets ground.
  function carveBox(world, x0, y0, x1, y1, owner, lining = 4) {
    const { mat, width: W } = world;
    for (let y = y0 - lining; y <= y1 + lining; y += 1) {
      for (let x = x0 - lining; x <= x1 + lining; x += 1) {
        if (!PW.inside(world, x, y)) continue;
        const interior = x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const id = mat[y * W + x] & 63;
        if (interior) {
          if (id !== M.AIR) PW.set(world, x, y, M.AIR, { quiet: true });
          const fromTop = y - y0, fromBottom = y1 - y;
          const color = fromBottom < 3 ? TUNNEL.floor : tone(TUNNEL.back, fromTop < 4 ? 0.8 : (PW.hash2(x, y) & 15) === 0 ? 1.25 : 1);
          PW.setLayer(world, 'back', x, y, rgb(color));
          PW.setFlag(world, x, y, FLAG.TUNNEL | FLAG.CARVED);
          PW.setLayer(world, 'deco', x, y, 0);
        } else if (PW.getFlags(world, x, y) & FLAG.CARVED) {
          continue;
        } else if (id !== M.AIR && id !== M.WATER && id !== M.ORE && id !== M.BEDROCK && !PW.mat.structural[id]) {
          PW.set(world, x, y, M.LINING, { quiet: true });
        }
        if (owner) PW.setOwner(world, x, y, owner);
      }
    }
  }
  function tunnelLamps(world, x0, x1, ceilingY, step = 64) {
    for (let x = x0 + 20; x <= x1 - 10; x += step) {
      for (let dx = -2; dx <= 2; dx += 1) PW.setLayer(world, 'back', x + dx, ceilingY, rgb(TUNNEL.lamp));
      for (let y = ceilingY + 1; y < ceilingY + 26; y += 1) {
        for (let dx = -16; dx <= 16; dx += 1) {
          const d = Math.hypot(dx, (y - ceilingY) * 0.8) / 18;
          if (d >= 1) continue;
          const current = PW.getLayer(world, 'back', x + dx, y);
          if (!current) continue;
          PW.setLayer(world, 'back', x + dx, y, rgb(mix(PW.unpack(current), TUNNEL.lamp, (1 - d) * (1 - d) * 0.35)));
        }
      }
    }
  }
  function ladder(world, x, y0, y1) {
    for (let y = y0; y <= y1; y += 1) {
      for (let dx = 0; dx < 12; dx += 1) {
        const rail = dx < 2 || dx > 9;
        const rung = (y % 6) === 0;
        if (rail || rung) {
          PW.setLayer(world, 'back', x + dx, y, rgb(rail ? TUNNEL.rail : TUNNEL.rung));
          PW.setFlag(world, x + dx, y, FLAG.FIXTURE);   // tunnel development paints around it
        }
        PW.setFlag(world, x + dx, y, FLAG.LADDER);
      }
    }
  }
  // Where a drift running from x towards `dir` first meets ore within rows [top, bottom]: the
  // column just short of the vein, so the ore forms the working face. Falls back to the node's
  // centre minus its half-width when the vein misses the drift's level.
  // The height a drift coming from column `from` should run at to meet the vein's body: the middle
  // of the ore in the vein's first column of ore on that side (a vein slants and curls, so its
  // centre's height may be bare rock where the drift arrives).
  function veinRow(world, node, from) {
    const box = node.box;
    if (!box) return node.y;
    const dir = from < (box.x0 + box.x1) / 2 ? 1 : -1;
    for (let cx = dir > 0 ? box.x0 : box.x1; dir > 0 ? cx <= box.x1 : cx >= box.x0; cx += dir) {
      const rows = [];
      for (let y = box.y0; y <= box.y1; y += 1) if ((PW.get(world, cx, y) & 63) === M.ORE) rows.push(y);
      // (a column of a few cells is the vein's frayed tip; the body is where it runs thick)
      if (rows.length >= 4) return rows[rows.length >> 1];
    }
    return node.y;
  }
  function oreFace(world, node, x, dir, top, bottom) {
    for (let k = 0; k < 700; k += 1) {
      const cx = x + dir * k;
      for (let y = top; y <= bottom; y += 1) if ((PW.get(world, cx, y) & 63) === M.ORE) return cx - dir;
      if ((cx - node.x) * dir > node.radius + 40) break;
    }
    return node.x - dir * (node.radius + 6);
  }
  // Starter workings from the core pit down to the ore vein: shaft, drift and storage room. They
  // are a tunnel network rooted at the top of the shaft: dug raw (timbered), then developed into
  // reinforced concrete from the shaft head outward as the match goes on.
  function starterMine(world, core, node, dir, side) {
    // The shaft drops from a side of the pit - the nearer to the node that still leaves a drift's
    // length to the vein (never straight down onto it); the drift runs to the vein's face.
    const sides = [Math.round(core.pit.left + 60), Math.round(core.pit.right - 60)];
    const clear = sides.filter((x) => Math.abs(x - node.x) >= (node.radius || 60) + 40);
    const sx = (clear.length ? clear : sides).sort((a, b) => Math.abs(a - node.x) - Math.abs(b - node.x))[clear.length ? 0 : 1];
    const toward = Math.sign(node.x - sx) || dir;
    const pitFloor = core.ground + core.pit.depth;
    const driftBottom = veinRow(world, node, sx) + 20, driftTop = driftBottom - 44;
    const net = PW.tunnels.createNetwork(world, { side, x: sx, y: pitFloor - 2, building: core.id });
    PW.tunnels.digBox(world, net, sx - 15, pitFloor - 2, sx + 15, driftBottom, { kind: 'shaft' });
    const face = Math.sign(node.x - sx) || toward;
    const reach = oreFace(world, node, sx + face * 16, face, driftTop, driftBottom);
    const d0 = Math.min(sx, reach), d1 = Math.max(sx, reach);
    PW.tunnels.digBox(world, net, d0, driftTop, d1, driftBottom, { kind: 'drift' });
    // Storage room on the far side of the shaft from the node.
    const r0 = face > 0 ? sx - 190 : sx + 40, r1 = r0 + 150;
    PW.tunnels.digBox(world, net, Math.min(r0, sx), driftTop - 8, Math.max(r1, sx), driftBottom, { kind: 'room' });
    ladder(world, toward > 0 ? sx - 14 : sx + 3, pitFloor - 2, driftBottom - 1);
    return { network: net.id, shaft: { x: sx, top: pitFloor, bottom: driftBottom }, drift: { x0: d0, x1: d1, top: driftTop, bottom: driftBottom },
      storage: { x0: Math.min(r0, sx), x1: Math.max(r1, sx), top: driftTop - 8, bottom: driftBottom }, node };
  }
  // N11F: the miners push on from every mine - hallways of varying height and look that SERVE
  // as rooms (storage, pipe control, processing, an armoury, a mossy room, trash), dug just
  // beside the workings but always heading toward ore, and using caves as highways: break in
  // at the nearest reach, carry on from the cave's point nearest the next vein. N12F keeps the
  // headings honest: a body already worked sends the heading on to the next, or to a cave.
  // N36: the specialised rooms - each with a higher roof than the plain connecting drifts and
  // its own look (the user's subway / underground / mine-banner references).
  const HALL_ROOMS = [
    { kind: 'storage', h: 44, w: 130 }, { kind: 'pipes', h: 36, w: 100 }, { kind: 'processing', h: 42, w: 120 },
    // (N103: the armoury stands tall enough for a turret on its base - plate, head and a margin)
    { kind: 'armoury', h: 48, w: 110 }, { kind: 'mossy', h: 32, w: 95 },
    { kind: 'trash', h: 26, w: 90 },
    // (N108: the 'subliminal' room - its walls inked black round one white point - is gone: the user
    // kept meeting it as a black box with a white dot in the tunnels. A small pipe-control room takes
    // its turn, the same size - the workings' layout, and the world laid out after them, unchanged)
    { kind: 'pipes', h: 22, w: 70 },
  ];
  function furnishHallRoom(world, kind, x0, x1, floor, h, random, side = null, dir = 1) {
    const deco = (x, y, c) => { if ((PW.get(world, x, y) & 63) === M.AIR) PW.setLayer(world, 'deco', x, y, rgb(c)); };
    // Arch ribs up the walls and across the roof every so often (the underground-railroad and
    // Euston references): a darker band in the back wall that reads as the room's framing.
    {
      for (let x = x0 + 7; x < x1 - 4; x += 14) {
        for (let y = floor - h + 1; y <= floor; y += 1) {
          const nearRoof = y < floor - h + 4;
          const current = PW.getLayer(world, 'back', x, y);
          if (!current) continue;
          const c = PW.unpack(current);
          PW.setLayer(world, 'back', x, y, rgb([c[0] * 0.72 | 0, c[1] * 0.72 | 0, c[2] * 0.72 | 0]));
          if (nearRoof) {
            for (const dx of [-1, 1]) {
              const c2 = PW.getLayer(world, 'back', x + dx, y);
              if (c2) { const u = PW.unpack(c2); PW.setLayer(world, 'back', x + dx, y, rgb([u[0] * 0.82 | 0, u[1] * 0.82 | 0, u[2] * 0.82 | 0])); }
            }
          }
        }
      }
    }
    if (kind === 'processing') {
      // The crusher line (the mine-banner reference): a chute from the roof into two angled
      // screen decks, an ore bin under the lower end.
      const cx2 = Math.round((x0 + x1) / 2);
      for (let dy = 0; dy < Math.min(14, h - 12); dy += 1) {
        deco(cx2 - 2 + (dy & 1), floor - h + 2 + dy, [88, 92, 98]);
        deco(cx2 + 2 - (dy & 1), floor - h + 2 + dy, [70, 74, 80]);
      }
      for (let d = 0; d < 22; d += 1) {
        deco(cx2 - 14 + d, floor - 14 + (d >> 1), [120, 112, 92]);
        deco(cx2 - 10 + d, floor - 8 + (d >> 1) - (d & 1), [104, 96, 78]);
      }
      for (let dy = 0; dy < 7; dy += 1) for (let dx = 0; dx < 12; dx += 1) {
        deco(cx2 + 12 + dx, floor - 1 - dy, dy === 6 || dx === 0 || dx === 11 ? [80, 84, 90] : (dx + dy) % 4 ? [58, 50, 40] : [96, 76, 50]);
      }
    } else if (kind === 'mossy') {
      // The mossy hall: green growth hanging from the roof and creeping the walls, a damp
      // sheen along the floor (the user's overgrown-tunnel references).
      for (let x = x0 + 2; x < x1 - 1; x += 1) {
        const hng = (PW.hash2(x, floor) & 7);
        if (hng < 5) {
          for (let d = 0; d <= (hng & 3); d += 1) {
            const cur = PW.getLayer(world, 'back', x, floor - h + 1 + d);
            if (cur) PW.setLayer(world, 'back', x, floor - h + 1 + d, rgb([38 + (hng << 2), 84 + ((x * 7) % 24), 40]));
          }
          if ((PW.hash2(x, 3) & 3) === 0) deco(x, floor - h + 2 + (hng & 3), [52, 108, 54]);
        }
        if ((PW.hash2(x, 9) & 3) === 0) {
          const cur = PW.getLayer(world, 'back', x, floor);
          if (cur) PW.setLayer(world, 'back', x, floor, rgb([44, 92, 58]));
        }
      }
    }
    if (kind === 'storage') {
      for (let n = 0; n < 3; n += 1) {
        const bx = x0 + 18 + n * Math.round((x1 - x0 - 36) / 3) + random.int(-6, 6);
        for (let dy = 0; dy < 10; dy += 1) for (let dx = 0; dx < 14; dx += 1) {
          deco(bx + dx, floor - 1 - dy, dy === 9 || dx === 0 || dx === 13 ? [74, 60, 40] : (dx + dy) % 5 ? [108, 88, 58] : [90, 72, 48]);
        }
      }
    } else if (kind === 'pipes') {
      const px = Math.round((x0 + x1) / 2);
      for (let dy = 6; dy < h - 6; dy += 1) PW.setLayer(world, 'back', px, floor - dy, rgb([52, 56, 60]));
      for (const wx of [px - 14, px + 14]) {
        for (let a = 0; a < 12; a += 1) {
          const ang = a * Math.PI / 6;
          deco(wx + Math.round(Math.cos(ang) * 4), floor - 16 + Math.round(Math.sin(ang) * 4), [130, 136, 142]);
        }
        deco(wx, floor - 16, [10, 10, 12]);
      }
    } else if (kind === 'armoury') {
      for (let n = 0; n < 4; n += 1) {
        const ax = x0 + 16 + n * 18;
        for (let dy = 0; dy < 16; dy += 1) deco(ax, floor - 1 - dy, dy === 15 || dy === 0 ? [96, 100, 108] : [48, 50, 56]);
        deco(ax + 1, floor - 16, [96, 100, 108]);
      }
      // N103: a turret on its base in the armoury, at its far end, guarding the way in
      if (PW.mounts) PW.mounts.room(world, x0, x1, floor + 1, h, { side: side || 'neutral', style: (world.styles && world.styles[side]) || undefined,
        facing: -dir, near: dir > 0 ? x1 - 30 : x0 + 30 });
    } else if (kind === 'trash') {
      // (drawn junk, not loose cells: real debris in a raw tunnel would sit in cells the
      // development can never line, and the network would never count as whole)
      for (let n = 0; n < 5; n += 1) {
        const tx = x0 + 10 + random.int(0, Math.max(8, x1 - x0 - 26));
        const w = 5 + random.int(0, 7), hh = 2 + random.int(0, 3);
        for (let dy = 0; dy < hh; dy += 1) for (let dx = dy; dx < w - dy; dx += 1) {
          deco(tx + dx, floor - 1 - dy, (dx + dy) % 3 ? [74, 68, 58] : [96, 86, 66]);
        }
      }
    }
  }
  // N36/N31, from the mine cross-section references: levels connect by INCLINED galleries
  // with stairs, not only ladders. A stepped decline - two rows down per three columns, about
  // 34 degrees - dug as overlapping boxes so the development wave flows along it, timber
  // treads on its floor, climbable like a ladder. Returns the x where it reaches toY.
  function digIncline(world, net, fromX, fromY, toY, dir) {
    const CLEAR = 20;   // N37: the roof above the stairs stands higher than a drift's
    let x = fromX, y = fromY;
    while (y < toY) {
      const step = Math.min(2, toY - y);
      PW.tunnels.digBox(world, net, Math.min(x, x + dir * 4), y - CLEAR, Math.max(x, x + dir * 4), y + step, { kind: 'incline', keepOre: true });
      for (let d = 0; d <= 3; d += 1) {
        const tx = x + dir * d, ty = y + step;
        PW.setLayer(world, 'back', tx, ty, rgb(d === 0 ? [112, 86, 54] : [96, 74, 48]));
        PW.setFlag(world, tx, ty, FLAG.LADDER);
      }
      x += dir * 3; y += step;
    }
    return x;
  }
  function mineWorkings(world, layout, from, side, random) {
    if (!from || !from.network || !PW.tunnels) return;
    const net = PW.tunnels.state(world).networks[from.network - 1];
    if (!net) return;
    if (from.node) from.node.worked = (from.node.worked || 0) + 1;
    let wayX = from.drift ? Math.round((from.drift.x0 + from.drift.x1) / 2) : from.shaft.x;
    let wayY = from.drift ? from.drift.bottom : from.shaft.bottom;
    const targets = (layout.nodes || [])
      .filter((n) => n !== from.node && !n.worked && Math.abs(n.x - wayX) < 1600 && Math.abs(n.y - wayY) < 700
        && n.y > world.groundTop[Math.max(0, Math.min(world.width - 1, Math.round(n.x)))] + 260)
      .sort((p, q) => (Math.abs(p.x - wayX) + Math.abs(p.y - wayY) * 2) - (Math.abs(q.x - wayX) + Math.abs(q.y - wayY) * 2))
      .slice(0, 2);
    let roomIdx = (from.shaft ? from.shaft.x : 0) % HALL_ROOMS.length;
    // (N36: the growth plans - rooms and a deeper working level dug as the clock reaches them)
    const plans = world.minePlans || (world.minePlans = []);
    let planAt = PW.tunnels.state(world).time + 25 + ((from.shaft ? from.shaft.x : wayX) % 13);
    // No box of the workings may cut a cave's standing formations (columns, stalagmites - the
    // grounding rule): a leg or shaft that would clip one is clipped back instead.
    const clearOfProps = (x0, y0, x1, y1) => {
      let a = Math.min(x0, x1), b2 = Math.max(x0, x1);
      for (const p of world.props || []) {
        if (p.y1 < y0 - 2 || p.y0 > y1 + 2 || p.x1 < a - 2 || p.x0 > b2 + 2) continue;
        if (p.x0 > a) b2 = Math.min(b2, p.x0 - 4); else a = Math.max(a, p.x1 + 4);
      }
      return b2 - a > 20 ? [a, b2] : null;
    };
    // Returns the span really dug (clearOfProps may clip it), or null: the caller must walk on
    // from the DUG end, never past a gap - a leg started beyond a clipped one is an island the
    // development wave can never reach.
    const digLeg = (x0, y, x1, h, kind) => {
      const span = clearOfProps(x0, y - h + 1, x1, y);
      if (!span) return null;
      return PW.tunnels.digBox(world, net, span[0], y - h + 1, span[1], y, { kind, keepOre: true }).ok ? span : null;
    };
    for (const target of targets) {
      // A cave on the way is a highway: dig to its nearest reach, walk its open dark, carry on
      // from its point nearest the vein.
      let hop = null;
      for (const cave of layout.caves || []) {
        for (const p of cave.points) {
          const between = (p.x - wayX) * (target.x - wayX) > 0 && Math.abs(p.x - wayX) < Math.abs(target.x - wayX);
          if (!between || Math.abs(p.y - wayY) > 420) continue;
          if (!hop || Math.abs(p.x - wayX) < Math.abs(hop.in.x - wayX)) {
            const out = cave.points.reduce((b2, q) => Math.abs(q.x - target.x) + Math.abs(q.y - target.y) < Math.abs(b2.x - target.x) + Math.abs(b2.y - target.y) ? q : b2, p);
            hop = { in: p, out };
          }
        }
      }
      const stops = hop ? [{ x: Math.round(hop.in.x), y: Math.round(hop.in.y) }, { x: Math.round(hop.out.x), y: Math.round(hop.out.y), skipTo: true }, target] : [target];
      let guard = 0;
      for (const stop of stops) {
        if (stop.skipTo) {
          // Through the cave itself - and the next leg starts at the FAR wall, not among the
          // chamber's formations: the way walks on through open dark until rock closes in.
          const inX = wayX, inY = wayY;
          wayX = stop.x; wayY = stop.y;
          const on = Math.sign((stops[stops.length - 1].x || wayX) - wayX) || 1;
          for (let d = 0; d < 220; d += 1) {
            const id = PW.get(world, wayX + on, wayY - 10) & 63;
            if (id !== M.AIR || (PW.getFlags(world, wayX + on, wayY - 10) & FLAG.TUNNEL)) break;
            wayX += on;
          }
          // The highway is claimed as the miners' own walkway through the chamber (prop-guarded,
          // mostly open air already): without it the far side's halls are cut off from the
          // development wave and stay raw forever.
          // Dig ORDER is connectivity: a box only gets its development times from cells already
          // claimed when it is dug - so the entry leg first, the shaft off it, the far leg off
          // that. (The shaft-first version left permanently raw islands.)
          const wkA = digLeg(Math.min(inX, stop.x), inY, Math.max(inX, stop.x), 30, 'drift');
          if (Math.abs(stop.y - inY) > 16) {
            const sy0 = Math.min(inY, stop.y) - 2, sy1 = Math.max(inY, stop.y);
            PW.tunnels.digBox(world, net, stop.x - 12, sy0, stop.x + 12, sy1, { kind: 'shaft', keepOre: true });
            ladder(world, stop.x - 6, sy0, sy1 - 1);   // (N37: every shaft climbable on foot)
          }
          const wkB = digLeg(Math.min(stop.x, wayX), wayY, Math.max(stop.x, wayX), 30, 'drift');
          // (a clipped walkway cannot carry the development wave: nothing is dug beyond it)
          if (!wkA || !wkB || (wkB[1] < wayX && wayX > stop.x) || (wkB[0] > wayX && wayX < stop.x)) { guard = 99; break; }
          continue;
        }
        while (Math.abs(stop.x - wayX) > 60 && guard++ < 16) {
          const dir = Math.sign(stop.x - wayX) || 1;
          // The run first, the climb at its far end: a vertical dug beside the mine's own
          // surface shaft would widen that opening past what the pipe router can bridge, and
          // the line would dive seven hundred rows into the pit it tore open.
          let run = Math.max(70, Math.min(random.int(170, 260), Math.abs(stop.x - wayX) - 30));
          // A leg breaching a cave stops at the wall: the chamber beyond is the highway, and
          // its formations - columns, stalagmites, the standing dark - are left as they are.
          let breached = false;
          for (let d = 20; d <= run; d += 1) {
            const cx2 = wayX + dir * d;
            if ((PW.get(world, cx2, wayY - 10) & 63) === M.AIR && !(PW.getFlags(world, cx2, wayY - 10) & FLAG.TUNNEL)) { run = d + 2; breached = true; break; }
          }
          const h = 28;   // the default drift: simple and narrow, just clearance for a trooper (N36)
          const dug = digLeg(wayX, wayY, wayX + dir * run, h, 'drift');
          if (!dug) { guard = 99; break; }
          wayX = dir > 0 ? dug[1] : dug[0];
          if (breached) break;   // the wall is open: the cave carries the way from here
          const aimY = stop === target ? veinRow(world, target, wayX) + 10 : stop.y;
          const dy = Math.max(-60, Math.min(60, aimY - wayY));
          if (Math.abs(dy) > 16) {
            const yA = Math.min(wayY, wayY + dy) - 2, yB = Math.max(wayY, wayY + dy);
            // (a climb that would cut through anything standing - a cave's formations, the
            // mine's own crates on the floor above - waits for the next leg)
            const clips = (world.props || []).some((p) => !(p.x1 < wayX - 16 || p.x0 > wayX + 16 || p.y1 < yA - 4 || p.y0 > yB + 2));
            if (!clips) {
              PW.tunnels.digBox(world, net, wayX - 12, yA, wayX + 12, yB, { kind: 'shaft', keepOre: true });
              ladder(world, wayX - 6, yA, yB - 1);
              wayY += dy;
            }
          }
          if ((guard & 1) === 1 && stop === target) {
            // Every other leg widens into a room with a purpose - but not yet (N36): the
            // corridor is DRIVEN now, a plain narrow drift through the chamber site (so the
            // way runs on and the path's geometry is what it always was), and the widening
            // is planned: when the clock reaches it, the drift is dug out into the taller
            // room, raw and timbered, developed by the wave from the walls it grew from.
            const spec = HALL_ROOMS[roomIdx % HALL_ROOMS.length]; roomIdx += 1;
            const rw = spec.w + random.int(-12, 12);
            const corridor = digLeg(wayX, wayY, wayX + dir * rw, h, 'drift');
            if (corridor) {
              const [roomY, roomDir] = [wayY, dir];
              plans.push({ at: planAt, net: net.id, fn: () => {
                // (a chamber never widens up into the surface: fields, streets and the wild
                // above stay whole - a shallow stretch keeps its plain drift)
                let gt = 1e9;
                for (let x = corridor[0]; x <= corridor[1]; x += 10) gt = Math.min(gt, world.groundTop[Math.max(0, Math.min(world.width - 1, x))]);
                if (roomY - spec.h < gt + 36) return;
                const room = digLeg(corridor[0], roomY, corridor[1], spec.h, 'room');
                if (room) furnishHallRoom(world, spec.kind, room[0], room[1], roomY, spec.h, random, side, roomDir);
              } });
              planAt += 18;
              wayX = dir > 0 ? corridor[1] : corridor[0];
            }
          }
        }
      }
      if (guard >= 16) continue;
      // The last leg stops just short of the vein: the ore stands as the face, and if nobody
      // works this body yet an operation opens (N12F's cap decides inside).
      const dir = Math.sign(target.x - wayX) || 1;
      const face = oreFace(world, target, wayX, dir, wayY - 40, wayY);
      const dug = digLeg(wayX, wayY, face - dir, 40, 'drift');
      if (dug && PW.mining) PW.mining.afterDig(world, net, { x0: dug[0], y0: wayY - 39, x1: dug[1], y1: wayY });
      target.worked = (target.worked || 0) + 1;
      // N36: in time, a deeper working level opens under the face drift - reached by an
      // INCLINED stair gallery (the cross-section references: levels connect by declines,
      // not only ladders), a narrow drift running along the new level from its foot.
      if (dug) {
        const [bx2, by2, bd] = [Math.round((dug[0] + dug[1]) / 2), wayY, dir];
        plans.push({ at: planAt + 85 + ((bx2 % 7) * 6), net: net.id, fn: () => {
          const yA = by2 - 2, yB = by2 + 54;
          const dxTotal = Math.ceil((yB - by2) / 2) * 3 + 6;
          const ix0 = Math.min(bx2, bx2 + bd * dxTotal), ix1 = Math.max(bx2, bx2 + bd * dxTotal);
          const clips = (world.props || []).some((p) => !(p.x1 < ix0 - 4 || p.x0 > ix1 + 4 || p.y1 < yA - 4 || p.y0 > yB + 2));
          if (clips) return;
          const footX = digIncline(world, net, bx2, by2, yB, bd);
          digLeg(footX - bd * 6, yB, footX + bd * 170, 28, 'drift');
        } });
      }
    }
    plans.sort((a, b2) => a.at - b2.at);
  }
  // A mine headframe's own shaft: straight down to a nearby vein, or a short sump if none is near.
  function headframeShaft(world, mine, nodes, side) {
    const x = mine.shaft.x, top = mine.shaft.top;
    // (the nearest vein in reach of a drift: below the shaft's first 200 rows, within 800 columns.
    // A town's mine is sunk where there is ore: failing one in reach, there is a stringer vein a
    // short drift from the shaft.)
    let node = nodes.filter((n) => n.y > top + 200 && n.y < top + 1300 && Math.abs(n.x - x) < 800)
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
    if (!node && PW.oreStringer) {
      const random = PW.createRandom(PW.hash2(x, top));
      node = PW.oreStringer(world, x + (random() < 0.5 ? -1 : 1) * random.range(180, 300), top + random.range(320, 460), random);
      if (node) nodes.push(node);
    }
    const bottom = node ? veinRow(world, node, x) + 20 : top + 220;
    const net = PW.tunnels.createNetwork(world, { side, x, y: top, building: mine.id });
    PW.tunnels.digBox(world, net, x - 15, top, x + 15, bottom, { kind: 'shaft' });
    let drift = null;
    if (node) {
      const dir = Math.sign(node.x - x) || 1;
      const reach = oreFace(world, node, x + dir * 16, dir, bottom - 44, bottom);
      PW.tunnels.digBox(world, net, Math.min(x, reach), bottom - 44, Math.max(x, reach), bottom, { kind: 'drift' });
      drift = { x0: Math.min(x, reach), x1: Math.max(x, reach), top: bottom - 44, bottom };
    }
    ladder(world, x - 14, top, bottom - 1);
    return { network: net.id, x, top, bottom, node, shaft: { x, top, bottom }, drift };
  }

  // ---- Ground defences --------------------------------------------------------------------------------------
  // A sandbag wall (cover: it stops shots) on a levelled seat, then Czech hedgehogs and concertina
  // wire towards the enemy. Hedgehog feet and wire coils sit on the ground wherever it slopes.
  const STEEL = { lit: [118, 122, 128], base: [82, 86, 92], dark: [56, 58, 62] };
  function decoAir(world, x, y, color) {
    if ((PW.get(world, x, y) & 63) !== M.AIR) return false;
    PW.setLayer(world, 'deco', x, y, rgb(color));
    return true;
  }
  function beam(world, x0, y0, x1, y1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s += 1) {
      const x = Math.round(x0 + (x1 - x0) * s / n), y = Math.round(y0 + (y1 - y0) * s / n);
      decoAir(world, x, y, STEEL.lit);
      decoAir(world, x, y + 1, STEEL.dark);
    }
  }
  // Czech hedgehog, 1.3 m: two beams cross at the hub (the third is seen end-on), feet on the ground.
  function hedgehog(world, hx) {
    const footL = hx - 10, footR = hx + 10;
    const gL = world.groundTop[footL] - 1, gR = world.groundTop[footR] - 1;
    const hubY = Math.round((gL + gR) / 2) - 9;
    beam(world, footL, gL - 1, hx + Math.round((hx - footL) * 0.8), hubY + Math.round((hubY - gL) * 0.8));
    beam(world, footR, gR - 1, hx + Math.round((hx - footR) * 0.8), hubY + Math.round((hubY - gR) * 0.8));
    for (let dy = -2; dy <= 1; dy += 1) for (let dx = -2; dx <= 1; dx += 1) decoAir(world, hx + dx, hubY + dy, dy < 0 && dx < 0 ? STEEL.lit : STEEL.base);
    // Feet: the lowest cell of each beam rests on the ground.
    decoAir(world, footL, gL, STEEL.dark); decoAir(world, footR, gR, STEEL.dark);
    return { feet: [[footL, gL], [footR, gR]] };
  }
  // Concertina wire: overlapping coils (0.9 m) whose lowest point touches the ground, on stakes.
  function concertina(world, a, b) {
    const x0 = Math.min(a, b), x1 = Math.max(a, b);
    const touches = [];
    for (let cx = x0; cx <= x1; cx += 3) {
      const g = world.groundTop[cx] - 1;
      const cy = g - 6;
      for (let t = 0; t < 64; t += 1) {
        const angle = t / 64 * Math.PI * 2;
        decoAir(world, Math.round(cx + Math.cos(angle) * 4), Math.round(cy + Math.sin(angle) * 6), (t & 3) ? [110, 112, 118] : [150, 152, 156]);
      }
      touches.push([cx, g]);
      if ((cx - x0) % 24 === 0) for (let y = g; y >= g - 13; y -= 1) decoAir(world, cx, y, [96, 74, 48]);
    }
    return touches;
  }
  function groundDefences(world, x, dir, random, taken = () => false) {
    const wall = PW.props.sandbags(random, 5, 4);
    // Start clear of anything already built (a pump house, a field), then go only as far as dry
    // land does (the line stops at a lake shore).
    for (let shift = 0; shift < 240; shift += 1) {
      let free = true;
      for (let k = 0; k <= wall.width + 4 && free; k += 1) if (taken(x + dir * k)) free = false;
      if (free) break;
      x += dir;
    }
    // The sandbag wall's seat: a small emplacement dug into the first stretch of dry ground outward
    // that takes one - where the land in front of a town climbs too steeply for that, on the crest
    // above it (the line holds the high ground; it is never dug into a cliff).
    const dryAt = (k) => k >= 20 && k <= world.width - 20 && !taken(k) && (PW.get(world, k, world.groundTop[k]) & 63) !== M.WATER;
    let left = null, seat = null;
    for (let s = 0; s <= 400 && left === null; s += 4) {
      const l = dir > 0 ? x + s : x - s - wall.width;
      if (!dryAt(l - 2) || !dryAt(l + wall.width + 2)) { if (s > 0 && !dryAt(dir > 0 ? l : l + wall.width)) break; continue; }
      const y = medianGround(world, l - 2, l + wall.width + 2);
      if (padDepth(world, l - 2, l + wall.width + 2, y) <= PAD_DEPTH * 2) { left = l; seat = y; }
    }
    if (left === null) return null;
    x = dir > 0 ? left : left + wall.width;
    // From there the line runs on as far as dry land does (it stops at a lake shore), and not up a
    // mountainside: it stops where the land climbs steeper than about 35°.
    let reach = 0;
    while (reach < wall.width + 214) {
      const k = x + dir * reach;
      if (!dryAt(k)) break;
      if (reach > wall.width + 8 && Math.abs(world.groundTop[k] - world.groundTop[k - dir * 8]) > 5) break;
      reach += 1;
    }
    if (reach < wall.width + 4) return null;
    terracePad(world, left - 2, left + wall.width + 2, seat);
    const cover = PW.props.place(world, wall, left + wall.anchorX, seat, { kind: 'sandbags', setting: 'defence' });
    if (!cover) {
      const blockers = {};
      for (let k = left; k < left + wall.width; k += 1) for (let y = seat - wall.height; y < seat; y += 1) {
        const m = PW.get(world, k, y) & 63;
        if (m !== M.AIR) blockers[PW.mat.names[m]] = (blockers[PW.mat.names[m]] || 0) + 1;
      }
      world.defenceIssues = (world.defenceIssues || []).concat([{ x, dir, seat, blockers }]);
    }
    const hedgehogs = [];
    for (let k = 0; k < 3; k += 1) {
      const d = wall.width + 54 + k * 46;
      if (d + 12 < reach) hedgehogs.push(hedgehog(world, x + dir * d));
    }
    const wireFrom = x + dir * (wall.width + 18), wireTo = x + dir * Math.min(wall.width + 200, reach - 8);
    const wire = (wireTo - wireFrom) * dir > 12 ? concertina(world, wireFrom, wireTo) : [];
    const far = x + dir * Math.min(wall.width + 214, reach);
    return { cover, hedgehogs, wire, span: [Math.min(left, far), Math.max(left + wall.width, far)] };
  }

  // ---- Generation ------------------------------------------------------------------------------------------
  // (opts.homes false - N115's gameplay test: the two sides' home towns are not built, each side
  // places its own starting capital; the neutral towns are)
  function generateSettlements(world, layout, seed, opts = {}) {
    const random = PW.createRandom(seed + 4242);
    const styles = shuffleStyles(random);
    // (N118: the person's side in the aesthetic they chose - swapped with whichever side the dice gave
    // it, so the dice and the world they lay are the same either way)
    const want = opts.style;
    if (want && want.side && want.style && styles[want.side] !== want.style) {
      const holder = Object.keys(styles).find((k) => styles[k] === want.style);
      if (holder) { styles[holder] = styles[want.side]; styles[want.side] = want.style; }
    }
    world.styles = styles;
    world.buildings = [];
    world.settlements = [];
    const T = PW.buildingTypes;
    const make = (lot, style, facing, deviceFacing, index) => {
      const seedFor = seed + index * 977 + world.buildings.length * 31;
      if (lot.type === 'population') return T.population({ style, level: lot.level, variant: lot.variant, seed: seedFor, facing, deviceFacing });
      if (lot.type === 'military') return T.military({ style, level: lot.level, variant: lot.variant, seed: seedFor, facing, deviceFacing });
      if (lot.type === 'farm') return T.farm({ style, level: lot.level, variant: lot.variant, seed: seedFor, facing });
      if (lot.type === 'mine') return T.mine({ style, facing, seed: seedFor });
      return T.core({ style, facing });
    };
    for (const site of layout.sites) {
      const side = site.side;
      const style = styles[side];
      const padY = Math.round(site.level);
      const neutral = side === 'neutral';
      if (opts.homes === false && !neutral) continue;
      const dir = side === 'left' ? 1 : side === 'right' ? -1 : 0;
      const plan = neutral ? neutralPlan(random) : basePlan(random);
      // A neutral farm leads its town at the end with more ploughable land beyond it, where its
      // field has room to grow (not up a mountainside).
      if (neutral) {
        const f = plan.findIndex((lot) => lot.field);
        if (f >= 0 && ploughable(world, site.x1, 1, 500) > ploughable(world, site.x0, -1, 500)) plan.push(plan.splice(f, 1)[0]);
      }
      // Each base's buildings face the enemy (the right base is the left base's mirror image);
      // a farm with a field faces outward, where its crops grow. Neutral buildings are mixed,
      // with at least one facing each way.
      const mixed = plan.map(() => (random() < 0.5 ? -1 : 1));
      if (neutral) {
        const free = plan.map((lot, i) => (lot.field ? -1 : i)).filter((i) => i >= 0);
        if (free.every((i) => mixed[i] === mixed[free[0]])) mixed[free[free.length >> 1]] *= -1;
      }
      // Build canvases and measure the cluster.
      const lots = plan.map((lot, index) => {
        // (a neutral farm leads the cluster, so its field grows out to the left)
        const facing = lot.field ? (dir ? -dir : index === 0 ? -1 : 1) : (dir || mixed[index]);
        const canvas = make(lot, style, facing, neutral ? 0 : dir, index);
        // (a farm keeps open ground beside it for its yard and field to grow into; the machine
        // rows of the old per-resource lines are gone - the bundle connects through the cores)
        const plantW = lot.type === 'farm' ? 110 : 0;
        return { ...lot, facing, canvas, plantW, bodyWidth: canvas.body.right - canvas.body.left + 1 };
      });
      const gapFor = () => neutral ? random.int(8, 44) : random.int(24, 120);
      // A building's machines stand in the gap after it, in the order the lots are laid; the last
      // lot's (the front, with the runway beyond it) in the gap before it.
      const plantSpan = (edge, side, width) => ({ edge, side, x0: side > 0 ? edge + 1 : edge - width, x1: side > 0 ? edge + width : edge - 1 });
      // Place from the rear (bases) or centred (neutrals), dropping optional lots that don't fit.
      const runwayLength = 380;
      let total = lots.reduce((sum, lot) => sum + lot.bodyWidth + lot.plantW, 0) + 60 * (lots.length - 1);
      // (a base's runway lies on its own site, short of the wild land's mountains and lakes)
      const room = site.x1 - site.x0 - (neutral ? 40 : runwayLength + 60);
      while (total > room && lots.some((lot) => lot.optional)) {
        const index = lots.findIndex((lot) => lot.optional);
        total -= lots[index].bodyWidth + lots[index].plantW + 60;
        lots.splice(index, 1);
      }
      const placed = [];
      // Every town is set into the land as it is: no site is levelled flat. Each building stands
      // on its own base (its floor between the high and the low ground, cut and walled uphill, on a
      // stage downhill) and neighbours are spaced so their works never meet. A base is laid from
      // its rear towards the front; a neutral town is laid out once to measure it, then again
      // centred on its site.
      const relief = !!PW.foundations;
      if (relief) {
        const step = neutral ? 1 : dir;
        const gaps = lots.map(() => (neutral ? random.int(4, 16) : random.int(20, 80)));
        const lay = (start) => {
          const row = [];
          let cursor = start;
          lots.forEach((lot, index) => {
            const last = index === lots.length - 1;
            if (last) cursor += step * lot.plantW;
            // (the lot's near edge at the cursor; nudged on until its works clear the cursor)
            let x = step > 0 ? cursor - lot.canvas.body.left + 4 : cursor - lot.canvas.body.right - 4;
            let m = PW.foundations.measure(world, lot.canvas, x, style);
            for (let n = 0; n < 4 && m && (step > 0 ? m.left < cursor : m.right > cursor); n += 1) {
              x += step > 0 ? cursor - m.left : cursor - m.right;
              m = PW.foundations.measure(world, lot.canvas, x, style);
            }
            // (standing water, or land too steep for the building - only military buildings go
            // on mountainsides: the lot is left out here)
            if (!m || !PW.foundations.allows(world, lot.type, m.plan.x0, m.plan.x1).ok) { cursor += step * (lot.bodyWidth + gaps[index]); return; }
            const near = step > 0 ? m.left : m.right, far = step > 0 ? m.right : m.left;
            const plant = lot.plantW ? (last ? plantSpan(near, -step, lot.plantW) : plantSpan(far, step, lot.plantW)) : null;
            row.push({ lot, x, m, plant });
            cursor = (plant && !last ? (step > 0 ? plant.x1 : plant.x0) : far) + step * (1 + gaps[index]);
          });
          return row;
        };
        let start = dir > 0 ? site.x0 + 30 : site.x1 - 30;
        if (neutral) {
          const centre = Math.round((site.x0 + site.x1) / 2);
          const trial = lay(centre - Math.round(total / 2));
          const span = trial.length ? [trial[0].m.left, trial[trial.length - 1].m.right] : [centre, centre];
          let shift = centre - Math.round((span[0] + span[1]) / 2);
          // Keep dry land at both ends of the town for the defence lines (200 cells), and beyond the
          // farm for its field, a pump house and its intake on the shore and the line (420): the town
          // moves away from a lake that crowds one end, as far as the other end can spare.
          const wet = (x) => layout.lakes.some((lake) => lake.left !== undefined && x > lake.left - 30 && x < lake.right + 30);
          const dry = (from, out, limit) => { let d = 0; while (d < limit && !wet(from + out * d)) d += 1; return d; };
          const farm = trial.find((row) => row.lot.field);
          const need = (out) => (farm && farm.lot.facing === out ? 420 : 200);
          const roomL = dry(span[0] + shift, -1, 800) - need(-1), roomR = dry(span[1] + shift, 1, 800) - need(1);
          if (roomL < 0 && roomR > 0) shift += Math.min(-roomL, roomR);
          else if (roomR < 0 && roomL > 0) shift -= Math.min(-roomR, roomL);
          // ...and back from a mountain at either end: a lot there would need a retaining wall far
          // taller than the deepest cut, so the town keeps to the foot of the slope.
          // (it tries shifts either way, nearest first, and takes the first that keeps every lot out
          // of the water and off ground too steep for it, with both end walls in bounds; failing
          // that, the most lots placed, then the lowest walls)
          const WALL_OK = PW.foundations.CUT_MAX_HANGAR;
          let chosen = null;
          for (let n = 0; n <= 60 && !(chosen && chosen.ok); n += 1) {
            const s = shift + (n & 1 ? 1 : -1) * Math.ceil(n / 2) * 24;
            const r = lay(centre - Math.round(total / 2) + s);
            if (!r.length) continue;
            const tallest = Math.max(r[0].m.wall[-1], r[r.length - 1].m.wall[1]);
            const better = !chosen || r.length > chosen.count || (r.length === chosen.count && tallest < chosen.tallest);
            if (better) chosen = { s, tallest, count: r.length, ok: r.length === lots.length && tallest <= WALL_OK };
          }
          if (chosen) shift = chosen.s;
          start = centre - Math.round(total / 2) + shift;
        }
        let row = lay(start);
        if (!neutral) {
          // The front lot's runway must end on the base's own ground (within 60 of the site's end):
          // the gaps close up first, then optional lots are left out.
          const over = (r) => {
            if (!r.length) return 0;
            const m = r[r.length - 1].m, front = dir > 0 ? m.right + runwayLength : m.left - runwayLength;
            return dir > 0 ? front - (site.x1 + 60) : (site.x0 - 60) - front;
          };
          for (let n = 0; n < 6 && over(row) > 0; n += 1) {
            const optional = lots.findIndex((lot) => lot.optional);
            if (n > 0 && optional >= 0) { lots.splice(optional, 1); gaps.splice(optional, 1); }
            else for (let k = 0; k < gaps.length; k += 1) gaps[k] = Math.max(6, gaps[k] >> 1);
            row = lay(start);
          }
        }
        for (const { lot, x, plant } of row) {
          lot.canvasX = x;
          lot.plant = plant;
          lot.left = x + lot.canvas.body.left;
          lot.right = x + lot.canvas.body.right;
          placed.push(lot);
        }
      } else {
        let cursor = neutral ? Math.round((site.x0 + site.x1) / 2 - total / 2) : dir > 0 ? site.x0 + 30 : site.x1 - 30;
        const step = neutral ? 1 : dir;
        lots.forEach((lot, index) => {
          const { canvas } = lot;
          const last = index === lots.length - 1;
          // A farm's open strip lies on the side its field grows towards (its facing), so a farm
          // facing back into the row still has ground of its own; the last lot's lies before it.
          const stripFirst = lot.plantW > 0 && (last || lot.facing !== step);
          if (stripFirst) cursor += step * lot.plantW;
          const canvasX = step > 0 ? cursor - canvas.body.left : cursor - canvas.body.right;
          lot.canvasX = canvasX;
          lot.left = canvasX + canvas.body.left;
          lot.right = canvasX + canvas.body.right;
          const far = step > 0 ? lot.right : lot.left, near = step > 0 ? lot.left : lot.right;
          lot.plant = lot.plantW ? (stripFirst ? plantSpan(near, -step, lot.plantW) : plantSpan(far, step, lot.plantW)) : null;
          cursor = far + step * ((stripFirst ? 0 : lot.plantW) + gapFor());
          placed.push(lot);
        });
      }
      placed.sort((a, b) => a.left - b.left);
      // Each building placed with its own base (without the foundations, on one pad).
      const settlement = { side, style, padY, buildings: [], site };
      if (!relief) terracePad(world, placed[0].left - 50, placed[placed.length - 1].right + 50, padY);
      for (const lot of placed) {
        const id = world.buildings.length + 1;
        let stamp, base = null;
        if (relief) {
          const result = PW.foundations.place(world, lot.canvas, lot.canvasX, { style, owner: id });
          if (!result) continue;
          stamp = result.stamp;
          base = { G: result.plan.G, walls: result.walls, under: result.under, cores: result.cores };
          lot.works = result.works;
        } else {
          stamp = PW.stampBuilding(world, lot.canvas, lot.canvasX, padY, { owner: id });
          lot.works = [lot.left, lot.right];
        }
        const record = PW.buildingRecord(world, stamp, { id, side, style, type: lot.type, variant: lot.variant,
          level: lot.level || 1, facing: lot.facing, neutral, underConstruction: neutral, works: lot.works, base, plant: lot.plant || null });
        world.buildings.push(record);
        settlement.buildings.push(record);
      }
      // Each building's machines get a level pad of their own, at the middle height of the ground
      // they stand on - where that takes no more than a shallow cut or fill; on steeper ground their
      // plinths are built up under them instead.
      if (relief) {
        for (const b of settlement.buildings) {
          if (!b.plant) continue;
          const rows = [];
          for (let x = b.plant.x0; x <= b.plant.x1; x += 1) if (!PW.getOwner(world, x, world.groundTop[x])) rows.push(world.groundTop[x]);
          if (!rows.length) continue;
          rows.sort((p, q) => p - q);
          const y = rows[rows.length >> 1];
          if (rows[rows.length - 1] - y <= PAD_DEPTH && y - rows[0] <= PAD_DEPTH) terracePad(world, b.plant.x0, b.plant.x1, y);
        }
      }
      // The street runs 50 cells past the end buildings - but a farm's ground is field, never road:
      // the street stops at a farm that ends the town, and leaves out a farm's lot inside it.
      const ends = settlement.buildings, first = ends[0], last = ends[ends.length - 1];
      const farms = settlement.buildings.filter((b) => b.type === 'farm');
      // (a farm's ground is field, never road: its lot, and the open strip its field grows into)
      const onFarm = (x) => farms.some((b) => (x >= b.works[0] - 2 && x <= b.works[1] + 2)
        || (b.plant && x >= Math.min(b.plant.x0, b.plant.x1) - 2 && x <= Math.max(b.plant.x0, b.plant.x1) + 2));
      const streetLeft = settlement.streetLeft = first.type === 'farm' ? first.works[1] + 3 : first.works[0] - 50;
      const streetRight = settlement.streetRight = last.type === 'farm' ? last.works[0] - 3 : last.works[1] + 50;
      // Streets through the ground floors (style paving) and the runway. In a neutral town the
      // street follows the ground between the buildings' bases (which have their own paving,
      // stages and steps) and runs through each ground floor.
      const streetAt = (x) => {
        if (onFarm(x)) return null;
        if (!relief) return padY;
        for (const b of settlement.buildings) {
          if (x >= b.body.left && x <= b.body.right) return b.ground;
          if (x >= b.works[0] && x <= b.works[1]) return null;
        }
        return world.groundTop[x];
      };
      settlement.streetAt = streetAt;
      paveStreet(world, streetLeft, streetRight, streetAt, () => style);
      // Each farm's own lot is field (under and around its buildings, its yard among the crops).
      for (const b of farms) b.lotField = sowField(world, b.works[0], b.works[1], b.ground, random);
      // The runway is graded level with its hangar's floor (a runway is the one strip that is).
      for (const b of settlement.buildings) {
        if (b.type !== 'military' || !b.runway || neutral) continue;
        const end = b.runway.from + b.runway.direction * runwayLength, runY = relief ? b.ground : padY;
        terracePad(world, Math.min(b.runway.from, end), Math.max(b.runway.from, end), runY);
        paveRunway(world, b.runway.from, b.runway.direction, runwayLength, runY, style);
        settlement.runway = { from: b.runway.from, to: end, y: runY };
      }
      // Everything laid on the surface, so wild growth keeps clear of it.
      const footprints = settlement.footprints = [[streetLeft, streetRight], ...farms.map((b) => [b.works[0], b.works[1]])];
      if (settlement.runway) footprints.push([Math.min(settlement.runway.from, settlement.runway.to), Math.max(settlement.runway.from, settlement.runway.to)]);
      // Farm fields on the farm's outward side (stopping short of any water), and a pump at the
      // nearest lake.
      const wetAt = (x) => layout.lakes.some((lake) => lake.left !== undefined && x > lake.left - 30 && x < lake.right + 30);
      for (const b of settlement.buildings.filter((item) => item.type === 'farm')) {
        const lot = placed.find((item) => item.canvas === b.canvas);
        if (!lot) continue;
        const outward = b.facing;
        // (on a flat base the field carries straight on from the lot; on rolling ground it is its
        // own terrace a little way off)
        const gap = relief ? 14 : 1;
        const start = outward > 0 ? b.works[1] + gap : b.works[0] - gap;
        // (the farm's own yard takes the first stretch of its land, before the field; a farm
        // without a leading field of its own still ploughs the open strip it was given)
        let length = lot.field ? (neutral ? 110 : 150) : 90;
        for (let d = 0; d <= length; d += 1) {
          const x = start + outward * d;
          // (it stops short of the shore: the lake guards a town on that side)
          if (x < 40 || x > world.width - 40 || wetAt(x)) { length = d - 1; break; }
        }
        // The field follows the lie of the land, ploughed along the slope as fields on rolling
        // ground are: its surface is only eased of bumps and notches (a running mean over 13
        // columns), and it reaches out only as far as the land stays gentle enough to plough
        // (about 1 in 2) - it stops short where the land climbs or falls away.
        length = Math.min(length, ploughable(world, start, outward, length));
        if (length >= 60) {
          const x0 = Math.min(start, start + outward * length), x1 = Math.max(start, start + outward * length);
          const ys = new Int32Array(x1 - x0 + 1);
          for (let x = x0; x <= x1; x += 1) {
            let sum = 0;
            for (let k = -6; k <= 6; k += 1) sum += world.groundTop[x + k];
            ys[x - x0] = Math.round(sum / 13);
          }
          for (let x = x0; x <= x1; x += 1) shapeColumn(world, x, ys[x - x0], true);
          b.field = sowField(world, x0, x1, (x) => world.groundTop[x], random);
          footprints.push([x0, x1]);
        }
        const lake = layout.lakes.filter((item) => item.left !== undefined)
          .sort((p, q) => Math.abs(p.x - b.body.left) - Math.abs(q.x - b.body.left))[0];
        // N62: only one water pump per body of water - the first farm to reach a lake builds
        // THE pump (with its own small core, N50); every later farm shares the water through
        // the bundle instead of sinking a second chamber under the same basin. The strip a
        // second pump WOULD have taken stays reserved all the same, so the wild growth grows
        // the same world it always did (its serial stream reshuffled the whole map's trees
        // otherwise, and one such reshuffle left a flood eroding forever on seed 7).
        if (lake && Math.abs(lake.x - b.body.left) < 2200) {
          const inUse = (spans) => (x) => spans.some(([a, c]) => x >= a - 8 && x <= c + 8);
          const taken = (x) => inUse(footprints)(x) || world.settlements.some((s) => inUse(s.footprints || [])(x));
          if (lake.pumpOwner) {
            const site = pumpSite(world, lake, b.body.left, taken);
            if (site) footprints.push([site.left, site.right]);
          } else {
            b.pump = lakePump(world, lake, b.body.left, style, b.id, taken);
            if (b.pump) lake.pumpOwner = b.id;
          }
          if (b.pump) {
            footprints.push(b.pump.span);
            // N50: the pump's own small core joins the farm's cores (orb: it minds itself in
            // its pocket, no rise). The pump's print is captured by capturePumpPrints at the
            // END of generation - the pipes and the made ground rework cells in this box
            // after settlements, and a print taken now would fight them (the seed-3 stall:
            // repair burned the town's HM "mending" the pump into its pre-pipes shape).
            b.cores.push({ x: b.pump.core.x, y: b.pump.core.y, kind: 'pump', orb: true, small: true });
          }
        }
      }
      // Base workings: starter shaft from the core pit to the starter node; neutral mine shafts.
      // Both are furnished with cover (mine cars on rails, drums, crates, sandbags...).
      const core = settlement.buildings.find((item) => item.type === 'core');
      if (core) {
        const node = layout.nodes.find((n) => n.starter === side) || layout.nodes.slice().sort((p, q) => Math.abs(p.x - core.body.left) - Math.abs(q.x - core.body.left))[0];
        core.mine = starterMine(world, core, node, dir || 1, side);
        core.mine.props = PW.props.furnishMine(world, core.mine, random);
        if (PW.mining) core.mine.operation = PW.mining.openFromWorkings(world, core.mine, side);
        mineWorkings(world, layout, core.mine, side, random);
        settlement.core = core;
      }
      for (const mine of settlement.buildings.filter((item) => item.type === 'mine')) {
        mine.workings = headframeShaft(world, mine, layout.nodes, side);
        mine.workings.props = PW.props.furnishMine(world, mine.workings, random);
        if (PW.mining) mine.workings.operation = PW.mining.openFromWorkings(world, mine.workings, side);
        mineWorkings(world, layout, mine.workings, side, random);
      }
      // Ground defences beyond the front of each base (past the runway's end); neutrals guard both
      // ends of their street.
      settlement.defences = [];
      // (past the whole town: its street, and any farm and field at its ends)
      const extent = [streetLeft, streetRight, ...settlement.buildings.flatMap((b) => [b.works[0], b.works[1]]),
        ...settlement.buildings.flatMap((b) => [b.field, b.lotField]).filter(Boolean).flatMap((f) => [f.x0, f.x1])];
      const front = (d) => {
        if (settlement.runway && d === dir) return d > 0 ? Math.max(settlement.runway.from, settlement.runway.to) + 40 : Math.min(settlement.runway.from, settlement.runway.to) - 40;
        return d > 0 ? Math.max(...extent) + 40 : Math.min(...extent) - 40;
      };
      const builtOn = (x) => [footprints, ...world.settlements.map((s) => s.footprints || [])]
        .some((spans) => spans.some(([a, c]) => x >= a - 6 && x <= c + 6));
      for (const d of neutral ? [-1, 1] : [dir]) {
        const start = front(d);
        // The line's own street end is where it starts, so only other works count as taken.
        const line = groundDefences(world, start, d, random, (x) => (x - start) * d > 0 && builtOn(x) && !(x >= streetLeft && x <= streetRight));
        if (!line) continue;
        settlement.defences.push(line);
        footprints.push(line.span);
      }
      world.settlements.push(settlement);
    }
    mountainOutposts(world, layout, seed, styles);
    if (PW.generateDistricts) PW.generateDistricts(world, seed);
    return world.settlements;
  }

  // ---- Military on the mountains ---------------------------------------------------------------------
  // Each base garrisons the high ground of its own half: the tallest massifs carry an outpost
  // blockhouse on a bench cut into the summit, on stepped foundations down to the rock, with
  // HESCO gabion walls on the terraces (the mountain-fortress and HESCO refs). The middle of the
  // map belongs to no one, and its summits stay bare. Outposts are not settlements: no street, no
  // pipes, no made ground - a garrison holds a rock.
  function mountainOutposts(world, layout, seed, styles) {
    const random = PW.createRandom(seed + 7171);
    const W = world.width, centre = W / 2;
    world.outposts = [];
    const T = PW.buildingTypes;
    const nearSite = (x) => layout.sites.some((s) => x > s.x0 - 500 && x < s.x1 + 500);
    const candidates = layout.mountains
      .filter((m) => m.height >= 430 && !nearSite(m.x) && Math.abs(m.x - centre) > W * 0.06)
      .sort((a, b) => b.height - a.height);
    for (const m of candidates) {
      const side = m.x < centre ? 'left' : 'right';
      // Tallest first, until each side holds two summits; a peak too sheer even for terraces is
      // passed over for the next, and only built outposts keep others at a distance.
      if (world.outposts.filter((p) => p.side === side).length >= 2) continue;
      if (world.outposts.some((p) => Math.abs(p.summit - m.x) < 1600)) continue;
      const style = styles[side];
      const facing = side === 'left' ? 1 : -1;
      const id = world.buildings.length + 1;
      const canvas = T.military({ style, level: 3, variant: 'outpost', seed: seed + id * 613, facing, deviceFacing: facing });
      // The summit itself (the massif's highest column near the main peak), cut down to a bench
      // wide enough for the blockhouse and a walk around it.
      let summit = Math.round(m.x);
      const span = Math.max(60, Math.round(m.half * 0.3));
      for (let x = Math.round(m.x) - span; x <= Math.round(m.x) + span; x += 1) {
        if (x > 2 && x < W - 3 && world.groundTop[x] < world.groundTop[summit]) summit = x;
      }
      const half = Math.ceil((canvas.body.right - canvas.body.left) / 2) + 16;
      // The bench is cut at least 56 into the summit (C2: the base sits IN the mountain, rock
      // shoulders rising either side of it) - deeper on a sheer crag, so its edges need no more
      // build-up than solid terraces can give; a peak that would need more than a 104-cell cut
      // is left to the next candidate.
      let benchMax = 0;
      for (let x = summit - half; x <= summit + half; x += 1) benchMax = Math.max(benchMax, world.groundTop[x]);
      const Y = Math.max(world.groundTop[summit] + 56, benchMax - 100);
      if (Y - world.groundTop[summit] > 104) continue;
      const terrace = PW.foundations.rockTerrace(world, summit - half, summit + half, Y, style, id);
      if (!terrace) continue;
      const canvasX = summit - Math.round((canvas.body.left + canvas.body.right) / 2);
      const result = PW.foundations.place(world, canvas, canvasX, { style, owner: id });
      if (!result) continue;
      const record = PW.buildingRecord(world, result.stamp, { id, side, style, type: 'military', variant: 'outpost',
        level: 3, facing, neutral: false, underConstruction: false, works: [terrace.x0, terrace.x1], plant: null,
        base: { G: result.plan.G, walls: result.walls, under: result.under, cores: result.cores } });
      world.buildings.push(record);
      // HESCO gabions on the terraces: a basket on each tread past the first (clear of the walls
      // and doors), so the steps carry a broken defensive wall down both flanks.
      for (const tread of terrace.treads) if (Math.abs(tread.x - summit) > half + 20) hesco(world, tread, style, random);
      const works = mountainWorks(world, summit, half, Y, id, facing, record.cores.map((q) => q.x));
      world.outposts.push({ side, style, building: record, terrace, summit,
        footprints: [[terrace.x0 - 10, terrace.x1 + 10], ...works.footprints] });
    }
  }
  // C2 (your update): the base is IN the mountain, not perched on it. Under the bench two
  // galleries are carved into the massif, Maginot-fashion - command over stores - joined by a
  // ladder shaft that runs on down to a junction stub for the tunnels (step H). A portal with a
  // cast concrete frame opens on the home flank for resupply, embrasure slits look out over the
  // enemy side, and the crown of the summit round the works is lined with reinforcement that
  // follows the mountain's own shape.
  const REINF = [96, 104, 100], REINF_DARK = [74, 80, 78], REINF_LIT = [122, 130, 124];
  function mountainWorks(world, summit, half, Y, id, facing, coreXs = []) {
    const footprints = [];
    const armour = (x, y, edge, stud) => {
      PW.set(world, x, y, M.REINFORCED, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(edge ? REINF_DARK : stud ? REINF_LIT : REINF));
      PW.setLayer(world, 'deco', x, y, 0);
      PW.setOwner(world, x, y, id);
    };
    const rock = (x, y) => { const d = PW.get(world, x, y) & 63; return d !== M.AIR && d !== M.WATER && PW.mat.ground[d]; };
    // The two galleries inside the massif, and the reinforced shell round each. A gallery takes
    // only the rock that is really there: its span is clamped to the columns with solid cover
    // over the shell (a narrow crag pushes it deeper and narrower rather than poking its ring
    // out of the mountainside).
    const clamp = (g) => {
      let x0 = g.x0, x1 = g.x1;
      const covered = (x) => world.groundTop[x] <= g.y0 - 14;
      while (x0 < x1 && !covered(x0)) x0 += 1;
      while (x1 > x0 && !covered(x1)) x1 -= 1;
      if (x1 - x0 < 50) return null;
      return { x0, x1, y0: g.y0, y1: g.y1 };
    };
    // (48 below the bench: the blockhouse's beds and vaults - and the bundle through their
    // connectors - sit whole above the command gallery's ceiling, nothing cut off)
    const g1 = clamp({ x0: summit - half + 6, x1: summit + half - 6, y0: Y + 48, y1: Y + 88 })
      || clamp({ x0: summit - half + 6, x1: summit + half - 6, y0: Y + 78, y1: Y + 118 });
    if (!g1) return { footprints, galleries: [], shaft: null };
    const g2 = clamp({ x0: summit - half + 16, x1: summit + half - 2, y0: g1.y1 + 26, y1: g1.y1 + 66 });
    for (const g of [g1, g2]) {
      if (!g) continue;
      PW.bunkers.reinforce(world, g.x0 - 4, g.y0 - 4, g.x1 + 4, g.y1 + 4, id);
      carveBox(world, g.x0, g.y0, g.x1, g.y1, id, 4);
      tunnelLamps(world, g.x0, g.x1, g.y0 + 2, 48);
    }
    // The ladder shaft: bench to command, command to stores, and on down to the tunnels' stub.
    // It keeps clear of every core (the user's note: nothing cuts a bed off) - candidates are
    // tried until one stands at least 20 from each, inside the command gallery's span.
    let shaftX = summit - facing * Math.round(half * 0.45);
    for (const f of [0.45, 0.25, 0.62, 0.08, -0.18, -0.4]) {
      const cand = Math.max(g1.x0 + 10, Math.min(g1.x1 - 10, summit - facing * Math.round(half * f)));
      if (coreXs.every((cx) => Math.abs(cand - cx) >= 20)) { shaftX = cand; break; }
    }
    const shaftBottom = g2.y1 + 50;
    // N35: the shaft is lined and its junction stub is a carved, lit chamber - built works in
    // the tunnel-lab language, never a black cut the eye reads as severed core matter.
    PW.bunkers.reinforce(world, shaftX - 7, Y - S.DOOR_H, shaftX + 7, shaftBottom + 26, id);
    for (let y = Y - S.DOOR_H; y <= shaftBottom; y += 1) {
      for (let dx = -7; dx <= 7; dx += 1) {
        if (PW.get(world, shaftX + dx, y) & 63) PW.set(world, shaftX + dx, y, M.AIR, { quiet: true });
        const tk = Math.abs(dx) >= 6 ? 0.62 : 0.78;
        PW.setLayer(world, 'back', shaftX + dx, y, rgb([TUNNEL.back[0] * tk | 0, TUNNEL.back[1] * tk | 0, TUNNEL.back[2] * tk | 0]));
        PW.setLayer(world, 'deco', shaftX + dx, y, 0);
      }
    }
    ladder(world, shaftX - 6, Y - S.DOOR_H + 4, shaftBottom - 2);
    carveBox(world, shaftX - 16, shaftBottom + 2, shaftX + 16, shaftBottom + 24, id, 4);
    tunnelLamps(world, shaftX - 16, shaftX + 16, shaftBottom + 4, 64);
    PW.setFlag(world, shaftX, shaftBottom + 12, FLAG.TUNNEL);
    // The portal on the home flank: cut from the command gallery out to daylight, then the cast
    // concrete frame round the mouth (the Cheyenne portal of your refs).
    const px = facing > 0 ? g1.x0 : g1.x1;
    const portal = PW.bunkers.cutOpening(world, px - facing, g1.y1 - 16, -facing, 0, 15, 140, id);
    if (portal) {
      const mouth = facing > 0 ? portal.x0 : portal.x1;
      for (let d = 0; d < 4; d += 1) {
        const x = mouth - facing * d;
        for (let k = -20; k <= 20; k += 1) {
          const y = g1.y1 - 16 + k;
          const rim = Math.abs(k) > 15;
          if (!rim && d > 0) continue;
          if (rock(x, y) || rim) armour(x, y, d === 3 || Math.abs(k) === 20, (k & 7) === 0);
        }
      }
      footprints.push([Math.min(mouth, px) - 4, Math.max(mouth, px) + 4]);
    }
    // (N32 REMOVED by the user: the embrasure slits that climbed from the command
    // gallery to the face are gone - no shoot-out openings on mountain bases. The
    // resupply PORTAL above stays: it is an entrance, and entrances stay.)
    // The crown armoured along the mountain's own shape: the rock face round the works, from
    // shoulder to shoulder, lined five deep wherever it is not already the base's own work. At
    // either end the lining tapers out and breaks up into the bare rock (no hard seam).
    const a0 = summit - half - 24, a1 = summit + half + 24;
    for (let x = a0; x <= a1; x += 1) {
      const s = world.groundTop[x];
      if (s >= g1.y0 - 2) continue;
      if (PW.getOwner(world, x, s + 1)) continue;
      const end = Math.min(x - a0, a1 - x);
      const depth = end >= 16 ? 5 : 1 + ((end * 4 / 16) | 0);
      for (let d = 1; d <= depth; d += 1) {
        const y = s + d;
        if (!rock(x, y) || PW.getOwner(world, x, y)) continue;
        if (end < 16 && (PW.hash2(x >> 2, d) & 7) < 3) continue;   // ragged where it runs out (in clumps, no speckle)
        armour(x, y, d === depth, (x & 7) === 0 && (y & 7) === 0);
      }
    }
    // N79: the blockhouse BEARS. The gallery carve runs under the fort, and its ceiling
    // lining sat a few rows below the plinth - the whole keep hung on static building
    // cells over an air seam (the user's floating-spawn bug class). Underpin every short
    // gap between the fort's lowest cell and the first solid below with its own masonry:
    // the piers between galleries carry it, the gallery spans themselves stay open rooms.
    const fort = world.buildings[id - 1];
    if (fort && fort.body) {
      for (let x = fort.body.left - 2; x <= fort.body.right + 2; x += 1) {
        let base = -1;
        for (let y = fort.ground + 40; y >= fort.body.top; y -= 1) {
          if (PW.getOwner(world, x, y) === id && (PW.get(world, x, y) & 63) !== 0) { base = y; break; }
        }
        if (base < 0) continue;
        let gap = 0, bore = false;
        while (gap < 9 && (PW.get(world, x, base + 1 + gap) & 63) === 0) {
          // N83: an open cell flagged HOLLOW is the supply bundle's carved lane, not a
          // seam to pack - the fort spans the bundle like any other room.
          if (PW.getFlags(world, x, base + 1 + gap) & PW.FLAG.HOLLOW) { bore = true; break; }
          gap += 1;
        }
        if (bore || gap === 0 || gap >= 9) continue;   // seated, bore below, or spanning a room by design
        for (let g = 1; g <= gap; g += 1) {
          PW.set(world, x, base + g, M.MASONRY, { quiet: true });
          PW.setOwner(world, x, base + g, id);
          PW.setLayer(world, 'paint', x, base + g, rgb([74 - g * 3, 76 - g * 3, 80 - g * 3]));
        }
      }
    }
    return { footprints, galleries: [g1, g2], shaft: { x: shaftX, top: Y, bottom: shaftBottom } };
  }
  // A HESCO gabion on a terrace tread: a wire basket of ballast, drawn as a sand-coloured block
  // with the mesh as a dark grid over its face and a folded steel lip along the top. (Solid as a
  // foundation: the mesh is what keeps a basket of sand standing.)
  const HESCO_W = 12, HESCO_H = 12;
  function hesco(world, tread, style, random) {
    const x0 = tread.side > 0 ? tread.x - HESCO_W + 1 : tread.x;
    const sandy = [172 - random.int(0, 14), 152 - random.int(0, 12), 110 - random.int(0, 10)];
    for (let x = x0; x < x0 + HESCO_W; x += 1) {
      for (let y = tread.y - HESCO_H; y < tread.y; y += 1) {
        const mesh = (x - x0) % 4 === 0 || (tread.y - y) % 4 === 1;
        const lip = y === tread.y - HESCO_H;
        const c = lip ? [88, 92, 96] : mesh ? [96, 86, 62] : sandy;
        PW.set(world, x, y, M.FOUNDATION, { quiet: true });
        PW.setLayer(world, 'paint', x, y, rgb(c));
      }
    }
  }

  PW.generateSettlements = generateSettlements;
  PW.capturePumpPrints = capturePumpPrints;
  PW.settlementTools = { terracePad, paveStreet, paveRunway, carveBox, ladder, tunnelLamps, sowField, drawCrop, recountField, fieldY, TUNNEL, PAVING, PAD_DEPTH };
})();
