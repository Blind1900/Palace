// N129 (the user's, 2026-11-24) - a city's tunnel grows from the bottom of its core: a shaft
// straight down, then out sideways to the ore; a seed digs nothing until its city is level 3.
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

// A capital seed on open ground in the left end's open country.
let city = null;
for (let k = 0; k < 20 && !city; k += 1) {
  const x = Math.round(layout.sites[0].x1 + 900 + k * 160);
  const r = eng.drop(x, 'capital', 'modern', 'left');
  if (r && r.ok !== false && (r.city || r.id)) city = r.city || r;
}
check(!!city, `a capital seed takes (${city ? `at ${city.x}` : 'none'})`);
if (!city) return { checks };
for (let s = 0; s < 120 && !(world.buildings[city.main.owner - 1] && !world.buildings[city.main.owner - 1].underConstruction); s += 1) secs(1);
secs(20);
check(!city.shaft, `below level 3 its city digs no tunnel (level ${city.level})`);
// Up to level 3 (by hand, as a match's side would buy it) and grown whole again.
while (city.level < 3) eng._levelUp(city);
for (let s = 0; s < 180 && !(world.buildings[city.main.owner - 1] && !world.buildings[city.main.owner - 1].underConstruction); s += 1) secs(1);
for (let s = 0; s < 240 && !(city.shaft && city.shaft.done); s += 1) secs(1);
const sh = city.shaft;
const rec = world.buildings[city.main.owner - 1];
const core = rec && rec.cores && (rec.cores.find((k) => k.vault) || rec.cores[0]);
const cx = core && Math.round(core.vault ? (core.vault.x0 + core.vault.x1) / 2 : core.x);
check(!!sh && sh.done && !sh.why && Math.abs(sh.x - cx) <= 1, `at level 3 a shaft is sunk from under its core's middle (${sh ? `x ${sh.x}, core ${cx}, ${sh.top}..${sh.bottom}${sh.why ? `, ${sh.why}` : ''}` : 'none'})`);
if (sh) {
  // straight down: every row of it open, one column wide band under the core
  let open = 0, rows = 0;
  for (let y = sh.top + 2; y < sh.bottom - 2; y += 4) { rows += 1; if (PW.mat.open[PW.get(world, sh.x, y) & 63]) open += 1; }
  check(rows > 10 && open === rows, `it runs straight down (${open}/${rows} rows open on its line, ${sh.bottom - sh.top} deep)`);
  await view('n129-shaft', sh.x, (sh.top + sh.bottom) / 2, 3);
  // then out sideways to the ore: a trip from its foot reaches a body and opens a mine there
  const trip = sh.trip;
  for (let s = 0; s < 300 && trip && !trip.over; s += 1) secs(1);
  const opened = trip && (trip.prospects || []).map((p) => p.opened).find(Boolean);
  check(!!trip && !!opened, `from its foot a miner drives out sideways and opens a mine on the ore (${trip ? `${(trip.prospects || []).map((p) => `${p.steps} steps${p.opened ? ' -> mine' : ''}`).join(', ') || 'still digging'}` : 'no trip'})`);
  if (opened) await view('n129-to-the-ore', (opened.room.x0 + opened.room.x1) / 2, opened.floor - 30, 4);
  else if (trip) info(`the trip: ${JSON.stringify((trip.prospect || {}).steps)} steps under way`);
}
return { checks, shots };
