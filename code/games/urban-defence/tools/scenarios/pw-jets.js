// Drones (N106, N126; run with --page=pixel-world.html --params=det=1&seed=N): the Avenger drawn at
// a third of its real size against the trooper, in each side's paint, its wings folding; launched
// off a missile launcher on a booster, its wings springing open, the booster dropping away; roaming,
// never landing, turning about at the world's end; by hand - no guns: a left click sends it into a
// building, which its warhead breaks into; shot down by a Patriot - burning, it falls and blows up.
// Over courses laid in the wilds, cleared to the sky; only the units and their rounds are stepped,
// but where the world must be (the strike, the fall).
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
const load = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`${src} did not load`)); document.head.appendChild(s); });
if (!PW.troops) await load('scripts/pw/pw-troops.js');
if (!PW.jets) await load('scripts/pw/pw-jets.js');
if (!PW.defence) await load('scripts/pw/pw-defence.js');
pwApp.setPaused(true);
const J = PW.jets, T = PW.tanks, D = PW.defence, DT = 1 / 60, deg = Math.PI / 180;
const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); } };
const used = [];
function site(len, sky = 900) {
  for (const zone of layout.wilds) for (let x = zone.x0 + 60; x + len < zone.x1 - 60; x += 40) {
    if (used.some(([a, b]) => x < b + 60 && x + len > a - 60)) continue;
    if ((world.buildings || []).some((b) => b.body && x < b.body.right + 60 && x + len > b.body.left - 60)) continue;
    const tops = Array.from({ length: len + 1 }, (_, d) => world.groundTop[x + d]);
    const g = Math.min(...tops);
    if (Math.max(...tops) - g > 80 || g - sky < 20) continue;
    used.push([x, x + len]);
    fill(x, Math.max(1, g - sky), x + len, g - 1, M.AIR);
    for (let xx = x; xx <= x + len; xx += 1) for (let y = g; y <= tops[xx - x] + 3 || y <= g + 30; y += 1) PW.set(world, xx, y, M.STONE, { quiet: true });
    return { x0: x, g };
  }
  return null;
}
// (units and rounds: the tanks' step steps the troopers, the drones, the artillery and the rounds too)
const run = (secs, each) => { for (let k = 0; k < Math.round(secs / DT); k += 1) { T.step(world, DT); if (each) each(k); } };
const fresh = () => { world.jets = []; world.tanks = []; world.troops = []; world.defence = []; };
// (an art's cells: the box they take up, by row)
function measure(a) {
  let n = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, r = 0, g = 0, b = 0;
  for (let y = 0; y < a.h; y += 1) for (let x = 0; x < a.w; x += 1) {
    const c = a.px[y * a.w + x];
    if (!c) continue;
    n += 1; x0 = Math.min(x0, x + a.x0); x1 = Math.max(x1, x + a.x0); y0 = Math.min(y0, y + a.y0); y1 = Math.max(y1, y + a.y0);
    r += c & 255; g += c >>> 8 & 255; b += c >>> 16 & 255;
  }
  return { n, x0, x1, y0, y1, rgb: [r / n, g / n, b / n] };
}

// 1. Its size and look (the user's: a third of its real size against the men - 13.4 m, 62 cells;
// its wings 20 m across): side on, nose to tail (its probe aside), its height belly to fin tip; the
// three sides' paints told apart; its wings folded along it, then open - the near one showing
// under its belly, the far one over its back.
{
  const open = measure(J.artOf('modern', 1, 0, false)), folded = measure(J.artOf('modern', 0, 0, false));
  // (its body: the row through its middle, nose to tail)
  const A = J.artOf('modern', 1, 0, false);
  let bx0 = Infinity, bx1 = -Infinity;
  for (let x = 0; x < A.w; x += 1) if (A.px[(0 - A.y0) * A.w + x] && x + A.x0 <= 31) { bx0 = Math.min(bx0, x + A.x0); bx1 = Math.max(bx1, x + A.x0); }
  const long = bx1 - bx0 + 1;
  // (its height side on: from the belly under its middle to the top of its fins, its wings aside)
  let fy = Infinity;
  for (let y = A.y0; y <= A.y1; y += 1) for (let x = -30; x <= -18; x += 1) if (x >= A.x0 && x <= A.x1 && A.px[(y - A.y0) * A.w + (x - A.x0)]) fy = Math.min(fy, y);
  const tall = 3 - fy + 1, man = PW.troops.HEIGHT || 25;
  const paints = ['modern', 'asian', 'gothic'].map((s) => measure(J.artOf(s, 1, 0, false)).rgb);
  const apart = Math.min(...[[0, 1], [0, 2], [1, 2]].map(([p, q]) => Math.hypot(...paints[p].map((c, k) => c - paints[q][k]))));
  check(Math.abs(long - J.LENGTH) <= 2 && tall >= 12 && tall <= 18 && open.y1 - folded.y1 >= 4 && folded.y0 - open.y0 >= 4 && apart > 12,
    `the drone is drawn at a third of the Avenger's size against the men: ${long} cells nose to tail (13.4 m: ${J.LENGTH}), ${tall} from its belly to the top of its fins - ${(long / man).toFixed(1)} times a trooper's height; its wings open show under it and over it (${open.y1 - folded.y1} and ${folded.y0 - open.y0} cells past it folded); the three sides' paints ${apart.toFixed(0)} apart`);
}

// 2. Off a launcher (N126): told to launch, the launcher's pod turns and rises to 45-85 degrees,
// the drone fired off it on its booster - coming out of the tube, its wings opening as it leaves -
// the booster burning out and dropping away as a piece of wreck; then it climbs away to its height.
{
  const S = site(1600);
  if (!S) check(false, 'a stretch of the wilds for the launch');
  else {
    const { x0, g } = S;
    fresh();
    const u = D.create(world, { type: 'launcher', x: x0 + 300, y: g - 1, side: 'left', facing: 1, style: 'modern' });
    const b0 = J.stats.boosters, frags0 = world.fragments ? world.fragments.list.length : 0;
    const j = J.launchFrom(world, u, {});
    let leftAt = -1, angle = null, openAt = -1, droppedAt = -1, k = 0, low = Infinity, frags = 0;
    for (; k < 60 * 12; k += 1) {
      run(DT);
      if (leftAt < 0 && j && !j.pod) { leftAt = k; angle = j.pitch / deg; }
      if (leftAt >= 0 && openAt < 0 && j.wing >= 1) openAt = k;
      if (leftAt >= 0 && droppedAt < 0 && !j.booster) { droppedAt = k; frags = world.fragments ? world.fragments.list.length - frags0 : 0; }
      if (k === leftAt + 12) await view('drone-launch', u.x + 40, u.y - 60, 6);
      if (k === leftAt + 50) await view('drone-booster', j.x, j.y, 5);
      if (droppedAt >= 0 && k > droppedAt + 30) low = Math.min(low, world.groundTop[Math.max(0, Math.min(world.width - 1, Math.round(j.x)))] - j.y);
    }
    await view('drone-climbing', j.x, j.y + 60, 4);
    check(!!j && leftAt >= 0 && leftAt < 60 * 3 && angle >= 44.5 && angle <= 85.5 && openAt >= 0 && openAt - leftAt <= 40 && droppedAt >= 0 && Math.abs((droppedAt - leftAt) / 60 - J.BOOST) < 0.1
      && J.stats.boosters - b0 === 1 && frags >= 1 && !j.dead && world.groundTop[Math.round(j.x)] - j.y > J.ALT * 0.6,
      `off a launcher: its pod laid, the drone is fired off it in ${leftAt >= 0 ? (leftAt / 60).toFixed(1) : '-'} s at ${angle !== null ? angle.toFixed(0) : '-'} degrees (45-85), its wings open ${openAt >= 0 ? ((openAt - leftAt) / 60).toFixed(2) : '-'} s out of the tube; its booster burns ${droppedAt >= 0 ? ((droppedAt - leftAt) / 60).toFixed(1) : '-'} s and drops away (${frags} piece falling); 12 s on it flies ${(world.groundTop[Math.round(j.x)] - j.y).toFixed(0)} cells over the ground (at least ${low === Infinity ? '-' : low.toFixed(0)} since)`);
    fresh();
  }
}

// 3. It never lands: let go over the wilds near the world's end, heading for it, it turns about
// short of it and roams on, a minute, always well over the ground and whatever stands on it.
{
  fresh();
  // (let go 300 cells over the highest of what stands round it - a town's towers too)
  const W = world.width, x = W - 1400;
  let top = world.groundTop[x];
  for (let d = -400; d <= 1200; d += 10) top = Math.min(top, world.groundTop[x + d]);
  for (const b of world.buildings || []) if (b.body && b.body.right > x - 400 && b.body.left < x + 1200) top = Math.min(top, b.body.top);
  const y = top - 300;
  const j = J.create(world, { x, y, facing: 1, style: 'asian', side: 'right' });
  let turned = false, low = Infinity, far = 0, lost = '';
  const s0 = { ...J.stats };
  run(60, () => {
    if (j.dead) { if (!lost) lost = `lost at ${j.x.toFixed(0)},${j.y.toFixed(0)} (the ground there ${world.groundTop[Math.max(0, Math.min(W - 1, Math.round(j.x)))]}; struck ${J.stats.struck - s0.struck}, down ${J.stats.shotDown - s0.shotDown}, by ${j.hurtBy || '-'})`; return; }
    if (j.facing < 0) turned = true;
    far = Math.max(far, j.x);
    const gx = Math.max(0, Math.min(W - 1, Math.round(j.x)));
    low = Math.min(low, world.groundTop[gx] - j.y);
  });
  check(!j.dead && turned && far < W - 100 && low > 100,
    `it never lands: heading for the world's end it turns about ${(W - far).toFixed(0)} cells short of it and roams on a minute, never nearer the ground than ${low.toFixed(0)} cells (${lost || 'flying'})`);
  fresh();
}

// 4. By hand (N102, N126 - the user's: no guns, sent into buildings): Space held climbs it, let go it
// levels out; a right click has it circle over the spot; a left click on a building sends it in -
// it turns to it, dives, its nose glowing, and its warhead breaks into the building where it strikes.
// No round is fired off it.
{
  fresh();
  const b = (world.buildings || []).filter((q) => q.body && (q.health === undefined || q.health >= 1) && !q.ruined && q.ground - q.body.top > 120)
    .sort((p, q) => (q.ground - q.body.top) - (p.ground - p.body.top))[0];
  if (!b) check(false, 'a standing building to send a drone into');
  else {
    const bx = Math.round((b.body.left + b.body.right) / 2), by = Math.round(b.ground - (b.ground - b.body.top) * 0.6);
    const own = () => { let n = 0; for (let y = b.body.top; y <= b.ground; y += 1) for (let x = b.body.left; x <= b.body.right; x += 1) if (PW.getOwner(world, x, y) === b.id && !PW.mat.open[PW.get(world, x, y) & 63]) n += 1; return n; };
    const j = J.create(world, { x: bx - 1100, y: b.body.top - 260, facing: 1, style: 'modern', side: 'left' });
    J.hold(j);
    J.key({ code: 'Space', type: 'keydown' });
    run(1.2);
    const up = j.pitch;
    J.key({ code: 'Space', type: 'keyup' });
    run(2);
    const level = Math.abs(j.pitch) < 0.06;
    J.click(world, bx - 500, by, 2);
    const circling = !!j.loiter && !j.strike;
    const fired = [], fireWas = PW.shots.fire;
    PW.shots.fire = function (w, spec) { if (spec.from === j) fired.push(spec); return fireWas.call(this, w, spec); };
    const cells0 = own(), struck0 = J.stats.struck;
    J.click(world, bx, by, 0);
    const sent = !!j.strike;
    let glowSeen = false, k = 0;
    for (; k < 60 * 15 && !j.dead; k += 1) {
      pwApp.stepWorld(1);
      if (j.strike && j.glow > 0) glowSeen = true;
      if (k === 60) await view('drone-diving', j.x, j.y, 5);
    }
    PW.shots.fire = fireWas;
    pwApp.stepWorld(60 * 2);
    await view('drone-struck', bx, by, 4);
    const broken = cells0 - own();
    J.hold(null);
    // (what it breaks: 120-360 cells over the seeds' towers - a glazed storey gives less than a frame)
    check(up > 0.4 && level && circling && sent && glowSeen && j.dead && J.stats.struck - struck0 === 1 && broken > 100 && fired.length === 0,
      `by hand: Space held climbs it (its nose ${(up / deg).toFixed(0)} up), let go it levels out (${level}); a right click has it circle over the spot (${circling}); a left click on a tower sends it in (${sent}) - it dives, its nose glowing (${glowSeen}), and strikes in ${(k / 60).toFixed(1)} s, its warhead breaking ${broken} of the tower's cells; no round fired off it (${fired.length})`);
  }
  fresh();
}

// 5. Shot down: over an enemy Patriot battery it is brought down - burning, it falls and blows up
// where it hits, what is left of it lying there.
{
  const S = site(1600);
  if (!S) check(false, 'a stretch of the wilds for the battery');
  else {
    const { x0, g } = S;
    fresh();
    D.create(world, { type: 'patriot', x: x0 + 900, y: g - 1, side: 'right', facing: -1, style: 'gothic' });
    // (coming at it from 2200 cells off, 500 over the highest ground on its way - a Patriot's missile
    // turns too wide to take one passing close over it)
    let top = g;
    for (let x = x0 + 900 - 2200; x <= x0 + 900; x += 10) top = Math.min(top, world.groundTop[Math.max(0, x)]);
    const j = J.create(world, { x: x0 + 900 - 2200, y: top - 500, facing: 1, style: 'modern', side: 'left' });
    let downAt = -1, k = 0, crashed0 = J.stats.crashed, near = Infinity, fired = 0;
    // (what is thrown down of it: the pieces new to the world about it from when it is brought down -
    // not the count of all the world's pieces, which others settling elsewhere take from)
    const before = new Set(world.fragments ? world.fragments.list : []), wreck = new Set(), seen = new Set();
    const pieces = () => { if (world.fragments) for (const p of world.fragments.list) if (!before.has(p) && Math.hypot(p.px - j.x, p.py - j.y) < 600) wreck.add(p); };
    for (; k < 60 * 20 && !j.dead; k += 1) {
      pwApp.stepWorld(1);
      if (j.down && downAt < 0) downAt = k;
      if (j.down) pieces();
      // (the battery's missiles: how near they came to it)
      for (const s of world.shots || []) if (s.kind === 'patriot' && !s.done) { if (!seen.has(s)) { seen.add(s); fired += 1; } near = Math.min(near, Math.hypot(s.x - j.x, s.y - j.y)); }
    }
    for (let q = 0; q < 30; q += 1) { pwApp.stepWorld(1); pieces(); }
    await view('drone-down', j.x, g - 40, 4);
    const frags = wreck.size;
    check(downAt >= 0 && j.dead && J.stats.crashed - crashed0 === 1 && frags > 0,
      `a Patriot brings one down (${downAt >= 0 ? `at ${(downAt / 60).toFixed(1)} s, by ${j.hurtBy}` : `not down - ${fired} missiles at it, the nearest ${near.toFixed(0)} cells off, it at ${j.x.toFixed(0)},${j.y.toFixed(0)} by ${(x0 + 900 - j.x).toFixed(0)} off it, struck ${J.stats.struck}`}); burning, it falls and blows up where it hits (${j.dead ? `${((k - Math.max(0, downAt)) / 60).toFixed(1)} s later` : 'still flying'}), what is left of it thrown down (${frags} pieces)`);
    fresh();
  }
}

// 6. What they cost: four drones flying, a tick, and drawing them (their drawings made once, first).
{
  fresh();
  const x = layout.wilds[0].x0 + 400, y = world.groundTop[x] - 500;
  for (let k = 0; k < 4; k += 1) J.create(world, { x: x + k * 150, y: y - k * 40, facing: k & 1 ? 1 : -1, style: ['modern', 'asian', 'gothic'][k % 3] });
  const best = (n, m, work) => { let min = Infinity; for (let b = 0; b < n; b += 1) { const t0 = performance.now(); for (let q = 0; q < m; q += 1) work(); min = Math.min(min, (performance.now() - t0) / m); } return min; };
  const r = { ctx: document.createElement('canvas').getContext('2d'), world, camera: { x: x - 100, y: y - 250, zoom: 2 }, view: { width: 1600, height: 900 } };
  J.draw(r);
  const drawMs = best(5, 8, () => J.draw(r));
  const ms = best(5, 30, () => J.step(world, DT));
  check(ms < 0.3 && drawMs < 4, `four drones cost little: ${ms.toFixed(3)} ms a tick, ${drawMs.toFixed(2)} ms to draw at 2x`);
  fresh();
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
