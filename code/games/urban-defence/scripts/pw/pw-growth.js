'use strict';
// Step H (first slice): the city grows by itself. Every so often each side's town carries a seed
// past the end of its street - reserves allowing, ground allowing - and a new tower grows out of
// it by step G: the bare core unit planted first, the god's gift below ground set whole, the body
// raised pillars-first by repair. The street paves out to meet the newcomer and the bundle
// threads its cores live. Level-ups (sub cores), tunnels through mountains and bridges over
// water come with the rest of step H.
(function () {
  const PW = window.PW;
  const { M } = PW;

  const GROW_EVERY = 28;        // seconds between growth attempts (one side per attempt)
  const RESERVE = 350;          // HM kept back for war and repair: growth spends only above this
  const SEED_HM = 40;           // the seed itself costs a little HM to cast
  const REACH = 700;            // how far past the street a seed may be carried
  const EDGE = 64;              // clearance between the street's end and the new lot
  const LOT = 70;               // half-width of the lot the ground is judged over

  function createGrowth(world) {
    const stats = { attempts: 0, grown: 0, blocked: 0 };
    let timer = 0, turn = 0;

    const occupied = (x, self) => {
      for (const s of world.settlements || []) if (s !== self && x > s.streetLeft - 220 && x < s.streetRight + 220) return true;
      for (const p of [...(world.outposts || []), ...(world.bunkers || [])]) {
        for (const f of p.footprints || []) if (x > f[0] - 90 && x < f[1] + 90) return true;
      }
      return false;
    };
    const wet = (x) => {
      const g = world.groundTop[x];
      for (const dy of [1, 2]) if ((PW.get(world, x, g - dy) & 63) === M.WATER) return true;
      return (PW.get(world, x, g) & 63) === M.WATER;
    };
    // Gentle, open, dry ground wide enough for a level-1 lot.
    const lotFits = (x) => {
      let hi = -1e9, lo = 1e9;
      for (let dx = -LOT; dx <= LOT; dx += 7) {
        const cx = x + dx;
        if (cx < 80 || cx > world.width - 80) return false;
        const g = world.groundTop[cx];
        if (g > hi) hi = g;
        if (g < lo) lo = g;
        if (wet(cx) || PW.getOwner(world, cx, g + 4)) return false;
      }
      return hi - lo <= 30;
    };

    function attempt(side) {
      stats.attempts += 1;
      const s = (world.settlements || []).find((q) => q.side === side);
      // N3: an adopted town grows through the capital-growth engine instead.
      if (s && s.adopted) return;
      const stock = world.stock && world.stock[side];
      if (!s || !stock || stock.hm < RESERVE + SEED_HM) return;
      // One newcomer at a time per side: the next seed waits until the last stands whole.
      if ((world.buildings || []).some((b) => b.side === side && b.underConstruction && (b.health || 0) < 0.95)) return;
      // The town tries the open country on both flanks, nearest lot first.
      for (const dir of (turn & 2) === 0 ? [1, -1] : [-1, 1]) {
        const start = (dir > 0 ? s.streetRight : s.streetLeft) + dir * (EDGE + LOT);
        for (let d = 0; d <= REACH; d += 14) {
          const x = start + dir * d;
          if (x < 120 || x > world.width - 120) break;
          if (occupied(x, s)) { stats.blocked += 1; break; }
          if (!lotFits(x)) continue;
          const site = PW.seeds.drop(world, x, side);
          if (!site) continue;
          const b = PW.seeds.grow(world, site, { style: s.style });
          // N80: a refused grow UNPLANTS the seed - a bare core must never stand in the
          // wild with no building ever coming (the user's cut-off cores, one class of).
          if (!b) { if (PW.seeds.unplant) PW.seeds.unplant(world, site); continue; }
          stock.hm -= SEED_HM;
          // The street paves out to the newcomer's door, easing onto its ground line.
          const tools = PW.settlementTools;
          if (tools && tools.paveStreet) {
            const from = dir > 0 ? s.streetRight : s.streetLeft;
            const to = dir > 0 ? b.body.left - 2 : b.body.right + 2;
            const y0 = world.groundTop[from], y1 = b.ground;
            const span = Math.max(1, Math.abs(to - from));
            tools.paveStreet(world, Math.min(from, to), Math.max(from, to),
              (px) => Math.round(y0 + (y1 - y0) * Math.abs(px - from) / span), () => s.style);
          }
          if (dir > 0) s.streetRight = (b.works ? b.works[1] : b.body.right) + 6;
          else s.streetLeft = (b.works ? b.works[0] : b.body.left) - 6;
          stats.grown += 1;
          return;
        }
      }
    }

    function step(dt = 1 / 60) {
      timer += dt;
      if (timer < GROW_EVERY) return;
      timer = 0;
      attempt((turn += 1) & 1 ? 'left' : 'right');
    }

    const api = { step, attempt, stats };
    world.growth = api;
    return api;
  }

  PW.createGrowth = createGrowth;
})();
