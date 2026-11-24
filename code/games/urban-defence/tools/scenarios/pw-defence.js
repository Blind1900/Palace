// Salvos and interceptors (N90; run with --page=pixel-world.html --params=det=1&seed=N): a rocket
// launcher's salvo comes down on the high arc where it was aimed; an Iron Dome battery by a town
// destroys the rockets of a salvo coming down on its side's buildings, and lets one coming down on
// open ground fall; a Patriot battery brings down a jet of the other side. The world runs.
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
const load = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`${src} did not load`)); document.head.appendChild(s); });
for (const [name, src] of [['troops', 'pw-troops'], ['jets', 'pw-jets'], ['defence', 'pw-defence']]) if (!PW[name]) await load(`scripts/pw/${src}.js`);
pwApp.setPaused(true);
const D = PW.defence, S = PW.shots;
const fresh = () => { world.defence = []; world.jets = []; world.tanks = []; world.troops = []; };
const steps = (secs, each) => { for (let k = 0; k < Math.round(secs * 60); k += 1) { pwApp.stepWorld(1); if (each) each(k); } };
// (a battery set down at the first of the places xs where the way up over its tubes is open - not
// under a roof, beside a tower or a mast)
const placeClear = (spec, xs) => {
  for (const x of xs) {
    const u = D.create(world, { ...spec, x });
    if (D.skyClear(world, u, 1) || D.skyClear(world, u, -1)) return u;
    world.defence.splice(world.defence.indexOf(u), 1);
  }
  return null;
};
const along = (x0, step, n) => Array.from({ length: n }, (_, k) => x0 + step * k);

// 1 and 2. A town of one side with a Dome battery beside it; a launcher of the other side 2400 cells
// off. Its first salvo, at the town, goes up on the high arc - and coming down the battery destroys
// its rockets; its second, at open ground between them, the battery lets fall - and it comes down
// where it was aimed.
{
  const sideOf = (b) => b.faction || b.side;
  const town = (world.buildings || []).find((b) => b && b.body && sideOf(b) && b.ground && !b.ruined && b.type === 'population');
  if (!town) check(false, 'a town to defend');
  else {
    fresh();
    const side = sideOf(town), mid = Math.round((town.body.left + town.body.right) / 2);
    // (the launcher 3000 off, the way there is more world)
    const dir = mid < world.width / 2 ? 1 : -1, lx = mid + dir * 3000;
    const L = D.create(world, { type: 'launcher', x: lx, side: 'raiders', facing: -dir, style: 'gothic' });
    const B = placeClear({ type: 'dome', side, facing: dir }, along(mid - dir * 160, -dir * 40, 40));
    // (the salvo's rockets: where each came down, those not destroyed)
    const live = new Set();
    const follow = (fell) => {
      for (const s of world.shots || []) if (s.kind === 'rocket') live.add(s);
      for (const s of live) if (s.done) { live.delete(s); if (!s.intercepted) fell.push(s.x); }
    };
    L.aim = { x: mid, y: town.ground };
    const i0 = S.stats.intercepted || 0, launched0 = D.stats.launched, onTown = [];
    D.fire(world, L);
    let apex = Infinity, k = 0, seen = false;
    for (; k < 16 * 60; k += 1) {
      pwApp.stepWorld(1);
      for (const s of world.shots || []) if (s.kind === 'rocket') apex = Math.min(apex, s.y);
      follow(onTown);
      if (!seen && (S.stats.intercepted || 0) > i0 + 2) { seen = true; await view('dome-intercepting', mid, town.ground - 700, 1); }
    }
    const killed = (S.stats.intercepted || 0) - i0, fired = D.stats.launched - launched0;
    // (the second salvo: at open ground between the two - nothing of the town's for 300 cells round
    // it - beyond the launcher's least reach, 1300 cells; or else beyond the launcher)
    const clear = (x) => { for (let d = -300; d <= 300; d += 50) if (D.ownGround(world, side, x + d)) return false; return true; };
    let open = lx - dir * 1300;
    while (!clear(open) && Math.abs(open - mid) > 300) open -= dir * 80;
    if (!clear(open)) open = lx + dir * 1400;
    L.aim = { x: open, y: world.groundTop[open] };
    L.ammo = 12; B.ammo = D.TYPES.dome.ammo;
    const ignored0 = D.stats.ignored, launched1 = D.stats.launched, fell = [];
    D.fire(world, L);
    steps(14, () => follow(fell));
    await view('salvo-on-open-ground', open, world.groundTop[open] - 60, 3);
    const ignored = D.stats.ignored - ignored0, firedOpen = D.stats.launched - launched1;
    const off = fell.map((x) => Math.abs(x - open)), meanOff = off.reduce((a, b) => a + b, 0) / Math.max(1, off.length);
    const bias = fell.reduce((a, x) => a + (x - open) * Math.sign(open - lx), 0) / Math.max(1, fell.length);
    // (two interceptors to a rocket: a battery's load of 20 meets 10 of a salvo of 12 - the rest get
    // through; each burst destroys its rocket 85 times in 100, so now and then both of a pair miss)
    check(killed >= 8 && fired <= D.TYPES.dome.ammo && (town.ground - apex) > 600 && !D.ownGround(world, side, open),
      `a launcher's salvo goes up on its high arc (${(town.ground - apex).toFixed(0)} cells over the town at its highest) and comes down on a town - its Dome battery fires its ${fired} interceptors at it, two to a rocket, and destroys ${killed} of the 12 (${onTown.length} got through, its load spent)`);
    check(ignored >= 10 && firedOpen === 0 && fell.length >= 10 && meanOff < 120 && Math.max(...off) < 320,
      `a salvo coming down on open ground (${Math.abs(open - mid)} cells out from the town) the battery lets fall - ${ignored} rockets seen and let go, ${firedOpen} interceptors fired - and it comes down where it was aimed (${fell.length} rockets, ${meanOff.toFixed(0)} cells off on average, ${bias.toFixed(0)} long, ${off.length ? Math.max(...off).toFixed(0) : '-'} at most)`);
  }
}

// 3. A Patriot battery brings down a jet of the other side flying at it, 500 cells over the highest
// ground on its way.
{
  fresh();
  const z = layout.wilds[0], P = placeClear({ type: 'patriot', side: 'left' }, along(z.x0 + 2700, 60, 40));
  if (!P) check(false, 'an open place in the wilds for the Patriot battery');
  else {
    let top = Infinity;
    for (let x = P.x - 2200; x <= P.x + 2200; x += 4) top = Math.min(top, world.groundTop[Math.max(0, x)]);
    const j = PW.jets.create(world, { x: P.x - 2200, y: top - 500, facing: 1, side: 'right', style: 'gothic' });
    let downAt = -1;
    steps(10, (k) => { if (j.down && downAt < 0) downAt = k; });
    check(downAt >= 0 && (j.hurtBy === 'blast' || j.hurtBy === 'patriot'),
      `a Patriot battery brings down a jet of the other side flying at it (${downAt >= 0 ? `down at ${(downAt / 60).toFixed(1)} s, by ${j.hurtBy}` : `still up, ${j.hp.toFixed(0)} of its armour left`}; ${P.ammo} missiles left)`);
  }
}

// 3b. By hand (N102, the user's controls): a left click at a spot - a launcher in hand lays its salvo
// on it, a turret fires a burst at it; a right click is not theirs.
{
  fresh();
  const zone = layout.wilds[0], x = Math.round((zone.x0 + zone.x1) / 2), gy = world.groundTop[x] - 1;
  const L = D.create(world, { type: 'launcher', x, y: gy, side: 'left', facing: 1 });
  const Tu = D.create(world, { type: 'turret', x: x + 200, y: world.groundTop[x + 200] - 1, side: 'left', facing: 1 });
  const salvos = D.stats.salvos, fired = [], fireWas = S.fire;
  S.fire = function (w, spec) { if (spec.from === Tu) fired.push(spec); return fireWas.call(this, w, spec); };
  D.hold(L);
  const right = D.click(world, x + 1500, gy, 2);
  const left = D.click(world, x + 1500, gy, 0);
  D.hold(Tu);
  // (within its gun's swing: a floor turret lays no lower than a little below level)
  const spot = { x: x + 500, y: Math.min(world.groundTop[x + 500] - 30, Tu.pivot.y - 10) };
  D.click(world, spot.x, spot.y, 0);
  steps(1.5);
  S.fire = fireWas;
  D.hold(null);
  const atSpot = fired.length && fired.every((s) => Math.abs(Math.atan2(s.dy, s.dx) - Math.atan2(spot.y - s.y, spot.x - s.x)) < 0.05);
  check(left && !right && D.stats.salvos === salvos + 1 && fired.length >= 4 && atSpot,
    `by hand: a left click lays a launcher's salvo on the spot (${D.stats.salvos - salvos} salvo), a right click is not its (${!right}); a turret in hand fires a burst at the spot clicked (${fired.length} rounds, ${atSpot ? 'all at it' : 'not at it'})`);
  fresh();
}

// 5. Artillery on its base (N114, the user's: missile launchers and interceptors stand on a base on a
// roof or flat ground, not on wheels; each round costs its side HM, and with none an interceptor
// does not go). A launcher on a steel plate stands on it - nothing of it under the plate's top -
// raises its pod and fires its salvo, its side paying 2 HM a rocket; a side with 9 HM fires 4 of
// its 12; a Dome whose side has no HM fires nothing at a salvo coming down on it, and with HM it
// does, paying for each; the plate cut away under the launcher, it falls off it.
{
  fresh();
  // (a match on this world, for the rounds' price - two sides of the test's own, so no town of the
  // world's spends their stocks)
  const stock0 = world.stock, game0 = PW.game, current0 = PW.game && PW.game.current;
  if (!PW.game) PW.game = {};
  PW.game.current = () => ({ world });
  const A = 'n114a', Z = 'n114z';
  const z = layout.wilds[0], x = Math.round(z.x0 + 900), g = world.groundTop[x];
  for (let xx = x - 24; xx <= x + 24; xx += 1) for (let y = g - 6; y < g; y += 1) PW.set(world, xx, y, M.STEEL, { quiet: true });
  const base = { x0: x - 24, x1: x + 24, y: g - 6 };
  const L = D.create(world, { type: 'launcher', x, y: g - 6, base, side: A, facing: 1, style: 'modern' });
  let low = -1;
  for (let j = 0; j < L.ras.h; j += 1) for (let i = 0; i < L.ras.w; i += 1) if (L.ras.px[j * L.ras.w + i]) low = Math.max(low, L.ras.y0 + j);
  const stands = L.y === g - 7 && low === g - 7;
  world.stock = { [A]: { hm: 100 }, [Z]: { hm: 999 } };
  L.aim = { x: x + 1600, y: world.groundTop[x + 1600] };
  const r0 = D.stats.rockets;
  D.fire(world, L);
  let raised = 0;
  steps(5, () => { raised = Math.max(raised, L.el); });
  const fired = D.stats.rockets - r0, paid = 100 - world.stock[A].hm;
  await view('n114-launcher-on-base', x + 20, g - 50, 5);
  L.ammo = 12; L.reloadT = 0; world.stock[A].hm = 9;
  const r1 = D.stats.rockets;
  D.fire(world, L);
  steps(4);
  const short = D.stats.rockets - r1;
  // (the plate cut away from under the launcher)
  const off0 = D.stats.cameOff || 0;
  for (let xx = x - 24; xx <= x + 24; xx += 1) for (let y = g - 6; y < g; y += 1) PW.set(world, xx, y, M.AIR, { quiet: true });
  steps(0.5);
  const fell = L.dead && (D.stats.cameOff || 0) > off0;
  // (a Dome - its side's ground, itself on it - and the other side's launcher 2600 off, firing at
  // it: first with HM on its side, then - a Dome set down again if that salvo got through to it -
  // with none)
  const R = D.create(world, { type: 'launcher', x: x + 2700, side: Z, facing: -1 });
  let B = placeClear({ type: 'dome', side: A, facing: 1 }, along(x + 160, 40, 20));
  world.stock[A].hm = 400;
  R.aim = { x: B ? B.x : x, y: g };
  const l1 = D.stats.launched;
  D.fire(world, R);
  steps(14);
  const firedPaid = D.stats.launched - l1, paidDome = 400 - world.stock[A].hm;
  world.shots = [];
  if (!B || B.dead) B = placeClear({ type: 'dome', side: A, facing: 1 }, along(x + 160, 40, 20));
  R.ammo = 12; R.reloadT = 0; world.stock[A].hm = 0;
  R.aim = { x: B ? B.x : x, y: g };
  const l0 = D.stats.launched, n0 = D.stats.noHm || 0;
  D.fire(world, R);
  steps(14);
  const firedBroke = D.stats.launched - l0, refused = (D.stats.noHm || 0) - n0;
  world.shots = [];
  world.stock = stock0;
  if (game0) PW.game.current = current0; else delete PW.game;
  check(stands && raised > 0.8 && fired === 12 && paid === 24 && short === 4,
    `a launcher on a steel plate stands on it, no wheels (its lowest cells ${low === g - 7 ? 'on the plate' : `at ${g - low} over the ground`}); it raises its pod (to ${(raised * 57.3).toFixed(0)} deg) and fires its salvo (${fired} rockets), its side paying ${paid} HM for it; a side with 9 HM fires ${short} of the 12`);
  check(!!B && firedBroke === 0 && refused > 0 && firedPaid >= 2 && paidDome === firedPaid * D.PRICE.interceptor && fell,
    `a Dome whose side has no HM fires no interceptor at a salvo coming down on it (${firedBroke} fired, ${refused} times it had none to pay with); with HM it does (${firedPaid}, ${paidDome} HM paid); the plate cut away under the launcher, it falls off it (${fell})`);
  fresh();
}

// 4. What they cost: two batteries watching a sky full of a salvo coming down on them; and drawing
// three units.
{
  fresh();
  const z = layout.wilds[0], x = z.x0 + 500, g = world.groundTop[x];
  const B = D.create(world, { type: 'dome', x, side: 'left' }), P = D.create(world, { type: 'patriot', x: x + 300, side: 'left' });
  const L = D.create(world, { type: 'launcher', x: x + 2600, side: 'right', facing: -1 });
  L.aim = { x, y: g };
  D.fire(world, L);
  // (the salvo up, and coming down, the batteries holding their fire: the units and rounds stepped,
  // the world not)
  B.hold = P.hold = true;
  for (let k = 0; k < 6 * 60; k += 1) PW.tanks.step(world, 1 / 60);
  B.hold = P.hold = false;
  const best = (n, m, work) => { let min = Infinity; for (let b = 0; b < n; b += 1) { const t0 = performance.now(); for (let q = 0; q < m; q += 1) work(); min = Math.min(min, (performance.now() - t0) / m); } return min; };
  const inFlight = (world.shots || []).filter((s) => s.kind === 'rocket').length;
  let ms = 0;
  { const t0 = performance.now(); for (let q = 0; q < 60; q += 1) D.step(world, 1 / 60); ms = (performance.now() - t0) / 60; }
  const r = { ctx: document.createElement('canvas').getContext('2d'), world, camera: { x: x - 200, y: g - 300, zoom: 2 }, view: { width: 1600, height: 900 } };
  const drawMs = best(5, 10, () => D.draw(r));
  check(inFlight >= 10 && ms < 0.3 && drawMs < 1, `they cost little: two batteries watching ${inFlight} rockets coming down, ${ms.toFixed(3)} ms a tick; ${drawMs.toFixed(2)} ms to draw the three`);
  world.shots = [];
  fresh();
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
