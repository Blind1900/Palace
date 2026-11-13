function inspectParticlePassage(world, passage, x, y) {
  if (!world || !Number.isInteger(world.width) || !Number.isInteger(world.height) ||
      typeof world.at !== 'function' || !(passage instanceof Uint8Array) ||
      passage.length !== world.width * world.height ||
      !Number.isInteger(x) || !Number.isInteger(y) ||
      x < 0 || x >= world.width || y < 0 || y >= world.height) {
    throw new Error('Invalid passage inspection');
  }
  const isPassage = (row) => row >= 0 && row < world.height && passage[row * world.width + x] === 1;
  if (!isPassage(y)) return null;
  let top = y, bottom = y;
  while (isPassage(top - 1)) top -= 1;
  while (isPassage(bottom + 1)) bottom += 1;
  let firstWater = null, obstruction = false;
  for (let row = top; row <= bottom; row += 1) {
    const material = world.at(x, row);
    if (material === PARTICLE_WATER && firstWater === null) firstWater = row;
    if (material === PARTICLE_TERRAIN || material === PARTICLE_BARRIER || material === PARTICLE_DEBRIS) {
      obstruction = true;
    }
  }
  const depth = firstWater === null ? 0 : (bottom - firstWater + 1) / (bottom - top + 1);
  return { x, top, bottom, depth, obstruction, flooded: depth >= 0.15 };
}

function findParticlePassageRoute(world, passage, start, end) {
  for (const point of [start, end]) {
    if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y) ||
        !world || point.x < 0 || point.x >= world.width || point.y < 0 || point.y >= world.height) {
      throw new Error('Invalid passage route endpoint');
    }
  }
  if (!(passage instanceof Uint8Array) || passage.length !== world.width * world.height ||
      typeof world.at !== 'function') throw new Error('Invalid passage route');
  const width = world.width, height = world.height, size = width * height;
  const states = new Uint8Array(size);
  function passable(index) {
    if (states[index]) return states[index] === 1;
    if (passage[index] !== 1) { states[index] = 2; return false; }
    const x = index % width, y = Math.floor(index / width);
    const result = inspectParticlePassage(world, passage, x, y);
    const state = result.obstruction || result.flooded ? 2 : 1;
    for (let row = result.top; row <= result.bottom; row += 1) states[row * width + x] = state;
    return state === 1;
  }
  const first = start.y * width + start.x, last = end.y * width + end.x;
  if (!passable(first) || !passable(last)) return { state: 'blocked endpoint', path: [] };
  const queue = new Int32Array(size), parent = new Int32Array(size);
  parent.fill(-1);
  let head = 0, tail = 0;
  queue[tail++] = first;
  parent[first] = first;
  while (head < tail && parent[last] === -1) {
    const current = queue[head++], x = current % width, y = Math.floor(current / width);
    const neighbors = [];
    if (x > 0) neighbors.push(current - 1);
    if (x + 1 < width) neighbors.push(current + 1);
    if (y > 0) neighbors.push(current - width);
    if (y + 1 < height) neighbors.push(current + width);
    for (const next of neighbors) {
      if (parent[next] !== -1 || !passable(next)) continue;
      parent[next] = current;
      queue[tail++] = next;
    }
  }
  if (parent[last] === -1) return { state: 'no route', path: [] };
  const path = [];
  for (let cell = last; ; cell = parent[cell]) {
    path.push({ x: cell % width, y: Math.floor(cell / width) });
    if (cell === first) break;
  }
  path.reverse();
  return { state: 'route found', path };
}
