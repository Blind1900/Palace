// N116 (the user's, 2026-11-23) - the match's economy of choices, on the game page (mode=game&start=
// versus&side=left&det=1): no city levels by itself - its side picks which to raise and pays HM for it
// (the UPGRADE tool, by real clicks); every unit costs HM and SM both; HM rushes a tunnel network's
// growth (the RUSH TUNNEL tool); the computer buys its own levels.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world } = pwApp;
const m = pwApp.match(), G = PW.game, eng = world.capitalGrowth, T = PW.tunnels;
const canvas = document.getElementById('world-canvas');
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const ptr = (type, wx, wy, opts = {}) => {
  const p = pwApp.toClient(wx, wy);
  canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, ...opts }));
};
const clickAt = (wx, wy) => { ptr('pointermove', wx, wy, { buttons: 0 }); ptr('pointerdown', wx, wy, { button: 0, buttons: 1 }); ptr('pointerup', wx, wy, { button: 0, buttons: 0 }); };
const tool = async (id) => { const el = document.querySelector(`#gm-bar [data-tool="${id}"]`); const c = centre(el); await click(c.x, c.y); await sleep(40); };

// 1. No city levels by itself in a match, however rich its side.
check(eng.manual === true, 'the growth engine is set to levels by hand for the match');
world.stock.left.hm = 6000;
const mine = () => eng.cities.filter((c) => c.faction === 'left' && !c.fallen);
// (a military seed of its own: before N116 a base dug in a level every third growth action, ~10 s)
const front = G.frontOf(m, 'left', true);
let base = null;
for (let k = 0; k < 10 && !base; k += 1) { const r = G.seed(m, 'left', 'military', front + m.sides.left.dir * (200 + k * 120)); if (r.ok) base = r.city; }
check(!!base, `a military seed of the side's to watch (${base ? `military ${base.id} at ${base.x}` : 'none took'})`);
const before = new Map(mine().map((c) => [c.id, c.level]));
const ripe = mine().filter((c) => c.kind === 'capital' && c.rings.left.length + c.rings.right.length >= c.level * 2).length;
info(`left cities: ${mine().map((c) => `${c.kind} ${c.id} lv${c.level}`).join(', ')} (${ripe} capital(s) with lots enough to level by themselves before N116)`);
for (let s = 0; s < 60; s += 1) pwApp.stepWorld(60);
const rose = mine().filter((c) => before.has(c.id) && c.level > before.get(c.id));
check(mine().length > 0 && rose.length === 0, `in 60 s with ${Math.round(G.purse(m, 'left').hm)} HM in store, no city of the side levelled by itself (${rose.map((c) => `${c.kind} ${c.id}`).join(', ') || 'none'})`);
if (base) check(base.level === 1 && base.actions >= 6, `its military base stayed at level 1 through ${base.actions} growth actions (before N116: a level every third)`);

// 2. N122: the button over its main building raises a city a level, for its price.
const city = mine().filter((c) => c.level < eng.topLevel(c) && c.main && c.main.placed)
  .sort((a, b) => (a.kind === 'capital' ? -1 : 1) - (b.kind === 'capital' ? -1 : 1))[0];
check(!!city, `a city of the side's to raise (${city ? `${city.kind} ${city.id} lv${city.level}` : 'none'})`);
if (!city) return { checks };
const lv0 = city.level, hm0 = G.purse(m, 'left').hm, price = G.upgradeCost(city);
const mp = city.main.placed;
pwApp.focus(Math.round((mp.x0 + mp.x1) / 2), mp.y0 + 40, 2);
await sleep(200);
const ub = document.querySelector(`#gm-upg button[data-city="${city.id}"]`);
check(!!ub && !ub.disabled && new RegExp(`UPGRADE LV ${lv0}>${lv0 + 1} · ${price} HM`).test(ub.textContent),
  `a button over its main building offers the level (${ub ? `"${ub.textContent}"${ub.disabled ? ' - dimmed' : ''}` : 'none'})`);
if (ub) {
  const r = ub.getBoundingClientRect(), mainAt = pwApp.toClient((mp.x0 + mp.x1) / 2, mp.y0);
  check(Math.abs(r.left + r.width / 2 - mainAt.x) < 4 && r.bottom <= mainAt.y + 2, `it stands over the main building (button ${Math.round(r.left + r.width / 2)},${Math.round(r.bottom)}; the main's top ${Math.round(mainAt.x)},${Math.round(mainAt.y)})`);
  const c = centre(ub); await click(c.x, c.y); await sleep(60);
}
check(city.level === lv0 + 1 && Math.round(hm0 - G.purse(m, 'left').hm) === price,
  `a click raises ${city.kind} ${city.id} to level ${city.level} for ${price} HM (paid ${Math.round(hm0 - G.purse(m, 'left').hm)})`);
info(`prices a level: ${Object.entries(G.UPGRADE).map(([k, v]) => `${k} ${v}x level`).join(', ')}`);
// (refused: short of HM, another side's city)
world.stock.left.hm = 5;
check(!G.canUpgrade(m, 'left', city).ok && /HM/.test(G.canUpgrade(m, 'left', city).note), `short of HM it is refused (${G.canUpgrade(m, 'left', city).note})`);
world.stock.left.hm = 6000;
const theirs = eng.cities.find((c) => c.faction === 'right' && !c.fallen);
if (theirs) check(!G.upgrade(m, 'left', theirs).ok, `another side's city cannot be raised (${G.upgrade(m, 'left', theirs).note})`);

// 2b. N122: the seed's building grows whole in its kind's time (a base 2 min, a capital 3, a farm
// 1.5) - its button saying GROWING meanwhile, and still offering the next level (the user's "both":
// that is also the window it may be raised in).
if (base && base.main && base.main.placed) {
  const r = G.upgrade(m, 'left', base);
  const rec = r.ok ? world.buildings[base.main.owner - 1] : null;
  check(!!rec && rec.underConstruction && rec.paceSecs === eng.GROW_SECS.military,
    `a level bought, the base's main building grows at the pace of ${eng.GROW_SECS.military} s (${rec ? `paced ${rec.paceSecs} s` : r.note})`);
  if (rec) {
    const mpb = base.main.placed;
    pwApp.focus(Math.round((mpb.x0 + mpb.x1) / 2), mpb.y0 + 40, 2);
    pwApp.stepWorld(60);
    await sleep(150);
    const gb = document.querySelector(`#gm-upg button[data-city="${base.id}"]`);
    check(!!gb && !gb.disabled && /GROWING/.test(gb.textContent) && /UPGRADE LV/.test(gb.textContent), `meanwhile its button reads "${gb ? gb.textContent : 'none'}"${gb && gb.disabled ? ', dimmed' : ', still on offer'}`);
    let t = 1, half = null;
    for (; t < 200 && rec.underConstruction; t += 1) { pwApp.stepWorld(60); if (half === null && t === 60) half = rec.health ?? 0; }
    const want = eng.GROW_SECS.military;
    check(!rec.underConstruction && Math.abs(t - want) <= want * 0.25,
      `it stands whole after ${t} s (wanted ${want} s; half-way it was ${half === null ? '-' : Math.round(half * 100)}% built)`);
    await sleep(150);
    const gb2 = document.querySelector(`#gm-upg button[data-city="${base.id}"]`);
    check(!!gb2 && !gb2.disabled && /UPGRADE LV/.test(gb2.textContent), `then its next level is on offer again ("${gb2 ? gb2.textContent : 'none'}")`);
  }
}

// 3. Every unit costs HM and SM both.
const K = G.UNIT_KINDS.trooper;
check(Object.values(G.UNIT_KINDS).every((k) => k.hm > 0 && k.sm > 0), `every unit has an HM and an SM price (${Object.entries(G.UNIT_KINDS).map(([k, v]) => `${k} ${v.hm}+${v.sm}`).join(', ')})`);
world.stock.left.sm = 500;
const p0 = G.purse(m, 'left');
const d = G.deploy(m, 'left', 'trooper');
const p1 = G.purse(m, 'left');
check(d.ok && Math.round(p0.hm - p1.hm) === K.hm && Math.round(p0.sm - p1.sm) === K.sm, `a trooper takes ${K.hm} HM and ${K.sm} SM (took ${Math.round(p0.hm - p1.hm)} and ${Math.round(p0.sm - p1.sm)})`);
world.stock.left.sm = 3;
const no = G.canDeploy(m, 'left', 'trooper');
check(!no.ok && /SM/.test(no.note), `short of SM nothing deploys (${no.note})`);
world.stock.left.sm = 500;
const bar = [...document.querySelectorAll('#gm-bar [data-deploy]')].map((el) => el.textContent);
check(bar.every((t) => /\d+\+\d+$/.test(t)), `the bar shows both prices (${bar.join(', ')})`);

// 4. The RUSH TUNNEL tool: a click in one of the side's tunnels brings its next works forward.
const S = T.state(world);
const nets = S.networks.filter((n) => n.side === 'left');
const due = (net, within) => {
  let n = 0;
  for (const seg of S.segments) {
    if (seg.net !== net.id) continue;
    for (let y = seg.y0; y <= seg.y1; y += 1) for (let x = seg.x0; x <= seg.x1; x += 1) {
      if (T.networkAt(world, x, y) !== net || !(PW.getFlags(world, x, y) & PW.FLAG.RAW)) continue;
      // (still raw, and due by then - a rush brings some due at once: those count, not drop out)
      const t = T.devAt(world, x, y);
      if (t <= S.time + within) n += 1;
    }
  }
  return n;
};
const plansOf = (net) => (world.minePlans || []).filter((p) => p.net === net.id && p.at > S.time);
// (the network with the most work still to come)
let net = null, best = -1;
for (const n of nets) { const w = plansOf(n).length * 1000 + due(n, 1e6); if (w > best) { best = w; net = n; } }
check(!!net && best > 0, `a tunnel network of the side's with works to come (${net ? `#${net.id}: ${plansOf(net).length} planned digs, ${due(net, 1e6)} cells to develop` : 'none'})`);
if (net) {
  let spot = null;
  for (const seg of S.segments) {
    if (spot || seg.net !== net.id) continue;
    for (let y = seg.y0; y <= seg.y1 && !spot; y += 2) for (let x = seg.x0; x <= seg.x1 && !spot; x += 2) if (T.networkAt(world, x, y) === net) spot = { x, y };
  }
  const soon0 = due(net, 60), plan0 = plansOf(net).map((p) => p.at - S.time), hmR = G.purse(m, 'left').hm;
  pwApp.focus(spot.x, spot.y, 2);
  await sleep(150);
  await tool('rush');
  clickAt(spot.x, spot.y);
  await sleep(40);
  const soon1 = due(net, 60), plan1 = plansOf(net).map((p) => p.at - S.time);
  check(Math.round(hmR - G.purse(m, 'left').hm) === G.RUSH.hm && net.rushUntil > S.time,
    `a click with RUSH TUNNEL in it rushes its works for ${G.RUSH.hm} HM (until ${Math.round(net.rushUntil - S.time)} s from now)`);
  check(soon1 >= soon0 && (soon1 > soon0 || plan1.some((t, i) => t < plan0[i] - 1)),
    `its next minutes come sooner (cells due within a minute ${soon0} -> ${soon1}; planned digs in ${plan0.slice(0, 3).map(Math.round).join('/')} s -> ${plan1.slice(0, 3).map(Math.round).join('/')} s)`);
  check(!G.rushTunnel(m, 'left', spot.x, spot.y).ok, 'a network already rushed is not rushed twice');
}
check(!G.rushTunnel(m, 'left', 40, 40).ok, 'nowhere in a tunnel of the side\'s, nothing is rushed');

// 5. The computer buys its own levels.
world.stock.right.hm = 6000; world.stock.right.sm = 600;
const ai = m.sides.right.ai;
for (let s = 0; s < 90 && !((ai && ai.brain.upgrades) > 0); s += 1) pwApp.stepWorld(60);
check(!!ai && ai.brain.upgrades > 0, `the computer raises a city of its own (${ai ? `${ai.brain.upgrades || 0} upgrades; last: ${ai.brain.last}` : 'no computer side'})`);

// 6. N96 (the user's): an HM storage room - the surplus past what a side keeps in hand goes down
// into its strongroom as a heap of ore, and comes back up when the side runs short.
{
  const MN = PW.mining;
  world.stock.left.hm = MN.HM_KEEP + 400;
  for (let s = 0; s < 40; s += 1) pwApp.stepWorld(60);
  const st = world.hmStores && world.hmStores.left;
  check(!!st && st.stored > 0 && st.heap.length > 0 && G.purse(m, 'left').hm < MN.HM_KEEP + 400,
    `past ${MN.HM_KEEP} in hand, the surplus goes down into the side's HM store (${st ? `${st.stored} HM stored as ${st.heap.length} cells of ore, ${Math.round(G.purse(m, 'left').hm)} in hand` : 'no store'})`);
  if (st) {
    const stored0 = st.stored;
    world.stock.left.hm = 40;
    for (let s = 0; s < 10; s += 1) pwApp.stepWorld(60);
    check(st.stored < stored0 && G.purse(m, 'left').hm > 40, `short of HM, it comes back up (store ${stored0} -> ${st.stored}, in hand 40 -> ${Math.round(G.purse(m, 'left').hm)})`);
    pwApp.focus((st.x0 + st.x1) / 2, st.floor - 20, 5);
    await sleep(400);
    shots.push(await shot('n96-hm-store'));
  }
}
return { checks, shots };
