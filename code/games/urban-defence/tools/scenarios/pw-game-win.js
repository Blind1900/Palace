// N6 - the ruins and the win (pixel-world.html?mode=game&start=versus&side=left&det=1): a capital none
// of whose cores lives has fallen - it claims no ground, grows no more, gives no sight - and its ruins
// are open to the enemy's seed; the side that raises a capital over the ruins of the other's last one
// wins (the user's, 2026-11-22: "destroy the enemy and raise your own capital over their ruins").
// The right capital is razed by hand - every cell of its buildings gone, its cores with them (the
// blasts and collapses that do it in a match are pw-collapse's and pw-refound's): the rules on top are
// what is tested here.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const { world } = pwApp;
const m = pwApp.match(), G = PW.game;
const step = (s) => pwApp.stepWorld(Math.round(s * 60));
const eng = world.capitalGrowth;
const capital = eng.cities.find((c) => c.kind === 'capital' && c.faction === 'right');
const ids = new Map(world.buildings.map((b) => [b.id, b]));
const theirs = G.buildingsOf(capital, ids);
check(theirs.length > 0 && theirs.some((b) => G.livingCore(b, world)), `the right capital stands (${theirs.length} buildings)`);
// (a core left anywhere keeps it standing: one building razed is not the fall)
const raze = (b) => {
  for (let y = b.body.top - 4; y <= b.ground + 60; y += 1) for (let x = b.body.left - 4; x <= b.body.right + 4; x += 1) {
    const id = PW.get(world, x, y) & PW.ID_MASK;
    if (id === PW.M.CORE || (PW.getOwner(world, x, y) === b.id && y < b.ground)) { PW.set(world, x, y, PW.M.AIR); PW.setOwner(world, x, y, 0); }
  }
  // (and its cores wherever they lie - deep in a pit, under a hangar floor)
  for (const c of b.cores || []) for (let dy = -16; dy <= 16; dy += 1) for (let dx = -16; dx <= 16; dx += 1) {
    if ((PW.get(world, c.x + dx, Math.round(c.y) + dy) & PW.ID_MASK) === PW.M.CORE) PW.set(world, c.x + dx, Math.round(c.y) + dy, PW.M.AIR);
  }
  b.ruined = true;
};
raze(theirs[0]);
step(2);
check(!capital.fallen, 'one building razed: the capital still stands on its other cores');
for (const b of theirs.slice(1)) raze(b);
step(2);
if (!capital.fallen) checks.push(`INFO still alive: ${theirs.filter((b) => G.livingCore(b, world)).map((b) => `${b.type}#${b.id} cores ${b.cores.map((c) => `${c.x},${Math.round(c.y)}${c.dead ? 'D' : ''}${c.lost ? 'L' : ''}`).join(' ')}`).join(' | ')}`);
check(capital.fallen === true, 'every core destroyed: the right capital falls');
check(m.log.some((l) => /has fallen/.test(l.text)), 'everyone is told');
check(!m.over, 'not won yet: the ruins must be built over');
// Seen from the left (a trooper of its there), the left casts its capital over the ruins.
const rx = Math.round((capital.edge.left + capital.edge.right) / 2);
world.stock.left.hm = 3000;
const scout = PW.troops.create(world, { x: rx + 0.5, side: 'left', style: m.sides.left.style, facing: -1 });
scout.game = { side: 'left', kind: 'trooper', order: { type: 'hold' }, goal: null, born: m.clock };
check(G.seed(m, 'left', 'capital', capital.edge.right + 2000).ok === false, 'a seed beyond the left side\'s sight is still refused');
let seeded = null;
for (let k = 0; k < 14 && !seeded; k += 1) {
  const x = rx + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 80;
  const r = G.seed(m, 'left', 'capital', x);
  if (r.ok) seeded = r.city; else checks.push(`INFO seed at ${x}: ${r.note}`);
}
check(!!seeded && seeded.overRuins === capital.id, `the left side plants its capital over the ruins (at ${seeded ? seeded.x : 'refused'})`);
check(m.log.some((l) => /builds over the ruins/.test(l.text)), 'everyone is told it is building over them');
let t = 0;
for (; t < 300 && !m.over; t += 5) step(5);
const seat = seeded && seeded.main && ids.get(seeded.main.owner) || (seeded && seeded.main && world.buildings.find((b) => b.id === seeded.main.owner));
check(m.over && m.winner === 'left', `its seat rises over the ruins: LEFT WINS (${t} s after the seed; seat ${seat ? Math.round((seat.health || 0) * 100) : '-'}% up)`);
check(m.reason && /destroyed/.test(m.reason), `the end says why ("${m.reason}")`);
pwApp.focus(rx, world.groundTop[rx] - 120, 4);
await sleep(500);
const shots = [await shot('pw-game-win')];
return { checks, shots: shots.length };
