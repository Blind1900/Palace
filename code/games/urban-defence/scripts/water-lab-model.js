// A small particle sandbox, separate from the game's flood calculations.
function createWaterLabModel() {
  const width = 320;
  const height = 160;
  const scale = 10;
  const solid = new Uint8Array(width * height).fill(1);
  const occupied = new Int32Array(width * height).fill(-1);
  const particles = [];
  let tick = 0;
  const index = (x, y) => y * width + x;
  const open = (x, y) => x >= 0 && x < width && y >= 0 && y < height &&
    !solid[index(x, y)] && occupied[index(x, y)] < 0;

  function carve(left, top, right, bottom) {
    for (let y = top * scale; y < (bottom + 1) * scale; y += 1) {
      for (let x = left * scale; x < (right + 1) * scale; x += 1) solid[index(x, y)] = 0;
    }
  }
  carve(1, 1, 7, 9);
  carve(12, 10, 19, 13);
  for (let y = 80; y < 100; y += 1) {
    for (let x = 20; x < 80; x += 1) {
      occupied[index(x, y)] = particles.length;
      particles.push({ x, y, vx: 0, vy: 0, shade: (x * 17 + y * 31) % 5 });
    }
  }

  function move(p, x, y, id) {
    occupied[index(p.x, p.y)] = -1;
    p.x = x;
    p.y = y;
    occupied[index(x, y)] = id;
  }

  return {
    width, height, solid, particles,
    breach() { carve(8, 8, 12, 13); },
    extend() { carve(20, 10, 30, 13); },
    floodFraction(column, top, bottom) {
      let count = 0;
      for (const p of particles) {
        if (p.x >= column * scale && p.x < (column + 1) * scale &&
            p.y >= top * scale && p.y < (bottom + 1) * scale) count += 1;
      }
      return count / (scale * scale * (bottom - top + 1));
    },
    step() {
      tick += 1;
      // Alternating traversal prevents a fixed left/right bias.
      for (let n = 0; n < particles.length; n += 1) {
        const id = tick % 2 ? n : particles.length - 1 - n;
        const p = particles[id];
        p.vy = Math.min(3, p.vy + 0.18);
        const direction = p.vx === 0 ? ((id + tick) % 2 ? 1 : -1) : Math.sign(p.vx);
        const steps = Math.max(1, Math.ceil(p.vy));
        let fell = false;
        for (let s = 0; s < steps; s += 1) {
          const sideways = Math.abs(p.vx) > 0.3 && (s + tick + id) % 3 === 0 ? Math.sign(p.vx) : 0;
          if (sideways && open(p.x + sideways, p.y + 1)) {
            move(p, p.x + sideways, p.y + 1, id);
            fell = true;
          } else if (open(p.x, p.y + 1)) {
            move(p, p.x, p.y + 1, id);
            fell = true;
          } else if (open(p.x + direction, p.y + 1)) {
            move(p, p.x + direction, p.y + 1, id);
            p.vx = direction * 0.9;
            fell = true;
          } else if (open(p.x - direction, p.y + 1)) {
            move(p, p.x - direction, p.y + 1, id);
            p.vx = -direction * 0.9;
            fell = true;
          } else {
            break;
          }
        }
        if (!fell) {
          p.vy = 0;
          // Water spreads along its surface and retains momentum at a spillway.
          const first = direction;
          const second = -direction;
          let chosen = 0;
          for (const dir of [first, second]) {
            for (let distance = 1; distance <= 8; distance += 1) {
              const x = p.x + dir * distance;
              if (!open(x, p.y)) break;
              if (open(x, p.y + 1) || distance === 8) { chosen = dir; break; }
            }
            if (chosen) break;
          }
          if (chosen && open(p.x + chosen, p.y)) {
            p.vx = chosen * Math.min(4, Math.abs(p.vx) + 0.45);
            for (let distance = 0; distance < Math.ceil(Math.abs(p.vx)); distance += 1) {
              if (!open(p.x + chosen, p.y)) break;
              move(p, p.x + chosen, p.y, id);
              if (open(p.x, p.y + 1)) break;
            }
          } else p.vx *= 0.7;
        } else {
          p.vx *= 0.985;
        }
      }
    },
  };
}
