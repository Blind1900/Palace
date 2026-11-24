'use strict';
// Turret bases (N103, the user's turret redesign - part of N89). A turret no longer stands built into
// a military roof: it is seated on a turret base, a low steel plate set on a flat surface - a roof (the
// building ornaments draw that plate into the blueprint: the building's own, rebuilt with it), the land,
// or a tunnel room's floor (laid here, as made ground). The turret itself - its head, its aim, its fire,
// coming off when the plate under it goes - is PS's (pw-defence). Here: finding flat ground for a base,
// laying it, and keeping a turret on every base that stands.
//
//   PW.mounts.find(world, x0, x1, opts)   flat ground for a base between x0 and x1, nearest opts.near:
//                                         { x0, floor } or null (opts.room: a tunnel room's floor, the
//                                         search from opts.top down to opts.bottom)
//   PW.mounts.lay(world, spot, info)      the plate laid there: a mount record in world.mounts
//   PW.mounts.place(world, x0, x1, info)  find and lay in one
//   PW.mounts.sweep(world, { armed })     a turret on each base that stands and has none; a turret off
//                                         each base gone (PW.mounts.step does it once a second)
//   PW.mounts.seed(world)                 the world's own bases: before its military, in its bases'
//                                         rooms underground (worldgen)
//
// A mount record (the format agreed with PS): { kind: 'turret', x, y, facing, normal: [0, -1], side,
// style, building, base: { x0, x1, y } } - y the plate's top row, where the turret's ring sits.
// N114: kind 'launcher' or 'interceptor' (type 'dome' or 'patriot') - the missile artillery on its
// planted base, out under the sky only (KINDS).
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;

  const BASE_W = 32, BASE_H = 6;   // the plate (a trooper 12 x 27, a tank 128 x 58; plate and head ~32 x 30)
  const CLEAR = 40;                // open rows a base wants over the floor it stands on: plate, head, a margin
  // N114 (the user's): the missile launchers and interceptors follow the turret - stationary artillery
  // on a planted base - but only under the open sky: never in a tunnel's room, never under a roof.
  // Their pods and boxes overhang the plate as they lay (PS's, ae0823a: up to ~60 cells ahead, ~85
  // above): 90 open rows over it, and 60 clear either side above it. An interceptor is PS's Iron
  // Dome, or a Patriot.
  const KINDS = {
    turret: { w: BASE_W, clear: CLEAR, side: 0, sky: false },
    launcher: { w: 36, clear: 90, side: 60, sky: true },      // (PS's turntables: 30 and 22 wide)
    interceptor: { w: 32, clear: 90, side: 60, sky: true },
  };
  const kindOf = (k) => KINDS[k] || KINDS.turret;
  // (what PS's PW.defence seats on a base of this kind)
  const typeFor = (rec, level = 1) => rec.type || (rec.kind === 'launcher' ? 'launcher' : rec.kind === 'interceptor' ? (level >= 3 ? 'patriot' : 'dome') : 'turret');
  const FLAT = 1;                  // rows of give along the stretch a base stands on
  const SPACING = 48;              // cells between two bases at the most crowded
  const SWEEP_EVERY = 60;          // ticks between looks over the bases
  const REARM = 30;                // s before a building's base, rebuilt, takes a turret again
  const INTACT = 0.85;             // share of a plate's cells that must stand for it to bear a turret
  const TUNNEL_OWNER = 50000, PIPE_OWNER = 60000;
  const STYLE_TINT = { modern: [120, 150, 176], asian: [168, 70, 48], gothic: [128, 116, 92] };
  const LOOSE = new Uint8Array(64);
  for (const id of [M.DEBRIS, M.RUBBLE, M.LOOSE_SOIL, M.LOOSE_STONE, M.SAND, M.ASH, M.RUIN, M.WATER]) LOOSE[id] = 1;
  let seq = 0;

  const idAt = (world, x, y) => PW.get(world, x, y) & ID_MASK;
  const openAt = (world, x, y) => PW.mat.phase[idAt(world, x, y)] <= PW.PHASE.GAS;
  const flags = (world, x, y) => PW.getFlags(world, x, y);
  const roadAt = (world, x, y) => (flags(world, x, y) & PW.FLAG.ROAD) !== 0 || idAt(world, x, y) === M.ASPHALT || idAt(world, x, y) === M.ROADBED;
  // A floor a plate may stand on: solid, not loose, not water, not the bundle, not a building's;
  // underground, a tunnel's own lined floor will do.
  // (road: a person may set one on a road or a runway - any flat surface; the world's own keep off them)
  function firm(world, x, y, room, road = false) {
    const id = idAt(world, x, y);
    if (PW.mat.phase[id] < PW.PHASE.SOLID || LOOSE[id] || id === M.PIPE) return false;
    if (flags(world, x, y) & PW.FLAG.HOLLOW) return false;
    const owner = PW.getOwner(world, x, y);
    if (owner >= PIPE_OWNER) return false;
    if (owner && owner < TUNNEL_OWNER) return false;
    if (!room && (owner >= TUNNEL_OWNER || (flags(world, x, y) & PW.FLAG.TUNNEL))) return false;
    return road || !roadAt(world, x, y);
  }
  // (open air over the floor for the plate and the turret - nobody's cells, no water)
  function clearOver(world, x, floor, rows) {
    for (let y = floor - 1; y >= floor - rows; y -= 1) {
      if (y < 1 || !openAt(world, x, y)) return false;
      const owner = PW.getOwner(world, x, y);
      if (owner && owner < TUNNEL_OWNER) return false;
    }
    return true;
  }
  // (a base already standing near - an artillery plate keeps its overhang's width from the next)
  const crowded = (world, x0, floor, w, gap) => (world.mounts || []).some((m) => Math.abs(m.base.y - floor) < 80 && m.base.x0 < x0 + w + Math.max(gap, SPACING) && m.base.x1 > x0 - Math.max(gap, SPACING))
    || (world.buildings || []).some((b) => b && b.devices && b.devices.some((d) => d.base && Math.abs(d.base.y - floor) < 80 && d.base.x0 < x0 + w + Math.max(gap, 8) && d.base.x1 > x0 - Math.max(gap, 8)));
  // (N114: the room an artillery piece lays its pods in - the columns `side` either side of its plate
  // open over it through its clear rows, nobody's. The pods are raised on their cradle before they
  // swing out, so the low corners beside the plate are never swept: the reach starts OVERHANG_LOW
  // rows up, and the land beside may rise that far.)
  const OVERHANG_LOW = 20;
  function overhangClear(world, x0, w, floor, K) {
    if (!K.side) return true;
    const top = floor - BASE_H;
    for (const [a, b] of [[x0 - K.side, x0 - 1], [x0 + w, x0 + w + K.side - 1]]) {
      for (let x = Math.max(1, a); x <= Math.min(world.width - 2, b); x += 2) {
        for (let y = top - OVERHANG_LOW; y >= top - (K.clear - BASE_H); y -= 3) {
          if (y < 1 || !openAt(world, x, y)) return false;
          const owner = PW.getOwner(world, x, y);
          if (owner && owner < TUNNEL_OWNER) return false;
        }
      }
    }
    return true;
  }

  // Flat ground for a base: a stretch as wide as its kind's plate and 2 more, whose floor rises and
  // falls no more than FLAT, firm all along, with its kind's open rows over it - the one whose middle
  // is nearest opts.near. (opts.kind: 'turret' - the default - 'launcher' or 'interceptor'; those two
  // only out under the sky, and with room for their overhang.)
  function find(world, x0, x1, opts = {}) {
    const K = kindOf(opts.kind), room = !!opts.room, rows = opts.clear || K.clear, pw = K.w, W = pw + 2;
    if (K.sky && room) return null;
    x0 = Math.max(2, Math.round(x0)); x1 = Math.min(world.width - 3, Math.round(x1));
    if (x1 - x0 + 1 < W) return null;
    const n = x1 - x0 + 1, floor = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k += 1) {
      const x = x0 + k;
      let y = -1;
      if (room) {
        for (let r = Math.round(opts.top); r <= Math.round(opts.bottom); r += 1) if (!openAt(world, x, r)) { y = r; break; }
      } else y = world.groundTop[x];
      if (y > 0 && firm(world, x, y, room, !!opts.road) && clearOver(world, x, y, rows)) floor[k] = y;
    }
    const near = opts.near ?? (x0 + x1) / 2;
    let best = null, bestD = Infinity;
    for (let k = 0; k + W <= n; k += 1) {
      let lo = Infinity, hi = -Infinity, ok = true;
      for (let j = k; j < k + W; j += 1) {
        if (floor[j] < 0) { ok = false; break; }
        lo = Math.min(lo, floor[j]); hi = Math.max(hi, floor[j]);
      }
      if (!ok || hi - lo > FLAT) continue;
      const sx = x0 + k + 1, d = Math.abs(sx + pw / 2 - near);
      if (d >= bestD || crowded(world, sx, lo, pw, K.side)) continue;
      // (not where a building stands over it, nor in the way of its doors)
      if (!room && (world.buildings || []).some((b) => b && b.body && !b.dismantled && b.body.left < sx + pw + 12 && b.body.right > sx - 12
        && b.ground > lo - 400 && b.body.top < lo + 4)) continue;
      if (!overhangClear(world, sx, pw, lo, K)) continue;
      best = { x0: sx, floor: lo, floors: Array.from(floor.subarray(k + 1, k + 1 + pw)), kind: opts.kind || 'turret' };
      bestD = d;
    }
    return best;
  }

  // The plate laid on the spot: made ground (the land's own kind - it stands as the pad of a cave
  // base does), painted as the building ornaments paint their plates; under a column whose floor
  // lies a row lower, the plate reaches down to it.
  function lay(world, spot, info = {}) {
    const O = PW.buildingOrnaments;
    const kind = info.kind || spot.kind || 'turret', w = kindOf(kind).w;
    const top = spot.floor - BASE_H, tint = STYLE_TINT[info.style] || STYLE_TINT.modern;
    for (let dx = 0; dx < w; dx += 1) {
      const x = spot.x0 + dx, below = spot.floors ? spot.floors[dx] : spot.floor;
      for (let y = top; y < below; y += 1) {
        const dy = Math.max(0, spot.floor - 1 - y);
        const c = O && O.plateColor ? O.plateColor(dx, Math.min(BASE_H - 1, dy), tint, w) : [92, 98, 106];
        PW.set(world, x, y, M.FOUNDATION, { quiet: true });
        PW.setLayer(world, 'paint', x, y, PW.abgr(c[0], c[1], c[2], 255));
        PW.setLayer(world, 'deco', x, y, 0);
        PW.setOwner(world, x, y, 0);
        if (flags(world, x, y) & PW.FLAG.TUNNEL) PW.setFlag(world, x, y, PW.FLAG.TUNNEL, false);   // (in a room: no longer its open way)
      }
      if (PW.refreshGroundTop) PW.refreshGroundTop(world, x, Math.max(0, top - 4));
    }
    const m = { id: ++seq, kind, x: spot.x0 + w / 2, y: top, facing: info.facing || 1, normal: [0, -1],
      side: info.side || 'neutral', style: info.style || 'modern', building: 0, at: info.at || (spot.room ? 'room' : 'land'),
      base: { x0: spot.x0, x1: spot.x0 + w - 1, y: top } };
    if (info.type) m.type = info.type;   // (an interceptor's: 'dome' or 'patriot')
    (world.mounts || (world.mounts = [])).push(m);
    return m;
  }
  function place(world, x0, x1, info = {}) {
    const spot = find(world, x0, x1, info);
    const m = spot ? lay(world, { ...spot, room: info.room }, info) : null;
    if (m) m.want = { x0, x1, info };   // (where it was looked for - see relay)
    return m;
  }
  // A plate broken before it ever bore a turret - the match's passes dig their portals at a
  // mountain's foot, through whatever lies there - is laid again where it was looked for, on ground
  // still firm. (What is left of the old plate is the dig's.)
  function relay(world) {
    const live = world.mountUnits || new Map();
    let n = 0;
    for (const m of (world.mounts || []).slice()) {
      if (m.spent || live.has(`m${m.id}`) || !m.want || intact(world, m.base, 0)) continue;
      world.mounts.splice(world.mounts.indexOf(m), 1);
      if (place(world, m.want.x0, m.want.x1, m.want.info)) n += 1;
    }
    return n;
  }

  // ---- A turret on every base that stands ----------------------------------------------------------
  // Is the plate still there: most of its cells standing - the building's own, for a roof's; made
  // ground, for one laid on the land or a room's floor.
  function intact(world, base, owner) {
    let n = 0, have = 0;
    for (let y = base.y; y < base.y + BASE_H; y += 1) for (let x = base.x0; x <= base.x1; x += 1) {
      n += 1;
      if (owner ? PW.getOwner(world, x, y) === owner : idAt(world, x, y) === M.FOUNDATION) have += 1;
    }
    return have >= n * INTACT;
  }
  const match = () => (PW.game && PW.game.current ? PW.game.current() : null);
  const sideOf = (b) => (b.faction ?? b.side) || 'neutral';
  function styleOf(side, fallback) {
    const m = match();
    return (m && m.sides[side] && m.sides[side].style) || fallback || 'modern';
  }
  // Once a second: every base that stands and has no turret is given one (a building's - first
  // raised, or rebuilt after its turret was lost - a while after; one on the land or in a room only
  // once: a turret lost there is lost); every turret whose base has gone, or whose building has, is
  // taken off. Outside a match the turrets stand silent (held: PS's hold), so the sandbox's and the
  // lab's worlds are only looked at; in a match they fight.
  function sweep(world, opts = {}) {
    if (!PW.defence || !PW.defence.create) return;
    const live = world.mountUnits || (world.mountUnits = new Map());
    const state = world.mountState || (world.mountState = new Map());
    const tick = world.tick || 0, armed = !!opts.armed, seen = new Set();
    // (a turret whose building is ruined or gone goes with it, quietly - the fall of the building is the
    // event, and a cook-off and a burnt head landing where the cores rise from the wreck only got in
    // their way)
    const kill = (u) => { if (!u.dead) { u.dead = true; u.hp = 0; } };
    const listed = new Set(world.defence || []);
    // (standing: its building stands, or - on the land - it is not spent. A turret already seated
    // stays while that holds: PS's turret itself comes off when the plate under it goes; a new one
    // is seated only on a plate that is whole again)
    const handle = (key, standing, rec, owner, rearm) => {
      let u = live.get(key);
      const st = state.get(key) || {};
      if (u && u.dead) { live.delete(key); st.deadAt = tick; if (!rearm) rec.spent = true; state.set(key, st); u = null; }
      // (taken out of the world's list by something else - a clean slate a test or a reset makes - it
      // waits its while before it is seated again, as a lost one does)
      if (u && !listed.has(u)) { live.delete(key); st.deadAt = tick; state.set(key, st); u = null; }
      if (u && !standing) { kill(u); live.delete(key); st.deadAt = tick; if (!rearm) rec.spent = true; state.set(key, st); return; }
      if (u) {
        // (a building's plate moves with it - brought down with its heap, N100; re-seated)
        if (u.x !== rec.x || u.y !== rec.y) { u.x = rec.x; u.y = rec.y; u.base = { ...rec.base }; }
        return;
      }
      if (!standing || rec.spent || !intact(world, rec.base, owner)) return;
      if (st.deadAt !== undefined && tick - st.deadAt < REARM * 60) return;
      // (N114: a launcher's base takes PS's launcher, an interceptor's its Iron Dome - a Patriot on a
      // level-3 building or up, or as placed)
      u = PW.defence.create(world, { type: typeFor(rec, rec.level), x: rec.x, y: rec.y, facing: rec.facing || 1, normal: rec.normal || [0, -1],
        side: rec.side, style: rec.style, building: rec.building || 0, base: { ...rec.base }, hold: !armed });
      if (!u) return;
      u.mount = key;
      u.hold = !armed;
      live.set(key, u);
      if (armed && PW.game && PW.game.adopt) PW.game.adopt(u);
    };
    for (const b of world.buildings || []) {
      if (!b || !b.canvas || !b.body || b.dismantled || !b.devices) continue;
      b.devices.forEach((d, i) => {
        if (!KINDS[d.kind] || !d.base) return;
        const key = `b${b.id}:${i}`;
        seen.add(key);
        const side = sideOf(b);
        handle(key, !b.ruined && !b.coresOpen, { ...d, building: b.id, side, style: styleOf(side, b.style), level: b.level || 1 }, b.id, true);
      });
    }
    for (const m of world.mounts || []) {
      const key = `m${m.id}`;
      seen.add(key);
      handle(key, !m.spent, m, 0, false);
    }
    for (const [key, u] of live) if (!seen.has(key)) { kill(u); live.delete(key); }
  }
  function step(world, opts = {}) {
    const tick = world.tick || 0;
    if (world.mountsAt !== undefined && tick - world.mountsAt < SWEEP_EVERY && tick >= world.mountsAt) return;
    world.mountsAt = tick;
    sweep(world, opts);
  }

  // ---- The world's own bases (worldgen) -------------------------------------------------------------
  // Out before each military building on the surface, on the side the enemy comes from (a neutral
  // post: towards the middle of the map); on the pad of each cave base; in each base's starter
  // storage room. (The hall rooms' armouries get theirs when they are dug - pw-settlements - and
  // the halls-and-rooms tunnels' hubs, vaults and hangars when they are carved - pw-tunnels.)
  function seed(world) {
    const mid = world.width / 2;
    const towards = (side, x) => (side === 'left' ? 1 : side === 'right' ? -1 : x < mid ? 1 : -1);
    let n = 0;
    // (out on the land, clear of the towns' growth: a city grades and builds over its own span as it
    // grows, and would take a plate laid in its way - so a town's base sets its turret out past the
    // town's edge)
    const cities = (world.capitalGrowth && world.capitalGrowth.cities) || [];
    for (const b of world.buildings || []) {
      if (!b || b.type !== 'military' || !b.body || b.dismantled) continue;
      const side = sideOf(b), dir = towards(side, (b.body.left + b.body.right) / 2);
      let edge = dir > 0 ? b.body.right : b.body.left;
      const town = cities.find((c) => edge > c.edge.left - 140 && edge < c.edge.right + 140);
      if (town) edge = dir > 0 ? Math.max(edge, town.edge.right + 140) : Math.min(edge, town.edge.left - 140);
      const a = edge + dir * 40, z = edge + dir * 400;
      if (place(world, Math.min(a, z), Math.max(a, z), { near: edge + dir * 90, side, style: styleOf(side, b.style), facing: dir, at: 'land' })) n += 1;
    }
    // (underground the floor is looked for from inside the room down: from its pad's head height, or
    // a couple of rows under the room's roof)
    for (const cb of world.caveBases || []) {
      const dir = towards(cb.side, cb.x);
      if (place(world, cb.x0 + 4, cb.x1 - 4, { room: true, top: cb.y - 20, bottom: cb.y + 2, near: cb.x, side: cb.side, style: styleOf(cb.side, cb.style), facing: dir, at: 'room' })) n += 1;
    }
    for (const s of world.settlements || []) {
      const mine = s.core && s.core.mine, rm = mine && mine.storage;
      if (!rm) continue;
      const side = s.side || 'neutral', toShaft = Math.sign(mine.shaft.x - (rm.x0 + rm.x1) / 2) || 1;
      if (place(world, rm.x0 + 6, rm.x1 - 6, { room: true, top: rm.top + 2, bottom: rm.bottom + 2, near: (rm.x0 + rm.x1) / 2, side, style: styleOf(side, s.style), facing: toShaft, at: 'room' })) n += 1;
    }
    return n;
  }
  // A tunnel room's base: on its floor (`floor`: the solid row the room stands on; `height`: its
  // open rows over it) - for the rooms dug as the match goes (an armoury) and the halls-and-rooms
  // tunnels' rooms.
  function room(world, x0, x1, floor, height, info = {}) {
    return place(world, x0 + 6, x1 - 6, { ...info, room: true, top: floor - height + 3, bottom: floor + 2, at: 'room' });
  }

  PW.mounts = { find, lay, place, relay, room, intact, sweep, step, seed, BASE_W, BASE_H, CLEAR, KINDS, typeFor };
})();
