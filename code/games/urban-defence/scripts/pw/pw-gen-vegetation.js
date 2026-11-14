'use strict';
// Vegetation drawn cell by cell into the deco layer: branching broadleaf trees, conifers, birches,
// bushes, dead trees, reeds, boulders, grass tufts and flowers. Deco never blocks units.
//
// Every plant is generated against the ground it stands on: a generator gets ground(dx), the row
// of the surface at each column relative to the anchor (positive = lower), so roots reach down a
// slope, bushes hug it, boulders settle into it and reeds rise from the lake bed. Stamping never
// draws over solid cells, so nothing floats above the terrain or covers it.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;

  const rgb = (r, g, b) => PW.abgr(r, g, b);
  const LEAF = { deep: [26, 46, 28], shadow: [36, 64, 34], base: [52, 90, 44], light: [74, 118, 56], high: [98, 142, 70] };
  const NEEDLE = { deep: [20, 40, 32], shadow: [28, 54, 40], base: [40, 76, 52], light: [58, 100, 64], high: [80, 124, 78] };
  const BIRCH_LEAF = { deep: [42, 66, 30], shadow: [58, 88, 38], base: [80, 116, 48], light: [104, 140, 60], high: [128, 164, 74] };
  const BARK = { dark: [44, 34, 26], base: [70, 53, 38], light: [94, 72, 51] };
  const DEAD_BARK = { dark: [52, 46, 42], base: [84, 76, 68], light: [112, 102, 92] };
  const BIRCH_FOOT = { dark: [36, 34, 32], base: [92, 88, 82], light: [132, 128, 120] };
  const shadeColor = (rgbArray, k) => rgb(Math.min(255, rgbArray[0] * k | 0), Math.min(255, rgbArray[1] * k | 0), Math.min(255, rgbArray[2] * k | 0));
  const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ---- Ground under a plant ------------------------------------------------------------------------
  const FLAT = Object.assign(() => 0, { surface: () => 0 });
  const MIN_COVER_ROCKS = 4;   // trooper-sized rocks the wild land always holds
  const MIN_TREES = 20;        // and trees
  // Reads the terrain around column x relative to the anchor row and remembers every value it was
  // asked for, so the exact same plant can be regenerated later (to fell it after a blast).
  function makeGround(world, x, row, wet) {
    const beds = new Map(), tops = new Map();
    const read = (dx) => {
      const col = Math.max(0, Math.min(world.width - 1, x + dx));
      const surface = world.groundTop[col];
      beds.set(dx, (wet ? PW.supportBelow(world, col, surface, true) : surface) - row);
      tops.set(dx, surface - row);
    };
    const ground = (dx) => { dx = Math.round(dx); if (!beds.has(dx)) read(dx); return beds.get(dx); };
    ground.surface = (dx) => { dx = Math.round(dx); if (!tops.has(dx)) read(dx); return tops.get(dx); };
    ground.freeze = () => {
      if (!beds.size) return null;
      let p0 = Infinity, p1 = -Infinity;
      for (const dx of beds.keys()) { if (dx < p0) p0 = dx; if (dx > p1) p1 = dx; }
      const bedRows = new Int16Array(p1 - p0 + 1), topRows = new Int16Array(p1 - p0 + 1);
      for (let dx = p0; dx <= p1; dx += 1) { bedRows[dx - p0] = ground(dx); topRows[dx - p0] = ground.surface(dx); }
      return { p0, beds: bedRows, tops: topRows };
    };
    return ground;
  }
  function frozenGround(profile) {
    if (!profile) return FLAT;
    const { p0, beds, tops } = profile;
    const at = (rows, dx) => rows[Math.max(0, Math.min(rows.length - 1, Math.round(dx) - p0))];
    return Object.assign((dx) => at(beds, dx), { surface: (dx) => at(tops, dx) });
  }
  // Deepest drop and highest rise of the ground over [a, b] (cells, never negative).
  function spanDrop(ground, a, b) { let d = 0; for (let dx = Math.floor(a); dx <= b; dx += 1) d = Math.max(d, ground(dx)); return d; }
  function spanRise(ground, a, b) {
    const top = ground.surface || ground;
    let d = 0;
    for (let dx = Math.floor(a); dx <= b; dx += 1) d = Math.max(d, -ground(dx), -top(dx));
    return d;
  }

  // ---- Sprites ---------------------------------------------------------------------------------------
  // A sprite is a small cell buffer with its anchor on the surface cell under the plant's centre.
  // `base` lists the columns (relative to the anchor) that must reach the ground.
  function createSprite(width, height) {
    return { width, height, pixels: new Uint32Array(width * height), anchorX: width >> 1, anchorY: height - 1, base: null, trunk: null };
  }
  function put(sprite, x, y, color) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) return;
    sprite.pixels[y * sprite.width + x] = color;
  }
  function get(sprite, x, y) {
    if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) return 0;
    return sprite.pixels[y * sprite.width + x];
  }
  // Generators draw on a roomy canvas; trim it to the drawn cells, keeping the anchor in place.
  function trim(sprite) {
    let x0 = sprite.width, y0 = sprite.height, x1 = -1, y1 = -1;
    for (let y = 0; y < sprite.height; y += 1) {
      for (let x = 0; x < sprite.width; x += 1) {
        if (!sprite.pixels[y * sprite.width + x]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return sprite;
    const out = createSprite(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y += 1) {
      out.pixels.set(sprite.pixels.subarray(y * sprite.width + x0, y * sprite.width + x1 + 1), (y - y0) * out.width);
    }
    out.anchorX = sprite.anchorX - x0;
    out.anchorY = sprite.anchorY - y0;
    out.base = sprite.base;
    out.trunk = sprite.trunk;
    return out;
  }
  // Roomy canvas with the anchor at the bottom centre and `below` spare rows for a falling slope.
  function canvasFor(height, widthFactor, heightFactor = 1.45, below = 0) {
    const sprite = createSprite(Math.round(height * widthFactor), Math.round(height * heightFactor) + 4 + below);
    sprite.anchorY = sprite.height - 2 - below;
    return sprite;
  }

  // Tapered limb from (x0,y0) to (x1,y1) with a gentle bend; bark is lit from the upper left.
  function limb(sprite, x0, y0, x1, y1, w0, w1, bark, random, bend = 0) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(2, Math.ceil(length * 1.5));
    const nx = -(y1 - y0) / (length || 1), ny = (x1 - x0) / (length || 1);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const curve = Math.sin(t * Math.PI) * bend;
      const cx = x0 + (x1 - x0) * t + nx * curve, cy = y0 + (y1 - y0) * t + ny * curve;
      const r = (w0 + (w1 - w0) * t) / 2;
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy += 1) {
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx += 1) {
          if (dx * dx + dy * dy > r * r + 0.35) continue;
          const px = Math.round(cx + dx), py = Math.round(cy + dy);
          // Lit side faces the moon (upper left); grooves run along the limb.
          const side = (dx * -0.8 + dy * -0.6) / (r || 1);
          const groove = (PW.hash2(px, Math.round(py / 3)) & 7) === 0;
          const k = side > 0.35 ? 1.18 : side < -0.4 ? 0.72 : 1;
          put(sprite, px, py, groove ? shadeColor(bark.dark, 1) : shadeColor(bark.base, k));
        }
      }
    }
  }

  // Leaf mass: union of clumps with clustered texture, lit from the upper left, with gaps.
  function foliage(sprite, clumps, palette, random, options = {}) {
    if (!clumps.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of clumps) {
      x0 = Math.min(x0, c.x - c.r); x1 = Math.max(x1, c.x + c.r);
      y0 = Math.min(y0, c.y - c.r); y1 = Math.max(y1, c.y + c.r);
    }
    const seed = random.int(1, 1e9);
    const cluster = PW.createNoise2D(seed, options.clusterSize || 5);
    const fine = PW.createNoise2D(seed + 7, 2);
    const canopyTop = y0, canopyHeight = Math.max(1, y1 - y0);
    for (let y = Math.floor(y0); y <= y1; y += 1) {
      for (let x = Math.floor(x0); x <= x1; x += 1) {
        let best = 0, bestClump = null;
        for (const c of clumps) {
          const d = Math.hypot((x - c.x) / (c.sx || 1), (y - c.y) / (c.sy || 1)) / c.r;
          if (d < 1 && 1 - d > best) { best = 1 - d; bestClump = c; }
        }
        if (!bestClump) continue;
        const n = cluster(x, y), f = fine(x, y);
        // Ragged edge: leaf clusters push out or pull in the outline.
        if (best + n * 0.32 + f * 0.1 < (options.edge || 0.22)) continue;
        // Small holes inside the canopy let branches and sky show through.
        if (best > 0.25 && n < -0.55 && f < -0.1) continue;
        const ux = (x - bestClump.x) / bestClump.r, uy = (y - bestClump.y) / bestClump.r;
        const light = -ux * 0.55 - uy * 0.85 + n * 0.55 + (1 - (y - canopyTop) / canopyHeight) * 0.35;
        let color;
        if (light > 0.95) color = palette.high;
        else if (light > 0.45) color = palette.light;
        else if (light > -0.2) color = palette.base;
        else if (light > -0.65) color = palette.shadow;
        else color = palette.deep;
        // Single-cell leaf speckles break up flat areas.
        const speck = PW.hash2(x * 3 + seed, y) & 31;
        put(sprite, x, y, speck === 0 ? shadeColor(color, 1.16) : speck === 1 ? shadeColor(color, 0.82) : rgb(color[0], color[1], color[2]));
      }
    }
  }

  // Trunk foot and roots shaped by the ground: a buttress root each side runs down to where the
  // surface really is (longer on the downhill side) and ends in a thin root creeping along it;
  // then every column under the trunk and roots is filled down to the surface, so no light shows
  // under a tree standing on a slope or a hump. Returns the base columns.
  function rootFoot(sprite, cx, baseY, trunkW, ground, bark, random) {
    const half = Math.max(1, Math.round(trunkW / 2));
    let from = -half, to = half;
    for (const s of [-1, 1]) {
      const fall = Math.max(0, ground(s * (half + trunkW)) - ground(0));
      const reach = Math.round(half + trunkW * random.range(0.55, 1.05) + Math.min(trunkW * 0.9, fall * 0.35));
      const ex = s * reach;
      limb(sprite, cx + s * half * 0.35, baseY - trunkW * random.range(0.9, 1.3), cx + ex, baseY + ground(ex) + 1,
        trunkW * 0.6, Math.max(1.6, trunkW * 0.18), bark, random);
      const run = random.int(Math.max(2, Math.round(trunkW * 0.3)), Math.max(3, Math.round(trunkW * 1.1)));
      for (let k = 1; k <= run; k += 1) {
        const dx = ex + s * k;
        put(sprite, cx + dx, baseY + ground(dx) - 1, shadeColor(k > run * 0.6 ? bark.dark : bark.base, 0.92));
      }
      if (s < 0) from = Math.min(from, ex - run); else to = Math.max(to, ex + run);
    }
    // Only wood is drawn so far (the crown comes later), so the lowest visible cell above the
    // surface in each column is trunk or root. Where a root runs inside the slope (uphill) the
    // column gets a root lying on the surface instead.
    const reachUp = Math.max(4, Math.round(trunkW * 2.5));
    for (let dx = from; dx <= to; dx += 1) {
      const x = cx + dx, surface = baseY + ground(dx);
      let lowest = -1;
      for (let y = Math.min(sprite.height - 1, surface - 1); y >= Math.max(0, surface - 1 - reachUp); y -= 1) {
        if (get(sprite, x, y)) { lowest = y; break; }
      }
      if (lowest < 0) { put(sprite, x, surface - 1, shadeColor(bark.dark, 0.9)); put(sprite, x, surface, shadeColor(bark.dark, 0.9)); continue; }
      for (let y = lowest + 1; y <= surface; y += 1) put(sprite, x, y, shadeColor(y > lowest + 2 ? bark.dark : bark.base, 0.9));
    }
    return { from, to };
  }

  // ---- Generators: (random, size, ground) -> sprite --------------------------------------------------
  function broadleaf(random, height, ground = FLAT) {
    const trunkW = Math.max(4, height * random.range(0.055, 0.07));
    const reach = Math.ceil(trunkW * 3.6);
    const sprite = canvasFor(height, 1.9, 1.45, spanDrop(ground, -reach, reach) + 3);
    const base = { x: sprite.anchorX, y: sprite.anchorY };
    const trunkTop = { x: base.x + random.range(-0.06, 0.06) * height, y: base.y - height * random.range(0.42, 0.55) };
    const clumps = [];
    limb(sprite, base.x, base.y, trunkTop.x, trunkTop.y, trunkW, trunkW * 0.62, BARK, random, random.range(-2, 2));
    sprite.base = rootFoot(sprite, base.x, base.y, trunkW, ground, BARK, random);
    sprite.trunk = { dx: trunkTop.x - base.x, dy: trunkTop.y - base.y };
    function branch(x, y, angle, length, w, depth) {
      const ex = x + Math.cos(angle) * length, ey = y + Math.sin(angle) * length;
      limb(sprite, x, y, ex, ey, w, w * 0.62, BARK, random, random.range(-length * 0.08, length * 0.08));
      if (depth <= 0 || length < height * 0.09) {
        clumps.push({ x: ex, y: ey, r: height * random.range(0.13, 0.2), sx: random.range(1.1, 1.35), sy: random.range(0.8, 0.95) });
        return;
      }
      const children = random.int(2, 3);
      for (let i = 0; i < children; i += 1) {
        const spread = random.range(0.25, 0.75) * (i % 2 ? 1 : -1);
        branch(ex, ey, angle + spread + random.range(-0.15, 0.15), length * random.range(0.6, 0.78), w * 0.62, depth - 1);
      }
      if (random() < 0.5) clumps.push({ x: ex, y: ey, r: height * random.range(0.1, 0.15), sx: 1.2, sy: 0.85 });
    }
    const mainBranches = random.int(2, 4);
    for (let i = 0; i < mainBranches; i += 1) {
      const t = mainBranches === 1 ? 0 : i / (mainBranches - 1) - 0.5;
      branch(trunkTop.x, trunkTop.y, -Math.PI / 2 + t * random.range(1.1, 1.6), height * random.range(0.2, 0.28),
        trunkW * 0.62, random.int(2, 3));
    }
    clumps.push({ x: trunkTop.x, y: trunkTop.y - height * 0.12, r: height * 0.2, sx: 1.4, sy: 0.9 });
    foliage(sprite, clumps, LEAF, random, { clusterSize: Math.max(4, height / 30) });
    return trim(sprite);
  }

  function conifer(random, height, ground = FLAT) {
    const maxHalf = height * random.range(0.2, 0.27);
    const trunkW = Math.max(3, height * 0.04);
    const reach = Math.ceil(trunkW * 3.6);
    const below = spanDrop(ground, -reach, reach) + 3;
    const sprite = createSprite(Math.round(maxHalf * 2.6 + 12), height + 8 + below);
    sprite.anchorY = sprite.height - 2 - below;
    const cx = sprite.anchorX, baseY = sprite.anchorY;
    const topX = cx + random.range(-1, 1);
    limb(sprite, cx, baseY, topX, baseY - height * 0.95, trunkW, 1.5, BARK, random);
    sprite.base = rootFoot(sprite, cx, baseY, trunkW, ground, BARK, random);
    sprite.trunk = { dx: topX - cx, dy: -height * 0.6 };
    const top = baseY - height;
    const skirt = height * random.range(0.12, 0.2);   // bare trunk at the bottom
    const tiers = random.int(7, 12);
    const crown = height - skirt;
    const noise = PW.createNoise1D(random.int(1, 1e9), 3);
    for (let tier = 0; tier < tiers; tier += 1) {
      const t0 = tier / tiers, t1 = (tier + 1.35) / tiers;
      const yTop = top + crown * t0, yBottom = top + crown * Math.min(1, t1);
      const half = maxHalf * Math.pow((tier + 1) / tiers, 0.85) * random.range(0.85, 1.08);
      for (let y = Math.floor(yTop); y <= yBottom; y += 1) {
        const v = (y - yTop) / Math.max(1, yBottom - yTop);
        // Each tier widens downward, with drooping, ragged needle tips.
        const spread = half * (0.25 + 0.75 * v) * (1 + noise(y * 1.7 + tier * 13) * 0.18);
        for (let x = Math.floor(cx - spread); x <= cx + spread; x += 1) {
          const u = (x - cx) / Math.max(1, spread);
          if (Math.abs(u) > 0.92 && (PW.hash2(x, y) & 3) === 0) continue;
          const light = -u * 0.65 - v * 0.9 + 0.45 + ((PW.hash2(x, y) & 15) - 7.5) / 22;
          const color = light > 0.75 ? NEEDLE.high : light > 0.3 ? NEEDLE.light : light > -0.15 ? NEEDLE.base
            : light > -0.55 ? NEEDLE.shadow : NEEDLE.deep;
          put(sprite, x, y, rgb(color[0], color[1], color[2]));
        }
      }
    }
    return trim(sprite);
  }

  function birch(random, height, ground = FLAT) {
    const trunkW = Math.max(3, height * 0.04);
    const reach = Math.ceil(trunkW * 3.6);
    const sprite = canvasFor(height, 1.1, 1.3, spanDrop(ground, -reach, reach) + 3);
    const cx = sprite.anchorX, baseY = sprite.anchorY;
    const lean = random.range(-0.08, 0.08) * height;
    const bark = { dark: [52, 48, 46], base: [196, 192, 178], light: [226, 224, 212] };
    limb(sprite, cx, baseY, cx + lean, baseY - height * 0.9, trunkW, 1.6, bark, random);
    // Birch bark is dark and rough at the foot.
    sprite.base = rootFoot(sprite, cx, baseY, trunkW, ground, BIRCH_FOOT, random);
    sprite.trunk = { dx: lean * 0.6, dy: -height * 0.55 };
    // Dark birch marks.
    for (let y = baseY - 4; y > baseY - height * 0.85; y -= random.int(5, 11)) {
      const t = (baseY - y) / (height * 0.9);
      const x = cx + lean * t;
      put(sprite, x - 1, y, rgb(40, 38, 36)); put(sprite, x, y, rgb(40, 38, 36));
    }
    const clumps = [];
    for (let i = 0; i < 6; i += 1) {
      const t = random.range(0.35, 0.95);
      clumps.push({ x: cx + lean * t + random.range(-0.18, 0.18) * height, y: baseY - height * t,
        r: height * random.range(0.1, 0.16), sx: 0.9, sy: 1.25 });
    }
    foliage(sprite, clumps, BIRCH_LEAF, random, { clusterSize: 3.5, edge: 0.28 });
    return trim(sprite);
  }

  // A bush is a leafy mound whose foot follows the ground column by column. On a steep bank it
  // grows narrower and its crown stays rounder (only half of the slope carries into the crown).
  function bush(random, height, ground = FLAT) {
    let half = Math.max(6, Math.round(height * random.range(1.15, 1.55)));
    const steep = Math.abs(ground(half) - ground(-half)) / (2 * half);
    if (steep > 0.5) half = Math.max(6, Math.round(half / (1 + (steep - 0.5) * 1.6)));
    const drop = spanDrop(ground, -half, half), rise = spanRise(ground, -half, half);
    const sprite = createSprite(half * 2 + 3, Math.round(height * 1.3) + rise + drop + 6);
    sprite.anchorX = half + 1;
    sprite.anchorY = sprite.height - 3 - drop;
    const palette = random() < 0.5 ? LEAF : BIRCH_LEAF;
    const seed = random.int(1, 1e9);
    const lobes = PW.createNoise1D(seed, Math.max(3, height * 0.35));
    const cluster = PW.createNoise2D(seed + 3, Math.max(2.5, height / 9));
    for (let dx = -half; dx <= half; dx += 1) {
      const t = dx / half;
      const h = height * Math.pow(Math.max(0, 1 - t * t), 0.6) * (0.8 + 0.28 * lobes(dx + half));
      const surface = sprite.anchorY + ground(dx);
      const crown = sprite.anchorY + Math.round(ground(dx) * 0.5) - h;
      const top = Math.round(Math.min(crown, surface - Math.min(h, 2)));
      if (surface - top < 1) continue;
      for (let y = top; y <= surface; y += 1) {
        const v = (y - top) / Math.max(1, surface - top);   // 0 at the crown, 1 at the ground
        const n = cluster(dx, y);
        if (y - top < 2 && surface - y > 2 && n < -0.15) continue;   // ragged crown edge (never at the foot)
        if (v > 0.15 && v < 0.62 && surface - y > 2 && n < -0.6) continue;   // gaps between leaf clusters
        const light = -t * 0.55 + (0.45 - v) * 1.3 + n * 0.55;
        let color = light > 0.95 ? palette.high : light > 0.45 ? palette.light : light > -0.2 ? palette.base
          : light > -0.65 ? palette.shadow : palette.deep;
        if (v > 0.8 && (PW.hash2(dx + seed, y) & 7) === 0) color = BARK.dark;   // stems at the foot
        const speck = PW.hash2(dx * 3 + seed, y) & 31;
        put(sprite, sprite.anchorX + dx, y, speck === 0 ? shadeColor(color, 1.16) : speck === 1 ? shadeColor(color, 0.82) : rgb(color[0], color[1], color[2]));
      }
    }
    sprite.base = { from: -half, to: half };
    return trim(sprite);
  }

  function deadTree(random, height, ground = FLAT) {
    const trunkW = Math.max(3, height * 0.05);
    const reach = Math.ceil(trunkW * 3.6);
    const sprite = canvasFor(height, 1.4, 1.1, spanDrop(ground, -reach, reach) + 3);
    const base = { x: sprite.anchorX, y: sprite.anchorY };
    const top = { x: base.x + random.range(-0.1, 0.1) * height, y: base.y - height * 0.6 };
    limb(sprite, base.x, base.y, top.x, top.y, trunkW, trunkW * 0.5, DEAD_BARK, random, random.range(-3, 3));
    sprite.base = rootFoot(sprite, base.x, base.y, trunkW, ground, DEAD_BARK, random);
    sprite.trunk = { dx: (top.x - base.x) * 0.8, dy: (top.y - base.y) * 0.8 };
    function branch(x, y, angle, length, w, depth) {
      const ex = x + Math.cos(angle) * length, ey = y + Math.sin(angle) * length;
      limb(sprite, x, y, ex, ey, w, Math.max(1, w * 0.55), DEAD_BARK, random, random.range(-2, 2));
      if (depth <= 0) return;
      for (let i = 0; i < 2; i += 1) branch(ex, ey, angle + random.range(0.2, 0.7) * (i ? 1 : -1), length * 0.66, Math.max(1, w * 0.6), depth - 1);
    }
    for (let i = 0; i < 3; i += 1) branch(top.x, top.y, -Math.PI / 2 + (i - 1) * random.range(0.4, 0.8), height * 0.25, trunkW * 0.55, 2);
    return trim(sprite);
  }

  // A boulder is a lumpy dome that settles along the slope (it tilts with most of it) and is
  // partly sunk; where the ground still falls away under its downhill edge, its shadowed foot
  // continues down to the surface. options: { dark (tone), moss (false in caves), palette }.
  const ROCK = [[138, 130, 118], [112, 104, 94], [90, 84, 76], [66, 61, 56]];
  function boulder(random, size, ground = FLAT, options = {}) {
    const half = Math.max(3, Math.round(size * random.range(0.7, 0.95)));
    const height = Math.max(3, Math.round(size));
    const sink = Math.round(height * random.range(0.1, 0.2));
    const drop = spanDrop(ground, -half, half), rise = spanRise(ground, -half, half);
    const sprite = createSprite(half * 2 + 3, height + sink + drop + rise + 8);
    sprite.anchorX = half + 1;
    sprite.anchorY = sprite.height - 3 - drop;
    const seed = random.int(1, 1e9);
    const noise = PW.createNoise2D(seed, Math.max(3, size / 4));
    const outline = PW.createNoise1D(seed + 1, Math.max(3, size / 3));
    const tone = random.range(0.85, 1.12) * (options.dark || 1);
    const palette = options.palette || ROCK;
    const moss = options.moss !== false;
    const settle = 0.45;
    for (let dx = -half; dx <= half; dx += 1) {
      const t = dx / half;
      const shape = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.4)), 0.5) * (0.86 + 0.24 * outline(dx + half));
      const g = ground(dx);
      const baseRow = sprite.anchorY + sink + Math.round(g * settle);
      const top = Math.round(baseRow - (height + sink) * shape);
      const bottom = Math.max(baseRow, sprite.anchorY + g);
      for (let y = top; y <= bottom; y += 1) {
        const v = (y - top) / Math.max(1, baseRow - top);
        const n = noise(dx * 2, y * 2);
        const light = -t * 0.6 + (0.5 - v) * 0.9 + n * 0.35;
        let c = light > 0.55 ? palette[0] : light > 0.05 ? palette[1] : light > -0.5 ? palette[2] : palette[3];
        if (y > baseRow) c = palette[3];
        if (moss && v < 0.3 && noise(dx * 3, y * 3) > 0.15) c = [70, 96, 50];
        if (y === top && light > 0.2) c = mixRGB(c, [180, 172, 158], 0.35);   // lit crest
        put(sprite, sprite.anchorX + dx, y, shadeColor(c, tone));
      }
    }
    sprite.base = { from: -half, to: half };
    return sprite;
  }

  // Reeds rise from the bed through shallow water (submerged stalks take the water's tint).
  // ground(dx) is the bed, ground.surface(dx) the water surface (or the shore when dry).
  function reeds(random, height, ground = FLAT) {
    const width = random.int(6, 14);
    const deepest = spanDrop(ground, -width, width), rise = spanRise(ground, -width, width);
    const sprite = createSprite(width + 12, Math.round(height) + deepest + rise + 12);
    sprite.anchorX = (width >> 1) + 6;
    sprite.anchorY = sprite.height - 3 - deepest;
    const waterTint = [40, 92, 120];
    let from = Infinity, to = -Infinity;
    const roots = [];
    for (let i = 0; i < width; i += random.int(1, 3)) {
      const dx = i - (width >> 1);
      roots.push(dx);
      const bed = sprite.anchorY + ground(dx);
      const surface = sprite.anchorY + ground.surface(dx);
      const h = height * random.range(0.55, 1);
      const lean = random.range(-0.25, 0.25);
      const topRow = Math.round(surface - h);
      for (let y = bed; y >= topRow; y -= 1) {
        const above = surface - y;
        const x = sprite.anchorX + dx + (above > 0 ? Math.round(lean * above * 0.4) : 0);
        let shade = above > h * 0.7 ? [86, 112, 54] : [64, 92, 44];
        if (y >= surface && bed > surface) shade = mixRGB(shade, waterTint, 0.55);
        put(sprite, x, y, rgb(shade[0] | 0, shade[1] | 0, shade[2] | 0));
      }
      if (random() < 0.45) {   // cattail head
        const x = sprite.anchorX + dx + Math.round(lean * h * 0.82 * 0.4);
        for (let y = 0; y < 5; y += 1) put(sprite, x, topRow + Math.round(h * 0.18) + y, rgb(92, 58, 34));
      }
      from = Math.min(from, dx); to = Math.max(to, dx);
    }
    // Only the stalk roots must reach the bed; leaning tips over other columns are fine.
    sprite.base = { from, to, roots };
    return sprite;
  }

  const GENERATORS = { broadleaf, conifer, birch, bush, deadTree, boulder, reeds };
  const CATEGORY = { broadleaf: 'tree', conifer: 'tree', birch: 'tree', deadTree: 'tree', bush: 'bush', boulder: 'boulder', reeds: 'reeds' };

  // ---- Stamping --------------------------------------------------------------------------------------
  // Blit a sprite into the deco layer with its anchor on world cell (x, row). Only open air is drawn
  // into (and water, for reeds): never solid ground, structures or building interiors. Returns the
  // placement and, per base column, the lowest drawn row (the plant's foot).
  function stamp(world, sprite, x, row, options = {}) {
    const left = Math.round(x - sprite.anchorX), top = Math.round(row - sprite.anchorY);
    const { mat, width: W, height: H } = world;
    const base = sprite.base;
    const footX0 = base ? x + base.from : 0;
    const foot = base ? new Int32Array(base.to - base.from + 1).fill(-1) : null;
    for (let sy = 0; sy < sprite.height; sy += 1) {
      const wy = top + sy;
      if (wy < 0 || wy >= H) continue;
      for (let sx = 0; sx < sprite.width; sx += 1) {
        const color = sprite.pixels[sy * sprite.width + sx];
        if (!color) continue;
        const wx = left + sx;
        if (wx < 0 || wx >= W) continue;
        const id = mat[wy * W + wx] & ID_MASK;
        if (id !== M.AIR && !(options.water && id === M.WATER)) continue;
        if (id === M.AIR && PW.getLayer(world, 'back', wx, wy)) continue;
        PW.setLayer(world, 'deco', wx, wy, color);
        PW.setFlag(world, wx, wy, PW.FLAG.FLORA);   // plant matter: it can burn
        if (foot) {
          const k = wx - footX0;
          if (k >= 0 && k < foot.length && wy > foot[k]) foot[k] = wy;
        }
      }
    }
    if (foot && base.roots) {
      const rooted = new Set(base.roots);
      for (let k = 0; k < foot.length; k += 1) if (!rooted.has(base.from + k)) foot[k] = -1;
    }
    return { x: left, y: top, width: sprite.width, height: sprite.height, foot, footX0 };
  }

  // Generate a plant against the ground at column x, stamp it and keep a record (with the ground
  // profile it was made for, so it can be regenerated exactly and felled after a blast).
  function plant(world, type, x, options = {}) {
    x = Math.round(x);
    const seed = (options.seed >>> 0) || PW.hash2(x, type.length) || 1;
    const size = options.size;
    const row = options.row ?? world.groundTop[x];
    const wet = type === 'reeds';
    const ground = makeGround(world, x, row, wet);
    const sprite = GENERATORS[type](PW.createRandom(seed), size, ground, options.look);
    const placed = stamp(world, sprite, x, row, { water: wet });
    const record = { kind: CATEGORY[type], type, anchorX: x, row, seed, size, look: options.look || null,
      profile: ground.freeze(), x: placed.x, y: placed.y, width: placed.width, height: placed.height,
      foot: placed.foot, footX0: placed.footX0,
      trunk: sprite.trunk ? { x0: x, y0: row - 3, x1: Math.round(x + sprite.trunk.dx), y1: Math.round(row + sprite.trunk.dy) } : null };
    (world.flora || (world.flora = [])).push(record);
    return record;
  }
  function regenerate(record) {
    return GENERATORS[record.type](PW.createRandom(record.seed), record.size, frozenGround(record.profile), record.look);
  }

  // Remove a plant's cells (those still showing its colours) and throw some leaves and splinters.
  function fell(world, particles, record) {
    const sprite = regenerate(record);
    const left = Math.round(record.anchorX - sprite.anchorX), top = Math.round(record.row - sprite.anchorY);
    const F = PW.PARTICLE;
    let n = 0;
    for (let sy = 0; sy < sprite.height; sy += 1) {
      for (let sx = 0; sx < sprite.width; sx += 1) {
        const color = sprite.pixels[sy * sprite.width + sx];
        if (!color) continue;
        const wx = left + sx, wy = top + sy;
        if (PW.getLayer(world, 'deco', wx, wy) !== color) continue;
        PW.setLayer(world, 'deco', wx, wy, 0);
        n += 1;
        if (particles && F && (PW.hash2(wx, wy) & 31) === 0) {
          const r = (PW.hash3(wx, wy, 7) & 255) / 255 - 0.5;
          particles.spawn(wx + 0.5, wy + 0.5, r * 90, -20 - (PW.hash3(wx, wy, 9) & 63), 0, color, F.LEAF, 1.5 + (PW.hash2(wy, wx) & 3) * 0.5);
        }
      }
    }
    record.felled = true;
    return n;
  }
  // After a blast: fell plants that lost their footing or had their trunk cut.
  function afterBlast(world, particles, box) {
    if (!world.flora) return 0;
    let felled = 0;
    const { mat, width: W } = world;
    const solid = (x, y) => PW.mat.phase[PW.get(world, x, y) & ID_MASK] >= PW.PHASE.POWDER;
    for (const record of world.flora) {
      if (record.x > box.x1 || record.x + record.width < box.x0 || record.y > box.y1 || record.y + record.height < box.y0) continue;
      let footed = 0, lost = 0;
      if (record.foot) {
        for (let k = 0; k < record.foot.length; k += 1) {
          const y = record.foot[k];
          if (y < 0) continue;
          footed += 1;
          if (!solid(record.footX0 + k, y + 1)) lost += 1;
        }
      }
      let cut = false;
      if (record.trunk) {
        const { x0, y0, x1, y1 } = record.trunk;
        const steps = Math.max(2, Math.round(Math.abs(y1 - y0) / 3));
        // A trunk is cut where its centre line and both neighbours are open air with nothing drawn.
        const open = (x, y) => (mat[y * W + x] & ID_MASK) === M.AIR && !PW.getLayer(world, 'deco', x, y);
        for (let s = 0; s <= steps && !cut; s += 1) {
          const x = Math.round(x0 + (x1 - x0) * s / steps), y = Math.round(y0 + (y1 - y0) * s / steps);
          if (open(x, y) && open(x - 1, y) && open(x + 1, y)) cut = true;
        }
      }
      if (cut || (footed && lost / footed > 0.4)) { fell(world, particles, record); felled += 1; }
    }
    if (felled) world.flora = world.flora.filter((record) => !record.felled);
    return felled;
  }

  // ---- Wild growth -----------------------------------------------------------------------------------
  function grassTufts(world, random, blocked) {
    const meadow = PW.createNoise1D(random.int(1, 1e9), 260);
    const clumping = PW.createNoise1D(random.int(1, 1e9), 9);
    for (let x = 2; x < world.width - 2; x += 1) {
      if (blocked[x]) continue;
      const y = world.groundTop[x];
      if ((PW.get(world, x, y) & ID_MASK) !== M.GRASS) continue;
      const tall = Math.max(0, meadow(x)) * 9;
      const clump = clumping(x) + ((PW.hash2(x, 3) & 15) - 7.5) / 20;
      if (clump < -0.25) continue;
      const h = Math.round(2 + clump * 4 + tall * (0.6 + (PW.hash2(x, 5) & 7) / 14));
      tuft(world, x, y, h);
    }
  }
  // One tuft of grass blades (and now and then a flower) on the grass cell at (x, y). Every cell
  // is marked as plant matter, so it can burn.
  const BLADES = [[88, 124, 54], [64, 96, 42], [100, 136, 62], [76, 110, 48], [110, 140, 66]];
  const FLOWERS = [[226, 220, 206], [236, 200, 70], [180, 120, 210], [220, 96, 110], [150, 190, 240]];
  function tuft(world, x, y, h) {
    const plantCell = (cx, cy, color) => {
      if ((PW.get(world, cx, cy) & ID_MASK) !== M.AIR || PW.getLayer(world, 'deco', cx, cy)) return false;
      PW.setLayer(world, 'deco', cx, cy, color);
      PW.setFlag(world, cx, cy, PW.FLAG.FLORA);
      PW.setFlag(world, cx, cy, PW.FLAG.CHARRED, false);
      return true;
    };
    const color = BLADES[PW.hash2(x, 9) % BLADES.length];
    const lean = (PW.hash2(x, 11) & 3) === 0 ? ((PW.hash2(x, 13) & 1) ? 1 : -1) : 0;
    let drawn = 0;
    for (let i = 1; i <= h; i += 1) {
      const bx = x + (lean && i > h * 0.6 ? lean : 0);
      const k = i === h ? 1.15 : i < 2 ? 0.85 : 1;
      if (!plantCell(bx, y - i, shadeColor(color, k))) break;
      drawn += 1;
    }
    if (drawn === h && (PW.hash2(x, 17) % 97) === 0 && h >= 3) {
      const f = FLOWERS[PW.hash2(x, 19) % FLOWERS.length];
      const top = y - h - 1;
      plantCell(x, top, rgb(f[0], f[1], f[2]));
      plantCell(x + 1, top, rgb(f[0], f[1], f[2]));
      plantCell(x, top - 1, shadeColor(f, 1.12));
      plantCell(x + 1, top + 1, rgb(236, 210, 80));
    }
    return drawn;
  }

  // Columns taken by settlements (streets, runways, fields, pumps, defences) plus a margin.
  function blockedColumns(world, margin = 24) {
    const blocked = new Uint8Array(world.width);
    for (const settlement of world.settlements || []) {
      for (const [a, b] of settlement.footprints || [[settlement.streetLeft, settlement.streetRight]]) {
        for (let x = Math.max(0, Math.round(a) - margin); x <= Math.min(world.width - 1, Math.round(b) + margin); x += 1) blocked[x] = 1;
      }
    }
    return blocked;
  }

  // Wild vegetation, generated after the settlements so it grows on the final, terraced ground.
  function generateVegetation(world, layout, seed) {
    const random = PW.createRandom(seed + 991);
    const W = world.width;
    const blocked = blockedColumns(world);
    const clearOf = (x, half) => {
      for (let k = Math.round(x - half); k <= x + half; k += 3) if (k < 0 || k >= W || blocked[k]) return false;
      return true;
    };
    const nearWater = (x, margin) => layout.lakes.some((lake) => x > (lake.left ?? lake.x - lake.half) - margin
      && x < (lake.right ?? lake.x + lake.half) + margin);
    const topId = (x) => PW.get(world, x, world.groundTop[x]) & ID_MASK;
    const soil = (x) => { const id = topId(x); return id === M.GRASS || id === M.TOPSOIL || id === M.SOIL || id === M.CLAY; };
    const rocky = (x) => { const id = topId(x); return soil(x) || id === M.GRAVEL || id === M.STONE || id === M.SAND; };
    const slopeAt = (x) => Math.abs(world.groundTop[Math.min(W - 1, x + 8)] - world.groundTop[Math.max(0, x - 8)]) / 16;
    const forest = PW.createNoise1D(seed + 7, 600);
    const next = () => random.int(1, 2147483646);
    const feet = new Uint8Array(W);   // columns under trunks, roots and bushes: no boulder on them
    const footClear = (x, half) => { for (let k = Math.max(0, Math.round(x - half)); k <= Math.min(W - 1, x + half); k += 1) if (feet[k]) return false; return true; };
    const markFeet = (x0, x1, margin) => { for (let k = Math.max(0, Math.round(x0 - margin)); k <= Math.min(W - 1, x1 + margin); k += 1) feet[k] = 1; };
    const grow = (type, x, size) => {
      const record = plant(world, type, x, { seed: next(), size });
      if (record.foot) markFeet(record.footX0, record.footX0 + record.foot.length - 1, 6);
      return record;
    };

    // Trees and bushes, in forests of varying density.
    const stats = world.vegetationStats = { candidates: 0, water: 0, ground: 0, crowded: 0, rocks: 0, planted: 0, tops: {} };
    let trees = 0;
    for (let x = 80; x < W - 80;) {
      const density = forest(x);
      const gap = density > 0.25 ? random.int(18, 40) : density > -0.2 ? random.int(36, 80) : random.int(70, 140);
      x += gap;
      // Skip straight over streets, runways and fields: only wild land is sampled.
      while (x < W - 80 && blocked[x]) x += 1;
      if (x >= W - 80) continue;
      stats.candidates += 1;
      if (nearWater(x, 30)) { stats.water += 1; continue; }
      if (!soil(x)) { stats.ground += 1; stats.tops[PW.mat.names[topId(x)]] = (stats.tops[PW.mat.names[topId(x)]] || 0) + 1; continue; }
      const slope = slopeAt(x);
      const altitude = layout.baseY - world.groundTop[x];
      const roll = random();
      let type, size;
      if (slope > 1.5) { type = 'bush'; size = random.range(12, 24); }
      else if (altitude > 520) { type = roll < 0.55 ? 'deadTree' : 'conifer'; size = type === 'deadTree' ? random.range(70, 130) : random.range(110, 190); }
      else if (altitude > 260 || slope > 1) { type = roll < 0.7 ? 'conifer' : 'broadleaf'; size = type === 'conifer' ? random.range(150, 290) : random.range(120, 200); }
      else if (roll < 0.5) { type = 'broadleaf'; size = random.range(120, 230); }
      else if (roll < 0.72) { type = 'conifer'; size = random.range(140, 260); }
      else if (roll < 0.86) { type = 'birch'; size = random.range(110, 180); }
      else { type = 'bush'; size = random.range(18, 38); }
      const half = type === 'bush' ? size * 1.6 : type === 'conifer' ? size * 0.3 : size * 0.55;
      if (!clearOf(x, half * 0.75)) { stats.crowded += 1; continue; }
      if (!footClear(x, type === 'bush' ? half : size * 0.08)) { stats.rocks += 1; continue; }
      grow(type, x, size);
      stats.planted += 1;
      if (type !== 'bush') trees += 1;
      // Undergrowth around trunks.
      if (random() < 0.6) {
        const bx = x + random.int(-60, 60);
        const bushSize = random.range(14, 30);
        if (bx > 40 && bx < W - 40 && soil(bx) && slopeAt(bx) < 1.6 && !nearWater(bx, 20) && clearOf(bx, bushSize * 1.6) && footClear(bx, bushSize * 1.6)) {
          grow('bush', bx, bushSize);
        }
      }
    }
    // The wild land always holds some woodland: more trees on gentle soil if chance left too few.
    for (let i = 0; i < 2000 && trees < MIN_TREES; i += 1) {
      const x = random.int(80, W - 80);
      if (blocked[x] || !soil(x) || nearWater(x, 30) || slopeAt(x) > 1) continue;
      const type = layout.baseY - world.groundTop[x] > 260 ? 'conifer' : random() < 0.6 ? 'broadleaf' : 'birch';
      const size = type === 'conifer' ? random.range(140, 240) : random.range(110, 190);
      const half = type === 'conifer' ? size * 0.3 : size * 0.55;
      if (!clearOf(x, half * 0.75) || !footClear(x, size * 0.08)) continue;
      grow(type, x, size);
      stats.planted += 1;
      trees += 1;
    }
    // Boulders (more on high and steep ground, scree), settled into the slope and kept off the
    // roots. Rocks big enough to hide a crouched trooper are solid cover; pebbles stay scenery.
    const coverRock = (x, size) => {
      const row = world.groundTop[x];
      const rock = PW.props.surfaceBoulder(PW.createRandom(next()), size, PW.props.floorProfile(world, x, row, row - Math.round(size * 2) - 40));
      const record = PW.props.place(world, rock, x, row, { kind: 'boulder', setting: 'surface' });
      if (record) markFeet(record.x0, record.x1, 4);
      return !!record;
    };
    let cover = 0;
    for (let i = 0; i < 480; i += 1) {
      const x = random.int(60, W - 60);
      if (blocked[x] || !rocky(x) || nearWater(x, 8)) continue;
      const altitude = layout.baseY - world.groundTop[x];
      let size = random.range(8, altitude > 300 ? 26 : 20);
      if (!clearOf(x, size + 6) || !footClear(x, size + 4)) continue;
      // A big rock only rests where it would not roll (under ~35 degrees); on steeper ground only
      // small stones stay put.
      const lie = Math.abs(world.groundTop[Math.min(W - 1, x + Math.round(size))] - world.groundTop[Math.max(0, x - Math.round(size))]) / (2 * size);
      if (lie > 1.2) size = random.range(5, 9);
      if (size >= 11 && PW.props) {
        if (coverRock(x, size)) cover += 1;
      } else {
        grow('boulder', x, size);
      }
    }
    // The wild land always holds a few rocks big enough to shelter a crouched trooper: more tries
    // on gentle ground if chance left too few.
    for (let i = 0; i < 1500 && cover < MIN_COVER_ROCKS; i += 1) {
      const x = random.int(60, W - 60), size = random.range(11, 15);
      if (blocked[x] || !rocky(x) || nearWater(x, 8) || slopeAt(x) > 0.8) continue;
      if (!clearOf(x, size + 6) || !footClear(x, size + 4)) continue;
      if (coverRock(x, size)) cover += 1;
    }
    // Reeds in the shallows and on the banks of lakes, rising from the bed.
    for (const lake of layout.lakes) {
      if (lake.left === undefined) continue;
      for (const [edge, inward] of [[lake.left, 1], [lake.right, -1]]) {
        const spots = [];
        for (let d = -24; d <= 70; d += 1) {
          const x = edge + inward * d;
          if (x < 2 || x >= W - 2 || blocked[x]) continue;
          const surface = world.groundTop[x];
          const bed = PW.supportBelow(world, x, surface, true);
          const depth = bed - surface;
          const wet = (PW.get(world, x, surface) & ID_MASK) === M.WATER;
          // In the shallows, or on the bank right at the waterline (not up a steep bank).
          if ((wet && depth <= 22) || (!wet && d < 0 && lake.level - surface <= 5 && (soil(x) || topId(x) === M.SAND))) spots.push(x);
        }
        let last = -100;
        for (const x of spots) {
          if (Math.abs(x - last) < 9 || random() < 0.55) continue;
          plant(world, 'reeds', x, { seed: next(), size: random.range(14, 34) });
          last = x;
        }
      }
    }
    grassTufts(world, random, blocked);
    layout.vegetation = world.flora;
    return world.flora;
  }

  PW.generateVegetation = generateVegetation;
  PW.flora = { plant, fell, regenerate, afterBlast, makeGround, frozenGround, FLAT, tuft };
  PW.vegetation = { broadleaf, conifer, birch, bush, deadTree, boulder, reeds, stamp, createSprite, foliage, limb, trim, spanDrop, spanRise };
})();
