// N130 (the user's, 2026-11-24) - military exits, on the game page (mode=game&start=test&side=left&det=1):
// before a mountain base sends out a man it needs a proper way out - tunnels, bridges, the mountain's
// road tunnel; nothing is set down stranded on the mountain or at its foot; every unit comes up from
// a military building's core. A base not yet up to its road tunnel sets a spawn core down in its own
// tunnel once the space there has cleared, and its men walk out by the adit; its tunnels join the
// main base's.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world, layout } = pwApp;
const m = pwApp.match(), G = PW.game, eng = world.capitalGrowth, T = PW.tunnels;
// (the shots look past the fog of war: the mountain's flank and the neutral towns lie beyond the
// side's sight)
const view = async (name, x, y, z) => {
  const fog = PW.FOG_OFF; PW.FOG_OFF = true;
  pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name));
  PW.FOG_OFF = fog;
};
const secs = (s) => { for (let k = 0; k < s; k += 1) pwApp.stepWorld(60); };
const built = (c) => { const r = c && c.main && world.buildings[c.main.owner - 1]; return !!r && !r.underConstruction; };
world.stock.left.hm = 1e6; world.stock.left.sm = 1e5;
world.buildSpeed = 16;   // (the growth, the crews and the workings' clock: sixteen times as fast)

// (the neutral towns as the match opens, for part 8)
const lotsOf = (c) => c.rings.left.length + c.rings.right.length;
const neutral0 = eng.cities.filter((c) => !c.faction || c.faction === 'neutral').map((c) => ({ c, level: c.level, lots: lotsOf(c) }));
m.neutralHold = true;   // (held while the base's parts run - they grow from part 8 on, on the match's clock)
// 1. The capital, in the side's third.
const [a, b] = G.thirdOf(world, 'left');
let start = null;
for (let k = 0; k < 30 && !start; k += 1) {
  const x = Math.round((a + b) / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 120);
  const r = G.placeStart(m, 'left', x);
  if (r.ok) start = r.city || eng.cities.find((c) => c.faction === 'left' && c.start);
}
check(!!start, `the side's capital stands (${start ? `at ${start.x}` : 'none'})`);
if (!start) return { checks };
for (let s = 0; s < 120 && !built(start); s += 1) secs(1);

// 2. A military base up on a mountain: on its front flank, well above the foot.
const rel = layout.relief;
const footFrom = (x) => { let f = x; while (f < world.width - 80 && rel[f] > 0.15) f += 8; return f - x; };
let base = null;
const tried = [];
for (const mt of eng.barriers.filter((q) => q.kind === 'mountain')) {
  for (let x = mt.x0 + 30; x <= mt.x1 - 30 && !base && tried.length < 60; x += 40) {
    if (!(rel[x] > 0.3) || footFrom(x) > 1400 || footFrom(x) < 200) continue;
    const r = eng.drop(x, 'military', 'modern', 'left');
    tried.push(`${x}: ${r && r.city ? `${r.city.setting}` : r && r.note}`);
    if (r && r.city && r.city.setting === 'mountain') base = r.city;
  }
  if (base) break;
}
check(!!base, `a military seed takes up on a mountain (${base ? `at ${base.x}, relief ${rel[base.x].toFixed(2)}` : tried.slice(0, 5).join('; ')})`);
if (!base) return { checks };
for (let s = 0; s < 240 && !built(base); s += 1) secs(1);
const rec = () => world.buildings[base.main.owner - 1];
const B = rec();
info(`the base: level ${base.level}, ground ${B.ground}, core ${(B.cores || []).map((k) => `${Math.round(k.x)},${Math.round(k.y)}`).join(' ')}, foot ${G.frontGround(world, B, 1) ? JSON.stringify(G.frontGround(world, B, 1)) : '-'}`);

// 3. No way out at first, and the button says why; no hull at all till the road tunnel.
const w0 = G.wayOut(m, B, 'trooper');
info(`at first: trooper ${w0.ok ? 'can go out' : w0.why}`);
const t0 = G.canDeploy(m, 'left', 'trooper', B);
check(w0.ok === t0.ok && (t0.ok || /way out/.test(t0.note)), `deploying asks the way out first (${t0.ok ? 'it has one' : t0.note})`);
// 4. Its tunnel: down to the foot's level, the adit out to the daylight, a room, a spawn core once it has cleared.
for (let s = 0; s < 900 && !(base.shaft && base.shaft.exit && base.shaft.exit.core && base.shaft.exit.core.ready); s += 1) secs(1);
const sh = base.shaft, e = sh && sh.exit;
info(`its tunnel: ${sh ? `${sh.top}..${sh.y}/${sh.bottom}${sh.why ? ` ${sh.why}` : ''}` : 'none'}; exit ${e ? `row ${e.row}, at ${e.x} of foot ${e.footX}${e.done ? ' through' : ''}${e.via ? ` via ${e.via}` : ''}${e.why ? ` ${e.why}` : ''}` : 'none'}`);
check(!!e && e.done && !e.why, `an adit is driven out from its shaft to the daylight at the mountain's foot (${e ? `${Math.abs((e.mouth || e.x) - sh.x)} cells long at row ${e.row}` : 'no exit planned'})`);
if (e && e.mouth) await view('n130-adit-mouth', e.mouth, e.row - 20, 4);
const k = e && e.core;
check(!!k && k.ready && (rec().spawnCores || []).includes(k), `once the room by the shaft has cleared a spawn core is set down and built there (${k ? `at ${k.x}, ${k.y}` : 'none'})`);
if (k) await view('n130-spawn-core', k.x, k.y - 20, 6);
// 5. Now a trooper comes up at a core and walks out to the open ground on the front.
const w1 = G.wayOut(m, rec(), 'trooper');
const d = G.canDeploy(m, 'left', 'trooper', rec()).ok ? G.deploy(m, 'left', 'trooper', rec()) : { ok: false, note: G.canDeploy(m, 'left', 'trooper', rec()).note };
if (!w1.ok) info(`the trooper's tries: ${JSON.stringify(w1.tried || [])}`);
check(d.ok, `a trooper deploys (${d.ok ? `at ${Math.round(d.unit.x)},${Math.round(d.unit.y)} from the ${w1.from && w1.from.tunnel ? 'spawn core in the tunnel' : 'base\'s core'}` : d.note})`);
if (d.ok) {
  const u = d.unit, cores = [...(rec().cores || []), ...(rec().spawnCores || [])];
  check(cores.some((q) => Math.abs(q.x - u.x) < 70), `it came up at a core (nearest ${Math.round(Math.min(...cores.map((q) => Math.abs(q.x - u.x))))} cells)`);
  const goal = w1.goal;
  for (let s = 0; s < 90 && goal && Math.abs(u.x - goal.x) > 40; s += 1) secs(1);
  check(!u.dead && goal && Math.abs(u.x - goal.x) <= 60 && rel[Math.round(u.x)] <= 0.2, `and walks out to the open ground on the front (at ${Math.round(u.x)},${Math.round(u.y)}, the goal ${goal ? goal.x : '-'})`);
  await view('n130-out-on-the-front', u.x, u.y - 30, 4);
}
// (the user's correction: troopers, tanks and mechs only from a military building's core spawner -
// never from another building, never from the bare ground)
const capRec = world.buildings[start.main.owner - 1];
const fromCap = G.canDeploy(m, 'left', 'trooper', capRec);
check(capRec && capRec.type !== 'military' && !fromCap.ok, `nothing deploys from a building that is not military (the capital's ${capRec ? capRec.type : '-'}: ${fromCap.ok ? 'it did' : fromCap.note})`);
// 6. Hulls: refused while the base has no road tunnel through.
const tk = G.wayOut(m, rec(), 'tank');
const road = (world.roadTunnels || []).some((t) => t.done && t.side === 'left');
check(road || !tk.ok, `a tank waits for the road tunnel (${tk.ok ? 'it has a way' : tk.why})`);
// 7. Its tunnels joined to the capital's (the capital's shaft comes at level 3).
while (start.level < 3) eng._levelUp(start);
for (let s = 0; s < 900 && !(sh && sh.link && sh.link.end); s += 1) secs(1);
const L = sh && sh.link;
info(`the capital: level ${start.level}, shaft ${start.shaft ? `${start.shaft.top}..${start.shaft.y}/${start.shaft.bottom}${start.shaft.sunk ? ' sunk' : ''}${start.shaft.why ? ` ${start.shaft.why}` : ''}` : 'none'}; the link ${L ? JSON.stringify({ end: L.end, why: L.why, by: L.blockedBy, unders: L.unders, x: L.x, y: L.y, to: L.node }) : 'none'}`);
check(!!L && L.end === 'joined', `its tunnels join the capital's (${L ? `${L.end || 'still driving'}, ${Math.abs(L.x - L.from.x)} cells` : start.shaft ? 'not begun' : 'the capital has no shaft yet'})`);
if (L) await view('n130-link', (L.from.x + L.x) / 2, L.y, 1);
// 8. The neutral towns start at the lowest level and the match levels them up as it goes on.
check(neutral0.length >= 1 && neutral0.every((n) => n.level <= 1), `the neutral towns start at the lowest level (${neutral0.map((n) => `#${n.c.id} level ${n.level}`).join(', ') || 'none'})`);
const N = neutral0[0] && neutral0[0].c;
if (N) await view('n130-neutral-early', N.x, world.groundTop[Math.round(N.x)] - 100, 2);
m.neutralHold = false;
world.buildSpeed = 4;   // (the test's own pace again: the neutral towns grow as a match's would)
for (let s = 0; s < 420 && !neutral0.some((n) => n.c.level >= 2); s += 1) secs(1);
check(neutral0.some((n) => n.c.level >= 2), `the match levels them up as it goes on (${neutral0.map((n) => `#${n.c.id} ${n.level} -> ${n.c.level}, lots ${n.lots} -> ${lotsOf(n.c)}`).join('; ')}, at ${m.clock.toFixed(0)} s)`);
for (const n of neutral0) info(`neutral #${n.c.id}: blocked ${JSON.stringify(n.c.blocked)}, shaft ${n.c.shaft ? `${n.c.shaft.top}..${n.c.shaft.y}, ${n.c.shaft.branches.length} branches` : 'none'}, purse ${JSON.stringify(world.stock && world.stock[n.c.faction] || null)}, notes ${(n.c.notes || []).slice(-3).map((q) => q.text || q).join(' | ')}`);
check(neutral0.some((n) => lotsOf(n.c) > n.lots), `and they grow as they level - new lots past their first (${neutral0.map((n) => `#${n.c.id} lots ${n.lots} -> ${lotsOf(n.c)}`).join('; ')})`);
secs(30);
if (N) await view('n130-neutral-later', N.x, world.groundTop[Math.round(N.x)] - 100, 2);
return { checks, shots };
