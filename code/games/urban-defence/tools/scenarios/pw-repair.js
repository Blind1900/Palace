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
pwApp.explode(b.body.left + 10, b.ground - 30, 11, 1);
pwApp.stepWorld(120);
const job = repair.jobs.get(b.id);
check(!!job && (job.queue.length > 30 || repair.stats.restored > 10), `the wound is scanned and queued (${job ? job.queue.length : 0} cells queued)`);
await view('rp-hole', wx, b.ground - 40, 4);

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
pwApp.stepWorld(120);
const q0 = (repair.jobs.get(other.id) || { queue: [] }).queue.length;
pwApp.stepWorld(60 * 8);
const deadJob = repair.jobs.get(other.id);
check(!!deadJob && deadJob.queue.length >= Math.max(20, q0),
  `a coreless building keeps its wound (${q0} -> ${deadJob ? deadJob.queue.length : 0} cells open, nothing healed)`);
return { checks, stats: repair.stats, shots: shots.length };
