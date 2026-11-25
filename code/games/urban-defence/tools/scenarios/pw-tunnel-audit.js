// N144 (the user's screenshot, 2026-11-24): the mountain tunnels, looked over whole. A road (N104) is
// bored through a mountain, never a hill - a town meeting a worn-down range grows on over it; and every
// road tunnel bored is one floor from portal to portal no steeper than its grade, its full height clear
// over the road, no void opened under what stands over it; no core or base tunnel (N129/N130) cuts
// across it. (pixel-world, det=1: the world's towns growing on their own)
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world, layout } = pwApp;
const eng = world.capitalGrowth, RT = PW.roadTunnels, M = PW.M;
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const secs = (s) => { for (let k = 0; k < s; k += 1) pwApp.stepWorld(60); };
const id = (x, y) => PW.get(world, x, y) & 63;
const open = (x, y) => PW.mat.phase[id(x, y)] <= PW.PHASE.GAS;
world.buildSpeed = 8;

// 1. A town at a small steep hill's foot - a high mountain's foothill (the screenshot's kind: steep
// flanks, little height) or one of N133's worn ranges - grows on over it; no road bored through it.
const foothills = [];
for (const m of layout.mountains || []) for (const p of m.peaks || []) if (p.kind === 'hill') foothills.push({ x: p.x, half: Math.max(p.left, p.right), height: p.height, outer: Math.sign(p.x - m.x) || 1 });
const hill = foothills.sort((a, b) => b.height - a.height)[0] || (layout.hills || []).slice().sort((a, b) => b.height - a.height)[0];
// (the screenshot's case: a military base seeded on the hill - read as a mountain base, it bored its
// road through the hill under itself at half its levels)
let hillTown = null;
if (hill) {
  for (let k = 0; k < 10 && !hillTown; k += 1) {
    const x = Math.round(hill.x + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 40);
    const r = eng.drop(x, 'military', 'modern', 'left');
    if (r && r.city) hillTown = r.city;
  }
}
if (hillTown) {
  for (let k = 0; k < 6; k += 1) { for (let s = 0; s < 40 && !(world.buildings[hillTown.main.owner - 1] && !world.buildings[hillTown.main.owner - 1].underConstruction); s += 1) secs(1); eng.upgrade(hillTown); }
  info(`the base on the hill: setting ${hillTown.setting}, level ${hillTown.level}`);
  secs(120);
  const bored = (world.roadTunnels || []).filter((t) => t.a < hill.x + hill.half && t.b > hill.x - hill.half);
  const over = hillTown.edge.left < hill.x && hillTown.edge.right > hill.x;
  check(!bored.length, `a town at a hill's foot bores no road through the hill (hill ${Math.round(hill.x)}, ${Math.round(hill.height)} high; ${bored.length} road tunnels through it; the town ${Math.round(hillTown.edge.left)}..${Math.round(hillTown.edge.right)}, blocked ${JSON.stringify(hillTown.blocked)})`);
  info(`it grows over the hill: ${over ? 'yes' : 'not yet'}`);
  await view('n144-town-over-the-hill', hill.x, world.groundTop[Math.round(hill.x)] - 80, 2);
} else info('no town took at a hill\'s foot');

// 2. Every road tunnel the world's towns bore in some minutes of growth is a whole bore through a mountain.
secs(120);
const tunnels = world.roadTunnels || [];
info(`road tunnels: ${tunnels.map((t) => `#${t.id} ${t.side} ${t.a}..${t.b}${t.done ? '' : ' (boring)'}`).join(', ') || 'none'}`);
const bad = [];
for (const t of tunnels) {
  if (!t.done) continue;
  let deepest = -Infinity;
  for (let x = t.a; x <= t.b; x += 4) deepest = Math.max(deepest, t.floorAt(x) - RT.CLEAR - world.groundTop[x]);
  if (deepest < 60) bad.push({ t, x: (t.a + t.b) / 2, y: t.floorAt((t.a + t.b) >> 1), why: `bored through a hill (at most ${deepest} rows of rock over its crown)` });
  let worstStep = 0, voidAt = null;
  for (let x = t.a + 4; x <= t.b - 4; x += 4) {
    const f = t.floorAt(x);
    worstStep = Math.max(worstStep, Math.abs(f - t.floorAt(x - 4)));
    let clear = 0; for (let y = f - 1; y > f - RT.CLEAR - 40 && open(x, y); y -= 1) clear += 1;
    if (clear >= RT.CLEAR + 25 && world.groundTop[x] < f - RT.CLEAR - 40 && !voidAt) voidAt = { x, y: f - RT.CLEAR };
  }
  if (worstStep > Math.ceil(4 * RT.GRADE) + 1) bad.push({ t, x: t.a, y: t.ya, why: `its road climbs ${worstStep} rows in 4 columns` });
  if (voidAt) bad.push({ t, x: voidAt.x, y: voidAt.y, why: 'a void opened past the bore\'s height under what stands over it' });
}
check(!bad.length, `every road tunnel is a whole bore through a mountain (${bad.map((b) => `#${b.t.id}: ${b.why}`).join('; ') || `${tunnels.filter((t) => t.done).length} through, all whole`})`);
for (const b of bad.slice(0, 2)) await view(`n144-broken-${b.t.id}`, b.x, b.y - 60, 3);
// Core and base tunnels keep off the road tunnels.
const T = PW.tunnels.state(world);
const coreNets = new Set(eng.cities.filter((c) => c.shaft).map((c) => c.shaft.net));
let crossings = 0;
for (const seg of T.segments) {
  if (!coreNets.has(seg.net) || seg.kind === 'drift' || seg.kind === 'incline') continue;
  for (const t of tunnels) if (seg.x1 >= t.a && seg.x0 <= t.b) {
    for (let x = Math.max(seg.x0, t.a); x <= Math.min(seg.x1, t.b); x += 6) {
      const f = t.floorAt(x);
      if (seg.y1 >= f - RT.CLEAR && seg.y0 <= f) { crossings += 1; break; }
    }
  }
}
check(crossings === 0, `no core or base shaft cuts across a road tunnel's bore (${crossings})`);
if (tunnels[0]) await view('n144-road-tunnel', (tunnels[0].a + tunnels[0].b) / 2, tunnels[0].floorAt((tunnels[0].a + tunnels[0].b) >> 1) - 60, 2);
return { checks, shots };
