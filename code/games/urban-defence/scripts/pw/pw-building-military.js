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

  // N111: the spawn pad, the user's 140 wide - a tank (128 long), a mech, a drone or a squad
  // comes up on it.
  const PAD_W = 140;
  // The pad (logical columns p0..p1): a steel lift deck flush with the hangar floor - diamond
  // plate, cyan marker lights, hazard chevrons at its ends - the lift's rams under it in their
  // housing; on the back wall behind it its bay: guide-light columns at its ends, the lift's
  // clearance line, chevrons pointing out to the door. (The core's vault in the middle is
  // already drawn: the deck goes round its mouth.)
  function spawnPad(c, X, p0, p1, ground) {
    for (let lx = p0; lx <= p1; lx += 1) {
      const x = X(lx), along = lx - p0, end = along < 6 || p1 - lx < 6;
      const marker = !end && along % 12 === 6;
      K.solidIfEmpty(c, x, ground, M.STEEL, end ? (((along >> 1) & 1) ? MIL_AMBER : [36, 36, 40])
        : marker ? MIL_CYAN : ((x + (x >> 2)) & 3) === 0 ? [150, 156, 164] : [118, 124, 132], ROLE.CRADLE);
      K.solidIfEmpty(c, x, ground + 1, M.STEEL, [62, 66, 74], ROLE.CRADLE);
      if (marker) c.lamps.push({ x, y: ground - 1, radius: 10, strength: 0.35, color: MIL_CYAN });
      for (let y = ground + 2; y <= ground + 8; y += 1) {
        const ram = along % 20 === 9 || along % 20 === 10;
        K.solidIfEmpty(c, x, y, ram ? M.STEEL : M.FOUNDATION, ram ? ((y & 1) ? [168, 172, 180] : [128, 132, 140])
          : tone([46, 48, 54], y === ground + 8 ? 0.8 : 1), ram ? ROLE.CRADLE : ROLE.VAULT);
      }
      // the bay on the back wall: the clearance line over the deck
      K.back(c, x, ground - 56, tone(MIL_CYAN, 0.55));
    }
    for (const lx of [p0, p0 + 1, p1 - 1, p1]) {
      for (let rise = 3; rise <= 56; rise += 1) K.back(c, X(lx), ground - rise, rise % 6 < 3 ? tone(MIL_AMBER, 0.85) : [30, 30, 34]);
    }
    for (const lx of [p0 + 1, p1 - 1]) c.lamps.push({ x: X(lx), y: ground - 4, radius: 22, strength: 0.45, color: MIL_AMBER });
    const mid = Math.round((p0 + p1) / 2);
    for (const k of [-18, 0, 18]) {
      for (let r = -5; r <= 5; r += 1) for (let t = 0; t < 3; t += 1) {
        K.back(c, X(mid + k + 5 - Math.abs(r) - t), ground - 30 + r, tone(MIL_AMBER, 0.8));
      }
    }
  }

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
    // (N121: the rear block's ground storey a gate hall as tall as the road tunnels, like a tower's)
    const raise = PW.NO_UNDERCROFT || PW.NO_HALL_RAISE ? 0 : S.HALL_RAISE;
    const top = hangar ? Math.max(rearStoreys * S.FLOOR + raise + 120, HANGAR.clear + HANGAR.vaultRise + 90) : rearStoreys * S.FLOOR + raise + 130;
    const width = bodyWidth + margin * 2, height = top + coreDepth + 20;
    const ground = height - coreDepth - 1;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'military', style, level, variant, facing, seed, hallRaise: raise };
    // Work in "front-right" coordinates and mirror x when the building faces left.
    const X = (lx) => facing > 0 ? margin + lx : margin + bodyWidth - 1 - lx;
    const floorRow = (k) => ground - k * S.FLOOR - (k > 0 ? raise : 0);
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
      K.rect(c, innerLeft, floorRow(k + 1) + S.SLAB, innerRight, fRow - 1,
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
      for (let lx = left + 20; lx < right - 14; lx += 44) K.ceilingLamp(c, style, X(lx), floorRow(k + 1) + S.SLAB);
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
      // (N121: out of the tall gate hall by a ladder on its back wall, through a hatch in the slab)
      if (k === 0 && raise) {
        const lx = start + dir * 4, upper = floorRow(1), fRow = floorRow(0);
        const rail = tone(P.ornament, 0.62), rung = tone(P.ornament, 0.82);
        for (let y = upper; y < fRow; y += 1) {
          K.back(c, X(lx - 2), y, rail); K.back(c, X(lx + 2), y, rail);
          if ((fRow - y) % 4 === 0) for (let x = lx - 1; x <= lx + 1; x += 1) K.back(c, X(x), y, rung);
        }
        for (let x = lx - 3; x <= lx + 3; x += 1) {
          for (let row = 0; row < S.SLAB; row += 1) {
            const i = (upper + row) * c.width + X(x);
            if (c.role[i] === ROLE.SLAB) c.mat[i] = M.PLATFORM;
          }
        }
        (c.ladders = c.ladders || []).push({ x0: Math.min(X(lx - 1), X(lx + 1)), x1: Math.max(X(lx - 1), X(lx + 1)), y0: upper - 2, y1: fRow - 1 });
        c.stairs.push({ storey: 0, dir: dir * facing, from: X(lx), to: X(lx), floorRow: fRow, upperRow: upper, ladder: true });
        continue;
      }
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
        for (let y = wallTop; y < floorRow(1); y += 1) {
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
      // N111: the spawn pad - a lift deck PAD_W wide set flush in the hangar floor, every unit the
      // base deploys coming up on it - over the base's core in its armoured vault below (the
      // core column that stood on the floor at the back is gone).
      const pcx = Math.round((hangarLeft + HANGAR.wall + hangarRight - HANGAR.wall) / 2);
      const p0 = pcx - PAD_W / 2, p1 = pcx + PAD_W / 2 - 1;
      K.core(c, X(pcx), ground, { military: true, seed });
      spawnPad(c, X, p0, p1, ground);
      c.pad = { x0: Math.min(X(p0), X(p1)), x1: Math.max(X(p0), X(p1)), y: ground };
      c.hangar = { left: Math.min(X(hx0), X(hx1)), right: Math.max(X(hx0), X(hx1)), top: wallTop, bottom: ground - 1,
        door: { x: X(hangarRight), top: ground - HANGAR.door, bottom: ground - 1 }, spawn: { x: X(pcx), y: ground } };
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
        for (const [bx, bw] of [[hangarLeft + 10, 11], [hangarLeft + 24, 9]]) {    // hay bales by the rear wall, off the pad
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
        if (hangar) for (const [rx, rw] of [[hangarLeft + 12, 8], [hangarLeft + 24, 5]]) {   // fallen rock kept in the bay, off the pad
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
      // (N114: a launcher's or an interceptor's plate is wider than the old painted ones and wants its
      // pods' room - the rear roof's middle is free where no crown stands on it, and a flat hangar
      // roof takes one too)
      const crowned = variant === 'command' || variant === 'fortress' || variant === 'bastion';
      const deviceRoofs = [{ ...rearRoof, open: !crowned }];
      if (hangar && !vault) deviceRoofs.push(hangarRoof);
      ornament.devices(c, style, deviceRoofs, plan.slice(0, 2), deviceFacing, random, -facing);
      // Neutral compounds: the rear-roof device faces away from the compound's front and the hangar
      // turret guards its front, so each covers both ways. Where the rear roof took no device (a
      // crown or a turret tower stands there), the hangar mounts two turrets, one facing each way.
      const pair = !deviceFacing && c.devices.length === before;
      if (hangar && !vault) ornament.devices(c, style, [hangarRoof], pair ? ['turret', 'turret'] : ['turret'], deviceFacing || (pair ? 0 : facing), random, facing);
      else if (hangar) {
        // Turret bases on the vault (N103): logical span [tx - w/2, tx + w/2 - 1], mirrored by X, at
        // the crest's height on a steel mount built down to the curve of the roof.
        const crest = wallTop - HANGAR.vaultRise;
        const mount = (tx, kind, turretFacing) => {
          const w = ornament.PLATE_W[kind], l0 = tx - (w >> 1), l1 = l0 + w - 1;
          for (let lx = l0; lx <= l1; lx += 1) {
            const u = (lx - hcx) / half, roof = wallTop - Math.round(HANGAR.vaultRise * Math.sqrt(Math.max(0, 1 - u * u)));
            for (let y = crest + 1; y < roof; y += 1) K.solid(c, X(lx), y, M.STEEL, tone(P.frame, 0.7), ROLE.DEVICE);
          }
          ornament.DEVICE_DRAW[kind](c, P, Math.min(X(l0), X(l1)), crest, turretFacing);
        };
        mount(Math.round(hcx) + 10, 'turret', deviceFacing || facing);
        if (pair) mount(Math.round(hcx) - 34, 'turret', -facing);
        // (N114: the launcher or interceptor the rear roof had no room for stands on the vault too,
        // well back from the turret - its pods' reach clear of the turret's head)
        const placed = c.devices.slice(before).map((d) => d.kind);
        const art = plan.slice(0, 2).find((k) => k !== 'turret' && !placed.includes(k));
        if (art && !pair) mount(Math.round(hcx) - 80, art, deviceFacing || facing);
      }
    }
    // Extra cores in vaults under the floor.
    const extraCores = level >= 4 ? 3 : 2;
    // N35: a base's service cores are SUBS - the smallest tier; its heart is the core above.
    // (N111: with a hangar, they keep clear of the pad - under the rear block, behind the pad and
    // by the door)
    const subs = hangar ? (extraCores === 3 ? [30, hangarLeft + 20, hangarRight - 20] : [30, hangarRight - 20])
      : Array.from({ length: extraCores }, (_, i) => 30 + i * Math.round((bodyWidth - 80) / Math.max(1, extraCores - 1)));
    for (const lx of subs) K.core(c, X(lx), ground, { tier: 'sub' });
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
    c.slots = src.slots.map(sx); c.panels = src.panels.map(sx);
    c.devices = src.devices.map((d) => ({ ...sx(d), base: d.base && { ...d.base, x0: d.base.x0 + padL, x1: d.base.x1 + padL } }));
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
      // N97: floors, roofs and walls run on until they MEET. On a sloped host the storeys
      // recede inside the body's widest line, and the wing - built out from that line - stood
      // off the recessed facade by the recess: open air between them (the user's screenshot).
      // Each row of the wing's height is carried in from the body line to the tower's own
      // cells - its wall, its glazing or its room: a roof row as the roof, a floor row as the
      // steel slab, the rest as the room's back wall; and a doorway is cut through the facade
      // met at every floor. Where nothing of the tower stands within reach (the sky over a
      // lower tower) nothing is laid.
      {
        const slabRow = new Set();
        for (const f of wingFloors) for (let r = 0; r < S.SLAB; r += 1) slabRow.add(f.y + r);
        const REACH_IN = 40, hitAt = new Map();
        for (let y = aTop - 1; y < c.ground - 1; y += 1) {
          const run = [];
          let x = inner, hit = null;
          for (let s = 0; s < REACH_IN && x > 1 && x < c.width - 2; s += 1, x -= dirOut) {
            const i = y * c.width + x;
            if (c.mat[i] || c.back[i]) { hit = x; break; }
            run.push(x);
          }
          if (hit === null || !run.length) continue;
          hitAt.set(y, hit);
          for (const rx of run) {
            const i = y * c.width + rx;
            if (y <= aTop) K.solidIfEmpty(c, rx, y, sloped ? M.CONCRETE : M.STEEL, sloped ? K.slabColor(style, y - aTop + 1, rx, y) : tone(tint, 1.1), ROLE.ROOF);
            else if (slabRow.has(y)) { c.mat[i] = M.STEEL; c.role[i] = ROLE.SLAB; c.paint[i] = K.pack(tone(tint, slabRow.has(y - 1) ? 0.8 : 1.05)); }
            else c.back[i] = roomBack(rx, y);
          }
        }
        for (const f of wingFloors) {
          for (let y = f.y - S.DOOR_H; y < f.y; y += 1) {
            const hit = hitAt.get(y);
            if (hit === undefined) continue;
            for (let d = 0; d < 4; d += 1) {
              const i = y * c.width + hit - dirOut * d;
              if (c.mat[i] && (c.role[i] === ROLE.WALL || c.role[i] === ROLE.GLASS)) {
                c.mat[i] = 0; c.role[i] = 0; c.paint[i] = 0; c.back[i] = c.back[i] || K.pack([40, 44, 52]);
              }
            }
          }
        }
        // ...and no pocket of open air is left sealed inside the join: under the wing's roof,
        // from its glacis to forty cells into the tower, a run with neither cell nor back wall
        // closed in on both sides (the doorways, the cap and the roof meeting the slabs left a
        // few) is back-walled like the rooms round it
        const xa = Math.min(ax(ANNEX_W), inner - dirOut * REACH_IN), xb = Math.max(ax(ANNEX_W), inner - dirOut * REACH_IN);
        const filled = (i) => c.mat[i] || c.back[i];
        for (let y = aTop - 1; y < c.ground - 1; y += 1) {
          let x = Math.max(1, xa);
          while (x <= Math.min(c.width - 2, xb)) {
            if (filled(y * c.width + x)) { x += 1; continue; }
            let e = x;
            while (e <= xb && !filled(y * c.width + e)) e += 1;
            if (e <= xb && e - x <= REACH_IN && filled(y * c.width + x - 1)) {
              for (let k = x; k < e; k += 1) c.back[y * c.width + k] = roomBack(k, y);
            }
            x = e;
          }
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

  // ---- N89 (the user's, 2026-11-21): a base spread over several smaller buildings -----------------
  // Round the base's main building (the largest, with its watchtower) stand smaller ones: a
  // barracks - a long low block of bunks and lockers with a sandbagged nest on its roof where the
  // troops garrison; a watchtower - a steel-legged lookout with its cab and searchlight up top and a
  // ladder up its legs; a bunker - a low pillbox of thick concrete with gun slits, its earth banked
  // against its sides. Each over a sub core of its own (the cores make everything).
  const POSTS = { barracks: { w: 96 }, watchtower: { w: 34 }, bunker: { w: 74 }, hangar: { w: 180 } };
  const HANGAR_POST = Object.freeze({ clear: 76, door: 70 });   // N155: the hangar standing apart
  function militaryPost(options) {
    const style = options.style, variant = options.variant, level = options.level || 2;
    const facing = options.facing || 1, seed = options.seed || 1, setting = options.setting || null;
    const P = STYLES[style] || STYLES.modern, spec = POSTS[variant];
    const random = PW.createRandom(seed);
    const margin = 26, coreDepth = K.VAULT_DEPTH + 3, w = spec.w;
    const bodyH = variant === 'bunker' ? 28 : variant === 'watchtower' ? 150 + level * 6 : variant === 'hangar' ? HANGAR_POST.clear + 6 : S.FLOOR + S.SLAB;
    const width = w + margin * 2, height = bodyH + 70 + coreDepth;
    const ground = height - coreDepth - 1;
    const c = K.createCanvas(width, height, ground);
    c.meta = { type: 'military', style, level, variant, facing, seed, post: true };
    const X = (lx) => facing > 0 ? margin + lx : margin + w - 1 - lx;
    const wallAt = (lx, y, d, total) => K.solid(c, X(lx), y, P.wallMat, milPlate(style, d, total, ground - 1 - y, X(lx), y, setting), ROLE.WALL);
    const sandbags = (lx0, lx1, row, h) => {
      for (let lx = lx0; lx <= lx1; lx += 1) for (let dy = 1; dy <= h; dy += 1) {
        const brick = ((lx + (dy & 1) * 3) % 6) === 0 || dy % 3 === 0;
        K.solid(c, X(lx), row - dy, M.COVER_SAND || M.SAND, brick ? [140, 124, 90] : [176, 158, 116], ROLE.ORNAMENT);
      }
    };
    let top;
    if (variant === 'barracks') {
      const fRow = ground, roof = ground - S.FLOOR;
      for (const [lx, side] of [[0, 1], [w - 1, -1]]) for (let d = 0; d < S.WALL; d += 1) for (let y = roof; y < fRow; y += 1) wallAt(lx + side * d, y, d, S.WALL);
      for (let lx = 0; lx < w; lx += 1) for (let row = 0; row < S.SLAB; row += 1) K.solid(c, X(lx), roof + row, M.CONCRETE, K.slabColor(style, row, X(lx), roof + row), ROLE.ROOF);
      const inL = Math.min(X(S.WALL), X(w - 1 - S.WALL)), inR = Math.max(X(S.WALL), X(w - 1 - S.WALL));
      K.rect(c, inL, roof + S.SLAB, inR, fRow - 1, (x, y) => K.back(c, x, y, K.backWallColor(style, x, y, fRow - 1 - y, inL, inR)));
      // bunks and lockers down its length
      for (let lx = S.WALL + 4; lx < w - S.WALL - 30; lx += 34) K.FURNITURE.bed(c, Math.min(X(lx), X(lx + 29)), fRow, P, facing < 0);
      K.FURNITURE.locker(c, Math.min(X(w - S.WALL - 22), X(w - S.WALL - 5)), fRow, P);
      K.ceilingLamp(c, style, X(w >> 1), roof + S.SLAB);
      // doors at both ends; slit windows
      for (const lx0 of [0, w - S.WALL]) for (let d = 0; d < S.WALL; d += 1) for (let y = fRow - S.DOOR_H; y < fRow; y += 1) { K.clear(c, X(lx0 + d), y); K.back(c, X(lx0 + d), y, tone(P.frame, 0.3)); }
      c.doors.push({ x: X(0), side: -facing, top: fRow - S.DOOR_H, bottom: fRow - 1 }, { x: X(w - 1), side: facing, top: fRow - S.DOOR_H, bottom: fRow - 1 });
      c.floors.push({ storey: 0, y: fRow, left: inL, right: inR });
      // the garrison's nest on the roof: a ring of sandbags, troops' places behind it
      sandbags(2, 9, roof, 7); sandbags(w - 10, w - 3, roof, 7); sandbags(10, w - 11, roof, 3);
      c.slots.push({ x: X(14), y: roof, storey: 1, facing }, { x: X(w - 15), y: roof, storey: 1, facing });
      top = roof - 8;
    } else if (variant === 'watchtower') {
      // four legs braced in an X up to the cab, a ladder up the middle
      const cabFloor = ground - bodyH + 34, legL = 3, legR = w - 4;
      for (let y = cabFloor; y < ground; y += 1) {
        const t = (y - cabFloor) / (ground - cabFloor), spread = Math.round(t * 5);
        for (const [lx, d] of [[legL - spread, 0], [legL - spread + 1, 1], [legR + spread, 0], [legR + spread - 1, 1]]) K.solid(c, X(lx), y, M.STEEL, d ? tone(P.frame, 0.8) : tone(P.frame, 1.05), ROLE.FRAME);
      }
      for (let seg = 0; seg < 5; seg += 1) {
        const y0 = cabFloor + seg * (ground - cabFloor) / 5, y1 = y0 + (ground - cabFloor) / 5;
        for (let s = 0; s <= 24; s += 1) {
          const u = s / 24, y = Math.round(y0 + (y1 - y0) * u);
          K.back(c, X(legL + Math.round((legR - legL) * u)), y, tone(P.frame, 0.7));
          K.back(c, X(legR - Math.round((legR - legL) * u)), y, tone(P.frame, 0.7));
        }
      }
      const lx = w >> 1;
      for (let y = cabFloor; y < ground; y += 1) {
        K.back(c, X(lx - 2), y, tone(P.ornament, 0.6)); K.back(c, X(lx + 3), y, tone(P.ornament, 0.6));
        if ((ground - y) % 4 === 0) for (let x = lx - 1; x <= lx + 2; x += 1) K.back(c, X(x), y, tone(P.ornament, 0.8));
      }
      (c.ladders = c.ladders || []).push({ x0: Math.min(X(lx - 1), X(lx + 2)), x1: Math.max(X(lx - 1), X(lx + 2)), y0: cabFloor - 2, y1: ground - 1 });
      // the cab: a floor (a hatch over the ladder), armoured walls with a glazed slit all round, a roof
      for (let lx2 = -4; lx2 < w + 4; lx2 += 1) for (let row = 0; row < S.SLAB; row += 1) {
        const hatch = lx2 >= lx - 3 && lx2 <= lx + 4;
        K.solid(c, X(lx2), cabFloor + row, hatch ? M.PLATFORM : M.CONCRETE, K.slabColor(style, row, X(lx2), cabFloor + row), ROLE.SLAB);
      }
      const cabTop = cabFloor - 30;
      for (const [lx0, side] of [[-4, 1], [w + 3, -1]]) for (let d = 0; d < 4; d += 1) for (let y = cabTop; y < cabFloor; y += 1) {
        const slit = y > cabFloor - 22 && y < cabFloor - 12;
        if (slit) K.solid(c, X(lx0 + side * d), y, M.GLASS, mix([30, 34, 40], P.lamp, 0.35), ROLE.GLASS);
        else wallAt(lx0 + side * d, y, d, 4);
      }
      for (let lx2 = -6; lx2 < w + 6; lx2 += 1) for (let row = 0; row < 4; row += 1) K.solid(c, X(lx2), cabTop - row, M.STEEL, row === 3 ? tone(P.roofLight, 1.05) : tone(P.roof, 1 - row * 0.03), ROLE.ROOF);
      // the searchlight on the roof, swung towards the front
      for (let dy = 1; dy <= 4; dy += 1) for (let dx = 0; dx < 5; dx += 1) K.deco(c, X(lx + dx), cabTop - 4 - dy, dy === 2 && dx === 4 ? [255, 246, 200] : [70, 74, 80]);
      c.floors.push({ storey: 0, y: cabFloor, left: Math.min(X(-1), X(w)), right: Math.max(X(-1), X(w)) });
      c.slots.push({ x: X(lx + 8), y: cabFloor, storey: 1, facing });
      c.doors.push({ x: X(lx), side: facing, top: ground - S.DOOR_H, bottom: ground - 1 });
      top = cabTop - 9;
    } else if (variant === 'hangar') {
      // N155 (the user's): the hangar, standing apart where the ground is open - a steel portal
      // shed with a FLAT roof (no arches), ribbed cladding, its wide door to the front, the
      // turrets on its roof at the front; inside, a drone on its cradle, a fuel bowser, tool racks
      const roof = ground - HANGAR_POST.clear, inL = Math.min(X(S.WALL), X(w - 1 - S.WALL)), inR = Math.max(X(S.WALL), X(w - 1 - S.WALL));
      K.rect(c, inL, roof, inR, ground - 1, (x, y) => {
        const up = ground - 1 - y, rib = Math.abs(x - X(0)) % 30 < 2;
        K.back(c, x, y, up < 3 ? ((x >> 3) & 1 ? [214, 182, 64] : [42, 42, 46]) : tone([64, 66, 62], rib ? 1.25 : (up % 20 === 0 ? 1.12 : 1)));
      });
      for (let d = 0; d < S.WALL; d += 1) for (let y = roof; y < ground; y += 1) {
        for (const lx of [d, w - 1 - d]) {
          if (lx > w / 2 && ground - 1 - y < HANGAR_POST.door) continue;   // the door, to the front
          if (lx < w / 2 && ground - 1 - y < S.DOOR_H) continue;             // a man's door at the back
          K.solid(c, X(lx), y, M.STEEL, tone(y % 6 < 3 ? [104, 108, 100] : [88, 92, 86], d === 0 || d === S.WALL - 1 ? 0.9 : 1), ROLE.WALL);
        }
      }
      for (let lx = 0; lx < w; lx += 1) for (let t = 0; t < 6; t += 1) K.solid(c, X(lx), roof - 1 - t, M.CONCRETE, t === 5 ? [150, 148, 140] : t === 0 ? [96, 96, 92] : [120, 118, 112], ROLE.ROOF);
      for (const lx of [0, 1, w - 2, w - 1]) for (let dy = 1; dy <= 3; dy += 1) K.solid(c, X(lx), roof - 6 - dy, M.CONCRETE, [176, 168, 150], ROLE.ORNAMENT);
      for (let lx = w - S.WALL; lx < w; lx += 1) K.solid(c, X(lx), ground - 1 - HANGAR_POST.door, M.STEEL, ((lx >> 1) & 1) ? MIL_AMBER : [40, 40, 44], ROLE.FRAME);
      for (let lx = S.WALL + 20; lx < w - S.WALL - 10; lx += 44) K.ceilingLamp(c, style, X(lx), roof + 1);
      // a drone on its cradle in the middle, a bowser and racks at the back
      const dm = w >> 1;
      for (let dx = -26; dx <= 26; dx += 1) {
        const span = Math.abs(dx);
        K.back(c, X(dm + dx), ground - 22 - (span > 18 ? 1 : 0), [96, 100, 94]);                   // the wing
        if (span < 9) for (let dy = 19; dy <= 25; dy += 1) K.back(c, X(dm + dx), ground - dy, dy === 25 || dy === 19 ? [70, 74, 68] : [118, 122, 112]);   // the body
      }
      for (let dy = 16; dy <= 30; dy += 1) K.back(c, X(dm - 12), ground - dy, [84, 88, 82]);   // the tail fin
      for (const dx of [-6, 6]) for (let dy = 1; dy < 19; dy += 1) K.back(c, X(dm + dx), ground - dy, [58, 60, 58]);   // the cradle
      for (let lx = S.WALL + 6; lx < S.WALL + 34; lx += 1) for (let dy = 1; dy <= 16; dy += 1) {
        const tank = dy >= 6 && dy <= 15 && lx < S.WALL + 26;
        K.back(c, X(lx), ground - dy, tank ? (dy === 6 || dy === 15 ? [70, 76, 56] : [92, 98, 72]) : dy <= 5 ? ((lx - S.WALL) % 10 < 4 ? [30, 30, 32] : [60, 64, 52]) : [64, 68, 54]);
      }
      c.doors.push({ x: X(w - 1), side: facing, top: ground - HANGAR_POST.door, bottom: ground - 1 }, { x: X(0), side: -facing, top: ground - S.DOOR_H, bottom: ground - 1 });
      c.floors.push({ storey: 0, y: ground, left: inL, right: inR });
      c.slots.push({ x: X(w - 30), y: ground, storey: 0, facing });
      c.hangar = { left: inL, right: inR, top: roof, bottom: ground - 1, door: { x: X(w - 1), top: ground - HANGAR_POST.door, bottom: ground - 1 }, spawn: { x: X(dm), y: ground } };
      // the turrets on the roof, at the front (the user's)
      if (O()) {
        const rl = Math.min(X(w >> 1), X(w - 8)), rr = Math.max(X(w >> 1), X(w - 8));
        O().devices(c, style, [{ left: rl, right: rr, y: roof - 6, top: false }], level >= 3 ? ['turret', 'turret'] : ['turret'], facing, random, facing);
      }
      top = roof - 10;
    } else {
      // the bunker: a low box of thick concrete, slits towards the front, earth banked on its flanks
      const roof = ground - bodyH, T = 8;
      for (let lx = 0; lx < w; lx += 1) {
        for (let y = roof; y < ground; y += 1) {
          const wallCell = lx < T || lx >= w - T || y < roof + T;
          if (!wallCell) { K.back(c, X(lx), y, tone([70, 72, 74], 0.8)); continue; }
          const slit = lx >= w - T && y >= ground - 18 && y <= ground - 14;
          if (slit) { K.back(c, X(lx), y, [20, 22, 24]); continue; }
          K.solid(c, X(lx), y, M.CONCRETE, (y - roof) % 6 === 0 ? [104, 104, 100] : [138, 138, 132], y < roof + T ? ROLE.ROOF : ROLE.WALL);
        }
      }
      for (const [lx0, side] of [[-1, -1], [w, 1]]) for (let k = 0; k < 18; k += 1) {
        const h = Math.round((bodyH - 4) * (1 - k / 18));
        for (let dy = 1; dy <= h; dy += 1) K.solid(c, X(lx0 + side * k), ground - dy, M.SOIL, tone([116, 92, 64], 0.9 + ((k + dy) & 3) * 0.04), ROLE.ORNAMENT);
      }
      for (let d = 0; d < T; d += 1) for (let y = ground - S.DOOR_H + 6; y < ground; y += 1) { K.clear(c, X(d), y); K.back(c, X(d), y, tone(P.frame, 0.3)); }
      c.doors.push({ x: X(0), side: -facing, top: ground - S.DOOR_H + 6, bottom: ground - 1 });
      c.floors.push({ storey: 0, y: ground, left: Math.min(X(T), X(w - T - 1)), right: Math.max(X(T), X(w - T - 1)) });
      c.slots.push({ x: X(w - T - 6), y: ground, storey: 0, facing });
      top = roof - 2;
    }
    K.core(c, X(w >> 1), ground, { tier: 'sub' });
    K.corePillars(c, style);
    K.bakeLights(c, style);
    void random;
    c.body = { left: Math.min(X(0), X(w - 1)), right: Math.max(X(0), X(w - 1)), top: Math.max(0, top), bottom: ground - 1 };
    return c;
  }

  // ---- N155 + N163 (the user's, 2026-11-25/27): the watch-tower base -------------------------------
  // Every main military building is a watch tower standing on a multi-winged base, drawn real and
  // plain from the references (refs-military-bases, refs-watchtowers): nothing cartoon. Laid out
  // from its spawn core outward - the core first, under the deck of the vehicle hall; the tower
  // beside the hall over its own stair; the wings stepping down away from the front. Front to back
  // (facing the enemy): the vehicle hall (its door out, the spawn pad over the core), the tower, the
  // ops wing, and from level 3 the annex. Real scale at the trooper's 25 cells to 1.8 m (13.9 a
  // metre): the tower 15-20 m, the wings' storeys 3 m, the hall 7.8 m clear for the armour.
  // The faction shows in the detail, not by going cartoon: modern a bare precast shaft in a
  // scaffold frame; gothic a tapering stone shaft, pointed cab lights, buttressed wing corners;
  // asian a steel-framed shaft with a prefab cab under a tiled cap, slatted screens.
  const WATCH = Object.freeze({ hallClear: 108, hallRoof: 8, shaftW: 44, cabW: 76, cabH: 44, wingW: 124, annexW: 76 });
  // (the war photos' own materials: precast and rendered concrete, sand-render, stone, olive steel)
  const WATCH_MAT = {
    modern: { shaft: [120, 124, 112], shaftDark: [96, 100, 90], joint: [86, 90, 80], cab: [84, 92, 80], trim: [70, 74, 66], mat: M.CONCRETE },
    gothic: { shaft: [138, 130, 118], shaftDark: [108, 102, 92], joint: [84, 80, 72], cab: [96, 94, 92], trim: [74, 70, 66], mat: M.MASONRY },
    asian: { shaft: [104, 108, 90], shaftDark: [80, 84, 70], joint: [62, 66, 54], cab: [98, 102, 86], trim: [96, 60, 48], mat: M.STEEL },
  };
  // The faction emblems (the user's, invented, N163): asian a ring of three arcs round a dot; gothic
  // a pointed arch over a bar; modern a split chevron in a hexagon. On flags, gates and fences
  // only - never on units. emblemMask(style, r) gives a test (dx, dy) -> inked, centred on 0,0.
  function emblemMask(style, r) {
    return (dx, dy) => {
      const d = Math.hypot(dx, dy);
      if (style === 'asian') {
        if (d <= r * 0.3 + 0.35) return true;
        const a = (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 120;
        return Math.abs(d - r) <= 0.6 && a > 18 && a < 102;
      }
      if (style === 'gothic') {
        if (dy >= r * 0.55 && dy <= r * 0.55 + 1 && Math.abs(dx) <= r) return true;   // the bar
        if (dy > r * 0.3) return false;
        // (the arch: two arcs centred r apart crossing at its point)
        const arc = (cx) => Math.abs(Math.hypot(dx - cx, dy - r * 0.3) - r * 1.25) <= 0.6;
        return (dx <= 0 && arc(r * 0.45)) || (dx >= 0 && arc(-r * 0.45)) || (Math.abs(dx) >= r * 0.8 && Math.abs(dx) <= r * 0.8 + 1 && dy >= -r * 0.2);
      }
      // modern: the hexagon outline, a chevron inside split down its middle
      const ax = Math.abs(dx), ay = Math.abs(dy), hex = Math.max(ax * 0.866 + ay * 0.5, ay);
      if (Math.abs(hex - r) <= 0.55) return true;
      return ax >= 1 && ax <= r * 0.6 && Math.abs(dy - (ax - r * 0.25)) <= 0.6;
    };
  }
  PW.factionEmblem = emblemMask;
  const WING_RENDER = [158, 148, 128], WING_RENDER_DARK = [130, 122, 106], WING_PARAPET = [176, 168, 150];
  function militaryWatch(options) {
    const style = options.style, level = Math.max(1, Math.min(6, options.level || 3));
    const facing = options.facing || 1, seed = options.seed || 1;
    const random = PW.createRandom(seed);
    const P = STYLES[style] || STYLES.modern, W8 = WATCH_MAT[style] || WATCH_MAT.modern;
    const setting = options.setting || null;
    // (smaller on a mountain, the user's: no annex, one storey, a short shaft)
    const high = setting === 'mountain';
    const annex = level >= 3 && !high, wingStoreys = level >= 4 && !high ? 2 : 1;
    // logical columns, the hall at the front (high x) - mirrored by X when the base faces left
    const hallW = PAD_W + 2 * S.WALL + 28;
    // (the annex's ground is kept from the first level - a yard with a container until the hut goes
    // up - so the tower stands at the same place at every level: its tunnel goes down under it)
    const aW = high ? 0 : WATCH.annexW, wW = WATCH.wingW, sW = WATCH.shaftW;
    const annex0 = 0, wing0 = aW, shaft0 = aW + wW, hall0 = shaft0 + sW, bodyWidth = hall0 + hallW;
    const margin = 52, coreDepth = K.VAULT_DEPTH + 3;
    const hallTop = WATCH.hallClear + WATCH.hallRoof;
    // (the shaft above the hall's roof: the cab's roof 14-18 m up, 13-16 m on a mountain - the refs' 12-18 m)
    const rise = high ? 16 + 6 * level : 30 + 10 * level;
    const cabFloorUp = hallTop + rise, cabTopUp = cabFloorUp + WATCH.cabH;
    const top = cabTopUp + 60;                     // room for the masts and the sensor
    const width = bodyWidth + margin * 2, height = top + coreDepth + 20;
    const ground = height - coreDepth - 1;
    const c = K.createCanvas(width, height, ground);
    // (the variant kept - growth, the game and the suites know a base by it; watch marks the design)
    c.meta = { type: 'military', style, level, variant: options.variant === 'watch' ? 'compound' : (options.variant || 'compound'), watch: true, facing, seed, hallRaise: 0 };
    const X = (lx) => (facing > 0 ? margin + lx : margin + bodyWidth - 1 - lx);
    const span = (a, b) => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];
    const lit = (d, total) => (d === 0 ? 1.12 : d === total - 1 ? 0.78 : 1);

    // ---- the vehicle hall: a steel portal frame, flat roof, the door out to the front ----
    const hallIn0 = hall0 + S.WALL, hallIn1 = hall0 + hallW - 1 - S.WALL, hallRoofRow = ground - WATCH.hallClear;
    {
      const [x0, x1] = span(hallIn0, hallIn1);
      K.rect(c, x0, hallRoofRow, x1, ground - 1, (x, y) => {
        const up = ground - 1 - y, rib = Math.abs(x - X(hall0)) % 30 < 2;
        K.back(c, x, y, up < 3 ? ((x >> 3) & 1 ? [214, 182, 64] : [42, 42, 46]) : tone([64, 66, 64], rib ? 1.25 : (up % 22 === 0 ? 1.15 : 1)));
      });
      for (let lx = hallIn0 + 24; lx < hallIn1 - 16; lx += 48) K.ceilingLamp(c, style, X(lx), hallRoofRow + 1);
      // the walls: ribbed steel cladding on the frame, the back wall shared with the shaft
      for (let d = 0; d < S.WALL; d += 1) {
        for (const lx of [hall0 + d, hall0 + hallW - 1 - d]) for (let y = hallRoofRow; y < ground; y += 1) {
          const front = lx > hall0 + hallW / 2;
          if (front && y >= ground - 100) continue;   // the door, a tank's height and a mech's
          K.solid(c, X(lx), y, M.STEEL, tone((x2 => (x2 % 6 < 3 ? [104, 108, 100] : [88, 92, 86]))(y), lit(d, S.WALL)), ROLE.WALL);
        }
      }
      // the door's frame: a hazard-banded lintel, a red and amber lamp at each side of it
      for (let d = 0; d < S.WALL; d += 1) K.solid(c, X(hall0 + hallW - 1 - d), ground - 101, M.STEEL, (d & 1) ? MIL_AMBER : [40, 40, 44], ROLE.FRAME);
      c.lamps.push({ x: X(hall0 + hallW - 3), y: ground - 104, radius: 12, strength: 0.4, color: MIL_AMBER });
      // the flat roof: slab and a low parapet lip, the drip edge in the trim colour
      for (let lx = hall0; lx < hall0 + hallW; lx += 1) for (let t = 0; t < WATCH.hallRoof; t += 1) {
        K.solid(c, X(lx), hallRoofRow - 1 - t, M.CONCRETE, t === WATCH.hallRoof - 1 ? tone([150, 148, 140], 1.05) : t === 0 ? tone(W8.trim, 0.9) : [118, 116, 110], ROLE.ROOF);
      }
      for (const lx of [hall0, hall0 + 1, hall0 + hallW - 2, hall0 + hallW - 1]) for (let dy = 1; dy <= 3; dy += 1) K.solid(c, X(lx), hallRoofRow - WATCH.hallRoof - dy, M.CONCRETE, WING_PARAPET, ROLE.ORNAMENT);
      // the spawn pad over the core, laid first in the hall's floor - the base is drawn round it
      const pcx = Math.round((hallIn0 + hallIn1) / 2), p0 = pcx - PAD_W / 2, p1 = pcx + PAD_W / 2 - 1;
      K.core(c, X(pcx), ground, { military: true, seed });
      spawnPad(c, X, p0, p1, ground);
      c.pad = { x0: Math.min(X(p0), X(p1)), x1: Math.max(X(p0), X(p1)), y: ground };
      c.hangar = { left: x0, right: x1, top: hallRoofRow, bottom: ground - 1,
        door: { x: X(hall0 + hallW - 1), top: ground - 100, bottom: ground - 1 }, spawn: { x: X(pcx), y: ground } };
      c.floors.push({ storey: 0, y: ground, left: x0, right: x1 });
      c.doors.push({ x: X(hall0 + hallW - 1), side: facing, top: ground - 100, bottom: ground - 1 });
    }

    // ---- the tower: the shaft, its stair ladder and landings, the cab, the roof deck and masts ----
    const cabFloor = ground - cabFloorUp, cabTop = ground - cabTopUp;
    const sx0 = shaft0, sx1 = shaft0 + sW - 1;
    {
      const taper = style === 'gothic' ? 6 : 0;   // (gothic: the shaft tapers as it rises)
      for (let y = cabFloor; y < ground; y += 1) {
        const up = ground - 1 - y, inset = Math.round(taper * up / cabFloorUp);
        const l = sx0 + inset, r = sx1 - inset;
        for (let lx = l; lx <= r; lx += 1) {
          const d = Math.min(lx - l, r - lx), wall = d < S.WALL;
          if (!wall) { K.back(c, X(lx), y, tone([58, 58, 56], up % 40 < 2 ? 1.3 : 1)); continue; }
          let col;
          if (style === 'modern') col = (up % 40 === 0 || (lx - l) % 22 === 0) ? W8.joint : W8.shaft;           // precast panels
          else if (style === 'gothic') col = (up % 9 === 0 || (lx + (up / 9 | 0) * 7) % 16 === 0) ? W8.joint : W8.shaft;   // ashlar courses
          else col = ((lx - l) % 11 === 0 || up % 30 === 0) ? W8.joint : W8.shaft;                             // steel frame and infill
          K.solid(c, X(lx), y, W8.mat, tone(col, lit(Math.min(d, S.WALL - 1), S.WALL) * ((PW.hash2(lx, y) & 7) === 0 ? 0.95 : 1)), ROLE.WALL);
        }
      }
      // (weathering streaks under the joints - the photos' rain-stained concrete)
      for (let lx = sx0 + 2; lx <= sx1 - 2; lx += 7) if ((PW.hash2(lx, seed) & 3) === 0) {
        for (let up = 40; up < cabFloorUp - 4; up += 40) for (let k = 1; k < 10; k += 1) {
          const x = X(lx), y = ground - 1 - up + k, i = y * c.width + x;
          if (c.role[i] === ROLE.WALL) c.paint[i] = K.pack(tone(W8.shaftDark, 0.98 + k * 0.004));
        }
      }
      // modern: the scaffold frame round the shaft (the British tower's)
      // (as wide as the cab, standards every 12 columns from the roofs below up to a working deck
      // under the cab, ledgers every 20 rows; the deck wider than the cab, its railing, the
      // antenna booms off its ends)
      if (style === 'modern') {
        const mid = (sx0 + sx1) / 2, f0 = Math.round(mid - WATCH.cabW / 2) + 2, f1 = Math.round(mid + WATCH.cabW / 2) - 2;
        const deckRow = cabFloor + S.SLAB + 6;
        for (let lx = f0; lx <= f1; lx += 12) {
          // (down past the shaft, in front of it, to the roof it stands on: the wing's or the hall's)
          const foot = lx < sx0 ? ground - wingStoreys * S.FLOOR : hallRoofRow - WATCH.hallRoof;
          for (let y = deckRow; y < foot; y += 1) K.deco(c, X(lx), y, [92, 100, 88]);
        }
        for (let y = deckRow + 20; y < hallRoofRow - WATCH.hallRoof; y += 20) for (let lx = f0; lx <= f1; lx += 1) K.deco(c, X(lx), y, [112, 118, 106]);
        for (let lx = f0 - 10; lx <= f1 + 10; lx += 1) for (let t = 0; t < 2; t += 1) K.deco(c, X(lx), deckRow + t, t ? [70, 74, 66] : [124, 128, 118]);
        for (let lx = f0 - 10; lx <= f1 + 10; lx += 1) if ((lx - f0) % 6 === 0 || lx === f0 - 10 || lx === f1 + 10) for (let dy = 1; dy <= 6; dy += 1) K.deco(c, X(lx), deckRow - dy, [104, 108, 100]);
        for (let lx = f0 - 10; lx <= f1 + 10; lx += 1) K.deco(c, X(lx), deckRow - 6, [130, 134, 126]);
        // the antenna booms: a yagi off each end of the deck, a whip
        for (const [bx, s] of [[f0 - 10, -1], [f1 + 10, 1]]) {
          for (let k = 0; k < 12; k += 1) K.deco(c, X(bx + s * k), deckRow - 3, [96, 98, 96]);
          for (let k = 2; k < 12; k += 3) for (let dy = -2; dy <= 2; dy += 1) K.deco(c, X(bx + s * k), deckRow - 3 + dy, [120, 122, 120]);
        }
        for (let dy = 0; dy < 34; dy += 1) K.deco(c, X(f1 + 8), deckRow - 7 - dy, [84, 86, 84]);
      }
      // the ladder up the shaft and a landing every storey, a hatch in each
      const lx = sx0 + S.WALL + 6, rail = tone(P.ornament, 0.6), rung = tone(P.ornament, 0.8);
      for (let y = cabFloor; y < ground; y += 1) {
        K.back(c, X(lx - 2), y, rail); K.back(c, X(lx + 2), y, rail);
        if ((ground - y) % 4 === 0) for (let x = lx - 1; x <= lx + 1; x += 1) K.back(c, X(x), y, rung);
      }
      (c.ladders = c.ladders || []).push({ x0: Math.min(X(lx - 1), X(lx + 1)), x1: Math.max(X(lx - 1), X(lx + 1)), y0: cabFloor - 2, y1: ground - 1 });
      for (let up = S.FLOOR * 2; up < cabFloorUp - 8; up += S.FLOOR * 2) {
        const y = ground - up;
        for (let x = sx0 + S.WALL; x <= sx1 - S.WALL; x += 1) for (let t = 0; t < S.SLAB; t += 1) {
          K.solid(c, X(x), y + t, Math.abs(x - lx) <= 3 ? M.PLATFORM : M.CONCRETE, tone([96, 96, 92], t === 0 ? 1.1 : 0.9), ROLE.SLAB);
        }
        const [a, b] = span(sx0 + S.WALL, sx1 - S.WALL);
        c.floors.push({ storey: c.floors.length, y, left: a, right: b });
      }
      // (no door is cut at the shaft's foot - the walls stand to the ground and carry the tower; the
      // way in is the base's own: see the tower's gates below)
      // the cab: cantilevered both ways, a ribbon of glazing on mullions, a lit desk inside
      const c0 = Math.round((sx0 + sx1) / 2 - WATCH.cabW / 2), c1 = c0 + WATCH.cabW - 1;
      for (let lx2 = c0; lx2 <= c1; lx2 += 1) for (let t = 0; t < S.SLAB + 2; t += 1) K.solid(c, X(lx2), cabFloor + t, Math.abs(lx2 - lx) <= 3 ? M.PLATFORM : M.CONCRETE, tone([110, 108, 104], t === 0 ? 1.1 : t === S.SLAB + 1 ? 0.75 : 0.95), ROLE.SLAB);
      c.stairs.push({ storey: 0, dir: facing, from: X(lx), to: X(lx), floorRow: ground, upperRow: cabFloor, ladder: true });
      for (let y = cabTop; y < cabFloor; y += 1) {
        const up = cabFloor - 1 - y;
        for (let lx2 = c0; lx2 <= c1; lx2 += 1) {
          const d = Math.min(lx2 - c0, c1 - lx2);
          const glazed = up >= 10 && up <= 30;
          const mullion = (lx2 - c0) % 12 < 2;
          const gothicHead = style === 'gothic' && up >= 25 && Math.abs(((lx2 - c0) % 12) - 6.5) > (30 - up) * 1.1;
          // (the ribbon of glazing all round the cab, seen through it: sky through the far side)
          if (d >= S.WALL - 1) {
            K.back(c, X(lx2), y, glazed && !mullion && !gothicHead ? tone([118, 138, 146], 0.9 + (up - 10) * 0.008) : up === 9 ? [74, 76, 76] : tone(W8.cab, 0.62));
            continue;
          }
          if (glazed && !mullion && !gothicHead) K.solid(c, X(lx2), y, M.GLASS, mix(K.GLASS_SIDE, P.lamp, up < 16 ? 0.45 : 0.25), ROLE.GLASS);
          else K.solid(c, X(lx2), y, style === 'asian' ? M.STEEL : W8.mat, tone(W8.cab, lit(d, S.WALL - 1)), ROLE.WALL);
        }
      }
      c.floors.push({ storey: c.floors.length, y: cabFloor, left: Math.min(X(c0 + S.WALL), X(c1 - S.WALL)), right: Math.max(X(c0 + S.WALL), X(c1 - S.WALL)) });
      // the watch desk under the glazing: a long top, three small screens, a radio stack
      for (let lx2 = c0 + 10; lx2 <= c0 + 44; lx2 += 1) {
        K.back(c, X(lx2), cabFloor - 8, [92, 94, 94]);
        if ((lx2 - c0) % 10 === 0) for (let dy = 1; dy < 8; dy += 1) K.back(c, X(lx2), cabFloor - dy, [56, 58, 60]);
      }
      for (const sx of [c0 + 14, c0 + 22, c0 + 30]) for (let dx = 0; dx < 6; dx += 1) for (let dy = 9; dy <= 13; dy += 1) {
        K.back(c, X(sx + dx), cabFloor - dy, dy === 13 || dx === 0 || dx === 5 ? [26, 28, 30] : dy === 9 ? [40, 42, 44] : [126, 176, 196]);
      }
      for (let dy = 9; dy <= 16; dy += 1) for (let dx = 0; dx < 6; dx += 1) K.back(c, X(c0 + 38 + dx), cabFloor - dy, (dy & 1) ? [38, 40, 38] : dx === 1 && dy === 12 ? [120, 230, 140] : [62, 66, 60]);
      c.lamps.push({ x: X(c0 + WATCH.cabW / 2), y: cabFloor - 14, radius: 30, strength: 0.5, color: P.lamp });
      // the hackable panel in the cab
      PW.buildingPanel(c, style, Math.min(X(c1 - 26), X(c1 - 9)), cabFloor);
      c.panels.push({ x: X(c1 - 18), y: cabFloor, storey: c.floors.length - 1 });
      // the roof: overhanging slab, the asian tiled cap, a railed deck, the masts and the sensor
      const r0 = c0 - 6, r1 = c1 + 6;
      for (let lx2 = r0; lx2 <= r1; lx2 += 1) for (let t = 0; t < 5; t += 1) K.solid(c, X(lx2), cabTop - 1 - t, M.CONCRETE, tone([126, 124, 118], t === 4 ? 1.12 : t === 0 ? 0.7 : 1), ROLE.ROOF);
      const deck = cabTop - 6;
      if (style === 'asian') {
        for (let k = 0; k < 7; k += 1) for (let lx2 = r0 + 2 + k * 2; lx2 <= r1 - 2 - k * 2; lx2 += 1) {
          K.solid(c, X(lx2), deck - k, M.TILE, tone(P.roof, k === 6 ? 1.25 : (lx2 % 5 === 0 ? 0.85 : 1)), ROLE.ROOF);
        }
      } else {
        for (let lx2 = r0 + 1; lx2 <= r1 - 1; lx2 += 1) {
          if ((lx2 - r0) % 8 === 0 || lx2 === r0 + 1 || lx2 === r1 - 1) for (let dy = 0; dy < 9; dy += 1) K.deco(c, X(lx2), deck - dy, [120, 124, 122]);
          K.deco(c, X(lx2), deck - 9, [148, 150, 148]); K.deco(c, X(lx2), deck - 5, [108, 110, 108]);
        }
      }
      const mastFoot = style === 'asian' ? deck - 7 : deck;
      // a lattice mast with whips and a yagi, and floodlights at the deck's corners
      const mx = c0 + 14, mh = 40 + level * 4;
      for (let dy = 0; dy < mh; dy += 1) {
        K.solidIfEmpty(c, X(mx), mastFoot - dy, M.STEEL, dy % 6 === 0 ? [150, 152, 150] : [96, 98, 96], ROLE.ORNAMENT);
        if (dy % 6 === 3) { K.deco(c, X(mx - 1), mastFoot - dy, [110, 112, 110]); K.deco(c, X(mx + 1), mastFoot - dy, [110, 112, 110]); }
      }
      for (let k = -5; k <= 5; k += 1) K.deco(c, X(mx + k), mastFoot - mh + 10, [130, 132, 130]);   // the yagi's boom
      for (const wx of [c0 + 30, c1 - 10]) for (let dy = 0; dy < 22 + (wx & 7); dy += 1) K.deco(c, X(wx), mastFoot - dy, [86, 88, 86]);   // whips
      K.deco(c, X(mx), mastFoot - mh, [255, 70, 56]);
      c.lamps.push({ x: X(mx), y: mastFoot - mh, radius: 6, strength: 0.6, color: [255, 70, 56] });
      for (const fx of [r0 + 2, r1 - 2]) { K.deco(c, X(fx), mastFoot - 10, [236, 232, 210]); c.lamps.push({ x: X(fx), y: mastFoot - 10, radius: 40, strength: 0.45, color: [236, 232, 210] }); }
      if (level >= 3) {   // the sensor turret on its pedestal
        const tx = c1 - 18;
        for (let dy = 0; dy < 6; dy += 1) for (let dx = -3; dx <= 3; dx += 1) K.solidIfEmpty(c, X(tx + dx), mastFoot - dy, M.STEEL, [92, 96, 94], ROLE.ORNAMENT);
        for (let dy = 6; dy < 14; dy += 1) for (let dx = -7; dx <= 7; dx += 1) K.solidIfEmpty(c, X(tx + dx), mastFoot - dy, M.STEEL, dy === 9 && Math.abs(dx) < 3 ? [40, 46, 52] : [122, 126, 120], ROLE.ORNAMENT);
      }
      // the faction's flag on the mast, its emblem in the middle (N163: emblems on flags, gates and fences only)
      const fy = mastFoot - mh + 2, field = tone(P.frame, 0.82), mark = emblemMask(style, 5);
      for (let dy = 0; dy < 15; dy += 1) for (let dx = 1; dx <= 22; dx += 1) {
        if (dx > 15 && dy === 14) continue;   // (the fly end hanging a little)
        K.deco(c, X(mx + dx), fy + dy, mark((dx - 12) * facing, dy - 7) ? [226, 222, 206] : tone(field, (dx + dy) % 7 === 0 ? 0.9 : 1));
      }
    }

    // ---- the ops wing (and the annex): rendered blockwork, flat roofs, AC units, the ops room ----
    const wingTopUp = wingStoreys * S.FLOOR + S.SLAB;
    const wingBlock = (a0, w, storeys, ops) => {
      const a1 = a0 + w - 1;
      for (let k = 0; k < storeys; k += 1) {
        const fRow = ground - k * S.FLOOR, ceil = ground - (k + 1) * S.FLOOR;
        const [i0, i1] = span(a0 + S.WALL, a1 - S.WALL);
        // (inside: painted blockwork over a dark dado, as the photos' barrack rooms - no faction colour)
        K.rect(c, i0, ceil + S.SLAB, i1, fRow - 1, (x, y) => K.back(c, x, y, ops && k === 0 ? tone([34, 40, 50], 1 + ((y - ceil) % 20 === 0 ? 0.15 : 0))
          : fRow - 1 - y < 10 ? tone([70, 72, 66], 1) : tone([104, 102, 94], ((fRow - y) % 6 === 0 || (x + ((fRow - y) / 6 | 0) * 6) % 12 === 0) ? 0.92 : 1)));
        for (const lx of [a0, a1]) for (let d = 0; d < S.WALL; d += 1) for (let y = ceil; y < fRow; y += 1) {
          const wx = X(lx === a0 ? lx + d : lx - d), up = fRow - 1 - y;
          const slit = up >= 13 && up <= 18 && k > 0;
          if (slit) K.solid(c, wx, y, M.GLASS, mix([26, 30, 36], P.lamp, 0.3), ROLE.GLASS);
          else K.solid(c, wx, y, P.wallMat === M.WOOD ? M.CONCRETE : P.wallMat, tone(up % 20 === 0 ? WING_RENDER_DARK : WING_RENDER, lit(d, S.WALL) * ((PW.hash2(wx, y) & 15) === 0 ? 0.94 : 1)), ROLE.WALL);
        }
        // the slab over the storey
        for (let lx = a0; lx <= a1; lx += 1) for (let t = 0; t < S.SLAB; t += 1) K.solid(c, X(lx), ceil + t, M.CONCRETE, tone([124, 120, 110], t === 0 ? 1.08 : t === S.SLAB - 1 ? 0.78 : 0.94), k === storeys - 1 ? ROLE.ROOF : ROLE.SLAB);
        c.floors.push({ storey: c.floors.length, y: fRow, left: i0, right: i1 });
        c.slots.push({ x: X(a0 + 30), y: fRow, storey: k, facing });
        for (let lx = a0 + 22; lx < a1 - 12; lx += 40) K.ceilingLamp(c, style, X(lx), ceil + S.SLAB);
      }
      // the roof: parapet, AC units and louvres
      const roofRow = ground - storeys * S.FLOOR;
      for (const lx of [a0, a0 + 1, a1 - 1, a1]) for (let dy = 1; dy <= 4; dy += 1) K.solid(c, X(lx), roofRow - dy, M.CONCRETE, WING_PARAPET, ROLE.ORNAMENT);
      // (the AC units by the tower, the far end of the roof left free for the guns)
      for (let lx = a1 - 22; lx > a1 - 60 && lx > a0 + 8; lx -= 18) for (let dy = 1; dy <= 7; dy += 1) for (let dx = 0; dx < 12; dx += 1) {
        K.solidIfEmpty(c, X(lx + dx), roofRow - dy, M.STEEL, dy === 7 ? [168, 170, 166] : (dx % 3 === 1 && dy > 1 && dy < 6) ? [70, 72, 70] : [138, 140, 136], ROLE.ORNAMENT);
      }
      // the ops room: desks of two and three lit screens, the map wall, racks, cable trays
      if (ops) {
        const fRow = ground, [i0, i1] = span(a0 + S.WALL, a1 - S.WALL);
        for (let x = i0 + 4; x <= i1 - 4; x += 1) K.back(c, x, fRow - S.FLOOR + S.SLAB + 2, (x & 3) === 0 ? [70, 74, 80] : [52, 56, 60]);   // the tray
        const wall0 = i0 + 6, wall1 = Math.min(i1 - 30, wall0 + 46);
        for (let x = wall0; x <= wall1; x += 1) for (let y = fRow - 32; y <= fRow - 18; y += 1) {
          const edge = x === wall0 || x === wall1 || y === fRow - 32 || y === fRow - 18;
          const blip = (PW.hash2(x, y + seed) & 31) === 0;
          K.back(c, x, y, edge ? [20, 24, 28] : blip ? [120, 232, 150] : ((x - wall0) % 16 === 0 ? [40, 70, 96] : [28, 62, 92]));
        }
        c.lamps.push({ x: (wall0 + wall1) >> 1, y: fRow - 24, radius: 26, strength: 0.4, color: [96, 160, 220] });
        for (let x = i0 + 8; x < i1 - 14; x += 22) {
          for (let dx = 0; dx < 14; dx += 1) K.back(c, x + dx, fRow - 9, [86, 88, 90]);   // the desk
          for (const sx of [x + 1, x + 6]) for (let dx = 0; dx < 4; dx += 1) for (let dy = 11; dy <= 14; dy += 1) K.back(c, sx + dx, fRow - dy, dy === 14 || dx === 0 ? [30, 34, 38] : [150, 196, 230]);
        }
        for (let y = fRow - 30; y < fRow; y += 1) for (let dx = 0; dx < 8; dx += 1) K.back(c, i1 - 10 + dx, y, (y & 3) === 0 && dx > 1 && dx < 6 ? [120, 236, 140] : [26, 28, 32]);   // a rack
      }
      // the door on the far end
      const far = !annex ? a0 : null;   // (the wing's own far door, where no hut stands behind it)
      if (far !== null) {
        for (let d = 0; d < S.WALL; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(a0 + d), y); K.back(c, X(a0 + d), y, tone(P.frame, 0.3)); }
        c.doors.push({ x: X(a0), side: -facing, top: ground - S.DOOR_H, bottom: ground - 1 });
      }
      return { roofRow, a0, a1 };
    };
    const wing = wingBlock(wing0, wW, wingStoreys, true);
    // The tower is a wall to the enemy and lets its own side through (the user's): the walls at its
    // foot - the wing's end wall, the shaft's two, the hall's back wall - are the base's gates from
    // grade to a man's height and more (PS's gate spans: own troopers, tanks and mechs pass them,
    // an enemy meets a wall), standing to the ground, carrying the tower, a door frame painted on.
    c.gates = c.gates || [];
    for (const [a, b] of [[shaft0 - S.WALL, shaft0 + S.WALL - 1], [sx1 - S.WALL + 1, hall0 + S.WALL - 1]]) {
      for (let lx = a; lx <= b; lx += 1) {
        c.gates.push({ x: X(lx), y0: ground - S.DOOR_H, y1: ground - 1 });
        for (let y = ground - S.DOOR_H; y < ground; y += 1) {
          const i = y * c.width + X(lx);
          if (c.role[i] === ROLE.WALL) c.paint[i] = K.pack(tone(PW.unpack(c.paint[i]), y === ground - S.DOOR_H || lx === a || lx === b ? 0.72 : 0.86));
        }
      }
    }
    if (wingStoreys > 1) {
      // a stair between the wing's storeys
      const st = wing0 + 20;
      for (let i = 0; i < S.STAIR_RUN / S.STEP; i += 1) {
        const surface = ground - S.STEP * (i + 1);
        for (let j = 0; j < S.STEP; j += 1) for (let y = surface; y < Math.min(ground, surface + S.STEP + S.STAIR_THICK); y += 1) K.solid(c, X(st + i * S.STEP + j), y, M.PLATFORM, y === surface ? [128, 130, 126] : [84, 86, 84], ROLE.STAIR);
      }
      for (let lx = st - 2; lx <= st + 41; lx += 1) for (let row = 0; row < S.SLAB; row += 1) {
        const i = (ground - S.FLOOR + row) * c.width + X(lx);
        if (c.role[i] === ROLE.SLAB) c.mat[i] = M.PLATFORM;
      }
      c.stairs.push({ storey: 0, dir: facing, from: X(st), to: X(st + 39), floorRow: ground, upperRow: ground - S.FLOOR });
    }
    let annexRoof = null;
    if (annex) {
      // the annex: a corrugated hut (barracks), its door at the far end
      const a1 = annex0 + aW - 1;
      for (let lx = annex0; lx <= a1; lx += 1) {
        const u = (lx - annex0) / (aW - 1), h = Math.round(S.FLOOR - 4 + 10 * Math.sin(u * Math.PI));
        for (let up = 0; up < h; up += 1) {
          const y = ground - 1 - up, shell = up >= h - 3 || lx - annex0 < S.WALL || a1 - lx < S.WALL;
          if (shell) K.solid(c, X(lx), y, M.STEEL, tone(lx % 4 < 2 ? [126, 128, 112] : [104, 106, 92], up >= h - 3 ? 1.08 : 0.95), up >= h - 3 ? ROLE.ROOF : ROLE.WALL);
          else K.back(c, X(lx), y, [58, 56, 50]);
        }
      }
      for (let d = 0; d < S.WALL; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(annex0 + d), y); K.back(c, X(annex0 + d), y, tone(P.frame, 0.3)); }
      c.doors.push({ x: X(annex0), side: -facing, top: ground - S.DOOR_H, bottom: ground - 1 });
      const [i0, i1] = span(annex0 + S.WALL, a1 - S.WALL);
      c.floors.push({ storey: c.floors.length, y: ground, left: i0, right: i1 });
      annexRoof = { a0: annex0, a1 };
      // and the door between annex and wing
      for (let d = 0; d < S.WALL * 2 + 2; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(a1 - S.WALL + d), y); K.back(c, X(a1 - S.WALL + d), y, [40, 42, 44]); }
    } else if (aW) {
      // the yard: a 20-foot container (6 m, 2.6 m tall) on sleepers, corrugated, its doors to the
      // wing; open ground round it
      const k0 = annex0 + 4, k1 = annex0 + aW - 6, h = 36;
      for (let lx = k0; lx <= k1; lx += 1) for (let up = 2; up < h; up += 1) {
        const y = ground - 1 - up, edge = lx - k0 < 2 || k1 - lx < 2 || up >= h - 2 || up < 4;
        const doors = k1 - lx < 2 && (up - 4) % 8 < 1;
        // (behind the way out of the wing's far door - the men walk past it, not over it)
        K.back(c, X(lx), y, doors ? [70, 76, 60] : edge ? [84, 92, 70] : tone((lx - k0) % 4 < 2 ? [104, 112, 86] : [90, 98, 74], up % 12 === 0 ? 0.92 : 1));
      }
      for (const lx of [k0 + 6, k1 - 6]) for (let dx = -3; dx <= 3; dx += 1) for (let up = 0; up < 2; up += 1) K.back(c, X(lx + dx), ground - 1 - up, [92, 76, 58]);
    }
    // gothic: a stone plinth course along the wing's foot; asian: a slatted timber screen under its eaves
    if (style === 'gothic') {
      for (let lx = wing0; lx < wing0 + wW; lx += 1) for (let up = 0; up < 3; up += 1) {
        const i = (ground - 1 - up) * c.width + X(lx);
        if (c.role[i] === ROLE.WALL) c.paint[i] = K.pack(tone(W8.shaftDark, up === 2 ? 1.12 : 1));
      }
    } else if (style === 'asian') {
      for (let lx = wing0 + 2; lx < wing0 + wW - 2; lx += 3) for (let dy = 0; dy < 6; dy += 1) K.deco(c, X(lx), ground - wingTopUp + S.SLAB + 2 + dy, [84, 66, 50]);
    }
    // the guns: turrets at the hall's front on its flat roof (the user's: turrets in front, flat
    // roofs only), a launcher behind them and an interceptor on the wing from level 3 (as the old
    // bases had them)
    if (O()) {
      const ornament = O(), deviceFacing = options.deviceFacing ?? facing;
      const [h0, h1] = span(hall0 + 6, hall0 + hallW - 7), [w0, w1] = span(wing.a0 + 6, wing.a1 - 6);
      const hallRoof = { left: h0, right: h1, y: hallRoofRow - WATCH.hallRoof, top: false };
      // (a side's base faces all its guns at the enemy; a neutral's cover both ways - the front
      // turret out, the launcher and the wing's gun back)
      const back = deviceFacing || -facing;
      // (the launcher on the wing's roof at the back, where the old bases kept it on their rear
      // block; the interceptor behind the hall's turret)
      ornament.devices(c, style, [hallRoof], ['turret'], deviceFacing || facing, random, facing);
      if (level >= 3) ornament.devices(c, style, [hallRoof], ['interceptor'], back, random, back);
      ornament.devices(c, style, [{ left: w0, right: w1, y: wing.roofRow, top: true, open: true }], level >= 4 ? ['launcher'] : ['turret'], back, random, back);
    }
    // a sandbag position at the rear door (bags laid in courses, the joints staggered); razor wire
    // in coils along the wing's parapet
    for (let k = 0; k < 4; k += 1) for (let dx = -26 + k * 3; dx < -4 - k * 2; dx += 1) for (let row = 0; row < 3; row += 1) {
      const seam = (dx + k * 3 + 40) % 7 === 0 || row === 2;
      K.solidIfEmpty(c, X(dx), ground - 1 - k * 3 - row, M.COVER_SAND, tone([162, 148, 112], seam ? 0.78 : row === 0 ? 1.06 : 0.96), ROLE.ORNAMENT);
    }
    for (let lx = wing.a0 + 2; lx < wing.a1 - 2; lx += 1) {
      const t = (lx - wing.a0) % 6, ring = [[0, 0], [1, -1], [2, -2], [3, -2], [4, -1], [5, 0]][t];
      K.deco(c, X(lx), wing.roofRow - 5 + ring[1], [150, 154, 158]);
      if (t === 2 || t === 3) K.deco(c, X(lx), wing.roofRow - 5 - 3, [124, 128, 132]);
    }
    // in the mountains, camouflage netting slung over the roofs (the refs' hill posts)
    if (setting === 'mountain') {
      const net = (a0, a1, row) => {
        for (let lx = a0; lx <= a1; lx += 1) {
          const u = (lx - a0) / Math.max(1, a1 - a0), sag = Math.round(Math.sin(u * Math.PI) * 3);
          for (let t = 0; t < 3; t += 1) {
            const h = PW.hash2(lx >> 1, t + seed) & 7;
            K.deco(c, X(lx), row - 9 + sag + t, h < 3 ? [92, 96, 64] : h < 5 ? [118, 108, 78] : h < 7 ? [74, 78, 54] : [138, 128, 96]);
          }
          if ((lx - a0) % 22 === 0) for (let dy = row - 8 + sag; dy < row; dy += 1) K.deco(c, X(lx), dy, [72, 66, 52]);   // the poles
        }
      };
      net(wing.a0, wing.a1, wing.roofRow);
      net(hall0, hall0 + hallW - 1, hallRoofRow - WATCH.hallRoof);
    }
    void annexRoof;

    // service cores under the wing (subs), the main core under the pad
    for (const lx of [wing0 + 24, wing0 + wW - 24]) K.core(c, X(lx), ground, { tier: 'sub' });
    // the base's slab: a bed of concrete under the whole of it, as the pad has, round the vaults
    // (no street or made ground runs on under the annex and the yard)
    for (let lx = 0; lx < bodyWidth; lx += 1) for (let y = ground; y <= ground + 8; y += 1) {
      const x = X(lx), i = y * c.width + x;
      if (c.mat[i] || c.back[i] || c.role[i]) continue;
      K.solid(c, x, y, M.FOUNDATION, tone([86, 86, 82], y === ground ? 1.08 : y === ground + 8 ? 0.8 : 1), ROLE.VAULT);
    }
    K.corePillars(c, style);
    if (!PW.NO_UNDERCROFT) K.undercroft(c, style, margin, margin + bodyWidth - 1);
    K.bakeLights(c, style);
    c.body = { left: margin, right: margin + bodyWidth - 1, top: cabTop - 6, bottom: ground - 1 };
    c.runway = { from: X(hall0 + hallW - 1) + facing, direction: facing, length: 380, y: ground };
    c.watch = { shaft: span(sx0, sx1), ladderX: X(sx0 + S.WALL + 6), cabFloor, cabTop, hall: span(hall0, hall0 + hallW - 1), wing: span(wing0, wing0 + wW - 1), annex: annex ? span(annex0, annex0 + aW - 1) : null };
    return c;
  }

  // ---- N155 (the user's): a militarised population building gets a GARAGE beside it, and the
  // building itself stays as it was - no armour skin, no recolouring, no struck furnishings. The
  // garage: a steel portal-frame shed one storey tall (a tank's height and a mech's under its
  // beams), ribbed cladding, a roller door out, a flat roof with a turret at its outer end and a
  // hazard strip at the door; the hackable panel on its back wall, a sandbag wall at the door's
  // side. annexSide -1 / +1 / 0 (both flanks), as militarise.
  // (as wide as the old wing it replaces - 5 m inside, a vehicle's bay: the town's rings stand where
  // they stood, no tower re-seated for it)
  const GARAGE = Object.freeze({ w: 68, clear: 72, roof: 6, door: 66 });
  function militaryGarage(src, style, annexSide = -1) {
    const level = (src.meta && src.meta.level) || 1, seed = (src.meta && src.meta.seed) || 1;
    // (the footprint exactly the old wing's - its width by the building's storeys and level, the
    // canvas and the body grown as it grew them - so the town's rings and welds stand as they did)
    const towerStoreys = (src.meta && src.meta.storeys) || 3;
    const annexFloors = Math.max(3, Math.min(towerStoreys + 1, 5 + Math.min(2, Math.floor((level - 1) / 2))));
    const ANNEX_W = 34 + (annexFloors - 5 > 0 ? (annexFloors - 5) * 4 : 0) + 26 + 6 + 2;
    const GW = ANNEX_W + 4, gap = 0, pad = 7;
    const padL = annexSide <= 0 ? ANNEX_W + 6 : pad, padR = annexSide >= 0 ? ANNEX_W + 6 : pad;
    const c = K.createCanvas(src.width + padL + padR, src.height, src.ground);
    for (let y = 0; y < src.height; y += 1) for (let x = 0; x < src.width; x += 1) {
      const i = y * src.width + x, j = y * c.width + (x + padL);
      c.mat[j] = src.mat[i]; c.back[j] = src.back[i]; c.deco[j] = src.deco[i];
      c.paint[j] = src.paint[i]; c.role[j] = src.role[i];
    }
    const sx = (p) => ({ ...p, x: p.x + padL });
    c.meta = { ...src.meta, militarised: true, garage: true, garagePad: padL };
    c.floors = src.floors.map((f) => ({ ...f, left: f.left + padL, right: f.right + padL }));
    c.stairs = src.stairs.map((s) => ({ ...s, from: s.from + padL, to: s.to + padL }));
    c.hatches = (src.hatches || []).map((h) => ({ ...h, x0: h.x0 + padL, x1: h.x1 + padL }));
    if (src.ladders) c.ladders = src.ladders.map((l) => ({ ...l, x0: l.x0 + padL, x1: l.x1 + padL }));
    c.doors = src.doors.map((d) => ({ ...d, x: d.x + padL }));
    c.slots = src.slots.map(sx); c.panels = src.panels.map(sx);
    c.devices = src.devices.map((d) => ({ ...sx(d), base: d.base && { ...d.base, x0: d.base.x0 + padL, x1: d.base.x1 + padL } }));
    c.windows = (src.windows || []).map(sx); c.storage = (src.storage || []).map(sx);
    c.lamps = (src.lamps || []).map(sx);
    c.cores = src.cores.map((k) => ({ ...k, x: k.x + padL, vault: k.vault && { ...k.vault, x0: k.vault.x0 + padL, x1: k.vault.x1 + padL } }));
    c.body = { ...src.body, left: src.body.left + padL, right: src.body.right + padL };
    const g = c.ground, roofRow = g - GARAGE.clear;
    const random = PW.createRandom(seed * 31 + 5);
    const ownLamps = c.lamps.length;   // (only the garage's own lamps are baked: the building's are done)
    for (const dirOut of annexSide === 0 ? [-1, 1] : [annexSide]) {
      const inner = dirOut < 0 ? c.body.left - 1 - gap : c.body.right + 1 + gap;
      const ax = (k) => inner + dirOut * k;   // garage column k = 0 against the building
      const span = (a, b) => [Math.min(ax(a), ax(b)), Math.max(ax(a), ax(b))];
      // the inside: a concrete floor's oil-stained apron, the frame's columns, strip lights
      const [i0, i1] = span(S.WALL, GW - 1 - S.WALL);
      K.rect(c, i0, roofRow, i1, g - 1, (x, y) => {
        const up = g - 1 - y, rib = Math.abs(x - ax(0)) % 28 < 2;
        K.back(c, x, y, up < 10 ? tone([74, 74, 70], 1) : tone([66, 68, 66], rib ? 1.25 : (up % 18 === 0 ? 1.12 : 1)));
      });
      for (let k = S.WALL + 20; k < GW - S.WALL - 10; k += 40) K.ceilingLamp(c, style, ax(k), roofRow + 1);
      // walls: the back one against the building (a door through it), the front with the roller door
      for (let d = 0; d < S.WALL; d += 1) for (let y = roofRow; y < g; y += 1) {
        const up = g - 1 - y;
        for (const k of [d, GW - 1 - d]) {
          const front = k > GW / 2;
          // (the openings: the roller door's and the doorway into the building - their reveals backed)
          if (front && up < GARAGE.door) { K.back(c, ax(k), y, [48, 50, 50]); continue; }
          if (!front && up < S.DOOR_H) { K.back(c, ax(k), y, [40, 42, 44]); continue; }
          K.solid(c, ax(k), y, M.STEEL, tone(y % 6 < 3 ? [104, 108, 100] : [88, 92, 86], d === 0 || d === S.WALL - 1 ? 0.9 : 1), ROLE.WALL);
        }
      }
      // the roller door rolled up in its drum over the opening; a hazard lintel and floor strip
      for (let k = GW - S.WALL - 2; k < GW; k += 1) for (let up = GARAGE.door; up < GARAGE.door + 3; up += 1) K.deco(c, ax(k), g - 1 - up, [72, 74, 72]);
      for (let k = GW - S.WALL; k < GW; k += 1) K.solidIfEmpty(c, ax(k), g - 1 - GARAGE.door, M.STEEL, ((k >> 1) & 1) ? MIL_AMBER : [40, 40, 44], ROLE.FRAME);
      for (let k = S.WALL; k < GW - S.WALL; k += 1) if (((k >> 2) & 1) && k > GW - 40) K.back(c, ax(k), g - 1, [196, 164, 58]);
      // the flat roof: slab, drip edge, a parapet lip at the ends
      for (let k = 0; k < GW; k += 1) for (let t = 0; t < GARAGE.roof; t += 1) {
        K.solid(c, ax(k), roofRow - 1 - t, M.CONCRETE, t === GARAGE.roof - 1 ? [150, 148, 140] : t === 0 ? [96, 96, 92] : [120, 118, 112], ROLE.ROOF);
      }
      for (const k of [GW - 2, GW - 1]) for (let dy = 1; dy <= 3; dy += 1) K.solid(c, ax(k), roofRow - GARAGE.roof - dy, M.CONCRETE, WING_PARAPET, ROLE.ORNAMENT);
      // inside: a workbench and tool wall, the hackable panel on the back wall
      for (let k = S.WALL + 6; k < S.WALL + 34; k += 1) {
        K.back(c, ax(k), g - 10, [96, 92, 84]);
        if ((k - S.WALL) % 9 === 0) for (let dy = 1; dy < 10; dy += 1) K.back(c, ax(k), g - dy, [60, 58, 54]);
        for (let dy = 18; dy < 30; dy += 1) if (((k + dy) & 3) === 0) K.back(c, ax(k), g - dy, [92, 96, 94]);
      }
      PW.buildingPanel(c, style, Math.min(ax(S.WALL + 40), ax(S.WALL + 57)), g);
      c.panels.push({ x: ax(S.WALL + 48), y: g, storey: 0 });
      c.floors.push({ storey: 0, y: g, left: i0, right: i1, wing: true });
      c.doors.push({ x: ax(GW - 1), side: dirOut, top: g - GARAGE.door, bottom: g - 1 });
      c.slots.push({ x: ax(GW - 30), y: g, storey: 0, facing: dirOut });
      c.lamps.push({ x: ax(GW - 3), y: g - GARAGE.door - 3, radius: 12, strength: 0.4, color: MIL_AMBER });
      // (N97: the garage meets the building as it stands - where its face is set back from the
      // body line, each row of the garage's height is carried in to it: the roof as roof, the rest
      // as back wall; only cells the building leaves empty)
      for (let y = roofRow - GARAGE.roof; y < g; y += 1) {
        const run = [];
        let x = inner - dirOut, hit = false;
        for (let s = 0; s < 40 && x > 1 && x < c.width - 2; s += 1, x -= dirOut) {
          const i = y * c.width + x;
          if (c.mat[i] || c.back[i]) { hit = true; break; }
          run.push(x);
        }
        if (!hit) continue;
        for (const rx of run) {
          if (y < roofRow) K.solid(c, rx, y, M.CONCRETE, [120, 118, 112], ROLE.ROOF);
          else K.back(c, rx, y, tone([66, 68, 66], (rx + y) % 9 ? 1 : 1.1));
        }
      }
      c.hangar = c.hangar || { left: i0, right: i1, top: roofRow, bottom: g - 1,
        door: { x: ax(GW - 1), top: g - GARAGE.door, bottom: g - 1 }, spawn: { x: ax(GW >> 1), y: g } };
      // the turret on the roof's outer end, facing out
      if (O()) {
        const [r0, r1] = span(6, GW - 7);
        O().devices(c, style, [{ left: r0, right: r1, y: roofRow - GARAGE.roof, top: true, open: true }], level >= 3 ? ['turret', 'interceptor'] : ['turret'], dirOut, random, dirOut);
      }
    }
    c.body.left -= annexSide <= 0 ? GW : pad - 1;
    c.body.right += annexSide >= 0 ? GW : pad - 1;
    K.bakeLights({ ...c, lamps: c.lamps.slice(ownLamps) }, style);
    // (and the building exactly as it was: wherever it had a cell, a back wall or a deco - an eave,
    // a step, a lamp's glow - the garage built against it gives it back)
    for (let y = 0; y < src.height; y += 1) for (let x = 0; x < src.width; x += 1) {
      const i = y * src.width + x;
      if (!src.mat[i] && !src.back[i] && !src.deco[i]) continue;
      const j = y * c.width + (x + padL);
      c.mat[j] = src.mat[i]; c.back[j] = src.back[i]; c.deco[j] = src.deco[i]; c.paint[j] = src.paint[i]; c.role[j] = src.role[i];
    }
    return c;
  }

  function military(options) {
    if (POSTS[options.variant]) return militaryPost(options);
    if (options.variant === 'watch' || (!PW.OLD_BASES && MILITARY_VARIANTS.includes(options.variant || 'compound'))) return militaryWatch(options);
    return options.variant === 'tower' ? militaryTower(options) : militaryBase(options);
  }

  PW.buildingTypes = PW.buildingTypes || {};
  PW.buildingTypes.military = military;
  PW.buildingTypes.core = coreBunker;
  PW.MILITARY_VARIANTS = MILITARY_VARIANTS;
  PW.HANGAR = HANGAR;
  PW.militarise = militarise;
  PW.militaryGarage = militaryGarage;
  PW.GARAGE = GARAGE;
})();
