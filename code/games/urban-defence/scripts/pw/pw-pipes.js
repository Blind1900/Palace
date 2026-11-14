'use strict';
// Supply pipelines (ported from the beta's pipeline rules, at native scale). Each town runs an SM,
// an HM and a water line underground between its own structures. A line follows the ground at its
// cover depth and dips under basements, the core pit and buried cores; where it crosses a tunnel or
// a shaft it is fixed to the back wall, so it never blocks the way. Risers connect each building,
// the lake pump and the mining operations.
//
// Each line is built like the real thing, laid on a sand bed in its trench with a coloured warning
// tape above it: water in a grey lead/iron main with bell joints, SM in a green conduit with a
// copper shield braid, HM on a rubber conveyor belt over rollers inside a riveted steel gallery.
//
// Cargo is real: every unit of water, SM or ore travels as pixel particles from its source (the
// pump, a farm, a mining hopper) down its riser, along the line and up the riser of the building
// it is bound for, where it is counted in. Particles queue behind each other and at a break; a blast
// that cuts the line spills the water in the cut span. The crew re-lays a broken span around the
// crater after a delay, a few cells a second, for HM per cell. Pumps only measure their lake: they
// never take water out.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;
  const { structural, terrain } = PW.mat;

  const ORE_BITS = [[240, 210, 255], [192, 107, 252], [155, 86, 203], [127, 71, 167]];
  const LINES = [
    // Cover depths put the lines at the foot of a town's made ground (about 4.5 to 6.5 m down).
    { resource: 'sm', depth: 64, look: 'conduit', jacket: [52, 130, 46], wall: [176, 120, 70], wallDark: [96, 62, 36], channel: [14, 30, 14],
      tape: [86, 196, 74], cargo: [[127, 214, 91], [190, 206, 96], [96, 170, 70]], speed: 26, every: 0.3 },
    { resource: 'hm', depth: 76, look: 'conveyor', jacket: [150, 120, 40], wall: [104, 86, 40], wallDark: [72, 60, 30], channel: [30, 24, 12],
      tape: [232, 196, 52], cargo: ORE_BITS, speed: 15, every: 0 },
    { resource: 'water', depth: 88, look: 'main', jacket: [116, 124, 130], wall: [84, 92, 98], wallDark: [64, 70, 76], channel: [10, 24, 32],
      tape: [70, 136, 230], cargo: [[140, 210, 226], [96, 170, 214], [200, 236, 246]], speed: 42, every: 0.1 },
  ];
  const HOIST = 40;                  // cells per second up and down the risers
  // Jacket, wall (braid / steel / iron), three channel rows, wall, jacket: 7 cells (0.5 m).
  const BORE = 7;
  const CHANNEL = 2;                 // first channel row; lanes 0-2 are rows 2-4
  const BED = 2;                     // sand bed rows above and below the pipe
  const OWNER_BASE = 60000;
  const REPAIR_DELAY = 6 * 60, REPAIR_CELLS_PER_TICK = 0.1, REPAIR_HM_PER_CELL = 0.25;
  const BELT = [30, 30, 32], BELT_MARK = [62, 62, 60], ROLLER = [150, 150, 142], SAND = [170, 156, 118];

  const rgb = (c) => PW.abgr(c[0] | 0, c[1] | 0, c[2] | 0);
  const tone = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
  // Which lines each kind of building draws from or feeds.
  const USES = {
    core: { sm: 'in', hm: 'in', water: 'in' }, population: { sm: 'in', water: 'in' }, military: { hm: 'in', sm: 'in' },
    farm: { sm: 'out', water: 'in' }, mine: { hm: 'out' }, pump: { water: 'out' }, mining: { hm: 'out' },
  };

  function createPipes(world) {
    const { mat, width: W, height: H } = world;
    const lines = [];
    const stats = { lines: 0, cells: 0, broken: 0, repaired: 0, repairHM: 0, packets: 0, spawned: 0, delivered: { sm: 0, hm: 0, water: 0 }, spilled: 0 };
    let tick = 0;

    // ---- Routing ----------------------------------------------------------------------------------
    const isTunnel = (x, y) => (PW.getFlags(world, x, y) & FLAG.TUNNEL) !== 0;
    const buildingOwned = (x, y) => { const o = PW.getOwner(world, x, y); return o > 0 && o < OWNER_BASE - 10000; };
    function blocked(x, y) {
      const i = y * W + x, id = mat[i] & ID_MASK;
      if (id === M.ORE || id === M.CORE || (structural[id] && !isTunnel(x, y))) return true;
      // An underground cavity (a cave, a blast hole) is gone round below, not bridged.
      if (PW.mat.open[id] && y > world.groundTop[x] && !isTunnel(x, y) && !buildingOwned(x, y) && !PW.getLayer(world, 'back', x, y)) return true;
      // A building's structure (not a tunnel network, and not plain ground a building owns, such
      // as the soil lining a mine shaft).
      return buildingOwned(x, y) && !isTunnel(x, y) && !terrain[id];
    }
    // Pipe top row per column: cover depth under the ground, then below anything in the way.
    function contour(x0, x1, depth) {
      const ys = new Int32Array(x1 - x0 + 1);
      // The ground a line follows: the shallowest ground within BRIDGE columns, so it crosses a
      // shaft or a narrow cut (fixed to its back wall) instead of diving down into it. Under a lake
      // the ground is its bed, not the water surface.
      const BRIDGE = 20;
      // The land a line follows: ground that belongs to a building (a plinth, a foundation pad, a
      // headframe's base) is passed over down to the land under it.
      const groundAt = (x) => {
        let g = world.groundTop[x];
        for (let n = 0; n < 600 && g < H - 1; n += 1) {
          const id = mat[g * W + x] & ID_MASK;
          if (PW.mat.ground[id] && (terrain[id] || !buildingOwned(x, g))) break;
          g += 1;
        }
        if ((mat[g * W + x] & ID_MASK) === M.WATER) g = PW.supportBelow(world, x, g, true);
        return g;
      };
      for (let x = x0; x <= x1; x += 1) {
        // Bridge only openings that belong to a tunnel or a building (a shaft, the core pit's
        // edge): they have a back wall. Open ground lowered by a crater (no back wall) is followed
        // down, so the line goes under it.
        // Across an opening the line keeps to the lower of its two banks (a shaft between a street
        // and a hillside is crossed at street level); beside a bank it keeps to the bank's top.
        const own = groundAt(x);
        const bank = (dir) => {
          for (let d = 1; d <= BRIDGE; d += 1) { const g = groundAt(Math.max(0, Math.min(W - 1, x + dir * d))); if (g < own - 4) return g; }
          return own;
        };
        const left = bank(-1), right = bank(1);
        let ground = left < own && right < own ? Math.max(left, right) : Math.min(left, right);
        for (let y = ground; y < own && ground < own; y += 1) {
          const id = mat[y * W + x] & ID_MASK;
          if (PW.mat.open[id] && !isTunnel(x, y) && !buildingOwned(x, y) && !PW.getLayer(world, 'back', x, y)) ground = own;
        }
        let y = ground + depth;
        for (let scan = ground; scan < y + BORE + 3 && scan < H - 40; scan += 1) {
          if (blocked(x, scan)) y = Math.max(y, scan + 4);
        }
        ys[x - x0] = y;
      }
      // Bends no steeper than 45°: only ever deepen to clear neighbours.
      for (let k = 1; k < ys.length; k += 1) ys[k] = Math.max(ys[k], ys[k - 1] - 1);
      for (let k = ys.length - 2; k >= 0; k -= 1) ys[k] = Math.max(ys[k], ys[k + 1] - 1);
      return ys;
    }

    // ---- The pipe itself -----------------------------------------------------------------------------
    // Colour of bore row `row` at `along` cells down the line.
    function pipeColor(spec, row, along) {
      const h = PW.hash2(along, row * 31 + 7);
      if (row === 0 || row === BORE - 1) {
        let c = tone(spec.jacket, row === 0 ? 1.16 : 0.7);
        if (spec.look === 'main' && (h & 15) === 0) c = tone([150, 162, 150], row === 0 ? 1 : 0.8);         // patina
        if (spec.look === 'main' && along % 48 < 4) c = tone(spec.jacket, row === 0 ? 1.28 : 0.82);           // bell joint
        if (spec.look === 'conveyor' && along % 12 === 0) c = tone(spec.jacket, row === 0 ? 1.45 : 1.05);      // rivet
        return c;
      }
      if (row === 1 || row === BORE - 2) {
        if (spec.look === 'conduit') return (along + row) % 2 ? spec.wall : spec.wallDark;                    // shield braid
        if (spec.look === 'conveyor' && row === BORE - 2) return along % 10 < 2 ? ROLLER : spec.wallDark;      // rollers
        return row === 1 ? spec.wall : spec.wallDark;
      }
      if (spec.look === 'conveyor' && row === BORE - 3) return along % 6 === 0 ? BELT_MARK : BELT;            // belt
      return spec.channel;
    }
    // Lay one pipe cell: in the ground it is a PIPE cell; across open tunnel it is drawn on the back
    // wall; through a tunnel's lining it shows in a sleeve.
    function layCell(line, x, y, color) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      const id = mat[y * W + x] & ID_MASK;
      if (id === M.AIR) {
        if (!isTunnel(x, y) && y < world.groundTop[x]) return false;   // never in the open sky
        PW.setLayer(world, 'back', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      }
      if (id === M.REINFORCED || id === M.LINING) {
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      }
      if (!terrain[id] && id !== M.PIPE) return false;
      if (id === M.ORE) return false;
      PW.set(world, x, y, M.PIPE, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
      PW.setOwner(world, x, y, line.owner);
      return true;
    }
    // The trench around a pipe: a sand bed above and below, and the warning tape in the backfill
    // two cells over the bed (only in natural ground or fill; never in a tunnel or a building).
    function bedCell(x, y, color) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
      const id = mat[y * W + x] & ID_MASK;
      if (!terrain[id] || id === M.ORE || id === M.BEDROCK || PW.getOwner(world, x, y) || isTunnel(x, y)) return;
      PW.set(world, x, y, M.FILL, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
    }
    function layColumn(line, x) {
      const y = line.ys[x - line.x0], spec = line.spec;
      for (let b = 1; b <= BED; b += 1) {
        const sand = (k) => tone(SAND, (PW.hash2(x, y + k) & 3) === 0 ? 0.88 : 1);
        bedCell(x, y - b, sand(-b));
        bedCell(x, y + BORE - 1 + b, sand(b));
      }
      if (x % 8 < 3) bedCell(x, y - BED - 3, tone(spec.tape, 0.72));
      for (let r = 0; r < BORE; r += 1) layCell(line, x, y + r, pipeColor(spec, r, x));
      // A water main's bell joints stand proud of the pipe.
      if (spec.look === 'main' && x % 48 < 4) { layCell(line, x, y - 1, tone(spec.jacket, 1.2)); layCell(line, x, y + BORE, tone(spec.jacket, 0.72)); }
    }
    // A riser between the line and an anchor at (x, y): jacket, channel, jacket.
    function layRiser(line, anchor) {
      const lineY = line.ys[Math.max(0, Math.min(line.ys.length - 1, anchor.x - line.x0))];
      const yA = Math.min(anchor.y, lineY), yB = Math.max(anchor.y, lineY + BORE - 1);
      for (let y = yA; y <= yB; y += 1) {
        for (let r = 0; r < 3; r += 1) {
          const joint = (y - yA) % 24 === 0;
          const color = r === 1 ? line.spec.channel : tone(line.spec.jacket, (r === 0 ? 1.12 : 0.72) * (joint ? 1.15 : 1));
          layCell(line, anchor.x - 1 + r, y, color);
        }
      }
      return { x: anchor.x, y0: yA, y1: yB, anchorY: anchor.y, flow: anchor.flow, kind: anchor.kind, building: anchor.building, op: anchor.op,
        occ: new Uint8Array(yB - yA + 1), timer: 0, pending: 0 };
    }

    // ---- Anchors -------------------------------------------------------------------------------------
    // Where each building connects: under its floor (below anything it owns in that column). Its
    // three lines rise in their own columns, `offset` cells apart.
    function buildingAnchor(b, kind, offset = 0) {
      const cx = Math.round((b.body.left + b.body.right) / 2) + offset;
      for (let shift = 0; shift < 60; shift += 6) {
        for (const x of [cx + shift, cx - shift]) {
          let y = b.ground + 1, clear = true;
          while (y < b.ground + 140 && PW.getOwner(world, x, y) === b.id) y += 1;
          for (let k = y; k < y + 8; k += 1) if (blocked(x, k)) clear = false;
          if (clear) return { x, y, kind, building: b.id };
        }
      }
      return { x: cx, y: b.ground + 12, kind, building: b.id };
    }
    function anchorsFor(settlement) {
      const out = [];
      for (const b of settlement.buildings) {
        if (USES[b.type]) out.push({ ...buildingAnchor(b, b.type), b });
        if (b.pump) out.push({ x: b.pump.x, y: b.pump.y + 2, kind: 'pump', building: b.id });
      }
      // This town's own mining operations (each neutral town has its own mine).
      const near = (x) => x > settlement.streetLeft - 600 && x < settlement.streetRight + 600;
      for (const op of world.miningOps || []) {
        if (op.side === settlement.side && op.riser && near(op.riser.x)) out.push({ x: op.riser.x, y: op.riser.y, kind: 'mining', op: op.id });
      }
      return out;
    }

    // ---- Build -------------------------------------------------------------------------------------
    function newLine(settlement, spec, x0, x1, coreX) {
      return { id: lines.length, side: settlement.side, settlement, resource: spec.resource, spec, owner: OWNER_BASE + lines.length,
        x0, x1, ys: contour(x0, x1, spec.depth), coreX, risers: [], broken: new Uint8Array(x1 - x0 + 1), brokenAt: new Int32Array(x1 - x0 + 1),
        occ: new Uint8Array((x1 - x0 + 1) * 3), packets: [], next: 0 };
    }
    function build() {
      for (const settlement of world.settlements || []) {
        // Neutral towns are piped as well: their farms and pumps feed their own houses (their
        // mines stockpile until the town is taken).
        const anchors = anchorsFor(settlement);
        const core = settlement.buildings.find((b) => b.type === 'core');
        const coreX = core ? Math.round((core.body.left + core.body.right) / 2) : (settlement.streetLeft + settlement.streetRight) >> 1;
        for (const [index, spec] of LINES.entries()) {
          const users = anchors.filter((a) => USES[a.kind] && USES[a.kind][spec.resource])
            .map((a) => (a.b ? { ...buildingAnchor(a.b, a.kind, (index - 1) * 6), b: a.b } : a));
          if (users.length < 2) continue;
          const x0 = Math.min(...users.map((a) => a.x)) - 4, x1 = Math.max(...users.map((a) => a.x)) + 4;
          const line = newLine(settlement, spec, x0, x1, coreX);
          for (let x = x0; x <= x1; x += 1) layColumn(line, x);
          for (const a of users) line.risers.push(layRiser(line, { ...a, flow: USES[a.kind][spec.resource] }));
          stats.cells += x1 - x0 + 1;
          lines.push(line);
        }
      }
      stats.lines = lines.length;
      world.pipes = api;
      return lines;
    }

    // ---- Breaks and repair -----------------------------------------------------------------------------
    const intactAt = (line, x) => {
      const y = line.ys[x - line.x0];
      for (let r = 1; r < BORE - 1; r += 1) {
        const id = mat[(y + r) * W + x] & ID_MASK;
        if (id === M.PIPE) return true;
        if (id === M.AIR && isTunnel(x, y + r) && PW.getLayer(world, 'back', x, y + r)) return true;     // along a tunnel wall
        if ((id === M.REINFORCED || id === M.LINING) && (PW.getFlags(world, x, y + r) & FLAG.FIXTURE)) return true;   // in a sleeve
      }
      return false;
    };
    function check() {
      let broken = 0;
      for (const line of lines) {
        for (let x = line.x0; x <= line.x1; x += 1) {
          const k = x - line.x0;
          if (!intactAt(line, x)) {
            if (!line.broken[k]) { line.broken[k] = 1; line.brokenAt[k] = tick; spill(line, x); }
            broken += 1;
          } else line.broken[k] = 0;
        }
      }
      stats.broken = broken;
    }
    // The crew re-lays broken columns after a delay, along the new contour (around the crater).
    let repairBudget = 0;
    function repair() {
      repairBudget = Math.min(4, repairBudget + REPAIR_CELLS_PER_TICK);
      for (const line of lines) {
        for (let k = 0; k < line.broken.length && repairBudget >= 1; k += 1) {
          if (!line.broken[k] || tick - line.brokenAt[k] < REPAIR_DELAY) continue;
          const x = line.x0 + k;
          const fresh = contour(Math.max(line.x0, x - 2), Math.min(line.x1, x + 2), line.spec.depth);
          line.ys[k] = Math.max(fresh[Math.min(2, x - Math.max(line.x0, x - 2))], line.ys[k]);
          layColumn(line, x);
          if (intactAt(line, x)) {
            line.broken[k] = 0;
            repairBudget -= 1;
            stats.repaired += 1;
            stats.repairHM += REPAIR_HM_PER_CELL;
            // Keep the bends no steeper than 45°: neighbours step down to meet a deeper span.
            for (const n of [k - 1, k + 1]) {
              if (n < 0 || n >= line.ys.length || line.broken[n]) continue;
              if (line.ys[n] < line.ys[k] - 1) { line.ys[n] = line.ys[k] - 1; layColumn(line, line.x0 + n); }
            }
          }
        }
      }
    }
    // Is the line carrying from (x) to the core? (no break between them)
    function flowing(line, x) {
      const a = Math.min(x, line.coreX), b = Math.max(x, line.coreX);
      for (let c = Math.max(line.x0, a); c <= Math.min(line.x1, b); c += 1) if (line.broken[c - line.x0]) return false;
      return true;
    }
    function lineFor(side, resource) { return lines.find((l) => l.side === side && l.resource === resource) || null; }
    // Connect a mining operation opened during play: extend its side's HM line to it if needed,
    // then lay the riser up from its hopper.
    function attach(op) {
      const line = lineFor(op.side, 'hm');
      if (!line || !op.riser) return false;
      const x = op.riser.x;
      if (x - 4 < line.x0 || x + 4 > line.x1) {
        const x0 = Math.min(line.x0, x - 4), x1 = Math.max(line.x1, x + 4);
        const ys = new Int32Array(x1 - x0 + 1), fresh = contour(x0, x1, line.spec.depth);
        for (let c = x0; c <= x1; c += 1) ys[c - x0] = c >= line.x0 && c <= line.x1 ? line.ys[c - line.x0] : fresh[c - x0];
        const broken = new Uint8Array(ys.length), brokenAt = new Int32Array(ys.length), occ = new Uint8Array(ys.length * 3);
        broken.set(line.broken, line.x0 - x0); brokenAt.set(line.brokenAt, line.x0 - x0); occ.set(line.occ, (line.x0 - x0) * 3);
        const old0 = line.x0, old1 = line.x1;
        Object.assign(line, { x0, x1, ys, broken, brokenAt, occ });
        for (let c = x0; c <= x1; c += 1) if (c < old0 || c > old1) layColumn(line, c);
      }
      line.risers.push(layRiser(line, { x, y: op.riser.y, flow: 'out', kind: 'mining', op: op.id }));
      return true;
    }

    // ---- Cargo ------------------------------------------------------------------------------------------
    // A packet is one unit of cargo: a water droplet, an SM grain or a 2x2 ore chunk. It goes down
    // (or up) its source riser to the line's middle row, along the line in one of the three channel
    // lanes (ore rides the belt, lanes 0-1), then along the destination riser to the building.
    const laneOf = (line, x, lane) => (x - line.x0) * 3 + lane;
    const rowOf = (line, x, lane) => line.ys[x - line.x0] + CHANNEL + lane;
    const lineRow = (line, x) => line.ys[Math.max(0, Math.min(line.ys.length - 1, x - line.x0))] + CHANNEL + 1;
    const chunky = (line) => line.spec.look === 'conveyor';
    // Lanes a packet takes up at column x (an ore chunk fills both belt lanes). A chunk is two cells
    // long, its lead cell at x: the next one ahead must leave a cell for its tail.
    const lanesOf = (line, lane) => (chunky(line) ? [0, 1] : [lane]);
    const free = (line, x, lane, dir) => {
      if (x < line.x0 || x > line.x1 || line.broken[x - line.x0]) return false;
      for (const l of lanesOf(line, lane)) if (line.occ[laneOf(line, x, l)]) return false;
      const ahead = x + dir;
      return !chunky(line) || ahead < line.x0 || ahead > line.x1 || !line.occ[laneOf(line, ahead, 0)];
    };
    const heading = (p) => Math.sign(p.dst.x - p.x) || 1;
    const occupy = (line, x, lane, v) => { for (const l of lanesOf(line, lane)) line.occ[laneOf(line, x, l)] = v; };
    // Where a packet bound for `riser` leaves the line, and which way it heads to get there.
    function destinations(line) {
      const into = line.risers.filter((r) => r.flow === 'in');
      // Ore all goes to the core when there is one (the conveyor runs one way).
      if (chunky(line)) { const core = into.filter((r) => r.kind === 'core'); return core.length ? core : into; }
      return into;
    }
    function spawn(line, riser) {
      const targets = destinations(line);
      if (!targets.length) return false;
      const at = riser.anchorY < lineRow(line, riser.x) ? 0 : riser.occ.length - 1;
      if (riser.occ[at]) return false;
      const dst = targets[line.next++ % targets.length];
      riser.occ[at] = 1;
      line.packets.push({ stage: 0, riser, dst, x: riser.x, y: riser.y0 + at, lane: 1, frac: 0, shade: PW.hash2(stats.spawned, line.id) & 3 });
      stats.spawned += 1;
      return true;
    }
    // Producers: a pump sends water and a farm SM at a steady rate; a mining operation sends the
    // ore its miners load (see carry()).
    function produce(dt) {
      for (const line of lines) {
        if (!line.spec.every) continue;
        for (const riser of line.risers) {
          if (riser.flow !== 'out' || riser.kind === 'mine') continue;
          riser.timer += dt;
          if (riser.timer >= line.spec.every && spawn(line, riser)) riser.timer = 0;
        }
      }
      for (const line of lines) for (const riser of line.risers) if (riser.pending > 0 && spawn(line, riser)) riser.pending -= 1;
    }
    // A mining operation loads `value` HM into its hopper riser.
    function carry(op, value) {
      const line = lineFor(op.side, 'hm');
      const riser = line && line.risers.find((r) => r.op === op.id);
      if (riser) riser.pending += value;
    }
    function moveRiser(packet, riser, toward) {
      const k = packet.y - riser.y0, n = k + Math.sign(toward - packet.y);
      if (n < 0 || n >= riser.occ.length || riser.occ[n]) return false;
      riser.occ[k] = 0; riser.occ[n] = 1; packet.y = riser.y0 + n;
      return true;
    }
    function stepPacket(line, p) {
      if (p.stage === 0) {
        // Down (or up) the source riser to the line's middle row, then into a free lane.
        const target = lineRow(line, p.riser.x);
        if (p.y !== target) return moveRiser(p, p.riser, target);
        for (const lane of chunky(line) ? [0] : [1, 0, 2]) {
          if (!free(line, p.x, lane, heading(p))) continue;
          p.riser.occ[p.y - p.riser.y0] = 0;
          p.stage = 1; p.lane = lane; p.y = rowOf(line, p.x, lane);
          occupy(line, p.x, lane, 1);
          return true;
        }
        return false;
      }
      if (p.stage === 1) {
        if (p.x === p.dst.x) {
          // Into the destination riser.
          const k = lineRow(line, p.x) - p.dst.y0;
          if (k < 0 || k >= p.dst.occ.length || p.dst.occ[k]) return false;
          occupy(line, p.x, p.lane, 0);
          p.dst.occ[k] = 1; p.stage = 2; p.y = p.dst.y0 + k;
          return true;
        }
        const dir = heading(p), nx = p.x + dir;
        // Water and grain slip past a hold-up into another lane; ore stays on its belt.
        const lanes = chunky(line) ? [0] : [p.lane, (p.lane + 1) % 3, (p.lane + 2) % 3];
        for (const lane of lanes) {
          if (!free(line, nx, lane, dir)) continue;
          occupy(line, p.x, p.lane, 0);
          p.x = nx; p.lane = lane; p.y = rowOf(line, nx, lane);
          occupy(line, nx, lane, 1);
          return true;
        }
        return false;
      }
      // Up (or down) the destination riser to the building, where it is counted in.
      if (p.y !== p.dst.anchorY) return moveRiser(p, p.dst, p.dst.anchorY);
      p.dst.occ[p.y - p.dst.y0] = 0;
      p.done = true;
      stats.delivered[line.resource] += 1;
      const stock = world.stock || (world.stock = {});
      const own = stock[line.side] || (stock[line.side] = { sm: 0, hm: 0, water: 0 });
      own[line.resource] += 1;
      return true;
    }
    function moveCargo(dt) {
      let count = 0;
      for (const line of lines) {
        const v = line.spec.speed * dt, lift = Math.max(line.spec.speed, HOIST) * dt;
        for (const p of line.packets) {
          p.frac += p.stage === 1 ? v : lift;
          while (p.frac >= 1 && !p.done) {
            if (!stepPacket(line, p)) { p.frac = Math.min(p.frac, 1); break; }
            p.frac -= 1;
          }
        }
        if (line.packets.some((p) => p.done)) line.packets = line.packets.filter((p) => !p.done);
        count += line.packets.length;
      }
      stats.packets = count;
    }
    // A cut spills what was in the span: water runs out into the hole as real water; grain and ore
    // are lost in the rubble.
    function spill(line, x) {
      for (const p of line.packets) {
        if (p.stage !== 1 || p.x !== x) continue;
        occupy(line, p.x, p.lane, 0);
        p.done = true;
        stats.spilled += 1;
        if (line.resource === 'water' && (mat[p.y * W + p.x] & ID_MASK) === M.AIR) PW.set(world, p.x, p.y, M.WATER);
      }
    }

    function step(dt = 1 / 60) {
      tick += 1;
      if (tick % 30 === 0) check();
      if (stats.broken) repair();
      produce(dt);
      moveCargo(dt);
    }

    // ---- Drawing: the belt runs and the cargo moves ---------------------------------------------------
    function draw(renderer, time) {
      const { ctx, camera, view } = renderer;
      const z = camera.zoom;
      if (z < 0.25) return;
      const size = Math.max(1, Math.round(z));
      const vx0 = camera.x - 4, vx1 = camera.x + view.width / z + 4, vy0 = camera.y - 4, vy1 = camera.y + view.height / z + 4;
      const cell = (x, y, c) => {
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;
        ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        ctx.fillRect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), size, size);
      };
      for (const line of lines) {
        if (line.x1 < vx0 || line.x0 > vx1) continue;
        const spec = line.spec;
        // The conveyor belt's tread marks run towards the core.
        if (chunky(line) && z >= 1) {
          const shift = Math.floor(time * spec.speed);
          for (let x = Math.max(line.x0, Math.floor(vx0)); x <= Math.min(line.x1, Math.ceil(vx1)); x += 1) {
            if (line.broken[x - line.x0]) continue;
            const toward = x < line.coreX ? 1 : -1;
            const y = line.ys[x - line.x0] + BORE - 3;
            if ((((x - toward * shift) % 6) + 6) % 6 === 0) cell(x, y, BELT_MARK);
            else if (((((x - toward * shift) % 6) + 6) % 6) === 3) cell(x, y, BELT);
          }
        }
        const cargo = spec.cargo;
        for (const p of line.packets) {
          if (p.x < vx0 - 2 || p.x > vx1 + 2) continue;
          if (spec.resource === 'water') cell(p.x, p.y, cargo[p.shade % 3]);
          else if (spec.resource === 'sm') {
            cell(p.x, p.y, cargo[p.shade % 3]);
            if (p.stage === 1) cell(p.x - heading(p), p.y, tone(cargo[p.shade % 3], 0.8));
          } else if (p.stage === 1) {
            // A 2x2 ore chunk sitting on the belt (lead cell and tail), its bright facet up-left.
            const y = line.ys[p.x - line.x0] + CHANNEL, a = Math.min(p.x, p.x - heading(p));
            cell(a, y, cargo[(p.shade & 1) ? 0 : 1]); cell(a + 1, y, cargo[1]);
            cell(a, y + 1, cargo[2]); cell(a + 1, y + 1, cargo[3]);
          } else cell(p.x, p.y, cargo[1 + (p.shade % 3)]);
        }
      }
    }

    const api = { build, step, draw, attach, carry, lines, stats, flowing, lineFor, contour, LINES, BORE, BED };
    return api;
  }

  PW.createPipes = createPipes;
  PW.PIPE_LINES = LINES;
})();
