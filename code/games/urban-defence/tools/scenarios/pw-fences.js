// N89 (the user's: a base's fences and T-walls stop the enemy's troopers, never the base's own troopers,
// tanks or mechs; tanks drive over them or shoot across them) - PS's units half. pixel-world, det=1: a
// military seed dropped on open ground grows its base (eight times as fast); its barriers - a T-wall
// block, concrete three cells thick, and a run of chain-link, steel a cell thick, FENCE_H high, flagged
// FENCE, the main building's own and its gate spans, as its perimeter is laid (WGM's N155) - are laid
// across a stretch of the wilds levelled flat (the base's own perimeter stands where the ground lets
// it, at the lip of its plateau as often as not, a bank under it no man or hull climbs):
// - its own trooper goes through its T-wall; the enemy's is stopped at it;
// - its own tank drives through it, leaving it whole; the enemy's runs it down - and the base's
//   buildings are not pushed by it, as by a wall of theirs it drove into;
// - a round goes through its chain-link; one at its T-wall stops there;
// - its own mech walks through a wall of its base too tall to hop; the enemy's, walking, is stopped.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world, layout } = pwApp;
const eng = world.capitalGrowth, M = PW.M, FENCE = PW.FLAG.FENCE || 0;
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const id = (x, y) => PW.get(world, x, y) & 63;
const DT = 1 / 60, FENCE_H = 13;
world.buildSpeed = 8;
if (world.stock && world.stock.left) { world.stock.left.hm = 1e6; world.stock.left.sm = 1e5; }
const secs = (s) => { for (let k = 0; k < s; k += 1) pwApp.stepWorld(60); };
let base = null;
if (eng) for (let k = 0; k < 24 && !base; k += 1) {
  const x = Math.round(layout.sites[0].x1 + 1400 + k * 160);
  const r = eng.drop(x, 'military', 'modern', 'left');
  if (r && r.city && r.city.setting !== 'mountain') base = r.city;
}
const built = (c) => { const r = world.buildings[c.main.owner - 1]; return r && !r.underConstruction; };
if (!base || !FENCE) check(false, `a military seed taking on open ground, and FLAG.FENCE (${!!base}, ${FENCE})`);
else {
  for (let s = 0; s < 150 && !built(base); s += 1) secs(1);
  secs(5);
  const rec = world.buildings[base.main.owner - 1];
  const real = Object.values(base.fences || {}).filter(Boolean);
  info(`base ${rec.id} (${rec.faction || rec.side}) at ${base.x}; its perimeter: ${real.map((f) => `${f.wall ? 'T-wall' : 'gate'} at ${f.x}`).join(', ') || 'none yet'}`);
  // (a stretch of the wilds 700 wide, away from the base: cleared over its highest ground, stone under)
  let x0 = -1;
  for (const z of layout.wilds) for (let x = z.x0 + 100; x0 < 0 && x + 800 < z.x1; x += 50) if (Math.abs(x + 350 - base.x) > 2500) x0 = x;
  if (x0 < 0) check(false, 'a stretch of the wilds for the barriers');
  else {
    let g = Infinity;
    const tops = [];
    for (let x = x0; x <= x0 + 700; x += 1) { tops.push(world.groundTop[x]); g = Math.min(g, world.groundTop[x]); }
    for (let x = x0; x <= x0 + 700; x += 1) {
      for (let y = g - 200; y < g; y += 1) { PW.set(world, x, y, M.AIR, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); }
      for (let y = g; y <= Math.max(tops[x - x0], g + 30); y += 1) if (y < g + 30 || PW.mat.open[id(x, y)]) { PW.set(world, x, y, M.STONE, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); }
    }
    for (let k = (world.flora || []).length - 1; k >= 0; k -= 1) if (world.flora[k].anchorX >= x0 - 10 && world.flora[k].anchorX <= x0 + 710) world.flora.splice(k, 1);
    PW.rebuildGroundTop(world);
    const bx = x0 + 350;
    // (the base's barrier across it, at bx: a T-wall block or a run of chain-link - laid afresh)
    let laid = [];
    const lay = (wall) => {
      for (const [x, y] of laid) { PW.set(world, x, y, M.AIR, { quiet: true }); PW.setFlag(world, x, y, FENCE, false); PW.setOwner(world, x, y, 0); }
      rec.gates = (rec.gates || []).filter((q) => q.fence !== 'n89-test');
      laid = [];
      for (let k = 0; k < (wall ? 3 : 1); k += 1) {
        const x = bx + k;
        for (let y = g - FENCE_H; y < g; y += 1) {
          PW.set(world, x, y, wall ? M.CONCRETE : M.STEEL, { quiet: true });
          PW.setFlag(world, x, y, FENCE, true);
          PW.setOwner(world, x, y, rec.id);
          laid.push([x, y]);
        }
        rec.gates.push({ x, y0: g - FENCE_H, y1: g - 1, fence: 'n89-test' });
      }
      PW.wakeArea(world, bx - 10, g - 30, bx + 10, g + 2);
      secs(1);   // (the units' gate spans - see PW.tanks.gatesOf - kept a second)
    };
    const whole = () => laid.filter(([x, y]) => (PW.getFlags(world, x, y) & FENCE) && PW.mat.structural[id(x, y)]).length;
    // 1. Troopers: its own goes through its T-wall, the enemy's is stopped at it.
    lay(true);
    await view('n89-twall', bx, g - 20, 7);
    const U = PW.troops;
    const walk = (side) => {
      world.troops = [];
      const t = U.create(world, { x: bx + 80.5, y: g - 1, side });
      if (!U.goTo(world, t, bx - 80, g - 1)) t.walk = -1;
      for (let k = 0; k < 60 * 6; k += 1) U.step(world, DT);
      const x = t.x; world.troops = [];
      return x;
    };
    const ownX = walk('left'), foeX = walk('right');
    check(ownX < bx - 40 && foeX > bx + 2,
      `its own trooper goes through its T-wall (${Math.round(bx - ownX)} cells past it); the enemy's is stopped at it (${Math.round(foeX - bx - 3)} cells short of it)`);
    // 2. Tanks: its own drives through it, the wall whole; the enemy's runs it down, the base unpushed.
    const T = PW.tanks;
    const drive = (side) => {
      world.tanks = [];
      const t = T.create(world, { style: 'modern', side, x: bx + 160, y: g, facing: -1 });
      T.drive(t, -1);
      for (let k = 0; k < 60 * 7; k += 1) T.step(world, DT);
      const x = t.x; world.tanks = [];
      return x;
    };
    const before = whole(), health0 = rec.health ?? 1, failed0 = (rec.failed || []).length;
    const ownT = drive('left'), afterOwn = whole();
    const foeT = drive('right'), afterFoe = whole();
    secs(3);
    check(ownT < bx - 60 && afterOwn === before,
      `its own tank drives through its T-wall (${Math.round(bx - ownT)} cells past it), the wall left whole (${afterOwn} of ${before} cells)`);
    check(foeT < bx - 60 && afterFoe < before * 0.5 && (rec.failed || []).length === failed0 && (rec.health ?? 1) >= health0 - 0.01,
      `the enemy's tank runs it down (${before - afterFoe} of ${before} cells crushed, ${Math.round(bx - foeT)} cells past it) - the base's buildings not pushed by it (health ${(rec.health ?? 1).toFixed(2)}, ${(rec.failed || []).length - failed0} given way)`);
    await view('n89-twall-run-down', bx, g - 20, 6);
    // 3. Rounds: through its chain-link; at its T-wall, stopped.
    const shoot = () => {
      world.shots = [];
      const s = PW.shots.fire(world, { kind: 'bullet', x: bx + 60.5, y: g - 6.5, dx: -1, dy: 0, side: 'right', spread: 0 });
      let far = s.x;
      for (let k = 0; k < 90 && !s.done; k += 1) { PW.shots.step(world, DT); far = s.x; }
      world.shots = [];
      return far;
    };
    lay(false);
    const through = shoot();
    lay(true);
    const stopped = shoot();
    check(through < bx - 20 && stopped > bx - 2,
      `a round goes through its chain-link (${Math.round(bx - through)} cells past it); one at its T-wall stops there (${Math.round(stopped - bx)} cells from it)`);
    // 4. Mechs: its own walks through a wall of its base too tall to hop (the watch tower's foot, say -
    // its gate span 40 rows up); the enemy's, walking, is stopped at it.
    for (const [x, y] of laid) { PW.set(world, x, y, M.AIR, { quiet: true }); PW.setFlag(world, x, y, FENCE, false); PW.setOwner(world, x, y, 0); }
    rec.gates = (rec.gates || []).filter((q) => q.fence !== 'n89-test');
    laid = [];
    for (let k = 0; k < 3; k += 1) {
      for (let y = g - 40; y < g; y += 1) { PW.set(world, bx + k, y, M.CONCRETE, { quiet: true }); PW.setOwner(world, bx + k, y, rec.id); laid.push([bx + k, y]); }
      rec.gates.push({ x: bx + k, y0: g - 40, y1: g - 1, fence: 'n89-test' });
    }
    secs(1);
    const X = PW.mechs;
    const stride = (side) => {
      world.mechs = [];
      const m = X.create(world, { x: bx + 120, y: g - 1, side, facing: -1 });
      X.walk(m, -1);
      for (let k = 0; k < 60 * 6; k += 1) PW.tanks.step(world, DT);
      const x = m.x; world.mechs = [];
      return x;
    };
    const ownM = stride('left'), foeM = stride('right');
    check(ownM < bx - 30 && foeM > bx + 2,
      `its own mech walks through its base's wall too tall to hop (${Math.round(bx - ownM)} cells past it); the enemy's, walking, is stopped at it (${Math.round(foeM - bx - 3)} cells short of it)`);
    for (const [x, y] of laid) { PW.set(world, x, y, M.AIR, { quiet: true }); PW.setOwner(world, x, y, 0); }
    rec.gates = (rec.gates || []).filter((q) => q.fence !== 'n89-test');
  }
}
return { checks, shots: shots.length };
