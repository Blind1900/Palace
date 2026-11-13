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
  const MINERS = 3;
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
    if (all.some((op) => op.node === node && op.net === net.id)) return null;
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
        m.timer += dt;
        if (m.timer >= DRILL_TIME) {
          m.timer = 0;
          const v = drillCell(world, op, m.x + op.dir * 12, op.floor - 10 - m.lane * 8);
          if (!v) { refreshFace(world, op); m.state = m.load ? 'toBelt' : 'toFace'; break; }
          if (v < 0) break;   // drove through rock towards the vein: no ore this time
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
  function step(world, dt) {
    for (const op of list(world)) {
      for (const m of op.miners) stepMiner(world, op, m, dt);
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
    for (const op of world.miningOps || []) {
      if (op.room.x1 + 200 < vx0 || op.room.x0 - 200 > vx1 || op.floor < vy0 || op.floor - ROOM_H > vy1) continue;
      // Belt: moving cleats on the rubber, and the ore lumps riding it.
      const { tail, head } = op.belt, d = Math.sign(head - tail) || 1;
      const shift = Math.floor(time * BELT_SPEED);
      for (let x = Math.min(tail, head); x <= Math.max(tail, head); x += 1) {
        if ((((x - tail) * d - shift) % 6 + 6) % 6 === 0) cell(x, op.floor - 7, 'rgb(70,70,76)');
      }
      for (const c of op.belt.cargo) {
        const x = Math.round(tail + d * c.s);
        for (let dy = 0; dy < 2; dy += 1) for (let dx = -1; dx <= 1; dx += 1) cell(x + dx, op.floor - 8 - dy, dy ? 'rgb(176,112,226)' : `rgb(${ORE_LUMP})`);
      }
      // Miners, with their lamps and loads.
      for (const m of op.miners) {
        let clip = 'walk', frame = 0;
        const moving = m.state.startsWith('to') || m.state === 'idle';
        if (moving) frame = Math.floor(m.walked / 5);
        if (m.state === 'load' || m.state === 'pickup') { clip = 'crouch'; frame = Math.min(3, Math.floor((m.timer < 0.4 ? m.timer : 0.8 - m.timer) / 0.1)); }
        const s = PW.unitArt.sprite('miner', clip, frame);
        if (!s) continue;
        const jitter = m.state === 'drill' && ((time * 30) | 0) & 1 ? 1 : 0;
        PW.unitArt.lampCone(renderer, s, m.x + jitter, op.floor, m.facing);
        PW.unitArt.draw(renderer, s, m.x + jitter, op.floor, m.facing);
        if (m.state === 'drill' && ((time * 20 + m.lane) | 0) % 3 === 0) cell(m.x + m.facing * 13, op.floor - 11, 'rgb(255,236,170)');
        if (m.load || m.carry) {
          // The ore load carried at the chest, in front.
          for (let dy = 0; dy < 3; dy += 1) for (let dx = 0; dx < 4; dx += 1) cell(m.x + m.facing * (4 + dx), op.floor - 13 - dy, dy === 2 ? 'rgb(190,130,240)' : `rgb(${ORE_LUMP})`);
        }
      }
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

  PW.mining = { REACH, ROOM_H, veinNear, outline, open, openFromWorkings, afterDig, step, draw, drawHighlight, list };
  void ops;
})();
