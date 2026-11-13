(function () {
  const canvas = document.getElementById('lab');
  const ctx = canvas.getContext('2d');
  const fps = createLabFps(document.getElementById('fps'));
  const status = document.getElementById('status');
  const buildStatus = document.getElementById('build-status');
  const saveStatus = document.getElementById('save-status');
  const saveKey = 'urban-defence-particle-lab-v1';
  const pause = document.getElementById('pause');
  const image = ctx.createImageData(canvas.width, canvas.height);
  let scenario = createParticleLabScenario();
  let paused = false;
  let lastStatus = 0;

  document.getElementById('breach').addEventListener('click', () => { scenario.breach(); draw(); updateStatus(); });
  document.getElementById('extend').addEventListener('click', () => { scenario.extend(); draw(); updateStatus(); });
  document.getElementById('damage-supports').addEventListener('click', () => {
    const removed = scenario.damageBarrierSupports();
    buildStatus.textContent = removed ? `Damaged ${removed} support cell(s). Unsupported pieces fall on the next step.` : 'Both support cells are already damaged.';
    draw(); updateStatus();
  });
  document.getElementById('reset').addEventListener('click', () => {
    scenario = createParticleLabScenario();
    buildStatus.textContent = '';
    draw(); updateStatus();
  });
  document.getElementById('save').addEventListener('click', () => {
    try {
      localStorage.setItem(saveKey, JSON.stringify(scenario.snapshot()));
      saveStatus.textContent = 'Lab saved in this browser. Saving again replaces this slot.';
    } catch (error) {
      saveStatus.textContent = `Could not save lab: ${error.message}`;
    }
  });
  document.getElementById('load').addEventListener('click', () => {
    try {
      const saved = localStorage.getItem(saveKey);
      if (saved === null) {
        saveStatus.textContent = 'No lab save found in this browser.';
        return;
      }
      const restored = createParticleLabScenario(JSON.parse(saved));
      scenario = restored;
      buildStatus.textContent = '';
      saveStatus.textContent = 'Lab save loaded.';
      draw(); updateStatus();
    } catch (error) {
      saveStatus.textContent = `Could not load lab; current world unchanged: ${error.message}`;
    }
  });
  document.getElementById('build').addEventListener('click', () => {
    const result = scenario.constructBarrier();
    const messages = {
      built: `Built or repaired ${result.placed} barrier particle(s) at column ${scenario.barrierColumn}.`,
      complete: 'Barrier is already complete.',
      water: 'Cannot build: water occupies the barrier site.',
      debris: 'Cannot build: debris occupies the barrier site.',
      terrain: 'Cannot build: terrain occupies the barrier site.',
      'missing-support': 'Cannot build: the tunnel roof or floor at the site is damaged.',
    };
    buildStatus.textContent = messages[result.reason];
    draw(); updateStatus();
  });
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
  });
  document.getElementById('step').addEventListener('click', () => {
    if (!paused) {
      status.textContent = 'Pause the simulation before stepping.';
      return;
    }
    scenario.world.step();
    draw();
    updateStatus();
  });
  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) * canvas.width / rect.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) * canvas.height / rect.height)));
    scenario.world.blast(x, y, 7);
    draw();
    updateStatus();
  });

  function draw() {
    renderParticleLab(scenario, image);
    ctx.putImageData(image, 0, 0);
    fps.record();
  }
  function updateStatus() {
    const { world, tunnel } = scenario;
    const capacity = (tunnel.right - tunnel.left + 1) * (tunnel.bottom - tunnel.top + 1);
    const inTunnel = scenario.tunnelWater();
    const depth = scenario.floodDepth();
    status.textContent = `Water particles: ${world.waterCount} | Terrain particles: ${world.terrainCount} | Barrier particles: ${world.barrierCount} | Debris particles: ${world.debrisCount} | Original tunnel water: ${inTunnel} / ${capacity} (${(100 * inTunnel / capacity).toFixed(1)}%) | Column ${scenario.monitoredColumn} depth: ${(100 * depth).toFixed(1)}% (${depth >= 0.15 ? 'blocked' : 'usable'})`;
  }
  const clock = createFixedStepClock(() => { if (!paused) scenario.world.step(); });
  function frame(timestamp) {
    clock.advance(timestamp);
    draw();
    if (timestamp - lastStatus >= 250) {
      updateStatus();
      lastStatus = timestamp;
    }
    requestAnimationFrame(frame);
  }
  draw();
  updateStatus();
  requestAnimationFrame(frame);
}());
