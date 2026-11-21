// Rounds and vehicle combat (N77; run with --page=pixel-world.html --params=det=1&seed=N): rounds
// fly under gravity and the air's drag, cell by cell, and strike by hardness - a rifle bullet chips
// concrete and digs into soil but stops in steel, glances off a hard face struck at a slant, splashes
// into water and soon sinks, goes through a pane of glass; a tank's dart bores deep through earth,
// less through concrete, not at all into bedrock; a high-explosive shell bursts where it strikes. A
// tank lays its gun by fire control, fires (recoil, report), and what it hits takes it by its own
// pixels: a dart off a tank's armour, a second destroys it - its turret thrown, its wreck falling and
// coming to rest as wreck, part of the ground, in its own burnt colours, burning and smoking; a missile off a jet steers
// for a tank driving away and kills it; a blast hurts a tank by how near and hard it is, a heavy
// one close throws it; rifle fire only sparks off armour. The courses are laid on stone in the
// wilds, cleared above.
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(60); shots.push(await shot(name)); };
const load = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`${src} did not load`)); document.head.appendChild(s); });
if (!PW.tanks) await load('scripts/pw/pw-tank.js');
if (!PW.shots) await load('scripts/pw/pw-shots.js');
pwApp.setPaused(true);
const T = PW.tanks, S = PW.shots, DT = 1 / 60;
S.addTarget(T.target);
const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); PW.setOwner(world, x, y, 0); } };
const idAt = (x, y) => PW.get(world, x, y) & 63;
const used = [];
function site(len) {
  for (const zone of layout.wilds) for (let x = zone.x0 + 60; x + len < zone.x1 - 60; x += 40) {
    if (used.some(([a, b]) => x < b + 60 && x + len > a - 60)) continue;
    const tops = Array.from({ length: len + 1 }, (_, d) => world.groundTop[x + d]);
    const g = Math.min(...tops);
    if (Math.max(...tops) - g > 60) continue;
    used.push([x, x + len]);
    fill(x, g - 200, x + len, g - 1, M.AIR);
    // (firm: a block of stone 40 deep under the whole of it - no lake under a crust, no cave)
    for (let xx = x; xx <= x + len; xx += 1) for (let y = g; y <= world.groundTop[xx] + 3 || y <= g + 40; y += 1) PW.set(world, xx, y, M.STONE, { quiet: true });
    return { x0: x, g };
  }
  return null;
}
// (the rounds flown out: stepped until none is left, at most `secs`)
const fly = (secs = 3) => { for (let k = 0; k < secs / DT && world.shots && world.shots.length; k += 1) S.step(world, DT); };
const run = (secs) => { for (let k = 0; k < Math.round(secs / DT); k += 1) T.step(world, DT); };
const count = (x0, y0, x1, y1, test) => { let n = 0; for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (test(x, y)) n += 1; return n; };
const st0 = () => ({ ...S.stats });
const diff = (a) => { const o = {}; for (const k in S.stats) o[k] = S.stats[k] - (a[k] || 0); return o; };

// 1. A rifle bullet, by the hardness of what it strikes: it chips a concrete wall but never gets
// through it, digs a little into a soil bank, and stops dead on a steel plate.
{
  const C = site(400);
  if (!C) check(false, 'a stretch of the wilds for the range');
  else {
    const { x0, g } = C;
    fill(x0 + 200, g - 60, x0 + 211, g - 41, M.CONCRETE);
    fill(x0 + 200, g - 36, x0 + 229, g - 21, M.SOIL);
    fill(x0 + 200, g - 16, x0 + 202, g - 5, M.STEEL);
    const before = st0();
    const lanes = [[g - 50, 'concrete'], [g - 28, 'soil'], [g - 10, 'steel']];
    for (const [y] of lanes) for (let k = 0; k < 40; k += 1) S.fire(world, { kind: 'bullet', x: x0 + 40, y: y + (k % 5) * 2 - 4, dx: 1, dy: 0 });
    fly(2);
    const conc = count(x0 + 200, g - 60, x0 + 211, g - 41, (x, y) => idAt(x, y) === M.AIR);
    // (rows of the wall gone right through)
    const through = count(x0 + 200, g - 60, x0 + 200, g - 41, (x, y) => count(x, y, x + 11, y, (a, b) => idAt(a, b) === M.AIR) === 12);
    let deepest = 0;
    for (let y = g - 36; y <= g - 21; y += 1) { let d = 0; while (d < 30 && idAt(x0 + 200 + d, y) === M.AIR) d += 1; deepest = Math.max(deepest, d); }
    const steel = count(x0 + 200, g - 16, x0 + 202, g - 5, (x, y) => idAt(x, y) !== M.STEEL);
    const d = diff(before);
    check(d.fired === 120 && conc > 0 && conc < 120 && through === 0 && deepest >= 2 && deepest < 20 && steel === 0 && d.struck >= 100,
      `a rifle bullet strikes by hardness: ${d.fired} fired, ${d.struck} struck - a concrete wall chipped (${conc} cells knocked out, ${through} rows through its 12), a soil bank dug into (${deepest} cells at the deepest), a steel plate untouched (${steel} cells gone); ${d.broke} cells broken out in all`);

    // 2. A dart bores: deep through earth, less through concrete, not at all into bedrock.
    fill(x0 + 240, g - 60, x0 + 330, g - 50, M.SOIL);
    fill(x0 + 240, g - 40, x0 + 330, g - 30, M.CONCRETE);
    fill(x0 + 240, g - 20, x0 + 330, g - 10, M.BEDROCK);
    const depth = (y) => { let d = 0; while (d < 91 && idAt(x0 + 240 + d, y) === M.AIR) d += 1; return d; };
    for (const y of [g - 55, g - 35, g - 15]) S.fire(world, { kind: 'ap', x: x0 + 215, y, dx: 1, dy: 0 });
    // (the wall and bank in front of it are in the way for the lower lanes: cleared first)
    fill(x0 + 200, g - 60, x0 + 239, g - 5, M.AIR);
    fly(2);
    const [ds, dc, db] = [depth(g - 55), depth(g - 35), depth(g - 15)];
    check(ds >= 25 && dc >= 8 && dc < ds && db === 0,
      `an armour-piercing dart bores by hardness: ${ds} cells into soil, ${dc} into concrete, ${db} into bedrock`);
  }
}

// 3. A bullet glances off a steel plate struck at a slant, flies on into water - a splash - and
// soon sinks there; one through a pane of glass shatters it and goes on.
{
  const C = site(400);
  if (!C) check(false, 'a stretch of the wilds for the glance and the pool');
  else {
    const { x0, g } = C;
    fill(x0 + 60, g - 3, x0 + 200, g - 1, M.STEEL);
    const before = st0();
    const b = S.fire(world, { kind: 'bullet', x: x0 + 40, y: g - 14, dx: 1, dy: 0.18 });
    fly(1.5);
    const g1 = diff(before), past = b.x > x0 + 130;
    fill(x0 + 250, g - 40, x0 + 330, g - 1, M.WATER);
    const before2 = st0();
    const w = S.fire(world, { kind: 'bullet', x: x0 + 230, y: g - 70, dx: 1, dy: 1 });
    fly(1.5);
    const g2 = diff(before2), sankAt = w.y - (g - 40);
    fill(x0 + 360, g - 30, x0 + 360, g - 10, M.GLASS);
    const before3 = st0();
    const p = S.fire(world, { kind: 'bullet', x: x0 + 340, y: g - 20, dx: 1, dy: 0 });
    fly(0.2);
    const g3 = diff(before3);
    check(g1.glanced >= 1 && past && g2.splashed === 1 && g2.sank === 1 && sankAt > 0 && sankAt < 30 && g3.glass >= 1 && (p.x > x0 + 361 || p.done && p.x > x0 + 361),
      `a bullet glances off steel struck at a slant (${g1.glanced} glance, on to ${(b.x - x0).toFixed(0)}); into water it splashes (${g2.splashed}) and sinks ${sankAt.toFixed(0)} cells down; through a pane of glass it goes on (${g3.glass} pane shattered, on to ${(p.x - x0).toFixed(0)})`);
  }
}

// 4. A high-explosive shell bursts where it strikes: the world's own blast, a crater.
{
  const C = site(300);
  if (!C) check(false, 'a stretch of the wilds for the shell');
  else {
    const { x0, g } = C;
    fill(x0 + 200, g - 30, x0 + 260, g - 1, M.SOIL);
    const before = st0();
    S.fire(world, { kind: 'he', x: x0 + 30, y: g - 15, dx: 1, dy: 0 });
    fly(1);
    const gone = count(x0 + 196, g - 30, x0 + 230, g - 1, (x, y) => idAt(x, y) !== M.SOIL);
    const d = diff(before);
    check(d.burst === 1 && gone > 60, `a high-explosive shell bursts where it strikes (${d.burst} burst): a crater of ${gone} cells in the bank`);
  }
}

// 5. The tank duel: a tank lays its gun on another by its fire control and fires - recoil, the
// report - its dart takes 60 of the other's armour (a scar where it struck, a hole bitten out of
// it there and its edges chipped away, the other smoking and slowed); the second destroys it: it
// goes up in a burst of flame and smoke with no blast - the ground round it whole, the tank beside
// it unhurt, only its heat - its turret thrown off, and its wreck falls and comes to rest as wreck,
// burnt black, burning, its smoke hanging over it.
let duel = null;
{
  const C = site(700);
  if (!C) check(false, 'a stretch of the wilds for the duel');
  else {
    const { x0, g } = C;
    world.tanks = [];
    const a = T.create(world, { style: 'modern', side: 'left', x: x0 + 100, y: g, facing: 1, ammo: 'ap' });
    const b = T.create(world, { style: 'gothic', side: 'right', x: x0 + 520, y: g, facing: -1 });
    // (and one of its side's beside it, past it: out of the line of fire, in reach of a blast)
    const c = T.create(world, { style: 'asian', side: 'right', x: x0 + 655, y: g, facing: -1 });
    // (laid on the middle of its hull)
    T.aimAt(a, b.x, b.y - 20);
    run(1.5);
    const v0 = a.v, before = st0(), frags0 = world.fragments ? world.fragments.list.length : 0, p0 = pwApp.particles.count;
    const r1 = T.fire(world, a);
    const kicked = a.v < v0 && a.recoil > 0 && a.reload > 0, report = pwApp.particles.count - p0;
    run(0.4);
    const hp1 = b.hp, scars = b.scars.length, smoking = b.hp < 60;
    const holes = b.holes ? b.holes.hull.reduce((n, v) => n + v, 0) + b.holes.turret.reduce((n, v) => n + v, 0) : 0;
    await view('tank-chipped', b.x, b.y - 20, 8);
    const early = T.fire(world, a);   // (still loading: no round)
    run(3.2);
    // (the ground round it, as it is before it goes up)
    const ground = () => count(Math.round(b.x) - 90, Math.round(b.y) - 4, Math.round(b.x) + 90, Math.round(b.y) + 30, (x, y) => PW.mat.terrain[idAt(x, y)] && idAt(x, y) !== M.WRECK);
    const ground0 = ground();
    // (the flames let fly as it goes up)
    const P = pwApp.particles, spawn0 = P.spawn;
    let fire0 = 0;
    P.spawn = function (...s) { if (s[6] & PW.PARTICLE.FIRE) fire0 += 1; return spawn0.apply(this, s); };
    T.fire(world, a);
    let k = 0;
    while (!b.dead && k < 60) { run(DT); k += 1; }
    P.spawn = spawn0;
    const hot = PW.heatAt(world, Math.round(b.x), Math.round(b.y) - 24), ground1 = ground(), cHp = c.hp;
    // (a third of a second on, the world running: its burst)
    pwApp.stepWorld(20);
    await view('tank-goes-up', b.x, b.y - 40, 6);
    const d = diff(before), frags = world.fragments ? world.fragments.list.length - frags0 : 0;
    duel = { x0, g, bx: b.x, by: b.y };
    // (the wreck comes to rest: the world run on)
    pwApp.stepWorld(60 * 8);
    let ruin = 0, sum = 0;
    for (let y = g - 90; y <= g + 2; y += 1) for (let x = b.x - 160; x <= b.x + 160; x += 1) {
      if (idAt(x, y) !== M.WRECK) continue;
      ruin += 1;
      const c = PW.getLayer(world, 'paint', x, y);
      sum += ((c & 255) + (c >>> 8 & 255) + (c >>> 16 & 255)) / 3;
    }
    const dark = ruin ? sum / ruin : 255, smoulders = (world.smoulders || []).filter((s) => Math.abs(s.x - duel.bx) < 40).length;
    if (!ruin) console.log(`duel wreck: b at ${b.x.toFixed(0)},${b.y.toFixed(0)} g ${g}; wreck ruins ${(world.ruins || []).filter((r) => r.wreck).map((r) => `${r.x0}..${r.x1},${r.y0}..${r.y1}:${r.cells}`).join(' ')}; wreck pieces ${world.fragments.list.filter((p) => p.wreck).map((p) => `${p.mass.toFixed(0)}@${p.px.toFixed(0)},${p.py.toFixed(0)}`).join(' ')}`);
    check(r1 && kicked && report >= 20 && !early && hp1 === 40 && scars >= 1 && holes > 150 && b.chipped === 15 && smoking && b.dead && !world.tanks.includes(b) && d.units >= 2 && frags >= 2 && ruin > 1500 && dark < 90 && smoulders >= 1,
      `the tank duel: laid by its fire control, the dart fired (recoil ${kicked ? 'and reload' : 'MISSING'}, the report ${report} pixels of flash, smoke and dust; none fired while loading: ${!early}) takes 60 of the other's armour (${hp1} left, ${scars} scar, ${holes} cells of its plate chipped away - a hole where it struck and ${b.chipped} bites off its edges - smoking: ${smoking}); the second destroys it (${b.dead ? 'destroyed' : 'standing'}, ${d.units} hits) - turret and hull thrown as ${frags} pieces, at rest 8 s on - the world running - as ${ruin} cells of wreck, part of the ground, burnt black (mean ${dark.toFixed(0)}), ${smoulders} plume over it`);
    check(b.dead && ground1 === ground0 && cHp === 100 && fire0 > 120 && hot > 380,
      `it goes up in a burst of flame and smoke with no blast (${fire0} flames): the ground round it whole (${ground0 - ground1} cells of it gone), the tank beside it, ${(c.x - b.x).toFixed(0)} cells off, unhurt (${cHp}), and only its heat about it - ${hot.toFixed(0)} degrees a metre and a half over its hull, enough to set wood alight`);
    world.tanks.length = 0;
  }
}

// 6. A missile off a jet steers for a tank driving away and kills it; a rifle's fire only sparks
// off a tank's armour.
{
  const C = site(900);
  if (!C) check(false, 'a stretch of the wilds for the missile');
  else {
    const { x0, g } = C;
    world.tanks = [];
    const c = T.create(world, { style: 'asian', side: 'right', x: x0 + 500, y: g, facing: 1 });
    T.drive(c, 1);
    const before = st0();
    for (let k = 0; k < 30; k += 1) S.fire(world, { kind: 'bullet', x: x0 + 300, y: g - 16 - (k % 6), dx: 1, dy: 0, spread: 0.01 });
    run(0.6);
    const sparked = diff(before), hpRifle = c.hp;
    const m = S.fire(world, { kind: 'missile', x: x0 + 100, y: g - 180, dx: 1, dy: 0.1, target: c, aimDy: 16, vx0: 300 });
    let k = 0;
    while (!c.dead && k < 60 * 6) { run(DT); k += 1; }
    check(sparked.units >= 20 && hpRifle === 100 && c.dead && m.done,
      `rifle fire only sparks off a tank's armour (${sparked.units} of 30 struck it, ${hpRifle} of its 100 left); a missile off a jet steers for a tank driving away and destroys it (${c.dead ? `in ${(k / 60).toFixed(1)} s` : `not: ${c.hp} left`})`);
    world.tanks.length = 0;
  }
}

// 7. A blast hurts a tank by how near it is and how hard; a heavy one close by throws it.
{
  const C = site(500);
  if (!C) check(false, 'a stretch of the wilds for the blasts');
  else {
    const { x0, g } = C;
    world.tanks = [];
    const near = T.create(world, { style: 'modern', side: 'left', x: x0 + 120, y: g, facing: 1 });
    const far = T.create(world, { style: 'modern', side: 'left', x: x0 + 380, y: g, facing: 1 });
    pwApp.explode(x0 + 250, g - 40, 10, 1);
    const hn = near.hp, hf = far.hp;
    const y0 = near.y;
    pwApp.explode(near.x + 64, near.y - 10, 14, 1.25);
    let top = near.y;
    for (let k = 0; k < 40; k += 1) { run(DT); top = Math.min(top, near.y); }
    // (a blast as near, with a wall of rock between - one it cannot break: its cover takes it)
    const nearHurt = 100 - near.hp;
    world.tanks.length = 0;
    const C2 = site(320);
    let walled = null;
    if (C2) {
      const w = T.create(world, { style: 'modern', side: 'left', x: C2.x0 + 120, y: C2.g, facing: 1 });
      fill(C2.x0 + 181, C2.g - 50, C2.x0 + 184, C2.g - 1, M.BEDROCK);
      pwApp.explode(w.x + 70, w.y - 10, 14, 1.25);
      walled = 100 - w.hp;
    }
    check(hn === 100 && hf === 100 && near.hp < 100 && !near.dead && y0 - top > 3 && walled !== null && walled < nearHurt * 0.5,
      `a blast hurts a tank by how near and hard it is (a blast 130 cells off: ${100 - hn} and ${100 - hf}); a heavy one close by hurts it (${nearHurt.toFixed(0)}) and throws it (${(y0 - top).toFixed(0)} cells up); behind a wall of rock the like of it hurts it ${walled === null ? '- (no site)' : walled.toFixed(0)}`);
    world.tanks.length = 0;
  }
}

// 8. Fire control: a far mark, the round falling as it flies - the gun laid above the line to it,
// its dart passes within a few cells of it.
{
  const C = site(900);
  if (!C) check(false, 'a stretch of the wilds for the fire control');
  else {
    const { x0, g } = C;
    world.tanks = [];
    const t = T.create(world, { style: 'modern', side: 'left', x: x0 + 80, y: g, facing: 1, ammo: 'he' });
    const mark = { x: x0 + 860, y: g - 120 };
    T.aimAt(t, mark.x, mark.y);
    run(2);
    const s = T.fire(world, t);
    let miss = Infinity;
    for (let k = 0; k < 60 && s && !s.done; k += 1) {
      const px = s.x, py = s.y;
      S.step(world, DT);
      // (the nearest the path this tick came to the mark)
      const sx = s.x - px, sy = s.y - py, l2 = sx * sx + sy * sy, f = l2 ? Math.max(0, Math.min(1, ((mark.x - px) * sx + (mark.y - py) * sy) / l2)) : 0;
      miss = Math.min(miss, Math.hypot(px + sx * f - mark.x, py + sy * f - mark.y));
    }
    const line = Math.atan2(t.y - 30 - mark.y, mark.x - t.x);
    check(s && miss < 4 && t.elevation > line,
      `fire control lays the gun above the line to a far mark, for the round's fall (${(t.elevation * 57.3).toFixed(2)} deg against ${(line * 57.3).toFixed(2)} to it): it passes ${miss.toFixed(1)} cells from the mark 780 cells off`);
    world.tanks.length = 0;
  }
}

// 9. What it costs: 300 rounds in flight a tick, and a round looked for against six tanks.
{
  const C = site(700);
  if (C) {
    const { x0, g } = C;
    world.tanks = [];
    for (let k = 0; k < 6; k += 1) T.create(world, { style: T.STYLES[k % 3], side: 'right', x: x0 + 150 + k * 90, y: g, facing: -1 });
    const best = (n, each, work) => { let min = Infinity; for (let b = 0; b < n; b += 1) { const t0 = performance.now(); for (let k = 0; k < each; k += 1) work(); min = Math.min(min, (performance.now() - t0) / each); } return min; };
    const volley = () => { world.shots = []; for (let k = 0; k < 300; k += 1) S.fire(world, { kind: 'bullet', x: x0 + 20, y: g - 200 + (k % 150), dx: 1, dy: 0 }); };
    let ms = Infinity;
    for (let b = 0; b < 4; b += 1) { volley(); const t0 = performance.now(); S.step(world, DT); ms = Math.min(ms, performance.now() - t0); }
    const hitMs = best(4, 50, () => T.target.hit(world, { from: null }, x0 + 20, g - 16, x0 + 700, g - 16));
    world.shots = [];
    check(ms < 2 && hitMs < 0.5, `rounds cost little: 300 in flight ${ms.toFixed(2)} ms a tick; one looked for against six tanks ${hitMs.toFixed(3)} ms`);
    world.tanks.length = 0;
  }
}

// (looks: a tank firing, the wreck of the duel burning, a missile's trail)
{
  const C = site(600);
  if (C) {
    const { x0, g } = C;
    world.tanks = [];
    const a = T.create(world, { style: 'modern', side: 'left', x: x0 + 120, y: g, facing: 1, ammo: 'he' });
    T.aimAt(a, x0 + 560, g - 60);
    run(1.5);
    T.fire(world, a);
    for (let k = 0; k < 3; k += 1) { T.step(world, DT); pwApp.particles.step(DT); }
    await view('shots-tank-fires', a.x + 120, a.y - 30, 7);
    S.fire(world, { kind: 'missile', x: x0 + 100, y: g - 190, dx: 1, dy: 0.15, target: { x: x0 + 520, y: g }, vx0: 200 });
    for (let k = 0; k < 40; k += 1) { T.step(world, DT); pwApp.particles.step(DT); }
    await view('shots-missile', x0 + 300, g - 140, 5);
    world.tanks.length = 0;
    world.shots = [];
  }
  if (duel) await view('shots-wreck', duel.bx, duel.by - 20, 7);
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
