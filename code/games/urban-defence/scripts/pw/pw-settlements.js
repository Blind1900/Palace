'use strict';
// Settlements: the two bases and three neutral clusters, placed on terraced pads that blend into
// the terrain, with streets through the ground floors, runways, farm fields, pumps, starter mine
// tunnels down to the ore nodes and ground defences facing the enemy.
(function () {
  const PW = window.PW;
  const { M, FLAG } = PW;
  const K = PW.buildingKit;
  const { tone, mix } = K;
  const rgb = (c) => PW.abgr(c[0], c[1], c[2]);

  // ---- Plans ---------------------------------------------------------------------------------------
  function shuffleStyles(random) {
    const styles = ['asian', 'gothic', 'modern'];
    for (let i = styles.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [styles[i], styles[j]] = [styles[j], styles[i]];
    }
    return { left: styles[0], right: styles[1], neutral: styles[2] };
  }
  // Rear (map edge, pond side) to front (towards the enemy).
  function basePlan(random) {
    const pick = (list) => list[Math.floor(random() * list.length)];
    return [
      { type: 'farm', variant: pick(['silos', 'barn', 'homestead']), level: 2, rear: true, field: true },
      { type: 'core' },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 3 },
      { type: 'farm', variant: 'greenhouse', level: 2 },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 2 },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 4, optional: true },
      { type: 'military', variant: pick(PW.MILITARY_VARIANTS), level: 3, front: true },
    ];
  }
  // Tight neutral cluster with every building type (they start out under construction).
  function neutralPlan(random) {
    const pick = (list) => list[Math.floor(random() * list.length)];
    return [
      { type: 'farm', variant: pick(['silos', 'barn', 'homestead']), level: 1, field: true },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 1 },
      { type: 'military', variant: pick(PW.MILITARY_VARIANTS), level: 1 },
      { type: 'population', variant: pick(PW.POPULATION_VARIANTS), level: 1 },
      { type: 'mine' },
    ];
  }

  // ---- Terrain shaping -------------------------------------------------------------------------------
  // Level the ground to padY over [x0, x1], ramping back to the natural surface no steeper than 1:1.
  // Lakes and ponds are left alone (no soil laid on water, no bed cut out from under it).
  function terracePad(world, x0, x1, padY, ramp = 1) {
    const { mat, width: W } = world;
    const reach = 260;
    for (let x = Math.max(1, x0 - reach); x <= Math.min(W - 2, x1 + reach); x += 1) {
      const natural = world.groundTop[x];
      if ((mat[natural * W + x] & 63) === M.WATER) continue;
      // Never dig out from under (or bury) something already built here, like a pump's plinth,
      // and never re-level a street or runway that is already paved.
      if (PW.getOwner(world, x, natural) || PW.getOwner(world, x, natural - 1)) continue;
      if (PW.getFlags(world, x, natural) & FLAG.ROAD) continue;
      const dist = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      // Rows grow downward: higher ground is cut down, lower ground filled up, within the ramp.
      const goal = dist === 0 ? padY : (natural < padY ? Math.max(natural, padY - dist * ramp) : Math.min(natural, padY + dist * ramp));
      if (goal === natural) continue;
      if (goal > natural) {
        // Cut: remove ground above the goal, then re-grass the new surface.
        for (let y = natural; y < goal; y += 1) {
          const id = mat[y * W + x] & 63;
          if (id !== M.AIR && id !== M.WATER) PW.set(world, x, y, M.AIR, { quiet: true });
        }
        for (let y = goal; y < goal + 3; y += 1) {
          if ((mat[y * W + x] & 63) === M.WATER) continue;
          PW.set(world, x, y, (dist === 0 ? M.TOPSOIL : M.GRASS) | (PW.hash2(x, y) & 3) << 6, { quiet: true });
        }
        for (let y = goal - 200; y < goal; y += 1) PW.setLayer(world, 'deco', x, y, 0);
      } else {
        // Fill: soil up to the goal, grass on top outside the pads.
        for (let y = goal; y < natural; y += 1) {
          const id = y < goal + 3 && dist > 0 ? M.GRASS : y < goal + 14 ? M.TOPSOIL : M.SOIL;
          PW.set(world, x, y, id | (PW.hash2(x, y) & 3) << 6, { quiet: true });
          PW.setLayer(world, 'deco', x, y, 0);   // whatever stood here is buried by the fill
        }
      }
      // Wild deco above the new ground in the pad is cleared (grass regrows on the shoulders).
      if (dist === 0) for (let y = goal - 60; y < goal + 4; y += 1) PW.setLayer(world, 'deco', x, y, 0);
    }
    // Plants and rocks that lost the ground under them (a hilltop cut away) fall, as after a blast.
    const box = { x0: x0 - reach, y0: padY - 1200, x1: x1 + reach, y1: padY + 300 };
    if (PW.flora) PW.flora.afterBlast(world, null, box);
    if (PW.props) PW.props.afterBlast(world, null, box);
  }

  // ---- Street paving (district paving palettes from the style lab, scaled) ----------------------------
  const PAVING = {
    gothic: { paving: [128, 122, 118], joint: [80, 74, 72], base: [70, 62, 58] },
    asian: { paving: [176, 156, 120], joint: [120, 70, 50], base: [96, 80, 60] },
    modern: { paving: [64, 66, 72], joint: [226, 190, 60], base: [44, 44, 48] },
  };
  // The street's top row is padY, or padY(x) where it follows the ground (null: no street there).
  function paveStreet(world, x0, x1, padY, styleAt) {
    for (let x = x0; x <= x1; x += 1) {
      const top = typeof padY === 'function' ? padY(x) : padY;
      if (top === null || top === undefined) continue;
      const style = styleAt(x);
      const P = PAVING[style];
      for (let row = 0; row < 4; row += 1) {
        const y = top + row;
        const id = PW.get(world, x, y) & 63;
        if (!PW.mat.ground[id] || id === M.WATER) continue;
        let color;
        if (row === 3) color = P.base;
        else if (style === 'modern') color = row === 0 && x % 48 < 24 ? (x % 48 < 2 ? P.joint : P.paving) : row === 1 && x % 24 < 12 ? tone(P.paving, 0.86) : P.paving;
        else if (style === 'gothic') color = (x + row * 6) % 9 === 0 || row === 2 ? P.joint : tone(P.paving, (PW.hash2(x >> 3, row) & 1) ? 1.06 : 0.95);
        else color = (x + row * 9) % 18 === 0 || row === 2 ? P.joint : tone(P.paving, (PW.hash2(x / 18 | 0, row) & 1) ? 1.04 : 0.96);
        if (row === 0 && (PW.hash2(x, y) & 15) === 0) color = tone(color, 0.9);
        PW.set(world, x, y, row === 0 ? M.ASPHALT : M.ROADBED, { quiet: true });
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.ROAD);
      }
    }
  }
  function paveRunway(world, from, direction, length, padY) {
    for (let i = 0; i < length; i += 1) {
      const x = from + direction * i;
      for (let row = 0; row < 4; row += 1) {
        const y = padY + row;
        let color = row === 3 ? [36, 36, 40] : [52, 54, 58];
        if (row === 0 && i % 60 < 30 && i > 20 && i < length - 40) color = [235, 235, 235];       // centre line
        if (row === 0 && i > length - 30 && i % 6 < 3) color = [235, 235, 235];                      // threshold bars
        if (row === 1 && (PW.hash2(x, y) & 7) === 0) color = [62, 64, 68];
        PW.set(world, x, y, row === 0 ? M.ASPHALT : M.ROADBED, { quiet: true });
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.ROAD);
      }
      for (let y = padY - 60; y < padY; y += 1) PW.setLayer(world, 'deco', x, y, 0);
    }
  }

  // ---- Farms: wheat field and shore pump ----------------------------------------------------------------
  function sowField(world, x0, x1, padY, random) {
    const field = { x0, x1, y: padY, growth: 0.55 + random() * 0.4, stalks: [] };
    for (let x = x0; x <= x1; x += 1) {
      for (let row = 0; row < 3; row += 1) {
        const y = padY + row;
        if (!PW.mat.ground[PW.get(world, x, y) & 63]) continue;
        PW.set(world, x, y, M.TOPSOIL | (row << 6), { quiet: true });
        const furrow = (x % 10) < 5;
        PW.setLayer(world, 'paint', x, y, rgb(tone(row === 0 ? (furrow ? [92, 66, 42] : [110, 82, 54]) : [96, 72, 48], 1)));
      }
    }
    drawCrop(world, field);
    return field;
  }
  // Draw (or redraw) a field's wheat at its current growth: green shoots when young, golden ears
  // when ripe. Stalks only grow from tilled soil that is still there, into open air.
  const STEMS = [[170, 150, 70], [150, 132, 60]], EARS = [[236, 200, 90], [214, 176, 92], [246, 214, 110]];
  const SHOOTS = [[96, 140, 60], [80, 122, 52]];
  function drawCrop(world, field) {
    const { x0, x1, y: padY, growth } = field;
    for (let x = x0; x <= x1 + 1; x += 1) {
      for (let i = 1; i <= 20; i += 1) {
        if (PW.getFlags(world, x, padY - i) & FLAG.FLORA) { PW.setLayer(world, 'deco', x, padY - i, 0); PW.setFlag(world, x, padY - i, FLAG.FLORA, false); }
      }
    }
    field.stalks = [];
    const ripe = growth >= 0.6;
    for (let x = x0; x <= x1; x += 3) {
      if ((PW.get(world, x, padY) & 63) !== M.TOPSOIL) continue;
      const h = Math.round((10 + (PW.hash2(x, 41) % 8)) * growth);
      if (h < 1) continue;
      field.stalks.push({ x, h });
      const lean = (PW.hash2(x, 43) & 3) === 0 ? 1 : 0;
      for (let i = 1; i <= h; i += 1) {
        const color = !ripe ? SHOOTS[(i + x) & 1] : i > h - 4 ? EARS[PW.hash2(x, i) % EARS.length] : STEMS[(i + x) & 1];
        const sx = x + (lean && i > h - 3 ? 1 : 0);
        if ((PW.get(world, sx, padY - i) & 63) !== M.AIR || (PW.getFlags(world, sx, padY - i) & FLAG.CHARRED)) break;
        PW.setLayer(world, 'deco', sx, padY - i, rgb(color));
        PW.setFlag(world, sx, padY - i, FLAG.FLORA);
      }
    }
  }
  // Pump house on the flattest dry spot near the shore. It stands level on a concrete plinth that
  // goes down to the ground under every column, and its intake pipe leaves the lake-side wall,
  // drops to the bank and lies on the ground down the bank and along the lake bed under the water.
  const PUMP_WIDTH = 30;
  function pumpHouse(world, lake, towardX, style, owner, taken = () => false) {
    const P = K.STYLES[style];
    const dry = (x) => (PW.get(world, x, world.groundTop[x]) & 63) !== M.WATER;
    // Either shore will do; the nearer one to the farm wins a tie. Streets, runways and fields
    // are not built over.
    let best = null;
    for (const dir of towardX < lake.x ? [-1, 1] : [1, -1]) {
      const shore = dir < 0 ? lake.left : lake.right;
      for (let d = 8; d <= 120; d += 2) {
        const left = dir > 0 ? shore + d : shore - d - PUMP_WIDTH + 1;
        let high = Infinity, low = -Infinity, ok = left > 2 && left + PUMP_WIDTH < world.width - 2;
        for (let x = left - 1; ok && x <= left + PUMP_WIDTH; x += 1) {
          const g = world.groundTop[x];
          if (!dry(x) || taken(x) || PW.getOwner(world, x, g) || PW.getOwner(world, x, g - 1) || (PW.getFlags(world, x, g) & FLAG.ROAD)) ok = false;
          high = Math.min(high, g); low = Math.max(low, g);
        }
        if (!ok) continue;
        const score = (low - high) + d * 0.08 + Math.abs(left - towardX) * 0.002;
        if (!best || score < best.score) best = { left, floor: high, score, dir };
      }
    }
    if (!best) return null;
    const { left, dir } = best;
    // Bench the site into the bank at its middle height (cut uphill, embankment downhill, 1:1),
    // so the house stands on a short plinth instead of a tall pier.
    const rows = [];
    for (let x = left - 1; x <= left + PUMP_WIDTH; x += 1) rows.push(world.groundTop[x]);
    rows.sort((p, q) => p - q);
    const floor = rows[rows.length >> 1];
    terracePad(world, left - 2, left + PUMP_WIDTH + 1, floor);
    for (let x = left - 1; x <= left + PUMP_WIDTH; x += 1) {
      const ground = world.groundTop[x];
      for (let y = floor; y <= ground + 1; y += 1) {
        PW.set(world, x, y, M.FOUNDATION, { quiet: true });
        PW.setLayer(world, 'paint', x, y, rgb(y === floor ? [128, 126, 120] : (x + y) % 7 === 0 ? [92, 90, 86] : [108, 106, 100]));
        PW.setOwner(world, x, y, owner);
      }
    }
    for (let x = left; x < left + PUMP_WIDTH; x += 1) {
      for (let y = floor - 22; y < floor; y += 1) {
        const edge = x === left || x === left + PUMP_WIDTH - 1 || y === floor - 22;
        PW.set(world, x, y, edge ? P.wallMat : M.CONCRETE, { quiet: true, keepPaint: true });
        PW.setLayer(world, 'paint', x, y, rgb(edge ? tone(P.frame, 0.9) : y % 6 === 0 ? [86, 92, 100] : [120, 128, 136]));
        PW.setOwner(world, x, y, owner);
      }
      for (let r = 0; r < 4; r += 1) { PW.set(world, x, floor - 23 - r, M.TILE, { quiet: true }); PW.setLayer(world, 'paint', x, floor - 23 - r, rgb(tone(P.roof, r === 3 ? 1.3 : 1))); }
    }
    // Intake pipe, 4 cells (0.28 m) across.
    const toLake = -dir;
    const wall = toLake > 0 ? left + PUMP_WIDTH : left - 1;
    const SHADE = [[96, 150, 160], [67, 115, 128], [67, 115, 128], [40, 70, 80]];
    const lay = (x, y, k) => {
      const id = PW.get(world, x, y) & 63;
      if (id !== M.AIR && id !== M.WATER) return;   // never through another structure's base
      PW.set(world, x, y, M.PIPE, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(SHADE[Math.max(0, Math.min(3, k))]));
      PW.setOwner(world, x, y, owner);
    };
    // Out of the foot of the lake-side wall, along the plinth top.
    for (let r = 0; r < 4; r += 1) lay(wall, floor - 4 + r, r);
    let x = wall + toLake, prevTop = floor - 4;
    let wet = false;
    for (let steps = 0; steps < 260; steps += 1, x += toLake) {
      const top = world.groundTop[x];
      const inWater = (PW.get(world, x, top) & 63) === M.WATER;
      if (wet && !inWater) { x -= toLake; break; }   // reached the far side of a shallow pond
      const bed = PW.supportBelow(world, x, top, true);
      const bottom = bed - 1, pipeTop = bottom - 3;
      // Continuous down a steep bank: fill from the previous column's top.
      for (let y = Math.min(prevTop, pipeTop); y <= bottom; y += 1) lay(x, y, y - pipeTop);
      prevTop = pipeTop;
      wet = wet || inWater;
      if (inWater && bed - lake.level > 16) break;
    }
    // Strainer head at the mouth, standing on the bed.
    for (let k = 0; k < 3; k += 1) {
      const sx = x + toLake * k;
      const bed = PW.supportBelow(world, sx, world.groundTop[sx], true);
      for (let y = prevTop - 2; y < bed; y += 1) lay(sx, y, y === prevTop - 2 ? 0 : y === bed - 1 ? 3 : 1);
    }
    return { x: left + (PUMP_WIDTH >> 1), y: floor, left, right: left + PUMP_WIDTH - 1, intakeX: x, lake,
      span: [Math.min(left - 1, x), Math.max(left + PUMP_WIDTH, x)] };
  }

  // ---- Tunnels: lined shafts, drifts and rooms (tunnel network lab look) ---------------------------------
  const TUNNEL = { back: [24, 23, 22], floor: [44, 36, 28], prop: [76, 54, 32], lamp: [255, 220, 140], rail: [150, 112, 62], rung: [214, 178, 112] };
  // Carve an axis-aligned interior box; line its rim with orange LINING where it meets ground.
  function carveBox(world, x0, y0, x1, y1, owner, lining = 4) {
    const { mat, width: W } = world;
    for (let y = y0 - lining; y <= y1 + lining; y += 1) {
      for (let x = x0 - lining; x <= x1 + lining; x += 1) {
        if (!PW.inside(world, x, y)) continue;
        const interior = x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const id = mat[y * W + x] & 63;
        if (interior) {
          if (id !== M.AIR) PW.set(world, x, y, M.AIR, { quiet: true });
          const fromTop = y - y0, fromBottom = y1 - y;
          const color = fromBottom < 3 ? TUNNEL.floor : tone(TUNNEL.back, fromTop < 4 ? 0.8 : (PW.hash2(x, y) & 15) === 0 ? 1.25 : 1);
          PW.setLayer(world, 'back', x, y, rgb(color));
          PW.setFlag(world, x, y, FLAG.TUNNEL | FLAG.CARVED);
          PW.setLayer(world, 'deco', x, y, 0);
        } else if (PW.getFlags(world, x, y) & FLAG.CARVED) {
          continue;
        } else if (id !== M.AIR && id !== M.WATER && id !== M.ORE && id !== M.BEDROCK && !PW.mat.structural[id]) {
          PW.set(world, x, y, M.LINING, { quiet: true });
        }
        if (owner) PW.setOwner(world, x, y, owner);
      }
    }
  }
  function tunnelLamps(world, x0, x1, ceilingY, step = 64) {
    for (let x = x0 + 20; x <= x1 - 10; x += step) {
      for (let dx = -2; dx <= 2; dx += 1) PW.setLayer(world, 'back', x + dx, ceilingY, rgb(TUNNEL.lamp));
      for (let y = ceilingY + 1; y < ceilingY + 26; y += 1) {
        for (let dx = -16; dx <= 16; dx += 1) {
          const d = Math.hypot(dx, (y - ceilingY) * 0.8) / 18;
          if (d >= 1) continue;
          const current = PW.getLayer(world, 'back', x + dx, y);
          if (!current) continue;
          PW.setLayer(world, 'back', x + dx, y, rgb(mix(PW.unpack(current), TUNNEL.lamp, (1 - d) * (1 - d) * 0.35)));
        }
      }
    }
  }
  function ladder(world, x, y0, y1) {
    for (let y = y0; y <= y1; y += 1) {
      for (let dx = 0; dx < 12; dx += 1) {
        const rail = dx < 2 || dx > 9;
        const rung = (y % 6) === 0;
        if (rail || rung) {
          PW.setLayer(world, 'back', x + dx, y, rgb(rail ? TUNNEL.rail : TUNNEL.rung));
          PW.setFlag(world, x + dx, y, FLAG.FIXTURE);   // tunnel development paints around it
        }
        PW.setFlag(world, x + dx, y, FLAG.LADDER);
      }
    }
  }
  // Where a drift running from x towards `dir` first meets ore within rows [top, bottom]: the
  // column just short of the vein, so the ore forms the working face. Falls back to the node's
  // centre minus its half-width when the vein misses the drift's level.
  function oreFace(world, node, x, dir, top, bottom) {
    for (let k = 0; k < 700; k += 1) {
      const cx = x + dir * k;
      for (let y = top; y <= bottom; y += 1) if ((PW.get(world, cx, y) & 63) === M.ORE) return cx - dir;
      if ((cx - node.x) * dir > node.radius + 40) break;
    }
    return node.x - dir * (node.radius + 6);
  }
  // Starter workings from the core pit down to the ore vein: shaft, drift and storage room. They
  // are a tunnel network rooted at the top of the shaft: dug raw (timbered), then developed into
  // reinforced concrete from the shaft head outward as the match goes on.
  function starterMine(world, core, node, dir, side) {
    // The shaft drops from the side of the pit nearest the node; the drift runs to the vein's face.
    const toward = Math.sign(node.x - (core.pit.left + core.pit.right) / 2) || dir;
    const sx = toward > 0 ? Math.round(core.pit.right - 60) : Math.round(core.pit.left + 60);
    const pitFloor = core.ground + core.pit.depth;
    const driftBottom = node.y + 20, driftTop = driftBottom - 44;
    const net = PW.tunnels.createNetwork(world, { side, x: sx, y: pitFloor - 2, building: core.id });
    PW.tunnels.digBox(world, net, sx - 15, pitFloor - 2, sx + 15, driftBottom, { kind: 'shaft' });
    const face = Math.sign(node.x - sx) || toward;
    const reach = oreFace(world, node, sx + face * 16, face, driftTop, driftBottom);
    const d0 = Math.min(sx, reach), d1 = Math.max(sx, reach);
    PW.tunnels.digBox(world, net, d0, driftTop, d1, driftBottom, { kind: 'drift' });
    // Storage room on the far side of the shaft from the node.
    const r0 = face > 0 ? sx - 190 : sx + 40, r1 = r0 + 150;
    PW.tunnels.digBox(world, net, Math.min(r0, sx), driftTop - 8, Math.max(r1, sx), driftBottom, { kind: 'room' });
    ladder(world, toward > 0 ? sx - 14 : sx + 3, pitFloor - 2, driftBottom - 1);
    return { network: net.id, shaft: { x: sx, top: pitFloor, bottom: driftBottom }, drift: { x0: d0, x1: d1, top: driftTop, bottom: driftBottom },
      storage: { x0: Math.min(r0, sx), x1: Math.max(r1, sx), top: driftTop - 8, bottom: driftBottom }, node };
  }
  // A mine headframe's own shaft: straight down to a nearby vein, or a short sump if none is near.
  function headframeShaft(world, mine, nodes, side) {
    const x = mine.shaft.x, top = mine.shaft.top;
    const node = nodes.filter((n) => n.y > top + 200 && n.y < top + 1300 && Math.abs(n.x - x) < 420)
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
    const bottom = node ? node.y + 20 : top + 220;
    const net = PW.tunnels.createNetwork(world, { side, x, y: top, building: mine.id });
    PW.tunnels.digBox(world, net, x - 15, top, x + 15, bottom, { kind: 'shaft' });
    let drift = null;
    if (node) {
      const dir = Math.sign(node.x - x) || 1;
      const reach = oreFace(world, node, x + dir * 16, dir, bottom - 44, bottom);
      PW.tunnels.digBox(world, net, Math.min(x, reach), bottom - 44, Math.max(x, reach), bottom, { kind: 'drift' });
      drift = { x0: Math.min(x, reach), x1: Math.max(x, reach), top: bottom - 44, bottom };
    }
    ladder(world, x - 14, top, bottom - 1);
    return { network: net.id, x, top, bottom, node, shaft: { x, top, bottom }, drift };
  }

  // ---- Ground defences --------------------------------------------------------------------------------------
  // A sandbag wall (cover: it stops shots) on a levelled seat, then Czech hedgehogs and concertina
  // wire towards the enemy. Hedgehog feet and wire coils sit on the ground wherever it slopes.
  const STEEL = { lit: [118, 122, 128], base: [82, 86, 92], dark: [56, 58, 62] };
  function decoAir(world, x, y, color) {
    if ((PW.get(world, x, y) & 63) !== M.AIR) return false;
    PW.setLayer(world, 'deco', x, y, rgb(color));
    return true;
  }
  function beam(world, x0, y0, x1, y1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s += 1) {
      const x = Math.round(x0 + (x1 - x0) * s / n), y = Math.round(y0 + (y1 - y0) * s / n);
      decoAir(world, x, y, STEEL.lit);
      decoAir(world, x, y + 1, STEEL.dark);
    }
  }
  // Czech hedgehog, 1.3 m: two beams cross at the hub (the third is seen end-on), feet on the ground.
  function hedgehog(world, hx) {
    const footL = hx - 10, footR = hx + 10;
    const gL = world.groundTop[footL] - 1, gR = world.groundTop[footR] - 1;
    const hubY = Math.round((gL + gR) / 2) - 9;
    beam(world, footL, gL - 1, hx + Math.round((hx - footL) * 0.8), hubY + Math.round((hubY - gL) * 0.8));
    beam(world, footR, gR - 1, hx + Math.round((hx - footR) * 0.8), hubY + Math.round((hubY - gR) * 0.8));
    for (let dy = -2; dy <= 1; dy += 1) for (let dx = -2; dx <= 1; dx += 1) decoAir(world, hx + dx, hubY + dy, dy < 0 && dx < 0 ? STEEL.lit : STEEL.base);
    // Feet: the lowest cell of each beam rests on the ground.
    decoAir(world, footL, gL, STEEL.dark); decoAir(world, footR, gR, STEEL.dark);
    return { feet: [[footL, gL], [footR, gR]] };
  }
  // Concertina wire: overlapping coils (0.9 m) whose lowest point touches the ground, on stakes.
  function concertina(world, a, b) {
    const x0 = Math.min(a, b), x1 = Math.max(a, b);
    const touches = [];
    for (let cx = x0; cx <= x1; cx += 3) {
      const g = world.groundTop[cx] - 1;
      const cy = g - 6;
      for (let t = 0; t < 64; t += 1) {
        const angle = t / 64 * Math.PI * 2;
        decoAir(world, Math.round(cx + Math.cos(angle) * 4), Math.round(cy + Math.sin(angle) * 6), (t & 3) ? [110, 112, 118] : [150, 152, 156]);
      }
      touches.push([cx, g]);
      if ((cx - x0) % 24 === 0) for (let y = g; y >= g - 13; y -= 1) decoAir(world, cx, y, [96, 74, 48]);
    }
    return touches;
  }
  function groundDefences(world, x, dir, random, taken = () => false) {
    const wall = PW.props.sandbags(random, 5, 4);
    // Start clear of anything already built (a pump house, a field), then go only as far as dry
    // land does (the line stops at a lake shore).
    for (let shift = 0; shift < 240; shift += 1) {
      let free = true;
      for (let k = 0; k <= wall.width + 4 && free; k += 1) if (taken(x + dir * k)) free = false;
      if (free) break;
      x += dir;
    }
    let reach = 0;
    while (reach < wall.width + 214) {
      const k = x + dir * reach;
      if (k < 20 || k > world.width - 20 || taken(k) || (PW.get(world, k, world.groundTop[k]) & 63) === M.WATER) break;
      reach += 1;
    }
    if (reach < wall.width + 12) return null;
    const left = dir > 0 ? x : x - wall.width;
    const rows = [];
    for (let k = left; k < left + wall.width; k += 1) rows.push(world.groundTop[k]);
    rows.sort((p, q) => p - q);
    const seat = rows[rows.length >> 1];
    terracePad(world, left - 2, left + wall.width + 2, seat);
    const cover = PW.props.place(world, wall, left + wall.anchorX, seat, { kind: 'sandbags', setting: 'defence' });
    if (!cover) {
      const blockers = {};
      for (let k = left; k < left + wall.width; k += 1) for (let y = seat - wall.height; y < seat; y += 1) {
        const m = PW.get(world, k, y) & 63;
        if (m !== M.AIR) blockers[PW.mat.names[m]] = (blockers[PW.mat.names[m]] || 0) + 1;
      }
      world.defenceIssues = (world.defenceIssues || []).concat([{ x, dir, seat, blockers }]);
    }
    const hedgehogs = [];
    for (let k = 0; k < 3; k += 1) {
      const d = wall.width + 54 + k * 46;
      if (d + 12 < reach) hedgehogs.push(hedgehog(world, x + dir * d));
    }
    const wireFrom = x + dir * (wall.width + 18), wireTo = x + dir * Math.min(wall.width + 200, reach - 8);
    const wire = (wireTo - wireFrom) * dir > 12 ? concertina(world, wireFrom, wireTo) : [];
    const far = x + dir * Math.min(wall.width + 214, reach);
    return { cover, hedgehogs, wire, span: [Math.min(left, far), Math.max(left + wall.width, far)] };
  }

  // ---- Generation ------------------------------------------------------------------------------------------
  function generateSettlements(world, layout, seed) {
    const random = PW.createRandom(seed + 4242);
    const styles = shuffleStyles(random);
    world.styles = styles;
    world.buildings = [];
    world.settlements = [];
    const T = PW.buildingTypes;
    const make = (lot, style, facing, deviceFacing, index) => {
      const seedFor = seed + index * 977 + world.buildings.length * 31;
      if (lot.type === 'population') return T.population({ style, level: lot.level, variant: lot.variant, seed: seedFor, facing, deviceFacing });
      if (lot.type === 'military') return T.military({ style, level: lot.level, variant: lot.variant, seed: seedFor, facing, deviceFacing });
      if (lot.type === 'farm') return T.farm({ style, level: lot.level, variant: lot.variant, seed: seedFor, facing });
      if (lot.type === 'mine') return T.mine({ style, facing, seed: seedFor });
      return T.core({ style, facing });
    };
    for (const site of layout.sites) {
      const side = site.side;
      const style = styles[side];
      const padY = Math.round(site.level);
      const neutral = side === 'neutral';
      const dir = side === 'left' ? 1 : side === 'right' ? -1 : 0;
      const plan = neutral ? neutralPlan(random) : basePlan(random);
      // Each base's buildings face the enemy (the right base is the left base's mirror image);
      // a farm with a field faces outward, where its crops grow. Neutral buildings are mixed,
      // with at least one facing each way.
      const mixed = plan.map(() => (random() < 0.5 ? -1 : 1));
      if (neutral) {
        const free = plan.map((lot, i) => (lot.field ? -1 : i)).filter((i) => i >= 0);
        if (free.every((i) => mixed[i] === mixed[free[0]])) mixed[free[free.length >> 1]] *= -1;
      }
      // Build canvases and measure the cluster.
      const lots = plan.map((lot, index) => {
        // (a neutral farm leads the cluster, so its field grows out to the left)
        const facing = lot.field ? (dir ? -dir : index === 0 ? -1 : 1) : (dir || mixed[index]);
        const canvas = make(lot, style, facing, neutral ? 0 : dir, index);
        return { ...lot, facing, canvas, bodyWidth: canvas.body.right - canvas.body.left + 1 };
      });
      const gapFor = () => neutral ? random.int(8, 44) : random.int(24, 120);
      // Place from the rear (bases) or centred (neutrals), dropping optional lots that don't fit.
      const runwayLength = 380;
      let total = lots.reduce((sum, lot) => sum + lot.bodyWidth, 0) + 60 * (lots.length - 1);
      const room = site.x1 - site.x0 - (neutral ? 40 : runwayLength * 0.6);
      while (total > room && lots.some((lot) => lot.optional)) {
        const index = lots.findIndex((lot) => lot.optional);
        total -= lots[index].bodyWidth + 60;
        lots.splice(index, 1);
      }
      const placed = [];
      const relief = neutral && PW.foundations;
      if (relief) {
        // Neutral towns are set into the land's relief: each building on its own base (cut and
        // walled uphill, on a stage downhill) and spaced so neighbours' works never meet. The row is
        // laid out once to measure it, then again centred on the site.
        const gaps = lots.map(() => random.int(4, 16));
        const lay = (start) => {
          const row = [];
          let cursor = start;
          lots.forEach((lot, index) => {
            let x = cursor - lot.canvas.body.left + 4, m = PW.foundations.measure(world, lot.canvas, x, style);
            for (let n = 0; n < 4 && m && m.left < cursor; n += 1) { x += cursor - m.left; m = PW.foundations.measure(world, lot.canvas, x, style); }
            if (!m) { cursor += lot.bodyWidth + gaps[index]; return; }   // standing water: the lot is left out
            row.push({ lot, x, m });
            cursor = m.right + 1 + gaps[index];
          });
          return row;
        };
        const centre = Math.round((site.x0 + site.x1) / 2);
        const trial = lay(centre - Math.round(total / 2));
        const span = trial.length ? [trial[0].m.left, trial[trial.length - 1].m.right] : [centre, centre];
        let shift = centre - Math.round((span[0] + span[1]) / 2);
        // Keep dry land at both ends of the town for the defence lines (200 cells), and beyond the
        // farm for its field, a pump house and its intake on the shore and the line (420): the town
        // moves away from a lake that crowds one end, as far as the other end can spare.
        const wet = (x) => layout.lakes.some((lake) => lake.left !== undefined && x > lake.left - 30 && x < lake.right + 30);
        const dry = (from, out, limit) => { let d = 0; while (d < limit && !wet(from + out * d)) d += 1; return d; };
        const farm = trial.find((row) => row.lot.field);
        const need = (out) => (farm && farm.lot.facing === out ? 420 : 200);
        const roomL = dry(span[0] + shift, -1, 800) - need(-1), roomR = dry(span[1] + shift, 1, 800) - need(1);
        if (roomL < 0 && roomR > 0) shift += Math.min(-roomL, roomR);
        else if (roomR < 0 && roomL > 0) shift -= Math.min(-roomR, roomL);
        for (const { lot, x } of lay(centre - Math.round(total / 2) + shift)) {
          lot.canvasX = x;
          lot.left = x + lot.canvas.body.left;
          lot.right = x + lot.canvas.body.right;
          placed.push(lot);
        }
      } else {
        let cursor = neutral ? Math.round((site.x0 + site.x1) / 2 - total / 2) : dir > 0 ? site.x0 + 30 : site.x1 - 30;
        const step = neutral ? 1 : dir;
        for (const lot of lots) {
          const { canvas } = lot;
          const canvasX = step > 0 ? cursor - canvas.body.left : cursor - canvas.body.right;
          lot.canvasX = canvasX;
          lot.left = canvasX + canvas.body.left;
          lot.right = canvasX + canvas.body.right;
          cursor = step > 0 ? lot.right + gapFor() : lot.left - gapFor();
          placed.push(lot);
        }
      }
      placed.sort((a, b) => a.left - b.left);
      // Bases: one terraced pad for the whole street, then stamp. Neutral towns: each building
      // placed with its own base.
      const settlement = { side, style, padY, buildings: [], site };
      if (!relief) terracePad(world, placed[0].left - 50, placed[placed.length - 1].right + 50, padY);
      for (const lot of placed) {
        const id = world.buildings.length + 1;
        let stamp, base = null;
        if (relief) {
          const result = PW.foundations.place(world, lot.canvas, lot.canvasX, { style, owner: id });
          if (!result) continue;
          stamp = result.stamp;
          base = { G: result.plan.G, walls: result.walls, under: result.under, cores: result.cores };
          lot.works = result.works;
        } else {
          stamp = PW.stampBuilding(world, lot.canvas, lot.canvasX, padY, { owner: id });
          lot.works = [lot.left, lot.right];
        }
        const record = PW.buildingRecord(world, stamp, { id, side, style, type: lot.type, variant: lot.variant,
          level: lot.level || 1, facing: lot.facing, neutral, underConstruction: neutral, works: lot.works, base });
        world.buildings.push(record);
        settlement.buildings.push(record);
      }
      // The street runs 50 cells past the end buildings (in a neutral town it stops at a farm's
      // field instead, as that is terraced at its own level).
      const ends = settlement.buildings, first = ends[0], last = ends[ends.length - 1];
      const fieldOut = (b) => (relief && placed.some((lot) => lot.canvas === b.canvas && lot.field) ? b.facing : 0);
      const streetLeft = settlement.streetLeft = first.works[0] - (fieldOut(first) < 0 ? 13 : 50);
      const streetRight = settlement.streetRight = last.works[1] + (fieldOut(last) > 0 ? 13 : 50);
      // Streets through the ground floors (style paving) and the runway. In a neutral town the
      // street follows the ground between the buildings' bases (which have their own paving,
      // stages and steps) and runs through each ground floor.
      const streetAt = !relief ? padY : (x) => {
        for (const b of settlement.buildings) {
          if (x >= b.body.left && x <= b.body.right) return b.ground;
          if (x >= b.works[0] && x <= b.works[1]) return null;
        }
        return world.groundTop[x];
      };
      settlement.streetAt = typeof streetAt === 'function' ? streetAt : () => padY;
      paveStreet(world, streetLeft, streetRight, streetAt, () => style);
      for (const b of settlement.buildings) {
        if (b.type !== 'military' || !b.runway || neutral) continue;
        const end = b.runway.from + b.runway.direction * runwayLength;
        terracePad(world, Math.min(b.runway.from, end), Math.max(b.runway.from, end), padY);
        paveRunway(world, b.runway.from, b.runway.direction, runwayLength, padY);
        settlement.runway = { from: b.runway.from, to: end, y: padY };
      }
      // Everything laid on the surface, so wild growth keeps clear of it.
      const footprints = settlement.footprints = [[streetLeft, streetRight]];
      if (settlement.runway) footprints.push([Math.min(settlement.runway.from, settlement.runway.to), Math.max(settlement.runway.from, settlement.runway.to)]);
      // Farm fields on the farm's outward side (stopping short of any water), and a pump at the
      // nearest lake.
      const wetAt = (x) => layout.lakes.some((lake) => lake.left !== undefined && x > lake.left - 30 && x < lake.right + 30);
      for (const b of settlement.buildings.filter((item) => item.type === 'farm')) {
        const lot = placed.find((item) => item.canvas === b.canvas);
        if (!lot || !lot.field) continue;
        const outward = b.facing;
        const start = outward > 0 ? b.works[1] + 14 : b.works[0] - 14;
        let length = neutral ? 150 : 240;
        for (let d = 0; d <= length; d += 1) {
          const x = start + outward * d;
          // (a neutral field leaves room before the shore for the town's defence line on that side)
          if (x < 40 || x > world.width - 40 || wetAt(x + (neutral ? outward * 80 : 0))) { length = d - 1; break; }
        }
        if (length >= 60) {
          const x0 = Math.min(start, start + outward * length), x1 = Math.max(start, start + outward * length);
          // On a neutral town's rolling ground the field is its own terrace at the median ground.
          const rows = relief ? Array.from({ length: x1 - x0 + 1 }, (_, k) => world.groundTop[x0 + k]).sort((p, q) => p - q) : null;
          const fieldY = relief ? rows[rows.length >> 1] : padY;
          terracePad(world, x0, x1, fieldY);
          b.field = sowField(world, x0, x1, fieldY, random);
          footprints.push([x0, x1]);
        }
        const lake = layout.lakes.filter((item) => item.left !== undefined)
          .sort((p, q) => Math.abs(p.x - b.body.left) - Math.abs(q.x - b.body.left))[0];
        if (lake && Math.abs(lake.x - b.body.left) < 2200) {
          const inUse = (spans) => (x) => spans.some(([a, c]) => x >= a - 8 && x <= c + 8);
          const taken = (x) => inUse(footprints)(x) || world.settlements.some((s) => inUse(s.footprints || [])(x));
          b.pump = pumpHouse(world, lake, b.body.left, style, b.id, taken);
          if (b.pump) footprints.push(b.pump.span);
        }
      }
      // Base workings: starter shaft from the core pit to the starter node; neutral mine shafts.
      // Both are furnished with cover (mine cars on rails, drums, crates, sandbags...).
      const core = settlement.buildings.find((item) => item.type === 'core');
      if (core) {
        const node = layout.nodes.find((n) => n.starter === side) || layout.nodes.slice().sort((p, q) => Math.abs(p.x - core.body.left) - Math.abs(q.x - core.body.left))[0];
        core.mine = starterMine(world, core, node, dir || 1, side);
        core.mine.props = PW.props.furnishMine(world, core.mine, random);
        if (PW.mining) core.mine.operation = PW.mining.openFromWorkings(world, core.mine, side);
        settlement.core = core;
      }
      for (const mine of settlement.buildings.filter((item) => item.type === 'mine')) {
        mine.workings = headframeShaft(world, mine, layout.nodes, side);
        mine.workings.props = PW.props.furnishMine(world, mine.workings, random);
        if (PW.mining) mine.workings.operation = PW.mining.openFromWorkings(world, mine.workings, side);
      }
      // Ground defences beyond the front of each base (past the runway's end); neutrals guard both
      // ends of their street.
      settlement.defences = [];
      const front = (d) => {
        if (settlement.runway && d === dir) return d > 0 ? Math.max(settlement.runway.from, settlement.runway.to) + 40 : Math.min(settlement.runway.from, settlement.runway.to) - 40;
        return d > 0 ? streetRight + 40 : streetLeft - 40;
      };
      const builtOn = (x) => [footprints, ...world.settlements.map((s) => s.footprints || [])]
        .some((spans) => spans.some(([a, c]) => x >= a - 6 && x <= c + 6));
      for (const d of neutral ? [-1, 1] : [dir]) {
        const start = front(d);
        // The line's own street end is where it starts, so only other works count as taken.
        const line = groundDefences(world, start, d, random, (x) => (x - start) * d > 0 && builtOn(x) && !(x >= streetLeft && x <= streetRight));
        if (!line) continue;
        settlement.defences.push(line);
        footprints.push(line.span);
      }
      world.settlements.push(settlement);
    }
    if (PW.generateDistricts) PW.generateDistricts(world, seed);
    return world.settlements;
  }

  PW.generateSettlements = generateSettlements;
  PW.settlementTools = { terracePad, paveStreet, carveBox, ladder, tunnelLamps, drawCrop, TUNNEL, PAVING };
})();
