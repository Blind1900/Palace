(function () {
  const canvas = document.getElementById('lab'), ctx = canvas.getContext('2d');
  const status = document.getElementById('status'), message = document.getElementById('message');
  const pause = document.getElementById('pause'), height = document.getElementById('height');
  const showSites = document.getElementById('show-sites'), siteStatus = document.getElementById('site-status');
  const deliveryStatus = document.getElementById('delivery-status');
  const showWaiting = document.getElementById('show-waiting'), waitingStatus = document.getElementById('waiting-status');
  const fps = createLabFps(document.getElementById('fps'));
  const renderer = createPixelConstructionRenderer(canvas);
  let scenario = createPixelConstructionScenario(), paused = false;
  function resizeCanvas() {
    renderer.resize();
    draw();
  }
  function draw() {
    const { world } = scenario;
    const scale = canvas.width / world.width;
    renderer.draw(scenario);
    const load = world.structuralLoad;
    const terrain = scenario.inspectTerrain();
    document.getElementById('terrain-status').textContent =
      `Terrain: ${terrain.foundationTerrain}/9 original seed positions have terrain directly beneath; ` +
      `current ground occupancy: ${terrain.foundationDescription}; ` +
      `${terrain.planTerrain.length} planned cells occupied by terrain; ${terrain.blockedDeliveries.length}/6 delivery points occupied. ` +
      'These counts do not guarantee a route or adequate weight capacity. Repairs keep the original plan.';
    document.getElementById('load-status').textContent = load.enabled
      ? `Weight model: peak carried load ${load.maximum.toFixed(1)} / ${load.capacity} cell-weight units; ${load.failed} overloaded cells became debris.`
      : 'Weight model disabled in this world.';
    const sites = scenario.inspectSites();
    const counts = new Map();
    for (const site of sites) counts.set(site.state, (counts.get(site.state) || 0) + 1);
    siteStatus.textContent = sites.length
      ? `Current layer ${sites[0].distance}: ${Array.from(counts, ([state, count]) => `${count} ${state}`).join(', ')}. Available means the site is clear and supported, not that a delivery route exists.`
      : scenario.finished ? 'No active construction layer; automatic delivery stopped.'
        : 'Site inspection begins after the blueprint reveal.';
    const deliveries = scenario.inspectDeliveries(), deliveryCounts = new Map();
    for (const delivery of deliveries) {
      deliveryCounts.set(delivery.state, (deliveryCounts.get(delivery.state) || 0) + 1);
    }
    deliveryStatus.textContent = deliveries.length
      ? `Paid material: ${Array.from(deliveryCounts, ([state, count]) => `${count} ${state}`).join(', ')}.`
      : 'No active paid material.';
    const waiting = deliveries.filter((delivery) => delivery.state.startsWith('waiting'));
    waitingStatus.textContent = waiting.length
      ? `Waiting pixels (zero-based grid x, y): ${waiting.map((delivery) =>
        `(${delivery.x}, ${delivery.y}) ${delivery.state}${delivery.blockerDescription ? ` [${delivery.blockerDescription}]` : ''}${delivery.touchingOutline ? '' : ' [no terrain/building outline contact]'}`).join('; ')}.`
      : 'No waiting paid pixels.';
    if (showSites.checked) {
      ctx.lineWidth = 1;
      for (const site of sites) {
        ctx.strokeStyle = site.state === 'available' ? '#9edcf0' :
          site.state === 'incoming' || site.state === 'moving material' ? '#eff9b1' : '#ed795e';
        ctx.strokeRect(site.x * scale + 0.5, site.y * scale + 0.5, renderer.pixelSize - 1, renderer.pixelSize - 1);
      }
    }
    if (showWaiting.checked) {
      renderer.markWaiting(waiting);
    }
    status.textContent = `Frame: ${scenario.rows} rows | Settled: ${world.barrierCount} / ${scenario.plan.length} | Moving material: ${world.constructionCount} | Fallen: ${world.debrisCount} | Water: ${world.waterCount} | HM: ${scenario.hm} | ${scenario.message}`;
  }
  showSites.addEventListener('change', draw);
  showWaiting.addEventListener('change', draw);
  pause.addEventListener('click', () => {
    paused = !paused; pause.textContent = paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
  });
  document.getElementById('step').addEventListener('click', () => {
    if (!paused) { message.textContent = 'Pause before stepping.'; return; }
    scenario.step(); draw();
  });
  document.getElementById('reset').addEventListener('click', () => {
    scenario = createPixelConstructionScenario(Number(height.value));
    message.textContent = 'Pixel construction restarted.'; draw();
  });
  document.getElementById('breach').addEventListener('click', () => {
    const removed = scenario.breachBasin();
    message.textContent = removed ? `Basin breached: removed ${removed} cells.` : 'Basin is already breached.'; draw();
  });
  document.getElementById('blast').addEventListener('click', () => {
    message.textContent = `Blast removed ${scenario.blastFoundation()} material cells; disconnected pixels fall on the next step.`; draw();
  });
  document.getElementById('clear').addEventListener('click', () => {
    message.textContent = `Cleared ${scenario.clearDebris()} fallen pixels; no HM refunded.`; draw();
  });
  const clock = createFixedStepClock(() => { if (!paused) scenario.step(); });
  function frame(time) { clock.advance(time); draw(); fps.record(); requestAnimationFrame(frame); }
  new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas(); requestAnimationFrame(frame);
}());
