// Underground supply lines for the beta, ported from the tunnel network lab's pipeline highway.
// Each side runs an SM, an HM and a water line between its own structures. A line follows the terrain
// contour at a fixed cover depth and re-lays itself whenever the ground changes. An explosion that reaches
// a line breaks it: the broken span keeps its old position until the owner's crew re-lays it around the
// crater, one cell at a time, paying HM per cell. Water stays logical, as in the lab: pumps measure a basin
// but never take water out of it, so basins never drain.
const URBAN_PIPE_CELL = 2;
const URBAN_PIPE_LINES = Object.freeze([
  Object.freeze({ resource: 'sm', depth: 8, casing: [52, 130, 46], channel: [14, 30, 14], cargo: [127, 214, 91] }),
  Object.freeze({ resource: 'hm', depth: 20, casing: [150, 120, 40], channel: [34, 27, 12], cargo: [230, 205, 114] }),
  Object.freeze({ resource: 'water', depth: 32, casing: [67, 115, 128], channel: [10, 26, 34], cargo: [140, 210, 226] }),
]);
const URBAN_PIPE_SIDE_OFFSET = { left: 0, right: 6 };
const URBAN_PIPE_REPAIR_DELAY = 6;
const URBAN_PIPE_REPAIR_CELLS_PER_SECOND = 6;
const URBAN_PIPE_REPAIR_HM_PER_CELL = 0.25;
const URBAN_PIPE_CARGO_SPEED = 90;

function createUrbanPipeline({ surfaceYAt, worldWidth, worldHeight, waterLevelAt, terrainRevision }) {
  const cell = URBAN_PIPE_CELL;
  const snap = (value) => Math.round(value / cell) * cell;
  const networks = { left: createNetwork('left'), right: createNetwork('right') };
  let revision = -1;
  let anchorsKey = '';
  let clock = 0;

  function createNetwork(side) {
    return {
      side,
      anchors: [],
      lines: Object.fromEntries(URBAN_PIPE_LINES.map((spec) => [spec.resource, {
        spec, side, depth: spec.depth + URBAN_PIPE_SIDE_OFFSET[side],
        left: 0, right: -1, ys: new Float32Array(0), spans: [], cargo: [], spawnClock: new Map(), layers: null,
      }])),
    };
  }

  // Channel row for a column: the deepest surface within the cover window plus the cover depth, so the
  // tube keeps at least `depth` units of ground above and beside it (the lab's Chebyshev cover rule).
  function contourY(x, depth) {
    let deepest = 0;
    const window = Math.min(depth, 32);
    for (let dx = -window; dx <= window; dx += 4) {
      deepest = Math.max(deepest, surfaceYAt(Math.max(0, Math.min(worldWidth, x + dx))));
    }
    return Math.min(worldHeight - cell * 3, snap(deepest + depth));
  }

  function lineIndex(line, x) { return Math.round((x - line.left) / cell); }
  function lineY(line, x) {
    if (line.right < line.left) return null;
    const index = Math.max(0, Math.min(line.ys.length - 1, lineIndex(line, x)));
    return line.ys[index];
  }
  function spanAt(line, x) { return line.spans.find((span) => x >= span.left && x <= span.right && !span.done); }

  // Lay or re-lay a line between its anchors. Broken spans keep their frozen cells until repaired.
  function layLine(line, left, right) {
    const previous = { left: line.left, ys: line.ys };
    line.left = snap(left);
    line.right = snap(right);
    const count = line.right >= line.left ? Math.round((line.right - line.left) / cell) + 1 : 0;
    line.ys = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const x = line.left + index * cell;
      const span = spanAt(line, x);
      const frozen = span ? span.frozen.get(x) : undefined;
      if (frozen !== undefined) { line.ys[index] = frozen; continue; }
      if (span && x <= span.repairedTo) { line.ys[index] = span.relaid.get(x) ?? contourY(x, line.depth); continue; }
      line.ys[index] = contourY(x, line.depth);
    }
    if (previous.ys.length !== count || previous.left !== line.left) line.cargo.length = 0;
    line.layers = null;
  }

  function sync(sides) {
    const key = JSON.stringify(Object.entries(sides).map(([side, anchors]) =>
      [side, anchors.map((anchor) => `${anchor.id}:${Math.round(anchor.x)}:${anchor.resources.join('')}`)]));
    const currentRevision = terrainRevision();
    if (key === anchorsKey && currentRevision === revision) return;
    anchorsKey = key;
    revision = currentRevision;
    for (const [side, anchors] of Object.entries(sides)) {
      const network = networks[side];
      if (!network) continue;
      network.anchors = anchors;
      for (const line of Object.values(network.lines)) {
        const using = anchors.filter((anchor) => anchor.resources.includes(line.spec.resource));
        if (using.length < 2) { line.left = 0; line.right = -1; line.ys = new Float32Array(0); line.layers = null; continue; }
        layLine(line, Math.min(...using.map((anchor) => anchor.x)) - cell * 3,
          Math.max(...using.map((anchor) => anchor.x)) + cell * 3);
      }
    }
  }

  // Break every line whose casing the crater (a cone of `depth` at the centre) reaches, plus 6 units of shock.
  function damage(center, radius, depth) {
    let broken = 0;
    for (const network of Object.values(networks)) {
      for (const line of Object.values(network.lines)) {
        if (line.right < line.left || center + radius < line.left || center - radius > line.right) continue;
        let first = Infinity, last = -Infinity;
        for (let x = snap(Math.max(line.left, center - radius)); x <= Math.min(line.right, center + radius); x += cell) {
          const craterDepth = depth * Math.max(0, 1 - Math.abs(x - center) / radius);
          if (craterDepth <= 0) continue;
          const y = lineY(line, x);
          if (y - cell <= surfaceYAt(x) + craterDepth + 6) { first = Math.min(first, x); last = Math.max(last, x); }
        }
        if (first > last) continue;
        broken += 1;
        const overlapping = line.spans.filter((span) => !span.done && first <= span.right + cell && last >= span.left - cell);
        const span = overlapping[0] || { left: first, right: last, frozen: new Map(), relaid: new Map(),
          since: clock, repairedTo: -Infinity, state: 'broken', done: false };
        for (const other of overlapping.slice(1)) {
          span.left = Math.min(span.left, other.left);
          span.right = Math.max(span.right, other.right);
          for (const [x, y] of other.frozen) span.frozen.set(x, y);
          line.spans.splice(line.spans.indexOf(other), 1);
        }
        span.left = Math.min(span.left, first);
        span.right = Math.max(span.right, last);
        span.since = clock;
        span.repairedTo = Math.min(span.repairedTo, span.left - cell);
        span.relaid.clear();
        for (let x = span.left; x <= span.right; x += cell) if (!span.frozen.has(x)) span.frozen.set(x, lineY(line, x));
        if (!line.spans.includes(span)) line.spans.push(span);
        line.layers = null;
      }
    }
    return broken;
  }

  // Crews wait for the blast to settle, then re-lay the span along the new ground from its left end.
  function repair(delta, payHm) {
    for (const network of Object.values(networks)) {
      for (const line of Object.values(network.lines)) {
        for (const span of line.spans) {
          if (span.done) continue;
          if (clock - span.since < URBAN_PIPE_REPAIR_DELAY) { span.state = 'settling'; continue; }
          span.work = (span.work || 0) + URBAN_PIPE_REPAIR_CELLS_PER_SECOND * delta;
          while (span.work >= 1 && !span.done) {
            const x = Math.max(span.left, span.repairedTo + cell);
            if (waterLevelAt(x) !== null && waterLevelAt(x) < contourY(x, line.depth)) { span.state = 'flooded'; span.work = 0; break; }
            if (!payHm(network.side, URBAN_PIPE_REPAIR_HM_PER_CELL)) { span.state = 'waiting for HM'; span.work = 0; break; }
            span.work -= 1;
            span.state = 'repairing';
            span.frozen.delete(x);
            span.relaid.set(x, contourY(x, line.depth));
            span.repairedTo = x;
            span.flash = clock;
            if (x >= span.right) span.done = true;
            line.layers = null;
          }
        }
        if (line.spans.some((span) => span.done)) {
          line.spans = line.spans.filter((span) => !span.done || clock - span.flash < 1.2);
          layLine(line, line.left, line.right);
        }
      }
    }
  }

  function connected(side, resource, fromX, toX) {
    const network = networks[side];
    if (!network) return false;
    const line = network.lines[resource];
    if (!line || line.right < line.left) return false;
    const left = Math.min(fromX, toX), right = Math.max(fromX, toX);
    if (left < line.left - cell * 4 || right > line.right + cell * 4) return false;
    return !line.spans.some((span) => !span.done && span.right >= left && span.left <= right);
  }

  // Cargo pixels show the real flows passed in by the economy: each one stands for `unit` resource and
  // queues at a break until the span is re-laid.
  function moveCargo(delta, flows) {
    for (const flow of flows) {
      const network = networks[flow.side];
      const line = network && network.lines[flow.resource];
      if (!line || line.right < line.left || flow.rate <= 0) continue;
      const key = `${Math.round(flow.fromX)}>${Math.round(flow.toX)}`;
      const interval = Math.max(0.12, 0.1 / flow.rate);
      const timer = (line.spawnClock.get(key) || 0) + delta;
      if (timer >= interval && line.cargo.length < 160) {
        line.cargo.push({ x: flow.fromX, to: flow.toX, direction: Math.sign(flow.toX - flow.fromX) || 1 });
        line.spawnClock.set(key, timer - interval);
      } else line.spawnClock.set(key, Math.min(timer, interval));
    }
    for (const network of Object.values(networks)) {
      for (const line of Object.values(network.lines)) {
        line.cargo.sort((a, b) => a.direction * (b.x - a.x));
        for (let index = line.cargo.length - 1; index >= 0; index -= 1) {
          const item = line.cargo[index];
          let next = item.x + item.direction * URBAN_PIPE_CARGO_SPEED * delta;
          const blocked = line.spans.find((span) => !span.done && (item.direction > 0
            ? item.x <= span.left && next >= span.left - cell * 2 : item.x >= span.right && next <= span.right + cell * 2));
          if (blocked) next = item.direction > 0 ? Math.min(next, blocked.left - cell * 2) : Math.max(next, blocked.right + cell * 2);
          const ahead = line.cargo.find((other) => other !== item && other.direction === item.direction
            && item.direction * (other.x - item.x) > 0 && item.direction * (other.x - next) < cell * 3);
          if (ahead && blocked) next = ahead.x - item.direction * cell * 3;
          item.x = item.direction > 0 ? Math.max(item.x, next) : Math.min(item.x, next);
          if (item.direction * (item.to - item.x) <= 0 || item.x < line.left || item.x > line.right) line.cargo.splice(index, 1);
        }
      }
    }
  }

  function update(delta, sides, flows, payHm) {
    clock += delta;
    sync(sides);
    repair(delta, payHm);
    moveCargo(delta, flows);
  }

  const rgb = (color, scale = 1) => `rgb(${color.map((value) => Math.max(0, Math.min(255, Math.round(value * scale)))).join(',')})`;

  // Static layers (casing body, highlight, shadow, flanges, bolts, channel, risers, fixtures) are cached as
  // Path2D groups until the line is re-laid, so a full-map view costs a handful of fills per line.
  function buildLayers(line, network) {
    const groups = new Map();
    const add = (color, x, y, width, height) => {
      if (!groups.has(color)) groups.set(color, new Path2D());
      groups.get(color).rect(x, y, width, height);
    };
    const { casing, channel } = line.spec;
    const body = rgb(casing), top = rgb(casing, 1.3), bottom = rgb(casing, 0.72), flange = rgb(casing, 0.62),
      bolt = rgb(casing, 1.55), dark = rgb(channel);
    let previous = null;
    for (let index = 0; index < line.ys.length; index += 1) {
      const x = line.left + index * cell, y = line.ys[index];
      const span = spanAt(line, x);
      if (span && span.frozen.has(x) && x > span.repairedTo) { previous = null; continue; }
      if (previous !== null && Math.abs(previous - y) > 0) {
        const from = Math.min(previous, y) - cell, to = Math.max(previous, y) + cell;
        add(body, x - cell, from, cell * 2, to - from + cell);
        add(dark, x - cell / 2, Math.min(previous, y), cell, Math.abs(previous - y) + cell);
      }
      add(top, x, y - cell, cell, cell * 0.5);
      add(body, x, y - cell * 0.5, cell, cell * 0.5);
      add(dark, x, y, cell, cell);
      add(body, x, y + cell, cell, cell * 0.5);
      add(bottom, x, y + cell * 1.5, cell, cell * 0.5);
      const ring = Math.round(x / cell) % 12;
      if (ring === 0 || ring === 1) {
        add(flange, x, y - cell * 1.5, cell, cell * 4);
        if (ring === 0) { add(bolt, x, y - cell * 1.5, cell * 0.5, cell * 0.5); add(bolt, x, y + cell * 2, cell * 0.5, cell * 0.5); }
      }
      previous = y;
    }
    for (const anchor of network.anchors) {
      if (!anchor.resources.includes(line.spec.resource)) continue;
      const offset = { sm: -3, hm: 3, water: 0 }[line.spec.resource];
      const x = snap(anchor.x + offset * cell);
      const lineAt = lineY(line, x);
      if (lineAt === null) continue;
      const end = anchor.y !== undefined ? anchor.y : surfaceYAt(x) - cell;
      const from = Math.min(end, lineAt), to = Math.max(end, lineAt);
      add(body, x - cell, from, cell * 3, to - from);
      add(dark, x, from, cell, to - from);
      add(top, x - cell, from, cell * 3, cell * 0.5);
      // Junction box with a valve wheel where the riser meets the trunk.
      add(rgb([60, 66, 70]), x - cell * 2, lineAt - cell * 2, cell * 5, cell * 4);
      add(rgb(casing, 1.4), x - cell, lineAt - cell, cell * 3, cell * 0.5);
      add(rgb([196, 70, 52]), x, lineAt - cell * 3, cell, cell);
      if (anchor.kind === 'pump') {
        // Pump house on the shore with a suction pipe down into the basin (the lab's farm pump head).
        const ground = surfaceYAt(anchor.x);
        const pumpX = snap(anchor.pumpX ?? anchor.x);
        add('#2f4650', pumpX - cell * 4, ground - cell * 5, cell * 9, cell * 5);
        add('#4f7380', pumpX - cell * 3, ground - cell * 4, cell * 7, cell * 3);
        add('#9fd3e2', pumpX - cell, ground - cell * 4, cell * 3, cell);
        add('#2f4650', pumpX - cell * 3, ground - cell * 7, cell, cell * 2);
        add('#8bc6d6', pumpX + cell * 3, ground - cell * 2, cell, cell);
        if (anchor.intakeX !== undefined && anchor.intakeY !== undefined) {
          const intake = snap(anchor.intakeX);
          const low = Math.min(anchor.intakeY, ground - cell * 2);
          add('#4f7380', Math.min(pumpX, intake), low, Math.abs(intake - pumpX) + cell, cell);
          add('#4f7380', intake, low, cell, Math.abs(anchor.intakeY - low) + cell * 3);
          add('#9fd3e2', intake - cell, anchor.intakeY + cell * 3, cell * 3, cell);
        }
      }
    }
    return groups;
  }

  function draw(ctx, view) {
    const blink = Math.floor(clock * 6) % 2 === 0;
    for (const network of Object.values(networks)) {
      for (const line of Object.values(network.lines)) {
        if (line.right < line.left || line.right < view.left || line.left > view.right) continue;
        if (!line.layers) line.layers = buildLayers(line, network);
        for (const [color, path] of line.layers) { ctx.fillStyle = color; ctx.fill(path); }
        for (const span of line.spans) {
          for (let x = span.left; x <= span.right; x += cell) {
            if (x > span.repairedTo && span.frozen.has(x)) {
              const y = span.frozen.get(x);
              const gap = Math.abs(x - (span.left + span.right) / 2) < (span.right - span.left) * 0.25;
              if (gap) continue;
              ctx.fillStyle = blink ? '#e0453a' : '#7a2a22';
              ctx.fillRect(x, y - cell, cell, cell * 3);
            } else if (span.flash !== undefined && clock - span.flash < 1.2 && blink) {
              ctx.fillStyle = '#fffadc';
              ctx.fillRect(x, lineY(line, x) - cell, cell, cell * 3);
            }
          }
          if (span.state === 'repairing' || span.state === 'waiting for HM' || span.state === 'flooded') {
            const x = Math.max(span.left, span.repairedTo + cell);
            const y = span.frozen.get(x) ?? lineY(line, x);
            ctx.fillStyle = span.state === 'repairing' ? (blink ? '#ffe9a0' : '#f2b33d') : '#e0453a';
            ctx.fillRect(x - cell, y - cell * 3, cell, cell);
            ctx.fillRect(x + cell, y - cell * 2, cell, cell);
          }
        }
        const glow = rgb(line.spec.cargo, 0.55), cargo = rgb(line.spec.cargo, 1.15);
        for (const item of line.cargo) {
          if (item.x < view.left || item.x > view.right) continue;
          const x = snap(item.x), y = lineY(line, x);
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = glow;
          ctx.fillRect(x - cell, y - cell, cell * 3, cell * 3);
          ctx.globalAlpha = 1;
          ctx.fillStyle = cargo;
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
  }

  return {
    update, draw, damage, connected, sync,
    snapshot: () => Object.fromEntries(Object.entries(networks).map(([side, network]) => [side,
      Object.fromEntries(Object.entries(network.lines).map(([resource, line]) => [resource, {
        left: line.left, right: line.right, cells: line.ys.length, cargo: line.cargo.length,
        spans: line.spans.map((span) => ({ left: span.left, right: span.right, state: span.state, done: span.done,
          repairedTo: span.repairedTo })),
      }]))])),
    lineY: (side, resource, x) => networks[side] ? lineY(networks[side].lines[resource], x) : null,
  };
}
