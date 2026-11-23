// Rubble weathers into the land (N100; run with --page=pixel-world.html --params=det=1&seed=N): a heap
// of rubble lying out on the soil turns, a cell at a time from its surface down, to dirt - topsoil
// at the top, soil under it - leaving one lump in four of what it was, gone dark, in it: in some
// minutes it is a mound of dirt with the ruin showing through, its shape as it was. A heap on a
// street, one where a ruined building is being rebuilt (its crews take it, and a core coming up
// shoulders rubble aside where dirt would hold it), and one against a supply line's bore stay rubble.
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 6; t += 1) await sleep(80); shots.push(await shot(name)); };
pwApp.setPaused(true);
const life = world.lifeGame;
const id = (x, y) => PW.get(world, x, y) & PW.ID_MASK;
const fill = (a, b, c, d, m) => { for (let y = b; y <= d; y += 1) for (let x = a; x <= c; x += 1) { PW.set(world, x, y, m, { quiet: true }); PW.setLayer(world, 'deco', x, y, 0); PW.setLayer(world, 'back', x, y, 0); PW.setLayer(world, 'paint', x, y, 0); PW.setOwner(world, x, y, 0); PW.setFlag(world, x, y, PW.FLAG.ROAD, false); } };
// (a stretch of the wilds: cleared above, soil under - and a heap of rubble 60 across, 12 high, on what is given)
const used = [];
function site(len) {
  for (const zone of layout.wilds) for (let x = zone.x0 + 60; x + len < zone.x1 - 60; x += 40) {
    if (used.some(([a, b]) => x < b + 60 && x + len > a - 60)) continue;
    const tops = Array.from({ length: len + 1 }, (_, d) => world.groundTop[x + d]);
    const g = Math.min(...tops);
    if (Math.max(...tops) - g > 40) continue;
    used.push([x, x + len]);
    fill(x, g - 120, x + len, g - 1, M.AIR);
    fill(x, g, x + len, g + 30, M.SOIL);
    return { x0: x, g };
  }
  return null;
}
const BRICK = PW.abgr(150, 84, 62), CONC = PW.abgr(150, 150, 146);
function heap(x0, g, base) {
  if (base !== undefined) fill(x0, g, x0 + 60, g + 3, base);
  const cells = [];
  for (let x = x0; x <= x0 + 60; x += 1) {
    const h = Math.round(12 - Math.abs(x - x0 - 30) * 0.38);
    for (let y = g - h; y < g; y += 1) {
      // (brick and concrete rubble - its kind in the variant bits; no wood: splinters rot instead)
      const brick = PW.hash2(x, y) & 1;
      PW.set(world, x, y, M.RUBBLE | (brick ? PW.DEBRIS_KIND.BRICK : PW.DEBRIS_KIND.CONCRETE) << 6, { quiet: true });
      PW.setLayer(world, 'paint', x, y, brick ? BRICK : CONC);
      cells.push([x, y]);
    }
  }
  PW.rebuildGroundTop(world);
  return cells;
}
const count = (cells, test) => cells.filter(([x, y]) => test(x, y)).length;
const S = site(800);
if (!S) check(false, 'a stretch of the wilds for the heaps');
else {
  const { x0, g } = S;
  const open = heap(x0 + 20, g);
  const street = heap(x0 + 120, g, M.ASPHALT);
  const lot = heap(x0 + 220, g);
  const bored = heap(x0 + 320, g);
  // (a ruined building being rebuilt beside the third, and a supply line under the fourth)
  const b = { id: 9001, body: { left: x0 + 300 - 96 - 10, right: x0 + 300 - 96 - 4, top: g - 60, bottom: g }, ground: g, ruined: true };
  world.buildings.push(b);
  for (let x = x0 + 318; x <= x0 + 384; x += 1) PW.set(world, x, g, M.PIPE, { quiet: true });
  const tops0 = Array.from({ length: 400 }, (_, d) => world.groundTop[x0 + d]);
  await view('weather-before', x0 + 200, g - 10, 6);
  // (some minutes of the land's slow pass)
  const t0 = performance.now();
  life.advance(60 * 300);
  const ms = (performance.now() - t0) / (60 * 300);
  world.buildings.splice(world.buildings.indexOf(b), 1);
  await view('weather-after', x0 + 200, g - 10, 6);
  const dirt = (x, y) => id(x, y) === M.SOIL || id(x, y) === M.TOPSOIL || id(x, y) === M.GRASS;
  const rubble = (x, y) => id(x, y) === M.RUBBLE;
  const dark = (x, y) => { const p = PW.getLayer(world, 'paint', x, y); return rubble(x, y) && p && p !== BRICK && p !== CONC; };
  // (the heap within reach of the weather: its top WEATHER_DEPTH cells)
  const reach = open.filter(([x, y]) => y - world.groundTop[x] < 8);
  const nDirt = count(reach, dirt), nLumps = count(reach, rubble), nDark = count(reach, dark);
  const shape = Array.from({ length: 400 }, (_, d) => world.groundTop[x0 + d]).every((y, d) => y === tops0[d]);
  check(nDirt >= reach.length * 0.6 && nLumps >= reach.length * 0.12 && nLumps <= reach.length * 0.35 && nDark >= nLumps * 0.5 && shape,
    `a heap of rubble out on the soil weathers into it in 5 minutes: of the ${reach.length} cells within reach of the weather ${nDirt} are dirt, ${nLumps} lumps of rubble left in it (${nDark} gone dark), its shape as it was (${shape})`);
  const kept = (cells) => count(cells, rubble) === cells.length;
  check(kept(street) && kept(lot) && count(bored.filter(([x, y]) => y >= g - 2), rubble) === bored.filter(([x, y]) => y >= g - 2).length,
    `rubble stays rubble on a street (${count(street, rubble)} of ${street.length}), where a ruined building is being rebuilt (${count(lot, rubble)} of ${lot.length}), and against a supply line's bore (${count(bored.filter(([x, y]) => y >= g - 2), rubble)} of the ${bored.filter(([x, y]) => y >= g - 2).length} over it)`);
  check(ms < 0.5, `the land's slow pass costs little, weathering and all: ${ms.toFixed(3)} ms a tick`);
}
pwApp.setPaused(false);
return { checks, shots: shots.length, weathered: life.stats.weatheredRubble || 0 };
