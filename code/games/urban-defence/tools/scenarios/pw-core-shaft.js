// N129 (the user's, 2026-11-24) - a city's tunnel grows from the centre bottom of its core: first
// straight down, then it branches sideways to reach the ore, a mine opening where a branch gets there;
// a seed digs nothing until its city is level 3. A military base on a mountain digs its own from its
// first level, slowly, and its tunnel goes on growing.
// (pixel-world, det=1; the city's growth, crews and workings' clock run eight times as fast)
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world, layout } = pwApp;
const eng = world.capitalGrowth, T = PW.tunnels;
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
world.buildSpeed = 8;
if (world.stock && world.stock.left) { world.stock.left.hm = 1e6; world.stock.left.sm = 1e5; }
const secs = (s) => { for (let k = 0; k < s; k += 1) pwApp.stepWorld(60); };
const built = (c) => { const r = world.buildings[c.main.owner - 1]; return r && !r.underConstruction; };
const open = (x, y) => PW.mat.open[PW.get(world, x, y) & 63];

// A capital seed on open ground in the left end's open country.
let city = null;
for (let k = 0; k < 20 && !city; k += 1) {
  const x = Math.round(layout.sites[0].x1 + 900 + k * 160);
  const r = eng.drop(x, 'capital', 'modern', 'left');
  if (r && r.ok !== false && (r.city || r.id)) city = r.city || r;
}
check(!!city, `a capital seed takes (${city ? `at ${city.x}` : 'none'})`);
if (!city) return { checks };
for (let s = 0; s < 120 && !built(city); s += 1) secs(1);
secs(20);
check(!city.shaft, `below level 3 its city digs no tunnel (level ${city.level})`);
// Up to level 3 (by hand, as a match's side would buy it) and grown whole again.
while (city.level < 3) eng._levelUp(city);
for (let s = 0; s < 180 && !built(city); s += 1) secs(1);
for (let s = 0; s < 480 && !(city.shaft && city.shaft.sunk); s += 1) secs(1);
const sh = city.shaft;
const rec = world.buildings[city.main.owner - 1];
const core = rec && rec.cores && (rec.cores.find((k) => k.vault) || rec.cores[0]);
const cx = core && Math.round(core.vault ? (core.vault.x0 + core.vault.x1) / 2 : core.x);
// 1. From the centre bottom of the core: its middle, right under the casing - no ground between.
const under = sh ? PW.getOwner(world, sh.x, sh.top - 1) === city.main.owner : false;
check(!!sh && sh.sunk && !sh.why && Math.abs(sh.x - cx) <= 1 && under && open(sh.x, sh.top + 1),
  `at level 3 a shaft grows from the centre bottom of its core (${sh ? `x ${sh.x}, core ${cx}, top ${sh.top} ${under ? 'right under the casing' : `with ${PW.mat.names[PW.get(world, sh.x, sh.top - 1) & 63]} over it`}${sh.why ? `, ${sh.why}` : ''}` : 'none'})`);
if (sh) {
  // 2. First straight down: every row of it open on its line.
  let rows = 0, gaps = 0;
  for (let y = sh.top + 1; y < sh.bottom - 2; y += 3) { rows += 1; if (!open(sh.x, y)) gaps += 1; }
  check(rows > 40 && gaps === 0, `first it runs straight down (${rows - gaps}/${rows} rows open on its line, ${sh.bottom - sh.top} deep)`);
  await view('n129-shaft', sh.x, (sh.top + sh.bottom) / 2, 3);
  // 3. Then sideways, a branch to each body of ore in reach; where one gets there a mine opens.
  for (let s = 0; s < 600 && !(sh.branches.some((b) => b.opened) && sh.branches.filter((b) => Math.abs(b.x - b.from.x) > 60).length >= 2); s += 1) secs(1);
  check(sh.branches.length > 0 && sh.branches.every((b) => b.born >= sh.sunkAt), `no branch leaves it until it is down (${sh.branches.map((b) => `${(b.born - sh.sunkAt).toFixed(1)} s after`).join(', ')})`);
  const out = sh.branches.map((b) => Math.abs(b.x - b.from.x));
  info(`ore round the shaft: ${(layout.nodes || []).filter((n) => Math.abs(n.x - sh.x) < 1800).map((n) => `${n.x - sh.x}/${n.y - sh.bottom}${n.found ? ' found' : ''}${(n.amount || 0) < 40 ? ' small' : ''}${n.y < world.groundTop[n.x] + 220 ? ' shallow' : ''}`).join(', ')}`);
  check(sh.branches.length >= 2 && out.filter((d) => d > 60).length >= 2,
    `then it branches out sideways (${sh.branches.map((b) => `${b.dir > 0 ? 'right' : 'left'} ${Math.abs(b.x - b.from.x)} cells${b.end ? ` (${b.end})` : ''}`).join(', ') || 'no branches'})`);
  const mine = sh.branches.find((b) => b.opened);
  check(!!mine, `a branch reaches the ore and a mine opens there (${mine ? `at ${Math.round((mine.opened.room.x0 + mine.opened.room.x1) / 2)}, floor ${mine.opened.floor}` : 'none yet'})`);
  if (mine) await view('n129-branch-to-ore', (mine.from.x + mine.x) / 2, mine.y - 20, 4);
  const far = sh.branches.reduce((m, b) => Math.max(m, Math.abs(b.x - sh.x)), 0);
  await view('n129-tunnel-whole', sh.x, (sh.top + sh.bottom) / 2, far > 500 ? 1 : 2);
}

// 4. A military base on a mountain: its own tunnel from its first level, slower, growing on.
let base = null;
const tries = [];
eng.manual = true;   // (as in a match: a base's levels are bought, so it stays at its first while we watch)
// (at the foot of a mountain the growth reads as one - just off its steep flank, on the flat)
for (const m of eng.barriers.filter((b) => b.kind === 'mountain')) {
  for (const x of [m.x0 - 60, m.x0 - 100, m.x1 + 60, m.x1 + 100]) {
    if (base || tries.length >= 30 || x < 300 || x > world.width - 300) continue;
    const r = eng.drop(Math.round(x), 'military', 'modern', 'left');
    tries.push(`${Math.round(x)}: ${r && r.city ? r.city.setting : r && r.note}`);
    if (r && r.city && r.city.setting === 'mountain') base = r.city;
  }
}
if (!base) info(`no mountain base took (${tries.slice(0, 6).join('; ')})`);
else {
  for (let s = 0; s < 150 && !built(base); s += 1) secs(1);
  for (let s = 0; s < 60 && !base.shaft; s += 1) secs(1);
  const bs = base.shaft;
  check(!!bs && bs.level < 3, `a mountain base digs its own tunnel from its first levels (begun at level ${bs ? bs.level : '-'}, ${bs ? `shaft at ${bs.x}` : 'none'})`);
  if (bs) {
    // slower: a third of a city's pace, measured on the same clock
    const t0 = T.state(world).time, y0 = bs.y;
    secs(30);
    const rate = (bs.y - y0) / Math.max(1, T.state(world).time - t0);
    const cityRate = 12 / 1.6;
    check(rate > 0 && rate < cityRate * 0.5, `it grows slowly (${rate.toFixed(2)} rows a second against a city's ${cityRate.toFixed(1)})`);
    const dug = () => bs.branches.reduce((n, b) => n + Math.abs(b.x - b.from.x), 0) + (bs.y - bs.top);
    const d0 = dug();
    for (let s = 0; s < 400 && !(dug() > d0 + 40 && bs.sunk && bs.branches.some((b) => Math.abs(b.x - b.from.x) > 60)); s += 1) secs(1);
    info(`the base's tunnel: ${bs.top}..${bs.y} of ${bs.bottom}${bs.why ? ` (${bs.why})` : ''}, branches ${bs.branches.map((b) => `${b.x - b.from.x} at ${b.y}${b.end ? ` ${b.end}` : ''}`).join(', ') || 'none'}; ore near: ${(layout.nodes || []).filter((n) => Math.abs(n.x - bs.x) < 1500).map((n) => `${n.x - bs.x}/${n.y - bs.y}${n.found ? ' found' : ''}`).join(', ')}`);
    check(dug() > d0 && bs.sunk && bs.branches.length > 0, `and goes on growing, down and then out (${d0} cells dug, then ${dug()}; ${bs.branches.length} branches)`);
    await view('n129-mountain-base-tunnel', bs.x, (bs.top + bs.y) / 2, 5);
  }
}
return { checks, shots };
