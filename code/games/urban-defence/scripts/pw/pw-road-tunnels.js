'use strict';
// Mountain road tunnels (N104, the user's). A road bored through a mountain from the flat ground at one
// foot to the flat ground at the other, tall enough for the whole army - a tank, a mech leaping, a man -
// its two portals opening onto the flats. A different thing from the miners' tunnels (the user's rule):
// those are for men on foot only; this is the vehicles' way through - its road the only tunnel floor
// marked a road (FLAG.ROAD) - and the miners' drifts cross it as they go. Anyone may drive it; the side
// that bored it keeps barricades in it that its own pass and an enemy must run over or blow apart (the
// passing, the ramming and the damage are PS's: world.barricades says where each stands and whose).
//
//   PW.roadTunnels.plan(world, m0, m1)            the way through the mountain [m0, m1]: its portals on the
//                                                 flats, a straight floor line between them, or null + why
//   PW.roadTunnels.build(world, plan, opts)       bored at once (opts.instant: the match's passes), or a
//                                                 box at a time from opts.from's portal as time passes
//   PW.roadTunnels.forMountain(world, x0, x1, o)  planned and built for the mountain [x0, x1] - once a side
//   PW.roadTunnels.step(world, dt)                the bores advance; the barricades are kept
// world.roadTunnels: [{ id, a, b, ya, yb, side, style, net, done, from, barricades, why }]
// world.barricades:  [{ id, tunnel, side, x0, x1, y0, y1 }] (cells the tunnel's network owns)
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;

  const CLEAR = 96;            // open rows over the road: a tank 58, a mech 48 and its leap, a man 25
  const GRADE = 0.45;          // the road's steepest grade (the hulls climb 0.58)
  const FLAT_RUN = 40;         // a portal opens where the land outside has run this far...
  const FLAT_GIVE = 3;         // ...within this many rows of level
  const SEARCH = 900;          // cells out from a flank the flats are looked for
  const MAX_LEN = 2600;        // portal to portal at the most
  const MAX_FILL = 200;        // rows of embankment under the road over a valley at the most
  const COVER = 12;            // rock over the crown below which the road runs in an open cut
  const MOUNTAIN_COVER = 80;   // N144: rock over the crown somewhere along the way, or it is a hill
  const STEP = 16;             // the bore advances a box at a time
  const BORE_RATE = 24;        // cells a second a growing city's bore advances
  const PIPE_UNDER = 18;       // rows under the road the bundle is laid again (clear of the road's bed)
  const PORTAL_THICK = 10;     // the headwall's thickness
  const BARRICADE_W = 70;      // a barricade across the road: jersey blocks and steel hedgehogs (five pieces, 14 apart -
                               // its span covers the last of them: at 64 the end block stood outside it, read as rock)
  const KEEP_EVERY = 5;        // s between looks at the barricades
  const QUIET = 20;            // s with no enemy near before a broken barricade is laid again
  const CONCRETE = [150, 148, 140], CONCRETE_DARK = [112, 110, 104], CONCRETE_LIT = [178, 176, 168];
  const STRIPE = [214, 164, 40], STRIPE_DARK = [40, 40, 44], STEEL = [92, 98, 106], STEEL_DARK = [58, 62, 68];
  const DIG_MARKS = PW.FLAG.TUNNEL | PW.FLAG.CARVED | PW.FLAG.RAW | PW.FLAG.OVERBREAK | PW.FLAG.DEVELOPED;
  let seq = 0, bseq = 0;

  const idAt = (world, x, y) => PW.get(world, x, y) & ID_MASK;
  const rgb = (c) => PW.abgr(c[0] | 0, c[1] | 0, c[2] | 0, 255);
  const works = (world, x, y) => { const o = PW.getOwner(world, x, y); return o > 0 && o < 50000; };
  // (the bundle's own cells - its casing, its lanes, the line's - are never dug nor banked over)
  const bundle = (world, x, y) => idAt(world, x, y) === M.PIPE || (PW.getFlags(world, x, y) & PW.FLAG.HOLLOW) !== 0 || PW.getOwner(world, x, y) >= 60000;
  const wet = (world, x) => idAt(world, x, world.groundTop[x]) === M.WATER;

  // ---- The way through ------------------------------------------------------------------------------
  // From a flank at x, outward (dir away from the mountain), the first stretch of flats: FLAT_RUN of dry
  // land within FLAT_GIVE of level, clear of a building's works where the portal stands. The portal is
  // its end nearest the mountain.
  // A town grown up to the mountain stops the search: the portal opens where the town ends - the road
  // runs on into its street - not out past it among its buildings.
  const builtAt = (world, p) => { for (let y = world.groundTop[p] - CLEAR; y < world.groundTop[p] + 4; y += 4) if (works(world, p, y)) return true; return false; };
  function footOf(world, x, dir) {
    for (let k = 0; k < SEARCH; k += 2) {
      const p = Math.round(x + dir * k);
      if (p < 8 || p > world.width - 9) return null;
      if (builtAt(world, p)) return Math.round(x + dir * Math.max(0, k - 12));
      let lo = Infinity, hi = -Infinity, ok = true;
      for (let j = 0; j <= FLAT_RUN && ok; j += 2) {
        const q = p + dir * j, g = world.groundTop[q];
        if (wet(world, q)) ok = false;
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
      if (!ok || hi - lo > FLAT_GIVE) continue;
      return p;
    }
    return null;
  }
  function plan(world, m0, m1) {
    const a = footOf(world, Math.round(m0), -1), b = footOf(world, Math.round(m1), 1);
    if (a === null || b === null) return { why: 'no flat ground at a foot' };
    if (b - a > MAX_LEN) return { why: `too long (${b - a})` };
    const ya = world.groundTop[a], yb = world.groundTop[b];
    if (Math.abs(yb - ya) > (b - a) * GRADE) return { why: 'too steep between the feet' };
    const floorAt = (x) => Math.round(ya + (yb - ya) * (x - a) / (b - a));
    // N144 (the user's screenshot): a road is bored through a mountain, not a hill - a range whose
    // rock stands no more than the bore's own height over the line is crossed over the top (a hill
    // bored through was all cut and void, a base sitting over the hole)
    let deepest = -Infinity;
    for (let x = a; x <= b; x += 4) deepest = Math.max(deepest, floorAt(x) - CLEAR - world.groundTop[x]);
    if (deepest < MOUNTAIN_COVER && !PW.NO_HILL_PASS) return { why: 'a hill, not a mountain: the road goes over it' };
    for (let x = a; x <= b; x += 2) {
      const f = floorAt(x), g = world.groundTop[x];
      if (g - f > MAX_FILL) return { why: 'a chasm under the line' };
      for (let y = f - CLEAR; y <= f; y += 3) if (idAt(world, x, y) === M.WATER) return { why: 'water over the line' };
    }
    return { a, b, ya, yb, floorAt };
  }

  // ---- Building it ----------------------------------------------------------------------------------
  function build(world, p, opts = {}) {
    if (!p || p.a === undefined || !PW.tunnels) return null;
    const side = opts.side || 'neutral', style = opts.style || 'modern';
    const net = PW.tunnels.createNetwork(world, { side, style, use: 'road', x: p.a, y: p.ya });
    const from = opts.from === 'b' ? 'b' : 'a';
    const t = { id: ++seq, a: p.a, b: p.b, ya: p.ya, yb: p.yb, side, style, net: net.id, from, done: false,
      at: from === 'a' ? p.a : p.b, barricades: [], portals: [], by: opts.by || null, span: null,
      // (a side's own tunnel is barricaded; the match's neutral passes are no one's)
      barricaded: opts.barricades !== false && side !== 'neutral' };
    t.floorAt = p.floorAt;
    // (the walls' art reads its rows from the road under each column - pw-tunnels' typeBack 'road')
    t.span = { x0: p.a, x1: p.b, top: Math.min(p.ya, p.yb) - CLEAR, floor: Math.max(p.ya, p.yb), kind: 'road', type: 'road', floorAt: p.floorAt };
    (world.roadTunnels || (world.roadTunnels = [])).push(t);
    // (the bundle goes through with the road: laid again under its bed, portal to portal, before a
    // cell is dug - a bore cut through it where it climbed the flank)
    if (world.pipes && world.pipes.relayAlong) world.pipes.relayAlong(p.a, p.b, (x) => p.floorAt(x) + PIPE_UNDER);
    portal(world, t, from);
    if (opts.instant) { while (!t.done) advance(world, t, STEP); }
    return t;
  }
  const netOf = (world, t) => PW.tunnels.state(world).networks[t.net - 1];
  // One box of the way: bored where the rock over its crown runs COVER deep, else cut open to the sky
  // (a daylight cut - no lip left hanging over the road), the dips under it banked up; then the road.
  // (done: the column the last box already dug - shared with this one; its cover is the cut's or the
  // bore's now, not the hill's, and read as the hill's it cut every box after the first open to the sky)
  // N132 (the user's, 2026-11-24): a building standing over the line keeps the ground it stands on.
  // The bottom row of a building's works over the road at x (within reach of the dig), or null.
  function worksOver(world, x, f) {
    // (over the road only: a town's foundations and made ground under its street are no roof)
    for (let y = f - 1; y > Math.max(2, f - CLEAR - 420); y -= 1) if (works(world, x, y)) return y;
    return null;
  }
  // Under a building the way is bored, never cut open: the bore's rows only, SKIN rows of ground
  // kept under the building's bottom (its footings, its bed), so it is not left hanging over a pit.
  const SKIN = 6;
  function boreUnder(world, x, f, bottom) {
    for (let y = Math.max(f - CLEAR, bottom + SKIN + 1); y < f; y += 1) {
      if (works(world, x, y) || bundle(world, x, y)) continue;
      const id = idAt(world, x, y);
      if (id === M.AIR || id === M.BEDROCK) continue;
      PW.set(world, x, y, M.AIR, { quiet: true });
      PW.setLayer(world, 'paint', x, y, 0); PW.setLayer(world, 'deco', x, y, 0);
      PW.setFlag(world, x, y, PW.FLAG.TUNNEL, true);
    }
  }
  function dig(world, t, x0, x1, done = null) {
    const net = netOf(world, t);
    let fLow = -Infinity, fHigh = Infinity, cover = Infinity;
    for (let x = x0; x <= x1; x += 1) { const f = t.floorAt(x); fLow = Math.max(fLow, f); fHigh = Math.min(fHigh, f); }
    const top = fHigh - CLEAR;
    for (let x = x0; x <= x1; x += 1) if (x !== done) cover = Math.min(cover, top - world.groundTop[x]);
    // (the columns a building stands over: bored under it by hand, whatever the cover)
    const built = new Map();
    if (!PW.NO_BORE_UNDER) for (let x = x0; x <= x1; x += 1) { const lo = worksOver(world, x, t.floorAt(x)); if (lo !== null) built.set(x, lo); }
    if (built.size) {
      for (const [x, lo] of built) boreUnder(world, x, t.floorAt(x), lo);
      const rest = [];
      for (let x = x0; x <= x1; x += 1) if (!built.has(x)) rest.push(x);
      // (the rest of the box as it would have been, a run at a time)
      for (let i = 0; i < rest.length;) {
        let j = i;
        while (j + 1 < rest.length && rest[j + 1] === rest[j] + 1) j += 1;
        dig(world, t, rest[i], rest[j], done);
        i = j + 1;
      }
      if (PW.settlementTools && PW.settlementTools.paveStreet) for (const x of built.keys()) PW.settlementTools.paveStreet(world, x, x, (q) => t.floorAt(q), () => t.style);
      return;
    }
    if (cover >= COVER) {
      const r = PW.tunnels.digBox(world, net, x0, top, x1, fLow - 1, { kind: 'drift', exact: true });
      if (r && r.segment) { r.segment.type = 'road'; r.segment.span = t.span; }
      // (the box is dug to its lowest floor; where the road runs a row or two higher in it, the road
      // bed is laid back under it - the road is paved on ground, never over a gap)
      for (let x = x0; x <= x1; x += 1) {
        for (let y = t.floorAt(x); y < fLow; y += 1) {
          if (PW.mat.phase[idAt(world, x, y)] > PW.PHASE.GAS) continue;
          PW.set(world, x, y, M.FOUNDATION, { quiet: true });
          PW.setFlag(world, x, y, PW.FLAG.TUNNEL, false);
        }
      }
    } else {
      for (let x = x0; x <= x1; x += 1) {
        const f = t.floorAt(x);
        for (let y = f - 1, air = 0; y >= 2 && air < 14; y -= 1) {
          if (works(world, x, y)) break;
          if (bundle(world, x, y)) continue;
          const id = idAt(world, x, y);
          // (a bored box beside the cut marks rock past its sides for the lining crews - overbreak;
          // cut to the sky, that mark goes too, or the crews cast a wall of lining across the road)
          const g = PW.getFlags(world, x, y) & DIG_MARKS;
          if (g) PW.setFlag(world, x, y, g, false);
          // (the broken-out rock is open already - it is not the sky the cut climbs to)
          if (id === M.AIR) { if (!g) air += 1; continue; }
          air = 0;
          if (id === M.BEDROCK) continue;
          PW.set(world, x, y, M.AIR, { quiet: true });
          PW.setLayer(world, 'paint', x, y, 0); PW.setLayer(world, 'deco', x, y, 0);
        }
      }
    }
    // (banked up where the ground falls away under the line: made ground, never a building's)
    for (let x = x0; x <= x1; x += 1) {
      const f = t.floorAt(x);
      for (let y = f; y < world.groundTop[x] + 1 && y < world.height - 2; y += 1) {
        const id = idAt(world, x, y);
        if (works(world, x, y) || bundle(world, x, y) || (id !== M.AIR && id !== M.WATER)) continue;
        PW.set(world, x, y, M.FOUNDATION, { quiet: true });
      }
    }
    if (PW.settlementTools && PW.settlementTools.paveStreet) PW.settlementTools.paveStreet(world, x0, x1, (x) => t.floorAt(x), () => t.style);
    for (let x = x0; x <= x1; x += 1) PW.refreshGroundTop(world, x, Math.max(0, t.floorAt(x) - CLEAR - 40));
    // N132 (the user's): the ground the works leave is the land's surface from now on - the growth
    // seats its lots on world.surface0, and read as the hill that was there before the cut and the
    // banking, the lots by a portal stood raised on plinths over the road's level (a building's own
    // columns aside: they keep the ground they were laid on)
    if (world.surface0) for (let x = x0; x <= x1; x += 1) if (!builtAt(world, x)) world.surface0[x] = world.groundTop[x];
  }
  // The bore goes on `cells` from where it stands, a box at a time; through, the far portal and the
  // barricades go in.
  function advance(world, t, cells) {
    if (t.done) return;
    const dir = t.from === 'a' ? 1 : -1, end = t.from === 'a' ? t.b : t.a;
    // (the bore's pace: a box when a box's worth has been earned)
    t.earned = (t.earned || 0) + cells;
    while (t.earned >= STEP && !t.done) {
      const x0 = t.at, x1 = dir > 0 ? Math.min(end, t.at + STEP) : Math.max(end, t.at - STEP);
      dig(world, t, Math.min(x0, x1), Math.max(x0, x1), t.started ? x0 : null);
      t.started = true;
      t.earned -= STEP;
      t.at = x1;
      if (t.at === end) {
        t.done = true;
        portal(world, t, t.from === 'a' ? 'b' : 'a');
        if (t.barricaded) barricades(world, t);
      }
    }
  }

  // ---- The portals --------------------------------------------------------------------------------
  // Where the cut meets the hill: a concrete headwall from the crown up to the slope over it - the
  // portal's face, retaining the ground above the mouth - with a crown beam over the mouth, a hazard
  // band along it and a lamp either side. At the first column from that end where the rock over the
  // crown runs deep enough to bore; none where the whole way is an open cut.
  function portal(world, t, end) {
    const dir = end === 'a' ? 1 : -1, x0 = end === 'a' ? t.a : t.b, x1 = end === 'a' ? t.b : t.a;
    let px = null;
    for (let x = x0; (x - x1) * dir <= 0; x += dir * 2) {
      if (t.floorAt(x) - CLEAR - world.groundTop[x] >= COVER) { px = x; break; }
    }
    if (px === null) return;
    const net = netOf(world, t), owner = net ? net.owner : 0;
    const top = t.floorAt(px) - CLEAR;
    for (let k = 0; k < PORTAL_THICK; k += 1) {
      const x = px + dir * k;
      const g = Math.min(world.groundTop[x], top - 2);
      // (the face: from the slope down to the crown beam)
      for (let y = Math.max(2, g - 2); y < top; y += 1) {
        const beam = y >= top - 8, band = y === top - 8 || y === top - 7;
        const c = band ? (((x + y) >> 2) & 1 ? STRIPE : STRIPE_DARK) : beam ? (y === top - 1 ? CONCRETE_DARK : CONCRETE_LIT) : ((y - g) % 10 === 0 ? CONCRETE_DARK : CONCRETE);
        PW.set(world, x, y, M.REINFORCED, { quiet: true });
        PW.setLayer(world, 'paint', x, y, rgb(c));
        PW.setLayer(world, 'deco', x, y, 0);
        PW.setOwner(world, x, y, owner);
      }
    }
    // (a lamp either side of the mouth, on the face)
    for (const ly of [top - 4]) for (const lx of [px - dir * 2]) { PW.setLayer(world, 'deco', lx, ly, rgb([255, 236, 170])); }
    if (!PW.NO_PORTAL_DETAIL) entrance(world, t, px, dir, top, owner);
    t.portals.push({ x: px, top, floor: t.floorAt(px), end });
    if (!PW.NO_PORTAL_DETAIL) joinDoorway(world, t, px, dir, top, owner);
  }
  // N121 (the user's, 2026-11-23, after the four tunnel-mouth photos): the mouth is an entrance,
  // not a sharp cut in the hill - an arch ring of dressed voussoirs projecting out over the road
  // (its soffit curving up from the crown, its ring stones banded), a coursed stone portal face
  // with a cornice and a crenellated parapet over it, stepped wing walls running down to the
  // road's shoulders, a signal gantry hung inside the mouth (red and green lane lights, an amber
  // sign) and lamps on the face. Everything of it is the tunnel's own concrete (REINFORCED).
  const HOOD = 14;            // how far the arch ring stands out from the face
  const STONE = [132, 128, 120], STONE_LIT = [164, 160, 150], STONE_DARK = [92, 88, 82], MORTAR = [70, 68, 64];
  function entrance(world, t, px, dir, top, owner) {
    const out = -dir;   // (the mouth opens towards the flats: away from the hill)
    const put = (x, y, c) => {
      if (x < 2 || x > world.width - 3 || y < 2 || y > world.height - 3) return;
      const id = idAt(world, x, y);
      if (id === M.BEDROCK || bundle(world, x, y) || works(world, x, y)) return;
      PW.set(world, x, y, M.REINFORCED, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(c));
      PW.setLayer(world, 'deco', x, y, 0);
      PW.setOwner(world, x, y, owner);
    };
    // the arch ring: a hood over the road, its underside rising from the crown as it stands out -
    // its first cells solid on the headwall, the rest of it standing over the road in the front
    // of the face's plane, drawn on the back layer (a cantilever of masonry over open air is no
    // ground the physics would hold up)
    for (let k = 0; k <= HOOD; k += 1) {
      const x = px + out * k, u = k / HOOD;
      const soffit = top - 1 - Math.round(10 * (1 - Math.sqrt(Math.max(0, 1 - u * u))));
      const crown = soffit - 9;
      const lay = k <= 2 ? put : (xx, yy, c) => { if (xx >= 2 && xx <= world.width - 3 && PW.mat.open[idAt(world, xx, yy)]) { PW.setLayer(world, 'back', xx, yy, rgb(c)); PW.setFlag(world, xx, yy, PW.FLAG.FIXTURE); } };
      for (let y = crown; y <= soffit; y += 1) {
        const v = (x * 5 + Math.floor((y - crown) / 3)) % 7;   // voussoir joints, radial-ish
        const joint = v === 0 || y === crown;
        lay(x, y, joint ? MORTAR : y === soffit ? STONE_DARK : (k & 3) === 0 ? STONE_LIT : STONE);
      }
      // the keystone over the middle of the ring
      if (k === Math.round(HOOD / 2)) for (let y = crown - 3; y < crown; y += 1) lay(x, y, STONE_LIT);
    }
    // the portal face over the ring and the wing walls beside the road stand BEHIND it (the back
    // layer, where the cells are open): coursed stone up to a cornice and a crenellated parapet,
    // and the wing walls stepping down from the face to the road's shoulder out past the ring -
    // the entrance's look, with nothing over the road for the physics to hold up but the ring
    const wall = (x, y, c) => {
      if (x < 2 || x > world.width - 3 || y < 2 || y > world.height - 3) return;
      if (!PW.mat.open[idAt(world, x, y)]) return;
      PW.setLayer(world, 'back', x, y, rgb(c));
      PW.setFlag(world, x, y, PW.FLAG.FIXTURE);
    };
    const faceTop = Math.min(world.groundTop[px] - 2, top - 34);
    const stoneAt = (x, y, y0) => {
      const course = Math.floor((y - y0) / 5), stagger = (course & 1) * 4;
      const joint = (y - y0) % 5 === 0 || ((x + stagger) % 9) === 0;
      return joint ? MORTAR : ((x * 13 + course * 7) % 5 === 0 ? STONE_DARK : STONE);
    };
    for (let k = -2; k <= HOOD + 2; k += 1) {
      const x = px + out * k;
      for (let y = faceTop; y < top - 10; y += 1) wall(x, y, stoneAt(x, y, faceTop));
      wall(x, faceTop - 1, STONE_LIT); wall(x, faceTop - 2, STONE_LIT);            // the cornice
      if (((k + 40) % 8) < 4) for (let y = faceTop - 7; y < faceTop - 2; y += 1) wall(x, y, (k & 1) ? STONE : STONE_LIT);   // the crenels
    }
    for (let s = 0; s < 5; s += 1) {
      for (let k = 0; k < 9; k += 1) {
        const x = px + out * (HOOD + 3 + s * 9 + k), floor = t.floorAt(Math.max(t.a, Math.min(t.b, x)));
        const stepTop = top - 12 + Math.round((s + 1) * (CLEAR - 4) / 6);
        for (let y = stepTop; y < floor; y += 1) wall(x, y, y === stepTop ? STONE_LIT : stoneAt(x, y, stepTop));
      }
    }
    // the signal gantry inside the mouth: a steel beam under the crown, red and green lane lights,
    // an amber sign between them; lamps on the face either side of the ring
    const gx = px + dir * 10;
    for (let k = -8; k <= 8; k += 1) { const x = gx + k; if ((PW.get(world, x, top + 3) & ID_MASK) === M.AIR) PW.setLayer(world, 'deco', x, top + 3, rgb(STEEL_DARK)); }
    for (const [k, c] of [[-6, [60, 220, 110]], [-5, [60, 220, 110]], [5, [230, 60, 50]], [6, [230, 60, 50]]]) PW.setLayer(world, 'deco', gx + k, top + 4, rgb(c));
    for (let k = -2; k <= 2; k += 1) for (const y of [top + 4, top + 5]) PW.setLayer(world, 'deco', gx + k, y, rgb(k & 1 ? [255, 168, 60] : [40, 30, 20]));
    for (const lx of [px + out * (HOOD + 2)]) for (const ly of [top - 20, top - 21]) PW.setLayer(world, 'deco', lx, ly, rgb([255, 236, 170]));
  }
  // ...and where a base building's doorway stands by the mouth (its gate hall or hangar door at the
  // road's level, a short way out), the ring carries on to it as a covered way: a roof slab from the
  // hood to the building's face, walls left open - the army goes straight from the hall into the
  // mountain under cover.
  function joinDoorway(world, t, px, dir, top, owner) {
    const out = -dir, floor = t.floorAt(px);
    let best = null;
    for (const b of world.buildings || []) {
      if (!b || !b.body || b.ruined || (b.type !== 'military' && b.type !== 'population')) continue;
      const face = out > 0 ? b.body.left : b.body.right;
      const gap = (face - (px + out * HOOD)) * out;
      if (gap < 2 || gap > 60 || Math.abs((b.ground ?? floor) - floor) > 6) continue;
      if (!best || gap < best.gap) best = { b, face, gap };
    }
    if (!best) return;
    const roof = top - 10;
    for (let x = px + out * (HOOD + 1); (best.face - x) * out > 0; x += out) {
      for (let y = roof; y < roof + 6; y += 1) {
        if ((PW.get(world, x, y) & ID_MASK) !== M.AIR) continue;
        PW.set(world, x, y, M.REINFORCED, { quiet: true });
        PW.setLayer(world, 'paint', x, y, rgb(y === roof ? STONE_LIT : y === roof + 5 ? STONE_DARK : (x & 7) === 0 ? MORTAR : STONE));
        PW.setOwner(world, x, y, owner);
      }
      if (((x - px) & 15) === 0) PW.setLayer(world, 'deco', x, roof + 6, rgb([255, 236, 170]));
    }
    t.joined = best.b.id;
  }

  // ---- Barricades ---------------------------------------------------------------------------------
  // Three across the road: a little inside each portal, and one at the middle - jersey blocks and steel
  // hedgehogs, the boring side's. Its own units pass them; an enemy's must run them over or blow them
  // apart (PS's). Each laid as real cells the tunnel's network owns, and laid again when it has been
  // broken and no enemy has come near it a while.
  function barricades(world, t) {
    const ins = t.portals.map((p) => p.x + (p.end === 'a' ? 1 : -1) * 70);
    const xs = [...ins, Math.round((t.a + t.b) / 2)].filter((x) => x > t.a + 40 && x < t.b - 40);
    for (const cx of xs) {
      const bar = { id: ++bseq, tunnel: t.id, side: t.side, x0: cx - BARRICADE_W / 2, x1: cx + BARRICADE_W / 2, y0: 0, y1: 0, cells: [], brokenAt: null };
      layBarricade(world, t, bar);
      t.barricades.push(bar);
      (world.barricades || (world.barricades = [])).push(bar);
    }
  }
  function layBarricade(world, t, bar) {
    const net = netOf(world, t), owner = net ? net.owner : 0;
    bar.cells = [];
    let y0 = Infinity, y1 = -Infinity;
    const put = (x, y, mat, c) => {
      if (idAt(world, x, y) !== M.AIR) return;
      PW.set(world, x, y, mat, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(c));
      PW.setOwner(world, x, y, owner);
      bar.cells.push(y * world.width + x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    };
    // (the pieces: block, hedgehog, block, hedgehog, block)
    const pieces = ['block', 'hog', 'block', 'hog', 'block'];
    let x = bar.x0;
    for (const kind of pieces) {
      const f = t.floorAt(x);
      if (kind === 'block') {
        // (a jersey barrier: wide foot, narrow top, a hazard stripe)
        for (let h = 0; h < 12; h += 1) {
          const inset = h < 3 ? 0 : h < 6 ? 1 : 2 + Math.floor((h - 6) / 3);
          for (let dx = inset; dx < 12 - inset; dx += 1) put(x + dx, f - 1 - h, M.CONCRETE, h === 7 ? (((x + dx) >> 1) & 1 ? STRIPE : STRIPE_DARK) : h === 11 ? CONCRETE_LIT : dx === inset ? CONCRETE_DARK : CONCRETE);
        }
        x += 14;
      } else {
        // (a Czech hedgehog: three steel beams crossed - drawn as an X on a foot)
        for (let k = 0; k < 12; k += 1) {
          put(x + k, f - 1 - k, M.STEEL, k % 3 ? STEEL : STEEL_DARK);
          put(x + 11 - k, f - 1 - k, M.STEEL, k % 3 ? STEEL : STEEL_DARK);
        }
        for (let dx = 2; dx < 10; dx += 1) put(x + dx, f - 1, M.STEEL, STEEL_DARK);
        x += 14;
      }
    }
    bar.y0 = y0; bar.y1 = y1; bar.laid = bar.cells.length;
  }
  // (an enemy of the tunnel's side within reach of the barricade)
  function enemyNear(world, t, bar, reach = 300) {
    const cx = (bar.x0 + bar.x1) / 2;
    for (const k of ['troops', 'tanks', 'mechs', 'jets']) for (const u of world[k] || []) {
      if (!u.dead && u.side && u.side !== t.side && Math.abs(u.x - cx) < reach) return true;
    }
    return false;
  }
  function keep(world, t, time) {
    for (const bar of t.barricades) {
      let stand = 0;
      for (const i of bar.cells) { const id = world.mat[i] & ID_MASK; if (id === M.CONCRETE || id === M.STEEL) stand += 1; }
      if (!bar.laid || stand >= bar.laid * 0.6) { bar.brokenAt = null; continue; }
      if (enemyNear(world, t, bar)) { bar.brokenAt = time; continue; }
      if (bar.brokenAt === null) bar.brokenAt = time;
      if (time - bar.brokenAt >= QUIET) { layBarricade(world, t, bar); bar.brokenAt = null; bar.relaid = (bar.relaid || 0) + 1; }
    }
  }

  // ---- The mountain at hand, and time -------------------------------------------------------------
  // One road through a mountain, once: whoever bores it, anyone may use it (the user's) - asked again,
  // by any side, while the bore goes on or after, the asker is told of the one there is.
  function forMountain(world, m0, m1, opts = {}) {
    const have = (world.roadTunnels || []).find((t) => t.a < m1 && t.b > m0);
    if (have) return { ok: true, tunnel: have, note: have.done ? 'through' : 'boring' };
    const p = plan(world, m0, m1);
    if (!p || p.a === undefined) return { ok: false, note: (p && p.why) || 'no way through' };
    const t = build(world, p, opts);
    return t ? { ok: true, tunnel: t, note: t.done ? 'through' : 'boring' } : { ok: false, note: 'not built' };
  }
  function step(world, dt) {
    const list = world.roadTunnels;
    if (!list || !list.length) return;
    world.roadClock = (world.roadClock || 0) + dt;
    // (N116: a bore its side has paid to rush goes at the rushed pace; N115: the test's build speed)
    for (const t of list) if (!t.done) advance(world, t, BORE_RATE * dt * PW.tunnels.paceOf(world, netOf(world, t)));
    if (world.roadClock - (world.roadKeptAt || 0) >= KEEP_EVERY) {
      world.roadKeptAt = world.roadClock;
      for (const t of list) if (t.done) keep(world, t, world.roadClock);
    }
  }
  // (is (x, y) on a road tunnel's way - for the vehicles' rule: the only tunnel they may enter)
  function onRoad(world, x, y) {
    for (const t of world.roadTunnels || []) if (x >= t.a && x <= t.b && y <= t.floorAt(x) && y > t.floorAt(x) - CLEAR) return t;
    return null;
  }

  PW.roadTunnels = { plan, build, forMountain, step, onRoad, footOf, CLEAR, GRADE, MAX_LEN, BARRICADE_W, PIPE_UNDER };
})();
