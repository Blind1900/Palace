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
  // dress), facing, unit ('trooper', 'guard' - in lavender, holding its post - or 'miner' - in its
  // hi-vis kit, a drill in hand, no grenades), post (a guard's: where it stands) }
  const UNITS = { trooper: { look: 'trooper', grenades: GRENADES, drill: 0 }, guard: { look: 'guard', grenades: GRENADES, drill: 0 }, miner: { look: 'miner', grenades: 0, drill: 1 } };
  function create(world, spec) {
    const x = spec.x, gy = spec.y ?? groundUnder(world, Math.round(x), 0), U = UNITS[spec.unit] || UNITS.trooper;
    const t = { kind: 'trooper', unit: UNITS[spec.unit] ? spec.unit : 'trooper', look: U.look, x, y: gy, vx: 0, vy: 0, facing: spec.facing || 1, side: spec.side || null, style: spec.style || '',
      hp: HP, dead: false, deadFor: 0, onGround: true, crouch: false, climbing: false, dropping: false, swim: false, wet: 0, flow: 0,
      breath: BREATH, buried: false, digDir: 0, digT: 0, walk: 0, wantUp: 0, travel: 0, lift: 0,
      mag: MAG, ammo: MAG * 4, reload: 0, cooldown: 0, grenades: U.grenades, drill: U.drill, slot: U.drill ? 'drill' : 'rifle', drilling: null, drillT: 0,
      post: spec.post || (spec.unit === 'guard' ? { x, y: gy } : null), working: null,
      // (its orders - see PW.units: a guard holds its post, firing at what comes into its sights)
      order: spec.order || (spec.unit === 'guard' ? { type: 'hold', at: 0 } : null),
      aim: null, hurtBy: '', fallFrom: gy, seed: ++seq };
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
    if (t.route) follow(world, t, dt);
    if (t.working) workStep(world, t, dt);
    if (t.drilling) drillStep(world, t, dt);
    if (!t.drill && world.pickups && world.pickups.length) pickUp(world, t);
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

  // ---- Finding the way ------------------------------------------------------------------------------------
  // Told to go somewhere, a trooper finds its way there by the same rules it moves by: over the
  // ground and along tunnels, stepping up and down their stairs and slopes, crouching under a low
  // roof, up and down ladders, off a ledge no higher than it drops unhurt - never through water over
  // its head (a flooded tunnel is no way: the user's design). The places it can stand - each column,
  // each floor in it - are searched outward from where it is, the nearest by its going first (a
  // cell's walk; crouched, more; a rung's climb), to the place under where it was told; then it goes
  // the way, a leg at a time - a walk, a climb - and if it is held up, looks for the way again.
  const PLAN_MARGIN = 160;      // cells round both ends of the way the search looks over
  const PLAN_NODES = 300000;    // places it looks at, at most
  const SAFE_DROP = 40;         // cells it drops off a ledge unhurt (see FALL_SAFE)
  const FREE_CAP = 40;
  const PLAN = { n: 0, free: null, foot: null, cost: null, prev: null, how: null };
  const HOW = { WALK: 1, CROUCH: 2, UP: 3, DOWN: 4 };
  function plan(world, from, to) {
    const { mat, width: W, height: H } = world;
    const sx = Math.floor(from.x), sy = Math.round(from.y), gx = Math.floor(to.x), gy = Math.round(to.y);
    const x0 = Math.max(HALF + 1, Math.min(sx, gx) - PLAN_MARGIN), x1 = Math.min(W - HALF - 2, Math.max(sx, gx) + PLAN_MARGIN);
    const y0 = Math.max(FREE_CAP + 2, Math.min(sy, gy) - PLAN_MARGIN * 2), y1 = Math.min(H - 3, Math.max(sy, gy) + PLAN_MARGIN * 2);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = bw * bh;
    // (cost in doubles: the heap's are, and a float's rounding would make a place look already done)
    if (PLAN.n < n) { PLAN.n = n; PLAN.free = new Uint8Array(n); PLAN.foot = new Uint8Array(n); PLAN.cost = new Float64Array(n); PLAN.prev = new Int32Array(n); PLAN.how = new Uint8Array(n); }
    const { free, foot, cost, prev, how } = PLAN;
    // (each cell of the box: how many cells are open straight up from it - itself too; and what it
    // is underfoot - something that bears a foot (1), a ladder (2), water (4))
    const LADDER = PW.FLAG.LADDER;
    for (let x = x0; x <= x1; x += 1) {
      let run = 0;
      for (let y = y0 - FREE_CAP; y < y0; y += 1) { const id = mat[y * W + x] & ID_MASK; run = phase[id] >= POWDER && !passable[id] && id !== M.PLATFORM ? 0 : Math.min(FREE_CAP, run + 1); }
      for (let y = y0, i = x - x0; y <= y1; y += 1, i += bw) {
        const id = mat[y * W + x] & ID_MASK, solid = phase[id] >= POWDER && !passable[id] && id !== M.PLATFORM;
        run = solid ? 0 : Math.min(FREE_CAP, run + 1);
        free[i] = run;
        foot[i] = (solid || id === M.PLATFORM ? 1 : 0) | (PW.getFlags(world, x, y) & LADDER ? 2 : 0) | (id === M.WATER ? 4 : 0);
      }
    }
    const at = (x, y) => (y - y0) * bw + (x - x0);
    const inBox = (x, y) => x - HALF >= x0 && x + HALF - 1 <= x1 && y - HEIGHT >= y0 && y + 1 <= y1;
    const room = (x, y) => { let m = FREE_CAP; for (let xx = x - HALF, i = at(x - HALF, y); xx < x + HALF; xx += 1, i += 1) if (free[i] < m) m = free[i]; return m; };
    const bearsAt = (x, y) => {
      for (let xx = x - HALF, i = at(x - HALF, y + 1); xx < x + HALF; xx += 1, i += 1) if (foot[i] & 1) return true;
      return (foot[at(x, y + 1)] & 2) !== 0 && (foot[at(x, y)] & 2) === 0;
    };
    // (how tall it can stand there, 0 not at all; it wades no deeper than its thighs - deeper is
    // flooded, no way)
    const WADE = 10;
    const standH = (x, y) => {
      const r = room(x, y), h = r >= HEIGHT ? HEIGHT : r >= CROUCH ? CROUCH : 0;
      return h && !(foot[at(x, y - WADE)] & 4) ? h : 0;
    };
    // (where it ends up let go at (x, y), h tall: on what bears it, or a drop no deeper than it takes unhurt)
    const landAt = (x, y, h) => {
      for (let k = 0; k <= SAFE_DROP; k += 1) {
        if (!inBox(x, y + k) || (k && room(x, y + k) < h)) return -1;
        if (bearsAt(x, y + k)) return y + k;
      }
      return -1;
    };
    if (!inBox(sx, sy)) return null;
    // (the place under where it was told: the first it can stand on going down from there)
    let goal = -1;
    for (let dy = -12; dy <= 90 && goal < 0; dy += 1) for (const dx of [0, -1, 1, -2, 2, -3, 3]) {
      const x = gx + dx, y = gy + dy;
      if (inBox(x, y) && bearsAt(x, y) && standH(x, y)) { goal = at(x, y); break; }
    }
    cost.fill(Infinity, 0, n); how.fill(0, 0, n);
    const start = at(sx, sy);
    cost[start] = 0; prev[start] = -1;
    // (the open places, cheapest first: a binary heap of [cost, place])
    const heapC = [], heapI = [];
    const push = (c, i) => { let k = heapC.length; heapC.push(c); heapI.push(i); while (k) { const p = (k - 1) >> 1; if (heapC[p] <= c) break; heapC[k] = heapC[p]; heapI[k] = heapI[p]; k = p; } heapC[k] = c; heapI[k] = i; };
    const pop = () => {
      const top = heapI[0], c = heapC.pop(), i = heapI.pop(), m = heapC.length;
      if (m) { let k = 0; for (;;) { let s = 2 * k + 1; if (s >= m) break; if (s + 1 < m && heapC[s + 1] < heapC[s]) s += 1; if (heapC[s] >= c) break; heapC[k] = heapC[s]; heapI[k] = heapI[s]; k = s; } heapC[k] = c; heapI[k] = i; }
      return top;
    };
    const relax = (from, i, c, kind) => { if (c < cost[i]) { cost[i] = c; prev[i] = from; how[i] = kind; push(c, i); } };
    push(0, start);
    let best = start, bestD = Math.hypot(sx - gx, sy - gy), seen = 0;
    while (heapC.length && seen < PLAN_NODES) {
      const c0 = heapC[0], i = pop();
      if (c0 > cost[i]) continue;
      seen += 1;
      if (i === goal) { best = i; break; }
      const x = x0 + i % bw, y = y0 + ((i / bw) | 0);
      // (the nearest it can get, should there be no way there)
      const d = Math.hypot(x - gx, y - gy);
      if (d < bestD) { bestD = d; best = i; }
      const hNow = standH(x, y) || CROUCH;
      // Along: a cell each way - standing if there is room, else crouched; up a step its legs take;
      // then down to what bears it.
      for (const dir of [-1, 1]) {
        const nx = x + dir;
        if (!inBox(nx, y)) continue;
        let y2 = -1, h = 0;
        for (const hh of [HEIGHT, CROUCH]) {
          if (room(nx, y) >= hh) { y2 = y; h = hh; break; }
          for (let k = 1; k <= STEP_UP; k += 1) if (inBox(nx, y - k) && room(nx, y - k) >= hh) { y2 = y - k; h = hh; break; }
          if (y2 >= 0) break;
        }
        if (y2 < 0) continue;
        const land = landAt(nx, y2, h);
        if (land < 0 || !standH(nx, land)) continue;
        const crouched = h < HEIGHT || hNow < HEIGHT;
        relax(i, at(nx, land), c0 + (crouched ? 2.2 : 1) + (land - y2 > STEP_DOWN ? 2 : 0), crouched ? HOW.CROUCH : HOW.WALK);
      }
      // Up a ladder from its foot, to where it stands at its top; down one, to what bears it at its foot.
      const xi = at(x, y);
      if (foot[xi] & 2) {
        let y2 = y;
        while ((foot[at(x, y2)] & 2) && inBox(x, y2 - 1) && room(x, y2 - 1) >= hNow) y2 -= 1;
        if (y2 < y && bearsAt(x, y2) && standH(x, y2)) relax(i, at(x, y2), c0 + (y - y2) * 1.6, HOW.UP);
      }
      if (foot[at(x, y + 1)] & 2) {
        let y2 = y;
        while (inBox(x, y2 + 1) && (foot[at(x, y2 + 1)] & 2) && room(x, y2 + 1) >= hNow) y2 += 1;
        const land = y2 > y ? landAt(x, y2, hNow) : -1;
        if (land > y && standH(x, land)) relax(i, at(x, land), c0 + (land - y) * 1.6, HOW.DOWN);
      }
    }
    if (best === start) return { legs: [], reached: goal === start, seen };
    // The way back from where it gets to, then forward as legs: each run of walking one way (standing
    // or crouched) one leg, each climb one.
    const steps = [];
    for (let i = best; i !== start; i = prev[i]) steps.push(i);
    steps.reverse();
    const legs = [];
    let px = sx;
    for (const i of steps) {
      const x = x0 + i % bw, y = y0 + ((i / bw) | 0), k = how[i];
      if (k === HOW.UP || k === HOW.DOWN) legs.push({ mode: k === HOW.UP ? 'up' : 'down', x, y });
      else {
        const dir = Math.sign(x - px), crouch = k === HOW.CROUCH, last = legs[legs.length - 1];
        if (last && last.mode === 'walk' && last.dir === dir && last.crouch === crouch) { last.x = x; last.y = y; } else legs.push({ mode: 'walk', x, y, dir, crouch });
      }
      px = x;
    }
    return { legs, reached: best === goal, seen };
  }
  // (sent on its way: the way found, or null when there is none)
  function goTo(world, t, x, y) {
    if (!t || t.dead) return null;
    const p = plan(world, t, { x, y });
    if (!p) { t.route = null; return null; }
    t.route = { legs: p.legs, at: 0, goal: { x, y }, reached: p.reached, lastX: t.x, lastY: t.y, idle: 0, tries: 0, climbed: false };
    t.lost = false;
    return t.route;
  }
  const REPLAN_IDLE = 2;        // s held up on a leg before it looks for the way again...
  const REPLAN_TRIES = 3;       // ...this many times, before it gives up
  function follow(world, t, dt) {
    const r = t.route, w = r.legs[r.at];
    if (!w) { t.route = null; t.walk = 0; t.wantUp = 0; t.arrived = true; return; }
    // (held up: no headway for a while - it looks for the way again from where it is)
    if (Math.abs(t.x - r.lastX) + Math.abs(t.y - r.lastY) > 1.5) { r.lastX = t.x; r.lastY = t.y; r.idle = 0; }
    else if ((r.idle += dt) > REPLAN_IDLE) {
      const tries = r.tries + 1;
      if (tries > REPLAN_TRIES || !goTo(world, t, r.goal.x, r.goal.y)) { t.route = null; t.walk = 0; t.lost = true; return; }
      t.route.tries = tries;
      return;
    }
    const cx = Math.floor(t.x);
    if (w.mode === 'walk') {
      if (w.crouch) t.crouch = true;
      else if (t.crouch && clear(world, t.x, t.y, HEIGHT)) t.crouch = false;
      const dx = w.x + 0.5 - t.x;
      if (Math.abs(dx) < 0.8 || Math.sign(dx) !== w.dir) { r.at += 1; if (!r.legs[r.at]) t.walk = 0; return; }
      t.walk = w.dir;
      return;
    }
    // (a climb: to the ladder, on to it, up or down it to its end)
    const up = w.mode === 'up';
    if (t.climbing) { t.walk = 0; t.wantUp = up ? 1 : -1; r.climbed = true; return; }
    if (r.climbed) { r.climbed = false; r.at += 1; return; }
    const on = up ? ladderAt(world, cx, t.y) : ladderAt(world, cx, t.y + 1);
    if (on && t.onGround) { t.walk = 0; t.vx = 0; t.climbing = true; t.wantUp = up ? 1 : -1; t.crouch = false; return; }
    t.walk = Math.sign(w.x + 0.5 - t.x) || 1;
  }
  // ---- The drill: hand-drilled dirt tunnels (N5) -----------------------------------------------------------
  // A trooper with a drill (a miner, or one who picked one up in the tunnels) drills its own way, any
  // of eight ways, through what the drill cuts - fast through soil and sand, slowly through stone, not
  // at all through bedrock, ore (the miners' seams), a core's bed or another side's lining - and
  // walks on into what it drilled: along or slanting, a bore it stands up in (DRILL_H); straight down
  // or up, a shaft as wide as a ladder, the ladder fixed in it as it goes. What it drills is a rough
  // dirt tunnel, its spoil thrown back behind it, a secret from the enemy (FLAG.BORE: they see a man
  // in it only close to - see PW.units); once it reaches the open - the surface, a cave - and its
  // side's tunnels both, it is taken into them, and lined in its turn like the rest.
  const DRILL_H = 28;           // cells: a bore a man walks upright in
  const SHAFT_W = 14;           // cells: a shaft, a ladder's width and a cell either side
  const DRILL_FAST = 50.7, DRILL_K = 3.52;   // cells/s along, by what it cuts: about 21 through soil (1.5 m/s), 4.3 through stone (0.3 m/s)
  const BORE_TONES = [[46, 37, 29], [38, 31, 24], [54, 43, 33]];
  const DIRS8 = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
  function cuts(world, t, x, y) {
    const id = world.mat[y * world.width + x] & ID_MASK;
    if (id === M.BEDROCK || id === M.CORE || id === M.ORE || id === M.FOUNDATION) return false;
    if (id === M.REINFORCED || id === M.LINING) {
      const net = PW.tunnels && PW.tunnels.networkOfOwner(world, PW.getOwner(world, x, y));
      return !!net && net.side === t.side;
    }
    return true;
  }
  // (which way of the eight it aims: at the spot clicked, or on ahead)
  function drillWay(t) {
    if (!t.aim) return [t.facing, 0];
    const a = Math.atan2(-(t.aim.y - (t.y - heightOf(t) / 2)), t.aim.x - t.x), k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    return DIRS8[k];
  }
  // F with the drill in hand: drill on the way it aims - or, drilling, stop.
  function drill(world, t, way) {
    if (!t || t.dead || !t.drill) return false;
    if (t.drilling && !way) { stopDrill(t); return false; }
    const [dx, dy] = way || drillWay(t);
    t.drilling = { dx, dy, bore: newBore(world, t) };
    t.route = null; t.drillT = 0;
    if (dx) t.facing = dx;
    stats.drilling = (stats.drilling || 0) + 1;
    return true;
  }
  function stopDrill(t) {
    if (!t.drilling) return;
    const b = t.drilling.bore;
    t.drilling = null; t.walk = 0; t.wantUp = 0;
    // (a bore that joined its side's tunnels while it was drilled is taken into them now it is done:
    // not before - their lining would be cast across the face it is still cutting)
    if (b && b.joined && !b.taken && current) takeIn(current, b);
  }
  function newBore(world, t) {
    const b = { side: t.side, cells: [], net: null, open: false, joined: false };
    (world.bores || (world.bores = [])).push(b);
    return b;
  }
  // The cells it must cut to go on a step: the bore's face.
  function face(world, t, d) {
    const cx = Math.floor(t.x), out = [];
    if (d.dx) {
      const nx = cx + d.dx, ny = t.y + d.dy;
      for (let y = ny - DRILL_H + 1; y <= ny; y += 1) for (let x = nx - HALF; x < nx + HALF; x += 1) if (blocks(world, x, y)) out.push(x, y);
    } else {
      // (down: the first row from its head down with anything in it to cut - a lip of the ground it
      // stands half on, the row under it, or, that cut, the next it is still dropping onto; up:
      // the first over its head. Nothing near enough, and it has drilled out into the open)
      const band = (row) => { for (let x = cx - (SHAFT_W >> 1); x < cx + (SHAFT_W >> 1); x += 1) if (blocks(world, x, row)) out.push(x, row); return out.length > 0; };
      if (d.dy > 0) for (let row = t.y - heightOf(t) + 1; row < t.y + 1 + DRILL_H && row < world.height - 1 && !band(row); row += 1);
      else for (let row = t.y - heightOf(t); row > t.y - heightOf(t) - DRILL_H && row > 1 && !band(row); row -= 1);
    }
    return out;
  }
  function drillStep(world, t, dt) {
    const d = t.drilling;
    if (t.dead || t.buried || t.swim) { stopDrill(t); return; }
    const f = face(world, t, d);
    // (what it cannot cut ends the drilling there; a shaft that has broken out into the open, too)
    for (let k = 0; k < f.length; k += 2) if (!cuts(world, t, f[k], f[k + 1])) { stopDrill(t); t.drillStopped = 'hard'; return; }
    if (!d.dx && !f.length) { stopDrill(t); t.drillStopped = 'open'; return; }
    if (f.length) {
      let h = 0;
      for (let k = 0; k < f.length; k += 2) h += hardness[world.mat[f[k + 1] * world.width + f[k]] & ID_MASK];
      h /= f.length / 2;
      t.drillT += dt;
      if (t.drillT >= 1 / (DRILL_FAST * Math.exp(-DRILL_K * h))) { t.drillT = 0; carveBore(world, t, d, f); }
    }
    // (on into what it has drilled: walking along or slanting; up the shaft's ladder - going down,
    // it stands on the bottom of the shaft, and sinks with it)
    if (d.dx) { t.walk = d.dx; t.crouch = false; }
    else { t.walk = 0; t.vx = 0; if (d.dy < 0 && ladderAt(world, Math.floor(t.x), t.y)) { t.climbing = true; t.wantUp = 1; } }
  }
  function carveBore(world, t, d, f) {
    const particles = world.particles, F = PW.PARTICLE, b = d.bore, FLAGS = PW.FLAG.BORE | PW.FLAG.CARVED;
    for (let k = 0; k < f.length; k += 2) {
      const x = f[k], y = f[k + 1], m = world.mat[y * world.width + x];
      PW.set(world, x, y, M.AIR);
      PW.setLayer(world, 'deco', x, y, 0);
      PW.setFlag(world, x, y, FLAGS);
      const c = BORE_TONES[PW.hash3(x >> 1, y >> 1, 41) % 3];
      PW.setLayer(world, 'back', x, y, PW.abgr(c[0], c[1], c[2]));
      b.cells.push(y * world.width + x);
      // (its spoil thrown back behind it - or, sinking a shaft, hauled up out of it: thrown, it would
      // fall back in under its feet)
      if (particles && F && !(d.dy > 0 && !d.dx) && (PW.hash3(x, y, t.seed) & 7) === 0) particles.spawn(x + 0.5, y + 0.5, -(d.dx || t.facing) * (30 + (PW.hash2(x, y) & 31)), -15, (PW.mat.breaksTo[m & ID_MASK] || m) & 0xff, 0, F.LAND, 4);
    }
    // (a shaft: the ladder fixed in it, as it goes - from its feet to the row it cut)
    if (!d.dx && PW.settlementTools) {
      const cx = Math.floor(t.x), row = f[1];
      PW.settlementTools.ladder(world, cx - 6, Math.min(row, t.y), Math.max(row, t.y));
      if (d.dy > 0) t.climbing = false;
    }
    stats.drilled = (stats.drilled || 0) + f.length / 2;
    joinBore(world, b, f);
  }
  // (has the bore reached the open - the surface or a cave - and its side's tunnels? Then it is
  // theirs: taken into the network it meets, its cells to be lined in their turn - no secret now)
  function joinBore(world, b, f) {
    if (!PW.tunnels || b.joined) return;
    const W = world.width, T = PW.tunnels.state(world);
    for (let k = 0; k < f.length; k += 2) {
      const x = f[k], y = f[k + 1];
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox, ny = y + oy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= world.height - 1) continue;
        const net = PW.tunnels.netAt(world, nx, ny);
        if (net) { const n = T.networks[net - 1]; if (n && n.side === b.side) b.net = n; continue; }
        if (!PW.mat.open[world.mat[ny * W + nx] & ID_MASK] || (PW.getFlags(world, nx, ny) & PW.FLAG.BORE)) continue;
        // (open air out of the ground - the sky over the surface - or a cave's)
        b.open = true;
      }
    }
    if (!b.net || !b.open) return;
    b.joined = true;
    stats.boresJoined = (stats.boresJoined || 0) + 1;
  }
  function takeIn(world, b) {
    b.taken = true;
    const W = world.width;
    // (one segment for the whole bore: a cell of it, carved already, claimed as a box)
    const i0 = b.cells[0], seg = PW.tunnels.digBox(world, b.net, i0 % W, (i0 / W) | 0, i0 % W, (i0 / W) | 0, { kind: 'drift' }).segment;
    for (const i of b.cells) {
      const x = i % W, y = (i / W) | 0;
      PW.setFlag(world, x, y, PW.FLAG.BORE, false);
      if (seg && PW.mat.open[world.mat[i] & ID_MASK]) PW.tunnels.claimCell(world, b.net, seg, x, y);
    }
    stats.boresTaken = (stats.boresTaken || 0) + 1;
  }
  // (in a hand-drilled dirt tunnel its side has not taken in yet: a secret)
  const inBore = (world, t) => (PW.getFlags(world, Math.floor(t.x), t.y - 4) & PW.FLAG.BORE) !== 0;

  // ---- Picking up, the item bar -----------------------------------------------------------------------------
  // A trooper walking over a drill lying in the tunnels picks it up. Its items: its rifle, its
  // grenades, its drill (if it has one); keys 1 2 3 take one in hand, F uses it.
  function pickUp(world, t) {
    for (const p of world.pickups) {
      if (p.kind !== 'drill' || t.y < p.y || t.y > p.y + p.h + 2 || t.x < p.x - HALF || t.x > p.x + p.w + HALF) continue;
      if (PW.pickups && !PW.pickups.present(world, p)) continue;
      if (PW.pickups) PW.pickups.take(world, p);
      t.drill = 1;
      stats.pickedUp = (stats.pickedUp || 0) + 1;
      return true;
    }
    return false;
  }
  const SLOTS = ['rifle', 'grenade', 'drill'];
  function items(t) {
    return [{ slot: 'rifle', have: true, count: `${t.mag}/${t.ammo}`, busy: t.reload > 0 },
      { slot: 'grenade', have: t.grenades > 0, count: `${t.grenades}` },
      { slot: 'drill', have: !!t.drill, count: t.drilling ? 'ON' : t.drill ? '' : '-' }];
  }
  function select(t, slot) { if (slot === 'drill' && !t.drill) return false; if (slot === 'grenade' && t.grenades <= 0) return false; t.slot = slot; return true; }
  function use(world, t) {
    if (t.slot === 'grenade') return throwGrenade(world, t);
    if (t.slot === 'drill') return drill(world, t);
    return fire(world, t);
  }

  // ---- At work: a trooper working a panel (WGM's hack clock runs while it does) -----------------------------
  function work(t, panel) {
    if (!t || t.dead || t.buried) return false;
    t.working = { panel, at: 0 };
    t.route = null; t.walk = 0; stopDrill(t);
    if (panel && Number.isFinite(panel.x)) t.facing = Math.sign(panel.x - t.x) || t.facing;
    return true;
  }
  function workStep(world, t, dt) {
    // (it stops working when it moves - told to, or thrown - or is taken in hand to walk)
    if (t.walk || t.route || t.climbing || !t.onGround || Math.abs(t.vx) > 4) { t.working = null; return; }
    t.working.at += dt;
  }

  // (under cover of the ground: its head under the surface over it - in a tunnel, a cave, a cellar)
  const underground = (world, t) => t.y - heightOf(t) > world.groundTop[Math.max(0, Math.min(world.width - 1, Math.floor(t.x)))] + 4;

  // ---- Struck, hurt, killed ----------------------------------------------------------------------------
  function hurt(world, t, amount, cause) {
    if (t.dead || !(amount > 0)) return;
    t.hp -= amount;
    t.hurtBy = cause;
    t.working = null;
    t.hitAt = world.tick || 0;
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
    t.mag -= 1; t.cooldown = ROF; t.firedAt = world.tick || 0;
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
    // (at a panel: crouched at it, working - its hands busy, the frame turning over)
    if (t.working) return ['crouch', Math.floor(t.working.at * 3) % A.frameCount('crouch')];
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
        const [clip, frame] = frameOf(t), s = A.sprite(t.look || 'trooper', clip, frame, t.style);
        if (!s) continue;
        if (!t.dead) {
          A.draw(renderer, s, t.x, t.y, t.facing);
          if (t.drilling || t.working) busy(renderer, t);
          continue;
        }
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
    if (held && !held.dead && (world.troops || []).includes(held)) itemBar(renderer, held);
  }
  // (busy hands: the drill's bit at the face it cuts, flickering grit; at a panel, its screen's light)
  function busy(renderer, t) {
    const { ctx, camera } = renderer, z = camera.zoom, flick = (PW.hash2(Math.floor(performance.now() / 70), t.seed) & 3);
    const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), Math.max(1, Math.round(w * z)), Math.max(1, Math.round(h * z))); };
    const hy = t.y - heightOf(t) + 11;
    if (t.drilling) {
      const d = t.drilling, bx = t.x + (d.dx ? d.dx * (HALF + 1) : 0), by = d.dx ? hy : d.dy > 0 ? t.y - 6 : t.y - heightOf(t) - 1;
      px(bx - 1, by - 1, 3, 2, 'rgb(222,168,38)');   // (its yellow body)
      px(bx + (d.dx || 0) * 3, by + (d.dx ? 0 : d.dy * 3), 1, 1, 'rgb(190,196,204)');   // (the bit)
      if (flick) px(bx + (d.dx || 0) * 4 + (flick - 2), by + (d.dx ? flick - 2 : d.dy * 4), 1, 1, 'rgb(150,124,90)');   // (grit)
    } else {
      px(t.x + t.facing * (HALF + 1), hy + 3, 2, 2, flick & 1 ? 'rgb(120,220,180)' : 'rgb(70,150,120)');
    }
  }
  // The item bar of the trooper in hand, at the foot of the view: its rifle (rounds in it and
  // carried), its grenades, its drill - the one in hand marked; pixels on the world's grid.
  const ICONS = {
    rifle: ['.......g....', 'GGGGGGGGGGGG', '.GGg.G......', '.G..........'],
    grenade: ['.gg.', 'GGGG', 'GgGG', '.GG.'],
    drill: ['.gGG........', 'G..GyyyyM...', 'G..GYYYYMssT', 'GGGGDDDDM...', '..GG........'],
  };
  const ICON_COLORS = { G: '#3a4030', g: '#5c6448', Y: '#dea826', y: '#f6ce62', D: '#a8761a', M: '#3e4046', s: '#bec4cc', T: '#747880' };
  function itemBar(renderer, t) {
    const { ctx, view } = renderer, dpr = view.dpr || 1, s = Math.max(2, Math.round(3 * dpr)), slotW = 18 * s, gap = 3 * s;
    const list = items(t), x0 = Math.round(view.width / 2 - (list.length * slotW + (list.length - 1) * gap) / 2), y0 = Math.round(view.height - slotW - 14 * s);
    ctx.save();
    ctx.font = `${Math.round(5 * s)}px Ithaca, Consolas, monospace`;
    ctx.textAlign = 'center';
    list.forEach((it, k) => {
      const x = x0 + k * (slotW + gap), on = t.slot === it.slot;
      ctx.fillStyle = on ? 'rgba(60,90,64,0.92)' : 'rgba(10,18,14,0.85)'; ctx.fillRect(x, y0, slotW, slotW);
      ctx.fillStyle = on ? '#c8b040' : '#3c5a40';
      ctx.fillRect(x, y0, slotW, s); ctx.fillRect(x, y0 + slotW - s, slotW, s); ctx.fillRect(x, y0, s, slotW); ctx.fillRect(x + slotW - s, y0, s, slotW);
      const icon = ICONS[it.slot], iw = icon[0].length, ih = icon.length, ix = x + Math.round((slotW - iw * s) / 2), iy = y0 + Math.round((slotW - ih * s) / 2) - s;
      ctx.globalAlpha = it.have ? 1 : 0.3;
      for (let r = 0; r < ih; r += 1) for (let c = 0; c < iw; c += 1) { const ch = icon[r][c]; if (ch === '.') continue; ctx.fillStyle = ICON_COLORS[ch]; ctx.fillRect(ix + c * s, iy + r * s, s, s); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = it.busy ? '#ffc8b8' : '#e8f0d8';
      ctx.fillText(`${k + 1} ${it.count}`, x + slotW / 2, y0 + slotW + 6 * s);
    });
    ctx.restore();
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
    // (taken in hand, it does as it is told, not where it was going)
    if (['KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight', 'KeyW', 'ArrowUp', 'KeyS', 'ArrowDown'].includes(k)) { t.route = null; stopDrill(t); }
    // (1 2 3: its rifle, a grenade, its drill in hand; F uses what it has in hand)
    if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') { select(t, SLOTS[+k[5] - 1]); return true; }
    if (k === 'KeyA' || k === 'ArrowLeft') { t.walk = -1; t.climbing = false; t.wantUp = 0; }
    else if (k === 'KeyD' || k === 'ArrowRight') { t.walk = 1; t.climbing = false; t.wantUp = 0; }
    else if (k === 'KeyW' || k === 'ArrowUp') t.wantUp = 1;
    else if (k === 'KeyS' || k === 'ArrowDown') {
      // (stop; stopped, crouch - or stand again; on a ladder, down it; on a platform, crouched, drop through)
      if (t.climbing || ladderAt(world, Math.floor(t.x), t.y + 1)) { t.climbing = true; t.wantUp = -1; }
      else if (t.walk) t.walk = 0;
      else if (t.crouch && isPlatform(world, Math.floor(t.x), t.y + 1)) t.dropping = true;
      else t.crouch = !t.crouch && clear(world, t.x, t.y, CROUCH) ? true : !clear(world, t.x, t.y, HEIGHT);
    } else if (k === 'KeyF') use(world, t);
    else if (k === 'KeyG') throwGrenade(world, t);
    else if (k === 'KeyR') reload(t);
    else return false;
    return true;
  }
  // (driving it by code, as the keys do: walk -1 / 0 / +1)
  function walk(t, dir) { t.route = null; stopDrill(t); t.walk = Math.sign(dir); if (dir) { t.climbing = false; t.wantUp = 0; } }

  PW.troops = { create, step, draw, walk, goTo, plan, underground, inBore, fire, throwGrenade, reload, drill, stopDrill, items, select, use, work, hurt, blast, touches, struck, target, tool, key, hold, held: () => held, stats,
    clear, blocks, HEIGHT, CROUCH, HALF, WALK, STEP_UP, STEP_DOWN, FALL_SAFE, SAFE_DROP, HP, MAG, GRENADES, DIG_HARD, DRILL_H, SHAFT_W, UNITS };
})();
