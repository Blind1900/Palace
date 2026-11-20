'use strict';
// Cell automaton for water, powders (sand, loose soil and stone, building debris, ash) and gases,
// run only on active chunks inside their changed rectangles. How each moves comes from the element
// table (PW.mat): its weight (heavier sinks through lighter), how readily it slides and spreads,
// what it settles into, how a gas rises and thins. Water is moved by swaps only, so it is
// conserved. A grain with a long way to fall is handed to the particles, which fly it with
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
  const { slide: SLIDE, spread: SPREADS, settlesTo: COMPACTS_TO, buoyancy: RISE, fade: FADE } = PW.mat;

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
    // (a fluid - air, a gas or a liquid - lighter than a grain weighing `w`: what it can fall, sink
    // or slide into. A grain's weight is its whole byte's: a wood splinter floats - see
    // PW.mat.byteWeight)
    const BYTE_WEIGHT = PW.mat.byteWeight;
    const lighter = (m, w) => phase[m & ID_MASK] <= PHASE.LIQUID && weight[m & ID_MASK] < w;
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
        if (isAir(m) || hops >= CEILING_HOPS) break;
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
          } else if (isAir(mat[j])) {
            let n = 0;
            while (n < 8 && cy < H - 1 && isAir(mat[j])) { cy += 1; j += W; n += 1; }
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
      if (!isAir(mat[i])) return;
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
    // (water at (x - d, y) pushing on the structure cell j at (x, y), with a head of `head` cells)
    function pushOn(j, x, y, d, head) {
      const id = mat[j] & ID_MASK;
      if (!breakable(id)) return false;
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
      const far = j + d * t, back = isWater(mat[far]) ? headAt(x + d * t, y) + 1 : 0;
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
        if (!isAir(mat[ahead])) break;
        go += 1;
        if (isAir(mat[ahead + W])) break;            // ran off an edge: fall from here next tick
      }
      if (go === 0) {
        // (running into a structure: it pushes on it - see pushOn - and runs into the gap next)
        if (x + d > 0 && x + d < W - 1 && !isWater(mat[i + d]) && pushOn(i + d, x + d, y, d, SURGE_HEAD)) return true;
        // Running into standing water, the push carries through it (like a surge): the cell
        // passes to the far end of the water along its row, if that end is open and within
        // reach, and the front advances there. A wall or a long run spends the momentum.
        let k = 1;
        while (k <= PUSH_REACH && isWater(mat[i + d * k])) k += 1;
        const end = i + d * k, ex = x + d * k;
        if (k > 1 && k <= PUSH_REACH && ex > 0 && ex < W - 1 && isAir(mat[end]) && !isAir(mat[end + W])) {
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
      if (isAir(mat[i + W])) {
        let j = i + W, ny = y + 1;
        while (ny + 1 < H && ny - y < WATER_FALL && isAir(mat[j + W])) { j += W; ny += 1; }
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
      const dir = ((x + y + world.tick) & 1) ? 1 : -1;
      // Pressurised water (more water above it) squirts sideways into open space and keeps
      // sliding: this is what empties a column or a breach quickly. Surface water has nothing
      // above it, so calm surfaces never move.
      // Under a ceiling the pressure comes from the water behind: a full section pushes its front.
      const above = y >= 1 ? mat[i - W] : M.BEDROCK;
      const pressed = isWater(above), ceiling = !pressed && !isAir(above);
      if (pressed || ceiling) {
        for (let k = 0; k < 2; k += 1) {
          const d = k ? -dir : dir;
          if (x + d < 1 || x + d >= W - 1) continue;
          if (!isAir(mat[i + d])) {
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
            if (!isWater(mat[i]) || !isAir(mat[i + d])) break;
            let go = 1;
            while (go < DISPERSE && x + d * (go + 1) > 0 && x + d * (go + 1) < W - 1 && isAir(mat[i + d * (go + 1)])) go += 1;
            mat[i] = M.WATER | MOVING | (d > 0 ? RIGHT : 0);
            sweep(x, y, d, go, Math.sqrt(280 * Math.max(1, lastHead)));
            move(i, x, y, i + d * go, x + d * go, y, 'squirt');
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
        if (isAir(mat[i + d]) && isAir(mat[i + W + d])) { move(i, x, y, i + W + d, nx, y + 1, 'diag'); return true; }
      }
      // Sideways towards the nearest drop within reach.
      for (let k = 0; k < 2; k += 1) {
        const d = k ? -dir : dir;
        for (let s = 1; s <= DROP_SEARCH; s += 1) {
          const nx = x + d * s;
          if (nx < 0 || nx >= W || !isAir(mat[i + d * s])) break;
          if (isAir(mat[i + d * s + W])) {
            const go = Math.min(s, DROP_STEP);
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
          if (nx < 1 || nx >= W - 1 || !isAir(mat[i + d])) continue;
          // Push only away from a higher column behind, never towards a higher column ahead,
          // so a front can only advance and never oscillates.
          if (!isWater(mat[i - d - W]) || isWater(mat[i + d - W]) || isWater(mat[i + 2 * d - W])) continue;
          let go = 1;
          while (go < SPREAD && x + d * (go + 1) > 0 && x + d * (go + 1) < W - 1
            && isAir(mat[i + d * (go + 1)]) && !isAir(mat[i + d * go + W])) go += 1;
          sweep(x, y, d, go, RUN_SPEED);
          move(i, x, y, i + d * go, x + d * go, y, 'push');
          return true;
        }
      }
      return false;
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
      if (x + d < 0 || x + d >= W || !isAir(mat[i + d]) || !isLiquid(mat[i + W + d])) return false;
      if (rnd(x, y) >= Math.abs(wind) * DRIFT) { PW.wakeCell(world, x, y); return false; }
      move(i, x, y, i + d, x + d, y, 'drift');
      return true;
    }
    function stepPowder(i, x, y, id) {
      if (y + 1 >= H) return false;
      const below = mat[i + W];
      if (isAir(below)) {
        let j = i + W, ny = y + 1;
        while (ny + 1 < H && ny - y < FLY_DROP && isAir(mat[j + W])) { j += W; ny += 1; }
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
      if (isLiquid(below)) {
        if (weight[below & ID_MASK] < w) { move(i, x, y, i + W, x, y + 1, 'sink'); return true; }
        return drift(i, x, y);   // (floating)
      }
      if (y >= 1 && isLiquid(mat[i - W]) && weight[mat[i - W] & ID_MASK] > w && rnd(x, y) < 0.5) {
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
          if (isAir(mat[i + s]) && isLiquid(mat[i + W + s]) && weight[mat[i + W + s] & ID_MASK] > w) { move(i, x, y, i + s, x + s, y); return true; }
        }
      }
      // At rest it holds, even standing straight up, until it is stirred (see PW.stir): shaken,
      // landed on, moved about - or in water, or caught by a gust strong enough for its weight.
      if (!PW.stirred(world, x, y) && !isLiquid(mat[i - W]) && !gusted(x, y, id)) return false;
      const dir = ((x * 7 + y + world.tick) & 1) ? 1 : -1;
      for (let k = 0; k < 2; k += 1) {
        const d = k ? -dir : dir, nx = x + d;
        if (nx < 0 || nx >= W) continue;
        if (lighter(mat[i + d], w) && lighter(mat[i + W + d], w)) {
          if (slides) {
            // (over the edge of a slope steeper than it can lie on - nothing under where it slides
            // to - it runs on down with its own momentum: see run)
            if (y + 2 < H && isAir(mat[i + 2 * W + d]) && run(i, x, y, d, id)) return true;
            move(i, x, y, i + W + d, nx, y + 1);
            PW.stir(world, nx, y + 1, nx, y + 1);
            return true;
          }
          PW.wakeCell(world, x, y);
          return false;
        }
      }
      // Some (building rubble) spread out flatter: they also slide along a slope that falls away
      // farther out (a heap settles at about 1 in 2, not 45°).
      for (let reach = 1; reach <= SPREADS[id]; reach += 1) {
        for (let k = 0; k < 2; k += 1) {
          const d = k ? -dir : dir, nx = x + (reach + 1) * d;
          if (nx < 0 || nx >= W) continue;
          let open = true;
          for (let s = 1; s <= reach + 1 && open; s += 1) open = lighter(mat[i + s * d], w);
          if (open && lighter(mat[i + W + (reach + 1) * d], w)) {
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
        if (y > 1 && y < H - 2 && passes(mat[j], id, lift > 0)) { moveGas(i, x, y, j, x, lift > 0 ? y - 1 : y + 1); return true; }
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
      if (density === 3 && y < H - 2 && r2 < 0.45 && (PW.hash2(x, world.tick >> 6) & 7) === 0 && isEmpty(mat[i + W])) {
        moveGas(i, x, y, i + W, x, y + 1);
        return true;
      }
      const vert = rise > 0 ? -W : W;
      // Up (or down for dust), through air, water or a heavier gas (a lighter one, sinking).
      if (r2 < Math.abs(rise) && y > 0 && y < H - 1) {
        const above = mat[i + vert];
        if (passes(above, id, rise > 0)) { moveGas(i, x, y, i + vert, x, y + (rise > 0 ? -1 : 1)); return true; }
        // Blocked: slip diagonally.
        const diag = i + vert + side;
        if (x + side > 0 && x + side < W - 1 && passes(mat[diag], id, rise > 0)) { moveGas(i, x, y, diag, x + side, y + (rise > 0 ? -1 : 1)); return true; }
      }
      // Sideways: drift with the wind, or spread.
      if (x + side > 0 && x + side < W - 1 && isEmpty(mat[i + side]) && (wind !== 0 || eddy || r2 > 0.6)) {
        // Thick smoke spreads into the cell it leaves behind as it drifts.
        moveGas(i, x, y, i + side, x + side, y);
        if (id !== M.STEAM && density >= 2 && r < 0.25 && isEmpty(mat[i])) {
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
      // Wind: a slow swing of up to 14 cells/s (1 m/s) either way, with gusts on top.
      const t = world.tick / 60;
      world.wind = 14 * windNoise(t / 45) + 6 * gustNoise(t / 4);
      airBusy = !!(world.air && world.air.busy());
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
