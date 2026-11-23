'use strict';
// Salvos and their interceptors (N90, the user's - the Iron Dome and Patriot refs): three wheeled
// units, at their real size, each side's colours:
// - a rocket launcher (Grad, MLRS): a truck with a pod of 12 tubes; told a spot, it fires a salvo -
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
// Each can be taken in hand (the user's: every unit can be controlled): a click aims a launcher, F
// fires its salvo; a battery fights on its own - F holds or frees its fire. What strikes them comes
// off their armour; destroyed, their ammunition goes up.
// Our own code throughout.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, passable } = PW.mat;
  const G = () => PW.GRAVITY || 260;

  const TYPES = {
    launcher: { length: 104, ammo: 12, kind: 'rocket', hp: 60 },
    dome: { length: 90, ammo: 20, kind: 'interceptor', hp: 60, range: 4000, perThreat: 2, protect: true },
    patriot: { length: 110, ammo: 8, kind: 'patriot', hp: 70, range: 4500, perThreat: 2, protect: false, jets: true },
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
  // (x: its middle; y: the row its wheels stand on - a turret's: its mount, the device cell)
  function create(world, spec) {
    const type = TYPES[spec.type] ? spec.type : 'launcher', T = TYPES[type];
    const x = Math.round(spec.x), y = spec.y ?? groundUnder(world, x, 0);
    const u = { kind: 'defence', type, x, y, facing: T.fixed ? (spec.facing ?? 1) : spec.facing || 1, side: spec.side || null, style: STYLES[spec.style] ? spec.style : 'modern',
      hp: T.hp, dead: false, ammo: T.ammo, salvo: 0, salvoT: 0, aim: null, gap: 0, look: 0, hold: !!spec.hold, engaged: new Map(), hurtBy: '',
      building: spec.building || 0, burst: 0, burstT: 0, rest: 0, aimA: 0, seed: ++seq };
    current = world;
    if (type === 'turret') mountTurret(u, spec);
    (world.defence || (world.defence = [])).push(u);
    current = world;
    if (type === 'turret') turretPose(u);
    return u;
  }
  // (where its tubes are, and which way they point: a Dome's near straight up - its interceptors
  // clear the town's towers round it before they turn)
  function tubeOf(u) {
    const T = TYPES[u.type];
    if (u.type === 'launcher') return { x: u.x - u.facing * 20, y: u.y - 26, up: 0.75 };
    return { x: u.x - u.facing * (T.length * 0.2), y: u.y - 30, up: u.type === 'dome' ? 1.4 : 1.2 };
  }
  // (is the way its rounds go up open - nothing solid over its tubes along it for CLEAR_RUN cells,
  // a roof, a tower, a mast? It does not fire into one. Looked at again every CLEAR_EVERY s, the
  // world changing round it)
  const CLEAR_RUN = 360, CLEAR_EVERY = 2;
  function skyClear(world, u, facing = u.facing) {
    const t = tubeOf(u), dx = Math.cos(t.up) * facing, dy = -Math.sin(t.up);
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
  function fire(world, u) {
    if (!u || u.dead || u.type !== 'launcher' || u.salvo > 0 || !u.aim || u.ammo <= 0) return false;
    u.salvo = Math.min(u.ammo, TYPES.launcher.ammo);
    u.salvoT = 0;
    u.facing = Math.sign(u.aim.x - u.x) || u.facing;
    u.laid = laying(world, tubeOf(u).x, tubeOf(u).y, u.aim.x, u.aim.y);
    stats.salvos += 1;
    return true;
  }
  function stepSalvo(world, u, dt) {
    u.salvoT -= dt;
    while (u.salvo > 0 && u.salvoT <= 0) {
      const t = tubeOf(u), spread = ((PW.hash3(u.seed, u.salvo, 3) & 255) / 255 - 0.5) * 0.03, a = u.laid + spread;
      PW.shots.fire(world, { kind: 'rocket', x: t.x, y: t.y, dx: Math.cos(a) * u.facing, dy: -Math.sin(a), side: u.side, from: u });
      if (PW.shots.report) PW.shots.report(world, t.x, t.y, -Math.cos(a) * u.facing, Math.sin(a), 2);
      u.salvo -= 1; u.ammo -= 1; u.salvoT += RIPPLE;
      stats.rockets += 1;
    }
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
      if (j.dead || j.down || !j.side || j.side === u.side || Math.hypot(j.x - u.x, j.y - u.y) > T.range) continue;
      if ((u.engaged.get(j) || 0) < T.perThreat) threats.push({ s: j, soon: Math.hypot(j.x - u.x, j.y - u.y) / 1000 });
    }
    // (what will strike soonest first, one at a time, its interceptors a moment apart)
    threats.sort((a, b) => a.soon - b.soon);
    for (const { s } of threats) {
      if (u.gap > 0 || u.ammo <= 0) break;
      // (its launcher turned to the threat's side - or, the way up shut that side, the other)
      const f = Math.sign(s.x - u.x) || u.facing;
      u.facing = skyClear(world, u, f) ? f : -f;
      const t = tubeOf(u);
      PW.shots.fire(world, { kind: T.kind, x: t.x, y: t.y, dx: Math.cos(t.up) * u.facing, dy: -Math.sin(t.up), side: u.side, from: u, target: s });
      u.engaged.set(s, (u.engaged.get(s) || 0) + 1);
      // (the gap counted from when it was due - its looks at the sky are LOOK_EVERY ticks apart)
      u.ammo -= 1; u.gap = Math.max(-LOOK_EVERY / 60, u.gap) + LAUNCH_GAP;
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
    // (its ammunition goes up - a turret's a little, where it sits - and its head falls, burnt)
    if (TYPES[u.type].fixed) {
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
  const boxOf = (u) => (u.type === 'turret' && u.ras ? { x0: u.ras.x0, x1: u.ras.x0 + u.ras.w, y0: u.ras.y0, y1: u.ras.y0 + u.ras.w }
    : { x0: u.x - TYPES[u.type].length / 2, x1: u.x + TYPES[u.type].length / 2, y0: u.y - 30, y1: u.y });
  const target = {
    hit(world, s, x0, y0, x1, y1) {
      let best = null;
      for (const u of world.defence || []) {
        if (u.dead || u === s.from) continue;
        // (a turret: its own pixels as drawn, along the round's way)
        if (u.type === 'turret' && u.ras) {
          const b = u.ras;
          if (Math.max(x0, x1) < b.x0 || Math.min(x0, x1) > b.x0 + b.w || Math.max(y0, y1) < b.y0 || Math.min(y0, y1) > b.y0 + b.w) continue;
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
      // (a turret: still on its base? - looked at every few ticks, put out of action or not)
      if (u.type === 'turret' && ((world.tick || 0) + u.seed) % 10 === 0 && !onBase(world, u)) { fallOff(world, u); continue; }
      // (put out of action a while - a hack: see PW.units.disable - a turret's gun drooping)
      if ((u.disabledUntil || 0) > (world.tick || 0)) {
        if (u.type === 'turret') { u.burst = 0; u.foe = null; u.e = Math.max(MOUNTS[u.face].lo, u.e - SLEW * 0.3 * dt); turretPose(u); }
        continue;
      }
      if (u.type === 'turret') { turretStep(world, u, dt); continue; }
      if (u.salvo > 0) stepSalvo(world, u, dt);
      if (u.type !== 'launcher') watch(world, u, dt);
    }
    for (let q = list.length - 1; q >= 0; q -= 1) if (list[q].dead) list.splice(q, 1);
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
    u.ras = { key, x0: u.x - R, y0: u.y - R, w, px: px32 };
  }
  // (what of it is at world point (x, y): its colour as drawn, or 0)
  function turretPixel(u, x, y) {
    const r = u.ras;
    if (!r) return 0;
    const i = Math.floor(x) - r.x0, j = Math.floor(y) - r.y0;
    return i < 0 || j < 0 || i >= r.w || j >= r.w ? 0 : r.px[j * r.w + i];
  }
  // (still on its base: enough of the base's cells standing - or, with no base given, of the face
  // under its ring)
  function onBase(world, u) {
    const solid = (x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height && PW.mat.phase[world.mat[y * world.width + x] & ID_MASK] === PW.PHASE.SOLID;
    let n = 0, all = 0;
    if (u.base) {
      const b = u.base, y0 = b.y0 ?? b.y, y1 = b.y1 ?? (u.face === 'wall' ? b.y + 6 : b.y), ya = u.face === 'wall' && b.y0 === undefined ? b.y - 6 : y0;
      for (let y = ya; y <= y1; y += 1) for (let x = b.x0; x <= b.x1; x += 1) { all += 1; if (solid(x, y)) n += 1; }
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
    for (let j = 0; j < r.w; j += 1) for (let i = 0; i < r.w; i += 1) {
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

  // ---- Drawn: a truck, its cab at the front, its launcher on the bed - tubes raised ----------------------------
  function draw(renderer) {
    const world = renderer.world || current, list = world && world.defence;
    if (!list || !list.length) return;
    const { ctx, camera } = renderer, z = camera.zoom;
    const cell = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), Math.max(1, Math.round(w * z)), Math.max(1, Math.round(h * z))); };
    const col = (c, k = 1) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
    for (const u of list) {
      if (u.dead) continue;
      const T = TYPES[u.type], st = STYLES[u.style], L = T.length, f = u.facing, x0 = u.x - L / 2, y = u.y;
      if (T.fixed) { drawTurret(renderer, u); continue; }
      // (chassis and wheels)
      cell(x0, y - 12, L, 5, col(st.body)); cell(x0, y - 12, L, 1, col(st.light));
      for (let k = 0; k < 4; k += 1) { const wx = u.x + f * (L / 2 - 12 - k * (L - 24) / 3); cell(wx - 5, y - 9, 10, 10, 'rgb(34,34,36)'); cell(wx - 2, y - 6, 4, 4, 'rgb(96,96,92)'); }
      // (the cab, at the front)
      const cx = f > 0 ? u.x + L / 2 - 22 : x0;
      cell(cx, y - 26, 22, 14, col(st.body)); cell(cx + (f > 0 ? 12 : 2), y - 24, 8, 6, 'rgb(40,56,64)');
      // (the launcher on its bed: a box of tubes raised, rows of round mouths)
      const len = u.type === 'launcher' ? 52 : 40, a = u.type === 'launcher' ? (u.laid || 0.5) : tubeOf(u).up, base = u.x - f * 14, by = y - 14;
      ctx.save();
      ctx.translate(Math.round((base - camera.x) * z), Math.round((by - camera.y) * z));
      ctx.rotate(-a * f);
      ctx.scale(f, 1);
      ctx.fillStyle = col(st.dark); ctx.fillRect(-len * z * 0.15, -14 * z, len * z, 14 * z);
      ctx.fillStyle = col(st.light); ctx.fillRect(-len * z * 0.15, -14 * z, len * z, 2 * z);
      ctx.fillStyle = 'rgb(28,28,30)';
      const rows = u.type === 'patriot' ? 2 : 3, cols = u.type === 'patriot' ? 2 : u.type === 'dome' ? 5 : 4;
      for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) ctx.fillRect(len * z * 0.85 - 2 * z, (-12 + r * 4.4 + (c % 2) * 0.8) * z, 2 * z, 2.6 * z);
      ctx.restore();
      if (u.type !== 'launcher') { cell(u.x + f * 6 - 5, y - 40, 10, 12, col(st.light, 0.9)); cell(u.x + f * 6 - 1, y - 28, 2, 16, col(st.dark)); }   // (its radar)
    }
  }
  // (a turret: its drawing laid into the view, a cell to a pixel of its own - see turretPose)
  let tCanvas = null, tCtx = null, tImage = null, tPx = null;
  function drawTurret(renderer, u) {
    const r = u.ras;
    if (!r) return;
    const { ctx, camera, view } = renderer, z = camera.zoom, skip = Math.max(1, Math.floor(1 / z));
    const vx1 = camera.x + view.width / z, vy1 = camera.y + view.height / z;
    if (r.x0 + r.w < camera.x || r.x0 > vx1 || r.y0 + r.w < camera.y || r.y0 > vy1) return;
    const n = Math.ceil(r.w / skip);
    if (!tCanvas || tCanvas.width < n) {
      tCanvas = document.createElement('canvas'); tCanvas.width = tCanvas.height = Math.max(80, n);
      tCtx = tCanvas.getContext('2d'); tImage = tCtx.createImageData(tCanvas.width, tCanvas.height); tPx = new Uint32Array(tImage.data.buffer);
    }
    const stride = tCanvas.width;
    for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) tPx[j * stride + i] = r.px[(j * skip) * r.w + i * skip];
    tCtx.putImageData(tImage, 0, 0, 0, 0, n, n);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tCanvas, 0, 0, n, n, Math.round((r.x0 - camera.x) * z), Math.round((r.y0 - camera.y) * z), Math.round(n * skip * z), Math.round(n * skip * z));
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
    if (held) { held.aim = { x, y }; return held; }
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
    if (u.type === 'launcher') { u.aim = { x, y }; fire(world, u); return true; }
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
    pixel: turretPixel, aimable, MOUNTS, BARREL, TURN_HEAD };
})();
