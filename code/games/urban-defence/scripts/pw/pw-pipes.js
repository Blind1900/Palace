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
  // N38 part 4: the bore as REAL space. Each lane row is carved to real air with the lane's colour
  // on the back wall behind it - smoke drifts, water drops and debris rains through the actual
  // tube under the ordinary physics - while the casing and the lane dividers stay solid steel.
  // (Off - flags=PIPE_CAVITY:0 - the inside of the bore is solid M.PIPE painted as the lanes, and
  // nothing passes through it: the physics no longer reads FLAG.HOLLOW.)
  if (PW.PIPE_CAVITY === undefined) PW.PIPE_CAVITY = true;

  const ORE_BITS = [[240, 210, 255], [192, 107, 252], [155, 86, 203], [127, 71, 167]];
  // The three lanes, top to bottom inside the casing. `row` is the lane's row within the bore.
  const LANES = [
    // N34/N38 redesign: the lanes read as neon conduits in a dark shell - the cyberpunk
    // sci-fi the user asked for - violet ore, acid-green soft materials, electric water.
    { resource: 'hm', row: 1, channel: [84, 52, 148], cargo: ORE_BITS, speed: 15, every: 0 },
    { resource: 'sm', row: 3, channel: [38, 136, 70], cargo: [[127, 214, 91], [190, 206, 96], [96, 170, 70]], speed: 26, every: 0.3 },
    { resource: 'water', row: 5, channel: [30, 128, 168], cargo: [[140, 210, 226], [96, 170, 214], [200, 236, 246]], speed: 42, every: 0.1 },
  ];
  const LANE_OF = { hm: 0, sm: 1, water: 2 };
  const DEPTH = 16;                  // cover: about a metre of ground over the casing (urban)
  const DEEP = 46;                   // in open country the bundle runs three metres down (user)
  const DEEP_EASE = 140;             // columns over which it eases between the two depths
  const BORE = 7;                    // casing, hm, divider, sm, divider, water, casing
  const BED = 2;                     // sand bed rows above and below the bundle
  const SMOOTH = 28;                 // a line's bends are eased over this many columns each way
  const HOIST = 40;                  // cells per second up and down the few risers left
  const MAX_PACKETS = 1500;          // cargo in transit per line, at most (PS's soak backstop)
  const SPAN = 20;                   // half-width of a core's pass-through span
  const RAMP = 14;                   // columns over which the line eases to a connector row
  const HOP = 11;                    // the bed itself: the bundle vanishes into one port, out the other
  const OWNER_BASE = 60000;
  const REPAIR_DELAY = 6 * 60, REPAIR_HM_PER_CELL = 0.25;
  const TENDRIL_EVERY = 44, TENDRIL_W = 5;

  // N34/N38 redesign: near-black gunmetal shell with a teal sheen on the spine - vertical
  // and horizontal are one design, one palette (the riser is the same pipe turned).
  const CASING = [52, 58, 68], CASING_LIT = [74, 92, 106], CASING_DARK = [48, 54, 66], DIVIDER = [20, 23, 29];
  // N84: the armoured JACKET - a second shell ring outside the bore (rows -1 and BORE, the
  // first trench row), light cool steel over the gunmetal casing so the tube reads as a
  // thick cased body against its own neon lanes and against the ground round it. Lit on
  // the spine (top / left), shaded underneath (bottom / right), plates jointed every 14.
  const JACKET_LIT = [140, 160, 174], JACKET_DARK = [92, 104, 118];
  const NEON_RING = [96, 212, 232], NEON_RING_DIM = [48, 110, 124];
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
    // A grown building taken out of the world (a lot re-seated for a level-up, the centre
    // tightening, a dismantling) lets go of the line: its spans' licences die and its cores
    // come off the threading, so the next re-read of the stretch runs the bundle straight
    // again. The laid pipe itself stays - it is the line's, not the building's - and cargo
    // already bound for a removed core simply delivers to the side's stock at the old port.
    const removeSpans = (building) => {
      for (let i = spans.length - 1; i >= 0; i -= 1) {
        if (spans[i].building !== building) continue;
        const s = spans[i];
        spans.splice(i, 1);
        for (let x = s.x0; x <= s.x1; x += 1) {
          const list = spanMap.get(x);
          if (!list) continue;
          const at = list.indexOf(s);
          if (at >= 0) list.splice(at, 1);
          if (!list.length) spanMap.delete(x);
        }
      }
    };
    // N3: a re-seat heals its own cut. When a building lets go of the bundle, the pass-through
    // spans its beds carried are laid as REAL bore at the next step (the bed is still being
    // wiped during this call) instead of being left for the crews - on an adopted town's long
    // line the churn outran the starved crews and the breaks froze (the adoption-era pool).
    let pendingHeals = [];
    function releaseBuilding(side, building) {
      removeSpans(building);
      // (N75: a side may hold several lines until they merge - the release walks them all,
      // so a core threaded on the second line never gets orphaned on the first)
      for (const line of lines) {
        if (line.side !== side) continue;
        const before = line.cores.length;
        for (const c of line.cores) {
          if (c.building === building) pendingHeals.push({ line, x0: c.x - HOP - 4, x1: c.x + HOP + 4 });
        }
        line.cores = line.cores.filter((c) => c.building !== building);
        stats.cores -= before - line.cores.length;
        // N81: the building's risers go WITH its cores - a pit riser left standing is a
        // plugged ghost mouth every later packet jams behind. Cargo climbing the dead
        // shaft spills into the works; cargo bound for it in-lane re-routes next step.
        const dead = [];
        line.risers = line.risers.filter((r) => { if (r.building === building) { dead.push(r); return false; } return true; });
        if (dead.length) {
          for (const p of line.packets) {
            if (p.done || !p.dst || !dead.includes(p.dst.riser)) continue;
            if (p.stage === 2) { p.done = true; stats.spilled += 1; }
            else p.dst = null;
          }
        }
        if (dead.length || line.cores.length !== before) refreshLanes(line);   // N162
      }
    }
    // N80: let go of ONE bare seed core, by position - a planted seed whose building never
    // came (grow refused the ground) is unplanted, and its thread on the line goes with it.
    // releaseBuilding(side, 0) would shed every seed core of the side at once.
    function releaseSeedCore(side, x) {
      for (const line of lines) {
        if (line.side !== side) continue;
        const before = line.cores.length;
        for (const c of line.cores) {
          if (c.building === 0 && Math.abs(c.x - x) <= 2) pendingHeals.push({ line, x0: c.x - HOP - 4, x1: c.x + HOP + 4 });
        }
        line.cores = line.cores.filter((c) => !(c.building === 0 && Math.abs(c.x - x) <= 2));
        stats.cores -= before - line.cores.length;
        if (line.cores.length !== before) refreshLanes(line);   // N162
      }
    }
    // N81/N25F: any pass that can move the run's level snapshots its risers first and lays
    // every riser whose column moved again afterwards - an old ladder tops out at a row
    // that no longer exists, and every climbing packet jams at the ceiling for ever (the
    // silent HM famine). Cargo caught mid-shaft spills into the works.
    function snapRisers(line) {
      const m = new Map();
      for (const r of line.risers) m.set(r, line.ys[Math.max(0, Math.min(line.ys.length - 1, r.x - line.x0))]);
      return m;
    }
    function relayMovedRisers(line, snap) {
      for (let i = 0; i < line.risers.length; i += 1) {
        const r = line.risers[i];
        const now = line.ys[Math.max(0, Math.min(line.ys.length - 1, r.x - line.x0))];
        if (snap.has(r) && snap.get(r) === now) continue;
        for (const p of line.packets) {
          if (p.done) continue;
          if (p.riser === r || (p.dst && p.dst.riser === r && p.stage === 2)) { p.done = true; stats.spilled += 1; }
          else if (p.dst && p.dst.riser === r) p.dst = null;
        }
        line.risers[i] = layRiser(line, { x: r.fedFrom ?? r.x, y: r.anchorY, flow: r.flow, kind: r.kind, resource: r.resource, building: r.building, op: r.op, main: r.main });
      }
    }
    // N81: the LAW, enforced on any stretch a lay, merge or re-thread touched - after it,
    // neighbouring columns differ by at most one cell outside a registered well. The
    // sweeps only ever DEEPEN (always safe to lay into), the bed rows are re-pinned each
    // round, every column that moved is taken up and laid again, and layWells re-reads
    // the stretch so any step the pins force (a deep trunk against a bed's shelf) stands
    // as a proper shaft with its swept elbows - never a bare cliff through the lanes.
    function enforceGrade(line, k0, k1) {
      // N81: a step a lay/merge/re-thread spliced in must stand as a SWEPT bend or a
      // proper shaft, not a bare cliff that walls the lanes - layWells turns every step
      // over one cell (down to a mitred bend, a shaft for the taller ones) into open
      // pipe. No global deepening: that dragged the whole run below the made ground that
      // beds it (seed 3's gothic neutral). The turn stays where the contour put it.
      // (a fitting reaches FIT columns from its step: one re-laid in its box is re-laid whole)
      const a = Math.max(0, k0 - FIT), b = Math.min(line.ys.length - 1, k1 + FIT);
      if (b > a) layWells(line, a, b);
    }
    const FIT = 5;
    // A lot taken down where its works had sleeved the bundle (a plinth laid across the bore) hands
    // those columns back: they are laid again at the next step, the lanes carved through the fill.
    function heal(x0, x1) {
      for (const line of lines) if (x1 >= line.x0 && x0 <= line.x1) pendingHeals.push({ line, x0, x1 });
    }
    function runHeals() {
      if (!pendingHeals.length) return;
      for (const h of pendingHeals) {
        const line = h.line;
        const k0 = Math.max(0, h.x0 - line.x0), k1 = Math.min(line.ys.length - 1, h.x1 - line.x0);
        if (k1 < k0) continue;
        for (let k = k0; k <= k1; k += 1) layColumn(line, line.x0 + k);
        layWells(line, Math.max(1, k0 - FIT), Math.min(line.ys.length - 1, k1 + FIT));
        checkSpan(line, k0, k1);
        stats.healed = (stats.healed || 0) + (k1 - k0 + 1);
      }
      pendingHeals = [];
    }
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
      // Bare open sky refuses the laying (layCell's own rule), so to the router it is as hard
      // as rock: a ravine with no wall face to fix to is dived under, never planed across.
      // (seed 7's climb to the mining riser crossed such a notch - 25 columns of nothing the
      // watch could only ever read as a wound, and the mend starved against the same sky)
      if (PW.mat.open[id] && y < world.groundTop[x] && !isTunnel(x, y) && !buildingOwned(x, y) && !PW.getLayer(world, 'back', x, y)) return true;
      return buildingOwned(x, y) && !isTunnel(x, y) && !terrain[id];
    }
    // The row a road tunnel's bundle runs at in column x (its rows under the road), or -1.
    function roadRow(x) {
      const RT = PW.roadTunnels;
      for (const t of world.roadTunnels || []) if (t.floorAt && x >= t.a && x <= t.b) return t.floorAt(x) + ((RT && RT.PIPE_UNDER) || 18);
      return -1;
    }
    // Pipe top row per column: cover depth under the ground, then below anything in the way.
    function contour(x0, x1, depth) {
      // A reversed span must never ask for a negative array: under the adoption era's
      // constant release-and-rethread a mend can race a re-lay and hand a span inside
      // out; it collapses to its own first column and the next pass reads it fresh.
      // (breadcrumbed for the quiet investigation: see the progress notes)
      if (x1 < x0) x1 = x0;
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
        // (N104: under a mountain's road the bundle runs below the road's bed - its cover read off
        // the mountainside over the bore laid it in the tunnel's headroom, across the army's way,
        // wherever a town's growth re-laid it; every pass after only deepens)
        ys[x - x0] = Math.max(clear(x, ground, ground + depthAt(x)), roadRow(x));
      }
      // The passes and the slope clamps run to a fixed point TOGETHER: the clamps alone could
      // lift a column back into what clear() had dodged (seed 7's climb to the mining riser
      // pinned the bore inside the vein's edge - half-laid columns the watch read as a wound
      // the mend could never close). Every operation only ever deepens, so this converges:
      // where ore or works bar the way, the whole stretch dives below them.
      for (let round = 0; round < 6; round += 1) {
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
        let dirty = false;
        for (let k = 0; k < ys.length && !dirty; k += 1) if (clear(x0 + k, grounds[k], ys[k]) !== ys[k]) dirty = true;
        if (!dirty) break;
      }
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
        // The approach eases to the connector row one cell a column (the |d| cone): the
        // span itself sits on the row, and each column out differs from the last by at
        // most one - a smooth roll-off, no corner (N34), lanes open the whole way.
        for (let d = 1; d <= RAMP + SPAN; d += 1) {
          for (const k of [core.x - SPAN - d - x0, core.x + SPAN + d - x0]) {
            if (k < 0 || k >= ys.length) continue;
            ys[k] = Math.max(Math.min(ys[k], T + d), T - d);
          }
        }
      }
      // N37: between neighbouring beds of the same town the line runs straight ON - a shelf
      // from connector to connector - instead of diving back to depth and climbing again.
      // The V-jog beside every cabinet read as a break at the user's close look.
      const sorted = [...cores].sort((a, b) => a.x - b.x);
      for (let i = 0; i + 1 < sorted.length; i += 1) {
        const a = sorted[i], b = sorted[i + 1];
        if (b.x - a.x > 140) continue;
        const Ta = a.y - 3, Tb = b.y - 3;
        const s0 = a.x + SPAN, s1 = b.x - SPAN;
        const shelfY = (x) => Math.round(Ta + (Tb - Ta) * ((x - s0) / Math.max(1, s1 - s0)));
        // N83: only where the straight shelf is clear - run bed to bed through a neighbour's
        // works (a stage's flight of steps between two towers, seed 7) its cells were refused
        // and the lanes cut there. A blocked shelf keeps the contour's dive under them.
        let clear = true;
        for (let x = s0; x <= s1 && clear; x += 1) {
          const y = shelfY(x);
          for (let yy = y - 1; yy <= y + BORE && clear; yy += 1) if (blocked(x, yy)) clear = false;
        }
        if (!clear) continue;
        // The shelf runs straight bed to bed; any single level change it leaves is turned
        // into a swept mitred bend or a well by layWells (N81), never a bare cliff.
        for (let x = s0; x <= s1; x += 1) {
          const k = x - x0;
          if (k < 0 || k >= ys.length) continue;
          ys[k] = shelfY(x);
        }
      }
      // A column whose bore would hang in bare open sky is tucked under that column's own
      // ground line instead, and the wells climb the steps this leaves at the edges. The
      // approach cone to a mountain core planed across a ravine on seed 7 (x~18311): 25
      // columns of air that layCell rightly refused, which the watch could only ever read
      // as a wound and the mend could only starve against. Only the bed itself stays as
      // pinned (through its ports the bundle is carried inside); an eased approach with
      // nothing under it dives like any other stretch and climbs back in by a well.
      for (let k = 0; k < ys.length; k += 1) {
        const x = x0 + k;
        if (cores.some((c) => Math.abs(x - c.x) <= HOP)) continue;
        for (let r = 0; r < BORE; r += 1) {
          const yy = ys[k] + r, id = mat[yy * W + x] & ID_MASK;
          if (PW.mat.open[id] && yy < world.groundTop[x] && !isTunnel(x, yy) && !buildingOwned(x, yy) && !PW.getLayer(world, 'back', x, yy)) {
            ys[k] = Math.min(H - 44, world.groundTop[x] + 3);
            break;
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
      if (row < 0 || row >= BORE) {
        if (wisp) return INK;   // (the tendril grips the whole tube, jacket and all)
        if (collarAt(along)) return row < 0 ? NEON_RING : NEON_RING_DIM;
        const plate = row < 0 ? JACKET_LIT : JACKET_DARK;
        return along % 14 === 0 ? tone(plate, 0.7) : plate;
      }
      if (row === 0 || row === BORE - 1) {
        if (wisp) return ((along + row) % 7 === 3) ? WHITE_DIM : INK;
        // N34/N38 redesign: the collar is a NEON RING every 36 cells - a glowing coupler
        // band in the dark shell (the cyberpunk read), the same ring on the risers.
        if (collarAt(along)) return row === 0 ? NEON_RING : NEON_RING_DIM;
        if (along % 14 === 0) return tone(row === 0 ? CASING_LIT : CASING_DARK, 1.25);   // a seam band
        return row === 0 ? CASING_LIT : CASING_DARK;
      }
      if (row === 2 || row === 4) return wisp ? INK : DIVIDER;
      if (collarAt(along)) return tone(LANES[(row - 1) >> 1].channel, 0.7);   // the lanes pass behind the ring
      // Each lane reads as a run of fine neon tubes, ribbed every other cell - the conduit
      // glow against the near-black shell.
      const ch = LANES[(row - 1) >> 1].channel;
      return (along & 1) ? tone(ch, 1.5) : tone(ch, 0.66);
    }
    const collarAt = (along) => !tendrilAt(along) && ((along % 36) + 36) % 36 < 2;
    // ---- N162 (the user's, 2026-11-27): one pipe design, each resource by its coloured lane ----------
    // A branch carries one resource and is drawn as one lane in that resource's colour. The main is
    // the highway: a resource's lane shows open only over the stretch its sources and the places that
    // take it span (both ways along the line - cargo is shared out over every taker and re-routes to
    // any), so the main reads two lanes or three where the branches have merged in, and narrows past
    // the last of them. A closed lane is only painted as casing: inside it is the same open bore as
    // ever (PS: the cavity physics, the lanes' checks and the walking lumps rely on it).
    function laneSpans(line) {
      const out = {};
      for (const lane of LANES) {
        const res = lane.resource, xs = [];
        let src = 0, dst = 0;
        for (const c of line.cores) { const f = c.taps[res]; if (!f) continue; xs.push(c.x); if (f === 'out') src += 1; else dst += 1; }
        for (const r of line.risers) {
          if (r.flow === 'in') { xs.push(r.x); dst += 1; } else if (r.resource === res) { xs.push(r.x); src += 1; }
        }
        out[res] = src && dst ? [Math.min(...xs) - SPAN, Math.max(...xs) + SPAN] : null;
      }
      return out;
    }
    const laneOpen = (spans, res, x) => !spans || (!!spans[res] && x >= spans[res][0] && x <= spans[res][1]);
    // (a shut lane reads as a dark empty channel - near-black, the slim intake's ink: the lanes'
    // checks read ink as passable bore, which it still is)
    const closedLane = (along) => (along % 14 === 0 ? [28, 30, 33] : [20, 22, 27]);
    // (laid afresh where a lane opened or closed: after a build, and whenever a source or a taker
    // comes or goes)
    function refreshLanes(line, all = false) {
      const old = line.lanes || null;
      line.lanes = laneSpans(line);
      // (only the lane cells' colour changes - nothing is laid again: re-laying the columns walled a
      // fitting's lanes off at seed 3's step at 34070, the elbow's own cells being the fitting's)
      for (let x = line.x0; x <= line.x1; x += 1) {
        const k = x - line.x0, y = line.ys[k];
        if (throughAt(line, x) || inIntake(line, x)) continue;
        if ((k > 0 && line.ys[k - 1] !== y) || (k < line.ys.length - 1 && line.ys[k + 1] !== y)) continue;   // (a fitting keeps its own lanes)
        for (const lane of LANES) {
          const on = laneOpen(line.lanes, lane.resource, x);
          if (!all && on === laneOpen(old, lane.resource, x)) continue;
          const cy = y + lane.row, id = mat[cy * W + x] & ID_MASK;
          const c = rgb(on ? pipeColor(lane.row, x) : closedLane(x));
          if (id === M.PIPE && PW.getOwner(world, x, cy) === line.owner) PW.setLayer(world, 'paint', x, cy, c);
          else if (PW.getFlags(world, x, cy) & FLAG.HOLLOW) {
            if (PW.getLayer(world, 'pipe', x, cy)) PW.setLayer(world, 'pipe', x, cy, c); else PW.setLayer(world, 'back', x, cy, c);
          }
        }
      }
    }
    // (a branch's single lane: every row inside its casing in its resource's colour, ribbed)
    function branchColor(res, row, along) {
      if (row < 0 || row >= BORE || row === 0 || row === BORE - 1) return pipeColor(row, along);
      const ch = LANES[LANE_OF[res]].channel;
      if (row === 2 || row === 4) return tone(ch, 0.5);
      return (along & 1) ? tone(ch, 1.5) : tone(ch, 0.66);
    }
    // Lay one bundle cell: in the ground a PIPE cell; across open space underground it is fixed to
    // the wall face; through a core's span it breaches plate and foundation into the bed's socket.
    // `row` is the cell's row within the bore (its column, stood on end) - casing 0 and BORE-1,
    // lanes 1/3/5, dividers 2/4; omitted for fittings laid solid whatever the mode. `solid`
    // keeps the lanes solid even with the cavity on: a riser pierces the surface and the
    // machines - carved open it would drain the pump's own lake into the line for real.
    function layCell(line, x, y, color, row, solid, through) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      // The bore is hollow (N17F): its inside rows are marked - bookkeeping for the line's own
      // take-up and repair; what the physics sees is the carve itself, its lanes open air (see
      // PW.PIPE_CAVITY above).
      const inside = row !== undefined && row > 0 && row < BORE - 1;
      const id = mat[y * W + x] & ID_MASK;
      // N83: the line's own carved channel is re-laid as what it now is - a lane takes its new
      // lane's colour (re-read as open space it kept the OLD lane's back wall), and any other
      // row closes it into body (re-read as open space, a casing row stayed open air).
      if (id !== M.PIPE && (PW.mat.open[id] || id === M.WATER) && (PW.getFlags(world, x, y) & FLAG.HOLLOW)
        && PW.getOwner(world, x, y) === line.owner) {
        if (PW.PIPE_CAVITY && !solid && inside && (row & 1)) {
          PW.setLayer(world, 'back', x, y, rgb(color));
          PW.setLayer(world, 'pipe', x, y, 0);
          return true;
        }
        // (hardware - a flange, a valve, a tee's socket - never plugs a live channel)
        if (row === undefined && !solid) return false;
        if (id === M.WATER && world.particles) world.particles.spawn(x + 0.5, y + 0.5, 0, -30, M.WATER, 0, PW.PARTICLE.WATER, 6);
        PW.set(world, x, y, M.PIPE, { quiet: true, lay: true });
        if (!inside) PW.setFlag(world, x, y, FLAG.HOLLOW, false);
        PW.setLayer(world, 'back', x, y, 0);
        PW.setLayer(world, 'pipe', x, y, 0);
        PW.setLayer(world, 'paint', x, y, rgb(color));
        return true;
      }
      const cover = id === M.COVER_ROCK || id === M.COVER_WOOD || id === M.COVER_METAL || id === M.COVER_SAND;
      if (PW.mat.open[id] || id === M.WATER || cover) {
        // Across sheltered open space the bundle is fixed to the wall face (A2.6): a tunnel's, a
        // building's, or any back wall standing there (a terrace's bench wall, a bunker room).
        // Only bare open sky refuses it - the router bridges where a wall face is, and without
        // this the laying refused what the route relied on, leaving the line broken in the open.
        // N83: a JOINT is the exception (`through`): a shaft crossing a bare cleft stands as a
        // real cased tube, anchored into the ground above and below - never a gap in the lanes.
        // (the HOLLOW mark goes only on cells actually laid: a refused cell flagged anyway
        // would read as bore to every guard that honours the mark)
        const bare = y < world.groundTop[x] && !isTunnel(x, y) && !buildingOwned(x, y) && !PW.getLayer(world, 'back', x, y);
        if (bare && !through) return false;
        if (!bare) {
          if (inside) PW.setFlag(world, x, y, FLAG.HOLLOW);
          PW.setLayer(world, 'pipe', x, y, rgb(color));
          return true;
        }
        // bare + through: real tube cells across the cleft (the terrain gate below would
        // refuse the open cell and leave the shaft a stub again).
        if (inside) PW.setFlag(world, x, y, FLAG.HOLLOW);
        if (PW.PIPE_CAVITY && !solid && inside && (row & 1)) {
          PW.set(world, x, y, M.AIR, { quiet: true, lay: true });
          PW.setLayer(world, 'back', x, y, rgb(color));
          PW.setLayer(world, 'paint', x, y, 0);
          PW.setOwner(world, x, y, line.owner);
          return true;
        }
        PW.set(world, x, y, M.PIPE, { quiet: true, lay: true });
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setOwner(world, x, y, line.owner);
        return true;
      }
      if (inside) PW.setFlag(world, x, y, FLAG.HOLLOW);
      if (id === M.REINFORCED || id === M.LINING) {
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      }
      // Through a registered core span the bundle runs in a SLEEVE through whatever the building
      // put there - vault plate, plinth, a stage's timber pier, a buttress - painted across it,
      // the structure itself untouched (nothing load-bearing is cut). A fitting (`through`)
      // sleeves through any works it meets: the router picks a shaft's two levels, never what
      // stands between them, and refused there the lanes broke (seed 7's 289-row shaft down
      // through a building's floors).
      if ((spanAt(x, y) && structural[id])
        || (through && (structural[id] || (buildingOwned(x, y) && !terrain[id])) && id !== M.CORE)) {
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
      // N38 part 4: with the cavity on, a lane row in the ground is REAL space - the tube is
      // terrain, not deco. The lane's ribbed colour becomes the back wall behind the channel.
      if (PW.PIPE_CAVITY && !solid && inside && (row & 1)) {
        PW.set(world, x, y, M.AIR, { quiet: true, lay: true });   // (N17: laying never unseals the bore)
        PW.setLayer(world, 'back', x, y, rgb(color));
        PW.setLayer(world, 'paint', x, y, 0);
        PW.setOwner(world, x, y, line.owner);
        return true;
      }
      PW.set(world, x, y, M.PIPE, { quiet: true, lay: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
      PW.setOwner(world, x, y, line.owner);
      return true;
    }
    // The trench around the bundle: a sand bed above and below (ink-dark where a tendril wraps).
    function bedCell(x, y, color) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
      const id = mat[y * W + x] & ID_MASK;
      if (!terrain[id] || id === M.ORE || id === M.BEDROCK || PW.getOwner(world, x, y) || isTunnel(x, y)) return;
      PW.set(world, x, y, M.FILL, { quiet: true, lay: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
    }
    // N84: one cell of the armoured jacket - the line's own solid PIPE wherever the bed would
    // lie (never over a road, a tunnel, ore or someone's building), sleeve paint through
    // works the bundle may cross, wall-face paint across sheltered space. `through` lays it
    // real over a bare cleft, as the fittings' bore is (N83).
    function jacketCell(line, x, y, color, through) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      const id = mat[y * W + x] & ID_MASK;
      const own = PW.getOwner(world, x, y) === line.owner;
      if (id === M.PIPE) {
        if (!own) return false;
        PW.setFlag(world, x, y, FLAG.HOLLOW, false);
        PW.setLayer(world, 'back', x, y, 0);
        PW.setLayer(world, 'paint', x, y, rgb(color));
        return true;
      }
      if (PW.getFlags(world, x, y) & FLAG.HOLLOW) {
        if (!own) return false;   // (another line's bore)
        fillCell(line, x, y, color);
        return true;
      }
      const cover = id === M.COVER_ROCK || id === M.COVER_WOOD || id === M.COVER_METAL || id === M.COVER_SAND;
      if (PW.mat.open[id] || id === M.WATER || cover) {
        const bare = y < world.groundTop[x] && !isTunnel(x, y) && !buildingOwned(x, y) && !PW.getLayer(world, 'back', x, y);
        if (!bare) { PW.setLayer(world, 'pipe', x, y, rgb(color)); return true; }
        if (!through || id === M.WATER || cover) return false;
      } else if (id === M.REINFORCED || id === M.LINING || id === M.FOUNDATION
        || (spanAt(x, y) && structural[id])
        || (through && (structural[id] || (buildingOwned(x, y) && !terrain[id])) && id !== M.CORE)) {
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      } else if (!terrain[id] || id === M.ORE || id === M.BEDROCK || isTunnel(x, y) || buildingOwned(x, y)) {
        return false;
      }
      PW.set(world, x, y, M.PIPE, { quiet: true, lay: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
      PW.setOwner(world, x, y, line.owner);
      return true;
    }
    // Is (x, y) the line's own work? Its casing and dividers are its M.PIPE cells; with the bore
    // carved (PW.PIPE_CAVITY) its open lane cells are its too, marked HOLLOW under its owner.
    // (the material is read first: the repair sweeps ask this for every cell of a wide band,
    // and the chunked owner lookup is only worth paying on the few cells that could be the
    // line's - the sweeps' old cost, kept)
    function boreCell(line, x, y) {
      const id = mat[y * W + x] & ID_MASK;
      if (id === M.PIPE) return PW.getOwner(world, x, y) === line.owner;
      if (!PW.PIPE_CAVITY) return false;
      return (PW.getFlags(world, x, y) & FLAG.HOLLOW) !== 0 && PW.getOwner(world, x, y) === line.owner;
    }
    // Dig up one cell of the line's own work: back to bed fill, every mark cleared. Water
    // standing in a carved lane is ejected as a drop first, never buried (the N42O rule:
    // the world's water is only ever moved, not minted away).
    function takeUp(line, x, y) {
      if (!boreCell(line, x, y)) return false;
      if (PW.PIPE_CAVITY) {
        if ((mat[y * W + x] & ID_MASK) === M.WATER && world.particles) {
          world.particles.spawn(x + 0.5, y + 0.5, 0, -30, M.WATER, 0, PW.PARTICLE.WATER, 6);
        }
        PW.setLayer(world, 'back', x, y, 0);
      }
      PW.set(world, x, y, M.FILL, { quiet: true, lay: true });
      PW.setFlag(world, x, y, FLAG.HOLLOW, false);
      PW.setLayer(world, 'paint', x, y, rgb(tone(SAND, (PW.hash2(x, y) & 3) === 0 ? 0.88 : 1)));
      PW.setOwner(world, x, y, 0);
      return true;
    }
    // A column of a core's own bed is not laid: the bundle enters one connector and leaves by the
    // other, carried through inside.
    const throughAt = (line, x) => line.cores.some((c) => Math.abs(x - c.x) <= HOP - 1);
    // Inside a pump's intake stretch the bundle is painted as the pump's own conduit:
    // the same dark shell, every lane blacked out but the one glowing water run (N38 -
    // the trunk is the town's; the lake reach reads as the pump's slim tap, not a
    // second pipeline cutting the main one).
    const inIntake = (line, x) => {
      const z = line.intake;
      return !!(z && ((z.left && x >= z.left[0] && x <= z.left[1]) || (z.right && x >= z.right[0] && x <= z.right[1])));
    };
    function intakeColor(row, along) {
      if (row === 0 || row === BORE - 1) {
        if (collarAt(along)) return row === 0 ? NEON_RING_DIM : tone(NEON_RING_DIM, 0.7);
        return row === 0 ? tone(CASING_DARK, 1.15) : CASING_DARK;
      }
      if (row === 5) { const ch = LANES[2].channel; return (along & 1) ? tone(ch, 1.4) : tone(ch, 0.62); }
      return INK;
    }
    function layColumn(line, x) {
      if (throughAt(line, x)) return;
      const y = line.ys[x - line.x0];
      const slim = inIntake(line, x);
      const wisp = tendrilAt(x);
      // N84: the first trench row is the armoured jacket; the gravel bed lies beyond it.
      jacketCell(line, x, y - 1, pipeColor(-1, x));
      jacketCell(line, x, y + BORE, pipeColor(BORE, x));
      for (let b = 2; b <= BED; b += 1) {
        const sand = (k) => (wisp ? tone(INK, 1 + Math.abs(k)) : tone(SAND, (PW.hash2(x, y + k) & 3) === 0 ? 0.62 : 0.74));
        bedCell(x, y - b, sand(-b));
        bedCell(x, y + BORE - 1 + b, sand(b));
      }
      for (let r = 0; r < BORE; r += 1) {
        const lane = r & 1 ? LANES[(r - 1) >> 1] : null;
        const shut = lane && !laneOpen(line.lanes, lane.resource, x);
        layCell(line, x, y + r, slim ? intakeColor(r, x) : shut ? closedLane(x) : pipeColor(r, x), r);
      }
    }
    // A riser between the line and an anchor at (x, y): for the few taps that are not cores (the
    // lake pump, a mining hopper, the main core's pedestal). It is the SAME pipe, turned (the
    // user's rule: vertical and horizontal are one design): the full bore stood on end, casing,
    // lanes, tendril wraps and collars, flanged where it meets the run below - the pump merges
    // into the line as one continuous flow.
    // N161 (the user's, 2026-11-27): a pipe joining the main never joins it near a core, nor over one.
    // A branch whose tee would fall within TEE_CLEAR of a core on the line runs along at its own
    // depth to the nearest clear column first, and tees in there.
    const TEE_CLEAR = 60;   // (30 still set the valve's handwheel by the vault: the eye read it as joining the core)
    function teeClear(line, x) {
      const near = (cx) => line.cores.some((c) => Math.abs(c.x - cx) < TEE_CLEAR);
      if (!near(x)) return x;
      for (let d = 1; d < 400; d += 1) for (const cx of [x - d, x + d]) {
        if (cx < line.x0 + 8 || cx > line.x1 - 8) continue;
        if (!near(cx)) return cx;
      }
      return x;
    }
    // (the run along: the same casing as the riser, laid on its side at the branch's own depth)
    function layFeeder(line, x0, x1, y, res) {
      const a = Math.min(x0, x1) - 3, b = Math.max(x0, x1) + 3;
      for (let x = a; x <= b; x += 1) {
        for (let r = 0; r < BORE; r += 1) layCell(line, x, y - 3 + r, res ? branchColor(res, r, x) : pipeColor(r, x), r, true);
        jacketCell(line, x, y - 4, pipeColor(-1, x));
        jacketCell(line, x, y - 3 + BORE, pipeColor(BORE, x));
      }
    }
    function layRiser(line, anchor) {
      if (anchor.kind !== 'core') {
        const xt = teeClear(line, anchor.x);
        if (xt !== anchor.x) { layFeeder(line, anchor.x, xt, anchor.y, anchor.flow === 'out' ? anchor.resource : null); anchor = { ...anchor, x: xt, fedFrom: anchor.x }; }
      }
      const lineY = line.ys[Math.max(0, Math.min(line.ys.length - 1, anchor.x - line.x0))];
      const yA = Math.min(anchor.y, lineY), yB = Math.max(anchor.y, lineY + BORE - 1);
      // N83: the run's own band (jacket to jacket) passes straight through the tee - laid over
      // it, the solid riser walled every lane of the trunk for seven columns. The riser stops
      // at the trunk's jacket, and its lanes open into the trunk there as ports.
      const inBand = (x, y) => {
        const yr = line.ys[Math.max(0, Math.min(line.ys.length - 1, x - line.x0))];
        return y >= yr - 1 && y <= yr + BORE;
      };
      // (N162: a branch of one resource is drawn as that resource's one lane)
      const one = anchor.flow === 'out' && anchor.resource && LANE_OF[anchor.resource] !== undefined ? anchor.resource : null;
      for (let r = 0; r < BORE; r += 1) {
        const x = anchor.x - 3 + r;
        for (let y = yA; y <= yB; y += 1) if (!inBand(x, y)) layCell(line, x, y, one ? branchColor(one, r, y) : pipeColor(r, y), r, true);
      }
      // (N84: the jacket stands up the riser too - one design, turned)
      for (let y = yA; y <= yB; y += 1) {
        if (!inBand(anchor.x - 4, y)) jacketCell(line, anchor.x - 4, y, pipeColor(-1, y));
        if (!inBand(anchor.x + 4, y)) jacketCell(line, anchor.x + 4, y, pipeColor(BORE, y));
      }
      {
        const above = anchor.y < lineY;
        for (const lane of LANES) {
          if (anchor.resource && lane.resource !== anchor.resource) continue;
          const x = anchor.x - 3 + lane.row;
          const yr = line.ys[Math.max(0, Math.min(line.ys.length - 1, x - line.x0))];
          for (const y of above ? [yr - 1, yr] : [yr + BORE - 1, yr + BORE]) {
            if (boreCell(line, x, y) && (mat[y * W + x] & ID_MASK) === M.PIPE) PW.setLayer(world, 'paint', x, y, rgb(tone(lane.channel, 1.5)));
          }
        }
      }
      layFlange(line, anchor.x, yA - 1);
      if (yB > lineY + BORE - 1) layFlange(line, anchor.x, yB + 1);
      // N30: where the vertical tees into the run it is a proper T-piece with a valve (the
      // user's underground-pipe reference) - never a clogged corner. The junction's lip rows
      // widen into a socket collar, and a gate-valve body with its handwheel sits on the
      // vertical arm just off the main, the same casing language as everything else.
      const xc = anchor.x, fromAbove = anchor.y < lineY;
      for (const ly of [lineY - 1, lineY + BORE]) {
        layCell(line, xc - 4, ly, tone(CASING, 1.18));
        layCell(line, xc + 4, ly, tone(CASING, 1.18));
      }
      layCell(line, xc - 4, lineY, [168, 174, 182]);
      layCell(line, xc + 4, lineY, [168, 174, 182]);
      const vy = fromAbove ? lineY - 7 : lineY + BORE + 5;
      if (vy > yA + 2 && vy < yB - 2) {
        // the valve body: a dark banded block across the vertical arm, bolted
        for (let r = -4; r <= 4; r += 1) {
          layCell(line, xc + r, vy, Math.abs(r) === 4 ? [198, 202, 206] : STEEL_DARK);
          layCell(line, xc + r, vy + 1, Math.abs(r) === 4 ? tone(STEEL, 0.8) : tone(CASING, 0.66));
        }
        // the stem and handwheel: a short spindle off the body, a small bright wheel at its end
        layCell(line, xc + 5, vy, tone(STEEL, 0.9));
        layCell(line, xc + 6, vy, tone(STEEL, 0.9));
        layCell(line, xc + 7, vy - 1, [205, 209, 213]);
        layCell(line, xc + 8, vy, [205, 209, 213]);
        layCell(line, xc + 7, vy + 1, [205, 209, 213]);
        layCell(line, xc + 7, vy, STEEL);
      }
      return { x: anchor.x, y0: yA, y1: yB, anchorY: anchor.y, flow: anchor.flow, kind: anchor.kind, resource: anchor.resource, main: anchor.main,
        tTop: lineY - 9, tBot: lineY + BORE + 9,   // (the T-piece and valve hardware live in this band)
        building: anchor.building, op: anchor.op, fedFrom: anchor.fedFrom, occ: new Uint8Array(yB - yA + 1), timer: 0, pending: 0 };
    }
    // The run's underground ends are closed with a bolted blind flange, its outer face domed -
    // a cap the eye reads as BUILT shut, not as the pipe cut off mid-ground (N37).
    function capEnd(line, side) {
      const endX = side > 0 ? line.x1 : line.x0, y = line.ys[side > 0 ? line.ys.length - 1 : 0];
      for (let c = 1; c <= 3; c += 1) for (let r = -1; r <= BORE; r += 1) {
        const lip = r === -1 || r === BORE;
        if (c === 3 && (r <= 0 || r >= BORE - 1)) continue;   // (shoulders cut: a domed face)
        if (lip && c === 3) continue;
        const bolt = c === 1 && (r === 1 || r === BORE - 2);
        layCell(line, endX + side * c, y + r, lip ? STEEL_DARK : bolt ? [200, 204, 206] : c === 3 ? tone(STEEL, 0.7) : c === 2 ? tone(STEEL, 0.86) : STEEL);
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
    // A solid cell of a fitting's body (N83): lays real tube even over a bare void (`through`),
    // and clears any carved-lane mark it covers so no stale channel haunts the body.
    function fillCell(line, x, y, color) {
      const id0 = mat[y * W + x] & ID_MASK;
      // (already the line's own body: repaint only - a re-laid fitting rewriting every cell
      // fed the structure system churn it never needed)
      if (id0 === M.PIPE && PW.getOwner(world, x, y) === line.owner) {
        if (PW.getFlags(world, x, y) & FLAG.HOLLOW) PW.setFlag(world, x, y, FLAG.HOLLOW, false);
        PW.setLayer(world, 'back', x, y, 0);
        PW.setLayer(world, 'paint', x, y, rgb(color));
        return;
      }
      // The line's own carved channel becomes body directly: layCell would read the open
      // cell with its lane back wall as sheltered space and only paint it. Standing water
      // is ejected first, never buried (the N42O rule, as in takeUp).
      if (id0 !== M.PIPE && (PW.getFlags(world, x, y) & FLAG.HOLLOW) && PW.getOwner(world, x, y) === line.owner) {
        if (id0 === M.WATER && world.particles) {
          world.particles.spawn(x + 0.5, y + 0.5, 0, -30, M.WATER, 0, PW.PARTICLE.WATER, 6);
        }
        PW.set(world, x, y, M.PIPE, { quiet: true, lay: true });
        PW.setFlag(world, x, y, FLAG.HOLLOW, false);
        PW.setLayer(world, 'back', x, y, 0);
        PW.setLayer(world, 'paint', x, y, rgb(color));
        return;
      }
      if (!layCell(line, x, y, color, undefined, true, true)) return;
      if ((mat[y * W + x] & ID_MASK) === M.PIPE) {
        PW.setFlag(world, x, y, FLAG.HOLLOW, false);
        PW.setLayer(world, 'back', x, y, 0);
      }
    }
    // The cells of one fitting: key (y*W+x) -> (idx+1)*4 + kind, idx the ring (-1 and BORE the
    // jacket, 0..BORE-1 the bore's rows), kind 0 a ramp column, 1 the shaft, 2 a turn.
    // A fitting serves a run of level changes that lean the same way with their boxes
    // touching (a staircase the grade left, every 2-row step its own box once - they cut each
    // other's lanes). It meets the runs where they actually arrive, just outside its span.
    // Gentle enough (a row a column or less) it is a RAMP: the bore laid on a slant across
    // the span, every lane running straight through. Steeper, it ramps a row a column into
    // a SHAFT at its tallest step, between two swept TURNS - each a set of concentric
    // quarter rings about the turn's inner corner, so the lane on the outside of the run
    // stays on the outside round the turn and no channel ever crosses another (the old
    // elbows reversed the order against the shaft and dead-ended 45 of 51 lane paths on
    // seed 7). Past the jacket ring the outer corner goes back to the bed: the silhouette
    // itself sweeps. `tops` is the level every ramp and shaft-face column now has.
    // (p..q: the columns the fitting rewrites, met to the runs at p-1 and q+1; kc0 its tallest
    // step. A core bed's carry zone is never written - the bundle is carried inside it.)
    function fittingCells(line, p, q, kc0) {
      const cells = new Map();
      const put = (x, y, idx, kind) => {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || throughAt(line, x)) return;
        cells.set(y * W + x, (idx + 1) * 4 + kind);
      };
      const at = (kk) => line.ys[Math.max(0, Math.min(line.ys.length - 1, kk))];
      const A0 = at(p - 1), B0 = at(q + 1), D = B0 - A0, s = Math.sign(D);
      const span = q - p + 1;
      const tops = new Map();
      cells.tops = tops;
      cells.kc = -1;
      if (Math.abs(D) <= span + 1 || span < 7) {
        for (let kk = p; kk <= q; kk += 1) tops.set(kk, Math.round(A0 + D * (kk - p + 1) / (span + 1)));
      } else {
        const kc = Math.max(p + 3, Math.min(q - 3, kc0));
        for (let kk = p; kk <= kc - 4; kk += 1) tops.set(kk, A0 + s * (kk - p + 1));
        for (let kk = q; kk >= kc + 4; kk -= 1) tops.set(kk, B0 - s * (q + 1 - kk));
        const A = kc - 4 >= p ? tops.get(kc - 4) : A0, B = kc + 4 <= q ? tops.get(kc + 4) : B0;
        cells.kc = kc;
        shaftCells(put, line.x0 + kc, A, B);
        // (the shaft's own columns read their faces' levels: a single clean step at kc)
        for (let kk = kc - 3; kk <= kc + 3; kk += 1) tops.set(kk, kk < kc ? A : B);
      }
      for (const [kk, top] of tops) {
        if (cells.kc >= 0 && Math.abs(kk - cells.kc) <= 3) continue;
        for (let r = -1; r <= BORE; r += 1) put(line.x0 + kk, top + r, r, 0);
      }
      return cells;
    }
    function shaftCells(put, xc, A, B) {
      const down = B > A, hi = Math.min(A, B), lo = Math.max(A, B);
      const x0 = xc - 3, x1 = xc + 3;
      const colIdx = (c) => (down ? BORE - 1 - c : c);
      for (let y = hi + BORE; y < lo; y += 1) for (let c = -1; c <= BORE; c += 1) put(x0 + c, y, colIdx(c), 1);
      const turn = (y0, y1, cx, cy, idxOf, farX) => {
        for (let y = y0; y <= y1; y += 1) {
          for (let x = Math.min(x0, farX); x <= Math.max(x1, farX); x += 1) {
            const ring = Math.floor(Math.hypot(x - cx, y - cy));
            if (ring <= BORE) put(x, y, idxOf(ring), 2);
          }
        }
      };
      // the turn off the higher run (the run on the left when the line steps down), and the
      // turn onto the lower run (on the right when it steps down)
      turn(hi - 1, hi + BORE - 1, down ? x0 - 0.5 : x1 + 0.5, hi + BORE - 0.5,
        (ring) => (ring >= BORE ? -1 : BORE - 1 - ring), down ? x1 + 1 : x0 - 1);
      turn(lo, lo + BORE, down ? x1 + 0.5 : x0 - 0.5, lo - 0.5, (ring) => ring, down ? x0 - 1 : x1 + 1);
    }
    // A turn's colour: the ring's own tone, ribbed lanes, no collar or tendril cut across it.
    function plainColor(idx, along) {
      if (idx < 0) return JACKET_LIT;
      if (idx >= BORE) return JACKET_DARK;
      if (idx === 0) return CASING_LIT;
      if (idx === BORE - 1) return CASING_DARK;
      if (idx === 2 || idx === 4) return DIVIDER;
      const ch = LANES[(idx - 1) >> 1].channel;
      return (along & 1) ? tone(ch, 1.5) : tone(ch, 0.66);
    }
    // Would a fitting's turns or shaft (kinds 1 and 2) stand in a tunnel's open air or in a
    // building's works? (its own line's cells and a core bed's licenced span are its own to take)
    function fitBad(line, cells) {
      for (const [key, v] of cells) {
        if (!(v & 3)) continue;
        const x = key % W, y = (key - x) / W, id = mat[key] & ID_MASK;
        if (PW.getOwner(world, x, y) === line.owner || spanAt(x, y)) continue;
        if (PW.mat.open[id] && isTunnel(x, y)) return true;
        if (!PW.mat.open[id] && buildingOwned(x, y) && !terrain[id]) return true;
      }
      return false;
    }
    function layFitting(line, p, q, kc0, others) {
      const cells = fittingCells(line, p, q, kc0);
      const slim = inIntake(line, line.x0 + ((p + q) >> 1));
      // Clear what the fitting's own columns no longer hold (the run laid there before it,
      // an old fitting) - never a riser standing in them.
      let y0 = Infinity, y1 = -Infinity;
      for (const key of cells.keys()) { const y = (key / W) | 0; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      for (let kk = p; kk <= q; kk += 1) {
        const yr = line.ys[Math.max(0, Math.min(line.ys.length - 1, kk))];
        y0 = Math.min(y0, yr - 2); y1 = Math.max(y1, yr + BORE + 1);
      }
      for (let x = line.x0 + p; x <= line.x0 + q; x += 1) {
        if (throughAt(line, x)) continue;
        for (let y = Math.max(1, y0 - 1); y <= Math.min(H - 2, y1 + 1); y += 1) {
          const key = y * W + x;
          if (cells.has(key) || others.some((w) => w.cells && w.cells.has(key))) continue;
          if (line.risers.some((q) => Math.abs(x - q.x) <= 8 && y >= Math.min(q.y0, q.tTop ?? q.y0) - 1 && y <= Math.max(q.y1, q.tBot ?? q.y1) + 1)) continue;
          if (takeUp(line, x, y)) PW.setLayer(world, 'pipe', x, y, 0);
        }
      }
      for (const [key, v] of cells) {
        const x = key % W, y = (key - x) / W;
        const idx = (v >> 2) - 1, kind = v & 3;
        const along = kind === 0 ? x : kind === 1 ? y : x + y;
        const color = idx < 0 || idx >= BORE ? (kind === 2 ? plainColor(idx, along) : pipeColor(idx, along))
          : slim ? intakeColor(idx, along) : kind === 2 ? plainColor(idx, along) : pipeColor(idx, along);
        if (idx < 0 || idx >= BORE) jacketCell(line, x, y, color, true);
        else if (idx & 1) layCell(line, x, y, color, idx, false, true);
        else fillCell(line, x, y, color);
      }
      // The fitting IS the run through its columns: their levels are now what was laid (the
      // watch, the cargo and the sweeps all read the bore off ys - a staircase or a one-column
      // spike left in it would read as wounds under a whole ramp, and re-lay differently).
      for (const [kk, top] of cells.tops) if (kk >= 0 && kk < line.ys.length) line.ys[kk] = top;
      return cells;
    }
    // Is (x, y) one of a standing fitting's own cells? (the sweeps must leave them be)
    function fittingAt(line, x, y) {
      const key = y * W + x;
      for (const list of [line.wells || [], line.joints || []]) {
        for (const w of list) {
          if (x < w.xa || x > w.xb || y < w.y0 || y > w.y1) continue;
          if (w.cells.has(key)) return true;
        }
      }
      return false;
    }
    function layWells(line, k0 = 1, k1 = Infinity) {
      line.joints = line.joints || [];
      line.wells = line.wells || [];
      // (a fitting spanning the window's edge is re-laid whole, never cut in two)
      const meets = (w) => w.kl >= k0 && w.k <= k1;
      for (const w of [...line.wells, ...line.joints]) if (meets(w)) { k0 = Math.min(k0, w.k); k1 = Math.max(k1, w.kl); }
      const dropped = [...line.wells, ...line.joints].filter(meets);
      line.wells = line.wells.filter((w) => !meets(w));
      line.joints = line.joints.filter((w) => !meets(w));
      const len = line.ys.length;
      for (let k = Math.max(1, k0); k <= Math.min(len - 1, k1); k += 1) {
        const step = line.ys[k] - line.ys[k - 1];
        // N81: a 2-cell step is NOT flat enough to leave bare - the neighbour casing juts
        // into the lane and walls the cargo. One cell is a true flat run; everything over
        // that is a fitting (N83), ramp or shaft.
        if (Math.abs(step) <= 1) continue;
        // the run of steps leaning the same way whose boxes touch this one's
        let kl = k;
        for (let j = k + 1; j < len && j <= kl + 8; j += 1) {
          const d = line.ys[j] - line.ys[j - 1];
          if (d && Math.sign(d) !== Math.sign(step)) break;
          if (Math.abs(d) >= 2) kl = j;
        }
        // The span it rewrites, kept out of any core bed's carry zone: a fitting against a bed
        // meets the bed's own pinned level at the zone's edge (seed 7: a shaft whose box
        // reached into a core unit, its lanes refused by the core's own cells).
        let p = k - 3, q = kl + 3, kc0 = k, best = -1;
        for (let kk = k; kk <= kl; kk += 1) { const d = Math.abs(line.ys[kk] - line.ys[kk - 1]); if (d > best) { best = d; kc0 = kk; } }
        for (const c of line.cores) {
          const zs = c.x - (HOP - 1) - line.x0, ze = c.x + (HOP - 1) - line.x0;
          if (ze < p - 1 || zs > q + 1) continue;
          if (zs + ze > k + kl) q = Math.min(q, zs - 1); else p = Math.max(p, ze + 1);
        }
        if (q < p) { k = kl; continue; }
        // (never across a break: the regrowth lays the broken columns along its own fresh path,
        // and a fitting re-levelling them under it kept re-breaking the front as fast as it
        // healed - seed 11's cut never closed. The step is fitted once the front has passed.)
        let cut = false;
        for (let kk = Math.max(0, p - 1); kk <= Math.min(len - 1, q + 1) && !cut; kk += 1) if (line.broken[kk]) cut = true;
        if (cut) { k = kl; continue; }
        // (cut short by a bed and too steep to ramp: the free side gives the shaft its room)
        const rise = Math.abs(line.ys[Math.min(len - 1, q + 1)] - line.ys[Math.max(0, p - 1)]);
        if (rise > q - p + 2 && q - p + 1 < 9) {
          if (q < kl + 3 && p === k - 3) p = Math.max(1, q - 8);
          else if (p > k - 3 && q === kl + 3) q = Math.min(len - 2, p + 8);
        }
        // (N155: a fitting's turns and shaft are never hung in a tunnel's open air nor pressed into
        // a building's works - seed 7's step stood against a mine's open shaft, seed 3's against a
        // stage's steps, and the lanes came out of the turn shut: the fitting is widened away
        // from them, the shaft set in the rock beyond, a ramp carrying the run to it)
        // (and a shaft's turn must meet a level run: where the run beyond it is still climbing or
        // falling, the turn's rings crossed the ramp's lanes - seed 3 - and the step is widened
        // until it is laid as one straight ramp instead)
        const sloped = (a, b) => {
          const at = (kk) => line.ys[Math.max(0, Math.min(len - 1, kk))];
          const s = Math.sign(at(b + 1) - at(a - 1));
          // (only a run going on the step's own way: arriving already on the move, or leaving it)
          return s !== 0 && (Math.sign(at(a - 1) - at(a - 3)) === s || Math.sign(at(b + 3) - at(b + 1)) === s);
        };
        const unfit = (a, b, kc) => { const cs = fittingCells(line, a, b, kc); return fitBad(line, cs) || (cs.kc >= 0 && sloped(a, b)); };
        if (unfit(p, q, kc0)) {
          const zoneHit = (a, b) => line.cores.some((c) => { const zs = c.x - (HOP - 1) - line.x0, ze = c.x + (HOP - 1) - line.x0; return !(ze < a - 1 || zs > b + 1); });
          const brokenIn = (a, b) => { for (let kk = Math.max(0, a - 1); kk <= Math.min(len - 1, b + 1); kk += 1) if (line.broken[kk]) return true; return false; };
          let found = null;
          for (let shift = 4; shift <= 32 && !found; shift += 4) {
            for (const [dl, dr] of [[0, shift], [shift, 0], [shift >> 1, shift >> 1]]) {
              const p2 = p - dl, q2 = q + dr;
              if (p2 < 1 || q2 > len - 2 || zoneHit(p2, q2) || brokenIn(p2, q2)) continue;
              const kc2 = dr > dl ? q2 - 3 : dl > dr ? p2 + 3 : kc0;
              if (!unfit(p2, q2, kc2)) { found = { p: p2, q: q2, kc: kc2 }; break; }
            }
          }
          if (found) { p = found.p; q = found.q; kc0 = found.kc; }
        }
        const others = [...line.wells, ...line.joints];
        const cells = layFitting(line, p, q, kc0, others);
        let y0 = Infinity, y1 = -Infinity, xa = Infinity, xb = -Infinity;
        for (const key of cells.keys()) {
          const y = (key / W) | 0, x = key - y * W;
          if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < xa) xa = x; if (x > xb) xb = x;
        }
        const kc = cells.kc;
        const rec = { k: p, kl: q, x: line.x0 + (kc >= 0 ? kc : (p + q) >> 1), xa, xb, y0, y1, cells };
        if (kc >= 0) {
          line.wells.push(rec);
          stats.wells = (stats.wells || 0) + 1;
        } else {
          line.joints.push(rec);
        }
        k = kl;
      }
      // A fitting whose step a fresh route smoothed away (or moved) takes its old cells
      // with it: whatever no standing fitting and no live run column holds is dug up.
      const held = (x, y, key) => {
        const kk = x - line.x0;
        if (kk >= 0 && kk < line.ys.length && y >= line.ys[kk] - 1 && y <= line.ys[kk] + BORE) return true;
        return line.wells.some((q) => q.cells && q.cells.has(key)) || line.joints.some((q) => q.cells && q.cells.has(key));
      };
      for (const w of dropped) {
        if (!w.cells) continue;
        for (const key of w.cells.keys()) {
          const x = key % W, y = (key - x) / W;
          if (held(x, y, key)) continue;
          takeUp(line, x, y);
          PW.setLayer(world, 'pipe', x, y, 0);
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
    // (owners come off a sequence, never lines.length: a merge splices lines out (N75), and a
    // recycled owner would hand one line's leavings to another)
    let lineSeq = 0;
    function newLine(side, settlement, x0, x1, cores, coreX) {
      return { id: lineSeq, side, settlement, spec: { bundle: true }, owner: OWNER_BASE + (lineSeq += 1) - 1,
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
            // (the pit riser is the town's STORES intake: every lane delivers here - ore,
            // soft materials and water alike - so no resource tag)
            anchors.push({ x: rx, y: ry, kind: 'core', flow: 'in', building: b.id, main: true });
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
        // N38 refine (the user's pump rule): the TRUNK is the town's - the pump connects
        // the way a building does, and the stretch out to its lake intake is the pump's
        // own slim conduit (same shell, one glowing water lane), tee'd off the trunk at
        // the town edge instead of dragging the whole three-lane bundle to the shore.
        const lakeXs = [...cores.filter((c) => c.core && c.core.kind === 'pump').map((c) => c.x),
          ...anchors.filter((a) => a.kind === 'pump').map((a) => a.x)];
        const townOnly = xs.filter((v) => !lakeXs.includes(v));
        let intake = null;
        if (lakeXs.length && townOnly.length) {
          const tx0 = Math.min(...townOnly) - SPAN - 4, tx1 = Math.max(...townOnly) + SPAN + 4;
          intake = { left: x0 < tx0 - 8 ? [x0, tx0] : null, right: x1 > tx1 + 8 ? [tx1, x1] : null };
          if (!intake.left && !intake.right) intake = null;
        }
        const coreX = mainCore ? Math.round((mainCore.body.left + mainCore.body.right) / 2) : Math.round((x0 + x1) / 2);
        const line = newLine(settlement.side, settlement, x0, x1, cores.sort((p, q) => p.x - q.x), coreX);
        line.intake = intake;
        line.ys = contour(x0, x1, depthAt);
        snapToCores(line.ys, x0, line.cores);
        for (let x = x0; x <= x1; x += 1) layColumn(line, x);
        layWells(line);
        for (const a of anchors) line.risers.push(layRiser(line, a));
        // the tee where the pump's conduit leaves the trunk: flanged above and below
        for (const z of [intake && intake.left && intake.left[1], intake && intake.right && intake.right[0]]) {
          if (!z) continue;
          const ly = line.ys[Math.max(0, Math.min(line.ys.length - 1, z - x0))];
          layFlange(line, z, ly - 1);
          layFlange(line, z, ly + BORE);
        }
        capEnd(line, -1); capEnd(line, 1);
        enforceGrade(line, 0, line.ys.length - 1);   // N81: born lawful
        refreshLanes(line);   // N162: only the lanes its sources and takers span show open
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
        enforceGrade(line, 0, line.ys.length - 1);   // N81: the long reach obeys the law
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
        // N3: within a building's licenced span the carriage is sleeved through its works -
        // the bed's shoulder armour is NOT a cut (the watch froze against it for ever).
        if (spanAt(x, y + r)) return true;
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
        // (the fittings kept off the break while it was open are laid across the whole healed
        // span now it has closed - a step a few columns from the last column to heal was left
        // bare otherwise)
        layWells(line, Math.max(1, line.hurt.k0 - FIT), Math.min(line.ys.length - 1, line.hurt.k1 + FIT));
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
      // (the adoption era re-threads lines while they mend: a stale hurt index past the
      // line's end must never ask for a negative span)
      const b0 = Math.min(line.ys.length - 1, b + 10);
      const a0 = Math.max(0, Math.min(a - 10, b0));
      const ys = contour(line.x0 + a0, line.x0 + b0, depthAt);
      snapToCores(ys, line.x0 + a0, line.cores.filter((c) => c.x >= line.x0 + a0 - SPAN && c.x <= line.x0 + b0 + SPAN));
      return (line.growPath = { at: tick, a: a0, b: b0, ys });
    }
    function growEnd(line, k, dir) {
      const path = freshPath(line, Math.max(0, k - 2), Math.min(line.ys.length - 1, k + 2));
      const ny = path.ys[k - path.a];
      const old = line.ys[k];
      // A riser standing here (a pump's, a hopper's) never pins the run (N25F): the level
      // moves wherever the fresh path goes, the old level is taken up even beside the riser,
      // and the riser simply re-joins the run below - its vertical laid again down to the new
      // level. Only the riser's own fresh vertical bore is spared from the take-up.
      const rr = Math.abs(ny - old) > 1 ? line.risers.find((q) => Math.abs(line.x0 + k - q.x) <= 4) : null;
      const rY0 = rr ? Math.min(rr.anchorY, ny) : 0, rY1 = rr ? Math.max(rr.anchorY, ny + BORE - 1) : 0;
      if (Math.abs(ny - old) > 1) {
        // Take up what is left of the old run in this column - the WHOLE span between the old
        // level and the new one (a freshly read path can move the line by storeys; nothing of
        // the abandoned level may stay behind), plus a margin for casing the blast let lie.
        const lo = Math.min(ny, old) - 8, hi = Math.max(ny, old) + BORE + 8;
        for (let y = Math.max(1, lo), x = line.x0 + k; y <= Math.min(H - 2, hi); y += 1) {
          if (y >= ny - 1 && y <= ny + BORE) continue;   // the new bore and its lip stay
          if (rr && Math.abs(x - rr.x) <= 3 && y >= rY0 - 1 && y <= rY1 + 1) continue;
          takeUp(line, x, y);
          PW.setLayer(world, 'pipe', x, y, 0);
        }
      }
      line.ys[k] = ny;
      layColumn(line, line.x0 + k);
      layWells(line, Math.max(1, k - FIT), Math.min(line.ys.length - 1, k + FIT));
      if (rr) {
        const fresh = layRiser(line, { x: rr.fedFrom ?? rr.x, y: rr.anchorY, flow: rr.flow, kind: rr.kind, resource: rr.resource, building: rr.building, op: rr.op });
        Object.assign(rr, { y0: fresh.y0, y1: fresh.y1, occ: fresh.occ, tTop: fresh.tTop, tBot: fresh.tBot });
      }
      // The growing end is the pipe stamping its own cross-section outward (N14F/N16F - the
      // user kept the glitch as the feature): a vertical segment of the same bore design at
      // the tip, each step's stamp left standing behind the last, so the reaching end trails
      // a brief curtain of verticals - and when the ends meet, the closure sweeps leave one
      // clean pipe and nothing else. Same design as every pipe; no overlay.
      const tipX = line.x0 + k + dir * 4;
      for (let r = 0; r < BORE; r += 1) {
        // (only into the gap: stamped over the standing run beyond a narrow cut, the vertical
        // turned its lanes on end, the watch read those columns as broken, and the break rolled
        // on ahead of the front for ever - seed 11's cut never closed)
        const kk = tipX - 3 + r - line.x0;
        if (kk < 0 || kk >= line.broken.length || !line.broken[kk]) continue;
        for (let y = ny - 8; y < ny + BORE + 8; y += 1) layCell(line, tipX - 3 + r, y, pipeColor(r, y), r);
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
        // (the fittings round the healed column are laid now the front has passed it - they
        // keep off broken columns, and this one was broken until a moment ago)
        layWells(line, Math.max(1, k - FIT), Math.min(line.ys.length - 1, k + FIT));
        // The wreck of the old run in this column is taken up as the end closes over it - a
        // wide sweep for casing the blast let come to rest anywhere nearby (wells and the
        // risers' own verticals excepted).
        for (let r = -26, x = line.x0 + k; r <= BORE + 34; r += 1) {
          if (r >= -1 && r <= BORE) continue;
          const y = ny + r;
          if (y < 1 || y >= H - 1) continue;
          if (fittingAt(line, x, y)) continue;
          if (line.risers.some((q) => (Math.abs(x - q.x) <= 4 && y >= q.y0 - 1 && y <= q.y1 + 1)
            || (Math.abs(x - q.x) <= 8 && y >= (q.tTop ?? q.y0) && y <= (q.tBot ?? q.y1)))) continue;   // (shaft, and the T-valve's band out to +-8)
          takeUp(line, x, y);
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
        // (the band reaches well above and below: a path re-read mid-growth can wander by
        // storeys, and everything of the line's own left off the final route is garbage)
        for (let r = -70; r <= BORE + 44; r += 1) {
          if (r >= -1 && r <= BORE) continue;
          const y = y0 + r;
          if (y < 1 || y >= H - 1) continue;
          if (fittingAt(line, x, y)) continue;
          // (a riser's fresh vertical is the line's own and stays; old casing in its columns
          // but outside it is wreckage like any other - a pump must not shelter a snarl)
          if (line.risers.some((q) => (Math.abs(x - q.x) <= 4 && y >= q.y0 - 1 && y <= q.y1 + 1)
            || (Math.abs(x - q.x) <= 8 && y >= (q.tTop ?? q.y0) && y <= (q.tBot ?? q.y1)))) continue;   // (shaft, and the T-valve's band out to +-8)
          if (takeUp(line, x, y)) PW.setLayer(world, 'pipe', x, y, 0);
        }
      }
    }
    function regrow() {
      for (const line of lines) {
        if (!line.brokenCount || !line.hurt) { if (!line.brokenCount) line.growPath = null; continue; }
        // (only the hurt span is walked - the physics track profiled the full-line walk; a
        // snapshot, because the closure sweep clears line.hurt the moment the last column heals.
        // Clamped to the arrays: a re-thread mid-mend can leave the hurt pointing past them.)
        const h0 = Math.max(0, line.hurt.k0);
        const h1 = Math.min(line.hurt.k1, line.broken.length - 1, line.ys.length - 1);
        for (let k = h0; k <= h1; k += 1) {
          if (!line.broken[k]) continue;
          let k1 = k;
          while (k1 + 1 < line.broken.length && line.broken[k1 + 1]) k1 += 1;
          const settled = tick - Math.max(line.brokenAt[k], line.brokenAt[k1]) >= REGROW_DELAY;
          stats.gapsSeen = (stats.gapsSeen || 0) + 1;
          if (!settled) stats.gapsFresh = (stats.gapsFresh || 0) + 1;
          if (settled && tick % GROW_EVERY === 0) {
            stats.growTries = (stats.growTries || 0) + 1;
            // Starved ends draw from their side's stock (the cores send it down the line);
            // otherwise the clogged HM pays for every cell. A RICH purse buys a bigger
            // draught - the adoption era's re-seat churn cuts the line by the dozen, and a
            // one-coin trickle paced the crews to minutes; a funded town mends in step
            // with its own growth (still paid for, coin for coin: N4).
            if ((line.fuel || 0) < REPAIR_HM_PER_CELL && tick - (line.fedAt || 0) > STARVED) {
              const stock = world.stock && world.stock[line.side];
              if (stock && stock.hm >= 1) {
                const draw = Math.min(8, Math.floor(stock.hm / 40) + 1, stock.hm);
                stock.hm -= draw; line.fuel = (line.fuel || 0) + draw;
              }
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
    // N75: the nearest line of the side, by distance to its span - a seed joins the pipeline
    // closest to where it lands, never "the first one built" half a map away.
    function lineNear(side, x) {
      let best = null, bestD = Infinity;
      for (const l of lines) {
        if (l.side !== side) continue;
        const d = x < l.x0 ? l.x0 - x : x > l.x1 ? x - l.x1 : 0;
        if (d < bestD) { bestD = d; best = l; }
      }
      return best;
    }
    // N75: one pipeline. A line grown out to a seed that reaches another line of its own side
    // ABSORBS it - every core threads the one bundle, the old run is taken up back to bed
    // fill, its risers are laid again on the survivor (the user's rule: a single resource
    // pipeline across all seeds, joining friendly lines wherever their cores sit on it).
    const MERGE_TOUCH = 30;
    function absorb(line, M) {
      // the old run goes first, while its ys still describe it - bore, caps and wreckage
      for (let k = 0; k < M.ys.length; k += 1) {
        const x = M.x0 + k, y0 = M.ys[k];
        for (let y = Math.max(1, y0 - 9); y <= Math.min(H - 2, y0 + BORE + 9); y += 1) {
          if (takeUp(M, x, y)) PW.setLayer(world, 'pipe', x, y, 0);
        }
      }
      for (const r of M.risers) {
        const yA = Math.max(1, Math.min(r.tTop ?? r.y0, r.y0) - 2), yB = Math.min(H - 2, Math.max(r.tBot ?? r.y1, r.y1) + 2);
        for (let x = r.x - 8; x <= r.x + 8; x += 1) {
          for (let y = yA; y <= yB; y += 1) if (takeUp(M, x, y)) PW.setLayer(world, 'pipe', x, y, 0);
        }
      }
      const x0 = Math.min(line.x0, M.x0), x1 = Math.max(line.x1, M.x1);
      line.cores = [...line.cores, ...M.cores].sort((p, q) => p.x - q.x);
      const fresh = contour(x0, x1, depthAt);
      snapToCores(fresh, x0, line.cores);
      extendTo(line, x0, x1, (c) => fresh[c - x0]);
      for (const a of M.risers) {
        line.risers.push(layRiser(line, { x: a.fedFrom ?? a.x, y: a.anchorY, flow: a.flow, kind: a.kind, resource: a.resource, building: a.building, op: a.op, main: a.main }));
      }
      layWells(line);
      capEnd(line, -1); capEnd(line, 1);
      // N81: the fused JOIN obeys the law (windowed - a whole-line sweep per merge blew
      // the collapse suite's frame budget under the adoption era's churn)
      enforceGrade(line, Math.max(0, M.x0 - line.x0 - 60), Math.min(line.ys.length - 1, M.x1 - line.x0 + 60));
      checkSpan(line, Math.max(0, M.x0 - line.x0 - 2), Math.min(line.ys.length - 1, M.x1 - line.x0 + 2));
      stats.cores += 0;   // (the cores only changed hands)
      stats.merged = (stats.merged || 0) + 1;
      refreshLanes(line, true);   // (N162: the fused line's lanes laid afresh over its whole length)
    }
    // N75: the city engine says two same-side cities have MET - every line of the side
    // within reach of the pair fuses into one, the connecting stretch laid whole. (The
    // lines trail the cities' edges by the approach spans, so span-touch alone would
    // leave twin bundles under a welded seam for ever.)
    function unite(side, xa, xb) {
      const near = lines.filter((l) => l.side === side && l.x1 >= xa - 420 && l.x0 <= xb + 420);
      if (near.length < 2) return false;
      let keep = near[0];
      for (const l of near) if ((l.x1 - l.x0) > (keep.x1 - keep.x0)) keep = l;
      for (const M of near) {
        if (M === keep) continue;
        const at = lines.indexOf(M);
        if (at >= 0) lines.splice(at, 1);
        absorb(keep, M);
      }
      stats.lines = lines.length;
      return true;
    }
    function mergeTouching(line) {
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const M = lines[i];
        if (M === line || M.side !== line.side) continue;
        if (M.x0 > line.x1 + MERGE_TOUCH || M.x1 < line.x0 - MERGE_TOUCH) continue;
        lines.splice(i, 1);
        absorb(line, M);
        stats.lines = lines.length;
      }
    }
    // (N162: a core joining - or a line it grew into another - opens the lanes its taps reach to)
    function connectCore(x, y, side, taps, building) {
      const core = connectCoreTo(x, y, side, taps, building);
      if (core) for (const line of lines) if (line.side === side && line.cores.includes(core)) refreshLanes(line);
      return core;
    }
    function connectCoreTo(x, y, side, taps, building) {
      let line = lineNear(side, x);
      // A core the map cannot hold cannot thread (a walked-off append once offered one at
      // negative x, and the line extended right off the world after it).
      if (x < 80 || x > world.width - 80) return null;
      const core = { x, y, building: building || 0, type: taps ? 'building' : 'seed', taps: taps || { hm: 'in', sm: 'in', water: 'in' }, timer: 0 };
      // N75: no line of this side anywhere - the FIRST seed founds the pipeline: a short
      // run through its own connectors, capped both ends. Every later seed joins THIS line.
      if (!line) {
        const f0 = Math.max(4, x - SPAN - 6), f1 = Math.min(world.width - 5, x + SPAN + 6);
        line = newLine(side, null, f0, f1, [], x);
        line.ys = contour(f0, f1, depthAt);
        lines.push(line);
        registerSpan(core, building || 0);
        line.cores.push(core);
        stats.cores += 1;
        snapToCores(line.ys, f0, line.cores);
        for (let c = f0; c <= f1; c += 1) layColumn(line, c);
        layWells(line);
        capEnd(line, -1); capEnd(line, 1);
        stats.cells += f1 - f0 + 1;
        stats.lines = lines.length;
        return core;
      }
      registerSpan(core, building || 0);
      line.cores.push(core);
      line.cores.sort((p, q) => p.x - q.x);
      stats.cores += 1;
      if (x - SPAN - 4 < line.x0 || x + SPAN + 4 > line.x1) {
        // Beyond an end: the line runs on to it.
        const x0 = Math.min(line.x0, x - SPAN - 4), x1 = Math.max(line.x1, x + SPAN + 4);
        const oldX0 = line.x0, oldX1 = line.x1;
        const fresh = contour(x0, x1, depthAt);
        snapToCores(fresh, x0, line.cores);
        extendTo(line, x0, x1, (c) => fresh[c - x0]);
        layWells(line);
        if (x0 < line.x0 + 1) capEnd(line, -1);
        if (x1 > line.x1 - 1) capEnd(line, 1);
        // N81: only the grown stretch needs the law (windowed for the frame budget)
        if (x0 < oldX0) enforceGrade(line, 0, Math.min(line.ys.length - 1, oldX0 - x0 + 80));
        if (x1 > oldX1) enforceGrade(line, Math.max(0, oldX1 - x0 - 80), line.ys.length - 1);
        // N75: the grown line may now touch another of its side - they become one.
        mergeTouching(line);
        return core;
      }
      // Mid-run: the stretch around it is taken up and re-laid through its connectors. The
      // window reaches the NEIGHBOURING cores when they stand close, so the N37 shelf
      // between beds is actually rewritten - a window narrower than the shelf left the old
      // V-dive standing beside every new cabinet (the user's reopened bend screenshots).
      let aX = x - (SPAN * 2 + RAMP + 6), bX = x + SPAN * 2 + RAMP + 6;
      for (const c of line.cores) {
        if (c.x < x && x - c.x <= 150) aX = Math.min(aX, c.x - SPAN - 2);
        if (c.x > x && c.x - x <= 150) bX = Math.max(bX, c.x + SPAN + 2);
      }
      const a = Math.max(0, aX - line.x0), bk = Math.min(line.ys.length - 1, bX - line.x0);
      const fresh = contour(line.x0 + a, line.x0 + bk, depthAt);
      snapToCores(fresh, line.x0 + a, line.cores.filter((c) => c.x >= line.x0 + a - SPAN && c.x <= line.x0 + bk + SPAN));
      const rsnap = snapRisers(line);   // N81/N25F: risers the splice moves are laid again below
      const ease = (t) => t * t * (3 - 2 * t);
      for (let j = 0; j <= bk - a; j += 1) {
        const k = a + j, old = line.ys[k];
        const t = ease(Math.min(1, Math.min(k - a, bk - k) / RAMP));
        const ny = Math.round(old + (fresh[j] - old) * t);
        if (ny === old) continue;
        // (take up the old pipe in this column, then lay it on the new row)
        for (let r = -1; r <= BORE; r += 1) {
          const yy = old + r, xx = line.x0 + k;
          takeUp(line, xx, yy);
          if (r >= 0 && r < BORE) PW.setLayer(world, 'pipe', xx, yy, 0);
        }
        // N34 reopen: where the path moves whole storeys, the abandoned corridor's pale
        // trench bed FADES back to turned earth - the old re-lays' bright loops read as a
        // second overlapping tube at the user's close look.
        if (Math.abs(ny - old) > 6) {
          const xx = line.x0 + k;
          for (let yy = old - BED - 2; yy <= old + BORE + BED + 2; yy += 1) {
            if (yy >= ny - 1 && yy <= ny + BORE) continue;
            if ((mat[yy * W + xx] & ID_MASK) === M.FILL && !PW.getOwner(world, xx, yy)) {
              PW.setLayer(world, 'paint', xx, yy, rgb(tone([108, 88, 60], (PW.hash2(xx, yy) & 3) === 0 ? 0.88 : 1)));
            }
          }
        }
        line.ys[k] = ny;
      }
      for (let k = a; k <= bk; k += 1) layColumn(line, line.x0 + k);
      layWells(line, Math.max(1, a - FIT), Math.min(line.ys.length - 1, bk + FIT));
      relayMovedRisers(line, rsnap);
      enforceGrade(line, a, bk);   // N81: the window's seams obey the law
      // N3: the re-lay closes its own window now - stale marks clear here, not when the
      // starved crews get round to them.
      for (let k = a; k <= bk; k += 1) if (line.broken[k] && intactAt(line, line.x0 + k)) clearBroken(line, k);
      return core;
    }
    // N104: a road bored through a mountain carries the bundle with it - every line crossing [x0, x1]
    // is taken up and laid again on rowAt(x) (under the road's bed), easing back to its own run over
    // RAMP columns either side - the splice above, along a given line instead of the ground's.
    function relayAlong(x0, x1, rowAt) {
      let moved = 0;
      const X0 = Math.round(x0), X1 = Math.round(x1);
      for (const line of lines) {
        if (X1 < line.x0 || X0 > line.x1) continue;
        // (the ease is long enough that the line never climbs more than its grade allows on the way
        // in or out - a short ease stepped it storeys a column, and the lanes could not pass)
        const at = (x) => line.ys[Math.max(0, Math.min(line.ys.length - 1, x - line.x0))];
        const ramp = Math.max(RAMP, Math.ceil(Math.max(Math.abs(rowAt(X0) - at(X0)), Math.abs(rowAt(X1) - at(X1))) / 1.4));
        const a = Math.max(0, X0 - ramp - line.x0), bk = Math.min(line.ys.length - 1, X1 + ramp - line.x0);
        if (bk - a < 2) continue;
        const rsnap = snapRisers(line);
        const ease = (t) => t * t * (3 - 2 * t);
        for (let k = a; k <= bk; k += 1) {
          const x = line.x0 + k, old = line.ys[k];
          // (full depth inside the span, eased in over the ramp at either end - and never moved at a
          // core's connectors: a town's beds by the portal keep the line where it plugs in)
          const into = Math.min(x - X0 + ramp, X1 + ramp - x);
          let near = Infinity;
          for (const c of line.cores) near = Math.min(near, Math.abs(x - c.x));
          // (the cores' keep-out is short - the long ease is for climbing in and out of the span; used
          // round a town's beds by the portal it left the line where it was for hundreds of columns
          // into the tunnel, across the road)
          const t = ease(Math.max(0, Math.min(1, into / ramp))) * ease(Math.max(0, Math.min(1, (near - SPAN - 2) / (RAMP * 2))));
          const target = rowAt(Math.max(X0, Math.min(X1, x)));
          const ny = Math.round(old + (target - old) * t);
          if (ny === old) continue;
          for (let r = -1; r <= BORE; r += 1) {
            takeUp(line, x, old + r);
            if (r >= 0 && r < BORE) PW.setLayer(world, 'pipe', x, old + r, 0);
          }
          line.ys[k] = ny;
          moved += 1;
        }
        if (!moved) continue;
        for (let k = a; k <= bk; k += 1) layColumn(line, line.x0 + k);
        layWells(line, Math.max(1, a - FIT_RELAY), Math.min(line.ys.length - 1, bk + FIT_RELAY));
        relayMovedRisers(line, rsnap);
        enforceGrade(line, a, bk);
        for (let k = a; k <= bk; k += 1) if (line.broken[k] && intactAt(line, line.x0 + k)) clearBroken(line, k);
      }
      return moved;
    }
    const FIT_RELAY = 5;
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
      const line = op.riser ? lineNear(op.side, op.riser.x) : null;   // (N75: the nearest, as seeds do)
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
      line.risers.push(layRiser(line, { x, y: op.riser.y, flow: 'out', kind: op.kind || 'mining', resource: op.resource || 'hm', op: op.id, building: op.building || 0 }));
      for (const side of grow) capEnd(line, side);
      refreshLanes(line);   // N162: its resource's lane opens to where it is taken
      return true;
    }
    // N136: a farm's well - the same pipe stood on end, down from the side's line to an underground
    // lake's roof, a pump riser: water comes up it at the lake pump's rate (metered: no cell moves).
    function attachWell(side, x, y, building) {
      return attach({ side, riser: { x, y }, id: `well-${building}`, kind: 'pump', resource: 'water', building });
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
      // Every in-riser is a stores intake (the pit drinks every lane; a hopper is a source,
      // not listed). The grade law (swept bends, no bare cliff) is what keeps the lanes open
      // to them - the deadlock watch in pw-pipe-flow proves cargo reaches them.
      for (const r of line.risers) if (r.flow === 'in') out.push({ riser: r });
      return out;
    }
    function spawnAt(line, resource, source) {
      // (backstop: however the war goes, a line never holds more cargo than this - the sources
      // hold their feed back rather than bury the lane; the clog rule drains jams from the front)
      if (line.packets.length >= MAX_PACKETS) { stats.choked = (stats.choked || 0) + 1; return false; }
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
      // N136 (the user's): a farm without a water supply grows nothing - its well still drilling, or
      // cut (pw-capital-growth's wells)
      if (b.dry) return 0;
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
        // N81: a destination that died mid-journey (its building released, its riser gone,
        // its core off the line) re-routes the cargo to a living mouth - or spills it into
        // the works if the side has none left. Nothing waits for ever on a ghost.
        if (!p.dst || (p.dst.riser && !line.risers.includes(p.dst.riser))
          || (p.dst.core && !line.cores.includes(p.dst.core))) {
          const targets = destinations(line, p.resource);
          if (!targets.length) {
            line.occ[laneOf(line, p.x, p.lane)] = 0;
            p.done = true; stats.spilled += 1;
            return true;
          }
          p.dst = targets[line.next[p.resource]++ % targets.length];
          p.dstX = p.dst.core ? p.dst.core.x : p.dst.riser.x;
        }
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
        // Arrived at a broken end: the cargo IS the mend's supply (the user's N15F design,
        // wired at last - it was written in the comments and never in the code). The HM that
        // clogs here fuels the regrowth; water runs out into the hole; SM merges into the
        // ground. Nothing waits at a wound for ever - unwired, packets piled without bound
        // through a long war and the heap grew until the browser died (PS's soak).
        const kn = nx - line.x0;
        if (kn < 0 || kn >= line.broken.length || line.broken[kn]) {
          // N38: before anything else the pixel PUSHES OUT - the stream blasts the debris
          // choking its mouth, a few cells per arriving pixel, so a buried end eats itself
          // free while the regrowth reaches for the far side.
          const my = rowOf(line, p.x, p.lane);
          let cleared = 0;
          for (let d = 1; d <= 4 && cleared < 3; d += 1) {
            const tx = p.x + dir * d;
            if (tx < 1 || tx >= W - 1) break;
            for (let r = -1; r <= 1 && cleared < 3; r += 1) {
              const ty = my + r;
              if (ty < 1 || ty >= H - 1) continue;
              const id2 = mat[ty * W + tx] & ID_MASK;
              if (id2 === M.DEBRIS || id2 === M.RUBBLE || id2 === M.SAND || id2 === M.ASH
                || id2 === M.LOOSE_SOIL || id2 === M.LOOSE_STONE) {
                PW.set(world, tx, ty, M.AIR, { quiet: true, lay: true });
                cleared += 1;
              }
            }
          }
          line.occ[laneOf(line, p.x, p.lane)] = 0;
          if (line.atCol) line.atCol.delete(p.lane * W + p.x);
          p.done = true;
          if (p.resource === 'hm') { line.fuel = (line.fuel || 0) + 1; line.fedAt = tick; stats.clogged = (stats.clogged || 0) + 1; }
          // (water and SM just drain into the torn ground - no standing water appears: the
          // pump only measured the lake, so cargo materialising as cells would mint water)
          else stats.spilled += 1;
          return true;
        }
        // A well between the columns: the packet climbs the shaft, a few cells a step,
        // instead of teleporting between the levels.
        const ty = rowOf(line, nx, p.lane);
        if (Math.abs(ty - p.y) > 1) { p.y += Math.sign(ty - p.y) * Math.min(3, Math.abs(ty - p.y)); return true; }
        // N17 (the pipes half): a stray lump sitting in the lane - debris in through a breach,
        // the rubble of a blown divider - is PUSHED ALONG by the stream, one cell a step, and
        // at the core's connector it reaches it disintegrates and ignites (the user's rule:
        // what gets in and cannot escape is walked to a core and burns).
        const sid = mat[ty * W + nx] & ID_MASK;
        // Only the loose junk is walked or ground - the blast's own debris family (as the
        // N38 mouth-clearing). A heart, a steel, a water cell in the lane just stops the
        // stream: hearts are sacred, water is conserved (N42O), and both leave by their
        // own rules.
        const loose = sid === M.DEBRIS || sid === M.RUBBLE || sid === M.SAND || sid === M.ASH
          || sid === M.LOOSE_SOIL || sid === M.LOOSE_STONE;
        // Everything else in a lane - water spilled at a cut, collapsed ground at a wound,
        // a fallen heart - is some other rule's business (the drain, the regrow, the rise),
        // and the stream rides past it as it always did.
        if (loose) {
          // (<= HOP + 2, not === HOP: the bed's socket juts a cell or two proud of the port
          // column, and a lump rolled up against it must burn there, not grind - PS's
          // end-to-end catch: every lump at line 0's core ground away, none ever burned)
          const atPort = line.cores.some((c) => Math.abs(nx - c.x) <= HOP + 2);
          if (atPort && PW.boreBurn && PW.boreBurn(world, nx, ty)) {
            stats.burned = (stats.burned || 0) + 1;
          } else {
            // The walk always heads for the NEAREST core, whichever way the shoving packet
            // travels - two streams meeting over a lump once ping-ponged it round an
            // equilibrium outside the burn mouth for ever (141 shoves, nothing burned).
            // The stream's job is disposal: every shove moves the lump portward.
            let home = null;
            for (const c of line.cores) if (!home || Math.abs(nx - c.x) < Math.abs(nx - home.x)) home = c;
            const dirL = home ? (Math.sign(home.x - nx) || dir) : dir;
            // The walk follows the LANE, row by row - the bore eases toward every bed over
            // its ramp, and a straight-row shove jammed lumps into the bend's casing where
            // the grind quietly ate them short of the mouth (12 shoves, nothing burned).
            const rowAt = (qx) => line.ys[Math.max(0, Math.min(line.ys.length - 1, qx - line.x0))] + LANES[p.lane].row;
            let shifted = false;
            for (let m = 1; m <= 10 && !shifted; m += 1) {
              const qx = nx + dirL * m;
              if (qx < line.x0 + 1 || qx > line.x1 - 1) break;
              const qy = rowAt(qx);
              const qid = mat[qy * W + qx] & ID_MASK;
              if (qid === M.PIPE) break;   // jammed against true casing: nothing rolls
              // (only along the lane itself: inside a bed's carry zone, or anywhere the row is not
              // the line's own channel, the shove swapped the made ground under a building's
              // footing sideways a cell at a time - seed 11's re-founded tower got its seams so)
              if (throughAt(line, qx) || !(PW.getFlags(world, qx, qy) & FLAG.HOLLOW) || PW.getOwner(world, qx, qy) !== line.owner) break;
              if (qid === M.AIR || PW.mat.phase[qid] <= PW.PHASE.GAS) {
                for (let j = m - 1; j >= 0; j -= 1) {
                  const ax = nx + dirL * j, bx = nx + dirL * (j + 1);
                  PW.swapCells(world, rowAt(ax) * W + ax, rowAt(bx) * W + bx);
                }
                stats.pushed = (stats.pushed || 0) + m;
                shifted = true;
              }
            }
            if (!shifted) {
              // Jammed against the line's own works INSIDE a core's approach, the lump has
              // ARRIVED: the socket, the approach well's wall, the casing before the port
              // are the core's works, and its energy takes the lump there. (PS's end-to-end
              // catch, twice over: nothing ever stood on the exact port column - the
              // approach well stood a cell or two short, and the grind ate every lump
              // unburned.) Elsewhere a jam is ground down a cell a step, the way the
              // mouth-choking debris goes (N38): a lane never walls itself shut.
              const nearCore = line.cores.some((c) => Math.abs(nx - c.x) <= SPAN + RAMP);
              if (nearCore && PW.boreBurn && PW.boreBurn(world, nx, ty)) {
                stats.burned = (stats.burned || 0) + 1;
              } else {
                PW.set(world, nx, ty, M.AIR, { quiet: true, lay: true });
                stats.ground = (stats.ground || 0) + 1;
              }
              return false;   // (the stream waits this step; the way is open next)
            }
          }
        }
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
      runHeals();   // (N3: released beds' spans close before the watch looks)
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
        // (a carved lane (PW.PIPE_CAVITY) is real open space: the cargo pixel shows in it)
        if (id === M.PIPE || ((id === M.REINFORCED || id === M.LINING) && (PW.getFlags(world, x, y) & FLAG.FIXTURE))
          || (PW.mat.open[id] && (PW.pipeShows(world, x, y)
            || (PW.PIPE_CAVITY && (PW.getFlags(world, x, y) & FLAG.HOLLOW))))) put(x, y, c);
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

    const api = { build, step, draw, attach, attachWell, carry, connectCore, releaseBuilding, releaseSeedCore, notifyDamage, heal, openEnds, unite, lines, stats, flowing, lineFor, lineNear, contour, relayAlong, BORE, BED, LANES, TAPS };
    return api;
  }

  PW.createPipes = createPipes;
  PW.PIPE_LANES = LANES;
})();
