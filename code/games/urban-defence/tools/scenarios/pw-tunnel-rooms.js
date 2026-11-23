// N88 - halls and rooms (the user's tunnel and room-type photos): a tunnel laid out as narrow hallways
// opening through door frames into bigger, higher rooms - rooms of every size - dug deep in a wild
// zone's rock and developed in a faction's look, every hall and room type in turn. A trooper walks it
// end to end.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const { world, layout } = pwApp;
const T = PW.tunnels;
// (deep in a wild zone, well under the ground and over the bedrock)
const zone = layout.wilds.slice().sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0];
const x = Math.round(zone.x0 + 200);
const floor = Math.round(Math.max(...Array.from({ length: 47 }, (_, k) => world.groundTop[x + k * 50])) + 230);
const net = T.createNetwork(world, { side: 'left', style: 'modern', x, y: floor });
const plan = T.planTunnel(world, { x, floor, dir: 1, length: 2200, seed: 7,
  halls: T.HALLS, rooms: T.ROOMS });
const halls = plan.sections.filter((s) => s.kind === 'hall'), rooms = plan.sections.filter((s) => s.kind === 'room');
check(plan.sections.every((s, i) => i === 0 || s.kind !== plan.sections[i - 1].kind), `hallways and rooms alternate (${plan.sections.map((s) => s.type).join(' > ')})`);
check(new Set(halls.map((s) => s.type)).size === T.HALLS.length && new Set(rooms.map((s) => s.type)).size === T.ROOMS.length,
  'every hallway type and every room type is laid');
const widths = rooms.map((s) => s.x1 - s.x0), heights = rooms.map((s) => s.floor - s.top);
check(Math.max(...widths) >= 1.6 * Math.min(...widths) && Math.max(...heights) - Math.min(...heights) >= 20,
  `rooms vary in size (${rooms.map((s) => `${s.x1 - s.x0}x${s.floor - s.top}`).join(', ')})`);
check(rooms.every((r) => halls.every((h) => r.floor - r.top > h.floor - h.top)), 'every room is higher than every hallway');
check(plan.doors.length === plan.sections.length - 1, `a door frame at every meeting (${plan.doors.map((d) => d.type).join(', ')})`);
const dug = T.carveTunnel(world, net, plan);
check(dug.cells > 50000, `dug (${dug.cells} cells)`);
// N109: every roof stands 1.5% higher than laid out (in whole rows) - read as dug, before the lining
// casts the overbreak back to the profile
const segs = T.state(world).segments.filter((s) => s.net === net.id);
const raised = plan.sections.map((s) => {
  const h = s.floor - s.top, want = Math.ceil(h * 0.015);
  const mid = Math.round((s.x0 + s.x1) / 2), seg = segs.find((g) => mid >= g.x0 && mid <= g.x1 && g.y1 >= s.floor - 2);
  return { s, h, want, got: seg ? s.top - seg.y0 : -1 };
});
check(raised.every((r) => r.got >= r.want), `N109: each hall and room roof is raised 1.5% (${raised.map((r) => `${r.s.type} ${r.h}+${r.got}`).join(', ')})`);
// (developed: lined and fitted in the faction's look, the types worked in)
T.advanceTo(world, (T.state(world).time || 0) + 1e6);
const open = (px, py) => (PW.get(world, px, py) & PW.ID_MASK) === PW.M.AIR;
// (read clear of a room's turret base, N103 - it stands on the floor, 6 rows tall)
const clearCol = (s) => {
  const mid = Math.round((s.x0 + s.x1) / 2);
  const plated = (x) => (world.mounts || []).some((m) => x >= m.base.x0 - 2 && x <= m.base.x1 + 2 && m.base.y + PW.mounts.BASE_H >= s.floor - 1 && m.base.y < s.floor);
  // (within the room's full-height middle - its shoulders stand lower)
  const sh = s.kind === 'room' ? Math.min(48, Math.round((s.x1 - s.x0) * 0.18)) + 2 : 2;
  for (let x = mid, k = 1; x >= s.x0 + sh && x <= s.x1 - sh; x = mid + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 6, k += 1) if (!plated(x)) return x;
  return mid;
};
check(plan.sections.every((s) => open(clearCol(s), s.floor - 5) && open(clearCol(s), s.top + 3)),
  'each hall and room is open from its floor to its roof');
const roomBases = (world.mounts || []).filter((m) => m.network === net.id);
check(roomBases.length >= 1, `the rooms house turret bases (N103: ${roomBases.length})`);
const framed = plan.doors.every((d) => (PW.getFlags(world, d.x - 3, d.floor - 10) & PW.FLAG.FIXTURE) !== 0);
check(framed, 'the door frames stand at the meetings');
// A trooper walks it end to end.
const t = PW.troops.create(world, { x: plan.sections[0].x0 + 20.5, y: floor - 1, side: 'left', style: 'modern', facing: 1 });
const goal = plan.sections[plan.sections.length - 1].x1 - 20;
PW.troops.goTo(world, t, goal, floor - 1);
for (let s = 0; s < 150 && Math.abs(t.x - goal) > 12; s += 1) {
  pwApp.stepWorld(60);
  if (!t.route && Math.abs(t.x - goal) > 12) PW.troops.goTo(world, t, goal, floor - 1);
}
check(Math.abs(t.x - goal) <= 12 && !t.dead, `a trooper walks the whole tunnel through every door (${Math.round(t.x - plan.sections[0].x0)} of ${goal - plan.sections[0].x0} cells)`);
// A look at each type.
for (const s of plan.sections) {
  pwApp.focus(Math.round((s.x0 + s.x1) / 2), Math.round((s.top + s.floor) / 2), s.kind === 'room' && s.x1 - s.x0 > 300 ? 4 : 5);
  await sleep(250);
  shots.push(await shot(`n88-${s.kind}-${s.type}`));
}
return { checks, shots: shots.length, plan: plan.sections.map((s) => `${s.kind} ${s.type} ${s.x1 - s.x0}x${s.floor - s.top}`) };
