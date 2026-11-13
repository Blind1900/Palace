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

  function farm(options) {
    const style = options.style, level = options.level || 2, variant = options.variant || 'silos';
    const facing = options.facing || 1, seed = options.seed || 1;
    const random = PW.createRandom(seed);
    const P = STYLES[style];
    const width = 330, height = 300, ground = height - 30;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'farm', style, level, variant, facing, seed };
    c.storage = [];
    const X = (lx) => facing > 0 ? 20 + lx : width - 21 - lx;
    const xs = (a, b) => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];
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
      for (let i = 0; i < count; i += 1) {
        const lx0 = shedWidth + 10 + i * 46, d = 36;
        const h = 110 + level * 6 + (i % 2) * 8;
        const fill = 0.25 + 0.6 * ((PW.hash2(seed, i) & 255) / 255);
        for (let lx = 0; lx < d; lx += 1) {
          const u = (lx - d / 2) / (d / 2);
          const shade = 1.18 - (u + 1) * 0.28;
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
        // Ladder up the side.
        for (let y = ground - h + 4; y < ground; y += 1) K.deco(c, X(lx0 + d), y, (ground - y) % 5 === 0 ? [150, 150, 150] : [96, 96, 100]);
        c.storage.push({ x: X(lx0 + d / 2), y: ground - h / 2, capacity: 100 });
        bodyRight = lx0 + d;
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
      K.FURNITURE.barrel(c, b0 + 30, ground); K.FURNITURE.crate(c, b0 + 120, ground);
      K.ceilingLamp(c, style, b0 + w / 2, ground - 90);
      bodyRight = w;
      c.storage.push({ x: b0 + w / 2, y: ground - 60, capacity: 160 });
    } else if (variant === 'greenhouse') {
      const w = 200, wallH = 46, teeth = 5, toothW = w / teeth;
      const [g0] = xs(0, w - 1);
      for (let x = g0; x < g0 + w; x += 1) for (let y = ground - wallH; y < ground; y += 1) {
        const d = Math.min(x - g0, g0 + w - 1 - x);
        if (d < 3) K.solid(c, x, y, M.STEEL, tone(P.frame, 0.9), ROLE.WALL);
        else if (d < 5) K.solid(c, x, y, M.GLASS, mix(K.GLASS_SIDE, [200, 230, 200], 0.25), ROLE.GLASS);
        else K.back(c, x, y, (x + y) % 9 === 0 ? [44, 60, 52] : [32, 44, 40]);
      }
      // Sawtooth roof: vertical glazed faces and sloped panels.
      for (let t = 0; t < teeth; t += 1) {
        for (let k = 0; k < toothW; k += 1) {
          const x = Math.round(g0 + t * toothW + k);
          const rise = Math.round(k / toothW * 26);
          for (let r = 0; r < 4; r += 1) K.solid(c, x, ground - wallH - rise + r, M.STEEL, tone(P.roof, r === 0 ? 1.3 : 1), ROLE.ROOF);
          for (let y = ground - wallH - rise + 4; y < ground - wallH; y += 1) K.back(c, x, y, [32, 44, 40]);
          if (k === Math.round(toothW) - 1) for (let y = ground - wallH - 26; y < ground - wallH; y += 1) K.solid(c, x, y, M.GLASS, mix(K.GLASS_SIDE, [220, 240, 210], 0.35), ROLE.GLASS);
        }
      }
      // Rows of plants on benches.
      for (let x = g0 + 10; x < g0 + w - 14; x += 24) {
        K.rect(c, x, ground - 10, x + 18, ground - 9, (gx, gy) => K.back(c, gx, gy, [96, 72, 48]));
        for (let i = 0; i < 18; i += 2) for (let h = 0; h < 6 + (PW.hash2(x, i) % 6); h += 1) K.back(c, x + i, ground - 11 - h, h > 4 ? [120, 176, 80] : [70, 130, 60]);
      }
      for (let d = 0; d < 5; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(w - 1 - d), y); K.back(c, X(w - 1 - d), y, [32, 44, 40]); }
      c.lamps.push({ x: g0 + w / 2, y: ground - 30, radius: 60, strength: 0.18 });
      bodyRight = w;
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
      for (let y = ground - 2 * S.FLOOR - 52; y < ground - 2 * S.FLOOR - 10; y += 1) for (let x = h0 + 20; x < h0 + 30; x += 1) K.solid(c, x, y, M.BRICK, tone([146, 86, 64], x % 3 === 0 ? 0.8 : 1), ROLE.ORNAMENT);
      for (const k of [0, 1]) {
        const f = ground - k * S.FLOOR;
        K.backWindow(c, style, h0 + 24, f, true); K.backWindow(c, style, h0 + w - 44, f, true);
        K.FURNITURE[k ? 'bed' : 'table'](c, h0 + 50, f, P); K.ceilingLamp(c, style, h0 + w / 2, f - S.CLEAR);
      }
      for (let d = 0; d < S.WALL; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(w - 1 - d), y); K.back(c, X(w - 1 - d), y, tone(P.frame, 0.3)); }
      // Windmill: lattice tower with four sails.
      const mx = X(w + 60), towerH = 150;
      for (let y = 0; y < towerH; y += 1) {
        const half = Math.round(14 - y / towerH * 10);
        for (const s of [-1, 1]) K.solid(c, mx + s * half, ground - 1 - y, M.STEEL, [110, 112, 116], ROLE.ORNAMENT);
        if (y % 14 === 0) for (let dx = -half; dx <= half; dx += 1) K.solid(c, mx + dx, ground - 1 - y, M.STEEL, [96, 98, 102], ROLE.ORNAMENT);
        if (y % 14 < 14) { const t = (y % 14) / 14; K.solid(c, mx + Math.round(-half + t * 2 * half), ground - 1 - y, M.STEEL, [86, 88, 92], ROLE.ORNAMENT); }
      }
      const hubY = ground - towerH - 2;
      for (let a = 0; a < 4; a += 1) {
        const angle = a * Math.PI / 2 + 0.35;
        for (let r = 3; r < 50; r += 1) {
          const sx = Math.round(mx + Math.cos(angle) * r), sy = Math.round(hubY + Math.sin(angle) * r);
          K.solid(c, sx, sy, M.WOOD, [140, 110, 76], ROLE.ORNAMENT);
          if (r > 14) for (let t = 1; t <= 4; t += 1) K.solid(c, Math.round(sx - Math.sin(angle) * t), Math.round(sy + Math.cos(angle) * t), M.WOOD,
            t === 4 || r % 6 === 0 ? [140, 110, 76] : [210, 200, 176], ROLE.ORNAMENT);
        }
      }
      K.rect(c, mx - 4, hubY - 4, mx + 4, hubY + 4, (x, y) => K.solid(c, x, y, M.STEEL, P.ornament, ROLE.ORNAMENT));
      bodyRight = w + 76;
      c.storage.push({ x: h0 + w / 2, y: ground - 20, capacity: 80 });
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
    const width = 200, height = 260, ground = height - 30;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'mine', style, facing, seed };
    const shaftX = Math.round(width / 2) - 10 * facing;
    const frameColor = style === 'asian' ? [176, 58, 46] : style === 'gothic' ? [74, 70, 80] : [96, 140, 170];
    const towerH = 160;
    for (let y = 0; y < towerH; y += 1) {
      const t = y / towerH, half = Math.round(26 - t * 18);
      for (const s of [-1, 1]) for (let k = 0; k < 3; k += 1) K.solid(c, shaftX + s * (half - k), ground - 1 - y, M.STEEL, tone(frameColor, k === 0 ? 1.15 : 0.9), ROLE.WALL);
      if (y % 20 === 0) for (let dx = -half; dx <= half; dx += 1) K.solid(c, shaftX + dx, ground - 1 - y, M.STEEL, tone(frameColor, 0.85), ROLE.WALL);
      const brace = (y % 20) / 20;
      K.solid(c, shaftX + Math.round(-half + brace * 2 * half), ground - 1 - y, M.STEEL, tone(frameColor, 0.75), ROLE.WALL);
      K.solid(c, shaftX + Math.round(half - brace * 2 * half), ground - 1 - y, M.STEEL, tone(frameColor, 0.75), ROLE.WALL);
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
