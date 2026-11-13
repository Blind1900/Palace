// Grounding and cover check (run with --page=pixel-world.html --params=seed=N).
// Plants, rocks, props and structure bases must touch the ground they stand on (no gaps), nothing
// is drawn over terrain, and cover props stop shots while units can walk through them.
const { world, layout, particles } = pwApp;
const { M } = PW;
const { phase, terrain, passable } = PW.mat;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 10; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const W = world.width;
const id = (x, y) => PW.get(world, x, y) & 63;
const solid = (x, y) => phase[id(x, y)] >= PW.PHASE.POWDER;

// 1. Every plant's foot rests on the ground.
const flora = world.flora || [];
const floating = {};
let worstPlant = null;
for (const record of flora) {
  if (!record.foot) continue;
  let lost = 0;
  for (let k = 0; k < record.foot.length; k += 1) {
    const y = record.foot[k];
    if (y >= 0 && !solid(record.footX0 + k, y + 1)) lost += 1;
  }
  if (lost) { floating[record.type] = (floating[record.type] || 0) + lost; if (!worstPlant || lost > worstPlant.lost) worstPlant = { ...record, lost }; }
}
const kinds = flora.reduce((m, r) => (m[r.type] = (m[r.type] || 0) + 1, m), {});
check(Object.keys(floating).length === 0, `every plant foot touches the ground (${flora.length} plants ${JSON.stringify(kinds)}; floating columns ${JSON.stringify(floating)})`);
check((kinds.broadleaf || 0) + (kinds.conifer || 0) + (kinds.birch || 0) + (kinds.deadTree || 0) >= 15, `wild trees grow across the world (${(kinds.broadleaf || 0) + (kinds.conifer || 0) + (kinds.birch || 0) + (kinds.deadTree || 0)})`);

// 2. Nothing is drawn over terrain.
let decoOnTerrain = 0, decoCells = 0;
const buriedAt = [];
for (let c = 0; c < world.chunkCount; c += 1) {
  const chunk = world.deco[c];
  if (!chunk) continue;
  const cx = (c % world.chunksX) << PW.CHUNK_SHIFT, cy = ((c / world.chunksX) | 0) << PW.CHUNK_SHIFT;
  for (let i = 0; i < chunk.length; i += 1) {
    if (!chunk[i]) continue;
    decoCells += 1;
    const x = cx + (i & PW.CHUNK_MASK), y = cy + (i >> PW.CHUNK_SHIFT);
    if (terrain[id(x, y)]) { decoOnTerrain += 1; if (buriedAt.length < 4) buriedAt.push(`${x},${y}:${PW.mat.names[id(x, y)]}#${(chunk[i] & 0xffffff).toString(16)}`); }
  }
}
check(decoOnTerrain === 0, `no deco cell lies on terrain (${decoOnTerrain} of ${decoCells}${buriedAt.length ? ' e.g. ' + buriedAt.join(' ') : ''})`);

// 3. Props: supported, sized as cover, passable, and they stop shots.
const props = world.props || [];
const bySetting = props.reduce((m, r) => (m[`${r.setting}:${r.kind}`] = (m[`${r.setting}:${r.kind}`] || 0) + 1, m), {});
let unsupported = 0;
const loose = [];
for (const record of props) {
  let n = 0;
  for (const index of record.support) if (phase[world.mat[index] & 63] < PW.PHASE.POWDER) n += 1;
  if (n) loose.push(`${record.setting}:${record.kind}@${record.x0},${record.y0} ${n}/${record.support.length} (${[...record.support].filter((i) => phase[world.mat[i] & 63] < PW.PHASE.POWDER).slice(0, 3).map((i) => PW.mat.names[world.mat[i] & 63] + '@' + (i % W) + ',' + ((i / W) | 0)).join(' ')})`);
  unsupported += n;
}
check(unsupported === 0, `every prop rests on (or hangs from) solid ground (${props.length} props ${JSON.stringify(bySetting)}; ${unsupported} unsupported columns)`);
const mineProps = props.filter((r) => r.setting === 'mine' || r.setting === 'storage');
const shortest = Math.min(...mineProps.map((r) => r.y1 - r.y0 + 1));
check(mineProps.length >= 6 && shortest >= 11, `mines hold cover tall enough to hide a crouched trooper (${mineProps.length} props, shortest ${shortest} cells vs crouch 9)`);
// Formations need a cave section at least 22 cells high (a trooper is 25).
const roomy = (layout.caves || []).some((cave) => cave.points.some((p) => p.r >= 12));
check(!roomy || props.filter((r) => r.setting === 'cave').length >= 1, `caves hold stalagmites, stalactites and boulders (${props.filter((r) => r.setting === 'cave').length}; roomy caves ${roomy})`);
check(props.filter((r) => r.setting === 'surface').length >= 2, `big surface boulders are cover (${props.filter((r) => r.setting === 'surface').length})`);
let impassable = 0;
for (const record of props) for (const index of record.cells) if (!passable[world.mat[index] & 63]) impassable += 1;
check(impassable === 0, `units can walk through every cover cell (${impassable} blocking cells)`);
const target = mineProps.find((r) => r.kind === 'mineCar') || mineProps[0];
const floorRow = target.y1 + 1;
const crouchShot = PW.traceShot(world, target.x0 - 30, floorRow - 5, target.x1 + 30, floorRow - 5);
const headShot = PW.traceShot(world, target.x0 - 30, target.y0 - 3, target.x1 + 30, target.y0 - 3);
check(!!crouchShot && PW.props.COVER[crouchShot.id] === 1, `a shot at crouch height stops in the ${target.kind} (${crouchShot ? PW.mat.names[crouchShot.id] : 'nothing'} at ${crouchShot ? crouchShot.x - target.x0 : '-'})`);
const targetCells = new Set(target.cells);
check(!headShot || !targetCells.has(headShot.y * W + headShot.x), `a shot over the top of the ${target.kind} is not stopped by it (${headShot ? `${PW.mat.names[headShot.id]} beyond it` : 'clear'})`);

// 4. Structure bases: pump plinths and intakes, fields, defences.
for (const b of world.buildings.filter((item) => item.pump)) {
  const pump = b.pump;
  let gaps = 0;
  const gapAt = [];
  for (let x = pump.left; x <= pump.right; x += 1) {
    let y = pump.y;
    while (id(x, y) === M.FOUNDATION && y < pump.y + 400) y += 1;
    if (y === pump.y || !solid(x, y)) { gaps += 1; if (gapAt.length < 3) gapAt.push(`${x},${y}:${PW.mat.names[id(x, y)]}`); }   // the plinth must reach solid ground with no gap
  }
  if (gapAt.length) checks.push(`  pump ${b.id} plinth ends at ${gapAt.join(' ')} (floor ${pump.y})`);
  let pipeGaps = 0;
  const [s0, s1] = pump.span;
  for (let x = s0; x <= s1; x += 1) {
    let lowest = -1;
    for (let y = pump.y - 30; y < pump.y + 400; y += 1) if (id(x, y) === M.PIPE) lowest = y;
    if (lowest >= 0 && !solid(x, lowest + 1)) pipeGaps += 1;
  }
  check(gaps === 0 && pipeGaps === 0, `pump house ${b.id} stands on a plinth to the ground and its intake lies on the bank and bed (plinth gaps ${gaps}, pipe gaps ${pipeGaps})`);
}
for (const b of world.buildings.filter((item) => item.field)) {
  let bad = 0;
  for (let x = b.field.x0; x <= b.field.x1; x += 1) if (id(x, b.field.y) !== M.TOPSOIL) bad += 1;
  check(bad === 0, `field of farm ${b.id} is all soil, none over water (${bad} bad columns)`);
}
for (const s of world.settlements) {
  for (const line of s.defences || []) {
    const feet = line.hedgehogs.flatMap((h) => h.feet);
    const loose = feet.filter(([x, y]) => !solid(x, y + 1)).length + line.wire.filter(([x, y]) => !solid(x, y + 1)).length;
    const onRunway = s.runway && line.span[0] < Math.max(s.runway.from, s.runway.to) && line.span[1] > Math.min(s.runway.from, s.runway.to);
    check(!!line.cover && loose === 0 && !onRunway, `${s.side} defence line: sandbag cover placed, hedgehog feet and wire on the ground (${loose} loose), clear of the runway`);
  }
}

// 5. Screenshots.
if (worstPlant) await view('gr-worst-plant', worstPlant.anchorX, worstPlant.row - 10, 8);
const pick = (type) => flora.filter((r) => r.type === type).map((r) => ({ r, s: Math.abs(world.groundTop[r.anchorX + 14] - world.groundTop[r.anchorX - 14]) })).sort((a, b) => b.s - a.s)[0];
for (const type of ['broadleaf', 'conifer', 'bush', 'reeds']) {
  const p = pick(type);
  if (p) await view(`gr-${type}`, p.r.anchorX, p.r.row - (type === 'bush' || type === 'reeds' ? 10 : 40), type === 'bush' || type === 'reeds' ? 8 : 6);
}
const rock = props.filter((r) => r.setting === 'surface').sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0))[0];
if (rock) await view('gr-surface-boulder', (rock.x0 + rock.x1) / 2, (rock.y0 + rock.y1) / 2, 8);
const pumped = world.buildings.find((b) => b.pump);
if (pumped) await view('gr-pump', pumped.pump.x + (pumped.pump.intakeX - pumped.pump.x) / 2, pumped.pump.y, 6);
const front = world.settlements.find((s) => !s.style || s.side !== 'neutral');
if (front && front.defences[0]) await view('gr-defence', (front.defences[0].span[0] + front.defences[0].span[1]) / 2, front.defences[0].cover.y0, 6);
const core = world.buildings.find((b) => b.type === 'core' && b.mine);
if (core) {
  const d = core.mine.drift;
  await view('gr-mine-drift', (d.x0 + d.x1) / 2, d.bottom - 20, 6);
  await view('gr-mine-storage', (core.mine.storage.x0 + core.mine.storage.x1) / 2, core.mine.storage.bottom - 20, 6);
}
const cave = props.filter((r) => r.setting === 'cave' && r.kind === 'stalagmite')[0];
if (cave) await view('gr-cave', cave.x0, cave.y0, 6);

// 6. A blast at a tree's foot fells the whole tree; a blast at a prop breaks it.
const tree = flora.filter((r) => r.kind === 'tree' && r.trunk).sort((a, b) => b.height - a.height)[2];
if (tree) {
  const sprite = PW.flora.regenerate(tree);
  const left = tree.anchorX - sprite.anchorX, top = tree.row - sprite.anchorY;
  const count = () => { let n = 0; for (let sy = 0; sy < sprite.height; sy += 1) for (let sx = 0; sx < sprite.width; sx += 1) { const c = sprite.pixels[sy * sprite.width + sx]; if (c && PW.getLayer(world, 'deco', left + sx, top + sy) === c) n += 1; } return n; };
  const before = count();
  pwApp.explode(tree.anchorX, tree.row + 6, 34, 1.2);
  const after = count();
  check(!world.flora.includes(tree) && after < before * 0.02, `a blast at a tree's foot fells it, no canopy left floating (${before} -> ${after} cells)`);
  pwApp.stepWorld(90);
  await view('gr-felled', tree.anchorX, tree.row - 40, 5);
}
const victim = mineProps.find((r) => r !== target) || mineProps[0];
if (victim) {
  pwApp.explode((victim.x0 + victim.x1) / 2, victim.y1 - 3, 16, 1);
  const left = Array.from(victim.cells).filter((index) => PW.props.COVER[world.mat[index] & 63]).length;
  check(!world.props.includes(victim) && left === 0, `a blast breaks a ${victim.kind} completely (${left} cells left)`);
}
pwApp.setPaused(false);
return { checks, shots: shots.length, loose, vegetation: world.vegetationStats, defenceIssues: world.defenceIssues || [],
  mines: world.buildings.filter((b) => b.mine || b.workings).map((b) => { const w = b.mine || b.workings; return { id: b.id, drift: w.drift && [w.drift.x0, w.drift.x1], shaft: w.shaft && w.shaft.x, props: (w.props || []).length }; }),
  worstPlant: worstPlant && { type: worstPlant.type, x: worstPlant.anchorX, row: worstPlant.row, lost: worstPlant.lost }, timings: pwApp.timings };
