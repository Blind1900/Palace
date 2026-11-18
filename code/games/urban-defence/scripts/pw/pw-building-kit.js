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
    CORE: 8, CRADLE: 9, CROWN: 10, VAULT: 11, FRAME: 12, BRIDGE: 13, PROP: 14, GRATE: 15 });

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
          c.back[i] = pack(mix(color, lamp.color || P.lamp, Math.min(0.75, k)));
        }
      }
    }
  }

  // ---- Cores ------------------------------------------------------------------------------------------
  // A building's core: a glowing amber orb held between two reactor stacks of diamond-plate rings
  // whose joints glow, gripped by clamp arms reaching in from above (after the refs: an energy core
  // in its clamps, a ringed reactor column, a dark armoured housing round a glowing heart). It is
  // kept simple and unmistakable: the brightest thing in the building, in one amber for every side.
  // Under a building it stands in an armoured steel vault below the ground floor, under a grating
  // its glow shows through; when the building is ruined the grating is blown off and the vault
  // lies open, so troops can reach the core and hit it (see pw-cores.js). `standing`: on a floor
  // (a hangar's) instead of in a vault.
  const CORE_HOT = [255, 240, 186], CORE_RIM = [206, 98, 8];
  const PLATE = [112, 118, 126], PLATE_LIT = [156, 162, 170], PLATE_DARK = [66, 70, 78], PLATE_BUMP = [176, 182, 190];
  const ARMOUR = [58, 60, 66], ARMOUR_LIT = [84, 88, 96], HAZARD = [230, 184, 40];
  const VAULT = Object.freeze({ half: 11, height: 30, wall: 3, lid: 2 });
  const VAULT_DEPTH = VAULT.lid + VAULT.height + VAULT.wall;   // rows under the ground floor
  // The column, from its bottom row `b` up 30 rows: ring, glow, ring, glow, neck, orb (r 5), neck,
  // glow, ring, glow, ring. Returns the orb's centre row.
  function coreColumn(c, cx, b) {
    const ring = (y0, rows, half) => {
      for (let r = 0; r < rows; r += 1) for (let dx = -half; dx <= half; dx += 1) {
        const x = cx + dx, y = y0 - r;
        const edge = Math.abs(dx) === half, top = r === rows - 1, bottom = r === 0;
        const bump = ((x + y) & 3) === 0 && ((x - y) & 3) === 2;
        solid(c, x, y, M.STEEL, edge ? PLATE_DARK : top ? PLATE_LIT : bottom ? PLATE_DARK : bump ? PLATE_BUMP : PLATE, ROLE.CRADLE);
      }
    };
    const glow = (y, half) => {
      for (let dx = -half; dx <= half; dx += 1) solid(c, cx + dx, y, M.CORE, (dx + y) % 3 === 0 ? CORE_HOT : CORE_COLOR, ROLE.CORE);
    };
    ring(b, 3, 8); glow(b - 3, 7); ring(b - 4, 3, 7); glow(b - 7, 6); ring(b - 8, 2, 4);
    const r = 5, oy = b - 15;
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > r + 0.3) continue;
      // White-hot where the light catches it, amber, deepening to the rim; a swirl in the glow.
      const hot = Math.hypot(dx + 1.6, dy + 1.6) < 1.8;
      const swirl = ((cx + dx) * 3 + (oy + dy) * 5) % 7 === 0;
      solid(c, cx + dx, oy + dy, M.CORE, hot ? CORE_HOT : mix(swirl ? tone(CORE_COLOR, 1.15) : CORE_COLOR, CORE_RIM, Math.max(0, d / r - 0.45) * 1.4), ROLE.CORE);
    }
    ring(b - 21, 2, 4); glow(b - 23, 5); ring(b - 24, 3, 6); glow(b - 27, 7); ring(b - 28, 2, 8);
    c.lamps.push({ x: cx, y: oy, radius: 34, strength: 0.75, color: CORE_COLOR });
    return oy;
  }
  // The core and its foundational bed (the user's design): two perfect squares, nothing fussy.
  // The BED is the plain square frame that carries the machinery - the connector socket on either
  // side (the resource bundle docks there in step E) and the translator nozzle on top (it grows
  // the building's pillar in F2). The CORE is the perfect square set in its middle that powers
  // it: the dead god machine's black tendrils curling about one white point - black and white,
  // nothing else. Stands on the vault floor `b`; returns the core's centre row.
  const INK = [8, 8, 10], INK_DEEP = [40, 40, 44], WHITE_CORE = [238, 242, 246], WHITE_DIM = [152, 158, 164];
  function coreUnit(c, cx, b) {
    const oy = b - 10;   // the bed: a perfect square, 21 x 21, flush on the floor
    for (let dy = -10; dy <= 10; dy += 1) for (let dx = -10; dx <= 10; dx += 1) {
      const edge = Math.abs(dx) === 10 || Math.abs(dy) === 10;
      solid(c, cx + dx, oy + dy, M.STEEL, edge ? PLATE_DARK : dy === -9 ? PLATE_LIT : PLATE, ROLE.CRADLE);
    }
    // The core: a perfect square set in the bed's middle, the tendrils gripping the white point.
    for (let dy = -6; dy <= 6; dy += 1) for (let dx = -6; dx <= 6; dx += 1) {
      const rim = Math.abs(dx) === 6 || Math.abs(dy) === 6;
      solid(c, cx + dx, oy + dy, M.CORE, rim ? ARMOUR : dy === -5 ? INK : INK_DEEP, ROLE.CORE);
    }
    for (let k = 0; k < 4; k += 1) {
      const a0 = k * Math.PI / 2 + 0.78;
      for (let t = 0; t <= 10; t += 1) {
        const r = 7 - t * 0.56, a = a0 + t * 0.3;
        const x = cx + Math.round(Math.cos(a) * r), y = oy + Math.round(Math.sin(a) * r * 0.92);
        if (Math.abs(x - cx) > 5 || Math.abs(y - oy) > 5) continue;
        solid(c, x, y, M.CORE, t === 8 ? WHITE_DIM : INK, ROLE.CORE);
        // (each strand is two cells thick for most of its reach, so it reads as an arm, not grit)
        if (t < 7) solid(c, x + (Math.abs(x + 1 - cx) <= 5 ? 1 : -1), y, M.CORE, INK, ROLE.CORE);
      }
    }
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) solid(c, cx + dx, oy + dy, M.CORE, WHITE_CORE, ROLE.CORE);
    for (const [dx, dy] of [[-1, 0], [2, 0], [0, -1], [1, 2]]) solid(c, cx + dx, oy + dy, M.CORE, WHITE_DIM, ROLE.CORE);
    // The bed's connectors, left and right: a plain socket with a white port point.
    for (const side of [-1, 1]) {
      for (let dy = -3; dy <= 3; dy += 1) for (let d = 11; d <= 13; d += 1) {
        solid(c, cx + side * d, oy + dy, M.STEEL, Math.abs(dy) === 3 || d === 13 ? PLATE_DARK : ARMOUR, ROLE.CRADLE);
      }
      solid(c, cx + side * 12, oy, M.CORE, WHITE_DIM, ROLE.CORE);
    }
    // The bed's translator on top: a plain nozzle with a white slot down its middle.
    for (let y = b - 25; y <= b - 21; y += 1) for (let dx = -5; dx <= 5; dx += 1) {
      const slot = Math.abs(dx) <= 2 && y >= b - 24;
      solid(c, cx + dx, y, slot ? M.CORE : M.STEEL,
        slot ? ((y + dx) & 1 ? WHITE_CORE : WHITE_DIM) : y === b - 25 || Math.abs(dx) === 5 ? PLATE_DARK : PLATE,
        slot ? ROLE.CORE : ROLE.CRADLE);
    }
    c.lamps.push({ x: cx, y: oy, radius: 20, strength: 0.5, color: WHITE_CORE });
    return oy;
  }
  function core(c, cx, floor, options = {}) {
    if (options.standing) {
      const oy = coreColumn(c, cx, floor - 1);
      c.cores.push({ x: cx, y: oy, standing: true });
      return;
    }
    const { half, height, wall, lid } = VAULT;
    const top = floor + lid, bottom = top + height - 1;
    // The vault: armour walls and floor, dark ribbed panels inside, a hazard band along its rim.
    rect(c, cx - half - wall, floor, cx + half + wall, bottom + wall, (x, y) => {
      const inner = Math.abs(x - cx) <= half && y <= bottom;
      if (inner && y < top) return;
      if (inner) { back(c, x, y, (x - cx + half) % 6 === 0 ? [36, 38, 46] : [24, 26, 32]); return; }
      const rim = y === floor || y === floor + 1;
      const hazard = rim && ((x + y) >> 1 & 1) === 0;
      solid(c, x, y, M.STEEL, hazard ? HAZARD : rim ? [40, 40, 44] : (Math.abs(x - cx) === half + 1 || y === bottom + 1) ? ARMOUR_LIT : ARMOUR, ROLE.CRADLE);
    });
    // The grating over it, flush with the floor: troops walk on it, and the core's glow comes up
    // through its slots.
    for (let x = cx - half; x <= cx + half; x += 1) {
      solid(c, x, floor, M.PLATFORM, (x & 1) ? [92, 96, 104] : tone(WHITE_CORE, 0.55), ROLE.GRATE);
      solid(c, x, floor + 1, M.PLATFORM, (x % 4 === 0) ? [70, 74, 82] : [104, 108, 116], ROLE.GRATE);
    }
    const oy = coreUnit(c, cx, bottom);
    c.cores.push({ x: cx, y: oy, kind: 'descendant', vault: { x0: cx - half, x1: cx + half, top, bottom, lid: floor } });
  }

  // F2 (the user's support hierarchy): each core's translator grows the building's MAIN PILLAR -
  // the primary support that holds the structure up. Floors tie pillar to pillar; back and side
  // walls are secondary. Stamped over the finished body: a 3-wide column rising from the vault's
  // grating to the roof over it, filling the open cells of each storey and leaving every floor,
  // stair, wall and fitting exactly as drawn (the pillar shows in the rooms, behind nothing).
  function corePillars(c, style) {
    const s = STYLES[style] || STYLES.modern;
    for (const core of c.cores || []) {
      if (core.standing || !core.vault) continue;
      const lid = core.vault.lid;
      // The roof over this pillar: walk up from the grating; past 8 open rows it is sky.
      let top = lid;
      for (let y = lid - 1; y >= 0 && top - y <= 8; y -= 1) {
        for (let dx = -2; dx <= 2; dx += 1) if (isSolid(c, core.x + dx, y)) { top = y; break; }
      }
      if (top >= lid - 2) continue;   // nothing standing over this core
      for (let y = top + 1; y < lid; y += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = core.x + dx;
          if (isSolid(c, x, y)) continue;
          // A capital and base where the pillar meets a slab; darker flutes at the edges.
          const joint = isSolid(c, x, y - 1) || isSolid(c, x, y + 1);
          const color = tone(dx === 0 ? s.frame : s.trim, (joint ? 1.18 : 1) * (grain(x, y) < 3 ? 0.9 : 1));
          solid(c, x, y, M.PILLAR, color, ROLE.FRAME);
        }
      }
    }
    // The space between the cores is no bare earth: a reinforced concrete gallery ties bed to
    // bed, military-grade - the vaults' hazard-banded rim runs on across it, poured concrete in
    // shuttering courses below, bolted at the joints. And it RADIATES from the cores (the user's
    // rule: the cores create everything): finished god-metal at each bed, roughening and
    // earthening toward the middle of the span; a dashed ink circuit trace runs bed to bed with
    // the odd white point in it, and every bolt carries a little down-pointed spear tip - the
    // god's mark, kept subtle. The bundle sleeves through it, and in a collapse it breaks to
    // concrete debris like any foundation.
    const vaults = (c.cores || []).filter((k) => !k.standing && k.vault).sort((p, q) => p.x - q.x);
    for (let i = 0; i + 1 < vaults.length; i += 1) {
      const a = vaults[i].vault, b2 = vaults[i + 1].vault;
      const x0 = a.x1 + VAULT.wall + 2, x1 = b2.x0 - VAULT.wall - 2;
      if (x1 - x0 < 2 || a.lid !== b2.lid) continue;
      const yTop = a.lid, yBot = Math.max(a.bottom, b2.bottom) + 10;
      const halfSpan = Math.max(1, (x1 - x0) / 2);
      for (let y = yTop; y <= yBot; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (isSolid(c, x, y)) continue;
          if (y <= yTop + 1) {
            // the capping course: the vaults' rim carried across, hazard chevrons and all
            const hazard = y === yTop && ((x + y) >> 1 & 1) === 0;
            solid(c, x, y, M.STEEL, hazard ? HAZARD : [40, 40, 44], ROLE.CRADLE);
            continue;
          }
          // 1 against a bed, 0 midway between them: the finish radiates outward from the cores.
          const t = 1 - Math.min(x - x0, x1 - x) / halfSpan;
          if (y === yTop + 6 && (x - x0) % 3 !== 2) {
            solid(c, x, y, M.FOUNDATION, (x & 15) === 8 ? WHITE_DIM : INK, ROLE.VAULT);
            continue;
          }
          const course = (y - yTop) % 8 === 0, seam = ((x - x0) % 14) === 0;
          const bolt = course && seam, tip = (y - yTop) % 8 === 1 && seam;
          const rough = grain(x, y) < 3 + (1 - t) * 5;
          const color = bolt ? PLATE_LIT
            : tip ? [20, 22, 26]
            : course && t > 0.35 ? [64, 67, 73]
            : seam && t > 0.35 ? [78, 81, 87]
            : mix(tone([96, 100, 106], rough ? 0.88 : 1), [92, 86, 72], (1 - t) * 0.45);
          solid(c, x, y, M.FOUNDATION, color, ROLE.VAULT);
        }
      }
    }
    // (the roots under each bed are world-side work - the canvas ends at the bed's underside;
    // see PW.foundations.coreRoots, called on placement and on growth)
  }

  PW.buildingKit = {
    S, STYLES, ROLE, CORE_COLOR, CORE_SHADE, BEACON, SCREEN, GLASS_DARK, GLASS_SIDE, SHINE,
    tone, mix, pack, grain, clamp255,
    createCanvas, inside, solid, solidIfEmpty, clear, back, backIfEmpty, deco, isSolid, rect, bitmap,
    wallColor, slabColor, backWallColor, backWindow, FURNITURE, ceilingLamp, bakeLights, core, coreColumn, coreUnit, corePillars,
    VAULT, VAULT_DEPTH, CORE_HOT,
  };
})();
