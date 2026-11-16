'use strict';
// Explosions: steep-walled, flat-bottomed craters carved by material hardness, with terrain ejecta,
// widely scattered building debris, water thrown as droplets (conserved), shredded vegetation,
// scorched rims, a fireball, sparks and smoke. Damaged buildings are reported for collapse checks.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, structural, hardness, breaksTo, palettes } = PW.mat;
  // Rock laid bare behind a blasted-away tunnel or shaft wall: dark and blackened.
  const BLASTED_ROCK = [[46, 38, 32], [38, 32, 27], [52, 43, 36], [34, 29, 25]].map((c) => PW.abgr(c[0], c[1], c[2]));

  // Soot and scorch on the buildings round a blast: the faces it reached - walls and floors a
  // couple of cells deep, and back walls in the open - are darkened, deepest by the hole and
  // thinning out raggedly to nothing; what lies behind a wall is shielded. A building keeps its
  // scorch until it is repaired.
  function scorchBuildings(world, cx, cy, r, power) {
    const { mat, width: W, height: H } = world;
    const { structural, open, palettes } = PW.mat;
    const reach = r * (1.35 + 0.25 * Math.min(1, power)), x0 = Math.max(1, Math.floor(cx - reach)), x1 = Math.min(W - 2, Math.ceil(cx + reach));
    const y0 = Math.max(1, Math.floor(cy - reach)), y1 = Math.min(H - 2, Math.ceil(cy + reach * 0.8));
    // (solid cells between the blast and (x, y), not counting (x, y) itself)
    const between = (x, y, most) => {
      const dx = x - cx, dy = y - cy, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
      let hit = 0;
      for (let s = 1; s < n; s += 1) {
        const px = Math.round(cx + dx * s / n), py = Math.round(cy + dy * s / n);
        if (!open[mat[py * W + px] & ID_MASK] && (mat[py * W + px] & ID_MASK) !== M.WATER && (hit += 1) > most) return hit;
      }
      return hit;
    };
    const darken = (color, k) => { const c = PW.unpack(color); return PW.abgr(c[0] * k + 4, c[1] * k + 3, c[2] * k + 2); };
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x - cx, y - cy) / reach;
        if (d >= 1) continue;
        // (a ragged edge: the soot thins out in patches)
        const near = 1 - d;
        if ((PW.hash2(x >> 1, y >> 1) & 255) / 255 > near * 2.4) continue;
        const i = y * W + x, id = mat[i] & ID_MASK, owner = PW.getOwner(world, x, y);
        const building = owner > 0 && owner < 50000;
        const again = (PW.getFlags(world, x, y) & PW.FLAG.SCORCH) !== 0;
        const k = again ? 0.9 : 1 - 0.58 * Math.min(1, near * 1.7);
        if (id !== M.AIR && (structural[id] || building) && !PW.mat.terrain[id]) {
          if (between(x, y, 2) > 2) continue;
          const paint = PW.getLayer(world, 'paint', x, y) || palettes[id][((mat[i] >> 6) * 2 + (PW.hash2(x, y) & 1)) & 7];
          PW.setLayer(world, 'paint', x, y, darken(paint, k));
          PW.setFlag(world, x, y, PW.FLAG.SCORCH);
        } else if (id === M.AIR && building && PW.getLayer(world, 'back', x, y)) {
          if (between(x, y, 0) > 0) continue;
          PW.setLayer(world, 'back', x, y, darken(PW.getLayer(world, 'back', x, y), k));
          PW.setFlag(world, x, y, PW.FLAG.SCORCH);
        }
      }
    }
  }

  function explode(world, particles, spec) {
    const { x: cx, y: cy, radius: r, power = 1, owner = 0 } = spec;
    const random = world.random || PW.createRandom(PW.hash2(cx | 0, cy | 0));
    const F = PW.PARTICLE;
    const { mat, width: W, height: H } = world;
    const damaged = new Map();     // building id -> cells destroyed
    let removed = 0;
    // (what it breaks loose - here, felling trees, and in the next moments, a building's top whose
    // supports it took out - is thrown away from it: see the falling pieces)
    const log = world.blastLog || (world.blastLog = []);
    log.push({ x: cx, y: cy, r, power, tick: world.tick || 0 });
    while (log.length > 32 || (log.length && (world.tick || 0) - log[0].tick > 120)) log.shift();
    const below = r * 0.55;        // craters are wider than deep
    const x0 = Math.max(1, Math.floor(cx - r - 2)), x1 = Math.min(W - 2, Math.ceil(cx + r + 2));
    const y0 = Math.max(0, Math.floor(cy - r - 2)), y1 = Math.min(H - 1, Math.ceil(cy + below + 2));
    const fling = (x, y, speed, up) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
      const a = speed * (0.55 + random() * 0.8);
      return [dx / d * a + (random() - 0.5) * speed * 0.5, dy / d * a * 0.6 - up * (0.6 + random() * 0.7)];
    };
    // What the blast has to pass through on its way to each cell takes strength out of it: rock
    // shields what lies behind it, so in a mountain a blast chips out a small rough hole where in
    // soil it blows out a wide crater. (Worked outward ring by ring: each cell's shielding is
    // that of the cell one step nearer the centre plus what that cell resists.)
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, shield = new Float32Array(bw * bh);
    const icx = Math.round(cx), icy = Math.round(cy), resist = PW.mat.blastResist;
    for (let k = 1; k <= Math.max(bw, bh); k += 1) {
      for (let dy = -k; dy <= k; dy += 1) {
        const step = Math.abs(dy) === k ? 1 : 2 * k;
        for (let dx = -k; dx <= k; dx += step) {
          const x = icx + dx, y = icy + dy;
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          const d = Math.hypot(dx, dy), px = Math.round(x - dx / d), py = Math.round(y - dy / d);
          if (px < x0 || px > x1 || py < y0 || py > y1 || (px === icx && py === icy)) continue;
          shield[(y - y0) * bw + (x - x0)] = shield[(py - y0) * bw + (px - x0)] + resist[mat[py * W + px] & ID_MASK];
        }
      }
    }
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const nx = (x - cx) / r, ny = (y - cy) / (y > cy ? below : r);
        const s = nx * nx * nx * nx + ny * ny * ny * ny;   // superellipse, p = 4
        if (s > 1.35) continue;
        const i = y * W + x;
        const m = mat[i], id = m & ID_MASK;
        // Vegetation and props in the blast: what is in the heart of it is torn to pieces (leaves
        // flung off, wood thrown out as splinters that land as wood rubble); a plant the blast
        // only reached is knocked over or broken up after the blast (see PW.flora.afterBlast).
        const deco = PW.getLayer(world, 'deco', x, y);
        const flora = deco && PW.flora && (PW.getFlags(world, x, y) & PW.FLAG.FLORA);
        if (flora && s <= 1.1) {
          const plant = PW.flora.recordAt(world, x, y);
          if (plant) plant.blasted = true;
        }
        if (deco && s <= (flora ? 0.45 * Math.min(1.2, power) : 1.1)) {
          PW.setLayer(world, 'deco', x, y, 0);
          const decoOwner = PW.getOwner(world, x, y);
          if (decoOwner > 0 && decoOwner < 50000) damaged.set(decoOwner, damaged.get(decoOwner) || 0);
          if (flora) {
            const plant = PW.flora.recordAt(world, x, y);
            if (plant) plant.hit = true;
            const [vx, vy] = fling(x, y, 220 * power, 140 * power);
            PW.flora.shed(particles, x, y, deco, vx, vy, true, world);
            PW.setFlag(world, x, y, PW.FLAG.FLORA | PW.FLAG.CHARRED | PW.FLAG.WOOD, false);
          } else if (random() < 0.08) {
            const [vx, vy] = fling(x, y, 140 * power, 80);
            particles.spawn(x + 0.5, y + 0.5, vx, vy, 0, deco, F.LEAF, 2 + random() * 2);
          }
        }
        if (s > 1) {
          // Scorch the rim (where the blast reached it: not behind the rock that stopped it).
          if (id !== M.AIR && id !== M.WATER && s < 1.3 && !structural[id] && shield[(y - y0) * bw + (x - x0)] < 0.3) {
            const paint = PW.getLayer(world, 'paint', x, y) || palettes[id][(m >> 6) * 2];
            const c = PW.unpack(paint), k = 0.55 + (s - 1) * 1.2;
            PW.setLayer(world, 'paint', x, y, PW.abgr(c[0] * k, c[1] * k, c[2] * k));
            PW.setFlag(world, x, y, PW.FLAG.SCORCH);   // fades over time (life lane)
          }
          continue;
        }
        const strength = power * (1 - s) * 1.4 + (PW.hash2(x, y) & 255) / 255 * 0.2 - 0.1 - shield[(y - y0) * bw + (x - x0)];
        // Back walls and everything fixed to them break in the blast: a building's walls (the
        // building is told), a tunnel's or shaft's lining and timbering, ladders, rails, belts and
        // pipes on the wall. Underground the rock behind shows through, blackened.
        const backOwner = PW.getOwner(world, x, y);
        const back = strength > 0.3 ? PW.getLayer(world, 'back', x, y) : 0;
        if (back) {
          const building = backOwner > 0 && backOwner < 50000;
          const rock = !building && y > world.groundTop[x] ? BLASTED_ROCK[PW.hash2(x, y) & 3] : 0;
          PW.setLayer(world, 'back', x, y, rock);
          PW.setFlag(world, x, y, PW.FLAG.FIXTURE | PW.FLAG.LADDER, false);
          if (building) {
            if (id === M.AIR) PW.setOwner(world, x, y, 0);
            damaged.set(backOwner, (damaged.get(backOwner) || 0) + 1);
          }
          // (a building's back wall is blown out in panels - whole patches of it, a third of them,
          // flung off as chunks; the rest goes to dust)
          if (building ? (PW.hash2(Math.floor((x + (PW.hash2(y >> 1, 3) & 3)) / 5), Math.floor(y / 5)) % 3) === 0 : random() < 0.15) {
            const [vx, vy] = fling(x, y, 280 * power, 160 * power);
            particles.spawn(x + 0.5, y + 0.5, vx, vy, M.DEBRIS, back, F.LAND | F.DAMAGE, 6, building ? backOwner : 0);
          }
        }
        // A pipe fixed to the wall of a tunnel or a cave is torn off with it.
        const wallPipe = strength > 0.3 ? PW.getLayer(world, 'pipe', x, y) : 0;
        if (wallPipe) {
          PW.setLayer(world, 'pipe', x, y, 0);
          if (random() < 0.2) {
            const [vx, vy] = fling(x, y, 280 * power, 160 * power);
            particles.spawn(x + 0.5, y + 0.5, vx, vy, M.DEBRIS | PW.DEBRIS_KIND.METAL << 6, wallPipe, F.LAND, 6);
          }
        }
        if (id === M.AIR) continue;
        if (id !== M.WATER && strength < hardness[id]) continue;
        const paint = PW.getLayer(world, 'paint', x, y);
        const ownerId = PW.getOwner(world, x, y);
        PW.set(world, x, y, M.AIR);
        removed += 1;
        if (id === M.WATER) {
          const [vx, vy] = fling(x, y, 220 * power, 160 * power);
          particles.spawn(x + 0.5, y + 0.5, vx, vy, m, 0, F.WATER, 6);
        } else if (structural[id] || ownerId) {
          if (ownerId) damaged.set(ownerId, (damaged.get(ownerId) || 0) + 1);
          // A building's broken structure is thrown well back from the blast in a plume: most of
          // it, fast, flung outward and up.
          if (random() < 0.85) {
            const [vx, vy] = fling(x, y, 480 * power, 300 * power);
            particles.spawn(x + 0.5, y + 0.5, vx, vy, breaksTo[id] || M.DEBRIS, paint || 0, F.LAND | F.DAMAGE, 7, ownerId);
          }
        } else if (phase[id] >= PW.PHASE.POWDER && (random() < 0.06 || (PW.hash2(Math.floor((x + (PW.hash2(y >> 1, 5) & 3)) / 5), Math.floor((y + (PW.hash2(x >> 1, 6) & 3)) / 5)) & 1023) < 200)) {
          // (ground blown out is thrown in lumps - whole patches of it, about a fifth - and grit)
          const [vx, vy] = fling(x, y, 260 * power, 170 * power);
          particles.spawn(x + 0.5, y + 0.5, vx, vy, breaksTo[id] || M.LOOSE_SOIL, 0, F.LAND, 6);
        }
        // Pulverised earth hangs in the air as a dust cloud.
        if (PW.mat.terrain[id] && random() < 0.3) PW.set(world, x, y, M.DUST | (1 + (random() < 0.5 ? 1 : 0)) << 6, { quiet: true });
      }
    }
    scorchBuildings(world, cx, cy, r, power);
    // Sparks (light), then the fireball's heat and the smoke it leaves: real cells, so the heat
    // can scorch and ignite, and the smoke rises, drifts with the wind and thins out.
    for (let k = 0; k < 40 + r * 2; k += 1) {
      const a = random() * Math.PI * 2, sp = (120 + random() * 260) * power;
      const hot = [[255, 240, 180], [255, 196, 90], [240, 120, 40]][k % 3];
      particles.spawn(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp - 60, 0, PW.abgr(hot[0], hot[1], hot[2]), F.GLOW, 0.25 + random() * 0.5);
    }
    if (world.heatSystem) world.heatSystem.heatDisc(cx, cy, r * 1.15, 380 + 420 * power);
    smokeBurst(world, cx, cy, r, power, random);
    if (world.effects) world.effects.push({ kind: 'flash', x: cx, y: cy, radius: r * 2.2, age: 0, life: 0.35 });
    // A crater (not a blast in the open air) smoulders, feeding a smoke column for a while.
    if (removed > r) addSmoulder(world, cx, Math.min(H - 2, cy + below), 8 + r * 0.35 * power, r * 1.1);
    // Plants that lost their footing or trunk fall; cover that lost its support or most of
    // itself breaks apart. Nothing is left floating over the crater.
    const box = { x0: x0 - 4, y0: y0 - 4, x1: x1 + 4, y1: y1 + 4 };
    if (PW.flora) PW.flora.afterBlast(world, particles, { x0: box.x0 - r, y0: box.y0 - r, x1: box.x1 + r, y1: box.y1 }, { x: cx, y: cy, r, power });
    // Tunnels it reached are dug out and re-lined by their crews.
    if (PW.tunnels && PW.tunnels.damaged) PW.tunnels.damaged(world, box.x0 - 10, box.y0 - 10, box.x1 + 10, box.y1 + 10);
    if (PW.props) PW.props.afterBlast(world, particles, box);
    if (PW.streetProps) PW.streetProps.afterBlast(world, particles, box, { x: cx, y: cy, power });
    if (world.onDamage) for (const [id, cells] of damaged) world.onDamage(id, cells, cx, cy);
    // The ground around and above the hole is looked at for what lost its footing (the slope over
    // it may come down), and the blast's shock - its heat and pressure - shakes the ground around.
    if (world.stability) {
      world.stability.disturb(x0 - 4, y0 - r * 1.5, x1 + 4, y1 + 4);
    }
    // The blast wave: a burst of pressure in the air that spreads out as a wind.
    if (world.air) world.air.blast(cx, cy, r * 1.4, power);
    if (world.stability) {
      world.stability.shock(cx, cy, Math.pow(r * power, 3));
    }
    return { removed, damaged };
  }

  // The blast's smoke: a body of gas - as much as the blast made - driven out of the fireball into
  // the open space round it, nearest first along the ways open to it: round corners, along tunnels,
  // through rooms and out of their doors and broken windows, never through anything solid. It
  // comes out fast and ever slower - the share of it out by time t is 1 - e^(-kt), k the air's
  // brake on it - so in the open it races out as a near-round disc (a few tongues of it reaching
  // further), and in a tunnel the same smoke, with nowhere else to go, shoots far along it. Where
  // it has room it spreads thin and patchy; squeezed into a tunnel or a room it fills it, thick.
  // Laid, it is ordinary smoke: it rises, drifts and thins.
  const SMOKE_RATE = 2.36 + 5.31 * PW.mat.advection[M.SMOKE];   // k, per second
  const SMOKE_REACH = 4;         // it goes at most this many times as far as it would in the open
  const ROOMY = 0.7, CRAMPED = 0.45;   // (share of open-air room a ring of it had: see stepSmokeBursts)
  function smokeBurst(world, cx, cy, r, power, random) {
    const { mat, width: W, height: H } = world;
    // (the tongues: a few directions in which it carries further)
    const lobes = [];
    for (let k = 0, n = 4 + Math.floor(random() * 4); k < n; k += 1) lobes.push({ a: random() * Math.PI * 2, w: 0.08 + random() * 0.18, h: 0.25 + random() * 0.55 });
    const reach = new Float32Array(256);
    for (let q = 0; q < 256; q += 1) {
      const a = q / 256 * Math.PI * 2;
      reach[q] = 1;
      for (const l of lobes) { const d = Math.abs(((a - l.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI); reach[q] += l.h * Math.exp(-(d / l.w) * (d / l.w)); }
    }
    const radius = r * (1.15 + 0.35 * Math.min(2, power));
    // (where it starts: the fireball's middle, or the open cell nearest it)
    let start = -1;
    for (let d = 0; d <= 4 && start < 0; d += 1) for (let dy = -d; dy <= d && start < 0; dy += 1) for (let dx = -d; dx <= d; dx += 1) {
      const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy;
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && PW.mat.open[mat[y * W + x] & ID_MASK]) { start = y * W + x; break; }
    }
    if (start < 0) return;
    (world.smokeBursts || (world.smokeBursts = [])).push({ cx, cy, reach, seed: PW.hash2(cx | 0, cy | 0),
      volume: Math.PI * radius * radius * 2.4, used: 0, age: 0, maxD: radius * SMOKE_REACH,
      buckets: [[start]], dist: new Map([[start, 0]]), b: 0 });
  }
  // Let out as much of each blast's smoke as is due by now: the next rings of open cells out from
  // it (a ring: the cells the same distance out along the ways open to it), each laid when it is
  // whole. How much room a ring had - its size against a ring as far out in the open - says how
  // the smoke lies in it: roomy, thin and patchy; cramped, thick and filling it.
  function stepSmokeBursts(world, dt) {
    const list = world.smokeBursts;
    if (!list || !list.length) return;
    const { mat, width: W, height: H } = world;
    const OPEN = PW.mat.open;
    for (let k = list.length - 1; k >= 0; k -= 1) {
      const s = list[k];
      s.age += dt;
      const due = s.volume * Math.min(1, (1 - Math.exp(-SMOKE_RATE * s.age)) * 1.04);
      while (s.used < due && s.b < s.buckets.length && s.b <= s.maxD) {
        const cells = s.buckets[s.b] || [];
        s.buckets[s.b] = null;
        const ring = [];
        for (let q = 0; q < cells.length; q += 1) {
          const i = cells[q];
          if (!OPEN[mat[i] & ID_MASK]) continue;
          ring.push(i);
          const x = i % W, y = (i / W) | 0, d = s.dist.get(i);
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy, j = ny * W + nx;
            if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || s.dist.has(j) || !OPEN[mat[j] & ID_MASK]) continue;
            const a = Math.atan2(ny - s.cy, nx - s.cx);
            const nd = d + (dx && dy ? 1.414 : 1) / s.reach[((a / (Math.PI * 2) * 256) | 0) & 255];
            s.dist.set(j, nd);
            const nb = Math.floor(nd);
            (s.buckets[nb] || (s.buckets[nb] = [])).push(j);
          }
        }
        const room = Math.min(1, ring.length / Math.max(6, 2 * Math.PI * s.b));
        for (const i of ring) {
          const h = PW.hash2(i, s.seed);
          if (room > ROOMY && (h & 1023) < 154) continue;          // (in the open: patchy)
          const density = room < CRAMPED ? 3 : 2 + ((h >>> 10) & 1);
          const m = mat[i], id = m & ID_MASK;
          if (id === M.AIR) PW.set(world, i % W, (i / W) | 0, M.SMOKE | density << 6, { quiet: true });
          else if (id === M.SMOKE && (m >> 6) < density) { mat[i] = M.SMOKE | density << 6; PW.markDirty(world, i % W, (i / W) | 0); }
          else continue;
          s.used += density;
        }
        s.b += 1;
      }
      if (s.used >= s.volume || s.b >= s.buckets.length || s.b > s.maxD) list.splice(k, 1);
    }
  }

  // Smouldering ground or rubble at (x, y): for `seconds` it keeps putting smoke into the air over
  // a `width` wide patch (the first open cells above it), dying down as it goes. It does not pour
  // out of one spot in a steady jet: it comes in puffs that swell and slacken, from all over a patch
  // that spreads as the rubble smoulders on, thinner as it dies down, and it tails off softly.
  function addSmoulder(world, x, y, seconds, width) {
    (world.smoulders || (world.smoulders = [])).push({ x, y, width: Math.max(4, width), life: seconds, left: seconds, n: 0, age: 0,
      seed: (PW.hash2(x | 0, y | 0) & 1023) / 163 });
  }
  function stepSmoulders(world, dt) {
    const list = world.smoulders;
    if (!list || !list.length) return;
    const { mat, width: W, height: H } = world;
    for (let k = list.length - 1; k >= 0; k -= 1) {
      const s = list[k];
      s.left -= dt; s.age += dt;
      if (s.left <= 0) { list.splice(k, 1); continue; }
      const f = s.left / s.life;
      const puff = 0.5 + 0.5 * Math.sin(s.age * 2.1 + s.seed) * Math.sin(s.age * 0.83 + s.seed * 1.7);
      const rate = Math.pow(f, 1.5) * (2 + s.width / 6) * Math.max(0.08, puff);   // smoke cells per tick
      let n = Math.floor(rate) + ((PW.hash3(s.x | 0, s.n, 11) & 1023) / 1023 < rate % 1 ? 1 : 0);
      const spread = s.width * (1 + (1 - f) * 0.9);
      while (n-- > 0) {
        s.n += 1;
        const h = PW.hash3(s.x | 0, s.n, 3);
        const x = Math.round(s.x + ((h & 1023) / 1023 - 0.5) * spread);
        if (x < 1 || x >= W - 1) continue;
        let y = Math.min(H - 2, Math.round(s.y));
        for (let up = 0; up < 80 && y > 1 && PW.mat.phase[mat[y * W + x] & ID_MASK] >= PW.PHASE.LIQUID; up += 1) y -= 1;
        // (buried deep under the heap that came down on it, it smokes out of the heap's top)
        if ((mat[y * W + x] & ID_MASK) !== M.AIR && world.groundTop[x] - 1 < y) y = world.groundTop[x] - 1;
        if (y < 1 || (mat[y * W + x] & ID_MASK) !== M.AIR) continue;
        const density = Math.max(0, Math.min(3, Math.round(f * 3 + ((h >>> 10) & 3) / 3 - 0.5)));
        PW.set(world, x, y, M.SMOKE | density << 6, { quiet: true });
      }
    }
  }

  // Short, bright light flashes drawn as cell-aligned dithered discs.
  function drawEffects(world, renderer, dt) {
    if (!world.effects || !world.effects.length) return;
    const { ctx, camera } = renderer;
    const z = camera.zoom, size = Math.max(1, Math.round(z));
    for (let i = world.effects.length - 1; i >= 0; i -= 1) {
      const e = world.effects[i];
      e.age += dt;
      if (e.age >= e.life) { world.effects.splice(i, 1); continue; }
      const t = 1 - e.age / e.life, rr = Math.round(e.radius * (0.6 + 0.4 * (1 - t)));
      const step = Math.max(1, Math.round(1 / z));
      for (let dy = -rr; dy <= rr; dy += step) for (let dx = -rr; dx <= rr; dx += step) {
        const d = Math.hypot(dx, dy) / rr;
        if (d > 1) continue;
        const k = (1 - d) * t;
        if (((dx + dy) & 1) && k < 0.5) continue;
        ctx.fillStyle = k > 0.6 ? `rgba(255,244,200,${k})` : `rgba(255,170,70,${k * 0.8})`;
        ctx.fillRect(Math.round((Math.floor(e.x + dx) - camera.x) * z), Math.round((Math.floor(e.y + dy) - camera.y) * z), size * step, size * step);
      }
    }
  }

  PW.explode = explode;
  PW.drawEffects = drawEffects;
  PW.addSmoulder = addSmoulder;
  PW.stepSmoulders = stepSmoulders;
  PW.stepSmokeBursts = stepSmokeBursts;
})();
