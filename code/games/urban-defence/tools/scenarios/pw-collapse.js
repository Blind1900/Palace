// M3 structural integrity and collapse (run with --page=pixel-world.html --params=seed=N).
// One tower loses its whole ground floor and implodes into its footprint; another loses one side of
// its ground floor and tips over. Debris must hurt what it hits, nothing may be left floating, the
// rubble stays and the site keeps smoking.
const { world, structure, fragments } = pwApp;
const { M, FLAG } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const id = (x, y) => PW.get(world, x, y) & 63;
const tallest = (side) => world.buildings.filter((b) => b.type === 'population' && b.side === side)
  .sort((a, b) => (a.ground - a.body.top) - (b.ground - b.body.top)).pop();
const A = tallest('left'), B = tallest('right');
const heightOf = (b) => b.ground - b.body.top;
const countIn = (x0, x1, y0, y1, ids) => { let n = 0; for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (ids.includes(id(x, y))) n += 1; return n; };
// (a building's core cells wherever they are: in their vaults, or risen out of the ruins)
const coresUnder = (b) => countIn(b.body.left - 12, b.body.right + 12, b.body.top - 40, b.ground + 40, [M.CORE]);
const coresA = coresUnder(A), coresB = coresUnder(B);
const others = world.buildings.filter((b) => b !== A && b !== B);
const decoBefore = (b) => { let n = 0; for (let y = b.ground - 120; y < b.ground; y += 1) for (let x = b.body.left - 300; x <= b.body.right + 300; x += 1) if (PW.getLayer(world, 'deco', x, y)) n += 1; return n; };
const decoA = decoBefore(A);

// A: the whole ground floor; B: the left half of its ground floor (whatever its width).
for (let x = A.body.left + 6; x <= A.body.right - 6; x += 14) pwApp.explode(x, A.ground - 16, 14, 1.3);
for (let x = B.body.left + 8; x <= (B.body.left + B.body.right) / 2; x += 12) pwApp.explode(x, B.ground - 16, 15, 1.3);
const times = [];
let maxPieces = 0;
const run = (seconds) => { for (let k = 0; k < seconds * 60; k += 1) { pwApp.stepWorld(1); times.push(structure.stats.ms + fragments.stats.ms); maxPieces = Math.max(maxPieces, fragments.list.length); } };
run(1.2);
await view('co-implode', (A.body.left + A.body.right) / 2, A.ground - heightOf(A) * 0.5, 3);
await view('co-tip', (B.body.left + B.body.right) / 2, B.ground - heightOf(B) * 0.5, 3);
run(8.8);
const dust10 = countIn(A.body.left - 400, A.body.right + 400, A.ground - 600, A.ground, [M.DUST])
  + countIn(B.body.left - 400, B.body.right + 400, B.ground - 600, B.ground, [M.DUST]);
run(20);

check(A.health < 0.25 && (A.failures || []).some((r) => r === 'pancake' || r === 'drop'), `a tower that loses its whole ground floor comes straight down (health ${A.health.toFixed(2)}, failures ${JSON.stringify(A.failures)})`);
check(B.health < 0.25 && (B.failures || []).some((r) => r === 'crushed' || r === 'overhang'), `a tower that loses one side tips over that way (health ${B.health.toFixed(2)}, failures ${JSON.stringify(B.failures)})`);
// (a tower dropping into its footprint breaks apart storey by storey as it sinks into its own
// rubble; one that tips over shatters into chunks where it lands)
check(maxPieces >= 2 && (fragments.stats.chunks > 0 || (fragments.stats.crushSteps || 0) > 3), `the falling building breaks into rigid pieces that break apart as they land (${maxPieces} pieces at once, ${fragments.stats.chunks} chunks, ${fragments.stats.crushSteps || 0} storeys crushed as it sank)`);
check(fragments.list.length === 0, `everything has come to rest after 30 s (${fragments.list.length} pieces still moving)`);
// Nothing floats: structure still standing is joined to the ground, and no back wall or fitting
// hangs without what held it.
const damaged = world.buildings.filter((b) => b.health !== undefined && b.health < 1);
let detached = 0, orphans = 0;
for (const b of damaged) { const r = structure.analyse(b); detached += r ? r.detached : 0; orphans += r ? r.orphans : 0; }
check(detached === 0 && orphans === 0, `nothing is left floating (${damaged.length} damaged buildings: ${detached} loose structure cells, ${orphans} loose back-wall or fitting cells)`);
// The rubble stays: the fallen building lies as debris and rubble on and around its lot.
const pile = (b) => countIn(b.body.left - heightOf(b), b.body.right + heightOf(b), b.ground - heightOf(b), b.ground + 4, [M.DEBRIS, M.RUBBLE, M.LOOSE_STONE]);
const pileA = pile(A), pileB = pile(B);
check(pileA > 4000 && pileB > 4000, `the fallen towers lie as rubble (${pileA} and ${pileB} cells)`);
// The tipped tower's rubble spreads out to the side it fell.
const spread = (b, dir) => {
  let far = 0;
  for (let k = 0; k < heightOf(b) * 1.5; k += 1) {
    const x = dir < 0 ? b.body.left - k : b.body.right + k;
    for (let y = b.ground - 120; y < b.ground; y += 1) if ([M.DEBRIS, M.RUBBLE, M.LOOSE_STONE].includes(id(x, y))) { far = k; break; }
  }
  return far;
};
const dirB = (B.failures || []).length ? -1 : -1;
check(spread(B, dirB) > heightOf(B) * 0.4, `the tipped tower's rubble reaches out the way it fell (${spread(B, dirB)} cells past its wall, height ${heightOf(B)})`);
// Debris hurts what it hits: neighbouring buildings, trees and fittings, the ground.
const hurt = others.filter((b) => b.health !== undefined && b.health < 1).length;
check(hurt > 0 || fragments.stats.chipped > 0, `falling debris damages neighbouring buildings (${hurt} neighbours damaged, ${fragments.stats.chipped} cells chipped)`);
check((fragments.stats.swept || 0) > 0 && decoBefore(A) < decoA, `falling debris knocks down trees, lamps and fittings (${fragments.stats.swept || 0} swept, deco ${decoA} -> ${decoBefore(A)})`);
// The cores survive the collapse; a ruined building's cores rise out of the rubble into the open,
// where troops can reach them.
check(coresUnder(A) === coresA && coresUnder(B) === coresB, `the cores survive the collapse (${coresUnder(A)}/${coresA}, ${coresUnder(B)}/${coresB} core cells)`);
const ruined = [A, B].filter((b) => b.ruined);
const out = ruined.flatMap((b) => b.cores.filter((c) => pwApp.cores.exposed(c)));
check(ruined.length > 0 && out.length === ruined.reduce((n, b) => n + b.cores.length, 0),
  `a ruined building's cores stand in the open on its rubble (${out.length}/${ruined.reduce((n, b) => n + b.cores.length, 0)} cores of ${ruined.length} ruined buildings; ${ruined.flatMap((b) => b.cores.map((c) => `${c.x},${c.y}${c.free ? 'F' : ''}${c.stopped ? ':' + c.stopped : ''}`)).join(' ')})`);
if (ruined.length) await view('co-cores-risen', ruined[0].cores[0].x, ruined[0].cores[0].y, 5);
// Lasting smoke and dust.
const smoke30 = countIn(A.body.left - 600, A.body.right + 600, A.ground - 900, A.ground, [M.SMOKE]);
check(dust10 > 1500, `the collapse throws up a dust cloud that hangs (${dust10} dust cells after 10 s)`);
check(smoke30 > 120 && (world.smoulders || []).length > 0, `the ruins keep smoking for a while (${smoke30} smoke cells after 30 s, ${(world.smoulders || []).length} smouldering spots)`);
// ...but not for ever, nor in one standing column: the smouldering dies down within about a
// minute and the smoke drifts off and thins away.
pwApp.stepWorld(60 * 60);
const smoke90 = countIn(A.body.left - 600, A.body.right + 600, A.ground - 900, A.ground, [M.SMOKE]);
check((world.smoulders || []).length === 0 && smoke90 < Math.max(100, smoke30 * 0.5), `the smoke dies down and drifts away (${smoke90} smoke cells after 90 s, ${(world.smoulders || []).length} still smouldering)`);
times.sort((a, b) => a - b);
const p95 = times[Math.floor(times.length * 0.95)];
check(p95 < 3, `collapse simulation stays in budget (p95 ${p95.toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms)`);
await view('co-after-implode', (A.body.left + A.body.right) / 2, A.ground - 120, 3);
await view('co-after-tip', (B.body.left + B.body.right) / 2, B.ground - 120, 3);
return { checks, stats: { fragments: fragments.stats, structure: structure.stats } , shots: shots.length };
