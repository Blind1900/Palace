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
// (every cell of another building that flying or falling debris breaks, as it happens: the
// builders patch a struck neighbour within seconds, so its health afterwards says little)
const struck = new Map();
const noteHit = (owner) => { if (owner > 0 && owner < 50000 && owner !== A.id && owner !== B.id) struck.set(owner, (struck.get(owner) || 0) + 1); };
const chipWas = pwApp.particles.listeners.chip, damageWas = world.onDamage;
pwApp.particles.listeners.chip = (owner, x, y) => { noteHit(owner); if (chipWas) chipWas(owner, x, y); };
world.onDamage = (owner, ...rest) => { noteHit(owner); if (damageWas) damageWas(owner, ...rest); };

// A: the whole ground floor; B: the left half of its ground floor (whatever its width).
for (let x = A.body.left + 6; x <= A.body.right - 6; x += 14) pwApp.explode(x, A.ground - 16, 14, 1.3);
for (let x = B.body.left + 8; x <= (B.body.left + B.body.right) / 2; x += 12) pwApp.explode(x, B.ground - 16, 15, 1.3);
const times = [];
let maxPieces = 0;
// (every 10 ticks: of each falling piece of a building, the share of its frame lying inside the
// natural ground - it must never sink into it, nor fall through it)
let worstSunk = 0, sunkNote = '';
const sunkIn = () => {
  for (const p of fragments.list) {
    if (p.flora || p.mode === 'flex') continue;
    const c = Math.cos(p.angle), s = Math.sin(p.angle), ox = p.ox0 - 0.5, oy = p.oy0 - 0.5;
    let frame = 0, inside = 0;
    for (let k = 0; k < p.data.x.length; k += 1) {
      if (p.data.solid[k] !== 1) continue;
      const u = p.data.x[k] - ox, v = p.data.y[k] - oy, x = Math.floor(p.px + u * c - v * s), y = Math.floor(p.py + u * s + v * c);
      frame += 1;
      const k2 = id(x, y);
      if (PW.mat.terrain[k2] && k2 !== M.RUIN && PW.mat.phase[k2] === PW.PHASE.SOLID && PW.getOwner(world, x, y) !== p.owner) inside += 1;
    }
    if (frame >= 20 && inside / frame > worstSunk) { worstSunk = inside / frame; sunkNote = `${inside} of ${frame} frame cells`; }
  }
};
// (the most whole pieces of the fallen towers lying about as ruins at once - the builders clear the
// rubble on a lot as they rebuild, ruins too, so those that came to rest on it go in time)
let mostRuins = 0, mostRuinCells = 0;
const ruinsNow = () => {
  const rs = (world.ruins || []).filter((r) => r.from === A.id || r.from === B.id);
  if (rs.length > mostRuins) { mostRuins = rs.length; mostRuinCells = rs.reduce((n, r) => n + r.cells, 0); }
};
// (how far each falling piece of a building turns, all told, from when it comes away until it
// comes to rest - N49O: it tips, slides and settles; it never spins)
const turned = new Map();
const turning = () => {
  for (const p of fragments.list) {
    if (p.flora || p.mass < 36) continue;
    const r = turned.get(p);
    if (!r) turned.set(p, { last: p.angle, total: 0 });
    else { r.total += Math.abs(p.angle - r.last); r.last = p.angle; }
  }
};
const run = (seconds) => { for (let k = 0; k < seconds * 60; k += 1) { pwApp.stepWorld(1); turning(); times.push(structure.stats.ms + fragments.stats.ms); maxPieces = Math.max(maxPieces, fragments.list.length); if (k % 10 === 0) { sunkIn(); ruinsNow(); } } };
run(1.2);
await view('co-implode', (A.body.left + A.body.right) / 2, A.ground - heightOf(A) * 0.5, 3);
await view('co-tip', (B.body.left + B.body.right) / 2, B.ground - heightOf(B) * 0.5, 3);
run(8.8);
// (a falling building drives the air out ahead of it and from under it: its dust is carried well
// out from where it came down)
const dust10 = countIn(A.body.left - 900, A.body.right + 900, A.ground - 900, A.ground, [M.DUST])
  + countIn(B.body.left - 900, B.body.right + 900, B.ground - 900, B.ground, [M.DUST]);
run(20);

check(A.health < 0.25 && (A.failures || []).some((r) => r === 'pancake' || r === 'drop'), `a tower that loses its whole ground floor comes straight down (health ${A.health.toFixed(2)}, failures ${JSON.stringify(A.failures)})`);
check(B.health < 0.25 && (B.failures || []).some((r) => r === 'crushed' || r === 'overhang'), `a tower that loses one side tips over that way (health ${B.health.toFixed(2)}, failures ${JSON.stringify(B.failures)})`);
// (a tower dropping into its footprint breaks apart storey by storey as it sinks into its own
// rubble; one that tips over shatters into chunks where it lands)
check(maxPieces >= 2 && (fragments.stats.chunks > 0 || (fragments.stats.crushSteps || 0) > 3), `the falling building breaks into rigid pieces that break apart as they land (${maxPieces} pieces at once, ${fragments.stats.chunks} chunks, ${fragments.stats.crushSteps || 0} storeys crushed as it sank)`);
check(fragments.list.length === 0, `everything has come to rest after 30 s (${fragments.list.length} pieces still moving)`);
// (N40O: falling buildings never sink into the ground; they come apart as they fall - shedding
// their loosest cells, the parts that no longer hang together going their own ways)
check(worstSunk < 0.1, `no falling piece sinks into the ground (at worst ${(worstSunk * 100).toFixed(0)}% of a piece's frame in it${sunkNote ? `: ${sunkNote}` : ''})`);
// (nor falls through it and out of the world: a piece shaken down to its back-wall panels, with no
// frame left to strike with, comes apart where it is)
check(!(fragments.stats.fellOut > 0), `no falling piece drops through the world (${fragments.stats.fellOut || 0} fell out of it; ${fragments.stats.frameless || 0} shaken down to bare panels came apart in the air)`);
check((fragments.stats.shed || 0) > 0 && (fragments.stats.parted || 0) > 0, `falling buildings come apart as they fall (${fragments.stats.shed || 0} cells shaken loose in the air, ${fragments.stats.parted || 0} parts gone their own ways)`);
{
  const totals = [...turned.values()].map((r) => r.total), most = Math.max(0, ...totals), half = totals.filter((a) => a > Math.PI).length;
  check(most < 2 * Math.PI && half <= Math.max(1, totals.length * 0.03), `falling pieces tip, slide and settle, never spinning (${totals.length} pieces: the most any turned all told ${(most * 180 / Math.PI).toFixed(0)} deg, ${half} turned more than half a turn)`);
}
// Nothing floats: structure still standing is joined to the ground, and no back wall or fitting
// hangs without what held it.
const damaged = world.buildings.filter((b) => b.health !== undefined && b.health < 1);
let detached = 0, orphans = 0;
for (const b of damaged) { const r = structure.analyse(b); detached += r ? r.detached : 0; orphans += r ? r.orphans : 0; }
check(detached === 0 && orphans === 0, `nothing is left floating (${damaged.length} damaged buildings: ${detached} loose structure cells, ${orphans} loose back-wall or fitting cells)`);
// The rubble stays: the fallen building lies as debris and rubble on and around its lot.
const WRECK = [M.DEBRIS, M.RUBBLE, M.LOOSE_STONE, M.RUIN];
const pile = (b) => countIn(b.body.left - heightOf(b), b.body.right + heightOf(b), b.ground - heightOf(b), b.ground + 4, WRECK);
const pileA = pile(A), pileB = pile(B);
check(pileA > 4000 && pileB > 4000, `the fallen towers lie as rubble and ruins (${pileA} and ${pileB} cells)`);
// Some of each comes to rest whole: pieces of the building, misplaced, as ruins.
const ruins = (world.ruins || []).filter((r) => r.from === A.id || r.from === B.id);
check(mostRuins >= 2, `whole pieces of the fallen towers lie about as ruins (at most ${mostRuins} at once, ${mostRuinCells} cells; ${ruins.length} left after 30 s, the rest cleared by the builders)`);
// The tipped tower's rubble spreads out to the side it fell.
const spread = (b, dir) => {
  let far = 0;
  for (let k = 0; k < heightOf(b) * 1.5; k += 1) {
    const x = dir < 0 ? b.body.left - k : b.body.right + k;
    for (let y = b.ground - 120; y < b.ground; y += 1) if (WRECK.includes(id(x, y))) { far = k; break; }
  }
  return far;
};
const dirB = (B.failures || []).length ? -1 : -1;
check(spread(B, dirB) > heightOf(B) * 0.4, `the tipped tower's rubble reaches out the way it fell (${spread(B, dirB)} cells past its wall, height ${heightOf(B)})`);
// Debris hurts what it hits: neighbouring buildings, trees and fittings, the ground.
pwApp.particles.listeners.chip = chipWas; world.onDamage = damageWas;
const hurt = others.filter((b) => b.health !== undefined && b.health < 1).length;
const struckCells = [...struck.values()].reduce((n, v) => n + v, 0);
check(hurt > 0 || struck.size > 0, `falling debris damages neighbouring buildings (${struck.size} neighbours struck, ${struckCells} hits on them, ${hurt} still damaged; ${fragments.stats.chipped} cells chipped by falling pieces, ${pwApp.particles.stats.chipped} by debris)`);
// (struck by flying debris, a lamp or gate that loses its footing or much of itself topples)
const toppled = PW.streetProps ? PW.streetProps.stats.toppled : 0;
check((fragments.stats.swept || 0) + toppled > 0 && decoBefore(A) < decoA, `falling debris knocks down trees, lamps and fittings (${fragments.stats.swept || 0} swept, ${toppled} street props toppled, deco ${decoA} -> ${decoBefore(A)})`);
// The cores survive the collapse; a ruined building's cores rise out of the rubble into the open,
// where troops can reach them.
check(coresUnder(A) === coresA && coresUnder(B) === coresB, `the cores survive the collapse (${coresUnder(A)}/${coresA}, ${coresUnder(B)}/${coresB} core cells)`);
const ruined = [A, B].filter((b) => b.ruined);
// (rubble may still be raining onto one: its field clears it within a few seconds. A core whose
// vault came through clear does not linger in the open: it settles straight home into its
// rebuilt bed - that counts as safe too.)
const safe = (c) => pwApp.cores.exposed(c) || (c.settled && c.y === c.homeY);
const allOut = () => ruined.every((b) => b.cores.every(safe));
for (let s = 0; s < 5 && !allOut(); s += 1) pwApp.stepWorld(60);
const out = ruined.flatMap((b) => b.cores.filter(safe));
check(ruined.length > 0 && out.length === ruined.reduce((n, b) => n + b.cores.length, 0),
  `a ruined building's cores stand in the open on its rubble, or sit settled home in a rebuilt vault (${out.length}/${ruined.reduce((n, b) => n + b.cores.length, 0)} cores of ${ruined.length} ruined buildings; ${ruined.flatMap((b) => b.cores.map((c) => `${c.x},${c.y}${c.free ? 'F' : ''}${c.settled ? 'S' : ''}${c.stopped ? ':' + c.stopped : ''}`)).join(' ')})`);
if (ruined.length) await view('co-cores-risen', ruined[0].cores[0].x, ruined[0].cores[0].y, 5);
// Lasting smoke and dust. (Smoke: the cells of it in the grid, and the pixels of a plume rising off
// the ruins in the open.)
const smokeIn = (x0, x1, y0, y1) => {
  const P = pwApp.particles, F = PW.PARTICLE;
  let n = countIn(x0, x1, y0, y1, [M.SMOKE]);
  for (let i = 0; i < P.stats.count; i += 1) if ((P.flags[i] & F.SMOKE) && P.px[i] >= x0 && P.px[i] <= x1 && P.py[i] >= y0 && P.py[i] <= y1) n += 1;
  return n;
};
const smoke30 = smokeIn(A.body.left - 600, A.body.right + 600, A.ground - 900, A.ground);
check(dust10 > 1500, `the collapse throws up a dust cloud that hangs (${dust10} dust cells after 10 s)`);
// (a plume over the ruins a while after: the smoke drifts and thins rather than hanging in one spot)
check(smoke30 > 200 && (world.smoulders || []).length > 0, `the ruins keep smoking for a while (${smoke30} smoke cells and plume pixels after 30 s, ${(world.smoulders || []).length} smouldering spots)`);
// ...but not for ever, nor in one standing column: the smouldering dies down within a minute or
// two and the smoke drifts off and thins away.
pwApp.stepWorld(60 * 120);
const smoke150 = smokeIn(A.body.left - 600, A.body.right + 600, A.ground - 900, A.ground);
check((world.smoulders || []).length === 0 && smoke150 < Math.max(100, smoke30 * 0.2), `the smoke dies down and drifts away (${smoke150} smoke cells and plume pixels after 150 s, ${(world.smoulders || []).length} still smouldering)`);
times.sort((a, b) => a - b);
const p95 = times[Math.floor(times.length * 0.95)];
check(p95 < 3, `collapse simulation stays in budget (p95 ${p95.toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms)`);
await view('co-after-implode', (A.body.left + A.body.right) / 2, A.ground - 120, 3);
await view('co-after-tip', (B.body.left + B.body.right) / 2, B.ground - 120, 3);
// A small lump of building - too small to grind - come to lie pressed into the ground (as a chunk
// broken off a piece that was) is worked back out of it, never sinking on into it (N40O: lumps
// like this used to fall through the ground).
{
  // (on dry, flat, firm natural ground, out in the wilds)
  const firm = (x) => { const k = id(x, world.groundTop[x]); return PW.mat.terrain[k] && PW.mat.phase[k] === PW.PHASE.SOLID; };
  let lx = -1;
  for (const zone of pwApp.layout.wilds) for (let x = zone.x0 + 100; x < zone.x1 - 100 && lx < 0; x += 7) {
    let flat = true;
    for (let d = -12; d <= 20 && flat; d += 1) flat = firm(x + d) && Math.abs(world.groundTop[x + d] - world.groundTop[x]) <= 2;
    if (flat) lx = x;
  }
  const lg = world.groundTop[lx];
  const cells = [];
  for (let y = lg - 140; y < lg - 133; y += 1) for (let x = lx; x < lx + 9; x += 1) { PW.set(world, x, y, M.CONCRETE, { quiet: true }); cells.push(y * world.width + x); }
  const lump = fragments.spawn({ cells, vx: 0, vy: 30 });
  if (lump) lump.py += 136;   // (3 of its 7 rows in the ground)
  // (how far down its lowest cell goes, while it is a piece, against the ground's top there)
  let deepest = -Infinity;
  for (let k = 0; k < 60 * 3 && lump && fragments.list.includes(lump); k += 1) {
    pwApp.stepWorld(1);
    const c = Math.cos(lump.angle), s = Math.sin(lump.angle);
    for (let q = 0; q < lump.data.x.length; q += 1) {
      if (lump.data.solid[q] !== 1) continue;
      const u = lump.data.x[q] - lump.ox0 + 0.5, v = lump.data.y[q] - lump.oy0 + 0.5;
      deepest = Math.max(deepest, Math.floor(lump.py + u * s + v * c) - lg);
    }
  }
  check(!!lump && deepest <= 3, `a small lump lying pressed into the ground is worked back out of it, never sinking through (its lowest cell at most ${deepest} rows into the ground, from 3)`);
}
return { checks, stats: { fragments: fragments.stats, structure: structure.stats } , shots: shots.length };
