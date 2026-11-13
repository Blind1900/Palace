'use strict';
// Explosions: steep-walled, flat-bottomed craters carved by material hardness, with terrain ejecta,
// widely scattered building debris, water thrown as droplets (conserved), shredded vegetation,
// scorched rims, a fireball, sparks and smoke. Damaged buildings are reported for collapse checks.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, structural, hardness, breaksTo, palettes } = PW.mat;

  function explode(world, particles, spec) {
    const { x: cx, y: cy, radius: r, power = 1, owner = 0 } = spec;
    const random = world.random || PW.createRandom(PW.hash2(cx | 0, cy | 0));
    const F = PW.PARTICLE;
    const { mat, width: W, height: H } = world;
    const damaged = new Map();     // building id -> cells destroyed
    let removed = 0;
    const below = r * 0.55;        // craters are wider than deep
    const x0 = Math.max(1, Math.floor(cx - r - 2)), x1 = Math.min(W - 2, Math.ceil(cx + r + 2));
    const y0 = Math.max(0, Math.floor(cy - r - 2)), y1 = Math.min(H - 1, Math.ceil(cy + below + 2));
    const fling = (x, y, speed, up) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
      const a = speed * (0.55 + random() * 0.8);
      return [dx / d * a + (random() - 0.5) * speed * 0.5, dy / d * a * 0.6 - up * (0.6 + random() * 0.7)];
    };
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const nx = (x - cx) / r, ny = (y - cy) / (y > cy ? below : r);
        const s = nx * nx * nx * nx + ny * ny * ny * ny;   // superellipse, p = 4
        if (s > 1.35) continue;
        const i = y * W + x;
        const m = mat[i], id = m & ID_MASK;
        // Vegetation and props in the blast are shredded.
        const deco = PW.getLayer(world, 'deco', x, y);
        if (deco && s <= 1.1) {
          PW.setLayer(world, 'deco', x, y, 0);
          if (random() < 0.08) {
            const [vx, vy] = fling(x, y, 140 * power, 80);
            particles.spawn(x + 0.5, y + 0.5, vx, vy, 0, deco, F.LEAF, 2 + random() * 2);
          }
        }
        if (s > 1) {
          // Scorch the rim.
          if (id !== M.AIR && id !== M.WATER && s < 1.3 && !structural[id]) {
            const paint = PW.getLayer(world, 'paint', x, y) || palettes[id][(m >> 6) * 2];
            const c = PW.unpack(paint), k = 0.55 + (s - 1) * 1.2;
            PW.setLayer(world, 'paint', x, y, PW.abgr(c[0] * k, c[1] * k, c[2] * k));
            PW.setFlag(world, x, y, PW.FLAG.SCORCH);   // fades over time (life lane)
          }
          continue;
        }
        if (id === M.AIR) continue;
        const strength = power * (1 - s) * 1.4 + (PW.hash2(x, y) & 255) / 255 * 0.2 - 0.1;
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
          if (random() < 0.6) {
            const [vx, vy] = fling(x, y, 330 * power, 200 * power);
            particles.spawn(x + 0.5, y + 0.5, vx, vy, breaksTo[id] || M.DEBRIS, paint || 0, F.LAND | F.DAMAGE, 7, ownerId);
          }
        } else if (phase[id] >= PW.PHASE.POWDER && random() < 0.25) {
          const [vx, vy] = fling(x, y, 260 * power, 170 * power);
          particles.spawn(x + 0.5, y + 0.5, vx, vy, breaksTo[id] || M.LOOSE_SOIL, 0, F.LAND, 6);
        }
        // Pulverised earth hangs in the air as a dust cloud.
        if (PW.mat.terrain[id] && random() < 0.3) PW.set(world, x, y, M.DUST | (1 + (random() < 0.5 ? 1 : 0)) << 6, { quiet: true });
      }
    }
    // Sparks (light), then the fireball's heat and the smoke it leaves: real cells, so the heat
    // can scorch and ignite, and the smoke rises, drifts with the wind and thins out.
    for (let k = 0; k < 40 + r * 2; k += 1) {
      const a = random() * Math.PI * 2, sp = (120 + random() * 260) * power;
      const hot = [[255, 240, 180], [255, 196, 90], [240, 120, 40]][k % 3];
      particles.spawn(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp - 60, 0, PW.abgr(hot[0], hot[1], hot[2]), F.GLOW, 0.25 + random() * 0.5);
    }
    if (world.heatSystem) world.heatSystem.heatDisc(cx, cy, r * 1.15, 380 + 420 * power);
    for (let y = Math.floor(cy - r * 0.9); y <= cy + r * 0.3; y += 1) {
      for (let x = Math.floor(cx - r * 0.8); x <= cx + r * 0.8; x += 1) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const dx = (x - cx) / (r * 0.8), dy = (y - cy) / (r * 0.9);
        if (dx * dx + dy * dy > 1 || (mat[y * W + x] & ID_MASK) !== M.AIR || random() > 0.4) continue;
        PW.set(world, x, y, M.SMOKE | (2 + (random() < 0.5 ? 1 : 0)) << 6, { quiet: true });
      }
    }
    if (world.effects) world.effects.push({ kind: 'flash', x: cx, y: cy, radius: r * 2.2, age: 0, life: 0.35 });
    // Plants that lost their footing or trunk fall; cover that lost its support or most of
    // itself breaks apart. Nothing is left floating over the crater.
    const box = { x0: x0 - 4, y0: y0 - 4, x1: x1 + 4, y1: y1 + 4 };
    if (PW.flora) PW.flora.afterBlast(world, particles, box);
    if (PW.props) PW.props.afterBlast(world, particles, box);
    if (world.onDamage) for (const [id, cells] of damaged) world.onDamage(id, cells, cx, cy);
    return { removed, damaged };
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
})();
