// The tunnel and traversal lab (N92; run with --page=pw-unit-lab.html --ready="window.pwLab && pwLab.ready"
// --params=det=1&seed=N): the course is dug before your eyes and lined behind the miners; a squad
// sent through it finds its way - crouching through the crawl, down a ladder, along the lower level
// and through the cave, up a ladder and out - all of it arriving; a room beyond a flooded sump is
// no way, and none of them drowns trying; behind a bump on a hallway's floor a man crouched is
// covered from a rifle's fire, standing he is not, and a blast reaches him either way.
const L = pwLab, { world } = L, U = PW.troops;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { L.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
L.setPaused(true);
const M = L.marks;

// 1. The course is dug strip by strip as you watch, and lined (developed) behind the miners.
{
  let k = 0, halfway = false;
  for (; k < 60 * 120 && L.dug() < L.steps.length; k += 1) {
    L.stepWorld(1);
    if (!halfway && L.dug() >= L.steps.length / 2) { halfway = true; await view('lab-growing', 2300, 1060, 3); }
  }
  const T = L.net;
  check(L.dug() === L.steps.length && k > 60 && T.cells > 50000 && T.developed > 0,
    `the course is dug as you watch: ${L.steps.length} strips over ${(k / 60).toFixed(1)} s at x16 (${T.cells} tunnel cells; ${T.developed} lined behind the miners so far)`);
}

// 2. The squad, sent through as soon as it is dug, goes all the way: crouched through the crawl,
// down the ladder, through the cave, up the other ladder and out on the far plain.
{
  const seen = new Map(L.squad.map((t) => [t, { crawl: false, down: false, up: false, cave: false, cover: false, at: -1 }]));
  let k = 0, sawLadder = false, sawCave = false, sawCrawl = false;
  const done = () => L.squad.every((t) => t.dead || t.lost || (!t.route && t.arrived));
  for (; k < 60 * 240 && !done(); k += 1) {
    L.stepWorld(1);
    for (const t of L.squad) {
      const s = seen.get(t);
      if (t.x > 2304 && t.x < 2418 && t.crouch) s.crawl = true;
      if (t.climbing && Math.abs(t.x - M.shaftDown.x) < 10 && t.y > M.shaftDown.y + 20) s.down = true;
      if (t.climbing && Math.abs(t.x - M.shaftUp.x) < 10 && t.y < M.shaftUp.y - 20) s.up = true;
      if (Math.abs(t.x - L.CAVE.x) < 120 && t.y > L.CAVE.y) s.cave = true;
      if (U.underground(world, t)) s.cover = true;
      if (s.at < 0 && !t.route && t.arrived && Math.abs(t.x - M.exit.x) < 30) s.at = k;
    }
    const t = L.squad[0];
    if (!sawCrawl && t.x > 2340 && t.x < 2400) { sawCrawl = true; await view('lab-crawl', 2360, 990, 5); }
    if (!sawLadder && t.climbing && Math.abs(t.x - M.shaftDown.x) < 10 && t.y > 1060) { sawLadder = true; await view('lab-ladder', M.shaftDown.x, 1070, 4); }
    if (!sawCave && Math.abs(t.x - L.CAVE.x) < 40) { sawCave = true; await view('lab-cave', L.CAVE.x, L.CAVE.y + 20, 4); }
  }
  await view('lab-out', M.exit.x - 150, M.exit.y - 30, 4);
  const rows = [...seen.entries()].map(([t, s]) => `${s.at >= 0 ? `out at ${(s.at / 60).toFixed(0)} s` : t.dead ? `dead (${t.hurtBy})` : t.lost ? 'lost' : `at ${t.x.toFixed(0)},${t.y}`}${s.crawl ? '' : ', never crouched'}${s.down ? '' : ', never down'}${s.cave ? '' : ', no cave'}${s.up ? '' : ', never up'}`);
  check([...seen.values()].every((s) => s.at >= 0 && s.crawl && s.down && s.up && s.cave && s.cover),
    `a squad of ${L.squad.length} sent through the course finds its way and comes out on the far plain - crouched through the crawl, down a ladder, through the cave, up a ladder: ${rows.join('; ')}`);
}

// 3. A flooded tunnel is no way: a trooper told to go to the room beyond the sump is not led into
// the water; it goes as near as it can get on dry feet - the sump's edge, or the level over the
// room - never into the room past the water, and does not drown.
{
  const t = U.create(world, { x: 2620.5, y: M.shaftDown.y + 160, side: 'left', style: 'asian' });
  for (let k = 0; k < 60; k += 1) L.stepWorld(1);
  const r = U.goTo(world, t, M.beyondSump.x, M.beyondSump.y);
  let wettest = 0;
  for (let k = 0; k < 60 * 30 && (t.route || k < 60); k += 1) { L.stepWorld(1); wettest = Math.max(wettest, t.wet || 0); }
  const past = t.x < M.beyondSump.x + 50 && Math.abs(t.y - M.beyondSump.y) < 30;
  check(r && !r.reached && !t.dead && !past && wettest < 0.6,
    `a room beyond a flooded sump is no way: told to go there, the trooper is not led through the water (${r ? (r.reached ? 'a way found' : 'no way found') : 'no route'}); it stops as near as it gets dry, at ${t.x.toFixed(0)},${t.y} (${past ? 'past the water' : t.y < M.beyondSump.y - 30 ? 'the level over the room' : 'at the edge'}), never more than ${(wettest * 100).toFixed(0)}% in the water, alive`);
  t.hp = 0; t.dead = true; t.deadFor = 99;
}

// 4. Cover: a man behind a bump of sandbags on the hallway floor, a sentry of the other side
// firing at him down the hallway - standing, the rounds strike him; crouched, the bump takes them.
// A grenade's blast on the far side of the bump reaches him all the same.
{
  const bx = M.cover.x, fx = bx - 9;
  const friend = U.create(world, { x: fx + 0.5, y: M.cover.y, side: 'left', facing: 1 });
  // (the sentry 70 cells down the hallway - the next bump behind it, only this one between them)
  const foe = U.create(world, { x: bx + 70.5, y: M.cover.y, side: 'right', facing: -1, style: 'gothic' });
  const volley = (crouch) => {
    friend.crouch = crouch; friend.hp = U.HP; friend.dead = false;
    for (let k = 0; k < 20; k += 1) {
      foe.aim = { x: friend.x, y: friend.y - (crouch ? 10 : 19) }; foe.cooldown = 0; foe.reload = 0; foe.mag = U.MAG;
      U.fire(world, foe);
      for (let q = 0; q < 12; q += 1) L.stepWorld(1);
    }
    return U.HP - friend.hp;
  };
  const standing = volley(false), crouched = volley(true);
  await view('lab-cover', bx + 40, M.cover.y - 10, 5);
  friend.hp = U.HP; friend.dead = false; friend.crouch = true;
  PW.explode(world, world.particles, { x: bx + 7, y: M.cover.y - 2, radius: 8, power: 0.8 });
  for (let k = 0; k < 30; k += 1) L.stepWorld(1);
  const blasted = U.HP - friend.hp;
  check(standing >= 60 && crouched <= standing * 0.25 && blasted > 0,
    `behind a bump of sandbags a man crouched is covered from a sentry's fire down the hallway (20 rounds: ${crouched.toFixed(0)} of his armour lost crouched, ${standing.toFixed(0)} standing), and a blast beyond the bump reaches him all the same (${blasted.toFixed(0)})`);
  for (const t of [friend, foe]) { t.hp = 0; t.dead = true; t.deadFor = 99; }
}

// 5. What it costs: finding the whole way through the course; a tick of a squad on its way.
{
  const t = U.create(world, { x: M.start.x + 0.5, side: 'left' });
  let planMs = Infinity;
  for (let b = 0; b < 3; b += 1) { const t0 = performance.now(); U.plan(world, t, M.exit); planMs = Math.min(planMs, performance.now() - t0); }
  for (const s of L.squad) if (!s.dead) U.goTo(world, s, M.start.x, M.start.y);
  let tickMs = Infinity;
  for (let b = 0; b < 5; b += 1) { const t0 = performance.now(); for (let q = 0; q < 20; q += 1) U.step(world, 1 / 60); tickMs = Math.min(tickMs, (performance.now() - t0) / 20); }
  check(planMs < 150 && tickMs < 0.5, `it costs little: the way through the whole course found in ${planMs.toFixed(0)} ms, a tick of the squad on its way ${tickMs.toFixed(3)} ms`);
}
L.setPaused(false);
return { checks, shots: shots.length };
