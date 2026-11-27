// Mechs (N90, N101; run with --page=pixel-world.html --params=det=1&seed=N): the user's hopper, drawn
// as the user drew it and moving as the drawings move - standing, it is the user's crouching drawing
// cell for cell; it hops along the ground (up a step, stopped by a wall - it leaps it); a leap and its
// jets carry it up a cliff higher than it leaps; dropped from high up it glides down on its wings
// unhurt - torn to tatters it drops, and lands hurt; between the drawings it goes smoothly, tick by
// tick; it sees a round coming and dodges it on its jets - ankles and under its wing alight - its
// guns firing back the other way, not again straight after, and not one from behind; its cannon
// under its wing, with the user's bullet, and a missile; destroyed - falling apart burning, no blast.
// Over courses laid in the wilds, cleared to the sky; the units and their rounds stepped (the world
// where it matters).
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
    for (let xx = x; xx <= x + len; xx += 1) for (let y = g; y <= tops[xx - x] + 3 || y <= g + 30; y += 1) PW.set(world, xx, y, M.STONE, { quiet: true });
    return { x0: x, g };
  }
  return null;
}
// (units and rounds: the tanks' step steps the mechs and the rounds too)
const run = (secs, each) => { for (let k = 0; k < Math.round(secs / DT); k += 1) { T.step(world, DT); if (each && each(k) === false) break; } };
const fresh = () => { world.mechs = []; world.tanks = []; world.troops = []; world.jets = []; world.shots = []; };
// (the cells of it drawn this tick, about its body point, as the drawing faces - left)
const drawnCells = (m) => { const P = m.P, out = new Set(); for (let y = P.box.y0; y < P.box.y1; y += 1) for (let x = P.box.x0; x < P.box.x1; x += 1) if (X.pixel(m, x + 0.5, y + 0.5)) out.add(`${(x - P.hx) * -m.facing},${y - P.hy}`); return out; };

// 1. As drawn: standing, it is the user's idle pose (the idle clip's first frame), cell for cell -
// facing right as left, mirrored - and stays so, where it stands, for as long as it stands.
{
  const S = site(400);
  if (!S) check(false, 'a stretch of the wilds to stand it in');
  else {
    const { x0 } = S;
    fresh();
    const frames = X.frames(), crouch = frames[X.clips().idle[0]];
    const want = new Set(); for (let i = 0; i < crouch.n; i += 1) want.add(`${crouch.xs[i]},${crouch.ys[i]}`);
    const a = X.create(world, { x: x0 + 120, side: 'left', facing: -1 }), b = X.create(world, { x: x0 + 280, side: 'left', facing: 1, style: 'asian' });
    const same = (m) => { const got = drawnCells(m); let both = 0; for (const k of got) if (want.has(k)) both += 1; return both / (got.size + want.size - both); };
    const ax = a.x, bx = b.x;
    let least = 1;
    run(4, () => { least = Math.min(least, same(a), same(b)); });
    const ja = same(a), jb = same(b);
    await view('mech-as-drawn', x0 + 200, a.y - 30, 7);
    check(ja === 1 && jb === 1 && least === 1 && a.x === ax && b.x === bx && crouch.n > 400,
      `standing, the hopper is the user's idle pose cell for cell (${crouch.n} cells; facing left ${(ja * 100).toFixed(1)}% the same, facing right, mirrored, ${(jb * 100).toFixed(1)}%) - and stays so, where it stands, 4 s (${(least * 100).toFixed(1)}% at the least)`);
  }
}

// 2. Hopping: up a 14-cell step, hop after hop; a 60-cell wall stops it - it leaps it, landing beyond.
{
  const S = site(900);
  if (!S) check(false, 'a stretch of the wilds for the hops');
  else {
    const { x0, g } = S;
    fill(x0 + 300, g - 14, x0 + 899, g - 1, M.STONE);              // a step up, 14 cells
    fill(x0 + 560, g - 14 - 60, x0 + 570, g - 15, M.STONE);         // a wall on it, 60 tall
    fresh();
    const m = X.create(world, { x: x0 + 120, side: 'left', facing: 1, style: 'gothic' });
    X.walk(m, 1);
    let stepped = false, stopAt = null;
    const hops0 = X.stats.hops, seen = new Set();
    run(1);
    await view('mech-hopping', m.x, m.y - 30, 6);
    run(6, () => { seen.add(m.an.a); if (m.y <= g - 15) stepped = true; if (stopAt === null && m.x > x0 + 500 && Math.abs(m.vx) < 1 && m.onGround) stopAt = m.x; });
    const atWall = m.x, hops = X.stats.hops - hops0;
    X.leap(m);
    let top = m.y;
    run(5, () => { top = Math.min(top, m.y); });
    await view('mech-leapt', m.x, m.y - 40, 5);
    const idle = X.clips().idle;
    check(stepped && hops >= 3 && idle.every((f) => seen.has(f)) && stopAt !== null && atWall < x0 + 560 - X.HALF + 2 && m.x > x0 + 571 + X.HALF && m.onGround && m.hp === X.ARMOUR,
      `a mech hops along (${hops} hops, every one of the idle clip's ${idle.length} drawings in each), up a 14-cell step (${stepped}); a 60-cell wall stops it (${stopAt !== null ? `${(x0 + 560 - atWall).toFixed(0)} cells off it` : 'not stopped'}) - it leaps it (${(g - 15 - top).toFixed(0)} cells up) and lands beyond it unhurt (${(m.x - x0 - 571).toFixed(0)} past it, armour ${m.hp.toFixed(0)})`);
  }
}

// 3. Jets: at the foot of a cliff higher than it leaps, a leap and its jets carry it up on to the
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
    run(0.3);
    X.leap(m);
    let boosted = false, low = Infinity;
    // (over the top, it stops going on: it comes down on it)
    run(7, () => { if (!boosted && !m.onGround && m.vy > -80) { X.boost(m); boosted = true; } low = Math.min(low, m.fuel); if (m.y <= g - H + 1 && m.x > x0 + 320 + X.HALF + 30) X.walk(m, 0); });
    const onTop = m.onGround && m.y <= g - H - 1 + 2 && m.x > x0 + 320 + X.HALF;
    run(3);
    await view('mech-on-cliff', m.x, m.y - 40, 4);
    check(onTop && low < 0.3 && m.fuel > low + 1,
      `a leap and its jets carry it up a ${H}-cell cliff, higher than it leaps (${onTop ? 'on top' : `at ${(g - m.y).toFixed(0)} cells up, ${m.onGround ? 'on the ground' : 'in the air'}`}); its fuel spent (${low.toFixed(2)} s left at the least), it fills again on the ground (${m.fuel.toFixed(2)} s)`);
  }
}

// 4. Gliding: dropped from 600 cells it spreads its wings - the glide clip - and comes down slowly,
// landing unhurt; its wings torn to tatters (its armour low) it drops, and lands hurt.
{
  const S = site(500, 800);
  if (!S) check(false, 'a stretch of the wilds for the drop');
  else {
    const { x0, g } = S;
    fresh();
    const a = X.create(world, { x: x0 + 120, y: g - 1 - 600, side: 'left' });
    const b = X.create(world, { x: x0 + 380, y: g - 1 - 600, side: 'left' });
    b.hp = X.ARMOUR * X.TATTERS - 10;
    a.onGround = false; b.onGround = false;
    const glide = new Set(X.clips().glide);
    let va = 0, vb = 0, inGlide = 0, ticks = 0, shown = false;
    run(8, (k) => {
      if (!a.onGround) { va = a.vy; ticks += 1; if (glide.has(a.an.a)) inGlide += 1; }
      if (!b.onGround) vb = b.vy;
      if (!shown && k === 90) shown = true;
      if (a.onGround && b.onGround) return false;
    });
    await view('mech-glided', x0 + 250, g - 40, 4);
    check(a.onGround && a.hp === X.ARMOUR && va < X.FALL_SAFE && inGlide > ticks * 0.6 && b.onGround && b.hp < X.ARMOUR * X.TATTERS - 10 && vb > X.FALL_SAFE,
      `dropped from 600 cells it glides down on its wings (the glide clip ${(inGlide / Math.max(1, ticks) * 100).toFixed(0)}% of its fall), landing at ${va.toFixed(0)} cells/s unhurt (armour ${a.hp.toFixed(0)}); its wings in tatters, another drops, landing at ${vb.toFixed(0)} cells/s, hurt (armour ${(X.ARMOUR * X.TATTERS - 10).toFixed(0)} -> ${b.hp.toFixed(0)})`);
  }
}

// 5. Smoothly: hopping, leaping, gliding down and landing, it goes from drawing to drawing tick by
// tick - many more drawings shown than the user drew, each a short way on from the one before,
// where going straight from one of the user's drawings to the next jumps far.
{
  const S = site(900, 700);
  if (!S) check(false, 'a stretch of the wilds for the smoothness');
  else {
    const { x0 } = S;
    fresh();
    const m = X.create(world, { x: x0 + 150, side: 'left', facing: 1 });
    // (how far, on the whole, the cells of one drawing are from the nearest of another's)
    const far = (A, B) => {
      if (!A.size || !B.size) return 0;
      const pts = [...B].map((k) => k.split(',').map(Number));
      let sum = 0;
      for (const k of A) { const [x, y] = k.split(',').map(Number); let best = Infinity; for (const [u, v] of pts) { const d = Math.abs(u - x) + Math.abs(v - y); if (d < best) { best = d; if (!d) break; } } sum += best; }
      return sum / A.size;
    };
    const frames = X.frames(), cellsOf = (f) => { const F = frames[f], s = new Set(); for (let i = 0; i < F.n; i += 1) s.add(`${F.xs[i]},${F.ys[i]}`); return s; };
    let prev = null, worstTick = 0, shown = new Set(), keys = new Set(), worstKey = 0;
    X.walk(m, 1);
    run(3, (k) => {
      if (k === 60) X.leap(m);
      if (k % 2) return;
      const now = drawnCells(m), sig = [...now].sort().join(';');
      shown.add(sig); keys.add(m.an.a);
      if (prev) worstTick = Math.max(worstTick, far(now, prev), far(prev, now));
      prev = now;
    });
    // (the user's drawings straight one to the next, as the clips go)
    const C = X.clips();
    for (const clip of [C.idle, C.jump, C.glide]) for (let i = 0; i + 1 < clip.length; i += 1) { const A = cellsOf(clip[i]), B = cellsOf(clip[i + 1]); worstKey = Math.max(worstKey, far(A, B), far(B, A)); }
    check(shown.size >= keys.size * 3 && worstTick < worstKey * 0.6,
      `between the user's drawings it goes smoothly: ${shown.size} drawings shown over a hop, a leap and its glide - the user drew ${keys.size} of them - none further from the one two ticks before than ${worstTick.toFixed(1)} cells on the whole, where going straight from one of the user's drawings to the next goes up to ${worstKey.toFixed(1)}`);
  }
}

// 6. Dodging: an armour-piercing round fired at it from in front, 900 cells off - it sees it and
// leaps it on its jets, alight at its ankles and under its wing, and its guns fire back the other
// way; a second straight after, its dodge not ready again, strikes it; one from behind it does not see.
{
  const S = site(1400);
  if (!S) check(false, 'a stretch of the wilds for the dodging');
  else {
    const { x0 } = S;
    fresh();
    const m = X.create(world, { x: x0 + 300, side: 'left', facing: 1, style: 'asian' });
    run(0.2);
    const at = (u) => [u.x, u.y - X.HEIGHT / 2];
    const shoot = (u, from) => { const [tx, ty] = at(u); return PW.shots.fire(world, { kind: 'ap', x: tx + from, y: ty, dx: -Math.sign(from), dy: 0, side: 'right' }); };
    // (where its jets' flames start, and where its rounds leave from, while it dodges)
    const spawn = world.particles.spawn, flames = [];
    world.particles.spawn = function (x, y, vx, vy, mat, col, flags, ...rest) { if (flags & PW.PARTICLE.GLOW) flames.push([x, y, vx, vy]); return spawn.call(this, x, y, vx, vy, mat, col, flags, ...rest); };
    const d0 = X.stats.dodged, r0 = X.stats.returned, fired0 = PW.shots.stats.fired;
    shoot(m, 900);
    let P = null, back = null;
    run(0.5, () => { if (!P && m.jetT > 0) P = { ankles: m.P.ankles.map((a) => a.slice()), jet: m.P.jet.slice(), gun: m.P.gun.slice() }; if (!back) back = (world.shots || []).find((s) => s.from === m) || null; });
    world.particles.spawn = spawn;
    const near = (pts, [x, y], r) => pts.some(([u, v]) => Math.hypot(u - x, v - y) <= r);
    const fromAnkles = P && P.ankles.every((a) => near(flames, a, 4)), fromWing = P && near(flames, P.jet, 4);
    const jetsBack = P && flames.filter(([x, y]) => Math.hypot(x - P.jet[0], y - P.jet[1]) <= 4).some(([, , vx]) => Math.sign(vx) === -m.facing);
    const hp1 = m.hp, dodged = X.stats.dodged - d0;
    await view('mech-dodging', m.x, m.y - 40, 5);
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
    check(dodged === 1 && hp1 === X.ARMOUR && hp2 < hp1 && b.hp < X.ARMOUR && X.stats.dodged - d0 === 1 && fromAnkles && fromWing && jetsBack && X.stats.returned - r0 === 1 && back && Math.sign(back.vx) === 1 && back.look === 'hopper',
      `it sees a round coming at it from in front and leaps it (${dodged} dodge, armour ${hp1.toFixed(0)}) on its jets - flames from its ankles (${fromAnkles}) and from under its wing (${fromWing}), that one blowing back (${jetsBack}) - its guns firing back at the shooter the other way (${X.stats.returned - r0} burst, ${PW.shots.stats.fired - fired0} rounds); a second straight after strikes it (${(hp1 - hp2).toFixed(0)} off its armour), its dodge not ready again; one from behind it does not see (${(X.ARMOUR - b.hp).toFixed(0)} off another's)`);
  }
}

// 7. Fighting: its cannon under its wing - the user's bullet - strikes a tank 400 cells off, its
// rounds bursting as drawn where they strike; its missile, from under its wing too, strikes another.
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
    const gun = m.P.gun.slice(), body = [m.P.hx, m.P.hy];
    X.fire(world, m);
    let first = null, bursts = 0;
    run(1.5, () => { if (!first) first = (world.shots || []).find((s) => s.from === m) || null; bursts = Math.max(bursts, (world.shotHits || []).length); });
    m.aim = { x: b.x, y: b.y - 14 };
    const missile = X.launch(world, m);
    run(4);
    await view('mech-fighting', x0 + 600, g - 80, 2);
    check(a.hp < 100 && b.hp < 100 && X.stats.fired >= 8 && first && first.look === 'hopper' && Math.hypot(first.x0 - gun[0], first.y0 - gun[1]) < 3 && gun[1] > body[1] && bursts >= 1 && missile,
      `its cannon, under its wing (${(gun[1] - body[1]).toFixed(0)} cells under its body), fires the user's bullet: a burst strikes a tank 400 cells off (${(100 - a.hp).toFixed(0)} off its armour), bursting as drawn where it strikes (${bursts}); its missile strikes another 900 off (${(100 - b.hp).toFixed(0)})`);
    fresh();
  }
}

// 7b. By hand (N102, the user's controls): it hops along while D is held and stands in its idle pose
// when it is let go; Space leaps it, and held in the air lights its jets - let go, they go out; a
// left click fires its cannon, a right click a missile from under its wing.
{
  const S = site(900, 900);
  if (!S) check(false, 'a stretch of the wilds for the controls');
  else {
    const { x0 } = S;
    fresh();
    const m = X.create(world, { x: x0 + 150, side: 'left', facing: 1 });
    X.hold(m);
    run(0.3);
    const mx0 = m.x;
    X.key({ code: 'KeyD', type: 'keydown' });
    run(1.5);
    const hopped = m.x - mx0;
    X.key({ code: 'KeyD', type: 'keyup' });
    run(1);
    const xs = m.x, crouch = X.clips().idle[0];
    run(1);
    const stood = m.walk === 0 && m.x === xs && m.an.a === crouch && m.an.b === crouch;
    X.key({ code: 'Space', type: 'keydown' });
    let lit = false, top = m.y;
    run(1.2, () => { top = Math.min(top, m.y); if (m.boosting) lit = true; });
    // (still held, in the air: its jets)
    run(0.3, () => { if (m.boosting) lit = true; });
    X.key({ code: 'Space', type: 'keyup' });
    const out = !m.boosting;
    run(6);
    const f0 = X.stats.fired, m0 = m.missiles;
    // (a second click while its first burst is still going is not lost: its burst follows - N102)
    X.click(world, m.x + 300, m.y - 30, 0);
    run(0.3);
    X.click(world, m.x + 300, m.y - 30, 0);
    run(1.7);
    X.click(world, m.x + 600, m.y - 30, 2);
    run(0.2);
    const fired = X.stats.fired - f0, missiles = m0 - m.missiles;
    X.hold(null);
    check(hopped > 100 && stood && m.y - top > 100 && lit && out && fired >= 16 && missiles === 1,
      `by hand: it hops along while D is held (${hopped.toFixed(0)} cells in 1.5 s) and stands in its idle pose, still, when it is let go (${stood}); Space leaps it (${(m.y - top).toFixed(0)} cells up) and held lights its jets (${lit}) - let go, they go out (${out}); two left clicks, the second mid-burst, fire two bursts of its cannon (${fired} rounds), a right click a missile (${missiles})`);
    fresh();
  }
}

// 7c. A road tunnel's barricade (N104, the user's): its own side's mech walks through it untouched;
// another side's does not step over it - lower than its stride as it is - but breaks through it,
// slowed. (A jersey block and a hedgehog, a tunnel network's cells, as WGM lays them.)
{
  const S = site(700, 200);
  if (!S) check(false, 'a stretch of the wilds for the barricade');
  else {
    const { x0, g } = S, at = x0 + 300;
    const bar = { id: 'mech-course', side: 'left', x0: at, x1: at + 25, y0: g - 12, y1: g - 1, cells: [] };
    const put = (x, y, mt) => { PW.set(world, x, y, mt, { quiet: true }); PW.setOwner(world, x, y, 50990); bar.cells.push(y * world.width + x); };
    for (let h = 0; h < 12; h += 1) for (let dx = h < 4 ? 0 : 2; dx < (h < 4 ? 12 : 10); dx += 1) put(at + dx, g - 1 - h, M.CONCRETE);
    for (let k = 0; k < 12; k += 1) { put(at + 14 + k, g - 1 - k, M.STEEL); put(at + 25 - k, g - 1 - k, M.STEEL); }
    const bars0 = world.barricades;
    world.barricades = [...(bars0 || []), bar];
    const standing = () => bar.cells.filter((i) => { const id = world.mat[i] & 63; return id === M.CONCRETE || id === M.STEEL; }).length;
    const n0 = standing();
    fresh();
    const own = X.create(world, { x: x0 + 150.5, y: g - 1, side: 'left', facing: 1 });
    X.walk(own, 1);
    run(6, () => (own.x > at + 120 ? false : undefined));
    const ownPast = own.x > at + 26, n1 = standing();
    fresh();
    const foe = X.create(world, { x: x0 + 150.5, y: g - 1, side: 'right', facing: 1 });
    X.walk(foe, 1);
    let highest = g, slowest = Infinity;
    run(12, (k) => {
      if (foe.x + X.HALF > at && foe.x - X.HALF < at + 26) { highest = Math.min(highest, foe.y); if (k > 30) slowest = Math.min(slowest, Math.abs(foe.vx)); }
      return foe.x > at + 120 ? false : undefined;
    });
    const n2 = standing();
    await view('mech-barricade', at + 13, g - 30, 6);
    world.barricades = bars0;
    fresh();
    // (what it breaks lies where it broke: it may climb the rubble, never the barricade standing)
    check(ownPast && n1 === n0 && foe.x > at + 26 && n2 < n0 * 0.3 && slowest < X.WALK * 0.7,
      `a road tunnel's barricade: its own side's mech walks through it (${ownPast ? 'past it' : 'stopped'}, ${n1} of its ${n0} cells standing); another side's breaks through it rather than stepping over (${n0 - n2} of its cells crushed - over their rubble ${g - 1 - highest} cells up at most - slowed to ${slowest === Infinity ? '-' : slowest.toFixed(0)} cells/s; ${foe.x > at + 26 ? 'through' : 'stopped short'})`);
  }
}

// 8. Destroyed: its armour gone it falls apart where it stands, burning - its wreck's pieces thrown
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

// 9. What they cost: four mechs hopping, a tick; and drawing them.
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
    // (the hopper stands 1.25 times as large since 9d6ab74 - its footing looked over that much more: 0.5 ms
    // for four, and a side keeps two at most - N142)
    check(ms < 0.5 && drawMs < 3, `four mechs cost little: ${ms.toFixed(3)} ms a tick, ${drawMs.toFixed(2)} ms to draw at 2x`);
  } else check(false, 'a stretch of the wilds for the cost');
  fresh();
}
// 10. Its paint (N159): every drawing of it - each frame of its clips, facing either way, in each side's
// palette - is the user's drawing cell for cell, only the colours its own: its plates in its side's paint,
// its tanks' (sand, olive drab, gunmetal grey - the sides told apart by that alone), its legs darker and
// dusted toward its feet, a stripe in the side's dark shade along its pod, one lit lens at its head and
// one amber marker on its back.
{
  const S = site(500);
  if (!S) check(false, 'a stretch of the wilds for the paint');
  else {
    fresh();
    const frames = X.frames(), lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11, far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const LENS = PW.abgr(...X.LENS) >>> 0, MARKER = PW.abgr(...X.MARKER) >>> 0;
    const m = X.create(world, { x: S.x0 + 250, side: 'left', facing: -1 });
    let poses = 0, exact = 0, lights = 0, striped = 0, worst = '';
    const looks = {};
    for (const style of X.STYLES) {
      const sum = { plate: [0, 0, 0, 0], legHi: [0, 0, 0, 0], legLo: [0, 0, 0, 0], stripe: [0, 0, 0, 0] };
      const add = (s, c) => { s[0] += c & 255; s[1] += c >>> 8 & 255; s[2] += c >>> 16 & 255; s[3] += 1; };
      m.style = style;
      frames.forEach((F, i) => {
        for (const facing of [-1, 1]) {
          m.facing = facing; m.an = { a: i, b: i, t: 0, mode: 'idle' };
          const P = X.pose(m);
          const want = new Set(); for (let j = 0; j < F.n; j += 1) want.add(`${F.xs[j]},${F.ys[j]}`);
          let got = 0, both = 0, lens = 0, marker = 0, band = { s: [0, 0, 0, 0] };
          for (let y = P.box.y0; y < P.box.y1; y += 1) for (let x = P.box.x0; x < P.box.x1; x += 1) {
            const c = X.pixel(m, x + 0.5, y + 0.5);
            if (!c) continue;
            const dx = (x - P.hx) * -facing, dy = y - P.hy;
            got += 1; if (want.has(`${dx},${dy}`)) both += 1;
            if (c === LENS) { lens += 1; continue; }
            if (c === MARKER) { marker += 1; continue; }
            if (Math.abs(dx - P.pod[0]) <= 5 && dy >= P.pod[1] && dy <= P.pod[1] + 1) { add(sum.stripe, c); add(band.s, c); continue; }
            if (dy < X.LEGS) add(sum.plate, c);
            else add(dy < X.LEGS + (P.foot - X.LEGS) / 2 ? sum.legHi : sum.legLo, c);
          }
          poses += 1;
          if (got === F.n && both === F.n) exact += 1; else if (!worst) worst = `${style} ${F.label} facing ${facing}: ${got} drawn, ${both} of ${F.n} the drawing's`;
          if (lens === 1 && marker === 1) lights += 1;
          if (band.s[3] >= 3) striped += 1;
        }
      });
      const mean = (s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      looks[style] = { plate: mean(sum.plate), legHi: mean(sum.legHi), legLo: mean(sum.legLo), stripe: mean(sum.stripe) };
    }
    const L = looks, show = (c) => `rgb(${c.map((v) => v.toFixed(0)).join(',')})`;
    check(exact === poses && poses === frames.length * 2 * X.STYLES.length,
      `every drawing of it is the user's, cell for cell, only its colours chosen: ${exact} of ${poses} poses (${frames.length} frames, facing either way, in ${X.STYLES.length} palettes)${worst ? ` - ${worst}` : ''}`);
    const { modern: sand, asian: olive, gothic: grey } = Object.fromEntries(X.STYLES.map((s) => [s, L[s].plate]));
    check(sand[0] > sand[1] && sand[1] > sand[2] && sand[0] > 110 && olive[1] > olive[0] && olive[1] > olive[2] && grey[2] >= grey[0] && grey[1] >= grey[0]
      && far(sand, olive) > 40 && far(sand, grey) > 40 && far(olive, grey) > 15,
      `each side's mechs in its own paint, its tanks': desert sand ${show(sand)}, olive drab ${show(olive)}, gunmetal grey ${show(grey)} - told apart by it (${far(sand, olive).toFixed(0)}, ${far(sand, grey).toFixed(0)}, ${far(olive, grey).toFixed(0)} apart)`);
    const legs = X.STYLES.every((s) => lum(L[s].legHi) < lum(L[s].plate) * 0.95 && far(L[s].legLo, X.DUST) < far(L[s].legHi, X.DUST) && lum(L[s].stripe) < lum(L[s].plate) * 0.85);
    check(legs && lights === poses && striped === poses,
      `its legs darker than its plates and dusted toward its feet, a dark stripe along its pod in every pose (${striped} of ${poses}), one lit lens and one amber marker in every pose (${lights} of ${poses}): ${X.STYLES.map((s) => `${s} plates ${lum(L[s].plate).toFixed(0)}, legs ${lum(L[s].legHi).toFixed(0)} then ${far(L[s].legLo, X.DUST).toFixed(0)} from dust (${far(L[s].legHi, X.DUST).toFixed(0)} above), stripe ${lum(L[s].stripe).toFixed(0)}`).join('; ')}`);
    // (the three sides' mechs side by side, for the eye)
    fresh();
    X.STYLES.forEach((style, k) => X.create(world, { x: S.x0 + 100 + k * 140, side: k ? 'right' : 'left', facing: k ? -1 : 1, style }));
    run(0.5);
    await view('mech-paint', S.x0 + 240, S.g - 40, 7);
  }
}

pwApp.setPaused(false);
return { checks, shots: shots.length };
