// A building's base (N151; run with --page=pixel-world.html --params=det=1&seed=N): the legs of a raised
// stage carry the building - a timber kake-zukuri stage, a gothic undercroft's piers, modern pilotis - and
// it falls when they are blown (the user's, 2026-11-27). The world's own buildings on raised bases stand
// as built. On a hillside carved in the wilds each style's tower is built on its stage - its floor at the
// shelf, all of it over the fall, on legs as tall as its style builds them: it stands; one of its legs
// blown, it stands; every one of them blown, it comes down off them, over the way the hill falls. (Where
// the floor is let into the hill, the body on its plinth and only the stage's end on a leg, that leg
// blown, the stage's end hangs over a little: it stands, as it should.) And the old finding: a tower all
// over the fall, every leg cut through, held by what stood uphill of it as a cantilever 115 cells long -
// it falls too.
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
pwApp.setPaused(true);
const id = (x, y) => PW.get(world, x, y) & 63;
const S = pwApp.structure;
const under = (b) => (b.failed || []).filter((f) => f.under);
const fell = (b) => under(b).map((f) => `${f.reason}${f.dir > 0 ? '>' : '<'}`).join(' ') || 'none';

// 1. The world's own: every building on a raised base printed as built, and standing 20 s on - none of
// them given way under its deck.
{
  pwApp.stepWorld(60 * 20);
  const raised = world.buildings.filter((b) => b && b.base && b.base.under && b.body);
  const printed = raised.filter((b) => b.basePrint && b.basePrint.n > 0);
  const gave = raised.filter((b) => under(b).length);
  check(raised.length > 0 && printed.length === raised.length && gave.length === 0,
    `the world's ${raised.length} buildings on raised bases are printed as built (${printed.length}) and stand on them (${gave.length} gave way under the deck${gave.length ? `: ${gave.map((b) => `${b.id} ${fell(b)}`).join(', ')}` : ''})`);
}

// (a hillside in the wilds, apart from the last: `n` lots each 800 wide - a shelf 260 wide, then a fall
// of `drop` over `run`)
const used = [];
function hillside(n, drop, run) {
  let x0 = -1;
  for (const z of layout.wilds || []) for (let x = z.x0 + 100; x0 < 0 && x + n * 800 + 100 < z.x1; x += 200) {
    if (!used.some(([a, b]) => x < b + 300 && x + n * 800 > a - 300)) x0 = x;
  }
  if (x0 < 0) return null;
  used.push([x0, x0 + n * 800]);
  let base = Infinity; for (let x = x0; x < x0 + n * 800; x += 1) base = Math.min(base, world.groundTop[x]);
  const surf = (x) => { const u = (x - x0) % 800; return base + (u < 260 ? 0 : u < 260 + run ? Math.round(drop * (u - 260) / run) : drop); };
  for (let x = x0; x < x0 + n * 800; x += 1) {
    const s = surf(x);
    for (let y = base - 500; y < s; y += 1) { PW.set(world, x, y, M.AIR, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); }
    for (let y = s; y < s + 60; y += 1) PW.set(world, x, y, y < s + 4 ? M.SOIL : M.STONE, { quiet: true });
  }
  PW.rebuildGroundTop(world);
  return x0;
}
// (each style's tower placed by the foundations, its floor at the shelf and all of it over the fall - on
// its stage, the legs as tall as its style builds them; `tall`: the old finding's, supports to 240 - and
// registered as a building)
function towers(x0, styles, tall) {
  const ST = PW.foundations.STYLE, out = [];
  styles.forEach((style, k) => {
    const keep = { supportMax: ST[style].supportMax, bias: ST[style].bias };
    ST[style].bias = 0.05;
    if (tall) ST[style].supportMax = 240;
    const canvas = PW.buildingTypes.population({ style, level: 3, variant: 'slab', seed: 11 + k, facing: 1 });
    const lip = x0 + k * 800 + 260;
    const worldX = lip + 10 - canvas.body.left;
    const owner = world.buildings.length + 1;
    const res = PW.foundations.place(world, canvas, worldX, { style, owner });
    ST[style].supportMax = keep.supportMax; ST[style].bias = keep.bias;
    if (!res) return;
    const rec = PW.buildingRecord(world, res.stamp, { id: owner, side: 'left', style, type: 'population', variant: 'slab', level: 3, facing: 1,
      neutral: false, underConstruction: false, works: res.works, base: { G: res.plan.G, walls: res.walls, under: res.under, cores: res.cores }, plant: null });
    world.buildings.push(rec);
    out.push({ style, rec, plan: res.plan });
  });
  PW.rebuildGroundTop(world);
  return out;
}
// (its legs: columns under its floor where the ground is 30 or more lower, nine tenths its structure)
function legs(L) {
  const cols = [];
  for (let x = L.plan.x0 - 30; x <= L.plan.x1 + 30; x += 1) {
    const g = L.plan.natural(x); if (g - L.plan.G < 30) continue;
    let run = 0; for (let y = L.plan.G + 8; y < g; y += 1) if (PW.getOwner(world, x, y) === L.rec.id && PW.mat.structural[id(x, y)]) run += 1;
    if (run > (g - L.plan.G - 8) * 0.9) cols.push(x);
  }
  const groups = []; for (const x of cols) { const g = groups[groups.length - 1]; if (g && x - g[g.length - 1] <= 2) g.push(x); else groups.push([x]); }
  return groups;
}
const blow = (L, g) => { const px = g[g.length >> 1]; pwApp.explode(px, Math.round((L.plan.G + L.plan.natural(px)) / 2), 7, 1.0); };
const health = (L) => L.rec.health ?? 1;

// 2-4. Each style's tower on its stage: it stands; one leg blown, it stands; every leg blown, it comes
// down off them, over the way the hill falls (or straight down into its footprint).
{
  const x0 = hillside(3, 120, 160);
  if (x0 === null) check(false, 'a stretch of the wilds 2600 wide for the hillside');
  else {
    const lots = towers(x0, ['asian', 'gothic', 'modern'], false);
    pwApp.stepWorld(60 * 2);
    for (const L of lots) { L.legs = legs(L); L.P = L.rec.basePrint; }
    pwApp.stepWorld(60 * 30);
    const desc = (L) => `${L.style} ${L.legs.length} legs, ${L.P ? L.P.n : 0} columns bearing down to +${L.P ? L.P.deep - L.plan.G : 0}`;
    check(lots.length === 3 && lots.every((L) => L.legs.length >= 2 && L.P && L.P.n > 0 && health(L) === 1 && !under(L.rec).length),
      `each style's tower stands on its stage over the hillside, 30 s, whole (${lots.map(desc).join('; ')})`);
    for (const L of lots) await view(`base-legs-${L.style}-standing`, (L.plan.x0 + L.plan.x1) / 2, L.plan.G + 30, 5);
    for (const L of lots) blow(L, L.legs[L.legs.length >> 1]);
    pwApp.stepWorld(60 * 20);
    check(lots.every((L) => !under(L.rec).length && health(L) > 0.8),
      `one leg blown, each stands on the rest (${lots.map((L) => `${L.style} health ${health(L).toFixed(2)}, ${fell(L.rec)}`).join('; ')})`);
    for (const L of lots) L.legs.forEach((g, n) => { if (n !== L.legs.length >> 1) blow(L, g); });
    pwApp.stepWorld(60 * 3);
    for (const L of lots) await view(`base-legs-${L.style}-falling`, (L.plan.x0 + L.plan.x1) / 2, L.plan.G + 30, 5);
    pwApp.stepWorld(60 * 27);
    check(lots.every((L) => under(L.rec).some((f) => f.reason === 'pancake' || f.dir > 0) && health(L) < 0.25),
      `every leg blown, each comes down off them - over the way the hill falls, or into its footprint - and lies in ruins (${lots.map((L) => `${L.style} ${fell(L.rec)}, health ${health(L).toFixed(2)}`).join('; ')})`);
    for (const L of lots) await view(`base-legs-${L.style}-down`, (L.plan.x0 + L.plan.x1) / 2, L.plan.G + 60, 5);
  }
}

// 5. The old finding: a tower all over the fall on supports up to 240 tall, every one of them cut through
// 40 under its floor - held by what stood uphill of it, 115 cells out, it stood whole. Now it falls.
{
  const x0 = hillside(1, 260, 200);
  if (x0 === null) check(false, 'a stretch of the wilds 1000 wide for the tall stage');
  else {
    const [L] = towers(x0, ['modern'], true);
    pwApp.stepWorld(60 * 10);
    const whole = health(L) === 1 && !under(L.rec).length;
    let cut = 0;
    for (let y = L.plan.G + 40; y < L.plan.G + 50; y += 1) for (let x = L.plan.x0 - 40; x <= L.plan.x1 + 40; x += 1) if (PW.getOwner(world, x, y) === L.rec.id && PW.mat.structural[id(x, y)]) { PW.set(world, x, y, M.AIR); cut += 1; }
    S.notify(L.rec.id, true);
    pwApp.stepWorld(60 * 30);
    check(whole && cut > 100 && under(L.rec).length && health(L) < 0.25,
      `a tower over the fall on supports to 240, every one cut through (${cut} cells), comes down off them (${fell(L.rec)}, health ${health(L).toFixed(2)}) - it stood whole before`);
    await view('base-legs-tall-down', (L.plan.x0 + L.plan.x1) / 2, L.plan.G + 100, 6);
  }
}
pwApp.setPaused(false);
return { checks, shots: shots.length };
