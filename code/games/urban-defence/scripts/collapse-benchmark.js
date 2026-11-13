(function () {
  const run = document.getElementById('run');
  const status = document.getElementById('status');
  const results = document.getElementById('results');
  const terrains = ['flat', 'uphill-right', 'downhill-right', 'valley'];
  const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));
  const steps = 180;
  const dt = 1 / 60;

  run.addEventListener('click', async () => {
    run.disabled = true;
    results.textContent = '';
    try {
      for (const count of [1, 4, 12]) {
        status.textContent = `Preparing ${count} buildings...`;
        await yieldToBrowser();
        const groups = [
          { label: 'Full support and collision search', optimizeSupportSearch: false, optimizeCollisionSearch: false },
          { label: 'Optimized support search', optimizeSupportSearch: true, optimizeCollisionSearch: false },
          { label: 'Optimized support and spatial collision search', optimizeSupportSearch: true, optimizeCollisionSearch: true },
        ].map(({ label, optimizeSupportSearch, optimizeCollisionSearch }) => ({
          label,
          models: Array.from({ length: count }, (_, i) => createCollapseModel({
            columns: 11, rows: 11, size: 26, left: 177, ground: 310, optimizeSupportSearch, optimizeCollisionSearch,
            shaftColumn: 1, openGround: true, terrain: terrains[i % terrains.length], loadEnabled: true,
          })),
          times: [],
        }));
        for (let step = 0; step < 10; step += 1) {
          for (const group of groups) for (const model of group.models) model.step(dt);
        }
        let peakFragments = 0;
        for (let step = 0; step < steps; step += 1) {
          for (let n = 0; n < groups.length; n += 1) {
            const group = groups[(step + n) % groups.length];
            const start = performance.now();
            if (step === 0) for (const model of group.models) model.blast(320, 300, 95, 220);
            if (step === 60) for (const model of group.models) model.blast(320, 190, 100, 175);
            for (const model of group.models) model.step(dt);
            group.times.push(performance.now() - start);
          }
          for (let i = 0; i < count; i += 1) {
            const expected = JSON.stringify(groups[0].models[i].saveState());
            for (const group of groups.slice(1)) {
              if (expected !== JSON.stringify(group.models[i].saveState())) {
                throw new Error(`${group.label} diverged for building ${i + 1} at step ${step + 1}`);
              }
            }
          }
          peakFragments = Math.max(peakFragments, groups[0].models.reduce((sum, model) => sum + model.fragments.length, 0));
          if (step % 5 === 4) {
            status.textContent = `Running ${count} buildings: ${step + 1} / ${steps} steps`;
            await yieldToBrowser();
          }
        }
        if (!peakFragments) throw new Error('Benchmark did not produce debris');
        results.textContent += `${count} building(s), ${groups[0].models.reduce((sum, model) => sum + model.sections.length, 0)} members, peak ${peakFragments} debris\n`;
        for (const group of groups) {
          const sorted = group.times.slice().sort((a, b) => a - b);
          const mean = group.times.reduce((sum, value) => sum + value, 0) / group.times.length;
          const p95 = sorted[Math.ceil(group.times.length * 0.95) - 1];
          results.textContent += `  ${group.label}: mean ${mean.toFixed(2)} ms | 95th percentile ${p95.toFixed(2)} ms | max ${sorted[sorted.length - 1].toFixed(2)} ms\n`;
        }
        results.textContent += '  Saved states matched after every step.\n\n';
      }
      status.textContent = 'Complete. At 60 updates per second the entire frame has about 16.67 ms; rendering and other game systems need time too.';
    } catch (error) {
      status.textContent = `Benchmark failed: ${error.message}`;
    } finally {
      run.disabled = false;
    }
  });
}());
