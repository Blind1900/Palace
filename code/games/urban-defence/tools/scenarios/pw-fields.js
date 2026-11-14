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
check(farms.length >= 5 && farms.every((b) => b.lotField && b.lotField.columns > 20), `every farm stands on its own field (${farms.map((b) => b.lotField ? b.lotField.columns : 0).join(', ')} columns)`);
// Fields and roads never share ground; no street runs under a farm.
let overlap = 0, streetUnderFarm = 0;
for (const b of farms) {
  for (const f of fieldsOf(b)) for (let x = f.x0; x <= f.x1; x += 1) for (let r = 0; r < 4; r += 1) {
    const fl = PW.getFlags(world, x, f.y + r);
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
// A road drawn over a field: the cursor warns, then the field there is gone, and its yield falls.
const farm = farms.find((b) => b.field && b.field.columns > 60);
const f = farm.field;
const at = { x: Math.round((f.x0 + f.x1) / 2), y: f.y - 5 };
pwApp.setBrush(10);
const plan = pwApp.planRoad(at);
const noteEl = document.getElementById('cursor-note');
check(plan.fieldCells > 0 && /SM production/.test(plan.note) && /SM production/.test(noteEl ? noteEl.textContent : ''),
  `planning a road over a field warns that it replaces SM production ("${plan.note}")`);
await view('fd-plan', at.x, at.y - 10, 6);
const before = f.alive;
const laid = pwApp.layRoad(at);
let cropLeft = 0;
for (let x = at.x - 10; x <= at.x + 10; x += 1) for (let i = 1; i <= 36; i += 1) if (PW.getFlags(world, x, f.y - i) & FLAG.FLORA) cropLeft += 1;
check(laid > 0 && f.alive < before && cropLeft === 0, `the road replaces the field under it (${laid} columns paved, field ${before} -> ${f.alive} columns, ${cropLeft} crop cells left)`);
let roadField = 0;
for (let x = at.x - 10; x <= at.x + 10; x += 1) if ((PW.getFlags(world, x, f.y) & FLAG.ROAD) && (PW.getFlags(world, x, f.y) & FLAG.FIELD)) roadField += 1;
check(roadField === 0, `the new road and the field still never share a cell (${roadField})`);
// Off the field the cursor just offers the road.
const town = world.settlements.find((s) => s.side === 'left');
let streetX = Math.round((town.streetLeft + town.streetRight) / 2);
const clearOfField = (x) => { for (let k = -12; k <= 12; k += 1) if (PW.getFlags(world, x + k, world.groundTop[x + k]) & FLAG.FIELD) return false; return true; };
while (streetX < town.streetRight && !((PW.getFlags(world, streetX, town.padY) & FLAG.ROAD) && clearOfField(streetX))) streetX += 7;
const plain = pwApp.planRoad({ x: streetX, y: town.padY - 4 });
check(plain.fieldCells === 0 && !/SM production/.test(plain.note), `away from fields the road needs no warning ("${plain.note}")`);
await view('fd-road', at.x, at.y - 10, 6);
for (const b of farms.slice(0, 3)) await view(`fd-farm-${b.style}-${b.variant}`, (b.works[0] + b.works[1]) / 2, b.ground - 40, 4);
return { checks, shots: shots.length };
