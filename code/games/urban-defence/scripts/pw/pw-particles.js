'use strict';
// Free-flying cells: blast ejecta, building debris, water droplets, sparks, leaves and smoke.
// Each particle is traced cell by cell through the grid; landing particles turn back into world
// cells (water droplets always do, so water is conserved), fast debris chips structures it hits.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, structural, hardness, breaksTo, palettes, weight, advection } = PW.mat;

  const GRAVITY = 260;      // cells/s^2 (about 1.9 g at 7 cm per cell: snappy but readable)
  const MAX_SPEED = 1500;   // cells/s: nothing flies faster
  const SLIDE_KEEP = 0.94;  // share of its speed rubble keeps each time it strikes the slope it runs down
  // BUBBLE: air in water. It rises (buoyancy against drag gives ~0.5 m/s), wobbles, slides along
  // anything solid above it and pops when it reaches open air. It never leaves the water.
  const F = Object.freeze({ LAND: 1, DAMAGE: 2, WATER: 4, GLOW: 8, SMOKE: 16, LEAF: 32, BUBBLE: 64 });
  const BUBBLE_RISE = 7;    // cells/s terminal rise speed

  function createParticles(world, capacity = 32768) {
    const { mat, width: W, height: H } = world;
    const px = new Float32Array(capacity), py = new Float32Array(capacity);
    const vx = new Float32Array(capacity), vy = new Float32Array(capacity);
    const life = new Float32Array(capacity), age = new Float32Array(capacity);
    const cell = new Uint8Array(capacity), flags = new Uint8Array(capacity);
    const color = new Uint32Array(capacity), owner = new Uint16Array(capacity);
    const painted = new Uint8Array(capacity);   // carries its own colour (a piece of a building)
    // Shock energy of strikes, gathered over 16x16-cell tiles until the vibration system takes it.
    const impacts = new Map();
    function drainImpacts(fn) {
      for (const [key, energy] of impacts) fn(((key % 4096) << 4) + 8, ((key / 4096 | 0) << 4) + 8, energy);
      impacts.clear();
    }
    let count = 0;
    const listeners = { chip: null, hitUnit: null };
    const stats = { count: 0, landed: 0, chipped: 0 };

    function spawn(x, y, svx, svy, byte, rgba, fl, lifeSeconds = 6, own = 0) {
      if (count >= capacity) {
        // Over capacity: settle land particles straight into the grid, drop cosmetic ones.
        if (fl & (F.LAND | F.WATER)) deposit(x, y, byte, fl, rgba);
        return -1;
      }
      const i = count++;
      px[i] = x; py[i] = y; vx[i] = svx; vy[i] = svy;
      cell[i] = byte; flags[i] = fl; color[i] = rgba || paletteColor(byte, x, y); painted[i] = rgba ? 1 : 0;
      life[i] = lifeSeconds; age[i] = 0; owner[i] = own;
      return i;
    }
    function paletteColor(byte, x, y) {
      if (!byte) return PW.abgr(255, 255, 255);
      return palettes[byte & ID_MASK][(byte >> 6) * 2 + (PW.hash2(x | 0, y | 0) & 1)];
    }
    function kill(i) {
      const last = --count;
      if (i === last) return;
      px[i] = px[last]; py[i] = py[last]; vx[i] = vx[last]; vy[i] = vy[last];
      life[i] = life[last]; age[i] = age[last]; cell[i] = cell[last]; flags[i] = flags[last];
      color[i] = color[last]; owner[i] = owner[last]; painted[i] = painted[last];
    }
    // A grain coming to rest in water takes the place of the water it lands in, and that water
    // goes up to the top of the column it stands in: the surface rises by the grain's volume.
    // (false where the water is shut in and cannot rise)
    function displace(cx, cy) {
      let top = cy;
      while (top > 0 && phase[mat[(top - 1) * W + cx] & ID_MASK] === PW.PHASE.LIQUID && cy - top < 512) top -= 1;
      if (top === 0 || !OPEN[mat[(top - 1) * W + cx] & ID_MASK]) return false;
      PW.set(world, cx, top - 1, mat[cy * W + cx]);
      return true;
    }
    // Put a landed particle into the first open cell at or above (x, y): air, or water it is heavy
    // enough to sink in (a light one rests on the surface). (A grain that came to rest and was
    // buried by the rest of the heap landing on it goes to the top of the heap.)
    function deposit(x, y, byte, fl, paint = 0) {
      let cx = Math.max(1, Math.min(W - 2, Math.floor(x))), cy = Math.min(H - 1, Math.floor(y));
      for (let k = 0; k < 400 && cy >= 0; k += 1, cy -= 1) {
        const id = mat[cy * W + cx] & ID_MASK;
        const sinks = (fl & F.WATER) === 0 && phase[id] === PW.PHASE.LIQUID && weight[id] < weight[byte & ID_MASK];
        if (OPEN[id] || (sinks && displace(cx, cy))) {
          // Rubble and earth landing on a heap roll off it, down its slope, so falling debris builds
          // a heap spreading out wide rather than a column: earth settles at about 45°, building
          // rubble flatter, about 1 in 2.
          if (!(fl & F.WATER) && OPEN[id] && phase[byte & ID_MASK] !== PW.PHASE.GAS) {
            const first = (cx + cy) & 1 ? 1 : -1, reach = (byte & ID_MASK) === M.DEBRIS ? 2 : 1;
            const free = (x, y) => x >= 1 && x < W - 1 && y < H - 1 && OPEN[mat[y * W + x] & ID_MASK];
            for (let roll = 0; roll < 160; roll += 1) {
              if (free(cx, cy + 1)) { cy += 1; continue; }
              let moved = false;
              for (const d of [first, -first]) {
                for (let k = 1; k <= reach && !moved; k += 1) {
                  if (!free(cx + d * k, cy)) break;
                  if (free(cx + d * k, cy + 1)) { cx += d * k; cy += 1; moved = true; }
                }
                if (moved) break;
              }
              if (!moved) break;
            }
          }
          // (smoke or dust lying there is pushed up out of its way, not lost)
          const there = mat[cy * W + cx];
          if (phase[there & ID_MASK] === PW.PHASE.GAS && phase[byte & ID_MASK] !== PW.PHASE.GAS) {
            for (let up = cy - 1; up > 0 && cy - up <= 16; up -= 1) if ((mat[up * W + cx] & ID_MASK) === M.AIR) { PW.set(world, cx, up, there, { quiet: true }); break; }
          }
          PW.set(world, cx, cy, byte);
          // (a piece of a building keeps its colours as rubble, a little dulled with dust)
          if (paint && (byte & ID_MASK) === M.DEBRIS) {
            const c = PW.unpack(paint), k = 0.78 + (PW.hash2(cx, cy) & 15) / 100;
            PW.setLayer(world, 'paint', cx, cy, PW.abgr(c[0] * k + 18, c[1] * k + 16, c[2] * k + 14));
          }
          stats.landed += 1;
          return true;
        }
      }
      return false;
    }
    const OPEN = PW.mat.open;
    const open = (id, fl) => OPEN[id] === 1 || (id === M.WATER && (fl & F.WATER) === 0);

    function step(dt) {
      for (let i = count - 1; i >= 0; i -= 1) {
        const fl = flags[i];
        age[i] += dt;
        life[i] -= dt;
        if (fl & F.SMOKE) {
          vy[i] -= 30 * dt; vx[i] *= 1 - 0.8 * dt;
          px[i] += vx[i] * dt; py[i] += vy[i] * dt;
          if (life[i] <= 0) kill(i);
          continue;
        }
        if (fl & F.BUBBLE) {
          // Rise towards terminal speed, wobbling; water currents are not modelled per cell.
          vy[i] += (-BUBBLE_RISE - vy[i]) * Math.min(1, 4 * dt);
          vx[i] += (Math.sin(age[i] * 6 + i * 1.7) * 3 - vx[i]) * Math.min(1, 3 * dt);
          const ox = px[i], oy = py[i];
          let nx = ox + vx[i] * dt, ny = oy + vy[i] * dt;
          const at = (x, y) => (y < 0 || y >= H || x < 0 || x >= W) ? M.BEDROCK : mat[(y | 0) * W + (x | 0)] & ID_MASK;
          let here = at(nx, ny);
          if (here !== M.WATER && here !== M.AIR) {
            // Blocked above: slip sideways along the ceiling towards a way up.
            ny = oy;
            const side = Math.sin(i * 12.9898) > 0 ? 1 : -1;
            nx = ox + side * BUBBLE_RISE * dt;
            here = at(nx, ny);
            if (here !== M.WATER) { nx = ox; here = at(nx, ny); }
          }
          px[i] = nx; py[i] = ny;
          if (here !== M.WATER || life[i] <= 0) kill(i);   // reached air: pop
          continue;
        }
        // What it is, and what it is flying through. In a liquid the weight of what it pushes
        // aside holds it up: a stone sinks slower, ash floats up (the element table's weights).
        const own = cell[i] & ID_MASK;
        const around = (() => {
          const cx = px[i] | 0, cy = py[i] | 0;
          return cy >= 0 && cy < H && cx >= 0 && cx < W ? mat[cy * W + cx] & ID_MASK : M.AIR;
        })();
        const inLiquid = phase[around] === PW.PHASE.LIQUID;
        let g = GRAVITY * (fl & F.LEAF ? 0.25 : 1);
        if (inLiquid && own && !(fl & F.WATER)) g *= 1 - weight[around] / Math.max(1, weight[own]);
        const buoyant = g < 0;
        vy[i] += g * dt;
        // Drag: what the air takes hold of most (the table's `wind`) is slowed most - ash and
        // grit drift down, a stone flies on.
        const drag = inLiquid ? 3.5 : fl & F.LEAF ? 1.6 : own ? 0.12 + 2.5 * advection[own] : 0.12;
        vx[i] *= Math.max(0, 1 - drag * dt); vy[i] *= Math.max(0, 1 - drag * dt);
        if (fl & F.LEAF) vx[i] += Math.sin(age[i] * 5 + i) * 30 * dt;
        // (sinking or floating through water, each grain is turned this way and that by the
        // eddies it makes, so a mass of them spreads out)
        else if (inLiquid && own) { vx[i] += Math.sin(age[i] * 4 + i * 1.7) * 40 * dt; vy[i] += Math.cos(age[i] * 3 + i * 2.3) * 25 * dt; }
        // Light things ride the wind above ground.
        const ride = fl & F.LEAF ? 1.5 : own && !inLiquid ? 3 * advection[own] : 0;
        if (ride) {
          const gx = Math.max(0, Math.min(W - 1, px[i] | 0));
          if (py[i] < world.groundTop[gx]) vx[i] += ((world.wind || 0) * 1.5 - vx[i]) * Math.min(1, ride * dt);
        }
        // A blast wave's wind pushes what flies through it: leaves are carried off, splinters and
        // grit pushed along, heavy rubble barely (as the element table's `wind` says).
        if (world.air && world.air.busy()) {
          const a = world.air.at(px[i], py[i]);
          if (a[0] || a[1]) {
            const k = (fl & F.LEAF ? 0.7 : Math.max(0.03, PW.mat.advection[cell[i] & ID_MASK])) * Math.min(1, 6 * dt);
            vx[i] += (a[0] - vx[i]) * k; vy[i] += (a[1] - vy[i]) * k;
          }
        }
        // (nothing flies faster than MAX_SPEED: a bad push can never stall the step)
        if (!(Math.abs(vx[i]) <= MAX_SPEED)) vx[i] = Math.sign(vx[i]) * MAX_SPEED || 0;
        if (!(Math.abs(vy[i]) <= MAX_SPEED)) vy[i] = Math.sign(vy[i]) * MAX_SPEED || 0;
        let x = px[i], y = py[i];
        const nx = x + vx[i] * dt, ny = y + vy[i] * dt;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(nx - x), Math.abs(ny - y))));
        const sx = (nx - x) / steps, sy = (ny - y) / steps;
        let removed = false;
        for (let s = 0; s < steps; s += 1) {
          const tx = x + sx, ty = y + sy;
          const cx = Math.floor(tx), cy = Math.floor(ty);
          if (cx < 1 || cx >= W - 1) {
            if (fl & (F.LAND | F.WATER)) { vx[i] = -vx[i] * 0.3; break; }
            kill(i); removed = true; break;
          }
          if (cy < 0) { x = tx; y = ty; continue; }          // above the grid: open sky
          if (cy >= H) { kill(i); removed = true; break; }
          const id = mat[cy * W + cx] & ID_MASK;
          // (floating up, it stops at the surface and rests there)
          if (buoyant && OPEN[id]) {
            if (deposit(x, y, cell[i], fl, painted[i] ? color[i] : 0)) { kill(i); removed = true; break; }
          }
          if (open(id, fl)) {
            // Fast heavy debris knocks down plants and smashes lamps and fittings it flies through.
            if ((fl & F.DAMAGE) && (Math.abs(vx[i]) + Math.abs(vy[i])) > 110 && PW.getLayer(world, 'deco', cx, cy)) {
              // (the blow: its speed and weight - a fast lump of rubble about 1.5)
              const blow = Math.hypot(vx[i], vy[i]) / 200 * Math.max(0.2, weight[cell[i] & ID_MASK] / 80);
              if (!(PW.flora && PW.flora.strike(world, api, cx, cy, blow))) {
                PW.setLayer(world, 'deco', cx, cy, 0);
                if (PW.streetProps) PW.streetProps.struck(world, cx, cy);
                const owner = PW.getOwner(world, cx, cy);
                if (owner > 0 && owner < 50000 && world.onDamage) world.onDamage(owner, 0, cx, cy);
              }
              vx[i] *= 0.8; vy[i] *= 0.8;
            }
            x = tx; y = ty; continue;
          }
          // Collision with cell (cx, cy). The shock of the strike adds to the vibration where it
          // lands (its kinetic energy: the weight of what struck, times its speed squared).
          const speed = Math.hypot(vx[i], vy[i]);
          if (fl & (F.LAND | F.DAMAGE) && speed > 40) {
            const key = (cy >> 4) * 4096 + (cx >> 4);
            impacts.set(key, (impacts.get(key) || 0) + speed * speed * (PW.mat.weight[cell[i] & ID_MASK] / 80) / 40);
          }
          if ((fl & F.DAMAGE) && speed > 90 && structural[id] && id !== M.CORE) chip(cx, cy, id, speed, i);   // (cores break only to blasts)
          if ((fl & F.WATER) || ((fl & F.LAND) && speed < 45)) {
            if (deposit(x, y, cell[i], fl, painted[i] ? color[i] : 0)) { kill(i); removed = true; break; }
          }
          // Bounce: reflect the blocked component, keep some of the other.
          const blockedX = Math.floor(x + sx) !== Math.floor(x) && !open(mat[Math.floor(y) * W + cx] & ID_MASK, fl);
          // Rubble and earth striking a slope do not bounce: they run on down it, a stream of
          // rock and earth that keeps its speed on a steep slope, loses it on a gentle one and
          // spreads to a stop at the foot, throwing up dust as it goes.
          let downhill = 0;
          if (!blockedX && (fl & F.LAND) && vy[i] > 0) {
            const row = cy * W, l = open(mat[row + cx - 1] & ID_MASK, fl), r = open(mat[row + cx + 1] & ID_MASK, fl);
            downhill = l && r ? (Math.sign(vx[i]) || (i & 1 ? 1 : -1)) : l ? -1 : r ? 1 : 0;
          }
          if (downhill) {
            const run = Math.max(speed * SLIDE_KEEP, 30);
            vx[i] = downhill * run; vy[i] = 12;
            x = cx + 0.5 + downhill; y = cy - 0.5;
            if (run > 110 && (PW.hash3(cx, cy, age[i] * 60 | 0) & 7) === 0 && open(mat[(cy - 3) * W + cx] & ID_MASK, fl) && (mat[(cy - 3) * W + cx] & ID_MASK) === M.AIR) {
              PW.set(world, cx, cy - 3, M.DUST | 2 << 6, { quiet: true });
            }
            break;
          }
          if (blockedX) { vx[i] = -vx[i] * 0.25; vy[i] *= 0.75; } else { vy[i] = -vy[i] * 0.25; vx[i] *= 0.7; }
          if (!(fl & (F.LAND | F.WATER)) && speed < 30) { kill(i); removed = true; }
          break;
        }
        if (removed) continue;
        px[i] = x; py[i] = y;
        if (life[i] <= 0) {
          if (fl & (F.LAND | F.WATER)) deposit(x, y, cell[i], fl, painted[i] ? color[i] : 0);
          kill(i);
        }
      }
      stats.count = count;
    }
    // A fast heavy fragment breaks the structure cell it hits (harder cells resist).
    function chip(cx, cy, id, speed, i) {
      const energy = speed / 400;
      if (energy < hardness[id] * (0.6 + (PW.hash2(cx, cy) & 255) / 640)) return;
      const ownerId = PW.getOwner(world, cx, cy);
      PW.set(world, cx, cy, M.AIR);
      PW.clearPaintAt(world, cx, cy);
      const jitter = ((PW.hash3(cx, cy, world.tick) & 255) / 255 - 0.5) * 40;
      spawn(cx + 0.5, cy + 0.5, vx[i] * 0.4 + jitter, vy[i] * 0.3 - 30, breaksTo[id] || M.DEBRIS, 0, F.LAND, 5, ownerId);
      stats.chipped += 1;
      if (listeners.chip) listeners.chip(ownerId, cx, cy);
    }

    // Draw cell-aligned particles, batched by colour.
    function draw(renderer) {
      const { ctx, camera, view } = renderer;
      const z = camera.zoom;
      const size = Math.max(1, Math.round(z));
      const x0 = camera.x, y0 = camera.y, x1 = x0 + view.width / z, y1 = y0 + view.height / z;
      const groups = new Map();
      for (let i = 0; i < count; i += 1) {
        const x = px[i], y = py[i];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        let c = color[i];
        if (flags[i] & F.SMOKE) {
          const fade = Math.max(0, Math.min(1, life[i] / 2));
          if (fade < 0.15 || ((i + (age[i] * 10 | 0)) & 3) === 0) continue;
          c = c & 0x00ffffff | Math.round(150 * fade) << 24;
        }
        let list = groups.get(c);
        if (!list) { list = []; groups.set(c, list); }
        list.push(Math.round((Math.floor(x) - x0) * z), Math.round((Math.floor(y) - y0) * z));
      }
      for (const [c, list] of groups) {
        const a = (c >>> 24) / 255;
        ctx.fillStyle = `rgba(${c & 255},${c >>> 8 & 255},${c >>> 16 & 255},${a})`;
        ctx.beginPath();
        for (let k = 0; k < list.length; k += 2) ctx.rect(list[k], list[k + 1], size, size);
        ctx.fill();
      }
    }
    const api = { spawn, step, draw, drainImpacts, F, stats, listeners, get count() { return count; }, capacity, px, py, vx, vy, flags };
    return api;
  }

  PW.createParticles = createParticles;
  PW.PARTICLE = F;
  PW.GRAVITY = GRAVITY;
})();
