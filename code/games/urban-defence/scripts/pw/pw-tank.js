'use strict';
// Tanks (N10), after the user's TankMovement and TankAim GIFs, drawn at their real size (a cell is
// about 7 cm: a main battle tank's hull about 116 cells long, 38 to its turret roof) and in two
// parts, as the user asked:
// - the hull and its running gear: each road wheel finds the ground under it on its own spring
//   (SPRING_UP / SPRING_DOWN cells of travel), the hull lies along the line through them, and the
//   track belt wraps the wheels as they lie - so the tracks always follow the ground under them.
//   The track's links and the wheels' spokes run round in the GIF's three-frame cycle, step for
//   step with the ground covered (they never slide on it).
// - the turret and its long gun, stabilised: the turret stays level on any slope the tank drives
//   (tipped further, into a hole, the hull carries it over), and the gun is laid in the world's
//   frame - level ahead, or on its target, from GUN_DOWN below the horizontal to GUN_UP above it
//   (it can only shoot so far up), and never down into its own deck.
//   With a target behind it the turret turns round to it, and the hull drives on as it was going.
// A tank drives left or right only, reaching its top speed in 1.5 s; to go the other way it stops
// and turns round on its tracks, or backs up (reverse). It climbs slopes up to MAX_SLOPE and steps
// up to STEP cells. It will not go into a wall, a tunnel (it has no room there), deep water or
// over a drop; and where the ground is blown away from under it, it tips over the edge and falls.
// Each side's tanks are a real army's of its region (as its troopers are - see pw-unit-art):
//   modern - a US M1 Abrams: sand tan, an angular turret with a long bustle, side skirts, 7 wheels;
//   asian  - a PLA Type 99: olive green with digital camouflage, a long wedge turret, 6 wheels;
//   gothic - a Ukrainian T-64: dark green, a rounded turret, blocks of reactive armour on its
//            glacis and turret front, a white cross on its turret side, 6 small wheels.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;

  const VMAX = 54;              // cells/s top speed (about 14 km/h: slow, but faster than a trooper)
  const ACCEL = VMAX / 1.5;     // cells/s^2: from rest to top speed in 1.5 s
  const BRAKE = VMAX / 0.6;     // cells/s^2 to a stop
  const REVERSE = 0.6;          // of its top speed, backing up
  const CLIMB = 0.6;            // of its top speed it loses climbing, by the sine of the slope
  const PIVOT = 0.7;            // s it takes to turn round on its tracks
  const MAX_SLOPE = 35;         // degrees it climbs, at most
  const LEVEL = MAX_SLOPE;      // degrees of the hull's tilt the turret is held level through
  const STEP = 8;               // cells it climbs straight up at most (a kerb, a low heap)
  const DROP = 16;              // cells it goes down straight at most (it stops at a higher edge)
  const LOOK = 48;              // cells ahead of its leading wheel it looks at the ground (room to brake)
  const NOSE = 60;              // cells from its middle its nose and lower plate reach, and a little
  const SPAN = 16;              // cells a slope is measured over (a kerb within it is a step, not a slope)
  const HEADROOM = 40;          // cells of open space it needs over its tracks (no tunnels)
  const DEEP = 26;              // cells of water it fords at most
  const SPRING_UP = 5, SPRING_DOWN = 4;   // cells of travel each road wheel has, up and down
  const WHEEL = 6;              // cells a road wheel's radius (about 0.85 m across)
  const MAX_TILT = 85;          // degrees the hull lies over at most, on its wheels
  const TIP = 3;                // rad/s^2 it tips over an edge with nothing under its middle
  const TIP_MAX = 80;           // degrees it tips to on the edge before it slides off it and falls
  const GUN_UP = 60, GUN_DOWN = 6;   // degrees the gun lays above and below the horizontal
  const DECK = 10;              // degrees the gun keeps above its own deck, the hull nose-up
  const SLEW = 1.4;             // rad/s the gun is laid at
  const TURN = 0.45;            // s the turret takes to turn round to a target behind
  const G = PW.GRAVITY || 260;
  const deg = Math.PI / 180;

  // ---- The look --------------------------------------------------------------------------------------
  const STYLES = {
    modern: { base: [196, 174, 126], dark: [148, 128, 90], wheel: [96, 92, 82], wheels: 7, span: 46, skirt: [-50, 50, -18, -9], barrel: 76,
      turret: [[-34, -3], [-32, -10], [18, -11], [26, -5], [24, 0], [-25, 0]] },
    asian: { base: [96, 112, 68], dark: [66, 80, 48], wheel: [76, 82, 66], wheels: 6, span: 42, skirt: [-47, 46, -17, -12], barrel: 80,
      camo: { spots: [[64, 82, 48], [130, 126, 86], [102, 86, 58], [120, 144, 82]], density: 0.42 },
      turret: [[-28, -2], [-25, -10], [10, -11], [31, -3], [25, 0], [-23, 0]], star: true },
    gothic: { base: [64, 78, 52], dark: [44, 54, 36], wheel: [70, 76, 60], wheels: 6, span: 40, skirt: null, barrel: 74,
      turret: null, era: true, cross: true },
  };
  const rgb = (c, k = 1) => PW.abgr(Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k));
  const TRACK = [44, 42, 38], LINK = [74, 72, 66], RUBBER = [34, 33, 31], HUB = [104, 100, 92], ERA = [78, 94, 62];
  const inPoly = (poly, x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  // A sprite: a grid over [x0, x1] x [y0, y1] of colours (0: empty), shaded with the world's light
  // from above: top edges lit, bottom edges dark.
  function sprite(x0, y0, x1, y1, shape, colour) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint32Array(w * h), on = new Uint8Array(w * h);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (shape(x + 0.5, y + 0.5)) on[(y - y0) * w + (x - x0)] = 1;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const k = (y - y0) * w + (x - x0);
      if (!on[k]) continue;
      const up = y > y0 && on[k - w], down = y < y1 && on[k + w], side = x > x0 && x < x1 && on[k - 1] && on[k + 1];
      const light = !up ? 1.22 : !down ? 0.66 : !side ? 0.82 : 1 - (y - y0) / h * 0.18;
      px[k] = colour(x, y, light);
    }
    return { x0, y0, x1, y1, w, h, px };
  }
  const at = (s, x, y) => (x < s.x0 || y < s.y0 || x > s.x1 || y > s.y1 ? 0 : s.px[(y - s.y0) * s.w + (x - s.x0)]);
  // (camouflage: single-cell digital spots, as the troopers' - see pw-unit-art)
  const camoAt = (st, x, y) => {
    if (!st.camo) return st.base;
    const h = PW.hash2(x * 3 + 1, y * 5 + 2);
    return (h & 255) / 255 < st.camo.density ? st.camo.spots[(h >>> 8) % st.camo.spots.length] : st.base;
  };
  const ART = new Map();
  function artOf(style) {
    let a = ART.get(style);
    if (a) return a;
    const st = STYLES[style] || STYLES.modern;
    // The hull, facing right (u forward, v down; v = 0 the bottom of the track's run under it):
    // its upper body from the rear plate to the glacis and the lower front plate, the fenders over
    // the tracks, and the side skirts where it has them.
    const body = [[-58, -27], [32, -27], [58, -20], [58, -18], [53, -16], [-56, -16], [-58, -18]];
    const skirt = st.skirt;
    const hull = sprite(-60, -30, 60, -6, (u, v) => inPoly(body, u, v) || (skirt && u >= skirt[0] && u <= skirt[1] && v >= skirt[2] && v <= skirt[3] - ((Math.floor(u) & 7) === 0 ? 1 : 0)), (u, v, light) => {
      let c = camoAt(st, u, v), k = light;
      if (v === -17 || v === -18) k *= 0.62;                       // (the fender's edge)
      if (skirt && v > -17) k *= 0.9;
      // (reactive armour on the glacis: blocks in rows along it)
      if (st.era && u >= 34 && v <= -20) c = (u - 34) % 5 === 0 || (v + 30) % 3 === 0 ? st.dark : ERA;
      if (u === -58 || u === 58) k *= 0.8;
      return rgb(c, k);
    });
    // The turret, level, facing right (t forward, s down; s = 0 its ring on the hull's roof), with
    // its commander's cupola and a machine gun on top, and the mantlet the gun pivots in.
    const shape = st.turret || Array.from({ length: 19 }, (_, k) => { const a = Math.PI * k / 18; return [26 * Math.cos(a), -11.5 * Math.sin(a)]; });
    const turret = sprite(-36, -17, 30, 0, (t, s) => inPoly(shape, t, s) || (t >= -9 && t <= 0 && s >= -14 && s <= -10) || (t >= 0 && t <= 9 && s >= -15.5 && s <= -14.5)
      || (t >= 15 && t <= 24 && s >= -9 && s <= -3), (t, s, light) => {
      let c = camoAt(st, t, s), k = light;
      if (t >= 0 && t <= 9 && s < -14) { c = [40, 40, 42]; k = 1; }            // (the machine gun)
      if (st.cross && t >= -16 && t <= -6 && s >= -8 && s <= -2 && (t === -11 || t === -12 || s === -5)) { c = [222, 222, 214]; k = 1; }
      if (st.star && t >= -14 && t <= -10 && s >= -7 && s <= -3 && Math.abs(t + 12) + Math.abs(s + 5) <= 2) { c = [196, 44, 36]; k = 1; }
      if (st.era && t >= 12 && s >= -10 && s <= -2) c = (t - 12) % 4 === 0 || (s + 10) % 3 === 0 ? st.dark : ERA;
      return rgb(c, k);
    });
    // (road wheels evenly along the hull; the drive sprocket at the rear and the idler at the front,
    // raised; small return rollers under the belt's top run)
    const wheels = Array.from({ length: st.wheels }, (_, k) => -st.span + (2 * st.span) * k / (st.wheels - 1));
    a = { style, st, hull, turret, wheels, R: WHEEL, sprocket: [-52, -9, 6], idler: [52, -10, 5], rollers: [-30, 0, 30].map((u) => [u, -13, 1.5]),
      trunnion: [20, -6], barrel: st.barrel, ring: [-2, -27], basket: rgb(st.dark, 0.55), nose: NOSE - st.span };
    ART.set(style, a);
    return a;
  }

  // ---- A tank on the ground ----------------------------------------------------------------------------
  // (what bears a tank: the ground, rubble and what is built - not water, smoke or cover, which it
  // passes like a trooper does, at another depth)
  const { phase, passable } = PW.mat, POWDER = PW.PHASE.POWDER;
  const isSupport = (m) => { const id = m & ID_MASK; return phase[id] >= POWDER && !passable[id]; };
  // (the top of what can bear a tank in column x, from `from`: the top of the ground `from` is in -
  // looked for up as far as it climbs and a little more, a wall higher than that given as that
  // height - or, `from` in the open, the ground under it, down as far as it might go; -1 if nothing)
  function surface(world, x, from) {
    const { mat, width: W, height: H } = world;
    if (x < 1 || x >= W - 1) return -1;
    const f = Math.max(1, Math.min(H - 1, Math.round(from))), y0 = Math.max(1, f - STEP - 4), y1 = Math.min(H - 1, f + 120);
    if (isSupport(mat[f * W + x])) {
      let y = f;
      while (y > y0 && isSupport(mat[(y - 1) * W + x])) y -= 1;
      return y;
    }
    for (let y = f + 1; y <= y1; y += 1) if (isSupport(mat[y * W + x])) return y;
    return -1;
  }
  // (where a road wheel's rim meets the ground: the highest of the ground across its lower arc, so
  // it rolls up onto the corner of a step rather than dropping into it, and bridges a crack)
  const ARC = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => [d, WHEEL - Math.sqrt(WHEEL * WHEEL - d * d)]);
  function wheelGround(world, x, from) {
    let best = -1;
    for (const [d, lift] of ARC) {
      const y = surface(world, Math.round(x) + d, from);
      if (y >= 0 && (best < 0 || y + lift < best)) best = y + lift;
    }
    return best;
  }
  let current = null;
  function create(world, spec) {
    const art = artOf(spec.style || 'modern'), facing = spec.facing || 1;
    const x = spec.x, y = spec.y ?? world.groundTop[Math.round(x)];
    const t = { art, style: art.style, x, y, facing, angle: 0, spin: 0,
      v: 0, vy: 0, drive: 0, reverse: false, pivot: 0, travel: 0, falling: false, tipping: false, blocked: '', dead: false,
      springs: new Float32Array(art.wheels.length), contact: new Uint8Array(art.wheels.length),
      target: null, aimFacing: facing, elevation: 0, turning: 0 };
    (world.tanks || (world.tanks = [])).push(t);
    current = world;
    settle(world, t, 0);
    return t;
  }
  // (the hull's frame: u forward along the ground under it, v down across it; the sprite mirrored
  // facing left)
  const dirOf = (t) => [t.facing * Math.cos(t.angle), t.facing * Math.sin(t.angle)];
  function toWorld(t, u, v) {
    const [fx, fy] = dirOf(t), nx = -Math.sin(t.angle), ny = Math.cos(t.angle);
    return [t.x + u * fx + v * nx, t.y + u * fy + v * ny];
  }
  // Lay the tank on the ground under it: each wheel finds the ground in its column; the hull lies
  // along the line through them (least squares, held within MAX_TILT, resting on the highest), and
  // each wheel takes up the rest on its spring. With its wheels all to one side of its middle (the
  // ground blown away from under the rest) it tips over the last of them; with none under it, it falls.
  const WX = new Float64Array(16), WY = new Float64Array(16);
  function settle(world, t, dt) {
    const { wheels } = t.art, n = wheels.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0, lo = -1, hi = -1;
    for (let i = 0; i < n; i += 1) {
      const [wx, wy] = toWorld(t, wheels[i], 0);
      const y = wheelGround(world, wx, wy);
      WX[i] = wx; WY[i] = y;
      t.contact[i] = 0;
      if (y < 0 || y > wy + SPRING_DOWN + 2) { WY[i] = -1; continue; }
      sx += wx; sy += y; sxx += wx * wx; sxy += wx * y; k += 1;
      if (lo < 0 || wx < WX[lo]) lo = i;
      if (hi < 0 || wx > WX[hi]) hi = i;
    }
    // (held up: its middle between wheels on the ground)
    if (k >= 2 && WX[lo] <= t.x + 0.5 && WX[hi] >= t.x - 0.5 && WX[hi] - WX[lo] > 2) {
      const den = k * sxx - sx * sx, max = Math.tan(MAX_TILT * deg);
      const slope = Math.max(-max, Math.min(max, den > 1e-6 ? (k * sxy - sx * sy) / den : 0));
      const mx = sx / k, my = sy / k;
      // (the line rests on its highest wheels: none pressed past its spring into the ground)
      let lift = 0;
      for (let i = 0; i < n; i += 1) if (WY[i] >= 0) lift = Math.max(lift, my + slope * (WX[i] - mx) - WY[i] - SPRING_UP);
      t.angle = Math.atan(slope);
      t.y = my + slope * (t.x - mx) - lift;
      const cosA = Math.cos(t.angle);
      for (let i = 0; i < n; i += 1) {
        const off = WY[i] < 0 ? SPRING_DOWN : (WY[i] - (my + slope * (WX[i] - mx) - lift)) * cosA;
        t.springs[i] = Math.max(-SPRING_UP, Math.min(SPRING_DOWN, off));
        t.contact[i] = WY[i] >= 0 && off - t.springs[i] < 1.5 ? 1 : 0;
      }
      t.falling = t.tipping = false; t.spin = 0;
      return;
    }
    if (k >= 1 && dt > 0) {
      // Tipping: over the wheel nearest its middle, that wheel staying where it is, its middle
      // going down on the open side - until it hangs nearly straight down, when it slides off the
      // edge and falls.
      const p = WX[hi] <= t.x + 0.5 ? hi : lo, px = WX[p], py = WY[p];
      const side = Math.abs(t.x - px) > 0.5 ? Math.sign(t.x - px) : Math.sign(t.spin || t.angle || 1);
      t.spin += side * TIP * dt;
      t.angle += t.spin * dt;
      t.tipping = true;
      if (Math.abs(t.angle) < TIP_MAX * deg) {
        const [fx, fy] = dirOf(t), u = wheels[p];
        t.x = px - u * fx; t.y = py - u * fy;
        t.falling = false; t.vy = 0; t.contact[p] = 1;
        for (let i = 0; i < n; i += 1) t.springs[i] = i === p ? 0 : SPRING_DOWN;
        return;
      }
      const over = Math.sign(t.angle);
      t.angle = over * TIP_MAX * deg; t.spin = 0;
      if (!t.falling) t.x += over * (t.art.R + 2);
    }
    if (dt > 0) { t.falling = true; t.tipping = false; for (let i = 0; i < n; i += 1) t.springs[i] = SPRING_DOWN; }
  }
  // What stops it going on `dir` (-1 / +1) from here, looking LOOK cells on from its leading wheel:
  // ground rising straighter than STEP or, over SPAN cells, steeper than MAX_SLOPE; a drop; too
  // little room over it (a tunnel, an overhang); deep water. ('' if nothing; t.room is then how far
  // it can still go, its nose short of it.)
  const HS = new Float64Array(LOOK + 1);
  function ahead(world, t, dir) {
    const { mat, width: W } = world;
    const { wheels } = t.art, lead = dir === t.facing ? wheels.length - 1 : 0;
    const [lx, ly] = toWorld(t, wheels[lead], t.springs[lead]);
    let x = Math.round(lx), prev = surface(world, x, ly);
    if (prev < 0) return '';
    const tanMax = Math.tan(MAX_SLOPE * deg);
    HS[0] = prev;
    const stop = (k, why) => { t.room = k - t.art.nose; return why; };
    for (let k = 1; k <= LOOK; k += 1) {
      x += dir;
      const h = surface(world, x, prev);
      HS[k] = h;
      if (h < 0 || h - prev > DROP) return stop(k - 1, 'drop');
      for (let s = 1; s <= Math.min(k, SPAN); s += 1) if (HS[k - s] - h > Math.max(STEP, s * tanMax)) return stop(k - s, 'too steep');
      for (let up = 1; up <= HEADROOM && h - up >= 0; up += 1) {
        if (isSupport(mat[(h - up) * W + x])) return stop(k, 'no room');
        if (up <= 4 && (PW.getFlags(world, x, h - up) & PW.FLAG.TUNNEL)) return stop(k, 'tunnel');
      }
      let water = 0;
      while (water <= DEEP && h - water - 1 >= 0 && (mat[(h - water - 1) * W + x] & ID_MASK) === M.WATER) water += 1;
      if (water > DEEP) return stop(k, 'deep water');
      prev = h;
    }
    return '';
  }
  // (turned round on its tracks: the same ground under the same wheels, the sprite mirrored)
  function turnRound(t) {
    t.facing = -t.facing;
    t.springs.reverse();
    if (!t.target) t.aimFacing = t.facing;
  }
  function step(world, dt) {
    const list = world.tanks;
    if (!list) return;
    for (const t of list) if (!t.dead) stepOne(world, t, dt);
  }
  function stepOne(world, t, dt) {
    // (its tracks off the ground, or all but one wheel: it neither drives nor turns)
    if (t.falling || t.tipping) { t.v = 0; t.pivot = 0; t.blocked = ''; } else if (t.pivot > 0) {
      t.pivot -= dt;
      if (t.pivot <= 0) { t.pivot = 0; turnRound(t); }
    } else {
      // Driving: on to its top speed the way it faces (less, uphill), backing up (reverse), or
      // braking to a stop and turning round; and braking in time for what stops it ahead, its nose
      // short of it.
      const way = t.drive && (t.drive === t.facing ? 1 : t.reverse ? REVERSE : 0);
      const want = t.drive * VMAX * way * (1 - CLIMB * Math.max(0, -t.drive * Math.sin(t.angle)));
      t.blocked = want ? ahead(world, t, Math.sign(want)) : '';
      let goal = want;
      if (t.blocked) {
        const room = Math.max(0, t.room), safe = Math.sqrt(2 * BRAKE * room);
        if (Math.abs(goal) > safe) goal = room < 1 ? 0 : Math.sign(want) * safe;
      }
      if (t.v !== goal) {
        const braking = t.v !== 0 && (Math.sign(goal) !== Math.sign(t.v) || Math.abs(goal) < Math.abs(t.v));
        const a = (braking ? BRAKE : ACCEL) * dt;
        let v = goal > t.v ? Math.min(goal, t.v + a) : Math.max(goal, t.v - a);
        if (braking && Math.sign(v) === -Math.sign(t.v)) v = 0;       // (it stops before it goes the other way)
        t.v = v;
      }
      if (t.drive && t.drive !== t.facing && !t.reverse && t.v === 0 && !t.falling) t.pivot = PIVOT;
    }
    if (t.falling) {
      t.vy += G * dt;
      t.y += t.vy * dt;
      t.x += t.v * dt;
      settle(world, t, dt);
      if (!t.falling && !t.tipping) t.vy = 0;          // (it came down on its tracks, the blow taken by its springs)
      if (t.y > world.height + 200) t.dead = true;
    } else {
      t.x += t.v * dt * Math.cos(t.angle);
      t.travel += t.v * dt * t.facing;
      settle(world, t, dt);
    }
    aim(t, dt);
  }
  // The gun laid on its target, or level ahead: in the world's frame, whatever the hull does - but
  // never down into the hull's own deck, the hull nose-up the way it points (and, the turret
  // carried over with the hull past LEVEL, within its own reach of the turret's tilt).
  function aim(t, dt) {
    let want = 0, side = t.facing;
    if (t.target) {
      const [px, py] = muzzleBase(t);
      side = t.target.x >= px ? 1 : -1;
      want = Math.atan2(py - t.target.y, Math.abs(t.target.x - px));
    }
    const tilt = -side * tiltOf(t), low = Math.max(tilt - GUN_DOWN * deg, -side * t.angle - DECK * deg);
    want = Math.max(low, Math.min(tilt + GUN_UP * deg, want));
    // (a target behind: the turret turns round to it, the gun held up clear meanwhile)
    if (side !== t.aimFacing) {
      t.turning += dt;
      if (t.turning >= TURN) { t.aimFacing = side; t.turning = 0; }
      want = Math.max(t.elevation, 10 * deg);
    } else t.turning = 0;
    const d = want - t.elevation, s = SLEW * dt;
    t.elevation += Math.abs(d) <= s ? d : Math.sign(d) * s;
  }
  // (where the turret ring is, in the world: on the hull's roof. The turret stands upright on it on
  // any slope the tank drives; the hull lying over further - tipped into a hole - it carries the
  // turret over with it, past LEVEL.)
  const ringAt = (t) => toWorld(t, t.art.ring[0], t.art.ring[1]);
  const tiltOf = (t) => t.angle - Math.max(-LEVEL * deg, Math.min(LEVEL * deg, t.angle));
  // (the turret's frame: t forward its gun's way, s down across it)
  const turretFrame = (t) => { const a = tiltOf(t), c = Math.cos(a), s = Math.sin(a); return [t.aimFacing * c, t.aimFacing * s, -s, c]; };
  function muzzleBase(t) {
    const [rx, ry] = ringAt(t), [fx, fy, nx, ny] = turretFrame(t), [u, v] = t.art.trunnion;
    return [rx + u * fx + v * nx, ry + u * fy + v * ny];
  }
  // (the muzzle: where a shot leaves, and which way - for the guns to come)
  function muzzle(t) {
    const [px, py] = muzzleBase(t), c = Math.cos(t.elevation), s = Math.sin(t.elevation);
    return { x: px + t.aimFacing * c * t.art.barrel, y: py - s * t.art.barrel, dx: t.aimFacing * c, dy: -s };
  }
  // (orders: drive -1 / 0 / +1, backing up rather than turning round if `reverse`; aim at a point,
  // or null for level ahead)
  function drive(t, dir, reverse = false) { t.drive = Math.sign(dir); t.reverse = !!reverse; }
  function aimAt(t, x, y) { t.target = x == null ? null : { x, y }; }

  // ---- Drawing -------------------------------------------------------------------------------------------
  // The running gear in hull-local cells, made each frame: the road wheels where their springs hold
  // them, the sprocket and the idler, the return rollers, and the belt round them all - its links
  // and the wheels' spokes in the GIF's three-frame cycle by the ground covered.
  const GEAR = { u0: -60, v0: -20, w: 121, h: 29 };
  function gearOf(t) {
    const { art } = t, { u0, v0, w, h } = GEAR;
    const px = t.gearPx || (t.gearPx = new Uint32Array(w * h));
    px.fill(0);
    const put = (u, v, c) => { const x = Math.round(u) - u0, y = Math.round(v) - v0; if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = c; };
    const frame = ((Math.floor(t.travel / 3) % 3) + 3) % 3;
    const R = art.R, [su, sv, sr] = art.sprocket, [iu, iv, ir] = art.idler, { st } = art;
    // (the belt's bottom run: under each road wheel, straight between them, rising to the sprocket
    // and the idler at the ends)
    const n = art.wheels.length;
    const bottomAt = (u) => {
      let a = su, b = sv + sr;
      for (let k = 0; k <= n; k += 1) {
        const c = k < n ? art.wheels[k] : iu, d = k < n ? t.springs[k] : iv + ir;
        if (u <= c) return b + (d - b) * (u - a) / (c - a);
        a = c; b = d;
      }
      return b;
    };
    const topV = -15, link = (s) => (((Math.floor(s) + frame * 3) % 9) + 9) % 9 < 3;
    const shadow = rgb(TRACK, 0.55), trackC = rgb(TRACK), trackD = rgb(TRACK, 0.8), linkC = rgb(LINK), linkD = rgb(LINK, 0.8), linkL = rgb(LINK, 1.1);
    for (let u = su; u <= iu; u += 1) {
      const b = Math.round(bottomAt(u));
      for (let v = topV + 2; v < b - 1; v += 1) put(u, v, shadow);    // (the space inside the belt, in shadow)
      const on = link(u);
      put(u, b, on ? linkD : trackD); put(u, b - 1, on ? linkC : trackC);
      put(u, topV, link(-u) ? linkL : trackC); put(u, topV + 1, trackC);
    }
    // (round the sprocket and the idler)
    for (const [cu, cv, r, back] of [[su, sv, sr, true], [iu, iv, ir, false]]) {
      for (let a = 0; a < 48; a += 1) {
        const ang = a / 48 * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
        if (back ? ca > 0.05 : ca < -0.05) continue;
        const c = link(a + frame * 2) ? linkD : trackD;
        for (let rr = r + 0.5; rr <= r + 2; rr += 0.75) put(cu + ca * rr, cv + sa * rr, c);
      }
    }
    const disc = (cu, cv, r, face, spokes) => {
      const lit = rgb(face, 1.1), dim = rgb(face, 0.85), spoke = rgb(face, 0.62), rim = rgb(RUBBER), hubL = rgb(HUB, 1.1), hubD = rgb(HUB, 0.9);
      for (let v = Math.floor(cv - r); v <= Math.ceil(cv + r); v += 1) for (let u = Math.floor(cu - r); u <= Math.ceil(cu + r); u += 1) {
        const du = u + 0.5 - cu, dv = v + 0.5 - cv, d = Math.sqrt(du * du + dv * dv);
        if (d > r) continue;
        let c = d > r - 1.2 ? rim : d < 1.6 ? (dv < 0 ? hubL : hubD) : dv < 0 ? lit : dim;
        // (three spokes, turned a third of their spacing each frame, rolling forward: the GIF's cycle)
        if (spokes && d >= 1.6 && d <= r - 1.2 && Math.abs(Math.sin((Math.atan2(dv, du) - frame * (Math.PI * 2 / 9)) * 1.5)) < 0.22) c = spoke;
        put(u, v, c);
      }
    };
    disc(su, sv, sr, st.dark, true);
    disc(iu, iv, ir, st.wheel, true);
    for (const [cu, cv, r] of art.rollers) disc(cu, cv, r, st.wheel, false);
    for (let i = 0; i < n; i += 1) disc(art.wheels[i], t.springs[i] - R, R, st.wheel, true);
    return px;
  }
  let canvas = null, ctx2 = null, image = null, px32 = null;
  function draw(renderer) {
    const world = renderer.world || (window.pwApp && window.pwApp.world) || current;
    const list = world && world.tanks;
    if (!list || !list.length) return;
    const { ctx, camera, view } = renderer;
    const z = camera.zoom, skip = Math.max(1, Math.floor(1 / z));
    const vx0 = camera.x, vy0 = camera.y, vx1 = vx0 + view.width / z, vy1 = vy0 + view.height / z;
    for (const t of list) {
      if (t.dead) continue;
      const { art } = t, [fx, fy] = dirOf(t), nx = -Math.sin(t.angle), ny = Math.cos(t.angle);
      const [rx, ry] = ringAt(t), [bx, by] = muzzleBase(t), m = muzzle(t), [tfx, tfy, tnx, tny] = turretFrame(t);
      const ec = Math.cos(t.elevation), es = Math.sin(t.elevation), L = art.barrel;
      // (the box it takes up: its hull and running gear, turret and gun)
      let x0 = m.x, x1 = m.x, y0 = m.y, y1 = m.y;
      for (const [u, v] of [[-61, -31], [61, -31], [-61, 9], [61, 9]]) {
        const [wx, wy] = toWorld(t, u, v);
        x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
      }
      for (const [u, v] of [[-37, -18], [31, -18], [-37, 17], [31, 17]]) {
        const wx = rx + u * tfx + v * tnx, wy = ry + u * tfy + v * tny;
        x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
      }
      x0 = Math.max(Math.floor(x0 - 3), Math.floor(vx0)); x1 = Math.min(Math.ceil(x1 + 3), Math.ceil(vx1));
      y0 = Math.max(Math.floor(y0 - 3), Math.floor(vy0)); y1 = Math.min(Math.ceil(y1 + 3), Math.ceil(vy1));
      if (x1 <= x0 || y1 <= y0) continue;
      const gear = gearOf(t);
      const iw = Math.ceil((x1 - x0) / skip), ih = Math.ceil((y1 - y0) / skip);
      if (!canvas || canvas.width < iw || canvas.height < ih) {
        const cw = Math.ceil(Math.max(iw, canvas ? canvas.width : 0) / 128) * 128, ch = Math.ceil(Math.max(ih, canvas ? canvas.height : 0) / 128) * 128;
        canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        ctx2 = canvas.getContext('2d'); image = ctx2.createImageData(cw, ch); px32 = new Uint32Array(image.data.buffer);
      }
      const stride = canvas.width, barrelC = rgb(art.st.base, 0.95), barrelD = rgb(art.st.dark, 0.85), barrelL = rgb(art.st.base, 1.18);
      for (let j = 0; j < ih; j += 1) {
        const wy = y0 + j * skip + 0.5, row = j * stride;
        px32.fill(0, row, row + iw);
        for (let i = 0; i < iw; i += 1) {
          const wx = x0 + i * skip + 0.5;
          // The gun: a tube from the trunnion, thicker at its fume extractor and its muzzle.
          const gx = (wx - bx) * t.aimFacing, gy = wy - by;
          const along = gx * ec - gy * es, across = gx * es + gy * ec;
          if (along >= -2 && along <= L) {
            const half = along > L * 0.4 && along < L * 0.4 + 9 ? 2.5 : along > L - 3 ? 2 : 1.6;
            if (across >= -half && across <= half) { px32[row + i] = across < -half + 1 ? barrelL : across > half - 1 ? barrelD : barrelC; continue; }
          }
          // The turret, upright on its ring (or carried over with the hull), facing its target's side.
          const rdx = wx - rx, rdy = wy - ry, tt = Math.floor(rdx * tfx + rdy * tfy), ts = Math.floor(rdx * tnx + rdy * tny);
          let c = at(art.turret, tt, ts);
          if (c) { px32[row + i] = c; continue; }
          // The hull and its running gear, along the ground under it.
          const dx = wx - t.x, dy = wy - t.y;
          const u = Math.floor(dx * fx + dy * fy), v = Math.floor(dx * nx + dy * ny);
          c = at(art.hull, u, v);
          if (!c) { const gu = u - GEAR.u0, gv = v - GEAR.v0; if (gu >= 0 && gv >= 0 && gu < GEAR.w && gv < GEAR.h) c = gear[gv * GEAR.w + gu]; }
          // (the turret's basket under it, seen in the gap where the hull lies over, below the ring)
          if (!c && ts >= 0 && ts <= 16 && tt >= -24 && tt <= 18) c = art.basket;
          if (c) px32[row + i] = c;
        }
      }
      ctx2.putImageData(image, 0, 0, 0, 0, iw, ih);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, iw, ih, Math.round((x0 - vx0) * z), Math.round((y0 - vy0) * z), Math.round(iw * skip * z), Math.round(ih * skip * z));
    }
  }
  // (drawn with the units, after whatever else draws there)
  const before = PW.drawUnitsHook;
  PW.drawUnitsHook = (renderer) => { if (before) before(renderer); draw(renderer); };

  // ---- By hand (a toolbar's TANK tool) -------------------------------------------------------------------
  // A click drops a tank on the ground under it - open ground, a road or a bridge, not a roof -
  // each side's in turn, and takes it in hand; with a tank in hand a click lays its gun on that
  // spot, a click on the tank lets it go (its gun back to level ahead), and a shift-click drops
  // another. A / D or the arrow keys drive it left or right,
  // S or the down arrow stops it, R has it back up rather than turn round (and R again, not).
  let held = null, nextStyle = 0;
  function tool(world, x, y, shift = false) {
    const list = world.tanks || [];
    if (held && (held.dead || !list.includes(held))) held = null;
    const hit = list.find((t) => !t.dead && Math.abs(x - t.x) < 62 && y > t.y - 48 && y < t.y + 6);
    if (hit) { if (hit === held) { aimAt(hit, null); held = null; } else held = hit; return held; }
    if (held && !held.dead && !shift) { aimAt(held, x, y); return held; }
    // (on the ground under the click, or on top of the ground just under it - not deep inside it)
    const { mat, width: W, height: H } = world, gx = Math.round(x);
    if (gx < 64 || gx > W - 64) return null;
    let gy = Math.max(1, Math.min(H - 2, Math.round(y)));
    if (isSupport(mat[gy * W + gx])) {
      while (gy > 1 && isSupport(mat[(gy - 1) * W + gx])) gy -= 1;
      if (Math.round(y) - gy > 30) return null;
    } else {
      while (gy < H - 1 && !isSupport(mat[gy * W + gx])) gy += 1;
      if (gy >= H - 1) return null;
    }
    // (on the ground, a road or a bridge - not on a building's roof)
    const id = mat[gy * W + gx] & ID_MASK;
    if (!(PW.mat.terrain[id] || id === M.ASPHALT || id === M.ROADBED || id === M.BRIDGE) || PW.getOwner(world, gx, gy)) return null;
    held = create(world, { style: Object.keys(STYLES)[nextStyle++ % 3], x: gx, y: gy, facing: gx < W / 2 ? 1 : -1 });
    return held;
  }
  function key(event) {
    if (!held || held.dead || event.repeat) return false;
    const k = event.code;
    if (k === 'KeyA' || k === 'ArrowLeft') drive(held, -1, held.reverse);
    else if (k === 'KeyD' || k === 'ArrowRight') drive(held, 1, held.reverse);
    else if (k === 'KeyS' || k === 'ArrowDown') drive(held, 0, held.reverse);
    else if (k === 'KeyR') held.reverse = !held.reverse;
    else return false;
    return true;
  }

  PW.tanks = { create, step, draw, drive, aimAt, muzzle, settle, ahead, tool, key, held: () => held, STYLES: Object.keys(STYLES),
    VMAX, ACCEL, GUN_UP, GUN_DOWN, MAX_SLOPE, STEP, SPRING_UP, SPRING_DOWN };
})();
