// Tunnel development check (run with --page=pixel-world.html --params=seed=N).
// Tunnels are dug raw (timbered) and develop into reinforced concrete outward from their root;
// another side can only dig into a raw stretch, never through developed lining.
const { world } = pwApp;
const { M, FLAG } = PW;
const T = PW.tunnels.state(world);
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 10; t += 1) await sleep(100); shots.push(await shot(name)); };
pwApp.setPaused(true);
const W = world.width;
const flagsAt = (x, y) => PW.getFlags(world, x, y);
const left = world.buildings.find((b) => b.type === 'core' && b.side === 'left');
const mine = left.mine;
const net = T.networks[mine.network - 1];
const t0 = T.time;

// 1. Networks start raw, with timber sets in the back wall.
check(T.networks.length >= 3 && T.networks.every((n) => n.cells > 0), `tunnel networks for both bases and the neutral mines (${T.networks.map((n) => `${n.side}:${n.cells}`).join(' ')})`);
check(net.developed < net.cells * 0.05, `the left starter mine starts raw (${net.developed} of ${net.cells} cells developed at ${t0.toFixed(1)} s)`);
const timber = new Set(['post', 'postDark', 'postLight'].map((k) => PW.abgr(...[{ post: [122, 88, 54], postDark: [86, 60, 37], postLight: [152, 114, 72] }[k]].flat())));
let timberCells = 0;
const room = mine.storage;
for (let y = room.top; y <= room.bottom; y += 1) for (let x = room.x0; x <= room.x1; x += 1) if (timber.has(PW.getLayer(world, 'back', x, y))) timberCells += 1;
check(timberCells > 100, `raw tunnels are held up by timber sets (${timberCells} timber cells in the storage room)`);
await view('tn-raw-room', (room.x0 + room.x1) / 2, room.bottom - 22, 6);

// 2. Twenty seconds later the shaft head is developed and lined; the far end is still raw.
PW.tunnels.advanceTo(world, t0 + 20);
const shaft = mine.shaft;
const near = flagsAt(shaft.x, shaft.top + 6);
const farX = mine.storage.x0 + 4 === shaft.x ? mine.storage.x1 - 4 : (Math.abs(mine.storage.x0 - shaft.x) > Math.abs(mine.storage.x1 - shaft.x) ? mine.storage.x0 + 4 : mine.storage.x1 - 4);
const far = flagsAt(farX, mine.storage.bottom - 6);
check((near & FLAG.DEVELOPED) && (far & FLAG.RAW), `development spreads from the root: the shaft head is developed, the far end of the storage room still raw`);
let lined = 0, linedOwn = 0;
for (let y = shaft.top - 6; y <= shaft.top + 40; y += 1) for (let x = shaft.x - 22; x <= shaft.x + 22; x += 1) {
  if ((PW.get(world, x, y) & 63) === M.REINFORCED) { lined += 1; if (PW.getOwner(world, x, y) === net.owner) linedOwn += 1; }
}
check(lined > 100 && linedOwn === lined, `reinforced concrete lines the developed shaft head (${lined} cells)`);
// The front: developed cells reach no further than the wave could have travelled.
let maxDev = 0;
for (let y = shaft.top - 2; y <= shaft.bottom; y += 1) if (flagsAt(shaft.x, y) & FLAG.DEVELOPED) maxDev = Math.max(maxDev, y - shaft.top);
check(maxDev > 40 && maxDev <= net.rate * 20 + 8, `the front moved ${maxDev} cells down the shaft in 20 s (rate ${net.rate}/s)`);
await view('tn-front', shaft.x, shaft.top + maxDev, 5);

// 3. The other side cannot dig through developed lining...
const enemy = PW.tunnels.createNetwork(world, { side: 'right', x: shaft.x + 60, y: shaft.top + 20 });
const blocked = PW.tunnels.digBox(world, enemy, shaft.x + 14, shaft.top + 10, shaft.x + 60, shaft.top + 30);
check(blocked.blocked && !blocked.ok, `an enemy dig into the developed lining is blocked (${blocked.blocked ? `at ${blocked.at.x - shaft.x},${blocked.at.y - shaft.top}` : 'not blocked'})`);
// ...but it can break into a stretch that is still raw.
const rx = farX, ry = mine.storage.bottom - 20;
const side = rx > shaft.x ? 1 : -1;
const breach = PW.tunnels.digBox(world, enemy, rx + side * 2, ry - 15, rx + side * 70, ry + 15);
check(breach.ok && breach.breached.includes(net.id), `an enemy dig breaks into the raw end of the storage room (${breach.cells} cells, breached ${breach.breached})`);
// Breached means connected: walk from the enemy dig into the left mine through open cells.
const seen = new Set([ry * W + rx + side * 40]);
const queue = [ry * W + rx + side * 40];
let reached = false;
for (let q = 0; q < queue.length && q < 200000 && !reached; q += 1) {
  const i = queue[q];
  for (const j of [i - 1, i + 1, i - W, i + W]) {
    if (seen.has(j) || !PW.mat.passable[world.mat[j] & 63]) continue;
    seen.add(j);
    if (PW.tunnels.netAt(world, j % W, (j / W) | 0) === net.id) { reached = true; break; }
    queue.push(j);
  }
}
check(reached, 'the breach connects the enemy tunnel to the starter mine');
await view('tn-breach', rx + side * 30, ry, 5);

// 4. A side may cut through its own lining to branch off.
const own = PW.tunnels.digBox(world, net, shaft.x - 60, shaft.top + 10, shaft.x - 14, shaft.top + 30);
check(own.ok, `the left side can branch off through its own lining (${own.cells} cells)`);

// 5. Fully developed after enough time; then even the old raw end is closed to the enemy.
PW.tunnels.advanceTo(world, t0 + 900);
check(net.developed === net.cells, `the whole starter mine develops in time (${net.developed} of ${net.cells})`);
const late = PW.tunnels.digBox(world, enemy, mine.storage.x0 + 20, mine.storage.top - 10, mine.storage.x0 + 60, mine.storage.top + 6);
check(late.blocked, `once developed, the storage room's lining stops enemy digging too (${late.blocked ? 'blocked' : 'dug ' + late.cells})`);
await view('tn-developed-room', (room.x0 + room.x1) / 2, room.bottom - 22, 6);
await view('tn-developed-shaft', shaft.x, shaft.top + 60, 5);
pwApp.setPaused(false);
return { checks, shots: shots.length, stats: PW.tunnels.stats(world) };
