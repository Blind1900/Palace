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
  // (wood: which of its cells are wood - trunk, boughs, twigs, stems, a boulder's stone - whatever
  // is later drawn over them: leaves grow in front of their branches, the wood stays behind them)
  function createSprite(width, height) {
    return { width, height, pixels: new Uint32Array(width * height), wood: new Uint8Array(width * height), anchorX: width >> 1, anchorY: height - 1, base: null, trunk: null };
  }
  function put(sprite, x, y, color, wood = false) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) return;
    sprite.pixels[y * sprite.width + x] = color;
    if (wood) sprite.wood[y * sprite.width + x] = 1;
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
      out.wood.set(sprite.wood.subarray(y * sprite.width + x0, y * sprite.width + x1 + 1), (y - y0) * out.width);
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
          put(sprite, px, py, groove ? shadeColor(bark.dark, 1) : shadeColor(bark.base, k), true);
        }
      }
    }
  }

  // Leaf mass: union of clumps with clustered texture, lit from the upper left, with gaps.
  function foliage(sprite, clumps, palette, random, options = {}) {
    if (!clumps.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of clumps) {
      x0 = Math.min(x0, c.x - c.r * (c.sx || 1)); x1 = Math.max(x1, c.x + c.r * (c.sx || 1));
      y0 = Math.min(y0, c.y - c.r * (c.sy || 1)); y1 = Math.max(y1, c.y + c.r * (c.sy || 1));
    }
    x0 = Math.floor(x0); y0 = Math.floor(y0);
    const seed = random.int(1, 1e9);
    const cluster = PW.createNoise2D(seed, options.clusterSize || 5);
    const fine = PW.createNoise2D(seed + 7, 2);
    const canopyTop = y0, canopyHeight = Math.max(1, y1 - y0);
    // (each pixel takes the clump it lies deepest in: worked clump by clump over its own box)
    const bw = Math.ceil(x1) - x0 + 1, bh = Math.ceil(y1) - y0 + 1;
    const depth = new Float32Array(bw * bh), owner = new Int32Array(bw * bh).fill(-1);
    clumps.forEach((c, n) => {
      const sx = c.sx || 1, sy = c.sy || 1;
      for (let y = Math.floor(c.y - c.r * sy); y <= c.y + c.r * sy; y += 1) for (let x = Math.floor(c.x - c.r * sx); x <= c.x + c.r * sx; x += 1) {
        const d = Math.hypot((x - c.x) / sx, (y - c.y) / sy) / c.r;
        if (d >= 1) continue;
        const k = (y - y0) * bw + (x - x0);
        if (k >= 0 && k < depth.length && 1 - d > depth[k]) { depth[k] = 1 - d; owner[k] = n; }
      }
    });
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const k = (y - y0) * bw + (x - x0);
        if (owner[k] < 0) continue;
        const best = depth[k], bestClump = clumps[owner[k]];
        const n = cluster(x, y), f = fine(x, y);
        // Ragged edge: leaf clusters push out or pull in the outline.
        if (best + n * 0.32 + f * 0.1 < (options.edge || 0.22)) continue;
        // Small holes inside the canopy let branches and sky show through. (Elsewhere the leaves
        // are in front of the wood they grow on: it stays wood behind them - see createSprite.)
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
        put(sprite, cx + dx, baseY + ground(dx) - 1, shadeColor(k > run * 0.6 ? bark.dark : bark.base, 0.92), true);
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
      if (lowest < 0) { put(sprite, x, surface - 1, shadeColor(bark.dark, 0.9), true); put(sprite, x, surface, shadeColor(bark.dark, 0.9), true); continue; }
      for (let y = lowest + 1; y <= surface; y += 1) put(sprite, x, y, shadeColor(y > lowest + 2 ? bark.dark : bark.base, 0.9), true);
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
    // It grows as a tree does: the wood first - trunk, boughs, branches, and twigs off the ends of
    // the branches - then the leaves, in clusters along the outer branches and on the twigs, so
    // every leaf grows on wood a few cells from it (a bough that breaks off takes its leaves).
    const leafR = () => height * random.range(0.055, 0.085);
    const leavesAlong = (x0, y0, x1, y1, from) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let t = from; t <= 1.001; t += Math.max(0.15, height * 0.05 / Math.max(1, len))) {
        const r = leafR();
        clumps.push({ x: x0 + (x1 - x0) * t + random.range(-0.3, 0.3) * r, y: y0 + (y1 - y0) * t - r * 0.35, r, sx: random.range(1.05, 1.3), sy: random.range(0.8, 0.95) });
      }
    };
    function branch(x, y, angle, length, w, depth) {
      const ex = x + Math.cos(angle) * length, ey = y + Math.sin(angle) * length;
      limb(sprite, x, y, ex, ey, w, w * 0.62, BARK, random, random.range(-length * 0.08, length * 0.08));
      if (depth <= 0 || length < height * 0.09) {
        // (twigs off the end, reaching up and out, each with its leaves)
        const twigs = random.int(2, 4);
        for (let i = 0; i < twigs; i += 1) {
          const a = (angle + random.range(-0.9, 0.9)) * 0.75 - Math.PI / 2 * 0.25, tl = height * random.range(0.05, 0.09);
          const tx = ex + Math.cos(a) * tl, ty = ey + Math.sin(a) * tl;
          limb(sprite, ex, ey, tx, ty, Math.max(1.2, w * 0.6), 1, BARK, random);
          const r = leafR();
          clumps.push({ x: tx, y: ty - r * 0.3, r, sx: random.range(1.05, 1.3), sy: random.range(0.8, 0.95) });
        }
        leavesAlong(x, y, ex, ey, 0.35);
        return;
      }
      if (depth === 1) leavesAlong(x, y, ex, ey, 0.6);
      const children = random.int(2, 3);
      for (let i = 0; i < children; i += 1) {
        const spread = random.range(0.25, 0.75) * (i % 2 ? 1 : -1);
        branch(ex, ey, angle + spread + random.range(-0.15, 0.15), length * random.range(0.6, 0.78), w * 0.62, depth - 1);
      }
    }
    const mainBranches = random.int(2, 4);
    for (let i = 0; i < mainBranches; i += 1) {
      const t = mainBranches === 1 ? 0 : i / (mainBranches - 1) - 0.5;
      branch(trunkTop.x, trunkTop.y, -Math.PI / 2 + t * random.range(1.1, 1.6), height * random.range(0.2, 0.28),
        trunkW * 0.62, random.int(2, 3));
    }
    // (a leader shoot carries on up from the top of the trunk, leafed like the rest)
    branch(trunkTop.x, trunkTop.y, -Math.PI / 2 + random.range(-0.15, 0.15), height * random.range(0.16, 0.22), trunkW * 0.5, 1);
    foliage(sprite, clumps, LEAF, random, { clusterSize: Math.max(3, height / 40) });
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
    // The wood first: a whorl of branches out of the trunk for each tier, drooping to its tips;
    // then the needles along them.
    const trunkX = (y) => cx + (topX - cx) * (baseY - y) / (height * 0.95);
    const tierOf = [];
    for (let tier = 0; tier < tiers; tier += 1) {
      const t0 = tier / tiers, t1 = (tier + 1.35) / tiers;
      const yTop = top + crown * t0, yBottom = top + crown * Math.min(1, t1);
      const half = maxHalf * Math.pow((tier + 1) / tiers, 0.85) * random.range(0.85, 1.08);
      tierOf.push({ yTop, yBottom, half });
      const from = yTop + (yBottom - yTop) * 0.35;
      for (const s of [-1, 1]) limb(sprite, trunkX(from), from, cx + s * half * 0.88, yBottom - 1, Math.max(1.2, trunkW * 0.22), 1, BARK, random, s * random.range(0.5, 1.5));
    }
    // (the needles grow in front of the branches: the wood stays wood behind them)
    for (let tier = 0; tier < tiers; tier += 1) {
      const { yTop, yBottom, half } = tierOf[tier];
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
      put(sprite, x - 1, y, rgb(40, 38, 36), true); put(sprite, x, y, rgb(40, 38, 36), true);
    }
    // Thin branches up and out of the trunk first, then the leaves hanging along them.
    const clumps = [];
    for (let i = 0; i < 9; i += 1) {
      const t = random.range(0.32, 0.9), side = i % 2 ? 1 : -1;
      const fx = cx + lean * t, fy = baseY - height * t;
      const a = -Math.PI / 2 + side * random.range(0.5, 1.1), len = height * random.range(0.1, 0.18);
      const ex = fx + Math.cos(a) * len, ey = fy + Math.sin(a) * len;
      limb(sprite, fx, fy, ex, ey, 1.8, 1, bark, random, side * random.range(0.5, 2));
      for (const along of [0.55, 1]) {
        clumps.push({ x: fx + (ex - fx) * along, y: fy + (ey - fy) * along + height * 0.02, r: height * random.range(0.05, 0.08), sx: 0.9, sy: 1.25 });
      }
    }
    clumps.push({ x: cx + lean * 0.9, y: baseY - height * 0.88, r: height * 0.07, sx: 0.9, sy: 1.25 });
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
        const stem = v > 0.8 && (PW.hash2(dx + seed, y) & 7) === 0;
        if (stem) color = BARK.dark;   // stems at the foot
        const speck = PW.hash2(dx * 3 + seed, y) & 31;
        put(sprite, sprite.anchorX + dx, y, speck === 0 ? shadeColor(color, 1.16) : speck === 1 ? shadeColor(color, 0.82) : rgb(color[0], color[1], color[2]), stem);
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
        put(sprite, sprite.anchorX + dx, y, shadeColor(c, tone), true);
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
    // (which cells of its box the plant was drawn into, a bit each: what a blow or a fire later
    // takes from it is worked out from these, without drawing the plant again)
    const mask = new Uint8Array((sprite.width * sprite.height + 7) >> 3);
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
        const k = sy * sprite.width + sx;
        if (sprite.wood && sprite.wood[k]) PW.setFlag(world, wx, wy, PW.FLAG.WOOD);
        mask[k >> 3] |= 1 << (k & 7);
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
    return { x: left, y: top, width: sprite.width, height: sprite.height, foot, footX0, mask };
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
      foot: placed.foot, footX0: placed.footX0, mask: placed.mask,
      trunk: sprite.trunk ? { x0: x, y0: row - 3, x1: Math.round(x + sprite.trunk.dx), y1: Math.round(row + sprite.trunk.dy) } : null };
    (world.flora || (world.flora = [])).push(record);
    return record;
  }
  function regenerate(record) {
    // (a stored null look must reach the generator as undefined, so its options default applies)
    return GENERATORS[record.type](PW.createRandom(record.seed), record.size, frozenGround(record.profile), record.look || undefined);
  }

  // A plant's cell as it comes apart: leaves and needles flutter off as leaves; trunk, branches
  // and charred wood are thrown as splintered wood that lands as wood rubble. `vx`, `vy`: how it
  // is thrown.
  const WOOD_DEBRIS = M.DEBRIS | PW.DEBRIS_KIND.WOOD << 6;
  const leafy = (color) => { const c = PW.unpack(color); return c[1] > c[0] + 6 && c[1] >= c[2]; };
  // Charred wood is brittle: it comes apart as ash, with a puff of dust, more than as charcoal.
  function charcoal(world, particles, x, y, color, vx, vy) {
    const F = PW.PARTICLE, h = PW.hash2(x, y);
    if ((h & 3) === 0) particles.spawn(x + 0.5, y + 0.5, vx, vy, WOOD_DEBRIS, color, F.LAND, 8);
    else if ((h & 3) !== 3) particles.spawn(x + 0.5, y + 0.5, vx * 0.6, vy * 0.6, M.ASH | (h >>> 4 & 3) << 6, 0, F.LAND, 8);
    else if (world && (PW.get(world, x, y) & ID_MASK) === M.AIR) PW.set(world, x, y, M.DUST | (1 + (h >>> 6 & 1)) << 6, { quiet: true });
  }
  // A plant's cell as it comes apart. `hard`: thrown hard enough to hurt what it hits (blast
  // splinters); a branch that only breaks off and falls does not.
  function shed(particles, x, y, color, vx, vy, hard = true, world = null) {
    const F = PW.PARTICLE;
    if (!particles || !F) return;
    const flags = world ? PW.getFlags(world, x, y) : 0;
    const wood = world ? (flags & (PW.FLAG.WOOD | PW.FLAG.CHARRED)) !== 0 : !leafy(color);
    if (flags & PW.FLAG.CHARRED) charcoal(world, particles, x, y, color, vx, vy);
    else if (!wood) {
      if ((PW.hash2(x, y) & 3) === 0) particles.spawn(x + 0.5, y + 0.5, vx, vy, 0, color, F.LEAF, 1.5 + (PW.hash2(y, x) & 3) * 0.5);
    } else {
      // (wood behind leaves: its leaves flutter off, its splinter is bark)
      if (leafy(color) && (PW.hash2(x, y) & 3) === 0) particles.spawn(x + 0.5, y + 0.5, vx, vy, 0, color, F.LEAF, 1.5);
      particles.spawn(x + 0.5, y + 0.5, vx, vy, WOOD_DEBRIS, leafy(color) ? barkTone(x, y) : color, hard ? F.LAND | F.DAMAGE : F.LAND, 8);
    }
  }
  // Leaves cut loose from their wood come down together, as a mass - sinking slowly, swaying and
  // spreading as they go, carried along on the wind, like a heavy gas settling - never left
  // hanging in the air. (cells: [x, y, ...] of plant cells to let go; charred ones crumble.)
  const LEAVES_MAX = 1500;      // leaves let go at a time as falling leaves (of a bigger mass, every
                                // second, third... of them)
  function fallLeaves(world, particles, cells) {
    const F = PW.PARTICLE, n = cells.length / 2, stride = Math.max(1, Math.ceil(n / LEAVES_MAX));
    for (let j = 0; j < n; j += 1) {
      const x = cells[j * 2], y = cells[j * 2 + 1];
      const color = PW.getLayer(world, 'deco', x, y), flags = PW.getFlags(world, x, y);
      if (particles && F && color) {
        if (flags & PW.FLAG.CHARRED) charcoal(world, particles, x, y, color, 0, 0);
        else if (j % stride === 0) {
          const wind = world.air && world.air.wind ? world.air.wind(x, y)[0] : 0;
          particles.spawn(x + 0.5, y + 0.5, wind * 0.3, 4 + (PW.hash2(x, y) & 7), 0, color, F.LEAF, 2 + (PW.hash2(y, x) & 3) * 0.5);
        }
      }
      PW.setLayer(world, 'deco', x, y, 0);
      PW.setFlag(world, x, y, PW.FLAG.FLORA | PW.FLAG.CHARRED | PW.FLAG.WOOD, false);
    }
  }
  // (bark where wood shows from behind its leaves)
  const barkTone = (x, y) => shadeColor((PW.hash2(x, y) & 7) === 0 ? BARK.dark : BARK.base, 0.85 + (PW.hash2(y, x) & 3) * 0.06);
  // Is the plant cell at (x, y) wood (trunk, bough, twig, charcoal) rather than leaf?
  const woodFlag = (f) => (f & (PW.FLAG.WOOD | PW.FLAG.CHARRED)) !== 0;
  // A plant that lost its footing or had its trunk cut comes down: it topples away from the
  // blast (or to the side it leans), every cell of it thrown as leaves and splintered wood that
  // spreads further the higher it was, and lands as wood rubble.
  function fell(world, particles, record, from = null) {
    const { mask } = record, sprite = mask ? null : regenerate(record);
    const left = mask ? record.x : Math.round(record.anchorX - sprite.anchorX), top = mask ? record.y : Math.round(record.row - sprite.anchorY);
    const w = mask ? record.width : sprite.width, h = mask ? record.height : sprite.height;
    const side = from ? (record.anchorX >= from.x ? 1 : -1) : (PW.hash2(record.anchorX, record.row) & 1 ? 1 : -1);
    let n = 0;
    for (let sy = 0; sy < h; sy += 1) {
      for (let sx = 0; sx < w; sx += 1) {
        const k = sy * w + sx;
        if (mask ? !(mask[k >> 3] >> (k & 7) & 1) : !sprite.pixels[k]) continue;
        const wx = left + sx, wy = top + sy;
        // (what is left of it there, burnt or not)
        const color = PW.getLayer(world, 'deco', wx, wy);
        if (!color || !(PW.getFlags(world, wx, wy) & PW.FLAG.FLORA)) continue;
        PW.setLayer(world, 'deco', wx, wy, 0);
        n += 1;
        const height = Math.max(0, record.row - wy), r = (PW.hash3(wx, wy, 7) & 255) / 255 - 0.5;
        shed(particles, wx, wy, color, side * height * (1.2 + r * 0.6) + r * 30, -10 - (PW.hash3(wx, wy, 9) & 31), false, world);
        PW.setFlag(world, wx, wy, PW.FLAG.FLORA | PW.FLAG.CHARRED | PW.FLAG.WOOD, false);
      }
    }
    record.felled = true;
    world.floraIndex = null;
    return n;
  }
  // ---- A plant comes apart a piece at a time ---------------------------------------------------------
  // A plant is wood (trunk, boughs, twigs) holding leaves, and each leaf belongs to the wood nearest
  // it: a bough that breaks off takes its own leaves with it, so there is never a cut through the
  // crown. What is still joined, wood to wood, to its roots on solid ground stands with its leaves;
  // each piece cut off falls as one rigid piece - a bough, a crown, the whole tree - and comes to
  // rest lying where it lands. Falling plants do not hurt what they land on, so one tree coming
  // down does not set off the next. Leaves come off only in a fire or in the heart of a blast.
  // The cells of a plant still drawn, sorted: 1 wood, 2 leaf (in its box; see the mask).
  function cellsOf(world, record) {
    const { mask } = record, sprite = mask ? null : regenerate(record);
    const left = mask ? record.x : Math.round(record.anchorX - sprite.anchorX), top = mask ? record.y : Math.round(record.row - sprite.anchorY);
    const w = mask ? record.width : sprite.width, h = mask ? record.height : sprite.height, n = w * h;
    const kind = new Uint8Array(n);
    let cells = 0;
    for (let k = 0; k < n; k += 1) {
      if (mask ? !(mask[k >> 3] >> (k & 7) & 1) : !sprite.pixels[k]) continue;
      const wx = left + (k % w), wy = top + ((k / w) | 0);
      const color = PW.getLayer(world, 'deco', wx, wy), flags = PW.getFlags(world, wx, wy);
      if (!color || !(flags & PW.FLAG.FLORA)) continue;
      kind[k] = woodFlag(flags) ? 1 : 2;
      cells += 1;
    }
    return { left, top, w, h, n, kind, cells };
  }
  // Wood bends before it breaks, the more the thinner it is (its stiffness goes with its girth's
  // cross-section): a twig pressed into the ground by a falling tree bends up out of it to lie
  // along it, a branch a little, a bough or a trunk not at all. A stem one cell thick bends
  // BEND_REACH cells, one g thick BEND_REACH / g^2; leaves are pressed aside LEAF_BEND.
  const BEND_REACH = 12, LEAF_BEND = 10;
  const bendReach = (g) => Math.floor(BEND_REACH / Math.max(1, g * g));
  // Air drag on a plant, per cell of it (wood and leaves) over its weight (its wood): what the wind
  // pushes it with, and what holds a falling one back - a leafy twig flutters down, a tree falls
  // nearly free. (The falling pieces feel the same: see pw-fragments.)
  const AIR_DRAG = 6e-4;
  // (what holds a plant up: anything powder or heavier - ground, rock, a rubble heap)
  const holds = (world, x, y) => PW.mat.phase[PW.get(world, x, y) & ID_MASK] >= PW.PHASE.POWDER;
  // How thick the wood is at each cell of a plant's box: its stem's girth, the shortest of the runs
  // of wood through it - across, up and down, and along both diagonals (a diagonal run is √2 as
  // long a cell) - up to 15.
  function girthOf(kind, w, h) {
    const girth = new Uint8Array(w * h).fill(15);
    const run = (x, y, dx, dy, scale) => {
      while (x >= 0 && y >= 0 && x < w && y < h) {
        if (kind[y * w + x] !== 1) { x += dx; y += dy; continue; }
        let len = 0;
        while (x + dx * len >= 0 && y + dy * len >= 0 && x + dx * len < w && y + dy * len < h && kind[(y + dy * len) * w + x + dx * len] === 1) len += 1;
        const g = Math.min(15, Math.round(len * scale));
        for (let k = 0; k < len; k += 1) { const i = (y + dy * k) * w + x + dx * k; if (g < girth[i]) girth[i] = g; }
        x += dx * len; y += dy * len;
      }
    };
    for (let y = 0; y < h; y += 1) { run(0, y, 1, 0, 1); run(0, y, 1, 1, Math.SQRT2); run(0, y, 1, -1, Math.SQRT2); }
    for (let x = 0; x < w; x += 1) { run(x, 0, 0, 1, 1); if (x) { run(x, 0, 1, 1, Math.SQRT2); run(x, h - 1, 1, -1, Math.SQRT2); } }
    return girth;
  }
  // The girth of the stem each cell of wood hangs from: the thinnest wood between it and the foot
  // of its piece (`seeds`, cells of the box: the trunk's foot, or where it broke off), along the
  // stoutest way there - so a knot of branches crossing far out in a crown is only as strong as
  // the branch it grows on. (Wood not reached from the seeds is left 0.)
  function stems(kind, girth, w, h, seeds) {
    const stem = new Uint8Array(w * h), buckets = Array.from({ length: 16 }, () => []);
    for (const k of seeds) if (kind[k] === 1 && girth[k] > stem[k]) { stem[k] = girth[k]; buckets[girth[k]].push(k); }
    for (let b = 15; b > 0; b -= 1) {
      const list = buckets[b];
      while (list.length) {
        const k = list.pop();
        if (stem[k] !== b) continue;
        const x = k % w, y = (k / w) | 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (kind[j] !== 1) continue;
            const g = Math.min(b, girth[j]);
            if (g > stem[j]) { stem[j] = g; buckets[g].push(j); }
          }
        }
      }
    }
    return stem;
  }
  // (a piece's foot: its wood within r of (fx, fy) in the box - or, none there, its wood nearest it)
  function footOf(box, ks, fx, fy, r) {
    const { w, kind } = box, near = [];
    let best = -1, bestD = Infinity;
    for (const k of ks) {
      if (kind[k] !== 1) continue;
      const d = Math.hypot((k % w) + 0.5 - fx, ((k / w) | 0) + 0.5 - fy);
      if (d <= r) near.push(k);
      if (d < bestD) { bestD = d; best = k; }
    }
    return near.length ? near : best >= 0 ? [best] : [];
  }
  // Lift a set of a plant's cells (`box`: see cellsOf) out of the world as data for a falling
  // piece: wood is what it strikes with (byte 1, or 2 if charred), leaves go along (byte 0); each
  // wood cell keeps the girth of the stem it hangs from (`foot`: see stems; how it bends and
  // breaks: see land and pw-fragments).
  function lift(world, box, ks, foot = null) {
    const { left, top, w } = box, n = ks.length;
    const girth = box.girth || (box.girth = girthOf(box.kind, w, box.h));
    const stem = foot && foot.length ? stems(box.kind, girth, w, box.h, foot) : null;
    const data = { x: new Int32Array(n), y: new Int32Array(n), color: new Uint32Array(n), byte: new Uint8Array(n), solid: new Uint8Array(n), girth: new Uint8Array(n) };
    ks.forEach((k, j) => {
      const x = left + (k % w), y = top + ((k / w) | 0), flags = PW.getFlags(world, x, y), color = PW.getLayer(world, 'deco', x, y);
      const wood = woodFlag(flags);
      data.x[j] = x; data.y[j] = y; data.color[j] = color;
      data.byte[j] = wood ? ((flags & PW.FLAG.CHARRED) ? 2 : 1) : 0; data.solid[j] = wood ? 1 : 0;
      data.girth[j] = wood ? (stem && stem[k]) || girth[k] || 1 : 0;
      PW.setLayer(world, 'deco', x, y, 0);
      PW.setFlag(world, x, y, PW.FLAG.FLORA | PW.FLAG.CHARRED | PW.FLAG.WOOD, false);
    });
    return data;
  }
  // (a whole tree's foot: the wood at the bottom of its trunk; a lying one's, its thickest wood)
  const trunkFoot = (record, box, ks) => footOf(box, ks, record.anchorX - box.left + 0.5, record.row - box.top - 1, Math.max(3, Math.round((record.size || 60) * 0.035)));
  function thickest(box, ks) {
    const girth = box.girth || (box.girth = girthOf(box.kind, box.w, box.h));
    let best = -1;
    for (const k of ks) if (box.kind[k] === 1 && (best < 0 || girth[k] > girth[best])) best = k;
    return best >= 0 ? [best] : [];
  }
  // Where a plant's weight bears down: the middle of its wood, moved over by the wind on its crown
  // (the wind's push on all of it, at the height of its middle over its foot, over its weight).
  function balance(world, record, cells) {
    const { left, top, w, n, kind } = cells;
    let m = 0, mx = 0, a = 0, ax = 0, ay = 0;
    for (let k = 0; k < n; k += 1) {
      if (!kind[k]) continue;
      const x = left + (k % w) + 0.5, y = top + ((k / w) | 0) + 0.5;
      a += 1; ax += x; ay += y;
      if (kind[k] === 1) { m += 1; mx += x; }
    }
    if (!m) return record.anchorX + 0.5;
    ax /= a; ay /= a;
    const wind = world.air && world.air.wind ? world.air.wind(ax | 0, ay | 0)[0] : 0;
    return mx / m + AIR_DRAG * a * Math.abs(wind) * wind * Math.max(0, record.row - ay) / (m * PW.GRAVITY);
  }
  // Leaves with no wood among them and nothing under them - the twig they grew on broken off, burnt
  // or splintered away, or lifted away with another plant whose crown they were tangled in - fall
  // (see fallLeaves): every clump of leaves, any plant's, in the box (x0, y0)-(x1, y1) touching no
  // wood, no ground or rubble, and not running on out of the box. (Leaves a cell apart are one
  // clump: a crown's ragged edge hangs on it.)
  function loose(world, particles, x0, y0, x1, y1) {
    const { CHUNK_SHIFT, CHUNK_MASK } = PW, FLORA = PW.FLAG.FLORA;
    x0 = Math.max(1, Math.floor(x0)); y0 = Math.max(1, Math.floor(y0));
    x1 = Math.min(world.width - 2, Math.ceil(x1)); y1 = Math.min(world.height - 2, Math.ceil(y1));
    if (x1 < x0 || y1 < y0) return 0;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h;
    // (1 wood, 2 leaf: read straight from the chunks' layers)
    const live = new Uint8Array(n);
    let leaves = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const c = (y >> CHUNK_SHIFT) * world.chunksX + (x >> CHUNK_SHIFT), l = (y & CHUNK_MASK) << CHUNK_SHIFT | (x & CHUNK_MASK);
        const flags = world.flags[c], deco = world.deco[c];
        if (!flags || !deco || !deco[l] || !(flags[l] & FLORA)) continue;
        if (woodFlag(flags[l])) live[(y - y0) * w + (x - x0)] = 1;
        else { live[(y - y0) * w + (x - x0)] = 2; leaves += 1; }
      }
    }
    if (!leaves) return 0;
    // (held: out from all that holds - wood, leaves lying on something, the box's edge - through
    // leaves a cell apart at most)
    const held = new Uint8Array(n), queue = [];
    for (let k = 0; k < n; k += 1) {
      if (!live[k]) continue;
      const x = k % w, y = (k / w) | 0;
      if (live[k] === 1 || x < 2 || y < 2 || x >= w - 2 || y >= h - 2 || holds(world, x0 + x, y0 + y + 1)) { held[k] = 1; queue.push(k); }
    }
    for (let q = 0; q < queue.length; q += 1) {
      const k = queue[q], x = k % w, y = (k / w) | 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (live[j] === 2 && !held[j]) { held[j] = 1; queue.push(j); }
        }
      }
    }
    const drop = [];
    for (let k = 0; k < n; k += 1) if (live[k] === 2 && !held[k]) drop.push(x0 + (k % w), y0 + ((k / w) | 0));
    if (drop.length) fallLeaves(world, particles, drop);
    return drop.length / 2;
  }
  // (the box a plant takes up, and a little round it)
  const looseAround = (world, particles, r) => loose(world, particles, r.x - 3, r.y - 3, r.x + r.width + 3, r.y + r.height + 3);
  // Where each piece cut off a plant was joined to the wood still standing (label 1): the middle of
  // its wood within a few cells of that - the break. (label -> [x, y] in the plant's box)
  function joints(label, kind, w, h) {
    const sums = new Map();
    for (let k = 0; k < kind.length; k += 1) {
      if (kind[k] !== 1 || label[k] < 2) continue;
      const x = k % w, y = (k / w) | 0;
      // (only its edge can be at a break)
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && kind[k - 1] === 1 && kind[k + 1] === 1 && kind[k - w] === 1 && kind[k + w] === 1) continue;
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (label[j] === 1 && kind[j] === 1) { near = true; break; }
        }
      }
      if (!near) continue;
      const s = sums.get(label[k]);
      if (s) { s[0] += x; s[1] += y; s[2] += 1; } else sums.set(label[k], [x, y, 1]);
    }
    const at = new Map();
    for (const [id, s] of sums) at.set(id, [s[0] / s[2] + 0.5, s[1] / s[2] + 0.5]);
    return at;
  }
  // (which way a plant leans to fall: down its slope, or as it happens to lean)
  function lean(world, record) {
    const x = record.anchorX, W = world.width;
    const a = world.groundTop[Math.max(0, x - 24)], b = world.groundTop[Math.min(W - 1, x + 24)];
    return b > a + 2 ? 1 : a > b + 2 ? -1 : (PW.hash2(record.anchorX, record.row) & 1 ? 1 : -1);
  }
  function settle(world, particles, record, from = null) {
    if (record.felled) return 0;
    let box = null;
    // A tree stands by its base. Where the ground under its trunk and roots gives way - a crater,
    // a slide, a dug hole - what is left of it must bear the tree: the middle of its weight (pushed
    // over by the wind on its crown) over the ground still under it, roots holding on either side
    // of a hole. If not, it goes over ("timber!") about the edge of that ground, the way its weight
    // hangs; with nothing under it at all, it drops free.
    if (!record.fallen && record.kind === 'tree' && record.foot) {
      const tw = Math.max(2, Math.round((record.size || 60) * 0.03));
      let trunk = 0, held = 0, x0 = Infinity, x1 = -Infinity;
      for (let k = 0; k < record.foot.length; k += 1) {
        if (record.foot[k] < 0) continue;
        const x = record.footX0 + k, ok = holds(world, x, record.foot[k] + 1);
        if (Math.abs(x - record.anchorX) <= tw) { trunk += 1; if (ok) held += 1; }
        if (ok) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
      }
      if (trunk && held < trunk) {
        box = cellsOf(world, record);
        if (x0 > x1) return timber(world, particles, record, lean(world, record), null, box);
        const cx = balance(world, record, box);
        if (cx < x0) return timber(world, particles, record, -1, x0, box);
        if (cx > x1 + 1) return timber(world, particles, record, 1, x1 + 1, box);
      }
    }
    if (!box) box = cellsOf(world, record);
    const { left, top, w, h, n, kind, cells } = box;
    if (!cells) { record.felled = true; return 0; }
    // label: 1 wood joined to the roots (wood at the foot - anywhere along it, for a fallen tree -
    // on ground or rubble), 2.. each piece of wood cut off from them; leaves take their wood's.
    const label = new Int32Array(n), queue = [];
    for (let k = 0; k < n; k += 1) {
      if (kind[k] !== 1) continue;
      const wx = left + (k % w), wy = top + ((k / w) | 0);
      if ((record.fallen || wy >= record.row - 6) && holds(world, wx, wy + 1)) { label[k] = 1; queue.push(k); }
    }
    const spread = (q0, test) => {
      for (let q = q0; q < queue.length; q += 1) {
        const k = queue[q], x = k % w, y = (k / w) | 0;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!label[j] && test(j)) { label[j] = label[k]; queue.push(j); }
        }
      }
    };
    spread(0, (j) => kind[j] === 1);
    let next = 2;
    for (let k = 0; k < n; k += 1) {
      if (kind[k] !== 1 || label[k]) continue;
      const q0 = queue.length;
      label[k] = next++; queue.push(k);
      spread(q0, (j) => kind[j] === 1);
    }
    // (leaves, nearest wood first: one sweep out from all the wood at once. A leaf grows on wood a
    // few cells from it: one further than that from any wood - its twig gone - is held by nothing,
    // and drops)
    const reach = record.kind === 'bush' || record.kind === 'reeds' ? 255 : Math.max(16, Math.round((record.size || 120) * 0.11));
    const far = new Uint8Array(n);
    for (let q = 0; q < queue.length; q += 1) {
      const k = queue[q], x = k % w, y = (k / w) | 0;
      if (far[k] >= reach) continue;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!label[j] && kind[j] === 2) { label[j] = label[k]; far[j] = far[k] + 1; queue.push(j); }
      }
    }
    // What fell: each piece, wood and its leaves, lifted out to fall on its own.
    const pieces = new Map();
    let held = 0, fell = 0;
    for (let k = 0; k < n; k += 1) {
      if (!kind[k]) continue;
      if (label[k] === 1) {
        // (what stands counts only above its stump: roots and a stump alone are a felled tree)
        if (record.fallen || top + ((k / w) | 0) < record.row - 8) held += 1;
        continue;
      }
      let list = pieces.get(label[k]);
      if (!list) pieces.set(label[k], list = []);
      list.push(k);
    }
    const side = from ? (record.anchorX >= from.x ? 1 : -1) : lean(world, record);
    const at = from ? null : joints(label, kind, w, h);
    for (const [id, ks] of pieces) {
      fell += ks.length;
      // (leaves left with no wood at all come down: blown off by a blast, or falling together)
      if (!id) {
        if (!from) { fallLeaves(world, particles, ks.flatMap((k) => [left + (k % w), top + ((k / w) | 0)])); continue; }
        for (const k of ks) {
          const wx = left + (k % w), wy = top + ((k / w) | 0);
          if (particles) shed(particles, wx, wy, PW.getLayer(world, 'deco', wx, wy), side * 10, -4, false, world);
          PW.setLayer(world, 'deco', wx, wy, 0);
          PW.setFlag(world, wx, wy, PW.FLAG.FLORA | PW.FLAG.CHARRED | PW.FLAG.WOOD, false);
        }
        continue;
      }
      // (its foot: where it broke off; or, cut loose all round, its end nearest the plant's foot)
      const joint = at && at.get(id);
      const foot = joint ? footOf(box, ks, joint[0], joint[1], 3) : record.fallen ? thickest(box, ks) : footOf(box, ks, record.anchorX - left + 0.5, record.row - top - 1, 0);
      fall(world, particles, lift(world, box, ks, foot), side, from, joint ? { x: left + joint[0], y: top + joint[1] } : null);
    }
    // (and what is left hangs together: leaves with nothing left holding them fall)
    looseAround(world, particles, record);
    if (!held) record.felled = true;
    return fell;
  }
  // A piece of a plant falls: flung away from a blast; or broken off where it was joined to the
  // tree, swinging down about the break before it comes away (a piece hanging from it already just
  // drops); or, cut loose all round, dropping free - the air and the wind turning and carrying it
  // as its shape and weight let them (see pw-fragments). (With no falling-piece system, it is drawn
  // back where it lands at once.)
  function fall(world, particles, data, side, from, joint = null) {
    if (!world.fragments) { land(world, particles, data, null); return; }
    let mx = 0, my = 0, m = 0;
    for (let j = 0; j < data.x.length; j += 1) if (data.solid[j]) { mx += data.x[j] + 0.5; my += data.y[j] + 0.5; m += 1; }
    mx /= m || 1; my /= m || 1;
    if (from && from.power) {
      const dx = mx - from.x, dy = my - from.y, d = Math.hypot(dx, dy) || 1;
      const v = Math.min(240, from.power * 9000 / (d + 40));
      const omega = (PW.hash2(mx | 0, 7) & 1 ? 1 : -1) * (0.5 + (PW.hash2(my | 0, 9) & 7) * 0.15);
      world.fragments.spawn({ data, flora: true, vx: dx / d * v, vy: dy / d * v * 0.5 - v * 0.3, omega, generation: 0 });
    } else if (joint && my < joint.y + 4) {
      world.fragments.spawn({ data, flora: true, pivot: joint, dir: Math.sign(mx - joint.x) || side, omega: 0, base: Math.ceil(joint.y) + 1 });
    } else world.fragments.spawn({ data, flora: true, vx: 0, vy: 0, omega: 0 });
  }
  // Something strikes a plant at (x, y) with `power` (about 1 for a fast lump of debris, 8 for a
  // heavy piece of a building). Leaves are not knocked off - what flies through a crown passes
  // through it. Wood breaks where it is struck if the blow is enough for its thickness (a twig
  // easily, a bough to a hard blow, a trunk only to a heavy one; charred wood far more easily),
  // snapping cleanly across the stem; what it held up falls next tick, with its leaves.
  const isWood = (world, x, y) => {
    const c = PW.getLayer(world, 'deco', x, y), f = PW.getFlags(world, x, y);
    return c !== 0 && (f & PW.FLAG.FLORA) !== 0 && woodFlag(f);
  };
  function strike(world, particles, x, y, power = 1) {
    const record = recordAt(world, x, y);
    if (!record) return false;
    if (!isWood(world, x, y)) return true;
    const charred = (PW.getFlags(world, x, y) & PW.FLAG.CHARRED) !== 0;
    const { across } = stem(world, x, y);
    if (power >= across * (charred ? 0.3 : 1)) {
      cut(world, particles, x, y);
      // (every plant whose crown is there looks again at what it still holds: crowns overlap)
      const dirty = world.floraDirty || (world.floraDirty = new Set());
      dirty.add(record);
      for (const r of world.floraIndex ? world.floraIndex.get(x >> 7) || [] : []) {
        if (!r.felled && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) dirty.add(r);
      }
    }
    return true;
  }
  // The wood at (x, y): how far it runs across and up, and which is its thickness.
  function stem(world, x, y) {
    let h = 1, v = 1;
    for (const d of [-1, 1]) {
      for (let k = 1; k < 12 && isWood(world, x + d * k, y); k += 1) h += 1;
      for (let k = 1; k < 12 && isWood(world, x, y + d * k); k += 1) v += 1;
    }
    return { h, v, across: Math.min(h, v), upright: v >= h };
  }
  // Snap the stem at (x, y): two rows across an upright stem, two columns across a lying bough,
  // thrown off as splinters (charcoal crumbles to ash and dust).
  function cut(world, particles, x, y) {
    const { upright } = stem(world, x, y);
    for (let a = 0; a < 2; a += 1) {
      for (const d of [-1, 1]) {
        for (let k = d < 0 ? 0 : 1; k < 12; k += 1) {
          const cx = upright ? x + d * k : x + a, cy = upright ? y + a : y + d * k;
          if (!isWood(world, cx, cy)) break;
          const color = PW.getLayer(world, 'deco', cx, cy);
          if (particles && (PW.hash2(cx, cy) & 1) === 0) shed(particles, cx, cy, color, ((PW.hash3(cx, cy, 3) & 63) - 32) * 0.5, -8, false, world);
          PW.setLayer(world, 'deco', cx, cy, 0);
          PW.setFlag(world, cx, cy, PW.FLAG.FLORA | PW.FLAG.CHARRED | PW.FLAG.WOOD, false);
        }
      }
    }
  }
  // Footing: every tick a few plants have the ground under their feet looked at - a plant whose
  // ground has given way since (dug out, slid or washed away, a rubble heap it lay on run off)
  // settles. (held: how many of its feet - its foot columns, or for a fallen plant the places it
  // lay on - have something under them; -1 for a plant with no feet kept)
  const FOOTING_PER_TICK = 48;
  function heldBy(world, r) {
    let n = 0;
    if (r.foot) {
      for (let k = 0; k < r.foot.length; k += 1) if (r.foot[k] >= 0 && holds(world, r.footX0 + k, r.foot[k] + 1)) n += 1;
      return n;
    }
    if (!r.rest) return -1;
    for (let k = 0; k < r.rest.length; k += 2) if (holds(world, r.rest[k], r.rest[k + 1] + 1)) n += 1;
    return n;
  }
  function footing(world) {
    const list = world.flora;
    if (!list || !list.length) return;
    let i = world.floraFooting || 0;
    for (let c = Math.min(FOOTING_PER_TICK, list.length); c > 0; c -= 1, i += 1) {
      if (i >= list.length) i = 0;
      const r = list[i];
      if (r.felled) continue;
      const held = heldBy(world, r);
      if (held < 0) continue;
      if (r.held !== undefined && held < r.held) (world.floraDirty || (world.floraDirty = new Set())).add(r);
      r.held = held;
    }
    world.floraFooting = i;
  }
  // The plants struck or shaken lately settle (a couple of milliseconds' worth a tick).
  function step(world, particles) {
    footing(world);
    const dirty = world.floraDirty;
    if (!dirty || !dirty.size) return 0;
    let n = 0, felled = 0;
    const t0 = performance.now();
    for (const record of dirty) {
      dirty.delete(record);
      settle(world, particles, record, record.from || null);
      record.from = null;
      if (record.felled) felled += 1;
      n += 1;
      if (performance.now() - t0 > 2) break;
    }
    if (felled) { world.flora = world.flora.filter((r) => !r.felled); world.floraIndex = null; }
    return n;
  }
  // The plant drawn at (x, y), found through a coarse index of their boxes.
  function recordAt(world, x, y) {
    if (!world.flora || !(PW.getFlags(world, x, y) & PW.FLAG.FLORA)) return null;
    if (!world.floraIndex || world.floraIndex.count !== world.flora.length) {
      const index = new Map();
      for (const r of world.flora) for (let b = r.x >> 7; b <= (r.x + r.width) >> 7; b += 1) { let list = index.get(b); if (!list) index.set(b, list = []); list.push(r); }
      index.count = world.flora.length;
      world.floraIndex = index;
    }
    for (const r of world.floraIndex.get(x >> 7) || []) {
      if (!r.felled && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return r;
    }
    return null;
  }
  // After a blast or a slide: the plants it reached settle - whatever lost its footing or was cut
  // off comes down with the ground. Grass and flowers left in the air drop too.
  // (tufts: the box grass and flowers are looked at in, when it is smaller than the plants' - a
  // slide's reaches far up for tall trees, but a tuft stands only a few cells over its ground)
  function afterBlast(world, particles, box, from = null, tufts = box) {
    if (!world.flora) return 0;
    let felled = 0;
    const { mat, width: W } = world;
    dropTufts(world, particles, tufts);
    for (const record of world.flora) {
      if (record.x > box.x1 || record.x + record.width < box.x0 || record.y > box.y1 || record.y + record.height < box.y0) continue;
      // (only a plant that was hit, or whose footing or trunk is gone, needs looking at closely)
      let shaken = record.hit;
      if (!shaken && record.foot) {
        for (let k = 0; k < record.foot.length && !shaken; k += 1) if (record.foot[k] >= 0 && !holds(world, record.footX0 + k, record.foot[k] + 1)) shaken = true;
      }
      if (!shaken && record.rest) shaken = heldBy(world, record) < record.rest.length / 2;
      if (!shaken && record.trunk) {
        const { x0, y0, x1, y1 } = record.trunk;
        const steps = Math.max(2, Math.round(Math.abs(y1 - y0) / 3));
        const open = (x, y) => (mat[y * W + x] & ID_MASK) === M.AIR && !PW.getLayer(world, 'deco', x, y);
        for (let s = 0; s <= steps && !shaken; s += 1) {
          const x = Math.round(x0 + (x1 - x0) * s / steps), y = Math.round(y0 + (y1 - y0) * s / steps);
          if (open(x, y) && open(x - 1, y) && open(x + 1, y)) shaken = true;
        }
      }
      // A blast that reached it pushes it: knocked over whole, or close to a strong one, broken
      // apart at its boughs and trunk.
      if (from && from.r && record.blasted) {
        record.blasted = false; record.hit = false;
        blastTree(world, particles, record, from);
        if (record.felled) felled += 1;
        continue;
      }
      if (!shaken) continue;
      record.hit = false;
      // (a blast's at once; a slide's over the next few ticks - it can shake a whole forested
      // flank at once)
      if (!particles || from) { settle(world, particles, record, from); if (record.felled) felled += 1; continue; }
      record.from = from;
      (world.floraDirty || (world.floraDirty = new Set())).add(record);
    }
    if (felled) { world.flora = world.flora.filter((record) => !record.felled); world.floraIndex = null; }
    return felled;
  }
  // A blast of radius r and power p at (from.x, from.y) reached the plant. How hard it pushed it:
  // its strength over its distance from the plant. Close to a strong blast the plant is broken
  // apart - its trunk and boughs snap where the blast reached them and the pieces are flung away;
  // further off it is knocked over whole ("timber!"), swinging down about its foot away from the
  // blast; further still it stands.
  function blastTree(world, particles, record, from) {
    const nx = Math.max(record.x, Math.min(record.x + record.width, from.x)), ny = Math.max(record.y, Math.min(record.y + record.height, from.y));
    const d = Math.hypot(from.x - nx, from.y - ny), push = from.power * from.r / (d + from.r * 0.5);
    const side = record.anchorX >= from.x ? 1 : -1;
    if (d < from.r * 0.6 && from.power >= 1) {
      const { left, top, w, n, kind } = cellsOf(world, record);
      for (let k = 0; k < n; k += 1) {
        if (kind[k] !== 1) continue;
        const x = left + (k % w), y = top + ((k / w) | 0);
        if (x % 6 || y % 6 || Math.hypot(x - from.x, y - from.y) > from.r) continue;
        if (isWood(world, x, y)) cut(world, particles, x, y);
      }
      settle(world, particles, record, from);
    } else if (push > 0.3 && !record.fallen) topple(world, particles, record, side, 0.25 + push * 0.4);
    else settle(world, particles, record, from);
  }
  // A tree whose ground was hollowed out comes down whole: swinging over about the edge of the
  // ground still under it (pivotX), or - nothing under it at all - dropping, as the slope it stood
  // on tips it.
  function timber(world, particles, record, side, pivotX, box = cellsOf(world, record)) {
    const { n, kind } = box;
    const ks = [];
    for (let k = 0; k < n; k += 1) if (kind[k]) ks.push(k);
    record.felled = true;
    if (!ks.length) return 0;
    const data = lift(world, box, ks, trunkFoot(record, box, ks));
    if (!world.fragments) land(world, particles, data, null);
    else if (pivotX === null) world.fragments.spawn({ data, flora: true, vx: 0, vy: 0, omega: side * 0.08 });
    else world.fragments.spawn({ data, flora: true, pivot: { x: pivotX, y: record.row }, dir: side, omega: side * 0.05, base: record.row + 1 });
    world.floraIndex = null;
    // (the leaves of the crowns it was tangled in, left with nothing holding them, fall)
    looseAround(world, particles, record);
    return ks.length;
  }
  // The whole plant falls as one piece, swinging down about the foot of its trunk.
  function topple(world, particles, record, side, omega) {
    const box = cellsOf(world, record), { n, kind } = box;
    const ks = [];
    for (let k = 0; k < n; k += 1) if (kind[k]) ks.push(k);
    record.felled = true;
    if (!ks.length) return;
    const data = lift(world, box, ks, trunkFoot(record, box, ks));
    if (world.fragments) world.fragments.spawn({ data, flora: true, pivot: { x: record.anchorX, y: record.row }, dir: side, omega: side * omega, base: record.row + 1 });
    else land(world, particles, data, null);
    looseAround(world, particles, record);
  }
  // A plant or a piece of one comes to rest: drawn again where it lies, as a fallen plant of its own
  // that can burn, be struck and be knocked about again. Where it was pressed into the ground or
  // into another plant, its twigs and leaves bend up out of it to lie along it, as far as their
  // girth lets them (see bendReach); what cannot bend so far is broken off, splintered. Its wood
  // lies over other plants' leaves.
  const REST_POINTS = 24;       // places it lies on, kept to look at again (see footing)
  function land(world, particles, data, piece) {
    const { mat, width: W, height: H } = world;
    const room = (x, y, wood) => {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || (mat[y * W + x] & ID_MASK) !== M.AIR || PW.getLayer(world, 'back', x, y)) return false;
      if (!PW.getLayer(world, 'deco', x, y)) return true;
      const f = PW.getFlags(world, x, y);
      return wood && (f & PW.FLAG.FLORA) !== 0 && !woodFlag(f);
    };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const kept = [];
    for (let j = 0; j < data.x.length; j += 1) {
      const x = data.x[j], wood = data.byte[j] !== 0;
      let y = data.y[j];
      if (!room(x, y, wood)) {
        const reach = wood ? bendReach(data.girth ? data.girth[j] || 1 : 1) : LEAF_BEND;
        let d = 1;
        while (d <= reach && !room(x, y - d, wood)) d += 1;
        if (d > reach) {
          if (particles && wood && (j & 3) === 0) particles.spawn(x + 0.5, y - 0.5, ((PW.hash2(x, y) & 63) - 32) * 0.5, -10, WOOD_DEBRIS, data.color[j], PW.PARTICLE.LAND, 6);
          continue;
        }
        y -= d;
      }
      PW.setLayer(world, 'deco', x, y, data.color[j]);
      PW.setFlag(world, x, y, PW.FLAG.FLORA);
      PW.setFlag(world, x, y, PW.FLAG.WOOD, wood);
      PW.setFlag(world, x, y, PW.FLAG.CHARRED, data.byte[j] === 2);
      kept.push(x, y);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!kept.length) return null;
    const width = x1 - x0 + 1, height = y1 - y0 + 1, mask = new Uint8Array((width * height + 7) >> 3);
    const lies = [];
    for (let j = 0; j < kept.length; j += 2) {
      const x = kept[j], y = kept[j + 1], k = (y - y0) * width + (x - x0);
      mask[k >> 3] |= 1 << (k & 7);
      if (woodFlag(PW.getFlags(world, x, y)) && holds(world, x, y + 1)) lies.push(x, y);
    }
    const rest = [];
    for (let k = 0, stride = Math.ceil(lies.length / 2 / REST_POINTS) * 2; k < lies.length; k += stride) rest.push(lies[k], lies[k + 1]);
    const record = { kind: 'tree', type: 'fallen', fallen: true, anchorX: (x0 + x1) >> 1, row: y1, x: x0, y: y0, width, height, mask, foot: null, footX0: 0, trunk: null, rest: Int32Array.from(rest) };
    (world.flora || (world.flora = [])).push(record);
    world.floraIndex = null;
    // (leaves it came down with whose wood was splintered off, lying on nothing, fall on)
    looseAround(world, particles, record);
    void piece;
    return record;
  }
  // Grass blades and flowers whose ground is gone (no plant cell or solid ground under them, and
  // not part of a tree or bush) drop away as leaves.
  function dropTufts(world, particles, box) {
    const { mat, width: W } = world;
    const inPlant = (x, y) => (world.flora || []).some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    const F = PW.PARTICLE;
    const { CHUNK_SHIFT, CHUNK_MASK } = PW, size = 1 << CHUNK_SHIFT;
    const x0 = Math.max(1, Math.floor(box.x0)), x1 = Math.min(W - 2, Math.ceil(box.x1));
    const y0 = Math.max(1, Math.floor(box.y0)), y1 = Math.min(world.height - 2, Math.ceil(box.y1));
    // (chunk by chunk: one with no plant marks at all - most of a mountain's inside - is passed over)
    for (let cy = y0 >> CHUNK_SHIFT; cy <= y1 >> CHUNK_SHIFT; cy += 1) for (let cx = x0 >> CHUNK_SHIFT; cx <= x1 >> CHUNK_SHIFT; cx += 1) {
      const flags = world.flags[cy * world.chunksX + cx];
      if (!flags) continue;
      for (let x = Math.max(x0, cx * size); x <= Math.min(x1, cx * size + size - 1); x += 1) for (let y = Math.max(y0, cy * size); y <= Math.min(y1, cy * size + size - 1); y += 1) {
        if (!(flags[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] & PW.FLAG.FLORA) || !PW.getLayer(world, 'deco', x, y)) continue;
        const below = mat[(y + 1) * W + x] & ID_MASK;
        if (PW.mat.phase[below] >= PW.PHASE.POWDER || PW.getLayer(world, 'deco', x, y + 1) || inPlant(x, y)) continue;
        // (the whole tuft above it goes)
        for (let k = y; k >= y - 30 && (PW.getFlags(world, x, k) & PW.FLAG.FLORA) && PW.getLayer(world, 'deco', x, k); k -= 1) {
          const color = PW.getLayer(world, 'deco', x, k);
          PW.setLayer(world, 'deco', x, k, 0);
          PW.setFlag(world, x, k, PW.FLAG.FLORA | PW.FLAG.WOOD | PW.FLAG.CHARRED, false);
          if (particles && F && (PW.hash2(x, k) & 3) === 0) particles.spawn(x + 0.5, k + 0.5, ((PW.hash2(k, x) & 63) - 32), -10, 0, color, F.LEAF, 1.5);
        }
      }
    }
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

  // Columns taken by settlements (streets, runways, fields, pumps, defences) and by the mountain
  // outposts' and bunkers' works, plus a margin.
  function blockedColumns(world, margin = 24) {
    const blocked = new Uint8Array(world.width);
    for (const holding of [...(world.settlements || []), ...(world.outposts || []), ...(world.bunkers || [])]) {
      for (const [a, b] of holding.footprints || [[holding.streetLeft, holding.streetRight]]) {
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
      // (the wild land is mostly mountainside: forest closes in on its slopes, as in a valley)
      const density = forest(x) + (layout.baseY - world.groundTop[x] > 120 ? 0.3 : 0);
      const gap = density > 0.25 ? random.int(12, 28) : density > -0.2 ? random.int(26, 60) : random.int(50, 110);
      x += gap;
      // Skip straight over streets, runways and fields: only wild land is sampled.
      while (x < W - 80 && blocked[x]) x += 1;
      if (x >= W - 80) continue;
      stats.candidates += 1;
      if (nearWater(x, 46)) { stats.water += 1; continue; }
      const slope = slopeAt(x);
      // Old scree is colonised by pioneers: here and there a conifer, a birch or a bush where the
      // apron has eased off; the rest of it stays bare.
      const pioneer = topId(x) === M.GRAVEL && slope < 1.2 && random() < 0.55;
      if (!soil(x) && !pioneer) { stats.ground += 1; stats.tops[PW.mat.names[topId(x)]] = (stats.tops[PW.mat.names[topId(x)]] || 0) + 1; continue; }
      // (high on a mountain only conifers and dead snags hold on, near the tree line)
      const altitude = Math.max(layout.baseY - world.groundTop[x], layout.relief && layout.relief[x] > 0.5 ? 540 : 0);
      const roll = random();
      let type, size;
      if (pioneer) { type = roll < 0.55 ? 'conifer' : roll < 0.75 ? 'birch' : 'bush'; size = type === 'bush' ? random.range(12, 22) : random.range(90, 170); }
      else if (slope > 1.5) { type = 'bush'; size = random.range(12, 24); }
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
        if (bx > 40 && bx < W - 40 && soil(bx) && slopeAt(bx) < 1.6 && !nearWater(bx, 40) && clearOf(bx, bushSize * 1.6) && footClear(bx, bushSize * 1.6)) {
          grow('bush', bx, bushSize);
        }
      }
    }
    // The wild land always holds some woodland: more trees on gentle soil if chance left too few.
    for (let i = 0; i < 12000 && trees < MIN_TREES; i += 1) {
      const x = random.int(80, W - 80);
      const scree = topId(x) === M.GRAVEL, slope = slopeAt(x);
      // (conifers hold on to mountainsides up to about 56°; broadleaves want gentler ground)
      if (blocked[x] || !(soil(x) || scree) || nearWater(x, 46) || slope > 1.5) continue;
      const type = scree || slope > 1 || layout.baseY - world.groundTop[x] > 260 ? 'conifer' : random() < 0.6 ? 'broadleaf' : 'birch';
      const size = type === 'conifer' ? random.range(140, 240) : random.range(110, 190);
      const half = type === 'conifer' ? size * 0.3 : size * 0.55;
      // (hedgerow trees may stand close to fields and streets, their crowns reaching over)
      if (!clearOf(x, half * 0.35) || !footClear(x, size * 0.08)) continue;
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
    // Rocks gather where mountains shed them: thick near the summits and on the talus at their
    // feet, few out on the flats.
    const talus = layout.talus || [];
    const rockiness = (x) => {
      const high = layout.relief ? Math.max(0, Math.min(1, (layout.relief[x] - 0.55) / 0.3)) : 0;
      const foot = talus.some((a) => x >= a.x0 - 30 && x <= a.x1 + 30) ? 1 : 0;
      return 0.18 + 0.82 * Math.max(high, foot);
    };
    let cover = 0;
    for (let i = 0, n = Math.round(1100 * W / 16384); i < n; i += 1) {
      const x = random.int(60, W - 60);
      if (random() > rockiness(x)) continue;
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
    const why = stats.coverMisses = { blocked: 0, ground: 0, slope: 0, crowded: 0, place: 0 };
    for (let i = 0; i < 12000 && cover < MIN_COVER_ROCKS; i += 1) {
      const x = random.int(60, W - 60), size = random.range(11, 15);
      if (blocked[x]) { why.blocked += 1; continue; }
      if (!rocky(x) || nearWater(x, 8)) { why.ground += 1; continue; }
      if (slopeAt(x) > 1.3) { why.slope += 1; continue; }
      if (!clearOf(x, size) || !footClear(x, size * 0.6)) { why.crowded += 1; continue; }
      if (coverRock(x, size)) cover += 1; else why.place += 1;
    }
    stats.cover = cover;
    // Reeds in the shallows and on the banks of lakes, rising from the bed.
    for (const lake of layout.lakes) {
      if (lake.left === undefined) continue;
      for (const [edge, inward] of [[lake.left, 1], [lake.right, -1]]) {
        const spots = [];
        for (let d = -24; d <= 70; d += 1) {
          const x = edge + inward * d;
          // (and not where a boulder already sits on the bank)
          if (x < 2 || x >= W - 2 || blocked[x] || !footClear(x, 10)) continue;
          const surface = world.groundTop[x];
          const bed = PW.supportBelow(world, x, surface, true);
          const depth = bed - surface;
          const wet = (PW.get(world, x, surface) & ID_MASK) === M.WATER;
          // In the shallows, or on the bank right at the waterline (not up a steep bank, whose loose
          // shore sand slides down into the lake).
          if ((wet && depth <= 22) || (!wet && d < 0 && lake.level - surface <= 5 && (soil(x) || topId(x) === M.SAND) && slopeAt(x) <= 0.5)) spots.push(x);
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

  PW.flora = { plant, fell, regenerate, afterBlast, strike, settle, step, recordAt, shed, land, topple, cut, makeGround, frozenGround, FLAT, tuft, bendReach, AIR_DRAG, loose };
  PW.vegetation = { broadleaf, conifer, birch, bush, deadTree, boulder, reeds, stamp, createSprite, foliage, limb, trim, spanDrop, spanRise };
})();
