function drawParticleWaterContacts(ctx, scenario) {
  if (!scenario.waterBlocksAttached) return;
  const { world, model, scale } = scenario;
  const isWater = (x, y) => x >= 0 && x < world.width && y >= 0 && y < world.height &&
    world.at(x, y) === PARTICLE_WATER;
  const isEmpty = (x, y) => x >= 0 && x < world.width && y >= 0 && y < world.height &&
    world.at(x, y) === PARTICLE_EMPTY;
  ctx.save();
  ctx.fillStyle = '#1facc8';
  for (const section of model.sections) {
    if (!section.attached || section.cleared || section.angle !== 0) continue;
    const cx = section.x + model.size / 2, cy = section.y + model.size / 2;
    const shapes = [];
    if (section.vertical) shapes.push({ vertical: true, left: cx - model.wallThickness / 2,
      right: cx + model.wallThickness / 2, top: cy - model.size / 2, bottom: cy + model.size / 2 });
    if (section.horizontal) shapes.push({ vertical: false, left: cx - model.size / 2,
      right: cx + model.size / 2, top: cy - model.thickness / 2, bottom: cy + model.thickness / 2 });
    for (const shape of shapes) {
      const minX = Math.max(0, Math.floor(shape.left / scale));
      const maxX = Math.min(world.width - 1, Math.floor(shape.right / scale));
      const minY = Math.max(0, Math.floor(shape.top / scale));
      const maxY = Math.min(world.height - 1, Math.floor(shape.bottom / scale));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (world.at(x, y) !== PARTICLE_EMPTY) continue;
          const left = x * scale, top = y * scale, right = left + scale, bottom = top + scale;
          if (shape.vertical) {
            if (x !== Math.floor(cx / scale) && Math.abs(left + scale / 2 - cx) >= model.wallThickness / 2) continue;
            const from = Math.max(top, shape.top), to = Math.min(bottom, shape.bottom);
            if (to <= from) continue;
            for (const direction of [-1, 1]) {
              const edge = direction < 0 ? shape.left : shape.right;
              if (edge <= left || edge >= right) continue;
              const neighbor = x + direction;
              const supportedNotch = isEmpty(neighbor, y) && isWater(neighbor + direction, y) &&
                isWater(neighbor, y + 1) && from === top && to === bottom;
              if (supportedNotch) ctx.fillRect(neighbor * scale, top, scale, scale);
              if (isWater(neighbor, y) || supportedNotch) {
                const start = direction < 0 ? left : edge;
                const end = direction < 0 ? edge : right;
                ctx.fillRect(start, from, end - start, to - from);
              }
            }
          } else {
            if (y !== Math.floor(cy / scale) && Math.abs(top + scale / 2 - cy) >= model.thickness / 2) continue;
            const from = Math.max(left, shape.left), to = Math.min(right, shape.right);
            if (to <= from) continue;
            if (shape.top > top && shape.top < bottom && isWater(x, y - 1))
              ctx.fillRect(from, top, to - from, shape.top - top);
            if (shape.bottom > top && shape.bottom < bottom && isWater(x, y + 1))
              ctx.fillRect(from, shape.bottom, to - from, bottom - shape.bottom);
          }
        }
      }
    }
  }
  ctx.restore();
}
