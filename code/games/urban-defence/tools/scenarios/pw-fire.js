// Heat, fire, gases and regrowth (run with --page=pixel-world.html --params=seed=N).
const { world, layout, heat, life, sim } = pwApp;
const { M, FLAG } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const W = world.width;
const top = (x) => PW.get(world, x, world.groundTop[x]) & 63;
const count = (x0, y0, x1, y1, ids) => { let n = 0; for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (ids.includes(PW.get(world, x, y) & 63)) n += 1; return n; };

// 1. A meadow fire. Find the longest gentle run of grass away from settlements (and their
// fields, pumps and defence lines) and water.
const worked = (x) => (world.settlements || []).some((s) => (s.footprints || []).some(([a, b]) => x > a - 60 && x < b + 60));
// The flattest open wild stretch is cleared of trees (or the fire climbs a tree instead of running
// along), levelled, grassed over and sown with an even meadow, the way the crater test levels its
// ground: the test does not hang on where the map happens to leave open grassland.
let best = null;
for (let x = 600; x < W - 600; x += 13) {
  if (layout.sites.some((s) => x > s.x0 - 200 && x < s.x1 + 200) || layout.lakes.some((l) => x > (l.left ?? l.x - l.half) - 100 && x < (l.right ?? l.x + l.half) + 100)) continue;
  let lo = Infinity, hi = -Infinity, clear = true;
  for (let d = -110; d <= 110; d += 5) {
    if (worked(x + d) || (PW.get(world, x + d, world.groundTop[x + d]) & 63) === M.WATER) { clear = false; break; }
    lo = Math.min(lo, world.groundTop[x + d]); hi = Math.max(hi, world.groundTop[x + d]);
  }
  if (clear && (!best || hi - lo < best.spread)) best = { x: x - 80, n: 161, spread: hi - lo };
}
for (const r of (world.flora || []).filter((t) => t.kind === 'tree' && t.x < best.x + best.n + 40 && t.x + t.width > best.x - 40)) PW.flora.fell(world, null, r);
world.flora = (world.flora || []).filter((t) => !t.felled);
PW.settlementTools.terracePad(world, best.x, best.x + best.n - 1, world.groundTop[best.x + (best.n >> 1)]);
for (let x = best.x; x < best.x + best.n; x += 1) {
  const g = world.groundTop[x];
  PW.set(world, x, g, M.GRASS | (PW.hash2(x, g) & 3) << 6, { quiet: true });
  PW.setLayer(world, 'paint', x, g, 0);
  PW.flora.tuft(world, x, g, 2 + (PW.hash2(x, 77) % 3));   // (a wild meadow's 2-4 cells)
}
// Firebreaks of bare earth either side of it (the map's valley floors can run on as grassland for
// a long way): the fire stops where its grass runs out.
for (const [a, b] of [[best.x - 70, best.x - 30], [best.x + best.n + 30, best.x + best.n + 70]]) {
  for (let x = a; x <= b; x += 1) {
    const g = world.groundTop[x];
    if ((PW.get(world, x, g) & 63) === M.GRASS) PW.set(world, x, g, M.SOIL | (PW.hash2(x, g) & 3) << 6, { quiet: true });
    for (let y = g - 1; y > g - 8; y -= 1) if (PW.getFlags(world, x, y) & FLAG.FLORA) { PW.setLayer(world, 'deco', x, y, 0); PW.setFlag(world, x, y, FLAG.FLORA, false); }
  }
}
const fx = best.x + (best.n >> 1), fy = world.groundTop[fx];
const grassBefore = []; for (let x = fx - 300; x <= fx + 300; x += 1) grassBefore.push(top(x) === M.GRASS);
heat.heatDisc(fx, fy - 2, 5, 900);
let maxBurning = 0, maxSmoke = 0, heatMs = 0, smokeSample = 0;
const heatTimes = [];
for (let s = 1; s <= 40; s += 1) {
  pwApp.stepWorld(30);
  maxBurning = Math.max(maxBurning, heat.stats.burning);
  heatMs = Math.max(heatMs, heat.stats.ms);
  heatTimes.push(heat.stats.ms);
  if (s % 4 === 0) { smokeSample = count(fx - 300, fy - 260, fx + 300, fy, [M.SMOKE]); maxSmoke = Math.max(maxSmoke, smokeSample); }
  if (s === 6) await view('fire-meadow', fx, fy - 40, 5);
  if (s === 6) await view('fire-meadow-close', fx, fy - 20, 7);
}
let burnt = 0, left = fx, right = fx;
for (let x = fx - 300; x <= fx + 300; x += 1) {
  if (grassBefore[x - fx + 300] && top(x) !== M.GRASS) { burnt += 1; left = Math.min(left, x); right = Math.max(right, x); }
}
check(maxBurning > 10, `a torch at the grass lights a fire (${maxBurning} cells burning at most)`);
check(burnt >= 20, `the fire spreads along the meadow (${burnt} columns burnt, from ${left - fx} to +${right - fx}, wind ${(world.wind / 14).toFixed(1)} m/s)`);
check(maxSmoke > 100, `burning gives off smoke that rises above the fire (${maxSmoke} smoke cells at most)`);
heatTimes.sort((a, b) => a - b);
const heatP95 = heatTimes[Math.floor(heatTimes.length * 0.95)];
check(heatP95 < 3, `heat and fire step under budget (p95 ${heatP95.toFixed(2)} ms, max ${heatMs.toFixed(2)} ms)`);
let scorched = 0; for (let x = left; x <= right; x += 1) if (PW.getFlags(world, x, world.groundTop[x]) & FLAG.SCORCH) scorched += 1;
check(scorched > burnt * 0.5, `burnt grass leaves scorched soil (${scorched} scorched columns)`);
await view('fire-after', fx, fy - 40, 5);
// Let it burn out (it stops where the grass runs out or the fire dies down).
for (let s = 0; s < 120 && heat.stats.burning > 0; s += 1) pwApp.stepWorld(60);
check(heat.stats.burning === 0, `the fire burns out (${heat.stats.burning} cells still burning)`);
pwApp.stepWorld(60 * 30);
const smokeLeft = count(fx - 400, fy - 600, fx + 400, fy, [M.SMOKE]);
// (a few faint wisps may linger: smoke is meant to hang about; strikes keep theirs going on purpose)
check(smokeLeft < 150, `the smoke thins away once the fire is out (${smokeLeft} cells left)`);

// 2. Boiling water: steam rises, cools and condenses; no water is lost.
const lake = layout.lakes.filter((l) => !l.pond && l.left !== undefined)[0];
const lx = Math.round(lake.x);
const waterBefore = pwApp.countWater();
for (let k = 0; k < 20; k += 1) { heat.heatDisc(lx, lake.level + 3, 10, 900); pwApp.stepWorld(3); }
const steam = count(lx - 120, lake.level - 300, lx + 120, lake.level + 20, [M.STEAM]);
check(steam > 20, `heated lake water boils into steam (${steam} steam cells)`);
await view('fire-steam', lx, lake.level - 30, 5);
pwApp.stepWorld(60 * 20);
const steamLeft = count(lx - 400, lake.level - 800, lx + 400, lake.level + 20, [M.STEAM]);
const waterAfter = pwApp.countWater();
check(steamLeft < steam * 0.2 && waterAfter === waterBefore, `steam condenses back into water, none lost (${steam} -> ${steamLeft} steam; water ${waterBefore} -> ${waterAfter})`);

// 3. Gases never block water: rain falls through a smoke cloud.
const sx = fx + 500, sy = world.groundTop[sx] - 60;
for (let y = sy - 10; y <= sy + 10; y += 1) for (let x = sx - 10; x <= sx + 10; x += 1) if ((PW.get(world, x, y) & 63) === M.AIR) PW.set(world, x, y, M.SMOKE | 3 << 6);
pwApp.paint(sx, sy - 30, 4, M.WATER);
pwApp.stepWorld(120);
const stuck = count(sx - 14, sy - 34, sx + 14, sy + 10, [M.WATER]);
check(stuck === 0, `water falls through a smoke cloud (${stuck} water cells held up in it)`);

// 4. Life: the burn scar greens over again.
heat.stats.burning = 0;
life.advance(60 * 300);   // five minutes of the slow lane
let green = 0; for (let x = left; x <= right; x += 1) if (top(x) === M.GRASS) green += 1;
check(green > (right - left + 1) * 0.6, `after five minutes the burn scar has grown back (${green} of ${right - left + 1} columns green)`);
await view('fire-regrown', fx, fy - 40, 5);
// (N82: what is big in regrowth - a seedling coming up, a young plant drawn again bigger - waits
// until it is out of the player's sight: the scar in view is in sight, ground far off is not)
check(PW.DETERMINISTIC || (life.inSight(fx - 10, fy - 50, fx + 10, fy - 30) && !life.inSight(fx + 6000, fy - 50, fx + 6020, fy - 30)),
  `big regrowth waits out of sight: the scar the camera looks at is in sight (${life.inSight(fx - 10, fy - 50, fx + 10, fy - 30)}), ground 6000 cells off is not (${life.inSight(fx + 6000, fy - 50, fx + 6020, fy - 30)})`);
const fields = world.buildings.filter((b) => b.field);
check(fields.every((b) => b.field.growth >= 0.95), `fields have grown to ripe wheat (${fields.map((b) => b.field.growth.toFixed(2)).join(', ')})`);
check(world.heatList.length < 6, `cold chunks drop their heat arrays (${world.heatList.length} chunks still hold heat)`);
pwApp.setPaused(false);
return { checks, shots: shots.length, fire: { at: fx, meadow: best.n }, stats: heat.stats, life: life.stats };
