// N104 - mountain road tunnels, on the capital lab (det). The lab's mountain stands between the plateau
// and the high plain (its saddle, shoulder shelf and peak one massif). A capital seeded on the high plain
// spreads to the mountain's foot and bores a road through it: portals on the flats at each foot, 96 rows
// clear over a paved road - the only tunnel floor marked a road - barricades of the boring side in it;
// then the city carries on past the far portal. A tank, a mech and a man go through. A military seed on
// the mountain's shoulder, come to half its levels, bores one too (its own side's).
// --page=capital-lab.html --ready="window.pwLab && pwLab.ready" --params=det=1&seed=N
const { world } = pwLab;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const view = async (name, x, y, z) => { pwLab.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const G = pwLab.growth, RT = PW.roadTunnels, M = PW.M;
const id = (x, y) => PW.get(world, x, y) & 63;
const open = (x, y) => PW.mat.phase[id(x, y)] <= PW.PHASE.GAS;
const mtns = G.barriers.filter((b) => b.kind === 'mountain');
info(`mountain barriers: ${mtns.map((b) => `${b.x0}-${b.x1}`).join(' ')}`);

// 1. A capital on the high plain spreads to the mountain and bores through it.
pwLab.setSpeed(20);
pwLab.drop(11300, 'capital', 'modern');
let t = null;
for (let s = 0; s < 240 && !(t && t.done); s += 1) {
  pwLab.stepWorld(60);
  t = (world.roadTunnels || [])[0] || null;
}
const city = G.cities[0];
info(`capital lv${city.level} edge ${city.edge.left}..${city.edge.right} blocked ${JSON.stringify(city.blocked)} notes ${city.notes.join(' / ')}`);
check(!!t, `the city reaching the mountain's foot bores a road through it (${t ? `${t.a}..${t.b}, ${t.done ? 'through' : `at ${Math.round(t.at)}`}` : 'none'})`);
if (!t) return { checks, shots };
check(t.done, `the bore goes through (${t.b - t.a} cells)`);
// (portals on the flats at each foot: the land outside them level 40 cells out)
// (a portal opens onto the flats at its foot - or, where a town has grown up to the mountain, at the
// town's edge: its road runs on into the town's street)
const flat = (x, dir) => { let lo = Infinity, hi = -Infinity; for (let j = 0; j <= 40; j += 2) { const g = world.groundTop[x + dir * j]; lo = Math.min(lo, g); hi = Math.max(hi, g); } return hi - lo; };
const town = (x, dir) => { for (let k = 0; k <= 40; k += 4) { const q = x + dir * k; for (let y = world.groundTop[q] - 96; y < world.groundTop[q] + 4; y += 4) { const o = PW.getOwner(world, q, y); if (o > 0 && o < 50000) return true; } } return false; };
const opens = (x, dir) => flat(x, dir) <= 4 || town(x, dir);
check(opens(t.a, -1) && opens(t.b, 1), `its portals open onto the flats at each foot, or the town grown up to it (${t.a}: ${flat(t.a, -1)} rows of give${town(t.a, -1) ? ', a town' : ''}, ${t.b}: ${flat(t.b, 1)}${town(t.b, 1) ? ', a town' : ''})`);
// (96 rows clear over the road all along the bored stretch)
let low = Infinity, bored = 0, roadOk = 0, cols = 0;
for (let x = t.a + 20; x <= t.b - 20; x += 8) {
  const f = t.floorAt(x);
  cols += 1;
  if (PW.getFlags(world, x, f) & PW.FLAG.ROAD) roadOk += 1;
  if (!(PW.getFlags(world, x, f - 4) & PW.FLAG.TUNNEL)) continue;
  bored += 1;
  let n = 0; while (n < 140 && open(x, f - 1 - n)) n += 1;
  // (a barricade standing on the road is not the bore's height)
  if ((world.barricades || []).some((b) => x >= b.x0 - 2 && x <= b.x1 + 2)) continue;
  low = Math.min(low, n);
}
check(bored > 10 && low >= RT.CLEAR, `tall enough for the whole army: ${low === Infinity ? '-' : low} rows clear over the road at its lowest (${bored} bored columns; a tank 58, a mech 48)`);
check(roadOk >= cols * 0.95, `a paved road all the way, the only tunnel floor marked a road (${roadOk} of ${cols} columns)`);
// (the bundle goes through under the road - never across the way the army drives - as bored, and
// after the city has grown on and re-laid it)
const pipeOver = (when) => {
  let piped = 0;
  const pipedAt = [];
  for (let x = t.a; x <= t.b; x += 1) {
    const f = t.floorAt(x);
    for (let y = f - RT.CLEAR; y < f; y += 1) {
      if (id(x, y) === M.PIPE || (PW.getFlags(world, x, y) & PW.FLAG.HOLLOW)) { piped += 1; if (pipedAt.length < 4) pipedAt.push(`${x},${y}`); break; }
    }
  }
  check(piped === 0, `the supply line runs under the road, not across its way, ${when} (${piped} columns with pipe over the road${pipedAt.length ? `: ${pipedAt.join(' ')}` : ''})`);
};
pipeOver('as bored');
const bars = (world.barricades || []).filter((b) => b.tunnel === t.id);
check(bars.length >= 2 && bars.every((b) => b.side === t.side && b.laid > 20), `barricades of the boring side in it (${bars.length}: ${bars.map((b) => `${b.x0}..${b.x1} ${b.side}`).join(', ')})`);
await view('n104-portal-a', t.a + 60, t.floorAt(t.a + 60) - 60, 4);
await view('n104-in-the-bore', Math.round((t.a + t.b) / 2), t.floorAt(Math.round((t.a + t.b) / 2)) - 50, 4);
await view('n104-portal-b', t.b - 60, t.floorAt(t.b - 60) - 60, 4);
// (the city carries on past the far portal)
pwLab.stepWorld(60 * 60);
check(city.edge.left < t.a, `the city carries on past the far portal (its left edge ${city.edge.left}, the portal ${t.a})`);

// 2. A man, a tank and a mech go through - the barricades taken off for it (PS lets the side's own
// units through them; that is the physics' half).
for (const b of bars) { for (const i of b.cells) { const x = i % world.width, y = (i / world.width) | 0; if (id(x, y) === M.CONCRETE || id(x, y) === M.STEEL) PW.set(world, x, y, M.AIR); } b.laid = 0; }
// (developed: lined, its road walls in - as the side's crews would, given time)
PW.tunnels.advanceTo(world, (PW.tunnels.state(world).time || 0) + 1e6);
pipeOver('with the city grown on past it');
await view('n104-bore-developed', Math.round((t.a + t.b) / 2), t.floorAt(Math.round((t.a + t.b) / 2)) - 50, 5);
// (each set down on the road just inside the far portal from the city - the city's own streets are
// another matter)
// (inside the far mouth, on the road itself: just outside it the road may run on into a town's
// street up its bank, which is the town's ground, not the tunnel's)
const mouthB = t.portals.find((p) => p.end === 'b');
const start = mouthB ? Math.min(t.b - 30, mouthB.x - 40) : t.b - 30, goal = t.a + 40;
// (set down on the road itself: given no height, a unit is put on its column's top - the mountain's)
const tank = PW.tanks ? PW.tanks.create(world, { style: 'modern', side: t.side, x: start, y: t.floorAt(start), facing: -1 }) : null;
if (tank) PW.tanks.drive(tank, -1);
pwLab.setSpeed(1);
for (let s = 0; s < 60 * 90 && tank && tank.x > goal; s += 30) pwLab.stepWorld(30);
// (a vehicle keeps out of tunnels unless its tunnel is a road - the user's rule, PS's half: until the
// hulls know a road tunnel, it is noted, not failed)
const vehiclesIn = !!(PW.tanks && PW.tanks.roadTunnels);
if (tank && tank.x > goal) await view('n104-tank-stuck', Math.round(tank.x), Math.round(tank.y) - 30, 6);
const tankLine = `a tank drives through, portal to portal (at ${tank ? Math.round(tank.x) : '-'}, the far portal ${t.a}${tank && tank.blocked ? `, stopped: ${tank.blocked}` : ''}${tank && tank.x > goal ? ` - set down at ${start},${t.floorAt(start)}, y ${Math.round(tank.y)}, stopAt ${JSON.stringify(tank.stopAt || null)}, v ${(tank.v || 0).toFixed(1)}, dead ${!!tank.dead}` : ''})`;
if (vehiclesIn) check(!!tank && tank.x <= goal, tankLine); else info(`(PS's road-tunnel driving not in yet) ${tankLine}`);
if (tank) world.tanks.splice(world.tanks.indexOf(tank), 1);
const man = PW.troops.create(world, { x: start + 0.5, y: t.floorAt(start), side: t.side, style: 'modern', facing: -1 });
PW.troops.goTo(world, man, goal, t.floorAt(goal) - 1);
for (let s = 0; s < 60 * 120 && man.x > goal + 10 && !man.dead; s += 30) pwLab.stepWorld(30);
if (man.x > goal + 10) {
  const mx = Math.round(man.x), mf = t.floorAt(mx), ahead = [];
  for (let dx = -16; dx <= 0; dx += 4) { const c = []; for (let y = mf - 30; y <= mf + 1; y += 3) c.push(PW.mat.names[id(mx + dx, y)][0]); ahead.push(`${mx + dx}:${c.join('')}`); }
  info(`the man stopped at ${man.x.toFixed(1)},${man.y} (floor ${mf}) walk ${man.walk} route ${man.route ? man.route.length : '-'} | ${ahead.join(' ')}`);
  await view('n104-man-stopped', mx, mf - 40, 6);
}
check(man.x <= goal + 10, `a man walks through (at ${Math.round(man.x)})`);
const mech = PW.mechs ? PW.mechs.create(world, { x: start, y: t.floorAt(start) - 1, side: t.side, style: 'modern', facing: -1 }) : null;
if (mech) PW.mechs.walk(mech, -1);
for (let s = 0; s < 60 * 120 && mech && mech.x > goal; s += 30) pwLab.stepWorld(30);
const mechLine = `a mech walks through (at ${mech ? Math.round(mech.x) : '-'})`;
if (vehiclesIn) check(!!mech && mech.x <= goal, mechLine); else info(`(PS's road-tunnel driving not in yet) ${mechLine}`);

// 3. A miners' drift of another side crosses the road tunnel: its lining stops no one.
const mid = Math.round((t.a + t.b) / 2), f = t.floorAt(mid);
const net = PW.tunnels.createNetwork(world, { side: 'other', style: 'gothic', x: mid - 200, y: f - 10 });
const dug = PW.tunnels.digBox(world, net, mid - 200, f - 30, mid + 200, f - 1, { kind: 'drift' });
check(dug.ok, `a miners' drift of another side crosses it (${dug.ok ? 'dug through' : `blocked by network ${dug.by}`})`);

// 4. One road through a mountain: another side's base coming to it finds this one - anyone may use it.
const n0 = world.roadTunnels.length;
const again = RT.forMountain(world, t.a + 100, t.b - 100, { side: 'east' });
check(again.ok && again.tunnel === t && world.roadTunnels.length === n0, 'another side asking finds the one road there is - anyone may use it');

// 5. N121 (the user's): each mouth an entrance, not a cut - the arch ring standing out over the
// road, the stone face and its stepped wing walls behind; and the towns' gate halls as tall as it.
for (const p of t.portals) {
  const out = p.end === 'a' ? -1 : 1;
  let ring = 0, face = 0;
  for (let k = 1; k <= 12; k += 1) for (let y = p.top - 20; y < p.top; y += 1) if (id(p.x + out * k, y) === PW.M.REINFORCED || (PW.getLayer(world, 'back', p.x + out * k, y) && PW.mat.open[id(p.x + out * k, y)])) ring += 1;
  for (let k = 0; k <= 40; k += 1) for (let y = p.top - 40; y < p.floor; y += 1) if (PW.getLayer(world, 'back', p.x + out * k, y) && PW.mat.open[id(p.x + out * k, y)]) face += 1;
  const clear = (() => { let n = 0; for (let y = p.floor - 1; y > p.floor - 120 && PW.mat.open[id(p.x + out * 6, y)]; y -= 1) n += 1; return n; })();
  // (a mouth opening where a town has grown up to it meets the town's works: its ring gives way to
  // them, and a building's doorway right there is joined to it by a covered way)
  let byTown = !!t.joined;
  for (let k = 1; k <= 14 && !byTown; k += 1) for (let y = p.top - 20; y < p.top && !byTown; y += 2) { const o = PW.getOwner(world, p.x + out * k, y); if (o > 0 && o < 50000) byTown = true; }
  check((ring > 60 || byTown) && face > 200 && clear >= 95, `the ${p.end} mouth has its arch ring out over the road (${ring} cells${byTown ? `, a town's works at it${t.joined ? `, joined to building ${t.joined}` : ''}` : ''}), its face and wing walls behind (${face}), and the road's full height under the ring (${clear} rows)`);
  await view(`n121-portal-${p.end}`, p.x + out * 30, p.top + 20, 4);
}
// 6. N132 (the user's): the buildings by a portal sit on the ground - beside each one within 400
// cells of a mouth the land meets its floor (within 4 rows, 8 cells out), never a plinth stood up
// over a drop.
const near = [];
for (const p of t.portals) for (const b of world.buildings) {
  if (!b || !b.body || b.dismantled || !Number.isFinite(b.ground) || Math.abs((b.body.left + b.body.right) / 2 - p.x) > 400) continue;
  const g = (x) => world.groundTop[Math.max(0, Math.min(world.width - 1, Math.round(x)))];
  // (just past its works - its own footings and benches are its foundation, not the land)
  const [w0, w1] = b.works || [b.body.left, b.body.right];
  near.push({ b, dl: g(Math.min(b.body.left, w0) - 3) - b.ground, dr: g(Math.max(b.body.right, w1) + 3) - b.ground });
}
const raised = near.filter((n) => n.dl > 4 || n.dr > 4);
if (!near.length) info('no building stands within 400 cells of a mouth on this seed');
else check(!raised.length, `the buildings by its mouths sit on the ground (${near.map((n) => `b${n.b.id}: ${n.dl}/${n.dr}`).join(', ') || 'none near'} rows of drop beside the floor, left/right)`);
for (const n of near.slice(0, 2)) await view(`n132-by-the-portal-b${n.b.id}`, (n.b.body.left + n.b.body.right) / 2, n.b.ground - 60, 4);
const halls = world.buildings.filter((b) => b && b.canvas && b.canvas.meta && b.canvas.meta.undercroft);
check(halls.length > 0 && halls.every((b) => b.canvas.meta.undercroft.height === PW.buildingKit.S.HALL),
  `every gate hall stands as tall as the road tunnel (${[...new Set(halls.map((b) => b.canvas.meta.undercroft.height))].join(', ')} rows; the tunnel ${PW.roadTunnels.CLEAR})`);
return { checks, shots };
