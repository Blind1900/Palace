'use strict';
// Seeds (step G groundwork). A seed dropped on open, gentle ground plants a core: the unit from
// the user's sketch set bare into the earth about a metre down, its translator towards the
// surface, and the side's bundle grows out (or re-lays its span) to thread the connectors. The
// building that grows out of it comes with the construction-site semantics (F2 and G proper);
// until then a planted core is a site: it is on the pipe, and it waits.
(function () {
  const PW = window.PW;

  function drop(world, x, side) {
    const K = PW.buildingKit;
    x = Math.round(x);
    if (!K || x < 60 || x > world.width - 60) return null;
    const ground = world.groundTop[x];
    // (the seed wants ground gentle enough; on a cliff face it would just roll)
    const slope = Math.abs(world.groundTop[x + 4] - world.groundTop[x - 4]) / 8;
    if (slope > 0.9) return null;
    const c = K.createCanvas(36, 48, 44);
    const oy = K.coreUnit(c, 18, 42);
    K.bakeLights(c, 'modern');
    const groundY = ground + 28;
    PW.stampBuilding(world, c, x - 18, groundY, { owner: 0 });
    const coreY = groundY + oy - c.ground;
    const tap = world.pipes && world.pipes.connectCore ? world.pipes.connectCore(x, coreY, side) : null;
    const site = { x, y: coreY, side, tap };
    (world.seedCores = world.seedCores || []).push(site);
    return site;
  }

  PW.seeds = { drop };
})();
