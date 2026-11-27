'use strict';
// Mining operations. A tunnel that reaches (or comes within REACH of) an HM vein opens one: a
// working room dug up to the vein face (the ore itself is left as the face), a raise and sublevel
// drift following the vein, and a storage room at the back, all raw at first and developed later
// with the rest of the network. Miners (the trooper art with hard hats and headlamps) drill ore
// out of the face cell by cell, carry it to a conveyor belt and load it; the belt runs to a hopper
// whose riser feeds the side's HM pipeline. When the line is cut, or the town is neutral, the
// ore is stored in the storage room instead (a real heap of ore), and a miner hauls it back to the
// hopper once the line flows again. The room is part of the network: tunnels can branch from it.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;

  const REACH = 14;              // cells: a tunnel this close to a vein opens a mining operation
  const MINERS = 2;              // at most two miners harvest any one body (N12F)
  const ROOM_H = 40;             // working room height (2.8 m)
  const LOAD = 6;                // ore cells a miner carries per trip
  const DRILL_TIME = 0.55;       // seconds of drilling per ore cell
  const WALK = 20;               // cells/s (1.4 m/s)
  const BELT_SPEED = 16;         // cells/s
  const HM_PER = [1, 2, 3, 3];   // HM per ore cell by its variant (selvage, crystal, core, points)
  const rgb = (c) => PW.abgr(c[0] | 0, c[1] | 0, c[2] | 0);
  const STEEL = [96, 100, 108], STEEL_DARK = [64, 68, 74], RUBBER = [38, 38, 42], ORE_LUMP = [150, 86, 200];

  const ops = () => [];
  function list(world) { return world.miningOps || (world.miningOps = []); }

  // ---- Finding veins ------------------------------------------------------------------------------
  // The nearest ore cell of any vein within `reach` of the box; { node, x, y, dist } or null.
  function veinNear(world, box, reach = REACH) {
    const nodes = (world.layout && world.layout.nodes) || [];
    const ex0 = box.x0 - reach, ey0 = box.y0 - reach, ex1 = box.x1 + reach, ey1 = box.y1 + reach;
    let best = null;
    for (const node of nodes) {
      const b = node.box;
      if (!b || b.x1 < ex0 || b.x0 > ex1 || b.y1 < ey0 || b.y0 > ey1) continue;
      for (let y = Math.max(ey0, b.y0); y <= Math.min(ey1, b.y1); y += 1) {
        for (let x = Math.max(ex0, b.x0); x <= Math.min(ex1, b.x1); x += 1) {
          if ((PW.get(world, x, y) & ID_MASK) !== M.ORE) continue;
          const dx = x < box.x0 ? box.x0 - x : x > box.x1 ? x - box.x1 : 0;
          const dy = y < box.y0 ? box.y0 - y : y > box.y1 ? y - box.y1 : 0;
          const dist = Math.max(dx, dy);
          if (!best || dist < best.dist) best = { node, x, y, dist };
        }
      }
    }
    return best;
  }
  // The vein's outline (ore cells with a non-ore neighbour), cached, for highlighting.
  function outline(world, node) {
    if (node.outline) return node.outline;
    const out = [];
    const ore = (x, y) => (PW.get(world, x, y) & ID_MASK) === M.ORE;
    for (let y = node.box.y0; y <= node.box.y1; y += 1) for (let x = node.box.x0; x <= node.box.x1; x += 1) {
      if (ore(x, y) && (!ore(x - 1, y) || !ore(x + 1, y) || !ore(x, y - 1) || !ore(x, y + 1))) out.push(x, y);
    }
    node.outline = out;
    return out;
  }

  // ---- Building the workings ------------------------------------------------------------------------
  // The column where ore starts, scanning from x in direction dir across the rows miners work
  // (the room's height above its floor row).
  function faceFrom(world, x, dir, floor, maxRun = 420) {
    for (let k = 0; k < maxRun; k += 1) {
      const cx = x + dir * k;
      for (let y = floor - ROOM_H + 1; y <= floor - 1; y += 1) if ((PW.get(world, cx, y) & ID_MASK) === M.ORE) return cx;
    }
    return null;
  }
  function fixture(world, x, y, color) {
    if ((PW.get(world, x, y) & ID_MASK) !== M.AIR) return;
    PW.setLayer(world, 'back', x, y, rgb(color));
    PW.setFlag(world, x, y, FLAG.FIXTURE);
  }
  // Conveyor frame on the back wall (units walk in front of it): rubber belt, steel frame,
  // legs every 20 cells, end drums. The moving belt and its load are drawn as an overlay.
  function layBelt(world, x0, x1, floor) {
    for (let x = x0; x <= x1; x += 1) {
      fixture(world, x, floor - 7, RUBBER);
      fixture(world, x, floor - 6, STEEL);
      fixture(world, x, floor - 5, STEEL_DARK);
      if ((x - x0) % 20 === 3) for (let y = floor - 4; y <= floor; y += 1) { fixture(world, x, y, STEEL_DARK); fixture(world, x + 1, y, [52, 56, 62]); }
    }
    for (const ex of [x0, x1]) for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      if (dx * dx + dy * dy <= 5) fixture(world, ex + dx, floor - 6 + dy, dx * dx + dy * dy <= 1 ? [140, 144, 150] : STEEL_DARK);
    }
  }
  // Hopper at the belt's head: a steel funnel with the riser going up from its top.
  function layHopper(world, x, floor) {
    for (let dy = 0; dy < 8; dy += 1) {
      const half = 3 + Math.round(dy * 0.6);
      for (let dx = -half; dx <= half; dx += 1) fixture(world, x + dx, floor - 8 - dy, Math.abs(dx) === half || dy === 7 ? STEEL : [44, 46, 50]);
    }
  }

  // Open an operation on vein `node` for network `net`. `w` describes existing workings when the
  // workings were planned already (starter mines: { drift, storage, shaft }); otherwise a room is
  // dug from `contact` (a tunnel cell next to the vein).
  function open(world, net, node, w = {}) {
    const all = list(world);
    // One operation per ore body, whoever reaches it (N12F: at most two miners harvest any one
    // body - the next tunnel to touch it digs on to other ore, or to the caves).
    if (all.some((op) => op.node === node)) return null;
    node.found = true;   // (N125: a body reached no longer sparkles)
    let floor, rx0, rx1, dir, storage = w.storage || null, shaft = w.shaft || null;
    if (w.drift) {
      floor = w.drift.bottom;
      rx0 = Math.ceil(w.drift.x0); rx1 = Math.floor(w.drift.x1);
      // The face is at the drift's far end from the shaft.
      dir = rx1 - shaft.x >= shaft.x - rx0 ? 1 : -1;
    } else {
      const c = w.contact;
      floor = c.floor;
      dir = Math.sign(c.oreX - c.x) || 1;   // towards the ore the tunnel reached
      const face = faceFrom(world, c.x, dir, floor);
      if (face === null) return null;
      // The room runs from the contact up to the face, at least 110 cells long (back from the
      // face if the contact is right at it).
      const near = Math.abs(face - c.x) >= 110 ? c.x : face - dir * 110;
      rx0 = Math.min(near, face - dir); rx1 = Math.max(near, face - dir);
      const room = PW.tunnels.digBox(world, net, rx0, floor - ROOM_H + 1, rx1, floor, { kind: 'room', keepOre: true });
      if (!room.ok) return { blocked: true };
    }
    const face0 = faceFrom(world, dir > 0 ? rx1 - 4 : rx0 + 4, dir, floor);
    if (face0 === null) return null;
    const back = dir > 0 ? rx0 : rx1;
    // Storage room at the back (dug here unless the workings already had one).
    if (!storage) {
      const s0 = back - dir * 4, s1 = back - dir * 90;
      const dug = PW.tunnels.digBox(world, net, Math.min(s0, s1), floor - 36, Math.max(s0, s1), floor, { kind: 'room', keepOre: true });
      if (dug.ok) storage = { x0: Math.min(s0, s1), x1: Math.max(s0, s1), top: floor - 36, bottom: floor };
    }
    // Belt from near the face back to the hopper. At a shaft the hopper stands in the shaft on the
    // side away from the ladder, so its riser climbs the shaft wall; otherwise by the back wall.
    let hopperX = back + dir * 12;
    if (shaft) {
      const side = [dir, -dir].find((s) => !(PW.getFlags(world, shaft.x + s * 9, floor - 20) & FLAG.LADDER)) || dir;
      hopperX = shaft.x + side * 9;
    }
    const tail = face0 - dir * 20;
    const beltA = Math.min(tail, hopperX + dir * 6), beltB = Math.max(tail, hopperX + dir * 6);
    layBelt(world, beltA, beltB, floor);
    layHopper(world, hopperX, floor);
    // The raise and sublevel drift that follow the vein above the room (raw, developed later).
    const sub = sublevel(world, net, node, floor, face0, dir);
    const op = {
      id: all.length + 1, net: net.id, side: net.side, node, floor, dir, face: face0, exhausted: false,
      room: { x0: Math.min(rx0, rx1), x1: Math.max(rx0, rx1) }, roomSeg: PW.tunnels.state(world).segments.slice(-1)[0],
      belt: { tail, head: hopperX + dir * 6, a: beltA, b: beltB, cargo: [] }, hopper: { x: hopperX },
      riser: { x: hopperX, y: floor - 16 }, storage, stored: 0, heap: [], mined: 0, delivered: 0, sublevel: sub, miners: [],
    };
    // The segment new ore openings join: the room itself (or the drift).
    const T = PW.tunnels.state(world);
    op.roomSeg = T.segments.find((s) => s.net === net.id && s.x0 <= tail && s.x1 >= tail && s.y0 <= floor - 4 && s.y1 >= floor) || T.segments[T.segments.length - 1];
    for (let k = 0; k < MINERS; k += 1) {
      op.miners.push({ x: tail + dir * (6 + k * 6), state: 'toFace', facing: dir, timer: k * 0.7, load: 0, value: 0, lane: k, walked: 0, carry: 0 });
    }
    all.push(op);
    return op;
  }
  function sublevel(world, net, node, floor, face, dir) {
    // Does the vein carry on above the room's roof near the face?
    let above = false;
    for (let y = floor - ROOM_H - 70; y < floor - ROOM_H - 10 && !above; y += 2) {
      for (let x = face - 40; x <= face + 40; x += 2) if ((PW.get(world, x, y) & ID_MASK) === M.ORE) { above = true; break; }
    }
    if (!above) return null;
    const rx = face - dir * 40;
    const top = floor - ROOM_H - 60;
    const raise = PW.tunnels.digBox(world, net, Math.min(rx, rx - dir * 24), top, Math.max(rx, rx - dir * 24), floor - ROOM_H, { kind: 'shaft', keepOre: true });
    if (!raise.ok) return null;
    const sface = faceFrom(world, rx, dir, top + ROOM_H - 1, 160);
    const end = sface === null ? rx + dir * 60 : sface - dir;
    PW.tunnels.digBox(world, net, Math.min(rx, end), top, Math.max(rx, end), top + ROOM_H - 1, { kind: 'drift', keepOre: true });
    if (PW.settlementTools) PW.settlementTools.ladder(world, Math.min(rx, rx - dir * 24) + 6, top, floor - 1);
    return { x: rx, top, floor: top + ROOM_H - 1, face: sface };
  }

  // Openings from the existing workings (starter mines, neutral headframe mines).
  function openFromWorkings(world, workings, side) {
    if (!workings || !workings.node || !workings.drift || !workings.network) return null;
    const net = PW.tunnels.state(world).networks[workings.network - 1];
    return open(world, net, workings.node, { drift: workings.drift, storage: workings.storage, shaft: workings.shaft, side });
  }
  // After a dig: if the new tunnel reaches a vein, open an operation there.
  function afterDig(world, net, box) {
    const hit = veinNear(world, box, REACH);
    if (!hit) return null;
    return open(world, net, hit.node, { contact: { x: Math.round((box.x0 + box.x1) / 2), floor: box.y1, oreX: hit.x } });
  }

  // ---- Working ---------------------------------------------------------------------------------------
  function exposed(world, x, y) {
    const open = (cx, cy) => PW.mat.open[PW.get(world, cx, cy) & ID_MASK] === 1;
    return open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1);
  }
  // Drill one ore cell out of the face near (tx, ty); returns its HM value or 0.
  function drillCell(world, op, tx, ty) {
    let best = null, bestD = Infinity;
    for (let y = op.floor - ROOM_H + 1; y <= op.floor - 1; y += 1) {
      for (let k = -2; k <= 14; k += 1) {
        const x = op.face + op.dir * k;
        const m = PW.get(world, x, y);
        if ((m & ID_MASK) !== M.ORE || !exposed(world, x, y)) continue;
        const d = Math.abs(x - tx) + Math.abs(y - ty) * 0.7;
        if (d < bestD) { bestD = d; best = { x, y, v: m >> 6 }; }
      }
    }
    const net = PW.tunnels.state(world).networks[op.net - 1];
    if (!best) {
      // Rock between the room and the vein: drive through it to reach the ore (no HM for rock).
      for (let k = 0; k < 40 && !best; k += 1) {
        const x = op.face - op.dir * (k + 1);
        let bestY = Infinity;
        for (let y = op.floor - ROOM_H + 1; y <= op.floor - 1; y += 1) {
          const id = PW.get(world, x, y) & ID_MASK;
          if (!PW.mat.terrain[id] || id === M.ORE || id === M.BEDROCK || !exposed(world, x, y)) continue;
          const d = Math.abs(y - ty);
          if (d < bestY) { bestY = d; best = { x, y, rock: true }; }
        }
      }
      if (!best) return 0;
      PW.tunnels.claimCell(world, net, op.roomSeg, best.x, best.y);
      return -1;
    }
    PW.tunnels.claimCell(world, net, op.roomSeg, best.x, best.y);
    op.mined += 1;
    const F = PW.PARTICLE;
    if (world.particles && F) {
      for (let s = 0; s < 2; s += 1) world.particles.spawn(best.x + 0.5, best.y + 0.5, -op.dir * (20 + s * 25), -15 - s * 10, 0, PW.abgr(255, 226, 150), F.GLOW, 0.15);
    }
    if ((PW.hash2(best.x, best.y) & 3) === 0 && PW.mat.open[PW.get(world, best.x - op.dir, best.y) & ID_MASK]) {
      PW.set(world, best.x - op.dir, best.y, M.DUST | 1 << 6, { quiet: true });
    }
    return HM_PER[best.v] || 1;
  }
  function refreshFace(world, op) {
    const f = faceFrom(world, op.face - op.dir * 4, op.dir, op.floor, 160);
    if (f === null) op.exhausted = true; else op.face = f;
  }
  function pipelineOpen(world, op) {
    if (!world.pipes || op.side === 'neutral') return false;
    const line = world.pipes.lineFor(op.side, 'hm');
    return !!line && world.pipes.flowing(line, op.riser.x);
  }
  // The stored heap: real ore cells piled on the storage room floor as a cone from the middle
  // (a cell only goes on a column that is no more than one cell above both its neighbours).
  function heapAdd(world, op) {
    const s = op.storage;
    if (!s) return false;
    const mid = Math.round((s.x0 + s.x1) / 2);
    const height = (x) => { let h = 0; while (h < 30 && (PW.get(world, x, s.bottom - h) & ID_MASK) !== M.AIR) h += 1; return h; };
    for (let r = 0; r < 40; r += 1) {
      for (const x of r ? [mid - r, mid + r] : [mid]) {
        if (x < s.x0 + 4 || x > s.x1 - 4) continue;
        const h = height(x);
        if (h >= 24 || h + 1 > Math.min(height(x - 1), height(x + 1)) + 1) continue;
        const y = s.bottom - h;
        if ((PW.get(world, x, y) & ID_MASK) !== M.AIR) continue;
        PW.set(world, x, y, M.ORE | (1 + (PW.hash2(x, y) & 1)) << 6, { quiet: true });
        op.heap.push(y * world.width + x);
        return true;
      }
    }
    return false;
  }
  function heapTake(world, op) {
    while (op.heap.length) {
      const i = op.heap.pop();
      if ((world.mat[i] & ID_MASK) === M.ORE) { PW.set(world, i % world.width, (i / world.width) | 0, M.AIR, { quiet: true }); return true; }
    }
    return false;
  }
  function deliver(world, op, value) {
    if (pipelineOpen(world, op)) {
      op.delivered += value;
      // The ore goes into the riser as real chunks riding the line's conveyor to the core.
      if (world.pipes.carry) world.pipes.carry(op, value);
      world.hmDelivered = world.hmDelivered || { left: 0, right: 0 };
      world.hmDelivered[op.side] = (world.hmDelivered[op.side] || 0) + value;
    } else {
      op.stored += value;
      for (let k = 0; k < value; k += 2) heapAdd(world, op);
    }
  }
  function stepMiner(world, op, m, dt) {
    const go = (target) => {
      const d = target - m.x;
      if (Math.abs(d) < 1) { m.x = target; return true; }
      const s = Math.sign(d) * Math.min(Math.abs(d), WALK * dt);
      m.x += s; m.walked += Math.abs(s); m.facing = Math.sign(d);
      return false;
    };
    const faceSpot = op.face - op.dir * (9 + m.lane * 7);
    const hauler = m.lane === 0 && op.stored > 0 && op.storage && pipelineOpen(world, op);
    switch (m.state) {
      case 'toFace':
        if (hauler) { m.state = 'toStorage'; break; }
        if (op.exhausted) { m.state = 'idle'; break; }
        if (go(faceSpot)) { m.state = 'drill'; m.timer = 0; m.facing = op.dir; }
        break;
      case 'drill':
        // (the hauler leaves the face for the stored heap as soon as the line flows again, not
        // only after a load: driving through rock towards the vein can take a long while)
        if (hauler && !m.load) { m.state = 'toStorage'; break; }
        m.timer += dt;
        if (m.timer >= DRILL_TIME) {
          m.timer = 0;
          const v = drillCell(world, op, m.x + op.dir * 12, op.floor - 10 - m.lane * 8);
          if (!v) { refreshFace(world, op); m.state = m.load ? 'toBelt' : 'toFace'; break; }
          // Drove through rock towards the vein: no ore this time. A hauler-to-be does not grind
          // on through barren rock while the stored heap waits: it dumps its part-load and goes.
          if (v < 0) { if (hauler) m.state = m.load ? 'toBelt' : 'toStorage'; break; }
          m.load += 1; m.value += v;
          if (m.load >= LOAD) { refreshFace(world, op); m.state = 'toBelt'; }
        }
        break;
      case 'toBelt':
        if (go(op.belt.tail - op.dir * (2 + m.lane * 3))) { m.state = 'load'; m.timer = 0; m.facing = -op.dir; }
        break;
      case 'load':
        m.timer += dt;
        if (m.timer >= 0.4 && m.load) {
          op.belt.cargo.push({ s: 0, value: m.value });
          m.load = 0; m.value = 0;
        }
        if (m.timer >= 0.8) m.state = 'toFace';
        break;
      case 'toStorage':
        if (go(Math.round((op.storage.x0 + op.storage.x1) / 2) + op.dir * 8)) { m.state = 'pickup'; m.timer = 0; }
        break;
      case 'pickup':
        m.timer += dt;
        if (m.timer >= 0.8) {
          let taken = 0;
          while (taken < LOAD && op.stored > 0 && heapTake(world, op)) { taken += 1; op.stored = Math.max(0, op.stored - 2); }
          if (!taken) op.stored = 0;
          m.carry = taken * 2;
          m.state = 'toHopper';
        }
        break;
      case 'toHopper':
        if (go(op.hopper.x - op.dir * 4)) { if (m.carry) deliver(world, op, m.carry); m.carry = 0; m.state = 'toFace'; }
        break;
      default:   // idle by the belt
        go(op.belt.tail - op.dir * (4 + m.lane * 6));
        if (!op.exhausted || hauler) m.state = 'toFace';
    }
  }
  // ---- N125: one miner mines, the other prospects -------------------------------------------------
  // The user's (2026-11-23): every mine keeps one miner at the face and sends the other out to more
  // ore. He smells the nearest body no one has reached or set out for (within SNIFF, the rock
  // between counted, depth double), walks out of the room and drives a drift towards it, a step of
  // drift (or of stairs, where it lies higher or lower) every DIG_EVERY seconds of the workings'
  // clock; where the drift breaks into a cave, the cave is a shortcut - its chamber made a room
  // with no gaps in its floor, walked across, and the drift driven on from its far wall. Reaching
  // the ore, the drift opens a mine there (with a miner and a prospector of its own) and he goes
  // back to his own face; with nothing left to smell he mines beside the other.
  const SNIFF = 1500;
  const DIG_EVERY = 1.1;
  const DRIFT_H = 30;
  const STEP_W = 6;
  const MAX_STEPS = 260;
  const groundAt = (world, x) => world.groundTop[Math.max(0, Math.min(world.width - 1, Math.round(x)))];
  // (the cover a drive keeps under: the ground over it - for a drive passing through others' workings
  // (p.through, N130's link), the land's own surface: a mine's shaft open to the sky is not the land)
  const coverAt = (world, p, x) => (p.through && world.surface0 ? world.surface0[Math.max(0, Math.min(world.width - 1, Math.round(x)))] : groundAt(world, x));
  function prospectFor(world, op, from) {
    const nodes = (world.layout && world.layout.nodes) || [];
    const taken = new Set();
    for (const o of list(world)) { taken.add(o.node); if (o.prospect) taken.add(o.prospect.node); }
    for (const o of trips(world)) if (o.prospect) taken.add(o.prospect.node);
    for (const n of world.miningClaims || []) taken.add(n);   // (N129: a core shaft's branch is on its way)
    let best = null, bestD = SNIFF;
    for (const n of nodes) {
      if (taken.has(n) || n.found || (op.tried && op.tried.has(n)) || (n.amount || 0) < 40) continue;
      if (n.y < groundAt(world, n.x) + 220) continue;
      const d = Math.abs(n.x - from.x) + 2 * Math.abs(n.y - from.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }
  // The open chamber of a cave the drift has met at (x, y): its run along the drift's rows from x
  // in dir, while it stays open (at most 400).
  function caveRun(world, x, y, dir) {
    let n = 0;
    const open = (cx) => { const id = PW.get(world, cx, y - 12) & ID_MASK; return id === M.AIR && !(PW.getFlags(world, cx, y - 12) & FLAG.TUNNEL); };
    while (n < 400 && open(x + dir * (n + 1))) n += 1;
    return n;
  }
  // The cave made a room: a level floor at the drift's row across its run, the gaps under it
  // filled with stone (no pit for a man to fall in), its height dug clean - the rest of the
  // cave, its dome and its formations, is left as it was.
  function caveRoom(world, net, x, y, dir, run) {
    const a = Math.min(x, x + dir * (run + 4)), b = Math.max(x, x + dir * (run + 4));
    // (the supply line's bore is open air of its own - never filled - nor anything a building owns)
    const keep = (xx, yy) => (PW.getFlags(world, xx, yy) & FLAG.HOLLOW) || PW.getOwner(world, xx, yy) || PW.getLayer(world, 'pipe', xx, yy);
    for (let cx = a; cx <= b; cx += 1) {
      for (let k = 1; k < 90; k += 1) {
        const id = PW.get(world, cx, y + k) & ID_MASK;
        if (id !== M.AIR && id !== M.WATER) break;
        if (keep(cx, y + k)) break;
        PW.set(world, cx, y + k, M.STONE | ((PW.hash2(cx, y + k) & 3) << 6), { quiet: true });
      }
      if ((PW.get(world, cx, y) & ID_MASK) === M.AIR && !keep(cx, y)) PW.set(world, cx, y, M.STONE, { quiet: true });
    }
    return PW.tunnels.digBox(world, net, a, y - DRIFT_H - 6, b, y, { kind: 'room', keepOre: true }).ok;
  }
  // (a drift never cuts a mountain's road tunnel - its road, its bore, the line laid under it)
  function crossesRoad(world, x0, y0, x1, y1) {
    for (const t of world.roadTunnels || []) {
      if (x1 < t.a - 4 || x0 > t.b + 4) continue;
      for (let x = Math.max(x0, t.a); x <= Math.min(x1, t.b); x += 2) {
        const f = t.floorAt(x), top = f - (PW.roadTunnels.CLEAR || 96) - 6, bottom = f + (PW.roadTunnels.PIPE_UNDER || 18) + 8;
        if (y1 >= top && y0 <= bottom) return true;
      }
    }
    return false;
  }
  // N136: an underground lake's shell in the box (with a few cells' keep-off) - drives and shafts stop
  // short of it; only a farm's well is cased down onto its roof (a breach would flood the workings).
  function crossesAquifer(world, x0, y0, x1, y1, keep = 8) {
    for (const a of (world.layout && world.layout.aquifers) || []) {
      if (x1 >= a.x0 - keep && x0 <= a.x1 + keep && y1 >= a.roof - keep && y0 <= a.bottom + keep) return true;
    }
    return false;
  }
  function prospectStep(world, op, p) {
    const net = PW.tunnels.state(world).networks[op.net - 1];
    if (!net) return 'stop';
    const r = driveStep(world, net, p);
    if (r === 'done') p.opened.foundBy = op.id;
    return r;
  }
  // One step of a drive towards p.node on the network net (p: {node, x, y, dir, steps, caves, path}):
  // a drift, a flight of stairs where the ore lies above or below, a cave on the way taken as a room;
  // where it comes within REACH of ore it opens a mine there ('done'). Shared by the prospectors and
  // the branches out of a core's shaft (N129).
  function driveStep(world, net, p) {
    {
      // (the next step's reach, before anything is dug: a road tunnel in it stops the drift there)
      const dir0 = Math.sign(p.node.x - p.x) || p.dir;
      if (crossesRoad(world, Math.min(p.x, p.x + dir0 * (STEP_W + 4)), p.y - DRIFT_H - 4, Math.max(p.x, p.x + dir0 * (STEP_W + 4)), p.y + 4)) return 'stop';
      if (crossesAquifer(world, Math.min(p.x, p.x + dir0 * (STEP_W + 4)), p.y - DRIFT_H - 4, Math.max(p.x, p.x + dir0 * (STEP_W + 4)), p.y + 4)) return 'stop';
    }
    const dir = Math.sign(p.node.x - p.x) || p.dir;
    p.dir = dir;
    const dy = p.node.y + 8 - p.y;
    let box;
    if (Math.abs(dy) > 6 && Math.abs(p.node.x - p.x) < Math.abs(dy) * 1.5 + 60) {
      // stairs: two rows down (or up) per three along, the roof clear over the treads
      const s = Math.sign(dy) * 2;
      box = { x0: Math.min(p.x, p.x + dir * 4), y0: Math.min(p.y, p.y + s) - 22, x1: Math.max(p.x, p.x + dir * 4), y1: Math.max(p.y, p.y + s) };
      if (box.y0 < coverAt(world, p, p.x) + 140) return 'stop';
      if (!PW.tunnels.digBox(world, net, box.x0, box.y0, box.x1, box.y1, { kind: 'incline', keepOre: true, through: !!p.through }).ok) return 'stop';
      for (let d = 0; d <= 3; d += 1) { PW.setFlag(world, p.x + dir * d, p.y + s, FLAG.LADDER); }
      p.x += dir * 3; p.y += s;
    } else {
      const ahead = p.x + dir * (STEP_W + 2);
      const run = caveRun(world, p.x + dir * 2, p.y, dir);
      if (run > 24) {
        // a cave: the shortcut
        if (!caveRoom(world, net, p.x, p.y, dir, run)) return 'stop';
        p.x += dir * (run + 2); p.caves += 1;
        box = { x0: Math.min(p.x, p.x - dir * run), y0: p.y - DRIFT_H, x1: Math.max(p.x, p.x - dir * run), y1: p.y };
      } else {
        box = { x0: Math.min(p.x, ahead), y0: p.y - DRIFT_H + 1, x1: Math.max(p.x, ahead), y1: p.y };
        if (box.y0 < coverAt(world, p, ahead) + 140) return 'stop';
        if (!PW.tunnels.digBox(world, net, box.x0, box.y0, box.x1, box.y1, { kind: 'drift', keepOre: true, through: !!p.through }).ok) return 'stop';
        p.x = ahead - dir * 2;
      }
    }
    p.path.push(p.x, p.y);
    p.steps += 1;
    const hit = veinNear(world, box, REACH);
    if (hit) {
      const made = open(world, net, hit.node, { contact: { x: Math.round((box.x0 + box.x1) / 2), floor: box.y1, oreX: hit.x } });
      if (made && !made.blocked) {
        p.opened = made;
        if (world.pipes && world.pipes.attach) world.pipes.attach(made);   // (its riser joins the side's line)
        return 'done';
      }
      hit.node.found = true;
    }
    return p.steps >= MAX_STEPS ? 'stop' : 'on';
  }
  function stepProspect(world, op, m, dt) {
    const T = PW.tunnels.state(world);
    let p = op.prospect;
    if (!p) {
      if (PW.NO_PROSPECT || (op.nextSniff || 0) > T.time) return false;
      op.nextSniff = T.time + 20;
      const from = { x: op.dir > 0 ? op.room.x1 : op.room.x0, y: op.floor };
      const node = prospectFor(world, op, from);
      if (!node) return false;
      const dir = Math.sign(node.x - from.x) || op.dir;
      const x = node.x >= op.room.x0 && node.x <= op.room.x1 ? from.x : (dir > 0 ? op.room.x1 : op.room.x0) - dir * 2;
      p = op.prospect = { node, x, y: op.floor, dir, at: T.time + DIG_EVERY, steps: 0, caves: 0, path: [x, op.floor], home: m.x, back: false };
      m.state = 'prospect'; m.floor = op.floor; m.load = 0; m.value = 0;
    }
    // He walks to the head of the drift (along it, floor by floor), then digs; going home he walks
    // it back the same way.
    const pts = p.path, last = pts.length / 2 - 1;
    m.pi = Math.max(0, Math.min(m.pi ?? 0, last));
    const tx = pts[m.pi * 2], ty = pts[m.pi * 2 + 1], d = tx - m.x;
    if (Math.abs(d) > 1 || Math.abs(ty - m.floor) > 1) {
      const step = Math.min(Math.abs(d), WALK * dt);
      if (Math.abs(d) <= 1) m.floor = ty;
      else { m.floor += (ty - m.floor) * Math.min(1, step / Math.abs(d)); m.x += Math.sign(d) * step; m.walked += step; m.facing = Math.sign(d); }
      return true;
    }
    const target = p.back ? 0 : last;
    if (m.pi !== target) { m.pi += target > m.pi ? 1 : -1; return true; }
    if (p.back) { op.prospect = null; m.state = 'toFace'; m.floor = op.floor; m.pi = 0; return false; }
    m.facing = p.dir;
    while (T.time >= p.at) {
      p.at += DIG_EVERY * (op.slow || 1);
      const r = prospectStep(world, op, p);
      if (r === 'on') continue;
      if (r === 'stop') { (op.tried = op.tried || new Set()).add(p.node); }
      p.back = true;
      (op.prospects = op.prospects || []).push(p);
      break;
    }
    return true;
  }
  // ---- N129: out from a core's own shaft ---------------------------------------------------------
  // The user's (2026-11-24): a city's tunnel grows from the bottom of its core, straight down, then
  // out sideways to the ore. At the shaft's foot a miner sets out as the prospectors do (a trip:
  // no face of its own yet); reaching ore he opens a mine there - its own miner and prospector -
  // and his trip is over. With nothing to smell he waits at the foot and smells again.
  function trips(world) { return world.miningTrips || (world.miningTrips = []); }
  function expedition(world, net, x, floor, dir = 1, opts = {}) {
    const all = trips(world);
    const trip = { id: 1000 + all.length, net: net.id, side: net.side, node: null, floor, dir, trip: true, slow: opts.slow || 1,
      room: { x0: x - 20, x1: x + 20 }, miners: [{ x, floor, state: 'toFace', facing: dir, timer: 0, load: 0, value: 0, lane: 1, walked: 0, carry: 0 }],
      by: opts.by || null };
    all.push(trip);
    return trip;
  }
  // ---- N96: the HM store ----------------------------------------------------------------------------
  // The user's (2026-11-22): an HM storage room, where the surplus is kept until it is needed. Past
  // HM_KEEP in hand, a side's surplus goes down into its store - a strongroom dug off its first
  // mine's storage, the ore heaped on its floor two HM a cell - STORE_RATE a second; when the side
  // runs short (under HM_LOW) it comes back up at the same pace. The store is real ground: a blast
  // into it scatters the ore, and what is lost is lost.
  const HM_KEEP = 1200, HM_LOW = 300, STORE_RATE = 12, STORE_W = 120, STORE_H = 40;
  function storeOf(world, side) {
    const all = world.hmStores || (world.hmStores = {});
    if (all[side] !== undefined) return all[side];
    const op = list(world).find((o) => o.side === side && o.storage);
    if (!op) return null;
    const net = PW.tunnels.state(world).networks[op.net - 1];
    if (!net) return null;
    const s = op.storage, out = -op.dir;   // (beyond the mine's own storage, away from the face)
    const x0 = out > 0 ? s.x1 + 4 : s.x0 - 4 - STORE_W, x1 = x0 + STORE_W;
    const floor = s.bottom;
    const dug = PW.tunnels.digBox(world, net, x0, floor - STORE_H, x1, floor, { kind: 'room', keepOre: true, exact: true });
    if (!dug.ok) { all[side] = null; return null; }
    // a strongroom: a banded steel door frame at its mouth, amber lamps, hazard chevrons on its floor
    const mouth = out > 0 ? x0 : x1;
    for (let y = floor - STORE_H + 2; y <= floor; y += 1) for (const d of [0, 1, 2]) {
      const x = mouth + out * d;
      PW.setLayer(world, 'back', x, y, rgb(d === 1 ? STEEL : STEEL_DARK));
      PW.setFlag(world, x, y, FLAG.FIXTURE);
    }
    for (let x = x0 + 8; x < x1 - 8; x += 1) if (((x >> 2) & 1) === 0) { PW.setLayer(world, 'back', x, floor - 1, rgb([188, 158, 48])); PW.setFlag(world, x, floor - 1, FLAG.FIXTURE); }
    for (const lx of [x0 + 20, x1 - 20]) for (let dx = -1; dx <= 1; dx += 1) PW.setLayer(world, 'back', lx + dx, floor - STORE_H + 3, rgb([255, 196, 90]));
    all[side] = { side, net: net.id, op: op.id, x0, x1, floor, stored: 0, heap: [], moved: 0 };
    return all[side];
  }
  function stepStores(world, dt) {
    // (a match's economy: the sandbox's and the labs' stocks are free)
    if (!world.stock || !(world.capitalGrowth && world.capitalGrowth.manual)) return;
    for (const side of ['left', 'right']) {
      const purse = world.stock[side];
      if (!purse) continue;
      const want = purse.hm > HM_KEEP ? Math.min(purse.hm - HM_KEEP, STORE_RATE * dt) : 0;
      const st = want > 0 || (world.hmStores && world.hmStores[side]) ? storeOf(world, side) : null;
      if (!st) continue;
      st.carry = (st.carry || 0);
      if (want > 0) {
        st.carry += want;
        while (st.carry >= 2) {
          // two HM a cell of ore on the heap (a store full to its roof keeps the rest in hand)
          if (!heapOn(world, st)) break;
          st.carry -= 2; purse.hm -= 2; st.stored += 2; st.moved += 2;
        }
      } else if (purse.hm < HM_LOW && st.stored > 0) {
        st.carry -= STORE_RATE * dt;
        while (st.carry <= -2 && st.stored > 0) {
          st.carry += 2;
          if (heapOff(world, st)) { purse.hm += 2; st.stored -= 2; } else { st.stored = 0; break; }
        }
      }
    }
  }
  function heapOn(world, st) {
    const mid = Math.round((st.x0 + st.x1) / 2);
    const height = (x) => { let h = 0; while (h < STORE_H - 6 && (PW.get(world, x, st.floor - h) & ID_MASK) !== M.AIR) h += 1; return h; };
    for (let r = 0; r < (STORE_W >> 1) - 8; r += 1) {
      for (const x of r ? [mid - r, mid + r] : [mid]) {
        const h = height(x);
        if (h >= STORE_H - 8 || h + 1 > Math.min(height(x - 1), height(x + 1)) + 1) continue;
        const y = st.floor - h;
        if ((PW.get(world, x, y) & ID_MASK) !== M.AIR) continue;
        PW.set(world, x, y, M.ORE | (1 + (PW.hash2(x, y) & 1)) << 6, { quiet: true });
        st.heap.push(y * world.width + x);
        return true;
      }
    }
    return false;
  }
  function heapOff(world, st) {
    while (st.heap.length) {
      const i = st.heap.pop();
      if ((world.mat[i] & ID_MASK) === M.ORE) { PW.set(world, i % world.width, (i / world.width) | 0, M.AIR, { quiet: true }); return true; }
    }
    return false;
  }
  function step(world, dt) {
    stepStores(world, dt);
    for (const t of trips(world)) {
      if (t.over) continue;
      const m = t.miners[0];
      stepProspect(world, t, m, dt);
      if ((t.prospects || []).some((p) => p.opened) && !t.prospect) t.over = true;
    }
    for (const op of list(world)) {
      for (const m of op.miners) {
        // (N125: the second miner is the prospector while there is ore to smell)
        if (m.lane === 1 && (m.state === 'prospect' || m.state === 'toFace' || m.state === 'idle') && stepProspect(world, op, m, dt)) continue;
        stepMiner(world, op, m, dt);
      }
      const length = Math.abs(op.belt.head - op.belt.tail);
      for (let k = op.belt.cargo.length - 1; k >= 0; k -= 1) {
        const c = op.belt.cargo[k];
        c.s += BELT_SPEED * dt;
        if (c.s >= length) { op.belt.cargo.splice(k, 1); deliver(world, op, c.value); }
      }
    }
  }

  // ---- Drawing --------------------------------------------------------------------------------------
  function draw(renderer, world, time) {
    const { ctx, camera, view } = renderer;
    const z = camera.zoom;
    if (z < 0.5 || !PW.unitArt) return;
    const size = Math.max(1, Math.round(z));
    const vx0 = camera.x - 60, vx1 = camera.x + view.width / z + 60, vy0 = camera.y - 60, vy1 = camera.y + view.height / z + 60;
    const cell = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), size, size); };
    // The belt runs along the back wall: its cleats and its load show only where nothing stands in
    // front of it (crates, drums, sandbags and the like hide it).
    const backCell = (x, y, color) => { if (PW.mat.open[PW.get(world, x, y) & ID_MASK]) cell(x, y, color); };
    // N125: ore no one has reached sparkles - a few glints at a time wink on its edges
    for (const node of (world.layout && world.layout.nodes) || []) {
      const b = node.box;
      if (node.found || !b || b.x1 < vx0 || b.x0 > vx1 || b.y1 < vy0 || b.y0 > vy1) continue;
      const edge = outline(world, node), n = edge.length >> 1;
      if (!n) continue;
      const glints = Math.min(7, 2 + (n >> 6));
      for (let g = 0; g < glints; g += 1) {
        const t = time * 1.3 + g / glints, round = Math.floor(t), ph = t - round;
        const k = PW.hash2(node.x * 3 + g, round * 7 + node.y) % n, x = edge[k * 2], y = edge[k * 2 + 1];
        const a = Math.sin(ph * Math.PI);
        if (a < 0.15) continue;
        ctx.fillStyle = `rgba(255,248,255,${a.toFixed(2)})`;
        ctx.fillRect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), size, size);
        if (a > 0.55) {
          ctx.fillStyle = `rgba(226,196,255,${(a * 0.7).toFixed(2)})`;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillRect(Math.round((x + dx - camera.x) * z), Math.round((y + dy - camera.y) * z), size, size);
        }
      }
    }
    for (const t of world.miningTrips || []) {
      const tm = t.miners[0];
      if (!t.over && tm && tm.x > vx0 && tm.x < vx1 && (tm.floor ?? t.floor) > vy0 && (tm.floor ?? t.floor) - ROOM_H < vy1) drawMiner(renderer, world, t, tm, time, cell);
    }
    for (const op of world.miningOps || []) {
      // (the prospector is drawn wherever his drift has taken him)
      const pr = op.miners.find((m) => m.state === 'prospect');
      if (pr && pr.x > vx0 && pr.x < vx1 && pr.floor > vy0 && pr.floor - ROOM_H < vy1) drawMiner(renderer, world, op, pr, time, cell);
      if (op.room.x1 + 200 < vx0 || op.room.x0 - 200 > vx1 || op.floor < vy0 || op.floor - ROOM_H > vy1) continue;
      // Belt: moving cleats on the rubber, and the ore lumps riding it.
      const { tail, head } = op.belt, d = Math.sign(head - tail) || 1;
      const shift = Math.floor(time * BELT_SPEED);
      for (let x = Math.min(tail, head); x <= Math.max(tail, head); x += 1) {
        if ((((x - tail) * d - shift) % 6 + 6) % 6 === 0) backCell(x, op.floor - 7, 'rgb(70,70,76)');
      }
      for (const c of op.belt.cargo) {
        const x = Math.round(tail + d * c.s);
        for (let dy = 0; dy < 2; dy += 1) for (let dx = -1; dx <= 1; dx += 1) backCell(x + dx, op.floor - 8 - dy, dy ? 'rgb(176,112,226)' : `rgb(${ORE_LUMP})`);
      }
      // Miners, with their lamps and loads.
      for (const m of op.miners) if (m.state !== 'prospect') drawMiner(renderer, world, op, m, time, cell);
    }
  }
  function drawMiner(renderer, world, op, m, time, cell) {
    const floor = Math.round(m.state === 'prospect' ? m.floor : op.floor);
    let clip = 'walk', frame = 0;
    const p = op.prospect, digging = m.state === 'prospect' && p && !p.back && m.pi === p.path.length / 2 - 1;
    const moving = m.state.startsWith('to') || m.state === 'idle' || (m.state === 'prospect' && !digging);
    if (moving) frame = Math.floor(m.walked / 5);
    if (m.state === 'load' || m.state === 'pickup') { clip = 'crouch'; frame = Math.min(3, Math.floor((m.timer < 0.4 ? m.timer : 0.8 - m.timer) / 0.1)); }
    const s = PW.unitArt.sprite('miner', clip, frame, world.styles ? world.styles[op.side] : '');
    if (!s) return;
    const drilling = m.state === 'drill' || digging;
    const jitter = drilling && ((time * 30) | 0) & 1 ? 1 : 0;
    PW.unitArt.lampCone(renderer, s, m.x + jitter, floor, m.facing);
    PW.unitArt.draw(renderer, s, m.x + jitter, floor, m.facing);
    if (drilling && ((time * 20 + m.lane) | 0) % 3 === 0) cell(m.x + m.facing * 13, floor - 11, 'rgb(255,236,170)');
    if (m.load || m.carry) {
      // The ore load carried at the chest, in front.
      for (let dy = 0; dy < 3; dy += 1) for (let dx = 0; dx < 4; dx += 1) cell(m.x + m.facing * (4 + dx), floor - 13 - dy, dy === 2 ? 'rgb(190,130,240)' : `rgb(${ORE_LUMP})`);
    }
  }
  // Highlight a vein's outline (pulsing) while planning a tunnel that would reach it.
  function drawHighlight(renderer, world, node, time) {
    const cells = outline(world, node);
    const { ctx, camera, view } = renderer;
    const z = camera.zoom, size = Math.max(1, Math.round(z));
    const a = 0.45 + 0.35 * Math.sin(time * 6);
    ctx.fillStyle = `rgba(255,236,120,${a.toFixed(2)})`;
    ctx.beginPath();
    const x1 = camera.x + view.width / z, y1 = camera.y + view.height / z;
    for (let k = 0; k < cells.length; k += 2) {
      const x = cells[k], y = cells[k + 1];
      if (x < camera.x - 1 || x > x1 || y < camera.y - 1 || y > y1) continue;
      ctx.rect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), size, size);
    }
    ctx.fill();
  }

  PW.mining = { REACH, ROOM_H, SNIFF, veinNear, outline, open, openFromWorkings, afterDig, step, draw, drawHighlight, list, prospectFor, driveStep, expedition, trips, storeOf, crossesRoad, crossesAquifer, HM_KEEP, HM_LOW };
  void ops;
})();
