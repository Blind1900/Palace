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
      ctx.strokeStyle = interior ? '#020202' : selected ? '#6ef08a' : '#d7b54a';
      ctx.lineWidth = tunnel.interiorWidth + (interior ? 0 : wallWidth * 2);
      ctx.shadowColor = !interior && selected ? '#6ef08a' : 'transparent';
      ctx.shadowBlur = !interior && tunnelMode ? 5 : 0;
      ctx.stroke();
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
