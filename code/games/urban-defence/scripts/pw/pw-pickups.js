'use strict';
// Things lying about for troops to pick up. For now: rock drills, left here and there in the
// tunnels (a soldier who picks one up can drill his own way, like a miner - the item bar comes with
// the units). Each is drawn into the world's front layer where it lies and listed in
// world.pickups; a blast or anything else that clears those cells destroys it.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;

  // A pneumatic rock drill lying on its side, about 85 by 35 cm: its D-grip, the yellow body over
  // the motor, the chuck and the drill steel.
  const DRILL = [
    '.gGG........',
    'G..GyyyyM...',
    'G..GYYYYMssT',
    'GGGGDDDDM...',
    '..GG........',
  ];
  const COLORS = {
    G: [34, 34, 38], g: [72, 72, 78], Y: [222, 168, 38], y: [246, 206, 98], D: [168, 118, 26],
    M: [62, 64, 70], s: [190, 196, 204], T: [116, 120, 128],
  };
  const PER_CELLS = 900;   // one drill per this many cells of a network's drifts and rooms...
  const MOST = 3;          // ...and at most this many in one network

  // Lay drills along the tunnels: a few per network, in its drifts and storage rooms, on the floor
  // where nothing else stands (not on a ladder, not across a fitting).
  function placeDrills(world, random) {
    const T = PW.tunnels && PW.tunnels.state(world);
    if (!T) return 0;
    const list = world.pickups || (world.pickups = []);
    const byNet = new Map();
    for (const seg of T.segments) {
      if (seg.kind === 'shaft' || seg.x1 - seg.x0 < 60) continue;
      (byNet.get(seg.net) || byNet.set(seg.net, []).get(seg.net)).push(seg);
    }
    let placed = 0;
    for (const segs of byNet.values()) {
      const length = segs.reduce((n, s) => n + s.x1 - s.x0, 0);
      if (length < 150) continue;
      let want = Math.min(MOST, 1 + Math.floor((length - 150) / PER_CELLS));
      for (let tries = 0; tries < 40 && want > 0; tries += 1) {
        const seg = segs[Math.floor(random() * segs.length)];
        const facing = random() < 0.5 ? 1 : -1;
        const x = Math.round(seg.x0 + 20 + random() * (seg.x1 - seg.x0 - 40 - DRILL[0].length));
        const p = put(world, x, seg.y1, facing);
        if (p) { list.push(p); want -= 1; placed += 1; }
      }
    }
    return placed;
  }
  // Draw a drill with its bottom row on row `floor` from column x (facing +1 right, -1 left), if
  // the place is clear.
  function put(world, x, floor, facing) {
    const h = DRILL.length, w = DRILL[0].length, top = floor - h + 1;
    // (not where the miners work: across their belt and its rails, or in their face room)
    for (const op of world.miningOps || []) {
      if (Math.abs(op.floor - floor) > 60) continue;
      if (x + w >= Math.min(op.belt.a, op.room.x0) - 10 && x <= Math.max(op.belt.b, op.room.x1) + 10) return null;
    }
    for (let r = 0; r < h; r += 1) for (let c = 0; c < w; c += 1) {
      const wx = x + c, wy = top + r;
      if ((PW.get(world, wx, wy) & ID_MASK) !== M.AIR || PW.getLayer(world, 'deco', wx, wy) || (PW.getFlags(world, wx, wy) & PW.FLAG.LADDER)) return null;
    }
    // (on something to lie on)
    for (let c = 0; c < w; c += 1) if (PW.mat.open[PW.get(world, x + c, floor + 1) & ID_MASK]) return null;
    const cells = [];
    for (let r = 0; r < h; r += 1) for (let c = 0; c < w; c += 1) {
      const ch = DRILL[r][facing > 0 ? c : w - 1 - c];
      if (ch === '.') continue;
      const [cr, cg, cb] = COLORS[ch];
      const k = 0.94 + (PW.hash2(x + c, top + r) & 3) * 0.03;
      PW.setLayer(world, 'deco', x + c, top + r, PW.abgr(cr * k, cg * k, cb * k));
      cells.push((top + r) * world.width + x + c);
    }
    return { kind: 'drill', x, y: top, w, h, facing, cells };
  }
  // Is it still there (not blown away, not buried)?
  function present(world, p) {
    return p.cells.every((i) => PW.getLayer(world, 'deco', i % world.width, (i / world.width) | 0) !== 0);
  }
  // Take it from where it lies (the one taking it carries it from now on).
  function take(world, p) {
    for (const i of p.cells) PW.setLayer(world, 'deco', i % world.width, (i / world.width) | 0, 0);
    const list = world.pickups || [];
    const k = list.indexOf(p);
    if (k >= 0) list.splice(k, 1);
  }

  PW.pickups = { placeDrills, present, take, DRILL };
})();
