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
  // (and the next flattest, well away from it, for a heap of rubble)
  const sites = [];
  for (const zone of layout.wilds) for (let x = zone.x0 + 200; x < zone.x1 - 200; x += 23) {
    if (layout.lakes.some((l) => Math.abs(x - l.x) < l.half + 260)) continue;
    let lo = Infinity, hi = -Infinity, wet = false;
    for (let d = -80; d <= 80; d += 4) { lo = Math.min(lo, world.groundTop[x + d]); hi = Math.max(hi, world.groundTop[x + d]); if (id(x + d, world.groundTop[x + d]) === M.WATER) wet = true; }
    if (!wet) sites.push({ x, rough: hi - lo });
  }
  sites.sort((a, b) => a.rough - b.rough);
  const sx = sites.length ? sites[0].x : 0;
  const rx = (sites.find((s) => Math.abs(s.x - sx) > 600) || { x: sx + 600 }).x;
  const g = world.groundTop[sx], box = [sx - 200, g - 400, sx + 200, g + 40];
  const sand0 = countIn(...box, M.SAND);
  // (the ground under each column before, to measure the heap on)
  const base = new Map();
  for (let x = sx - 200; x <= sx + 200; x += 1) base.set(x, world.groundTop[x]);
  let poured = 0;
  for (let y = g - 260; y < g - 230; y += 1) for (let x = sx - 20; x < sx + 20; x += 1) if (id(x, y) === M.AIR) { PW.set(world, x, y, M.SAND); poured += 1; }
  const flown0 = pwApp.sim.stats.flown;
  pwApp.stepWorld(60 * 6);
  const landed = countIn(...box, M.SAND) - sand0;
  let top = g;
  for (let x = sx - 60; x <= sx + 60; x += 1) top = Math.min(top, world.groundTop[x]);
  check(pwApp.sim.stats.flown - flown0 >= poured * 0.9 && landed === poured && g - top > 15,
    `sand let go high up flies down and lands as a heap, every grain (${pwApp.sim.stats.flown - flown0} of ${poured} flew, ${landed} landed, heap ${g - top} cells high)`);
  // (a heap's flanks: from where it stands four fifths of its height to where it stands a fifth,
  // each side - dry sand stands at about 34 degrees, broken rubble about 37; dropped from high up,
  // a little less)
  // (m: what the heap is of - and what it packs down into, lying a while)
  const flanksOf = (m, cx, baseOf) => {
    const of = (k) => k === m || k === PW.mat.settlesTo[m];
    const heapAt = (x) => { const b = baseOf(x); for (let y = b - 200; y < b; y += 1) if (of(id(x, y))) return b - y; return 0; };
    let h = 0, px = cx;
    for (let x = cx - 150; x <= cx + 150; x += 1) { const v = heapAt(x); if (v > h) { h = v; px = x; } }
    const flanks = [-1, 1].map((d) => {
      let xa = px, xb = px;
      for (let x = px; Math.abs(x - px) < 190; x += d) { const v = heapAt(x); if (v >= h * 0.8) xa = x; if (v >= h * 0.2) xb = x; }
      return Math.atan(h * 0.6 / Math.max(1, Math.abs(xb - xa))) * 180 / Math.PI;
    });
    return { h, flanks, text: `flanks ${flanks.map((a) => a.toFixed(0)).join(' and ')} degrees, ${h} cells high` };
  };
  {
    const sand = flanksOf(M.SAND, sx, (x) => base.get(x));
    check(sand.flanks.every((a) => a >= 28 && a <= 39), `sand let fall in a mass heaps at its angle of repose (${sand.text}; dry sand about 34)`);
    // (and a stream of rubble poured from high up: each lump strikes the heap and runs on down it
    // only while the slope is steeper than the heap stands at)
    const rBase = new Map();
    // (clear sky over it: no tree or cliff in the stream's way)
    for (let x = rx - 160; x <= rx + 160; x += 1) for (let y = world.groundTop[rx] - 210; y < world.groundTop[x]; y += 1) {
      if (PW.mat.open[id(x, y)] !== 1) PW.set(world, x, y, M.AIR, { quiet: true });
      PW.setLayer(world, 'deco', x, y, 0); PW.setFlag(world, x, y, PW.FLAG.FLORA, false);
    }
    for (let x = rx - 200; x <= rx + 200; x += 1) rBase.set(x, world.groundTop[x]);
    const rg = world.groundTop[rx];
    for (let t = 0; t < 60 * 10; t += 1) {
      for (let k = -1; k <= 1; k += 1) if (id(rx + k, rg - 200) === M.AIR) PW.set(world, rx + k, rg - 200, M.DEBRIS);
      pwApp.stepWorld(1);
    }
    pwApp.stepWorld(60 * 6);
    const rubble = flanksOf(M.DEBRIS, rx, (x) => rBase.get(x));
    check(rubble.h > 15 && rubble.flanks.every((a) => a >= 28 && a <= 42), `rubble poured in a stream from high up heaps at its angle of repose (${rubble.text}; broken rubble about 37)`);
  }
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
    const spray = () => P.airWater();
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

// 5b. Plants sway in the wind (N9; drawn by the renderer's leaf pass): a standing tree's leaves
// sway, the higher the more, its wood not at all; in calm air nothing moves, in a wind the leaves
// lean the way it blows.
{
  const tree = (world.flora || []).find((r) => r.kind === 'tree' && !r.fallen && !r.felled && r.size > 90);
  if (tree) {
    let woodSways = 0, high = 0, nHigh = 0, low = 0, nLow = 0;
    for (let y = tree.y; y < tree.y + tree.height; y += 1) for (let x = tree.x; x < tree.x + tree.width; x += 1) {
      const f = PW.getFlags(world, x, y);
      if (!(f & PW.FLAG.FLORA)) continue;
      const amp = PW.flora.leafSway(world, x, y) >> 8;
      if (f & PW.FLAG.WOOD) { if (amp) woodSways += 1; continue; }
      if (y < tree.row - (tree.row - tree.y) * 0.7) { high += amp; nHigh += 1; } else if (y > tree.row - (tree.row - tree.y) * 0.3) { low += amp; nLow += 1; }
    }
    const wind0 = world.wind, moved = (wind) => {
      world.wind = wind;
      let right = 0, left = 0;
      for (const t of [0, 0.5, 1, 1.5]) { const tab = PW.flora.swayTable(world, t); for (const v of tab) { if ((v & 3) === 2) right += 1; else if ((v & 3) === 0) left += 1; } }
      return [right, left];
    };
    const [calmR, calmL] = moved(2), [eastR, eastL] = moved(18), [westR, westL] = moved(-18);
    world.wind = wind0;
    check(!woodSways && nHigh && high / nHigh > (low / Math.max(1, nLow)) + 3 && !calmR && !calmL && eastR > eastL && westL > westR,
      `plants sway in the wind: leaves high in a crown sway more than low (amplitude ${(high / Math.max(1, nHigh)).toFixed(1)} against ${(low / Math.max(1, nLow)).toFixed(1)} of 15), wood not at all (${woodSways}); calm air moves nothing; leaves lean the way the wind blows (east ${eastR} right / ${eastL} left, west ${westR} / ${westL})`);
  }
}

// 6. Water flows (N61O): a tank of water (70 x 60) on a stone pillar 220 cells up, its side knocked
// out - the water pours out and falls as a sheet of drops in flight, not a dotted line of cells; the
// tank empties; it lands in a walled basin below and spreads level across it; none of it is lost.
{
  const firm = (x) => { const k = id(x, world.groundTop[x]); return PW.mat.terrain[k] && PW.mat.phase[k] === PW.PHASE.SOLID; };
  let x0 = -1;
  for (const zone of layout.wilds) for (let x = zone.x0 + 100; x < zone.x1 - 600 && x0 < 0; x += 13) {
    let flat = true;
    for (let d = 0; d <= 420 && flat; d += 3) flat = firm(x + d) && Math.abs(world.groundTop[x + d] - world.groundTop[x]) <= 3;
    if (flat) x0 = x;
  }
  if (x0 > 0) {
    const g = Math.min(...Array.from({ length: 421 }, (_, d) => world.groundTop[x0 + d]));
    const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); if (m === M.AIR) PW.setLayer(world, 'deco', x, y, 0); } };
    fill(x0, g - 300, x0 + 420, g - 1, M.AIR);
    for (let x = x0; x <= x0 + 420; x += 1) for (let y = g; y <= world.groundTop[x]; y += 1) if (id(x, y) === M.AIR) PW.set(world, x, y, M.STONE, { quiet: true });
    const tx0 = x0 + 10, tx1 = x0 + 79, ty0 = g - 280, ty1 = g - 221;
    fill(tx0 - 3, ty0 - 3, tx0 - 1, ty1 + 4, M.STONE); fill(tx1 + 1, ty0 - 3, tx1 + 3, ty1 + 4, M.STONE); fill(tx0 - 3, ty1 + 1, tx1 + 3, ty1 + 4, M.STONE);
    fill(tx0 + 10, ty1 + 5, tx0 + 40, g - 1, M.STONE);
    fill(x0 + 417, g - 50, x0 + 420, g - 1, M.STONE);
    const P = pwApp.particles, water = () => pwApp.countWater() + P.airWater();
    fill(tx0, ty0, tx1, ty1, M.WATER);
    const water0 = water();
    fill(tx1 + 1, ty0 - 3, tx1 + 3, ty1, M.AIR);
    PW.wakeArea(world, x0, g - 300, x0 + 420, g);
    const inBox = (a, b, c, d) => { let n = 0; for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) if (id(x, y) === M.WATER) n += 1; return n; };
    let flying = 0, emptied = -1;
    for (let t = 1; t <= 60 * 14; t += 1) {
      pwApp.stepWorld(1);
      flying = Math.max(flying, P.airWater());
      if (emptied < 0 && inBox(tx0, ty0, tx1, ty1) <= 5) emptied = t;
    }
    let lo = Infinity, hi = -Infinity;
    for (let x = tx1 + 6; x <= x0 + 414; x += 1) { let y = g - 50; while (y < g && id(x, y) !== M.WATER) y += 1; lo = Math.min(lo, y); hi = Math.max(hi, y); }
    check(flying > 500 && emptied > 0 && emptied < 60 * 8, `water pours out of a breach and falls as a sheet of drops, and the tank empties (${flying} drops in the air at once; emptied in ${emptied > 0 ? (emptied / 60).toFixed(1) + ' s' : 'never'})`);
    check(hi - lo <= 3, `water spreads level across a basin (its surface ${g - hi}..${g - lo} cells deep across 330 cells after 14 s)`);
    check(water() === water0, `the falling water is all kept (${water0} -> ${water()})`);
  }
}

// 7. Water goes down a stairwell (N64F): the stairs and the openings over their flights are grated
// (M.PLATFORM), and water runs through them. Water let go over the top of a tower's stairs drops
// down the well storey by storey to its ground floor: none of it is left standing on the storeys
// between, and none of it is lost.
{
  const towers = world.buildings.filter((b) => b.type === 'population' && (b.health === undefined || b.health >= 1) && !b.ruined)
    .sort((a, b) => (b.ground - b.body.top) - (a.ground - a.body.top));
  // (its stairs: the grated cells inside it - the band of columns they stand in, top and bottom)
  const stairsOf = (b) => {
    let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
    for (let y = b.body.top; y < b.ground; y += 1) for (let x = b.body.left; x <= b.body.right; x += 1) {
      if (id(x, y) !== M.PLATFORM) continue;
      if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
    }
    return sx1 - sx0 >= 6 && sy1 - sy0 >= 60 ? { sx0, sx1, sy0, sy1 } : null;
  };
  let T = null, S = null;
  for (const b of towers) { S = stairsOf(b); if (S) { T = b; break; } }
  if (T) {
    const P = pwApp.particles, water = () => pwApp.countWater() + P.airWater();
    const box = { x0: T.body.left - 300, x1: T.body.right + 300 };
    const wetIn = (y0, y1) => { let n = 0; for (let y = y0; y <= y1; y += 1) for (let x = box.x0; x <= box.x1; x += 1) if (id(x, y) === M.WATER) n += 1; return n; };
    // (the ceiling of its ground storey: the lowest row over it closed across most of the tower -
    // water standing in it is not)
    let ceiling = S.sy0;
    for (let y = T.ground - 4; y > S.sy0; y -= 1) {
      let closed = 0;
      for (let x = T.body.left + 2; x <= T.body.right - 2; x += 1) if (!openAt(x, y) && id(x, y) !== M.WATER) closed += 1;
      if (closed >= (T.body.right - T.body.left - 3) * 0.5) { ceiling = y; break; }
    }
    // (let go on the roof over its drain hatch - its concrete flagged FLAG.HATCH, over the stairwell
    // - or, a tower with none, in the open cells over the top of the stairs, across their band)
    // (its span: all its rows, from the top of the roof's covering down)
    let hx0 = Infinity, hx1 = -Infinity, hy = -1, hyBottom = -1;
    for (let y = T.body.top - 8; y < S.sy0; y += 1) for (let x = T.body.left; x <= T.body.right; x += 1) {
      if (!(PW.getFlags(world, x, y) & (PW.FLAG.HATCH || 0)) || !PW.mat.structural[id(x, y)]) continue;
      if (hy < 0) hy = y;
      hyBottom = y; hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x);
    }
    const [px0, px1, py1] = hy >= 0 ? [hx0, hx1, hy] : [S.sx0, S.sx1, S.sy0];
    // (the roof, down to the underside of its hatch: what lies on it - in its gutters, between its
    // ornaments - is still where it was let go)
    const roofBase = hy >= 0 ? hyBottom : py1 - 1;
    // (what is left where it was let go, and on the storeys between; the rest has gone down to the
    // ground storey - and on from there, out of its door - as none is lost: see the next check)
    const top0 = wetIn(py1 - 20, roofBase), between0 = wetIn(roofBase + 1, ceiling);
    let placed = 0;
    for (let y = py1 - 14; y < py1; y += 1) for (let x = px0; x <= px1; x += 1) if (id(x, y) === M.AIR) { PW.set(world, x, y, M.WATER); placed += 1; }
    const water0 = water();
    PW.wakeArea(world, S.sx0 - 10, S.sy0 - 20, S.sx1 + 10, T.ground);
    pwApp.stepWorld(60 * 12);
    for (let s = 0; s < 10 && P.airWater(); s += 1) pwApp.stepWorld(60);
    const top = wetIn(py1 - 20, roofBase) - top0, between = wetIn(roofBase + 1, ceiling) - between0, down = placed - top - between;
    await view('stairwell-water', (S.sx0 + S.sx1) / 2, S.sy0 + 40, 5);
    // (a roof's gutters, and the pockets between its ornaments, keep a little)
    check(placed >= 100 && down >= placed * 0.6 && between <= placed * 0.1, `water let go ${hy >= 0 ? `on a tower's roof over its drain hatch (${hx1 - hx0 + 1} wide)` : 'over a tower\'s stairs'} goes down the stairwell to its ground floor (${placed} cells let go, stairs ${S.sy1 - S.sy0} tall: ${down} went down to the ground storey, ${between} left on the storeys between, ${top} on the roof where it was let go)`);
    check(water() === water0, `the water going down the stairwell is all kept (${water0} -> ${water()})`);
  } else check(false, 'a standing tower with stairs to pour water down');
}

// 8. Loose ground shivers from a distant shock (N9): its wave runs on through the ground far past
// where it stirs the heaps, and the grains on top of loose ground it passes hop and settle back.
// Two strips of sand on a stone floor, one within the wave's reach (but past the shake's), one
// past it: the near one's grains shiver, none of them lost; the far one does not stir.
{
  const firm = (x) => { const k = id(x, world.groundTop[x]); return PW.mat.terrain[k] && PW.mat.phase[k] === PW.PHASE.SOLID; };
  let x0 = -1;
  for (const zone of layout.wilds) for (let x = zone.x0 + 100; x < zone.x1 - 900 && x0 < 0; x += 13) {
    let flat = true;
    for (let d = 0; d <= 820 && flat; d += 3) flat = firm(x + d) && Math.abs(world.groundTop[x + d] - world.groundTop[x]) <= 30;
    if (flat) x0 = x;
  }
  if (x0 > 0) {
    const g = Math.min(...Array.from({ length: 821 }, (_, d) => world.groundTop[x0 + d]));
    const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); if (m === M.AIR) PW.setLayer(world, 'deco', x, y, 0); } };
    fill(x0, g - 80, x0 + 820, g - 1, M.AIR);
    for (let x = x0; x <= x0 + 820; x += 1) for (let y = g; y <= world.groundTop[x]; y += 1) if (id(x, y) === M.AIR) PW.set(world, x, y, M.STONE, { quiet: true });
    fill(x0 + 250, g - 3, x0 + 400, g - 1, M.SAND);
    fill(x0 + 600, g - 3, x0 + 750, g - 1, M.SAND);
    pwApp.stepWorld(60 * 2);
    const sandIn = (a, b) => { let n = 0; for (let y = g - 40; y < g; y += 1) for (let x = a; x <= b; x += 1) if (id(x, y) === M.SAND) n += 1; return n; };
    const layout0 = (a, b) => { const s = []; for (let y = g - 40; y < g; y += 1) for (let x = a; x <= b; x += 1) if (id(x, y) === M.SAND) s.push(y * W + x); return s.join(','); };
    const near0 = sandIn(x0 + 200, x0 + 450), far0 = layout0(x0 + 560, x0 + 790), hops0 = stability.stats.shivered || 0;
    // (a shock of size 40: it stirs heaps within 66 cells, its wave carries 480)
    stability.shock(x0 + 50, g - 1, 40 ** 3);
    pwApp.stepWorld(60 * 3);
    const hops = (stability.stats.shivered || 0) - hops0, near = sandIn(x0 + 200, x0 + 450), farStill = layout0(x0 + 560, x0 + 790) === far0;
    check(hops > 12 && near === near0 && farStill, `loose ground shivers from a distant shock, and settles back (${hops} grains hopped in sand 200-350 cells off, past the 66 the shake stirs; ${near0} -> ${near} sand cells there; the strip 550-700 cells off, past the wave's 480: ${farStill ? 'still' : 'stirred'})`);
  }
}
pwApp.setPaused(false);
return { checks, shots: shots.length, holes, stability: stability.stats };
