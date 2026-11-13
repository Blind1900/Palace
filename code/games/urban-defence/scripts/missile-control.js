function createMissileControl({ canvas, ctx, buildings, surfaceYAt, worldToScreen, screenToWorld, getSide, worldWidth, craterSurface, waterLevelAt, splashWater, breakBuilding, renderer }) {
  const command = document.getElementById('missile-command');
  const panel = document.getElementById('missile-panel');
  const status = document.getElementById('missile-status');
  const selectButton = document.getElementById('missile-select');
  const launcherList = document.getElementById('missile-launchers');
  const targetButton = document.getElementById('missile-target');
  const fireButton = document.getElementById('missile-fire');
  const clearButton = document.getElementById('missile-clear');
  const closeButton = document.getElementById('missile-close');
  const selected = new Set();
  const targets = [];
  const missiles = [];
  const pendingLaunches = [];
  const impacts = [];
  const trails = [];
  const interceptors = [];
  const defenseCooldowns = new Map();
  const trailLifetime = 2.8;
  const detectionRadius = 1500;
  const protectedRadius = 750;
  const launchInterval = 0.22;
  const launchers = [];
  let mode = 'launchers';
  let listKey = '';

  function eligible(building) {
    return building.kind === 'military' && building.level >= 3 && building.health > 0 && !building.neutral
      && building.owner === getSide();
  }

  function launcherPosition(launcher) {
    const { building, tube } = launcher;
    return {
      x: building.x + building.width * 0.48 + building.direction * (tube === 0 ? 4 : 7),
      y: Math.min(surfaceYAt(building.x), surfaceYAt(building.x + building.width)) - building.height - 10,
    };
  }

  function salvoSize(level) {
    return 3 + 2 * (Math.max(1, Math.min(4, level)) - 1);
  }

  function refresh() {
    for (const building of buildings) {
      if (building.kind !== 'military' || building.level < 3) continue;
      for (const tube of [0, 1]) {
        if (!launchers.some((launcher) => launcher.building === building && launcher.tube === tube)) {
          launchers.push({ building, tube });
        }
      }
    }
    for (const launcher of selected) {
      if (!buildings.includes(launcher.building) || !eligible(launcher.building)) selected.delete(launcher);
    }
    const availableLaunchers = launchers.filter((launcher) => buildings.includes(launcher.building) && eligible(launcher.building));
    const key = availableLaunchers.map((launcher) => `${launcher.building.x}:${launcher.tube}:${launcher.building.level}`).join(',');
    if (key !== listKey) {
      launcherList.querySelectorAll('label').forEach((label) => label.remove());
      for (const [index, launcher] of availableLaunchers.entries()) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', () => {
          if (input.checked) selected.add(launcher);
          else selected.delete(launcher);
          refresh();
        });
        label.append(input, document.createTextNode(` LAUNCHER ${index + 1} / LV ${launcher.building.level} (${salvoSize(launcher.building.level)} missiles)`));
        launcherList.append(label);
      }
      listKey = key;
    }
    launcherList.querySelectorAll('input').forEach((input, index) => {
      input.checked = selected.has(availableLaunchers[index]);
    });
    const available = availableLaunchers.length;
    const instruction = mode === 'launchers'
      ? 'Click highlighted friendly launchers to select them. Drag to pan.'
      : 'Click a building or the surface to add targets. Drag to pan.';
    status.textContent = `${selected.size} selected / ${available} available; ${targets.length} target(s). ${available ? instruction : 'No friendly level 3+ launchers available.'}`;
    selectButton.setAttribute('aria-pressed', String(mode === 'launchers'));
    targetButton.setAttribute('aria-pressed', String(mode === 'targets'));
    fireButton.disabled = selected.size === 0 || targets.length === 0;
  }

  function setMode(nextMode) {
    mode = nextMode;
    refresh();
  }

  command.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    command.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) refresh();
  });
  closeButton.addEventListener('click', () => {
    panel.hidden = true;
    command.setAttribute('aria-expanded', 'false');
  });
  selectButton.addEventListener('click', () => setMode('launchers'));
  targetButton.addEventListener('click', () => setMode('targets'));
  clearButton.addEventListener('click', () => {
    selected.clear();
    targets.length = 0;
    setMode('launchers');
  });
  fireButton.addEventListener('click', () => {
    refresh();
    if (!selected.size || !targets.length) return;
    let targetIndex = 0;
    for (const launcher of selected) {
      for (let shot = 0; shot < salvoSize(launcher.building.level); shot += 1) {
        pendingLaunches.push({
          launcher, target: { ...targets[targetIndex % targets.length] },
          side: getSide(), delay: shot * launchInterval,
        });
        targetIndex += 1;
      }
    }
    targets.length = 0;
    setMode('targets');
  });

  function handleClick(clientX, clientY) {
    if (panel.hidden) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - canvas.clientLeft;
    const y = clientY - rect.top - canvas.clientTop;
    if (mode === 'launchers') {
      let closest = null;
      let distance = 20;
      for (const launcher of launchers.filter((item) => buildings.includes(item.building) && eligible(item.building))) {
        const point = launcherPosition(launcher);
        const screen = worldToScreen(point.x, point.y);
        const current = Math.hypot(screen.x - x, screen.y - y);
        if (current < distance) {
          closest = launcher;
          distance = current;
        }
      }
      if (closest) {
        if (selected.has(closest)) selected.delete(closest);
        else selected.add(closest);
      }
    } else {
      const point = screenToWorld(x, y);
      if (point.x >= 0 && point.x <= worldWidth) {
        const building = buildings.find((item) => {
          const bounds = buildingBounds(item);
          return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
        });
        targets.push({ x: point.x, y: building ? point.y : surfaceYAt(point.x), ground: !building });
      }
    }
    refresh();
  }

  function position(missile, t) {
    const u = 1 - t;
    return {
      x: u * u * missile.start.x + 2 * u * t * missile.control.x + t * t * missile.target.x,
      y: u * u * missile.start.y + 2 * u * t * missile.control.y + t * t * missile.target.y,
    };
  }

  function buildingBounds(building) {
    const width = building.kind === 'farm' ? 14 : building.width;
    const ground = Math.min(surfaceYAt(building.x), surfaceYAt(building.x + width));
    return { left: building.x, right: building.x + width, top: ground - building.height, bottom: ground };
  }

  function buildingSide(building) {
    return building.owner;
  }

  function explosionAt(point) {
    const sparks = Array.from({ length: 14 }, (_, index) => {
      const angle = (index + Math.random() * 0.6) * Math.PI * 2 / 14;
      const speed = 35 + Math.random() * 95;
      return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, lifetime: 0.45 + Math.random() * 0.5 };
    });
    impacts.push({ ...point, age: 0, sparks });
  }

  function impactAt(point, building) {
    explosionAt(point);
    if (building) {
      const bounds = buildingBounds(building);
      if (!building.damageMarks) building.damageMarks = [];
      const x = point.x - building.x;
      const y = point.y - bounds.top;
      let mark = building.damageMarks.find((item) => Math.hypot(item.x - x, item.y - y) < 8);
      if (!mark) {
        mark = { x, y, damage: 0 };
        building.damageMarks.push(mark);
      }
      mark.damage = Math.min(100, mark.damage + 35);
      building.health = Math.max(0, building.health - 35);
      if (mark.damage >= 70 && building.health > 0) breakBuilding(building, mark);
    } else {
      splashWater(point.x);
      craterSurface(point.x);
    }
  }

  function sampleTrail(from, to, elapsed) {
    const count = Math.max(1, Math.ceil(elapsed / 0.045), Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 5));
    for (let i = 1; i <= count; i += 1) {
      const fraction = i / count;
      const previous = (i - 1) / count;
      trails.push({
        fromX: from.x + (to.x - from.x) * previous,
        fromY: from.y + (to.y - from.y) * previous,
        x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction,
        startAge: elapsed * (1 - previous),
        age: elapsed * (1 - fraction),
      });
    }
  }

  function trailColor(age) {
    const progress = Math.max(0, Math.min(1, age / trailLifetime));
    const blend = progress < 0.3 ? progress / 0.3 : (progress - 0.3) / 0.7;
    const from = progress < 0.3 ? [255, 255, 255] : [255, 35, 20];
    const to = progress < 0.3 ? [255, 35, 20] : [255, 225, 40];
    const green = Math.round(from[1] + (to[1] - from[1]) * blend);
    const blue = Math.round(from[2] + (to[2] - from[2]) * blend);
    return `rgba(255, ${green}, ${blue}, ${0.9 * (1 - progress)})`;
  }

  function advanceMissile(missile, delta) {
    if (missile.target.ground) missile.target.y = surfaceYAt(missile.target.x);
    const previous = missile.elapsed;
    const next = Math.min(missile.duration, previous + delta);
    const start = position(missile, previous / missile.duration);
    const end = position(missile, next / missile.duration);
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 3));
    let last = start;
    for (let i = 1; i <= steps; i += 1) {
      const time = previous + (next - previous) * i / steps;
      const point = position(missile, time / missile.duration);
      const building = buildings.find((item) => {
        const bounds = buildingBounds(item);
        return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
      });
      const waterLevel = waterLevelAt(point.x);
      if (building || point.y >= (waterLevel === null ? surfaceYAt(point.x) : waterLevel)) {
        sampleTrail(start, point, time - previous);
        impactAt(point, building);
        missile.elapsed = time;
        return false;
      }
      last = point;
    }
    missile.elapsed = next;
    sampleTrail(start, last, next - previous);
    if (next >= missile.duration) {
      impactAt({ x: last.x, y: surfaceYAt(last.x) }, null);
      return false;
    }
    return true;
  }

  function launchDefenses() {
    for (const building of buildings) {
      if (building.kind !== 'military' || building.level < 4 || building.health <= 0 || building.defenseHealth <= 0
        || (defenseCooldowns.get(building) || 0) > 0) continue;
      const bounds = buildingBounds(building);
      const origin = { x: building.x + building.width * 0.88, y: bounds.top - 12 };
      for (const missile of missiles) {
        if (buildingSide(building) === missile.side || interceptors.some((item) => item.target === missile)) continue;
        if (Math.abs(missile.target.x - origin.x) > protectedRadius) continue;
        const t = missile.elapsed / missile.duration;
        const point = position(missile, t);
        const future = position(missile, Math.min(1, t + 0.01));
        const dx = origin.x - point.x;
        const dy = origin.y - point.y;
        if (Math.hypot(dx, dy) > detectionRadius || dx * (future.x - point.x) + dy * (future.y - point.y) <= 0) continue;
        interceptors.push({ x: origin.x, y: origin.y, target: missile });
        defenseCooldowns.set(building, 0.8);
        break;
      }
    }
  }

  function interceptorWaypoint(interceptor, target) {
    const distance = Math.abs(target.x - interceptor.x);
    const steps = Math.max(1, Math.ceil(distance / 4));
    let highestGround = Infinity;
    let blocked = false;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = interceptor.x + (target.x - interceptor.x) * t;
      const ground = surfaceYAt(x);
      highestGround = Math.min(highestGround, ground);
      if (interceptor.y + (target.y - interceptor.y) * t >= ground - 16) blocked = true;
    }
    if (!blocked || interceptor.y <= highestGround - 48) return target;
    let advance = (target.x - interceptor.x) * 0.15;
    let waypoint = { x: interceptor.x + advance, y: highestGround - 48 };
    while (Math.abs(advance) > 1 && interceptorGroundHit(interceptor, waypoint)) {
      advance *= 0.5;
      waypoint = { x: interceptor.x + advance, y: highestGround - 48 };
    }
    return waypoint;
  }

  function interceptorGroundHit(from, to) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      if (y >= surfaceYAt(x)) return { x, y: surfaceYAt(x) };
    }
    return null;
  }

  function update(delta) {
    for (let i = trails.length - 1; i >= 0; i -= 1) {
      trails[i].age += delta;
      trails[i].startAge += delta;
      if (trails[i].age >= trailLifetime) trails.splice(i, 1);
    }
    for (let i = impacts.length - 1; i >= 0; i -= 1) {
      impacts[i].age += delta;
      if (impacts[i].age >= 1.2) impacts.splice(i, 1);
    }
    for (let i = pendingLaunches.length - 1; i >= 0; i -= 1) {
      const launch = pendingLaunches[i];
      launch.delay -= delta;
      if (launch.delay > 0) continue;
      pendingLaunches.splice(i, 1);
      if (!buildings.includes(launch.launcher.building) || launch.launcher.building.health <= 0
        || launch.launcher.building.owner !== launch.side) continue;
      const start = launcherPosition(launch.launcher);
      const distance = Math.abs(launch.target.x - start.x);
      missiles.push({
        start, target: launch.target, elapsed: 0, side: launch.side,
        duration: Math.min(7, 2.2 + distance / 1400),
        control: { x: (start.x + launch.target.x) / 2, y: Math.min(start.y, launch.target.y) - Math.min(1200, 100 + distance * 0.28) },
      });
    }
    for (let i = missiles.length - 1; i >= 0; i -= 1) {
      const missile = missiles[i];
      if (!advanceMissile(missile, delta)) missiles.splice(i, 1);
    }
    for (const [building, cooldown] of defenseCooldowns) {
      if (!buildings.includes(building) || cooldown <= delta) defenseCooldowns.delete(building);
      else defenseCooldowns.set(building, cooldown - delta);
    }
    launchDefenses();
    for (let i = interceptors.length - 1; i >= 0; i -= 1) {
      const interceptor = interceptors[i];
      if (!missiles.includes(interceptor.target)) {
        interceptors.splice(i, 1);
        continue;
      }
      const point = position(interceptor.target, interceptor.target.elapsed / interceptor.target.duration);
      const waypoint = interceptorWaypoint(interceptor, point);
      const distance = Math.hypot(waypoint.x - interceptor.x, waypoint.y - interceptor.y);
      const travel = 1100 * delta;
      const fraction = distance ? Math.min(1, travel / distance) : 1;
      const next = { x: interceptor.x + (waypoint.x - interceptor.x) * fraction, y: interceptor.y + (waypoint.y - interceptor.y) * fraction };
      const groundHit = interceptorGroundHit(interceptor, next);
      sampleTrail(interceptor, groundHit || next, delta * fraction);
      if (groundHit) {
        explosionAt(groundHit);
        interceptors.splice(i, 1);
        continue;
      }
      interceptor.x = next.x;
      interceptor.y = next.y;
      if (fraction === 1 && waypoint === point) {
        explosionAt(point);
        missiles.splice(missiles.indexOf(interceptor.target), 1);
        interceptors.splice(i, 1);
      }
    }
  }

  function draw() {
    ctx.save();
    if (!panel.hidden) {
      for (const launcher of launchers.filter((item) => buildings.includes(item.building) && eligible(item.building))) {
        const point = launcherPosition(launcher);
        const screen = worldToScreen(point.x, point.y);
        ctx.strokeStyle = selected.has(launcher) ? '#ffd05c' : '#f47a32';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, selected.has(launcher) ? 9 : 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      targets.forEach((target, index) => {
        const point = worldToScreen(target.x, target.y);
        ctx.strokeStyle = '#ff6a30';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(point.x - 7, point.y);
        ctx.lineTo(point.x + 7, point.y);
        ctx.moveTo(point.x, point.y - 20);
        ctx.lineTo(point.x, point.y + 6);
        ctx.stroke();
        ctx.fillStyle = '#ffad55';
        ctx.font = '10px Ithaca, "Segoe UI", sans-serif';
        ctx.fillText(String(index + 1), point.x + 8, point.y - 8);
      });
    }
    for (const trail of trails) {
      const start = worldToScreen(trail.fromX, trail.fromY);
      const point = worldToScreen(trail.x, trail.y);
      if (start.x === point.x && start.y === point.y) continue;
      const gradient = ctx.createLinearGradient(start.x, start.y, point.x, point.y);
      gradient.addColorStop(0, trailColor(trail.startAge));
      gradient.addColorStop(1, trailColor(trail.age));
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const missile of missiles) {
      const t = Math.min(1, missile.elapsed / missile.duration);
      const point = position(missile, t);
      const screen = worldToScreen(point.x, point.y);
      renderer.missile(ctx, screen, false);
    }
    for (const interceptor of interceptors) {
      const screen = worldToScreen(interceptor.x, interceptor.y);
      renderer.missile(ctx, screen, true);
    }
    for (const impact of impacts) {
      const point = worldToScreen(impact.x, impact.y);
      const progress = impact.age / 1.2;
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = '#ff8b32';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3 + progress * 18, 0, Math.PI * 2);
      ctx.stroke();
      for (const spark of impact.sparks) {
        if (impact.age >= spark.lifetime) continue;
        const x = impact.x + spark.vx * impact.age;
        const y = impact.y + spark.vy * impact.age + 45 * impact.age * impact.age;
        const tailAge = Math.max(0, impact.age - 0.08);
        const head = worldToScreen(x, y);
        const tail = worldToScreen(
          impact.x + spark.vx * tailAge,
          impact.y + spark.vy * tailAge + 45 * tailAge * tailAge,
        );
        ctx.globalAlpha = 1 - impact.age / spark.lifetime;
        ctx.strokeStyle = impact.age < 0.2 ? '#fff1aa' : '#ff9938';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  return { handleClick, update, draw, refresh };
}
