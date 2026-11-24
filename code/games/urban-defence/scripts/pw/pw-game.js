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
  const START = { hm: 500, sm: 300, pop: 10 };   // each side's purse at the start (the user's design doc)

  // Whose a building is: worldgen's records carry the side, the growth engine's the faction.
  const ownerOf = (b) => (b && (b.faction ?? b.side)) || null;

  function create(world, opts = {}) {
    const mode = opts.mode === 'watch' ? 'watch' : 'versus';
    const human = mode === 'versus' ? (opts.human === 'right' ? 'right' : 'left') : null;
    // (N120, the user's: a side starts with no territory - no home town; the match opens with each
    // side placing its first seed, the core bunker, and the clock starts when both stand. N115's
    // gameplay test is the same opening at four times the build speed. A world made with its home
    // towns - towns=1, the suites' fixtures - plays from them as before.)
    const test = !!opts.test;
    const placing = SIDES.some((side) => !(world.settlements || []).some((s) => s.side === side));
    const match = { world, app: opts.app || null, mode, human, seed: opts.seed || 0, clock: 0,
      over: false, winner: null, reason: '', view: human || 'both', log: [], sides: {}, test, phase: placing ? 'placing' : 'play' };
    for (const side of SIDES) {
      const home = (world.settlements || []).find((s) => s.side === side);
      const site = ((world.layout && world.layout.sites) || []).find((s) => s.side === side);
      match.sides[side] = {
        side, style: home ? home.style : (world.styles && world.styles[side]) || 'modern',
        // (where its capital stands, and which way the enemy lies - in the test, its empty home pad
        // till its capital is placed)
        home: home ? Math.round((home.streetLeft + home.streetRight) / 2) : site ? Math.round((site.x0 + site.x1) / 2)
          : (side === 'left' ? 2000 : world.width - 2000),
        dir: side === 'left' ? 1 : -1,
        controller: side === human ? 'human' : 'ai',
        ai: null,
        placed: !placing,
      };
      const stock = world.stock || (world.stock = {});
      const purse = stock[side] || (stock[side] = { sm: 0, hm: 0, water: 0 });
      purse.hm = (purse.hm || 0) + START.hm;
      purse.sm = (purse.sm || 0) + START.sm;
      // (the towns' first count comes a little into the match: till then, the design doc's POP)
      if (!purse.pop) { purse.pop = START.pop; purse.workers = START.pop; }
    }
    // N116 (the user's): no city levels by itself in a match - its side buys each level (upgrade);
    // N115: and each side's military faces the enemy's end
    if (world.capitalGrowth) { world.capitalGrowth.manual = true; world.capitalGrowth.factionFacing = true; }
    for (const side of SIDES) if (match.sides[side].controller === 'ai' && PW.ai) match.sides[side].ai = PW.ai.create(match, side);
    if (placing) world.visionExtra = SIDES.map((side) => { const [x0, x1] = thirdOf(world, side); return { side, x0, x1, start: true }; });
    current = match;
    // N103/N114: every turret, launcher and interceptor base that stands takes its piece now, in the
    // match's hands (one already seated, silent, before the match - freed)
    if (PW.mounts) {
      for (const u of world.defence || []) if (u.mount && !u.dead) { u.hold = false; adopt(u); }
      PW.mounts.relay(world);   // (a plate the passes just dug through is laid again by it)
      PW.mounts.sweep(world, { armed: true });
    }
    alert(match, null, placing ? (human ? `Place your first seed, your core: click flat ground in the ${human} third of the map. It's free.` : 'Each side places its first seed.')
      : mode === 'watch' ? 'The computer plays both sides. Take either chair from the top bar.'
      : `You hold the ${human} capital. Destroy the enemy, then raise your capital over their ruins.`, '');
    return match;
  }

  // ---- N115: the starting capitals ------------------------------------------------------------------
  // In the gameplay test each side chooses where its capital starts, in its own third of the map:
  // a capital seed whose main is the core bunker. The match's clock starts when both stand.
  const thirdOf = (world, side) => (side === 'left' ? [200, Math.round(world.width / 3)] : [Math.round(world.width * 2 / 3), world.width - 200]);
  function placeStart(match, side, x) {
    const st = match.sides[side];
    if (match.phase !== 'placing' || !st || st.placed) return { ok: false, note: 'no starting capital to place' };
    const r = seed(match, side, 'capital', Math.round(x), { start: true });
    if (!r.ok) return r;
    st.placed = true;
    st.home = r.city.x;
    st.capital = r.city.id;
    alert(match, null, `${side.toUpperCase()} places its starting capital`, side === match.human ? 'good' : '', x);
    return r;
  }
  // (the computer's: on its own home pad, the flattest ground of its third, or near it)
  function placeAi(match, side) {
    const st = match.sides[side];
    for (let k = 0; k < 24; k += 1) {
      const x = st.home + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 110;
      if (placeStart(match, side, x).ok) return true;
    }
    return false;
  }
  function placing(match) {
    const world = match.world;
    // (each side sees its own third while it chooses - given at create)
    for (const side of SIDES) if (!match.sides[side].placed && match.sides[side].controller === 'ai') placeAi(match, side);
    if (SIDES.every((side) => match.sides[side].placed)) {
      world.visionExtra = (world.visionExtra || []).filter((g) => !g.start);
      match.phase = 'play';
      alert(match, null, match.human ? `Both capitals stand. Destroy the enemy, then raise your capital over their ruins.` : 'Both capitals stand: the match begins.', 'good');
    }
  }

  // The military buildings' defences come alive for the match: every turret, launcher and interceptor
  // a building carries stands on its plate (N103, N114) and is seated by the mounts sweep - below in
  // create, and as plates rise - each knowing its building, dying with it. (The wheeled batteries
  // once set down beside a building are gone: the user's, N114 - artillery is not a vehicle.)

  // (No passes: the match once bored a road through every mountain between the capitals as it
  // opened. The user's rule now: a seed never makes a tunnel at once - a city builds its road through
  // a mountain at level 3 (pw-capital-growth), and an army crosses a mountain only by such a tunnel.)

  // ---- The rules, looked at once a second ----------------------------------------------------------
  const HACK_TIME = 15;        // s at a panel (the user's design doc)
  const HACK_REACH = 14;       // cells either side of the panel a hacker may stand
  const SILENCE = 45;          // s a hacked base's defences stay silent
  const SILENCED = 0.6;        // ...this share of them (at least one)
  const COOLDOWN = 120;        // s before the same base can be hacked again
  const SIGHT_FOR = 60;        // s a hacked population building shares its side's sight
  const MANUAL_IDLE = 4;       // s a unit the person let go of waits before going its own way again
  const GUARDS = 2;            // guards a base sends out as its defences come back
  const RAISED = 0.25;         // how far up the seat of a capital over the ruins must stand to win

  const byId = (match) => {
    const map = new Map();
    for (const b of match.world.buildings || []) if (b) map.set(b.id, b);
    return map;
  };
  // A core lives while any of its cells does, where it is now (risen, floating or home): the cores'
  // own death watch passes over a standing one, so the cells are read here.
  function livingCore(b, world) {
    return (b.cores || []).some((c) => {
      if (c.dead || c.lost) return false;
      if (!world) return true;
      for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
        if ((PW.get(world, c.x + dx, Math.round(c.y) + dy) & PW.ID_MASK) === PW.M.CORE) return true;
      }
      return false;
    });
  }
  // A city's buildings: its seat and every lot placed round it.
  function buildingsOf(city, ids) {
    const out = [];
    const add = (id) => { const b = ids.get(id); if (b) out.push(b); };
    if (city.main) add(city.main.owner);
    for (const s of ['left', 'right']) for (const lot of (city.rings && city.rings[s]) || []) add(lot.owner);
    return out;
  }

  function rules(match) {
    const world = match.world, ids = byId(match);
    // Defences die with their building.
    for (const u of world.defence || []) {
      if (u.dead || !u.building) continue;
      const b = ids.get(u.building);
      if (!b || b.ruined || b.coresOpen) PW.defence.hurt(world, u, 999, 'ruined');
    }
    // The person let go of a unit: after a moment it goes its own way again (the design doc).
    for (const side of SIDES) for (const u of unitsOf(match, side)) {
      if (u.game && u.game.order.type === 'manual' && match.clock - u.game.manualAt > MANUAL_IDLE) {
        const held = [PW.troops, PW.tanks, PW.mechs, PW.jets].some((m) => m && m.held && m.held() === u);
        if (!held) u.game.order = { type: 'auto' }; else if (u.walk === 0 && !u.drive) u.game.manualAt = match.clock - MANUAL_IDLE + 1;
      }
    }
    hacks(match, ids);
    recover(match);
    ruins(match, ids);
    heal(match);
  }

  // ---- Healing (N4, the user's design doc): a man passing his side's housing is patched up, and
  // every unit on the ground by its side's standing military base - its posts' medics and fitters
  // too. Under fire or not: the reach is the building's walls and a short way round them.
  const HEAL_MAN = 5;          // hp a second for a trooper (of his 100)
  const HEAL_HULL = 2;         // a second for a tank's or mech's armour (of 100), at a base only
  const HEAL_REACH = 40;       // cells beyond a building's walls
  const HP_FULL = 100;         // (troopers, tanks and mechs all start at 100)
  function heal(match) {
    const world = match.world, at = { left: [], right: [] };
    for (const b of world.buildings || []) {
      const side = ownerOf(b);
      if (at[side] && (b.type === 'military' || b.type === 'population') && standing(b)) at[side].push(b);
    }
    for (const list of ['troops', 'tanks', 'mechs']) {
      const man = list === 'troops';
      for (const u of world[list] || []) {
        if (u.dead || !at[u.side] || !(u.hp < HP_FULL)) continue;
        const by = at[u.side].find((b) => (man || b.type === 'military')
          && u.x >= b.body.left - HEAL_REACH && u.x <= b.body.right + HEAL_REACH
          && u.y >= b.body.top - HEAL_REACH && u.y <= b.body.bottom + HEAL_REACH);
        if (!by) continue;
        u.hp = Math.min(HP_FULL, u.hp + (man ? HEAL_MAN : HEAL_HULL));
        u.healedAt = match.clock;
      }
    }
  }

  // ---- The capitals' levy: each standing capital pays its side HM by its level, a second at a
  // time - the war's purse beside what the mines bring in (they alone fielded a trooper or two a
  // minute: a match would last an afternoon)
  const LEVY = 0.5;            // HM a second per level of a standing capital
  function levy(match) {
    const eng = match.world.capitalGrowth;
    if (!eng) return;
    for (const c of eng.cities) {
      if (c.kind !== 'capital' || c.fallen || !match.sides[c.faction]) continue;
      const purse = match.world.stock[c.faction];
      if (purse) purse.hm = (purse.hm || 0) + LEVY * (c.level || 1);
    }
  }

  // ---- Hacking (the user's: military - its defences go silent for a while; population - its
  // side's sight is yours for a while). A trooper the person controls, or one sent to hack, standing
  // at the panel on the top floor for 15 s; leaving or dying breaks it off.
  function hacks(match, ids) {
    const world = match.world;
    for (const t of world.troops || []) {
      const g = t.game;
      if (!g || t.dead) { if (g) g.hack = null; continue; }
      const hacking = g.order.type === 'hack' || g.order.type === 'manual';
      const at = hacking ? panelAt(match, t, ids) : null;
      if (!at) {
        if (g.hack && g.hack.progress > 0) alert(match, t.side, 'Hack broken off', 'bad', t.x);
        g.hack = null;
        continue;
      }
      if (!g.hack || g.hack.b !== at.b.id) {
        g.hack = { b: at.b.id, progress: 0 };
        alert(match, ownerOf(at.b), `Your ${at.b.type === 'military' ? 'base' : 'tower'} is being hacked!`, 'bad', t.x);
        if (PW.troops.work) PW.troops.work(t, at.panel);
      }
      g.hack.progress += 1;
      if (g.hack.progress < HACK_TIME) continue;
      g.hack = null;
      g.order = { type: 'auto' };
      hacked(match, at.b, t.side);
    }
  }
  // Where a man stands to work a panel: on its floor, in front of the console, clear of the walls and
  // pillars round it (a console can sit behind a pillar's edge) - the nearest such spot to its middle.
  function standAt(world, p) {
    const { mat, width: W } = world, solid = (x, y) => {
      const id = mat[y * W + x] & PW.ID_MASK;
      return PW.mat.phase[id] >= PW.PHASE.POWDER && !PW.mat.passable[id] && id !== PW.M.PLATFORM;
    };
    const fits = (x) => {
      for (let xx = x - 3; xx <= x + 3; xx += 1) {
        if (!solid(xx, p.y) && (mat[p.y * W + xx] & PW.ID_MASK) !== PW.M.PLATFORM) return false;   // (the floor under it)
        for (let y = p.y - 26; y < p.y; y += 1) if (solid(xx, y)) return false;                      // (room for it)
      }
      return true;
    };
    for (let d = 0; d <= HACK_REACH - 2; d += 1) for (const s of [1, -1]) if (fits(p.x + s * d)) return { x: p.x + s * d, y: p.y - 1 };
    return { x: p.x, y: p.y - 1 };
  }
  // The enemy panel this trooper stands at, if any (a base off its cooldown, a tower standing).
  function panelAt(match, t, ids) {
    for (const b of match.world.buildings || []) {
      if (!b || !standing(b) || !(b.panels || []).length) continue;
      const owner = ownerOf(b);
      if (owner === t.side || (b.type !== 'military' && b.type !== 'population')) continue;
      if (t.x < b.body.left - 20 || t.x > b.body.right + 20) continue;
      if (b.type === 'military' && (b.hackedUntil || 0) > match.clock) continue;
      for (const p of b.panels) if (Math.abs(t.x - p.x) <= HACK_REACH && t.y >= p.y - 6 && t.y <= p.y + 34) return { b, panel: p };
    }
    return null;
  }
  function hacked(match, b, by) {
    const world = match.world, owner = ownerOf(b);
    if (b.type === 'military') {
      // (its batteries and turrets, and any battery standing in its compound)
      const near = (world.defence || []).filter((u) => !u.dead && u.side === owner
        && (u.building === b.id || (u.x > b.body.left - 300 && u.x < b.body.right + 300)));
      const n = Math.max(1, Math.ceil(near.length * SILENCED));
      for (const u of near.slice(0, n)) silence(match, u, SILENCE);
      b.hackedUntil = match.clock + SILENCE + COOLDOWN;
      b.recoverAt = match.clock + SILENCE;
      alert(match, by, `Base hacked: ${Math.min(n, near.length)} of its defences silent for ${SILENCE} s`, 'good', b.body.left);
      alert(match, owner, `A base was hacked: its defences are down for ${SILENCE} s`, 'bad', b.body.left);
    } else {
      if (PW.vision) PW.vision.grant(world, by, owner, SIGHT_FOR);
      alert(match, by, `Tower hacked: you see what the ${owner} side sees for ${SIGHT_FOR} s`, 'good', b.body.left);
      alert(match, owner, 'A tower was hacked: the enemy sees what you see', 'bad', b.body.left);
    }
  }
  // (silent: PS's disable when it is in, else the battery holds its fire until then)
  function silence(match, u, seconds) {
    if (PW.units && PW.units.disable) PW.units.disable(u, seconds);
    else { u.hold = true; u.silentUntil = match.clock + seconds; }
  }
  // A hacked base's defences come back; it sends out its guards.
  function recover(match) {
    const world = match.world;
    for (const u of world.defence || []) if (u.silentUntil && match.clock >= u.silentUntil) { u.hold = false; u.silentUntil = 0; }
    for (const b of world.buildings || []) {
      if (!b || !b.recoverAt || match.clock < b.recoverAt) continue;
      b.recoverAt = 0;
      const side = ownerOf(b);
      if (!standing(b) || !match.sides[side] || !PW.troops) continue;
      const at = exitOf(match, b, 'guard');
      for (let i = 0; i < GUARDS; i += 1) {
        // (PS's guards: the lavender men, holding their post by the base)
        const g = PW.troops.create(world, { x: at.x + 0.5 + i * 8, y: at.y, side, style: match.sides[side].style, facing: match.sides[side].dir,
          unit: 'guard', post: { x: at.x + i * 8, y: at.y } });
        if (g) g.game = { side, kind: 'trooper', base: b.id, order: { type: 'hold' }, goal: null, born: match.clock, guard: true };
      }
      alert(match, side, 'The base\'s defences are back - guards sent out', '', b.body.left);
    }
  }

  // ---- Ruins and the win ----------------------------------------------------------------------------
  // A city falls when not one core of any of its buildings lives: it claims no ground and grows no
  // more, and its ruins are open to anyone's seed. A side is destroyed when all its capitals have
  // fallen; the side that destroyed it wins once a capital it planted over their ruins stands.
  function ruins(match, ids) {
    const world = match.world, eng = world.capitalGrowth;
    if (!eng) return;
    for (const c of eng.cities) {
      if (c.fallen || c.kind !== 'capital') continue;
      const bs = buildingsOf(c, ids);
      if (bs.length && !bs.some((b) => livingCore(b, world))) {
        c.fallen = true;
        c.fallenAt = match.clock;
        alert(match, null, `${(c.faction || 'neutral').toUpperCase()} capital ${c.id} has fallen`, c.faction === match.human ? 'bad' : 'good', c.x);
      }
    }
    for (const side of SIDES) {
      const foe = other(side);
      const theirs = eng.cities.filter((c) => c.kind === 'capital' && c.faction === foe);
      if (!theirs.length || theirs.some((c) => !c.fallen)) continue;
      // (a capital of ours over their ruins, its seat raised: pillars and floors up - a quarter of it)
      const raised = eng.cities.find((c) => {
        if (c.kind !== 'capital' || c.faction !== side || c.fallen || !theirs.some((f) => f.id === c.overRuins)) return false;
        const seat = c.main && c.main.placed && ids.get(c.main.owner);
        return !!seat && !seat.ruined && (seat.health || 0) >= RAISED && livingCore(seat, world);
      });
      if (!raised) continue;
      match.over = true;
      match.winner = side;
      match.reason = `The ${foe} side is destroyed, and the ${side} capital rises over their ruins.`;
      alert(match, null, match.reason, 'good');
      return;
    }
  }
  // (a fallen capital of the enemy's whose ruins lie under x)
  function ruinsAt(match, side, x) {
    const eng = match.world.capitalGrowth;
    if (!eng) return null;
    return eng.cities.find((c) => c.fallen && c.kind === 'capital' && c.faction === other(side)
      && x >= c.edge.left - 60 && x <= c.edge.right + 60) || null;
  }

  // A line for the HUD's alert list (side null: everyone's).
  function alert(match, side, text, tone = '', x = null) {
    match.log.push({ t: match.clock, side, text, tone, x });
    if (match.log.length > 40) match.log.shift();
  }

  function step(match, dt) {
    if (match.over) return;
    if (match.phase === 'placing') { placing(match); return; }   // (N115: the clock waits for both capitals)
    match.clock += dt;
    for (const side of SIDES) {
      const s = match.sides[side];
      if (s.controller === 'ai' && s.ai) s.ai.step(dt);
    }
    match.autoClock = (match.autoClock || 0) - dt;
    if (match.autoClock <= 0) { match.autoClock = AUTO_EVERY; advance(match); }
    match.ruleClock = (match.ruleClock || 0) - dt;
    if (match.ruleClock <= 0) { match.ruleClock = 1; rules(match); levy(match); }
    if (!PW.units || !PW.units.order) {
      for (const list of ['tanks', 'mechs']) for (const u of match.world[list] || []) if (u.game && u.game.goal != null) towards(u);
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
  // How far a side's own ground runs towards the enemy: the front edge of its cities and buildings
  // (towns: its cities only - not the posts out on the mountains).
  function frontOf(match, side, towns = false) {
    const world = match.world, dir = match.sides[side].dir;
    let front = match.sides[side].home;
    const reach = (x) => { if ((x - front) * dir > 0) front = x; };
    for (const c of (world.capitalGrowth && world.capitalGrowth.cities) || []) {
      if (c.faction !== side || c.fallen) continue;
      reach(dir > 0 ? c.edge.right : c.edge.left);
    }
    if (towns) return front;
    for (const b of world.buildings || []) {
      if (!b || !b.body || ownerOf(b) !== side) continue;
      reach(dir > 0 ? b.body.right : b.body.left);
    }
    return front;
  }

  // ---- The army ------------------------------------------------------------------------------------
  // What a side's military buildings deploy, by the building's level (the user's design doc): what
  // it costs, and how much of the side's POP it takes up while it lives - a side fields no more
  // than its population. Jets roll out from a runway; mechs only from the top bases, two at most.
  // N116 (the user's): every unit costs HM and SM both - the men lean on the soft materials (kit,
  // rations), the machines on the hard.
  // (N114, the user's: the rockets, the Iron Dome and the Patriot are no longer deployed - they are
  // stationary artillery set on a base: ARTILLERY, below)
  const UNIT_KINDS = {
    trooper: { label: 'TROOPER', hm: 10, sm: 10, pop: 1, level: 1, list: 'troops' },
    tank: { label: 'TANK', hm: 80, sm: 20, pop: 3, level: 2, list: 'tanks' },
    // (N111: the jets give way to PS's avenger drones - kind 'jet' and world.jets kept, the drone's name shown)
    jet: { label: 'DRONE', hm: 140, sm: 20, pop: 2, level: 3, list: 'jets', runway: true },
    mech: { label: 'MECH', hm: 240, sm: 40, pop: 4, level: 5, list: 'mechs', most: 2 },
  };
  const UNIT_LISTS = ['troops', 'tanks', 'mechs', 'jets', 'defence'];
  const AUTO_EVERY = 3;        // s between looks for where the units on their own should head
  const LEG = 320;             // cells a unit on its own goes at a time when it sees nothing to go for
  const IMPASSABLE = { 'too steep': 1, drop: 1, 'deep water': 1 };   // (PS's tank stop reasons no leg gets past)
  const SPREAD = 14;           // cells between the men of a group sent to one spot

  const standing = (b) => b && b.body && !b.coresOpen && !b.dismantled && (b.health ?? 1) > 0.25;
  // A side's military buildings that stand, and what each may deploy.
  function bases(match, side) {
    // (N89: a base's smaller buildings - its watchtower, barracks, bunker - are garrisons, not bases)
    return (match.world.buildings || []).filter((b) => b.type === 'military' && ownerOf(b) === side && standing(b) && !(b.canvas && b.canvas.meta && b.canvas.meta.post));
  }
  // What kind of unit a list entry is (the lists hold several: the batteries' types).
  const kindOf = (u) => (u.kind === 'trooper' ? 'trooper' : u.kind === 'mech' ? 'mech' : u.kind === 'jet' ? 'jet'
    : u.kind === 'defence' ? u.type : u.art ? 'tank' : u.kind);
  function unitsOf(match, side) {
    const out = [];
    for (const list of UNIT_LISTS) for (const u of match.world[list] || []) if (!u.dead && u.side === side) out.push(u);
    return out;
  }
  // The POP a side's living army takes up (a building's own defences are the building's, not the
  // army's; a turret on its base is a work, not a man - N103).
  function fielded(match, side) {
    let pop = 0;
    for (const u of unitsOf(match, side)) if (!u.building && !u.mount) pop += (UNIT_KINDS[kindOf(u)] || { pop: 1 }).pop;
    return pop;
  }
  // How big an army the side's people stand behind: its population - and while its towers are
  // being raised anew at a level-up (their people out of the count till they stand) most of the
  // most it has had, so a growing city does not ground its army.
  function armyCap(match, side) {
    const p = purse(match, side), st = match.sides[side];
    st.popPeak = Math.max(st.popPeak || 0, p.pop);
    return Math.max(8, p.pop, Math.round(st.popPeak * 0.8));
  }
  // Whether this side may deploy this kind (from this base, or from any of its bases), and why not.
  function canDeploy(match, side, kind, b = null) {
    const K = UNIT_KINDS[kind];
    if (!K) return { ok: false, note: `no such unit: ${kind}` };
    if (match.over) return { ok: false, note: 'the match is over' };
    const from = b ? [b] : bases(match, side);
    const leveled = from.filter((q) => standing(q) && ownerOf(q) === side && (q.level || 1) >= K.level);
    if (!leveled.length) return { ok: false, note: b ? `needs a level ${K.level} base` : `no base of level ${K.level}` };
    const able = leveled.filter((q) => wayOut(match.world, q));
    if (!able.length) return { ok: false, note: 'no way down from the mountain yet (its road tunnel is still to come)' };
    const p = purse(match, side);
    if (p.hm < K.hm) return { ok: false, note: `needs ${K.hm} HM` };
    if (p.sm < (K.sm || 0)) return { ok: false, note: `needs ${K.sm} SM` };
    if (fielded(match, side) + K.pop > armyCap(match, side)) return { ok: false, note: 'the army is as big as the population' };
    if (K.most && unitsOf(match, side).filter((u) => kindOf(u) === kind).length >= K.most) return { ok: false, note: `${K.most} at most` };
    // (a drone off a pad once PS's drones lift off one, else off a runway)
    if (K.runway && !(padJets() && able.some((q) => q.pad)) && !runwayOf(match, side)) return { ok: false, note: padJets() ? 'no spawn pad' : 'no runway' };
    return { ok: true, from: able };
  }
  function runwayOf(match, side) {
    const s = (match.world.settlements || []).find((q) => q.side === side && q.runway);
    return s ? s.runway : null;
  }
  // N111: the kinds that come up on a base's spawn pad - the batteries are set down outside, and
  // the drones (PS's N106, replacing the jets) once they lift off a pad instead of a runway.
  const padJets = () => !!(PW.jets && PW.jets.padLaunch);
  const onPad = (kind) => kind === 'trooper' || kind === 'tank' || kind === 'mech' || (kind === 'jet' && padJets());
  // Where a unit leaves its base: up on the spawn pad in its hangar floor (N111), else the ground
  // door (a trooper) or the hangar's apron, else the open ground just past the building on the
  // enemy's side.
  function exitOf(match, b, kind) {
    const world = match.world, dir = match.sides[ownerOf(b)].dir;
    // (a town's base sends its units out at the town's gate - the end of its street towards the
    // enemy - not into the lanes between its towers: from the pad it is their first leg)
    const town = (world.settlements || []).find((s) => (s.buildings || []).includes(b));
    let gate = null;
    if (town && kind !== 'guard') {
      const x = Math.round(dir > 0 ? town.streetRight + 60 : town.streetLeft - 60);
      if (x > 40 && x < world.width - 40) gate = x;
    }
    if (b.pad && onPad(kind)) return { x: Math.round((b.pad.x0 + b.pad.x1) / 2), y: b.pad.y, pad: b.pad, gate };
    // N130 (the user's, 2026-11-24): every unit comes up from the base's core - on the floor over
    // it, where a base has no pad - and heads out by the town's gate where it has one
    const core = (b.cores || []).find((k) => k.vault && !k.dead) || (b.cores || [])[0];
    // (a hull out of a core's floor only once PS's spawnPoint finds it room there - N131)
    if (core && (kind === 'trooper' || (kind !== 'guard' && PW.units && PW.units.spawnPoint))) return { x: Math.round(core.x), y: b.ground, core, gate };
    if (gate !== null) return { x: gate, y: world.groundTop[gate] };
    if (kind === 'trooper' || kind === 'guard') {
      const door = (b.doors || []).filter((d) => Math.abs(d.bottom - b.ground) < 6).sort((p, q) => (q.x - p.x) * dir)[0];
      if (door) return { x: door.x, y: b.ground };
    }
    if (b.hangar && b.hangar.spawn && kind !== 'trooper' && kind !== 'guard') return { x: b.hangar.spawn.x, y: b.hangar.spawn.y };
    const x = Math.round(dir > 0 ? b.body.right + 70 : b.body.left - 70);
    return { x, y: world.groundTop[Math.max(0, Math.min(world.width - 1, x))] };
  }
  // N130 (the user's): a base up on a mountain sends out no one until it has a way down - its
  // road tunnel bored through (or another's within reach of it); no unit is left stranded at a
  // mountain's foot or on its top.
  function onMountain(world, b) {
    if (perched(world, b)) return true;
    const L = world.layout, x = Math.round((b.body.left + b.body.right) / 2);
    return !!(L && L.relief && L.relief[x] > 0.2);
  }
  function wayOut(world, b) {
    if (!onMountain(world, b)) return true;
    const x = (b.body.left + b.body.right) / 2;
    return (world.roadTunnels || []).some((t) => t.done && x > t.a - 900 && x < t.b + 900);
  }
  // (a mountain outpost or bunker: a base, but a long climb down - the army leaves from the towns)
  const perched = (world, b) => [...(world.outposts || []), ...(world.bunkers || [])].some((o) => o.building === b);
  // Deploy one unit of this kind from this base (or from the base nearest the front that can - a
  // town's before a mountain post's).
  function deploy(match, side, kind, b = null) {
    const world = match.world, can = canDeploy(match, side, kind, b);
    if (!can.ok) return can;
    const K = UNIT_KINDS[kind], st = match.sides[side], style = st.style, dir = st.dir;
    const low = can.from.filter((q) => !perched(world, q));
    const pool = low.length ? low : can.from;
    // (N111: a base with a spawn pad first - where there is one, every unit comes up on it)
    const padded = onPad(kind) ? pool.filter((q) => q.pad) : [];
    const base = (padded.length ? padded : pool).sort((p, q) => ((q.body.left + q.body.right) - (p.body.left + p.body.right)) * dir)[0];
    const at = exitOf(match, base, kind);
    // (N131/N130, with PS: the room a kind needs round the core's exit - headroom, ground that
    // bears it, a tank's no steeper than it climbs - or no deploy)
    if (PW.units && PW.units.spawnPoint && !at.pad) {
      const p = PW.units.spawnPoint(world, kind, at.x, at.y);
      if (!p) return { ok: false, note: 'no room at its core\'s exit' };
      at.x = p.x; at.y = p.y;
    }
    // (on the pad: a man's, a mech's or a drone's feet on its deck, a tank's wheels; elsewhere
    // each on the floor at the exit)
    const placed = !!(at.pad || at.core);
    const feet = placed ? at.y - 1 : at.y;
    let u = null;
    if (kind === 'trooper' && PW.troops) u = PW.troops.create(world, { x: at.x + 0.5, y: feet, side, style, facing: dir });
    else if (kind === 'tank' && PW.tanks) u = PW.tanks.create(world, { x: at.x, y: placed ? at.y : undefined, side, style, facing: dir });
    else if (kind === 'mech' && PW.mechs) u = PW.mechs.create(world, { x: at.x, y: placed ? feet : undefined, side, style, facing: dir });
    else if (kind === 'jet' && PW.jets) {
      u = at.pad ? PW.jets.create(world, { x: at.x, y: feet, side, style, facing: dir, pad: at.pad })
        : PW.jets.takeOff(world, runwayOf(match, side), style, side);
    }
    if (!u) return { ok: false, note: `${kind}: no room to deploy` };
    world.stock[side].hm -= K.hm;
    world.stock[side].sm -= K.sm || 0;
    // (each goes its own way at the next look - one up on a town base's pad by way of the town's gate)
    const via = placed && at.gate !== null && at.gate !== undefined && kind !== 'jet' ? at.gate : undefined;
    u.game = { side, kind, base: base.id, order: { type: 'auto' }, goal: null, born: match.clock, via };
    if (via !== undefined) carry(world, u, { type: 'move', x: via });
    else match.autoClock = Math.min(match.autoClock || 0, 0.1);
    if (at.pad) padLift(match, at.pad, at.x);
    alert(match, side, `${K.label} deployed`, '', at.x);
    return { ok: true, unit: u };
  }
  // (N111: the lift brings it up - white flecks off the core's vault below, the pad's marker
  // lights flashing down its length)
  function padLift(match, pad, x) {
    const P = match.world.particles, F = PW.PARTICLE;
    if (!P || !F) return;
    const t = Math.round(match.clock * 60);
    for (let k = 0; k < 28; k += 1) {
      const h = PW.hash2(k * 31 + x, t);
      P.spawn(x + ((h & 31) - 16) + 0.5, pad.y - 1, ((h >>> 5 & 63) - 32) * 0.8, -50 - (h >>> 11 & 63), 0, PW.abgr(238, 242, 246), F.GLOW, 0.3 + (h >>> 17 & 7) * 0.05);
    }
    for (let lx = pad.x0 + 6; lx <= pad.x1 - 6; lx += 12) P.spawn(lx + 0.5, pad.y - 1, 0, -10, 0, PW.abgr(118, 214, 232), F.GLOW, 0.5);
  }

  // ---- Turrets (N103) -------------------------------------------------------------------------------
  // A turret is set down on any flat ground the side can see - on the land, or on a tunnel room's
  // floor: a base laid there (PW.mounts) and the turret seated on it. It costs HM, and a side keeps
  // as many as its military bases' levels allow; it is a work, not a man - it takes no POP.
  const TURRET = { label: 'TURRET', hm: 60, per: 3 };
  const turretsOf = (match, side) => (match.world.mounts || []).filter((m) => m.placedBy === side && !m.spent && (m.kind || 'turret') === 'turret').length;
  const turretCap = (match, side) => Math.max(2, TURRET.per * bases(match, side).reduce((n, b) => n + (b.level || 1), 0));
  function canTurret(match, side) {
    if (match.over) return { ok: false, note: 'the match is over' };
    if (!bases(match, side).length) return { ok: false, note: 'needs a military base' };
    if (purse(match, side).hm < TURRET.hm) return { ok: false, note: `needs ${TURRET.hm} HM` };
    const cap = turretCap(match, side);
    if (turretsOf(match, side) >= cap) return { ok: false, note: `${cap} at most: more bases, more turrets` };
    return { ok: true };
  }
  function placeTurret(match, side, x, y) {
    const can = canTurret(match, side);
    if (!can.ok) return can;
    const world = match.world, M = PW.mounts;
    if (!M) return { ok: false, note: 'no turret bases' };
    x = Math.round(x);
    if (x < 60 || x > world.width - 60) return { ok: false, note: 'off the map' };
    if (PW.vision && !PW.vision.sees(world, side, x)) return { ok: false, note: 'beyond your vision' };
    const st = match.sides[side], info = { near: x, side, style: st.style, facing: st.dir, road: true };
    // (clicked under the ground - in a tunnel's room: its floor; else the land there)
    const under = Number.isFinite(y) && y > world.groundTop[x] + 8;
    const m = under ? M.place(world, x - 80, x + 80, { ...info, room: true, top: Math.round(y) - 12, bottom: Math.round(y) + 70, at: 'room' })
      : M.place(world, x - 80, x + 80, { ...info, at: 'land' });
    if (!m) return { ok: false, note: 'no flat ground there' };
    m.placedBy = side;
    world.stock[side].hm -= TURRET.hm;
    M.sweep(world, { armed: true });
    alert(match, side, 'TURRET set on its base', '', m.x);
    return { ok: true, mount: m };
  }
  // ---- Upgrades and rushes (N116) -------------------------------------------------------------------
  // No city levels by itself in a match (the user's): the side picks which to raise and pays HM for
  // it, by the city's kind and the level it rises from; its spread and its towers coming of age then
  // follow on their own up to that level. HM also rushes one of the side's tunnel networks: its
  // next four minutes of growth in one (PW.tunnels.rush).
  const UPGRADE = { capital: 120, military: 80, farm: 60 };
  const RUSH = { hm: 50 };
  const upgradeCost = (city) => (UPGRADE[city.kind] || 100) * city.level;
  // (the side's city whose ground x is in - or any side's, with side null)
  function cityAt(match, x, side = null) {
    const eng = match.world.capitalGrowth;
    if (!eng) return null;
    let best = null;
    for (const c of eng.cities) {
      if (c.fallen || (side && c.faction !== side)) continue;
      const l = Math.min(c.edge.left, c.capEdge.left) - 30, r = Math.max(c.edge.right, c.capEdge.right) + 30;
      if (x < l || x > r) continue;
      const d = Math.abs(x - c.x);
      if (!best || d < best.d) best = { c, d };
    }
    return best ? best.c : null;
  }
  function canUpgrade(match, side, city) {
    const eng = match.world.capitalGrowth;
    if (match.over) return { ok: false, note: 'the match is over' };
    if (!eng || !city) return { ok: false, note: 'no city of yours there' };
    if (city.faction !== side) return { ok: false, note: 'not your city' };
    if (city.level >= eng.topLevel(city)) return { ok: false, note: `level ${city.level} is its top` };
    // (N122, the user's "both": its building takes its kind's time to grow whole, and it may be
    // raised again while it grows - each raise starts that time over)
    const cost = upgradeCost(city);
    if (purse(match, side).hm < cost) return { ok: false, note: `needs ${cost} HM`, cost };
    return { ok: true, cost };
  }
  function upgrade(match, side, at) {
    const city = typeof at === 'object' ? at : cityAt(match, at, side);
    const can = canUpgrade(match, side, city);
    if (!can.ok) return can;
    const r = match.world.capitalGrowth.upgrade(city);
    if (!r.ok) return r;
    match.world.stock[side].hm -= can.cost;
    alert(match, side, `${city.kind.toUpperCase()} ${city.id} raised to level ${city.level}`, 'good', city.x);
    return { ok: true, city, level: city.level, cost: can.cost };
  }
  // (the side's tunnel network at (x, y), and its rush)
  function tunnelAt(match, side, x, y) {
    const T = PW.tunnels;
    if (!T) return null;
    for (const [dx, dy] of [[0, 0], [0, -6], [0, 6], [-6, 0], [6, 0]]) {
      const net = T.networkAt(match.world, Math.round(x + dx), Math.round(y + dy));
      if (net && net.side === side) return net;
    }
    return null;
  }
  function rushTunnel(match, side, x, y) {
    if (match.over) return { ok: false, note: 'the match is over' };
    const net = tunnelAt(match, side, x, y);
    if (!net) return { ok: false, note: 'no tunnel of yours there' };
    if (purse(match, side).hm < RUSH.hm) return { ok: false, note: `needs ${RUSH.hm} HM` };
    if (net.rushUntil > PW.tunnels.state(match.world).time) return { ok: false, note: 'already rushed' };
    const r = PW.tunnels.rush(match.world, net);
    match.world.stock[side].hm -= RUSH.hm;
    alert(match, side, 'Tunnel works rushed', 'good', x);
    return { ok: true, net, ...r };
  }

  // ---- Missile artillery (N114) ----------------------------------------------------------------------
  // The user's: rockets, Iron Dome and Patriot follow the turret - stationary artillery set on a base,
  // built on any flat roof or flat ground the side can see, out under the sky (never in a tunnel's room
  // or under a roof). Each costs HM and SM, needs a military base of its level, and takes no POP; a
  // side keeps one a level of its military bases, all three together. PS's launcher or interceptor
  // is seated on the base by the mounts sweep and fires as PS's does.
  const ARTILLERY = {
    launcher: { label: 'ROCKETS', hm: 70, sm: 15, level: 2, kind: 'launcher' },
    dome: { label: 'IRON DOME', hm: 90, sm: 15, level: 3, kind: 'interceptor' },
    patriot: { label: 'PATRIOT', hm: 120, sm: 20, level: 4, kind: 'interceptor' },
  };
  const artilleryOf = (match, side) => (match.world.mounts || []).filter((m) => m.placedBy === side && !m.spent && m.kind !== 'turret').length;
  const artilleryCap = (match, side) => Math.max(1, bases(match, side).reduce((n, b) => n + (b.level || 1), 0));
  function canArtillery(match, side, type) {
    const A = ARTILLERY[type];
    if (!A) return { ok: false, note: `no such artillery: ${type}` };
    if (match.over) return { ok: false, note: 'the match is over' };
    if (!bases(match, side).some((b) => (b.level || 1) >= A.level)) return { ok: false, note: `needs a level ${A.level} base` };
    const p = purse(match, side);
    if (p.hm < A.hm) return { ok: false, note: `needs ${A.hm} HM` };
    if (p.sm < A.sm) return { ok: false, note: `needs ${A.sm} SM` };
    const cap = artilleryCap(match, side);
    if (artilleryOf(match, side) >= cap) return { ok: false, note: `${cap} at most: more base levels, more artillery` };
    return { ok: true };
  }
  function placeArtillery(match, side, type, x) {
    const can = canArtillery(match, side, type);
    if (!can.ok) return can;
    const world = match.world, M = PW.mounts, A = ARTILLERY[type];
    if (!M) return { ok: false, note: 'no artillery bases' };
    x = Math.round(x);
    if (x < 60 || x > world.width - 60) return { ok: false, note: 'off the map' };
    if (PW.vision && !PW.vision.sees(world, side, x)) return { ok: false, note: 'beyond your vision' };
    const st = match.sides[side];
    const m = M.place(world, x - 90, x + 90, { kind: A.kind, type, near: x, side, style: st.style, facing: st.dir, road: true, at: 'land' });
    if (!m) return { ok: false, note: 'no flat ground open to the sky there' };
    m.placedBy = side;
    world.stock[side].hm -= A.hm;
    world.stock[side].sm -= A.sm;
    M.sweep(world, { armed: true });
    alert(match, side, `${A.label} set on its base`, '', m.x);
    return { ok: true, mount: m };
  }

  // (a turret seated by the mounts sweep joins the match: its side's, holding where it stands)
  function adopt(u) {
    const match = current;
    if (!match || !u) return;
    u.game = { side: u.side, kind: u.type || 'turret', base: u.building || 0, order: { type: 'hold' }, goal: null, born: match.clock };
    if (PW.units && PW.units.order) PW.units.order(match.world, u, { type: 'hold' });
  }

  // Orders: move to a spot, attack a spot or a target, hold where it stands, or 'auto' - on its own
  // (head for the enemy, and fight what it meets). PS's PW.units.order carries each out by the
  // unit's kind; until it is in, troopers walk their route and tanks drive.
  function order(match, units, ord) {
    const world = match.world;
    units = units.filter((u) => u && !u.dead);
    units.forEach((u, i) => {
      const off = (i - (units.length - 1) / 2) * SPREAD;
      const o = { ...ord };
      if (o.x !== undefined && o.type !== 'hold') o.x = Math.round(o.x + off);
      if (!u.game) u.game = { side: u.side, kind: kindOf(u), order: o, goal: null, born: match.clock };
      u.game.order = o;
      carry(world, u, o);
    });
    return units.length;
  }
  function carry(world, u, o) {
    if (o.type === 'manual') return;
    // (a hacker sneaks to the panel's floor, high in the building - crouched, never firing, unseen
    // by the computer's eyes: PS's quiet move; any other spot is on the ground there)
    if (PW.units && PW.units.order) {
      const q = o.type === 'hack' ? { type: 'move', x: o.x, y: o.y - 1, quiet: true } : o.type === 'gather' ? { ...o, type: 'move' } : { ...o };
      if (Number.isFinite(q.x) && !Number.isFinite(q.y)) q.y = world.groundTop[Math.max(0, Math.min(world.width - 1, Math.round(q.x)))];
      PW.units.order(world, u, q);
      return;
    }
    const kind = u.game.kind;
    const gx = o.x === undefined ? null : Math.max(8, Math.min(world.width - 8, o.x));
    if (o.type === 'hold') {
      if (kind === 'trooper') { u.route = null; u.walk = 0; }
      u.game.goal = null;
      if (kind === 'tank' && PW.tanks) PW.tanks.drive(u, 0);
      return;
    }
    if (gx === null) return;
    if (kind === 'trooper' && PW.troops) PW.troops.goTo(world, u, gx, o.type === 'hack' ? o.y - 1 : world.groundTop[gx]);
    else if (kind === 'tank' || kind === 'mech') u.game.goal = gx;
    if (o.type === 'attack' && o.target) u.aim = { x: o.target.x, y: o.target.y };
  }
  // (a tank or a mech goes for its goal and stops there - until PS's orders take over)
  function towards(u) {
    if (u.dead) return;
    const d = u.game.goal - u.x, mech = u.game.kind === 'mech';
    const go = (dir) => (mech ? PW.mechs.walk(u, dir) : PW.tanks.drive(u, dir));
    if (Math.abs(d) < 30) { go(0); u.game.goal = null; return; }
    if ((mech ? u.walk : u.drive) !== Math.sign(d)) go(Math.sign(d));
  }
  // The first dry ground at or past x going dir (a lake's far shore), within reach.
  function dryAhead(world, x, dir) {
    const wet = (gx) => (PW.get(world, gx, world.groundTop[gx]) & PW.ID_MASK) === PW.M.WATER;
    let gx = Math.max(8, Math.min(world.width - 8, x));
    for (let k = 0; k < 300 && wet(gx); k += 1) gx = Math.max(8, Math.min(world.width - 8, gx + dir * 10));
    return wet(gx) ? x : gx + dir * 30;
  }
  // The units on their own ('auto'): every few seconds each heads for the nearest thing of the
  // enemy's its side can see ahead of it - a unit, then a building - or else the enemy's front.
  function advance(match) {
    const world = match.world;
    for (const side of SIDES) {
      const foe = other(side), dir = match.sides[side].dir;
      const units = unitsOf(match, side).filter((u) => u.game && u.game.order.type === 'auto' && u.game.kind !== 'jet' && u.kind !== 'defence');
      if (!units.length) continue;
      const seen = (x) => !PW.vision || PW.vision.sees(world, side, x);
      const targets = [];
      for (const u of unitsOf(match, foe)) if (seen(u.x)) targets.push({ x: u.x, y: u.y, unit: u });
      for (const b of world.buildings || []) {
        const o = ownerOf(b);
        if (!standing(b) || (o !== foe && o !== 'neutral')) continue;
        const bx = (b.body.left + b.body.right) / 2;
        if (seen(bx)) targets.push({ x: bx, y: b.ground, building: b });
      }
      const front = frontOf(match, foe);
      for (const u of units) {
        let best = null;
        for (const t of targets) {
          const ahead = (t.x - u.x) * dir;
          if (ahead < -200) continue;
          const d = Math.abs(t.x - u.x) + (t.building ? 400 : 0);
          if (!best || d < best.d) best = { d, t };
        }
        // (nothing seen: on towards the enemy's front a stretch at a time - a route across the whole
        // map at once is more than a man's way-finding should be asked; one that has stood still
        // since the last look tries a shorter stretch)
        const g = u.game;
        // (one the computer has taken in hand for a fight - a target to focus, a fall back - is left
        // to it till then: PW.ai)
        if ((g.handUntil || 0) > match.clock) continue;
        // (N111: one up on a town base's pad makes for the town's gate first - there, or given
        // time, it goes its own way)
        if (g.via !== undefined) {
          if (Math.abs(u.x - g.via) < 40 || match.clock - g.born > 45) delete g.via;
          else continue;
        }
        // (a tank stopped by ground no tank takes - too steep, a drop, deep water - holds there and
        // fights from where it stands; it has no way round)
        if (u.kind === 'tank' && u.stopAt && IMPASSABLE[u.stopAt[2]] && (u.stopAt[0] - u.x) * dir >= -40) {
          if (!g.stuck) { g.stuck = u.stopAt[2]; carry(world, u, { type: 'hold' }); }
          continue;
        }
        const stalled = g.lastX !== undefined && Math.abs(u.x - g.lastX) < 8 && !u.route;
        g.stalls = stalled ? (g.stalls || 0) + 1 : 0;
        g.lastX = u.x;
        const leg = LEG / (1 + Math.min(3, g.stalls));
        let x = best ? best.t.x - dir * (best.t.building ? 160 : 90)
          : (front - u.x) * dir > leg + 300 ? u.x + dir * leg : front - dir * 300;
        if (stalled && best) x = u.x + dir * leg;   // (no way to the target from here: closer first)
        // (a leg ending in a lake goes on to its far shore: men swim across, nobody stands on water)
        x = dryAhead(world, Math.round(x), dir);
        if (!stalled && g.heading !== undefined && Math.abs(g.heading - x) < 60 && Math.abs(u.x - g.heading) > 80) continue;   // (on its way)
        g.heading = x;
        // (a unit it goes for as its target; a building as a place to take under fire)
        carry(world, u, best && best.t.unit ? { type: 'attack', x: Math.round(x), target: best.t.unit }
          : best ? { type: 'attack', x: Math.round(x), y: best.t.y - 30 } : { type: 'move', x: Math.round(x) });
        g.order = { type: 'auto' };
      }
    }
  }

  // ---- Cover (the user's rule): a side's own buildings never stop its rounds - so an enemy's
  // building gives a unit no cover from that enemy - while a friendly building in the way takes the
  // hit for the unit behind it, until there is little left of it. PS's rounds ask this as they enter
  // a building's cell (PW.shots: never for earth, tunnel lining, blasts or debris); true lets the
  // round through untouched, anything else is the physics as it was.
  let current = null;
  const ownerIds = { world: null, n: -1, map: null };
  function cover(shot, owner, x, y) {
    const world = current && current.world;
    if (!world || !shot || !shot.side || !owner) return false;
    if (ownerIds.world !== world || ownerIds.n !== world.buildings.length) {
      ownerIds.world = world; ownerIds.n = world.buildings.length; ownerIds.map = new Map();
      for (const b of world.buildings) if (b) ownerIds.map.set(b.id, b);
    }
    const b = ownerIds.map.get(owner);
    return !!b && ownerOf(b) === shot.side;
  }

  // ---- Seeds ---------------------------------------------------------------------------------------
  // A side casts a seed where it can see open, gentle ground: a capital, a farm or a military base
  // grows from it by the growth rules (PW.capitalGrowth), in the side's style, threaded onto its
  // bundle. The same rule for a person and the computer.
  // (the match's own rules for a seed at x - before the engine's: the opening, sight, the standing
  // towns and the mountain posts)
  function seedRules(match, side, kind, x, opts = {}) {
    const world = match.world, eng = world.capitalGrowth;
    if (match.over) return { ok: false, note: 'the match is over' };
    if (!eng) return { ok: false, note: 'no growth engine' };
    if (!KINDS[kind]) return { ok: false, note: `no such seed: ${kind}` };
    if (match.phase === 'placing' && !opts.start) return { ok: false, note: 'place your starting capital first' };
    if (opts.start) {
      const [a, b] = thirdOf(world, side);
      if (x < a || x > b) return { ok: false, note: `your capital starts in the ${side} third of the map` };
    } else if (PW.vision && !PW.vision.sees(world, side, x)) return { ok: false, note: 'beyond your vision' };
    // (the standing towns not yet in the engine, and the mountain outposts and bunkers, hold their
    // ground - the engine knows its own cities' claims)
    for (const s of world.settlements || []) {
      if (!s.adopted && x > s.streetLeft - 220 && x < s.streetRight + 220) return { ok: false, note: 'claimed by a standing town' };
    }
    for (const o of [...(world.outposts || []), ...(world.bunkers || [])]) {
      for (const f of o.footprints || []) if (x > f[0] - 90 && x < f[1] + 90) return { ok: false, note: 'claimed by the military' };
    }
    return { ok: true };
  }
  // N120/N112 (the user's): where a seed in hand would go - green where it can, red where it can't -
  // and, where it can, the building that would stand there (the core bunker for the first).
  function seedPreview(match, side, kind, x, opts = {}) {
    x = Math.round(x);
    const rules = seedRules(match, side, kind, x, opts);
    if (!rules.ok) return { ...rules, x };
    return { ...match.world.capitalGrowth.canDrop(x, kind, match.sides[side].style, side, opts), x };
  }
  // (opts.start - N115/N120: a side's starting capital, placed before it can see anything)
  function seed(match, side, kind, x, opts = {}) {
    const world = match.world, eng = world.capitalGrowth;
    x = Math.round(x);
    const rules = seedRules(match, side, kind, x, opts);
    if (!rules.ok) return rules;
    const fallen = ruinsAt(match, side, x);
    const r = eng.drop(x, kind, match.sides[side].style, side, { start: !!opts.start });
    if (r.ok && opts.start) return { ok: true, note: 'starting capital placed', city: r.city };
    if (r.ok && fallen && r.city) {
      r.city.overRuins = fallen.id;   // (the win's half: a capital of ours over their ruins)
      alert(match, null, `${side.toUpperCase()} builds over the ruins of capital ${fallen.id}`, side === match.human ? 'good' : 'bad', x);
    } else if (r.ok) alert(match, side, `${side}: ${kind} seed planted`, 'good', x);
    return r.ok ? { ok: true, note: `${kind} planted`, city: r.city } : { ok: false, note: r.note || 'refused' };
  }

  PW.game = { create, step, alert, takeOver, handBack, purse, frontOf, seed, ownerOf, other, SIDES,
    UNIT_KINDS, bases, unitsOf, kindOf, fielded, armyCap, canDeploy, deploy, order, standing, ruinsAt, buildingsOf, livingCore,
    HACK_TIME, rules, cover, standAt, TURRET, canTurret, placeTurret, turretCap, adopt, current: () => current,
    UPGRADE, RUSH, upgradeCost, cityAt, canUpgrade, upgrade, tunnelAt, rushTunnel, placeStart, thirdOf, seedPreview,
    ARTILLERY, canArtillery, placeArtillery, artilleryCap };
})();
