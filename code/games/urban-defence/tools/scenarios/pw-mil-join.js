// N97 (extending N66-N68) - a sloped population tower and its military wing, and the wing and the
// next building over, meet with no gap: their floors, roofs and walls run on until they meet.
// Capital lab, det: a capital grown on the flattest stretch, military seeds dropped on its sloped
// towers (each merges as a wing on the tower's outer flank), the city settled; then, row by row
// over the merged height, no run of open air - no cell, no back wall, nobody's - closed in on both
// sides by the buildings.
// --page=capital-lab.html --ready="window.pwLab && pwLab.ready" --params=det=1&seed=N
const { world } = pwLab;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const G = pwLab.growth;
let at = 1200, spread = 1e9;
for (let x = 500; x < world.width - 2100; x += 60) {
  let lo = 1e9, hi = -1e9;
  for (let d = 0; d < 1600; d += 20) { const g = world.groundTop[x + d]; lo = Math.min(lo, g); hi = Math.max(hi, g); }
  if (hi - lo < spread) { spread = hi - lo; at = x + 800; }
}
pwLab.setSpeed(20);
pwLab.drop(at, 'capital', 'modern');
pwLab.stepWorld(60 * 25);
const city = G.cities[0];
const SLOPED = ['setback', 'tapered', 'crown', 'spire', 'needle'];
const sloped = [...city.rings.left, ...city.rings.right].filter((l) => l.placed && l.type === 'population' && SLOPED.includes(l.variant));
check(sloped.length >= 2, `the capital has sloped towers (${sloped.map((l) => `${l.side[0]}${l.ring}:${l.variant}`).join(' ')})`);
for (const l of sloped.slice(0, 3)) pwLab.drop(Math.round((l.placed.x0 + l.placed.x1) / 2), 'military', 'modern');
pwLab.stepWorld(60 * 30);
pwLab.setSpeed(4);
pwLab.stepWorld(60 * 30);
for (const b of world.buildings) if (b && b.canvas) world.repair.notify(b.id);
pwLab.setSpeed(1);
pwLab.stepWorld(60 * 30);

const owned = (x, y) => PW.getOwner(world, x, y) > 0 && PW.getOwner(world, x, y) < 50000;
const open = (x, y) => (PW.get(world, x, y) & 63) === PW.M.AIR && !PW.getLayer(world, 'back', x, y) && !owned(x, y);
const mils = [...city.rings.left, ...city.rings.right].filter((l) => l.placed && l.mil);
check(mils.length >= 2, `the military merged into the towers as wings (${mils.map((l) => `${l.side[0]}${l.ring}:${l.variant}`).join(' ')})`);
let inner = 0, between = 0;
const where = [];
for (const l of mils) {
  const b = world.buildings[l.owner - 1];
  const lots = city.rings[l.side];
  const wing = (b.floors || []).filter((f) => f.wing).sort((p, q) => p.y - q.y);
  if (!wing.length) continue;
  // (the merged storeys: from under the wing's roof - its top storey's ceiling - to the grade;
  // the roof itself carries its parapets, rails and turrets in the open air)
  const yTop = wing[0].y - 32;
  // (the joined stretch: from the tower's middle to the middle of the building on the wing's side -
  // the wing faces away from the city's centre, the next ring out; a both-sided tower both ways)
  const mid = (lot) => { const r = world.buildings[lot.owner - 1]; return Math.round((r.body.left + r.body.right) / 2); };
  const sides = [lots[l.ring + 1]].concat(l.milBoth ? [lots[l.ring - 1]] : []).filter((n) => n && n.placed);
  const spans = sides.map((n) => [Math.min(mid(l), mid(n)), Math.max(mid(l), mid(n))]);
  for (const [x0, x1] of spans) for (let y = yTop; y < b.ground - 1; y += 1) {
    let x = x0;
    while (x <= x1) {
      if (!open(x, y)) { x += 1; continue; }
      let e = x; while (e <= x1 && open(e, y)) e += 1;
      if (x > x0 && e <= x1 && owned(x - 1, y) && owned(e, y) && e - x < 60) {
        const a = PW.getOwner(world, x - 1, y), c = PW.getOwner(world, e, y);
        // (only the wing's own joins: the tower to its wing, the wing to the building beside it)
        if (a === l.owner && c === l.owner) { inner += 1; if (where.length < 6) where.push(`in ${l.side[0]}${l.ring} ${x}-${e - 1}@${y}`); }
        else if (a === l.owner || c === l.owner) { between += 1; if (where.length < 6) where.push(`by ${l.side[0]}${l.ring} ${x}-${e - 1}@${y}`); }
      }
      x = e;
    }
  }
}
check(inner === 0, `the wing meets its sloped tower at every storey: no open air between (${inner} gaps${where.length ? `: ${where.join(', ')}` : ''})`);
check(between === 0, `the wing meets the building beside it: floors, roof and walls carried across (${between} gaps)`);
const shots = [];
for (const l of mils.slice(0, 2)) {
  pwLab.focus(l.side === 'left' ? l.placed.worksL : l.placed.worksR, world.buildings[l.owner - 1].ground - 90, 5);
  await sleep(300);
  shots.push(await shot(`n97-joined-${l.side}${l.ring}`));
}
return { checks, shots: shots.length };
