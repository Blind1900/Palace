'use strict';
// Drones (N106, N126), after the user's photos of the Avenger (General Atomics' MQ-20: a long
// rounded body, its sensor ball under the chin, straight high wings, a canted V of fins over its
// tail, its jet's flat nozzle; light grey under a darker grey's wavy camouflage) - drawn at a third
// of its real size against the 25-cell trooper, the user's: 13.4 m, 62 cells nose to tail, its wings
// 20 m across. Each side's in its own paint. Seen side on, from a little above: its wings, open,
// show - the near one going down from its body, the far one up - and it turns about on the flat,
// coming round head-on.
// It has no guns (the user's): it is launched from a side's missile launcher (PW.defence) - the
// launcher's pod raised to 45-85 degrees, the drone fired off its rail on a booster, its wings
// springing open as it leaves; the booster burns out and drops away. Then it roams the sky over
// the battle, high over the ground ahead of it, turning about at the world's ends - it never lands
// - until it is shot down or sent: told a spot (a building), it dives into it, its nose glowing,
// and its warhead goes off where it strikes. Shot down, it goes down burning and blows up where it
// falls.
// In hand (N102's controls): A / D turn it about, Space, W or Up climbs it while held, S or Down
// dives it; a left click sends it into the spot clicked, a right click has it circle over the spot.
// Kept as PW.jets, the drone's kind 'jet', the list world.jets - the game, the AI, the interceptors
// and the panels know it by them. Our own code throughout.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, passable } = PW.mat;
  const POWDER = PW.PHASE.POWDER;

  const LENGTH = 62;            // cells, nose to tail (13.4 m at a third of the trooper's scale)
  const HALF_SPAN = 46;         // cells, body to wing tip
  const CRUISE = 210, VMAX = 300, STALL = 90;   // cells/s
  const DIVE_V = 360;           // cells/s it strikes at, at most
  const THRUST = 300;           // cells/s^2 at full throttle (more than its weight: it climbs a mountain's flank)
  const DRAG = THRUST / (VMAX * VMAX);
  const BOOST = 1.2;            // s the booster burns
  const BOOST_ACC = 440;        // cells/s^2 it pushes with, along its way (burnt out, it is at about VMAX)
  const WING_AFTER = 0.12, WING_OPEN = 0.3;     // s out of the tube its wings start to open; s they take
  const PITCH_RATE = 0.9, DIVE_RATE = 1.7;      // rad/s it pitches at, roaming and diving
  const CLIMB_MAX = 50;         // degrees it climbs or dives at, roaming or told by the keys, at most
  const CLIMB_RATE = 60;        // degrees a second its climb steepens while a key is held, or levels out
  const TURN = 1.6;             // s it takes to turn about, on the flat
  const ALT = 260;              // cells it keeps over the highest of the ground ahead of it
  const LOOK_AHEAD = 1600;      // cells ahead it looks at the ground (a mountain's flank, climbed in time)
  const EDGE = 500;             // cells from the world's end it turns about
  const ARMOUR = 60;
  const DAMAGE = { bullet: 3, cannon: 12, he: 60, ap: 60, missile: 100, rocket: 60, interceptor: 60, patriot: 100 };
  const WARHEAD = { radius: 32, power: 1.4 };   // what it brings down on what it strikes (N142: the medium blast)
  const WRECKED = { radius: 14, power: 1.1 };   // ... shot down, where it falls
  const G = () => PW.GRAVITY || 260;
  const deg = Math.PI / 180;
  const stats = { created: 0, launched: 0, boosters: 0, struck: 0, shotDown: 0, crashed: 0 };
  let current = null, seq = 0;

  // ---- The look ---------------------------------------------------------------------------------------
  // (its paint: the base grey and the camouflage's darker one, each side's)
  const STYLES = {
    modern: { base: [178, 182, 184], camo: [146, 150, 154] },
    asian: { base: [150, 164, 176], camo: [120, 134, 148] },
    gothic: { base: [138, 152, 170], camo: [104, 118, 138] },
  };
  const DARK = [40, 42, 46], NOZZLE = [46, 44, 44], LENS = [30, 34, 44], PROBE = [196, 198, 200], BOOSTER = [150, 146, 132];
  const ELEV = 14 * deg;        // how far above it we see it from
  const SWEEP = 17 * deg, CANT = 38 * deg, FIN_LEAN = 0.45, FIN_LEN = 10;
  // Its body side on: the top and belly along it (u nose-wards from its middle, v down) - the
  // rounded nose rising to a hump, the saddle at the wing, the intake's hump, the tail tapering.
  const ease = (a, b, t) => a + (b - a) * (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  function top(u) {
    if (u > 20) return -3.6 * Math.sqrt(Math.max(0, 1 - ((u - 20) / 11.6) ** 2));
    if (u > 10) return ease(-2.7, -3.6, (u - 10) / 10);
    if (u > 4) return ease(-3.7, -2.7, (u - 4) / 6);
    if (u > -10) return -3.7;
    if (u > -20) return ease(-2.7, -3.7, (u + 20) / 10);
    return ease(-1.6, -2.7, (u + 31) / 11);
  }
  function belly(u) {
    if (u > 24) return 3 * Math.sqrt(Math.max(0, 1 - ((u - 24) / 7.6) ** 2));
    if (u > -16) return 3;
    return ease(0.8, 3, (u + 31) / 15);
  }
  // (its camouflage: soft wavy patches over it, in its own frame)
  const h2 = (x, y) => (PW.hash2(x | 0, y | 0) & 65535) / 65535;
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  const camo = (x, y) => noise(x * 0.16 + 7.3, y * 0.34 + 2.1) * 0.7 + noise(x * 0.4, y * 0.8 + 5) * 0.3 > 0.56;
  const rgb = (c, k = 1) => PW.abgr(Math.max(0, Math.min(255, c[0] * k)) | 0, Math.max(0, Math.min(255, c[1] * k)) | 0, Math.max(0, Math.min(255, c[2] * k)) | 0);
  // Its drawing in a pose - wings open w (0 folded back along it, 1 open), turned yaw from side on
  // (0) to head-on (pi/2), its booster under it or not - made once and kept: every point of it - its
  // body, nose, sensor ball, wings, fins - put where it is seen (x along it, y down, z towards us,
  // turned by yaw, seen from ELEV above), the nearest at each cell.
  const arts = new Map();
  function artOf(style, w, yaw, booster) {
    const key = `${style}|${w}|${yaw}|${booster ? 1 : 0}`;
    if (arts.has(key)) return arts.get(key);
    const st = STYLES[style] || STYLES.modern;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), se = Math.sin(ELEV);
    const pts = [];
    const put = (x, y, z, col) => { const xs = x * cy - z * sy, zs = x * sy + z * cy; pts.push(xs, y + zs * se, zs, col); };
    const paint = (x, y, k) => rgb(camo(x, y) ? st.camo : st.base, k);
    // (the body: its cross-section an ellipse, a little narrower than it is deep, lit from above)
    for (let u = -31; u <= 31; u += 0.5) {
      const t = top(u), b = belly(u), mid = (t + b) / 2, rv = Math.max(0.5, (b - t) / 2), rh = rv * 0.85;
      for (let v = t; v <= b; v += 0.5) {
        const q = (v - mid) / rv, hw = rh * Math.sqrt(Math.max(0, 1 - q * q));
        for (let z = -hw; z <= hw + 0.01; z += 0.5) {
          const nz = hw > 0 ? z / rh : 0, light = 0.66 + 0.42 * Math.max(0, -q * 0.8 + nz * 0.35);
          let col;
          if (u < -29.2) col = rgb(NOZZLE, light);
          else if (u > 3.4 && u < 5.2 && v < t + 1.3) col = rgb(DARK);
          else col = paint(u, v + z * 0.5, light);
          put(u, v, z, col);
        }
      }
    }
    // (the probe off its nose; the sensor ball under its chin, its glass dark with a glint)
    for (let u = 31; u <= 35; u += 0.5) put(u, 0.5, 0, rgb(PROBE));
    for (let a = 0; a < 2 * Math.PI; a += 0.3) for (let r = 0; r <= 1.3; r += 0.4) for (let z = -1; z <= 1; z += 0.5) put(18.5 + Math.cos(a) * r, 4.1 + Math.sin(a) * r, z, r < 0.5 && a > 3.5 && a < 4.5 ? rgb([210, 220, 230]) : rgb(LENS));
    // (the booster, slung under its belly while it burns)
    if (booster) for (let u = -14; u <= 2; u += 0.5) for (let a = 0; a < 2 * Math.PI; a += 0.35) put(u, 4.6 + Math.sin(a) * 1.2, Math.cos(a) * 1.2, u < -12.5 ? rgb(NOZZLE) : rgb(BOOSTER, 0.75 + 0.3 * Math.max(0, -Math.sin(a))));
    // (its wings: high on its body, swept a little; folded back along it they turn out to open -
    // each about its root, the near one towards us, the far one away)
    const open = 90 * deg - SWEEP, fold = (1 - w) * open;
    for (const side of [1, -1]) {
      const phi = side * fold, c = Math.cos(phi), s = Math.sin(phi), px = 4, pz = side * 2.5;
      const dx = -Math.sin(SWEEP), dz = side * Math.cos(SWEEP);
      for (let r = 0; r <= HALF_SPAN; r += 0.5) {
        const chord = 13 + (4.2 - 13) * r / HALF_SPAN, lx = 10 + dx * r, lz = pz + dz * r;
        for (let k = 0; k <= chord; k += 0.5) {
          const x0 = lx - k - px, z0 = lz - pz;
          const x = px + x0 * c - z0 * s, z = pz + x0 * s + z0 * c;
          put(x, -1.5, z, paint(x * 0.7 + 40, z * 0.9, side > 0 ? 0.96 : 0.84));
        }
      }
    }
    // (its fins: a V over its tail, canted out - lying flat in the tube, rising as it opens)
    const cant = 88 * deg + (CANT - 88 * deg) * w;
    for (const side of [1, -1]) {
      const rx0 = -17, rx1 = -25.5, ry0 = top(rx0), ry1 = top(rx1);
      const tx = -FIN_LEN * FIN_LEAN, ty = -FIN_LEN * Math.cos(cant), tz = side * FIN_LEN * Math.sin(cant);
      for (let f = 0; f <= 1.001; f += 0.05) {
        const lx = rx0 + tx * f, ly = ry0 + ty * f, lz = side * 1.5 + tz * f;
        const ex = rx1 + tx * f + 3 * f, ey = ry1 + ty * f, ez = side * 1.5 + tz * f;
        for (let k = 0; k <= 1.001; k += 0.06) put(lx + (ex - lx) * k, ly + (ey - ly) * k, lz + (ez - lz) * k, paint(lx * 0.8 - 30, ly + k * 4, side > 0 ? 0.92 : 0.78));
      }
    }
    // (into a raster: the nearest point at each cell; its lower edge a shade darker, its upper lit)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 4) { x0 = Math.min(x0, Math.floor(pts[i])); x1 = Math.max(x1, Math.floor(pts[i])); y0 = Math.min(y0, Math.floor(pts[i + 1])); y1 = Math.max(y1, Math.floor(pts[i + 1])); }
    const W = x1 - x0 + 1, H = y1 - y0 + 1, px = new Uint32Array(W * H), depth = new Float32Array(W * H).fill(-Infinity);
    for (let i = 0; i < pts.length; i += 4) {
      const k = (Math.floor(pts[i + 1]) - y0) * W + (Math.floor(pts[i]) - x0);
      if (pts[i + 2] > depth[k]) { depth[k] = pts[i + 2]; px[k] = pts[i + 3]; }
    }
    const out = px.slice();
    const shade = (c, k) => PW.abgr(Math.min(255, (c & 255) * k) | 0, Math.min(255, (c >>> 8 & 255) * k) | 0, Math.min(255, (c >>> 16 & 255) * k) | 0);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const k = y * W + x;
      if (!px[k]) continue;
      if (y === H - 1 || !px[k + W]) out[k] = shade(px[k], 0.8);
      else if (y === 0 || !px[k - W]) out[k] = shade(px[k], 1.08);
    }
    const a = { x0, y0, x1, y1, w: W, h: H, px: out };
    arts.set(key, a);
    return a;
  }
  const at = (s, x, y) => (x < s.x0 || y < s.y0 || x > s.x1 || y > s.y1 ? 0 : s.px[(y - s.y0) * s.w + (x - s.x0)]);

  // ---- A drone --------------------------------------------------------------------------------------------
  // (x, y: its middle; facing: the way its nose points, left or right; pitch: its nose's angle over
  // the horizontal; wing: its wings, 0 folded - 1 open; yaw: turning about, 0 - pi, from facing f0)
  // spec.pod: the launcher it waits in, to be fired off it (see PW.defence.launchDrone); else it is
  // put in the air as it is (spec.boost: on its booster).
  function create(world, spec) {
    const style = STYLES[spec.style] ? spec.style : 'modern';
    const j = { kind: 'jet', drone: true, style, side: spec.side || null, x: spec.x, y: spec.y, facing: spec.facing === -1 ? -1 : 1,
      pitch: (spec.pitch || 0) * (spec.radians ? 1 : deg), v: spec.speed ?? (spec.pod || spec.boost ? 60 : CRUISE), throttle: 1, want: spec.facing === -1 ? -1 : 1,
      climb: 0, yaw: 0, wing: spec.pod || spec.boost ? 0 : 1, boost: spec.boost ? BOOST : 0, booster: !!(spec.pod || spec.boost), out: spec.pod ? 0 : LENGTH,
      pod: spec.pod || null, age: 0, hp: ARMOUR, dead: false, down: false, spin: 0, strike: null, loiter: null, hurtBy: '', smoke: 0, glow: 0, seed: ++seq,
      // (for what reads a unit's kit: it has none)
      missiles: 0, burst: 0 };
    (world.jets || (world.jets = [])).push(j);
    current = world;
    stats.created += 1;
    return j;
  }
  // (its heading, world angle: 0 right, up positive - as it goes, turning about or not)
  const heading = (j) => (Math.cos(j.yaw) * j.facing > 0 ? j.pitch : Math.PI - j.pitch);
  // (the way it is drawn: facing, and how far round from side on - past half way round, the other way)
  const drawnFacing = (j) => (j.yaw > Math.PI / 2 ? -j.facing : j.facing);
  const drawnYaw = (j) => (j.yaw > Math.PI / 2 ? Math.PI - j.yaw : j.yaw);
  // (a point of it in its own frame - u along it, v down - in the world)
  function toWorld(j, u, v) {
    const c = Math.cos(j.pitch), s = Math.sin(j.pitch), k = Math.cos(j.yaw);
    return [j.x + j.facing * k * (u * c + v * s), j.y - u * s + v * c];
  }
  const WING_STEPS = 6, YAW_STEPS = 8;
  function poseOf(j) {
    const yaw = drawnYaw(j), wing = Math.round(j.wing * WING_STEPS) / WING_STEPS, ys = Math.round(yaw / (Math.PI / 2) * YAW_STEPS) / YAW_STEPS * Math.PI / 2;
    return { j, f: drawnFacing(j), c: Math.cos(j.pitch), s: Math.sin(j.pitch), art: artOf(j.style, wing, ys, j.booster), out: j.out };
  }
  // (what of it is at world point (x, y): its art's colour, or 0 - still coming out of its tube,
  // only what is out of it)
  function pixelP(P, x, y) {
    const j = P.j;
    if (j.pod) return 0;
    const dx = (x - j.x) * P.f, dy = y - j.y, u = dx * P.c - dy * P.s;
    if (P.out < LENGTH && u < LENGTH / 2 - P.out) return 0;
    return at(P.art, Math.floor(u), Math.floor(dx * P.s + dy * P.c));
  }
  const pixel = (j, x, y) => pixelP(poseOf(j), x, y);
  const blocks = (world, x, y) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
    const id = world.mat[(y | 0) * world.width + (x | 0)] & ID_MASK;
    return phase[id] >= POWDER && !passable[id];
  };
  // (the highest of the ground - and what stands on it, a town's towers - under the way ahead)
  function ceilingAhead(world, j) {
    const W = world.width, dir = Math.cos(j.yaw) * j.facing >= 0 ? 1 : -1;
    const a = Math.min(j.x - dir * 100, j.x + dir * LOOK_AHEAD), b = Math.max(j.x - dir * 100, j.x + dir * LOOK_AHEAD);
    let hi = world.height;
    for (let x = Math.max(0, Math.round(a)); x <= Math.min(W - 1, Math.round(b)); x += 20) hi = Math.min(hi, world.groundTop[x]);
    for (const q of world.buildings || []) if (q.body && q.body.right >= a && q.body.left <= b && !q.ruined) hi = Math.min(hi, q.body.top);
    return hi;
  }

  // ---- Flying -----------------------------------------------------------------------------------------
  function stepOne(world, j, dt) {
    if (j.dead) return;
    if (j.pod) { inPod(j); return; }
    const g = G();
    j.age += dt;
    if (j.out < LENGTH) j.out += j.v * dt;
    if (j.wing < 1 && j.age > WING_AFTER) j.wing = Math.min(1, j.wing + dt / WING_OPEN);
    if (j.down) {
      // (shot down: its engine dead, its nose dropping, burning and smoking as it goes)
      j.pitch = Math.max(-75 * deg, j.pitch - 0.9 * dt);
      j.v = Math.min(VMAX * 1.2, j.v + g * Math.sin(-j.pitch) * dt * 0.6);
      trail(world, j, dt, true);
    } else if (j.boost > 0) {
      // (off the rail on its booster: straight on along the launch, in flame and smoke)
      j.boost -= dt;
      j.v += (BOOST_ACC - g * Math.sin(j.pitch)) * dt;
      exhaust(world, j, dt);
      if (j.boost <= 0) dropBooster(world, j);
    } else {
      steer(world, j, dt);
      j.v += (THRUST * j.throttle - DRAG * j.v * j.v - g * Math.sin(j.pitch)) * dt;
      j.v = Math.max(STALL * 0.6, Math.min(j.strike ? DIVE_V : VMAX * 1.1, j.v));
      if (j.hp < ARMOUR * 0.4) trail(world, j, dt, false);
    }
    // (turning about, on the flat: round over TURN, coming head-on half way)
    if (j.yaw > 0) { j.yaw += Math.PI * dt / TURN; if (j.yaw >= Math.PI) { j.yaw = 0; j.facing = -j.facing; } }
    const cp = Math.cos(j.pitch), sp = Math.sin(j.pitch);
    j.x += j.facing * Math.cos(j.yaw) * cp * j.v * dt;
    j.y -= sp * j.v * dt;
    if (j.strike) j.glow += dt;
    // What it flies into - the ground, a building, a mountain: its warhead goes off there.
    if (j.out >= LENGTH * 0.6) {
      for (const [u, v] of [[33, 0.5], [24, 3], [0, 3.5], [-24, 2], [0, -4], [-24, -10]]) {
        const [wx, wy] = toWorld(j, u, v);
        if (blocks(world, Math.floor(wx), Math.floor(wy))) { detonate(world, j, wx, wy); return; }
      }
    }
    // (sent at a spot: there, it goes off - over open ground, a roof, wherever it was sent)
    if (j.strike) {
      const [nx, ny] = toWorld(j, 31, 0);
      if (Math.hypot(nx - j.strike.x, ny - j.strike.y) < 6) { detonate(world, j, nx, ny); return; }
    }
    if (j.y > world.height || j.x < -400 || j.x > world.width + 400) j.dead = true;
  }
  // Where it goes: sent at a spot, it turns to it and dives into it; told to circle a spot, it
  // goes back and forth over it; else it roams - on its way, turning about at the world's ends, as
  // high over the ground ahead as ALT. Its climb by the keys while one is held.
  function steer(world, j, dt) {
    const W = world.width;
    if (j.strike) {
      const T = j.strike, dx = T.x - j.x;
      if (!j.yaw && Math.sign(dx) !== j.facing && Math.abs(dx) > 40) j.yaw = 1e-4;
      const want = Math.max(-85 * deg, Math.min(45 * deg, Math.atan2(-(T.y - j.y), Math.abs(dx))));
      j.pitch += Math.max(-DIVE_RATE * dt, Math.min(DIVE_RATE * dt, want - j.pitch));
      j.throttle = 1;
      return;
    }
    if (j.loiter && Math.abs(j.loiter.x - j.x) > 240) j.want = Math.sign(j.loiter.x - j.x);
    if (j.x < EDGE) j.want = 1; else if (j.x > W - EDGE) j.want = -1;
    if (!j.yaw && j.want !== j.facing) j.yaw = 1e-4;
    let climb;
    if (j.keyed) {
      const want = (j.climbKey || 0) * CLIMB_MAX, d = want - j.climb, s = CLIMB_RATE * dt;
      j.climb += Math.abs(d) <= s ? d : Math.sign(d) * s;
      climb = j.climb;
    } else {
      const goal = Math.max(60, ceilingAhead(world, j) - ALT);
      climb = Math.max(-CLIMB_MAX * 0.6, Math.min(CLIMB_MAX, (j.y - goal) * 0.2));
    }
    // (too slow: its nose down until it has its speed again)
    if (j.v < STALL) j.stalled = true; else if (j.v > STALL * 1.4) j.stalled = false;
    const target = j.stalled ? -0.5 : climb * deg;
    j.pitch += Math.max(-PITCH_RATE * dt, Math.min(PITCH_RATE * dt, target - j.pitch));
    j.throttle = Math.max(0.15, Math.min(1, 0.5 + (CRUISE - j.v) / 80));
  }
  // (waiting in its launcher's pod: carried there as the pod is raised, out of sight)
  function inPod(j) {
    const u = j.pod;
    if (!u || u.dead) { j.dead = true; return; }
    if (PW.defence && PW.defence.tubeOf) {
      const t = PW.defence.tubeOf(u), a = u.el ?? 0, f = u.headF ?? u.facing;
      j.x = t.x - Math.cos(a) * f * (LENGTH / 2 + 2); j.y = t.y + Math.sin(a) * (LENGTH / 2 + 2);
      j.facing = f; j.pitch = a;
    }
  }
  // Off its launcher (PW.defence, once the pod is laid): its nose at the tube's mouth, on along the
  // tube at a, on its booster - coming out of the tube a cell at a time as it goes.
  function leavePod(world, j, mouth, a, f) {
    if (!j || j.dead) return null;
    j.pod = null; j.facing = f; j.want = f; j.pitch = a; j.v = 60; j.boost = BOOST; j.booster = true; j.out = 0; j.age = 0; j.wing = 0;
    j.x = mouth.x - Math.cos(a) * f * (LENGTH / 2); j.y = mouth.y + Math.sin(a) * (LENGTH / 2);
    stats.launched += 1;
    if (PW.shots && PW.shots.report) PW.shots.report(world, mouth.x, mouth.y, -Math.cos(a) * f, Math.sin(a), 3);
    return j;
  }
  // (its booster burning: flame and white smoke out of its nozzle, back along the way it goes)
  function exhaust(world, j, dt) {
    const particles = world.particles, F = PW.PARTICLE;
    if (!particles || !F || j.out < 16) return;
    j.smoke += dt * 90;
    const hd = heading(j), bx = -Math.cos(hd), by = Math.sin(hd);
    while (j.smoke >= 1) {
      j.smoke -= 1;
      const h = PW.hash3(j.seed, (j.age * 997) | 0, j.smoke * 31 | 0), [x, y] = toWorld(j, -15, 4.6);
      const sv = 40 + (h & 63), jx = ((h >>> 6 & 31) - 16) * 0.8, jy = ((h >>> 11 & 31) - 16) * 0.8;
      if (h >>> 16 & 1) particles.spawn(x, y, bx * sv * 2 + jx, by * sv * 2 + jy, 0, PW.abgr(255, 200, 90, 230), F.FIRE, 0.15 + (h >>> 17 & 7) * 0.02);
      else particles.spawn(x, y, bx * sv + jx, by * sv + jy, 0, PW.abgr(214, 212, 206, 200), F.SMOKE | F.THIN, 1.8 + (h >>> 17 & 7) * 0.3);
    }
  }
  // (burnt out, the booster drops away - a small piece of wreck falling from under it)
  function dropBooster(world, j) {
    j.boost = 0; j.booster = false;
    stats.boosters += 1;
    const fr = world.fragments;
    if (!fr) return;
    const xs = [], ys = [], cs = [];
    // (its cells, three rows deep - a piece that big falls whole: see pw-fragments' CHUNK_MIN)
    const seen = new Set();
    for (let u = -14; u <= 2; u += 1) for (let v = 3.5; v <= 5.5; v += 1) {
      const [x, y] = toWorld(j, u, v), rx = Math.round(x), ry = Math.round(y);
      if (seen.has(ry * world.width + rx)) continue;
      seen.add(ry * world.width + rx);
      xs.push(rx); ys.push(ry); cs.push(rgb(u < -12 ? NOZZLE : BOOSTER, v < 4 ? 1.05 : v > 5 ? 0.75 : 0.9));
    }
    const hd = heading(j), n = xs.length;
    fr.spawn({ data: { x: Int32Array.from(xs), y: Int32Array.from(ys), color: Uint32Array.from(cs), byte: new Uint8Array(n).fill(M.STEEL), solid: new Uint8Array(n).fill(1) },
      vx: Math.cos(hd) * j.v * 0.6, vy: -Math.sin(hd) * j.v * 0.6, omega: j.facing * 2, wreck: true });
  }
  // (smoke from its engine - grey as it is hurt, black with flame shot down)
  function trail(world, j, dt, burning) {
    const particles = world.particles, F = PW.PARTICLE;
    if (!particles || !F) return;
    j.smoke += dt * (burning ? 60 : 16);
    while (j.smoke >= 1) {
      j.smoke -= 1;
      const h = PW.hash3(j.seed, (j.smoke * 1000) | 0, (world.tick || 0)), [x, y] = toWorld(j, -31 - (h & 3), (h >>> 3 & 3) - 1.5);
      if (burning && (h >>> 6 & 1)) particles.spawn(x, y, ((h >>> 7 & 31) - 16), -10, 0, PW.abgr(46, 42, 40, 220), F.FIRE, 0.3 + (h >>> 12 & 7) * 0.05);
      else { const k = burning ? 40 : 120; particles.spawn(x, y, ((h >>> 7 & 31) - 16) * 0.5, -6, 0, PW.abgr(k, k - 2, k - 4, 210), F.SMOKE | F.THIN, 2.2 + (h >>> 12 & 7) * 0.35); }
    }
  }

  // ---- Sent, hurt, brought down ---------------------------------------------------------------------------
  // Send it into a spot (a building): it turns to it and dives in. (False if it cannot go.)
  function strike(world, j, spot) {
    if (!j || j.dead || j.down || j.pod || !spot || !Number.isFinite(spot.x) || !Number.isFinite(spot.y)) return false;
    j.strike = { x: spot.x, y: spot.y }; j.loiter = null; j.glow = 0;
    return true;
  }
  // Have it go back and forth over a spot (null: roam again).
  function loiter(world, j, spot) {
    if (!j || j.dead || j.down) return false;
    j.loiter = spot && Number.isFinite(spot.x) ? { x: spot.x } : null;
    if (j.loiter) j.strike = null;
    return true;
  }
  // (its warhead goes off at (x, y): a blast that breaks into what it struck, and it is gone)
  function detonate(world, j, x, y) {
    if (j.dead) return;
    j.dead = true;
    if (held === j) held = null;
    const W = j.down ? WRECKED : WARHEAD;
    if (j.down) stats.crashed += 1; else stats.struck += 1;
    if (PW.explode) PW.explode(world, world.particles, { x, y, radius: W.radius, power: W.power });
    if (world.heatSystem) world.heatSystem.heatDisc(x, y, W.radius, 800);
    // (shot down, what is left of its airframe lies there burning)
    if (j.down) wreck(world, j);
  }
  const burnt = (c, x, y) => { const h = PW.hash2(x, y), k = 0.28 + ((h >>> 3) & 7) / 50; return PW.abgr(Math.min(255, (c & 255) * k + 14), Math.min(255, (c >>> 8 & 255) * k + 12), Math.min(255, (c >>> 16 & 255) * k + 10)); };
  function wreck(world, j) {
    const fr = world.fragments, { mat, width: W, height: H } = world;
    if (!fr) return;
    const xs = [], ys = [], cs = [], r = 40, P = poseOf(j);
    for (let y = Math.max(1, Math.floor(j.y - r)); y <= Math.min(H - 2, Math.ceil(j.y + r)); y += 1) {
      for (let x = Math.max(1, Math.floor(j.x - r)); x <= Math.min(W - 2, Math.ceil(j.x + r)); x += 1) {
        // (its body only, its wings torn away in the blast)
        const col = pixelP(P, x + 0.5, y + 0.5);
        if (!col || !PW.mat.open[mat[y * W + x] & ID_MASK] || (PW.hash2(x, y) & 3) === 0) continue;
        xs.push(x); ys.push(y); cs.push(burnt(col, x, y));
      }
    }
    if (!xs.length) return;
    const n = xs.length;
    fr.spawn({ data: { x: Int32Array.from(xs), y: Int32Array.from(ys), color: Uint32Array.from(cs), byte: new Uint8Array(n).fill(M.STEEL), solid: new Uint8Array(n).fill(1) },
      vx: 0, vy: -60, omega: j.facing * 2, wreck: true });
    if (PW.addSmoulder) PW.addSmoulder(world, j.x, j.y, 30, 60);
  }
  function hurt(world, j, amount, cause) {
    if (j.dead || j.down || !(amount > 0)) return;
    j.hp -= amount;
    j.hurtBy = cause;
    if (j.hp <= 0) {
      j.hp = 0;
      // (still in its pod: it goes with the launcher)
      if (j.pod) { j.dead = true; return; }
      j.down = true; j.strike = null; j.boost = 0;
      stats.shotDown += 1;
      if (held === j) held = null;
    }
  }
  // A blast near it (a missile's, an interceptor's, flak) hurts it by how near.
  function blast(world, cx, cy, r, power = 1) {
    for (const j of world.jets || []) {
      if (j.dead || j.pod) continue;
      const d = Math.max(0, Math.hypot(j.x - cx, j.y - cy) - LENGTH / 3), reach = r * 2 + 20;
      if (d < reach) hurt(world, j, 90 * power * (1 - d / reach), 'blast');
    }
  }
  // What a round meets of it: its own pixels as drawn.
  const target = {
    hit(world, s, x0, y0, x1, y1) {
      const list = world.jets;
      if (!list || !list.length) return null;
      let best = null;
      const sx = x1 - x0, sy = y1 - y0, n = Math.max(1, Math.ceil(Math.hypot(sx, sy)));
      for (const j of list) {
        if (j.dead || j.pod || j === s.from) continue;
        const f0 = Math.max(0, Math.min(1, ((j.x - x0) * sx + (j.y - y0) * sy) / (sx * sx + sy * sy || 1)));
        if (Math.hypot(x0 + sx * f0 - j.x, y0 + sy * f0 - j.y) > HALF_SPAN + 8) continue;
        const P = poseOf(j);
        for (let q = 0; q <= n; q += 1) {
          const f = q / n;
          if (best && f >= best.f) break;
          if (pixelP(P, x0 + sx * f, y0 + sy * f)) { best = { f, x: x0 + sx * f, y: y0 + sy * f, ref: j, part: 1 }; break; }
        }
      }
      return best;
    },
    strike(world, j, s) {
      hurt(world, j, DAMAGE[s.kind] ?? 3, s.kind);
      return true;
    },
  };

  // ---- The step ---------------------------------------------------------------------------------------------
  function step(world, dt) {
    if (PW.shots && PW.shots.addTarget && !target.added) { PW.shots.addTarget(target); target.added = true; }
    const list = world.jets;
    if (!list || !list.length) return;
    current = world;
    for (const j of list) stepOne(world, j, dt);
    for (let q = list.length - 1; q >= 0; q -= 1) if (list[q].dead) list.splice(q, 1);
  }

  // ---- Drawn ------------------------------------------------------------------------------------------------
  let canvas = null, ctx2 = null, image = null, px32 = null;
  function draw(renderer) {
    const world = renderer.world || current;
    const list = world && world.jets;
    if (!list || !list.length) return;
    const { ctx, camera, view } = renderer;
    const z = camera.zoom, skip = Math.max(1, Math.floor(1 / z));
    const vx0 = camera.x, vy0 = camera.y, vx1 = vx0 + view.width / z, vy1 = vy0 + view.height / z;
    const R = HALF_SPAN + 12;
    for (const j of list) {
      if (j.dead || j.pod) continue;
      const P = poseOf(j);
      const x0 = Math.max(Math.floor(j.x - R), Math.floor(vx0)), x1 = Math.min(Math.ceil(j.x + R), Math.ceil(vx1));
      const y0 = Math.max(Math.floor(j.y - R), Math.floor(vy0)), y1 = Math.min(Math.ceil(j.y + R), Math.ceil(vy1));
      if (x1 <= x0 || y1 <= y0) continue;
      const iw = Math.ceil((x1 - x0) / skip), ih = Math.ceil((y1 - y0) / skip);
      if (!canvas || canvas.width < iw || canvas.height < ih) {
        canvas = document.createElement('canvas');
        canvas.width = Math.ceil(Math.max(iw, canvas ? canvas.width : 0) / 64) * 64; canvas.height = Math.ceil(Math.max(ih, canvas ? canvas.height : 0) / 64) * 64;
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
      // (its booster's flame, out of its nozzle while it burns)
      if (j.boost > 0 && j.out > 16) {
        const [fx, fy] = toWorld(j, -15, 4.6), hd = heading(j);
        for (let k = 0; k < 12; k += 1) {
          ctx.fillStyle = k < 4 ? 'rgba(255,240,180,0.95)' : 'rgba(255,160,60,0.8)';
          const r = Math.max(1, z * (2.6 - k * 0.18));
          ctx.fillRect(Math.round((fx - Math.cos(hd) * k * 1.5 - vx0) * z - r / 2), Math.round((fy + Math.sin(hd) * k * 1.5 - vy0) * z - r / 2), r, r);
        }
      }
      // (sent: its nose glowing red, brighter as it closes - after the user's film of one)
      if (j.strike && !j.down) {
        const [nx, ny] = toWorld(j, 29, 0.5), pulse = 0.55 + 0.35 * Math.sin(j.glow * 14);
        ctx.fillStyle = `rgba(255,60,40,${pulse.toFixed(2)})`;
        const r = Math.max(2, z * 4);
        ctx.fillRect(Math.round((nx - vx0) * z - r / 2), Math.round((ny - vy0) * z - r / 2), r, r);
        ctx.fillStyle = `rgba(255,200,160,${(pulse * 0.9).toFixed(2)})`;
        const r2 = Math.max(1, z * 1.6);
        ctx.fillRect(Math.round((nx - vx0) * z - r2 / 2), Math.round((ny - vy0) * z - r2 / 2), r2, r2);
      }
    }
  }
  const before = PW.drawUnitsHook;
  PW.drawUnitsHook = (renderer) => { if (before) before(renderer); draw(renderer); };

  // ---- Launching ---------------------------------------------------------------------------------------------
  // Off a side's missile launcher (N126): the drone made in its pod, fired when the pod is laid - see
  // PW.defence.launchDrone. (The drone, or null: no launcher that can, the way up shut.)
  function launchFrom(world, launcher, opts = {}) {
    return PW.defence && PW.defence.launchDrone ? PW.defence.launchDrone(world, launcher, opts) : null;
  }
  // (a side's launcher that can launch one now - the nearest x)
  function launcherOf(world, side, x = 0) {
    if (!PW.defence || !PW.defence.canLaunch) return null;
    let best = null, bd = Infinity;
    for (const u of world.defence || []) {
      if (u.type !== 'launcher' || (side && u.side !== side) || !PW.defence.canLaunch(world, u)) continue;
      const d = Math.abs(u.x - x);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
  // (the old way out - a runway - kept for the game's call: from the side's launcher if it has one,
  // else off a rail at the runway's start, on its booster)
  function takeOff(world, r, style, side) {
    const from = r ? r.from : 0, u = launcherOf(world, side, from);
    if (u) return launchFrom(world, u, { style, side });
    if (!r) return null;
    const dir = Math.sign(r.to - r.from) || 1, a = 55 * deg;
    let s = side;
    if (!s) for (const st of world.settlements || []) if (st.runway === r) s = st.side || null;
    const j = create(world, { x: r.from + dir * 40, y: r.y - 30, facing: dir, style, side: s, boost: true });
    return leavePod(world, j, { x: r.from + dir * 40 + Math.cos(a) * dir * LENGTH / 2, y: r.y - 8 - Math.sin(a) * LENGTH / 2 }, a, dir);
  }

  // ---- By hand -------------------------------------------------------------------------------------------------
  // A click on a drone takes it in hand (again: lets it go); with one in hand a click sends it there;
  // a click by a launcher launches one off it; elsewhere one is put in the air there (the sandbox's).
  let held = null, dropN = 0;
  function tool(world, x, y, shift = false) {
    const list = world.jets || [];
    if (held && (held.dead || !list.includes(held))) held = null;
    const hit = list.find((j) => !j.dead && pixel(j, x, y));
    if (hit) { held = hit === held ? null : hit; return held; }
    if (held && !shift) { click(world, x, y, 0); return held; }
    const style = ['modern', 'asian', 'gothic'][dropN++ % 3];
    const near = (world.defence || []).find((u) => u.type === 'launcher' && !u.dead && Math.abs(u.x - x) < 120 && Math.abs(u.y - y) < 120);
    if (near) { held = launchFrom(world, near, { style: near.style, side: near.side }); return held; }
    held = create(world, { x, y, facing: 1, style });
    return held;
  }
  function hold(j) {
    if (held && held !== j) release();
    held = j && !j.dead && j.kind === 'jet' ? j : null;
    return held;
  }
  // The keys (N102, the user's controls): it cannot stand, so A / D or the arrows turn it about to
  // fly that way; Space, W or Up climbs it while held and S or Down dives it - let go, it levels out.
  const UP = ['Space', 'KeyW', 'ArrowUp'], DOWN = ['KeyS', 'ArrowDown'];
  function release() { if (held) { held.climbKey = 0; held.keyed = false; } }
  function key(event) {
    if (!held || held.dead || held.down) return false;
    const j = held, k = event.code, up = event.type === 'keyup';
    if (UP.includes(k) || DOWN.includes(k)) {
      const s = UP.includes(k) ? 1 : -1;
      j.keyed = true;
      if (up) { if (j.climbKey === s) j.climbKey = 0; } else j.climbKey = s;
      return true;
    }
    if (up) return k === 'KeyA' || k === 'ArrowLeft' || k === 'KeyD' || k === 'ArrowRight';
    if (event.repeat) return false;
    if (k === 'KeyA' || k === 'ArrowLeft') { j.want = -1; j.loiter = null; }
    else if (k === 'KeyD' || k === 'ArrowRight') { j.want = 1; j.loiter = null; }
    else return false;
    return true;
  }
  // The mouse (N102, the user's: N126's drones have no guns): a left click sends it into the spot -
  // it turns to it and dives in, its warhead going off where it strikes; a right click, its other
  // way, has it circle over the spot, its dive called off. (True when the one in hand took it.)
  function click(world, x, y, button = 0) {
    const j = held;
    if (!j || j.dead || j.down) return false;
    if (button === 2) loiter(world, j, { x, y });
    else strike(world, j, { x, y });
    return true;
  }
  // (no guns: what asks it to fire is told no)
  const fire = () => false, launch = () => null;

  PW.jets = { create, step, draw, strike, loiter, launchFrom, launcherOf, leavePod, fire, launch, hurt, blast, target, tool, takeOff, hold, held: () => held,
    key, click, release, pixel, heading, toWorld, artOf, stats,
    LENGTH, HALF_SPAN, CRUISE, VMAX, STALL, DIVE_V, ARMOUR, BOOST, ALT, WARHEAD, MISSILES: 0 };
})();
