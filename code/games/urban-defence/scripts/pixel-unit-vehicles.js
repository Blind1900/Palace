function createPixelVehicleUnit(world, artwork, options) {
  const kind = options && options.kind;
  if (!world || !artwork || !['tank', 'hopper', 'jet'].includes(kind) || !Number.isInteger(options.x) || !Number.isInteger(options.y) ||
      ![-1, 1].includes(options.facing) || options.automated !== undefined && typeof options.automated !== 'boolean' ||
      options.collisionGroup && (options.collisionGroup.world !== world || typeof options.ownerId !== 'string' || !options.ownerId)) {
    throw new Error('Invalid vehicle unit placement');
  }
  const speedScale = options.speedScale === undefined ? 1 : options.speedScale;
  const treadRate = options.treadRate === undefined ? 1 : options.treadRate;
  const forwardLunge = options.forwardLunge === undefined ? 1 : options.forwardLunge;
  if (![speedScale, treadRate, forwardLunge].every((value) => Number.isFinite(value) && value > 0 && value <= 3)) {
    throw new Error('Invalid vehicle movement tuning');
  }
  if (options.groundSpeedMultiplier !== undefined && typeof options.groundSpeedMultiplier !== 'function') throw new Error('Invalid ground speed rule');
  if (options.assault !== undefined && typeof options.assault !== 'boolean') throw new Error('Invalid vehicle assault rule');
  if (options.hatchArtwork !== undefined && (kind !== 'tank' || !options.hatchArtwork ||
      typeof options.hatchArtwork.frame !== 'function')) throw new Error('Invalid tank hatch gunner artwork');
  for (const name of ['ignoreMaterial', 'buildingAt', 'onBuildingImpact', 'platformAt']) {
    if (options[name] !== undefined && typeof options[name] !== 'function') throw new Error(`Invalid vehicle ${name} rule`);
  }
  const input = { left: false, right: false, up: false, down: false, jump: false, boost: false, glide: false,
    aimUp: false, aimDown: false, shoot: false, reverse: false };
  let x = options.x, y = options.y, facing = options.facing, vx = 0, vy = 0, rx = 0, ry = 0, ticks = 0;
  let grounded = false, drowned = false, killed = false, state = 'ready', blocker = null, moving = false;
  let heading = facing === 1 ? 0 : Math.PI, charges = 2, boostTime = 0, glideTime = 2, slideTime = 0;
  const burstSpeed = 192, burstDuration = 0.18;
  const boostAnimationRate = kind === 'hopper' ? Array.from({ length: artwork.frameCount('boost') }, (_, index) =>
    artwork.frame('boost', index, facing).durationMs).reduce((sum, duration) => sum + duration, 0) / (burstDuration * 1000) : 1;
  let airBoost = false, coastDuration = 2;
  let jumpHeld = false, boostHeld = false, boosted = false, aim = 0, aimTime = 0;
  let navigation = 'clear route', navigationUntil = 0, retreatDirection = 0;
  let nextNavigation = 0, routeDirection = 0, requestedDirection = 0, routeBlocked = false, nextAssaultJump = 0, groundedTime = 0, slipTicks = 0, backingOut = false;
  let assaultJumpX = null;
  let animation = kind === 'tank' ? 'move' : kind === 'hopper' ? 'idle' : 'fly', frame = 0, animationTime = 0;
  let transportPhase = null;
  let transportMotion = { vx: 0, vy: 0, offsetX: 0, offsetY: 0 };
  let jumpFrame = 0, jumpTime = 0, jumpElapsed = Infinity, takeoffLift = 0;
  const groundBoost = new Map(), groundWalk = new Map(), jumpPoses = new Map(), fallPoses = new Map(), jetBody = new Map(), jetPreview = new Map(), masks = new Map();
  // Airlift poses reuse whole jump/fall frames, shifted so the lowest pixels (the feet) rest on the tank roof.
  const carryPoses = new Map(), footAnchored = (pixels) => {
    const bottom = Math.max(...pixels.map((pixel) => pixel.y + 1));
    return pixels.map((pixel) => ({ ...pixel, y: pixel.y + artwork.footRow - bottom }));
  };
  for (const direction of [-1, 1]) {
    const shooting = kind === 'jet' ? Array.from({ length: artwork.frameCount('shoot') }, (_, index) => {
      const pixels = artwork.frame('shoot', index, direction).pixels;
      const remaining = new Map(pixels.map((pixel) => [`${pixel.x},${pixel.y}`, pixel])), components = [];
      while (remaining.size) {
        const first = remaining.values().next().value, queue = [first], group = [];
        remaining.delete(`${first.x},${first.y}`);
        while (queue.length) {
          const pixel = queue.pop(); group.push(pixel);
          for (const [x, y] of [[pixel.x - 1, pixel.y], [pixel.x + 1, pixel.y], [pixel.x, pixel.y - 1], [pixel.x, pixel.y + 1]]) {
            const key = `${x},${y}`;
            if (remaining.has(key)) { queue.push(remaining.get(key)); remaining.delete(key); }
          }
        }
        components.push(group);
      }
      components.sort((a, b) => b.length - a.length);
      return { body: components[0], preview: components.slice(1).flat() };
    }) : [];
    jetBody.set(direction, shooting.map((pose) => pose.body));
    jetPreview.set(direction, shooting.map((pose) => pose.preview));
    const walking = kind === 'hopper' ? Array.from({ length: artwork.frameCount('idle') }, (_, index) => {
      const pixels = artwork.frame('idle', index, direction).pixels;
      const bottom = Math.max(...pixels.map((pixel) => pixel.y + 1));
      return pixels.map((pixel) => ({ ...pixel, y: pixel.y + artwork.footRow - bottom }));
    }) : [];
    const anchored = (pixels) => {
      const rows = new Map();
      for (const pixel of pixels) rows.set(pixel.y, (rows.get(pixel.y) || 0) + 1);
      const bodyRow = [...rows].reduce((best, row) => row[1] > best[1] ? row : best)[0];
      return { pixels, bodyRow, top: Math.min(...pixels.map((pixel) => pixel.y)), bottom: Math.max(...pixels.map((pixel) => pixel.y)) };
    };
    const jumping = kind === 'hopper' ? Array.from({ length: artwork.frameCount('jump') }, (_, index) =>
      anchored(artwork.frame('jump', index, direction).pixels)) : [];
    const falling = kind === 'hopper' ? Array.from({ length: artwork.frameCount('fall') }, (_, index) =>
      anchored(artwork.frame('fall', index, direction).pixels)) : [];
    let alignedJump = [], alignedFall = [], transitionMasks = [];
    if (jumping.length) {
      const airborne = [...jumping, ...falling];
      alignedJump = jumping.map((pose) => pose.pixels);
      alignedFall = falling.map((pose) => pose.pixels);
      const highestBottom = Math.max(...airborne.map((pose) => pose.bottom));
      takeoffLift = Math.max(0, Math.min(
        anchored(walking[0]).bodyRow - jumping[0].bodyRow,
        artwork.footRow - 1 - highestBottom,
      ));
      for (const pixels of [...alignedJump, ...alignedFall]) {
        const limit = Math.min(takeoffLift, artwork.footRow - 1 - Math.max(...pixels.map((pixel) => pixel.y)));
        for (let offset = 0; offset <= limit; offset += 1) {
          transitionMasks.push(...pixels.map((pixel) => ({ ...pixel, y: pixel.y + offset })));
        }
      }
    }
    const poses = kind === 'hopper' ? Array.from({ length: artwork.frameCount('boost') }, (_, index) => {
      const pose = artwork.frame('boost', index, direction);
      const bottom = pose.pixels.reduce((row, pixel) => Math.max(row, pixel.y + 1), 0);
      const pixels = pose.pixels.map((pixel) => ({ ...pixel, y: pixel.y + artwork.footRow - bottom }));
      if (pixels.some((pixel) => pixel.y < 0 || pixel.y >= artwork.height)) {
        throw new Error('Hopper foot anchor cannot fit a grounded boost pose');
      }
      return pixels;
    }) : [];
    groundBoost.set(direction, poses);
    groundWalk.set(direction, walking);
    jumpPoses.set(direction, alignedJump);
    fallPoses.set(direction, alignedFall);
    if (walking.flat().some((pixel) => pixel.y < 0 || pixel.y >= artwork.height)) {
      throw new Error('Hopper foot anchor cannot fit grounded walking poses');
    }
    const standing = kind === 'jet' ? [...['fly', 'down'].flatMap((role) =>
      Array.from({ length: artwork.frameCount(role) }, (_, index) => artwork.frame(role, index, direction).pixels)).flat(),
      ...shooting.flatMap((pose) => pose.body)] : artwork.mask('standing', direction);
    const carry = kind === 'hopper' ? ['jump', 'fall'].map((role) => Array.from({ length: artwork.frameCount(role) },
      (_, index) => footAnchored(artwork.frame(role, index, direction).pixels))) : [];
    carryPoses.set(direction, carry);
    const grip = kind === 'hopper' && options.assault ? carry.flat(2) : [];
    masks.set(direction, [...new Map([...standing, ...poses.flat(), ...walking.flat(), ...transitionMasks, ...grip]
      .map(({ x, y }) => [y * artwork.width + x, { x, y }])).values()]);
  }
  let water = { wet: false, fullySubmerged: false, wetCells: 0, totalCells: 0 };
  const collisionMask = (direction = facing) => masks.get(direction);
  const contact = (nx, ny, direction = facing) => findPixelUnitContact(world, nx, ny, collisionMask(direction), true, options.ignoreMaterial) ||
    (options.collisionGroup ? options.collisionGroup.contact(options.ownerId, nx, ny, collisionMask(direction)) : null);
  // Building tops are one-way platforms: lowest pixels landing on a structure cell with open (non-platform) space above it.
  const soles = new Map([-1, 1].map((direction) => {
    const keys = new Set(collisionMask(direction).map((pixel) => `${pixel.x},${pixel.y}`));
    return [direction, collisionMask(direction).filter((pixel) => !keys.has(`${pixel.x},${pixel.y + 1}`))];
  }));
  const platformContact = (nx, ny, direction = facing) => {
    if (!options.platformAt) return null;
    for (const pixel of soles.get(direction)) {
      const px = nx + pixel.x, py = ny + pixel.y;
      if (options.platformAt(px, py) && !options.platformAt(px, py - 1)) {
        return { x: px, y: py, material: world.at(px, py), reason: 'building platform', platform: true };
      }
    }
    return null;
  };
  const descend = (nx, ny) => contact(nx, ny) || platformContact(nx, ny);
  const leadingMasks = new Map();
  if (kind === 'hopper') for (const pose of [-1, 1]) for (const direction of [-1, 1]) {
    const mask = collisionMask(pose), keys = new Set(mask.map((pixel) => `${pixel.x},${pixel.y}`));
    leadingMasks.set(`${pose}:${direction}`, mask.filter((pixel) => !keys.has(`${pixel.x + direction},${pixel.y}`)));
  }
  function routeContact(direction, distance, lift = 0) {
    // Backing out need not turn a wide mirrored pose into the obstacle.
    const pose = contact(x, y, direction) ? facing : direction;
    const initial = contact(x, y, pose);
    if (initial) return initial;
    const mask = leadingMasks.get(`${pose}:${direction}`);
    for (let step = 1; step <= distance; step += 1) {
      const nx = x + step * direction, ny = y - Math.min(lift, step * 2);
      const hit = findPixelUnitContact(world, nx, ny, mask, true, options.ignoreMaterial) ||
        (options.collisionGroup ? options.collisionGroup.contact(options.ownerId, nx, ny, mask) : null);
      if (hit) return hit;
    }
    return null;
  }
  function jumpClear(direction) {
    for (let lift = 1; lift <= 18; lift += 1) {
      if (contact(x, y - lift, direction)) return false;
    }
    return true;
  }
  const support = () => {
    const hit = descend(x, y + 1);
    return Boolean(hit && (hit.platform || [PARTICLE_TERRAIN, PARTICLE_BARRIER, PARTICLE_WALL].includes(hit.material)));
  };
  // The hopper's mask is its whole jump envelope; resting on a ledge with only that envelope (feet in the air)
  // is a hang, not standing. Foot cells are the soles in the lowest quarter of the standing body.
  const footSoles = new Map([-1, 1].map((direction) => {
    const body = kind === 'hopper' ? artwork.frame('idle', 0, direction).pixels : collisionMask(direction);
    const top = Math.min(...body.map((p) => p.y)), bottom = Math.max(...collisionMask(direction).map((p) => p.y));
    const band = bottom - Math.ceil((Math.max(...body.map((p) => p.y)) - top + 1) * 0.25);
    return [direction, soles.get(direction).filter((p) => p.y > band)];
  }));
  const footSupported = () => footSoles.get(facing).some((p) => {
    const m = world.at(x + p.x, y + p.y + 1);
    return m === PARTICLE_TERRAIN || m === PARTICLE_BARRIER || m === PARTICLE_WALL || (options.platformAt && options.platformAt(x + p.x, y + p.y + 1));
  });
  // Slide one pixel off the ledge an envelope is hung on, so gravity can take over.
  function slipOffHang() {
    const hit = descend(x, y + 1);
    if (!hit) return false;
    const mask = collisionMask(), mid = (Math.min(...mask.map((p) => p.x)) + Math.max(...mask.map((p) => p.x))) / 2;
    for (const dx of hit.x >= x + mid ? [-1, 1] : [1, -1]) if (!contact(x + dx, y)) { x += dx; return true; }
    return false;
  }
  let aimBottom = -1;
  if (kind === 'tank') {
    const poses = Array.from({ length: artwork.frameCount('aim') }, (_, index) =>
      new Map(artwork.frame('aim', index, facing).pixels.map((pixel) =>
        [pixel.y * artwork.width + pixel.x, pixel.details ? JSON.stringify(pixel.details) : pixel.color])));
    const keys = new Set(poses.flatMap((pose) => [...pose.keys()]));
    for (const key of keys) if (poses.some((pose) => pose.get(key) !== poses[0].get(key))) {
      aimBottom = Math.max(aimBottom, Math.floor(key / artwork.width));
    }
  }
  // Tank top part = hull deck (shared by every aim frame) + turret block + aim-dependent barrel.
  // A turret facing away from the hull swaps in the mirrored turret and barrel over the unchanged hull.
  const turretParts = new Map();
  let turretFacing = null, hatchOpen = false;
  if (kind === 'tank' && aimBottom >= 0) {
    for (const direction of [-1, 1]) {
      const frames = Array.from({ length: artwork.frameCount('aim') }, (_, index) =>
        artwork.frame('aim', index, direction).pixels.filter((pixel) => pixel.y <= aimBottom));
      const keyed = frames.map((pixels) => new Set(pixels.map((pixel) => pixel.y * artwork.width + pixel.x)));
      const common = frames[0].filter((pixel) => keyed.every((set) => set.has(pixel.y * artwork.width + pixel.x)));
      const rowCounts = new Map();
      for (const pixel of common) rowCounts.set(pixel.y, (rowCounts.get(pixel.y) || 0) + 1);
      const deckRow = Math.min(...[...rowCounts].filter(([, count]) => count > artwork.width / 2).map(([row]) => row));
      const deck = common.filter((pixel) => pixel.y >= deckRow), block = common.filter((pixel) => pixel.y < deckRow);
      const commonKeys = new Set(common.map((pixel) => pixel.y * artwork.width + pixel.x));
      const barrels = frames.map((pixels) => pixels.filter((pixel) => !commonKeys.has(pixel.y * artwork.width + pixel.x)));
      const angles = barrels.map((pixels, index) => {
        if (index === 0 || pixels.length < 2) return 0;
        const mx = pixels.reduce((sum, pixel) => sum + pixel.x, 0) / pixels.length;
        const my = pixels.reduce((sum, pixel) => sum + pixel.y, 0) / pixels.length;
        let sxy = 0, sxx = 0;
        for (const pixel of pixels) { sxy += (pixel.x - mx) * (pixel.y - my); sxx += (pixel.x - mx) ** 2; }
        return Math.max(0, Math.atan2(-sxy * direction, sxx));
      });
      for (let index = 1; index < angles.length; index += 1) angles[index] = Math.max(angles[index], angles[index - 1]);
      const tips = barrels.map((pixels, index) => {
        const tip = (pixels.length ? pixels : block).reduce((best, pixel) =>
          pixel.x * direction > best.x * direction || pixel.x === best.x && pixel.y < best.y ? pixel : best);
        return { x: tip.x + 0.5 + direction * Math.cos(angles[index]) * 1.5, y: tip.y + 0.5 - Math.sin(angles[index]) * 1.5 };
      });
      const blockLeft = Math.min(...block.map((pixel) => pixel.x)), blockRight = Math.max(...block.map((pixel) => pixel.x));
      const blockTop = Math.min(...block.map((pixel) => pixel.y));
      let gunner = [], hatchMuzzle = null;
      if (options.hatchArtwork) {
        const source = options.hatchArtwork.frame('walk', 0, direction).pixels;
        const top = Math.min(...source.map((pixel) => pixel.y)), bottom = Math.max(...source.map((pixel) => pixel.y));
        const upper = source.filter((pixel) => pixel.y <= top + Math.ceil((bottom - top) * 0.6));
        const upperBottom = Math.max(...upper.map((pixel) => pixel.y));
        const center = upper.reduce((sum, pixel) => sum + pixel.x, 0) / upper.length;
        const dx = Math.round((blockLeft + blockRight) / 2 - center), dy = blockTop - 1 - upperBottom;
        gunner = upper.map((pixel) => ({ ...pixel, x: pixel.x + dx, y: pixel.y + dy }))
          .filter((pixel) => pixel.x >= 0 && pixel.x < artwork.width && pixel.y >= 0);
        const head = Math.min(...gunner.map((pixel) => pixel.y));
        hatchMuzzle = { x: (blockLeft + blockRight) / 2 + 0.5 + direction * 3, y: head + 1.5 };
      }
      turretParts.set(direction, { deck, block, barrels, angles, tips, gunner, hatchMuzzle });
    }
  }
  const turret = () => turretFacing === null ? facing : turretFacing;
  for (const [direction, mask] of masks) {
    if (!turretParts.size) break;
    const extra = [...turretParts.get(-direction).block, ...turretParts.get(-direction).barrels.flat(),
      ...turretParts.get(1).gunner, ...turretParts.get(-1).gunner];
    masks.set(direction, [...new Map([...mask, ...extra].map(({ x, y }) => [y * artwork.width + x, { x, y }])).values()]);
  }
  const bodyPoses = new Map();
  function pixels() {
    if (kind === 'hopper' && transportPhase) {
      const role = animation === 'fall' ? 1 : 0;
      return carryPoses.get(facing)[role][Math.min(frame, carryPoses.get(facing)[role].length - 1)];
    }
    if (kind === 'jet' && animation === 'shoot') return jetBody.get(facing)[frame];
    if (kind === 'hopper' && animation === 'boost') return groundBoost.get(facing)[frame];
    if (kind === 'hopper' && animation === 'idle' && grounded) return groundWalk.get(facing)[frame];
    if (kind === 'hopper' && (animation === 'jump' || animation === 'fall' && !drowned && !killed)) {
      const pose = (animation === 'jump' ? jumpPoses : fallPoses).get(facing)[frame];
      const offset = Math.min(Math.round(takeoffLift * Math.max(0, 1 - jumpElapsed / 0.24)),
        artwork.footRow - 1 - Math.max(...pose.map((pixel) => pixel.y)));
      if (!offset) return pose;
      const key = `${animation}|${frame}|${facing}|lift${offset}`;
      let lifted = bodyPoses.get(key);
      if (!lifted) { lifted = pose.map((pixel) => ({ ...pixel, y: pixel.y + offset })); bodyPoses.set(key, lifted); }
      return lifted;
    }
    // Body (and tank aim) poses depend only on these selectors, so each composite is mirrored and merged once.
    const top = turret(), gunner = hatchOpen && turretParts.size;
    const key = `${animation}|${frame}|${facing}|${kind === 'tank' ? `${aim}|${top}|${gunner ? 1 : 0}` : ''}`;
    let composed = bodyPoses.get(key);
    if (!composed) {
      const body = artwork.frame(animation, frame, facing).pixels;
      if (kind !== 'tank' || aimBottom < 0) composed = body;
      else if (top === facing && !gunner) composed = [...body.filter((pixel) => pixel.y > aimBottom),
        ...artwork.frame('aim', aim, facing).pixels.filter((pixel) => pixel.y <= aimBottom)];
      else {
        const parts = turretParts.get(top);
        composed = [...new Map([...body.filter((pixel) => pixel.y > aimBottom), ...turretParts.get(facing).deck,
          ...parts.block, ...parts.barrels[aim], ...(gunner ? parts.gunner : [])]
          .map((pixel) => [pixel.y * artwork.width + pixel.x, pixel])).values()];
      }
      bodyPoses.set(key, composed);
    }
    return composed;
  }
  function submersion() {
    water = inspectPixelUnitWater(world, x, y, pixels());
    drowned = drowned || water.fullySubmerged;
  }
  const initial = contact(x, y);
  if (initial) throw new Error(`Vehicle spawn blocked by ${initial.reason} at (${initial.x}, ${initial.y})`);
  grounded = support(); submersion();
  if (drowned) state = grounded ? 'drowned on bottom' : 'drowned, sinking';
  else if (water.wet) state = grounded ? 'wading' : 'sinking';
  const approach = (value, target, amount) => value + Math.max(-amount, Math.min(amount, target - value));
  function waterAhead(direction, distance = 1) {
    if (!options.automated || kind === 'jet' || water.wet || !direction) return null;
    for (let step = 1; step <= distance; step += 1) {
      const edge = findPixelUnitWaterEdge(world, x + direction * step, y, collisionMask(), artwork.height);
      if (edge) return edge;
    }
    return null;
  }
  const unit = {
    input,
    setTurret(direction) {
      if (kind !== 'tank' || direction !== null && ![-1, 1].includes(direction)) throw new Error('Invalid tank turret facing');
      if (!killed && !drowned) turretFacing = direction;
    },
    setHatch(open) {
      if (kind !== 'tank' || typeof open !== 'boolean') throw new Error('Invalid tank hatch state');
      hatchOpen = open && Boolean(options.hatchArtwork);
    },
    setAim(index) {
      if (kind !== 'tank' || !Number.isInteger(index) || index < 0 || index >= artwork.frameCount('aim')) {
        throw new Error('Invalid tank aim frame');
      }
      if (!killed && !drowned) { aim = index; aimTime = 0; }
    },
    // Barrel geometry in world cells for a turret direction and aim frame (defaults: current pose).
    barrel(direction = turret(), aimIndex = aim) {
      if (kind !== 'tank' || !turretParts.size) return null;
      const parts = turretParts.get(direction), tip = parts.tips[aimIndex];
      return { direction, aim: aimIndex, elevation: parts.angles[aimIndex], angles: parts.angles.slice(),
        muzzle: { x: x + tip.x, y: y + tip.y } };
    },
    hatch() {
      if (kind !== 'tank' || !hatchOpen || !turretParts.size) return null;
      const muzzle = turretParts.get(turret()).hatchMuzzle;
      return { direction: turret(), muzzle: { x: x + muzzle.x, y: y + muzzle.y } };
    },
    canTransportPose(nx, ny) {
      if (![nx, ny].every(Number.isInteger)) throw new Error('Transport requires integer cell positions');
      return !contact(nx, ny) && !inspectPixelUnitWater(world, nx, ny, collisionMask()).wet;
    },
    transportStep(dx, dy, phase, motion = { vx: dx * 60, vy: dy * 60, offsetX: 0, offsetY: 0 }) {
      if (![dx, dy].every(Number.isInteger) || Math.abs(dx) > 1 || Math.abs(dy) > 1 ||
          !['approach', 'grip', 'lift', 'cross', 'land', 'carried'].includes(phase)) {
        throw new Error('Invalid swept transport step');
      }
      if (![motion.vx, motion.vy, motion.offsetX, motion.offsetY].every(Number.isFinite) || Math.abs(motion.offsetX) >= 1 ||
          Math.abs(motion.offsetY) >= 1) throw new Error('Invalid transport motion');
      if (killed || drowned || !unit.canTransportPose(x + dx, y + dy)) return false;
      // One continuous jump -> fall sequence: reach down, clench (jump 0-1), spring up (jump 2-3), then glide (fall).
      const next = kind === 'tank' ? 'move' : ['grip', 'lift'].includes(phase) ? 'jump' : 'fall';
      const firstFrame = kind === 'hopper' && phase === 'lift' ? 2 : 0;
      const lastFrame = kind === 'hopper' && phase === 'grip' ? 1 : artwork.frameCount(next) - 1;
      if (next !== animation || phase === 'lift' && transportPhase !== 'lift') {
        frame = Math.min(firstFrame, artwork.frameCount(next) - 1); animationTime = 0;
      }
      x += dx; y += dy; vx = motion.vx; vy = motion.vy; rx = 0; ry = 0;
      transportMotion = { ...motion };
      ticks += 1; moving = Boolean(vx || vy); grounded = kind === 'tank' && support(); transportPhase = phase;
      state = kind === 'tank' ? 'suspended beneath hopper feet' : `tank airlift: ${phase}`;
      animation = next;
      animationTime += 1000 / 60;
      while (frame < lastFrame && animationTime >= artwork.frame(animation, frame, facing).durationMs) {
        animationTime -= artwork.frame(animation, frame, facing).durationMs;
        frame += 1;
      }
      if (frame >= lastFrame) { frame = Math.min(frame, lastFrame); animationTime = 0; }
      if (kind === 'tank') { frame = 0; animationTime = 0; }
      submersion();
      if (options.collisionGroup && (!killed || options.collisionGroup.has(unit))) options.collisionGroup.sync(unit);
      return true;
    },
    releaseTransport() {
      transportPhase = null; animationTime = 0; frame = 0; rx = 0; ry = 0;
      transportMotion = { vx: 0, vy: 0, offsetX: 0, offsetY: 0 };
      animation = kind === 'tank' ? 'move' : 'fall';
    },
    kill() {
      killed = true; vx = 0; rx = 0; vy = Math.max(0, vy); boosted = false; boostTime = 0; slideTime = 0;
      Object.keys(input).forEach((key) => { input[key] = false; });
    },
    crash(hit) {
      if (kind !== 'jet' || killed || !options.buildingAt || !options.buildingAt(hit.x, hit.y) ||
          ![PARTICLE_BARRIER, PARTICLE_CONSTRUCTION, PARTICLE_WALL].includes(hit.material)) return false;
      const velocity = { vx, vy };
      unit.kill(); blocker = hit;
      if (options.onBuildingImpact) options.onBuildingImpact(hit, velocity);
      return true;
    },
    step(dt = 1 / 60) {
      if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new Error('Vehicle step requires a positive delta of at most 0.1 seconds');
      if (Object.values(input).some((value) => typeof value !== 'boolean')) throw new Error('Invalid vehicle movement input');
      ticks += 1; moving = false; blocker = contact(x, y);
      if (blocker) {
        unit.crash(blocker);
        state = killed ? 'crashed into building' : `overlapped by ${blocker.reason}`;
        vx = 0; vy = 0; rx = 0; ry = 0; return;
      }
      const startedGrounded = grounded;
      submersion(); grounded = vy >= 0 && support();
      if (kind === 'hopper' && grounded && !footSupported() && slipOffHang()) {
        grounded = support();
        if (!grounded) { state = 'slipping off a ledge'; slipTicks = 12; vy = Math.max(vy, 30); vx = 0; rx = 0; }
      }
      // Jump jets refill after a second (in total) on solid ground since the last charge was spent.
      if (kind === 'hopper') {
        if (grounded) groundedTime += dt;
        if (groundedTime >= 1) charges = 2;
      }
      let direction = drowned || killed ? 0 : Number(input.right) - Number(input.left);
      // While slipping off a ledge, don't drive back onto it.
      if (slipTicks > 0) { slipTicks -= 1; if (!grounded) direction = 0; }
      let jumpRequested = input.jump, boostRequested = input.boost;
      if (kind === 'hopper' && options.automated && !drowned && !killed) {
        const requested = direction;
        if ((!options.assault || backingOut) && direction && ticks < navigationUntil) direction = retreatDirection;
        if (ticks >= navigationUntil) backingOut = false;
        if (direction && (ticks >= nextNavigation || requested !== requestedDirection)) {
          nextNavigation = ticks + 6; requestedDirection = requested; routeBlocked = false;
          navigation = 'clear route';
          const ahead = routeContact(direction, Math.max(24, Math.ceil(Math.abs(vx) * 0.2)));
          if (ahead) {
            blocker = ahead;
            const reverse = -direction;
            if (options.assault) {
              navigation = `advancing toward base; ${ahead.reason} ahead`;
              // Navigation runs every 6 ticks, so pace jumps by elapsed time rather than a tick phase it may never hit.
              const clear = jumpClear(direction);
              // A jump that landed back where it launched hit a face too close to climb: back off for a run-up.
              const stalled = grounded && assaultJumpX !== null && Math.abs(x - assaultJumpX) <= 3 && ticks >= nextAssaultJump;
              if (grounded && assaultJumpX !== null && Math.abs(x - assaultJumpX) > 3) assaultJumpX = null;
              // An uncharged hop can't clear a wall; stand still so the jets refill first.
              jumpRequested = grounded && ticks >= nextAssaultJump && clear && charges > 0 && !stalled;
              if (jumpRequested) { nextAssaultJump = ticks + 60; assaultJumpX = x; }
              else if (grounded && clear && charges <= 0) navigation = 'recharging jump jets';
              boostRequested = false;
              const canBackOut = ticks >= navigationUntil && !routeContact(reverse, 12, 6) && !waterAhead(reverse);
              if (stalled && canBackOut) {
                direction = reverse; retreatDirection = reverse; navigationUntil = ticks + 36; backingOut = true;
                assaultJumpX = null; navigation = `taking a run-up at ${ahead.reason}`;
              } else if (stalled) assaultJumpX = null;
              // Under an overhang (a portal lintel, a ledge): back out into open sky before jumping.
              else if (grounded && !clear && canBackOut) {
                direction = reverse; retreatDirection = reverse; navigationUntil = ticks + 24; backingOut = true;
                navigation = `backing out from under ${ahead.reason}`;
              }
            } else if (ticks >= navigationUntil && !routeContact(reverse, 12) && !waterAhead(reverse)) {
              direction = reverse; retreatDirection = reverse; navigationUntil = ticks + 18;
              navigation = `backing away from ${ahead.reason}`;
            } else {
              direction = 0; navigation = `waiting: ${ahead.reason} blocks route`;
            }
            vx = 0; rx = 0; boosted = false; boostTime = 0; slideTime = 0;
            routeBlocked = !options.assault;
          } else if (ticks < navigationUntil) navigation = 'backing into clear space';
          routeDirection = direction;
        }
        if (direction) direction = routeDirection;
        if (routeBlocked) { jumpRequested = false; boostRequested = false; }
        if (jumpRequested && !jumpHeld && grounded && !jumpClear(direction || facing)) {
          jumpRequested = false; navigation = 'waiting for overhead jump clearance';
        }
      }
      if (direction && direction !== facing && kind !== 'jet' && !(kind === 'tank' && input.reverse)) {
        const hit = contact(x, y, direction);
        if (!hit) facing = direction; else blocker = hit;
      }
      boostTime = Math.max(0, boostTime - dt);
      if (boostTime < 1e-8) boostTime = 0;
      if (kind === 'hopper' && boosted && boostTime === 0) {
        coastDuration = airBoost ? 0.35 : 2; slideTime = coastDuration; boosted = false;
      }
      const edge = waterAhead(direction);
      if (edge) { blocker = edge; vx = 0; rx = 0; }
      const roadScale = kind === 'hopper' && jumpRequested && !jumpHeld ? 1 :
        pixelUnitGroundSpeedMultiplier(options, { x, y, width: artwork.width, footRow: artwork.footRow,
          ownerId: options.ownerId, grounded, vy, water, killed, drowned, kind });
      const movementScale = speedScale * roadScale;
      if (kind === 'tank') {
        // Reversing keeps the hull (and its armour) toward the enemy at a slower crawl.
        const gear = direction && direction !== facing && input.reverse ? 0.6 : 1;
        vx = approach(vx, edge || drowned || killed ? 0 : direction * 36 * gear * movementScale, 24 * movementScale * dt);
        vx = Math.max(-36 * movementScale, Math.min(36 * movementScale, vx));
        if (input.aimUp !== input.aimDown && !drowned && !killed) {
          aimTime += dt * 1000;
          if (aimTime + 1e-8 >= artwork.frame('aim', aim, facing).durationMs) {
            aim = Math.max(0, Math.min(artwork.frameCount('aim') - 1, aim + (input.aimUp ? 1 : -1)));
            aimTime = 0;
          }
        } else aimTime = 0;
      } else if (kind === 'hopper') {
        if (!drowned && !killed && !water.wet && !edge) {
          if (boostRequested && !boostHeld && charges > 0 && direction) {
            charges -= 1; groundedTime = 0; boosted = true; airBoost = !grounded; boostTime = burstDuration; slideTime = 0;
            vx = direction * burstSpeed * movementScale;
            if (grounded) { vy = 0; ry = 0; }
            frame = 0; animationTime = 0;
          } else if (jumpRequested && !jumpHeld && grounded &&
              waterAhead(direction, Math.ceil(48 * 128 / 90))?.material !== PARTICLE_WATER) {
            // A charged jump carries further; fall back to a short hop if that would land in water.
            const charged = charges > 0 && waterAhead(direction, Math.ceil(48 * 220 / 90))?.material !== PARTICLE_WATER;
            vy = charged ? -110 : -64; if (charged) { charges -= 1; groundedTime = 0; }
            grounded = false; glideTime = 2;
            jumpFrame = 0; jumpTime = 0;
            jumpElapsed = 0;
          }
        }
        if (slideTime > 0) {
          slideTime = Math.max(0, slideTime - dt);
          if (slideTime < 1e-8) slideTime = 0;
          vx = approach(vx, 0, burstSpeed * movementScale / coastDuration * dt);
          vx = Math.max(-burstSpeed * movementScale, Math.min(burstSpeed * movementScale, vx));
        }
        else if (boostTime === 0 && !boosted) vx = edge || drowned ? 0 :
          direction * (grounded && !jumpRequested ? 48 : 48 * forwardLunge) * movementScale;
      } else if (!drowned && !killed && !water.wet) {
        const vertical = Number(input.down) - Number(input.up);
        if (direction || vertical) {
          const target = Math.atan2(vertical, direction), difference = Math.atan2(Math.sin(target - heading), Math.cos(target - heading));
          heading += Math.max(-1.8 * dt, Math.min(1.8 * dt, difference));
        }
        vx = 64 * speedScale * Math.cos(heading); vy = 64 * speedScale * Math.sin(heading);
        const nextFacing = vx < 0 ? -1 : 1;
        if (!contact(x, y, nextFacing)) facing = nextFacing;
        grounded = false;
      } else if (kind === 'jet' && !drowned) {
        vx = direction * 64 * speedScale;
      }
      jumpHeld = jumpRequested; boostHeld = boostRequested;
      if (drowned) { vx = 0; rx = 0; }
      if (water.wet || drowned || killed || kind !== 'jet') {
        if (!grounded || vy < 0) {
          const gliding = kind === 'hopper' && !water.wet && !drowned && !killed && input.glide && vy > 0 && glideTime > 0;
          if (gliding) { glideTime = Math.max(0, glideTime - dt); vy = Math.min(vy, 10); }
          else vy = Math.min(90, vy + 90 * dt);
        } else vy = 0;
      }
      const debrisDrag = Math.min(pixelUnitDebrisDrag(world, x, y, collisionMask()),
        pixelUnitDebrisDrag(world, x + Math.sign(vx), y, collisionMask()));
      if (debrisDrag < 1 && kind === 'hopper') { boosted = false; boostTime = 0; slideTime = 0; }
      rx += vx * debrisDrag * (water.wet ? 0.5 : 1) * dt;
      while (Math.abs(rx) + 1e-10 >= 1) {
        const dx = Math.sign(rx);
        let hit = contact(x + dx, y), rise = 0;
        const shore = waterAhead(dx);
        if (shore) hit = shore;
        if (hit && grounded && [PARTICLE_TERRAIN, PARTICLE_BARRIER, PARTICLE_WALL].includes(hit.material) && (kind === 'tank' || kind === 'hopper')) {
          for (let step = 1; step <= 2; step += 1) {
            if (contact(x, y - step)) break;
            if (!contact(x + dx, y - step)) { hit = null; rise = step; break; }
          }
        }
        if (hit) { unit.crash(hit); blocker = hit; vx = 0; rx = 0; break; }
        x += dx; y -= rise; rx -= dx; moving = true;
        submersion();
        if (drowned) { vx = 0; rx = 0; break; }
        grounded = vy < 0 || kind === 'jet' && !water.wet ? false : support();
      }
      if (!moving && vx !== 0 && !drowned) {
        const dx = Math.sign(vx);
        let hit = waterAhead(dx) || contact(x + dx, y);
        if (hit && grounded && (kind === 'tank' || kind === 'hopper') && [PARTICLE_TERRAIN, PARTICLE_BARRIER, PARTICLE_WALL].includes(hit.material)) {
          for (let rise = 1; rise <= 2; rise += 1) {
            if (contact(x, y - rise)) break;
            if (!contact(x + dx, y - rise)) { hit = null; break; }
          }
        }
        if (hit) { unit.crash(hit); blocker = hit; vx = 0; rx = 0; }
        else moving = true;
      }
      ry += vy * dt;
      while (Math.abs(ry) + 1e-10 >= 1) {
        const dy = Math.sign(ry), hit = dy > 0 ? descend(x, y + dy) : contact(x, y + dy);
        if (hit) {
          if (!hit.platform) unit.crash(hit);
          grounded = dy > 0 && (hit.platform || [PARTICLE_TERRAIN, PARTICLE_BARRIER, PARTICLE_WALL].includes(hit.material));
          if (!grounded) blocker = hit;
          vy = 0; ry = 0; break;
        }
        y += dy; ry -= dy; moving = true; submersion();
      }
      grounded = vy >= 0 && !(kind === 'jet' && !water.wet && !drowned && !killed) && support();
      if (kind === 'hopper' && !grounded) {
        if (startedGrounded && !Number.isFinite(jumpElapsed)) jumpElapsed = 0;
        if (Number.isFinite(jumpElapsed)) jumpElapsed += dt;
      }
      const next = kind === 'tank' ? 'move' : kind === 'jet' ? drowned || killed ? 'down' : input.shoot ? 'shoot' : 'fly' :
        drowned ? 'fall' : boostTime > 0 || slideTime > 0 && grounded && !airBoost ? 'boost' :
          !grounded ? vy < 0 ? 'jump' : 'fall' : 'idle';
      if (next !== animation) { animation = next; frame = 0; animationTime = 0; }
      if (kind === 'hopper' && animation === 'jump') {
        jumpTime += dt * 1000;
        while (jumpFrame < artwork.frameCount('jump') - 1 &&
            jumpTime + 1e-8 >= artwork.frame('jump', jumpFrame, facing).durationMs) {
          jumpTime -= artwork.frame('jump', jumpFrame, facing).durationMs; jumpFrame += 1;
        }
        if (jumpFrame === artwork.frameCount('jump') - 1) jumpTime = 0;
        frame = jumpFrame; animationTime = 0;
      } else if (kind === 'hopper' && animation === 'boost') {
        if (slideTime > 0) { frame = artwork.frameCount('boost') - 1; animationTime = 0; }
        else {
          animationTime += dt * 1000 * boostAnimationRate;
          while (frame < artwork.frameCount('boost') - 1 &&
              animationTime + 1e-8 >= artwork.frame('boost', frame, facing).durationMs) {
            animationTime -= artwork.frame('boost', frame, facing).durationMs; frame += 1;
          }
        }
      } else if (kind === 'jet' || moving || drowned || killed || kind === 'hopper' && !grounded) {
        animationTime += dt * 1000 * (kind === 'tank' ? treadRate : 1);
        // Reversing tanks roll their tread frames backward.
        const backward = kind === 'tank' && !drowned && !killed && vx * facing < 0;
        while (animationTime + 1e-8 >= artwork.frame(animation, frame, facing).durationMs) {
          animationTime -= artwork.frame(animation, frame, facing).durationMs;
          if (drowned || killed) frame = Math.min(frame + 1, artwork.frameCount(animation) - 1);
          else frame = (frame + (backward ? artwork.frameCount(animation) - 1 : 1)) % artwork.frameCount(animation);
          if ((drowned || killed) && frame === artwork.frameCount(animation) - 1) { animationTime = 0; break; }
        }
      } else { frame = 0; animationTime = 0; }
      if (kind === 'hopper' && grounded) { jumpFrame = 0; jumpTime = 0; jumpElapsed = Infinity; }
      submersion();
      state = killed ? grounded ? 'destroyed on ground' : 'destroyed, falling' :
        drowned ? grounded ? 'drowned on bottom' : 'drowned, sinking' :
        blocker && blocker.reason === 'water edge' ? 'waiting at water edge' :
        blocker ? `blocked by ${blocker.reason}` : water.wet ? grounded ? 'wading' : 'sinking' :
        kind === 'tank' ? moving ? 'rolling' : 'ready' : kind === 'jet' ? 'flying arc' :
        boostTime > 0 ? grounded ? 'ground boosting' : 'air boosting' : slideTime > 0 && grounded ? 'coasting' :
          !grounded ? vy < 0 ? 'hopping' : input.glide && glideTime > 0 ? 'gliding' : 'falling' :
          moving ? 'walking' : 'ready';
      if (options.collisionGroup && (!killed || options.collisionGroup.has(unit))) options.collisionGroup.sync(unit);
    },
    inspect(inspection = {}) {
      return { x, y, facing, vx, vy, grounded, moving, ticks, state, drowned, killed, water: { ...water }, kind,
        navigation, transportPhase, carryFrame: kind === 'hopper' && transportPhase ? frame : null,
        renderX: x + (transportPhase ? Math.round(transportMotion.offsetX * 4) / 4 : 0),
        renderY: y + (transportPhase ? Math.round(transportMotion.offsetY * 4) / 4 : 0),
        heading, charges, boostTime, glideTime, slideTime, aim, aimBottom, animation, frame,
        turret: kind === 'tank' ? turret() : null, hatch: kind === 'tank' && hatchOpen && turretParts.size > 0,
        reversing: kind === 'tank' && vx * facing < -1e-6,
        ...(inspection.sprites === false ? {} : { pixels: pixels() }),
        collision: collisionMask().map((pixel) => ({ ...pixel })), blocker: blocker ? { ...blocker } : null,
        width: artwork.width, height: artwork.height,
        footRow: artwork.footRow, tintColor: artwork.tintColor, automated: Boolean(options.automated), ownerId: options.ownerId,
        previewPixels: kind === 'jet' && animation === 'shoot' ? jetPreview.get(facing)[frame] : [],
        mode: 'lab-only-kinematic', material: false };
    },
  };
  if (options.collisionGroup) options.collisionGroup.register(unit, options.ownerId);
  return unit;
}

const PIXEL_AIRLIFT_ENGAGEMENT = Object.freeze({ horizontal: 260, vertical: 160 });

function createPixelTankAirlift(world, units, combat, directionFor, options = {}) {
  if (!world || !Array.isArray(units) || !combat || typeof directionFor !== 'function') throw new Error('Invalid tank airlift world');
  const combatActive = typeof options.combatActive === 'function' ? options.combatActive : () => true;
  const flights = [], events = [];
  let ticks = 0, pickups = 0, deliveries = 0, losses = 0;
  const live = (entry) => units.includes(entry) && combat.health(entry.id).health > 0 &&
    !entry.unit.inspect({ sprites: false }).killed && !entry.unit.inspect({ sprites: false }).drowned;
  // A mech is fighting while combat is enabled and a live hostile ground unit or mech is inside its engagement envelope.
  const fighting = (hopper) => {
    if (!combatActive()) return false;
    const h = hopper.unit.inspect({ sprites: false }), hx = h.x + h.width / 2, hy = h.y + h.height / 2;
    return units.some((other) => other.owner !== hopper.owner && other.kind !== 'jet' && live(other) && (() => {
      const o = other.unit.inspect({ sprites: false });
      return Math.abs(o.x + o.width / 2 - hx) <= PIXEL_AIRLIFT_ENGAGEMENT.horizontal &&
        Math.abs(o.y + o.height / 2 - hy) <= PIXEL_AIRLIFT_ENGAGEMENT.vertical;
    })());
  };
  function event(flight, reason) {
    events.push({ tick: ticks, hopperId: flight.hopper.id, tankId: flight.tank.id, reason });
    if (events.length > 64) events.shift();
  }
  function waterColumn(x, feet) {
    if (x < 0 || x >= world.width) return null;
    for (let y = Math.max(0, feet - 64); y < Math.min(world.height, feet + 128); y += 1) {
      const material = world.at(x, y);
      if (material === PARTICLE_TERRAIN) return null;
      if (material === PARTICLE_WATER) return y;
    }
    return null;
  }
  function crossing(tank) {
    const s = tank.unit.inspect({ sprites: false }), direction = directionFor(tank);
    if (!s.grounded || s.water.wet || ![-1, 1].includes(direction)) return null;
    const feet = s.y + s.footRow, edge = direction > 0 ? s.x + s.width : s.x - 1;
    let start = null;
    for (let distance = 0; distance <= 96; distance += 1) {
      const x = edge + direction * distance, water = waterColumn(x, feet);
      if (water !== null) { start = { x, water }; break; }
    }
    if (!start) return null;
    for (let distance = 1; distance < world.width; distance += 1) {
      const x = start.x + direction * distance;
      if (x < 0 || x >= world.width) return null;
      if (waterColumn(x, feet) === null) return { direction, bank: x, water: start.water };
    }
    return null;
  }
  function landing(tank, hopper, route) {
    const t = tank.unit.inspect({ sprites: false }), h = hopper.unit.inspect({ sprites: false });
    const minY = Math.min(...t.collision.map((pixel) => pixel.y));
    for (let gap = Math.ceil(h.width / 2) + 4; gap <= Math.ceil(h.width / 2) + 132; gap += 4) {
      const x = route.bank + route.direction * gap - (route.direction < 0 ? t.width : 0);
      if (x < 0 || x + t.width >= world.width) continue;
      let ground = world.height;
      for (let dx = 0; dx < t.width; dx += 1) for (let y = 0; y < ground; y += 1) {
        const material = world.at(x + dx, y);
        if (material === PARTICLE_WATER) { ground = -1; break; }
        if (material === PARTICLE_TERRAIN) { ground = y; break; }
      }
      if (ground < 1 || ground === world.height) continue;
      const y = ground - t.footRow, hx = x - Math.floor((h.width - t.width) / 2), hy = y + minY - h.footRow;
      if (!tank.unit.canTransportPose(x, y) || !hopper.unit.canTransportPose(hx, hy)) continue;
      const support = findPixelUnitContact(world, x, y + 1, t.collision, true);
      if (!support || support.material !== PARTICLE_TERRAIN) continue;
      return { x, y, hx, hy, offsetX: x - hx, offsetY: y - hy };
    }
    return null;
  }
  function finish(flight, delivered) {
    for (const entry of [flight.hopper, flight.tank]) {
      entry.unit.releaseTransport(); entry.airlift = null;
    }
    flight.tank.airliftStatus = delivered ? '' : 'Airlift interrupted; ground physics resumed';
    if (delivered) { deliveries += 1; event(flight, 'landed tank safely on far bank'); }
    else { losses += 1; event(flight, 'airlift interrupted; surviving payload falls under gravity'); }
    flights.splice(flights.indexOf(flight), 1);
  }
  const api = {
    needsCarrier(owner) {
      return !units.some((entry) => entry.owner === owner && entry.kind === 'hopper' && live(entry)) &&
        units.some((entry) => entry.owner === owner && entry.kind === 'tank' && live(entry) && crossing(entry));
    },
    step() {
      ticks += 1;
      if (ticks % 30 === 1) for (const tank of units) {
        if (tank.kind !== 'tank' || tank.airlift || !live(tank)) continue;
        const route = crossing(tank);
        if (!route) continue;
        const candidates = units.filter((entry) => entry.kind === 'hopper' && entry.owner === tank.owner &&
          !entry.airlift && live(entry));
        const hopper = candidates.filter((entry) => !fighting(entry)).sort((a, b) =>
            Math.abs(a.unit.inspect().x - tank.unit.inspect().x) - Math.abs(b.unit.inspect().x - tank.unit.inspect().x))[0];
        if (!hopper) {
          tank.airliftStatus = candidates.length ? 'Airlift waiting: friendly hoppers are fighting' :
            'Waiting for a friendly hopper to cross water';
          continue;
        }
        const destination = landing(tank, hopper, route);
        if (!destination) { tank.airliftStatus = 'Airlift waiting: no clear supported far-bank landing'; continue; }
        const t = tank.unit.inspect(), h = hopper.unit.inspect();
        const cruiseY = Math.min(t.y, destination.y, route.water - t.footRow) - 24 - destination.offsetY;
        const lane = route.direction < 0 ? Math.min(Math.max(0, cruiseY - 8),
          h.height + t.height - Math.min(...t.collision.map((pixel) => pixel.y)) + 48) : 0;
        const flight = { tank, hopper, destination, phase: 'approach', hold: 0, attached: false,
          pickupX: t.x - destination.offsetX, pickupY: t.y - destination.offsetY,
          cruiseY: cruiseY - lane, vx: 0, vy: 0, rx: 0, ry: 0, climbTarget: null };
        if (flight.cruiseY < 1) { tank.airliftStatus = 'Airlift waiting: insufficient sky clearance for loaded flight'; continue; }
        if (Math.abs(h.x - t.x) > 600) { tank.airliftStatus = 'Airlift waiting: friendly hopper is out of pickup range'; continue; }
        tank.airlift = { role: 'payload', partnerId: hopper.id };
        hopper.airlift = { role: 'carrier', partnerId: tank.id };
        flights.push(flight); event(flight, 'approaching tank for foot pickup');
      }
      const managed = new Set();
      for (const flight of [...flights]) {
        if (!live(flight.hopper) || !live(flight.tank)) { finish(flight, false); continue; }
        if (!flight.attached && fighting(flight.hopper)) {
          // Not yet gripped: the mech breaks off to fight and the tank stays on the ground.
          for (const entry of [flight.hopper, flight.tank]) { entry.unit.releaseTransport(); entry.airlift = null; }
          flight.tank.airliftStatus = 'Airlift waiting: friendly hoppers are fighting';
          event(flight, 'pickup called off: hopper engaged in combat');
          flights.splice(flights.indexOf(flight), 1); continue;
        }
        const { hopper, tank, destination } = flight;
        managed.add(hopper); managed.add(tank);
        const h = hopper.unit.inspect({ sprites: false });
        const arrived = (x, y) => h.x === x && h.y === y && Math.abs(flight.rx) < 1e-8 && Math.abs(flight.ry) < 1e-8;
        let targetX = h.x, targetY = h.y;
        if (flight.phase === 'approach') {
          if (h.y > flight.pickupY || flight.ry < 0) targetY = flight.pickupY;
          else if (h.x !== flight.pickupX || flight.rx) targetX = flight.pickupX;
          else if (!arrived(flight.pickupX, flight.pickupY)) targetY = flight.pickupY;
          else { flight.phase = 'grip'; flight.hold = 12; }
        } else if (flight.phase === 'grip') {
          if (--flight.hold <= 0) {
            flight.phase = 'lift'; flight.attached = true; pickups += 1; event(flight, 'tank gripped by hopper feet');
          }
        } else if (flight.phase === 'lift') {
          if (!arrived(h.x, flight.cruiseY)) targetY = flight.cruiseY;
          else flight.phase = 'cross';
        } else if (flight.phase === 'cross') {
          if (flight.climbTarget !== null) {
            targetY = flight.climbTarget;
            if (arrived(h.x, targetY)) flight.climbTarget = null;
          } else if (!arrived(destination.hx, h.y)) targetX = destination.hx;
          else flight.phase = 'land';
        } else {
          // Touch down as soon as the payload rests on dry terrain; the bank may have shifted since planning.
          const t = tank.unit.inspect({ sprites: false });
          const supported = findPixelUnitContact(world, t.x, t.y + 1, t.collision, true);
          if (supported && supported.material === PARTICLE_TERRAIN && !t.water.wet) {
            finish(flight, true); continue;
          }
          if (!arrived(h.x, destination.hy)) targetY = destination.hy;
        }
        const payload = flight.attached ? tank.unit.inspect({ sprites: false }) : null;
        const canMove = (mx, my) => hopper.unit.canTransportPose(h.x + mx, h.y + my) &&
          (!payload || tank.unit.canTransportPose(payload.x + mx, payload.y + my));
        const accelerate = (velocity, distance) => {
          const desired = Math.sign(distance) * Math.min(60, Math.sqrt(360 * Math.abs(distance)));
          return velocity + Math.max(-3, Math.min(3, desired - velocity));
        };
        const distanceX = targetX - h.x - flight.rx, distanceY = targetY - h.y - flight.ry;
        flight.vx = accelerate(flight.vx, distanceX); flight.vy = accelerate(flight.vy, distanceY);
        const travel = (velocity, distance) => Math.sign(velocity) === Math.sign(distance) ?
          Math.sign(distance) * Math.min(Math.abs(distance), Math.abs(velocity) / 60) : 0;
        flight.rx += travel(flight.vx, distanceX); flight.ry += travel(flight.vy, distanceY);
        let dx = Math.trunc(flight.rx + Math.sign(flight.rx) * 1e-10);
        let dy = Math.trunc(flight.ry + Math.sign(flight.ry) * 1e-10);
        if (!canMove(Math.sign(flight.rx), Math.sign(flight.ry))) {
          if (flight.phase === 'cross' && flight.climbTarget === null && h.y > 1 && canMove(0, -1)) {
            flight.climbTarget = Math.max(1, h.y - 12);
          }
          dx = 0; dy = 0; flight.vx = 0; flight.vy = 0; flight.rx = 0; flight.ry = 0;
          tank.airliftStatus = `Airlift waiting: ${flight.phase} clearance blocked`;
        } else tank.airliftStatus = `Hopper airlift: ${flight.phase}`;
        flight.rx -= dx; flight.ry -= dy;
        if (Math.abs(flight.rx) < 1e-8) flight.rx = 0;
        if (Math.abs(flight.ry) < 1e-8) flight.ry = 0;
        hopper.tactic = tank.airliftStatus; tank.tactic = tank.airliftStatus;
        hopper.airlift.phase = flight.phase; tank.airlift.phase = flight.phase;
        if (canMove(dx, dy)) {
          const motion = { vx: flight.vx, vy: flight.vy, offsetX: flight.rx, offsetY: flight.ry };
          if (!hopper.unit.transportStep(dx, dy, flight.phase, motion)) throw new Error('Validated hopper transport move failed');
          if (!tank.unit.transportStep(flight.attached ? dx : 0, flight.attached ? dy : 0, 'carried',
              flight.attached ? motion : { vx: 0, vy: 0, offsetX: 0, offsetY: 0 })) {
            // The payload was destroyed or wedged mid-step: release it to ground physics rather than tearing it free.
            finish(flight, false); continue;
          }
        }
      }
      return managed;
    },
    inspect() { return { pickups, deliveries, losses, active: flights.length, events: events.map((entry) => ({ ...entry })) }; },
  };
  return api;
}

function createPixelProjectileArtwork(reference) {
  const bullet = createPixelUnitArtwork(reference, { roles: ['fly'], allowEmptyFrames: true });
  return {
    frameCount: bullet.frameCount('fly'),
    frame(index, facing, kind = 'bullet') {
      if (!['bullet', 'missile'].includes(kind)) throw new Error('Invalid projectile preview kind');
      const source = bullet.frame('fly', index, facing);
      const pixels = kind === 'bullet' ? source.pixels : source.pixels.flatMap((pixel) =>
        Array.from({ length: 6 }, (_, offset) => ({ x: pixel.x * 3 + offset % 3, y: pixel.y * 2 + Math.floor(offset / 3), color: pixel.color })));
      return { ...source, pixels, width: bullet.width * (kind === 'missile' ? 3 : 1),
        height: bullet.height * (kind === 'missile' ? 2 : 1), tintColor: null };
    },
  };
}
