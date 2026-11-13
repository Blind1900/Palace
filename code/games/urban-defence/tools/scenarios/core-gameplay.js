// Core gameplay smoke test for the beta, driven with real mouse input:
// build a seed, draw a road, draw a road over a mountain (automatic tunnel), extend a tunnel,
// deploy troops, order them, and fire a missile salvo at an enemy building.
// Run from the urban-defence folder:
//   tools/check-beta-game.cjs --seed=7 --scenario=tools/scenarios/core-gameplay.js --out=<folder>
const checks = [];
const check = (ok, label, detail = '') => checks.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail !== '' ? ` (${detail})` : ''}`);
const clickElement = async (selector) => {
  const element = document.querySelector(selector);
  if (!element || element.offsetParent === null) throw new Error(`${selector} is not visible`);
  const rect = element.getBoundingClientRect();
  await click(rect.left + rect.width / 2, rect.top + rect.height / 2);
  await sleep(60);
};
const status = () => document.getElementById('command-status').textContent;
const resources = () => commandControl.resources();
const friendly = () => buildingBlueprints.filter((building) => !building.neutral && building.health > 0 && building.owner === baseSide);

function findSeedCenter(kind) {
  const buildingKind = kind === 'housing' ? 'flat' : kind;
  const variant = urbanPixelArtVariant(buildingKind, buildingBlueprints.length);
  const width = getUrbanPixelBuildingFootprintForVariant(urbanPixelArtType(buildingKind), variant);
  for (let center = 0; center < WORLD_WIDTH; center += 4) {
    const x = Math.round(center - width / 2);
    if (!friendly().some((building) => Math.max(building.x - (x + width), x - (building.x + building.width), 0) <= 200)) continue;
    if (!canBuildOnTerrain(x, width)) continue;
    if (buildingBlueprints.some((building) => {
      const left = building.x - (building.kind === 'farm' ? building.cropLeft : 0);
      const right = building.x + building.width + (building.kind === 'farm' ? building.cropRight : 0);
      return x < right + 4 && x + width + 4 > left;
    })) continue;
    if (cores.some((core) => x < core.x + core.width / 2 && x + width > core.x - core.width / 2)) continue;
    return center;
  }
  return null;
}

// 1. Build a housing seed next to the base.
{
  const before = buildingBlueprints.length;
  const hm = resources().hm;
  await clickElement('#build-command');
  await clickElement('[data-build="housing"]');
  const center = findSeedCenter('housing');
  check(center !== null, 'found a free building site');
  if (center !== null) {
    await focusWorld(center, surfaceYAt(center) - 30, 8);
    await worldClick(center, surfaceYAt(center) - 6);
    await sleep(100);
    check(buildingBlueprints.length === before + 1, 'housing seed placed', status());
    check(resources().hm <= hm - 10 + 1, 'seed cost HM', `${Math.round(hm)} -> ${Math.round(resources().hm)}`);
    await shot('01-seed-placed');
  }
}

// 2. Draw a road on gentle ground in the home territory.
{
  await clickElement('#route-command');
  await clickElement('[data-route="road"]');
  const core = cores.find((item) => item.owner === baseSide);
  let start = null;
  for (let x = core.x + 300; x < WORLD_WIDTH * 0.3; x += 8) {
    const flat = Math.abs(surfaceYAt(x + 160) - surfaceYAt(x)) < 25 && waterLevelAt(x) === null && waterLevelAt(x + 160) === null;
    if (flat) { start = x; break; }
  }
  check(start !== null, 'found gentle ground for a road');
  const before = commandControl.networkSnapshot().roads;
  if (start !== null) {
    await focusWorld(start + 80, surfaceYAt(start) - 20, 5);
    await worldClick(start, surfaceYAt(start) - 2);
    await worldClick(start + 160, surfaceYAt(start + 160) - 2);
    await sleep(100);
    check(commandControl.networkSnapshot().roads > before, 'road placed', status());
    await shot('02-road');
  }
}

// 3. Draw a road across a mountain: it should be cut into a tunnel automatically.
{
  const peak = terrainPeaks.map((item) => {
    const left = item.center - item.width * 0.95, right = item.center + item.width * 0.95;
    let top = Infinity;
    for (let x = left; x <= right; x += 4) top = Math.min(top, surfaceYAt(x));
    return { item, left, right, rise: Math.min(surfaceYAt(left), surfaceYAt(right)) - top };
  }).filter((item) => item.left > 0 && item.right < WORLD_WIDTH && item.rise > 60
    && waterLevelAt(item.left) === null && waterLevelAt(item.right) === null)
    .sort((a, b) => b.rise - a.rise)[0];
  check(Boolean(peak), 'found a mountain to cross', peak ? `rise ${Math.round(peak.rise)}` : '');
  if (peak) {
    commandControl.resources(); // keep the HUD in sync
    const tunnelsBefore = commandControl.networkSnapshot().tunnels.length;
    await focusWorld((peak.left + peak.right) / 2, surfaceYAt(peak.item.center) + 20, 2.5);
    await worldClick(peak.left, surfaceYAt(peak.left) - 2);
    await worldClick(peak.right, surfaceYAt(peak.right) - 2);
    await sleep(100);
    const tunnels = commandControl.networkSnapshot().tunnels;
    check(tunnels.length > tunnelsBefore, 'road through the mountain dug a tunnel', status());
    await shot('03-mountain-road');
  }
}

// 4. Extend the starter tunnel underground.
{
  await clickElement('[data-route="tunnel"]');
  const tunnel = commandControl.networkSnapshot().tunnels.find((item) => item.side === (baseSide === 'left' ? 0 : 1));
  const [a, b] = [tunnel.points[1], tunnel.points[2]];
  const from = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const direction = baseSide === 'left' ? 1 : -1;
  const before = commandControl.networkSnapshot().tunnels.length;
  await focusWorld(from.x, from.y, 8);
  await worldClick(from.x, from.y);
  await worldClick(from.x + direction * 70, from.y);
  await sleep(100);
  check(commandControl.networkSnapshot().tunnels.length > before, 'tunnel segment dug', status());
  await shot('04-tunnel');
}

// 5. Deploy from every base and order the troops forward.
{
  await clickElement('#deploy-command');
  await clickElement('#deploy-all');
  const sm = resources().sm;
  await clickElement('#deploy-fire');
  const units = commandControl.unitSnapshot().filter((unit) => unit.side === baseSide);
  check(units.length > 0, 'units deployed', units.map((unit) => unit.type).join(','));
  check(resources().sm < sm, 'deploying cost SM', `${Math.round(sm)} -> ${Math.round(resources().sm)}`);
  const core = cores.find((item) => item.owner === baseSide);
  const destination = core.x + (baseSide === 'left' ? 700 : -700);
  await focusWorld(destination, surfaceYAt(destination) - 20, 3);
  await worldClick(destination, surfaceYAt(destination) - 4);
  await sleep(100);
  const ordered = commandControl.unitSnapshot().filter((unit) => unit.side === baseSide);
  check(ordered.every((unit) => Math.abs(unit.target - destination) < 2), 'units took the move order', status());
  const startX = ordered.map((unit) => unit.x);
  await sleep(2500);
  const moved = commandControl.unitSnapshot().filter((unit) => unit.side === baseSide);
  check(moved.some((unit, index) => Math.abs(unit.x - startX[index]) > 10), 'units moved toward the order');
  await focusWorld(moved[0].x, surfaceYAt(moved[0].x) - 20, 8);
  await shot('05-units');
}

// 6. Fire a missile salvo from a level 3+ base at an enemy building.
{
  await clickElement('#missile-command');
  const launcherBuilding = buildingBlueprints.find((building) => building.kind === 'military' && building.level >= 3
    && building.owner === baseSide && building.health > 0);
  check(Boolean(launcherBuilding), 'have a level 3+ launcher');
  const enemy = buildingBlueprints.filter((building) => building.owner !== baseSide && building.owner !== 'neutral'
    && building.health > 0 && building.kind !== 'farm')
    .sort((a, b) => Math.abs(a.x - launcherBuilding.x) - Math.abs(b.x - launcherBuilding.x))[0];
  if (launcherBuilding && enemy) {
    const ground = Math.min(surfaceYAt(launcherBuilding.x), surfaceYAt(launcherBuilding.x + launcherBuilding.width));
    const tube = { x: launcherBuilding.x + launcherBuilding.width * 0.48 + launcherBuilding.direction * 4,
      y: ground - launcherBuilding.height - 10 };
    await focusWorld(tube.x, tube.y, 6);
    await worldClick(tube.x, tube.y);
    check(missileControl.snapshot().selected > 0, 'launcher selected', document.getElementById('missile-status').textContent);
    await clickElement('#missile-target');
    const enemyGround = Math.min(surfaceYAt(enemy.x), surfaceYAt(enemy.x + enemy.width));
    const aim = { x: enemy.x + enemy.width / 2, y: enemyGround - enemy.height * 0.4 };
    await focusWorld(aim.x, aim.y, 6);
    await worldClick(aim.x, aim.y);
    check(missileControl.snapshot().targets > 0, 'target marked');
    const health = enemy.health;
    await clickElement('#missile-fire');
    await sleep(1500);
    const flight = missileControl.snapshot();
    check(flight.missiles + flight.pending > 0, 'missiles launched', JSON.stringify(flight));
    await shot('06-missiles-in-flight');
    await sleep(7000);
    check(enemy.health < health || !buildingBlueprints.includes(enemy), 'enemy building damaged by missiles',
      `${health} -> ${Math.round(enemy.health)}`);
    await focusWorld(aim.x, aim.y, 6);
    await shot('07-missile-impact');
  }
}

return { checks, resources: resources(), network: commandControl.networkSnapshot().tunnels.length,
  units: commandControl.unitSnapshot().length };
