function createThermalHazardWorld() {
  const width = 40, height = 24, ambient = 20;
  const materials = Object.freeze({
    EMPTY: 0, ROCK: 1, BUILDING: 2, LAVA: 3, BASALT: 4, DEBRIS: 5,
  });
  const cells = new Uint8Array(width * height);
  const enthalpy = new Float64Array(cells.length);
  const health = new Float32Array(cells.length);
  const heatDelta = new Float64Array(cells.length);
  const moved = new Uint32Array(cells.length);
  const capacities = [0, 10, 6, 10, 10, 6];
  const conductivity = [0, 0.012, 0.025, 0.04, 0.014, 0.02];
  const latentHeat = 6000;
  const rockMelt = 1200;
  const lavaFreeze = 900;
  const hotLava = 1450;
  const index = (x, y) => y * width + x;
  const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
  const capacity = (material) => capacities[material];

  function temperatureFrom(material, energy) {
    if (material === materials.EMPTY) return ambient;
    if (material === materials.ROCK || material === materials.BASALT) {
      const meltStart = capacity(material) * (rockMelt - ambient);
      if (material === materials.ROCK && energy >= meltStart &&
          energy < meltStart + latentHeat) return rockMelt;
      if (material === materials.ROCK && energy >= meltStart + latentHeat) {
        return ambient + (energy - latentHeat) / capacity(material);
      }
      return ambient + energy / capacity(material);
    }
    if (material === materials.LAVA) {
      const freezeStart = capacity(material) * (lavaFreeze - ambient);
      if (energy >= freezeStart && energy < freezeStart + latentHeat) return lavaFreeze;
      return ambient + (energy - latentHeat) / capacity(material);
    }
    return ambient + energy / capacity(material);
  }

  function setMaterial(x, y, material, temperature = ambient) {
    const cell = index(x, y);
    cells[cell] = material;
    enthalpy[cell] = material === materials.LAVA
      ? capacity(material) * (temperature - ambient) + latentHeat
      : capacity(material) * (temperature - ambient);
    if (material === materials.BUILDING) health[cell] = 100;
  }

  function convert(cell, material) {
    if (cells[cell] === material) return;
    cells[cell] = material;
    if (material === materials.BUILDING) health[cell] = 100;
    else if (material !== materials.DEBRIS) health[cell] = 0;
  }

  function count(material) {
    let total = 0;
    for (const cell of cells) if (cell === material) total += 1;
    return total;
  }

  function groundAt(x) {
    return x >= 24 && x <= 33
      ? 18 + Math.floor(Math.sin((x - 24) / 9 * Math.PI) * 2) : 20;
  }

  for (let x = 0; x < width; x += 1) {
    for (let y = groundAt(x); y < height; y += 1) setMaterial(x, y, materials.ROCK);
  }
  for (let y = 12; y <= 19; y += 1) {
    setMaterial(17, y, materials.BUILDING);
    setMaterial(24, y, materials.BUILDING);
  }
  for (let x = 17; x <= 24; x += 1) setMaterial(x, 11, materials.BUILDING);
  for (let y = 14; y <= 19; y += 1) setMaterial(12, y, materials.ROCK);

  let tick = 0, beam = null;
  function pour() {
    let placed = 0;
    for (let y = 16; y <= 18; y += 1) {
      for (let x = 13; x <= 16; x += 1) {
        const cell = index(x, y);
        if (cells[cell] === materials.EMPTY) {
          setMaterial(x, y, materials.LAVA, hotLava);
          placed += 1;
        }
      }
    }
    return placed;
  }

  function fireLaser(y, slope = 0) {
    if (!Number.isInteger(y) || y < 0 || y >= height ||
        !Number.isFinite(slope) || Math.abs(slope) > 1) {
      throw new Error('Invalid laser trajectory');
    }
    let energy = 14, hits = 0;
    const path = [];
    for (let x = 0; x < width && energy > 0; x += 1) {
      const beamY = Math.round(y + slope * x);
      if (!inside(x, beamY)) break;
      const cell = index(x, beamY), material = cells[cell];
      path.push({ x, y: beamY });
      if (material !== materials.EMPTY) {
        const cost = material === materials.ROCK || material === materials.BASALT ? 3 : 1;
        energy -= cost;
        cells[cell] = materials.EMPTY;
        enthalpy[cell] = 0;
        health[cell] = 0;
        hits += 1;
        for (const [nx, ny] of [[x - 1, beamY], [x + 1, beamY], [x, beamY - 1], [x, beamY + 1]]) {
          if (!inside(nx, ny)) continue;
          const neighbor = index(nx, ny), neighborMaterial = cells[neighbor];
          if (neighborMaterial !== materials.EMPTY) {
            enthalpy[neighbor] += capacity(neighborMaterial) * 45;
          }
        }
      }
    }
    beam = { path, life: 24 };
    return { hits, energy, path };
  }

  function meteor() {
    const centerX = 30, centerY = 16, radius = 4;
    let displaced = 0;
    for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
      for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 > radius ** 2) continue;
        const cell = index(x, y), material = cells[cell];
        if (material !== materials.ROCK && material !== materials.BUILDING) continue;
        convert(cell, materials.DEBRIS);
        enthalpy[cell] += capacity(materials.DEBRIS) * 500;
        displaced += 1;
      }
    }
    return displaced;
  }

  function conductAndCool(ambientCooling) {
    heatDelta.fill(0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const cell = index(x, y), material = cells[cell];
        if (material === materials.EMPTY) continue;
        const temp = temperatureFrom(material, enthalpy[cell]);
        for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
          if (!inside(nx, ny)) continue;
          const neighbor = index(nx, ny), other = cells[neighbor];
          if (other === materials.EMPTY) continue;
          const difference = temp - temperatureFrom(other, enthalpy[neighbor]);
          const transfer = difference * Math.min(conductivity[material], conductivity[other]);
          heatDelta[cell] -= transfer;
          heatDelta[neighbor] += transfer;
        }
        if (ambientCooling) {
          let exposed = 0;
          for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
            if (!inside(nx, ny) || cells[index(nx, ny)] === materials.EMPTY) exposed += 1;
          }
          heatDelta[cell] -= Math.max(0, temp - ambient) * capacity(material) * 0.0003 * exposed;
        }
      }
    }
    for (let cell = 0; cell < cells.length; cell += 1) {
      if (cells[cell] !== materials.EMPTY) enthalpy[cell] = Math.max(0, enthalpy[cell] + heatDelta[cell]);
    }
  }

  function resolveThermalChanges() {
    for (let cell = 0; cell < cells.length; cell += 1) {
      const material = cells[cell];
      if (material === materials.EMPTY) continue;
      const temp = temperatureFrom(material, enthalpy[cell]);
      if (material === materials.ROCK || material === materials.BASALT) {
        const meltEnd = capacity(material) * (rockMelt - ambient) + latentHeat;
        if (enthalpy[cell] >= meltEnd) convert(cell, materials.LAVA);
      } else if (material === materials.LAVA) {
        const freezeStart = capacity(material) * (lavaFreeze - ambient);
        if (enthalpy[cell] <= freezeStart) convert(cell, materials.BASALT);
      } else if (material === materials.BUILDING) {
        if (temp > 380) {
          health[cell] = Math.max(0, health[cell] - (temp - 380) * 0.0005);
          if (health[cell] === 0) convert(cell, materials.DEBRIS);
        }
      }
    }
  }

  function moveHotMaterials() {
    for (let y = height - 2; y >= 0; y -= 1) {
      for (let n = 0; n < width; n += 1) {
        const x = tick % 2 ? n : width - n - 1;
        const cell = index(x, y), material = cells[cell];
        if ((material !== materials.LAVA && material !== materials.DEBRIS) || moved[cell] === tick) continue;
        const directions = tick % 2 ? [-1, 1] : [1, -1];
        const choices = material === materials.LAVA
          ? [[x, y + 1], [x + directions[0], y + 1], [x + directions[1], y + 1],
            [x + directions[0], y], [x + directions[1], y]]
          : [[x, y + 1], [x + directions[0], y + 1], [x + directions[1], y + 1]];
        const next = choices.find(([nx, ny]) => inside(nx, ny) && cells[index(nx, ny)] === materials.EMPTY);
        if (!next) continue;
        const destination = index(next[0], next[1]);
        cells[destination] = material;
        enthalpy[destination] = enthalpy[cell];
        health[destination] = health[cell];
        cells[cell] = materials.EMPTY;
        enthalpy[cell] = 0;
        health[cell] = 0;
        moved[destination] = tick;
      }
    }
  }

  function step(options = {}) {
    if (!options || (options.ambientCooling !== undefined && typeof options.ambientCooling !== 'boolean')) {
      throw new Error('Invalid thermal simulation step options');
    }
    tick += 1;
    conductAndCool(options.ambientCooling !== false);
    resolveThermalChanges();
    moveHotMaterials();
    if (beam && --beam.life <= 0) beam = null;
  }

  function checkedCell(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inside(x, y)) {
      throw new Error('Thermal position is outside the world');
    }
    return index(x, y);
  }

  function addHeat(x, y, energy) {
    const cell = checkedCell(x, y);
    if (!Number.isFinite(energy) || energy < 0 || cells[cell] === materials.EMPTY) {
      throw new Error('Heat must be a non-negative finite amount applied to a material cell');
    }
    enthalpy[cell] += energy;
  }

  function totalEnthalpy() {
    return enthalpy.reduce((sum, value) => sum + value, 0);
  }

  return {
    width, height, materials,
    get beam() { return beam; },
    at(x, y) { return cells[checkedCell(x, y)]; },
    temperatureAt(x, y) {
      const cell = checkedCell(x, y);
      return temperatureFrom(cells[cell], enthalpy[cell]);
    },
    healthAt(x, y) { return health[checkedCell(x, y)]; },
    heatLevel(x, y) { return enthalpy[checkedCell(x, y)]; },
    totalEnthalpy, addHeat, pour, fireLaser, meteor, step,
    get lavaCount() { return count(materials.LAVA); },
    get basaltCount() { return count(materials.BASALT); },
    get debrisCount() { return count(materials.DEBRIS); },
    get buildingCount() { return count(materials.BUILDING); },
    get damagedBuildingCount() {
      let total = 0;
      for (let cell = 0; cell < cells.length; cell += 1) {
        if (cells[cell] === materials.BUILDING && health[cell] < 100) total += 1;
      }
      return total;
    },
    get hotCellCount() {
      let total = 0;
      for (let cell = 0; cell < cells.length; cell += 1) {
        if (cells[cell] !== materials.EMPTY &&
            temperatureFrom(cells[cell], enthalpy[cell]) >= 250) total += 1;
      }
      return total;
    },
    get maximumTemperature() {
      let maximum = ambient;
      for (let cell = 0; cell < cells.length; cell += 1) {
        if (cells[cell] !== materials.EMPTY) {
          maximum = Math.max(maximum, temperatureFrom(cells[cell], enthalpy[cell]));
        }
      }
      return maximum;
    },
  };
}
