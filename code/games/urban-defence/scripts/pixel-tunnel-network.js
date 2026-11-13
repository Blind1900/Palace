// Tunnel/road network built in the reference GIF's three stages:
// survey markers along the centre line -> dig + line both sides with wall pixels -> clear markers.
function createPixelTunnelNetwork(world, options = {}) {
  if (!world || typeof world.placeWall !== 'function') throw new Error('Tunnel network requires a world with wall support');
  const interior = options.interior === undefined ? 3 : options.interior;
  if (!Number.isInteger(interior) || interior < 3 || interior % 2 === 0) {
    throw new Error('Tunnel interior must be an odd integer of at least 3');
  }
  const radius = (interior - 1) / 2;
  const rates = { survey: options.surveyRate || 4, line: options.lineRate || 2, clear: options.clearRate || 4 };
  if (![rates.survey, rates.line, rates.clear].every((rate) => Number.isInteger(rate) && rate > 0)) {
    throw new Error('Tunnel build rates must be positive integers');
  }
  const { width, height } = world;
  const key = (x, y) => y * width + x;
  const surface = new Int32Array(width);
  for (let x = 0; x < width; x += 1) {
    surface[x] = options.surfaceAt ? options.surfaceAt(x) : world.surfaceRow(x);
  }
  const carvedOwner = new Int32Array(width * height).fill(-1);
  const plannedOwner = new Int32Array(width * height).fill(-1);
  const ladder = new Uint8Array(width * height);
  const markers = new Set();
  const segments = [], nodes = [], events = [];
  let ticks = 0, excavated = 0, lined = 0;

  const inNode = (x, y) => nodes.find((node) =>
    Math.max(Math.abs(x - node.x), Math.abs(y - node.y)) <= node.radius) || null;
  // Highest allowed tunnel centre row: the portal height whose floor rests on the ground.
  const portalRow = (x) => Math.min(surface[x], world.surfaceRow(x)) - radius - 1;
  function centerline(points) {
    if (!Array.isArray(points) || !points.length ||
        points.some((point) => !point || !Number.isInteger(point.x) || !Number.isInteger(point.y))) {
      throw new Error('Tunnel route needs integer points');
    }
    const cells = [{ x: points[0].x, y: points[0].y }];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i];
      if (a.x !== b.x && a.y !== b.y) throw new Error('Tunnel legs must be horizontal or vertical');
      const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
      let x = a.x, y = a.y;
      while (x !== b.x || y !== b.y) { x += dx; y += dy; cells.push({ x, y }); }
    }
    return cells;
  }
  function buildSteps(spec) {
    const own = new Set(), stepOf = new Map(), steps = [];
    const push = (center, cells) => {
      const fresh = [];
      for (const cell of cells) {
        const k = key(cell.x, cell.y);
        if (own.has(k)) continue;
        own.add(k); stepOf.set(k, steps.length); fresh.push(k);
      }
      steps.push({ center, cells: fresh, walls: [], ladders: [] });
    };
    let line;
    if (spec.kind === 'chamber') {
      const { left, top, right, bottom } = spec.rect || {};
      if (![left, top, right, bottom].every(Number.isInteger) || right - left < interior - 1 ||
          bottom - top < interior - 1) throw new Error('Invalid chamber rectangle');
      const row = bottom - radius;
      line = [];
      const columns = [];
      for (let x = left; x <= right; x += 1) columns.push(x);
      if (spec.entry === 'right') columns.reverse();
      for (const x of columns) {
        line.push({ x, y: row });
        const cells = [];
        for (let y = top; y <= bottom; y += 1) cells.push({ x, y });
        push({ x, y: row }, cells);
      }
    } else {
      line = centerline(spec.points);
      for (const center of line) {
        const cells = [];
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) cells.push({ x: center.x + dx, y: center.y + dy });
        }
        push(center, cells);
      }
    }
    return { line, steps, own, stepOf };
  }
  function attachWallsAndLadders(spec, built) {
    const { line, steps, own, stepOf } = built, walled = new Set();
    steps.forEach((step, index) => {
      for (const k of step.cells) {
        const x = k % width, y = Math.floor(k / width);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx, ny = y + dy, n = key(nx, ny);
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || own.has(n) || walled.has(n)) continue;
            walled.add(n); steps[index].walls.push(n);
          }
        }
      }
    });
    if (spec.kind === 'chamber') return walled;
    const side = spec.ladderSide === 'right' ? radius : -radius;
    for (let start = 0; start < line.length - 1; start += 1) {
      if (line[start + 1].x !== line[start].x) continue;
      let end = start + 1;
      while (end + 1 < line.length && line[end + 1].x === line[start].x) end += 1;
      const ys = line.slice(start, end + 1).map((cell) => cell.y), x = line[start].x + side;
      for (let y = Math.min(...ys) - radius; y <= Math.max(...ys) + radius; y += 1) {
        const k = key(x, y);
        // Ladders stop at the ground line instead of standing up into open air above the shaft.
        if (x >= 0 && x < width && y < surface[x] - 1) continue;
        if (own.has(k)) steps[stepOf.get(k)].ladders.push(k);
      }
      start = end - 1;
    }
    return walled;
  }
  // Returns { ok, reason, segment }; dryRun validates without reserving cells.
  function plan(spec, planOptions = {}) {
    if (!spec || !['tunnel', 'shaft', 'chamber'].includes(spec.kind || 'tunnel')) throw new Error('Invalid tunnel kind');
    const kind = spec.kind || 'tunnel', crew = spec.crew || 'builders';
    const standalone = spec.from === 'standalone';
    if (standalone && kind !== 'chamber') throw new Error('Only sealed rooms can be standalone');
    const parent = spec.from === 'surface' || standalone ? null : segments[spec.from];
    if (!standalone && spec.from !== 'surface' && !parent) {
      throw new Error('Branches need an existing parent tunnel, "surface" or "standalone"');
    }
    const built = buildSteps({ ...spec, kind });
    const walls = attachWallsAndLadders({ ...spec, kind }, built);
    const fail = (reason) => ({ ok: false, reason });
    const first = built.steps[0].center;
    if (parent) {
      if (!parent.own.has(key(first.x, first.y))) return fail('branch must start inside the parent tunnel');
    } else if (!standalone && first.y >= surface[first.x]) {
      return fail('surface entrances must start above the ground line');
    }
    if (kind !== 'chamber') {
      // A centre line may rise to portal height (floor on the ground) but never climb over the surface into open sky.
      for (const cell of built.line) {
        if (cell.x < 0 || cell.x >= width || carvedOwner[key(cell.x, cell.y)] >= 0) continue;
        if (cell.y < portalRow(cell.x)) return fail('route would climb over the surface');
      }
    }
    for (const k of built.own) {
      const x = k % width, y = Math.floor(k / width);
      if (x < 1 || y < 0 || x >= width - 1 || y >= height - 1) return fail('tunnel leaves the world');
      const material = world.at(x, y);
      if (material === PARTICLE_WATER) return fail('route crosses water');
      if (material === PARTICLE_BARRIER || material === PARTICLE_CONSTRUCTION) return fail('route crosses a structure');
      if (kind === 'chamber' && material === PARTICLE_EMPTY && carvedOwner[k] < 0 && plannedOwner[k] < 0 && y >= surface[x]) {
        return fail('storage would open into a cave');
      }
      if (kind === 'chamber' && inNode(x, y)) return fail('storage cannot be dug into a resource node');
      if (kind === 'chamber' && plannedOwner[k] >= 0 && plannedOwner[k] !== spec.from) {
        return fail('storage overlaps another tunnel');
      }
      if (plannedOwner[k] >= 0 && segments[plannedOwner[k]].kind === 'chamber') return fail('route crosses a storage chamber');
    }
    for (const k of walls) {
      const x = k % width, y = Math.floor(k / width);
      if (world.at(x, y) === PARTICLE_WATER) return fail('wall line would be under water pressure');
      if (kind === 'chamber' && y < surface[x]) return fail('storage chamber must stay sealed underground');
      if (kind === 'chamber' && plannedOwner[k] >= 0 && plannedOwner[k] !== spec.from) {
        return fail('storage would open into another tunnel');
      }
    }
    if (planOptions.dryRun) return { ok: true, reason: 'valid' };
    const segment = {
      id: segments.length, kind, crew, from: spec.from, owner: spec.owner || (parent ? parent.owner : 'neutral'),
      label: spec.label || kind, line: built.line, steps: built.steps, own: built.own,
      survey: built.line.filter((_, index) => index % 2 === 0).map((cell) => key(cell.x, cell.y)),
      phase: crew === 'builders' ? 'survey' : 'line', surveyed: 0, dug: 0, cleared: 0, digPoints: 0,
      state: 'queued', connectedNodes: [], rect: kind === 'chamber' ? { ...spec.rect } : null,
    };
    if (crew !== 'builders') { for (const k of segment.survey) markers.add(k); segment.surveyed = segment.survey.length; }
    for (const k of segment.own) if (plannedOwner[k] < 0) plannedOwner[k] = segment.id;
    segments.push(segment);
    return { ok: true, reason: 'planned', segment };
  }
  function stepBlocker(step) {
    for (const k of step.cells) {
      const material = world.at(k % width, Math.floor(k / width));
      if (material === PARTICLE_WATER) return 'blocked: flooded dig face';
      if (material === PARTICLE_BARRIER || material === PARTICLE_CONSTRUCTION) return 'blocked: structure in path';
    }
    return null;
  }
  function carve(segment) {
    const step = segment.steps[segment.dug];
    const blocker = stepBlocker(step);
    if (blocker) { segment.state = blocker; return false; }
    for (const k of step.cells) {
      const x = k % width, y = Math.floor(k / width), material = world.at(x, y);
      if (material === PARTICLE_TERRAIN || material === PARTICLE_WALL || material === PARTICLE_DEBRIS) {
        excavated += world.excavate(x, y, x, y);
      }
      if (carvedOwner[k] < 0) carvedOwner[k] = segment.id;
    }
    // Walls line solid ground, and also bridge open underground gaps (caves, blast holes) so the tunnel
    // stays sealed and has a floor to walk across.
    for (const k of step.walls) {
      const x = k % width, y = Math.floor(k / width), material = world.at(x, y);
      const gap = material === PARTICLE_EMPTY && y >= surface[x] && carvedOwner[k] < 0;
      if ((material === PARTICLE_TERRAIN || gap) && !inNode(x, y) && world.placeWall(x, y).ok) lined += 1;
    }
    for (const k of step.ladders) ladder[k] = 1;
    segment.dug += 1;
    for (const node of nodes) {
      if (node.connected) continue;
      const touches = step.cells.some((k) => Math.max(Math.abs(k % width - node.x),
        Math.abs(Math.floor(k / width) - node.y)) <= node.radius + 1);
      if (!touches) continue;
      node.connected = true; node.segment = segment.id; node.face = { ...step.center }; node.connectedTick = ticks;
      segment.connectedNodes.push(node.id);
      events.push({ type: 'node-connected', tick: ticks, node, segment, face: { ...step.center } });
    }
    return true;
  }
  function parentReady(segment) {
    return segment.from === 'surface' || segment.from === 'standalone' ||
      ['clear', 'complete'].includes(segments[segment.from].phase);
  }
  function step() {
    ticks += 1;
    const busy = new Set();
    for (const segment of segments) {
      if (segment.phase === 'complete') continue;
      if (busy.has(segment.crew)) { segment.state = `waiting for ${segment.crew} crew`; continue; }
      busy.add(segment.crew);
      if (!parentReady(segment)) { segment.state = 'waiting for parent tunnel'; continue; }
      if (segment.phase === 'survey') {
        for (let n = 0; n < rates.survey && segment.surveyed < segment.survey.length; n += 1) {
          markers.add(segment.survey[segment.surveyed]); segment.surveyed += 1;
        }
        segment.state = 'surveying centre line';
        if (segment.surveyed === segment.survey.length) segment.phase = 'line';
      } else if (segment.phase === 'line') {
        if (segment.crew === 'builders') {
          segment.state = 'digging and lining walls';
          for (let n = 0; n < rates.line && segment.dug < segment.steps.length; n += 1) if (!carve(segment)) break;
        } else {
          segment.state = segment.digPoints > 0 ? 'crew digging' : 'waiting for dig crew';
          while (segment.dug < segment.steps.length) {
            const cost = Math.max(1, segment.steps[segment.dug].cells.filter((k) =>
              world.at(k % width, Math.floor(k / width)) !== PARTICLE_EMPTY).length);
            if (segment.digPoints < cost || !carve(segment)) break;
            segment.digPoints -= cost;
          }
        }
        if (segment.dug === segment.steps.length) { segment.phase = 'clear'; segment.digPoints = 0; }
      } else if (segment.phase === 'clear') {
        for (let n = 0; n < rates.clear && segment.cleared < segment.survey.length; n += 1) {
          markers.delete(segment.survey[segment.cleared]); segment.cleared += 1;
        }
        segment.state = 'clearing survey markers';
        if (segment.cleared === segment.survey.length) {
          segment.phase = 'complete'; segment.state = 'complete'; segment.completedTick = ticks;
          events.push({ type: 'segment-complete', tick: ticks, segment });
        }
      }
    }
  }
  function digFront(segment) {
    if (segment.kind === 'chamber') {
      const center = segment.steps[Math.max(radius, segment.dug - 1 - radius)].center;
      return { x: center.x, y: center.y };
    }
    return { ...segment.steps[Math.max(0, segment.dug - 1)].center };
  }
  function nextDigCell(segment) {
    return segment.dug < segment.steps.length ? { ...segment.steps[segment.dug].center } : null;
  }

  // Unit movement: footprint must be dry and empty; horizontal moves need floor or a ladder,
  // climbing needs a ladder, and anything unsupported falls.
  let routeCells = new Uint8Array(width * height);
  function clearAt(cells, x, y, half) {
    if (x - half < 0 || y - half < 0 || x + half >= width || y + half >= height) return false;
    for (let dy = -half; dy <= half; dy += 1) {
      for (let dx = -half; dx <= half; dx += 1) if (cells[(y + dy) * width + x + dx] !== PARTICLE_EMPTY) return false;
    }
    return true;
  }
  function ladderAt(x, y, half) {
    for (let dy = -half; dy <= half; dy += 1) {
      for (let dx = -half; dx <= half; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && ladder[ny * width + nx]) return true;
      }
    }
    return false;
  }
  function supportedAt(cells, x, y, half) {
    const row = y + half + 1;
    if (row >= height) return true;
    for (let dx = -half; dx <= half; dx += 1) {
      const material = cells[row * width + x + dx];
      if (material !== PARTICLE_EMPTY && material !== PARTICLE_WATER) return true;
    }
    return ladderAt(x, y, half);
  }
  function route(from, to, size = interior) {
    if (!Number.isInteger(size) || size < 1 || size % 2 === 0) throw new Error('Unit footprint must be odd');
    const half = (size - 1) / 2;
    world.copyCells(routeCells);
    const cells = routeCells;
    if (!clearAt(cells, from.x, from.y, half) || !clearAt(cells, to.x, to.y, half)) return null;
    const start = key(from.x, from.y), goal = key(to.x, to.y);
    if (start === goal) return [];
    const parents = new Int32Array(width * height).fill(-1);
    parents[start] = start;
    const queue = [start];
    for (let i = 0; i < queue.length; i += 1) {
      const cell = queue[i], x = cell % width, y = Math.floor(cell / width);
      const supported = supportedAt(cells, x, y, half), onLadder = ladderAt(x, y, half);
      const moves = [];
      if (supported) {
        for (const dx of [-1, 1]) {
          if (clearAt(cells, x + dx, y, half)) moves.push([x + dx, y]);
          else if (clearAt(cells, x, y - 1, half) && clearAt(cells, x + dx, y - 1, half)) moves.push([x + dx, y - 1]);
        }
      }
      if (onLadder && clearAt(cells, x, y - 1, half) && ladderAt(x, y - 1, half)) moves.push([x, y - 1]);
      if (clearAt(cells, x, y + 1, half)) moves.push([x, y + 1]);
      for (const [nx, ny] of moves) {
        const next = key(nx, ny);
        if (parents[next] !== -1) continue;
        parents[next] = cell;
        if (next === goal) {
          const path = [];
          for (let k = goal; k !== start; k = parents[k]) path.push({ x: k % width, y: Math.floor(k / width) });
          return path.reverse();
        }
        queue.push(next);
      }
    }
    return null;
  }
  // World-generation helper: dig a planned segment instantly, without the crew animation.
  function buildNow(segment) {
    while (segment.dug < segment.steps.length) if (!carve(segment)) return false;
    for (const k of segment.survey) markers.delete(k);
    segment.surveyed = segment.cleared = segment.survey.length;
    segment.phase = 'complete'; segment.state = 'complete'; segment.completedTick = ticks;
    return true;
  }
  // Dig tool: surface line or a tunnel's outer wall pixel -> L-shaped route to the target.
  function digSpec(anchor, target, extra = {}) {
    const tx = Math.max(0, Math.min(width - 1, target.x));
    const tidy = (points) => points.filter((point, index) =>
      index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
    let points, from;
    if (anchor.type === 'surface') {
      const ground = Math.min(anchor.y, surface[anchor.x]), cy = ground - radius - 1;
      from = 'surface';
      if (target.y - ground > Math.abs(tx - anchor.x)) {
        points = [{ x: anchor.x, y: cy }, { x: anchor.x, y: target.y }, { x: tx, y: target.y }];
      } else {
        // Ground-level horizontal run: the floor matches the surface so troops walk in, e.g. through a mountain.
        points = [{ x: anchor.x, y: cy }, { x: tx, y: cy }];
        if (target.y >= surface[tx] + radius + 1) points.push({ x: tx, y: target.y });
        // A run that ends buried under higher ground climbs out by ladder so the pass always has an exit.
        else if (surface[tx] <= cy - radius) points.push({ x: tx, y: surface[tx] - radius - 1 });
      }
    } else {
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const side = sides.find(([dx, dy]) => {
        const owner = carvedOwner[key(anchor.x - dx, anchor.y - dy)];
        return owner >= 0 && segments[owner].kind !== 'chamber';
      });
      if (!side) return null;
      const parent = segments[carvedOwner[key(anchor.x - side[0], anchor.y - side[1])]];
      const start = parent.line.reduce((best, cell) =>
        Math.abs(cell.x - anchor.x) + Math.abs(cell.y - anchor.y) <
        Math.abs(best.x - anchor.x) + Math.abs(best.y - anchor.y) ? cell : best);
      from = parent.id;
      points = side[0] !== 0
        ? [start, { x: tx, y: start.y }, { x: tx, y: target.y }]
        : [start, { x: start.x, y: target.y }, { x: tx, y: target.y }];
    }
    points = tidy(points.map((point) => ({ x: point.x, y: point.y })));
    if (points.length < 2) return null;
    return { kind: 'tunnel', from, points, ladderSide: 'left', ...extra };
  }
  // Valid dig starts: the surface line, and wall pixels lining a tunnel or shaft (not sealed rooms).
  function digAnchors() {
    const anchors = [];
    for (let x = 0; x < width; x += 1) {
      const y = world.surfaceRow(x);
      if (y < height && y > radius * 2 + 1) anchors.push({ type: 'surface', x, y });
    }
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        if (world.at(x, y) !== PARTICLE_WALL) continue;
        const k = key(x, y);
        for (const n of [k - 1, k + 1, k - width, k + width]) {
          const owner = carvedOwner[n];
          if (owner >= 0 && segments[owner].kind !== 'chamber' &&
              world.at(n % width, Math.floor(n / width)) === PARTICLE_EMPTY) {
            anchors.push({ type: 'wall', x, y, segment: owner });
            break;
          }
        }
      }
    }
    return anchors;
  }
  // Snaps a dig target onto a nearby tunnel's centre line, or onto the ground line (an exit portal whose floor
  // sits on the ground) when the target is in the air or just under the surface.
  function snapTarget(target, snapOptions = {}) {
    const reach = snapOptions.reach === undefined ? 6 : snapOptions.reach;
    const tx = Math.max(1, Math.min(width - 2, Math.round(target.x)));
    const ty = Math.max(0, Math.min(height - 2, Math.round(target.y)));
    let best = null, bestDistance = Infinity;
    for (let y = Math.max(0, ty - reach); y <= Math.min(height - 1, ty + reach); y += 1) {
      for (let x = Math.max(0, tx - reach); x <= Math.min(width - 1, tx + reach); x += 1) {
        const owner = carvedOwner[key(x, y)];
        if (owner < 0 || segments[owner].kind === 'chamber' || owner === snapOptions.exclude) continue;
        const d = Math.max(Math.abs(x - tx), Math.abs(y - ty));
        if (d < bestDistance) { best = segments[owner]; bestDistance = d; }
      }
    }
    if (best) {
      const cell = best.line.reduce((a, b) =>
        Math.abs(b.x - tx) + Math.abs(b.y - ty) < Math.abs(a.x - tx) + Math.abs(a.y - ty) ? b : a);
      return { x: cell.x, y: cell.y, type: 'tunnel', segment: best.id };
    }
    const ground = world.surfaceRow(tx);
    if (ty < ground + (snapOptions.surfaceReach === undefined ? 4 : snapOptions.surfaceReach)) {
      return { x: tx, y: ground - radius - 1, type: 'surface', ground };
    }
    return { x: tx, y: ty, type: 'free' };
  }
  // Grid search over tunnel centre cells that mirrors plan() validation, preferring few turns and staying
  // underground; used to reroute automatically when the direct dig route is invalid.
  function centerProblem(cx, cy, routeKind) {
    for (let dy = -radius - 1; dy <= radius + 1; dy += 1) {
      for (let dx = -radius - 1; dx <= radius + 1; dx += 1) {
        const x = cx + dx, y = cy + dy;
        const ring = Math.max(Math.abs(dx), Math.abs(dy)) > radius;
        if (!ring && (x < 1 || y < 0 || x >= width - 1 || y >= height - 1)) return 'tunnel leaves the world';
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const material = world.at(x, y), k = key(x, y);
        if (material === PARTICLE_WATER) return ring ? 'wall line would be under water pressure' : 'route crosses water';
        if (ring) continue;
        if (material === PARTICLE_BARRIER || material === PARTICLE_CONSTRUCTION) return 'route crosses a structure';
        if (plannedOwner[k] >= 0 && segments[plannedOwner[k]].kind === 'chamber') return 'route crosses a storage chamber';
      }
    }
    return null;
  }
  function searchRoute(start, goal, limit = 250000) {
    const n = width * height, best = new Float64Array(n * 4).fill(Infinity), parent = new Int32Array(n * 4).fill(-1);
    const okCache = new Int8Array(n);
    const valid = (x, y) => {
      const k = key(x, y);
      if (!okCache[k]) okCache[k] = centerProblem(x, y) ? -1 : 1;
      return okCache[k] === 1;
    };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const heap = [];
    const push = (item) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
    const startKey = key(start.x, start.y);
    for (let d = 0; d < 4; d += 1) { best[startKey * 4 + d] = 0; push([h(start.x, start.y), 0, startKey * 4 + d]); }
    const goalKey = key(goal.x, goal.y);
    for (let expanded = 0; heap.length && expanded < limit; expanded += 1) {
      const [, cost, state] = pop();
      if (cost > best[state]) continue;
      const cell = state >> 2, dir = state & 3, x = cell % width, y = Math.floor(cell / width);
      if (cell === goalKey) {
        const cells = [];
        for (let s = state; s !== -1; s = parent[s]) cells.push({ x: (s >> 2) % width, y: Math.floor((s >> 2) / width) });
        cells.reverse();
        const points = [cells[0]];
        for (let i = 1; i < cells.length - 1; i += 1) {
          const a = cells[i - 1], b = cells[i], c = cells[i + 1];
          if ((b.x - a.x) !== (c.x - b.x) || (b.y - a.y) !== (c.y - b.y)) points.push(b);
        }
        if (cells.length > 1) points.push(cells[cells.length - 1]);
        return points;
      }
      for (let d = 0; d < 4; d += 1) {
        const nx = x + dirs[d][0], ny = y + dirs[d][1];
        if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1 || !valid(nx, ny)) continue;
        const k = key(nx, ny);
        // Detours may skim the ground (portal height) but never climb into open sky.
        if (ny < portalRow(nx) && carvedOwner[k] < 0) continue;
        const inAir = ny < surface[nx] && world.at(nx, ny) === PARTICLE_EMPTY && carvedOwner[k] < 0;
        const next = cost + 1 + (d !== dir && cell !== startKey ? 8 : 0) + (inAir ? 3 : 0);
        const s = k * 4 + d;
        if (next >= best[s]) continue;
        best[s] = next; parent[s] = state; push([next + h(nx, ny), next, s]);
      }
    }
    return null;
  }
  // One-call dig planner for the UI: snaps the target, tries the direct L route, then reroutes around problems.
  function routeDig(anchor, target, extra = {}, routeOptions = {}) {
    const direct = digSpec(anchor, target, extra);
    const snap = routeOptions.snap === false ? { x: target.x, y: target.y, type: 'free' }
      : snapTarget(target, { exclude: direct ? direct.from : undefined });
    const goal = { x: snap.x, y: snap.y };
    const first = direct ? direct.points[0] : null;
    if (!first) return { ok: false, reason: 'move the target away from the start', snap, spec: null };
    const tryPlan = (spec) => { try { return plan(spec, { dryRun: true }); } catch (error) { return { ok: false, reason: error.message }; } };
    let spec = snap.type === 'free' ? direct : digSpec(anchor, goal, extra);
    if (spec && snap.type === 'surface' && spec.points[spec.points.length - 1].y !== goal.y) {
      spec = { ...spec, points: [...spec.points, goal] };
    }
    let result = spec ? tryPlan(spec) : { ok: false, reason: 'move the target away from the start' };
    if (result.ok) return { ok: true, reason: 'valid', spec, snap, rerouted: false };
    const firstProblem = result.reason, directSpec = spec;
    let end = goal.x >= 0 && goal.x < width && goal.y < portalRow(goal.x) && carvedOwner[key(goal.x, goal.y)] < 0
      ? { x: goal.x, y: portalRow(goal.x) } : goal;
    if (centerProblem(end.x, end.y)) {
      const base = end;
      end = null;
      for (let d = 1; d <= 8 && !end; d += 1) {
        for (let dy = -d; dy <= d && !end; dy += 1) {
          for (let dx = -d; dx <= d && !end; dx += 1) {
            const x = base.x + dx, y = base.y + dy;
            if (Math.max(Math.abs(dx), Math.abs(dy)) === d && x >= 0 && x < width && y >= portalRow(x) &&
                !centerProblem(x, y)) end = { x, y };
          }
        }
      }
      if (!end) return { ok: false, reason: `${firstProblem}; no diggable spot near the target`, spec, snap, problem: firstProblem, directSpec };
    }
    const points = searchRoute(first, end, routeOptions.limit);
    if (!points || points.length < 2) return { ok: false, reason: `${firstProblem}; no detour found`, spec, snap, problem: firstProblem, directSpec };
    spec = { ...(direct || {}), points };
    result = tryPlan(spec);
    return { ok: result.ok, reason: result.ok ? `rerouted around: ${firstProblem}` : result.reason, spec, snap,
      rerouted: true, moved: end !== goal, problem: firstProblem, directSpec };
  }
  function addNode(node) {
    if (!node || !Number.isInteger(node.x) || !Number.isInteger(node.y) ||
        !Number.isInteger(node.remaining) || node.remaining < 0) throw new Error('Invalid resource node');
    const entry = { id: node.id || `node-${nodes.length + 1}`, radius: 3, initial: node.remaining, ...node,
      connected: false, segment: null, face: null };
    nodes.push(entry);
    return entry;
  }
  return {
    world, radius, interior, rates, segments, nodes, markers, ladder, surface,
    get ticks() { return ticks; }, get excavated() { return excavated; }, get lined() { return lined; },
    plan, step, route, addNode, digFront, nextDigCell, centerline, buildNow, digSpec, digAnchors, snapTarget, routeDig,
    carvedAt: (x, y) => x >= 0 && y >= 0 && x < width && y < height && carvedOwner[key(x, y)] >= 0,
    takeEvents() { return events.splice(0, events.length); },
    isCarved(x, y) { return x >= 0 && y >= 0 && x < width && y < height && carvedOwner[key(x, y)] >= 0; },
    ownerAt(x, y) { return x >= 0 && y >= 0 && x < width && y < height ? carvedOwner[key(x, y)] : -1; },
    isLadder(x, y) { return x >= 0 && y >= 0 && x < width && y < height && ladder[key(x, y)] === 1; },
    removeLadder(x, y) { if (this.isLadder(x, y)) ladder[key(x, y)] = 0; },
    canStand(x, y, size = interior) {
      const footing = this.standing(x, y, size);
      return footing.clear && footing.supported;
    },
    standing(x, y, size = interior) {
      world.copyCells(routeCells); const half = (size - 1) / 2;
      const clear = clearAt(routeCells, x, y, half);
      return { clear, supported: clear && supportedAt(routeCells, x, y, half) };
    },
    unplan(segment) {
      if (segment !== segments[segments.length - 1] || segment.dug > 0) throw new Error('Only an unstarted last plan can be cancelled');
      for (const k of segment.own) if (plannedOwner[k] === segment.id) plannedOwner[k] = -1;
      for (const k of segment.survey) markers.delete(k);
      segments.pop();
    },
    parentReady,
    dig(segment, points) {
      if (!(points > 0) || segment.crew === 'builders' || segment.phase !== 'line') return false;
      segment.digPoints += points; return true;
    },
    idle() { return segments.every((segment) => segment.phase === 'complete'); },
    inspect() {
      return segments.map((segment) => ({ id: segment.id, kind: segment.kind, label: segment.label, owner: segment.owner,
        crew: segment.crew, phase: segment.phase, state: segment.state,
        progress: `${segment.dug}/${segment.steps.length}` }));
    },
  };
}

// World-gen layout: a surface shaft at each entrance, a level trunk at `depth`, and a branch to each node.
function generatePixelTunnelSystem(network, layouts) {
  const results = [];
  const r = network.radius;
  for (const layout of layouts) {
    const ex = layout.entranceX, top = network.surface[ex] - r - 1, trunkY = network.surface[ex] + layout.depth;
    const shaft = network.plan({ kind: 'shaft', from: 'surface', owner: layout.owner, label: `${layout.owner} entrance`,
      points: [{ x: ex, y: top }, { x: ex, y: trunkY }], ladderSide: layout.ladderSide || 'left' });
    results.push(shaft);
    if (!shaft.ok) continue;
    for (const direction of [-1, 1]) {
      const targets = layout.nodes.filter((node) => Math.sign(node.x - ex) === direction);
      if (!targets.length) continue;
      const reach = (node) => node.x - direction * (node.radius + 2 * r + 4);
      const far = targets.reduce((best, node) => Math.abs(reach(node) - ex) > Math.abs(reach(best) - ex) ? node : best);
      const trunk = network.plan({ kind: 'tunnel', from: shaft.segment.id, label: `${layout.owner} trunk`,
        points: [{ x: ex, y: trunkY }, { x: reach(far), y: trunkY }] });
      results.push(trunk);
      if (!trunk.ok) continue;
      for (const node of targets) {
        const bx = reach(node), stop = node.x - direction * (node.radius + r + 1);
        results.push(network.plan({ kind: 'tunnel', from: trunk.segment.id, label: `${layout.owner} branch to ${node.id}`,
          ladderSide: direction > 0 ? 'left' : 'right',
          points: [{ x: bx, y: trunkY }, { x: bx, y: node.y }, { x: stop, y: node.y }] }));
      }
    }
  }
  return results;
}
