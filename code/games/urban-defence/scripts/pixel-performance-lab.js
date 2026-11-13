(function () {
  const shared = document.body.dataset.workload === 'shared';
  const createWorkload = shared ? () => createSharedPixelConstructionWorkload({
    supportCapacity: Number(document.getElementById('capacity').value),
    natural: document.getElementById('setup').value === 'natural',
    layout: document.getElementById('layout').value,
    ground: document.getElementById('ground').value,
  }) : createPixelConstructionWorkload;
  let workload = createWorkload(), paused = false;
  const renderers = Array.from(document.querySelectorAll('canvas'), (canvas, index) => {
    const { world } = workload.renderScenarios[index];
    return createPixelConstructionRenderer(canvas, world.width, world.height);
  });
  const status = document.getElementById('status'), accounting = document.getElementById('accounting');
  const pause = document.getElementById('pause'), fpsElement = document.getElementById('fps');
  const fps = createLabFps(fpsElement);
  function draw() {
    workload.verify();
    for (let index = 0; index < renderers.length; index += 1) {
      renderers[index].draw(workload.renderScenarios[index]);
    }
    if (shared) {
      const world = workload.entries[0].scenario.world, load = world.structuralLoad;
      const loads = world.inspectStructuralLoads();
      const heaviest = loads.reduce((best, cell) => !best || cell.load > best.load ? cell : best, null);
      document.getElementById('experiment-status').textContent =
        `Active experiment: ${workload.natural ? 'natural-start construction (manual changes allowed)' : 'prepared flooded/damaged workload'}; ${workload.layout === 'asymmetric' ? 'standard and mirrored uneven spans' : 'three standard frames'}; ${workload.ground === 'raised' ? 'raised delivery-side terrain' : 'flat foundation terrain'}; capacity ${load.capacity}. ` +
        (heaviest ? `Most loaded settled cell (${heaviest.x}, ${heaviest.y}): ${heaviest.load.toFixed(1)} units. ` :
          'Load inspection pending the next structural update, or no settled cells remain. ') +
        `${load.failed} overload failures. Weak capacity can cause repeated paid rebuilding; restoring terrain does not increase capacity.`;
      const selected = workload.entries[Number(document.getElementById('building').value)].scenario;
      const terrain = selected.inspectTerrain();
      document.getElementById('terrain-status').textContent =
        `Selected building terrain: ${terrain.foundationTerrain}/9 original seed positions have terrain directly beneath; ` +
        `current ground occupancy: ${terrain.foundationDescription}; ` +
        `${terrain.planTerrain.length} planned cells occupied by terrain; ${terrain.blockedDeliveries.length}/6 delivery points occupied. ` +
        'These counts do not guarantee a route or adequate weight capacity. Repairs keep the original plan.';
      const sites = selected.inspectSites(), counts = new Map();
      for (const site of sites) counts.set(site.state, (counts.get(site.state) || 0) + 1);
      document.getElementById('selected-sites').textContent = sites.length
        ? `Selected building, layer ${sites[0].distance}: ${Array.from(counts, ([state, count]) =>
          `${count} ${state}`).join(', ')}. Clear sites do not guarantee a route.`
        : selected.finished ? 'Selected building completed; automatic delivery has stopped.'
          : 'Selected building: revealing blueprint.';
      if (document.getElementById('show-loads').checked) {
        renderers[0].markLoads(workload.entries[0].scenario.world);
      }
      const waiting = workload.entries.flatMap(({ scenario }, index) =>
        scenario.inspectDeliveries().filter((delivery) => delivery.state.startsWith('waiting'))
          .map((delivery) => ({ ...delivery, building: index + 1 })));
      document.getElementById('waiting-status').textContent = waiting.length
        ? `Waiting pixels (zero-based x, y): ${waiting.map((delivery) =>
          `Building ${delivery.building} (${delivery.x}, ${delivery.y}) ${delivery.state}${delivery.blockerDescription ? ` [${delivery.blockerDescription}]` : ''}${delivery.touchingOutline ? '' : ' [no terrain/building outline contact]'}`).join('; ')}.`
        : 'No waiting paid pixels.';
      if (document.getElementById('show-waiting').checked) renderers[0].markWaiting(waiting);
    }
    accounting.textContent = `Accounting verified for ${shared ? 'one shared world' : 'all three worlds'}: material + destroyed${shared ? ` + cleared (${workload.cleared})` : ''} = free seeds + paid material; water conserved; HM charges match.`;
    status.textContent = workload.entries.map(({ scenario, destroyed }, index) => {
      const { world } = scenario;
      const settled = shared ? scenario.plan.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER).length : world.barrierCount;
      const moving = shared ? scenario.inspectDeliveries().length : world.constructionCount;
      const load = world.structuralLoad;
      return `Building ${index + 1} (${scenario.layout}) | Tick ${scenario.ticks} | Settled ${settled} | Moving ${moving} | ${shared ? 'Shared debris' : 'Debris'} ${world.debrisCount} | Destroyed ${destroyed} | ${shared ? 'Shared water' : 'Water'} ${world.waterCount} | HM ${scenario.hm} | Peak load ${load.maximum.toFixed(1)}/${load.capacity} | Overload failures ${load.failed}${shared ? ' (shared)' : ''}`;
    }).join('\n');
    if (shared) {
      document.getElementById('throughput-status').textContent = workload.entries.map(({ scenario }, index) => {
        const stats = scenario.deliveryStats;
        return `Building ${index + 1}: ${stats.paidPixels} paid pixels emitted; ` +
          `${stats.pixelsPerMinute.toFixed(1)} pixels/simulated minute over ${(stats.elapsedTicks / 60).toFixed(1)} seconds after reveal; ` +
          `${stats.productiveChecks}/${stats.deliveryChecks} productive delivery checks; ` +
          `last delivery ${stats.lastDeliveryTick === null ? 'none' : `tick ${stats.lastDeliveryTick}`}` +
          (stats.completedTick === null ? '' : `; frame completed at tick ${stats.completedTick} (timing frozen)`);
      }).join('\n');
    }
  }
  function resize() {
    for (const renderer of renderers) renderer.resize();
    draw();
  }
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
    fps.reset(performance.now());
    fpsElement.textContent = 'Render FPS: measuring...';
  });
  document.getElementById('reset').addEventListener('click', () => {
    workload = createWorkload();
    clock = createFixedStepClock(() => { if (!paused) workload.step(); });
    draw();
    fps.reset(performance.now());
    fpsElement.textContent = 'Render FPS: measuring...';
    if (shared) {
      document.getElementById('action-status').textContent = 'Shared workload restarted.';
      document.getElementById('recovery-status').textContent = 'No route audit for this restarted world.';
    }
  });
  if (shared) {
    document.getElementById('audit-recovery').addEventListener('click', () => {
      workload.verify();
      const index = Number(document.getElementById('building').value);
      const report = workload.entries[index].scenario.inspectRecovery();
      const materials = { [PARTICLE_TERRAIN]: 'terrain', [PARTICLE_WATER]: 'water',
        [PARTICLE_BARRIER]: 'settled building', [PARTICLE_DEBRIS]: 'fallen debris',
        [PARTICLE_CONSTRUCTION]: 'moving material' };
      document.getElementById('recovery-status').textContent =
        `Route audit snapshot: Building ${index + 1}, tick ${report.tick}, ${report.phase}. ` +
        (report.agents.length ? report.agents.map((agent) =>
          `(${agent.x}, ${agent.y}): ${agent.state}${agent.touchingOutline ? '' : ' [no current outline contact]'}` +
          (agent.route ? ` to (${agent.route.target.x}, ${agent.route.target.y}), ${agent.route.steps} cardinal steps` : '')).join('; ')
          : 'No retained delivery agents.') +
        ` Delivery points (${report.agentSlots} agent slots free; HM ${report.hm}): ` +
        report.sources.map((source) => `(${source.x}, ${source.y}): ${source.state}` +
          (source.material !== PARTICLE_EMPTY ? ` by ${materials[source.material]}` : '') +
          (source.route ? `; route to (${source.route.target.x}, ${source.route.target.y}), ${source.route.steps} steps` : '')).join('; ') +
        '. Sources are checked every 60 simulated ticks, sequentially; ready sources may compete for the same site or slot. Snapshot only; rerun after world changes. No material moved or HM spent.';
      workload.verify();
    });
    document.getElementById('building').addEventListener('change', draw);
    for (const id of ['capacity', 'setup', 'layout', 'ground']) {
      document.getElementById(id).addEventListener('change', () => {
        document.getElementById('action-status').textContent = 'Experiment settings changed; restart to apply. The running world is unchanged.';
      });
    }
    document.getElementById('step-second').addEventListener('click', () => {
      if (!paused) {
        document.getElementById('action-status').textContent = 'Pause before stepping the shared world.';
        return;
      }
      for (let tick = 0; tick < 60; tick += 1) workload.step();
      draw();
      document.getElementById('action-status').textContent = 'Advanced 60 shared ticks (one simulated second). Manual updates are not counted as render frames.';
    });
    document.getElementById('restore-foundation').addEventListener('click', () => {
      const index = Number(document.getElementById('building').value);
      const result = workload.restoreFoundation(index);
      const materials = { [PARTICLE_WATER]: 'water', [PARTICLE_BARRIER]: 'settled building',
        [PARTICLE_DEBRIS]: 'fallen debris', [PARTICLE_CONSTRUCTION]: 'moving material' };
      const blocked = result.blockedCells.length ? ` Blocked cells (zero-based): ${result.blockedCells.map((cell) =>
        `(${cell.x}, ${cell.y}) ${materials[cell.material]}`).join('; ')}. Restoration is incomplete; rerun after blockers move or are removed.` : '';
      document.getElementById('action-status').textContent = result.restored || result.blocked
        ? `Building ${index + 1}: restored ${result.restored} terrain cells; ${result.blocked} occupied cells left unchanged.${blocked} Lab-only terrain restoration costs no HM; building repairs still require paid material.`
        : `Building ${index + 1}: foundation terrain is already restored.`;
      draw();
    });
    document.getElementById('excavate-ground').addEventListener('click', () => {
      const index = Number(document.getElementById('building').value);
      const removed = workload.excavateFoundationGround(index);
      document.getElementById('action-status').textContent =
        `Building ${index + 1}: removed ${removed} terrain cells directly below its left support. ` +
        'Other materials were left unchanged; no HM refunded. Weight and connectivity respond on the next particle tick. This free lab tool does not destroy building pixels directly.';
      draw();
    });
    document.getElementById('breach-basin').addEventListener('click', () => {
      const removed = workload.breachBasin();
      document.getElementById('action-status').textContent = removed
        ? `Breached basin: removed ${removed} terrain cells from the outlet. Water moves on subsequent physics ticks; no HM spent or building material removed.`
        : 'Basin outlet is already open; no cells removed. Water and HM remain unchanged.';
      draw();
    });
    document.getElementById('show-waiting').addEventListener('change', draw);
    document.getElementById('show-loads').addEventListener('change', draw);
    document.getElementById('clear-debris').addEventListener('click', () => {
      const removed = workload.clearDebris();
      document.getElementById('action-status').textContent = removed
        ? `Cleared ${removed} shared debris cells; no HM refunded. Foundation terrain is not restored.`
        : 'No shared debris to clear. Settled and moving material were left unchanged.';
      draw();
    });
    document.getElementById('blast-building').addEventListener('click', () => {
      const index = Number(document.getElementById('building').value);
      const result = workload.blastBuilding(index);
      document.getElementById('action-status').textContent = result.removed
        ? `Building ${index + 1}: blast removed ${result.removed} cells, including ${result.destroyed} building-material cells. No HM refunded.`
        : `Building ${index + 1}: no cells removed; the blast area is already clear.`;
      draw();
    });
  }
  let clock = createFixedStepClock(() => { if (!paused) workload.step(); });
  function frame(time) {
    try {
      clock.advance(time);
      draw();
    } catch (error) {
      accounting.textContent = `Workload stopped: ${error.message}`;
      pause.disabled = true;
      document.getElementById('reset').disabled = true;
      if (shared) {
        document.getElementById('blast-building').disabled = true;
        document.getElementById('clear-debris').disabled = true;
        document.getElementById('restore-foundation').disabled = true;
        document.getElementById('excavate-ground').disabled = true;
        document.getElementById('breach-basin').disabled = true;
        document.getElementById('show-waiting').disabled = true;
        document.getElementById('show-loads').disabled = true;
        document.getElementById('step-second').disabled = true;
        document.getElementById('audit-recovery').disabled = true;
      }
      fpsElement.textContent = 'Render FPS: workload stopped';
      throw error;
    }
    fps.record();
    requestAnimationFrame(frame);
  }
  for (const canvas of document.querySelectorAll('canvas')) {
    new ResizeObserver(resize).observe(canvas.parentElement);
  }
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
}());
