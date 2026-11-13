// Gameplay-scale unit frames reuse the pixel comparison lab's source art and reduction pipeline.
const URBAN_UNIT_ARTWORK = (() => {
  const palette = {
    healthy: { body: [137, 171, 91], shade: [55, 75, 43], light: [204, 224, 146] },
    warning: { body: [181, 148, 62], shade: [91, 69, 33], light: [239, 207, 91] },
    critical: { body: [174, 72, 49], shade: [78, 40, 34], light: [245, 137, 74] },
  };
  const definitions = {
    trooper: { reference: PIXEL_UNIT_REFERENCE, roles: ['walk', 'jump', 'crouch', 'crouchWalk'], scale: 1 },
    miner: { reference: PIXEL_UNIT_REFERENCE, roles: ['walk', 'crouchWalk'], scale: 1, reduction: 2 },
    tank: { reference: PIXEL_TANK_REFERENCE, roles: ['move', 'aim'], scale: 3 },
    hopper: { reference: PIXEL_HOPPER_REFERENCE, roles: ['idle', 'jump', 'boost', 'fall'], scale: 2, inPlace: true },
    jet: { reference: PIXEL_JET_REFERENCE, roles: ['fly', 'shoot', 'down'], scale: 4 },
  };
  const art = new Map();
  function get(kind) {
    if (!art.has(kind)) {
      const definition = definitions[kind];
      if (!definition || !definition.reference) return null;
      const source = createPixelUnitArtwork(definition.reference, {
        roles: definition.roles, cellScale: definition.scale, cellReduction: definition.reduction || 4,
        ...(definition.inPlace ? { inPlace: true } : {}),
      });
      art.set(kind, { ...source, pixelWidth: source.width, pixelFootRow: source.footRow,
        width: source.width * URBAN_PIXEL_CELL_SIZE, footRow: source.footRow * URBAN_PIXEL_CELL_SIZE,
        cellSize: URBAN_PIXEL_CELL_SIZE });
    }
    return art.get(kind);
  }
  function tint(pixelColor, colors) {
    const value = pixelColor >>> 0;
    const r = (value >>> 16) & 255, g = (value >>> 8) & 255, b = value & 255;
    const source = Math.max(r, g, b);
    if (source < 32) return colors.body;
    if (source < 112) return colors.shade;
    return colors.light;
  }
  function draw(ctx, unit, x, footY, time, angle = 0) {
    const artKind = unit.type === 'miner' ? 'miner' : unit.type;
    const artwork = get(artKind);
    if (!artwork) return false;
    const health = Number.isFinite(unit.health) ? Math.max(0, Math.min(100, unit.health)) : 100;
    const colors = palette[health < 35 ? 'critical' : health < 70 ? 'warning' : 'healthy'];
    let role = unit.type === 'miner' || unit.type === 'trooper' ? 'walk'
      : unit.type === 'tank' ? 'move' : unit.type === 'hopper' ? 'idle' : 'fly';
    if (unit.type === 'trooper' && unit.jumpTimer > 0) role = 'jump';
    if (unit.type === 'hopper' && unit.dodgeTimer > 0) role = 'boost';
    const count = artwork.frameCount(role);
    const index = Math.floor(time * (role === 'idle' ? 4 : 10)) % count;
    const facing = Math.sign(unit.target - unit.x) || (unit.side === 'left' ? 1 : -1);
    const frame = artwork.frame(role, index, facing);
    const cell = URBAN_PIXEL_CELL_SIZE;
    ctx.save();
    ctx.translate(Math.round(x / cell) * cell, Math.round(footY / cell) * cell);
    if (angle) ctx.rotate(angle);
    for (const pixel of frame.pixels) {
      ctx.fillStyle = `rgb(${tint(pixel.color, colors).join(',')})`;
      ctx.fillRect((pixel.x - artwork.pixelWidth / 2) * cell,
        (pixel.y - artwork.pixelFootRow) * cell, cell, cell);
    }
    const sideColor = unit.side === 'right' ? '#d3914d' : '#b9d27a';
    ctx.fillStyle = sideColor;
    ctx.fillRect((facing > 0 ? 1 : -3) * cell, -artwork.footRow + cell, cell, cell);
    if (unit.type === 'hopper') {
      const headX = facing > 0 ? artwork.width * 0.2 : -artwork.width * 0.2;
      ctx.fillStyle = '#fff3aa';
      ctx.fillRect(Math.round(headX / cell) * cell, -artwork.footRow + cell, cell, cell);
    }
    if (unit.type === 'miner') {
      const headX = (facing > 0 ? 2 : -4) * cell;
      ctx.fillStyle = '#edc646';
      ctx.fillRect(headX, -artwork.footRow + cell, cell * 2, cell);
      ctx.fillStyle = '#fff2a1';
      ctx.fillRect(headX + (facing > 0 ? cell : -cell), -artwork.footRow + cell, cell, cell);
      ctx.globalAlpha *= 0.22;
      for (let step = 2; step <= 5; step += 1) {
        ctx.fillRect(headX + facing * step * cell, -artwork.footRow + cell, cell, cell * (step % 2 ? 2 : 1));
      }
      ctx.globalAlpha /= 0.22;
    }
    if (unit.type === 'jet') {
      ctx.fillStyle = '#e98b39';
      ctx.fillRect(-facing * (artwork.width / 2 + cell), -artwork.footRow / 2, cell, cell);
      if (Math.floor(time * 12) % 2 === 0) {
        ctx.fillStyle = '#f2c666';
        ctx.fillRect(-facing * (artwork.width / 2 + cell * 2), -artwork.footRow / 2 + cell, cell, cell);
      }
    }
    ctx.restore();
    return true;
  }
  return { get, draw, palette };
})();

function drawUrbanPixelUnit(ctx, unit, x, footY, time, angle = 0) {
  return URBAN_UNIT_ARTWORK.draw(ctx, unit, x, footY, time, angle);
}
