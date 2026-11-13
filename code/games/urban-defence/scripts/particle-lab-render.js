function renderParticleLab(scenario, image) {
  const { world } = scenario;
  renderParticleCells(world.snapshot().cells, world.width, world.height, image,
    (x, y) => scenario.isPassage(x, y));
}

function createImportedPassageMask(cells, width, height, cellSize, heights) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if ((y + 0.5) * cellSize >= heights[x] && cells[index] !== PARTICLE_TERRAIN) {
        mask[index] = 1;
      }
    }
  }
  return mask;
}

function findParticleSurfaceRows(cells, width, height) {
  const surface = new Int32Array(width).fill(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (cells[y * width + x] === PARTICLE_TERRAIN) {
        surface[x] = y;
        break;
      }
    }
  }
  return surface;
}

function isParticleSurfaceEdge(x, y, surface, isPassage) {
  if (y === surface[x]) return !isPassage(x, y - 1);
  if (y < surface[x]) return false;
  return (x > 0 && y <= surface[x - 1] && !isPassage(x - 1, y)) ||
    (x + 1 < surface.length && y <= surface[x + 1] && !isPassage(x + 1, y));
}

function renderParticleCells(cells, width, height, image, isPassage) {
  const surface = findParticleSurfaceRows(cells, width, height);
  function exposedUnderground(x, y) {
    return x >= 0 && x < width && y >= 0 && y < height &&
      cells[y * width + x] !== PARTICLE_TERRAIN &&
      (y > surface[x] || isPassage(x, y));
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const material = cells[y * width + x];
      const index = (y * width + x) * 4;
      let red = 2, green = 2, blue = 2;
      if (material === PARTICLE_WATER) {
        red = 31; green = 172; blue = 200;
      } else if (material === PARTICLE_BARRIER) {
        red = 215; green = 181; blue = 96;
      } else if (material === PARTICLE_DEBRIS) {
        red = 173; green = 134; blue = 72;
      } else if (material === PARTICLE_TERRAIN) {
        if (isParticleSurfaceEdge(x, y, surface, isPassage)) {
          red = 42; green = 162; blue = 71;
        } else if (exposedUnderground(x - 1, y) || exposedUnderground(x + 1, y) ||
            exposedUnderground(x, y - 1) || exposedUnderground(x, y + 1)) {
          red = 215; green = 181; blue = 96;
        }
      }
      image.data[index] = red;
      image.data[index + 1] = green;
      image.data[index + 2] = blue;
      image.data[index + 3] = 255;
    }
  }
}
