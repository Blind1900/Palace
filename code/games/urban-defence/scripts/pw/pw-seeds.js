'use strict';
// Seeds (step G). A seed dropped on open, gentle ground plants a core: the unit from the user's
// sketch set bare into the earth about a metre down, its translator towards the surface, and the
// side's bundle grows out (or re-lays its span) to thread the connectors. grow() then raises a
// level-1 building out of it: the god's gift below the ground line - beds, vaults, the gallery
// between them, the foundation - is set whole into the earth at once, but the body above is only
// a blueprint. Repair builds it cell by cell in the F2 order (pillars first, floors tying them,
// walls, glass), digging the lot's own ground out of the rooms as it goes; the structure system
// judges it as a construction site by what stands.
(function () {
  const PW = window.PW;
  const { M } = PW;

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
    // Deep in natural ground (the user's rule: cores sit deeper in the wild and rise up for
    // urban ground - the grown building's bed stands near the surface; the seed sinks).
    const groundY = ground + 42;
    PW.stampBuilding(world, c, x - 18, groundY, { owner: 0 });
    const coreY = groundY + oy - c.ground;
    const tap = world.pipes && world.pipes.connectCore ? world.pipes.connectCore(x, coreY, side) : null;
    // (the stamped box, kept so a refused grow can UNPLANT the unit - N80: no core may
    // stand in the wild with no building ever coming)
    const site = { x, y: coreY, side, tap, box: { x0: x - 18, y0: groundY - c.ground, x1: x + 17, y1: groundY - c.ground + 47 } };
    (world.seedCores = world.seedCores || []).push(site);
    return site;
  }

  // N80: take a planted seed back out of the ground - the unit's own cells only (steel,
  // core matter, grating), never the terrain round it - and let the line go of its thread.
  function unplant(world, site) {
    const { M } = PW;
    if (site.box) {
      for (let y = site.box.y0; y <= site.box.y1; y += 1) {
        for (let x = site.box.x0; x <= site.box.x1; x += 1) {
          const id = PW.get(world, x, y) & 63;
          if (id !== M.CORE && id !== M.STEEL && id !== M.PLATFORM) continue;
          if (PW.getOwner(world, x, y)) continue;   // someone else's works overlap: not ours
          PW.set(world, x, y, M.AIR, { quiet: true });
          PW.setLayer(world, 'deco', x, y, 0);
        }
      }
    }
    if (world.pipes && world.pipes.releaseSeedCore) world.pipes.releaseSeedCore(site.side, site.x);
    if (world.seedCores) {
      const i = world.seedCores.indexOf(site);
      if (i >= 0) world.seedCores.splice(i, 1);
    }
  }

  function grow(world, site, options = {}) {
    const T = PW.buildingTypes;
    if (!T || !T.population || !world.repair) return null;
    const side = site.side;
    const style = options.style || (world.styles && world.styles[side]) || 'modern';
    const level = options.level || 1;
    const facing = side === 'right' ? -1 : 1;
    const canvas = T.population({ style, level, variant: 'slab', seed: ((site.x * 31 + 7) >>> 0) || 1, facing });
    // The first vault core stands where the seed's unit was planted; the floor sits on the turf.
    const c0 = canvas.cores.find((q) => q.vault) || canvas.cores[0];
    const worldX = site.x - c0.x;
    const bx0 = worldX + canvas.body.left, bx1 = worldX + canvas.body.right;
    if (bx0 < 40 || bx1 > world.width - 40) return null;
    // Gentle ground only: the lot must not bury whole storeys or leave the floor hanging.
    let hi = -1e9, lo = 1e9, sum = 0;
    for (let x = bx0; x <= bx1; x += 1) { const g = world.groundTop[x]; if (g > hi) hi = g; if (g < lo) lo = g; sum += g; }
    if (hi - lo > 34) return null;
    const G = Math.round(sum / (bx1 - bx0 + 1));
    const oy = G - canvas.ground;
    // (the ground as it lies before any work: the deck's underbody meets THIS line)
    const nat0 = worldX, natural = [];
    for (let x = worldX; x < worldX + canvas.width; x += 1) natural.push(world.groundTop[x]);
    // The gift below the ground line is set whole: beds, vaults, gallery, foundation plinth.
    // Everything above stays blueprint: repair raises it (and digs the lot out) cell by cell.
    const id = world.buildings.length + 1;
    for (let ly = 0; ly < canvas.height; ly += 1) {
      const wy = oy + ly;
      if (wy < G - 2 || wy < 1 || wy >= world.height - 1) continue;
      for (let lx = 0; lx < canvas.width; lx += 1) {
        const wx = worldX + lx;
        if (wx < 1 || wx >= world.width - 1) continue;
        const i = ly * canvas.width + lx;
        if (!canvas.mat[i] && !canvas.back[i]) continue;
        if (canvas.mat[i]) {
          PW.set(world, wx, wy, canvas.mat[i], { quiet: true, keepPaint: true });
          PW.setLayer(world, 'paint', wx, wy, canvas.paint[i]);
        } else {
          const current = PW.get(world, wx, wy) & 63;
          if (current !== M.AIR && current !== M.WATER) PW.set(world, wx, wy, M.AIR, { quiet: true });
        }
        if (canvas.back[i]) PW.setLayer(world, 'back', wx, wy, canvas.back[i]);
        PW.setLayer(world, 'deco', wx, wy, canvas.deco[i]);
        PW.setOwner(world, wx, wy, id);
      }
    }
    const record = PW.buildingRecord(world, { x: worldX, y: oy, width: canvas.width, height: canvas.height, canvas }, {
      id, side, style, type: 'population', variant: 'slab', level, facing,
      neutral: false, underConstruction: true, works: [bx0, bx1], plant: null,
      base: { G, walls: [], under: null, cores: canvas.cores.map((q) => ({ x: worldX + q.x, y: oy + q.y })) },
    });
    // Born a construction site at nothing: the first judge takes it as it stands, and repair's
    // work keeps it one until it is all but whole.
    record.health = 0.02;
    record.siteWanted = true;
    record.growing = true;
    record.grewAt = world.tick || 0;
    world.buildings.push(record);
    // The deck's underbody meets the old ground line, the bundle threads every vault core of
    // the newborn building, and the god's roots go down.
    if (PW.foundations && PW.foundations.bedUnderbody) {
      const beds = record.cores.filter((k) => !k.standing && k.vault)
        .map((k) => ({ x0: k.vault.x0, x1: k.vault.x1, bottom: k.vault.bottom + 11 })).sort((u, v) => u.x0 - v.x0);
      PW.foundations.bedUnderbody(world, beds, G, (x) => natural[x - nat0] ?? G, record.id);
    }
    for (const core of record.cores) {
      if (core.orb || core.standing || !core.vault) continue;
      if (world.pipes && world.pipes.connectCore) world.pipes.connectCore(core.x, core.y, side, world.pipes.TAPS && world.pipes.TAPS.population, record.id);
      if (PW.foundations && PW.foundations.coreRoots) PW.foundations.coreRoots(world, core.x, core.vault.bottom + 12, record.id);
    }
    world.repair.notify(record.id);
    site.building = record.id;
    return record;
  }

  PW.seeds = { drop, grow, unplant };
})();
