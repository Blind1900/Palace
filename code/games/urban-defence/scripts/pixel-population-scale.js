function preparePixelSkyscraperSource(source, reference) {
  const artwork = createPixelUnitArtwork(reference, { cellScale: 1, cellReduction: 4 });
  const standing = artwork.frame('walk', 0, 1).pixels;
  const visible = standing.flatMap((cell) => (cell.details || [{ y: 0, size: 1 }])
    .map((detail) => ({ top: cell.y + detail.y, bottom: cell.y + detail.y + detail.size })));
  const trooperHeight = Math.max(...visible.map((cell) => cell.bottom)) - Math.min(...visible.map((cell) => cell.top));
  const topGround = Math.min(...source.heights.map((value) => Math.ceil(value / source.cellSize - 0.5)));
  const skyPadding = Math.max(0, trooperHeight * 20 + 16 - topGround);
  const offset = skyPadding * source.cellSize;
  return { ...source, height: source.height + skyPadding,
    heights: source.heights.map((value) => value + offset),
    waterLevels: source.waterLevels.map((value) => value === null ? null : value + offset),
    tunnels: source.tunnels.map((tunnel) => ({ ...tunnel,
      points: tunnel.points.map((point) => ({ ...point, y: point.y + offset })) })),
    populationScale: { trooperHeight, trooperWidth: artwork.width, trooperClearance: artwork.height, cellReduction: 4,
      skyPadding, originalHeight: source.height, minRatio: 15, maxRatio: 20 } };
}

function pixelPopulationHeight(scale, level) {
  if (!scale || !Number.isFinite(scale.trooperHeight) || scale.trooperHeight < 1 ||
      !Number.isInteger(level) || level < 1 || level > 7) throw new Error('Invalid population height scale');
  return Math.round(scale.trooperHeight * (15 + 5 * (level - 1) / 6));
}

function createPixelPopulationFrame(poles, groundRows, height, floorHeight,
    surfaceRows = groundRows.map((row) => [row, row, row]), style = 'modern', doorHeight = 0) {
  if (!['asian', 'gothic', 'modern'].includes(style)) throw new Error('Invalid population architecture style');
  if (!Number.isInteger(doorHeight) || doorHeight < 0) throw new Error('Invalid population doorway height');
  if (doorHeight) floorHeight = Math.max(floorHeight, doorHeight + 2);
  const surfaceY = Math.min(...surfaceRows.flat());
  const roof = surfaceY - height, cells = new Map();
  const put = (x, y) => cells.set(`${x},${y}`, { x, y });
  const left = poles[0], right = poles[poles.length - 1] + 2;
  const center = Math.floor((left + right) / 2);
  const roofRow = (x) => roof + (style === 'gothic' ? Math.min(3, Math.abs(x - center)) :
    style === 'asian' ? x === center || x === left || x === right ? 0 : 2 : 0);
  for (const [index, pole] of poles.entries()) {
    const door = doorHeight && (index === poles.length - 1 || index === 0 && poles.length > 2);
    for (let y = roofRow(pole + 1); y < surfaceRows[index][1]; y += 1) {
      if (!door || y < surfaceRows[index][1] - 1 - doorHeight || y >= surfaceRows[index][1] - 1) put(pole + 1, y);
    }
    for (let dx = 0; dx < 3; dx += 1) put(pole + dx, surfaceRows[index][dx] - 1);
  }
  for (let x = left; x <= right; x += 1) {
    const row = roofRow(x);
    put(x, row);
    if (x < right) {
      for (let y = Math.min(row, roofRow(x + 1)); y <= Math.max(row, roofRow(x + 1)); y += 1) put(x, y);
    }
  }
  for (let y = roof + floorHeight; y < surfaceY; y += floorHeight) {
    if (doorHeight && y > surfaceY - 2 - doorHeight) continue;
    for (let x = left; x <= right; x += 1) put(x, y);
  }
  return { cells: [...cells.values()], roof, height, floorHeight, style };
}
