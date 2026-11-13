// Walkable building interiors at map scale (cellReduction 4). A standing trooper's collision mask is
// 6 x 8 cells and it can step up at most 2 cells; every storey keeps 13 clear rows under a 14-row floor
// pitch so rooms read as spacious, and stairs climb one cell per column.
const PIXEL_INTERIOR = Object.freeze({
  unitWidth: 6, unitHeight: 8, stepRise: 2, clearHeight: 13, floorPitch: 14, soldierSlot: 7,
  doorHeight: 9, wall: 3, stairBand: 12,
});

function pixelSoldiersPerFloor(level) {
  if (!Number.isInteger(level) || level < 1 || level > 7) throw new Error('Invalid building level');
  return 2 + Math.floor(level / 2);
}

// In strict 2D a turning stair always needs a hole in the floor above for the climber's head, which a
// walker on that floor would fall through. Stair and stairwell pixels are therefore one-way: they are
// real structure for physics, but only a unit's sole row (lowest mask row) collides with them, so
// units stand on them from above and pass through them from below (classic platformer stairs).
function createPixelOneWayUnitWorld(world, oneWayKeys, passKeys = new Set()) {
  if (!world || typeof world.findUnitContact !== 'function' || !(oneWayKeys instanceof Set) || !(passKeys instanceof Set)) {
    throw new Error('One-way unit world requires a particle world and sets of cell keys');
  }
  const feet = new WeakMap();
  // Only the sole row (the mask's lowest row) stands on one-way pixels; arms and weapons pass through.
  const footPixels = (pixels) => {
    let set = feet.get(pixels);
    if (!set) {
      const sole = Math.max(...pixels.map((pixel) => pixel.y));
      set = new Set(pixels.filter((pixel) => pixel.y === sole));
      feet.set(pixels, set);
    }
    return set;
  };
  const proxy = Object.create(world);
  proxy.oneWayKeys = oneWayKeys;
  proxy.passKeys = passKeys;
  // Platformer semantics need the unit's current position. Upward queries (step-up rises and jumps) and
  // in-place queries (turning, posture) ignore one-way pixels, so units rise through floors and stairs
  // from below; sideways and downward queries treat a one-way pixel under the sole as solid, so walking
  // into a step triggers the normal step-up and gravity lands units on floors and steps.
  // `through` anchors ignore every one-way pixel, so a unit walking the street passes under the stairs.
  let anchorSole = null, anchorX = null, anchorY = null, anchorThrough = false;
  proxy.anchor = (x, y, pixels, options = {}) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Array.isArray(pixels)) throw new Error('Invalid one-way anchor');
    anchorSole = y + Math.max(...pixels.map((pixel) => pixel.y));
    anchorX = x; anchorY = y; anchorThrough = Boolean(options.through);
  };
  proxy.anchorUnit = (unit, options) => {
    const state = unit.inspect({ sprites: false });
    proxy.anchor(state.x, state.y, state.collision, options);
  };
  proxy.clearAnchor = () => { anchorSole = null; anchorX = null; anchorY = null; anchorThrough = false; };
  proxy.findUnitContact = (x, y, pixels, ignoreDebris = false) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Array.isArray(pixels)) throw new Error('Invalid unit contact query');
    const foot = footPixels(pixels);
    const passes = anchorThrough || (anchorY !== null && (y < anchorY || (y === anchorY && x === anchorX)));
    for (const pixel of pixels) {
      const px = x + pixel.x, py = y + pixel.y;
      if (px < 0 || py < 0 || px >= world.width || py >= world.height) return { x: px, y: py, reason: 'crop edge', material: null };
      const material = world.at(px, py);
      if (material === PARTICLE_EMPTY || material === PARTICLE_WATER || (ignoreDebris && material === PARTICLE_DEBRIS)) continue;
      const cell = py * world.width + px;
      // Door panes carry load like any wall pixel but never block a unit.
      if (passKeys.has(cell)) continue;
      if (oneWayKeys.has(cell) && (!foot.has(pixel) || passes)) continue;
      return { x: px, y: py, reason: ['empty', 'terrain', 'water', 'structure', 'debris', 'construction', 'wall'][material],
        material, oneWay: oneWayKeys.has(py * world.width + px) };
    }
    return null;
  };
  return proxy;
}

// Places finished structure pixels in one restore (used for "preview finished" and interior tests). The
// result is a normal particle world, so support, load and collapse still apply on the next step.
function buildPixelCellsInstantly(world, cells) {
  if (!world || typeof world.snapshot !== 'function' || !Array.isArray(cells)) throw new Error('Instant build requires a world and cells');
  const snapshot = world.snapshot();
  for (const cell of cells) {
    const index = cell.y * world.width + cell.x;
    if (snapshot.cells[index] === PARTICLE_EMPTY || snapshot.cells[index] === PARTICLE_CONSTRUCTION) snapshot.cells[index] = PARTICLE_BARRIER;
  }
  snapshot.supportsDirty = true;
  world.restore(snapshot);
  return world;
}

// A solid-lookup world for previews: planned cells count as built structure without simulating.
function createPixelPlannedWorld(world, plannedKeys) {
  const proxy = Object.create(world);
  proxy.at = (x, y) => {
    const material = world.at(x, y);
    return material === PARTICLE_EMPTY && plannedKeys.has(y * world.width + x) ? PARTICLE_BARRIER : material;
  };
  return proxy;
}

// Finds non-overlapping standing spots for soldiers on every accessible floor of a shape.
function findPixelSoldierSlots(unitWorld, shape, mask, perFloor) {
  const slots = [];
  const bottom = Math.max(...mask.map((pixel) => pixel.y));
  const left = Math.min(...mask.map((pixel) => pixel.x)), right = Math.max(...mask.map((pixel) => pixel.x));
  for (const floor of shape.floors.filter((entry) => entry.accessible)) {
    const found = [];
    for (let x = floor.left - left; x + right <= floor.right && found.length < perFloor; x += 1) {
      // Stand on the floor, or on a stair step that rises above it.
      let y = floor.y - 1 - bottom;
      while (unitWorld.findUnitContact(x, y, mask, true) && y > floor.y - 1 - bottom - PIXEL_INTERIOR.stepRise) y -= 1;
      if (unitWorld.findUnitContact(x, y, mask, true)) continue;
      // Must be standing (supported) and must not overlap a soldier already placed on this floor.
      if (!unitWorld.findUnitContact(x, y + 1, mask, true)) continue;
      if (found.some((slot) => Math.abs(slot.x - x) < right - left + 2)) continue;
      found.push({ x, y, floorY: floor.y, storey: floor.storey });
    }
    slots.push({ storey: floor.storey, floorY: floor.y, wanted: perFloor, slots: found });
  }
  return slots;
}

// Steers a trooper up the switchback stairs: on storey k walk in that storey's stair direction.
function createPixelStairClimber(unit, shape, options = {}) {
  const stairs = new Map(shape.stairs.map((stair) => [stair.storey, stair]));
  const top = shape.floors.filter((floor) => floor.accessible).reduce((best, floor) =>
    floor.storey > best.storey ? floor : best, { storey: -1 });
  const base = shape.floors.find((floor) => floor.storey === 0).y;
  const pitch = shape.floorPitch || PIXEL_INTERIOR.floorPitch;
  let reached = 0, idle = 0, lastX = null, lastY = null, approaching = false;
  const center = (state) => {
    const xs = state.collision.map((pixel) => pixel.x);
    return state.x + (Math.min(...xs) + Math.max(...xs)) / 2;
  };
  return {
    storey() {
      const state = unit.inspect({ sprites: false });
      const feet = state.y + Math.max(...state.collision.map((pixel) => pixel.y));
      // A sole that has stepped into a floor row still belongs to the storey below until it stands on it.
      return Math.max(0, Math.floor((base - 1 - feet) / pitch));
    },
    step() {
      const storey = this.storey();
      reached = Math.max(reached, storey);
      const stair = stairs.get(storey);
      let direction = stair ? stair.direction : (options.finalDirection || 1);
      if (stair) {
        // Entering beyond the high end of a flight: walk back under it to its foot first.
        const middle = center(unit.inspect({ sprites: false }));
        const offset = (middle - stair.from) * stair.direction;
        if (offset > stair.run) approaching = true;
        if (approaching && offset < -4) approaching = false;
        if (approaching) direction = -stair.direction;
      }
      unit.input.left = direction < 0; unit.input.right = direction > 0;
      if (options.unitWorld && options.unitWorld.anchorUnit) options.unitWorld.anchorUnit(unit);
      unit.step(1 / 60);
      const state = unit.inspect({ sprites: false });
      idle = state.x === lastX && state.y === lastY ? idle + 1 : 0;
      lastX = state.x; lastY = state.y;
      return { storey, reached, topStorey: top.storey, done: reached >= top.storey, stuck: idle > 120, state };
    },
  };
}
