// Made ground and supply lines (run with --page=pixel-world.html --params=seed=N): under every town
// the urban ground reaches down to its supply lines, which divide it from the natural ground; water,
// SM and ore travel through the lines as particles from their sources to the buildings.
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

// 1. Made ground from under the paving down to the lines' bed; natural ground below it.
for (const s of world.settlements) {
  const lines = pipes.lines.filter((l) => l.settlement === s);
  let columns = 0, soilLeft = 0, divider = 0, dividerOk = 0;
  const paints = new Set();
  // (clear of the town's ends, where the made ground tapers out at 45°)
  for (let x = s.streetLeft + 110; x <= s.streetRight - 110; x += 9) {
    const g = world.groundTop[x];
    if (!(PW.getFlags(world, x, g) & PW.FLAG.ROAD)) continue;          // street columns only
    // (judged against whichever lines run under this column)
    const here = lines.filter((l) => x >= l.x0 && x <= l.x1);
    if (!here.length) continue;
    const top = Math.min(...here.map((l) => l.ys[x - l.x0])), bottom = Math.max(...here.map((l) => l.ys[x - l.x0])) + BORE - 1 + BED;
    // (where the lines cross a shaft they are fixed to its back wall: no ground there to judge)
    let crossing = false;
    for (let y = g; y <= bottom + 3 && !crossing; y += 1) if (PW.getFlags(world, x, y) & PW.FLAG.TUNNEL) crossing = true;
    if (crossing) continue;
    columns += 1;
    for (let y = g + 4; y < top - BED; y += 1) {
      if (NATURAL.includes(id(x, y)) && !PW.getOwner(world, x, y)) soilLeft += 1;
      if (MADE.includes(id(x, y))) paints.add(PW.getLayer(world, 'paint', x, y));
    }
    divider += 1;
    // (the made ground stops at the bed: whatever lies below is the land as it was)
    if (MADE.includes(id(x, bottom)) && [1, 2, 3].every((k) => !MADE.includes(id(x, bottom + k)))) dividerOk += 1;
  }
  check(columns >= 3 && soilLeft === 0, `${s.side}@${s.site.x0} (${s.style}): made ground fills the street's ground down to the lines (${columns} columns, ${soilLeft} natural cells left)`);
  check(divider > 0 && dividerOk === divider, `${s.side}@${s.site.x0}: the lines' bed is the divider, natural ground right below it (${dividerOk}/${divider} columns)`);
  s.madePaints = paints.size;
}
const byStyle = {};
for (const s of world.settlements) {
  for (let x = s.streetLeft + 70; x <= s.streetRight - 70; x += 5) {
    const g = world.groundTop[x];
    if (!(PW.getFlags(world, x, g) & PW.FLAG.ROAD)) continue;
    const set = byStyle[s.style] || (byStyle[s.style] = { slab: 0, course: 0, fill: 0, cable: 0 });
    for (let d = 4; d < 60; d += 1) {
      const m = id(x, g + d);
      if (m === M.SLAB) set.slab += 1; else if (m === M.COURSE) set.course += 1; else if (m === M.FILL) set.fill += 1;
      if (m === M.SLAB && PW.getLayer(world, 'paint', x, g + d) === PW.abgr(26, 26, 28)) set.cable += 1;
    }
  }
}
const ok = (style, test) => !byStyle[style] || test(byStyle[style]);
check(ok('modern', (s) => s.slab > 0 && s.cable > 0) && ok('asian', (s) => s.course > 0 && s.fill > 0 && s.slab === 0)
  && ok('gothic', (s) => s.slab > 0 && s.course > 0), `each faction builds its own made ground (${JSON.stringify(byStyle)})`);

// 2. Cargo flows from the sources to the buildings.
pwApp.stepWorld(60 * 30);
for (const side of ['left', 'right']) {
  const stock = (world.stock || {})[side] || {};
  check(stock.water > 0 && stock.sm > 0 && stock.hm > 0, `${side}: water, SM and ore arrive through the lines (${JSON.stringify(stock)})`);
}
const sample = pipes.lines.flatMap((l) => l.packets.slice(0, 10).map((p) => ({ p, x: p.x, y: p.y })));
pwApp.stepWorld(30);
const moved = sample.filter((s) => s.p.x !== s.x || s.p.y !== s.y || s.p.done).length;
check(sample.length > 50 && moved > sample.length * 0.8, `particles move along the lines (${moved}/${sample.length} moved in half a second, ${pipes.stats.packets} in the lines)`);
const left = world.settlements.find((s) => s.side === 'left');
const water = pipes.lineFor('left', 'water'), sm = pipes.lineFor('left', 'sm'), hm = pipes.lineFor('left', 'hm');
const busy = (line) => line.packets.filter((p) => p.stage === 1).sort((a, b) => a.x - b.x)[line.packets.length >> 2];
for (const line of [water, sm, hm]) {
  const p = busy(line);
  if (p) await view(`pp-${line.resource}`, p.x, line.ys[p.x - line.x0] - 6, 8);
}
await view('pp-left-section', (left.streetLeft + left.streetRight) / 2, world.groundTop[(left.streetLeft + left.streetRight) >> 1] + 20, 5);
for (const s of world.settlements.filter((q) => q.side !== 'left')) {
  const mid = (s.streetLeft + s.streetRight) >> 1;
  await view(`pp-${s.side}-${s.style}-section`, mid, world.groundTop[mid] + 20, 5);
}

// 3. A blast cuts the water main between the pump and the town: the water in the cut spills, the
// stream queues at the break, nothing more arrives from the pump until the crew re-lays it.
const pump = water.risers.find((r) => r.kind === 'pump');
const into = water.risers.filter((r) => r.flow === 'in').map((r) => r.x);
const town = pump.x < Math.min(...into) ? Math.min(...into) : Math.max(...into);
const cutX = Math.round(pump.x + (town - pump.x) * 0.5);
const cutY = water.ys[cutX - water.x0] + 3;
const waterBefore = pwApp.countWater();
pwApp.explode(cutX, cutY, 12, 1);
pwApp.stepWorld(60);
const broken = [...water.broken].filter(Boolean).length;
check(broken > 0 && pipes.stats.spilled > 0, `a blast cuts the water main and its water spills (${broken} columns, ${pipes.stats.spilled} spilled)`);
pwApp.stepWorld(60 * 3);
const dir = Math.sign(town - pump.x);
const queued = water.packets.filter((p) => p.stage === 1 && (cutX - p.x) * dir > 0 && (cutX - p.x) * dir < 60).length;
const past = water.packets.filter((p) => p.stage === 1 && (p.x - cutX) * dir > 12).length;
check(queued > 15, `the stream queues at the break (${queued} particles within 60 cells upstream, ${past} beyond it)`);
await view('pp-break', cutX - dir * 20, cutY - 6, 7);
const arrived = pipes.stats.delivered.water;
pwApp.stepWorld(60 * 4);
const leftovers = pipes.stats.delivered.water - arrived;
for (let s = 0; s < 40 && [...water.broken].some(Boolean); s += 1) pwApp.stepWorld(60);
check(![...water.broken].some(Boolean), `the crew re-lays the main around the crater (${pipes.stats.repaired} cells)`);
const afterRepair = pipes.stats.delivered.water;
pwApp.stepWorld(60 * 20);
check(pipes.stats.delivered.water - afterRepair > leftovers, `water flows again once the main is whole (${leftovers} arrived while cut, ${pipes.stats.delivered.water - afterRepair} after)`);
check(pwApp.countWater() >= waterBefore - 1, `the spilled water is real water, none lost (${waterBefore} -> ${pwApp.countWater()} cells)`);
await view('pp-repaired', cutX, cutY - 6, 6);
return { checks, stats: pipes.stats, stock: world.stock, made: world.madeGround, shots: shots.length };
