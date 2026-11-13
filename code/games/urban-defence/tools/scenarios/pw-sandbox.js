// M2 sandbox physics check (run with --page=pixel-world.html --params=seed=N).
const { world, layout, sim, particles } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 10; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const waterInFlight = () => { let n = 0; for (let i = 0; i < particles.count; i += 1) if (particles.flags[i] & PW.PARTICLE.WATER) n += 1; return n; };
const totalWater = () => pwApp.countWater() + waterInFlight();
const run = (ticks) => pwApp.stepWorld(ticks);

// 1. Tunnel under a lake, breached: floods quickly and conserves water.
const lake = layout.lakes.filter((l) => !l.pond && l.left !== undefined).sort((a, b) => (b.right - b.left) - (a.right - a.left))[0];
let deepest = lake.level;
for (let x = lake.left; x <= lake.right; x += 1) deepest = Math.max(deepest, world.groundTop[x]);
let bottomX = lake.x, bottomY = lake.level;
for (let x = lake.left; x <= lake.right; x += 1) {
  let y = lake.level; while ((PW.get(world, x, y) & 63) === M.WATER) y += 1;
  if (y > bottomY) { bottomY = y; bottomX = x; }
}
const tunnelTop = bottomY + 70, tunnelBottom = tunnelTop + 40;
const t0 = bottomX - 300, t1 = bottomX + 300;
PW.settlementTools.carveBox(world, t0, tunnelTop, t1, tunnelBottom, 0);
for (let c = 0; c < world.chunkCount; c += 1) if (world.simActive[c]) { /* carving woke nothing that moves yet */ }
const before = totalWater();
// Breach: a shaft from the lake bed into the tunnel (like a crater reaching it). It starts at the bed
// so no water cell is removed by the carving itself.
let bed = bottomY;
for (let x = bottomX - 12; x <= bottomX + 12; x += 1) { let y = lake.level; while ((PW.get(world, x, y) & 63) === M.WATER) y += 1; bed = Math.max(bed, y); }
for (let y = lake.level; y <= tunnelTop + 2; y += 1) for (let x = bottomX - 12; x <= bottomX + 12; x += 1) {
  const id = PW.get(world, x, y) & 63;
  if (id !== M.WATER && id !== M.AIR) PW.set(world, x, y, M.AIR);
}
for (let y = bed - 3; y <= tunnelTop + 2; y += 1) for (let x = bottomX - 14; x <= bottomX + 14; x += 1) PW.wake(world, x, y);
const tunnelCells = (t1 - t0 + 1) * (tunnelBottom - tunnelTop + 1);
const floodFraction = () => {
  let wet = 0;
  for (let y = tunnelTop; y <= tunnelBottom; y += 1) for (let x = t0; x <= t1; x += 1) if ((PW.get(world, x, y) & 63) === M.WATER) wet += 1;
  return wet / tunnelCells;
};
const simStart = pwApp.simTimes.length;
run(300);
const flooded = floodFraction();
check(flooded > 0.5, `tunnel under the lake floods >50% within 5 s (${(flooded * 100).toFixed(0)}%)`);
await view('sb-flood', bottomX, tunnelTop - 40, 4);
run(300);
const after = totalWater();
check(after === before, `water conserved through the flood (${before} -> ${after})`);
const times = pwApp.simTimes.slice(-240).sort((a, b) => a - b);
const p95 = times[Math.floor(times.length * 0.95)];
check(p95 < 6, `sim p95 during the flood ${p95.toFixed(2)} ms`);

// 2. Blast into the lake: droplets fly but no water is lost.
const beforeBlast = totalWater();
pwApp.explode(lake.x, lake.level + 6, 40, 1.1);
run(600);
check(totalWater() === beforeBlast, `water conserved through a blast in the lake (${beforeBlast} -> ${totalWater()})`);

// 3. Crater on flat open ground: flat floor and steep walls.
let flatX = null;
for (let x = 600; x < world.width - 600 && flatX === null; x += 37) {
  if (layout.sites.some((s) => x > s.x0 - 300 && x < s.x1 + 300)) continue;
  if (layout.lakes.some((l) => Math.abs(x - l.x) < l.half + 300)) continue;
  let ok = true;
  for (let d = -90; d <= 90; d += 10) if (Math.abs(world.groundTop[x + d] - world.groundTop[x]) > 3) ok = false;
  if (ok) flatX = x;
}
if (flatX !== null) {
  const surface = world.groundTop[flatX];
  const r = 48;
  const original = Array.from({ length: 2 * r + 1 }, (_, i) => world.groundTop[flatX - r + i]);
  pwApp.explode(flatX, surface + 4, r, 1.2);
  const depth = original.map((top, i) => world.groundTop[flatX - r + i] - top);
  const inner = depth.slice(Math.round(r * 0.4), Math.round(r * 1.6) + 1);
  const floorSpread = Math.max(...inner) - Math.min(...inner);
  check(floorSpread <= 6, `crater floor is flat across the inner 60% (spread ${floorSpread} cells, depth ${Math.max(...inner)})`);
  const wall = (side) => {
    // horizontal distance over which depth falls from 80% of the floor to 10%
    const floor = Math.max(...inner);
    let a = null, b = null;
    for (let k = 0; k <= r; k += 1) {
      const d = depth[side > 0 ? r + k : r - k];
      if (a === null && d < floor * 0.8) a = k;
      if (b === null && d < floor * 0.1) b = k;
    }
    return { rise: floor * 0.7, run: Math.max(1, (b ?? r) - (a ?? r)) };
  };
  const left = wall(-1), right = wall(1);
  check(left.rise / left.run >= 2 && right.rise / right.run >= 2,
    `crater walls steeper than 2:1 (left ${(left.rise / left.run).toFixed(1)}, right ${(right.rise / right.run).toFixed(1)})`);
  run(120);
  await view('sb-crater', flatX, surface, 5);
}

// 4. Debris compaction: on the ground it becomes rubble, on a roof it stays debris.
const tower = world.buildings.find((b) => b.type === 'population');
const roofY = tower.body.top - 1;
const roofX = Math.round((tower.body.left + tower.body.right) / 2) - 40;
pwApp.paint(roofX, roofY - 8, 5, M.DEBRIS);
const groundX = flatX !== null ? flatX + 160 : tower.body.right + 300;
const groundY = world.groundTop[groundX] - 10;
pwApp.paint(groundX, groundY, 6, M.DEBRIS);
run(60 * 13);
const countIn = (x0, y0, x1, y1, id) => { let n = 0; for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if ((PW.get(world, x, y) & 63) === id) n += 1; return n; };
const groundRubble = countIn(groundX - 20, groundY - 10, groundX + 20, groundY + 20, M.RUBBLE);
const groundDebris = countIn(groundX - 20, groundY - 10, groundX + 20, groundY + 20, M.DEBRIS);
const roofDebris = countIn(roofX - 30, roofY - 30, roofX + 30, roofY + 2, M.DEBRIS);
const roofRubble = countIn(roofX - 30, roofY - 30, roofX + 30, roofY + 2, M.RUBBLE);
check(groundRubble > 0 && groundDebris === 0, `ground debris compacted into rubble (${groundRubble} rubble, ${groundDebris} loose)`);
check(roofDebris > 0 && roofRubble === 0, `roof debris stays loose (${roofDebris} loose, ${roofRubble} rubble)`);
await view('sb-roof-debris', roofX, roofY - 20, 6);
pwApp.setPaused(false);
return { checks, shots: shots.length, sim: sim.stats, particles: particles.count };
