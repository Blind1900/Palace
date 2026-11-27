'use strict';
// Cell automaton for water, powders (sand, loose soil and stone, building debris, ash) and gases,
// run only on active chunks inside their changed rectangles. How each moves comes from the element
// table (PW.mat): its weight (heavier sinks through lighter), how readily it slides and spreads,
// what it settles into, how a gas rises and thins. Water is moved by swaps only - or, with a long
// way to fall, handed to the particles as a drop in flight that goes back into the water where it
// lands - so it is conserved. A grain with a long way to fall is handed to the particles, which fly it with
// gravity, drag and the wind and put it back into the grid where it lands. Debris that comes to
// rest on the ground compacts into rubble after about 10 seconds; debris on roofs stays loose.
(function () {
  const PW = window.PW;
  const { M, PHASE, ID_MASK, CHUNK, CHUNK_SHIFT, CHUNK_MASK, CHUNK_CELLS } = PW;
  const { phase, skyline, structural, weight } = PW.mat;

  const WATER_FALL = 6;          // cells per tick a free-falling water cell can drop
  const POWDER_FALL = 4;
  const FLY_DROP = 24;           // a grain with at least this much open air under it flies
  const DROP_SEARCH = 32;        // how far water looks sideways for somewhere lower
  const DROP_STEP = 12;          // how far it moves towards it in one tick
  const SPREAD = 4;              // cells a pushed water front advances along a floor per tick
  const MOMENTUM = 6;            // cells sliding water travels per tick
  const DISPERSE = 8;            // cells pressurised water squirts sideways per tick
  const PUSH_REACH = 48;         // how far a surge carries through standing water
  const COMPACT_TICKS = 600;     // 10 s at 60 Hz
  const WOOD_CHIPS = PW.M.DEBRIS | PW.DEBRIS_KIND.WOOD << 6;   // (wood debris, whole byte)
  const { slide: SLIDE, reposeRise: REPOSE_RISE, reposeRun: REPOSE_RUN, settlesTo: COMPACTS_TO, buoyancy: RISE, fade: FADE } = PW.mat;

  function createSim(world) {
    const { mat, width: W, height: H, chunksX } = world;
    const stamps = new Array(world.chunkCount).fill(null);
    const pool = [];
    const compactQueue = [];          // { c, due, since }
    const hadPowder = new Uint8Array(world.chunkCount);
    const sleptAt = new Int32Array(world.chunkCount);   // tick a chunk with loose stuff last settled
    let stamp = 1, cursor = 0;
    const stats = { ms: 0, chunks: 0, moves: 0, active: 0, compacted: 0, pending: 0, flown: 0, kinds: {} };

    function stampsOf(c) {
      let s = stamps[c];
      if (!s) s = stamps[c] = pool.pop() || new Uint8Array(CHUNK_CELLS);
      return s;
    }
    function release(c) {
      if (stamps[c]) { pool.push(stamps[c]); stamps[c] = null; }
    }
    const rnd = (x, y) => (PW.hash3(x, y, world.tick) & 1023) / 1023;

    // Move the cell at flat index i (x, y) to j (nx, ny), stamp it, and wake both neighbourhoods.
    function move(i, x, y, j, nx, ny, kind) {
      if (kind) stats.kinds[kind] = (stats.kinds[kind] || 0) + 1;
      const water = (mat[i] & ID_MASK) === M.WATER;
      PW.swapCells(world, i, j);
      const c = (ny >> CHUNK_SHIFT) * chunksX + (nx >> CHUNK_SHIFT);
      stampsOf(c)[(ny & CHUNK_MASK) << CHUNK_SHIFT | nx & CHUNK_MASK] = stamp;
      // A hole left by water matters to everything within the sideways search reach (and across
      // chunk edges), so a dropping surface levels out quickly instead of in chunk-wide steps.
      if (water) PW.wakeArea(world, x - 16, y - 2, x + 16, y + 2);
      else PW.wake(world, x, y);
      PW.wake(world, nx, ny);
      stats.moves += 1;
    }
    // Gases are open space to water and powders: they fall through smoke as through air.
    const OPEN = PW.mat.open;
    const isAir = (m) => OPEN[m & ID_MASK] === 1;
    const isWater = (m) => (m & ID_MASK) === M.WATER;
    const isEmpty = (m) => (m & ID_MASK) === M.AIR;
    // A supply line's bore (N17: PW.boreAt) is shut to water and the powders as solid ground is,
    // though it is open air - of what moves, only smoke and fire pass it (see passesAt); a cell
    // already in it (water spilled at a cut, rubble of its own casing) may leave it, never move on
    // along it. (The bore's bits: world.boreBits, read afresh each tick.)
    let bore = null;
    const shut = (j) => bore !== null && (bore[j >> 3] >> (j & 7) & 1) === 1;
    const airAt = (j) => OPEN[mat[j] & ID_MASK] === 1 && !shut(j);
    // Grates water runs through: stairs and the openings over their flights (M.PLATFORM), and the
    // drain hatches in a roof over its stairwell - its concrete flagged FLAG.HATCH, a grate while it
    // stands (debris lying in a hatch blown open stops it up). (Cell j at (x, y).)
    const HATCH = PW.FLAG.HATCH || 0;
    function grate(j, x, y) {
      const id = mat[j] & ID_MASK;
      if (id === M.PLATFORM) return true;
      if (!HATCH || !structural[id]) return false;
      const f = world.flags[(y >> CHUNK_SHIFT) * chunksX + (x >> CHUNK_SHIFT)];
      return !!f && (f[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] & HATCH) !== 0;
    }
    // (the open cell under the grate starting at cell j, (x, y), that water runs through it to - a
    // slab's opening can lie on a step of the flight under it; -1 if what is under it is not open)
    const GRATE_DEPTH = 16;
    function underGrate(j, x, y) {
      for (let n = 0; n < GRATE_DEPTH && y + n < H - 1; n += 1, j += W) {
        if (grate(j, x, y + n)) continue;
        return n && airAt(j) ? j : -1;
      }
      return -1;
    }
    // (a fluid - air, a gas or a liquid - lighter than a grain weighing `w`: what it can fall, sink
    // or slide into. A grain's weight is its whole byte's: a wood splinter floats - see
    // PW.mat.byteWeight)
    const BYTE_WEIGHT = PW.mat.byteWeight;
    const lighter = (m, w) => phase[m & ID_MASK] <= PHASE.LIQUID && weight[m & ID_MASK] < w;
    const lighterAt = (j, w) => lighter(mat[j], w) && !shut(j);
    const isLiquid = (m) => phase[m & ID_MASK] === PHASE.LIQUID;

    // The water column standing on a cell that just fell `d` rows follows it in the same tick:
    // its top min(h, d) cells move into the gap (a few swaps instead of shifting every cell), so a
    // drain empties a basin at the fall rate instead of one row per tick.
    function shiftColumn(x, y, d) {
      let top = y;
      while (top - 1 >= 0 && y - top < 1024 && isWater(mat[(top - 1) * W + x])) top -= 1;
      const n = Math.min(y - top, d);
      for (let k = 0; k < n; k += 1) {
        const from = top + k, to = y + d - n + k;
        PW.swapCells(world, from * W + x, to * W + x);
        const c = (to >> CHUNK_SHIFT) * chunksX + (x >> CHUNK_SHIFT);
        stampsOf(c)[(to & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] = stamp;
        PW.wake(world, x, from);
        PW.wake(world, x, to);
      }
      stats.moves += n;
    }

    // Cells a pressurised opening discharges per tick: v = sqrt(2 g h) with g = 9.8 m/s^2
    // (140 cells/s^2) and h the water standing above (measured up to 400 cells).
    // The head is followed through flooded passages: where the water column ends at a ceiling,
    // the scan runs along the water layer under the ceiling to the nearest opening upward (a
    // shaft, a breach) and carries on up it, so a whole flooded section feels the lake above it.
    const OUTFLOW_MAX = 6, HEAD_SCAN = 400, SURFACE_REACH = 64, CEILING_REACH = 320, CEILING_HOPS = 3;
    let lastHead = 0, lastTopX = 0, lastTopY = 0;
    function opening(cx, row) {
      // Walk both ways along `row` (all water) for a column whose cell above is water too.
      for (let k = 1; k <= CEILING_REACH; k += 1) {
        let open = false;
        for (let s = -1; s <= 1; s += 2) {
          const nx = cx + s * k;
          if (nx < 1 || nx >= W - 1) continue;
          if (!isWater(mat[row * W + nx])) continue;
          open = true;
          if (isWater(mat[(row - 1) * W + nx])) return nx;
        }
        if (!open) return -1;   // the water layer under the ceiling ended both ways
      }
      return -1;
    }
    function outflow(x, y) {
      headAt(x, y);
      return Math.max(1, Math.min(OUTFLOW_MAX, Math.round(Math.sqrt(280 * lastHead) / 60)));
    }
    // (the head of water over (x, y): followed up through the water over it, and on along the
    // ceiling of a flooded passage to its way up - see opening; where its top is, in lastTopX/Y)
    function headAt(x, y) {
      let h = 0, cx = x, cy = y - 1, hops = 0;
      while (h < HEAD_SCAN && cy >= 1) {
        const m = mat[cy * W + cx];
        if (isWater(m)) { h += 1; cy -= 1; continue; }
        if (airAt(cy * W + cx) || hops >= CEILING_HOPS) break;
        const nx = opening(cx, cy + 1);
        if (nx < 0) break;
        cx = nx; hops += 1;
      }
      lastHead = h; lastTopX = cx; lastTopY = cy + 1;
      return h;
    }
    // Water is incompressible: water leaving at the bottom lowers the surface where it stands
    // highest. From the top of the column at (x, top), follow the connected surface sideways and
    // return the highest surface cell within reach (flat index).
    function highestSurface(x, top) {
      let best = top * W + x, bestY = top;
      for (let s = -1; s <= 1; s += 2) {
        let cy = top;
        for (let k = 1; k <= SURFACE_REACH; k += 1) {
          const cx = x + s * k;
          if (cx < 1 || cx >= W - 1) break;
          let j = cy * W + cx;
          if (isWater(mat[j])) {
            while (cy > 0 && isWater(mat[j - W])) { cy -= 1; j -= W; }
          } else if (airAt(j)) {
            let n = 0;
            while (n < 8 && cy < H - 1 && airAt(j)) { cy += 1; j += W; n += 1; }
            if (!isWater(mat[j])) break;
          } else break;   // the shore or a wall
          if (cy < bestY) { bestY = cy; best = j; }
        }
      }
      return best;
    }
    // Refill an opening at (x, y) that just discharged a cell, from the surface above it. The
    // air the outflow displaces from below rises back through the water as bubbles.
    function refill(i, x, y) {
      if (!airAt(i)) return;
      if (lastHead >= HEAD_SCAN) shiftColumn(x, y, 1);
      else {
        const src = highestSurface(lastTopX, lastTopY);
        const sy = (src / W) | 0;
        if (sy >= y || !isWater(mat[src])) shiftColumn(x, y, 1);
        else {
          move(src, src % W, sy, i, x, y, 'level');
          // The lowered surface must keep levelling outward, also into sleeping chunks: wake the
          // surface around the source and the faces of any steps below it.
          PW.wakeArea(world, src % W - SURFACE_REACH, sy - 3, src % W + SURFACE_REACH, sy + SURFACE_REACH);
        }
      }
      if (isWater(mat[i]) && (PW.hash3(x, y, world.tick) & 3) === 0) bubble(x, y - 1);
    }
    // Bubbles are handed to the particle system (a budget per tick keeps a torrent affordable).
    let bubbleBudget = 0;
    function bubble(x, y) {
      if (!world.emitBubble || bubbleBudget <= 0 || !isWater(mat[y * W + x])) return;
      bubbleBudget -= 1;
      world.emitBubble(x, y);
    }

    // ---- Water against what is in its way ----------------------------------------------------------
    // Moving water pushes on what it meets, as a flood does. What stands in the open where it runs -
    // a building's fittings, street furniture, plants - is knocked out of its way: a plant is struck
    // (its wood snaps if the push is enough for it, its leaves and the grass are stripped and float
    // off), a fitting or a prop is knocked loose and carried off (a prop then topples whole, see
    // PW.streetProps). A structure it presses or drives against - a building's walls, floors,
    // glass, timber - gives way where the water's push is more than the wall there can hold: the
    // cell breaks and is thrown on with the water, its building is told, and the water runs on into
    // the gap. The ground does not wash away, nor do the pipes (terrain: N38F) or the god's metal.
    // The push is the water's pressure, as a head of water: the depth of water standing over it
    // (followed on up through a flooded room's ceiling to where the water stands open - see headAt),
    // and, running at it, its speed's v^2 / 2g more; less the water on the wall's far side. A wall
    // holds a head of WALL_HOLD x its stuff's hardness x its thickness squared (a panel between
    // floors bending under the pressure): a brick wall 20 cm thick about a metre and a quarter of
    // water, glass hardly any - so a deep flood breaks in, a puddle does not. (And the building as a whole
    // takes the push of all the water against it: see pw-structure's swept.)
    const RUN_SPEED = 60;            // cells/s: a sliding front, a surge
    const WATER_G = 140;             // cells/s^2: the water's gravity (see outflow)
    const SURGE_HEAD = RUN_SPEED * RUN_SPEED / (2 * WATER_G);
    const GIVES = 0.15;              // chance a tick that a push enough for it breaks a structure cell (more, the more it is over)
    const WALL_HOLD = 5;             // head (cells) a wall a cell thick holds, per unit of its stuff's hardness
    const WALL_MAX = 6;              // cells of a wall's thickness that count
    const WATER_LOOK = 30;           // ticks between telling a building water presses on it...
    const WATER_NOTICE = 12;         // ...this deep at least (no building is swept by less)
    const WATER_FRESH = 600;         // ticks without water against a building before water is new to it again
    const WOOD_PUSH = 120;           // cells/s: a flow slower than this does not strike a plant's wood
    const { hardness: HARDNESS, breaksTo: BREAKS_TO, terrain: TERRAIN } = PW.mat;
    const FLORA = PW.FLAG.FLORA, WOOD_FLAG = PW.FLAG.WOOD, CHARRED = PW.FLAG.CHARRED;
    const breakable = (id) => structural[id] && !TERRAIN[id] && id !== M.PIPE && id !== M.CORE && phase[id] === PHASE.SOLID;
    // (the world's: the head of water at a water cell, itself counted - for pw-structure's swept)
    world.waterHead = (x, y) => headAt(x, y) + 1;
    // A bridge's legs and braces (FLAG.BRIDGE) stand in the water as piers do: the world is a slice,
    // and the water is all round a pier in depth - it holds back no head, and a lake sloshing about
    // it, or standing deeper on one side a moment, does not press it over. Only a front running at it
    // pushes on it, by its drag: PIER_DRAG of the surge's head.
    const PIER = PW.FLAG.BRIDGE || 0;
    const PIER_DRAG = 0.5;
    // (water at (x - d, y) pushing on the structure cell j at (x, y), with a head of `head` cells -
    // front: a front running at it, not water standing or stirring beside it)
    function pushOn(j, x, y, d, head, front = false) {
      const id = mat[j] & ID_MASK;
      if (!breakable(id)) return false;
      const pier = PIER && (PW.getFlags(world, x, y) & PIER) !== 0;
      if (pier) {
        if (!front) return false;
        head *= PIER_DRAG;
      }
      const owner = PW.getOwner(world, x, y);
      // (its building looks at what all the water against it does to it - see pw-structure's swept)
      if (head >= WATER_NOTICE && owner > 0 && owner < 50000 && world.structure) {
        const b = (world.buildings || [])[owner - 1];
        const since = (world.tick || 0) - (b ? b.waterAt ?? -1e9 : 0);
        // (at once when the water first comes against it - see pw-structure's notify)
        if (b && since >= WATER_LOOK) { b.waterAt = world.tick || 0; world.structure.notify(owner, since > WATER_FRESH); }
      }
      // (the wall: as thick as the run of structure from here on, and the water on its far side)
      let t = 1;
      while (t < WALL_MAX && x + d * t > 0 && x + d * t < W - 1 && breakable(mat[j + d * t] & ID_MASK)) t += 1;
      const far = j + d * t, back = !pier && isWater(mat[far]) ? headAt(x + d * t, y) + 1 : 0;
      const over = (head - back) / (WALL_HOLD * HARDNESS[id] * t * t * (0.8 + (PW.hash2(x, y) & 255) / 640));
      if (over < 1 || rnd(x, y) >= GIVES * Math.min(4, over) || PW.growing(world, x, y)) return false;
      const v = Math.sqrt(2 * WATER_G * Math.max(1, head)), paint = PW.getLayer(world, 'paint', x, y);
      PW.set(world, x, y, M.AIR);
      const particles = world.particles;
      if (particles) particles.spawn(x + 0.5, y + 0.5, d * v * 0.5, -10 - (PW.hash3(x, y, world.tick) & 15), BREAKS_TO[id] || M.DEBRIS, paint, PW.PARTICLE.LAND, 6, owner);
      if (owner > 0 && owner < 50000) {
        if (particles && particles.listeners.chip) particles.listeners.chip(owner, x, y);
        else if (world.onDamage) world.onDamage(owner, 1, x, y);
        if (PW.noteHit) PW.noteHit(owner, v);
      }
      stats.waterBroke = (stats.waterBroke || 0) + 1;
      return true;
    }
    // (the cells along a run of water's move - (x + d .. x + d * go, y) - swept of what stands in them)
    function sweep(x, y, d, go, v) {
      const cy = y >> CHUNK_SHIFT;
      for (let s = 1; s <= go; s += 1) {
        const nx = x + d * s, decos = world.deco[cy * chunksX + (nx >> CHUNK_SHIFT)];
        if (!decos) continue;
        const l = (y & CHUNK_MASK) << CHUNK_SHIFT | nx & CHUNK_MASK, color = decos[l];
        if (color) knock(nx, y, d, v, color);
      }
    }
    function knock(x, y, d, v, color) {
      const particles = world.particles, F = PW.PARTICLE, f = PW.getFlags(world, x, y);
      if (f & FLORA) {
        // (wood: struck by a strong flow - it snaps where the push is enough for it, else it stands -
        // and stood up to by a weak one; leaves and grass stripped off, floating away)
        if (f & (WOOD_FLAG | CHARRED)) { if (v >= WOOD_PUSH && PW.flora && PW.flora.strike) PW.flora.strike(world, particles, x, y, v / 200, d, 0); return; }
        PW.setLayer(world, 'deco', x, y, 0);
        PW.setFlag(world, x, y, FLORA, false);
        if (particles && (PW.hash2(x, y) & 1)) particles.spawn(x + 0.5, y + 0.5, d * v * 0.3, -4, 0, color, F.LEAF, 2);
        return;
      }
      // (a fitting or a prop: knocked loose, carried off - timber floats; what is left of a prop is
      // looked at, and topples whole if it no longer stands)
      const owner = PW.getOwner(world, x, y);
      PW.setLayer(world, 'deco', x, y, 0);
      if (particles && (PW.hash2(x, y) % 3) === 0) particles.spawn(x + 0.5, y + 0.5, d * v * 0.4, -6, M.DEBRIS | (owner ? PW.DEBRIS_KIND.WOOD : PW.DEBRIS_KIND.METAL) << 6, color, F.LAND, 6);
      if (PW.streetProps) PW.streetProps.struck(world, x, y);
      if (owner > 0 && owner < 50000 && world.onDamage) world.onDamage(owner, 0, x, y);
      stats.waterSwept = (stats.waterSwept || 0) + 1;
    }

    // Water momentum lives in the cell's two variant bits: bit 7 = sliding, bit 6 = direction (+x).
    // Falling water lands sliding; it keeps going until something blocks it, then stops for good.
    const MOVING = 0x80, RIGHT = 0x40;
    function slide(i, x, y) {
      const m = mat[i];
      const d = (m & RIGHT) ? 1 : -1;
      let go = 0;
      while (go < MOMENTUM) {
        const nx = x + d * (go + 1);
        if (nx < 1 || nx >= W - 1) break;
        const ahead = i + d * (go + 1);
        if (!airAt(ahead)) break;
        go += 1;
        if (airAt(ahead + W)) break;            // ran off an edge: fall from here next tick
      }
      if (go === 0) {
        // (running into a structure: it pushes on it - see pushOn - and runs into the gap next)
        if (x + d > 0 && x + d < W - 1 && !isWater(mat[i + d]) && pushOn(i + d, x + d, y, d, SURGE_HEAD, true)) return true;
        // Running into standing water, the push carries through it (like a surge): the cell
        // passes to the far end of the water along its row, if that end is open and within
        // reach, and the front advances there. A wall or a long run spends the momentum.
        let k = 1;
        while (k <= PUSH_REACH && isWater(mat[i + d * k])) k += 1;
        const end = i + d * k, ex = x + d * k;
        if (k > 1 && k <= PUSH_REACH && ex > 0 && ex < W - 1 && airAt(end) && !airAt(end + W)) {
          sweep(ex - d, y, d, 1, RUN_SPEED);
          move(i, x, y, end, ex, y, 'surge');
          return true;
        }
        mat[i] = M.WATER;   // blocked: momentum spent
        return false;
      }
      sweep(x, y, d, go, RUN_SPEED);
      move(i, x, y, i + d * go, x + d * go, y, 'slide');
      return true;
    }

    function stepWater(i, x, y) {
      if (y + 1 >= H) return false;
      // Free fall through air, several cells per tick; the cell lands with sideways momentum.
      if (airAt(i + W)) {
        // (a long way down: it goes as a drop in flight - see flyWater)
        if (world.particles && openBelow(i, y) >= FLY_WATER) {
          const m = mat[i];
          flyWater(i, x, y, m & MOVING ? ((m & RIGHT) ? 1 : -1) * RUN_SPEED : airAt(i + 1) && !airAt(i - 1) ? LIP_SPEED : airAt(i - 1) && !airAt(i + 1) ? -LIP_SPEED : 0);
          return true;
        }
        let j = i + W, ny = y + 1;
        while (ny + 1 < H && ny - y < WATER_FALL && airAt(j + W)) { j += W; ny += 1; }
        const m = mat[i];
        if (!(m & MOVING)) mat[i] = M.WATER | MOVING | (((x + y + world.tick) & 1) ? RIGHT : 0);
        move(i, x, y, j, x, ny, 'fall');
        shiftColumn(x, y, ny - y);
        // A falling jet plunging into a pool drags air down with it.
        if (ny - y >= 3 && ny + 3 < H && isWater(mat[j + W]) && (PW.hash3(x, ny, world.tick) % 3) === 0) {
          bubble(x, ny + 2 + (PW.hash2(x, world.tick) & 3));
        }
        return true;
      }
      // Stairs, the openings over their flights and a roof's hatch over them are grated (a floor
      // to feet, grains and smoke - see grate): water runs through them to the open space under
      // the grate, and so on down a stairwell, storey by storey - dripping straight down out of
      // it, whatever way it was running (the grating breaks its run). (The water standing on it
      // follows it down a row.)
      if (grate(i + W, x, y + 1)) {
        const j = underGrate(i + W, x, y + 1);
        if (j >= 0) {
          const jy = (j / W) | 0;
          // (over a long way down - a stairwell - it pours through as drops, as fast as the water
          // standing on the grate drives it, as out of a hole: see flyWater)
          if (world.particles && openBelow(j, jy) >= FLY_WATER) {
            const keep = [lastHead, lastTopX, lastTopY];
            const v = Math.sqrt(2 * WATER_G * (headAt(x, y) + 1)), n = Math.max(1, Math.min(OUTFLOW_MAX, Math.round(v / 60)));
            [lastHead, lastTopX, lastTopY] = keep;
            for (let b = 0; b < n && isWater(mat[i]); b += 1) {
              PW.set(world, x, y, M.AIR, { quiet: true });
              world.particles.spawn(x + 0.5, jy + 0.5 + b * v / 60 / n, 0, v, M.WATER, 0, PW.PARTICLE.WATER, 8);
              shiftColumn(x, y, 1);
              stats.waterFlown = (stats.waterFlown || 0) + 1;
            }
            PW.wakeArea(world, x - 2, y - 2, x + 2, jy + 2);
            return true;
          }
          mat[i] = M.WATER;
          move(i, x, y, j, x, jy, 'grate');
          shiftColumn(x, y, 1);
          return true;
        }
      }
      const dir = ((x + y + world.tick) & 1) ? 1 : -1;
      // Pressurised water (more water above it) squirts sideways into open space and keeps
      // sliding: this is what empties a column or a breach quickly. Surface water has nothing
      // above it, so calm surfaces never move.
      // Under a ceiling the pressure comes from the water behind: a full section pushes its front.
      const above = y >= 1 ? mat[i - W] : M.BEDROCK;
      const pressed = isWater(above), ceiling = !pressed && !(y >= 1 && airAt(i - W));
      if (pressed || ceiling) {
        for (let k = 0; k < 2; k += 1) {
          const d = k ? -dir : dir;
          if (x + d < 1 || x + d >= W - 1) continue;
          if (!airAt(i + d)) {
            // (a structure beside it: the water standing over it - or, in a flooded room, the water
            // it is joined to - presses on it, and more, running at it - see pushOn)
            if (breakable(mat[i + d] & ID_MASK) && rnd(x + d, y) < GIVES * 4 && pushOn(i + d, x + d, y, d, headAt(x, y) + 1 + ((mat[i] & MOVING) ? SURGE_HEAD : 0))) return true;
            continue;
          }
          if (ceiling && !isWater(mat[i - d])) continue;
          // Outflow under pressure (Torricelli, v = sqrt(2 g h)): with h cells of water standing
          // above the opening, up to v / 60 cells leave it per tick, each replaced at once from
          // the highest point of the surface above. Shallow water trickles out; a deep lake gushes.
          const bursts = outflow(x, y);
          for (let b = 0; b < bursts; b += 1) {
            if (!isWater(mat[i]) || !airAt(i + d)) break;
            let go = 1;
            while (go < DISPERSE && x + d * (go + 1) > 0 && x + d * (go + 1) < W - 1 && airAt(i + d * (go + 1))) go += 1;
            mat[i] = M.WATER | MOVING | (d > 0 ? RIGHT : 0);
            const jet = Math.sqrt(2 * WATER_G * Math.max(1, lastHead));
            sweep(x, y, d, go, jet);
            move(i, x, y, i + d * go, x + d * go, y, 'squirt');
            // (out over a drop, it shoots on as a jet - see flyWater)
            const j = i + d * go;
            if (world.particles && airAt(j + W) && openBelow(j, y) >= FLY_WATER) flyWater(j, x + d * go, y, d * Math.min(JET_MAX, jet));
            if (lastHead > 0) refill(i, x, y);
          }
          return true;
        }
      }
      if (mat[i] & MOVING) return slide(i, x, y);
      // Diagonal down, only through an open side (no leaking through diagonal wall gaps).
      for (let k = 0; k < 2; k += 1) {
        const d = k ? -dir : dir, nx = x + d;
        if (nx < 0 || nx >= W) continue;
        if (airAt(i + d) && airAt(i + W + d)) { move(i, x, y, i + W + d, nx, y + 1, 'diag'); return true; }
      }
      // Sideways towards the nearest drop within reach (a grate it runs through is one; and it runs
      // on through a grate in its way - the foot of a flight of stairs - never stopping in it).
      for (let k = 0; k < 2; k += 1) {
        const d = k ? -dir : dir;
        for (let s = 1; s <= DROP_SEARCH; s += 1) {
          const nx = x + d * s;
          if (nx < 0 || nx >= W) break;
          if (!airAt(i + d * s)) { if (grate(i + d * s, nx, y)) continue; break; }
          if (airAt(i + d * s + W) || (grate(i + d * s + W, nx, y + 1) && underGrate(i + d * s + W, nx, y + 1) >= 0)) {
            let go = Math.min(s, DROP_STEP);
            while (go < s && !airAt(i + d * go)) go += 1;
            sweep(x, y, d, go, RUN_SPEED);
            move(i, x, y, i + d * go, x + d * go, y, 'drop');
            return true;
          }
        }
      }
      // Pressure-driven spreading: water with air ahead and a taller column behind it (water above
      // the cell behind) runs along a floor or a lower surface. A lone cell on a flat layer has
      // nothing behind it, so calm water stays still and its chunk can sleep.
      if (y >= 1) {
        for (let k = 0; k < 2; k += 1) {
          const d = k ? -dir : dir, nx = x + d;
          if (nx < 1 || nx >= W - 1 || !airAt(i + d)) continue;
          // Push only away from a higher column behind, never towards a higher column ahead,
          // so a front can only advance and never oscillates.
          if (!isWater(mat[i - d - W]) || isWater(mat[i + d - W]) || isWater(mat[i + 2 * d - W])) continue;
          let go = 1;
          while (go < SPREAD && x + d * (go + 1) > 0 && x + d * (go + 1) < W - 1
            && airAt(i + d * (go + 1)) && !airAt(i + d * go + W)) go += 1;
          sweep(x, y, d, go, RUN_SPEED);
          move(i, x, y, i + d * go, x + d * go, y, 'push');
          return true;
        }
      }
      return level(i, x, y, dir);
    }

    // ---- Falling and levelling --------------------------------------------------------------------
    // Water with a long way to fall goes as a drop in flight (see pw-particles): it keeps the speed it
    // left with - a jet out of a breach at sqrt(2 g h), a sliding sheet at its run, a trickle over a
    // lip at a little - and gravity takes it from there, so a fall comes off its lip as an arc,
    // whole at the top and thinning as it speeds up, and goes back into the water where it lands.
    // (Drops in flight are counted as the world's water: see particles.airWater.)
    const FLY_WATER = 12;          // open cells under it, at least, for a fall to fly
    const LIP_SPEED = 20;          // cells/s water trickling over a lip leaves it at
    const JET_MAX = 260;           // cells/s
    const openBelow = (i, y) => { let n = 0; for (let j = i + W; n < FLY_WATER && y + n + 1 < H - 1 && airAt(j); j += W) n += 1; return n; };
    const FLY_COLUMN = 24;         // a column of water this tall at most, with nothing under it, falls whole
    function flyWater(i, x, y, vx) {
      const F = PW.PARTICLE;
      // (the water standing on it: a short column open above - a sheet gone over a lip, a lump
      // thrown up - has nothing holding it, and all of it falls together)
      let top = y;
      while (top > 0 && y - top < FLY_COLUMN && isWater(mat[(top - 1) * W + x])) top -= 1;
      if (y - top < FLY_COLUMN && top > 0 && airAt((top - 1) * W + x)) {
        for (let cy = top; cy <= y; cy += 1) {
          PW.set(world, x, cy, M.AIR, { quiet: true });
          world.particles.spawn(x + 0.5, cy + 0.5, vx, 0, M.WATER, 0, F.WATER, 8);
        }
        stats.waterFlown = (stats.waterFlown || 0) + y - top + 1;
        PW.wakeArea(world, x - 2, top - 2, x + 2, y + 2);
        return;
      }
      // A lake pours out through a hole under it as fast as its depth drives it (sqrt(2 g h), as
      // out of a breach in its side - see outflow), the lake following it down: the drops leave
      // from the open air under the hole, at that speed.
      const keep = [lastHead, lastTopX, lastTopY];
      const v = Math.sqrt(2 * WATER_G * (headAt(x, y) + 1)), n = Math.max(1, Math.min(OUTFLOW_MAX, Math.round(v / 60)));
      [lastHead, lastTopX, lastTopY] = keep;
      for (let b = 0; b < n && isWater(mat[i]); b += 1) {
        PW.set(world, x, y, M.AIR, { quiet: true });
        world.particles.spawn(x + 0.5, y + 1.5 + b * v / 60 / n, vx, v, M.WATER, 0, F.WATER, 8);
        shiftColumn(x, y, 1);
        stats.waterFlown = (stats.waterFlown || 0) + 1;
      }
      PW.wakeArea(world, x - 2, y - 2, x + 2, y + 2);
    }
    // Water finds its level. A cell at the surface looks along the surface either way, through the
    // water it stands in, LEVEL_REACH columns at most - stopping at a wall, or where the water
    // stands higher than here - for where the surface stands lowest, or where it runs out over an
    // edge; at least two cells lower than here, it goes there (one cell: the surface is level). So a
    // basin fills level from wherever the water comes into it, and water left on a ledge runs off.
    // (In the body of the water, the pressure that levels it moves it all a little; here the top
    // cell goes the whole way - the same water, the same level.)
    const LEVEL_REACH = 128, LEVEL_DROP = 8, LEVEL_BUDGET = 120000;   // columns looked along a tick, at most
    let levelBudget = 0;
    function level(i, x, y, dir) {
      if (y < 1 || !airAt(i - W)) return false;
      if (levelBudget <= 0) { PW.wakeCell(world, x, y); return false; }
      let best = y + 1, bx = -1, edge = false;
      for (let k = 0; k < 2 && !edge; k += 1) {
        const s = k ? -dir : dir;
        // (cy: the row it goes along - the top of the water, or the open cell on a dry floor;
        // surf: how low the surface stands there, a dry floor as if it were water's)
        let cy = y, surf = y;
        for (let n = 1; n <= LEVEL_REACH; n += 1) {
          const cx = x + s * n;
          if (cx < 1 || cx >= W - 1) break;
          levelBudget -= 1;
          let j = cy * W + cx;
          if (isWater(mat[j])) {
            while (cy > 0 && isWater(mat[j - W])) { cy -= 1; j -= W; }
            if (cy < y) break;                       // (standing higher than here)
            surf = cy;
          } else if (airAt(j)) {
            let d = 0;
            while (d < LEVEL_DROP && cy < H - 2 && airAt(j + W)) { cy += 1; j += W; d += 1; }
            if (d >= LEVEL_DROP) {
              // (an edge it pours over: out beside the bottom of the water at the lip)
              let ly = cy - d, lj = ly * W + cx - s;
              while (ly < H - 2 && isWater(mat[lj + W])) { ly += 1; lj += W; }
              if (airAt(ly * W + cx)) { bx = cx; best = ly; edge = true; }
              break;
            }
            if (isWater(mat[j + W])) { cy += 1; surf = cy; } else surf = cy + 1;   // (a lower surface, or a dry floor)
          } else break;                              // (a wall)
          if (surf > best) { best = surf; bx = cx; }
        }
      }
      if (bx < 0) return false;
      // (where it goes: the open cell on the low surface - or, at an edge, out at its own height)
      const ty = edge ? best : best - 1, j = ty * W + bx;
      if (!edge && ty < y + 1) return false;
      if (!airAt(j)) return false;
      move(i, x, y, j, bx, ty, 'level');
      return true;
    }

    // (a blast's wind at (x, y) strong enough to push a grain of `id` off where it lies: the
    // heavier, the stronger it has to be - a gust of 60 cells/s moves building rubble)
    const GUST_PUSH = 60 / 80;
    function gusted(x, y, id) {
      if (!world.air || !world.air.busy()) return false;
      const a = world.air.at(x, y);
      if (Math.hypot(a[0], a[1]) < GUST_PUSH * weight[id]) return false;
      PW.stir(world, x, y, x, y);
      return true;
    }
    // A grain floating on the water (lighter than it: ash, wood) drifts on the surface: the wind
    // over the water carries it along - at about a quarter of the wind's speed, as flotsam goes -
    // until it fetches up against the shore or the flotsam ahead of it. (Becalmed, it lies still.)
    const WATER_WEIGHT = weight[M.WATER];
    const DRIFT = 0.25 / 60;          // chance a tick, per cell/s of wind, that it drifts a cell
    function drift(i, x, y) {
      const wind = windAt(x, y);
      if (!wind) return false;
      const d = wind > 0 ? 1 : -1;
      if (x + d < 0 || x + d >= W || !airAt(i + d) || !isLiquid(mat[i + W + d])) return false;
      if (rnd(x, y) >= Math.abs(wind) * DRIFT) { PW.wakeCell(world, x, y); return false; }
      move(i, x, y, i + d, x + d, y, 'drift');
      return true;
    }
    // Loose stuff lying inside a building standing whole and finished is carried out of it (the
    // user's, 2026-11-24 - see pw-structure's clearing, which works out each such building's way out
    // and keeps world.clearing: the building -> its way): a grain at rest is taken a cell on that way
    // now and then (CARRY_RATE of its steps), as one carrying it walks - along the floor, down a flight
    // over its treads (a tread's edge stepped off, onto the next), up a step or a tread, down through a
    // floor's opening or a hatch as water goes - and at the way out, out beside it, where it falls. Its way shut by others ahead of it, it waits; the clearing wakes
    // what is left now and then, and lets be a building none of whose stuff goes out.
    const CARRY_RATE = 0.5;
    const CARRY_GRATE = 16, CARRY_CLIMB = 5, CARRY_FALL = 64;   // (pw-structure's CLEAR_GRATE, CLEAR_CLIMB, CLEAR_FALL)
    const CARRY_AWAY = 6, CARRY_OUT = 48;   // cells out from a way out it is set down, at least and at most
    const CARRY_STEP = 8;         // cells up a step it is carried out over, at most (a man climbs a step so high)
    const CARRY_SLOPE = 4;        // the heap set out rises a cell over the sill for every 4 cells further off, at most
    const SPOTS = new Int32Array(CARRY_OUT + 1);   // (the places on the way out it might be set down, by cells off)
    let carryOn = false;
    // (room for what is carried: open air, or standing water - waded through, the water taking its
    // place - never the water shut in a supply line's bore)
    const roomAt = (j) => (OPEN[mat[j] & ID_MASK] === 1 || phase[mat[j] & ID_MASK] === PHASE.LIQUID) && !shut(j);
    function carried(i, x, y) {
      const o = PW.getOwner(world, x, y);
      if (!(o > 0 && o < 50000)) return false;
      const c = world.clearing.get(o);
      if (!c || c.phase !== 'carry' || x < c.x0 || y < c.y0 || x >= c.x0 + c.w || y >= c.y0 + c.h) return false;
      // (cell j's place in the way, -1 off it)
      const kOf = (j) => { const jx = j % W, jy = (j / W) | 0; return jx < c.x0 || jy < c.y0 || jx >= c.x0 + c.w || jy >= c.y0 + c.h ? -1 : (jy - c.y0) * c.w + jx - c.x0; };
      const d = c.dist[kOf(i)];
      // (0x3fffffff: buried in a heap at the look - see below)
      if (!(d >= 0)) return false;
      if ((PW.hash3(x, y, world.tick + 5) & 1023) / 1023 >= CARRY_RATE) { PW.wakeCell(world, x, y); return false; }
      const to = (j) => { move(i, x, y, j, j % W, (j / W) | 0, 'carried'); return true; };
      if (d === 0) {
        // (at the way out: dropped into the open under it, or carried out beside it - over steps and
        // what was set out before, up to CARRY_STEP cells at a time - and thrown down off the first
        // edge CARRY_AWAY cells off or more, or, none, set down CARRY_OUT cells off; over the sill no
        // higher than a cell in CARRY_SLOPE past CARRY_AWAY - flatter than a heap stands, so what is
        // set out never slides back in. Never into a building - its own, or the one over the way, to
        // carry it back. Where it is set down, stirred, to slide. No room out there, the way out is shut.)
        if (roomAt(i + W) && PW.getOwner(world, x, y + 1) !== o) { stats.carriedOut = (stats.carriedOut || 0) + 1; return to(i + W); }
        // (the sill: the way out's floor under it - what lies in the way out on others is set out by it)
        let sill = y;
        while (sill < H - 2 && PW.getOwner(world, x, sill + 1) === o && (roomAt(i + (sill + 1 - y) * W) || phase[mat[i + (sill + 1 - y) * W] & ID_MASK] === PHASE.POWDER)) sill += 1;
        for (const s of [-1, 1]) {
          let r = y, at = -1, end = CARRY_OUT;
          for (let t = 1; t <= CARRY_OUT; t += 1) {
            const cx = x + s * t;
            if (cx < 1 || cx >= W - 1) { end = t - 1; break; }
            for (let h = 0; h < CARRY_STEP && r > 1 && !roomAt(r * W + cx); h += 1) r -= 1;
            // (come to a building - this one, the one over the way - the heap kept CARRY_AWAY off it too)
            const ow = PW.getOwner(world, cx, r), ob = ow > 0 && ow < 50000 && world.buildings ? world.buildings[ow - 1] : null;
            if (ob && ob.body && cx >= ob.body.left - 1 && cx <= ob.body.right + 1) { end = t - 1 - CARRY_AWAY; break; }
            if (!roomAt(r * W + cx)) { end = t - 1; break; }
            SPOTS[t] = -1;
            if (t < CARRY_AWAY) continue;
            // (an edge - thrown down off it, it lands below, away from the way out - or the slope kept;
            // in the open, never into water there: it would take its place in the way out)
            const spot = r * W + cx, edge = roomAt(spot + W);
            if ((edge || (sill - r) * CARRY_SLOPE <= t - CARRY_AWAY) && airAt(spot)) SPOTS[t] = spot;
            if (edge) { end = t; break; }
          }
          for (let t = end; t >= CARRY_AWAY && at < 0; t -= 1) at = SPOTS[t];
          if (at < 0) continue;
          stats.carriedOut = (stats.carriedOut || 0) + 1;
          const ax = at % W, ay = (at / W) | 0;
          PW.stir(world, ax - 2, ay - 2, ax + 2, ay + 2);
          return to(at);
        }
        // (no room out there: it waits - the clearing wakes it again with its next look)
        return false;
      }
      // (on by the way, to the place it can go to nearest the way out - nearer than it is: what lay
      // buried in a heap at the look, its way not yet known, follows into the place left by what went
      // on ahead of it)
      // (the look's grates - see pw-structure's GRATE: 1 a hatch, 2 a stairwell's opening, 3 a tread, 4 a
      // pier - by cell)
      const grateOf = (j) => { const k = kOf(j); return k >= 0 ? c.grates[k] : 0; };
      let best = -1, bd = d;
      // (water it is carried into, the cell beside it, takes its place; never across a grate or up a
      // step - water lifted through a roof's hatch, or a flight's steps, by what goes down them)
      const consider = (j, far) => { const k = kOf(j); if (k >= 0 && c.dist[k] < bd && (far ? airAt(j) : roomAt(j))) { bd = c.dist[k]; best = j; } };
      // (down: falling, or through a hatch under it - or a stairwell's opening, onto the flight under
      // it: never down the well beside the flights)
      let j = i + W, opening = false;
      for (let g = 0; g < CARRY_GRATE && (grateOf(j) === 1 || grateOf(j) === 2); g += 1) { opening = opening || grateOf(j) === 2; j += W; }
      if (opening) {
        let m = j;
        for (let t = 0; t < CARRY_FALL && (roomAt(m) || phase[mat[m] & ID_MASK] === PHASE.POWDER) && grateOf(m) === 0; t += 1) m += W;
        if (grateOf(m) === 3) consider(j, true);
      } else consider(j, j !== i + W);
      // (lying on something: along - over a floor's opening too, past a flight's foot or a pier from
      // the floor, or off a tread's edge, onto the next - or up a face onto it: a step, a tread)
      if (!roomAt(i + W)) {
        const s0 = ((x + y + world.tick) & 1) ? 1 : -1, onTread = grateOf(i + W) === 3;
        for (let s = s0, q = 0; q < 2; q += 1, s = -s) {
          j = i + s;
          let past = false;
          for (let g = 0; g < CARRY_GRATE && grateOf(j) !== 0; g += 1) { past = past || grateOf(j) >= 3; j += s; }
          if (!(past && onTread)) consider(j, j !== i + s);
          for (let h = 1; h <= CARRY_CLIMB; h += 1) {
            const f = i + s - (h - 1) * W;
            if (roomAt(f) || !roomAt(i - h * W)) break;
            consider(f - W, h > 1);
          }
        }
      }
      if (best >= 0) return to(best);
      // (its way on taken: it waits - woken as what is ahead of it moves on, or by the clearing's next look)
      return false;
    }
    function stepPowder(i, x, y, id) {
      if (y + 1 >= H) return false;
      const below = mat[i + W];
      if (airAt(i + W)) {
        let j = i + W, ny = y + 1;
        while (ny + 1 < H && ny - y < FLY_DROP && airAt(j + W)) { j += W; ny += 1; }
        // A long way down: it flies, picking up speed, and lands back in the grid.
        if (ny - y >= FLY_DROP && fly(i, x, y)) return true;
        if (ny - y > POWDER_FALL) { ny = y + POWDER_FALL; j = i + POWDER_FALL * W; }
        move(i, x, y, j, x, ny);
        PW.stir(world, x, ny, x, ny);   // (coming down, it stirs the heap it lands on)
        return true;
      }
      // Heavier than the liquid under it: it sinks, and the liquid rises past it. Lighter than the
      // liquid over it (ash, wood in water): it floats up.
      const w = BYTE_WEIGHT[mat[i]];
      // (not down into water standing in a supply line's bore, nor up into it: see shut)
      if (isLiquid(below) && !shut(i + W)) {
        if (weight[below & ID_MASK] < w) { move(i, x, y, i + W, x, y + 1, 'sink'); return true; }
        return drift(i, x, y);   // (floating)
      }
      if (y >= 1 && isLiquid(mat[i - W]) && !shut(i - W) && weight[mat[i - W] & ID_MASK] > w && rnd(x, y) < 0.5) {
        move(i, x, y, i - W, x, y - 1, 'float');
        return true;
      }
      // (it slides off only now and then - the looser it is, the more often - but a grain that has
      // somewhere to slide stays awake until it does: a heap stirred never freezes steeper than it
      // stands)
      const slides = rnd(x, y) < SLIDE[id];
      if (!SLIDE[id]) return false;
      // (a floating raft does not stand in a heap: what lies on the floating grains spreads out over
      // the water beside them)
      if (w < WATER_WEIGHT && slides) {
        const d = ((x * 7 + y + world.tick) & 1) ? 1 : -1;
        for (const s of [d, -d]) {
          if (x + s < 0 || x + s >= W) continue;
          if (airAt(i + s) && isLiquid(mat[i + W + s]) && weight[mat[i + W + s] & ID_MASK] > w) { move(i, x, y, i + s, x + s, y); return true; }
        }
      }
      // At rest it holds, even standing straight up, until it is stirred (see PW.stir): shaken,
      // landed on, moved about - or in water, or caught by a gust strong enough for its weight.
      // (inside a building being cleared, carried out: see carried)
      if (carryOn && carried(i, x, y)) return true;
      if (!PW.stirred(world, x, y) && !isLiquid(mat[i - W]) && !gusted(x, y, id)) return false;
      const dir = ((x * 7 + y + world.tick) & 1) ? 1 : -1;
      for (let k = 0; k < 2; k += 1) {
        const d = k ? -dir : dir, nx = x + d;
        if (nx < 0 || nx >= W) continue;
        if (lighterAt(i + d, w) && lighterAt(i + W + d, w)) {
          if (slides) {
            // (over the edge of a slope steeper than it can lie on - nothing under where it slides
            // to - it runs on down with its own momentum: see run)
            if (y + 2 < H && airAt(i + 2 * W + d) && run(i, x, y, d, id)) return true;
            move(i, x, y, i + W + d, nx, y + 1);
            PW.stir(world, nx, y + 1, nx, y + 1);
            return true;
          }
          PW.wakeCell(world, x, y);
          return false;
        }
      }
      // A heap of most stuff stands flatter than 45 degrees (its angle of repose: `rise` cells down
      // over `run` cells out - see PW.mat): a slope falling away more steeply than that farther
      // out runs it off too, a cell along it at a time.
      const rise = REPOSE_RISE[id], reach = REPOSE_RUN[id];
      if (reach > 1 && y + rise < H) {
        for (let k = 0; k < 2; k += 1) {
          const d = k ? -dir : dir, nx = x + reach * d;
          if (nx < 0 || nx >= W) continue;
          let open = true;
          for (let s = 1; s <= reach && open; s += 1) open = lighterAt(i + s * d, w);
          for (let s = 1; s <= rise && open; s += 1) open = lighterAt(i + s * W + reach * d, w);
          if (open) {
            if (slides) { move(i, x, y, i + d, x + d, y); PW.stir(world, x + d, y, x + d, y); return true; }
            PW.wakeCell(world, x, y);
            return false;
          }
        }
      }
      return false;
    }
    // A grain going over the edge of a slope steeper than it can lie on runs on down it with its own
    // momentum: handed to the particles, it picks up speed as it drops and runs down the slope below
    // (the steeper and longer the run, the faster), spends it where the slope eases, and comes to
    // rest there, back in the grid. So a landslide gathers speed as it goes, pours over drops and
    // runs out across the flat below - moving as all falling rubble does. Rock and building rubble
    // coming down fast break what they strike (the particles' DAMAGE).
    const RUN_START = 36;            // cells/s a grain goes over the edge at
    function run(i, x, y, d, id) {
      const particles = world.particles;
      if (!particles || particles.count > particles.capacity - 512) return false;
      const byte = mat[i], paint = PW.getLayer(world, 'paint', x, y);
      PW.set(world, x, y, M.AIR, { quiet: true });
      PW.wake(world, x, y - 1);
      const h = PW.hash3(x, y, world.tick), v = RUN_START * (0.8 + (h & 255) / 255 * 0.4);
      const F = PW.PARTICLE;
      particles.spawn(x + d + 0.5, y + 0.5, d * v, v * 0.6, byte, paint, F.LAND | F.LOOSE | (weight[id] >= 80 ? F.DAMAGE : 0), 12);
      stats.ran = (stats.ran || 0) + 1;
      // (where ground is running off, the slide is still going: the stability system keeps looking
      // there - the face it was banked against may stand free now, and fail in its turn)
      const running = world.running || (world.running = new Map());
      if (running.size > 4000) running.clear();
      running.set((y >> 6) * 4096 + (x >> 6), world.tick);
      return true;
    }
    // Hand a grain to the particles: it falls from rest, so it picks up speed under gravity, the
    // wind takes it as much as the table says, and it lands back in the grid wherever it comes
    // down (rolling off a heap). Building rubble keeps its colours.
    function fly(i, x, y) {
      const particles = world.particles;
      if (!particles || particles.count > particles.capacity - 256) return false;
      const byte = mat[i], paint = PW.getLayer(world, 'paint', x, y);
      PW.set(world, x, y, M.AIR, { quiet: true });
      PW.wake(world, x, y - 1);
      // (no two grains leave quite alike, so a falling mass loosens and spreads as it goes)
      const h = PW.hash3(x, y, world.tick);
      particles.spawn(x + 0.5, y + 0.5, ((h & 255) / 255 - 0.5) * 16, POWDER_FALL * 60 * (0.85 + (h >>> 8 & 255) / 255 * 0.3), byte, paint, PW.PARTICLE.LAND | PW.PARTICLE.LOOSE, 12);
      stats.flown += 1;
      return true;
    }

    // ---- Gases --------------------------------------------------------------------------------------
    // Smoke and steam rise (steam faster: it is hotter), dust sinks slowly (their `buoyancy`); all
    // drift with the wind above ground and spread under ceilings below it. A rising gas passes up
    // through water and through a heavier gas, a sinking one down through a lighter gas. Density
    // lives in the variant bits. Smoke and dust thin out over time (their `fade`); steam condenses
    // back into water once it has cooled.
    const CONDENSE_BELOW = 70;       // °C
    // (can the gas `id`, rising or sinking, move into the cell m?)
    const passes = (m, id, up) => isEmpty(m) || (phase[m & ID_MASK] <= PHASE.LIQUID && phase[m & ID_MASK] >= PHASE.GAS
      && (up ? weight[m & ID_MASK] > weight[id] : weight[m & ID_MASK] < weight[id]));
    // (into cell j - and of the gases only smoke goes into a supply line's bore: steam would
    // condense in it, dust is grit - see shut)
    const passesAt = (j, id, up) => passes(mat[j], id, up) && (id === M.SMOKE || !shut(j));
    const emptyAt = (j, id) => isEmpty(mat[j]) && (id === M.SMOKE || !shut(j));
    // (can the gas `id` at i - not on the world's edge - go nowhere this tick, by any of stepGas's
    // ways: on the way it rises or sinks, straight or slipping either side; sideways into empty
    // air; a thick cell pouring down; carried up or down by a blast's wind?)
    function stuck(i, id, density) {
      if (ventsOn && (ventOut(i) >= 0 || draft(i % W, (i / W) | 0))) return false;
      const up = RISE[id] > 0, v = up ? -W : W;
      if (passesAt(i + v, id, up) || passesAt(i + v - 1, id, up) || passesAt(i + v + 1, id, up)) return false;
      if (emptyAt(i - 1, id) || emptyAt(i + 1, id)) return false;
      if (density === 3 && emptyAt(i + W, id)) return false;
      if (airBusy && (passesAt(i - W, id, true) || passesAt(i + W, id, false))) return false;
      return true;
    }
    world.wind = world.wind || 0;
    const windNoise = PW.createNoise1D((world.windSeed || 1) * 31 + 7, 1);
    const gustNoise = PW.createNoise1D((world.windSeed || 1) * 17 + 3, 1);
    // Wind (cells/s, + to the right) at a cell: none underground, stronger with height above ground.
    function windAt(x, y) {
      const top = world.groundTop[x];
      if (y >= top) return 0;
      return world.wind * Math.min(2.2, 1 + (top - y) / 300);
    }
    // A gas moving into air or another gas: nothing about the ground line, the light or the water
    // changes, so the swap is done here, directly (as swapCells would: the cells, their heat, the
    // chunks drawn again).
    const ADVECTION = PW.mat.advection;
    function moveGas(i, x, y, j, nx, ny) {
      const b = mat[j];
      if (phase[b & ID_MASK] > PHASE.GAS) { move(i, x, y, j, nx, ny, 'gas'); return; }
      stats.kinds.gas = (stats.kinds.gas || 0) + 1;
      mat[j] = mat[i]; mat[i] = b;
      PW.markDirty(world, x, y, PW.DIRTY_BASE, true); PW.markDirty(world, nx, ny, PW.DIRTY_BASE, true);
      const ci = (y >> CHUNK_SHIFT) * chunksX + (x >> CHUNK_SHIFT), cj = (ny >> CHUNK_SHIFT) * chunksX + (nx >> CHUNK_SHIFT);
      if (world.heat[ci] || world.heat[cj]) {
        const ta = PW.heatAt(world, x, y), tb = PW.heatAt(world, nx, ny);
        if (ta !== tb) { PW.setHeat(world, x, y, tb); PW.setHeat(world, nx, ny, ta); }
      }
      stampsOf(cj)[(ny & CHUNK_MASK) << CHUNK_SHIFT | nx & CHUNK_MASK] = stamp;
      PW.wake(world, x, y);
      PW.wake(world, nx, ny);
      stats.moves += 1;
    }
    // N98, the user's: a building being repaired vents the dust and gas of the work out through its
    // top, as a ventilation system does. Its vents (WGM's: roof cells flagged FLAG.VENT, world.vents
    // the roof cell -> its building) are outlets: a gas rising under one goes up through the roof - its
    // duct, VENT_THROUGH rows at most - into the open over it; and while the building is being worked
    // on (PW.isGrowing) its fans draw the gas inside it - dust too, which would settle - up and over to
    // the nearest vent (DRAFT: the share of its steps it is drawn).
    const VENT_THROUGH = 10, DRAFT = 0.7;
    let ventsOn = false, ventN = -1;
    const ventCols = new Set();   // (the columns with a vent in them - world.vents' keys - kept as they change)
    // (the open cell over the roof just over i, a vent in it, that a gas leaving by it comes out
    // into, or -1: the vent - WGM's flag on the roof's top cell - and the roof's cells under it are
    // its duct, however thick the roof)
    function ventOut(i) {
      const VENT = PW.FLAG.VENT;
      if (!VENT || i < 2 * W || !ventCols.has(i % W) || isEmpty(mat[i - W])) return -1;
      const x = i % W, y = (i / W) | 0;
      let through = false;
      for (let k = 1; k <= VENT_THROUGH && y - k > 0; k += 1) {
        const j = i - k * W;
        if (isEmpty(mat[j])) return through ? j : -1;
        if (PW.getFlags(world, x, y - k) & VENT) through = true;
      }
      return -1;
    }
    // (inside a building being repaired that has vents: the way to its nearest vent - [side, up] - or
    // null)
    function draft(x, y) {
      const o = PW.getOwner(world, x, y), b = o > 0 && o < 50000 && world.buildings ? world.buildings[o - 1] : null;
      const list = b && b.vents && b.vents.list;
      if (!list || !list.length || !PW.isGrowing || !PW.isGrowing(world, b)) return null;
      let best = list[0];
      for (const v of list) if (Math.abs(v.x - x) < Math.abs(best.x - x)) best = v;
      return [Math.sign(best.x - x), best.y < y ? 1 : 0];
    }
    // (the eddies' and the parcels' pace are the same over a patch of cells for a while: kept for
    // the run of cells along a row that share them)
    let eddyKey = -1, eddyVal = 0, paceKey = -1, paceVal = 0;
    let airBusy = false;
    function stepGas(i, x, y, id) {
      const m = mat[i];
      let density = m >> 6;
      // (three draws from one hash: ten bits each)
      const h = PW.hash3(x, y, world.tick);
      const r = (h & 1023) / 1023;
      if (id === M.STEAM) {
        if (PW.heatAt(world, x, y) < CONDENSE_BELOW && r < 1 / 90) {
          PW.set(world, x, y, M.WATER, { quiet: true });    // condenses: the water is back
          PW.wake(world, x, y);
          return true;
        }
      } else if (r < FADE[id]) {
        if (density === 0) { PW.set(world, x, y, M.AIR, { quiet: true }); return true; }
        density -= 1;
        mat[i] = id | density << 6;
        PW.markDirty(world, x, y, PW.DIRTY_BASE, true);
      }
      // (N98: out through a vent over it; drawn to one, inside a building under repair)
      if (ventsOn && x > 0 && y > 1 && x < W - 1 && y < H - 1) {
        const out = ventOut(i);
        if (out >= 0) { moveGas(i, x, y, out, x, (out / W) | 0); stats.vented = (stats.vented || 0) + 1; return true; }
        const d = draft(x, y);
        if (d && (PW.hash3(x, y, world.tick + 11) & 1023) / 1023 < DRAFT) {
          if (d[1] && passesAt(i - W, id, true)) { moveGas(i, x, y, i - W, x, y - 1); return true; }
          if (d[0] && emptyAt(i + d[0], id)) { moveGas(i, x, y, i + d[0], x + d[0], y); return true; }
        }
      }
      // (nowhere it can go, by any of the ways below - the inside of a room full of smoke, a layer
      // of dust on a floor: it only thins)
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && stuck(i, id, density)) {
        PW.wakeCell(world, x, y);
        return false;
      }
      // The weather's wind, and where a blast has stirred the air, its wind too: each gas goes
      // with the air as much as the element table's `wind` says.
      let wind = windAt(x, y), lift = 0;
      if (airBusy) {
        const a = world.air.at(x, y), k = ADVECTION[id];
        wind += a[0] * k; lift = -a[1] * k;
      }
      // (a strong updraught or downdraught carries it straight up or down)
      if (Math.abs(lift) > 20 && (PW.hash3(x, y, world.tick + 7) & 1023) / 1023 < Math.min(0.9, Math.abs(lift) / 120)) {
        const j = lift > 0 ? i - W : i + W;
        if (y > 1 && y < H - 2 && passesAt(j, id, lift > 0)) { moveGas(i, x, y, j, x, lift > 0 ? y - 1 : y + 1); return true; }
      }
      const r2 = (h >>> 10 & 1023) / 1023;
      const r3 = (h >>> 20 & 1023) / 1023;
      // Smoke billows: besides the wind it is carried sideways in eddies, patches of air (16 by 8
      // cells, changing every second) that each push one way, so a plume widens and wanders as it
      // rises instead of standing in a straight column; thin smoke, cooler, rises slower.
      let eddy = 0;
      if (id === M.SMOKE) {
        const key = ((y >> 3) * 4096 + (x >> 4)) * 64 + ((world.tick >> 6) & 63);
        if (key !== eddyKey) { eddyKey = key; eddyVal = (PW.hash3(x >> 4, y >> 3, world.tick >> 6) & 1) ? 1 : -1; }
        eddy = eddyVal;
      }
      // (smoke, light and warm, goes with the wind more readily than the other gases)
      const side = r3 < Math.min(0.9, Math.abs(wind) / (id === M.SMOKE ? 34 : 40)) ? Math.sign(wind)
        : eddy && r3 < 0.75 ? eddy : (r3 & 1 ? 1 : -1) * ((x + world.tick) & 1 ? 1 : -1);
      // (and parcels of it rise at their own pace, so a cloud's underside is ragged, not a level
      // floor)
      const pk = ((y >> 3) * 8192 + (x >> 3)) * 64 + ((world.tick >> 5) & 63);
      if (pk !== paceKey) { paceKey = pk; paceVal = 0.65 + 0.7 * ((PW.hash3(x >> 3, y >> 3, world.tick >> 5) & 255) / 255); }
      const pace = paceVal;
      let rise = (id === M.SMOKE ? RISE[id] * (0.4 + 0.2 * density) : RISE[id]) * pace;
      // (red-hot - straight out of a fire or a blast, glowing - it is lighter still: it climbs as
      // the flames do until it has cooled to its own colour)
      if (id === M.SMOKE && world.heat[(y >> CHUNK_SHIFT) * chunksX + (x >> CHUNK_SHIFT)]) {
        const t = PW.heatAt(world, x, y);
        if (t > PW.GLOW_FROM) rise = Math.max(rise, Math.min(0.95, 0.45 + (t - PW.GLOW_FROM) / 1500));
      }
      // Concentrated clumps pour like rain: in a scattering of columns (changing every second) the
      // thickest gas falls through clear air in streaks hanging under the cloud, until it has
      // thinned enough to rise again.
      if (density === 3 && y < H - 2 && r2 < 0.45 && (PW.hash2(x, world.tick >> 6) & 7) === 0 && emptyAt(i + W, id)) {
        moveGas(i, x, y, i + W, x, y + 1);
        return true;
      }
      const vert = rise > 0 ? -W : W;
      // Up (or down for dust), through air, water or a heavier gas (a lighter one, sinking).
      if (r2 < Math.abs(rise) && y > 0 && y < H - 1) {
        if (passesAt(i + vert, id, rise > 0)) { moveGas(i, x, y, i + vert, x, y + (rise > 0 ? -1 : 1)); return true; }
        // Blocked: slip diagonally.
        const diag = i + vert + side;
        if (x + side > 0 && x + side < W - 1 && passesAt(diag, id, rise > 0)) { moveGas(i, x, y, diag, x + side, y + (rise > 0 ? -1 : 1)); return true; }
      }
      // Sideways: drift with the wind, or spread.
      if (x + side > 0 && x + side < W - 1 && emptyAt(i + side, id) && (wind !== 0 || eddy || r2 > 0.6)) {
        // Thick smoke spreads into the cell it leaves behind as it drifts.
        moveGas(i, x, y, i + side, x + side, y);
        if (id !== M.STEAM && density >= 2 && r < 0.25 && emptyAt(i, id)) {
          mat[i + side] = id | (density - 1) << 6;
          PW.set(world, x, y, id | (density - 2) << 6, { quiet: true });
        }
        return true;
      }
      PW.wakeCell(world, x, y);   // keep fading and drifting even when nothing moved
      return false;
    }

    function processChunk(c) {
      const r = world.simRect, o = c * 4;
      const x0 = r[o], y0 = r[o + 1], x1 = r[o + 2], y1 = r[o + 3];
      PW.clearSimRect(world, c);
      if (x1 < x0 || y1 < y0) return { moved: 0, powder: 0 };
      const baseX = (c % chunksX) << CHUNK_SHIFT, baseY = ((c / chunksX) | 0) << CHUNK_SHIFT;
      const own = stamps[c];
      let moved = 0, powder = 0;
      for (let ly = y1; ly >= y0; ly -= 1) {
        const y = baseY + ly, row = y * W;
        const forward = ((ly + world.tick) & 1) === 0;
        for (let k = 0; k <= x1 - x0; k += 1) {
          const lx = forward ? x0 + k : x1 - k;
          const x = baseX + lx, i = row + x;
          const id = mat[i] & ID_MASK;
          const p = phase[id];
          if (p !== PHASE.LIQUID && p !== PHASE.POWDER && p !== PHASE.GAS) continue;
          if (own && own[ly << CHUNK_SHIFT | lx] === stamp) continue;
          if (p === PHASE.LIQUID) { if (stepWater(i, x, y)) moved += 1; }
          else if (p === PHASE.GAS) { if (stepGas(i, x, y, id)) moved += 1; }
          else { powder += 1; if (stepPowder(i, x, y, id)) moved += 1; }
        }
      }
      return { moved, powder };
    }

    // Compact settled powder in a chunk: a powder run that rests on natural ground turns into it.
    function compact(c) {
      const baseX = (c % chunksX) << CHUNK_SHIFT, baseY = ((c / chunksX) | 0) << CHUNK_SHIFT;
      let converted = 0;
      for (let lx = 0; lx < CHUNK; lx += 1) {
        const x = baseX + lx;
        for (let ly = CHUNK - 1; ly >= 0; ly -= 1) {
          const y = baseY + ly, i = y * W + x;
          const id = mat[i] & ID_MASK;
          if (COMPACTS_TO[id] < 0) continue;
          // (wood splinters do not pack into rubble: they lie loose and rot away - see pw-life, N85)
          if (mat[i] === WOOD_CHIPS) continue;
          // Find what the powder column below rests on.
          let j = i + W, depth = 0;
          while (j < W * H && COMPACTS_TO[mat[j] & ID_MASK] >= 0 && depth < 512) { j += W; depth += 1; }
          const base = j < W * H ? mat[j] & ID_MASK : M.BEDROCK;
          // (not floating on water: what floats stays loose)
          if (!skyline[base] || structural[base] || phase[base] === PHASE.LIQUID) continue;
          PW.set(world, x, y, COMPACTS_TO[id] | (mat[i] & 0xc0), { quiet: true, keepPaint: true });
          converted += 1;
        }
      }
      stats.compacted += converted;
      return converted;
    }

    function step(budgetMs = 3) {
      const started = performance.now();
      world.tick += 1;
      stats.moves = 0;
      stats.kinds = {};
      stamp = (stamp % 255) + 1;
      bubbleBudget = 60;
      levelBudget = LEVEL_BUDGET;
      bore = world.boreBits || null;
      // Wind: a slow swing of up to 14 cells/s (1 m/s) either way, with gusts on top.
      const t = world.tick / 60;
      world.wind = 14 * windNoise(t / 45) + 6 * gustNoise(t / 4);
      airBusy = !!(world.air && world.air.busy());
      ventsOn = !!(PW.FLAG.VENT && world.vents && world.vents.size);
      carryOn = !!(world.clearing && world.clearing.size);
      if (ventsOn && world.vents.size !== ventN) { ventN = world.vents.size; ventCols.clear(); for (const k of world.vents.keys()) ventCols.add(k % W); }
      eddyKey = -1; paceKey = -1;
      const list = world.activeList;
      // Bottom chunk rows first so falling cells are not processed twice.
      list.sort((a, b) => b - a);
      const count = list.length;
      let processed = 0;
      const keep = [];
      for (let n = 0; n < count; n += 1) {
        const c = list[(n + cursor) % count];
        if (!PW.DETERMINISTIC && performance.now() - started > budgetMs && processed > 0) { keep.push(c); continue; }
        const { moved, powder } = processChunk(c);
        processed += 1;
        if (powder) hadPowder[c] = 1;
        if (moved) { world.simIdle[c] = 0; keep.push(c); continue; }
        world.simIdle[c] += 1;
        // Stay awake one quiet tick (cells woken by neighbours this tick), then sleep.
        const r = world.simRect, o = c * 4;
        if (world.simIdle[c] < 2 || r[o + 2] >= r[o]) { keep.push(c); continue; }
        world.simActive[c] = 0;
        release(c);
        if (hadPowder[c]) { sleptAt[c] = world.tick; compactQueue.push({ c, due: world.tick + COMPACT_TICKS, since: world.tick }); hadPowder[c] = 0; }
      }
      // Chunks woken during this pass were appended to the live list; carry them over.
      for (let n = count; n < list.length; n += 1) keep.push(list[n]);
      cursor = processed < count ? (cursor + processed) % Math.max(1, keep.length) : 0;
      world.activeList = keep;
      // Settled debris turns into ground after its rest time (skip chunks that moved again).
      if (world.tick % 30 === 0 && compactQueue.length) {
        for (let q = compactQueue.length - 1; q >= 0; q -= 1) {
          const entry = compactQueue[q];
          if (entry.due > world.tick) continue;
          compactQueue.splice(q, 1);
          if (world.simActive[entry.c]) continue;
          // (it has settled again since - fresh debris landed there: that later settling decides,
          // so the fresh debris gets its full rest time before it packs down)
          if (sleptAt[entry.c] !== entry.since) continue;
          compact(entry.c);
        }
      }
      stats.ms = performance.now() - started;
      stats.chunks = processed;
      stats.active = world.activeList.length;
      stats.pending = compactQueue.length;
      return stats;
    }
    // Water cells, counting steam (water that boiled and will condense back).
    function countWater() {
      let n = 0;
      for (let i = 0; i < mat.length; i += 1) { const id = mat[i] & ID_MASK; if (id === M.WATER || id === M.STEAM) n += 1; }
      return n;
    }
    return { step, stats, countWater, compact, windAt };
  }

  PW.createSim = createSim;
})();
