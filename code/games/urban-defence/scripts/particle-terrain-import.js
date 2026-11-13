function createParticleWorldFromSurface(surface, options) {
  return importParticleSurface(surface, null, options);
}

function createParticleWorldFromSurfaceAndWater(surface, waterLevelAt, options) {
  if (typeof waterLevelAt !== 'function') throw new Error('Invalid water level sampler');
  return importParticleSurface(surface, waterLevelAt, options);
}

function createParticleWorldFromSurfaceWaterAndTunnels(surface, waterLevelAt, tunnels, options) {
  if (typeof waterLevelAt !== 'function') throw new Error('Invalid water level sampler');
  if (!Array.isArray(tunnels)) throw new Error('Invalid tunnel list');
  const segments = [];
  for (const tunnel of tunnels) {
    if (!tunnel || !Number.isFinite(tunnel.interiorWidth) || tunnel.interiorWidth <= 0 ||
        !Array.isArray(tunnel.points) || tunnel.points.length < 2) {
      throw new Error('Invalid tunnel geometry');
    }
    const points = tunnel.points.map((point) => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error('Invalid tunnel point');
      }
      return { x: point.x, y: point.y };
    });
    const radius = tunnel.interiorWidth / 2;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) ||
          ![a.x - radius, a.x + radius, a.y - radius, a.y + radius,
            b.x - radius, b.x + radius, b.y - radius, b.y + radius].every(Number.isFinite)) {
        throw new Error('Tunnel geometry exceeds finite coordinates');
      }
      segments.push({ a, b, radius, length, ux: length ? dx / length : 0, uy: length ? dy / length : 0 });
    }
  }
  const world = importParticleSurface(surface, waterLevelAt, options);
  const { width, height, cellSize, originX, originY } = options;
  for (const segment of segments) {
    const { a, b, radius, length, ux, uy } = segment;
    const left = Math.max(0, Math.ceil((Math.min(a.x, b.x) - radius - originX) / cellSize - 0.5));
    const right = Math.min(width - 1, Math.floor((Math.max(a.x, b.x) + radius - originX) / cellSize - 0.5));
    const top = Math.max(0, Math.ceil((Math.min(a.y, b.y) - radius - originY) / cellSize - 0.5));
    const bottom = Math.min(height - 1, Math.floor((Math.max(a.y, b.y) + radius - originY) / cellSize - 0.5));
    for (let x = left; x <= right; x += 1) {
      const px = originX + (x + 0.5) * cellSize;
      let firstY = top, lastY = bottom;
      const dx = b.x - a.x;
      if (dx !== 0) {
        const t1 = (px - radius - a.x) / dx;
        const t2 = (px + radius - a.x) / dx;
        const firstT = Math.max(0, Math.min(1, Math.min(t1, t2)));
        const lastT = Math.max(0, Math.min(1, Math.max(t1, t2)));
        const y1 = a.y + firstT * (b.y - a.y);
        const y2 = a.y + lastT * (b.y - a.y);
        // Include an extra row at either edge to avoid rounding out a boundary cell.
        firstY = Math.max(top, Math.floor((Math.min(y1, y2) - radius - originY) / cellSize - 0.5));
        lastY = Math.min(bottom, Math.ceil((Math.max(y1, y2) + radius - originY) / cellSize - 0.5));
      }
      for (let y = firstY; y <= lastY; y += 1) {
        const py = originY + (y + 0.5) * cellSize;
        const distanceAlong = Math.max(0, Math.min(length, (px - a.x) * ux + (py - a.y) * uy));
        if (Math.hypot(px - (a.x + distanceAlong * ux), py - (a.y + distanceAlong * uy)) <= radius &&
            world.at(x, y) === PARTICLE_TERRAIN) {
          world.excavate(x, y, x, y);
        }
      }
    }
  }
  return world;
}

// One-way snapshots; no importer converts buildings.
function importParticleSurface(surface, waterLevelAt, options) {
  if (!surface || typeof surface.heightAt !== 'function' || !options ||
      !Number.isSafeInteger(options.width) || options.width < 1 ||
      !Number.isSafeInteger(options.height) || options.height < 1 ||
      !Number.isSafeInteger(options.width * options.height) ||
      !Number.isFinite(options.cellSize) || options.cellSize <= 0 ||
      (options.skipEmptyChunks !== undefined && typeof options.skipEmptyChunks !== 'boolean') ||
      !Number.isFinite(options.originX) || !Number.isFinite(options.originY) ||
      !Number.isFinite(options.originX + options.width * options.cellSize) ||
      !Number.isFinite(options.originY + options.height * options.cellSize)) {
    throw new Error('Invalid particle terrain import configuration');
  }
  const { width, height, cellSize, originX, originY } = options;
  const revision = surface.revision;
  const columns = Array.from({ length: width }, (_, x) => {
    const centerX = originX + (x + 0.5) * cellSize;
    const heightAtCenter = surface.heightAt(centerX);
    if (!Number.isFinite(heightAtCenter)) throw new Error('Invalid terrain surface height');
    const waterLevel = waterLevelAt ? waterLevelAt(centerX) : null;
    if (waterLevel !== null && !Number.isFinite(waterLevel)) throw new Error('Invalid water surface level');
    return { height: heightAtCenter, waterLevel };
  });
  if (surface.revision !== revision) throw new Error('Terrain changed during particle import');
  const world = createParticleWorld(width, height, {
    skipEmptyRows: true, skipEmptyChunks: options.skipEmptyChunks === true,
    supportCapacity: options.supportCapacity,
  });
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const centerY = originY + (y + 0.5) * cellSize;
      if (centerY >= columns[x].height) world.set(x, y, PARTICLE_TERRAIN);
      else if (columns[x].waterLevel !== null && centerY >= columns[x].waterLevel) {
        world.set(x, y, PARTICLE_WATER);
      }
    }
  }
  return world;
}
