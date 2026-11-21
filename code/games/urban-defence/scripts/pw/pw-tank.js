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
// are (an enemy stops nose to the facade). Only what stands of the building itself passes so: a
// building still going up passes as far as its hall stands, and a fallen pier's rubble blocks.
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
  // Fighting (N77): its gun, its armour, and what is left of it.
  const RELOAD = 3.2;           // s between its rounds (its loader's drill)
  const RECOIL = 0.35;          // s its gun takes to run back and out again after a round
  const KICK = 7;               // cells the gun runs back into its mantlet
  const ARMOUR = 100;           // what its armour takes (see hurt): a dart through it does 60
  const SMOKES = 60, BURNS = 30;   // its armour's worth left under which it smokes from its engine deck, and burns
  const BURN_OUT = 14;          // s its wreck burns
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
    a = { style, st, hull, turret, shape: st.turret ? shape : null, wheels, R: WHEEL, sprocket: [-52, -9, 6], idler: [52, -9, 6], rollers: [-30, 0, 30].map((u) => [u, -13, 1.5]),
      trunnion: [20, -6], barrel: st.barrel, ring: [0, -deck + 1], height: deck + 11, nose: NOSE - st.span,
      barrelC: rgb(st.base, 0.95), barrelD: rgb(st.dark, 0.85), barrelL: rgb(st.base, 1.18) };
    ART.set(style, a);
    return a;
  }

  // ---- A tank on the ground ----------------------------------------------------------------------------
  // (what bears a tank: the ground, rubble and what is built - not water, smoke or cover, which it
  // passes like a trooper does, at another depth)
  const { phase, passable } = PW.mat, POWDER = PW.PHASE.POWDER;
  const isSupport = (m) => { const id = m & ID_MASK; return phase[id] >= POWDER && !passable[id]; };
  // A building's gate piers (N3): kept by column, x -> [y0, y1, side, kind, building, ...], made
  // again when the buildings change (and every second). A building's side: its faction. Whole or
  // not - a city is always building somewhere, and its gate hall goes up first and stands through
  // it all - for what a tank passes is the building's own standing structure, cell by cell (see
  // passes): where a pier has fallen, its rubble is in the way as any rubble is.
  let gateCache = { list: null, n: -1, at: -1e9, map: new Map() };
  function gatesOf(world) {
    const list = world.buildings || [], now = world.tick || 0;
    if (gateCache.list === list && gateCache.n === list.length && now - gateCache.at < 60) return gateCache.map;
    // (each column's spans: y0, y1, side, what passes there - PIER, every cell of a pier; HALL,
    // the stairs standing in the hall between its piers, up to the storey over it: the troops'
    // way up, a flight at the back of the hall, the lane at its front - and whose they are)
    const map = new Map(), add = (x, y0, y1, side, kind, id) => { let a = map.get(x); if (!a) map.set(x, a = []); a.push(y0, y1, side, kind, id); };
    for (const b of list) {
      const side = b && (b.faction || b.side);
      if (!side || !b.gates || !b.gates.length) continue;
      let gx0 = Infinity, gx1 = -Infinity;
      for (const g of b.gates) { add(g.x, g.y0, g.y1, side, PIER, b.id); gx0 = Math.min(gx0, g.x); gx1 = Math.max(gx1, g.x); }
      const { y0, y1 } = b.gates[0];
      for (let x = gx0 + 1; x < gx1; x += 1) add(x, y0, y1, side, HALL, b.id);
    }
    gateCache = { list, n: list.length, at: now, map };
    return map;
  }
  const PIER = 0, HALL = 1;
  // (does a tank of `side` pass cell (x, y) - of stuff id - of a column whose gate spans are
  // `spans`? A pier of a building of its own side, or a flight of stairs in its hall: that
  // building's own, standing there now)
  function passes(world, spans, side, x, y, id) {
    for (let k = 0; k < spans.length; k += 5) {
      if (y < spans[k] || y > spans[k + 1] || spans[k + 2] !== side || (spans[k + 3] !== PIER && id !== M.PLATFORM)) continue;
      if (PW.getOwner(world, x, y) === spans[k + 4]) return true;
    }
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
    const bears = spans ? (y) => isSupport(mat[y * W + x]) && !passes(world, spans, side, x, y, mat[y * W + x] & ID_MASK) : (y) => isSupport(mat[y * W + x]);
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
      target: null, elevation: 0, turning: 0,
      hp: ARMOUR, ammo: spec.ammo || 'he', reload: 0, recoil: 0, rear: -facing, scars: [], fumes: 0, hurtBy: '' };
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
  // it can still go, its nose short of it.) For the probes, each look leaves on the tank where it
  // stopped it: t.stopAt [column, ground there, why] and, for 'no room', t.stopCell - the cell
  // over that ground in its way (see explain).
  const HS = new Float64Array(LOOK + 1);
  function ahead(world, t, dir) {
    const { mat, width: W } = world;
    const { wheels } = t.art, lead = dir > 0 ? wheels.length - 1 : 0;
    const [lx, ly] = toWorld(t, wheels[lead], t.springs[lead]);
    let x = Math.round(lx), prev = surface(world, x, ly, t);
    t.stopCell = null; t.stopAt = null; t.looked = 0;
    if (prev < 0) return '';
    const tanMax = Math.tan(MAX_SLOPE * deg);
    HS[0] = prev;
    let kNow = 0;
    const stop = (k, why) => { t.room = k - t.art.nose; t.stopAt = [x, HS[kNow], why]; t.looked = kNow; return why; };
    for (let k = 1; k <= LOOK; k += 1) {
      x += dir;
      const h = surface(world, x, prev, t);
      HS[k] = h; kNow = k;
      if (h < 0 || h - prev > DROP) return stop(k - 1, 'drop');
      for (let s = 1; s <= Math.min(k, SPAN); s += 1) if (HS[k - s] - h > Math.max(STEP, s * tanMax)) return stop(k - s, 'too steep');
      // (room for its height over its tracks: no tunnel, no overhang - its own side's gates aside)
      const spans = spansFor(world, t, x);
      for (let up = 1; up <= t.art.height && h - up >= 0; up += 1) {
        if (isSupport(mat[(h - up) * W + x]) && !(spans && passes(world, spans, t.side, x, h - up, mat[(h - up) * W + x] & ID_MASK))) { t.stopCell = [x, h - up]; return stop(k, 'no room'); }
        if (up <= 4 && (PW.getFlags(world, x, h - up) & PW.FLAG.TUNNEL)) return stop(k, 'tunnel');
      }
      let water = 0;
      while (water <= DEEP && h - water - 1 >= 0 && (mat[(h - water - 1) * W + x] & ID_MASK) === M.WATER) water += 1;
      if (water > DEEP) return stop(k, 'deep water');
      prev = h;
    }
    t.looked = LOOK;
    return '';
  }
  // (for the probes: where tank t is, what each of its wheels rests on - the ground cell its
  // wheel finds, as it finds it - and what stops it going on `dir`, with the ground it looked
  // over: one line each)
  function explain(world, t, dir = t.drive || 1) {
    const name = (x, y) => {
      const id = PW.get(world, x, y) & ID_MASK, o = PW.getOwner(world, x, y), b = o ? (world.buildings || [])[o - 1] : null;
      return `(${x},${y}) ${(PW.mat.names && PW.mat.names[id]) || id} owner ${o}${b ? ` ${b.type || 'building'} g${b.ground}` : ''}`;
    };
    const lines = [`hull at (${t.x.toFixed(1)}, ${t.y.toFixed(1)}) angle ${(t.angle / deg).toFixed(1)}${t.falling ? ' FALLING' : ''}${t.tipping ? ' TIPPING' : ''}, side ${t.side || '-'}, blocked '${t.blocked || ''}'`];
    t.art.wheels.forEach((u, i) => {
      const [wx, wy] = toWorld(t, u, 0), x = Math.round(wx), y = surface(world, x, wy, t);
      lines.push(`wheel ${i} at (${x}, ${wy.toFixed(1)}): ${y < 0 ? 'no ground under it' : 'over ' + name(x, y)}`);
    });
    const why = ahead(world, t, Math.sign(dir) || 1), seen = [];
    for (let k = 0; k <= t.looked; k += 4) seen.push(HS[k]);
    lines.push(`ahead: '${why}'${t.stopAt ? ` at column ${t.stopAt[0]} (ground there ${t.stopAt[1]})` : ''}${t.stopCell ? `, in its way ${name(t.stopCell[0], t.stopCell[1])}` : ''}, room ${t.room}`);
    lines.push(`ground ahead, every 4th column from its lead wheel: ${seen.join(' ')}`);
    return lines;
  }
  function step(world, dt) {
    // (the rounds in flight - until the world's loop steps them itself - and the tanks among what
    // they can strike)
    if (PW.shots) { PW.shots.addTarget(target); if (!PW.shots.looped) PW.shots.step(world, dt); }
    if (world.wrecks && world.wrecks.length) stepWrecks(world, dt);
    const list = world.tanks;
    if (!list) return;
    for (const t of list) if (!t.dead) stepOne(world, t, dt);
    for (const t of list) if (!t.art.warm) { warmFrames(t.art); break; }
    // (the dead are let go: what is left of them is the world's now)
    let w = 0;
    for (let q = 0; q < list.length; q += 1) if (!list[q].dead) list[w++] = list[q];
    list.length = w;
  }
  function stepOne(world, t, dt) {
    if (t.reload > 0) t.reload = Math.max(0, t.reload - dt);
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt);
    if (t.drive) t.rear = -t.drive;
    // (its tracks off the ground, or all but one wheel: it does not drive)
    if (t.falling || t.tipping) { t.v = 0; t.blocked = ''; } else {
      // Driving: on to its top speed either way (less, uphill, and less as it is hurt - its engine
      // smoking, burning), braking to a stop before it goes the other way; and braking in time for
      // what stops it ahead, its nose short of it.
      const lame = t.hp < BURNS ? 0.45 : t.hp < SMOKES ? 0.8 : 1;
      const want = t.drive * VMAX * lame * (1 - CLIMB * Math.max(0, -t.drive * Math.sin(t.angle)));
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
      // (thrown up by a blast, it meets nothing under it until it comes down again)
      if (t.vy >= 0) settle(world, t, dt);
      if (!t.falling && !t.tipping) t.vy = 0;          // (it came down on its tracks, the blow taken by its springs)
      if (t.y > world.height + 200) t.dead = true;
    } else {
      t.x += t.v * dt * Math.cos(t.angle);
      t.travel += t.v * dt;
      settle(world, t, dt);
    }
    aim(t, dt);
    if (t.hp < SMOKES) fume(world, t, dt);
  }
  // (the gun's reach, in the world's frame, facing `side`: GUN_DOWN below the hull's line to
  // GUN_UP above it - the hull's line rising the way the turret faces by -side x its angle)
  const reach = (t, side) => [-side * t.angle - GUN_DOWN * deg, -side * t.angle + GUN_UP * deg];
  // (its fire control: the gun's elevation that puts the round it has loaded on (x, y) from the
  // muzzle's foot - a round falls as it flies, so a far mark is laid on above the line to it; the
  // flatter of the two arcs that reach it, or the line itself where none does)
  function lay(t, px, py, x, y) {
    const dx = Math.abs(x - px), up = py - y, line = Math.atan2(up, dx);
    const k = PW.shots && PW.shots.KINDS[t.ammo];
    if (!k || dx < 1) return line;
    const v = k.speed, g = G, v2 = v * v, root = v2 * v2 - g * (g * dx * dx + 2 * up * v2);
    return root < 0 ? line : Math.atan((v2 - Math.sqrt(root)) / (g * dx));
  }
  // The turret faces its target's side, or the way the tank goes, turning round to it over TURN;
  // the gun is laid on the target (or level ahead), held within its reach of the hull.
  function aim(t, dt) {
    let want = 0, side = t.facing;
    if (t.target) {
      const [px, py] = muzzleBase(t);
      side = t.target.x >= px ? 1 : -1;
      want = lay(t, px, py, t.target.x, t.target.y);
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
  // ---- The turret turning round (N71, N72; the user's photos of tanks seen head-on) -------------------
  // Turning to face the other way, the turret swings round through the eye, as a real one turns to
  // lay its gun: half way it faces us - its gun pointing out of the picture, the muzzle's dark bore
  // ringed, the mantlet in the middle of a turret near as wide as the hull, its front and a side in
  // sight - while the hull and tracks under it stay just as they were. It is drawn as the solid it is,
  // turned: its plan (its half-width along it - PLAN), its side's profile over that, chamfered or
  // rounded across, and its mantlet, cupola and machine gun where they stand on it - seen from the
  // side at each step of a half turn (TURN_FRAMES of them, made once for each army's turret as they
  // are first needed), painted as its side sprite is: its camouflage, its markings on its side, its
  // reactive armour on its front, lit from above.
  const TURN_FRAMES = 24;
  const TURN_SIDE = 0.92;       // turned no further than this (cos), it is its side sprite, shortened
  const PLAN = {
    modern: (t) => (t <= 14 ? 24 : Math.max(0, 24 - (t - 14) * 0.45)),     // (the Abrams: slab sides, its front cut back)
    asian: (t) => (t <= 0 ? 23 : Math.max(0, 23 - t * 0.36)),               // (the Type 99: an arrowhead wedge)
    gothic: (t) => 21 * Math.sqrt(Math.max(0, 1 - (t / 26) ** 2)),          // (the T-64: a round dome)
  };
  const BORE = PW.abgr(14, 14, 16);
  // (what of the turret is at (t along it, w across it - toward the eye at the start of the turn -
  // s down): 0 nothing, 1 its body, 2 the mantlet, 3 the cupola, 4 the machine gun)
  function turretSolid(art, top, t, w, s) {
    if (s > 0) return 0;
    if (t >= 15 && t <= 24 && Math.abs(w) <= 6 && s >= -9 && s <= -3) return 2;
    if (t >= -9 && t <= 0 && w >= 4 && w <= 12 && s >= -12 && s <= -10) return 3;
    if (t >= 1 && t <= 8 && w >= 6 && w <= 7.5 && s >= -12.5 && s <= -11.5) return 4;
    if (!art.shape) return (t / 26) ** 2 + (w / 21) ** 2 + (s / 11.5) ** 2 <= 1 ? 1 : 0;
    const hw = PLAN[art.style](t), ti = Math.floor(t) + 40;
    if (ti < 0 || ti >= top.length || top[ti] > 0) return 0;
    // (chamfered along its roof's edges: the top rows narrower)
    const cut = Math.max(0, top[ti] + 3 - s) * 1.3;
    return Math.abs(w) <= hw - cut && inPoly(art.shape, t, s) ? 1 : 0;
  }
  // (the turret as a solid, cell by cell - t, w, s - made once for each army's turret: what is
  // where in it; see turretSolid)
  const G3 = { t0: -40, w0: -27, s0: -18, nt: 81, nw: 55, ns: 19 };
  // (`layers`: made a layer (s) at a time, so many at most this call - made ahead, a layer a tick)
  function solidOf(art, layers = G3.ns) {
    if (art.solid3) return art.solid3;
    let b = art.solidBuild;
    if (!b) {
      const top = new Float32Array(80).fill(1);
      if (art.shape) for (let ti = 0; ti < 80; ti += 1) for (let s = -17.5; s <= 0; s += 0.5) if (inPoly(art.shape, ti - 40 + 0.5, s)) { top[ti] = s; break; }
      b = art.solidBuild = { top, grid: new Uint8Array(G3.nt * G3.nw * G3.ns), k: 0 };
    }
    for (let n = 0; n < layers && b.k < G3.ns; n += 1, b.k += 1) {
      const k = b.k;
      for (let j = 0; j < G3.nw; j += 1) for (let i = 0; i < G3.nt; i += 1) {
        b.grid[(k * G3.nw + j) * G3.nt + i] = turretSolid(art, b.top, G3.t0 + i + 0.5, G3.w0 + j + 0.5, G3.s0 + k + 0.5);
      }
    }
    if (b.k < G3.ns) return null;
    art.solidBuild = null;
    return (art.solid3 = b.grid);
  }
  function makeTurnFrame(art, th) {
    const { st } = art, c = Math.cos(th), sn = Math.sin(th), grid = solidOf(art);
    const solid = (t, w, s) => {
      const i = Math.floor(t) - G3.t0, j = Math.floor(w) - G3.w0, k = Math.floor(s) - G3.s0;
      return i < 0 || j < 0 || k < 0 || i >= G3.nt || j >= G3.nw || k >= G3.ns ? 0 : grid[(k * G3.nw + j) * G3.nt + i];
    };
    const x0 = -48, x1 = 48, y0 = -18, y1 = 0, w = x1 - x0 + 1, h = y1 - y0 + 1;
    const px = new Uint32Array(w * h), kind = new Uint8Array(w * h);
    for (let y = y0; y <= y1; y += 1) {
      const s = y + 0.5;
      for (let x = x0; x <= x1; x += 1) {
        const X = x + 0.5;
        // (along the line of sight from the eye inwards: the first of it met)
        for (let D = 42; D >= -42; D -= 0.5) {
          const t = X * c + D * sn, wv = -X * sn + D * c;
          const k = solid(t, wv, s);
          if (!k) continue;
          let col;
          if (k === 2) col = rgb(st.base, 0.8);
          else if (k === 3) col = rgb(camoAt(st, Math.floor(t), Math.floor(wv)), 1.08);
          else if (k === 4) col = rgb([40, 40, 42]);
          else if (!solid(t, wv, s - 1)) col = rgb(camoAt(st, Math.floor(t), Math.floor(wv)), 1.2);   // (its roof)
          else {
            const hw = art.shape ? PLAN[art.style](t) : 21 * Math.sqrt(Math.max(0, 1 - (t / 26) ** 2 - (s / 11.5) ** 2));
            if (Math.abs(wv) >= hw - 1.6) col = at(art.turret, Math.floor(t), Math.floor(s)) || rgb(camoAt(st, Math.floor(t), Math.floor(s)), 0.95);   // (its side, as its sprite)
            else if (t > 0) {
              // (its front - the reactive armour's blocks on a T-64's, in rows across it)
              const fw = Math.floor(wv) + 40, fs = Math.floor(s) + 30;
              col = st.era && t >= 8 ? rgb(fw % 5 === 0 || fs % 3 === 0 ? st.dark : ERA, 0.92) : rgb(camoAt(st, Math.floor(wv), Math.floor(s)), 0.86);
            } else col = rgb(camoAt(st, Math.floor(wv), Math.floor(s)), 0.76);   // (its back)
          }
          px[(y - y0) * w + x - x0] = col; kind[(y - y0) * w + x - x0] = 1;
          break;
        }
      }
    }
    // (lit from above: its top edges lighter, its bottom and ends darker - as a sprite is)
    const out = new Uint32Array(px);
    const dim = (col, f) => PW.abgr(Math.min(255, (col & 255) * f), Math.min(255, (col >>> 8 & 255) * f), Math.min(255, (col >>> 16 & 255) * f));
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const q = y * w + x;
      if (!kind[q]) continue;
      if (y === 0 || !kind[q - w]) out[q] = dim(px[q], 1.12);
      else if (y === h - 1 || !kind[q + w]) out[q] = dim(px[q], 0.68);
      else if (x === 0 || x === w - 1 || !kind[q - 1] || !kind[q + 1]) out[q] = dim(px[q], 0.82);
    }
    return { x0, y0, x1, y1, w, h, px: out };
  }
  function turnFrame(art, f) {
    const q = Math.max(0, Math.min(TURN_FRAMES, Math.round(f * TURN_FRAMES)));
    const frames = art.turnFrames || (art.turnFrames = []);
    return frames[q] || (frames[q] = makeTurnFrame(art, Math.PI * q / TURN_FRAMES));
  }
  // (made ahead, a frame a tick, once a tank of an army is out: ready before it first turns)
  function warmFrames(art) {
    if (art.warm) return;
    if (!art.solid3 && !solidOf(art, 1)) return;
    const frames = art.turnFrames || (art.turnFrames = []);
    for (let q = 0; q <= TURN_FRAMES; q += 1) if (!frames[q]) { frames[q] = makeTurnFrame(art, Math.PI * q / TURN_FRAMES); return; }
    art.warm = true;
  }

  // A tank's pose as it is drawn - its turret's frame turned as far round as it is, the gun's line,
  // run back after a round - for its drawing, for what a round strikes of it, and for the wreck it
  // leaves: one look, cell for cell, in all three.
  function poseOf(t) {
    const { art } = t;
    // (turning round: a little way, its side shortened; further, the solid turret turned - see
    // turnFrame - and the gun seen shortened by all of it, pointing out at us, its bore ringed)
    const k = turnOf(t), round = t.turning > 0 && Math.abs(k) < TURN_SIDE;
    const kt = round ? 1 : (k < 0 ? -1 : 1) * Math.max(0.55, Math.abs(k));
    const [rx, ry] = ringAt(t), [tfx, tfy, tnx, tny] = turretFrame(t, kt), [bx, by] = muzzleBase(t, round ? k : kt);
    const L = art.barrel - (t.recoil > 0 ? KICK * t.recoil / RECOIL : 0), gdx = t.facing * k * Math.cos(t.elevation) * L, gdy = -Math.sin(t.elevation) * L;
    const glen = Math.hypot(gdx, gdy), toward = Math.sin(Math.PI * t.turning / TURN) * Math.cos(t.elevation);
    // (the turret's frame turned back: a world offset from the ring to its t, s - det)
    return { c: Math.cos(t.angle), s: Math.sin(t.angle), rx, ry, tfx, tfy, tnx, tny, det: tfx * tny - tfy * tnx, bx, by, L, gdx, gdy, glen,
      gux: glen > 1e-6 ? gdx / glen : 0, guy: glen > 1e-6 ? gdy / glen : 0, gear: null,
      turn: round ? turnFrame(art, t.turning / TURN) : null, ring: round && toward > 0.45, toward: round ? toward : 0 };
  }
  // (the box it takes up in the world: its hull and running gear, turret and gun)
  function boxOf(t, P) {
    let x0 = Math.min(P.bx, P.bx + P.gdx), x1 = Math.max(P.bx, P.bx + P.gdx), y0 = Math.min(P.by, P.by + P.gdy), y1 = Math.max(P.by, P.by + P.gdy);
    for (const [u, v] of [[-61, -31], [61, -31], [-61, 9], [61, 9]]) {
      const [wx, wy] = toWorld(t, u, v);
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
    }
    const a = P.turn ? 49 : 37, b = P.turn ? 49 : 31;
    for (const [u, v] of [[-a, -18], [b, -18], [-a, 1], [b, 1]]) {
      const wx = P.rx + u * P.tfx + v * P.tnx, wy = P.ry + u * P.tfy + v * P.tny;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
    }
    return [x0, y0, x1, y1];
  }
  // The colour of tank t at world point (wx, wy) in pose P (0: none of it there), its part left in
  // PART: the gun, the turret, the hull, the running gear. Where a round struck it, it is scarred.
  const GUN = 1, TURRET = 2, HULL = 3, RUNNING = 4;
  let PART = 0;
  function pixel(t, P, wx, wy) {
    const { art } = t;
    // The gun: a tube from the trunnion, thicker at its fume extractor and its muzzle (seen end-on
    // while the turret turns, its muzzle's ring).
    const gx = wx - P.bx, gy = wy - P.by, L = P.L, glen = P.glen;
    // (pointing out at us as it turns: its muzzle's ring, the bore dark in it)
    if (P.ring) {
      const mx = gx - P.gdx, my = gy - P.gdy, m2 = mx * mx + my * my;
      if (m2 <= 10.5) { PART = GUN; return m2 <= 3.2 ? BORE : my < 0 ? art.barrelL : art.barrelD; }
    }
    const along = gx * P.gux + gy * P.guy, across = gx * P.guy - gy * P.gux;
    const f = glen > 1e-6 ? along / glen * L : 0;
    if (along >= -2 && along <= glen) {
      // (and as it comes round towards us, its muzzle end the nearer, the bigger)
      const near = P.toward > 0 && glen > 1e-6 ? 1 + 0.55 * P.toward * Math.max(0, along / glen) : 1;
      const half = (f > L * 0.4 && f < L * 0.4 + 9 ? 2.5 : f > L - 3 ? 2 : 1.6) * near;
      if (across >= -half && across <= half) { PART = GUN; return across < -half + 1 ? art.barrelL : across > half - 1 ? art.barrelD : art.barrelC; }
    }
    if (glen < 6 && gx * gx + gy * gy <= 6.25) { PART = GUN; return gx * gx + gy * gy <= 1.5 ? art.barrelD : art.barrelC; }
    // The turret, on its ring, facing its way.
    const rdx = wx - P.rx, rdy = wy - P.ry;
    const tt = Math.floor((rdx * P.tny - rdy * P.tnx) / P.det), ts = Math.floor((rdy * P.tfx - rdx * P.tfy) / P.det);
    let col = at(P.turn || art.turret, tt, ts);
    if (col) { PART = TURRET; return t.scars.length && !P.turn ? scarred(t, col, TURRET, tt, ts) : col; }
    // The hull and its running gear, along the ground under it.
    const dx = wx - t.x, dy = wy - t.y;
    const u = Math.floor(dx * P.c + dy * P.s), v = Math.floor(dy * P.c - dx * P.s);
    col = at(art.hull, u, v);
    if (col) { PART = HULL; return t.scars.length ? scarred(t, col, HULL, u, v) : col; }
    const gu = u - GEAR.u0, gv = v - GEAR.v0;
    if (gu >= 0 && gv >= 0 && gu < GEAR.w && gv < GEAR.h) {
      if (!P.gear) P.gear = gearOf(t);
      col = P.gear[gv * GEAR.w + gu];
      if (col) { PART = RUNNING; return col; }
    }
    PART = 0;
    return 0;
  }
  // (a scar where a round struck: the paint burnt off round it, black at its heart - kept in its
  // own part's frame, so it moves and turns with it)
  function scarred(t, col, part, a, b) {
    for (const sc of t.scars) {
      if (sc[0] !== part) continue;
      const d2 = (a - sc[1]) * (a - sc[1]) + (b - sc[2]) * (b - sc[2]), r = sc[3];
      if (d2 > r * r) continue;
      const k = d2 < r * r * 0.3 ? 0.25 : 0.55 + 0.1 * (PW.hash2(a, b) & 3);
      return PW.abgr((col & 255) * k, (col >>> 8 & 255) * k, (col >>> 16 & 255) * k);
    }
    return col;
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
      const P = poseOf(t);
      let [x0, y0, x1, y1] = boxOf(t, P);
      x0 = Math.max(Math.floor(x0 - 4), Math.floor(vx0)); x1 = Math.min(Math.ceil(x1 + 4), Math.ceil(vx1));
      y0 = Math.max(Math.floor(y0 - 4), Math.floor(vy0)); y1 = Math.min(Math.ceil(y1 + 4), Math.ceil(vy1));
      if (x1 <= x0 || y1 <= y0) continue;
      const iw = Math.ceil((x1 - x0) / skip), ih = Math.ceil((y1 - y0) / skip);
      if (!canvas || canvas.width < iw || canvas.height < ih) {
        const cw = Math.ceil(Math.max(iw, canvas ? canvas.width : 0) / 128) * 128, ch = Math.ceil(Math.max(ih, canvas ? canvas.height : 0) / 128) * 128;
        canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        ctx2 = canvas.getContext('2d'); image = ctx2.createImageData(cw, ch); px32 = new Uint32Array(image.data.buffer);
      }
      const stride = canvas.width;
      for (let j = 0; j < ih; j += 1) {
        const wy = y0 + j * skip + 0.5, row = j * stride;
        px32.fill(0, row, row + iw);
        for (let i = 0; i < iw; i += 1) {
          const col = pixel(t, P, x0 + i * skip + 0.5, wy);
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

  // ---- Fighting (N77) -------------------------------------------------------------------------------
  // Its gun fires the round it has loaded (PW.shots: an armour-piercing dart, 'ap', or a
  // high-explosive shell, 'he'), laid by its fire control (see lay); it reloads in RELOAD. What it
  // takes - a round striking its own pixels, a blast in reach - comes off its armour: a dart that
  // strikes it takes 60 of its 100 (less on its tracks, little on its gun), a high-explosive shell
  // its hit and its burst, a missile nearly all; a rifle bullet only sparks off it. Hurt, it smokes
  // from its engine deck and goes slower; badly hurt it burns. When its armour is gone it is
  // destroyed: its ammunition goes up - its turret blown off its ring and thrown, if what killed
  // it went in hard - and what is left of it, burnt black, falls as a wreck: rigid pieces (see
  // pw-fragments) that come to rest as ruin - part of the ground, its shape and its burnt colours
  // still its own, as a building's ruins are - burning a while, its smoke hanging over the place
  // long after; the town's crews clear it in time, as any ruin.
  function fire(world, t) {
    if (!t || t.dead || t.reload > 0 || t.turning || t.falling || !PW.shots) return null;
    const m = muzzle(t);
    const shot = PW.shots.fire(world, { kind: t.ammo, x: m.x, y: m.y, dx: m.dx, dy: m.dy, side: t.side, from: t, spread: 0.002 });
    t.reload = RELOAD; t.recoil = RECOIL;
    // (its recoil: the round's momentum, the other way - the hull rocks back on its tracks)
    if (!t.tipping) t.v -= t.facing * Math.cos(t.elevation) * 9;
    PW.shots.report(world, m.x, m.y, m.dx, m.dy, 6);
    return shot;
  }
  // (what a round meets of it: its own pixels as drawn - see pixel)
  const target = {
    hit(world, s, x0, y0, x1, y1) {
      const list = world.tanks;
      if (!list || !list.length) return null;
      let best = null;
      const sx = x1 - x0, sy = y1 - y0, len2 = sx * sx + sy * sy;
      for (const t of list) {
        if (t.dead || t === s.from) continue;
        // (near it at all: within its reach - hull, turret and gun - of its middle)
        const mx = t.x + Math.sin(t.angle) * 16, my = t.y - Math.cos(t.angle) * 16;
        const f0 = len2 ? Math.max(0, Math.min(1, ((mx - x0) * sx + (my - y0) * sy) / len2)) : 0;
        if (Math.hypot(x0 + sx * f0 - mx, y0 + sy * f0 - my) > 110) continue;
        const P = poseOf(t), n = Math.max(1, Math.ceil(Math.sqrt(len2)));
        for (let q = 0; q <= n; q += 1) {
          const f = q / n;
          if (best && f >= best.f) break;
          if (pixel(t, P, x0 + sx * f, y0 + sy * f)) { best = { f, x: x0 + sx * f, y: y0 + sy * f, ref: t, part: PART }; break; }
        }
      }
      return best;
    },
    strike(world, t, s, x, y, part) {
      const share = part === GUN ? 0.25 : part === RUNNING ? 0.6 : 1, dmg = (s.k.damage || 0) * share;
      if (dmg > 0) scar(t, x, y, part, s.k.blast ? 5 : 3);
      else if (PW.shots && PW.shots.spark) PW.shots.spark(world, x, y, -s.vx * 0.05, -s.vy * 0.05, 3);
      hurt(world, t, dmg, s.kind);
      return true;
    },
  };
  // (a scar where it was struck, kept in its part's own frame: see scarred)
  function scar(t, x, y, part, r) {
    let a, b;
    if (part === TURRET || part === GUN) {
      const P = poseOf(t), rdx = x - P.rx, rdy = y - P.ry;
      a = (rdx * P.tny - rdy * P.tnx) / P.det; b = (rdy * P.tfx - rdx * P.tfy) / P.det;
      part = TURRET;
    } else {
      const dx = x - t.x, dy = y - t.y, c = Math.cos(t.angle), s = Math.sin(t.angle);
      a = dx * c + dy * s; b = dy * c - dx * s;
      part = HULL;
    }
    t.scars.push([part, a, b, r]);
    if (t.scars.length > 10) t.scars.shift();
  }
  function hurt(world, t, amount, cause) {
    if (t.dead || !(amount > 0)) return;
    t.hp -= amount;
    t.hurtBy = cause;
    if (t.hp <= 0) destroy(world, t, cause);
  }
  // A blast (PW.explode) hurts the tanks in its reach - the nearer its hull and the harder, the more
  // - and a heavy one close by throws one.
  function blast(world, cx, cy, r, power = 1) {
    const list = world.tanks;
    if (!list || !list.length) return;
    for (const t of list) {
      if (t.dead) continue;
      // (how far from its hull: the blast in the hull's frame, to the nearest of its box)
      const dx = cx - t.x, dy = cy - t.y, c = Math.cos(t.angle), s = Math.sin(t.angle);
      const u = dx * c + dy * s, v = dy * c - dx * s;
      const du = Math.max(0, Math.abs(u) - 60), dv = Math.max(0, v - 2, -t.art.height - v);
      const d = Math.hypot(du, dv), reach = r * 1.6 + 6;
      if (d >= reach) continue;
      const k = power * (1 - d / reach);
      if (k > 0.9 && !t.falling) {
        t.falling = true; t.tipping = false;
        t.vy = -Math.min(300, 220 * (k - 0.7));
        t.v += Math.sign(t.x - cx || 1) * 80 * (k - 0.7);
      }
      const cu = Math.max(-58, Math.min(58, u)), cv = Math.max(-t.art.height + 12, Math.min(-2, v));
      if (k > 0.3) scar(t, t.x + cu * c - cv * s, t.y + cu * s + cv * c, HULL, Math.min(9, 2 + r * 0.35));
      hurt(world, t, 55 * k * k + (d < 1 ? 15 * power : 0), 'blast');
    }
  }
  // Destroyed: its ammunition goes up, its turret thrown off or burnt out where it sits, and the
  // rest falls as its wreck.
  const burnt = (c, x, y) => {
    const h = PW.hash2(x, y), k = 0.3 + ((h >>> 3) & 7) / 50;
    // (now and then a fleck of rust and burnt-through paint)
    if ((h & 15) < 3) return PW.abgr(70 + (h >>> 8 & 31), 40 + (h >>> 13 & 15), 26);
    return PW.abgr(Math.min(255, (c & 255) * k + 16), Math.min(255, (c >>> 8 & 255) * k + 14), Math.min(255, (c >>> 16 & 255) * k + 12));
  };
  let wreckN = 0;
  function destroy(world, t, cause) {
    t.dead = true; t.hp = 0;
    if (held === t) held = null;
    const P = poseOf(t), [bx0, by0, bx1, by1] = boxOf(t, P);
    const { mat, width: W, height: H } = world;
    const hull = { x: [], y: [], c: [] }, top = { x: [], y: [], c: [] };
    // (it went in hard - a dart, a missile, a heavy blast: its turret goes up off its ring)
    const toss = cause === 'ap' || cause === 'missile' || (cause === 'blast' && (PW.hash2(t.x | 0, wreckN) & 1) === 0);
    for (let y = Math.max(1, Math.floor(by0) - 2); y <= Math.min(H - 2, Math.ceil(by1) + 2); y += 1) {
      for (let x = Math.max(1, Math.floor(bx0) - 2); x <= Math.min(W - 2, Math.ceil(bx1) + 2); x += 1) {
        const col = pixel(t, P, x + 0.5, y + 0.5);
        if (!col || !PW.mat.open[mat[y * W + x] & ID_MASK]) continue;
        const into = toss && (PART === GUN || PART === TURRET) ? top : hull;
        into.x.push(x); into.y.push(y); into.c.push(burnt(col, x, y));
      }
    }
    // (the cook-off, at its turret ring)
    if (PW.explode) PW.explode(world, world.particles, { x: P.rx, y: P.ry - 3, radius: 7, power: 0.6 });
    const data = (l) => {
      const n = l.x.length;
      return { x: Int32Array.from(l.x), y: Int32Array.from(l.y), color: Uint32Array.from(l.c), byte: new Uint8Array(n).fill(M.STEEL), solid: new Uint8Array(n).fill(1) };
    };
    const fr = world.fragments, h = PW.hash3(t.x | 0, t.y | 0, ++wreckN), r1 = (h & 1023) / 1023, r2 = (h >>> 10 & 1023) / 1023;
    if (fr) {
      // (thrown up a few metres - and on by the cook-off's own blast - and off to one side, landing
      // 10 to 20 m away, as a turret blown off its ring does)
      const side = r1 < 0.5 ? -1 : 1;
      if (top.x.length) fr.spawn({ data: data(top), vx: t.v * 0.4 + side * (60 + r2 * 60), vy: -(170 + r2 * 90), omega: side * (2 + r2 * 3), wreck: true });
      if (hull.x.length) fr.spawn({ data: data(hull), vx: t.v * 0.5, vy: Math.min(-30, t.vy || 0), omega: 0, wreck: true });
    }
    // (burning a while, its smoke hanging over the place long after)
    (world.wrecks || (world.wrecks = [])).push({ x: t.x, y: t.y, width: 70, left: BURN_OUT, acc: 0, n: 0 });
    if (PW.addSmoulder) PW.addSmoulder(world, t.x, t.y - 2, 60, 44);
    stats.destroyed += 1;
  }
  // (a wreck's fire: flames out of the top of it, dying down, each leaving a pixel of soot)
  function stepWrecks(world, dt) {
    const list = world.wrecks, particles = world.particles, F = PW.PARTICLE;
    for (let q = list.length - 1; q >= 0; q -= 1) {
      const w = list[q];
      w.left -= dt;
      if (w.left <= 0) { list.splice(q, 1); continue; }
      if (!particles || !F) continue;
      w.acc += dt * 70 * (w.left / BURN_OUT);
      while (w.acc >= 1) {
        w.acc -= 1; w.n += 1;
        const h = PW.hash3(w.x | 0, w.n, 31), ox = ((h & 1023) / 1023 - 0.5) * w.width, r1 = ((h >>> 10) & 255) / 255;
        const x = Math.round(w.x + ox);
        let y = Math.round(w.y), up = 0;
        while (up < 48 && y > 1 && !PW.mat.open[PW.get(world, x, y) & ID_MASK]) { y -= 1; up += 1; }
        if (up >= 48) continue;
        particles.spawn(x + 0.5, y + 0.5, ox * 0.3, -40 - r1 * 50, 0, PW.abgr(48, 45, 43, 210), F.FIRE, 0.35 + r1 * 0.6);
      }
    }
  }
  // (hurt: smoke from its engine deck, at its back - grey, then black with flames as it burns)
  let fumeN = 0;
  function fume(world, t, dt) {
    const particles = world.particles, F = PW.PARTICLE;
    if (!particles || !F) return;
    const burning = t.hp < BURNS;
    t.fumes += dt * (burning ? 40 : 4 + 14 * (1 - t.hp / SMOKES));
    const [ex, ey] = toWorld(t, t.rear * 38, t.art.ring[1] - 2);
    while (t.fumes >= 1) {
      t.fumes -= 1;
      const h = PW.hash3(t.x | 0, t.y | 0, ++fumeN), jx = ((h & 255) / 255 - 0.5) * 14, r1 = ((h >>> 8) & 255) / 255;
      if (burning && (h >>> 16 & 3)) particles.spawn(ex + jx, ey - 1, jx * 2, -30 - r1 * 40, 0, PW.abgr(52, 49, 47, 200), F.FIRE, 0.35 + r1 * 0.5);
      else {
        const g = burning ? 58 + (h >>> 20 & 15) : 118 + (h >>> 20 & 31);
        particles.spawn(ex + jx, ey - 2, jx, -14 - r1 * 16, 0, PW.abgr(g, g - 3, g - 6, 200), F.SMOKE | F.THIN, 3 + r1 * 4);
      }
    }
  }
  const stats = { destroyed: 0 };

  // ---- By hand (a toolbar's TANK tool) -------------------------------------------------------------------
  // A click drops a tank on the ground under it - open ground, a road or a bridge, not a roof -
  // each side's in turn, and takes it in hand; with a tank in hand a click lays its gun on that
  // spot, a click on the tank lets it go (its gun back to level ahead), and a shift-click drops
  // another. A / D or the arrow keys drive it left or right, S or the down arrow stops it; F fires
  // its gun, R loads the other round (high-explosive, armour-piercing).
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
  // (a selection takes a tank in hand - the one the keys drive and a click aims - or, null, lets
  // the one in hand go, its gun back to level ahead)
  function hold(t) {
    if (held && held !== t) aimAt(held, null);
    held = t && !t.dead ? t : null;
    return held;
  }
  function key(event) {
    if (!held || held.dead || event.repeat) return false;
    const k = event.code;
    if (k === 'KeyA' || k === 'ArrowLeft') drive(held, -1);
    else if (k === 'KeyD' || k === 'ArrowRight') drive(held, 1);
    else if (k === 'KeyS' || k === 'ArrowDown') drive(held, 0);
    else if (k === 'KeyF') fire(current || (window.pwApp && window.pwApp.world), held);
    else if (k === 'KeyR') { held.ammo = held.ammo === 'he' ? 'ap' : 'he'; held.reload = Math.max(held.reload, RELOAD / 2); }
    else return false;
    return true;
  }

  PW.tanks = { create, step, draw, drive, aimAt, muzzle, settle, ahead, explain, tool, key, hold, held: () => held, reach, gatesOf, STYLES: Object.keys(STYLES),
    fire, hurt, blast, target, stats, poseOf, pixel, part: () => PART, PARTS: { GUN, TURRET, HULL, RUNNING },
    VMAX, ACCEL, GUN_UP, GUN_DOWN, MAX_SLOPE, STEP, SPRING_UP, SPRING_DOWN, TURN, RELOAD, ARMOUR };
})();
