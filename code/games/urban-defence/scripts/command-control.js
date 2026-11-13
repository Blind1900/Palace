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
  if (building.construction.progress < 8 || funds.hm < 4 || funds.sm < 2) return;
  funds.hm -= 4;
  funds.sm -= 2;
  building.construction.progress = 0;
  building.construction.stage += 1;
  building.height = 6 + building.construction.stage * (building.kind === 'farm' ? 2 : 5);
  if (building.kind === 'military') building.level = building.construction.stage;
  if (building.kind === 'flat') { funds.pop += 1; building.population += 1; }
  if (building.construction.stage === 4) funds.assigned -= 1;
}

function createCommandControl(options) {
  const { canvas, ctx, buildings, nodes, tunnels, cores, pools, territories, surfaceYAt,
    worldToScreen, screenToWorld, getSide, worldWidth, worldHeight, canBuild,
    farmWaterSources, tunnelWidth, startingResources, renderer } = options;
  const seedBuildRadius = 240;
  const status = document.getElementById('command-status');
  const panels = ['build', 'route', 'deploy', 'missile'];
  const economies = createStartingEconomies(startingResources, tunnels);
  const operations = tunnels.map((tunnel) => ({ node: tunnel.node, side: tunnel.side === 0 ? 'left' : 'right', miners: 1 }));
  const roads = [];
  const units = [];
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
      units.push({ x: building.x + building.width / 2, target: enemyCore.x + 7, type: types[Math.min(4, building.level) - 1], side: getSide(), health: 100 });
    }
    message(`Deployed ${selected.size} unit(s) toward the enemy core.`);
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
    const road = roads.find((item) => unit.x >= item.left && unit.x <= item.right);
    return (road && unit.type !== 'jet' ? roadY(road, unit.x) : surfaceYAt(unit.x))
      - (unit.type === 'jet' ? 55 : 3);
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
    tunnels.push({ side: sideIndex(getSide()), interiorWidth: tunnelWidth, points });
    start = points[points.length - 1];
    message(`Tunnel built for ${cost} HM. Continue from the endpoint or right-click to finish.`);
  }
  function placeRoute(end) {
    if (mode === 'tunnel') { placeTunnel([start, end]); return; }
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const length = right - left;
    if (length < 4) { message('Choose a longer segment.'); return; }
    const points = roadProfile(left, right);
    let extra = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const width = b.x - a.x;
      if (pools.some((pool) => a.x < pool.right && b.x > pool.left)) extra += width * 2;
      else if (surfaceYAt((a.x + b.x) / 2) - (a.y + b.y) / 2 > 0.1
        || Math.abs(surfaceYAt(b.x) - surfaceYAt(a.x)) > width * Math.sqrt(3)) extra += width;
    }
    const cost = Math.max(1, Math.ceil((length + extra) / 20));
    if (economy().hm < cost) { message(`This segment requires ${cost} HM.`); return; }
    economy().hm -= cost;
    roads.push({ left, right, points, side: getSide() });
    start = null;
    message(`Road built for ${cost} HM, including ramps and bridges. Select another starting point.`);
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
    }
    return true;
  }
  function update(delta) {
    elapsed += delta;
    for (let i = bulletTrails.length - 1; i >= 0; i -= 1) {
      bulletTrails[i].age += delta;
      if (bulletTrails[i].age >= bulletTrailLifetime) bulletTrails.splice(i, 1);
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
      if (!building.construction || building.owner === 'neutral') continue;
      advanceSeedConstruction(building, economies[building.owner], delta,
        canBuild(building.x, building.width));
    }
    for (const building of buildings) {
      if (building.kind !== 'military' || building.health <= 0 || building.defenseHealth <= 0) continue;
      const center = building.x + building.width / 2;
      for (const unit of units) {
        if (unit.health > 0 && unit.side !== building.owner && Math.abs(center - unit.x) < 70) {
          unit.health -= (10 + building.level * 2) * delta;
        }
      }
      const targets = units.filter((unit) => unit.health > 0 && unit.side !== building.owner
        && Math.abs(center - unit.x) < 70);
      if (!targets.length || elapsed - (lastBulletShot.get(building) || 0) < bulletFireInterval) continue;
      lastBulletShot.set(building, elapsed);
      const top = Math.min(surfaceYAt(building.x), surfaceYAt(building.x + building.width)) - building.height;
      const start = { x: building.x + building.width * 0.25, y: top - 4 };
      for (const unit of targets) {
        bulletTrails.push({ start, end: { x: unit.x, y: unitY(unit) - 4 }, age: 0 });
      }
    }
    for (const unit of units) {
      if (unit.health <= 0) continue;
      const direction = Math.sign(unit.target - unit.x);
      const opponent = units.find((other) => other !== unit && other.health > 0 && other.side !== unit.side && Math.abs(other.x - unit.x) < 22);
      if (opponent) {
        opponent.health -= (unit.type === 'tank' ? 20 : 12) * delta;
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
      const currentRoad = roads.find((road) => unit.x >= road.left && unit.x <= road.right);
      if (currentRoad) currentRoad.side = unit.side;
      const speed = (unit.type === 'tank' ? 30 : unit.type === 'jet' ? 65 : 20) * (currentRoad ? 1.4 : 1);
      const next = unit.x + direction * Math.min(Math.abs(unit.target - unit.x), speed * delta);
      const inWater = pools.some((pool) => next >= pool.left && next <= pool.right);
      const hasRoad = roads.some((road) => next >= road.left && next <= road.right);
      if (unit.type !== 'jet' && ((inWater && !hasRoad) || (!hasRoad && Math.abs(surfaceYAt(next) - surfaceYAt(unit.x)) > Math.abs(next - unit.x) * Math.sqrt(3) + 0.01))) continue;
      for (const territory of territories) {
        if (territory.owner === unit.side) continue;
        const exit = direction > 0 ? territory.right : territory.left;
        const crossed = direction > 0 ? unit.x <= exit && next > exit : unit.x >= exit && next < exit;
        if (!crossed) continue;
        const defended = buildings.some((building) => building.cluster === territory.cluster && building.kind === 'military' && building.health > 0 && building.defenseHealth > 0 && building.owner !== unit.side)
          || units.some((other) => other.health > 0 && other.side !== unit.side && other.x >= territory.left && other.x <= territory.right);
        if (!defended) {
          for (const building of buildings.filter((item) => item.cluster === territory.cluster && item.health > 0)) {
            if (building.owner !== 'neutral') economies[building.owner].pop -= building.population || 0;
            economies[unit.side].pop += building.population || 0;
            if (building.construction && building.construction.stage < 4 && building.owner !== 'neutral') {
              economies[building.owner].assigned -= 1;
              economies[unit.side].assigned += 1;
            }
            building.owner = unit.side;
            building.neutral = false;
            building.captured = true;
            building.direction = direction;
          }
          territory.owner = unit.side;
        }
      }
      unit.x = next;
    }
    for (let i = units.length - 1; i >= 0; i -= 1) if (units[i].health <= 0) units.splice(i, 1);
    if (!document.getElementById('deploy-panel').hidden) refreshBases();
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
      ctx.fillStyle = '#e9e2b9';
      ctx.fillRect(x - 1, y - 5, 2, 2);
      ctx.fillRect(x - 1, y - 3, 2, 4);
    }
    for (const trail of bulletTrails) {
      renderer.bullet(ctx, trail.start, trail.end, 1 - trail.age / bulletTrailLifetime);
    }
    for (const unit of units) {
      const y = unitY(unit);
      ctx.fillStyle = unit.side === 'left' ? '#e5ddb4' : '#f48c8c';
      if (unit.type === 'tank') {
        ctx.fillRect(unit.x - 6, y - 4, 12, 4);
        ctx.fillRect(unit.x - 3, y - 7, 6, 3);
        ctx.fillRect(unit.x, y - 7, unit.side === 'left' ? 8 : -8, 1);
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
    handleClick, update, draw,
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
    refresh: () => { selected.clear(); listKey = ''; reset(); refreshBases(); },
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
