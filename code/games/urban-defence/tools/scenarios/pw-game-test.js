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
// (N120/N112: the line from the pointer to the ground - green where it can go, red where it can't -
// and the outline of the core bunker where it can; read off the screen's own pixels)
let spotX = null, look = null;
for (let k = 0; k < 12 && !spotX; k += 1) {
  const x = pad + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 110;
  const l = G.seedPreview(m, 'left', 'capital', x, { start: true });
  if (l.ok) { spotX = x; look = l; }
}
check(!!look && look.canvas && look.canvas.meta.type === 'core', `where it can go, the preview is the core bunker (${look ? look.canvas.meta.type : 'none'})`);
const wc = document.getElementById('world-canvas'), wctx = wc.getContext('2d');
const tint = (cx, cy, r = 3) => {
  const rect = wc.getBoundingClientRect(), sx = Math.round((cx - rect.left) * wc.width / rect.width), sy = Math.round((cy - rect.top) * wc.height / rect.height);
  const d = wctx.getImageData(sx - r, sy - r, 2 * r + 1, 2 * r + 1).data;
  let g = 0, red = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 1] > 180 && d[i] < 150) g += 1; if (d[i] > 200 && d[i + 1] < 120) red += 1; }
  return { g, red };
};
if (spotX) {
  const gy = world.groundTop[spotX];
  ptr('pointermove', spotX, gy - 40, { buttons: 0 });
  await sleep(120);
  const at = pwApp.toClient(spotX, gy - 20), t = tint(at.x, at.y);
  check(t.g > 0 && t.red === 0, `over open ground the line to the surface is green (${t.g} green, ${t.red} red pixels)`);
  // (the outline: its cells green over the ground)
  const oc = pwApp.toClient(look.worldX + look.canvas.body.left + 4, look.floor - 6), to = tint(oc.x, oc.y, 6);
  check(to.g > 0, `and the core bunker's outline stands there (${to.g} green pixels at its wall)`);
  shots.push(await shot('n120-first-seed-preview'));
  const far = Math.round(world.width / 2), fy = world.groundTop[far];
  pwApp.focus(far, fy - 60, 2);
  await sleep(150);
  ptr('pointermove', far, fy - 40, { buttons: 0 });
  await sleep(120);
  const ac = pwApp.toClient(far, fy - 20), tr = tint(ac.x, ac.y);
  check(tr.red > 0 && tr.g === 0, `outside its third the line is red (${tr.red} red, ${tr.g} green pixels)`);
  pwApp.focus(pad, world.groundTop[pad] - 60, 2);
  await sleep(150);
}
const hmBefore = G.purse(m, 'left').hm, smBefore = G.purse(m, 'left').sm;
let start = null;
for (let k = 0; k < 12 && !start; k += 1) {
  const x = spotX ?? (pad + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 110);
  clickAt(x, world.groundTop[x] - 4);
  await sleep(30);
  start = eng.cities.find((c) => c.faction === 'left' && c.start) || null;
}
check(!!start && m.sides.left.placed, `a click places the starting capital (${start ? `at ${start.x}` : 'none'})`);
if (!start) return { checks, shots };
check(G.purse(m, 'left').hm === hmBefore && G.purse(m, 'left').sm === smBefore, `the first seed is free (HM ${hmBefore} -> ${G.purse(m, 'left').hm})`);
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
// (N120: its farms grow from it too)
for (let s = 0; s < 40 && !eng.cities.some((c) => c.kind === 'farm' && c.fromStart === start.id); s += 1) secs(1);
const farm = eng.cities.find((c) => c.kind === 'farm' && c.fromStart === start.id);
check(!!farm && farm.faction === 'left', `a farm takes root beside it, of its own (${farm ? `farm ${farm.id} at ${farm.x}` : 'none yet'})`);
// (N120: its growth replaces the trees in its way - none left standing in a lot it built)
let trees = 0;
for (const lot of [start.main, ...start.rings.left, ...start.rings.right]) {
  const p = lot && lot.placed;
  if (!p) continue;
  for (let y = p.y0; y <= p.y1; y += 2) for (let x = p.x0; x <= p.x1; x += 2) {
    // (a tree's or a bush's wood - the grass's little tufts that come back over bare ground are not trees)
    const fl = PW.getFlags(world, x, y);
    if ((fl & PW.FLAG.FLORA) && (fl & PW.FLAG.WOOD) && PW.getLayer(world, 'deco', x, y)) trees += 1;
  }
}
check(trees === 0, `no tree stands inside a lot it built (${trees} plant cells showing)`);
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
const notes = { left: [], right: [] };
const milFor = (side, from) => {
  // (out past its capital towards the enemy first, then back the other way past it)
  const cap = side === 'left' ? (later || start) : ai;
  const away = [side === 'left' ? 1 : -1, side === 'left' ? -1 : 1];
  for (const d of away) for (let k = 0; k < 26; k += 1) {
    const edge = d > 0 ? Math.max(cap.edge.right, cap.capEdge.right) : Math.min(cap.edge.left, cap.capEdge.left);
    const x = Math.round((d === away[0] ? from : edge) + d * (260 + k * 110));
    const r = G.seed(m, side, 'military', x);
    if (r.ok) return r.city;
    if (notes[side].length < 8) notes[side].push(`${x}: ${r.note}`);
  }
  return null;
};
world.stock.right.hm = 4000; world.stock.right.sm = 600;
const lm = milFor('left', later ? later.edge.right : start.edge.right), rm = milFor('right', ai.edge.left);
secs(20);
const facings = (side) => world.buildings.filter((q) => q && q.type === 'military' && (q.faction ?? q.side) === side && q.canvas)
  .map((q) => q.canvas.meta.facing);
const lf = facings('left'), rf = facings('right');
info(`military seeds: left ${lm ? lm.id : `- (${notes.left.slice(0, 4).join('; ')})`}, right ${rm ? rm.id : `- (${notes.right.slice(0, 4).join('; ')})`}`);
check(lf.length > 0 && lf.every((f) => f === 1), `the left side's military buildings face right (${lf.join(' ') || 'none'})`);
check(rf.length > 0 && rf.every((f) => f === -1), `the right side's military buildings face left (${rf.join(' ') || 'none'})`);
if (lm) {
  const b0 = G.bases(m, 'left')[0];
  const d = b0 ? G.deploy(m, 'left', 'trooper', b0) : { ok: false, note: 'no base' };
  check(d.ok && d.unit.facing === 1, `a unit of the left side faces right (${d.ok ? d.unit.facing : d.note})`);
  // N4 (the user's design doc): a hurt man by his side's base is patched up; one far from any of his
  // side's buildings - out on the centre's barrier - is not.
  if (d.ok) {
    const man = d.unit, mid = Math.round(world.width / 2);
    const lone = PW.troops.create(world, { x: mid + 0.5, side: 'left', facing: 1 });
    man.hp = 40; lone.hp = 40;
    secs(2);
    check(!man.dead && man.hp >= 48, `a hurt man by his side's base is patched up (40 -> ${Math.round(man.hp)} in 2 s)`);
    check(lone.dead || lone.hp <= 40, `a hurt man far from his side's buildings is not (40 -> ${Math.round(lone.hp)})`);
    lone.dead = true;
  }
  if (lm.main && lm.main.placed) await view('n115-left-base-faces-right', lm.x, world.groundTop[lm.x] - 80, 3);
  // N89 (the user's): the base spreads over smaller buildings round its main - a watchtower, a
  // barracks, a bunker - and fences and T-walls across the ways in, that stop men and not hulls
  // (a base of its own on open ground towards the map's end: the one above stands hemmed in by the
  // later capital's lots)
  let bm = null;
  const why2 = [];
  for (const dir2 of [-1, 1]) for (let k = 0; k < 10 && !bm; k += 1) {
    const edge = dir2 < 0 ? Math.min(start.edge.left, start.capEdge.left) : Math.max(start.edge.right, start.capEdge.right, later ? later.edge.right : 0);
    const x = Math.round(edge + dir2 * (260 + k * 140));
    const r = x > 200 && x < world.width / 3 ? G.seed(m, 'left', 'military', x) : { ok: false, note: 'off its third' };
    if (r.ok) bm = r.city; else if (why2.length < 6) why2.push(`${x}: ${r.note}`);
  }
  if (!bm) info(`no open ground for a base of its own (${why2.join('; ')})`);
  const base2 = bm || lm;
  for (let s = 0; s < 90 && base2.rings.left.length + base2.rings.right.length < 2; s += 1) secs(1);
  const posts = [...base2.rings.left, ...base2.rings.right].map((l) => l.variant);
  if (!posts.length) info(`the base: level ${base2.level}, ${base2.actions} actions, blocked ${JSON.stringify(base2.blocked)}, edges ${Math.round(base2.edge.left)}..${Math.round(base2.edge.right)}, last notes ${(base2.notes || []).slice(-3).map((n) => n.text || n).join(' | ')}`);
  check(posts.length >= 1 && posts.every((v) => ['watchtower', 'barracks', 'bunker'].includes(v)), `the base grows smaller buildings round its main (${posts.join(', ') || 'none yet'})`);
  const fences = Object.values(base2.fences || {}).filter(Boolean);
  const H = fences.length ? fences[0].cells.filter((c) => c[0] === fences[0].x).length : 0;
  check(fences.length >= 1 && H > 9 && H < 15, `fences and T-walls stand across its ways in, ${H} high - over a man's step, under a hull's (${fences.map((f) => `${f.wall ? 'T-wall' : 'fence'} at ${f.x}`).join(', ') || 'none'})`);
  const mainRec = world.buildings[base2.main.owner - 1];
  check(!!mainRec && (mainRec.gates || []).some((g) => g.fence), 'they are the base\'s own gate piers - its men pass them, another side\'s are stopped');
  await view('n89-spread-base', base2.x, world.groundTop[base2.x] - 100, 2);
}
return { checks, shots };
