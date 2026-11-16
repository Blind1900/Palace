'use strict';
// The resource pipeline (step E): ONE thin bundle per town, about a metre down, running through
// the cores and connected only to them - no machines. The bundle carries all three resources in
// three lanes inside one casing (HM on top, SM in the middle, water below), threads every
// building's core bed through its left and right connector sockets (the user's core sketch), and
// reaches farther out to the military: the base's bundle runs on under the wild to its mountain
// outposts and flank bunkers. The dead god machine grips the line: black tendril wisps wrap the
// casing every few metres, a white glint where they catch the light.
//
// Cargo is real: every unit of water, SM or ore travels as pixel particles down its lane from its
// source core (a farm's SM, the lake pump's water, a mining hopper's ore) to the core it is bound
// for, passing through the beds of the cores between. A blast that cuts the bundle spills the
// water in the cut span; the crew re-lays a broken stretch around the crater after a delay, a few
// cells a second, for HM per cell. Pumps only measure their lake: they never take water out.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;
  const { structural, terrain } = PW.mat;

  const ORE_BITS = [[240, 210, 255], [192, 107, 252], [155, 86, 203], [127, 71, 167]];
  // The three lanes, top to bottom inside the casing. `row` is the lane's row within the bore.
  const LANES = [
    { resource: 'hm', row: 1, channel: [26, 20, 30], cargo: ORE_BITS, speed: 15, every: 0 },
    { resource: 'sm', row: 3, channel: [14, 28, 14], cargo: [[127, 214, 91], [190, 206, 96], [96, 170, 70]], speed: 26, every: 0.3 },
    { resource: 'water', row: 5, channel: [10, 24, 32], cargo: [[140, 210, 226], [96, 170, 214], [200, 236, 246]], speed: 42, every: 0.1 },
  ];
  const LANE_OF = { hm: 0, sm: 1, water: 2 };
  const DEPTH = 16;                  // cover: about a metre of ground over the casing
  const BORE = 7;                    // casing, hm, divider, sm, divider, water, casing
  const BED = 2;                     // sand bed rows above and below the bundle
  const SMOOTH = 28;                 // a line's bends are eased over this many columns each way
  const HOIST = 40;                  // cells per second up and down the few risers left
  const SPAN = 20;                   // half-width of a core's pass-through span
  const RAMP = 14;                   // columns over which the line eases to a connector row
  const HOP = 11;                    // the bed itself: the bundle vanishes into one port, out the other
  const OWNER_BASE = 60000;
  const REPAIR_DELAY = 6 * 60, REPAIR_HM_PER_CELL = 0.25;
  const TENDRIL_EVERY = 44, TENDRIL_W = 5;

  const CASING = [70, 74, 78], CASING_LIT = [98, 102, 106], CASING_DARK = [48, 52, 56], DIVIDER = [36, 39, 42];
  const SAND = [170, 156, 118], STEEL = [120, 128, 134], STEEL_DARK = [72, 78, 84];
  const INK = [10, 10, 12], WHITE_DIM = [152, 158, 164];

  const rgb = (c) => PW.abgr(c[0] | 0, c[1] | 0, c[2] | 0);
  const tone = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
  // What each kind of building draws from or feeds, through its cores' connectors.
  const TAPS = {
    core: { sm: 'in', hm: 'in', water: 'in' }, population: { sm: 'in', water: 'in' }, military: { hm: 'in', sm: 'in' },
    farm: { sm: 'out', water: 'in' }, mine: { hm: 'out' },
  };

  function createPipes(world) {
    const { mat, width: W, height: H } = world;
    const lines = [];
    const stats = { lines: 0, cells: 0, cores: 0, caps: 0, broken: 0, repaired: 0, repairHM: 0, packets: 0, spawned: 0, delivered: { sm: 0, hm: 0, water: 0 }, spilled: 0 };
    let tick = 0;
    // Every registered core span on the map: the bundle may pass through these (and only these)
    // parts of a building, straight into the bed's connector sockets.
    const spans = [];
    const spanAt = (x, y) => spans.some((s) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1);

    // ---- Routing ----------------------------------------------------------------------------------
    const isTunnel = (x, y) => (PW.getFlags(world, x, y) & FLAG.TUNNEL) !== 0;
    const buildingOwned = (x, y) => { const o = PW.getOwner(world, x, y); return o > 0 && o < OWNER_BASE - 10000; };
    function blocked(x, y) {
      if (spanAt(x, y)) return false;
      const i = y * W + x, id = mat[i] & ID_MASK;
      if (id === M.ORE || id === M.CORE || (structural[id] && !isTunnel(x, y))) return true;
      return buildingOwned(x, y) && !isTunnel(x, y) && !terrain[id];
    }
    // Pipe top row per column: cover depth under the ground, then below anything in the way.
    function contour(x0, x1, depth) {
      const depthAt = typeof depth === 'function' ? depth : () => depth;
      const ys = new Int32Array(x1 - x0 + 1);
      const BRIDGE = 20;
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
      const grounds = new Int32Array(ys.length);
      const clear = (x, ground, y) => {
        for (let scan = ground; scan < y + BORE + 3 && scan < H - 40; scan += 1) if (blocked(x, scan)) y = Math.max(y, scan + 4);
        return y;
      };
      for (let x = x0; x <= x1; x += 1) {
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
        grounds[x - x0] = ground;
        ys[x - x0] = clear(x, ground, ground + depthAt(x));
      }
      for (let pass = 0; pass < 3; pass += 1) {
        smooth(ys, SMOOTH);
        let moved = false;
        for (let k = 0; k < ys.length; k += 1) {
          const y = clear(x0 + k, grounds[k], ys[k]);
          if (y !== ys[k]) { ys[k] = y; moved = true; }
        }
        if (!moved) break;
      }
      for (let k = 1; k < ys.length; k += 1) ys[k] = Math.max(ys[k], ys[k - 1] - 1);
      for (let k = ys.length - 2; k >= 0; k -= 1) ys[k] = Math.max(ys[k], ys[k + 1] - 1);
      return ys;
    }
    // In place: each value becomes the mean, over k +/- reach, of the running maximum over the same
    // reach (so no value ever gets shallower than it was).
    function smooth(ys, reach) {
      const n = ys.length, R = Math.min(reach, (n - 1) >> 1);
      if (R < 1) return;
      const peak = new Float64Array(n), queue = new Int32Array(n);
      let head = 0, tail = 0, next = 0;
      for (let k = 0; k < n; k += 1) {
        for (; next <= Math.min(n - 1, k + R); next += 1) {
          while (tail > head && ys[queue[tail - 1]] <= ys[next]) tail -= 1;
          queue[tail++] = next;
        }
        while (queue[head] < k - R) head += 1;
        peak[k] = ys[queue[head]];
      }
      const sum = new Float64Array(n + 1);
      for (let k = 0; k < n; k += 1) sum[k + 1] = sum[k] + peak[k];
      for (let k = 0; k < n; k += 1) {
        const a = Math.max(0, k - R), b = Math.min(n - 1, k + R);
        ys[k] = Math.ceil((sum[b + 1] - sum[a]) / (b - a + 1) - 1e-9);
      }
    }
    // Ease the line into each core's connector row: the span itself sits exactly on the row, and
    // the approach never differs from it by more than a cell a column.
    function snapToCores(ys, x0, cores) {
      for (const core of cores) {
        const T = core.y - 3;
        for (let dx = -SPAN; dx <= SPAN; dx += 1) {
          const k = core.x + dx - x0;
          if (k >= 0 && k < ys.length) ys[k] = T;
        }
        for (let d = 1; d <= RAMP + SPAN; d += 1) {
          for (const k of [core.x - SPAN - d - x0, core.x + SPAN + d - x0]) {
            if (k < 0 || k >= ys.length) continue;
            ys[k] = Math.max(Math.min(ys[k], T + d), T - d);
          }
        }
      }
    }

    // ---- The bundle itself -----------------------------------------------------------------------------
    // Colour of bore row `row` at `along` cells down the line. Every TENDRIL_EVERY cells a black
    // tendril wisp wraps the casing: the god machine's grip on the flow.
    const tendrilAt = (along) => ((along % TENDRIL_EVERY) + TENDRIL_EVERY) % TENDRIL_EVERY < TENDRIL_W;
    function pipeColor(row, along) {
      const wisp = tendrilAt(along);
      if (row === 0 || row === BORE - 1) {
        if (wisp) return ((along + row) % 7 === 3) ? WHITE_DIM : INK;
        if (along % 14 === 0) return tone(row === 0 ? CASING_LIT : CASING_DARK, 1.2);   // a rivet band
        return row === 0 ? CASING_LIT : CASING_DARK;
      }
      if (row === 2 || row === 4) return wisp ? INK : DIVIDER;
      return LANES[(row - 1) >> 1].channel;
    }
    // Lay one bundle cell: in the ground a PIPE cell; across open space underground it is fixed to
    // the wall face; through a core's span it breaches plate and foundation into the bed's socket.
    function layCell(line, x, y, color) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      const id = mat[y * W + x] & ID_MASK;
      const cover = id === M.COVER_ROCK || id === M.COVER_WOOD || id === M.COVER_METAL || id === M.COVER_SAND;
      if (PW.mat.open[id] || id === M.WATER || cover) {
        if (y < world.groundTop[x] && !isTunnel(x, y) && !buildingOwned(x, y)) return false;   // never in the open sky
        PW.setLayer(world, 'pipe', x, y, rgb(color));
        return true;
      }
      if (id === M.REINFORCED || id === M.LINING) {
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      }
      // Through a registered core span the bundle runs in a SLEEVE through whatever the building
      // put there - vault plate, plinth, a stage's timber pier, a buttress - painted across it,
      // the structure itself untouched (nothing load-bearing is cut).
      if (spanAt(x, y) && structural[id]) {
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      }
      if (!terrain[id] && id !== M.PIPE && id !== M.ASPHALT && id !== M.ROADBED) return false;
      if (id === M.ORE) return false;
      PW.set(world, x, y, M.PIPE, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
      PW.setOwner(world, x, y, line.owner);
      return true;
    }
    // The trench around the bundle: a sand bed above and below (ink-dark where a tendril wraps).
    function bedCell(x, y, color) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
      const id = mat[y * W + x] & ID_MASK;
      if (!terrain[id] || id === M.ORE || id === M.BEDROCK || PW.getOwner(world, x, y) || isTunnel(x, y)) return;
      PW.set(world, x, y, M.FILL, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
    }
    // A column of a core's own bed is not laid: the bundle enters one connector and leaves by the
    // other, carried through inside.
    const throughAt = (line, x) => line.cores.some((c) => Math.abs(x - c.x) <= HOP - 1);
    function layColumn(line, x) {
      if (throughAt(line, x)) return;
      const y = line.ys[x - line.x0];
      const wisp = tendrilAt(x);
      for (let b = 1; b <= BED; b += 1) {
        const sand = (k) => (wisp ? tone(INK, 1 + Math.abs(k)) : tone(SAND, (PW.hash2(x, y + k) & 3) === 0 ? 0.88 : 1));
        bedCell(x, y - b, sand(-b));
        bedCell(x, y + BORE - 1 + b, sand(b));
      }
      for (let r = 0; r < BORE; r += 1) layCell(line, x, y + r, pipeColor(r, x));
    }
    // A riser between the line and an anchor at (x, y): for the few taps that are not cores (the
    // lake pump, a mining hopper, the main core's pedestal).
    function layRiser(line, anchor) {
      const lineY = line.ys[Math.max(0, Math.min(line.ys.length - 1, anchor.x - line.x0))];
      const yA = Math.min(anchor.y, lineY), yB = Math.max(anchor.y, lineY + BORE - 1);
      for (let y = yA; y <= yB; y += 1) {
        for (let r = 0; r < 3; r += 1) {
          const joint = (y - yA) % 24 === 0;
          const color = r === 1 ? LANES[LANE_OF[anchor.resource] ?? 2].channel : tone(CASING, (r === 0 ? 1.3 : 0.85) * (joint ? 1.15 : 1));
          layCell(line, anchor.x - 1 + r, y, color);
        }
      }
      return { x: anchor.x, y0: yA, y1: yB, anchorY: anchor.y, flow: anchor.flow, kind: anchor.kind, resource: anchor.resource,
        building: anchor.building, op: anchor.op, occ: new Uint8Array(yB - yA + 1), timer: 0, pending: 0 };
    }
    // The run's underground ends are closed with a bolted steel cap.
    function capEnd(line, side) {
      const endX = side > 0 ? line.x1 : line.x0, y = line.ys[side > 0 ? line.ys.length - 1 : 0];
      for (let c = 1; c <= 2; c += 1) for (let r = -1; r <= BORE; r += 1) {
        const lip = r === -1 || r === BORE, bolt = c === 1 && (r === 1 || r === BORE - 2);
        layCell(line, endX + side * c, y + r, lip ? STEEL_DARK : bolt ? [200, 204, 206] : c === 2 ? tone(STEEL, 0.86) : STEEL);
      }
      stats.caps += 1;
    }
    // Grow a line to [x0, x1]; new columns get their y from ysFor and are laid.
    function extendTo(line, x0, x1, ysFor) {
      const ys = new Int32Array(x1 - x0 + 1);
      for (let c = x0; c <= x1; c += 1) ys[c - x0] = c >= line.x0 && c <= line.x1 ? line.ys[c - line.x0] : ysFor(c);
      const broken = new Uint8Array(ys.length), brokenAt = new Int32Array(ys.length), occ = new Uint8Array(ys.length * 3);
      broken.set(line.broken, line.x0 - x0); brokenAt.set(line.brokenAt, line.x0 - x0); occ.set(line.occ, (line.x0 - x0) * 3);
      const old0 = line.x0, old1 = line.x1;
      Object.assign(line, { x0, x1, ys, broken, brokenAt, occ });
      for (let c = x0; c <= x1; c += 1) if (c < old0 || c > old1) layColumn(line, c);
    }

    // ---- Cores on the line -----------------------------------------------------------------------------
    // The cores a building threads on the bundle: its vault cores, left to right. Each carries the
    // building's taps: which lanes it draws from or feeds there.
    const coresOf = (b) => (b.cores || []).filter((c) => !c.orb && !c.standing).sort((p, q) => p.x - q.x);
    function registerSpan(core, building) {
      // (wide enough for the whole eased approach, so a pier or footing on the way in is sleeved
      // through rather than dived under)
      const reach = SPAN * 2 + RAMP + 2;
      // (the eased approach may ride up to `reach` rows below the connector row before it levels
      // out, so the licence covers that whole wedge; a sleeve only paints, it cuts nothing)
      spans.push({ x0: core.x - reach, x1: core.x + reach, y0: core.y - 24, y1: core.y + reach + BORE, building });
    }
    function coreEntry(core, b) {
      const taps = {};
      for (const [resource, flow] of Object.entries(TAPS[b.type] || {})) taps[resource] = flow;
      return { x: core.x, y: core.y, building: b.id, type: b.type, taps, timer: 0 };
    }

    // ---- Build -------------------------------------------------------------------------------------
    function newLine(side, settlement, x0, x1, cores, coreX) {
      return { id: lines.length, side, settlement, spec: { bundle: true }, owner: OWNER_BASE + lines.length,
        x0, x1, ys: null, coreX, cores, risers: [], broken: new Uint8Array(x1 - x0 + 1), brokenAt: new Int32Array(x1 - x0 + 1),
        occ: new Uint8Array((x1 - x0 + 1) * 3), packets: [], next: { sm: 0, hm: 0, water: 0 } };
    }
    function build() {
      for (const settlement of world.settlements || []) {
        const users = settlement.buildings.filter((b) => TAPS[b.type]);
        const cores = [];
        const anchors = [];
        let mainCore = null;
        for (const b of users) {
          for (const core of coresOf(b)) { registerSpan(core, b.id); cores.push(coreEntry(core, b)); }
          const orb = (b.cores || []).find((c) => c.orb);
          if (orb && b.pit) {
            // The main core: the bundle rises into the pit floor beside the pedestal.
            const rx = orb.x - 26, ry = b.ground + b.pit.depth - 1;
            spans.push({ x0: rx - 3, x1: rx + 3, y0: ry - 2, y1: ry + 12, building: b.id });
            anchors.push({ x: rx, y: ry, kind: 'core', resource: 'water', flow: 'in', building: b.id, main: true });
            mainCore = b;
          }
          if (b.pump) anchors.push({ x: b.pump.x, y: b.pump.y + 2, kind: 'pump', resource: 'water', flow: 'out', building: b.id });
        }
        // This town's own mining operations feed the bundle's HM lane.
        const near = (x) => x > settlement.streetLeft - 600 && x < settlement.streetRight + 600;
        for (const op of world.miningOps || []) {
          if (op.side === settlement.side && op.riser && near(op.riser.x)) anchors.push({ x: op.riser.x, y: op.riser.y, kind: 'mining', resource: 'hm', flow: 'out', op: op.id });
        }
        if (cores.length + anchors.length < 2) continue;
        const xs = [...cores.map((c) => c.x), ...anchors.map((a) => a.x)];
        const x0 = Math.min(...xs) - SPAN - 4, x1 = Math.max(...xs) + SPAN + 4;
        const coreX = mainCore ? Math.round((mainCore.body.left + mainCore.body.right) / 2) : Math.round((x0 + x1) / 2);
        const line = newLine(settlement.side, settlement, x0, x1, cores.sort((p, q) => p.x - q.x), coreX);
        line.ys = contour(x0, x1, DEPTH);
        snapToCores(line.ys, x0, line.cores);
        for (let x = x0; x <= x1; x += 1) layColumn(line, x);
        for (const a of anchors) line.risers.push(layRiser(line, a));
        capEnd(line, -1); capEnd(line, 1);
        stats.cells += x1 - x0 + 1;
        stats.cores += cores.length;
        lines.push(line);
      }
      // The base bundles reach farther, out to the military holding the mountains.
      for (const side of ['left', 'right']) {
        const line = lines.find((l) => l.side === side);
        if (!line) continue;
        const posts = [...(world.outposts || []), ...(world.bunkers || [])].filter((p) => p.side === side).map((p) => p.building);
        const grown = [];
        for (const b of posts) for (const core of coresOf(b)) { registerSpan(core, b.id); grown.push(coreEntry(core, b)); }
        if (!grown.length) continue;
        const xs = grown.map((c) => c.x);
        const x0 = Math.min(line.x0, Math.min(...xs) - SPAN - 4), x1 = Math.max(line.x1, Math.max(...xs) + SPAN + 4);
        line.cores = [...line.cores, ...grown].sort((p, q) => p.x - q.x);
        // On its way out to the mountains the bundle dives under any other town it crosses: the
        // shallow band there belongs to that town's own bundle.
        const foreign = (world.settlements || []).filter((s) => s !== line.settlement);
        const depthThere = (x) => foreign.some((s) => x > s.streetLeft - 60 && x < s.streetRight + 60) ? DEPTH + 40 : DEPTH;
        const fresh = contour(x0, x1, depthThere);
        snapToCores(fresh, x0, line.cores);
        extendTo(line, x0, x1, (c) => fresh[c - x0]);
        if (x0 < line.x0 + 1) capEnd(line, -1);
        if (x1 > line.x1 - 1) capEnd(line, 1);
        stats.cores += grown.length;
      }
      stats.lines = lines.length;
      world.pipes = api;
      return lines;
    }

    // ---- Breaks and repair -----------------------------------------------------------------------------
    const intactAt = (line, x) => {
      if (throughAt(line, x)) return true;   // carried through a core's bed
      const y = line.ys[x - line.x0];
      for (let r = 1; r < BORE - 1; r += 1) {
        const id = mat[(y + r) * W + x] & ID_MASK;
        if (id === M.PIPE) return true;
        if (PW.getLayer(world, 'pipe', x, y + r)) return true;
        if ((structural[id] || id === M.REINFORCED || id === M.LINING) && (PW.getFlags(world, x, y + r) & FLAG.FIXTURE)) return true;   // in a sleeve
      }
      return false;
    };
    function check() {
      let broken = 0;
      for (const line of lines) {
        const before = broken;
        for (let x = line.x0; x <= line.x1; x += 1) {
          const k = x - line.x0;
          if (!intactAt(line, x)) {
            if (!line.broken[k]) { line.broken[k] = 1; line.brokenAt[k] = tick; spill(line, x); }
            broken += 1;
          } else line.broken[k] = 0;
        }
        line.anyBroken = broken > before;
      }
      stats.broken = broken;
    }
    const MARGIN = 40, LAY_PER_TICK = 2;
    function plan(line) {
      let k0 = -1;
      for (let k = 0; k < line.broken.length; k += 1) if (line.broken[k] && tick - line.brokenAt[k] >= REPAIR_DELAY) { k0 = k; break; }
      if (k0 < 0) return null;
      let k1 = k0;
      for (let k = k0 + 1, gap = 0; k < line.broken.length && gap <= 8; k += 1) { if (line.broken[k]) { k1 = k; gap = 0; } else gap += 1; }
      const a = Math.max(0, k0 - MARGIN), b = Math.min(line.ys.length - 1, k1 + MARGIN);
      const fresh = contour(line.x0 + a, line.x0 + b, DEPTH);
      snapToCores(fresh, line.x0 + a, line.cores.filter((c) => c.x >= line.x0 + a - SPAN && c.x <= line.x0 + b + SPAN));
      const ys = new Int32Array(b - a + 1);
      const ease = (t) => t * t * (3 - 2 * t);
      for (let j = 0; j <= b - a; j += 1) {
        const k = a + j, old = line.ys[k];
        const t = ease(Math.min(1, Math.min(k - a, b - k) / MARGIN));
        ys[j] = k >= k0 && k <= k1 ? fresh[j] : Math.round(old + (Math.max(old, fresh[j]) - old) * t);
      }
      for (let j = 1; j < ys.length; j += 1) ys[j] = Math.max(ys[j], ys[j - 1] - 1);
      for (let j = ys.length - 2; j >= 0; j -= 1) ys[j] = Math.max(ys[j], ys[j + 1] - 1);
      for (let k = a; k <= b; k += 1) {
        const x = line.x0 + k, y0 = line.ys[k];
        // (a wide sweep: the blast may have knocked casing cells loose and let them come to rest
        // above or below the old run - the crew takes all of its own pipe up, wherever it lies)
        for (let r = -26; r <= BORE + 34; r += 1) {
          const y = y0 + r;
          if (y < 1 || y >= H - 1) continue;
          if ((mat[y * W + x] & ID_MASK) === M.PIPE && PW.getOwner(world, x, y) === line.owner) {
            PW.set(world, x, y, M.FILL, { quiet: true });
            PW.setLayer(world, 'paint', x, y, rgb(tone(SAND, (PW.hash2(x, y) & 3) === 0 ? 0.82 : 0.92)));
            PW.setOwner(world, x, y, 0);
          }
          if (r >= 0 && r < BORE) PW.setLayer(world, 'pipe', x, y, 0);
        }
        if (!throughAt(line, x)) line.broken[k] = 1;
      }
      return { a, b, ys, left: a, right: b };
    }
    function repair() {
      for (const line of lines) {
        if (!line.reroute) {
          line.reroute = plan(line);
          if (!line.reroute) continue;
          stats.reroutes = (stats.reroutes || 0) + 1;
        }
        const r = line.reroute;
        for (let n = 0; n < LAY_PER_TICK && r.left <= r.right; n += 1) {
          for (const k of r.left === r.right ? [r.left] : [r.left, r.right]) {
            line.ys[k] = r.ys[k - r.a];
            layColumn(line, line.x0 + k);
            if (intactAt(line, line.x0 + k)) {
              line.broken[k] = 0;
              stats.repaired += 1;
              stats.repairHM += REPAIR_HM_PER_CELL;
            } else line.brokenAt[k] = tick;
          }
          r.left += 1; r.right -= 1;
        }
        if (r.left > r.right) line.reroute = null;
      }
    }
    // Is the line carrying from (x) to the core? (no break between them)
    function flowing(line, x) {
      const a = Math.min(x, line.coreX), b = Math.max(x, line.coreX);
      for (let c = Math.max(line.x0, a); c <= Math.min(line.x1, b); c += 1) if (line.broken[c - line.x0]) return false;
      return true;
    }
    // One bundle a side: the resource argument names the lane, the line is the same.
    function lineFor(side) { return lines.find((l) => l.side === side) || null; }
    // Connect a mining operation opened during play: grow the bundle to it, riser up to its hopper.
    function attach(op) {
      const line = lineFor(op.side);
      if (!line || !op.riser) return false;
      const x = op.riser.x;
      const grow = [];
      if (x - 1 < line.x0) grow.push(-1);
      if (x + 1 > line.x1) grow.push(1);
      if (grow.length) {
        const x0 = Math.min(line.x0, x - 1), x1 = Math.max(line.x1, x + 1), fresh = contour(x0, x1, DEPTH);
        snapToCores(fresh, x0, line.cores);
        extendTo(line, x0, x1, (c) => fresh[c - x0]);
      }
      line.risers.push(layRiser(line, { x, y: op.riser.y, flow: 'out', kind: 'mining', resource: 'hm', op: op.id }));
      for (const side of grow) capEnd(line, side);
      return true;
    }

    // ---- Cargo ------------------------------------------------------------------------------------------
    // A packet is one unit of cargo in its lane. It enters at its source core's connector (or down
    // the few risers), runs along the lane, passes through the beds of the cores between, and is
    // counted in at the core it is bound for.
    const laneOf = (line, x, lane) => (x - line.x0) * 3 + lane;
    const rowOf = (line, x, lane) => line.ys[Math.max(0, Math.min(line.ys.length - 1, x - line.x0))] + LANES[lane].row;
    const free = (line, x, lane) => x >= line.x0 && x <= line.x1 && !line.broken[x - line.x0] && !line.occ[laneOf(line, x, lane)];
    const heading = (p) => Math.sign(p.dstX - p.x) || 1;
    // The port columns either side of a core's bed.
    const ports = (core) => [core.x - HOP, core.x + HOP];
    // Where packets of `resource` may be delivered.
    function destinations(line, resource) {
      const out = [];
      for (const core of line.cores) if (core.taps[resource] === 'in') out.push({ core });
      for (const r of line.risers) if (r.flow === 'in') out.push({ riser: r });
      return out;
    }
    function spawnAt(line, resource, source) {
      const targets = destinations(line, resource);
      if (!targets.length) return false;
      const lane = LANE_OF[resource];
      const dst = targets[line.next[resource]++ % targets.length];
      const dstX = dst.core ? dst.core.x : dst.riser.x;
      if (source.riser) {
        const r = source.riser;
        const at = r.anchorY < rowOf(line, r.x, lane) ? 0 : r.occ.length - 1;
        if (r.occ[at]) return false;
        r.occ[at] = 1;
        line.packets.push({ stage: 0, lane, resource, riser: r, dst, dstX, x: r.x, y: r.y0 + at, frac: 0, shade: PW.hash2(stats.spawned, line.id) & 3 });
      } else {
        // Out of the source core's connector, heading for its destination.
        const core = source.core;
        const x = ports(core)[dstX < core.x ? 0 : 1];
        if (!free(line, x, lane)) return false;
        line.occ[laneOf(line, x, lane)] = 1;
        line.packets.push({ stage: 1, lane, resource, dst, dstX, x, y: rowOf(line, x, lane), frac: 0, shade: PW.hash2(stats.spawned, line.id) & 3 });
      }
      stats.spawned += 1;
      return true;
    }
    // Producers: farm cores send SM as their fields yield; the pump sends water at a steady rate;
    // a mining operation sends the ore its miners load (see carry()).
    function produce(dt) {
      for (const line of lines) {
        for (const core of line.cores) {
          for (const [resource, flow] of Object.entries(core.taps)) {
            if (flow !== 'out' || !LANES[LANE_OF[resource]].every) continue;
            const rate = core.type === 'farm' && resource === 'sm' ? farmYield(core.building) : 1;
            if (rate <= 0) continue;
            core.timer += dt * rate;
            if (core.timer >= LANES[LANE_OF[resource]].every && spawnAt(line, resource, { core })) core.timer = 0;
          }
        }
        for (const riser of line.risers) {
          if (riser.flow !== 'out') continue;
          if (riser.kind === 'pump') {
            riser.timer += dt;
            if (riser.timer >= LANES[LANE_OF.water].every && spawnAt(line, 'water', { riser })) riser.timer = 0;
          }
          // (a hopper's backlog feeds in no faster than its lane carries, so the lane never jams solid)
          if (riser.pending > 0 && tick % 4 === 0 && spawnAt(line, riser.resource, { riser })) riser.pending -= 1;
        }
      }
    }
    function farmYield(id) {
      const b = (world.buildings || [])[id - 1];
      if (!b) return 1;
      const fields = [b.field, b.lotField].filter(Boolean);
      const sown = fields.reduce((s, f) => s + (f.columns || 0), 0);
      if (!sown) return 0.5;
      return fields.reduce((s, f) => s + (f.alive || 0) * Math.min(1, f.growth), 0) / sown;
    }
    // A mining operation loads `value` HM into its hopper riser.
    function carry(op, value) {
      const line = lineFor(op.side);
      const riser = line && line.risers.find((r) => r.op === op.id);
      if (riser) riser.pending += value;
    }
    function moveRiser(packet, riser, toward) {
      const k = packet.y - riser.y0, n = k + Math.sign(toward - packet.y);
      if (n < 0 || n >= riser.occ.length || riser.occ[n]) return false;
      riser.occ[k] = 0; riser.occ[n] = 1; packet.y = riser.y0 + n;
      return true;
    }
    function deliver(line, p) {
      p.done = true;
      stats.delivered[p.resource] += 1;
      const stock = world.stock || (world.stock = {});
      const own = stock[line.side] || (stock[line.side] = { sm: 0, hm: 0, water: 0 });
      own[p.resource] += 1;
    }
    function stepPacket(line, p) {
      if (p.stage === 0) {
        // Down (or up) the source riser into a free lane.
        const target = rowOf(line, p.riser.x, p.lane);
        if (p.y !== target) return moveRiser(p, p.riser, target);
        if (!free(line, p.x, p.lane)) return false;
        p.riser.occ[p.y - p.riser.y0] = 0;
        p.stage = 1;
        line.occ[laneOf(line, p.x, p.lane)] = 1;
        return true;
      }
      if (p.stage === 1) {
        // Arrived: a core counts it in at its port; a riser is climbed first.
        if (p.dst.core && Math.abs(p.x - p.dst.core.x) <= HOP) {
          line.occ[laneOf(line, p.x, p.lane)] = 0;
          deliver(line, p);
          return true;
        }
        if (p.dst.riser && p.x === p.dst.riser.x) {
          const k = rowOf(line, p.x, p.lane) - p.dst.riser.y0;
          if (k < 0 || k >= p.dst.riser.occ.length || p.dst.riser.occ[k]) return false;
          line.occ[laneOf(line, p.x, p.lane)] = 0;
          p.dst.riser.occ[k] = 1; p.stage = 2; p.y = p.dst.riser.y0 + k;
          return true;
        }
        const dir = heading(p);
        let nx = p.x + dir;
        // Passing a core on the way: through its bed, in one connector and out the other.
        const between = line.cores.find((c) => Math.abs(nx - c.x) < HOP);
        if (between) nx = between.x + HOP * dir;
        if (!free(line, nx, p.lane)) {
          // Two streams meet head-on in the one lane: the packets slip past each other.
          const q = nx >= line.x0 && nx <= line.x1 && !line.broken[nx - line.x0]
            && line.packets.find((o) => o !== p && o.stage === 1 && o.lane === p.lane && o.x === nx && heading(o) === -dir);
          if (!q) return false;
          q.x = p.x; q.y = rowOf(line, q.x, q.lane);
          p.x = nx; p.y = rowOf(line, nx, p.lane);
          return true;
        }
        line.occ[laneOf(line, p.x, p.lane)] = 0;
        p.x = nx; p.y = rowOf(line, nx, p.lane);
        line.occ[laneOf(line, nx, p.lane)] = 1;
        return true;
      }
      if (p.y !== p.dst.riser.anchorY) return moveRiser(p, p.dst.riser, p.dst.riser.anchorY);
      p.dst.riser.occ[p.y - p.dst.riser.y0] = 0;
      deliver(line, p);
      return true;
    }
    function moveCargo(dt) {
      let count = 0;
      for (const line of lines) {
        for (const p of line.packets) {
          const v = p.stage === 1 ? LANES[p.lane].speed * dt : Math.max(LANES[p.lane].speed, HOIST) * dt;
          p.frac += v;
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
    // A cut spills what was in the span: water runs out into the hole; grain and ore are lost.
    function spill(line, x) {
      for (const p of line.packets) {
        if (p.stage !== 1 || p.x !== x) continue;
        line.occ[laneOf(line, p.x, p.lane)] = 0;
        p.done = true;
        stats.spilled += 1;
        if (p.resource === 'water' && (mat[p.y * W + p.x] & ID_MASK) === M.AIR) PW.set(world, p.x, p.y, M.WATER);
      }
    }

    function step(dt = 1 / 60) {
      tick += 1;
      if (tick % 30 === 0) check();
      if (stats.broken || lines.some((l) => l.reroute)) repair();
      produce(dt);
      moveCargo(dt);
    }

    // ---- Drawing: the cargo moves -----------------------------------------------------------------------
    function draw(renderer, time) {
      const { ctx, camera, view } = renderer;
      const z = camera.zoom;
      if (z < 0.25) return;
      const size = Math.max(1, Math.round(z));
      const vx0 = camera.x - 4, vx1 = camera.x + view.width / z + 4, vy0 = camera.y - 4, vy1 = camera.y + view.height / z + 4;
      const put = (x, y, c) => {
        ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        ctx.fillRect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), size, size);
      };
      const cell = (x, y, c) => {
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;
        const id = mat[y * W + x] & ID_MASK;
        if (id === M.PIPE || ((id === M.REINFORCED || id === M.LINING) && (PW.getFlags(world, x, y) & FLAG.FIXTURE))
          || (PW.mat.open[id] && PW.pipeShows(world, x, y))) put(x, y, c);
      };
      for (const line of lines) {
        if (line.x1 < vx0 || line.x0 > vx1) continue;
        for (const p of line.packets) {
          if (p.x < vx0 - 2 || p.x > vx1 + 2) continue;
          const cargo = LANES[p.lane].cargo;
          if (p.resource === 'hm' && p.stage === 1) {
            cell(p.x, p.y, cargo[(p.shade & 1) ? 0 : 1]);
            cell(p.x - heading(p), p.y, cargo[2]);
          } else {
            cell(p.x, p.y, cargo[p.shade % 3]);
            if (p.resource === 'sm' && p.stage === 1) cell(p.x - heading(p), p.y, tone(cargo[p.shade % 3], 0.8));
          }
        }
      }
    }

    const api = { build, step, draw, attach, carry, lines, stats, flowing, lineFor, contour, BORE, BED, LANES, TAPS };
    return api;
  }

  PW.createPipes = createPipes;
  PW.PIPE_LANES = LANES;
})();
