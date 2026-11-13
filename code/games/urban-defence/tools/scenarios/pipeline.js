// Supply-line checks: lines are laid under each base, an explosion breaks them and stops the flow, crews
// re-lay the span around the crater for HM, raised ground re-lays the line, and pumps never drain basins.
// Run: tools/check-beta-game.cjs --seed=7 --scenario=tools/scenarios/pipeline.js --out=<folder>
const checks = [];
const check = (ok, label, detail = '') => checks.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail !== '' ? ` (${detail})` : ''}`);
await sleep(500);
const side = baseSide;
const lines = () => pipeline.snapshot()[side];
for (const resource of ['sm', 'hm', 'water']) {
  check(lines()[resource].cells > 10, `${resource} line laid under the ${side} base`, `${lines()[resource].cells} cells`);
}
const waterBefore = particleTerrain.waterCount;

// Break the HM line between the core and the nearest mine node, then watch it stop, settle and re-lay.
const core = cores.find((item) => item.owner === side);
const hm = lines().hm;
const target = Math.round(Math.min(Math.max(core.x + (side === 'left' ? 60 : -60), hm.left + 20), hm.right - 20));
const yBefore = pipeline.lineY(side, 'hm', target);
await focusWorld(target, yBefore - 20, 10);
await shot('pipe-01-intact');
const hmBefore = commandControl.resources().hm;
craterSurface(target, 30, 26);
const span = lines().hm.spans[0];
check(Boolean(span), 'a deep crater breaks the HM line', span ? `${span.left}-${span.right}` : 'no span');
check(!pipeline.connected(side, 'hm', target - 40, target + 40), 'flow across the break is cut');
await sleep(800);
await shot('pipe-02-broken');
await sleep(6500);
const repairing = lines().hm.spans[0];
check(repairing && ['repairing', 'waiting for HM'].includes(repairing.state) || !repairing, 'crew starts re-laying after the blast settles',
  repairing ? repairing.state : 'already done');
await shot('pipe-03-repairing');
for (let i = 0; i < 40 && lines().hm.spans.some((item) => !item.done); i += 1) await sleep(250);
check(!lines().hm.spans.some((item) => !item.done), 'span re-laid', JSON.stringify(lines().hm.spans));
check(pipeline.connected(side, 'hm', target - 40, target + 40), 'flow restored across the old break');
const yAfter = pipeline.lineY(side, 'hm', target);
check(yAfter > yBefore, 're-laid line runs deeper, around the crater', `${yBefore} -> ${yAfter}`);
check(commandControl.resources().hm < hmBefore + 40, 'repair was paid with HM', `${Math.round(hmBefore)} -> ${Math.round(commandControl.resources().hm)}`);
await shot('pipe-04-relaid');

// Raise the ground over the SM line: the line follows the new contour without breaking.
const sm = lines().sm;
const raiseX = Math.round((sm.left + sm.right) / 2 / 4) * 4;
const smBefore = pipeline.lineY(side, 'sm', raiseX);
const column = Math.floor(raiseX / PARTICLE_TERRAIN_CELL_SIZE);
for (let dx = -6; dx <= 6; dx += 1) {
  const top = particleTerrain.surfaceRow(column + dx);
  for (let dy = 1; dy <= 4; dy += 1) if (particleTerrain.at(column + dx, top - dy) === PARTICLE_EMPTY) particleTerrain.set(column + dx, top - dy, PARTICLE_TERRAIN);
}
await sleep(400);
const smAfter = pipeline.lineY(side, 'sm', raiseX);
check(smAfter < smBefore, 'line re-lays itself when the ground rises', `${smBefore} -> ${smAfter}`);
check(!lines().sm.spans.some((item) => !item.done && item.left <= raiseX + 30 && item.right >= raiseX - 30),
  'raised ground is not treated as damage');

check(particleTerrain.waterCount === waterBefore, 'pumps never drain the basins', `${waterBefore} -> ${particleTerrain.waterCount}`);
const farm = buildingBlueprints.find((building) => building.kind === 'farm' && building.owner === side && building.waterSources.length);
if (farm) {
  const source = farm.waterSources[0];
  await focusWorld((farm.x + source.pool.left) / 2, source.pool.level, 4);
  await shot('pipe-05-pump');
}
return { checks, snapshot: lines() };
