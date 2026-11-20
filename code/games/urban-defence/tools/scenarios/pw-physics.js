// Ground physics (run with --page=pixel-world.html --params=seed=N): rock shields a blast far more
// than soil does, a mountain blown open comes down in a rockslide, a collapsed piece of a building
// rains down into a wide heap instead of standing in the air, water pushes on what is in its way,
// and felled trees come down onto the ground, bending their limbs, never sinking into it.
const { world, layout, stability } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const W = world.width;
const id = (x, y) => PW.get(world, x, y) & 63;
const openAt = (x, y) => PW.mat.open[id(x, y)] === 1;

// 1. The same blast takes out far less rock than soil, and a town's made ground stands it nearly as
// well as rock. Test blocks of stone, soil and made ground are laid deep under the middle of the
// wild zones (below the reach of anything built), and each is blown up from its middle.
const holes = {};
const blocks = [[M.STONE, 'stone'], [M.SOIL, 'soil'], [M.FILL, 'made ground']];
blocks.forEach(([kind, name], k) => {
  const zone = layout.wilds[k % layout.wilds.length];
  const bx = Math.round((zone.x0 + zone.x1) / 2) + (k >= layout.wilds.length ? 400 : 0), by = world.groundTop[bx] + 700;
  for (let y = by - 90; y <= by + 90; y += 1) for (let x = bx - 120; x <= bx + 120; x += 1) PW.set(world, x, y, kind, { quiet: true });
  pwApp.explode(bx, by, 48, 1.1);
  let n = 0;
  for (let y = by - 60; y <= by + 60; y += 1) for (let x = bx - 70; x <= bx + 70; x += 1) if (openAt(x, y)) n += 1;
  holes[name] = n;
});
check(holes.stone > 0 && holes.soil > holes.stone * 3, `a blast in rock chips a small hole, in soil it blows out a wide crater (${holes.stone} cells opened in stone, ${holes.soil} in soil)`);
check(holes['made ground'] < holes.soil * 0.5, `a town's made ground stands a blast far better than soil (${holes['made ground']} cells opened, ${holes.soil} in soil)`);

// 2. A mountain flank blown open again and again comes down: the rock left hanging over the hole
// breaks loose and slides away down the mountainside.
const m = layout.mountains.slice().sort((a, b) => b.height - a.height)[0];
const fx = Math.round(m.x - m.half * 0.45), fy = world.groundTop[fx] + 30;
await view('ph-mountain-before', fx, fy - 60, 4);
const brokenBefore = stability.stats.broken;
for (const [dx, dy] of [[0, 0], [30, -10], [-25, 15], [10, -30], [45, 10]]) { pwApp.explode(fx + dx, fy + dy, 60, 1.35); pwApp.stepWorld(20); }
pwApp.stepWorld(60 * 14);
const slid = stability.stats.broken - brokenBefore;
// Nothing is left hanging: no ground over a void deeper than the rock's reach, in the area.
let hanging = 0;
for (let x = fx - 80; x <= fx + 120; x += 2) {
  for (let y = world.groundTop[x]; y < fy + 80; y += 1) {
    if (!PW.mat.terrain[id(x, y)] || PW.mat.phase[id(x, y)] !== PW.PHASE.SOLID || PW.getOwner(world, x, y)) continue;
    let gap = 0;
    while (gap < 30 && openAt(x, y + 1 + gap)) gap += 1;
    if (gap < 30) continue;
    // (held from the side within its cohesion is fine)
    let held = false;
    for (let k = 1; k <= PW.mat.cohesion[id(x, y)] && !held; k += 1) for (const d of [-1, 1]) if (!openAt(x + d * k, y + 1) && !openAt(x + d * k, y)) held = true;
    if (!held) hanging += 1;
  }
}
check(slid > 500 && hanging === 0, `a mountain blown open comes down in a rockslide (${slid} cells broke loose, ${hanging} left hanging)`);
// Vibration comes from the shock of strikes - the blasts, the slide coming down, the rock raining
// onto the slope - and loosens what the element table says is loose enough.
check((stability.stats.shocks || 0) > 5 && stability.stats.loosened > 0, `blasts, the slide and falling rock all shake the ground (${stability.stats.shocks || 0} shocks, ${stability.stats.loosened} cells shaken loose)`);
await view('ph-mountain-after', fx, fy - 60, 4);
check((stability.stats.maxMs || 0) < 8, `looking for ground that lost its footing stays in budget (worst ${(stability.stats.maxMs || 0).toFixed(1)} ms)`);

// 2b. The blast wave: a blast beside a glazed building shatters glass it does not touch, and the
// air goes still again within a few seconds; working it stays cheap.
{
  const glassOf = (b) => { let n = 0; for (let y = b.body.top; y <= b.ground; y += 1) for (let x = b.body.left; x <= b.body.right; x += 1) if ((PW.get(world, x, y) & 63) === M.GLASS) n += 1; return n; };
  const b = world.buildings.map((q) => [q, glassOf(q)]).sort((a, c) => c[1] - a[1])[0][0];
  const before = glassOf(b);
  pwApp.explode(b.body.right + 40, b.ground - 40, 30, 1.1);
  let worst = 0;
  for (let t = 0; t < 60; t += 1) { pwApp.stepWorld(1); worst = Math.max(worst, pwApp.air.stats.ms); }
  const broken = before - glassOf(b);
  pwApp.stepWorld(60 * 4);
  check(broken > 5 && !pwApp.air.busy() && worst < 3, `a blast wave shatters a nearby building's glass (${broken} panes' cells, 40 cells from the blast), and the air settles (${pwApp.air.stats.tiles} tiles still moving, worst step ${worst.toFixed(2)} ms)`);
}

// 2c. Everything moves by the element table. Sand let go high over dry flat ground flies down
// (picking up speed) and lands as a heap at its angle of repose, every grain; debris dropped on a
// lake sinks to the bed and ash floats, pushing the water up rather than destroying it; steam
// rises up through a layer of smoke.
{
  const countIn = (x0, y0, x1, y1, kind) => { let n = 0; for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (id(x, y) === kind) n += 1; return n; };
  // (dry ground, well away from water: no shore sand sliding into a lake inside the count)
  let sx = 0, best = Infinity;
  for (const zone of layout.wilds) for (let x = zone.x0 + 200; x < zone.x1 - 200; x += 23) {
    if (layout.lakes.some((l) => Math.abs(x - l.x) < l.half + 260)) continue;
    let lo = Infinity, hi = -Infinity, wet = false;
    for (let d = -80; d <= 80; d += 4) { lo = Math.min(lo, world.groundTop[x + d]); hi = Math.max(hi, world.groundTop[x + d]); if (id(x + d, world.groundTop[x + d]) === M.WATER) wet = true; }
    if (!wet && hi - lo < best) { best = hi - lo; sx = x; }
  }
  const g = world.groundTop[sx], box = [sx - 200, g - 400, sx + 200, g + 40];
  const sand0 = countIn(...box, M.SAND);
  let poured = 0;
  for (let y = g - 260; y < g - 230; y += 1) for (let x = sx - 20; x < sx + 20; x += 1) if (id(x, y) === M.AIR) { PW.set(world, x, y, M.SAND); poured += 1; }
  const flown0 = pwApp.sim.stats.flown;
  pwApp.stepWorld(60 * 6);
  const landed = countIn(...box, M.SAND) - sand0;
  let top = g;
  for (let x = sx - 60; x <= sx + 60; x += 1) top = Math.min(top, world.groundTop[x]);
  check(pwApp.sim.stats.flown - flown0 >= poured * 0.9 && landed === poured && g - top > 15,
    `sand let go high up flies down and lands as a heap, every grain (${pwApp.sim.stats.flown - flown0} of ${poured} flew, ${landed} landed, heap ${g - top} cells high)`);
  const lake = layout.lakes.slice().sort((a, b) => b.half - a.half)[0];
  if (lake) {
    const lx = Math.round(lake.x), level = world.groundTop[lx];
    const water0 = pwApp.countWater();
    for (let y = level - 60; y < level - 50; y += 1) for (let x = lx - 30; x < lx - 10; x += 1) PW.set(world, x, y, M.DEBRIS);
    for (let y = level - 60; y < level - 50; y += 1) for (let x = lx + 10; x < lx + 30; x += 1) PW.set(world, x, y, M.ASH);
    // (and tree debris: wood splinters, lighter than water, and leaves come down onto it)
    const WOOD = M.DEBRIS | PW.DEBRIS_KIND.WOOD << 6, F = PW.PARTICLE, P = pwApp.particles;
    for (let y = level - 60; y < level - 50; y += 1) for (let x = lx + 40; x < lx + 60; x += 1) PW.set(world, x, y, WOOD);
    for (let k = 0; k < 120; k += 1) P.spawn(lx - 60 + (k % 40) + 0.5, level - 40 - Math.floor(k / 40) * 3 + 0.5, 0, 8, 0, PW.abgr(70, 140, 50), F.LEAF, 2);
    pwApp.stepWorld(60 * 8);
    let deep = 0, nd = 0, high = 0, na = 0, nw = 0, wHigh = 0;
    for (let y = level - 80; y < level + 800; y += 1) for (let x = Math.round(lx - lake.half - 100); x <= lx + lake.half + 100; x += 1) {
      const m = PW.get(world, x, y), k = m & 63;
      // (debris that has rested a while on the bed packs down into rubble)
      if (m === WOOD) { nw += 1; wHigh += y - level; } else if (k === M.DEBRIS || k === M.RUBBLE) { nd += 1; deep += y - level; } else if (k === M.ASH) { na += 1; high += y - level; }
    }
    deep = nd ? deep / nd : 0; high = na ? high / na : 0; wHigh = nw ? wHigh / nw : 0;
    let afloat = 0;
    for (let i = 0; i < P.stats.count; i += 1) if (P.flags[i] & F.FLOAT) afloat += 1;
    // (a few flakes of ash may drift off on the wind as it falls)
    check(nd >= 200 && na >= 190 && deep > 20 && high < 1 && pwApp.countWater() === water0,
      `in a lake debris sinks to the bed and ash floats, and no water is lost (${nd} debris and rubble cells on average ${deep.toFixed(0)} cells down, ${na} ash ${(-high).toFixed(0)} cells above the surface, water ${water0} -> ${pwApp.countWater()})`);
    check(nw >= 190 && wHigh < 1 && afloat >= 100,
      `tree debris floats: wood splinters lie on the surface and leaves ride it (${nw} wood cells ${(-wHigh).toFixed(0)} cells above the surface on average; ${afloat} leaves afloat, 120 dropped)`);
  }
  const ax = sx + 700, ay = world.groundTop[ax] - 220;
  for (let y = ay - 20; y < ay; y += 1) for (let x = ax - 15; x < ax + 15; x += 1) PW.set(world, x, y, M.SMOKE | 3 << 6);
  for (let y = ay; y < ay + 10; y += 1) for (let x = ax - 15; x < ax + 15; x += 1) PW.set(world, x, y, M.STEAM);
  pwApp.stepWorld(60);
  let sy = 0, ns = 0;
  for (let y = ay - 200; y < ay + 60; y += 1) for (let x = ax - 100; x <= ax + 100; x += 1) if (id(x, y) === M.STEAM) { sy += y; ns += 1; }
  check(ns > 0 && sy / ns < ay - 20, `steam rises up through a layer of smoke (${ns} steam cells, on average ${(ay - sy / ns).toFixed(0)} cells above where it started)`);
}

// 3. Untouched ground stays put: natural caves and overhangs elsewhere do not fall in by themselves.
// (what the tests above set going is let finish first: grains running off what was dropped have
// the ground they ran off looked at again, and it may fail in its turn - and the powder sim keeps
// to its few milliseconds a tick, so on a loaded machine the slide takes more ticks to run out)
for (let s = 0; s < 75 && stability.busy(); s += 1) pwApp.stepWorld(60);
const before = stability.stats.broken;
pwApp.stepWorld(60 * 5);
check(stability.stats.broken === before, `ground nobody disturbed stands (${stability.stats.broken - before} cells broke loose by themselves)`);

// 4. Water pushes on what is in its way: a block of water let go beside a street lamp runs down the
// street and knocks it over. A column of water 140 cells deep (some 10 m) stood against the tallest
// tower's wall breaks into it and sweeps it over - its ground storey cannot take the push of so
// much water (N42O); one 60 cells deep (4 m) against another tower breaks into its walls but leaves
// it standing. None of the water is lost (counted with what is in the air as spray, once all has
// come to rest).
{
  const sim = pwApp.sim, broke0 = sim.stats.waterBroke || 0;
  let tried = 0, fell = 0;
  for (const rec of (world.streetProps || []).filter((r) => r.kind === 'lamp').slice(0, 40)) {
    if (tried >= 4) break;
    const gx = rec.x0 - 6, g = world.groundTop[gx];
    let placed = 0;
    for (let x = gx - 50; x < gx; x += 1) for (let y = g - 50, top = world.groundTop[x]; y < top; y += 1) if (id(x, y) === M.AIR) { PW.set(world, x, y, M.WATER); placed += 1; }
    if (placed < 1500) continue;
    tried += 1;
    pwApp.stepWorld(60 * 5);
    if (rec.broken) fell += 1;
  }
  check(tried >= 3 && fell >= tried / 2, `a flood running down a street knocks over the lamps in its way (${fell} of ${tried} knocked over, ${sim.stats.waterSwept || 0} fittings, props and plants swept)`);
  const towers = world.buildings.filter((b) => b.type === 'population').sort((a, b) => (b.ground - b.body.top) - (a.ground - a.body.top));
  const T = towers[0], T2 = towers.find((b) => Math.abs(b.body.left - T.body.left) > 800);
  if (T && T2) {
    const P = pwApp.particles;
    const spray = () => { let n = 0; for (let i = 0; i < P.count; i += 1) if (P.flags[i] & P.F.WATER) n += 1; return n; };
    const water = () => pwApp.countWater() + spray();
    const flood = (b, h) => { for (let x = b.body.left - 70; x <= b.body.left - 2; x += 1) for (let y = b.ground - h, top = world.groundTop[x]; y < top; y += 1) if (id(x, y) === M.AIR) PW.set(world, x, y, M.WATER); };
    const water0 = water();
    flood(T, 140);
    flood(T2, 60);
    const water1 = water();
    pwApp.stepWorld(60 * 6);
    const broke = (sim.stats.waterBroke || 0) - broke0;
    const swept = (b) => (b.failures || []).includes('swept');
    const push = (b) => (b.failed || []).filter((f) => f.reason === 'swept').map((f) => `pushed ${f.push} against ${f.holds}`).join(', ');
    check(broke > 30 && swept(T) && !swept(T2), `deep water stood against a tower sweeps it over, shallow water breaks into another and leaves it standing (${broke} structure cells broken by water; the tower in 140 cells of water ${swept(T) ? `swept (${push(T)})` : 'standing'}, health ${(T.health ?? 1).toFixed(2)}; the one in 60 cells ${swept(T2) ? 'swept' : 'standing'}, health ${(T2.health ?? 1).toFixed(2)})`);
    for (let s = 0; s < 20 && (pwApp.fragments.list.length || spray()); s += 1) pwApp.stepWorld(60);
    check(water() === water1, `none of the water is lost (${water1 - water0} cells let go; ${water1} -> ${water()})`);
  }
}

// 5. Trees felled by small blasts at their feet come down a branch at a time and lie on the ground -
// on slopes too - never sinking into it (none of their wood two cells or more under its surface),
// each falling piece one body of wood; their limbs bend where they strike the ground, and the
// branches they snap off fall on as pieces of their own (N41O).
{
  const { fragments } = pwApp;
  // (the ground itself: rubble and debris come down on what lies there after it)
  const solid = (x, y) => { const k = id(x, y); return PW.mat.terrain[k] && PW.mat.phase[k] === PW.PHASE.SOLID; };
  // (how many cells under the ground's surface a cell lies: 0 in the open, 1 in its top layer, 2 a
  // cell under that ... out to 4)
  const depth = (x, y) => {
    if (!solid(x, y)) return 0;
    for (let r = 1; r <= 3; r += 1) for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && !solid(x + dx, y + dy)) return r;
    return 4;
  };
  const partsOf = (p) => {
    const { grid, gw, gh, data } = p, seen = new Uint8Array(gw * gh);
    let n = 0;
    for (let g0 = 0; g0 < grid.length; g0 += 1) {
      if (!grid[g0] || data.solid[grid[g0] - 1] !== 1 || seen[g0]) continue;
      n += 1; seen[g0] = 1;
      for (const queue = [g0]; queue.length;) {
        const g = queue.pop(), u = g % gw, v = (g / gw) | 0;
        for (let dv = -1; dv <= 1; dv += 1) for (let du = -1; du <= 1; du += 1) {
          const nu = u + du, nv = v + dv, j = nv * gw + nu;
          if (nu >= 0 && nv >= 0 && nu < gw && nv < gh && grid[j] && data.solid[grid[j] - 1] === 1 && !seen[j]) { seen[j] = 1; queue.push(j); }
        }
      }
    }
    return n;
  };
  const trees = [];
  for (const r of (world.flora || []).filter((t) => t.kind === 'tree' && !t.fallen && t.size > 90 && t.type !== 'deadTree')) {
    if (trees.every((q) => Math.abs(q.anchorX - r.anchorX) > 400)) trees.push(r);
    if (trees.length >= 8) break;
  }
  const stats0 = { ...fragments.stats };
  for (const r of trees) pwApp.explode(r.anchorX + 6, r.row - 2, 9, 1.0);
  let worst = 0, worstNote = '', deepest = 0, worstParts = 0;
  for (let t = 0; t < 60 * 10; t += 1) {
    pwApp.stepWorld(1);
    if (t % 3) continue;
    for (const p of fragments.list) {
      if (!p.flora || p.mode === 'flex') continue;
      const c = Math.cos(p.angle), s = Math.sin(p.angle);
      let wood = 0, under = 0;
      for (let k = 0; k < p.data.x.length; k += 1) {
        if (p.data.solid[k] !== 1) continue;
        const u = p.data.x[k] - p.ox0 + 0.5, v = p.data.y[k] - p.oy0 + 0.5;
        const d = depth(Math.floor(p.px + u * c - v * s), Math.floor(p.py + u * s + v * c));
        wood += 1;
        if (d >= 2) under += 1;
        deepest = Math.max(deepest, d);
      }
      if (wood >= 10 && under / wood > worst) { worst = under / wood; worstNote = `${under} of ${wood}`; }
      worstParts = Math.max(worstParts, partsOf(p));
    }
  }
  const more = (key) => (fragments.stats[key] || 0) - (stats0[key] || 0);
  check(trees.length >= 4 && deepest <= 2 && worst < 0.25, `falling trees never sink into the ground (${trees.length} trees felled; their wood at most ${deepest} cells under the surface; at worst ${(worst * 100).toFixed(0)}% of a piece's wood a cell or more under its top layer${worstNote ? `: ${worstNote}` : ''})`);
  check(worstParts === 1, `each falling piece of a tree is one body of wood (at most ${worstParts} separate parts of wood in one; ${more('parted')} parts gone their own ways)`);
  check(more('limbs') > 0 && more('limbBends') > 0 && more('brokeOff') > 0, `falling trees' limbs bend where they strike the ground, and the branches they snap off fall as pieces of their own (${more('limbs')} limbs bent ${more('limbBends')} times; ${more('brokeOff')} of ${more('snapped')} snapped branches fell on by themselves; ${more('stripped')} leaves torn off by the air)`);
}
pwApp.setPaused(false);
return { checks, shots: shots.length, holes, stability: stability.stats };
