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
const TUNNEL_INTERIOR_WIDTH = 14;
const TUNNEL_WALL_WIDTH = 1.5;
const FARM_BUILDING_WIDTH = 14;
const factionArchitectureStyles = createFactionArchitectureStyles();
const FARM_MAX_SOURCE_DISTANCE = 1200;
const FARM_ADDITIONAL_SOURCE_GROWTH = 12;
const FARM_GROWTH_PER_SECOND = 2;
const IRRIGATION_REPAIR_SECONDS = 8;
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

const lifeGrid = createLifeGrid(72, 7, 0.18);
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
const waterDrops = [];
const collapsedBuildings = [];
const cores = [
  { x: findDryPosition(169, 36) + 11, owner: 'left' },
  { x: findDryPosition(WORLD_WIDTH - 451, 36) + 11, owner: 'right' },
];
const neutralTerritories = NEUTRAL_CENTERS.map((center) => ({
  center,
  owner: 'neutral',
}));
const resourceNodes = createResourceNodes();
const starterTunnels = createStarterTunnels();
const buildingBlueprints = buildBuildingBlueprints();
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
const missileControl = createMissileControl({
  canvas, ctx, buildings: buildingBlueprints, surfaceYAt, worldToScreen, screenToWorld,
  getSide: () => baseSide, worldWidth: WORLD_WIDTH, craterSurface, waterLevelAt, splashWater, breakBuilding,
  renderer: worldObjectRenderer,
});
const commandControl = createCommandControl({
  canvas, ctx, buildings: buildingBlueprints, nodes: resourceNodes, tunnels: starterTunnels,
  cores, pools: waterPools, territories, surfaceYAt, worldToScreen, screenToWorld, camera,
  getSide: () => baseSide, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  canBuild: canBuildOnTerrain, farmWaterSources, tunnelWidth: TUNNEL_INTERIOR_WIDTH,
  startingResources: STARTING_RESOURCES, renderer: worldObjectRenderer,
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
  document.getElementById('building-stats').innerHTML = [
    `HOUSING ${stats.housing} / POP ${stats.population}`,
    `FARMS ${stats.farms} / +${stats.sm.toFixed(2)} SM/S`,
    `MINES ${stats.mines} / +${stats.hm.toFixed(2)} HM/S`,
    `MILITARY ${stats.military} / DEFENSE`,
    ...(stats.floodedConstruction ? [`CONSTRUCTION PAUSED / FLOODED ${stats.floodedConstruction}`] : []),
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

  for (let step = 0; step < 5; step += 1) {
    const next = grid.map((row) => row.slice());
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        let alive = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
              alive += grid[ny][nx];
            }
          }
        }
        const current = grid[y][x];
        next[y][x] = (current && (alive === 2 || alive === 3)) || (!current && alive === 3) ? 1 : 0;
      }
    }
    grid.splice(0, grid.length, ...next);
  }

  return grid;
}

function cellValueAtLifeGrid(x, breadth) {
  const position = clamp((x / WORLD_WIDTH) * lifeGrid[0].length - 0.5, 0, lifeGrid[0].length - 1);
  const col = Math.floor(position);
  const row = clamp(Math.floor((breadth / 620) * lifeGrid.length), 0, lifeGrid.length - 1);
  const t = position - col;
  return lerp(lifeGrid[row][col], lifeGrid[row][Math.min(col + 1, lifeGrid[0].length - 1)],
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
  return terrainSurface.heightAt(x);
}

function craterSurface(center, radius = 30, depth = 14) {
  commandControl.damageRoads(center, radius);
  for (const farm of buildingBlueprints) {
    if (farm.kind !== 'farm') continue;
    const farmX = farm.x + FARM_BUILDING_WIDTH / 2;
    for (const source of farm.waterSources) {
      const left = Math.min(farmX, source.intakeX);
      const right = Math.max(farmX, source.intakeX);
      if (center + radius >= left && center - radius <= right) {
        source.repairRemaining = IRRIGATION_REPAIR_SECONDS;
      }
    }
  }
  terrainSurface.crater(center, radius, depth);
  for (const pool of waterPools) {
    if (center + radius >= pool.left && center - radius <= pool.right) reshapeWater(pool);
  }
}

function waterLevelAt(x) {
  const pool = waterPools.find((item) => x >= item.left && x <= item.right && surfaceYAt(x) > item.level);
  return pool ? pool.level : null;
}

function splashWater(x) {
  const level = waterLevelAt(x);
  if (level === null) return;
  for (let i = 0; i < 18; i += 1) {
    waterDrops.push({ x, y: level, vx: (Math.random() - 0.5) * 90, vy: -25 - Math.random() * 65, age: 0 });
  }
}

function breakBuilding(building, mark) {
  const width = building.kind === 'farm' ? FARM_BUILDING_WIDTH : building.width;
  const ground = Math.min(surfaceYAt(building.x), surfaceYAt(building.x + width));
  const top = ground - building.height;
  const fractureY = clamp(top + mark.y, top + 2, ground - 2);
  const direction = mark.x < width / 2 ? -1 : 1;
  collapsedBuildings.push({
    x: building.x, width, top, ground, fractureY, direction,
    color: buildingColor(building), angle: 0, angularVelocity: 0, age: 0,
  });
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
  throw new Error('No dry space available for a building or core');
}

function createResourceNodes() {
  const startingNodes = cores.map((core, index) => {
    const x = core.x + 7 + (index === 0 ? 110 : -110);
    const start = Math.min(x, core.x + 7);
    const end = Math.max(x, core.x + 7);
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
      points: [
        { x: core.x + 7, y: surfaceYAt(core.x + 7) },
        { x: core.x + 7, y: node.y },
        { x: node.x, y: node.y },
      ],
    };
  });
}

function buildBuildingBlueprints() {
  const clusters = [
    { center: 220, isLeft: true },
    { center: 420, isLeft: true },
    { center: 640, isLeft: true },
    { center: WORLD_WIDTH - 640, isLeft: false },
    { center: WORLD_WIDTH - 420, isLeft: false },
    { center: WORLD_WIDTH - 180, isLeft: false },
    ...neutralTerritories.map((territory) => ({ center: territory.center - 45, isLeft: true, neutral: true })),
  ];

  const palette = ['flat', 'gable', 'tower', 'bunker', 'shed'];
  const layouts = [];
  const occupied = cores.map((core) => ({ x: core.x - 11, width: 36 }));

  clusters.forEach((cluster, clusterIndex) => {
    const clusterBuildings = [];
    const minX = cluster.neutral ? WORLD_WIDTH * 0.2 : cluster.isLeft ? 0 : WORLD_WIDTH * 0.8;
    const maxX = cluster.neutral ? WORLD_WIDTH * 0.8 : cluster.isLeft ? WORLD_WIDTH * 0.2 : WORLD_WIDTH;
    for (let i = 0; i < 5; i += 1) {
      const offset = i * 14;
      const preferredX = cluster.center + (cluster.isLeft ? offset : -offset);
      const seed = (clusterIndex + i * 7) % palette.length;
      const kind = palette[seed];
      const width = 10 + ((clusterIndex + i) % 5) * 4;
      const x = findDryPosition(preferredX, width, occupied, minX, maxX);
      const height = kind === 'tower'
        ? 130 + ((clusterIndex * 7 + i * 11) % 36)
        : 18 + ((clusterIndex * 7 + i * 11) % 28);
      const roofColor = kind === 'tower' ? '#8fe4ff' : kind === 'bunker' ? '#9ef7aa' : kind === 'shed' ? '#ffdb7a' : '#d7ebff';
      const building = { x, width, height, kind, color: roofColor, seed: clusterIndex + i, health: 100,
        cluster: clusterIndex, owner: cluster.neutral ? 'neutral' : cluster.isLeft ? 'left' : 'right',
        neutral: Boolean(cluster.neutral), population: cluster.neutral ? 1 : 0 };
      layouts.push(building);
      occupied.push(building);
      clusterBuildings.push(building);
    }

    const direction = cluster.isLeft ? 1 : -1;
    const farmWidth = 42;
    const farmGap = 4;
    const farmPairWidth = farmWidth * 2 + farmGap;
    const farmPreferred = cluster.center + direction * 105 - (direction < 0 ? farmPairWidth : 0);
    const farmX = findDryPosition(farmPreferred, farmPairWidth, occupied, minX, maxX);
    for (let i = 0; i < 2; i += 1) {
      const farm = {
        x: farmX + i * (farmWidth + farmGap), width: farmWidth, height: 13,
        kind: 'farm', color: '#6ef08a', seed: clusterIndex + i,
        health: 100, neutral: Boolean(cluster.neutral), cluster: clusterIndex,
        owner: cluster.neutral ? 'neutral' : cluster.isLeft ? 'left' : 'right',
        cropLeft: 0, cropRight: 0, waterSources: [],
      };
      layouts.push(farm);
      occupied.push(farm);
      clusterBuildings.push(farm);
    }

    const militaryWidth = 24;
    const militarySites = clusterBuildings.flatMap((anchor) =>
      [anchor.x - militaryWidth - 2, anchor.x + anchor.width + 2].map((preferred) => {
        const x = findDryPosition(preferred, militaryWidth, occupied, minX, maxX);
        const gap = Math.max(0, Math.max(x, anchor.x) - Math.min(x + militaryWidth, anchor.x + anchor.width));
        return { x, gap };
      })
    );
    militarySites.sort((a, b) => a.gap - b.gap || Math.abs(a.x - cluster.center) - Math.abs(b.x - cluster.center));
    const military = {
      x: militarySites[0].x,
      width: militaryWidth, height: 22, kind: 'military', color: '#6ef08a',
      seed: clusterIndex, health: 100, neutral: Boolean(cluster.neutral), cluster: clusterIndex,
      owner: cluster.neutral ? 'neutral' : cluster.isLeft ? 'left' : 'right',
      defenseHealth: 100,
      level: cluster.neutral ? 4 : 1 + clusterIndex % 4, direction: cluster.isLeft ? 1 : -1,
    };
    layouts.push(military);
    occupied.push(military);
  });

  return layouts;
}

function farmBuildingBounds(building) {
  return {
    left: building.x,
    right: building.x + (building.kind === 'farm' ? FARM_BUILDING_WIDTH : building.width),
  };
}

function farmWaterSources(farm) {
  const farmX = farm.x + FARM_BUILDING_WIDTH / 2;
  return waterPools.map((pool) => {
    const intakeX = (pool.left + pool.right) / 2;
    const distance = Math.abs(farmX - intakeX);
    let area = 0;
    for (let x = pool.left; x < pool.right; x += 4) {
      const step = Math.min(4, pool.right - x);
      area += Math.max(0, surfaceYAt(x + step / 2) - pool.level) * step;
    }
    return { pool, intakeX, distance, area, repairRemaining: 0 };
  }).filter((source) => source.distance <= FARM_MAX_SOURCE_DISTANCE && source.area > 0)
    .sort((a, b) => a.distance - b.distance);
}

function updateFarmGrowth(farm, deltaSeconds) {
  const sources = farm.availableWaterSources;
  const totalGrowth = farm.cropLeft + farm.cropRight;
  const sourceCount = Math.min(sources.length, 1 + Math.floor(totalGrowth / FARM_ADDITIONAL_SOURCE_GROWTH));
  farm.waterSources = sources.slice(0, sourceCount);
  const capacity = farm.waterSources.reduce((sum, source) =>
    sum + (source.repairRemaining > 0 ? 0
      : Math.sqrt(source.area) * 1.5 * (1 - 0.6 * source.distance / FARM_MAX_SOURCE_DISTANCE)), 0);
  let remaining = Math.min(FARM_GROWTH_PER_SECOND * deltaSeconds, Math.max(0, capacity - totalGrowth));
  const farmBounds = farmBuildingBounds(farm);
  const obstacles = buildingBlueprints.filter((building) => building !== farm).map((building) => {
    const bounds = farmBuildingBounds(building);
    return {
      left: bounds.left - (building.kind === 'farm' ? building.cropLeft : 0),
      right: bounds.right + (building.kind === 'farm' ? building.cropRight : 0),
    };
  }).concat(cores.map((core) => ({ left: core.x - 11, right: core.x + 25 })))
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
  ctx.fillStyle = '#008aa3';
  for (const pool of waterPools) {
    ctx.beginPath();
    ctx.moveTo(pool.left, pool.level);
    ctx.lineTo(pool.right, pool.level);
    for (let x = Math.floor(pool.right / 4) * 4; x > pool.left; x -= 4) {
      ctx.lineTo(x, surfaceYAt(x));
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#23d6e8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pool.left, pool.level);
    ctx.lineTo(pool.right, pool.level);
    ctx.stroke();
  }
  ctx.fillStyle = '#23d6e8';
  for (const drop of waterDrops) ctx.fillRect(drop.x - 1, drop.y - 1, 2, 2);
  ctx.restore();
}

function drawIrrigationIntakes() {
  for (const farm of buildingBlueprints) {
    if (farm.kind !== 'farm') continue;
    for (const source of farm.waterSources) {
      const bottom = surfaceYAt(source.intakeX);
      drawPixelLine(source.intakeX, bottom, source.intakeX, (bottom + source.pool.level) / 2,
        source.repairRemaining > 0 ? '#e15a40' : '#438f9b', 1.2);
    }
  }
}

function drawSurfaceProfile() {
  ctx.strokeStyle = '#399a50';
  ctx.lineWidth = Math.max(1, 2.2 * camera.zoom);
  ctx.beginPath();
  const first = worldToScreen(0, surfaceYAt(0));
  ctx.moveTo(first.x, first.y);
  for (let x = 4; x <= world.width; x += 4) {
    const point = worldToScreen(x, surfaceYAt(x));
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

function drawUnderground() {
  ctx.save();
  ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  for (const farm of buildingBlueprints.filter((building) => building.kind === 'farm')) {
    const farmX = farm.x + FARM_BUILDING_WIDTH / 2;
    for (const source of farm.waterSources) {
      const direction = Math.sign(source.intakeX - farmX);
      ctx.strokeStyle = source.repairRemaining > 0 ? '#e15a40' : '#438f9b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(farmX, surfaceYAt(farmX));
      ctx.lineTo(farmX, surfaceYAt(farmX) + 10);
      for (let x = farmX + direction * 4; direction * (source.intakeX - x) > 0; x += direction * 4) {
        ctx.lineTo(x, surfaceYAt(x) + 10);
      }
      ctx.lineTo(source.intakeX, surfaceYAt(source.intakeX) + 10);
      ctx.lineTo(source.intakeX, (surfaceYAt(source.intakeX) + source.pool.level) / 2);
      ctx.stroke();
    }
  }
  for (const military of buildingBlueprints.filter((building) => building.kind === 'military' && building.level >= 2)) {
    for (let i = 0; i < military.level - 1; i += 1) {
      const mineX = clamp(military.x + military.width / 2 + military.direction * (35 + i * 14), 4, WORLD_WIDTH - 4);
      const mineY = surfaceYAt(mineX) + 7;
      worldObjectRenderer.defensiveMine(ctx, mineX, mineY, buildingColor(military));
    }
  }
  for (const interior of [false, true]) {
    for (const tunnel of starterTunnels) {
      const tunnelMode = commandControl.isTunnelMode();
      const selected = tunnelMode && tunnel.side === (baseSide === 'left' ? 0 : 1);
      worldObjectRenderer.tunnel(ctx, tunnel, interior, selected, tunnelMode, TUNNEL_WALL_WIDTH);
    }
  }
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
  ctx.fillStyle = '#020202';
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  drawUnderground();
  drawWaterPools();
  drawIrrigationIntakes();
  drawSurfaceProfile();
  drawSettlements();
  drawCollapsedBuildings();
  commandControl.draw();
  missileControl.draw();

}

function updateDebrisAndWaterDrops(deltaSeconds) {
  for (let i = collapsedBuildings.length - 1; i >= 0; i -= 1) {
    const piece = collapsedBuildings[i];
    piece.age += deltaSeconds;
    piece.angularVelocity = Math.min(2.2, piece.angularVelocity + 2.5 * deltaSeconds);
    piece.angle = piece.direction * Math.min(Math.PI / 2, Math.abs(piece.angle) + piece.angularVelocity * deltaSeconds);
    if (piece.age >= 12) collapsedBuildings.splice(i, 1);
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

function updateIrrigationRepairs(deltaSeconds) {
  for (const farm of buildingBlueprints) {
    if (farm.kind !== 'farm') continue;
    for (const source of farm.availableWaterSources) {
      source.repairRemaining = Math.max(0, source.repairRemaining - deltaSeconds);
    }
  }
}

function updateBuildings(deltaSeconds) {
  for (let i = buildingBlueprints.length - 1; i >= 0; i -= 1) {
    const building = buildingBlueprints[i];
    const buildingWidth = building.kind === 'farm' ? FARM_BUILDING_WIDTH : building.width;
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
  updateDebrisAndWaterDrops(deltaSeconds);
  updateIrrigationRepairs(deltaSeconds);
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
