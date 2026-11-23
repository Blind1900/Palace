// Jets (N90; run with --page=pixel-world.html --params=det=1&seed=N): taking off from a runway,
// turning round over the top, recovering from a stall, strafing a tank with its cannon, a missile at
// another, shot down - burning, out of control, crashing. Over courses laid in the wilds, cleared
// to the sky; only the units and their rounds are stepped, but for the crash, where the world is.
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
const load = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`${src} did not load`)); document.head.appendChild(s); });
if (!PW.troops) await load('scripts/pw/pw-troops.js');
if (!PW.jets) await load('scripts/pw/pw-jets.js');
pwApp.setPaused(true);
const J = PW.jets, T = PW.tanks, DT = 1 / 60, deg = Math.PI / 180;
const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); } };
const used = [];
function site(len, sky = 900) {
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
// (units and rounds: the tanks' step steps the troopers, the jets and the rounds too)
const run = (secs, each) => { for (let k = 0; k < Math.round(secs / DT); k += 1) { T.step(world, DT); if (each) each(k); } };
const fresh = () => { world.jets = []; world.tanks = []; world.troops = []; };

// 1. Take-off: put on a runway it rolls along it to its speed and lifts off before the strip's end,
// its nose up, climbing away, on to its cruising speed.
{
  const S = site(1400);
  if (!S) check(false, 'a stretch of the wilds for the runway');
  else {
    const { x0, g } = S;
    const r = { from: x0 + 100, to: x0 + 480, y: g };
    fresh();
    const j = J.takeOff(world, r, 'modern', 'left');
    let liftAt = null, rolled = 0, x0j = j.x;
    run(8, () => { if (!j.onGround && liftAt === null) { liftAt = j.x; rolled = j.x - x0j; } });
    await view('jet-climbing', j.x - 200, j.y + 100, 3);
    check(liftAt !== null && liftAt < r.to && j.y < g - 200 && j.v > J.CRUISE * 0.8 && !j.dead,
      `a jet on a runway rolls ${rolled.toFixed(0)} cells along it and lifts off ${liftAt !== null ? (r.to - liftAt).toFixed(0) : '-'} short of its end, climbing away (${(g - j.y).toFixed(0)} cells up after 8 s, at ${j.v.toFixed(0)} cells/s)`);
  }
}

// 2. Turning round: flying right, told left, it pulls up over the top and rolls upright, flying left;
// slowed to a stall (nose high, its speed gone), its nose drops and it flies on.
{
  const S = site(1600);
  if (!S) check(false, 'a stretch of the wilds for the flying');
  else {
    const { x0, g } = S;
    fresh();
    const j = J.create(world, { x: x0 + 300, y: g - 300, facing: 1, style: 'asian', side: 'right' });
    j.want = -1;
    let top = j.y;
    run(6, () => { top = Math.min(top, j.y); });
    const turned = j.facing === -1 && j.roll === 0 && !j.dead && !j.turning;
    const s = J.create(world, { x: x0 + 900, y: g - 400, facing: 1, style: 'gothic', speed: 40, pitch: 70 });
    let dropped = false;
    run(4, () => { if (s.pitch < 0) dropped = true; });
    await view('jet-turned', j.x, j.y, 2);
    check(turned && (g - 300) - top < 900 && dropped && s.v > J.STALL && !s.dead,
      `told the other way it pulls up over the top (${((g - 300) - top).toFixed(0)} cells up) and rolls upright (${turned ? 'flying left, upright' : `facing ${j.facing}, roll ${j.roll.toFixed(2)}`}); stalled, nose high, its nose drops (${dropped}) and it has its speed again (${s.v.toFixed(0)} cells/s)`);
    controls(x0, g);
  }
}

// 2b. By hand (N102, the user's controls): Space held climbs it, let go it levels out; a left click
// fires its cannon, a right click a missile. (Over the stretch the turning had.)
function controls(x0, g) {
  {
    fresh();
    const j = J.create(world, { x: x0 + 300, y: g - 400, facing: 1, style: 'modern', side: 'left' });
    J.hold(j);
    J.key({ code: 'Space', type: 'keydown' });
    run(1.2);
    const climbing = j.climb, up = j.pitch;
    J.key({ code: 'Space', type: 'keyup' });
    run(2);
    const level = Math.abs(j.climb) < 1e-6 && Math.abs(j.pitch) < 0.05;
    const f0 = J.stats.fired, m0 = j.missiles, spot = { x: j.x + 600, y: j.y + 100 };
    // (each round of the burst: at the spot clicked, from where it leaves)
    const rounds = [], fireWas = PW.shots.fire;
    PW.shots.fire = function (w, spec) { if (spec.from === j && spec.kind === 'cannon') rounds.push(spec); return fireWas.call(this, w, spec); };
    J.click(world, spot.x, spot.y, 0);
    run(0.6);
    PW.shots.fire = fireWas;
    J.click(world, spot.x, spot.y, 2);
    run(0.2);
    const fired = J.stats.fired - f0, missiles = m0 - j.missiles;
    const atSpot = rounds.length && rounds.every((s) => Math.abs(Math.atan2(s.dy, s.dx) - Math.atan2(spot.y - s.y, spot.x - s.x)) < 0.06);
    J.hold(null);
    check(climbing > 40 && up > 0.5 && level && fired >= 4 && atSpot && missiles === 1,
      `by hand: Space held climbs it (to ${climbing.toFixed(0)} degrees, its nose ${(up * 57.3).toFixed(0)} up), let go it levels out (${level}); a left click fires its cannon at the spot clicked (${fired} rounds, ${atSpot ? 'every one at it' : 'not at it'}), a right click a missile (${missiles})`);
    fresh();
  }
}

// 3. Strafing and a missile: diving at a tank, its cannon bursts strike it; a missile at another
// tank strikes it.
{
  const S = site(1400);
  if (!S) check(false, 'a stretch of the wilds for the strafing');
  else {
    const { x0, g } = S;
    fresh();
    const a = T.create(world, { style: 'gothic', side: 'right', x: x0 + 900, y: g, facing: -1 });
    const b = T.create(world, { style: 'asian', side: 'right', x: x0 + 1250, y: g, facing: -1 });
    // (a jet coming in at 25 degrees down at the first tank, 700 cells off)
    const j = J.create(world, { x: x0 + 900 - 640, y: g - 20 - 300, facing: 1, pitch: -25, climb: -25, style: 'modern', side: 'left' });
    j.climb = -25;
    let fired = false;
    run(3, (k) => {
      if (!fired && j.x > a.x - 520) { J.fire(world, j); fired = true; }
      if (j.x > a.x - 260) j.climb = 30;
      if (k === 60) { j.aim = { x: b.x, y: b.y - 10 }; J.launch(world, j); }
    });
    check(a.hp < 100 && b.hp < 100 && !j.dead && J.stats.fired >= 12,
      `a jet diving at a tank strafes it - its cannon burst strikes it (${(100 - a.hp).toFixed(0)} of its armour) - and pulls out (${j.dead ? 'crashed' : `${(g - j.y).toFixed(0)} cells up`}); its missile strikes another tank (${(100 - b.hp).toFixed(0)})`);
    fresh();
  }
}

// 4. Shot down: its armour gone, it burns, trails smoke, goes down out of control and crashes - a
// fireball where it hits, its burning wreck on the ground. A missile off another jet brings one down.
{
  const S = site(1400);
  if (!S) check(false, 'a stretch of the wilds for the crash');
  else {
    const { x0, g } = S;
    fresh();
    const j = J.create(world, { x: x0 + 300, y: g - 350, facing: 1, style: 'gothic', side: 'right' });
    const hunter = J.create(world, { x: x0 + 100, y: g - 250, facing: 1, style: 'modern', side: 'left', speed: J.CRUISE * 0.9 });
    hunter.aim = { x: j.x + 200, y: j.y };
    J.launch(world, hunter);
    let downAt = -1, crashedAt = -1, k = 0;
    const frags0 = world.fragments ? world.fragments.list.length : 0;
    for (; k < 60 * 14 && crashedAt < 0; k += 1) {
      pwApp.stepWorld(1);
      if (j.down && downAt < 0) downAt = k;
      if (j.dead && crashedAt < 0) crashedAt = k;
    }
    await view('jet-crash', j.x, g - 40, 4);
    const frags = world.fragments ? world.fragments.list.length - frags0 : 0;
    check(downAt >= 0 && crashedAt > downAt && j.hurtBy === 'missile' && J.stats.crashed >= 1 && (frags > 0 || (world.ruins || []).some((r) => r.wreck)),
      `a missile off another jet brings one down (${downAt >= 0 ? `down at ${(downAt / 60).toFixed(1)} s, by ${j.hurtBy}` : 'not down'}); burning and out of control it crashes (${crashedAt >= 0 ? `${((crashedAt - downAt) / 60).toFixed(1)} s later` : 'still flying'}), its wreck thrown down burning (${frags} pieces)`);
    fresh();
  }
}

// 5. What they cost: four jets flying, a tick; and drawing them.
{
  fresh();
  const x = layout.wilds[0].x0 + 400, y = world.groundTop[x] - 500;
  for (let k = 0; k < 4; k += 1) J.create(world, { x: x + k * 250, y: y - k * 40, facing: k & 1 ? 1 : -1, style: ['modern', 'asian', 'gothic'][k % 3] });
  const best = (n, m, work) => { let min = Infinity; for (let b = 0; b < n; b += 1) { const t0 = performance.now(); for (let q = 0; q < m; q += 1) work(); min = Math.min(min, (performance.now() - t0) / m); } return min; };
  const r = { ctx: document.createElement('canvas').getContext('2d'), world, camera: { x: x - 100, y: y - 250, zoom: 2 }, view: { width: 1600, height: 900 } };
  const drawMs = best(5, 8, () => J.draw(r));
  const ms = best(5, 30, () => J.step(world, DT));
  check(ms < 0.3 && drawMs < 4, `four jets cost little: ${ms.toFixed(3)} ms a tick, ${drawMs.toFixed(2)} ms to draw at 2x`);
  fresh();
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
