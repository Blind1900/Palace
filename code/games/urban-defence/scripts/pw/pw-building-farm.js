'use strict';
// Farms (silos, gambrel barn, sawtooth greenhouse, homestead with windmill) and mine headframes.
(function () {
  const PW = window.PW;
  const { M } = PW;
  const K = PW.buildingKit;
  const { S, STYLES, ROLE, tone, mix } = K;
  const FARM_VARIANTS = ['silos', 'barn', 'greenhouse', 'homestead'];
  const GRAIN = [214, 176, 92];

  function siding(style, x, y, d, P) {
    // Farm walls: Asian red timber, Gothic stone base with timber, Modern ribbed metal.
    if (style === 'asian') return tone(P.frame, (x % 6 === 0 ? 0.72 : 1) * (d === 0 ? 0.85 : 1));
    if (style === 'gothic') return tone(P.frame, (y % 6 === 0 || (x + Math.floor(y / 6) % 2 * 6) % 12 === 0) ? 0.78 : 1);
    return tone([150, 160, 170], x % 4 === 0 ? 0.8 : x % 4 === 1 ? 1.12 : 1);
  }
  function wallBox(c, style, P, x0, x1, y0, y1, thickness = 5) {
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) {
      const d = Math.min(x - x0, x1 - x);
      if (d < thickness) K.solid(c, x, y, P.wallMat, siding(style, x, y, d, P), ROLE.WALL);
      else K.back(c, x, y, tone(siding(style, x, y, 2, P), 0.42));
    }
  }

  // ---- Farmyard detail (from the grain-elevator and farmyard references) ---------------------------------
  // Drawn in the farm's own coordinates (lx from the back of the farm towards its field, v up from
  // the ground row), so a mirrored farm gets the mirror image.
  const YARD = 100;
  const TRACTOR = {
    modern: { body: [58, 122, 60], dark: [38, 84, 42], rim: [226, 190, 50], roof: [226, 190, 50] },
    asian: { body: [192, 62, 42], dark: [134, 40, 30], rim: [214, 210, 198], roof: [192, 62, 42] },
    gothic: { body: [62, 94, 150], dark: [42, 64, 106], rim: [226, 226, 220], roof: [214, 214, 208] },
  };
  const CATTLE = {
    modern: { hide: [228, 226, 220], patch: [34, 34, 36], muzzle: [196, 150, 146] },     // black-and-white dairy cattle
    asian: { hide: [150, 102, 58], patch: [118, 78, 44], muzzle: [90, 66, 50] },          // yellow cattle
    gothic: { hide: [116, 56, 38], patch: [86, 40, 28], muzzle: [70, 50, 42] },           // red steppe cattle
  };
  const STEEL_GALV = [150, 156, 160], STEEL_DARK = [96, 100, 106], TYRE = [34, 34, 36];
  function painter(c, X, ground) {
    const at = (lx, v) => [X(lx), ground - 1 - v];
    return {
      deco: (lx, v, col) => { const [x, y] = at(lx, v); K.deco(c, x, y, col); },
      back: (lx, v, col) => { const [x, y] = at(lx, v); K.back(c, x, y, col); },
      solid: (lx, v, mat, col, role = ROLE.ORNAMENT) => { const [x, y] = at(lx, v); K.solid(c, x, y, mat, col, role); },
    };
  }
  // A wheel: lugged tyre, sidewall, rim and hub.
  function wheel(d, cu, cv, R, rimR, rim) {
    for (let u = Math.floor(cu - R); u <= cu + R; u += 1) for (let v = Math.floor(cv - R); v <= cv + R; v += 1) {
      const r = Math.hypot(u - cu, v - cv);
      if (r > R + 0.3 || v < 0) continue;
      let col;
      if (r <= 1.5) col = [60, 60, 64];
      else if (r <= rimR) col = tone(rim, u < cu ? 1.1 : 0.85);
      else if (r > R - 2.4) col = Math.floor((Math.atan2(v - cv, u - cu) + Math.PI) / Math.PI * 9) % 2 ? [58, 58, 60] : TYRE;   // lugs
      else col = [46, 46, 48];
      d.deco(u, v, col);
    }
  }
  function tractor(d, style, u0) {
    const T = TRACTOR[style];
    // Cab over the rear axle: corner posts, a roof, tinted glass.
    for (let v = 13; v <= 36; v += 1) for (let u = 4; u <= 24; u += 1) {
      if (v >= 35) d.deco(u0 + u, v, v === 36 ? tone(T.roof, 1.15) : T.roof);
      else if (u <= 5 || u >= 23) d.deco(u0 + u, v, T.dark);
      else if (v >= 20) d.deco(u0 + u, v, (u + v) % 9 === 0 ? [150, 186, 200] : [72, 98, 112]);
    }
    // Chassis, then the engine hood and grille at the front, a headlamp and the exhaust stack.
    for (let u = 10; u <= 52; u += 1) for (let v = 9; v <= 13; v += 1) d.deco(u0 + u, v, v === 13 ? T.body : T.dark);
    for (let u = 28; u <= 52; u += 1) for (let v = 13; v <= 21; v += 1) d.deco(u0 + u, v, v === 21 ? tone(T.body, 1.2) : u >= 50 ? (v % 2 ? [40, 40, 42] : [70, 72, 76]) : T.body);
    d.deco(u0 + 52, 18, [255, 226, 140]);
    for (let v = 21; v <= 31; v += 1) d.deco(u0 + 40, v, [44, 44, 46]);
    d.deco(u0 + 40, 32, [70, 72, 76]); d.deco(u0 + 41, 32, [70, 72, 76]);
    // Big rear wheel under a fender, small steering wheel at the front.
    wheel(d, u0 + 12, 12, 12, 6, T.rim);
    for (let u = u0; u <= u0 + 26; u += 1) for (let v = 12; v <= 27; v += 1) {
      const r = Math.hypot(u - u0 - 12, v - 12);
      if (r >= 12.5 && r <= 14.2) d.deco(u, v, T.body);
    }
    wheel(d, u0 + 45, 7, 7, 3, T.rim);
  }
  // Two round bales with a third on top: plastic-wrapped (modern) or straw with its rolled spiral.
  function bales(d, style, u0) {
    const wrap = style === 'modern';
    for (const [cu, cv] of [[8, 8], [25, 8], [16.5, 22]]) {
      for (let u = Math.floor(cu - 8); u <= cu + 8; u += 1) for (let v = Math.floor(cv - 8); v <= cv + 8; v += 1) {
        const r = Math.hypot(u - cu, v - cv);
        if (r > 8.2 || v < 0) continue;
        const lit = (cu - u) + (v - cv) > 3, dark = (u - cu) + (cv - v) > 4;
        let col = wrap ? [222, 226, 222] : [208, 180, 102];
        if (!wrap && ((r > 4.3 && r < 5.1) || (r > 1.8 && r < 2.5))) col = [168, 140, 70];        // the rolled spiral
        if (wrap && Math.abs(v - cv) < 0.6) col = [190, 196, 192];                                // wrap seam
        if (r > 7.3) col = tone(col, 0.72);
        d.deco(u0 + u, v, tone(col, lit ? 1.08 : dark ? 0.86 : 1));
      }
    }
  }
  // A galvanised water trough and a cast-iron hand pump.
  function trough(d, u0) {
    for (let u = 0; u <= 16; u += 1) for (let v = 0; v <= 6; v += 1) {
      const edge = u === 0 || u === 16 || v === 0;
      if (edge || v === 6) d.deco(u0 + u, v, v === 6 ? tone(STEEL_GALV, 1.15) : u === 16 ? STEEL_DARK : STEEL_GALV);
      else d.deco(u0 + u, v, v === 5 ? [96, 160, 206] : [70, 120, 160]);
    }
    for (let v = 0; v <= 14; v += 1) d.deco(u0 + 20, v, v === 14 ? [90, 92, 96] : [62, 64, 68]);
    for (let u = 17; u <= 19; u += 1) d.deco(u0 + u, 12, [62, 64, 68]);
    d.deco(u0 + 17, 11, [96, 160, 206]);                                                        // a drip from the spout
    for (let k = 0; k <= 6; k += 1) d.deco(u0 + 21 + k, 14 + Math.round(k * 0.6), [62, 64, 68]);   // handle
  }
  // The yard fence along the field with a gate at its end: bamboo (asian), a dry-stone wall with
  // a wrought-iron gate (gothic), steel posts and wire with a tube gate (modern).
  function fence(d, style, u0, u1) {
    const gate = u1 - 18;
    for (let u = u0; u < gate; u += 1) {
      const k = u - u0;
      if (style === 'asian') {
        const post = k % 10 === 0;
        if (post) for (let v = 0; v <= 14; v += 1) d.deco(u, v, v % 4 === 0 ? [120, 116, 60] : [172, 164, 90]);
        for (const v of [5, 11]) if (!post) d.deco(u, v, k % 8 === 4 ? [128, 122, 64] : [184, 176, 100]);
      } else if (style === 'gothic') {
        for (let v = 0; v <= 8; v += 1) {
          const row = Math.floor(v / 3), joint = v % 3 === 2 || (k + row * 3) % 6 === 0;
          const h = PW.hash2(Math.floor((k + row * 3) / 6) + u0, row);
          d.deco(u, v, joint ? [66, 64, 62] : [[124, 120, 114], [104, 100, 96], [140, 136, 128]][h % 3]);
        }
        d.deco(u, 9, k % 3 === 2 ? [80, 78, 74] : [132, 128, 120]);                              // cope stones
        if (k % 3 !== 2) d.deco(u, 10, [112, 108, 102]);
      } else {
        const post = k % 12 === 0;
        if (post) for (let v = 0; v <= 12; v += 1) d.deco(u, v, v === 12 ? [70, 74, 78] : [92, 98, 104]);
        else for (const v of [4, 8, 12]) d.deco(u, v, [152, 154, 150]);
      }
    }
    for (let u = gate; u <= u1; u += 1) {
      const k = u - gate, end = k === 0 || k === u1 - gate;
      for (let v = 0; v <= 14; v += 1) {
        if (style === 'gothic') {
          const bar = end || k % 3 === 0;
          if ((bar && v <= 13) || v === 2 || v === 11) d.deco(u, v, [40, 38, 44]);
          if (bar && !end && v === 14) d.deco(u, v, [96, 92, 104]);                              // spear tips
        } else if (style === 'asian') {
          if (end || v === 1 || v === 13 || Math.abs(v - 1 - Math.round(k * 12 / (u1 - gate))) < 1 || Math.abs(v - 13 + Math.round(k * 12 / (u1 - gate))) < 1) d.deco(u, v, [172, 164, 90]);
        } else if (end || v === 1 || v === 12 || v === 6 || Math.abs(v - Math.round(k * 12 / (u1 - gate))) < 1) {
          if (v <= 12) d.deco(u, v, end ? [128, 134, 138] : STEEL_GALV);
        }
      }
    }
  }
  // A cow in profile facing +u (the face stays a plain shape, no features).
  function cow(d, style, u0, seed) {
    const C = CATTLE[style];
    const hide = (u, v) => (style === 'modern' && (PW.hash2(Math.floor((u + seed) / 5), Math.floor(v / 4) + seed) % 3 === 0) ? C.patch : C.hide);
    for (const lu of [3, 8, 19, 24]) for (let v = 0; v <= 7; v += 1) for (let k = 0; k < 2; k += 1) d.back(u0 + lu + k, v, v < 2 ? [40, 34, 30] : tone(hide(lu, 7), 0.9));
    for (let u = 2; u <= 25; u += 1) for (let v = 8; v <= 17; v += 1) {
      if ((u === 2 || u === 25) && (v === 8 || v === 17)) continue;
      d.back(u0 + u, v, tone(hide(u, v), v === 17 ? 1.12 : v === 8 ? 0.82 : 1));
    }
    for (let u = 24; u <= 26; u += 1) for (let v = 12; v <= 17; v += 1) d.back(u0 + u, v, C.hide);   // neck
    for (let u = 26; u <= 29; u += 1) for (let v = 12; v <= 18; v += 1) d.back(u0 + u, v, u === 29 && v <= 14 ? C.muzzle : tone(C.hide, 1.05));
    d.back(u0 + 25, 19, tone(C.hide, 0.8)); d.back(u0 + 27, 19, [214, 206, 180]); d.back(u0 + 27, 20, [214, 206, 180]);   // ear, horn
    for (let v = 9; v <= 15; v += 1) d.back(u0 + 1, v, tone(C.hide, 0.8));
    d.back(u0 + 1, 8, [40, 34, 30]);                                                            // tail tuft
  }

  function farm(options) {
    const style = options.style, level = options.level || 2, variant = options.variant || 'silos';
    const facing = options.facing || 1, seed = options.seed || 1;
    const random = PW.createRandom(seed);
    const P = STYLES[style];
    const width = 480, height = 300, ground = height - 30;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'farm', style, level, variant, facing, seed };
    c.storage = [];
    const X = (lx) => facing > 0 ? 20 + lx : width - 21 - lx;
    const xs = (a, b) => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];
    const art = painter(c, X, ground);
    let bodyRight = 0;

    if (variant === 'silos') {
      const count = Math.min(4, 1 + Math.floor((level - 1) / 2));
      const shedWidth = 120;
      // Shed with a lean-to roof.
      const [s0, s1] = xs(0, shedWidth - 1);
      for (let lx = 0; lx < shedWidth; lx += 1) {
        const roofRise = 50 - Math.round(lx / shedWidth * 14);
        for (let y = ground - roofRise; y < ground; y += 1) {
          const d = Math.min(lx, shedWidth - 1 - lx);
          if (d < 5 || y < ground - roofRise + 4) K.solid(c, X(lx), y, y < ground - roofRise + 4 ? M.TILE : P.wallMat,
            y < ground - roofRise + 4 ? tone(P.roof, lx % 6 === 0 ? 1.25 : 1) : siding(style, X(lx), y, d, P), y < ground - roofRise + 4 ? ROLE.ROOF : ROLE.WALL);
          else K.back(c, X(lx), y, tone(siding(style, X(lx), y, 2, P), 0.4));
        }
      }
      for (let y = ground - S.DOOR_H; y < ground; y += 1) for (let d = 0; d < 5; d += 1) { K.clear(c, X(shedWidth - 1 - d), y); K.back(c, X(shedWidth - 1 - d), y, tone(P.frame, 0.3)); }
      K.FURNITURE.sacks(c, s0 + 10, ground); K.FURNITURE.barrel(c, s0 + 46, ground); K.FURNITURE.barrel(c, s0 + 58, ground); K.FURNITURE.shelf(c, s0 + 76, ground);
      K.ceilingLamp(c, style, Math.round((s0 + s1) / 2), ground - 44);
      // Silos.
      const bins = [];
      for (let i = 0; i < count; i += 1) {
        const lx0 = shedWidth + 10 + i * 46, d = 36;
        const h = 110 + level * 6 + (i % 2) * 8;
        const fill = 0.25 + 0.6 * ((PW.hash2(seed, i) & 255) / 255);
        for (let lx = 0; lx < d; lx += 1) {
          const u = (lx - d / 2) / (d / 2);
          // Cylinder shading by the canvas side (light from the upper left either way round).
          const shade = 1.18 - (u * facing + 1) * 0.28;
          for (let y = ground - h; y < ground; y += 1) {
            const wall = lx < 3 || lx > d - 4;
            const rib = (ground - y) % 12 === 0;
            if (wall) K.solid(c, X(lx0 + lx), y, M.STEEL, tone(style === 'asian' ? [196, 190, 176] : style === 'gothic' ? [150, 146, 140] : [176, 186, 196], shade * (rib ? 0.86 : 1)), ROLE.WALL);
            else {
              const grainTop = ground - Math.round((h - 6) * fill);
              K.back(c, X(lx0 + lx), y, y >= grainTop ? tone(GRAIN, 0.9 + ((PW.hash2(lx, y) & 3) * 0.05)) : tone([60, 58, 54], 0.7));
            }
          }
          // Domed cap.
          const capRise = Math.round(14 * Math.sqrt(Math.max(0, 1 - u * u)));
          for (let t = 0; t <= capRise + 2; t += 1) K.solid(c, X(lx0 + lx), ground - h - t, M.STEEL, tone(P.frame, shade * (t > capRise ? 1.15 : 0.95)), ROLE.ROOF);
        }
        for (let t = 0; t < 8; t += 1) K.solid(c, X(lx0 + d / 2), ground - h - 17 - t, M.STEEL, t > 5 ? P.ornament : [90, 96, 104], ROLE.ORNAMENT);
        // Ladder up the side, caged above head height, and an aeration fan at the bin's foot.
        for (let y = ground - h + 4; y < ground; y += 1) K.deco(c, X(lx0 + d), y, (ground - y) % 5 === 0 ? [150, 150, 150] : [96, 96, 100]);
        for (let v = 30; v <= h - 6; v += 1) {
          art.deco(lx0 + d + 4, v, [110, 112, 116]);
          if (v % 6 === 0) for (let k = 1; k <= 3; k += 1) art.deco(lx0 + d + k, v, [128, 130, 134]);
        }
        for (let u = 5; u <= 9; u += 1) for (let v = 1; v <= 7; v += 1) art.deco(lx0 + d + u, v, v === 7 || u === 9 ? STEEL_DARK : v % 2 ? [74, 78, 82] : STEEL_GALV);
        for (let v = 2; v <= 5; v += 1) art.deco(lx0 + d + 10, v, [60, 62, 66]);                  // motor
        bins.push({ lx0, d, h });
        c.storage.push({ x: X(lx0 + d / 2), y: ground - h / 2, capacity: 100 });
        bodyRight = lx0 + d + 11;
      }
      // Grain elevator: a bucket-elevator leg standing above the bins, a headhouse on top, spouts
      // down to each bin, and a catwalk across the bin tops.
      const maxH = Math.max(...bins.map((b) => b.h));
      const legTop = maxH + 34, legX = shedWidth + 2;
      for (let v = 0; v <= legTop; v += 1) for (let k = 0; k < 6; k += 1) {
        art.solid(legX + k, v, M.STEEL, k === 0 ? tone(STEEL_GALV, 1.12) : k === 5 ? STEEL_DARK : v % 16 === 0 ? STEEL_DARK : STEEL_GALV, ROLE.WALL);
      }
      for (let v = legTop + 1; v <= legTop + 14; v += 1) for (let u = legX - 6; u <= legX + 11; u += 1) {
        const win = v >= legTop + 6 && v <= legTop + 9 && (u === legX - 2 || u === legX - 1 || u === legX + 7 || u === legX + 8);
        art.solid(u, v, M.STEEL, v >= legTop + 13 ? tone(P.roof, 1.1) : win ? [200, 214, 150] : u === legX - 6 ? tone(STEEL_GALV, 1.1) : u === legX + 11 ? STEEL_DARK : [132, 138, 142], ROLE.WALL);
      }
      for (const b of bins) {
        const x0 = legX + 11, v0 = legTop + 4, x1 = b.lx0 + b.d / 2, v1 = b.h + 17;
        const n = Math.max(Math.abs(x1 - x0), Math.abs(v1 - v0));
        for (let s = 0; s <= n; s += 1) {
          const u = Math.round(x0 + (x1 - x0) * s / n), v = Math.round(v0 + (v1 - v0) * s / n);
          art.deco(u, v, [120, 126, 130]); art.deco(u, v - 1, [86, 90, 94]);
        }
      }
      const last = bins[bins.length - 1], walkV = maxH + 24;
      for (let u = legX + 11; u <= last.lx0 + last.d; u += 1) {
        art.deco(u, walkV, [96, 100, 106]);
        art.deco(u, walkV + 6, [128, 132, 136]);
        if ((u - legX) % 6 === 0) for (let v = walkV + 1; v < walkV + 6; v += 1) art.deco(u, v, [110, 114, 118]);
      }
    } else if (variant === 'barn') {
      const w = 180, wallH = 72;
      const [b0] = xs(0, w - 1);
      wallBox(c, style, P, b0, b0 + w - 1, ground - wallH, ground - 1);
      // Gambrel roof.
      const half = w / 2 + 6;
      for (let dx = -half; dx <= half; dx += 1) {
        const t = Math.abs(dx) / half;
        const rise = t > 0.55 ? Math.round((1 - t) / 0.45 * 34) : 34 + Math.round((0.55 - t) / 0.55 * 22);
        for (let k = 0; k < 6; k += 1) K.solid(c, Math.round(b0 + w / 2 + dx), ground - wallH - rise + k, M.TILE, tone(P.roof, k === 0 ? 1.3 : dx % 8 === 0 ? 0.85 : 1), ROLE.ROOF);
        for (let y = ground - wallH - rise + 6; y < ground - wallH; y += 1) K.back(c, Math.round(b0 + w / 2 + dx), y, tone(P.frame, 0.32));
      }
      // Hay loft floor, big doors, hay bales.
      for (let x = b0 + 5; x < b0 + w - 5; x += 1) for (let r = 0; r < S.SLAB; r += 1) K.solid(c, x, ground - 40 + r, M.WOOD, K.slabColor(style, r, x, ground - 40 + r), ROLE.SLAB);
      for (let x = b0 + 60; x < b0 + 110; x += 1) for (let r = 0; r < S.SLAB; r += 1) c.mat[(ground - 40 + r) * c.width + x] = M.PLATFORM;
      for (const side of [0, w - 5]) for (let d = 0; d < 5; d += 1) for (let y = ground - 34; y < ground; y += 1) { K.clear(c, b0 + side + d, y); K.back(c, b0 + side + d, y, tone(P.frame, 0.3)); }
      for (let i = 0; i < 4; i += 1) K.FURNITURE.sacks(c, b0 + 20 + i * 38, ground - 40);
      // Timber posts carry the hay loft (the doors take the end walls down to the ground), with
      // stalls between them: a cow in each, behind a rail.
      for (const px of [36, 142]) for (let v = 0; v < 40 - S.SLAB + 1; v += 1) for (let k = 0; k < 3; k += 1) {
        art.solid(px + k, v, M.WOOD, k === 0 ? [140, 104, 66] : k === 2 ? [90, 64, 40] : [116, 84, 52], ROLE.WALL);
      }
      for (const [u0, s] of [[48, 3], [90, 11]]) {
        cow(art, style, u0, seed + s);
        for (let u = u0 - 4; u <= u0 + 36; u += 1) art.back(u, 11, [104, 76, 48]);              // stall rail
        for (let v = 0; v <= 12; v += 1) art.back(u0 - 4, v, [96, 70, 44]);
      }
      { const [bx] = xs(20, 31); K.FURNITURE.barrel(c, bx, ground); }
      { const [cx] = xs(152, 165); K.FURNITURE.crate(c, cx, ground); }
      K.ceilingLamp(c, style, b0 + w / 2, ground - 90);
      // A ventilator cupola on the ridge with a weathervane.
      const ridge = wallH + 56;
      for (let v = ridge; v <= ridge + 12; v += 1) for (let u = w / 2 - 7; u <= w / 2 + 7; u += 1) {
        const slat = v > ridge + 2 && v < ridge + 10 && Math.abs(u - w / 2) < 6 && v % 2 === 0;
        art.solid(u, v, M.WOOD, slat ? tone(P.frame, 0.55) : siding(style, X(u), v, 2, P), ROLE.ORNAMENT);
      }
      for (let k = 0; k <= 8; k += 1) for (let u = w / 2 - 9 + k; u <= w / 2 + 9 - k; u += 1) art.solid(u, ridge + 13 + k, M.TILE, tone(P.roof, k === 0 ? 1.3 : 1), ROLE.ORNAMENT);
      for (let v = ridge + 22; v <= ridge + 30; v += 1) art.deco(w / 2, v, [60, 58, 54]);
      for (let u = w / 2 - 5; u <= w / 2 + 6; u += 1) art.deco(u, ridge + 28, u > w / 2 + 3 ? P.ornament : [60, 58, 54]);   // arrow
      art.deco(w / 2 - 5, ridge + 29, [60, 58, 54]); art.deco(w / 2 - 5, ridge + 27, [60, 58, 54]);
      // Hay hoist: a beam out from the top of the front wall, a pulley and rope, and the loft
      // door open below it.
      for (let u = w - 5; u <= w + 10; u += 1) for (let v = wallH - 3; v <= wallH - 1; v += 1) art.solid(u, v, M.WOOD, v === wallH - 1 ? [140, 104, 66] : [100, 72, 46], ROLE.ORNAMENT);
      for (let v = 30; v < wallH - 3; v += 1) art.deco(w + 8, v, [196, 180, 140]);
      for (let u = w + 7; u <= w + 9; u += 1) art.deco(u, 29, [70, 70, 74]);
      bodyRight = w + 12;
      c.storage.push({ x: b0 + w / 2, y: ground - 60, capacity: 160 });
    } else if (variant === 'greenhouse') {
      const w = 200, wallH = 46, teeth = 5, toothW = w / teeth;
      const [g0] = xs(0, w - 1);
      for (let x = g0; x < g0 + w; x += 1) for (let y = ground - wallH; y < ground; y += 1) {
        const d = Math.min(x - g0, g0 + w - 1 - x);
        if (d < 3) K.solid(c, x, y, M.STEEL, tone(P.frame, 0.9), ROLE.WALL);
        else if (d < 5) K.solid(c, x, y, M.GLASS, mix(K.GLASS_SIDE, [200, 230, 200], 0.35), ROLE.GLASS);
        else K.back(c, x, y, (x + y) % 9 === 0 ? [92, 124, 100] : (x % 20 === 0 ? [70, 96, 80] : [78, 108, 88]));
      }
      // Sawtooth roof: vertical glazed faces and sloped panels.
      // The glazed faces of the sawtooth look towards the front (mirrored with the farm).
      for (let t = 0; t < teeth; t += 1) {
        for (let k = 0; k < toothW; k += 1) {
          const x = Math.round(g0 + t * toothW + k);
          const along = facing > 0 ? k : toothW - 1 - k;
          const rise = Math.round(along / toothW * 26);
          for (let r = 0; r < 4; r += 1) K.solid(c, x, ground - wallH - rise + r, M.STEEL, tone(P.roof, r === 0 ? 1.3 : 1), ROLE.ROOF);
          for (let y = ground - wallH - rise + 4; y < ground - wallH; y += 1) K.back(c, x, y, [86, 116, 96]);
          if (along === Math.round(toothW) - 1) for (let y = ground - wallH - 26; y < ground - wallH; y += 1) K.solid(c, x, y, M.GLASS, mix(K.GLASS_SIDE, [220, 240, 210], 0.45), ROLE.GLASS);
        }
      }
      // Grow lights along the roof line.
      for (let x = g0 + 20; x < g0 + w - 10; x += 40) c.lamps.push({ x, y: ground - wallH + 2, radius: 30, strength: 0.3 });
      // Rows of plants on benches.
      for (let x = g0 + 10; x < g0 + w - 14; x += 24) {
        K.rect(c, x, ground - 10, x + 18, ground - 9, (gx, gy) => K.back(c, gx, gy, [96, 72, 48]));
        for (let i = 0; i < 18; i += 2) for (let h = 0; h < 6 + (PW.hash2(x, i) % 6); h += 1) K.back(c, x + i, ground - 11 - h, h > 4 ? [120, 176, 80] : [70, 130, 60]);
      }
      for (let d = 0; d < 5; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(w - 1 - d), y); K.back(c, X(w - 1 - d), y, [70, 96, 80]); }
      // Drip irrigation under the benches, fed from a rainwater tank outside; the roof vents on
      // the glazed faces are propped open.
      for (let u = 8; u < w - 8; u += 1) { art.back(u, 7, [86, 104, 112]); if (u % 6 === 0) art.back(u, 6, [60, 120, 170]); }
      for (let u = w + 4; u <= w + 15; u += 1) for (let v = 0; v <= 22; v += 1) {
        const rib = v % 6 === 0, edge = u === w + 4 || u === w + 15;
        art.deco(u, v, v >= 21 ? [70, 76, 80] : edge ? (u === w + 4 ? [120, 140, 150] : [70, 86, 94]) : rib ? [84, 102, 110] : [100, 120, 130]);
      }
      for (let u = w - 2; u <= w + 4; u += 1) art.deco(u, 4, [86, 104, 112]);                     // feed pipe
      for (let t = 0; t < teeth; t += 1) {
        const vu = Math.round(facing > 0 ? (t + 1) * toothW - 1 : t * toothW);   // the glazed face of each tooth, in local terms
        const lu = facing > 0 ? vu : w - 1 - vu;
        for (let k = 0; k <= 5; k += 1) art.deco(lu + k, wallH + 26 - Math.round(k * 0.4), [168, 196, 176]);
      }
      bodyRight = w + 18;
      c.storage.push({ x: g0 + w / 2, y: ground - 20, capacity: 80 });
    } else {
      // Homestead: a two-storey house with a gable roof and chimney, plus a windmill.
      const w = 130;
      const [h0] = xs(0, w - 1);
      wallBox(c, style, P, h0, h0 + w - 1, ground - 2 * S.FLOOR, ground - 1, S.WALL);
      for (let x = h0; x < h0 + w; x += 1) for (let r = 0; r < S.SLAB; r += 1) K.solid(c, x, ground - S.FLOOR + r, M.WOOD, K.slabColor(style, r, x, ground - S.FLOOR + r), ROLE.SLAB);
      for (let dx = -8; dx < w + 8; dx += 1) {
        const rise = Math.round((1 - Math.abs(dx - w / 2) / (w / 2 + 8)) * 40);
        for (let k = 0; k < 5; k += 1) K.solid(c, h0 + dx, ground - 2 * S.FLOOR - rise + k, M.TILE, tone(P.roof, k === 0 ? 1.3 : dx % 7 === 0 ? 0.85 : 1), ROLE.ROOF);
        for (let y = ground - 2 * S.FLOOR - rise + 5; y < ground - 2 * S.FLOOR; y += 1) if (dx >= 0 && dx < w) K.back(c, h0 + dx, y, tone(P.frame, 0.3));
      }
      // Chimney inside the gable-end wall: a fireplace on the ground floor, the breast rising up
      // the back wall through the upper floor and the attic (behind the rooms), and the stack
      // above the roof standing exactly on the roof tiles in every column.
      const roofTop = (x) => ground - 2 * S.FLOOR - Math.round((1 - Math.abs(x - h0 - w / 2) / (w / 2 + 8)) * 40);
      const masonry = style === 'asian' ? [112, 114, 118] : style === 'gothic' ? [128, 124, 118] : [146, 86, 64];
      const course = (x, y) => tone(masonry, y % 4 === 0 ? 0.72 : (x + (Math.floor(y / 4) & 1) * 3) % 6 === 0 ? 0.8 : 1);
      const [c0, c1] = xs(7, 18), [f0, f1] = xs(9, 16), [s0, s1] = xs(8, 17);
      for (let x = c0; x <= c1; x += 1) for (let y = roofTop(x) + 5; y < ground; y += 1) K.back(c, x, y, tone(course(x, y), 0.62));
      for (let x = f0; x <= f1; x += 1) for (let y = ground - 12; y < ground; y += 1) {
        const v = ground - 1 - y;
        K.back(c, x, y, v <= 3 ? (PW.hash2(x, y) & 1 ? [255, 168, 64] : [226, 92, 34]) : v <= 5 && (x + y) % 3 === 0 ? [255, 210, 120] : [28, 22, 20]);
      }
      for (let x = c0 - 1; x <= c1 + 1; x += 1) { K.back(c, x, ground - 14, [176, 150, 120]); K.back(c, x, ground - 13, [140, 116, 92]); }   // mantel
      c.lamps.push({ x: Math.round((f0 + f1) / 2), y: ground - 6, radius: 22, strength: 0.4 });          // firelight
      const stackTop = ground - 2 * S.FLOOR - 50;
      for (let x = s0 - 1; x <= s1 + 1; x += 1) for (let y = stackTop; y < roofTop(x); y += 1) {
        const cap = y < stackTop + 3;
        if (!cap && (x < s0 || x > s1)) continue;
        K.solid(c, x, y, M.BRICK, cap ? tone(masonry, 0.85) : course(x, y), ROLE.ORNAMENT);
      }
      for (let y = stackTop - 3; y < stackTop; y += 1) for (const k of [3, 4, 6, 7]) {
        const [px] = xs(8 + k, 8 + k);
        K.solid(c, px, y, M.BRICK, [176, 96, 64], ROLE.ORNAMENT);                                        // chimney pots
      }
      for (const k of [0, 1]) {
        const f = ground - k * S.FLOOR;
        K.backWindow(c, style, h0 + 24, f, true); K.backWindow(c, style, h0 + w - 44, f, true);
        K.FURNITURE[k ? 'bed' : 'table'](c, h0 + 50, f, P); K.ceilingLamp(c, style, h0 + w / 2, f - S.CLEAR);
      }
      for (let d = 0; d < S.WALL; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(w - 1 - d), y); K.back(c, X(w - 1 - d), y, tone(P.frame, 0.3)); }
      // Windmill: lattice tower with four sails.
      const mx = X(w + 60), towerH = 150;
      const halfAt = (y) => Math.round(14 - y / towerH * 10);
      for (let y = 0; y < towerH; y += 1) {
        const half = halfAt(y);
        for (const s of [-1, 1]) K.solid(c, mx + s * half, ground - 1 - y, M.STEEL, [110, 112, 116], ROLE.ORNAMENT);
        if (y % 14 === 0) for (let dx = -half; dx <= half; dx += 1) K.solid(c, mx + dx, ground - 1 - y, M.STEEL, [96, 98, 102], ROLE.ORNAMENT);
        // The diagonal brace in each panel, unbroken: every row fills the run from the previous
        // row's brace cell to its own.
        const brace = (yy) => mx + Math.round(-halfAt(yy) + ((yy % 14) / 14) * 2 * halfAt(yy));
        const bx = brace(y), prev = y % 14 === 0 ? bx : brace(y - 1);
        for (let x = Math.min(bx, prev); x <= Math.max(bx, prev); x += 1) K.solid(c, x, ground - 1 - y, M.STEEL, [86, 88, 92], ROLE.ORNAMENT);
      }
      // Four sails: a spar from the hub and a lattice of cloth beside it, each filled cell by cell
      // (the sail is the set of cells inside it, so it is one connected piece).
      const hubY = ground - towerH - 2;
      for (let a = 0; a < 4; a += 1) {
        const angle = facing > 0 ? a * Math.PI / 2 + 0.35 : Math.PI - (a * Math.PI / 2 + 0.35);
        const ca = Math.cos(angle), sa = Math.sin(angle);
        for (let y = hubY - 52; y <= hubY + 52; y += 1) for (let x = mx - 52; x <= mx + 52; x += 1) {
          const dx = x - mx, dy = y - hubY, r = dx * ca + dy * sa, t = -dx * sa + dy * ca;   // along the spar, across it
          if (r < 3 || r > 49) continue;
          if (Math.abs(t) <= 0.7) K.solid(c, x, y, M.WOOD, [140, 110, 76], ROLE.ORNAMENT);
          else if (r > 14 && t > 0 && t <= 4.5) K.solid(c, x, y, M.WOOD, t > 3.6 || Math.round(r) % 6 === 0 ? [140, 110, 76] : [210, 200, 176], ROLE.ORNAMENT);
        }
      }
      K.rect(c, mx - 4, hubY - 4, mx + 4, hubY + 4, (x, y) => K.solid(c, x, y, M.STEEL, P.ornament, ROLE.ORNAMENT));
      // A front porch on posts over the door, with steps down.
      for (let u = w; u <= w + 18; u += 1) for (let v = 0; v <= 2; v += 1) art.solid(u, v, M.WOOD, v === 2 ? [150, 112, 72] : [110, 80, 52], ROLE.SLAB);
      for (let v = 3; v <= 30; v += 1) for (let k = 0; k < 2; k += 1) art.solid(w + 16 + k, v, M.WOOD, k ? [96, 70, 46] : [140, 104, 66], ROLE.WALL);
      for (let u = w - 1; u <= w + 20; u += 1) {
        const v0 = 31 + Math.round((w + 20 - u) / 7);
        for (let v = v0; v <= v0 + 2; v += 1) art.solid(u, v, M.TILE, tone(P.roof, v === v0 + 2 ? 1.25 : 1), ROLE.ROOF);
      }
      for (let u = w + 1; u <= w + 15; u += 1) for (let v = 3; v <= 12; v += 1) if (v === 12 || v === 3 || u % 3 === 0) art.deco(u, v, [176, 140, 96]);   // railing
      for (let k = 0; k < 3; k += 1) for (let u = w + 19 + k * 3; u <= w + 21 + k * 3; u += 1) for (let v = 0; v <= 1 - (k > 1 ? 1 : 0); v += 1) art.solid(u, v, M.WOOD, [128, 96, 62], ROLE.STAIR);
      // A chicken coop on legs with a ramp and a few hens, and a vegetable garden.
      const coop = w + 76;
      for (let u = coop; u <= coop + 18; u += 1) for (let v = 6; v <= 17; v += 1) {
        const roof = v >= 15 - Math.abs(u - coop - 9) / 4;
        art.deco(u, v, roof ? tone(P.roof, 1.1) : u === coop + 13 && v <= 11 ? [40, 34, 30] : siding(style, X(u), v, 2, P));
      }
      for (const lu of [coop + 1, coop + 17]) for (let v = 0; v <= 5; v += 1) art.deco(lu, v, [96, 70, 46]);
      for (let k = 0; k <= 8; k += 1) art.deco(coop + 14 + k, 6 - Math.round(k * 0.7), [150, 112, 72]);
      for (const hu of [coop - 8, coop + 20, coop + 24]) {
        for (const [du, dv] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [2, 2]]) art.deco(hu + du, dv + 1, [236, 232, 220]);
        art.deco(hu + 2, 3, [200, 48, 40]); art.deco(hu + 3, 2, [226, 170, 60]);   // comb and beak
        art.deco(hu, 0, [226, 170, 60]); art.deco(hu + 1, 0, [226, 170, 60]);
      }
      for (let u = w + 29; u <= w + 44; u += 1) {
        art.deco(u, 0, [86, 64, 44]);
        if (u % 6 < 3) for (let v = 1; v <= 3 + (PW.hash2(u, seed) % 3); v += 1) art.deco(u, v, v > 2 ? [96, 160, 64] : [70, 128, 52]);
      }
      bodyRight = w + 100;
      c.storage.push({ x: h0 + w / 2, y: ground - 20, capacity: 80 });
    }
    // The farmyard between the farm and its field: the fence along it with a gate onto the field,
    // a tractor, a water trough with a hand pump, and bales.
    // (compact: the bales stand behind the tractor, the trough by the gate; a greenhouse has no
    // yard of its own)
    if (variant !== 'greenhouse') {
      const yard0 = bodyRight + 4, yard1 = yard0 + YARD;
      fence(art, style, yard0, yard1);
      bales(art, style, yard0 + 30);
      tractor(art, style, yard0 + 2);
      trough(art, yard0 + 58);
      bodyRight = yard1;
    }
    K.core(c, X(30), ground + 12);
    K.bakeLights(c, style);
    const [l, r] = xs(0, bodyRight);
    c.body = { left: l, right: r, top: 0, bottom: ground - 1 };
    c.fieldSide = facing;   // crops grow on the front side
    return c;
  }

  // Mine headframe: steel A-frame with sheave wheels over the shaft, hoist house and ore bin.
  function mine(options) {
    const style = options.style, facing = options.facing || 1, seed = options.seed || 1;
    const P = STYLES[style];
    // Headframe at the front, hoist house behind it (the whole frame fits the canvas either way).
    const width = 220, height = 260, ground = height - 30;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'mine', style, facing, seed };
    const shaftX = facing > 0 ? width - 70 : 69;
    const frameColor = style === 'asian' ? [176, 58, 46] : style === 'gothic' ? [74, 70, 80] : [96, 140, 170];
    const towerH = 160;
    const halfAt = (y) => Math.round(26 - y / towerH * 18);
    for (let y = 0; y < towerH; y += 1) {
      const half = halfAt(y);
      for (const s of [-1, 1]) for (let k = 0; k < 3; k += 1) K.solid(c, shaftX + s * (half - k), ground - 1 - y, M.STEEL, tone(frameColor, k === 0 ? 1.15 : 0.9), ROLE.WALL);
      if (y % 20 === 0) for (let dx = -half; dx <= half; dx += 1) K.solid(c, shaftX + dx, ground - 1 - y, M.STEEL, tone(frameColor, 0.85), ROLE.WALL);
    }
    // X-bracing across each 20-row panel, drawn as unbroken lines between the legs.
    for (let y0 = 0; y0 < towerH - 1; y0 += 20) {
      const y1 = Math.min(y0 + 20, towerH - 1), h0 = halfAt(y0) - 2, h1 = halfAt(y1) - 2;
      for (const s of [-1, 1]) {
        const steps = Math.max(h0 + h1, y1 - y0);
        for (let i = 0; i <= steps; i += 1) {
          // (rounded before the side is applied, so the mirrored frame is exact)
          const x = shaftX + s * Math.round(-h0 + (h0 + h1) * i / steps), y = ground - 1 - Math.round(y0 + (y1 - y0) * i / steps);
          if (!c.mat[y * width + x]) K.solid(c, x, y, M.STEEL, tone(frameColor, 0.75), ROLE.WALL);
        }
      }
    }
    // Back leg towards the hoist house.
    for (let k = 0; k < 120; k += 1) for (let t = 0; t < 3; t += 1) K.solid(c, shaftX - facing * (26 + Math.round(k * 0.55)), ground - towerH + 12 + k + t, M.STEEL, tone(frameColor, 0.95), ROLE.WALL);
    // Sheave wheels.
    for (const dx of [-8, 8]) for (let a = 0; a < 64; a += 1) {
      const angle = a / 64 * Math.PI * 2;
      for (const r of [9, 10]) K.solid(c, shaftX + dx + Math.round(Math.cos(angle) * r), ground - towerH - 6 + Math.round(Math.sin(angle) * r), M.STEEL, P.ornament, ROLE.ORNAMENT);
      if (a % 8 === 0) for (let r = 0; r < 9; r += 1) K.solid(c, shaftX + dx + Math.round(Math.cos(angle) * r), ground - towerH - 6 + Math.round(Math.sin(angle) * r), M.STEEL, [90, 96, 104], ROLE.ORNAMENT);
    }
    // Cables and the cage hanging over the shaft mouth.
    for (let y = ground - towerH; y < ground - 40; y += 1) { K.deco(c, shaftX - 2, y, [170, 170, 170]); K.deco(c, shaftX + 2, y, [170, 170, 170]); }
    K.rect(c, shaftX - 8, ground - 40, shaftX + 8, ground - 16, (x, y) => K.deco(c, x, y, (x + y) % 4 === 0 ? [80, 84, 90] : (x === shaftX - 8 || x === shaftX + 8 || y === ground - 40) ? [150, 154, 160] : 0));
    // Hoist house.
    const hx = shaftX - facing * 110;
    const [h0, h1] = [Math.min(hx, hx + facing * 70), Math.max(hx, hx + facing * 70)];
    wallBox(c, style, P, h0, h1, ground - 46, ground - 1, 5);
    for (let x = h0 - 4; x <= h1 + 4; x += 1) for (let r = 0; r < 5; r += 1) K.solid(c, x, ground - 46 - r, M.TILE, tone(P.roof, r === 4 ? 1.3 : 1), ROLE.ROOF);
    for (let a = 0; a < 48; a += 1) { const angle = a / 48 * Math.PI * 2; K.back(c, Math.round((h0 + h1) / 2 + Math.cos(angle) * 12), ground - 22 + Math.round(Math.sin(angle) * 12), [120, 124, 130]); }
    // Shaft mouth (open to be dug down by the tunnel crews).
    c.shaft = { x: shaftX, top: ground };
    K.core(c, Math.round((h0 + h1) / 2), ground + 12);
    c.body = { left: Math.min(h0, shaftX - 30), right: Math.max(h1, shaftX + 30), top: ground - towerH - 20, bottom: ground - 1 };
    K.bakeLights(c, style);
    return c;
  }

  PW.buildingTypes = PW.buildingTypes || {};
  PW.buildingTypes.farm = farm;
  PW.buildingTypes.mine = mine;
  PW.FARM_VARIANTS = FARM_VARIANTS;
})();
