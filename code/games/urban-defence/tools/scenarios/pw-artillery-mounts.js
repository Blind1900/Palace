// N114 (the user's, 2026-11-23) - missile artillery on the ground, on the game page in a match (mode=
// game&start=versus&side=left&det=1). The launchers and interceptors follow the turret design: not
// vehicles, but stationary artillery on a planted base, built on flat roofs or flat ground - and, unlike
// turrets, never inside a building or a tunnel: out under the sky (90 open rows over the plate, 60 clear
// either side above it, for PS's pods). PS owns the piece on the base and its firing; here, the bases.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world } = pwApp;
const m = pwApp.match(), G = PW.game, MT = PW.mounts;
const ROLE_DEVICE = PW.buildingKit.ROLE.DEVICE;
const canvas = document.getElementById('world-canvas');
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const ptr = (type, wx, wy, opts = {}) => {
  const p = pwApp.toClient(wx, wy);
  canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, ...opts }));
};
const clickAt = (wx, wy) => { ptr('pointermove', wx, wy, { buttons: 0 }); ptr('pointerdown', wx, wy, { button: 0, buttons: 1 }); ptr('pointerup', wx, wy, { button: 0, buttons: 0 }); };
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const open = (x, y) => PW.mat.phase[PW.get(world, x, y) & 63] <= PW.PHASE.GAS;
const ART = ['launcher', 'dome', 'patriot'];
pwApp.stepWorld(90);

// 1. The roofs: no launcher or interceptor painted into them - a plate of its own width where it stood.
const roofs = [];
for (const b of world.buildings) if (b && b.canvas && b.devices) for (const d of b.devices) if (d.kind === 'launcher' || d.kind === 'interceptor') roofs.push({ b, d });
const widthOk = roofs.every(({ d }) => d.base && d.base.x1 - d.base.x0 + 1 === MT.KINDS[d.kind].w);
let painted = 0;
for (const { b, d } of roofs) {
  const c = b.canvas;
  for (let y = d.base.y - 40; y < d.base.y; y += 1) for (let x = d.base.x0; x <= d.base.x1; x += 1) {
    const lx = x - b.ox, ly = y - b.oy;
    if (lx >= 0 && ly >= 0 && lx < c.width && ly < c.height && c.role[ly * c.width + lx] === ROLE_DEVICE) painted += 1;
  }
}
info(`roof artillery bases: ${roofs.filter((r) => r.d.kind === 'launcher').length} launcher, ${roofs.filter((r) => r.d.kind === 'interceptor').length} interceptor, on ${new Set(roofs.map((r) => r.b.id)).size} buildings`);
// (a rear roof holds one: a plate and its pods' 60 either side fill it)
check(roofs.length >= 1 && widthOk, `every roof launcher and interceptor is a base of its kind's width (${roofs.length}: launcher ${MT.KINDS.launcher.w}, interceptor ${MT.KINDS.interceptor.w})`);
check(painted === 0, `none is painted into a roof any more (${painted} device cells over the plates)`);
// (no wheeled battery set down beside a building)
const wheeled = (world.defence || []).filter((u) => !u.dead && ART.includes(u.type) && u.building && !u.mount);
check(wheeled.length === 0, `no wheeled battery beside a building (${wheeled.length})`);
// (the piece seated on each standing plate, by the sweep)
const seated = roofs.filter(({ b, d }) => (world.defence || []).some((u) => !u.dead && u.mount && ART.includes(u.type) && Math.abs(u.x - d.x) < 1 && u.y === d.y));
const standingRoofs = roofs.filter(({ b, d }) => !b.ruined && !b.coresOpen && MT.intact(world, d.base, b.id));
check(seated.length >= standingRoofs.length, `PS's piece is seated on every standing plate (${seated.length} of ${standingRoofs.length})`);
const types = seated.map(({ d }) => (world.defence.find((u) => u.mount && Math.abs(u.x - d.x) < 1 && u.y === d.y) || {}).type);
info(`seated: ${types.join(' ')}`);
const roof = seated[0] || roofs[0];
if (roof) await view('n114-roof-artillery', roof.d.x, roof.d.y - 40, 5);

// 2. Never in a tunnel or under a roof: a launcher's or interceptor's base is only ever found under the sky.
const cb = (world.caveBases || [])[0];
if (cb) check(!MT.find(world, cb.x0, cb.x1, { kind: 'launcher', room: true, top: cb.y - 20, bottom: cb.y + 2 }), 'no launcher base is found in a cave base');
check(!MT.find(world, 1000, 3000, { kind: 'interceptor', room: true, top: 1500, bottom: 1900 }), 'no interceptor base is found in a room');

// 3. Placed by a click: on flat ground open to the sky, in vision, for HM and SM.
world.stock.left.hm = 6000; world.stock.left.sm = 1000;
for (const b of G.bases(m, 'left')) b.level = Math.max(b.level || 1, 4);
const front = G.frontOf(m, 'left', true), dir = m.sides.left.dir;
// (the town behind the front is built up: open, flat ground nearest the front - behind it or just
// ahead, in sight)
const spot = MT.find(world, Math.min(front - dir * 1500, front + dir * 450), Math.max(front - dir * 1500, front + dir * 450), { kind: 'launcher', road: true, near: front });
check(!!spot && PW.vision.sees(world, 'left', spot.x0), `flat ground open to the sky near the front, in sight (${spot ? spot.x0 : 'none'})`);
if (!spot) return { checks, shots };
const sx = spot.x0 + MT.KINDS.launcher.w / 2;
pwApp.focus(sx, spot.floor - 40, 4);
await sleep(150);
const p0 = G.purse(m, 'left');
const bt = document.querySelector('#gm-bar [data-tool="art:launcher"]');
check(!!bt && !document.querySelector('#gm-bar [data-deploy="launcher"]'), 'ROCKETS is a placing tool on the bar, no longer a deploy button');
const c0 = centre(bt); await click(c0.x, c0.y); await sleep(40);
clickAt(sx, spot.floor - 4);
await sleep(40);
const placed = (world.mounts || []).filter((q) => q.placedBy === 'left' && q.kind === 'launcher');
const p1 = G.purse(m, 'left'), A = G.ARTILLERY.launcher;
check(placed.length === 1 && Math.round(p0.hm - p1.hm) === A.hm && Math.round(p0.sm - p1.sm) === A.sm,
  `a click sets a launcher's base there for ${A.hm} HM and ${A.sm} SM (${placed.length} placed; paid ${Math.round(p0.hm - p1.hm)}+${Math.round(p0.sm - p1.sm)})`);
const lm = placed[0];
if (lm) {
  // (the sky over it and the overhang's room either side - PS's pods: ~60 ahead, ~85 up)
  let blocked = 0;
  // (straight over the plate from its top; either side from 20 rows up, where the raised pods swing)
  for (let x = lm.base.x0 - 60; x <= lm.base.x1 + 60; x += 2) {
    const over = x >= lm.base.x0 && x <= lm.base.x1;
    for (let y = lm.base.y - (over ? 1 : 20); y >= lm.base.y - 84; y -= 3) if (!open(x, y)) blocked += 1;
  }
  check(blocked === 0, `open sky over it, and 60 clear either side from 20 up to 85 up (${blocked} cells in the way)`);
  pwApp.stepWorld(70);
  const u = (world.defence || []).find((q) => !q.dead && q.mount === `m${lm.id}`);
  check(!!u && u.type === 'launcher' && !u.hold, `PS's launcher is seated on it, armed (${u ? `${u.type} at ${Math.round(u.x)},${u.y}` : 'none'})`);
  await view('n114-placed-launcher', lm.x, lm.y - 40, 5);
}
// (the interceptors: an Iron Dome and a Patriot, each on its base)
for (const type of ['dome', 'patriot']) {
  let r = null;
  for (let k = 0; k < 16 && !(r && r.ok); k += 1) r = G.placeArtillery(m, 'left', type, front + dir * (400 - k * 110));
  pwApp.stepWorld(70);
  const u = r && r.ok ? (world.defence || []).find((q) => !q.dead && q.mount === `m${r.mount.id}`) : null;
  check(!!r && r.ok && r.mount.kind === 'interceptor' && !!u && u.type === type, `a ${type} is set on an interceptor's base (${r ? (r.ok ? `at ${r.mount.x}, seated ${u ? u.type : 'none'}` : r.note) : '-'})`);
}
// (the cap: one a level of its military bases, all three together - the bases set low so it is reached:
// one at level 2, the rest at 1)
const mil = G.bases(m, 'left');
mil.forEach((b, i) => { b.level = i === 0 ? 2 : 1; });
const cap = G.artilleryCap(m, 'left');
const placedNow = () => (world.mounts || []).filter((q) => q.placedBy === 'left' && q.kind !== 'turret' && !q.spent).length;
let why = '';
for (let guard = 0; placedNow() < cap && guard < 12; guard += 1) {
  const s = MT.find(world, Math.min(front - dir * 3000, front + dir * 450), Math.max(front - dir * 3000, front + dir * 450), { kind: 'launcher', road: true, near: front });
  if (!s) { why = 'no spot found'; break; }
  const r = G.placeArtillery(m, 'left', 'launcher', s.x0 + MT.KINDS.launcher.w / 2);
  if (!r.ok) { why = `at ${s.x0}: ${r.note}`; break; }
}
if (why) info(`filling the cap stopped: ${why}`);
const over = G.canArtillery(m, 'left', 'launcher');
check(cap === mil.reduce((s, b) => s + b.level, 0), `the cap is its military bases' levels together (${cap} for ${mil.length} bases at ${mil.map((b) => b.level).join('+')})`);
if (placedNow() >= cap) check(!over.ok && /at most/.test(over.note), `at the cap the next is refused (${placedNow()} placed: ${over.note || 'not refused'})`);
else info(`the cap was not reached here - flat ground open to the sky ran out near the front at ${placedNow()} (the refusal is not tested on this seed)`);

// 4. The computer sets its own.
world.stock.right.hm = 6000; world.stock.right.sm = 1000;
const ai = m.sides.right.ai;
for (let s = 0; s < 150 && !((ai && ai.brain.artillery) > 0); s += 1) pwApp.stepWorld(60);
check(!!ai && ai.brain.artillery > 0, `the computer sets artillery on bases of its own (${ai ? `${ai.brain.artillery || 0}; last: ${ai.brain.last}` : 'no computer'})`);
return { checks, shots };
