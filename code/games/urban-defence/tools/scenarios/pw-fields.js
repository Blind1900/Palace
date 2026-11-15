// Farm fields as a surface (run with --page=pixel-world.html --params=seed=N): a farm's ground is
// wheat field, never road; fields and roads never share ground; buildings on a field keep it; only a
// road drawn by hand replaces it, and the cursor warns that it costs SM production.
const { world } = pwApp;
const { M, FLAG } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const farms = world.buildings.filter((b) => b.type === 'farm');
const fieldsOf = (b) => [b.field, b.lotField].filter(Boolean);
const fy = PW.settlementTools.fieldY;   // (a field follows the land: its row at each column)
check(farms.length >= 5 && farms.every((b) => b.lotField && b.lotField.columns > 20), `every farm stands on its own field (${farms.map((b) => b.lotField ? b.lotField.columns : 0).join(', ')} columns)`);
// Fields and roads never share ground; no street runs under a farm.
let overlap = 0, streetUnderFarm = 0;
for (const b of farms) {
  for (const f of fieldsOf(b)) for (let x = f.x0; x <= f.x1; x += 1) for (let r = 0; r < 4; r += 1) {
    const fl = PW.getFlags(world, x, fy(f, x) + r);
    if ((fl & FLAG.FIELD) && (fl & FLAG.ROAD)) overlap += 1;
  }
  for (let x = b.works[0]; x <= b.works[1]; x += 1) if (PW.getFlags(world, x, b.ground) & FLAG.ROAD) streetUnderFarm += 1;
}
check(overlap === 0, `fields and roads never share ground (${overlap} cells)`);
check(streetUnderFarm === 0, `no street is paved under a farm (${streetUnderFarm} columns)`);
// The farm building stands on its field and keeps it under its floor; no crop grows indoors.
let under = 0, indoors = 0;
for (const b of farms) {
  for (let x = b.body.left + 6; x <= b.body.right - 6; x += 1) if (PW.getFlags(world, x, b.ground) & FLAG.FIELD) under += 1;
  for (let y = b.body.top; y < b.ground; y += 1) for (let x = b.body.left; x <= b.body.right; x += 1) {
    if ((PW.getFlags(world, x, y) & FLAG.FLORA) && PW.getLayer(world, 'back', x, y)) indoors += 1;
  }
}
check(under > 100, `buildings standing on a field keep it under their floors (${under} columns)`);
check(indoors === 0, `no crop grows inside a building (${indoors} cells)`);
// The crop looks like the references: tall stalks once grown, golden tassels.
for (const b of farms) for (const f of fieldsOf(b)) { f.growth = 0.9; PW.settlementTools.drawCrop(world, f); }
const stalks = farms.flatMap((b) => fieldsOf(b).flatMap((f) => f.stalks));
const tall = stalks.filter((s) => s.h >= 22).length;
check(stalks.length > 100 && tall > stalks.length * 0.6, `grown maize stands taller than a trooper (${tall}/${stalks.length} stalks of 22 cells or more)`);
// (roads are laid by the towns as they grow, never by hand: there is no road tool)
check(!document.querySelector('[data-tool="road"]') && !pwApp.layRoad, 'there is no hand-laid road tool');
for (const b of farms.slice(0, 3)) await view(`fd-farm-${b.style}-${b.variant}`, (b.works[0] + b.works[1]) / 2, b.ground - 40, 4);
return { checks, shots: shots.length };
