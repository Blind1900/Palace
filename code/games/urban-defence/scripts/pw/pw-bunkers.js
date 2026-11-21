'use strict';
// Mountain bunkers (step C): each base builds itself into the forward massif of its half - a gun
// gallery carved out of the enemy-facing flank, behind a thick reinforced face. A horizontal
// embrasure runs out through the thin rock at the front, two angled ports open higher on the
// mountainside, and the rock round the whole chamber is reinforced with the military building
// material so it stands up to missiles. A ladder shaft drops from the rear of the gallery to a
// junction stub, ready for the tunnels (step H) to find. One bunker per base.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;
  const K = PW.buildingKit;
  const { S, STYLES, ROLE, tone, mix } = K;
  const rgb = (c) => PW.abgr(Math.max(0, Math.min(255, c[0])) | 0, Math.max(0, Math.min(255, c[1])) | 0, Math.max(0, Math.min(255, c[2])) | 0);

  const GALLERY_W = 150;        // clear width of the gun gallery
  const FRONT_WALL = 12;        // the firing wall, twice a normal wall, all reinforced
  const COVER = 8;              // rock kept over the roof at the shallowest point
  const SHELL = 6;              // reinforced rock ring round the carved box
  const EMBRASURE_MAX = 70;     // longest horizontal embrasure cut through the front rock
  const PORT_MAX = 64;          // longest 45-degree port up to the mountainside
  const REINF_C = [96, 104, 100], REINF_DARK = [74, 80, 78], REINF_LIT = [122, 130, 124];

  // ---- The gallery canvas ---------------------------------------------------------------------------
  function bunkerCanvas(options) {
    const style = options.style, facing = options.facing || 1, seed = options.seed || 1;
    const P = STYLES[style];
    const wall = S.WALL;
    const width = GALLERY_W + wall + FRONT_WALL;
    const coreDepth = K.VAULT_DEPTH + 3;
    const top = S.FLOOR + 10;
    const height = top + coreDepth + 20;
    const ground = height - coreDepth - 1;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'military', style, level: 2, variant: 'bunker', facing, seed };
    const X = (lx) => facing > 0 ? lx : width - 1 - lx;   // the firing wall is the facing side
    const rearLeft = 0, frontRight = width - 1;
    const fRow = ground;
    const innerLeft = Math.min(X(rearLeft + wall), X(frontRight - FRONT_WALL));
    const innerRight = Math.max(X(rearLeft + wall), X(frontRight - FRONT_WALL));
    // The gallery: one tall room, its back wall in the faction's finish.
    K.rect(c, innerLeft, fRow - S.CLEAR, innerRight, fRow - 1,
      (x, y) => K.back(c, x, y, K.backWallColor(style, x, y, fRow - 1 - y, innerLeft, innerRight)));
    // Rear wall in the faction material, with the door to the shaft landing.
    for (let d = 0; d < wall; d += 1) {
      for (let y = fRow - S.CLEAR - S.SLAB; y < fRow; y += 1) {
        K.solid(c, X(rearLeft + d), y, P.wallMat, K.wallColor(style, d, wall, fRow - 1 - y, X(rearLeft + d), y), ROLE.WALL);
      }
    }
    for (let d = 0; d < wall; d += 1) for (let y = fRow - S.DOOR_H; y < fRow; y += 1) { K.clear(c, X(rearLeft + d), y); K.back(c, X(rearLeft + d), y, tone(P.frame, 0.3)); }
    c.doors.push({ x: X(rearLeft), side: -facing, top: fRow - S.DOOR_H, bottom: fRow - 1 });
    // The firing wall: reinforced through its whole thickness, ribbed like plate.
    for (let d = 0; d < FRONT_WALL; d += 1) {
      for (let y = fRow - S.CLEAR - S.SLAB; y < fRow; y += 1) {
        const rib = (fRow - y) % 9 < 2, face = d === FRONT_WALL - 1 || d === 0;
        K.solid(c, X(frontRight - d), y, M.REINFORCED, rib ? REINF_DARK : face ? REINF_LIT : REINF_C, ROLE.WALL);
      }
    }
    // The embrasure: a slit through the firing wall at kneeling height, splayed on the inside,
    // with a step under it for the guard. (The cut carries on through the rock at placement.)
    const slitTop = fRow - 21, slitBottom = fRow - 15;
    for (let d = 0; d < FRONT_WALL; d += 1) {
      const splay = d > FRONT_WALL - 5 ? 0 : 1;   // wider in than out
      for (let y = slitTop - splay; y <= slitBottom + splay; y += 1) {
        K.clear(c, X(frontRight - d), y);
        K.back(c, X(frontRight - d), y, [18, 20, 22]);
      }
    }
    c.embrasure = { top: slitTop, bottom: slitBottom };
    for (let lx = frontRight - FRONT_WALL - 8; lx < frontRight - FRONT_WALL; lx += 1) {
      for (let y = fRow - 8; y < fRow; y += 1) K.solid(c, X(lx), y, M.PLATFORM, y === fRow - 8 ? tone(P.ornament, 0.85) : tone(P.frame, 0.78), ROLE.STAIR);
    }
    // Roof and floor slabs, reinforced.
    for (let lx = rearLeft; lx <= frontRight; lx += 1) {
      for (let row = 0; row < S.SLAB + 2; row += 1) {
        K.solid(c, X(lx), fRow - S.CLEAR - S.SLAB - row, M.REINFORCED, row === S.SLAB + 1 ? REINF_DARK : REINF_C, ROLE.ROOF);
        if ((c.mat[(fRow + row) * c.width + X(lx)] || 0) === 0) K.solid(c, X(lx), fRow + row, M.REINFORCED, REINF_DARK, ROLE.SLAB);
      }
    }
    // Furniture: ammunition and kit along the back of the gallery; lamps along the ceiling.
    const items = ['crate', 'rack', 'locker', 'console', 'crate'];
    let lx = rearLeft + wall + 8;
    for (let i = 0; i < items.length && lx < frontRight - FRONT_WALL - 44; i += 1) {
      K.FURNITURE[items[i]](c, Math.min(X(lx), X(lx + 24)), fRow, P);
      lx += { console: 30, rack: 26, locker: 18, crate: 24 }[items[i]];
    }
    for (let qx = rearLeft + 18; qx < frontRight - 16; qx += 44) K.ceilingLamp(c, style, X(qx), fRow - S.CLEAR);
    c.floors.push({ storey: 0, y: fRow, left: innerLeft, right: innerRight });
    c.slots.push({ x: X(rearLeft + 26), y: fRow, storey: 0, facing });
    // A pair of cores in vaults under the gallery floor.
    for (const cx of [40, width - 50]) K.core(c, X(cx), ground);
    K.corePillars(c, style);
    K.bakeLights(c, style);
    c.body = { left: 0, right: width - 1, top: fRow - S.CLEAR - S.SLAB - 2, bottom: ground - 1 };
    return c;
  }

  // ---- Carving the bunker into a flank ---------------------------------------------------------------
  function put(world, x, y, mat, color, owner) {
    if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return;
    PW.set(world, x, y, mat, { quiet: true });
    PW.setLayer(world, 'paint', x, y, rgb(color));
    PW.setLayer(world, 'deco', x, y, 0);
    if (owner) PW.setOwner(world, x, y, owner);
  }
  const solidRock = (world, x, y) => {
    const id = PW.get(world, x, y) & ID_MASK;
    return id !== M.AIR && id !== M.WATER && PW.mat.ground[id];
  };

  // The reinforced ring: every rock cell within SHELL of the box (and not inside it) becomes
  // reinforced lining, so the chamber shrugs off the blasts that reach it.
  function reinforce(world, x0, y0, x1, y1, owner) {
    for (let y = y0 - SHELL; y <= y1 + SHELL; y += 1) {
      for (let x = x0 - SHELL; x <= x1 + SHELL; x += 1) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
        if (!solidRock(world, x, y)) continue;
        const edge = x < x0 - SHELL + 1 || x > x1 + SHELL - 1 || y < y0 - SHELL + 1 || y > y1 + SHELL - 1;
        const stud = (x & 7) === 0 && (y & 7) === 0;
        put(world, x, y, M.REINFORCED, edge ? REINF_DARK : stud ? REINF_LIT : REINF_C, owner);
      }
    }
  }

  // Cut an opening from (x, y) stepping by (dx, dy) until it breaks into daylight. It is a
  // FIGHTING POSITION, finished like the works it serves (the user's note: the holes must read
  // as places to garrison behind and shoot out of, merged with the walls): ribbed dark concrete
  // inside, lit warm at the inner end so it reads manned; a studded tread course underfoot and
  // plain reinforcement over; a hazard-tipped armour sill at the inner mouth to shoot over; the
  // outer third splays open and wears a darker cast collar at the breach. Gives up (and fills
  // nothing back) if the rock runs on past `max` steps. Returns the columns it cut, so the wild
  // can be kept off the opening's mouth.
  function cutOpening(world, x, y, dx, dy, halfH, max, owner) {
    // N32 reopen: the run ends the moment the cover over it thins to a skin - a port at
    // the face's own angle used to run on UNDER the skin to the ridge, a long dark stroke
    // that read as a slab jutting from the mountainside. Short and practical, as asked.
    const coverAbove = (cx, topY) => {
      let n = 0;
      for (let u = 1; u <= 4; u += 1) { if (solidRock(world, cx, topY - u)) n += 1; else break; }
      return n;
    };
    let d = 0;
    while (d < max) {
      const nx = x + dx * (d + 1), topY = y + dy * (d + 1) - halfH;
      if (!solidRock(world, nx, topY)) break;
      d += 1;
      if (coverAbove(nx, topY) <= 2) break;   // the skin: the mouth opens here
    }
    if (d >= max) return null;
    // N32 refine: the mouth flares continuously - walls easing open a cell every couple
    // of steps, to four at most, timed to ARRIVE at the face - so a rifle at the sill
    // traverses wide of the axis (a real embrasure's splay) while the throat stays
    // trooper-sized the whole way in: never wider than the flare needs, the pipe's own
    // rule. The old +1 at one fixed step was the sharp cut-off the user called out.
    const flareFrom = Math.max(2, d - 11);
    const splay = (t) => halfH + Math.min(4, Math.max(0, Math.round((t - flareFrom) * 0.45)));
    for (let t = 0; t <= d; t += 1) {
      const cx = x + dx * t, cy = y + dy * t;
      const hh = splay(t);
      for (let k = -hh; k <= hh; k += 1) {
        // N32 reopen: the hole FOLLOWS THE WALL - a cell at or above its own column's
        // surface line is the open mountainside, and nothing is ever painted there. The
        // old bare-air test let the channel ride out over the face wherever the rock
        // backdrop carried a back layer, and the mouth jutted at its top end and corner
        // (the user's screenshots, twice over).
        if (cy + k <= world.groundTop[cx]) continue;
        const id = PW.get(world, cx, cy + k) & ID_MASK;
        if (id !== M.AIR) PW.set(world, cx, cy + k, M.AIR, { quiet: true });
        PW.setLayer(world, 'deco', cx, cy + k, 0);
        const rib = (t % 6) === 1;
        const glow = Math.max(0, 1 - t / 7) * 0.5;
        const base = rib ? 34 : 21;
        PW.setLayer(world, 'back', cx, cy + k, rgb([base + 46 * glow, base + 2 + 38 * glow, base + 5 + 18 * glow]));
        PW.setFlag(world, cx, cy + k, FLAG.TUNNEL | FLAG.CARVED);
      }
      const collar = t >= d - 2;
      for (const k of [-hh - 1, hh + 1]) {
        if (cy + k <= world.groundTop[cx]) continue;   // the lining never rises past the face
        const beside = PW.get(world, cx, cy + k) & ID_MASK;
        if (beside === M.AIR || !PW.mat.terrain[beside]) continue;
        const tread = k > 0 && (t & 3) === 0 && !collar;
        put(world, cx, cy + k, M.REINFORCED, collar ? REINF_DARK : tread ? REINF_LIT : REINF_C, owner);
      }
    }
    // The mouth notch: the thin skin left over the outer end is opened flush with the face,
    // unlined, so the port ENDS at the terrain with a clean slot - never a lip past it.
    for (let u = 1; u <= 3; u += 1) {
      const sxx = x + dx * d, sy = y + dy * d - splay(d) - u;
      if (!solidRock(world, sxx, sy)) break;
      PW.set(world, sxx, sy, M.AIR, { quiet: true });
      PW.setLayer(world, 'deco', sxx, sy, 0);
    }
    // N32 refine: no sharp cut-off at either end - the corners smooth out and MERGE.
    // At the mouth, the lip's top and bottom corners ease a cell at a time into the
    // bare mountainside (and stay unlined there, so the opening runs out INTO terrain);
    // at the fighting end, the top corner eases into the gallery the same way.
    const chamfer = (cx, cy) => {
      if (cy <= world.groundTop[cx]) return;
      const id = PW.get(world, cx, cy) & ID_MASK;
      // rock OR the pass's own collar cell: the corner ends bare, run out into terrain
      if (id === M.AIR || (!PW.mat.terrain[id] && id !== M.REINFORCED)) return;
      PW.set(world, cx, cy, M.AIR, { quiet: true });
      if (id === M.REINFORCED) PW.setOwner(world, cx, cy, 0);
      PW.setLayer(world, 'deco', cx, cy, 0);
      PW.setFlag(world, cx, cy, FLAG.TUNNEL | FLAG.CARVED);
    };
    for (const [t, grow] of [[d, 2], [d - 1, 1]]) {
      if (t < 2) continue;
      const cx = x + dx * t, cy = y + dy * t, hh = splay(t);
      for (let g = 1; g <= grow; g += 1) { chamfer(cx, cy - hh - g); chamfer(cx, cy + hh + g); }
    }
    if (d >= 4) chamfer(x, y - halfH - 1);
    // ...and no nub left to hang: a cell the corner cut isolated (one solid neighbour or
    // none) goes with it, twice over, so a rockslide later finds nothing floating here.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let t = Math.max(0, d - 3); t <= d; t += 1) {
        const cx = x + dx * t, cy = y + dy * t, hh = splay(t);
        for (let k = -(hh + 3); k <= hh + 3; k += 1) {
          const yy = cy + k;
          if (yy <= world.groundTop[cx]) continue;
          const id = PW.get(world, cx, yy) & ID_MASK;
          if (id === M.AIR || (!PW.mat.terrain[id] && id !== M.REINFORCED)) continue;
          let n = 0;
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if ((PW.get(world, cx + ax, yy + ay) & ID_MASK) !== M.AIR) n += 1;
          }
          if (n <= 1) chamfer(cx, yy);
        }
      }
    }
    // The sill at the fighting end: two armour cells with a hazard tip, cover to shoot over.
    for (const t of [0, 1]) {
      const sx = x + dx * t, sy = y + dy * t + halfH;
      put(world, sx, sy, M.REINFORCED, t === 0 ? [230, 184, 40] : REINF_LIT, owner);
    }
    return { x0: Math.min(x, x + dx * d), x1: Math.max(x, x + dx * d) };
  }

  function generate(world, layout, seed) {
    if (!PW.buildingTypes || !K) return;
    const W = world.width, centre = W / 2;
    world.bunkers = [];
    for (const side of ['left', 'right']) {
      const facing = side === 'left' ? 1 : -1;
      const style = world.styles[side];
      // The forward massif: the mountain of this half nearest the centre, big enough to hold a
      // gallery in its flank.
      // (the middle of the map belongs to no one: a bunker keeps the same distance the outposts do)
      const mine = layout.mountains.filter((m) => (side === 'left' ? m.x < centre : m.x > centre)
        && m.height >= 500 && Math.abs(m.x - centre) > W * 0.06)
        .sort((a, b) => facing > 0 ? b.x - a.x : a.x - b.x);
      let placed = false;
      for (const m of mine) {
        if (placed) break;
        const peak = Math.round(m.x);
        const canvas = bunkerCanvas({ style, facing, seed: seed + peak });
        const BW = canvas.width;
        // Walk down the enemy-facing flank looking for a stretch where the box fits: the front
        // deep enough for the embrasure, the rear still under thick cover, no outpost works.
        for (let step = 30; step < m.half * 0.9 && !placed; step += 10) {
          const xF = peak + facing * step;                         // the firing wall's column
          const xR = xF - facing * (BW - 1);                       // the rear wall's column
          if (xF < 40 || xF > W - 40 || xR < 40 || xR > W - 40) break;
          if ((world.outposts || []).some((p) => Math.min(xF, xR) - 40 < p.footprints[0][1] && Math.max(xF, xR) + 40 > p.footprints[0][0])) continue;
          const surfF = world.groundTop[xF];
          const ground = surfF + S.CLEAR + S.SLAB * 2 + 4 + COVER * 2;   // box fully behind the face
          const roofTop = ground - S.CLEAR - S.SLAB * 2 - 4;
          // Every column of the box must be buried: surface above the roof, by COVER at least.
          let buried = true;
          for (let x = Math.min(xF, xR); x <= Math.max(xF, xR); x += 1) if (world.groundTop[x] > roofTop - COVER) { buried = false; break; }
          if (!buried) continue;
          // And the embrasure must reach daylight within its run.
          const slitY = ground - 18;
          let run = 0;
          while (run < EMBRASURE_MAX && solidRock(world, xF + facing * (run + 1), slitY)) run += 1;
          if (run >= EMBRASURE_MAX) continue;
          const id = world.buildings.length + 1;
          const canvasX = facing > 0 ? xR : xF;
          const stamp = PW.stampBuilding(world, canvas, canvasX, ground, { owner: id });
          reinforce(world, canvasX, roofTop - 2, canvasX + BW - 1, ground + K.VAULT_DEPTH + 2, id);
          const cuts = [];
          // The embrasure runs on through the rock to daylight...
          // (halfH 4: a window a trooper can shoot through AND crawl out of - the reopen's rule)
          cuts.push(cutOpening(world, xF + facing, slitY, facing, 0, 4, EMBRASURE_MAX, id));
          // ...and two ports climb from under the gallery ceiling to openings higher on the
          // mountainside.
          for (const back of [Math.round(BW * 0.18), Math.round(BW * 0.42)]) {
            cuts.push(cutOpening(world, xF - facing * back, ground - S.CLEAR + 3, facing, -1, 4, PORT_MAX, id));
          }
          // The shaft: a ladder drop from outside the rear door down to a junction stub for the
          // tunnels to find (step H).
          const shaftX = xR - facing * (SHELL + 4);
          const shaftTop = ground, shaftBottom = ground + 60;
          // N35: the shaft and its junction stub are BUILT works, not black cuts - the user's
          // screenshot read them as core matter severed from the generation. The shaft is
          // lined through the rock, its back the tunnel-lab tone; the stub below is a carved,
          // lit chamber in the same language as every mine room, waiting for step H.
          const T = PW.settlementTools;
          PW.bunkers.reinforce(world, shaftX - 7, shaftTop - S.DOOR_H, shaftX + 7, shaftBottom + 26, id);
          for (let y = shaftTop - S.DOOR_H; y <= shaftBottom; y += 1) {
            for (let dx = -7; dx <= 7; dx += 1) {
              if (PW.get(world, shaftX + dx, y) & ID_MASK) PW.set(world, shaftX + dx, y, M.AIR, { quiet: true });
              const tk = Math.abs(dx) >= 6 ? 0.62 : 0.78;
              PW.setLayer(world, 'back', shaftX + dx, y, rgb([T.TUNNEL.back[0] * tk, T.TUNNEL.back[1] * tk, T.TUNNEL.back[2] * tk]));
              PW.setLayer(world, 'deco', shaftX + dx, y, 0);
            }
          }
          PW.settlementTools.ladder(world, shaftX - 6, shaftTop - S.DOOR_H + 4, shaftBottom - 2);
          T.carveBox(world, shaftX - 16, shaftBottom + 2, shaftX + 16, shaftBottom + 24, id, 4);
          T.tunnelLamps(world, shaftX - 16, shaftX + 16, shaftBottom + 4, 64);
          PW.setFlag(world, shaftX, shaftBottom + 12, FLAG.TUNNEL);
          // (a passage from the gallery door to the shaft)
          for (let y = ground - S.DOOR_H; y < ground; y += 1) {
            for (let x = Math.min(shaftX + 7, xR); x <= Math.max(shaftX + 7, xR); x += 1) {
              if (PW.get(world, x, y) & ID_MASK) PW.set(world, x, y, M.AIR, { quiet: true });
              PW.setLayer(world, 'back', x, y, rgb([26, 28, 30]));
            }
          }
          const record = PW.buildingRecord(world, stamp, { id, side, style, type: 'military', variant: 'bunker',
            level: 2, facing, neutral: false, underConstruction: false, works: [Math.min(xF, xR) - SHELL, Math.max(xF, xR) + SHELL], plant: null,
            base: { G: ground, walls: [], under: null, cores: canvas.cores.map((q) => ({ x: canvasX + q.x, y: ground + q.y - canvas.ground })) } });
          world.buildings.push(record);
          // Everything that broke the surface - the works and every opening's mouth - keeps the
          // wild off it (pw-gen-vegetation's blockedColumns reads these).
          const spans = [[record.works[0], record.works[1]], [Math.min(shaftX - 8, xR), Math.max(shaftX + 8, xR)],
            ...cuts.filter(Boolean).map((q) => [q.x0 - 2, q.x1 + 2])];
          world.bunkers.push({ side, style, building: record, peak, front: xF,
            shaft: { x: shaftX, top: shaftTop, bottom: shaftBottom },
            footprints: [[Math.min(...spans.map((q) => q[0])), Math.max(...spans.map((q) => q[1]))]] });
          placed = true;
        }
      }
    }
  }

  PW.bunkers = { generate, bunkerCanvas, cutOpening, reinforce };
})();
