'use strict';
// Tunnel networks. Every tunnel is dug raw: bare rock held up by timber sets (posts, cap boards
// and knee braces), plank lagging under the roof, a muddy floor and dim bulbs. Each network then
// develops outward from its root (the original branch) along every branch at a slow, steady
// pace: the rock around each stretch is lined with reinforced concrete, steel ribs replace the
// timber, and the walls get the military fit-out (olive dado, cable trays, caged lamps, a painted
// floor line, hazard stripes at the ends). Another side can only dig into a raw stretch:
// developed lining stops their diggers. A side may cut through its own lining to branch off.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK, CHUNK_SHIFT, CHUNK_MASK, CHUNK_CELLS } = PW;

  const RATE = 3;          // cells of tunnel developed per second along a branch
  const LINE = 4;          // lining thickness (0.28 m)
  const SET_PITCH = 36;    // timber sets 2.5 m apart
  const RIB_PITCH = 40;    // steel ribs 2.8 m apart
  const LAMP_PITCH = 64;
  const OWNER_BASE = 50000;

  const rgb = (c) => PW.abgr(c[0] | 0, c[1] | 0, c[2] | 0);
  const tone = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mod = (a, n) => ((a % n) + n) % n;

  const RAW = { rock: [44, 37, 31], dark: [33, 28, 23], light: [58, 49, 40], post: [122, 88, 54], postDark: [86, 60, 37],
    postLight: [152, 114, 72], plank: [108, 79, 50], mud: [60, 48, 37], bulb: [255, 196, 112], cable: [26, 24, 22] };
  // Developed: a bunker bore of cast concrete segments. Back wall from the floor up: a kerb, the
  // painted lower band with a stripe, stencilled sector numbers, a water main, cable trays, a big
  // ventilation duct on hangers, and linear lights along the crown of the vault.
  const DEV = { face: [142, 144, 140], lining: [126, 128, 124], deep: [110, 112, 108], joint: [100, 102, 98],
    back: [88, 92, 92], ring: [66, 70, 70], ringLight: [112, 116, 116], dado: [84, 92, 62], dadoEdge: [56, 62, 42],
    kerb: [118, 120, 116], cable: [30, 30, 34], cableRed: [96, 34, 30], cableBlue: [34, 48, 84], tray: [98, 102, 108],
    pipe: [62, 112, 112], pipeDark: [42, 82, 84], duct: [112, 118, 122], ductLight: [140, 146, 150], ductDark: [78, 82, 86],
    hanger: [60, 64, 68], housing: [48, 50, 54], tube: [236, 246, 250], stencil: [214, 214, 200],
    rib: [70, 76, 84], ribLight: [106, 112, 122], lamp: [228, 242, 248], cage: [52, 56, 60],
    stripe: [191, 123, 25], stripeDark: [38, 36, 32], line: [218, 180, 56], glow: [214, 234, 242] };
  // 3x5 stencil digits for the sector numbers.
  const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
    '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

  // ---- State and sparse per-cell layers ---------------------------------------------------------------
  function state(world) {
    if (!world.tunnels) world.tunnels = { networks: [], segments: [], breaches: [], time: 0, pending: createHeap() };
    return world.tunnels;
  }
  function getL(world, name, x, y) {
    const chunks = world[name];
    if (!chunks || x < 0 || y < 0 || x >= world.width || y >= world.height) return 0;
    const chunk = chunks[(y >> CHUNK_SHIFT) * world.chunksX + (x >> CHUNK_SHIFT)];
    return chunk ? chunk[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] : 0;
  }
  function setL(world, name, Type, x, y, value) {
    if (!world[name]) world[name] = new Array(world.chunkCount).fill(null);
    const c = (y >> CHUNK_SHIFT) * world.chunksX + (x >> CHUNK_SHIFT);
    let chunk = world[name][c];
    if (!chunk) { if (!value) return; chunk = world[name][c] = new Type(CHUNK_CELLS); }
    chunk[(y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK] = value;
  }
  const netAt = (world, x, y) => getL(world, 'tunnelNet', x, y);
  const segAt = (world, x, y) => getL(world, 'tunnelSeg', x, y);
  const devAtOf = (world, x, y) => getL(world, 'tunnelDev', x, y);

  // Binary min-heap of (time, cell index).
  function createHeap() {
    const keys = [], vals = [];
    const swap = (a, b) => { [keys[a], keys[b]] = [keys[b], keys[a]]; [vals[a], vals[b]] = [vals[b], vals[a]]; };
    return {
      get size() { return keys.length; },
      peek: () => keys[0],
      push(key, value) {
        keys.push(key); vals.push(value);
        for (let i = keys.length - 1; i > 0;) { const p = (i - 1) >> 1; if (keys[p] <= keys[i]) break; swap(p, i); i = p; }
      },
      pop() {
        const value = vals[0], lastKey = keys.pop(), lastValue = vals.pop();
        if (keys.length) {
          keys[0] = lastKey; vals[0] = lastValue;
          for (let i = 0; ;) {
            const l = 2 * i + 1, r = l + 1;
            let m = i;
            if (l < keys.length && keys[l] < keys[m]) m = l;
            if (r < keys.length && keys[r] < keys[m]) m = r;
            if (m === i) break;
            swap(i, m); i = m;
          }
        }
        return value;
      },
    };
  }

  // ---- Networks ----------------------------------------------------------------------------------------
  // info: { side: 'left' | 'right' | 'neutral', x, y (root cell), building (owner building id), rate }
  function createNetwork(world, info) {
    const T = state(world);
    const id = T.networks.length + 1;
    const net = { id, side: info.side, building: info.building || 0, root: { x: Math.round(info.x), y: Math.round(info.y) },
      rate: info.rate || RATE, owner: OWNER_BASE + id, cells: 0, developed: 0, lined: 0 };
    T.networks.push(net);
    return net;
  }
  function networkOfOwner(world, owner) {
    const T = state(world);
    return owner > OWNER_BASE ? T.networks[owner - OWNER_BASE - 1] || null : null;
  }
  function networkAt(world, x, y) {
    const id = netAt(world, x, y);
    if (id) return state(world).networks[id - 1];
    if ((PW.get(world, x, y) & ID_MASK) === M.REINFORCED) return networkOfOwner(world, PW.getOwner(world, x, y));
    return null;
  }

  // ---- Raw and developed looks (per cell, so any order of painting gives the same picture) ----------
  function rawBack(net, seg, x, y) {
    let c = RAW.rock;
    const patch = PW.hash2(x >> 2, y >> 2) & 7;
    if (patch < 2) c = RAW.dark; else if (patch === 7) c = RAW.light;
    if ((PW.hash2(x, y) & 63) === 0) c = tone(RAW.light, 1.12);   // pick marks
    // Overbreak beyond the planned profile: broken rock in shadow behind the timber and lagging.
    if (x < seg.x0 || x > seg.x1 || y < seg.y0 || y > seg.y1) return tone(c, 0.72);
    let glow = 0;
    if (seg.kind === 'shaft') {
      const along = mod(y - net.root.y, SET_PITCH);
      if (along < 3) return along === 0 ? RAW.postLight : along === 2 ? RAW.postDark : RAW.post;        // bearer across the shaft
      if (x - seg.x0 < 2 || seg.x1 - x < 2) return x === seg.x0 || x === seg.x1 ? RAW.postDark : RAW.post;  // wall plates
      const by = net.root.y + Math.round((y - net.root.y - SET_PITCH / 2) / (2 * SET_PITCH)) * 2 * SET_PITCH + SET_PITCH / 2;
      const bx = seg.x1 - 4;
      if (x === bx && y === by) return RAW.bulb;
      glow = Math.max(0, 1 - Math.hypot(x - bx, y - by) / 22);
    } else {
      const top = seg.y0, bottom = seg.y1;
      const u = mod(x - net.root.x, SET_PITCH);
      const du = u <= SET_PITCH / 2 ? u - 1 : u - 1 - SET_PITCH;   // from the post's centre column
      if (Math.abs(du) <= 1 && y > top + 2) return du < 0 ? RAW.postLight : du > 0 ? RAW.postDark : RAW.post;   // post
      if (y - top < 3 && Math.abs(du) <= 7) return y === top + 2 ? RAW.postDark : RAW.post;                  // cap board
      const ky = y - (top + 3);
      if (ky >= 0 && ky < 5 && Math.abs(du) >= 2 && (Math.abs(du) === 6 - ky || Math.abs(du) === 7 - ky)) return RAW.postDark;   // knee braces
      if (y - top < 2) return x % 7 === 0 ? RAW.dark : y === top ? RAW.plank : tone(RAW.plank, 0.84);         // lagging
      // A bulb hangs from every second cap, midway between sets.
      const bx = net.root.x + Math.round((x - net.root.x - SET_PITCH / 2) / (2 * SET_PITCH)) * 2 * SET_PITCH + SET_PITCH / 2;
      const by = top + 4;
      if (x === bx && (y === top + 2 || y === top + 3)) return RAW.cable;
      if (Math.abs(x - bx) <= 1 && y === by) return RAW.bulb;
      glow = Math.max(0, 1 - Math.hypot(x - bx, (y - by) * 0.8) / 24);
      if (bottom - y < 2) c = mix(c, RAW.mud, 0.55);
    }
    return glow > 0 ? mix(c, RAW.bulb, glow * glow * 0.32) : c;
  }
  const RING = 20;          // concrete segment rings, 1.4 m
  const BULKHEAD = 160;     // steel bulkhead frames between sectors
  function devBack(net, seg, x, y) {
    let glow = 0, c;
    if (seg.kind === 'shaft') {
      const along = mod(y - net.root.y, RING);
      c = along === 0 ? DEV.ring : along === 1 ? DEV.ringLight : DEV.back;          // segment rings
      const fromLeft = x - seg.x0, fromRight = seg.x1 - x;
      if (fromLeft >= 2 && fromLeft <= 4) c = fromLeft === 3 ? DEV.cableRed : DEV.cable;   // cable run down the wall
      if (fromRight >= 2 && fromRight <= 3) c = fromRight === 2 ? DEV.pipeDark : DEV.pipe;  // water riser
      const ly = net.root.y + Math.round((y - net.root.y - RING / 2) / LAMP_PITCH) * LAMP_PITCH + RING / 2;
      const lx = seg.x1 - 7;
      if (Math.abs(x - lx) <= 1 && Math.abs(y - ly) <= 3) return Math.abs(x - lx) === 1 ? DEV.housing : DEV.tube;   // wall light
      glow = Math.max(0, 1 - Math.hypot(x - lx, (y - ly) * 0.7) / 30);
      return glow > 0 ? mix(c, DEV.glow, glow * glow * 0.4) : c;
    }
    const top = seg.y0, bottom = seg.y1, height = bottom - top + 1;
    const rise = bottom - y, fromTop = y - top;
    const along = x - net.root.x;
    // Steel bulkhead frame with hazard stripes on its foot.
    const b = mod(along, BULKHEAD);
    if (b < 4) {
      if (rise < 10) return mod(x + y, 6) < 3 ? DEV.stripe : DEV.stripeDark;
      return b === 0 ? DEV.ribLight : DEV.rib;
    }
    // Linear lights along the crown.
    const lx = net.root.x + Math.round((along - LAMP_PITCH / 2) / LAMP_PITCH) * LAMP_PITCH + LAMP_PITCH / 2;
    if (Math.abs(x - lx) <= 5 && fromTop >= 1 && fromTop <= 2) return fromTop === 1 ? DEV.housing : DEV.tube;
    glow = Math.max(0, 1 - Math.hypot((x - lx) * 0.8, fromTop - 3) / 36);
    const ring = mod(along, RING);
    c = ring === 0 ? DEV.ring : ring === 1 ? DEV.ringLight : DEV.back;
    if (rise <= 1) c = DEV.kerb;                                                        // kerb
    else if (rise < 15) c = rise === 14 ? DEV.dadoEdge : rise === 13 ? DEV.line : DEV.dado;   // painted band
    // Ventilation duct on hangers just under the vault.
    const ductTop = 5, ductBottom = 10;
    if (fromTop >= ductTop && fromTop <= ductBottom) {
      c = fromTop === ductTop ? DEV.ductLight : fromTop === ductBottom ? DEV.ductDark : DEV.duct;
      if (mod(along, 30) <= 1) c = DEV.ductDark;                                        // flange joints
    } else if (fromTop > 2 && fromTop < ductTop && mod(along, 30) === 15) c = DEV.hanger;
    // Cable trays and the water main on the wall.
    const tray = Math.round(height * 0.6);
    if (rise === tray + 3) c = DEV.tray;
    else if (rise >= tray && rise <= tray + 2) c = [DEV.cable, DEV.cableBlue, DEV.cableRed][rise - tray];
    else if (rise === tray - 1 && mod(along, 12) === 0) c = DEV.tray;
    const pipe = Math.round(height * 0.4);
    if (rise === pipe || rise === pipe + 1) c = mod(along, 16) === 0 ? DEV.ductDark : rise === pipe ? DEV.pipeDark : DEV.pipe;
    // Stencilled sector number on the painted band every bulkhead.
    const sx = mod(along, BULKHEAD) - 12, sy = rise - 5;
    if (sx >= 0 && sx < 7 && sy >= 0 && sy < 5 && sx !== 3) {
      const sector = 10 + mod(Math.floor(along / BULKHEAD) + net.id * 7, 89);
      const digit = sx < 3 ? Math.floor(sector / 10) % 10 : sector % 10;
      const col = sx < 3 ? sx : sx - 4;
      if (DIGITS[digit][(4 - sy) * 3 + col] === '1') c = DEV.stencil;
    }
    // The vault curves away overhead: the top rows fall into shadow.
    if (fromTop < 8 && c === DEV.back) c = tone(c, 0.72 + fromTop * 0.035);
    return glow > 0 ? mix(c, DEV.glow, glow * glow * 0.42) : c;
  }
  // facing: where the tunnel is from this lining cell ('floor': tunnel above it, 'ceiling': below,
  // 'wall': beside). rise: rows above the tunnel floor (for wall faces).
  function liningColor(net, x, y, depth, facing, rise) {
    let c = depth <= 1 ? DEV.face : depth === 2 ? DEV.lining : depth === 3 ? tone(DEV.lining, 0.93) : DEV.deep;
    const along = facing === 'wall' ? y - net.root.y : x - net.root.x;
    if (mod(along, 24) === 0) c = DEV.joint;                                          // formwork joints
    if (facing === 'floor' && depth === 1 && mod(x, 8) < 5) c = DEV.line;             // painted safety line
    if (facing === 'wall' && depth <= 2 && rise >= 0 && rise < 6) c = mod(x + y, 8) < 4 ? DEV.stripe : DEV.stripeDark;   // hazard stripes
    if ((PW.hash2(x, y) & 31) === 0) c = tone(c, 0.9);
    return c;
  }

  // ---- Digging -------------------------------------------------------------------------------------------
  // Dig the box [x0..x1] x [y0..y1] as raw tunnel for `net`. Another side's developed lining in the
  // box stops the whole dig (nothing is carved); another side's raw tunnel is broken into.
  // options.kind: 'drift' | 'shaft' | 'room' (default by the box's shape).
  function digBox(world, net, x0, y0, x1, y1, options = {}) {
    const T = state(world);
    const { mat, width: W, height: H } = world;
    [x0, x1] = [Math.max(1, Math.round(Math.min(x0, x1))), Math.min(W - 2, Math.round(Math.max(x0, x1)))];
    [y0, y1] = [Math.max(1, Math.round(Math.min(y0, y1))), Math.min(H - 2, Math.round(Math.max(y0, y1)))];
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const id = mat[y * W + x] & ID_MASK;
        if (id !== M.REINFORCED) continue;
        const other = networkOfOwner(world, PW.getOwner(world, x, y));
        if (other && other.side !== net.side) return { ok: false, blocked: true, at: { x, y }, by: other.id, cells: 0 };
      }
    }
    const seg = { id: T.segments.length + 1, net: net.id, x0, y0, x1, y1,
      kind: options.kind || (y1 - y0 > (x1 - x0) * 1.5 ? 'shaft' : x1 - x0 > 120 && y1 - y0 > 40 ? 'room' : 'drift') };
    T.segments.push(seg);
    const fresh = [];
    const breached = new Set();
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = y * W + x;
        const owned = netAt(world, x, y);
        if (owned) {
          if (owned !== net.id && !breached.has(owned)) { breached.add(owned); T.breaches.push({ by: net.id, into: owned, x, y, time: T.time }); }
          continue;
        }
        const id = mat[i] & ID_MASK;
        if (id === M.BEDROCK || (options.keepOre && id === M.ORE)) continue;
        if (id !== M.AIR) PW.set(world, x, y, M.AIR, { quiet: true });
        PW.setLayer(world, 'deco', x, y, 0);
        setL(world, 'tunnelNet', Uint16Array, x, y, net.id);
        setL(world, 'tunnelSeg', Uint16Array, x, y, seg.id);
        PW.setFlag(world, x, y, FLAG.TUNNEL | FLAG.CARVED | FLAG.RAW);
        PW.setFlag(world, x, y, FLAG.DEVELOPED, false);
        PW.setOwner(world, x, y, net.owner);
        PW.setLayer(world, 'back', x, y, rgb(rawBack(net, seg, x, y)));
        fresh.push(i);
      }
    }
    // Overbreak: a raw tunnel's rock face is rough. Rock breaks away a few cells past the planned
    // profile, mostly in the roof (floors stay walkable); developing the stretch fills it back in
    // with concrete to the clean profile.
    const rough = PW.createNoise1D(PW.hash2(x0, y0) + seg.id * 131, 5);
    const breakOut = (x, y) => {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || netAt(world, x, y)) return;
      if (!liningTarget(mat[y * W + x] & ID_MASK)) return;
      PW.set(world, x, y, M.AIR, { quiet: true });
      PW.setLayer(world, 'deco', x, y, 0);
      setL(world, 'tunnelNet', Uint16Array, x, y, net.id);
      setL(world, 'tunnelSeg', Uint16Array, x, y, seg.id);
      PW.setFlag(world, x, y, FLAG.TUNNEL | FLAG.CARVED | FLAG.RAW | FLAG.OVERBREAK);
      PW.setOwner(world, x, y, net.owner);
      PW.setLayer(world, 'back', x, y, rgb(rawBack(net, seg, x, y)));
      fresh.push(y * W + x);
    };
    if (seg.kind === 'shaft') {
      for (let y = y0 + 8; y <= y1; y += 1) {
        for (let k = 1; k <= Math.round((rough(y) + 1) * 1.1); k += 1) breakOut(x0 - k, y);
        for (let k = 1; k <= Math.round((rough(y + 997) + 1) * 1.1); k += 1) breakOut(x1 + k, y);
      }
    } else {
      for (let x = x0; x <= x1; x += 1) {
        const roof = Math.round((rough(x) + 1) * 1.5) + (PW.hash2(x >> 3, seg.id) % 9 === 0 ? 2 : 0);
        for (let k = 1; k <= roof; k += 1) breakOut(x, y0 - k);
      }
      for (let y = y0; y <= y1 - 3; y += 1) {
        for (let k = 1; k <= Math.round((rough(y + 500) + 1) * 1.2); k += 1) breakOut(x0 - k, y);
        for (let k = 1; k <= Math.round((rough(y + 1500) + 1) * 1.2); k += 1) breakOut(x1 + k, y);
      }
    }
    net.cells += fresh.length;
    schedule(world, net, fresh);
    return { ok: true, blocked: false, cells: fresh.length, segment: seg, breached: [...breached] };
  }

  // A single cell opened by mining (ore removed at the face) joins the network as raw tunnel of
  // segment `seg`, and develops in its turn like the rest.
  function claimCell(world, net, seg, x, y) {
    if (netAt(world, x, y)) return false;
    if ((PW.get(world, x, y) & ID_MASK) !== M.AIR) PW.set(world, x, y, M.AIR, { quiet: true });
    setL(world, 'tunnelNet', Uint16Array, x, y, net.id);
    setL(world, 'tunnelSeg', Uint16Array, x, y, seg.id);
    PW.setFlag(world, x, y, FLAG.TUNNEL | FLAG.CARVED | FLAG.RAW);
    PW.setOwner(world, x, y, net.owner);
    PW.setLayer(world, 'deco', x, y, 0);
    PW.setLayer(world, 'back', x, y, rgb(rawBack(net, seg, x, y)));
    net.cells += 1;
    schedule(world, net, [y * world.width + x]);
    return true;
  }

  // When each new cell develops: the wave reaches it one step (1 / rate s) after its neighbour,
  // and never before now, so a new branch is developed from where it joins, at the same pace.
  function schedule(world, net, fresh) {
    if (!fresh.length) return;
    const T = state(world);
    const W = world.width;
    const step = 1 / net.rate;
    const best = new Map();
    const queue = createHeap();
    const inFresh = new Set(fresh);
    const offer = (i, t) => { if (!best.has(i) || t < best.get(i)) { best.set(i, t); queue.push(t, i); } };
    for (const i of fresh) {
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (inFresh.has(j) || netAt(world, j % W, (j / W) | 0) !== net.id) continue;
        offer(i, Math.max(T.time, devAtOf(world, j % W, (j / W) | 0)) + step);
      }
    }
    if (!queue.size) {
      // The network's first dig: the wave starts at the root (or the nearest new cell to it).
      let start = fresh[0], bestD = Infinity;
      for (const i of fresh) {
        const d = Math.abs(i % W - net.root.x) + Math.abs(((i / W) | 0) - net.root.y);
        if (d < bestD) { bestD = d; start = i; }
      }
      offer(start, T.time);
    }
    while (queue.size) {
      const t = queue.peek(), i = queue.pop();
      if (t > best.get(i)) continue;
      const x = i % W, y = (i / W) | 0;
      setL(world, 'tunnelDev', Float32Array, x, y, t);
      T.pending.push(t, i);
      for (const j of [i - 1, i + 1, i - W, i + W]) if (inFresh.has(j)) offer(j, t + step);
    }
  }

  // ---- Development -----------------------------------------------------------------------------------------
  const isInterior = (world, x, y) => netAt(world, x, y) !== 0;
  function insideAnyBox(world, net, x, y) {
    for (const seg of state(world).segments) {
      if (seg.net === net.id && x >= seg.x0 && x <= seg.x1 && y >= seg.y0 && y <= seg.y1) return true;
    }
    return false;
  }
  function liningTarget(id) {
    return (PW.mat.terrain[id] && id !== M.ORE && id !== M.BEDROCK) || id === M.LINING;
  }
  function developCell(world, i) {
    const { mat, width: W } = world;
    const x = i % W, y = (i / W) | 0;
    const flags = PW.getFlags(world, x, y);
    if (!(flags & FLAG.RAW)) return false;
    const T = state(world);
    const net = T.networks[netAt(world, x, y) - 1];
    const seg = T.segments[segAt(world, x, y) - 1];
    if (!net || !seg) return false;
    if ((flags & FLAG.OVERBREAK) && !insideAnyBox(world, net, x, y)) {
      // Rock that broke away past the profile is filled with concrete: the lining's face. A
      // fitting fixed there (a pipe along the wall) is cast into the concrete in a sleeve.
      const fitting = flags & FLAG.FIXTURE ? PW.getLayer(world, 'back', x, y) : 0;
      setL(world, 'tunnelNet', Uint16Array, x, y, 0);
      setL(world, 'tunnelSeg', Uint16Array, x, y, 0);
      PW.setFlag(world, x, y, FLAG.TUNNEL | FLAG.CARVED | FLAG.RAW | FLAG.OVERBREAK, false);
      PW.setLayer(world, 'back', x, y, 0);
      if (PW.mat.open[mat[i] & ID_MASK]) {
        const facing = y < seg.y0 ? 'ceiling' : y > seg.y1 ? 'floor' : 'wall';
        PW.set(world, x, y, M.REINFORCED, { quiet: true });
        PW.setLayer(world, 'paint', x, y, fitting || rgb(liningColor(net, x, y, 1, facing, seg.y1 - y)));
        PW.setOwner(world, x, y, net.owner);
      }
      net.developed += 1;
      return true;
    }
    PW.setFlag(world, x, y, FLAG.RAW, false);
    PW.setFlag(world, x, y, FLAG.DEVELOPED);
    if (!(flags & FLAG.FIXTURE)) PW.setLayer(world, 'back', x, y, rgb(devBack(net, seg, x, y)));
    net.developed += 1;
    // Only cells at the tunnel's edge line the rock around them.
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (!isInterior(world, x + dx, y + dy)) { edge = true; break; }
    if (!edge) return true;
    for (let dy = -LINE; dy <= LINE; dy += 1) {
      for (let dx = -LINE; dx <= LINE; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= world.height - 1 || isInterior(world, nx, ny)) continue;
        const j = ny * W + nx;
        const m = mat[j], id = m & ID_MASK;
        const depth = Math.max(Math.abs(dx), Math.abs(dy));
        if (id === M.REINFORCED) {
          // Already lined: keep the thinner (closer to a face) shading, and only for this network.
          if (PW.getOwner(world, nx, ny) !== net.owner || (m >> 6) + 1 <= depth) continue;
        } else if (!liningTarget(id)) continue;
        const facing = dy > 0 && Math.abs(dx) < depth ? 'floor' : dy < 0 && Math.abs(dx) < depth ? 'ceiling' : 'wall';
        PW.set(world, nx, ny, M.REINFORCED | (depth - 1) << 6, { quiet: true });
        PW.setLayer(world, 'paint', nx, ny, rgb(liningColor(net, nx, ny, depth, facing, seg.y1 - ny)));
        PW.setLayer(world, 'deco', nx, ny, 0);
        PW.setOwner(world, nx, ny, net.owner);
        if (id !== M.REINFORCED) net.lined += 1;
      }
    }
    return true;
  }
  // Advance the development waves by dt seconds (budgeted per call).
  function step(world, dt, budget = 2000) {
    const T = state(world);
    T.time += dt;
    let n = 0;
    while (T.pending.size && T.pending.peek() <= T.time && n < budget) {
      developCell(world, T.pending.pop());
      n += 1;
    }
    return n;
  }
  // Develop everything that is due by `time` (tests and fast-forward).
  function advanceTo(world, time) {
    const T = state(world);
    let n = 0;
    while (T.pending.size && T.pending.peek() <= time) { developCell(world, T.pending.pop()); n += 1; }
    T.time = Math.max(T.time, time);
    return n;
  }

  function stats(world) {
    const T = state(world);
    return { time: T.time, pending: T.pending.size, breaches: T.breaches.length,
      networks: T.networks.map((n) => ({ id: n.id, side: n.side, cells: n.cells, developed: n.developed, lined: n.lined })) };
  }

  PW.tunnels = { RATE, LINE, SET_PITCH, RIB_PITCH, createNetwork, digBox, claimCell, step, advanceTo, networkAt, networkOfOwner, stats, state,
    netAt, devAtOf, rawBack, devBack };
})();
