// N123 (the user's, 2026-11-23) - vision and camera, on the game page (mode=game&start=versus&
// side=left&det=1&towns=1): ground never seen is black; ground seen but out of sight now is grey and
// shows what it was when last seen, updated when it is seen again; sight is circles from the tops of
// antennas and units - troopers < tanks < mechs < drones, a military antenna between a mech's and a
// drone's - cut off only by mountains; the camera keeps the selected unit centred.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world } = pwApp;
const m = pwApp.match(), G = PW.game, V = PW.vision;
const wc = document.getElementById('world-canvas'), wctx = wc.getContext('2d');
const frames = async (n = 4) => { for (let k = 0; k < n; k += 1) await sleep(60); };
// (the canvas's own pixels round world point (x, y): mean rgb and how grey it is)
const px = (x, y, r = 4) => {
  const p = pwApp.toClient(x, y), rect = wc.getBoundingClientRect();
  const sx = Math.round((p.x - rect.left) * wc.width / rect.width), sy = Math.round((p.y - rect.top) * wc.height / rect.height);
  const d = wctx.getImageData(sx - r, sy - r, 2 * r + 1, 2 * r + 1).data;
  let R = 0, Gr = 0, B = 0, chroma = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; Gr += d[i + 1]; B += d[i + 2]; chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); n += 1; }
  return { r: R / n, g: Gr / n, b: B / n, chroma: chroma / n, lum: (R + Gr + B) / (3 * n) };
};

// 1. The sight radii, in the user's order.
const R = V.RANGE;
check(R.troop < R.tank && R.tank < R.mech && R.mech < R.military && R.military < R.jet,
  `sight grows troop ${R.troop} < tank ${R.tank} < mech ${R.mech} < military antenna ${R.military} < drone ${R.jet}`);

// 2. Cut off only by mountains: an eye at a mountain's foot sees up its near flank but not the
// ground beyond the ridge, though that is within its reach; open country is seen to the edge.
const L = world.layout;
const mt = (L.mountains || []).filter((q) => q.height > 400).sort((a, b) => b.height - a.height)[0];
if (mt) {
  // (an eye up in the air at the foot - a drone's, over the foothills' bumps)
  const foot = Math.round(mt.x - mt.half - 60), eyeY = world.groundTop[foot] - 300;
  const beyond = Math.round(mt.x + mt.half * 0.6), reachR = Math.abs(beyond - foot) + 200;
  const see = V.sightOf(world, foot, eyeY, reachR);
  const flank = Math.round(mt.x - mt.half * 0.5);
  check(see(flank, world.groundTop[flank] - 20) && !see(beyond, world.groundTop[beyond] - 20),
    `a mountain hides the ground beyond its ridge (eye at ${foot}: its near flank seen, ${beyond} behind the peak not, though within ${reachR})`);
  const open = Math.round(foot - 300);
  check(see(open, world.groundTop[open] - 10), 'open country before it is seen');
} else info('no mountain on this map to hide behind');

// 3. The fog on screen: black where the side has never seen, the world where it sees.
V.refresh(world, 'left');
const home = G.frontOf(m, 'left', true);
const far = Math.round(world.width * 0.82);
check(V.sees(world, 'left', home) && !V.seenAt(world, 'left', far, world.groundTop[far] - 20), `the side sees its own ground (${home}) and has never seen the far end (${far})`);
pwApp.focus(far, world.groundTop[far] - 80, 2);
await frames(6);
const dark = px(far, world.groundTop[far] - 30);
check(dark.lum < 3, `ground never seen is black (mean ${dark.lum.toFixed(1)})`);
shots.push(await shot('n123-never-seen'));
pwApp.focus(home, world.groundTop[home] - 120, 2);
await frames(6);
const lit = px(home, world.groundTop[home] + 20, 6);
check(lit.lum > 20, `ground in sight is drawn as it is (mean ${lit.lum.toFixed(1)}, chroma ${lit.chroma.toFixed(1)})`);
shots.push(await shot('n123-in-sight'));

// 4. Seen, then out of sight: grey, and it keeps the picture it had when last seen - a change made
// out of sight shows only when the side sees that ground again.
const gx = Math.round(world.width * 0.6), gy = world.groundTop[gx];
world.visionExtra = (world.visionExtra || []).concat([{ side: 'left', x0: gx - 400, x1: gx + 400, test: 'n123' }]);
V.refresh(world, 'left');
pwApp.focus(gx, gy - 60, 3);
await frames(8);
const before = px(gx, gy + 12, 5);
world.visionExtra = world.visionExtra.filter((g) => g.test !== 'n123');
V.refresh(world, 'left');
await frames(6);
const grey = px(gx, gy + 12, 5);
check(V.seenAt(world, 'left', gx, gy) && !V.sees(world, 'left', gx), 'the ground is seen once, then out of sight');
check(grey.chroma < before.chroma * 0.5 + 1 && grey.lum < before.lum && grey.lum > 3, `out of sight it is grey (chroma ${before.chroma.toFixed(1)} -> ${grey.chroma.toFixed(1)}, light ${before.lum.toFixed(1)} -> ${grey.lum.toFixed(1)})`);
shots.push(await shot('n123-seen-grey'));
// (a block of bright stone laid out of sight - not shown yet)
for (let y = gy - 40; y < gy - 10; y += 1) for (let x = gx - 15; x < gx + 15; x += 1) PW.set(world, x, y, PW.M.CONCRETE);
await frames(6);
const held = px(gx, gy - 25, 5);
check(Math.abs(held.lum - px(gx - 60, gy - 25, 5).lum) < 25, `a change out of sight does not show (light there ${held.lum.toFixed(1)})`);
world.visionExtra = world.visionExtra.concat([{ side: 'left', x0: gx - 400, x1: gx + 400, test: 'n123' }]);
V.refresh(world, 'left');
await frames(10);
const back = px(gx, gy - 25, 5);
check(back.lum > held.lum + 20, `seen again, the ground shows as it is now (light ${held.lum.toFixed(1)} -> ${back.lum.toFixed(1)})`);
shots.push(await shot('n123-seen-again'));
world.visionExtra = world.visionExtra.filter((g) => g.test !== 'n123');
for (let y = gy - 40; y < gy - 10; y += 1) for (let x = gx - 15; x < gx + 15; x += 1) PW.set(world, x, y, PW.M.AIR);
V.refresh(world, 'left');

// 5. The other side's units only where the side sees them.
world.stock.right.hm = 4000; world.stock.right.sm = 600;
const d = G.deploy(m, 'right', 'trooper');
if (d.ok) {
  check(!V.sees(world, 'left', d.unit.x, d.unit.y - 12), `an enemy trooper deployed at ${Math.round(d.unit.x)} is out of the left side's sight`);
} else info(`no enemy trooper to hide (${d.note})`);

// 6. The camera keeps the selected unit centred.
world.stock.left.hm = 4000; world.stock.left.sm = 600;
const mine = G.deploy(m, 'left', 'trooper');
if (mine.ok) {
  const u = mine.unit, canvas = wc;
  pwApp.stepWorld(60);
  pwApp.focus(u.x, u.y - 30, 4);
  await sleep(150);
  const p = pwApp.toClient(u.x, u.y - 12);
  for (const type of ['pointermove', 'pointerdown', 'pointerup']) canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, button: 0, buttons: type === 'pointerdown' ? 1 : 0 }));
  // (it walks off with its key held; the view should stay on it)
  const code = m.sides.left.dir > 0 ? 'KeyD' : 'KeyA';
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), bubbles: true }));
  for (let k = 0; k < 40; k += 1) { pwApp.stepWorld(6); await sleep(16); }
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code.slice(3).toLowerCase(), bubbles: true }));
  for (let k = 0; k < 20; k += 1) await sleep(30);
  const at = pwApp.toClient(mine.unit.x, mine.unit.y - 20), rect = wc.getBoundingClientRect();
  const off = Math.hypot(at.x - (rect.left + rect.width / 2), at.y - (rect.top + rect.height / 2));
  check(off < 40, `the selected trooper is kept in the middle of the view (${Math.round(off)} px from it)`);
  shots.push(await shot('n123-centred'));
} else info(`no trooper of ours to follow (${mine.note})`);
return { checks, shots };
