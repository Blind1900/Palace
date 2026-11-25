// Mining operations, conveyors and supply pipelines (run with --page=pixel-world.html --params=seed=N).
const { world, layout, pipes } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const ops = world.miningOps;
const W = world.width;

// 1. Operations at the starter and neutral mines, with miners, belts and pipelines.
check(ops.filter((o) => o.side === 'left').length >= 1 && ops.filter((o) => o.side === 'right').length >= 1 && ops.length >= 4,
  `mining operations at both starter mines and the neutral mines (${ops.map((o) => `${o.side}:${o.node.tier}`).join(', ')})`);
// N12F: at most two miners harvest any one body - exactly one two-man operation per node.
check(ops.every((o) => o.miners.length === 2), 'each operation has its crew of two miners (N12F)');
check(new Set(ops.map((o) => o.node)).size === ops.length, 'no ore body is worked by more than one operation (N12F)');
for (const side of ['left', 'right']) {
  const hm = pipes.lineFor(side, 'hm');
  const op = ops.find((o) => o.side === side);
  check(!!hm && hm.risers.some((r) => r.x === op.riser.x), `${side}'s bundle has a riser down to its mine's hopper`);
  // The bundle runs under the ground, never through the open sky (crossing a shaft, a gallery or
  // a core's bed on a back wall or in a sleeve is fine).
  let exposed = 0;
  for (let x = hm.x0; x <= hm.x1; x += 7) {
    if (hm.cores.some((c) => Math.abs(x - c.x) < 14)) continue;
    for (let r = 0; r < 5; r += 1) {
      const y = hm.ys[x - hm.x0] + r;
      if ((PW.get(world, x, y) & 63) !== M.AIR) continue;
      if (PW.getFlags(world, x, y) & PW.FLAG.TUNNEL) continue;
      if (PW.getLayer(world, 'back', x, y) || PW.getLayer(world, 'pipe', x, y)) continue;
      exposed += 1; break;
    }
  }
  check(exposed === 0, `${side}'s bundle runs underground all the way (${exposed} exposed samples)`);
}
const water = pwApp.countWater();
// Long enough for the first loads to ride the longest belt to its hopper (16 cells a second).
const longestBelt = Math.max(...ops.map((o) => Math.abs(o.belt.head - o.belt.tail)));
pwApp.stepWorld(60 * Math.round(Math.max(20, longestBelt / 16 + 14)));
// (a crew still driving its drift through barren rock gets a little longer to reach the vein)
for (let t = 0; t < 8 && ops.some((o) => o.side === 'neutral' && o.stored === 0); t += 1) pwApp.stepWorld(60 * 5);
for (const op of ops) {
  if (op.side === 'neutral') check(op.mined > 0 && op.stored > 0 && op.heap.length > 0, `neutral ${op.node.tier}: miners mine ore into the storage room (${op.mined} cells mined, ${op.stored} HM stored, ${op.heap.length} heap cells)`);
  else check(op.mined > 0 && op.delivered > 0 && op.stored === 0, `${op.side} starter mine: ore goes up the belt into the HM pipeline (${op.mined} mined, ${op.delivered} HM delivered)`);
}
check(pwApp.countWater() === water, `pumps measure their lakes but never drain them (${water} -> ${pwApp.countWater()} water cells)`);
const left = ops.find((o) => o.side === 'left');
await view('mn-left-op', (left.room.x0 + left.room.x1) / 2, left.floor - 22, 7);
const neutral = ops.find((o) => o.side === 'neutral' && o.heap.length);
if (neutral) await view('mn-neutral-storage', (neutral.storage.x0 + neutral.storage.x1) / 2, neutral.floor - 22, 6);
const core = world.buildings.find((b) => b.type === 'core' && b.side === 'left');
await view('mn-pipes', (core.body.left + core.body.right) / 2 + 200, core.ground + 30, 4);

// 2. Cut the HM line between the mine and the core: ore goes to storage; the crew re-lays the line
// around the crater and the stored ore is hauled back to the hopper.
const hm = pipes.lineFor('left', 'hm');
const cutX = Math.round((left.riser.x + hm.coreX) / 2);
const cutY = hm.ys[cutX - hm.x0] + 2;
pwApp.explode(cutX, cutY, 14, 1);
pwApp.stepWorld(60);
const brokenNow = [...hm.broken].filter(Boolean).length;
check(brokenNow > 0 && !pipes.flowing(hm, left.riser.x), `a blast cuts the HM line (${brokenNow} columns broken)`);
const storedBefore = left.stored, deliveredBefore = left.delivered;
// (until the next load comes down the belt to the hopper: a long drift's belt takes a while)
for (let s = 0; s < 20 && left.stored <= storedBefore; s += 1) pwApp.stepWorld(60);
check(left.stored > storedBefore, `while the line is cut, the mine stores its ore (${storedBefore} -> ${left.stored} HM stored)`);
await view('mn-cut', cutX, cutY, 5);
// (the ends grow back over the crater at the line's own pace: a deeper cut in rolling ground - N133 -
// takes the better part of two minutes)
for (let s = 0; s < 120 && [...hm.broken].some(Boolean); s += 1) pwApp.stepWorld(60);
check(![...hm.broken].some(Boolean) && pipes.stats.repairHM > 0, `the crew re-lays the line around the crater (${pipes.stats.repaired} cells, ${pipes.stats.repairHM} HM)`);
await view('mn-repaired', cutX, cutY, 5);
const storedPeak = left.stored;
pwApp.stepWorld(60 * 25);
check(left.stored < storedPeak && left.delivered > deliveredBefore, `once the line flows again, stored ore is hauled back to the hopper (${storedPeak} -> ${left.stored} stored, ${deliveredBefore} -> ${left.delivered} delivered)`);

// 3. Planning a dig: a tunnel that would reach a vein highlights it and says so; digging opens an
// operation there.
const used = new Set(ops.map((o) => o.node));
const target = layout.nodes.filter((n) => !used.has(n) && n.tier === 'vein' && n.y - world.groundTop[n.x] > 500)
  .sort((a, b) => Math.abs(a.x - 1500) - Math.abs(b.x - 1500))[0];
// (aimed at the vein's leftmost ore, so the planned tunnel ends beside the vein's body, not a tip)
let ore = null;
for (let x = target.box.x0; x <= target.box.x1 && !ore; x += 1) for (let y = target.box.y0; y <= target.box.y1; y += 1) if ((PW.get(world, x, y) & 63) === M.ORE) { ore = { x, y }; break; }
// (the planned tunnel, 60 cells wide, ends 8 cells short of the vein: within its reach)
const at = { x: ore.x - 30 - 8, y: ore.y + 4 };
pwApp.planDig('left', at);
check(pwApp.preview.node === target && /mining operation/.test(pwApp.preview.note), `planning a tunnel next to a vein highlights it ("${pwApp.preview.note}")`);
await view('mn-preview', at.x + 20, at.y, 5);
const before = ops.length;
const dug = pwApp.dig('left', Math.round(at.x - 30), Math.round(at.y - 18), Math.round(at.x + 30), Math.round(at.y + 18));
const opened = ops.length > before ? ops[ops.length - 1] : null;
check(!!dug.operation && opened && opened.node === target, `digging it opens a mining operation on that vein (${opened ? `room ${opened.room.x0}-${opened.room.x1}` : 'none'})`);
pwApp.stepWorld(60 * 10);
check(opened && opened.mined > 0, `the new crew starts mining (${opened ? opened.mined : 0} cells)`);
await view('mn-new-op', opened ? (opened.room.x0 + opened.room.x1) / 2 : at.x, at.y, 5);

// 4. Developed enemy lining shows as blocked while planning.
// The plan is aimed at the developed lining around the right side's mining room.
PW.tunnels.advanceTo(world, PW.tunnels.state(world).time + 600);
const rightOp = ops.find((o) => o.side === 'right');
let lining = null;
for (let y = rightOp.floor - 60; y <= rightOp.floor + 10 && !lining; y += 1) {
  for (let x = rightOp.room.x0 - 20; x <= rightOp.room.x1 + 20; x += 1) {
    const net = PW.tunnels.networkAt(world, x, y);
    if (net && net.side === 'right' && (PW.get(world, x, y) & 63) === M.REINFORCED) { lining = { x, y }; break; }
  }
}
if (lining) pwApp.planDig('left', lining);
check(lining && /Blocked/.test(pwApp.preview.note), `planning into the other side's developed tunnels says it is blocked ("${lining ? pwApp.preview.note : 'no developed lining found'}")`);

// 5. N125 (the user's): one miner mines while the other goes out after more ore - he smells the
// nearest body no one has reached, drives a drift to it, and a mine opens there; caves on the way
// are made rooms with no gaps; ore no one has reached sparkles.
const out = () => ops.filter((o) => o.prospect || (o.prospects || []).length);
for (let s = 0; s < 60 && !ops.some((o) => o.foundBy); s += 1) pwApp.stepWorld(60 * 5);
const sent = out();
// (a mine with no ore left unreached within smell keeps both its men at the face)
check(sent.length >= 1, `prospectors have gone out from ${sent.length} mines (${sent.map((o) => `${o.side} #${o.id}`).join(', ')})`);
const busy = ops.filter((o) => o.prospect && !o.prospect.back);
check(busy.every((o) => o.miners.some((m) => m.state !== 'prospect')), `while one is out, the other miner of each of those mines works on (${busy.length} out now)`);
const found = ops.filter((o) => o.foundBy);
check(found.length >= 1, `a prospector's drift reaches ore and a mine opens there (${found.map((o) => `#${o.id} ${o.node.form} ${o.node.tier}, found from #${o.foundBy}`).join('; ') || 'none yet'})`);
const drifts = ops.flatMap((o) => [o.prospect, ...(o.prospects || [])]).filter(Boolean);
const caves = drifts.filter((p) => p.caves > 0);
checks.push(`INFO drifts: ${drifts.map((p) => `${p.steps} steps${p.caves ? `, ${p.caves} cave(s)` : ''}${p.opened ? ', opened' : ''}`).join(' | ')}`);
if (caves.length) {
  // (the floor the drift ran across the cave on: solid all along)
  let gaps = 0, cols = 0;
  for (const p of caves) for (let k = 0; k + 3 < p.path.length; k += 2) {
    const [x0, y] = [p.path[k], p.path[k + 1]], x1 = p.path[k + 2];
    if (Math.abs(x1 - x0) < 20 || p.path[k + 3] !== y) continue;
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) { cols += 1; if (PW.mat.open[PW.get(world, x, y + 1) & 63]) gaps += 1; }
  }
  check(gaps === 0, `a cave on the way is a room with no gaps in its floor (${gaps} open cells under ${cols} columns of it)`);
}
const unfound = layout.nodes.filter((n) => !n.found), reached = layout.nodes.filter((n) => ops.some((o) => o.node === n));
check(unfound.length > 0 && reached.every((n) => n.found), `ore no one has reached sparkles (${unfound.length} bodies), ore reached does not (${reached.length})`);
const pr = ops.map((o) => o.miners.find((m) => m.state === 'prospect')).find(Boolean);
if (pr) await view('n125-prospector', pr.x, pr.floor - 20, 6);
if (found.length) await view('n125-found-mine', (found[0].room.x0 + found[0].room.x1) / 2, found[0].floor - 22, 5);
const glint = unfound.find((n) => n.tier === 'vein' || n.tier === 'lode') || unfound[0];
if (glint) await view(`n125-ore-${glint.form}`, (glint.box.x0 + glint.box.x1) / 2, (glint.box.y0 + glint.box.y1) / 2, 7);
pwApp.setPaused(false);
return { checks, shots: shots.length, ops: ops.map((o) => `${o.side} ${o.node.tier}: mined ${o.mined}, delivered ${o.delivered}, stored ${o.stored}`), pipes: pipes.stats };
