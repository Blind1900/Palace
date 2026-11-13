'use strict';
// Vegetation drawn cell by cell into the deco layer: branching broadleaf trees, conifers, birches,
// bushes, dead trees, reeds, boulders, grass tufts and flowers. Deco never blocks units.
(function () {
  const PW = window.PW;
  const { M } = PW;

  const rgb = (r, g, b) => PW.abgr(r, g, b);
  const LEAF = { deep: [26, 46, 28], shadow: [36, 64, 34], base: [52, 90, 44], light: [74, 118, 56], high: [98, 142, 70] };
  const NEEDLE = { deep: [20, 40, 32], shadow: [28, 54, 40], base: [40, 76, 52], light: [58, 100, 64], high: [80, 124, 78] };
  const BIRCH_LEAF = { deep: [42, 66, 30], shadow: [58, 88, 38], base: [80, 116, 48], light: [104, 140, 60], high: [128, 164, 74] };
  const BARK = { dark: [44, 34, 26], base: [70, 53, 38], light: [94, 72, 51] };
  const DEAD_BARK = { dark: [52, 46, 42], base: [84, 76, 68], light: [112, 102, 92] };
  const shadeColor = (rgbArray, k) => rgb(Math.min(255, rgbArray[0] * k | 0), Math.min(255, rgbArray[1] * k | 0), Math.min(255, rgbArray[2] * k | 0));

  // A sprite is a small cell buffer with its anchor at the bottom-centre (base of the trunk).
  function createSprite(width, height) {
    return { width, height, pixels: new Uint32Array(width * height), anchorX: width >> 1, anchorY: height - 1 };
  }
  function put(sprite, x, y, color) {
    x |= 0; y |= 0;
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
    return out;
  }
  // Roomy canvas with the anchor (trunk base) at the bottom centre.
  function canvasFor(height, widthFactor, heightFactor = 1.45) {
    const sprite = createSprite(Math.round(height * widthFactor), Math.round(height * heightFactor) + 4);
    sprite.anchorY = sprite.height - 2;
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

  function broadleaf(random, height) {
    const sprite = canvasFor(height, 1.9);
    const base = { x: sprite.anchorX, y: sprite.anchorY };
    const trunkTop = { x: base.x + random.range(-0.06, 0.06) * height, y: base.y - height * random.range(0.42, 0.55) };
    const trunkW = Math.max(4, height * random.range(0.055, 0.07));
    const clumps = [];
    // Root flare at the base.
    limb(sprite, base.x - trunkW * 0.9, base.y, base.x, base.y - trunkW * 1.4, trunkW * 0.5, trunkW * 0.7, BARK, random);
    limb(sprite, base.x + trunkW * 0.9, base.y, base.x, base.y - trunkW * 1.4, trunkW * 0.5, trunkW * 0.7, BARK, random);
    limb(sprite, base.x, base.y, trunkTop.x, trunkTop.y, trunkW, trunkW * 0.62, BARK, random, random.range(-2, 2));
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

  function conifer(random, height) {
    const maxHalf = height * random.range(0.2, 0.27);
    const sprite = createSprite(Math.round(maxHalf * 2.6 + 12), height + 8);
    sprite.anchorY = sprite.height - 2;
    const cx = sprite.anchorX, baseY = sprite.anchorY;
    const trunkW = Math.max(3, height * 0.04);
    limb(sprite, cx, baseY, cx + random.range(-1, 1), baseY - height * 0.95, trunkW, 1.5, BARK, random);
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
        const reach = half * (0.25 + 0.75 * v) * (1 + noise(y * 1.7 + tier * 13) * 0.18);
        for (let x = Math.floor(cx - reach); x <= cx + reach; x += 1) {
          const u = (x - cx) / Math.max(1, reach);
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

  function birch(random, height) {
    const sprite = canvasFor(height, 1.1, 1.3);
    const cx = sprite.anchorX, baseY = sprite.anchorY;
    const lean = random.range(-0.08, 0.08) * height;
    const trunkW = Math.max(3, height * 0.04);
    const bark = { dark: [52, 48, 46], base: [196, 192, 178], light: [226, 224, 212] };
    limb(sprite, cx, baseY, cx + lean, baseY - height * 0.9, trunkW, 1.6, bark, random);
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

  function bush(random, height) {
    const width = Math.round(height * 3);
    const sprite = createSprite(width, Math.round(height * 1.6) + 2);
    sprite.anchorY = sprite.height - 1;
    const clumps = [];
    const count = random.int(2, 4);
    const ground = sprite.anchorY;
    for (let i = 0; i < count; i += 1) {
      clumps.push({ x: width / 2 + (i - (count - 1) / 2) * height * 0.45 + random.range(-3, 3), y: ground - height * random.range(0.4, 0.55),
        r: height * random.range(0.42, 0.6), sx: 1.25, sy: 0.9 });
    }
    foliage(sprite, clumps, random() < 0.5 ? LEAF : BIRCH_LEAF, random, { clusterSize: 3, edge: 0.25 });
    // Nothing below the ground line: the bush sits on the surface.
    for (let x = 0; x < width; x += 1) put(sprite, x, ground, 0);
    return trim(sprite);
  }

  function deadTree(random, height) {
    const sprite = canvasFor(height, 1.4, 1.1);
    const base = { x: sprite.anchorX, y: sprite.anchorY };
    const trunkW = Math.max(3, height * 0.05);
    const top = { x: base.x + random.range(-0.1, 0.1) * height, y: base.y - height * 0.6 };
    limb(sprite, base.x, base.y, top.x, top.y, trunkW, trunkW * 0.5, DEAD_BARK, random, random.range(-3, 3));
    function branch(x, y, angle, length, w, depth) {
      const ex = x + Math.cos(angle) * length, ey = y + Math.sin(angle) * length;
      limb(sprite, x, y, ex, ey, w, Math.max(1, w * 0.55), DEAD_BARK, random, random.range(-2, 2));
      if (depth <= 0) return;
      for (let i = 0; i < 2; i += 1) branch(ex, ey, angle + random.range(0.2, 0.7) * (i ? 1 : -1), length * 0.66, Math.max(1, w * 0.6), depth - 1);
    }
    for (let i = 0; i < 3; i += 1) branch(top.x, top.y, -Math.PI / 2 + (i - 1) * random.range(0.4, 0.8), height * 0.25, trunkW * 0.55, 2);
    return trim(sprite);
  }

  function boulder(random, size) {
    const width = Math.round(size * 1.6), height = Math.round(size);
    const sprite = createSprite(width + 2, height + 2);
    const noise = PW.createNoise2D(random.int(1, 1e9), Math.max(3, size / 4));
    const cx = (width + 2) / 2, cy = height * 0.62;
    const tone = random.range(0.85, 1.12);
    for (let y = 0; y < height + 2; y += 1) {
      for (let x = 0; x < width + 2; x += 1) {
        const dx = (x - cx) / (width / 2), dy = (y - cy) / (height * 0.62);
        const d = Math.hypot(dx, dy) + noise(x, y) * 0.18;
        if (d > 1 || y > height + 1) continue;
        const light = -dx * 0.6 - dy * 0.8 + noise(x * 2, y * 2) * 0.3;
        let c = light > 0.6 ? [138, 130, 118] : light > 0.1 ? [112, 104, 94] : light > -0.45 ? [90, 84, 76] : [66, 61, 56];
        if (dy < -0.35 && noise(x * 3, y * 3) > 0.15) c = [70, 96, 50];   // moss on top
        if (d > 0.9) c = c.map((v) => v * 0.8);
        put(sprite, x, y, shadeColor(c, tone));
      }
    }
    sprite.anchorY = Math.round(height * 0.82);   // sits partly sunk into the soil
    return sprite;
  }

  function reeds(random, height) {
    const width = random.int(6, 14);
    const sprite = createSprite(width, height + 2);
    for (let i = 0; i < width; i += random.int(1, 3)) {
      const h = height * random.range(0.55, 1);
      const lean = random.range(-0.25, 0.25);
      for (let y = 0; y < h; y += 1) {
        const x = Math.round(i + lean * y * 0.4);
        const shade = y > h * 0.7 ? [86, 112, 54] : [64, 92, 44];
        put(sprite, x, height + 1 - y, rgb(shade[0], shade[1], shade[2]));
      }
      if (random() < 0.45) {   // cattail head
        const x = Math.round(i + lean * h * 0.4);
        for (let y = 0; y < 5; y += 1) put(sprite, x, height + 1 - Math.round(h * 0.82) + y, rgb(92, 58, 34));
      }
    }
    return sprite;
  }

  // Blit a sprite into the deco layer with its anchor at (x, groundY).
  function stamp(world, sprite, x, groundY) {
    const left = Math.round(x - sprite.anchorX), top = Math.round(groundY - sprite.anchorY);
    for (let sy = 0; sy < sprite.height; sy += 1) {
      for (let sx = 0; sx < sprite.width; sx += 1) {
        const color = sprite.pixels[sy * sprite.width + sx];
        if (color) PW.setLayer(world, 'deco', left + sx, top + sy, color);
      }
    }
    return { x: left, y: top, width: sprite.width, height: sprite.height };
  }

  function grassTufts(world, layout, random, blocked) {
    const meadow = PW.createNoise1D(random.int(1, 1e9), 260);
    const clumping = PW.createNoise1D(random.int(1, 1e9), 9);
    const blades = [[88, 124, 54], [64, 96, 42], [100, 136, 62], [76, 110, 48], [110, 140, 66]];
    const flowers = [[226, 220, 206], [236, 200, 70], [180, 120, 210], [220, 96, 110], [150, 190, 240]];
    for (let x = 2; x < world.width - 2; x += 1) {
      if (blocked(x)) continue;
      const y = world.groundTop[x];
      if ((PW.get(world, x, y) & 63) !== M.GRASS) continue;
      const tall = Math.max(0, meadow(x)) * 9;
      const clump = clumping(x) + ((PW.hash2(x, 3) & 15) - 7.5) / 20;
      if (clump < -0.25) continue;
      const h = Math.round(2 + clump * 4 + tall * (0.6 + (PW.hash2(x, 5) & 7) / 14));
      const color = blades[PW.hash2(x, 9) % blades.length];
      const lean = (PW.hash2(x, 11) & 3) === 0 ? ((PW.hash2(x, 13) & 1) ? 1 : -1) : 0;
      for (let i = 1; i <= h; i += 1) {
        const bx = x + (lean && i > h * 0.6 ? lean : 0);
        const k = i === h ? 1.15 : i < 2 ? 0.85 : 1;
        PW.setLayer(world, 'deco', bx, y - i, shadeColor(color, k));
      }
      if ((PW.hash2(x, 17) % 97) === 0 && h >= 3) {
        const f = flowers[PW.hash2(x, 19) % flowers.length];
        const top = y - h - 1;
        PW.setLayer(world, 'deco', x, top, rgb(f[0], f[1], f[2]));
        PW.setLayer(world, 'deco', x + 1, top, rgb(f[0], f[1], f[2]));
        PW.setLayer(world, 'deco', x, top - 1, shadeColor(f, 1.12));
        PW.setLayer(world, 'deco', x + 1, top + 1, rgb(236, 210, 80));
      }
    }
  }

  function generateVegetation(world, layout, seed) {
    const random = PW.createRandom(seed + 991);
    const W = world.width;
    // Settlement sites get park trees from their districts instead of wild growth.
    const inSite = (x, margin = 60) => layout.sites.some((site) => x > site.x0 - margin && x < site.x1 + margin);
    const nearWater = (x, margin) => layout.lakes.some((lake) => x > (lake.left ?? lake.x - lake.half) - margin
      && x < (lake.right ?? lake.x + lake.half) + margin);
    const underWater = (x) => (PW.get(world, x, world.groundTop[x]) & 63) === M.WATER;
    const forest = PW.createNoise1D(seed + 7, 600);
    const trees = [];
    const slopeAt = (x) => Math.abs(world.groundTop[Math.min(W - 1, x + 6)] - world.groundTop[Math.max(0, x - 6)]) / 12;

    for (let x = 80; x < W - 80;) {
      const density = forest(x);
      const gap = density > 0.25 ? random.int(40, 110) : density > -0.2 ? random.int(120, 320) : random.int(300, 700);
      x += gap;
      if (x >= W - 80 || inSite(x) || nearWater(x, 30) || underWater(x)) continue;
      const slope = slopeAt(x);
      if (slope > 1.1) continue;
      const ground = world.groundTop[x];
      const altitude = layout.baseY - ground;
      let sprite;
      const roll = random();
      if (altitude > 520) sprite = roll < 0.55 ? deadTree(random, random.range(70, 130)) : conifer(random, random.range(110, 190));
      else if (altitude > 260) sprite = roll < 0.7 ? conifer(random, random.range(150, 290)) : broadleaf(random, random.range(120, 200));
      else if (roll < 0.5) sprite = broadleaf(random, random.range(120, 230));
      else if (roll < 0.72) sprite = conifer(random, random.range(140, 260));
      else if (roll < 0.86) sprite = birch(random, random.range(110, 180));
      else sprite = bush(random, random.range(18, 38));
      trees.push({ ...stamp(world, sprite, x, ground + 1), kind: 'tree' });
      // Undergrowth around trunks.
      if (random() < 0.6) {
        const bx = x + random.int(-50, 50);
        if (!inSite(bx) && !underWater(bx) && slopeAt(bx) < 1) {
          trees.push({ ...stamp(world, bush(random, random.range(14, 30)), bx, world.groundTop[bx] + 1), kind: 'bush' });
        }
      }
    }
    // Boulders, more of them on high and steep ground.
    for (let i = 0; i < 260; i += 1) {
      const x = random.int(60, W - 60);
      if (inSite(x, 20) || underWater(x)) continue;
      const altitude = layout.baseY - world.groundTop[x];
      if (altitude < 120 && random() < 0.55) continue;
      const size = random.range(6, altitude > 300 ? 26 : 16);
      trees.push({ ...stamp(world, boulder(random, size), x, world.groundTop[x]), kind: 'boulder' });
    }
    // Reeds along lake shores.
    for (const lake of layout.lakes) {
      if (lake.left === undefined) continue;
      for (const edge of [lake.left, lake.right]) {
        for (let k = 0; k < 7; k += 1) {
          const x = edge + (edge === lake.left ? 1 : -1) * random.int(-6, 40);
          trees.push({ ...stamp(world, reeds(random, random.range(14, 34)), x, world.groundTop[x]), kind: 'reeds' });
        }
      }
    }
    grassTufts(world, layout, random, (x) => inSite(x, -40));
    layout.vegetation = trees;
    return trees;
  }

  PW.generateVegetation = generateVegetation;
  PW.vegetation = { broadleaf, conifer, birch, bush, deadTree, boulder, reeds, stamp, createSprite, foliage, limb };
})();
