// Material pixels share the particle-world cell size; motion remains in the gameplay model.
function createWorldObjectRenderer() {
  const cell = URBAN_PIXEL_CELL_SIZE;
  const snap = (value) => Math.round(value / cell) * cell;

  function pixelTrail(ctx, start, end, opacity = 1, missile = false, pixelSize = cell) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const size = Math.max(1, pixelSize);
    const snapPixel = (value) => Math.round(value / size) * size;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / size));
    ctx.save();
    ctx.globalAlpha *= opacity;
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const x = snapPixel(start.x + dx * t), y = snapPixel(start.y + dy * t);
      ctx.fillStyle = index >= steps - 1 ? '#f5d88a' : index % 3 ? '#cf6e32' : '#94502e';
      ctx.fillRect(x, y, size, size);
      if (missile && index % 4 === 1) {
        ctx.fillStyle = '#63402b';
        ctx.fillRect(x + size, y + size, size, size);
      }
    }
    ctx.restore();
  }

  return {
    road(ctx, points, road = {}) {
      if (points.length < 2) return;
      let lastX = NaN, lastY = NaN, index = 0;
      for (const point of points) {
        const x = snap(point.x), y = snap(point.y);
        if (x === lastX && y === lastY) continue;
        ctx.fillStyle = '#293127';
        ctx.fillRect(x - cell, y - cell, cell * 3, cell * 3);
        ctx.fillStyle = road.bridge ? '#625c43' : road.automatic ? '#596847' : '#655c41';
        ctx.fillRect(x, y, cell, cell);
        if (road.bridge && index % 3 === 0) {
          ctx.fillStyle = '#3d4538';
          ctx.fillRect(x, y + cell, cell, cell * 2);
        } else if (index % 4 === 0) {
          ctx.fillStyle = road.side === 'right' ? '#bd8b46' : '#8cab62';
          ctx.fillRect(x, y, cell, cell);
        }
        lastX = x; lastY = y; index += 1;
      }
    },
    bullet(ctx, start, end, opacity = 1) { pixelTrail(ctx, start, end, opacity, false); },
    missileTrail(ctx, start, end, opacity = 1, pixelSize = cell) { pixelTrail(ctx, start, end, opacity, true, pixelSize); },
    tunnel(ctx, tunnel, interior, selected, tunnelMode) {
      if (interior) return;
      const half = Math.floor(tunnel.interiorWidth / (2 * cell)) * cell;
      let distance = 0;
      for (let segment = 1; segment < tunnel.points.length; segment += 1) {
        const a = tunnel.points[segment - 1], b = tunnel.points[segment];
        const dx = b.x - a.x, dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(length / cell));
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const x = snap(a.x + dx * t), y = snap(a.y + dy * t);
          if (horizontal) {
            ctx.fillStyle = '#151d16';
            ctx.fillRect(x, y - half + cell, cell, Math.max(cell, half * 2 - cell * 2));
            ctx.fillStyle = selected ? '#a8c879' : '#62734d';
            ctx.fillRect(x, y - half, cell, cell);
            ctx.fillRect(x, y + half - cell, cell, cell);
          } else {
            ctx.fillStyle = '#151d16';
            ctx.fillRect(x - half + cell, y, Math.max(cell, half * 2 - cell * 2), cell);
            ctx.fillStyle = selected ? '#a8c879' : '#62734d';
            ctx.fillRect(x - half, y, cell, cell);
            ctx.fillRect(x + half - cell, y, cell, cell);
          }
          if ((distance + step * cell) % (cell * 8) === 0) {
            ctx.fillStyle = '#3c4937';
            if (horizontal) ctx.fillRect(x, y - half + cell, cell, half * 2 - cell * 2);
            else ctx.fillRect(x - half + cell, y, half * 2 - cell * 2, cell);
          }
          if ((distance + step * cell) % (cell * 12) === 0) {
            ctx.fillStyle = tunnelMode ? '#d9c778' : '#bf9349';
            ctx.fillRect(x, y, cell, cell);
          }
        }
        distance += length;
      }
      for (const point of [tunnel.points[0], tunnel.points[tunnel.points.length - 1]]) {
        ctx.fillStyle = '#d3b35c';
        ctx.fillRect(snap(point.x), snap(point.y), cell, cell);
      }
    },
    defensiveMine(ctx, x, y) {
      const px = snap(x), py = snap(y);
      ctx.fillStyle = '#30382b';
      ctx.fillRect(px - cell, py, cell * 3, cell);
      ctx.fillStyle = '#a0ad6b';
      ctx.fillRect(px - cell / 2, py - cell, cell * 2, cell);
      ctx.fillStyle = '#d3b35c';
      ctx.fillRect(px, py - cell, cell, cell);
    },
    missile(ctx, screen, interceptor, angle = -Math.PI / 2, pixelSize = cell) {
      const size = Math.max(1, pixelSize);
      const snapScreen = (value) => Math.round(value / size) * size;
      const snappedAngle = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
      ctx.save();
      ctx.translate(snapScreen(screen.x), snapScreen(screen.y));
      ctx.rotate(snappedAngle + Math.PI / 2);
      ctx.fillStyle = '#422f22';
      ctx.fillRect(-size, -size * 2, size * 2, size * 4);
      ctx.fillStyle = interceptor ? '#b9ca82' : '#d67b37';
      ctx.fillRect(-size, -size * 2, size * 2, size * 3);
      ctx.fillStyle = '#f2d884';
      ctx.fillRect(-size, -size * 3, size * 2, size);
      ctx.fillStyle = '#a8552d';
      ctx.fillRect(-size, size, size, size);
      ctx.fillRect(size, size, size, size);
      ctx.restore();
    },
  };
}
