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
check(ops.filter((o) => o.side !== 'neutral').length === 2 && ops.length >= 4, `mining operations at both starter mines and the neutral mines (${ops.map((o) => `${o.side}:${o.node.tier}`).join(', ')})`);
check(ops.every((o) => o.miners.length >= 3), 'each operation has a crew of miners');
for (const side of ['left', 'right']) {
  const kinds = ['sm', 'hm', 'water'].map((r) => pipes.lineFor(side, r));
  const hm = kinds[1];
  const op = ops.find((o) => o.side === side);
  check(kinds.every(Boolean) && hm.risers.some((r) => r.x === op.riser.x), `${side} base runs SM, HM and water lines, and the HM line has a riser down to its mine`);
  // The lines run under the ground, never through the open air (crossing a shaft on its back
  // wall is fine).
  let exposed = 0;
  for (const line of kinds) for (let x = line.x0; x <= line.x1; x += 7) {
    for (let r = 0; r < 5; r += 1) {
      const y = line.ys[x - line.x0] + r;
      if ((PW.get(world, x, y) & 63) === M.AIR && !(PW.getFlags(world, x, y) & PW.FLAG.TUNNEL)) { exposed += 1; break; }
    }
  }
  check(exposed === 0, `${side} lines run underground all the way (${exposed} exposed samples)`);
}
const water = pwApp.countWater();
pwApp.stepWorld(60 * 20);
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
pwApp.stepWorld(60 * 4);
check(left.stored > storedBefore, `while the line is cut, the mine stores its ore (${storedBefore} -> ${left.stored} HM stored)`);
await view('mn-cut', cutX, cutY, 5);
for (let s = 0; s < 40 && [...hm.broken].some(Boolean); s += 1) pwApp.stepWorld(60);
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
let ore = null;
for (let y = target.box.y0; y <= target.box.y1 && !ore; y += 1) for (let x = target.box.x0; x <= target.box.x1; x += 1) if ((PW.get(world, x, y) & 63) === M.ORE) { ore = { x, y }; break; }
const at = { x: ore.x - 30 - 20, y: ore.y + 4 };
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
pwApp.setPaused(false);
return { checks, shots: shots.length, ops: ops.map((o) => `${o.side} ${o.node.tier}: mined ${o.mined}, delivered ${o.delivered}, stored ${o.stored}`), pipes: pipes.stats };
