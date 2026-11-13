(function () {
  const canvas = document.getElementById('lab');
  const renderer = createPixelConstructionRenderer(canvas);
  const fps = createLabFps(document.getElementById('fps'));
  const message = document.getElementById('message');
  const generate = document.getElementById('generate'), pause = document.getElementById('pause');
  const deliveryMode = document.getElementById('delivery-mode');
  const buriedCore = document.getElementById('buried-core');
  const connectingFloors = document.getElementById('connecting-floors');
  const buttons = ['step', 'blast', 'clear', 'restore', 'audit', 'blast-core', 'excavate-floor'].map((id) => document.getElementById(id));
  const inspectButton = document.getElementById('inspect-cell');
  let imported = null, original = null, running = false, busy = false, failed = false;
  let destroyed = 0, cleared = 0;
  let selectedCell = null;
  function controls() {
    generate.disabled = busy;
    deliveryMode.disabled = busy;
    buriedCore.disabled = busy;
    connectingFloors.disabled = busy || !buriedCore.checked;
    pause.disabled = busy || !imported || failed;
    pause.textContent = running ? 'Pause' : 'Run simulation';
    pause.setAttribute('aria-pressed', String(running));
    for (const button of buttons) button.disabled = busy || !imported || failed;
    buttons[0].disabled = buttons[0].disabled || running;
    buttons[5].disabled = buttons[5].disabled || !imported || !imported.scenario.inspectCore().enabled;
    buttons[6].disabled = buttons[6].disabled || !imported || !imported.floorSections.length;
    inspectButton.disabled = busy || !imported || failed;
  }
  function verify() {
    const { scenario, initialWater } = imported, { world } = scenario;
    if (world.waterCount !== initialWater || scenario.hm !== 1000 - scenario.spent ||
        world.barrierCount + world.constructionCount + world.debrisCount +
        scenario.transportedMaterialCount + destroyed + cleared !== scenario.freeMaterial + scenario.spent) {
      throw new Error('Imported construction water, material or HM accounting failed');
    }
    document.getElementById('accounting').textContent =
      `Accounting verified: ${initialWater} water conserved; world material + travelling layer (${scenario.transportedMaterialCount}) + destroyed (${destroyed}) + cleared (${cleared}) = ${scenario.freeMaterial} free foundation pixels + ${scenario.spent} paid pixels.`;
  }
  function draw() {
    if (!imported) return;
    const { scenario } = imported, { world } = scenario, terrain = scenario.inspectTerrain();
    const diagnostics = inspectPixelMapDiagnostics(imported);
    renderer.draw(scenario); renderer.markLoads(world); renderer.markCore(scenario); renderer.markTransported(scenario);
    renderer.markWaiting(diagnostics.deliveries); renderer.markDiagnostics(diagnostics);
    renderer.markSelected(selectedCell);
    const core = scenario.inspectCore();
    document.getElementById('core-status').textContent = core.enabled
      ? `Buried core: ${core.surviving}/${core.total} settled pixels at original base positions. ` +
        (core.destroyed ? 'All cores lost: construction and repair permanently disabled, even after terrain restoration.'
          : 'Any surviving core pixel keeps repair enabled; routes and capacity still apply. Gold squares mark the buried bases.')
      : 'Original surface foundations; buried-core rule disabled.';
    const deliveries = scenario.deliveries;
    const sharedPositions = deliveries.length - new Set(deliveries.map((agent) =>
      agent.y * world.width + agent.x)).size;
    document.getElementById('status').textContent =
      `Mode ${scenario.deliveryMode} | Tick ${scenario.ticks} | Settled ${world.barrierCount}/${scenario.plan.length} | ` +
      `${scenario.coreDestroyed ? 'Stopped deliveries' : 'Moving'} ${world.constructionCount + scenario.transportedMaterialCount} | ` +
      (scenario.deliveryMode === 'inside' ? `Overlapping extra deliveries ${sharedPositions} | ` : '') +
      `HM ${scenario.hm} | Ground: ${terrain.foundationDescription} | ` +
      `Peak load ${world.structuralLoad.maximum.toFixed(1)}/128 | Overload failures ${world.structuralLoad.failed} | ${scenario.message}`;
    document.getElementById('delivery-status').textContent =
      `Delivery diagnostics: ${diagnostics.stranded} stranded at occupied/lost current surfaces; ` +
      `${diagnostics.waiting} waiting (including unassigned); ${diagnostics.stopped} stopped by total core loss. ` +
      `${diagnostics.yielding} of the waiting deliveries are yielding to traffic, not physical obstacles. ` +
      `${diagnostics.sources.filter((source) => source.ready).length} usable source slots, not a guarantee of a route or emission.`;
    document.getElementById('floor-status').textContent = diagnostics.floors.length
      ? diagnostics.floors.map((floor, index) =>
        `Floor ${index + 1}, row ${floor.y}: ${floor.settled}/${floor.total} settled; ` +
        `${floor.contacts}/${floor.total} terrain contacts directly beneath; ` +
        (floor.peak ? `peak ${floor.peak.load.toFixed(2)}/${floor.peak.capacity} at (${floor.peak.x}, ${floor.peak.y})`
          : 'load unavailable until physics recalculates')).join('. ')
      : 'No connecting floor sections in this crop.';
    const sites = diagnostics.sites;
    const counts = new Map();
    for (const site of sites) counts.set(site.state, (counts.get(site.state) || 0) + 1);
    document.getElementById('sites').textContent = sites.length
      ? `Current layer ${sites[0].distance}: ${Array.from(counts, ([state, count]) => `${count} ${state}`).join(', ')}. Clear sites do not guarantee delivery routes.`
      : scenario.coreDestroyed ? 'No repair sites: all buried cores permanently lost.'
        : scenario.finished ? 'Frame complete; retained paid material remains accounted for.'
        : 'Site inspection starts after the blueprint reveal.';
  }
  function fail(error) {
    running = false; failed = true; controls();
    message.textContent = `Experiment stopped: ${error.message}`;
    console.error(error);
  }
  function step() { imported.scenario.step(); verify(); }
  let clock = createFixedStepClock(() => { if (running && !busy && !failed) step(); });
  async function generateMap() {
    busy = true; running = false; failed = false; imported = null; original = null;
    destroyed = 0; cleared = 0; selectedCell = null; controls();
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('source-status').textContent = '';
    document.getElementById('status').textContent = '';
    document.getElementById('accounting').textContent = '';
    document.getElementById('sites').textContent = '';
    document.getElementById('core-status').textContent = '';
    document.getElementById('delivery-status').textContent = '';
    document.getElementById('floor-status').textContent = '';
    document.getElementById('routes').textContent = 'No route audit for this generated crop.';
    document.getElementById('cell-status').textContent = 'No cell inspected in this crop.';
    message.textContent = 'Generating a separate game map and searching existing terrain for a supported site...';
    const frame = document.createElement('iframe');
    frame.hidden = true; frame.title = 'Isolated construction terrain generator';
    frame.src = 'index.html?particleMapLab=1';
    let timeout;
    try {
      const loaded = new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Map generator timed out')), 15000);
        frame.onload = resolve;
        frame.onerror = () => reject(new Error('Could not load map generator'));
      });
      document.body.append(frame); await loaded;
      if (typeof frame.contentWindow.readParticleMapSource !== 'function') throw new Error('Map generator did not initialize');
      imported = createPixelMapConstructionScenario(frame.contentWindow.readParticleMapSource(),
        { deliveryMode: deliveryMode.value, buriedCore: buriedCore.checked,
          connectingFloors: buriedCore.checked && connectingFloors.checked });
      original = imported.scenario.world.snapshot();
      document.getElementById('source-status').textContent =
        `Source crop: world origin (${imported.originX * 4}, ${imported.originY * 4}), 640 by 360 world units; 160 by 90 cells at 4 units/cell. ` +
        (imported.scenario.inspectCore().enabled ? 'Three buried bases and a basement prepared in this isolated crop.'
          : 'Nine seeds placed on unchanged imported ground.');
      if (imported.floorSections.length) document.getElementById('source-status').textContent +=
        ` Level floor sections (grid coordinates): ${imported.floorSections.map((floor) =>
          `x ${floor.left}-${floor.right}, row ${floor.y}`).join('; ')}.`;
      document.getElementById('source-status').textContent +=
        ` Initial placement audit: all ${imported.terrainIntegrity.checked} cells verified; ` +
        `${imported.terrainIntegrity.excavated} intentional basement terrain cells excavated. ` +
        `${imported.terrainIntegrity.terrain} solid terrain cells, ${imported.terrainIntegrity.water} preserved water cells, ` +
        `${imported.terrainIntegrity.foundation} free foundation pixels verified. ` +
        'No unintended placement gaps; imported tunnels preserved. Later damage/excavation is separate.';
      clock = createFixedStepClock(() => { if (running && !busy && !failed) step(); });
      fps.reset(performance.now());
      document.getElementById('fps').textContent = 'Render FPS: measuring...';
      verify(); renderer.resize(); draw();
      message.textContent = 'Ready and paused. Run to begin the blueprint reveal and paid construction.';
    } catch (error) { fail(error); }
    finally { clearTimeout(timeout); frame.remove(); busy = false; controls(); }
  }
  function action(operation) {
    try { operation(); verify(); draw(); }
    catch (error) { fail(error); }
  }
  function inspectCell(x, y) {
    const output = document.getElementById('cell-status');
    if (!Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || x >= imported.scenario.world.width || y < 0 || y >= imported.scenario.world.height) {
      output.textContent = 'Inspection requires integer grid x 0-159 and y 0-89. No simulation changes made.';
      selectedCell = null;
      return;
    }
    const cell = inspectPixelMapCell(imported, original, x, y);
    selectedCell = { x, y };
    document.getElementById('inspect-x').value = String(x);
    document.getElementById('inspect-y').value = String(y);
    output.textContent = `Cell (${x}, ${y}) at tick ${cell.tick}: ${cell.material}; ${cell.role}. ` +
      `Initial material: ${cell.initialMaterial} (${cell.changed ? 'changed since placement' : 'unchanged'}). ` +
      `${cell.paidDeliveries} paid deliveries here${cell.deliveryStates.length ? `: ${cell.deliveryStates.join('; ')}` : ''}. ` +
      `${cell.usableSourceSlots}/${cell.sourceSlots} usable source slots here. ` +
      `${cell.incomingDeliveries} incoming reserved deliveries; current repair state: ${cell.repairState || 'not in the active repair layer'}. ` +
      (cell.blockerDescriptions.length ? `Delivery blockers: ${cell.blockerDescriptions.join('; ')}. ` : '') +
      (cell.load ? `Load ${cell.load.load.toFixed(2)}/${cell.load.capacity}.` :
        cell.material === 'settled building' ? 'Load unavailable until physics recalculates.' : 'No settled-building load here.');
  }
  inspectButton.addEventListener('click', () => action(() => {
    const x = document.getElementById('inspect-x'), y = document.getElementById('inspect-y');
    inspectCell(x.valueAsNumber, y.valueAsNumber);
  }));
  canvas.addEventListener('click', (event) => {
    if (inspectButton.disabled) {
      document.getElementById('cell-status').textContent = 'Cell inspection unavailable while generating or stopped by an error.';
      return;
    }
    const bounds = canvas.getBoundingClientRect(), { world } = imported.scenario;
    action(() => inspectCell(Math.floor((event.clientX - bounds.left) * world.width / bounds.width),
      Math.floor((event.clientY - bounds.top) * world.height / bounds.height)));
  });
  generate.addEventListener('click', generateMap);
  buriedCore.addEventListener('change', controls);
  pause.addEventListener('click', () => { running = !running; controls(); });
  buttons[0].addEventListener('click', () => action(() => {
    for (let tick = 0; tick < 60; tick += 1) step();
    fps.reset(performance.now());
    document.getElementById('fps').textContent = 'Render FPS: measuring...';
    message.textContent = 'Advanced 60 simulated ticks.';
  }));
  buttons[1].addEventListener('click', () => action(() => {
    const { scenario } = imported, { world } = scenario;
    const before = world.barrierCount + world.constructionCount + world.debrisCount + scenario.transportedMaterialCount;
    const removed = imported.scenario.blastFoundation();
    destroyed += before - world.barrierCount - world.constructionCount - world.debrisCount - scenario.transportedMaterialCount;
    message.textContent = `Blast removed ${removed} material cells; support responds next tick. No HM refunded.`;
  }));
  buttons[2].addEventListener('click', () => action(() => {
    const removed = imported.scenario.clearDebris(); cleared += removed;
    message.textContent = `Cleared ${removed} debris cells; no HM refunded.`;
  }));
  buttons[3].addEventListener('click', () => action(() => {
    const { world } = imported.scenario;
    const { restored, blocked } = restorePixelMapTerrain(world, original);
    message.textContent = `Restored ${restored} original terrain cells; ${blocked} occupied cells left untouched. ${blocked ? 'Restoration incomplete.' : 'Original terrain restored.'} No HM charged.`;
  }));
  buttons[4].addEventListener('click', () => action(() => {
    const audit = imported.scenario.inspectRecovery();
    const sources = audit.sources.map((source) =>
      `(${source.x}, ${source.y}): ${source.state}${source.route ? `, ${source.route.steps} steps to (${source.route.target.x}, ${source.route.target.y})` : ''}`);
    const agents = audit.agents.map((agent) =>
      `(${agent.x}, ${agent.y}): ${agent.state}${agent.route ? `, ${agent.route.steps} steps to (${agent.route.target.x}, ${agent.route.target.y})` : ''}`);
    document.getElementById('routes').textContent =
      `Route snapshot at tick ${audit.tick}, ${audit.phase}. Sources: ${sources.join('; ')}. ` +
      `Retained paid pixels: ${agents.length ? agents.join('; ') : 'none'}. Snapshot only; no movement or HM spending.`;
  }));
  buttons[5].addEventListener('click', () => action(() => {
    const { scenario } = imported, { world } = scenario;
    const before = world.barrierCount + world.constructionCount + world.debrisCount + scenario.transportedMaterialCount;
    const removed = scenario.blastCore(Number(document.getElementById('core-selection').value));
    destroyed += before - world.barrierCount - world.constructionCount - world.debrisCount - scenario.transportedMaterialCount;
    message.textContent = `Buried-base blast removed ${removed} material cells. ` +
      (scenario.coreDestroyed ? 'All cores lost: repairs permanently disabled.' : 'Other surviving core pixels still permit repair.');
  }));
  buttons[6].addEventListener('click', () => action(() => {
    const result = excavatePixelFloorGround(imported, Number(document.getElementById('floor-selection').value));
    message.textContent = `Removed ${result.removed} terrain cells beneath the floor. ` +
      `Checked grid positions: ${result.cells.map((cell) => `(${cell.x}, ${cell.y})`).join('; ')}. ` +
      'No building material or water removed; support reacts next physics tick. No HM refund.';
  }));
  new ResizeObserver(() => { renderer.resize(); draw(); }).observe(canvas.parentElement);
  function frame(time) {
    try { if (!failed) { clock.advance(time); draw(); if (imported && !busy) fps.record(); } }
    catch (error) { fail(error); }
    requestAnimationFrame(frame);
  }
  renderer.resize(); requestAnimationFrame(frame); generateMap();
}());
