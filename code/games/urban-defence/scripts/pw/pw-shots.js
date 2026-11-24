'use strict';
// Rounds in flight (N77): every shot fired in the world - a trooper's rifle bullet, a tank's shell,
// a mech's cannon round, a missile off a jet's rail or a launcher - is a body moving through it:
// launched from its muzzle at its speed, slowed by the air, pulled down by gravity (a missile
// flying on its motor and steering for its mark until its fuel is spent), and followed cell by
// cell along its path each tick, so nothing it passes is skipped however fast it goes. It strikes
// the first thing in its way:
//   - a unit (tanks now; troopers, mechs and jets as they come - see addTarget), by the unit's own
//     pixels, not a box round it;
//   - the world's cells. Smoke and dust it passes; glass it goes through, shattering the pane;
//     water slows it hard and soon stops it, a splash where it goes in. Anything else it strikes
//     by the cell's hardness: a round that hits a cell with more than the cell can take breaks it
//     out - thrown on ahead of it as debris, in the cell's colours - and goes on, the slower; one
//     with less stops there (sparks off steel and stone, a puff of dust off earth), or glances off
//     a hard face it meets at a slant. A bullet chips soil, brick and plaster and stops in steel;
//     an armour-piercing dart bores through metres of earth or a wall's thickness of concrete;
//     bedrock and a core's god-metal stop anything, and a building going up shrugs off all but a
//     blast.
//   - an explosive round (a tank's HE shell, a cannon round, a missile) bursts where it strikes,
//     in the last open cell before it: PW.explode, the world's own blast.
// Speeds are the game's - a quarter to a sixth of the real - so a round is seen crossing the
// screen; a cell is 7 cm. Our own code throughout.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { hardness, breaksTo, phase, open } = PW.mat;

  // The rounds (speed: cells/s at the muzzle; drag: of its speed lost a second to the air; punch:
  // what it breaks through, in cells' hardness - see bore; blast: [radius, power] where it bursts;
  // damage: what a direct hit does to a vehicle's armour - see the vehicles; tracer: its streak's
  // colour and length in cells; life: seconds it flies at most).
  const KINDS = {
    // a rifle round (5.56 / 7.62 mm)
    bullet: { speed: 2400, drag: 0.35, punch: 0.33, damage: 0, tracer: [255, 232, 160], len: 9, life: 2, brush: true },
    // a tank's armour-piercing fin-stabilised dart (APFSDS): very fast, flat, boring through
    ap: { speed: 5200, drag: 0.02, punch: 9, damage: 60, tracer: [255, 222, 150], len: 30, life: 5 },
    // a tank's high-explosive shell
    he: { speed: 4000, drag: 0.04, blast: [9, 0.9], damage: 22, tracer: [255, 196, 120], len: 24, life: 6 },
    // a mech's (or a turret's) autocannon round: a small high-explosive one
    cannon: { speed: 3000, drag: 0.1, blast: [3.5, 0.45], damage: 4, tracer: [255, 210, 140], len: 14, life: 4, brush: true },
    // a missile: thrown off its rail at `launch`, then flown on its motor (thrust, for burn seconds)
    // up to its speed, turning for its mark at up to `turn` rad/s; it leaves a trail of smoke
    missile: { speed: 1500, launch: 340, thrust: 2600, burn: 4, turn: 3.2, drag: 0.05, blast: [16, 1.3], damage: 45, len: 7, life: 12, missile: true },
    // a launcher's artillery rocket (a salvo's - Grad, MLRS): off its tube at its speed, flying
    // straight on its motor a moment, then on a high arc, unguided, to burst where it comes down
    rocket: { speed: 1100, launch: 1100, thrust: 0, burn: 0.8, turn: 0, drag: 0.004, blast: [12, 1.1], damage: 40, len: 6, life: 30, missile: true },
    // interceptors (N90, the user's Iron Dome and Patriot): fast, turning hard for the threat they
    // were launched at - led, where it will be - and bursting beside it on their proximity fuse,
    // destroying it more often than not (kill: the share of their bursts that do). Each climbs off its
    // launcher as it was laid for `climb` seconds before it pitches over for its mark - clear of the
    // towers round a town's battery, as a vertical launch is
    interceptor: { speed: 2000, launch: 500, thrust: 5000, burn: 4, turn: 7, drag: 0.02, blast: [5, 0.5], damage: 20, len: 6, life: 8, missile: true, prox: 16, kill: 0.85, climb: 0.45 },
    patriot: { speed: 2400, launch: 400, thrust: 4000, burn: 6, turn: 4.5, drag: 0.01, blast: [9, 0.9], damage: 100, len: 9, life: 12, missile: true, prox: 22, kill: 0.85, climb: 0.45 },
  };
  const WATER_DRAG = 0.8;       // of a round's speed kept per cell of water it goes through
  const SINKS = 260;            // cells/s: slower than this in water, it has stopped
  const GLANCE = 0.3;           // a hard face struck at a slant shallower than this (sine) glances a round off
  const GLANCE_KEEP = 0.55;     // of its speed a glancing round keeps
  const GLASS_KEEP = 0.9;       // ... and one through a pane of glass
  const BREAK_COST = 0.02;      // punch a broken cell costs beyond its hardness

  const stats = { fired: 0, flying: 0, struck: 0, units: 0, broke: 0, glanced: 0, splashed: 0, glass: 0, burst: 0, sank: 0, gone: 0 };
  // (deterministic: no two rounds fly quite alike, the same in every run)
  let seq = 0;
  const rnd = () => (PW.hash3(seq++, 0x5107, 0x2c3) & 0xffff) / 65536;
  const F = () => PW.PARTICLE;
  const G = () => PW.GRAVITY || 260;

  // ---- Who can be hit ---------------------------------------------------------------------------
  // A target: { hit(world, shot, x0, y0, x1, y1) -> { f, x, y, ref, part } | null - the first of its
  // units the round's path this tick strikes, f the share of the way along it; strike(world, ref,
  // shot, x, y, part) -> true when the round stops there }.
  const targets = [];
  function addTarget(t) { if (t && !targets.includes(t)) targets.push(t); }
  if (PW.tanks && PW.tanks.target) addTarget(PW.tanks.target);

  // ---- Firing -------------------------------------------------------------------------------------
  // spec: { kind, x, y (the muzzle), dx, dy (which way: need not be a unit), side, from (the unit
  // firing: never struck by its own round), target (a missile's mark: anything with x, y - read
  // each tick, so a moving mark is followed - and aimDy, how far above its y to aim), spread
  // (radians: the round leaves within half of it either side), vx0, vy0 (the firer's own way) }
  function fire(world, spec) {
    const kind = KINDS[spec.kind] ? spec.kind : 'bullet', k = KINDS[kind];
    let dx = spec.dx ?? 1, dy = spec.dy ?? 0;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    if (spec.spread) {
      const a = (rnd() - 0.5) * spec.spread, c = Math.cos(a), s = Math.sin(a);
      [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    }
    const speed = spec.speed ?? (k.missile ? k.launch : k.speed);
    const shot = { kind, k, x: spec.x, y: spec.y, vx: dx * speed + (spec.vx0 || 0), vy: dy * speed + (spec.vy0 || 0),
      e: k.punch || 0, side: spec.side || null, from: spec.from || null, target: spec.target || null, aimDy: spec.aimDy || 0,
      age: 0, fuel: k.burn || 0, run: 0, wet: false, done: false, n: seq, id: stats.fired, look: spec.look || null, x0: spec.x, y0: spec.y };
    (world.shots || (world.shots = [])).push(shot);
    stats.fired += 1;
    return shot;
  }

  // ---- Flight -------------------------------------------------------------------------------------
  let stepping = null;
  function step(world, dt) {
    // (the bursts of drawn rounds where they struck: see draw)
    if (world.shotHits && world.shotHits.length) { for (const h of world.shotHits) h.age += dt; while (world.shotHits.length && world.shotHits[0].age > HIT_FOR) world.shotHits.shift(); }
    const list = world.shots;
    if (!list || !list.length) { stats.flying = 0; return; }
    stepping = world;
    let w = 0;
    for (let q = 0; q < list.length; q += 1) {
      const s = list[q];
      if (!s.done) {
        const gone = stats.gone;
        fly(world, s, dt);
        // (a round drawn as the user drew it bursts as drawn where it struck - not gone off the world)
        if (s.done && s.look && stats.gone === gone) {
          const sp = Math.hypot(s.vx, s.vy) || 1;
          (world.shotHits || (world.shotHits = [])).push({ x: s.x, y: s.y, ux: s.vx / sp, uy: s.vy / sp, look: s.look, age: 0 });
          if (world.shotHits.length > 96) world.shotHits.shift();
        }
      }
      if (!s.done) list[w++] = s;
    }
    list.length = w;
    stats.flying = w;
    stepping = null;
  }
  function fly(world, s, dt) {
    const { k } = s;
    s.age += dt;
    if (s.age > k.life) { s.done = true; stats.gone += 1; if (k.blast && k.missile) burst(world, s, s.x, s.y); return; }
    if (k.missile) steer(world, s, dt);
    s.vy += G() * dt;
    const keep = 1 - k.drag * dt;
    s.vx *= keep; s.vy *= keep;
    const x1 = s.x + s.vx * dt, y1 = s.y + s.vy * dt;
    s.px = s.x; s.py = s.y;
    if (travel(world, s, x1, y1) && !s.done) { s.x = x1; s.y = y1; }
    s.run += Math.hypot(s.x - s.px, s.y - s.py);
    if (s.y > world.height + 20 || s.x < -200 || s.x > world.width + 200) { s.done = true; stats.gone += 1; }
    // (an interceptor's proximity fuse: passing close enough to what it was launched at - the nearest
    // it came all this tick, the two closing faster than a tick's step - it bursts, and, a round of
    // the fuse's share, destroys it)
    if (!s.done && k.prox && s.target && !s.target.done && !s.target.dead) {
      const t = s.target, [tvx, tvy] = velOf(t);
      const rx = s.x - t.x, ry = s.y - (t.y - (s.aimDy || 0)), dx = (s.vx - tvx) * dt, dy = (s.vy - tvy) * dt;
      // (r: where it is from its mark now; it was r - d a tick ago)
      const u = Math.max(0, Math.min(1, ((rx - dx) * -dx + (ry - dy) * -dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(rx - dx + dx * u, ry - dy + dy * u) < k.prox) {
        burst(world, s, s.x, s.y);
        if (t.k && (PW.hash3(s.n, 0x1e, 0x77) & 1023) / 1023 < k.kill) intercepted(world, t);
      }
    }
    // (what it was launched at gone - destroyed by another - it destroys itself up in the sky: at
    // once if it is well up, else once it is; its motor out and its mark getting further off - it
    // missed - the same)
    if (!s.done && k.prox) {
      const t = s.target, gone = !t || t.done || t.dead;
      if (gone) {
        const xi = Math.max(0, Math.min(world.width - 1, Math.floor(s.x)));
        if (!(s.fuel > 0) || s.y < world.groundTop[xi] - SELF_DESTRUCT) burst(world, s, s.x, s.y);
      } else if (!(s.fuel > 0)) {
        const d = Math.hypot(s.x - t.x, s.y - t.y);
        if (d > s.dPrev) burst(world, s, s.x, s.y);
        else s.dPrev = d;
      }
    }
  }
  const SELF_DESTRUCT = 150;    // cells over the ground an interceptor that has lost its mark must be to burst
  // (the way and speed of a mark: a round in flight, a jet, a tank driving, a trooper running)
  function velOf(t) {
    if (t.k) return [t.vx, t.vy];
    if (t.kind === 'jet' && PW.jets) { const h = PW.jets.heading(t); return [Math.cos(h) * t.v, -Math.sin(h) * t.v]; }
    if (Number.isFinite(t.vx)) return [t.vx, t.vy || 0];
    if (Number.isFinite(t.v)) return [t.v * Math.cos(t.angle || 0), 0];
    return [0, 0];
  }
  // (where a guided round steers for: its mark - led, where the mark will be when it gets there at
  // its own speed, the meeting worked out; a round falling free, its fall too)
  function aimOf(s) {
    const t = s.target;
    let tx = t.x, ty = t.y - (s.aimDy || 0);
    const [tvx, tvy] = velOf(t);
    if (tvx || tvy) {
      // (tau: when the two meet - |D + V tau| = S tau, S its own speed)
      const Dx = tx - s.x, Dy = ty - s.y, S = Math.max(300, Math.hypot(s.vx, s.vy), s.fuel > 0 ? s.k.speed * 0.8 : 0);
      const a = tvx * tvx + tvy * tvy - S * S, b = 2 * (Dx * tvx + Dy * tvy), c = Dx * Dx + Dy * Dy;
      let tau = a < -1e-6 ? (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a) : Math.sqrt(c) / S;
      tau = Math.max(0, Math.min(3, tau));
      tx += tvx * tau; ty += tvy * tau;
      if (t.k && !(t.fuel > 0)) ty += 0.5 * G() * tau * tau;
    }
    return [tx, ty];
  }
  // A threat in flight destroyed by an interceptor's burst: its warhead goes up in the sky, and what
  // is left of it falls, burning.
  function intercepted(world, t) {
    if (t.done) return;
    t.done = true; t.intercepted = true;
    stats.intercepted = (stats.intercepted || 0) + 1;
    if (PW.explode) PW.explode(world, world.particles, { x: t.x, y: t.y, radius: 5, power: 0.5 });
    const particles = world.particles, fl = F();
    if (particles) for (let k = 0; k < 8; k += 1) particles.spawn(t.x, t.y, t.vx * 0.2 + (rnd() - 0.5) * 120, t.vy * 0.2 - rnd() * 60, M.DEBRIS | PW.DEBRIS_KIND.METAL << 6, 0, fl.LAND, 6);
  }
  // A missile on its motor: turning for its mark, speeding up to its speed, its smoke trailing.
  function steer(world, s, dt) {
    const { k } = s;
    if (s.fuel <= 0) {
      // (its motor burnt out, an interceptor still steers on its fins for what it was launched at -
      // turning its way, no faster)
      if (k.prox && s.target && !s.target.done && !s.target.dead) {
        const [tx, ty] = aimOf(s), sp = Math.hypot(s.vx, s.vy);
        let a = Math.atan2(s.vy, s.vx), d = Math.atan2(ty - s.y, tx - s.x) - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        a += Math.max(-k.turn * dt, Math.min(k.turn * dt, d));
        s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
      }
      return;
    }
    s.fuel -= dt;
    const sp = Math.hypot(s.vx, s.vy);
    let a = Math.atan2(s.vy, s.vx);
    // (it clears its rail - an interceptor its launcher's surroundings - before it turns; an
    // interceptor whose mark is gone flies on straight)
    if (s.target && s.age > (k.climb || 0.2) && !(k.prox && (s.target.done || s.target.dead))) {
      const [tx, ty] = aimOf(s);
      let d = Math.atan2(ty - s.y, tx - s.x) - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a += Math.max(-k.turn * dt, Math.min(k.turn * dt, d));
    }
    // (its motor holds it up against gravity as it flies: what gravity takes, the motor gives)
    const v = Math.min(k.speed, sp + k.thrust * dt);
    s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v - G() * dt;
    trail(world, s, dt);
  }
  // (the smoke it leaves all along the way it flew this tick - a ribbon of smoke pixels, rising and
  // drifting on the wind, thinning - and the flame at its tail)
  const TRAIL_TONES = [[200, 197, 192], [176, 172, 167], [150, 146, 141]];
  const TRAIL_EVERY = 1.6;      // cells of its path to each pixel of its smoke
  function trail(world, s, dt) {
    const particles = world.particles;
    if (!particles) return;
    const sp = Math.hypot(s.vx, s.vy) || 1, ux = s.vx / sp, uy = s.vy / sp, fl = F();
    const run = sp * dt, n = Math.min(40, Math.ceil(run / TRAIL_EVERY));
    for (let q = 0; q < n; q += 1) {
      const back = 6 + run * q / n, t = TRAIL_TONES[Math.floor(rnd() * 3)], w = (rnd() - 0.5) * 2.2;
      particles.spawn(s.x - ux * back - uy * w, s.y - uy * back + ux * w, (rnd() - 0.5) * 10, -3 - rnd() * 6, 0,
        PW.abgr(t[0], t[1], t[2], 200), fl.SMOKE | fl.THIN, 2.5 + rnd() * 3);
    }
    particles.spawn(s.x - ux * 4, s.y - uy * 4, -ux * 60, -uy * 60, 0, PW.abgr(255, 214, 120), fl.GLOW, 0.06, 0, 1100);
  }

  // Its path this tick, (s.x, s.y) to (x1, y1), cell by cell - each cell it enters, in order, and
  // the share of the way along it is - against the units on it, and the world's cells. (True when
  // it went all the way; where it stopped or glanced off, it is left there.)
  function travel(world, s, x1, y1) {
    const x0 = s.x, y0 = s.y;
    let unit = null;
    for (const t of targets) {
      const h = t.hit(world, s, x0, y0, x1, y1);
      if (h && (!unit || h.f < unit.f)) { unit = h; unit.by = t; }
    }
    const { mat, width: W, height: H } = world;
    let cx = Math.floor(x0), cy = Math.floor(y0), lx = cx, ly = cy;
    const dx = x1 - x0, dy = y1 - y0, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity;
    let tx = dx ? (dx > 0 ? cx + 1 - x0 : x0 - cx) * tdx : Infinity, ty = dy ? (dy > 0 ? cy + 1 - y0 : y0 - cy) * tdy : Infinity;
    for (let guard = 0; guard < 4096; guard += 1) {
      let f;
      if (tx < ty) { if (tx > 1) break; f = tx; cx += sx; tx += tdx; } else { if (ty > 1) break; f = ty; cy += sy; ty += tdy; }
      if (unit && unit.f <= f) { strikeUnit(world, s, unit); return false; }
      if (cx < 1 || cx >= W - 1 || cy >= H - 1) { s.done = true; stats.gone += 1; return false; }
      if (cy < 0) { lx = cx; ly = cy; continue; }            // (over the top of the world: open sky)
      const i = cy * W + cx, id = mat[i] & ID_MASK;
      if (open[id]) {
        // (N117: a rifle round or a cannon round through a tree, or an enemy's ornament - see brush)
        if (s.k.brush && brush(world, s, cx, cy, lx, ly)) return false;
        lx = cx; ly = cy; continue;
      }
      if (id === M.WATER) {
        if (!s.wet) { s.wet = true; splash(world, s, cx, cy); if (s.k.blast) { burst(world, s, lx + 0.5, ly + 0.5); return false; } }
        s.vx *= WATER_DRAG; s.vy *= WATER_DRAG;
        if (Math.hypot(s.vx, s.vy) < SINKS) { s.done = true; s.x = cx + 0.5; s.y = cy + 0.5; stats.sank += 1; return false; }
        lx = cx; ly = cy;
        continue;
      }
      // (a match's rule - see PW.game.cover: a building's own side's rounds pass it untouched, as
      // if they went by it at another depth - nothing broken, bored, glanced off or burst)
      if (PW.game && PW.game.cover && PW.mat.phase[id] === PW.PHASE.SOLID) {
        const owner = PW.getOwner(world, cx, cy);
        if (owner > 0 && owner < 50000 && PW.game.cover(s, owner, cx, cy) === true) { stats.covered = (stats.covered || 0) + 1; lx = cx; ly = cy; continue; }
      }
      if (id === M.GLASS) { shatter(world, s, cx, cy); lx = cx; ly = cy; continue; }
      if (!PW.mat.stopsShots[id]) { lx = cx; ly = cy; continue; }
      stats.struck += 1;
      if (s.k.blast) { burst(world, s, lx + 0.5, ly + 0.5); return false; }
      const how = bore(world, s, cx, cy, id);
      if (how === 'on') { lx = cx; ly = cy; continue; }
      // (glanced off - it goes on from here next tick - or stopped in it)
      if (how !== 'glance') s.done = true;
      s.x = lx + 0.5; s.y = ly + 0.5;
      return false;
    }
    // (a unit struck past the last cell it crossed)
    if (unit) { strikeUnit(world, s, unit); return false; }
    return true;
  }

  // A kinetic round meets a cell: it breaks it out and goes on, glances off it, or stops in it.
  function bore(world, s, x, y, id) {
    const h = hardness[id], particles = world.particles, fl = F();
    const sp = Math.hypot(s.vx, s.vy) || 1;
    // (bedrock and the god's metal take anything; a building going up shrugs off all but a blast)
    const proof = h >= 0.95 || id === M.CORE || (PW.growing && PW.growing(world, x, y));
    if (!proof && s.e >= h * (0.6 + rnd() * 0.8)) {
      breakOut(world, s, x, y, id, 0.12);
      const e0 = s.e;
      s.e -= h + BREAK_COST;
      const keep = Math.sqrt(Math.max(0, s.e) / e0);
      s.vx *= keep; s.vy *= keep;
      // (a dart's hole is ragged: now and then the cell beside its path goes too)
      if (s.e > 2 && rnd() < 0.5) {
        const ox = Math.round(-s.vy / sp), oy = Math.round(s.vx / sp), side = rnd() < 0.5 ? 1 : -1;
        const bx = x + ox * side, by = y + oy * side, bid = PW.get(world, bx, by) & ID_MASK;
        if (PW.mat.stopsShots[bid] && hardness[bid] < 0.95 && bid !== M.CORE && hardness[bid] < s.e) breakOut(world, s, bx, by, bid, 0.08);
      }
      return s.e > 0 ? 'on' : 'stop';
    }
    // (a hard face struck at a slant: it glances off, the slower)
    const [nx, ny] = normal(world, x, y);
    const into = -(s.vx * nx + s.vy * ny) / sp;
    if (h >= 0.4 && (nx || ny) && into > 0 && into < GLANCE) {
      const d = s.vx * nx + s.vy * ny;
      s.vx = (s.vx - 2 * d * nx) * GLANCE_KEEP; s.vy = (s.vy - 2 * d * ny) * GLANCE_KEEP;
      s.e *= 0.5;
      stats.glanced += 1;
      if (particles) sparks(particles, x + 0.5, y + 0.5, s.vx * 0.2, s.vy * 0.2, 2);
      return 'glance';
    }
    // Stopped: sparks off what is hard, a puff of dust off what is not.
    if (particles) {
      if (h >= 0.4) sparks(particles, x + 0.5 - s.vx / sp, y + 0.5 - s.vy / sp, -s.vx * 0.06, -s.vy * 0.06, s.kind === 'bullet' ? 3 : 8);
      puff(particles, x + 0.5 - s.vx / sp, y + 0.5 - s.vy / sp, -s.vx / sp, -s.vy / sp, s.kind === 'bullet' ? 3 : 10, id);
    }
    return 'stop';
  }
  // (a cell broken out by a round: thrown on ahead as debris - in its own colours - the building it
  // was part of told it is hurt)
  function breakOut(world, s, x, y, id, share) {
    const particles = world.particles;
    const owner = PW.getOwner(world, x, y), paint = PW.getLayer(world, 'paint', x, y);
    PW.set(world, x, y, M.AIR);
    PW.clearPaintAt(world, x, y);
    if (particles) particles.spawn(x + 0.5, y + 0.5, s.vx * share + (rnd() - 0.5) * 50, s.vy * share - 20 - rnd() * 30, breaksTo[id] || M.DEBRIS, paint || 0, F().LAND, 5, owner);
    stats.broke += 1;
    if (owner > 0 && owner < 50000 && world.onDamage) world.onDamage(owner, 1, x, y);
    // (a blow: what the round cut loose of it comes down - see PW structure's urgent)
    if (owner > 0 && owner < 50000 && world.structure && world.structure.urgent) world.structure.urgent(owner);
  }
  // (which way a struck cell's face looks: out through its open neighbours)
  function normal(world, x, y) {
    const { mat, width: W } = world;
    let nx = 0, ny = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const id = mat[(y + dy) * W + x + dx] & ID_MASK;
      if (open[id] || id === M.WATER) { nx += dx; ny += dy; }
    }
    const d = Math.hypot(nx, ny);
    return d ? [nx / d, ny / d] : [0, 0];
  }
  // ---- Through trees and ornaments (N117, the user's: some rounds are stopped by trees, and by an
  // enemy's deco, instead of all passing through) ---------------------------------------------------
  // A tree is drawn on open air, so a round used to pass it untouched. Now, a rifle round or a cannon
  // round (brush) crossing one:
  //   - its wood - trunk, boughs - takes its punch, WOOD_COST a cell: some 35 cm of trunk stops a
  //     rifle round, a bough slows it; a cannon round bursts on a trunk (WOOD_BURST cells of wood);
  //   - each of its leaves is a LEAF_STOP chance of stopping it - a leaf does little to a round, a
  //     crown's depth of them some, its boughs the rest (their wood, as the trunk's);
  //   - stopped, a chip of bark or a leaf knocked off flies.
  // An ornament, a railing, an awning of a building of another side (deco over open air) is a
  // DECO_STOP chance a cell, chipped now and then; its own side's rounds pass it, as they pass the
  // building (see PW.game.cover). Street furniture of no side, and tank shells, missiles and rockets,
  // pass as before. (Which round is stopped is its own, the same every run.)
  const WOOD_COST = 0.07, WOOD_BURST = 3, LEAF_STOP = 0.004, DECO_STOP = 0.2;
  // (each round its own: by its number among all fired - two fired alike still fare apart)
  const chance = (s, x, y, salt) => (PW.hash3(s.id * 7 + salt, x, y) & 0xffff) / 65536;
  function brush(world, s, x, y, lx, ly) {
    const f = PW.getFlags(world, x, y), fl = PW.FLAG, owner = PW.getOwner(world, x, y);
    let stop = false, burstNow = false;
    // (a plant's cell: flagged one and nobody's - a building's ornament stamped where a plant once
    // stood is the building's)
    if ((f & fl.FLORA) && !(owner > 0 && owner < 50000)) {
      if (!PW.getLayer(world, 'deco', x, y)) return false;
      if (f & fl.WOOD) {
        s.wood = (s.wood || 0) + 1;
        if (s.k.blast) burstNow = s.wood >= WOOD_BURST;
        else { s.e -= WOOD_COST; stop = s.e <= 0; }
      } else if (chance(s, x, y, 1) < LEAF_STOP) { if (s.k.blast) burstNow = true; else stop = true; }
      if (!stop && !burstNow) return false;
      stats.byTrees = (stats.byTrees || 0) + 1;
    } else {
      const deco = PW.getLayer(world, 'deco', x, y);
      if (!deco) return false;
      const b = owner > 0 && owner < 50000 && world.buildings ? world.buildings[owner - 1] : null;
      if (!b) return false;
      const side = b.faction || b.side;
      if (side && s.side && side === s.side) return false;
      if (chance(s, x, y, 2) >= DECO_STOP) return false;
      if (s.k.blast) burstNow = true; else stop = true;
      stats.byDeco = (stats.byDeco || 0) + 1;
    }
    stats.struck += 1;
    if (burstNow) { burst(world, s, lx + 0.5, ly + 0.5); return true; }
    // (a chip of what stopped it, flying back; a leaf or an ornament's cell now and then knocked off)
    const particles = world.particles, colour = PW.getLayer(world, 'deco', x, y);
    if (particles && colour) particles.spawn(x + 0.5, y + 0.5, -s.vx * 0.02 + (rnd() - 0.5) * 50, -20 - rnd() * 40, 0, colour, (f & fl.WOOD) ? 0 : F().LEAF, (f & fl.WOOD) ? 0.6 : 1.5);
    if (!(f & fl.WOOD) && chance(s, x, y, 3) < 0.5) PW.setLayer(world, 'deco', x, y, 0);
    s.done = true; s.x = lx + 0.5; s.y = ly + 0.5;
    return true;
  }
  function shatter(world, s, x, y) {
    const particles = world.particles;
    const paint = PW.getLayer(world, 'paint', x, y), owner = PW.getOwner(world, x, y);
    PW.set(world, x, y, M.AIR);
    PW.clearPaintAt(world, x, y);
    if (particles) for (let n = 0; n < 2; n += 1) particles.spawn(x + 0.5, y + 0.5, s.vx * 0.05 + (rnd() - 0.5) * 60, s.vy * 0.05 - rnd() * 30, breaksTo[M.GLASS] || M.DEBRIS, paint || 0, F().LAND, 4, owner);
    s.vx *= GLASS_KEEP; s.vy *= GLASS_KEEP;
    stats.glass += 1;
    if (owner > 0 && owner < 50000 && world.onDamage) world.onDamage(owner, 1, x, y);
  }
  function splash(world, s, x, y) {
    stats.splashed += 1;
    const particles = world.particles;
    if (!particles) return;
    const big = s.k.blast ? 10 : s.kind === 'bullet' ? 3 : 7;
    for (let n = 0; n < big; n += 1) particles.spawn(x + 0.5 + (rnd() - 0.5) * 2, y - 0.5, (rnd() - 0.5) * 40 + s.vx * 0.02, -60 - rnd() * 90 * (big / 5), M.WATER, 0, F().WATER, 4);
  }
  function burst(world, s, x, y) {
    s.done = true; s.x = x; s.y = y;
    stats.burst += 1;
    const [radius, power] = s.k.blast;
    if (PW.explode) PW.explode(world, world.particles, { x, y, radius, power });
  }
  // A round strikes a unit: the unit takes it (see its target); an explosive one bursts on it.
  function strikeUnit(world, s, u) {
    stats.units += 1;
    const stops = u.by.strike(world, u.ref, s, u.x, u.y, u.part);
    if (s.k.blast) {
      const sp = Math.hypot(s.vx, s.vy) || 1;
      burst(world, s, u.x - s.vx / sp * 1.5, u.y - s.vy / sp * 1.5);
      return;
    }
    if (stops !== false) { s.done = true; s.x = u.x; s.y = u.y; }
  }

  // ---- What it throws -------------------------------------------------------------------------------
  // (sparks: white-hot to orange, short, bouncing back off what was struck)
  const SPARK_TONES = [[255, 250, 220], [255, 222, 120], [255, 170, 60]];
  function sparks(particles, x, y, vx, vy, n) {
    for (let k = 0; k < n; k += 1) {
      const t = SPARK_TONES[k % 3], a = rnd() * Math.PI * 2, sp = 60 + rnd() * 160;
      particles.spawn(x, y, vx + Math.cos(a) * sp, vy + Math.sin(a) * sp - 30, 0, PW.abgr(t[0], t[1], t[2]), F().GLOW, 0.08 + rnd() * 0.22, 0, 1200);
    }
  }
  // (a puff of what it struck: dust off earth, grit off stone and brick - out of the face)
  const DUST_TONES = [[160, 142, 112], [138, 122, 96], [118, 104, 84]], GRIT_TONES = [[150, 145, 139], [126, 121, 116], [104, 100, 96]];
  function puff(particles, x, y, nx, ny, n, id) {
    const tones = PW.mat.terrain[id] ? DUST_TONES : GRIT_TONES;
    for (let k = 0; k < n; k += 1) {
      const t = tones[k % 3], sp = 20 + rnd() * 50;
      particles.spawn(x, y, nx * sp + (rnd() - 0.5) * 30, ny * sp - 10 - rnd() * 15, 0, PW.abgr(t[0], t[1], t[2], 170), F().SMOKE | F().THIN, 0.6 + rnd() * 0.9);
    }
  }
  // A gun's report at its muzzle: the flash, the smoke blown out ahead of it and, near the ground,
  // the dust its blast kicks up (`size`: 1 a rifle, about 6 a tank's gun).
  function report(world, x, y, dx, dy, size = 1) {
    const particles = world.particles;
    if (!particles) return;
    const fl = F(), d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    for (let k = 0, n = Math.round(2 + size * 3); k < n; k += 1) {
      const t = SPARK_TONES[k % 3], a = (rnd() - 0.5) * 0.9, sp = (40 + rnd() * 90) * Math.sqrt(size);
      const c = Math.cos(a), s = Math.sin(a), vx = (ux * c - uy * s) * sp, vy = (ux * s + uy * c) * sp;
      particles.spawn(x + ux * rnd() * size, y + uy * rnd() * size, vx, vy, 0, PW.abgr(t[0], t[1], t[2]), fl.GLOW, 0.04 + rnd() * 0.06 * Math.sqrt(size), 0, 1300);
    }
    for (let k = 0, n = Math.round(size * size * 2); k < n; k += 1) {
      const t = GRIT_TONES[k % 3], sp = (20 + rnd() * 70) * Math.sqrt(size), a = (rnd() - 0.5) * 1.4;
      const c = Math.cos(a), s = Math.sin(a);
      particles.spawn(x + ux * size * rnd() * 2, y + uy * size * rnd() * 2, (ux * c - uy * s) * sp, (ux * s + uy * c) * sp - 6, 0,
        PW.abgr(t[0], t[1], t[2], 200), fl.SMOKE | fl.THIN, 1.5 + rnd() * 2 * Math.sqrt(size));
    }
    // (the ground under a big gun's muzzle: dust blown off it to both sides)
    if (size >= 3) {
      const { width: W, groundTop } = world, gx = Math.max(0, Math.min(W - 1, Math.round(x)));
      const g = groundTop[gx];
      if (g - y < size * 5 && g >= y) {
        const tones = PW.mat.terrain[PW.get(world, gx, g) & ID_MASK] ? DUST_TONES : GRIT_TONES;
        for (let k = 0, n = Math.round(size * 4); k < n; k += 1) {
          const t = tones[k % 3], side = k & 1 ? 1 : -1;
          particles.spawn(x + side * rnd() * size * 2, g - 1 - rnd() * 3, side * (40 + rnd() * 90), -10 - rnd() * 25, 0, PW.abgr(t[0], t[1], t[2], 180), fl.SMOKE | fl.THIN, 1.5 + rnd() * 2);
        }
      }
    }
  }

  // ---- Drawing ------------------------------------------------------------------------------------
  // A round in flight is drawn as its tracer: a streak back along its path from where it is, bright
  // at its head, over what it has flown this frame and the last (never back past its muzzle); a
  // missile as its body, its flame bright at its tail while its motor burns.
  // A round with a look of its own - the hopper's cannon's, the user's Bullet.gif - is drawn as drawn:
  // its head and its trail growing behind it as it flies (the drawing's first frames, by how far it
  // has flown), turned the way it flies; where it strikes, the drawing's burst plays out.
  const HIT_FOR = 0.48;
  let looks = null;
  function lookOf(name) {
    if (!looks) {
      looks = {};
      const B = PW.mechs && PW.mechs.bullet && PW.mechs.bullet();
      if (B) {
        const frames = B.frames.map((b64) => {
          const bin = atob(b64), cells = [];
          for (let i = 0; i + 2 < bin.length; i += 3) { const c = B.colours[bin.charCodeAt(i + 2)]; cells.push([bin.charCodeAt(i), bin.charCodeAt(i + 1), `rgb(${c[0]},${c[1]},${c[2]})`]); }
          return cells;
        });
        // (in flight: about its head - its leftmost cell, as it flies left; struck: about where it struck)
        const [, hy] = B.head, firstHit = frames.findIndex((f, i) => i > 0 && f.length && Math.min(...f.map((q) => q[0])) === 0 && i >= 7) + 1;
        const fly = frames.slice(0, firstHit).map((f) => { const hx = Math.min(...f.map((q) => q[0])); return { len: Math.max(...f.map((q) => q[0])) - hx, cells: f.map(([x, y, c]) => [x - hx, y - hy, c]) }; });
        const burst = frames.slice(firstHit).map((f) => f.map(([x, y, c]) => [x, y - hy, c]));
        looks.hopper = { fly, burst };
      }
    }
    return looks[name] || null;
  }
  // (cells of a drawing facing left, about (0, 0), laid at (x, y) going (ux, uy))
  function drawn(ctx, cells, x, y, ux, uy, cell) {
    for (const [dx, dy, col] of cells) {
      ctx.fillStyle = col;
      ctx.beginPath(); cell(x - ux * dx + uy * dy, y - uy * dx - ux * dy); ctx.fill();
    }
  }
  function draw(renderer, world) {
    world = world || renderer.world || (window.pwApp && window.pwApp.world);
    const list = world && world.shots, hits = world && world.shotHits;
    if ((!list || !list.length) && (!hits || !hits.length)) return;
    const { ctx, camera, view } = renderer, z = camera.zoom, size = Math.max(1, Math.round(z));
    const vx0 = camera.x - 40, vy0 = camera.y - 40, vx1 = camera.x + view.width / z + 40, vy1 = camera.y + view.height / z + 40;
    const cell = (x, y) => ctx.rect(Math.round((Math.floor(x) - camera.x) * z), Math.round((Math.floor(y) - camera.y) * z), size, size);
    for (const h of hits || []) {
      const L = lookOf(h.look);
      if (!L || h.x < vx0 || h.x > vx1 || h.y < vy0 || h.y > vy1) continue;
      const f = L.burst[Math.min(L.burst.length - 1, Math.floor(h.age / HIT_FOR * L.burst.length))];
      if (f) drawn(ctx, f, h.x, h.y, h.ux, h.uy, cell);
    }
    for (const s of list || []) {
      if (s.done || s.x < vx0 || s.x > vx1 || s.y < vy0 || s.y > vy1) continue;
      const sp = Math.hypot(s.vx, s.vy) || 1, ux = s.vx / sp, uy = s.vy / sp;
      const L = s.look && lookOf(s.look);
      if (L) {
        let f = L.fly[0];
        for (const q of L.fly) if (q.len <= s.run + 1) f = q;
        drawn(ctx, f.cells, s.x, s.y, ux, uy, cell);
        continue;
      }
      if (s.k.missile) {
        ctx.fillStyle = 'rgb(84,88,86)';
        ctx.beginPath();
        for (let q = 0; q < 6; q += 1) cell(s.x - ux * q, s.y - uy * q);
        ctx.fill();
        ctx.fillStyle = 'rgb(200,204,198)';
        ctx.beginPath(); cell(s.x, s.y); ctx.fill();
        if (s.fuel > 0) { ctx.fillStyle = 'rgb(255,230,150)'; ctx.beginPath(); cell(s.x - ux * 6.5, s.y - uy * 6.5); cell(s.x - ux * 7.5, s.y - uy * 7.5); ctx.fill(); }
        continue;
      }
      const [r, g, b] = s.k.tracer, len = Math.min(s.k.len, s.run + 1, Math.max(3, sp / 60 * 2));
      for (let q = 0, n = Math.ceil(len); q < n; q += 1) {
        const a = 1 - q / n;
        ctx.fillStyle = `rgba(${r},${g},${b},${(0.25 + 0.75 * a).toFixed(2)})`;
        ctx.beginPath(); cell(s.x - ux * q, s.y - uy * q); ctx.fill();
      }
    }
  }

  // The world's loop steps the rounds (PW.shots.step each tick); until it does, the tanks' step does
  // (see pw-tank) - `looped` set by a loop that steps them itself.
  PW.shots = { fire, step, draw, report, addTarget, targets, stats, KINDS, looped: false, get stepping() { return stepping; },
    spark: (world, x, y, vx, vy, n) => { if (world.particles) sparks(world.particles, x, y, vx, vy, n); } };
})();
