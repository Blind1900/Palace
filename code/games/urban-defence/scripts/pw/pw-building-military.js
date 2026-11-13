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

  function militaryBase(options) {
    const style = options.style, level = options.level || 3, variant = options.variant || 'compound';
    const facing = options.facing || 1;   // +1: hangar door faces right (towards the enemy)
    const seed = options.seed || 1;
    const random = PW.createRandom(seed);
    const P = STYLES[style];
    const rearStoreys = { compound: 2, fortress: 3, command: 4, bastion: 1 }[variant] + (level >= 5 ? 1 : 0);
    const rearWidth = 140;
    const bodyWidth = rearWidth + HANGAR.width - HANGAR.wall;
    const margin = 44, coreDepth = 24;
    const top = Math.max(rearStoreys * S.FLOOR + 120, HANGAR.clear + HANGAR.vaultRise + 90);
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
          for (let y = floorRow(k + 1); y < fRow; y += 1) K.solid(c, wx, y, P.wallMat, K.wallColor(style, d, S.WALL, fRow - 1 - y, wx, y), ROLE.WALL);
        }
      }
      // Command cab: the top storey is glazed all round.
      const cab = variant === 'command' && k === rearStoreys - 1;
      for (const lx of [left, right]) {
        const side = lx === left ? -1 : 1;
        const winTop = cab ? fRow - 32 : fRow - 29, winBottom = fRow - 12;
        if (k === 0 && lx === right) continue;
        for (let d = 0; d < S.WALL; d += 1) for (let y = winTop; y <= winBottom; y += 1) {
          K.solid(c, X(lx - side * d), y, M.GLASS, cab ? mix(K.GLASS_SIDE, P.lamp, 0.55) : mix(K.GLASS_SIDE, P.lamp, 0.3), ROLE.GLASS);
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
    // Rear door on the far side (except the bastion's buried glacis side).
    if (variant !== 'bastion') {
      for (let d = 0; d < S.WALL; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) { K.clear(c, X(rearLeft + d), y); K.back(c, X(rearLeft + d), y, tone(P.frame, 0.3)); }
      c.doors.push({ x: X(rearLeft), side: -facing, top: ground - S.DOOR_H, bottom: ground - 1 });
    }

    // ---- Hangar ----
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
        K.solid(c, wx, y, M.STEEL, K.wallColor(style, d, HANGAR.wall, ground - 1 - y, wx, y), ROLE.WALL);
      }
      // Door frame.
      K.solid(c, wx, ground - HANGAR.door - 1, M.STEEL, P.ornament, ROLE.FRAME);
    }
    // Upper rear wall of the hangar where it rises above the rear block's ground storey.
    for (let d = 0; d < HANGAR.wall; d += 1) {
      const wx = X(hangarLeft + d);
      for (let y = wallTop; y < ground - S.FLOOR; y += 1) {
        if (!K.isSolid(c, wx, y)) K.solid(c, wx, y, P.wallMat, K.wallColor(style, d, HANGAR.wall, ground - 1 - y, wx, y), ROLE.WALL);
      }
    }
    // Inner door between rear block and hangar.
    for (let d = 0; d < S.WALL + 2; d += 1) for (let y = ground - S.DOOR_H; y < ground; y += 1) {
      K.clear(c, X(hangarLeft - 4 + d), y);
      K.back(c, X(hangarLeft - 4 + d), y, tone(P.frame, 0.3));
    }
    // Roof: vault for compound/command, flat armoured roof with battlements otherwise.
    const vault = variant === 'compound' || variant === 'command';
    const hx0 = hangarLeft, hx1 = hangarRight, hcx = (hx0 + hx1) / 2, half = (hx1 - hx0) / 2 + 1;
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
    // Primary core in its cradle at the back of the hangar.
    K.core(c, X(hangarLeft + 34), ground - 8);
    c.hangar = { left: Math.min(X(hx0), X(hx1)), right: Math.max(X(hx0), X(hx1)), top: wallTop, bottom: ground - 1,
      door: { x: X(hangarRight), top: ground - HANGAR.door, bottom: ground - 1 }, spawn: { x: X(hangarLeft + 80), y: ground } };
    // The hackable control panel is on the top floor of the rear block.
    const topFloor = rearFloors[rearStoreys - 1];
    const panelLocal = topFloor.left + S.WALL + 8;
    PW.buildingPanel(c, style, Math.min(X(panelLocal), X(panelLocal + 17)), floorRow(rearStoreys - 1));
    c.panels.push({ x: X(panelLocal + 9), y: floorRow(rearStoreys - 1), storey: rearStoreys - 1 });

    // ---- Variant extras ----
    const roofTop = floorRow(rearStoreys);
    const rearRoof = { left: Math.min(X(rearFloors[rearStoreys - 1].left), X(rearFloors[rearStoreys - 1].right)),
      right: Math.max(X(rearFloors[rearStoreys - 1].left), X(rearFloors[rearStoreys - 1].right)), y: roofTop, top: true };
    if (variant === 'fortress') {
      // Corner turret tower on the rear block.
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
      // Earth glacis banked against the rear wall, and a dome on the roof.
      for (let lx = -60; lx < 0; lx += 1) {
        const h = Math.round((lx + 60) / 60 * (S.FLOOR - 6));
        for (let dy = 0; dy < h; dy += 1) {
          const id = dy === h - 1 ? M.GRASS : M.SOIL;
          K.solid(c, X(lx), ground - 1 - dy, id, id === M.GRASS ? [88, 124, 54] : tone([104, 80, 52], 0.95 + (PW.hash2(lx, dy) & 1) * 0.08), ROLE.ORNAMENT);
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
        ornament.crown(c, style, crown, Math.round((rearRoof.left + rearRoof.right) / 2) + (variant === 'fortress' ? 14 * facing : 0), roofTop - 1, 60, random, facing);
      }
      const hangarRoof = { left: Math.min(X(hx0 + 16), X(hx1 - 16)), right: Math.max(X(hx0 + 16), X(hx1 - 16)),
        y: vault ? wallTop - HANGAR.vaultRise + 1 : wallTop - 7, top: false };
      const plan = level >= 4 ? ['launcher', 'interceptor', 'turret'] : level >= 3 ? ['launcher', 'turret'] : ['turret'];
      // Neutral compounds (deviceFacing 0) cover both directions until captured.
      const deviceFacing = options.deviceFacing ?? facing;
      ornament.devices(c, style, [rearRoof], plan.slice(0, 2), deviceFacing, random, -facing);
      // Neutral: the rear-roof device faces +1 first, so the hangar turret covers the other way.
      // Neutral compounds: the rear-roof devices alternate from +1, and the hangar turret guards the
      // compound's own front, so a cluster of mixed-facing compounds covers both ways.
      if (!vault) ornament.devices(c, style, [hangarRoof], ['turret'], deviceFacing || facing, random);
      else {
        // Turret just forward of the vault's crest: logical span [tx - 15, tx + 14], mirrored by X.
        const tx = Math.round(hcx) + 10;
        ornament.DEVICE_DRAW.turret(c, P, Math.min(X(tx - 15), X(tx + 14)), wallTop - HANGAR.vaultRise, deviceFacing || facing);
      }
    }
    // Buried extra cores.
    const extraCores = level >= 4 ? 3 : 2;
    for (let i = 0; i < extraCores; i += 1) K.core(c, X(30 + i * Math.round((bodyWidth - 80) / Math.max(1, extraCores - 1))), ground + 12);
    K.bakeLights(c, style);
    c.body = { left: margin, right: margin + bodyWidth - 1, top: Math.min(floorRow(rearStoreys), wallTop - HANGAR.vaultRise), bottom: ground - 1 };
    c.runway = { from: X(hangarRight) + facing, direction: facing, length: 380, y: ground };
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
    // Pedestal and the core orb.
    const floor = ground + pitDepth;
    for (let dy = 1; dy <= 14; dy += 1) for (let dx = -16 + dy / 2; dx <= 16 - dy / 2; dx += 1) {
      K.solid(c, cx + Math.round(dx), floor - dy, M.FOUNDATION, tone(K.CORE_SHADE, dy < 3 ? 0.8 : 1), ROLE.CRADLE);
    }
    const orbY = floor - 34, r = 17;
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const light = 1.3 - (dx + dy + 2 * r) / (4 * r) * 0.6 - (d / r) * 0.15;
      K.solid(c, cx + dx, orbY + dy, M.CORE, tone(K.CORE_COLOR, light), ROLE.CORE);
    }
    c.cores.push({ x: cx, y: orbY, orb: true, radius: r });
    c.lamps.push({ x: cx, y: orbY, radius: 70, strength: 0.6 });
    // Floating armoured block: no support needed (it is anchored by the core's field).
    const by = ground - gap;
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
      for (let dy = 0; dy < 6; dy += 1) if ((Math.round(dx) + dy) % 3 === 0) K.back(c, cx + Math.round(dx), by + dy, mix(K.CORE_COLOR, [20, 20, 24], 0.5 + dy * 0.08));
    }
    c.floating = { left: cx - blockWidth / 2, right: cx + blockWidth / 2, top: by - blockHeight, bottom: by - 1 };
    c.body = { left: cx - pitWidth / 2, right: cx + pitWidth / 2, top: by - blockHeight, bottom: floor };
    K.bakeLights(c, style);
    return c;
  }

  PW.buildingTypes = PW.buildingTypes || {};
  PW.buildingTypes.military = militaryBase;
  PW.buildingTypes.core = coreBunker;
  PW.MILITARY_VARIANTS = MILITARY_VARIANTS;
  PW.HANGAR = HANGAR;
})();
