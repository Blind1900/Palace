// Roofs come down with their buildings (N99; run with --page=pixel-world.html --params=det=1&seed=N).
// A building being worked on is a construction site - every building of a growing city is one -
// and the works hold up what they put up ahead of its supports. They do not hold up what a blow
// cut loose:
// 1. a tower's crown knocked off its roof (its neck broken through, as a falling piece or a shell
//    breaks it) comes down - it is not left standing in the air over the roof;
// 2. a tower's roof left on a strip of its storeys comes down - it is not held up by the works,
//    nor by the strip.
const { world } = pwApp, S = world.structure;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
pwApp.setPaused(true);
const solidAt = (x, y) => PW.mat.phase[PW.get(world, x, y) & PW.ID_MASK] === PW.PHASE.SOLID;
const own = (b, x, y) => PW.getOwner(world, x, y) === b.id && solidAt(x, y);
// (a building made a site being worked, the works kept on it all the while)
const site = (b) => { b.site = true; b.siteWanted = false; b.grewAt = world.tick || 0; S.analyse(b); b.grewAt = world.tick || 0; S.analyse(b); };
const steps = (b, secs) => { for (let k = 0; k < secs * 60; k += 1) { b.grewAt = world.tick || 0; pwApp.stepWorld(1); } };
const whole = world.buildings.filter((b) => b && b.body && b.canvas && b.type === 'population' && !b.ruined && (b.health ?? 1) >= 1)
  .sort((a, b) => (b.ground - b.body.top) - (a.ground - a.body.top));
const used = new Set();

// 1. The crown knocked off its roof.
{
  // (a tower with a crown on its roof - a mast, a spire: the roof, the highest row its own frame
  // spans most of; the crown's neck, the lowest row over the roof that is no more than a mast's
  // few cells across, with 40 or more of the crown over it)
  let T = null, roof = 0, crown = null;
  for (const b of whole) {
    const w = b.body.right - b.body.left + 1, x0 = b.body.left - 6, x1 = b.body.right + 6;
    const across = (y) => { let n = 0; for (let x = x0; x <= x1; x += 1) if (own(b, x, y)) n += 1; return n; };
    let r = -1;
    for (let y = b.body.top - 250; y < b.ground && r < 0; y += 1) if (across(y) >= w * 0.6) r = y;
    if (r < 0) continue;
    for (let y = r - 20; y > r - 200 && !T; y -= 1) {
      const n = across(y);
      if (n < 1 || n > 6) continue;
      let over = 0; for (let yy = y - 1; yy > y - 260; yy -= 1) over += across(yy);
      if (over >= 40) { T = b; roof = y; crown = { x0, x1, y0: y - 260, y1: y - 1 }; }
    }
    if (T) break;
  }
  if (!T) check(false, 'a whole tower with a crown on its roof');
  else {
    used.add(T.id);
    site(T);
    const crownCells = () => { let n = 0; for (let y = crown.y0; y <= crown.y1; y += 1) for (let x = crown.x0; x <= crown.x1; x += 1) if (own(T, x, y)) n += 1; return n; };
    await view('crown-on-its-roof', (T.body.left + T.body.right) / 2, roof - 20, 5);
    // (its neck broken through - a blow: see PW structure's urgent)
    let cut = 0;
    for (let x = crown.x0; x <= crown.x1; x += 1) for (let y = roof; y <= roof + 1; y += 1) if (own(T, x, y)) { PW.set(world, x, y, PW.M.AIR); PW.setLayer(world, 'back', x, y, 0); cut += 1; }
    // (looked at straight after the blow: what the works hold up of it, what comes away)
    const before = crownCells(), held0 = S.stats.scaffolded || 0;
    S.urgent(T.id);
    const rep = S.analyse(T);
    const held = (S.stats.scaffolded || 0) - held0;
    steps(T, 3);
    await view('crown-come-down', (T.body.left + T.body.right) / 2, roof - 20, 5);
    check(cut > 0 && cut < 60 && before >= 40 && held === 0 && rep.detached >= before * 0.8 && !rep.failed && (T.health ?? 0) > 0.8,
      `a tower being built on has its crown knocked off its roof (its neck broken through: ${cut} cells): the works do not hold it up (${held} cells held) - it comes away, ${rep.detached} cells of it and its ${before}; the tower stands (health ${(T.health ?? 0).toFixed(2)})`);
  }
}

// 2. The roof left on a strip of its storeys.
{
  const T = whole.find((b) => !used.has(b.id) && b.ground - b.body.top > 150);
  if (!T) check(false, 'a whole tower to take apart');
  else {
    site(T);
    const mid = Math.round((T.body.left + T.body.right) / 2), roofBottom = T.body.top + 50, keep = T.ground - 40;
    // (its middle storeys out: frame and back wall, all but the strip)
    let cut = 0;
    for (let y = roofBottom; y < keep; y += 1) for (let x = T.body.left - 2; x <= T.body.right + 2; x += 1) {
      if (PW.getOwner(world, x, y) !== T.id || (x >= mid && x <= mid + 1)) continue;
      if (!PW.mat.open[PW.get(world, x, y) & PW.ID_MASK]) { PW.set(world, x, y, PW.M.AIR); cut += 1; }
      PW.setLayer(world, 'back', x, y, 0);
      PW.setLayer(world, 'deco', x, y, 0);
    }
    await view('roof-on-a-strip', mid, roofBottom - 10, 3);
    S.urgent(T.id); S.notify(T.id);
    // (what of it is left high up: cells of its own, solid, over where its storeys were cut)
    const high = () => { let n = 0; for (let y = T.body.top - 40; y < roofBottom - 4; y += 1) for (let x = T.body.left - 4; x <= T.body.right + 4; x += 1) if (own(T, x, y)) n += 1; return n; };
    const before = high();
    steps(T, 20);
    const after = high();
    await view('roof-down', mid, T.ground - 120, 3);
    check(cut > 1000 && before > 200 && after < before * 0.05 && (T.failures || []).length > 0,
      `a tower being built on, its middle storeys taken out but for a strip up the middle (${cut} cells cut), does not keep its roof up on the strip: ${before} cells of it over the cut, ${after} left there after 20 s (it gave way: ${JSON.stringify(T.failures)})`);
  }
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
