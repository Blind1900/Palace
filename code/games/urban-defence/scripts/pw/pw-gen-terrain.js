'use strict';
// Terrain generation for the pixel world: a wide map with five settlement sites (left base, three
// neutral towns, right base), mountains and lakes between them, soil strata, ore nodes and caves.
(function () {
  const PW = window.PW;
  const { M } = PW;

  const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  // A site's relief over its level. A neutral site: a tilt of up to 80 cells across it and a swell
  // of 10-26 cells every 600-1000 (slopes up to about 1:3). A base: gentler (a tilt of up to 36 and
  // a swell of 5-13), and the same for both bases measured from the rear, so the two sides are
  // mirror images and neither starts on better ground. Drawn from hashes, so the rest of the
  // layout's random sequence is unchanged.
  function siteRelief(site, x) {
    const base = site.kind !== 'neutral';
    const h = (k) => (PW.hash2(base ? 0x0ba5e : site.x0, k) & 1023) / 1023;
    const span = site.x1 - site.x0;
    const along = base && site.side === 'right' ? site.x1 - x : x - site.x0;
    const tilt = (h(1) * 2 - 1) * (base ? 36 : 80), amp = base ? 5 + h(2) * 8 : 10 + h(2) * 16;
    const period = 600 + h(3) * 400, phase = h(4) * Math.PI * 2;
    return tilt * (smooth(along / span) - 0.5) + amp * Math.sin(along / period * Math.PI * 2 + phase);
  }

  function planLayout(world, random, seed = 1) {
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
    // Each wild zone is laid out as a run of landforms across it, after the nature refs: ranges of
    // pyramid peaks with foothills at their feet; valley floors between them (flat ground for
    // towns and farms); lakes; and broad river flats, where a braided river runs in shallow
    // channels between gravel bars. Every zone has a range, a valley floor and water; a wide zone
    // holds more. Mountains take the zone's ends beside the sites now and then, so a town may
    // look out over a mountain wall or over open country.
    const mountains = [], lakes = [], pockets = [];
    const roll = (a, b) => (PW.hash2(a, b) & 1023) / 1023;
    const SHARE = { range: 1.7, peak: 0.95, valley: 1.15, lake: 0.85, river: 1.2 };
    // A massif: a pyramid peak on a broad base (straight flanks of about 34-41 degrees), spurs on
    // its flanks, and low rounded foothills easing it into the flat at its feet.
    const massif = (center, room) => {
      const height = random.range(560, 1050) * Math.min(1, 0.45 + room / 2600);
      const half = Math.min(room * 0.56, height * random.range(1.15, 1.5));
      const peaks = [{ x: center, height, left: half * random.range(0.85, 1.1), right: half * random.range(0.85, 1.1),
        shape: random.range(1.0, 1.22), kind: 'pyramid' }];
      for (let s = random.int(0, 2); s > 0; s -= 1) {
        const side = random() < 0.5 ? -1 : 1, spread = half * random.range(0.34, 0.5);
        peaks.push({ x: center + side * half * random.range(0.3, 0.55), height: height * random.range(0.42, 0.7),
          left: spread, right: spread, shape: random.range(1.0, 1.2), kind: 'pyramid' });
      }
      for (const side of [-1, 1]) {
        if (random() < 0.25) continue;
        const spread = half * random.range(0.3, 0.45);
        peaks.push({ x: center + side * half * random.range(0.78, 0.98), height: height * random.range(0.1, 0.2),
          left: spread, right: spread, shape: random.range(1.2, 1.6), kind: 'hill' });
      }
      mountains.push({ x: center, half: half * 1.12, height, peaks, seed: random.int(1, 1e9),
        mesa: random() < 0.12 ? random.range(0.78, 0.9) : 0 });
    };
    wilds.forEach((zone, index) => {
      const width = zone.x1 - zone.x0;
      const picked = ['range', 'valley', random() < 0.55 ? 'lake' : 'river'];
      for (let room = width - 3600; room > 1200; room -= 1600) picked.push(random.pick(['range', 'peak', 'valley', 'lake', 'river']));
      // Dry land in a shuffled row, each water in a gap of its own between (never two side by side).
      const shuffle = (list) => { for (let i = list.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
      const dry = shuffle(picked.filter((p) => p !== 'lake' && p !== 'river'));
      const wet = picked.filter((p) => p === 'lake' || p === 'river');
      const gaps = shuffle(Array.from({ length: dry.length + 1 }, (_, k) => k)).slice(0, wet.length).sort((a, b) => b - a);
      const parts = dry.slice();
      gaps.forEach((gap, k) => parts.splice(gap, 0, wet[k]));
      const total = parts.reduce((sum, part) => sum + SHARE[part], 0);
      let at = zone.x0;
      parts.forEach((part) => {
        const share = width * SHARE[part] / total, from = at, mid = from + share / 2;
        at += share;
        if (part === 'valley') {
          const w = share * 0.82;
          pockets.push({ kind: 'valley', x0: Math.round(mid - w / 2), x1: Math.round(mid + w / 2), shoulder: 150 });
        } else if (part === 'lake') {
          // (its bowl and shore stay within its share of the zone, and well clear of the sites)
          const x = mid + random.range(-0.08, 0.08) * share;
          const room = Math.min(x - from, from + share - x, x - zone.x0 - 300, zone.x1 - 300 - x) / 1.3;
          lakes.push({ x, half: Math.max(160, Math.min(room, random.range(320, 600))), depth: random.range(160, 280) });
        } else if (part === 'river') {
          // A broad flat valley floor with a braided river across its middle: shallow channels
          // parting and rejoining round gravel bars.
          const w = share * 0.84;
          pockets.push({ kind: 'river', x0: Math.round(mid - w / 2), x1: Math.round(mid + w / 2), shoulder: 170 });
          const n = random.int(3, 5), span = w * 0.55;
          for (let k = 0; k < n; k += 1) {
            lakes.push({ x: mid - span / 2 + span * (k + 0.5) / n + random.range(-0.2, 0.2) * span / n,
              half: random.range(0.22, 0.34) * span / n, depth: random.range(14, 26), river: true });
          }
        } else {
          const count = part === 'peak' ? 1 : share > 2600 ? random.int(2, 3) : 2;
          for (let k = 0; k < count; k += 1) massif(from + share * (k + 0.5) / count + random.range(-0.08, 0.08) * share / count, share / count);
        }
      });
    });
    // N124 (the user's, 2026-11-23): the map's ends are open country - no mountain stands within
    // FLAT_END of either end (each side has that much flat land to found its capital and spread
    // before the first range), and the centre is the map's great barrier: in place of the middle
    // town, a larger mountain than any other or a wide lake. Laid after the zones have spent their
    // draws (the shapes are drawn from hashes), so the rest of the world is laid as it was.
    const FLAT_END = 0.22;
    const flatL = W * FLAT_END, flatR = W * (1 - FLAT_END);
    // N133 (the user's, 2026-11-24): a land for ground troops - one or two high mountains on the
    // whole map, every other range worn down to rolling hills; no lakes but the one near each end
    // and, if it is the centre's, the great lake; most rises and falls gradual, every slope one a
    // tank can climb (the profile's grade limit, below).
    const centreSite = sites[2], wing = Math.round((wilds[1].x1 - wilds[1].x0) * 0.3);
    const c0 = centreSite.x0 - wing, c1 = centreSite.x1 + wing, cx = Math.round((centreSite.x0 + centreSite.x1) / 2);
    const crest = (k) => (PW.hash2(seed * 31 + 0xce17e, k) & 1023) / 1023;
    const centreMountain = crest(1) < 0.6;
    const hills = [];
    // (the high ones kept, when the centre is a lake: the tallest range on each side of it)
    const keep = new Set();
    if (!centreMountain) {
      for (const half of [-1, 1]) {
        const best = mountains.filter((m) => (m.x - cx) * half > 0 && m.x - m.half >= flatL && m.x + m.half <= flatR && (m.x + m.half < c0 || m.x - m.half > c1))
          .sort((p, q) => q.height - p.height)[0];
        if (best) keep.add(best);
      }
    }
    for (let i = mountains.length - 1; i >= 0; i -= 1) {
      const m = mountains[i], a = m.x - m.half, b = m.x + m.half;
      if (keep.has(m)) continue;
      mountains.splice(i, 1);
      if (a < flatL || b > flatR) {
        // (where it stood, a valley floor: flat ground, not a hole in the relief)
        pockets.push({ kind: 'valley', x0: Math.round(Math.max(a, sites[0].x1 + 200)), x1: Math.round(Math.min(b, sites[4].x0 - 200)), shoulder: 150 });
      } else if (b < c0 || a > c1) {
        // a range worn down to a long rolling hill
        const k = i * 7 + 3, h = 80 + crest(k) * 120, half = Math.max(m.half * 1.25, h * 4.5);
        hills.push({ x: m.x, half, height: h, peaks: [{ x: m.x, height: h, left: half, right: half, shape: 1.15 + crest(k + 1) * 0.3, kind: 'hill' }],
          seed: m.seed, mesa: 0 });
      }
    }
    for (let i = lakes.length - 1; i >= 0; i -= 1) lakes.splice(i, 1);
    for (let i = pockets.length - 1; i >= 0; i -= 1) {
      if (pockets[i].x1 > c0 && pockets[i].x0 < c1) pockets.splice(i, 1);
      else if (pockets[i].kind === 'river') pockets[i].kind = 'valley';
    }
    let centre;
    if (centreMountain) {
      const tallest = 1000;
      const height = Math.min(baseY - 260, tallest * (1.15 + crest(2) * 0.15)), half = (c1 - c0) / 2;
      const peaks = [{ x: cx, height, left: half * (0.86 + crest(3) * 0.1), right: half * (0.86 + crest(4) * 0.1), shape: 1.05 + crest(5) * 0.12, kind: 'pyramid' }];
      for (const side of [-1, 1]) {
        peaks.push({ x: cx + side * half * (0.32 + crest(6 + side) * 0.18), height: height * (0.5 + crest(8 + side) * 0.18),
          left: half * 0.42, right: half * 0.42, shape: 1.1, kind: 'pyramid' });
        peaks.push({ x: cx + side * half * 0.9, height: height * 0.14, left: half * 0.36, right: half * 0.36, shape: 1.4, kind: 'hill' });
      }
      mountains.push({ x: cx, half: half * 1.08, height, peaks, seed: (seed * 7919 + 0xce17e) % 1000000000, mesa: 0, centre: true });
      centre = { kind: 'mountain', x: cx, half, height };
    } else {
      const half = Math.min((c1 - c0) / 2 - 120, 900 + crest(2) * 300);
      lakes.push({ x: cx, half, depth: 300 + crest(3) * 80, centre: true });
      centre = { kind: 'lake', x: cx, half };
    }
    sites.splice(2, 1);
    wilds.splice(1, 2, { x0: wilds[1].x0, x1: wilds[2].x1 });
    // A pond beside each base for its farms, on the outer side.
    lakes.push({ x: sites[0].x0 - margin * 0.5 + 40, half: 180, depth: 110, pond: true });
    lakes.push({ x: sites[sites.length - 1].x1 + margin * 0.5 - 40, half: 180, depth: 110, pond: true });
    // Pockets of flat land in the wild, good ground for a city, a farm or both: the valley floors
    // above, and on a broad mountain now and then a bench, a flat shelf partway up one flank.
    // (drawn from hashes, so the layout's random sequence is unchanged)
    mountains.forEach((m, index) => {
      if (m.half < 380 || m.height < 450 || m.mesa || roll(index, 7) < 0.4) return;
      const side = roll(index, 8) < 0.5 ? -1 : 1, mid = m.x + side * m.half * (0.45 + roll(index, 9) * 0.15), width = Math.min(320, m.half * (0.5 + roll(index, 10) * 0.2));
      pockets.push({ kind: 'bench', x0: Math.round(mid - width / 2), x1: Math.round(mid + width / 2), shoulder: 90 });
    });
    // (a pocket keeps clear of every lake's shore - a river flat of all but its own channels - and
    // of the sites)
    for (const p of pockets) {
      const wet = lakes.filter((l) => !(p.kind === 'river' && l.river && l.x > p.x0 && l.x < p.x1));
      for (const [a, b] of [...wet.map((l) => [l.x - l.half * 1.25 - 40, l.x + l.half * 1.25 + 40]), ...sites.map((s) => [s.x0, s.x1])]) {
        if (b < p.x0 || a > p.x1) continue;
        if ((a + b) / 2 < (p.x0 + p.x1) / 2) p.x0 = Math.ceil(b); else p.x1 = Math.floor(a);
      }
    }
    for (let i = pockets.length - 1; i >= 0; i -= 1) if (pockets[i].x1 - pockets[i].x0 < 200) pockets.splice(i, 1);
    return { baseY, sites, wilds, mountains, hills, lakes, pockets, centre, flatEnd: [Math.round(flatL), Math.round(flatR)] };
  }

  // Surface height (row of the first ground cell) for every column.
  function surfaceProfile(world, layout, seed) {
    const W = world.width;
    const surface = new Float32Array(W);
    const hills = [PW.createNoise1D(seed + 11, 2400), PW.createNoise1D(seed + 12, 900),
      PW.createNoise1D(seed + 13, 260), PW.createNoise1D(seed + 14, 70), PW.createNoise1D(seed + 15, 22)];
    const ridge = PW.createNoise1D(seed + 21, 140);
    const ridgeFine = PW.createNoise1D(seed + 22, 36);
    const crags = PW.createNoise1D(seed + 23, 26), bands = PW.createNoise1D(seed + 24, 300);
    const raw = new Float32Array(W);
    // How far up its mountain each column stands (0 at the foot, 1 at the summit): bare rock and
    // boulders gather near the tops (see fillStrata and the vegetation's rocks).
    const relief = layout.relief = new Float32Array(W);
    // How much mountain stands over each column: the massif's body runs from the surface down to
    // the ground the mountain was raised on (its foot line). The rock in that body is one rock
    // mass, not country strata (the renderer draws it as such).
    const liftSum = new Float32Array(W);
    // (two peaks meet in a rounded saddle, not a notch: a smooth maximum, its rounding shrinking
    // to nothing towards their feet)
    const smax = (a, b) => {
      const k = Math.min(70, 0.5 * Math.min(a, b));
      if (k <= 0) return Math.max(a, b);
      const h = Math.max(k - Math.abs(a - b), 0) / k;
      return Math.max(a, b) + h * h * k / 4;
    };
    for (let x = 0; x < W; x += 1) {
      // (N133: the land's own rise and fall gradual - the short swells and the fine roughness
      // that made steps a man or a hull balks at are a third of what they were)
      let y = layout.baseY
        - hills[0](x) * 170 - hills[1](x) * 95 - hills[2](x) * 12 - hills[3](x) * 3 - hills[4](x) * 1;
      for (const m of layout.mountains) {
        let lift = 0;
        for (const peak of m.peaks) {
          const spread = x < peak.x ? peak.left : peak.right;
          const t = Math.abs(x - peak.x) / spread;
          if (t >= 1) continue;
          // A pyramid's flanks run straight (a little concave towards the foot); a foothill is
          // rounded.
          const f = peak.kind === 'pyramid' ? Math.pow(1 - t, peak.shape) : Math.pow(1 - smooth(t), peak.shape);
          lift = smax(lift, peak.height * f);
        }
        if (!lift) continue;
        // Mesas are cut flat near the top.
        if (m.mesa) lift = Math.min(lift, m.height * m.mesa + (lift - m.height * m.mesa) * 0.08);
        // Cliff bands on the upper flanks: the harder beds stand out as ledges over steep risers.
        const band = 34 + 12 * (bands(m.seed) + 1);
        const q = lift / band, terraced = band * (Math.floor(q) + Math.pow(q - Math.floor(q), 2.2));
        lift += (terraced - lift) * 0.5 * smooth((lift / m.height - 0.3) / 0.3);
        // Rough, multi-scale edges; crags (sharp-crested knobs) more the higher up.
        const c = 1 - Math.abs(crags(x + m.seed));
        const rough = 1 + ridge(x + m.seed) * 0.1 + ridgeFine(x - m.seed) * 0.04 + hills[4](x * 3 + m.seed) * 0.012
          + c * c * c * 0.05 * smooth(lift / m.height / 0.6);
        y -= lift * rough;
        liftSum[x] += lift * rough;
        relief[x] = Math.max(relief[x], Math.min(1, lift / m.height));
      }
      // (N133: the ranges worn down to hills - long, rounded, country ground all through)
      for (const hl of layout.hills || []) {
        const t = Math.abs(x - hl.x) / hl.half;
        if (t < 1) y -= hl.height * Math.pow(1 - smooth(t), hl.peaks[0].shape);
      }
      // Edges of the map rise into hills.
      const edge = Math.min(x, W - 1 - x);
      if (edge < 380) y -= Math.pow(1 - edge / 380, 2) * 260;
      raw[x] = y;
    }
    // A pocket of flat land lies at the land's own height: a valley floor at the mean of the
    // ground over it, a bench at the height of the flank it is cut into. Its shoulders blend into
    // the land around over `shoulder` columns.
    for (const p of layout.pockets || []) {
      if (p.kind === 'valley') { let sum = 0; for (let x = p.x0; x <= p.x1; x += 1) sum += raw[x]; p.level = Math.round(sum / (p.x1 - p.x0 + 1)); }
      else p.level = Math.round(raw[(p.x0 + p.x1) >> 1]);
    }
    for (let x = 0; x < W; x += 1) {
      let y = raw[x];
      // Settlement sites are eased towards their level with smooth shoulders: bases flat, neutral
      // towns keeping a rolling relief their buildings are set into.
      for (const site of layout.sites) {
        const inside = Math.min(x - site.x0, site.x1 - x);
        const blend = smooth((inside + 260) / 260);
        if (blend > 0) { y = y + (site.level + hills[4](x) * 0.6 + siteRelief(site, x) - y) * blend; liftSum[x] *= 1 - blend; }
      }
      // (a pocket beside a site keeps its own level over the site's shoulder)
      for (const p of layout.pockets || []) {
        const blend = smooth((Math.min(x - p.x0, p.x1 - x) + p.shoulder) / p.shoulder);
        if (blend > 0) { y += (p.level + hills[4](x) * 0.6 - y) * blend; liftSum[x] *= 1 - blend; }
      }
      surface[x] = y;
    }
    // N133 (the user's): every slope one a tank can climb - the ground never rises or falls more
    // than GRADE a column (38 degrees, under the tanks' 43), the crests worn down to it
    // - and off the mountains the land no steeper than LAND_GRADE (24 degrees: rolling country)
    const GRADE = 0.8, LAND_GRADE = 0.45;
    const gradeAt = (x) => (relief[x] > 0.02 ? GRADE : LAND_GRADE);
    for (let x = 1; x < W; x += 1) { const g = gradeAt(x); if (surface[x] < surface[x - 1] - g) surface[x] = surface[x - 1] - g; }
    for (let x = W - 2; x >= 0; x -= 1) { const g = gradeAt(x); if (surface[x] < surface[x + 1] - g) surface[x] = surface[x + 1] - g; }
    for (let x = 0; x < W; x += 1) {
      let y = surface[x];
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
    // The massif foot line: below it the ground is country strata again. (Lakes may carve into a
    // massif's flank; their bowls stay inside the rock mass, so the foot line ignores them.)
    const massifBottom = layout.massifBottom = new Int32Array(W);
    for (let x = 0; x < W; x += 1) massifBottom[x] = Math.round(surface[x] + (liftSum[x] > 24 ? liftSum[x] : 0));
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
    // (N8: each column's lattice cell and smoothed weight worked out once, not per sample - the
    // strata fill samples every cell of the map; the same numbers, so the same world)
    const colIndex = new Int32Array(world.width), colWeight = new Float64Array(world.width);
    for (let x = 0; x < world.width; x += 1) {
      const fx = x / 16, ix = fx | 0, t = fx - ix;
      colIndex[x] = ix; colWeight[x] = t * t * (3 - 2 * t);
    }
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
        const ix = colIndex[x];
        return rowValues[ix] + (rowValues[ix + 1] - rowValues[ix]) * colWeight[x];
      },
    };
  }

  // Subsoil country: brown earth, pale yellow loess or red laterite in broad belts across the map,
  // each blending into the next over a few hundred columns. Kept as each column's tint of the
  // subsoil's colours (r g b in 1/256) and its loess and laterite shares.
  const LOESS = [1.3, 1.3, 1.24], LATERITE = [1.2, 0.88, 0.84];
  function soilProvinces(world, seed, layout) {
    const W = world.width, belt = PW.createNoise1D(seed + 51, 2200);
    const tint = new Uint16Array(W * 3), loess = new Float32Array(W), laterite = new Float32Array(W);
    const relief = (layout && layout.relief) || null;
    for (let x = 0; x < W; x += 1) {
      const v = belt(x);
      // The belts are lowland soils: they fade off a mountain's flanks (the thin soil up there is
      // plain weathered rock earth, never a red or yellow stripe across the massif).
      const lowland = relief ? 1 - smooth((relief[x] - 0.08) / 0.3) : 1;
      loess[x] = smooth((v - 0.18) / 0.3) * lowland;
      laterite[x] = smooth((-v - 0.18) / 0.3) * lowland;
      for (let c = 0; c < 3; c += 1) tint[x * 3 + c] = Math.round(256 * (1 + (LOESS[c] - 1) * loess[x] + (LATERITE[c] - 1) * laterite[x]));
    }
    return { tint, loess, laterite };
  }

  function fillStrata(world, layout, surface, seed) {
    const { width: W, height: H, mat } = world;
    const { laterite } = world.soil;
    const variants = createField(world, seed + 31, 6);
    const lenses = createField(world, seed + 35, 4);
    const topsoilNoise = PW.createNoise1D(seed + 41, 90);
    const soilNoise = PW.createNoise1D(seed + 42, 420);
    const soilFine = PW.createNoise1D(seed + 43, 60);
    const stoneNoise = PW.createNoise1D(seed + 44, 700);
    const stoneFine = PW.createNoise1D(seed + 46, 45);
    const bedrockNoise = PW.createNoise1D(seed + 45, 50);
    const outcrops = PW.createNoise1D(seed + 47, 160), turf = PW.createNoise1D(seed + 48, 26);
    const foot = PW.createNoise1D(seed + 49, 18);
    const top = new Int32Array(W);
    const soilEnd = new Int32Array(W), stoneStart = new Int32Array(W), grassEnd = new Int32Array(W),
      topsoilEnd = new Int32Array(W), bedrockStart = new Int32Array(W), ragged = new Float32Array(W), keeps = new Float32Array(W);
    // The topsoil's foot is not a clean line: it waves, and tongues of dark topsoil reach down into
    // the subsoil along old root and worm channels, leaning a little, narrowing to a point (one
    // every 22 columns or so, two in three places). Now and then a krotovina, an old burrow filled
    // with topsoil, sits in the subsoil below. Under red laterite the boundary is sharper (short
    // tongues); on thin soil there are fewer and shorter ones.
    const TONGUE = 22, BURROW = 76;
    const tongueAt = (x, y) => {
      const cell = (x / TONGUE) | 0, h = PW.hash2(cell, seed ^ 0x70e);
      if (h % 3 === 0) return false;
      const c = Math.min(W - 1, cell * TONGUE + 6 + (h >>> 4) % 10);
      const depth = (5 + (h >>> 8) % 11) * keeps[c] * (1 - 0.65 * laterite[c]);
      const t = (y - topsoilEnd[c]) / depth;
      if (!(t >= 0 && t < 1)) return false;
      const w = 1.5 + ((h >>> 12) % 5) * 0.6, lean = (((h >>> 16) % 9) - 4) * 0.12;
      return Math.abs(x - c - lean * (y - topsoilEnd[c])) < w * Math.pow(1 - t, 0.7) + 0.3;
    };
    const burrowAt = (x, y) => {
      const cell = (x / BURROW) | 0, h = PW.hash2(cell, seed ^ 0xb0e);
      if (h % 3) return false;
      const c = Math.min(W - 1, cell * BURROW + 12 + (h >>> 4) % 50);
      if (keeps[c] < 0.6) return false;
      const dx = (x - c) / (2 + (h >>> 10) % 3), dy = (y - topsoilEnd[c] - 8 - (h >>> 14) % 22) / (1.6 + ((h >>> 20) % 3) * 0.5);
      return dx * dx + dy * dy < 1;
    };
    // The lie of the land: steepness averaged over 40 columns either way. Soil and rock follow it,
    // not every step of the surface, so a cliff does not drag a seam of soil and stone down
    // through the ground under it: the soil mantle thins smoothly towards steep ground until bare
    // rock crops out on the faces, and stays deep on the flats.
    const LIE = 40, lie = new Float32Array(W), climb = new Float64Array(W + 1);
    for (let x = 0; x < W; x += 1) climb[x + 1] = climb[x] + Math.abs(surface[Math.min(W - 1, x + 1)] - surface[x]);
    for (let x = 0; x < W; x += 1) {
      const a = Math.max(0, x - LIE), b = Math.min(W - 1, x + LIE);
      lie[x] = (climb[b + 1] - climb[a]) / (b - a + 1);
    }
    for (let x = 0; x < W; x += 1) {
      const surfaceRow = Math.max(4, Math.min(H - 60, Math.round(surface[x])));
      top[x] = surfaceRow;
      const slope = Math.abs(surface[Math.min(W - 1, x + 3)] - surface[Math.max(0, x - 3)]) / 6;
      const altitude = layout.baseY - surfaceRow;   // positive above the base line
      // How much of a full soil profile the ground here keeps: all of it on flats, little on steep
      // or high ground, and here and there less (rock outcrops on a slope).
      // (forest still roots on a 45° mountainside; the soil only gives out on cliffs and summits)
      let keep = Math.min(1, Math.max(0.05, 1.3 - lie[x] * 0.6));
      keep *= 1 - Math.min(0.6, Math.max(0, altitude - 380) / 800);
      // (the upper third of a mountain is bare rock)
      if (layout.relief) keep = Math.max(0.03, keep * (1 - 0.92 * smooth((layout.relief[x] - 0.6) / 0.25)));
      if (lie[x] > 0.7) keep *= Math.min(1, Math.max(0.2, 0.9 + outcrops(x) * 0.5));
      keeps[x] = keep;
      const topsoil = Math.max(0, Math.round((14 + topsoilNoise(x) * 7 + foot(x) * 2.2) * keep));
      // Grass needs soil to root in and ground not too steep (it thins out on steep slopes).
      // (on a steep slope the turf breaks into patches with bare soil between, never column by column)
      const bare = slope > 1.4 && turf(x) < (slope - 1.4) * 4 - 0.5;
      const grass = topsoil < 2 || slope > 1.7 || altitude > 600 || bare ? 0 : 3 + (PW.hash2(x, 7) & 1);
      // (where almost nothing holds, nothing does: bare rock)
      const soil = keep < 0.12 ? 0 : Math.round((150 + soilNoise(x) * 70 + soilFine(x) * 16) * keep);
      grassEnd[x] = surfaceRow + grass;
      topsoilEnd[x] = grassEnd[x] + topsoil;
      soilEnd[x] = topsoilEnd[x] + soil;
      stoneStart[x] = soilEnd[x] + Math.round((110 + stoneNoise(x) * 90 + stoneFine(x) * 18) * keep);
      ragged[x] = 0.15 + 0.85 * keep;     // the soil-rock boundary's raggedness, less where it is shallow
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
        else if (y < soilEnd[x]) id = y < topsoilEnd[x] + 40 && (tongueAt(x, y) || burrowAt(x, y)) ? M.TOPSOIL : M.SOIL;
        else {
          // Soil gives way to stone through clay and gravel lenses with a ragged boundary.
          const lens = lenses.sample(x);
          const edge = Math.max(soilEnd[x], stoneStart[x] + Math.round((lens - 0.5) * 120 * ragged[x]));
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

  // Scree: rock falls off a bare rock wall and piles up at its foot at the angle of repose (about 32°),
  // banked against the lower part of the face and spreading out over the ground below, as under
  // the walls of a mountain valley. Only in the wild land, never on a settlement site. Updates the
  // surface and top rows; returns the scree aprons.
  const REPOSE = 0.62;
  function scree(world, layout, surface, top, seed) {
    const { mat, width: W, height: H } = world;
    const grain = PW.createNoise1D(seed + 61, 9);
    const wild = (x) => layout.sites.every((s) => x < s.x0 - 320 || x > s.x1 + 320);
    // (scree never runs into a lake: it stops at the shore)
    const wet = (x) => layout.lakes.some((l) => Math.abs(x - l.x) < l.half * 1.1);
    // Faces are found on the land as it was, so an apron's own toe is never taken for a cliff.
    const land = Float32Array.from(surface);
    const steep = (x) => (land[Math.min(W - 1, x + 3)] - land[Math.max(0, x - 3)]) / 6;
    const aprons = [];
    for (const dir of [1, -1]) {
      // A face falling away towards `dir`: a run of columns steeper than about 55°.
      for (let x = 4; x < W - 4; x += 1) {
        const fx = dir > 0 ? x : W - 1 - x;
        // (a bare rock wall: steeper than about 60°, where no soil holds)
        if (steep(fx) * dir < 1.8) continue;
        let foot = fx;
        while (foot > 3 && foot < W - 4 && steep(foot + dir) * dir >= 1.8) foot += dir;
        const head = fx, drop = land[foot] - land[head];
        x += Math.abs(foot - fx);
        if (drop < 60 || !wild(head) || !wild(foot) || wet(foot)) continue;
        // The apron: banked against the face up to its crest, its surface falling away at the
        // angle of repose, and thinning out to nothing at its toe (as much rock as the face shed).
        const rise = Math.min(drop * 0.3, 60), reach = Math.min(140, rise / REPOSE * 1.6);
        const crest = land[foot] - rise;
        let filled = 0;
        for (let k = -Math.abs(foot - head); k < reach; k += 1) {
          const cx = foot + dir * k;
          if (cx < 2 || cx > W - 3 || !wild(cx) || wet(cx)) break;
          const cap = k <= 0 ? Infinity : rise * Math.pow(1 - k / reach, 1.6);
          if (cap < 1) break;
          const apron = Math.max(crest + k * REPOSE + grain(cx) * 2.5, surface[cx] - cap);
          if (apron >= surface[cx] - 0.5) continue;
          const from = Math.max(4, Math.round(apron)), to = Math.round(surface[cx]);
          for (let y = from; y < to && y < H - 40; y += 1) {
            // Coarse rock under a skin of finer gravel; the odd block of stone in it.
            const block = (PW.hash2(cx >> 2, y >> 2) & 15) === 0;
            mat[y * W + cx] = (block ? M.STONE : M.GRAVEL) | (PW.hash2(cx, y) & 3) << 6;
          }
          // (the turf it buried is old topsoil now)
          for (let y = to; y < to + 5 && y < H - 40; y += 1) if ((mat[y * W + cx] & 63) === M.GRASS) mat[y * W + cx] = M.TOPSOIL | (mat[y * W + cx] & 0xc0);
          surface[cx] = from; top[cx] = from;
          filled += 1;
        }
        if (filled) aprons.push({ x0: Math.min(foot, foot + dir * filled), x1: Math.max(foot, foot + dir * filled), dir });
      }
    }
    return aprons;
  }

  // N133: what the scree and the talus banked up is held to the land's grade as well - any crest
  // left steeper than a tank climbs is cut back to it (lakes' bowls and shores aside)
  function gradeCut(world, layout, surface, top) {
    const { mat, width: W } = world, G = 0.8;
    const wet = (x) => layout.lakes.some((l) => Math.abs(x - l.x) < l.half * 1.3);
    const lim = Float32Array.from(surface);
    for (let x = 1; x < W; x += 1) if (!wet(x) && lim[x] < lim[x - 1] - G) lim[x] = lim[x - 1] - G;
    for (let x = W - 2; x >= 0; x -= 1) if (!wet(x) && lim[x] < lim[x + 1] - G) lim[x] = lim[x + 1] - G;
    for (let x = 0; x < W; x += 1) {
      const to = Math.round(lim[x]);
      if (to <= Math.round(surface[x])) continue;
      for (let y = Math.max(0, Math.round(surface[x])); y < to; y += 1) mat[y * W + x] = M.AIR;
      surface[x] = to; top[x] = to;
    }
  }
  // Talus: at the foot of every mountain, where its flank meets the flat, the rock it has shed
  // lies banked against the slope and spreads out over the ground below - coarse gravel with
  // blocks of stone in it, thickest at the break of slope and thinning out to nothing at its toe
  // (the mountains are rocky at their bases as well as at their tops). Returns the aprons.
  function talus(world, layout, surface, top, seed) {
    const { mat, width: W, height: H } = world;
    const grain = PW.createNoise1D(seed + 63, 11);
    const wild = (x) => layout.sites.every((s) => x < s.x0 - 320 || x > s.x1 + 320);
    const wet = (x) => layout.lakes.some((l) => Math.abs(x - l.x) < l.half * 1.15);
    const pocket = (x) => (layout.pockets || []).some((p) => x > p.x0 + 60 && x < p.x1 - 60);
    const slope = (x) => Math.abs(surface[Math.min(W - 1, x + 6)] - surface[Math.max(0, x - 6)]) / 12;
    const aprons = [];
    for (const m of layout.mountains) for (const peak of m.peaks) {
      if (peak.kind !== 'pyramid' || peak.height < 250) continue;
      for (const side of [-1, 1]) {
        const spread = side < 0 ? peak.left : peak.right;
        // The break of slope: the first column past the middle of the flank where the ground
        // flattens out.
        let foot = -1;
        for (let k = Math.round(spread * 0.55); k < spread * 1.35; k += 2) {
          const x = Math.round(peak.x + side * k);
          if (x < 8 || x > W - 9) break;
          if (slope(x) < 0.32) { foot = x; break; }
        }
        if (foot < 0 || !wild(foot) || wet(foot)) continue;
        const up = Math.min(70, spread * 0.12), out = Math.min(200, spread * 0.26);
        const thick = Math.max(10, Math.min(34, peak.height * 0.04));
        let x0 = foot, x1 = foot;
        for (let k = -Math.round(up); k <= out; k += 1) {
          const cx = foot + side * k;
          if (cx < 2 || cx > W - 3 || !wild(cx) || wet(cx) || pocket(cx)) continue;
          const t = k < 0 ? Math.pow(1 + k / up, 1.2) : Math.pow(1 - k / out, 1.6);
          const h = Math.round(thick * t * (0.85 + 0.3 * (grain(cx) * 0.5 + 0.5)));
          if (h < 1) continue;
          const to = Math.round(surface[cx]), from = Math.max(4, to - h);
          for (let y = from; y < to && y < H - 40; y += 1) {
            const block = (PW.hash2(cx >> 2, y >> 2) & 7) === 0;
            mat[y * W + cx] = (block ? M.STONE : M.GRAVEL) | (PW.hash2(cx, y) & 3) << 6;
          }
          for (let y = to; y < to + 5 && y < H - 40; y += 1) if ((mat[y * W + cx] & 63) === M.GRASS) mat[y * W + cx] = M.TOPSOIL | (mat[y * W + cx] & 0xc0);
          surface[cx] = from; top[cx] = from;
          x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
        }
        if (x1 > x0) aprons.push({ x0, x1, foot, dir: side });
      }
    }
    return aprons;
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
    for (let i = 0, n = Math.round(240 * W / 16384); i < n; i += 1) {
      const x = random.int(60, W - 60);
      const depth = random.range(60, 900);
      const y = top[x] + depth;
      const kind = depth < 260 ? (random() < 0.6 ? M.CLAY : M.GRAVEL) : random() < 0.5 ? M.SOIL : M.CLAY;
      blob(world, x, y, random.range(14, 46), random, (px, py) => {
        // (lenses are features of the lying strata: none in the body of a massif)
        if (layout.massifBottom && py < layout.massifBottom[px]) return;
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
  // N125 (the user's, 2026-11-23): every deposit is the silhouette of a beast - a koi, a hawk, a
  // wolf, a bull or an eel - carved in the crystal and lit as a body in the round, its edges
  // broken and its sides terraced like cut stone, so that it reads as ore until it is looked at
  // closely. A beast is tapered capsules [x0, y0, r0, x1, y1, r1] on a body one long, facing +x,
  // y down, centred on the deposit; and an eye.
  const BEASTS = {
    koi: { eye: [0.3, -0.03], parts: [
      [-0.25, 0, 0.12, 0.18, 0, 0.16], [0.18, 0, 0.15, 0.36, 0.01, 0.09], [-0.25, 0, 0.11, -0.38, 0, 0.045],
      [-0.38, 0, 0.04, -0.5, -0.14, 0.06], [-0.38, 0, 0.04, -0.5, 0.13, 0.06], [-0.1, -0.13, 0.045, 0.12, -0.17, 0.025],
      [0.14, 0.1, 0.03, 0.05, 0.22, 0.045], [0.36, 0.03, 0.016, 0.45, 0.1, 0.01]] },
    hawk: { eye: [0.21, -0.03], parts: [
      [-0.14, 0.02, 0.07, 0.14, 0, 0.08], [0.14, -0.01, 0.065, 0.24, 0, 0.045], [0.24, 0, 0.03, 0.29, 0.045, 0.012],
      [-0.03, -0.04, 0.07, -0.26, -0.36, 0.035], [-0.26, -0.36, 0.035, -0.4, -0.42, 0.015],
      [0.04, -0.04, 0.065, 0.12, -0.42, 0.035], [0.12, -0.42, 0.035, 0.1, -0.5, 0.012],
      [-0.14, 0.03, 0.05, -0.36, 0.08, 0.085], [0.0, 0.08, 0.025, 0.05, 0.18, 0.015], [0.06, 0.08, 0.025, 0.12, 0.18, 0.015]] },
    wolf: { eye: [0.29, -0.11], parts: [
      [-0.24, 0, 0.1, 0.14, -0.02, 0.12], [0.14, -0.03, 0.09, 0.27, -0.1, 0.07], [0.27, -0.1, 0.05, 0.4, -0.06, 0.028],
      [0.25, -0.15, 0.03, 0.26, -0.24, 0.008], [0.21, -0.14, 0.03, 0.2, -0.22, 0.008],
      [0.12, 0.08, 0.04, 0.15, 0.3, 0.028], [0.05, 0.08, 0.04, 0.01, 0.3, 0.028],
      [-0.19, 0.06, 0.05, -0.24, 0.3, 0.028], [-0.12, 0.07, 0.04, -0.09, 0.3, 0.028], [-0.26, -0.03, 0.05, -0.46, 0.12, 0.045]] },
    bull: { eye: [0.27, 0.05], parts: [
      [-0.26, 0, 0.16, 0.12, -0.02, 0.19], [0.04, -0.13, 0.11, 0.1, -0.12, 0.1], [0.17, 0.02, 0.1, 0.32, 0.11, 0.07],
      [0.24, -0.05, 0.028, 0.36, -0.15, 0.012], [0.21, -0.05, 0.026, 0.19, -0.17, 0.01],
      [0.1, 0.12, 0.05, 0.12, 0.3, 0.04], [0.0, 0.12, 0.05, -0.02, 0.3, 0.04],
      [-0.2, 0.1, 0.06, -0.22, 0.3, 0.04], [-0.12, 0.1, 0.05, -0.1, 0.3, 0.04], [-0.3, -0.05, 0.022, -0.37, 0.17, 0.014]] },
    eel: { eye: [0.42, -0.02], parts: (() => {
      const out = [], at = (u) => [0.46 - u * 0.94, 0.11 * Math.sin(u * Math.PI * 2.6)], r = (u) => 0.055 * (1 - u * 0.8);
      for (let k = 0; k < 16; k += 1) { const a = at(k / 16), b = at((k + 1) / 16); out.push([a[0], a[1], r(k / 16), b[0], b[1], r((k + 1) / 16)]); }
      out.push([0.1, -0.06, 0.02, -0.3, -0.04, 0.012]);   // the fin along its back
      return out;
    })() },
  };
  const BEAST_KINDS = ['koi', 'hawk', 'wolf', 'bull', 'eel'];
  // The beast a deposit at (cx, cy) takes, its size by the ore the deposit was to hold (a beast
  // as big as the seam was long would hold ten times the ore): its field over its box. Drawn
  // from hashes, so the random sequence that lays the world is unchanged.
  function beastOf(world, cx, cy, length, thick, pad) {
    const h = (k) => (PW.hash2(Math.round(cx) * 7 + k, Math.round(cy) * 13 - k) & 4095) / 4095;
    const kind = BEAST_KINDS[Math.floor(h(1) * BEAST_KINDS.length) % BEAST_KINDS.length], B = BEASTS[kind];
    const L = Math.max(26, 2 * Math.sqrt(length * thick * 0.7));
    const flip = h(2) < 0.5 ? -1 : 1, rot = (h(3) - 0.5) * 1.1, c = Math.cos(rot), s = Math.sin(rot);
    const to = (u, v) => { const x = u * flip * L, y = v * L; return [cx + x * c - y * s, cy + x * s + y * c]; };
    const parts = B.parts.map(([u0, v0, r0, u1, v1, r1]) => { const a = to(u0, v0), b = to(u1, v1); return [a[0], a[1], r0 * L, b[0], b[1], r1 * L]; });
    // (veinlets run off it into the rock, as off any lode - the outline is not an animal's alone)
    const body = parts.length;
    for (let v = 0, n = 3 + Math.floor(h(9) * 4); v < n; v += 1) {
      const p = parts[Math.floor(h(10 + v) * body) % body], t = h(20 + v);
      const ax = p[0] + (p[3] - p[0]) * t, ay = p[1] + (p[4] - p[1]) * t, a = h(30 + v) * Math.PI * 2, len = L * (0.12 + h(40 + v) * 0.22);
      parts.push([ax, ay, 1.3, ax + Math.cos(a) * len, ay + Math.sin(a) * len, 0.45]);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) {
      x0 = Math.min(x0, p[0] - p[2], p[3] - p[5]); x1 = Math.max(x1, p[0] + p[2], p[3] + p[5]);
      y0 = Math.min(y0, p[1] - p[2], p[4] - p[5]); y1 = Math.max(y1, p[1] + p[2], p[4] + p[5]);
    }
    x0 = Math.max(1, Math.floor(x0) - pad); y0 = Math.max(1, Math.floor(y0) - pad);
    x1 = Math.min(world.width - 2, Math.ceil(x1) + pad); y1 = Math.min(world.height - 2, Math.ceil(y1) + pad);
    const w = x1 - x0 + 1, hgt = y1 - y0 + 1;
    const depth = new Float32Array(w * hgt).fill(-9);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const px = x + 0.5, py = y + 0.5;
      let d = -9;
      for (const [ax, ay, ra, bx, by, rb] of parts) {
        const ex = bx - ax, ey = by - ay, ll = ex * ex + ey * ey || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / ll));
        const dd = ra + (rb - ra) * t - Math.hypot(px - ax - ex * t, py - ay - ey * t);
        if (dd > d) d = dd;
      }
      // (broken, crystalline edges: the outline is chipped, never a smooth curve)
      if (d > -2 && d < 2) d += ((PW.hash2(x, y) & 7) - 3.5) * 0.16;
      depth[(y - y0) * w + (x - x0)] = d;
    }
    // Lit as a body in the round from the upper left, and grown of crystal: its skin is a mosaic
    // of facets a few cells across, each tilted its own way off the body's curve (lit, shaded, a
    // bright edge where it catches the light) - from afar a lump of ore, close up a beast in the
    // stone. A pale rim, and the eye a pale glint.
    const art = new Int8Array(w * hgt).fill(-1);
    const [ex, ey] = to(B.eye[0], B.eye[1]);
    const facet = (x, y) => {
      const fx = x + ((PW.hash2(y >> 2, 91) & 3) - 1.5), fy = y + ((PW.hash2(x >> 2, 37) & 3) - 1.5);
      return PW.hash2(Math.floor(fx / 4), Math.floor(fy / 4));
    };
    for (let y = y0 + 1; y < y1; y += 1) for (let x = x0 + 1; x < x1; x += 1) {
      const k = (y - y0) * w + (x - x0), d = depth[k];
      if (d < 0) continue;
      const gx = depth[k + 1] - depth[k - 1], gy = depth[k + w] - depth[k - w], g = Math.hypot(gx, gy);
      const f = facet(x, y), tilt = ((f & 7) - 3.5) * 0.16;
      const lit = (g > 0.05 ? (gx + gy) * Math.SQRT1_2 / g : 0) * Math.min(1, g) + tilt;
      const edge = facet(x - 1, y) !== f || facet(x, y - 1) !== f;
      art[k] = d < 0.9 ? 0
        : Math.hypot(x + 0.5 - ex, y + 0.5 - ey) < Math.max(0.8, L * 0.012) ? 0
          : edge ? (lit > 0.15 ? 3 : 2)
            : lit > 0.1 ? 1 : 2;
    }
    return { kind, box: { x0, y0, x1, y1 }, w, h: hgt, depth, art, L };
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
    let w = x1 - x0 + 1, h = y1 - y0 + 1;
    let depth = new Float32Array(w * h).fill(-9);
    const width = new Float32Array(w * h);   // half-width of the part each cell belongs to
    let near = new Int32Array(w * h).fill(-1);   // the seam point a cell belongs to
    // Variant decided by a part's own crystal geometry (-1: by comb texture; HOLLOW: open space).
    const HOLLOW = -2;
    let art = new Int8Array(w * h).fill(-1);
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
    let rubble = clasts.length ? new Float32Array(w * h).fill(-9) : null;
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
    // N125: the body laid is a beast's (the form above has spent its draws, so all round it the
    // world is laid as it always was); its geodes and rock fragments go with the form
    let beast = PW.ORE_BEASTS === false ? null : beastOf(world, cx, cy, length, thick, pad);
    if (beast) {
      // (a beast that would lie mostly in a cave's air keeps the form it was drawn as)
      let n = 0;
      const bx = beast.box;
      for (let y = bx.y0; y <= bx.y1 && n < MIN_ORE; y += 1) for (let x = bx.x0; x <= bx.x1; x += 1) {
        const k = (y - bx.y0) * beast.w + (x - bx.x0), id = mat[y * W + x] & 63;
        if (beast.depth[k] >= 0 && id !== M.BEDROCK && id !== M.AIR && id !== M.WATER) n += 1;
      }
      if (n < MIN_ORE) beast = null;
    }
    if (beast) {
      ({ x0, y0, x1, y1 } = beast.box);
      w = beast.w; h = beast.h; depth = beast.depth; art = beast.art;
      near = new Int32Array(w * h).fill(-1); rubble = null; geodes.length = 0;
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
    const seamLike = !beast && (form === 'seam' || form === 'lens');
    return { x: Math.round(cx), y: Math.round(cy), radius: seamLike ? Math.round(thick / 2) : Math.round(Math.max(x1 - x0, y1 - y0) / 2 - pad),
      length: Math.round(beast ? beast.L : length), angle, form: beast ? beast.kind : form, shape: form, beast: !!beast,
      tier: spec.tier, amount: cells, geodes: geodes.length, box: { x0, y0, x1, y1 } };
  }

  function placeOreNodes(world, layout, top, random) {
    const W = world.width;
    const nodes = [];
    const tooClose = (x, y, gap) => nodes.some((n) => Math.hypot(n.x - x, n.y - y) < gap);
    // Starter veins below each base core: a solid vein the starter workings reach.
    for (const site of [layout.sites[0], layout.sites[layout.sites.length - 1]]) {
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
      // (as many to the column as on the first, narrower map)
      const count = Math.round(spec.count * W / 16384);
      for (let attempt = 0; placed < count && attempt < 4000; attempt += 1) {
        const x = random.range(200, W - 200);
        const y = top[Math.round(x)] + random.range(spec.depth[0], spec.depth[1]);
        if (y > world.height - 90 || tooClose(x, y, spec.spacing)) continue;
        const node = oreVein(world, x, y, spec, random);
        if (!node) continue;
        nodes.push(node);
        placed += 1;
      }
    }
    for (const node of nodes) oreTendrils(world, node);
    return nodes;
  }
  // The dead god machine's shadow tendrils grip every deposit: a few black wisps curling in over
  // the host rock towards the ore, a white glint where one catches the light. Painted on the rock
  // round the vein, never on the crystal itself; drawn from hashes, so the random sequence that
  // lays the world is unchanged.
  function oreTendrils(world, node) {
    const { mat, width: W, height: H } = world;
    const INK = PW.abgr(10, 10, 12), GLINT = PW.abgr(152, 158, 164);
    const h = (k) => (PW.hash2(node.x, node.y ^ (k * 0x9e37)) & 1023) / 1023;
    const strands = 2 + (PW.hash2(node.x, node.y) & 1);
    const R = Math.max(8, node.radius * 0.9 + 3);
    for (let s = 0; s < strands; s += 1) {
      const a0 = h(s * 3 + 1) * Math.PI * 2, turn = 0.3 + h(s * 3 + 2) * 0.18;
      const len = 9 + Math.round(h(s * 3 + 3) * 9);
      for (let t = 0; t <= len; t += 0.2) {
        const r = R * (1 - t / len * 0.5) * (1 + 0.18 * Math.sin(t * 1.7 + s * 2.4)), a = a0 + t * turn;
        const x = Math.round(node.x + Math.cos(a) * r), y = Math.round(node.y + Math.sin(a) * r * 0.8);
        if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
        for (const dx of [0, 1]) {
          const id = mat[y * W + x + dx] & 63;
          if (id === M.ORE || id === M.AIR || id === M.WATER || id === M.BEDROCK) continue;
          PW.setLayer(world, 'paint', x + dx, y, Math.round(t) % 9 === 4 && !dx ? GLINT : INK);
        }
      }
    }
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
    for (let i = 0, n = Math.round(16 * W / 16384); i < n; i += 1) {
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
    // Stage timings, for the performance pass (step L).
    const times = world.genTimings = {};
    let t0 = performance.now();
    const mark = (name) => { const t1 = performance.now(); times[name] = Math.round(t1 - t0); t0 = t1; };
    const layout = planLayout(world, random, seed);
    const surface = surfaceProfile(world, layout, seed);
    mark('profile');
    world.soil = soilProvinces(world, seed, layout);
    const top = fillStrata(world, layout, surface, seed);
    mark('strata');
    layout.scree = scree(world, layout, surface, top, seed);
    layout.talus = talus(world, layout, surface, top, seed);
    gradeCut(world, layout, surface, top);
    addLenses(world, layout, top, random);
    mark('scree');
    // Caves first: veins then run through the rock around them and show in the cave walls.
    layout.caves = carveCaves(world, layout, top, random);
    mark('caves');
    layout.nodes = placeOreNodes(world, layout, top, random);
    mark('ore');
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
    world.massifBottom = layout.massifBottom;
    world.layout = layout;
    PW.rebuildGroundTop(world);
    return layout;
  }

  PW.generateTerrain = generateTerrain;
  PW.terrainBlob = blob;
  // A stringer vein of ore at (x, y), for workings that found none within reach.
  PW.oreStringer = (world, x, y, random) => oreVein(world, x, y, ORE_TIERS[0], random);
})();
