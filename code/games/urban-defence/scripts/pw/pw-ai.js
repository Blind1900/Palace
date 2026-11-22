'use strict';
// The computer player (N6): one per side the person is not playing. It plays the way a person does -
// through the same calls the game bar makes (PW.game's seeds, deployments and orders) and on what
// its own side can see, never more - and at a person's pace: it looks the field over every second
// or two and does one thing at a time.
// What it does, as the match goes:
//   - grows: casts seeds out from its front towards the enemy - farms, capitals and military bases
//     in turn - when its HM runs above what it keeps back;
//   - arms: deploys from its bases while its HM and population allow - troopers mostly, tanks and
//     batteries as its bases' levels open them - and gathers them at a rally point short of its front;
//   - attacks: once enough are gathered it lets the wave go on its own way (PW.game's 'auto': for the
//     enemy's nearest units and buildings it can see);
//   - hacks: now and then sends a trooper to the panel of an enemy base or tower it can see;
//   - rebuilds: when an enemy capital has fallen, casts its own capital over the ruins.
(function () {
  const PW = window.PW;

  const THINK = [1.0, 2.2];     // s between looks at the field (a person's pace)
  const SEED_EVERY = [24, 40];  // s between seeds while it can afford them
  const KEEP_HM = 300;          // HM it keeps back for war and repair
  const SEED_ORDER = ['farm', 'capital', 'military'];
  const DEPLOY_EVERY = [3, 6];  // s between deployments
  const ARM_KEEP = 180;         // HM it keeps back from the army once it has a few units
  const BOMBARD_EVERY = [18, 30]; // s between its launchers' and jets' strikes
  const SALVO_REACH = 2400;     // cells a launcher is sent to lay a salvo at most
  const WAVE = 6;               // gathered units that make a wave
  const HACK_EVERY = [70, 110]; // s between hack attempts
  const MIX = ['trooper', 'trooper', 'trooper', 'tank', 'trooper', 'trooper', 'launcher', 'trooper', 'tank', 'dome', 'trooper', 'mech', 'jet', 'patriot'];

  function create(match, side) {
    const G = PW.game, world = match.world;
    // (its own dice, from the match's seed and its side: the same match plays the same way)
    const random = PW.createRandom((match.seed || 1) * 7 + (side === 'left' ? 11 : 23));
    const between = ([a, b]) => a + random() * (b - a);
    const brain = { side, think: between(THINK), seedAt: between(SEED_EVERY), seedN: 0, seeds: 0, tried: 0, last: '',
      deployAt: 4 + random() * 4, mixN: 0, deployed: 0, waves: 0, hackAt: between(HACK_EVERY), hacks: 0, rebuilt: 0, doing: '',
      bombardAt: between(BOMBARD_EVERY) };
    const dir = () => match.sides[side].dir;

    // Grow: a seed out past its front, a little further each try, in the kind whose turn it is.
    function grow() {
      if (match.clock < brain.seedAt) return false;
      const purse = G.purse(match, side);
      if (purse.hm < KEEP_HM) { brain.seedAt = match.clock + 6; return false; }
      const front = G.frontOf(match, side);
      const kind = SEED_ORDER[brain.seedN % SEED_ORDER.length];
      // (a few spots out from the front - the first the rules take; a person tries a few too)
      for (let k = 0; k < 6; k += 1) {
        const x = front + dir() * (160 + k * 110 + random() * 80);
        brain.tried += 1;
        const r = G.seed(match, side, kind, x);
        if (r.ok) {
          brain.seeds += 1;
          brain.last = `${kind} at ${Math.round(x)}`;
          brain.seedN += 1;
          brain.seedAt = match.clock + between(SEED_EVERY);
          return true;
        }
        brain.last = `${kind}: ${r.note}`;
      }
      // (nowhere would take it: another kind next time, a little later)
      brain.seedN += 1;
      brain.seedAt = match.clock + 8;
      return false;
    }

    // Rebuild over the ruins: an enemy capital fallen within sight - its own capital goes there.
    function rebuild() {
      const eng = world.capitalGrowth;
      const fallen = eng.cities.filter((c) => c.fallen && c.kind === 'capital' && c.faction === G.other(side));
      for (const f of fallen) {
        if (eng.cities.some((c) => c.overRuins === f.id && c.faction === side && !c.fallen)) continue;
        for (let k = 0; k < 8; k += 1) {
          const x = Math.round((f.edge.left + f.edge.right) / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 90);
          const r = G.seed(match, side, 'capital', x);
          if (r.ok) { brain.rebuilt += 1; brain.last = `capital over the ruins at ${x}`; return true; }
          brain.last = `ruins: ${r.note}`;
        }
      }
      return false;
    }

    // Arm: one deployment at a time, the next kind in its mix it can field (a kind it cannot yet -
    // its bases too low, no runway - is passed over).
    function arm() {
      if (match.clock < brain.deployAt) return false;
      brain.deployAt = match.clock + between(DEPLOY_EVERY);
      // (a small army is built whatever it costs; past that it keeps HM back for its growth)
      const army = G.unitsOf(match, side).filter((u) => !u.building).length;
      const keep = army < 6 ? 20 : ARM_KEEP;
      for (let k = 0; k < MIX.length; k += 1) {
        const kind = MIX[(brain.mixN + k) % MIX.length];
        const K = G.UNIT_KINDS[kind];
        if (G.purse(match, side).hm < K.hm + keep) continue;
        if (!G.canDeploy(match, side, kind).ok) continue;
        const r = G.deploy(match, side, kind);
        if (!r.ok) continue;
        brain.mixN = (brain.mixN + k + 1) % MIX.length;
        brain.deployed += 1;
        // (fresh units gather at the rally point; batteries stand where they are)
        if (!['launcher', 'dome', 'patriot'].includes(kind) && kind !== 'jet') {
          G.order(match, [r.unit], { type: 'move', x: rally() });
          r.unit.game.order = { type: 'gather' };
        }
        return true;
      }
      return false;
    }
    // (the rally point: out past the home town's gate - not the far mountain posts)
    const rally = () => {
      const home = (world.settlements || []).find((s) => s.side === side);
      const gate = home ? (dir() > 0 ? home.streetRight : home.streetLeft) : match.sides[side].home;
      return Math.round(gate + dir() * 260);
    };

    // Attack: a gathered wave big enough goes its own way.
    function attack() {
      const gathered = G.unitsOf(match, side).filter((u) => u.game && u.game.order.type === 'gather');
      if (gathered.length < WAVE + Math.min(6, brain.waves)) return false;
      G.order(match, gathered, { type: 'auto' });
      brain.waves += 1;
      brain.last = `wave ${brain.waves}: ${gathered.length} units`;
      return true;
    }

    // Bombard: what fights at range - the launchers' salvos on high arcs, the jets' strikes - goes for
    // the nearest enemy building it can see, over whatever lake or mountain stops the men.
    function bombard() {
      if (match.clock < brain.bombardAt) return false;
      brain.bombardAt = match.clock + between(BOMBARD_EVERY);
      const foe = G.other(side);
      const shooters = G.unitsOf(match, side).filter((u) => (u.kind === 'jet' || (u.kind === 'defence' && u.type === 'launcher')) && !u.building);
      if (!shooters.length) return false;
      let fired = 0;
      for (const u of shooters) {
        let best = null;
        for (const b of world.buildings || []) {
          if (!G.standing(b) || G.ownerOf(b) !== foe) continue;
          const bx = (b.body.left + b.body.right) / 2;
          if (PW.vision && !PW.vision.sees(world, side, bx)) continue;
          const d = Math.abs(bx - u.x);
          if (u.kind !== 'jet' && d > SALVO_REACH) continue;
          if (!best || d < best.d) best = { d, x: bx, y: b.ground - (b.ground - b.body.top) / 3 };
        }
        if (!best) continue;
        G.order(match, [u], { type: 'attack', x: Math.round(best.x), y: Math.round(best.y) });
        fired += 1;
      }
      if (fired) brain.last = `bombard: ${fired} firing`;
      return fired > 0;
    }

    // Hack: a trooper (not one already busy at a panel) sent to the nearest enemy panel it can see.
    function hack() {
      if (match.clock < brain.hackAt) return false;
      brain.hackAt = match.clock + between(HACK_EVERY);
      const foe = G.other(side);
      const troops = G.unitsOf(match, side).filter((u) => u.kind === 'trooper' && u.game && u.game.order.type !== 'hack');
      if (!troops.length) return false;
      let best = null;
      for (const b of world.buildings || []) {
        if (!G.standing(b) || G.ownerOf(b) !== foe || !(b.panels || []).length) continue;
        if (b.type !== 'military' && b.type !== 'population') continue;
        if (b.type === 'military' && (b.hackedUntil || 0) > match.clock) continue;
        const p = b.panels[0];
        if (PW.vision && !PW.vision.sees(world, side, p.x)) continue;
        for (const t of troops) {
          const d = Math.abs(t.x - p.x);
          if (!best || d < best.d) best = { d, t, b, p };
        }
      }
      if (!best) return false;
      const spot = G.standAt(world, best.p);
      G.order(match, [best.t], { type: 'hack', x: spot.x, y: spot.y + 1, target: { building: best.b, x: best.p.x, y: best.p.y } });
      brain.hacks += 1;
      brain.last = `hacker sent to ${best.b.type} ${best.b.id}`;
      return true;
    }

    function step(dt) {
      brain.think -= dt;
      if (brain.think > 0) return;
      brain.think = between(THINK);
      if (!world.capitalGrowth) return;
      // (one thing a look, the most pressing first)
      if (rebuild()) brain.doing = 'rebuild';
      else if (attack()) brain.doing = 'attack';
      else if (bombard()) brain.doing = 'bombard';
      else if (hack()) brain.doing = 'hack';
      else if (grow()) brain.doing = 'grow';
      else if (arm()) brain.doing = 'arm';
    }
    return { side, brain, step };
  }

  PW.ai = { create };
})();
