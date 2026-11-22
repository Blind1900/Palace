'use strict';
// The match (N6): two sides, left and right, each holding its capital at its end of the map, and
// the neutral towns between. The game is destruction and building over the ruins: a side is beaten
// when none of its capitals has a living core, and the winner is the side that beats it and raises
// a capital of its own over its ruins. No capture (the user's, 2026-11-22).
// Each side is played by a person or by the computer (PW.ai) - a person against the computer, or
// the computer against itself while the person watches and may take either side's chair at any
// moment and hand it back. The computer plays by the person's rules: the same seeds, deployments
// and orders, and only what its side can see.
// This module holds the match's state and its rules; the menu, the HUD and the game bar are
// PW.gameUI's, the computer players PW.ai's.
(function () {
  const PW = window.PW;
  const SIDES = ['left', 'right'];
  const other = (side) => (side === 'left' ? 'right' : 'left');
  const KINDS = { capital: 'capital', farm: 'farm', military: 'military' };
  const START = { hm: 500, sm: 300 };   // each side's purse at the start (the user's design doc)

  // Whose a building is: worldgen's records carry the side, the growth engine's the faction.
  const ownerOf = (b) => (b && (b.faction ?? b.side)) || null;

  function create(world, opts = {}) {
    const mode = opts.mode === 'watch' ? 'watch' : 'versus';
    const human = mode === 'versus' ? (opts.human === 'right' ? 'right' : 'left') : null;
    const match = { world, app: opts.app || null, mode, human, seed: opts.seed || 0, clock: 0,
      over: false, winner: null, reason: '', view: human || 'both', log: [], sides: {} };
    for (const side of SIDES) {
      const home = (world.settlements || []).find((s) => s.side === side);
      match.sides[side] = {
        side, style: home ? home.style : 'modern',
        // (where its capital stands, and which way the enemy lies)
        home: home ? Math.round((home.streetLeft + home.streetRight) / 2) : (side === 'left' ? 2000 : world.width - 2000),
        dir: side === 'left' ? 1 : -1,
        controller: side === human ? 'human' : 'ai',
        ai: null,
      };
      const stock = world.stock || (world.stock = {});
      const purse = stock[side] || (stock[side] = { sm: 0, hm: 0, water: 0 });
      purse.hm = (purse.hm || 0) + START.hm;
      purse.sm = (purse.sm || 0) + START.sm;
    }
    for (const side of SIDES) if (match.sides[side].controller === 'ai' && PW.ai) match.sides[side].ai = PW.ai.create(match, side);
    alert(match, null, mode === 'watch' ? 'The computer plays both sides. Take either chair from the top bar.'
      : `You hold the ${human} capital. Destroy the enemy, then raise your capital over their ruins.`, '');
    return match;
  }

  // A line for the HUD's alert list (side null: everyone's).
  function alert(match, side, text, tone = '', x = null) {
    match.log.push({ t: match.clock, side, text, tone, x });
    if (match.log.length > 40) match.log.shift();
  }

  function step(match, dt) {
    if (match.over) return;
    match.clock += dt;
    for (const side of SIDES) {
      const s = match.sides[side];
      if (s.controller === 'ai' && s.ai) s.ai.step(dt);
    }
  }

  // ---- Who plays which side ------------------------------------------------------------------------
  // (watching: the person takes a side's chair - the computer steps aside for it - or hands it back)
  function takeOver(match, side) {
    for (const s of SIDES) {
      const st = match.sides[s];
      if (s === side) { st.controller = 'human'; st.ai = null; } else if (st.controller !== 'ai') { st.controller = 'ai'; st.ai = PW.ai ? PW.ai.create(match, s) : null; }
    }
    match.human = side;
    match.view = side;
    alert(match, null, `You took the ${side} side's chair.`, 'good');
  }
  function handBack(match) {
    if (match.mode !== 'watch' || !match.human) return;
    const st = match.sides[match.human];
    st.controller = 'ai';
    st.ai = PW.ai ? PW.ai.create(match, match.human) : null;
    alert(match, null, `The computer plays the ${match.human} side again.`, '');
    match.human = null;
    match.view = 'both';
  }

  // ---- What a side has -----------------------------------------------------------------------------
  function purse(match, side) {
    const st = match.world.stock && match.world.stock[side];
    return { hm: st ? st.hm || 0 : 0, sm: st ? st.sm || 0 : 0, water: st ? st.water || 0 : 0,
      pop: st ? st.pop || 0 : 0, workers: st ? st.workers || 0 : 0 };
  }
  // How far a side's own ground runs towards the enemy: the front edge of its cities and buildings.
  function frontOf(match, side) {
    const world = match.world, dir = match.sides[side].dir;
    let front = match.sides[side].home;
    const reach = (x) => { if ((x - front) * dir > 0) front = x; };
    for (const c of (world.capitalGrowth && world.capitalGrowth.cities) || []) {
      if (c.faction !== side) continue;
      reach(dir > 0 ? c.edge.right : c.edge.left);
    }
    for (const b of world.buildings || []) {
      if (!b || !b.body || ownerOf(b) !== side) continue;
      reach(dir > 0 ? b.body.right : b.body.left);
    }
    return front;
  }

  // ---- Seeds ---------------------------------------------------------------------------------------
  // A side casts a seed where it can see open, gentle ground: a capital, a farm or a military base
  // grows from it by the growth rules (PW.capitalGrowth), in the side's style, threaded onto its
  // bundle. The same rule for a person and the computer.
  function seed(match, side, kind, x) {
    const world = match.world, eng = world.capitalGrowth;
    if (match.over) return { ok: false, note: 'the match is over' };
    if (!eng) return { ok: false, note: 'no growth engine' };
    if (!KINDS[kind]) return { ok: false, note: `no such seed: ${kind}` };
    x = Math.round(x);
    if (PW.vision && !PW.vision.sees(world, side, x)) return { ok: false, note: 'beyond your vision' };
    // (the standing towns not yet in the engine, and the mountain outposts and bunkers, hold their
    // ground - the engine knows its own cities' claims)
    for (const s of world.settlements || []) {
      if (!s.adopted && x > s.streetLeft - 220 && x < s.streetRight + 220) return { ok: false, note: 'claimed by a standing town' };
    }
    for (const o of [...(world.outposts || []), ...(world.bunkers || [])]) {
      for (const f of o.footprints || []) if (x > f[0] - 90 && x < f[1] + 90) return { ok: false, note: 'claimed by the military' };
    }
    const r = eng.drop(x, kind, match.sides[side].style, side);
    if (r.ok) alert(match, side, `${side}: ${kind} seed planted`, 'good', x);
    return r.ok ? { ok: true, note: `${kind} planted`, city: r.city } : { ok: false, note: r.note || 'refused' };
  }

  PW.game = { create, step, alert, takeOver, handBack, purse, frontOf, seed, ownerOf, other, SIDES };
})();
