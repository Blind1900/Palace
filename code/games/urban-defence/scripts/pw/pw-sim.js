'use strict';
// Cell automaton for water and powders (sand, loose soil and stone, building debris), run only on
// active chunks inside their changed rectangles. Water is moved by swaps only, so it is conserved.
// Debris that comes to rest on the ground compacts into rubble after about 10 seconds; debris on
// roofs and other structures stays loose.
(function () {
  const PW = window.PW;
  const { M, PHASE, ID_MASK, CHUNK, CHUNK_SHIFT, CHUNK_MASK, CHUNK_CELLS } = PW;
  const { phase, skyline, structural } = PW.mat;

  const WATER_FALL = 6;          // cells per tick a free-falling water cell can drop
  const POWDER_FALL = 4;
  const DROP_SEARCH = 32;        // how far water looks sideways for somewhere lower
  const DROP_STEP = 12;          // how far it moves towards it in one tick
  const SPREAD = 4;              // cells a pushed water front advances along a floor per tick
  const MOMENTUM = 6;            // cells sliding water travels per tick
  const DISPERSE = 8;            // cells pressurised water squirts sideways per tick
  const COMPACT_TICKS = 600;     // 10 s at 60 Hz
  // Chance a resting powder slides off a slope each tick (debris rarely: irregular heaps).
  const SLIDE = new Float32Array(64);
  SLIDE[M.SAND] = 1; SLIDE[M.LOOSE_SOIL] = 0.6; SLIDE[M.LOOSE_STONE] = 0.45; SLIDE[M.DEBRIS] = 0.3;
  const COMPACTS_TO = new Int16Array(64).fill(-1);
  COMPACTS_TO[M.DEBRIS] = M.RUBBLE; COMPACTS_TO[M.LOOSE_SOIL] = M.SOIL; COMPACTS_TO[M.LOOSE_STONE] = M.GRAVEL;

  function createSim(world) {
    const { mat, width: W, height: H, chunksX } = world;
    const stamps = new Array(world.chunkCount).fill(null);
    const pool = [];
    const compactQueue = [];          // { c, due, version }
    const hadPowder = new Uint8Array(world.chunkCount);
    let stamp = 1, cursor = 0;
    const stats = { ms: 0, chunks: 0, moves: 0, active: 0, compacted: 0, pending: 0, kinds: {} };

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
    const isAir = (m) => (m & ID_MASK) === M.AIR;
    const isWater = (m) => (m & ID_MASK) === M.WATER;

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
      if (go === 0) { mat[i] = M.WATER; return false; }   // blocked: momentum spent
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
          if (x + d < 1 || x + d >= W - 1 || !isAir(mat[i + d])) continue;
          if (ceiling && !isWater(mat[i - d])) continue;
          let go = 1;
          while (go < DISPERSE && x + d * (go + 1) > 0 && x + d * (go + 1) < W - 1 && isAir(mat[i + d * (go + 1)])) go += 1;
          mat[i] = M.WATER | MOVING | (d > 0 ? RIGHT : 0);
          move(i, x, y, i + d * go, x + d * go, y, 'squirt');
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
          move(i, x, y, i + d * go, x + d * go, y, 'push');
          return true;
        }
      }
      return false;
    }

    function stepPowder(i, x, y, id) {
      if (y + 1 >= H) return false;
      const below = mat[i + W];
      if (isAir(below)) {
        let j = i + W, ny = y + 1;
        while (ny + 1 < H && ny - y < POWDER_FALL && isAir(mat[j + W])) { j += W; ny += 1; }
        move(i, x, y, j, x, ny);
        return true;
      }
      if (isWater(below)) { move(i, x, y, i + W, x, y + 1); return true; }   // sinks; the water rises
      if (rnd(x, y) >= SLIDE[id]) return false;
      const dir = ((x * 7 + y + world.tick) & 1) ? 1 : -1;
      for (let k = 0; k < 2; k += 1) {
        const d = k ? -dir : dir, nx = x + d;
        if (nx < 0 || nx >= W) continue;
        const side = mat[i + d], diag = mat[i + W + d];
        if ((isAir(side) || isWater(side)) && (isAir(diag) || isWater(diag))) { move(i, x, y, i + W + d, nx, y + 1); return true; }
      }
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
          if (p !== PHASE.LIQUID && p !== PHASE.POWDER) continue;
          if (own && own[ly << CHUNK_SHIFT | lx] === stamp) continue;
          if (p === PHASE.LIQUID) { if (stepWater(i, x, y)) moved += 1; }
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
          if (!skyline[base] || structural[base]) continue;
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
      const list = world.activeList;
      // Bottom chunk rows first so falling cells are not processed twice.
      list.sort((a, b) => b - a);
      const count = list.length;
      let processed = 0;
      const keep = [];
      for (let n = 0; n < count; n += 1) {
        const c = list[(n + cursor) % count];
        if (performance.now() - started > budgetMs && processed > 0) { keep.push(c); continue; }
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
        if (hadPowder[c]) { compactQueue.push({ c, due: world.tick + COMPACT_TICKS, version: world.chunkVersion[c] }); hadPowder[c] = 0; }
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
          compact(entry.c);
        }
      }
      stats.ms = performance.now() - started;
      stats.chunks = processed;
      stats.active = world.activeList.length;
      stats.pending = compactQueue.length;
      return stats;
    }
    function countWater() {
      let n = 0;
      for (let i = 0; i < mat.length; i += 1) if ((mat[i] & ID_MASK) === M.WATER) n += 1;
      return n;
    }
    return { step, stats, countWater, compact };
  }

  PW.createSim = createSim;
})();
