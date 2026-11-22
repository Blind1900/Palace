'use strict';
// Mechs (N90, the user's hopper refs - their idle, jump, boost and fall clips): a hopper, a walker on
// two reverse-jointed legs - a bird's, the knee behind - under an angular hull, its beak forward, two
// swept fins on its back, a cannon under its chin, a pod of two missiles over its shoulders and jump
// jets at its tail. Drawn at its real size from its parts (not the GIF blown up): about 80 cells
// (6 m) to its fin tips, in its side's style. Against the world:
// - it strides over the ground, stepping up what its long legs reach (a kerb, a rubble heap, a
//   storey's stair, 18 cells) and down a slope keeping to it; a wall stops it - it leaps it: a
//   crouch, then a hop of three times its own height, landing on its legs;
// - its jets boost it up and along - a cliff, a gap - for as long as their fuel lasts (it fills
//   again on the ground), and break a fall;
// - it sees a round or a missile coming at it - in front of it or over it, nothing between - and
//   dodges it: a leap over a flat shot, a hop aside from one coming down; then not again for a while;
// - a blast throws it a little (it is heavy) and hurts it; a hard landing does; what falls on it
//   strikes it; its armour gone, it falls apart burning - its fuel and power cell in flames, no blast
//   beyond its own fire (as a tank's, the user's).
// Every mech can be taken in hand (the user's: every unit can be controlled): A / D walk, S stops; W
// leaps - and in the air, boosts (W again: cuts it); F fires a burst of its cannon at the spot last
// clicked (or ahead), G a missile at the unit nearest it, R reloads.
// Our own code throughout.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, passable, blastResist } = PW.mat;
  const POWDER = PW.PHASE.POWDER;

  const HIP = 44;               // cells from its soles up to its hips, standing
  const HEIGHT = 70;            // cells: soles to the top of its hull (its fins over that)
  const HALF = 13;              // cells either side of its middle its body takes
  const THIGH = 25, SHIN = 26, ANKLE = 3, TOE = 10, HEEL = 4;
  const WALK = 70;              // cells/s (about 5 m/s)
  const ACCEL = 240, BRAKE = 320, AIR_ACCEL = 90;   // cells/s^2
  const STEP_UP = 18;           // cells its legs step up - a quarter of its height
  const STEP_DOWN = 10;
  const STRIDE = 40;            // cells a full stride (both feet) carries it
  const JUMP = 300;             // cells/s up: a leap of about 170 cells
  const WIND_UP = 0.18;         // s it crouches before it leaps
  const LAND_T = 0.25;          // s it squats, landing
  const BOOST_UP = 520, BOOST_SIDE = 240, BOOST_VMAX = 220;   // its jets: cells/s^2 up (twice gravity) and along; cells/s up at most
  const FUEL = 1.6, REFUEL = 0.5;   // s of boost; s of it back each s on the ground
  const MAX_FALL = 600;
  const FALL_SAFE = 330;        // cells/s it lands at unhurt - a leap's landing, its legs taking it
  const FALL_HURT = 0.25;       // of its armour lost for each cell/s over that
  const ARMOUR = 100;
  const SIGHT = 1500;           // cells off it sees a round coming
  const DODGE_LOOK = 0.7;       // s ahead it reads a round's way
  const DODGE_COOL = 3;         // s between its dodges
  const DODGE_UP = 300, DODGE_SIDE = 260;
  const MAG = 60, BURST = 8, ROF = 1 / 10, RELOAD = 3, MISSILES = 2;
  const DAMAGE = { bullet: 0.5, cannon: 6, he: 40, ap: 55, missile: 45, rocket: 40, interceptor: 15, patriot: 45 };
  const BURN_OUT = 14;          // s its wreck burns (see PW.tanks' wrecks)

  const G = () => PW.GRAVITY || 260;
  const stats = { created: 0, leapt: 0, boosted: 0, dodged: 0, destroyed: 0, fired: 0, missiles: 0, hurtLanding: 0 };
  let current = null, seq = 0;

  // ---- The cells ---------------------------------------------------------------------------------
  const blocks = (world, x, y) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
    const id = world.mat[y * world.width + x] & ID_MASK;
    return phase[id] >= POWDER && !passable[id] && id !== M.PLATFORM;
  };
  const isPlatform = (world, x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height && (world.mat[y * world.width + x] & ID_MASK) === M.PLATFORM;
  const isWater = (world, x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height && (world.mat[y * world.width + x] & ID_MASK) === M.WATER;
  // (its body at x, its soles on row y: clear of what bars it)
  function clear(world, x, y, h = HEIGHT) {
    const cx = Math.floor(x);
    for (let yy = y - h + 1; yy <= y; yy += 1) for (let xx = cx - HALF; xx < cx + HALF; xx += 1) if (blocks(world, xx, yy)) return false;
    return true;
  }
  // (... and just the column it moves into, the rest of it clear already)
  function clearCol(world, xx, y, h = HEIGHT) {
    for (let yy = y - h + 1; yy <= y; yy += 1) if (blocks(world, xx, yy)) return false;
    return true;
  }
  function bears(world, x, y) {
    const cx = Math.floor(x);
    for (let xx = cx - HALF; xx < cx + HALF; xx += 1) if (blocks(world, xx, y + 1) || isPlatform(world, xx, y + 1)) return true;
    return false;
  }
  function groundUnder(world, x, from) {
    for (let y = Math.max(0, from); y < world.height - 1; y += 1) if (blocks(world, x, y + 1) || isPlatform(world, x, y + 1)) return y;
    return world.height - 2;
  }

  // ---- A mech --------------------------------------------------------------------------------------
  // spec: { x, y (its soles' row; the ground under it if left out), side, style, facing }
  const STYLES = {
    modern: { base: [128, 134, 138], dark: [84, 90, 96], light: [170, 176, 180], mark: [210, 214, 220] },
    asian: { base: [104, 118, 104], dark: [70, 82, 70], light: [140, 156, 138], mark: [196, 40, 36] },
    gothic: { base: [92, 100, 118], dark: [60, 66, 82], light: [128, 138, 158], mark: [236, 236, 236] },
  };
  function create(world, spec) {
    const x = spec.x, y = spec.y ?? groundUnder(world, Math.round(x), 0);
    const m = { kind: 'mech', x, y, vx: 0, vy: 0, accY: 0, facing: spec.facing || 1, side: spec.side || null, style: STYLES[spec.style] ? spec.style : 'modern',
      hp: ARMOUR, dead: false, onGround: true, walk: 0, travel: 0, charge: 0, landT: 0, boosting: false, fuel: FUEL, dodgeT: 0,
      mag: MAG, ammo: MAG * 3, reload: 0, burst: 0, burstT: 0, missiles: MISSILES, aim: null, hurtBy: '', smoke: 0, P: null, seed: ++seq };
    (world.mechs || (world.mechs = [])).push(m);
    current = world;
    stats.created += 1;
    m.P = poseOf(world, m);
    return m;
  }

  // ---- Moving --------------------------------------------------------------------------------------
  function stepOne(world, m, dt) {
    const g = G();
    if (m.reload > 0) { m.reload -= dt; if (m.reload <= 0) { const n = Math.min(MAG - m.mag, m.ammo); m.mag += n; m.ammo -= n; } }
    if (m.dodgeT > 0) m.dodgeT -= dt;
    if (m.landT > 0) m.landT -= dt;
    if (m.onGround && !m.boosting) m.fuel = Math.min(FUEL, m.fuel + REFUEL * dt);
    fireStep(world, m, dt);
    watchRounds(world, m);
    // (its leap: a crouch, then off its legs, on along the way it was going)
    if (m.charge > 0) {
      m.charge -= dt;
      if (m.charge <= 0 && m.onGround) { m.vy = -m.leap; m.onGround = false; m.accY = 0; stats.leapt += 1; }
    }
    // Walking: on to its pace (crouched for a leap, half of it), braking to a stop; in the air it
    // steers a little.
    const want = m.walk * WALK * (m.charge > 0 ? 0.5 : 1);
    const a = (m.onGround ? (want === 0 || Math.sign(want) !== Math.sign(m.vx) ? BRAKE : ACCEL) : AIR_ACCEL) * dt;
    if (m.onGround || m.walk) m.vx = want > m.vx ? Math.min(want, m.vx + a) : Math.max(want, m.vx - a);
    if (m.walk) m.facing = m.walk;
    // (waded into water, it is slowed)
    if (isWater(world, Math.floor(m.x), Math.floor(m.y - HIP))) m.vx *= Math.max(0, 1 - 2 * dt);
    // Its jets: up and along, while their fuel lasts.
    if (m.boosting) {
      if (m.fuel <= 0) m.boosting = false;
      else {
        m.fuel -= dt;
        m.vy = Math.max(-BOOST_VMAX, m.vy - BOOST_UP * dt);
        m.vx += (m.walk || m.facing) * BOOST_SIDE * dt * (Math.abs(m.vx) < WALK * 1.6 ? 1 : 0);
        m.onGround = false;
        jetSmoke(world, m, dt);
      }
    }
    // Across, a cell at a time: stepping up what its legs reach, its body clear over it; a wall stops it.
    let dx = m.vx * dt;
    m.travel += Math.abs(dx);
    while (Math.abs(dx) > 1e-9) {
      const s = Math.sign(dx), d = Math.abs(dx) >= 1 ? s : dx, nx = m.x + d;
      const lead = s > 0 ? Math.floor(nx) + HALF - 1 : Math.floor(nx) - HALF;
      if (Math.floor(nx) === Math.floor(m.x) || clearCol(world, lead, m.y)) { m.x = nx; dx -= d; continue; }
      let up = 0;
      if (m.onGround) for (let k = 1; k <= STEP_UP; k += 1) if (clear(world, nx, m.y - k)) { up = k; break; }
      if (up) { m.x = nx; m.y -= up; dx -= d; continue; }
      m.vx = 0; break;
    }
    // Up and down: falling, landing on its legs - hurt by a hard landing.
    if (!m.onGround || m.vy < 0) m.vy = Math.min(MAX_FALL, m.vy + g * dt);
    m.accY += m.vy * dt;
    while (Math.abs(m.accY) >= 1) {
      const s = Math.sign(m.accY);
      if (s > 0 && bears(world, m.x, m.y)) { land(world, m); m.accY = 0; break; }
      if (!clear(world, m.x, m.y + s)) { if (s < 0) m.vy = 0; else land(world, m); m.accY = 0; break; }
      m.y += s; m.accY -= s;
    }
    const wasGround = m.onGround;
    m.onGround = bears(world, m.x, m.y);
    // (down a slope or off a small ledge: it keeps to the ground)
    if (!m.onGround && wasGround && m.vy >= 0 && !m.boosting) {
      for (let k = 1; k <= STEP_DOWN; k += 1) {
        if (!clear(world, m.x, m.y + k)) break;
        if (bears(world, m.x, m.y + k)) { m.y += k; m.onGround = true; m.vy = 0; break; }
      }
    }
    if (m.onGround) { if (m.vy > 0) m.vy = 0; m.accY = 0; if (m.boosting && m.vy >= 0) m.boosting = false; }
    // (badly hurt, it smokes)
    if (m.hp < ARMOUR * 0.4) damageSmoke(world, m, dt);
    m.P = poseOf(world, m);
  }
  function land(world, m) {
    const v = m.vy;
    if (v > FALL_SAFE) { hurt(world, m, (v - FALL_SAFE) * FALL_HURT, 'landing'); stats.hurtLanding += 1; }
    if (v > 120) {
      m.landT = LAND_T;
      // (its feet thump down: a puff of the ground's dust off them, and the ground shaken)
      const particles = world.particles, F = PW.PARTICLE;
      if (particles && F) for (let k = 0; k < 10; k += 1) {
        const h = PW.hash3(m.seed, k, Math.floor(m.travel)), side = k & 1 ? 1 : -1;
        particles.spawn(m.x + side * (8 + (h & 7)), m.y - 1, side * (30 + (h >>> 4 & 31)), -10 - (h >>> 9 & 15), 0, PW.abgr(150, 136, 112, 150), F.SMOKE | F.THIN, 0.8);
      }
      if (world.stability && world.stability.shock) world.stability.shock(m.x, m.y + 1, Math.min(4e4, v * v * 0.1));
    }
    m.vy = 0; m.onGround = true;
  }
  // (its jets' exhaust: a flame and a trail of smoke out of its tail, downward)
  function jetSmoke(world, m, dt) {
    const particles = world.particles, F = PW.PARTICLE;
    if (!particles || !F) return;
    const [nx, ny] = [m.x - m.facing * 26, m.y - HIP - 4];
    m.smoke = (m.smoke || 0) + dt * 50;
    while (m.smoke >= 1) {
      m.smoke -= 1;
      const h = PW.hash3(m.seed, Math.floor(m.travel * 7 + m.y), 0x3e7), r = (h & 255) / 255;
      particles.spawn(nx + (r - 0.5) * 4, ny + 4, -m.facing * 20 + (r - 0.5) * 30, 140 + r * 60, 0, PW.abgr(255, 190 - (h >>> 8 & 63), 90), F.GLOW, 0.12, 0, 1000);
      particles.spawn(nx + (r - 0.5) * 6, ny + 8, (r - 0.5) * 20, 60, 0, PW.abgr(190, 186, 180, 170), F.SMOKE | F.THIN, 1.6 + r);
    }
  }
  function damageSmoke(world, m, dt) {
    const particles = world.particles, F = PW.PARTICLE;
    if (!particles || !F) return;
    m.smoke = (m.smoke || 0) + dt * 12 * (1 - m.hp / ARMOUR);
    while (m.smoke >= 1) {
      m.smoke -= 1;
      const h = PW.hash3(m.seed, Math.floor(m.travel + m.y), 0x5d1), r = (h & 255) / 255;
      particles.spawn(m.x + (r - 0.5) * 16, m.y - HIP - 18, (r - 0.5) * 10, -20 - r * 10, 0, PW.abgr(54, 50, 48, 200), F.SMOKE, 2.5 + r * 2);
    }
  }

  // ---- Seeing a round coming, and dodging it ----------------------------------------------------------
  // (a round of another side - a shell, a burst, a missile - whose way brings it within reach of its
  // body in the next DODGE_LOOK s, that it can see: in front of it or over it, within SIGHT, nothing
  // solid between its eyes and it. A round from behind it, or round a corner, it does not see)
  function sees(world, m, x, y) {
    const ex = m.x + m.facing * 24, ey = m.y - HIP - 12;
    if ((x - m.x) * m.facing < -30 && y > m.y - HEIGHT - 40) return false;
    const n = Math.ceil(Math.hypot(x - ex, y - ey) / 4);
    for (let q = 1; q < n; q += 1) {
      const px = Math.floor(ex + (x - ex) * q / n), py = Math.floor(ey + (y - ey) * q / n);
      if (py >= 0 && blocks(world, px, py)) return false;
    }
    return true;
  }
  function watchRounds(world, m) {
    if (m.dodgeT > 0 || m.charge > 0 || !(m.onGround || m.fuel > 0.3)) return;
    const list = world.shots;
    if (!list || !list.length) return;
    const cx = m.x, cy = m.y - HEIGHT / 2;
    let best = null, soonest = DODGE_LOOK;
    for (const s of list) {
      if (s.done || s.from === m || (m.side && s.side === m.side)) continue;
      const rx = cx - s.x, ry = cy - s.y;
      if (rx * rx + ry * ry > SIGHT * SIGHT) continue;
      const vv = s.vx * s.vx + s.vy * s.vy;
      if (vv < 1) continue;
      const t = (rx * s.vx + ry * s.vy) / vv;
      if (t < 0.03 || t > soonest) continue;
      // (where it passes it: over or through its body?)
      const mx = rx - s.vx * t, my = ry - s.vy * t;
      if (Math.abs(mx) > HALF + 8 || Math.abs(my) > HEIGHT / 2 + 8) continue;
      if (!sees(world, m, s.x, s.y)) continue;
      best = s; soonest = t;
    }
    if (!best) return;
    // (a flat shot it leaps over; one coming down on it, it hops aside from - away from it)
    if (Math.abs(best.vx) >= Math.abs(best.vy)) { m.vy = -DODGE_UP; m.vx = -Math.sign(best.vx) * 40; }
    else { const away = Math.sign(m.x - best.x) || -m.facing; m.vx = away * DODGE_SIDE; m.vy = -150; }
    if (!m.onGround) m.fuel = Math.max(0, m.fuel - 0.3);
    m.onGround = false; m.accY = 0; m.charge = 0;
    m.dodgeT = DODGE_COOL;
    stats.dodged += 1;
  }

  // ---- Its look, and its pose --------------------------------------------------------------------------
  // Its hull's side view, facing right (u forward, v down), its hips at (0, 0): the hull, a wedge
  // beaked forward; its eye slit; the fins; the missile pod on its back; the cannon under its chin;
  // the jet nozzle at its tail. Shaded from above.
  const HULL = [[-24, -3], [-22, -14], [-12, -22], [6, -25], [18, -19], [30, -11], [36, -7], [28, -3], [16, 2], [-6, 4], [-18, 3]];
  const FIN_A = [[-15, -19], [-24, -46], [-20, -46], [-9, -21]];
  const FIN_B = [[-8, -22], [-14, -36], [-11, -36], [-3, -23]];
  const inPoly = (poly, x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  function partAt(u, v) {
    if (u * u + v * v <= 25) return 'joint';
    if (u >= 22 && u <= 44 && v >= 0 && v <= 2) return 'gun';
    if (u >= 14 && u <= 24 && v >= -3 && v <= 3) return 'gunbody';
    if (u >= 10 && u <= 12 && ((v >= -29 && v <= -28) || (v >= -26 && v <= -25))) return 'missile';
    if (u >= -2 && u <= 10 && v >= -31 && v <= -24) return 'pod';
    if (u >= -29 && u <= -23 && v >= -11 && v <= -3) return 'nozzle';
    if (inPoly(HULL, u, v)) return u >= 20 && u <= 29 && v >= -13 && v <= -10 ? 'eye' : 'hull';
    if (inPoly(FIN_A, u, v) || inPoly(FIN_B, u, v)) return 'fin';
    return 0;
  }
  const rgb = (c, k = 1) => PW.abgr(Math.max(0, Math.min(255, c[0] * k)) | 0, Math.max(0, Math.min(255, c[1] * k)) | 0, Math.max(0, Math.min(255, c[2] * k)) | 0);
  const arts = new Map();
  function artOf(style) {
    if (arts.has(style)) return arts.get(style);
    const st = STYLES[style] || STYLES.modern, x0 = -30, x1 = 45, y0 = -47, y1 = 6, w = x1 - x0 + 1, h = y1 - y0 + 1;
    const px = new Uint32Array(w * h), kind = new Array(w * h);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) kind[(y - y0) * w + (x - x0)] = partAt(x + 0.5, y + 0.5);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const k = (y - y0) * w + (x - x0), part = kind[k];
      if (!part) continue;
      const up = y > y0 && kind[k - w], down = y < y1 && kind[k + w];
      const light = !up ? 1.2 : !down ? 0.66 : 1 - (y - y0) / h * 0.25;
      let c;
      if (part === 'eye') c = rgb([255, 196, 96]);
      else if (part === 'gun') c = rgb([56, 58, 60], light);
      else if (part === 'gunbody' || part === 'joint') c = rgb(st.dark, light * 0.9);
      else if (part === 'missile') c = rgb([200, 200, 196]);
      else if (part === 'pod') c = (x === 3 || y === -28) ? rgb(st.dark, 0.8) : rgb(st.base, light * 0.92);
      else if (part === 'nozzle') c = rgb([62, 60, 58], light);
      else if (part === 'fin') c = (y === -40 || y === -41) && x < -16 ? rgb(st.mark) : rgb(st.dark, light);
      // (the hull: plates, their seams; the gothic's in a lattice)
      else c = (style === 'gothic' ? ((x + y * 2) % 11 === 0) : (x === -6 || x === 14 || y === -12)) ? rgb(st.dark, 0.95) : rgb(st.base, light);
      px[k] = c;
    }
    const a = { x0, y0, x1, y1, w, h, px };
    arts.set(style, a);
    return a;
  }
  const at = (s, x, y) => (x < s.x0 || y < s.y0 || x > s.x1 || y > s.y1 ? 0 : s.px[(y - s.y0) * s.w + (x - s.x0)]);

  // (a leg from its hip (hx, hy) to its ankle (ax, ay): the knee behind - the bend away from the way
  // it faces; out of its reach, the ankle drawn in to it)
  function legOf(hx, hy, ax, ay, f) {
    let dx = ax - hx, dy = ay - hy, d = Math.hypot(dx, dy) || 1;
    const far = THIGH + SHIN - 0.5, near = Math.abs(THIGH - SHIN) + 2;
    if (d > far) { ax = hx + dx / d * far; ay = hy + dy / d * far; dx = ax - hx; dy = ay - hy; d = far; }
    if (d < near) { ax = hx + dx / d * near; ay = hy + dy / d * near; dx = ax - hx; dy = ay - hy; d = near; }
    const a = (THIGH * THIGH - SHIN * SHIN + d * d) / (2 * d), h = Math.sqrt(Math.max(0, THIGH * THIGH - a * a));
    const px = hx + dx * a / d, py = hy + dy * a / d, nx = -dy / d, ny = dx / d;
    let kx = px + h * nx, ky = py + h * ny;
    if ((kx - hx) * f > (px - h * nx - hx) * f) { kx = px - h * nx; ky = py - h * ny; }
    return { hx, hy, kx, ky, ax, ay, tx: ax + f * TOE, ty: ay + ANKLE, bx: ax - f * HEEL, by: ay + ANKLE };
  }
  // (the row its foot finds the ground on in column x, near its soles' row y)
  function footGround(world, x, y) {
    for (let yy = y - STEP_UP; yy <= y + STEP_DOWN + 6; yy += 1) if (!blocks(world, x, yy) && (blocks(world, x, yy + 1) || isPlatform(world, x, yy + 1))) return yy;
    return y;
  }
  // Its pose: its hips' place (crouched for a leap, squatting from a landing, bobbing as it strides)
  // and where each foot is - on the ground striding, stretched back leaping, tucked boosting,
  // reaching down falling.
  function poseOf(world, m) {
    const f = m.facing;
    let hx = m.x, hy = m.y - HIP;
    const striding = m.onGround && Math.abs(m.vx) > 3;
    if (m.charge > 0) hy += 10 * (1 - m.charge / WIND_UP);
    else if (m.landT > 0) hy += 8 * m.landT / LAND_T;
    if (striding) hy -= Math.abs(Math.sin(m.travel / STRIDE * Math.PI * 2)) * 2;
    const legs = [];
    for (let i = 0; i < 2; i += 1) {
      let ax, ay;
      if (!m.onGround) {
        const [fu, fv] = m.boosting ? (i ? [-4, 30] : [6, 32]) : m.vy < 0 ? (i ? [-16, 41] : [-8, 42]) : (i ? [2, 38] : [12, 39]);
        ax = hx + f * fu; ay = hy + fv;
      } else {
        let fu = i ? -6 : 6, lift = 0;
        if (striding) {
          const ph = ((m.travel / STRIDE + i * 0.5) % 1 + 1) % 1;
          if (ph < 0.5) fu = STRIDE * (0.25 - ph);
          else { fu = STRIDE * (ph - 0.75); lift = Math.sin((ph - 0.5) * 2 * Math.PI) * 8; }
        }
        ax = hx + f * fu;
        ay = footGround(world, Math.round(ax), m.y) - ANKLE - lift + 1;
      }
      legs.push(legOf(hx, hy, ax, ay, f));
    }
    const st = STYLES[m.style];
    return { m, f, hx, hy, legs, art: artOf(m.style), near: [rgb(st.base, 1.05), rgb(st.light), rgb(st.dark)], far: [rgb(st.base, 0.8), rgb(st.base, 0.92), rgb(st.dark, 0.85)] };
  }
  // (how far (x, y) is from the segment (x0, y0)-(x1, y1), squared)
  const seg2 = (x, y, x0, y0, x1, y1) => {
    const sx = x1 - x0, sy = y1 - y0, l = sx * sx + sy * sy || 1, t = Math.max(0, Math.min(1, ((x - x0) * sx + (y - y0) * sy) / l));
    const ex = x0 + sx * t - x, ey = y0 + sy * t - y;
    return ex * ex + ey * ey;
  };
  function legPix(L, cols, x, y) {
    if (x < Math.min(L.hx, L.kx, L.ax, L.tx, L.bx) - 4 || x > Math.max(L.hx, L.kx, L.ax, L.tx, L.bx) + 4 || y < Math.min(L.hy, L.ky) - 4 || y > L.ty + 2) return 0;
    if ((x - L.kx) ** 2 + (y - L.ky) ** 2 <= 12) return cols[2];          // the knee joint
    if (seg2(x, y, L.hx, L.hy, L.kx, L.ky) <= 11) return cols[0];        // the thigh
    if (seg2(x, y, L.kx, L.ky, L.ax, L.ay) <= 5.5) return cols[1];       // the shin
    if (seg2(x, y, L.bx, L.by - 0.5, L.tx, L.ty - 0.5) <= 2.6 || seg2(x, y, L.ax, L.ay, L.ax, L.ay + ANKLE) <= 3) return cols[2];   // the foot
    return 0;
  }
  // (what of it is at world point (x, y): its colour as drawn, or 0 - its near leg over its hull, its
  // far leg behind)
  function pixelP(P, x, y) {
    let c = legPix(P.legs[0], P.near, x, y);
    if (c) return c;
    c = at(P.art, Math.floor((x - P.hx) * P.f), Math.floor(y - P.hy));
    if (c) return c;
    return legPix(P.legs[1], P.far, x, y);
  }
  const pixel = (m, x, y) => pixelP(m.P || poseOf(current, m), x, y);
  const boxOf = (P) => ({ x0: P.hx - 46, x1: P.hx + 46, y0: P.hy - 48, y1: P.m.y + 3 });

  // ---- Fighting ------------------------------------------------------------------------------------------
  function muzzle(m) {
    const P = m.P, x = P.hx + P.f * 45, y = P.hy + 1;
    let dx = m.facing, dy = 0;
    if (m.aim) { dx = m.aim.x - x; dy = m.aim.y - y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d; }
    // (its cannon swings on its mount, at most 50 degrees up or down; behind it, it turns round)
    if (Math.sign(dx) && Math.sign(dx) !== m.facing && m.onGround) { m.facing = Math.sign(dx); m.P = poseOf(current, m); return muzzle(m); }
    const a = Math.max(-0.87, Math.min(0.87, Math.atan2(-dy, Math.abs(dx))));
    return { x, y, dx: Math.cos(a) * m.facing, dy: -Math.sin(a) };
  }
  // F: a burst of its cannon at the spot last clicked (or ahead).
  function fire(world, m) {
    if (!m || m.dead || m.burst > 0 || m.reload > 0 || !PW.shots) return false;
    if (m.mag <= 0) { reload(m); return false; }
    m.burst = Math.min(BURST, m.mag); m.burstT = 0;
    return true;
  }
  function fireStep(world, m, dt) {
    if (!m.burst || !PW.shots) return;
    m.burstT -= dt;
    while (m.burst > 0 && m.burstT <= 0) {
      const mz = muzzle(m);
      PW.shots.fire(world, { kind: 'cannon', x: mz.x, y: mz.y, dx: mz.dx, dy: mz.dy, side: m.side, from: m, spread: 0.02, vx0: m.vx, vy0: m.vy });
      if (PW.shots.report) PW.shots.report(world, mz.x, mz.y, mz.dx, mz.dy, 1);
      m.burst -= 1; m.mag -= 1; m.burstT += ROF;
      stats.fired += 1;
    }
    if (m.mag <= 0) reload(m);
  }
  function reload(m) { if (m.reload <= 0 && m.ammo > 0 && m.mag < MAG) m.reload = RELOAD; }
  // G: a missile off its pod at the unit nearest where it is aimed (or that spot).
  function launch(world, m) {
    if (!m || m.dead || m.missiles <= 0 || !PW.shots) return null;
    const aim = m.aim || { x: m.x + m.facing * 600, y: m.y - HIP };
    let target = null, best = 250;
    for (const list of [world.tanks, world.troops, world.jets, world.mechs, world.defence]) for (const u of list || []) {
      if (u.dead || u === m || (m.side && u.side === m.side)) continue;
      const d = Math.hypot(u.x - aim.x, u.y - aim.y);
      if (d < best) { best = d; target = u; }
    }
    const P = m.P, x = P.hx + P.f * 12, y = P.hy - 28;
    m.missiles -= 1;
    stats.missiles += 1;
    return PW.shots.fire(world, { kind: 'missile', x, y, dx: m.facing * 0.5, dy: -0.87, side: m.side, from: m, target: target || aim, aimDy: target && target.kind !== 'jet' ? 14 : 0 });
  }

  // ---- Struck, hurt, destroyed ------------------------------------------------------------------------------
  function hurt(world, m, amount, cause) {
    if (m.dead || !(amount > 0)) return;
    m.hp -= amount; m.hurtBy = cause;
    if (m.hp <= 0) destroy(world, m);
  }
  // A blast throws it a little and hurts it - less for the cover between.
  function blast(world, cx, cy, r, power = 1) {
    for (const m of world.mechs || []) {
      if (m.dead) continue;
      const mx = Math.max(m.x - HALF, Math.min(m.x + HALF, cx)), my = Math.max(m.y - HEIGHT + 1, Math.min(m.y, cy));
      const d = Math.hypot(mx - cx, my - cy), reach = r * 1.6 + 8;
      if (d >= reach) continue;
      const k = power * (1 - d / reach) - cover(world, cx, cy, mx, my);
      if (k <= 0) continue;
      const ux = (m.x - cx) / (Math.hypot(m.x - cx, m.y - HEIGHT / 2 - cy) || 1);
      m.vx += ux * 120 * k; m.vy = Math.min(m.vy, -80 * k); m.onGround = false; m.accY = 0;
      hurt(world, m, 70 * k * k, 'blast');
    }
  }
  function cover(world, x0, y0, x1, y1) {
    const { mat, width: W, height: H } = world, n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    let lost = 0;
    for (let q = 1; q < n; q += 1) {
      const x = Math.floor(x0 + (x1 - x0) * q / n), y = Math.floor(y0 + (y1 - y0) * q / n);
      if (x >= 0 && y >= 0 && x < W && y < H) lost += blastResist[mat[y * W + x] & ID_MASK];
    }
    return lost;
  }
  // (its body at world point (x, y), for what falls on it - see pw-fragments' glance; struck by a
  // falling piece, a heavy or fast one dents it, a little of its way passed on)
  function touches(m, x, y) { return m.dead || !m.P ? 0 : pixelP(m.P, x, y) ? 1 : 0; }
  const SHRUG = 30000, DENT = 3000;
  function struck(world, m, x, y, part, mass, vx, vy) {
    const blow = mass * Math.hypot(vx, vy);
    m.vx += vx * Math.min(1, mass / 4000) * 0.3;
    const dmg = Math.max(0, (blow - SHRUG) / DENT);
    if (dmg > 0) hurt(world, m, dmg, 'debris');
    return dmg;
  }
  // (its armour gone: it falls apart where it stands - its pixels, as it stood, coming down a
  // building's piece's way (see pw-fragments), burnt; its fuel and power cell in flames, the wreck
  // burning on - no blast beyond its own fire)
  const burnt = (c, x, y) => { const h = PW.hash2(x, y), k = 0.3 + ((h >>> 3) & 7) / 45; return PW.abgr(Math.min(255, (c & 255) * k + 14), Math.min(255, (c >>> 8 & 255) * k + 12), Math.min(255, (c >>> 16 & 255) * k + 10)); };
  function destroy(world, m) {
    if (m.dead) return;
    m.hp = 0; m.dead = true; m.burst = 0; m.boosting = false;
    stats.destroyed += 1;
    if (held === m) held = null;
    const P = m.P || poseOf(world, m), B = boxOf(P), fr = world.fragments, { mat, width: W, height: H } = world;
    const xs = [], ys = [], cs = [];
    for (let y = Math.max(1, Math.floor(B.y0)); y <= Math.min(H - 2, Math.ceil(B.y1)); y += 1) {
      for (let x = Math.max(1, Math.floor(B.x0)); x <= Math.min(W - 2, Math.ceil(B.x1)); x += 1) {
        const col = pixelP(P, x + 0.5, y + 0.5);
        if (!col || !PW.mat.open[mat[y * W + x] & ID_MASK]) continue;
        xs.push(x); ys.push(y); cs.push(burnt(col, x, y));
      }
    }
    if (fr && xs.length) {
      const n = xs.length;
      fr.spawn({ data: { x: Int32Array.from(xs), y: Int32Array.from(ys), color: Uint32Array.from(cs), byte: new Uint8Array(n).fill(M.STEEL), solid: new Uint8Array(n).fill(1) },
        vx: m.vx * 0.4, vy: Math.min(0, m.vy) * 0.3 - 30, omega: -m.facing * 0.9, wreck: true });
    }
    if (world.heatSystem) world.heatSystem.heatDisc(P.hx, P.hy - 8, 22, 760);
    const particles = world.particles, F = PW.PARTICLE;
    if (particles && F) for (let k = 0; k < 200; k += 1) {
      const h = PW.hash3(m.seed, k, 71), r1 = (h & 1023) / 1023, r2 = (h >>> 10 & 1023) / 1023, r3 = (h >>> 20 & 1023) / 1023;
      const a = -Math.PI / 2 + (r2 - 0.5) * 1.8, sp = 20 + r3 * r3 * 110;
      particles.spawn(P.hx + (r1 - 0.5) * 40, P.hy - 10 + r3 * 14, Math.cos(a) * sp * 0.7, Math.sin(a) * sp, 0, PW.abgr(46, 42, 40, 220), F.FIRE, 0.5 + r2 * 1.1);
    }
    (world.wrecks || (world.wrecks = [])).push({ x: m.x, y: m.y, width: 40, left: BURN_OUT, acc: 0, n: 0 });
  }
  // What a round meets of it: its own pixels as drawn.
  const target = {
    hit(world, s, x0, y0, x1, y1) {
      const list = world.mechs;
      if (!list || !list.length) return null;
      let best = null;
      const sx = x1 - x0, sy = y1 - y0, n = Math.max(1, Math.ceil(Math.hypot(sx, sy)));
      for (const m of list) {
        if (m.dead || m === s.from || !m.P) continue;
        const B = boxOf(m.P);
        if (Math.max(x0, x1) < B.x0 || Math.min(x0, x1) > B.x1 || Math.max(y0, y1) < B.y0 || Math.min(y0, y1) > B.y1) continue;
        for (let q = 0; q <= n; q += 1) {
          const f = q / n;
          if (best && f >= best.f) break;
          if (pixelP(m.P, x0 + sx * f, y0 + sy * f)) { best = { f, x: x0 + sx * f, y: y0 + sy * f, ref: m, part: 1 }; break; }
        }
      }
      return best;
    },
    strike(world, m, s) { hurt(world, m, DAMAGE[s.kind] ?? 1, s.kind); return true; },
  };

  // ---- The step ------------------------------------------------------------------------------------------------
  function step(world, dt) {
    if (PW.shots && PW.shots.addTarget && !target.added) { PW.shots.addTarget(target); target.added = true; }
    const list = world.mechs;
    if (!list || !list.length) return;
    current = world;
    for (const m of list) if (!m.dead) stepOne(world, m, dt);
    for (let q = list.length - 1; q >= 0; q -= 1) if (list[q].dead) list.splice(q, 1);
  }

  // ---- Drawn -----------------------------------------------------------------------------------------------------
  let canvas = null, ctx2 = null, image = null, px32 = null;
  function draw(renderer) {
    const world = renderer.world || current;
    const list = world && world.mechs;
    if (!list || !list.length) return;
    const { ctx, camera, view } = renderer;
    const z = camera.zoom, skip = Math.max(1, Math.floor(1 / z));
    const vx0 = camera.x, vy0 = camera.y, vx1 = vx0 + view.width / z, vy1 = vy0 + view.height / z;
    for (const m of list) {
      if (m.dead) continue;
      const P = m.P || (m.P = poseOf(world, m)), B = boxOf(P);
      const x0 = Math.max(Math.floor(B.x0), Math.floor(vx0)), x1 = Math.min(Math.ceil(B.x1), Math.ceil(vx1));
      const y0 = Math.max(Math.floor(B.y0), Math.floor(vy0)), y1 = Math.min(Math.ceil(B.y1), Math.ceil(vy1));
      if (x1 <= x0 || y1 <= y0) continue;
      const iw = Math.ceil((x1 - x0) / skip), ih = Math.ceil((y1 - y0) / skip);
      if (!canvas || canvas.width < iw || canvas.height < ih) {
        canvas = document.createElement('canvas');
        canvas.width = Math.ceil(Math.max(iw, 128) / 64) * 64; canvas.height = Math.ceil(Math.max(ih, 128) / 64) * 64;
        ctx2 = canvas.getContext('2d'); image = ctx2.createImageData(canvas.width, canvas.height); px32 = new Uint32Array(image.data.buffer);
      }
      const stride = canvas.width;
      for (let jy = 0; jy < ih; jy += 1) {
        const wy = y0 + jy * skip + 0.5, row = jy * stride;
        px32.fill(0, row, row + iw);
        for (let ix = 0; ix < iw; ix += 1) { const col = pixelP(P, x0 + ix * skip + 0.5, wy); if (col) px32[row + ix] = col; }
      }
      ctx2.putImageData(image, 0, 0, 0, 0, iw, ih);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, iw, ih, Math.round((x0 - vx0) * z), Math.round((y0 - vy0) * z), Math.round(iw * skip * z), Math.round(ih * skip * z));
      // (its jets alight: a flame down out of its nozzle)
      if (m.boosting) {
        const fx = P.hx - P.f * 26, fy = P.hy - 3;
        ctx.fillStyle = 'rgba(255,176,80,0.9)';
        for (let k = 0; k < 10; k += 1) { const w = Math.max(1, (4 - k * 0.35) * z); ctx.fillRect(Math.round((fx - vx0) * z - w / 2), Math.round((fy + k - vy0) * z), w, Math.max(1, z)); }
      }
    }
  }
  const before = PW.drawUnitsHook;
  PW.drawUnitsHook = (renderer) => { if (before) before(renderer); draw(renderer); };

  // ---- By hand -------------------------------------------------------------------------------------------------
  // A click on a mech takes it in hand (again: lets it go); with one in hand a click is where it
  // aims; a click elsewhere sets a mech down on the ground under it (shift: another).
  let held = null, dropN = 0;
  function tool(world, x, y, shift = false) {
    const list = world.mechs || [];
    if (held && (held.dead || !list.includes(held))) held = null;
    const hit = list.find((m) => !m.dead && m.P && pixel(m, x, y));
    if (hit) { held = hit === held ? null : hit; return held; }
    if (held && !shift) { held.aim = { x, y }; return held; }
    const gx = Math.round(x);
    if (gx < 60 || gx > world.width - 60) return null;
    let gy = Math.max(1, Math.round(y));
    if (blocks(world, gx, gy)) { while (gy > 1 && blocks(world, gx, gy)) gy -= 1; } else gy = groundUnder(world, gx, gy);
    if (!clear(world, gx, gy)) return null;
    let side = null, best = Infinity;
    for (const b of world.buildings || []) {
      const s = b.faction || b.side, bx = b.body ? (b.body.left + b.body.right) / 2 : b.x;
      if (s && Number.isFinite(bx) && Math.abs(bx - gx) < best) { best = Math.abs(bx - gx); side = s; }
    }
    held = create(world, { x: gx + 0.5, y: gy, side, style: ['modern', 'asian', 'gothic'][dropN++ % 3], facing: gx < world.width / 2 ? 1 : -1 });
    return held;
  }
  function hold(m) { held = m && !m.dead && m.kind === 'mech' ? m : null; return held; }
  // (driving it by code, as the keys do)
  function walk(m, dir) { m.walk = Math.sign(dir); }
  function leap(m, power = 1) {
    if (!m || m.dead || !m.onGround || m.charge > 0) return false;
    m.charge = WIND_UP; m.leap = JUMP * power;
    return true;
  }
  function boost(m, on = true) {
    if (!m || m.dead) return false;
    m.boosting = on && m.fuel > 0;
    if (m.boosting) stats.boosted += 1;
    return m.boosting;
  }
  function key(event) {
    if (!held || held.dead || event.repeat) return false;
    const m = held, world = current || (window.pwApp && window.pwApp.world), k = event.code;
    if (k === 'KeyA' || k === 'ArrowLeft') m.walk = -1;
    else if (k === 'KeyD' || k === 'ArrowRight') m.walk = 1;
    else if (k === 'KeyW' || k === 'ArrowUp') { if (m.onGround && !m.boosting) leap(m); else boost(m, !m.boosting); }
    else if (k === 'KeyS' || k === 'ArrowDown') { if (m.boosting) m.boosting = false; else m.walk = 0; }
    else if (k === 'KeyF') fire(world, m);
    else if (k === 'KeyG') launch(world, m);
    else if (k === 'KeyR') reload(m);
    else return false;
    return true;
  }

  PW.mechs = { create, step, draw, walk, leap, boost, fire, launch, reload, hurt, blast, touches, struck, target, tool, key, hold, held: () => held, pixel, stats, clear,
    HIP, HEIGHT, HALF, WALK, STEP_UP, JUMP, FUEL, FALL_SAFE, ARMOUR, SIGHT, DODGE_COOL, MAG, MISSILES };
})();
