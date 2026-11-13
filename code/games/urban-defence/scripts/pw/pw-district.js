'use strict';
// District infill between neighbouring buildings (the style lab's District sheet, at native scale):
// skybridges across narrow gaps, street lamps, landmarks or a park tree where styles meet, street
// furniture and railings. Props are front deco (vehicles pass behind them); skybridges are structure.
(function () {
  const PW = window.PW;
  const { M } = PW;
  const K = PW.buildingKit;
  const { tone, mix } = K;
  const rgb = (c) => PW.abgr(c[0], c[1], c[2]);

  const COLORS = {
    gothic: { post: [52, 50, 60], stone: [150, 146, 140], rail: [84, 80, 96], ornament: [176, 150, 210], light: [255, 214, 120], glass: [120, 150, 190] },
    asian: { post: [176, 58, 46], stone: [150, 140, 120], rail: [60, 52, 50], ornament: [226, 178, 64], light: [255, 190, 90], glass: [190, 120, 90] },
    modern: { post: [120, 128, 136], stone: [170, 170, 166], rail: [96, 140, 170], ornament: [196, 224, 236], light: [240, 250, 255], glass: [120, 180, 205] },
  };
  // Prop drawing buffer: props are drawn bottom-anchored at (x, groundY) into deco.
  function prop(world, owner) {
    const cells = [];
    return {
      cells,
      put(x, y, color) { cells.push(x | 0, y | 0, rgb(color)); },
      commit(groundY) {
        for (let i = 0; i < cells.length; i += 3) {
          PW.setLayer(world, 'deco', cells[i], cells[i + 1], cells[i + 2]);
          if (owner) PW.setOwner(world, cells[i], cells[i + 1], owner);
        }
        // Lamp light pools tint the street surface below each lamp head.
        for (const pool of this.pool || []) {
          for (let dx = -pool.radius * 2; dx <= pool.radius * 2; dx += 1) {
            const t = 1 - Math.abs(dx) / (pool.radius * 2);
            const x = pool.x + dx;
            const current = PW.getLayer(world, 'paint', x, groundY);
            if (!current) continue;
            PW.setLayer(world, 'paint', x, groundY, rgb(mix(PW.unpack(current), pool.color, 0.45 * t * t)));
          }
        }
      },
    };
  }
  const lit = (c, dx, half) => tone(c, dx < -half * 0.3 ? 1.15 : dx > half * 0.4 ? 0.8 : 1);
  // Light pool on the ground under a lamp: a few warm cells on the street surface (whole cells only).
  function glow(p, cx, cy, color, radius) {
    void cy;
    p.pool = p.pool || [];
    p.pool.push({ x: cx, color, radius });
  }

  // ---- Street lamps -----------------------------------------------------------------------------------
  function lamp(p, style, x, g, facing) {
    const C = COLORS[style];
    if (style === 'gothic') {
      for (let dy = 0; dy < 5; dy += 1) for (let dx = -3; dx <= 3; dx += 1) p.put(x + dx, g - 1 - dy, lit(C.post, dx, 3));
      for (let dy = 5; dy < 38; dy += 1) for (let dx = -1; dx <= 1; dx += 1) p.put(x + dx, g - 1 - dy, (dy % 10 === 0) ? C.ornament : lit(C.post, dx, 1));
      for (let dy = 38; dy < 50; dy += 1) for (let dx = -5; dx <= 5; dx += 1) {
        const cage = Math.abs(dx) === 5 || dy === 38 || dy === 49 || dx === 0;
        p.put(x + dx, g - 1 - dy, cage ? C.post : tone(C.light, dy > 44 ? 1 : 0.92));
      }
      for (let dx = -6; dx <= 6; dx += 1) { p.put(x + dx, g - 51, C.post); if (Math.abs(dx) < 4) p.put(x + dx, g - 52, C.post); }
      p.put(x, g - 53, C.ornament); p.put(x, g - 54, C.ornament);
      glow(p, x, g - 44, C.light, 16);
    } else if (style === 'asian') {
      for (let dy = 0; dy < 6; dy += 1) for (let dx = -7 + dy; dx <= 7 - dy; dx += 1) p.put(x + dx, g - 1 - dy, lit(C.stone, dx, 7));
      for (let dy = 6; dy < 22; dy += 1) for (let dx = -2; dx <= 2; dx += 1) p.put(x + dx, g - 1 - dy, lit(C.stone, dx, 2));
      for (let dy = 22; dy < 32; dy += 1) for (let dx = -6; dx <= 6; dx += 1) {
        const window = Math.abs(dx) < 3 && dy > 23 && dy < 30;
        p.put(x + dx, g - 1 - dy, window ? C.light : lit(C.stone, dx, 6));
      }
      for (let dy = 32; dy < 37; dy += 1) for (let dx = -10 + (dy - 32) * 2; dx <= 10 - (dy - 32) * 2; dx += 1) p.put(x + dx, g - 1 - dy, dy === 32 ? C.post : lit(C.rail, dx, 10));
      p.put(x - 11, g - 34, C.ornament); p.put(x + 11, g - 34, C.ornament);
      p.put(x, g - 38, C.ornament); p.put(x, g - 39, C.ornament);
      glow(p, x, g - 27, C.light, 14);
    } else {
      for (let dy = 0; dy < 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) p.put(x + dx, g - 1 - dy, C.post);
      for (let dy = 3; dy < 52; dy += 1) { p.put(x, g - 1 - dy, C.post); p.put(x + 1, g - 1 - dy, tone(C.post, 0.8)); }
      for (let k = 0; k < 16; k += 1) p.put(x + facing * k, g - 53, C.post);
      for (let k = 10; k < 18; k += 1) { p.put(x + facing * k, g - 52, C.light); p.put(x + facing * k, g - 51, tone(C.light, 0.85)); }
      glow(p, x + facing * 14, g - 49, C.light, 15);
    }
  }

  // ---- Landmarks --------------------------------------------------------------------------------------
  function landmark(p, style, x, g) {
    const C = COLORS[style];
    if (style === 'gothic') {
      // Angel column on a stepped plinth.
      for (let step = 0; step < 3; step += 1) for (let dy = 0; dy < 5; dy += 1) for (let dx = -(14 - step * 3); dx <= 14 - step * 3; dx += 1) p.put(x + dx, g - 1 - step * 5 - dy, lit(C.stone, dx, 14 - step * 3));
      for (let dy = 15; dy < 82; dy += 1) for (let dx = -4; dx <= 4; dx += 1) p.put(x + dx, g - 1 - dy, dx % 3 === 0 ? tone(C.stone, 0.86) : lit(C.stone, dx, 4));
      for (let dy = 82; dy < 87; dy += 1) for (let dx = -7; dx <= 7; dx += 1) p.put(x + dx, g - 1 - dy, lit(C.stone, dx, 7));
      // Angel.
      for (let dy = 0; dy < 16; dy += 1) for (let dx = -Math.round(1 + dy * 0.3); dx <= Math.round(1 + dy * 0.3); dx += 1) p.put(x + dx, g - 88 - 15 + dy, mix(C.ornament, [240, 236, 250], 0.4));
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) if (dx * dx + dy * dy <= 5) p.put(x + dx, g - 107 + dy, [236, 226, 210]);
      for (const s of [-1, 1]) for (let k = 0; k < 13; k += 1) for (let t = 0; t < 4 - (k >> 2); t += 1) p.put(x + s * (3 + k), g - 98 - Math.round(k * 0.7) + t, tone(C.ornament, t ? 0.95 : 1.15));
    } else if (style === 'asian') {
      // Paifang gate: red pillars, lintels and a tiled roof with upturned eaves.
      const half = 34;
      for (const s of [-1, 1]) for (let dy = 0; dy < 72; dy += 1) for (let dx = -3; dx <= 3; dx += 1) p.put(x + s * (half - 6) + dx, g - 1 - dy, dy < 6 ? lit(C.stone, dx, 3) : lit(C.post, dx, 3));
      for (const ly of [56, 66]) for (let dx = -half; dx <= half; dx += 1) for (let t = 0; t < 4; t += 1) p.put(x + dx, g - ly - t, t === 0 ? C.ornament : C.post);
      for (let dx = -8; dx <= 8; dx += 1) for (let dy = 57; dy < 66; dy += 1) p.put(x + dx, g - dy, Math.abs(dx) < 7 && dy > 58 && dy < 64 ? [60, 30, 26] : C.ornament);
      for (let dx = -half - 8; dx <= half + 8; dx += 1) {
        const lift = Math.abs(dx) > half ? Math.abs(dx) - half : 0;
        for (let t = 0; t < 5; t += 1) p.put(x + dx, g - 71 - t - Math.round(lift * 0.6), t === 4 ? [86, 80, 74] : [58, 56, 56]);
      }
      p.put(x - half - 8, g - 81, C.ornament); p.put(x + half + 8, g - 81, C.ornament);
    } else {
      // Glass shelter with a bench and a lit sign.
      const w = 56, h = 40;
      for (let dx = 0; dx < w; dx += 1) for (let dy = 0; dy < h; dy += 1) {
        const frame = dx === 0 || dx === w - 1 || dy === h - 1 || dy === h - 2;
        const glass = !frame && dy > 2 && (dx < 4 || dy > h - 8);
        if (frame) p.put(x - w / 2 + dx, g - 1 - dy, C.post);
        else if (glass) p.put(x - w / 2 + dx, g - 1 - dy, mix(C.glass, [255, 255, 255], (dx + dy) % 9 === 0 ? 0.4 : 0));
      }
      for (let dx = 8; dx < w - 8; dx += 1) { p.put(x - w / 2 + dx, g - 12, [150, 110, 70]); if (dx % 12 === 0) for (let dy = 1; dy < 12; dy += 1) p.put(x - w / 2 + dx, g - dy, [90, 92, 96]); }
      for (let dx = w - 16; dx < w - 4; dx += 1) for (let dy = 18; dy < 30; dy += 1) p.put(x - w / 2 + dx, g - dy, dy % 4 === 0 ? [40, 44, 50] : [210, 240, 255]);
    }
  }

  // ---- Street furniture ---------------------------------------------------------------------------------
  const FURNITURE = {
    modern: ['signal', 'hydrant', 'bench', 'planter', 'bin'],
    gothic: ['fountain', 'column', 'ruin', 'bollards'],
    asian: ['cypress', 'lion', 'wall', 'balustrade'],
  };
  const FURNITURE_WIDTH = { signal: 10, hydrant: 10, bench: 26, planter: 28, bin: 10, fountain: 42, column: 14, ruin: 30, bollards: 34,
    cypress: 20, lion: 20, wall: 44, balustrade: 32 };
  function furniture(p, style, name, x, g) {
    const C = COLORS[style];
    const box = (x0, y0, w, h, color, shade = true) => {
      for (let dx = 0; dx < w; dx += 1) for (let dy = 0; dy < h; dy += 1) p.put(x0 + dx, g - 1 - y0 - dy, shade ? lit(color, dx - w / 2, w / 2) : color);
    };
    switch (name) {
      case 'signal': box(x + 4, 0, 2, 44, [70, 74, 80]); box(x, 40, 10, 22, [40, 42, 46], false);
        for (const [k, c] of [[0, [235, 60, 50]], [1, [245, 196, 60]], [2, [70, 215, 110]]]) box(x + 3, 54 - k * 6, 4, 4, k === 2 ? c : tone(c, 0.45), false); break;
      case 'hydrant': box(x + 1, 0, 8, 12, [196, 48, 40]); box(x + 3, 12, 4, 3, [196, 48, 40]); box(x, 6, 10, 2, [150, 36, 30], false); break;
      case 'bench': box(x, 7, 26, 3, [150, 110, 70]); box(x, 12, 26, 2, [150, 110, 70]); box(x + 2, 0, 2, 7, [90, 92, 96]); box(x + 22, 0, 2, 7, [90, 92, 96]); break;
      case 'planter': box(x, 0, 28, 10, C.stone);
        for (let i = 0; i < 90; i += 1) { const a = (PW.hash2(x, i) % 314) / 100, r = 4 + PW.hash2(i, x) % 9; p.put(x + 14 + Math.round(Math.cos(a) * r * 1.2), g - 12 - Math.round(Math.sin(a) * r), (i & 3) ? [64, 110, 56] : [96, 150, 72]); }
        break;
      case 'bin': box(x, 0, 10, 12, [70, 76, 84]); box(x, 12, 10, 2, [50, 54, 60], false); break;
      case 'fountain':
        box(x, 0, 42, 8, C.stone); box(x + 3, 8, 36, 2, [52, 120, 200], false); box(x + 18, 8, 6, 14, C.stone); box(x + 10, 22, 22, 3, C.stone);
        for (let k = 0; k < 10; k += 1) { p.put(x + 21, g - 26 - k, [128, 186, 236]); if (k > 5) { p.put(x + 21 - (k - 5), g - 26 - k + (k - 5) * 2, [128, 186, 236]); p.put(x + 21 + (k - 5), g - 26 - k + (k - 5) * 2, [128, 186, 236]); } }
        break;
      case 'column': box(x, 0, 14, 4, C.stone); box(x + 3, 4, 8, 34, C.stone); box(x, 38, 14, 4, C.stone); break;
      case 'ruin': box(x, 0, 30, 7, tone(C.stone, 0.9)); box(x + 4, 7, 8, 14, C.stone); box(x + 18, 7, 6, 8, tone(C.stone, 0.85)); break;
      case 'bollards': for (let k = 0; k < 4; k += 1) { box(x + k * 10, 0, 5, 11, C.post); box(x + k * 10 + 1, 11, 3, 2, C.ornament, false); } break;
      case 'cypress': {
        box(x + 9, 0, 3, 8, [86, 62, 42]);
        for (let dy = 8; dy < 60; dy += 1) { const half = Math.round(8 * Math.sin(Math.min(1, (dy - 8) / 52) * Math.PI) + 1);
          for (let dx = -half; dx <= half; dx += 1) p.put(x + 10 + dx, g - 1 - dy, (dx + dy) % 5 === 0 ? [58, 100, 64] : lit([40, 76, 52], dx, half)); }
        break;
      }
      case 'lion': box(x, 0, 20, 6, C.stone);
        for (let dy = 6; dy < 22; dy += 1) for (let dx = 3; dx < 17; dx += 1) {
          const head = dy > 14 && dx > 9; const body = dy < 15 && dx < 15;
          if (head || body) p.put(x + dx, g - 1 - dy, lit(tone(C.stone, head ? 1.05 : 0.95), dx - 10, 7));
        }
        p.put(x + 14, g - 18, [40, 30, 26]); break;
      case 'wall': box(x, 0, 44, 12, C.stone); for (let dx = -2; dx < 46; dx += 1) { p.put(x + dx, g - 13, [58, 56, 56]); p.put(x + dx, g - 14, [86, 80, 74]); } break;
      case 'balustrade': box(x, 0, 32, 3, C.stone); box(x, 9, 32, 3, C.stone); for (let k = 0; k < 32; k += 5) box(x + k + 1, 3, 3, 6, tone(C.stone, 0.9)); break;
      default: break;
    }
  }

  // Park tree where two styles meet: a small broadleaf, flower bed and bench.
  function parkTree(world, p, x, g, random) {
    const tree = PW.vegetation.broadleaf(random, random.range(84, 110));
    PW.vegetation.stamp(world, tree, x, g);
    const flowers = [[226, 96, 140], [245, 196, 60], [150, 190, 240], [232, 228, 218]];
    for (let dx = -26; dx <= 26; dx += 1) {
      p.put(x + dx, g - 1, [72, 140, 70]); if ((dx & 1) === 0) p.put(x + dx, g - 2, [64, 120, 60]);
      if (PW.hash2(x + dx, 5) % 4 === 0) p.put(x + dx, g - 3, flowers[PW.hash2(dx, x) % 4]);
    }
  }

  function railing(p, style, x0, x1, g) {
    const C = COLORS[style];
    for (let x = x0; x <= x1; x += 1) {
      if (style === 'gothic') { p.put(x, g - 10, C.rail); if (x % 6 === 0) for (let dy = 1; dy < 10; dy += 1) p.put(x, g - dy, C.rail); if (x % 12 === 0) p.put(x, g - 12, C.ornament); }
      else if (style === 'asian') { p.put(x, g - 8, C.stone); p.put(x, g - 9, [58, 56, 56]); if (x % 12 === 0) for (let dy = 1; dy < 8; dy += 1) p.put(x, g - dy, C.stone); }
      else { p.put(x, g - 9, C.rail); if (x % 12 === 0) { for (let dy = 1; dy < 9; dy += 1) p.put(x, g - dy, C.post); p.put(x, g - 10, C.light); } }
    }
  }

  // ---- Skybridge (structure) ------------------------------------------------------------------------------
  function skybridge(world, a, b, owner) {
    const shared = a.floors.filter((fa) => fa.storey >= 1 && b.floors.some((fb) => fb.y === fa.y)).sort((p, q) => p.storey - q.storey)[0];
    if (!shared) return null;
    const y = shared.y, S = K.S;
    const style = a.style;
    const P = K.STYLES[style];
    const x0 = a.body.right + 1, x1 = b.body.left - 1;
    // Open both walls at this storey (door height) so units can cross.
    for (const [building, edge, inward] of [[a, a.body.right, -1], [b, b.body.left, 1]]) {
      for (let d = 0; d < S.WALL + 2; d += 1) for (let yy = y - S.DOOR_H; yy < y; yy += 1) {
        const x = edge + inward * d;
        const id = PW.get(world, x, yy) & 63;
        if (id !== M.AIR) PW.set(world, x, yy, M.AIR, { quiet: true });
        if (!PW.getLayer(world, 'back', x, yy)) PW.setLayer(world, 'back', x, yy, rgb(tone(P.frame, 0.3)));
      }
      void building;
    }
    for (let x = x0; x <= x1; x += 1) {
      const i = x - x0;
      for (let r = 0; r < S.SLAB; r += 1) {
        PW.set(world, x, y + r, M.CONCRETE, { quiet: true, keepPaint: true });
        PW.setLayer(world, 'paint', x, y + r, rgb(K.slabColor(style, r, x, y + r)));
        PW.setOwner(world, x, y + r, owner);
      }
      for (let r = 0; r < 4; r += 1) {
        PW.set(world, x, y - S.FLOOR + r, M.CONCRETE, { quiet: true, keepPaint: true });
        PW.setLayer(world, 'paint', x, y - S.FLOOR + r, rgb(r === 0 ? tone(P.roofLight, 1.1) : tone(P.frame, 0.8)));
        PW.setOwner(world, x, y - S.FLOOR + r, owner);
      }
      // Corridor back wall with windows / posts per style.
      for (let yy = y - S.FLOOR + 4; yy < y; yy += 1) {
        const rise = y - 1 - yy;
        let color = tone(P.frame, 0.36);
        if (style === 'asian' && (i % 14 < 3)) color = P.frame;
        else if (style === 'gothic' && (i % 16 < 3 || rise > 26 + Math.round(4 * Math.sin((i % 16) / 16 * Math.PI)))) color = tone(P.frame, 0.8);
        else if (style === 'modern' && i % 10 === 0) color = tone(P.frame, 0.9);
        else if (rise > 8 && rise < 30) color = mix(K.GLASS_DARK, P.lamp, 0.35);
        PW.setLayer(world, 'back', x, yy, rgb(color));
        PW.setOwner(world, x, yy, owner);
      }
    }
    return { y, x0, x1, storey: shared.storey };
  }

  function generateDistricts(world, seed) {
    const random = PW.createRandom(seed + 777);
    world.districts = [];
    for (const settlement of world.settlements || []) {
      const list = settlement.buildings.slice().sort((p, q) => p.body.left - q.body.left);
      for (let i = 0; i + 1 < list.length; i += 1) {
        const a = list[i], b = list[i + 1];
        const gap = b.body.left - a.body.right - 1;
        const g = settlement.padY;
        const owner = a.id;
        const p = prop(world, owner);
        const report = { between: [a.id, b.id], gap, props: [] };
        const mixed = a.style !== b.style;
        if (gap > 0 && gap <= 50 && a.type !== 'farm' && b.type !== 'farm' && a.type !== 'core' && b.type !== 'core') {
          const bridge = skybridge(world, a, b, owner);
          report.props.push(bridge ? `skybridge@storey${bridge.storey}` : 'no bridge (no shared floor)');
        }
        const left = a.body.right + 1, right = b.body.left - 1;
        const used = [];
        if (gap >= 28) {
          lamp(p, a.style, left + 6, g, 1); lamp(p, b.style, right - 6, g, -1);
          used.push([left, left + 14], [right - 14, right]);
          report.props.push(`${a.style} lamp`, `${b.style} lamp`);
        }
        const mid = Math.round((left + right) / 2);
        if (gap >= 80) {
          if (mixed) { parkTree(world, p, mid, g, random); report.props.push('park tree (style boundary)'); used.push([mid - 30, mid + 30]); }
          else { landmark(p, a.style, mid, g); report.props.push(`${a.style} landmark`); used.push([mid - 38, mid + 38]); }
        }
        if (gap >= 56) {
          const style = mixed ? (random() < 0.5 ? a.style : b.style) : a.style;
          const list2 = FURNITURE[style];
          let count = Math.floor(gap / 32), k = 0;
          for (let x = left + 18; x < right - 18 && count > 0; x += 6) {
            const name = list2[(k + i) % list2.length];
            const w = FURNITURE_WIDTH[name];
            if (x + w > right - 16 || used.some(([u0, u1]) => x < u1 + 3 && x + w > u0 - 3)) continue;
            furniture(p, style, name, x, g);
            used.push([x, x + w]);
            report.props.push(name);
            x += w + 4; count -= 1; k += 1;
          }
        }
        if (gap >= 20) {
          // Railings on the stretches nothing else uses.
          let x = left + 2;
          const sorted = used.slice().sort((u, v) => u[0] - v[0]);
          for (const [u0, u1] of sorted) { if (u0 - 4 > x + 10) railing(p, a.style, x, u0 - 4, g); x = Math.max(x, u1 + 4); }
          if (right - 2 > x + 10) railing(p, b.style, x, right - 2, g);
        }
        p.commit(g);
        world.districts.push(report);
      }
    }
    return world.districts;
  }

  PW.generateDistricts = generateDistricts;
  PW.districtProps = { lamp, landmark, furniture, parkTree, railing, skybridge, COLORS, FURNITURE };
})();
