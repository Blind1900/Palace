'use strict';
// Vision (N2). A side sees the ground around what it holds: its cities and standing towns,
// its buildings, its planted seed cores, and its tanks out in the field - a tank driven
// forward carries the side's sight with it. Seeds may only be cast into that sight. This
// is the RULE the drops obey; the fog-of-war look arrives with the unit milestone (M5/M6),
// and reads the same query.
(function () {
  const PW = window.PW;

  // How far past itself each holding sees, in cells (game scale, not optics: a city watches
  // well past its edge; a lone core only its own ground).
  const RANGE = { city: 520, building: 420, tank: 380, core: 260 };

  const same = (a, b) => (a || null) === (b || null);

  function sees(world, side, x) {
    if (side === null || side === undefined) return true;   // a sideless hand is not fogged
    // The growth engine's cities (seed cities and adopted towns alike).
    const eng = world.capitalGrowth;
    if (eng && eng.cities) {
      for (const c of eng.cities) {
        if (!same(c.faction, side)) continue;
        if (x >= c.edge.left - RANGE.city && x <= c.edge.right + RANGE.city) return true;
      }
    }
    // Standing worldgen towns that have not joined the engine yet.
    for (const s of world.settlements || []) {
      if (s.adopted || !same(s.side, side)) continue;
      if (x >= s.streetLeft - RANGE.city && x <= s.streetRight + RANGE.city) return true;
    }
    // The side's standing buildings (the same identity read as the tanks': faction, else side).
    for (const b of world.buildings || []) {
      if (!b || !b.body || !same(b.faction ?? b.side, side)) continue;
      if (x >= b.body.left - RANGE.building && x <= b.body.right + RANGE.building) return true;
    }
    // Bare planted cores, waiting to grow.
    for (const q of world.seedCores || []) {
      if (!same(q.side, side)) continue;
      if (Math.abs(x - q.x) <= RANGE.core) return true;
    }
    // Tanks in the field carry sight forward.
    for (const t of world.tanks || []) {
      if (!t || t.dead || !same(t.side, side)) continue;
      if (Math.abs(x - t.x) <= RANGE.tank) return true;
    }
    return false;
  }

  PW.vision = { sees, RANGE };
})();
