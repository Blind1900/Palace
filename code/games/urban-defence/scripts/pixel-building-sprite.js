// Renderable, world-sized sprites built from the same finished pixel structures used by the Building type,
// shape & style lab, at the lab's full resolution (one lab cell per world unit) and in the lab's own style
// palettes, so the three architecture styles (not team colours) tell the sides apart. On top of the lab
// look each sprite adds interior detail: guard troops in their soldier slots, furniture, ceiling lamps that
// light their rooms, lit windows and a baked glow layer, plus a hackable control panel on the top floor.
// The particle world is only the art source here; the game keeps its own combat and construction rules.
const URBAN_PIXEL_ART_CACHE = new Map();
const URBAN_PIXEL_CELL_SIZE = 4;
const URBAN_BUILDING_PIXEL = 1;
// Every style and type takes the same time per construction stage (seed -> L1, then each level-up).
const URBAN_CONSTRUCTION_STAGE_SECONDS = 3;
const URBAN_PIXEL_VARIANTS = Object.freeze({
  population: ['slab', 'setback', 'offset', 'tapered', 'crown', 'spire', 'needle'],
  military: ['compound', 'fortress', 'command', 'bastion'],
  farm: ['silos', 'barn', 'elevator', 'homestead'],
});
const URBAN_NIGHT_SKY = [14, 20, 26];
const URBAN_LAMP_COLORS = Object.freeze({ asian: [255, 214, 120], gothic: [236, 214, 255], modern: [188, 242, 236] });
const URBAN_CONSTRUCTION_GLOW = [255, 150, 40];
// Furniture stamps sit on a floor. '#' wood, 'o' cloth (style trim), 'k' steel, 's' screen, 'g' leaf,
// 'p' pot, 'c' crate, 'b' sack.
const URBAN_FURNITURE = Object.freeze({
  population: [['.oo.', '####', '#..#'], ['oo##', '####'], ['.g.', 'ggg', '.p.'], ['ss', 'kk', '.k'], ['###', '#.#']],
  military: [['cc', 'cc'], ['ss.', 'kkk', 'k.k'], ['k.k.k', 'kkkkk', 'k.k.k'], ['ccc', 'ccc']],
  farm: [['.b', 'bb'], ['##', '##', '##'], ['bbb']],
});
const URBAN_FURNITURE_COLORS = Object.freeze({ '#': [118, 84, 52], k: [70, 78, 86], s: [120, 210, 236],
  g: [86, 146, 72], p: [146, 92, 60], c: [148, 110, 62], b: [196, 172, 122] });

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

function urbanArtHash(...values) {
  let hash = 2166136261;
  for (const char of values.join('|')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

// One stable crown per shape, so a level-up never swaps the rooftop crown.
function urbanCrownFor(type, variant) { return urbanArtHash(type, variant) % 3; }

let urbanGuardArtwork = null;
function getUrbanGuardArtwork() {
  if (!urbanGuardArtwork && typeof createPixelUnitArtwork === 'function' && typeof PIXEL_UNIT_REFERENCE !== 'undefined') {
    urbanGuardArtwork = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellScale: 1, cellReduction: 4 });
  }
  return urbanGuardArtwork;
}

function urbanOrientation(owner) { return owner === 'right' ? 'right' : owner === 'neutral' ? 'neutral' : 'left'; }

function createUrbanPixelBuildingSprite(type, style, level, variant, owner = 'left') {
  const orientation = urbanOrientation(owner);
  const key = `${type}:${style}:${level}:${variant}:${orientation}`;
  if (URBAN_PIXEL_ART_CACHE.has(key)) return URBAN_PIXEL_ART_CACHE.get(key);
  const building = createPixelStyledBuilding(type, style, level, { variant, previewFinished: true,
    owner: orientation === 'right' ? 'right' : 'left', antenna: urbanCrownFor(type, variant) });
  const { world, styled, shape, scenario } = building;
  const W = world.width;
  const cellKey = (x, y) => y * W + x;
  const palette = PIXEL_BUILDING_STYLE_PALETTES[style];
  const tone = (color, amount) => color.map((value) => Math.max(0, Math.min(255, Math.round(value * amount))));
  const mix = (a, b, t) => a.map((value, index) => Math.round(value * (1 - t) + b[index] * t));
  const lamp = URBAN_LAMP_COLORS[style] || URBAN_LAMP_COLORS.modern;

  // The lab's paintBuilding order: wall detail, windows, stairs, doors, ornaments, beacons, devices, cradle, cores.
  const wall = new Map(), back = new Map(), overlay = new Map(), solidExtra = new Set(), removed = new Set();
  const paint = (cells, color) => { for (const cell of cells || []) wall.set(cellKey(cell.x, cell.y), color); };
  if (building.wallDetail) for (const [index, color] of building.wallDetail) wall.set(index, color);
  const sideGlass = new Map();
  if (building.windows) {
    for (const cell of building.windows.side) {
      wall.set(cellKey(cell.x, cell.y), pixelWindowColor(cell.part, 'side', style));
      if (cell.part === 'glass' || cell.part === 'shine') sideGlass.set(cellKey(cell.x, cell.y), cell);
    }
    for (const cell of building.windows.back) back.set(cellKey(cell.x, cell.y), { color: pixelWindowColor(cell.part, 'back', style), cell });
  }
  if (shape) {
    for (const index of shape.oneWay) wall.set(index, tone(palette.frame, 0.78));
    for (const index of shape.passThrough) wall.set(index, tone(palette.frame, 0.5));
  }
  paint(styled.ornamentCells, palette.ornament);
  paint(styled.accentCells, [235, 52, 40]);
  const roofDevices = building.devices.filter((device) => !device.fixture);
  roofDevices.forEach((device, index) => {
    // Neutral settlements mount every other weapon facing the other way until someone captures them.
    const flip = orientation === 'neutral' && (index + level) % 2 === 1;
    if (!flip) {
      for (const cell of device.cells) wall.set(cellKey(cell.x, cell.y), pixelDeviceColor(cell.part, device.kind, style));
      return;
    }
    for (const cell of device.cells) { removed.add(cellKey(cell.x, cell.y)); wall.delete(cellKey(cell.x, cell.y)); }
    const stamp = pixelDeviceStamp(device.kind, style, -device.facing);
    for (const cell of stamp.cells) {
      const index = cellKey(device.x + cell.dx, device.y + cell.dy);
      removed.delete(index);
      solidExtra.add(index);
      wall.set(index, pixelDeviceColor(cell.part, device.kind, style));
    }
  });
  if (shape) for (const index of shape.coreHousing) wall.set(index, PIXEL_CORE_SHADE);
  paint(scenario.inspectCore().cells, PIXEL_CORE_COLOR);
  paint(styled.geometry.seeds, PIXEL_CORE_COLOR);
  const isSolid = (x, y) => {
    const index = cellKey(x, y);
    if (removed.has(index)) return false;
    if (solidExtra.has(index)) return true;
    const material = world.at(x, y);
    return material === PARTICLE_BARRIER || material === PARTICLE_CONSTRUCTION;
  };
  const isFree = (x, y) => !isSolid(x, y) && world.at(x, y) === PARTICLE_EMPTY && !overlay.has(cellKey(x, y))
    && !(shape && (shape.oneWay.has(cellKey(x, y)) || shape.passThrough.has(cellKey(x, y))));

  // Interior: cells enclosed by frame above and on both sides read as rooms, as in the lab.
  const frame = new Set(styled.geometry.frameCells.map((cell) => cellKey(cell.x, cell.y)));
  const enclosed = shape ? new Set([...shape.keepClear].filter((index) => {
    const x = index % W, y = Math.floor(index / W);
    const blockedIn = (dx, dy) => {
      for (let step = 1; step < 60; step += 1) if (frame.has(cellKey(x + dx * step, y + dy * step))) return true;
      return false;
    };
    return blockedIn(0, -1) && blockedIn(-1, 0) && blockedIn(1, 0);
  })) : new Set();

  const floors = shape ? shape.floors.filter((floor) => floor.accessible) : [];
  const litFloor = new Set(floors.filter((floor) => urbanArtHash(key, floor.storey) % 4 !== 0).map((floor) => floor.storey));
  const storeyAt = (y) => {
    const floor = floors.find((entry) => y < entry.y && y >= entry.y - (shape.floorPitch || PIXEL_INTERIOR.floorPitch));
    return floor ? floor.storey : null;
  };

  // Control panel on the top-most floor a unit can reach (population and military only).
  let panel = null;
  if (shape && (type === 'population' || type === 'military') && floors.length) {
    const top = floors.reduce((best, floor) => floor.y < best.y ? floor : best, floors[0]);
    const facing = orientation === 'right' ? -1 : 1;
    const stamp = pixelDeviceStamp('panel', style, facing);
    const candidates = facing > 0 ? [top.left + 2, top.right - stamp.width - 1] : [top.right - stamp.width - 1, top.left + 2];
    for (let shift = 0; shift < 12 && !panel; shift += 1) {
      for (const base of candidates) {
        const x = base + (base === top.left + 2 ? shift : -shift), y = top.y - stamp.height;
        if (!stamp.cells.every((cell) => isFree(x + cell.dx, y + cell.dy))) continue;
        for (const cell of stamp.cells) overlay.set(cellKey(x + cell.dx, y + cell.dy), pixelDeviceColor(cell.part, 'panel', style));
        panel = { worldX: x, worldY: y, width: stamp.width, height: stamp.height, storey: top.storey };
        break;
      }
    }
  }

  // Guard troops in the lab's soldier slots, alternating facing.
  const guardArt = getUrbanGuardArtwork();
  let guards = 0;
  if (shape && guardArt && building.unitWorld && type !== 'farm') {
    const mask = guardArt.mask('standing', 1);
    const slots = findPixelSoldierSlots(building.unitWorld, shape, mask, shape.soldiersPerFloor);
    for (const floor of slots) {
      const capacity = (shape.floors.find((entry) => entry.storey === floor.storey) || {}).capacity || 0;
      floor.slots.slice(0, capacity).forEach((slot, index) => {
        const pixels = guardArt.frame('walk', 0, index % 2 ? -1 : 1).pixels;
        if (!pixels.every((pixel) => isFree(slot.x + pixel.x, slot.y + pixel.y))) return;
        for (const pixel of pixels) overlay.set(cellKey(slot.x + pixel.x, slot.y + pixel.y), pixelGuardColor(pixel.color));
        guards += 1;
      });
    }
  }

  // Furniture along each floor, wherever a stamp fits without touching stairs, doors, guards or the panel.
  const furniture = URBAN_FURNITURE[type] || [];
  for (const floor of furniture.length ? floors : []) {
    let x = floor.left + 2 + urbanArtHash(key, 'f', floor.storey) % 4;
    while (x < floor.right - 2) {
      const rows = furniture[urbanArtHash(key, x, floor.storey) % furniture.length];
      const width = rows[0].length, height = rows.length, y = floor.y - height;
      const cells = [];
      rows.forEach((row, dy) => [...row].forEach((char, dx) => { if (char !== '.') cells.push({ x: x + dx, y: y + dy, char }); }));
      if (x + width <= floor.right - 1 && cells.every((cell) => isFree(cell.x, cell.y))
        && [-1, width].every((dx) => isFree(x + dx, floor.y - 1))) {
        for (const cell of cells) {
          const color = cell.char === 'o' ? tone(palette.ornament, 0.85) : URBAN_FURNITURE_COLORS[cell.char];
          overlay.set(cellKey(cell.x, cell.y), litFloor.has(floor.storey) ? mix(color, lamp, 0.12) : tone(color, 0.7));
        }
        x += width + 3 + urbanArtHash(key, x) % 5;
      } else x += 2;
    }
  }

  // Ceiling lamps every 14 cells on lit floors; their light warms the room tint and the window glass.
  const lamps = [];
  for (const floor of floors) {
    if (!litFloor.has(floor.storey)) continue;
    const ceiling = floor.y - PIXEL_INTERIOR.clearHeight;
    for (let x = floor.left + 4; x <= floor.right - 4; x += 14) {
      if (!isFree(x, ceiling) || !isFree(x + 1, ceiling)) continue;
      overlay.set(cellKey(x, ceiling), lamp);
      overlay.set(cellKey(x + 1, ceiling), lamp);
      lamps.push({ x: x + 0.5, y: ceiling, storey: floor.storey });
    }
  }
  const lampLight = (x, y) => {
    const storey = storeyAt(y);
    let light = 0;
    for (const item of lamps) {
      if (item.storey !== storey) continue;
      light = Math.max(light, 1 - Math.hypot(x - item.x, (y - item.y) * 1.3) / 13);
    }
    return Math.max(0, light);
  };

  const tint = mix(URBAN_NIGHT_SKY, palette.frame, 0.16);
  const { left, right } = styled.geometry.bounds;
  const ground = styled.surfaceY;
  let top = ground;
  for (const cell of styled.geometry.frameCells) top = Math.min(top, cell.y);
  for (const index of solidExtra) top = Math.min(top, Math.floor(index / W));
  top = Math.max(0, top - 1);
  const width = right - left + 1, height = ground - top;
  const pixels = new Uint32Array(width * height);
  const pack = (color) => (255 << 24 | color[2] << 16 | color[1] << 8 | color[0]) >>> 0;
  const glows = [];
  for (let y = top; y < ground; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const index = cellKey(x, y);
      let color = null;
      if (isSolid(x, y)) {
        color = wall.get(index) || palette.frame;
        if (sideGlass.has(index)) {
          const storey = storeyAt(y);
          if (storey !== null && litFloor.has(storey)) { color = mix(color, lamp, 0.42); glows.push({ x, y, radius: 5, alpha: 0.2 }); }
        }
      } else if (overlay.has(index)) color = overlay.get(index);
      else if (world.at(x, y) === PARTICLE_EMPTY && back.has(index)) {
        const storey = storeyAt(y);
        color = storey !== null && litFloor.has(storey) ? mix(back.get(index).color, lamp, 0.3) : back.get(index).color;
      } else if (world.at(x, y) === PARTICLE_EMPTY && enclosed.has(index)) {
        const light = lampLight(x, y);
        color = light > 0 ? mix(tint, lamp, light * 0.45) : tint;
      }
      if (color) pixels[(y - top) * width + (x - left)] = pack(color);
    }
  }
  for (const item of lamps) glows.push({ x: item.x, y: item.y + 3, radius: 11, alpha: 0.32 });
  for (const cell of styled.accentCells || []) glows.push({ x: cell.x, y: cell.y, radius: 4, alpha: 0.35, color: [235, 52, 40] });
  for (const cell of scenario.inspectCore().cells) glows.push({ x: cell.x, y: cell.y, radius: 6, alpha: 0.18, color: PIXEL_CORE_COLOR });

  const art = finishUrbanSprite({ type, style, level, variant, orientation, key, width, height, pixels,
    lamp, glows: glows.map((glow) => ({ ...glow, x: glow.x - left, y: glow.y - top })),
    panel: panel ? { x: panel.worldX - left, y: panel.worldY - top, width: panel.width, height: panel.height,
      storey: panel.storey } : null,
    guards, stats: building.stats });
  URBAN_PIXEL_ART_CACHE.set(key, art);
  return art;
}

// Shared tail of sprite creation: canvas, glow layer and bottom-row colours for the terrain join.
function finishUrbanSprite(art) {
  const { width, height, pixels } = art;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: true });
  const image = context.createImageData(width, height);
  new Uint32Array(image.data.buffer).set(pixels);
  context.putImageData(image, 0, 0);
  const pad = 12;
  const lightCanvas = document.createElement('canvas');
  lightCanvas.width = width + pad * 2;
  lightCanvas.height = height + pad * 2;
  const light = lightCanvas.getContext('2d');
  for (const glow of art.glows) {
    const color = glow.color || art.lamp;
    const gradient = light.createRadialGradient(glow.x + pad, glow.y + pad, 0, glow.x + pad, glow.y + pad, glow.radius);
    gradient.addColorStop(0, `rgba(${color.join(',')},${glow.alpha})`);
    gradient.addColorStop(1, `rgba(${color.join(',')},0)`);
    light.fillStyle = gradient;
    light.fillRect(glow.x + pad - glow.radius, glow.y + pad - glow.radius, glow.radius * 2, glow.radius * 2);
  }
  const baseColors = Array(width).fill(null);
  for (let x = 0; x < width; x += 1) {
    for (let y = height - 1; y >= 0; y -= 1) {
      const value = pixels[y * width + x];
      if (!value) continue;
      baseColors[x] = [value & 255, (value >>> 8) & 255, (value >>> 16) & 255];
      break;
    }
  }
  return Object.assign(art, { pixelWidth: width, pixelHeight: height, cellSize: URBAN_BUILDING_PIXEL, canvas,
    lightCanvas, lightPad: pad, baseColors,
    light: `rgb(${art.lamp.join(',')})` });
}

// Level-ups edit the standing building: cells both levels share stay, cells the new level drops are taken
// down from the top, and the new cells are added from the bottom up behind a glowing construction front.
// Transitions and their frames are shared by every building with the same pair of sprites.
const URBAN_TRANSITION_CACHE = new Map();
const URBAN_TRANSITION_STEPS = 24;
function getUrbanLevelTransition(from, to) {
  const key = `${from ? from.key : 'seed'}>${to.key}`;
  if (URBAN_TRANSITION_CACHE.has(key)) return URBAN_TRANSITION_CACHE.get(key);
  // Bottom-align the two sprites and pick the horizontal shift that keeps the most cells.
  let shift = 0;
  if (from) {
    let best = -1;
    const centred = Math.round((to.width - from.width) / 2);
    for (let dx = centred - 8; dx <= centred + 8; dx += 1) {
      let overlap = 0;
      for (let y = 0; y < Math.min(from.height, to.height); y += 1) {
        const fromRow = (from.height - 1 - y) * from.width, toRow = (to.height - 1 - y) * to.width;
        for (let x = Math.max(0, -dx); x < from.width && x + dx < to.width; x += 1) {
          if (from.pixels[fromRow + x] && to.pixels[toRow + x + dx]) overlap += 1;
        }
      }
      if (overlap > best || overlap === best && Math.abs(dx - centred) < Math.abs(shift - centred)) { best = overlap; shift = dx; }
    }
  }
  // Composite frame: `to` sits at toX, `from` at toX + shift... expressed as offsets from the composite's left.
  const fromX = from ? Math.max(0, shift) : 0, toX = from ? Math.max(0, -shift) : 0;
  const width = Math.max(from ? fromX + from.width : 0, toX + to.width);
  const height = Math.max(from ? from.height : 0, to.height);
  const kept = [], added = [], dropped = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fy = from ? y - (height - from.height) : -1, ty = y - (height - to.height);
      const fx = x - fromX, tx = x - toX;
      const before = from && fy >= 0 && fx >= 0 && fx < from.width ? from.pixels[fy * from.width + fx] : 0;
      const after = ty >= 0 && tx >= 0 && tx < to.width ? to.pixels[ty * to.width + tx] : 0;
      const index = y * width + x;
      if (before && after) kept.push([index, before, after]);
      else if (after) added.push([index, after, y, x]);
      else if (before) dropped.push([index, before, y, x]);
    }
  }
  const middle = width / 2;
  added.sort((a, b) => b[2] - a[2] || Math.abs(a[3] - middle) - Math.abs(b[3] - middle));
  dropped.sort((a, b) => a[2] - b[2]);
  const transition = { key, from, to, fromX, toX, width, height, kept, added, dropped, frames: new Map() };
  URBAN_TRANSITION_CACHE.set(key, transition);
  return transition;
}

function getUrbanTransitionFrame(transition, fraction) {
  const step = Math.max(0, Math.min(URBAN_TRANSITION_STEPS, Math.floor(fraction * URBAN_TRANSITION_STEPS)));
  if (transition.frames.has(step)) return transition.frames.get(step);
  const progress = step / URBAN_TRANSITION_STEPS;
  const { width, height, kept, added, dropped } = transition;
  const pixels = new Uint32Array(width * height);
  for (const [index, before, after] of kept) pixels[index] = progress >= 0.5 ? after : before;
  const removing = Math.round(Math.min(1, progress * 2) * dropped.length);
  for (let i = removing; i < dropped.length; i += 1) pixels[dropped[i][0]] = dropped[i][1];
  const adding = Math.round(progress * added.length);
  const front = Math.max(1, Math.round(added.length * 0.04));
  const glow = (255 << 24 | URBAN_CONSTRUCTION_GLOW[2] << 16 | URBAN_CONSTRUCTION_GLOW[1] << 8 | URBAN_CONSTRUCTION_GLOW[0]) >>> 0;
  for (let i = 0; i < adding; i += 1) pixels[added[i][0]] = i >= adding - front && progress < 1 ? glow : added[i][1];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  new Uint32Array(image.data.buffer).set(pixels);
  context.putImageData(image, 0, 0);
  let topRow = height;
  for (let index = 0; index < pixels.length; index += 1) if (pixels[index]) { topRow = Math.floor(index / width); break; }
  const frame = { canvas, width, height, visibleHeight: height - topRow };
  transition.frames.set(step, frame);
  return frame;
}

function getUrbanPixelBuildingSprite(building, styles) {
  const type = urbanPixelArtType(building.kind);
  const style = building.style || styles[building.owner] || 'modern';
  const variant = building.artVariant || urbanPixelArtVariant(building.kind, building.seed || 0);
  return createUrbanPixelBuildingSprite(type, style, Math.max(1, Math.min(7, building.level || 1)), variant, building.owner);
}

function getUrbanPixelBuildingFootprintForVariant(type, variant) {
  return Math.max(...PIXEL_BUILDING_STYLES.map((style) =>
    createUrbanPixelBuildingSprite(type, style, 4, variant).width));
}

function getUrbanPixelBuildingFootprint(kind, seed = 0) {
  return getUrbanPixelBuildingFootprintForVariant(urbanPixelArtType(kind), urbanPixelArtVariant(kind, seed));
}

// What the building looks like right now: a finished sprite, or a construction/level-up transition frame.
function getUrbanBuildingArt(building, styles) {
  const construction = building.construction;
  if (!construction || construction.stage >= 4 || building.rebuildHeight !== undefined) {
    return { sprite: getUrbanPixelBuildingSprite(building, styles), transition: null };
  }
  const type = urbanPixelArtType(building.kind);
  const style = building.style || styles[building.owner] || 'modern';
  const variant = building.artVariant || urbanPixelArtVariant(building.kind, building.seed || 0);
  const from = construction.stage >= 1 ? createUrbanPixelBuildingSprite(type, style, construction.stage, variant, building.owner) : null;
  const to = createUrbanPixelBuildingSprite(type, style, construction.stage + 1, variant, building.owner);
  const transition = getUrbanLevelTransition(from, to);
  const fraction = Math.max(0, Math.min(1, construction.progress / URBAN_CONSTRUCTION_STAGE_SECONDS));
  return { sprite: to, from, transition, fraction, frame: getUrbanTransitionFrame(transition, fraction) };
}

function syncUrbanPixelBuildingMetrics(building, styles) {
  const sprite = getUrbanPixelBuildingSprite(building, styles);
  building.width = Math.max(building.pixelFootprint || 0, sprite.width);
  building.pixelFootprint = building.width;
  if (building.rebuildHeight !== undefined) return sprite;
  const art = getUrbanBuildingArt(building, styles);
  building.height = art.frame ? Math.max(URBAN_BUILDING_PIXEL, art.frame.visibleHeight) : sprite.height;
  return sprite;
}

// World position of the building's art (its left edge) and of its control panel, if it has one.
function urbanBuildingArtLeft(building, width) { return Math.round(building.x + (building.width - width) / 2); }

function urbanBuildingPanelPoint(building, styles, surfaceYAt) {
  const sprite = getUrbanPixelBuildingSprite(building, styles);
  if (!sprite.panel) return null;
  const left = urbanBuildingArtLeft(building, sprite.width);
  const ground = Math.min(surfaceYAt(left), surfaceYAt(left + sprite.width));
  return { x: left + sprite.panel.x + sprite.panel.width / 2, y: ground - sprite.height + sprite.panel.y + sprite.panel.height,
    storey: sprite.panel.storey };
}
