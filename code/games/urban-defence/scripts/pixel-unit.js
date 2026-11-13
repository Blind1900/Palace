function createPixelUnitArtwork(reference, options = {}) {
  if (!reference || reference.version !== 1 || !reference.clips) throw new Error('Invalid unit artwork reference');
  if (!options || typeof options !== 'object') throw new Error('Invalid unit artwork size options');
  if (options.inPlace !== undefined && typeof options.inPlace !== 'boolean') throw new Error('Invalid unit in-place animation option');
  const roles = options.roles === undefined ? ['walk', 'jump', 'crouch', 'crouchWalk'] : options.roles;
  if (!Array.isArray(roles) || !roles.length || roles.some((name) => typeof name !== 'string')) throw new Error('Invalid unit animation roles');
  const base = reference.clips[roles[0]];
  const nativeWidth = base && base.width;
  const nativeHeight = base && base.height;
  const cellScale = options.cellScale === undefined ?
    (reference.cellScale === undefined ? 1 : reference.cellScale) : options.cellScale;
  if (!Number.isInteger(cellScale) || cellScale < 1 ||
      nativeWidth * cellScale > 256 || nativeHeight * cellScale > 256) throw new Error('Invalid unit artwork cell scale: use a positive integer within the 256-cell canvas limit');
  const cellReduction = options.cellReduction === undefined ? 1 : options.cellReduction;
  if (!Number.isInteger(cellReduction) || cellReduction < 1 || cellReduction > 8) {
    throw new Error('Invalid unit artwork cell reduction: use an integer from 1 to 8');
  }
  let width = nativeWidth * cellScale, height = nativeHeight * cellScale;
  const nativeFacing = reference.nativeFacing === undefined ? -1 : reference.nativeFacing;
  const tintColor = reference.tintColor === undefined ? '#bce77b' : reference.tintColor;
  if (!Number.isInteger(nativeWidth) || !Number.isInteger(nativeHeight) || nativeWidth < 1 || nativeWidth > 128 ||
      nativeHeight < 1 || nativeHeight > 128 || width > 256 || height > 256 ||
      ![-1, 1].includes(nativeFacing) || tintColor !== null && !/^#[0-9a-f]{6}$/i.test(tintColor)) {
    throw new Error('Invalid unit artwork dimensions, facing or tint');
  }
  const clips = {};
  for (const name of roles) {
    if (!reference.clips[name]) throw new Error(`Missing unit animation role: ${name}`);
  }
  for (const name of Object.keys(reference.clips)) {
    const clip = reference.clips[name];
    if (!clip || !Number.isInteger(clip.width) || !Number.isInteger(clip.height) ||
        clip.width !== nativeWidth || clip.height !== nativeHeight || !Array.isArray(clip.frames) || !clip.frames.length) {
      throw new Error(`Invalid unit artwork clip: ${name}`);
    }
    clips[name] = { ...clip, frames: clip.frames.map((frame) => {
      if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0 || !Array.isArray(frame.runs)) {
        throw new Error(`Invalid unit artwork frame: ${name}`);
      }
      const pixels = [], seen = new Set();
      for (const run of frame.runs) {
        if (!Array.isArray(run) || run.length !== 4 || !run.every(Number.isInteger) ||
            run[0] < 0 || run[1] < 0 || run[1] >= clip.height || run[2] < 1 ||
            run[0] + run[2] > clip.width || (run[3] >>> 24) === 0) throw new Error(`Invalid unit pixel run: ${name}`);
        for (let x = run[0]; x < run[0] + run[2]; x += 1) {
          const key = run[1] * clip.width + x;
          if (seen.has(key)) throw new Error(`Overlapping unit pixel runs: ${name}`);
          seen.add(key);
          for (let dy = 0; dy < cellScale; dy += 1) for (let dx = 0; dx < cellScale; dx += 1) {
            pixels.push({ x: x * cellScale + dx, y: run[1] * cellScale + dy, color: run[3] });
          }
        }
      }
      if (!pixels.length && !options.allowEmptyFrames) throw new Error(`Empty unit artwork frame: ${name}`);
      return { durationMs: frame.durationMs, pixels };
    }) };
  }
  let rootAnchor = null;
  if (options.inPlace) {
    const frames = Object.values(clips).flatMap((clip) => clip.frames);
    const anchors = frames.map((frame) => {
      if (!frame.pixels.length) throw new Error('In-place animation requires opaque body pixels in every frame');
      const center = frame.pixels.reduce((sum, pixel) => sum + pixel.x, 0) / frame.pixels.length;
      return {
        x: Math.round((center - (cellScale - 1) / 2) / cellScale),
        min: frame.pixels.reduce((min, pixel) => Math.min(min, Math.floor(pixel.x / cellScale)), Infinity),
        max: frame.pixels.reduce((max, pixel) => Math.max(max, Math.floor(pixel.x / cellScale)), -Infinity),
      };
    });
    const min = Math.max(...anchors.map((anchor) => anchor.x - anchor.min));
    const max = Math.min(...anchors.map((anchor) => nativeWidth - 1 + anchor.x - anchor.max));
    if (min > max) throw new Error('In-place animation needs more shared transparent canvas padding');
    rootAnchor = { x: Math.max(min, Math.min(max, Math.floor(nativeWidth / 2))) * cellScale };
    frames.forEach((frame, index) => {
      const offset = { x: rootAnchor.x - anchors[index].x * cellScale, y: 0 };
      frame.pixels = frame.pixels.map((pixel) => ({ ...pixel, x: pixel.x + offset.x, y: pixel.y + offset.y }));
      frame.rootOffset = offset;
    });
    for (const clip of Object.values(clips)) {
      const travel = clip.frames.slice(1).map((frame, index) =>
        Math.max(0, (clip.frames[index].rootOffset.x - frame.rootOffset.x) * nativeFacing));
      // The last-to-first source displacement is a reset, not backward travel.
      travel.push(travel.find((distance) => distance > 0) || 0);
      clip.frames.forEach((frame, index) => { frame.forwardTravel = travel[index]; });
    }
  }
  if (cellReduction > 1) {
    width = Math.ceil(width / cellReduction); height = Math.ceil(height / cellReduction);
    for (const clip of Object.values(clips)) for (const frame of clip.frames) {
      const blocks = new Map();
      for (const pixel of frame.pixels) {
        const x = Math.floor(pixel.x / cellReduction), y = Math.floor(pixel.y / cellReduction);
        const key = y * width + x;
        if (!blocks.has(key)) blocks.set(key, { x, y, colors: new Map(), details: [] });
        const block = blocks.get(key), colors = block.colors;
        colors.set(pixel.color, (colors.get(pixel.color) || 0) + 1);
        block.details.push({ x: pixel.x / cellReduction - x, y: pixel.y / cellReduction - y,
          size: 1 / cellReduction, color: pixel.color });
      }
      // Opaque coverage preserves thin limbs; dominant source colors avoid blurred pixels.
      frame.pixels = [...blocks.values()].map(({ x, y, colors, details }) =>
        ({ x, y, color: [...colors].sort((a, b) => b[1] - a[1])[0][0], details }));
      if (frame.rootOffset) {
        frame.rootOffset.x /= cellReduction;
        frame.forwardTravel /= cellReduction;
      }
    }
    if (rootAnchor) rootAnchor.x /= cellReduction;
  }
  const union = (frames) => [...new Map(frames.flatMap((frame) =>
    frame.pixels.map((pixel) => [pixel.y * width + pixel.x, { x: pixel.x, y: pixel.y }]))).values()];
  const standing = union(options.roles === undefined ? [...clips.walk.frames, ...clips.jump.frames] :
    roles.flatMap((name) => clips[name].frames));
  const crouched = clips.crouchWalk ? union(clips.crouchWalk.frames) : standing;
  if (reference.footRow !== undefined && (!Number.isInteger(reference.footRow) ||
      reference.footRow < 1 || reference.footRow > nativeHeight)) throw new Error('Invalid unit artwork foot anchor');
  const footFrames = options.roles === undefined ? clips.walk.frames : roles.flatMap((name) => clips[name].frames);
  const footRow = reference.footRow === undefined ? footFrames.reduce((bottom, frame) =>
    frame.pixels.reduce((highest, pixel) => Math.max(highest, pixel.y + 1), bottom), 0) :
    Math.ceil(reference.footRow * cellScale / cellReduction);
  if (!Number.isInteger(footRow) || footRow < 1 || footRow > height) throw new Error('Invalid unit artwork foot anchor');
  const mirror = (pixels, facing) => pixels.map((pixel) => ({ ...pixel,
    x: facing === nativeFacing ? pixel.x : width - 1 - pixel.x,
    ...(pixel.details ? { details: pixel.details.map((detail) => ({ ...detail,
      x: facing === nativeFacing ? detail.x : 1 - detail.x - detail.size })) } : {}) }));
  return {
    width, height, nativeWidth, nativeHeight, cellScale, cellReduction, footRow, tintColor, rootAnchor,
    crouchSteps: clips.crouch ? Math.max(1, clips.crouch.frames.length - 1) : 0,
    frame(name, index, facing) {
      if (!clips[name] || !Number.isInteger(index) || index < 0 || index >= clips[name].frames.length ||
          ![-1, 1].includes(facing)) throw new Error('Invalid unit animation selection');
      const frame = clips[name].frames[index];
      return { durationMs: frame.durationMs, pixels: mirror(frame.pixels, facing),
        ...(frame.rootOffset ? { rootOffset: { ...frame.rootOffset }, forwardTravel: frame.forwardTravel } : {}) };
    },
    frameCount(name) { if (!clips[name]) throw new Error('Invalid unit animation clip'); return clips[name].frames.length; },
    mask(posture, facing) {
      if (![-1, 1].includes(facing) || !['standing', 'crouched'].includes(posture) &&
          !(clips.crouch && Number.isInteger(posture) && posture >= 0 && posture < clips.crouch.frames.length)) {
        throw new Error('Invalid unit collision posture');
      }
      return mirror(posture === 'standing' ? standing : posture === 'crouched' ? crouched :
        clips.crouch.frames[posture].pixels, facing).map(({ x, y }) => ({ x, y }));
    },
  };
}

function pixelUnitGroundArtworkOffset(unit) {
  if (!unit.grounded || unit.kind === 'jet' || !unit.pixels.some((pixel) => pixel.details)) return 0;
  const bottom = unit.pixels.reduce((row, pixel) => Math.max(row,
    ...(pixel.details || [{ y: 0, size: 1 }]).map((detail) => pixel.y + detail.y + detail.size)), 0);
  return unit.footRow - bottom;
}

const PIXEL_UNIT_RELATIVE_SCALES = Object.freeze({ trooper: 1, tank: 3, hopper: 2, jet: 4 });

function createPixelBuildingLayers(world, getBuildings) {
  if (!world || typeof getBuildings !== 'function') throw new Error('Invalid building layer source');
  let buildings = [], signature = [], owners = new Map(), cores = new Map();
  const structural = (material) => [PARTICLE_BARRIER, PARTICLE_CONSTRUCTION, PARTICLE_WALL].includes(material);
  const layers = {
    refresh() {
      buildings = getBuildings();
      const next = buildings.flatMap((building) => [building.cells, building.cells.length, building.owner,
        building.core, building.core ? building.core.length : 0]);
      if (next.length === signature.length && next.every((value, index) => value === signature[index])) return;
      owners = new Map(); cores = new Map();
      for (const building of buildings) {
        for (const cell of building.cells) {
          const key = cell.y * world.width + cell.x;
          if (owners.has(key) && owners.get(key).owner !== building.owner) throw new Error('Conflicting building layer ownership');
          owners.set(key, building);
        }
        for (const cell of building.core || []) cores.set(cell.y * world.width + cell.x, building);
      }
      signature = next;
    },
    at(x, y) { return owners.get(y * world.width + x) || null; },
    coreAt(x, y) { return cores.get(y * world.width + x) || null; },
    get buildings() { return buildings; },
    // Shots: tank and mech fire passes only through the shooter's own structure.
    ignores(kind, owner, x, y, material) {
      if (!['tank', 'hopper'].includes(kind) || !structural(material)) return false;
      const building = layers.at(x, y);
      return Boolean(building && building.owner === owner);
    },
    // Movement: tanks drive behind any building but stop at an enemy core; mechs pass through walls
    // sideways and stand on building tops (see platformAt). Troops still need doors and planes still crash.
    passes(kind, owner, x, y, material) {
      if (!['tank', 'hopper'].includes(kind) || !structural(material)) return false;
      const building = layers.at(x, y), core = layers.coreAt(x, y);
      if (core && core.owner !== owner) return false;
      return Boolean(building || core);
    },
    platformAt(owner, x, y) {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height || !structural(world.at(x, y))) return false;
      const core = layers.coreAt(x, y);
      return Boolean(layers.at(x, y) && !(core && core.owner !== owner));
    },
    contactOptions(kind, owner) {
      const options = { ignoreMaterial: (x, y, material) => layers.passes(kind, owner, x, y, material),
        buildingAt: layers.at };
      if (kind === 'hopper') options.platformAt = (x, y) => layers.platformAt(owner, x, y);
      return options;
    },
    facades(state, owner) {
      if (!['tank', 'hopper'].includes(state.kind)) return [];
      return buildings.filter((building) => (building.owner === owner || state.kind === 'tank') && building.intact() &&
        state.x < building.right && state.x + state.width > building.left &&
        state.y < building.bottom && state.y + state.height > building.top);
    },
  };
  layers.refresh();
  return layers;
}

function drawPixelBuildingFacades(ctx, world, layers) {
  ctx.save(); ctx.fillStyle = '#1c2b34';
  for (const building of layers.buildings) {
    if (!building.intact()) continue;
    // Shaped buildings list their storey rectangles, so setbacks and crowns get no backdrop.
    for (const span of building.spans || [building]) for (let y = span.top; y < span.bottom; y += 1) {
      let start = null;
      for (let x = span.left; x <= span.right; x += 1) {
        const empty = x < span.right && world.at(x, y) === PARTICLE_EMPTY;
        if (empty && start === null) start = x;
        if (!empty && start !== null) { ctx.fillRect(start, y, x - start, 1); start = null; }
      }
    }
    ctx.fillStyle = '#31434e';
    for (const window of building.windows) ctx.fillRect(window.x, window.y, window.width, window.height);
    ctx.fillStyle = '#1c2b34';
  }
  ctx.restore();
}

function withPixelBuildingOcclusion(ctx, world, state, owner, layers, draw) {
  const facades = layers ? layers.facades(state, owner) : [];
  ctx.save();
  for (const building of facades) {
    ctx.beginPath(); ctx.rect(0, 0, world.width, world.height);
    for (const span of building.spans || [building]) ctx.rect(span.left, span.top, span.right - span.left, span.bottom - span.top);
    for (const window of building.windows) ctx.rect(window.x, window.y, window.width, window.height);
    ctx.clip('evenodd');
  }
  const result = draw();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.rect(state.x, state.y, state.width, state.height); ctx.clip();
  ctx.fillStyle = '#83b3c5'; ctx.globalAlpha = 0.25;
  for (const building of facades) for (const window of building.windows) {
    ctx.fillRect(window.x, window.y, window.width, window.height);
  }
  ctx.restore();
  return result;
}

function inspectPixelUnitWater(world, x, y, pixels) {
  const wetCells = pixels.filter((pixel) => world.at(x + pixel.x, y + pixel.y) === PARTICLE_WATER).length;
  return { wetCells, totalCells: pixels.length, wet: wetCells > 0, fullySubmerged: pixels.length > 0 && wetCells === pixels.length };
}

function findPixelUnitContact(world, x, y, pixels, ignoreDebris = false, ignoreMaterial) {
  return world.findUnitContact(x, y, pixels, ignoreDebris, ignoreMaterial);
}

function pixelUnitDebrisDrag(world, x, y, pixels) {
  const coverage = pixels.length ? world.countUnitDebris(x, y, pixels) / pixels.length : 0;
  return 1 - 0.65 * coverage;
}

function findPixelUnitWaterEdge(world, x, y, pixels, height) {
  const bottom = new Map();
  for (const pixel of pixels) {
    const px = x + pixel.x, py = y + pixel.y;
    if (px < 0 || px >= world.width || py < 0 || py >= world.height) return { x: px, y: py, reason: 'crop edge', material: null };
    if (world.at(px, py) === PARTICLE_WATER) return { x: px, y: py, reason: 'water edge', material: PARTICLE_WATER };
    bottom.set(pixel.x, Math.max(bottom.get(pixel.x) === undefined ? -1 : bottom.get(pixel.x), pixel.y));
  }
  // Follow open drops to the first surface so units do not step off a bank into deep water.
  for (const [px, py] of bottom) for (let row = y + py + 1; row < world.height; row += 1) {
    const material = world.at(x + px, row);
    if (material === PARTICLE_WATER) return { x: x + px, y: row, reason: 'water edge', material };
    if (material !== PARTICLE_EMPTY) break;
  }
  return null;
}

function createPixelUnitCollisionGroup(world) {
  if (!world || !Number.isInteger(world.width)) throw new Error('Invalid unit collision world');
  const entries = new Map(), occupied = new Map();
  const group = {
    world,
    contact(ownerId, x, y, pixels) {
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (const pixel of pixels) {
        left = Math.min(left, x + pixel.x); right = Math.max(right, x + pixel.x);
        top = Math.min(top, y + pixel.y); bottom = Math.max(bottom, y + pixel.y);
      }
      let nearby = false;
      for (const entry of entries.values()) {
        if (entry.ownerId !== ownerId && entry.bounds && left <= entry.bounds.right && right >= entry.bounds.left &&
            top <= entry.bounds.bottom && bottom >= entry.bounds.top) { nearby = true; break; }
      }
      if (!nearby) return null;
      for (const pixel of pixels) {
        const px = x + pixel.x, py = y + pixel.y;
        if (px < 0 || py < 0 || px >= world.width || py >= world.height) continue;
        const units = occupied.get(py * world.width + px);
        if (units) for (const owner of units.values()) if (owner !== ownerId) {
          return { x: px, y: py, reason: 'opposing unit', material: null };
        }
      }
      return null;
    },
    register(unit, ownerId) {
      if (!unit || typeof unit.inspect !== 'function' || typeof ownerId !== 'string' || !ownerId ||
          entries.has(unit)) throw new Error('Invalid unit collision registration');
      entries.set(unit, { ownerId, keys: new Set() }); group.sync(unit);
    },
    has(unit) { return entries.has(unit); },
    isOccupied(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Invalid unit occupancy query');
      return x >= 0 && y >= 0 && x < world.width && y < world.height && occupied.has(y * world.width + x);
    },
    unregister(unit) {
      const entry = entries.get(unit);
      if (!entry) return false;
      for (const key of entry.keys) {
        const units = occupied.get(key); units.delete(unit);
        if (!units.size) occupied.delete(key);
      }
      entries.delete(unit); return true;
    },
    sync(unit) {
      const entry = entries.get(unit);
      if (!entry) throw new Error('Unregistered unit collision update');
      const state = unit.inspect({ sprites: false }), nextKeys = new Set();
      const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      for (const pixel of state.collision) {
        const px = state.x + pixel.x, py = state.y + pixel.y;
        if (px >= 0 && py >= 0 && px < world.width && py < world.height) {
          nextKeys.add(py * world.width + px);
          bounds.left = Math.min(bounds.left, px); bounds.right = Math.max(bounds.right, px);
          bounds.top = Math.min(bounds.top, py); bounds.bottom = Math.max(bounds.bottom, py);
        }
      }
      for (const key of entry.keys) {
        if (nextKeys.has(key)) continue;
        const units = occupied.get(key); units.delete(unit);
        if (!units.size) occupied.delete(key);
      }
      for (const key of nextKeys) {
        if (entry.keys.has(key)) continue;
        if (!occupied.has(key)) occupied.set(key, new Map());
        occupied.get(key).set(unit, entry.ownerId);
      }
      entry.keys = nextKeys;
      entry.bounds = bounds;
    },
  };
  return group;
}

const PIXEL_UNIT_LAB_PATROLS = new WeakMap();

function pixelUnitGroundSpeedMultiplier(options, state) {
  if (!options.groundSpeedMultiplier || !state.grounded || state.vy < 0 || state.water.wet || state.killed ||
      state.drowned || state.kind === 'jet') return 1;
  const value = options.groundSpeedMultiplier(state);
  if (!Number.isFinite(value) || value < 1 || value > 3) throw new Error('Invalid ground speed multiplier');
  return value;
}

function updatePixelUnitLabPatrol(unit, world, homeY) {
  const state = unit.inspect({ sprites: false });
  if (state.killed || state.drowned) return false;
  const jet = state.kind === 'jet';
  let direction = Number(unit.input.right) - Number(unit.input.left);
  if (!direction && jet) direction = Math.cos(state.heading) < 0 ? -1 : 1;
  if (!direction) return false;
  let left = world.width, right = -1;
  for (const pixel of state.collision) { left = Math.min(left, state.x + pixel.x); right = Math.max(right, state.x + pixel.x); }
  const margin = jet ? Math.min(74, Math.max(2, Math.floor((world.width - (right - left + 1)) / 2) - 2)) : 2;
  const turn = direction > 0 && right >= world.width - margin || direction < 0 && left <= margin;
  let patrol = PIXEL_UNIT_LAB_PATROLS.get(unit);
  if (!patrol) { patrol = { turning: false }; PIXEL_UNIT_LAB_PATROLS.set(unit, patrol); }
  if (turn) {
    direction *= -1; unit.input.left = direction < 0; unit.input.right = direction > 0;
    patrol.turning = jet;
  }
  if (jet && Number.isFinite(homeY)) {
    if (patrol.turning && Math.cos(state.heading) * direction >= 0.99) patrol.turning = false;
    unit.input.up = !patrol.turning && state.y > homeY + 8;
    unit.input.down = !patrol.turning && state.y < homeY - 8;
  }
  return turn;
}

function createPixelTerrainUnit(world, artwork, options) {
  if (!world || !artwork || !options || !Number.isInteger(options.x) || !Number.isInteger(options.y) ||
      ![-1, 1].includes(options.facing === undefined ? -1 : options.facing) ||
      options.automated !== undefined && typeof options.automated !== 'boolean' ||
      options.collisionGroup && (options.collisionGroup.world !== world || typeof options.ownerId !== 'string' || !options.ownerId)) throw new Error('Invalid terrain unit placement');
  const speedScale = options.speedScale === undefined ? 1 : options.speedScale;
  if (!Number.isFinite(speedScale) || speedScale <= 0 || speedScale > 3) throw new Error('Invalid unit speed scale');
  if (options.groundSpeedMultiplier !== undefined && typeof options.groundSpeedMultiplier !== 'function') throw new Error('Invalid ground speed rule');
  let x = options.x, y = options.y, facing = options.facing === undefined ? -1 : options.facing;
  let posture = 0, postureTime = 0, animation = 'walk', frame = 0, animationTime = 0;
  let vxRemainder = 0, vyRemainder = 0, vy = 0, grounded = false, killed = false, moving = false, ticks = 0;
  let jumpHeld = false, state = 'ready', blocker = null;
  let drowned = false, water = { wetCells: 0, totalCells: 0, wet: false, fullySubmerged: false };
  const input = { left: false, right: false, jump: false, crouch: false };
  const mask = (pose = posture, direction = facing) =>
    artwork.mask(pose === 0 ? 'standing' : pose === artwork.crouchSteps ? 'crouched' : pose, direction);
  function collision(nx, ny, pixels = mask()) {
    return findPixelUnitContact(world, nx, ny, pixels, true) ||
      (options.collisionGroup ? options.collisionGroup.contact(options.ownerId, nx, ny, pixels) : null);
  }
  function submersion() {
    water = inspectPixelUnitWater(world, x, y, artwork.frame(animation, frame, facing).pixels);
    drowned = drowned || water.fullySubmerged;
  }
  const initial = collision(x, y);
  if (initial) throw new Error(`Unit spawn blocked by ${initial.reason} at (${initial.x}, ${initial.y})`);
  function support() {
    const contact = collision(x, y + 1);
    return contact && [PARTICLE_TERRAIN, PARTICLE_BARRIER].includes(contact.material);
  }
  grounded = Boolean(support());
  submersion();
  if (drowned) state = grounded ? 'drowned on bottom' : 'drowned, sinking';
  else if (water.wet) state = grounded ? 'wading' : 'sinking';
  const unit = {
    input,
    kill() {
      killed = true; vxRemainder = 0; vy = Math.max(0, vy);
      Object.keys(input).forEach((key) => { input[key] = false; });
    },
    step(dt = 1 / 60) {
      if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new Error('Unit step requires a positive delta of at most 0.1 seconds');
      if (Object.values(input).some((value) => typeof value !== 'boolean')) throw new Error('Invalid unit movement input');
      ticks += 1; moving = false; blocker = collision(x, y);
      if (blocker) {
        state = `overlapped by ${blocker.reason}`; grounded = false; vy = 0;
        vxRemainder = 0; vyRemainder = 0; jumpHeld = input.jump; return;
      }
      grounded = Boolean(support());
      submersion();
      const direction = drowned || killed ? 0 : Number(input.right) - Number(input.left);
      if (direction && direction !== facing) {
        const blocked = collision(x, y, mask(posture, direction));
        if (!blocked) facing = direction;
        else blocker = blocked;
      }
      postureTime += dt * 1000;
      const target = drowned || killed ? posture : input.crouch ? artwork.crouchSteps : 0;
      const poseDuration = artwork.frame('crouch', Math.min(posture, artwork.frameCount('crouch') - 1), facing).durationMs;
      if (posture !== target && postureTime + 1e-8 >= poseDuration) {
        const next = posture + Math.sign(target - posture), blocked = collision(x, y, mask(next));
        if (blocked) blocker = blocked;
        else { posture = next; postureTime -= poseDuration; }
      } else if (posture === target) postureTime = 0;
      if (input.jump && !jumpHeld && grounded && posture === 0 && !input.crouch && !water.wet && !drowned && !killed &&
          !(options.automated && findPixelUnitWaterEdge(world, x + direction, y, mask(), artwork.height))) {
        vy = -42; grounded = false; vyRemainder = 0;
      }
      jumpHeld = input.jump;
      const horizontal = direction === facing ? direction : 0;
      function nextHorizontal(dx) {
        if (options.automated && !water.wet) {
          const edge = findPixelUnitWaterEdge(world, x + dx, y, mask(), artwork.height);
          if (edge) return { blocked: edge, rise: 0 };
        }
        let blocked = collision(x + dx, y), rise = 0;
        if (blocked && grounded && [PARTICLE_TERRAIN, PARTICLE_BARRIER].includes(blocked.material)) {
          for (let step = 1; step <= 2; step += 1) {
            if (collision(x, y - step)) break;
            if (!collision(x + dx, y - step)) { rise = step; blocked = null; break; }
          }
        }
        return { blocked, rise };
      }
      const roadScale = pixelUnitGroundSpeedMultiplier(options, { x, y, width: artwork.width, footRow: artwork.footRow,
        ownerId: options.ownerId, grounded, vy, water, killed, drowned, kind: 'trooper' });
      const debrisDrag = Math.min(pixelUnitDebrisDrag(world, x, y, mask()),
        pixelUnitDebrisDrag(world, x + horizontal, y, mask()));
      vxRemainder += horizontal * (posture === artwork.crouchSteps && posture > 0 ? 12 : 24) * speedScale * roadScale * debrisDrag * (water.wet ? 0.5 : 1) * dt;
      while (Math.abs(vxRemainder) + 1e-10 >= 1) {
        const dx = Math.sign(vxRemainder);
        const { blocked, rise } = nextHorizontal(dx);
        if (blocked) { blocker = blocked; vxRemainder = 0; break; }
        x += dx; y -= rise; vxRemainder -= dx; moving = true;
        submersion();
        if (drowned) { vxRemainder = 0; break; }
        grounded = Boolean(support());
      }
      if (horizontal && !moving) {
        const next = nextHorizontal(horizontal);
        if (next.blocked) blocker = next.blocked;
        else if (!blocker) moving = true;
      }
      if (!grounded || vy < 0) {
        vy = Math.min(90, vy + 90 * dt);
        vyRemainder += vy * dt;
        while (Math.abs(vyRemainder) + 1e-10 >= 1) {
          const dy = Math.sign(vyRemainder), blocked = collision(x, y + dy);
          if (blocked) {
            if (dy > 0 && [PARTICLE_TERRAIN, PARTICLE_BARRIER].includes(blocked.material)) grounded = true;
            else blocker = blocked;
            vy = 0; vyRemainder = 0; break;
          }
          y += dy; vyRemainder -= dy; moving = true;
          submersion();
        }
      } else { vy = 0; vyRemainder = 0; }
      const nextAnimation = posture > 0 ? 'crouch' : !grounded ? 'jump' : 'walk';
      const clip = posture === artwork.crouchSteps && posture > 0 && moving ? 'crouchWalk' : nextAnimation;
      if (clip !== animation) { animation = clip; frame = 0; animationTime = 0; }
      if (animation === 'crouch') { frame = Math.min(posture, artwork.frameCount('crouch') - 1); animationTime = 0; }
      else if (moving || animation === 'jump') {
        animationTime += dt * 1000;
        while (animationTime + 1e-8 >= artwork.frame(animation, frame, facing).durationMs) {
          animationTime -= artwork.frame(animation, frame, facing).durationMs;
          frame = animation === 'jump' ? Math.min(frame + 1, artwork.frameCount(animation) - 1) :
            (frame + 1) % artwork.frameCount(animation);
          if (animation === 'jump' && frame === artwork.frameCount(animation) - 1) {
            animationTime = 0; break;
          }
        }
      } else { frame = 0; animationTime = 0; }
      submersion();
      state = killed ? grounded ? 'destroyed on ground' : 'destroyed, falling' :
        drowned ? grounded ? 'drowned on bottom' : 'drowned, sinking' :
        blocker && blocker.reason === 'water edge' ? 'waiting at water edge' :
        blocker ? `blocked by ${blocker.reason}` : water.wet ? grounded ? 'wading' : 'sinking' : posture !== target ? 'changing posture' :
        !grounded ? vy < 0 ? 'jumping' : 'falling' : posture === artwork.crouchSteps && posture > 0 ?
          moving ? 'crouch walking' : 'crouched' : moving ? 'walking' : 'ready';
      if (options.collisionGroup) options.collisionGroup.sync(unit);
    },
    inspect(inspection = {}) {
      return { x, y, facing, grounded, moving, vy, ticks, posture, animation, frame, state, drowned, killed,
        water: { ...water }, automated: Boolean(options.automated), ownerId: options.ownerId,
        blocker: blocker ? { ...blocker } : null,
        ...(inspection.sprites === false ? {} : { pixels: artwork.frame(animation, frame, facing).pixels }),
        collision: mask(), width: artwork.width, height: artwork.height, footRow: artwork.footRow,
        tintColor: artwork.tintColor, mode: 'lab-only-kinematic', material: false };
    },
  };
  if (options.collisionGroup) options.collisionGroup.register(unit, options.ownerId);
  return unit;
}
