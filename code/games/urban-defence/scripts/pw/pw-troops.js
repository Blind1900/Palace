'use strict';
// Troopers (N88, N90): ground units against the environment - the user's trooper GIFs (see
// pw-unit-art) at their real size, 25 cells (about 1.8 m), in the world's cells:
// - they walk over the ground cell by cell, stepping up what is no more than about a third of their
//   height (a kerb, a stair, a rubble lip) where there is room for their head, sticking to the
//   ground going down a slope or off a small ledge rather than flying off it; a wall stops them.
//   A ladder they climb; a stair or a grating (a platform) they stand on from above and go up
//   through; crouched, they are shorter - under a low roof, behind cover (sandbags, rocks, crates:
//   cells a round stops in but a man walks past);
// - in water they wade, and deep in it swim, their head kept above it, carried along by a current;
//   held under it they drown;
// - a blast throws them by how near and hard it is - less for what cover stands between - and a
//   hard landing hurts, as a long fall does;
// - what falls on them strikes them (a falling piece of a building, a tree); a slide or a heap that
//   comes down over them buries them: they dig themselves out - sideways and up, at most as steep
//   as a stair's diagonal, never straight up (the user's) - unless more than their own height of it
//   lies over them, and that kills them;
// - each carries a rifle (a magazine of 30 rounds, PW.shots' bullet), three grenades and, later,
//   a drill. A round strikes them by their body; they die of what kills a man.
// Every trooper can be taken in hand (the user's: every unit can be controlled): A / D walk, W jumps
// (or climbs a ladder), S stops - then crouches, or climbs down; F fires at the spot last clicked
// (or ahead), G throws a grenade there, R reloads; a click aims, a click on one takes it in hand.
// The rules are Terraria's and Powder Toy's foundations as the user asked us to study them, for
// behaviour only - our own code throughout.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, passable, hardness, blastResist } = PW.mat;
  const POWDER = PW.PHASE.POWDER;

  const HEIGHT = 25;            // cells: a trooper standing (the GIF's height)
  const CROUCH = 17;            // ... crouched
  const HALF = 3;               // cells either side of its middle its body takes (6 across: its shoulders)
  const WALK = 22;              // cells/s (about 1.5 m/s)
  const CROUCH_WALK = 10;
  const CLIMB = 14;             // cells/s up or down a ladder
  const SWIM = 9;
  const ACCEL = 160, BRAKE = 220, AIR_ACCEL = 40;   // cells/s^2
  const JUMP = 64;              // cells/s up: half a metre's jump
  const STEP_UP = 9;            // cells it steps straight up, room for its head over it (a third of its height)
  const STEP_DOWN = 6;          // cells it steps down without leaving the ground
  const MAX_FALL = 320;         // cells/s
  const FALL_SAFE = 150;        // cells/s it lands at unhurt (a fall of about 4 m)
  const FALL_HURT = 0.9;        // armour... of its 100, lost for each cell/s over that
  const HP = 100;
  const BREATH = 20;            // s it holds its breath under water
  const DIG_EVERY = 0.12;       // s a cell's step of digging takes
  const DIG_HARD = 0.5;         // what it can dig through with its hands and its rifle butt
  const MAG = 30, ROF = 0.14, RELOAD = 2.4;   // a magazine, s between rounds, s to reload
  const GRENADES = 3, FUSE = 2.6, THROW = 150;  // grenades, s on the fuse, cells/s thrown
  const CORPSE = 15;            // s a dead trooper lies there before it is gone
  const DAMAGE = { bullet: 34, ap: 200, he: 160, cannon: 90, missile: 200 };   // of its 100, by what strikes it

  const G = () => PW.GRAVITY || 260;
  const stats = { created: 0, killed: 0, buried: 0, dugOut: 0, thrown: 0, fired: 0, hurtFalling: 0 };
  let current = null, seq = 0;

  // ---- The cells ---------------------------------------------------------------------------------
  // (what bars a trooper's body: solid ground and structure, a heap of powder - not air, gas,
  // water, cover, a platform; a platform bears it from above, see bears)
  const blocks = (world, x, y) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
    const id = world.mat[y * world.width + x] & ID_MASK;
    return phase[id] >= POWDER && !passable[id] && id !== M.PLATFORM;
  };
  const isWater = (world, x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height && (world.mat[y * world.width + x] & ID_MASK) === M.WATER;
  const isPlatform = (world, x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height && (world.mat[y * world.width + x] & ID_MASK) === M.PLATFORM;
  const ladderAt = (world, x, y) => (PW.getFlags(world, x, y) & PW.FLAG.LADDER) !== 0;
  // (its body at x, its feet on row y, h tall: clear of what bars it)
  function clear(world, x, y, h) {
    const cx = Math.floor(x);
    for (let yy = y - h + 1; yy <= y; yy += 1) for (let xx = cx - HALF; xx < cx + HALF; xx += 1) if (blocks(world, xx, yy)) return false;
    return true;
  }
  // (does the ground bear it under its feet on row y - a platform too, unless it is dropping through,
  // and a ladder's top rung, where it steps off onto what the ladder goes up to)
  function bears(world, t, x, y) {
    const cx = Math.floor(x);
    for (let xx = cx - HALF; xx < cx + HALF; xx += 1) {
      if (blocks(world, xx, y + 1)) return true;
      if (!t.dropping && isPlatform(world, xx, y + 1)) return true;
    }
    return !t.dropping && ladderAt(world, cx, y + 1) && !ladderAt(world, cx, y);
  }
  const heightOf = (t) => (t.crouch ? CROUCH : HEIGHT);

  // ---- A trooper -----------------------------------------------------------------------------------
  // spec: { x, y (its feet's row; the ground under it if left out), side, style (its faction's
  // dress), facing }
  function create(world, spec) {
    const x = spec.x, gy = spec.y ?? groundUnder(world, Math.round(x), 0);
    const t = { kind: 'trooper', x, y: gy, vx: 0, vy: 0, facing: spec.facing || 1, side: spec.side || null, style: spec.style || '',
      hp: HP, dead: false, deadFor: 0, onGround: true, crouch: false, climbing: false, dropping: false, swim: false, wet: 0, flow: 0,
      breath: BREATH, buried: false, digDir: 0, digT: 0, walk: 0, wantUp: 0, travel: 0, lift: 0,
      mag: MAG, ammo: MAG * 4, reload: 0, cooldown: 0, grenades: GRENADES, aim: null, hurtBy: '', fallFrom: gy, seed: ++seq };
    (world.troops || (world.troops = [])).push(t);
    current = world;
    stats.created += 1;
    return t;
  }
  // (the row its feet stand on in column x: just over the ground under row `from`)
  function groundUnder(world, x, from) {
    for (let y = Math.max(0, from); y < world.height - 1; y += 1) if (blocks(world, x, y + 1) || isPlatform(world, x, y + 1)) return y;
    return world.height - 2;
  }

  // ---- Moving ----------------------------------------------------------------------------------------
  function stepOne(world, t, dt) {
    if (t.dead) { t.deadFor += dt; return; }
    if (t.reload > 0) { t.reload -= dt; if (t.reload <= 0) { const n = Math.min(MAG - t.mag, t.ammo); t.mag += n; t.ammo -= n; } }
    if (t.cooldown > 0) t.cooldown -= dt;
    wade(world, t);
    if (t.buried || buriedNow(world, t)) { dig(world, t, dt); return; }
    const h = heightOf(t), g = G();
    // On a ladder: up or down it as it is told, gravity held off; off its top or foot it stands.
    const onLadder = ladderAt(world, Math.floor(t.x), t.y - 4) || ladderAt(world, Math.floor(t.x), t.y + 1);
    if (t.wantUp && onLadder) t.climbing = true;
    if (t.climbing && !onLadder) t.climbing = false;
    if (t.climbing) {
      t.vx = 0; t.vy = 0;
      const cx = Math.floor(t.x);
      t.lift = (t.lift || 0) + t.wantUp * CLIMB * dt;
      while (Math.abs(t.lift) >= 1) {
        const s = Math.sign(t.lift);
        // (up a rung while there is ladder at its feet - at its top it stands on the top rung - and
        // room for its head; down a rung while there is ladder under it, to the ground at its foot)
        if (s > 0 && (!ladderAt(world, cx, t.y) || !clear(world, t.x, t.y - 1, h))) { t.lift = 0; t.climbing = ladderAt(world, cx, t.y); if (!t.climbing) t.wantUp = 0; break; }
        if (s < 0 && (!ladderAt(world, cx, t.y + 1) || !clear(world, t.x, t.y + 1, h))) { t.lift = 0; t.climbing = false; t.wantUp = 0; break; }
        t.y -= s; t.lift -= s; t.fallFrom = t.y;
      }
      t.onGround = bears(world, t, t.x, t.y);
      return;
    }
    // Walking: on to its pace (slower crouched, swimming), braking to a stop; in the air it steers
    // a little. A current carries it.
    const pace = t.swim ? SWIM : t.crouch ? CROUCH_WALK : WALK, want = t.walk * pace;
    // (swimming and not swimming anywhere, it drifts)
    if (!(t.swim && !t.walk)) {
      const a = (t.onGround || t.swim ? (want === 0 || Math.sign(want) !== Math.sign(t.vx) ? BRAKE : ACCEL) : AIR_ACCEL) * dt;
      t.vx = want > t.vx ? Math.min(want, t.vx + a) : Math.max(want, t.vx - a);
    }
    if (t.wet > 0 && t.flow) t.vx += (t.flow - t.vx) * Math.min(1, 2 * t.wet * dt);
    if (t.walk) t.facing = t.walk;
    // Across, a cell at a time: stepping up a step it can, its head clear over it; a wall stops it.
    let dx = t.vx * dt;
    t.travel += Math.abs(dx);
    while (Math.abs(dx) > 1e-9) {
      const s = Math.sign(dx), d = Math.abs(dx) >= 1 ? s : dx, nx = t.x + d;
      if (Math.floor(nx) === Math.floor(t.x) || clear(world, nx, t.y, h)) { t.x = nx; dx -= d; continue; }
      let up = 0;
      if (t.onGround || t.swim) for (let k = 1; k <= STEP_UP; k += 1) if (clear(world, nx, t.y - k, h)) { up = k; break; }
      if (up) { t.x = nx; t.y -= up; t.stepped = (t.stepped || 0) + up; dx -= d; continue; }
      t.vx = 0; break;
    }
    // Up and down: a jump; falling, or held up by the water; landing - hurt by a hard landing.
    if (t.wantUp && t.onGround && !t.swim) { t.vy = -JUMP; t.onGround = false; }
    t.wantUp = 0;
    if (t.swim) {
      // (its head kept over the surface: it rises when under, sinks a little when out)
      const headWet = isWater(world, Math.floor(t.x), t.y - h + 3);
      t.vy += (headWet ? -g * 0.6 : g * 0.25) * dt;
      t.vy *= Math.max(0, 1 - 3 * dt);
      t.vy = Math.max(-40, Math.min(40, t.vy));
    } else if (!t.onGround || t.vy < 0) t.vy = Math.min(MAX_FALL, t.vy + g * dt);
    // (its feet's row stays a whole cell: what it moves by is kept until it makes a cell)
    t.accY = (t.accY || 0) + t.vy * dt;
    while (Math.abs(t.accY) >= 1) {
      const s = Math.sign(t.accY);
      if (s > 0 && bears(world, t, t.x, t.y)) { land(world, t); t.accY = 0; break; }
      if (!clear(world, t.x, t.y + s, h)) { if (s < 0) t.vy = 0; else land(world, t); t.accY = 0; break; }
      t.y += s; t.accY -= s;
    }
    const wasGround = t.onGround;
    t.onGround = bears(world, t, t.x, t.y);
    // (off a small ledge or down a slope: it keeps to the ground, a step down, not a jump into the air)
    if (!t.onGround && wasGround && t.vy >= 0 && !t.swim) {
      for (let k = 1; k <= STEP_DOWN; k += 1) {
        if (!clear(world, t.x, t.y + k, h)) break;
        if (bears(world, t, t.x, t.y + k)) { t.y += k; t.onGround = true; t.vy = 0; break; }
      }
    }
    if (t.onGround) { if (t.vy > 0) t.vy = 0; t.accY = 0; t.fallFrom = t.y; t.dropping = false; }
  }
  function land(world, t) {
    if (t.vy > FALL_SAFE) { hurt(world, t, (t.vy - FALL_SAFE) * FALL_HURT, 'fall'); stats.hurtFalling += 1; }
    t.vy = 0; t.onGround = true;
  }
  // In water: how much of it is under (t.wet), and the way the water there runs (t.flow); deep in
  // it, it swims; its head under, it holds its breath, and drowns.
  const FLOW = 60;
  function wade(world, t) {
    const h = heightOf(t), x = Math.floor(t.x);
    let wet = 0, flow = 0;
    for (let y = t.y - h + 1; y <= t.y; y += 1) {
      if (!isWater(world, x, y)) continue;
      wet += 1;
      const m = world.mat[y * world.width + x];
      if (m & 0x80) flow += m & 0x40 ? FLOW : -FLOW;
    }
    t.wet = wet / h;
    t.flow = wet ? flow / wet : 0;
    t.swim = t.wet > 0.6;
    if (isWater(world, x, t.y - h + 2)) {
      t.breath -= 1 / 60;
      if (t.breath <= 0) hurt(world, t, 30 / 60, 'drowned');
    } else t.breath = Math.min(BREATH, t.breath + 3 / 60);
  }

  // ---- Buried -----------------------------------------------------------------------------------------
  // A heap come down over it - a slide, a building's rubble - buries it: more than half its body, or
  // its head, in it. More than its own height of it over its head kills it; otherwise it digs its
  // way out, a cell's step at a time, sideways and up - the side with less over it - never steeper
  // than a stair's diagonal, never straight up; what it digs it throws back behind it.
  function buriedNow(world, t) {
    const h = heightOf(t), cx = Math.floor(t.x);
    let n = 0, all = 0, head = 0;
    for (let y = t.y - h + 1; y <= t.y; y += 1) for (let x = cx - HALF; x < cx + HALF; x += 1) {
      all += 1;
      if (blocks(world, x, y)) { n += 1; if (y <= t.y - h + 3) head += 1; }
    }
    if (n * 2 < all && head * 2 < HALF * 2 * 3) return false;
    // (how much lies over its head)
    let over = 0;
    for (let y = t.y - h; y > 0 && over <= HEIGHT && blocks(world, cx, y); y -= 1) over += 1;
    t.buried = true; t.digT = 0;
    stats.buried += 1;
    if (over > HEIGHT) { hurt(world, t, HP * 2, 'buried'); return true; }
    // (dig out towards the side with the less over it)
    const depthAt = (x) => { let k = 0; for (let y = t.y - h; y > 0 && k < 60 && blocks(world, x, y); y -= 1) k += 1; return k; };
    t.digDir = depthAt(cx - 12) <= depthAt(cx + 12) ? -1 : 1;
    return true;
  }
  function dig(world, t, dt) {
    if (t.dead) return;
    t.vx = 0; t.vy = 0;
    const h = heightOf(t), cx = Math.floor(t.x);
    // (out: its body clear, and open air over its head - not a hollow it has dug in the heap)
    let open = clear(world, t.x, t.y, h);
    for (let x = cx - 2; x < cx + 2 && open; x += 1) if (blocks(world, x, t.y - h)) open = false;
    if (open) { t.buried = false; stats.dugOut += 1; t.onGround = bears(world, t, t.x, t.y); return; }
    t.breath -= dt;
    if (t.breath <= 0) { hurt(world, t, 30 * dt, 'buried'); if (t.dead) return; }
    t.digT += dt;
    if (t.digT < DIG_EVERY) return;
    t.digT = 0;
    // (a step diagonally up its way - or, that too hard to dig, straight along it; then the other way)
    for (const [ddx, ddy] of [[t.digDir, -1], [t.digDir, 0], [-t.digDir, -1], [-t.digDir, 0]]) {
      const nx = t.x + ddx, ny = t.y + ddy;
      if (!diggable(world, nx, ny, h)) continue;
      carve(world, t, nx, ny, h, ddx);
      t.x = nx; t.y = ny;
      if (ddx !== t.digDir) t.digDir = ddx;
      return;
    }
  }
  function diggable(world, x, y, h) {
    const cx = Math.floor(x);
    for (let yy = y - h + 1; yy <= y; yy += 1) for (let xx = cx - HALF; xx < cx + HALF; xx += 1) {
      if (xx < 1 || yy < 1 || xx >= world.width - 1 || yy >= world.height - 1) return false;
      if (blocks(world, xx, yy) && hardness[world.mat[yy * world.width + xx] & ID_MASK] > DIG_HARD) return false;
    }
    return true;
  }
  function carve(world, t, x, y, h, dir) {
    const cx = Math.floor(x), particles = world.particles, F = PW.PARTICLE;
    for (let yy = y - h + 1; yy <= y; yy += 1) for (let xx = cx - HALF; xx < cx + HALF; xx += 1) {
      if (!blocks(world, xx, yy)) continue;
      const m = world.mat[yy * world.width + xx];
      PW.set(world, xx, yy, M.AIR);
      // (thrown back behind it, a little up, to fall where it came from)
      if (particles && F && (PW.hash3(xx, yy, t.seed) & 3) === 0) particles.spawn(xx + 0.5, yy + 0.5, -dir * (30 + (PW.hash2(xx, yy) & 31)), -20, m & 0xff, 0, F.LAND, 4);
    }
  }

  // ---- Struck, hurt, killed ----------------------------------------------------------------------------
  function hurt(world, t, amount, cause) {
    if (t.dead || !(amount > 0)) return;
    t.hp -= amount;
    t.hurtBy = cause;
    if (t.hp <= 0) { t.hp = 0; t.dead = true; t.deadFor = 0; t.climbing = false; stats.killed += 1; if (held === t) held = null; }
  }
  // A blast (PW.explode) throws the troopers in its reach - by how near and hard, less for the cover
  // between - and hurts them: one close to it is killed.
  function blast(world, cx, cy, r, power = 1) {
    const list = world.troops;
    if (!list || !list.length) return;
    for (const t of list) {
      if (t.dead) continue;
      const h = heightOf(t), mx = Math.max(t.x - HALF, Math.min(t.x + HALF, cx)), my = Math.max(t.y - h + 1, Math.min(t.y, cy));
      const d = Math.hypot(mx - cx, my - cy), reach = r * 2 + 10;
      if (d >= reach) continue;
      const k = power * (1 - d / reach) - cover(world, cx, cy, mx, my);
      if (k <= 0) continue;
      const ux = (t.x - cx) / (Math.hypot(t.x - cx, t.y - h / 2 - cy) || 1);
      t.vx += ux * 260 * k; t.vy = Math.min(t.vy, -140 * k);
      t.onGround = false; t.climbing = false; t.buried = false;
      stats.thrown += 1;
      hurt(world, t, 140 * k * k, 'blast');
    }
  }
  // (the blast strength lost between two points: what it passes through - see PW.tanks)
  function cover(world, x0, y0, x1, y1) {
    const { mat, width: W, height: H } = world, n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    let lost = 0;
    for (let q = 1; q < n; q += 1) {
      const x = Math.floor(x0 + (x1 - x0) * q / n), y = Math.floor(y0 + (y1 - y0) * q / n);
      if (x >= 0 && y >= 0 && x < W && y < H) lost += blastResist[mat[y * W + x] & ID_MASK];
    }
    return lost;
  }
  // (its body at world point (x, y): for what falls on it - see pw-fragments' glance)
  function touches(t, x, y) {
    if (t.dead) return 0;
    const h = heightOf(t);
    return x >= t.x - HALF && x < t.x + HALF && y >= t.y - h + 1 && y < t.y + 1 ? 1 : 0;
  }
  // (struck by a falling piece: mass x speed into it, over what a man shrugs off - a lump off a
  // wall knocks him down, a slab kills him)
  const SHRUG = 4000, DENT = 300;
  function struck(world, t, x, y, part, mass, vx, vy) {
    const blow = mass * Math.hypot(vx, vy);
    t.vx += vx * Math.min(1, mass / 400) * 0.5;
    const dmg = Math.max(0, (blow - SHRUG) / DENT);
    if (dmg > 0) hurt(world, t, dmg, 'debris');
    return dmg;
  }
  // What a round meets of them: their bodies, crouched shorter (PW.shots' targets).
  const target = {
    hit(world, s, x0, y0, x1, y1) {
      const list = world.troops;
      if (!list || !list.length) return null;
      let best = null;
      for (const t of list) {
        if (t.dead || t === s.from) continue;
        const h = heightOf(t);
        // (where the round's path this tick crosses its body's box: the slab test)
        let f0 = 0, f1 = 1;
        for (const [p0, d, lo, hi] of [[x0, x1 - x0, t.x - HALF + 1, t.x + HALF - 1], [y0, y1 - y0, t.y - h + 1, t.y + 1]]) {
          if (Math.abs(d) < 1e-9) { if (p0 < lo || p0 > hi) { f0 = 2; break; } continue; }
          let a = (lo - p0) / d, b = (hi - p0) / d;
          if (a > b) [a, b] = [b, a];
          f0 = Math.max(f0, a); f1 = Math.min(f1, b);
          if (f0 > f1) break;
        }
        if (f0 > f1 || f0 > 1) continue;
        if (!best || f0 < best.f) best = { f: f0, x: x0 + (x1 - x0) * f0, y: y0 + (y1 - y0) * f0, ref: t, part: 1 };
      }
      return best;
    },
    strike(world, t, s, x, y) {
      hurt(world, t, DAMAGE[s.kind] ?? 34, s.kind);
      // (a little blood-dark spray, no more)
      const particles = world.particles, F = PW.PARTICLE;
      if (particles && F) for (let k = 0; k < 3; k += 1) particles.spawn(x, y, s.vx * 0.02 + (k - 1) * 10, -10 - k * 6, 0, PW.abgr(96, 28, 24, 220), F.SMOKE | F.THIN, 0.4);
      return true;
    },
  };

  // ---- Firing -----------------------------------------------------------------------------------------
  // (its rifle's muzzle: at its chest, out in front of it)
  function muzzle(t) {
    const h = heightOf(t);
    return { x: t.x + t.facing * (HALF + 3), y: t.y - h + (t.crouch ? 7 : 9) };
  }
  function fire(world, t) {
    if (!t || t.dead || t.buried || t.climbing || t.reload > 0 || t.cooldown > 0 || !PW.shots) return null;
    if (t.mag <= 0) { reload(t); return null; }
    const m = muzzle(t);
    let dx = t.facing, dy = 0;
    if (t.aim) { dx = t.aim.x - m.x; dy = t.aim.y - m.y; if (Math.sign(dx) && Math.sign(dx) !== t.facing) t.facing = Math.sign(dx); }
    const shot = PW.shots.fire(world, { kind: 'bullet', x: m.x, y: m.y, dx, dy, side: t.side, from: t, spread: t.crouch ? 0.01 : 0.025 });
    t.mag -= 1; t.cooldown = ROF;
    stats.fired += 1;
    if (PW.shots.report) PW.shots.report(world, m.x, m.y, Math.sign(dx) || t.facing, 0, 1);
    if (t.mag <= 0) reload(t);
    return shot;
  }
  function reload(t) { if (t.reload <= 0 && t.ammo > 0 && t.mag < MAG) t.reload = RELOAD; }
  // A grenade: thrown in an arc at the spot (or ahead), it bounces and rolls, and goes off on its fuse.
  function throwGrenade(world, t) {
    if (!t || t.dead || t.buried || t.grenades <= 0) return null;
    const m = muzzle(t), aim = t.aim || { x: t.x + t.facing * 120, y: t.y - 40 };
    // (lobbed at 45 degrees as hard as it takes to land there - from shoulder height, over the
    // ground it is thrown along - as hard as an arm throws at most)
    const dx = aim.x - m.x, a = -Math.PI / 4, sp = Math.min(THROW, Math.sqrt(Math.max(8, Math.abs(dx) - 0.6 * (aim.y - m.y)) * G()));
    const g = { x: m.x, y: m.y - 2, vx: Math.sign(dx || t.facing) * sp * Math.cos(a), vy: sp * Math.sin(a), fuse: FUSE, side: t.side };
    t.grenades -= 1;
    (world.grenades || (world.grenades = [])).push(g);
    return g;
  }
  function stepGrenades(world, dt) {
    const list = world.grenades;
    for (let q = list.length - 1; q >= 0; q -= 1) {
      const g = list[q];
      g.fuse -= dt;
      if (g.fuse <= 0) { list.splice(q, 1); if (PW.explode) PW.explode(world, world.particles, { x: g.x, y: g.y - 1, radius: 10, power: 0.8 }); continue; }
      g.vy += G() * dt;
      const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
      if (blocks(world, Math.floor(nx), Math.floor(g.y))) g.vx *= -0.4; else g.x = nx;
      // (it bounces low and rolls to a stop on the ground)
      if (blocks(world, Math.floor(g.x), Math.floor(ny))) { g.vy *= -0.3; g.vx *= 0.5; if (Math.abs(g.vy) < 20) { g.vy = 0; g.vx *= Math.max(0, 1 - 8 * dt); } } else g.y = ny;
    }
  }

  // ---- The step ------------------------------------------------------------------------------------------
  function step(world, dt) {
    if (PW.shots && PW.shots.addTarget && !target.added) { PW.shots.addTarget(target); target.added = true; }
    const list = world.troops;
    if (list && list.length) {
      current = world;
      for (const t of list) stepOne(world, t, dt);
      for (let q = list.length - 1; q >= 0; q -= 1) if (list[q].dead && list[q].deadFor > CORPSE) list.splice(q, 1);
    }
    if (world.grenades && world.grenades.length) stepGrenades(world, dt);
  }

  // ---- Drawn -----------------------------------------------------------------------------------------------
  // The GIF's clips: walking (and standing: its first frame), crouched and crouch-walking, jumping;
  // a dead one lies on its side.
  function frameOf(t) {
    const A = PW.unitArt;
    if (t.dead || t.buried) return ['crouch', 0];
    if (!t.onGround && !t.climbing && !t.swim) return ['jump', Math.min(A.frameCount('jump') - 1, Math.max(0, Math.floor((t.vy + JUMP) / (2 * JUMP) * A.frameCount('jump'))))];
    const moving = Math.abs(t.vx) > 2 || t.climbing;
    const clip = t.crouch ? (moving ? 'crouchWalk' : 'crouch') : 'walk';
    if (!moving) return [clip, 0];
    return [clip, Math.floor(t.travel / 5) % A.frameCount(clip)];
  }
  function draw(renderer) {
    const world = renderer.world || current;
    const A = PW.unitArt;
    if (!world || !A) return;
    const list = world.troops;
    if (list && list.length) {
      const { ctx, camera } = renderer, z = camera.zoom;
      for (const t of list) {
        if (t.buried && !t.dead) continue;
        const [clip, frame] = frameOf(t), s = A.sprite('trooper', clip, frame, t.style);
        if (!s) continue;
        if (!t.dead) { A.draw(renderer, s, t.x, t.y, t.facing); continue; }
        // (dead: on its side, fading at the end)
        ctx.save();
        ctx.globalAlpha = t.deadFor > CORPSE - 3 ? Math.max(0, (CORPSE - t.deadFor) / 3) : 1;
        ctx.imageSmoothingEnabled = false;
        ctx.translate(Math.round((t.x - camera.x) * z), Math.round((t.y + 1 - camera.y) * z));
        ctx.rotate(-t.facing * Math.PI / 2);
        ctx.drawImage(s.canvas, -s.footX * z, -s.footY * z, s.width * z, s.height * z);
        ctx.restore();
      }
    }
    const gl = world.grenades;
    if (gl && gl.length) {
      const { ctx, camera } = renderer, z = camera.zoom;
      ctx.fillStyle = 'rgb(46,52,40)';
      for (const g of gl) ctx.fillRect(Math.round((g.x - 1 - camera.x) * z), Math.round((g.y - 1 - camera.y) * z), Math.max(1, 2 * z), Math.max(1, 2 * z));
    }
  }
  const before = PW.drawUnitsHook;
  PW.drawUnitsHook = (renderer) => { if (before) before(renderer); draw(renderer); };

  // ---- By hand -------------------------------------------------------------------------------------------
  // A click on a trooper takes it in hand (again: lets it go); with one in hand, a click is where it
  // aims and throws; a click elsewhere drops a trooper on the ground under it (shift: another).
  let held = null, dropN = 0;
  const STYLES = ['modern', 'asian', 'gothic'];
  function tool(world, x, y, shift = false) {
    const list = world.troops || [];
    if (held && (held.dead || !list.includes(held))) held = null;
    const hit = list.find((t) => !t.dead && Math.abs(x - t.x) <= HALF + 2 && y >= t.y - heightOf(t) && y <= t.y + 2);
    if (hit) { held = hit === held ? null : hit; return held; }
    if (held && !shift) { held.aim = { x, y }; return held; }
    const gx = Math.round(x);
    if (gx < 8 || gx > world.width - 8) return null;
    let gy = Math.max(1, Math.round(y));
    if (blocks(world, gx, gy)) { while (gy > 1 && blocks(world, gx, gy)) gy -= 1; } else gy = groundUnder(world, gx, gy);
    if (!clear(world, gx, gy, HEIGHT)) return null;
    let side = null, best = Infinity;
    for (const b of world.buildings || []) {
      const s = b.faction || b.side, bx = b.body ? (b.body.left + b.body.right) / 2 : b.x;
      if (s && Number.isFinite(bx) && Math.abs(bx - gx) < best) { best = Math.abs(bx - gx); side = s; }
    }
    held = create(world, { x: gx + 0.5, y: gy, side, style: STYLES[dropN++ % 3], facing: gx < world.width / 2 ? 1 : -1 });
    return held;
  }
  function hold(t) { held = t && !t.dead && t.kind === 'trooper' ? t : null; return held; }
  function key(event) {
    if (!held || held.dead || event.repeat) return false;
    const t = held, world = current || (window.pwApp && window.pwApp.world), k = event.code;
    if (k === 'KeyA' || k === 'ArrowLeft') { t.walk = -1; t.climbing = false; t.wantUp = 0; }
    else if (k === 'KeyD' || k === 'ArrowRight') { t.walk = 1; t.climbing = false; t.wantUp = 0; }
    else if (k === 'KeyW' || k === 'ArrowUp') t.wantUp = 1;
    else if (k === 'KeyS' || k === 'ArrowDown') {
      // (stop; stopped, crouch - or stand again; on a ladder, down it; on a platform, crouched, drop through)
      if (t.climbing || ladderAt(world, Math.floor(t.x), t.y + 1)) { t.climbing = true; t.wantUp = -1; }
      else if (t.walk) t.walk = 0;
      else if (t.crouch && isPlatform(world, Math.floor(t.x), t.y + 1)) t.dropping = true;
      else t.crouch = !t.crouch && clear(world, t.x, t.y, CROUCH) ? true : !clear(world, t.x, t.y, HEIGHT);
    } else if (k === 'KeyF') fire(world, t);
    else if (k === 'KeyG') throwGrenade(world, t);
    else if (k === 'KeyR') reload(t);
    else return false;
    return true;
  }
  // (driving it by code, as the keys do: walk -1 / 0 / +1)
  function walk(t, dir) { t.walk = Math.sign(dir); if (dir) { t.climbing = false; t.wantUp = 0; } }

  PW.troops = { create, step, draw, walk, fire, throwGrenade, reload, hurt, blast, touches, struck, target, tool, key, hold, held: () => held, stats,
    clear, blocks, HEIGHT, CROUCH, HALF, WALK, STEP_UP, STEP_DOWN, FALL_SAFE, HP, MAG, GRENADES, DIG_HARD };
})();
