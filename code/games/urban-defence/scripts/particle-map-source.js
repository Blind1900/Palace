// Only the isolated map lab requests a snapshot of this generated game.
if (params.get('particleMapLab') === '1') {
  window.readParticleMapSource = function () {
    const cellSize = 4;
    const width = WORLD_WIDTH / cellSize;
    const height = WORLD_HEIGHT / cellSize;
    const revision = terrainSurface.revision;
    const heights = [], waterLevels = [];
    for (let x = 0; x < width; x += 1) {
      const center = (x + 0.5) * cellSize;
      heights.push(surfaceYAt(center));
      waterLevels.push(waterLevelAt(center));
    }
    if (terrainSurface.revision !== revision) throw new Error('Terrain changed while capturing the map');
    return {
      width, height, cellSize, heights, waterLevels,
      tunnels: starterTunnels.map((tunnel) => ({
        interiorWidth: tunnel.interiorWidth,
        points: tunnel.points.map((point) => ({ x: point.x, y: point.y })),
      })),
    };
  };
}
