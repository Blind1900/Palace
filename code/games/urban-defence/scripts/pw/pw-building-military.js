'use strict';
// Military compounds (hangar + rear block, variants compound / fortress / command / bastion) and the
// main-base core bunker (core orb in a sunken pit under a floating armoured block).
(function () {
  const PW = window.PW;
  const { M } = PW;
  const K = PW.buildingKit;
  const O = () => PW.buildingOrnaments;
  const { S, STYLES, ROLE, tone, mix } = K;
  const MILITARY_VARIANTS = ['compound', 'fortress', 'command', 'bastion'];

  // Hangar sized for the fleet at real scale: jets ~180 cells long, mechs ~85 tall, tanks ~120 long.
  const HANGAR = Object.freeze({ width: 260, clear: 108, door: 100, wall: 8, vaultRise: 30, vaultThick: 7 });
  // N57: the growth system's bases went vertical - the hangar NARROWER (a jet still just fits)
  // and the blocks a storey taller; the fleet's room is the runway outside, not floor. Passed
  // as options.vertical by the lab: the fixed worldgen keeps its proportions (changing them
  // under the towns reflowed the ruins and broke the core-rise and collapse checks on seed 3).
  const HANGAR_VERTICAL_WIDTH = 210;

  // N52: the military skin - geometric plate armour in gunmetal, read from the sci-fi base
  // references but drawn in the game's own sprite voice. Large flat panels with recessed seams,
  // joints staggered course by course, a rivet at the odd crossing; each style tints the metal
  // its own way. Colours only: the walls keep their materials and their exact widths.
  const MIL_TINT = { modern: [96, 102, 110], gothic: [84, 86, 94], asian: [100, 102, 92] };
  const MIL_SEAM = { modern: [54, 58, 64], gothic: [46, 48, 54], asian: [56, 58, 50] };
  // N59: the plating takes its setting's tone - gunmetal in the city, olive-khaki among the
  // farms, stone-grey in the mountains (the fixed worldgen passes no setting and keeps the
  // city tone exactly).
  const SETTING_TINT = { farm: [104, 100, 78], mountain: [98, 98, 94] };
  const SETTING_SEAM = { farm: [58, 55, 42], mountain: [54, 54, 50] };
  function milPlate(style, d, total, rise, x, y, setting) {
    const base = (setting && SETTING_TINT[setting]) || MIL_TINT[style] || MIL_TINT.modern;
    const seam = (setting && SETTING_SEAM[setting]) || MIL_SEAM[style] || MIL_SEAM.modern;
    const course = Math.floor(rise / 12);
    const stagger = (course & 1) * 9;
    const seamRow = rise % 12 === 0;
    const seamCol = ((x + stagger) % 18) === 0;
    if (seamRow || seamCol) return seam;
    if (rise % 12 === 6 && ((x + stagger) % 18) === 9) return tone(seam, 1.35);           // rivet
    const edge = d === 0 ? 1.18 : d === total - 1 ? 0.72 : 1;                             // lit face, shadowed core
    return tone(base, edge * (1 - (course % 3) * 0.045) * ((PW.hash2(x, y) & 7) === 0 ? 0.93 : 1));
  }
  const MIL_AMBER = [235, 182, 52], MIL_CYAN = [118, 214, 232];

  function militaryBase(options) {
    const style = options.style, level = options.level || 3, variant = options.variant || 'compound';
    const facing = options.facing || 1;   // +1: hangar door faces right (towards the enemy)
    const seed = options.seed || 1;
    const random = PW.createRandom(seed);
    const P = STYLES[style];
    // An outpost is the block alone, with no hangar: a fortified blockhouse with a watchtower, the
    // kind that holds a mountain top or a pass.
    const hangar = variant !== 'outpost';
    const vertical = !!options.vertical;   // N57: the growth system's taller, narrower proportions
    const setting = options.setting || null;   // N59: 'farm' | 'mountain' dress the base for its ground
    const sTint = (setting && SETTING_TINT[setting]) || MIL_TINT[style] || MIL_TINT.modern;
    const rearStoreys = { compound: 2, fortress: 3, command: 4, bastion: 1, outpost: 2 }[variant] + (level >= 5 ? 1 : 0) + (vertical ? 1 : 0);
    const rearWidth = 140;
    const hw = vertical ? HANGAR_VERTICAL_WIDTH : HANGAR.width;
    const bodyWidth = hangar ? rearWidth + hw - HANGAR.wall : rearWidth;
    const margin = 44, coreDepth = K.VAULT_DEPTH + 3;
    const top = hangar ? Math.max(rearStoreys * S.FLOOR + 120, HANGAR.clear + HANGAR.vaultRise + 90) : rearStoreys * S.FLOOR + 130;
    const width = bodyWidth + margin * 2, height = top + coreDepth + 20;
    const ground = height - coreDepth - 1;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'military', style, level, variant, facing, seed };
    // Work in "front-right" coordinates and mirror x when the building faces left.
    const X = (lx) => facing > 0 ? margin + lx : margin + bodyWidth - 1 - lx;
    const floorRow = (k) => ground - k * S.FLOOR;
    const rearLeft = 0, rearRight = rearWidth - 1;
    const hangarLeft = rearWidth - HANGAR.wall, hangarRight = bodyWidth - 1;
    const wallTop = ground - HANGAR.clear;

    // ---- Rear block: storeys with stairs and military rooms ----
    const rearFloors = [];
    for (let k = 0; k < rearStoreys; k += 1) {
      const fRow = floorRow(k);
      const narrow = variant === 'command' && k >= 2;
      const left = narrow ? rearLeft + 24 : rearLeft, right = narrow ? rearRight - 18 : rearRight;
      rearFloors.push({ k, left, right });
      const innerLeft = Math.min(X(left + S.WALL), X(right - S.WALL)), innerRight = Math.max(X(left + S.WALL), X(right - S.WALL));
      K.rect(c, innerLeft, fRow - S.CLEAR, innerRight, fRow - 1,
        (x, y) => K.back(c, x, y, K.backWallColor(style, x, y, fRow - 1 - y, innerLeft, innerRight)));
      for (let wx = innerLeft + 10; wx < innerRight - 22; wx += 34) {
        if (Math.abs(wx - (innerLeft + innerRight) / 2) < 36) continue;
        K.backWindow(c, style, wx, fRow, (PW.hash2(wx, k + seed) & 3) !== 0);
      }
      // Walls (the hangar-side wall of the ground storey is shared with the hangar).
      for (const lx of [left, right]) {
        const side = lx === left ? -1 : 1;
        for (let d = 0; d < S.WALL; d += 1) {
          const wx = X(lx - side * d);
          for (let y = floorRow(k + 1); y < fRow; y += 1) K.solid(c, wx, y, P.wallMat, milPlate(style, d, S.WALL, fRow - 1 - y, wx, y, setting), ROLE.WALL);
        }
      }
      // N52: the glazing is embrasure slits - two long horizontal cuts per storey, dark glass
      // with the lamp behind it, instead of the town's tall window band. The command cab alone
      // keeps its full glazing, a lit bridge over the base.
      const cab = variant === 'command' && k === rearStoreys - 1;
      for (const lx of [left, right]) {
        const side = lx === left ? -1 : 1;
        if (k === 0 && lx === right && hangar) continue;
        if (cab) {
          for (let d = 0; d < S.WALL; d += 1) for (let y = fRow - 32; y <= fRow - 12; y += 1) {
            K.solid(c, X(lx - side * d), y, M.GLASS, mix(K.GLASS_SIDE, P.lamp, 0.55), ROLE.GLASS);
          }
          continue;
        }
        for (const [sTop, sBot] of [[fRow - 16, fRow - 13], [fRow - 27, fRow - 24]]) {
          for (let d = 0; d < S.WALL; d += 1) for (let y = sTop; y <= sBot; y += 1) {
            K.solid(c, X(lx - side * d), y, M.GLASS, mix([26, 30, 36], P.lamp, y === sTop + 1 ? 0.5 : 0.22), ROLE.GLASS);
          }
        }
      }
      // Furniture: consoles, racks, lockers and crates.
      const items = ['console', 'rack', 'locker', 'crate', 'console'];
      let x = left + S.WALL + 6;
      for (let i = 0; i < items.length && x < right - S.WALL - 30; i += 1) {
        if (Math.abs(x - (left + right) / 2) < 34) { x += 50; continue; }
        const name = items[(i + k) % items.length];
        K.FURNITURE[name](c, Math.min(X(x), X(x + 24)), fRow, P);
        x += { console: 30, rack: 26, locker: 18, crate: 24 }[name];
      }
      for (let lx = left + 20; lx < right - 14; lx += 44) K.ceilingLamp(c, style, X(lx), fRow - S.CLEAR);
      c.floors.push({ storey: k, y: fRow, left: Math.min(X(left + S.WALL), X(right - S.WALL)), right: Math.max(X(left + S.WALL), X(right - S.WALL)) });
      c.slots.push({ x: X(left + 30), y: fRow, storey: k, facing });
    }
    for (let k = 1; k <= rearStoreys; k += 1) {
      const below = rearFloors[k - 1];
      for (let row = 0; row < S.SLAB; row += 1) for (let lx = below.left; lx <= below.right; lx += 1) {
        K.solid(c, X(lx), floorRow(k) + row, M.CONCRETE, K.slabColor(style, row, X(lx), floorRow(k) + row), k === rearStoreys ? ROLE.ROOF : ROLE.SLAB);
      }
    }
    // Rear stairs (centre of the block).
    const bandLeft = Math.round(rearWidth / 2 - (S.STAIR_RUN + 2 * S.LANDING) / 2);
    for (let k = 0; k < rearStoreys - 1; k += 1) {
      const dir = k % 2 === 0 ? 1 : -1;
      const start = dir > 0 ? bandLeft + S.LANDING : bandLeft + S.LANDING + S.STAIR_RUN - 1;
      for (let i = 0; i < S.STAIR_RUN / S.STEP; i += 1) {
        const surface = floorRow(k) - S.STEP * (i + 1);
        for (let j = 0; j < S.STEP; j += 1) for (let y = surface; y < Math.min(floorRow(k), surface + S.STEP + S.STAIR_THICK); y += 1) {
          K.solid(c, X(start + dir * (i * S.STEP + j)), y, M.PLATFORM, y === surface ? tone(P.ornament, 0.85) : tone(P.frame, 0.78), ROLE.STAIR);
        }
      }
      for (let lx = Math.min(start, start + dir * 39) - 2; lx <= Math.max(start, start + dir * 39) + 2; lx += 1) {
        for (let row = 0; row < S.SLAB; row += 1) {
          const i = (floorRow(k + 1) + row) * c.width + X(lx);
          if (c.role[i] === ROLE.SLAB) c.mat[i] = M.PLATFORM;
        }
      }
      c.stairs.push({ storey: k, dir: dir * facing, from: X(start), to: X(start + dir * 39), floorRow: floorRow(k), upperRow: floorRow(k + 1) });
    }
    // N64: the rear block's roof carries the stair chain's grated drain hatch (the switchback's
    // next flight position). Paint and a stamp-time HATCH flag only - the cells stay roof
    // concrete, so collapse is untouched; the water rule drains the roof down the stairwell.
    {
      const k = rearStoreys - 1;
      const dir = k % 2 === 0 ? 1 : -1;
      const start = dir > 0 ? bandLeft + S.LANDING : bandLeft + S.LANDING + S.STAIR_RUN - 1;
      const lo = Math.min(start, start + dir * 39) - 2, hi = Math.max(start, start + dir * 39) + 2;
      const mid = (lo + hi) / 2;
      for (let lx = lo; lx <= hi; lx += 1) {
        const slit = Math.abs(lx - mid) % 4 < 2;
        for (let row = 0; row < S.SLAB; row += 1) {
          const i = (floorRow(rearStoreys) + row) * c.width + X(lx);
          if (c.role[i] === ROLE.ROOF) c.paint[i] = K.pack(tone(K.slabColor(style, row, X(lx), floorRow(rearStoreys) + row), slit ? 0.55 : 0.95));
        }
      }
      // (reaching 6 rows up through the roof covering - coping, ridge trim, a parapet course -
      // so styled roofs drain too; only solid cells in the reach are ever flagged)
      c.hatches.push({ x0: Math.min(X(lo), X(hi)), x1: Math.max(X(lo), X(hi)), y0: floorRow(rearStoreys) - 6, y1: floorRow(rearStoreys) + S.SLAB - 1 });
    }
    // Rear door on the far side (except the bastion's buried glacis side); an outpost has a door
    // on either side.
    if (variant !== 'bastion') {
      for (let d = 0; d < S.WALL; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(rearLeft + d), y); K.back(c, X(rearLeft + d), y, tone(P.frame, 0.3)); }
      c.doors.push({ x: X(rearLeft), side: -facing, top: ground - S.DOOR_H, bottom: ground - 1 });
    }
    if (!hangar) {
      for (let d = 0; d < S.WALL; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(rearRight - d), y); K.back(c, X(rearRight - d), y, tone(P.frame, 0.3)); }
      c.doors.push({ x: X(rearRight), side: facing, top: ground - S.DOOR_H, bottom: ground - 1 });
    }
    // ---- Hangar (roof: a vault for compound/command, a flat armoured roof with battlements otherwise) ----
    const vault = variant === 'compound' || variant === 'command';
    const hx0 = hangarLeft, hx1 = hangarRight, hcx = (hx0 + hx1) / 2, half = (hx1 - hx0) / 2 + 1;
    if (hangar) {
      K.rect(c, Math.min(X(hangarLeft + HANGAR.wall), X(hangarRight - HANGAR.wall)), wallTop, Math.max(X(hangarLeft + HANGAR.wall), X(hangarRight - HANGAR.wall)), ground - 1, (x, y) => {
        const rise = ground - 1 - y;
        const rib = Math.abs(x - X(hangarLeft)) % 36 < 3;
        let color = tone(P.frame, rib ? 0.36 : 0.3);
        if (rise < 3) color = (Math.floor(x / 8) % 2) ? [230, 196, 60] : [40, 40, 44];   // hazard stripe on the floor edge
        else if (rise === 70 || rise === 71) color = tone(P.frame, 0.42);
        K.back(c, x, y, color);
      });
      for (let lx = hangarLeft + 30; lx < hangarRight - 20; lx += 52) K.ceilingLamp(c, style, X(lx), wallTop + 2);
      // Hangar walls: shared rear wall already drawn; front wall with the big door.
      for (let d = 0; d < HANGAR.wall; d += 1) {
        const wx = X(hangarRight - d);
        for (let y = wallTop; y < ground; y += 1) {
          if (y >= ground - HANGAR.door) continue;
          K.solid(c, wx, y, M.STEEL, milPlate(style, d, HANGAR.wall, ground - 1 - y, wx, y, setting), ROLE.WALL);
        }
        // Door frame, with a warning light either side of the lintel (N52).
        K.solid(c, wx, ground - HANGAR.door - 1, M.STEEL, d === 1 || d === HANGAR.wall - 2 ? MIL_AMBER : P.ornament, ROLE.FRAME);
      }
      // Upper rear wall of the hangar where it rises above the rear block's ground storey.
      for (let d = 0; d < HANGAR.wall; d += 1) {
        const wx = X(hangarLeft + d);
        for (let y = wallTop; y < ground - S.FLOOR; y += 1) {
          if (!K.isSolid(c, wx, y)) K.solid(c, wx, y, P.wallMat, milPlate(style, d, HANGAR.wall, ground - 1 - y, wx, y, setting), ROLE.WALL);
        }
      }
      // Inner door between rear block and hangar.
      for (let d = 0; d < S.WALL + 2; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) {
        K.clear(c, X(hangarLeft - 4 + d), y);
        K.back(c, X(hangarLeft - 4 + d), y, tone(P.frame, 0.3));
      }
      for (let lx = hx0; lx <= hx1; lx += 1) {
        const u = (lx - hcx) / half;
        const rise = vault ? Math.round(HANGAR.vaultRise * Math.sqrt(Math.max(0, 1 - u * u))) : 0;
        const thick = vault ? HANGAR.vaultThick : 8;
        for (let t = 0; t < thick; t += 1) {
          const y = wallTop - rise - t + (vault ? HANGAR.vaultThick - 1 : 0);
          const rib = lx % 18 < 2;
          const color = t === thick - 1 ? tone(P.roofLight, 1.05) : rib ? tone(P.roof, 0.8) : tone(P.roof, 1 - t * 0.02);
          K.solid(c, X(lx), y, M.STEEL, color, ROLE.ROOF);
        }
        // Fill under the vault so the hangar ceiling is closed.
        if (vault) for (let y = wallTop - rise + HANGAR.vaultThick; y < wallTop + 1; y += 1) K.back(c, X(lx), y, tone(P.frame, 0.26));
      }
      if (!vault && O()) {
        const roofRow = wallTop - 8 + 1;
        for (let lx = hx0; lx <= hx1; lx += 1) {
          if ((lx - hx0) % 16 < 8) for (let dy = 1; dy <= 8; dy += 1) K.solid(c, X(lx), roofRow - dy, M.MASONRY, tone(P.frame, 1.05), ROLE.ORNAMENT);
        }
      }
      // Primary core standing on the hangar floor at its back.
      K.core(c, X(hangarLeft + 34), ground, { standing: true });
      c.hangar = { left: Math.min(X(hx0), X(hx1)), right: Math.max(X(hx0), X(hx1)), top: wallTop, bottom: ground - 1,
        door: { x: X(hangarRight), top: ground - HANGAR.door, bottom: ground - 1 }, spawn: { x: X(hangarLeft + 80), y: ground } };
    }
    // The hackable control panel is on the top floor of the rear block.
    const topFloor = rearFloors[rearStoreys - 1];
    const panelLocal = topFloor.left + S.WALL + 8;
    PW.buildingPanel(c, style, Math.min(X(panelLocal), X(panelLocal + 17)), floorRow(rearStoreys - 1));
    c.panels.push({ x: X(panelLocal + 9), y: floorRow(rearStoreys - 1), storey: rearStoreys - 1 });

    // ---- Variant extras ----
    const roofTop = floorRow(rearStoreys);
    const rearRoof = { left: Math.min(X(rearFloors[rearStoreys - 1].left), X(rearFloors[rearStoreys - 1].right)),
      right: Math.max(X(rearFloors[rearStoreys - 1].left), X(rearFloors[rearStoreys - 1].right)), y: roofTop, top: true };
    // N52: the geometric silhouette. Chamfer wedges armour the roof's corners (45-degree steps
    // rising inward), a parapet lip runs between them, and a recessed light strip underlines
    // each storey's slab - amber at the ground, cool cyan above, the hyper-military read.
    {
      const w0 = rearRoof.left, w1 = rearRoof.right;
      const sSeam = (setting && SETTING_SEAM[setting]) || MIL_SEAM[style] || MIL_SEAM.modern;
      for (let s = 0; s < 7; s += 1) {
        for (let d = 0; d <= s; d += 1) {
          const col = tone(sTint, d === s ? 1.2 : 0.95);
          K.solidIfEmpty(c, w0 + s, roofTop - 1 - d, M.STEEL, col, ROLE.ORNAMENT);
          K.solidIfEmpty(c, w1 - s, roofTop - 1 - d, M.STEEL, col, ROLE.ORNAMENT);
        }
      }
      for (let x = w0 + 8; x <= w1 - 8; x += 1) {
        K.solidIfEmpty(c, x, roofTop - 2, M.STEEL, tone(sSeam, (x & 7) === 0 ? 1.5 : 1.1), ROLE.ORNAMENT);
      }
      // N59: the base dresses for where it stands - its detail joins the land's own.
      if (setting === 'farm' && hangar) {
        for (const [bx, bw] of [[hangarLeft + 54, 11], [hangarLeft + 68, 9]]) {    // hay bales by the door wall
          for (let dx = 0; dx < bw; dx += 1) for (let dy = 1; dy <= 6 - Math.abs(dx - (bw >> 1)) / 2; dy += 1) {
            K.solidIfEmpty(c, X(bx + dx), ground - dy, M.COVER_WOOD, tone([188, 160, 92], (dx + dy) % 3 ? 1 : 0.86), ROLE.ORNAMENT);
          }
        }
        for (let x = rearRoof.left + 4; x <= rearRoof.right - 4; x += 2) {         // camo net over the roof
          if ((x & 6) === 0) continue;
          K.deco(c, x, roofTop - 3 - ((x >> 1) % 3), [96, 108, 66]);
        }
      } else if (setting === 'mountain') {
        for (const lxBase of [rearLeft, rearRight]) {                              // stone revetment at the feet
          const side2 = lxBase === rearLeft ? -1 : 1;
          for (let d = 0; d < S.WALL; d += 1) for (let dy = 1; dy <= 7; dy += 1) {
            const wx = X(lxBase - side2 * d), wy = ground - dy;
            const i = wy * c.width + wx;
            if (c.role[i] === ROLE.WALL) c.paint[i] = K.pack(tone([128, 126, 120], (wx + (dy >> 1)) % 5 === 0 ? 0.78 : 1 - d * 0.05));
          }
        }
        if (hangar) for (const [rx, rw] of [[hangarLeft + 46, 8], [hangarLeft + 60, 5]]) {   // fallen rock kept in the bay
          for (let dx = 0; dx < rw; dx += 1) for (let dy = 1; dy <= 4 - Math.abs(dx - (rw >> 1)); dy += 1) {
            K.solidIfEmpty(c, X(rx + dx), ground - dy, M.COVER_ROCK, tone([118, 116, 110], (dx ^ dy) & 1 ? 1 : 0.85), ROLE.ORNAMENT);
          }
        }
      }
      for (let k = 0; k < rearStoreys; k += 1) {
        const f = rearFloors[k];
        const lx0 = Math.min(X(f.left), X(f.right)), lx1 = Math.max(X(f.left), X(f.right));
        const row = floorRow(k + 1) + S.SLAB;
        for (let x = lx0 + 3; x <= lx1 - 3; x += 1) {
          if ((x - lx0) % 6 >= 3) continue;
          K.deco(c, x, row, k === 0 ? MIL_AMBER : tone(MIL_CYAN, 0.8));
        }
      }
      if (variant === 'command') {
        // The sensor mast: a slim lattice with a blinker, off-centre on the roof, its foot
        // standing on the roof slab (a mast anchored above it floated - the seed-3 catch).
        const mx = Math.round(w0 + (w1 - w0) * 0.3);
        for (let dy = 0; dy <= 25; dy += 1) {
          K.solidIfEmpty(c, mx, roofTop - 1 - dy, M.STEEL, (dy % 5) === 0 ? tone(MIL_SEAM.modern, 1.4) : [72, 76, 84], ROLE.ORNAMENT);
          if (dy % 6 === 3) { K.deco(c, mx - 1, roofTop - 1 - dy, [96, 100, 108]); K.deco(c, mx + 1, roofTop - 1 - dy, [96, 100, 108]); }
        }
        K.deco(c, mx, roofTop - 28, [255, 92, 72]);
      }
    }
    if (variant === 'fortress' || variant === 'outpost') {
      // Corner turret tower on the rear block (an outpost's watchtower).
      const tx = rearFloors[rearStoreys - 1].left + 2;
      for (let dy = 0; dy < 34; dy += 1) for (let dx = 0; dx < 30; dx += 1) {
        const crenel = dy > 27 && dx % 8 > 3;
        if (crenel) continue;
        // Lit face on the canvas left whichever way the compound faces.
        const seen = facing > 0 ? dx : 29 - dx;
        K.solid(c, X(tx + dx), roofTop - 1 - dy, M.MASONRY, K.wallColor(style, seen < 3 ? 0 : seen > 26 ? 2 : 1, 3, dy, X(tx + dx), dy), ROLE.WALL);
      }
      for (let dy = 8; dy < 22; dy += 1) for (let dx = 11; dx < 19; dx += 1) K.solid(c, X(tx + dx), roofTop - 1 - dy, M.GLASS, mix(K.GLASS_SIDE, P.lamp, 0.5), ROLE.GLASS);
      rearRoof.left += facing > 0 ? 34 : 0; rearRoof.right -= facing > 0 ? 0 : 34;
    }
    if (variant === 'bastion') {
      // Earth glacis banked against the rear wall - faced with the god's revetment so it reads
      // as the works' own earthwork, not a stray mound (the user's note): plate courses skin
      // the slope, hazard chevrons where it meets the wall, and grass creeps over the toe to
      // hand it back to the land.
      for (let lx = -60; lx < 0; lx += 1) {
        const h = Math.round((lx + 60) / 60 * (S.FLOOR - 6));
        for (let dy = 0; dy < h; dy += 1) {
          const face = dy >= h - 2, toe = lx < -48;
          if (face && !toe) {
            const lip = lx >= -8 && dy === h - 1;
            const course = ((lx + dy) % 9) === 0;
            const col = lip ? (((lx + dy) >> 1 & 1) === 0 ? [230, 184, 40] : [40, 40, 44])
              : course ? [64, 67, 73] : tone([96, 100, 106], (PW.hash2(lx, dy) & 3) === 0 ? 0.88 : 1);
            K.solid(c, X(lx), ground - 1 - dy, M.FOUNDATION, col, ROLE.ORNAMENT);
          } else {
            const id = face && dy === h - 1 ? M.GRASS : M.SOIL;
            K.solid(c, X(lx), ground - 1 - dy, id, id === M.GRASS ? [88, 124, 54] : tone([104, 80, 52], 0.95 + (PW.hash2(lx, dy) & 1) * 0.08), ROLE.ORNAMENT);
          }
        }
      }
      const dcx = Math.round((rearRoof.left + rearRoof.right) / 2);
      for (let dy = 0; dy < 30; dy += 1) {
        const halfW = Math.round(Math.sqrt(Math.max(0, 900 - dy * dy)) * 1.3);
        for (let dx = -halfW; dx <= halfW; dx += 1) {
          const shade = dx < -halfW * 0.3 ? 1.15 : dx > halfW * 0.5 ? 0.78 : 1;
          K.solid(c, dcx + dx, roofTop - 1 - dy, M.CONCRETE, tone(P.roof, shade * (dy % 6 === 0 ? 0.9 : 1)), ROLE.ROOF);
        }
      }
    }
    if (O()) {
      const ornament = O();
      ornament.roof(c, style, rearFloors.map((f) => ({ k: f.k, left: Math.min(X(f.left), X(f.right)), right: Math.max(X(f.left), X(f.right)), wall: S.WALL })),
        [rearRoof], floorRow, random, facing);
      if (variant === 'command' || variant === 'fortress') {
        const crown = ornament.crownFor(style, `military|${variant}|${seed}`);
        // Centred in the design's own coordinates, so the mirrored building's crown is exactly opposite.
        const local = (x) => (facing > 0 ? x - margin : margin + bodyWidth - 1 - x);
        const mid = X(Math.round((local(rearRoof.left) + local(rearRoof.right)) / 2));
        ornament.crown(c, style, crown, mid + (variant === 'fortress' ? 14 * facing : 0), roofTop - 1, 60, random, facing);
      }
      const hangarRoof = { left: Math.min(X(hx0 + 16), X(hx1 - 16)), right: Math.max(X(hx0 + 16), X(hx1 - 16)),
        y: vault ? wallTop - HANGAR.vaultRise + 1 : wallTop - 7, top: false };
      // (an outpost holds high ground: an interceptor and a turret on its roof)
      const plan = !hangar ? (level >= 3 ? ['interceptor', 'turret'] : ['turret'])
        : level >= 4 ? ['launcher', 'interceptor', 'turret'] : level >= 3 ? ['launcher', 'turret'] : ['turret'];
      // Neutral compounds (deviceFacing 0) cover both directions until captured.
      const deviceFacing = options.deviceFacing ?? facing;
      const before = c.devices.length;
      ornament.devices(c, style, [rearRoof], plan.slice(0, 2), deviceFacing, random, -facing);
      // Neutral compounds: the rear-roof device faces away from the compound's front and the hangar
      // turret guards its front, so each covers both ways. Where the rear roof took no device (a
      // crown or a turret tower stands there), the hangar mounts two turrets, one facing each way.
      const pair = !deviceFacing && c.devices.length === before;
      if (hangar && !vault) ornament.devices(c, style, [hangarRoof], pair ? ['turret', 'turret'] : ['turret'], deviceFacing || (pair ? 0 : facing), random, facing);
      else if (hangar) {
        // Turrets on the vault: logical span [tx - 15, tx + 14], mirrored by X, at the crest's
        // height on a steel mount built down to the curve of the roof.
        const crest = wallTop - HANGAR.vaultRise;
        const mount = (tx, turretFacing) => {
          for (let lx = tx - 15; lx <= tx + 14; lx += 1) {
            const u = (lx - hcx) / half, roof = wallTop - Math.round(HANGAR.vaultRise * Math.sqrt(Math.max(0, 1 - u * u)));
            for (let y = crest + 1; y < roof; y += 1) K.solid(c, X(lx), y, M.STEEL, tone(P.frame, 0.7), ROLE.DEVICE);
          }
          ornament.DEVICE_DRAW.turret(c, P, Math.min(X(tx - 15), X(tx + 14)), crest, turretFacing);
        };
        mount(Math.round(hcx) + 10, deviceFacing || facing);
        if (pair) mount(Math.round(hcx) - 34, -facing);
      }
    }
    // Extra cores in vaults under the floor.
    const extraCores = level >= 4 ? 3 : 2;
    // N35: a base's service cores are SUBS - the smallest tier; its heart is the orb above.
    for (let i = 0; i < extraCores; i += 1) K.core(c, X(30 + i * Math.round((bodyWidth - 80) / Math.max(1, extraCores - 1))), ground, { tier: 'sub' });
    K.corePillars(c, style);
    if (!PW.NO_UNDERCROFT) K.undercroft(c, style, margin, margin + bodyWidth - 1);   // N3 vehicle rule: armour rolls through the base
    K.bakeLights(c, style);
    c.body = { left: margin, right: margin + bodyWidth - 1, top: hangar ? Math.min(floorRow(rearStoreys), wallTop - HANGAR.vaultRise) : floorRow(rearStoreys) - 34, bottom: ground - 1 };
    if (hangar) c.runway = { from: X(hangarRight) + facing, direction: facing, length: 380, y: ground };
    return c;
  }

  // ---- Main base core bunker: core orb in a sunken pit with a floating armoured block above ----
  function coreBunker(options) {
    const style = options.style, facing = options.facing || 1;
    const P = STYLES[style];
    const pitWidth = 300, pitDepth = 64, blockWidth = 330, blockHeight = 52, gap = 70;
    const margin = 30;
    const width = blockWidth + margin * 2;
    const height = pitDepth + blockHeight + gap + 60 + 40;
    const ground = height - pitDepth - 30;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'core', style, facing };
    const cx = Math.round(width / 2);
    // Pit: carved bowl with lined walls (terrain cells are cleared when stamped; the lining is structure).
    c.pit = { left: cx - pitWidth / 2, right: cx + pitWidth / 2, depth: pitDepth };
    for (let x = -pitWidth / 2; x <= pitWidth / 2; x += 1) {
      const u = Math.abs(x) / (pitWidth / 2);
      const depth = Math.round(pitDepth * Math.min(1, (1 - u) / 0.28));
      for (let y = ground; y < ground + depth; y += 1) K.back(c, cx + x, y, tone(P.frame, 0.22 + (y - ground) / pitDepth * 0.05));
      // Lining on the pit floor and slopes.
      for (let t = 0; t < 5; t += 1) {
        const y = ground + depth + t;
        K.solid(c, cx + x, y, M.FOUNDATION, t === 0 ? tone(P.ornament, 0.7) : tone([104, 102, 96], 1 - t * 0.04), ROLE.WALL);
      }
    }
    // The main core: a great amber orb on a stepped reactor pedestal of diamond-plate rings with
    // glowing joints, gripped by four clamp arms rising from the pit floor (the same core as every
    // building's, at the scale of the base's heart).
    const floor = ground + pitDepth;
    const PLATE = [112, 118, 126], PLATE_LIT = [156, 162, 170], PLATE_DARK = [66, 70, 78], BUMP = [176, 182, 190];
    // The dead god machine's colours: black and white, nothing else.
    const INK = [8, 8, 10], INK_LIT = [46, 46, 50], INK_MID = [24, 24, 27];
    const WHITE_CORE = [238, 242, 246], WHITE_DIM = [152, 158, 164];
    const tiers = [[18, 4], [15, 4], [12, 3], [8, 3]];
    let y = floor - 1;
    tiers.forEach(([half, rows], t) => {
      for (let r = 0; r < rows; r += 1, y -= 1) for (let dx = -half; dx <= half; dx += 1) {
        const x = cx + dx, bump = ((x + y) & 3) === 0 && ((x - y) & 3) === 2;
        K.solid(c, x, y, M.STEEL, Math.abs(dx) === half || r === 0 ? PLATE_DARK : r === rows - 1 ? PLATE_LIT : bump ? BUMP : PLATE, ROLE.CRADLE);
      }
      if (t < tiers.length - 1) {
        for (let dx = -half + 1; dx <= half - 1; dx += 1) K.solid(c, cx + dx, y, M.CORE, (dx + y) % 3 === 0 ? WHITE_CORE : WHITE_DIM, ROLE.CORE);
        y -= 1;
      }
    });
    // The main orb: a black sphere, lit faintly along its upper left, white light breaking out of
    // it along thin cracks, one white eye at its heart - and the machine's own black tendrils
    // wrapped over its lower half, a glint where they catch the light.
    const r = 17, orbY = y - r;
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > r + 0.3) continue;
      const a = Math.atan2(dy, dx);
      const light = Math.max(0, -(dx + dy) / (2 * r)) * (1 - Math.max(0, d / r - 0.8) * 2);
      let col = mix(INK_MID, INK_LIT, light * 1.6);
      if (d > r - 1.4) col = (dx + dy) < 0 ? [70, 72, 76] : INK;
      const crack = Math.abs(Math.sin(a * 2 + d * 0.55)) < 0.05 && d > 4 && d < r - 2;
      if (crack) col = (d & 1) ? WHITE_CORE : WHITE_DIM;
      const tendril = dy > -3 && d > 6 && Math.abs(Math.sin(a * 4 + d * 0.3)) < 0.14;
      if (tendril) col = ((dx + dy) % 9 === 0) ? WHITE_DIM : INK;
      const eye = Math.hypot(dx + 1, dy + 1);
      if (eye < 2.2) col = WHITE_CORE; else if (eye < 3.4) col = mix(WHITE_DIM, col, 0.5);
      K.solid(c, cx + dx, orbY + dy, M.CORE, col, ROLE.CORE);
    }
    // Clamp arms: from the pit floor out at the pedestal's foot up to the orb's flanks, claws in.
    // (each ends just off the orb's surface at height dy from its centre)
    for (const side of [-1, 1]) for (const [reach, dy] of [[34, 9], [26, -1]]) {
      const x0 = cx + side * reach, y0 = floor - 1;
      const x1 = cx + side * Math.round(Math.sqrt(r * r - dy * dy) + 2), y1 = orbY + dy;
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let t = 0; t <= n; t += 1) {
        const x = Math.round(x0 + (x1 - x0) * t / n), yy = Math.round(y0 + (y1 - y0) * t / n);
        for (let w = 0; w < 3; w += 1) K.solid(c, x, yy + w, M.STEEL, w === 0 ? PLATE_LIT : w === 2 ? PLATE_DARK : PLATE, ROLE.CRADLE);
      }
      for (let k = 0; k < 3; k += 1) K.solid(c, x1 - side * k, y1 - 1, M.STEEL, PLATE_DARK, ROLE.CRADLE);
    }
    c.cores.push({ x: cx, y: orbY, orb: true, kind: 'main', radius: r });
    c.lamps.push({ x: cx, y: orbY, radius: 70, strength: 0.55, color: WHITE_CORE });
    // The armoured block stands on pillars. The main pillar grows out of the top of the core - its
    // translator turns HM into it - up through the pit to the block's underside, seamed with the
    // core's glow; a pair of secondary pillars stand beside the core on the pit floor, and another
    // pair carry the block's outer edges down to the pit's sloping sides. Every pillar goes all the
    // way down to what it stands on, column by column. (Nothing hangs in the air: take the pillars
    // out and the block comes down.)
    const by = ground - gap;
    const mainHalf = 8, orbTop = orbY - r;
    for (let yy = by; yy <= orbTop + 2; yy += 1) for (let dx = -mainHalf; dx <= mainHalf; dx += 1) {
      const edge = Math.abs(dx) === mainHalf, seam = Math.abs(dx) === 2 && (yy & 7) < 5;
      const color = seam ? WHITE_DIM : edge ? PLATE_DARK : Math.abs(dx) < 2 ? PLATE_LIT : (yy - by) % 12 === 0 ? PLATE_DARK : PLATE;
      K.solid(c, cx + dx, yy, M.STEEL, color, ROLE.WALL);
    }
    // (the collar where it meets the orb)
    for (let dx = -mainHalf - 3; dx <= mainHalf + 3; dx += 1) for (let yy = orbTop - 1; yy <= orbTop + 2; yy += 1) {
      if (Math.hypot(dx, yy - orbY) > r + 2.5) K.solid(c, cx + dx, yy, M.STEEL, yy === orbTop - 1 ? PLATE_LIT : PLATE_DARK, ROLE.WALL);
    }
    // (beside the core, clear of its clamp arms, on the pit floor; and just inside the pit's rim -
    // clear of the machines beside the bunker - on its slope: each column down to the lining under
    // it)
    const sideHalf = 6, liningAt = (x) => ground + Math.round(pitDepth * Math.min(1, (1 - Math.abs(x) / (pitWidth / 2)) / 0.28));
    for (const sideX of [52, pitWidth / 2 - 12]) for (const side of [-1, 1]) {
      const px = cx + side * sideX;
      for (let dx = -sideHalf; dx <= sideHalf; dx += 1) for (let yy = by; yy <= liningAt(side * sideX + dx); yy += 1) {
        const edge = Math.abs(dx) === sideHalf, band = (yy - by) % 16 < 2;
        K.solid(c, px + dx, yy, M.CONCRETE, band ? P.ornament : edge ? tone(P.frame, 0.55) : tone(P.frame, 0.78), ROLE.WALL);
      }
    }
    for (let dy = 0; dy < blockHeight; dy += 1) for (let dx = -blockWidth / 2; dx < blockWidth / 2; dx += 1) {
      const u = (dx + blockWidth / 2) / blockWidth;
      const chamfer = dy > blockHeight - 14 ? (dy - (blockHeight - 14)) * 1.6 : 0;
      if (dx < -blockWidth / 2 + chamfer || dx > blockWidth / 2 - 1 - chamfer) continue;
      const band = dy === 4 || dy === blockHeight - 16;
      const plate = (Math.floor(u * 11) % 2 === 0) ? 1 : 0.94;
      const color = band ? P.ornament : dy < 3 ? tone(P.roofLight, 1.15) : tone(P.frame, 0.72 * plate * (dy > blockHeight - 14 ? 0.85 : 1));
      K.solid(c, cx + Math.round(dx), by - blockHeight + dy, M.STEEL, color, ROLE.VAULT);
    }
    // Glow under the block.
    for (let dx = -blockWidth / 2 + 30; dx < blockWidth / 2 - 30; dx += 1) {
      for (let dy = 0; dy < 6; dy += 1) if ((Math.round(dx) + dy) % 3 === 0) K.back(c, cx + Math.round(dx), by + dy, mix(WHITE_DIM, [20, 20, 24], 0.5 + dy * 0.08));
    }
    c.body ={ left: cx - pitWidth / 2, right: cx + pitWidth / 2, top: by - blockHeight, bottom: floor };
    K.bakeLights(c, style);
    return c;
  }

  // ---- N55: the vertical hangar tower ------------------------------------------------------------
  // A hangar turned on end, for squeezing in between a city's buildings: a narrow armoured
  // shaft of stacked bays - mechs below, jets racked above - a lift at the rear tying them,
  // a tall lift-door at the street, and the N52 cap of chamfers, parapet and mast on top.
  // It is NOT in MILITARY_VARIANTS: worldgen picks from that list, and this design is the
  // growth system's (the lab asks for it by name).
  function militaryTower(options) {
    const style = options.style, level = options.level || 2, facing = options.facing || 1;
    const seed = options.seed || 1;
    const P = STYLES[style];
    const bodyWidth = 104, margin = 24, coreDepth = K.VAULT_DEPTH + 3;
    const bays = level >= 3 ? 2 : 1;
    const bayClear = [92, 72];                        // mechs stand in the ground bay
    const machine = 26 + (level >= 5 ? 14 : 0);       // the plant floor on top grows with level
    let top = 0;
    for (let b = 0; b < bays; b += 1) top += bayClear[b] + S.SLAB;
    top += machine + 12;
    const width = bodyWidth + margin * 2, height = top + coreDepth + 20;
    const ground = height - coreDepth - 1;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'military', style, level, variant: 'tower', facing, seed };
    const X = (lx) => facing > 0 ? margin + lx : margin + bodyWidth - 1 - lx;
    const left = 0, right = bodyWidth - 1, WALL = S.WALL + 2;   // harder, thicker walls
    const innerL = Math.min(X(left + WALL), X(right - WALL)), innerR = Math.max(X(left + WALL), X(right - WALL));
    const DOOR_H = 70;
    // Bays from the ground up: dark ribbed backs, a floor slab over each.
    let row = ground;
    const bayFloors = [];
    for (let b = 0; b < bays; b += 1) {
      const clear = bayClear[b], floorY = row;
      K.rect(c, innerL, floorY - clear, innerR, floorY - 1, (x, y) => {
        const rise = floorY - 1 - y;
        const rib = Math.abs(x - innerL) % 26 < 2;
        let col = tone(P.frame, rib ? 0.36 : 0.3);
        if (rise < 3) col = (Math.floor(x / 8) % 2) ? [230, 196, 60] : [40, 40, 44];
        K.back(c, x, y, col);
      });
      for (let lx = left + WALL + 14; lx < right - WALL - 10; lx += 36) K.ceilingLamp(c, style, X(lx), floorY - clear + 2);
      bayFloors.push({ y: floorY, clear });
      c.floors.push({ storey: b, y: floorY, left: innerL, right: innerR });
      row = floorY - clear - S.SLAB;
      for (let x = innerL; x <= innerR; x += 1) for (let r = 0; r < S.SLAB; r += 1) {
        K.solid(c, x, row + r, M.STEEL, K.slabColor(style, r, x, row + r), b === bays - 1 ? ROLE.SLAB : ROLE.SLAB);
      }
    }
    // The machine floor and roof.
    const machTop = row - machine;
    K.rect(c, innerL, machTop, innerR, row - 1, (x, y) => K.back(c, x, y, tone(P.frame, (x + y) % 9 === 0 ? 0.42 : 0.34)));
    for (let lx = left + WALL + 6; lx < right - WALL - 6; lx += 22) K.FURNITURE.console(c, Math.min(X(lx), X(lx + 16)), row, P);
    for (let x = innerL; x <= innerR; x += 1) for (let r = 0; r < S.SLAB; r += 1) {
      K.solid(c, x, machTop - 1 - r, M.STEEL, K.slabColor(style, r, x, machTop - 1 - r), ROLE.ROOF);
    }
    // Walls in plate armour, with slit lights per bay.
    for (const lx of [left, right]) {
      const side = lx === left ? -1 : 1;
      for (let d = 0; d < WALL; d += 1) {
        const wx = X(lx - side * d);
        for (let y = machTop - 1 - S.SLAB; y < ground; y += 1) {
          if (lx === right && y >= ground - DOOR_H && d >= 2) continue;    // the lift door opening
          if (!K.isSolid(c, wx, y)) K.solid(c, wx, y, M.STEEL, milPlate(style, d, WALL, ground - 1 - y, wx, y), ROLE.WALL);
        }
      }
      for (const f of bayFloors) {
        for (let d = 0; d < WALL; d += 1) for (let y = f.y - f.clear + 10; y <= f.y - f.clear + 13; y += 1) {
          if (!(lx === right && y >= ground - DOOR_H)) K.solid(c, X(lx - side * d), y, M.GLASS, mix([26, 30, 36], P.lamp, y === f.y - f.clear + 11 ? 0.5 : 0.22), ROLE.GLASS);
        }
      }
    }
    // The lift door: recessed plating, hazard jambs, warning lights at the lintel.
    for (let y = ground - DOOR_H; y < ground; y += 1) {
      for (let d = 0; d < 2; d += 1) K.solid(c, X(right - d), y, M.STEEL, ((y >> 2) & 1) ? tone(MIL_TINT[style] || MIL_TINT.modern, 0.8) : tone(MIL_SEAM[style] || MIL_SEAM.modern, 1.1), ROLE.WALL);
    }
    for (let d = 0; d < 4; d += 1) K.solid(c, X(right - d), ground - DOOR_H - 1, M.STEEL, d === 1 || d === 2 ? MIL_AMBER : P.ornament, ROLE.FRAME);
    c.doors.push({ x: X(right), side: facing, top: ground - DOOR_H, bottom: ground - 1 });
    // The lift at the rear: platform rails up through the bays, cables to the machine floor.
    const liftX = left + WALL + 5;
    for (let y = machTop + 2; y < ground; y += 1) {
      if ((ground - y) % 4 === 0) { K.deco(c, X(liftX), y, [96, 100, 108]); K.deco(c, X(liftX + 7), y, [96, 100, 108]); }
      K.deco(c, X(liftX + 3), y, (y & 7) ? [60, 64, 70] : [84, 88, 96]);
    }
    for (let lx = liftX; lx <= liftX + 7; lx += 1) K.solid(c, X(lx), ground - 1, M.PLATFORM, [104, 108, 116], ROLE.STAIR);
    // The N52 cap: chamfer wedges, parapet, mast.
    const w0 = innerL - WALL, w1 = innerR + WALL, roofTop = machTop - S.SLAB;
    for (let s = 0; s < 7; s += 1) for (let d = 0; d <= s; d += 1) {
      const col = tone(MIL_TINT[style] || MIL_TINT.modern, d === s ? 1.2 : 0.95);
      K.solidIfEmpty(c, w0 + s, roofTop - 1 - d, M.STEEL, col, ROLE.ORNAMENT);
      K.solidIfEmpty(c, w1 - s, roofTop - 1 - d, M.STEEL, col, ROLE.ORNAMENT);
    }
    for (let x = w0 + 8; x <= w1 - 8; x += 1) K.solidIfEmpty(c, x, roofTop - 2, M.STEEL, tone(MIL_SEAM[style] || MIL_SEAM.modern, (x & 7) === 0 ? 1.5 : 1.1), ROLE.ORNAMENT);
    const mx = Math.round(w0 + (w1 - w0) * 0.3);
    for (let dy = 0; dy <= 21; dy += 1) K.solidIfEmpty(c, mx, roofTop - 1 - dy, M.STEEL, (dy % 5) === 0 ? tone(MIL_SEAM.modern, 1.4) : [72, 76, 84], ROLE.ORNAMENT);
    K.deco(c, mx, roofTop - 24, [255, 92, 72]);
    // Amber strip at the street, cyan above, as the bases wear them.
    for (let x = innerL + 2; x <= innerR - 2; x += 1) {
      if ((x - innerL) % 6 < 3) K.deco(c, x, ground - DOOR_H - 3, MIL_AMBER);
      if (bays > 1 && (x - innerL) % 6 < 3) K.deco(c, x, bayFloors[0].y - bayFloors[0].clear - S.SLAB - 2, tone(MIL_CYAN, 0.8));
    }
    K.core(c, X(Math.round(bodyWidth / 2)), ground);
    K.corePillars(c, style);
    K.bakeLights(c, style);
    c.hangar = { left: innerL, right: innerR, top: ground - bayClear[0], bottom: ground - 1,
      door: { x: X(right), top: ground - DOOR_H, bottom: ground - 1 }, spawn: { x: X(left + WALL + 26), y: ground } };
    c.body = { left: Math.min(X(left), X(right)), right: Math.max(X(left), X(right)), top: 0, bottom: ground - 1 };
    return c;
  }

  // ---- N55: militarise a population tower ---------------------------------------------------------
  // The military building merges into the building it militarises: the tower grows bulkier -
  // an armour skin plates the outer walls (the body widens), every floor gains a steel
  // under-layer, the roof takes the chamfer-and-parapet cap, and the walls go gunmetal.
  // N63 (the user's sketch): the military building merges ON THE TOWER'S SIDE - a plated
  // annex widening the base, a thin armour line carried over the tower's top with a small
  // dish mast. annexSide picks the flank (the side facing away from the city's centre).
  // N65 (refining N55/N57/N63): the annex is a full military WING - five to seven floors
  // by level, the tower's own floor grid continuing into it through doorways in the shared
  // wall, a control panel on its top floor, defence ports and roof turrets, and a vertical
  // hangar bay behind the glacis with a grated hatch in the roof. The merged tower's rooms
  // go military inside too: the civilian furniture is struck and the garrison moves in.
  function militarise(src, style, annexSide = -1) {
    const level = (src.meta && src.meta.level) || 1;
    const towerStoreys = (src.meta && src.meta.storeys) || 3;
    const annexFloors = Math.max(3, Math.min(towerStoreys + 1, 5 + Math.min(2, Math.floor((level - 1) / 2))));
    const ROOMS_W = 34 + (annexFloors - 5 > 0 ? (annexFloors - 5) * 4 : 0);
    const BAY_W = 26, GLACIS = 6;
    const ANNEX_W = ROOMS_W + BAY_W + GLACIS + 2;
    const pad = 7;
    const padL = annexSide <= 0 ? ANNEX_W + 6 : pad, padR = annexSide >= 0 ? ANNEX_W + 6 : pad;
    const c = K.createCanvas(src.width + padL + padR, src.height, src.ground);
    for (let y = 0; y < src.height; y += 1) for (let x = 0; x < src.width; x += 1) {
      const i = y * src.width + x, j = y * c.width + (x + padL);
      c.mat[j] = src.mat[i]; c.back[j] = src.back[i]; c.deco[j] = src.deco[i];
      c.paint[j] = src.paint[i]; c.role[j] = src.role[i];
    }
    const sx = (p) => ({ ...p, x: p.x + padL });
    c.meta = { ...src.meta, militarised: true };
    c.floors = src.floors.map((f) => ({ ...f, left: f.left + padL, right: f.right + padL }));
    c.stairs = src.stairs.map((s) => ({ ...s, from: s.from + padL, to: s.to + padL }));
    c.hatches = (src.hatches || []).map((h) => ({ ...h, x0: h.x0 + padL, x1: h.x1 + padL }));
    c.doors = src.doors.map((d) => ({ ...d, x: d.x + padL }));
    c.slots = src.slots.map(sx); c.panels = src.panels.map(sx); c.devices = src.devices.map(sx);
    c.windows = src.windows.map(sx); c.storage = (src.storage || []).map(sx);
    c.lamps = (src.lamps || []).map(sx);
    c.cores = src.cores.map((k) => ({ ...k, x: k.x + padL, vault: k.vault && { ...k.vault, x0: k.vault.x0 + padL, x1: k.vault.x1 + padL } }));
    c.body = { ...src.body, left: src.body.left + padL, right: src.body.right + padL };
    const tint = MIL_TINT[style] || MIL_TINT.modern;
    // The whole tower goes to war: walls gunmetal, glazing darkened to armoured glass, and
    // the rooms behind it blacked out to military lighting - a militarised tower must read
    // at a glance, and the glow of civilian interiors through the windows was what read.
    for (let i = 0; i < c.mat.length; i += 1) {
      if (c.paint[i]) {
        if (c.role[i] === ROLE.WALL) c.paint[i] = K.pack(mix(PW.unpack(c.paint[i]), tint, 0.55));
        else if (c.role[i] === ROLE.GLASS) c.paint[i] = K.pack(mix(PW.unpack(c.paint[i]), [38, 44, 52], 0.6));
      }
      if (c.back[i]) c.back[i] = K.pack(mix(PW.unpack(c.back[i]), [30, 34, 42], 0.55));
      if (c.deco[i]) c.deco[i] = K.pack(mix(PW.unpack(c.deco[i]), [40, 44, 52], 0.4));
    }
    // The armour skin: plate columns against the outer walls wherever the body has solid wall
    // beside them, and a steel under-layer beneath every floor slab.
    const solidNear = (x, y, dir) => {
      for (let k = 1; k <= 3; k += 1) { const i = y * c.width + x + dir * k; if (c.mat[i] && (c.role[i] === ROLE.WALL || c.role[i] === ROLE.GLASS)) return true; }
      return false;
    };
    for (let y = 8; y < c.ground; y += 1) {
      for (let d = 0; d < pad - 1; d += 1) {
        const lx = c.body.left - 1 - d, rx = c.body.right + 1 + d;
        if (annexSide > 0 && (solidNear(c.body.left, y, 1) || solidNear(c.body.left + 1, y, 1))) {
          if (!c.mat[y * c.width + lx]) K.solid(c, lx, y, M.STEEL, milPlate(style, d, pad - 1, c.ground - 1 - y, lx, y), ROLE.WALL);
        }
        if (annexSide < 0 && (solidNear(c.body.right, y, -1) || solidNear(c.body.right - 1, y, -1))) {
          if (!c.mat[y * c.width + rx]) K.solid(c, rx, y, M.STEEL, milPlate(style, d, pad - 1, c.ground - 1 - y, rx, y), ROLE.WALL);
        }
      }
    }
    // Armour belts: plate stubs protruding at every floor line, on the facades only (never
    // across the rooms, never over the ground storey's doors). N68: a stub must TOUCH the
    // facade it belts - on a sloped tower the body-edge band runs past recessed storeys,
    // and unanchored stubs hung in the open air beside the walls (the user's screenshots).
    const touchesFacade = (x, y, inward) => {
      for (let k = 1; k <= 4; k += 1) {
        const j = y * c.width + x + inward * k;
        if (c.mat[j] && (c.role[j] === ROLE.WALL || c.role[j] === ROLE.GLASS)) return true;
      }
      return false;
    };
    for (const f of c.floors) {
      if (f.y >= c.ground - 2) continue;
      for (const [bx0, bx1, inward] of [[c.body.left - pad + 2, c.body.left + 3, 1], [c.body.right - 3, c.body.right + pad - 2, -1]]) {
        for (let x = Math.max(2, bx0); x <= Math.min(c.width - 3, bx1); x += 1) {
          for (let r = 0; r < 2; r += 1) {
            const i = (f.y - r) * c.width + x;
            const empty = !c.mat[i];
            if (c.role[i] === ROLE.GLASS || (empty && touchesFacade(x, f.y - r, inward))) {
              c.mat[i] = M.STEEL; c.role[i] = ROLE.WALL;
              c.paint[i] = K.pack(tone(tint, r === 1 ? 1.14 : 0.82));
            }
          }
        }
      }
    }
    for (const f of c.floors) {
      // find each column's slab around the floor row and steel the row beneath it
      for (let x = f.left; x <= f.right; x += 1) {
        for (let y = f.y - 2; y <= f.y + S.SLAB + 2 && y < c.ground; y += 1) {
          const i = y * c.width + x;
          if (c.role[i] !== ROLE.SLAB && c.role[i] !== ROLE.ROOF) continue;
          if (c.role[i + c.width] === ROLE.SLAB || c.role[i + c.width] === ROLE.ROOF) continue;   // not the lowest slab row yet
          const j = i + c.width;
          if (!c.mat[j]) { c.mat[j] = M.STEEL; c.role[j] = ROLE.SLAB; c.paint[j] = K.pack(tone(tint, 0.8)); }
          break;
        }
      }
    }
    // The chamfer-and-parapet cap on the roof line.
    let roofY = c.ground;
    for (let y = 0; y < c.ground; y += 1) { if (c.mat[y * c.width + Math.round((c.body.left + c.body.right) / 2)]) { roofY = y; break; } }
    // N68: each cap column stands on ITS OWN silhouette - keyed off the centre column's
    // roof, the wedges floated beside a sloped tower's recessed top storeys.
    for (let s = 0; s < 6; s += 1) {
      for (const x of [c.body.left + s, c.body.right - s]) {
        let top = 0;
        while (top < c.ground && !c.mat[top * c.width + x]) top += 1;
        if (top <= 2 || top >= c.ground) continue;
        for (let d = 0; d <= s; d += 1) K.solidIfEmpty(c, x, top - 1 - d, M.STEEL, tone(tint, d === s ? 1.2 : 0.95), ROLE.ORNAMENT);
      }
    }
    // N65: THE WING - the grey military building merged on the tower's flank, five to seven
    // floors of it. The tower's floor grid runs on into the rooms band through doorways in
    // the shared wall; behind the rooms a vertical hangar bay rises the wing's full height
    // to a grated hatch in the roof; the outer face is the glacis, slit-lit per storey and
    // cut with defence ports; the top floor carries the wing's control panel; the roof its
    // turrets. A sally door opens at the glacis foot into the bay.
    // N67: the add-on stands on the LEFT, the RIGHT, or BOTH flanks (annexSide 0 means
    // both), at the shorter heights of the building's base; each wing joins the building
    // it sits beside (the growth's weld pass seals the far edge to the neighbour). The
    // armour crown, the dish mast and the plinth are laid once, after the wings.
    const wingSides = annexSide === 0 ? [-1, 1] : [annexSide];
    for (const dirOut of wingSides) {
      const aH = Math.min(c.ground - 10, annexFloors * S.FLOOR + 10);
      const aTop = c.ground - aH;
      const inner = dirOut < 0 ? c.body.left : c.body.right;              // against the tower wall
      const ax = (k) => inner + dirOut * k;                               // wing column k, 1-based
      const CHAMFER = 18;                                                 // the top leans in
      const outAt = (y) => ANNEX_W - Math.max(0, Math.round((CHAMFER - (y - aTop)) * 0.55));
      const bayL = ROOMS_W + 1, bayR = ROOMS_W + BAY_W;                   // the shaft's columns
      const bayTop = aTop + CHAMFER + 2;
      const roomBack = (x, y) => K.pack(tone([34, 38, 46], ((x + y) % 9) ? 1 : 1.18));
      // The wing's floors: the TOWER'S own rows, carried into the rooms band.
      const wingFloors = c.floors.filter((f) => !f.wing && f.y > aTop + CHAMFER && f.y < c.ground - 2)
        .sort((a, b) => a.y - b.y);
      for (let y = aTop; y < c.ground; y += 1) {
        const rise = c.ground - 1 - y;
        const wEff = outAt(y);
        for (let k = 1; k <= wEff; k += 1) {
          const x = ax(k);
          const i = y * c.width + x;
          if (c.mat[i]) continue;
          const inBay = k >= bayL && k <= bayR && y >= bayTop;
          const inRooms = k <= ROOMS_W && y > aTop + CHAMFER;
          if (inBay || inRooms) {
            if (!c.back[i]) c.back[i] = inBay ? K.pack(tone([26, 29, 36], ((x ^ y) % 7) ? 1 : 1.25)) : roomBack(x, y);
            continue;
          }
          K.solid(c, x, y, M.STEEL, milPlate(style, (k * 7 + rise) % 4, 4, rise, x, y), ROLE.WALL);
        }
        // slit lights at each storey's band on the glacis face
        if (rise % S.FLOOR === 18) {
          for (let k = Math.max(2, wEff - 5); k <= wEff - 1; k += 1) {
            K.solid(c, ax(k), y, M.GLASS, mix([26, 30, 36], (KIT_P(style).lamp || [255, 220, 140]), 0.4), ROLE.GLASS);
          }
        }
        // defence ports: a dark muzzle slot through the glacis at each storey's chest height
        if (rise % S.FLOOR === 30 || rise % S.FLOOR === 31) {
          for (let k = wEff - GLACIS + 1; k <= wEff; k += 1) {
            const i = y * c.width + ax(k);
            if (c.mat[i]) { c.paint[i] = K.pack(k === wEff ? [14, 15, 18] : tone(tint, 0.5)); }
          }
        }
      }
      // The continued floors: steel slabs across the rooms band at the tower's own rows,
      // a doorway through the shared wall at every one - the floors genuinely run on.
      for (const f of wingFloors) {
        for (let r = 0; r < S.SLAB; r += 1) {
          for (let k = 1; k <= ROOMS_W; k += 1) {
            const i = (f.y + r) * c.width + ax(k);
            if (!c.mat[i] && f.y + r < c.ground) { c.mat[i] = M.STEEL; c.role[i] = ROLE.SLAB; c.paint[i] = K.pack(tone(tint, r === 0 ? 1.05 : 0.8)); }
          }
        }
        for (let y = f.y - S.DOOR_H; y < f.y; y += 1) {
          for (let d = 0; d < 4; d += 1) {
            const x = inner - dirOut * d + dirOut;                        // through the shared wall
            const i = y * c.width + x;
            if (c.mat[i] && (c.role[i] === ROLE.WALL || c.role[i] === ROLE.GLASS)) {
              c.mat[i] = 0; c.role[i] = 0; c.paint[i] = 0; c.back[i] = c.back[i] || K.pack([40, 44, 52]);
            }
          }
        }
        c.floors.push({ storey: f.storey, y: f.y, left: Math.min(ax(2), ax(ROOMS_W - 1)), right: Math.max(ax(2), ax(ROOMS_W - 1)), wing: true });
      }
      // The wing's rooms live like the military's own: one piece of kit a floor and a lamp.
      const kitWalk = ['console', 'rack', 'locker', 'crate'];
      wingFloors.forEach((f, n) => {
        const name = kitWalk[(n + level) % kitWalk.length];
        const w = { console: 30, rack: 26, locker: 18, crate: 24 }[name];
        const x0 = Math.min(ax(3), ax(3 + w)) ;
        if (w <= ROOMS_W - 5) K.FURNITURE[name](c, x0, f.y, KIT_P(style));
        K.ceilingLamp(c, style, ax(ROOMS_W >> 1), f.y - S.CLEAR + 6);
      });
      // The control panel on the wing's top floor.
      if (wingFloors.length) {
        const top = wingFloors[0];
        c.panels.push({ x: ax(ROOMS_W - 8), y: top.y, storey: top.storey });
      }
      // The bay: a FLUSH hazard threshold on the grade (N68: a strip a cell up hung in the
      // air over the bay floor), a cradle stub either side standing on it, the mech's spawn.
      for (let k = bayL; k <= bayR; k += 1) {
        const i = (c.ground - 1) * c.width + ax(k);
        if (!c.mat[i]) { c.mat[i] = M.STEEL; c.role[i] = ROLE.ORNAMENT; c.paint[i] = K.pack(((k >> 1) & 1) ? [196, 164, 58] : [40, 40, 44]); }
      }
      for (const k of [bayL, bayR]) for (let r = 2; r <= 7; r += 1) {
        const i = (c.ground - r) * c.width + ax(k);
        if (!c.mat[i]) { c.mat[i] = M.STEEL; c.role[i] = ROLE.ORNAMENT; c.paint[i] = K.pack(tone(tint, 0.9)); }
      }
      c.hangar = c.hangar || { left: Math.min(ax(bayL), ax(bayR)), right: Math.max(ax(bayL), ax(bayR)),
        top: bayTop, bottom: c.ground - 1, door: { x: ax(outAt(c.ground - 1)), top: c.ground - S.DOOR_H, bottom: c.ground - 1 },
        spawn: { x: ax((bayL + bayR) >> 1), y: c.ground } };
      // the flat armoured roof - and the grated hatch over the bay (the mechs' way out, and
      // the roof's drain: N64's water rule reads the platform cells). N66: on a SLOPED host
      // (setback, tapered, crown...) the roof takes the tower's own terrace design instead
      // of the hazard lip - the stepped silhouette extends over the wing, one building.
      const hostVariant = (src.meta && src.meta.variant) || 'slab';
      const sloped = hostVariant === 'setback' || hostVariant === 'tapered' || hostVariant === 'crown'
        || hostVariant === 'spire' || hostVariant === 'needle';
      for (let k = 1; k <= outAt(aTop) + 1; k += 1) {
        const x = ax(k);
        const overBay = k >= bayL && k <= bayR;
        if (overBay) {
          for (const yy of [aTop - 1, aTop]) {
            const i = yy * c.width + x;
            if (!c.mat[i]) { c.mat[i] = M.PLATFORM; c.role[i] = ROLE.ROOF; c.paint[i] = K.pack(tone(tint, ((k - bayL) % 4 < 2) ? 0.55 : 0.95)); }
          }
        } else if (sloped) {
          K.solidIfEmpty(c, x, aTop - 1, M.CONCRETE, K.slabColor(style, 0, x, aTop - 1), ROLE.ROOF);
          K.solidIfEmpty(c, x, aTop, M.CONCRETE, K.slabColor(style, 1, x, aTop), ROLE.ROOF);
        } else {
          K.solidIfEmpty(c, x, aTop - 1, M.STEEL, ((k >> 1) & 1) ? [196, 164, 58] : tone(tint, 0.85), ROLE.ROOF);
          K.solidIfEmpty(c, x, aTop, M.STEEL, tone(tint, 1.1), ROLE.ROOF);
        }
      }
      // (the terrace parapet at the glacis edge, the tower's trim carried out)
      if (sloped) {
        for (const k of [outAt(aTop), outAt(aTop) + 1]) {
          K.solidIfEmpty(c, ax(k), aTop - 2, M.CONCRETE, tone(KIT_P(style).ornament || [120, 120, 126], 0.9), ROLE.ORNAMENT);
        }
      }
      // the wing's own guns: turrets on the armoured roof (and an interceptor from level 3)
      if (PW.buildingOrnaments && PW.buildingOrnaments.devices) {
        const roofRect = [{ left: Math.min(ax(1), ax(bayL - 2)), right: Math.max(ax(1), ax(bayL - 2)), y: aTop - 1, top: true }];
        PW.buildingOrnaments.devices(c, style, roofRect, level >= 3 ? ['turret', 'interceptor'] : ['turret'], dirOut,
          PW.createRandom(((src.meta && src.meta.seed) || 1) * 31 + annexFloors));
      }
      // the sally door at the glacis foot, opening into the bay (the cut takes the slit
      // lights with it - glass left in the opening hung in the air: N68)
      for (let y = c.ground - S.DOOR_H; y < c.ground; y += 1) {
        for (let d = 0; d < GLACIS + 1; d += 1) {
          const x = ax(outAt(y) - d);
          const i = y * c.width + x;
          if (c.mat[i] && (c.role[i] === ROLE.WALL || c.role[i] === ROLE.GLASS)) { c.mat[i] = 0; c.role[i] = 0; c.paint[i] = 0; }
          if (!c.back[i]) c.back[i] = K.pack(tone([40, 44, 52], 0.9));
        }
      }
      c.doors.push({ x: ax(outAt(c.ground - 1) - 1), side: dirOut, top: c.ground - S.DOOR_H, bottom: c.ground - 1 });
    }
    // the thin armour line carried over the tower's top, and the little dish on its stick
    {
      const crownX0 = Math.min(c.body.left, c.body.right), crownX1 = Math.max(c.body.left, c.body.right);
      for (let x = crownX0; x <= crownX1; x += 1) {
        let y = 0;
        while (y < c.ground && !c.mat[y * c.width + x]) y += 1;
        if (y > 2 && y < c.ground) K.solidIfEmpty(c, x, y - 1, M.STEEL, tone(tint, ((x >> 2) & 1) ? 1.05 : 0.9), ROLE.ORNAMENT);
      }
      const mastSide = wingSides[0];
      const mastX = mastSide < 0 ? c.body.left + 10 : c.body.right - 10;
      for (let k = 1; k <= 10; k += 1) K.solidIfEmpty(c, mastX, roofY - 1 - k, M.STEEL, (k % 4) ? [76, 80, 88] : [100, 104, 112], ROLE.ORNAMENT);
      for (const [dx, dy] of [[-2, 9], [-1, 10], [0, 11], [1, 10], [2, 9]]) K.deco(c, mastX + (mastSide < 0 ? dx : -dx), roofY - 1 - dy, [168, 174, 182]);
      // the plinth: one flush plated course tying the combined footprint at the grade
      const extL = c.body.left - (annexSide <= 0 ? ANNEX_W : 0), extR = c.body.right + (annexSide >= 0 ? ANNEX_W : 0);
      for (let x = extL - 3; x <= extR + 3; x += 1) {
        const i = (c.ground - 1) * c.width + x;
        if (!c.mat[i]) K.solid(c, x, c.ground - 1, M.FOUNDATION, ((x >> 2) & 1) ? [74, 78, 84] : [64, 67, 73], ROLE.ORNAMENT);
      }
    }
    // N65: the merged building's interiors go military too - the civilian furnishings are
    // struck from the rooms (the back layer carries them, nothing structural) and the
    // garrison's kit moves in: consoles, racks, lockers and crates, floor by floor. The
    // stair band keeps its rails; walls, glazing, lamps and doorways are untouched.
    {
      const roomBackTone = (x, y) => K.pack(tone([34, 38, 46], ((x + y) % 9) ? 1 : 1.18));
      const sBand = c.stairs.length ? [Math.min(...c.stairs.map((s) => Math.min(s.from, s.to))) - S.LANDING - 2,
        Math.max(...c.stairs.map((s) => Math.max(s.from, s.to))) + S.LANDING + 2] : null;
      const items = ['console', 'rack', 'locker', 'crate', 'rack'];
      const widths = { console: 30, rack: 26, locker: 18, crate: 24 };
      for (const f of c.floors) {
        if (f.wing) continue;
        const spans = [];
        if (sBand && sBand[0] > f.left + 6 && sBand[1] < f.right - 6) {
          spans.push([f.left + 2, sBand[0] - 2], [sBand[1] + 2, f.right - 2]);
        } else spans.push([f.left + 2, f.right - 2]);
        for (const [a, b] of spans) {
          if (b - a < 14) continue;
          for (let y = f.y - S.CLEAR + 6; y < f.y; y += 1) {
            for (let x = a; x <= b; x += 1) {
              const i = y * c.width + x;
              if (!c.mat[i] && c.back[i]) c.back[i] = roomBackTone(x, y);
            }
          }
          let x = a + 3, n = 0;
          while (n < items.length && x < b - 16) {
            const name = items[(n + f.storey) % items.length], w = widths[name];
            if (x + w > b - 2) break;
            K.FURNITURE[name](c, x, f.y, KIT_P(style));
            x += w + 8 + ((f.storey * 7 + n * 13) % 9);
            n += 1;
          }
        }
      }
    }
    c.body.left -= annexSide <= 0 ? ANNEX_W + 4 : pad - 1;
    c.body.right += annexSide >= 0 ? ANNEX_W + 4 : pad - 1;
    // N3 vehicle rule, re-cut last: the armour skin and the wings rolled over the tower's
    // undercroft - the drive-through opens again through the whole armoured mass, the
    // belts above the portals standing as the fortified lintel.
    if (!PW.NO_UNDERCROFT) K.undercroft(c, style);
    return c;
  }
  const KIT_P = (style) => STYLES[style] || STYLES.modern;

  function military(options) {
    return options.variant === 'tower' ? militaryTower(options) : militaryBase(options);
  }

  PW.buildingTypes = PW.buildingTypes || {};
  PW.buildingTypes.military = military;
  PW.buildingTypes.core = coreBunker;
  PW.MILITARY_VARIANTS = MILITARY_VARIANTS;
  PW.HANGAR = HANGAR;
  PW.militarise = militarise;
})();
