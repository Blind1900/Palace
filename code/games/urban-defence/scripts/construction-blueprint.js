function createConstructionBlueprint(model) {
  const nodes = new Map(), edges = [];
  function node(x, y) {
    const key = `${x},${y}`;
    if (!nodes.has(key)) nodes.set(key, { x, y, neighbors: [], distance: Infinity });
    return nodes.get(key);
  }
  function addEdge(section, x1, y1, x2, y2, vertical) {
    const a = node(x1, y1), b = node(x2, y2);
    a.neighbors.push(b);
    b.neighbors.push(a);
    edges.push({ section, a, b, vertical });
  }
  for (const section of model.sections) {
    const x = section.column * 2 + 1, y = section.row * 2 + 1;
    if (section.horizontal) {
      addEdge(section, x - 1, y, x, y, false);
      addEdge(section, x, y, x + 1, y, false);
    }
    if (section.vertical) {
      addEdge(section, x, y - 1, x, y, true);
      addEdge(section, x, y, x, y + 1, true);
    }
  }
  const queue = [];
  for (const edge of edges) {
    if (!edge.section.anchored) continue;
    for (const point of [edge.a, edge.b]) {
      if (point.distance !== 0) { point.distance = 0; queue.push(point); }
    }
  }
  if (!queue.length) throw new Error('Blueprint needs a foundation');
  for (let i = 0; i < queue.length; i += 1) {
    const point = queue[i];
    for (const neighbor of point.neighbors) {
      if (neighbor.distance !== Infinity) continue;
      neighbor.distance = point.distance + 1;
      queue.push(neighbor);
    }
  }
  if (queue.length !== nodes.size) throw new Error('Blueprint contains disconnected members');
  const maxDistance = Math.max(...Array.from(nodes.values(), (point) => point.distance));
  const toWorld = (point) => ({
    x: model.left + point.x * model.size / 2,
    y: model.ground - model.rows * model.size + point.y * model.size / 2,
  });
  const spacing = model.size / 4;
  const originY = model.ground - model.rows * model.size;
  function segments(progress) {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new Error('Invalid blueprint progress');
    }
    const reach = progress * maxDistance, visible = [];
    for (const edge of edges) {
      if (!edge.section.cleared) continue;
      const fromA = Math.max(0, Math.min(1, reach - edge.a.distance));
      const fromB = Math.max(0, Math.min(1, reach - edge.b.distance));
      const a = toWorld(edge.a), b = toWorld(edge.b);
      const pointAt = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const add = (start, end) => {
        const first = pointAt(start), last = pointAt(end);
        visible.push({ x1: first.x, y1: first.y, x2: last.x, y2: last.y, vertical: edge.vertical });
      };
      if (fromA + fromB >= 1) add(0, 1);
      else {
        if (fromA > 0) add(0, fromA);
        if (fromB > 0) add(1 - fromB, 1);
      }
    }
    return visible;
  }
  return {
    spacing,
    segments,
    dots(progress) {
      const points = new Map();
      for (const segment of segments(progress)) {
        const fixed = segment.vertical
          ? Math.round((segment.x1 - model.left) / spacing)
          : Math.round((segment.y1 - originY) / spacing);
        const start = segment.vertical
          ? (Math.min(segment.y1, segment.y2) - originY) / spacing
          : (Math.min(segment.x1, segment.x2) - model.left) / spacing;
        const end = segment.vertical
          ? (Math.max(segment.y1, segment.y2) - originY) / spacing
          : (Math.max(segment.x1, segment.x2) - model.left) / spacing;
        for (let i = Math.ceil(start - 1e-9); i <= Math.floor(end + 1e-9); i += 1) {
          const x = segment.vertical ? fixed : i;
          const y = segment.vertical ? i : fixed;
          points.set(`${x},${y}`, { x: model.left + x * spacing, y: originY + y * spacing });
        }
      }
      return Array.from(points.values());
    },
  };
}
