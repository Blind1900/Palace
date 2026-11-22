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
      // (the towns' first count comes a little into the match: till then, the design doc's POP)
      if (!purse.pop) { purse.pop = START.pop; purse.workers = START.pop; }
    }
    for (const side of SIDES) if (match.sides[side].controller === 'ai' && PW.ai) match.sides[side].ai = PW.ai.create(match, side);
    armDevices(match);
    current = match;
    alert(match, null, mode === 'watch' ? 'The computer plays both sides. Take either chair from the top bar.'
      : `You hold the ${human} capital. Destroy the enemy, then raise your capital over their ruins.`, '');
    return match;
  }

  // The military buildings' defences come alive for the match: a live battery on each device the
  // buildings carry - a turret where it sits (when PS's turret is in), a launcher or an Iron Dome
  // on the ground beside its building. Each knows its building; it dies with it.
  function armDevices(match) {
    const world = match.world, D = PW.defence;
    if (!D) return;
    for (const b of world.buildings || []) {
      if (!b || !b.body || !(b.devices || []).length) continue;
      const side = ownerOf(b) || 'neutral', style = (match.sides[side] || {}).style || b.style || 'modern';
      let ground = 0;
      for (const d of b.devices) {
        let u = null;
        if (d.kind === 'turret' && D.TYPES.turret) u = D.create(world, { type: 'turret', x: d.x, y: d.y, facing: d.facing || 0, side, style, building: b.id });
        else if (d.kind === 'interceptor' || d.kind === 'launcher') {
          // (wheeled batteries stand on the ground by the building, the side towards the enemy)
          const dir = d.facing || (match.sides[side] ? match.sides[side].dir : 1);
          const x = Math.round(dir > 0 ? b.body.right + 60 + ground * 120 : b.body.left - 60 - ground * 120);
          if (x < 80 || x > world.width - 80) continue;
          ground += 1;
          u = D.create(world, { type: d.kind === 'interceptor' ? ((b.level || 1) >= 3 ? 'patriot' : 'dome') : 'launcher', x, side, style, facing: dir });
        }
        if (u) {
          u.building = b.id;
          u.game = { side, kind: u.type, base: b.id, order: { type: 'hold' }, goal: null, born: 0 };
          if (PW.units && PW.units.order) PW.units.order(world, u, { type: 'hold' });
        }
      }
    }
  }

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
    match.clock += dt;
    for (const side of SIDES) {
      const s = match.sides[side];
      if (s.controller === 'ai' && s.ai) s.ai.step(dt);
    }
    match.autoClock = (match.autoClock || 0) - dt;
    if (match.autoClock <= 0) { match.autoClock = AUTO_EVERY; advance(match); }
    match.ruleClock = (match.ruleClock || 0) - dt;
    if (match.ruleClock <= 0) { match.ruleClock = 1; rules(match); }
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

  // ---- The army ------------------------------------------------------------------------------------
  // What a side's military buildings deploy, by the building's level (the user's design doc): what
  // it costs in HM, and how much of the side's POP it takes up while it lives - a side fields no more
  // than its population. Jets roll out from a runway; mechs only from the top bases, two at most.
  const UNIT_KINDS = {
    trooper: { label: 'TROOPER', hm: 10, pop: 1, level: 1, list: 'troops' },
    tank: { label: 'TANK', hm: 80, pop: 3, level: 2, list: 'tanks' },
    launcher: { label: 'ROCKETS', hm: 70, pop: 2, level: 2, list: 'defence' },
    dome: { label: 'IRON DOME', hm: 90, pop: 2, level: 3, list: 'defence' },
    jet: { label: 'JET', hm: 140, pop: 2, level: 3, list: 'jets', runway: true },
    patriot: { label: 'PATRIOT', hm: 120, pop: 2, level: 4, list: 'defence' },
    mech: { label: 'MECH', hm: 240, pop: 4, level: 5, list: 'mechs', most: 2 },
  };
  const UNIT_LISTS = ['troops', 'tanks', 'mechs', 'jets', 'defence'];
  const AUTO_EVERY = 3;        // s between looks for where the units on their own should head
  const LEG = 320;             // cells a unit on its own goes at a time when it sees nothing to go for
  const IMPASSABLE = { 'too steep': 1, drop: 1, 'deep water': 1 };   // (PS's tank stop reasons no leg gets past)
  const SPREAD = 14;           // cells between the men of a group sent to one spot

  const standing = (b) => b && b.body && !b.coresOpen && !b.dismantled && (b.health ?? 1) > 0.25;
  // A side's military buildings that stand, and what each may deploy.
  function bases(match, side) {
    return (match.world.buildings || []).filter((b) => b.type === 'military' && ownerOf(b) === side && standing(b));
  }
  // What kind of unit a list entry is (the lists hold several: the batteries' types).
  const kindOf = (u) => (u.kind === 'trooper' ? 'trooper' : u.kind === 'mech' ? 'mech' : u.kind === 'jet' ? 'jet'
    : u.kind === 'defence' ? u.type : u.art ? 'tank' : u.kind);
  function unitsOf(match, side) {
    const out = [];
    for (const list of UNIT_LISTS) for (const u of match.world[list] || []) if (!u.dead && u.side === side) out.push(u);
    return out;
  }
  // The POP a side's living army takes up (a building's own defences are the building's, not the army's).
  function fielded(match, side) {
    let pop = 0;
    for (const u of unitsOf(match, side)) if (!u.building) pop += (UNIT_KINDS[kindOf(u)] || { pop: 1 }).pop;
    return pop;
  }
  // Whether this side may deploy this kind (from this base, or from any of its bases), and why not.
  function canDeploy(match, side, kind, b = null) {
    const K = UNIT_KINDS[kind];
    if (!K) return { ok: false, note: `no such unit: ${kind}` };
    if (match.over) return { ok: false, note: 'the match is over' };
    const from = b ? [b] : bases(match, side);
    const able = from.filter((q) => standing(q) && ownerOf(q) === side && (q.level || 1) >= K.level);
    if (!able.length) return { ok: false, note: b ? `needs a level ${K.level} base` : `no base of level ${K.level}` };
    const p = purse(match, side);
    if (p.hm < K.hm) return { ok: false, note: `needs ${K.hm} HM` };
    if (fielded(match, side) + K.pop > Math.max(4, p.pop)) return { ok: false, note: 'the army is as big as the population' };
    if (K.most && unitsOf(match, side).filter((u) => kindOf(u) === kind).length >= K.most) return { ok: false, note: `${K.most} at most` };
    if (K.runway && !runwayOf(match, side)) return { ok: false, note: 'no runway' };
    return { ok: true, from: able };
  }
  function runwayOf(match, side) {
    const s = (match.world.settlements || []).find((q) => q.side === side && q.runway);
    return s ? s.runway : null;
  }
  // Where a unit leaves its base: the ground door (a trooper) or the hangar's apron, else the open
  // ground just past the building on the enemy's side.
  function exitOf(match, b, kind) {
    const world = match.world, dir = match.sides[ownerOf(b)].dir;
    // (a town's base sends its units out at the town's gate - the end of its street towards the
    // enemy - not into the lanes between its towers)
    const town = (world.settlements || []).find((s) => (s.buildings || []).includes(b));
    if (town && kind !== 'guard') {
      const x = Math.round(dir > 0 ? town.streetRight + 60 : town.streetLeft - 60);
      if (x > 40 && x < world.width - 40) return { x, y: world.groundTop[x] };
    }
    if (kind === 'trooper' || kind === 'guard') {
      const door = (b.doors || []).filter((d) => Math.abs(d.bottom - b.ground) < 6).sort((p, q) => (q.x - p.x) * dir)[0];
      if (door) return { x: door.x, y: b.ground };
    }
    if (b.hangar && b.hangar.spawn && kind !== 'trooper' && kind !== 'guard') return { x: b.hangar.spawn.x, y: b.hangar.spawn.y };
    const x = Math.round(dir > 0 ? b.body.right + 70 : b.body.left - 70);
    return { x, y: world.groundTop[Math.max(0, Math.min(world.width - 1, x))] };
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
    const base = (low.length ? low : can.from).sort((p, q) => ((q.body.left + q.body.right) - (p.body.left + p.body.right)) * dir)[0];
    const at = exitOf(match, base, kind);
    let u = null;
    if (kind === 'trooper' && PW.troops) u = PW.troops.create(world, { x: at.x + 0.5, y: at.y, side, style, facing: dir });
    else if (kind === 'tank' && PW.tanks) u = PW.tanks.create(world, { x: at.x, side, style, facing: dir });
    else if (kind === 'mech' && PW.mechs) u = PW.mechs.create(world, { x: at.x, side, style, facing: dir });
    else if (kind === 'jet' && PW.jets) u = PW.jets.takeOff(world, runwayOf(match, side), style, side);
    else if (PW.defence && (kind === 'launcher' || kind === 'dome' || kind === 'patriot')) u = PW.defence.create(world, { type: kind, x: at.x, side, style, facing: dir });
    if (!u) return { ok: false, note: `${kind}: no room to deploy` };
    world.stock[side].hm -= K.hm;
    // (batteries stand and fight where they are put; the rest go their own way at the next look)
    const battery = kind === 'launcher' || kind === 'dome' || kind === 'patriot';
    u.game = { side, kind, base: base.id, order: { type: battery ? 'hold' : 'auto' }, goal: null, born: match.clock };
    if (battery) carry(world, u, { type: 'hold' }); else match.autoClock = Math.min(match.autoClock || 0, 0.1);
    alert(match, side, `${K.label} deployed`, '', at.x);
    return { ok: true, unit: u };
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
    // (a hacker walks to the panel's floor, high in the building: a move with its height; any other
    // spot is on the ground there)
    if (PW.units && PW.units.order) {
      const q = o.type === 'hack' ? { type: 'move', x: o.x, y: o.y - 1 } : o.type === 'gather' ? { ...o, type: 'move' } : { ...o };
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
  // The units on their own ('auto'): every few seconds each heads for the nearest thing of the
  // enemy's its side can see ahead of it - a unit, then a building - or else the enemy's front.
  function advance(match) {
    const world = match.world;
    for (const side of SIDES) {
      const foe = other(side), dir = match.sides[side].dir;
      const units = unitsOf(match, side).filter((u) => u.game && u.game.order.type === 'auto' && u.game.kind !== 'jet' && !['dome', 'patriot', 'launcher'].includes(u.game.kind));
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
    const fallen = ruinsAt(match, side, x);
    const r = eng.drop(x, kind, match.sides[side].style, side);
    if (r.ok && fallen && r.city) {
      r.city.overRuins = fallen.id;   // (the win's half: a capital of ours over their ruins)
      alert(match, null, `${side.toUpperCase()} builds over the ruins of capital ${fallen.id}`, side === match.human ? 'good' : 'bad', x);
    } else if (r.ok) alert(match, side, `${side}: ${kind} seed planted`, 'good', x);
    return r.ok ? { ok: true, note: `${kind} planted`, city: r.city } : { ok: false, note: r.note || 'refused' };
  }

  PW.game = { create, step, alert, takeOver, handBack, purse, frontOf, seed, ownerOf, other, SIDES,
    UNIT_KINDS, bases, unitsOf, kindOf, fielded, canDeploy, deploy, order, standing, ruinsAt, buildingsOf, livingCore,
    HACK_TIME, rules, cover, standAt };
})();
