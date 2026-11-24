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
  function roof(c, style, spans, roofs, floorRow, random, facing = 1) {
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
            // Merlons counted from the front edge (they mirror); each one is lit on its left.
            const t = facing > 0 ? (x - r.left) % 14 : (r.right - x) % 14;
            const litEdge = facing > 0 ? t === 0 : t === 6, shadeEdge = facing > 0 ? t === 6 : t === 0;
            if (t < 7) for (let dy = 1; dy <= 7; dy += 1) orn(c, x, r.y - dy, tone(P.frame, litEdge ? 1.15 : shadeEdge ? 0.82 : 1), ROLE.ORNAMENT, M.MASONRY);
            orn(c, x, r.y - 1, tone(P.frame, 0.9), ROLE.ORNAMENT, M.MASONRY);
          }
        }
        for (const x of r.side ? [r.side < 0 ? r.left + 4 : r.right - 4] : [r.left + 4, r.right - 4]) gothicPinnacle(c, P, x, r.y - 1, r.top ? 30 : 22);
      }
    } else {
      for (const r of roofs) {
        for (let x = r.left; x <= r.right; x += 1) {
          const post = facing > 0 ? (x - r.left) % 12 === 0 || x === r.right : (r.right - x) % 12 === 0 || x === r.left;
          if (post) for (let dy = 1; dy <= 6; dy += 1) orn(c, x, r.y - dy, [150, 158, 166]);
          orn(c, x, r.y - 6, [176, 184, 190]);
        }
        for (const x of [r.left, r.right]) for (let dy = 1; dy <= 9; dy += 1) orn(c, x, r.y - dy, tone(P.frame, 1.2));
      }
      // The plant room sits towards the back of the roof (mirrored with the building).
      const top = roofs.find((r) => r.top);
      if (top && top.right - top.left > 70) modernPlantRoom(c, P, facing > 0 ? top.right - 44 : top.left + 11, top.y - 1, facing);
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
  function modernPlantRoom(c, P, x0, baseRow, facing = 1) {
    for (let dy = 0; dy < 16; dy += 1) for (let dx = 0; dx < 34; dx += 1) {
      const at = facing > 0 ? dx : 33 - dx;   // door and vents mirror; the lit edge stays on the left
      const vent = dy > 4 && dy < 12 && at > 18 && at < 31 && dy % 2 === 0;
      const door = at > 4 && at < 11 && dy < 12;
      orn(c, x0 + dx, baseRow - dy, door ? [60, 66, 74] : vent ? [86, 92, 100] : dy === 15 ? [176, 184, 190] : tone([132, 140, 148], dx < 2 ? 1.15 : 1),
        ROLE.ORNAMENT, M.CONCRETE);
    }
  }

  // ---- Crowns ------------------------------------------------------------------------------------------
  // facing mirrors the asymmetric crowns (dragons, dish masts) with the building.
  function crown(c, style, name, cx, baseRow, L, random, facing = 1) {
    const P = STYLES[style];
    const fn = CROWN_DRAW[name];
    if (fn) fn(c, P, cx, baseRow, L, random, facing);
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
          // A plate across each panel and at the top carries the next section.
          if (edge || brace || dy % 9 === 0 || dy === h - 1) orn(c, cx + dx, top - dy, edge ? STEEL : STEEL_DARK, ROLE.CROWN);
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
    dish(c, P, cx, y, L, random, facing = 1) {
      for (let dy = 0; dy < 4; dy += 1) for (let dx = -19; dx <= 19; dx += 1) orn(c, cx + dx, y - dy, dy === 3 ? [184, 190, 196] : [140, 146, 152], ROLE.CROWN, M.CONCRETE);
      column(c, cx, y - 4, y - 12, 2, STEEL);
      // The dish is a bowl seated on the column, the feed arm rising from its centre.
      for (let dx = -12; dx <= 12; dx += 1) {
        const depth = Math.round((dx * dx) / 24);
        for (let t = 0; t < 2; t += 1) orn(c, cx + dx, y - 14 - depth + t, t ? STEEL_DARK : [214, 220, 226]);
      }
      for (let dy = 15; dy <= 21; dy += 1) orn(c, cx, y - dy, STEEL);
      orn(c, cx, y - 22, BEACON);
      for (const [dx, h] of [[-16, 0.85], [16, 0.55]]) {
        const mh = Math.round(L * h);
        for (let dy = 4; dy < mh; dy += 1) orn(c, cx + dx * facing, y - dy, dy > mh - 3 ? BEACON : [200, 206, 212]);
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
    dragon(c, P, cx, y, L, random, facing = 1) {
      const top = dragonPedestal(c, P, cx, y, 10);
      dragonBody(c, P, cx, top, Math.max(30, L - 20), facing, random);
    },
    pillar(c, P, cx, y, L, random, facing = 1) {
      const top = dragonPedestal(c, P, cx, y, 8);
      const h = Math.max(36, L - 8);
      for (let dy = 0; dy < h; dy += 1) for (let dx = -1; dx <= 1; dx += 1) orn(c, cx + dx, top - dy, lit(GOLD, dx, 1));
      for (let dx = -3; dx <= 3; dx += 1) orn(c, cx + dx, top - h, P.ornament);
      orn(c, cx, top - 1 - h, BEACON); orn(c, cx, top - 2 - h, BEACON);
      dragonBody(c, P, cx, top, Math.max(36, h - 6), facing, random, true);
    },
    twin(c, P, cx, y, L, random, facing = 1) {
      for (let dy = 0; dy < 5; dy += 1) for (let dx = -28; dx <= 28; dx += 1) orn(c, cx + dx, y - dy, dy === 4 ? GOLD : lit(P.frame, dx, 28), ROLE.CROWN, M.WOOD);
      sorin(c, P, cx, y - 5, Math.round(L * 0.7));
      // The dragons are drawn back one first (each from its own share of the random stream), so the
      // mirrored building gets the mirror images of the same two dragons, each on its own pedestal.
      for (const side of facing > 0 ? [-1, 1] : [1, -1]) {
        const top = dragonPedestal(c, P, cx + side * 20, y - 5, 6);
        dragonBody(c, P, cx + side * 20, top, Math.max(24, Math.round(L * 0.55)), side, random);
      }
    },
  };
  // A dragon's pedestal: a white marble plinth in two steps (its joints dark, its top edge lit)
  // under a red lacquer drum banded in gold. Returns the row the dragon stands on.
  const MARBLE = [214, 210, 198], MARBLE_DARK = [150, 146, 136];
  function dragonPedestal(c, P, cx, y, half) {
    const rows = [[half + 4, 'marble'], [half + 4, 'joint'], [half + 2, 'marble'], [half + 2, 'marble'],
      [half, 'band'], [half, 'drum'], [half, 'drum'], [half, 'drum'], [half, 'band']];
    rows.forEach(([w, kind], dy) => {
      for (let dx = -w; dx <= w; dx += 1) {
        const edge = Math.abs(dx) === w;
        const color = kind === 'joint' ? MARBLE_DARK : kind === 'marble' ? (edge ? MARBLE_DARK : lit(MARBLE, dx, w))
          : kind === 'band' ? lit(GOLD, dx, w) : edge ? tone(P.frame, 0.7) : lit(P.frame, dx, w);
        orn(c, cx + dx, y - dy, color, ROLE.CROWN, kind === 'drum' || kind === 'band' ? M.WOOD : M.MASONRY);
      }
    });
    return y - rows.length;
  }
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
    orn(c, cx, flame - 7, BEACON); orn(c, cx, flame - 8, BEACON);
  }
  // A Chinese dragon climbing in an S-coil, its head turned to look out the facing way, kept to a
  // simple, readable silhouette like the other crowns: a gold body (its back edge darker, its
  // front edge lit) tapering to the tail, a few red spines along its back, a blunt horned head and
  // the pearl it chases. Everything is placed in the dragon's own terms (u forward along
  // `facing`, rounded before mirroring) so the mirrored dragon is exact; the light stays on the
  // canvas left.
  const DRAGON = { gold: [226, 178, 64], goldLit: [250, 210, 104], goldDark: [170, 120, 36],
    red: [206, 50, 38], redDark: [150, 32, 26], ivory: [238, 228, 200], ivoryDark: [196, 182, 150], black: [24, 20, 18], mouth: [110, 24, 22] };
  function dragonBody(c, P, cx, baseY, length, facing, random, coilAround = false) {
    const D = DRAGON;
    const f = facing < 0 ? -1 : 1;
    const put = (u, y, color) => orn(c, cx + f * u, y, color);     // u: cells towards the facing side
    const amp = Math.max(6, Math.min(12, Math.round(length / 9))) * (coilAround ? 1.2 : 1);
    const periods = length >= 90 ? 1.5 : 1;
    const neck = Math.max(24, length - 12);                         // the body climbs to here; the head sits above
    // (5 cells thick, 7 where it rises from its coil)
    const half = (t) => (t < 0.18 ? 3 : 2);
    const along = (t) => Math.round(amp * Math.min(1, 4 * t) * Math.sin(2 * Math.PI * periods * t));
    const lit = (u, color) => tone(color, (f * u) < 0 ? 1.1 : 1);    // canvas-left side catches the light
    let headU = 0, headY = baseY - neck;
    for (let i = 0; i <= neck; i += 1) {
      const t = i / neck, u0 = along(t), y = baseY - i, r = half(t);
      for (let d = -r; d <= r; d += 1) put(u0 + d, y, lit(u0 + d, d === -r ? D.goldDark : d === r ? D.goldLit : D.gold));
      // A red spine every 7 rows along its back.
      if (i % 7 === 3 && t > 0.15 && t < 0.9) { put(u0 - r - 1, y, D.red); put(u0 - r - 2, y - 1, D.redDark); }
      if (i === neck) { headU = u0; headY = y; }
    }
    // Its tail lies coiled on the pedestal, a flat gold loop around the foot of the body, ending in
    // a red tip.
    for (let v = 0; v <= 4; v += 1) for (let u = -9; u <= 9; u += 1) {
      const k = (u / 9) ** 2 + ((v - 2) / 2.4) ** 2;
      if (k > 1 || k < 0.42) continue;
      put(u, baseY - v, lit(u, v === 0 ? D.goldDark : v === 4 ? D.goldLit : D.gold));
    }
    put(-10, baseY - 1, D.red); put(-11, baseY - 2, D.redDark);
    // Head, looking out the facing way: a rounded skull, a blunt snout with the mouth a dark line,
    // one eye, two short horns swept back and a short red mane.
    const hu = headU, hy = headY - 3;
    const H = (du, dy, color) => put(hu + du, hy + dy, color);
    for (let dy = -4; dy <= 3; dy += 1) for (let du = -3; du <= 5; du += 1) {
      if ((du - 1) ** 2 / 18 + (dy + 0.5) ** 2 / 13 > 1) continue;
      H(du, dy, dy < -2 ? D.goldLit : D.gold);
    }
    for (let du = 5; du <= 13; du += 1) for (let dy = -2; dy <= 2; dy += 1) H(du, dy, dy === -2 ? D.goldLit : dy === 2 ? D.goldDark : dy === 0 && du < 13 ? D.mouth : D.gold);
    H(4, -2, D.black); H(4, -3, D.black);                                                              // eye
    for (let k = 0; k <= 4; k += 1) { H(-k, -4 - k, D.ivory); H(1 - k, -4 - k, D.ivoryDark); }         // horns
    for (let k = 0; k < 5; k += 1) { H(-4 - k, -1 + (k >> 1), D.red); H(-4 - k, 1 + (k >> 1), D.redDark); }   // mane
    // The pearl, held at the tip of its jaws (joined to the snout, so it never floats loose).
    for (let dy = -2; dy <= 2; dy += 1) for (let du = -2; du <= 2; du += 1) if (du * du + dy * dy <= 5) H(15 + du, dy, du + dy < -1 ? [255, 150, 120] : BEACON);
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
  // N103 (the user's turret redesign): the turret is no longer built into the roof - it stands on a
  // turret base, a low steel plate set on the flat of the roof (or of the land, or a tunnel room's
  // floor: pw-mounts lays those), its traversing ring on top. The turret itself is PS's (pw-defence):
  // seated on the plate's top row, drawn over the world, coming off when the plate under it goes.
  // This plate is the building's own - the crews rebuild it with the rest.
  const BASE_W = 32, BASE_H = 6;
  // The plate's colour at (dx, dy) - dy up from its foot: a dark flange, the bolted body, a hazard
  // band, and the ring on top (the bearing dark in the middle, its lip lit at the ends).
  function plateColor(dx, dy, tint = null, w = BASE_W) {
    const end = dx === 0 || dx === w - 1;
    let c;
    if (dy === 0) c = [52, 56, 62];
    else if (dy === BASE_H - 1) c = dx >= 6 && dx < w - 6 ? [70, 74, 80] : [124, 130, 138];
    else if (dy === 3) c = ((dx + 64) >> 2) % 2 === 0 ? [214, 164, 40] : [40, 40, 44];
    else if (dy === 2 && dx % 6 === 3) c = [150, 156, 162];
    else c = dy === 4 ? [108, 114, 122] : [92, 98, 106];
    if (tint) c = mix(c, tint, 0.18);
    return end && dy !== 3 ? tone(c, 0.8) : c;
  }
  // N114 (the user's): the missile launchers and interceptors follow the turret - stationary
  // artillery built off a planted base, not vehicles - so a roof carries their plates, wider than a
  // turret's, and PS's launcher or interceptor is seated on each (pw-mounts' sweep).
  // (PS's turntables: launcher and Patriot 30, Iron Dome 22 - the plates a little wider)
  const PLATE_W = { turret: BASE_W, launcher: 36, interceptor: 32 };
  function plate(kind) {
    const w = PLATE_W[kind];
    return (c, P, x0, base, facing) => {
      for (let dy = 0; dy < BASE_H; dy += 1) for (let dx = 0; dx < w; dx += 1) orn(c, x0 + dx, base - dy, plateColor(dx, dy, P.ornament, w), ROLE.DEVICE);
      const top = base - BASE_H + 1;
      c.devices.push({ kind, x: x0 + w / 2, y: top, facing, normal: [0, -1], base: { x0, x1: x0 + w - 1, y: top } });
      return w;
    };
  }
  const turret = plate('turret');
  const DEVICE_DRAW = { turret, launcher: plate('launcher'), interceptor: plate('interceptor') };
  const DEVICE_WIDTH = PLATE_W;
  // (a launcher's pods and an interceptor's box overhang their plate as they lay: PS's ~60 cells
  // ahead - no other device that near on the roof)
  const DEVICE_GAP = { turret: 3, launcher: 60, interceptor: 60 };
  // Place devices on the highest, widest roofs, from the front edge, clear of crowns and each other.
  // facing 0 (neutral buildings) alternates the devices to cover both directions, starting with
  // `startFacing`.
  function devices(c, style, roofs, plan, facingOption, random, startFacing = 1) {
    const P = STYLES[style];
    const candidates = roofs.slice().sort((a, b) => a.y - b.y || (b.right - b.left) - (a.right - a.left));
    // (the plates already on the building - an earlier call's - are kept clear of too: N114)
    const used = (c.devices || []).filter((d) => d.base).map((d) => ({ x: d.base.x0, w: d.base.x1 - d.base.x0 + 1, y: d.base.y + BASE_H, gap: DEVICE_GAP[d.kind] || 3 }));
    for (const [deviceIndex, kind] of plan.entries()) {
      const facing = facingOption || (deviceIndex % 2 ? -startFacing : startFacing);
      const w = DEVICE_WIDTH[kind], gap = DEVICE_GAP[kind];
      let placed = false;
      for (const roof of candidates) {
        // (a top roof keeps its middle for a crown - unless it is one no crown stands on: roof.open)
        const crownHalf = roof.top && !roof.open ? 30 : 0, mid = (roof.left + roof.right) / 2;
        const start = facing > 0 ? roof.right - w - 4 : roof.left + 4;
        for (let step = 0; step < 40 && !placed; step += 1) {
          const x = start - facing * step * 4;
          if (x < roof.left + 2 || x + w > roof.right - 2) break;
          if (crownHalf && x < mid + crownHalf && x + w > mid - crownHalf) continue;
          if (used.some((u) => u.y === roof.y && x < u.x + u.w + Math.max(gap, u.gap) && x + w + Math.max(gap, u.gap) > u.x)) continue;
          // (never over a roof's drain hatch, N64 - nor hard by it: the rain must reach it - N103)
          if ((c.hatches || []).some((h) => roof.y >= h.y0 - 2 && roof.y <= h.y1 + 2 && x < h.x1 + 8 && x + w + 8 > h.x0)) continue;
          DEVICE_DRAW[kind](c, P, x, roof.y - 1, facing);
          used.push({ x, w, y: roof.y, gap });
          placed = true;
        }
        if (placed) break;
      }
    }
  }

  PW.buildingOrnaments = { roof, crown, crownFor, devices, CROWNS, angel, lotus, sorin, dragonBody, DEVICE_DRAW, gothicPinnacle, asianEave,
    plateColor, BASE_W, BASE_H, PLATE_W };
})();
