// N115 (the user's, 2026-11-23) - the gameplay test, on the game page (mode=game&start=test&side=left&
// det=1): the sides' home towns are not built; each side places its own starting capital in its own
// third of the map - a capital whose main building is the core bunker - and the clock starts when both
// stand; later capitals from seeds have the capital building for their main; everything builds four
// times as fast; the left side's units and military buildings face right, the right side's left.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world } = pwApp;
const m = pwApp.match(), G = PW.game, eng = world.capitalGrowth;
const canvas = document.getElementById('world-canvas');
const ptr = (type, wx, wy, opts = {}) => {
  const p = pwApp.toClient(wx, wy);
  canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, ...opts }));
};
const clickAt = (wx, wy) => { ptr('pointermove', wx, wy, { buttons: 0 }); ptr('pointerdown', wx, wy, { button: 0, buttons: 1 }); ptr('pointerup', wx, wy, { button: 0, buttons: 0 }); };
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const secs = (s) => { for (let k = 0; k < s; k += 1) pwApp.stepWorld(60); };

// 1. The test's world: no home towns, the match waiting for its capitals, building four times as fast.
const homes = (world.settlements || []).filter((s) => s.side === 'left' || s.side === 'right');
check(m.test && homes.length === 0 && (world.settlements || []).length > 0, `no home towns are built, the neutral towns are (${homes.length} home, ${(world.settlements || []).length} neutral)`);
check(m.phase === 'placing' && world.buildSpeed === 4, `the match opens placing the capitals, building at x${world.buildSpeed}`);
const [a, b] = G.thirdOf(world, 'left');
check(PW.vision.sees(world, 'left', Math.round((a + b) / 2)) && !PW.vision.sees(world, 'left', Math.round(world.width / 2)), 'the side sees its own third while it chooses, not beyond');
secs(2);
check(m.phase === 'placing' && m.clock === 0, `the clock waits while a capital is still to place (clock ${m.clock.toFixed(1)})`);
const ai = eng.cities.find((c) => c.faction === 'right' && c.start);
const [ra, rb] = G.thirdOf(world, 'right');
check(!!ai && m.sides.right.placed && ai.x >= ra && ai.x <= rb, `the computer places its starting capital in its own third (${ai ? `at ${ai.x}, third ${ra}..${rb}` : 'none'})`);
// (refused: outside its third; another seed before it)
check(!G.placeStart(m, 'left', Math.round(world.width / 2)).ok, `outside its third it is refused (${G.placeStart(m, 'left', Math.round(world.width / 2)).note})`);
check(!G.seed(m, 'left', 'farm', Math.round((a + b) / 2)).ok, `no other seed goes in first (${G.seed(m, 'left', 'farm', Math.round((a + b) / 2)).note})`);

// 2. The person places theirs by a click, the capital seed in hand from the start.
const pad = m.sides.left.home;
check(document.querySelector('#gm-bar [data-tool="seed:capital"]').classList.contains('on'), 'the capital seed is in hand as the test opens');
pwApp.focus(pad, world.groundTop[pad] - 60, 2);
await sleep(150);
let start = null;
for (let k = 0; k < 12 && !start; k += 1) {
  const x = pad + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 110;
  clickAt(x, world.groundTop[x] - 4);
  await sleep(30);
  start = eng.cities.find((c) => c.faction === 'left' && c.start) || null;
}
check(!!start && m.sides.left.placed, `a click places the starting capital (${start ? `at ${start.x}` : 'none'})`);
if (!start) return { checks, shots };
const mainB = world.buildings[start.main.owner - 1] || world.buildings.find((q) => q && q.id === start.main.owner);
const bunker = start.main.type === 'core' && (start.main.placed ? true : false);
check(bunker, `its main building is the core bunker (main ${start.main.type}${mainB && mainB.canvas ? `, canvas ${mainB.canvas.meta.type}` : ''})`);
secs(1);
check(m.phase === 'play' && m.clock > 0, `both capitals placed, the match is on (clock ${m.clock.toFixed(1)})`);

// 3. Four times as fast: the city's actions and its works' clock in a minute.
const acts0 = start.actions, t0 = PW.tunnels.state(world).time, c0 = m.clock;
secs(30);
const acts = start.actions - acts0, dT = PW.tunnels.state(world).time - t0, dc = m.clock - c0;
check(acts >= 20 && Math.abs(dT / dc - 4) < 0.3, `everything builds four times as fast: ${acts} growth actions in ${dc.toFixed(0)} s (about ${Math.round(dc / 3.2)} at x1), the workings' clock at x${(dT / dc).toFixed(2)}`);
secs(60);
// (the crews raise the bunker from its orb, as they raise any building from its cores)
const mb = world.buildings[start.main.owner - 1];
check(!!mb && (mb.health ?? 1) > 0.9, `the core bunker is built (health ${mb ? (mb.health ?? 1).toFixed(2) : '-'}${mb && mb.underConstruction ? ', still a site' : ''})`);
const rings = start.rings.left.length + start.rings.right.length;
check(rings >= 2, `the starting capital grows its rings round the bunker (${rings} lots)`);
await view('n115-starting-capital', start.x, world.groundTop[start.x] - 120, 2);

// 4. A later capital from a seed has the capital building for its main.
world.stock.left.hm = 4000; world.stock.left.sm = 600;
const dir = m.sides.left.dir;
let later = null;
for (let k = 0; k < 10 && !later; k += 1) {
  const x = Math.round(start.edge.right + 400 + k * 140);
  const r = G.seed(m, 'left', 'capital', x);
  if (r.ok) later = r.city;
}
if (later) check(later.main.type === 'population' && !later.start, `a later capital's main is the capital building (${later.main.type})`);
else info('no ground for a later capital in sight');

// 5. The left side's military faces right, the right side's left - wherever it stands.
const milFor = (side, from) => {
  for (let k = 0; k < 12; k += 1) {
    const x = Math.round(from + (side === 'left' ? 1 : -1) * (300 + k * 120));
    const r = G.seed(m, side, 'military', x);
    if (r.ok) return r.city;
  }
  return null;
};
world.stock.right.hm = 4000; world.stock.right.sm = 600;
const lm = milFor('left', later ? later.edge.right : start.edge.right), rm = milFor('right', ai.edge.left);
secs(20);
const facings = (side) => world.buildings.filter((q) => q && q.type === 'military' && (q.faction ?? q.side) === side && q.canvas)
  .map((q) => q.canvas.meta.facing);
const lf = facings('left'), rf = facings('right');
info(`military seeds: left ${lm ? lm.id : '-'}, right ${rm ? rm.id : '-'}`);
check(lf.length > 0 && lf.every((f) => f === 1), `the left side's military buildings face right (${lf.join(' ') || 'none'})`);
check(rf.length > 0 && rf.every((f) => f === -1), `the right side's military buildings face left (${rf.join(' ') || 'none'})`);
if (lm) {
  const b0 = G.bases(m, 'left')[0];
  const d = b0 ? G.deploy(m, 'left', 'trooper', b0) : { ok: false, note: 'no base' };
  check(d.ok && d.unit.facing === 1, `a unit of the left side faces right (${d.ok ? d.unit.facing : d.note})`);
  if (lm.main && lm.main.placed) await view('n115-left-base-faces-right', lm.x, world.groundTop[lm.x] - 80, 3);
}
return { checks, shots };
