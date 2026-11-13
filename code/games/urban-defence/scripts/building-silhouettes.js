const buildingSilhouetteNames = Object.freeze([
  'Slab', 'Tiered tower', 'Offset tower', 'Tapered tower', 'Capped tower', 'Stepped peak', 'Spire',
]);

function createBuildingSilhouette(name, x, ground, width, height) {
  if (!buildingSilhouetteNames.includes(name) || ![x, ground, width, height].every(Number.isFinite) ||
      width <= 0 || height <= 0) throw new Error('Invalid building silhouette');
  const outlines = {
    'Slab': [[0, 0], [0, 0.9], [1, 0.9], [1, 0]],
    'Tiered tower': [[0, 0], [0, 0.25], [0.18, 0.25], [0.18, 0.65], [0.32, 0.65],
      [0.32, 1], [0.68, 1], [0.68, 0.65], [0.82, 0.65], [0.82, 0.25], [1, 0.25], [1, 0]],
    'Offset tower': [[0, 0], [0, 0.5], [0.18, 0.5], [0.18, 1], [0.72, 1],
      [0.72, 0.5], [1, 0.5], [1, 0]],
    'Tapered tower': [[0, 0], [0.38, 1], [0.62, 1], [1, 0]],
    'Capped tower': [[0, 0], [0, 0.93], [0.22, 0.93], [0.22, 1], [0.78, 1],
      [0.78, 0.93], [1, 0.93], [1, 0]],
    'Stepped peak': [[0, 0], [0, 0.58], [0.22, 0.58], [0.22, 0.83], [0.5, 1],
      [0.78, 0.83], [0.78, 0.58], [1, 0.58], [1, 0]],
    'Spire': [[0, 0], [0, 0.78], [0.5, 1], [1, 0.78], [1, 0]],
  };
  return outlines[name].map(([px, py]) => ({ x: x + px * width, y: ground - py * height }));
}
