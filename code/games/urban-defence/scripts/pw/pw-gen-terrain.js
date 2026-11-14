'use strict';
// Terrain generation for the pixel world: a wide map with five settlement sites (left base, three
// neutral towns, right base), mountains and lakes between them, soil strata, ore nodes and caves.
(function () {
  const PW = window.PW;
  const { M } = PW;

  const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  // A neutral site's relief over its level: a tilt of up to 80 cells across it and a swell of
  // 10-26 cells every 600-1000 (slopes up to about 1:3). Drawn from the site's position, so the
  // rest of the layout's random sequence is unchanged.
  function siteRelief(site, x) {
    if (site.kind !== 'neutral') return 0;
    const h = (k) => (PW.hash2(site.x0, k) & 1023) / 1023;
    const tilt = (h(1) * 2 - 1) * 80, amp = 10 + h(2) * 16, period = 600 + h(3) * 400, phase = h(4) * Math.PI * 2;
    const u = (x - site.x0) / (site.x1 - site.x0);
    return tilt * (smooth(u) - 0.5) + amp * Math.sin((x - site.x0) / period * Math.PI * 2 + phase);
  }

  function planLayout(world, random) {
    const W = world.width;
    const baseY = Math.round(world.height * 0.44);
    const baseWidth = 2600, neutralWidth = 1500, margin = 420;
    const wild = (W - 2 * margin - 2 * baseWidth - 3 * neutralWidth) / 4;
    const sites = [];
    let cursor = margin;
    const push = (kind, width, side) => {
      const jitter = kind === 'base' ? 0 : Math.round(random.range(-0.12, 0.12) * wild);
      sites.push({ kind, side, x0: cursor + jitter, x1: cursor + jitter + width,
        level: baseY + Math.round(random.range(-50, 50)) });
      cursor += width + wild;
    };
    push('base', baseWidth, 'left');
    push('neutral', neutralWidth, 'neutral');
    push('neutral', neutralWidth, 'neutral');
    push('neutral', neutralWidth, 'neutral');
    push('base', baseWidth, 'right');
    sites[0].level = sites[4].level = baseY;
    const wilds = [];
    for (let i = 0; i < sites.length - 1; i += 1) wilds.push({ x0: sites[i].x1, x1: sites[i + 1].x0 });
    // Each wild zone gets a mountain or a lake (or both); the outer zones always get a mountain.
    const plans = ['mountain+lake', 'lake', 'lake+mountain', 'mountain'];
    for (let i = plans.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [plans[i], plans[j]] = [plans[j], plans[i]];
    }
    const mountains = [], lakes = [];
    wilds.forEach((zone, index) => {
      const plan = index === 0 || index === 3 ? (random() < 0.5 ? 'mountain+lake' : 'lake+mountain') : plans[index];
      const width = zone.x1 - zone.x0;
      const parts = plan.split('+');
      parts.forEach((part, partIndex) => {
        const share = width / parts.length;
        const center = zone.x0 + share * (partIndex + 0.5) + random.range(-0.1, 0.1) * share;
        if (part === 'mountain') {
          // Asymmetric massif: a main peak plus shoulder peaks, each side with its own spread.
          const half = Math.min(share * 0.62, random.range(520, 840));
          const height = random.range(380, 760);
          const peaks = [{ x: center, height, left: half * random.range(0.75, 1.1), right: half * random.range(0.75, 1.1),
            shape: random.range(1.05, 1.7) }];
          const shoulders = random.int(1, 3);
          for (let s = 0; s < shoulders; s += 1) {
            const side = random() < 0.5 ? -1 : 1;
            peaks.push({ x: center + side * half * random.range(0.25, 0.6), height: height * random.range(0.3, 0.68),
              left: half * random.range(0.3, 0.55), right: half * random.range(0.3, 0.55), shape: random.range(1.1, 1.9) });
          }
          mountains.push({ x: center, half, height, peaks, seed: random.int(1, 1e9),
            mesa: random() < 0.25 ? random.range(0.75, 0.88) : 0 });
        } else {
          lakes.push({ x: center, half: Math.min(share * 0.42, random.range(300, 520)),
            depth: random.range(150, 260) });
        }
      });
    });
    // A pond beside each base for its farms, on the outer side.
    lakes.push({ x: sites[0].x0 - margin * 0.5 + 40, half: 180, depth: 110, pond: true });
    lakes.push({ x: sites[4].x1 + margin * 0.5 - 40, half: 180, depth: 110, pond: true });
    return { baseY, sites, wilds, mountains, lakes };
  }

  // Surface height (row of the first ground cell) for every column.
  function surfaceProfile(world, layout, seed) {
    const W = world.width;
    const surface = new Float32Array(W);
    const hills = [PW.createNoise1D(seed + 11, 2400), PW.createNoise1D(seed + 12, 900),
      PW.createNoise1D(seed + 13, 260), PW.createNoise1D(seed + 14, 70), PW.createNoise1D(seed + 15, 22)];
    const ridge = PW.createNoise1D(seed + 21, 140);
    const ridgeFine = PW.createNoise1D(seed + 22, 36);
    for (let x = 0; x < W; x += 1) {
      let y = layout.baseY
        - hills[0](x) * 170 - hills[1](x) * 95 - hills[2](x) * 32 - hills[3](x) * 9 - hills[4](x) * 2.5;
      for (const m of layout.mountains) {
        let lift = 0;
        for (const peak of m.peaks) {
          const spread = x < peak.x ? peak.left : peak.right;
          const t = Math.abs(x - peak.x) / spread;
          if (t >= 1) continue;
          lift = Math.max(lift, peak.height * Math.pow(1 - smooth(t), peak.shape));
        }
        if (!lift) continue;
        // Mesas are cut flat near the top; ridges get rough, multi-scale edges.
        if (m.mesa) lift = Math.min(lift, m.height * m.mesa + (lift - m.height * m.mesa) * 0.08);
        const rough = 1 + ridge(x + m.seed) * 0.12 + ridgeFine(x - m.seed) * 0.045 + hills[4](x * 3 + m.seed) * 0.012;
        y -= lift * rough;
      }
      // Edges of the map rise into hills.
      const edge = Math.min(x, W - 1 - x);
      if (edge < 380) y -= Math.pow(1 - edge / 380, 2) * 260;
      // Settlement sites are eased towards their level with smooth shoulders: bases flat, neutral
      // towns keeping a rolling relief their buildings are set into.
      for (const site of layout.sites) {
        const inside = Math.min(x - site.x0, site.x1 - x);
        const blend = smooth((inside + 260) / 260);
        if (blend > 0) y = y + (site.level + hills[4](x) * 0.6 + siteRelief(site, x) - y) * blend;
      }
      for (const lake of layout.lakes) {
        const t = Math.abs(x - lake.x) / lake.half;
        if (t >= 1.25) continue;
        const bowl = t < 1 ? lake.depth * (1 - t * t) * (1 - 0.15 * t) : 0;
        // Raise a lip just outside the bowl so the water has a shore.
        const lip = t > 0.85 && t < 1.25 ? Math.sin((t - 0.85) / 0.4 * Math.PI) * 10 : 0;
        y += bowl - lip;
      }
      surface[x] = y;
    }
    return surface;
  }

  // Smooth low-resolution field in [0, 1] sampled with bilinear interpolation (16-cell lattice).
  function createField(world, seed, period) {
    const cols = (world.width >> 4) + 2, rows = (world.height >> 4) + 2;
    const field = new Float32Array(cols * rows);
    const noise = PW.createNoise2D(seed, period);
    const fine = PW.createNoise2D(seed + 1, period / 3);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        field[y * cols + x] = Math.max(0, Math.min(1, 0.5 + noise(x, y) * 0.42 + fine(x, y) * 0.2));
      }
    }
    const rowValues = new Float32Array(cols);
    let cachedRow = -1;
    return {
      // Prepare interpolation along a row, then sample(x) is cheap.
      row(y) {
        if (y === cachedRow) return;
        cachedRow = y;
        const fy = y / 16, iy = Math.min(rows - 2, fy | 0), t = fy - iy, s = t * t * (3 - 2 * t);
        const a = iy * cols, b = a + cols;
        for (let i = 0; i < cols; i += 1) rowValues[i] = field[a + i] + (field[b + i] - field[a + i]) * s;
      },
      sample(x) {
        const fx = x / 16, ix = fx | 0, t = fx - ix, s = t * t * (3 - 2 * t);
        return rowValues[ix] + (rowValues[ix + 1] - rowValues[ix]) * s;
      },
    };
  }

  function fillStrata(world, layout, surface, seed) {
    const { width: W, height: H, mat } = world;
    const variants = createField(world, seed + 31, 6);
    const lenses = createField(world, seed + 35, 4);
    const topsoilNoise = PW.createNoise1D(seed + 41, 90);
    const soilNoise = PW.createNoise1D(seed + 42, 420);
    const soilFine = PW.createNoise1D(seed + 43, 60);
    const stoneNoise = PW.createNoise1D(seed + 44, 700);
    const stoneFine = PW.createNoise1D(seed + 46, 45);
    const bedrockNoise = PW.createNoise1D(seed + 45, 50);
    const top = new Int32Array(W);
    const soilEnd = new Int32Array(W), stoneStart = new Int32Array(W), grassEnd = new Int32Array(W),
      topsoilEnd = new Int32Array(W), bedrockStart = new Int32Array(W);
    for (let x = 0; x < W; x += 1) {
      const surfaceRow = Math.max(4, Math.min(H - 60, Math.round(surface[x])));
      top[x] = surfaceRow;
      const slope = Math.abs(surface[Math.min(W - 1, x + 3)] - surface[Math.max(0, x - 3)]) / 6;
      const altitude = layout.baseY - surfaceRow;   // positive above the base line
      // Steep or high ground has thinner soil; flats have deep soil.
      const thin = Math.min(0.85, Math.max(slope - 0.7, 0) * 0.7 + Math.max(0, altitude - 300) / 520);
      const grass = slope > 1.7 || altitude > 600 ? 0 : 3 + (PW.hash2(x, 7) & 1);
      const topsoil = Math.max(2, Math.round((14 + topsoilNoise(x) * 7) * (1 - thin * 0.7)));
      const soil = Math.round((150 + soilNoise(x) * 70 + soilFine(x) * 16) * (1 - thin * 0.75) + 10);
      grassEnd[x] = surfaceRow + grass;
      topsoilEnd[x] = grassEnd[x] + topsoil;
      soilEnd[x] = surfaceRow + Math.max(topsoil + grass + 4, soil);
      stoneStart[x] = soilEnd[x] + Math.round(110 + stoneNoise(x) * 90 + stoneFine(x) * 18);
      bedrockStart[x] = H - 26 - Math.round((bedrockNoise(x) + 1) * 8);
    }
    // Fill row by row so the smooth fields interpolate along rows.
    let firstRow = H;
    for (let x = 0; x < W; x += 1) firstRow = Math.min(firstRow, top[x]);
    for (let y = firstRow; y < H; y += 1) {
      variants.row(y);
      lenses.row(y);
      const rowOffset = y * W;
      for (let x = 0; x < W; x += 1) {
        if (y < top[x]) continue;
        let id;
        if (y >= bedrockStart[x]) id = M.BEDROCK;
        else if (y < grassEnd[x]) id = M.GRASS;
        else if (y < topsoilEnd[x]) id = M.TOPSOIL;
        else if (y < soilEnd[x]) id = M.SOIL;
        else {
          // Soil gives way to stone through clay and gravel lenses with a ragged boundary.
          const lens = lenses.sample(x);
          const edge = stoneStart[x] + Math.round((lens - 0.5) * 120);
          if (y >= edge) id = lens > 0.86 ? M.GRAVEL : M.STONE;
          else id = lens < 0.2 ? M.CLAY : lens > 0.84 ? M.GRAVEL : M.SOIL;
        }
        // Variant: smooth patches with a hashed dither at the patch edges.
        const v = variants.sample(x) * 4 + ((PW.hash2(x, y) & 255) / 255 - 0.5) * 0.6;
        const variant = v < 1 ? 0 : v < 2 ? 1 : v < 3 ? 2 : 3;
        mat[rowOffset + x] = id | variant << 6;
      }
    }
    return top;
  }

  // Stamp an irregular blob of material (lenses, pockets, ore).
  function blob(world, cx, cy, radius, random, paint, squash = 0.6) {
    const lobes = Array.from({ length: 4 + random.int(0, 3) }, () => ({
      x: cx + random.range(-0.6, 0.6) * radius, y: cy + random.range(-0.4, 0.4) * radius * squash,
      r: radius * random.range(0.45, 0.85) }));
    const x0 = Math.floor(cx - radius * 1.6), x1 = Math.ceil(cx + radius * 1.6);
    const y0 = Math.floor(cy - radius * 1.2), y1 = Math.ceil(cy + radius * 1.2);
    for (let y = Math.max(0, y0); y <= Math.min(world.height - 1, y1); y += 1) {
      for (let x = Math.max(0, x0); x <= Math.min(world.width - 1, x1); x += 1) {
        let inside = 0;
        for (const lobe of lobes) {
          const d = Math.hypot(x - lobe.x, (y - lobe.y) / squash) / lobe.r;
          if (d < 1) inside = Math.max(inside, 1 - d);
        }
        if (inside > 0) paint(x, y, inside);
      }
    }
  }

  function addLenses(world, layout, top, random) {
    const { mat, width: W } = world;
    // Clay lenses and gravel pockets in the soil, stone outcrops deeper down.
    for (let i = 0; i < 240; i += 1) {
      const x = random.int(60, W - 60);
      const depth = random.range(60, 900);
      const y = top[x] + depth;
      const kind = depth < 260 ? (random() < 0.6 ? M.CLAY : M.GRAVEL) : random() < 0.5 ? M.SOIL : M.CLAY;
      blob(world, x, y, random.range(14, 46), random, (px, py) => {
        const index = py * W + px;
        const id = mat[index] & 63;
        if (id === M.SOIL || id === M.STONE || id === M.CLAY || id === M.GRAVEL) mat[index] = kind | mat[index] & 0xc0;
      }, random.range(0.35, 0.6));
    }
  }

  // ---- HM ore veins ---------------------------------------------------------------------------------
  // Ore forms veins, not blobs: a jagged seam that runs at a slant for tens to hundreds of cells,
  // kinking along its strike, pinching and swelling, tapering to points, with thinner veinlets
  // splitting off it and a pale quartz selvage along its walls (amethyst-style colour zoning: pale
  // walls, lavender crystal, a deep purple core). Deposits sit in depth bands and grow with depth:
  // thin stringers under the surface, veins below them, wide lodes deeper still, and mother lodes
  // near the bedrock whose swells open into crystal-lined geodes. Ore cell variants: 0 selvage,
  // 1 crystal, 2 rich core, 3 sparkling crystal points.
  const ORE_TIERS = [
    { tier: 'stringer', depth: [300, 620], count: 12, spacing: 240, length: [50, 90], thick: [3, 6], generations: 1, stockwork: 0, geodes: 0 },
    { tier: 'vein', depth: [620, 1100], count: 10, spacing: 300, length: [90, 160], thick: [5, 10], generations: 2, stockwork: 3, geodes: 0.25 },
    { tier: 'lode', depth: [1100, 1650], count: 7, spacing: 380, length: [150, 250], thick: [9, 15], generations: 2, stockwork: 6, geodes: 0.6 },
    { tier: 'mother lode', depth: [1650, 2000], count: 3, spacing: 600, length: [220, 340], thick: [14, 22], generations: 3, stockwork: 10, geodes: 1 },
  ];
  // A seam from (x, y) heading `angle` (radians, y down): its centre points with half-widths.
  function seam(random, x, y, angle, length, half0, generations, out) {
    const swell = PW.createNoise1D(random.int(1, 1e9), Math.max(5, length / 6));
    const rough = PW.createNoise1D(random.int(1, 1e9), 2.5);
    let a = angle, kink = random.int(5, 16);
    const splits = generations > 0 ? random.int(1, 2) + (length > 90 ? 1 : 0) : 0;
    const splitAt = Array.from({ length: splits }, () => random.int(Math.round(length * 0.15), Math.round(length * 0.8)));
    for (let s = 0; s < length; s += 1) {
      if ((kink -= 1) <= 0) { a = angle + random.range(-0.5, 0.5); kink = random.int(5, 16); }
      x += Math.cos(a); y += Math.sin(a);
      const t = s / length;
      const half = half0 * Math.pow(1 - t, 0.6) * (0.55 + 0.6 * (swell(s) * 0.5 + 0.5)) * (1 + rough(s) * 0.12);
      out.push({ x, y, half: Math.max(0.5, half) });
      if (splitAt.includes(s)) {
        const side = random() < 0.5 ? 1 : -1;
        seam(random, x, y, a + side * random.range(0.35, 1.1), length * random.range(0.3, 0.6), Math.max(0.7, half * random.range(0.35, 0.6)), generations - 1, out);
      }
    }
  }
  function oreVein(world, cx, cy, spec, random) {
    const { mat, width: W, height: H } = world;
    const length = random.range(spec.length[0], spec.length[1]);
    const thick = random.range(spec.thick[0], spec.thick[1]);
    // Strike: 15-65 degrees from horizontal, falling either way.
    const angle = random.range(0.26, 1.13) * (random() < 0.5 ? 1 : -1);
    const points = [];
    seam(random, cx, cy, angle, length / 2, thick / 2, spec.generations, points);
    seam(random, cx, cy, angle + Math.PI, length / 2, thick / 2, spec.generations, points);
    // Stockwork: short veinlets criss-crossing the rock beside the main seam.
    for (let k = 0; k < spec.stockwork; k += 1) {
      const along = random.range(-0.4, 0.4) * length;
      const off = random.range(-1, 1) * thick * 2.2;
      seam(random, cx + Math.cos(angle) * along - Math.sin(angle) * off, cy + Math.sin(angle) * along + Math.cos(angle) * off,
        random.range(0, Math.PI * 2), random.range(8, 26), random.range(0.6, 1.3), 0, points);
    }
    // Depth into the vein for every cell (half-width minus distance to the nearest centre point).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p.x - p.half); x1 = Math.max(x1, p.x + p.half); y0 = Math.min(y0, p.y - p.half); y1 = Math.max(y1, p.y + p.half); }
    const pad = 4;
    x0 = Math.max(1, Math.floor(x0) - pad); y0 = Math.max(1, Math.floor(y0) - pad);
    x1 = Math.min(W - 2, Math.ceil(x1) + pad); y1 = Math.min(H - 2, Math.ceil(y1) + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const depth = new Float32Array(w * h).fill(-9);
    const width = new Float32Array(w * h);   // half-width of the seam each cell belongs to
    for (const p of points) {
      const r = Math.ceil(p.half + 3);
      for (let y = Math.max(y0, Math.floor(p.y - r)); y <= Math.min(y1, p.y + r); y += 1) {
        for (let x = Math.max(x0, Math.floor(p.x - r)); x <= Math.min(x1, p.x + r); x += 1) {
          const d = p.half - Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
          const k = (y - y0) * w + (x - x0);
          if (d > depth[k]) { depth[k] = d; width[k] = p.half; }
        }
      }
    }
    // Geodes: hollows in the widest swells, lined with crystal points.
    const geodes = [];
    if (spec.geodes > 0) {
      const wide = points.filter((p) => p.half >= 4.5).sort((a, b) => b.half - a.half);
      for (const p of wide) {
        if (geodes.length >= Math.ceil(spec.geodes * 3) || random() > spec.geodes) continue;
        if (geodes.some((g) => Math.hypot(g.x - p.x, g.y - p.y) < 30)) continue;
        geodes.push({ x: p.x, y: p.y, r: Math.min(p.half - 1.8, random.range(2.6, 6.5)) });
      }
    }
    let cells = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const k = (y - y0) * w + (x - x0), d = depth[k];
        if (d < -2.5) continue;
        const index = y * W + x;
        const id = mat[index] & 63;
        if (id === M.BEDROCK || id === M.AIR || id === M.WATER) continue;
        if (d < 0) {
          // Altered host rock: the vein sits in a hard seam even inside soft layers.
          if (id === M.SOIL || id === M.CLAY || id === M.GRAVEL || id === M.TOPSOIL) mat[index] = M.STONE | (mat[index] & 0xc0);
          continue;
        }
        // Selvage along the walls (thinner on thin seams, so stringers still show their colour),
        // lavender crystal inside, the deep purple core in the middle of wide veins.
        const half = width[k];
        let variant;
        if (d < Math.min(1.1, half * 0.32)) variant = 0;
        else if (d > 2.4 && PW.hash2(x, y) % 11 === 0) variant = 3;
        else variant = d > Math.max(1.4, Math.min(3.2, half * 0.55)) ? 2 : 1;
        mat[index] = M.ORE | variant << 6;
        cells += 1;
      }
    }
    for (const g of geodes) {
      for (let y = Math.floor(g.y - g.r - 3); y <= g.y + g.r + 3; y += 1) {
        for (let x = Math.floor(g.x - g.r - 3); x <= g.x + g.r + 3; x += 1) {
          const dx = x + 0.5 - g.x, dy = y + 0.5 - g.y, d = Math.hypot(dx, dy);
          const index = y * W + x;
          if ((mat[index] & 63) !== M.ORE) continue;
          // Crystal points grow in from the wall: the hollow's edge is ragged with teeth.
          const teeth = 1.6 * Math.abs(Math.sin(Math.atan2(dy, dx) * 5 + g.x));
          if (d < g.r - teeth) { mat[index] = M.AIR; cells -= 1; } else if (d < g.r + 1.5) mat[index] = M.ORE | 3 << 6;
        }
      }
    }
    return { x: Math.round(cx), y: Math.round(cy), radius: Math.round(thick / 2), length: Math.round(length), angle,
      tier: spec.tier, amount: cells, geodes: geodes.length, box: { x0, y0, x1, y1 } };
  }

  function placeOreNodes(world, layout, top, random) {
    const W = world.width;
    const nodes = [];
    const tooClose = (x, y, gap) => nodes.some((n) => Math.hypot(n.x - x, n.y - y) < gap);
    // Starter veins below each base core: a solid vein the starter workings reach.
    for (const site of [layout.sites[0], layout.sites[4]]) {
      const coreX = site.side === 'left' ? site.x0 + 260 : site.x1 - 260;
      const nodeX = coreX + (site.side === 'left' ? 220 : -220);
      const node = oreVein(world, nodeX, top[Math.round(coreX)] + random.range(480, 560),
        { tier: 'starter', length: [110, 150], thick: [12, 16], generations: 2, stockwork: 4, geodes: 0 }, random);
      node.starter = site.side;
      nodes.push(node);
    }
    // Depth bands, deepest (largest) first so they get their room.
    for (const spec of ORE_TIERS.slice().reverse()) {
      let placed = 0;
      for (let attempt = 0; placed < spec.count && attempt < 2000; attempt += 1) {
        const x = random.range(200, W - 200);
        const y = top[Math.round(x)] + random.range(spec.depth[0], spec.depth[1]);
        if (y > world.height - 90 || tooClose(x, y, spec.spacing)) continue;
        nodes.push(oreVein(world, x, y, spec, random));
        placed += 1;
      }
    }
    return nodes;
  }

  function carveCaves(world, layout, top, random) {
    const { mat, width: W } = world;
    const caves = [];
    // Caves run anywhere deep enough: well below lake beds, and below the depth of the base
    // workings under settlements (so a starter mine never opens into one).
    const avoid = (x, y) => {
      const depth = y - top[Math.round(x)];
      return layout.sites.some((site) => x > site.x0 - 200 && x < site.x1 + 200 && depth < (site.kind === 'base' ? 760 : 560))
        || layout.lakes.some((lake) => Math.abs(x - lake.x) < lake.half + 100 && depth < 520);
    };
    for (let i = 0; i < 16; i += 1) {
      let x = random.range(400, W - 400);
      let y = top[Math.round(x)] + random.range(420, 1500);
      if (avoid(x, y)) continue;
      let angle = random.range(-0.4, 0.4) + (random() < 0.5 ? 0 : Math.PI);
      const length = random.int(400, 1300);
      const cave = { points: [] };
      for (let step = 0; step < length; step += 6) {
        angle += random.range(-0.25, 0.25);
        angle = Math.max(-0.7, Math.min(0.7, ((angle + Math.PI) % (2 * Math.PI)) - Math.PI));
        x += Math.cos(angle) * 6 * (random() < 0.5 ? 1 : 1);
        y += Math.sin(angle) * 3;
        if (x < 200 || x > W - 200 || avoid(x, y)) break;
        y = Math.max(top[Math.round(x)] + 320, Math.min(world.height - 140, y));
        const radius = 11 + 8 * Math.sin(step * 0.021) + random.range(0, 5);
        cave.points.push({ x, y, r: radius });
        for (let py = Math.floor(y - radius); py <= y + radius; py += 1) {
          for (let px = Math.floor(x - radius * 1.4); px <= x + radius * 1.4; px += 1) {
            if (Math.hypot((px - x) / 1.4, py - y) > radius) continue;
            const index = py * W + px;
            const id = mat[index] & 63;
            if (id !== M.BEDROCK && id !== M.ORE) mat[index] = M.AIR;
          }
        }
      }
      if (!cave.points.length) continue;
      cave.chambers = carveChambers(world, cave, top, random);
      caves.push(cave);
    }
    return caves;
  }
  // Breakdown chambers along a cave: a domed hall whose floor sits a little below the passage
  // floor, strewn with fallen rock, and sometimes a pool in the bottom of the bowl (kept below
  // the passage so it cannot drain out).
  function carveChambers(world, cave, top, random) {
    const { mat, width: W, height: H } = world;
    const chambers = [];
    const count = cave.points.length > 120 ? random.int(1, 2) : cave.points.length > 60 ? 1 : 0;
    for (let n = 0; n < count; n += 1) {
      const p = cave.points[random.int(Math.floor(cave.points.length * 0.2), Math.floor(cave.points.length * 0.8))];
      const halfW = random.range(55, 130), halfH = random.range(30, 66);
      const passageFloor = p.y + p.r;
      // The hall's floor bowl sits a little below the passage floor (bottom = cy + 0.8 halfH).
      const cx = p.x, cy = passageFloor - halfH * 0.64;
      if (cy - halfH < top[Math.round(cx)] + 220 || cy + halfH > H - 120) continue;
      if (chambers.some((c) => Math.abs(c.x - cx) < c.halfW + halfW)) continue;
      const outline = PW.createNoise1D(random.int(1, 1e9), 0.6);
      const x0 = Math.floor(cx - halfW * 1.15), x1 = Math.ceil(cx + halfW * 1.15);
      const y0 = Math.floor(cy - halfH * 1.15), y1 = Math.ceil(cy + halfH * 1.15);
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const dx = (x - cx) / halfW, dy = (y - cy) / halfH;
          const angle = Math.atan2(dy, dx);
          // Domed roof, flatter floor, ragged outline.
          const squash = dy > 0 ? 1.25 : 1;
          if (Math.hypot(dx, dy * squash) > 1 + outline(angle * 6) * 0.1) continue;
          const index = y * W + x;
          if ((mat[index] & 63) !== M.BEDROCK) mat[index] = M.AIR;
        }
      }
      const bottom = Math.round(cy + halfH / 1.25);
      // A pool in the bottom of the bowl, its surface below the passage floor.
      let pool = null;
      if (random() < 0.55) {
        const level = Math.max(Math.round(passageFloor) + 2, bottom - random.int(5, 12));
        let cells = 0;
        for (let y = level; y <= bottom + 2; y += 1) for (let x = x0; x <= x1; x += 1) {
          const index = y * W + x;
          if ((mat[index] & 63) !== M.AIR) continue;
          // Only fill air that has rock (or water) under it all the way down: the bowl.
          let below = y + 1;
          while (below <= bottom + 4 && (mat[below * W + x] & 63) === M.AIR) below += 1;
          if (below > bottom + 4) continue;
          mat[index] = M.WATER;
          cells += 1;
        }
        if (cells) pool = { level, cells };
      }
      // Breakdown: fallen rock heaped on the floor in mounds (loose stone settles like scree).
      for (let k = 0; k < random.int(2, 5); k += 1) {
        const mx = cx + random.range(-0.7, 0.7) * halfW, mr = random.range(6, 18);
        for (let x = Math.floor(mx - mr * 1.6); x <= mx + mr * 1.6; x += 1) {
          let y = Math.round(cy);
          while (y < H - 2 && (mat[(y + 1) * W + x] & 63) === M.AIR) y += 1;
          if ((mat[(y + 1) * W + x] & 63) === M.WATER) continue;
          const h = Math.round(mr * 0.5 * Math.max(0, 1 - Math.abs(x - mx) / (mr * 1.6)) * (0.8 + (PW.hash2(x, k) & 7) / 20));
          for (let t = 0; t < h; t += 1) if ((mat[(y - t) * W + x] & 63) === M.AIR) mat[(y - t) * W + x] = M.LOOSE_STONE | (PW.hash2(x, y - t) & 3) << 6;
        }
      }
      chambers.push({ x: Math.round(cx), y: Math.round(cy), halfW: Math.round(halfW), halfH: Math.round(halfH), pool });
    }
    return chambers;
  }

  function fillLakes(world, layout, surface) {
    const { mat, width: W } = world;
    for (const lake of layout.lakes) {
      const left = Math.max(1, Math.floor(lake.x - lake.half * 1.25));
      const right = Math.min(W - 2, Math.ceil(lake.x + lake.half * 1.25));
      // Water level sits a few cells below the lower of the two rims.
      let rimLeft = Infinity, rimRight = Infinity;
      for (let x = left; x < lake.x; x += 1) rimLeft = Math.min(rimLeft, surface[x]);
      for (let x = Math.ceil(lake.x); x <= right; x += 1) rimRight = Math.min(rimRight, surface[x]);
      const level = Math.round(Math.max(rimLeft, rimRight)) + 4;
      lake.level = level;
      // Only the basin connected to the centre holds water; stop at the first shore column each way.
      let shoreLeft = Math.round(lake.x), shoreRight = Math.round(lake.x);
      while (shoreLeft > left && Math.round(surface[shoreLeft - 1]) > level) shoreLeft -= 1;
      while (shoreRight < right && Math.round(surface[shoreRight + 1]) > level) shoreRight += 1;
      lake.left = shoreLeft;
      lake.right = shoreRight;
      for (let x = shoreLeft; x <= shoreRight; x += 1) {
        const ground = Math.round(surface[x]);
        if (ground <= level) continue;
        for (let y = level; y < ground; y += 1) mat[y * W + x] = M.WATER;   // calm water: no momentum bits
        // Lake beds are sand and silt rather than grass.
        for (let y = ground; y < ground + 6; y += 1) {
          const index = y * W + x;
          const id = mat[index] & 63;
          if (id === M.GRASS || id === M.TOPSOIL) mat[index] = M.SAND | (PW.hash2(x, y) & 3) << 6;
        }
      }
      // Sandy shore just above the waterline.
      for (let x = Math.max(1, shoreLeft - 40); x <= Math.min(W - 2, shoreRight + 40); x += 1) {
        const ground = Math.round(surface[x]);
        if (ground > level || ground < level - 14) continue;
        for (let y = ground; y < ground + 4; y += 1) mat[y * W + x] = M.SAND | (PW.hash2(x, y) & 3) << 6;
      }
    }
  }

  function generateTerrain(world, seed) {
    const random = PW.createRandom(seed);
    const layout = planLayout(world, random);
    const surface = surfaceProfile(world, layout, seed);
    const top = fillStrata(world, layout, surface, seed);
    addLenses(world, layout, top, random);
    // Caves first: veins then run through the rock around them and show in the cave walls.
    layout.caves = carveCaves(world, layout, top, random);
    layout.nodes = placeOreNodes(world, layout, top, random);
    fillLakes(world, layout, surface);
    layout.surface = surface;
    // Depth shading is measured from a broadly smoothed ground line, so mountains keep the bright
    // near-surface tones instead of showing a darker copy of their outline inside.
    const shadeLine = new Int32Array(world.width);
    const radius = 320;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) sum += top[Math.max(0, Math.min(world.width - 1, x))];
    for (let x = 0; x < world.width; x += 1) {
      shadeLine[x] = Math.max(top[x], Math.round(sum / (radius * 2 + 1)));
      sum += top[Math.min(world.width - 1, x + radius + 1)] - top[Math.max(0, x - radius)];
    }
    world.surface0 = shadeLine;
    world.terrainTop = top;
    world.layout = layout;
    PW.rebuildGroundTop(world);
    return layout;
  }

  PW.generateTerrain = generateTerrain;
  PW.terrainBlob = blob;
})();
