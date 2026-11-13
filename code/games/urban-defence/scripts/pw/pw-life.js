'use strict';
// The slow "life" lane: a Game of Life-style pass over the surface, a few dozen columns per tick
// (the whole map about every 9 s). Bare or scorched soil next to grass grows grass again (and now
// and then seeds on its own), fresh tufts sprout on grass, scorch marks fade, and farm fields grow
// from green shoots to golden wheat.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;

  const COLUMNS_PER_TICK = 32;
  const SPREAD = 0.35, SEED = 0.015, TUFT = 0.05, SCORCH_FADE = 0.06;
  const CROP_EVERY = 600, CROP_STEP = 0.05;   // fields grow by 5% every 10 s

  function createLife(world) {
    const W = world.width;
    let cursor = 0, tick = 0;
    const stats = { regrown: 0, tufts: 0, unscorched: 0 };
    const rnd = (x, salt) => (PW.hash3(x, salt, tick) & 1023) / 1023;
    const topId = (x) => PW.get(world, x, world.groundTop[x]) & ID_MASK;
    function inField(x) {
      for (const b of world.buildings || []) if (b.field && x >= b.field.x0 - 1 && x <= b.field.x1 + 1) return true;
      return false;
    }
    function visit(x) {
      const y = world.groundTop[x];
      if (y <= 0 || y >= world.height - 1) return;
      const id = topId(x);
      const flags = PW.getFlags(world, x, y);
      // Scorch fades from the surface and the rock just under it.
      for (let d = 0; d < 4; d += 1) {
        if ((PW.getFlags(world, x, y + d) & FLAG.SCORCH) && rnd(x, 11 + d) < SCORCH_FADE) {
          PW.setLayer(world, 'paint', x, y + d, 0);
          PW.setFlag(world, x, y + d, FLAG.SCORCH, false);
          stats.unscorched += 1;
        }
      }
      if (flags & FLAG.ROAD || PW.getOwner(world, x, y)) return;
      if ((id === M.TOPSOIL || id === M.SOIL) && !inField(x)) {
        // Grass creeps in from its neighbours, or seeds now and then.
        let near = false;
        for (let dx = -2; dx <= 2 && !near; dx += 1) {
          if (!dx || x + dx < 0 || x + dx >= W) continue;
          if (topId(x + dx) === M.GRASS && Math.abs(world.groundTop[x + dx] - y) <= 3) near = true;
        }
        if (rnd(x, 3) < (near ? SPREAD : SEED) && !(PW.getFlags(world, x, y) & FLAG.SCORCH)) {
          PW.set(world, x, y, M.GRASS | (PW.hash2(x, y) & 3) << 6, { quiet: true });
          PW.setLayer(world, 'paint', x, y, 0);
          stats.regrown += 1;
        }
        return;
      }
      if (id === M.GRASS && rnd(x, 5) < TUFT && PW.flora && !PW.getLayer(world, 'deco', x, y - 1)
        && (PW.get(world, x, y - 1) & ID_MASK) === M.AIR) {
        if (PW.flora.tuft(world, x, y, 2 + (PW.hash3(x, y, tick) & 3))) stats.tufts += 1;
      }
    }
    function step() {
      tick += 1;
      for (let k = 0; k < COLUMNS_PER_TICK; k += 1) {
        visit(cursor);
        cursor = (cursor + 1) % W;
      }
      if (tick % CROP_EVERY === 0 && PW.settlementTools) {
        for (const b of world.buildings || []) {
          if (!b.field || b.field.growth >= 1) continue;
          b.field.growth = Math.min(1, b.field.growth + CROP_STEP);
          PW.settlementTools.drawCrop(world, b.field);
        }
      }
      return stats;
    }
    // Run many passes at once (tests, fast-forward).
    function advance(ticks) { for (let t = 0; t < ticks; t += 1) step(); return stats; }
    return { step, advance, stats };
  }

  PW.createLife = createLife;
})();
