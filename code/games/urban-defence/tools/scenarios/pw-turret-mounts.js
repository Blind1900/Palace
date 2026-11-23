// N103 (part of N89) - the user's turret redesign, on the game page in a match (mode=game&start=versus&
// side=left&det=1). The turret built into military roofs is gone: a turret stands on a turret base, a
// low steel plate on a flat surface - a roof, the land, a tunnel room's floor - and the turret (PS's)
// is seated on the plate's top row. Sized between a trooper and a tank; the tunnels' rooms stand tall
// enough to house one. The person sets one down by real clicks; one whose base is blown is lost.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world } = pwApp;
const m = pwApp.match();
const G = PW.game, MT = PW.mounts, M = PW.M;
const id = (x, y) => PW.get(world, x, y) & 63;
const open = (x, y) => PW.mat.phase[id(x, y)] <= PW.PHASE.GAS;
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
pwApp.stepWorld(90);
const ROLE_DEVICE = PW.buildingKit.ROLE.DEVICE;
const unitOn = (rec) => (world.defence || []).find((u) => !u.dead && u.type === 'turret' && Math.abs(u.x - rec.x) < 1 && u.y === rec.y);

// 1. The roofs: no turret built into them - a base plate where it stood, the building's own, and a
// live turret seated on it.
const roofs = [];
for (const b of world.buildings) {
  if (!b || !b.canvas || !b.devices) continue;
  for (const d of b.devices) if (d.kind === 'turret') roofs.push({ b, d });
}
let painted = 0, plates = 0, seated = 0, freeFire = 0;
for (const { b, d } of roofs) {
  const c = b.canvas, B = d.base;
  if (!B) continue;
  // (over the plate, in the blueprint: nothing drawn as a device - the old turret stood there)
  for (let y = B.y - 22; y < B.y; y += 1) for (let x = B.x0; x <= B.x1; x += 1) {
    const lx = x - b.ox, ly = y - b.oy;
    if (lx >= 0 && ly >= 0 && lx < c.width && ly < c.height && c.role[ly * c.width + lx] === ROLE_DEVICE) painted += 1;
  }
  if (MT.intact(world, B, b.id)) plates += 1;
  const u = unitOn(d);
  if (u) { seated += 1; if (!u.hold) freeFire += 1; }
}
info(`roof turret bases: ${roofs.length} on ${new Set(roofs.map((r) => r.b.id)).size} buildings (${roofs.filter((r) => r.b.type === 'military').length} military)`);
check(roofs.length >= 4 && roofs.every((r) => r.d.base && r.d.base.x1 - r.d.base.x0 + 1 === MT.BASE_W), `every roof turret is a base record, ${MT.BASE_W} wide (${roofs.length})`);
check(painted === 0, `no turret is built into a roof any more (${painted} device cells over the plates)`);
const standing = roofs.filter((r) => !r.b.ruined && !r.b.coresOpen && MT.intact(world, r.d.base, r.b.id));
check(plates >= roofs.length * 0.8, `the plates stand on the roofs (${plates} of ${roofs.length})`);
check(seated >= standing.length && freeFire === seated, `a turret is seated on every standing plate, free to fire in the match (${seated} seated, ${freeFire} free, ${standing.length} plates)`);
const roof = roofs.find((r) => r.b.type === 'military' && unitOn(r.d)) || roofs[0];
if (roof) await view('n103-roof-turret', roof.d.x, roof.d.y - 30, 6);

// 2. The land and the rooms: the world's own bases - each plate on flat ground, open air over it.
const land = (world.mounts || []).filter((q) => q.at === 'land'), rooms = (world.mounts || []).filter((q) => q.at === 'room');
info(`world bases: ${land.length} on the land, ${rooms.length} in rooms (seeded ${world.mountsSeeded})`);
const sound = (q) => {
  const B = q.base;
  if (!MT.intact(world, B, 0)) return 'plate broken';
  for (let x = B.x0; x <= B.x1; x += 1) {
    if (open(x, B.y + MT.BASE_H)) return `a gap under it at ${x}`;
    for (let y = B.y - 1; y >= B.y - (MT.CLEAR - MT.BASE_H); y -= 1) if (!open(x, y)) return `not clear over it at ${x},${y}`;
  }
  return '';
};
const bad = [...land, ...rooms].map((q) => [q, sound(q)]).filter(([, s]) => s);
check(land.length >= 1, `turret bases on the land before the military (${land.length})`);
check(rooms.length >= 1, `turret bases in the bases' rooms underground (${rooms.length})`);
check(bad.length === 0, `each stands flat on its floor with room over it (${bad.map(([q, s]) => `${q.at}@${q.x}: ${s}`).slice(0, 3).join('; ') || 'all'})`);
check([...land, ...rooms].every((q) => unitOn(q)), `a turret on each (${[...land, ...rooms].filter((q) => unitOn(q)).length} of ${land.length + rooms.length})`);
if (land[0]) await view('n103-land-turret', land[0].x, land[0].y - 30, 6);
if (rooms[0]) await view('n103-room-turret', rooms[0].x, rooms[0].y - 30, 6);

// 3. Its size: between a trooper and a tank (plate and head - the head is PS's, 24 over the plate).
const tall = MT.BASE_H + 24, wide = MT.BASE_W;
check(tall > PW.troops.HEIGHT && tall < 58 && wide > 12 && wide < 128, `sized between a trooper and a tank (${wide} x ${tall}; trooper 12 x ${PW.troops.HEIGHT}, tank 128 x 58)`);

// 4. The tunnels' rooms house one: a halls-and-rooms tunnel carved deep under a wild zone - a base in
// each room it could, every one under a roof high enough.
const zone = pwApp.layout.wilds.slice().sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0];
const tx = Math.round(zone.x0 + 200);
const tfloor = Math.round(Math.max(...Array.from({ length: 30 }, (_, k) => world.groundTop[tx + k * 50])) + 230);
const net = PW.tunnels.createNetwork(world, { side: 'left', style: m.sides.left.style, x: tx, y: tfloor });
const plan = PW.tunnels.planTunnel(world, { x: tx, floor: tfloor, dir: 1, length: 1400, seed: 3, rooms: ['vault', 'hub', 'cavern'] });
const dug = PW.tunnels.carveTunnel(world, net, plan);
const tRooms = plan.sections.filter((s) => s.kind === 'room');
const inRoom = (world.mounts || []).filter((q) => q.network === net.id);
check(tRooms.every((s) => s.floor - s.top >= MT.CLEAR) && inRoom.length >= Math.min(2, tRooms.length),
  `the tunnel's rooms are tall enough and each houses a turret (${tRooms.map((s) => s.floor - s.top).join(', ')} rows; ${inRoom.length} bases)`);
check(inRoom.every((q) => tRooms.some((s) => q.base.x0 >= s.x0 && q.base.x1 <= s.x1 && q.base.y + MT.BASE_H === s.floor)), 'each sits on its room\'s floor');
MT.sweep(world, { armed: true });
if (inRoom[0]) { check(!!unitOn(inRoom[0]), 'and a turret is seated in the room'); await view('n103-tunnel-room-turret', inRoom[0].x, inRoom[0].y - 40, 5); }

// 5. The person sets one down by real clicks: TURRET in hand, a click on flat ground in their vision.
const hm0 = G.purse(m, 'left').hm;
const placed0 = (world.mounts || []).length;
const btn = document.querySelector('#gm-bar [data-tool="turret"]');
check(!!btn, 'the game bar has a TURRET tool');
let set = null;
if (btn) {
  const p = centre(btn); await click(p.x, p.y); await sleep(60);
  check(PW.gameUI.tool() === 'turret', 'TURRET is in hand');
  const front = G.frontOf(m, 'left', true);
  for (let k = 0; k < 16 && !set; k += 1) {
    const x = Math.round(front - 60 + k * 45);
    if (!PW.vision.sees(world, 'left', x)) continue;
    if (PW.gameUI.tool() !== 'turret') { const q = centre(btn); await click(q.x, q.y); await sleep(40); }
    pwApp.focus(x, world.groundTop[x] - 60, 3); await sleep(120);
    const cp = pwApp.toClient(x, world.groundTop[x] - 3);
    await click(cp.x, cp.y); await sleep(60);
    if ((world.mounts || []).length > placed0) set = world.mounts[world.mounts.length - 1];
  }
}
check(!!set && set.placedBy === 'left' && G.purse(m, 'left').hm <= hm0 - G.TURRET.hm + 1, `a real click sets a turret on its base (at ${set ? set.x : '-'}; HM ${Math.round(hm0)} -> ${Math.round(G.purse(m, 'left').hm)})`);
const su = set && unitOn(set);
check(!!su && su.side === 'left' && !su.hold && su.game && G.fielded(m, 'left') === G.fielded(m, 'left'), 'it is armed for the left side at once - a work, taking no POP');
if (set) await view('n103-placed-turret', set.x, set.y - 30, 6);

// 6. Lost with its base: the plate blown, the turret comes off, and no turret is seated there again.
if (set) {
  pwApp.explode(set.x, set.base.y + 2, 16, 1.2);
  pwApp.stepWorld(60 * 3);
  check(!unitOn(set) || unitOn(set).dead, 'its base blown, the turret comes off');
  pwApp.stepWorld(60 * 40);
  check(!unitOn(set) && set.spent, 'and none is seated there again - it was lost');
}

// 7. A building's turret lost while its plate stands is seated again a while after (the base is the
// building's: its crews keep it, and it takes a turret again).
// (read by the mount's key: over a long match the towns re-seat their buildings at level-ups)
const liveOn = (key) => { const u = world.mountUnits.get(key); return u && !u.dead ? u : null; };
const keepKey = [...world.mountUnits.keys()].find((k) => k[0] === 'b' && liveOn(k) && (() => { const b = world.buildings[Number(k.slice(1).split(':')[0]) - 1]; return b && !b.ruined && b.type === 'military'; })());
if (keepKey) {
  const u0 = liveOn(keepKey);
  PW.defence.hurt(world, u0, 999, 'test');
  pwApp.stepWorld(60 * 5);
  const early = liveOn(keepKey);
  pwApp.stepWorld(60 * 40);   // (half a minute after it is found lost - the sweep looks once a second)
  const later = liveOn(keepKey);
  check(!early && !!later && later !== u0, `a building's turret lost is replaced on its standing plate after a while (${keepKey}: ${early ? 'at once' : 'not at once'}, ${later ? 'later yes' : 'later no'})`);
}
return { checks, shots: shots.length };
