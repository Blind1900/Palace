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
  const PUSH = 0.42;           // how strongly a pressure difference drives the air
  const SPREAD = 0.18;         // how strongly moving air carries pressure on
  const KEEP_P = 0.94, KEEP_V = 0.92;     // what is left of pressure and wind each step (a blast
                                          // wave is spent within a second or so)
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
    const stats = { tiles: 0, ms: 0, shattered: 0, lifted: 0 };
    const advection = PW.mat.advection, phase = PW.mat.phase;
    const clamp = (v) => (v > 40 ? 40 : v < -40 ? -40 : v);

    // Is an air cell mostly solid ground or structure? (looked at again whenever its tile wakes)
    function measureWall(ax, ay) {
      let solid = 0;
      for (let y = ay * S; y < Math.min(H, ay * S + S); y += 2) for (let x = ax * S; x < Math.min(W, ax * S + S); x += 2) {
        if (phase[mat[y * W + x] & ID_MASK] >= PW.PHASE.POWDER) solid += 1;
      }
      wall[ay * AW + ax] = solid > (S * S / 4) * 0.6 ? 1 : 0;
    }
    function wake(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) return;
      const t = ty * TW + tx;
      if (active.has(t)) { active.set(t, 0); return; }
      if (active.size >= MAX_TILES) return;
      active.set(t, 0);
      for (let ay = ty * TILE; ay < Math.min(AH, ty * TILE + TILE); ay += 1) for (let ax = tx * TILE; ax < Math.min(AW, tx * TILE + TILE); ax += 1) measureWall(ax, ay);
    }
    // A blast at (x, y): a burst of pressure over its radius, strongest at the centre.
    function blast(x, y, radius, power = 1) {
      const ar = Math.max(1.5, radius / S), acx = x / S, acy = y / S;
      for (let ty = Math.floor((acy - ar * 4) / TILE); ty <= Math.floor((acy + ar * 4) / TILE); ty += 1) {
        for (let tx = Math.floor((acx - ar * 4) / TILE); tx <= Math.floor((acx + ar * 4) / TILE); tx += 1) wake(tx, ty);
      }
      for (let ay = Math.floor(acy - ar); ay <= Math.ceil(acy + ar); ay += 1) for (let ax = Math.floor(acx - ar); ax <= Math.ceil(acx + ar); ax += 1) {
        if (ax < 0 || ay < 0 || ax >= AW || ay >= AH) continue;
        const d = Math.hypot(ax + 0.5 - acx, ay + 0.5 - acy) / ar;
        if (d >= 1) continue;
        const i = ay * AW + ax;
        wall[i] = 0;    // (the blast has just opened it up)
        p[i] += power * 9 * (1 - d * d);
      }
    }
    function step() {
      if (!active.size) { stats.tiles = 0; return; }
      const t0 = performance.now();
      const tiles = [...active.keys()];
      // 1. The air moves from high pressure towards low; never into or out of solid ground. (The
      // wind is kept on the faces between air cells: vx[i] across the face to the right of cell
      // i, vy[i] across the face below it.)
      for (const t of tiles) {
        const tx = t % TW, ty = (t / TW) | 0;
        for (let ay = ty * TILE; ay < Math.min(AH, ty * TILE + TILE); ay += 1) for (let ax = tx * TILE; ax < Math.min(AW, tx * TILE + TILE); ax += 1) {
          const i = ay * AW + ax;
          vx[i] = ax < AW - 1 && !wall[i] && !wall[i + 1] ? clamp((vx[i] + (p[i] - p[i + 1]) * PUSH) * KEEP_V) : 0;
          vy[i] = ay < AH - 1 && !wall[i] && !wall[i + AW] ? clamp((vy[i] + (p[i] - p[i + AW]) * PUSH) * KEEP_V) : 0;
        }
      }
      // 2. Moving air carries the pressure on: what flows out of a cell lowers it, what flows in
      // raises it.
      let spread = null, peakP = 0, peakV = 0;
      for (const t of tiles) {
        const tx = t % TW, ty = (t / TW) | 0;
        let loudest = 0;
        for (let ay = ty * TILE; ay < Math.min(AH, ty * TILE + TILE); ay += 1) for (let ax = tx * TILE; ax < Math.min(AW, tx * TILE + TILE); ax += 1) {
          const i = ay * AW + ax;
          if (wall[i]) { p[i] = 0; continue; }
          const out = vx[i] - (ax > 0 ? vx[i - 1] : 0) + vy[i] - (ay > 0 ? vy[i - AW] : 0);
          p[i] = clamp((p[i] - out * SPREAD) * KEEP_P);
          const loud = Math.max(Math.abs(p[i]), Math.abs(vx[i]) * 0.2, Math.abs(vy[i]) * 0.2);
          if (p[i] > peakP) peakP = p[i];
          const gust = Math.abs(vx[i]) + Math.abs(vy[i]);
          if (gust > peakV) peakV = gust;
          if (loud > loudest) loudest = loud;
          // (a strong wave at a tile's edge wakes the tile beyond it)
          if (loud > WAKE && (ax % TILE === 0 || ax % TILE === TILE - 1 || ay % TILE === 0 || ay % TILE === TILE - 1)) {
            (spread || (spread = [])).push(Math.floor((ax + (ax % TILE === 0 ? -1 : ax % TILE === TILE - 1 ? 1 : 0)) / TILE), Math.floor((ay + (ay % TILE === 0 ? -1 : ay % TILE === TILE - 1 ? 1 : 0)) / TILE));
          }
          // A blast wave breaks the glass in its path, and in the walls it strikes.
          if (p[i] > GLASS_BREAKS) {
            shatter(ax, ay);
            if (ax > 0 && wall[i - 1]) shatter(ax - 1, ay);
            if (ax < AW - 1 && wall[i + 1]) shatter(ax + 1, ay);
            if (ay > 0 && wall[i - AW]) shatter(ax, ay - 1);
            if (ay < AH - 1 && wall[i + AW]) shatter(ax, ay + 1);
          }
        }
        if (loudest < QUIET) {
          const quiet = active.get(t) + 1;
          if (quiet > 30) {
            active.delete(t);
            for (let ay = ty * TILE; ay < Math.min(AH, ty * TILE + TILE); ay += 1) for (let ax = tx * TILE; ax < Math.min(AW, tx * TILE + TILE); ax += 1) { const i = ay * AW + ax; p[i] = 0; vx[i] = 0; vy[i] = 0; }
          } else active.set(t, quiet);
        } else active.set(t, 0);
      }
      if (spread) for (let k = 0; k < spread.length; k += 2) if (!active.has(spread[k + 1] * TW + spread[k])) wake(spread[k], spread[k + 1]);
      // 3. A hard gust over loose ground lifts it into the air (a few cells a step).
      for (const t of tiles) lift(t);
      stats.tiles = active.size;
      stats.peakP = Math.round(peakP * 100) / 100; stats.peakV = Math.round(peakV * 100) / 100;
      stats.ms = performance.now() - t0;
    }
    function shatter(ax, ay) {
      for (let y = ay * S; y < Math.min(H, ay * S + S); y += 1) for (let x = ax * S; x < Math.min(W, ax * S + S); x += 1) {
        if ((mat[y * W + x] & ID_MASK) !== M.GLASS) continue;
        const owner = PW.getOwner(world, x, y);
        PW.set(world, x, y, M.AIR);
        const i = ay * AW + ax;
        if (particles && (PW.hash2(x, y) & 3) === 0) particles.spawn(x + 0.5, y + 0.5, vx[i] * 6 + ((PW.hash3(x, y, 1) & 63) - 32), vy[i] * 6 - 20, M.DEBRIS | PW.DEBRIS_KIND.METAL << 6, PW.abgr(170, 210, 230), PW.PARTICLE.LAND | PW.PARTICLE.DAMAGE, 4, owner);
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
        particles.spawn(x + 0.5, y - 0.5, vx[i] * 8, vy[i] * 8 - 30, m, 0, PW.PARTICLE.LAND, 5);
        stats.lifted += 1;
        n += 1;
      }
    }
    // The wind the air grid adds at world cell (x, y), in cells per second.
    function at(x, y) {
      const ax = (x / S) | 0, ay = (y / S) | 0;
      if (ax < 0 || ay < 0 || ax >= AW || ay >= AH || !active.size) return ZERO;
      if (!active.has(((ay / TILE) | 0) * TW + ((ax / TILE) | 0))) return ZERO;
      const i = ay * AW + ax;
      OUT[0] = vx[i] * S * 6; OUT[1] = vy[i] * S * 6; OUT[2] = p[i];
      return OUT;
    }
    const ZERO = [0, 0, 0], OUT = [0, 0, 0];
    return { blast, step, at, stats, busy: () => active.size > 0, S };
  }

  PW.createAir = createAir;
})();
