// N6 - the match's rules (pixel-world.html?mode=game&start=versus&side=left&det=1):
//   1. deploying: a base deploys by its level, in HM and within the side's population, and what it
//      deploys goes its own way towards the enemy;
//   2. hacking: a trooper at an enemy base's panel for 15 s silences its defences for a while, then
//      the base sends out guards and cannot be hacked again for two minutes; one leaving the panel
//      breaks it off; at a tower's panel the enemy's sight is the hacker's for a while;
//   3. cover: a side's own buildings let its rounds through, anyone else's stop them.
// The troopers are put at the panels by hand (their walk there is PS's route, tested in pw-troops and
// pw-unit-lab): what is tested here are the rules on top. The ruins and the win are pw-game-win's.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const { world } = pwApp;
const m = pwApp.match(), G = PW.game;
const step = (s) => pwApp.stepWorld(Math.round(s * 60));

// ---- 1. Deploying ----------------------------------------------------------------------------------
const bases = G.bases(m, 'left');
check(bases.length > 0, `the left side has standing bases (${bases.map((b) => `L${b.level}`).join(' ')})`);
const hm0 = G.purse(m, 'left').hm;
const d1 = G.deploy(m, 'left', 'trooper');
check(d1.ok && d1.unit.side === 'left' && d1.unit.style === m.sides.left.style && Math.round(hm0 - G.purse(m, 'left').hm) === G.UNIT_KINDS.trooper.hm,
  `a trooper deploys from a base, in the side's dress, for ${G.UNIT_KINDS.trooper.hm} HM`);
const top = Math.max(...bases.map((b) => b.level || 1));
const locked = Object.keys(G.UNIT_KINDS).find((k) => G.UNIT_KINDS[k].level > top);
if (locked) check(!G.canDeploy(m, 'left', locked).ok, `a ${locked} needs a level ${G.UNIT_KINDS[locked].level} base (the best is ${top})`);
world.stock.left.hm = 5;
check(!G.canDeploy(m, 'left', 'trooper').ok, 'with no HM nothing deploys');
world.stock.left.hm = 5000;
let n = 0;
for (let i = 0; i < 200 && G.deploy(m, 'left', 'trooper').ok; i += 1) n += 1;
check(G.fielded(m, 'left') <= G.armyCap(m, 'left') && n > 0 && !G.canDeploy(m, 'left', 'trooper').ok,
  `the army stops at the population (${G.fielded(m, 'left')} fielded, cap ${G.armyCap(m, 'left')} for POP ${G.purse(m, 'left').pop})`);
const army = G.unitsOf(m, 'left').filter((u) => !u.building);
const troopers = army.filter((u) => u.kind === 'trooper');
check(troopers.length >= 2, `troopers to work with (${troopers.length})`);
if (troopers.length < 2) return { checks };
const x0 = troopers.map((u) => u.x);
step(10);
check(troopers.some((u, i) => u.order && (u.order.type === 'move' || u.order.type === 'attack') && (Math.abs(u.x - x0[i]) > 15 || u.route)),
  `deployed troopers go their own way towards the enemy (${troopers.map((u, i) => `${Math.round(u.x - x0[i])}`).join(', ')} cells)`);
check(troopers.every((u) => u.game.order.type === 'auto'), 'on their own (auto) until told otherwise');

// ---- 2. Hacking ------------------------------------------------------------------------------------
const foeBase = G.bases(m, 'right').find((b) => (b.panels || []).length);
check(!!foeBase, 'the enemy has a base with a panel');
const quiet = (u) => u.hold || u.silentUntil || (u.disabledUntil || 0) > (world.tick || 0);
const silentBefore = (world.defence || []).filter((u) => u.side === 'right' && !u.dead && quiet(u)).length;
const guards0 = (world.troops || []).filter((t) => t.side === 'right' && t.game && t.game.guard).length;
const [hacker, h2] = troopers;
const panel = foeBase.panels[0];
// (standing on the panel's floor, in front of its console - PW.game.standAt: clear of the pillars)
const put = (t, p) => { const s = G.standAt(world, p); t.x = s.x + 0.5; t.y = s.y; t.vx = 0; t.vy = 0; t.route = null; t.walk = 0; t.dead = false; t.hp = 100; };
// (sent to hack: to where a man stands at the panel, as the game bar's right-click sends one)
const hackAt = (t, p) => { const s = G.standAt(world, p); G.order(m, [t], { type: 'hack', x: s.x, y: s.y + 1 }); };
// (one that leaves after 8 s breaks it off)
hackAt(hacker, panel);
for (let s = 0; s < 8; s += 1) { put(hacker, panel); step(1); }
check(hacker.game.hack && hacker.game.hack.progress >= 6, `a trooper at the panel is hacking (${hacker.game.hack && hacker.game.hack.progress} s)`);
hacker.x = foeBase.body.left - 200;
step(2);
check(!hacker.game.hack && !(foeBase.hackedUntil > m.clock), 'leaving the panel breaks the hack off');
// (one that stays 15 s)
hackAt(hacker, panel);
for (let s = 0; s < 17 && !(foeBase.hackedUntil > m.clock); s += 1) { put(hacker, panel); step(1); }
const silent = (world.defence || []).filter((u) => u.side === 'right' && !u.dead && quiet(u)).length;
check(foeBase.hackedUntil > m.clock && silent > silentBefore, `15 s at the panel: the base is hacked, ${silent - silentBefore} of its defences silent`);
check(m.log.some((l) => l.side === 'right' && /hacked/.test(l.text)), 'the hacked side is told');
hacker.x = foeBase.body.left - 300;
step(47);
const guards = (world.troops || []).filter((t) => t.side === 'right' && t.game && t.game.guard).length;
check(guards > guards0, `its defences come back and it sends out guards (${guards - guards0})`);
hackAt(hacker, panel);
for (let s = 0; s < 16; s += 1) { put(hacker, panel); step(1); }
check(foeBase.hackedUntil - m.clock > 40, 'it cannot be hacked again during its two-minute cooldown');
// A tower: its panel on the top floor - the enemy's sight is the hacker's for a while.
// (the right capital's growth is held for this part: a tower that comes of age is taken down and
// raised anew at its next level - with the man at its panel - and that is the growth's, not the
// hack's; a tower whose top floor is whole, the furthest from the base fought round above)
const eng = world.capitalGrowth, engStep = eng.step;
eng.step = () => {};
const floorWhole = (p) => [-6, -3, 0, 3, 6].every((dx) => (PW.get(world, p.x + dx, p.y) & PW.ID_MASK) !== PW.M.AIR);
const tower = world.buildings.filter((b) => G.ownerOf(b) === 'right' && b.type === 'population' && G.standing(b) && (b.panels || []).length && floorWhole(b.panels[0]))
  .sort((p, q) => Math.abs(q.body.left - foeBase.body.left) - Math.abs(p.body.left - foeBase.body.left))[0];
// (a place only the right side sees: its building furthest from the tower - a mountain post)
const farB = world.buildings.filter((b) => G.ownerOf(b) === 'right' && b.body && !b.ruined)
  .sort((p, q) => Math.abs(q.body.left - tower.body.left) - Math.abs(p.body.left - tower.body.left))[0];
const farX = Math.round((farB.body.left + farB.body.right) / 2);
for (const u of army) if (!u.dead && u !== h2) { u.x = m.sides.left.home; u.y = world.groundTop[Math.round(u.x)]; u.route = null; }
step(1);
const sawBefore = PW.vision.sees(world, 'left', farX);
checks.push(`INFO tower at ${tower.body.left}, far right post at ${farX}`);
// (the right side's guns are held for this part: what is tested is the panel's rule, not a fight;
// the hacker goes quietly - PS's quiet order: crouched, never firing)
for (const u of world.defence || []) if (u.side === 'right' && !u.dead && PW.units) PW.units.disable(u, 30);
for (const t of world.troops || []) if (t.side === 'right' && !t.dead && PW.units) PW.units.disable(t, 30);
hackAt(h2, tower.panels[0]);
check(!!h2.sneak, 'a hacker goes quietly (crouched, holding its fire)');
for (let s = 0; s < 17; s += 1) { put(h2, tower.panels[0]); step(1); }
eng.step = engStep;
const sawAfter = PW.vision.sees(world, 'left', farX);
check(!sawBefore && sawAfter, `a tower hacked: the left side sees what the right side sees - its far post too (${sawBefore} -> ${sawAfter}; hack ${JSON.stringify(h2.game.hack)}, the man at ${Math.round(h2.x)},${Math.round(h2.y)})`);
h2.x = m.sides.left.home; h2.y = world.groundTop[Math.round(h2.x)]; hacker.x = h2.x; hacker.y = h2.y;
step(62);
check(!PW.vision.sees(world, 'left', farX), '...for a while only');

// ---- 3. Cover --------------------------------------------------------------------------------------
const own = world.buildings.find((b) => G.ownerOf(b) === 'left' && G.standing(b));
const theirs = world.buildings.find((b) => G.ownerOf(b) === 'right' && G.standing(b));
check(G.cover({ side: 'left' }, own.id) === true && G.cover({ side: 'right' }, own.id) === false && G.cover({ side: 'left' }, theirs.id) === false,
  'own buildings let their side\'s rounds through; anyone else\'s stop them');
return { checks, log: m.log.slice(-6).map((l) => l.text) };
