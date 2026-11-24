// Repair through the cores (run with --page=pixel-world.html --params=seed=N): a damaged building
// rebuilds itself from its blueprint while any of its cores survives - recycling the debris lying
// against it into HM, drawing more from the bundle, one repair pixel per quarter second per core,
// frame first, then floors, walls, glass. A ruined building does not repair (its cores are rising).
const { world } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
const repair = world.repair;
check(!!repair, 'the repair system is up');

// 1. Bite a hole in a standing tower's wall: the wound is found and queued.
const b = world.buildings.find((q) => q.type === 'population' && q.side === 'left');
const wx = Math.round((b.body.left + b.body.right) / 2);
await view('rp-before', wx, b.ground - 40, 4);
// (into the first storey's wall - over a tall gate hall (N121), that is the hall's height up)
const holeY = b.ground - 30 - ((b.canvas && b.canvas.meta && b.canvas.meta.hallRaise) || 0);
pwApp.explode(b.body.left + 10, holeY, 11, 1);
// (N100: the crews wait while what the blast loosed is still coming down - then set to)
pwApp.stepWorld(10);
const held = repair.jobs.get(b.id);
check(!!held && !held.calm && !(held.built > 0), `the crews hold off while the wreck is still falling (${held ? `calm ${!!held.calm}, ${held.built || 0} built` : 'no job'})`);
let waited = 10;
while (waited < 60 * 30 && !(repair.jobs.get(b.id) || {}).calm) { pwApp.stepWorld(10); waited += 10; }
pwApp.stepWorld(60);
const job = repair.jobs.get(b.id);
check(!!job && (job.queue.length > 30 || repair.stats.restored > 10), `once it has come to rest (${(waited / 60).toFixed(1)} s) the wound is scanned and queued (${job ? job.queue.length : 0} cells queued)`);
await view('rp-hole', wx, b.ground - 40, 4);

// 1b. N98 (the user's): while the crews work, the work's dust and gas go out through vents in the
// roof - flagged as the outlet for the air's flow.
{
  const P = world.particles, F = PW.PARTICLE;
  pwApp.stepWorld(60 * 3);
  const vents = (b.vents && b.vents.list) || [];
  const flagged = vents.filter((v) => PW.getFlags(world, v.x, v.roof) & PW.FLAG.VENT).length;
  let puffs = 0;
  for (let i = 0; i < P.stats.count; i += 1) {
    if (!(P.flags[i] & F.SMOKE)) continue;
    if (vents.some((v) => Math.abs(P.px[i] - v.x) < 30 && P.py[i] < v.y + 2 && P.py[i] > v.y - 120)) puffs += 1;
  }
  check(vents.length >= 1 && flagged === vents.length && world.vents && world.vents.size >= vents.length,
    `its roof has vents (${vents.map((v) => `${v.x},${v.roof}`).join(' ')}), each flagged the air's outlet`);
  check(puffs > 0, `the work's gas rises out of them as the crews work (${puffs} puffs over the roof)`);
  if (vents[0]) await view('n98-vent', vents[0].x, vents[0].y - 30, 5);
}

// 2. The building heals: debris recycled into HM, the bundle's HM drawn on, cells restored from
// the blueprint, bottom-up within each class.
const st0 = { restored: repair.stats.restored, recycled: repair.stats.recycled, hmStock: repair.stats.hmFromStock, hmDebris: repair.stats.hmFromDebris };
pwApp.stepWorld(60 * 45);
const st1 = repair.stats;
check(st1.restored - st0.restored >= 30, `repair pixels rebuild the wall (${st1.restored - st0.restored} cells in 45 s)`);
check(st1.recycled - st0.recycled > 10, `debris touching the building is recycled (${st1.recycled - st0.recycled} cells eaten)`);
check(st1.hmFromDebris - st0.hmDebris > 2 || st1.hmFromStock - st0.hmStock > 2,
  `the work is paid in HM (${(st1.hmFromDebris - st0.hmDebris).toFixed(1)} from debris, ${st1.hmFromStock - st0.hmStock} from the bundle)`);
await view('rp-healing', wx, b.ground - 40, 4);

// 3. The cores drive it: a building whose cores are all gone does not repair.
const other = world.buildings.find((q) => q.type === 'population' && q.side === 'right');
for (const core of other.cores || []) {
  for (let dy = -8; dy <= 8; dy += 1) for (let dx = -8; dx <= 8; dx += 1) {
    if ((PW.get(world, core.x + dx, core.y + dy) & 63) === M.CORE) PW.set(world, core.x + dx, core.y + dy, M.AIR);
  }
}
pwApp.explode(other.body.left + 10, other.ground - 30, 10, 1);
// (the crews look it over once the wreck has come to rest - N100)
for (let t = 0; t < 60 * 30 && !(repair.jobs.get(other.id) || {}).calm; t += 10) pwApp.stepWorld(10);
pwApp.stepWorld(120);
const q0 = (repair.jobs.get(other.id) || { queue: [] }).queue.length;
pwApp.stepWorld(60 * 8);
const deadJob = repair.jobs.get(other.id);
check(!!deadJob && deadJob.queue.length >= Math.max(20, q0),
  `a coreless building keeps its wound (${q0} -> ${deadJob ? deadJob.queue.length : 0} cells open, nothing healed)`);
return { checks, stats: repair.stats, shots: shots.length };
