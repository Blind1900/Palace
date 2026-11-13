const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const gameRoot = document.querySelector('.game-shell');
const baseSideButton = document.getElementById('cycle-base-side');
const fullscreenButton = document.getElementById('fullscreen-button');

const url = new URL(window.location.href);
const params = url.searchParams;
const embedded = params.get('embedded') === '1';
const fullscreen = params.get('fullscreen') === '1';
let baseSide = params.get('baseSide') === 'right' ? 'right' : 'left';

const state = {
  time: 0,
};

const STARTING_RESOURCES = Object.freeze({ hm: 500, sm: 300, pop: 10 });

const physics = {
  gravity: 0.42,
  terminalVelocity: 3.8,
};

const TERRAIN_SECTION_WIDTH = 2400;
const WORLD_WIDTH = TERRAIN_SECTION_WIDTH * 4;
const WORLD_HEIGHT = 1560;
const MAX_ZOOM_FACTOR = 32;
const TUNNEL_INTERIOR_WIDTH = 24;
const TUNNEL_WALL_WIDTH = 1.5;
const factionArchitectureStyles = createFactionArchitectureStyles();
const CORE_BUILDING_WIDTH = getUrbanPixelBuildingFootprintForVariant('military', 'compound');
const FARM_BUILDING_WIDTH = getUrbanPixelBuildingFootprintForVariant('farm', 'silos');
const FARM_MAX_SOURCE_DISTANCE = 1200;
const FARM_ADDITIONAL_SOURCE_GROWTH = 12;
const FARM_GROWTH_PER_SECOND = 2;
const LIFE_GRID_COLUMNS = 160;
const LIFE_GRID_ROWS = 96;
const PARTICLE_TERRAIN_CELL_SIZE = 4;
let terrainTextureStep = 4;
const randomBetween = (min, max) => min + Math.random() * (max - min);
const NEUTRAL_CENTERS = [
  randomBetween(0.23, 0.37) * WORLD_WIDTH,
  randomBetween(0.43, 0.57) * WORLD_WIDTH,
  randomBetween(0.63, 0.77) * WORLD_WIDTH,
];
const waterZones = Array.from({ length: 10 }, (_, index) => {
  const start = index * WORLD_WIDTH / 10 + 140;
  const end = (index + 1) * WORLD_WIDTH / 10 - 140;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const center = randomBetween(start, end);
    if (NEUTRAL_CENTERS.some((neutral) => Math.abs(center - neutral) < 280)) continue;
    return { center, width: randomBetween(85, 165), depth: randomBetween(22, 38) };
  }
  throw new Error('Unable to place a water basin away from neutral settlements');
});
const terrainPeaks = Array.from({ length: 9 }, (_, index) => ({
  center: randomBetween((index + 0.3) / 10, (index + 1.2) / 10) * WORLD_WIDTH,
  width: randomBetween(100, 310),
  height: index === 4 ? randomBetween(175, 230) : randomBetween(55, 165),
  shape: randomBetween(0.8, 2),
}));
const terrainWaves = Array.from({ length: 4 }, (_, index) => ({
  frequency: randomBetween(0.0025, 0.005) * (index + 1),
  phase: randomBetween(0, Math.PI * 2),
  amplitude: [35, 22, 12, 6][index] * randomBetween(0.7, 1.4),
}));
const terrainDetail = createTerrainDetail(WORLD_WIDTH);
const viewport = { width: 0, height: 0, pixelRatio: 1 };
const surfaceDetails = Array.from({ length: 220 }, (_, index) => {
  const x = 40 + (index + Math.random()) * (WORLD_WIDTH - 80) / 220;
  const type = index % 9 === 0 ? 'tree' : index % 3 === 0 ? 'rock' : 'grass';
  return { x, type, size: type === 'tree' ? 5 + Math.random() * 5 : 2 + Math.random() * 3,
    phase: Math.random() * Math.PI * 2, lifeRow: Math.floor(Math.random() * LIFE_GRID_ROWS) };
});
const skyDetails = Array.from({ length: 90 }, (_, index) => ({
  x: randomBetween(0, WORLD_WIDTH), y: randomBetween(0, 240), brightness: 0.2 + (index % 5) * 0.12,
}));

const camera = {
  x: 0,
  y: 0,
  zoom: 1,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  cameraStartX: 0,
  cameraStartY: 0,
};

const world = {
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  surfaceBaseY: 320,
  craterX: WORLD_WIDTH * 0.5,
  craterSize: 0,
  explosionPhase: 0,
};

let lifeGrid = createLifeGrid(LIFE_GRID_COLUMNS, LIFE_GRID_ROWS, 0.2);
let lifeGridClock = 0;
let particleTerrainClock = 0;
let terrainTextureClock = 0;
let terrainTextureDirty = true;
let particleTerrain = null;
const valleyProfile = {
  leftStart: 0.07 + Math.random() * 0.07,
  leftEnd: 0.32 + Math.random() * 0.12,
  rightStart: 0.54 + Math.random() * 0.12,
  rightEnd: 0.84 + Math.random() * 0.08,
  depth: randomBetween(630, 780),
  tilt: randomBetween(-180, 180),
  wavePhase: Math.random() * Math.PI * 2,
  waveScale: randomBetween(35, 90),
};
const terrainSurface = createTerrainSurface(WORLD_WIDTH, 4, terrainYAt);
const waterPools = createWaterPools();
particleTerrain = createParticleWorldFromSurfaceAndWater(terrainSurface, waterLevelAt, {
  width: WORLD_WIDTH / PARTICLE_TERRAIN_CELL_SIZE,
  height: WORLD_HEIGHT / PARTICLE_TERRAIN_CELL_SIZE,
  cellSize: PARTICLE_TERRAIN_CELL_SIZE,
  originX: 0,
  originY: 0,
  skipEmptyChunks: true,
});
const particleTerrainCells = new Uint8Array(particleTerrain.width * particleTerrain.height);
const terrainTextureCanvas = document.createElement('canvas');
terrainTextureCanvas.width = Math.ceil(particleTerrain.width / terrainTextureStep);
terrainTextureCanvas.height = Math.ceil(particleTerrain.height / terrainTextureStep);
const terrainTextureContext = terrainTextureCanvas.getContext('2d', { alpha: true });
let terrainTextureImage = terrainTextureContext.createImageData(terrainTextureCanvas.width, terrainTextureCanvas.height);
particleTerrain.configureDebrisMerging(12);
const waterDrops = [];
const collapsedBuildings = [];
const buildingDebris = [];
const cores = [
  { x: findDryPosition(24, CORE_BUILDING_WIDTH) + CORE_BUILDING_WIDTH / 2,
    width: CORE_BUILDING_WIDTH, owner: 'left', health: 1000 },
    { x: findDryPosition(WORLD_WIDTH - CORE_BUILDING_WIDTH - 35, CORE_BUILDING_WIDTH) + CORE_BUILDING_WIDTH / 2,
    width: CORE_BUILDING_WIDTH, owner: 'right', health: 1000 },
];
for (const core of cores) {
  core.height = createUrbanPixelBuildingSprite('military', factionArchitectureStyles[core.owner], 4, 'compound').height;
}
const neutralTerritories = NEUTRAL_CENTERS.map((center) => ({
  center,
  owner: 'neutral',
}));
const resourceNodes = createResourceNodes();
const starterTunnels = createStarterTunnels();
const buildingBlueprints = buildBuildingBlueprints();
particleTerrain.configureDebrisMergeOccupancy((x, y) => {
  const worldX = (x + 0.5) * PARTICLE_TERRAIN_CELL_SIZE;
  const worldY = (y + 0.5) * PARTICLE_TERRAIN_CELL_SIZE;
  return buildingBlueprints.some((building) => building.health > 0 && worldX >= building.x
    && worldX <= building.x + building.width
    && worldY >= Math.min(surfaceYAt(building.x), surfaceYAt(building.x + building.width)) - building.height
    && worldY <= surfaceYAt(worldX));
});
const territories = Array.from({ length: 9 }, (_, cluster) => {
  const members = buildingBlueprints.filter((building) => building.cluster === cluster);
  return {
    cluster,
    owner: cluster < 3 ? 'left' : cluster < 6 ? 'right' : 'neutral',
    left: Math.min(...members.map((building) => building.x)) - 20,
    right: Math.max(...members.map((building) => building.x + building.width)) + 20,
  };
});
const { buildingColor, drawSettlements, drawCollapsedBuildings } = createBuildingRenderer({
  ctx, camera, surfaceYAt, terrainYAt, worldToScreen, drawPixelLine, drawPixelRect,
  farmBuildingWidth: FARM_BUILDING_WIDTH, buildingBlueprints, cores, collapsedBuildings, factionArchitectureStyles,
});
const worldObjectRenderer = createWorldObjectRenderer();
const pipeline = createUrbanPipeline({ surfaceYAt, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, waterLevelAt,
  terrainRevision: () => particleTerrain.terrainRevision });
const missileControl = createMissileControl({
  canvas, ctx, camera, buildings: buildingBlueprints, cores, surfaceYAt, worldToScreen, screenToWorld,
  getSide: () => baseSide, worldWidth: WORLD_WIDTH, craterSurface, waterLevelAt, splashWater, breakBuilding,
  renderer: worldObjectRenderer,
});
const commandControl = createCommandControl({
  canvas, ctx, buildings: buildingBlueprints, nodes: resourceNodes, tunnels: starterTunnels,
  cores, pools: waterPools, territories, surfaceYAt, worldToScreen, screenToWorld, camera,
  getSide: () => baseSide, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  canBuild: canBuildOnTerrain, farmWaterSources, tunnelWidth: TUNNEL_INTERIOR_WIDTH,
  startingResources: STARTING_RESOURCES, renderer: worldObjectRenderer, craterSurface,
  architectureStyles: factionArchitectureStyles, pipeline,
});
for (const building of buildingBlueprints) {
  if (building.kind === 'farm') building.availableWaterSources = farmWaterSources(building);
}
const WATER_DAMAGE_PER_SECOND = 5;

if (embedded) {
  document.body.classList.add('embedded');
}

if (fullscreen) {
  document.body.classList.add('fullscreen');
}

function applyBaseSide() {
  gameRoot.dataset.baseSide = baseSide;
  if (baseSideButton) {
    baseSideButton.textContent = `BASE: ${baseSide.toUpperCase()}`;
  }
  if (fullscreenButton) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('baseSide', baseSide);
    nextUrl.searchParams.set('fullscreen', '1');
    fullscreenButton.href = `${nextUrl.pathname}?${nextUrl.searchParams}`;
  }
}

function cycleBaseSide() {
  baseSide = baseSide === 'left' ? 'right' : 'left';
  params.set('baseSide', baseSide);
  url.search = params.toString();
  window.history.replaceState({}, '', url);
  applyBaseSide();
  missileControl.refresh();
  commandControl.refresh();
}

if (baseSideButton) {
  baseSideButton.addEventListener('click', cycleBaseSide);
}

function updateHud() {
  const resources = commandControl.resources();
  document.getElementById('hm-value').textContent = Math.floor(resources.hm);
  document.getElementById('sm-value').textContent = Math.floor(resources.sm);
  document.getElementById('pop-value').textContent = `${resources.available} / ${resources.pop}`;
  const stats = commandControl.production();
  const core = cores.find((item) => item.owner === baseSide);
  const objective = commandControl.objective();
  const hold = Math.floor(objective.centerHold[baseSide] || 0);
  document.getElementById('building-stats').innerHTML = [
    `HOUSING ${stats.housing} / POP ${stats.population}`,
    `FARMS ${stats.farms} / +${stats.sm.toFixed(2)} SM/S`,
    `MINES ${stats.mines} / +${stats.hm.toFixed(2)} HM/S`,
    `MILITARY ${stats.military} / DEFENSE`,
    `CORE ${Math.max(0, Math.ceil(core ? core.health : 0))} / 1000`,
    `CENTER HOLD ${hold} / 60S`,
    ...(stats.floodedConstruction ? [`CONSTRUCTION PAUSED / FLOODED ${stats.floodedConstruction}`] : []),
    ...(stats.brokenLines ? [`PIPELINE BREAKS ${stats.brokenLines} / RE-LAYING FOR HM`] : []),
  ].map((line) => `<div>${line}</div>`).join('');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function screenToWorld(x, y) {
  return {
    x: x / camera.zoom + camera.x,
    y: y / camera.zoom + camera.y,
  };
}

function worldToScreen(x, y) {
  return {
    x: (x - camera.x) * camera.zoom,
    y: (y - camera.y) * camera.zoom,
  };
}

function getFitZoom() {
  return Math.min(viewport.width / WORLD_WIDTH, viewport.height / WORLD_HEIGHT);
}

function drawPixelRect(x, y, width, height, color) {
  const s = worldToScreen(x, y);
  ctx.fillStyle = color;
  ctx.fillRect(s.x, s.y, width * camera.zoom, height * camera.zoom);
}

function drawPixelLine(x1, y1, x2, y2, color, width = 1.5) {
  const a = worldToScreen(x1, y1);
  const b = worldToScreen(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width * camera.zoom;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function createLifeGrid(cols, rows, density) {
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.random() < density ? 1 : 0));
  for (let step = 0; step < 5; step += 1) grid.splice(0, grid.length, ...nextLifeGeneration(grid));
  return grid;
}

function nextLifeGeneration(grid) {
  const rows = grid.length, cols = grid[0].length;
  return grid.map((line, y) => line.map((current, x) => {
    let neighbours = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      // The reference wraps both edges, so a colony crossing the map boundary stays continuous.
      neighbours += grid[(y + dy + rows) % rows][(x + dx + cols) % cols];
    }
    return neighbours === 3 || current && neighbours === 2 ? 1 : 0;
  }));
}

function advanceLifeGrid(deltaSeconds) {
  lifeGridClock += deltaSeconds;
  while (lifeGridClock >= 1.25) {
    lifeGridClock -= 1.25;
    lifeGrid = nextLifeGeneration(lifeGrid);
    terrainTextureDirty = true;
  }
}

function cellValueAtLifeGrid(x, breadth) {
  const raw = (x / WORLD_WIDTH) * lifeGrid[0].length - 0.5;
  const position = ((raw % lifeGrid[0].length) + lifeGrid[0].length) % lifeGrid[0].length;
  const col = Math.floor(position);
  const row = clamp(Math.floor((breadth / WORLD_HEIGHT) * lifeGrid.length), 0, lifeGrid.length - 1);
  const t = position - col;
  return lerp(lifeGrid[row][col], lifeGrid[row][(col + 1) % lifeGrid[0].length],
    t * t * (3 - 2 * t));
}

function getWaterZones() {
  return waterZones;
}

function basinOffsetAt(x, basin) {
  const distance = Math.abs(x - basin.center);
  const radius = basin.width * 0.5;
  if (distance >= radius) {
    return 0;
  }

  const t = distance / radius;
  const bowl = basin.depth * (1 - t * t) * 1.35;
  const smile = Math.sin(Math.PI * t) * 4.8;
  return bowl + smile;
}

function valleyOffsetAt(x) {
  const position = x / WORLD_WIDTH;
  const smooth = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const left = smooth((position - valleyProfile.leftStart) / (valleyProfile.leftEnd - valleyProfile.leftStart));
  const right = smooth((valleyProfile.rightEnd - position) / (valleyProfile.rightEnd - valleyProfile.rightStart));
  const envelope = left * right;
  const undulation = Math.sin(position * Math.PI * 4 + valleyProfile.wavePhase) * valleyProfile.waveScale;
  return envelope * (valleyProfile.depth + valleyProfile.tilt * (position - 0.5) + undulation);
}

function terrainYAt(x) {
  let valley = valleyOffsetAt(x);
  const edgeDistance = Math.min(x, WORLD_WIDTH - x);
  const edgeBlend = clamp((edgeDistance - 260) / 300, 0, 1);
  const ruggedness = edgeBlend * edgeBlend * (3 - 2 * edgeBlend);
  const hills = terrainWaves.reduce((height, wave) =>
    height + Math.sin(x * wave.frequency + wave.phase) * wave.amplitude, 0);
  const peaks = terrainPeaks.reduce((height, peak) => {
    const falloff = Math.max(0, 1 - Math.abs(x - peak.center) / peak.width);
    return height + peak.height * Math.pow(falloff, peak.shape);
  }, 0);
  let y = 314 + Math.sin(x * 0.012) * 1.4
    + ruggedness * (hills - peaks + terrainDetail(x) + cellValueAtLifeGrid(x, 0) * 5.5);

  for (const center of NEUTRAL_CENTERS) {
    const blend = clamp((120 - Math.abs(x - center)) / 40, 0, 1);
    y = lerp(y, 314 + Math.sin(x * 0.012) * 1.4, blend * blend * (3 - 2 * blend));
  }

  // Preserve the existing basin profile, including its shorelines, with a smooth transition.
  for (const basin of getWaterZones()) {
    const distance = Math.abs(x - basin.center);
    const blend = clamp((basin.width / 2 + 56 - distance) / 48, 0, 1);
    const smoothBlend = blend * blend * (3 - 2 * blend);
    if (smoothBlend > 0) {
      y = lerp(y, 314 + Math.sin(basin.center * 0.012) * 1.4 + basinOffsetAt(x, basin), smoothBlend);
      valley = lerp(valley, valleyOffsetAt(basin.center), smoothBlend);
    }
  }
  return y + valley;
}

function surfaceYAt(x) {
  if (particleTerrain) {
    const column = clamp(Math.floor(x / PARTICLE_TERRAIN_CELL_SIZE), 0, particleTerrain.width - 1);
    return Math.min(WORLD_HEIGHT, particleTerrain.surfaceRow(column) * PARTICLE_TERRAIN_CELL_SIZE);
  }
  return terrainSurface.heightAt(x);
}

function craterSurface(center, radius = 30, depth = 14) {
  commandControl.damageRoads(center, radius);
  // Measure the blast against the ground before it is dug out, so a line breaks only where the crater reaches it.
  pipeline.damage(center, radius, depth);
  terrainSurface.crater(center, radius, depth);
  if (particleTerrain) {
    const first = Math.max(0, Math.floor((center - radius) / PARTICLE_TERRAIN_CELL_SIZE));
    const last = Math.min(particleTerrain.width - 1, Math.ceil((center + radius) / PARTICLE_TERRAIN_CELL_SIZE));
    for (let column = first; column <= last; column += 1) {
      const worldX = (column + 0.5) * PARTICLE_TERRAIN_CELL_SIZE;
      const craterDepth = depth * Math.max(0, 1 - Math.abs(worldX - center) / radius);
      if (craterDepth <= 0) continue;
      const top = particleTerrain.surfaceRow(column);
      const bottom = Math.min(particleTerrain.height - 1,
        top + Math.max(0, Math.ceil(craterDepth / PARTICLE_TERRAIN_CELL_SIZE) - 1));
      if (top < particleTerrain.height && bottom >= top) particleTerrain.excavate(column, top, column, bottom);
    }
    terrainTextureDirty = true;
  }
  for (const pool of waterPools) {
    if (center + radius >= pool.left && center - radius <= pool.right) reshapeWater(pool);
  }
}

function waterLevelAt(x) {
  const pool = waterPools.find((item) => x >= item.left && x <= item.right && surfaceYAt(x) > item.level);
  if (!pool) return null;
  if (!particleTerrain) return pool.level;
  const column = clamp(Math.floor(x / PARTICLE_TERRAIN_CELL_SIZE), 0, particleTerrain.width - 1);
  for (let row = 0; row < particleTerrain.height; row += 1) {
    if (particleTerrain.at(column, row) === PARTICLE_WATER) return row * PARTICLE_TERRAIN_CELL_SIZE;
  }
  return null;
}

function splashWater(x) {
  const level = waterLevelAt(x);
  if (level === null) return;
  for (let i = 0; i < 18; i += 1) {
    waterDrops.push({ x, y: level, vx: (Math.random() - 0.5) * 90, vy: -25 - Math.random() * 65, age: 0 });
  }
}

function breakBuilding(building, mark) {
  const width = building.width;
  const ground = Math.min(surfaceYAt(building.x), surfaceYAt(building.x + width));
  const top = ground - building.height;
  const fractureY = clamp(top + mark.y, top + 2, ground - 2);
  const direction = mark.x < width / 2 ? -1 : 1;
  collapsedBuildings.push({
    x: building.x, width, top, ground, fractureY, direction,
    color: buildingColor(building), angle: 0, angularVelocity: 0, age: 0,
  });
  const count = 14 + Math.floor(Math.random() * 9);
  for (let index = 0; index < count; index += 1) {
    const x = building.x + Math.random() * width;
    const y = fractureY + Math.random() * Math.max(2, ground - fractureY);
    const speed = 45 + Math.random() * 150;
    buildingDebris.push({ source: building, x, y, vx: (Math.random() - 0.5) * speed * 2 + direction * 25,
      vy: -30 - Math.random() * speed, width: 2 + Math.random() * 4, height: 2 + Math.random() * 4,
      rotation: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 8,
      color: Math.random() < 0.35 ? '#ddc780' : buildingColor(building), age: 0 });
  }
  if (building.rebuildHeight === undefined) building.rebuildHeight = building.height;
  building.height = Math.max(2, ground - fractureY);
  building.damageMarks = [];
}

function waterShape(pool, level) {
  const step = 2;
  const center = pool.center;
  function shore(direction) {
    let wet = center;
    for (let x = center + direction * step; x >= pool.minX && x <= pool.maxX; x += direction * step) {
      if (surfaceYAt(x) <= level) {
        const ratio = (surfaceYAt(wet) - level) / (surfaceYAt(wet) - surfaceYAt(x));
        return lerp(wet, x, ratio);
      }
      wet = x;
    }
    return wet;
  }
  const left = shore(-1);
  const right = shore(1);
  let area = 0;
  for (let x = left; x < right; x += step) {
    const width = Math.min(step, right - x);
    area += Math.max(0, surfaceYAt(x + width / 2) - level) * width;
  }
  return { left, right, area };
}

function reshapeWater(pool) {
  let low = Math.min(surfaceYAt(pool.minX), surfaceYAt(pool.maxX));
  let high = surfaceYAt(pool.center);
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (waterShape(pool, mid).area > pool.volume) low = mid;
    else high = mid;
  }
  pool.level = (low + high) / 2;
  const shape = waterShape(pool, pool.level);
  pool.left = shape.left;
  pool.right = shape.right;
}

function createWaterPools() {
  return getWaterZones().map((basin) => {
    const left = basin.center - basin.width / 2;
    const right = basin.center + basin.width / 2;
    const level = Math.max(surfaceYAt(left), surfaceYAt(right)) + 2;
    const center = basin.center;
    if (surfaceYAt(center) <= level) return null;

    function findShore(edge) {
      let wet = center;
      const direction = Math.sign(edge - center);
      let next = direction < 0 ? Math.floor(center / 4) * 4 : Math.ceil(center / 4) * 4;
      if (next === center) next += direction * 4;
      while (direction * (edge - next) > 0) {
        if (surfaceYAt(next) <= level) {
          const ratio = (surfaceYAt(wet) - level) / (surfaceYAt(wet) - surfaceYAt(next));
          return lerp(wet, next, ratio);
        }
        wet = next;
        next += direction * 4;
      }
      const ratio = (surfaceYAt(wet) - level) / (surfaceYAt(wet) - surfaceYAt(edge));
      return lerp(wet, edge, ratio);
    }

    const pool = { left: findShore(left), right: findShore(right), level, center,
      minX: Math.max(0, left - 48), maxX: Math.min(WORLD_WIDTH, right + 48) };
    pool.volume = waterShape(pool, level).area;
    return pool;
  }).filter((pool) => pool !== null);
}

function isWaterAtFootprint(x, width) {
  return waterPools.some((pool) => x < pool.right && x + width > pool.left);
}

function canBuildOnTerrain(x, width) {
  return x >= 0 && x + width <= WORLD_WIDTH && !isWaterAtFootprint(x, width);
}

function findDryPosition(preferredX, width, occupied = [], minX = 0, maxX = WORLD_WIDTH) {
  for (let distance = 0; distance <= WORLD_WIDTH; distance += 1) {
    const candidates = distance === 0 ? [preferredX] : [preferredX - distance, preferredX + distance];
    for (const x of candidates) {
      if (x >= minX && x + width <= maxX && canBuildOnTerrain(x, width)
        && !occupied.some((item) => x < item.x + item.width + 2 && x + width + 2 > item.x)) {
        return x;
      }
    }
  }
  throw new Error(`No dry space available for a ${width}px building near x=${Math.round(preferredX)} inside ${Math.round(minX)}-${Math.round(maxX)}`);
}

function createResourceNodes() {
  const startingNodes = cores.map((core, index) => {
    const x = core.x + (index === 0 ? 110 : -110);
    const start = Math.min(x, core.x);
    const end = Math.max(x, core.x);
    let ground = 0;
    for (let sample = start; sample <= end; sample += 4) {
      ground = Math.max(ground, surfaceYAt(sample));
    }
    return { x, y: ground + 90, size: 12, amount: 500, startingSide: index };
  });
  const nodes = startingNodes.slice();
  for (let index = 0; index < 19; index += 1) {
    let node;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const neighbor = index >= 4 && Math.random() < 0.4
        ? nodes[2 + Math.floor(Math.random() * (nodes.length - 2))]
        : null;
      const x = neighbor
        ? neighbor.x + (Math.random() * 2 - 1) * 180
        : 40 + (index < 4 ? (index + Math.random()) / 4 : Math.random()) * (WORLD_WIDTH - 80);
      if (x < 40 || x > WORLD_WIDTH - 40) continue;
      const ground = surfaceYAt(x);
      const minY = ground + 45;
      const maxY = Math.min(WORLD_HEIGHT - 20, ground + 250);
      const y = neighbor
        ? clamp(neighbor.y + (Math.random() * 2 - 1) * 80, minY, maxY)
        : minY + Math.random() * (maxY - minY);
      const size = 7 + Math.floor(Math.random() * 3) * 3;
      if (nodes.some((other) => Math.hypot(x - other.x, y - other.y) < (size + other.size) / 2 + 20)) continue;
      node = { x, y, size, amount: 200 + (size - 7) * 50 };
      break;
    }
    if (!node) throw new Error('Unable to place underground resource node');
    nodes.push(node);
  }
  return nodes;
}

function createStarterTunnels() {
  return cores.map((core, index) => {
    const node = resourceNodes[index];
    return {
      side: index,
      node,
      interiorWidth: TUNNEL_INTERIOR_WIDTH,
      style: factionArchitectureStyles[core.owner],
      points: [
        { x: core.x, y: surfaceYAt(core.x) },
        { x: core.x, y: node.y },
        { x: node.x, y: node.y },
      ],
    };
  });
}

function buildBuildingBlueprints() {
  const clusters = [
    { isLeft: true }, { isLeft: true }, { isLeft: true },
    { isLeft: false }, { isLeft: false }, { isLeft: false },
    ...neutralTerritories.map((territory) => ({ center: territory.center, isLeft: true, neutral: true })),
  ];
  const layouts = [];
  const occupied = cores.map((core) => ({ x: core.x - core.width / 2, width: core.width }));
  const populationKinds = ['flat', 'tower', 'bunker', 'shed'];
  const populationVariants = ['slab', 'offset', 'tapered', 'crown'];
  const farmVariants = ['silos', 'barn'];
  const militaryVariants = ['compound', 'fortress', 'command', 'bastion'];
  let leftCursor = Math.max(180, cores[0].x + cores[0].width / 2 + 18);
  let rightCursor = Math.min(WORLD_WIDTH - 180, cores[1].x - cores[1].width / 2 - 18);

  clusters.forEach((cluster, clusterIndex) => {
    const clusterBuildings = [];
    const minX = cluster.neutral ? WORLD_WIDTH * 0.2 : cluster.isLeft ? 0 : WORLD_WIDTH * 0.8 - 220;
    const maxX = cluster.neutral ? WORLD_WIDTH * 0.8 : cluster.isLeft ? WORLD_WIDTH * 0.2 + 220 : WORLD_WIDTH;
    const specs = [];
    for (let i = 0; i < populationKinds.length; i += 1) {
      const seed = clusterIndex * 17 + i * 7;
      specs.push({ kind: populationKinds[i], artType: 'population', variant: populationVariants[i], seed,
        level: cluster.neutral ? 1 : 1 + ((clusterIndex + i) % 3), population: cluster.neutral ? 1 : i < (clusterIndex % 3 === 0 ? 4 : 3) ? 1 : 0 });
    }
    for (let i = 0; i < 2; i += 1) {
      specs.push({ kind: 'farm', artType: 'farm', variant: farmVariants[i], seed: clusterIndex * 5 + i,
        level: 1, population: 0 });
    }
    if (cluster.neutral) specs.push({ kind: 'mine', artType: 'farm', variant: 'elevator', seed: clusterIndex + 31,
      level: 1, population: 0 });
    specs.push({ kind: 'military', artType: 'military', variant: militaryVariants[clusterIndex % militaryVariants.length],
      seed: clusterIndex, level: cluster.neutral ? 1 : 1 + clusterIndex % 4, population: 0 });

    const gap = 6;
    const widths = specs.map((spec) => getUrbanPixelBuildingFootprintForVariant(spec.artType, spec.variant));
    const span = widths.reduce((sum, width) => sum + width, 0) + gap * (specs.length - 1);
    let direction, cursor, bandMin, bandMax;
    if (cluster.neutral) {
      const neutralIndex = clusterIndex - 6;
      bandMin = WORLD_WIDTH * (0.2 + neutralIndex * 0.2) - 180;
      bandMax = WORLD_WIDTH * (0.4 + neutralIndex * 0.2) + 180;
      cursor = Math.max(bandMin, Math.min(bandMax - span, cluster.center - span / 2));
      direction = 1;
    } else if (cluster.isLeft) {
      bandMin = minX; bandMax = maxX;
      cursor = leftCursor; direction = 1;
    } else {
      bandMin = minX; bandMax = rightCursor;
      cursor = rightCursor; direction = -1;
    }

    specs.forEach((spec, index) => {
      const width = widths[index];
      const preferred = direction > 0 ? cursor : cursor - width;
      const x = findDryPosition(preferred, width, occupied, direction > 0 ? cursor : bandMin,
        direction > 0 ? bandMax : cursor);
      const owner = cluster.neutral ? 'neutral' : cluster.isLeft ? 'left' : 'right';
      const building = {
        x, width, pixelFootprint: width, artVariant: spec.variant, height: 1, kind: spec.kind,
        seed: spec.seed, level: spec.level, health: 100, neutral: Boolean(cluster.neutral), owner,
        cluster: clusterIndex, population: spec.population, direction: cluster.isLeft ? 1 : -1,
        ...(cluster.neutral ? { construction: { stage: 0, progress: 0 } } : {}),
        ...(spec.kind === 'farm' ? { cropLeft: 0, cropRight: 0, waterSources: [] } : {}),
        ...(spec.kind === 'military' ? { defenseHealth: 100 } : {}),
      };
      syncUrbanPixelBuildingMetrics(building, factionArchitectureStyles);
      layouts.push(building);
      occupied.push(building);
      clusterBuildings.push(building);
      cursor = direction > 0 ? x + width + gap : x - gap;
    });

    if (!cluster.neutral && cluster.isLeft) leftCursor = cursor + 8;
    if (!cluster.neutral && !cluster.isLeft) rightCursor = cursor - 8;
  });

  return layouts;
}

function farmBuildingBounds(building) {
  return {
    left: building.x,
    right: building.x + building.width,
  };
}

function farmWaterSources(farm) {
  const farmX = farm.x + farm.width / 2;
  return waterPools.map((pool) => {
    const intakeX = (pool.left + pool.right) / 2;
    const distance = Math.abs(farmX - intakeX);
    let area = 0;
    for (let x = pool.left; x < pool.right; x += 4) {
      const step = Math.min(4, pool.right - x);
      area += Math.max(0, surfaceYAt(x + step / 2) - pool.level) * step;
    }
    return { pool, intakeX, distance, area };
  }).filter((source) => source.distance <= FARM_MAX_SOURCE_DISTANCE && source.area > 0)
    .sort((a, b) => a.distance - b.distance);
}

function updateFarmGrowth(farm, deltaSeconds) {
  const sources = farm.availableWaterSources;
  const totalGrowth = farm.cropLeft + farm.cropRight;
  const sourceCount = Math.min(sources.length, 1 + Math.floor(totalGrowth / FARM_ADDITIONAL_SOURCE_GROWTH));
  farm.waterSources = sources.slice(0, sourceCount);
  const capacity = farm.waterSources.reduce((sum, source) =>
    sum + (!commandControl.farmWatered(farm, source) ? 0
      : Math.sqrt(source.area) * 1.5 * (1 - 0.6 * source.distance / FARM_MAX_SOURCE_DISTANCE)), 0);
  let remaining = Math.min(FARM_GROWTH_PER_SECOND * deltaSeconds, Math.max(0, capacity - totalGrowth));
  const farmBounds = farmBuildingBounds(farm);
  const obstacles = buildingBlueprints.filter((building) => building !== farm).map((building) => {
    const bounds = farmBuildingBounds(building);
    return {
      left: bounds.left - (building.kind === 'farm' ? building.cropLeft : 0),
      right: bounds.right + (building.kind === 'farm' ? building.cropRight : 0),
    };
  }).concat(cores.map((core) => ({ left: core.x - core.width / 2, right: core.x + core.width / 2 })))
    .concat(waterPools.map((pool) => ({ left: pool.left, right: pool.right })));
  const leftLimit = Math.max(0, ...obstacles.filter((item) => item.right <= farmBounds.left).map((item) => item.right + 2));
  const rightLimit = Math.min(WORLD_WIDTH, ...obstacles.filter((item) => item.left >= farmBounds.right).map((item) => item.left - 2));
  const leftSpace = Math.max(0, farmBounds.left - farm.cropLeft - leftLimit);
  const rightSpace = Math.max(0, rightLimit - farmBounds.right - farm.cropRight);
  const leftGrowth = Math.min(leftSpace, remaining / 2);
  const rightGrowth = Math.min(rightSpace, remaining / 2);
  farm.cropLeft += leftGrowth;
  farm.cropRight += rightGrowth;
  remaining -= leftGrowth + rightGrowth;
  const extraLeft = Math.min(leftSpace - leftGrowth, remaining);
  farm.cropLeft += extraLeft;
  remaining -= extraLeft;
  farm.cropRight += Math.min(rightSpace - rightGrowth, remaining);
}

function drawWaterPools() {
  ctx.save();
  ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  for (const pool of waterPools) {
    for (let x = Math.ceil(pool.left / 24) * 24; x < pool.right; x += 24) {
      const level = waterLevelAt(x + 1);
      if (level === null) continue;
      const shimmer = Math.sin(x * 0.07 + state.time * 0.12) > 0.15;
      ctx.fillStyle = shimmer ? '#7bcbd0' : '#397d88';
      ctx.fillRect(x, level, 6 + (Math.floor(x / 24) % 3) * 2, 1);
    }
  }
  for (const drop of waterDrops) {
    ctx.fillStyle = '#4aabba';
    ctx.fillRect(Math.round(drop.x), Math.round(drop.y), 2, 3);
    ctx.fillStyle = '#a0e3db';
    ctx.fillRect(Math.round(drop.x), Math.round(drop.y), 1, 1);
  }
  ctx.restore();
}

function drawWorldBackdrop() {
  const gradient = ctx.createLinearGradient(0, 0, 0, viewport.height);
  gradient.addColorStop(0, '#020403');
  gradient.addColorStop(0.72, '#050b08');
  gradient.addColorStop(1, '#101713');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  for (const star of skyDetails) {
    const screen = worldToScreen(star.x, star.y);
    if (screen.x < -2 || screen.x > viewport.width + 2 || screen.y < -2 || screen.y > viewport.height + 2) continue;
    ctx.globalAlpha = star.brightness;
    ctx.fillStyle = star.brightness > 0.65 ? '#b9cf8b' : '#697d57';
    ctx.fillRect(Math.round(screen.x), Math.round(screen.y), 1, 1);
  }
  ctx.globalAlpha = 1;
}

function refreshTerrainParticleTexture() {
  if (!particleTerrain) return;
  const desiredStep = camera.zoom < 0.35 ? 4 : camera.zoom < 0.9 ? 2 : 1;
  if (desiredStep !== terrainTextureStep) {
    terrainTextureStep = desiredStep;
    terrainTextureCanvas.width = Math.ceil(particleTerrain.width / terrainTextureStep);
    terrainTextureCanvas.height = Math.ceil(particleTerrain.height / terrainTextureStep);
    terrainTextureImage = terrainTextureContext.createImageData(terrainTextureCanvas.width, terrainTextureCanvas.height);
    terrainTextureDirty = true;
  }
  if (!terrainTextureDirty) return;
  particleTerrain.copyCells(particleTerrainCells);
  const { width: sourceWidth, height: sourceHeight } = particleTerrain;
  const width = terrainTextureCanvas.width, height = terrainTextureCanvas.height;
  const pixels = terrainTextureImage.data;
  pixels.fill(0);
  const surfaceRows = new Int32Array(width);
  // Sample the centre cell of each texel; at step 1 that is the cell itself (an integer column).
  const half = terrainTextureStep >> 1;
  for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(sourceWidth - 1, x * terrainTextureStep + half);
    surfaceRows[x] = particleTerrain.surfaceRow(sourceX);
  }
  const soil = [[82, 67, 46], [70, 57, 40], [59, 49, 36], [49, 42, 33]];
  for (let y = 0; y < height; y += 1) {
    const lifeRow = Math.min(lifeGrid.length - 1, Math.floor(y / height * lifeGrid.length));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, x * terrainTextureStep + half);
      const sourceY = Math.min(sourceHeight - 1, y * terrainTextureStep + half);
      const material = particleTerrainCells[sourceY * sourceWidth + sourceX];
      if (material === PARTICLE_EMPTY) continue;
      let hash = Math.imul(x + 1, 0x45d9f3b);
      hash ^= Math.imul(y + 3, 0x119de1f3);
      hash = Math.imul(hash ^ hash >>> 16, 0x45d9f3b);
      const noise = hash >>> 0;
      let color;
      if (material === PARTICLE_WATER) {
        color = noise & 2 ? [46, 113, 125] : [37, 91, 105];
      } else if (material === PARTICLE_DEBRIS) {
        color = noise & 1 ? [171, 116, 62] : [127, 85, 51];
      } else if (material === PARTICLE_TERRAIN || material === PARTICLE_WALL) {
        const depth = sourceY - surfaceRows[x];
        const lifeColumn = Math.min(lifeGrid[0].length - 1,
          Math.floor(x / width * lifeGrid[0].length));
        const alive = lifeGrid[lifeRow][lifeColumn] === 1;
        if (depth < 3) color = alive && (noise & 3) === 0 ? [119, 146, 75] : [77, 92, 57];
        else if (alive && (noise & 7) === 0) color = [75, 96, 57];
        else color = soil[Math.min(soil.length - 1, Math.floor(Math.max(0, depth) / 56) + (noise & 1))];
      } else {
        color = [90, 96, 69];
      }
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  terrainTextureContext.putImageData(terrainTextureImage, 0, 0);
  terrainTextureDirty = false;
}

function drawTerrainMass() {
  refreshTerrainParticleTexture();
  ctx.save();
  ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainTextureCanvas, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  ctx.restore();
}

function drawSurfaceDetails() {
  const left = camera.x - 40;
  const right = camera.x + viewport.width / camera.zoom + 40;
  ctx.save();
  ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  for (const detail of surfaceDetails) {
    if (detail.x < left || detail.x > right) continue;
    const ground = surfaceYAt(detail.x);
    const vitality = cellValueAtLifeGrid(detail.x, detail.lifeRow * WORLD_HEIGHT / lifeGrid.length);
    if (detail.type === 'tree') {
      ctx.fillStyle = vitality > 0.55 ? '#31583e' : '#3c4935';
      ctx.fillRect(detail.x - 1, ground - detail.size * 1.8, 2, detail.size * 1.8);
      ctx.fillStyle = vitality > 0.55 ? '#4d8552' : '#465743';
      ctx.fillRect(detail.x - detail.size, ground - detail.size * 2.7, detail.size * 2, detail.size * 1.5);
      ctx.fillStyle = vitality > 0.55 ? '#77a866' : '#58694a';
      ctx.fillRect(detail.x - detail.size * 0.5, ground - detail.size * 2.5, detail.size, detail.size * 0.6);
    } else if (detail.type === 'rock') {
      ctx.fillStyle = '#727468';
      ctx.fillRect(detail.x - detail.size, ground - detail.size, detail.size * 2, detail.size);
      ctx.fillStyle = '#9b9a85';
      ctx.fillRect(detail.x - detail.size * 0.4, ground - detail.size, detail.size, Math.max(1, detail.size * 0.3));
    } else {
      if (vitality < 0.18) continue;
      ctx.strokeStyle = vitality > 0.55 ? '#6d9660' : '#526949';
      ctx.lineWidth = 0.8;
      for (let blade = 0; blade < 3; blade += 1) {
        const offset = blade - 1;
        ctx.beginPath();
        ctx.moveTo(detail.x + offset * 2, ground);
        ctx.lineTo(detail.x + offset * 2 + Math.sin(detail.phase + blade) * 2, ground - detail.size);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawSurfaceProfile() {
  const left = Math.max(0, Math.floor(camera.x / PARTICLE_TERRAIN_CELL_SIZE) * PARTICLE_TERRAIN_CELL_SIZE);
  const right = Math.min(world.width, camera.x + viewport.width / camera.zoom + PARTICLE_TERRAIN_CELL_SIZE);
  ctx.save();
  ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  const firstY = surfaceYAt(left);
  ctx.beginPath();
  ctx.moveTo(left, firstY + PARTICLE_TERRAIN_CELL_SIZE / 2);
  let previousY = firstY + PARTICLE_TERRAIN_CELL_SIZE / 2;
  for (let x = left; x < right; x += PARTICLE_TERRAIN_CELL_SIZE) {
    const nextY = surfaceYAt(Math.min(right, x + PARTICLE_TERRAIN_CELL_SIZE)) + PARTICLE_TERRAIN_CELL_SIZE / 2;
    ctx.lineTo(x + PARTICLE_TERRAIN_CELL_SIZE, previousY);
    ctx.lineTo(x + PARTICLE_TERRAIN_CELL_SIZE, nextY);
    previousY = nextY;
  }
  ctx.strokeStyle = '#789552';
  ctx.lineWidth = PARTICLE_TERRAIN_CELL_SIZE;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.restore();
}

function drawUnderground() {
  ctx.save();
  ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  for (const military of buildingBlueprints.filter((building) => building.kind === 'military' && building.level >= 2)) {
    for (let i = 0; i < military.level - 1; i += 1) {
      const mineX = clamp(military.x + military.width / 2 + military.direction * (35 + i * 14), 4, WORLD_WIDTH - 4);
      const mineY = surfaceYAt(mineX) + 7;
      worldObjectRenderer.defensiveMine(ctx, mineX, mineY, buildingColor(military));
    }
  }
  commandControl.drawTunnels();
  // Supply lines draw after the tunnels so a tube crossing a bore reads as a bridge over it.
  pipeline.draw(ctx, { left: camera.x - 40, right: camera.x + viewport.width / camera.zoom + 40 });
  ctx.shadowBlur = 0;
  for (const node of resourceNodes) {
    ctx.fillStyle = '#9babb0';
    const size = node.size;
    ctx.fillRect(node.x - size / 2, node.y - size / 4, size, size / 2);
    ctx.fillRect(node.x - size / 4, node.y - size / 2, size / 2, size);
    ctx.fillStyle = '#d9e3e3';
    ctx.fillRect(node.x - size / 4, node.y - size / 4, size / 3, size / 3);
  }
  ctx.restore();
}

function drawBattlefield() {
  ctx.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  drawWorldBackdrop();
  drawTerrainMass();
  drawUnderground();
  drawWaterPools();
  drawSurfaceProfile();
  drawSettlements();
  drawCollapsedBuildings();
  commandControl.draw();
  drawSurfaceDetails();
  drawBuildingDebris();
  missileControl.draw();

}

function drawBuildingDebris() {
  ctx.save();
  ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  for (const piece of buildingDebris) {
    if (piece.deposited) continue;
    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.rotation);
    ctx.globalAlpha = Math.max(0, 1 - piece.age / 18);
    ctx.fillStyle = piece.color;
    ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
    ctx.restore();
  }
  ctx.restore();
}

function updateDebrisAndWaterDrops(deltaSeconds) {
  for (let i = collapsedBuildings.length - 1; i >= 0; i -= 1) {
    const piece = collapsedBuildings[i];
    piece.age += deltaSeconds;
    piece.angularVelocity = Math.min(2.2, piece.angularVelocity + 2.5 * deltaSeconds);
    piece.angle = piece.direction * Math.min(Math.PI / 2, Math.abs(piece.angle) + piece.angularVelocity * deltaSeconds);
    if (piece.age >= 12) collapsedBuildings.splice(i, 1);
  }
  for (let i = buildingDebris.length - 1; i >= 0; i -= 1) {
    const piece = buildingDebris[i];
    piece.age += deltaSeconds;
    if (piece.resting) {
      if (!piece.deposited && particleTerrain && waterLevelAt(piece.x) === null) {
        const column = clamp(Math.floor(piece.x / PARTICLE_TERRAIN_CELL_SIZE), 0, particleTerrain.width - 1);
        const row = Math.max(0, particleTerrain.surfaceRow(column) - 1);
        let deposited = false;
        for (const offset of [0, -1, 1]) {
          const x = column + offset;
          if (x < 0 || x >= particleTerrain.width) continue;
          if (particleTerrain.emitDebris(x, row).ok) deposited = true;
        }
        piece.deposited = deposited;
        terrainTextureDirty ||= deposited;
      }
      if (piece.age > 18) buildingDebris.splice(i, 1);
      continue;
    }
    let removed = false;
    const maxMove = Math.max(Math.abs(piece.vx), Math.abs(piece.vy)) * deltaSeconds;
    const steps = Math.max(1, Math.min(12, Math.ceil(maxMove / 2)));
    const step = deltaSeconds / steps;
    const halfWidth = piece.width / 2, halfHeight = piece.height / 2;
    for (let sample = 0; sample < steps && !removed; sample += 1) {
      const previousX = piece.x, previousY = piece.y;
      piece.vx = clamp(piece.vx * Math.pow(0.998, step * 60), -340, 340);
      piece.vy = clamp(piece.vy + 270 * step, -340, 340);
      piece.x += piece.vx * step;
      piece.y += piece.vy * step;
      piece.rotation += piece.spin * step;
      piece.collisionCooldown = Math.max(0, (piece.collisionCooldown || 0) - step);

      let collided = false;
      if (piece.vy >= 0 && piece.age > 0.04) for (const building of buildingBlueprints) {
        if (building === piece.source || building.health <= 0) continue;
        const left = building.x, right = building.x + building.width;
        const ground = Math.min(surfaceYAt(left), surfaceYAt(right));
        const top = ground - building.height;
        const overlaps = piece.x + halfWidth > left && piece.x - halfWidth < right &&
          piece.y + halfHeight > top && piece.y - halfHeight < ground;
        if (!overlaps) continue;

        const landedOnRoof = previousY + halfHeight <= top + 1 && piece.vy > 0;
        if (landedOnRoof) {
          piece.y = top - halfHeight;
          if (piece.collisionCooldown <= 0) {
            const impact = Math.abs(piece.vy) + Math.abs(piece.vx) * 0.35;
            const damage = Math.min(16, 1.5 + impact * 0.035);
            building.health = Math.max(0, building.health - damage);
            if (!building.damageMarks) building.damageMarks = [];
            let mark = building.damageMarks.find((item) => Math.abs(item.x - (piece.x - building.x)) < 4);
            if (!mark) { mark = { x: piece.x - building.x, y: 2, damage: 0 }; building.damageMarks.push(mark); }
            mark.damage = Math.min(100, mark.damage + damage * 4);
            piece.collisionCooldown = 0.18;
          }
          piece.vy = -Math.abs(piece.vy) * 0.28;
          piece.vx *= 0.68;
        } else {
          const impact = Math.abs(piece.vy) + Math.abs(piece.vx) * 0.5;
          if (piece.collisionCooldown <= 0) {
            const damage = Math.min(16, 1.5 + impact * 0.04);
            building.health = Math.max(0, building.health - damage);
            if (!building.damageMarks) building.damageMarks = [];
            const localX = clamp(piece.x - building.x, 0, building.width);
            let mark = building.damageMarks.find((item) => Math.abs(item.x - localX) < 4);
            if (!mark) { mark = { x: localX, y: clamp(piece.y - top, 0, building.height), damage: 0 }; building.damageMarks.push(mark); }
            mark.damage = Math.min(100, mark.damage + damage * 4);
            piece.collisionCooldown = 0.22;
          }
          piece.x = previousX - Math.sign(piece.vx || 1) * halfWidth;
          piece.vx *= -0.32;
          piece.vy *= 0.72;
        }
        collided = true;
        break;
      }
      if (collided) continue;

      const ground = surfaceYAt(piece.x);
      const water = waterLevelAt(piece.x);
      const contactY = water === null ? ground : Math.min(ground, water);
      if (piece.y + halfHeight >= contactY) {
        piece.y = contactY - halfHeight;
        if (water !== null) splashWater(piece.x);
        piece.vy = -Math.abs(piece.vy) * (water === null ? 0.2 : 0.12);
        piece.vx *= water === null ? 0.72 : 0.42;
        if (Math.abs(piece.vy) < 22 && Math.abs(piece.vx) < 12) {
          piece.vy = 0;
          piece.vx = 0;
          piece.spin = 0;
          piece.resting = true;
        }
      }
      if (piece.x < 0 || piece.x > WORLD_WIDTH || piece.age > 18) {
        removed = true;
        break;
      }
    }
    if (removed) {
      buildingDebris.splice(i, 1);
    }
  }
  for (let i = waterDrops.length - 1; i >= 0; i -= 1) {
    const drop = waterDrops[i];
    drop.age += deltaSeconds;
    drop.x += drop.vx * deltaSeconds;
    drop.y += drop.vy * deltaSeconds;
    drop.vy += 120 * deltaSeconds;
    if (drop.age > 1.5 || drop.y >= surfaceYAt(drop.x) || (waterLevelAt(drop.x) !== null && drop.y >= waterLevelAt(drop.x))) waterDrops.splice(i, 1);
  }
}

function updateBuildings(deltaSeconds) {
  for (let i = buildingBlueprints.length - 1; i >= 0; i -= 1) {
    const building = buildingBlueprints[i];
    const buildingWidth = building.width;
    if (isWaterAtFootprint(building.x, buildingWidth)) {
      building.health = Math.max(0, building.health - WATER_DAMAGE_PER_SECOND * deltaSeconds);
    } else {
      commandControl.repairBuilding(building, deltaSeconds);
      if (building.captured && building.health > 0 && building.kind === 'military') {
        building.defenseHealth = Math.min(100, building.defenseHealth + 2 * deltaSeconds);
      }
    }
    if (building.health <= 0) {
      commandControl.buildingRemoved(building);
      buildingBlueprints.splice(i, 1);
    }
  }
  for (const building of buildingBlueprints) {
    if (building.kind === 'farm') updateFarmGrowth(building, deltaSeconds);
  }
}

function updateWorldState(deltaSeconds) {
  advanceLifeGrid(deltaSeconds);
  particleTerrainClock += deltaSeconds;
  while (particleTerrainClock >= 0.18) {
    particleTerrainClock -= 0.18;
    particleTerrain.step();
    terrainTextureClock += 0.18;
    if (terrainTextureClock >= 0.36) {
      terrainTextureClock -= 0.36;
      terrainTextureDirty = true;
    }
  }
  updateDebrisAndWaterDrops(deltaSeconds);
  missileControl.update(deltaSeconds);
  commandControl.update(deltaSeconds);
  world.explosionPhase = 0;
  world.craterSize = 0;
  world.craterX = world.width * 0.5;
  updateBuildings(deltaSeconds);
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  camera.dragging = true;
  camera.moved = false;
  canvas.setPointerCapture(event.pointerId);
  camera.dragStartX = event.clientX;
  camera.dragStartY = event.clientY;
  camera.cameraStartX = camera.x;
  camera.cameraStartY = camera.y;
  canvas.classList.add('dragging');
}

function clampCamera() {
  const visibleWorldWidth = viewport.width / camera.zoom;
  const visibleWorldHeight = viewport.height / camera.zoom;

  camera.x = visibleWorldWidth >= WORLD_WIDTH
    ? (WORLD_WIDTH - visibleWorldWidth) / 2
    : clamp(camera.x, 0, WORLD_WIDTH - visibleWorldWidth);
  camera.y = visibleWorldHeight >= WORLD_HEIGHT
    ? (WORLD_HEIGHT - visibleWorldHeight) / 2
    : clamp(camera.y, 0, WORLD_HEIGHT - visibleWorldHeight);
}

function resizeViewport(width, height) {
  if (width <= 0 || height <= 0) return;
  const oldFit = viewport.width ? getFitZoom() : 0;
  const centerX = oldFit ? camera.x + viewport.width / (2 * camera.zoom) : WORLD_WIDTH / 2;
  const centerY = oldFit ? camera.y + viewport.height / (2 * camera.zoom) : WORLD_HEIGHT / 2;
  const relativeZoom = oldFit ? camera.zoom / oldFit : 1;
  viewport.width = width;
  viewport.height = height;
  viewport.pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * viewport.pixelRatio);
  canvas.height = Math.round(height * viewport.pixelRatio);
  ctx.imageSmoothingEnabled = false;
  camera.zoom = getFitZoom() * relativeZoom;
  camera.x = centerX - width / (2 * camera.zoom);
  camera.y = centerY - height / (2 * camera.zoom);
  clampCamera();
}

function onPointerMove(event) {
  commandControl.pointerMove(event.clientX, event.clientY);
  if (!camera.dragging) return;
  if (Math.hypot(event.clientX - camera.dragStartX, event.clientY - camera.dragStartY) > 5) camera.moved = true;
  const dx = (event.clientX - camera.dragStartX) / camera.zoom;
  const dy = (event.clientY - camera.dragStartY) / camera.zoom;
  camera.x = camera.cameraStartX - dx;
  camera.y = camera.cameraStartY - dy;
  clampCamera();
}

function onPointerUp(event) {
  if (camera.dragging && !camera.moved && event.type === 'pointerup') {
    if (!commandControl.handleClick(event.clientX, event.clientY)) {
      missileControl.handleClick(event.clientX, event.clientY);
    }
  }
  camera.dragging = false;
  canvas.classList.remove('dragging');
}

function onWheel(event) {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left - canvas.clientLeft;
  const mouseY = event.clientY - rect.top - canvas.clientTop;
  const worldPoint = screenToWorld(mouseX, mouseY);
  const oldZoom = camera.zoom;
  if (event.deltaY === 0) return;
  const nextZoom = clamp(oldZoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), getFitZoom(), getFitZoom() * MAX_ZOOM_FACTOR);

  camera.zoom = nextZoom;
  camera.x = worldPoint.x - mouseX / camera.zoom;
  camera.y = worldPoint.y - mouseY / camera.zoom;
  clampCamera();
}

const simulationClock = createFixedStepClock(updateWorldState);
function frame(timestamp) {
  simulationClock.advance(timestamp);
  state.time += 1;
  drawBattlefield();
  updateHud();
  requestAnimationFrame(frame);
}

applyBaseSide();
updateHud();
resizeViewport(canvas.clientWidth, canvas.clientHeight);
new ResizeObserver((entries) => {
  const { width, height } = entries[0].contentRect;
  resizeViewport(width, height);
}).observe(canvas);
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('lostpointercapture', onPointerUp);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.style.cursor = 'grab';
canvas.classList.add('pixel-art');
if (params.get('particleMapLab') !== '1') requestAnimationFrame(frame);
