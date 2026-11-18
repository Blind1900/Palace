'use strict';
// Air: a coarse grid of pressure and wind over the world (one air cell for every 8 x 8 world
// cells), after The Powder Toy's air model in our own code. It is only worked where something is
// happening: a blast puts a burst of pressure into the air around it; the pressure pushes the air
// out from it as a wind that spreads, bends round solid ground and buildings, and dies away. What
// the air carries depends on the element table's `wind` (advection): smoke, steam and dust go with
// it, leaves and ash are blown along, flying debris is pushed a little. A strong enough blast wave
// shatters glass, and a hard gust kicks loose sand and dust off the ground.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;

  const S = 8;                 // world cells per air cell (each way)
  const TILE = 16;             // air cells per tile (each way): tiles are what is worked
  const PUSH = 0.6;            // how strongly a pressure difference drives the air
  const SPREAD = 0.5;          // how strongly moving air carries pressure on (with PUSH, a wave
                               // crosses about 0.55 air cells a pass; kept under 0.7 to stay stable)
  const PASSES = 4;            // passes a step: a blast wave runs out at about 1000 cells a second
  const KEEP_P = Math.pow(0.94, 1 / PASSES), KEEP_V = Math.pow(0.92, 1 / PASSES);
                               // what is left of pressure and wind each pass (a blast wave is
                               // spent within a second or so)
  const QUIET = 0.05;          // a tile quieter than this everywhere for a while is let go
  const WAKE = 0.6;            // a wave this strong at a tile's edge wakes the tile beyond it
  const MAX_TILES = 160;       // (the air is never worked over more than this many tiles at once)
  const GLASS_BREAKS = 1.8;    // pressure that shatters glass
  const LIFT = 2.2;            // a gust (wind x the element's `wind`) that lifts loose ground

  function createAir(world, particles) {
    const { mat, width: W, height: H } = world;
    const AW = Math.ceil(W / S), AH = Math.ceil(H / S);
    const TW = Math.ceil(AW / TILE), TH = Math.ceil(AH / TILE);
    const p = new Float32Array(AW * AH), vx = new Float32Array(AW * AH), vy = new Float32Array(AW * AH);
    const wall = new Uint8Array(AW * AH);          // air cell mostly solid: the air does not pass
    const active = new Map();                      // tile -> steps it has been quiet
    const live = new Uint8Array(TW * TH);          // (the same, as a flag per tile: what every gas
                                                   // cell asks of the air each tick - see at)
    const stats = { tiles: 0, ms: 0, shattered: 0, lifted: 0 };
    const advection = PW.mat.advection, phase = PW.mat.phase;
    const clamp = (v) => (v > 40 ? 40 : v < -40 ? -40 : v);
    let loudest = new Float32Array(MAX_TILES);     // per worked tile: its loudest cell this step
    const spread = new Set();                      // tiles a wave has reached the edge of

    // Is an air cell mostly solid ground or structure? (looked at again whenever its tile wakes)
    function measureWall(ax, ay) {
      let solid = 0;
      for (let y = ay * S; y < Math.min(H, ay * S + S); y += 2) for (let x = ax * S; x < Math.min(W, ax * S + S); x += 2) {
        if (phase[mat[y * W + x] & ID_MASK] >= PW.PHASE.POWDER) solid += 1;
      }
      wall[ay * AW + ax] = solid > (S * S / 4) * 0.6 ? 1 : 0;
    }
    // Start working a tile (its walls are looked at again). A tile that is solid all through is not
    // worked - no air moves in it - but its walls are kept, so the air beside it is turned back.
    function wake(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) return;
      const t = ty * TW + tx;
      if (active.has(t)) { active.set(t, 0); return; }
      if (active.size >= MAX_TILES) return;
      let open = 0;
      for (let ay = ty * TILE; ay < Math.min(AH, ty * TILE + TILE); ay += 1) for (let ax = tx * TILE; ax < Math.min(AW, tx * TILE + TILE); ax += 1) {
        measureWall(ax, ay);
        if (!wall[ay * AW + ax]) open += 1;
      }
      if (open) { active.set(t, 0); live[t] = 1; }
    }
    // A blast at (x, y): a burst of pressure, strongest at the centre, into the air within its
    // radius. Only the open air takes it: a blast in a cave or a room drives it all out through
    // the openings, and one buried deep in rock makes no blast wave at all.
    function blast(x, y, radius, power = 1) {
      const ar = Math.max(1.5, radius / S), acx = x / S, acy = y / S;
      for (let ty = Math.floor((acy - ar * 2) / TILE); ty <= Math.floor((acy + ar * 2) / TILE); ty += 1) {
        for (let tx = Math.floor((acx - ar * 2) / TILE); tx <= Math.floor((acx + ar * 2) / TILE); tx += 1) wake(tx, ty);
      }
      let all = 0, open = 0;
      const cells = [];
      for (let ay = Math.floor(acy - ar); ay <= Math.ceil(acy + ar); ay += 1) for (let ax = Math.floor(acx - ar); ax <= Math.ceil(acx + ar); ax += 1) {
        if (ax < 0 || ay < 0 || ax >= AW || ay >= AH) continue;
        const d = Math.hypot(ax + 0.5 - acx, ay + 0.5 - acy) / ar;
        if (d >= 1) continue;
        all += 1 - d * d;
        const i = ay * AW + ax;
        if (wall[i]) continue;
        open += 1 - d * d;
        cells.push(i, 1 - d * d);
      }
      if (!open) return;
      const scale = power * 9 * all / open;
      for (let k = 0; k < cells.length; k += 2) p[cells[k]] = clamp(p[cells[k]] + cells[k + 1] * scale);
    }
    // A gust: the open air within `radius` of (x, y) is set going at (wx, wy) cells a second, most
    // at the middle. Something big moving through the air drives it along: a falling building
    // pushes the air ahead of it, and a floor coming down drives the air out from under it.
    function gust(x, y, radius, wx, wy) {
      const ar = Math.max(1, radius / S), acx = x / S, acy = y / S;
      for (let ty = Math.floor((acy - ar) / TILE); ty <= Math.floor((acy + ar) / TILE); ty += 1) {
        for (let tx = Math.floor((acx - ar) / TILE); tx <= Math.floor((acx + ar) / TILE); tx += 1) wake(tx, ty);
      }
      const ux = wx / (S * 6), uy = wy / (S * 6);
      for (let ay = Math.floor(acy - ar); ay <= Math.ceil(acy + ar); ay += 1) for (let ax = Math.floor(acx - ar); ax <= Math.ceil(acx + ar); ax += 1) {
        if (ax < 0 || ay < 0 || ax >= AW || ay >= AH) continue;
        const d = Math.hypot(ax + 0.5 - acx, ay + 0.5 - acy) / ar;
        const i = ay * AW + ax;
        if (d >= 1 || wall[i] || !live[((ay / TILE) | 0) * TW + ((ax / TILE) | 0)]) continue;
        const k = 1 - d * d;
        // (it does not slow air already going faster that way)
        if (ux && (Math.abs(vx[i]) < Math.abs(ux) * k || Math.sign(vx[i]) !== Math.sign(ux))) vx[i] = clamp(vx[i] + (ux * k - vx[i]) * 0.8);
        if (uy && (Math.abs(vy[i]) < Math.abs(uy) * k || Math.sign(vy[i]) !== Math.sign(uy))) vy[i] = clamp(vy[i] + (uy * k - vy[i]) * 0.8);
      }
    }
    function step() {
      if (!active.size) { stats.tiles = 0; return; }
      const t0 = performance.now();
      const tiles = [...active.keys()];
      if (loudest.length < tiles.length) loudest = new Float32Array(MAX_TILES);
      loudest.fill(0);
      let peakP = 0, peakV = 0;
      for (let pass = 0; pass < PASSES; pass += 1) {
        const last = pass === PASSES - 1;
        // 1. The air moves from high pressure towards low; never into or out of solid ground. (The
        // wind is kept on the faces between air cells: vx[i] across the face to the right of cell
        // i, vy[i] across the face below it.)
        for (const t of tiles) {
          const x0 = (t % TW) * TILE, y0 = ((t / TW) | 0) * TILE, x1 = Math.min(AW, x0 + TILE), y1 = Math.min(AH, y0 + TILE);
          for (let ay = y0; ay < y1; ay += 1) {
            const down = ay < AH - 1;
            for (let ax = x0, i = ay * AW + x0; ax < x1; ax += 1, i += 1) {
              if (wall[i]) { vx[i] = 0; vy[i] = 0; continue; }
              vx[i] = ax < AW - 1 && !wall[i + 1] ? clamp((vx[i] + (p[i] - p[i + 1]) * PUSH) * KEEP_V) : 0;
              vy[i] = down && !wall[i + AW] ? clamp((vy[i] + (p[i] - p[i + AW]) * PUSH) * KEEP_V) : 0;
            }
          }
        }
        // 2. Moving air carries the pressure on: what flows out of a cell lowers it, what flows in
        // raises it.
        for (let k = 0; k < tiles.length; k += 1) {
          const t = tiles[k], x0 = (t % TW) * TILE, y0 = ((t / TW) | 0) * TILE, x1 = Math.min(AW, x0 + TILE), y1 = Math.min(AH, y0 + TILE);
          for (let ay = y0; ay < y1; ay += 1) {
            for (let ax = x0, i = ay * AW + x0; ax < x1; ax += 1, i += 1) {
              if (wall[i]) { p[i] = 0; continue; }
              const out = vx[i] - (ax > 0 ? vx[i - 1] : 0) + vy[i] - (ay > 0 ? vy[i - AW] : 0);
              const q = p[i] = clamp((p[i] - out * SPREAD) * KEEP_P);
              // A blast wave breaks the glass in its path, and in the walls it strikes.
              if (q > GLASS_BREAKS) {
                shatter(ax, ay, i);
                if (ax > 0 && wall[i - 1]) shatter(ax - 1, ay, i);
                if (ax < AW - 1 && wall[i + 1]) shatter(ax + 1, ay, i);
                if (ay > 0 && wall[i - AW]) shatter(ax, ay - 1, i);
                if (ay < AH - 1 && wall[i + AW]) shatter(ax, ay + 1, i);
              }
              if (!last) continue;
              const gust = Math.abs(vx[i]) + Math.abs(vy[i]);
              const loud = Math.max(Math.abs(q), gust * 0.2);
              if (loud > loudest[k]) loudest[k] = loud;
              if (q > peakP) peakP = q;
              if (gust > peakV) peakV = gust;
              // (a strong wave at a tile's edge wakes the tile beyond it)
              if (loud > WAKE && (ax === x0 || ax === x1 - 1 || ay === y0 || ay === y1 - 1)) {
                const nx = Math.floor((ax + (ax === x0 ? -1 : ax === x1 - 1 ? 1 : 0)) / TILE);
                const ny = Math.floor((ay + (ay === y0 ? -1 : ay === y1 - 1 ? 1 : 0)) / TILE);
                if (nx >= 0 && ny >= 0 && nx < TW && ny < TH) spread.add(ny * TW + nx);
              }
            }
          }
        }
      }
      for (let k = 0; k < tiles.length; k += 1) {
        const t = tiles[k];
        if (loudest[k] >= QUIET) { active.set(t, 0); continue; }
        const quiet = active.get(t) + 1;
        if (quiet <= 30) { active.set(t, quiet); continue; }
        active.delete(t); live[t] = 0;
        const tx = t % TW, ty = (t / TW) | 0;
        for (let ay = ty * TILE; ay < Math.min(AH, ty * TILE + TILE); ay += 1) for (let ax = tx * TILE; ax < Math.min(AW, tx * TILE + TILE); ax += 1) { const i = ay * AW + ax; p[i] = 0; vx[i] = 0; vy[i] = 0; }
      }
      for (const t of spread) if (!active.has(t)) wake(t % TW, (t / TW) | 0);
      spread.clear();
      // 3. A hard gust over loose ground lifts it into the air (a few cells a step).
      for (const t of tiles) lift(t);
      stats.tiles = active.size;
      stats.peakP = Math.round(peakP * 100) / 100; stats.peakV = Math.round(peakV * 100) / 100;
      stats.ms = performance.now() - t0;
    }
    // Shatter the glass in air cell (ax, ay); the shards fly with the wind in air cell `from`.
    function shatter(ax, ay, from) {
      const fx = from % AW, wx = (vx[from] + (fx > 0 ? vx[from - 1] : 0)) * S * 1.5, wy = (vy[from] + (from >= AW ? vy[from - AW] : 0)) * S * 1.5;
      const xe = Math.min(W, ax * S + S), ye = Math.min(H, ay * S + S), GLASS = M.GLASS;
      for (let y = ay * S; y < ye; y += 1) for (let x = ax * S, i = y * W + x; x < xe; x += 1, i += 1) {
        if ((mat[i] & ID_MASK) !== GLASS) continue;
        const owner = PW.getOwner(world, x, y);
        PW.set(world, x, y, M.AIR);
        if (particles && (PW.hash2(x, y) & 3) === 0) particles.spawn(x + 0.5, y + 0.5, wx + ((PW.hash3(x, y, 1) & 63) - 32), wy - 20, M.DEBRIS | PW.DEBRIS_KIND.METAL << 6, PW.abgr(170, 210, 230), PW.PARTICLE.LAND | PW.PARTICLE.DAMAGE, 4, owner);
        stats.shattered += 1;
        if (owner && world.onDamage) world.onDamage(owner, 1, x, y);
      }
    }
    function lift(t) {
      if (!particles) return;
      const tx = t % TW, ty = (t / TW) | 0;
      let n = 0;
      for (let ay = ty * TILE; ay < Math.min(AH, ty * TILE + TILE) && n < 12; ay += 1) for (let ax = tx * TILE; ax < Math.min(AW, tx * TILE + TILE) && n < 12; ax += 1) {
        const i = ay * AW + ax, gust = Math.hypot(vx[i], vy[i]);
        if (gust < LIFT || wall[i]) continue;
        // (the loose surface under this air cell)
        const x = ax * S + (PW.hash3(ax, ay, stats.lifted) & 7);
        if (x < 1 || x >= W - 1) continue;
        const y = world.groundTop[x];
        if (y < ay * S || y >= ay * S + S + 4) continue;
        const m = mat[y * W + x], id = m & ID_MASK;
        if (phase[id] !== PW.PHASE.POWDER || gust * advection[id] * 20 < LIFT) continue;
        PW.set(world, x, y, M.AIR);
        particles.spawn(x + 0.5, y - 0.5, vx[i] * S * 3, vy[i] * S * 3 - 30, m, 0, PW.PARTICLE.LAND | PW.PARTICLE.LOOSE, 5);
        stats.lifted += 1;
        n += 1;
      }
    }
    // The wind the air grid adds at world cell (x, y), in cells per second.
    function at(x, y) {
      const ax = (x / S) | 0, ay = (y / S) | 0;
      if (ax < 0 || ay < 0 || ax >= AW || ay >= AH || !live[((ay / TILE) | 0) * TW + ((ax / TILE) | 0)]) return ZERO;
      const i = ay * AW + ax;
      OUT[0] = vx[i] * S * 6; OUT[1] = vy[i] * S * 6; OUT[2] = p[i];
      return OUT;
    }
    const ZERO = [0, 0, 0], OUT = [0, 0, 0];
    // All the wind at world cell (x, y), cells/s: the weather's (none underground, stronger with
    // height over the ground - as the gases feel it) and, where a blast has stirred the air, its
    // wind too.
    function wind(x, y) {
      const top = world.groundTop[Math.max(0, Math.min(W - 1, x | 0))];
      const a = at(x, y);
      WIND[0] = a[0] + (y < top ? (world.wind || 0) * Math.min(2.2, 1 + (top - y) / 300) : 0);
      WIND[1] = a[1];
      return WIND;
    }
    const WIND = [0, 0];
    return { blast, gust, step, at, wind, stats, busy: () => active.size > 0, S };
  }

  PW.createAir = createAir;
})();
