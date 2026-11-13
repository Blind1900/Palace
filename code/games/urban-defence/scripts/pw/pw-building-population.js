'use strict';
// Population towers at native scale: storeys, walls, slabs, switchback stairs, doors, side and back
// windows, furniture, ceiling lamps, guard slots, the top-floor control panel and buried cores.
(function () {
  const PW = window.PW;
  const { M } = PW;
  const K = PW.buildingKit;
  const { S, STYLES, ROLE, tone, mix } = K;

  const POPULATION_VARIANTS = ['slab', 'setback', 'offset', 'tapered', 'crown', 'spire', 'needle'];
  const stepValue = (pairs, t) => { let v = 0; for (const [at, value] of pairs) if (t >= at) v = value; return v; };
  function insetFor(variant, t, maxIn) {
    if (variant === 'setback') return Math.round(maxIn * stepValue([[0.45, 0.3], [0.68, 0.6], [0.86, 0.85]], t));
    if (variant === 'tapered') return Math.round(maxIn * 0.75 * t);
    if (variant === 'crown') return Math.round(maxIn * stepValue([[0.8, 0.25], [0.87, 0.5], [0.93, 0.8]], t));
    if (variant === 'spire') return t < 0.68 ? 0 : t < 0.8 ? Math.round(maxIn * 0.3) : Math.round(maxIn * (0.3 + 0.7 * (t - 0.8) / 0.2));
    if (variant === 'needle') return t <= 0.1 ? 0 : Math.round(maxIn * Math.pow((t - 0.1) / 0.9, 1.6));
    return 0;
  }
  // Same storey count rule as the lab: towers are 15-20 trooper heights tall (levels 1-7).
  function populationStoreys(level) {
    return Math.max(6, Math.min(13, Math.floor(S.TROOPER * (15 + 5 * (level - 1) / 6) / S.FLOOR)));
  }
  function populationCores(level) { return Math.min(5, 2 + Math.floor((level - 1) / 2)); }

  const BAND = S.STAIR_RUN + 2 * S.LANDING;          // stair band width
  const INTERIOR_MIN = BAND + 40;                    // room beside the stairs

  function populationTower(options) {
    const style = options.style, level = options.level || 3, variant = options.variant || 'slab';
    const seed = options.seed || 1;
    const random = PW.createRandom(seed);
    const P = STYLES[style];
    const storeys = populationStoreys(level);
    const soldiers = 2 + Math.floor(level / 2);
    const interior = Math.max(INTERIOR_MIN, soldiers * S.SLOT + BAND * 0.6 | 0);
    const extra = { slab: 0, crown: 0, setback: 30, tapered: 30, spire: 30, needle: 30, offset: 56 }[variant] || 0;
    const bodyWidth = interior + 2 * S.WALL + extra;
    const bodyHeight = storeys * S.FLOOR + S.SLAB;
    const modern = style === 'modern';
    const crownLength = Math.min(150, Math.max(modern ? 72 : 54, Math.round(bodyHeight * (modern ? 0.32 : 0.28))));
    const margin = 20, coreDepth = 22;
    const width = bodyWidth + margin * 2;
    const height = bodyHeight + crownLength + 44 + coreDepth;
    const ground = height - coreDepth - 1;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'population', style, level, variant, storeys, bodyWidth, margin, crownLength, seed };
    const floorRow = (k) => ground - k * S.FLOOR;
    const maxIn = Math.max(0, Math.floor((bodyWidth - (INTERIOR_MIN + 2 * S.WALL)) / 2));

    // Storey outlines.
    const spans = [];
    for (let k = 0; k < storeys; k += 1) {
      const t = (k + 0.5) / storeys;
      let left = margin, right = margin + bodyWidth - 1;
      if (variant === 'offset') {
        if (t >= 0.45) right = left + INTERIOR_MIN + 2 * S.WALL + 4;
      } else {
        const inset = insetFor(variant, t, maxIn);
        left += inset; right -= inset;
      }
      const wall = storeys >= 9 && k >= Math.ceil(storeys / 2) ? S.WALL_UPPER : S.WALL;
      spans.push({ k, left, right, wall });
    }
    // Stair band fits inside every storey that has a flight.
    const narrowest = spans.reduce((best, s) => s.right - s.left < best.right - best.left ? s : best, spans[0]);
    const bandLeft = variant === 'offset' ? spans[0].left + S.WALL + 6
      : Math.round((narrowest.left + narrowest.right) / 2 - BAND / 2);

    const lit = spans.map((span) => (PW.hash2(seed, span.k) & 3) !== 0);
    // Back walls, windows, furniture, lamps.
    for (const span of spans) {
      const fRow = floorRow(span.k), top = fRow - S.CLEAR;
      const innerLeft = span.left + span.wall, innerRight = span.right - span.wall;
      K.rect(c, innerLeft, top, innerRight, fRow - 1, (x, y) =>
        K.back(c, x, y, K.backWallColor(style, x, y, fRow - 1 - y, innerLeft, innerRight)));
      // Back windows on a regular grid centred in the room.
      const pitch = style === 'asian' ? 32 : style === 'gothic' ? 26 : 22;
      const usable = innerRight - innerLeft - 8;
      const count = Math.max(1, Math.floor(usable / pitch));
      const start = innerLeft + 4 + Math.floor((usable - (count - 1) * pitch - 14) / 2);
      for (let i = 0; i < count; i += 1) {
        const wx = start + i * pitch;
        K.backWindow(c, style, wx, fRow, lit[span.k] && (PW.hash2(wx, span.k + seed) % 5) !== 0);
        c.windows.push({ x: wx, y: fRow - 20, storey: span.k });
      }
      // Ceiling lamps.
      if (lit[span.k]) for (let x = innerLeft + 18; x < innerRight - 10; x += 46) K.ceilingLamp(c, style, x, top);
    }

    // Floor slabs and the roof.
    for (let k = 1; k <= storeys; k += 1) {
      const below = spans[k - 1];
      for (let row = 0; row < S.SLAB; row += 1) {
        for (let x = below.left; x <= below.right; x += 1) {
          const y = floorRow(k) + row;
          K.solid(c, x, y, k === storeys ? M.CONCRETE : M.CONCRETE, K.slabColor(style, row, x, y), k === storeys ? ROLE.ROOF : ROLE.SLAB);
        }
      }
    }
    // Side walls with doors and windows.
    for (const span of spans) {
      const fRow = floorRow(span.k), topRow = floorRow(span.k + 1);
      for (const side of [-1, 1]) {
        const outer = side < 0 ? span.left : span.right;
        for (let d = 0; d < span.wall; d += 1) {
          const x = outer - side * d;
          for (let y = topRow; y < fRow; y += 1) {
            const rise = fRow - 1 - y;
            K.solid(c, x, y, P.wallMat, K.wallColor(style, d, span.wall, rise, x, y), ROLE.WALL);
          }
        }
        if (span.k === 0) {
          // Ground-floor doors on both sides: the street runs through the building.
          for (let d = 0; d < span.wall; d += 1) {
            const x = outer - side * d;
            for (let y = fRow - S.DOOR_H; y < fRow; y += 1) {
              K.clear(c, x, y);
              K.back(c, x, y, tone(P.frame, 0.3));
            }
            K.solid(c, x, fRow - S.DOOR_H - 1, P.wallMat, P.ornament, ROLE.WALL);
          }
          c.doors.push({ x: side < 0 ? span.left : span.right, side, top: fRow - S.DOOR_H, bottom: fRow - 1 });
        } else {
          // Side window through the wall thickness.
          const winTop = fRow - 29, winBottom = fRow - 12;
          for (let d = 0; d < span.wall; d += 1) {
            const x = outer - side * d;
            for (let y = winTop; y <= winBottom; y += 1) {
              const shine = y < winTop + 3 && d === 0;
              const glass = lit[span.k] ? mix(K.GLASS_SIDE, P.lamp, 0.42) : K.GLASS_SIDE;
              K.solid(c, x, y, M.GLASS, shine ? K.SHINE : tone(glass, 1 - d * 0.04), ROLE.GLASS);
            }
            K.solid(c, x, winTop - 1, P.wallMat, P.ornament, ROLE.WALL);
            K.solid(c, x, winBottom + 1, P.wallMat, tone(P.ornament, 0.75), ROLE.WALL);
          }
        }
      }
    }

    // Switchback stairs (one-way platforms) and stairwell openings in the slab above.
    for (let k = 0; k < storeys - 1; k += 1) {
      const dir = k % 2 === 0 ? 1 : -1;
      const fRow = floorRow(k);
      const flightStart = dir > 0 ? bandLeft + S.LANDING : bandLeft + S.LANDING + S.STAIR_RUN - 1;
      const steps = S.STAIR_RUN / S.STEP;
      const stairColor = tone(P.frame, 0.78);
      for (let i = 0; i < steps; i += 1) {
        const surface = fRow - S.STEP * (i + 1);
        for (let j = 0; j < S.STEP; j += 1) {
          const x = flightStart + dir * (i * S.STEP + j);
          for (let y = surface; y < Math.min(fRow, surface + S.STEP + S.STAIR_THICK); y += 1) {
            const nose = y === surface;
            K.solid(c, x, y, M.PLATFORM, nose ? tone(P.ornament, 0.85) : tone(stairColor, y > surface + S.STEP ? 0.82 : 1), ROLE.STAIR);
          }
        }
        // Handrail on the back wall above the nosing line.
        for (let j = 0; j < S.STEP; j += 1) {
          const x = flightStart + dir * (i * S.STEP + j);
          K.back(c, x, surface - 12 + Math.round(j * 0), tone(P.ornament, 0.7));
          if (j === 0 && i % 2 === 0) for (let y = surface - 11; y < surface; y += 1) K.back(c, x, y, tone(P.ornament, 0.5));
        }
      }
      // Slab above the flight becomes a one-way platform so climbers pass up through it.
      const upper = floorRow(k + 1);
      const lo = Math.min(flightStart, flightStart + dir * (S.STAIR_RUN - 1)) - 2;
      const hi = Math.max(flightStart, flightStart + dir * (S.STAIR_RUN - 1)) + 2;
      for (let x = lo; x <= hi; x += 1) {
        for (let row = 0; row < S.SLAB; row += 1) {
          const i = (upper + row) * c.width + x;
          if (c.role[i] === ROLE.SLAB) { c.mat[i] = M.PLATFORM; c.paint[i] = K.pack(tone(K.slabColor(style, row, x, upper + row), 0.86)); }
        }
      }
      c.stairs.push({ storey: k, dir, from: flightStart, to: flightStart + dir * (S.STAIR_RUN - 1), floorRow: fRow, upperRow: upper });
    }

    // Furniture, guard slots and the control panel (top accessible floor).
    const bandLo = bandLeft - 2, bandHi = bandLeft + BAND + 2;
    const furnitureSets = [['bed', 'plant', 'shelf'], ['sofa', 'tv', 'lampStand'], ['table', 'chair', 'kitchen'], ['shelf', 'bed', 'plant'],
      ['sofa', 'table', 'plant'], ['kitchen', 'table', 'chair']];
    const widths = { bed: 31, sofa: 27, table: 23, chair: 9, shelf: 17, plant: 12, tv: 19, lampStand: 6, kitchen: 33 };
    for (const span of spans) {
      const fRow = floorRow(span.k);
      const innerLeft = span.left + span.wall + 3, innerRight = span.right - span.wall - 3;
      const set = furnitureSets[(PW.hash2(seed, span.k + 11) % furnitureSets.length)];
      const free = [[innerLeft, Math.min(innerRight, bandLo)], [Math.max(innerLeft, bandHi), innerRight]].filter(([a, b]) => b - a > 12);
      let item = 0;
      for (const [a, b] of free) {
        let x = a + 4;
        while (item < set.length * 2 && x + widths[set[item % set.length]] < b - 2) {
          const name = set[item % set.length];
          K.FURNITURE[name](c, x, fRow, P, (item & 1) === 1);
          x += widths[name] + 6 + (PW.hash2(x, fRow) % 8);
          item += 1;
        }
      }
      // Guard positions: evenly along the free floor, away from the stairs.
      const perFloor = Math.min(soldiers, Math.max(1, Math.floor((innerRight - innerLeft - BAND) / S.SLOT)));
      let placed = 0;
      for (const [a, b] of free) {
        for (let x = a + 12; x < b - 10 && placed < perFloor; x += S.SLOT) {
          c.slots.push({ x, y: fRow, storey: span.k, facing: placed % 2 ? -1 : 1 });
          placed += 1;
        }
      }
    }
    const topSpan = spans[storeys - 1];
    const panelX = topSpan.left + topSpan.wall + 6;
    drawPanel(c, style, panelX, floorRow(storeys - 1));
    c.panels.push({ x: panelX + 9, y: floorRow(storeys - 1), storey: storeys - 1 });

    // Roof ornaments, the crown and rooftop devices.
    const roofs = [];
    for (let k = 1; k <= storeys; k += 1) {
      const below = spans[k - 1], above = spans[k];
      const row = floorRow(k);
      if (!above) { roofs.push({ left: below.left, right: below.right, y: row, top: true }); continue; }
      if (above.left > below.left) roofs.push({ left: below.left, right: above.left - 1, y: row, top: false, side: -1 });
      if (above.right < below.right) roofs.push({ left: above.right + 1, right: below.right, y: row, top: false, side: 1 });
    }
    c.roofs = roofs;
    if (PW.buildingOrnaments) {
      PW.buildingOrnaments.roof(c, style, spans, roofs, floorRow, random);
      const top = roofs.find((roof) => roof.top);
      const crown = options.crown ?? PW.buildingOrnaments.crownFor(style, `population|${variant}|${seed}`);
      PW.buildingOrnaments.crown(c, style, crown, Math.round((top.left + top.right) / 2), top.y - 1, crownLength, random);
      if (level >= 3) PW.buildingOrnaments.devices(c, style, roofs, ['interceptor', 'turret'], options.deviceFacing ?? (options.facing || 1), random);
    }

    // Buried cores under the ground floor (no foundation slab: the cores sit in the soil).
    const coreCount = populationCores(level);
    const base = spans[0];
    for (let i = 0; i < coreCount; i += 1) {
      const cx = Math.round(base.left + S.WALL + 12 + (base.right - base.left - 2 * S.WALL - 24) * (coreCount === 1 ? 0.5 : i / (coreCount - 1)));
      K.core(c, cx, ground + 11);
    }
    K.bakeLights(c, style);
    c.floors = spans.map((span) => ({ storey: span.k, y: floorRow(span.k), left: span.left + span.wall, right: span.right - span.wall }));
    c.body = { left: margin, right: margin + bodyWidth - 1, top: floorRow(storeys), bottom: ground - 1 };
    return c;
  }

  // Hackable control panel: a console with a lit screen on the back wall.
  function drawPanel(c, style, x, floor) {
    const P = STYLES[style];
    K.rect(c, x, floor - 16, x + 17, floor - 1, (gx, gy) => {
      const dx = gx - x, dy = floor - 1 - gy;
      if (dy < 9) K.back(c, gx, gy, dx === 0 || dx === 17 ? [50, 54, 58] : dy === 8 ? tone(P.ornament, 0.9) : [70, 76, 82]);
      else if (dx > 1 && dx < 16) K.back(c, gx, gy, dy === 15 || dx === 2 || dx === 15 ? [40, 44, 48] : (dx + dy) % 6 === 0 ? [210, 255, 220] : K.SCREEN);
    });
    K.back(c, x + 4, floor - 4, K.BEACON); K.back(c, x + 5, floor - 4, K.BEACON);
    c.lamps.push({ x: x + 9, y: floor - 12, radius: 14, strength: 0.25 });
  }

  PW.buildingTypes = PW.buildingTypes || {};
  PW.buildingTypes.population = populationTower;
  PW.POPULATION_VARIANTS = POPULATION_VARIANTS;
  PW.buildingPanel = drawPanel;
  PW.populationStoreys = populationStoreys;
})();
