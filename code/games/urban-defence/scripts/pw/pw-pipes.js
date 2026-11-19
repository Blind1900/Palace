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
    { resource: 'hm', row: 1, channel: [38, 28, 46], cargo: ORE_BITS, speed: 15, every: 0 },
    { resource: 'sm', row: 3, channel: [24, 46, 24], cargo: [[127, 214, 91], [190, 206, 96], [96, 170, 70]], speed: 26, every: 0.3 },
    { resource: 'water', row: 5, channel: [18, 40, 54], cargo: [[140, 210, 226], [96, 170, 214], [200, 236, 246]], speed: 42, every: 0.1 },
  ];
  const LANE_OF = { hm: 0, sm: 1, water: 2 };
  const DEPTH = 16;                  // cover: about a metre of ground over the casing (urban)
  const DEEP = 46;                   // in open country the bundle runs three metres down (user)
  const DEEP_EASE = 140;             // columns over which it eases between the two depths
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
    // parts of a building, straight into the bed's connector sockets. Indexed by column, so the
    // routing's clearance scans pay for the spans actually there, not the whole list.
    const spans = [];
    const spanMap = new Map();
    const addSpan = (s) => {
      spans.push(s);
      for (let x = s.x0; x <= s.x1; x += 1) {
        const list = spanMap.get(x);
        if (list) list.push(s); else spanMap.set(x, [s]);
      }
    };
    const spanAt = (x, y) => {
      const list = spanMap.get(x);
      if (!list) return false;
      for (const s of list) if (y >= s.y0 && y <= s.y1) return true;
      return false;
    };

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
      const probe = (x) => {
        let g = world.groundTop[x];
        for (let n = 0; n < 600 && g < H - 1; n += 1) {
          const id = mat[g * W + x] & ID_MASK;
          if (PW.mat.ground[id] && (terrain[id] || !buildingOwned(x, g))) break;
          g += 1;
        }
        if ((mat[g * W + x] & ID_MASK) === M.WATER) g = PW.supportBelow(world, x, g, true);
        return g;
      };
      // The costly ground probe runs once per column; the bridge probes read the cache.
      const C0 = Math.max(0, x0 - BRIDGE), C1 = Math.min(W - 1, x1 + BRIDGE);
      const cache = new Int32Array(C1 - C0 + 1);
      for (let x = C0; x <= C1; x += 1) cache[x - C0] = probe(x);
      const groundAt = (x) => cache[Math.max(0, Math.min(C1 - C0, x - C0))];
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
        // A bolted collar joins the casing segments (your pipeline refs): two bright columns
        // every 36 cells, with lips into the bed rows (see layColumn).
        if (collarAt(along)) return tone(row === 0 ? CASING_LIT : CASING_DARK, 1.3);
        if (along % 14 === 0) return tone(row === 0 ? CASING_LIT : CASING_DARK, 1.2);   // a rivet band
        return row === 0 ? CASING_LIT : CASING_DARK;
      }
      if (row === 2 || row === 4) return wisp ? INK : DIVIDER;
      if (collarAt(along)) return tone(LANES[(row - 1) >> 1].channel, 0.75);   // the lanes pass behind the collar
      // The stream look the user liked on the regrowing span, carried through the whole
      // pipeline: each lane reads as a run of fine tubes, ribbed every other cell.
      const ch = LANES[(row - 1) >> 1].channel;
      return (along & 1) ? tone(ch, 1.35) : tone(ch, 0.78);
    }
    const collarAt = (along) => !tendrilAt(along) && ((along % 36) + 36) % 36 < 2;
    // Lay one bundle cell: in the ground a PIPE cell; across open space underground it is fixed to
    // the wall face; through a core's span it breaches plate and foundation into the bed's socket.
    function layCell(line, x, y, color, hollow) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      // The bore is hollow (N17F): its inside rows are marked so smoke and fire travel the
      // pipe among the cargo (the physics track reads the flag; everything else sees solid).
      if (hollow) PW.setFlag(world, x, y, FLAG.HOLLOW);
      const id = mat[y * W + x] & ID_MASK;
      const cover = id === M.COVER_ROCK || id === M.COVER_WOOD || id === M.COVER_METAL || id === M.COVER_SAND;
      if (PW.mat.open[id] || id === M.WATER || cover) {
        // Across sheltered open space the bundle is fixed to the wall face (A2.6): a tunnel's, a
        // building's, or any back wall standing there (a terrace's bench wall, a bunker room).
        // Only bare open sky refuses it - the router bridges where a wall face is, and without
        // this the laying refused what the route relied on, leaving the line broken in the open.
        if (y < world.groundTop[x] && !isTunnel(x, y) && !buildingOwned(x, y) && !PW.getLayer(world, 'back', x, y)) return false;
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
      // Foundation work (terraced footings, benched fill) is fill, not frame: the bundle sleeves
      // through it anywhere it crosses, painted over it, nothing load-bearing cut. Without this
      // the line broke wherever the route clipped a town-edge terrace.
      if (id === M.FOUNDATION) {
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
      const collar = collarAt(x);
      for (let b = 1; b <= BED; b += 1) {
        // The trench profile (your pipeline refs): fine sand right against the casing, coarser
        // darker gravel in the outer bed row; a joint collar's lip reaches into the first row.
        const sand = (k) => (wisp ? tone(INK, 1 + Math.abs(k))
          : Math.abs(k) >= BED ? tone(SAND, (PW.hash2(x, y + k) & 3) === 0 ? 0.62 : 0.74)
          : tone(SAND, (PW.hash2(x, y + k) & 3) === 0 ? 0.88 : 1));
        bedCell(x, y - b, b === 1 && collar ? tone(CASING, 1.2) : sand(-b));
        bedCell(x, y + BORE - 1 + b, b === 1 && collar ? tone(CASING, 0.78) : sand(b));
      }
      for (let r = 0; r < BORE; r += 1) layCell(line, x, y + r, pipeColor(r, x), r > 0 && r < BORE - 1);
    }
    // A riser between the line and an anchor at (x, y): for the few taps that are not cores (the
    // lake pump, a mining hopper, the main core's pedestal). It is the SAME pipe, turned (the
    // user's rule: vertical and horizontal are one design): the full bore stood on end, casing,
    // lanes, tendril wraps and collars, flanged where it meets the run below - the pump merges
    // into the line as one continuous flow.
    function layRiser(line, anchor) {
      const lineY = line.ys[Math.max(0, Math.min(line.ys.length - 1, anchor.x - line.x0))];
      const yA = Math.min(anchor.y, lineY), yB = Math.max(anchor.y, lineY + BORE - 1);
      for (let r = 0; r < BORE; r += 1) {
        const x = anchor.x - 3 + r;
        for (let y = yA; y <= yB; y += 1) layCell(line, x, y, pipeColor(r, y), r > 0 && r < BORE - 1);
      }
      layFlange(line, anchor.x, yA - 1);
      if (yB > lineY + BORE - 1) layFlange(line, anchor.x, yB + 1);
      else layFlange(line, anchor.x, lineY - 1);
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
    // Wherever the route steps more than a couple of rows between neighbouring columns - diving
    // under a base's works at a snap boundary, dropping off the urban shelf into the deep
    // country run - a WELL joins the two levels: the whole bore turned vertical, casing, lanes,
    // tendril wraps and collar bands running across it, sleeved through structure like a span
    // and cased through the ground. The line reads joined, and the cargo climbs it instead of
    // teleporting (the user's gaps, run to ground by the physics track).
    // A flange where a vertical run meets a horizontal one: a dark banded joint across the
    // bore, bolts at its corners - the same joint whichever way the pipe turns (one design).
    function layFlange(line, xc, y) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const corner = Math.abs(dx) === 4;
        layCell(line, xc + dx, y, corner ? [150, 156, 164] : tone(CASING, 0.7));
      }
    }
    function layWells(line, k0 = 1, k1 = Infinity) {
      const dropped = (line.wells || []).filter((w) => w.k >= k0 && w.k <= k1);
      line.wells = (line.wells || []).filter((w) => w.k < k0 || w.k > k1);
      for (let k = Math.max(1, k0); k <= Math.min(line.ys.length - 1, k1); k += 1) {
        const a = line.ys[k - 1], b = line.ys[k];
        const dy = Math.abs(b - a);
        if (dy <= 2) continue;
        const xc = line.x0 + k;
        const yTop = Math.min(a, b), yBot = Math.max(a, b) + BORE - 1;
        // A shaft standing within a few columns of another is merged into it instead (the
        // user's note on the regrowing span: less wide, more tubular - one clean well where
        // an oscillating fresh path would have raised a curtain of them).
        const near = dy > 6 && line.wells.find((w) => Math.abs(w.x - xc) <= 9 && yTop <= w.y1 && yBot >= w.y0);
        if (near) {
          const y0 = Math.min(near.y0 + 1, yTop), y1 = Math.max(near.y1 - 1, yBot);
          for (let r = 0; r < BORE; r += 1) {
            for (let y = y0; y <= y1; y += 1) layCell(line, near.x - 3 + r, y, pipeColor(r, y), r > 0 && r < BORE - 1);
          }
          layFlange(line, near.x, y0 - 1);
          layFlange(line, near.x, y1 + 1);
          near.y0 = y0 - 1; near.y1 = y1 + 1;
          continue;
        }
        if (dy <= 6) {
          // A small step is a mitred bend, not a shaft: the bore's own rows carried across the
          // joint at both columns, lanes unbroken - the pipe just turns.
          for (const x of [xc - 1, xc]) {
            for (let y = yTop; y <= yBot; y += 1) {
              const r = Math.max(0, Math.min(BORE - 1, y - (x === xc ? b : a)));
              layCell(line, x, y, pipeColor(r, x), r > 0 && r < BORE - 1);
            }
          }
          continue;
        }
        for (let r = 0; r < BORE; r += 1) {
          const x = xc - 3 + r;
          for (let y = yTop; y <= yBot; y += 1) layCell(line, x, y, pipeColor(r, y), r > 0 && r < BORE - 1);
        }
        // (flanged where the shaft meets each bore, so the turn reads as one built joint)
        layFlange(line, xc, yTop - 1);
        layFlange(line, xc, yBot + 1);
        line.wells.push({ k, x: xc, y0: yTop - 1, y1: yBot + 1 });
        stats.wells = (stats.wells || 0) + 1;
      }
      // A well whose step a fresh route smoothed away takes its shaft with it: the abandoned
      // vertical is dug up (keeping the live bore and every well still standing).
      for (const w of dropped) {
        if (line.wells.some((q) => q.k === w.k)) continue;
        for (let x = w.x - 3; x <= w.x + 3; x += 1) {
          const kk = x - line.x0;
          for (let y = Math.max(1, w.y0); y <= Math.min(H - 2, w.y1); y += 1) {
            if (kk >= 0 && kk < line.ys.length && y >= line.ys[kk] - 1 && y <= line.ys[kk] + BORE) continue;
            if (line.wells.some((q) => Math.abs(x - q.x) <= 3 && y >= q.y0 && y <= q.y1)) continue;
            if ((mat[y * W + x] & ID_MASK) === M.PIPE && PW.getOwner(world, x, y) === line.owner) {
              PW.set(world, x, y, M.FILL, { quiet: true });
              PW.setFlag(world, x, y, FLAG.HOLLOW, false);
              PW.setLayer(world, 'paint', x, y, rgb(tone(SAND, 0.92)));
              PW.setOwner(world, x, y, 0);
            }
            PW.setLayer(world, 'pipe', x, y, 0);
          }
        }
      }
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
      addSpan({ x0: core.x - reach, x1: core.x + reach, y0: core.y - 24, y1: core.y + reach + BORE, building });
    }
    function coreEntry(core, b) {
      const taps = {};
      for (const [resource, flow] of Object.entries(TAPS[b.type] || {})) taps[resource] = flow;
      return { x: core.x, y: core.y, building: b.id, type: b.type, taps, timer: 0 };
    }

    // ---- Build -------------------------------------------------------------------------------------
    // The bundle hugs the surface only where people live: a metre down through towns and the
    // military's works, easing to three metres down in the open country between (the user's
    // rule - the shallow band belongs to the urbanised ground).
    let depthAt = () => DEPTH;
    function buildDepths() {
      const spans = [];
      // (the shallow band runs well past the streets, so the dive begins beyond the made
      // ground's fraying edge, out in the open country proper)
      for (const s of world.settlements || []) spans.push([s.streetLeft - 200, s.streetRight + 200]);
      for (const p of [...(world.outposts || []), ...(world.bunkers || [])]) {
        for (const f of p.footprints || []) spans.push([f[0] - 40, f[1] + 40]);
      }
      depthAt = (x) => {
        let dist = Infinity;
        for (const [a, b] of spans) {
          const d = x < a ? a - x : x > b ? x - b : 0;
          if (d < dist) dist = d;
        }
        return Math.round(DEPTH + Math.min(1, dist / DEEP_EASE) * (DEEP - DEPTH));
      };
    }
    function newLine(side, settlement, x0, x1, cores, coreX) {
      return { id: lines.length, side, settlement, spec: { bundle: true }, owner: OWNER_BASE + lines.length,
        x0, x1, ys: null, coreX, cores, risers: [], broken: new Uint8Array(x1 - x0 + 1), brokenAt: new Int32Array(x1 - x0 + 1),
        occ: new Uint8Array((x1 - x0 + 1) * 3), packets: [], next: { sm: 0, hm: 0, water: 0 } };
    }
    function build() {
      buildDepths();
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
            addSpan({ x0: rx - 3, x1: rx + 3, y0: ry - 2, y1: ry + 12, building: b.id });
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
        line.ys = contour(x0, x1, depthAt);
        snapToCores(line.ys, x0, line.cores);
        for (let x = x0; x <= x1; x += 1) layColumn(line, x);
        layWells(line);
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
        // The dive under a foreign town covers that town's WHOLE shallow region - its street,
        // its outskirts and its own line's approaches - so two lines never braid into what
        // reads as a fork (N13F: every pipe is one continuous run, no splits); outside it the
        // passing line keeps the deep-country level.
        const depthThere = (x) => foreign.some((s) => x > s.streetLeft - 260 && x < s.streetRight + 260) ? DEEP + 40 : depthAt(x);
        const fresh = contour(x0, x1, depthThere);
        snapToCores(fresh, x0, line.cores);
        extendTo(line, x0, x1, (c) => fresh[c - x0]);
        layWells(line);
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
    // Breakage bookkeeping is incremental (the physics track profiled the old full scan at
    // 34 ms of intactAt around a big blast): a column is marked the moment a scan finds it
    // cut - the hurt span grows with it - and unmarked when a scan or the regrowth finds it
    // whole; when a line's last broken column heals, the ground round the whole hurt is combed
    // for flung casing, and once more a little later for pieces still landing.
    function markBroken(line, k) {
      if (line.broken[k]) return;
      line.broken[k] = 1; line.brokenAt[k] = tick;
      line.brokenCount = (line.brokenCount || 0) + 1;
      spill(line, line.x0 + k);
      line.hurt = line.hurt ? { k0: Math.min(line.hurt.k0, k), k1: Math.max(line.hurt.k1, k) } : { k0: k, k1: k };
    }
    function clearBroken(line, k) {
      if (!line.broken[k]) return;
      line.broken[k] = 0;
      line.brokenCount -= 1;
      if (!line.brokenCount && line.hurt) {
        sweepAround(line, line.hurt.k0, line.hurt.k1);
        line.tidy = { k0: line.hurt.k0, k1: line.hurt.k1, at: tick + 10 * 60 };
        line.hurt = null;
      }
    }
    // The watch walks each line in windows (a stretch per check, the cursor going round), so a
    // quiet line costs almost nothing per tick; damage reported by a blast is looked at at
    // once (notifyDamage), and anything a window misses is found within a few seconds.
    const CHECK_WINDOW = 1600;
    let dirtyPending = false;
    function checkSpan(line, kA, kB) {
      for (let k = Math.max(0, kA); k <= Math.min(line.ys.length - 1, kB); k += 1) {
        if (intactAt(line, line.x0 + k)) clearBroken(line, k); else markBroken(line, k);
      }
    }
    function check() {
      for (const line of lines) {
        if (line.dirty) { checkSpan(line, line.dirty.k0, line.dirty.k1); line.dirty = null; }
        if (tick % 30 === 0) {
          const k0 = line.checkK || 0;
          checkSpan(line, k0, k0 + CHECK_WINDOW - 1);
          line.checkK = k0 + CHECK_WINDOW >= line.ys.length ? 0 : k0 + CHECK_WINDOW;
          // (a hurt line is watched whole: the regrowth's work must be seen promptly)
          if (line.hurt) checkSpan(line, line.hurt.k0 - 2, line.hurt.k1 + 2);
        }
      }
      dirtyPending = false;
      stats.broken = lines.reduce((n, l) => n + (l.brokenCount || 0), 0);
    }
    // The open mouths of the bore where a line is broken, for the physics track's N17F gas
    // rule: grid smoke reaching a break becomes smoke pixels entering the pipe here. A mouth
    // is an intact column beside a broken one, reported at the bore's centre row. Only hurt
    // lines are walked, and only their hurt span, so the call costs nothing while whole.
    function openEnds() {
      const ends = [];
      for (const line of lines) {
        if (!line.brokenCount || !line.hurt) continue;
        const kE = line.broken.length - 1;
        const k0 = Math.max(0, line.hurt.k0 - 1), k1 = Math.min(kE, line.hurt.k1 + 1);
        for (let k = k0; k <= k1; k += 1) {
          if (line.broken[k]) continue;
          if ((k > 0 && line.broken[k - 1]) || (k < kE && line.broken[k + 1])) {
            ends.push({ x: line.x0 + k, y: line.ys[k] + (BORE >> 1) });
          }
        }
      }
      return ends;
    }
    // A blast tells the lines where it struck: those columns are looked at next tick instead
    // of waiting for the window to come round.
    function notifyDamage(x0, x1) {
      for (const line of lines) {
        if (x1 < line.x0 || x0 > line.x1) continue;
        const k0 = Math.max(0, x0 - line.x0), k1 = Math.min(line.ys.length - 1, x1 - line.x0);
        line.dirty = line.dirty ? { k0: Math.min(line.dirty.k0, k0), k1: Math.max(line.dirty.k1, k1) } : { k0, k1 };
        dirtyPending = true;
      }
    }
    // ---- Regrowth (the user's design) -------------------------------------------------------------
    // No printer-scan crew. The HM that clogs at a broken end is what rebuilds the pipe; water
    // and SM arriving there spill out and merge into the ground. Each broken end regrows
    // outward from where it broke - the two ends seek each other along a fresh local path
    // re-read from the land as it settles, branching little ink feelers as they go (the
    // Game-of-Life habit of the god's work) - until they meet and the flow closes again.
    const REGROW_DELAY = 4 * 60;     // a break settles a moment before the ends start seeking
    const GROW_EVERY = 18;           // ticks between one growth step at each end
    const STARVED = 10 * 60;         // no clogged HM for this long: the cores send a trickle instead
    const PATH_REFRESH = 150;        // ticks a local path is trusted before the ends re-read the land
    function freshPath(line, a, b) {
      const g = line.growPath;
      if (g && g.a <= a && g.b >= b && tick - g.at < PATH_REFRESH) return g;
      const a0 = Math.max(0, a - 10), b0 = Math.min(line.ys.length - 1, b + 10);
      const ys = contour(line.x0 + a0, line.x0 + b0, depthAt);
      snapToCores(ys, line.x0 + a0, line.cores.filter((c) => c.x >= line.x0 + a0 - SPAN && c.x <= line.x0 + b0 + SPAN));
      return (line.growPath = { at: tick, a: a0, b: b0, ys });
    }
    function growEnd(line, k, dir) {
      const path = freshPath(line, Math.max(0, k - 2), Math.min(line.ys.length - 1, k + 2));
      const ny = path.ys[k - path.a];
      const old = line.ys[k];
      if (Math.abs(ny - old) > 1 && !line.risers.some((rr) => Math.abs(line.x0 + k - rr.x) <= 4)) {
        // Take up what is left of the old run in this column - the WHOLE span between the old
        // level and the new one (a freshly read path can move the line by storeys; nothing of
        // the abandoned level may stay behind), plus a margin for casing the blast let lie.
        const lo = Math.min(ny, old) - 8, hi = Math.max(ny, old) + BORE + 8;
        for (let y = Math.max(1, lo), x = line.x0 + k; y <= Math.min(H - 2, hi); y += 1) {
          if (y >= ny - 1 && y <= ny + BORE) continue;   // the new bore and its lip stay
          if ((mat[y * W + x] & ID_MASK) === M.PIPE && PW.getOwner(world, x, y) === line.owner) {
            PW.set(world, x, y, M.FILL, { quiet: true });
            PW.setFlag(world, x, y, FLAG.HOLLOW, false);
            PW.setLayer(world, 'paint', x, y, rgb(tone(SAND, 0.92)));
            PW.setOwner(world, x, y, 0);
          }
          PW.setLayer(world, 'pipe', x, y, 0);
        }
      }
      line.ys[k] = ny;
      layColumn(line, line.x0 + k);
      layWells(line, Math.max(1, k - 1), Math.min(line.ys.length - 1, k + 1));
      // The growing end is the pipe stamping its own cross-section outward (N14F/N16F - the
      // user kept the glitch as the feature): a vertical segment of the same bore design at
      // the tip, each step's stamp left standing behind the last, so the reaching end trails
      // a brief curtain of verticals - and when the ends meet, the closure sweeps leave one
      // clean pipe and nothing else. Same design as every pipe; no overlay.
      const tipX = line.x0 + k + dir * 4;
      for (let r = 0; r < BORE; r += 1) {
        for (let y = ny - 8; y < ny + BORE + 8; y += 1) layCell(line, tipX - 3 + r, y, pipeColor(r, y), r > 0 && r < BORE - 1);
      }
      // A searching feeler now and then: a few cells of ink reaching off the fresh work into
      // the ground, grown over as the end moves on (painted; it cuts nothing).
      if ((PW.hash2(line.x0 + k, tick) & 7) === 3) {
        const fy = ny + ((PW.hash2(k, tick) & 1) ? -2 : BORE + 1);
        for (let d = 0; d < 2 + (PW.hash2(tick, k) & 1); d += 1) {
          const x = line.x0 + k + dir * d, y = fy + ((PW.hash2(x, d) & 1) ? d : -d);
          if (y > 1 && y < H - 1 && terrain[mat[y * W + x] & ID_MASK]) PW.setLayer(world, 'paint', x, y, rgb([10, 10, 12]));
        }
      }
      if (intactAt(line, line.x0 + k)) {
        clearBroken(line, k);
        // The wreck of the old run in this column is taken up as the end closes over it - a
        // wide sweep for casing the blast let come to rest anywhere nearby (wells excepted).
        for (let r = -26, x = line.x0 + k; r <= BORE + 34; r += 1) {
          if (r >= -1 && r <= BORE) continue;
          const y = ny + r;
          if (y < 1 || y >= H - 1) continue;
          if ((line.wells || []).some((w) => Math.abs(x - w.x) <= 3 && y >= w.y0 && y <= w.y1)) continue;
          if ((mat[y * W + x] & ID_MASK) === M.PIPE && PW.getOwner(world, x, y) === line.owner) {
            PW.set(world, x, y, M.FILL, { quiet: true });
            PW.setFlag(world, x, y, FLAG.HOLLOW, false);
            PW.setLayer(world, 'paint', x, y, rgb(tone(SAND, 0.9)));
            PW.setOwner(world, x, y, 0);
          }
          PW.setLayer(world, 'pipe', x, y, 0);
        }
        stats.repaired += 1;
        stats.repairHM += REPAIR_HM_PER_CELL;
      } else line.brokenAt[k] = tick;
    }
    // When a gap's last column closes, the ground round the old crater is combed once more: the
    // blast threw casing well past where the ends regrow, and it is taken up with the rest.
    function sweepAround(line, kA, kB = kA) {
      for (let k = Math.max(0, kA - 44); k <= Math.min(line.ys.length - 1, kB + 44); k += 1) {
        const x = line.x0 + k, y0 = line.ys[k];
        if (line.risers.some((rr) => Math.abs(x - rr.x) <= 4)) continue;   // a riser is the line's own
        // (the band reaches well above and below: a path re-read mid-growth can wander by
        // storeys, and everything of the line's own left off the final route is garbage)
        for (let r = -70; r <= BORE + 44; r += 1) {
          if (r >= -1 && r <= BORE) continue;
          const y = y0 + r;
          if (y < 1 || y >= H - 1) continue;
          if ((line.wells || []).some((w) => Math.abs(x - w.x) <= 3 && y >= w.y0 && y <= w.y1)) continue;
          if ((mat[y * W + x] & ID_MASK) === M.PIPE && PW.getOwner(world, x, y) === line.owner) {
            PW.set(world, x, y, M.FILL, { quiet: true });
            PW.setFlag(world, x, y, FLAG.HOLLOW, false);
            PW.setLayer(world, 'paint', x, y, rgb(tone(SAND, 0.9)));
            PW.setOwner(world, x, y, 0);
            PW.setLayer(world, 'pipe', x, y, 0);
          }
        }
      }
    }
    function regrow() {
      for (const line of lines) {
        if (!line.brokenCount || !line.hurt) { if (!line.brokenCount) line.growPath = null; continue; }
        // (only the hurt span is walked - the physics track profiled the full-line walk; a
        // snapshot, because the closure sweep clears line.hurt the moment the last column heals)
        const h0 = line.hurt.k0, h1 = line.hurt.k1;
        for (let k = h0; k <= h1; k += 1) {
          if (!line.broken[k]) continue;
          let k1 = k;
          while (k1 + 1 < line.broken.length && line.broken[k1 + 1]) k1 += 1;
          const settled = tick - Math.max(line.brokenAt[k], line.brokenAt[k1]) >= REGROW_DELAY;
          if (settled && tick % GROW_EVERY === 0) {
            // Starved ends draw a trickle from their side's stock (the cores send it down the
            // line); otherwise the clogged HM pays for every cell.
            if ((line.fuel || 0) < REPAIR_HM_PER_CELL && tick - (line.fedAt || 0) > STARVED) {
              const stock = world.stock && world.stock[line.side];
              if (stock && stock.hm >= 1) { stock.hm -= 1; line.fuel = (line.fuel || 0) + 1; }
            }
            for (const [kk, dir] of k1 === k ? [[k, 1]] : [[k, 1], [k1, -1]]) {
              if ((line.fuel || 0) < REPAIR_HM_PER_CELL) break;
              line.fuel -= REPAIR_HM_PER_CELL;
              growEnd(line, kk, dir);
            }
          }
          k = k1;
        }
      }
    }
    // A core grown after the world was made - a dropped seed, a new building - joins its side's
    // bundle: the line grows out to it if it must, or the span around it is taken up and re-laid
    // through its connectors, and its taps go live.
    function connectCore(x, y, side, taps, building) {
      const line = lineFor(side);
      if (!line) return null;
      const core = { x, y, building: building || 0, type: taps ? 'building' : 'seed', taps: taps || { hm: 'in', sm: 'in', water: 'in' }, timer: 0 };
      registerSpan(core, building || 0);
      line.cores.push(core);
      line.cores.sort((p, q) => p.x - q.x);
      stats.cores += 1;
      if (x - SPAN - 4 < line.x0 || x + SPAN + 4 > line.x1) {
        // Beyond an end: the line runs on to it.
        const x0 = Math.min(line.x0, x - SPAN - 4), x1 = Math.max(line.x1, x + SPAN + 4);
        const fresh = contour(x0, x1, depthAt);
        snapToCores(fresh, x0, line.cores);
        extendTo(line, x0, x1, (c) => fresh[c - x0]);
        layWells(line);
        if (x0 < line.x0 + 1) capEnd(line, -1);
        if (x1 > line.x1 - 1) capEnd(line, 1);
        return core;
      }
      // Mid-run: the stretch around it is taken up and re-laid through its connectors.
      const a = Math.max(0, x - (SPAN * 2 + RAMP + 6) - line.x0), bk = Math.min(line.ys.length - 1, x + SPAN * 2 + RAMP + 6 - line.x0);
      const fresh = contour(line.x0 + a, line.x0 + bk, depthAt);
      snapToCores(fresh, line.x0 + a, line.cores.filter((c) => c.x >= line.x0 + a - SPAN && c.x <= line.x0 + bk + SPAN));
      const ease = (t) => t * t * (3 - 2 * t);
      for (let j = 0; j <= bk - a; j += 1) {
        const k = a + j, old = line.ys[k];
        const t = ease(Math.min(1, Math.min(k - a, bk - k) / RAMP));
        const ny = Math.round(old + (fresh[j] - old) * t);
        if (ny === old) continue;
        // (take up the old pipe in this column, then lay it on the new row)
        for (let r = -1; r <= BORE; r += 1) {
          const yy = old + r, xx = line.x0 + k;
          if ((mat[yy * W + xx] & ID_MASK) === M.PIPE && PW.getOwner(world, xx, yy) === line.owner) {
            PW.set(world, xx, yy, M.FILL, { quiet: true });
            PW.setFlag(world, xx, yy, FLAG.HOLLOW, false);
            PW.setLayer(world, 'paint', xx, yy, rgb(tone(SAND, 0.92)));
            PW.setOwner(world, xx, yy, 0);
          }
          if (r >= 0 && r < BORE) PW.setLayer(world, 'pipe', xx, yy, 0);
        }
        line.ys[k] = ny;
      }
      for (let k = a; k <= bk; k += 1) layColumn(line, line.x0 + k);
      layWells(line, a, bk);
      return core;
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
        if (between) { nx = between.x + HOP * dir; between.flashAt = tick; }
        // A well between the columns: the packet climbs the shaft, a few cells a step,
        // instead of teleporting between the levels.
        const ty = rowOf(line, nx, p.lane);
        if (Math.abs(ty - p.y) > 1) { p.y += Math.sign(ty - p.y) * Math.min(3, Math.abs(ty - p.y)); return true; }
        if (!free(line, nx, p.lane)) {
          // Two streams meet head-on in the one lane: the packets slip past each other. The
          // lookup is indexed per tick - searching the whole packet list for every blocked
          // packet went quadratic in a supply jam and ate whole frames (the perf pass).
          const q = nx >= line.x0 && nx <= line.x1 && !line.broken[nx - line.x0] && line.atCol
            ? line.atCol.get(p.lane * W + nx) : null;
          if (!q || q === p || q.stage !== 1 || q.x !== nx || heading(q) !== -dir) return false;
          line.atCol.set(p.lane * W + nx, p);
          line.atCol.set(p.lane * W + p.x, q);
          q.x = p.x; q.y = rowOf(line, q.x, q.lane);
          p.x = nx; p.y = rowOf(line, nx, p.lane);
          return true;
        }
        line.occ[laneOf(line, p.x, p.lane)] = 0;
        if (line.atCol) { line.atCol.delete(p.lane * W + p.x); line.atCol.set(p.lane * W + nx, p); }
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
        // (the per-column index for head-on slip-pasts, rebuilt once a tick)
        const at = line.atCol || (line.atCol = new Map());
        at.clear();
        for (const p of line.packets) if (p.stage === 1) at.set(p.lane * W + p.x, p);
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
      if (dirtyPending || tick % 30 === 0) check();
      if (stats.broken) regrow();
      for (const line of lines) {
        if (line.tidy && tick >= line.tidy.at) { sweepAround(line, line.tidy.k0, line.tidy.k1); line.tidy = null; }
      }
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
          // Each resource pixel travels along the path of a sine wave (the user's design): the
          // wave is fixed in space, per lane on its own phase, and the pixel traces it as it
          // moves - the wave itself does not ripple along. One pixel per unit of cargo, so
          // every pixel of water, SM and HM stays visible as its own; climbing a riser or a
          // well it runs straight.
          const wob = p.stage === 1 ? Math.round(Math.sin(p.x * 0.42 + p.lane * 2.1) * 1.1) : 0;
          cell(p.x, p.y + wob, cargo[p.shade % 3]);
        }
      }
      // ---- The god's life in the plant (N27F) ---------------------------------------------------------
      // Quiet black-and-white signs in the energy ball's own language - a white point, a grey
      // fleck, an ink streak, never more than a few pixels at a time - that read the pipes,
      // pumps, wells and the repairing stream as living god-machinery over the industrial
      // plant. All drawn each frame; nothing is written into the world's cells.
      if (z >= 0.75) {
        const GWHITE = [238, 242, 246], GDIM = [150, 156, 162], GINK = [10, 10, 12];
        const tsec = time * 0.001;
        const mid = BORE >> 1;
        // (a small still eye with one slow fleck about it: the ball's atom, in miniature)
        const eye = (x, y, phase) => {
          put(x, y, GWHITE);
          const a = tsec * 1.6 + phase;
          put(x + Math.round(Math.cos(a) * 2.2), y + Math.round(Math.sin(a) * 1.4), GDIM);
        };
        for (const line of lines) {
          if (line.x1 < vx0 || line.x0 > vx1) continue;
          const span = line.ys.length;
          // The line's pulse: one white signal glides the run every few seconds, a dim then
          // inky trail behind it - and it dies at any wound it meets.
          const lap = Math.max(5, span / 240);
          const ph = ((line.x0 * 131) % 977) / 977;
          const k = Math.min(span - 1, Math.floor((((tsec / lap) + ph) % 1) * span));
          const px = line.x0 + k;
          if (px >= vx0 && px <= vx1 && !line.broken[k]) {
            put(px, line.ys[k] + mid, GWHITE);
            for (let d = 1; d <= 3; d += 1) {
              const kb = k - d;
              if (kb >= 0 && !line.broken[kb]) put(line.x0 + kb, line.ys[kb] + mid, d === 1 ? GDIM : GINK);
            }
          }
          // Wellheads and pump mouths keep watch.
          for (const w of line.wells || []) if (w.x >= vx0 && w.x <= vx1) eye(w.x, w.y0 + 2, w.x & 7);
          for (const r of line.risers) if (r.kind === 'pump' && r.x >= vx0 && r.x <= vx1) eye(r.x, r.y0 + 3, r.x & 7);
          // A packet through a core's bed: the connectors blink white as it passes.
          for (const c of line.cores) {
            if (!c.flashAt || tick - c.flashAt > 20 || c.x < vx0 - HOP || c.x > vx1 + HOP) continue;
            const fade = tick - c.flashAt < 10 ? GWHITE : GDIM;
            for (const s of [-1, 1]) {
              const k2 = Math.max(0, Math.min(span - 1, c.x + s * HOP - line.x0));
              put(line.x0 + k2, line.ys[k2] + mid, fade);
            }
          }
        }
        // The repairing stream: the god's attention rests on each open mouth - a white point
        // with hair-fine flickering rays, an ink fleck beneath (the feelers, made light).
        if (stats.broken) {
          for (const e of openEnds()) {
            if (e.x < vx0 || e.x > vx1) continue;
            put(e.x, e.y, GWHITE);
            const h = PW.hash2(e.x, tick >> 2);
            for (let i = 0; i < 3; i += 1) {
              const a = ((h >> (i * 3)) & 7) * (Math.PI / 4);
              put(e.x + Math.round(Math.cos(a) * (1 + (h >> (i + 9) & 1))),
                e.y + Math.round(Math.sin(a) * (1 + (h >> (i + 11) & 1))), (h >> i & 1) ? GDIM : GWHITE);
            }
            put(e.x + ((h >> 5 & 1) ? 1 : -1), e.y + 2, GINK);
          }
        }
      }
    }

    const api = { build, step, draw, attach, carry, connectCore, notifyDamage, openEnds, lines, stats, flowing, lineFor, contour, BORE, BED, LANES, TAPS };
    return api;
  }

  PW.createPipes = createPipes;
  PW.PIPE_LANES = LANES;
})();
