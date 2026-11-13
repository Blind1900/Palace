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
  const RISE = 0.3;                 // share of hot air's excess carried up per heat tick
  const SMOKE_CHANCE = 0.3;         // per burning cell per heat tick

  function createHeat(world) {
    const { mat, width: W, height: H, chunksX } = world;
    const burning = new Map();      // flat index -> { fuel (s), deco (bool), wood (bool), owner }
    const rects = new Map();        // chunk -> [x0, y0, x1, y1] local rectangle holding heat
    const stats = { ms: 0, chunks: 0, burning: 0, ignited: 0, burnedOut: 0, boiled: 0 };
    let tick = 0;
    world.fireByOwner = new Map();  // building / infrastructure id -> burning cells (construction delays)

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
      if (open[id] && decoAt(x, y) && (PW.getFlags(world, x, y) & (FLAG.FLORA | FLAG.CHARRED)) === FLAG.FLORA) {
        const c = PW.unpack(decoAt(x, y));
        const leaf = c[1] > c[0] + 8;   // green: leaves and grass; brown: bark and stems
        burning.set(i, { fuel: leaf ? 1.2 + (PW.hash2(x, y) & 3) * 0.3 : 5 + (PW.hash2(x, y) & 7) * 0.5, deco: true, wood: !leaf, owner: 0 });
        stats.ignited += 1;
        return true;
      }
      return false;
    }
    function extinguish(i, x, y) {
      burning.delete(i);
      PW.setHeat(world, x, y, Math.min(PW.heatAt(world, x, y), 90));
    }
    function scorched(color, k = 0.45) {
      const c = PW.unpack(color);
      return PW.abgr(c[0] * k + 6, c[1] * k + 4, c[2] * k + 2);
    }
    function burnOut(i, x, y, b) {
      burning.delete(i);
      stats.burnedOut += 1;
      if (b.deco) {
        if (!b.wood) {
          PW.setLayer(world, 'deco', x, y, 0);
          PW.setFlag(world, x, y, FLAG.FLORA, false);
        } else {
          const k = 0.22 + (PW.hash2(x, y) & 3) * 0.05;
          PW.setLayer(world, 'deco', x, y, PW.abgr(52 * k + 20, 44 * k + 18, 40 * k + 16));
          PW.setFlag(world, x, y, FLAG.CHARRED);
        }
        return;
      }
      const id = mat[i] & ID_MASK;
      const to = burnsTo[id];
      if (to === M.ASH) {
        PW.set(world, x, y, M.ASH | (PW.hash2(x, y) & 3) << 6);
      } else if (to) {
        PW.set(world, x, y, to | (mat[i] & 0xc0));
        PW.setLayer(world, 'paint', x, y, scorched(palettes[to][(PW.hash2(x, y) & 3) * 2]));
        PW.setFlag(world, x, y, FLAG.SCORCH);
      }
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
        if (b.deco ? !(open[id] && decoAt(x, y)) : !ignite[id]) { burning.delete(i); continue; }
        if (nearWater(i, x, y)) { extinguish(i, x, y); continue; }
        // Starved of air (buried): it smoulders out.
        if (!b.deco && !hasAir(i, x, y)) { b.fuel -= DT * 3; if (b.fuel <= 0) burning.delete(i); continue; }
        PW.setHeat(world, x, y, Math.max(PW.heatAt(world, x, y), FLAME));
        if (y > 0) PW.setHeat(world, x, y - 1, Math.max(PW.heatAt(world, x, y - 1), FLAME * 0.8));
        if ((PW.hash3(x, y, tick) & 1023) / 1023 < SMOKE_CHANCE) puffSmoke(x, y);
        if (b.owner) world.fireByOwner.set(b.owner, (world.fireByOwner.get(b.owner) || 0) + 1);
        b.fuel -= DT;
        if (b.fuel <= 0) burnOut(i, x, y, b);
      }
      stats.burning = burning.size;
    }

    // ---- Heat transfer -----------------------------------------------------------------------------
    // Exchange between cells a and b (flat indices, temperatures in their chunk arrays).
    function chunkOf(x, y) { return (y >> CHUNK_SHIFT) * chunksX + (x >> CHUNK_SHIFT); }
    function heatTick() {
      const list = world.heatList;
      const keep = [];
      for (let n = 0; n < list.length; n += 1) {
        const c = list[n];
        const T = world.heat[c];
        if (!T) { world.heatActive[c] = 0; rects.delete(c); continue; }
        const cx = (c % chunksX) << CHUNK_SHIFT, cy = ((c / chunksX) | 0) << CHUNK_SHIFT;
        let r = rects.get(c);
        if (!r) { r = [0, 0, CHUNK - 1, CHUNK - 1]; rects.set(c, r); }
        // Grow by one cell so heat can spread, then work the rectangle.
        const lx0 = Math.max(0, r[0] - 1), ly0 = Math.max(0, r[1] - 1), lx1 = Math.min(CHUNK - 1, r[2] + 1), ly1 = Math.min(CHUNK - 1, r[3] + 1);
        let nx0 = CHUNK, ny0 = CHUNK, nx1 = -1, ny1 = -1;
        for (let ly = ly0; ly <= ly1; ly += 1) {
          const y = cy + ly;
          for (let lx = lx0; lx <= lx1; lx += 1) {
            const x = cx + lx, li = ly << CHUNK_SHIFT | lx, i = y * W + x;
            let t = T[li];
            const id = mat[i] & ID_MASK;
            const k = conduct[id];
            // Right and down neighbours (inside this chunk directly, across edges via the core).
            if (x + 1 < W) {
              const kj = conduct[mat[i + 1] & ID_MASK], kk = k < kj ? k : kj;
              const tj = lx < CHUNK - 1 ? T[li + 1] : PW.heatAt(world, x + 1, y);
              const flux = kk * (t - tj);
              if (flux > 0.02 || flux < -0.02) {
                t -= flux;
                if (lx < CHUNK - 1) T[li + 1] = tj + flux; else PW.setHeat(world, x + 1, y, tj + flux);
              }
            }
            if (y + 1 < H) {
              const kj = conduct[mat[i + W] & ID_MASK], kk = k < kj ? k : kj;
              const tj = ly < CHUNK - 1 ? T[li + CHUNK] : PW.heatAt(world, x, y + 1);
              const flux = kk * (t - tj);
              if (flux > 0.02 || flux < -0.02) {
                t -= flux;
                if (ly < CHUNK - 1) T[li + CHUNK] = tj + flux; else PW.setHeat(world, x, y + 1, tj + flux);
              }
            }
            // Edges towards neighbours that hold no heat yet (they are not exchanging back).
            if (lx === 0 && x > 0 && !world.heat[c - 1]) {
              const flux = Math.min(k, conduct[mat[i - 1] & ID_MASK]) * (t - AMBIENT);
              if (flux > 0.5) { t -= flux; PW.setHeat(world, x - 1, y, AMBIENT + flux); }
            }
            if (ly === 0 && y > 0 && !world.heat[c - chunksX]) {
              const flux = Math.min(k, conduct[mat[i - W] & ID_MASK]) * (t - AMBIENT);
              if (flux > 0.5) { t -= flux; PW.setHeat(world, x, y - 1, AMBIENT + flux); }
            }
            let excess = t - AMBIENT;
            if (excess > COLD || excess < -COLD) {
              // Losses to the surroundings; hot air rises and drifts downwind.
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
              excess = t - AMBIENT;
              if (excess > COLD || excess < -COLD) {
                if (lx < nx0) nx0 = lx; if (lx > nx1) nx1 = lx; if (ly < ny0) ny0 = ly; if (ly > ny1) ny1 = ly;
                if (t >= BOIL) effects(i, x, y, id, t);
              }
            } else T[li] = t;
          }
        }
        if (nx1 < 0) {
          // Cold again: drop the chunk's array.
          world.heat[c] = null; world.heatActive[c] = 0; rects.delete(c);
          continue;
        }
        r[0] = nx0; r[1] = ny0; r[2] = nx1; r[3] = ny1;
        keep.push(c);
      }
      // Chunks that gained heat during the pass were appended to the live list.
      for (let n = list.length; n < world.heatList.length; n += 1) keep.push(world.heatList[n]);
      world.heatList = keep;
      stats.chunks = keep.length;
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
      if (t >= SCORCH && terrain[id] && !(PW.getFlags(world, x, y) & FLAG.SCORCH) && hasAir(i, x, y)) {
        const paint = PW.getLayer(world, 'paint', x, y) || palettes[id][((mat[i] >> 6) * 2 + (PW.hash2(x, y) & 1)) & 7];
        PW.setLayer(world, 'paint', x, y, scorched(paint, 0.55));
        PW.setFlag(world, x, y, FLAG.SCORCH);
      }
      if (t >= PLANT_IGNITE && !burning.has(i)) {
        // Catching is a little uneven, so fronts are ragged and sparse fuel lets a fire die.
        if ((PW.hash3(x, y, tick) & 7) < 3 && (t >= ignite[id] || open[id])) igniteCell(x, y);
      }
    }

    function step(dtTicks = 1) {
      tick += dtTicks;
      if (tick % EVERY !== 0) return stats;
      const started = performance.now();
      heatTick();
      burnTick();
      stats.ms = performance.now() - started;
      return stats;
    }

    // ---- Flames overlay -------------------------------------------------------------------------------
    const FLAME_COLORS = ['rgba(255,244,190,0.95)', 'rgba(255,200,80,0.92)', 'rgba(244,128,36,0.88)', 'rgba(196,64,24,0.8)'];
    function draw(renderer, time) {
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
