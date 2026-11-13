'use strict';
// Cover props: boulders, stalagmites and stalactites in caves; steel drums, kegs, crates, mine
// cars on rails, gas cylinders, timber cribs and sandbag walls in mine workings and at base
// defences. They are real cells (COVER_* materials with their own paint): units walk past them,
// shots stop in them (a crouched trooper, 9 cells tall, hides behind anything 11+ cells high),
// water flows around them and blasts break them. Sizes follow the real objects at ~7 cm a cell.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, breaksTo } = PW.mat;
  const rgb = (c) => PW.abgr(Math.max(0, Math.min(255, c[0])) | 0, Math.max(0, Math.min(255, c[1])) | 0, Math.max(0, Math.min(255, c[2])) | 0);
  const tone = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const COVER = new Uint8Array(64);
  COVER[M.COVER_ROCK] = COVER[M.COVER_WOOD] = COVER[M.COVER_METAL] = COVER[M.COVER_SAND] = 1;

  // ---- Prop sprites ------------------------------------------------------------------------------
  // A prop holds a material and a colour per cell. Its anchor is the support cell under its centre
  // (the floor it stands on, or the ceiling a stalactite hangs from).
  function createProp(width, height) {
    return { width, height, mats: new Uint8Array(width * height), colors: new Uint32Array(width * height),
      anchorX: width >> 1, anchorY: height, hangs: false, conform: false };
  }
  function cell(p, x, y, mat, color) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
    p.mats[y * p.width + x] = mat;
    p.colors[y * p.width + x] = Array.isArray(color) ? rgb(color) : color;
  }
  // Stack several props into one (offsets are from the bottom-left of the combined box).
  function compose(parts, width, height) {
    const out = createProp(width, height);
    for (const { prop, x, y } of parts) {
      for (let py = 0; py < prop.height; py += 1) for (let px = 0; px < prop.width; px += 1) {
        const i = py * prop.width + px;
        if (!prop.mats[i]) continue;
        cell(out, x + px, height - y - prop.height + py, prop.mats[i], prop.colors[i]);
      }
    }
    return out;
  }
  const speck = (x, y, seed, mask = 15) => (PW.hash3(x, y, seed) & mask) === 0;

  // Steel drum, 0.9 x 0.56 m: rolled hoops, lid rim, cylinder shading and rust.
  const DRUMS = [[150, 58, 40], [92, 100, 58], [52, 84, 128], [196, 158, 44], [118, 122, 126]];
  function drum(random) {
    const p = createProp(8, 13);
    const base = random.pick(DRUMS);
    const seed = random.int(1, 1e9);
    const across = [0.7, 0.9, 1.08, 1.18, 1.1, 0.98, 0.86, 0.68];
    for (let y = 0; y < 13; y += 1) for (let x = 0; x < 8; x += 1) {
      let k = across[x];
      if (y === 0) k *= 1.25; else if (y === 1) k *= 0.7; else if (y === 4 || y === 8) k *= 1.2;
      else if (y === 5 || y === 9) k *= 0.8; else if (y === 12) k *= 0.62;
      let c = tone(base, k);
      if (speck(x, y, seed, 7)) c = mix(c, [104, 58, 30], 0.55);
      if (base === DRUMS[3] && (y === 6 || y === 7) && x > 1 && x < 6) c = (x + y) & 1 ? [40, 38, 36] : tone(base, k);
      cell(p, x, y, M.COVER_METAL, c);
    }
    return p;
  }
  // Wooden keg, 0.84 x 0.63 m at the bulge: staves and four iron hoops.
  function keg(random) {
    const widths = [7, 8, 9, 9, 9, 9, 9, 9, 9, 9, 8, 7];
    const p = createProp(9, 12);
    const seed = random.int(1, 1e9);
    for (let y = 0; y < 12; y += 1) {
      const w = widths[y], x0 = (9 - w) >> 1;
      for (let x = x0; x < x0 + w; x += 1) {
        const u = (x - 4) / 4.5;
        let c = (x & 1) ? [138, 96, 58] : [124, 86, 52];
        c = tone(c, u < -0.4 ? 1.12 : u > 0.45 ? 0.74 : 1);
        if (y === 1 || y === 4 || y === 7 || y === 10) c = tone([62, 58, 54], u < -0.4 ? 1.3 : 1);
        if (speck(x, y, seed)) c = tone(c, 0.82);
        cell(p, x, y, M.COVER_WOOD, c);
      }
    }
    return p;
  }
  // Wooden crate, 0.77 m: frame, planks, a diagonal brace and nail heads.
  function crate(random, size = 11) {
    const p = createProp(size, size);
    const seed = random.int(1, 1e9);
    const wood = [146, 108, 68], frame = [104, 74, 46];
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const edge = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      const brace = Math.abs((size - 1 - y) - x) <= 1;
      let c = edge || brace ? frame : (y % 3 === 0 ? tone(wood, 0.84) : wood);
      if (!edge && !brace && speck(x, y, seed, 31)) c = tone(c, 0.9);
      if (x === 0 || y === 0) c = tone(c, 1.15);
      if ((x === 1 || x === size - 2) && (y === 1 || y === size - 2)) c = [168, 168, 164];
      cell(p, x, y, M.COVER_WOOD, c);
    }
    return p;
  }
  // Ammunition box, 1.0 x 0.5 m, olive with a latch and stencil marks.
  function ammoBox(random) {
    const p = createProp(14, 7);
    const seed = random.int(1, 1e9);
    for (let y = 0; y < 7; y += 1) for (let x = 0; x < 14; x += 1) {
      let c = [86, 96, 58];
      if (y === 0) c = [108, 118, 74]; else if (y === 6 || x === 0 || x === 13) c = [62, 70, 42];
      if (y === 2 && x > 2 && x < 11 && (x % 2 === 1)) c = [190, 188, 156];
      if ((x === 3 || x === 10) && y === 1) c = [150, 150, 146];
      if (speck(x, y, seed, 31)) c = tone(c, 0.88);
      cell(p, x, y, M.COVER_METAL, c);
    }
    return p;
  }
  function crateStack(random) {
    const kind = random.int(0, 2);
    if (kind === 0) return compose([{ prop: crate(random), x: 0, y: 0 }, { prop: crate(random), x: 11, y: 0 }, { prop: crate(random), x: 5, y: 11 }], 22, 22);
    if (kind === 1) return compose([{ prop: crate(random, 13), x: 0, y: 0 }, { prop: ammoBox(random), x: 0, y: 13 }], 14, 20);
    return compose([{ prop: crate(random), x: 0, y: 0 }, { prop: ammoBox(random), x: 12, y: 0 }, { prop: ammoBox(random), x: 12, y: 7 }], 26, 14);
  }
  function drumPair(random) {
    return random() < 0.5 ? compose([{ prop: drum(random), x: 0, y: 0 }, { prop: drum(random), x: 9, y: 0 }], 17, 13)
      : compose([{ prop: keg(random), x: 0, y: 0 }, { prop: drum(random), x: 10, y: 0 }], 18, 13);
  }

  // Mine car on its own length of rail, 1.7 m long and 1.4 m over the rail with its ore load.
  function mineCar(random, loaded = true) {
    const W = 24, H = 20;
    const p = createProp(W, H);
    const seed = random.int(1, 1e9);
    const row = (b) => H - 1 - b;   // b = rows above the floor
    for (let x = 0; x < W; x += 1) {
      cell(p, x, row(0), M.COVER_METAL, (x % 9) < 5 ? [86, 64, 40] : [60, 58, 56]);   // sleeper and rail foot
      cell(p, x, row(1), M.COVER_METAL, [150, 152, 156]);                              // rail head
    }
    const WHEEL = ['.XXX.', 'XXXXX', 'XXOXX', 'XXXXX', '.XXX.'];
    for (const cx of [5, 18]) {
      for (let r = 0; r < 5; r += 1) for (let k = 0; k < 5; k += 1) {
        const ch = WHEEL[r][k];
        if (ch === '.') continue;
        const lit = r < 2 && k < 3;
        cell(p, cx - 2 + k, row(6 - r), M.COVER_METAL, ch === 'O' ? [140, 140, 146] : lit ? [92, 90, 90] : [46, 44, 44]);
      }
    }
    for (let x = 1; x < W - 1; x += 1) {
      cell(p, x, row(7), M.COVER_METAL, [96, 84, 72]);
      cell(p, x, row(6), M.COVER_METAL, x === 5 || x === 18 ? [140, 140, 146] : [74, 64, 56]);
    }
    const rust = [128, 78, 50];
    for (let b = 8; b <= 16; b += 1) {
      const half = 10 + (b - 8) * 2 / 8;
      const x0 = Math.round(11.5 - half), x1 = Math.round(11.5 + half);
      for (let x = x0; x <= x1; x += 1) {
        const u = (x - 11.5) / half;
        let c = tone(rust, u < -0.5 ? 1.16 : u > 0.55 ? 0.76 : 1);
        if (x === 6 || x === 12 || x === 17) c = tone(rust, 0.74);
        if (b === 16) c = [164, 108, 72];
        if ((b === 10 || b === 14) && (x === 5 || x === 7 || x === 11 || x === 13 || x === 16 || x === 18)) c = [176, 150, 120];
        if (speck(x, b, seed, 7)) c = mix(c, [86, 48, 28], 0.5);
        cell(p, x, row(b), M.COVER_METAL, c);
      }
    }
    if (loaded) {
      const ore = [[192, 107, 252], [155, 86, 203], [127, 71, 167], [112, 104, 94], [90, 84, 76]];
      for (let b = 17; b <= 19; b += 1) {
        const half = [10, 8, 5][b - 17];
        for (let x = Math.round(11.5 - half); x <= Math.round(11.5 + half); x += 1) {
          if (b > 17 && (PW.hash3(x, b, seed) & 3) === 0 && Math.abs(x - 11.5) > half - 1.5) continue;
          cell(p, x, row(b), M.COVER_ROCK, ore[PW.hash3(x, b, seed + 1) % ore.length]);
        }
      }
    }
    return p;
  }
  // Rack of three gas cylinders, 1.26 m tall.
  function gasRack(random) {
    const p = createProp(16, 18);
    const colors = [[58, 108, 70], [146, 44, 40], [86, 88, 92]];
    for (let k = 0; k < 3; k += 1) {
      const c0 = colors[(k + random.int(0, 2)) % 3], x0 = 1 + k * 5;
      for (let y = 0; y < 17; y += 1) for (let x = 0; x < 4; x += 1) {
        if (y < 2 && (x === 0 || x === 3)) continue;
        let c = tone(c0, x === 0 ? 1.18 : x === 3 ? 0.72 : 1);
        if (y < 2) c = [150, 150, 154];
        cell(p, x0 + x, y, M.COVER_METAL, c);
      }
    }
    for (let x = 0; x < 16; x += 1) { cell(p, x, 6, M.COVER_METAL, [70, 66, 60]); cell(p, x, 17, M.COVER_METAL, [70, 66, 60]); }
    return p;
  }
  // Timber crib: courses of sleepers and log ends, 1.0 m.
  function timberCrib(random) {
    const p = createProp(18, 14);
    const seed = random.int(1, 1e9);
    for (let course = 0; course < 4; course += 1) {
      const y0 = 14 - (course + 1) * 3.5;
      if (course % 2 === 0) {
        for (let y = Math.round(y0); y < Math.round(y0 + 3.5); y += 1) for (let x = 0; x < 18; x += 1) {
          const c = y === Math.round(y0) ? [140, 104, 66] : speck(x, y, seed, 7) ? [96, 70, 44] : [120, 88, 56];
          cell(p, x, y, M.COVER_WOOD, c);
        }
      } else {
        for (const cx of [2, 15]) for (let y = Math.round(y0); y < Math.round(y0 + 3.5); y += 1) for (let x = cx - 2; x <= cx + 1; x += 1) {
          const ring = Math.abs(x - cx + 0.5) < 1 && Math.abs(y - y0 - 1.5) < 1;
          cell(p, x, y, M.COVER_WOOD, ring ? [104, 74, 46] : [150, 116, 76]);
        }
      }
    }
    return p;
  }
  // Sandbag wall: staggered courses of filled bags (0.7 x 0.28 m), flat on the ground.
  function sandbags(random, bags = 4, courses = 3) {
    const W = bags * 10 + 5, H = courses * 4;
    const p = createProp(W, H);
    const seed = random.int(1, 1e9);
    for (let course = 0; course < courses; course += 1) {
      const offset = course % 2 ? 5 : 0;
      const y0 = H - (course + 1) * 4;
      const count = bags - (course % 2 && course === courses - 1 ? 1 : 0);
      for (let b = 0; b < count; b += 1) {
        const x0 = offset + b * 10;
        for (let y = 0; y < 4; y += 1) for (let x = 0; x < 10; x += 1) {
          if (y === 0 && (x === 0 || x === 9)) continue;   // rounded upper corners
          let c = y === 0 ? [196, 178, 130] : y === 3 ? [150, 134, 94] : [176, 158, 112];
          if (x === 0 || x === 9) c = [140, 124, 88];
          if (speck(x0 + x, y0 + y, seed, 15)) c = tone(c, 0.9);
          cell(p, x0 + x, y0 + y, M.COVER_SAND, c);
        }
      }
    }
    // Fill the half-bag notches at the ends of the bottom course so the wall stands flat.
    for (let y = H - 4; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      if (!p.mats[y * W + x]) cell(p, x, y, M.COVER_SAND, y === H - 4 ? [196, 178, 130] : [168, 150, 106]);
    }
    return p;
  }

  // ---- Natural cover: shaped by the floor (or ceiling) it grows from -----------------------------------
  // ground(dx): row of the supporting surface at column dx relative to the anchor (positive = lower).
  const CAVE_ROCK = [[118, 110, 98], [96, 90, 81], [78, 73, 66], [58, 54, 50]];
  // Boulders are solid rock (they stop shots); the shape comes from the vegetation boulder, which
  // settles into the slope it lies on.
  function rockProp(random, size, ground, look) {
    const sprite = PW.vegetation.boulder(random, size, ground, look);
    const p = createProp(sprite.width, sprite.height);
    for (let i = 0; i < sprite.pixels.length; i += 1) if (sprite.pixels[i]) { p.mats[i] = M.COVER_ROCK; p.colors[i] = sprite.pixels[i]; }
    p.anchorX = sprite.anchorX; p.anchorY = sprite.anchorY; p.conform = true;
    return p;
  }
  const caveBoulder = (random, size, ground) => rockProp(random, size, ground, { moss: false, dark: 0.82, palette: CAVE_ROCK });
  const surfaceBoulder = (random, size, ground) => rockProp(random, size, ground, {});
  const CALCITE = [[156, 142, 120], [140, 126, 104], [124, 110, 92]];
  // Stalagmite: a vertical cone with growth bands whose foot spreads over the cave floor.
  function stalagmite(random, height, ground) {
    const half = Math.max(3, Math.round(height * random.range(0.18, 0.28)));
    let drop = 0, rise = 0;
    for (let dx = -half; dx <= half; dx += 1) { drop = Math.max(drop, ground(dx)); rise = Math.max(rise, -ground(dx)); }
    const p = createProp(half * 2 + 3, height + drop + rise + 4);
    p.anchorX = half + 1; p.anchorY = p.height - 2 - drop; p.conform = true;
    const seed = random.int(1, 1e9);
    const k = random.range(0.62, 0.78);   // dim cave light
    const tip = p.anchorY - height;
    for (let dx = -half; dx <= half; dx += 1) {
      const t = Math.abs(dx) / half;
      const side = Math.round(tip + height * Math.pow(t, 0.85) + (PW.hash3(dx, 0, seed) & 1));
      const floor = p.anchorY + ground(dx);
      for (let y = side; y <= floor; y += 1) {
        const band = CALCITE[(((y + (seed & 7)) / 3) | 0) % 3];
        let c = tone(band, dx < 0 ? 1.12 : dx > half * 0.4 ? 0.78 : 1);
        if (dx === -1 && y < floor - 2 && (y & 3) !== 0) c = [190, 180, 160];   // wet streak on the lit side
        if (y > p.anchorY) c = tone(band, 0.8);
        cell(p, p.anchorX + dx, y, M.COVER_ROCK, tone(c, k));
      }
    }
    return p;
  }
  // Stalactite: an inverted cone hanging from the ceiling, its root following the rock above.
  // ceiling(dx): row of the ceiling rock at column dx relative to the anchor (negative = higher).
  function stalactite(random, length, ceiling) {
    const half = Math.max(2, Math.round(length * random.range(0.16, 0.24)));
    let up = 0, down = 0;
    for (let dx = -half; dx <= half; dx += 1) { up = Math.max(up, -ceiling(dx)); down = Math.max(down, ceiling(dx)); }
    const p = createProp(half * 2 + 3, length + up + down + 4);
    p.anchorX = half + 1; p.anchorY = up + 2; p.hangs = true; p.conform = true;
    const seed = random.int(1, 1e9);
    const k = random.range(0.6, 0.74);
    const tip = p.anchorY + length;
    for (let dx = -half; dx <= half; dx += 1) {
      const t = Math.abs(dx) / half;
      const side = Math.round(tip - length * Math.pow(t, 0.8));
      const roof = p.anchorY + ceiling(dx);
      for (let y = roof; y <= side; y += 1) {
        const band = CALCITE[(((y + (seed & 7)) / 3) | 0) % 3];
        let c = tone(band, dx < 0 ? 1.1 : dx > half * 0.4 ? 0.76 : 1);
        if (y === side && dx === 0) c = [170, 196, 214];   // drip at the tip
        cell(p, p.anchorX + dx, y, M.COVER_ROCK, tone(c, k));
      }
    }
    return p;
  }

  // ---- Placement -----------------------------------------------------------------------------------------
  // Put a prop into the world with its anchor on support cell (x, row). Rigid props need open air
  // for every cell; shaped props (conform) skip cells that fall inside rock. Returns the record or
  // null if it does not fit (overlaps a structure, water, another prop...).
  function place(world, prop, x, row, info = {}) {
    const { mat, width: W, height: H } = world;
    const left = Math.round(x - prop.anchorX), top = Math.round(row - prop.anchorY);
    const cells = [];
    for (let py = 0; py < prop.height; py += 1) {
      const wy = top + py;
      for (let px = 0; px < prop.width; px += 1) {
        const i = py * prop.width + px;
        if (!prop.mats[i]) continue;
        const wx = left + px;
        if (wx < 1 || wy < 1 || wx >= W - 1 || wy >= H - 1) return null;
        const id = mat[wy * W + wx] & ID_MASK;
        if (id === M.AIR) { cells.push(wy * W + wx, i); continue; }
        if (prop.conform && phase[id] >= PW.PHASE.POWDER && !COVER[id] && !PW.mat.structural[id]) continue;
        return null;
      }
    }
    if (!cells.length) return null;
    const flat = new Int32Array(cells.length / 2);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const lowest = new Map(), highest = new Map();
    for (let k = 0; k < cells.length; k += 2) {
      const index = cells[k], i = cells[k + 1];
      const wx = index % W, wy = (index / W) | 0;
      PW.set(world, wx, wy, prop.mats[i], { quiet: true });
      PW.setLayer(world, 'paint', wx, wy, prop.colors[i]);
      PW.setLayer(world, 'deco', wx, wy, 0);   // nothing drawn over the prop
      PW.setOwner(world, wx, wy, 0);
      flat[k / 2] = index;
      if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
      if (!lowest.has(wx) || wy > lowest.get(wx)) lowest.set(wx, wy);
      if (!highest.has(wx) || wy < highest.get(wx)) highest.set(wx, wy);
    }
    // What it rests on: the cell under each column's lowest cell (or above the highest, hanging).
    // A shaped prop reaches the ground in every column; a rigid one stands on its bottom row
    // (a keg's bulge or a mine car's tub overhang belong to the object's own shape).
    const support = [];
    for (const [wx, wy] of prop.hangs ? highest : lowest) {
      if (!prop.conform && !prop.hangs && wy !== y1) continue;
      const sy = prop.hangs ? wy - 1 : wy + 1;
      const id = mat[sy * W + wx] & ID_MASK;
      if (!COVER[id]) support.push(sy * W + wx);
    }
    const record = { id: (world.props || (world.props = [])).length + 1, kind: info.kind || 'prop', setting: info.setting || null,
      x0, y0, x1, y1, cells: flat, support: Int32Array.from(support), hangs: prop.hangs, anchorX: x, row };
    world.props.push(record);
    return record;
  }

  // Ground or ceiling profile around (x, row) for shaped props: scans from `from` down (or up).
  function floorProfile(world, x, row, from) {
    const cache = new Map();
    return (dx) => {
      dx = Math.round(dx);
      if (!cache.has(dx)) cache.set(dx, PW.supportBelow(world, x + dx, from) - row);
      return cache.get(dx);
    };
  }
  function ceilingAbove(world, x, from) {
    const { mat, width: W } = world;
    for (let y = Math.round(from); y > 0; y -= 1) if (phase[mat[y * W + x] & ID_MASK] >= PW.PHASE.POWDER) return y;
    return 0;
  }
  function ceilingProfile(world, x, row, from) {
    const cache = new Map();
    return (dx) => {
      dx = Math.round(dx);
      if (!cache.has(dx)) cache.set(dx, ceilingAbove(world, x + dx, from) - row);
      return cache.get(dx);
    };
  }

  // ---- Furnishing tunnels ----------------------------------------------------------------------------------
  const RAIL = { head: [150, 152, 156], sleeper: [86, 64, 40], foot: [60, 58, 56] };
  // Rails on the floor of a drift (behind units): rail head, rail foot and sleepers.
  function layRails(world, x0, x1, floorAir) {
    for (let x = x0; x <= x1; x += 1) {
      PW.setLayer(world, 'back', x, floorAir, rgb((x % 9) < 5 ? RAIL.sleeper : RAIL.foot));
      PW.setLayer(world, 'back', x, floorAir - 1, rgb(RAIL.head));
    }
  }
  const MINE_KINDS = ['mineCar', 'drums', 'crates', 'sandbags', 'crib', 'gas', 'drums', 'crates'];
  function makeMineProp(kind, random) {
    switch (kind) {
      case 'mineCar': return mineCar(random, random() < 0.75);
      case 'drums': return drumPair(random);
      case 'crates': return crateStack(random);
      case 'sandbags': return sandbags(random, 3, 3);
      case 'crib': return timberCrib(random);
      case 'gas': return gasRack(random);
      default: return drum(random);
    }
  }
  // Cover along a drift every 40-80 cells (clear of the shaft foot and the working face), and
  // stores in the storage room. Returns the placed records.
  function furnishMine(world, workings, random) {
    const placed = [];
    const { drift, storage, shaft } = workings;
    if (!drift) return placed;
    const floorRow = drift.bottom + 1;
    const x0 = Math.ceil(drift.x0), x1 = Math.floor(drift.x1);
    const face = workings.node ? (workings.node.x > shaft.x ? x1 : x0) : null;
    layRails(world, x0, x1, drift.bottom);
    // The usable stretch: away from the ladder at the shaft foot and the working face.
    const towardFace = face === null ? 1 : Math.sign(face - shaft.x) || 1;
    const near = Math.round(shaft.x + towardFace * 32);
    const far = face === null ? (towardFace > 0 ? x1 - 8 : x0 + 8) : face - towardFace * 30;
    let cursor = near, k = random.int(0, MINE_KINDS.length - 1);
    for (let guard = 0; guard < 40 && (far - cursor) * towardFace > 0; guard += 1) {
      let kind = MINE_KINDS[k % MINE_KINDS.length];
      let prop = makeMineProp(kind, random);
      if (prop.width > (far - cursor) * towardFace) { kind = 'drum'; prop = drum(random); }
      if (prop.width > (far - cursor) * towardFace) break;
      const left = towardFace > 0 ? cursor : cursor - prop.width + 1;
      const record = place(world, prop, left + prop.anchorX, floorRow, { kind, setting: 'mine' });
      if (record) placed.push(record);
      cursor += towardFace * (prop.width + random.int(30, 70));
      k += 1;
    }
    if (storage) {
      const floor = storage.bottom + 1;
      const kinds = ['crates', 'drums', 'gas', 'crates', 'mineCar', 'drums'];
      let sx = storage.x0 + 14;
      for (const kind of kinds) {
        const prop = makeMineProp(kind, random);
        const cx = sx + prop.anchorX;
        if (sx + prop.width > storage.x1 - 8) break;
        if (Math.abs(cx - shaft.x) > 30 + prop.width / 2) {
          const record = place(world, prop, cx, floor, { kind, setting: 'storage' });
          if (record) placed.push(record);
        }
        sx += prop.width + random.int(10, 26);
      }
    }
    return placed;
  }

  // Stalagmites, stalactites and fallen boulders along natural caves.
  function decorateCaves(world, layout, random) {
    const placed = [];
    const { mat, width: W } = world;
    for (const cave of layout.caves || []) {
      let travelled = 0, nextAt = random.int(20, 60);
      for (let n = 1; n < cave.points.length; n += 1) {
        const a = cave.points[n - 1], p = cave.points[n];
        travelled += Math.hypot(p.x - a.x, p.y - a.y);
        if (travelled < nextAt) continue;
        const x = Math.round(p.x), y = Math.round(p.y);
        if ((mat[y * W + x] & ID_MASK) !== M.AIR) continue;
        const floor = PW.supportBelow(world, x, y);
        const roof = ceilingAbove(world, x, y);
        const clearance = floor - roof - 1;
        if (clearance < 22) continue;
        nextAt = travelled + random.int(35, 85);
        const roll = random();
        if (roll < 0.5) {
          const height = Math.round(random.range(10, Math.min(34, clearance * 0.6)));
          const record = place(world, stalagmite(random, height, floorProfile(world, x, floor, y)), x, floor, { kind: 'stalagmite', setting: 'cave' });
          if (record) placed.push(record);
        } else if (roll < 0.8) {
          const size = random.range(10, Math.min(22, clearance * 0.5));
          const record = place(world, caveBoulder(random, size, floorProfile(world, x, floor, y)), x, floor, { kind: 'boulder', setting: 'cave' });
          if (record) placed.push(record);
        }
        if (random() < 0.55) {
          const sx = x + random.int(-14, 14);
          if ((mat[y * W + sx] & ID_MASK) !== M.AIR) continue;
          const sroof = ceilingAbove(world, sx, y);
          const length = Math.round(random.range(6, Math.min(26, clearance * 0.32)));
          const record = place(world, stalactite(random, length, ceilingProfile(world, sx, sroof, y)), sx, sroof, { kind: 'stalactite', setting: 'cave' });
          if (record) placed.push(record);
        }
      }
    }
    return placed;
  }

  // ---- Damage ------------------------------------------------------------------------------------------------
  // Break a prop: every cell it still has is thrown out as its rubble (splinters, scrap, stones, sand).
  function shatter(world, particles, record) {
    const { mat, width: W } = world;
    const F = PW.PARTICLE;
    for (const index of record.cells) {
      const id = mat[index] & ID_MASK;
      if (!COVER[id]) continue;
      const x = index % W, y = (index / W) | 0;
      const paint = PW.getLayer(world, 'paint', x, y);
      PW.set(world, x, y, M.AIR);
      if (particles && F && (PW.hash2(x, y) & 1) === 0) {
        const r1 = (PW.hash3(x, y, 3) & 255) / 255 - 0.5, r2 = (PW.hash3(x, y, 5) & 255) / 255;
        particles.spawn(x + 0.5, y + 0.5, r1 * 70, -15 - r2 * 45, breaksTo[id] || M.DEBRIS, paint, F.LAND, 6);
      }
    }
    record.broken = true;
  }
  // After a blast: props that lost much of themselves or what holds them up break apart.
  function afterBlast(world, particles, box) {
    if (!world.props) return 0;
    const { mat } = world;
    let broken = 0;
    for (const record of world.props) {
      if (record.broken || record.x0 > box.x1 || record.x1 < box.x0 || record.y0 > box.y1 || record.y1 < box.y0) continue;
      let alive = 0;
      for (const index of record.cells) if (COVER[mat[index] & ID_MASK]) alive += 1;
      let held = 0;
      for (const index of record.support) if (phase[mat[index] & ID_MASK] >= PW.PHASE.POWDER) held += 1;
      const supported = !record.support.length || held / record.support.length >= 0.6;
      if (alive < record.cells.length * 0.7 || !supported) { shatter(world, particles, record); broken += 1; }
    }
    if (broken) world.props = world.props.filter((record) => !record.broken);
    return broken;
  }

  PW.props = {
    createProp, compose, place, drum, keg, crate, ammoBox, crateStack, drumPair, mineCar, gasRack, timberCrib, sandbags,
    caveBoulder, surfaceBoulder, stalagmite, stalactite, floorProfile, ceilingProfile, ceilingAbove, layRails, furnishMine, decorateCaves,
    shatter, afterBlast, COVER,
  };
})();
