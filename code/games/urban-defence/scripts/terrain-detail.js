function createTerrainDetail(width, random = Math.random) {
  if (!Number.isFinite(width) || width <= 0 || typeof random !== 'function') {
    throw new Error('Invalid terrain detail configuration');
  }
  const layers = [
    { spacing: 360, amplitude: 26 },
    { spacing: 120, amplitude: 14 },
    { spacing: 40, amplitude: 5 },
  ].map((layer) => {
    const values = Array.from({ length: Math.ceil(width / layer.spacing) + 1 }, () => {
      const sample = random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
        throw new Error('Invalid terrain random sample');
      }
      return (sample * 2 - 1) * layer.amplitude;
    });
    return { ...layer, values };
  });
  return function (x) {
    if (!Number.isFinite(x)) throw new Error('Invalid terrain detail position');
    const position = Math.max(0, Math.min(width, x));
    return layers.reduce((sum, layer) => {
      const index = Math.min(Math.floor(position / layer.spacing), layer.values.length - 2);
      const t = (position - index * layer.spacing) / layer.spacing;
      const smooth = t * t * (3 - 2 * t);
      return sum + layer.values[index] + (layer.values[index + 1] - layer.values[index]) * smooth;
    }, 0);
  };
}
