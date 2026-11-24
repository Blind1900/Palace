'use strict';
// Salvos and their interceptors (N90, the user's - the Iron Dome and Patriot refs): artillery standing
// on a base on a roof or flat ground (N114 - no longer trucks: see the artillery, below), at their
// real size, each side's colours; each round fired costs its side HM (N114: see PRICE):
// - a rocket launcher (MLRS): a pod of 12 tubes on a turntable; told a spot, it fires a salvo -
//   a ripple of rockets, one every 0.15 s, each on the high arc that comes down there, spread a
//   little (PW.shots' rocket);
// - an Iron Dome battery: its radar watches the sky round it; a rocket or missile of the other side
//   it sees, it works out where it will come down - and only if that is on its own side's ground
//   (a building of its side, a unit, within reach of the impact) it fires at it once it is on its
//   way down, the soonest to strike first - two interceptors a moment apart, each with its
//   proximity fuse's chance of destroying it (PW.shots' interceptor); one coming down on open
//   ground it lets fall. A salvo bigger than its load gets partly through;
// - a Patriot battery: further and higher, two to a threat as well - rockets, missiles, and the
//   other side's jets (PW.shots' patriot);
// - and a turret (N103): an autocannon on its base on a roof, the ground or a wall, firing on its own
//   at the hostile units near it (see the turrets, below).
// Each can be taken in hand (the user's: every unit can be controlled): a click aims a launcher and
// fires its salvo; a battery fights on its own - F holds or frees its fire. What strikes them comes
// off their armour; destroyed, their ammunition goes up and they fall off their base, burnt.
// Our own code throughout.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, passable } = PW.mat;
  const G = () => PW.GRAVITY || 260;

  // (N114, the user's: the launchers and batteries are artillery standing on a base - a roof, flat
  // ground - not vehicles: see the artillery below. reload: s its crew takes to load it again, spent)
  const TYPES = {
    launcher: { length: 60, ammo: 12, kind: 'rocket', hp: 60, reload: 60, fixed: true },
    dome: { length: 44, ammo: 20, kind: 'interceptor', hp: 60, range: 4000, perThreat: 2, protect: true, reload: 45, fixed: true },
    patriot: { length: 64, ammo: 8, kind: 'patriot', hp: 70, range: 4500, perThreat: 2, protect: false, jets: true, reload: 45, fixed: true },
    // an autocannon turret on its base on a roof, the ground, a tunnel room's floor or a wall (N103:
    // see the turrets below) - bursts at the hostile units it sees; a box of rounds, reloaded
    turret: { length: 26, ammo: 120, kind: 'cannon', hp: 45, burst: 5, rof: 1 / 7, rest: 0.9, reload: 4, fixed: true },
  };
  const RIPPLE = 0.15;          // s between a salvo's rockets
  const LAUNCH_GAP = 0.2;       // s between a battery's interceptors
  const ENGAGE = 5;             // s: a Dome fires at a threat this near coming down on its ground, no sooner
  const ENGAGE_LAST = 1;        // s: ... and no later - its interceptor would meet it too low
  const LOOK_EVERY = 6;         // ticks between a battery's looks at the sky
  const COVER = 70;             // cells: a threat coming down this near its side's building or unit is a threat to it
  const STYLES = {
    modern: { body: [118, 120, 96], dark: [84, 86, 68], light: [150, 152, 124] },
    asian: { body: [92, 108, 70], dark: [64, 78, 50], light: [122, 138, 96] },
    gothic: { body: [70, 84, 58], dark: [48, 58, 40], light: [98, 112, 80] },
  };
  const stats = { salvos: 0, rockets: 0, launched: 0, ignored: 0, destroyed: 0 };
  let current = null, seq = 0;

  const blocks = (world, x, y) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
    const id = world.mat[(y | 0) * world.width + (x | 0)] & ID_MASK;
    return phase[id] >= PHASE_POWDER && !passable[id];
  };
  const PHASE_POWDER = PW.PHASE.POWDER;
  function groundUnder(world, x, from = 0) {
    for (let y = Math.max(0, from); y < world.height - 1; y += 1) if (blocks(world, x, y + 1)) return y;
    return world.height - 2;
  }

  // ---- A unit ----------------------------------------------------------------------------------------
  // (x: its middle; y: a turret's mount, the cell of its base's face; the artillery's, the row it
  // stands on - over its base, given as WGM's mounts give it, the base's top row; or set down on the
  // ground under x)
  function create(world, spec) {
    const type = TYPES[spec.type] ? spec.type : 'launcher', T = TYPES[type];
    const x = Math.round(spec.x), art = type !== 'turret';
    const y = art && spec.base ? (spec.base.y0 ?? spec.base.y ?? spec.y) - 1 : spec.y ?? groundUnder(world, x, 0);
    const u = { kind: 'defence', type, x, y, facing: spec.facing === -1 ? -1 : 1, side: spec.side || null, style: STYLES[spec.style] ? spec.style : 'modern',
      hp: T.hp, dead: false, ammo: T.ammo, salvo: 0, salvoT: 0, aim: null, gap: 0, look: 0, hold: !!spec.hold, engaged: new Map(), hurtBy: '',
      building: spec.building || 0, burst: 0, burstT: 0, rest: 0, aimA: 0, reloadT: 0, seed: ++seq };
    current = world;
    if (type === 'turret') mountTurret(u, spec);
    else { u.base = spec.base || null; u.headF = u.facing; u.turnT = 0; u.el = BUILD[type].stow; }
    (world.defence || (world.defence = [])).push(u);
    current = world;
    if (type === 'turret') turretPose(u); else artPose(u);
    return u;
  }
  // (where its tubes' mouths are, and which way they point - facing f, the way its pod faces now
  // unless asked: a Dome's near straight up, its interceptors clearing the town's towers round it
  // before they turn)
  function tubeOf(u, f = u.headF ?? u.facing) {
    const B = BUILD[u.type], a = u.type === 'launcher' && u.salvo > 0 && Number.isFinite(u.laid) ? u.laid : u.el ?? B.stow;
    const [L, Th] = B.pod, ps = B.trunnion, ph = B.ring[1] + B.post;
    const ms = ps + L * Math.cos(a) - Th / 2 * Math.sin(a), mh = ph + L * Math.sin(a) + Th / 2 * Math.cos(a);
    return { x: u.x + ms * f, y: u.y - mh, up: u.type === 'launcher' ? (u.salvo > 0 && Number.isFinite(u.laid) ? u.laid : LAUNCHER_UP) : a };
  }
  const LAUNCHER_UP = 1.15;     // rad: the way up a launcher's rockets go, looked along for a roof over it
  // (is the way its rounds go up open - nothing solid over its tubes along it for CLEAR_RUN cells,
  // a roof, a tower, a mast? It does not fire into one. Looked at again every CLEAR_EVERY s, the
  // world changing round it)
  const CLEAR_RUN = 360, CLEAR_EVERY = 2;
  function skyClear(world, u, facing = u.facing) {
    const t = tubeOf(u, facing), dx = Math.cos(t.up) * facing, dy = -Math.sin(t.up);
    for (let d = 4; d < CLEAR_RUN; d += 2) {
      const x = Math.round(t.x + dx * d), y = Math.round(t.y + dy * d);
      if (y < 0) return true;
      if (blocks(world, x, y)) return false;
    }
    return true;
  }

  // ---- The launcher's salvo -----------------------------------------------------------------------------
  // (the angle - the high one - that brings a rocket from (x0, y0) down at (x1, y1): its straight
  // flight on its motor, then its arc under gravity and the air's drag, flown out and corrected)
  function laying(world, x0, y0, x1, y1) {
    const K = PW.shots.KINDS.rocket, g = G(), dir = Math.sign(x1 - x0) || 1;
    const landAt = (a) => {
      let x = x0, y = y0, vx = Math.cos(a) * dir * K.speed, vy = -Math.sin(a) * K.speed;
      const dt = 1 / 30;
      for (let t = 0; t < K.life; t += dt) {
        if (t >= K.burn) vy += g * dt;
        const keep = 1 - K.drag * dt;
        vx *= keep; vy *= keep;
        x += vx * dt; y += vy * dt;
        if (vy > 0 && y >= y1) return x;
      }
      return x;
    };
    // (the high arc: from steep down, the angle whose rocket comes down at x1)
    let lo = 46 * Math.PI / 180, hi = 84 * Math.PI / 180;
    for (let k = 0; k < 24; k += 1) {
      const mid = (lo + hi) / 2, d = (landAt(mid) - x1) * dir;
      if (d > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // A salvo: as many rockets as it has - and as its side can pay for (N114: each costs PRICE.rocket
  // HM of the side's stock, where one is kept) - its pod turned to the mark's side and raised to the
  // high arc's angle first, then rippled off.
  function fire(world, u) {
    if (!u || u.dead || u.type !== 'launcher' || u.salvo > 0 || !u.aim || u.ammo <= 0 || u.launching) return false;
    const can = affordable(world, u.side, 'rocket');
    if (can <= 0) { stats.noHm = (stats.noHm || 0) + 1; return false; }
    u.facing = Math.sign(u.aim.x - u.x) || u.facing;
    // (the angle from where its tubes' mouths will be, raised to it: worked out twice)
    u.salvo = Math.min(u.ammo, TYPES.launcher.ammo, can);
    u.laid = laying(world, tubeOf(u, u.facing).x, tubeOf(u, u.facing).y, u.aim.x, u.aim.y);
    u.laid = laying(world, tubeOf(u, u.facing).x, tubeOf(u, u.facing).y, u.aim.x, u.aim.y);
    u.salvoT = 0;
    stats.salvos += 1;
    return true;
  }
  function stepSalvo(world, u, dt) {
    // (its pod round to the mark's side and raised to the laid angle before the first goes)
    if (u.turnT > 0 || u.headF !== u.facing || Math.abs(u.el - u.laid) > 0.02) return;
    u.salvoT -= dt;
    while (u.salvo > 0 && u.salvoT <= 0) {
      if (!pay(world, u.side, 'rocket')) { u.salvo = 0; stats.noHm = (stats.noHm || 0) + 1; break; }
      const t = tubeOf(u), spread = ((PW.hash3(u.seed, u.salvo, 3) & 255) / 255 - 0.5) * 0.03, a = u.laid + spread;
      PW.shots.fire(world, { kind: 'rocket', x: t.x, y: t.y, dx: Math.cos(a) * u.headF, dy: -Math.sin(a), side: u.side, from: u });
      if (PW.shots.report) PW.shots.report(world, t.x, t.y, -Math.cos(a) * u.headF, Math.sin(a), 2);
      u.salvo -= 1; u.ammo -= 1; u.salvoT += RIPPLE;
      stats.rockets += 1;
    }
    if (u.ammo <= 0 && !(u.reloadT > 0)) u.reloadT = TYPES[u.type].reload;
  }
  // ---- A drone off it (N126, the user's: drones go up off a side's missile launcher at 45-85 degrees,
  // on a booster - see PW.jets) ---------------------------------------------------------------------------
  // The drone made in its pod, the pod turned the way it is to go and raised to the angle - steeper
  // over high ground near ahead - then fired off it; the pod held up a moment, then back at rest.
  const DRONE_LO = 45 * Math.PI / 180, DRONE_HI = 85 * Math.PI / 180;
  const DRONE_CLEAR = 80;       // cells it climbs over the ground ahead with to spare
  const DRONE_HOLD = 0.8;       // s the pod stays up after
  // (the angle its way: as steep as clearing the highest of the ground ahead within reach needs)
  function droneAngle(world, u, f) {
    const t = tubeOf(u, f), W = world.width;
    let a = 55 * Math.PI / 180;
    for (let d = 30; d <= 700; d += 10) {
      const x = Math.round(t.x + f * d);
      if (x < 0 || x >= W) break;
      a = Math.max(a, Math.atan2(t.y - (world.groundTop[x] - DRONE_CLEAR), d));
    }
    return Math.max(DRONE_LO, Math.min(DRONE_HI, a));
  }
  // (open along it: nothing solid over the pod's mouth that way for CLEAR_RUN cells)
  function wayOpen(world, u, f, a) {
    const t = tubeOf(u, f), dx = Math.cos(a) * f, dy = -Math.sin(a);
    for (let d = 4; d < CLEAR_RUN; d += 2) {
      const x = Math.round(t.x + dx * d), y = Math.round(t.y + dy * d);
      if (y < 0) return true;
      if (blocks(world, x, y)) return false;
    }
    return true;
  }
  function canLaunch(world, u) {
    return !!(u && !u.dead && u.type === 'launcher' && !u.launching && !(u.salvo > 0) && PW.jets && PW.jets.create
      && !((u.disabledUntil || 0) > (world.tick || 0)));
  }
  // Launch a drone off launcher u - its side's, in its paint unless told (opts.style, opts.side;
  // opts.facing: the way it goes, else the way the launcher faces - and if that way is shut over it,
  // the other). The drone - waiting in the pod until it is fired - or null.
  function launchDrone(world, u, opts = {}) {
    if (!canLaunch(world, u)) return null;
    let f = opts.facing === -1 || opts.facing === 1 ? opts.facing : u.facing, a = droneAngle(world, u, f);
    if (!wayOpen(world, u, f, a)) {
      const b = droneAngle(world, u, -f);
      if (!wayOpen(world, u, -f, b)) return null;
      f = -f; a = b;
    }
    const j = PW.jets.create(world, { pod: u, style: opts.style || u.style, side: opts.side || u.side, facing: f, x: u.x, y: u.y - 20, pitch: a, radians: true });
    u.facing = f; u.launching = j; u.launchA = a; u.launchHold = 0;
    stats.drones = (stats.drones || 0) + 1;
    return j;
  }
  function stepLaunch(world, u, dt) {
    const j = u.launching;
    if (!j || j.dead) { u.launching = null; return; }
    if (j.pod) {
      // (round to its way and raised to the angle first)
      if (u.turnT > 0 || u.headF !== u.facing || Math.abs(u.el - u.launchA) > 0.02) return;
      PW.jets.leavePod(world, j, tubeOf(u), u.launchA, u.headF);
      return;
    }
    if ((u.launchHold += dt) >= DRONE_HOLD) u.launching = null;
  }
  // ---- What a round costs (N114, the user's: firing a rocket or an interceptor costs its side HM,
  // and with none an interceptor does not go) ----------------------------------------------------------
  // (the side's stock - world.stock - in a match on this world; out of one - the physics sandbox, the
  // labs, where the towns keep stocks of their own - firing is free)
  const PRICE = { rocket: 2, interceptor: 4, patriot: 12 };
  function purse(world, side) {
    const m = PW.game && PW.game.current && PW.game.current();
    return (m && m.world === world && side && world.stock && world.stock[side]) || null;
  }
  function affordable(world, side, kind) { const p = purse(world, side); return p ? Math.floor((p.hm || 0) / PRICE[kind]) : Infinity; }
  const canPay = (world, side, kind) => affordable(world, side, kind) >= 1;
  function pay(world, side, kind) {
    const p = purse(world, side);
    if (!p) return true;
    if ((p.hm || 0) < PRICE[kind]) return false;
    p.hm -= PRICE[kind];
    stats.hmSpent = (stats.hmSpent || 0) + PRICE[kind];
    return true;
  }

  // ---- A battery's watch ------------------------------------------------------------------------------------
  // (where and when a round in flight will come down, flown out under gravity and drag: { x, t } -
  // t the seconds till then - or null; an unguided rocket's, its motor burnt out, worked out once)
  function impactAt(world, s) {
    if (s.impact && s.impact.age !== undefined) return s.impact.x === null ? null : { x: s.impact.x, t: s.impact.t - (s.age - s.impact.age) };
    const K = s.k, g = G(), dt = 1 / 20;
    let x = s.x, y = s.y, vx = s.vx, vy = s.vy, fuel = s.fuel || 0, at = null;
    for (let t = 0; t < 30; t += dt) {
      if (fuel > 0) fuel -= dt; else vy += g * dt;
      const keep = 1 - K.drag * dt;
      vx *= keep; vy *= keep;
      x += vx * dt; y += vy * dt;
      const xi = Math.floor(x);
      if (xi < 0 || xi >= world.width) break;
      if (vy > 0 && y >= world.groundTop[xi]) { at = { x, t: t + dt }; break; }
    }
    if (!K.turn && !(s.fuel > 0)) s.impact = { x: at ? at.x : null, t: at ? at.t : 0, age: s.age };
    return at;
  }
  function impactOf(world, s) { const at = impactAt(world, s); return at ? at.x : null; }
  // (is ground at x its side's - a building of its side, or its units, within COVER of it?)
  function ownGround(world, side, x) {
    for (const b of world.buildings || []) {
      const s = b.faction || b.side;
      if (s !== side || !b.body) continue;
      if (x >= b.body.left - COVER && x <= b.body.right + COVER) return true;
    }
    for (const list of [world.tanks, world.troops, world.mechs, world.defence]) for (const v of list || []) if (!v.dead && v.side === side && Math.abs(v.x - x) < COVER) return true;
    return false;
  }
  // (u.engaged: the threats it has fired at, and how many interceptors at each - two, a moment
  // apart, the second in case the first's burst does not destroy it)
  function watch(world, u, dt) {
    const T = TYPES[u.type];
    if (u.gap > 0) u.gap -= dt;
    if ((u.clearT = (u.clearT || 0) - dt) <= 0) {
      u.clearT = CLEAR_EVERY;
      u.blocked = !skyClear(world, u, 1) && !skyClear(world, u, -1);
    }
    if (u.hold || u.blocked || u.ammo <= 0 || ++u.look < LOOK_EVERY) return;
    u.look = 0;
    // (threats it has fired at that are gone: forgotten)
    for (const s of u.engaged.keys()) if (s.done || s.dead) u.engaged.delete(s);
    const threats = [];
    for (const s of world.shots || []) {
      if (s.done || !s.k.blast || !(s.kind === 'rocket' || s.kind === 'missile') || !s.side || s.side === u.side) continue;
      if (Math.hypot(s.x - u.x, s.y - u.y) > T.range) continue;
      if ((u.engaged.get(s) || 0) >= T.perThreat) continue;
      let soon = Math.hypot(s.x - u.x, s.y - u.y) / 1000;
      if (T.protect) {
        // (only what comes down on its side's ground - and that once it is on its way down to it)
        const at = impactAt(world, s);
        if (at === null || !ownGround(world, u.side, at.x)) { if (!s.letFall) { s.letFall = true; stats.ignored += 1; } continue; }
        if (at.t > ENGAGE || at.t < ENGAGE_LAST) continue;
        soon = at.t;
      }
      threats.push({ s, soon });
    }
    if (T.jets) for (const j of world.jets || []) {
      if (j.dead || j.down || j.pod || !j.side || j.side === u.side || Math.hypot(j.x - u.x, j.y - u.y) > T.range) continue;
      if ((u.engaged.get(j) || 0) < T.perThreat) threats.push({ s: j, soon: Math.hypot(j.x - u.x, j.y - u.y) / 1000 });
    }
    // (what will strike soonest first, one at a time, its interceptors a moment apart)
    threats.sort((a, b) => a.soon - b.soon);
    for (const { s } of threats) {
      if (u.gap > 0 || u.ammo <= 0) break;
      // (its launcher turned to the threat's side - or, the way up shut that side, the other: on its
      // turntable, firing once round)
      const f = Math.sign(s.x - u.x) || u.facing, want = skyClear(world, u, f) ? f : -f;
      if (want !== u.headF) { u.facing = want; break; }
      if (u.turnT > 0) break;
      // (N114: each interceptor its side's HM - none to pay, none goes)
      if (!pay(world, u.side, T.kind)) { stats.noHm = (stats.noHm || 0) + 1; break; }
      const t = tubeOf(u);
      PW.shots.fire(world, { kind: T.kind, x: t.x, y: t.y, dx: Math.cos(t.up) * u.headF, dy: -Math.sin(t.up), side: u.side, from: u, target: s });
      u.engaged.set(s, (u.engaged.get(s) || 0) + 1);
      // (the gap counted from when it was due - its looks at the sky are LOOK_EVERY ticks apart)
      u.ammo -= 1; u.gap = Math.max(-LOOK_EVERY / 60, u.gap) + LAUNCH_GAP;
      if (u.ammo <= 0) u.reloadT = T.reload;
      stats.launched += 1;
    }
  }

  // ---- Struck ---------------------------------------------------------------------------------------------
  const DAMAGE = { bullet: 2, cannon: 12, he: 70, ap: 70, missile: 100, rocket: 60, interceptor: 30, patriot: 100 };
  function hurt(world, u, amount, cause) {
    if (u.dead || !(amount > 0)) return;
    u.hp -= amount; u.hurtBy = cause;
    if (u.hp > 0) return;
    u.dead = true;
    stats.destroyed += 1;
    if (held === u) held = null;
    // (its ammunition goes up - a turret's a little, where it sits, its head falling, burnt; a
    // launcher's or a battery's harder, burning on where it stood)
    if (u.type === 'turret') {
      const p = u.pivot || { x: u.x, y: u.y - 4 };
      if (PW.explode) PW.explode(world, world.particles, { x: p.x, y: p.y, radius: 5, power: 0.4 });
      if (u.ras) fallOff(world, u, true);
      return;
    }
    if (PW.explode) PW.explode(world, world.particles, { x: u.x, y: u.y - 14, radius: 10, power: 0.8 });
    if (PW.addSmoulder) PW.addSmoulder(world, u.x, u.y, 30, 60);
  }
  function blast(world, cx, cy, r, power = 1) {
    for (const u of world.defence || []) {
      if (u.dead) continue;
      const c = u.type === 'turret' && u.pivot ? u.pivot : { x: u.x, y: u.y - 14 };
      const d = Math.max(0, Math.hypot(c.x - cx, c.y - cy) - TYPES[u.type].length / 2), reach = r * 1.6 + 6;
      if (d < reach) hurt(world, u, 80 * power * (1 - d / reach) ** 2, 'blast');
    }
  }
  const boxOf = (u) => (u.ras ? { x0: u.ras.x0, x1: u.ras.x0 + u.ras.w, y0: u.ras.y0, y1: u.ras.y0 + u.ras.h }
    : { x0: u.x - TYPES[u.type].length / 2, x1: u.x + TYPES[u.type].length / 2, y0: u.y - 30, y1: u.y });
  const target = {
    hit(world, s, x0, y0, x1, y1) {
      let best = null;
      for (const u of world.defence || []) {
        if (u.dead || u === s.from) continue;
        // (its own pixels as drawn, along the round's way)
        if (u.ras) {
          const b = u.ras;
          if (Math.max(x0, x1) < b.x0 || Math.min(x0, x1) > b.x0 + b.w || Math.max(y0, y1) < b.y0 || Math.min(y0, y1) > b.y0 + b.h) continue;
          const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
          for (let q = 0; q <= n; q += 1) {
            const f = q / n;
            if (best && f >= best.f) break;
            if (turretPixel(u, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f)) { best = { f, x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, ref: u, part: 1 }; break; }
          }
          continue;
        }
        const b = boxOf(u);
        let f0 = 0, f1 = 1;
        for (const [p0, d, lo, hi] of [[x0, x1 - x0, b.x0, b.x1], [y0, y1 - y0, b.y0, b.y1]]) {
          if (Math.abs(d) < 1e-9) { if (p0 < lo || p0 > hi) { f0 = 2; break; } continue; }
          let a = (lo - p0) / d, c = (hi - p0) / d;
          if (a > c) [a, c] = [c, a];
          f0 = Math.max(f0, a); f1 = Math.min(f1, c);
          if (f0 > f1) break;
        }
        if (f0 > f1 || f0 > 1) continue;
        if (!best || f0 < best.f) best = { f: f0, x: x0 + (x1 - x0) * f0, y: y0 + (y1 - y0) * f0, ref: u, part: 1 };
      }
      return best;
    },
    strike(world, u, s) { hurt(world, u, DAMAGE[s.kind] ?? 2, s.kind); return true; },
  };

  // ---- The step ------------------------------------------------------------------------------------------------
  function step(world, dt) {
    if (PW.shots && PW.shots.addTarget && !target.added) { PW.shots.addTarget(target); target.added = true; }
    const list = world.defence;
    if (!list || !list.length || !PW.shots) return;
    current = world;
    for (const u of list) {
      if (u.dead) continue;
      // (still on its base? - looked at every few ticks, put out of action or not)
      if (((world.tick || 0) + u.seed) % 10 === 0 && !onBase(world, u)) { fallOff(world, u); continue; }
      // (put out of action a while - a hack: see PW.units.disable - a turret's gun drooping, a
      // launcher's salvo called off)
      if ((u.disabledUntil || 0) > (world.tick || 0)) {
        if (u.type === 'turret') { u.burst = 0; u.foe = null; u.e = Math.max(MOUNTS[u.face].lo, u.e - SLEW * 0.3 * dt); turretPose(u); }
        else u.salvo = 0;
        continue;
      }
      if (u.type === 'turret') { turretStep(world, u, dt); continue; }
      artStep(world, u, dt);
      if (u.launching) stepLaunch(world, u, dt);
      if (u.salvo > 0) stepSalvo(world, u, dt);
      if (u.type !== 'launcher') watch(world, u, dt);
    }
    for (let q = list.length - 1; q >= 0; q -= 1) if (list[q].dead) list.splice(q, 1);
  }
  // ---- The artillery on its base (N114, the user's: missile launchers and interceptors are stationary
  // artillery, built on a flat roof or flat ground - never inside a building or a tunnel - like the
  // turret: WGM lays the base, a steel plate, and seats it on it) ------------------------------------
  // Each a turntable on the plate, a cradle on it, and its box of tubes on the cradle's trunnion,
  // raised by a ram (the user's Iron Dome and Patriot refs, the MLRS's pod):
  //   launcher - a pod of 12 rocket tubes in two rows, stowed low, raised to its salvo's high arc;
  //   dome - an Iron Dome launcher's box of 20 interceptors, raised near upright, its radar beside it;
  //   patriot - a Patriot launcher's four canisters, two by two, raised steep.
  // It turns on its turntable to face a mark's side (ART_TURN, the box seen shortening as it comes
  // round) and raises or lowers its box at `slew`; it fires once round and laid. In cells: ring - the
  // turntable's width and height; post - the cradle's height to its trunnion over the ring; trunnion
  // - how far behind its middle that is; pod - the box's length and depth; stow - the box's rest
  // angle (a Dome's and a Patriot's: their fixed firing angle).
  const BUILD = {
    launcher: { ring: [30, 4], post: 7, trunnion: -14, pod: [58, 16], stow: 0.17, slew: 0.9, seams: 'rows' },
    dome: { ring: [22, 3], post: 5, trunnion: -6, pod: [40, 15], stow: 1.4, slew: 0.9, seams: 'ribs', radar: true },
    patriot: { ring: [30, 4], post: 7, trunnion: -16, pod: [62, 18], stow: 1.2, slew: 0.9, seams: 'cans' },
  };
  const ART_TURN = 0.6;         // s its turntable takes to turn it round to the other side
  const GROUND_GAP = 8;         // cells under its turntable the ground may lie, set down with no plate
  function artStep(world, u, dt) {
    const B = BUILD[u.type];
    // (spent, its crew load it again)
    if (u.reloadT > 0 && (u.reloadT -= dt) <= 0) { u.reloadT = 0; u.ammo = TYPES[u.type].ammo; }
    // (round on its turntable to the side asked - half way round, it faces it)
    if (u.headF !== u.facing && !(u.turnT > 0)) u.turnT = ART_TURN;
    if (u.turnT > 0) { u.turnT = Math.max(0, u.turnT - dt); if (u.turnT <= ART_TURN / 2) u.headF = u.facing; }
    // (its box raised to the laid angle for a salvo, or to a drone's - N126 - else at rest)
    const want = u.launching ? u.launchA : u.type === 'launcher' && u.salvo > 0 && Number.isFinite(u.laid) ? u.laid : B.stow;
    if (!u.turnT) { const d = want - u.el, s = B.slew * dt; u.el += Math.abs(d) <= s ? d : Math.sign(d) * s; }
    artPose(u);
  }
  // Its drawing in its pose - cell by cell, kept until the pose changes (turretPixel reads it, the
  // rounds strike it by it, it falls as it).
  function artPose(u) {
    const B = BUILD[u.type], [L, Th] = B.pod, [rw, rh] = B.ring, ps = B.trunnion, ph = rh + B.post;
    const k = u.turnT > 0 ? Math.max(0.3, Math.abs(Math.cos(Math.PI * (1 - u.turnT / ART_TURN)))) : 1;
    const f = u.headF, a = u.el, c = Math.cos(a), s = Math.sin(a);
    u.pivot = { x: u.x + ps * f * k, y: u.y - ph };
    const key = `${u.x},${u.y},${f},${Math.round(a * 90)},${Math.round(k * 20)},${u.style}`;
    if (u.ras && u.ras.key === key) return;
    const reach = Math.ceil(Math.abs(ps) + L + Th + 2), up = Math.ceil(ph + L + Th + 2);
    const x0 = u.x - reach, y0 = u.y - up, w = 2 * reach + 1, h = up + 1, px32 = new Uint32Array(w * h);
    const st = STYLES[u.style] || STYLES.modern;
    const rgb = (q, m = 1) => PW.abgr(Math.min(255, q[0] * m) | 0, Math.min(255, q[1] * m) | 0, Math.min(255, q[2] * m) | 0);
    const C = { body: rgb(st.body), light: rgb(st.light), dark: rgb(st.dark), cap: rgb(st.dark, 0.8), seam: rgb(st.dark, 0.9),
      steel: PW.abgr(60, 62, 64), ring: PW.abgr(70, 72, 70), ringTop: PW.abgr(96, 98, 94), panel: rgb(st.light, 0.95), grid: rgb(st.dark, 0.75) };
    // (the ram, from the ring ahead of the cradle to the box's underside a third along it)
    const ax = ps + 18, ay = rh, bx = ps + L * 0.3 * c, by = ph + L * 0.3 * s, lx = bx - ax, ly = by - ay, ll = lx * lx + ly * ly || 1;
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
      const S = (x0 + i - u.x) * f / k, H = u.y - (y0 + j) + 0.5;
      let col = 0;
      const al = (S - ps) * c + (H - ph) * s, ac = -(S - ps) * s + (H - ph) * c;
      if (al >= 0 && al <= L && ac >= 0 && ac <= Th) {
        // its box of tubes: lit along its top, dark under it and at its ends; its seams
        col = ac > Th - 1.6 ? C.light : ac < 1.4 ? C.dark : al < 2 || al > L - 2.5 ? C.cap : C.body;
        if (col === C.body) {
          if (B.seams === 'rows' && Math.abs(ac - Th / 2) < 0.55) col = C.seam;
          else if (B.seams === 'cans' && (Math.abs(ac - Th / 2) < 0.55 || Math.abs(al - L / 2) < 0.55)) col = C.seam;
          else if (B.seams === 'ribs' && al % 6 < 0.9) col = C.seam;
          else if (B.seams !== 'ribs' && al > L - 10 && al < L - 8) col = C.light;
        }
      } else {
        const t = Math.max(0, Math.min(1, ((S - ax) * lx + (H - ay) * ly) / ll)), dx = S - ax - lx * t, dy = H - ay - ly * t;
        if (dx * dx + dy * dy < 1.2) col = C.steel;                                                        // its ram
        else if (S >= ps - 3 && S <= ps + 6 && H >= rh && H <= ph + 1) col = C.dark;                        // its cradle
        else if (B.radar && S >= rw / 2 - 6 && S <= rw / 2 - 4 && H >= rh && H < rh + 14) col = C.steel;    // the radar's mast
        else if (B.radar && S >= rw / 2 - 13 && S <= rw / 2 + 3 && H >= rh + 14 && H <= rh + 30) {
          col = (H - rh) % 4 < 0.8 || (S - rw / 2 + 16) % 4 < 0.8 ? C.grid : C.panel;                       // ... its face
        } else if (Math.abs(S) <= rw / 2 && H >= 0 && H <= rh) col = H > rh - 1 ? C.ringTop : C.ring;     // its turntable
      }
      px32[j * w + i] = col;
    }
    u.ras = { key, x0, y0, w, h, px: px32 };
  }

  // ---- Turrets (N103, the user's: an autocannon turret, its head after the RCWS and armoured-turret
  // refs, sized between a trooper and a tank) ---------------------------------------------------------
  // Its mount: (x, y), the cell of its base's face the head's ring sits on, and `normal`, the way that
  // face looks out ([0, -1] a roof, the ground or a room's floor; [±1, 0] a wall; [0, 1] a ceiling);
  // its base (WGM's, stamped into the building or the ground) base: { x0, x1, y0, y1 }. The head
  // stands out along the normal; its gun swings over what the face opens on: on a floor from a little
  // below level on either side up to near overhead - the head turning round over TURN_HEAD to change
  // sides; on a wall out from it, as far as 80 degrees up or down; under a ceiling, a floor's turned
  // over. It looks about for the hostile units it sees (PW.units' sight - a man crouched creeping up,
  // or in a secret bore, as any sentry sees him), the nearest - men before mechs and jets, armour
  // last (its rounds do little to a tank) - lays its gun on it at its slew, leading it, and fires its
  // bursts once laid; never with a unit of its own side in the line of fire. Held (u.hold - a quiet
  // world, a battery held by hand) it neither looks nor fires. Its base broken away from under it, it
  // comes off and falls, a wreck; destroyed, its rounds go up a little and its wreck falls.
  const D2R = Math.PI / 180;
  const MOUNTS = {
    floor: { lo: -10 * D2R, hi: 85 * D2R, turns: true },
    ceiling: { lo: -85 * D2R, hi: 10 * D2R, turns: true },
    wall: { lo: -80 * D2R, hi: 80 * D2R, turns: false },
  };
  const SLEW = 2.2;             // rad/s its gun swings at
  const TURN_HEAD = 0.5;        // s its head turns round to the other side (a floor's, a ceiling's)
  const LAID = 0.035;           // rad: laid on its mark - it fires
  const BARREL = 18;            // cells of autocannon barrel from its trunnion
  const REACH_HEAD = 36;        // cells round its mount the head and gun can reach
  const WEIGHT = { trooper: 1, mech: 1.4, jet: 1.6, defence: 1.8, tank: 3 };   // (how far off a kind of target counts as)
  const BASE_HOLDS = 0.4;       // share of its base's cells that must stand for it to stay on
  function mountTurret(u, spec) {
    const n = spec.normal || [0, -1];
    u.N = [Math.sign(n[0]) * (Math.abs(n[0]) >= Math.abs(n[1]) ? 1 : 0), Math.sign(n[1]) * (Math.abs(n[1]) > Math.abs(n[0]) ? 1 : 0)];
    u.face = u.N[1] < 0 ? 'floor' : u.N[1] > 0 ? 'ceiling' : 'wall';
    u.headF = u.face === 'wall' ? u.N[0] : (spec.facing || 1) < 0 ? -1 : 1;
    u.e = u.face === 'ceiling' ? -20 * D2R : u.face === 'floor' ? 5 * D2R : 0;
    u.turnT = 0; u.base = spec.base || null; u.foe = null; u.reloadT = 0; u.manualT = 0;
    // (no base given - set down by hand, or on the old devices: its mount the face it is on, found
    // a few cells back from where it was put if that was open air)
    if (!u.base && current) {
      const w = current, open = (x, y) => x < 0 || y < 0 || x >= w.width || y >= w.height || PW.mat.phase[w.mat[y * w.width + x] & ID_MASK] !== PW.PHASE.SOLID;
      for (let k = 0; k < 4 && open(u.x, u.y); k += 1) { u.x -= u.N[0]; u.y -= u.N[1]; }
    }
    // (it sees both ways from its head - its arc is its mount's: see aimable)
    u.facing = 0;
  }
  // (the head's frame: `up` out of its mount's face, `side` the way it faces along it)
  function frameOf(u) {
    if (u.face === 'wall') return { U: [u.N[0], 0], S: [0, -1] };
    return { U: [0, u.N[1]], S: [u.headF, 0] };
  }
  // (a world angle for the gun - radians, up from rightwards - and back: which side it faces, its
  // elevation from level that way)
  const angleOf = (f, e) => (f > 0 ? e : Math.PI - e);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function aimable(u, a) {
    const M = MOUNTS[u.face];
    const f = u.face === 'wall' ? u.headF : Math.abs(Math.cos(a)) < 0.05 ? u.headF : Math.cos(a) > 0 ? 1 : -1;
    const e = wrap(f > 0 ? a : Math.PI - a);
    return e >= M.lo && e <= M.hi ? { f, e } : null;
  }
  // Its pose: where its trunnion, its sensor and its muzzle are, and its drawing (laid over
  // REACH_HEAD round its mount, kept until the pose changes).
  function turretPose(u) {
    const { U, S } = frameOf(u), k = u.turnT > 0 ? Math.max(0.3, Math.abs(Math.cos(Math.PI * (1 - u.turnT / TURN_HEAD)))) : 1;
    const at = (s, h) => [u.x + 0.5 + s * k * S[0] + h * U[0], u.y + 0.5 + s * k * S[1] + h * U[1]];
    const [ts, th] = u.face === 'wall' ? [0, 17] : [4, 13];
    const [px, py] = at(ts, th), a = angleOf(u.headF, u.e), dx = Math.cos(a), dy = -Math.sin(a);
    u.pivot = { x: px, y: py }; u.eye = { x: at(-6, 21)[0], y: at(-6, 21)[1] };
    u.muzzle = { x: px + dx * BARREL, y: py + dy * BARREL, dx, dy };
    u.aimA = a;
    const key = `${u.x},${u.y},${u.headF},${Math.round(u.e * 60)},${Math.round(k * 20)},${u.off ? 1 : 0},${u.style}`;
    if (u.ras && u.ras.key === key) return;
    const R = REACH_HEAD, w = 2 * R + 1, px32 = new Uint32Array(w * w), st = STYLES[u.style] || STYLES.modern;
    const rgb = (c, f = 1) => PW.abgr(Math.min(255, c[0] * f) | 0, Math.min(255, c[1] * f) | 0, Math.min(255, c[2] * f) | 0);
    const C = { body: rgb(st.body), light: rgb(st.light), dark: rgb(st.dark), plate: rgb(st.dark, 0.85), steel: PW.abgr(58, 60, 62), gun: PW.abgr(46, 48, 50),
      brake: PW.abgr(30, 32, 34), lens: PW.abgr(36, 70, 84), glint: PW.abgr(150, 210, 220), ring: PW.abgr(70, 72, 70) };
    for (let j = 0; j < w; j += 1) for (let i = 0; i < w; i += 1) {
      const rx = i - R, ry = j - R, wx = u.x + rx + 0.5, wy = u.y + ry + 0.5;
      // (the head's own cells, in its frame: s along it, h out of its mount)
      const s = (rx * S[0] + ry * S[1]) / k, h = rx * U[0] + ry * U[1];
      let c = 0;
      // the barrel and its muzzle brake, the cradle at its trunnion
      const qx = wx - px, qy = wy - py, along = qx * dx + qy * dy, across = Math.abs(-qx * dy + qy * dx);
      if (along >= 0 && along <= BARREL && across <= (along > BARREL - 3 ? 1.6 : 1.05)) c = along > BARREL - 3 ? C.brake : C.gun;
      else if (qx * qx + qy * qy <= 7) c = C.steel;
      else if (h >= 1 && h <= 4 && Math.abs(s) <= 6) c = C.ring;                                  // its ring
      else if (h > 4 && h <= 18 && s >= -11 && s <= 11 && !(h > 14 && Math.abs(s) > 11 - (h - 14))) {
        // its armoured body: the plate over its front, the ammunition box at its side, lit along its top
        if (s >= 9) c = C.plate;
        else if (s <= -6 && h >= 6 && h <= 12) c = C.dark;
        else c = h > 16 || (h > 14 && Math.abs(s) > 11 - (h - 14) - 1.5) ? C.light : C.body;
      } else if (s >= -10 && s <= -3 && h > 18 && h <= 24) {
        // its sensor box on top, the lens looking the way it faces
        c = s >= -4 && h >= 20 && h <= 22 ? (h === 20 ? C.glint : C.lens) : h > 23 ? C.light : C.body;
      }
      px32[j * w + i] = c;
    }
    u.ras = { key, x0: u.x - R, y0: u.y - R, w, h: w, px: px32 };
  }
  // (what of it is at world point (x, y): its colour as drawn, or 0)
  function turretPixel(u, x, y) {
    const r = u.ras;
    if (!r) return 0;
    const i = Math.floor(x) - r.x0, j = Math.floor(y) - r.y0;
    return i < 0 || j < 0 || i >= r.w || j >= r.h ? 0 : r.px[j * r.w + i];
  }
  // (still on its base: enough of the base's cells standing - or, with no base given, of the face
  // under its ring)
  function onBase(world, u) {
    const solid = (x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height && PW.mat.phase[world.mat[y * world.width + x] & ID_MASK] === PW.PHASE.SOLID;
    let n = 0, all = 0;
    if (u.base) {
      const b = u.base, y0 = b.y0 ?? b.y, y1 = b.y1 ?? (u.face === 'wall' ? b.y + 6 : b.y), ya = u.face === 'wall' && b.y0 === undefined ? b.y - 6 : y0;
      for (let y = ya; y <= y1; y += 1) for (let x = b.x0; x <= b.x1; x += 1) { all += 1; if (solid(x, y)) n += 1; }
    } else if (u.type !== 'turret') {
      // (artillery set down on the ground, with no plate: the ground under its turntable - on a slope,
      // a few cells down at its low side; blown away from under it, it falls)
      const half = BUILD[u.type].ring[0] >> 1;
      for (let s = -half; s <= half; s += 1) {
        all += 1;
        for (let d = 1; d <= GROUND_GAP; d += 1) if (blocks(world, u.x + s, u.y + d)) { n += 1; break; }
      }
    } else {
      const { S } = frameOf(u);
      for (let s = -5; s <= 5; s += 1) { all += 1; if (solid(Math.round(u.x + s * Math.abs(S[0])), Math.round(u.y + s * Math.abs(S[1])))) n += 1; }
    }
    return n >= all * BASE_HOLDS;
  }
  // (come off its base: its head falls, a wreck)
  function fallOff(world, u, burnt = false) {
    u.dead = true;
    if (held === u) held = null;
    const r = u.ras, fr = world.fragments;
    if (!r || !fr) return;
    const xs = [], ys = [], cs = [];
    for (let j = 0; j < r.h; j += 1) for (let i = 0; i < r.w; i += 1) {
      const c = r.px[j * r.w + i], x = r.x0 + i, y = r.y0 + j;
      if (!c || x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1 || !PW.mat.open[world.mat[y * world.width + x] & ID_MASK]) continue;
      const k = burnt ? 0.4 : 1;
      xs.push(x); ys.push(y); cs.push(burnt ? PW.abgr((c & 255) * k | 0, (c >>> 8 & 255) * k | 0, (c >>> 16 & 255) * k | 0) : c);
    }
    if (xs.length) fr.spawn({ data: { x: Int32Array.from(xs), y: Int32Array.from(ys), color: Uint32Array.from(cs), byte: new Uint8Array(xs.length).fill(M.STEEL), solid: new Uint8Array(xs.length).fill(1) },
      vx: u.N ? u.N[0] * 20 : 0, vy: -10, omega: (PW.hash2(u.x, u.y) & 1 ? 1 : -1) * 0.6, wreck: true });
    stats.cameOff = (stats.cameOff || 0) + (burnt ? 0 : 1);
  }
  // (what it looks for: the hostile unit it sees that counts nearest - see WEIGHT - its gun can be
  // laid on)
  function pickFoe(world, u) {
    if (!PW.units) return null;
    let best = null, bs = Infinity;
    const reach = PW.units.SIGHT.turret.reach;
    for (const b of PW.units.all(world)) {
      if (!b.side || b.side === u.side || b === u) continue;
      const p = PW.units.body(b), d = Math.hypot(p.x - u.pivot.x, p.y - u.pivot.y);
      if (d > reach) continue;
      const score = d * (WEIGHT[b.kind] || 1.5);
      if (score >= bs || !aimable(u, Math.atan2(-(p.y - u.pivot.y), p.x - u.pivot.x)) || !PW.units.sees(world, u, b)) continue;
      bs = score; best = b;
    }
    return best;
  }
  // (a unit of its own side on the line of fire to (x, y), short of it)
  function friendInLine(world, u, x, y) {
    const m = u.muzzle, lx = x - m.x, ly = y - m.y, L = Math.hypot(lx, ly) || 1;
    for (const v of PW.units ? PW.units.all(world) : []) {
      if (v === u || !v.side || v.side !== u.side) continue;
      const p = PW.units.body(v), t = ((p.x - m.x) * lx + (p.y - m.y) * ly) / L;
      if (t <= 0 || t >= L - 4) continue;
      if (Math.abs(-(p.x - m.x) * ly + (p.y - m.y) * lx) / L < (v.kind === 'tank' ? 18 : 10)) return true;
    }
    return false;
  }
  function turretStep(world, u, dt) {
    const T = TYPES.turret;
    // its head turning round to the other side (half way round, it faces it)
    if (u.turnT > 0) { u.turnT = Math.max(0, u.turnT - dt); if (u.turnT <= TURN_HEAD / 2 && !u.turned) { u.headF = -u.headF; u.turned = true; } if (!u.turnT) u.turned = false; }
    if (u.reloadT > 0 && (u.reloadT -= dt) <= 0) u.ammo = T.ammo;
    if (u.manualT > 0) u.manualT -= dt;
    if (u.rest > 0) u.rest -= dt;
    // (by hand: a spot clicked, till its burst is laid on it - and that burst, all of it, held or not)
    const byHand = u.manualT > 0 || (u.handBurst && u.burst > 0);
    if (u.hold && !byHand) { u.foe = null; u.burst = 0; u.handBurst = false; turretPose(u); return; }
    // what it is on: looked for now and then (a spot clicked by hand, kept a while)
    if (++u.look >= LOOK_EVERY) {
      u.look = 0;
      if (!(u.foe && u.foe.spot && byHand)) u.foe = pickFoe(world, u);
    }
    const f = u.foe && !u.foe.dead ? u.foe : null;
    let laid = false, mark = null;
    if (f) {
      // (where to lay on: its body, led by the round's time of flight)
      const p = f.spot ? f : PW.units.body(f), sp = PW.shots.KINDS[T.kind].speed;
      const tau = Math.hypot(p.x - u.pivot.x, p.y - u.pivot.y) / sp;
      const vx = f.vx ?? (f.kind === 'tank' ? (f.v || 0) * Math.cos(f.angle || 0) : 0), vy = f.vy || 0;
      mark = { x: p.x + vx * tau, y: p.y + vy * tau };
      const want = aimable(u, Math.atan2(-(mark.y - u.pivot.y), mark.x - u.pivot.x));
      if (!want) u.foe = null;
      else if (want.f !== u.headF) { if (!u.turnT && MOUNTS[u.face].turns) u.turnT = TURN_HEAD; }
      else if (!u.turnT) {
        const d = want.e - u.e, s = SLEW * dt;
        u.e += Math.abs(d) <= s ? d : Math.sign(d) * s;
        laid = Math.abs(want.e - u.e) < LAID;
      }
    }
    turretPose(u);
    // Firing: a burst, laid, loaded, rested, nothing of its own in the way - each round along its gun
    if (u.burst > 0) {
      u.burstT -= dt;
      while (u.burst > 0 && u.burstT <= 0) {
        if (u.ammo <= 0 || u.turnT) { u.burst = 0; break; }
        const m = u.muzzle;
        PW.shots.fire(world, { kind: T.kind, x: m.x, y: m.y, dx: m.dx, dy: m.dy, side: u.side, from: u, spread: 0.015 });
        if (PW.shots.report) PW.shots.report(world, m.x, m.y, m.dx, m.dy, 1);
        u.burst -= 1; u.ammo -= 1; u.burstT += T.rof;
        stats.turretRounds = (stats.turretRounds || 0) + 1;
      }
      if (u.ammo <= 0 && !(u.reloadT > 0)) u.reloadT = T.reload;
      // (a click's burst gone: one burst to a click)
      if (u.burst <= 0 && u.handBurst) { u.handBurst = false; u.manualT = 0; }
    } else if (laid && mark && u.rest <= 0 && u.ammo > 0 && !friendInLine(world, u, mark.x, mark.y)) {
      u.burst = T.burst; u.burstT = 0; u.rest = T.rest;
      u.handBurst = !!(u.foe && u.foe.spot);
    }
  }

  // ---- Drawn: each as its pose's drawing, a cell to a pixel of its own (see turretPose, artPose) -----------
  function draw(renderer) {
    const world = renderer.world || current, list = world && world.defence;
    if (!list || !list.length) return;
    for (const u of list) if (!u.dead && u.ras) drawRaster(renderer, u);
    drawAim(renderer, world);
  }
  // ---- Missile aiming (N126, the user's): a launcher in hand, the cursor over the world - a line from
  // the cursor down to the surface under it (a roof, the ground: where its salvo would come down),
  // twisting like a spiral, its orange and red bands running down it; at the surface a crosshair
  // turning, swelling and shrinking. Drawn in the view's own pixels, the same at every zoom. (The
  // cursor: WGM's pw-app hands it on each frame - see pointer.)
  let pointerAt = null;
  function pointer(world, x, y) { pointerAt = x == null || !Number.isFinite(x) ? null : { x, y }; }
  // (the surface under (x, y): the top of the first thing below it that bears - or, the point inside
  // something, the top of that)
  function surfaceUnder(world, x, y) {
    const xi = Math.max(0, Math.min(world.width - 1, Math.round(x)));
    let yi = Math.max(0, Math.min(world.height - 2, Math.round(y)));
    if (blocks(world, xi, yi)) { while (yi > 0 && blocks(world, xi, yi - 1)) yi -= 1; return yi; }
    while (yi < world.height - 1 && !blocks(world, xi, yi + 1)) yi += 1;
    return yi + 1;
  }
  const AIM_ORANGE = 'rgb(255,140,20)', AIM_RED = 'rgb(230,30,20)';
  function drawAim(renderer, world) {
    const u = held;
    if (!u || u.dead || u.type !== 'launcher' || !pointerAt) return;
    const { ctx, camera } = renderer, z = camera.zoom, t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    const sx = Math.round((pointerAt.x - camera.x) * z), top = Math.round((pointerAt.y - camera.y) * z);
    const ground = surfaceUnder(world, pointerAt.x, pointerAt.y), bottom = Math.round((ground - camera.y) * z);
    ctx.save();
    // (the line: two strands round it, out of step, each banded orange and red, the bands running down)
    for (let py = top; py < bottom; py += 2) {
      for (const strand of [0, Math.PI]) {
        const w = Math.sin(py * 0.12 - t * 9 + strand), band = Math.floor(py / 7 - t * 14 + (strand ? 0.5 : 0));
        ctx.fillStyle = (band & 1) ? AIM_ORANGE : AIM_RED;
        ctx.globalAlpha = 0.55 + 0.45 * Math.cos(py * 0.12 - t * 9 + strand) ** 2;
        ctx.fillRect(sx + Math.round(w * 3) - 1, py, 2, 2);
      }
    }
    // (the crosshair at the surface: its ring of four arcs and its four ticks, turning, swelling and
    // shrinking)
    const r = 10 + 4 * Math.sin(t * 5), a0 = t * 2.4;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    for (let q = 0; q < 4; q += 1) {
      const a = a0 + q * Math.PI / 2;
      ctx.strokeStyle = q & 1 ? AIM_ORANGE : AIM_RED;
      ctx.beginPath(); ctx.arc(sx, bottom, r, a + 0.25, a + Math.PI / 2 - 0.25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * (r - 5), bottom + Math.sin(a) * (r - 5)); ctx.lineTo(sx + Math.cos(a) * (r + 6), bottom + Math.sin(a) * (r + 6)); ctx.stroke();
    }
    ctx.fillStyle = AIM_RED; ctx.fillRect(sx - 1, bottom - 1, 3, 3);
    ctx.restore();
  }
  let tCanvas = null, tCtx = null, tImage = null, tPx = null;
  function drawRaster(renderer, u) {
    const r = u.ras;
    const { ctx, camera, view } = renderer, z = camera.zoom, skip = Math.max(1, Math.floor(1 / z));
    const vx1 = camera.x + view.width / z, vy1 = camera.y + view.height / z;
    if (r.x0 + r.w < camera.x || r.x0 > vx1 || r.y0 + r.h < camera.y || r.y0 > vy1) return;
    const nw = Math.ceil(r.w / skip), nh = Math.ceil(r.h / skip);
    if (!tCanvas || tCanvas.width < nw || tCanvas.height < nh) {
      tCanvas = document.createElement('canvas'); tCanvas.width = Math.max(200, nw, tCanvas ? tCanvas.width : 0); tCanvas.height = Math.max(120, nh, tCanvas ? tCanvas.height : 0);
      tCtx = tCanvas.getContext('2d'); tImage = tCtx.createImageData(tCanvas.width, tCanvas.height); tPx = new Uint32Array(tImage.data.buffer);
    }
    const stride = tCanvas.width;
    for (let j = 0; j < nh; j += 1) for (let i = 0; i < nw; i += 1) tPx[j * stride + i] = r.px[(j * skip) * r.w + i * skip];
    tCtx.putImageData(tImage, 0, 0, 0, 0, nw, nh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tCanvas, 0, 0, nw, nh, Math.round((r.x0 - camera.x) * z), Math.round((r.y0 - camera.y) * z), Math.round(nw * skip * z), Math.round(nh * skip * z));
  }
  const before = PW.drawUnitsHook;
  PW.drawUnitsHook = (renderer) => { if (before) before(renderer); draw(renderer); };

  // ---- By hand --------------------------------------------------------------------------------------------------
  let held = null;
  function tool(world, x, y, type = 'launcher', side = null) {
    const list = world.defence || [];
    if (held && (held.dead || !list.includes(held))) held = null;
    const hit = list.find((u) => !u.dead && x >= boxOf(u).x0 && x <= boxOf(u).x1 && y >= boxOf(u).y0 - 20 && y <= boxOf(u).y1 + 2);
    if (hit) { held = hit === held ? null : hit; return held; }
    if (held) { held.aim = { x, y }; click(world, x, y, 0); return held; }   // (N102: a click aims and fires)
    const gx = Math.round(x);
    if (gx < 80 || gx > world.width - 80) return null;
    // (a turret set down by hand: on the face of a wall beside the click, if one is nearer than the
    // ground under it - a cliff, a building's side - else on the ground)
    if (type === 'turret') {
      const gy = Math.round(y), solid = (xx, yy) => blocks(world, xx, yy);
      const down = groundUnder(world, gx, Math.max(0, gy));
      let wall = null;
      for (let d = 1; d <= 30 && !wall; d += 1) for (const s of [-1, 1]) {
        const xx = gx + s * d;
        if (!solid(xx, gy) || solid(xx - s, gy)) continue;
        let tall = 0;
        for (let yy = gy - 8; yy <= gy + 8; yy += 1) if (solid(xx, yy) && !solid(xx - s, yy)) tall += 1;
        if (tall >= 13) { wall = { x: xx, normal: [-s, 0], d }; break; }
      }
      const spec = wall && wall.d < down - gy
        ? { type, x: wall.x, y: gy, normal: wall.normal, side }
        : { type, x: gx, y: down + 1, normal: [0, -1], side, facing: gx < world.width / 2 ? 1 : -1 };
      held = create(world, spec);
      return held;
    }
    const gy = groundUnder(world, gx, Math.max(0, Math.round(y) - 40));
    held = create(world, { type, x: gx, y: gy, side, facing: gx < world.width / 2 ? 1 : -1 });
    return held;
  }
  function hold(u) { held = u && !u.dead && u.kind === 'defence' ? u : null; return held; }
  function key(event) {
    if (!held || held.dead || event.repeat || event.type === 'keyup') return false;
    const world = current || (window.pwApp && window.pwApp.world);
    if (event.code === 'KeyF') { if (held.type === 'launcher') fire(world, held); else held.hold = !held.hold; return true; }
    return false;
  }
  // The mouse (N102, the user's controls): a left click at a spot - a launcher lays its salvo on it,
  // a turret fires a burst at it (one that can be put out of action, out of it, does nothing). The
  // interceptor batteries fire on their own, and none has another fire: a right click is not theirs.
  // (True when the one in hand took it.)
  function click(world, x, y, button = 0) {
    const u = held;
    if (!u || u.dead || button !== 0 || (PW.units && PW.units.disabled && PW.units.disabled(world, u))) return false;
    // (N126: a launcher's salvo comes down on the surface under the spot clicked - a roof, the ground)
    if (u.type === 'launcher') { u.aim = { x, y: surfaceUnder(world, x, y) }; fire(world, u); return true; }
    // (a turret: its gun laid on the spot - as far as its mount lets it - and a burst once laid)
    if (u.type === 'turret' && u.pivot && aimable(u, Math.atan2(-(y - u.pivot.y), x - u.pivot.x))) {
      u.foe = { spot: true, x, y, dead: false };
      u.manualT = 2.5; u.rest = 0;
      return true;
    }
    return false;
  }

  // (silenced a while - a hack on its base: see PW.units.disable)
  const disable = (u, seconds) => (PW.units ? PW.units.disable(u, seconds) : false);
  PW.defence = { create, step, draw, fire, hurt, blast, target, tool, hold, held: () => held, key, click, disable, laying, impactOf, impactAt, ownGround, skyClear, stats, TYPES,
    pixel: turretPixel, aimable, MOUNTS, BARREL, TURN_HEAD,
    // (N114: the artillery's build - its base's width WGM lays: BUILD[type].ring[0] at least - what a
    // round costs its side, and whether it can pay for one)
    BUILD, PRICE, canPay, affordable, tubeOf,
    // (N126: a drone off a launcher - see PW.jets)
    canLaunch, launchDrone, droneAngle,
    // (N126: the cursor's world point each frame - null off the view - for the aiming line; the surface under a point)
    pointer, surfaceUnder };
})();
