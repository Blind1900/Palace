// Tanks (N10, N71, N72; run with --page=pixel-world.html --params=det=1&seed=N): a tank in two
// parts - its tracks lying on the ground under them wheel by wheel, the hull tilted along them and
// the same both ways round; its turret on the hull, tilting with it, and its gun laid within its
// reach of the hull - and driven: to its top speed in 1.5 s, over bumps, up a slope it can climb,
// stopped by one it can't, by a wall, a roof over it and a drop; going the other way (only the
// turret turns); its gun on targets ahead, high, low and behind; tipping into a hole blown under
// it; driving through its own side's buildings, ramming an enemy's (in the world's towns too) and
// flattening loose debris. The courses are laid on stone in the wilds, cleared above; only the
// tanks are stepped (but for the towns', where the world is).
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
    // (clear of buildings - an outpost, a bunker in the wilds: the cells cleared and laid over one are
    // still its own, and a tank stands on no building's)
    if ((world.buildings || []).some((bd) => bd.body && x < bd.body.right + 60 && x + len > bd.body.left - 60)) continue;
    const tops = Array.from({ length: len + 1 }, (_, d) => world.groundTop[x + d]);
    const g = Math.min(...tops);
    if (Math.max(...tops) - g > 60) continue;
    used.push([x, x + len]);
    fill(x, g - 170, x + len, g - 1, M.AIR);
    // (down to the ground as it was: the ground line moves up with the stone laid)
    for (let xx = x; xx <= x + len; xx += 1) for (let y = g; y <= tops[xx - x] + 3 || y <= g + 3; y += 1) { PW.set(world, xx, y, M.STONE, { quiet: true }); PW.setLayer(world, 'deco', xx, y, 0); }
    // (and the plants that stood there gone - their records, the marks they left on their cells -
    // or one would come down later, taking the course's stone it still counts its own with it)
    const gone = (r) => { const ax = r.anchorX ?? r.x; return ax >= x - 3 && ax <= x + len + 3; };
    if (world.flora && world.flora.some(gone)) { world.flora = world.flora.filter((r) => !gone(r)); world.floraIndex = null; }
    for (let xx = x; xx <= x + len; xx += 1) for (let y = g - 170; y <= tops[xx - x] + 3 || y <= g + 3; y += 1) PW.setFlag(world, xx, y, PW.FLAG.FLORA | PW.FLAG.WOOD | PW.FLAG.CHARRED, false);
    return { x0: x, g };
  }
  return null;
}
const run = (t, secs, each) => { for (let k = 0; k < Math.round(secs / DT); k += 1) { T.step(world, DT); if (each) each(k); } };
// (the ground's top in column x, from above y)
const groundAt = (x, y) => { for (let yy = Math.round(y) - 30; yy < world.height; yy += 1) { const m = PW.get(world, x, yy) & 63; if (PW.mat.phase[m] >= PW.PHASE.POWDER && !PW.mat.passable[m]) return yy; } return -1; };
// (every wheel the tank stands on sits on the ground - its rim on it, not in it nor over it - and
// its hull is clear of the ground; the worst miss in cells)
// (seated.why: which wheel or point of the hull, and what ground it found)
function seated(t) {
  let worst = 0;
  const R = t.art.R, n = t.art.wheels.length, fx = Math.cos(t.angle), fy = Math.sin(t.angle), nx = -Math.sin(t.angle), ny = Math.cos(t.angle);
  const why = (what, x, y) => { const gy = groundAt(x, y); seated.why = `${what} at ${x},${Math.round(y)} over ${PW.get(world, x, gy) & 63} at ${gy}`; };
  for (let i = 0; i < n; i += 1) {
    if (!t.contact[i]) continue;
    const u = t.art.wheels[i], v = t.springs[i], wx = t.x + u * fx + v * nx, wy = t.y + u * fy + v * ny;
    let rim = Infinity;
    for (let d = -4; d <= 4; d += 1) rim = Math.min(rim, groundAt(Math.round(wx) + d, wy) + R - Math.sqrt(R * R - d * d));
    if (Math.abs(rim - wy) > worst) { worst = Math.abs(rim - wy); why(`wheel ${i}`, Math.round(wx), wy); }
  }
  for (const u of [-56, -30, 0, 30, 56]) {
    const wx = t.x + u * fx - 16 * nx, wy = t.y + u * fy - 16 * ny;
    if (wy - groundAt(Math.round(wx), wy) > worst) { worst = wy - groundAt(Math.round(wx), wy); why(`hull ${u}`, Math.round(wx), wy); }
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
  const tall = T.STYLES.map((s) => looks[s].tank.art.height);
  check(T.STYLES.every((s) => looks[s].pic.w >= 140 && looks[s].pic.w <= 175 && looks[s].pic.h >= 30 && looks[s].pic.h <= looks[s].tank.art.height + 2)
    && tall[0] === 35 && tall[0] >= tall[1] && tall[1] >= tall[2] && tall[2] <= 33 && ratios.every((q) => q > 3.6 && q < 5.2),
    `a tank is a main battle tank's real size - about 8 m of hull, its gun reaching 2.5 m past its nose - and its own army's height: an M1 Abrams 2.44 m to its turret roof, ${tall[0]} cells with its cupola, a Type 99 ${tall[1]}, a low T-64 ${tall[2]} - under a gate hall's 36 clear (${ratios.map((q) => q.toFixed(2)).join(' / ')} long to tall, as a real one with its gun; ${sizes} cells)`);
  const { modern, asian, gothic } = Object.fromEntries(T.STYLES.map((s) => [s, looks[s].pic]));
  check(modern.r > modern.g && modern.g > modern.b && modern.r > 140 && asian.g > asian.r && asian.g > asian.b && gothic.g > gothic.r && gothic.g < asian.g && gothic.cross > 8 && asian.star > 2,
    `each side's tank in its army's colours: the M1 sand tan (${modern.r | 0},${modern.g | 0},${modern.b | 0}), the Type 99 olive with its red star (${asian.r | 0},${asian.g | 0},${asian.b | 0}; ${asian.star} star pixels), the T-64 dark green with its white cross (${gothic.r | 0},${gothic.g | 0},${gothic.b | 0}; ${gothic.cross} cross pixels)`);
  const flat = T.STYLES.map((s) => looks[s].tank);
  check(flat.every((t) => Math.abs(t.angle) < 0.01 && t.contact.every((c) => c === 1) && t.springs.every((s) => Math.abs(s) < 0.6) && seated(t) <= 1.5),
    `on flat ground every wheel is on it and the hull lies level (${flat.map((t) => `${t.style}: ${t.contact.reduce((a, b) => a + b, 0)}/${t.contact.length} wheels down, ${(t.angle / deg).toFixed(1)} deg`).join('; ')})`);
  // (the hull the same both ways round: each cell of it and its mirror both there or both not)
  const unlike = flat.map((t) => { const h = t.art.hull; let n = 0; for (let v = h.y0; v <= h.y1; v += 1) for (let u = h.x0; u <= h.x1; u += 1) if (!!h.px[(v - h.y0) * h.w + (u - h.x0)] !== !!(-u - 1 >= h.x0 && h.px[(v - h.y0) * h.w + (-u - 1 - h.x0)])) n += 1; return n; });
  check(unlike.every((n) => n === 0), `the hull is the same at both ends, so only the turret turns when it goes the other way (${unlike.join(' / ')} cells unlike their mirror)`);
  // (the gun: level ahead, then on a target high, low and behind)
  const t = looks.gothic.tank;
  const laid = (x, y, secs) => { T.aimAt(t, x, y); run(t, secs); return T.muzzle(t); };
  const up = laid(t.x + 60, t.y - 400, 2), upDeg = Math.atan2(-up.dy, up.dx) / deg;
  const low = laid(t.x + 300, t.y + 60, 2), lowDeg = Math.atan2(-low.dy, low.dx) / deg;
  const mid = laid(t.x + 400, t.y - 100, 2), m0 = T.muzzle(t), want = Math.atan2(m0.y - (t.y - 100), (t.x + 400) - m0.x) / deg;
  const midDeg = Math.atan2(-mid.dy, mid.dx) / deg;
  await view('tank-styles', A.x0 + 320, A.g - 40, 5);
  // (a target behind: the turret turns round to it - seen half way round - and the hull stays put)
  const x00 = t.x, a00 = t.angle;
  T.aimAt(t, t.x - 500, t.y - 150);
  let ticks = 0;
  while (t.turning < T.TURN / 2 && ticks < 120) { T.step(world, DT); ticks += 1; }
  const halfWay = t.turning >= T.TURN / 2 * 0.9;
  // (half way round it faces us, as the user's photos of tanks seen head-on: the turret from its
  // front - as wide as it is, the same either side of its gun - the gun pointing out at us, its
  // muzzle's bore a dark ring at its end; the hull under it as it was)
  const P = T.poseOf(t), bore = T.pixel(t, P, P.bx + P.gdx, P.by + P.gdy);
  const boreDark = !!bore && (bore & 255) < 40 && (bore >>> 8 & 255) < 40 && (bore >>> 16 & 255) < 40;
  let left = Infinity, right = -Infinity;
  for (let x = Math.floor(P.rx) - 70; x <= P.rx + 70; x += 1) if (T.pixel(t, P, x + 0.5, P.ry - 4) && T.part() === T.PARTS.TURRET) { left = Math.min(left, x); right = Math.max(right, x); }
  const across = right - left + 1, offCentre = (left + right + 1) / 2 - P.rx;
  check(halfWay && boreDark && across >= 34 && Math.abs(offCentre) <= 3,
    `half way round, the turret faces us as in the photos of tanks head-on: its front ${across} cells across, centred on its ring (${offCentre.toFixed(1)} off), the gun pointing out at us with its bore a dark ring at its muzzle (${boreDark ? 'dark' : 'not there'}) - only the head turned, the hull as it was`);
  await view('tank-turret-turning', t.x, t.y - 30, 7);
  run(t, 2.2);
  const back = T.muzzle(t), backDeg = Math.atan2(-back.dy, -back.dx) / deg;
  check(Math.abs(upDeg - T.GUN_UP) < 1 && Math.abs(lowDeg + T.GUN_DOWN) < 1 && Math.abs(midDeg - want) < 2 && halfWay && t.facing === -1 && t.x === x00 && t.angle === a00 && back.dx < 0 && backDeg > 5,
    `the gun is laid on its target - up to ${T.GUN_UP} deg and down to ${T.GUN_DOWN} below the hull's line (a target nearly overhead: ${upDeg.toFixed(1)} deg, one below: ${lowDeg.toFixed(1)}, one in reach: ${midDeg.toFixed(1)} for ${want.toFixed(1)}); a target behind, the turret turns round to it (${halfWay ? `half way at ${(ticks * DT).toFixed(2)} s` : 'never seen turning'}) and the hull stays as it was (turret facing ${t.facing < 0 ? 'left' : 'right'}, hull ${t.x === x00 && t.angle === a00 ? 'unmoved' : 'moved'}, gun at ${backDeg.toFixed(1)} deg)`);
  await view('tank-turret-behind', t.x - 40, t.y - 60, 7);
  T.aimAt(t, null);
  world.tanks.length = 0;
}

// 2. Driving: from rest to its top speed in 1.5 s; over bumps, every wheel finding the ground on its
// spring; up a slope it climbs (the hull along it, the turret tilting with it, the gun within its
// reach of the hull); stopped by a wall, a slope too steep, a roof over it (a tunnel), a drop; going
// the other way - only the turret turns - and down the slope nose-down.
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
  let v075 = 0, v15 = 0, worst = 0, worstAt = 0, bumpSprings = 0, onRamp = null;
  run(t, 1.5, (k) => {
    if (k === 44) v075 = t.v;
    if (k === 89) v15 = t.v;
  });
  check(Math.abs(v075 - T.VMAX / 2) < T.VMAX * 0.05 && Math.abs(v15 - T.VMAX) < 0.01,
    `it gathers speed to its top speed in 1.5 s (${v075.toFixed(1)} cells/s at 0.75 s, ${v15.toFixed(1)} at 1.5 s, of ${T.VMAX}: about 14 km/h)`);
  const travel0 = t.travel;
  // (the gun's elevation over the hull's line, the way the turret faces: never outside its reach)
  let along = 0, px = t.x, py = t.y, ticks = 0, relLo = Infinity, relHi = -Infinity;
  const rel = () => { const r = (t.elevation + t.facing * t.angle) / deg; relLo = Math.min(relLo, r); relHi = Math.max(relHi, r); };
  const go = () => {
    T.step(world, DT); ticks += 1;
    const sNow = seated(t);
    if (sNow > worst) {
      worstAt = Math.round(t.x - x0);
      // (what lies under it there)
      if (sNow > 2) worstAt += ` - ${seated.why}, the ground at ${g}, the hull at ${t.x.toFixed(0)},${t.y.toFixed(1)} angle ${(t.angle / deg).toFixed(1)} springs ${t.springs.map((s) => s.toFixed(1)).join('/')} contact ${t.contact.map(Number).join('')}`;
    }
    worst = Math.max(worst, sNow);
    along += Math.hypot(t.x - px, t.y - py); px = t.x; py = t.y;
    if (t.x > x0 + 300 - 60 && t.x < x0 + 374 + 60) bumpSprings = Math.max(bumpSprings, Math.max(...t.springs) - Math.min(...t.springs));
    rel();
  };
  while (ticks < 14 * 60 && t.x < x0 + 309) go();
  await view('tank-bump', t.x, t.y - 20, 7);
  while (ticks < 14 * 60 && t.x < rampAt + run20 / 2) go();
  onRamp = { angle: t.angle / deg, elevation: t.elevation / deg, v: t.v };
  await view('tank-ramp', t.x, t.y - 30, 6);
  while (ticks < 14 * 60) go();
  check(Math.abs(t.travel - travel0 - along) < along * 0.05 && bumpSprings > 2.5 && worst <= 2,
    `over the bumps each road wheel rides up on its spring and the track wraps them as they lie (the wheels ${bumpSprings.toFixed(1)} cells apart at most), every wheel on the ground the whole way (the worst ${worst.toFixed(1)} cells off it, ${worstAt} along the course), the links moving with the ground covered (${(t.travel - travel0).toFixed(0)} cells run, ${along.toFixed(0)} driven)`);
  check(onRamp && Math.abs(onRamp.angle + 20) < 2.5 && Math.abs(onRamp.elevation - Math.max(0, -onRamp.angle - T.GUN_DOWN)) < 1.5 && onRamp.v < T.VMAX * 0.85 && onRamp.v > T.VMAX * 0.7,
    `up a 20-degree slope it slows (${onRamp ? onRamp.v.toFixed(0) : '-'} cells/s), the hull lies along it (${onRamp ? onRamp.angle.toFixed(1) : '-'} deg) with the turret on it, and the gun, laid level ahead, is held within its reach of the hull: ${T.GUN_DOWN} deg below its line (${onRamp ? onRamp.elevation.toFixed(1) : '-'} deg above the horizontal)`);
  check(t.v === 0 && t.blocked === 'too steep' && t.x + 58 < wallAt && t.x + 58 > wallAt - 30 && Math.abs(t.y - (g - rise)) < 2,
    `a wall stops it short of its nose (stopped ${(wallAt - t.x - 58).toFixed(0)} cells from it: ${t.blocked || 'not stopped'})`);
  // (the other way: straight off, the hull as it was, the turret turning to face the way it goes;
  // then down the slope, nose-down)
  const a0 = t.angle;
  T.drive(t, -1);
  let moved = -1, turned = -1, k = 0;
  while (k < 4 * 60 && t.x > rampAt + run20 + 70) { T.step(world, DT); rel(); if (moved < 0 && t.v < 0) moved = k; if (turned < 0 && t.facing === -1) turned = k; k += 1; }
  const plateau = { v: t.v, angle: t.angle };
  check(moved >= 0 && moved <= 2 && turned > 0 && Math.abs(turned * DT - T.TURN) < 0.05 && Math.abs(plateau.v + T.VMAX) < 0.5 && Math.abs(plateau.angle - a0) < 1e-6,
    `to go the other way it just drives off the other way (moving at once, ${Math.abs(plateau.v).toFixed(0)} cells/s soon after), its hull the same both ways and never turned round, while its turret turns to face the way it goes (${(turned * DT).toFixed(2)} s)`);
  k = 0;
  while (k < 8 * 60 && t.x > rampAt + run20 / 2) { T.step(world, DT); rel(); k += 1; }
  const down = { angle: t.angle / deg, elevation: t.elevation / deg, v: t.v };
  await view('tank-downhill', t.x, t.y - 30, 6);
  check(Math.abs(down.angle + 20) < 2.5 && t.facing === -1 && Math.abs(down.elevation) < 1 && Math.abs(down.v + T.VMAX) < 1 && relLo >= -T.GUN_DOWN - 0.01 && relHi <= T.GUN_UP + 0.01,
    `down the slope nose-down at full speed (${Math.abs(down.v).toFixed(0)} cells/s), the turret on the hull, the gun laid level ahead within its reach (${down.elevation.toFixed(1)} deg); the gun never once outside its reach of the hull on the whole course (${relLo.toFixed(1)} to ${relHi.toFixed(1)} deg over its line), so it never dips into the hull nor the turret off it`);
  T.drive(t, 0);
  run(t, 1);
  world.tanks.length = 0;
  // A slope too steep, a roof over it, a drop, each on its own course.
  const C = site(900);
  if (!C) check(false, 'a third stretch of the wilds for the stops');
  else {
    const { x0: c0, g: cg } = C;
    const steepAt = c0 + 250;
    for (let d = 0; d <= 60; d += 1) fill(steepAt + d, cg - Math.min(160, Math.round(d * Math.tan(70 * deg))), steepAt + d, cg - 1, M.STONE);
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
      `it brakes and stops short of a slope steeper than it climbs (70 deg: ${a.blocked || 'went on'}, its nose ${short(a, steepAt).toFixed(0)} cells off), a roof 26 cells up - a tunnel's (${b.blocked || 'went on'}, ${short(b, roofAt).toFixed(0)} off) and a 40-cell drop (${c.blocked || 'went on'}, ${short(c, dropAt).toFixed(0)} off)`);
    // 3. The ground blown away from under its front half: it tips over the edge, nose down, and
    // comes to rest on the floor of the hole, its wheels on the ground.
    for (const t2 of [a, b]) T.drive(t2, 0);
    T.drive(c, 0);
    fill(Math.round(c.x) - 10, cg, c0 + 900, cg + 40, M.AIR);
    fill(Math.round(c.x) - 10, cg + 41, c0 + 900, cg + 44, M.STONE);
    let tipped = 0;
    run(c, 4, () => { tipped = Math.max(tipped, c.angle); });
    const n = c.art.wheels.length, u = c.art.wheels[n - 1], frontY = c.y + u * Math.sin(c.angle) + c.springs[n - 1] * Math.cos(c.angle);
    await view('tank-tipped', c.x, cg + 10, 6);
    check(tipped > 15 * deg && !c.falling && Math.abs(frontY - (cg + 41)) < 3 && seated(c) <= 2,
      `with the ground blown away from under its front it tips over the edge nose down (to ${(tipped / deg).toFixed(0)} deg) and comes to rest across it, its front wheels on the floor of the hole 40 cells down (${(frontY - cg).toFixed(0)} down; ${c.falling ? 'still falling' : 'resting'})`);
    world.tanks.length = 0;
  }
}

// 4b. Steep ground (N72; the user's limit, 43 degrees): it climbs a mountainside of 43 degrees,
// crawling, and a flight of stairs no steeper - steps 6 cells high and 7 deep, 41 degrees along
// their nosings - each to the top, and drives on; and it stops short of a mountainside of 47
// degrees and of a flight of stairs of 45 (steps 6 high and 6 deep): its tracks would lie steeper
// than it climbs.
{
  const E = site(1100);
  if (!E) check(false, 'a stretch of the wilds for the climbs');
  else {
    const { x0, g } = E;
    // (a mountainside of 43 degrees up 90 cells, and a flight of 10 steps 6 high and 7 deep beyond it)
    const hillAt = x0 + 220, hill = 90, run43 = Math.round(hill / Math.tan(43 * deg));
    for (let d = 0; d <= run43; d += 1) fill(hillAt + d, g - Math.round(d * Math.tan(43 * deg)), hillAt + d, g - 1, M.STONE);
    fill(hillAt + run43, g - hill, hillAt + run43 + 160, g - 1, M.STONE);
    const stairsAt = hillAt + run43 + 160;
    for (let k = 0; k < 10; k += 1) fill(stairsAt + k * 7, g - hill - (k + 1) * 6, x0 + 1100, g - hill - k * 6 - 1, M.CONCRETE);
    const t = T.create(world, { style: 'modern', x: x0 + 100, y: g, facing: 1 });
    T.drive(t, 1);
    let slowest = Infinity, onHill = null, ticks = 0;
    while (ticks < 20 * 60 && t.x < hillAt + run43 + 80) {
      T.step(world, DT); ticks += 1;
      if (t.x > hillAt + 20 && t.x < hillAt + run43 - 20) { slowest = Math.min(slowest, Math.abs(t.v)); if (!onHill && t.angle < -40 * deg) onHill = { angle: t.angle / deg, v: t.v }; }
    }
    const upHill = t.y < g - hill + 3 && !t.falling, hillSecs = ticks * DT;
    if (onHill) await view('tank-mountainside', hillAt + run43 / 2, g - hill / 2, 6);
    while (ticks < 40 * 60 && t.x < stairsAt + 70 + 80) { T.step(world, DT); ticks += 1; }
    const upStairs = t.y < g - hill - 60 + 3 && !t.falling;
    await view('tank-stairs', stairsAt + 35, g - hill - 40, 6);
    check(upHill && upStairs && onHill && onHill.angle > -T.MAX_SLOPE - 1.5 && slowest < T.VMAX * 0.55,
      `it climbs ground as steep as its ${T.MAX_SLOPE} degrees: a mountainside of 43, crawling up it (${onHill ? `the hull at ${onHill.angle.toFixed(0)} deg, ${slowest.toFixed(0)} cells/s at the slowest` : 'never on it'}; at the top: ${upHill ? `yes, in ${hillSecs.toFixed(1)} s` : `no - ${t.blocked}`}), and a flight of stairs 6 cells high and 7 deep, 41 along its nosings, to the top (${upStairs ? 'yes' : `no - ${t.blocked}, at ${(t.y - (g - hill)).toFixed(0)}`})`);
    world.tanks.length = 0;
  }
  const F = site(900);
  if (!F) check(false, 'a stretch of the wilds for the climbs too steep');
  else {
    const { x0, g } = F;
    // (a mountainside of 47 degrees up 60 cells, and beyond it a flight of 10 steps 6 high and 6 deep)
    const hillAt = x0 + 250, hill = 60, run47 = Math.round(hill / Math.tan(47 * deg));
    for (let d = 0; d <= run47; d += 1) fill(hillAt + d, g - Math.round(d * Math.tan(47 * deg)), hillAt + d, g - 1, M.STONE);
    fill(hillAt + run47, g - hill, x0 + 400, g - 1, M.STONE);
    const stairsAt = x0 + 640;
    for (let k = 0; k < 10; k += 1) fill(stairsAt + k * 6, g - (k + 1) * 6, x0 + 900, g - k * 6 - 1, M.CONCRETE);
    const a = T.create(world, { style: 'gothic', x: x0 + 120, y: g, facing: 1 });
    const b = T.create(world, { style: 'asian', x: x0 + 500, y: g, facing: 1 });
    for (const t2 of [a, b]) T.drive(t2, 1);
    run(a, 6);
    const short = (t2, at) => at - t2.x - 58;
    await view('tank-too-steep', stairsAt - 60, g - 40, 6);
    check([a, b].every((t2) => t2.blocked === 'too steep' && t2.v === 0 && !t2.falling && Math.abs(t2.angle) < 3 * deg) && [short(a, hillAt), short(b, stairsAt)].every((d) => d >= -2 && d < 16),
      `steeper than ${T.MAX_SLOPE} degrees it stops at the foot: a mountainside of 47 (${a.blocked || 'went on'}, its nose ${short(a, hillAt).toFixed(0)} cells off it, the hull at ${(a.angle / deg).toFixed(0)} deg) and a flight of stairs of 45 - 6 high, 6 deep (${b.blocked || 'went on'}, ${short(b, stairsAt).toFixed(0)} off, at ${(b.angle / deg).toFixed(0)} deg)`);
    world.tanks.length = 0;
  }
}

// 4c. In water (N82): wading, it drives slower and grips the ground the less - its weight borne
// off its tracks by the water; still water only slows it, a current pushes it: a flood up to its
// hull's waist it stands against, one over its turret carries it off. (Each in a basin of its own:
// still water 24 deep, a flood 10 deep, a flood 50 deep - its water on the move to the right.)
{
  const basin = (depth, moving) => {
    const S = site(420);
    if (!S) return null;
    const { x0, g } = S, a = x0 + 80, b = x0 + 380;
    fill(a - 8, g - 60, a - 1, g + depth + 6, M.STONE);
    fill(b + 1, g - 60, b + 8, g + depth + 6, M.STONE);
    fill(a, g + depth, b, g + depth + 6, M.STONE);
    fill(a, g - 60, b, g + depth - 1, M.AIR);
    for (let y = g; y < g + depth; y += 1) for (let x = a; x <= b; x += 1) PW.set(world, x, y, M.WATER | (moving ? 0xc0 : 0), { quiet: true });
    return { x: (a + b) / 2, floor: g + depth };
  };
  const still = basin(24, false), shallow = basin(10, true), deep = basin(50, true);
  if (!still || !shallow || !deep) check(false, 'stretches of the wilds for the basins');
  else {
    world.tanks.length = 0;
    const s = T.create(world, { style: 'modern', x: still.x - 60, y: still.floor, facing: 1 });
    const h = T.create(world, { style: 'asian', x: shallow.x, y: shallow.floor, facing: 1 });
    const d = T.create(world, { style: 'gothic', x: deep.x - 60, y: deep.floor, facing: 1 });
    T.drive(s, 1);
    const h0 = h.x, d0 = d.x;
    let top = 0;
    run(s, 2, () => { top = Math.max(top, s.v); });
    check(s.wet > 0.4 && top < T.VMAX * 0.7 && top > T.VMAX * 0.35 && Math.abs(h.x - h0) < 1 && h.wet > 0.1 && h.wet < 0.5 && d.wet > 0.9 && d.x - d0 > 25 && !d.falling,
      `in water: wading in still water ${(s.wet * 100).toFixed(0)}% under, it drives at ${top.toFixed(0)} cells/s of its ${T.VMAX}; in a flood to its hull's waist (${(h.wet * 100).toFixed(0)}% under) it stands (${(h.x - h0).toFixed(1)} cells moved); in one over its turret (${(d.wet * 100).toFixed(0)}% under) it is carried off ${(d.x - d0).toFixed(0)} cells in 2 s`);
    world.tanks.length = 0;
  }
}

// 4d. Struck by what falls on it (N82): a slab of concrete 30 by 20 dropped on it from 160 cells up
// dents its armour and bites its plate; a lump of 8 by 6 only knocks on it; each glances off it and
// comes to rest beside it, not on it nor in it. (The world run: the pieces are pw-fragments'.)
{
  const S = site(500);
  if (!S) check(false, 'a stretch of the wilds for the falling slab');
  else {
    const { x0, g } = S;
    world.tanks.length = 0;
    const a = T.create(world, { style: 'modern', x: x0 + 150, y: g, facing: 1 });
    const b = T.create(world, { style: 'asian', x: x0 + 350, y: g, facing: 1 });
    const block = (cx, top, w, h) => {
      const xs = [], ys = [];
      for (let y = top; y < top + h; y += 1) for (let x = cx - (w >> 1); x < cx - (w >> 1) + w; x += 1) { xs.push(x); ys.push(y); }
      const n = xs.length;
      return { x: Int32Array.from(xs), y: Int32Array.from(ys), color: new Uint32Array(n).fill(PW.abgr(150, 148, 140)), byte: new Uint8Array(n).fill(M.CONCRETE), solid: new Uint8Array(n).fill(1) };
    };
    world.fragments.spawn({ data: block(Math.round(a.x) + 10, g - 160, 30, 20), vx: 0, vy: 0 });
    world.fragments.spawn({ data: block(Math.round(b.x), g - 160, 8, 6), vx: 0, vy: 0 });
    pwApp.stepWorld(60 * 6);
    await view('tank-struck', a.x + 40, g - 30, 6);
    // (what lies over its deck, inside its hull's box, come to rest)
    const lying = new Map();
    const over = (t) => { let n = 0; for (let y = Math.round(t.y) - 30; y < t.y - 2; y += 1) for (let x = Math.round(t.x) - 55; x <= t.x + 55; x += 1) { const m = PW.get(world, x, y) & 63; if (PW.mat.phase[m] >= PW.PHASE.POWDER) { n += 1; lying.set(m, (lying.get(m) || 0) + 1); } } return n; };
    // (and no piece still lying on it)
    const onIt = (t) => world.fragments.list.filter((p) => {
      const c = Math.cos(p.angle), s = Math.sin(p.angle), cx = p.px + p.gx * c - p.gy * s, cy = p.py + p.gx * s + p.gy * c;
      return Math.abs(cx - t.x) < 60 && cy > t.y - 50 && cy < t.y;
    }).length;
    const oa = over(a) + onIt(a) * 100, ob = over(b) + onIt(b) * 100;
    check(a.hp < 100 && a.hp > 40 && a.chipped > 0 && b.hp === 100 && !a.falling && oa < 30 && ob < 10,
      `struck by what falls on it: a slab of concrete 30 by 20 off 160 cells up dents its armour (${(100 - a.hp).toFixed(0)} of it) and chips it; a lump of 8 by 6 only knocks (${(100 - b.hp).toFixed(0)}); both glance off it and come to rest off it (${onIt(a) + onIt(b)} pieces still on them, ${over(a)} and ${over(b)} cells left lying in their hulls' boxes${ob >= 10 ? ` - materials ${[...lying].map(([m, n]) => `${m}:${n}`).join(' ')}, at ${S.x0}, the hulls at ${(a.y - g).toFixed(1)} and ${(b.y - g).toFixed(1)} from the ground, b's angle ${(b.angle / deg).toFixed(1)}, ground under b ${[-50, -25, 0, 25, 50].map((u) => groundAt(Math.round(b.x) + u, g - 20) - g).join('/')}` : ''})`);
    world.tanks.length = 0;
  }
}

// 5. Its own side's buildings it drives right through; an enemy's it rams (N3, N72). A hall of a
// record of the test's own (the left side's: a slab over piers, a flight of stairs, a solid wall in
// it): a tank of the left drives right through all of it - piers, stairs, wall - and none of it is
// touched; with a pier's cells rubble (no longer the building's), even it stops at that. A tank of
// the right rams through it all, crushing what its hull meets.
{
  const G = site(700);
  if (!G) check(false, 'a stretch of the wilds for the hall');
  else {
    const { x0, g } = G, hx = x0 + 330, piers = [hx - 40, hx - 39, hx - 38, hx + 38, hx + 39, hx + 40, hx, hx + 1];
    const rec = { id: world.buildings.length + 1, type: 'test-hall', faction: 'left', side: 'left', ground: g, body: { left: hx - 60, right: hx + 60, top: g - 40, bottom: g - 1 }, gates: piers.map((x) => ({ x, y0: g - 36, y1: g - 1 })) };
    world.buildings.push(rec);
    const own = (x, y, m) => { PW.set(world, x, y, m, { quiet: true }); PW.setOwner(world, x, y, rec.id); };
    for (let x = hx - 60; x <= hx + 60; x += 1) for (let y = g - 40; y <= g - 37; y += 1) own(x, y, M.CONCRETE);   // (the slab over it)
    for (const x of piers) for (let y = g - 36; y <= g - 1; y += 1) own(x, y, M.STEEL);
    for (let d = 0; d < 24; d += 1) own(hx + 8 + d, g - 1 - d, M.PLATFORM);   // (a flight of stairs in it)
    for (let x = hx - 20; x <= hx - 14; x += 1) for (let y = g - 36; y <= g - 1; y += 1) own(x, y, M.CONCRETE);   // (a solid wall across it)
    const owned = () => { let n = 0; for (let y = g - 40; y < g; y += 1) for (let x = hx - 60; x <= hx + 60; x += 1) if (PW.getOwner(world, x, y) === rec.id && PW.mat.phase[PW.get(world, x, y) & 63] >= PW.PHASE.POWDER) n += 1; return n; };
    // (what it crushes tells the building - kept from the structure here: the record is the test's)
    const damage0 = world.onDamage; let told = 0;
    world.onDamage = () => { told += 1; };
    const n0 = owned();
    const friend = T.create(world, { style: 'modern', side: 'left', x: x0 + 120, y: g, facing: 1 });
    T.drive(friend, 1);
    run(friend, 9);
    const through = friend.x > hx + 120 && !friend.falling, n1 = owned();
    world.tanks.length = 0;
    // (a pier fallen - its cells rubble, no longer the building's: even its own side stops at it)
    for (let x = hx + 38; x <= hx + 40; x += 1) for (let y = g - 36; y <= g - 1; y += 1) PW.setOwner(world, x, y, 0);
    const again = T.create(world, { style: 'modern', side: 'left', x: x0 + 120, y: g, facing: 1 });
    T.drive(again, 1);
    run(again, 9);
    const short = (hx + 38) - (again.x + 58), at = again.stopAt ? again.stopAt[0] - hx : null;
    world.tanks.length = 0;
    for (let x = hx + 38; x <= hx + 40; x += 1) for (let y = g - 36; y <= g - 1; y += 1) PW.setOwner(world, x, y, rec.id);
    const n2 = owned();
    const foe = T.create(world, { style: 'gothic', side: 'right', x: x0 + 120, y: g, facing: 1 });
    T.drive(foe, 1);
    let slowest = Infinity;
    run(foe, 14, () => { if (foe.x > hx - 50 && foe.x < hx + 40) slowest = Math.min(slowest, Math.abs(foe.v)); });
    await view('tank-rams-hall', hx, g - 30, 6);
    const crushed = n2 - owned();
    check(through && n1 === n0 && again.v === 0 && short >= 0 && short < 12 && at === 38 && crushed > 150 && foe.rammed > 150 && told > 0 && slowest < T.VMAX * 0.5 && foe.x > hx + 60,
      `its own side's building it drives right through - slab, piers, stairs, a solid wall in its way - touching none of it (${through ? `out the far side, ${(friend.x - hx).toFixed(0)} past its middle` : `stopped at ${(friend.x - hx).toFixed(0)}: ${friend.blocked}`}; ${n0 - n1} cells of it gone); a pier fallen to rubble stops even it (${again.blocked || 'not stopped'}, ${short.toFixed(0)} cells off); an enemy's it rams, crushing what its hull meets - ${crushed} cells of piers, stairs and wall - grinding through at ${slowest.toFixed(0)} cells/s at the slowest and on out the far side (${(foe.x - hx).toFixed(0)} past its middle)`);
    world.tanks.length = 0;
    world.onDamage = damage0;
    for (let x = hx - 60; x <= hx + 60; x += 1) for (let y = g - 40; y <= g - 1; y += 1) PW.setOwner(world, x, y, 0);
    world.buildings.splice(world.buildings.indexOf(rec), 1);
  }
}

// 5b. Loose debris it drives over is flattened under its tracks: a heap of rubble 20 cells high in
// its way is pressed into a thin hard layer of rubble, and it drives on.
{
  const D = site(500);
  if (!D) check(false, 'a stretch of the wilds for the heap');
  else {
    const { x0, g } = D, hx = x0 + 260;
    for (let x = hx - 40; x <= hx + 40; x += 1) for (let y = g - 20 + Math.round(Math.abs(x - hx) / 2); y < g; y += 1) PW.set(world, x, y, M.DEBRIS, { quiet: true });
    const t = T.create(world, { style: 'asian', x: x0 + 110, y: g, facing: 1 });
    T.drive(t, 1);
    run(t, 8);
    let debris = 0, rubble = 0, top = g;
    for (let x = hx - 40; x <= hx + 40; x += 1) for (let y = g - 25; y < g; y += 1) {
      const id = PW.get(world, x, y) & 63;
      if (id === M.DEBRIS) debris += 1;
      if (id === M.RUBBLE) { rubble += 1; top = Math.min(top, y); }
    }
    check(t.x > hx + 120 && debris === 0 && rubble > 50 && g - top <= 8 && t.flattened > 300,
      `loose debris it drives over is flattened: a heap 20 cells high in its way pressed into a layer of rubble ${g - top} cells thick (${rubble} cells of it, ${debris} of the heap left loose; ${t.flattened} cells pressed), and it drives on (${(t.x - hx).toFixed(0)} past it)`);
    world.tanks.length = 0;
  }
}

// 5c. Road tunnels and their barricades (N104, the user's: a mountain road tunnel takes vehicles, a
// miners' tunnel only men; the boring side's units pass its barricades, an enemy's must run them
// over or blow them apart). A tank drives into a road tunnel and through it, and stops at the mouth
// of a miners' tunnel; across the road, its own side's barricade it drives through untouched and
// at its pace, another side's it runs over, slowed; a man of the barricade's side walks through
// it, one of the other side is stopped by it. (The road tunnel's record is laid as WGM's are: its
// way from a to b, over its floor - see PW.roadTunnels.onRoad.)
{
  if (!PW.troops) await new Promise((resolve) => { const s = document.createElement('script'); s.src = 'scripts/pw/pw-troops.js'; s.onload = s.onerror = resolve; document.head.appendChild(s); });
  const R = site(900), B = site(900);
  if (!R || !B) check(false, 'stretches of the wilds for the road tunnel and the barricades');
  else {
    const stub = !PW.roadTunnels;
    if (stub) PW.roadTunnels = { onRoad: (w, x, y) => (w.roadTunnels || []).find((r) => x >= r.a && x <= r.b && y <= r.floorAt(x) && y > r.floorAt(x) - 96) || null };
    const roads0 = world.roadTunnels, bars0 = world.barricades;
    // (two tunnels 70 high through blocks of stone 200 long: the first a road tunnel, the second a miners')
    const { x0, g } = R;
    for (const at of [x0 + 250, x0 + 650]) {
      fill(at, g - 110, at + 200, g - 1, M.STONE);
      fill(at, g - 70, at + 200, g - 1, M.AIR);
      for (let x = at; x <= at + 200; x += 1) for (let y = g - 70; y < g; y += 1) PW.setFlag(world, x, y, PW.FLAG.TUNNEL);
    }
    world.roadTunnels = [...(roads0 || []), { id: 'n104-course', a: x0 + 250, b: x0 + 450, floorAt: () => g, side: null, done: true, portals: [], barricades: [] }];
    const t = T.create(world, { style: 'modern', x: x0 + 120, y: g, facing: 1, side: 'left' });
    T.drive(t, 1);
    let inRoad = false;
    run(t, 16, () => { if (t.x > x0 + 300 && t.x < x0 + 400) inRoad = true; });
    const short = x0 + 650 - t.x - 58;
    if (inRoad) await view('tank-road-tunnel', x0 + 500, g - 50, 4);
    world.tanks.length = 0;
    // (two barricades across the road - a jersey block and a steel hedgehog each, a tunnel network's
    // cells: the left side's, then the right side's)
    const { x0: b0, g: bg } = B, bars = [];
    for (const [at, side] of [[b0 + 300, 'left'], [b0 + 600, 'right']]) {
      const bar = { id: `n104-${side}`, side, x0: at, x1: at + 25, y0: bg - 12, y1: bg - 1, cells: [] };
      const put = (x, y, m) => { PW.set(world, x, y, m, { quiet: true }); PW.setOwner(world, x, y, 50990); bar.cells.push(y * world.width + x); };
      for (let h = 0; h < 12; h += 1) for (let dx = h < 4 ? 0 : 2; dx < (h < 4 ? 12 : 10); dx += 1) put(at + dx, bg - 1 - h, M.CONCRETE);
      for (let k = 0; k < 12; k += 1) { put(at + 14 + k, bg - 1 - k, M.STEEL); put(at + 25 - k, bg - 1 - k, M.STEEL); }
      bars.push(bar);
    }
    world.barricades = [...(bars0 || []), ...bars];
    const standing = (bar) => bar.cells.filter((i) => { const id = world.mat[i] & 63; return id === M.CONCRETE || id === M.STEEL; }).length;
    const n0 = bars.map(standing);
    const u = T.create(world, { style: 'asian', x: b0 + 120, y: bg, facing: 1, side: 'left' });
    T.drive(u, 1);
    let throughOwn = Infinity, ramming = Infinity;
    run(u, 18, () => {
      if (u.x + 58 > b0 + 300 && u.x - 58 < b0 + 326) throughOwn = Math.min(throughOwn, Math.abs(u.v));
      if (u.x + 58 > b0 + 600 && u.x - 58 < b0 + 626) ramming = Math.min(ramming, Math.abs(u.v));
    });
    const n1 = bars.map(standing);
    await view('tank-barricades', b0 + 600, bg - 20, 5);
    world.tanks.length = 0;
    // (men: one of each side walking at the left side's barricade, still standing)
    const U = PW.troops;
    let manOwn = null, manOther = null;
    if (U) {
      const k0 = world.troops ? world.troops.length : 0;
      const a = U.create(world, { x: b0 + 250.5, y: bg - 1, side: 'left' }), z = U.create(world, { x: b0 + 250.5, y: bg - 1, side: 'right' });
      U.walk(a, 1); U.walk(z, 1);
      for (let k = 0; k < 4 * 60; k += 1) U.step(world, DT);
      manOwn = a.x - (b0 + 326); manOther = b0 + 300 - z.x;
      world.troops.splice(k0);
    }
    world.roadTunnels = roads0; world.barricades = bars0;
    if (stub) delete PW.roadTunnels;
    check(inRoad && t.x > x0 + 450 && t.blocked === 'tunnel' && short >= 0 && short < 16,
      `a tank drives into a road tunnel and through it (${inRoad ? `out past its far portal by ${(t.x - x0 - 450).toFixed(0)} cells` : 'never in it'}) and stops at the mouth of a miners' tunnel (${t.blocked || 'went on'}, its nose ${short.toFixed(0)} cells off)`);
    check(n1[0] === n0[0] && throughOwn > T.VMAX * 0.95 && n1[1] < n0[1] * 0.2 && ramming < T.VMAX * 0.6 && u.x > b0 + 700,
      `across the road its own side's barricade it drives through untouched (${n1[0]} of its ${n0[0]} cells standing, ${throughOwn.toFixed(0)} cells/s at the slowest); another side's it runs over (${n0[1] - n1[1]} of its ${n0[1]} cells crushed, slowed to ${ramming.toFixed(0)} cells/s, on ${(u.x - b0 - 626).toFixed(0)} past it)`);
    check(U && manOwn > 0 && manOther >= 0 && manOther < 8,
      `a man of the barricade's side walks through it (${manOwn === null ? 'no troops' : `${manOwn.toFixed(0)} cells past it`}); one of the other side is stopped by it (${manOther === null ? '-' : `${manOther.toFixed(0)} cells short`})`);
  }
}

// 5d. Through a wood (N105, the user's): a tank drives through a stand of eight trees and goes by
// most of them - they stand untouched - knocking over only those in its way, and keeps its pace.
{
  const W8 = site(880);
  if (!W8 || !PW.flora) check(false, 'a stretch of the wilds for the wood');
  else {
    // (eight trees 70 apart - a falling one mostly clear of the next - set along until just two stand in a tank's way - one in
    // five does, each tree its own)
    const { x0, g } = W8, kinds = ['broadleaf', 'conifer', 'birch'];
    let trees = [];
    for (let shift = 0; shift < 40; shift += 1) {
      const want = Array.from({ length: 8 }, (_, k) => ({ anchorX: x0 + 230 + k * 70 + shift, row: g }));
      if (want.filter(T.treeInWay).length === 2) { trees = want.map((w, k) => PW.flora.plant(world, kinds[k % 3], w.anchorX, { row: g, size: 96 + (k % 3) * 12, seed: 977 + k * 31 })); break; }
    }
    // (a tree's own cells, by the mask it was drawn with - its crown overlaps its neighbours' boxes)
    const cellsOf = (r) => {
      let n = 0;
      for (let sy = 0; sy < r.height; sy += 1) for (let sx = 0; sx < r.width; sx += 1) {
        const k = sy * r.width + sx;
        if (r.mask && (r.mask[k >> 3] >> (k & 7) & 1) && PW.getLayer(world, 'deco', r.x + sx, r.y + sy) && (PW.getFlags(world, r.x + sx, r.y + sy) & PW.FLAG.FLORA)) n += 1;
      }
      return n;
    };
    const n0 = trees.map(cellsOf);
    const t = T.create(world, { style: 'modern', x: x0 + 110, y: g, facing: 1 });
    T.drive(t, 1);
    let slowest = Infinity;
    // (the world stepped, not the tanks alone: a tree it strikes comes down by the plants' own step)
    for (let k = 0; k < 18 * 60; k += 1) { pwApp.stepWorld(1); if (t.x > x0 + 280 && t.x < x0 + 760) slowest = Math.min(slowest, Math.abs(t.v)); }
    const n1 = trees.map(cellsOf);
    // (knocked over: its trunk snapped or the whole of it down; standing: neither, and the most of it
    // there still - a neighbour coming down past it may take a few of its twigs)
    const inWay = trees.map(T.treeInWay), hit = trees.map((r, k) => !!r.felled || n1[k] < n0[k] * 0.5);
    const standing = hit.filter((h, k) => !h && n1[k] >= n0[k] * 0.75).length, knocked = hit.filter(Boolean).length;
    // (every one in its way down; any other down only by a neighbour falling on it - a tree coming
    // down can bring down the next - and most standing)
    const asRuled = inWay.every((w, k) => !w || hit[k]) && standing >= trees.length - 3;
    await view('n105-tank-through-wood', x0 + 560, g - 80, 3);
    // (over the trunks it brought down it slows a little, pressing them flat)
    check(trees.length === 8 && t.x > x0 + 820 && knocked >= 2 && knocked <= 3 && asRuled && slowest > T.VMAX * 0.6,
      `through a wood of ${trees.length} trees a tank goes by most of them - ${standing} stand untouched - and knocks over those in its way (${inWay.filter(Boolean).length}; ${knocked} down in all, a neighbour or so brought down by one falling) (${asRuled ? 'as ruled' : `not as ruled: ${trees.map((r, k) => `${inWay[k] ? 'W' : '-'}${r.rammed ? 'r' : ''}${r.felled ? 'f' : ''}${Math.round(100 * n1[k] / Math.max(1, n0[k]))}`).join(' ')}`}), at its pace (${slowest === Infinity ? '-' : slowest.toFixed(0)} cells/s at the slowest of its ${T.VMAX})`);
    world.tanks.length = 0;
  }
}

// 5e. Where a unit comes up (N131, the user's rule: troopers, mechs and tanks only at a military
// building's core spawner - WGM's N130 hands its point on): a base's hall cut into the rock, its core
// spawner's point in it. PW.units.spawnPoint, asked for a tank, a mech and a man there, gives the
// hall's floor - not the ground's top over the rock - and each made there stands in the hall; asked
// where there is only solid rock round the point, it gives nothing, and the deploy is refused.
{
  if (!PW.units) await new Promise((resolve) => { const s = document.createElement('script'); s.src = 'scripts/pw/pw-units.js'; s.onload = s.onerror = resolve; document.head.appendChild(s); });
  for (const [m, src] of [['troops', 'pw-troops'], ['mechs', 'pw-mechs']]) if (!PW[m]) await new Promise((resolve) => { const s = document.createElement('script'); s.src = `scripts/pw/${src}.js`; s.onload = s.onerror = resolve; document.head.appendChild(s); });
  const R = site(700);
  if (!R || !PW.units || !PW.units.spawnPoint) check(false, 'a stretch of the wilds and PW.units.spawnPoint for the spawn');
  else {
    const { x0, g } = R, mx = x0 + 350;
    // (a mountain 500 wide and 240 high, a hall 200 wide and 70 high in its foot)
    for (let x = x0 + 100; x <= x0 + 600; x += 1) { const h = Math.round(240 * (1 - Math.abs(x - mx) / 250)); fill(x, g - h, x, g - 1, M.STONE); }
    fill(mx - 100, g - 70, mx + 100, g - 1, M.AIR);
    let top = 0; while (top < g && !(PW.mat.phase[PW.get(world, mx, top) & 63] >= PW.PHASE.POWDER)) top += 1;
    const spT = PW.units.spawnPoint(world, 'tank', mx, g - 30), spM = PW.units.spawnPoint(world, 'mech', mx, g - 30), spR = PW.units.spawnPoint(world, 'trooper', mx, g - 30);
    const rock = PW.units.spawnPoint(world, 'tank', mx, g - 150);
    const t = spT && T.create(world, { style: 'modern', x: spT.x, y: spT.y, facing: 1 });
    if (t) run(t, 1);
    const mm = spM && PW.mechs && PW.mechs.create(world, { x: spM.x + 0.5, y: spM.y, side: 'left', facing: 1 });
    const tr = spR && PW.troops && PW.troops.create(world, { x: spR.x + 0.5, y: spR.y, side: 'left', facing: 1 });
    const inRoom = (y) => y > g - 70 && y <= g;
    await view('n131-spawn-in-the-mountain', mx, g - 90, 4);
    check(spT && spT.y === g && t && inRoom(t.y) && !t.falling && spM && spM.y === g - 1 && mm && inRoom(mm.y) && spR && spR.y === g - 1 && tr && inRoom(tr.y) && rock === null && top < g - 200,
      `where a unit comes up - at its core spawner, in a base's hall cut into the rock (the ground's top ${g - top} cells over the hall's floor): a tank, a mech and a man are given the hall's floor (${spT ? g - spT.y : '-'}, ${spM ? g - 1 - spM.y : '-'}, ${spR ? g - 1 - spR.y : '-'} off it) and stand in the hall (${t ? g - Math.round(t.y) : '-'} / ${mm ? g - 1 - Math.round(mm.y) : '-'} / ${tr ? g - 1 - Math.round(tr.y) : '-'}), never on the rock over it; with only solid rock round the point, nothing - the deploy refused (${rock ? `${rock.x},${rock.y}` : 'none'})`);
    world.tanks.length = 0;
    if (world.mechs) world.mechs.length = 0;
    if (world.troops) world.troops.length = 0;
  }
}

// 4. What it costs: one tank's tick, and drawing it.
{
  const D = used.length ? used[0] : null;
  if (D) {
    // (by hand: a click on a building's roof drops nothing; a click drops one on the ground under
    // it, D drives it right, a click lays its gun)
    const house = world.buildings.find((b) => b.body && b.body.right - b.body.left > 40);
    const onRoof = house ? T.tool(world, Math.round((house.body.left + house.body.right) / 2), house.body.top - 10) : null;
    const hx = D[0] + 320, hg = world.groundTop[hx];
    const h = T.tool(world, hx, hg - 150);
    const placed = !!h && Math.abs(h.y - hg) < 1 && T.held() === h;
    T.key({ code: 'KeyD' });
    run(h, 2.5);
    const drove = placed && h.facing === 1 && h.x > hx + 20;
    T.tool(world, h.x + 300, h.y - 140);
    run(h, 1.5);
    const laid = placed && h.target && h.elevation > 15 * deg, shot = placed && h.reload > 0;
    T.key({ code: 'KeyS' });
    check(house && !onRoof && placed && drove && laid && shot, `by hand: a click on a roof drops nothing (${!house ? 'no building' : onRoof ? 'a tank on the roof' : 'nothing'}), a click drops a tank on the ground under it (${placed ? 'on it' : 'not placed'}), D drives it off (${drove ? `${(h.x - hx).toFixed(0)} cells in 2.5 s` : 'did not'}), a click lays its gun on the spot (${laid ? `${(h.elevation / deg).toFixed(0)} deg up` : 'not laid'}) and fires (N102: ${shot ? 'loading the next' : 'not fired'})`);
    // (selected some other way - N78's selection - a tank is the one in hand: the keys drive it;
    // let go, the one in hand's gun goes back to level ahead and the keys drive none)
    const other = T.create(world, { style: 'asian', x: h.x + 260, y: world.groundTop[Math.round(h.x + 260)], facing: -1 });
    const took = T.hold(other) === other && T.held() === other && h.target === null;
    const keyed = T.key({ code: 'KeyA' }) && other.drive === -1 && h.drive === 0;
    T.aimAt(other, other.x - 300, other.y - 100);
    const let_go = T.hold(null) === null && T.held() === null && other.target === null && T.key({ code: 'KeyD' }) === false;
    check(took && keyed && let_go, `a tank selected by another hand (PW.tanks.hold) is the one in hand - the one before it let go, its gun level (${took}), the keys drive it (${keyed}) - and let go, its gun goes level and the keys drive none (${let_go})`);
    // (N102, the user's controls: it drives while D is held and stops when it is let go; a left
    // click lays its gun on the spot and fires the round it has up, a right click the other round)
    world.tanks = world.tanks.filter((q) => q === h);
    T.hold(h);
    T.aimAt(h, null);
    const hx0 = h.x;
    T.key({ code: 'KeyD', type: 'keydown' });
    run(h, 1.5);
    const went = h.x - hx0;
    T.key({ code: 'KeyD', type: 'keyup' });
    run(h, 2);
    const stopped = h.drive === 0 && Math.abs(h.v) < 1;
    const kinds = [], fireWas = PW.shots.fire;
    PW.shots.fire = function (w, spec) { if (spec.from === h) kinds.push(spec.kind); return fireWas.call(this, w, spec); };
    const up = h.ammo, theOther = up === 'he' ? 'ap' : 'he';
    T.click(world, h.x + 420, h.y - 60, 0);
    run(h, 2.5);
    T.click(world, h.x + 420, h.y - 60, 2);
    run(h, 4.5);
    PW.shots.fire = fireWas;
    T.hold(null);
    check(went > 20 && stopped && kinds.length === 2 && kinds[0] === up && kinds[1] === theOther && h.ammo === up,
      `by hand: it drives while D is held (${went.toFixed(0)} cells in 1.5 s) and stops when it is let go (${stopped}); a left click lays its gun and fires the round it has up (${kinds[0] || 'none'}), a right click the other round (${kinds[1] || 'none'}), its own still up (${h.ammo})`);
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
// 6. In the world's own towns (N72): a tank of a building's side drives through it, untouched; an
// enemy's tank rams a farm and shoves it over the way it drives; one ramming a tower smashes its
// ground floor and the tower stands. (Each from a causeway laid level at the building's grade, from
// whichever side of it no other building stands on.)
{
  const RUN = 140;
  // (which way it can be come at: the stretch beside it with no other's body in it)
  const approach = (b) => {
    for (const dir of [1, -1]) {
      const a = dir > 0 ? b.body.left - RUN : b.body.right + 1, z = a + RUN - 1;
      if (!world.buildings.some((o) => o && o !== b && o.body && o.body.right >= a && o.body.left <= z)) return { dir, a, z };
    }
    return null;
  };
  // (the hill and the works set into it there - a cut's retaining wall, its steps, a neighbour's
  // berm - cleared down to its grade: ground to a tank, they would stand in its way as the hill would)
  const causeway = (b, { a, z }) => {
    const gr = b.ground;
    for (let x = a; x <= z; x += 1) {
      for (let y = gr - 60; y < gr; y += 1) { PW.set(world, x, y, M.AIR, { quiet: true }); PW.setOwner(world, x, y, 0); PW.setLayer(world, 'deco', x, y, 0); }
      for (let y = gr; y <= gr + 6; y += 1) { PW.set(world, x, y, M.STONE, { quiet: true }); PW.setOwner(world, x, y, 0); }
    }
  };
  const frame = (b) => { let n = 0; for (let y = b.body.top; y < b.ground; y += 2) for (let x = b.body.left; x <= b.body.right; x += 2) if (PW.getOwner(world, x, y) === b.id) n += 1; return n; };
  const sideOf = (b) => b.faction || b.side;
  const whole = (b) => b && b.body && !b.ruined && !b.underConstruction && sideOf(b) && b.ground && approach(b);
  // (the tallest last: a house a tank may shove over as it does a farm - a tower it can't)
  const towers = world.buildings.filter((b) => whole(b) && b.type === 'population').sort((a, b) => (a.ground - a.body.top) - (b.ground - b.body.top));
  const farm = world.buildings.find((b) => whole(b) && b.type === 'farm');
  // (driving at b from its open side until its nose is out through the far wall, or for secs)
  const through = (b, t) => (t.facing > 0 ? t.x + 58 > b.body.right : t.x - 58 < b.body.left);
  const drive = (b, side, secs, each) => {
    world.tanks.length = 0;
    const ap = approach(b);
    causeway(b, ap);
    const t = T.create(world, { style: 'modern', side, x: ap.dir > 0 ? ap.a + 60 : ap.z - 60, y: b.ground, facing: ap.dir });
    T.drive(t, ap.dir);
    for (let k = 0; k < secs * 60 && !through(b, t); k += 1) { pwApp.stepWorld(1); if (each) each(t); }
    return t;
  };
  // (one tower will do - its own side through it first, then another's ramming it: the world has 4 sites now)
  if (towers.length < 1 || !farm) check(false, `towers and a farm to drive at (${towers.length} towers, ${farm ? 1 : 0} farm)`);
  else {
    // (through its own side's tower)
    const own = towers[0], f0 = frame(own);
    const friend = drive(own, sideOf(own), 12);
    const passed = through(own, friend), f1 = frame(own);
    // (ramming an enemy's farm: shoved over the way it drives - its pieces let go a moment after it
    // fails going the tank's way, all told: their weight's speed along it in the second after - one
    // landing on the tank slides back off it, as off a car's roof: see pw-fragments' glance)
    const fails0 = (farm.failures || []).length;
    let shoved = null, dir = 0;
    const watch = (t) => {
      dir = t.facing;
      if (!shoved && (farm.failures || []).length > fails0) shoved = { reason: farm.failures[fails0], vx: 0, mean: 0, ticks: 0 };
      if (!shoved || shoved.ticks++ > 60) return;
      let m = 0, mv = 0;
      for (const p of (world.fragments ? world.fragments.list : [])) if (p.owner === farm.id) { shoved.vx = Math.max(shoved.vx, p.vx * dir); m += p.mass; mv += p.mass * p.vx * dir; }
      if (m && Math.abs(mv / m) > Math.abs(shoved.mean)) shoved.mean = mv / m;
    };
    const raider = drive(farm, 'raiders', 10, watch);
    for (let k = 0; k < 60 * 3; k += 1) { pwApp.stepWorld(1); watch(raider); }
    await view('tank-shoves-farm', (farm.body.left + farm.body.right) / 2, farm.ground - 60, 5);
    // (ramming an enemy's tower: its ground floor smashed, the tower standing)
    const tower = towers[towers.length - 1], tf0 = (tower.failures || []).length;
    const rammer = drive(tower, 'raiders', 14);
    pwApp.stepWorld(60 * 2);
    const towerFell = (tower.failures || []).slice(tf0).includes('swept');
    const how = towerFell ? (tower.failed || []).filter((f) => f.reason === 'swept').pop() : null;
    world.tanks.length = 0;
    // (none of the tower's cells crushed by it - though the town may build on while it drives)
    check(passed && !friend.rammed && f1 >= f0 && shoved && shoved.reason === 'swept' && shoved.vx > 10 && shoved.mean > 5 && rammer.rammed > 100 && !towerFell,
      `in the world's towns: a tank of a tower's side drives right through it (${passed ? 'its nose out through the far wall' : `stopped short: ${friend.blocked}`}, ${friend.rammed || 0} of its cells crushed); an enemy's rams a farm and shoves it over the way it drives (${shoved ? `${shoved.reason}, its pieces going ${shoved.mean.toFixed(0)} cells/s the tank's way all told, the fastest ${shoved.vx.toFixed(0)}` : 'it stood'}); one ramming a tower (${tower.ground - tower.body.top} cells tall) smashes ${rammer.rammed || 0} cells of its ground floor and the tower stands (${towerFell ? `it went over: pushed ${how && how.push} against ${how && how.holds}, ${how && tower.ground - how.y} up, ${how && how.load} over it` : 'standing'})`);
  }
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
