'use strict';
// Tanks (N10, N71, N72), after the user's TankMovement and TankAim GIFs, drawn at their real size
// (a cell is about 7 cm: a main battle tank's hull about 116 cells long, and each its own army's
// height - an M1 Abrams 2.44 m to its turret roof, 35 cells with its cupola; a Type 99 34; a low
// T-64 32), in two parts, as the user asked:
// - the hull and its running gear: each road wheel finds the ground under it on its own spring
//   (SPRING_UP / SPRING_DOWN cells of travel), the hull lies along the line through them, and the
//   track belt wraps the wheels as they lie - so the tracks always follow the ground under them.
//   The track's links and the wheels' spokes run round in the GIF's three-frame cycle, step for
//   step with the ground covered (they never slide on it). The hull is the same both ways round
//   (N72): it never turns round - to go the other way it just drives the other way.
// - the turret and its long gun: the turret sits on the hull and tilts with it (N71); it turns to
//   face the way the tank goes, or its target - only the turret turns. The gun is laid on its
//   target (or level ahead) in the world's frame, but only within its own reach of the hull: from
//   GUN_DOWN below the hull's line to GUN_UP above it, so it never dips into the hull nose-up nor
//   points at the sky nose-down - its range follows the hull (N71).
// A tank drives left or right only, reaching its top speed in 1.5 s, slower uphill. It climbs
// slopes up to MAX_SLOPE and steps up to STEP cells. It will not go into a wall, a tunnel (it has
// no room there), deep water or over a drop; and where the ground is blown away from under it, it
// tips over the edge and falls.
// It drives through its own side's buildings (N3, the vehicle rule): every tower, military mass and
// spine stands on a gate hall at grade, its piers marked (the building record's gates); a tank of the
// building's own side passes the piers as water passes a roof's hatch - every check of its hull
// reads them as open - while to anything else, an enemy tank too, they stay the solid walls they
// are (an enemy stops nose to the facade).
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
  const CLIMB = 0.6;            // of its top speed it loses climbing, by the sine of the slope
  const MAX_SLOPE = 35;         // degrees it climbs, at most
  const STEP = 8;               // cells it climbs straight up at most (a kerb, a low heap)
  const DROP = 16;              // cells it goes down straight at most (it stops at a higher edge)
  const LOOK = 48;              // cells ahead of its leading wheel it looks at the ground (room to brake)
  const NOSE = 60;              // cells from its middle its nose and lower plate reach, and a little
  const SPAN = 16;              // cells a slope is measured over (a kerb within it is a step, not a slope)
  const DEEP = 26;              // cells of water it fords at most
  const SPRING_UP = 5, SPRING_DOWN = 4;   // cells of travel each road wheel has, up and down
  const WHEEL = 6;              // cells a road wheel's radius (about 0.85 m across)
  const MAX_TILT = 85;          // degrees the hull lies over at most, on its wheels
  const TIP = 3;                // rad/s^2 it tips over an edge with nothing under its middle
  const TIP_MAX = 80;           // degrees it tips to on the edge before it slides off it and falls
  const GUN_UP = 60, GUN_DOWN = 6;   // degrees the gun lays above and below the hull's line
  const SLEW = 1.4;             // rad/s the gun is laid at
  const TURN = 0.9;             // s the turret takes to turn round (half a turn)
  const G = PW.GRAVITY || 260;
  const deg = Math.PI / 180;

  // ---- The look --------------------------------------------------------------------------------------
  const STYLES = {
    // (deck: the hull's roof, in cells over the track's bottom run; the turret stands 11 on it)
    modern: { base: [196, 174, 126], dark: [148, 128, 90], wheel: [96, 92, 82], wheels: 7, span: 46, skirt: [-50, 50, -18, -9], barrel: 76, deck: 24,
      turret: [[-34, -3], [-32, -10], [18, -11], [26, -5], [24, 0], [-25, 0]] },
    asian: { base: [96, 112, 68], dark: [66, 80, 48], wheel: [76, 82, 66], wheels: 6, span: 42, skirt: [-47, 47, -17, -12], barrel: 80, deck: 23,
      camo: { spots: [[64, 82, 48], [130, 126, 86], [102, 86, 58], [120, 144, 82]], density: 0.42 },
      turret: [[-28, -2], [-25, -10], [10, -11], [31, -3], [25, 0], [-23, 0]], star: true },
    gothic: { base: [64, 78, 52], dark: [44, 54, 36], wheel: [70, 76, 60], wheels: 6, span: 40, skirt: null, barrel: 74, deck: 21,
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
    // The hull (u along it, v down; v = 0 the bottom of the track's run under it), the same at both
    // ends: its upper body, a sloped plate and a lower plate at each end, the fenders over the
    // tracks, and the side skirts where it has them.
    const deck = st.deck;
    const body = [[-58, -19], [-32, -deck], [32, -deck], [58, -19], [58, -18], [53, -16], [-53, -16], [-58, -18]];
    const skirt = st.skirt;
    // (a cell's distance along from the middle, the same for a cell and its mirror: cells x and
    // -x - 1 are each other's)
    const along = (x) => Math.abs(x + 0.5) - 0.5;
    // (the body tested on its |u|: a cell and its mirror come out alike even where an edge runs
    // through cell corners)
    const hull = sprite(-60, -30, 60, -6, (u, v) => inPoly(body, Math.abs(u), v) || (skirt && u >= skirt[0] && u <= skirt[1] && v >= skirt[2] && v <= skirt[3] - ((Math.floor(Math.abs(u)) & 7) === 0 ? 1 : 0)), (u, v, light) => {
      let c = camoAt(st, u, v), k = light;
      const au = along(u);
      if (v === -17 || v === -18) k *= 0.62;                       // (the fender's edge)
      if (skirt && v > -17) k *= 0.9;
      // (reactive armour on the sloped plates: blocks in rows along them)
      if (st.era && au >= 34 && v <= -19) c = (au - 34) % 5 === 0 || (v + 30) % 3 === 0 ? st.dark : ERA;
      if (au === 57) k *= 0.8;
      return rgb(c, k);
    });
    // The turret, facing right (t forward, s down across it; s = 0 its ring on the hull's roof),
    // with its commander's cupola and a machine gun beside it, low on its roof, and the mantlet the
    // gun pivots in.
    const shape = st.turret || Array.from({ length: 19 }, (_, k) => { const a = Math.PI * k / 18; return [26 * Math.cos(a), -11.5 * Math.sin(a)]; });
    const turret = sprite(-36, -17, 30, 0, (t, s) => inPoly(shape, t, s) || (t >= -9 && t <= 0 && s >= -12 && s <= -10) || (t >= 1 && t <= 8 && s >= -12.5 && s <= -11.5)
      || (t >= 15 && t <= 24 && s >= -9 && s <= -3), (t, s, light) => {
      let c = camoAt(st, t, s), k = light;
      if (t >= 1 && t <= 8 && s === -12) { c = [40, 40, 42]; k = 1; }          // (the machine gun)
      if (st.cross && t >= -16 && t <= -6 && s >= -8 && s <= -2 && (t === -11 || t === -12 || s === -5)) { c = [222, 222, 214]; k = 1; }
      if (st.star && t >= -14 && t <= -10 && s >= -7 && s <= -3 && Math.abs(t + 12) + Math.abs(s + 5) <= 2) { c = [196, 44, 36]; k = 1; }
      if (st.era && t >= 12 && s >= -10 && s <= -2) c = (t - 12) % 4 === 0 || (s + 10) % 3 === 0 ? st.dark : ERA;
      return rgb(c, k);
    });
    // (road wheels evenly along the hull; a sprocket at one end and the idler at the other, the
    // same, raised; small return rollers under the belt's top run)
    const wheels = Array.from({ length: st.wheels }, (_, k) => -st.span + (2 * st.span) * k / (st.wheels - 1));
    a = { style, st, hull, turret, wheels, R: WHEEL, sprocket: [-52, -9, 6], idler: [52, -9, 6], rollers: [-30, 0, 30].map((u) => [u, -13, 1.5]),
      trunnion: [20, -6], barrel: st.barrel, ring: [0, -deck + 1], height: deck + 11, nose: NOSE - st.span };
    ART.set(style, a);
    return a;
  }

  // ---- A tank on the ground ----------------------------------------------------------------------------
  // (what bears a tank: the ground, rubble and what is built - not water, smoke or cover, which it
  // passes like a trooper does, at another depth)
  const { phase, passable } = PW.mat, POWDER = PW.PHASE.POWDER;
  const isSupport = (m) => { const id = m & ID_MASK; return phase[id] >= POWDER && !passable[id]; };
  // A building's gate piers (N3): kept by column, x -> [y0, y1, side, ...], made again when the
  // buildings change (and now and then, a ruin's gone). A building's side: its faction.
  let gateCache = { list: null, n: -1, at: -1e9, map: new Map() };
  function gatesOf(world) {
    const list = world.buildings || [], now = world.tick || 0;
    if (gateCache.list === list && gateCache.n === list.length && now - gateCache.at < 60) return gateCache.map;
    // (each column's spans: y0, y1, side, and what passes there - PIER, every cell of a pier;
    // HALL, the stairs standing in the hall between its piers, up to the storey over it - the
    // troops' way up, a flight at the back of the hall, the lane at its front)
    const map = new Map(), add = (x, y0, y1, side, kind) => { let a = map.get(x); if (!a) map.set(x, a = []); a.push(y0, y1, side, kind); };
    for (const b of list) {
      const side = b.faction || b.side;
      if (!b.gates || !b.gates.length || !side || b.ruined) continue;
      let gx0 = Infinity, gx1 = -Infinity;
      for (const g of b.gates) { add(g.x, g.y0, g.y1, side, PIER); gx0 = Math.min(gx0, g.x); gx1 = Math.max(gx1, g.x); }
      const { y0, y1 } = b.gates[0];
      for (let x = gx0 + 1; x < gx1; x += 1) add(x, y0, y1, side, HALL);
    }
    gateCache = { list, n: list.length, at: now, map };
    return map;
  }
  const PIER = 0, HALL = 1;
  // (does a tank of `side` pass cell y (of stuff id) of a column whose gate spans are `spans`? A
  // pier of a building of its own side, or a flight of stairs in its hall)
  function passes(spans, side, y, id) {
    for (let k = 0; k < spans.length; k += 4) if (y >= spans[k] && y <= spans[k + 1] && spans[k + 2] === side && (spans[k + 3] === PIER || id === M.PLATFORM)) return true;
    return false;
  }
  const spansFor = (world, t, x) => (t && t.side ? gatesOf(world).get(x) : undefined);
  // (the top of what can bear a tank in column x, from `from`: the top of the ground `from` is in -
  // looked for up as far as it climbs and a little more, a wall higher than that given as that
  // height - or, `from` in the open, the ground under it, down as far as it might go; -1 if nothing)
  // (for tank t: its own side's gate piers are no support, nor in its way - see passes)
  function surface(world, x, from, t) {
    const { mat, width: W, height: H } = world;
    if (x < 1 || x >= W - 1) return -1;
    const f = Math.max(1, Math.min(H - 1, Math.round(from))), y0 = Math.max(1, f - STEP - 4), y1 = Math.min(H - 1, f + 120);
    const spans = spansFor(world, t, x), side = t && t.side;
    const bears = spans ? (y) => isSupport(mat[y * W + x]) && !passes(spans, side, y, mat[y * W + x] & ID_MASK) : (y) => isSupport(mat[y * W + x]);
    if (bears(f)) {
      let y = f;
      while (y > y0 && bears(y - 1)) y -= 1;
      return y;
    }
    for (let y = f + 1; y <= y1; y += 1) if (bears(y)) return y;
    return -1;
  }
  // (where a road wheel's rim meets the ground: the highest of the ground across its lower arc, so
  // it rolls up onto the corner of a step rather than dropping into it, and bridges a crack)
  const ARC = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => [d, WHEEL - Math.sqrt(WHEEL * WHEEL - d * d)]);
  function wheelGround(world, x, from, t) {
    let best = -1;
    for (const [d, lift] of ARC) {
      const y = surface(world, Math.round(x) + d, from, t);
      if (y >= 0 && (best < 0 || y + lift < best)) best = y + lift;
    }
    return best;
  }
  let current = null;
  // (spec.facing: the way its turret faces, -1 / +1; spec.side: its side, whose gates it passes)
  function create(world, spec) {
    const art = artOf(spec.style || 'modern'), facing = spec.facing || 1;
    const x = spec.x, y = spec.y ?? world.groundTop[Math.round(x)];
    const t = { art, style: art.style, side: spec.side || null, x, y, facing, angle: 0, spin: 0,
      v: 0, vy: 0, drive: 0, travel: 0, falling: false, tipping: false, blocked: '', dead: false,
      springs: new Float32Array(art.wheels.length), contact: new Uint8Array(art.wheels.length),
      target: null, elevation: 0, turning: 0 };
    (world.tanks || (world.tanks = [])).push(t);
    current = world;
    settle(world, t, 0);
    return t;
  }
  // (the hull's frame: u along it - to the right on level ground - v down across it)
  const dirOf = (t) => [Math.cos(t.angle), Math.sin(t.angle)];
  function toWorld(t, u, v) {
    const c = Math.cos(t.angle), s = Math.sin(t.angle);
    return [t.x + u * c - v * s, t.y + u * s + v * c];
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
      const y = wheelGround(world, wx, wy, t);
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
    const { wheels } = t.art, lead = dir > 0 ? wheels.length - 1 : 0;
    const [lx, ly] = toWorld(t, wheels[lead], t.springs[lead]);
    let x = Math.round(lx), prev = surface(world, x, ly, t);
    if (prev < 0) return '';
    const tanMax = Math.tan(MAX_SLOPE * deg);
    HS[0] = prev;
    const stop = (k, why) => { t.room = k - t.art.nose; return why; };
    for (let k = 1; k <= LOOK; k += 1) {
      x += dir;
      const h = surface(world, x, prev, t);
      HS[k] = h;
      if (h < 0 || h - prev > DROP) return stop(k - 1, 'drop');
      for (let s = 1; s <= Math.min(k, SPAN); s += 1) if (HS[k - s] - h > Math.max(STEP, s * tanMax)) return stop(k - s, 'too steep');
      // (room for its height over its tracks: no tunnel, no overhang - its own side's gates aside)
      const spans = spansFor(world, t, x);
      for (let up = 1; up <= t.art.height && h - up >= 0; up += 1) {
        if (isSupport(mat[(h - up) * W + x]) && !(spans && passes(spans, t.side, h - up, mat[(h - up) * W + x] & ID_MASK))) return stop(k, 'no room');
        if (up <= 4 && (PW.getFlags(world, x, h - up) & PW.FLAG.TUNNEL)) return stop(k, 'tunnel');
      }
      let water = 0;
      while (water <= DEEP && h - water - 1 >= 0 && (mat[(h - water - 1) * W + x] & ID_MASK) === M.WATER) water += 1;
      if (water > DEEP) return stop(k, 'deep water');
      prev = h;
    }
    return '';
  }
  function step(world, dt) {
    const list = world.tanks;
    if (!list) return;
    for (const t of list) if (!t.dead) stepOne(world, t, dt);
  }
  function stepOne(world, t, dt) {
    // (its tracks off the ground, or all but one wheel: it does not drive)
    if (t.falling || t.tipping) { t.v = 0; t.blocked = ''; } else {
      // Driving: on to its top speed either way (less, uphill), braking to a stop before it goes
      // the other way; and braking in time for what stops it ahead, its nose short of it.
      const want = t.drive * VMAX * (1 - CLIMB * Math.max(0, -t.drive * Math.sin(t.angle)));
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
      t.travel += t.v * dt;
      settle(world, t, dt);
    }
    aim(t, dt);
  }
  // (the gun's reach, in the world's frame, facing `side`: GUN_DOWN below the hull's line to
  // GUN_UP above it - the hull's line rising the way the turret faces by -side x its angle)
  const reach = (t, side) => [-side * t.angle - GUN_DOWN * deg, -side * t.angle + GUN_UP * deg];
  // The turret faces its target's side, or the way the tank goes, turning round to it over TURN;
  // the gun is laid on the target (or level ahead), held within its reach of the hull.
  function aim(t, dt) {
    let want = 0, side = t.facing;
    if (t.target) {
      const [px, py] = muzzleBase(t);
      side = t.target.x >= px ? 1 : -1;
      want = Math.atan2(py - t.target.y, Math.abs(t.target.x - px));
    } else if (t.drive) side = t.drive;
    if (side !== t.facing) {
      t.turning += dt;
      if (t.turning >= TURN) { t.facing = side; t.turning = 0; }
    } else if (t.turning > 0) t.turning = Math.max(0, t.turning - dt);
    // (while it turns, the gun holds its elevation)
    if (side === t.facing && !t.turning) {
      const [lo, hi] = reach(t, side);
      want = Math.max(lo, Math.min(hi, want));
      const d = want - t.elevation, s = SLEW * dt;
      t.elevation += Math.abs(d) <= s ? d : Math.sign(d) * s;
    }
    // (and never outside its reach of the hull, however the hull moves)
    const [lo, hi] = reach(t, t.facing);
    t.elevation = Math.max(lo, Math.min(hi, t.elevation));
  }
  // (where the turret ring is, in the world: on the hull's roof)
  const ringAt = (t) => toWorld(t, t.art.ring[0], t.art.ring[1]);
  // (how far round the turret is: 1 facing t.facing, -1 turned the other way, 0 square to the eye -
  // seen from the side, its length and the gun's shrink as it turns)
  const turnOf = (t) => Math.cos(Math.PI * t.turning / TURN);
  // (the turret's frame, on the hull: t forward the way it faces, s down across it; `k` how far
  // round it is - its length seen shortened by it)
  function turretFrame(t, k = 1) {
    const c = Math.cos(t.angle), s = Math.sin(t.angle), f = t.facing * k;
    return [f * c, f * s, -s, c];
  }
  function muzzleBase(t, k = 1) {
    const [rx, ry] = ringAt(t), [fx, fy, nx, ny] = turretFrame(t, k), [u, v] = t.art.trunnion;
    return [rx + u * fx + v * nx, ry + u * fy + v * ny];
  }
  // (the muzzle: where a shot leaves, and which way - for the guns to come)
  function muzzle(t) {
    const [px, py] = muzzleBase(t), c = Math.cos(t.elevation), s = Math.sin(t.elevation);
    return { x: px + t.facing * c * t.art.barrel, y: py - s * t.art.barrel, dx: t.facing * c, dy: -s };
  }
  // (orders: drive -1 / 0 / +1; aim at a point, or null for level ahead)
  function drive(t, dir) { t.drive = Math.sign(dir); }
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
    // (u to its cell by floor, so the two ends come out each other's mirror)
    const put = (u, v, c) => { const x = Math.floor(u) - u0, y = Math.round(v) - v0; if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = c; };
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
    for (let u = su; u < iu; u += 1) {
      const b = Math.round(bottomAt(u + 0.5));
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
        // (three spokes, turned a third of their spacing each frame, rolling with it: the GIF's cycle)
        if (spokes && d >= 1.6 && d <= r - 1.2 && Math.abs(Math.sin((Math.atan2(dv, du) - frame * (Math.PI * 2 / 9)) * 1.5)) < 0.22) c = spoke;
        put(u, v, c);
      }
    };
    disc(su, sv, sr, st.dark, true);
    disc(iu, iv, ir, st.dark, true);
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
      const { art } = t, c = Math.cos(t.angle), s = Math.sin(t.angle);
      // (turning round: its length seen shortened - never below 0.55 of it, a turret being nearly
      // as wide as it is long - and the gun's by all of it)
      const k = turnOf(t), kt = (k < 0 ? -1 : 1) * Math.max(0.55, Math.abs(k));
      const [rx, ry] = ringAt(t), [tfx, tfy, tnx, tny] = turretFrame(t, kt), [bx, by] = muzzleBase(t, kt);
      const L = art.barrel, gdx = t.facing * k * Math.cos(t.elevation) * L, gdy = -Math.sin(t.elevation) * L;
      const glen = Math.hypot(gdx, gdy), gux = glen > 1e-6 ? gdx / glen : 0, guy = glen > 1e-6 ? gdy / glen : 0;
      // (the box it takes up: its hull and running gear, turret and gun)
      let x0 = Math.min(bx, bx + gdx), x1 = Math.max(bx, bx + gdx), y0 = Math.min(by, by + gdy), y1 = Math.max(by, by + gdy);
      for (const [u, v] of [[-61, -31], [61, -31], [-61, 9], [61, 9]]) {
        const [wx, wy] = toWorld(t, u, v);
        x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
      }
      for (const [u, v] of [[-37, -18], [31, -18], [-37, 1], [31, 1]]) {
        const wx = rx + u * tfx + v * tnx, wy = ry + u * tfy + v * tny;
        x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
      }
      x0 = Math.max(Math.floor(x0 - 4), Math.floor(vx0)); x1 = Math.min(Math.ceil(x1 + 4), Math.ceil(vx1));
      y0 = Math.max(Math.floor(y0 - 4), Math.floor(vy0)); y1 = Math.min(Math.ceil(y1 + 4), Math.ceil(vy1));
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
      // (the turret's frame turned back: a world offset from the ring to its t, s)
      const det = tfx * tny - tfy * tnx;
      for (let j = 0; j < ih; j += 1) {
        const wy = y0 + j * skip + 0.5, row = j * stride;
        px32.fill(0, row, row + iw);
        for (let i = 0; i < iw; i += 1) {
          const wx = x0 + i * skip + 0.5;
          // The gun: a tube from the trunnion, thicker at its fume extractor and its muzzle (seen
          // end-on while the turret turns, its muzzle's ring).
          const gx = wx - bx, gy = wy - by;
          const along = gx * gux + gy * guy, across = gx * guy - gy * gux;
          const f = glen > 1e-6 ? along / glen * L : 0;
          if (along >= -2 && along <= glen) {
            const half = f > L * 0.4 && f < L * 0.4 + 9 ? 2.5 : f > L - 3 ? 2 : 1.6;
            if (across >= -half && across <= half) { px32[row + i] = across < -half + 1 ? barrelL : across > half - 1 ? barrelD : barrelC; continue; }
          }
          if (glen < 6 && gx * gx + gy * gy <= 6.25) { px32[row + i] = gx * gx + gy * gy <= 1.5 ? barrelD : barrelC; continue; }
          // The turret, on its ring, facing its way.
          const rdx = wx - rx, rdy = wy - ry;
          const tt = Math.floor((rdx * tny - rdy * tnx) / det), ts = Math.floor((rdy * tfx - rdx * tfy) / det);
          let col = at(art.turret, tt, ts);
          if (col) { px32[row + i] = col; continue; }
          // The hull and its running gear, along the ground under it.
          const dx = wx - t.x, dy = wy - t.y;
          const u = Math.floor(dx * c + dy * s), v = Math.floor(dy * c - dx * s);
          col = at(art.hull, u, v);
          if (!col) { const gu = u - GEAR.u0, gv = v - GEAR.v0; if (gu >= 0 && gv >= 0 && gu < GEAR.w && gv < GEAR.h) col = gear[gv * GEAR.w + gu]; }
          if (col) px32[row + i] = col;
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
  // another. A / D or the arrow keys drive it left or right, S or the down arrow stops it.
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
    // (of the side of the buildings nearest it: it passes their gates)
    let side = null, best = Infinity;
    for (const b of world.buildings || []) {
      const s = b.faction || b.side, bx = b.body ? (b.body.left + b.body.right) / 2 : b.x;
      if (s && Number.isFinite(bx) && Math.abs(bx - gx) < best) { best = Math.abs(bx - gx); side = s; }
    }
    held = create(world, { style: Object.keys(STYLES)[nextStyle++ % 3], side, x: gx, y: gy, facing: gx < W / 2 ? 1 : -1 });
    return held;
  }
  function key(event) {
    if (!held || held.dead || event.repeat) return false;
    const k = event.code;
    if (k === 'KeyA' || k === 'ArrowLeft') drive(held, -1);
    else if (k === 'KeyD' || k === 'ArrowRight') drive(held, 1);
    else if (k === 'KeyS' || k === 'ArrowDown') drive(held, 0);
    else return false;
    return true;
  }

  PW.tanks = { create, step, draw, drive, aimAt, muzzle, settle, ahead, tool, key, held: () => held, reach, gatesOf, STYLES: Object.keys(STYLES),
    VMAX, ACCEL, GUN_UP, GUN_DOWN, MAX_SLOPE, STEP, SPRING_UP, SPRING_DOWN, TURN };
})();
