'use strict';
// Settlements: the two bases and three neutral clusters, placed on terraced pads that blend into
// the terrain, with streets through the ground floors, runways, farm fields, pumps, starter mine
// tunnels down to the ore nodes and ground defences facing the enemy.
(function () {
  const PW = window.PW;
  const { M, FLAG } = PW;
  const K = PW.buildingKit;
  const { tone, mix } = K;
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
      if (sown) field.columns += 1;
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
  function lakePump(world, lake, towardX, style, owner, taken = () => false) {
    const near = towardX < lake.x ? -1 : 1, shore = near < 0 ? lake.left : lake.right;
    const bedAt = (x) => PW.supportBelow(world, x, world.groundTop[x], true);
    const wetAt = (x) => (PW.get(world, x, world.groundTop[x]) & 63) === M.WATER;
    const reach = CHAMBER.half + CHAMBER.wall;
    // Where: wholly under the lake floor, where the floor over it is gentle, nearest the farm's
    // shore (under the deepest spot, if the floor is uneven everywhere).
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
    const cx = at.x;
    const put = (x, y, id, color) => {
      PW.set(world, x, y, id, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
      PW.setOwner(world, x, y, owner);
    };
    const { half, height, wall, cover } = CHAMBER;
    // Rows: the roof slab under `cover` rows of ground below the lowest bed point, the chamber, its
    // floor slab.
    const roof = at.low + cover, top = roof + wall, floor = top + height - 1;
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
    const left = cx - half - wall, right = cx + half + wall;
    return { x: outX, y: floor + 1, left, right, lake, intakeX: cx, chamber: { x0: cx - half, x1: cx + half, top, floor },
      span: [left, right] };
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
  function generateSettlements(world, layout, seed) {
    const random = PW.createRandom(seed + 4242);
    const styles = shuffleStyles(random);
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
        if (lake && Math.abs(lake.x - b.body.left) < 2200) {
          const inUse = (spans) => (x) => spans.some(([a, c]) => x >= a - 8 && x <= c + 8);
          const taken = (x) => inUse(footprints)(x) || world.settlements.some((s) => inUse(s.footprints || [])(x));
          b.pump = lakePump(world, lake, b.body.left, style, b.id, taken);
          if (b.pump) footprints.push(b.pump.span);
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
        settlement.core = core;
      }
      for (const mine of settlement.buildings.filter((item) => item.type === 'mine')) {
        mine.workings = headframeShaft(world, mine, layout.nodes, side);
        mine.workings.props = PW.props.furnishMine(world, mine.workings, random);
        if (PW.mining) mine.workings.operation = PW.mining.openFromWorkings(world, mine.workings, side);
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
      // The bench is cut at least 44 into the summit - deeper on a sheer crag, so its edges need
      // no more build-up than solid terraces can give; a peak that would need more than a 90-cell
      // cut is left to the next candidate.
      let benchMax = 0;
      for (let x = summit - half; x <= summit + half; x += 1) benchMax = Math.max(benchMax, world.groundTop[x]);
      const Y = Math.max(world.groundTop[summit] + 44, benchMax - 100);
      if (Y - world.groundTop[summit] > 90) continue;
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
      world.outposts.push({ side, style, building: record, terrace, summit,
        footprints: [[terrace.x0 - 10, terrace.x1 + 10]] });
    }
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
  PW.settlementTools = { terracePad, paveStreet, carveBox, ladder, tunnelLamps, drawCrop, recountField, fieldY, TUNNEL, PAVING, PAD_DEPTH };
})();
