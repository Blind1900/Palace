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
// A tank drives left or right only, reaching its top speed in 1.5 s, slower uphill - crawling up
// the steepest. It climbs slopes up to MAX_SLOPE - a mountainside, a flight of stairs - and steps up
// to STEP cells (a real one's vertical step, about a metre). It will not go into a wall, a tunnel
// (it has no room there), deep water or over a drop; and where the ground is blown away from under
// it, it tips over the edge and falls.
// It drives right through its own side's buildings (N3, N72): all of them over their grade - walls,
// floors, stairs, piers - are nothing to it; it meets only the roads, the ground and a building's
// floor at grade, which bears it. An enemy's buildings, and ruins, it rams (N72, N77): what its hull
// meets is crushed and thrown on ahead, trees and street furniture knocked down, and it grinds on
// through, slowed by what it crushes; the building takes the push and, pushed over more than its
// storeys hold, goes over the way the tank drives (see pw-structure). Loose debris it drives over
// is flattened under its tracks into a hard layer of rubble.
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
  const CLIMB = 0.75;           // of its top speed it loses climbing, by the sine of the slope
  const MAX_SLOPE = 43;         // degrees it climbs, at most - a mountainside, a flight of stairs (the user's)
  const STEP = 15;              // cells it climbs straight up at most (an Abrams' vertical step, 1.07 m)
  const DROP = 16;              // cells it goes down straight at most (it stops at a higher edge)
  const LOOK = 96;              // cells ahead of its leading wheel it looks at the ground (room to brake, and
                                // to tell a slope a degree over MAX_SLOPE: a cell in 60)
  const NOSE = 60;              // cells from its middle its nose and lower plate reach, and a little
  const DEEP = 26;              // cells of water it fords at most
  // In water (N82; see wade): what of its hull is under the surface bears its weight off its tracks
  // and drags on it.
  const BUOY = 0.8;             // of its weight a hull wholly under water has borne off its tracks
  const WATER_DRAG = 2;         // /s: how hard water running past its hull drags it along, wholly under
  const WADE_SLOW = 0.55;       // of its top speed it loses wholly under water
  const GRIP = 84;              // cells/s^2 its tracks hold against a push, on dry ground (0.6 g)
  const FLOW = 60;              // cells/s a body of water on the move runs at (pw-sim's surge)
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
    // (its side's paint at cell (t, s), lit by `light`: its camouflage, the machine gun, its army's
    // marking, a T-64's reactive armour - the turret's look from every side: see turnFrame)
    const turretColour = (t, s, light) => {
      let c = camoAt(st, t, s), k = light;
      if (t >= 1 && t <= 8 && s === -12) { c = [40, 40, 42]; k = 1; }          // (the machine gun)
      if (st.cross && t >= -16 && t <= -6 && s >= -8 && s <= -2 && (t === -11 || t === -12 || s === -5)) { c = [222, 222, 214]; k = 1; }
      if (st.star && t >= -14 && t <= -10 && s >= -7 && s <= -3 && Math.abs(t + 12) + Math.abs(s + 5) <= 2) { c = [196, 44, 36]; k = 1; }
      if (st.era && t >= 12 && s >= -10 && s <= -2) c = (t - 12) % 4 === 0 || (s + 10) % 3 === 0 ? st.dark : ERA;
      return rgb(c, k);
    };
    const turret = sprite(-36, -17, 30, 0, (t, s) => inPoly(shape, t, s) || (t >= -9 && t <= 0 && s >= -12 && s <= -10) || (t >= 1 && t <= 8 && s >= -12.5 && s <= -11.5)
      || (t >= 15 && t <= 24 && s >= -9 && s <= -3), turretColour);
    // (road wheels evenly along the hull; a sprocket at one end and the idler at the other, the
    // same, raised; small return rollers under the belt's top run)
    const wheels = Array.from({ length: st.wheels }, (_, k) => -st.span + (2 * st.span) * k / (st.wheels - 1));
    a = { style, st, hull, turret, turretColour, shape: st.turret ? shape : null, wheels, R: WHEEL, sprocket: [-52, -9, 6], idler: [52, -9, 6], rollers: [-30, 0, 30].map((u) => [u, -13, 1.5]),
      trunnion: [20, -6], barrel: st.barrel, ring: [0, -deck + 1], height: deck + 11, nose: NOSE - st.span,
      barrelC: rgb(st.base, 0.95), barrelD: rgb(st.dark, 0.85), barrelL: rgb(st.base, 1.18) };
    ART.set(style, a);
    return a;
  }

  // ---- A tank on the ground ----------------------------------------------------------------------------
  // (what bears a tank: the ground, rubble and what is built - not water, smoke or cover, which it
  // passes like a trooper does, at another depth)
  const { phase, passable, hardness } = PW.mat, POWDER = PW.PHASE.POWDER;
  const isSupport = (m) => { const id = m & ID_MASK; return phase[id] >= POWDER && !passable[id]; };
  // A building's gate piers (N3): kept by column, x -> [y0, y1, side, kind, building, ...], made
  // again when the buildings change (and every second). A building's side: its faction. (For the
  // vehicle lanes' probes: a tank passes all of its own side's buildings now - see meets.)
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
  // What a tank meets, cell by cell (N3, N72). Its own side's buildings it drives through as if they
  // were not there - all of them over their grade (b.ground): walls, floors, stairs, piers - meeting
  // only the roads and the ground, and a building's floor at grade, which bears it. An enemy's
  // building over its grade, and a ruin, it rams (see ram): no support for it, nor in its way - they
  // are crushed as its hull meets them - unless harder than RAM_HARD (a reinforced lining, a core:
  // they stop it). What a building is set into the ground with, beside its body - the retaining wall
  // of a cut into a hill, the steps up out of its forecourt (pw-foundations) - is ground to every
  // tank: it climbs those steps as it would the hill they hold back. Loose debris it flattens (see
  // flatten): no support either - its tracks press down through it to the ground.
  const RAM_HARD = 0.65;
  const CRUSHED = new Uint8Array(64);
  for (const id of [M.DEBRIS, M.LOOSE_SOIL, M.LOOSE_STONE, M.ASH]) CRUSHED[id] = 1;
  const PLAIN = 0, GHOST = 1, RAMS = 2, FLAT = 3;
  // (what cell (x, y), of stuff m, is to tank t: PLAIN - an ordinary cell; GHOST - its own side's
  // building; RAMS - to be crushed; FLAT - loose debris to press down)
  function meets(world, t, x, y, m) {
    const id = m & ID_MASK;
    if (CRUSHED[id]) return FLAT;
    if (id === M.RUIN) return RAMS;
    const o = PW.getOwner(world, x, y);
    if (o <= 0 || o >= 50000) return PLAIN;
    const b = world.buildings && world.buildings[o - 1];
    if (!b || !(y < b.ground) || !b.body || x < b.body.left || x > b.body.right) return PLAIN;
    if (t && t.side && (b.faction || b.side) === t.side) return GHOST;
    return id !== M.CORE && hardness[id] <= RAM_HARD ? RAMS : PLAIN;
  }
  // (does cell (x, y) bear tank t, or stand in its way?)
  const solidFor = (world, t, x, y, m) => isSupport(m) && (!t || meets(world, t, x, y, m) === PLAIN);
  // (the top of what can bear a tank in column x, from `from`: the top of the ground `from` is in -
  // looked for up as far as it climbs and a little more, a wall higher than that given as that
  // height - or, `from` in the open, the ground under it, down as far as it might go; -1 if nothing)
  function surface(world, x, from, t) {
    const { mat, width: W, height: H } = world;
    if (x < 1 || x >= W - 1) return -1;
    const f = Math.max(1, Math.min(H - 1, Math.round(from))), y0 = Math.max(1, f - STEP - 4), y1 = Math.min(H - 1, f + 120);
    const bears = (y) => solidFor(world, t, x, y, mat[y * W + x]);
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
  let tankN = 0;
  function create(world, spec) {
    const art = artOf(spec.style || 'modern'), facing = spec.facing || 1;
    const x = spec.x, y = spec.y ?? world.groundTop[Math.round(x)];
    const t = { kind: 'tank', art, style: art.style, side: spec.side || null, x, y, facing, angle: 0, spin: 0,
      v: 0, vy: 0, drive: 0, travel: 0, falling: false, tipping: false, blocked: '', dead: false,
      springs: new Float32Array(art.wheels.length), contact: new Uint8Array(art.wheels.length),
      target: null, elevation: 0, turning: 0,
      hp: ARMOUR, ammo: spec.ammo || 'he', reload: 0, recoil: 0, rear: -facing, scars: [], fumes: 0, hurtBy: '',
      holes: null, chipped: 0, seed: ++tankN, wet: 0, flow: 0, swept: 0 };
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
  // ground too steep (see below); a drop; too little room over it (a tunnel, an overhang); deep
  // water. ('' if nothing; t.room is then how far it can still go, its nose short of it.) For the
  // probes, each look leaves on the tank where it stopped it: t.stopAt [column, ground there, why]
  // and, for 'no room', t.stopCell - the cell over that ground in its way (see explain).
  // Too steep: its tracks laid on the ground from any column to one further on, as a plank would lie
  // - resting on it there, nothing between standing over it - rising more than a STEP, and steeper
  // than MAX_SLOPE. So a flight of stairs is as steep as the line along its nosings, where its
  // tracks bear, not its risers; a kerb or a step up to STEP high it climbs, but not a bank higher
  // than that and steeper than MAX_SLOPE, nor a slope as steep as that from the top of a kerb (its
  // hull would lie steeper than it climbs, its tail below the kerb). (Ground drawn in cells is a
  // cell off its line at most: its rise is allowed that.)
  const SLACK = 1;
  const HS = new Float64Array(LOOK + 1);
  // (carried: borne along by a current, deep water ahead does not stop it - it is in it)
  function ahead(world, t, dir, carried = false) {
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
      // (back from here: `least` the shallowest of the lines to here from the columns between - a
      // plank from column j lies on the ground there if no steeper than that)
      for (let j = k - 1, least = Infinity; j >= 0; j -= 1) {
        const rise = HS[j] - h, s = k - j;
        if (rise <= least * s + 1e-9 && rise > STEP && rise > s * tanMax + SLACK) {
          // (it stops at the foot of that rise - a slope drawn in cells rises with a level cell
          // here and there)
          while (j > 0 && (HS[j - 1] > HS[j] || (j > 1 && HS[j - 1] === HS[j] && HS[j - 2] > HS[j - 1]))) j -= 1;
          return stop(j, 'too steep');
        }
        least = Math.min(least, rise / s);
      }
      // (room for its height over its tracks: no tunnel, no overhang - its own side's buildings, and
      // what it rams or flattens, aside: see meets)
      for (let up = 1; up <= t.art.height && h - up >= 0; up += 1) {
        if (solidFor(world, t, x, h - up, mat[(h - up) * W + x])) { t.stopCell = [x, h - up]; return stop(k, 'no room'); }
        if (up <= 4 && (PW.getFlags(world, x, h - up) & PW.FLAG.TUNNEL)) return stop(k, 'tunnel');
      }
      let water = 0;
      while (water <= DEEP && h - water - 1 >= 0 && (mat[(h - water - 1) * W + x] & ID_MASK) === M.WATER) water += 1;
      if (water > DEEP && !carried) return stop(k, 'deep water');
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
  // Ramming (N72, N77): as it drives, what of an enemy's building or a ruin its hull's leading edge
  // meets - from its tracks to its roof - is crushed, thrown on ahead of it as debris (pw-fragments'
  // crush), and the trees and street furniture there are knocked down (its sweep). Each cell crushed
  // costs it speed by the cell's hardness, so it grinds through a wall and drives on in the room
  // beyond; and the building feels the push - the tank's weight driving on, the way it goes - on
  // the storeys it strikes, as it feels a flood's: pushed harder than they hold, they give and what
  // is over them goes over that way (see pw-structure).
  const RAM_COST = 0.9;         // cells/s of its speed a cell crushed costs it, by the cell's hardness
  const RAM_PUSH = 9000;        // the push on a building it drives into (as pw-structure weighs a flood's): a
                                // farm's storeys hold some 6000-7800 against it, a tower's 11000-16000 - the
                                // one goes over the way it drives, the other stands, its ground floor smashed
  const RAM_SWEEPS = 24;        // trees' and furniture's cells it knocks down a tick, at most
  function ram(world, t) {
    const fr = world.fragments, dir = Math.sign(t.v);
    if (!fr || !fr.crush || !dir) return;
    const { mat, width: W, height: H } = world, v0 = Math.abs(t.v), hit = new Map();
    let sweeps = 0;
    for (let u = dir * 56; Math.abs(u) <= 62; u += dir) for (let v = -t.art.height; v <= 6; v += 1) {
      const [wx, wy] = toWorld(t, u, v), x = Math.floor(wx), y = Math.floor(wy);
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const m = mat[y * W + x];
      // (a tree, a lamp, a railing - not its own side's)
      if (sweeps < RAM_SWEEPS && fr.sweep && PW.getLayer(world, 'deco', x, y) && meets(world, t, x, y, m) !== GHOST && !(PW.getFlags(world, x, y) & PW.FLAG.FIXTURE)) { fr.sweep(x, y, 8); sweeps += 1; }
      if (!isSupport(m) || meets(world, t, x, y, m) !== RAMS) continue;
      const o = PW.getOwner(world, x, y);
      fr.crush(x, y, o, x - dir * 60);
      t.v -= dir * hardness[m & ID_MASK] * RAM_COST;
      t.rammed = (t.rammed || 0) + 1;
      if (o > 0 && o < 50000) { const r = hit.get(o); if (r) { r.y0 = Math.min(r.y0, y); r.y1 = Math.max(r.y1, y); } else hit.set(o, { y0: y, y1: y }); }
    }
    if (Math.sign(t.v) !== dir) t.v = 0;
    // (driving into it, it pushes with all its tracks' grip, however slowly it grinds on; rolling
    // on into it, with what its speed carries)
    const push = t.drive === dir ? RAM_PUSH : RAM_PUSH * v0 / VMAX;
    for (const [o, r] of hit) {
      const b = world.buildings[o - 1];
      if (b) b.ram = { at: world.tick || 0, dir, push, y0: r.y0, y1: r.y1 };
    }
  }
  // Loose debris under it - a heap of rubble, spoil, ash in its way - is pressed down under its
  // tracks as it drives over it: what lies in its hull's way and under it down to the ground is
  // gone, and what was there is left on the ground a third as deep, packed hard as rubble in its
  // own colours; the way it has come is flat. (Each column once: what is left is no longer loose.)
  // Only what is over the ground there: where its hull dips into the ground - its tail, nose-up on
  // a slope - what is under that ground is not its to press (scree under a crust of rock).
  const PRESS_DEEP = 40;        // cells under its tracks it presses loose debris down through, at most
  function flatten(world, t) {
    const { mat, width: W, height: H } = world, c = Math.cos(t.angle), s = Math.sin(t.angle);
    let pressed = 0;
    for (let u = -56; u <= 56; u += 1) {
      const x = Math.round(t.x + u * c), yl = Math.round(t.y + u * s);
      if (x < 1 || x >= W - 1) continue;
      // (the ground under its track there: the top of what bears it, under any loose heap)
      const floor = surface(world, x, yl, t);
      if (floor < 0 || floor - yl > PRESS_DEEP) continue;
      let n = 0, paint = 0;
      for (let y = Math.max(1, yl - t.art.height); y < floor; y += 1) {
        if (!CRUSHED[mat[y * W + x] & ID_MASK]) continue;
        if (!paint) paint = PW.getLayer(world, 'paint', x, y);
        PW.set(world, x, y, M.AIR);
        n += 1;
      }
      if (!n) continue;
      pressed += n;
      // (packed down onto that ground)
      for (let k = 1, m = Math.ceil(n / 3); k <= m && floor - k > 1; k += 1) {
        if (isSupport(mat[(floor - k) * W + x])) break;
        PW.set(world, x, floor - k, M.RUBBLE | (PW.hash2(x, floor - k) & 3) << 6);
        if (paint) PW.setLayer(world, 'paint', x, floor - k, paint);
      }
    }
    if (pressed) t.flattened = (t.flattened || 0) + pressed;
  }
  // Troopers in its way as it drives (see pw-troops): its own side's step aside as it passes - out of
  // the picture's plane, as on a road, untouched; the other side's it runs down, by its speed (a tank
  // at a walk hurts a man, one at speed kills him).
  const RUN_DOWN = 6;           // of a trooper's 100, for each cell/s of the tank's speed
  function runOver(world, t) {
    const list = world.troops, U = PW.troops;
    if (!list || !list.length || !U) return;
    const P = poseOf(t);
    for (const u of list) {
      if (u.dead || u.buried || (t.side && u.side === t.side) || Math.abs(u.x - t.x) > 70 || u.y < t.y - 45 || u.y > t.y + 8) continue;
      // (any of its body against the hull or the tracks: a few points down its middle)
      let hit = false;
      for (let k = 0; k < U.HEIGHT && !hit; k += 4) for (const ox of [-U.HALF, 0, U.HALF - 1]) if (pixel(t, P, u.x + ox, u.y - k)) { hit = true; break; }
      if (!hit) continue;
      U.hurt(world, u, Math.abs(t.v) * RUN_DOWN, 'run over');
      u.vx = t.v; u.vy = -30;
    }
  }
  // How deep it wades: the share of its hull's box under water (t.wet), and the way and speed the
  // water there runs (t.flow, cells/s: pw-sim's moving water, left or right - still water none).
  // Wading, it grips the ground the less, drives slower, and a current pushes it along once the
  // water drags harder than its tracks hold: a tank fords a flood up to its hull's waist, and one
  // caught deep in it is carried off (see stepOne).
  const WATER_MOVING = 0x80, WATER_RIGHT = 0x40;   // (pw-sim's flags on a water cell)
  function wade(world, t) {
    const { mat, width: W, height: H } = world, c = Math.cos(t.angle), sn = Math.sin(t.angle);
    // (dry under its belly, and dry before: no water about it - water reaches it from below)
    if (!t.wet) {
      let any = false;
      for (let u = -56; u <= 56 && !any; u += 28) {
        const x = (t.x + u * c + 2 * sn) | 0, y = (t.y + u * sn - 2 * c) | 0;
        any = x > 0 && y > 0 && x < W && y < H && (mat[y * W + x] & ID_MASK) === M.WATER;
      }
      if (!any) { t.flow = 0; return; }
    }
    let n = 0, wet = 0, flow = 0;
    for (let u = -56; u <= 56; u += 8) for (let v = -t.art.height + 2; v <= -2; v += 4) {
      const x = (t.x + u * c - v * sn) | 0, y = (t.y + u * sn + v * c) | 0;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      n += 1;
      const m = mat[y * W + x];
      if ((m & ID_MASK) !== M.WATER) continue;
      wet += 1;
      if (m & WATER_MOVING) flow += m & WATER_RIGHT ? FLOW : -FLOW;
    }
    t.wet = n ? wet / n : 0;
    t.flow = wet ? flow / wet : 0;
  }
  function step(world, dt) {
    // (the rounds in flight - until the world's loop steps them itself - and the tanks among what
    // they can strike)
    if (PW.shots) { PW.shots.addTarget(target); if (!PW.shots.looped) PW.shots.step(world, dt); }
    // (and the troopers - until the world's loop steps them itself: see pw-troops)
    if (PW.troops && !PW.troops.looped) PW.troops.step(world, dt);
    if (PW.jets && !PW.jets.looped) PW.jets.step(world, dt);
    if (PW.defence && !PW.defence.looped) PW.defence.step(world, dt);
    if (PW.mechs && !PW.mechs.looped) PW.mechs.step(world, dt);
    // (and what each does on its own - its orders, its sentry: see pw-units)
    if (PW.units && !PW.units.looped) PW.units.step(world, dt);
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
    wade(world, t);
    const grip = 1 - BUOY * t.wet;
    // (its tracks off the ground, or all but one wheel: it does not drive)
    if (t.falling || t.tipping) { t.v = 0; t.blocked = ''; } else {
      // Driving: on to its top speed either way (less, uphill, and less as it is hurt - its engine
      // smoking, burning - and as it wades), braking to a stop before it goes the other way; and
      // braking in time for what stops it ahead, its nose short of it.
      const lame = t.hp < BURNS ? 0.45 : t.hp < SMOKES ? 0.8 : 1;
      const want = t.drive * VMAX * lame * (1 - CLIMB * Math.max(0, -t.drive * Math.sin(t.angle))) * (1 - WADE_SLOW * t.wet);
      t.blocked = want ? ahead(world, t, Math.sign(want)) : '';
      let goal = want;
      if (t.blocked) {
        const room = Math.max(0, t.room), safe = Math.sqrt(2 * BRAKE * grip * room);
        if (Math.abs(goal) > safe) goal = room < 1 ? 0 : Math.sign(want) * safe;
      }
      if (t.v !== goal) {
        const braking = t.v !== 0 && (Math.sign(goal) !== Math.sign(t.v) || Math.abs(goal) < Math.abs(t.v));
        const a = (braking ? BRAKE : ACCEL) * grip * dt;   // (its tracks drive and brake by what they grip)
        let v = goal > t.v ? Math.min(goal, t.v + a) : Math.max(goal, t.v - a);
        if (braking && Math.sign(v) === -Math.sign(t.v)) v = 0;       // (it stops before it goes the other way)
        t.v = v;
      }
      // (a current pushes it along its tracks, once it pushes harder than they grip)
      if (t.flow && t.wet > 0) {
        const push = WATER_DRAG * t.wet * (t.flow * Math.cos(t.angle) - t.v), hold = GRIP * grip;
        if (Math.abs(push) > hold) {
          t.v += (push - Math.sign(push) * hold) * dt;
          t.swept = (t.swept || 0) + dt;
          // (carried the way it is not driving, it still meets what is in its way there)
          if (t.v && Math.sign(t.v) !== Math.sign(want) && ahead(world, t, Math.sign(t.v), true)) t.v = Math.sign(t.v) * Math.min(Math.abs(t.v), Math.sqrt(2 * BRAKE * grip * Math.max(0, t.room)));
        }
      }
    }
    // (falling through water, borne up and slowed by it)
    if (t.falling && t.wet > 0) t.vy -= (G * BUOY + WATER_DRAG * Math.max(0, t.vy)) * t.wet * dt;
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
      // (driving: what it rams is crushed, what it drives over flattened)
      if (Math.abs(t.v) > 0.5) { ram(world, t); flatten(world, t); runOver(world, t); }
    }
    aim(t, dt);
    // (a click's round - see click: fired once the turret is round to the mark and the gun laid on
    // it and loaded - or let go, never laid in TRIGGER_FOR)
    if (t.trigger > 0) {
      t.trigger -= dt;
      if (t.laid && t.reload <= 0 && !t.turning) { fire(world, t, t.triggerKind); t.trigger = 0; }
      else if (t.trigger <= 0) t.trigger = 0;
    }
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
    const k = PW.shots && PW.shots.KINDS[(t.trigger > 0 && t.triggerKind) || t.ammo];   // (the round about to go: see click)
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
    t.laid = false;
    if (side === t.facing && !t.turning) {
      const [lo, hi] = reach(t, side);
      want = Math.max(lo, Math.min(hi, want));
      const d = want - t.elevation, s = SLEW * dt;
      t.elevation += Math.abs(d) <= s ? d : Math.sign(d) * s;
      // (on its mark - or as near as its reach of the hull lets it)
      t.laid = !!t.target && Math.abs(d) <= s;
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
  // ---- The turret, and its turning round (N71, N72; the user's photos of tanks seen head-on) ---------
  // The turret is one solid, drawn as it is seen from the side at every angle it is turned to - its
  // side view the first of them, so what turns is the very turret you saw from the side (N72: the
  // user's screenshots, a side sprite that did not look attached to the turning one). Turning to face
  // the other way it swings round through the eye, as a real one turns to lay its gun: half way it
  // faces us - its gun pointing out of the picture, the muzzle's dark bore ringed, the mantlet in the
  // middle of a turret near as wide as the hull, its front and a side in sight - while the hull and
  // tracks under it stay just as they were. The solid: its plan (its half-width along it - PLAN), its
  // side's profile over that, chamfered or rounded across, and its mantlet, cupola and machine gun
  // where they stand on it; seen at each step of a half turn (TURN_FRAMES of them, made once for each
  // army's turret), painted as its side is (turretColour: its camouflage, its machine gun, its army's
  // marking, a T-64's reactive armour), its faces lit as they face: its roof lightest, its side,
  // its front darker, its back darker still.
  const TURN_FRAMES = 24;
  const PLAN = {
    modern: (t) => (t <= 14 ? 24 : Math.max(0, 24 - (t - 14) * 0.45)),     // (the Abrams: slab sides, its front cut back)
    asian: (t) => (t <= 0 ? 23 : Math.max(0, 23 - t * 0.36)),               // (the Type 99: an arrowhead wedge)
    gothic: (t) => 21 * Math.sqrt(Math.max(0, 1 - (t / 26) ** 2)),          // (the T-64: a round dome)
  };
  const BORE = PW.abgr(14, 14, 16);
  // (the turret as a solid, cell by cell - t along it, w across it (toward the eye at the start of a
  // turn), s down - 0 nothing, 1 its body, 2 the mantlet, 3 the cupola, 4 the machine gun: made once
  // for each army's turret, a layer (s) at a time - `layers` at most this call: made ahead, a layer a
  // tick)
  const G3 = { t0: -40, w0: -27, s0: -18, nt: 81, nw: 55, ns: 19 };
  function solidOf(art, layers = G3.ns) {
    if (art.solid3) return art.solid3;
    let b = art.solidBuild;
    const { t0, w0, s0, nt, nw, ns } = G3;
    if (!b) {
      // (its side's profile: which cells of each column are inside its outline, and its top)
      const inside = new Uint8Array(nt * ns), top = new Float32Array(nt).fill(1);
      if (art.shape) for (let i = 0; i < nt; i += 1) for (let k = 0; k < ns; k += 1) {
        if (!inPoly(art.shape, t0 + i + 0.5, s0 + k + 0.5)) continue;
        inside[k * nt + i] = 1;
        if (top[i] > 0) top[i] = s0 + k + 0.5;
      }
      b = art.solidBuild = { inside, top, grid: new Uint8Array(nt * nw * ns), k: 0 };
    }
    const plan = PLAN[art.style] || PLAN.modern;
    for (let n = 0; n < layers && b.k < ns; n += 1, b.k += 1) {
      const k = b.k, s = s0 + k + 0.5;
      for (let j = 0; j < nw; j += 1) {
        const w = w0 + j + 0.5;
        for (let i = 0; i < nt; i += 1) {
          const t = t0 + i + 0.5;
          let v = 0;
          if (t >= 15 && t <= 24 && Math.abs(w) <= 6 && s >= -9 && s <= -3) v = 2;
          else if (t >= -9 && t <= 0 && w >= 4 && w <= 12 && s >= -12 && s <= -10) v = 3;
          else if (t >= 1 && t <= 8 && w >= 6 && w <= 7.5 && s >= -12.5 && s <= -11.5) v = 4;
          else if (!art.shape) v = (t / 26) ** 2 + (w / 21) ** 2 + (s / 11.5) ** 2 <= 1 ? 1 : 0;
          // (chamfered along its roof's edges: its top rows narrower)
          else if (b.inside[k * nt + i]) v = Math.abs(w) <= plan(t) - Math.max(0, b.top[i] + 3 - s) * 1.3 ? 1 : 0;
          b.grid[(k * nw + j) * nt + i] = v;
        }
      }
    }
    if (b.k < ns) return null;
    art.solidBuild = null;
    art.solidTop = b.top;
    return (art.solid3 = b.grid);
  }
  // (the turret turned by th from the way it faced - 0 its side view - seen from the side: a sprite
  // in the turret's own frame, t along the way it faced, s down)
  function makeTurnFrame(art, th) {
    const { st } = art, c = Math.cos(th), sn = Math.sin(th), grid = solidOf(art), plan = PLAN[art.style] || PLAN.modern;
    const solid = (t, w, s) => {
      const i = Math.floor(t) - G3.t0, j = Math.floor(w) - G3.w0, k = Math.floor(s) - G3.s0;
      return i < 0 || j < 0 || k < 0 || i >= G3.nt || j >= G3.nw || k >= G3.ns ? 0 : grid[(k * G3.nw + j) * G3.nt + i];
    };
    const x0 = -48, x1 = 48, y0 = -18, y1 = 0, w = x1 - x0 + 1, h = y1 - y0 + 1;
    // (and how near the eye each of its pixels is - D, out towards the eye - for its gun: see pixel)
    const px = new Uint32Array(w * h), kind = new Uint8Array(w * h), depth = new Float32Array(w * h);
    for (let y = y0; y <= y1; y += 1) {
      const s = y + 0.5;
      for (let x = x0; x <= x1; x += 1) {
        const X = x + 0.5;
        // (along the line of sight from the eye inwards: the first of it met, and which of its faces
        // that is - its roof, a side, its front or its back - by the solid's own shape there)
        for (let D = 42; D >= -42; D -= 0.5) {
          const t = X * c + D * sn, wv = -X * sn + D * c;
          const ti = Math.floor(t), wi = Math.floor(wv);
          const k = solid(t, wv, s);
          if (!k) continue;
          let face;
          if (art.shape) {
            const top = art.solidTop[Math.max(0, Math.min(G3.nt - 1, ti - G3.t0))];
            const across = plan(t) - Math.max(0, top + 3 - s) * 1.3;
            face = s <= top + 1 ? 'roof' : Math.abs(wv) >= across - 1.2 ? 'side' : t > 0 ? 'front' : 'back';
          } else {
            // (a dome: the way its surface faces there)
            const nt = Math.abs(t) / 676, nw = Math.abs(wv) / 441, ns = Math.abs(s) / 132;
            face = ns > nt && ns > nw && s < -7 ? 'roof' : nw >= nt ? 'side' : t > 0 ? 'front' : 'back';
          }
          let col;
          if (k === 2) col = rgb(camoAt(st, wi, y), 0.8);                    // (the mantlet)
          else if (k === 3) col = art.turretColour(ti, y, 1.06);              // (the cupola)
          else if (k === 4) col = rgb([40, 40, 42]);                          // (the machine gun)
          else if (face === 'roof') col = rgb(camoAt(st, ti, wi), 1.16);      // (its roof)
          else {
            // (its side, painted and lit as it always was)
            if (face === 'side') col = art.turretColour(ti, y, 1 - (y + 17) / 18 * 0.18);
            else if (face === 'front') {
              // (its front - the reactive armour's blocks on a T-64's, in rows across it)
              const fw = wi + 40, fs = y + 30;
              col = st.era && t >= 8 ? rgb(fw % 5 === 0 || fs % 3 === 0 ? st.dark : ERA, 0.92) : rgb(camoAt(st, wi, y), 0.86);
            } else col = rgb(camoAt(st, wi, y), 0.76);                         // (its back)
          }
          px[(y - y0) * w + x - x0] = col; kind[(y - y0) * w + x - x0] = 1; depth[(y - y0) * w + x - x0] = D;
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
    return { x0, y0, x1, y1, w, h, px: out, depth };
  }
  function turnFrame(art, f) {
    const q = Math.max(0, Math.min(TURN_FRAMES, Math.round(f * TURN_FRAMES)));
    const frames = art.turnFrames || (art.turnFrames = []);
    return frames[q] || (frames[q] = makeTurnFrame(art, Math.PI * q / TURN_FRAMES));
  }
  // (made ahead, a frame a tick, once a tank of an army is out: ready before it first turns)
  function warmFrames(art) {
    if (art.warm) return;
    if (!art.solid3 && !solidOf(art, 4)) return;
    const frames = art.turnFrames || (art.turnFrames = []);
    for (let q = 0; q <= TURN_FRAMES; q += 1) if (!frames[q]) { frames[q] = makeTurnFrame(art, Math.PI * q / TURN_FRAMES); return; }
    art.warm = true;
  }

  // A tank's pose as it is drawn - its turret turned as far round as it is (turnFrame), the gun's
  // line, run back after a round - for its drawing, for what a round strikes of it, and for the wreck
  // it leaves: one look, cell for cell, in all three.
  function poseOf(t) {
    const { art } = t;
    // (the gun seen shortened as the turret turns, by all of it - half way, pointing out at us, its
    // bore ringed, its muzzle end the nearer)
    const k = turnOf(t);
    const [rx, ry] = ringAt(t), [tfx, tfy, tnx, tny] = turretFrame(t, 1), [bx, by] = muzzleBase(t, k);
    const L = art.barrel - (t.recoil > 0 ? KICK * t.recoil / RECOIL : 0), gdx = t.facing * k * Math.cos(t.elevation) * L, gdy = -Math.sin(t.elevation) * L;
    const glen = Math.hypot(gdx, gdy), toward = t.turning > 0 ? Math.sin(Math.PI * t.turning / TURN) * Math.cos(t.elevation) : 0;
    // (the turret's frame turned back: a world offset from the ring to its t, s - det)
    return { c: Math.cos(t.angle), s: Math.sin(t.angle), rx, ry, tfx, tfy, tnx, tny, det: tfx * tny - tfy * tnx, bx, by, L, gdx, gdy, glen,
      gux: glen > 1e-6 ? gdx / glen : 0, guy: glen > 1e-6 ? gdy / glen : 0, gear: null,
      turn: turnFrame(art, t.turning / TURN), turned: t.turning > 0, ring: toward > 0.45, toward, sn: Math.sin(Math.PI * t.turning / TURN) };
  }
  // (the box it takes up in the world: its hull and running gear, turret and gun)
  function boxOf(t, P) {
    let x0 = Math.min(P.bx, P.bx + P.gdx), x1 = Math.max(P.bx, P.bx + P.gdx), y0 = Math.min(P.by, P.by + P.gdy), y1 = Math.max(P.by, P.by + P.gdy);
    for (const [u, v] of [[-61, -31], [61, -31], [-61, 9], [61, 9]]) {
      const [wx, wy] = toWorld(t, u, v);
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
    }
    for (const [u, v] of [[-49, -18], [49, -18], [-49, 1], [49, 1]]) {
      const wx = P.rx + u * P.tfx + v * P.tnx, wy = P.ry + u * P.tfy + v * P.tny;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
    }
    return [x0, y0, x1, y1];
  }
  // The colour of tank t at world point (wx, wy) in pose P (0: none of it there), its part left in
  // PART: the gun, the turret, the hull, the running gear. Where a round struck it, it is scarred.
  const GUN = 1, TURRET = 2, HULL = 3, RUNNING = 4;
  let PART = 0;
  // (the gun at (wx, wy): a tube from the trunnion, thicker at its fume extractor and its muzzle -
  // seen end-on while the turret turns, its muzzle's ring. GUN_D: how near the eye it is there, as
  // the turret's frames measure it: the trunnion t along the turret, and on along the gun)
  let GUN_D = 0;
  function gunAt(t, P, wx, wy) {
    const { art } = t;
    const gx = wx - P.bx, gy = wy - P.by, L = P.L, glen = P.glen;
    // (pointing out at us as it turns: its muzzle's ring, the bore dark in it)
    if (P.ring) {
      const mx = gx - P.gdx, my = gy - P.gdy, m2 = mx * mx + my * my;
      if (m2 <= 10.5) { GUN_D = (art.trunnion[0] + L * Math.cos(t.elevation)) * P.sn; return m2 <= 3.2 ? BORE : my < 0 ? art.barrelL : art.barrelD; }
    }
    const along = gx * P.gux + gy * P.guy, across = gx * P.guy - gy * P.gux;
    const f = glen > 1e-6 ? along / glen * L : 0;
    GUN_D = (art.trunnion[0] + Math.max(0, f) * Math.cos(t.elevation)) * P.sn;
    if (along >= -2 && along <= glen) {
      // (and as it comes round towards us, its muzzle end the nearer, the bigger)
      const near = P.toward > 0 && glen > 1e-6 ? 1 + 0.55 * P.toward * Math.max(0, along / glen) : 1;
      const half = (f > L * 0.4 && f < L * 0.4 + 9 ? 2.5 : f > L - 3 ? 2 : 1.6) * near;
      if (across >= -half && across <= half) return across < -half + 1 ? art.barrelL : across > half - 1 ? art.barrelD : art.barrelC;
    }
    if (glen < 6 && gx * gx + gy * gy <= 6.25) return gx * gx + gy * gy <= 1.5 ? art.barrelD : art.barrelC;
    return 0;
  }
  function pixel(t, P, wx, wy) {
    const { art } = t;
    // The turret, on its ring, facing its way, turned as far round as it is; and its gun, coming out
    // of its mantlet - whichever is the nearer the eye there: the gun's root is inside the turret,
    // out of sight, and the turret turned round towards us has the gun in front of it.
    const rdx = wx - P.rx, rdy = wy - P.ry;
    const tt = Math.floor((rdx * P.tny - rdy * P.tnx) / P.det), ts = Math.floor((rdy * P.tfx - rdx * P.tfy) / P.det);
    let col = at(P.turn, tt, ts);
    const gun = gunAt(t, P, wx, wy);
    // (what is chipped off it is not there: see chip)
    if (col && t.holes && !P.turned && t.holes.turret[(ts - P.turn.y0) * P.turn.w + tt - P.turn.x0]) col = 0;
    if (gun && (!col || GUN_D >= P.turn.depth[(ts - P.turn.y0) * P.turn.w + tt - P.turn.x0] - 0.5)) { PART = GUN; return gun; }
    if (col) { PART = TURRET; return t.scars.length && !P.turned ? scarred(t, col, TURRET, tt, ts) : col; }
    // The hull and its running gear, along the ground under it.
    const dx = wx - t.x, dy = wy - t.y;
    const u = Math.floor(dx * P.c + dy * P.s), v = Math.floor(dy * P.c - dx * P.s);
    col = at(art.hull, u, v);
    if (col && t.holes && t.holes.hull[(v - art.hull.y0) * art.hull.w + u - art.hull.x0]) col = 0;
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
  // its hit and its burst, a missile nearly all; a rifle bullet only sparks off it. Hurt, it is
  // chipped away as a building is (see chip), smokes from its engine deck and goes slower; badly
  // hurt it burns. When its armour is gone it is destroyed: its fuel and ammunition go up in a
  // burst of flame and smoke - no blast, only fire (see cookOff) - its turret thrown off its ring,
  // if what killed it went in hard - and what is left of it, burnt black, falls as a wreck: rigid pieces (see
  // pw-fragments) that come to rest as ruin - part of the ground, its shape and its burnt colours
  // still its own, as a building's ruins are - burning a while, its smoke hanging over the place
  // long after; the town's crews clear it in time, as any ruin.
  // (`kind`: the round to fire this once, if not the one it has up - see click)
  function fire(world, t, kind = null) {
    if (!t || t.dead || t.reload > 0 || t.turning || t.falling || !PW.shots) return null;
    const m = muzzle(t);
    const shot = PW.shots.fire(world, { kind: kind || t.ammo, x: m.x, y: m.y, dx: m.dx, dy: m.dy, side: t.side, from: t, spread: 0.002 });
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
      if (dmg > 0) {
        scar(t, x, y, part, s.k.blast ? 5 : 3);
        // (a bite out of its plate where it struck, thrown on the way the round went)
        if (part !== GUN && part !== RUNNING) chipAt(world, t, x, y, part, 1.2 + Math.sqrt(dmg) * 0.55, s.vx * 0.15, s.vy * 0.15);
      } else if (PW.shots && PW.shots.spark) PW.shots.spark(world, x, y, -s.vx * 0.05, -s.vy * 0.05, 3);
      hurt(world, t, dmg, s.kind);
      return true;
    },
  };
  // (where world point (x, y) is in a part's own frame: its turret's - t along it, s down - or its
  // hull's - u along it, v down)
  function partFrame(t, x, y, part) {
    if (part === TURRET || part === GUN) {
      const P = poseOf(t), rdx = x - P.rx, rdy = y - P.ry;
      return [TURRET, (rdx * P.tny - rdy * P.tnx) / P.det, (rdy * P.tfx - rdx * P.tfy) / P.det];
    }
    const dx = x - t.x, dy = y - t.y, c = Math.cos(t.angle), s = Math.sin(t.angle);
    return [HULL, dx * c + dy * s, dy * c - dx * s];
  }
  // (a scar where it was struck, kept in its part's own frame: see scarred)
  function scar(t, x, y, part, r) {
    const [p, a, b] = partFrame(t, x, y, part);
    t.scars.push([p, a, b, r]);
    if (t.scars.length > 10) t.scars.shift();
  }
  // Chipped, as a building's walls are (N77): what strikes it bites its plate away - a ragged hole
  // where a round went in, a bite out of its edge where a blast caught it - and as it is hurt more
  // its edges are chipped away all over, its skirts, fenders and bustle racks first: how much of it
  // is gone shows how near it is to going up. A chip is gone from it - the round, the eye and its
  // wreck all see the hole (see pixel) - and its bits of plate are thrown off as metal debris. (The
  // holes are kept in each part's own frame: its hull's, and its turret's as seen side on - a
  // turret part way round, turning, shows them again when it has turned.)
  const CHIP_EVERY = 4;         // armour's worth of hurt a chip off its edges takes (25 by the time it goes up)
  const METAL_DEBRIS = M.DEBRIS | PW.DEBRIS_KIND.METAL << 6;
  // (a part's sprite and its holes: its hull's, or its turret's side on)
  function partOf(t, part) {
    const s = part === TURRET ? turnFrame(t.art, 0) : t.art.hull;
    const holes = t.holes || (t.holes = { hull: new Uint8Array(t.art.hull.w * t.art.hull.h), turret: new Uint8Array(turnFrame(t.art, 0).w * turnFrame(t.art, 0).h) });
    return [s, part === TURRET ? holes.turret : holes.hull];
  }
  // (the world point of (a, b) in a part's frame - see partFrame)
  function partPoint(t, part, a, b) {
    if (part === TURRET) { const P = poseOf(t); return [P.rx + a * P.tfx + b * P.tnx, P.ry + a * P.tfy + b * P.tny]; }
    return toWorld(t, a, b);
  }
  // (bite a ragged hole of radius r out of a part at (a, b) in its frame, its bits thrown off with
  // (fx, fy) on what flings them out from the hole; the number of its cells gone)
  function chip(world, t, part, a, b, r, fx = 0, fy = 0) {
    const [s, holes] = partOf(t, part), particles = world.particles, F = PW.PARTICLE;
    let n = 0;
    for (let y = Math.floor(b - r - 1); y <= Math.ceil(b + r + 1); y += 1) for (let x = Math.floor(a - r - 1); x <= Math.ceil(a + r + 1); x += 1) {
      if (x < s.x0 || y < s.y0 || x > s.x1 || y > s.y1) continue;
      const k = (y - s.y0) * s.w + (x - s.x0);
      if (!s.px[k] || holes[k]) continue;
      const h = PW.hash3(x + t.seed * 131, y, part), dx = x + 0.5 - a, dy = y + 0.5 - b, d = Math.hypot(dx, dy);
      if (d > r * (0.65 + (h & 15) / 25)) continue;
      holes[k] = 1;
      n += 1;
      if (particles && F && (h >>> 4 & 1) === 0) {
        const [wx, wy] = partPoint(t, part, x + 0.5, y + 0.5), out = 30 + (h >>> 5 & 63);
        particles.spawn(wx, wy, fx + (dx / (d || 1)) * out, fy + (dy / (d || 1)) * out - 20, METAL_DEBRIS, s.px[k], F.LAND, 6);
      }
    }
    return n;
  }
  // (a chip where world point (x, y) struck a part)
  function chipAt(world, t, x, y, part, r, fx, fy) {
    const [p, a, b] = partFrame(t, x, y, part);
    return chip(world, t, p, a, b, r, fx, fy);
  }
  // (each part's edge cells, as its sprite has them: where it is chipped as it is worn down)
  function edgesOf(s) {
    if (s.edges) return s.edges;
    const e = [];
    for (let y = s.y0; y <= s.y1; y += 1) for (let x = s.x0; x <= s.x1; x += 1) {
      const k = (y - s.y0) * s.w + (x - s.x0);
      if (!s.px[k]) continue;
      if (x === s.x0 || x === s.x1 || y === s.y0 || y === s.y1 || !s.px[k - 1] || !s.px[k + 1] || !s.px[k - s.w] || !s.px[k + s.w]) e.push(x, y);
    }
    return (s.edges = Int32Array.from(e));
  }
  // (worn down to its armour's worth left: a chip off its edges for each CHIP_EVERY of it gone -
  // three of each four off its hull, the fourth off its turret - thrown out from its middle)
  function wear(world, t) {
    const due = Math.floor((ARMOUR - Math.max(0, t.hp)) / CHIP_EVERY);
    while (t.chipped < due) {
      t.chipped += 1;
      const h = PW.hash3(t.seed, t.chipped, 97), part = (h & 3) === 3 ? TURRET : HULL;
      const e = edgesOf(part === TURRET ? turnFrame(t.art, 0) : t.art.hull), j = ((h >>> 2) % (e.length >> 1)) * 2;
      const [wx, wy] = partPoint(t, part, e[j] + 0.5, e[j + 1] + 0.5);
      chip(world, t, part, e[j] + 0.5, e[j + 1] + 0.5, 2 + (h >>> 12 & 7) / 3.5, (wx - t.x) * 0.6, -20);
    }
  }
  function hurt(world, t, amount, cause) {
    if (t.dead || !(amount > 0)) return;
    t.hp -= amount;
    t.hurtBy = cause;
    if (t.hp <= 0) destroy(world, t, cause);
    else wear(world, t);
  }
  // Struck by falling debris (N82; see pw-fragments): a piece of a building, a tree, a wreck coming
  // down on it. Only a heavy or a fast one dents its armour - by its momentum against the tank's,
  // over what its plate shrugs off - and bites its plate where it struck; a heavy one shoves it a
  // little along its tracks. What struck it glances off it (pw-fragments' side).
  const SHRUG = 60000;          // momentum (cells of mass x cells/s) its plate takes without a dent: a
                                // tree coming down on it, a lump of a wall off a roof
  const DENT = 5000;            // momentum to each of its armour's points a harder blow takes (a slab of
                                // 600 cells off a storey up takes some 20; one of 2000, 60)
  const TANK_MASS = 6000;       // its mass, in the pieces' cells (a 60 t tank against a cell's 10 kg)
  // (the part of a live tank at world point (x, y), or 0)
  function touches(t, x, y) {
    if (t.dead) return 0;
    pixel(t, poseOf(t), x, y);
    return PART;
  }
  function struck(world, t, x, y, part, mass, vx, vy) {
    const c = Math.cos(t.angle), s = Math.sin(t.angle);
    const rx = vx - t.v * c, ry = vy - t.v * s, blow = mass * Math.hypot(rx, ry);
    t.v += (rx * c + ry * s) * mass / TANK_MASS * 0.5;
    const dmg = Math.min(60, Math.max(0, (blow - SHRUG) / DENT));
    if (dmg <= 0) return 0;
    scar(t, x, y, part, Math.min(6, 2 + dmg * 0.1));
    if (part === HULL || part === TURRET) chipAt(world, t, x, y, part, 1 + Math.sqrt(dmg) * 0.5, rx * 0.1, ry * 0.1);
    hurt(world, t, dmg, 'debris');
    stats.struck = (stats.struck || 0) + 1;
    return dmg;
  }
  // (the blast strength lost between (x0, y0) and (x1, y1): what it passes through, by how much
  // each cell of it takes - PW.mat.blastResist, as pw-explode's own shield)
  function cover(world, x0, y0, x1, y1) {
    const { mat, width: W, height: H } = world, n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    let lost = 0;
    for (let q = 1; q < n; q += 1) {
      const x = Math.floor(x0 + (x1 - x0) * q / n), y = Math.floor(y0 + (y1 - y0) * q / n);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      lost += PW.mat.blastResist[mat[y * W + x] & ID_MASK];
    }
    return lost;
  }
  // A blast (PW.explode) hurts the tanks in its reach - the nearer its hull and the harder, the more,
  // and the less for what cover stands between - and a heavy one close by throws one.
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
      // (the nearest of its hull to the blast - and what stands between, still standing after it:
      // a wall, a bank, a berm takes the blast's strength as it passes, as in the blast itself)
      const cu = Math.max(-58, Math.min(58, u)), cv = Math.max(-t.art.height + 12, Math.min(-2, v));
      const sx = t.x + cu * c - cv * s, sy = t.y + cu * s + cv * c;
      const k = power * (1 - d / reach) - cover(world, cx, cy, sx, sy);
      if (k <= 0) continue;
      if (k > 0.9 && !t.falling) {
        t.falling = true; t.tipping = false;
        t.vy = -Math.min(300, 220 * (k - 0.7));
        t.v += Math.sign(t.x - cx || 1) * 80 * (k - 0.7);
      }
      if (k > 0.3) {
        scar(t, sx, sy, HULL, Math.min(9, 2 + r * 0.35));
        chipAt(world, t, sx, sy, HULL, Math.min(6, 1 + r * 0.25) * k, (sx - cx) * 2, (sy - cy) * 2);
      }
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
    cookOff(world, t, P);
    const data = (l) => {
      const n = l.x.length;
      return { x: Int32Array.from(l.x), y: Int32Array.from(l.y), color: Uint32Array.from(l.c), byte: new Uint8Array(n).fill(M.STEEL), solid: new Uint8Array(n).fill(1) };
    };
    const fr = world.fragments, h = PW.hash3(t.x | 0, t.y | 0, ++wreckN), r1 = (h & 1023) / 1023, r2 = (h >>> 10 & 1023) / 1023;
    if (fr) {
      // (thrown up a few metres by its ammunition going up under it, and off to one side, landing
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
  // Going up (the user's: no blast, an exothermic burst): its fuel and ammunition burn off in a burst
  // of flame and black smoke out of its hatches and engine deck. Nothing is blown out of the ground
  // round it and nothing near it is thrown or hurt by a blast - only its heat, which sets alight what
  // will burn close by (trees, timber, wood rubble): see pw-heat.
  const COOK_REACH = 24;        // cells round its turret ring its burst's heat reaches (about 1.7 m)
  const COOK_HEAT = 760;        // degrees at its heart (wood catches at 380)
  const COOK_FLAMES = 320;      // flame pixels in its burst: a ball of fire rolling up off it
  const COOK_SMOKE = 16;        // cells' radius of the black smoke it billows up in, over its turret
  function cookOff(world, t, P) {
    if (world.heatSystem) world.heatSystem.heatDisc(P.rx, P.ry - 4, COOK_REACH, COOK_HEAT);
    // (its smoke: thick, in the air over it - the world's own smoke, to rise and drift and thin)
    const { mat, width: W, height: H } = world, sx = P.rx, sy = P.ry - COOK_SMOKE - 6;
    for (let y = Math.floor(sy - COOK_SMOKE); y <= sy + COOK_SMOKE; y += 1) for (let x = Math.floor(sx - COOK_SMOKE * 1.3); x <= sx + COOK_SMOKE * 1.3; x += 1) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || (mat[y * W + x] & ID_MASK) !== M.AIR) continue;
      const dx = (x - sx) / 1.3, dy = y - sy, h = PW.hash3(x, y, t.seed);
      if (dx * dx + dy * dy > COOK_SMOKE * COOK_SMOKE * (0.7 + (h & 7) / 20)) continue;
      PW.set(world, x, y, M.SMOKE | (2 + (h >>> 3 & 1)) << 6);
    }
    const particles = world.particles, F = PW.PARTICLE;
    if (!particles || !F) return;
    for (let k = 0; k < COOK_FLAMES; k += 1) {
      const h = PW.hash3(t.seed, k, 53), r1 = (h & 1023) / 1023, r2 = (h >>> 10 & 1023) / 1023, r3 = (h >>> 20 & 1023) / 1023;
      // (out of its turret ring and hatches, and along its engine deck behind)
      const [x, y] = k % 3 ? [P.rx + (r1 - 0.5) * 34, P.ry - 2 - r3 * 6] : toWorld(t, (r1 - 0.5) * 100, t.art.ring[1] - 1);
      const a = -Math.PI / 2 + (r2 - 0.5) * 1.6, sp = 20 + r3 * r3 * 120;
      particles.spawn(x, y, Math.cos(a) * sp * 0.7, Math.sin(a) * sp, 0, PW.abgr(46, 42, 40, 220), F.FIRE, 0.5 + r2 * 1.1);
    }
  }
  // (a wreck's fire: flames out of the top of it, dying down, each leaving a pixel of soot - and its
  // heat, setting alight what will burn against it, a little less as it dies down)
  const WRECK_HEAT_EVERY = 0.5;
  function stepWrecks(world, dt) {
    const list = world.wrecks, particles = world.particles, F = PW.PARTICLE;
    for (let q = list.length - 1; q >= 0; q -= 1) {
      const w = list[q];
      w.left -= dt;
      if (w.left <= 0) { list.splice(q, 1); continue; }
      w.warm = (w.warm || 0) - dt;
      if (w.warm <= 0 && world.heatSystem) {
        w.warm = WRECK_HEAT_EVERY;
        let y = Math.round(w.y) - 2;
        while (y > 1 && Math.round(w.y) - y < 48 && !PW.mat.open[PW.get(world, Math.round(w.x), y) & ID_MASK]) y -= 1;
        world.heatSystem.heatDisc(w.x, y, 14, 400 + 300 * w.left / BURN_OUT);
      }
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
    // (of the side of the buildings nearest it: it drives through them, and rams the other side's)
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
    if (held && held !== t) { release(); aimAt(held, null); }
    held = t && !t.dead ? t : null;
    return held;
  }
  // The keys (N102, the user's controls - the key layer that hands them on is WGM's): A / D or the
  // arrows drive it while held - let go, it stops; S or Down stops it too; F fires the round it has
  // up, R swaps HE and AP. Each key both ways: pressed (keydown) and let go (keyup).
  let dirs = [];   // (the driving keys held, the last pressed last: it drives the last one's way)
  const keyDir = () => { const d = dirs[dirs.length - 1]; return d === 'L' ? -1 : d === 'R' ? 1 : 0; };
  function release() { if (held && dirs.length) drive(held, 0); dirs = []; }
  function key(event) {
    if (!held || held.dead) return false;
    const k = event.code, up = event.type === 'keyup';
    const dir = k === 'KeyA' || k === 'ArrowLeft' ? 'L' : k === 'KeyD' || k === 'ArrowRight' ? 'R' : null;
    if (dir) {
      dirs = dirs.filter((d) => d !== dir);
      if (!up) dirs.push(dir);
      drive(held, keyDir());
      return true;
    }
    if (up || event.repeat) return false;
    if (k === 'KeyS' || k === 'ArrowDown') { dirs = []; drive(held, 0); }
    else if (k === 'KeyF') fire(current || (window.pwApp && window.pwApp.world), held);
    else if (k === 'KeyR') { held.ammo = held.ammo === 'he' ? 'ap' : 'he'; held.reload = Math.max(held.reload, RELOAD / 2); }
    else return false;
    return true;
  }
  // The mouse (N102): a left click at a spot lays its gun on it and fires the round it has up as
  // soon as the turret is round and the gun laid; a right click is its other fire - the other round
  // (AP with HE up, HE with AP), laid and fired the same way. (True when the one in hand took it.)
  const TRIGGER_FOR = 2.5;      // s a click's round waits to be laid and loaded, at most
  function click(world, x, y, button = 0) {
    const t = held;
    if (!t || t.dead) return false;
    aimAt(t, x, y);
    t.trigger = TRIGGER_FOR + t.reload;   // (still loading: the more it waits)
    t.triggerKind = button === 2 ? (t.ammo === 'he' ? 'ap' : 'he') : null;
    return true;
  }

  PW.tanks = { create, step, draw, drive, aimAt, muzzle, settle, ahead, explain, tool, key, click, release, hold, held: () => held, reach, gatesOf, STYLES: Object.keys(STYLES),
    fire, hurt, blast, target, stats, poseOf, pixel, part: () => PART, PARTS: { GUN, TURRET, HULL, RUNNING }, touches, struck,
    turretFrame: (style, f) => turnFrame(artOf(style), f), TURN_FRAMES,
    VMAX, ACCEL, GUN_UP, GUN_DOWN, MAX_SLOPE, STEP, SPRING_UP, SPRING_DOWN, TURN, RELOAD, ARMOUR };
})();
