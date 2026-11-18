// The resource bundle (run with --page=pixel-world.html --params=seed=N): under every town ONE
// thin bundle runs about a metre down, through the cores and connected only to them - no machines.
// It threads each building's core bed through its side connectors, reaches out to the military on
// the mountains, divides the made ground from the natural ground, and carries water, SM and ore as
// particles from their sources to the cores they are bound for. A blast cuts it; the crew re-lays.
const { world, pipes } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
const id = (x, y) => PW.get(world, x, y) & 63;
const MADE = [M.FILL, M.SLAB, M.COURSE];
const NATURAL = [M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.SAND];
const BORE = pipes.BORE, BED = pipes.BED;

// 1. One bundle per town, threading its buildings' cores; the runs' ends capped.
check(pipes.lines.length === world.settlements.length, `one bundle per town (${pipes.lines.length} bundles, ${world.settlements.length} towns)`);
check(pipes.stats.caps >= pipes.lines.length * 2, `every run's underground ends are capped (${pipes.stats.caps} caps, re-capped where the military reach grew them)`);
let unthreaded = [];
for (const s of world.settlements) {
  const line = pipes.lines.find((l) => l.settlement === s);
  if (!line) continue;
  for (const b of s.buildings) {
    if (!pipes.TAPS[b.type]) continue;
    const cores = (b.cores || []).filter((c) => !c.orb && !c.standing);
    if (!cores.length) continue;
    if (!cores.some((c) => line.cores.some((q) => q.x === c.x))) unthreaded.push(`${b.type}#${b.id}`);
  }
}
check(!unthreaded.length, `every building's cores are threaded on its town's bundle (${unthreaded.join(' ') || 'all threaded'})`);
// The base bundles reach farther: out to the military on the mountains.
for (const side of ['left', 'right']) {
  const posts = [...(world.outposts || []), ...(world.bunkers || [])].filter((p) => p.side === side);
  if (!posts.length) continue;
  const line = pipes.lineFor(side);
  const reached = posts.filter((p) => (p.building.cores || []).some((c) => !c.orb && line.cores.some((q) => q.x === c.x)));
  check(reached.length === posts.length, `${side}: the bundle reaches the military in the mountains (${reached.length}/${posts.length} holdings)`);
}
// Nothing of the bundle is broken as laid, through every core bed and sleeve.
check(pipes.stats.broken === 0 && pipes.lines.every((l) => ![...l.broken].some(Boolean)), `the bundles are whole as laid (${pipes.stats.broken} broken columns)`);
// The god machine grips the line: black tendril wisps along the casing.
let wisps = 0;
for (const line of pipes.lines.slice(0, 2)) {
  for (let x = line.x0 + 10; x < Math.min(line.x1, line.x0 + 2000); x += 1) {
    const y = line.ys[x - line.x0];
    if (id(x, y) !== M.PIPE) continue;
    const p = PW.unpack(PW.getLayer(world, 'paint', x, y));
    if (p[0] < 20 && p[1] < 20 && p[2] < 20) wisps += 1;
  }
}
check(wisps > 20, `black tendril wisps wrap the casing (${wisps} ink cells sampled)`);

// 2. The bundle is bedded inside the town's made ground, in its upper metre: made ground above
// the casing and carrying on below its bed (the town's ground keeps its full depth).
for (const s of world.settlements) {
  const line = pipes.lines.find((l) => l.settlement === s);
  if (!line) continue;
  let columns = 0, soilLeft = 0, bedded = 0;
  const ends = (s.madeGround && s.madeGround.ends) || [];
  for (let x = s.streetLeft + 9; x <= s.streetRight - 9; x += 9) {
    const g = world.groundTop[x];
    if (!(PW.getFlags(world, x, g) & PW.FLAG.ROAD)) continue;
    if (x < line.x0 || x > line.x1) continue;
    if (line.cores.some((c) => Math.abs(x - c.x) < 24)) continue;   // a core's own bed and sockets
    const top = line.ys[x - line.x0], bottom = top + BORE - 1 + BED;
    if (ends.some((e) => Math.abs(e - x) < PW.urban.faceAt(bottom - g) + 2)) continue;
    let crossing = false;
    for (let y = g; y <= bottom + 3 && !crossing; y += 1) if (PW.getFlags(world, x, y) & PW.FLAG.TUNNEL) crossing = true;
    if (crossing) continue;
    columns += 1;
    for (let y = g + 4; y < top - BED; y += 1) if (NATURAL.includes(id(x, y)) && !PW.getOwner(world, x, y)) soilLeft += 1;
    // Properly bedded: inside the made ground with made ground running on below - or sleeved
    // through the building's own foundation gallery between its cores (the god's concrete, F2).
    const gift = (yy) => [M.FOUNDATION, M.STEEL, M.REINFORCED].includes(id(x, yy)) && PW.getOwner(world, x, yy) > 0;
    if (gift(top - BED) || gift(bottom + 1)) bedded += 1;
    else if (MADE.includes(id(x, top - BED)) && [1, 2, 3].some((k) => MADE.includes(id(x, bottom + k)))) bedded += 1;
  }
  check(columns >= 3 && soilLeft <= 8, `${s.side}@${s.site.x0} (${s.style}): made ground fills the street's ground over the bundle (${columns} columns, ${soilLeft} natural cells left)`);
  check(columns > 0 && bedded >= columns * 0.9, `${s.side}@${s.site.x0}: the bundle is bedded inside the made ground, which runs on below it (${bedded}/${columns} columns)`);
}
// The bundle runs in smooth curves (judged clear of the core approaches, which step on purpose).
let notches = 0, runs = 0;
for (const line of pipes.lines) {
  const ys = line.ys;
  for (let k = 0; k + 16 < ys.length; k += 4) {
    const x = line.x0 + k;
    if (line.cores.some((c) => Math.abs(x - c.x) < 80)) continue;
    runs += 1;
    let lo = Infinity, hi = -Infinity;
    for (let j = k; j <= k + 16; j += 1) { lo = Math.min(lo, ys[j]); hi = Math.max(hi, ys[j]); }
    const ends2 = Math.max(ys[k], ys[k + 16]), ends1 = Math.min(ys[k], ys[k + 16]);
    if (hi - ends2 >= 2 || ends1 - lo >= 2) notches += 1;
  }
}
check(notches <= runs * 0.01, `the bundle runs in smooth curves (${notches} notches in ${runs} 16-column runs)`);

// 3. Cargo flows from the sources through the cores (ore is slow: give it time).
const stocked = () => ['left', 'right'].every((side) => { const st = (world.stock || {})[side] || {}; return st.water > 0 && st.sm > 0 && st.hm > 0; });
for (let t = 0; t < 12 && !stocked(); t += 1) pwApp.stepWorld(60 * 5);
for (const side of ['left', 'right']) {
  const stock = (world.stock || {})[side] || {};
  check(stock.water > 0 && stock.sm > 0 && stock.hm > 0, `${side}: water, SM and ore arrive through the bundle (${JSON.stringify(stock)})`);
}
const sample = pipes.lines.flatMap((l) => l.packets.slice(0, 10).map((p) => ({ p, x: p.x, y: p.y })));
pwApp.stepWorld(30);
const moved = sample.filter((s) => s.p.x !== s.x || s.p.y !== s.y || s.p.done).length;
check(sample.length > 30 && moved > sample.length * 0.7, `particles move along the lanes (${moved}/${sample.length} moved in half a second, ${pipes.stats.packets} in the lines)`);
const left = world.settlements.find((s) => s.side === 'left');
const water = pipes.lineFor('left');
const core = water.cores[2] || water.cores[0];
await view('pp-core-through', core.x, core.y, 7);
const busy = water.packets.filter((p) => p.stage === 1).sort((a, b) => a.x - b.x)[water.packets.length >> 2];
if (busy) await view('pp-cargo', busy.x, busy.y - 4, 8);
await view('pp-left-section', (left.streetLeft + left.streetRight) / 2, world.groundTop[(left.streetLeft + left.streetRight) >> 1] + 20, 5);

// 4. A blast cuts the bundle between the pump and the town: the water in the cut spills, the
// stream queues at the break, and the crew re-lays the span around the crater for HM.
const pump = water.risers.find((r) => r.kind === 'pump');
const towns = water.cores.map((c) => c.x);
const town = pump.x < Math.min(...towns) ? Math.min(...towns) : Math.max(...towns);
const cutX = Math.round(pump.x + (town - pump.x) * 0.5);
const cutY = water.ys[cutX - water.x0] + 3;
const waterBefore = pwApp.countWater();
pwApp.explode(cutX, cutY, 12, 1);
pwApp.stepWorld(60);
const broken = [...water.broken].filter(Boolean).length;
check(broken > 0 && pipes.stats.spilled > 0, `a blast cuts the bundle and the water in it spills (${broken} columns, ${pipes.stats.spilled} spilled)`);
pwApp.stepWorld(60 * 3);
const dir = Math.sign(town - pump.x);
const queued = water.packets.filter((p) => p.stage === 1 && p.resource === 'water' && (cutX - p.x) * dir > 0 && (cutX - p.x) * dir < 60).length;
check(queued > 8, `the stream queues at the break (${queued} water particles within 60 cells upstream)`);
await view('pp-break', cutX - dir * 20, cutY - 6, 7);
for (let s = 0; s < 40 && [...water.broken].some(Boolean); s += 1) pwApp.stepWorld(60);
check(![...water.broken].some(Boolean), `the broken ends regrow toward each other and reconnect (${pipes.stats.repaired} cells, ${Math.round(pipes.stats.repairHM)} HM)`);
// The regrown run is smooth except where it genuinely changes level - and every level change
// carries a well joining the two bores; the old pipe is taken up as the ends close (well
// shafts are the line's own and stay).
let steep = 0, stray = 0;
const inWell = (x, y) => (water.wells || []).some((w) => Math.abs(x - w.x) <= 3 && (y === undefined || (y >= w.y0 && y <= w.y1)));
for (let x = cutX - 90; x < cutX + 90; x += 1) {
  const k = x - water.x0;
  if (k < 1 || k >= water.ys.length) continue;
  if (water.cores.some((c) => Math.abs(x - c.x) < 40)) continue;
  if (water.risers.some((r) => Math.abs(x - r.x) <= 4)) continue;   // (a riser is the line's own vertical bore)
  if (Math.abs(water.ys[k] - water.ys[k - 1]) > 6 && !inWell(x)) steep += 1;   // (up to 6 is a mitred bend, by design)
  for (let y = water.ys[k] - 60; y < water.ys[k] + 70; y += 1) {
    if (y >= water.ys[k] - 1 && y <= water.ys[k] + BORE) continue;
    if (inWell(x, y)) continue;
    if ((PW.get(world, x, y) & 63) === M.PIPE && PW.getOwner(world, x, y) === water.owner) stray += 1;
  }
}
check(steep === 0 && stray === 0, `the regrown bundle is smooth, steps welled, the old pipe taken up (${steep} unwelled steps, ${stray} stray cells)`);
check(pwApp.countWater() >= waterBefore - 1, `the spilled water is real water, none lost (${waterBefore} -> ${pwApp.countWater()} cells)`);
await view('pp-repaired', cutX, cutY - 6, 6);

// 5. A seed dropped in the wild plants a core, and the bundle grows out to thread it.
const coresBefore = water.cores.length, endBefore = water.x1;
const planted = PW.seeds && PW.seeds.drop(world, water.x1 + 260, 'left');
pwApp.stepWorld(60 * 2);
for (let s = 0; s < 40 && [...water.broken].some(Boolean); s += 1) pwApp.stepWorld(60);
check(!!planted && water.cores.length === coresBefore + 1 && water.x1 > endBefore && ![...water.broken].some(Boolean),
  `a planted seed core joins the bundle (${coresBefore} -> ${water.cores.length} cores, end ${endBefore} -> ${water.x1}, line whole)`);
if (planted) await view('pp-seed', planted.x, planted.y - 4, 6);
return { checks, stats: pipes.stats, stock: world.stock, shots: shots.length };
