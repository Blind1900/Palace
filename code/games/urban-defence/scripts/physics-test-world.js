// Experimental cell world; the live map still uses its existing surface model.
function createPhysicsTestWorld(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('World dimensions must be positive integers');
  }
  const solid = new Uint8Array(width * height).fill(1);
  const water = new Float64Array(width * height);
  const index = (x, y) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= width || y < 0 || y >= height) {
      throw new Error('Cell is outside the test world');
    }
    return y * width + x;
  };
  const transfer = (from, to, amount) => {
    const moved = Math.min(amount, water[from], 1 - water[to]);
    water[from] -= moved;
    water[to] += moved;
  };
  return {
    width,
    height,
    isSolid(x, y) { return solid[index(x, y)] === 1; },
    waterAt(x, y) { return water[index(x, y)]; },
    setSolid(x, y, value) {
      const cell = index(x, y);
      if (value && water[cell] > 0) throw new Error('Cannot fill a cell containing water');
      solid[cell] = value ? 1 : 0;
    },
    setWater(x, y, amount) {
      const cell = index(x, y);
      if (solid[cell] || !Number.isFinite(amount) || amount < 0 || amount > 1) {
        throw new Error('Water must fit in an open cell');
      }
      water[cell] = amount;
    },
    totalWater() { return water.reduce((sum, amount) => sum + amount, 0); },
    floodFraction(x, top, bottom) {
      if (bottom < top) throw new Error('Invalid tunnel bounds');
      let total = 0;
      for (let y = top; y <= bottom; y += 1) total += water[index(x, y)];
      return total / (bottom - top + 1);
    },
    isTunnelBlocked(x, top, bottom) {
      return this.floodFraction(x, top, bottom) >= 0.15;
    },
    step() {
      for (let y = height - 2; y >= 0; y -= 1) {
        for (let x = 0; x < width; x += 1) {
          const cell = y * width + x;
          const below = cell + width;
          if (!solid[cell] && !solid[below]) transfer(cell, below, 0.12);
        }
      }
      // Alternating direction avoids a permanent left-to-right preference.
      for (let y = height - 1; y >= 0; y -= 1) {
        for (let x = 0; x < width - 1; x += 1) {
          const left = y * width + x;
          const right = left + 1;
          if (solid[left] || solid[right]) continue;
          const difference = water[left] - water[right];
          if (difference > 0) transfer(left, right, difference * 0.12);
          else transfer(right, left, -difference * 0.12);
        }
        for (let x = width - 2; x >= 0; x -= 1) {
          const left = y * width + x;
          const right = left + 1;
          if (solid[left] || solid[right]) continue;
          const difference = water[left] - water[right];
          if (difference > 0) transfer(left, right, difference * 0.12);
          else transfer(right, left, -difference * 0.12);
        }
      }
    },
  };
}
