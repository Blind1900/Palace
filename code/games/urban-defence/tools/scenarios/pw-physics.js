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
// (the water in a box round a test - the world's own water is drawn off by its pumps as the tests run)
const waterIn = (x0, y0, x1, y1) => { let n = 0; for (let y = Math.max(0, y0); y <= Math.min(world.height - 1, y1); y += 1) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x += 1) if (id(x, y) === M.WATER) n += 1; return n; };
const openAt = (x, y) => PW.mat.open[id(x, y)] === 1;
// (the towns' growth and the crews' work held still - a tower picked as standing whole, built up
// or mended while it is looked at, is not the tower picked: 9, 10)
// (the fires the tree tests' blasts start, put out once they have been looked at: let burn, they ran
// on through the woods into the towns - ten to twenty thousand cells alight - and burnt down the towers
// 9 and 10 look at, and boiled off the water 7 counts)
// (every flame out, and the heat round them let go - the woods hot from the fire caught again from it)
const putOut = () => {
  const H = pwApp.heat;
  if (!H || !H.burning) return;
  for (const i of [...H.burning.keys()]) H.extinguish(i, i % W, (i / W) | 0);
  const ambient = PW.heatAt(world, -1, -1);
  for (const c of world.heatList || []) if (world.heat[c]) world.heat[c].fill(ambient);
};
// (a tower of the tests' own for 9 and 10, built whole and alone on a stretch of the wilds cleared
// flat, its doors onto open ground: the towns' towers stand in what the tests before did to them -
// burnt by the trees' fires, mended, built up, heaped at their doors - and the one picked was not
// the one looked at. Built the first time it is wanted, away from the tank of 6)
// (a stretch of the wilds [x0, x1] laid as the tests want it: its surface `rise(x)` under its highest
// ground, cleared over that, solid under it down to the ground as it lay - soil over stone - so no
// hollow is left under it to swallow what falls there; the highest ground's row)
const level = (x0, x1, rise) => {
  let g = Infinity;
  const tops = [];
  for (let x = x0; x <= x1; x += 1) { tops.push(world.groundTop[x]); g = Math.min(g, world.groundTop[x]); }
  for (let x = x0; x <= x1; x += 1) {
    const s = g + rise(x);
    for (let y = Math.max(1, g - 700); y < s; y += 1) { PW.set(world, x, y, M.AIR, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); }
    for (let y = s; y <= Math.max(tops[x - x0], s + 29); y += 1) {
      if (y >= s + 30 && !PW.mat.open[id(x, y)]) continue;
      PW.set(world, x, y, y < s + 4 ? M.SOIL : M.STONE, { quiet: true });
      PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0);
    }
  }
  PW.rebuildGroundTop(world);
  PW.wakeArea(world, x0, g - 700, x1, g + 200);
  return g;
};
let lone;
const loneTower = () => {
  if (lone !== undefined) return lone;
  lone = null;
  let x0 = -1;
  for (const z of layout.wilds || []) for (let x = z.x0 + 100; x0 < 0 && x + 800 < z.x1; x += 50) if (!(tankAt > 0 && x < tankAt + 900 && x + 800 > tankAt - 300)) x0 = x;
  if (x0 < 0) return lone;
  level(x0, x0 + 800, () => 0);
  // (its own trees gone with the ground they stood on)
  for (let k = (world.flora || []).length - 1; k >= 0; k -= 1) if (world.flora[k].anchorX >= x0 - 10 && world.flora[k].anchorX <= x0 + 810) world.flora.splice(k, 1);
  const canvas = PW.buildingTypes.population({ style: 'gothic', level: 1, variant: 'crown', seed: 7, facing: 1 });
  const owner = world.buildings.length + 1;
  const res = PW.foundations.place(world, canvas, x0 + 400 - Math.round((canvas.body.left + canvas.body.right) / 2), { style: 'gothic', owner });
  if (!res) return lone;
  lone = PW.buildingRecord(world, res.stamp, { id: owner, side: 'left', style: 'gothic', type: 'population', variant: 'crown', level: 1, facing: 1,
    neutral: false, underConstruction: false, works: res.works, base: { G: res.plan.G, walls: res.walls, under: res.under, cores: res.cores }, plant: null });
  world.buildings.push(lone);
  pwApp.stepWorld(120);
  return lone;
};
// (as 7 holds the supply lines: their steps stood down, and put back after)
const holdTowns = () => {
  const held = [world.repair, world.growth].filter((s) => s && s.step).map((s) => [s, s.step]);
  for (const [s] of held) s.step = () => {};
  if (pwApp.setDevelopSpeed) pwApp.setDevelopSpeed(0);
  return () => { for (const [s, step] of held) s.step = step; if (pwApp.setDevelopSpeed) pwApp.setDevelopSpeed(1); };
};

// 1. The same blast takes out far less rock than soil, and a town's made ground stands it nearly as
// well as rock. Test blocks of stone, soil and made ground are laid deep under the middle of the
// wild zones (below the reach of anything built), and each is blown up from its middle.
const holes = {};
// (where the sections below set things going - blasts, slides, heaps, drops - and how far round
// each the ground may still be moving: see 3)
const touched = [];
const blocks = [[M.STONE, 'stone'], [M.SOIL, 'soil'], [M.FILL, 'made ground']];
blocks.forEach(([kind, name], k) => {
  const zone = layout.wilds[k % layout.wilds.length];
  const bx = Math.round((zone.x0 + zone.x1) / 2) + (k >= layout.wilds.length ? 400 : 0), by = world.groundTop[bx] + 700;
  for (let y = by - 90; y <= by + 90; y += 1) for (let x = bx - 120; x <= bx + 120; x += 1) PW.set(world, x, y, kind, { quiet: true });
  pwApp.explode(bx, by, 48, 1.1);
  touched.push([bx, 600]);
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
// (a slide down a mountainside runs a long way: the whole mountain)
touched.push([fx, Math.max(1500, Math.round(m.half * 1.5))]);
for (const [dx, dy] of [[0, 0], [30, -10], [-25, 15], [10, -30], [45, 10]]) { pwApp.explode(fx + dx, fy + dy, 60, 1.35); pwApp.stepWorld(20); }
// (the flank is on the move - and ground far off, untouched, at rest: see stability.atRest)
const farX = fx > W / 2 ? 400 : W - 600, farY = world.groundTop[farX] + 200;
const movingAfter = !stability.atRest(fx - 120, fy - 400, fx + 160, fy + 120), restFar = stability.atRest(farX, farY, farX + 200, farY + 100);
pwApp.stepWorld(60 * 14);
// (and on until the ground there has settled - the looks the slide set off all done: a big slide's
// last ones come seconds after it; 30 s more at most)
for (let t = 0; t < 60 * 30 && stability.settling(fx - 120, fy - 400, fx + 160, fy + 120); t += 30) pwApp.stepWorld(30);
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
check((stability.stats.maxMs || 0) < 8, `looking for ground that lost its footing stays in budget (worst ${(stability.stats.maxMs || 0).toFixed(1)} ms, in its ${stability.stats.maxStage || "-"} stage; a hollow looked for at most ${(stability.stats.hollowMs || 0).toFixed(1)} ms, ${stability.stats.hollowN} cells, ${stability.stats.hollowOpen ? 'open' : 'shut'})`);
check(movingAfter && restFar, `what waits on a wreck to come to rest can ask (stability.atRest): the flank blown open is on the move (${movingAfter}), ground far off untouched is at rest (${restFar})`);

// 2b. The blast wave: a blast beside a glazed building shatters glass it does not touch, and the
// air goes still again within a few seconds; working it stays cheap.
{
  const glassOf = (b) => { let n = 0; for (let y = b.body.top; y <= b.ground; y += 1) for (let x = b.body.left; x <= b.body.right; x += 1) if ((PW.get(world, x, y) & 63) === M.GLASS) n += 1; return n; };
  // (the most glazed building with open air beside it, the blast's side: not a hill, a neighbour,
  // the slide's rubble against its wall - level with its lowest windows on that side, within 30 of
  // its face: over a tall gate hall, its first glazed storey)
  const lowGlass = (q, dir) => { for (let y = q.ground - 25; y >= q.body.top; y -= 1) for (let d = 0; d < 30; d += 1) if ((PW.get(world, dir > 0 ? q.body.right - d : q.body.left + d, y) & 63) === M.GLASS) return y; return -1; };
  const openSide = (q, dir) => { const gy = lowGlass(q, dir), x0 = dir > 0 ? q.body.right + 1 : q.body.left - 60; if (gy < 0) return false; for (let x = x0; x < x0 + 60; x += 1) for (const y of [gy, gy + 15]) if (PW.mat.open[PW.get(world, x, y) & 63] !== 1 || PW.getOwner(world, x, y)) return false; return true; };
  const [b, side] = world.buildings.map((q) => [q, glassOf(q)]).sort((a, c) => c[1] - a[1]).map(([q]) => [q, openSide(q, 1) ? 1 : openSide(q, -1) ? -1 : 0]).find(([, s]) => s) || [];
  const before = b ? glassOf(b) : 0, bx = b ? (side > 0 ? b.body.right + 40 : b.body.left - 40) : 0;
  if (b) pwApp.explode(bx, lowGlass(b, side), 30, 1.1);
  touched.push([bx, 600]);
  let worst = 0;
  for (let t = 0; t < 60; t += 1) { pwApp.stepWorld(1); worst = Math.max(worst, pwApp.air.stats.ms); }
  const broken = b ? before - glassOf(b) : 0;
  pwApp.stepWorld(60 * 4);
  check(broken > 5 && !pwApp.air.busy() && worst < 3, `a blast wave shatters a nearby building's glass (${b ? `${broken} of its ${before} panes' cells, 40 cells from the blast on its ${side > 0 ? 'right' : 'left'}` : 'no glazed building with open air beside it'}), and the air settles (${pwApp.air.stats.tiles} tiles still moving, worst step ${worst.toFixed(2)} ms)`);
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
  touched.push([sx, 1000], [rx, 600]);
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
    touched.push([lx, lake.half + 600]);
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
// to its few milliseconds a tick, so on a loaded machine the slide takes more ticks to run out.
// The ground looked at: the world over, its surface and 260 cells under it, but for the reach of
// each place the sections above set going - a slide off a great mountain may run on a while)
for (let s = 0; s < 75 && stability.busy(); s += 1) pwApp.stepWorld(60);
{
  // (natural ground only, and away from the towns: a town at work - building, mending, laying its
  // supply lines - moves its own made ground and buildings about; and its ground defences out in
  // front of it, the sandbag wall's seat levelled into the ground and the wire beyond, are its works)
  const works = (world.settlements || []).flatMap((s) => (s.defences || []).map((d) => d && d.span)).filter(Boolean);
  const near = (x) => touched.some(([tx, r]) => Math.abs(x - tx) < r)
    || (world.buildings || []).some((b) => x > b.body.left - 150 && x < b.body.right + 150)
    || works.some(([a, b]) => x > a - 60 && x < b + 60);
  const made = (k) => k >= M.CONCRETE && k <= M.COURSE;
  const cells = [], was = [];
  for (let x = 200; x < W - 200; x += 6) {
    if (near(x)) continue;
    const g0 = world.groundTop[x];
    for (let y = g0 - 40; y < g0 + 260; y += 2) { const k = id(x, y); if (PW.mat.phase[k] >= PW.PHASE.POWDER && !made(k)) { cells.push(y * W + x); was.push(k); } }
  }
  pwApp.stepWorld(60 * 5);
  // (broke loose: gone from where it was - the cell open now. A fire the tests set going may still
  // be burning its way along, grass to scorched soil, wood to ash: that is not ground coming down)
  let broke = 0;
  const where = new Map();
  for (let q = 0; q < cells.length; q += 1) {
    if (PW.mat.open[world.mat[cells[q]] & 63] !== 1) continue;
    broke += 1;
    const x = cells[q] % W, y = (cells[q] / W) | 0, at = Math.round(x / 100) * 100;
    const w = where.get(at) || where.set(at, { n: 0, mats: new Set(), dy: [] }).get(at);
    w.n += 1; w.mats.add(was[q]); w.dy.push(y - world.groundTop[x]);
  }
  const whereText = [...where].slice(0, 6).map(([x, w]) => `x~${x}: ${w.n} (mats ${[...w.mats].join('/')}, depth ${Math.min(...w.dy)}..${Math.max(...w.dy)})`).join('; ');
  check(broke === 0, `ground nobody disturbed stands (${broke} of ${cells.length} cells looked at, the world over away from the tests' blasts and drops, broke loose by themselves${broke ? `: ${whereText}` : ''})`);
}

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

// 4b. Tree debris (N85, the user's: heaps of it piled too high). A big blast in a stand of trees
// leaves a litter, not a heap: a cell of a tree's wood leaves a splinter by how thick it is there (a
// twig drawn a cell wide is mostly air), a trunk outside the blast's very heart comes down as logs -
// so the splinters on the ground are a few for each hundred cells of wood lost, lying low. A heap of
// splinters set alight burns down to a drift of ash; a litter of them lying out on the ground rots
// away, a cell at a time.
{
  const chipsAt = (x, y) => { const b = PW.get(world, x, y); return (b & 63) === M.DEBRIS && (b >> 6) === PW.DEBRIS_KIND.WOOD; };
  const woodAt = (x, y) => { const f = PW.getFlags(world, x, y); return PW.getLayer(world, 'deco', x, y) && (f & PW.FLAG.FLORA) && (f & (PW.FLAG.WOOD | PW.FLAG.CHARRED)); };
  const surf = (x, top) => { let y = top; while (y < top + 300 && PW.mat.phase[id(x, y)] < PW.PHASE.POWDER) y += 1; return y; };
  // (a stand of its own, planted for it on a stretch of the wilds laid level - six big trees, conifers
  // and broadleaves, close together: which stand the world grows where changes with it, and one of
  // birches or saplings, all twigs, is all splinters; level across the blast's reach - on a hillside
  // what is thrown down runs down it, and gathers at its foot)
  let stand = null;
  {
    let sx = -1;
    for (const z of layout.wilds || []) for (let x = z.x0 + 100; sx < 0 && x + 700 < z.x1; x += 50) sx = x;
    if (sx >= 0) {
      level(sx, sx + 600, () => 0);
      for (let k = (world.flora || []).length - 1; k >= 0; k -= 1) if (world.flora[k].anchorX >= sx - 10 && world.flora[k].anchorX <= sx + 610) world.flora.splice(k, 1);
      const cx = sx + 300;
      for (let k = 0; k < 6; k += 1) {
        const x = cx - 110 + k * 44;
        PW.flora.plant(world, ['conifer', 'broadleaf'][k & 1], x, { row: world.groundTop[x], size: 160 + (k % 3) * 25, seed: 5101 + k * 61 });
      }
      pwApp.stepWorld(30);
      stand = { n: 6, x: cx, g: world.groundTop[cx] };
    }
  }
  // (two flat stretches of open ground, away from the stand, for the burning heap and the litter)
  const flats = [];
  for (const z of layout.wilds) for (let x = z.x0 + 100; x + 80 < z.x1 - 100 && flats.length < 2; x += 40) {
    if (stand && Math.abs(x - stand.x) < 1000) continue;   // (out of reach of what the blast throws)
    if (flats.some((f) => Math.abs(f - x) < 500)) continue;
    let ok = true;
    for (let d = 0; d <= 80 && ok; d += 4) ok = Math.abs(world.groundTop[x + d] - world.groundTop[x]) <= 1 && PW.mat.terrain[id(x + d, world.groundTop[x + d])];
    if (ok) flats.push(x);
  }
  if (!stand || stand.n < 4 || flats.length < 2) check(false, `a stand of trees and two flats for the tree debris (${stand ? stand.n : 0} trees, ${flats.length} flats)`);
  else {
    const L = stand.x - 200, R = stand.x + 200, top = stand.g - 300;
    let wood0 = 0;
    for (let y = top; y < stand.g + 5; y += 1) for (let x = L; x <= R; x += 1) if (woodAt(x, y)) wood0 += 1;
    const s0 = []; for (let x = L; x <= R; x += 1) s0.push(surf(x, top));
    // (wood's debris lying in the ground there already - an old wreck's, a fallen tree's - is not the blast's)
    const splinterAt = (x, y) => { const b = PW.get(world, x, y); return ((b & 63) === M.DEBRIS || (b & 63) === M.RUBBLE) && (b >> 6) === PW.DEBRIS_KIND.WOOD; };
    let buried = 0;
    for (let x = L; x <= R; x += 1) for (let y = s0[x - L]; y < s0[x - L] + 30; y += 1) if (splinterAt(x, y)) buried += 1;
    pwApp.explode(stand.x, stand.g - 70, 90, 1.35);
    // (the heap of splinters set alight; the litter lying out)
    // (each laid bare and level well round it - the heap set alight caught the trees by it, and their
    // burnt wood came down in it)
    for (const f of flats) {
      level(f - 160, f + 240, () => 0);
      for (let k = (world.flora || []).length - 1; k >= 0; k -= 1) if (world.flora[k].anchorX >= f - 170 && world.flora[k].anchorX <= f + 250) world.flora.splice(k, 1);
    }
    const [hx, lx] = flats, hg = world.groundTop[hx + 40], lg = world.groundTop[lx + 40];
    let heap0 = 0, litter0 = 0;
    // (the heap on bare rock, nothing round it to burn but itself)
    for (let d = -40; d <= 40; d += 1) {
      for (let y = hg - 30; y < hg; y += 1) { PW.setLayer(world, 'deco', hx + 40 + d, y, 0); PW.setFlag(world, hx + 40 + d, y, PW.FLAG.FLORA | PW.FLAG.WOOD, false); }
      for (let y = hg; y <= hg + 3; y += 1) PW.set(world, hx + 40 + d, y, M.STONE, { quiet: true });
    }
    for (let d = -30; d <= 30; d += 1) for (let y = hg - 1; y >= hg - 15 + Math.round(Math.abs(d) / 2); y -= 1) { PW.set(world, hx + 40 + d, y, M.DEBRIS | PW.DEBRIS_KIND.WOOD << 6); heap0 += 1; }
    for (let d = -20; d <= 20; d += 1) for (let y = lg - 1; y >= lg - 3; y -= 1) { PW.set(world, lx + 40 + d, y, M.DEBRIS | PW.DEBRIS_KIND.WOOD << 6); litter0 += 1; }
    if (world.heatSystem) world.heatSystem.heatDisc(hx + 40, hg - 8, 22, 900);
    pwApp.stepWorld(60 * 25);
    // (the splinters lying, and the deepest they lie in any column - the blast's thrown earth aside)
    let wood1 = 0, splinters = 0, peak = 0, pile = 0;
    for (let y = top; y < stand.g + 5; y += 1) for (let x = L; x <= R; x += 1) if (woodAt(x, y)) wood1 += 1;
    for (let x = L; x <= R; x += 1) {
      const y0 = s0[x - L], y1 = surf(x, top);
      let here = 0;
      for (let y = y1; y < y0 + 30; y += 1) if (splinterAt(x, y)) here += 1;
      splinters += here;
      peak = Math.max(peak, here);
      if (Math.abs(y0 - stand.g) < 40) pile = Math.max(pile, y0 - y1);
    }
    let heap1 = 0, ash = 0, litter1 = 0;
    for (let y = hg - 40; y < hg + 3; y += 1) for (let x = hx; x <= hx + 80; x += 1) { if (chipsAt(x, y)) heap1 += 1; if (id(x, y) === M.ASH) ash += 1; }
    for (let y = lg - 6; y < lg + 2; y += 1) for (let x = lx; x <= lx + 80; x += 1) if (chipsAt(x, y)) litter1 += 1;
    await view('tree-litter', stand.x, stand.g - 40, 5);
    const lost = wood0 - wood1;
    splinters -= buried;
    check(lost > 4000 && splinters < lost * 0.08 && peak <= 16,
      `a big blast in a stand of ${stand.n} trees (at ${stand.x}, ${wood0} cells of wood) leaves a litter, not a heap: ${lost} cells of their wood gone, ${splinters} splinters lying (${(splinters / Math.max(1, lost) * 100).toFixed(1)} for each hundred; ${buried} lay in the ground there before), ${peak} deep at the deepest (all that lies over the old ground, the blast's earth too: ${pile} cells high at most)`);
    const burnt = heap0 - heap1;
    check(burnt >= 40 && ash <= burnt * 0.25 && litter1 < litter0,
      `a heap of ${heap0} splinters set alight burns down, layer by layer: ${burnt} of it burnt in 25 s, leaving ${ash} cells of ash (not a cell of ash for each); a litter of ${litter0} lying out rots away a cell at a time (${litter1} left after 25 s)`);
  }
}

putOut();

// (the tank's place for 6, found before the trees of 5 are felled - none of them by it: their wood
// and leaves still coming down into it after, the last of its water lay dammed on its floor)
const tankAt = (() => {
  const firm = (x) => { const k = id(x, world.groundTop[x]); return PW.mat.terrain[k] && PW.mat.phase[k] === PW.PHASE.SOLID; };
  for (const zone of layout.wilds) for (let x = zone.x0 + 100; x < zone.x1 - 600; x += 13) {
    let flat = true;
    for (let d = 0; d <= 420 && flat; d += 3) flat = firm(x + d) && Math.abs(world.groundTop[x + d] - world.groundTop[x]) <= 3;
    if (flat) return x;
  }
  return -1;
})();

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
  // (trees of its own, planted for it on a course of the wilds - four lots, each level then falling 80
  // cells over 200, a conifer and a broadleaf on each, one on the level and one on the slope: which
  // trees the world grows where changes with it, and a stand of birches or saplings bends and snaps
  // next to nothing; away from the tank of 6)
  const trees = [];
  let cx = -1;
  for (const z of layout.wilds || []) for (let x = z.x0 + 100; cx < 0 && x + 2700 < z.x1; x += 50) if (!(tankAt > 0 && x < tankAt + 900 && x + 2700 > tankAt - 300)) cx = x;
  if (cx >= 0) {
    level(cx, cx + 2600, (x) => { const u = (x - cx) % 650; return u < 300 ? 0 : u < 500 ? Math.round(80 * (u - 300) / 200) : 80; });
    for (let k = (world.flora || []).length - 1; k >= 0; k -= 1) if (world.flora[k].anchorX >= cx - 10 && world.flora[k].anchorX <= cx + 2610) world.flora.splice(k, 1);
    for (let k = 0; k < 8; k += 1) {
      const x = cx + (k >> 1) * 650 + (k & 1 ? 400 : 150);
      trees.push(PW.flora.plant(world, ['conifer', 'broadleaf'][(k + (k >> 1)) & 1], x, { row: world.groundTop[x], size: 180 + (k % 4) * 25, seed: 4201 + k * 97 }));
    }
    pwApp.stepWorld(30);
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
putOut();

// 5b. Plants sway in the wind (N9; drawn by the renderer's leaf pass): a standing tree's leaves
// sway, the higher the more, its wood not at all; in calm air nothing moves, in a wind the leaves
// lean the way it blows.
{
  // (a big tree with leaves, out in the wind: of the first dozen, the one whose crown's top sways most
  // - one in a sheltered hollow, or a dead tree, barely stirs)
  const crownSway = (r) => { let a = 0; for (let y = r.y; y < r.y + r.height * 0.3; y += 2) for (let x = r.x; x < r.x + r.width; x += 2) { const f = PW.getFlags(world, x, y); if ((f & PW.FLAG.FLORA) && !(f & PW.FLAG.WOOD)) a += PW.flora.leafSway(world, x, y) >> 8; } return a; };
  const tree = (world.flora || []).filter((r) => r.kind === 'tree' && !r.fallen && !r.felled && r.size > 90 && r.type !== 'deadTree').slice(0, 12)
    .map((r) => [r, crownSway(r)]).sort((a, b) => b[1] - a[1]).map(([r]) => r)[0];
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
  const x0 = tankAt;
  if (x0 < 0) check(false, 'a flat stretch of the wilds 420 wide for the tank');
  else {
    const tops = Array.from({ length: 421 }, (_, d) => world.groundTop[x0 + d]), g = Math.min(...tops);
    const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); if (m === M.AIR) PW.setLayer(world, 'deco', x, y, 0); } };
    fill(x0, g - 300, x0 + 420, g - 1, M.AIR);
    // (down to the ground as it was: the ground line moves up with the stone laid; and its floor
    // stone right across, five deep - not the grass and loose earth it stood on, nor a cave under it)
    for (let x = x0; x <= x0 + 420; x += 1) for (let y = g; y <= Math.max(tops[x - x0], g + 4); y += 1) if (id(x, y) === M.AIR || y <= g + 4) PW.set(world, x, y, M.STONE, { quiet: true });
    const tx0 = x0 + 10, tx1 = x0 + 79, ty0 = g - 280, ty1 = g - 221;
    fill(tx0 - 3, ty0 - 3, tx0 - 1, ty1 + 4, M.STONE); fill(tx1 + 1, ty0 - 3, tx1 + 3, ty1 + 4, M.STONE); fill(tx0 - 3, ty1 + 1, tx1 + 3, ty1 + 4, M.STONE);
    fill(tx0 + 10, ty1 + 5, tx0 + 40, g - 1, M.STONE);
    fill(x0 + 417, g - 50, x0 + 420, g - 1, M.STONE);
    fill(x0, g - 50, x0 + 3, g - 1, M.STONE);   // (walled at its other end too: the ground past it may fall away)
    // (counted over the course and a little round it: a pond or a stream nearby is not the tank's)
    const P = pwApp.particles, water = () => waterIn(x0 - 60, g - 310, x0 + 480, g + 2) + P.airWater(x0 - 60, g - 310, x0 + 480, g + 2);
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
    // (where any went: under the basin's floor, past its ends)
    const lost = water() === water0 ? '' : `; under the floor ${waterIn(x0 - 60, g + 3, x0 + 480, g + 160)}, left of it ${waterIn(x0 - 400, g - 310, x0 - 61, g + 160)}, right ${waterIn(x0 + 481, g - 310, x0 + 820, g + 160)}, drops anywhere ${P.airWater()}, the floor's tops ${[0, 100, 200, 300, 400].map((d) => world.groundTop[x0 + d] - g).join('/')}`;
    check(water() === water0, `the falling water is all kept (${water0} -> ${water()}${lost})`);
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
  // (the town's supply lines held still the while: what they bring up out of the ground and let
  // out, or draw off, is not the water let go)
  const pipeStep = pwApp.pipes && pwApp.pipes.step;
  if (pipeStep) pwApp.pipes.step = () => {};
  // (and the towns' growth and works: a bridge laid over a lake meanwhile - see pw-capital-growth - or
  // the water a farm draws for its fields is not it either)
  const release = holdTowns();
  if (T) {
    const box = { x0: T.body.left - 300, x1: T.body.right + 300 };
    // (the world's water, steam and drops in flight: a box round the tower is crossed by the town's
    // streams and run-off - see the flood above, counted the same way)
    const P = pwApp.particles, water = () => pwApp.countWater() + P.airWater();
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
    // (the floor its stairs come down to - in a tower over a raised gate hall, N121's, the slab over
    // the hall, which drains into it by its ladder's hatch: water spread over it has come all the way
    // down the stairwell)
    let foot = T.ground;
    for (let y = S.sy1 - 6; y < T.ground; y += 1) {
      let closed = 0;
      for (let x = T.body.left + 2; x <= T.body.right - 2; x += 1) if (!openAt(x, y) && id(x, y) !== M.WATER) closed += 1;
      if (closed >= (T.body.right - T.body.left - 3) * 0.5) { foot = y; break; }
    }
    const betweenEnd = Math.min(ceiling, foot - 3);
    // (what is left where it was let go, and on the storeys between; the rest has gone down to the
    // ground storey - and on from there, out of its door - as none is lost: see the next check)
    const top0 = wetIn(py1 - 20, roofBase), between0 = wetIn(roofBase + 1, betweenEnd);
    let placed = 0;
    // (into the open space over its hatch, column by column, up to 14 deep - not onto an ornament
    // standing on the roof, a lantern, a finial, a railing: what is poured on their ledges they keep,
    // as any roof does)
    for (let x = px0; x <= px1; x += 1) {
      let floor = py1;
      if (hy >= 0) { floor = -1; for (let y = py1; y <= roofBase; y += 1) if (PW.getFlags(world, x, y) & (PW.FLAG.HATCH || 0)) { floor = y; break; } }
      if (floor < 0) continue;
      for (let y = floor - 1; y >= floor - 14 && id(x, y) === M.AIR; y -= 1) { PW.set(world, x, y, M.WATER); placed += 1; }
    }
    const water0 = water();
    PW.wakeArea(world, S.sx0 - 10, S.sy0 - 20, S.sx1 + 10, T.ground);
    // (the new world's towers stand on tall gate halls - N121 - their stairs near 300 cells: given 16 s)
    pwApp.stepWorld(60 * 16);
    for (let s = 0; s < 10 && P.airWater(); s += 1) pwApp.stepWorld(60);
    const top = wetIn(py1 - 20, roofBase) - top0, between = wetIn(roofBase + 1, betweenEnd) - between0, down = placed - top - between;
    await view('stairwell-water', (S.sx0 + S.sx1) / 2, S.sy0 + 40, 5);
    // (a roof's gutters, and the pockets between its ornaments, keep a little)
    // (a puddle may stand on a storey's floor away from its opening: the storey over a raised gate
    // hall - N121's - drains into the hall by its ladder's hatch, not a flight of stairs)
    check(placed >= 100 && down >= placed * 0.6 && between <= placed * 0.3, `water let go ${hy >= 0 ? `on a tower's roof over its drain hatch (${hx1 - hx0 + 1} wide)` : 'over a tower\'s stairs'} goes down the stairwell to its ground floor (${placed} cells let go, stairs ${S.sy1 - S.sy0} tall: ${down} went down to the foot of its stairs${betweenEnd < ceiling ? ' - the slab over its gate hall' : ''}, ${between} left on the storeys between, ${top} on the roof where it was let go)`);
    check(water() === water0, `the water going down the stairwell is all kept (${water0} -> ${water()} in the world, the town's supply lines held still)`);
  } else check(false, 'a standing tower with stairs to pour water down');
  if (pipeStep) pwApp.pipes.step = pipeStep;
  release();
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
    const tops = Array.from({ length: 821 }, (_, d) => world.groundTop[x0 + d]), g = Math.min(...tops);
    const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); if (m === M.AIR) PW.setLayer(world, 'deco', x, y, 0); } };
    fill(x0, g - 80, x0 + 820, g - 1, M.AIR);
    // (down to the ground as it was: the ground line moves up with the stone laid)
    for (let x = x0; x <= x0 + 820; x += 1) for (let y = g; y <= tops[x - x0]; y += 1) if (id(x, y) === M.AIR) PW.set(world, x, y, M.STONE, { quiet: true });
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
// (last: what is new to the world is looked at after what was there - the sections before it run
// on the world as it was)
// 9. N98, the user's: a building's vents let the gas inside it out. Smoke under a tower's roof,
// under a vent in it (the flag on the roof's top cell, as the repair crews lay it - see pw-repair's
// vents), goes up through the roof, however thick, and out into the open over it.
{
  const VENT = PW.FLAG.VENT || 0;
  const release = holdTowns();
  // (a roof near the tower's middle where a vent goes - as the repair crews place them, see pw-repair's
  // vents: its own top cell with open air over it - thin, over a room: not over a shaft or a pier
  // solid all the way down)
  let b = null, x = -1, top = -1, under = -1;
  for (const q of [loneTower()].filter((q) => q && q.ground - q.body.top > 120)) {
    const roofAt = (c) => { let y = q.body.top - 2; while (y < q.ground && !(PW.getOwner(world, c, y) === q.id && !PW.mat.open[id(c, y)])) y += 1; return y; };
    for (let d = 0; d < (q.body.right - q.body.left) * 2 - 8 && !b; d += 1) {
      const c = Math.round((q.body.left + q.body.right) / 2) + (d & 1 ? -1 : 1) * (d >> 1), t = roofAt(c);
      let u = t;
      while (u < q.ground && !PW.mat.open[id(c, u)]) u += 1;
      let room = 0;
      for (let y = u; y < u + 4; y += 1) for (let xx = c - 4; xx <= c + 4; xx += 1) if (PW.mat.open[id(xx, y)] && id(xx, y) !== M.WATER) room += 1;
      if (PW.mat.open[id(c, t - 1)] && PW.mat.open[id(c, t - 2)] && u - t <= 12 && room >= 30) { b = q; x = c; top = t; under = u; }
    }
    if (b) break;
  }
  if (!b || !VENT) { release(); check(false, `a standing tower to vent (${VENT ? 'none with a thin roof over a room' : 'no FLAG.VENT'})`); }
  else {
    const key = top * W + x, had = world.vents && world.vents.has(key);
    PW.setFlag(world, x, top, VENT, true);
    (world.vents || (world.vents = new Map())).set(key, b.id);
    // (smoke - thick - filling the room's top under it, 9 across and 4 down)
    let laid = 0;
    for (let y = under; y < under + 4; y += 1) for (let xx = x - 4; xx <= x + 4; xx += 1) if (PW.mat.open[id(xx, y)] && id(xx, y) !== M.WATER) { PW.set(world, xx, y, M.SMOKE | 3 << 6); laid += 1; }
    const vented0 = pwApp.sim.stats.vented || 0;
    const colAt = () => { const o = []; for (let y = top - 2; y <= under + 4; y += 1) o.push(`${y - top}:${id(x, y)}${PW.getFlags(world, x, y) & VENT ? 'V' : ''}`); return o.join(' '); };
    const col0 = colAt();
    // (the most of it over the roof at once - out, it rises, drifts and thins away)
    let over = 0;
    for (let t = 0; t < 60 * 3; t += 1) {
      pwApp.stepWorld(1);
      if (t % 6) continue;
      let n = 0;
      for (let y = top - 60; y < top; y += 1) for (let xx = x - 30; xx <= x + 30; xx += 1) if (id(xx, y) === M.SMOKE) n += 1;
      over = Math.max(over, n);
    }
    const vented = (pwApp.sim.stats.vented || 0) - vented0;
    await view('n98-vent-out', x, top, 6);
    if (!had) { PW.setFlag(world, x, top, VENT, false); world.vents.delete(key); }
    release();
    check(laid >= 20 && vented >= 10 && over > 0, `smoke under a tower's roof ${under - top} cells thick, under a vent in it, goes out through it (${laid} cells of it laid, ${vented} let out by the vent, ${over} over the roof at the most${vented ? '' : ` - tower ${b.id} at ${x}, its column ${col0}, ${world.vents.size} vents`})`);
  }
}

// 10. Cleared out (the user's, 2026-11-24: debris is pushed out of the inside of a fully built
// building): loose stone and sand poured on a storey's floor up a standing tower are carried out of
// it, as one carrying them walks - along the floors, down its stairs over their treads (the user's,
// 2026-11-25: over them, not through them), through the hatch over its gate hall, past the hall's
// piers, out by its door - and set down outside it, off the doorway; none of it is lost, and what
// slides back in at its door is carried out again.
{
  // (finished: whole, no site, nothing of it being built - see pw-structure's clearOut - and kept so
  // while it is cleared: the crews mending it took what lay in it for their building)
  const release = holdTowns();
  const towers = [loneTower()].filter((b) => b && b.ground - b.body.top > 150 && (b.health === undefined || b.health >= 1) && !b.ruined && !b.site && !b.siteWanted
    && !(PW.isGrowing && PW.isGrowing(world, b)));
  // (a storey's floor in it, 110 to 200 cells up - a flight of stairs or two and, over a gate hall, its ladder's hatch
  // under it: a run of its own open cells 24 wide, its floor under it)
  let T = null, fx = -1, fy = -1;
  for (const b of towers) {
    for (let y = Math.max(b.body.top + 20, b.ground - 200); y < b.ground - 110 && fx < 0; y += 1) {
      let run = 0;
      for (let x = b.body.left + 2; x < b.body.right - 2; x += 1) {
        const ok = PW.getOwner(world, x, y) === b.id && PW.mat.open[id(x, y)] && PW.getOwner(world, x, y + 1) === b.id && !PW.mat.open[id(x, y + 1)] && id(x, y + 1) !== M.PLATFORM;
        run = ok ? run + 1 : 0;
        if (run >= 24) { fx = x - 23; fy = y; break; }
      }
    }
    if (fx >= 0) { T = b; break; }
  }
  if (!T) { release(); check(false, 'a standing tower with a storey floor to pour debris on'); }
  else {
    // (what is poured: loose stone and sand - told from the debris lying round the town, which may slide in at its doors)
    const loose = (k) => k === M.LOOSE_STONE || k === M.SAND;
    const x0 = T.body.left - 300, x1 = T.body.right + 300, y0 = T.body.top - 60, y1 = T.ground + 60;
    // (loose cells round it - and gravel: loose stone come to rest on the ground packs into it, see
    // pw-sim's compact; in it: its own, within its body - not its forecourt's)
    const count = () => { let n = 0; for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) { const k = id(x, y); if (loose(k) || k === M.GRAVEL) n += 1; } return n; };
    const inside = () => { let n = 0; for (let y = T.body.top; y <= T.ground; y += 1) for (let x = T.body.left; x <= T.body.right; x += 1) if (loose(id(x, y)) && PW.getOwner(world, x, y) === T.id) n += 1; return n; };
    const all0 = count(), in0 = inside();
    // (a heap on the floor: loose stone under, sand over it - 24 across, 6 high - as a blow inside it would
    // leave it: the building told of it, and looked over at once)
    let poured = 0;
    for (let y = fy; y > fy - 6; y -= 1) for (let x = fx; x < fx + 24; x += 1) if (PW.mat.open[id(x, y)]) { PW.set(world, x, y, y > fy - 3 ? M.LOOSE_STONE : M.SAND); poured += 1; }
    pwApp.structure.notify(T.id);
    const S = pwApp.structure && pwApp.structure.stats, sim = pwApp.sim.stats, out0 = sim.carriedOut || 0;
    // (carried out - two minutes at most: what is in a tower with one way out of it goes by that one, its whole round down its stairs and out of its door; and, 3 s on, what has slid back in at its door - a doorway lower
    // than the ground before it is a hollow what is set out slides into - carried out again at its
    // next look, 12 s at most)
    // (and carried down its stairs over their treads - the user's, 2026-11-25: over them, not through
    // them - so seen lying on a tread on its way down, and never under a flight it has not gone round)
    const ROLE = PW.buildingKit.ROLE, roleAt = (x, y) => { const c = T.canvas, cx = x - T.ox, cy = y - T.oy; return cx >= 0 && cy >= 0 && cx < c.width && cy <= c.ground ? c.role[cy * c.width + cx] : -1; };
    let onTreads = 0;
    let clearMax = 0, gone = -1;
    for (let t = 0; t < 60 * 120 && gone < 0; t += 1) {
      pwApp.stepWorld(1);
      clearMax = Math.max(clearMax, (S && S.clearMs) || 0);
      if (t % 30 === 0 && inside() - in0 <= 0) gone = t;
      if (t % 15 === 0) {
        let n = 0;
        for (let y = T.body.top; y < T.ground; y += 1) for (let x = T.body.left; x <= T.body.right; x += 1) if (loose(id(x, y)) && roleAt(x, y + 1) === ROLE.STAIR) n += 1;
        onTreads = Math.max(onTreads, n);
      }
    }
    pwApp.stepWorld(60 * 3);
    const back = Math.max(0, inside() - in0);
    for (let t = 0; t < 60 * 12 && inside() - in0 > 0; t += 30) pwApp.stepWorld(30);
    const left = inside() - in0, kept = count() - all0;
    release();
    await view('cleared-out', (T.body.left + T.body.right) / 2, T.ground - 60, 4);
    // (how the tower's clearing stands, should it not have gone)
    const C = T.clear, why = left > 0 ? ` - its clearing ${C ? `${C.phase}, ${C.found.length} found, ${C.dist.filter((d) => d === 0).length} cells by its openings` : 'never begun'}; ${PW.isGrowing && PW.isGrowing(world, T) ? 'growing' : 'not growing'}, health ${T.health ?? 1}${T.site ? ', a site' : ''}${T.clearStuck !== undefined ? `, let be stuck with ${T.clearStuck} in it` : ''}` : '';
    check(poured >= 120 && gone >= 0 && left <= 0 && kept >= poured * 0.97 && clearMax < 1 && onTreads > 0,
      `loose stone and sand poured on a storey's floor up a tower (${poured} cells, ${T.ground - fy} cells up) are carried out of it (${gone >= 0 ? `all out in ${(gone / 60).toFixed(1)} s` : 'not all out in 120 s'}${back ? `, ${back} slid back in at its door 3 s on${left > 0 ? ` and ${left} still in it 12 s later` : ' and carried out again'}` : ''}${why}; ${(sim.carriedOut || 0) - out0} cells set out of buildings meanwhile; carried down its stairs over their treads, up to ${onTreads} cells seen lying on them at once) and lie outside it, none lost (${kept} of them round it), the clearing ${clearMax.toFixed(2)} ms a tick at most, its round of the buildings ${S && S.clearRound ? (S.clearRound / 60).toFixed(1) + ' s' : '-'}`);
  }
}

pwApp.setPaused(false);
return { checks, shots: shots.length, holes, stability: stability.stats };
