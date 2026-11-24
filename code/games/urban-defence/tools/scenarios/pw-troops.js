// Troopers against the environment (N88, N90; run with --page=pixel-world.html --params=det=1&seed=N):
// walking, stepping up and down, a wall, a ladder, a low roof crouched under, a long fall, water
// and a current, a blast and cover, burial and digging out, the rifle and a grenade, a falling slab.
// Each on a course laid on stone in the wilds, cleared above; only the troopers (and what they set
// going) are stepped, but for the slab and the grenade, where the world is.
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
const load = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`${src} did not load`)); document.head.appendChild(s); });
if (!PW.troops) await load('scripts/pw/pw-troops.js');
pwApp.setPaused(true);
const U = PW.troops, DT = 1 / 60;
const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); } };
const used = [];
function site(len) {
  for (const zone of layout.wilds) for (let x = zone.x0 + 60; x + len < zone.x1 - 60; x += 40) {
    if (used.some(([a, b]) => x < b + 60 && x + len > a - 60)) continue;
    const tops = Array.from({ length: len + 1 }, (_, d) => world.groundTop[x + d]);
    const g = Math.min(...tops);
    if (Math.max(...tops) - g > 60) continue;
    used.push([x, x + len]);
    fill(x, g - 170, x + len, g - 1, M.AIR);
    for (let xx = x; xx <= x + len; xx += 1) for (let y = g; y <= world.groundTop[xx] + 3 || y <= g + 40; y += 1) PW.set(world, xx, y, M.STONE, { quiet: true });
    return { x0: x, g };
  }
  return null;
}
const run = (secs, each) => { for (let k = 0; k < Math.round(secs / DT); k += 1) { U.step(world, DT); if (each) each(k); } };
const fresh = () => { world.troops = []; world.grenades = []; };

// 1. Walking: on flat ground to its pace, its feet on the ground every step; up a step a third of
// its height (8 cells) with room for its head; stopped by a wall (12 cells) it cannot step; down a
// 30-degree slope and off a 5-cell ledge without leaving the ground.
{
  const S = site(700);
  if (!S) check(false, 'a stretch of the wilds for the walk');
  else {
    const { x0, g } = S;
    fill(x0 + 200, g - 8, x0 + 260, g - 1, M.STONE);                // a step 8 high
    fill(x0 + 260, g - 5, x0 + 300, g - 1, M.STONE);                // ... down 3 onto a ledge 5 high, then off it
    for (let d = 0; d < 60; d += 1) fill(x0 + 380 + d, g - 35 + Math.round(d * Math.tan(30 * Math.PI / 180)), x0 + 380 + d, g - 1, M.STONE);
    fill(x0 + 340, g - 35, x0 + 380, g - 1, M.STONE);                // (the top the slope runs down from)
    fill(x0 + 330, g - 35, x0 + 339, g - 9, M.STONE);               // (a wall 27 over the ledge's foot, beyond the 12 below)
    fill(x0 + 600, g - 12, x0 + 610, g - 1, M.STONE);               // a wall 12 high
    fresh();
    const t = U.create(world, { x: x0 + 170.5, y: g - 1, side: 'left', style: 'modern' });
    U.walk(t, 1);
    let top = 0, airTicks = 0, upStep = false, offLedge = false;
    run(9, () => { top = Math.max(top, Math.abs(t.vx)); if (!t.onGround) airTicks += 1; if (t.x > x0 + 205 && t.y === g - 9) upStep = true; if (t.x > x0 + 305 && t.x < x0 + 320 && t.onGround && t.y === g - 1) offLedge = true; });
    const stoppedAt = t.x;
    // (on to the slope: from its top, down it)
    fresh();
    const s = U.create(world, { x: x0 + 350.5, y: g - 36, side: 'left' });
    U.walk(s, 1);
    let slopeAir = 0;
    run(5, () => { if (!s.onGround) slopeAir += 1; });
    const downSlope = s.y === g - 1 && s.x > x0 + 440;
    // (and at the wall 12 high)
    fresh();
    const w = U.create(world, { x: x0 + 560.5, y: g - 1, side: 'left' });
    U.walk(w, 1);
    run(3);
    await view('troop-walk', x0 + 260, g - 30, 7);
    check(Math.abs(top - U.WALK) < 0.5 && upStep && offLedge && airTicks <= 2 && stoppedAt < x0 + 330 - 2 && downSlope && slopeAir <= 2 && w.vx === 0 && w.x < x0 + 600 - 2 && w.y === g - 1,
      `a trooper walks at its pace (${top.toFixed(1)} cells/s, about 3 m/s), up a step 8 high (${upStep}) and down off a 5-cell ledge (${offLedge}) without leaving the ground (${airTicks} ticks in the air), stopped by a wall over its step (${(x0 + 330 - stoppedAt).toFixed(0)} cells off it); down a 30-degree slope keeping to the ground (${downSlope}, ${slopeAir} ticks in the air); a wall 12 high stops it (${(x0 + 600 - w.x).toFixed(0)} cells off it)`);
  }
}

// 2. A ladder up a wall 60 high: W at its foot climbs it, to the top and off onto the top. A roof 20
// over the ground: standing it cannot go under; crouched it goes under.
{
  const S = site(500);
  if (!S) check(false, 'a stretch of the wilds for the ladder');
  else {
    const { x0, g } = S;
    fill(x0 + 200, g - 60, x0 + 400, g - 1, M.STONE);
    for (let y = g - 60; y <= g - 1; y += 1) for (let x = x0 + 190; x < x0 + 200; x += 1) PW.setFlag(world, x, y, PW.FLAG.LADDER);
    fresh();
    const t = U.create(world, { x: x0 + 194.5, y: g - 1, side: 'left' });
    U.key({ code: 'KeyW' });   // (not in hand: ignored)
    U.hold(t);
    U.key({ code: 'KeyW', type: 'keydown' });
    run(6);
    U.key({ code: 'KeyW', type: 'keyup' });
    const climbed = t.y <= g - 61;
    U.key({ code: 'KeyD', type: 'keydown' });
    run(2);
    U.key({ code: 'KeyD', type: 'keyup' });
    const onTop = t.onGround && t.y === g - 61 && t.x > x0 + 205;
    // (the low roof: a slab 20 cells over the ground, from x0 + 60 to x0 + 120)
    fill(x0 + 60, g - 30, x0 + 120, g - 20, M.STONE);
    fresh();
    const a = U.create(world, { x: x0 + 30.5, y: g - 1, side: 'left' });
    U.walk(a, 1);
    run(3);
    const blocked = a.x < x0 + 60 - 2;
    const b = U.create(world, { x: x0 + 30.5, y: g - 1, side: 'left' });
    U.hold(b);
    U.key({ code: 'KeyS' });   // (stopped: crouch)
    U.walk(b, 1);
    run(11);
    const under = b.x > x0 + 125;
    U.hold(null);
    await view('troop-ladder', x0 + 195, g - 40, 6);
    check(climbed && onTop && blocked && under,
      `up a ladder 60 high it climbs (${climbed ? 'to the top' : `to ${g - t.y} up`}) and steps off onto the top (${onTop}); under a roof 20 high it cannot go standing (${blocked}), crouched it goes under (${under})`);
  }
}

// 3. Falling: off 40 cells it lands unhurt; off 140 it is hurt.
{
  const S = site(300);
  if (!S) check(false, 'a stretch of the wilds for the falls');
  else {
    const { x0, g } = S;
    fill(x0 + 50, g - 40, x0 + 70, g - 1, M.STONE);
    fill(x0 + 200, g - 140, x0 + 220, g - 1, M.STONE);
    fresh();
    const a = U.create(world, { x: x0 + 60.5, y: g - 41 }), b = U.create(world, { x: x0 + 210.5, y: g - 141 });
    U.walk(a, 1); U.walk(b, 1);
    run(4);
    check(a.hp === 100 && a.y === g - 1 && b.hp < 100 && b.y === g - 1,
      `off a 40-cell drop (about 3 m) it lands unhurt (${a.hp.toFixed(0)}); off 140 (10 m) it is hurt (${b.hp.toFixed(0)} left)`);
  }
}

// 4. Water: into a pool 40 deep it swims, its head kept over the surface; in a current it is carried.
{
  const S = site(500);
  if (!S) check(false, 'a stretch of the wilds for the pool');
  else {
    const { x0, g } = S;
    fill(x0 + 100, g, x0 + 400, g + 40, M.AIR);
    fill(x0 + 100, g + 41, x0 + 400, g + 46, M.STONE);
    for (let y = g; y <= g + 40; y += 1) for (let x = x0 + 100; x <= x0 + 250; x += 1) PW.set(world, x, y, M.WATER, { quiet: true });
    for (let y = g; y <= g + 40; y += 1) for (let x = x0 + 251; x <= x0 + 400; x += 1) PW.set(world, x, y, M.WATER | 0xc0, { quiet: true });
    fresh();
    const a = U.create(world, { x: x0 + 130.5, y: g + 20 }), b = U.create(world, { x: x0 + 300.5, y: g + 20 });
    run(4);
    const headUp = !PW.troops.blocks(world, Math.floor(a.x), a.y - U.HEIGHT + 2) && (PW.get(world, Math.floor(a.x), a.y - U.HEIGHT + 2) & 63) !== M.WATER;
    check(a.swim && headUp && a.hp === 100 && b.x > x0 + 300.5 + 40,
      `in deep water it swims (${a.swim}), its head kept over the surface (${headUp}); a current carries it off (${(b.x - x0 - 300.5).toFixed(0)} cells in 4 s)`);
  }
}

// 5. A blast throws it and hurts it by how near and hard; behind a wall of rock, the same blast
// nothing. Buried under a heap of debris 20 cells over its head, it digs itself out, sideways and
// up, never straight up; under 40 over its head, it dies.
{
  const S = site(700);
  if (!S) check(false, 'a stretch of the wilds for the blast and the heap');
  else {
    const { x0, g } = S;
    fresh();
    const a = U.create(world, { x: x0 + 100.5, y: g - 1 }), b = U.create(world, { x: x0 + 200.5, y: g - 1 });
    fill(x0 + 210, g - 40, x0 + 213, g - 1, M.BEDROCK);
    let thrown = 0;
    pwApp.explode(a.x + 15, g - 6, 8, 0.9);
    pwApp.explode(b.x + 15, g - 6, 8, 0.9);
    run(1.5, () => { thrown = Math.max(thrown, Math.abs(a.x - (x0 + 100.5))); });
    const hurtA = 100 - a.hp, hurtB = 100 - b.hp;
    // (the heaps)
    fresh();
    const c = U.create(world, { x: x0 + 400.5, y: g - 1 }), d = U.create(world, { x: x0 + 600.5, y: g - 1 });
    const heap = (cx, over) => { for (let dx = -60; dx <= 60; dx += 1) for (let y = g - 1; y >= g - 1 - (U.HEIGHT + over) + Math.round(Math.abs(dx) * 0.6); y -= 1) PW.set(world, cx + dx, y, M.DEBRIS, { quiet: true }); };
    heap(x0 + 400, 20); heap(x0 + 600, 40);
    let straightUp = 0, px = c.x, py = c.y, wasBuried = false;
    run(15, () => {
      if (c.buried) { wasBuried = true; if (c.y < py && c.x === px) straightUp += 1; }
      px = c.x; py = c.y;
    });
    await view('troop-dug-out', x0 + 400, g - 30, 6);
    check(thrown > 10 && hurtA > 0 && hurtB === 0 && wasBuried && !c.buried && !c.dead && straightUp === 0 && d.dead && d.hurtBy === 'buried',
      `a blast throws a trooper (${thrown.toFixed(0)} cells) and hurts it (${hurtA.toFixed(0)}); behind a wall of rock the like of it nothing (${hurtB.toFixed(0)}); buried under 20 cells of rubble over its head it digs itself out (${c.buried ? 'still buried' : 'out'}, ${straightUp} steps straight up - none), under 40 it dies (${d.dead ? d.hurtBy : 'alive'})`);
  }
}

// 6. The rifle: a trooper fires a magazine at another of the other side across open ground, and
// reloads; its rounds kill it. A grenade thrown beside a third goes off on its fuse. A slab off a
// building's storey kills a man it falls on; a lump the size of a brick barely hurts one.
{
  const S = site(700);
  if (!S) check(false, 'a stretch of the wilds for the firefight');
  else {
    const { x0, g } = S;
    fresh();
    const a = U.create(world, { x: x0 + 100.5, y: g - 1, side: 'left', facing: 1 }), b = U.create(world, { x: x0 + 300.5, y: g - 1, side: 'right', facing: -1 });
    a.aim = { x: b.x, y: b.y - 14 };
    let fired = 0;
    for (let k = 0; k < 60 * 7; k += 1) { if (U.fire(world, a)) fired += 1; U.step(world, DT); PW.shots.step(world, DT); }
    const reloaded = a.mag > 0 && a.ammo < U.MAG * 4;
    const c = U.create(world, { x: x0 + 160.5, y: g - 1 });
    a.aim = { x: c.x - 6, y: c.y };
    const n = world.grenades.length;
    U.throwGrenade(world, a);
    let blown = false;
    for (let k = 0; k < 60 * 4; k += 1) { pwApp.stepWorld(1); if (c.dead || c.hp < 100) blown = true; }
    const thrownOne = a.grenades === U.GRENADES - 1 && n === 0;
    // (the slab and the lump)
    const e = U.create(world, { x: x0 + 620.5, y: g - 1 }), f = U.create(world, { x: x0 + 660.5, y: g - 1 });
    const block = (cx, top, w, h) => { const xs = [], ys = []; for (let y = top; y < top + h; y += 1) for (let x = cx - (w >> 1); x < cx - (w >> 1) + w; x += 1) { xs.push(x); ys.push(y); } const k = xs.length; return { x: Int32Array.from(xs), y: Int32Array.from(ys), color: new Uint32Array(k).fill(PW.abgr(150, 148, 140)), byte: new Uint8Array(k).fill(M.CONCRETE), solid: new Uint8Array(k).fill(1) }; };
    world.fragments.spawn({ data: block(Math.round(e.x), g - 120, 24, 14), vx: 0, vy: 0 });
    world.fragments.spawn({ data: block(Math.round(f.x), g - 60, 7, 6), vx: 0, vy: 0 });
    for (let k = 0; k < 60 * 3; k += 1) pwApp.stepWorld(1);
    await view('troop-firefight', x0 + 300, g - 30, 5);
    check(fired >= 30 && reloaded && b.dead && b.hurtBy === 'bullet' && thrownOne && blown && e.dead && e.hurtBy === 'debris' && !f.dead && f.hp > 50,
      `a trooper fires its rifle (${fired} rounds) and reloads (${a.mag} in the magazine, ${a.ammo} left) - its rounds kill one of the other side 200 cells off (${b.dead ? `killed by ${b.hurtBy}` : `${b.hp.toFixed(0)} left`}); a grenade thrown (${a.grenades} left) goes off beside another (${blown ? 'hurt' : 'untouched'}); a slab off a storey kills a man it falls on (${e.dead ? e.hurtBy : `${e.hp.toFixed(0)} left`}), a lump the size of a brick barely hurts one (${f.hp.toFixed(0)} left)`);
  }
}

// 6b. A tank driving at troopers: one of its own side steps aside as it passes, unhurt; one of
// the other side it runs down.
{
  const S = site(600);
  if (!S || !PW.tanks) check(false, 'a stretch of the wilds for the tank');
  else {
    const { x0, g } = S, T = PW.tanks;
    fresh(); world.tanks = [];
    const tank = T.create(world, { style: 'modern', side: 'left', x: x0 + 100, y: g, facing: 1 });
    const own = U.create(world, { x: x0 + 260.5, y: g - 1, side: 'left' }), foe = U.create(world, { x: x0 + 400.5, y: g - 1, side: 'right' });
    T.drive(tank, 1);
    for (let k = 0; k < 60 * 8; k += 1) T.step(world, DT);
    world.tanks.length = 0;
    check(!own.dead && own.hp === 100 && Math.abs(own.x - x0 - 260.5) < 1 && foe.dead && foe.hurtBy === 'run over',
      `a tank driving on: a trooper of its own side steps aside, unhurt (${own.dead ? 'killed' : `${own.hp} left, ${(own.x - x0 - 260.5).toFixed(0)} cells on`}); one of the other side it runs down (${foe.dead ? foe.hurtBy : `${foe.hp.toFixed(0)} left`})`);
  }
}

// 6c. By hand (N102, the user's controls): it walks while D is held and stands when it is let go;
// with no key held it stands; Space jumps; a left click fires its rifle at the spot, a right click
// throws a grenade at it.
{
  const S = site(500);
  if (!S) check(false, 'a stretch of the wilds for the controls');
  else {
    const { x0, g } = S;
    fresh();
    const t = U.create(world, { x: x0 + 100.5, y: g - 1, side: 'left', facing: 1 });
    U.hold(t);
    run(0.3);
    const x0t = t.x;
    U.key({ code: 'KeyD', type: 'keydown' });
    run(1);
    const walked = t.x - x0t;
    U.key({ code: 'KeyD', type: 'keyup' });
    run(1);
    const stood = t.walk === 0 && Math.abs(t.vx) < 0.5;
    const xIdle = t.x;
    run(1);
    const idle = Math.abs(t.x - xIdle) < 0.5;
    let top = t.y;
    U.key({ code: 'Space', type: 'keydown' }); U.key({ code: 'Space', type: 'keyup' });
    run(1, () => { top = Math.min(top, t.y); });
    const jumped = g - 1 - top;
    const mag0 = t.mag, g0 = t.grenades;
    U.click(world, t.x + 200, t.y - 12, 0);
    run(0.3);
    const fired = mag0 - t.mag;
    U.click(world, t.x + 120, t.y - 10, 2);
    run(0.3);
    const threw = g0 - t.grenades;
    // (N102: a click is never lost - five at a man's pace, one every 0.1 s, faster than its rifle
    // fires: five rounds; and the hand's tool, clicked with it in hand, fires as well as aims)
    const mag1 = t.mag;
    for (let k = 0; k < 5; k += 1) { U.click(world, t.x + 200, t.y - 12, 0); run(0.1); }
    run(0.8);
    const quick = mag1 - t.mag, mag2 = t.mag;
    U.tool(world, t.x + 200, t.y - 12);
    run(0.3);
    const byTool = mag2 - t.mag;
    U.hold(null);
    // (a miner: its left click fires its rifle, though its drill is in hand; its right its drill)
    const mi = U.create(world, { x: x0 + 160.5, y: g - 1, side: 'left', facing: 1, unit: 'miner' });
    U.hold(mi);
    const mm0 = mi.mag;
    U.click(world, mi.x + 200, mi.y - 12, 0);
    run(0.2);
    const minerFired = mm0 - mi.mag;
    U.click(world, mi.x + 200, mi.y - 12, 2);
    const minerDrills = !!mi.drilling;
    U.stopDrill(mi);
    U.hold(null);
    check(walked > 12 && stood && idle && jumped >= 4 && fired === 1 && threw === 1 && quick === 5 && byTool === 1 && minerFired === 1 && minerDrills,
      `by hand: it walks while D is held (${walked.toFixed(0)} cells in 1 s), stands when it is let go (${stood}), and stays standing with no key held (${idle}); Space jumps it (${jumped} cells up); a left click fires its rifle at the spot (${fired} round), a right click throws a grenade at it (${threw}); five clicks a tenth of a second apart, five rounds (${quick}); a click of the hand's tool fires too (${byTool}); a miner's left click fires its rifle (${minerFired}), its right its drill (${minerDrills})`);
    fresh();
  }
}

// 6b. Poles (N124, the user's: units pass poles): a pier under a raised deck - three columns of steel
// 30 high, its building's PIER spans (as WGM's raised decks list their stilts) - a man of the
// building's side walks through it; a man of the other side is stopped by it.
{
  const S = site(500);
  if (!S || !PW.tanks || !PW.tanks.gatesOf) check(false, 'a stretch of the wilds and the gate spans for the pier');
  else {
    const { x0, g } = S, px = x0 + 250;
    fill(px, g - 30, px + 2, g - 1, M.STEEL);
    const id = world.buildings.length + 1;
    world.buildings.push({ id, faction: 'left', side: 'left', type: 'test-deck', gates: [0, 1, 2].map((d) => ({ x: px + d, y0: g - 30, y1: g - 1 })) });
    fresh();
    const a = U.create(world, { x: x0 + 200.5, y: g - 1, side: 'left', facing: 1 }), z = U.create(world, { x: x0 + 200.5, y: g - 1, side: 'right', facing: 1 });
    U.walk(a, 1); U.walk(z, 1);
    run(3);
    const through = a.x > px + 20, stopped = z.x < px && z.x > px - 10;
    world.buildings.pop();
    fill(px, g - 30, px + 2, g - 1, M.AIR);
    fresh();
    check(through && stopped, `poles: a man of the building's side walks through the pier under its deck (${through ? `${(a.x - px).toFixed(0)} cells past it` : 'stopped'}); a man of the other side is stopped by it (${stopped ? `${(px - z.x).toFixed(0)} cells short` : `at ${(z.x - px).toFixed(0)}`})`);
  }
}

// 7. What they cost: twenty troopers walking, a tick; and drawing them.
{
  const S = site(600);
  if (S) {
    fresh();
    for (let k = 0; k < 20; k += 1) U.walk(U.create(world, { x: S.x0 + 60.5 + k * 24, y: S.g - 1 }), k & 1 ? 1 : -1);
    const best = (n, m, work) => { let min = Infinity; for (let b = 0; b < n; b += 1) { const t0 = performance.now(); for (let k = 0; k < m; k += 1) work(); min = Math.min(min, (performance.now() - t0) / m); } return min; };
    const ms = best(5, 30, () => U.step(world, DT));
    const r = { ctx: document.createElement('canvas').getContext('2d'), world, camera: { x: S.x0, y: S.g - 200, zoom: 2 }, view: { width: 1600, height: 900 } };
    const drawMs = best(5, 10, () => U.draw(r));
    check(ms < 0.5 && drawMs < 2, `twenty troopers cost little: ${ms.toFixed(3)} ms a tick, ${drawMs.toFixed(2)} ms to draw`);
  }
}
fresh();
pwApp.setPaused(false);
return { checks, shots: shots.length };
