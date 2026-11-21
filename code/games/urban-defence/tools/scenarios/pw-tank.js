// Tanks (N10; run with --page=pixel-world.html --params=det=1&seed=N): a tank in two parts - its
// tracks lying on the ground under them wheel by wheel, the hull tilted along them; its turret
// level and its gun laid in the world's frame - and driven: to its top speed in 1.5 s, over bumps,
// up a slope it can climb, stopped by one it can't, by a wall, a roof over it and a drop; turning
// round and backing up; its gun on targets ahead, high, low and behind; tipping into a hole blown
// under it. The courses are laid on stone in the wilds, cleared above; only the tanks are stepped.
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
if (!PW.tanks) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'scripts/pw/pw-tank.js'; s.onload = resolve; s.onerror = () => reject(new Error('pw-tank.js did not load'));
    document.head.appendChild(s);
  });
}
pwApp.setPaused(true);
const T = PW.tanks, DT = 1 / 60, deg = Math.PI / 180;
const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); if (m === M.AIR) PW.setLayer(world, 'deco', x, y, 0); } };
// (a course: a stretch of the wilds made flat stone at g, cleared 170 cells above)
const used = [];
function site(len) {
  for (const zone of layout.wilds) for (let x = zone.x0 + 60; x + len < zone.x1 - 60; x += 40) {
    if (used.some(([a, b]) => x < b + 60 && x + len > a - 60)) continue;
    const tops = Array.from({ length: len + 1 }, (_, d) => world.groundTop[x + d]);
    const g = Math.min(...tops);
    if (Math.max(...tops) - g > 60) continue;
    used.push([x, x + len]);
    fill(x, g - 170, x + len, g - 1, M.AIR);
    for (let xx = x; xx <= x + len; xx += 1) for (let y = g; y <= world.groundTop[xx] + 3 || y <= g + 3; y += 1) PW.set(world, xx, y, M.STONE, { quiet: true });
    return { x0: x, g };
  }
  return null;
}
const run = (t, secs, each) => { for (let k = 0; k < Math.round(secs / DT); k += 1) { T.step(world, DT); if (each) each(k); } };
// (the ground's top in column x, from above y)
const groundAt = (x, y) => { for (let yy = Math.round(y) - 30; yy < world.height; yy += 1) { const m = PW.get(world, x, yy) & 63; if (PW.mat.phase[m] >= PW.PHASE.POWDER && !PW.mat.passable[m]) return yy; } return -1; };
// (every wheel the tank stands on sits on the ground - its rim on it, not in it nor over it - and
// its hull is clear of the ground; the worst miss in cells)
function seated(t) {
  let worst = 0;
  const R = t.art.R, n = t.art.wheels.length, fx = t.facing * Math.cos(t.angle), fy = t.facing * Math.sin(t.angle), nx = -Math.sin(t.angle), ny = Math.cos(t.angle);
  for (let i = 0; i < n; i += 1) {
    if (!t.contact[i]) continue;
    const u = t.art.wheels[i], v = t.springs[i], wx = t.x + u * fx + v * nx, wy = t.y + u * fy + v * ny;
    let rim = Infinity;
    for (let d = -4; d <= 4; d += 1) rim = Math.min(rim, groundAt(Math.round(wx) + d, wy) + R - Math.sqrt(R * R - d * d));
    worst = Math.max(worst, Math.abs(rim - wy));
  }
  for (const u of [-56, -30, 0, 30, 56]) {
    const wx = t.x + u * fx - 16 * nx, wy = t.y + u * fy - 16 * ny;
    worst = Math.max(worst, wy - groundAt(Math.round(wx), wy));
  }
  return worst;
}
// (the tank drawn alone at 1:1 onto a clear canvas: the box its pixels take up, their colours)
function picture(t) {
  const c = document.createElement('canvas'); c.width = 360; c.height = 200;
  const ctx = c.getContext('2d');
  const r = { ctx, world: { tanks: [t] }, camera: { x: Math.round(t.x) - 180, y: Math.round(t.y) - 150, zoom: 1 }, view: { width: 360, height: 200 } };
  T.draw(r);
  const d = ctx.getImageData(0, 0, 360, 200).data;
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0, sr = 0, sg = 0, sb = 0, cross = 0, star = 0;
  for (let y = 0; y < 200; y += 1) for (let x = 0; x < 360; x += 1) {
    const k = (y * 360 + x) * 4;
    if (!d[k + 3]) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    // (the paint: its coloured pixels, not the grey of its tracks and wheels)
    if (Math.max(d[k], d[k + 1], d[k + 2]) - Math.min(d[k], d[k + 1], d[k + 2]) >= 18) { n += 1; sr += d[k]; sg += d[k + 1]; sb += d[k + 2]; }
    if (d[k] > 210 && d[k + 1] > 210 && d[k + 2] > 200) cross += 1;
    if (d[k] > 180 && d[k + 1] < 70) star += 1;
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, n, r: sr / n, g: sg / n, b: sb / n, cross, star };
}

// 1. The three sides' tanks on flat ground: their size and build (the GIF's long low tank), their
// army's colours and markings, all their wheels on the ground and the hull level.
const A = site(640);
if (!A) check(false, 'a flat stretch of the wilds for the tanks\' courses');
else {
  const looks = {};
  T.STYLES.forEach((style, k) => {
    const t = T.create(world, { style, x: A.x0 + 110 + k * 200, y: A.g, facing: 1 });
    looks[style] = { tank: t, pic: picture(t) };
  });
  const sizes = T.STYLES.map((s) => `${s} ${looks[s].pic.w}x${looks[s].pic.h}`).join(', ');
  const ratios = T.STYLES.map((s) => looks[s].pic.w / looks[s].pic.h);
  check(T.STYLES.every((s) => looks[s].pic.w >= 140 && looks[s].pic.w <= 175 && looks[s].pic.h >= 40 && looks[s].pic.h <= 52) && ratios.every((q) => q > 3.17 * 0.8 && q < 3.17 * 1.25),
    `a tank is a main battle tank's size - about 8 m of hull, 2.7 m to its turret roof, its gun reaching 2.5 m past its nose - and the GIF's long low build (38x12 px there, ${ratios.map((q) => q.toFixed(2)).join(' / ')} long to tall here; ${sizes} cells)`);
  const { modern, asian, gothic } = Object.fromEntries(T.STYLES.map((s) => [s, looks[s].pic]));
  check(modern.r > modern.g && modern.g > modern.b && modern.r > 140 && asian.g > asian.r && asian.g > asian.b && gothic.g > gothic.r && gothic.g < asian.g && gothic.cross > 8 && asian.star > 2,
    `each side's tank in its army's colours: the M1 sand tan (${modern.r | 0},${modern.g | 0},${modern.b | 0}), the Type 99 olive with its red star (${asian.r | 0},${asian.g | 0},${asian.b | 0}; ${asian.star} star pixels), the T-64 dark green with its white cross (${gothic.r | 0},${gothic.g | 0},${gothic.b | 0}; ${gothic.cross} cross pixels)`);
  const flat = T.STYLES.map((s) => looks[s].tank);
  check(flat.every((t) => Math.abs(t.angle) < 0.01 && t.contact.every((c) => c === 1) && t.springs.every((s) => Math.abs(s) < 0.6) && seated(t) <= 1.5),
    `on flat ground every wheel is on it and the hull lies level (${flat.map((t) => `${t.style}: ${t.contact.reduce((a, b) => a + b, 0)}/${t.contact.length} wheels down, ${(t.angle / deg).toFixed(1)} deg`).join('; ')})`);
  // (the gun: level ahead, then on a target high, low and behind)
  const t = looks.gothic.tank;
  const laid = (x, y, secs) => { T.aimAt(t, x, y); run(t, secs); return T.muzzle(t); };
  const up = laid(t.x + 60, t.y - 400, 2), upDeg = Math.atan2(-up.dy, up.dx) / deg;
  const low = laid(t.x + 300, t.y + 60, 2), lowDeg = Math.atan2(-low.dy, low.dx) / deg;
  const mid = laid(t.x + 400, t.y - 100, 2), m0 = T.muzzle(t), want = Math.atan2(m0.y - (t.y - 100), (t.x + 400) - m0.x) / deg;
  const midDeg = Math.atan2(-mid.dy, mid.dx) / deg;
  await view('tank-styles', A.x0 + 320, A.g - 40, 5);
  const back = laid(t.x - 500, t.y - 150, 2.5), backDeg = Math.atan2(-back.dy, -back.dx) / deg;
  check(Math.abs(upDeg - T.GUN_UP) < 1 && Math.abs(lowDeg + T.GUN_DOWN) < 1 && Math.abs(midDeg - want) < 2 && t.aimFacing === -1 && t.facing === 1 && back.dx < 0 && backDeg > 5,
    `the gun is laid on its target - up to ${T.GUN_UP} deg and down to ${T.GUN_DOWN} below the horizontal (a target nearly overhead: ${upDeg.toFixed(1)} deg, one below: ${lowDeg.toFixed(1)}, one in reach: ${midDeg.toFixed(1)} for ${want.toFixed(1)}); a target behind, the turret turns round to it and the hull stays as it was (turret facing ${t.aimFacing}, hull ${t.facing}, gun at ${backDeg.toFixed(1)} deg)`);
  await view('tank-turret-behind', t.x - 40, t.y - 60, 7);
  T.aimAt(t, null);
  world.tanks.length = 0;
}

// 2. Driving: from rest to its top speed in 1.5 s; over bumps, every wheel finding the ground on its
// spring; up a slope it climbs (the hull along it, the turret level, the gun kept off its deck);
// stopped by a wall, a slope too steep, a roof over it (a tunnel), a drop; turning round; backing up.
const B = site(1100);
if (!B) check(false, 'a second stretch of the wilds for the driving course');
else {
  const { x0, g } = B;
  // (two bumps, a 20-degree ramp up 50 cells, a plateau, a wall)
  fill(x0 + 300, g - 4, x0 + 318, g - 1, M.STONE);
  fill(x0 + 370, g - 3, x0 + 374, g - 1, M.STONE);
  const rampAt = x0 + 480, rise = 50, run20 = Math.round(rise / Math.tan(20 * deg));
  for (let d = 0; d <= run20; d += 1) fill(rampAt + d, g - Math.round(d * Math.tan(20 * deg)), rampAt + d, g - 1, M.STONE);
  fill(rampAt + run20, g - rise, x0 + 1100, g - 1, M.STONE);
  const wallAt = rampAt + run20 + 230;
  fill(wallAt, g - rise - 30, wallAt + 15, g - rise - 1, M.STONE);
  const t = T.create(world, { style: 'modern', x: x0 + 140, y: g, facing: 1 });
  T.drive(t, 1);
  let v075 = 0, v15 = 0, worst = 0, bumpSprings = 0, onRamp = null;
  run(t, 1.5, (k) => {
    if (k === 44) v075 = t.v;
    if (k === 89) v15 = t.v;
  });
  check(Math.abs(v075 - T.VMAX / 2) < T.VMAX * 0.05 && Math.abs(v15 - T.VMAX) < 0.01,
    `it gathers speed to its top speed in 1.5 s (${v075.toFixed(1)} cells/s at 0.75 s, ${v15.toFixed(1)} at 1.5 s, of ${T.VMAX}: about 14 km/h)`);
  const travel0 = t.travel;
  let along = 0, px = t.x, py = t.y, ticks = 0;
  const go = () => {
    T.step(world, DT); ticks += 1;
    worst = Math.max(worst, seated(t));
    along += Math.hypot(t.x - px, t.y - py); px = t.x; py = t.y;
    if (t.x > x0 + 300 - 60 && t.x < x0 + 374 + 60) bumpSprings = Math.max(bumpSprings, Math.max(...t.springs) - Math.min(...t.springs));
  };
  while (ticks < 14 * 60 && t.x < x0 + 309) go();
  await view('tank-bump', t.x, t.y - 20, 7);
  while (ticks < 14 * 60 && t.x < rampAt + run20 / 2) go();
  onRamp = { angle: t.angle / deg, elevation: t.elevation / deg, v: t.v };
  await view('tank-ramp', t.x, t.y - 30, 6);
  while (ticks < 14 * 60) go();
  check(Math.abs(t.travel - travel0 - along) < along * 0.05 && bumpSprings > 2.5 && worst <= 2,
    `over the bumps each road wheel rides up on its spring and the track wraps them as they lie (the wheels ${bumpSprings.toFixed(1)} cells apart at most), every wheel on the ground the whole way (the worst ${worst.toFixed(1)} cells off it), the links moving with the ground covered (${(t.travel - travel0).toFixed(0)} cells run, ${along.toFixed(0)} driven)`);
  check(onRamp && Math.abs(onRamp.angle + 20) < 2.5 && Math.abs(onRamp.elevation - Math.max(0, -onRamp.angle - 10)) < 1.5 && onRamp.v < T.VMAX * 0.85 && onRamp.v > T.VMAX * 0.7,
    `up a 20-degree slope it slows (${onRamp ? onRamp.v.toFixed(0) : '-'} cells/s), the hull lies along it (${onRamp ? onRamp.angle.toFixed(1) : '-'} deg), the turret level and the gun laid level ahead but kept 10 deg off its own deck (${onRamp ? onRamp.elevation.toFixed(1) : '-'} deg above the horizontal)`);
  check(t.v === 0 && t.blocked === 'too steep' && t.x + 58 < wallAt && t.x + 58 > wallAt - 30 && Math.abs(t.y - (g - rise)) < 2,
    `a wall stops it short of its nose (stopped ${(wallAt - t.x - 58).toFixed(0)} cells from it: ${t.blocked || 'not stopped'})`);
  // (turning round, then backing up)
  T.drive(t, -1);
  let pivoted = -1;
  run(t, 3, (k) => { if (pivoted < 0 && t.facing === -1) pivoted = k; });
  const goingLeft = t.v < 0 && t.facing === -1;
  T.drive(t, 1, true);
  run(t, 2.5);
  check(goingLeft && pivoted > 30 && t.facing === -1 && t.v > 0 && Math.abs(t.v - T.VMAX * 0.6) < 0.5,
    `to go the other way it stops, turns round on its tracks (${(pivoted * DT).toFixed(2)} s) and drives off; told to back up it backs up, slower (${t.v.toFixed(1)} cells/s, still facing ${t.facing < 0 ? 'left' : 'right'})`);
  T.drive(t, 0);
  run(t, 1);
  world.tanks.length = 0;
  // A slope too steep, a roof over it, a drop, each on its own course.
  const C = site(900);
  if (!C) check(false, 'a third stretch of the wilds for the stops');
  else {
    const { x0: c0, g: cg } = C;
    const steepAt = c0 + 250;
    for (let d = 0; d <= 60; d += 1) fill(steepAt + d, cg - Math.round(d * Math.tan(45 * deg)), steepAt + d, cg - 1, M.STONE);
    const a = T.create(world, { style: 'asian', x: c0 + 120, y: cg, facing: 1 });
    // (a roof 26 cells over the ground: a tunnel's height for troopers, not for a tank)
    const roofAt = c0 + 520;
    fill(roofAt, cg - 30, roofAt + 80, cg - 26, M.STONE);
    const b = T.create(world, { style: 'gothic', x: c0 + 380, y: cg, facing: 1 });
    // (a drop of 40 cells)
    const dropAt = c0 + 760;
    fill(dropAt, cg, c0 + 900, cg + 40, M.AIR);
    const c = T.create(world, { style: 'modern', x: c0 + 630, y: cg, facing: 1 });
    for (const t2 of [a, b, c]) T.drive(t2, 1);
    run(a, 6);
    const short = (t2, at) => at - t2.x - 58;
    check(a.blocked === 'too steep' && b.blocked === 'no room' && c.blocked === 'drop' && [a, b, c].every((t2) => t2.v === 0 && !t2.falling)
      && [short(a, steepAt), short(b, roofAt), short(c, dropAt)].every((d) => d >= 0 && d < 12),
      `it brakes and stops short of a slope steeper than it climbs (45 deg: ${a.blocked || 'went on'}, its nose ${short(a, steepAt).toFixed(0)} cells off), a roof 26 cells up - a tunnel's (${b.blocked || 'went on'}, ${short(b, roofAt).toFixed(0)} off) and a 40-cell drop (${c.blocked || 'went on'}, ${short(c, dropAt).toFixed(0)} off)`);
    // 3. The ground blown away from under its front half: it tips over the edge, nose down, and
    // comes to rest on the floor of the hole, its wheels on the ground.
    for (const t2 of [a, b]) T.drive(t2, 0);
    T.drive(c, 0);
    fill(Math.round(c.x) - 10, cg, c0 + 900, cg + 40, M.AIR);
    fill(Math.round(c.x) - 10, cg + 41, c0 + 900, cg + 44, M.STONE);
    let tipped = 0;
    run(c, 4, () => { tipped = Math.max(tipped, c.angle); });
    const n = c.art.wheels.length, u = c.art.wheels[n - 1], frontY = c.y + u * c.facing * Math.sin(c.angle) + c.springs[n - 1] * Math.cos(c.angle);
    await view('tank-tipped', c.x, cg + 10, 6);
    check(tipped > 15 * deg && !c.falling && Math.abs(frontY - (cg + 41)) < 3 && seated(c) <= 2,
      `with the ground blown away from under its front it tips over the edge nose down (to ${(tipped / deg).toFixed(0)} deg) and comes to rest across it, its front wheels on the floor of the hole 40 cells down (${(frontY - cg).toFixed(0)} down; ${c.falling ? 'still falling' : 'resting'})`);
    world.tanks.length = 0;
  }
}

// 4. What it costs: one tank's tick, and drawing it.
{
  const D = used.length ? used[0] : null;
  if (D) {
    // (by hand: a click drops one on the ground under it, D drives it right, a click lays its gun)
    const hx = D[0] + 320, hg = world.groundTop[hx];
    const h = T.tool(world, hx, hg - 150);
    const placed = !!h && Math.abs(h.y - hg) < 1 && T.held() === h;
    T.key({ code: 'KeyD' });
    run(h, 2.5);
    const drove = placed && h.facing === 1 && h.x > hx + 20;
    T.tool(world, h.x + 300, h.y - 140);
    run(h, 1.5);
    const laid = placed && h.target && h.elevation > 15 * deg;
    T.key({ code: 'KeyS' });
    check(placed && drove && laid, `by hand: a click drops a tank on the ground under it (${placed ? 'on it' : 'not placed'}), D drives it off (${drove ? `${(h.x - hx).toFixed(0)} cells in 2.5 s` : 'did not'}), a click lays its gun on the spot (${laid ? `${(h.elevation / deg).toFixed(0)} deg up` : 'not laid'})`);
    world.tanks.length = 0;
    const t = T.create(world, { style: 'modern', x: D[0] + 120, y: world.groundTop[D[0] + 120], facing: 1 });
    T.drive(t, 1);
    // (the best of a few batches: what it costs, not what else the machine is doing)
    const best = (batches, each, work) => { let min = Infinity; for (let b = 0; b < batches; b += 1) { const t0 = performance.now(); for (let k = 0; k < each; k += 1) work(); min = Math.min(min, (performance.now() - t0) / each); } return min; };
    const stepMs = best(6, 40, () => T.step(world, DT));
    T.aimAt(t, t.x + 300, t.y - 120);
    run(t, 1);
    const ms = {};
    for (const zoom of [1, 2, 4]) {
      const r = { ctx: document.createElement('canvas').getContext('2d'), world, camera: { x: t.x - 400 / zoom, y: t.y - 225 / zoom, zoom }, view: { width: 800, height: 450 } };
      for (let k = 0; k < 10; k += 1) T.draw(r);
      ms[zoom] = best(5, 12, () => T.draw(r));
    }
    check(stepMs < 0.15 && ms[2] < 1.5, `a tank costs little: ${stepMs.toFixed(3)} ms a tick, ${ms[1].toFixed(2)} / ${ms[2].toFixed(2)} / ${ms[4].toFixed(2)} ms to draw at 1x / 2x / 4x`);
    world.tanks.length = 0;
  }
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
