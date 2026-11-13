'use strict';
// Roof ornaments, crowns and rooftop devices for the three faction styles, drawn at native scale.
(function () {
  const PW = window.PW;
  const { M } = PW;
  const K = PW.buildingKit;
  const { STYLES, ROLE, tone, mix, BEACON } = K;

  const CROWNS = Object.freeze({ modern: ['broadcast', 'needle', 'dish'], gothic: ['spire', 'belfry', 'triple'],
    asian: ['dragon', 'pillar', 'twin'] });
  function crownFor(style, key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    return CROWNS[style][(h >>> 0) % 3];
  }

  // Ornament cell (structural, so it falls with the building). Shade by side for a lit look.
  function orn(c, x, y, color, role = ROLE.ORNAMENT, mat = M.STEEL) {
    K.solid(c, x, y, mat, color, role);
  }
  function lit(color, dx, half) {
    const t = half ? dx / half : 0;
    return tone(color, t < -0.3 ? 1.16 : t > 0.45 ? 0.78 : 1);
  }
  // Filled column of half-width `half` from row y0 up to y1 (y1 < y0).
  function column(c, cx, y0, y1, half, color, role = ROLE.CROWN, mat = M.STEEL) {
    for (let y = y0; y >= y1; y -= 1) for (let dx = -half; dx <= half; dx += 1) orn(c, cx + dx, y, lit(color, dx, half), role, mat);
  }

  // ---- Roof ornaments ------------------------------------------------------------------------------
  function roof(c, style, spans, roofs, floorRow, random) {
    const P = STYLES[style];
    if (style === 'asian') {
      for (const r of roofs) {
        const reach = r.top ? 16 : 10;
        if (!r.top && r.side) asianEave(c, P, r.side < 0 ? r.left : r.right, r.y, r.side, reach);
        if (r.top) { asianEave(c, P, r.left, r.y, -1, reach); asianEave(c, P, r.right, r.y, 1, reach); }
      }
      // Pagoda flares on every second storey line.
      for (let k = 2; k < spans.length; k += 2) {
        const span = spans[k], below = spans[k - 1];
        if (!below || span.left !== below.left) continue;
        asianEave(c, P, span.left, floorRow(k), -1, 8);
        asianEave(c, P, span.right, floorRow(k), 1, 8);
      }
    } else if (style === 'gothic') {
      for (const r of roofs) {
        if (r.top) {
          for (let x = r.left + 2; x <= r.right - 2; x += 1) {
            const t = (x - r.left) % 14;
            if (t < 7) for (let dy = 1; dy <= 7; dy += 1) orn(c, x, r.y - dy, tone(P.frame, t === 0 ? 1.15 : t === 6 ? 0.82 : 1), ROLE.ORNAMENT, M.MASONRY);
            orn(c, x, r.y - 1, tone(P.frame, 0.9), ROLE.ORNAMENT, M.MASONRY);
          }
        }
        for (const x of r.side ? [r.side < 0 ? r.left + 4 : r.right - 4] : [r.left + 4, r.right - 4]) gothicPinnacle(c, P, x, r.y - 1, r.top ? 30 : 22);
      }
    } else {
      for (const r of roofs) {
        for (let x = r.left; x <= r.right; x += 1) {
          if ((x - r.left) % 12 === 0 || x === r.right) for (let dy = 1; dy <= 6; dy += 1) orn(c, x, r.y - dy, [150, 158, 166]);
          orn(c, x, r.y - 6, [176, 184, 190]);
        }
        for (const x of [r.left, r.right]) for (let dy = 1; dy <= 9; dy += 1) orn(c, x, r.y - dy, tone(P.frame, 1.2));
      }
      const top = roofs.find((r) => r.top);
      if (top && top.right - top.left > 70) modernPlantRoom(c, P, top.right - 44, top.y - 1);
    }
  }
  function asianEave(c, P, wallX, slabRow, side, reach) {
    for (let i = 1; i <= reach; i += 1) {
      const x = wallX + side * i;
      const lift = i > reach - 5 ? i - (reach - 5) : 0;
      const thickness = Math.max(2, 5 - Math.floor(i / 5));
      for (let t = 0; t < thickness; t += 1) {
        const y = slabRow - 1 - lift + t;
        const color = t === 0 ? (i % 3 === 0 ? P.roofLight : P.roof) : t === thickness - 1 ? P.trim : tone(P.roof, 0.85);
        orn(c, x, y, color, ROLE.ORNAMENT, M.TILE);
      }
      if (i === reach) { orn(c, x, slabRow - 2 - lift, P.ornament); orn(c, x + side, slabRow - 3 - lift, P.ornament); }
    }
    // Red bracket under the eave.
    for (let i = 1; i < Math.min(5, reach); i += 1) orn(c, wallX + side * i, slabRow + 3 + Math.floor(i / 2), P.frame, ROLE.ORNAMENT, M.WOOD);
  }
  function gothicPinnacle(c, P, cx, baseRow, height) {
    const stone = P.frame;
    for (let dy = 0; dy < 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) orn(c, cx + dx, baseRow - dy, lit(stone, dx, 4), ROLE.ORNAMENT, M.MASONRY);
    const shaft = Math.round(height * 0.35);
    for (let dy = 4; dy < 4 + shaft; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const slit = dx === 0 && dy > 5 && dy < 4 + shaft - 2;
      orn(c, cx + dx, baseRow - dy, slit ? tone(stone, 0.5) : lit(stone, dx, 2), ROLE.ORNAMENT, M.MASONRY);
    }
    const spire = height - 4 - shaft;
    for (let dy = 0; dy < spire; dy += 1) {
      const half = Math.round(2 * (1 - dy / spire));
      for (let dx = -half; dx <= half; dx += 1) orn(c, cx + dx, baseRow - 4 - shaft - dy, lit(tone(stone, 1.05), dx, Math.max(1, half)), ROLE.ORNAMENT, M.MASONRY);
      if (dy % 5 === 2 && half > 0) { orn(c, cx - half - 1, baseRow - 4 - shaft - dy, P.ornament); orn(c, cx + half + 1, baseRow - 4 - shaft - dy, tone(P.ornament, 0.8)); }
    }
    orn(c, cx, baseRow - height, P.ornament); orn(c, cx, baseRow - height - 1, P.ornament);
  }
  function modernPlantRoom(c, P, x0, baseRow) {
    for (let dy = 0; dy < 16; dy += 1) for (let dx = 0; dx < 34; dx += 1) {
      const vent = dy > 4 && dy < 12 && dx > 18 && dx < 31 && dy % 2 === 0;
      const door = dx > 4 && dx < 11 && dy < 12;
      orn(c, x0 + dx, baseRow - dy, door ? [60, 66, 74] : vent ? [86, 92, 100] : dy === 15 ? [176, 184, 190] : tone([132, 140, 148], dx < 2 ? 1.15 : 1),
        ROLE.ORNAMENT, M.CONCRETE);
    }
  }

  // ---- Crowns ------------------------------------------------------------------------------------------
  function crown(c, style, name, cx, baseRow, L, random) {
    const P = STYLES[style];
    const fn = CROWN_DRAW[name];
    if (fn) fn(c, P, cx, baseRow, L, random);
  }
  const STEEL = [150, 158, 168], STEEL_DARK = [96, 104, 112], GOLD = [226, 178, 64];
  const CROWN_DRAW = {
    broadcast(c, P, cx, y, L) {
      column(c, cx, y, y - 2, 9, [170, 176, 182], ROLE.CROWN, M.CONCRETE);
      column(c, cx, y - 3, y - 5, 6, [150, 156, 162], ROLE.CROWN, M.CONCRETE);
      let top = y - 6;
      const lower = Math.round(L * 0.28);
      column(c, cx, top, top - lower, 2, STEEL);
      const armY = top - Math.round(lower * 0.6);
      for (let dx = -12; dx <= 12; dx += 1) orn(c, cx + dx, armY, STEEL_DARK, ROLE.CROWN);
      for (const s of [-1, 1]) for (let dy = -3; dy <= 3; dy += 1) for (let dx = 0; dx < 3; dx += 1) {
        if (Math.abs(dy) <= 3 - dx) orn(c, cx + s * (12 + dx), armY + dy, dx === 0 ? [210, 216, 222] : STEEL, ROLE.CROWN);
      }
      top -= lower + 1;
      const lattice = (h, half) => {
        for (let dy = 0; dy < h; dy += 1) for (let dx = -half; dx <= half; dx += 1) {
          const edge = Math.abs(dx) === half;
          const brace = (dy + dx + 60) % (half + 1) === 0 || (dy - dx + 60) % (half + 1) === 0;
          if (edge || brace || dy % 9 === 0) orn(c, cx + dx, top - dy, edge ? STEEL : STEEL_DARK, ROLE.CROWN);
        }
        top -= h;
      };
      lattice(Math.round(L * 0.18), 5);
      column(c, cx, top, top - Math.round(L * 0.16), 2, STEEL); top -= Math.round(L * 0.16) + 1;
      lattice(Math.round(L * 0.1), 3);
      const whip = Math.max(9, y - L - 6 > top ? 9 : top - (y - L - 6));
      for (let dy = 0; dy < whip; dy += 1) orn(c, cx, top - dy, dy < 2 ? BEACON : [200, 206, 212], ROLE.CROWN);
      orn(c, cx, top - whip, BEACON);
    },
    needle(c, P, cx, y, L) {
      let top = y;
      const tierH = Math.max(6, Math.round(L * 0.13));
      [9, 6, 3].forEach((half, tier) => {
        for (let dy = 0; dy < tierH; dy += 1) for (let dx = -half; dx <= half; dx += 1) {
          const glass = dy % 6 === 3 && Math.abs(dx) < half;
          orn(c, cx + dx, top - dy, glass ? mix(K.GLASS_SIDE, P.lamp, 0.5) : lit(tone(P.frame, 1.1 - tier * 0.05), dx, half), ROLE.CROWN, M.CONCRETE);
        }
        top -= tierH;
      });
      const mast = Math.max(12, L - tierH * 3);
      for (let dy = 0; dy < mast; dy += 1) { orn(c, cx, top - dy, dy < 3 ? BEACON : STEEL); if (dy < mast * 0.5) orn(c, cx + 1, top - dy, STEEL_DARK); }
    },
    dish(c, P, cx, y, L) {
      for (let dy = 0; dy < 4; dy += 1) for (let dx = -19; dx <= 19; dx += 1) orn(c, cx + dx, y - dy, dy === 3 ? [184, 190, 196] : [140, 146, 152], ROLE.CROWN, M.CONCRETE);
      column(c, cx, y - 4, y - 12, 2, STEEL);
      for (let dx = -12; dx <= 12; dx += 1) {
        const depth = Math.round((dx * dx) / 24);
        for (let t = 0; t < 2; t += 1) orn(c, cx + dx, y - 13 - (6 - depth) + t, t ? STEEL_DARK : [214, 220, 226]);
      }
      orn(c, cx, y - 20, STEEL); orn(c, cx, y - 21, STEEL); orn(c, cx, y - 22, BEACON);
      for (const [dx, h] of [[-16, 0.85], [16, 0.55]]) {
        const mh = Math.round(L * h);
        for (let dy = 4; dy < mh; dy += 1) orn(c, cx + dx, y - dy, dy > mh - 3 ? BEACON : [200, 206, 212]);
      }
    },
    spire(c, P, cx, y, L) {
      const stone = P.frame;
      column(c, cx, y, y - 5, 10, tone(stone, 1.05), ROLE.CROWN, M.MASONRY);
      const body = Math.max(18, L - 36);
      for (let dy = 0; dy < body; dy += 1) {
        const half = Math.max(0, Math.round(6 * (1 - dy / body)));
        for (let dx = -half; dx <= half; dx += 1) orn(c, cx + dx, y - 6 - dy, lit(stone, dx, Math.max(1, half)), ROLE.CROWN, M.MASONRY);
        if (dy % 9 === 4 && half > 0) { orn(c, cx - half - 1, y - 6 - dy, P.ornament); orn(c, cx + half + 1, y - 6 - dy, tone(P.ornament, 0.8)); }
      }
      angel(c, P, cx, y - 6 - body);
    },
    belfry(c, P, cx, y, L) {
      const stone = P.frame;
      column(c, cx, y, y - 3, 13, tone(stone, 1.05), ROLE.CROWN, M.MASONRY);
      const shaft = Math.round(L * 0.25);
      for (let dy = 0; dy < shaft; dy += 1) for (let dx = -10; dx <= 10; dx += 1) {
        const lancet = Math.abs(dx) <= 2 && dy > 4 && dy < shaft - 3;
        orn(c, cx + dx, y - 4 - dy, lancet ? tone(stone, 0.45) : lit(stone, dx, 10), ROLE.CROWN, M.MASONRY);
      }
      let top = y - 4 - shaft;
      for (let dy = 0; dy < 21; dy += 1) {
        for (const dx of [-10, -9, -8, 8, 9, 10]) orn(c, cx + dx, top - dy, lit(stone, dx, 10), ROLE.CROWN, M.MASONRY);
        if (dy > 15) for (let dx = -7; dx <= 7; dx += 1) if (Math.abs(dx) > (dy - 15) * 1.6) orn(c, cx + dx, top - dy, tone(stone, 0.95), ROLE.CROWN, M.MASONRY);
      }
      // The bell hangs in the open chamber.
      for (let dy = 0; dy < 9; dy += 1) {
        const half = Math.round(1 + dy * 0.45);
        for (let dx = -half; dx <= half; dx += 1) orn(c, cx + dx, top - 15 + dy, lit([196, 160, 72], dx, half));
      }
      top -= 21;
      column(c, cx, top, top - 2, 12, P.ornament, ROLE.CROWN, M.MASONRY);
      top -= 3;
      for (let dy = 0; dy < 12; dy += 1) {
        const half = Math.round(10 * (1 - dy / 12));
        for (let dx = -half; dx <= half; dx += 1) orn(c, cx + dx, top - dy, lit(P.roof, dx, Math.max(1, half)), ROLE.CROWN, M.TILE);
      }
      angel(c, P, cx, top - 12);
    },
    triple(c, P, cx, y, L) {
      column(c, cx, y, y - 5, 19, tone(P.frame, 1.05), ROLE.CROWN, M.MASONRY);
      for (const dx of [-15, 15]) {
        const h = Math.round(L * 0.5);
        for (let dy = 0; dy < h; dy += 1) {
          const half = Math.round(3 * (1 - dy / h));
          for (let d = -half; d <= half; d += 1) orn(c, cx + dx + d, y - 6 - dy, lit(P.frame, d, Math.max(1, half)), ROLE.CROWN, M.MASONRY);
        }
        orn(c, cx + dx, y - 6 - h, P.ornament);
      }
      CROWN_DRAW.spire(c, P, cx, y - 6, L - 6);
    },
    dragon(c, P, cx, y, L, random) {
      lotus(c, P, cx, y, 7);
      dragonBody(c, P, cx, y - 6, Math.max(30, L - 18), 1, random);
    },
    pillar(c, P, cx, y, L, random) {
      lotus(c, P, cx, y, 5);
      const h = Math.max(36, L - 6);
      for (let dy = 0; dy < h; dy += 1) for (let dx = -1; dx <= 1; dx += 1) orn(c, cx + dx, y - 6 - dy, lit(GOLD, dx, 1));
      for (let dx = -3; dx <= 3; dx += 1) orn(c, cx + dx, y - 6 - h, P.ornament);
      orn(c, cx, y - 7 - h, BEACON); orn(c, cx, y - 8 - h, BEACON);
      dragonBody(c, P, cx, y - 6, Math.max(36, h - 6), 1, random, true);
    },
    twin(c, P, cx, y, L, random) {
      for (let dy = 0; dy < 5; dy += 1) for (let dx = -28; dx <= 28; dx += 1) orn(c, cx + dx, y - dy, dy === 4 ? GOLD : lit(P.frame, dx, 28), ROLE.CROWN, M.WOOD);
      sorin(c, P, cx, y - 5, Math.round(L * 0.7));
      for (const side of [-1, 1]) dragonBody(c, P, cx + side * 22, y - 5, Math.max(24, Math.round(L * 0.6)), side, random);
    },
  };
  function lotus(c, P, cx, y, half) {
    for (let dy = 0; dy < 6; dy += 1) {
      const w = dy < 3 ? half + 4 : half + (dy % 2 ? 2 : 0);
      for (let dx = -w; dx <= w; dx += 1) orn(c, cx + dx, y - dy, dy < 3 ? lit(P.frame, dx, w) : lit(GOLD, dx, w), ROLE.CROWN, M.WOOD);
    }
  }
  function sorin(c, P, cx, y, length) {
    const rings = Math.max(3, Math.min(9, Math.round((length - 30) / 6)));
    for (let dy = 0; dy < length; dy += 1) orn(c, cx, y - dy, P.frame, ROLE.CROWN);
    for (let i = 0; i < rings; i += 1) {
      const ry = y - 6 - i * 5;
      for (let dx = -4; dx <= 4; dx += 1) { orn(c, cx + dx, ry, lit(GOLD, dx, 4)); orn(c, cx + dx, ry - 1, tone(GOLD, 0.8)); }
    }
    const flame = y - length;
    for (let dy = 0; dy < 7; dy += 1) {
      const half = Math.round(3 * Math.sin(dy / 7 * Math.PI));
      for (let dx = -half; dx <= half; dx += 1) orn(c, cx + dx, flame + dy - 6, dy < 3 ? [255, 214, 120] : GOLD);
    }
    orn(c, cx, flame - 8, BEACON); orn(c, cx, flame - 9, BEACON);
  }
  // Coiling dragon: a 5-cell-thick S-curve with spines, claws, a horned head and a red pearl.
  function dragonBody(c, P, cx, baseY, length, facing, random, coilAround = false) {
    const amp = Math.max(6, Math.min(12, Math.round(length / 9)));
    const periods = length >= 90 ? 1.5 : 1;
    const body = [226, 178, 64], belly = [242, 214, 120], spine = [200, 52, 40];
    let headX = cx, headY = baseY - length;
    for (let i = 0; i <= length; i += 1) {
      const t = i / length;
      const x = cx + Math.round(amp * Math.min(1, 4 * t) * Math.sin(2 * Math.PI * periods * t) * (coilAround ? 1.2 : 1));
      const yy = baseY - i;
      for (let d = -2; d <= 2; d += 1) {
        const color = d === -2 ? tone(body, 1.15) : d === 2 ? tone(body, 0.72) : d === 1 ? belly : body;
        orn(c, x + d, yy, color);
      }
      if (i % 9 === 4 && i < length - 8) { orn(c, x - 3, yy, spine); orn(c, x - 4, yy - 1, spine); }
      if (Math.abs(t - 0.4) < 0.012 || Math.abs(t - 0.75) < 0.012) for (let k = 3; k <= 7; k += 1) orn(c, x + k * facing, yy + (k > 5 ? 1 : 0), tone(body, 0.85));
      if (i === length) { headX = x; headY = yy; }
    }
    // Head: snout pointing the facing way, eye, horns.
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -5; dx <= 9; dx += 1) {
      const sx = headX + dx * facing, sy = headY + dy;
      const inHead = dx <= 2 ? Math.abs(dy) <= 4 - Math.max(0, -dx - 3) : Math.abs(dy) <= 2 - (dx > 6 ? 1 : 0);
      if (!inHead) continue;
      const eye = dx === 0 && dy === -2;
      orn(c, sx, sy, eye ? BEACON : dy > 1 ? belly : tone(body, dy < -2 ? 1.12 : 1));
    }
    for (let k = 0; k < 6; k += 1) { orn(c, headX - (3 + k * 0.5 | 0) * facing, headY - 5 - k, tone(body, 0.8)); orn(c, headX - (1 + k * 0.3 | 0) * facing, headY - 5 - k, body); }
    // Red pearl in front of the mouth.
    const px = headX + 13 * facing, py = headY;
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
      if (dx * dx + dy * dy > 16) continue;
      orn(c, px + dx, py + dy, dx + dy < -3 ? [255, 120, 100] : BEACON);
    }
    for (let k = 9; k < 13; k += 1) orn(c, headX + k * facing, py, tone(body, 0.8));
  }
  function angel(c, P, cx, y) {
    const robe = mix(P.ornament, [240, 236, 250], 0.4), wing = tone(P.ornament, 1.05);
    for (let dy = 0; dy < 14; dy += 1) {
      const half = Math.round(1 + dy * 0.32);
      for (let dx = -half; dx <= half; dx += 1) orn(c, cx + dx, y - dy, lit(robe, dx, Math.max(1, half)));
    }
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) if (dx * dx + dy * dy <= 5) orn(c, cx + dx, y - 16 + dy, [236, 226, 210]);
    for (const s of [-1, 1]) for (let k = 0; k < 12; k += 1) {
      const wy = y - 10 - Math.round(k * 0.75);
      for (let t = 0; t < 4 - Math.floor(k / 4); t += 1) orn(c, cx + s * (3 + k), wy + t, tone(wing, t === 0 ? 1.15 : 0.95));
    }
  }

  // ---- Rooftop devices ----------------------------------------------------------------------------------
  const DEVICE_STEEL = [70, 78, 86];
  const ROLE_ACCENT = { turret: [239, 173, 103], launcher: [241, 126, 120], interceptor: [139, 217, 238] };
  function turret(c, P, x0, base, facing) {
    const body = tone(P.frame, 0.8), w = 30;
    for (let dy = 0; dy < 12; dy += 1) for (let dx = 0; dx < w; dx += 1) {
      const slope = dy > 8 ? Math.max(0, dy - 8) : 0;
      if (dx < slope || dx > w - 1 - slope) continue;
      orn(c, x0 + dx, base - dy, dy === 0 ? tone(body, 0.7) : dy === 6 ? P.ornament : lit(body, dx - w / 2, w / 2), ROLE.DEVICE);
    }
    const hx = x0 + 6;
    for (let dy = 12; dy < 21; dy += 1) for (let dx = 0; dx < 18; dx += 1) {
      if (dy > 18 && (dx < 2 || dx > 15)) continue;
      orn(c, hx + dx, base - dy, dy === 15 ? ROLE_ACCENT.turret : lit(body, dx - 9, 9), ROLE.DEVICE);
    }
    const muzzle = facing > 0 ? hx + 18 : hx - 1;
    for (let k = 0; k < 18; k += 1) for (let t = 0; t < 3; t += 1) orn(c, muzzle + facing * k, base - 15 - t, t === 0 ? [96, 104, 112] : DEVICE_STEEL, ROLE.DEVICE);
    c.devices.push({ kind: 'turret', x: x0 + w / 2, y: base - 16, facing });
    return w;
  }
  function launcher(c, P, x0, base, facing) {
    const body = tone(P.frame, 0.8), w = 28;
    for (let dy = 0; dy < 9; dy += 1) for (let dx = 0; dx < w; dx += 1) orn(c, x0 + dx, base - dy, dy === 8 ? P.ornament : lit(body, dx - w / 2, w / 2), ROLE.DEVICE);
    // Two tubes raised at 45 degrees towards the enemy.
    for (let k = 0; k < 24; k += 1) for (let t = 0; t < 7; t += 1) {
      const x = x0 + (facing > 0 ? 4 + k : w - 5 - k) + (facing > 0 ? 0 : 0), y = base - 9 - k - t + 3;
      const tip = k > 20;
      orn(c, x, y, tip ? ROLE_ACCENT.launcher : t === 3 ? [50, 56, 60] : t < 3 ? [104, 112, 120] : DEVICE_STEEL, ROLE.DEVICE);
    }
    c.devices.push({ kind: 'launcher', x: x0 + w / 2, y: base - 30, facing });
    return w;
  }
  function interceptor(c, P, x0, base, facing) {
    const body = tone(P.frame, 0.8), w = 22;
    for (let dy = 0; dy < 18; dy += 1) for (let dx = 0; dx < w; dx += 1) {
      const hatch = dy > 12 && dy < 17 && dx % 6 > 1 && dx % 6 < 5;
      orn(c, x0 + dx, base - dy, hatch ? ROLE_ACCENT.interceptor : dy === 17 ? P.ornament : lit(body, dx - w / 2, w / 2), ROLE.DEVICE);
    }
    // Radar mast and dish.
    for (let dy = 18; dy < 30; dy += 1) orn(c, x0 + 11, base - dy, DEVICE_STEEL, ROLE.DEVICE);
    for (let dx = -8; dx <= 8; dx += 1) {
      const depth = Math.round(dx * dx / 16);
      orn(c, x0 + 11 + dx, base - 30 - (4 - depth), [196, 204, 212], ROLE.DEVICE);
      orn(c, x0 + 11 + dx, base - 29 - (4 - depth), DEVICE_STEEL, ROLE.DEVICE);
    }
    orn(c, x0 + 11, base - 36, BEACON);
    c.devices.push({ kind: 'interceptor', x: x0 + 11, y: base - 30, facing });
    return w;
  }
  const DEVICE_DRAW = { turret, launcher, interceptor };
  const DEVICE_WIDTH = { turret: 30, launcher: 28, interceptor: 22 };
  // Place devices on the highest, widest roofs, from the front edge, clear of crowns and each other.
  function devices(c, style, roofs, plan, facing, random) {
    const P = STYLES[style];
    const candidates = roofs.slice().sort((a, b) => a.y - b.y || (b.right - b.left) - (a.right - a.left));
    const used = [];
    for (const kind of plan) {
      const w = DEVICE_WIDTH[kind];
      let placed = false;
      for (const roof of candidates) {
        const crownHalf = roof.top ? 30 : 0, mid = (roof.left + roof.right) / 2;
        const start = facing > 0 ? roof.right - w - 4 : roof.left + 4;
        for (let step = 0; step < 40 && !placed; step += 1) {
          const x = start - facing * step * 4;
          if (x < roof.left + 2 || x + w > roof.right - 2) break;
          if (crownHalf && x < mid + crownHalf && x + w > mid - crownHalf) continue;
          if (used.some((u) => u.y === roof.y && x < u.x + u.w + 3 && x + w + 3 > u.x)) continue;
          DEVICE_DRAW[kind](c, P, x, roof.y - 1, facing);
          used.push({ x, w, y: roof.y });
          placed = true;
        }
        if (placed) break;
      }
    }
  }

  PW.buildingOrnaments = { roof, crown, crownFor, devices, CROWNS, angel, lotus, sorin, dragonBody, DEVICE_DRAW, gothicPinnacle, asianEave };
})();
