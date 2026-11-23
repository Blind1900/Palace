// Turrets (N103; run with --page=pixel-world.html --params=det=1&seed=N): an autocannon turret, its
// head after the RCWS and armoured-turret refs, sized between a trooper and a tank, on its base on a
// roof or the ground and on a wall - firing on its own at the hostile units near it. On a course laid
// in the wilds: a block of stone, its flat top and its sheer face the mounts.
// 1. Its size: taller than a trooper, smaller than a tank.
// 2. On the ground: it turns its head round and lays its gun on a man of the other side in the open,
//    leading him, and fires - he goes down; one behind a wall it does not see, nor fires at.
// 3. On a wall: it fires at a man out in front of the wall, high or low; one on the far side of the
//    wall, its gun cannot reach - it never turns to him.
// 4. Men before armour: a tank and a man of the other side, the tank the nearer - the man first.
// 5. Never into its own: a man of its side in the line of fire - it holds; out of it, it fires.
// 6. Put out of action (a hack) it is silent a while, its gun drooping; then it fires again. Held
//    (a quiet world), it never fires.
// 7. Its base blown away from under it, it comes off and falls - a wreck; destroyed, it too falls.
// 8. What it costs: twenty turrets watching, a tick.
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
const load = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`${src} did not load`)); document.head.appendChild(s); });
for (const [name, src] of [['troops', 'pw-troops'], ['defence', 'pw-defence'], ['units', 'pw-units']]) if (!PW[name]) await load(`scripts/pw/${src}.js`);
pwApp.setPaused(true);
const D = PW.defence, U = PW.troops, T = PW.tanks, DT = 1 / 60;
const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); PW.setOwner(world, x, y, 0); } };
const used = [];
function site(len, sky = 400) {
  for (const zone of layout.wilds) for (let x = zone.x0 + 60; x + len < zone.x1 - 60; x += 40) {
    if (used.some(([a, b]) => x < b + 60 && x + len > a - 60)) continue;
    const tops = Array.from({ length: len + 1 }, (_, d) => world.groundTop[x + d]);
    const g = Math.min(...tops);
    if (Math.max(...tops) - g > 60 || g - sky < 20) continue;
    used.push([x, x + len]);
    fill(x, g - sky, x + len, g - 1, M.AIR);
    for (let xx = x; xx <= x + len; xx += 1) for (let y = g; y <= world.groundTop[xx] + 3 || y <= g + 30; y += 1) PW.set(world, xx, y, M.STONE, { quiet: true });
    PW.rebuildGroundTop(world);
    return { x0: x, g };
  }
  return null;
}
// (the units and their rounds: the tanks' step steps them all, the batteries too)
const run = (secs, each) => { for (let k = 0; k < Math.round(secs / DT); k += 1) { world.tick = (world.tick || 0) + 1; T.step(world, DT); if (each && each(k) === false) break; } };
const fresh = () => { world.defence = []; world.troops = []; world.tanks = []; world.mechs = []; world.jets = []; world.shots = []; };
// (the rounds a turret fires, while `work` runs)
const roundsOf = (u, work) => { const out = [], was = PW.shots.fire; PW.shots.fire = function (w, spec) { if (spec.from === u) out.push(spec); return was.call(this, w, spec); }; try { work(); } finally { PW.shots.fire = was; } return out; };
const man = (x, y, side, facing = 1) => { const t = U.create(world, { x: x + 0.5, y, side, facing }); return t; };

// 1. Its size.
{
  const S = site(300);
  if (!S) check(false, 'a stretch of the wilds for the size');
  else {
    const { x0, g } = S;
    fresh();
    const u = D.create(world, { type: 'turret', x: x0 + 150, y: g, normal: [0, -1], side: 'left', facing: 1, base: { x0: x0 + 134, x1: x0 + 166, y: g } });
    let top = Infinity, l = Infinity, r = -Infinity;
    for (let y = g - 40; y < g; y += 1) for (let x = x0 + 110; x <= x0 + 190; x += 1) if (D.pixel(u, x, y)) { top = Math.min(top, y); l = Math.min(l, x); r = Math.max(r, x); }
    const tall = g - top, wide = r - l + 1;
    await view('turret-floor', x0 + 150, g - 15, 7);
    // (its base, WGM's plate under its mount row, 6 more)
    check(tall + 6 > U.HEIGHT && tall + 6 < 35 && tall >= 22 && wide >= 26 && wide <= 46,
      `its size: ${tall} cells tall over its mount, ${tall + 6} on its base (a trooper ${U.HEIGHT}, a tank about 35), ${wide} across, its barrel ${D.BARREL} long`);
  }
}

// 2. On the ground.
{
  const S = site(900);
  if (!S) check(false, 'a stretch of the wilds for the ground');
  else {
    const { x0, g } = S;
    fresh();
    const u = D.create(world, { type: 'turret', x: x0 + 450, y: g, normal: [0, -1], side: 'left', facing: 1 });
    // (a man of theirs out in the open to its left - its head faces right; a wall, and one behind it to its right)
    const a = man(x0 + 150, g - 1, 'right', 1);
    fill(x0 + 620, g - 60, x0 + 640, g - 1, M.STONE);
    const b = man(x0 + 720, g - 1, 'right', -1);
    let turned = 0, firstAt = null;
    const rounds = roundsOf(u, () => run(6, (k) => { if (u.turnT > 0) turned += 1; if (firstAt === null && u.burst > 0) firstAt = k; }));
    const atA = rounds.filter((s) => s.dx < 0).length, atB = rounds.filter((s) => s.dx > 0).length;
    await view('turret-ground', x0 + 300, g - 30, 3);
    check(turned > 10 && firstAt !== null && firstAt >= 20 && atA > 0 && atB === 0 && (a.dead || a.hp < U.HP),
      `on the ground it turns its head round (${(turned / 60).toFixed(2)} s) and lays its gun on a man of theirs in the open, firing ${(firstAt / 60).toFixed(2)} s on - ${atA} rounds, him ${a.dead ? 'down' : `hurt (${a.hp.toFixed(0)})`}; one behind a wall it does not fire at (${atB} rounds)`);
  }
}

// 3. On a wall.
{
  const S = site(1000, 500);
  if (!S) check(false, 'a stretch of the wilds for the wall');
  else {
    const { x0, g } = S;
    fresh();
    // (a block of stone 200 high, its sheer right face at x0 + 400; the turret on that face, 120 up)
    fill(x0 + 300, g - 200, x0 + 400, g - 1, M.STONE);
    const wy = g - 120;
    const u = D.create(world, { type: 'turret', x: x0 + 400, y: wy, normal: [1, 0], side: 'left', base: { x0: x0 + 400, x1: x0 + 400, y0: wy - 15, y1: wy + 15 } });
    const low = man(x0 + 640, g - 1, 'right', -1);
    // (one on the far side of the block, out in the open, on its top)
    const far = man(x0 + 340, g - 201, 'right', 1);
    let rounds = roundsOf(u, () => run(5));
    const atLow = rounds.filter((s) => s.dx > 0 && s.dy > 0).length, back = rounds.filter((s) => s.dx < 0).length;
    await view('turret-wall', x0 + 430, wy, 7);
    // (and one high up out in front: it swings its gun up to him)
    low.dead = true; low.hp = 0;
    const high = man(x0 + 560, g - 1, 'right', -1);
    fill(x0 + 560, g - 260, x0 + 620, g - 250, M.STONE);
    high.x = x0 + 563.5; high.y = g - 261;
    rounds = roundsOf(u, () => run(4));
    const atHigh = rounds.filter((s) => s.dy < 0).length;
    check(atLow > 0 && back === 0 && atHigh > 0 && u.headF === 1,
      `on a wall it fires at a man out in front of it, below (${atLow} rounds), and swings its gun up to one high up (${atHigh}); one on the far side of the wall it never fires at (${back})`);
  }
}

// 4. Men before armour.
{
  const S = site(1100);
  if (!S) check(false, 'a stretch of the wilds for the choosing');
  else {
    const { x0, g } = S;
    fresh();
    const u = D.create(world, { type: 'turret', x: x0 + 200, y: g, normal: [0, -1], side: 'left', facing: 1 });
    const tank = T.create(world, { style: 'asian', side: 'right', x: x0 + 450, y: g, facing: -1 });
    const t = man(x0 + 600, g - 1, 'right', -1);
    run(0.3);
    let firstFoe = null;
    run(3, () => { if (!firstFoe && u.burst > 0) firstFoe = u.foe; });
    check(firstFoe === t, `of a tank 250 off and a man 400 off, both of theirs, it fires first at the man (${firstFoe === t ? 'the man' : firstFoe ? firstFoe.kind : 'nothing'})`);
  }
}

// 5. Never into its own.
{
  const S = site(900);
  if (!S) check(false, 'a stretch of the wilds for its own');
  else {
    const { x0, g } = S;
    fresh();
    const u = D.create(world, { type: 'turret', x: x0 + 200, y: g, normal: [0, -1], side: 'left', facing: 1 });
    const foe = man(x0 + 650, g - 1, 'right', -1);
    const friend = man(x0 + 420, g - 1, 'left', 1);
    const before = roundsOf(u, () => run(3)).length;
    friend.y = g - 1; friend.x = x0 + 120.5;
    const after = roundsOf(u, () => run(3)).length;
    check(before === 0 && after > 0, `a man of its own side in the line of fire, it holds (${before} rounds); out of it, it fires (${after})`);
  }
}

// 6. Put out of action, held.
{
  const S = site(700);
  if (!S) check(false, 'a stretch of the wilds for the hack');
  else {
    const { x0, g } = S;
    fresh();
    const u = D.create(world, { type: 'turret', x: x0 + 200, y: g, normal: [0, -1], side: 'left', facing: 1 });
    const q = D.create(world, { type: 'turret', x: x0 + 120, y: g, normal: [0, -1], side: 'left', facing: 1, hold: true });
    man(x0 + 500, g - 1, 'right', -1);
    world.tick = world.tick || 0;
    PW.units.disable(u, 3);
    const e0 = u.e;
    const silent = roundsOf(u, () => run(2.8)).length;
    const drooped = u.e < e0 || u.e <= -0.15;
    const again = roundsOf(u, () => run(3)).length;
    const heldQuiet = roundsOf(q, () => run(2)).length;
    check(silent === 0 && drooped && again > 0 && heldQuiet === 0,
      `put out of action it is silent (${silent} rounds), its gun drooping (${drooped}); then it fires again (${again}); held, another never fires (${heldQuiet})`);
  }
}

// 7. Its base gone.
{
  const S = site(700);
  if (!S) check(false, 'a stretch of the wilds for the base');
  else {
    const { x0, g } = S;
    fresh();
    // (a base plate 32 across on a pillar of stone 60 high)
    fill(x0 + 300, g - 60, x0 + 340, g - 1, M.STONE);
    fill(x0 + 304, g - 66, x0 + 336, g - 61, M.STEEL);
    const u = D.create(world, { type: 'turret', x: x0 + 320, y: g - 66, normal: [0, -1], side: 'left', facing: 1, base: { x0: x0 + 304, x1: x0 + 336, y: g - 66 } });
    run(0.5);
    const stood = !u.dead;
    const frags0 = world.fragments ? world.fragments.list.length : 0;
    fill(x0 + 300, g - 66, x0 + 340, g - 40, M.AIR);
    run(0.5);
    const fell = u.dead && world.fragments && world.fragments.list.length > frags0;
    // (and one destroyed outright: its head falls burnt)
    const v = D.create(world, { type: 'turret', x: x0 + 500, y: g, normal: [0, -1], side: 'left', facing: 1 });
    run(0.2);
    const f1 = world.fragments ? world.fragments.list.length : 0;
    D.hurt(world, v, 999, 'test');
    const wreck = v.dead && world.fragments && world.fragments.list.length > f1;
    for (let k = 0; k < 90; k += 1) pwApp.stepWorld(1);
    await view('turret-off', x0 + 320, g - 30, 4);
    check(stood && fell && wreck, `on its base it stands (${stood}); its base blown away from under it, it comes off and falls, a wreck (${fell}); destroyed, it too falls, burnt (${wreck})`);
  }
}

// 8. What it costs.
{
  const S = site(1200);
  if (S) {
    const { x0, g } = S;
    fresh();
    const list = [];
    for (let k = 0; k < 20; k += 1) list.push(D.create(world, { type: 'turret', x: x0 + 60 + k * 55, y: g, normal: [0, -1], side: k & 1 ? 'left' : 'right', facing: 1 }));
    run(0.5);
    let ms = Infinity;
    for (let b = 0; b < 5; b += 1) { const t0 = performance.now(); for (let q = 0; q < 20; q += 1) D.step(world, DT); ms = Math.min(ms, (performance.now() - t0) / 20); }
    check(ms < 0.6, `twenty turrets watching (and fighting each other) cost ${ms.toFixed(3)} ms a tick`);
  } else check(false, 'a stretch of the wilds for the cost');
}
fresh();
pwApp.setPaused(false);
return { checks, shots: shots.length };
