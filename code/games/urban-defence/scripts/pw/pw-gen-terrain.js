'use strict';
// Terrain generation for the pixel world: a wide map with five settlement sites (left base, three
// neutral towns, right base), mountains and lakes between them, soil strata, ore nodes and caves.
(function () {
  const PW = window.PW;
  const { M } = PW;

  const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

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
      // Settlement sites are flattened to their pad level with smooth shoulders.
      for (const site of layout.sites) {
        const inside = Math.min(x - site.x0, site.x1 - x);
        const blend = smooth((inside + 260) / 260);
        if (blend > 0) y = y + (site.level + hills[4](x) * 0.6 - y) * blend;
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

  function placeOreNodes(world, layout, top, random) {
    const { mat, width: W } = world;
    const nodes = [];
    const tooClose = (x, y, gap) => nodes.some((n) => Math.hypot(n.x - x, n.y - y) < gap);
    const addNode = (x, y, radius, starter) => {
      const node = { x: Math.round(x), y: Math.round(y), radius, amount: Math.round(radius * radius * 1.4), starter };
      nodes.push(node);
      blob(world, x, y, radius + 7, random, (px, py, inside) => {
        const index = py * W + px;
        const id = mat[index] & 63;
        if (id === M.BEDROCK || id === M.AIR || id === M.WATER) return;
        const core = inside > 0.22;
        const spark = PW.hash2(px, py) % 9 === 0 ? 3 : (PW.hash2(px >> 1, py >> 1) & 1) + 1;
        mat[index] = core ? M.ORE | (PW.hash2(px, py) & 7 ? spark : 0) << 6 : M.STONE | (mat[index] & 0xc0);
      }, 0.75);
      return node;
    };
    // Starter nodes below each base core.
    for (const site of [layout.sites[0], layout.sites[4]]) {
      const coreX = site.side === 'left' ? site.x0 + 260 : site.x1 - 260;
      const nodeX = coreX + (site.side === 'left' ? 220 : -220);
      addNode(nodeX, top[Math.round(coreX)] + random.range(480, 560), 26, site.side);
    }
    for (let attempt = 0; nodes.length < 30 && attempt < 4000; attempt += 1) {
      const x = random.range(160, W - 160);
      const depth = random.range(320, 2050);
      const y = top[Math.round(x)] + depth;
      if (y > world.height - 120 || tooClose(x, y, 300)) continue;
      addNode(x, y, random.range(16, 34) + depth * 0.006, null);
    }
    return nodes;
  }

  function carveCaves(world, layout, top, random) {
    const { mat, width: W } = world;
    const caves = [];
    const avoid = (x) => layout.sites.some((site) => x > site.x0 - 200 && x < site.x1 + 200)
      || layout.lakes.some((lake) => Math.abs(x - lake.x) < lake.half + 260);
    for (let i = 0; i < 9; i += 1) {
      let x = random.range(400, W - 400);
      if (avoid(x)) continue;
      let y = top[Math.round(x)] + random.range(420, 1500);
      let angle = random.range(-0.4, 0.4) + (random() < 0.5 ? 0 : Math.PI);
      const length = random.int(400, 1300);
      const cave = { points: [] };
      for (let step = 0; step < length; step += 6) {
        angle += random.range(-0.25, 0.25);
        angle = Math.max(-0.7, Math.min(0.7, ((angle + Math.PI) % (2 * Math.PI)) - Math.PI));
        x += Math.cos(angle) * 6 * (random() < 0.5 ? 1 : 1);
        y += Math.sin(angle) * 3;
        if (x < 200 || x > W - 200 || avoid(x)) break;
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
      if (cave.points.length) caves.push(cave);
    }
    return caves;
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
        for (let y = level; y < ground; y += 1) mat[y * W + x] = M.WATER | (PW.hash2(x, y) & 3) << 6;
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
    layout.nodes = placeOreNodes(world, layout, top, random);
    layout.caves = carveCaves(world, layout, top, random);
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
