// Visuals only: coordinates and dimensions come from the gameplay models.
function createWorldObjectRenderer() {
  function path(ctx, points, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  return {
    road(ctx, points) {
      path(ctx, points.map((point) => ({ x: point.x, y: point.y - 2 })), '#000000', 1);
    },
    bullet(ctx, start, end, opacity = 1) {
      ctx.save();
      ctx.globalAlpha *= opacity;
      path(ctx, [start, end], '#bba473', 0.7);
      ctx.restore();
    },
    tunnel(ctx, tunnel, interior, selected, tunnelMode, wallWidth) {
      ctx.beginPath();
      tunnel.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const tunnelPalettes = {
        asian: { wall: '#b99a59', light: '#f3d384', support: '#66563d' },
        gothic: { wall: '#8e81aa', light: '#d5c5fb', support: '#50465f' },
        modern: { wall: '#64a6a2', light: '#bbf3df', support: '#3e6667' },
      };
      const palette = tunnelPalettes[tunnel.style] || tunnelPalettes.modern;
      ctx.strokeStyle = interior ? '#020202' : selected ? '#6ef08a' : palette.wall;
      ctx.lineWidth = tunnel.interiorWidth + (interior ? 0 : wallWidth * 2);
      ctx.shadowColor = !interior && selected ? '#6ef08a' : 'transparent';
      ctx.shadowBlur = !interior && tunnelMode ? 5 : 0;
      ctx.stroke();
      if (interior) return;

      const spacing = Math.max(14, tunnel.interiorWidth * 2.2);
      const total = tunnel.points.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - tunnel.points[index].x, point.y - tunnel.points[index].y), 0);
      const braceColor = selected ? '#d8f7b0' : palette.support;
      ctx.strokeStyle = braceColor;
      ctx.lineWidth = Math.max(0.7, wallWidth * 0.65);
      for (let distance = spacing / 2; distance < total; distance += spacing) {
        let remaining = distance;
        for (let index = 1; index < tunnel.points.length; index += 1) {
          const a = tunnel.points[index - 1], b = tunnel.points[index];
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          if (remaining > length) { remaining -= length; continue; }
          const t = length ? remaining / length : 0;
          const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
          const nx = length ? -(b.y - a.y) / length : 0;
          const ny = length ? (b.x - a.x) / length : 1;
          ctx.beginPath();
          ctx.moveTo(x - nx * tunnel.interiorWidth * 0.47, y - ny * tunnel.interiorWidth * 0.47);
          ctx.lineTo(x + nx * tunnel.interiorWidth * 0.47, y + ny * tunnel.interiorWidth * 0.47);
          ctx.stroke();
          if (Math.round(distance / spacing) % 3 === 0) {
            ctx.fillStyle = palette.light;
            ctx.fillRect(x - 1, y - 1, 2, 2);
          }
          break;
        }
      }
      for (const point of [tunnel.points[0], tunnel.points[tunnel.points.length - 1]]) {
        ctx.fillStyle = selected ? '#b8ee7a' : palette.light;
        ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
        ctx.strokeStyle = palette.wall;
        ctx.strokeRect(point.x - tunnel.interiorWidth * 0.55, point.y - 3, tunnel.interiorWidth * 1.1, 6);
      }
    },
    defensiveMine(ctx, x, y, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3, y, 6, 3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 2);
      ctx.stroke();
    },
    missile(ctx, screen, interceptor) {
      ctx.fillStyle = interceptor ? '#c9f8ff' : '#ffe1a0';
      ctx.fillRect(screen.x - 2, screen.y - 2, 4, 4);
    },
  };
}
