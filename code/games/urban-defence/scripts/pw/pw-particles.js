'use strict';
// Free-flying cells: blast ejecta, building debris, water droplets, sparks, leaves and smoke.
// Each particle is traced cell by cell through the grid; landing particles turn back into world
// cells (water droplets always do, so water is conserved), fast debris chips structures it hits.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, structural, hardness, breaksTo, palettes } = PW.mat;

  const GRAVITY = 260;      // cells/s^2 (about 1.9 g at 7 cm per cell: snappy but readable)
  const F = Object.freeze({ LAND: 1, DAMAGE: 2, WATER: 4, GLOW: 8, SMOKE: 16, LEAF: 32 });

  function createParticles(world, capacity = 32768) {
    const { mat, width: W, height: H } = world;
    const px = new Float32Array(capacity), py = new Float32Array(capacity);
    const vx = new Float32Array(capacity), vy = new Float32Array(capacity);
    const life = new Float32Array(capacity), age = new Float32Array(capacity);
    const cell = new Uint8Array(capacity), flags = new Uint8Array(capacity);
    const color = new Uint32Array(capacity), owner = new Uint16Array(capacity);
    let count = 0;
    const listeners = { chip: null, hitUnit: null };
    const stats = { count: 0, landed: 0, chipped: 0 };

    function spawn(x, y, svx, svy, byte, rgba, fl, lifeSeconds = 6, own = 0) {
      if (count >= capacity) {
        // Over capacity: settle land particles straight into the grid, drop cosmetic ones.
        if (fl & (F.LAND | F.WATER)) deposit(x, y, byte, fl);
        return -1;
      }
      const i = count++;
      px[i] = x; py[i] = y; vx[i] = svx; vy[i] = svy;
      cell[i] = byte; flags[i] = fl; color[i] = rgba || paletteColor(byte, x, y);
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
      color[i] = color[last]; owner[i] = owner[last];
    }
    // Put a landed particle into the first open cell at or above (x, y).
    function deposit(x, y, byte, fl) {
      let cx = Math.max(1, Math.min(W - 2, Math.floor(x))), cy = Math.min(H - 1, Math.floor(y));
      for (let k = 0; k < 24 && cy >= 0; k += 1, cy -= 1) {
        const id = mat[cy * W + cx] & ID_MASK;
        if (id === M.AIR || ((fl & F.WATER) === 0 && id === M.WATER && k > 0)) {
          PW.set(world, cx, cy, byte);
          stats.landed += 1;
          return true;
        }
      }
      return false;
    }
    const open = (id, fl) => id === M.AIR || (id === M.WATER && (fl & F.WATER) === 0);

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
        const inWater = (() => {
          const cx = px[i] | 0, cy = py[i] | 0;
          return cy >= 0 && cy < H && cx >= 0 && cx < W && (mat[cy * W + cx] & ID_MASK) === M.WATER;
        })();
        vy[i] += GRAVITY * dt * (fl & F.LEAF ? 0.25 : 1);
        const drag = inWater ? 3.5 : fl & F.LEAF ? 1.6 : 0.12;
        vx[i] *= Math.max(0, 1 - drag * dt); vy[i] *= Math.max(0, 1 - drag * dt);
        if (fl & F.LEAF) vx[i] += Math.sin(age[i] * 5 + i) * 30 * dt;
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
          if (open(id, fl)) { x = tx; y = ty; continue; }
          // Collision with cell (cx, cy).
          const speed = Math.hypot(vx[i], vy[i]);
          if ((fl & F.DAMAGE) && speed > 90 && structural[id]) chip(cx, cy, id, speed, i);
          if ((fl & F.WATER) || ((fl & F.LAND) && speed < 45)) {
            if (deposit(x, y, cell[i], fl)) { kill(i); removed = true; break; }
          }
          // Bounce: reflect the blocked component, keep some of the other.
          const blockedX = Math.floor(x + sx) !== Math.floor(x) && !open(mat[Math.floor(y) * W + cx] & ID_MASK, fl);
          if (blockedX) { vx[i] = -vx[i] * 0.25; vy[i] *= 0.75; } else { vy[i] = -vy[i] * 0.25; vx[i] *= 0.7; }
          if (!(fl & (F.LAND | F.WATER)) && speed < 30) { kill(i); removed = true; }
          break;
        }
        if (removed) continue;
        px[i] = x; py[i] = y;
        if (life[i] <= 0) {
          if (fl & (F.LAND | F.WATER)) deposit(x, y, cell[i], fl);
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
    return { spawn, step, draw, F, stats, listeners, get count() { return count; }, px, py, vx, vy, flags };
  }

  PW.createParticles = createParticles;
  PW.PARTICLE = F;
  PW.GRAVITY = GRAVITY;
})();
