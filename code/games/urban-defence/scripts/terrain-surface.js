function createTerrainSurface(width, spacing, generateHeight) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(spacing) || spacing <= 0 ||
      !Number.isInteger(width / spacing) || typeof generateHeight !== 'function') {
    throw new Error('Invalid terrain surface configuration');
  }
  const samples = Array.from({ length: width / spacing + 1 }, (_, index) => {
    const height = generateHeight(index * spacing);
    if (!Number.isFinite(height)) throw new Error('Invalid generated terrain height');
    return height;
  });
  let revision = 0;
  return {
    heightAt(x) {
      if (!Number.isFinite(x)) throw new Error('Invalid terrain position');
      const position = Math.min(width, Math.max(0, x));
      const index = Math.min(Math.floor(position / spacing), samples.length - 2);
      const fraction = (position - index * spacing) / spacing;
      return samples[index] + (samples[index + 1] - samples[index]) * fraction;
    },
    crater(center, radius, depth) {
      if (!Number.isFinite(center) || !Number.isFinite(radius) || radius <= 0 ||
          !Number.isFinite(depth) || depth < 0) throw new Error('Invalid crater');
      const first = Math.max(0, Math.ceil((center - radius) / spacing));
      const last = Math.min(samples.length - 1, Math.floor((center + radius) / spacing));
      let changed = false;
      for (let index = first; index <= last; index += 1) {
        const change = depth * (1 - Math.abs(index * spacing - center) / radius);
        if (change > 0) {
          samples[index] += change;
          changed = true;
        }
      }
      if (changed) revision += 1;
    },
    get revision() { return revision; },
  };
}
