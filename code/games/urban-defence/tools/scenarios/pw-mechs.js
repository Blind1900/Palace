// Mechs (N90; run with --page=pixel-world.html --params=det=1&seed=N): a hopper striding over the
// ground - up a step, stopped by a wall, leaping it; boosting up a cliff higher than it leaps; landing
// hard from a height; seeing a round coming and dodging it - not again straight after, and not one
// from behind; its cannon and missile; destroyed - falling apart burning, no blast. Over courses laid
// in the wilds, cleared to the sky; the units and their rounds stepped (the world where it matters).
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
const load = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`${src} did not load`)); document.head.appendChild(s); });
for (const [name, src] of [['troops', 'pw-troops'], ['jets', 'pw-jets'], ['mechs', 'pw-mechs']]) if (!PW[name]) await load(`scripts/pw/${src}.js`);
pwApp.setPaused(true);
const X = PW.mechs, T = PW.tanks, DT = 1 / 60;
const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); } };
const used = [];
// (a stretch of the wilds len long: cleared to `sky` cells over its lowest ground, laid flat in stone)
function site(len, sky = 700) {
  for (const zone of layout.wilds) for (let x = zone.x0 + 60; x + len < zone.x1 - 60; x += 40) {
    if (used.some(([a, b]) => x < b + 60 && x + len > a - 60)) continue;
    const tops = Array.from({ length: len + 1 }, (_, d) => world.groundTop[x + d]);
    const g = Math.min(...tops);
    if (Math.max(...tops) - g > 80 || g - sky < 20) continue;
    used.push([x, x + len]);
    fill(x, Math.max(1, g - sky), x + len, g - 1, M.AIR);
    for (let xx = x; xx <= x + len; xx += 1) for (let y = g; y <= world.groundTop[xx] + 3 || y <= g + 30; y += 1) PW.set(world, xx, y, M.STONE, { quiet: true });
    return { x0: x, g };
  }
  return null;
}
// (units and rounds: the tanks' step steps the mechs and the rounds too)
const run = (secs, each) => { for (let k = 0; k < Math.round(secs / DT); k += 1) { T.step(world, DT); if (each && each(k) === false) break; } };
const fresh = () => { world.mechs = []; world.tanks = []; world.troops = []; world.jets = []; world.shots = []; };

// 1. Striding: up a 14-cell step on its legs; a 60-cell wall stops it - it leaps it, landing beyond.
{
  const S = site(900);
  if (!S) check(false, 'a stretch of the wilds for the walk');
  else {
    const { x0, g } = S;
    fill(x0 + 300, g - 14, x0 + 899, g - 1, M.STONE);              // a step up, 14 cells
    fill(x0 + 560, g - 14 - 60, x0 + 570, g - 15, M.STONE);         // a wall on it, 60 tall
    fresh();
    const m = X.create(world, { x: x0 + 120, side: 'left', facing: 1, style: 'gothic' });
    X.walk(m, 1);
    let stepped = false, stopAt = null;
    run(2);
    await view('mech-striding', m.x, m.y - 40, 6);
    run(6, () => { if (m.y <= g - 15) stepped = true; if (stopAt === null && m.x > x0 + 500 && Math.abs(m.vx) < 1 && m.onGround) stopAt = m.x; });
    const atWall = m.x;
    X.leap(m);
    let top = m.y;
    run(4, () => { top = Math.min(top, m.y); });
    await view('mech-leapt', m.x, m.y - 60, 4);
    check(stepped && stopAt !== null && atWall < x0 + 560 - X.HALF + 2 && m.x > x0 + 571 + X.HALF && m.onGround && m.hp === X.ARMOUR,
      `a mech strides up a 14-cell step (${stepped}), a 60-cell wall stops it (${stopAt !== null ? `${(x0 + 560 - atWall).toFixed(0)} cells off it` : 'not stopped'}) - it leaps it (${(g - 15 - top).toFixed(0)} cells up) and lands beyond it unhurt (${(m.x - x0 - 571).toFixed(0)} past it, armour ${m.hp.toFixed(0)})`);
  }
}

// 2. Boosting: at the foot of a cliff higher than it leaps, a leap and its jets carry it up on to the
// top; its fuel spent, it fills again on the ground.
{
  const S = site(700, 900);
  if (!S) check(false, 'a stretch of the wilds for the cliff');
  else {
    const { x0, g } = S;
    const H = 300;
    fill(x0 + 320, g - H, x0 + 699, g - 1, M.STONE);               // a cliff, 300 cells
    fresh();
    const m = X.create(world, { x: x0 + 280, side: 'left', facing: 1, style: 'modern' });
    X.walk(m, 1);
    run(0.6);
    X.leap(m);
    let boosted = false, low = Infinity;
    // (on top, it stops there)
    run(6, () => { if (!boosted && !m.onGround && m.vy > -80) { X.boost(m); boosted = true; } low = Math.min(low, m.fuel); if (m.onGround && m.y <= g - H + 1) X.walk(m, 0); });
    const onTop = m.onGround && m.y <= g - H - 1 + 2 && m.x > x0 + 320 + X.HALF;
    run(3);
    await view('mech-on-cliff', m.x, m.y - 60, 4);
    check(onTop && low < 0.3 && m.fuel > low + 1,
      `a leap and its jets carry it up a ${H}-cell cliff, higher than it leaps (${onTop ? 'on top' : `at ${(g - m.y).toFixed(0)} cells up, ${m.onGround ? 'on the ground' : 'in the air'}`}); its fuel spent (${low.toFixed(2)} s left at the least), it fills again on the ground (${m.fuel.toFixed(2)} s)`);
  }
}

// 3. Landing: from a leap, unhurt; dropped from 600 cells it lands hurt - not destroyed - shaking the
// ground.
{
  const S = site(400, 800);
  if (!S) check(false, 'a stretch of the wilds for the drop');
  else {
    const { x0, g } = S;
    fresh();
    const m = X.create(world, { x: x0 + 200, y: g - 1 - 600, side: 'left' });
    m.onGround = false;
    let vLand = 0;
    run(4, () => { if (!m.onGround) vLand = m.vy; });
    check(m.onGround && m.hp < X.ARMOUR && m.hp > 0 && vLand > X.FALL_SAFE && X.stats.hurtLanding >= 1,
      `dropped from 600 cells it comes down at ${vLand.toFixed(0)} cells/s and lands hurt, on its legs (armour ${m.hp.toFixed(0)}); from a leap it lands unhurt (see the wall's)`);
  }
}

// 4. Dodging: an armour-piercing round fired at it from in front, 900 cells off - it sees it and leaps
// it; a second straight after, its dodge not ready again, strikes it; one from behind it does not see.
{
  const S = site(1400);
  if (!S) check(false, 'a stretch of the wilds for the dodging');
  else {
    const { x0, g } = S;
    fresh();
    const m = X.create(world, { x: x0 + 300, side: 'left', facing: 1, style: 'asian' });
    run(0.2);
    const at = (u) => [u.x, u.y - X.HEIGHT / 2];
    const shoot = (u, from) => { const [tx, ty] = at(u); return PW.shots.fire(world, { kind: 'ap', x: tx + from, y: ty, dx: -Math.sign(from), dy: 0, side: 'right' }); };
    const d0 = X.stats.dodged;
    shoot(m, 900);
    run(0.5);
    const hp1 = m.hp, dodged = X.stats.dodged - d0;
    shoot(m, 600);
    run(0.4);
    const hp2 = m.hp;
    run(3);
    // (one from behind - the first mech gone, nothing between)
    world.mechs = []; world.shots = [];
    const b = X.create(world, { x: x0 + 1100, side: 'left', facing: 1, style: 'asian' });
    run(0.2);
    shoot(b, -900);
    run(0.5);
    check(dodged === 1 && hp1 === X.ARMOUR && hp2 < hp1 && b.hp < X.ARMOUR && X.stats.dodged - d0 === 1,
      `it sees a round coming at it from in front and leaps it (${dodged} dodge, armour ${hp1.toFixed(0)}); a second straight after strikes it (${(hp1 - hp2).toFixed(0)} off its armour), its dodge not ready again; one from behind it does not see (${(X.ARMOUR - b.hp).toFixed(0)} off another's)`);
  }
}

// 5. Fighting: its cannon's burst strikes a tank 400 cells off; its missile strikes another.
{
  const S = site(1400);
  if (!S) check(false, 'a stretch of the wilds for the fighting');
  else {
    const { x0, g } = S;
    fresh();
    const m = X.create(world, { x: x0 + 200, side: 'left', facing: 1, style: 'gothic' });
    const a = T.create(world, { style: 'asian', side: 'right', x: x0 + 600, y: g, facing: -1 });
    const b = T.create(world, { style: 'modern', side: 'right', x: x0 + 1100, y: g, facing: -1 });
    run(0.2);
    m.aim = { x: a.x, y: a.y - 14 };
    X.fire(world, m);
    run(1.5);
    m.aim = { x: b.x, y: b.y - 14 };
    X.launch(world, m);
    run(4);
    await view('mech-fighting', x0 + 600, g - 80, 2);
    check(a.hp < 100 && b.hp < 100 && X.stats.fired >= 8,
      `its cannon's burst strikes a tank 400 cells off (${(100 - a.hp).toFixed(0)} off its armour); its missile strikes another 900 off (${(100 - b.hp).toFixed(0)})`);
    fresh();
  }
}

// 6. Destroyed: its armour gone it falls apart where it stands, burning - its wreck's pieces thrown
// down, flames, a wreck's fire left - and no blast: not a cell of the ground round it broken.
{
  const S = site(500);
  if (!S) check(false, 'a stretch of the wilds for the wreck');
  else {
    const { x0, g } = S;
    fresh();
    const m = X.create(world, { x: x0 + 250, side: 'left', style: 'modern' });
    run(0.2);
    const solid = () => { let n = 0; for (let y = g - 80; y <= g + 20; y += 1) for (let x = x0 + 170; x <= x0 + 330; x += 1) if (!PW.mat.open[PW.get(world, x, y) & PW.ID_MASK]) n += 1; return n; };
    const s0 = solid(), frags0 = world.fragments ? world.fragments.list.length : 0, w0 = (world.wrecks || []).length;
    X.hurt(world, m, 500, 'test');
    const frags = world.fragments ? world.fragments.list.length - frags0 : 0, wrecks = (world.wrecks || []).length - w0;
    for (let k = 0; k < 60; k += 1) pwApp.stepWorld(1);
    await view('mech-wreck', x0 + 250, g - 40, 4);
    const s1 = solid();
    check(m.dead && frags > 0 && wrecks === 1 && s1 >= s0 && !(world.mechs || []).includes(m),
      `destroyed, it falls apart where it stands (${frags} wreck pieces), its wreck burning (${wrecks}), and no blast: the ground round it whole (${s0} solid cells before, ${s1} after - its wreck's pieces among them)`);
  }
}

// 7. What they cost: four mechs striding, a tick; and drawing them.
{
  fresh();
  const S = site(1200);
  if (S) {
    const { x0, g } = S;
    for (let k = 0; k < 4; k += 1) X.walk(X.create(world, { x: x0 + 150 + k * 250, side: 'left', facing: 1, style: ['modern', 'asian', 'gothic'][k % 3] }), 1);
    run(0.5);
    const best = (n, m, work) => { let min = Infinity; for (let b = 0; b < n; b += 1) { const t0 = performance.now(); for (let q = 0; q < m; q += 1) work(); min = Math.min(min, (performance.now() - t0) / m); } return min; };
    const r = { ctx: document.createElement('canvas').getContext('2d'), world, camera: { x: x0, y: g - 300, zoom: 2 }, view: { width: 1600, height: 900 } };
    const drawMs = best(5, 8, () => X.draw(r));
    const ms = best(5, 30, () => X.step(world, DT));
    check(ms < 0.3 && drawMs < 3, `four mechs cost little: ${ms.toFixed(3)} ms a tick, ${drawMs.toFixed(2)} ms to draw at 2x`);
  } else check(false, 'a stretch of the wilds for the cost');
  fresh();
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
