// Units (N5, N7; run with --page=pw-unit-lab.html --ready="window.pwLab && pwLab.ready" --params=det=1&go=0&seed=N):
// the item bar; a drill picked up; drilling - fast through soil, slow through stone, stopped by ore;
// a shaft with its ladder, climbed back out; a bore that reaches the open and its side's tunnels
// taken into them; a man in a secret bore seen only close to; a guard holding its post, and a man
// crouched creeping past it unseen; a turret's arc, and a turret put out of action a while; orders
// to a trooper, a tank and a mech (over a cliff); a trooper at work at a panel; a skirmish in the
// tunnels; and what the sentries cost.
const L = pwLab, { world } = L, U = PW.troops, N = PW.units;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { L.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
L.setPaused(true);
L.digAll();
const M = L.marks, run = (secs, each) => { for (let k = 0; k < Math.round(secs * 60); k += 1) { L.stepWorld(1); if (each && each(k) === false) break; } };
run(2);
const kill = (...ts) => { for (const t of ts) { t.hp = 0; t.dead = true; t.deadFor = 99; } };
const id = (x, y) => PW.get(world, x, y) & PW.ID_MASK;

// 1. The item bar: its rifle, its grenades, no drill; 1 2 3 take one in hand, F uses it.
{
  const t = U.create(world, { x: M.room.x + 0.5, y: M.room.y, side: 'left' });
  run(0.2);
  const k = (code) => { U.hold(t); U.key({ code, repeat: false }); };
  const noDrill = !U.select(t, 'drill');
  k('Digit2'); const g0 = t.grenades; t.aim = { x: t.x + 80, y: t.y - 10 }; k('KeyF');
  const threw = g0 - t.grenades;
  k('Digit1'); const m0 = t.mag; k('KeyF');
  run(4);
  const bar = U.items(t).map((i) => `${i.slot} ${i.count}`).join(', ');
  check(noDrill && threw === 1 && t.mag === m0 - 1 && t.slot === 'rifle',
    `the item bar: ${bar}; no drill to take in hand (${noDrill}); 2 then F throws a grenade (${threw}), 1 then F fires a round (${m0} -> ${t.mag})`);
  U.hold(null); kill(t);
}

// 2. A drill lying in a tunnel: a trooper walking over it picks it up.
{
  const DR = PW.pickups.DRILL, x = M.cover.x - 60, floor = M.cover.y, top = floor - DR.length + 1, cells = [];
  for (let r = 0; r < DR.length; r += 1) for (let c = 0; c < DR[0].length; c += 1) if (DR[r][c] !== '.') { PW.setLayer(world, 'deco', x + c, top + r, PW.abgr(222, 168, 38)); cells.push((top + r) * world.width + x + c); }
  const p = { kind: 'drill', x, y: top, w: DR[0].length, h: DR.length, facing: 1, cells };
  (world.pickups || (world.pickups = [])).push(p);
  const t = U.create(world, { x: x - 40.5, y: floor, side: 'left' });
  U.goTo(world, t, x + 40, floor);
  run(6);
  check(t.drill === 1 && !world.pickups.includes(p) && !PW.getLayer(world, 'deco', x + 4, floor - 1),
    `a trooper walking over a drill lying in a tunnel picks it up (has a drill: ${!!t.drill}; the drill gone from the floor: ${!world.pickups.includes(p)})`);
  kill(t);
}

// 3. Drilling: along through soil (under the right plain) and through stone (under the hill), the
// stone the slower; ore stops it.
const rate = (t, way, secs) => {
  const x0 = t.x, y0 = t.y;
  U.drill(world, t, way);
  run(secs);
  U.stopDrill(t);
  return Math.max(Math.abs(t.x - x0), Math.abs(t.y - y0)) / secs;
};
// (a pocket cut in the ground - 25 across, 30 high, floor at row `floor` - a miner put in it)
const pocket = (x, floor) => {
  for (let y = floor - 29; y <= floor; y += 1) for (let xx = x - 12; xx <= x + 12; xx += 1) PW.set(world, xx, y, PW.M.AIR, { quiet: true });
  return U.create(world, { x: x + 0.5, y: floor, side: 'left', unit: 'miner' });
};
{
  // (soil: under the right plain; stone: deep under it; ore: a vein across the way, in soil)
  const m = pocket(4600, 990), s = pocket(5200, 1330), o = pocket(5700, 990);
  for (let y = 950; y <= 990; y += 1) for (let x = 5720; x <= 5724; x += 1) PW.set(world, x, y, PW.M.ORE, { quiet: true });
  run(0.5);
  const soil = rate(m, [1, 0], 3);
  await view('drill-soil', m.x - 30, m.y - 14, 5);
  const stone = rate(s, [1, 0], 4);
  U.drill(world, o, [1, 0]);
  run(3);
  check(soil > 14 && soil < 30 && stone > 2.5 && stone < 7 && !o.drilling && o.drillStopped === 'hard',
    `drilling along: ${soil.toFixed(1)} cells/s through soil (about 1.5 m/s), ${stone.toFixed(1)} through stone (0.3 m/s); a seam of ore stops it (${o.drillStopped || 'still drilling'})`);
  kill(m, s, o);
}

// 4. A shaft: drilled straight down from the plain, its ladder fixed in it as it goes; the trooper
// climbs back out by it.
{
  const px = 4900, gy = world.groundTop[px] - 1;
  const t = U.create(world, { x: px + 0.5, y: gy, side: 'left', unit: 'miner' });
  run(0.3);
  const yStart = t.y;
  U.drill(world, t, [0, 1]);
  run(4);
  const why = `${t.drillStopped || (t.drilling ? 'drilling' : 'stopped')}, from ${yStart} (ground ${gy}), dead ${t.dead}`;
  U.stopDrill(t);
  const deep = t.y - gy, ladder = (PW.getFlags(world, px, gy + deep - 4) & PW.FLAG.LADDER) !== 0;
  await view('drill-shaft', px, gy + deep / 2, 4);
  U.goTo(world, t, px + 40, gy);
  run(12);
  check(deep > 40 && ladder && Math.abs(t.y - gy) < 4 && !t.dead,
    `a shaft drilled straight down ${deep} cells with its ladder fixed in it (${ladder}); the trooper climbs back out by it (${t.y - gy} cells from the surface) [${why}]`);
  kill(t);
}

// 5. A bore from the lab's own tunnels up through the cliff to the open: taken into its side's
// tunnels, lined like the rest - no secret now. One drilled out of the open plain, meeting no
// tunnel, stays a secret.
{
  const ax = 4062, t = U.create(world, { x: ax + 0.5, y: M.exit.y, side: 'left', unit: 'miner' });
  run(0.3);
  const joined0 = U.stats.boresJoined || 0;
  U.drill(world, t, [0, -1]);
  run(30, () => !t.drilling ? false : undefined);
  const joined = (U.stats.boresJoined || 0) - joined0;
  const cell = { x: ax, y: t.y + 10 }, net = PW.tunnels.netAt(world, cell.x, cell.y), secret = (PW.getFlags(world, cell.x, cell.y) & PW.FLAG.BORE) !== 0;
  run(10);
  await view('bore-joined', ax, M.exit.y - 60, 4);
  const plain = (world.bores || []).filter((b) => !b.joined && b.cells.length);
  check(joined === 1 && net === L.net.id && !secret && t.drillStopped === 'open' && plain.length >= 1,
    `a bore drilled up from the lab's tunnels breaks out into the open (${t.drillStopped}) and is taken into its side's tunnels (network ${net}, a secret no longer: ${!secret}); ${plain.length} bores dug from the open plain meeting no tunnel stay secret`);
  kill(t);
}

// 6. A man in a secret bore is seen only close to: a sentry down the bore sees him at 100 cells,
// not at 200.
{
  // (a long bore drilled along through the soil from a pocket under the plain)
  const m = pocket(5000, 990), x0 = m.x;
  U.drill(world, m, [1, 0]);
  run(16);
  U.stopDrill(m);
  const a = U.create(world, { x: x0 + 40.5, y: 990, side: 'left', facing: 1 });
  const near = U.create(world, { x: x0 + 140.5, y: 990, side: 'right', facing: -1 });
  const far = U.create(world, { x: x0 + 260.5, y: 990, side: 'right', facing: -1 });
  kill(m);
  run(0.3);
  const seenNear = N.sees(world, near, a), seenFar = N.sees(world, far, a), inBore = U.inBore(world, a);
  check(inBore && seenNear && !seenFar && far.x < m.x,
    `a man in a secret bore (${inBore}) is seen by a sentry 100 cells off (${seenNear}) but not by one 220 off (${seenFar}) - out in the open, 420 (the bore drilled ${(m.x - x0).toFixed(0)} cells)`);
  kill(a, near, far);
}

// 7. A guard holds its post and fires at the enemy it sees; a man crouched creeps up on it unseen -
// till he fires.
{
  const gx = M.cover.x + 40;
  const g = U.create(world, { x: gx + 0.5, y: M.cover.y, side: 'right', unit: 'guard', facing: -1 });
  const walker = U.create(world, { x: gx - 240.5, y: M.cover.y, side: 'left', facing: 1 });
  U.walk(walker, 1);
  run(5);
  const hitWalker = U.HP - walker.hp;
  kill(walker);
  const creep = U.create(world, { x: gx - 240.5, y: M.cover.y, side: 'left', facing: 1 });
  creep.crouch = true; U.walk(creep, 1);
  let seenCreep = false;
  run(8, () => { if (N.sees(world, g, creep)) seenCreep = true; if (creep.x > gx - 60) U.walk(creep, 0); });
  const hpCreep = creep.hp;
  creep.aim = { x: g.x, y: g.y - 16 }; U.fire(world, creep);
  run(2);
  const seenAfterFiring = N.sees(world, g, creep);
  await view('guard', gx - 100, M.cover.y - 10, 4);
  check(g.look === 'guard' && hitWalker > 30 && !seenCreep && hpCreep === U.HP && seenAfterFiring && Math.abs(g.x - gx) < 20,
    `a guard (in lavender) holds its post (${Math.abs(g.x - gx).toFixed(0)} cells off it) and fires at a man walking up (${hitWalker.toFixed(0)} of his armour); one crouched creeps up to ${(gx - creep.x).toFixed(0)} cells unseen (${!seenCreep}, unhurt) - till he fires, and is seen (${seenAfterFiring})`);
  kill(g, creep);
}

// 8. A turret on its mount fires at the enemy in its arc - not at one behind it; put out of action
// (a hack), it is silent a while, then fires again.
{
  const tx = 4700, ty = world.groundTop[tx] - 1, D = PW.defence;
  const tu = D.create(world, { type: 'turret', x: tx, y: ty, facing: -1, side: 'right' });
  const ahead = U.create(world, { x: tx - 260.5, side: 'left', facing: 1 }), behind = U.create(world, { x: tx + 200.5, side: 'left', facing: -1 });
  run(4);
  const hitAhead = U.HP - ahead.hp, hitBehind = U.HP - behind.hp;
  kill(ahead);
  const next = U.create(world, { x: tx - 260.5, side: 'left', facing: 1 });
  D.disable(tu, 5);
  run(4.5);
  const whileOff = U.HP - next.hp;
  run(4);
  const after = U.HP - next.hp;
  await view('turret', tx - 120, ty - 20, 4);
  check(hitAhead > 30 && hitBehind === 0 && whileOff === 0 && after > 0,
    `a turret fires at a man in its arc (${hitAhead.toFixed(0)} of his armour) and not at one behind it (${hitBehind}); put out of action for 5 s it is silent (${whileOff}), then fires again (${after.toFixed(0)})`);
  kill(behind, next); tu.dead = true;
}

// 9. Orders: a trooper told to move finds its way; a tank driven to a place stops there; a mech
// told to cross the cliff leaps and boosts up it.
{
  // (on the left plain and over the hill's near cliff)
  const t = U.create(world, { x: M.start.x - 60 + 0.5, side: 'left' });
  const tank = PW.tanks.create(world, { style: 'modern', side: 'left', x: 200, y: world.groundTop[200], facing: 1 });
  const mech = PW.mechs.create(world, { x: 1250.5, side: 'left', facing: 1 });
  N.order(world, t, { type: 'move', x: M.room.x, y: M.room.y });
  N.order(world, tank, { type: 'move', x: 700 });
  N.order(world, mech, { type: 'move', x: 1800 });
  run(60);
  await view('orders-mech', mech.x, mech.y - 60, 3);
  check(Math.abs(t.x - M.room.x) < 40 && Math.abs(tank.x - 700) < 40 && Math.abs(tank.v) < 5 && mech.x > 1530 && mech.y < 700,
    `orders: a trooper told to the room finds its way there (${Math.abs(t.x - M.room.x).toFixed(0)} cells off); a tank driven to a place stops there (${Math.abs(tank.x - 700).toFixed(0)} off); a mech told over the cliff leaps and boosts up it (at ${mech.x.toFixed(0)},${mech.y})`);
  kill(t); tank.dead = true; mech.dead = true;
}

// 10. At work: a trooper at a panel works it until it moves.
{
  const t = U.create(world, { x: M.room.x + 0.5, y: M.room.y, side: 'left' });
  run(0.3);
  U.work(t, { x: t.x + 20, y: t.y - 10 });
  run(2);
  const working = !!t.working && t.working.at > 1.5;
  U.walk(t, 1); run(0.5);
  check(working && !t.working, `a trooper set to work at a panel works it (${working}) until it moves (${!t.working})`);
  kill(t);
}

// 11. A skirmish down the long hallway: four of ours, four of theirs, each fighting on its own -
// it is fought out, fire exchanged, men getting down or behind the bumps.
{
  const { ours, theirs } = L.skirmish(4);
  const fired0 = U.stats.fired;
  let crouched = 0, sawFight = false;
  run(60, (k) => { for (const t of [...ours, ...theirs]) if (!t.dead && t.crouch) crouched += 1; if (!sawFight && U.stats.fired - fired0 > 20) sawFight = true; if (ours.every((t) => t.dead) || theirs.every((t) => t.dead)) return false; });
  await view('skirmish', M.cover.x, M.cover.y - 10, 4);
  const left = ours.filter((t) => !t.dead).length, right = theirs.filter((t) => !t.dead).length;
  check(sawFight && (left === 0 || right === 0 || left + right < 8) && crouched > 0,
    `a skirmish down the hallway is fought out: ${U.stats.fired - fired0} rounds fired, men down behind cover (${crouched} crouched-ticks), ${N.stats.grenades} grenades; ${left} of ours and ${right} of theirs left standing`);
  kill(...ours, ...theirs);
}

// 12. What the sentries cost: forty troopers on their own, a tick.
{
  const crowd = [];
  for (let k = 0; k < 40; k += 1) crowd.push(U.create(world, { x: 4400 + k * 30 + 0.5, side: k & 1 ? 'left' : 'right', order: { type: 'hold', at: 0 } }));
  run(0.5);
  let ms = Infinity;
  for (let b = 0; b < 5; b += 1) { const t0 = performance.now(); for (let q = 0; q < 20; q += 1) N.step(world, 1 / 60); ms = Math.min(ms, (performance.now() - t0) / 20); }
  check(ms < 1, `forty troopers on their own cost ${ms.toFixed(3)} ms a tick`);
  kill(...crowd);
}
L.setPaused(false);
return { checks, shots: shots.length };
