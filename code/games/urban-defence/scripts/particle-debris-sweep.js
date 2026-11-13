// Experimental axis-aligned probe; it does not replace the collapse solver.
function sweepParticleDebrisBox(world, box, dx, dy) {
  if (!world || !Number.isInteger(world.width) || !Number.isInteger(world.height) ||
      typeof world.at !== 'function' || !box ||
      ![box.x, box.y, box.width, box.height, dx, dy].every(Number.isFinite) ||
      box.width <= 0 || box.height <= 0 || box.x < 0 || box.y < 0 ||
      box.x + box.width > world.width || box.y + box.height > world.height) {
    throw new Error('Invalid debris sweep');
  }
  const solid = (x, y) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
    const material = world.at(x, y);
    return material === PARTICLE_TERRAIN || material === PARTICLE_BARRIER || material === PARTICLE_DEBRIS;
  };
  const epsilon = 1e-9;
  for (let y = Math.floor(box.y); y <= Math.floor(box.y + box.height - epsilon); y += 1) {
    for (let x = Math.floor(box.x); x <= Math.floor(box.x + box.width - epsilon); x += 1) {
      if (solid(x, y)) throw new Error('Debris sweep starts inside solid material');
    }
  }
  let x = box.x, y = box.y, hitX = false, hitY = false;
  if (dx > 0) {
    let target = Math.min(x + dx, world.width - box.width);
    for (let col = Math.floor(x + box.width - epsilon) + 1; col < target + box.width; col += 1) {
      for (let row = Math.floor(y); row <= Math.floor(y + box.height - epsilon); row += 1) {
        if (solid(col, row)) { target = col - box.width; break; }
      }
      if (target === col - box.width) break;
    }
    hitX = target < x + dx;
    x = target;
  } else if (dx < 0) {
    let target = Math.max(x + dx, 0);
    for (let col = Math.floor(x + epsilon) - 1; col + 1 > target; col -= 1) {
      for (let row = Math.floor(y); row <= Math.floor(y + box.height - epsilon); row += 1) {
        if (solid(col, row)) { target = col + 1; break; }
      }
      if (target === col + 1) break;
    }
    hitX = target > x + dx;
    x = target;
  }
  if (dy > 0) {
    let target = Math.min(y + dy, world.height - box.height);
    for (let row = Math.floor(y + box.height - epsilon) + 1; row < target + box.height; row += 1) {
      for (let col = Math.floor(x); col <= Math.floor(x + box.width - epsilon); col += 1) {
        if (solid(col, row)) { target = row - box.height; break; }
      }
      if (target === row - box.height) break;
    }
    hitY = target < y + dy;
    y = target;
  } else if (dy < 0) {
    let target = Math.max(y + dy, 0);
    for (let row = Math.floor(y + epsilon) - 1; row + 1 > target; row -= 1) {
      for (let col = Math.floor(x); col <= Math.floor(x + box.width - epsilon); col += 1) {
        if (solid(col, row)) { target = row + 1; break; }
      }
      if (target === row + 1) break;
    }
    hitY = target > y + dy;
    y = target;
  }
  return { x, y, hitX, hitY };
}
