// N155 + N163 (the user's, 2026-11-25/27) - every main military building a watch tower on a
// multi-winged base, drawn real (the refs: war-photo compounds, the coastal and the British towers):
// laid out from its spawn core under the vehicle hall's pad; a tower 12-18 m (13.9 cells a metre) with
// a ladder from its foot to the cab; smaller on a mountain; its own tunnel from the tower's foot; a
// perimeter of T-walls and a gate flagged FENCE, the faction's emblem at the gate; a militarised
// population building given a garage beside it, the building itself cell for cell as it was; a road
// tunnel through dressed with the spawn core rig. (pixel-world, det=1; growth eight times as fast)
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world, layout } = pwApp;
const eng = world.capitalGrowth, T = PW.buildingTypes, M = PW.M;
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
world.buildSpeed = 8;
if (world.stock && world.stock.left) { world.stock.left.hm = 1e6; world.stock.left.sm = 1e5; }
const secs = (s) => { for (let k = 0; k < s; k += 1) pwApp.stepWorld(60); };
const built = (c) => { const r = world.buildings[c.main.owner - 1]; return r && !r.underConstruction; };
const CELLS_M = 13.9;

// 1. The designs: every faction, every level, the four main variants - a watch tower base.
const bad = [], heights = [];
for (const style of ['modern', 'gothic', 'asian']) for (const variant of PW.MILITARY_VARIANTS) for (const level of [1, 3, 5]) {
  const c = T.military({ style, level, variant, seed: 3 + level, facing: level & 1 ? 1 : -1 });
  const w = c.watch;
  if (!w) { bad.push(`${style} ${variant} L${level} no tower`); continue; }
  const m = (c.ground - w.cabTop) / CELLS_M;
  heights.push(m);
  if (m < 12 || m > 18.2) bad.push(`${style} ${variant} L${level} ${m.toFixed(1)} m`);
  if (!c.pad || c.pad.x1 - c.pad.x0 + 1 !== 140 || !c.hangar) bad.push(`${style} ${variant} L${level} no pad in a hall`);
  const core = c.cores.find((k) => k.vault && Math.abs(k.x - (c.pad.x0 + c.pad.x1) / 2) <= 2);
  if (!core) bad.push(`${style} ${variant} L${level} no core under the pad`);
  const lad = (c.ladders || []).find((l) => l.y0 <= w.cabFloor && l.y1 >= c.ground - 1);
  if (!lad) bad.push(`${style} ${variant} L${level} no ladder foot to cab`);
  if (c.hangar.bottom - c.hangar.top + 1 < 100) bad.push(`${style} ${variant} L${level} hall ${c.hangar.bottom - c.hangar.top + 1} clear`);
  if (variant !== c.meta.variant) bad.push(`${style} ${variant} L${level} variant ${c.meta.variant}`);
  if (!c.devices.length || !c.panels.length) bad.push(`${style} ${variant} L${level} ${c.devices.length} guns ${c.panels.length} panels`);
}
check(!bad.length, `every main base a watch tower 12-18 m on a winged base, its pad over the core in the hall, a ladder foot to cab, guns and a panel (${heights.length} designs, ${Math.min(...heights).toFixed(1)}-${Math.max(...heights).toFixed(1)} m${bad.length ? `: ${bad.slice(0, 4).join('; ')}` : ''})`);
// (smaller on a mountain)
{
  const flat = T.military({ style: 'modern', level: 4, variant: 'compound', seed: 9, facing: 1 });
  const high = T.military({ style: 'modern', level: 4, variant: 'compound', seed: 9, facing: 1, setting: 'mountain' });
  const hf = flat.ground - flat.watch.cabTop, hh = high.ground - high.watch.cabTop;
  const wf = flat.body.right - flat.body.left, wh = high.body.right - high.body.left;
  check(hh < hf && wh < wf, `smaller on a mountain (tower ${(hh / CELLS_M).toFixed(1)} m against ${(hf / CELLS_M).toFixed(1)}, ${wh} wide against ${wf})`);
}
// (the hangar standing apart: a flat roof, its door and its turrets to the front)
{
  const hb = [];
  for (const facing of [1, -1]) for (const style of ['modern', 'gothic', 'asian']) {
    const c = T.military({ style, level: 3, variant: 'hangar', seed: 4, facing });
    const roofRows = new Set();
    for (let x = c.body.left; x <= c.body.right; x += 1) {
      let y = 0; while (y < c.ground && c.role[y * c.width + x] !== PW.buildingKit.ROLE.ROOF) y += 1;
      if (y < c.ground) roofRows.add(y);
    }
    const mid = (c.body.left + c.body.right) / 2, front = (x) => (x - mid) * facing > 0;
    if (!c.hangar || roofRows.size !== 1) hb.push(`${style} ${facing}: roof rows ${roofRows.size}`);
    if (!front(c.hangar.door.x) || !c.devices.length || !c.devices.every((d) => front(d.x))) hb.push(`${style} ${facing}: door or guns not in front`);
  }
  check(!hb.length, `the hangar: one flat roof, its door and turrets at the front, either facing (${hb.join('; ') || '6 designs'})`);
}
// (a militarised population building: a garage beside it, the building cell for cell as it was)
{
  let changed = 0, total = 0, garages = 0;
  for (const style of ['modern', 'gothic', 'asian']) for (const side of [-1, 1, 0]) {
    const opts = { style, level: 4, variant: 'slab', seed: 21, facing: 1 };
    const src = T.population(opts), c = PW.militaryGarage(T.population(opts), style, side);
    const padL = c.meta.garagePad;
    for (let y = 0; y < src.height; y += 1) for (let x = 0; x < src.width; x += 1) {
      const i = y * src.width + x;
      if (!src.mat[i] && !src.back[i]) continue;
      total += 1;
      const j = y * c.width + x + padL;
      if (c.mat[j] !== src.mat[i] || c.paint[j] !== src.paint[i] || c.back[j] !== src.back[i]) changed += 1;
    }
    if (c.meta.garage && c.hangar && c.doors.length > src.doors.length && c.devices.length > src.devices.length) garages += 1;
  }
  check(changed === 0 && garages === 9, `a militarised building gets a garage (door out, a gun on its roof) and stays as it was (${garages} of 9 garages; ${changed} of ${total} of its cells changed)`);
}

// 2. In the world: a military seed's base - its perimeter, its gate's emblem, its tunnel from the tower's foot.
let base = null;
eng.manual = true;   // (as in a match: its levels bought - it stays at its first while its tunnel begins)
for (let k = 0; k < 24 && !base; k += 1) {
  const x = Math.round(layout.sites[0].x1 + 1400 + k * 160);
  const r = eng.drop(x, 'military', 'modern', 'left');
  if (r && r.city && r.city.setting !== 'mountain') base = r.city;
}
check(!!base, `a military seed takes on open ground (${base ? `at ${base.x}` : 'none'})`);
if (base) {
  for (let s = 0; s < 150 && !built(base); s += 1) secs(1);
  secs(40);
  const rec = world.buildings[base.main.owner - 1];
  check(!!(rec && rec.canvas && rec.canvas.watch), `its main building is a watch tower base (${rec && rec.canvas && rec.canvas.meta.variant})`);
  const fences = Object.values(base.fences || {}).filter(Boolean);
  const flagged = fences.reduce((a, f) => a + f.cells.filter(([x, y]) => PW.getFlags(world, x, y) & PW.FLAG.FENCE).length, 0);
  const cells = fences.reduce((a, f) => a + f.cells.length, 0);
  const gate = fences.find((f) => !f.wall), wall = fences.find((f) => f.wall);
  check(fences.length >= 1 && cells > 0 && flagged === cells, `its perimeter's cells are flagged FENCE (${flagged} of ${cells}; ${wall ? 'a T-wall' : 'no T-wall'}, ${gate ? 'a gate' : 'no gate'})`);
  if (gate) check(gate.dress.length > 200, `the gate dressed: posts, the boom, the emblem plate, chain-link and wire (${gate.dress.length} cells)`);
  if (rec) await view('n155-base', (rec.body.left + rec.body.right) / 2, rec.ground - 110, 3);
  if (gate) await view('n155-gate', gate.x, world.groundTop[gate.x] - 20, 7);
  if (wall) await view('n155-twall', wall.x, world.groundTop[wall.x] - 15, 7);
  for (let s = 0; s < 90 && !(base.shaft && base.shaft.y > base.shaft.top + 60); s += 1) secs(1);
  const sh = base.shaft, w = rec && rec.canvas && rec.canvas.watch;
  const sx = w && [rec.ox + w.shaft[0], rec.ox + w.shaft[1]];
  check(!!sh && sx && sh.x >= sx[0] && sh.x <= sx[1] && sh.y > sh.top + 40 && sh.level <= 2,
    `it digs its own tunnel from the foot of its tower, begun at its first levels (${sh ? `shaft at ${sh.x}, ${sh.y - sh.top} down, begun at level ${sh.level}; the tower ${sx}` : 'no shaft'})`);
  if (sh) await view('n155-tower-shaft', sh.x, sh.top + 10, 4);
  // (levelled up, the tower stands where it stood: its tunnel still goes down under it)
  eng.manual = false;
  for (let s = 0; s < 160 && !(base.level >= 3 && built(base)); s += 1) secs(1);
  const rec2 = world.buildings[base.main.owner - 1], w2 = rec2 && rec2.canvas && rec2.canvas.watch;
  const sx2 = w2 && [rec2.ox + w2.shaft[0], rec2.ox + w2.shaft[1]];
  check(!!sh && sx2 && base.level >= 3 && sh.x >= sx2[0] && sh.x <= sx2[1], `levelled up (to ${base.level}) the tower stands where it stood, over its tunnel (the tower ${sx2}, the shaft ${sh && sh.x})`);
  const hangar = [...base.rings.left, ...base.rings.right].find((l) => l.variant === 'hangar' && l.placed);
  info(`base level ${base.level}, posts ${[...base.rings.left, ...base.rings.right].map((l) => l.variant).join(' ')}`);
  if (hangar) await view('n155-hangar', (hangar.placed.worksL + hangar.placed.worksR) / 2, world.groundTop[Math.round(hangar.x)] - 60, 3);
}

// 3. A road tunnel through: the spawn rig parked in it. (where this world has one; the road tunnel's
// own suite, pw-road-tunnel, bores one and checks its rig)
const through = (world.roadTunnels || []).filter((t) => t.done);
const rigged = through.filter((t) => t.rig);
info(`road tunnels through ${through.length}, rigged ${rigged.length}`);
if (through.length) {
  check(rigged.length >= 1, `a road tunnel through is dressed with the spawn core rig (${rigged.length} of ${through.length})`);
  const t = rigged[0];
  if (t) {
    let n = 0;
    for (let x = t.rig.x0; x <= t.rig.x1; x += 1) for (let y = t.floorAt(x) - 50; y < t.floorAt(x); y += 1) if (PW.getFlags(world, x, y) & PW.FLAG.FIXTURE) n += 1;
    check(n > 1200, `the rig is on the wall, kept by the lining crews (${n} fixture cells)`);
    await view('n155-rig', (t.rig.x0 + t.rig.x1) / 2, t.floorAt(t.rig.x0) - 40, 6);
  }
}
return { checks, shots };
