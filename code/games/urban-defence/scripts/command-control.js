function createStartingEconomies(startingResources, tunnels) {
  const { hm, sm, pop } = startingResources;
  if (!Number.isFinite(hm) || hm < 0 || !Number.isFinite(sm) || sm < 0 ||
      !Number.isInteger(pop) || pop < 0) {
    throw new Error('Invalid starting resources');
  }
  const economies = {
    left: { hm, sm, pop, assigned: 0 },
    right: { hm, sm, pop, assigned: 0 },
  };
  for (const tunnel of tunnels) {
    if (tunnel.side !== 0 && tunnel.side !== 1) throw new Error('Invalid starter tunnel side');
    const side = tunnel.side === 0 ? 'left' : 'right';
    economies[side].assigned += 1;
    if (economies[side].assigned > pop) throw new Error('Not enough starting population for miners');
  }
  return economies;
}

function advanceSeedConstruction(building, funds, delta, dry) {
  if (building.health <= 0 || building.rebuildHeight !== undefined ||
      !building.construction || building.construction.stage >= 4 || !dry) return;
  building.construction.progress += delta;
  if (building.construction.progress < 5 || funds.hm < 4 || funds.sm < 2) return;
  funds.hm -= 4;
  funds.sm -= 2;
  building.construction.progress = 0;
  building.construction.stage += 1;
  building.height = 6 + building.construction.stage * (building.kind === 'farm' ? 2 : 5);
  if (building.kind === 'military') building.level = building.construction.stage;
  if (building.kind === 'flat') { funds.pop += 1; building.population += 1; }
  if (building.construction.stage === 4) funds.assigned -= 1;
}

function advanceNeutralConstruction(building, delta) {
  if (building.health <= 0 || building.rebuildHeight !== undefined ||
      !building.construction || building.construction.stage >= 4) return;
  building.construction.progress += delta;
  while (building.construction.progress >= 4 && building.construction.stage < 4) {
    building.construction.progress -= 4;
    building.construction.stage += 1;
    building.height = 6 + building.construction.stage * (building.kind === 'farm' ? 2 : 5);
    if (building.kind === 'military') building.level = building.construction.stage;
  }
}

function createCommandControl(options) {
  const { canvas, ctx, buildings, nodes, tunnels, cores, pools, territories, surfaceYAt,
    worldToScreen, screenToWorld, getSide, worldWidth, worldHeight, canBuild,
    farmWaterSources, tunnelWidth, startingResources, renderer, craterSurface, architectureStyles } = options;
  const seedBuildRadius = 240;
  const vehicleTunnelWidth = Math.max(tunnelWidth, 24);
  const tunnelRoofClearance = 28;
  const status = document.getElementById('command-status');
  const panels = ['build', 'route', 'deploy', 'missile'];
  const economies = createStartingEconomies(startingResources, tunnels);
  const operations = tunnels.map((tunnel) => ({ node: tunnel.node, side: tunnel.side === 0 ? 'left' : 'right', miners: 1 }));
  const roads = [];
  const units = [];
  const selectedUnits = new Set();
  const unitEffects = [];
  const bulletTrails = [];
  const lastBulletShot = new WeakMap();
  const bulletTrailLifetime = 0.36;
  const bulletFireInterval = 0.12;
  const selected = new Set();
  const baseList = document.getElementById('deploy-bases');
  let mode = '';
  let start = null;
  let pointer = null;
  let listKey = '';
  let elapsed = 0;
  let outcome = '';
  const centerHold = { left: 0, right: 0 };

  function styleForSide(side) {
    return architectureStyles && architectureStyles[side] || 'modern';
  }
  function captureBuilding(building, side, direction) {
    const previousOwner = building.owner;
    if (previousOwner === side) return;
    if (previousOwner !== 'neutral') economies[previousOwner].pop -= building.population || 0;
    economies[side].pop += building.population || 0;
    if (building.construction && building.construction.stage < 4) {
      if (previousOwner !== 'neutral') economies[previousOwner].assigned -= 1;
      economies[side].assigned += 1;
    }
    building.owner = side;
    building.neutral = false;
    building.captured = true;
    building.direction = direction;
    building.hackProgress = 0;
    delete building.hackSide;
  }

  for (const [left, right, side] of [
    [0, worldWidth * 0.2, 'left'],
    [worldWidth * 0.8, worldWidth, 'right'],
  ]) {
    const points = roadProfile(left, right);
    for (let i = 0; i < points.length - 1; i += 25) {
      const segment = points.slice(i, Math.min(i + 26, points.length));
      roads.push({ left: segment[0].x, right: segment[segment.length - 1].x, points: segment, side });
    }
  }

  function sideIndex(side) { return side === 'left' ? 0 : 1; }
  function economy() { return economies[getSide()]; }
  function availablePop(side) { return economies[side].pop - economies[side].assigned; }
  function friendly(building) {
    return !building.neutral && building.health > 0
      && building.owner === getSide();
  }
  function bases() { return buildings.filter((building) => building.kind === 'military' && friendly(building)); }
  function message(text) { status.textContent = text; }
  function reset() { mode = ''; start = null; pointer = null; }
  function setMode(next, text) {
    mode = next;
    start = null;
    message(text);
  }
  function refreshBases() {
    const available = bases();
    for (const building of selected) if (!available.includes(building)) selected.delete(building);
    const key = available.map((building) => `${building.x}:${building.level}`).join(',');
    if (key !== listKey) {
      baseList.querySelectorAll('label').forEach((label) => label.remove());
      available.forEach((building, index) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', () => {
          if (input.checked) selected.add(building);
          else selected.delete(building);
          refreshBases();
        });
        label.append(input, document.createTextNode(` BASE ${index + 1} / LV ${building.level}`));
        baseList.append(label);
      });
      listKey = key;
    }
    baseList.querySelectorAll('input').forEach((input, index) => { input.checked = selected.has(available[index]); });
    document.getElementById('deploy-fire').disabled = !selected.size;
  }
  panels.forEach((name) => {
    const button = document.getElementById(`${name}-command`);
    const panel = document.getElementById(`${name}-panel`);
    button.addEventListener('click', () => {
      const shouldOpen = name === 'missile' ? !panel.hidden : panel.hidden;
      panels.forEach((other) => {
        if (other === name) return;
        document.getElementById(`${other}-panel`).hidden = true;
        document.getElementById(`${other}-command`).setAttribute('aria-expanded', 'false');
      });
      if (name !== 'missile') {
        panel.hidden = !shouldOpen;
        button.setAttribute('aria-expanded', String(shouldOpen));
      }
      reset();
      message('');
      if (name === 'deploy' && shouldOpen) {
        refreshBases();
        setMode('deploy-select', 'Select friendly military bases on the map or in the list.');
      }
    });
  });
  document.addEventListener('contextmenu', (event) => {
    const name = !document.getElementById('build-panel').hidden ? 'build'
      : !document.getElementById('route-panel').hidden ? 'route' : null;
    if (!name) return;
    event.preventDefault();
    document.getElementById(`${name}-panel`).hidden = true;
    document.getElementById(`${name}-command`).setAttribute('aria-expanded', 'false');
    reset();
    message('');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const name = panels.find((item) => !document.getElementById(`${item}-panel`).hidden);
    if (!name) return;
    document.getElementById(`${name}-panel`).hidden = true;
    const button = document.getElementById(`${name}-command`);
    button.setAttribute('aria-expanded', 'false');
    reset();
    message('');
    button.focus();
  });
  document.querySelectorAll('[data-build]').forEach((button) => {
    button.addEventListener('click', () => {
      const kind = button.dataset.build;
      setMode(kind === 'mine' ? 'mine' : `seed-${kind}`, kind === 'mine'
        ? 'Select a circled, connected unclaimed node. Mining requires 1 available POP.'
        : `Place a seed on dry, unoccupied ground within ${seedBuildRadius} units of a friendly building. Cost: 10 HM, 5 SM and 1 available POP.`);
    });
  });
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.route, button.dataset.route === 'road'
      ? 'Select a surface starting point, then an endpoint. Ramps and bridges cost extra HM.'
      : 'Select a tunnel and endpoint, or click a highlighted path to a resource. Right-click to finish.'));
  });
  document.getElementById('deploy-select').addEventListener('click', () => setMode('deploy-select', 'Select friendly military bases.'));
  document.getElementById('deploy-order').addEventListener('click', () => {
    setMode('unit-order', selectedUnits.size
      ? `${selectedUnits.size} unit(s) selected. Click a destination to move or attack.`
      : 'Click active friendly units to select them, then click a destination to move or attack.');
  });
  document.getElementById('deploy-select-units').addEventListener('click', () => {
    selectedUnits.clear();
    units.filter((unit) => unit.health > 0 && unit.side === getSide()).forEach((unit) => selectedUnits.add(unit));
    setMode('unit-order', selectedUnits.size
      ? `${selectedUnits.size} active unit(s) selected. Click a destination to move or attack.`
      : 'No active friendly units are on the map.');
  });
  document.getElementById('deploy-all').addEventListener('click', () => {
    bases().forEach((building) => selected.add(building));
    refreshBases();
    message(`${selected.size} base(s) selected. Deploy toward the enemy core.`);
  });
  document.getElementById('deploy-clear').addEventListener('click', () => {
    selected.clear();
    refreshBases();
    setMode('deploy-select', 'Selection cleared. Select friendly military bases.');
  });
  document.getElementById('deploy-fire').addEventListener('click', () => {
    refreshBases();
    if (!selected.size) return;
    const cost = selected.size * 5;
    if (economy().sm < cost) { message(`Need ${cost} SM to deploy from ${selected.size} base(s).`); return; }
    economy().sm -= cost;
    for (const building of selected) {
      const types = ['trooper', 'tank', 'tank', 'hopper'];
      const enemyCore = cores[getSide() === 'left' ? 1 : 0];
      const unit = {
        x: building.x + building.width / 2, target: enemyCore.x + 7,
        type: types[Math.min(4, building.level) - 1], side: getSide(), style: styleForSide(getSide()),
        health: types[Math.min(4, building.level) - 1] === 'hopper' ? 145 : 100,
        energy: 100, dodgeCooldown: 0, dodgeTimer: 0, dodgeOffset: 0,
      };
      units.push(unit);
      selectedUnits.add(unit);
    }
    setMode('unit-order', `Deployed ${selected.size} unit(s). Click a destination to move or attack.`);
  });

  function worldPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(clientX - rect.left - canvas.clientLeft, clientY - rect.top - canvas.clientTop);
  }
  function nearestTunnel(point, side, limit = 24) {
    let best = null;
    let distance = limit;
    for (const tunnel of tunnels.filter((item) => item.side === sideIndex(side))) {
      for (let i = 1; i < tunnel.points.length; i += 1) {
        const a = tunnel.points[i - 1];
        const b = tunnel.points[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const candidate = { x: a.x + dx * t, y: a.y + dy * t };
        const current = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        if (current < distance) { best = candidate; distance = current; }
      }
    }
    return best;
  }
  function connected(node, side) {
    const point = nearestTunnel(node, side);
    return point && Math.hypot(point.x - node.x, point.y - node.y) <= node.size / 2 + 5;
  }
  function unclaimed(node) { return node.amount > 0 && !operations.some((operation) => operation.node === node); }
  function seedSite(kind, x) {
    const width = kind === 'farm' ? 14 : kind === 'military' ? 24 : 14;
    x = Math.round(x - width / 2);
    const footprint = (building) => ({
      left: building.x - (building.kind === 'farm' ? building.cropLeft : 0),
      right: building.x + (building.kind === 'farm' ? 14 + building.cropRight : building.width),
    });
    const nearFriendly = buildings.some((building) => friendly(building)
      && Math.max(building.x - (x + width), x - (building.x + building.width), 0) <= seedBuildRadius);
    const clear = canBuild(x, width)
      && !buildings.some((building) => { const bounds = footprint(building); return x < bounds.right + 2 && x + width + 2 > bounds.left; })
      && !cores.some((core) => x < core.x + 25 && x + width > core.x - 11);
    return { x, width, valid: nearFriendly && clear, nearFriendly };
  }
  function placeSeed(kind, x) {
    const site = seedSite(kind, x);
    x = site.x;
    const { width } = site;
    if (!site.valid) {
      message(site.nearFriendly
        ? 'Choose unoccupied dry ground inside the map.'
        : `Choose ground within ${seedBuildRadius} units of a friendly building.`);
      return;
    }
    if (economy().hm < 10 || economy().sm < 5 || availablePop(getSide()) < 1) {
      message('A seed requires 10 HM, 5 SM and 1 available POP.'); return;
    }
    economy().hm -= 10;
    economy().sm -= 5;
    economy().assigned += 1;
    const building = {
      x, width, height: 6, kind: kind === 'housing' ? 'flat' : kind, color: '#6ef08a',
      seed: buildings.length, health: 100, neutral: false, owner: getSide(),
      cluster: (territories.find((territory) => x >= territory.left && x <= territory.right && territory.owner === getSide()) || {}).cluster,
      direction: getSide() === 'left' ? 1 : -1, population: 0,
      level: 1, defenseHealth: 100, construction: { stage: 0, progress: 0 }, cropLeft: 0, cropRight: 0, waterSources: [],
    };
    if (kind === 'farm') building.availableWaterSources = farmWaterSources(building);
    buildings.push(building);
    message('Seed placed. Growth pauses if resources run out or the site floods.');
  }
  function routeEnd(point) {
    if (mode === 'road') return { x: Math.max(0, Math.min(worldWidth, point.x)), y: 0 };
    const horizontal = Math.abs(point.x - start.x) >= Math.abs(point.y - start.y);
    const end = horizontal ? { x: point.x, y: start.y } : { x: start.x, y: point.y };
    const node = nodes.find((item) => Math.hypot(item.x - end.x, item.y - end.y) < 20
      && (horizontal ? Math.abs(item.y - start.y) : Math.abs(item.x - start.x)) < 1);
    if (node) return { x: node.x, y: node.y };
    return end;
  }
  function tunnelValid(points) {
    for (let segment = 1; segment < points.length; segment += 1) {
      const a = points[segment - 1];
      const b = points[segment];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(length / 4));
      for (let i = 0; i <= steps; i += 1) {
        const x = a.x + (b.x - a.x) * i / steps;
        const y = a.y + (b.y - a.y) * i / steps;
        if (x < 0 || x > worldWidth || y > worldHeight || y < surfaceYAt(x) + 3) return false;
      }
    }
    return true;
  }
  function roadProfile(left, right) {
    const points = [];
    for (let x = left; x < right; x += 4) points.push({ x, y: roadSurface(x) });
    points.push({ x: right, y: roadSurface(right) });
    const slope = Math.sqrt(3);
    for (let i = 1; i < points.length; i += 1) {
      points[i].y = Math.min(points[i].y, points[i - 1].y + slope * (points[i].x - points[i - 1].x));
    }
    for (let i = points.length - 2; i >= 0; i -= 1) {
      points[i].y = Math.min(points[i].y, points[i + 1].y + slope * (points[i + 1].x - points[i].x));
    }
    return points;
  }

  function roadPlan(left, right, side) {
    const points = roadProfile(left, right);
    const base = Math.min(surfaceYAt(left), surfaceYAt(right));
    const ridge = points.map((point) => surfaceYAt(point.x) < base - 24);
    const first = ridge.findIndex(Boolean);
    const last = ridge.lastIndexOf(true);
    if (first < 0 || last <= first || base - Math.min(...points.map((point) => surfaceYAt(point.x))) < 42) {
      return { roads: [{ left, right, points, side }], tunnels: [] };
    }

    // Cut the tunnel at the first and last steep cutoff, then keep the roof far enough
    // below the surrounding terrain for tanks and mechs to share the route comfortably.
    const entry = points[Math.max(0, first - 1)];
    const exit = points[Math.min(points.length - 1, last + 1)];
    const tunnelLeft = Math.min(entry.x, exit.x);
    const tunnelRight = Math.max(entry.x, exit.x);
    const roofY = Math.max(
      ...points.slice(Math.max(0, first - 1), Math.min(points.length, last + 2))
        .map((point) => surfaceYAt(point.x) + tunnelRoofClearance),
      surfaceYAt(tunnelLeft) + tunnelRoofClearance,
      surfaceYAt(tunnelRight) + tunnelRoofClearance,
    );
    const tunnelPoints = [
      { x: tunnelLeft, y: surfaceYAt(tunnelLeft) + 5 },
      { x: tunnelLeft, y: roofY },
      { x: tunnelRight, y: roofY },
      { x: tunnelRight, y: surfaceYAt(tunnelRight) + 5 },
    ];
    const roads = [];
    const before = points.filter((point) => point.x <= tunnelLeft);
    const after = points.filter((point) => point.x >= tunnelRight);
    if (before.length > 1) roads.push({ left: before[0].x, right: before[before.length - 1].x, points: before, side });
    if (after.length > 1) roads.push({ left: after[0].x, right: after[after.length - 1].x, points: after, side });
    return {
      roads,
      tunnels: [{ side: sideIndex(side), interiorWidth: vehicleTunnelWidth,
        style: styleForSide(side), points: tunnelPoints }],
    };
  }
  function roadSurface(x) {
    const pool = pools.find((item) => x >= item.left && x <= item.right);
    return pool ? Math.min(pool.level, surfaceYAt(x)) : surfaceYAt(x);
  }
  function roadY(road, x) {
    const points = road.points;
    let i = 1;
    while (i < points.length - 1 && points[i].x < x) i += 1;
    const a = points[i - 1];
    const b = points[i];
    return a.y + (b.y - a.y) * Math.max(0, Math.min(1, (x - a.x) / (b.x - a.x)));
  }
  function unitY(unit) {
    if (unit.tunnelY !== undefined) return unit.tunnelY - 3 - (unit.dodgeOffset || 0) - (unit.jumpOffset || 0);
    const road = roads.find((item) => unit.x >= item.left && unit.x <= item.right);
    return (road && unit.type !== 'jet' ? roadY(road, unit.x) : surfaceYAt(unit.x))
      - (unit.type === 'jet' ? 55 : 3) - (unit.dodgeOffset || 0) - (unit.jumpOffset || 0);
  }
  function tunnelPath(tunnel, startAtEnd) {
    const points = startAtEnd ? [...tunnel.points].reverse() : [...tunnel.points];
    const lengths = [0];
    for (let i = 1; i < points.length; i += 1) {
      lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }
    return { points, lengths, total: lengths[lengths.length - 1] };
  }
  function enterTunnel(unit, tunnel, direction, startX) {
    const leftEndpoint = tunnel.points.reduce((best, point) => point.x < best.x ? point : best, tunnel.points[0]);
    const rightEndpoint = tunnel.points.reduce((best, point) => point.x > best.x ? point : best, tunnel.points[0]);
    const forward = direction > 0;
    const pathGoesRight = tunnel.points[tunnel.points.length - 1].x >= tunnel.points[0].x;
    const ordered = forward === pathGoesRight ? [...tunnel.points] : [...tunnel.points].reverse();
    let segmentIndex = -1, fraction = 0, floorY = 0, widest = -1;
    for (let i = 1; i < ordered.length; i += 1) {
      const a = ordered[i - 1], b = ordered[i];
      const dx = b.x - a.x;
      if (Math.abs(dx) < 1e-6 || startX < Math.min(a.x, b.x) - 1e-6 || startX > Math.max(a.x, b.x) + 1e-6) continue;
      if (Math.abs(dx) <= widest) continue;
      widest = Math.abs(dx);
      segmentIndex = i;
      fraction = Math.max(0, Math.min(1, (startX - a.x) / dx));
      floorY = a.y + (b.y - a.y) * fraction;
    }
    if (segmentIndex < 0) return false;
    const floorStart = { x: startX, y: floorY };
    const surfaceEntry = { x: startX, y: surfaceYAt(startX) + 5 };
    const points = [surfaceEntry, floorStart, ...ordered.slice(segmentIndex)];
    const compact = points.filter((point, index) => index === 0 ||
      Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.01);
    const path = tunnelPath({ points: compact }, false);
    unit.tunnel = tunnel;
    unit.tunnelPath = path.points;
    unit.tunnelLengths = path.lengths;
    unit.tunnelDistance = 0;
    unit.tunnelTotal = path.total;
    unit.tunnelY = path.points[0].y;
    unit.tunnelExitX = forward ? rightEndpoint.x : leftEndpoint.x;
    return true;
  }
  function tryEnterTunnel(unit) {
    if (unit.tunnel || unit.type === 'jet') return false;
    if (unit.tunnelExitHold) {
      const direction = Math.sign(unit.target - unit.x);
      if (direction === unit.tunnelExitHold.direction &&
          direction * (unit.x - unit.tunnelExitHold.x) >= -1) return false;
      delete unit.tunnelExitHold;
    }
    const candidates = tunnels.filter((tunnel) => tunnel.side === sideIndex(unit.side));
    for (const tunnel of candidates) {
      const first = tunnel.points[0], last = tunnel.points[tunnel.points.length - 1];
      const leftEndpoint = tunnel.points.reduce((best, point) => point.x < best.x ? point : best, first);
      const rightEndpoint = tunnel.points.reduce((best, point) => point.x > best.x ? point : best, first);
      const forward = unit.target > unit.x;
      const entry = forward ? leftEndpoint : rightEndpoint;
      const exit = forward ? rightEndpoint : leftEndpoint;
      const inside = unit.x >= leftEndpoint.x && unit.x <= rightEndpoint.x;
      if ((forward && unit.target <= exit.x) || (!forward && unit.target >= exit.x)) continue;
      if (inside || Math.hypot(unit.x - entry.x, unitY(unit) - entry.y) <= 24) {
        if (enterTunnel(unit, tunnel, forward ? 1 : -1, inside ? unit.x : entry.x)) return true;
      }
    }
    return false;
  }
  function advanceTunnel(unit, distance) {
    if (!unit.tunnel || !unit.tunnelPath) return false;
    unit.tunnelDistance = Math.min(unit.tunnelTotal, unit.tunnelDistance + distance);
    let index = 1;
    while (index < unit.tunnelLengths.length - 1 && unit.tunnelLengths[index] < unit.tunnelDistance) index += 1;
    const a = unit.tunnelPath[index - 1], b = unit.tunnelPath[index];
    const span = unit.tunnelLengths[index] - unit.tunnelLengths[index - 1] || 1;
    const fraction = (unit.tunnelDistance - unit.tunnelLengths[index - 1]) / span;
    unit.x = a.x + (b.x - a.x) * fraction;
    unit.tunnelY = a.y + (b.y - a.y) * fraction;
    if (unit.tunnelDistance >= unit.tunnelTotal - 1e-6) {
      const exit = unit.tunnelPath[unit.tunnelPath.length - 1];
      const entry = unit.tunnelPath[0];
      unit.tunnelExitHold = { tunnel: unit.tunnel, direction: Math.sign(exit.x - entry.x), x: exit.x };
      unit.x = exit.x;
      delete unit.tunnel;
      delete unit.tunnelPath;
      delete unit.tunnelLengths;
      delete unit.tunnelDistance;
      delete unit.tunnelTotal;
      delete unit.tunnelY;
    }
    return true;
  }
  function tunnelGuides() {
    return nodes.filter((node) => unclaimed(node) && !connected(node, getSide())).map((node) => {
      const origins = [];
      if (start) origins.push(start);
      else {
        for (const tunnel of tunnels.filter((item) => item.side === sideIndex(getSide()))) {
          for (let i = 1; i < tunnel.points.length; i += 1) {
            const a = tunnel.points[i - 1];
            const b = tunnel.points[i];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((node.x - a.x) * dx + (node.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            origins.push({ x: a.x + dx * t, y: a.y + dy * t });
          }
        }
      }
      origins.sort((a, b) => Math.abs(node.x - a.x) + Math.abs(node.y - a.y) - Math.abs(node.x - b.x) - Math.abs(node.y - b.y));
      for (const origin of origins) {
        const choices = [
          [origin, { x: node.x, y: origin.y }, { x: node.x, y: node.y }],
          [origin, { x: origin.x, y: node.y }, { x: node.x, y: node.y }],
        ];
        const points = choices.find(tunnelValid);
        if (points) return { points, length: Math.abs(node.x - origin.x) + Math.abs(node.y - origin.y) };
      }
      return null;
    }).filter(Boolean).sort((a, b) => a.length - b.length).slice(0, 3);
  }
  function guideAt(point) {
    let best = null;
    let distance = 8 / options.camera.zoom;
    for (const guide of tunnelGuides()) {
      if (Math.hypot(point.x - guide.points[0].x, point.y - guide.points[0].y) < 12 / options.camera.zoom) continue;
      for (let i = 1; i < guide.points.length; i += 1) {
        const a = guide.points[i - 1];
        const b = guide.points[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
        if (d < distance) { distance = d; best = guide; }
      }
    }
    return best;
  }
  function placeTunnel(points) {
    const length = points.slice(1).reduce((sum, point, index) =>
      sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
    if (length < 4) { message('Choose a longer segment.'); return; }
    if (!tunnelValid(points)) { message('Tunnel segments must stay underground and inside the map.'); return; }
    const cost = Math.max(1, Math.ceil(length / 20));
    if (economy().hm < cost) { message(`This segment requires ${cost} HM.`); return; }
    economy().hm -= cost;
    tunnels.push({ side: sideIndex(getSide()), interiorWidth: vehicleTunnelWidth,
      style: styleForSide(getSide()), points });
    start = points[points.length - 1];
    message(`Tunnel built for ${cost} HM. Continue from the endpoint or right-click to finish.`);
  }
  function placeRoute(end) {
    if (mode === 'tunnel') { placeTunnel([start, end]); return; }
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const length = right - left;
    if (length < 4) { message('Choose a longer segment.'); return; }
    const plan = roadPlan(left, right, getSide());
    let extra = 0;
    for (const road of plan.roads) for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const width = Math.abs(b.x - a.x);
      if (pools.some((pool) => a.x < pool.right && b.x > pool.left)) extra += width * 2;
      else if (surfaceYAt((a.x + b.x) / 2) - (a.y + b.y) / 2 > 0.1
        || Math.abs(surfaceYAt(b.x) - surfaceYAt(a.x)) > width * Math.sqrt(3)) extra += width;
    }
    const tunnelLength = plan.tunnels.reduce((sum, tunnel) => sum + tunnel.points.slice(1)
      .reduce((part, point, index) => part + Math.hypot(point.x - tunnel.points[index].x, point.y - tunnel.points[index].y), 0), 0);
    const cost = Math.max(1, Math.ceil((length + extra + tunnelLength * 0.65) / 20));
    if (economy().hm < cost) { message(`This segment requires ${cost} HM.`); return; }
    economy().hm -= cost;
    roads.push(...plan.roads);
    tunnels.push(...plan.tunnels);
    start = null;
    message(plan.tunnels.length
      ? `Road built for ${cost} HM. Steep terrain was cut into a vehicle tunnel with raised clearance.`
      : `Road built for ${cost} HM, including ramps and bridges. Select another starting point.`);
  }
  function handleClick(clientX, clientY) {
    if (!mode) return false;
    const point = worldPoint(clientX, clientY);
    if (point.x < 0 || point.x > worldWidth) { message('Choose a point inside the map.'); return true; }
    if (mode.startsWith('seed-')) placeSeed(mode.slice(5), point.x);
    else if (mode === 'mine') {
      const node = nodes.filter((item) => unclaimed(item) && connected(item, getSide()))
        .sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];
      if (!node || Math.hypot(node.x - point.x, node.y - point.y) > Math.max(20, node.size, 12 / options.camera.zoom)) message('Select a circled connected unclaimed node.');
      else if (availablePop(getSide()) < 1) message('Mining requires 1 available POP.');
      else {
        economy().assigned += 1;
        operations.push({ node, side: getSide(), miners: 1 });
        message('Mining started: 1 POP assigned; miners consume SM while producing HM.');
      }
    } else if (mode === 'road' || mode === 'tunnel') {
      const guide = mode === 'tunnel' ? guideAt(point) : null;
      if (guide) { placeTunnel(guide.points); return true; }
      if (mode === 'tunnel' && start) {
        const branch = nearestTunnel(point, getSide(), Math.max(4, 6 / options.camera.zoom));
        if (branch && Math.hypot(point.x - start.x, point.y - start.y) > 8 / options.camera.zoom) {
          start = branch;
          message('Tunnel branch selected. Choose an endpoint.');
          return true;
        }
      }
      if (!start) {
        start = mode === 'road' ? { x: point.x, y: surfaceYAt(point.x) } : nearestTunnel(point, getSide());
        message(start ? 'Move the cursor to preview, then click to confirm the endpoint.' : 'Start on your existing tunnel network.');
      } else placeRoute(routeEnd(point));
    } else if (mode === 'deploy-select') {
      const candidates = bases().map((building) => {
        const screen = worldToScreen(building.x + building.width / 2, surfaceYAt(building.x) - building.height);
        const click = worldToScreen(point.x, point.y);
        return { building, distance: Math.hypot(screen.x - click.x, screen.y - click.y) };
      }).sort((a, b) => a.distance - b.distance);
      if (candidates.length && candidates[0].distance < 22) {
        const building = candidates[0].building;
        if (selected.has(building)) selected.delete(building); else selected.add(building);
        refreshBases();
        message(`${selected.size} base(s) selected. Deploy toward the enemy core.`);
      } else message('Click a highlighted friendly military base or use the list.');
    } else if (mode === 'unit-order') {
      const click = worldToScreen(point.x, point.y);
      const candidates = units.filter((unit) => unit.health > 0 && unit.side === getSide())
        .map((unit) => ({ unit, distance: Math.hypot(worldToScreen(unit.x, unitY(unit)).x - click.x,
          worldToScreen(unit.x, unitY(unit)).y - click.y) }))
        .sort((a, b) => a.distance - b.distance);
      if (candidates.length && candidates[0].distance < 18) {
        const unit = candidates[0].unit;
        if (selectedUnits.has(unit)) selectedUnits.delete(unit); else selectedUnits.add(unit);
        message(`${selectedUnits.size} unit(s) selected. ${selectedUnits.size ? 'Click a destination to move or attack.' : 'Select an active unit.'}`);
      } else if (selectedUnits.size) {
        const structure = buildings.find((building) => building.health > 0 && building.owner !== getSide()
          && building.kind !== 'farm' && building.kind !== 'mine'
          && point.x >= building.x && point.x <= building.x + building.width
          && point.y >= Math.min(surfaceYAt(building.x), surfaceYAt(building.x + building.width)) - building.height
          && point.y <= surfaceYAt(point.x));
        if (structure) {
          const target = structure.x + structure.width / 2;
          for (const unit of selectedUnits) { unit.target = target; unit.hackTarget = structure; }
          message(`Ordered ${selectedUnits.size} unit(s) to infiltrate the hostile ${structure.kind} control panel.`);
        } else {
          const target = clamp(point.x, 0, worldWidth);
          for (const unit of selectedUnits) { unit.target = target; delete unit.hackTarget; }
          message(`Ordered ${selectedUnits.size} unit(s) to ${Math.round(target)}.`);
        }
      } else {
        message('Select an active friendly unit first.');
      }
    }
    return true;
  }
  function update(delta) {
    elapsed += delta;
    for (let i = bulletTrails.length - 1; i >= 0; i -= 1) {
      bulletTrails[i].age += delta;
      if (bulletTrails[i].age >= bulletTrailLifetime) bulletTrails.splice(i, 1);
    }
    for (let i = unitEffects.length - 1; i >= 0; i -= 1) {
      unitEffects[i].age += delta;
      if (unitEffects[i].age >= 1.3) unitEffects.splice(i, 1);
    }
    if (outcome) return;
    const ownCore = cores.find((core) => core.owner === getSide());
    const enemyCore = cores.find((core) => core.owner !== getSide());
    if (enemyCore && enemyCore.health <= 0) {
      outcome = 'victory';
      setMode('victory', 'VICTORY — ENEMY CORE DESTROYED.');
      return;
    }
    if (ownCore && ownCore.health <= 0) {
      outcome = 'defeat';
      setMode('defeat', 'DEFEAT — YOUR CORE WAS DESTROYED.');
      return;
    }
    const enemySide = getSide() === 'left' ? 'right' : 'left';
    if (economies[enemySide].pop <= 0) {
      outcome = 'victory';
      setMode('victory', 'VICTORY — ENEMY POPULATION ELIMINATED.');
      return;
    }
    if (economy().pop <= 0) {
      outcome = 'defeat';
      setMode('defeat', 'DEFEAT — YOUR POPULATION WAS ELIMINATED.');
      return;
    }
    const centerX = worldWidth / 2;
    const occupants = Object.fromEntries(['left', 'right'].map((side) => [side,
      units.filter((unit) => unit.health > 0 && unit.side === side && Math.abs(unit.x - centerX) < 150).length]));
    for (const side of ['left', 'right']) {
      if (occupants[side] > 0 && occupants[side === 'left' ? 'right' : 'left'] === 0) {
        centerHold[side] = Math.min(60, centerHold[side] + delta);
      } else {
        centerHold[side] = Math.max(0, centerHold[side] - delta * 2);
      }
      if (centerHold[side] >= 60) {
        outcome = side === getSide() ? 'victory' : 'defeat';
        setMode(outcome, `${outcome.toUpperCase()} — ${side.toUpperCase()} HELD THE CENTER FOR 60 SECONDS.`);
        return;
      }
    }
    for (const building of buildings) {
      if (building.kind !== 'farm' || building.neutral || building.health <= 0) continue;
      const side = building.owner;
      const activeWater = building.waterSources.some((source) => source.repairRemaining <= 0);
      if (activeWater) economies[side].sm += (building.cropLeft + building.cropRight) * 0.0005 * delta;
    }
    for (const operation of operations) {
      const funds = economies[operation.side];
      if (operation.node.amount <= 0 || funds.sm <= 0 || !connected(operation.node, operation.side)) continue;
      const time = Math.min(delta, funds.sm / 0.1, operation.node.amount / 0.5);
      funds.sm -= time * 0.1;
      funds.hm += time * 0.5;
      operation.node.amount = Math.max(0, operation.node.amount - time * 0.5);
    }
    for (const building of buildings) {
      if (!building.construction) continue;
      if (building.owner === 'neutral') advanceNeutralConstruction(building, delta);
      else advanceSeedConstruction(building, economies[building.owner], delta,
        canBuild(building.x, building.width));
    }
    for (const unit of units) {
      unit.dodgeCooldown = Math.max(0, (unit.dodgeCooldown || 0) - delta);
      unit.energy = Math.min(100, (unit.energy === undefined ? 100 : unit.energy) + 18 * delta);
      if (unit.dodgeTimer > 0) {
        unit.dodgeTimer = Math.max(0, unit.dodgeTimer - delta);
        unit.dodgeOffset = Math.sin((0.35 - unit.dodgeTimer) * Math.PI / 0.35) * 16;
      } else unit.dodgeOffset = 0;
      if (unit.jumpTimer > 0) {
        unit.jumpTimer = Math.max(0, unit.jumpTimer - delta);
        unit.jumpOffset = Math.sin((0.3 - unit.jumpTimer) * Math.PI / 0.3) * 18;
      } else unit.jumpOffset = 0;
    }
    for (const building of buildings) {
      if (building.kind !== 'military' || building.health <= 0 || building.defenseHealth <= 0) continue;
      const center = building.x + building.width / 2;
      for (const unit of units) {
        if (unit.health > 0 && unit.side !== building.owner && !unit.tunnel && Math.abs(center - unit.x) < 70) {
          if (unit.type === 'hopper' && unit.dodgeTimer > 0) continue;
          if (unit.type === 'hopper' && unit.energy >= 30 && unit.dodgeCooldown <= 0) {
            unit.energy -= 30;
            unit.dodgeCooldown = 2.2;
            unit.dodgeTimer = 0.35;
            unit.dodgeOffset = 1;
            continue;
          }
          unit.health -= (10 + building.level * 2) * delta;
        }
      }
      const targets = units.filter((unit) => unit.health > 0 && unit.side !== building.owner
        && !unit.tunnel && !(unit.type === 'hopper' && unit.dodgeTimer > 0) && Math.abs(center - unit.x) < 70);
      if (!targets.length || elapsed - (lastBulletShot.get(building) || 0) < bulletFireInterval) continue;
      lastBulletShot.set(building, elapsed);
      const top = Math.min(surfaceYAt(building.x), surfaceYAt(building.x + building.width)) - building.height;
      const start = { x: building.x + building.width * 0.25, y: top - 4 };
      for (const unit of targets) {
        const lineLeft = Math.min(start.x, unit.x), lineRight = Math.max(start.x, unit.x);
        const cover = buildings.filter((candidate) => candidate !== building && candidate.owner === unit.side
          && candidate.health > 0 && candidate.x + candidate.width / 2 > lineLeft
          && candidate.x + candidate.width / 2 < lineRight && (() => {
            const center = candidate.x + candidate.width / 2;
            const fraction = (center - start.x) / (unit.x - start.x || 1);
            const shotY = start.y + (unitY(unit) - 4 - start.y) * fraction;
            const ground = surfaceYAt(center);
            return shotY >= ground - candidate.height && shotY <= ground;
          })())
          .sort((a, b) => Math.abs(a.x + a.width / 2 - start.x) - Math.abs(b.x + b.width / 2 - start.x))[0];
        if (cover && cover.health > 15) {
          const damage = (10 + building.level * 2) * delta;
          cover.health = Math.max(0, cover.health - damage);
          if (!cover.damageMarks) cover.damageMarks = [];
          let mark = cover.damageMarks.find((item) => Math.abs(item.x - cover.width / 2) < 3);
          if (!mark) { mark = { x: cover.width / 2, y: Math.max(1, cover.height * 0.35), damage: 0 }; cover.damageMarks.push(mark); }
          mark.damage = Math.min(100, mark.damage + damage * 4);
          continue;
        }
        bulletTrails.push({ start, end: { x: unit.x, y: unitY(unit) - 4 }, age: 0 });
      }
    }
    for (const unit of units) {
      if (unit.health <= 0) continue;
      const speed = (unit.type === 'tank' ? 30 : unit.type === 'hopper' ? 26 : unit.type === 'jet' ? 65 : 20);
      if (unit.tunnel) {
        const opponentInTunnel = units.find((other) => other !== unit && other.health > 0 &&
          other.side !== unit.side && other.tunnel === unit.tunnel && Math.hypot(other.x - unit.x, (other.tunnelY || 0) - (unit.tunnelY || 0)) < 24);
        if (opponentInTunnel) {
          opponentInTunnel.health -= (unit.type === 'tank' ? 20 : unit.type === 'hopper' ? 16 : 12) * delta;
          continue;
        }
        advanceTunnel(unit, speed * delta);
        continue;
      }
      tryEnterTunnel(unit);
      if (unit.tunnel) {
        advanceTunnel(unit, speed * delta);
        continue;
      }
      const direction = Math.sign(unit.target - unit.x);
      const opponent = units.find((other) => other !== unit && other.health > 0 && other.side !== unit.side
        && !other.tunnel && Math.abs(other.x - unit.x) < 22);
      if (opponent) {
        opponent.health -= (unit.type === 'tank' ? 20 : unit.type === 'hopper' ? 16 : 12) * delta;
        continue;
      }
      const enemyCore = cores.find((core) => core.owner !== unit.side && core.health > 0);
      if (enemyCore && Math.abs(enemyCore.x + 7 - unit.x) < 16) {
        enemyCore.health = Math.max(0, enemyCore.health - (unit.type === 'tank' ? 24 : 12) * delta);
        continue;
      }
      const defense = buildings.find((building) => building.kind === 'military' && building.health > 0
        && building.defenseHealth > 0 && building.owner !== unit.side && Math.abs(building.x + building.width / 2 - unit.x) < 70);
      if (defense) {
        const damage = Math.min(defense.defenseHealth, (unit.type === 'tank' ? 25 : 16) * delta);
        defense.defenseHealth -= damage;
        defense.health = Math.max(0, defense.health - damage * 0.25);
        continue;
      }
      if (unit.hackTarget) {
        const target = unit.hackTarget;
        if (!buildings.includes(target) || target.health <= 0 || target.owner === unit.side) {
          delete unit.hackTarget;
        } else if (Math.abs(unit.x - (target.x + target.width / 2)) <= 7) {
          if (target.hackSide !== unit.side) { target.hackSide = unit.side; target.hackProgress = 0; }
          target.hackProgress = Math.min(6, (target.hackProgress || 0) + delta);
          if (target.hackProgress >= 6) {
            captureBuilding(target, unit.side, unit.side === 'left' ? 1 : -1);
            unit.target = unit.side === 'left' ? worldWidth : 0;
            delete unit.hackTarget;
          }
          continue;
        }
      }
      const currentRoad = roads.find((road) => unit.x >= road.left && unit.x <= road.right);
      if (currentRoad) currentRoad.side = unit.side;
      const travelSpeed = speed * (currentRoad ? 1.4 : 1) * (unit.type === 'hopper' && unit.dodgeTimer > 0 ? 2.4 : 1);
      const next = unit.x + direction * Math.min(Math.abs(unit.target - unit.x), travelSpeed * delta);
      const inWater = pools.some((pool) => next >= pool.left && next <= pool.right);
      const hasRoad = roads.some((road) => next >= road.left && next <= road.right);
      const rise = Math.abs(surfaceYAt(next) - surfaceYAt(unit.x));
      const step = Math.abs(next - unit.x);
      const jumpSlope = unit.type === 'trooper' ? 2.8 : Math.sqrt(3);
      if (unit.type !== 'jet' && ((inWater && !hasRoad) || (!hasRoad && rise > step * jumpSlope + 0.01))) continue;
      if (unit.type === 'trooper' && !hasRoad && rise > step * 0.55) {
        unit.jumpTimer = 0.3;
        unit.jumpOffset = 1;
      }
      for (const territory of territories) {
        if (territory.owner === unit.side) continue;
        const exit = direction > 0 ? territory.right : territory.left;
        const crossed = direction > 0 ? unit.x <= exit && next > exit : unit.x >= exit && next < exit;
        if (!crossed) continue;
        const defended = buildings.some((building) => building.cluster === territory.cluster && building.kind === 'military' && building.health > 0 && building.defenseHealth > 0 && building.owner !== unit.side)
          || units.some((other) => other.health > 0 && other.side !== unit.side && other.x >= territory.left && other.x <= territory.right);
        if (!defended) {
          for (const building of buildings.filter((item) => item.cluster === territory.cluster && item.health > 0)) {
            captureBuilding(building, unit.side, direction);
          }
          territory.owner = unit.side;
        }
      }
      unit.x = next;
    }
    for (let i = units.length - 1; i >= 0; i -= 1) {
      const unit = units[i];
      if (unit.health > 0) continue;
      selectedUnits.delete(unit);
      if (unit.type === 'hopper') {
        unitEffects.push({ type: 'mech-death', x: unit.x, y: unitY(unit), age: 0 });
        if (craterSurface) craterSurface(unit.x, 8, 3);
      }
      units.splice(i, 1);
    }
    if (!document.getElementById('deploy-panel').hidden) refreshBases();
  }
  function drawTunnels() {
    const tunnelMode = mode === 'tunnel';
    const side = sideIndex(getSide());
    for (const tunnel of tunnels) {
      const selectedTunnel = tunnelMode && tunnel.side === side;
      renderer.tunnel(ctx, tunnel, false, selectedTunnel, tunnelMode, 1.5);
      renderer.tunnel(ctx, tunnel, true, selectedTunnel, tunnelMode, 1.5);
    }
  }
  function draw() {
    ctx.save();
    ctx.translate(-options.camera.x * options.camera.zoom, -options.camera.y * options.camera.zoom);
    ctx.scale(options.camera.zoom, options.camera.zoom);
    function path(points, color, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.stroke();
    }
    for (const road of roads) renderer.road(ctx, road.points);
    for (const operation of operations) {
      if (operation.node.amount <= 0 || economies[operation.side].sm <= 0 || !connected(operation.node, operation.side)) continue;
      const x = operation.node.x + Math.sin(elapsed * 1.5) * 7;
      const y = operation.node.y;
      const facing = operation.side === 'left' ? 1 : -1;
      ctx.fillStyle = '#d3b18a';
      ctx.fillRect(x - 2, y - 3, 4, 4);
      ctx.fillStyle = '#d7c782';
      ctx.fillRect(x - 2, y - 6, 4, 2);
      ctx.fillStyle = '#fff1a0';
      ctx.fillRect(x + facing, y - 6, 2, 1);
      ctx.fillStyle = '#9a7656';
      ctx.fillRect(x - 3, y + 1, 2, 3);
      ctx.fillRect(x + 1, y + 1, 2, 3);
      ctx.strokeStyle = '#d4cfbd';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + facing * 2, y - 1);
      ctx.lineTo(x + facing * 5, y - 5);
      ctx.lineTo(x + facing * 6, y - 4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 236, 144, 0.13)';
      ctx.beginPath();
      ctx.moveTo(x + facing * 2, y - 6);
      ctx.lineTo(x + facing * 22, y - 10);
      ctx.lineTo(x + facing * 22, y - 2);
      ctx.closePath();
      ctx.fill();
    }
    for (const trail of bulletTrails) {
      renderer.bullet(ctx, trail.start, trail.end, 1 - trail.age / bulletTrailLifetime);
    }
    for (const unit of units) {
      const y = unitY(unit);
      const colors = { asian: '#e9c870', gothic: '#c6b5e9', modern: '#82d7d2' };
      ctx.fillStyle = colors[unit.style] || '#d7d2ba';
      const selectedUnit = selectedUnits.has(unit);
      if (selectedUnit) {
        ctx.strokeStyle = '#fff0a0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(unit.x, y - 4, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (unit.type === 'tank') {
        const road = roads.find((item) => unit.x >= item.left && unit.x <= item.right);
        const leftY = road ? roadY(road, Math.max(road.left, unit.x - 5)) : surfaceYAt(Math.max(0, unit.x - 5));
        const rightY = road ? roadY(road, Math.min(road.right, unit.x + 5)) : surfaceYAt(Math.min(worldWidth, unit.x + 5));
        ctx.save();
        ctx.translate(unit.x, y - 3);
        ctx.rotate(Math.atan2(rightY - leftY, 10));
        ctx.fillRect(-6, -1, 12, 4);
        ctx.fillRect(-3, -4, 6, 3);
        ctx.fillRect(unit.side === 'left' ? 0 : -8, -4, 8, 1);
        ctx.restore();
      } else if (unit.type === 'hopper') {
        ctx.fillRect(unit.x - 4, y - 8, 8, 5);
        ctx.fillRect(unit.x - 5, y - 3, 2, 4);
        ctx.fillRect(unit.x + 3, y - 3, 2, 4);
      } else {
        ctx.fillRect(unit.x - 1, y - 8, 2, 2);
        ctx.fillRect(unit.x - 1, y - 6, 2, 4);
        ctx.fillRect(unit.x - 3, y - 2, 2, 3);
        ctx.fillRect(unit.x + 1, y - 2, 2, 3);
      }
      if (unit.type === 'hopper') {
        ctx.fillStyle = '#202020';
        ctx.fillRect(unit.x - 7, y - 13, 14, 2);
        ctx.fillStyle = '#d9f0a0';
        ctx.fillRect(unit.x - 7, y - 13, 14 * Math.max(0, Math.min(1, unit.energy / 100)), 2);
      }
    }
    for (const effect of unitEffects) {
      const progress = Math.min(1, effect.age / 1.3);
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = '#f4f5e6';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y + 3, 3 + progress * 9, 0, Math.PI * 2);
      ctx.stroke();
      for (let streak = 0; streak < 6; streak += 1) {
        const angle = streak * Math.PI / 3;
        const length = 4 + progress * 12;
        ctx.beginPath();
        ctx.moveTo(effect.x + Math.cos(angle) * 2, effect.y + Math.sin(angle) * 2);
        ctx.lineTo(effect.x + Math.cos(angle) * length, effect.y + Math.sin(angle) * length);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (mode === 'mine') {
      for (const node of nodes.filter((item) => unclaimed(item) && connected(item, getSide()))) {
        ctx.strokeStyle = '#f8783e'; ctx.lineWidth = 2 / options.camera.zoom;
        ctx.beginPath(); ctx.arc(node.x, node.y, Math.max(node.size, 8 / options.camera.zoom), 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (mode === 'deploy-select') {
      for (const building of bases()) {
        ctx.strokeStyle = selected.has(building) ? '#ffd05c' : '#f8783e';
        ctx.lineWidth = 2 / options.camera.zoom;
        ctx.beginPath(); ctx.arc(building.x + building.width / 2, surfaceYAt(building.x) - building.height, 9 / options.camera.zoom, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (mode === 'tunnel') {
      ctx.setLineDash([5 / options.camera.zoom, 4 / options.camera.zoom]);
      for (const guide of tunnelGuides()) path(guide.points, '#9ed85b', 1.5 / options.camera.zoom);
      ctx.setLineDash([]);
    }
    if (start && pointer && (mode === 'road' || mode === 'tunnel')) {
      const end = routeEnd(pointer);
      if (mode === 'road' && Math.abs(start.x - end.x) >= 0.01) path(roadProfile(Math.min(start.x, end.x), Math.max(start.x, end.x)).map((point) => ({ x: point.x, y: point.y - 2 })), '#fff0a0', 2);
      else path([start, end], '#fff0a0', 2);
    }
    if (pointer && mode === 'road' && pointer.x >= 0 && pointer.x <= worldWidth) {
      path([{ x: pointer.x, y: pointer.y }, { x: pointer.x, y: surfaceYAt(pointer.x) }], '#6ef08a', 1 / options.camera.zoom);
    }
    if (pointer && mode.startsWith('seed-') && pointer.x >= 0 && pointer.x <= worldWidth) {
      const site = seedSite(mode.slice(5), pointer.x);
      const color = site.valid ? '#6ef08a' : '#ff2920';
      path([{ x: pointer.x, y: pointer.y }, { x: pointer.x, y: surfaceYAt(pointer.x) }], color, 1 / options.camera.zoom);
      path([{ x: site.x, y: surfaceYAt(site.x) }, { x: site.x + site.width, y: surfaceYAt(site.x + site.width) }], color, 2 / options.camera.zoom);
    }
    ctx.restore();
  }
  return {
    handleClick, update, draw, drawTunnels,
    repairBuilding: (building, delta) => {
      if (building.neutral || building.health <= 0 || building.health >= 100) return;
      const funds = economies[building.owner];
      if (!funds) return;
      const previousHealth = building.health;
      const repaired = Math.min(100 - previousHealth, 2 * delta, funds.hm / 0.1);
      if (repaired <= 0) return;
      funds.hm = Math.max(0, funds.hm - repaired * 0.1);
      building.health = Math.min(100, previousHealth + repaired);
      if (building.rebuildHeight !== undefined) {
        building.height += (building.rebuildHeight - building.height) * repaired / (100 - previousHealth);
        if (building.health >= 100 - 1e-8) {
          building.height = building.rebuildHeight;
          delete building.rebuildHeight;
        }
      }
      if (building.damageMarks) {
        for (const mark of building.damageMarks) mark.damage = Math.max(0, mark.damage - repaired);
        building.damageMarks = building.damageMarks.filter((mark) => mark.damage > 0);
      }
      if (building.health >= 100 - 1e-8) building.health = 100;
    },
    isTunnelMode: () => mode === 'tunnel',
    pointerMove: (x, y) => { pointer = worldPoint(x, y); },
    refresh: () => { selected.clear(); selectedUnits.clear(); listKey = ''; reset(); refreshBases(); },
    unitSnapshot: () => units.map((unit) => ({ x: unit.x, target: unit.target, type: unit.type,
      side: unit.side, health: unit.health, selected: selectedUnits.has(unit), tunnel: Boolean(unit.tunnel),
      tunnelDistance: unit.tunnelDistance, tunnelLength: unit.tunnelTotal, tunnelY: unit.tunnelY,
      tunnelPath: unit.tunnelPath && unit.tunnelPath.map((point) => ({ ...point })) })),
    networkSnapshot: () => ({ roads: roads.length, tunnels: tunnels.map((tunnel) => ({ side: tunnel.side,
      width: tunnel.interiorWidth, points: tunnel.points.map((point) => ({ ...point })) })) }),
    repairIrrigation: (farm, source, delta) => {
      if (source.repairRemaining <= 0) return;
      if (farm.owner === 'neutral') { source.repairRemaining = Math.max(0, source.repairRemaining - delta); return; }
      const funds = economies[farm.owner];
      if (!funds) return;
      const work = Math.min(delta, source.repairRemaining, funds.hm / 0.5);
      funds.hm = Math.max(0, funds.hm - work * 0.5);
      source.repairRemaining = Math.max(0, source.repairRemaining - work);
    },
    objective: () => ({ outcome, centerHold: { ...centerHold } }),
    resources: () => ({ ...economy(), available: availablePop(getSide()) }),
    production: () => {
      const owned = buildings.filter((building) => building.owner === getSide() && building.health > 0);
      const farms = owned.filter((building) => building.kind === 'farm');
      const activeMines = operations.filter((operation) => operation.side === getSide() && operation.node.amount > 0
        && economies[operation.side].sm > 0 && connected(operation.node, operation.side));
      const housing = owned.filter((building) => !['farm', 'military', 'mine'].includes(building.kind));
      return {
        housing: housing.length,
        population: housing.reduce((sum, building) => sum + (building.population || 0), 0),
        farms: farms.length,
        sm: farms.reduce((sum, farm) => sum + (farm.waterSources.some((source) => source.repairRemaining <= 0)
          ? (farm.cropLeft + farm.cropRight) * 0.0005 : 0), 0),
        mines: operations.filter((operation) => operation.side === getSide()).length,
        hm: activeMines.length * 0.5,
        military: owned.filter((building) => building.kind === 'military').length,
        floodedConstruction: owned.filter((building) => building.construction &&
          building.construction.stage < 4 && !canBuild(building.x, building.width)).length,
      };
    },
    damageRoads: (center, radius) => {
      for (let i = roads.length - 1; i >= 0; i -= 1) {
        if (center + radius >= roads[i].left && center - radius <= roads[i].right) roads.splice(i, 1);
      }
    },
    buildingRemoved: (building) => {
      if (building.construction && building.construction.stage < 4) economies[building.owner].assigned -= 1;
      if (building.owner !== 'neutral') economies[building.owner].pop -= building.population || 0;
    },
  };
}
