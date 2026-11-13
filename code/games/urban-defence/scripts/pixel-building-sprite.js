// Renderable, world-sized sprites extracted from the same finished pixel structures used by the
// Building type, shape & style lab. The particle world is only the art source here; the main game
// keeps its own resource, combat, capture and construction rules.
const URBAN_PIXEL_ART_CACHE = new Map();
const URBAN_PIXEL_CELL_SIZE = 4;
const URBAN_PIXEL_VARIANTS = Object.freeze({
  population: ['slab', 'setback', 'offset', 'tapered', 'crown', 'spire', 'needle'],
  military: ['compound', 'fortress', 'command', 'bastion'],
  farm: ['silos', 'barn', 'elevator', 'homestead'],
});

function urbanPixelArtType(kind) {
  if (kind === 'military') return 'military';
  if (kind === 'farm') return 'farm';
  if (kind === 'mine') return 'farm';
  return 'population';
}

function urbanPixelArtVariant(kind, seed = 0) {
  const type = urbanPixelArtType(kind);
  if (kind === 'mine') return 'elevator';
  const choices = URBAN_PIXEL_VARIANTS[type];
  return choices[Math.abs(Math.floor(seed)) % choices.length];
}

function urbanMilitaryMaterialColor(color, style) {
  const [r, g, b] = color;
  if (r > 175 && g < 105 && b < 95) return [181, 77, 47];
  if (r > 185 && g > 115 && b < 105) return [218, 168, 77];
  const luminance = (r * 0.24 + g * 0.62 + b * 0.14) / 255;
  const tint = {
    asian: { low: [22, 31, 21], high: [125, 155, 83] },
    gothic: { low: [25, 30, 25], high: [142, 146, 112] },
    modern: { low: [18, 31, 24], high: [83, 145, 96] },
  }[style] || { low: [20, 30, 23], high: [104, 144, 82] };
  return tint.low.map((value, index) => Math.round(value + (tint.high[index] - value) * luminance));
}

function createUrbanPixelBuildingSprite(type, style, level, variant) {
  const key = `${type}:${style}:${level}:${variant}`;
  if (URBAN_PIXEL_ART_CACHE.has(key)) return URBAN_PIXEL_ART_CACHE.get(key);
  const building = createPixelStyledBuilding(type, style, level, { variant, previewFinished: true });
  const { world, styled, shape, scenario } = building;
  const worldWidth = world.width;
  const cellKey = (x, y) => y * worldWidth + x;
  const palette = PIXEL_BUILDING_STYLE_PALETTES[style];
  const wall = new Map(), back = new Map();
  const paint = (cells, color) => { for (const cell of cells || []) wall.set(cellKey(cell.x, cell.y), color); };
  if (building.wallDetail) for (const [index, color] of building.wallDetail) wall.set(index, color);
  if (building.windows) {
    for (const cell of building.windows.side) wall.set(cellKey(cell.x, cell.y), pixelWindowColor(cell.part, 'side', style));
    for (const cell of building.windows.back) back.set(cellKey(cell.x, cell.y), pixelWindowColor(cell.part, 'back', style));
  }
  if (shape) {
    for (const index of shape.oneWay) wall.set(index, palette.frame.map((value) => Math.round(value * 0.78)));
    for (const index of shape.passThrough) wall.set(index, palette.frame.map((value) => Math.round(value * 0.5)));
  }
  paint(styled.ornamentCells, palette.ornament);
  paint(styled.accentCells, [235, 52, 40]);
  for (const device of building.devices) {
    if (device.fixture) continue;
    for (const cell of device.cells) wall.set(cellKey(cell.x, cell.y), pixelDeviceColor(cell.part, device.kind, style));
  }
  if (shape) for (const index of shape.coreHousing) wall.set(index, PIXEL_CORE_SHADE);
  paint(scenario.inspectCore().cells, PIXEL_CORE_COLOR);
  paint(styled.geometry.seeds, PIXEL_CORE_COLOR);

  const frame = new Set(styled.geometry.frameCells.map((cell) => cellKey(cell.x, cell.y)));
  const enclosed = shape ? new Set([...shape.keepClear].filter((index) => {
    const x = index % worldWidth, y = Math.floor(index / worldWidth);
    const blockedIn = (dx, dy) => {
      for (let step = 1; step < 60; step += 1) if (frame.has(cellKey(x + dx * step, y + dy * step))) return true;
      return false;
    };
    return blockedIn(0, -1) && blockedIn(-1, 0) && blockedIn(1, 0);
  })) : new Set();
  const tint = palette.frame.map((value, index) => Math.round(value * 0.16 + [20, 28, 36][index] * 0.84));
  const { left, right } = styled.geometry.bounds;
  const ground = styled.surfaceY;
  let top = ground;
  const pixels = [];
  for (let y = 0; y < ground; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const index = cellKey(x, y), material = world.at(x, y);
      let color = null;
      if (material === PARTICLE_BARRIER || material === PARTICLE_CONSTRUCTION) color = wall.get(index) || palette.frame;
      else if (material === PARTICLE_EMPTY && back.has(index)) color = back.get(index);
      else if (material === PARTICLE_EMPTY && enclosed.has(index)) color = tint;
      if (!color) continue;
      const fieldColor = urbanMilitaryMaterialColor(color, style);
      pixels.push({ x: x - left, y: y - ground, r: fieldColor[0], g: fieldColor[1], b: fieldColor[2] });
      top = Math.min(top, y);
    }
  }

  const sourceHeight = ground - top, sourceWidth = right - left + 1;
  const pixelWidth = Math.ceil(sourceWidth / URBAN_PIXEL_CELL_SIZE);
  const pixelHeight = Math.ceil(sourceHeight / URBAN_PIXEL_CELL_SIZE);
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext('2d', { alpha: true });
  context.imageSmoothingEnabled = false;
  const image = context.createImageData(pixelWidth, pixelHeight);
  const counts = new Uint8Array(pixelWidth * pixelHeight);
  const channels = new Uint32Array(pixelWidth * pixelHeight * 3);
  for (const pixel of pixels) {
    const x = Math.floor(pixel.x / URBAN_PIXEL_CELL_SIZE);
    const y = Math.floor((pixel.y + sourceHeight) / URBAN_PIXEL_CELL_SIZE);
    const cell = y * pixelWidth + x;
    counts[cell] += 1;
    channels[cell * 3] += pixel.r;
    channels[cell * 3 + 1] += pixel.g;
    channels[cell * 3 + 2] += pixel.b;
  }
  for (let cell = 0; cell < counts.length; cell += 1) {
    if (!counts[cell]) continue;
    const offset = cell * 4;
    image.data[offset] = Math.round(channels[cell * 3] / counts[cell]);
    image.data[offset + 1] = Math.round(channels[cell * 3 + 1] / counts[cell]);
    image.data[offset + 2] = Math.round(channels[cell * 3 + 2] / counts[cell]);
    image.data[offset + 3] = Math.min(255, 56 + counts[cell] * 13);
  }
  context.putImageData(image, 0, 0);

  const lightCells = [];
  if (building.windows) {
    const seen = new Set();
    for (const cell of building.windows.side) {
      if (cell.part !== 'glass') continue;
      const index = cellKey(cell.x, cell.y);
      if (seen.has(index) || ((cell.x * 17 + cell.y * 31 + level * 13) % 7) > 2) continue;
      seen.add(index);
      lightCells.push({ x: Math.floor((cell.x - left) / URBAN_PIXEL_CELL_SIZE),
        y: Math.floor((cell.y - top) / URBAN_PIXEL_CELL_SIZE) });
    }
  }
  const baseColors = Array(pixelWidth).fill(null);
  for (let x = 0; x < pixelWidth; x += 1) {
    for (let y = pixelHeight - 1; y >= 0; y -= 1) {
      const offset = (y * pixelWidth + x) * 4;
      if (!image.data[offset + 3]) continue;
      baseColors[x] = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
      break;
    }
  }
  const width = pixelWidth * URBAN_PIXEL_CELL_SIZE, height = pixelHeight * URBAN_PIXEL_CELL_SIZE;
  const art = { type, style, level, variant, width, height, pixelWidth, pixelHeight,
    cellSize: URBAN_PIXEL_CELL_SIZE, ground, canvas, lightCells, baseColors,
    light: style === 'asian' ? '#ffd879' : style === 'gothic' ? '#dfc9ff' : '#b9f0ee' };
  URBAN_PIXEL_ART_CACHE.set(key, art);
  return art;
}

function getUrbanPixelBuildingSprite(building, styles) {
  const type = urbanPixelArtType(building.kind);
  const style = building.style || styles[building.owner] || 'modern';
  const variant = building.artVariant || urbanPixelArtVariant(building.kind, building.seed || 0);
  return createUrbanPixelBuildingSprite(type, style, Math.max(1, Math.min(7, building.level || 1)), variant);
}

function getUrbanPixelBuildingFootprintForVariant(type, variant) {
  return Math.max(...PIXEL_BUILDING_STYLES.map((style) =>
    createUrbanPixelBuildingSprite(type, style, 4, variant).width));
}

function getUrbanPixelBuildingFootprint(kind, seed = 0) {
  return getUrbanPixelBuildingFootprintForVariant(urbanPixelArtType(kind), urbanPixelArtVariant(kind, seed));
}

function syncUrbanPixelBuildingMetrics(building, styles) {
  const sprite = getUrbanPixelBuildingSprite(building, styles);
  building.width = Math.max(building.pixelFootprint || 0, sprite.width);
  building.pixelFootprint = building.width;
  if (building.rebuildHeight !== undefined) {
    return sprite;
  }
  if (!building.construction || building.construction.stage >= 4) {
    building.height = sprite.height;
  } else {
    const progress = Math.max(0, Math.min(1, (building.construction.stage + building.construction.progress / 5) / 4));
    building.height = Math.max(URBAN_PIXEL_CELL_SIZE,
      Math.round(sprite.height * progress / URBAN_PIXEL_CELL_SIZE) * URBAN_PIXEL_CELL_SIZE);
  }
  return sprite;
}
