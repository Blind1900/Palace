// A breakable frame of thin structural members, not a structural engineering simulation.
function createCollapseModel(options = {}) {
  if (options.optimizeSupportSearch !== undefined && typeof options.optimizeSupportSearch !== 'boolean') {
    throw new Error('Invalid support search option');
  }
  if (options.optimizeCollisionSearch !== undefined && typeof options.optimizeCollisionSearch !== 'boolean') {
    throw new Error('Invalid collision search option');
  }
  if (options.experimentalImpactSpin !== undefined && typeof options.experimentalImpactSpin !== 'boolean') {
    throw new Error('Invalid impact spin option');
  }
  const optimizeSupportSearch = options.optimizeSupportSearch !== false;
  const optimizeCollisionSearch = options.optimizeCollisionSearch === true;
  const columns = options.columns === undefined ? 7 : options.columns;
  const rows = options.rows === undefined ? 9 : options.rows;
  const size = options.size === undefined ? 26 : options.size;
  const left = options.left === undefined ? 229 : options.left;
  const surfaceGrid = options.surfaceGrid;
  if (surfaceGrid !== undefined && (!surfaceGrid || !Number.isFinite(surfaceGrid.cellSize) ||
      surfaceGrid.cellSize <= 0 || typeof surfaceGrid.heightAt !== 'function')) {
    throw new Error('Invalid terrain surface grid');
  }
  const terrain = options.terrain || 'flat';
  const terrainSlopes = { flat: 0, 'uphill-right': -0.12, 'downhill-right': 0.12 };
  if (!Object.prototype.hasOwnProperty.call(terrainSlopes, terrain) && terrain !== 'valley') {
    throw new Error('Invalid terrain profile');
  }
  const nominalGround = options.ground === undefined ? 310 : options.ground;
  function surfaceAt(x) {
    if (surfaceGrid) {
      const height = surfaceGrid.heightAt(Math.floor(x / surfaceGrid.cellSize));
      if (!Number.isFinite(height)) throw new Error('Invalid terrain surface height');
      return height;
    }
    if (terrain === 'valley') return nominalGround - Math.abs(x - (left + columns * size / 2)) * 0.12;
    return nominalGround + terrainSlopes[terrain] * (x - (left + columns * size / 2));
  }
  const ground = surfaceGrid ? nominalGround : Math.min(surfaceAt(left), surfaceAt(left + columns * size));
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1 ||
      !Number.isFinite(size) || size <= 0 || !Number.isFinite(left) || !Number.isFinite(ground)) {
    throw new Error('Invalid building dimensions');
  }
  const sections = [];
  const fragments = [];
  const bonds = [];
  const grid = new Map();
  let repairProgress = 0;
  const loadEnabled = options.loadEnabled === true;
  const capacityFactor = options.capacityFactor === undefined ? 1.3 : options.capacityFactor;
  if (!Number.isFinite(capacityFactor) || capacityFactor <= 0) throw new Error('Invalid capacity factor');
  const key = (row, column) => `${row}:${column}`;
  const isPole = (column) => column === 0 || column === columns - 1 ||
    (columns > 4 && column === Math.floor((columns - 1) / 2));
  const isFloor = (row) => row === 0 || row === rows - 1 || row % 3 === 0;
  const wallStrength = 1 + Math.min(1, Math.max(0, rows - 9) * 0.5);
  const minimumWallThicknessFactor = options.minimumWallThicknessFactor === undefined
    ? 1 : options.minimumWallThicknessFactor;
  if (!Number.isFinite(minimumWallThicknessFactor) || minimumWallThicknessFactor < 1) {
    throw new Error('Invalid wall thickness factor');
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!isPole(column) && !isFloor(row)) continue;
      if (options.openGround && row === rows - 1 && !isPole(column)) continue;
      const x = left + column * size;
      const y = ground - (rows - row) * size;
      const section = { row, column, x, y, previousX: x, previousY: y,
        horizontal: isFloor(row), vertical: isPole(column),
        vx: 0, vy: 0, angle: 0, previousAngle: 0, angularVelocity: 0, impactSpeed: 0,
        health: 100, attached: true, anchored: row === rows - 1 && isPole(column),
        settled: false, cleared: false };
      sections.push(section);
      grid.set(key(row, column), section);
    }
  }
  for (const section of sections) {
    for (const [row, column] of [[section.row, section.column + 1], [section.row + 1, section.column]]) {
      const neighbor = grid.get(key(row, column));
      if (neighbor) bonds.push({ a: section, b: neighbor, dx: neighbor.x - section.x,
        dy: neighbor.y - section.y, active: true, stress: 0 });
    }
  }
  const repairCost = Math.max(1, Math.round(sections.length / 30));

  function detach(section) {
    if (!section.attached) return;
    section.attached = false;
    section.anchored = false;
    fragments.push(section);
    for (const bond of bonds) if (bond.a === section || bond.b === section) bond.active = false;
  }

  function detachUnsupported() {
    const supported = new Set(sections.filter((section) => section.attached && section.anchored));
    const queue = Array.from(supported);
    for (let i = 0; i < queue.length; i += 1) {
      for (const bond of bonds) {
        if (!bond.active) continue;
        const next = bond.a === queue[i] ? bond.b : bond.b === queue[i] ? bond.a : null;
        if (next && next.attached && !supported.has(next)) {
          supported.add(next);
          queue.push(next);
        }
      }
    }
    for (const section of sections) if (section.attached && !supported.has(section)) detach(section);
  }

  function weight(section) { return section.anchored ? 0 : 1; }

  const thickness = Math.max(1, size * 0.08);
  const wallThickness = thickness * Math.max(wallStrength, minimumWallThicknessFactor);
  const supportExtent = Math.hypot(size, wallThickness) / 2;

  function shapes(section, angle = section.angle, x = section.x, y = section.y) {
    const result = [];
    if (section.horizontal) result.push({ x: x + size / 2, y: y + size / 2, w: size, h: thickness, angle });
    if (section.vertical) result.push({ x: x + size / 2, y: y + size / 2, w: wallThickness, h: size, angle });
    return result;
  }

  function boundsOf(shape) {
    const c = Math.abs(Math.cos(shape.angle)), s = Math.abs(Math.sin(shape.angle));
    const halfWidth = (shape.w * c + shape.h * s) / 2;
    const halfHeight = (shape.w * s + shape.h * c) / 2;
    return { left: shape.x - halfWidth, right: shape.x + halfWidth,
      top: shape.y - halfHeight, bottom: shape.y + halfHeight };
  }

  function sectionBounds(section, angle = section.angle) {
    const bounds = shapes(section, angle).map(boundsOf);
    return { left: Math.min(...bounds.map((b) => b.left)), right: Math.max(...bounds.map((b) => b.right)),
      top: Math.min(...bounds.map((b) => b.top)), bottom: Math.max(...bounds.map((b) => b.bottom)) };
  }

  function groundPenetration(section, angle = section.angle) {
    if (surfaceGrid) {
      let penetration = -Infinity;
      for (const shape of shapes(section, angle)) {
        const c = Math.cos(shape.angle), s = Math.sin(shape.angle);
        const corners = [[-shape.w / 2, -shape.h / 2], [shape.w / 2, -shape.h / 2],
          [shape.w / 2, shape.h / 2], [-shape.w / 2, shape.h / 2]]
          .map(([x, y]) => ({ x: shape.x + x * c - y * s, y: shape.y + x * s + y * c }));
        const bounds = boundsOf(shape);
        const first = Math.floor(bounds.left / surfaceGrid.cellSize);
        const last = Math.floor((bounds.right - 1e-9) / surfaceGrid.cellSize);
        for (let column = first; column <= last; column += 1) {
          const leftEdge = column * surfaceGrid.cellSize;
          const rightEdge = leftEdge + surfaceGrid.cellSize;
          const heights = corners.filter((point) => point.x >= leftEdge && point.x <= rightEdge)
            .map((point) => point.y);
          for (let i = 0; i < corners.length; i += 1) {
            const a = corners[i], b = corners[(i + 1) % corners.length];
            for (const edge of [leftEdge, rightEdge]) {
              if ((a.x < edge && b.x > edge) || (b.x < edge && a.x > edge)) {
                heights.push(a.y + (b.y - a.y) * (edge - a.x) / (b.x - a.x));
              }
            }
          }
          if (heights.length) {
            const height = surfaceGrid.heightAt(column);
            if (!Number.isFinite(height)) throw new Error('Invalid terrain surface height');
            penetration = Math.max(penetration, Math.max(...heights) - height);
          }
        }
      }
      return penetration;
    }
    if (terrain === 'flat') return sectionBounds(section, angle).bottom - ground;
    let penetration = -Infinity;
    for (const shape of shapes(section, angle)) {
      const c = Math.cos(shape.angle), s = Math.sin(shape.angle);
      const steps = Math.max(1, Math.ceil(shape.w / 4));
      for (let i = 0; i <= steps; i += 1) {
        const along = -shape.w / 2 + shape.w * i / steps;
        for (const side of [-shape.h / 2, shape.h / 2]) {
          const x = shape.x + along * c - side * s;
          const y = shape.y + along * s + side * c;
          penetration = Math.max(penetration, y - surfaceAt(x));
        }
      }
    }
    return penetration;
  }

  function applyStructuralLoad(dt) {
    if (!loadEnabled) return;
    const poleCount = Array.from({ length: columns }, (_, column) => isPole(column)).filter(Boolean).length;
    const capacity = sections.length / poleCount * capacityFactor;
    const failures = [];
    for (let row = 0; row < rows; row += 1) {
      const supports = sections.filter((section) => section.row === row && section.vertical && section.attached);
      if (!supports.length) continue;
      const load = sections.filter((section) => section.attached && section.row <= row).length / supports.length;
      for (const support of supports) {
        const remainingCapacity = capacity * wallStrength *
          Math.max(0, support.health) / 100;
        if (load > remainingCapacity) {
          support.health -= 120 * dt * (load / Math.max(remainingCapacity, 1) - 1);
          if (support.health <= 0) failures.push(support);
        }
      }
    }
    for (const section of failures) detach(section);
    if (failures.length) detachUnsupported();
  }

  function overlap(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let best = null;
    for (const axis of [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]) {
      const nx = Math.cos(axis), ny = Math.sin(axis);
      const projection = dx * nx + dy * ny;
      const radius = (a.w * Math.abs(Math.cos(a.angle - axis)) + a.h * Math.abs(Math.sin(a.angle - axis)) +
        b.w * Math.abs(Math.cos(b.angle - axis)) + b.h * Math.abs(Math.sin(b.angle - axis))) / 2;
      const depth = radius - Math.abs(projection);
      if (depth <= 0.001) return null;
      if (!best || depth < best.depth) best = { x: nx * (projection < 0 ? -1 : 1), y: ny * (projection < 0 ? -1 : 1), depth };
    }
    return best;
  }

  function sectionOverlap(a, b, angleA = a.angle, angleB = b.angle) {
    if (a.cleared || b.cleared) return null;
    if (Math.abs(a.x - b.x) > size * Math.SQRT2 || Math.abs(a.y - b.y) > size * Math.SQRT2) return null;
    const boundsA = sectionBounds(a, angleA), boundsB = sectionBounds(b, angleB);
    if (boundsA.right <= boundsB.left || boundsB.right <= boundsA.left ||
        boundsA.bottom <= boundsB.top || boundsB.bottom <= boundsA.top) return null;
    for (const shapeA of shapes(a, angleA)) {
      for (const shapeB of shapes(b, angleB)) {
        const hit = overlap(shapeA, shapeB);
        if (hit) return hit;
      }
    }
    return null;
  }

  function createCollisionIndex() {
    const cellSize = size * Math.SQRT2;
    const buckets = new Map();
    const positions = new Array(sections.length);
    const cellKey = (x, y) => `${x}:${y}`;
    function update(i) {
      const section = sections[i];
      const cx = Math.floor(section.x / cellSize);
      const cy = Math.floor(section.y / cellSize);
      const key = cellKey(cx, cy);
      if (positions[i] === key) return;
      if (positions[i] !== undefined) {
        const old = buckets.get(positions[i]);
        old.delete(i);
        if (!old.size) buckets.delete(positions[i]);
      }
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key).add(i);
      positions[i] = key;
    }
    for (let i = 0; i < sections.length; i += 1) update(i);
    return {
      update,
      candidates(section, after) {
        const cx = Math.floor(section.x / cellSize);
        const cy = Math.floor(section.y / cellSize);
        const result = [];
        for (let y = cy - 1; y <= cy + 1; y += 1) {
          for (let x = cx - 1; x <= cx + 1; x += 1) {
            const bucket = buckets.get(cellKey(x, y));
            if (bucket) for (const i of bucket) if (i > after) result.push(i);
          }
        }
        return result.sort((a, b) => a - b);
      },
    };
  }

  function closestPointOnSection(section, x, y) {
    let closest = null;
    for (const shape of shapes(section)) {
      const dx = x - shape.x, dy = y - shape.y;
      const c = Math.cos(shape.angle), s = Math.sin(shape.angle);
      const localX = dx * c + dy * s, localY = -dx * s + dy * c;
      const nearestX = Math.max(-shape.w / 2, Math.min(shape.w / 2, localX));
      const nearestY = Math.max(-shape.h / 2, Math.min(shape.h / 2, localY));
      const pointX = shape.x + nearestX * c - nearestY * s;
      const pointY = shape.y + nearestX * s + nearestY * c;
      const distance = Math.hypot(x - pointX, y - pointY);
      if (!closest || distance < closest.distance) closest = { x: pointX, y: pointY, distance };
    }
    return closest;
  }

  function addAngularImpulse(section, pointX, pointY, impulseX, impulseY) {
    if (section.attached) return;
    const rx = pointX - (section.x + size / 2);
    const ry = pointY - (section.y + size / 2);
    const memberThickness = section.vertical ? wallThickness : thickness;
    const inertia = (size * size + memberThickness * memberThickness) / 12;
    section.angularVelocity = Math.max(-2, Math.min(2, section.angularVelocity +
      (rx * impulseY - ry * impulseX) / inertia));
  }

  function settleSlab(section, dt) {
    if (section.attached || !section.horizontal || section.vertical ||
        Math.abs(section.vx) > 5 || Math.abs(section.vy) > 5) return;
    const groundDepth = groundPenetration(section);
    let support = null;
    let target;
    if (groundDepth >= -0.05) {
      const center = section.x + size / 2;
      target = Math.atan2(surfaceAt(center + 1) - surfaceAt(center - 1), 2);
    } else {
      const probe = { ...section, y: section.y + 0.15 };
      support = sections.find((other) => {
        if (other === section || other.cleared || !other.horizontal || other.vertical ||
            other.y <= section.y || Math.abs(other.vx) > 5 || Math.abs(other.vy) > 5) return false;
        const bounds = sectionBounds(other);
        const center = section.x + size / 2;
        return center >= bounds.left && center <= bounds.right && sectionOverlap(probe, other);
      });
      if (!support) return;
      target = support.angle;
    }
    let delta = target - section.angle;
    delta = Math.atan2(Math.sin(delta * 2), Math.cos(delta * 2)) / 2;
    if (Math.abs(delta) < 0.0001) return;
    delta = Math.max(-dt, Math.min(dt, delta));
    const oldY = section.y;
    const angle = section.angle + delta;
    const oldOverlaps = new Map();
    for (const other of sections) {
      if (other === section) continue;
      const hit = sectionOverlap(section, other);
      if (hit) oldOverlaps.set(other, hit.depth);
    }
    if (support) {
      const limit = size * Math.abs(delta) + 0.15;
      let low = 0, high = limit;
      section.y = oldY - high;
      if (sectionOverlap(section, support, angle)) { section.y = oldY; return; }
      for (let i = 0; i < 12; i += 1) {
        const middle = (low + high) / 2;
        section.y = oldY - middle;
        if (sectionOverlap(section, support, angle)) low = middle;
        else high = middle;
      }
      section.y = oldY - high;
    } else {
      section.y -= groundPenetration(section, angle) - groundDepth;
    }
    const blocked = groundPenetration(section, angle) > 0.01 || sections.some((other) => {
      if (other === section) return false;
      const hit = sectionOverlap(section, other, angle);
      return hit && hit.depth > (oldOverlaps.get(other) || 0) + 0.001;
    });
    if (blocked) section.y = oldY;
    else { section.angle = angle; section.angularVelocity = 0; }
  }

  return {
    sections, fragments, bonds, size, thickness, wallThickness, ground, left, rows, surfaceAt, terrain,
    sectionBounds, sectionOverlap, groundPenetration,
    updateFoundationSupport(isSupported) {
      if (typeof isSupported !== 'function') throw new Error('Invalid foundation support check');
      const anchors = sections.filter((section) => section.anchored);
      const supported = anchors.map((section) => isSupported(section));
      if (!supported.every((value) => typeof value === 'boolean')) {
        throw new Error('Foundation support check must return a boolean');
      }
      let lost = 0;
      anchors.forEach((section, index) => {
        if (!supported[index]) { detach(section); lost += 1; }
      });
      if (lost) detachUnsupported();
      return lost;
    },
    clearLooseMembers() {
      const count = fragments.length;
      for (const section of fragments) section.cleared = true;
      fragments.length = 0;
      return count;
    },
    damageAttached(entries) {
      if (!Array.isArray(entries) || entries.some((entry) => !entry ||
          !sections.includes(entry.section) || !Number.isFinite(entry.amount) || entry.amount < 0)) {
        throw new Error('Invalid structural damage');
      }
      let failed = false;
      for (const { section, amount } of entries) {
        if (!section.attached) continue;
        section.health -= amount / (section.vertical ? wallStrength : 1);
        if (section.health <= 0) { detach(section); failed = true; }
      }
      if (failed) detachUnsupported();
    },
    saveState() {
      const fields = ['x', 'y', 'previousX', 'previousY', 'vx', 'vy', 'angle', 'previousAngle',
        'angularVelocity', 'impactSpeed', 'health', 'attached', 'anchored', 'settled', 'cleared'];
      return {
        version: 1, terrain, columns, rows, size, left, ground, loadEnabled, capacityFactor,
        surfaceGrid: !!surfaceGrid,
        surfaceGridCellSize: surfaceGrid ? surfaceGrid.cellSize : null,
        experimentalImpactSpin: options.experimentalImpactSpin === true,
        shaftColumn: options.shaftColumn === undefined ? null : options.shaftColumn,
        openGround: options.openGround === true, repairProgress,
        sections: sections.map((section) => Object.fromEntries(fields.map((field) => [field, section[field]]))),
        bonds: bonds.map((bond) => ({ active: bond.active, stress: bond.stress })),
      };
    },
    loadState(state) {
      const numeric = ['x', 'y', 'previousX', 'previousY', 'vx', 'vy', 'angle', 'previousAngle',
        'angularVelocity', 'impactSpeed', 'health'];
      const boolean = ['attached', 'anchored', 'settled'];
      if (!state || state.version !== 1 || state.terrain !== terrain || state.columns !== columns ||
          state.rows !== rows || state.size !== size || state.left !== left || state.ground !== ground ||
          state.loadEnabled !== loadEnabled || state.capacityFactor !== capacityFactor ||
          (state.surfaceGrid !== undefined && typeof state.surfaceGrid !== 'boolean') ||
          (state.surfaceGrid === true) !== !!surfaceGrid ||
          (surfaceGrid && state.surfaceGridCellSize !== surfaceGrid.cellSize) ||
          (!surfaceGrid && state.surfaceGridCellSize !== undefined && state.surfaceGridCellSize !== null) ||
          (state.experimentalImpactSpin !== undefined && typeof state.experimentalImpactSpin !== 'boolean') ||
          (state.experimentalImpactSpin === true) !== (options.experimentalImpactSpin === true) ||
          state.shaftColumn !== (options.shaftColumn === undefined ? null : options.shaftColumn) ||
          state.openGround !== (options.openGround === true) ||
          !Number.isFinite(state.repairProgress) || state.repairProgress < 0 || state.repairProgress >= 1 ||
          !Array.isArray(state.sections) || state.sections.length !== sections.length ||
          !Array.isArray(state.bonds) || state.bonds.length !== bonds.length ||
          !state.sections.every((section, i) => section &&
            numeric.every((field) => Number.isFinite(section[field])) &&
            boolean.every((field) => typeof section[field] === 'boolean') &&
            (section.cleared === undefined || typeof section.cleared === 'boolean') &&
            (!section.cleared || !section.attached) &&
            (!section.anchored || (section.attached && sections[i].row === rows - 1 && isPole(sections[i].column)))) ||
          !state.bonds.every((bond, i) => bond && typeof bond.active === 'boolean' &&
            Number.isFinite(bond.stress) && bond.stress >= 0 &&
            (!bond.active || (state.sections[sections.indexOf(bonds[i].a)].attached &&
              state.sections[sections.indexOf(bonds[i].b)].attached)))) {
        throw new Error('Invalid or incompatible collapse save');
      }
      state.sections.forEach((saved, i) => {
        for (const field of numeric.concat(boolean)) sections[i][field] = saved[field];
        sections[i].cleared = saved.cleared === true;
      });
      state.bonds.forEach((saved, i) => { bonds[i].active = saved.active; bonds[i].stress = saved.stress; });
      fragments.length = 0;
      fragments.push(...sections.filter((section) => !section.attached && !section.cleared));
      repairProgress = state.repairProgress;
    },
    touchesRect(section, x, y, width, height, previous = false) {
      if (section.cleared) return false;
      const rect = { x: x + width / 2, y: y + height / 2, w: width, h: height, angle: 0 };
      const steps = previous ? Math.max(1, Math.ceil((Math.hypot(section.x - section.previousX,
        section.y - section.previousY) + Math.abs(section.angle - section.previousAngle) * size / 2) /
        (thickness / 2))) : 1;
      for (let i = 0; i <= steps; i += 1) {
        const t = previous ? i / steps : 1;
        const sx = section.previousX + (section.x - section.previousX) * t;
        const sy = section.previousY + (section.y - section.previousY) * t;
        const angle = section.previousAngle + (section.angle - section.previousAngle) * t;
        if (shapes(section, angle, sx, sy).some((shape) => overlap(shape, rect))) return true;
      }
      return false;
    },
    repairCost,
    repair(dt, availableHM, occupied = () => false, canRepair = () => true) {
      if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(availableHM) || availableHM < 0 ||
          typeof occupied !== 'function' || typeof canRepair !== 'function') throw new Error('Invalid repair parameters');
      if (!sections.some((section) => section.attached)) {
        repairProgress = 0;
        return { spent: 0, state: 'Destroyed' };
      }
      const damaged = sections.filter((section) => !section.attached || section.health < 100);
      const brokenBonds = bonds.filter((bond) => !bond.active && bond.a.attached && bond.b.attached);
      if (!damaged.length && !brokenBonds.length) {
        repairProgress = 0;
        return { spent: 0, state: 'Complete' };
      }
      const candidates = damaged.filter((section) => {
        const x = section.attached ? section.x : left + section.column * size;
        const y = section.attached ? section.y : ground - (rows - section.row) * size;
        const site = section.attached ? section : { ...section, x, y, angle: 0, cleared: false };
        if (!canRepair(section, site)) return false;
        if (section.attached) return true;
        if (occupied(x, y, size, site)) return false;
        if (sections.some((other) => {
          if (other === section) return false;
          const hit = sectionOverlap(site, other);
          if (!hit) return false;
          const adjacent = bonds.some((bond) => (bond.a === section && bond.b === other) ||
            (bond.b === section && bond.a === other));
          return !(other.attached && adjacent && hit.depth < size * 0.1);
        })) return false;
        return (section.row === rows - 1 && isPole(section.column)) ||
          bonds.some((bond) => (bond.a === section && bond.b.attached) ||
            (bond.b === section && bond.a.attached));
      }).sort((a, b) => b.row - a.row);
      const repairBond = brokenBonds.find((bond) =>
        canRepair(bond.a, bond.a) && canRepair(bond.b, bond.b) &&
        Math.hypot(bond.b.x - bond.a.x - bond.dx, bond.b.y - bond.a.y - bond.dy) < size * 0.1);
      if (!candidates.length && !repairBond) {
        repairProgress = 0;
        return { spent: 0, state: 'Blocked' };
      }
      if (availableHM < repairCost) {
        return { spent: 0, state: 'Waiting for HM' };
      }
      repairProgress += dt;
      if (repairProgress < 1) return { spent: 0, state: 'Rebuilding' };
      repairProgress = 0;
      if (!candidates.length) {
        repairBond.active = true;
        repairBond.stress = 0;
        return { spent: repairCost, state: 'Rebuilding' };
      }
      const section = candidates[0];
      if (!section.attached) {
        const fragmentIndex = fragments.indexOf(section);
        if (fragmentIndex >= 0) fragments.splice(fragmentIndex, 1);
        section.x = left + section.column * size;
        section.y = ground - (rows - section.row) * size;
        section.previousX = section.x;
        section.previousY = section.y;
        section.vx = 0;
        section.vy = 0;
        section.angle = 0;
        section.previousAngle = 0;
        section.angularVelocity = 0;
        section.settled = false;
        section.cleared = false;
        section.restTime = 0;
        section.attached = true;
        section.anchored = section.row === rows - 1 && isPole(section.column);
        for (const bond of bonds) {
          if ((bond.a === section || bond.b === section) && bond.a.attached && bond.b.attached) {
            bond.active = true;
            bond.stress = 0;
          }
        }
      }
      section.health = 100;
      return { spent: repairCost, state: 'Rebuilding' };
    },
    ladderSegment(row) {
      const support = grid.get(key(row, 0));
      return support && support.attached &&
        Math.abs(support.x - left) < 3 &&
        Math.abs(support.y - (ground - (rows - row) * size)) < 3;
    },
    blast(x, y, radius, strength) {
      if (![x, y, radius, strength].every(Number.isFinite) || radius <= 0 || strength <= 0) throw new Error('Invalid blast');
      for (const section of sections) {
        if (section.cleared) continue;
        const contact = closestPointOnSection(section, x, y);
        const distance = contact.distance;
        if (distance > radius) continue;
        const damage = strength * (1 - 0.6 * distance / radius);
        section.health -= damage / (section.vertical ? wallStrength : 1);
        if (section.health <= 0) detach(section);
        if (!section.attached) {
          const dx = section.x + size / 2 - x;
          const dy = section.y + size / 2 - y;
          const length = Math.max(1, Math.hypot(dx, dy));
          section.vx += dx / length * damage * 2;
          section.vy += dy / length * damage * 2;
          let impulseX = contact.x - x;
          let impulseY = contact.y - y;
          let impulseLength = Math.hypot(impulseX, impulseY);
          if (impulseLength < 0.001) {
            impulseX = dx;
            impulseY = dy;
            impulseLength = Math.hypot(dx, dy);
          }
          if (impulseLength >= 0.001) {
            addAngularImpulse(section, contact.x, contact.y,
              impulseX / impulseLength * damage * 0.15, impulseY / impulseLength * damage * 0.15);
          }
        }
      }
      detachUnsupported();
      for (const section of fragments) {
        const dx = section.x + size / 2 - x;
        const dy = section.y + size / 2 - y;
        const distance = Math.hypot(dx, dy);
        if (distance <= radius || distance >= radius * 3) continue;
        const impulse = strength * 0.8 * (1 - distance / (radius * 3));
        section.vx += dx / distance * impulse;
        section.vy += dy / distance * impulse;
      }
    },
    step(dt) {
      if (!Number.isFinite(dt) || dt <= 0) throw new Error('Invalid simulation step');
      applyStructuralLoad(dt);
      for (const section of sections) {
        section.previousX = section.x;
        section.previousY = section.y;
        section.previousAngle = section.angle;
        section.impactSpeed = Math.hypot(section.vx, section.vy);
      }
      const substeps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / substeps;
      for (let sub = 0; sub < substeps; sub += 1) {
        const old = sections.map((s) => ({ x: s.x, y: s.y }));
        const impacted = new Set();
        const spinningContacts = options.experimentalImpactSpin ? new Set() : null;
        const rotationPivots = options.experimentalImpactSpin ? new Map() : null;
        for (const s of sections) {
          if (s.anchored || s.cleared) continue;
          s.vy += 420 * h;
          s.x += s.vx * h;
          s.y += s.vy * h;
        }
        for (const bond of bonds) {
          if (!bond.active) continue;
          const strain = Math.hypot(bond.b.x - bond.a.x - bond.dx, bond.b.y - bond.a.y - bond.dy);
          bond.stress = Math.max(0, bond.stress - h * 2) + Math.max(0, strain - size * 0.035);
          if (strain > size * 0.35 || bond.stress > size * 1.5) bond.active = false;
        }
        detachUnsupported();
        for (let iteration = 0; iteration < 16; iteration += 1) {
          for (const bond of bonds) {
            if (!bond.active) continue;
            const wa = weight(bond.a);
            const wb = weight(bond.b);
            if (!wa && !wb) continue;
            const dx = (bond.b.x - bond.a.x - bond.dx) / (wa + wb);
            const dy = (bond.b.y - bond.a.y - bond.dy) / (wa + wb);
            bond.a.x += dx * wa; bond.a.y += dy * wa;
            bond.b.x -= dx * wb; bond.b.y -= dy * wb;
          }
          const collisionIndex = optimizeCollisionSearch ? createCollisionIndex() : null;
          for (let i = 0; i < sections.length; i += 1) {
            const a = sections[i];
            if (a.cleared) continue;
            let candidates = collisionIndex ? collisionIndex.candidates(a, i) : null;
            let nextCandidate = 0;
            for (let j = i + 1; j < sections.length; j += 1) {
              if (collisionIndex) {
                if (nextCandidate >= candidates.length) break;
                j = candidates[nextCandidate];
                nextCandidate += 1;
              }
              const b = sections[j];
              const hit = sectionOverlap(a, b);
              if (!hit) continue;
              const wa = weight(a);
              const wb = weight(b);
              if (!wa && !wb) continue;
              const pair = i * sections.length + j;
              if (spinningContacts && !spinningContacts.has(pair)) {
                spinningContacts.add(pair);
                const closing = (a.vx - b.vx) * hit.x + (a.vy - b.vy) * hit.y;
                if (closing > 60 && !a.attached && !b.attached) {
                  const ba = sectionBounds(a), bb = sectionBounds(b);
                  const x = (Math.max(ba.left, bb.left) + Math.min(ba.right, bb.right)) / 2;
                  const y = (Math.max(ba.top, bb.top) + Math.min(ba.bottom, bb.bottom)) / 2;
                  const impulse = Math.min(closing * 0.05, 15) / (wa + wb);
                  if (!a.attached) {
                    addAngularImpulse(a, x, y, -hit.x * impulse * wa, -hit.y * impulse * wa);
                    rotationPivots.set(a, { x, y, nx: -hit.x, ny: -hit.y });
                  }
                  if (!b.attached) {
                    addAngularImpulse(b, x, y, hit.x * impulse * wb, hit.y * impulse * wb);
                    rotationPivots.set(b, { x, y, nx: hit.x, ny: hit.y });
                  }
                }
              }
              const upper = a.y <= b.y ? a : b;
              const lower = upper === a ? b : a;
              if (Math.abs(hit.y) > 0.5 && !upper.attached && lower.attached &&
                  upper.vy - lower.vy > 100) impacted.add(lower);
              const push = hit.depth / (wa + wb);
              a.x -= hit.x * push * wa; a.y -= hit.y * push * wa;
              b.x += hit.x * push * wb; b.y += hit.y * push * wb;
              if (collisionIndex) {
                collisionIndex.update(i);
                collisionIndex.update(j);
                // Later candidates may change when collision resolution moves the current member.
                candidates = collisionIndex.candidates(a, j);
                nextCandidate = 0;
              }
            }
          }
          for (const s of sections) {
            if (s.anchored || s.cleared) continue;
            const bounds = sectionBounds(s);
            s.y -= Math.max(0, groundPenetration(s));
            if (bounds.left < 0) s.x -= bounds.left;
            if (bounds.right > 640) s.x -= bounds.right - 640;
          }
        }
        for (let i = 0; i < sections.length; i += 1) {
          const s = sections[i];
          if (s.cleared) continue;
          if (s.anchored) { s.vx = 0; s.vy = 0; continue; }
          s.vx = (s.x - old[i].x) / h * 0.98;
          s.vy = (s.y - old[i].y) / h * 0.98;
          let direction = 0;
          const groundY = surfaceAt(s.x + size / 2);
          const currentBounds = sectionBounds(s);
          let supported = !s.attached && groundPenetration(s) >= -0.05;
          if (!s.attached && currentBounds.bottom < groundY - 0.1) {
            const center = s.x + size / 2;
            let nearest = Infinity;
            for (const support of sections) {
              if (support === s || support.cleared) continue;
              // The half-diagonal bounds each rotated line; distant members cannot support this one.
              if (optimizeSupportSearch &&
                  (currentBounds.right < support.x + size / 2 - supportExtent - 0.001 ||
                   currentBounds.left > support.x + size / 2 + supportExtent + 0.001 ||
                   Math.abs(currentBounds.bottom - (support.y + size / 2)) > supportExtent + 0.251)) continue;
              const supportBounds = sectionBounds(support);
              if (Math.abs(currentBounds.bottom - supportBounds.top) > 0.25 ||
                  currentBounds.right <= supportBounds.left || currentBounds.left >= supportBounds.right) continue;
              supported = true;
              const edge = Math.max(supportBounds.left, Math.min(center, supportBounds.right));
              const distance = Math.abs(center - edge);
              if (distance < nearest) {
                nearest = distance;
                direction = Math.sign(center - edge);
              }
            }
          }
          if (supported && !direction) s.vx *= Math.exp(-8 * h);
          if (direction) {
            s.vx += direction * 180 * h;
            s.angularVelocity += direction * 12 * h;
          }
          s.angularVelocity *= Math.exp(-5 * h);
          const angle = s.attached ? 0 : s.angle + s.angularVelocity * h;
          const previousOverlaps = rotationPivots && rotationPivots.has(s) ? new Map(sections.filter((other) => other !== s)
            .map((other) => [other, sectionOverlap(s, other)]).filter((entry) => entry[1])) : null;
          const canRotate = () => groundPenetration(s, angle) <= 0.01 &&
            !sections.some((other) => {
              if (other === s) return false;
              const hit = sectionOverlap(s, other, angle);
              const prior = previousOverlaps && previousOverlaps.get(other);
              return hit && (!prior || hit.depth > prior.depth + 0.001);
            });
          if (canRotate()) {
            s.angle = angle;
          } else {
            const pivot = rotationPivots && rotationPivots.get(s);
            if (pivot) {
              const oldX = s.x, oldY = s.y;
              const dx = oldX + size / 2 - pivot.x, dy = oldY + size / 2 - pivot.y;
              const delta = angle - s.angle;
              s.x = pivot.x + dx * Math.cos(delta) - dy * Math.sin(delta) - size / 2;
              s.y = pivot.y + dx * Math.sin(delta) + dy * Math.cos(delta) - size / 2;
              const clearance = Math.min(size * Math.abs(delta) + 0.002, size * 0.1);
              s.x += pivot.nx * clearance;
              s.y += pivot.ny * clearance;
              if (canRotate()) s.angle = angle;
              else { s.x = oldX; s.y = oldY; s.angularVelocity = 0; }
            } else s.angularVelocity = 0;
          }
          if (!direction) settleSlab(s, h);
          s.settled = !s.attached && groundPenetration(s) >= -0.01 &&
            Math.abs(s.vx) < 1 && Math.abs(s.vy) < 1;
          if (s.settled) s.angularVelocity = 0;
        }
        for (const s of impacted) {
          s.health -= 30 / (s.vertical ? wallStrength : 1);
          if (s.health <= 0) detach(s);
        }
        if (impacted.size) detachUnsupported();
      }
      detachUnsupported();
    },
  };
}
