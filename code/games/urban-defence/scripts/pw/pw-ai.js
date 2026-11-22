'use strict';
// The computer player (N6): one per side the person is not playing. It plays the way a person does -
// through the same calls the game bar makes (PW.game's seeds; deployments and orders as they come)
// and on what its own side can see, never more - and at a person's pace: it looks the field over
// every second or two and does one thing at a time.
// What it does, as the match goes:
//   - grows: casts seeds out from its front towards the enemy - farms, capitals and military bases
//     in turn - when its HM runs above what it keeps back;
//   (the army, the attacks, the hacks and the rebuilding over the ruins join it slice by slice)
(function () {
  const PW = window.PW;

  const THINK = [1.0, 2.2];     // s between looks at the field (a person's pace)
  const SEED_EVERY = [24, 40];  // s between seeds while it can afford them
  const KEEP_HM = 300;          // HM it keeps back for war and repair
  const SEED_ORDER = ['farm', 'capital', 'military'];

  function create(match, side) {
    const G = PW.game, world = match.world;
    // (its own dice, from the match's seed and its side: the same match plays the same way)
    const random = PW.createRandom((match.seed || 1) * 7 + (side === 'left' ? 11 : 23));
    const between = ([a, b]) => a + random() * (b - a);
    const brain = { side, think: between(THINK), seedAt: between(SEED_EVERY), seedN: 0, seeds: 0, tried: 0, last: '' };

    // Grow: a seed out past its front, a little further each try, in the kind whose turn it is.
    function grow() {
      if (match.clock < brain.seedAt) return;
      const purse = G.purse(match, side);
      if (purse.hm < KEEP_HM) { brain.seedAt = match.clock + 6; return; }
      const dir = match.sides[side].dir, front = G.frontOf(match, side);
      const kind = SEED_ORDER[brain.seedN % SEED_ORDER.length];
      // (a few spots out from the front - the first the rules take; a person tries a few too)
      for (let k = 0; k < 6; k += 1) {
        const x = front + dir * (160 + k * 110 + random() * 80);
        brain.tried += 1;
        const r = G.seed(match, side, kind, x);
        if (r.ok) {
          brain.seeds += 1;
          brain.last = `${kind} at ${Math.round(x)}`;
          brain.seedN += 1;
          brain.seedAt = match.clock + between(SEED_EVERY);
          return;
        }
        brain.last = `${kind}: ${r.note}`;
      }
      // (nowhere would take it: another kind next time, a little later)
      brain.seedN += 1;
      brain.seedAt = match.clock + 8;
    }

    function step(dt) {
      brain.think -= dt;
      if (brain.think > 0) return;
      brain.think = between(THINK);
      if (!world.capitalGrowth) return;
      grow();
    }
    return { side, brain, step };
  }

  PW.ai = { create };
})();
