'use strict';
// Building kit: scale constants, faction style palettes and the cell canvas that building
// generators draw into. Everything is sized for a 25-cell trooper (one cell is about 7 cm).
(function () {
  const PW = window.PW;
  const { M } = PW;

  const S = Object.freeze({
    TROOPER: 25,      // standing trooper height (GIF art, 1:1)
    FLOOR: 40,        // floor-to-floor pitch (about 2.9 m)
    SLAB: 4,          // floor slab thickness
    CLEAR: 36,        // clear height inside a storey
    WALL: 6,          // exterior wall thickness (lower storeys)
    WALL_UPPER: 5,    // exterior wall thickness (upper half of tall towers)
    DOOR_H: 30,       // door opening height
    STAIR_RUN: 40,    // a flight rises one storey over 40 columns (45 degrees)
    STEP: 4,          // step rise and tread
    STAIR_THICK: 4,
    LANDING: 10,
    SLOT: 26,         // spacing between guard positions
  });

  // Faction styles from the building style lab (frame colour, ornament colour, lamp light).
  const STYLES = Object.freeze({
    asian: { name: 'asian', frame: [176, 58, 46], ornament: [226, 178, 64], lamp: [255, 214, 120],
      wallMat: M.WOOD, trim: [120, 36, 30], roof: [58, 56, 56], roofLight: [86, 80, 74], glow: [255, 190, 90] },
    gothic: { name: 'gothic', frame: [120, 116, 132], ornament: [176, 150, 210], lamp: [236, 214, 255],
      wallMat: M.MASONRY, trim: [84, 80, 96], roof: [64, 68, 78], roofLight: [96, 100, 112], glow: [255, 214, 120] },
    modern: { name: 'modern', frame: [96, 140, 170], ornament: [196, 224, 236], lamp: [188, 242, 236],
      wallMat: M.CONCRETE, trim: [70, 100, 124], roof: [64, 66, 72], roofLight: [120, 128, 136], glow: [240, 250, 255] },
  });
  const CORE_COLOR = [255, 164, 20], CORE_SHADE = [150, 78, 8], BEACON = [235, 52, 40], SCREEN = [120, 230, 140];
  const GLASS_DARK = [54, 82, 100], GLASS_SIDE = [92, 136, 158], SHINE = [178, 216, 230];

  const clamp255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v | 0;
  const tone = (c, k) => [clamp255(c[0] * k), clamp255(c[1] * k), clamp255(c[2] * k)];
  const mix = (a, b, t) => [clamp255(a[0] + (b[0] - a[0]) * t), clamp255(a[1] + (b[1] - a[1]) * t), clamp255(a[2] + (b[2] - a[2]) * t)];
  const pack = (c) => PW.abgr(c[0], c[1], c[2], c[3] ?? 255);
  const grain = (x, y) => (Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 13) & 15;

  // Roles let construction, collapse and units tell parts apart.
  const ROLE = Object.freeze({ NONE: 0, WALL: 1, SLAB: 2, STAIR: 3, ROOF: 4, GLASS: 5, ORNAMENT: 6, DEVICE: 7,
    CORE: 8, CRADLE: 9, CROWN: 10, VAULT: 11, FRAME: 12, BRIDGE: 13, PROP: 14 });

  // A building canvas: local cells for the physical layer (mat + paint + role), the back wall layer
  // and the front deco layer. `ground` is the local row of the terrain surface under the building.
  function createCanvas(width, height, ground) {
    const n = width * height;
    return {
      width, height, ground,
      mat: new Uint8Array(n), paint: new Uint32Array(n), role: new Uint8Array(n),
      back: new Uint32Array(n), deco: new Uint32Array(n), light: new Float32Array(0),
      floors: [], stairs: [], doors: [], slots: [], cores: [], lamps: [], devices: [], panels: [], windows: [],
      meta: {},
    };
  }
  const inside = (c, x, y) => x >= 0 && y >= 0 && x < c.width && y < c.height;
  function solid(c, x, y, mat, color, role) {
    x |= 0; y |= 0;
    if (!inside(c, x, y)) return;
    const i = y * c.width + x;
    c.mat[i] = mat; c.paint[i] = pack(color); c.role[i] = role;
  }
  function solidIfEmpty(c, x, y, mat, color, role) {
    x |= 0; y |= 0;
    if (!inside(c, x, y) || c.mat[y * c.width + x]) return false;
    solid(c, x, y, mat, color, role);
    return true;
  }
  function clear(c, x, y) {
    x |= 0; y |= 0;
    if (!inside(c, x, y)) return;
    const i = y * c.width + x;
    c.mat[i] = 0; c.paint[i] = 0; c.role[i] = 0;
  }
  function back(c, x, y, color) {
    x |= 0; y |= 0;
    if (inside(c, x, y)) c.back[y * c.width + x] = pack(color);
  }
  function backIfEmpty(c, x, y, color) {
    x |= 0; y |= 0;
    if (inside(c, x, y) && !c.back[y * c.width + x]) c.back[y * c.width + x] = pack(color);
  }
  function deco(c, x, y, color) {
    x |= 0; y |= 0;
    if (inside(c, x, y)) c.deco[y * c.width + x] = pack(color);
  }
  function isSolid(c, x, y) { return inside(c, x | 0, y | 0) && c.mat[(y | 0) * c.width + (x | 0)] !== 0; }
  function rect(c, x0, y0, x1, y1, fn) {
    for (let y = Math.round(y0); y <= y1; y += 1) for (let x = Math.round(x0); x <= x1; x += 1) fn(x, y);
  }
  // Draw from a small ASCII bitmap; `map` turns a character into a callback or null.
  function bitmap(rows, x0, y0, flip, map) {
    const width = Math.max(...rows.map((row) => row.length));
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx += 1) {
        const fn = map[row[dx]];
        if (fn) fn(x0 + (flip ? width - 1 - dx : dx), y0 + dy);
      }
    });
    return width;
  }

  // ---- Wall surfaces ---------------------------------------------------------------------------
  // Side wall cell colour (d = depth into the wall from the outside, rise = rows above the floor).
  function wallColor(style, d, wall, rise, x, y) {
    const P = STYLES[style];
    let color = P.frame;
    const g = grain(x, y);
    if (style === 'gothic') {
      const course = Math.floor(rise / 6), joint = rise % 6 === 0;
      color = tone(color, d === 0 ? 1.12 : d === wall - 1 ? 0.86 : 1);
      if (joint || ((x + (course % 2) * 6) % 12 === 0 && d > 0 && d < wall - 1)) color = tone(color, 0.78);
      if (rise <= 1) color = mix(P.frame, P.ornament, 0.45);
    } else if (style === 'asian') {
      color = tone(color, d === 1 ? 1.16 : d === 0 ? 0.82 : d === wall - 1 ? 0.8 : 0.94);
      if (rise <= 2 || rise >= S.FLOOR - 3) color = P.ornament;
      else if (rise === 3) color = tone(P.ornament, 0.7);
      else if (rise === 20 || rise === 21) color = tone(P.frame, 0.66);
    } else {
      color = tone(color, d === 0 ? 1.3 : d === wall - 1 ? 0.78 : 1);
      if (rise <= 1) color = tone(P.frame, 0.6);
      else if (rise % 8 === 0) color = tone(color, 0.84);
    }
    if (g === 0) color = tone(color, 0.9); else if (g === 15) color = tone(color, 1.08);
    return color;
  }
  // Floor slab colour (row 0 = walking surface).
  function slabColor(style, row, x, y) {
    const P = STYLES[style];
    const g = grain(x, y);
    let color;
    if (style === 'asian') color = row === 0 ? P.ornament : row === S.SLAB - 1 ? tone(P.frame, 0.55) : tone(P.frame, row === 1 ? 0.9 : 0.75);
    else if (style === 'gothic') color = row === 0 ? tone(P.frame, 1.22) : row === S.SLAB - 1 ? tone(P.frame, 0.62) : tone(P.frame, 0.92);
    else color = row === 0 ? [176, 178, 180] : row === S.SLAB - 1 ? tone(P.frame, 0.55) : tone(P.frame, 0.85);
    return g === 0 ? tone(color, 0.92) : color;
  }
  // Back (interior) wall colour behind units.
  function backWallColor(style, x, y, rise, left, right) {
    const P = STYLES[style];
    const base = tone(P.frame, 0.4);
    const g = grain(x, y);
    let color = base;
    if (style === 'asian') {
      // Dark lacquered panels between timber posts and rails.
      if ((x - left) % 28 < 3) color = tone(P.frame, 0.56);
      else if (rise === 12 || rise === 13 || rise === 30) color = tone(P.frame, 0.5);
    } else if (style === 'gothic') {
      const course = Math.floor(rise / 6);
      if (rise % 6 === 0 || (x + (course % 2) * 7) % 14 === 0) color = tone(P.frame, 0.32);
    } else {
      if ((x - left) % 16 === 0) color = tone(P.frame, 0.32);
      else if (rise === 4 || rise === 32) color = tone(P.frame, 0.34);
    }
    if (g < 2) color = tone(color, 0.92);
    return color;
  }

  // ---- Windows ---------------------------------------------------------------------------------
  // Back-wall window (decorative glass in the interior wall). Returns its width.
  function backWindow(c, style, x0, floorRow, lit) {
    const P = STYLES[style];
    const glass = (gx, gy, k = 1) => {
      const light = lit ? mix(GLASS_DARK, P.lamp, 0.42 + 0.12 * ((gy & 3) === 0)) : GLASS_DARK;
      back(c, gx, gy, tone(light, k));
    };
    const frame = (gx, gy) => back(c, gx, gy, tone(P.frame, 0.62));
    const trim = (gx, gy) => back(c, gx, gy, tone(P.ornament, 0.8));
    if (style === 'gothic') {
      // Pointed lancet with a mullion and a round tracery eye.
      const w = 13, h = 24, top = floorRow - 31;
      for (let dy = 0; dy < h; dy += 1) {
        const archHalf = dy < 7 ? Math.round(Math.sqrt(Math.max(0, 49 - (7 - dy) * (7 - dy))) * 0.9) : 6;
        for (let dx = -6; dx <= 6; dx += 1) {
          if (Math.abs(dx) > archHalf) continue;
          const edge = Math.abs(dx) >= archHalf - 1 || dy === h - 1;
          const gx = x0 + 6 + dx, gy = top + dy;
          if (edge) frame(gx, gy);
          else if (dx === 0 && dy > 8) trim(gx, gy);
          else if (dy >= 3 && dy <= 7 && Math.hypot(dx, dy - 5) < 2.6 && Math.hypot(dx, dy - 5) > 1.4) trim(gx, gy);
          else glass(gx, gy, dx < 0 && dy < 12 ? 1.12 : 1);
        }
      }
      return w;
    }
    if (style === 'asian') {
      // Square lattice window with a gold frame.
      const w = 18, h = 18, top = floorRow - 28;
      rect(c, x0, top, x0 + w - 1, top + h - 1, (gx, gy) => {
        const dx = gx - x0, dy = gy - top;
        if (dx < 2 || dy < 2 || dx >= w - 2 || dy >= h - 2) (dy < 2 || dy >= h - 2 ? trim : frame)(gx, gy);
        else if ((dx - 2) % 5 === 4 || (dy - 2) % 5 === 4) frame(gx, gy);
        else glass(gx, gy, dx < 8 && dy < 8 ? 1.1 : 1);
      });
      return w;
    }
    // Modern: tall glazed panel with a transom.
    const w = 14, h = 27, top = floorRow - 31;
    rect(c, x0, top, x0 + w - 1, top + h - 1, (gx, gy) => {
      const dx = gx - x0, dy = gy - top;
      if (dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1 || dy === 8) frame(gx, gy);
      else if (dx === 1 && dy < 7) back(c, gx, gy, SHINE);
      else glass(gx, gy, dx < 5 ? 1.08 : 1);
    });
    return w;
  }

  // ---- Furniture (back layer, never blocks units) -------------------------------------------------
  const FURNITURE = {
    bed(c, x, floor, P, flip) {
      const w = 30;
      rect(c, x, floor - 9, x + w - 1, floor - 1, (gx, gy) => {
        const dx = flip ? x + w - 1 - gx : gx - x, dy = floor - gy;
        if (dy <= 2 && (dx < 2 || dx > w - 3)) back(c, gx, gy, [70, 52, 36]);
        else if (dy <= 2) return;
        else if (dy <= 4) back(c, gx, gy, [96, 72, 50]);
        else if (dx < 7) back(c, gx, gy, dy > 7 ? [214, 210, 200] : [196, 192, 182]);
        else back(c, gx, gy, tone(mix(P.frame, [200, 200, 200], 0.35), dy > 7 ? 1.1 : 0.95));
      });
      rect(c, flip ? x + w - 3 : x, floor - 15, flip ? x + w - 1 : x + 2, floor - 3, (gx, gy) => back(c, gx, gy, [86, 62, 42]));
    },
    sofa(c, x, floor, P) {
      const w = 26, col = mix(P.frame, [120, 120, 130], 0.4);
      rect(c, x, floor - 12, x + w - 1, floor - 1, (gx, gy) => {
        const dx = gx - x, dy = floor - gy;
        if (dy <= 1) { if (dx < 2 || dx > w - 3) back(c, gx, gy, [40, 34, 30]); return; }
        if (dx < 3 || dx > w - 4) back(c, gx, gy, tone(col, dy > 8 ? 1.0 : 0.85));
        else if (dy > 7) back(c, gx, gy, tone(col, 0.92));
        else if (dy > 2) back(c, gx, gy, tone(col, (dx % 7 === 0) ? 0.8 : 1.12));
      });
    },
    table(c, x, floor) {
      rect(c, x, floor - 12, x + 21, floor - 11, (gx, gy) => back(c, gx, gy, [122, 90, 60]));
      for (const lx of [x + 2, x + 19]) rect(c, lx, floor - 10, lx + 1, floor - 1, (gx, gy) => back(c, gx, gy, [84, 62, 42]));
      back(c, x + 8, floor - 13, [210, 210, 196]); back(c, x + 9, floor - 13, [210, 210, 196]);
      back(c, x + 14, floor - 14, [96, 150, 200]); back(c, x + 14, floor - 13, [96, 150, 200]);
    },
    chair(c, x, floor, P, flip) {
      const col = [104, 76, 52];
      rect(c, x, floor - 8, x + 7, floor - 7, (gx, gy) => back(c, gx, gy, col));
      rect(c, flip ? x + 6 : x, floor - 17, flip ? x + 7 : x + 1, floor - 1, (gx, gy) => back(c, gx, gy, tone(col, 0.85)));
      rect(c, flip ? x : x + 6, floor - 6, flip ? x + 1 : x + 7, floor - 1, (gx, gy) => back(c, gx, gy, tone(col, 0.85)));
    },
    shelf(c, x, floor) {
      rect(c, x, floor - 30, x + 15, floor - 1, (gx, gy) => {
        const dx = gx - x, dy = floor - gy;
        if (dx < 1 || dx > 14 || dy % 8 === 0 || dy > 29) back(c, gx, gy, [92, 66, 44]);
        else {
          const book = (PW.hash2(gx, Math.floor(dy / 8)) % 5);
          const colors = [[150, 60, 50], [60, 90, 130], [190, 160, 80], [70, 110, 70], [120, 80, 120]];
          if (dy % 8 > 6 - (PW.hash2(gx, 3) & 1)) back(c, gx, gy, tone(colors[book], 0.4));
          else back(c, gx, gy, colors[book]);
        }
      });
    },
    plant(c, x, floor) {
      rect(c, x + 2, floor - 6, x + 9, floor - 1, (gx, gy) => back(c, gx, gy, gy === floor - 6 ? [150, 92, 60] : [124, 74, 48]));
      for (let i = 0; i < 70; i += 1) {
        const a = (PW.hash2(x, i) & 1023) / 1023 * Math.PI, r = 3 + (PW.hash2(i, x) % 7);
        const lx = Math.round(x + 6 + Math.cos(a) * r * 0.9), ly = Math.round(floor - 8 - Math.sin(a) * r * 1.4);
        back(c, lx, ly, (i & 3) === 0 ? [92, 140, 70] : [58, 102, 52]);
      }
    },
    tv(c, x, floor) {
      rect(c, x + 7, floor - 8, x + 10, floor - 1, (gx, gy) => back(c, gx, gy, [40, 40, 44]));
      rect(c, x, floor - 20, x + 17, floor - 9, (gx, gy) => {
        const dx = gx - x, dy = gy - (floor - 20);
        back(c, gx, gy, dx === 0 || dy === 0 || dx === 17 || dy === 11 ? [30, 30, 34] : dy < 4 ? [110, 170, 220] : [70, 120, 170]);
      });
    },
    lampStand(c, x, floor, P) {
      rect(c, x + 2, floor - 26, x + 2, floor - 1, (gx, gy) => back(c, gx, gy, [70, 70, 72]));
      rect(c, x, floor - 31, x + 4, floor - 27, (gx, gy) => back(c, gx, gy, mix(P.lamp, [255, 255, 255], 0.2)));
      c.lamps.push({ x: x + 2, y: floor - 29, radius: 20, strength: 0.32 });
    },
    kitchen(c, x, floor) {
      rect(c, x, floor - 14, x + 31, floor - 1, (gx, gy) => {
        const dx = gx - x, dy = floor - gy;
        back(c, gx, gy, dy === 14 ? [190, 190, 186] : dy > 12 ? [150, 150, 146] : dx % 10 === 0 ? [92, 92, 96] : [124, 124, 128]);
      });
      // Kettle and a pot on the counter (no wall cabinets, so windows stay clear).
      rect(c, x + 6, floor - 19, x + 11, floor - 15, (gx, gy) => back(c, gx, gy, gy === floor - 19 ? [70, 70, 74] : [176, 60, 50]));
      rect(c, x + 20, floor - 18, x + 27, floor - 15, (gx, gy) => back(c, gx, gy, [150, 152, 156]));
    },
    crate(c, x, floor) {
      rect(c, x, floor - 18, x + 17, floor - 1, (gx, gy) => {
        const dx = gx - x, dy = floor - 1 - gy;
        const edge = dx < 2 || dx > 15 || dy < 2 || dy > 15;
        const brace = Math.abs(dx - dy) < 1.5 || Math.abs(dx + dy - 17) < 1.5;
        back(c, gx, gy, edge ? [92, 98, 60] : brace ? [104, 110, 66] : [74, 80, 50]);
      });
    },
    console(c, x, floor) {
      rect(c, x, floor - 14, x + 23, floor - 1, (gx, gy) => back(c, gx, gy, (gy - floor) % 5 === 0 ? [52, 58, 64] : [66, 72, 80]));
      rect(c, x + 2, floor - 24, x + 21, floor - 15, (gx, gy) => {
        const dx = gx - x - 2, dy = gy - (floor - 24);
        back(c, gx, gy, dx === 0 || dy === 0 || dx === 19 || dy === 9 ? [40, 44, 48] : (dx + dy) % 7 === 0 ? [200, 255, 210] : SCREEN);
      });
    },
    rack(c, x, floor) {
      rect(c, x, floor - 28, x + 19, floor - 1, (gx, gy) => {
        const dx = gx - x, dy = floor - gy;
        if (dx < 1 || dx > 18 || dy === 28 || dy === 1) back(c, gx, gy, [70, 74, 78]);
        else if (dx % 4 === 2 && dy > 4 && dy < 25) back(c, gx, gy, [40, 42, 44]);
        else back(c, gx, gy, [52, 56, 60]);
      });
    },
    locker(c, x, floor) {
      rect(c, x, floor - 30, x + 11, floor - 1, (gx, gy) => {
        const dx = gx - x, dy = floor - gy;
        back(c, gx, gy, dx === 0 || dx === 11 || dx === 6 ? [80, 88, 92] : dy % 6 === 3 && dx > 1 ? [70, 76, 80] : [104, 112, 118]);
      });
    },
    sacks(c, x, floor) {
      for (let i = 0; i < 3; i += 1) {
        const sx = x + i * 9 + (i === 2 ? -4 : 0), sy = i === 2 ? floor - 9 : floor;
        rect(c, sx, sy - 9, sx + 9, sy - 1, (gx, gy) => {
          const dx = gx - sx - 4.5, dy = gy - (sy - 5);
          if (dx * dx / 25 + dy * dy / 20 <= 1) back(c, gx, gy, dy < -1 ? [206, 186, 140] : [178, 158, 116]);
        });
      }
    },
    barrel(c, x, floor) {
      rect(c, x, floor - 14, x + 9, floor - 1, (gx, gy) => {
        const dx = gx - x, dy = floor - gy;
        back(c, gx, gy, dy === 3 || dy === 11 ? [60, 60, 62] : dx < 3 ? [126, 86, 52] : dx > 7 ? [86, 58, 36] : [108, 74, 46]);
      });
    },
  };

  // Ceiling light: the fixture plus a soft cone of light on the back wall below it.
  function ceilingLamp(c, style, x, ceilingRow) {
    const P = STYLES[style];
    rect(c, x - 3, ceilingRow, x + 3, ceilingRow + 1, (gx, gy) => back(c, gx, gy, [60, 60, 64]));
    rect(c, x - 2, ceilingRow + 2, x + 2, ceilingRow + 2, (gx, gy) => back(c, gx, gy, mix(P.lamp, [255, 255, 255], 0.3)));
    c.lamps.push({ x, y: ceilingRow + 2, radius: 34, strength: 0.5 });
  }
  // Apply every lamp's light to the back layer (a quantised, dithered falloff keeps whole cells).
  function bakeLights(c, style) {
    const P = STYLES[style];
    for (const lamp of c.lamps) {
      const r = lamp.radius;
      for (let y = Math.floor(lamp.y - r * 0.4); y <= lamp.y + r; y += 1) {
        for (let x = Math.floor(lamp.x - r); x <= lamp.x + r; x += 1) {
          if (!inside(c, x, y)) continue;
          const i = y * c.width + x;
          if (!c.back[i] || c.mat[i]) continue;
          const dy = y - lamp.y, dx = x - lamp.x;
          const d = Math.hypot(dx, dy * (dy < 0 ? 2.5 : 1)) / r;
          if (d >= 1) continue;
          const k = (1 - d) * (1 - d) * lamp.strength + ((x * 7 + y * 3) % 4) * 0.012;
          const color = PW.unpack(c.back[i]);
          c.back[i] = pack(mix(color, P.lamp, Math.min(0.75, k)));
        }
      }
    }
  }

  // Buried amber core in its cradle (part of the structure, under the building).
  function core(c, cx, cy) {
    const r = 4;
    rect(c, cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, (x, y) => {
      const dx = x - cx, dy = y - cy;
      if (Math.abs(dx) <= r && Math.abs(dy) <= r) {
        const k = 1.25 - (dx + dy + 8) / 16 * 0.45;
        solid(c, x, y, M.CORE, tone(CORE_COLOR, k), ROLE.CORE);
      } else if (dy > r || Math.abs(dx) > r && dy >= 0) {
        solid(c, x, y, M.FOUNDATION, tone(CORE_SHADE, 0.9 + (grain(x, y) & 1) * 0.1), ROLE.CRADLE);
      }
    });
    c.cores.push({ x: cx, y: cy });
  }

  PW.buildingKit = {
    S, STYLES, ROLE, CORE_COLOR, CORE_SHADE, BEACON, SCREEN, GLASS_DARK, GLASS_SIDE, SHINE,
    tone, mix, pack, grain, clamp255,
    createCanvas, inside, solid, solidIfEmpty, clear, back, backIfEmpty, deco, isSolid, rect, bitmap,
    wallColor, slabColor, backWallColor, backWindow, FURNITURE, ceilingLamp, bakeLights, core,
  };
})();
