// The user's (2026-11-23): one computer player that is all three - it builds, fortifies or rushes as its
// situation turns - and takes its own units in hand in a fight. On the game page, you against it
// (mode=game&start=versus&side=left&det=1): the computer holds the right. Each situation is set up
// for it and its answer read off its brain and its units.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world } = pwApp;
const m = pwApp.match(), G = PW.game, ai = m.sides.right.ai, b = ai.brain;
const secs = (s) => { for (let k = 0; k < s; k += 1) pwApp.stepWorld(60); };
const ground = (x) => world.groundTop[Math.round(x)];
const dirR = m.sides.right.dir;   // (-1: the right side faces left)
const front = () => G.frontOf(m, 'right', true);
const clear = (side) => { for (const list of ['troops', 'tanks', 'mechs']) for (const u of world[list] || []) if (u.side === side && !u.building) u.dead = true; };
world.stock.right.hm = 8000; world.stock.right.sm = 2000;

// 1. A quiet field: it builds.
secs(4);
check(b.posture === 'build', `a quiet field: it builds (posture ${b.posture})`);

// 2. The enemy at its door: it fortifies - and sends what it has at them, sets defences.
const fx = Math.round(front() - dirR * 160);   // (in its own ground, past its front)
const raiders = [];
for (let k = 0; k < 3; k += 1) raiders.push(PW.tanks.create(world, { style: 'modern', side: 'left', x: fx + k * 40 * dirR, facing: dirR }));
for (let k = 0; k < 6; k += 1) raiders.push(PW.troops.create(world, { x: fx + 0.5 + k * 14 * dirR, y: ground(fx + k * 14 * dirR), side: 'left', style: 'modern', facing: dirR }));
const def0 = (b.defends || 0), tur0 = (b.turrets || 0) + (b.artillery || 0);
for (let s = 0; s < 20 && b.posture !== 'fortify'; s += 1) secs(1);
check(b.posture === 'fortify', `the enemy at its door (${b.sized ? `power ${b.sized.near} near, its own ${b.sized.mine}` : '-'}): it fortifies (posture ${b.posture})`);
secs(15);
check((b.defends || 0) > def0 || (b.turrets || 0) + (b.artillery || 0) > tur0,
  `fortifying, it answers - its men sent at them (${(b.defends || 0) - def0}) or defences set (${(b.turrets || 0) + (b.artillery || 0) - tur0})`);
await (async () => { pwApp.focus(fx, ground(fx) - 60, 3); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot('ai-fortify')); })();

// 3. Its hands in the fight: a grenade into a knot of men, a missile at armour, focus on the weakest,
// the badly hurt falling back.
clear('left'); clear('right'); secs(1);
const hx = Math.round(front() + dirR * 260);   // (out in front of its town)
const mine = PW.troops.create(world, { x: hx + 0.5, y: ground(hx), side: 'right', style: 'modern', facing: -dirR });
mine.game = { side: 'right', kind: 'trooper', order: { type: 'auto' }, goal: null, born: m.clock };
const knot = [0, 1, 2].map((k) => PW.troops.create(world, { x: hx - dirR * (110 + k * 12) + 0.5, y: ground(hx - dirR * (110 + k * 12)), side: 'left', style: 'modern', facing: dirR }));
knot[1].hp = (PW.troops.HP || 100) * 0.2;   // (the weakest)
// (the other two stand the few seconds: on some worlds its town's turrets reach them first)
knot[0].hp = knot[2].hp = 1e6;
const g0 = mine.grenades, gr0 = b.grenades || 0;
for (let s = 0; s < 8 && (b.grenades || 0) === gr0; s += 1) secs(1);
check((b.grenades || 0) > gr0 && mine.grenades < g0, `a trooper of its own throws a grenade into a knot of three (${g0} -> ${mine.grenades})`);
check(mine.game.focus === knot[1] || knot[1].dead, `it focuses the weakest in reach (${mine.game.focus ? (mine.game.focus === knot[1] ? 'the weak one' : 'another') : 'none'}${knot[1].dead ? ', down' : ''})`);
clear('left'); clear('right'); secs(1);
if (PW.mechs) {
  const mech = PW.mechs.create(world, { x: hx, side: 'right', style: 'modern', facing: -dirR });
  mech.game = { side: 'right', kind: 'mech', order: { type: 'auto' }, goal: null, born: m.clock };
  const tank = PW.tanks.create(world, { style: 'modern', side: 'left', x: hx - dirR * 260, facing: dirR });
  tank.hp = 1e6;   // (it must stand till the mech has looked: its town's turrets reach it on some worlds)
  const m0 = mech.missiles, mi0 = b.missiles || 0;
  for (let s = 0; s < 8 && (b.missiles || 0) === mi0; s += 1) secs(1);
  check((b.missiles || 0) > mi0 && mech.missiles < m0, `a mech of its own looses a missile at a tank (${m0} -> ${mech.missiles})`);
  tank.dead = true; mech.dead = true;
}
// (its town's own guns held, as a hack holds them: N155's watch-tower base stands its hall turret at
// the town's front, and its rounds at the man finished the hurt tank behind him first - seed 3)
for (const u of world.defence || []) if (!u.dead && u.side === 'right' && Math.abs(u.x - hx) < 900 && PW.units && PW.units.disable) PW.units.disable(u, 10);
const hurt = PW.tanks.create(world, { style: 'modern', side: 'right', x: hx, facing: -dirR });
hurt.game = { side: 'right', kind: 'tank', order: { type: 'auto' }, goal: null, born: m.clock };
hurt.hp = (PW.tanks.ARMOUR || 100) * 0.26;   // (under the commander's 0.3 - and a hit or two from gone)
// (a tank to face it: a man in reach went down to its gun before the fight was looked at)
// (a man to face it, who stands the 4 s - and whose rifle does not finish the hurt tank first)
const foeT = PW.troops.create(world, { x: hx - dirR * 200 + 0.5, y: ground(hx - dirR * 200), side: 'left', style: 'modern', facing: dirR });
foeT.hp = 1e6;
// (looked at as the commander looks - every look or two - until it has fallen back, 4 s at most:
// hurt that badly, a hit or two more ends it)
for (let k = 0; k < 24 && !hurt.game.fallback && !hurt.dead; k += 1) pwApp.stepWorld(10);
// (fallen back, it waits with the gathered for the next wave - which may already have gone, its
// order 'auto' again: the falling back is the proof)
check(!!hurt.game.fallback, `a badly hurt tank falls back to go with the next wave (${hurt.game.fallback ? 'falling back' : 'stays'}, ${hurt.game.order.type}; hurt ${hurt.dead ? 'dead' : `hp ${Math.round(hurt.hp)} at ${Math.round(hurt.x)},${Math.round(hurt.y)}`}, foe ${foeT.dead ? 'dead' : `at ${Math.round(foeT.x)},${Math.round(foeT.y)}${PW.vision.sees(world, 'right', foeT.x) ? ' seen' : ' unseen'}`})`);
hurt.dead = true; foeT.dead = true;

// 4. It outguns what it sees: it rushes - small waves early.
// (the field cleared of the fights above, and room left in its army for the waves it sends)
clear('left'); clear('right'); secs(1);
// (and the bases' spawn pads cleared of the fights' wrecks: a deploy comes up only where there is
// room on its core's pad - N130 with PS's spawnPoint - and the hurt tank above died on one)
for (const side of ['left', 'right']) for (const q of G.bases(m, side)) {
  if (!q.pad) continue;
  for (let y = q.pad.y - 70; y < q.pad.y; y += 1) for (let x = q.pad.x0 - 10; x <= q.pad.x1 + 10; x += 1) {
    const id = PW.get(world, x, y) & 63;
    if (id === PW.M.WRECK || id === PW.M.DEBRIS || id === PW.M.SMOKE) PW.set(world, x, y, PW.M.AIR);
  }
}
const waves0 = b.waves;
// (deployed as its own arming would: gathered at the rally for the next wave)
const refused = [];
for (let k = 0; k < 10; k += 1) {
  const d = G.deploy(m, 'right', k % 3 ? 'trooper' : 'tank');
  if (d.ok && d.unit.game) d.unit.game.order = { type: 'gather' };
  else if (!d.ok) refused.push(`${k % 3 ? 'trooper' : 'tank'}: ${d.note}`);
}
if (refused.length) {
  const rb = G.bases(m, 'right')[0], at = rb && G.exitOf(m, rb, 'trooper');
  const col = [];
  if (at) for (let y = at.y - 26; y <= at.y + 2; y += 2) col.push(PW.mat.names[PW.get(world, at.x, y) & 63]);
  info(`deploys refused: ${refused.slice(0, 3).join('; ')}${refused.length > 3 ? ` (+${refused.length - 3})` : ''}; at the exit ${at ? `${at.x},${at.y}${at.pad ? ' (pad)' : ''}: ${col.join(' ')}` : 'none'}`);
}
for (let s = 0; s < 30 && !(b.posture === 'rush' && b.waves > waves0); s += 1) secs(1);
check(b.posture === 'rush', `with ${b.sized ? b.sized.mine : '?'} power to the enemy's ${b.sized ? b.sized.theirs : '?'} in sight: it rushes (posture ${b.posture})`);
check(b.waves > waves0, `rushing, it sends a wave out (${b.waves - waves0}; last: ${b.last})`);
info(`postures it took: ${b.shifts} shifts; units it took in hand ${b.handled || 0} times`);
return { checks, shots };
