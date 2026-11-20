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
    const { structural, open, palettes, terrain } = PW.mat;
    const reach = r * (1.35 + 0.25 * Math.min(1, power)), icx = Math.round(cx), icy = Math.round(cy), R = Math.ceil(reach) + 2;
    const x0 = Math.max(1, icx - R), x1 = Math.min(W - 2, icx + R), y0 = Math.max(1, icy - R), y1 = Math.min(H - 2, Math.ceil(cy + reach * 0.8));
    if (icx < x0 || icx > x1 || icy < y0 || icy > y1) return;
    // How many solid cells lie between the blast and each cell (not counting the cell itself), up
    // to 3: the count of the cell before it on the line back to the middle, plus that cell if it is
    // solid. So it is worked out from the middle outward, a quarter at a time, row by row - the
    // cell before always done first - and each cell is scorched as it is reached.
    const bw = x1 - x0 + 1, hidden = new Uint8Array(bw * (y1 - y0 + 1));
    const darken = (color, k) => { const c = PW.unpack(color); return PW.abgr(c[0] * k + 4, c[1] * k + 3, c[2] * k + 2); };
    const { CHUNK_SHIFT: CS, CHUNK_MASK: CM } = PW, CX = world.chunksX, backs = world.back;
    for (let sy = 1; sy >= -1; sy -= 2) for (let ay = sy > 0 ? 0 : 1; ; ay += 1) {
      const dy = ay * sy, y = icy + dy;
      if (y < y0 || y > y1) break;
      // (only the cells of the row within reach: the disc's span of it, a cell to spare)
      const half = Math.sqrt(Math.max(0, reach * reach - (y - cy) * (y - cy))) + 1;
      for (let sx = 1; sx >= -1; sx -= 2) for (let ax = sx > 0 ? 0 : 1; ax <= half; ax += 1) {
        const dx = ax * sx, x = icx + dx;
        if (x < x0 || x > x1) break;
        let between = 0;
        const n = ax > ay ? ax : ay;
        if (n > 1) {
          // (the cell before it: a step back along its longer side, the other side in proportion)
          const px = ax >= ay ? x - sx : icx + Math.round(dx * (n - 1) / n), py = ax >= ay ? icy + Math.round(dy * (n - 1) / n) : y - sy;
          const id = mat[py * W + px] & ID_MASK;
          between = hidden[(py - y0) * bw + (px - x0)] + (!open[id] && id !== M.WATER ? 1 : 0);
          hidden[(y - y0) * bw + (x - x0)] = between > 3 ? 3 : between;
        }
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / reach;
        if (d >= 1) continue;
        // (a ragged edge: the soot thins out in patches)
        const near = 1 - d;
        if ((PW.hash2(x >> 1, y >> 1) & 255) / 255 > near * 2.4) continue;
        const i = y * W + x, id = mat[i] & ID_MASK;
        // (bare ground, and open air with no wall behind it: nothing there takes soot)
        if (id === M.AIR) { const ch = backs[(y >> CS) * CX + (x >> CS)]; if (!ch || !ch[(y & CM) << CS | x & CM]) continue; }
        else if (terrain[id]) continue;
        const owner = PW.getOwner(world, x, y);
        const building = owner > 0 && owner < 50000;
        const again = (PW.getFlags(world, x, y) & PW.FLAG.SCORCH) !== 0;
        const k = again ? 0.9 : 1 - 0.58 * Math.min(1, near * 1.7);
        if (id !== M.AIR && (structural[id] || building)) {
          if (between > 2) continue;
          const paint = PW.getLayer(world, 'paint', x, y) || palettes[id][((mat[i] >> 6) * 2 + (PW.hash2(x, y) & 1)) & 7];
          PW.setLayer(world, 'paint', x, y, darken(paint, k));
          PW.setFlag(world, x, y, PW.FLAG.SCORCH);
        } else if (id === M.AIR && building && PW.getLayer(world, 'back', x, y)) {
          if (between > 0) continue;
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
    // (and what is already falling or flying in its reach - a tree an earlier blast threw - is
    // thrown back again and torn apart)
    if (world.fragments && world.fragments.blast) world.fragments.blast(cx, cy, r, power);
    const below = r * 0.55;        // craters are wider than deep
    const x0 = Math.max(1, Math.floor(cx - r - 2)), x1 = Math.min(W - 2, Math.ceil(cx + r + 2));
    const y0 = Math.max(0, Math.floor(cy - r - 2)), y1 = Math.min(H - 1, Math.ceil(cy + below + 2));
    // (how hot what it throws out of (x, y) is: as hot as its heat leaves the cell - see heatDisc
    // below - so what flies from the heart of it glows)
    const heatPeak = 380 + 420 * power, heatR = r * 1.15;
    const hotAt = (x, y) => { const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / heatR; return d < 1 ? PW.AMBIENT + (heatPeak - PW.AMBIENT) * (1 - d) * Math.sqrt(1 - d) : PW.AMBIENT; };
    const fling = (x, y, speed, up) => {
      const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const a = speed * (0.55 + random() * 0.8);
      return [dx / d * a + (random() - 0.5) * speed * 0.5, dy / d * a * 0.6 - up * (0.6 + random() * 0.7)];
    };
    // What the blast has to pass through on its way to each cell takes strength out of it: rock
    // shields what lies behind it, so in a mountain a blast chips out a small rough hole where in
    // soil it blows out a wide crater. (Worked outward from the middle: each cell's shielding is
    // that of the cell before it on the line back to the middle plus what that cell resists - a
    // quarter at a time, row by row, as the scorch is: see scorchBuildings.)
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, shield = new Float32Array(bw * bh);
    const icx = Math.round(cx), icy = Math.round(cy), resist = PW.mat.blastResist;
    if (icx >= x0 && icx <= x1 && icy >= y0 && icy <= y1) {
      for (let sy = 1; sy >= -1; sy -= 2) for (let ay = sy > 0 ? 0 : 1; ; ay += 1) {
        const dy = ay * sy, y = icy + dy;
        if (y < y0 || y > y1) break;
        for (let sx = 1; sx >= -1; sx -= 2) for (let ax = sx > 0 ? 0 : 1; ; ax += 1) {
          const dx = ax * sx, x = icx + dx;
          if (x < x0 || x > x1) break;
          const n = ax > ay ? ax : ay;
          if (n < 2) continue;
          const px = ax >= ay ? x - sx : icx + Math.round(dx * (n - 1) / n), py = ax >= ay ? icy + Math.round(dy * (n - 1) / n) : y - sy;
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
            particles.spawn(x + 0.5, y + 0.5, vx, vy, M.DEBRIS, back, F.LAND | F.DAMAGE, 6, building ? backOwner : 0, hotAt(x, y));
          }
        }
        // A pipe fixed to the wall of a tunnel or a cave is torn off with it.
        const wallPipe = strength > 0.3 ? PW.getLayer(world, 'pipe', x, y) : 0;
        if (wallPipe) {
          PW.setLayer(world, 'pipe', x, y, 0);
          if (random() < 0.2) {
            const [vx, vy] = fling(x, y, 280 * power, 160 * power);
            particles.spawn(x + 0.5, y + 0.5, vx, vy, M.DEBRIS | PW.DEBRIS_KIND.METAL << 6, wallPipe, F.LAND, 6, 0, hotAt(x, y));
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
          particles.spawn(x + 0.5, y + 0.5, vx, vy, m, 0, F.WATER, 6, 0, hotAt(x, y));
        } else if (structural[id] || ownerId) {
          if (ownerId) damaged.set(ownerId, (damaged.get(ownerId) || 0) + 1);
          // A building's broken structure is thrown well back from the blast in a plume: most of
          // it, fast, flung outward and up.
          if (random() < 0.85) {
            const [vx, vy] = fling(x, y, 480 * power, 300 * power);
            particles.spawn(x + 0.5, y + 0.5, vx, vy, breaksTo[id] || M.DEBRIS, paint || 0, F.LAND | F.DAMAGE, 7, ownerId, hotAt(x, y));
          }
        } else if (phase[id] >= PW.PHASE.POWDER && (random() < 0.06 || (PW.hash2(Math.floor((x + (PW.hash2(y >> 1, 5) & 3)) / 5), Math.floor((y + (PW.hash2(x >> 1, 6) & 3)) / 5)) & 1023) < 200)) {
          // (ground blown out is thrown in lumps - whole patches of it, about a fifth - and grit)
          const [vx, vy] = fling(x, y, 260 * power, 170 * power);
          particles.spawn(x + 0.5, y + 0.5, vx, vy, breaksTo[id] || M.LOOSE_SOIL, 0, F.LAND, 6, 0, hotAt(x, y));
        }
        // Pulverised earth hangs in the air as a dust cloud.
        if (PW.mat.terrain[id] && random() < DUST_SHARE) PW.set(world, x, y, M.DUST | (1 + (random() < 0.5 ? 1 : 0)) << 6, { quiet: true });
      }
    }
    scorchBuildings(world, cx, cy, r, power);
    // The fireball, its sparks and shrapnel, and its smoke (see fireball); its heat is real, so it
    // can scorch and ignite.
    if (world.heatSystem) world.heatSystem.heatDisc(cx, cy, r * 1.15, 380 + 420 * power);
    sparks(world, particles, cx, cy, r, power, random);
    const open = fireball(world, particles, cx, cy, r, power, random);
    // (the smoke it drives into tunnels and rooms, where it is shut in: see smokeBurst)
    smokeBurst(world, cx, cy, r, power, random, open);
    // A crater (not a blast in the open air) smoulders on, its plume hanging over the place long
    // after the strike - a big one's for a minute and more - dying down as it goes.
    if (removed > r) addSmoulder(world, cx, Math.min(H - 2, cy + below), 12 + r * 0.5 * power, r * 0.6);
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
    // (and everything loose in and about the crater - underground too - is stirred by it; the Game
    // of Life's cells it reaches are blown away)
    PW.stir(world, cx - r * 2, cy - r * 2, cx + r * 2, cy + r * 2, 120);
    if (world.lifeGame) world.lifeGame.clear(cx - r * 1.6, cy - r * 1.6, cx + r * 1.6, cy + r * 1.2);
    return { removed, damaged };
  }

  // ---- The blast as it looks ------------------------------------------------------------------------
  // A blast is a fireball: billows of fire bursting out of its core - white-hot at first, a flash,
  // then mottled yellow and orange with dark red creases, sooting over from the top as they cool -
  // that brake hard, swell and cool to smoke within a moment, the hottest rising fastest (a big
  // blast's hot core climbs as a column under its cap). The fire goes out where there is room for
  // it, as far as there is: on open ground it spreads in a dome flattened along the ground, out of
  // a crater it shoots up in a cone, beside a wall it is thrown away from it, in a tunnel it races
  // along it (see openRays). Ahead of it the core drives dark smoke billows outward, and a blast at
  // the ground sends a low surge rolling out along it, dusty from the earth it threw up. Sparks
  // and shrapnel fly out of it. Its smoke comes as billows - round, cauliflower-edged puffs, lit on
  // top and shaded beneath - each moving as a whole: braking, swelling, rising, drifting with the
  // wind (the weather's and the blast's own: see PW air), held back by the ground and by what
  // stands, and thinning away. They are drawn only over open air. (Where the blast is shut in - a
  // tunnel, a room - its smoke is real gas cells instead, flooding along the ways open to it: see
  // smokeBurst.)
  const DUST_SHARE = 0.12;       // of the earth a blast blows out, what hangs in the air as dust
  const BRAKE = 7;               // per second: how hard what is thrown out of the core brakes
  const RAYS = 48;
  // How far the open air runs from the blast's middle in each of RAYS directions, up to `reach`
  // (cells): the way open to its fire.
  function openRays(world, cx, cy, reach) {
    const { mat, width: W, height: H } = world, OPEN = PW.mat.open;
    const out = new Float32Array(RAYS);
    for (let k = 0; k < RAYS; k += 1) {
      const a = k / RAYS * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let d = 0;
      for (; d < reach; d += 1) {
        const x = Math.round(cx + dx * d), y = Math.round(cy + dy * d);
        if (x < 1 || x >= W - 1 || y >= H - 1) break;
        if (y < 0) continue;
        const id = mat[y * W + x] & ID_MASK;
        if (!OPEN[id] || id === M.WATER) break;
      }
      out[k] = d;
    }
    return out;
  }
  // (a direction out of the blast, more likely the more room there is that way; with how far)
  function pickRay(rays, random, power = 2) {
    let total = 0;
    for (let k = 0; k < RAYS; k += 1) total += rays[k] ** power;
    let t = random() * total, k = 0;
    for (; k < RAYS - 1; k += 1) { t -= rays[k] ** power; if (t <= 0) break; }
    return { a: (k + random() - 0.5) / RAYS * Math.PI * 2, len: rays[k] };
  }
  // (the share of open air round a blast: in the open its smoke is billows, shut in it is gas)
  function openShare(world, cx, cy, r) {
    const { mat, width: W, height: H } = world, OPEN = PW.mat.open;
    let open = 0, n = 0;
    for (let k = 0; k < 64; k += 1) {
      const a = k / 64 * Math.PI * 2, d = r * (0.6 + (k & 3) * 0.3);
      const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      n += 1;
      const id = mat[y * W + x] & ID_MASK;
      if (OPEN[id] && id !== M.WATER && !(y > world.groundTop[x] && !PW.getLayer(world, 'back', x, y) && (PW.getFlags(world, x, y) & PW.FLAG.TUNNEL))) open += 1;
    }
    return n ? open / n : 0;
  }
  // A billow: where it is and goes (cells, cells/s), its size now and what it swells to, its heat
  // (1 white fire .. 0 smoke) and how fast it cools, how thick it is and how long it lasts, and
  // whether it rolls along the ground.
  // A billow: a clump of pixels - flame or smoke, each its own particle - in a disc `size` across
  // at (x, y), thrown (vx, vy) and swelling as it goes (the further out of its middle, the faster
  // out, at `swell` cells/s at its rim), `fill` of its cells taken. Each pixel is lit or shaded by
  // where it sits in it - on top lit, beneath in shadow - and a flame carries the shade it will
  // have as smoke (or none, `smoke` the chance it leaves any). Its rim burns out first.
  const SOOT_TONES = [[122, 116, 110], [86, 81, 77], [56, 52, 50]];
  const GREY_TONES = [[150, 145, 139], [111, 106, 101], [74, 70, 67]];
  const DUST_TONES = [[160, 142, 112], [124, 109, 87], [86, 74, 60]];
  function billow(particles, random, x, y, vx, vy, size, fill, swell, fl, life, tones, alpha, smoke = 1) {
    const n = Math.max(3, Math.round(Math.PI * size * size * fill));
    for (let k = 0; k < n; k += 1) {
      const a = random() * Math.PI * 2, d = size * Math.sqrt(random());
      const ox = Math.cos(a) * d, oy = Math.sin(a) * d;
      const light = -(ox * 0.45 + oy * 0.9) / size + (random() - 0.5) * 0.3;
      const t = tones[light > 0.28 ? 0 : light > -0.3 ? 1 : 2];
      const keep = random() < smoke ? alpha : 0;
      particles.spawn(x + ox, y + oy, vx + ox / size * swell, vy + oy / size * swell, 0,
        PW.abgr(t[0], t[1], t[2], Math.round(keep * 255)), fl, life * (0.65 + 0.35 * (1 - d / size)) * (0.85 + random() * 0.3));
    }
    return n;
  }
  function fireball(world, particles, cx, cy, r, power, random) {
    const F = PW.PARTICLE;
    const open = openShare(world, cx, cy, r);
    // (its size: the blast's, and more as there is more room for it - shut in, it is squeezed
    // along the ways open to it)
    const R = r * (0.95 + 0.35 * Math.min(2, power)) * (0.6 + 0.4 * Math.sqrt(open));
    const rays = openRays(world, cx, cy, R * 2.2);
    // (never more pixels than the particles have room for: a big blast's are sparser)
    const fill = Math.max(0.12, Math.min(1, (particles.capacity * 0.7 - particles.count) / (R * R * 20)));
    // The fire bursting out of the core, along the ways open to it - as far as each runs, and more
    // of it the more room: white-hot as it bursts out (the flash), then yellow, orange, dark red,
    // and as it dies most of it leaves a sooty pixel of smoke.
    for (let k = 0, n = 10 + Math.round(r / 3); k < n; k += 1) {
      const { a, len } = pickRay(rays, random);
      const out = Math.min(len * 0.85, R * (0.45 + random() * 0.8));
      const size = Math.min(R * (0.2 + random() * 0.16), Math.max(3, len * 0.45));
      billow(particles, random, cx + Math.cos(a) * size * 0.3, cy + Math.sin(a) * size * 0.3, Math.cos(a) * out * BRAKE, Math.sin(a) * out * BRAKE,
        size, 0.85 * fill, size * 2.2, F.FIRE, 0.45 + random() * 0.45 + r / 300, SOOT_TONES, 0.75, 0.6);
    }
    // Out in the open, smoke driven ahead of the fire by the core, the same ways out; and at the
    // ground a low surge rolling out along it each way it is open, dusty off earth.
    if (open >= 0.35) {
      for (let k = 0, n = 6 + Math.round(r / 6); k < n; k += 1) {
        const { a, len } = pickRay(rays, random, 1);
        const out = Math.min(len * 0.9, R * (1 + random() * 0.6));
        billow(particles, random, cx, cy, Math.cos(a) * out * BRAKE, Math.sin(a) * out * BRAKE, R * (0.13 + random() * 0.1), 0.45 * fill, R * 0.6,
          F.SMOKE, 2.2 + random() * 2.2, GREY_TONES, 0.7);
      }
      const gx = Math.round(cx), g = world.groundTop[Math.max(0, Math.min(world.width - 1, gx))];
      if (g - cy < R * 1.1 && g >= cy - 2) {
        const tones = PW.mat.terrain[PW.get(world, gx, g) & ID_MASK] === 1 ? DUST_TONES : GREY_TONES;
        for (const d of [-1, 1]) {
          const along = rays[d > 0 ? 0 : RAYS / 2];
          if (along < R * 0.4) continue;
          for (let k = 0, n = 3 + Math.round(r / 10); k < n; k += 1) {
            const out = Math.min(along * 1.4, R * (0.9 + random() * 1.1 + k * 0.3));
            const size = R * (0.1 + random() * 0.08);
            billow(particles, random, cx + d * R * 0.2, g - size, d * out * BRAKE, -random() * R * 0.5, size, 0.45 * fill, R * 0.5,
              F.SMOKE, 2.5 + random() * 2.5, tones, 0.7);
          }
        }
      }
    }
    return open;
  }
  // Sparks - bright, fast, arcing out of the fireball - and shrapnel: dark splinters of the casing
  // flung far and fast, that hurt what they hit and lie where they land.
  function sparks(world, particles, cx, cy, r, power, random) {
    const F = PW.PARTICLE;
    for (let k = 0, n = 60 + r * 3; k < n; k += 1) {
      const a = random() * Math.PI * 2, sp = (180 + random() * 420) * power;
      // (a spark's colour is its heat: white-hot, yellow, orange - each cooling as it flies)
      const hot = [[255, 250, 220], [255, 222, 120], [255, 170, 60], [240, 110, 30]][k & 3], heat = [1450, 1250, 1050, 900][k & 3];
      const x = cx + Math.cos(a) * r * 0.2, y = cy + Math.sin(a) * r * 0.2;
      // (a streak: the spark and a dimmer one trailing it)
      particles.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 50, 0, PW.abgr(hot[0], hot[1], hot[2]), F.GLOW, 0.2 + random() * 0.6, 0, heat);
      if (k & 1) particles.spawn(x - Math.cos(a) * 1.5, y - Math.sin(a) * 1.5, Math.cos(a) * sp * 0.97, Math.sin(a) * sp * 0.97 - 50, 0, PW.abgr(hot[0], hot[1] * 0.7, hot[2] * 0.5), F.GLOW, 0.15 + random() * 0.35, 0, heat - 150);
    }
    const SHRAPNEL = M.DEBRIS | PW.DEBRIS_KIND.METAL << 6;
    for (let k = 0, n = Math.round(r * 0.6); k < n; k += 1) {
      const a = random() * Math.PI * 2, sp = (300 + random() * 360) * power;
      const c = 46 + (random() * 30 | 0);
      particles.spawn(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp - 40, SHRAPNEL, PW.abgr(c, c - 2, c - 4), F.LAND | F.DAMAGE, 4, 0, 950);
    }
  }
  // The blast's smoke where it is shut in: a body of gas driven out of the fireball into the space
  // round it, nearest first along the ways open to it - round corners, along tunnels, through
  // rooms and out of their doors and broken windows, never through anything solid. It comes out
  // fast and ever slower - the share of it out by time t is 1 - e^(-kt), k the air's brake on it -
  // so in a tunnel, with nowhere else to go, it shoots far along it, filling it, thick. Where it
  // comes out into the open it is the billows' (see fireball): no gas is laid there. Laid, it is
  // ordinary smoke: it rises, drifts and thins.
  const SMOKE_RATE = 2.36 + 5.31 * PW.mat.advection[M.SMOKE];   // k, per second
  const SMOKE_REACH = 4;         // it goes at most this many times as far as it would in the open
  const ROOMY = 0.7, CRAMPED = 0.45;   // (share of open-air room a ring of it had: see stepSmokeBursts)
  const SMOKE_VISITS = 12000;    // cells a tick the bursts' rings are worked out over, at most
  function smokeBurst(world, cx, cy, r, power, random, open = 0) {
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
    // (out in the open, its billows carry it: the gas goes only where it is shut in, and is not
    // looked for far beyond the billows' reach)
    const dist = distances();
    dist.set(start % W, (start / W) | 0, 0);
    (world.smokeBursts || (world.smokeBursts = [])).push({ cx, cy, reach, seed: PW.hash2(cx | 0, cy | 0),
      volume: Math.PI * radius * radius * 1.6 * (1 - 0.7 * open), used: 0, age: 0, maxD: radius * (open > 0.5 ? 1.6 : SMOKE_REACH),
      billows: open >= 0.35, buckets: [[start]], dist, b: 0 });
  }
  // (a burst's distances out along the ways open to it, cell by cell: kept in square pages of the
  // world, made as it reaches them - it can go hundreds of cells along a tunnel - and read with
  // the page last used at hand, as its neighbours nearly always are)
  const PAGE = 5, PAGE_MASK = (1 << PAGE) - 1;
  function distances() {
    const pages = new Map();
    let lastKey = -1, last = null;
    const pageOf = (x, y, make) => {
      const key = (y >> PAGE) * 65536 + (x >> PAGE);
      if (key === lastKey) return last;
      let p = pages.get(key);
      if (!p) { if (!make) return null; p = new Float32Array(1 << PAGE * 2).fill(-1); pages.set(key, p); }
      lastKey = key; last = p;
      return p;
    };
    return {
      get(x, y) { const p = pageOf(x, y, false); return p ? p[(y & PAGE_MASK) << PAGE | x & PAGE_MASK] : -1; },
      set(x, y, d) { pageOf(x, y, true)[(y & PAGE_MASK) << PAGE | x & PAGE_MASK] = d; },
    };
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
    // (the rings are worked out SMOKE_VISITS cells a tick at most, all bursts together: out in the
    // open, where the billows carry the smoke and no gas is laid, the rings are wide and none of
    // them uses any of it up - the search runs on to its reach - so a burst there spreads its
    // search over the moments after the blast, as the billows go out)
    let visits = SMOKE_VISITS;
    for (let k = list.length - 1; k >= 0; k -= 1) {
      const s = list[k];
      s.age += dt;
      const due = s.volume * Math.min(1, (1 - Math.exp(-SMOKE_RATE * s.age)) * 1.04);
      while (s.used < due && s.b < s.buckets.length && s.b <= s.maxD && visits > 0) {
        const cells = s.buckets[s.b] || [];
        s.buckets[s.b] = null;
        visits -= cells.length;
        const ring = [];
        for (let q = 0; q < cells.length; q += 1) {
          const i = cells[q];
          if (!OPEN[mat[i] & ID_MASK]) continue;
          ring.push(i);
          const x = i % W, y = (i / W) | 0, d = s.dist.get(x, y);
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy, j = ny * W + nx;
            if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || !OPEN[mat[j] & ID_MASK] || s.dist.get(nx, ny) >= 0) continue;
            const a = Math.atan2(ny - s.cy, nx - s.cx);
            const nd = d + (dx && dy ? 1.414 : 1) / s.reach[((a / (Math.PI * 2) * 256) | 0) & 255];
            s.dist.set(nx, ny, nd);
            const nb = Math.floor(nd);
            (s.buckets[nb] || (s.buckets[nb] = [])).push(j);
          }
        }
        const room = Math.min(1, ring.length / Math.max(6, 2 * Math.PI * s.b));
        for (const i of ring) {
          const h = PW.hash2(i, s.seed);
          // (in the open: the billows' - anywhere it is not shut in - or, with none, patchy)
          if (s.billows ? room >= CRAMPED : room > ROOMY && (h & 1023) < 154) continue;
          const density = room < CRAMPED ? 3 : 2 + ((h >>> 10) & 1);
          const m = mat[i], id = m & ID_MASK;
          if (id === M.AIR) PW.set(world, i % W, (i / W) | 0, M.SMOKE | density << 6, { quiet: true });
          else if (id === M.SMOKE && (m >> 6) < density) { mat[i] = M.SMOKE | density << 6; PW.markDirty(world, i % W, (i / W) | 0, PW.DIRTY_BASE, true); }
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
  // Under the open sky it sends up a plume (see plume); shut in - a room, a tunnel - it fills the
  // space round it with smoke.
  function addSmoulder(world, x, y, seconds, width) {
    (world.smoulders || (world.smoulders = [])).push({ x, y, width: Math.max(4, width), life: seconds, left: seconds, n: 0, age: 0,
      seed: (PW.hash2(x | 0, y | 0) & 1023) / 163, acc: 0, sky: false, skyAt: -1e9 });
  }
  // (the first open cell over the smouldering ground at column x - off the top of what lies on it
  // - or -1)
  function smokeFrom(world, x, y) {
    const { mat, width: W, height: H } = world;
    if (x < 1 || x >= W - 1) return -1;
    y = Math.min(H - 2, Math.round(y));
    for (let up = 0; up < 80 && y > 1 && PW.mat.phase[mat[y * W + x] & ID_MASK] >= PW.PHASE.LIQUID; up += 1) y -= 1;
    return PW.mat.open[mat[y * W + x] & ID_MASK] ? y : -1;
  }
  // (is it under the open sky - nothing over two or more of five places across the middle of it
  // for SKY_CLEAR cells? A slab of ruin lying across a heap does not shut its smoke in)
  const SKY_CLEAR = 60;
  function underSky(world, s) {
    const { mat, width: W } = world;
    let clear = 0;
    for (let q = -2; q <= 2; q += 1) {
      const x = Math.round(s.x + q * s.width * PLUME_CORE / 4), y = smokeFrom(world, x, s.y);
      if (y < 0) continue;
      let open = true;
      for (let k = 1; k <= SKY_CLEAR && y - k >= 0 && open; k += 1) open = PW.mat.open[mat[(y - k) * W + x] & ID_MASK] === 1;
      if (open && (clear += 1) >= 2) return true;
    }
    return false;
  }
  // A plume over smouldering ground in the open - a crater, a heap of rubble in the street: smoke
  // pixels sent up one by one from all over the patch, dark and thick where they leave it and
  // thinning as they climb (PARTICLE.THIN), rising and drifting on the wind - stronger the higher
  // they are - so the column leans over and spreads as it goes, and hangs over the place long after,
  // dying down as the smouldering does. A stream that swells and slackens: no standing column, no
  // flat underside.
  const PLUME_RATE = 1.8;      // smoke pixels a second for each cell across the patch, at its height
  const PLUME_CORE = 0.35;     // share of the patch's width the column rises from: its hottest middle
  const PLUME_TONES = [[104, 98, 93], [84, 79, 75], [66, 62, 59]];
  // (many at once - a battle's worth of strikes - each is the thinner: they never take more than
  // PLUME_SHARE of the particles between them)
  const PLUME_SHARE = 0.35;
  function plume(world, s, f, swell, dt) {
    const particles = world.particles;
    if (!particles || particles.count > particles.capacity * PLUME_SHARE) return;
    s.acc += PLUME_RATE * s.width * Math.pow(f, 1.2) * (0.5 + swell) * dt;
    const spread = s.width * PLUME_CORE * (1 + (1 - f) * 0.9), F = PW.PARTICLE;
    while (s.acc >= 1) {
      s.acc -= 1; s.n += 1;
      const h = PW.hash3(s.x | 0, s.n, 5), h2 = PW.hash3(s.n, s.y | 0, 9);
      const x = s.x + ((h & 1023) / 1023 - 0.5) * spread, y = smokeFrom(world, Math.round(x), s.y);
      if (y < 0) continue;
      // (the darkest leaves the heap's heart; each lighter, thinner the less it smoulders)
      const t = PLUME_TONES[2 - Math.min(2, Math.floor(((h >>> 10) & 255) / 255 * 1.5 * (1.6 - f) + Math.abs(x - s.x) / Math.max(1, spread) * 2.4))];
      const alpha = (0.7 + ((h >>> 18) & 15) / 15 * 0.2) * (0.55 + 0.45 * f);
      particles.spawn(x + 0.5, y + 0.5, (((h >>> 22) & 31) - 15.5) * 0.4, -(16 + (h2 & 31) / 31 * 16), 0, PW.abgr(t[0], t[1], t[2], Math.round(alpha * 255)),
        F.SMOKE | F.THIN, (9 + ((h2 >>> 5) & 63) / 63 * 7) * (0.6 + 0.4 * f));
    }
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
      const swell = 0.5 + 0.5 * Math.sin(s.age * 2.1 + s.seed) * Math.sin(s.age * 0.83 + s.seed * 1.7);
      // (under the open sky - looked at again now and then: what lay over it can be cleared, or
      // come down on it - a plume)
      if (s.age - s.skyAt >= 2) { s.sky = underSky(world, s); s.skyAt = s.age; }
      if (s.sky) { plume(world, s, f, swell, dt); continue; }
      const rate = Math.pow(f, 1.5) * (2 + s.width / 6) * Math.max(0.08, swell);   // smoke cells per tick
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
