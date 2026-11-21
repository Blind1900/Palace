'use strict';
// Heat and fire. Temperatures live in a sparse per-chunk layer (PW.heatAt / setHeat, moved with
// their material when cells swap). Every fourth simulation tick (15 Hz) the chunks holding heat
// exchange it between neighbouring cells by conductivity, lose it to the surroundings, and hot
// air carries it upward and downwind. Heat changes things: water boils into steam, very hot
// ground is scorched, and flammable materials and plants catch fire. Burning cells need air, are
// put out by water, stay hot (which is how fire spreads), give off smoke and burn down: grass to
// scorched soil, wood to ash, leaves away, trunks to charcoal. Flames are drawn as an overlay.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK, CHUNK, CHUNK_SHIFT, CHUNK_MASK, AMBIENT } = PW;
  const { conduct, ignite, burnTime, burnsTo, open, terrain, palettes } = PW.mat;

  const EVERY = 4;                  // simulation ticks per heat tick
  const DT = EVERY / 60;            // seconds per heat tick
  const COLD = 1.5;                 // °C above ambient below which a cell counts as cold
  const BOIL = 100, LATENT = 250, SCORCH = 420, PLANT_IGNITE = 250;
  const FLAME = 820;                // flame temperature of a burning cell
  const LOSS_OPEN = 0.035, LOSS_OPEN_UNDER = 0.015, LOSS_WATER = 0.012, LOSS_SOLID = 0.004;
  // Water quenches: where water touches something solid (or a heap) the two trade heat far faster
  // than either conducts - the water boiling off it - so hot rock, metal or rubble that meets
  // water goes dark at once, in a hiss of steam. (QUENCH: the share of their difference traded
  // each heat tick.)
  const QUENCH = 0.4;
  // How much heat a cell holds for each degree, against rock's (its volumetric heat capacity -
  // the heat equation's, as the physics references have it): air and the gases little (kept a
  // little more than real, so a fire's heat still carries), water a great deal, metal more than
  // rock, wood and earth less.
  const CAP = new Float32Array(64).fill(1);
  for (const id of [M.AIR, M.SMOKE, M.STEAM, M.DUST]) CAP[id] = 0.1;
  CAP[M.WATER] = 2;
  for (const id of [M.STEEL, M.BRIDGE, M.PIPE, M.COVER_METAL, M.CORE]) if (id !== undefined) CAP[id] = 1.5;
  for (const id of [M.WOOD, M.COVER_WOOD, M.GRASS, M.TOPSOIL, M.SOIL, M.LOOSE_SOIL, M.ASH, M.SAND]) if (id !== undefined) CAP[id] = 0.7;
  // (SHARE[a * 64 + b]: what a cell of a gives up, in degrees, for each degree of a flux to a
  // cell of b - 2 cb / (ca + cb); b gains SHARE[b * 64 + a] of it. Together the two always close
  // their gap by twice the flux, as with equal capacities, so the exchange stays as stable.)
  const SHARE = new Float32Array(64 * 64);
  for (let a = 0; a < 64; a += 1) for (let b = 0; b < 64; b += 1) SHARE[a * 64 + b] = 2 * CAP[b] / (CAP[a] + CAP[b]);
  // (a cell counts as warm while it holds more than COLD degrees' worth of rock's heat - but never
  // longer than COLD degrees above the air: see heatTick)
  const HOLDS = CAP.map((c) => Math.min(1, c));
  // (the metals that melt, at MELT °C: steel beams and plate, bridge steel, metal cover, a pipe's
  // casing - mended like any break in it. Never a core: the god's metal does not melt)
  const MELT = 1350;
  const MELTS = new Uint8Array(64);
  for (const id of [M.STEEL, M.BRIDGE, M.COVER_METAL, M.PIPE]) if (id !== undefined) MELTS[id] = 1;
  const quench = (a, b) => (a === M.WATER) !== (b === M.WATER) && !open[a === M.WATER ? b : a];
  // (KK[a * 64 + b]: the share of their difference a cell of a and one of b trade each heat tick -
  // the lesser conductivity, or QUENCH)
  const KK = new Float32Array(64 * 64);
  for (let a = 0; a < 64; a += 1) for (let b = 0; b < 64; b += 1) KK[a * 64 + b] = quench(a, b) ? QUENCH : Math.min(conduct[a], conduct[b]);
  const RISE = 0.3;                 // share of hot air's excess carried up per heat tick
  const SMOKE_CHANCE = 0.3;         // per burning cell per heat tick

  function createHeat(world) {
    const { mat, width: W, height: H, chunksX } = world;
    const burning = new Map();      // flat index -> { fuel (s), deco (bool), wood (bool), owner }
    const charredAt = new Map();    // flat index -> tick a plant's wood there was charred
    const CHAR_COOL = 60 * 60;      // ticks before charcoal can catch again (a later fire, not this one)
    const rects = new Map();        // chunk -> { warm, next: its warm tiles; box: [x0, y0, x1, y1] round them } (see heatTick)
    const stats = { ms: 0, chunks: 0, burning: 0, ignited: 0, burnedOut: 0, boiled: 0 };
    let tick = 0;
    world.fireByOwner = new Map();  // building / infrastructure id -> burning cells (construction delays)
    const HEAT_POOL = 128;          // cold chunks' arrays kept for chunks warming, at most
    world.heatPool = world.heatPool || [];

    const decoAt = (x, y) => PW.getLayer(world, 'deco', x, y);
    const isOpenCell = (i) => open[mat[i] & ID_MASK] === 1;
    function hasAir(i, x, y) {
      return (x > 0 && isOpenCell(i - 1)) || (x < W - 1 && isOpenCell(i + 1)) || (y > 0 && isOpenCell(i - W)) || (y < H - 1 && isOpenCell(i + W));
    }
    function nearWater(i, x, y) {
      const w = (j) => (mat[j] & ID_MASK) === M.WATER;
      return (x > 0 && w(i - 1)) || (x < W - 1 && w(i + 1)) || (y > 0 && w(i - W)) || (y < H - 1 && w(i + W));
    }

    // ---- Ignition and burning -------------------------------------------------------------------
    function igniteCell(x, y) {
      const i = y * W + x;
      if (burning.has(i)) return false;
      const id = mat[i] & ID_MASK;
      if (ignite[id] && hasAir(i, x, y)) {
        burning.set(i, { fuel: burnTime[id] * (0.8 + (PW.hash2(x, y) & 7) / 20), deco: false, owner: PW.getOwner(world, x, y) });
        stats.ignited += 1;
        return true;
      }
      // A charred snag catches again in a later fire (it is charcoal: it burns a while, and the thin
      // of it goes).
      if (open[id] && decoAt(x, y) && (PW.getFlags(world, x, y) & (FLAG.FLORA | FLAG.CHARRED)) === (FLAG.FLORA | FLAG.CHARRED)) {
        // (not in the fire that charred it: only once it has gone cold)
        if (tick - (charredAt.get(i) ?? -Infinity) < CHAR_COOL) return false;
        burning.set(i, { fuel: 4 + (PW.hash2(x, y) & 7) * 0.4, deco: true, wood: true, charred: true, owner: 0 });
        stats.ignited += 1;
        return true;
      }
      if (open[id] && decoAt(x, y) && (PW.getFlags(world, x, y) & (FLAG.FLORA | FLAG.CHARRED)) === FLAG.FLORA) {
        const c = PW.unpack(decoAt(x, y));
        // green: leaves and grass; brown: bark and stems - a tree's trunk and boughs are wood that
        // burns long; grass, flowers and a bush's twigs flare and are gone
        const plant = PW.flora ? PW.flora.recordAt(world, x, y) : null;
        // (a boulder among the plants does not burn: the fire blackens it with soot)
        if (plant && plant.kind === 'boulder') {
          if (c[0] + c[1] + c[2] > 120) PW.setLayer(world, 'deco', x, y, scorched(decoAt(x, y), 0.5));
          return false;
        }
        const leaf = !(PW.getFlags(world, x, y) & FLAG.WOOD) || !plant;
        const timber = !leaf && plant.kind === 'tree';
        // Leaves flare up and are gone in a second or two; a tree's wood burns on for a long while
        // (a trunk smoulders on after its crown has burnt off) before it is left as charcoal.
        const h = PW.hash2(x, y);
        burning.set(i, { fuel: timber ? 9 + (h & 15) * 0.33 : leaf ? 1.2 + (h & 3) * 0.3 : 2.5 + (h & 7) * 0.2, deco: true, wood: !leaf, owner: 0 });
        // (bark blackens as it burns; where the fire reaches a tree's foot it may smoulder on there
        // for a minute or so after the fire has passed)
        if (!leaf) {
          // (the leaves in front of a branch go first, showing its bark)
          if (c[1] > c[0] + 8) { const k = 0.85 + (h & 3) * 0.06; PW.setLayer(world, 'deco', x, y, PW.abgr(70 * k, 53 * k, 38 * k)); }
          scorchBark(x, y, 0.4);
        }
        if (timber && !plant.smouldered && y >= plant.row - 10 && PW.addSmoulder) {
          plant.smouldered = true;
          if ((h >> 7 & 3) !== 0) PW.addSmoulder(world, x, y - 2, 40 + (h >> 9 & 63), 3 + (h >> 4 & 3));
        }
        stats.ignited += 1;
        return true;
      }
      // Splintered wood from trees and timber, loose or packed into rubble, burns too, to ash.
      if (woodRubble(i) && hasAir(i, x, y)) {
        burning.set(i, { fuel: 6 + (PW.hash2(x, y) & 15) * 0.27, deco: false, rubble: true, owner: 0 });
        stats.ignited += 1;
        return true;
      }
      return false;
    }
    const WOOD = PW.DEBRIS_KIND.WOOD;
    const woodRubble = (i) => { const m = mat[i], id = m & ID_MASK; return (id === M.DEBRIS || id === M.RUBBLE) && (m >> 6) === WOOD; };
    function extinguish(i, x, y) {
      burning.delete(i);
      PW.setHeat(world, x, y, Math.min(PW.heatAt(world, x, y), 90));
    }
    function scorched(color, k = 0.45) {
      const c = PW.unpack(color);
      return PW.abgr(c[0] * k + 6, c[1] * k + 4, c[2] * k + 2);
    }
    // How thick the wood is at (x, y): the narrower of its runs across and up (a trunk's width, a
    // bough's depth, a twig's one or two cells). Leaves do not count; charcoal does.
    const isWood = (x, y) => {
      if (!decoAt(x, y)) return false;
      const f = PW.getFlags(world, x, y);
      return (f & FLAG.FLORA) !== 0 && (f & (FLAG.WOOD | FLAG.CHARRED)) !== 0;
    };
    function woodThickness(x, y) {
      let h = 1, v = 1;
      for (const d of [-1, 1]) {
        for (let k = 1; k < 8 && isWood(x + d * k, y); k += 1) h += 1;
        for (let k = 1; k < 8 && isWood(x, y + d * k); k += 1) v += 1;
      }
      return Math.min(h, v);
    }
    // What a fire leaves of a plant. Leaves, grass, flowers and twigs burn to ash - a little from a
    // leaf, more from wood - that drifts down onto the ground and lies there grey and white (and
    // weathers in time into rich soil, where the green comes back first). A tree's trunk and its
    // thickest boughs are left standing as charcoal - a black, leafless snag, flecked with white
    // ash - until another fire takes more of it; charcoal that burns again goes unless it is thick.
    // The ground a plant burnt on is charred black, and here and there a burnt trunk smoulders on
    // for a minute or so after the fire has passed.
    function burnOut(i, x, y, b) {
      burning.delete(i);
      stats.burnedOut += 1;
      if (b.deco) {
        const h = PW.hash2(x, y);
        const thin = b.wood && woodThickness(x, y) < (b.charred ? 5 : 3);
        const plant = PW.flora ? PW.flora.recordAt(world, x, y) : null;
        if (!b.wood || thin) {
          PW.setLayer(world, 'deco', x, y, 0);
          PW.setFlag(world, x, y, FLAG.FLORA | FLAG.CHARRED | FLAG.WOOD, false);
          // (what that held up may have lost its hold)
          if (thin && plant) (world.floraDirty || (world.floraDirty = new Set())).add(plant);
          // (a leaf leaves only a pinch of ash, a twig a little more: the ground gets a grey-white
          // dusting, not a heap)
          if ((h >> 3) % (b.wood ? 6 : 24) === 0 && world.particles) {
            world.particles.spawn(x + 0.5, y + 0.5, ((h >> 5 & 15) - 7.5) * 1.5, -4, M.ASH | (h & 3) << 6, 0, PW.PARTICLE.LAND, 30);
          }
        } else {
          const k = 0.1 + (h & 3) * 0.03;
          PW.setLayer(world, 'deco', x, y, (h >> 4 & 15) === 0 ? PW.abgr(84, 80, 76) : PW.abgr(52 * k + 14, 44 * k + 13, 40 * k + 12));
          PW.setFlag(world, x, y, FLAG.CHARRED);
          charredAt.set(i, tick);
          if (charredAt.size > 60000) for (const [j, t] of charredAt) if (tick - t > CHAR_COOL) charredAt.delete(j);
        }
        charGround(x, y + 1);
        return;
      }
      if (b.rubble) { if (woodRubble(i)) PW.set(world, x, y, M.ASH | (PW.hash2(x, y) & 3) << 6); return; }
      const id = mat[i] & ID_MASK;
      const to = burnsTo[id];
      if (to === M.ASH) {
        PW.set(world, x, y, M.ASH | (PW.hash2(x, y) & 3) << 6);
      } else if (to) {
        // (burnt turf: charred black, with its ash lying on it)
        PW.set(world, x, y, to | (mat[i] & 0xc0));
        PW.setLayer(world, 'paint', x, y, scorched(palettes[to][(PW.hash2(x, y) & 3) * 2], CHAR));
        PW.setFlag(world, x, y, FLAG.SCORCH);
        if (id === M.GRASS && y > 0 && (mat[i - W] & ID_MASK) === M.AIR && !decoAt(x, y - 1) && (PW.hash2(x, y) & 1)) PW.set(world, x, y - 1, M.ASH | (PW.hash2(y, x) & 3) << 6);
      }
    }
    // The ground under a plant that burnt is charred black (once: the life lane fades it in time).
    const CHAR = 0.3;
    // Bark scorched by the fire beside it, or burning: blackened (darker each time, to near black).
    const BARK_SCORCH = 330;          // °C
    function scorchBark(x, y, k) {
      const d = decoAt(x, y);
      if (!d) return;
      const c = PW.unpack(d);
      if (c[0] + c[1] + c[2] > 70) PW.setLayer(world, 'deco', x, y, scorched(d, k));
    }
    function charGround(x, y) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
      const j = y * W + x, id = mat[j] & ID_MASK;
      if (!terrain[id] || PW.mat.phase[id] !== PW.PHASE.SOLID || (PW.getFlags(world, x, y) & FLAG.SCORCH)) return;
      const paint = PW.getLayer(world, 'paint', x, y) || palettes[id][((mat[j] >> 6) * 2 + (PW.hash2(x, y) & 1)) & 7];
      PW.setLayer(world, 'paint', x, y, scorched(paint, CHAR));
      PW.setFlag(world, x, y, FLAG.SCORCH);
    }
    function puffSmoke(x, y) {
      for (let k = 1; k <= 3; k += 1) {
        if (y - k < 1) return;
        const j = (y - k) * W + x;
        if ((mat[j] & ID_MASK) === M.AIR) { PW.set(world, x, y - k, M.SMOKE | (2 + (PW.hash2(x, y + k) & 1)) << 6, { quiet: true }); return; }
        if (!open[mat[j] & ID_MASK]) return;
      }
    }
    function burnTick() {
      world.fireByOwner.clear();
      for (const [i, b] of burning) {
        const x = i % W, y = (i / W) | 0;
        const id = mat[i] & ID_MASK;
        if (b.deco ? !(open[id] && decoAt(x, y)) : b.rubble ? !woodRubble(i) : !ignite[id]) { burning.delete(i); continue; }
        if (nearWater(i, x, y)) { extinguish(i, x, y); continue; }
        // Starved of air (buried): it smoulders out.
        if (!b.deco && !hasAir(i, x, y)) { b.fuel -= DT * 3; if (b.fuel <= 0) burning.delete(i); continue; }
        PW.setHeat(world, x, y, Math.max(PW.heatAt(world, x, y), FLAME));
        if (y > 0) PW.setHeat(world, x, y - 1, Math.max(PW.heatAt(world, x, y - 1), FLAME * 0.8));
        if ((PW.hash3(x, y, tick) & 1023) / 1023 < SMOKE_CHANCE) puffSmoke(x, y);
        if (b.owner) world.fireByOwner.set(b.owner, (world.fireByOwner.get(b.owner) || 0) + 1);
        // (fire creeps along the bark, down a trunk as well as up it: the wood next to burning wood
        // catches, so a crown fire works its way down the trunk and out along the boughs)
        if (b.wood && (PW.hash3(x, y, tick + 3) & 7) < 2) {
          const d = PW.hash3(x, y, tick) & 3, nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (isWood(nx, ny) && !(PW.getFlags(world, nx, ny) & FLAG.CHARRED)) igniteCell(nx, ny);
        }
        b.fuel -= DT;
        if (b.fuel <= 0) burnOut(i, x, y, b);
      }
      stats.burning = burning.size;
    }

    // ---- Heat transfer -----------------------------------------------------------------------------
    // Exchange between cells a and b (flat indices, temperatures in their chunk arrays).
    function chunkOf(x, y) { return (y >> CHUNK_SHIFT) * chunksX + (x >> CHUNK_SHIFT); }
    // (each chunk is worked every EVERY ticks, the chunks taking turns - a quarter of them a tick,
    // neighbours on different ticks - so a blast's heat, chunks of it at once, is not all worked
    // in the one tick)
    const turnOf = (c) => ((c % chunksX) + (((c / chunksX) | 0) << 1)) % EVERY;
    // (what of a chunk is worked: its warm tiles, 8 x 8 cells - those holding a warm cell when it
    // was last worked, or set since - and the tiles round them, as heat goes a cell a pass either
    // way. A blast's hot rubble lies scattered over chunks round it for many seconds: only the
    // tiles it lies in are worked, not all the chunk between)
    const TS = 3, TN = CHUNK >> TS, TILES = TN * TN;
    const work = new Uint8Array(TILES), spans = new Int32Array(TILES * 2), spanAt = new Int32Array(TN + 1);
    // (and the heat keeps to HEAT_BUDGET ms a tick, as the cell sim keeps to its own: a chunk whose
    // turn comes when the tick's heat work is spent is put off to the next tick - first in line
    // there - so on a loaded tick, the hot rubble of a whole town blown down at once, the heat runs
    // a little behind rather than the frame. Never in a deterministic run: see PW.DETERMINISTIC)
    const HEAT_BUDGET = 1.5;
    const late = new Uint8Array(world.chunkCount);
    function heatTick(turn) {
      const list = world.heatList;
      const keep = [], putOff = [], started = performance.now();
      let worked = 0;
      stats.late = 0;
      for (let n = 0; n < list.length; n += 1) {
        const c = list[n];
        if (turnOf(c) !== turn && !late[c]) { keep.push(c); continue; }
        if (!PW.DETERMINISTIC && worked > 0 && performance.now() - started > HEAT_BUDGET) { late[c] = 1; putOff.push(c); stats.late += 1; continue; }
        late[c] = 0; worked += 1;
        const T = world.heat[c];
        if (!T) { world.heatActive[c] = 0; rects.delete(c); PW.clearHeatBox(world, c); continue; }
        const cx = (c % chunksX) << CHUNK_SHIFT, cy = ((c / chunksX) | 0) << CHUNK_SHIFT;
        const xEnd = Math.min(CHUNK, W - cx), yEnd = Math.min(CHUNK, H - cy);
        // (the warm tiles it knew of, and those of the cells set since - where heat was added, or
        // carried in by a moving cell; a chunk just warmed holds only those)
        const B = world.heatBox, k4 = c << 2;
        let st = rects.get(c);
        if (!st) { st = { warm: new Uint8Array(TILES), next: new Uint8Array(TILES) }; rects.set(c, st); }
        const warm = st.warm, next = st.next;
        if (B[k4] <= B[k4 + 2]) {
          for (let ty = B[k4 + 1] >> TS; ty <= B[k4 + 3] >> TS; ty += 1) for (let tx = B[k4] >> TS; tx <= B[k4 + 2] >> TS; tx += 1) warm[ty * TN + tx] = 1;
        }
        PW.clearHeatBox(world, c);
        work.fill(0);
        for (let t = 0; t < TILES; t += 1) {
          if (!warm[t]) continue;
          const tx = t % TN, ty = (t / TN) | 0;
          for (let v = Math.max(0, ty - 1); v <= Math.min(TN - 1, ty + 1); v += 1) for (let u = Math.max(0, tx - 1); u <= Math.min(TN - 1, tx + 1); u += 1) work[v * TN + u] = 1;
        }
        // (the runs of worked tiles along each row of them, as cells [from, to): row ty's are
        // spans[spanAt[ty]] up to spans[spanAt[ty + 1]])
        let ns = 0;
        for (let ty = 0; ty < TN; ty += 1) {
          spanAt[ty] = ns;
          for (let tx = 0; tx < TN; tx += 1) {
            if (!work[ty * TN + tx]) continue;
            let te = tx;
            while (te + 1 < TN && work[ty * TN + te + 1]) te += 1;
            if (tx << TS < xEnd) { spans[ns++] = tx << TS; spans[ns++] = Math.min(xEnd, (te + 1) << TS); }
            tx = te;
          }
        }
        spanAt[TN] = ns;
        next.fill(0);
        let anyWarm = false;
        for (let ly = 0; ly < yEnd; ly += 1) {
          const s0 = spanAt[ly >> TS], s1 = spanAt[(ly >> TS) + 1];
          if (s0 === s1) continue;
          const y = cy + ly;
          for (let s = s0; s < s1; s += 2) for (let lx = spans[s], lxEnd = spans[s + 1]; lx < lxEnd; lx += 1) {
            const x = cx + lx, li = ly << CHUNK_SHIFT | lx, i = y * W + x;
            let t = T[li];
            // (it and the two it trades with, right and below, all at the air's heat near enough:
            // nothing to work - as is most of a chunk a blast warmed, round what is still hot)
            if (lx < CHUNK - 1 && ly < CHUNK - 1) {
              const a = t - AMBIENT, b = T[li + 1] - AMBIENT, d = T[li + CHUNK] - AMBIENT;
              if (a <= COLD && a >= -COLD && b <= COLD && b >= -COLD && d <= COLD && d >= -COLD) continue;
            }
            const id = mat[i] & ID_MASK;
            const k = conduct[id];
            // Right and down neighbours (inside this chunk directly, across edges via the core).
            // (heat is energy: what passes between two cells warms each by it over its own heat
            // capacity - hot air hardly warms the rock it touches, and is cooled by it at once;
            // water takes a great deal to warm - and the pair never overshoot each other)
            const row = id << 6;
            if (x + 1 < W) {
              const j1 = mat[i + 1] & ID_MASK, kk = KK[row | j1];
              const tj = lx < CHUNK - 1 ? T[li + 1] : PW.heatAt(world, x + 1, y);
              const flux = kk * (t - tj);
              if (flux > 0.02 || flux < -0.02) {
                t -= flux * SHARE[row | j1];
                const tn = tj + flux * SHARE[j1 << 6 | id];
                if (lx < CHUNK - 1) T[li + 1] = tn; else PW.setHeat(world, x + 1, y, tn);
              }
            }
            if (y + 1 < H) {
              const j1 = mat[i + W] & ID_MASK, kk = KK[row | j1];
              const tj = ly < CHUNK - 1 ? T[li + CHUNK] : PW.heatAt(world, x, y + 1);
              const flux = kk * (t - tj);
              if (flux > 0.02 || flux < -0.02) {
                t -= flux * SHARE[row | j1];
                const tn = tj + flux * SHARE[j1 << 6 | id];
                if (ly < CHUNK - 1) T[li + CHUNK] = tn; else PW.setHeat(world, x, y + 1, tn);
              }
            }
            // Edges towards neighbours that hold no heat yet (they are not exchanging back).
            if (lx === 0 && x > 0 && !world.heat[c - 1]) {
              const j1 = mat[i - 1] & ID_MASK;
              const flux = Math.min(k, conduct[j1]) * (t - AMBIENT);
              if (flux * SHARE[row | j1] > 0.5) { t -= flux * SHARE[row | j1]; PW.setHeat(world, x - 1, y, AMBIENT + flux * SHARE[j1 << 6 | id]); }
            }
            if (ly === 0 && y > 0 && !world.heat[c - chunksX]) {
              const j1 = mat[i - W] & ID_MASK;
              const flux = Math.min(k, conduct[j1]) * (t - AMBIENT);
              if (flux * SHARE[row | j1] > 0.5) { t -= flux * SHARE[row | j1]; PW.setHeat(world, x, y - 1, AMBIENT + flux * SHARE[j1 << 6 | id]); }
            }
            let excess = t - AMBIENT;
            if (excess > COLD || excess < -COLD) {
              // Losses to the surroundings; hot air rises and drifts downwind. (A pipe's bore is
              // open air too, shut in by its casing: hot gas in it climbs its wells.)
              if (open[id]) {
                t -= excess * (y < world.groundTop[x] ? LOSS_OPEN : LOSS_OPEN_UNDER);
                excess = t - AMBIENT;
                if (excess > 5 && y > 0 && open[mat[i - W] & ID_MASK]) {
                  const up = excess * RISE;
                  t -= up;
                  if (ly > 0) T[li - CHUNK] += up; else PW.addHeat(world, x, y - 1, up);
                  const wind = world.wind || 0;
                  if (wind && y < world.groundTop[x]) {
                    const side = wind > 0 ? 1 : -1, share = Math.min(0.25, Math.abs(wind) / 80) * excess;
                    if (open[mat[i + side] & ID_MASK]) {
                      t -= share;
                      const lxs = lx + side;
                      if (lxs >= 0 && lxs < CHUNK) T[li + side] += share; else PW.addHeat(world, x + side, y, share);
                    }
                  }
                }
              } else if (id === M.WATER) t -= excess * LOSS_WATER;
              else t -= excess * LOSS_SOLID;
              T[li] = t;
              // (what keeps the chunk worked is the heat a cell holds: air a few degrees warm
              // holds less than rock a degree warm, and is let go with it - the last breath of a
              // fireball's heat, risen and spread over chunks of sky, is not worked for seconds)
              excess = (t - AMBIENT) * HOLDS[id];
              if (excess > COLD || excess < -COLD) {
                next[(ly >> TS) * TN + (lx >> TS)] = 1; anyWarm = true;
                if (t >= BOIL) effects(i, x, y, id, t);
              }
            } else T[li] = t;
          }
        }
        if (!anyWarm) {
          // Cold again: drop the chunk's array.
          // (its array kept for the next chunk to warm: see PW.heatChunk)
          if (world.heatPool.length < HEAT_POOL) world.heatPool.push(T);
          world.heat[c] = null; world.heatActive[c] = 0; rects.delete(c);
          continue;
        }
        st.warm = next; st.next = warm;
        // (and the box round its warm tiles, for its glow: see glowImage)
        let bx0 = TN, by0 = TN, bx1 = -1, by1 = -1;
        for (let t = 0; t < TILES; t += 1) {
          if (!next[t]) continue;
          const tx = t % TN, ty = (t / TN) | 0;
          if (tx < bx0) bx0 = tx; if (tx > bx1) bx1 = tx; if (ty < by0) by0 = ty; if (ty > by1) by1 = ty;
        }
        st.box = [bx0 << TS, by0 << TS, ((bx1 + 1) << TS) - 1, ((by1 + 1) << TS) - 1];
        keep.push(c);
      }
      // Chunks that gained heat during the pass were appended to the live list.
      for (let n = list.length; n < world.heatList.length; n += 1) keep.push(world.heatList[n]);
      world.heatList = putOff.length ? putOff.concat(keep) : keep;
      stats.chunks = world.heatList.length;
    }
    // What a hot cell does: water boils, ground scorches, fuel catches.
    function effects(i, x, y, id, t) {
      if (id === M.WATER) {
        // Boiling takes a lot of heat on top of reaching 100 °C (latent heat): water simmers until
        // it has taken that much more, then turns to steam at 100 °C or hotter.
        if (t >= BOIL + LATENT) {
          PW.set(world, x, y, M.STEAM | 3 << 6, { quiet: true });
          PW.setHeat(world, x, y, t - LATENT);
          stats.boiled += 1;
        }
        return;
      }
      // Metal is the one solid that gives way to heat: hot enough to melt, a cell of steel slumps -
      // it runs as a heavy, glowing metal slag that piles and spreads where it falls, keeping its
      // heat, and sets where it cools (see MELTS).
      if (MELTS[id] && t >= MELT) {
        const owner = PW.getOwner(world, x, y);
        PW.set(world, x, y, M.DEBRIS | PW.DEBRIS_KIND.METAL << 6);
        PW.setHeat(world, x, y, t);
        stats.melted = (stats.melted || 0) + 1;
        if (owner > 0 && owner < 50000 && world.onDamage) world.onDamage(owner, 1, x, y);
        if (id === M.PIPE && world.pipes && world.pipes.notifyDamage) world.pipes.notifyDamage(x - 2, x + 2);
        return;
      }
      if (t >= SCORCH && terrain[id] && !(PW.getFlags(world, x, y) & FLAG.SCORCH) && hasAir(i, x, y)) {
        const paint = PW.getLayer(world, 'paint', x, y) || palettes[id][((mat[i] >> 6) * 2 + (PW.hash2(x, y) & 1)) & 7];
        PW.setLayer(world, 'paint', x, y, scorched(paint, 0.42));
        PW.setFlag(world, x, y, FLAG.SCORCH);
      }
      // (wood the fire is beside is scorched black, even where it has not caught)
      if (t >= BARK_SCORCH && (PW.hash3(x, y, tick) & 3) === 0 && isWood(x, y) && !(PW.getFlags(world, x, y) & FLAG.CHARRED)) scorchBark(x, y, 0.6);
      // (only what can catch is tried: fuel, a plant in the open, splintered wood - not the hot
      // rubble of a building, cell after cell, heat tick after heat tick)
      if (t >= PLANT_IGNITE && (ignite[id] ? t >= ignite[id] : open[id] || woodRubble(i)) && !burning.has(i)) {
        // Catching is a little uneven, so fronts are ragged and sparse fuel lets a fire die.
        if ((PW.hash3(x, y, tick) & 7) < 3) igniteCell(x, y);
      }
    }

    function step(dtTicks = 1) {
      const started = performance.now();
      for (let k = 0; k < dtTicks; k += 1) {
        tick += 1;
        heatTick(tick % EVERY);
        if (tick % EVERY === 0) burnTick();
      }
      stats.ms = performance.now() - started;
      return stats;
    }

    // ---- Flames overlay -------------------------------------------------------------------------------
    const FLAME_COLORS = ['rgba(255,244,190,0.95)', 'rgba(255,200,80,0.92)', 'rgba(244,128,36,0.88)', 'rgba(196,64,24,0.8)'];
    function draw(renderer, time) {
      glow(renderer);
      if (!burning.size) return;
      const { ctx, camera, view } = renderer;
      const z = camera.zoom, size = Math.max(1, Math.round(z));
      const x0 = camera.x - 2, y0 = camera.y - 8, x1 = camera.x + view.width / z + 2, y1 = camera.y + view.height / z + 2;
      const frame = Math.floor(time * 12);
      const groups = [[], [], [], []];
      for (const [i, b] of burning) {
        const x = i % W, y = (i / W) | 0;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const h = PW.hash3(x, y, frame);
        // A tongue of flame rising from the cell: hottest at its base.
        const tall = b.deco ? 1 + (h & 1) : 1 + (h & 3);
        for (let k = 0; k <= tall; k += 1) {
          const fy = (b.deco ? y : y - 1) - k;
          const sway = k > 1 && (h >> (4 + k) & 1) ? ((h >> 8 & 1) ? 1 : -1) : 0;
          const shade = Math.min(3, k + (h >> 12 & 1));
          groups[shade].push(Math.round((x + sway - camera.x) * z), Math.round((fy - camera.y) * z));
        }
      }
      for (let g = 0; g < 4; g += 1) {
        const list = groups[g];
        if (!list.length) continue;
        ctx.fillStyle = FLAME_COLORS[g];
        ctx.beginPath();
        for (let k = 0; k < list.length; k += 2) ctx.rect(list[k], list[k + 1], size, size);
        ctx.fill();
      }
    }

    // ---- Glow ---------------------------------------------------------------------------------------
    // Heat is a property of each cell and tints it (see PW.glowAt): every cell hot enough - rock,
    // metal, rubble, smoke and dust in the hot air over a fire or a blast - glows into the heat's
    // colour, cell by cell, as hot as that cell is (the heat passing from cell to cell as it
    // conducts: see heatTick), and goes back to its own colour as it cools. Liquids do not glow:
    // they boil away first, and hot air itself is clear. Each hot chunk's tints are an image, one
    // pixel to a cell, made again each heat tick: each pixel the tint's colour at the tint's
    // strength, laid over its cell - so the cell's own colour shows through it.
    const GLOW_FROM = PW.GLOW_FROM, glowAt = PW.glowAt, phaseOf = PW.mat.phase;
    const glowImages = new Map();   // chunk -> { canvas, ctx, made (heat tick), w, h, lx, ly, any }
    function glowImage(c, T) {
      const r = rects.has(c) ? rects.get(c).box : null;
      let e = glowImages.get(c);
      const made = Math.floor(tick / EVERY);
      if (e && e.made === made) return e;
      if (!e) {
        const canvas = document.createElement('canvas');
        canvas.width = CHUNK; canvas.height = CHUNK;
        e = { canvas, ctx: canvas.getContext('2d'), made: -1, image: null, px: null, lx: 0, ly: 0, w: 0, h: 0, any: false };
        e.image = e.ctx.createImageData(CHUNK, CHUNK); e.px = new Uint32Array(e.image.data.buffer);
        glowImages.set(c, e);
      }
      e.made = made; e.any = false;
      if (!r || r[2] < r[0]) return e;
      const lx0 = Math.max(0, r[0] - 1), ly0 = Math.max(0, r[1] - 1), lx1 = Math.min(CHUNK - 1, r[2] + 1), ly1 = Math.min(CHUNK - 1, r[3] + 1);
      const w = lx1 - lx0 + 1, h = ly1 - ly0 + 1, px = e.px;
      const cx = (c % chunksX) << CHUNK_SHIFT, cy = ((c / chunksX) | 0) << CHUNK_SHIFT;
      for (let ly = 0; ly < h; ly += 1) {
        const row = (cy + ly0 + ly) * W + cx + lx0, trow = (ly0 + ly) << CHUNK_SHIFT;
        for (let lx = 0; lx < w; lx += 1) {
          const t = T[trow + lx0 + lx];
          let v = 0;
          if (t > GLOW_FROM) {
            const id = mat[row + lx] & ID_MASK;
            if (id !== M.AIR && phaseOf[id] !== PW.PHASE.LIQUID) { v = glowAt(t); e.any = true; }
          }
          px[ly * CHUNK + lx] = v;
        }
      }
      e.lx = lx0; e.ly = ly0; e.w = w; e.h = h;
      if (e.any) e.ctx.putImageData(e.image, 0, 0, 0, 0, w, h);
      return e;
    }
    function glow(renderer) {
      const list = world.heatList;
      if (!list.length) { if (glowImages.size) glowImages.clear(); return; }
      const { ctx, camera, view } = renderer, z = camera.zoom;
      const vx0 = camera.x, vy0 = camera.y, vx1 = vx0 + view.width / z, vy1 = vy0 + view.height / z;
      let drew = false;
      for (const c of list) {
        const T = world.heat[c];
        if (!T) continue;
        const cx = (c % chunksX) << CHUNK_SHIFT, cy = ((c / chunksX) | 0) << CHUNK_SHIFT;
        if (cx > vx1 || cy > vy1 || cx + CHUNK < vx0 || cy + CHUNK < vy0) continue;
        const e = glowImage(c, T);
        if (!e.any) continue;
        if (!drew) { ctx.save(); ctx.imageSmoothingEnabled = false; drew = true; }
        ctx.drawImage(e.canvas, 0, 0, e.w, e.h, Math.round((cx + e.lx - vx0) * z), Math.round((cy + e.ly - vy0) * z), Math.round(e.w * z), Math.round(e.h * z));
      }
      if (drew) ctx.restore();
      // (images of chunks no longer hot are let go)
      if (glowImages.size > list.length + 16) for (const c of glowImages.keys()) if (!world.heat[c]) glowImages.delete(c);
    }

    // Heat a disc (used by blasts, flame tools and later weapons): `peak` °C at the centre.
    function heatDisc(cx, cy, radius, peak) {
      const r2 = radius * radius;
      for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
        for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
          const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (d2 > r2) continue;
          const t = AMBIENT + (peak - AMBIENT) * Math.pow(1 - Math.sqrt(d2) / radius, 1.5);
          if (t > PW.heatAt(world, x, y)) PW.setHeat(world, x, y, t);
        }
      }
    }

    return { step, draw, stats, heatDisc, igniteCell, extinguish, burning, EVERY };
  }

  PW.createHeat = createHeat;
})();
