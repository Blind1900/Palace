// N136 (the user's, 2026-11-24): two or three more lakes by the map's size; underground lakes that work
// as the surface lakes do; farms that grow nothing without water - a well drilled to an underground
// lake; bridges that are the world's - raised from both banks by two mini cores, left standing when
// their town falls, mended by any town beside them with no level asked. (pixel-world, det=1)
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world, layout } = pwApp;
const eng = world.capitalGrowth, M = PW.M;
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const secs = (s) => { for (let k = 0; k < s; k += 1) pwApp.stepWorld(60); };
const id = (x, y) => PW.get(world, x, y) & 63;

// 1. The lakes: the end ponds, the centre's (when it is a lake), and two or three more.
const added = layout.lakes.filter((l) => l.added);
const want = world.width >= 44000 ? 3 : 2;
check(added.length >= want - 1 && added.length <= want, `${added.length} more lakes on a map ${world.width} wide (wanted ${want}): ${added.map((l) => `${l.x} (${l.half * 2} across)`).join(', ')}`);
for (const l of added.slice(0, 1)) await view('n136-added-lake', l.x, world.groundTop[Math.round(l.x)] - 40, 2);

// 2. Underground lakes: water to a flat surface under a rock roof, three or more.
const aq = layout.aquifers || [];
const sound = aq.filter((a) => {
  let water = 0, loose = 0;
  for (let x = a.x0 + 10; x <= a.x1 - 10; x += 6) {
    if (id(x, a.level + 2) === M.WATER) water += 1;
    // (open over its roof - a town's gallery dug over the rock that seals it is no breach)
    if ((id(x, a.roof - 6) === M.AIR || id(x, a.roof - 6) === M.WATER) && !(PW.getFlags(world, x, a.roof - 6) & PW.FLAG.TUNNEL)) loose += 1;
  }
  return water > 5 && loose === 0;
});
check(aq.length >= 3 && sound.length === aq.length, `${aq.length} underground lakes, each water to a flat surface under a rock roof (${sound.length} sound): ${aq.map((a) => `${a.x} at ${a.roof}..${a.bottom}`).join(', ')}`);
if (aq[0]) await view('n136-underground-lake', aq[0].x, (aq[0].roof + aq[0].bottom) / 2, 3);

// 3. A farm grows nothing without water: it drills its well, and only then do its fields yield.
const farms = world.buildings.filter((b) => b && b.type === 'farm' && b.body && !b.dismantled);
secs(2);
const wells = world.wells || new Map();
const drilling = farms.filter((b) => (wells.get(b.id) || {}).by === 'well');
info(`farms: ${farms.map((b) => `#${b.id} ${(wells.get(b.id) || {}).by || '-'}${b.dry ? ' dry' : ''}`).join(', ')}`);
const f = drilling[0];
check(!!f && f.dry, `a farm with no lake by it stands dry while its well is drilled (${f ? `#${f.id}` : 'none drilling'})`);
for (let s = 0; s < 240 && f && !(wells.get(f.id) || {}).done; s += 1) secs(1);
const w = f && wells.get(f.id);
secs(2);
check(!!w && w.done && !f.dry, `its well reaches the underground lake and the farm has water (${w ? `${w.x}, down to ${w.to}${w.done ? '' : ', still drilling'}` : '-'})`);
if (w) await view('n136-well', w.x, (w.to + world.groundTop[w.x]) / 2, 3);
if (w && w.done) {
  // a cut in the line between the well and the cores dries it again
  const line = (world.pipes.lineNear || world.pipes.lineFor)(f.faction ?? f.side ?? 'neutral', w.x);
  // (where the casing is out in the ground between them - under a building's floor it sleeves
  // through the works, and a blast there may not reach it)
  const span = [];
  for (let x = Math.min(w.x, line.coreX) + 20; x <= Math.max(w.x, line.coreX) - 20; x += 4) if ((PW.get(world, x, line.ys[x - line.x0] + 2) & 63) === M.PIPE) span.push(x);
  // (and well clear of the cores' beds, where the bundle runs through their vaults' steel)
  const clearOf = (x) => Math.min(...line.cores.map((c) => Math.abs(c.x - x)));
  span.sort((a, b) => clearOf(b) - clearOf(a));
  const cx = span.length ? span[0] : Math.round((w.x + line.coreX) / 2), cy = line.ys[cx - line.x0] + 2;
  pwApp.explode(cx, cy, 18, 1);
  secs(2);
  check(f.dry, `a cut in the line dries the farm again (${f.dry ? 'dry' : 'still watered'})`);
}

// 4. Bridges: raised from both banks by two mini cores; left when their town falls; mended with no level.
const lake = added[0];
if (lake) {
  const bank = Math.round(lake.x - lake.half - 360);
  const r = eng.drop(bank, 'capital', 'modern', 'left');
  const city = r && r.city;
  if (city) {
    const water0 = pwApp.countWater();
    while (city.level < 5) eng._levelUp(city);
    for (let s = 0; s < 300 && !(world.bridgeWorks || []).some((br) => br.x0 < lake.x && br.x1 > lake.x); s += 1) secs(1);
    const br = (world.bridgeWorks || []).find((q) => q.x0 < lake.x && q.x1 > lake.x);
    check(!!br && br.cores.length === 2, `a town reaching the lake starts a bridge with a mini core on each bank (${br ? `${br.x0}..${br.x1}` : 'none'})`);
    if (br) {
      for (let s = 0; s < 240 && !br.built; s += 1) secs(1);
      check(br.built, `its mini cores lay the deck out from both banks till it stands (${br.laid.filter(Boolean).length}/${br.laid.length} columns)`);
      // (PS's find, 2026-11-25: the old deck write deleted the lake cells it was laid into)
      secs(4);
      check(pwApp.countWater() >= water0 - 60, `the legs push the lake's water aside, never delete it (${water0} -> ${pwApp.countWater()} water cells)`);
      await view('n136-bridge', (br.x0 + br.x1) / 2, br.y - 30, 3);
      // the town falls: the bridge stays
      city.fallen = true;
      secs(5);
      check(br.built && !br.broken, 'its town fallen, the bridge still stands');
      // blown: broken - and a new seed beside it mends it without the level a bridge asks
      const mid = Math.round((br.x0 + br.x1) / 2);
      pwApp.explode(mid, br.y + 1, 18, 1);
      // (watched through the next seconds: a town still stands near it, and its mini cores may
      // already have it mended again by the time a slow look comes round)
      let broke = false;
      for (let t = 0; t < 18 && !broke; t += 1) { pwApp.stepWorld(10); if (br.broken || !br.built) broke = true; }
      check(broke, `a blast breaks it (${broke ? 'broken' : 'still whole'})`);
      const r2 = eng.drop(bank - 200, 'capital', 'modern', 'right');
      const c2 = r2 && r2.city;
      for (let s = 0; s < 240 && !br.built; s += 1) secs(1);
      check(!!c2 && c2.level < 5 && br.built, `a new town beside it - level ${c2 ? c2.level : '-'}, under a bridge's level - has its mini cores mend it (${br.built ? 'standing' : 'still broken'})`);
      await view('n136-bridge-mended', mid, br.y - 30, 3);
    }
  } else info(`no seed took by the lake (${r && r.note})`);
}
return { checks, shots };
