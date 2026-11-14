'use strict';
// Supply pipelines (ported from the beta's pipeline rules, at native scale). Each town runs an SM,
// an HM and a water line underground between its own structures. A line follows the ground at its
// cover depth and dips under basements, the core pit and buried cores; where it crosses a tunnel or
// a shaft it is fixed to the back wall, so it never blocks the way. Risers connect each building,
// the lake pump and the mining operations: at a building the riser comes up out of the ground into
// the machine that belongs there, standing beside it (a tank, a transformer, a generator, a mill, a
// farm's processor and pump, a mine's crusher). The run's underground ends are capped.
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
  const SMOOTH = 28;                 // a line's bends are eased over this many columns each way
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
  // The machines standing beside each kind of building, one per line it uses, nearest first: where
  // its line comes up out of the ground (the lake pump house and the mining hoppers are their own).
  // Water is kept in a pressure tank (a farm's booster pump drives its irrigation); SM comes out of
  // a farm's processor and goes into a transformer or a generator; ore comes out of a mine's crusher
  // and goes into a mill. Widths in cells (as drawn: a genset is about 3 m long).
  const PLANT = {
    core: [['sm', 'generator'], ['hm', 'mill'], ['water', 'tank']],
    population: [['sm', 'transformer'], ['water', 'tank']],
    military: [['sm', 'generator'], ['hm', 'mill']],
    farm: [['sm', 'processor'], ['water', 'pump']],
    mine: [['hm', 'crusher']],
  };
  const MACHINE_W = { pump: 34, tank: 36, generator: 46, transformer: 28, crusher: 36, mill: 44, processor: 30 };
  const PLANT_GAP = 4, PLANT_MARGIN = 3;
  // Ground a building's machines take beside it (0 if it has none).
  const plantWidth = (type) => {
    const list = PLANT[type];
    return list ? PLANT_MARGIN * 2 + list.reduce((sum, [, kind]) => sum + MACHINE_W[kind], 0) + PLANT_GAP * (list.length - 1) : 0;
  };

  function createPipes(world) {
    const { mat, width: W, height: H } = world;
    const lines = [];
    const stats = { lines: 0, cells: 0, machines: 0, caps: 0, broken: 0, repaired: 0, repairHM: 0, packets: 0, spawned: 0, delivered: { sm: 0, hm: 0, water: 0 }, spilled: 0 };
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
      const grounds = new Int32Array(ys.length);
      // Push y below anything in the way between the ground and the pipe's bed.
      const clear = (x, ground, y) => {
        for (let scan = ground; scan < y + BORE + 3 && scan < H - 40; scan += 1) if (blocked(x, scan)) y = Math.max(y, scan + 4);
        return y;
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
        grounds[x - x0] = ground;
        ys[x - x0] = clear(x, ground, ground + depth);
      }
      // A line is laid in long smooth runs, not over every bump and notch of the ground: the
      // deepest need within SMOOTH columns, averaged over the same reach (so never shallower than
      // its cover anywhere), then cleared again of anything the deeper run now meets.
      for (let pass = 0; pass < 3; pass += 1) {
        smooth(ys, SMOOTH);
        let moved = false;
        for (let k = 0; k < ys.length; k += 1) {
          const y = clear(x0 + k, grounds[k], ys[k]);
          if (y !== ys[k]) { ys[k] = y; moved = true; }
        }
        if (!moved) break;
      }
      // Bends no steeper than 45°: only ever deepen to clear neighbours.
      for (let k = 1; k < ys.length; k += 1) ys[k] = Math.max(ys[k], ys[k - 1] - 1);
      for (let k = ys.length - 2; k >= 0; k -= 1) ys[k] = Math.max(ys[k], ys[k + 1] - 1);
      return ys;
    }
    // In place: each value becomes the mean, over k +/- reach, of the running maximum over the same
    // reach. Every maximum in a column's mean covers that column, so no value ever rises (gets
    // shallower) than it was.
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
        // Never in the open sky, nor across a cave or a blast hole (only along a tunnel's or a
        // building room's back wall).
        if (!isTunnel(x, y) && (y < world.groundTop[x] || !(buildingOwned(x, y) || PW.getLayer(world, 'back', x, y)))) return false;
        PW.setLayer(world, 'back', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      }
      if (id === M.REINFORCED || id === M.LINING) {
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      }
      // (a riser comes up through the street's paving into its machine)
      if (!terrain[id] && id !== M.PIPE && id !== M.ASPHALT && id !== M.ROADBED) return false;
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

    // ---- Machines ------------------------------------------------------------------------------------
    // Each machine stands on a concrete plinth on the ground beside its building, drawn in its own
    // frame: u outward from the building (its inlet flange at u 0-1, over the riser), v up from the
    // plinth's bottom row.
    const STEEL = [120, 128, 134], STEEL_DARK = [72, 78, 84], CONCRETE = [150, 150, 144], BLACK = [34, 34, 36];
    const MOTOR = [42, 150, 110], MOTOR_LIT = [70, 186, 140], MOTOR_DARK = [26, 104, 76], BRASS = [150, 120, 70];
    const OCHRE = [176, 140, 40], RED = [176, 40, 32];
    const ENCLOSURE = { modern: [214, 214, 208], asian: [36, 164, 150], gothic: [104, 112, 72] };
    function sketch(w, h) {
      const cells = new Array(w * h).fill(null);
      const g = { w, h, cells };
      g.put = (u, v, c, slab = false) => { if (u >= 0 && v >= 0 && u < w && v < h) cells[v * w + u] = { c, slab }; };
      g.rect = (u0, v0, u1, v1, c) => { for (let v = v0; v <= v1; v += 1) for (let u = u0; u <= u1; u += 1) g.put(u, v, typeof c === 'function' ? c(u, v) : c); };
      g.disc = (cu, cv, r, c) => {
        for (let v = Math.floor(cv - r); v <= Math.ceil(cv + r); v += 1) for (let u = Math.floor(cu - r); u <= Math.ceil(cu + r); u += 1) {
          const d = Math.hypot(u - cu, v - cv);
          if (d <= r) g.put(u, v, typeof c === 'function' ? c(u, v, d) : c);
        }
      };
      // A horizontal capsule (a vessel or a drum) between u0 and u1, rows v0 to v1, its heads domed.
      g.capsule = (u0, u1, v0, v1, head, c) => {
        const mid = (v0 + v1) / 2, half = (v1 - v0) / 2 + 0.5;
        for (let v = v0; v <= v1; v += 1) {
          const k = Math.min(1, Math.abs(v - mid) / half), inset = Math.round(head * (1 - Math.sqrt(1 - k * k)));
          for (let u = u0 + inset; u <= u1 - inset; u += 1) g.put(u, v, typeof c === 'function' ? c(u, v) : c);
        }
      };
      // Every machine stands on a two-row concrete plinth and takes the line in at u = 0, rows 1-9.
      g.rect(0, 0, w - 1, 1, (u, v) => (v === 1 ? [166, 166, 160] : CONCRETE));
      for (let u = 0; u < w; u += 1) for (let v = 0; v < 2; v += 1) cells[v * w + u].slab = true;
      return g;
    }
    const flange = (g, c = STEEL) => g.rect(0, 1, 1, 9, (u, v) => (v === 1 || v === 9 ? STEEL_DARK : u === 0 && (v === 3 || v === 7) ? [200, 204, 206] : c));
    const MACHINES = {
      // Centrifugal pump: suction into a polished volute, a gate valve on its discharge, the
      // coupling guard, a finned green motor with its terminal box, and the fan cowl.
      pump: () => {
        const g = sketch(34, 18);
        flange(g);
        g.rect(2, 3, 3, 7, STEEL);
        g.disc(9, 8, 6.4, (u, v, d) => (d > 5.5 ? [118, 122, 126] : (u - 9) - (v - 8) < -3 ? [206, 210, 212] : [170, 174, 176]));
        g.disc(9, 8, 1.6, [96, 100, 104]);
        g.rect(7, 14, 11, 15, STEEL); g.rect(6, 16, 12, 16, STEEL_DARK); g.rect(5, 17, 13, 17, RED);
        g.rect(2, 2, 32, 2, [60, 64, 66]);
        g.rect(15, 5, 17, 11, (u, v) => (v === 11 ? [236, 184, 60] : [214, 160, 40]));
        g.rect(18, 3, 30, 13, (u, v) => (v === 13 ? MOTOR_LIT : v === 3 ? MOTOR_DARK : (v & 1) ? MOTOR : [34, 128, 94]));
        g.rect(22, 14, 26, 16, (u, v) => (v === 16 ? MOTOR_LIT : MOTOR));
        g.rect(31, 4, 33, 12, (u, v) => (v % 2 ? [60, 64, 66] : [150, 154, 156]));
        g.light = [24, 15]; g.fan = [31, 33, 4, 12];
        return g;
      },
      // Pressure tank: a blue horizontal vessel on two saddles, its inlet valve and gauge.
      tank: () => {
        const g = sketch(36, 20);
        flange(g);
        g.rect(2, 4, 6, 6, STEEL); g.rect(3, 7, 4, 8, RED);
        g.rect(9, 2, 12, 5, STEEL_DARK); g.rect(26, 2, 29, 5, STEEL_DARK);
        g.capsule(5, 34, 4, 17, 4, (u, v) => (u === 13 || u === 26 ? [56, 100, 146] : v >= 15 ? [110, 160, 206] : v <= 6 ? [50, 92, 136] : [70, 120, 170]));
        g.rect(20, 18, 20, 18, STEEL_DARK); g.rect(19, 19, 21, 19, [230, 230, 226]);
        g.light = [4, 9];
        return g;
      },
      // Diesel generator set: a fuel-tank base, the acoustic enclosure (in the side's colours) with
      // its doors, intake and radiator louvres, the control panel, and the silencer on top.
      generator: (style) => {
        const g = sketch(46, 26);
        const body = ENCLOSURE[style] || ENCLOSURE.modern, lit = tone(body, 1.1), shade = tone(body, 0.82), seam = tone(body, 0.62);
        g.rect(0, 2, 2, 8, [40, 44, 46]); g.rect(0, 4, 1, 6, BRASS);
        g.rect(3, 2, 44, 6, (u, v) => (v === 6 ? [62, 62, 64] : u % 9 === 4 && v === 3 ? [70, 70, 72] : BLACK));
        g.rect(3, 7, 44, 23, (u, v) => (v === 23 || u === 3 ? lit : u === 44 ? shade : body));
        for (const s of [15, 30]) g.rect(s, 7, s, 22, seam);
        for (const s of [13, 28, 32]) g.rect(s, 14, s, 16, BLACK);
        g.rect(5, 10, 12, 20, (u, v) => (v % 2 === 0 ? seam : shade));
        g.rect(34, 9, 42, 21, (u, v) => (v % 2 === 0 ? seam : shade));
        g.rect(18, 15, 25, 20, [30, 36, 40]); g.rect(19, 18, 24, 19, [70, 120, 110]); g.put(19, 16, RED);
        g.rect(34, 24, 42, 25, (u, v) => (v === 25 ? [120, 122, 124] : [92, 94, 96])); g.put(6, 24, STEEL_DARK); g.put(28, 24, STEEL_DARK);
        g.light = [23, 16];
        return g;
      },
      // Transformer: the cable box the conduit runs into, an oil tank with radiator fins, three
      // porcelain bushings and a warning sign.
      transformer: () => {
        const g = sketch(28, 26);
        g.rect(0, 2, 5, 9, (u, v) => (v === 9 ? [80, 84, 86] : [52, 56, 58])); g.rect(0, 4, 1, 6, BRASS);
        g.rect(6, 2, 21, 18, (u, v) => (v === 18 ? [140, 156, 140] : u === 6 ? [130, 146, 130] : [110, 124, 110]));
        g.rect(22, 4, 26, 16, (u, v) => (v === 4 || v === 16 ? [110, 124, 110] : u % 2 ? [96, 110, 96] : [66, 76, 66]));
        for (let v = 9; v <= 12; v += 1) { const hw = 12 - v; g.rect(14 - hw, v, 15 + hw, v, [236, 196, 40]); }
        g.put(14, 10, BLACK); g.put(15, 10, BLACK);
        for (const b of [10, 14, 18]) {
          for (let v = 19; v <= 24; v += 1) g.rect(b - (v % 2), v, b + (v % 2), v, v % 2 ? [176, 82, 58] : [142, 62, 44]);
          g.put(b, 25, STEEL);
        }
        g.light = [8, 16];
        return g;
      },
      // Jaw crusher: the chute onto the belt, the frame with its jaw throat full of ore, the feed
      // hopper, the flywheel and its drive motor.
      crusher: () => {
        const g = sketch(36, 28);
        flange(g, [150, 120, 40]);
        g.rect(2, 2, 6, 5, STEEL_DARK);
        g.rect(6, 2, 24, 17, (u, v) => (v === 17 ? [204, 168, 64] : u === 6 ? [190, 152, 52] : u === 24 ? [140, 110, 30] : OCHRE));
        for (let v = 5; v <= 16; v += 1) { const hw = Math.round((v - 5) * 0.3); g.rect(15 - hw, v, 15 + hw, v, (u) => ((u + v) % 3 ? [40, 36, 30] : ORE_BITS[(u * 7 + v) % 4])); }
        for (let v = 18; v <= 27; v += 1) {
          const hw = Math.round(8 + (v - 18) * 0.7);
          g.rect(15 - hw, v, 15 + hw, v, (u) => (u === 15 - hw || u === 15 + hw || v === 27 ? [110, 114, 116] : v >= 24 ? ORE_BITS[(u * 5 + v * 3) % 4] : [86, 90, 92]));
        }
        g.rect(26, 2, 34, 5, (u, v) => (v === 5 ? MOTOR_LIT : MOTOR));
        g.disc(29, 13, 6.5, (u, v, d) => (d > 5.4 ? [150, 154, 156] : d < 1.5 ? [200, 204, 206] : [58, 62, 64]));
        g.light = [8, 15]; g.wheel = [29, 13, 5];
        return g;
      },
      // Ball mill: the feed spout from the belt, a rotating drum (liner bolts, girth gear) on its
      // trunnions and pedestals, and the drive motor.
      mill: () => {
        const g = sketch(44, 24);
        flange(g, [150, 120, 40]);
        g.rect(2, 8, 7, 11, STEEL_DARK);
        g.rect(5, 2, 8, 9, [86, 90, 92]); g.rect(36, 2, 39, 9, [86, 90, 92]);
        g.rect(3, 9, 9, 13, STEEL); g.rect(35, 9, 41, 13, STEEL);
        g.capsule(9, 35, 4, 19, 3, (u, v) => (v >= 17 ? [130, 142, 156] : v <= 6 ? [70, 80, 94] : [92, 104, 118]));
        g.rect(28, 3, 30, 20, (u, v) => (v % 2 ? [70, 74, 78] : [110, 114, 118]));
        g.rect(40, 2, 43, 8, (u, v) => (v === 8 ? MOTOR_LIT : MOTOR));
        g.light = [42, 9]; g.drum = [11, 26, 6, 17];
        return g;
      },
      // Farm processor: the conduit's outlet box, a drying drum (its window showing the SM grain
      // tumbling), a gear motor, and a feed hopper of grain on four legs above it.
      processor: () => {
        const g = sketch(30, 28);
        const BODY = [72, 132, 62], BODY_LIT = [98, 160, 84], BODY_DARK = [48, 96, 42];
        g.rect(0, 2, 5, 9, (u, v) => (v === 9 ? [80, 84, 86] : [52, 56, 58])); g.rect(0, 4, 1, 6, BRASS);
        g.rect(6, 2, 25, 12, (u, v) => (v === 12 ? BODY_LIT : v === 2 ? BODY_DARK : u === 6 ? BODY_LIT : u === 25 ? BODY_DARK : BODY));
        g.rect(9, 5, 20, 9, (u, v) => ((u + v * 3) % 5 === 0 ? [190, 206, 96] : (u * 7 + v) % 4 === 0 ? [127, 214, 91] : [28, 44, 24]));
        g.rect(26, 3, 29, 9, (u, v) => (v === 9 ? MOTOR_LIT : MOTOR));
        for (const leg of [9, 22]) g.rect(leg, 13, leg, 16, STEEL_DARK);
        for (let v = 17; v <= 27; v += 1) {
          const hw = Math.round(3 + (v - 17) * 0.8);
          g.rect(15 - hw, v, 16 + hw, v, (u) => (u === 15 - hw || u === 16 + hw || v === 27 ? STEEL : v >= 24 ? [[127, 214, 91], [190, 206, 96], [96, 170, 70]][(u * 3 + v) % 3] : [58, 64, 60]));
        }
        g.light = [7, 10]; g.drum = [9, 20, 5, 9];
        return g;
      },
    };
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
    // The run's underground ends are closed with a bolted steel cap: a blind flange two cells
    // thick over the whole bore, its lip standing proud of the pipe.
    function capEnd(line, side) {
      const endX = side > 0 ? line.x1 : line.x0, y = line.ys[side > 0 ? line.ys.length - 1 : 0];
      for (let c = 1; c <= 2; c += 1) for (let r = -1; r <= BORE; r += 1) {
        const lip = r === -1 || r === BORE, bolt = c === 1 && (r === 1 || r === BORE - 2);
        layCell(line, endX + side * c, y + r, lip ? STEEL_DARK : bolt ? [200, 204, 206] : c === 2 ? tone(STEEL, 0.86) : STEEL);
      }
      stats.caps += 1;
    }

    // ---- Plant: the machines where the lines come up to a building -----------------------------
    // Beside each building, on the ground its town left for them (b.plant: the side and the span),
    // its machines stand in a row outward from it, nearest first, each on its plinth on the
    // surface. Each line's riser comes up out of the ground under its machine's inlet flange, and
    // a short pipe runs on from the machine into the building. They are drawn on the back layer,
    // so troops and vehicles pass in front of them, and a blast wrecks them like a back wall.
    const plants = new Map();   // building id -> its machines
    function plantOf(b) {
      if (!b.plant || !PLANT[b.type]) return null;
      if (plants.has(b.id)) return plants.get(b.id);
      const { side, edge } = b.plant;
      let at = edge + side * (PLANT_MARGIN + 1);
      const list = PLANT[b.type].map(([resource, kind]) => {
        const g = MACHINES[kind](b.style);
        // (the plinth rests on the highest ground under it; it is built up where the ground dips)
        let top = Infinity;
        for (let u = 0; u < g.w; u += 1) top = Math.min(top, world.groundTop[at + side * u]);
        const m = { kind, resource, side, x: at - side, base: top - 1, w: g.w, h: g.h, g, inletX: at + side, building: b.id };
        at += side * (g.w + PLANT_GAP);
        return m;
      });
      plants.set(b.id, list);
      return list;
    }
    function plantAnchor(b, resource) {
      const m = (plantOf(b) || []).find((q) => q.resource === resource);
      return m ? { x: m.inletX, y: world.groundTop[m.inletX], kind: b.type, building: b.id, machine: m } : null;
    }
    // Draw a building's machines and their pipes into it, once its lines are laid.
    function drawPlant(b) {
      const list = plantOf(b);
      if (!list) return;
      const back = (x, y, c) => {
        if ((mat[y * W + x] & ID_MASK) !== M.AIR) return;
        PW.setLayer(world, 'back', x, y, rgb(c));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
      };
      // The pipes on to the building first (each machine's runs behind the nearer ones): out of
      // the machine's flange at its own height, into the building's side.
      list.forEach((m, i) => {
        const spec = LINES.find((l) => l.resource === m.resource), row = m.base - 3 - i * 4;
        // (from just outside the building's edge column, which may be a farm's open yard of crops)
        for (let x = b.plant.edge + m.side; x !== m.x + m.side; x += m.side) {
          back(x, row - 1, tone(spec.jacket, 1.12)); back(x, row, spec.channel); back(x, row + 1, tone(spec.jacket, 0.72));
          if (Math.abs(x - b.plant.edge) % 16 === 1) back(x, row + 2, STEEL_DARK);   // pipe hanger
        }
      });
      for (const m of list) {
        const { g } = m;
        for (let v = 0; v < g.h; v += 1) for (let u = 0; u < g.w; u += 1) {
          const cell = g.cells[v * g.w + u];
          if (cell) back(m.x + m.side * (1 + u), m.base - v, cell.c);
        }
        // The plinth is built up to the ground where it dips under it.
        for (let u = 0; u < g.w; u += 1) {
          const x = m.x + m.side * (1 + u);
          for (let y = m.base + 1; y < world.groundTop[x]; y += 1) back(x, y, tone(CONCRETE, 0.9));
        }
        const line = lines.find((l) => l.settlement.buildings.some((q) => q.id === b.id) && l.resource === m.resource);
        if (line) line.machines.push(m);
        stats.machines += 1;
      }
    }

    // ---- Anchors -------------------------------------------------------------------------------------
    // Where each building connects: under its floor (below anything it owns in that column). Its
    // three lines rise in their own columns, `offset` cells apart.
    function buildingAnchor(b, kind, offset = 0) {
      // (a farm connects under its barn, silos or house, not under its yard)
      const mid = b.type === 'farm' && b.storage && b.storage.length ? b.storage[0].x : (b.body.left + b.body.right) / 2;
      const cx = Math.round(mid) + offset;
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
        x0, x1, ys: contour(x0, x1, spec.depth), coreX, risers: [], machines: [], broken: new Uint8Array(x1 - x0 + 1), brokenAt: new Int32Array(x1 - x0 + 1),
        occ: new Uint8Array((x1 - x0 + 1) * 3), packets: [], next: 0 };
    }
    function build() {
      for (const settlement of world.settlements || []) {
        // Neutral towns are piped as well: their farms and pumps feed their own houses (their
        // mines stockpile until the town is taken).
        const anchors = anchorsFor(settlement);
        const core = settlement.buildings.find((b) => b.type === 'core');
        for (const [index, spec] of LINES.entries()) {
          // (the line's core end: where it comes up into the core's machine, else under its middle)
          const coreAnchor = core && plantAnchor(core, spec.resource);
          const coreX = coreAnchor ? coreAnchor.x : core ? Math.round((core.body.left + core.body.right) / 2) : (settlement.streetLeft + settlement.streetRight) >> 1;
          const users = anchors.filter((a) => USES[a.kind] && USES[a.kind][spec.resource])
            .map((a) => (a.b ? { ...(plantAnchor(a.b, spec.resource) || buildingAnchor(a.b, a.kind, (index - 1) * 6)), b: a.b } : a));
          if (users.length < 2) continue;
          // (flush with the outer risers: an end turns up into its riser, or runs on to a machine)
          const x0 = Math.min(...users.map((a) => a.x)) - 1, x1 = Math.max(...users.map((a) => a.x)) + 1;
          const line = newLine(settlement, spec, x0, x1, coreX);
          for (let x = x0; x <= x1; x += 1) layColumn(line, x);
          for (const a of users) line.risers.push(layRiser(line, { ...a, flow: USES[a.kind][spec.resource] }));
          stats.cells += x1 - x0 + 1;
          lines.push(line);
        }
        // The runs' ends are capped, and each building's machines stand over its risers.
        for (const line of lines.filter((l) => l.settlement === settlement)) { capEnd(line, -1); capEnd(line, 1); }
        for (const b of settlement.buildings) drawPlant(b);
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
    // The crew re-lays broken columns after a delay, along the new contour (around the crater).
    let repairBudget = 0;
    function repair() {
      repairBudget = Math.min(4, repairBudget + REPAIR_CELLS_PER_TICK);
      // (a few columns are tried each tick; one that can't be re-laid yet - flooded, say - waits
      // and is tried again later)
      let tries = 4;
      for (const line of lines) {
        for (let k = 0; k < line.broken.length && repairBudget >= 1 && tries > 0; k += 1) {
          if (!line.broken[k] || tick - line.brokenAt[k] < REPAIR_DELAY) continue;
          tries -= 1;
          const x = line.x0 + k;
          const fresh = contour(Math.max(line.x0, x - 2), Math.min(line.x1, x + 2), line.spec.depth);
          // (at the depth the line actually runs, which may be deeper than its local cover, it
          // goes below whatever is in the way now: the crater's hole)
          let y = Math.max(fresh[Math.min(2, x - Math.max(line.x0, x - 2))], line.ys[k]);
          for (let scan = y - BED; scan <= y + BORE + BED && scan < H - 40; scan += 1) if (blocked(x, scan)) y = scan + BED + 1;
          line.ys[k] = y;
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
          } else line.brokenAt[k] = tick - REPAIR_DELAY + 60;   // (tried again in a second)
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
      const grow = [];
      if (x - 1 < line.x0) grow.push(-1);
      if (x + 1 > line.x1) grow.push(1);
      if (grow.length) {
        // (the line runs on over its old cap, and is capped again at its new end)
        const x0 = Math.min(line.x0, x - 1), x1 = Math.max(line.x1, x + 1), fresh = contour(x0, x1, line.spec.depth);
        extendTo(line, x0, x1, (c) => fresh[c - x0]);
      }
      line.risers.push(layRiser(line, { x, y: op.riser.y, flow: 'out', kind: 'mining', op: op.id }));
      for (const side of grow) capEnd(line, side);
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
          // A farm sends SM in proportion to the field it still has under crop, and the crop's growth.
          const rate = riser.kind === 'farm' ? farmYield(riser.building) : 1;
          if (rate <= 0) continue;
          riser.timer += dt * rate;
          if (riser.timer >= line.spec.every && spawn(line, riser)) riser.timer = 0;
        }
      }
      for (const line of lines) for (const riser of line.risers) if (riser.pending > 0 && spawn(line, riser)) riser.pending -= 1;
    }
    function farmYield(id) {
      const b = (world.buildings || [])[id - 1];
      if (!b) return 1;
      const fields = [b.field, b.lotField].filter(Boolean);
      const sown = fields.reduce((s, f) => s + (f.columns || 0), 0);
      if (!sown) return 0.5;                                     // a farm without a field (greenhouse benches)
      return fields.reduce((s, f) => s + (f.alive || 0) * Math.min(1, f.growth), 0) / sown;
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
        // The end machinery runs while its line carries: a steady green light, the pump's fan,
        // the crusher's flywheel and the mill's drum turning; a cut line stops them and its
        // lights blink red. (A wrecked machine shows nothing.)
        for (const m of line.machines) {
          const a = m.x + m.side, b = m.x + m.side * m.w;
          if (Math.max(a, b) < vx0 || Math.min(a, b) > vx1 || m.base < vy0 || m.base - m.h > vy1) continue;
          const g = m.g, at = (u, v) => [m.x + m.side * (1 + u), m.base - v];
          const [lx, ly] = at(g.light[0], g.light[1]);
          if (!PW.getLayer(world, 'back', lx, ly)) continue;
          const running = !line.anyBroken;
          cell(lx, ly, running ? (Math.floor(time * 1.5) % 4 ? [90, 240, 130] : [60, 170, 90]) : (Math.floor(time * 3) % 2 ? [255, 70, 50] : [90, 30, 24]));
          if (!running || z < 1) continue;
          if (g.fan) {
            const [u0, u1, v0, v1] = g.fan, s = Math.floor(time * 14);
            for (let v = v0; v <= v1; v += 1) for (let u = u0; u <= u1; u += 1) { const [x, y] = at(u, v); cell(x, y, (v + s) % 2 ? [60, 64, 66] : [150, 154, 156]); }
          }
          if (g.wheel) {
            const [cu, cv, r] = g.wheel, turn = time * 3;
            for (let k = 0; k < 2; k += 1) {
              const angle = turn + k * Math.PI / 2;
              for (let t = -r; t <= r; t += 1) { const [x, y] = at(Math.round(cu + Math.cos(angle) * t), Math.round(cv + Math.sin(angle) * t)); cell(x, y, [176, 180, 182]); }
            }
          }
          if (g.drum) {
            const [u0, u1, v0, v1] = g.drum, s = Math.floor(time * 8);
            for (let v = v0; v <= v1; v += 3) for (let u = u0; u <= u1; u += 1) if ((u + s) % 4 === 0) { const [x, y] = at(u, v); cell(x, y, [52, 60, 70]); }
          }
        }
      }
    }

    const api = { build, step, draw, attach, carry, lines, stats, flowing, lineFor, contour, plantOf, LINES, BORE, BED, PLANT };
    return api;
  }

  PW.createPipes = createPipes;
  PW.PIPE_LINES = LINES;
  PW.PIPE_PLANT = { PLANT, MACHINE_W, width: plantWidth, GAP: PLANT_GAP, MARGIN: PLANT_MARGIN };
})();
