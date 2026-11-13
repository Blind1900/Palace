(function () {
  const width = 2400, height = 390, cellSize = 4;
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const fps = createLabFps(document.getElementById('fps'));
  const viewport = document.getElementById('viewport');
  const zoom = document.getElementById('zoom');
  const status = document.getElementById('status');
  const message = document.getElementById('message');
  const results = document.getElementById('results');
  const generate = document.getElementById('generate');
  const diagonal = document.getElementById('diagonal');
  const reset = document.getElementById('reset');
  const pause = document.getElementById('pause');
  const step = document.getElementById('step');
  const benchmark = document.getElementById('benchmark');
  const heavyBenchmark = document.getElementById('heavy-benchmark');
  const importBenchmark = document.getElementById('import-benchmark');
  const tool = document.getElementById('tool');
  const inspection = document.getElementById('inspection');
  const tunnelButtons = [document.getElementById('tunnel-left'), document.getElementById('tunnel-right')];
  const image = ctx.createImageData(width, height);
  let world = null, initial = null, passage = null, tunnels = [], mode = '', steps = 0, running = false, busy = false;
  let toolMode = 0, selected = null, routeStart = null, routeResult = null;
  const inspectionHelp = 'Experimental estimates only; no unit clearance or live-game pathfinding.';

  function controls() {
    generate.disabled = busy;
    diagonal.disabled = busy;
    reset.disabled = busy || !world;
    pause.disabled = busy || !world;
    step.disabled = busy || !world || running;
    benchmark.disabled = busy || !world;
    heavyBenchmark.disabled = busy || !world;
    importBenchmark.disabled = busy || mode !== 'Synthetic diagonal test';
    tool.disabled = busy || !world;
    tool.textContent = ['Tool: Blast', 'Tool: Inspect passage', 'Tool: Route test'][toolMode];
    tunnelButtons.forEach((button, index) => { button.disabled = busy || !tunnels[index]; });
    pause.textContent = running ? 'Pause' : 'Run simulation';
    pause.setAttribute('aria-pressed', String(running));
  }
  function setZoom() {
    canvas.style.width = `${width * Number(zoom.value)}px`;
    canvas.style.height = `${height * Number(zoom.value)}px`;
  }
  function showInspection(text) {
    if (inspection.textContent !== text) inspection.textContent = text;
  }
  function draw() {
    const cells = world.snapshot().cells;
    renderParticleCells(cells, width, height, image,
      (x, y) => x >= 0 && x < width && y >= 0 && y < height && passage[y * width + x] === 1);
    ctx.putImageData(image, 0, 0);
    if (routeStart) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(routeStart.x - 1, routeStart.y - 1, 3, 3);
    }
    if (routeResult && routeResult.path.length) {
      ctx.fillStyle = '#9ee5a8';
      for (const point of routeResult.path) ctx.fillRect(point.x, point.y, 1, 1);
    }
    if (selected) {
      const result = inspectParticlePassage(world, passage, selected.x, selected.y);
      if (result) {
        ctx.strokeStyle = result.obstruction || result.flooded ? '#ff8b6a' : '#9ee5a8';
        ctx.lineWidth = 1;
        ctx.strokeRect(result.x + 0.5, result.top + 0.5, 1, Math.max(1, result.bottom - result.top));
        const state = result.obstruction ? 'obstructed' : result.flooded ? 'flooded' : 'below flood threshold';
        showInspection(`Selected column ${result.x}, rows ${result.top}–${result.bottom}: ` +
          `${state}; estimated depth ${(result.depth * 100).toFixed(1)}% (15% threshold). ${inspectionHelp}`);
      }
    } else if (routeResult) {
      showInspection(`Route test: ${routeResult.state}; ${routeResult.path.length} cells. ${inspectionHelp}`);
    } else if (routeStart) {
      showInspection(`Route start: ${routeStart.x}, ${routeStart.y}. Select the destination. ${inspectionHelp}`);
    } else {
      showInspection(inspectionHelp);
    }
    status.textContent = `${mode} | Step ${steps} | Water: ${world.waterCount} | Terrain: ${world.terrainCount} | ${running ? 'Running' : 'Paused'}`;
    fps.record();
  }
  function showWorld(next, name, nextTunnels, heights) {
    world = next;
    initial = world.snapshot();
    passage = createImportedPassageMask(initial.cells, width, height, cellSize, heights);
    tunnels = nextTunnels;
    mode = name;
    steps = 0;
    selected = null;
    routeStart = null;
    routeResult = null;
    running = false;
    results.textContent = '';
    message.textContent = '';
    controls();
    draw();
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }
  function fromSource(source) {
    if (!source || source.width !== width || source.height !== height || source.cellSize !== cellSize ||
        !Array.isArray(source.heights) || source.heights.length !== width ||
        !Array.isArray(source.waterLevels) || source.waterLevels.length !== width) {
      throw new Error('Generated map dimensions or sampled data are invalid');
    }
    const column = (x) => Math.floor(x / cellSize);
    return createParticleWorldFromSurfaceWaterAndTunnels(
      { heightAt: (x) => source.heights[column(x)] },
      (x) => source.waterLevels[column(x)],
      source.tunnels,
      { width, height, cellSize, originX: 0, originY: 0, skipEmptyChunks: true },
    );
  }
  async function generateMap() {
    busy = true;
    running = false;
    controls();
    message.textContent = 'Generating an isolated game map...';
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Temporary map generator';
    frame.src = 'index.html?particleMapLab=1';
    try {
      const loaded = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Map generator timed out')), 15000);
        frame.onload = () => { clearTimeout(timeout); resolve(); };
        frame.onerror = () => { clearTimeout(timeout); reject(new Error('Could not load map generator')); };
      });
      document.body.append(frame);
      await loaded;
      if (typeof frame.contentWindow.readParticleMapSource !== 'function') {
        throw new Error('Map generator did not initialize');
      }
      const source = frame.contentWindow.readParticleMapSource();
      const next = fromSource(source);
      showWorld(next, 'Generated game map', source.tunnels, source.heights);
    } catch (error) {
      message.textContent = `Could not generate map: ${error.message}`;
    } finally {
      frame.remove();
      busy = false;
      controls();
    }
  }
  function makeDiagonal() {
    const nextTunnels = [{ interiorWidth: 14, points: [{ x: 2, y: 2 }, { x: 9598, y: 1558 }] }];
    const next = createParticleWorldFromSurfaceWaterAndTunnels({ heightAt: () => 0 }, () => null,
      nextTunnels, { width, height, cellSize, originX: 0, originY: 0, skipEmptyChunks: true });
    showWorld(next, 'Synthetic diagonal test', nextTunnels, new Float64Array(width));
  }
  function focusTunnel(index) {
    const point = tunnels[index].points[0];
    const scale = Number(zoom.value);
    viewport.scrollLeft = point.x / cellSize * scale - viewport.clientWidth / 2;
    viewport.scrollTop = point.y / cellSize * scale - viewport.clientHeight / 2;
  }
  async function compareScans(heavy = false) {
    running = false;
    busy = true;
    controls();
    results.textContent = '';
    message.textContent = 'Preparing three copies of the displayed snapshot...';
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const source = createParticleWorld(width, height);
      source.restore(world.snapshot());
      let added = 0, excavated = 0;
      if (heavy) {
        for (let y = 0; y < height && added < 40000; y += 1) {
          for (let x = 0; x < width && added < 40000; x += 1) {
            if (x % 12 < 6 && y % 16 < 8 && source.at(x, y) === PARTICLE_EMPTY) {
              source.set(x, y, PARTICLE_WATER);
              added += 1;
            }
          }
        }
        for (let y = 0; y < height && added < 40000; y += 1) {
          for (let x = 0; x < width && added < 40000; x += 1) {
            if (x % 12 < 6 && y % 16 < 8 && source.at(x, y) === PARTICLE_TERRAIN) {
              excavated += source.excavate(x, y, x, y);
              source.set(x, y, PARTICLE_WATER);
              added += 1;
            }
          }
        }
        if (added < 40000) throw new Error(`Only ${added} usable cells available for heavy workload`);
      }
      const snapshot = source.snapshot();
      const entries = [
        { name: 'Full scan', options: {} },
        { name: 'Empty-row skipping', options: { skipEmptyRows: true } },
        { name: 'Row and chunk skipping', options: { skipEmptyRows: true, skipEmptyChunks: true } },
      ].map((entry) => {
        const copy = createParticleWorld(width, height, entry.options);
        copy.restore(snapshot);
        return { name: entry.name, world: copy, times: [] };
      });
      const water = source.waterCount;
      for (let i = 0; i < 130; i += 1) {
        for (let j = 0; j < entries.length; j += 1) {
          const entry = entries[(i + j) % entries.length];
          const start = performance.now();
          entry.world.step();
          const elapsed = performance.now() - start;
          if (i >= 10) entry.times.push(elapsed);
        }
        if (i % 10 === 9) {
          message.textContent = `Comparing scan modes: ${Math.max(0, i - 9)} / 120 measured steps`;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      const expected = JSON.stringify(entries[0].world.snapshot());
      for (const entry of entries) {
        if (entry.world.waterCount !== water ||
            entry.world.countWater(0, 0, width - 1, height - 1) !== water ||
            JSON.stringify(entry.world.snapshot()) !== expected) {
          throw new Error(`${entry.name} diverged or did not conserve water`);
        }
      }
      results.textContent = `${heavy ? `Heavy workload: added ${added} water particles and excavated ${excavated} terrain cells in a copy. ` : ''}` +
        `120 measured steps after 10 warmup steps. Snapshot copies only; the displayed map did not advance.\n` +
        entries.map((entry) => {
          const sorted = entry.times.slice().sort((a, b) => a - b);
          const mean = entry.times.reduce((sum, time) => sum + time, 0) / entry.times.length;
          return `${entry.name}: mean ${mean.toFixed(2)} ms | p95 ${sorted[113].toFixed(2)} ms | max ${sorted[119].toFixed(2)} ms`;
        }).join('\n') + `\nIdentical final snapshots; ${water} water particles conserved in each.`;
      message.textContent = 'Comparison complete. Timing excludes rendering and game logic.';
    } catch (error) {
      message.textContent = `Comparison failed: ${error.message}`;
    } finally {
      busy = false;
      controls();
      draw();
    }
  }
  async function compareDiagonalImport() {
    running = false;
    busy = true;
    controls();
    results.textContent = '';
    message.textContent = 'Comparing diagonal import methods...';
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const options = { width, height, cellSize, originX: 0, originY: 0 };
      const surface = { heightAt: () => 0 };
      const a = { x: 2, y: 2 }, b = { x: 9598, y: 1558 }, radius = 7;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
      function direct() {
        const copy = createParticleWorldFromSurface(surface, options);
        for (let x = 0; x < width; x += 1) {
          for (let y = 0; y < height; y += 1) {
            const px = (x + 0.5) * cellSize, py = (y + 0.5) * cellSize;
            const distance = Math.max(0, Math.min(length, (px - a.x) * ux + (py - a.y) * uy));
            if (Math.hypot(px - (a.x + distance * ux), py - (a.y + distance * uy)) <= radius) {
              copy.excavate(x, y, x, y);
            }
          }
        }
        return copy;
      }
      function bounded() {
        return createParticleWorldFromSurfaceWaterAndTunnels(surface, () => null,
          [{ interiorWidth: radius * 2, points: [a, b] }], options);
      }
      direct(); bounded();
      const timings = [[], []];
      let first, second;
      for (let i = 0; i < 5; i += 1) {
        const functions = i % 2 ? [bounded, direct] : [direct, bounded];
        for (const fn of functions) {
          const start = performance.now();
          const result = fn();
          const elapsed = performance.now() - start;
          if (fn === direct) { first = result; timings[0].push(elapsed); }
          else { second = result; timings[1].push(elapsed); }
        }
        message.textContent = `Comparing diagonal imports: ${i + 1} / 5 runs`;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (JSON.stringify(first.snapshot()) !== JSON.stringify(second.snapshot())) {
        throw new Error('Diagonal imports produced different snapshots');
      }
      const summary = (values) => {
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        return `mean ${mean.toFixed(2)} ms | range ${Math.min(...values).toFixed(2)}–${Math.max(...values).toFixed(2)} ms`;
      };
      results.textContent = `Full-map synthetic diagonal; five runs after warmup, including world creation.\n` +
        `Direct rectangle scan: ${summary(timings[0])}\n` +
        `Bounded import: ${summary(timings[1])}\n` +
        `Identical snapshots; ${width * height - second.terrainCount} terrain cells excavated.`;
      message.textContent = 'Import comparison complete. The displayed map did not change.';
    } catch (error) {
      message.textContent = `Import comparison failed: ${error.message}`;
    } finally {
      busy = false;
      controls();
      draw();
    }
  }
  generate.addEventListener('click', generateMap);
  diagonal.addEventListener('click', () => {
    try { makeDiagonal(); } catch (error) { message.textContent = `Could not create diagonal test: ${error.message}`; }
  });
  reset.addEventListener('click', () => {
    world.restore(initial);
    running = false;
    steps = 0;
    selected = null;
    routeStart = null;
    routeResult = null;
    message.textContent = 'Snapshot restored.';
    results.textContent = '';
    controls();
    draw();
  });
  pause.addEventListener('click', () => {
    running = !running;
    if (running) { routeStart = null; routeResult = null; }
    controls(); draw();
  });
  tool.addEventListener('click', () => {
    toolMode = (toolMode + 1) % 3;
    selected = null;
    routeStart = null;
    routeResult = null;
    if (toolMode === 2) running = false;
    controls();
    message.textContent = ['Click the map to blast terrain.', 'Click an imported tunnel opening to inspect its local water depth.',
      'Paused. Click two imported tunnel cells to test a route.'][toolMode];
    draw();
  });
  step.addEventListener('click', () => { routeStart = null; routeResult = null; world.step(); steps += 1; draw(); });
  benchmark.addEventListener('click', () => compareScans());
  heavyBenchmark.addEventListener('click', () => compareScans(true));
  importBenchmark.addEventListener('click', compareDiagonalImport);
  tunnelButtons.forEach((button, index) => button.addEventListener('click', () => focusTunnel(index)));
  zoom.addEventListener('change', setZoom);
  canvas.addEventListener('click', (event) => {
    if (!world || busy) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(width - 1, Math.floor((event.clientX - rect.left) * width / rect.width)));
    const y = Math.max(0, Math.min(height - 1, Math.floor((event.clientY - rect.top) * height / rect.height)));
    if (toolMode === 1) {
      const result = inspectParticlePassage(world, passage, x, y);
      selected = result ? { x, y } : null;
      message.textContent = result ? 'Passage selected; its measurement updates as the water moves.' :
        'Select a cell inside an imported tunnel opening.';
      draw();
      return;
    }
    if (toolMode === 2) {
      if (running) {
        message.textContent = 'Pause the simulation before selecting a route.';
        return;
      }
      if (!inspectParticlePassage(world, passage, x, y)) {
        message.textContent = 'Select a cell inside an imported tunnel opening.';
        return;
      }
      if (!routeStart || routeResult) {
        routeStart = { x, y };
        routeResult = null;
      } else {
        routeResult = findParticlePassageRoute(world, passage, routeStart, { x, y });
      }
      draw();
      return;
    }
    routeStart = null;
    routeResult = null;
    const removed = world.blast(x, y, 7);
    message.textContent = `Blast at ${x}, ${y}: removed ${removed} terrain cells.`;
    draw();
  });
  setInterval(() => {
    if (!running || busy || !world) return;
    for (let i = 0; i < 3; i += 1) world.step();
    steps += 3;
    draw();
  }, 50);
  setZoom();
  controls();
  generateMap();
}());
