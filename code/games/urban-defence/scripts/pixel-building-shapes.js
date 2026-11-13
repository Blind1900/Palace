// Building silhouettes for every type. Each variant replaces the prepared adaptive frame with walkable
// storeys (PIXEL_INTERIOR.floorPitch rows apart, one-way switchback stairs) while keeping main's poles, seeds, cores, foundation
// and silo storage untouched, and returns a shape descriptor that the style pass and devices consume.
const PIXEL_BUILDING_VARIANTS = Object.freeze({
  population: ['slab', 'setback', 'offset', 'tapered', 'crown', 'spire', 'needle'],
  military: ['compound', 'fortress', 'command', 'bastion'],
  farm: ['silos', 'barn', 'elevator', 'homestead'],
});

const PIXEL_BUILDING_VARIANT_LABELS = Object.freeze({
  slab: 'Slab', setback: 'Setback', offset: 'Offset wing', tapered: 'Tapered', crown: 'Stepped crown',
  spire: 'Spire', needle: 'Needle', compound: 'Hangar compound', fortress: 'Fortress', command: 'Command tower',
  bastion: 'Bastion', silos: 'Silos & shed', barn: 'Barn', elevator: 'Grain elevator', homestead: 'Homestead',
});

function createPixelShapeBuilder(world, prepared) {
  const W = world.width, key = (x, y) => y * W + x;
  const P = PIXEL_INTERIOR.floorPitch, base = prepared.surfaceY - 1;
  const frame = new Map(), oneWay = new Set(), passThrough = new Set(), clear = new Set(), coreHousing = new Set(), blocked = new Set();
  for (const cell of [...prepared.foundationCells, ...prepared.basementCells]) blocked.add(key(cell.x, cell.y));
  prepared.geometry.poles.forEach((pole, index) => {
    for (let dx = 0; dx < 3; dx += 1) for (let dy = 0; dy < 3; dy += 1) blocked.add(key(pole + dx, prepared.foundationRows[index] + dy));
  });
  for (const silo of (prepared.metadata.silos || [])) for (const cell of silo.storageCells || []) clear.add(key(cell.x, cell.y));
  const grounds = new Map();
  const groundAt = (x) => {
    if (!grounds.has(x)) {
      let y = 0;
      while (y < world.height && world.at(x, y) !== PARTICLE_TERRAIN) y += 1;
      grounds.set(x, y);
    }
    return grounds.get(x);
  };
  const shape = { floorPitch: P, base, floors: [], stairs: [], roofs: [], apexes: [], corners: [], doors: [],
    rooms: [], hangar: null, mounts: [], panels: [], battlements: [], keepClear: clear, oneWay, passThrough, coreHousing };
  const fits = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 3 && x + 3 < W && y >= 1 && y < world.height;
  function put(x, y, options = {}) {
    if (!fits(x, y)) throw new Error(`Shape pixel (${x}, ${y}) is outside the buildable world`);
    const index = key(x, y);
    if (blocked.has(index)) throw new Error(`Shape pixel (${x}, ${y}) overlaps the foundation or cores`);
    if (world.at(x, y) !== PARTICLE_EMPTY) throw new Error(`Shape pixel (${x}, ${y}) is not empty`);
    frame.set(index, { x, y });
    clear.delete(index);
    if (options.oneWay) oneWay.add(index);
    if (options.pass) passThrough.add(index);
    if (options.core) coreHousing.add(index);
  }
  const has = (x, y) => frame.has(key(x, y));
  const hline = (a, b, y, options) => { for (let x = Math.min(a, b); x <= Math.max(a, b); x += 1) put(x, y, options); };
  const vline = (x, a, b, options) => { for (let y = Math.min(a, b); y <= Math.max(a, b); y += 1) put(x, y, options); };
  const rect = (l, r, t, b) => { for (let y = t; y <= b; y += 1) hline(l, r, y); };
  const markClear = (l, r, t, b) => {
    for (let y = t; y <= b; y += 1) for (let x = l; x <= r; x += 1) if (!has(x, y)) clear.add(key(x, y));
  };
  // Ground slab at the seed row ties every pole, wall and room together.
  const slab = (l, r) => { for (let x = l; x <= r; x += 1) if (!has(x, base)) put(x, base); };
  // Wall column from `top` down to the ground at this column (walls follow uneven ground).
  const wallDown = (x, top, skip = () => false) => {
    for (let y = top; y < groundAt(x); y += 1) if (!skip(y) && !has(x, y)) put(x, y);
  };

  // Multi-storey block. `storeys` lists the outer extents of each storey from the ground up. Stairs
  // are two flights that meet at column `stairX`: even storeys climb rightwards from it, odd storeys
  // climb leftwards from it, so a climber always turns back over a one-way stairwell floor.
  function storeyBlock(storeys, options = {}) {
    const N = storeys.length, stairX = options.stairX, floorBase = options.base === undefined ? base : options.base;
    const doors = options.doors || { left: true, right: true };
    const pillars = options.pillars || [];
    // The stair band leaves one spare column beyond each flight top so a trooper's arm clears the wall.
    const stairLo = stairX === undefined ? null : stairX - P - 1, stairHi = stairX === undefined ? null : stairX + P + 1;
    const floors = [];
    for (let k = 0; k < N; k += 1) {
      const y = floorBase - k * P, top = y - P, { left, right } = storeys[k];
      const below = k ? storeys[k - 1] : storeys[k];
      for (let x = Math.min(left, below.left); x <= Math.max(right, below.right); x += 1) if (!has(x, y)) put(x, y);
      if (right - left + 1 <= 6) { rect(left, right, top + 1, y - 1); floors.push({ storey: k, y, left: left + 3, right: right - 3, outerLeft: left, outerRight: right, accessible: false, solid: true }); continue; }
      // Walls are 3 px in the lower half of tall blocks and 2 px above (still thicker than 1 px floors),
      // which keeps the load at the base of the tallest towers under the support capacity.
      const thickness = N >= 6 && k >= Math.ceil(N / 2) ? 2 : PIXEL_INTERIOR.wall;
      for (let row = top + 1; row < y; row += 1) {
        const door = k === 0 && row >= y - PIXEL_INTERIOR.doorHeight;
        for (let dx = 0; dx < thickness; dx += 1) {
          // The doorway's outer column is a load-bearing door pane that units walk through.
          if (door && dx === 0) {
            if (doors.left && !has(left, row)) put(left, row, { pass: true });
            if (doors.right && !has(right, row)) put(right, row, { pass: true });
          }
          if (!(door && doors.left) && !has(left + dx, row)) put(left + dx, row);
          if (!(door && doors.right) && !has(right - dx, row)) put(right - dx, row);
        }
      }
      if (k === 0) {
        for (const [side, open] of [[-1, doors.left], [1, doors.right]]) {
          if (!open) continue;
          const wall = side < 0 ? left : right - 2;
          shape.doors.push({ x: side < 0 ? left : right, side, top: y - PIXEL_INTERIOR.doorHeight, bottom: y - 1, width: 3 });
          if (options.approach !== false) {
            for (let dx = 1; dx <= 8; dx += 1) for (let row = y - PIXEL_INTERIOR.doorHeight; row < y; row += 1) {
              const x = side < 0 ? wall - dx : wall + 2 + dx;
              if (!has(x, row)) clear.add(key(x, row));
            }
          }
        }
      }
      markClear(left + 3, right - 3, top + 1, y - 1);
      for (const pole of pillars) {
        if (pole < left + 3 || pole + 2 > right - 3) continue;
        if (stairX !== undefined && pole + 2 >= stairLo - 7 && pole <= stairHi + 7) continue;
        for (let row = top + 1; row < y - PIXEL_INTERIOR.doorHeight; row += 1) for (let dx = 0; dx < 3; dx += 1) put(pole + dx, row);
      }
      floors.push({ storey: k, y, left: left + 3, right: right - 3, outerLeft: left, outerRight: right, accessible: false });
    }
    const roofY = floorBase - N * P, last = storeys[N - 1];
    for (let x = last.left; x <= last.right; x += 1) if (!has(x, roofY)) put(x, roofY);
    // Accessibility: storey 0 needs room for a trooper; higher storeys need both flights to fit.
    const bandFits = (floor) => stairX !== undefined && !floor.solid && floor.left <= stairLo && floor.right >= stairHi;
    floors.forEach((floor, k) => {
      floor.accessible = !floor.solid && floor.right - floor.left + 1 >= PIXEL_INTERIOR.unitWidth &&
        (k === 0 || (floors[k - 1].accessible && bandFits(floors[k - 1]) && bandFits(floor)));
    });
    for (let k = 0; k + 1 < N; k += 1) {
      if (!floors[k + 1].accessible) continue;
      const y = floors[k].y, direction = k % 2 === 0 ? 1 : -1;
      for (let i = 1; i < P; i += 1) {
        const x = stairX + direction * i;
        for (const row of [y - i, y - i + 1]) {
          if (!has(x, row)) put(x, row, { oneWay: true }); else oneWay.add(key(x, row));
        }
      }
      shape.stairs.push({ storey: k, floorY: y, from: stairX, direction, run: P });
    }
    // Every floor above a stairwell is one-way across the whole stair region (plus a body width).
    floors.forEach((floor, k) => {
      if (k === 0 || !floor.accessible) return;
      for (let x = Math.max(floor.left, stairLo - 7); x <= Math.min(floor.right, stairHi + 7); x += 1) oneWay.add(key(x, floor.y));
    });
    // Exposed roof segments: the part of each storey's ceiling not covered by the storey above.
    for (let k = 0; k < N; k += 1) {
      const y = floorBase - (k + 1) * P, own = storeys[k], above = storeys[k + 1];
      const segments = !above ? [[own.left, own.right]] : [[own.left, above.left - 1], [above.right + 1, own.right]];
      for (const [l, r] of segments) {
        if (r < l) continue;
        shape.roofs.push({ left: l, right: r, y, storey: k, top: !above });
        if (above) shape.corners.push({ x: l === own.left ? l : r, y, side: l === own.left ? -1 : 1 });
      }
    }
    floors.forEach((floor) => shape.floors.push(floor));
    shape.rooms.push({ left: Math.min(...storeys.map((s) => s.left)), right: Math.max(...storeys.map((s) => s.right)),
      top: roofY, bottom: floorBase, storeys: N, stairX });
    return { floors, roofY, top: roofY };
  }

  // Two-pixel thick 4-connected pitched roof over [l, r] standing on row y; `slope(r)` gives the inset.
  function pitchedRoof(l, r, y, rise, slope) {
    let previous = 0;
    hline(l, r, y - 1);
    for (let row = 2; row <= rise; row += 1) {
      const inset = slope(row), step = Math.max(1, inset - previous + 1);
      if (l + inset > r - inset) break;
      for (let t = 0; t < step; t += 1) {
        for (const x of [l + inset - t, r - inset + t]) if (x >= l && x <= r && !has(x, y - row)) put(x, y - row);
      }
      if (row === rise || l + slope(row + 1) > r - slope(row + 1)) hline(l + inset, r - inset, y - row);
      previous = inset;
    }
  }

  function finish(variant) {
    const cells = [...frame.values()];
    const seedKeys = prepared.geometry.seeds.map((cell) => key(cell.x, cell.y));
    for (const index of seedKeys) {
      if (!frame.has(index)) throw new Error(`${variant}: shape does not cover seed ${index % W},${Math.floor(index / W)}`);
    }
    const reached = new Set(seedKeys), queue = [...seedKeys];
    while (queue.length) {
      const index = queue.pop(), x = index % W, y = Math.floor(index / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = key(x + dx, y + dy);
        if (frame.has(next) && !reached.has(next)) { reached.add(next); queue.push(next); }
      }
    }
    const loose = cells.find((cell) => !reached.has(key(cell.x, cell.y)));
    if (loose) throw new Error(`${variant}: shape pixel (${loose.x}, ${loose.y}) is disconnected from the seeds`);
    for (const index of frame.keys()) clear.delete(index);
    return cells;
  }
  return { W, P, base, key, shape, frame, put, has, hline, vline, rect, slab, wallDown, groundAt, markClear,
    storeyBlock, pitchedRoof, finish, fits };
}

// Outer width of a storey that fits both stair flights and `soldiers` troopers beside the foot of a flight.
function pixelRoomWidth(soldiers) {
  return 2 * PIXEL_INTERIOR.wall + Math.max(2 * PIXEL_INTERIOR.floorPitch + 3,
    soldiers * PIXEL_INTERIOR.soldierSlot + PIXEL_INTERIOR.unitWidth);
}

// Soldiers a floor of this interior width can hold (the full quota once it is as wide as a standard room).
function pixelFloorCapacity(interior, soldiers) {
  if (interior >= pixelRoomWidth(soldiers) - 2 * PIXEL_INTERIOR.wall) return soldiers;
  return Math.max(1, Math.min(soldiers, Math.floor((interior - PIXEL_INTERIOR.unitWidth) / PIXEL_INTERIOR.soldierSlot)));
}

function pixelPopulationInsets(variant, t, maxIn) {
  const step = (thresholds) => thresholds.reduce((value, [at, amount]) => t >= at ? amount : value, 0);
  if (variant === 'setback') return Math.round(maxIn * step([[0.45, 0.3], [0.68, 0.6], [0.86, 0.85]]));
  if (variant === 'tapered') return Math.round(maxIn * 0.75 * t);
  if (variant === 'crown') return Math.round(maxIn * step([[0.8, 0.25], [0.87, 0.5], [0.93, 0.8]]));
  if (variant === 'spire') return t < 0.68 ? 0 : t < 0.8 ? Math.round(maxIn * 0.3) : Math.round(maxIn * (0.3 + 0.7 * (t - 0.8) / 0.2));
  if (variant === 'needle') return t <= 0.1 ? 0 : Math.round(maxIn * Math.pow((t - 0.1) / 0.9, 1.6));
  return 0;
}

function shapePixelPopulation(builder, prepared, variant) {
  const { P, base, shape } = builder;
  const poles = prepared.geometry.poles, level = prepared.metadata.level;
  const soldiers = pixelSoldiersPerFloor(level), band = 2 * P + 1;
  const extra = ['setback', 'tapered', 'needle', 'spire'].includes(variant) ? 8 : 0;
  let width = pixelRoomWidth(soldiers) + extra;
  const coreLeft = poles[0], coreRight = poles[poles.length - 1] + 2;
  width = Math.max(width, coreRight - coreLeft + 1);
  const tallWidth = pixelRoomWidth(soldiers) + 2;
  if (variant === 'offset') width = Math.max(width, tallWidth + 14);
  if ((width & 1) === 0) width += 1;
  const center = Math.round((coreLeft + coreRight) / 2);
  let left = center - (width - 1) / 2;
  left = Math.min(left, coreLeft); const right = Math.max(left + width - 1, coreRight);
  const height = prepared.metadata.height || 100;
  const N = Math.max(2, Math.floor((height - 1) / P));
  const maxIn = Math.floor((right - left + 1 - 7) / 2);
  const storeys = Array.from({ length: N }, (_, k) => {
    const t = (k + 0.5) / N;
    if (variant === 'offset') return t >= 0.45 ? { left, right: left + tallWidth - 1 } : { left, right };
    const inset = pixelPopulationInsets(variant, t, maxIn);
    return { left: left + inset, right: right - inset };
  });
  const stairX = variant === 'offset' ? left + 3 + P + 2 : Math.round((left + right) / 2);
  // One ground door on the home side keeps the far wall continuous to the ground, so the tower's weight
  // reaches the soil through a 3-pixel wall instead of through the stair flights.
  // In a district (`throughDoors`) both sides open so the street continues through the ground floor.
  const home = (prepared.metadata.owner || 'left') === 'right' ? 1 : -1, through = Boolean(prepared.metadata.throughDoors);
  const block = builder.storeyBlock(storeys, { stairX, pillars: poles, doors: { left: home < 0 || through, right: home > 0 || through } });
  const top = storeys[N - 1], apexX = Math.round((top.left + top.right) / 2);
  shape.apexes.push({ x: apexX, y: block.roofY, size: 'major', width: top.right - top.left + 1 });
  if (variant === 'offset') shape.apexes.push({ x: right - 3, y: base - Math.floor(N * 0.45 + 0.5) * P, size: 'minor' });
  shape.bodyTop = block.roofY;
  shape.soldiersPerFloor = soldiers;
}

// Military: every variant houses the primary (middle) core inside a hangar that is the unit spawner.
// The hangar's tall door faces the front (towards the enemy) and a rear block holds the troops.
// Hangar fleet envelopes at map scale (cellReduction 4), measured at the listed unit scale and rescaled when
// PIXEL_UNIT_RELATIVE_SCALES changes. Tanks and jets drive out through the door, so their collision masks
// must fit; the mech is sized by its visible body plus headroom (its 39 x 59 mask is a jump envelope).
const PIXEL_HANGAR_FLEET = Object.freeze({
  tank: { w: 30, h: 15, scale: 3 },
  jet: { w: 35, h: 30, scale: 4 },
  hopper: { w: 21, h: 21, scale: 2, headroom: 6 },
});
function pixelHangarClearance() {
  const scales = typeof PIXEL_UNIT_RELATIVE_SCALES !== 'undefined' ? PIXEL_UNIT_RELATIVE_SCALES : {};
  let width = 0, clear = 0, door = 0;
  for (const [kind, unit] of Object.entries(PIXEL_HANGAR_FLEET)) {
    const k = (scales[kind] || unit.scale) / unit.scale;
    const w = Math.ceil(unit.w * k), h = Math.ceil(unit.h * k);
    width = Math.max(width, w); door = Math.max(door, h + 1); clear = Math.max(clear, h + (unit.headroom || 2));
  }
  return { width, clear, door };
}

function shapePixelMilitary(builder, prepared, variant) {
  const { P, base, shape, put, has, hline, rect, slab, storeyBlock, markClear } = builder;
  const poles = prepared.geometry.poles, level = prepared.metadata.level;
  const owner = prepared.metadata.owner || 'left';
  const front = owner === 'right' ? -1 : 1;
  const primary = poles[Math.floor((poles.length - 1) / 2)], cx = primary + 1;
  const X = (dx) => cx + front * dx;
  const span = (a, b) => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];
  // Sized from the fleet (pixelHangarClearance): the vehicle bay between the core cradle and the door
  // (X(5)..X(half-1)) fits the widest vehicle, the hall clears the tallest and the door passes every mask.
  // A runway road runs RUNWAY pixels out from the door so jets can roll out and take off.
  const fleet = pixelHangarClearance();
  const half = Math.max(17, fleet.width + 8), wallTop = base - Math.max(22, fleet.clear + 1);
  const doorTop = base - Math.max(18, fleet.door), RUNWAY = Math.max(56, fleet.width * 3);
  const soldiers = pixelSoldiersPerFloor(level), blockWidth = pixelRoomWidth(soldiers);
  // Rear block shares the hangar's rear wall.
  const rearOuter = -half - blockWidth + 3;
  const storeysByVariant = { compound: 2, fortress: 3, command: 4, bastion: 1 };
  const rearStoreys = storeysByVariant[variant];
  const [rearL, rearR] = span(rearOuter, -half + 2);
  const rearExtents = Array.from({ length: rearStoreys }, () => ({ left: rearL, right: rearR }));
  if (variant === 'command') {
    // Command tower: narrower upper storeys over the rear block, then a glazed control cab.
    const towerWidth = pixelRoomWidth(0);
    const mid = Math.round((rearL + rearR) / 2);
    for (let k = 2; k < rearStoreys; k += 1) rearExtents[k] = { left: mid - (towerWidth - 1) / 2, right: mid + (towerWidth - 1) / 2 };
  }
  const stairX = Math.round((rearL + rearR) / 2);
  // The bastion's glacis buries its outer rear wall, so its only door leads into the hangar.
  const rearDoors = variant !== 'bastion' ? { left: true, right: true } : front > 0 ? { left: false, right: true } : { left: true, right: false };
  const block = storeyBlock(rearExtents, { stairX, doors: rearDoors, pillars: poles });
  // Hangar walls, door openings and roof.
  const [hl, hr] = span(-half, half);
  const frontWall = front > 0 ? [hr - 2, hr] : [hl, hl + 2];
  for (const x of [frontWall[0], frontWall[0] + 1, frontWall[0] + 2]) {
    for (let y = wallTop; y < base; y += 1) {
      if (y < doorTop && !has(x, y)) put(x, y);
      else if (y >= doorTop && x === (front > 0 ? hr : hl) && !has(x, y)) put(x, y, { pass: true });
    }
  }
  shape.doors.push({ x: front > 0 ? hr : hl, side: front, top: doorTop, bottom: base - 1, width: 3, hangar: true });
  // Door approach and runway corridor stay clear of ornaments and neighbouring buildings.
  for (let dx = 1; dx <= RUNWAY; dx += 1) for (let y = doorTop; y < base; y += 1) {
    const x = front > 0 ? hr + dx : hl - dx;
    if (builder.fits(x, y) && !has(x, y)) shape.keepClear.add(builder.key(x, y));
  }
  const runwayEnd = front > 0 ? hr + RUNWAY : hl - RUNWAY;
  shape.runway = { from: Math.min(front > 0 ? hr + 1 : hl - 1, runwayEnd), to: Math.max(front > 0 ? hr + 1 : hl - 1, runwayEnd),
    y: base + 1, direction: front, length: RUNWAY, clearTop: doorTop };
  // The rear wall of the hangar is the rear block's wall; raise it to the hangar's eaves.
  const rearWall = front > 0 ? [hl, hl + 2] : [hr - 2, hr];
  for (let x = rearWall[0]; x <= rearWall[1]; x += 1) {
    for (let y = wallTop; y < base - PIXEL_INTERIOR.doorHeight; y += 1) if (!has(x, y)) put(x, y);
  }
  let hangarTop = wallTop;
  if (variant === 'fortress' || variant === 'bastion') {
    rect(hl, hr, wallTop - 1, wallTop);
    hangarTop = wallTop - 1;
    shape.roofs.push({ left: hl, right: hr, y: wallTop - 1, storey: 0, top: true, hangar: true });
  } else {
    // Elliptical vault, three pixels thick so it reads as a heavy shell.
    const rise = Math.max(8, Math.round(half * 0.3)), radius = half + 0.5;
    let previous = null;
    for (let x = hl; x <= hr; x += 1) {
      const dx = x - (hl + hr) / 2, h = Math.round(rise * Math.sqrt(Math.max(0, 1 - (dx / radius) ** 2)));
      const top = wallTop - h;
      const from = previous === null ? top : Math.min(top, previous);
      for (let y = from; y <= top + 2; y += 1) if (y <= wallTop && !has(x, y)) put(x, y);
      previous = top;
    }
    hangarTop = wallTop - rise;
    shape.roofs.push({ left: hl + 4, right: hr - 4, y: hangarTop, storey: 0, top: true, hangar: true, curved: true });
  }
  builder.markClear(hl + 3, hr - 3, Math.max(hangarTop + 3, wallTop + 1), base - 1);
  // Core cradle: two posts flanking the primary seeds; two rows so troopers can step over them to the rear block.
  for (const x of [primary - 1, primary + 3]) for (let y = base - PIXEL_INTERIOR.stepRise; y < base; y += 1) if (!has(x, y)) put(x, y, { core: true });
  const spawnDx = 9;
  shape.hangar = { left: hl + 3, right: hr - 3, top: hangarTop, floorY: base, door: front, coreX: cx,
    spawn: { x: X(spawnDx), floorY: base }, primaryPole: primary, clearTop: wallTop + 1, doorTop,
    // Vehicles park between the core cradle and the door.
    bay: { left: Math.min(X(5), X(half - 1)), right: Math.max(X(5), X(half - 1)) } };
  shape.panels.push({ x: X(-8), floorY: base, facing: front, room: 'hangar' });
  // Slab under everything: hangar, rear block, any poles beyond and a short front apron.
  const allLeft = Math.min(rearL, hl, poles[0]), allRight = Math.max(rearR, hr, poles[poles.length - 1] + 2);
  slab(allLeft, allRight);
  const [apronL, apronR] = span(half + 1, half + 6);
  for (let x = apronL; x <= apronR; x += 1) if (builder.fits(x, base) && !has(x, base)) put(x, base);
  // Variant extras.
  const rearRoof = block.roofY;
  if (variant === 'fortress') {
    // Corner turret tower on the outer rear corner, two storeys above the keep.
    const [tl, tr] = front > 0 ? [rearL, rearL + 8] : [rearR - 8, rearR];
    for (let y = rearRoof - 9; y < rearRoof; y += 1) for (const x of [tl, tl + 1, tr - 1, tr]) if (!has(x, y)) put(x, y);
    hline(tl, tr, rearRoof - 9);
    shape.apexes.push({ x: Math.round((tl + tr) / 2), y: rearRoof - 9, size: 'minor' });
    shape.battlements.push({ left: tl, right: tr, y: rearRoof - 9 }, { left: rearL, right: rearR, y: rearRoof },
      { left: hl, right: hr, y: hangarTop });
  } else if (variant === 'command') {
    // Glazed control cab: posts at the corners and a roof slab; the panels live inside.
    const top = block.floors[block.floors.length - 1];
    const cabL = top.outerLeft, cabR = top.outerRight, cabFloor = rearRoof, cabTop = rearRoof - (P - 1);
    for (let y = cabTop; y < cabFloor; y += 1) for (const x of [cabL, cabL + 1, cabR - 1, cabR]) if (!has(x, y)) put(x, y);
    hline(cabL - 1, cabR + 1, cabTop);
    markClear(cabL + 2, cabR - 2, cabTop + 1, cabFloor - 1);
    shape.panels.push({ x: cabL + 3, floorY: cabFloor, facing: front, room: 'cab' },
      { x: cabR - 9, floorY: cabFloor, facing: -front, room: 'cab' });
    shape.apexes.push({ x: Math.round((cabL + cabR) / 2), y: cabTop, size: 'major' });
    shape.roofs.push({ left: cabL - 1, right: cabR + 1, y: cabTop, storey: rearStoreys, top: true, cab: true });
  } else if (variant === 'bastion') {
    // Sloped glacis on the rear of the bunker and an armoured dome on the hangar roof.
    const slopeRows = 9, [bl, br] = [rearL, rearR];
    for (let i = 1; i <= slopeRows + 3; i += 1) {
      const x = front > 0 ? bl - i : br + i;
      const height = Math.max(0, slopeRows + 2 - i);
      for (let y = base - height; y <= base; y += 1) if (builder.fits(x, y) && !has(x, y) && y < builder.groundAt(x)) put(x, y);
    }
    const domeX = Math.round((hl + hr) / 2), domeY = hangarTop - 1;
    for (let dy = 0; dy < 4; dy += 1) {
      const halfWidth = [5, 5, 4, 2][dy];
      hline(domeX - halfWidth, domeX + halfWidth, domeY - dy);
    }
    shape.apexes.push({ x: domeX, y: domeY - 3, size: 'minor', dome: true });
    shape.battlements.push({ left: rearL, right: rearR, y: rearRoof });
  } else {
    shape.apexes.push({ x: Math.round((hl + hr) / 2), y: hangarTop, size: 'minor' });
  }
  if (variant !== 'command') shape.apexes.push({ x: stairX, y: rearRoof, size: variant === 'fortress' ? 'major' : 'minor' });
  // Device mounts: roof segments wide enough for launchers and turrets.
  shape.bodyTop = Math.min(...[...builder.frame.values()].map((cell) => cell.y));
  shape.soldiersPerFloor = soldiers;
}

function shapePixelFarm(builder, prepared, variant) {
  const { P, base, shape, put, has, hline, rect, vline, slab, storeyBlock, pitchedRoof, markClear } = builder;
  // Keep main's silo frame (domes, walls and storage) and grow buildings beside it.
  for (const cell of prepared.geometry.frameCells) if (!has(cell.x, cell.y)) put(cell.x, cell.y);
  const silos = prepared.metadata.silos;
  const farmLeft = Math.min(...silos.map((silo) => silo.left)), farmRight = Math.max(...silos.map((silo) => silo.right));
  const level = prepared.metadata.level, soldiers = pixelSoldiersPerFloor(level);
  const width = pixelRoomWidth(soldiers);
  const leftBlock = (storeys, gap = 3) => {
    const r = farmLeft - gap, l = r - width + 1;
    slab(l, farmLeft);
    return { l, r, block: storeyBlock(Array.from({ length: storeys }, () => ({ left: l, right: r })),
      { stairX: Math.round((l + r) / 2), doors: { left: true, right: false } }) };
  };
  for (const silo of silos) shape.apexes.push({ x: Math.round((silo.left + silo.right) / 2), y: silo.roof, size: 'minor', silo: true });
  if (variant === 'silos') {
    // Feed shed with a lean-to roof.
    const { l, r, block } = leftBlock(1);
    for (let i = 1; i <= 4; i += 1) hline(l + (i - 1) * 4, r, block.roofY - i);
    shape.roofs.push({ left: l, right: r, y: block.roofY - 4, storey: 0, top: true });
  } else if (variant === 'barn') {
    // Two-storey barn with a gambrel roof, hay-loft beam and cupola.
    const { l, r, block } = leftBlock(2);
    pitchedRoof(l - 1, r + 1, block.roofY, 11, (row) => row <= 4 ? Math.floor(row / 2) : 2 + (row - 4) * 2);
    const ridge = Math.round((l + r) / 2);
    shape.apexes.push({ x: ridge, y: block.roofY - 11, size: 'major', barn: true });
    shape.roofs.push({ left: l + 6, right: r - 6, y: block.roofY - 8, storey: 1, top: true, pitched: true });
    // Hay hoist beam projecting from the gambrel's lower slope.
    for (let x = l - 4; x <= l + 5; x += 1) if (!has(x, block.roofY - 6)) put(x, block.roofY - 6);
  } else if (variant === 'elevator') {
    // Grain-elevator headhouse (three storeys) to the right plus a conveyor gallery over the silos.
    const l = farmRight + 3, r = l + width - 1;
    slab(farmRight, r);
    const block = storeyBlock(Array.from({ length: 3 }, () => ({ left: l, right: r })),
      { stairX: Math.round((l + r) / 2), doors: { left: false, right: true } });
    const galleryY = Math.min(...silos.map((silo) => silo.roof)) - 3;
    for (let x = farmLeft; x < l; x += 1) { if (!has(x, galleryY)) put(x, galleryY); if (!has(x, galleryY - 3)) put(x, galleryY - 3); }
    for (let x = farmLeft; x < l; x += 3) for (let y = galleryY - 2; y < galleryY; y += 1) if (!has(x, y)) put(x, y);
    for (const silo of silos) {
      const x = Math.round((silo.left + silo.right) / 2);
      vline(x, galleryY + 1, silo.roof - 1);
    }
    for (let y = galleryY - 3; y < base - 3 * P; y += 1) if (!has(l, y)) put(l, y);
    pitchedRoof(l, r, block.roofY, 4, (row) => row * 3);
    shape.apexes.push({ x: Math.round((l + r) / 2), y: block.roofY - 4, size: 'major' });
    shape.roofs.push({ left: farmLeft, right: l - 1, y: galleryY - 3, storey: 0, top: true, gallery: true });
  } else {
    // Homestead: two-storey farmhouse with a gable roof and chimney, plus a windmill to the right.
    const { l, r, block } = leftBlock(2);
    pitchedRoof(l - 2, r + 2, block.roofY, 9, (row) => row * 2 - 1);
    const chimney = r - 6;
    for (let y = block.roofY - 9; y < block.roofY; y += 1) for (const x of [chimney, chimney + 1]) if (!has(x, y)) put(x, y);
    shape.apexes.push({ x: Math.round((l + r) / 2), y: block.roofY - 9, size: 'major', house: true });
    const millX = farmRight + 9, millTop = base - 30;
    slab(farmRight, millX + 4);
    const millHalf = (y) => Math.max(1, Math.round(4 - 3 * (base - y) / (base - millTop)));
    for (let y = millTop; y < base; y += 1) {
      const halfWidth = millHalf(y), below = y + 1 < base ? millHalf(y + 1) : halfWidth;
      for (const w of new Set([halfWidth, below])) for (const x of [millX - w, millX + w]) if (!has(x, y)) put(x, y);
      if ((base - y) % 7 === 0) hline(millX - halfWidth, millX + halfWidth, y);
    }
    hline(millX - 1, millX + 1, millTop);
    // Four sails from the hub.
    const hubY = millTop - 1;
    for (let i = 1; i <= 9; i += 1) {
      for (const [dx, dy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        const x = millX + dx * i, y = hubY + dy * i;
        if (y >= base - 1 || !builder.fits(x, y)) continue;
        if (!has(x, y)) put(x, y);
        if (!has(x, y - dy)) put(x, y - dy);
      }
    }
    shape.apexes.push({ x: millX, y: hubY, size: 'minor', windmill: true });
  }
  shape.bodyTop = Math.min(...[...builder.frame.values()].map((cell) => cell.y));
  shape.soldiersPerFloor = soldiers;
}

function shapePixelBuilding(world, prepared, variant) {
  if (!world || !prepared || !prepared.ok || !prepared.metadata) throw new Error('Shaping requires a prepared adaptive seed');
  const type = prepared.metadata.type;
  if (!PIXEL_BUILDING_VARIANTS[type] || !PIXEL_BUILDING_VARIANTS[type].includes(variant)) {
    throw new Error(`Unknown ${type} variant ${variant}`);
  }
  const builder = createPixelShapeBuilder(world, prepared);
  if (type === 'population') shapePixelPopulation(builder, prepared, variant);
  else if (type === 'military') shapePixelMilitary(builder, prepared, variant);
  else shapePixelFarm(builder, prepared, variant);
  const cells = builder.finish(variant);
  const xs = cells.map((cell) => cell.x);
  // Snap each apex to the highest built pixel in its column so finials always sit on the roof.
  for (const apex of builder.shape.apexes) {
    const column = cells.filter((cell) => cell.x === apex.x && cell.y <= apex.y + 2);
    if (column.length) apex.y = Math.min(...column.map((cell) => cell.y));
  }
  for (const floor of builder.shape.floors) {
    floor.capacity = floor.accessible ? pixelFloorCapacity(floor.right - floor.left + 1, builder.shape.soldiersPerFloor) : 0;
  }
  const shape = { ...builder.shape, variant, type };
  return { ...prepared,
    geometry: { ...prepared.geometry, frameCells: cells.map((cell) => ({ ...cell })),
      bounds: { left: Math.min(...xs), right: Math.max(...xs) } },
    shape,
    metadata: { ...prepared.metadata, variant, storeys: shape.floors.length,
      accessibleFloors: shape.floors.filter((floor) => floor.accessible).length,
      soldiersPerFloor: shape.soldiersPerFloor } };
}
