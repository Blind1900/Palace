// N104 - a mountain base's road, on the capital lab (det). A military seed dropped on the shelf of the lab
// mountain's shoulder takes root as a mountain base; come to half its levels (4 of 7) it bores a road
// through its mountain - its own side's, barricaded - portals on the flats at each foot.
// --page=capital-lab.html --ready="window.pwLab && pwLab.ready" --params=det=1&seed=N
const { world } = pwLab;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, z) => { pwLab.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const G = pwLab.growth;
// (the shelf of the mountain's shoulder: its flattest stretch)
let shelf = 9580, best = Infinity;
for (let x = 9300; x <= 10300; x += 10) {
  let lo = Infinity, hi = -Infinity;
  for (let d = -40; d <= 40; d += 8) { lo = Math.min(lo, world.groundTop[x + d]); hi = Math.max(hi, world.groundTop[x + d]); }
  if (hi - lo < best) { best = hi - lo; shelf = x; }
}
const dropped = G.drop(shelf, 'military', 'asian', 'east');
const mil = dropped.ok ? dropped.city : null;
check(!!mil && mil.kind === 'military' && mil.setting === 'mountain', `a military seed on the mountain's shoulder takes root as a mountain base (at ${shelf}: ${mil ? `${mil.kind} ${mil.setting}` : dropped.note})`);
if (!mil) return { checks, shots };
pwLab.setSpeed(20);
// (it digs in deeper as it grows - a base's levels run to 6: half of them is 3)
let bored = null, early = false;
for (let s = 0; s < 120 && mil.level < 3; s += 1) {
  pwLab.stepWorld(30);
  if ((world.roadTunnels || []).length && mil.level < 3) early = true;
}
check(!early, 'below half its levels it bores nothing');
const t = (world.roadTunnels || []).find((q) => q.side === mil.faction);
bored = t;
check(mil.level >= 3 && !!bored, `at half its levels (${mil.level} of 6) it bores a road through its mountain (${t ? `${t.a}..${t.b}` : 'none'}; ${mil.notes.slice(-2).join(' / ')})`);
if (!t) return { checks, shots };
for (let s = 0; s < 120 && !t.done; s += 1) pwLab.stepWorld(60);
check(t.done && (world.barricades || []).some((b) => b.tunnel === t.id && b.side === 'east'), `through, and barricaded by its side (${t.done ? 'through' : 'boring'}; ${(world.barricades || []).filter((b) => b.tunnel === t.id).length} barricades)`);
const flat = (x, dir) => { let lo = Infinity, hi = -Infinity; for (let j = 0; j <= 40; j += 2) { const g = world.groundTop[x + dir * j]; lo = Math.min(lo, g); hi = Math.max(hi, g); } return hi - lo; };
check(flat(t.a, -1) <= 4 && flat(t.b, 1) <= 4, `its portals open onto the flats at each foot (${t.a}: ${flat(t.a, -1)}, ${t.b}: ${flat(t.b, 1)})`);
await view('n104-base-and-its-road', Math.round((t.a + t.b) / 2), t.floorAt(Math.round((t.a + t.b) / 2)) - 200, 2);
return { checks, shots };
