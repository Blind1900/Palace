const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const gameRoot = document.querySelector('.game-shell');
const baseSideButton = document.getElementById('cycle-base-side');
const fullscreenButton = document.getElementById('fullscreen-button');

const url = new URL(window.location.href);
const params = url.searchParams;
const embedded = params.get('embedded') === '1';
const fullscreen = params.get('fullscreen') === '1';
let baseSide = params.get('baseSide') === 'right' ? 'right' : 'left';

const state = {
  hm: 68,
  sm: 42,
  pop: 14,
  enemyCore: 100,
  allyCore: 100,
  time: 0,
};

const physics = {
  gravity: 0.42,
  terminalVelocity: 3.8,
};

const WORLD_WIDTH = 2400;
canvas.width = WORLD_WIDTH;
canvas.height = 620;

const world = {
  width: WORLD_WIDTH,
  surfaceBaseY: 320,
  craterX: WORLD_WIDTH * 0.5,
  craterSize: 0,
  explosionPhase: 0,
};

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
}

if (baseSideButton) {
  baseSideButton.addEventListener('click', cycleBaseSide);
}

function updateHud() {
  document.getElementById('hm-value').textContent = state.hm;
  document.getElementById('sm-value').textContent = state.sm;
  document.getElementById('pop-value').textContent = state.pop;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getFlatZones() {
  return [
    { center: 260, width: 180 },
    { center: 860, width: 160 },
    { center: 1140, width: 180 },
    { center: 1460, width: 170 },
    { center: 1910, width: 170 },
  ];
}

function getWaterZones() {
  return [
    { center: 360, width: 110, depth: 26 },
    { center: 640, width: 96, depth: 22 },
    { center: 930, width: 120, depth: 24 },
    { center: 1270, width: 116, depth: 24 },
    { center: 1620, width: 138, depth: 25 },
    { center: 1965, width: 108, depth: 22 },
  ];
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

function terrainYAt(x) {
  const baseY = 314;

  let y = baseY;

  const flatZones = getFlatZones();
  let inFlatZone = false;
  for (const zone of flatZones) {
    const distance = Math.abs(x - zone.center);
    if (distance < zone.width * 0.5) {
      inFlatZone = true;
      break;
    }
  }

  if (inFlatZone) {
    y += Math.sin(x * 0.012) * 1.4;
  } else {
    y += Math.sin(x * 0.018 + 0.5) * 5.3;
    y += Math.sin(x * 0.05 + 1.9) * 2.7;
    y += Math.sin(x * 0.12 + 2.9) * 1.5;

    const mountainClusters = [
      { center: 520, width: 190, peak: -38 },
      { center: 1010, width: 210, peak: -48 },
      { center: 1575, width: 230, peak: -42 },
      { center: 2100, width: 120, peak: -28 },
    ];

    for (const mountain of mountainClusters) {
      const distance = Math.abs(x - mountain.center);
      const falloff = Math.max(0, 1 - distance / mountain.width);
      if (falloff > 0) {
        y += Math.sin(Math.PI * falloff) * mountain.peak;
      }
    }

    y += Math.sin(x * 0.006 + 0.25) * 2.2;
  }

  for (const basin of getWaterZones()) {
    y += basinOffsetAt(x, basin);
  }

  return y;
}

function waterLevelAt(zone) {
  const leftY = terrainYAt(zone.center - zone.width * 0.5);
  const rightY = terrainYAt(zone.center + zone.width * 0.5);
  return Math.max(leftY, rightY) - zone.rimHeight;
}

function waterDepthAt(zone, x) {
  const distance = Math.abs(x - zone.center);
  const radius = zone.width * 0.5;
  const inside = clamp(1 - distance / radius, 0, 1);
  return zone.depth * Math.pow(inside, 2.2) + 18;
}

function canBuildOnTerrain(x, width) {
  const left = x;
  const right = x + width;
  const waterZones = getWaterZones();
  for (const zone of waterZones) {
    const zoneLeft = zone.center - zone.width * 0.5;
    const zoneRight = zone.center + zone.width * 0.5;
    if (left < zoneRight && right > zoneLeft) {
      return false;
    }
  }
  return true;
}

function drawLadder(x, y, height) {
  ctx.strokeStyle = '#edf5ff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + height);
  for (let rung = 1; rung < 5; rung += 1) {
    const rungY = y + (height / 5) * rung;
    ctx.moveTo(x - 3, rungY);
    ctx.lineTo(x + 3, rungY);
  }
  ctx.stroke();
}

function drawDoor(x, y, width, height) {
  ctx.strokeStyle = '#edf5ff';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x, y, width, height);
}

function drawBuilding(x, width, height, baseY, slopeBias = 0) {
  const leftBase = terrainYAt(x);
  const rightBase = terrainYAt(x + width);
  const groundY = Math.min(leftBase, rightBase) - 1;
  const top = groundY - height;
  const leftWallTop = top + (leftBase - groundY) * 0.1;
  const rightWallTop = top + (rightBase - groundY) * 0.1;

  ctx.strokeStyle = '#edf5ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, groundY);
  ctx.lineTo(x, leftWallTop);
  ctx.lineTo(x + width, rightWallTop);
  ctx.lineTo(x + width, groundY);
  ctx.closePath();
  ctx.stroke();

  const floorGap = Math.max(8, height / 4);
  for (let i = 1; i < 4; i += 1) {
    const floorY = top + floorGap * i;
    ctx.beginPath();
    ctx.moveTo(x + 3, floorY);
    ctx.lineTo(x + width - 3, floorY + (rightWallTop - leftWallTop) * 0.1);
    ctx.stroke();
  }

  const doorY = groundY - 7;
  const ladderX = x + width * 0.26;
  drawLadder(ladderX, top + 2, Math.min(height * 0.67, groundY - top - 4));
  drawDoor(x + width * 0.4, doorY, width * 0.18, 7);
}

function drawSurfaceProfile() {
  const points = [];
  for (let x = 0; x <= world.width; x += 4) {
    points.push({ x, y: terrainYAt(x) });
  }

  ctx.strokeStyle = '#89e07d';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (i === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.stroke();
}

function drawBaseCluster(startX, side) {
  const buildings = [
    { x: startX + 10, width: 18, height: 24 },
    { x: startX + 40, width: 20, height: 30 },
    { x: startX + 76, width: 18, height: 22 },
    { x: startX + 112, width: 24, height: 32 },
    { x: startX + 150, width: 18, height: 24 },
  ];

  buildings.forEach((item) => {
    if (!canBuildOnTerrain(item.x, item.width)) {
      return;
    }
    const centerX = item.x + item.width * 0.5;
    const leftGrd = terrainYAt(item.x);
    const rightGrd = terrainYAt(item.x + item.width);
    const slopeBias = (rightGrd - leftGrd) * 0.6;
    const baseY = (leftGrd + rightGrd) * 0.5;
    drawBuilding(item.x, item.width, item.height, baseY, slopeBias);
  });

  const coreX = side === 'left' ? startX + 82 : startX + 86;
  const coreY = terrainYAt(coreX) - 6;
  if (!canBuildOnTerrain(coreX, 6)) {
    return;
  }
  ctx.fillStyle = '#ebf2ff';
  ctx.fillRect(coreX, coreY, 6, 6);
  ctx.strokeStyle = '#d5dffb';
  ctx.strokeRect(coreX - 2, coreY - 2, 10, 10);
}

function drawNeutralCluster(startX) {
  const clusters = [
    { x: startX + 6, width: 12, height: 18 },
    { x: startX + 36, width: 18, height: 26 },
    { x: startX + 74, width: 14, height: 20 },
    { x: startX + 108, width: 18, height: 26 },
  ];
  clusters.forEach((item) => {
    if (!canBuildOnTerrain(item.x, item.width)) {
      return;
    }
    const leftGrd = terrainYAt(item.x);
    const rightGrd = terrainYAt(item.x + item.width);
    const slopeBias = (rightGrd - leftGrd) * 0.45;
    const baseY = (leftGrd + rightGrd) * 0.5;
    drawBuilding(item.x, item.width, item.height, baseY, slopeBias);
  });
}

function drawBattlefield() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#020202';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawSurfaceProfile();

  drawBaseCluster(240, 'left');
  drawBaseCluster(1760, 'right');
  drawNeutralCluster(820);
  drawNeutralCluster(1100);
  drawNeutralCluster(1380);

  ctx.fillStyle = '#d9d9d9';
  ctx.font = 'bold 16px Segoe UI';
  ctx.fillText('ALLY CORE', 146, 160);
  ctx.fillText('ENEMY CORE', 1826, 160);
  ctx.fillText('NEUTRAL BASE', 858, 160);
  ctx.fillText('NEUTRAL BASE', 1132, 160);
  ctx.fillText('NEUTRAL BASE', 1416, 160);
}

function updateWorldState() {
  world.explosionPhase = 0;
  world.craterSize = 0;
  world.craterX = world.width * 0.5;
}

function frame() {
  state.time += 1;
  updateWorldState();
  drawBattlefield();
  updateHud();
  requestAnimationFrame(frame);
}

applyBaseSide();
updateHud();
requestAnimationFrame(frame);
