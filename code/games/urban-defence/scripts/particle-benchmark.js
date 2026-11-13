(function () {
  const run = document.getElementById('run');
  const status = document.getElementById('status');
  const results = document.getElementById('results');
  const sizes = [[200, 120], [600, 240], [2400, 390]];
  const warmupSteps = 10;
  const measuredSteps = 60;
  const stressSteps = 120;
  const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

  function makeWorld(width, height) {
    const world = createParticleWorld(width, height);
    const ground = Math.floor(height / 2);
    for (let y = ground; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) world.set(x, y, PARTICLE_TERRAIN);
    }
    const left = Math.floor(width / 4);
    const right = Math.floor(width * 3 / 4);
    for (let y = ground - 12; y < ground; y += 1) {
      for (let x = left; x < right; x += 1) world.set(x, y, PARTICLE_WATER);
    }
    return world;
  }

  function makeStressWorld(width, height) {
    const world = makeWorld(width, height);
    const ground = Math.floor(height / 2);
    const left = Math.floor(width / 4);
    const right = Math.floor(width * 3 / 4) - 1;
    const top = ground + 20;
    const bottom = top + 7;
    world.excavate(left, top, right, bottom);
    const barriers = [];
    for (let i = 0; i < 12; i += 1) {
      const x = left + 12 + Math.floor(i * (right - left - 24) / 11);
      const result = world.constructBarrier(x, top, bottom);
      if (!result.ok || result.placed !== 8) throw new Error('Failed to prepare stress-test barriers');
      barriers.push(x);
    }
    return { world, ground, left, right, top, bottom, barriers };
  }

  function describeTimes(times) {
    const sorted = times.slice().sort((a, b) => a - b);
    const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    return `Mean: ${mean.toFixed(2)} ms | 95th percentile: ${p95.toFixed(2)} ms | Max: ${sorted[sorted.length - 1].toFixed(2)} ms`;
  }

  async function measureStress(width, height) {
    status.textContent = `Preparing ${width} x ${height} damage workload...`;
    await yieldToBrowser();
    const { world, ground, left, right, top, bottom, barriers } = makeStressWorld(width, height);
    const water = world.waterCount;
    for (let i = 0; i < warmupSteps; i += 1) world.step();
    const times = [];
    const events = [];
    for (let i = 0; i < stressSteps; i += 1) {
      const start = performance.now();
      let label = '';
      if (i === 0) {
        if (!world.excavate(left + 3, ground, left + 7, top - 1)) throw new Error('Shaft breach failed');
        label = 'Shaft breach';
      }
      if (i === 20) {
        let removed = 0;
        for (const x of barriers) {
          removed += world.excavate(x, top - 1, x, top - 1);
          removed += world.excavate(x, bottom + 1, x, bottom + 1);
        }
        if (removed !== barriers.length * 2) throw new Error('Barrier support damage failed');
        label = 'Support damage and release';
      }
      if (i === 40) {
        if (!world.blast(right + 10, ground, 7)) throw new Error('Surface blast failed');
        label = 'Surface blast';
      }
      world.step();
      const elapsed = performance.now() - start;
      times.push(elapsed);
      if (label) events.push(`${label}: ${elapsed.toFixed(2)} ms`);
      if (i % 5 === 4) {
        status.textContent = `Running ${width} x ${height} damage workload: ${i + 1} / ${stressSteps} steps`;
        await yieldToBrowser();
      }
    }
    const actualWater = world.countWater(0, 0, width - 1, height - 1);
    const tunnelWater = world.countWater(left, top, right, bottom);
    if (world.waterCount !== water || actualWater !== water) throw new Error('Stress test lost or duplicated water');
    if (!tunnelWater) throw new Error('Stress-test tunnel did not flood');
    if (world.barrierCount !== 0 || world.debrisCount !== barriers.length * 8) {
      throw new Error('Stress-test barriers did not become debris');
    }
    return `Damage and flooding (${stressSteps} steps; timed events included)\n` +
      `  ${describeTimes(times)}\n  ${events.join(' | ')}\n` +
      `  Water conserved: ${actualWater} / ${water}; tunnel water: ${tunnelWater}; debris: ${world.debrisCount}\n\n`;
  }

  async function measureMultiSite() {
    const width = 2400, height = 390;
    status.textContent = 'Preparing four-site comparison...';
    await yieldToBrowser();
    const full = makeWorld(width, height);
    const ground = Math.floor(height / 2);
    const top = ground + 20, bottom = top + 7;
    const sites = [640, 920, 1200, 1480];
    for (const left of sites) {
      full.excavate(left, top, left + 69, bottom);
      for (let i = 0; i < 24; i += 1) {
        const result = full.constructBarrier(left + 2 + i * 2, top, bottom);
        if (!result.ok || result.placed !== 8) throw new Error('Failed to prepare multi-site barriers');
      }
    }
    const optimized = createParticleWorld(width, height, { skipEmptyRows: true });
    optimized.restore(full.snapshot());
    const chunked = createParticleWorld(width, height, { skipEmptyRows: true, skipEmptyChunks: true });
    chunked.restore(full.snapshot());
    const water = full.waterCount;
    const worlds = [
      { world: full, name: 'Full scan', times: [] },
      { world: optimized, name: 'Empty-row skip', times: [] },
      { world: chunked, name: 'Empty-row and chunk skip', times: [] },
    ];
    function update(world, i) {
      if (i === 0) {
        for (const left of sites) {
          if (!world.excavate(left + 54, ground, left + 58, top - 1)) throw new Error('Multi-site breach failed');
        }
      }
      if (i === 20) {
        let removed = 0;
        for (const left of sites) {
          for (let n = 0; n < 24; n += 1) {
            const x = left + 2 + n * 2;
            removed += world.excavate(x, top - 1, x, top - 1);
            removed += world.excavate(x, bottom + 1, x, bottom + 1);
          }
        }
        if (removed !== 192) throw new Error('Multi-site support damage failed');
      }
      if (i === 40) {
        for (const x of [300, 540, 1850, 2100]) {
          if (!world.blast(x, ground, 7)) throw new Error('Multi-site surface blast failed');
        }
      }
      world.step();
    }
    for (let i = -warmupSteps; i < stressSteps; i += 1) {
      for (let n = 0; n < worlds.length; n += 1) {
        const entry = worlds[(n + i + warmupSteps) % worlds.length];
        const start = performance.now();
        update(entry.world, i);
        const elapsed = performance.now() - start;
        if (i >= 0) entry.times.push(elapsed);
      }
      if (i >= 0 && (i % 20 === 0 || i === stressSteps - 1)) {
        const expected = JSON.stringify(full.snapshot());
        for (const entry of worlds.slice(1)) {
          if (JSON.stringify(entry.world.snapshot()) !== expected) {
            throw new Error(`${entry.name} diverged at multi-site step ${i + 1}`);
          }
        }
      }
      if (i % 5 === 4) {
        status.textContent = `Running four-site comparison: ${i + 1} / ${stressSteps} steps`;
        await yieldToBrowser();
      }
    }
    if (full.waterCount !== water || full.countWater(0, 0, width - 1, height - 1) !== water ||
        full.barrierCount !== 0 || full.debrisCount !== 768) {
      throw new Error(`Multi-site counts incorrect: water ${full.waterCount}/${water}, barriers ${full.barrierCount}, debris ${full.debrisCount}/768`);
    }
    const floodedSites = sites.filter((left) => full.countWater(left, top, left + 69, bottom) > 0).length;
    if (floodedSites !== sites.length) throw new Error('Not every multi-site tunnel flooded');
    return `Four simultaneous sites, 96 barriers (${stressSteps} steps; timed events included)\n` +
      worlds.map((entry) => `  ${entry.name}: ${describeTimes(entry.times)}\n`).join('') +
      `  All three snapshots identical at seven checkpoints; ${floodedSites} / 4 sites flooded; ` +
      `${full.debrisCount} debris; ${water} water conserved\n\n`;
  }

  async function measureDensity(dense) {
    const width = 2400, height = 390, ground = 195;
    const label = dense ? 'Dense' : 'Sparse';
    status.textContent = `Preparing ${label.toLowerCase()} water comparison...`;
    await yieldToBrowser();
    const full = createParticleWorld(width, height);
    for (let y = ground; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) full.set(x, y, PARTICLE_TERRAIN);
    }
    if (dense) {
      for (let y = ground - 40; y < ground; y += 1) {
        for (let x = 600; x < 1800; x += 1) full.set(x, y, PARTICLE_WATER);
      }
    } else {
      for (const left of [300, 900, 1500, 2100]) {
        for (let y = ground - 50; y < ground - 42; y += 1) {
          for (let x = left; x < left + 8; x += 1) full.set(x, y, PARTICLE_WATER);
        }
      }
    }
    const worlds = [
      { name: 'Full scan', world: full, times: [] },
      { name: 'Empty-row skip', world: createParticleWorld(width, height, { skipEmptyRows: true }), times: [] },
      { name: 'Empty-row and chunk skip', world: createParticleWorld(width, height, { skipEmptyRows: true, skipEmptyChunks: true }), times: [] },
    ];
    const initial = full.snapshot();
    for (const entry of worlds.slice(1)) entry.world.restore(initial);
    const water = full.waterCount;
    const steps = 80;
    for (let i = -warmupSteps; i < steps; i += 1) {
      for (let n = 0; n < worlds.length; n += 1) {
        const entry = worlds[(n + i + warmupSteps) % worlds.length];
        const start = performance.now();
        entry.world.step();
        if (i >= 0) entry.times.push(performance.now() - start);
      }
      if (i >= 0 && (i % 20 === 0 || i === steps - 1)) {
        const expected = JSON.stringify(full.snapshot());
        for (const entry of worlds.slice(1)) {
          if (JSON.stringify(entry.world.snapshot()) !== expected) throw new Error(`${label}: ${entry.name} diverged at ${i + 1}`);
        }
      }
      if (i % 5 === 4) {
        status.textContent = `Running ${label.toLowerCase()} water comparison: ${i + 1} / ${steps} steps`;
        await yieldToBrowser();
      }
    }
    if (full.waterCount !== water || full.countWater(0, 0, width - 1, height - 1) !== water) {
      throw new Error(`${label} workload did not conserve water`);
    }
    return `${label} water (${water} particles, ${steps} steps)\n` +
      worlds.map((entry) => `  ${entry.name}: ${describeTimes(entry.times)}\n`).join('') +
      '  Water conserved; snapshots matched at five checkpoints.\n\n';
  }

  run.addEventListener('click', async () => {
    run.disabled = true;
    results.textContent = '';
    try {
      for (const [width, height] of sizes) {
        status.textContent = `Preparing ${width} x ${height} grid...`;
        await yieldToBrowser();
        const world = makeWorld(width, height);
        const water = world.waterCount;
        const terrain = world.terrainCount;
        const times = [];
        for (let i = 0; i < warmupSteps + measuredSteps; i += 1) {
          const start = performance.now();
          world.step();
          const elapsed = performance.now() - start;
          if (i >= warmupSteps) times.push(elapsed);
          if (i % 5 === 4) {
            status.textContent = `Running ${width} x ${height}: ${Math.max(0, i + 1 - warmupSteps)} / ${measuredSteps} measured steps`;
            await yieldToBrowser();
          }
        }
        const actualWater = world.countWater(0, 0, width - 1, height - 1);
        if (world.waterCount !== water || actualWater !== water || world.terrainCount !== terrain) {
          throw new Error(`Particle counts changed in the ${width} x ${height} test`);
        }
        results.textContent += `${width} x ${height} (${width * height} cells, ${water} water particles)\n` +
          `Baseline (${measuredSteps} steps)\n  ${describeTimes(times)}\n` +
          `  Water conserved: ${actualWater} / ${water}; terrain count unchanged\n\n`;
        results.textContent += await measureStress(width, height);
      }
      results.textContent += await measureMultiSite();
      results.textContent += await measureDensity(false);
      results.textContent += await measureDensity(true);
      status.textContent = 'Complete. At 60 updates per second the entire frame has about 16.67 ms; rendering and gameplay need time too.';
    } catch (error) {
      status.textContent = `Benchmark failed: ${error.message}`;
    } finally {
      run.disabled = false;
    }
  });
}());
