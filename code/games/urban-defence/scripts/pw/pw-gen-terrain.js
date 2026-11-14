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
  // near the bedrock whose swells open into crystal-lined geodes.
  // Everything is crystal, never a blob. Ore cell variants: 0 pale selvage (quartz/chalcedony), 1 a
  // crystal's lit face, 2 its shadowed face, 3 a bright crystal tip. Seams show comb texture
  // (crystals growing from both walls to meet at a suture down the middle); lumps are faceted.
  // Besides seams, a deposit takes one of several natural forms (weights per band):
  //   geode    - an angular rock shell lined with crystal points growing into an open hollow,
  //   cluster  - broken, faceted lumps of ore gathered together (as boulders in a breccia),
  //   spray    - a starburst of long pointed crystal prisms radiating from one seed,
  //   lens     - a stratabound lens lying along the rock layers, pinching and swelling,
  //   breccia  - a steep chimney of broken, angular host rock cemented by ore, each fragment
  //              rimmed with pale selvage (crustiform banding).
  const ORE_TIERS = [
    { tier: 'stringer', depth: [300, 620], count: 12, spacing: 240, length: [50, 90], thick: [3, 6], generations: 1, stockwork: 0, geodes: 0,
      forms: { seam: 0.45, cluster: 0.3, spray: 0.25 } },
    { tier: 'vein', depth: [620, 1100], count: 10, spacing: 300, length: [90, 160], thick: [5, 10], generations: 2, stockwork: 3, geodes: 0.25,
      forms: { seam: 0.4, lens: 0.2, cluster: 0.15, geode: 0.15, spray: 0.1 } },
    { tier: 'lode', depth: [1100, 1650], count: 7, spacing: 380, length: [150, 250], thick: [9, 15], generations: 2, stockwork: 6, geodes: 0.6,
      forms: { seam: 0.3, breccia: 0.25, geode: 0.2, spray: 0.15, lens: 0.1 } },
    { tier: 'mother lode', depth: [1650, 2000], count: 3, spacing: 600, length: [220, 340], thick: [14, 22], generations: 3, stockwork: 10, geodes: 1,
      forms: { seam: 0.35, breccia: 0.3, geode: 0.25, spray: 0.1 } },
  ];
  const MIN_ORE = 20;
  function pickForm(spec, random) {
    if (!spec.forms) return 'seam';
    let roll = random(), last = 'seam';
    for (const [form, weight] of Object.entries(spec.forms)) { last = form; if ((roll -= weight) < 0) return form; }
    return last;
  }
  // A broken, angular outline round a centre: a polygon of `n` corners at jittered radii, with
  // straight edges between them. at(angle) gives the radius, facet(angle) the edge it falls on.
  function outline(random, R, n = random.int(5, 8)) {
    const phase = random.range(0, Math.PI * 2);
    const radii = Array.from({ length: n }, () => R * random.range(0.68, 1.1));
    const corner = (i) => { const a = phase + i / n * Math.PI * 2, r = radii[i % n]; return [Math.cos(a) * r, Math.sin(a) * r]; };
    const facet = (a) => Math.floor(((a - phase) / (Math.PI * 2) % 1 + 1) % 1 * n);
    const at = (a) => {
      const i = facet(a), p0 = corner(i), p1 = corner(i + 1);
      const ex = p1[0] - p0[0], ey = p1[1] - p0[1], dx = Math.cos(a), dy = Math.sin(a);
      const den = dx * ey - dy * ex;
      return Math.abs(den) < 1e-6 ? radii[i] : (p0[0] * ey - p0[1] * ex) / den;
    };
    // Outward normal of each edge, for lighting its facet.
    const normal = (i) => { const p0 = corner(i), p1 = corner(i + 1), ex = p1[0] - p0[0], ey = p1[1] - p0[1], l = Math.hypot(ex, ey) || 1; return [ey / l, -ex / l]; };
    return { at, facet, normal, n, max: R * 1.1 };
  }
  // Light falls from the upper left: how lit a face with outward normal (nx, ny) is (-1..1).
  const litBy = (nx, ny) => -(nx + ny) * Math.SQRT1_2;
  // A seam from (x, y) heading `angle` (radians, y down): its centre points with half-widths.
  // Each centre point also carries how far along its seam it is (s) and the seam's heading (a), for
  // the comb-texture crystals across it.
  function seam(random, x, y, angle, length, half0, generations, out) {
    const swell = PW.createNoise1D(random.int(1, 1e9), Math.max(5, length / 6));
    const rough = PW.createNoise1D(random.int(1, 1e9), 2.5);
    let a = angle, kink = random.int(5, 16);
    const splits = generations > 0 ? random.int(1, 2) + (length > 90 ? 1 : 0) : 0;
    const splitAt = Array.from({ length: splits }, () => random.int(Math.round(length * 0.15), Math.round(length * 0.8)));
    const s0 = random.range(0, 100);
    for (let s = 0; s < length; s += 1) {
      if ((kink -= 1) <= 0) { a = angle + random.range(-0.5, 0.5); kink = random.int(5, 16); }
      x += Math.cos(a); y += Math.sin(a);
      const t = s / length;
      const half = half0 * Math.pow(1 - t, 0.6) * (0.55 + 0.6 * (swell(s) * 0.5 + 0.5)) * (1 + rough(s) * 0.12);
      out.push({ x, y, half: Math.max(0.5, half), s: s0 + s, a });
      if (splitAt.includes(s)) {
        const side = random() < 0.5 ? 1 : -1;
        seam(random, x, y, a + side * random.range(0.35, 1.1), length * random.range(0.3, 0.6), Math.max(0.7, half * random.range(0.35, 0.6)), generations - 1, out);
      }
    }
  }
  function oreVein(world, cx, cy, spec, random) {
    const { mat, width: W, height: H } = world;
    const form = spec.form || pickForm(spec, random);
    const length = random.range(spec.length[0], spec.length[1]);
    const thick = random.range(spec.thick[0], spec.thick[1]);
    // Strike: 15-65 degrees from horizontal, falling either way.
    const angle = random.range(0.26, 1.13) * (random() < 0.5 ? 1 : -1);
    const points = [];     // circles along seams: { x, y, half, s (along), a (heading) }
    const lumps = [];      // faceted lumps: { x, y, o (outline), aspect, rot }
    const clasts = [];     // host rock fragments inside a breccia
    const prisms = [];     // crystal prisms: { x, y (base), a (axis), len, half }
    const shells = [];     // geodes: { x, y, o (outer outline), inner, teeth, tooth }
    const hollows = [];    // where seam geodes may open: { x, y, half }
    const rnd = (a, b) => random.range(a, b);
    if (form === 'seam') {
      seam(random, cx, cy, angle, length / 2, thick / 2, spec.generations, points);
      seam(random, cx, cy, angle + Math.PI, length / 2, thick / 2, spec.generations, points);
      // Stockwork: short veinlets criss-crossing the rock beside the main seam.
      for (let k = 0; k < spec.stockwork; k += 1) {
        const along = rnd(-0.4, 0.4) * length;
        const off = rnd(-1, 1) * thick * 2.2;
        seam(random, cx + Math.cos(angle) * along - Math.sin(angle) * off, cy + Math.sin(angle) * along + Math.cos(angle) * off,
          rnd(0, Math.PI * 2), rnd(8, 26), rnd(0.6, 1.3), 0, points);
      }
      hollows.push(...points);
    } else if (form === 'lens') {
      // Nearly level with the strata, long and thin, no branches.
      const a = rnd(-0.12, 0.12);
      seam(random, cx, cy, a, length * 0.65, thick * 0.34, 0, points);
      seam(random, cx, cy, a + Math.PI, length * 0.65, thick * 0.34, 0, points);
      hollows.push(...points);
    } else if (form === 'geode') {
      // An angular shell; crystal teeth about three cells apart point in to the open hollow.
      const R = thick * rnd(1.0, 1.4), inner = R * rnd(0.5, 0.62);
      const teeth = Math.max(7, Math.round(Math.PI * 2 * inner / 3.4));
      shells.push({ x: cx, y: cy, o: outline(random, R, random.int(6, 9)), inner, teeth, tooth: inner * rnd(0.38, 0.5), phase: rnd(0, 1) });
    } else if (form === 'cluster') {
      const spread = thick * rnd(1.8, 2.8);
      for (let k = random.int(4, 9); k > 0; k -= 1) {
        const a = rnd(0, Math.PI * 2), dist = spread * Math.sqrt(random());
        lumps.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist * 0.7, o: outline(random, thick * rnd(0.3, 0.62), random.int(4, 7)), aspect: rnd(0.75, 1.3), rot: rnd(0, Math.PI) });
      }
    } else if (form === 'spray') {
      // Long pointed prisms fanning out from one seed, like a stibnite or quartz spray.
      const main = rnd(0, Math.PI * 2), fan = rnd(1.6, Math.PI * 2), n = random.int(7, 14);
      for (let k = 0; k < n; k += 1) {
        const a = main + (k / (n - 1) - 0.5) * fan + rnd(-0.12, 0.12);
        prisms.push({ x: cx, y: cy, a, len: thick * rnd(1.3, 2.8), half: rnd(1.1, Math.max(1.3, Math.min(2.6, thick * 0.3))) });
      }
    } else {
      // Breccia pipe: a steep chimney with jagged, straight-sided walls, full of broken host rock.
      const a = Math.PI / 2 + rnd(-0.35, 0.35), half = thick * rnd(0.8, 1.1), L = length * 0.45;
      const knots = Array.from({ length: Math.ceil(L / 6) + 2 }, () => rnd(0.7, 1.12));
      const wall = (s) => { const u = (s + L / 2) / 6, i = Math.floor(u), t = u - i; return knots[i] * (1 - t) + knots[i + 1] * t; };
      for (let s = -L / 2; s <= L / 2; s += 1) {
        const taper = 1 - Math.pow(Math.abs(s) / (L / 2), 3);
        points.push({ x: cx + Math.cos(a) * s, y: cy + Math.sin(a) * s, half: Math.max(1, half * taper * wall(s)), s: s + L, a });
      }
      const count = Math.round(L * half / 34);
      for (let k = 0; k < count; k += 1) {
        const p = points[random.int(0, points.length - 1)];
        const r = rnd(1.6, Math.max(1.8, Math.min(6, p.half * 0.55)));
        const off = rnd(0, Math.max(0, p.half - r - 1)), oa = rnd(0, Math.PI * 2);
        clasts.push({ x: p.x + Math.cos(oa) * off, y: p.y + Math.sin(oa) * off, o: outline(random, r), aspect: rnd(0.7, 1.3), rot: rnd(0, Math.PI) });
      }
    }
    // Depth into the ore body for every cell (positive inside), and the size of the part each cell
    // belongs to (for the colour zoning).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y, r) => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r); };
    for (const p of points) grow(p.x, p.y, p.half);
    for (const l of lumps) grow(l.x, l.y, l.o.max * Math.max(l.aspect, 1 / l.aspect));
    for (const q of prisms) grow(q.x + Math.cos(q.a) * q.len / 2, q.y + Math.sin(q.a) * q.len / 2, q.len / 2 + q.half);
    for (const g of shells) grow(g.x, g.y, g.o.max);
    const pad = 4;
    x0 = Math.max(1, Math.floor(x0) - pad); y0 = Math.max(1, Math.floor(y0) - pad);
    x1 = Math.min(W - 2, Math.ceil(x1) + pad); y1 = Math.min(H - 2, Math.ceil(y1) + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const depth = new Float32Array(w * h).fill(-9);
    const width = new Float32Array(w * h);   // half-width of the part each cell belongs to
    const near = new Int32Array(w * h).fill(-1);   // the seam point a cell belongs to
    // Variant decided by a part's own crystal geometry (-1: by comb texture; HOLLOW: open space).
    const HOLLOW = -2;
    const art = new Int8Array(w * h).fill(-1);
    const each = (cx0, cy0, r, fn) => {
      for (let y = Math.max(y0, Math.floor(cy0 - r)); y <= Math.min(y1, cy0 + r); y += 1) {
        for (let x = Math.max(x0, Math.floor(cx0 - r)); x <= Math.min(x1, cx0 + r); x += 1) fn(x, y, (y - y0) * w + (x - x0));
      }
    };
    points.forEach((p, index) => each(p.x, p.y, Math.ceil(p.half + 3), (x, y, k) => {
      const d = p.half - Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
      if (d > depth[k]) { depth[k] = d; width[k] = p.half; near[k] = index; art[k] = -1; }
    }));
    // An outlined lump: distance inside its (rotated, stretched) outline, and the facet it is on.
    const local = (l, x, y) => {
      const dx = x + 0.5 - l.x, dy = y + 0.5 - l.y, c = Math.cos(l.rot), s = Math.sin(l.rot);
      return [(dx * c + dy * s) / l.aspect, (-dx * s + dy * c) * l.aspect];
    };
    const inside = (l, x, y) => { const [u, v] = local(l, x, y); return l.o.at(Math.atan2(v, u)) - Math.hypot(u, v); };
    for (const l of lumps) each(l.x, l.y, Math.ceil(l.o.max * Math.max(l.aspect, 1 / l.aspect) + 3), (x, y, k) => {
      const [u, v] = local(l, x, y), a = Math.atan2(v, u), d = l.o.at(a) - Math.hypot(u, v);
      if (d <= depth[k]) return;
      depth[k] = d; width[k] = l.o.max * 0.7;
      // Facets lit from the upper left, a pale rim, dark ridges where facets meet.
      const i = l.o.facet(a), [nx, ny] = l.o.normal(i), c = Math.cos(l.rot), s = Math.sin(l.rot);
      const lit = litBy(nx * c - ny * s, nx * s + ny * c);
      const ridge = l.o.facet(a + 0.9 / Math.max(1, Math.hypot(u, v))) !== i;
      art[k] = d < 0.9 ? 0 : ridge ? 2 : lit > 0.3 ? ((PW.hash2(x, y) % 9) === 0 ? 3 : 1) : lit < -0.25 ? 2 : (x + y) % 2 ? 1 : 2;
    });
    // Prisms: square-shouldered crystals that end in a point; one long face lit, the other in
    // shadow, the point bright.
    for (const q of prisms) {
      const ax = Math.cos(q.a), ay = Math.sin(q.a), point = q.half * 1.8;
      each(q.x + ax * q.len / 2, q.y + ay * q.len / 2, Math.ceil(q.len / 2 + q.half + 2), (x, y, k) => {
        const dx = x + 0.5 - q.x, dy = y + 0.5 - q.y, t = dx * ax + dy * ay, n = -dx * ay + dy * ax;
        if (t < -0.5 || t > q.len) return;
        const half = t > q.len - point ? q.half * (q.len - t) / point : q.half;
        const d = half - Math.abs(n);
        if (d <= depth[k] || d < 0) return;
        depth[k] = d; width[k] = q.half;
        const face = n < 0 ? [ay, -ax] : [-ay, ax];
        art[k] = t > q.len - point * 0.6 ? 3 : litBy(face[0], face[1]) > 0 ? 1 : 2;
      });
    }
    // Geodes: a pale shell, a dark band of crystal bases, then teeth pointing into the hollow.
    for (const g of shells) each(g.x, g.y, Math.ceil(g.o.max + 2), (x, y, k) => {
      const dx = x + 0.5 - g.x, dy = y + 0.5 - g.y, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const d = g.o.at(a) - r;
      if (d < 0 || d <= depth[k]) return;
      depth[k] = d; width[k] = g.o.max;
      const u = ((a / (Math.PI * 2) * g.teeth + g.phase) % 1 + 1) % 1;
      const reach = g.inner - g.tooth * (1 - Math.abs(2 * u - 1));   // the hollow's edge, toothed
      if (r < reach) { art[k] = HOLLOW; return; }
      const tx = -Math.sin(a), ty = Math.cos(a), side = u < 0.5 ? -1 : 1;
      const lit = litBy(tx * side, ty * side) > 0;
      art[k] = d < 1.4 ? 0 : d < 2.4 ? 2 : r < reach + 1.2 && Math.abs(u - 0.5) < 0.22 ? 3 : lit ? 1 : 2;
    });
    const stamp = (l, field) => each(l.x, l.y, Math.ceil(l.o.max * Math.max(l.aspect, 1 / l.aspect) + 3), (x, y, k) => {
      const d = inside(l, x, y);
      if (d > field[k]) field[k] = d;
    });
    const rubble = clasts.length ? new Float32Array(w * h).fill(-9) : null;
    for (const c of clasts) stamp(c, rubble);
    // Comb texture across a seam: crystals 3.2 cells wide grow from both walls (interlocking) to a
    // suture down the middle; each is lit on one side and shaded on the other, with dark lines
    // between them and bright points at the suture.
    const comb = (k, x, y) => {
      const p = points[near[k]], d = depth[k], half = width[k];
      if (d < Math.min(1.1, half * 0.32)) return 0;
      const ca = Math.cos(p.a), sa = Math.sin(p.a), dx = x + 0.5 - p.x, dy = y + 0.5 - p.y;
      const along = p.s + dx * ca + dy * sa, side = -dx * sa + dy * ca >= 0 ? 1 : -1;
      // (crystals of uneven width: the boundaries wander a little)
      const wobble = 0.9 * Math.sin(along * 0.37 + side * 2.1) + 0.5 * Math.sin(along * 1.13 + side);
      const u = (((along + wobble + (side > 0 ? 1.6 : 0)) / 3.2) % 1 + 1) % 1;
      if (u < 0.1) return 2;
      if (half > 1.8 && d > half - 1.1 && Math.abs(u - 0.5) < 0.2) return 3;
      const lit = litBy(ca * (u < 0.5 ? -1 : 1), sa * (u < 0.5 ? -1 : 1)) > 0;
      return lit ? 1 : 2;
    };
    // Geodes: hollows in the widest swells, lined with crystal points.
    const geodes = [];
    if (spec.geodes > 0) {
      const wide = hollows.filter((p) => p.half >= 4.5).sort((a, b) => b.half - a.half);
      for (const p of wide) {
        if (geodes.length >= Math.ceil(spec.geodes * 3) || random() > spec.geodes) continue;
        if (geodes.some((g) => Math.hypot(g.x - p.x, g.y - p.y) < 30)) continue;
        const r = Math.min(p.half - 1.8, random.range(2.6, 6.5));
        geodes.push({ x: p.x, y: p.y, r, o: outline(random, r, random.int(5, 7)), teeth: Math.max(6, Math.round(r * 1.9)) });
      }
    }
    // A deposit that would hold almost no ore (it fell in a cave) is not laid at all.
    let would = 0;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const k = (y - y0) * w + (x - x0), id = mat[y * W + x] & 63;
      if (depth[k] >= 0 && art[k] !== HOLLOW && !(rubble && rubble[k] >= 0) && id !== M.BEDROCK && id !== M.AIR && id !== M.WATER) would += 1;
    }
    if (would < MIN_ORE) return null;
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
        // A breccia's fragments are broken host rock, each rimmed with pale selvage; a geode's
        // middle is open.
        const fragment = rubble ? rubble[k] : -9;
        if (fragment >= 0) { mat[index] = M.STONE | (PW.hash2(x >> 1, y >> 1) & 3) << 6; continue; }
        if (art[k] === HOLLOW) { mat[index] = M.AIR; continue; }
        let variant = art[k] >= 0 ? art[k] : near[k] >= 0 ? comb(k, x, y) : 1;
        if (fragment > -1.2) variant = 0;
        mat[index] = M.ORE | variant << 6;
        cells += 1;
      }
    }
    for (const g of geodes) {
      for (let y = Math.floor(g.y - g.r - 3); y <= g.y + g.r + 3; y += 1) {
        for (let x = Math.floor(g.x - g.r - 3); x <= g.x + g.r + 3; x += 1) {
          const dx = x + 0.5 - g.x, dy = y + 0.5 - g.y, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
          const index = y * W + x;
          if ((mat[index] & 63) !== M.ORE) continue;
          // An angular hollow whose wall bristles with crystal points (sharp triangular teeth).
          const u = ((a / (Math.PI * 2) * g.teeth) % 1 + 1) % 1, edge = g.o.at(a);
          const teeth = 1.8 * (1 - Math.abs(2 * u - 1));
          if (d < edge - teeth) { mat[index] = M.AIR; cells -= 1; } else if (d < edge + 1.2) mat[index] = M.ORE | (Math.abs(u - 0.5) < 0.25 ? 3 : u < 0.5 ? 1 : 2) << 6;
        }
      }
    }
    const seamLike = form === 'seam' || form === 'lens';
    return { x: Math.round(cx), y: Math.round(cy), radius: seamLike ? Math.round(thick / 2) : Math.round(Math.max(x1 - x0, y1 - y0) / 2 - pad),
      length: Math.round(length), angle, form, tier: spec.tier, amount: cells, geodes: geodes.length, box: { x0, y0, x1, y1 } };
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
        const node = oreVein(world, x, y, spec, random);
        if (!node) continue;
        nodes.push(node);
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
