'use strict';
// Vision (N2, N6). A side sees the ground around what it holds: its cities and standing towns,
// its buildings, its planted seed cores, and its units out in the field - troopers, tanks, mechs,
// jets and batteries carry the side's sight with them, further the way they face (the user's
// design doc: a unit sees a cone ahead of it). Seeds may only be cast into that sight, and the
// match draws the fog of war from it: the other side's units show only where you see.
// A side that has hacked a population building of the enemy's sees what the enemy sees for a
// while (N6, the user's): world.visionGrants holds { to, from, until } - until in world ticks.
(function () {
  const PW = window.PW;

  // How far past itself each holding sees, in cells (game scale, not optics: a city watches
  // well past its edge; a lone core only its own ground). A unit sees its range ahead of it and
  // half that behind.
  const RANGE = { city: 520, building: 420, tank: 380, core: 260, troop: 300, mech: 420, jet: 700, defence: 520 };
  const UNIT_LISTS = [['troops', 'troop'], ['tanks', 'tank'], ['mechs', 'mech'], ['jets', 'jet'], ['defence', 'defence']];

  const same = (a, b) => (a || null) === (b || null);

  // Every stretch of ground [x0, x1] the side's own holdings see (not counting grants).
  function ownSpans(world, side) {
    const out = [];
    const eng = world.capitalGrowth;
    // The growth engine's cities (seed cities and adopted towns alike).
    if (eng && eng.cities) {
      for (const c of eng.cities) if (same(c.faction, side) && !c.fallen) out.push([c.edge.left - RANGE.city, c.edge.right + RANGE.city]);
    }
    // Standing worldgen towns that have not joined the engine yet.
    for (const s of world.settlements || []) {
      if (!s.adopted && same(s.side, side)) out.push([s.streetLeft - RANGE.city, s.streetRight + RANGE.city]);
    }
    // The side's standing buildings (the same identity read as the tanks': faction, else side).
    for (const b of world.buildings || []) {
      if (b && b.body && !b.ruined && same(b.faction ?? b.side, side)) out.push([b.body.left - RANGE.building, b.body.right + RANGE.building]);
    }
    // Bare planted cores, waiting to grow.
    for (const q of world.seedCores || []) if (same(q.side, side)) out.push([q.x - RANGE.core, q.x + RANGE.core]);
    // Units in the field carry sight forward.
    for (const [list, kind] of UNIT_LISTS) {
      const R = RANGE[kind];
      for (const u of world[list] || []) {
        if (!u || u.dead || !same(u.side, side)) continue;
        const f = u.facing || 0;
        out.push([u.x - (f < 0 ? R : f > 0 ? R / 2 : R), u.x + (f > 0 ? R : f < 0 ? R / 2 : R)]);
      }
    }
    return out;
  }
  // The sides whose sight this side shares just now: its own, and any it has hacked its way into.
  function sources(world, side) {
    const out = [side];
    for (const g of world.visionGrants || []) if (same(g.to, side) && (world.tick || 0) < g.until && !out.includes(g.from)) out.push(g.from);
    return out;
  }

  function sees(world, side, x) {
    if (side === null || side === undefined) return true;   // a sideless hand is not fogged
    for (const s of sources(world, side)) {
      for (const [a, b] of ownSpans(world, s)) if (x >= a && x <= b) return true;
    }
    return false;
  }

  // The side's sight as merged spans, sorted - for drawing the fog and the minimap. Worked out
  // afresh at most every quarter second of world time.
  const cache = new Map();
  function spans(world, side) {
    const key = `${side}`, hit = cache.get(key), tick = world.tick || 0;
    if (hit && hit.world === world && tick - hit.tick < 15 && tick >= hit.tick) return hit.spans;
    const all = [];
    for (const s of sources(world, side)) all.push(...ownSpans(world, s));
    all.sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const [a, b] of all) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
    }
    cache.set(key, { world, tick, spans: merged });
    return merged;
  }
  // (a hack's grant: `to` sees what `from` sees for the given seconds)
  function grant(world, to, from, seconds) {
    const list = world.visionGrants || (world.visionGrants = []);
    list.push({ to, from, until: (world.tick || 0) + Math.round(seconds * 60) });
    cache.delete(to);
  }

  PW.vision = { sees, spans, grant, RANGE };
})();
