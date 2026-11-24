'use strict';
// Units, all kinds together (N5, N7): what each sees, what each does on its own, and the one call
// that orders any of them (WGM's selection and orders - pw-command - and the computer opponent - pw-ai -
// play through it, as a player does):
//   PW.units.order(world, unit, { type: 'move' | 'attack' | 'hold' | 'auto', x, y, target })
// - move: there - a trooper finds its way (PW.troops.goTo), a tank drives, a mech strides, leaping
//   and boosting over what stops it, a jet flies over it; engaging what it meets on the way;
// - attack: the target (a unit), or the place: it goes until it has it in its sights, and fires;
// - hold: it stays where it is, and fires at what comes into its sights;
// - auto: the sentry - it fires at the nearest enemy it sees; a trooper under fire gets down behind
//   what covers it, and throws a grenade at one it saw go round a corner.
// Sight is each unit's own: what is in its arc (the way it faces, and close round it whatever the
// way), within its reach, with nothing solid between its eyes and the enemy - glass is no bar. The
// computer's units never see a trooper crouched (the design doc's stealth - a man may crawl up on a
// defence to hack it), and see one in a hand-drilled dirt tunnel its side has not taken in only
// close to (PW.troops.inBore). Every unit can be put out of action a while (a hack: disable).
// Our own code throughout.
(function () {
  const PW = window.PW;
  const { ID_MASK } = PW;
  const { phase, passable } = PW.mat;
  const POWDER = PW.PHASE.POWDER;

  // reach (cells), the arc it sees in (radians either side of the way it faces), how close round it
  // it sees whatever the way, and how often (ticks) it looks
  const SIGHT = {
    trooper: { reach: 420, arc: 1.3, near: 40, every: 10 },
    tank: { reach: 900, arc: 1.4, near: 80, every: 12 },
    mech: { reach: 700, arc: 1.4, near: 60, every: 10 },
    jet: { reach: 1400, arc: 0.9, near: 120, every: 8 },
    turret: { reach: 720, arc: 1.31, near: 30, every: 10 },   // (an autocannon on its mount, its sensor head: N103)
  };
  const BORE_SEEN = 120;        // cells: a man in a secret dirt tunnel is seen no further off than this
  const REMEMBER = 3 * 60;      // ticks it keeps after an enemy it saw (where it went round a corner)
  const COVER_LOOK = 40;        // cells either side a trooper under fire looks for cover to get behind
  const GRENADE_FROM = 50, GRENADE_TO = 140, GRENADE_EVERY = 300;
  const GIVES_AWAY = 120;       // ticks a crouched trooper that fired is seen for
  const stats = { looks: 0, spotted: 0, engaged: 0, grenades: 0, toCover: 0 };

  const opaque = (world, x, y) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
    const id = world.mat[(y | 0) * world.width + (x | 0)] & ID_MASK;
    return phase[id] >= POWDER && !passable[id] && id !== PW.M.GLASS && id !== PW.M.PLATFORM;
  };
  // (nothing solid on the line from (x0, y0) to (x1, y1): every second cell along it)
  function clearLine(world, x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
    for (let q = 1; q < n; q += 1) if (opaque(world, x0 + (x1 - x0) * q / n, y0 + (y1 - y0) * q / n)) return false;
    return true;
  }

  // ---- What there is --------------------------------------------------------------------------------------
  const LISTS = ['troops', 'tanks', 'mechs', 'jets', 'defence'];
  function* all(world) { for (const k of LISTS) for (const u of world[k] || []) if (!u.dead) yield u; }
  const kindOf = (u) => (u.kind === 'defence' ? (u.type === 'turret' ? 'turret' : 'battery') : u.kind);
  // (a unit's eyes, and the middle of its body - where it is aimed at)
  function eyes(u) {
    switch (u.kind) {
      case 'trooper': return { x: u.x + u.facing * 2, y: u.y - (u.crouch ? PW.troops.CROUCH : PW.troops.HEIGHT) + 4 };
      case 'tank': return { x: u.x, y: u.y - 30 };
      case 'mech': return { x: u.x + u.facing * 14, y: u.y - (u.lift ?? 30) - 2 };   // (its head, forward of its body)
      case 'jet': return { x: u.x, y: u.y };
      // (a turret's: its sensor, on its head - see PW.defence's turrets, which keep it as u.eye)
      default: return u.type === 'turret' && u.eye ? u.eye : { x: u.x, y: u.y - (u.type === 'turret' ? 4 : 30) };
    }
  }
  function body(u) {
    switch (u.kind) {
      case 'trooper': return { x: u.x, y: u.y - (u.crouch ? 10 : 16) };
      case 'tank': return { x: u.x, y: u.y - 14 };
      case 'mech': return { x: u.x, y: u.y - (u.lift ?? 30) };
      case 'jet': return { x: u.x, y: u.y };
      default: return u.type === 'turret' && u.pivot ? u.pivot : { x: u.x, y: u.y - (u.type === 'turret' ? 4 : 16) };
    }
  }
  const facingOf = (u) => (u.kind === 'defence' ? u.facing : u.facing || 1);
  // Does a see b?
  function sees(world, a, b, ai = true) {
    if (a === b || b.dead || a.dead || !b.side || b.side === a.side) return false;
    const S = SIGHT[kindOf(a)] || SIGHT.trooper, e = eyes(a), p = body(b);
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    if (d > S.reach) return false;
    // (the stealth of the crouched - till it fires, and gives itself away - and of the secret
    // tunnel: against the computer's eyes)
    if (ai && b.kind === 'trooper' && b.crouch && (world.tick || 0) - (b.firedAt ?? -1e9) > GIVES_AWAY) return false;
    if (b.kind === 'trooper' && d > BORE_SEEN && PW.troops.inBore(world, b)) return false;
    // (in its arc: the way it faces - both ways for one that faces neither - or close round it)
    const f = facingOf(a);
    if (d > S.near && f) {
      const ang = Math.atan2(-dy, dx * f);
      if (Math.abs(ang) > S.arc) return false;
    }
    return clearLine(world, e.x, e.y, p.x, p.y);
  }
  // (the nearest enemy u sees)
  function spot(world, u) {
    let best = null, bd = Infinity;
    for (const b of all(world)) {
      if (!b.side || b.side === u.side || b.kind === 'defence' && u.kind === 'jet') continue;
      const d = Math.hypot(b.x - u.x, b.y - u.y);
      if (d >= bd || !sees(world, u, b)) continue;
      bd = d; best = b;
    }
    stats.looks += 1;
    return best;
  }

  // ---- Orders --------------------------------------------------------------------------------------------
  function order(world, u, o) {
    if (!u || u.dead || !o) return false;
    u.order = { ...o, at: world.tick || 0 };
    if (u.kind === 'trooper') {
      PW.troops.stopDrill(u);
      // (told to go quietly: crouched all the way, and it fights no one - a man crouched is not
      // seen by the computer's eyes till he fires, and he does not)
      u.sneak = !!o.quiet;
      if (o.type === 'move') return !!PW.troops.goTo(world, u, o.x, o.y);
      if (o.type === 'hold') { u.route = null; u.walk = 0; }
      if (o.type === 'attack' && !o.target && Number.isFinite(o.x)) PW.troops.goTo(world, u, o.x, o.y);
      return true;
    }
    if (u.kind === 'tank' && (o.type === 'hold' || o.type === 'auto')) PW.tanks.drive(u, 0);
    if (u.kind === 'mech' && (o.type === 'hold' || o.type === 'auto')) PW.mechs.walk(u, 0);
    // (a launcher told to attack a place lays its salvo on it; the batteries fight on their own)
    if (u.kind === 'defence' && u.type === 'launcher' && o.type === 'attack' && PW.defence) {
      const p = o.target && !o.target.dead ? o.target : o;
      if (Number.isFinite(p.x)) { u.aim = { x: p.x, y: Number.isFinite(p.y) ? p.y : world.groundTop[Math.round(p.x)] }; PW.defence.fire(world, u); }
    }
    return true;
  }
  // A hack, or anything else that puts it out of action a while: it does nothing till then.
  let current = null;
  function disable(u, seconds) {
    if (!u) return false;
    const now = (current && current.tick) || 0;
    u.disabledUntil = Math.max(u.disabledUntil || 0, now + Math.round(seconds * 60));
    if (u.kind === 'tank') { u.drive = 0; u.target = null; }
    if (u.kind === 'trooper') { u.walk = 0; u.route = null; }
    if (u.kind === 'mech') { u.walk = 0; u.burst = 0; }
    if (u.kind === 'defence') u.salvo = 0;
    return true;
  }
  const disabled = (world, u) => (u.disabledUntil || 0) > (world.tick || 0);

  // ---- On its own: the sentry, and carrying out its order -------------------------------------------------
  // (a unit taken in hand - N102: it does only what the person's keys and clicks tell it, no looking
  // about, no firing of its own, its aim where the mouse is)
  const inHand = (u) => (u.kind === 'trooper' && PW.troops && PW.troops.held() === u) || (u.kind === 'tank' && PW.tanks && PW.tanks.held() === u)
    || (u.kind === 'mech' && PW.mechs && PW.mechs.held() === u) || (u.kind === 'jet' && PW.jets && PW.jets.held() === u);
  function think(world, u, dt) {
    const o = u.order;
    if (!o || disabled(world, u) || inHand(u)) return;
    const S = SIGHT[kindOf(u)] || SIGHT.trooper;
    // (a look about it now and then - each in its own tick, so they do not all look at once)
    u.lookIn = (u.lookIn ?? ((u.seed || 0) % S.every)) - 1;
    if (u.lookIn <= 0) {
      u.lookIn = S.every;
      const wanted = o.type === 'attack' && o.target && !o.target.dead ? o.target : null;
      const seen = wanted && sees(world, u, wanted) ? wanted : spot(world, u);
      if (seen) { u.foe = seen; u.foeAt = world.tick || 0; u.foeSeen = { x: seen.x, y: seen.y }; stats.spotted += 1; }
      else if (u.foe && (world.tick || 0) - (u.foeAt || 0) > REMEMBER) u.foe = null;
      u.foeInSight = !!seen;
    }
    if (u.kind === 'trooper') trooper(world, u, o);
    else if (u.kind === 'tank') tank(world, u, o);
    else if (u.kind === 'mech') mech(world, u, o);
    else if (u.kind === 'jet') jet(world, u, o);
  }
  function trooper(world, t, o) {
    const U = PW.troops, f = t.foe;
    if (t.sneak) { if (!t.crouch && !t.swim) t.crouch = U.clear(world, t.x, t.y, U.CROUCH); return; }
    // (a guard keeps to its post: thrown off it, it goes back)
    if (t.unit === 'guard' && t.post && !t.route && !f && Math.abs(t.x - t.post.x) > 30 && (world.tick % 120) === 0) U.goTo(world, t, t.post.x, t.post.y);
    if (o.type === 'attack' && o.target && !o.target.dead && !t.foeInSight && !t.route && (world.tick % 60) === 0) U.goTo(world, t, o.target.x, o.target.y);
    if (t.toCover && !t.route) t.toCover = false;
    if (!f || f.dead) { t.foe = null; return; }
    if (t.foeInSight) {
      // (it stops to fire - and, under fire, gets down; behind cover if there is some near)
      if (o.type !== 'move' && !t.toCover) { t.walk = 0; t.route = null; }
      const under = (world.tick || 0) - (t.hitAt ?? -1e9) < 120;
      if (under && !t.crouch && !t.route) { if (!coverNear(world, t, f)) t.crouch = U.clear(world, t.x, t.y, U.CROUCH); }
      const p = body(f);
      t.aim = { x: p.x, y: p.y };
      if (t.slot !== 'rifle') t.slot = 'rifle';
      if (!t.toCover && U.fire(world, t)) stats.engaged += 1;
    } else if (t.grenades > 0 && t.foeSeen && (world.tick || 0) - (t.foeAt || 0) < REMEMBER && !t.route) {
      // (seen a moment ago, gone round a corner or down behind something: a grenade after it)
      const d = Math.abs(t.foeSeen.x - t.x), ready = (world.tick || 0) - (t.threwAt ?? -1e9) > GRENADE_EVERY;
      if (ready && d > GRENADE_FROM && d < GRENADE_TO && Math.abs(t.foeSeen.y - t.y) < 40) {
        t.aim = { x: t.foeSeen.x, y: t.foeSeen.y - 4 };
        if (U.throwGrenade(world, t)) { t.threwAt = world.tick || 0; stats.grenades += 1; }
      }
    }
  }
  // (cover near it, between it and the threat: a bump of sandbags, rocks, a crate - get behind it,
  // crouched; true when it is on its way)
  function coverNear(world, t, f) {
    const dir = Math.sign(f.x - t.x) || 1, U = PW.troops;
    for (let d = 0; d <= COVER_LOOK; d += 2) for (const s of [1, -1]) {
      const x = Math.round(t.x + s * d), y = t.y;
      const id = world.mat[y * world.width + x] & ID_MASK;
      if (!(id === PW.M.COVER_SAND || id === PW.M.COVER_ROCK || id === PW.M.COVER_WOOD || id === PW.M.COVER_METAL)) continue;
      // (stand on its far side from the threat)
      const at = x - dir * (U.HALF + 4);
      if (Math.abs(at - t.x) < 2) { t.crouch = true; return true; }
      if (U.goTo(world, t, at, y)) { t.crouch = true; t.toCover = true; stats.toCover += 1; return true; }
    }
    return false;
  }
  function tank(world, t, o) {
    const T = PW.tanks, f = t.foe;
    if (o.type === 'move' || (o.type === 'attack' && !t.foeInSight)) {
      const gx = o.type === 'attack' && o.target && !o.target.dead ? o.target.x : o.x;
      if (Number.isFinite(gx)) T.drive(t, Math.abs(gx - t.x) < 20 ? 0 : Math.sign(gx - t.x));
      if (o.type === 'move' && Math.abs(gx - t.x) < 20) t.order = { type: 'hold', at: world.tick || 0 };
    }
    if (!f || f.dead || !t.foeInSight) { if (!f || f.dead) t.foe = null; return; }
    if (o.type === 'attack') T.drive(t, 0);
    const p = body(f);
    T.aimAt(t, p.x, p.y);
    // (it fires once its gun is laid on it)
    if (t.reload > 0) return;
    const m = T.muzzle(t), want = Math.atan2(p.y - m.y, p.x - m.x), have = Math.atan2(m.dy, m.dx);
    let dd = Math.abs(want - have);
    if (dd > Math.PI) dd = 2 * Math.PI - dd;
    if (dd < 0.04 + 6 / Math.max(60, Math.hypot(p.x - m.x, p.y - m.y)) && T.fire(world, t)) stats.engaged += 1;
  }
  function mech(world, m, o) {
    const X = PW.mechs, f = m.foe;
    if (o.type === 'move' || (o.type === 'attack' && !m.foeInSight)) {
      const gx = o.type === 'attack' && o.target && !o.target.dead ? o.target.x : o.x;
      if (Number.isFinite(gx)) {
        const dir = Math.abs(gx - m.x) < 20 ? 0 : Math.sign(gx - m.x);
        X.walk(m, dir);
        // (stopped by what it cannot step up: it leaps it; still stopped, its jets take it up)
        if (dir && m.onGround && Math.abs(m.vx) < 2) { m.stuck = (m.stuck || 0) + 1; if (m.stuck > 20) { X.leap(m); m.stuck = 0; m.leaptAt = world.tick; } }
        else m.stuck = 0;
        if (!m.onGround && m.leaptAt && world.tick - m.leaptAt > 40 && m.vy > -20 && m.fuel > 0.4 && !m.boosting) X.boost(m, true);
        if (o.type === 'move' && !dir) m.order = { type: 'hold', at: world.tick || 0 };
      }
    }
    if (!f || f.dead || !m.foeInSight) { if (!f || f.dead) m.foe = null; return; }
    const p = body(f);
    m.aim = { x: p.x, y: p.y };
    if (m.burst === 0 && (world.tick % 45) === 0 && X.fire(world, m)) stats.engaged += 1;
    // (a missile at armour)
    if ((f.kind === 'tank' || f.kind === 'mech') && m.missiles > 0 && (world.tick % 240) === 0) X.launch(world, m);
  }
  // (N126, the user's: a drone has no guns. Sent to attack - a unit, a building's spot, a place - it
  // dives into it, its warhead going off there; told to move, it circles over the place; to hold,
  // over where it is; left to itself, it roams)
  function jet(world, j, o) {
    const J = PW.jets;
    if (j.down || j.pod || j.boost > 0) return;
    if (o.type === 'attack') {
      const p = o.target && !o.target.dead ? body(o.target)
        : Number.isFinite(o.x) ? { x: o.x, y: Number.isFinite(o.y) ? o.y : world.groundTop[Math.max(0, Math.min(world.width - 1, Math.round(o.x)))] } : null;
      if (p && (!j.strike || Math.hypot(j.strike.x - p.x, j.strike.y - p.y) > 4)) J.strike(world, j, p);
      return;
    }
    if (o.type === 'move' && Number.isFinite(o.x)) { if (!j.loiter || j.loiter.x !== o.x) J.loiter(world, j, { x: o.x }); return; }
    if (o.type === 'hold') { if (!j.loiter) J.loiter(world, j, { x: j.x }); return; }
    if (j.loiter) J.loiter(world, j, null);
  }
  function step(world, dt) {
    current = world;
    for (const k of ['troops', 'tanks', 'mechs', 'jets']) for (const u of world[k] || []) if (!u.dead && u.order) think(world, u, dt);
  }

  // ---- Where a unit comes up (N131, the user's rule: troopers, mechs and tanks come up only at a
  // military building's core spawner - WGM's N130 gives its point; drones alone are launched, from a
  // missile launcher, N126) ---------------------------------------------------------------------------
  // The nearest place to (x, y) - the core spawner's way out: its hall's floor, a pad, a room cut in
  // the rock round a base's core - where a unit of `kind` stands: ground under it that bears it - no
  // further below (x, y) than DROP_TO, nor further over it than a step - room over it for its height,
  // its body's width clear, and for a tank the ground under its tracks no steeper than
  // PW.tanks.MAX_SLOPE. Looked for column by column out to REACH either side, the nearest first; null
  // where there is none (the deploy is then refused) - never the ground's top in that column, the
  // rock over a base cut into it. { x, y } as that kind's create takes them: a tank's y the top row
  // of what bears it, a man's, a mech's or a drone's the row its feet are in.
  const SPAWN = {
    trooper: { half: 3, height: 25, step: 9 },
    mech: { half: 15, height: 60, step: 22 },
    tank: { half: 56, height: 36, step: 15 },
    jet: { half: 12, height: 20, step: 9 },
  };
  const SPAWN_REACH = 60, DROP_TO = 40;
  function spawnPoint(world, kind, x, y) {
    const K = { ...(SPAWN[kind] || SPAWN.trooper) }, W = world.width, H = world.height;
    const blocks = (xx, yy) => xx < 0 || yy < 0 || xx >= W || yy >= H || (phase[world.mat[yy * W + xx] & ID_MASK] >= POWDER && !passable[world.mat[yy * W + xx] & ID_MASK]);
    if (kind === 'mech' && PW.mechs) { K.half = PW.mechs.HALF; K.height = PW.mechs.HEIGHT; K.step = PW.mechs.STEP_UP; }
    if (kind === 'tank' && PW.tanks) K.step = PW.tanks.STEP;
    // (the top of what bears a body in column cx near row y: the ground the point is in, if no more
    // than a step deep in it, or the first under it within DROP_TO)
    const floorAt = (cx, from) => {
      let yy = Math.round(from);
      if (blocks(cx, yy)) { let up = 0; while (up <= K.step && blocks(cx, yy - 1)) { yy -= 1; up += 1; } return up > K.step ? -1 : yy; }
      for (let d = 0; d <= DROP_TO; d += 1) if (blocks(cx, yy + d + 1)) return yy + d + 1;
      return -1;
    };
    const fits = (cx, f) => {
      // (room for its height over it, its width clear)
      for (let yy = f - K.height; yy < f; yy += 1) for (let xx = cx - Math.min(K.half, 6); xx <= cx + Math.min(K.half, 6); xx += 1) if (blocks(xx, yy)) return false;
      if (kind !== 'tank') { for (let xx = cx - K.half; xx <= cx + K.half; xx += 1) if (floorAt(xx, f - 1) < 0) return false; return true; }
      // (a tank: the ground under its tracks, end to end, bearing it - no steeper than it climbs, no
      // gap it would tip into)
      const tanMax = Math.tan((PW.tanks ? PW.tanks.MAX_SLOPE : 43) * Math.PI / 180);
      let lo = f, hi = f;
      for (let u = -K.half; u <= K.half; u += 4) {
        const g = floorAt(cx + u, f - 1);
        if (g < 0) return false;
        lo = Math.min(lo, g); hi = Math.max(hi, g);
        for (let yy = g - K.height; yy < g; yy += 3) if (blocks(cx + u, yy)) return false;
      }
      return (hi - lo) <= K.step || (hi - lo) / (2 * K.half) <= tanMax;
    };
    for (let d = 0; d <= SPAWN_REACH; d += 2) for (const s of d ? [-1, 1] : [1]) {
      const cx = Math.round(x) + s * d;
      if (cx < K.half + 2 || cx > W - K.half - 3) continue;
      const f = floorAt(cx, y);
      if (f < 0 || !fits(cx, f)) continue;
      return { x: cx, y: kind === 'tank' ? f : f - 1 };
    }
    return null;
  }

  PW.units = { all, order, disable, disabled, sees, spot, step, eyes, body, stats, SIGHT, BORE_SEEN, spawnPoint, SPAWN };
})();
