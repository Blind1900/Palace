(function () {
  const canvas = document.getElementById('lab'), message = document.getElementById('message');
  const sizeControl = document.getElementById('size');
  const defaultArtwork = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE);
  [...sizeControl.options].forEach((option) => {
    option.disabled = Math.max(defaultArtwork.nativeWidth, defaultArtwork.nativeHeight) * Number(option.value) > 256;
  });
  if (![...sizeControl.options].some((option) => Number(option.value) === defaultArtwork.cellScale)) {
    sizeControl.add(new Option(`${defaultArtwork.cellScale}x: asset default`, String(defaultArtwork.cellScale)));
  }
  sizeControl.value = String(defaultArtwork.cellScale);
  let renderer, artwork;
  const heldKeys = new Set();
  const fps = createLabFps(document.getElementById('fps'));
  let world, unit, initial, addedWater, running = false, failed = false, clock;
  const buttons = ['pause', 'step', 'step-sixty', 'remove-support', 'water-contact'].map((id) => document.getElementById(id));
  function controls() {
    buttons.forEach((button) => { button.disabled = failed; });
    buttons[0].textContent = running ? 'Pause' : 'Run simulation';
    buttons[0].setAttribute('aria-pressed', String(running));
    buttons[1].disabled = failed || running; buttons[2].disabled = failed || running;
  }
  function draw() {
    renderer.draw({ world, blueprintCells: () => [] });
    const state = unit.inspect();
    renderer.markUnit(state, document.getElementById('collision').checked);
    document.getElementById('status').textContent =
      `Tick ${state.ticks} / world ${world.snapshot().tick}: ${state.state}, (${state.x}, ${state.y}), ` +
      `facing ${state.facing < 0 ? 'left' : 'right'}, ${state.grounded ? 'supported' : 'not supported'}, velocity ${state.vy.toFixed(2)} cells/s.\n` +
      `Reference ${state.animation}, frame ${state.frame + 1}; ${state.pixels.length} rendered pixels / ${state.collision.length} reserved silhouette cells.` +
      ` Size ${artwork.cellScale}x: ${artwork.width}-by-${artwork.height} cells.` +
      (state.blocker ? `\nBlocked at (${state.blocker.x}, ${state.blocker.y}): ${state.blocker.reason}.` : '');
    document.getElementById('accounting').textContent =
      `Unit physical mass: 0; ${world.waterCount} water cells (${initial.water} original + ${addedWater} explicit lab additions); ` +
      `barrier + construction + debris ${world.barrierCount + world.constructionCount + world.debrisCount}/${initial.material}. ` +
      'No HM/SM or live-game save changes.';
  }
  function step() {
    world.step(); updatePixelUnitLabPatrol(unit, world); unit.step();
    if (world.waterCount !== initial.water + addedWater ||
        world.barrierCount + world.constructionCount + world.debrisCount !== initial.material) {
      throw new Error('Unit lab changed physical water or structural material accounting');
    }
  }
  function fail(error) {
    running = false; failed = true; controls();
    message.textContent = `Unit experiment stopped: ${error.message}`; console.error(error);
  }
  function action(operation) { try { operation(); draw(); } catch (error) { fail(error); } }
  function reset() {
    running = false; failed = false; addedWater = 0;
    heldKeys.clear();
    artwork = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellScale: Number(sizeControl.value) });
    const groundRow = Math.max(110, artwork.height + 30), worldHeight = Math.max(160, groundRow + 50);
    const obstacleX = Math.max(100, 55 + artwork.width + 10), waterLeft = obstacleX + 40;
    const roofRow = Math.max(75, artwork.height + 5);
    world = createParticleWorld(360, worldHeight, { skipEmptyChunks: true });
    renderer = createPixelConstructionRenderer(canvas, world.width, world.height);
    renderer.resize(640);
    const scene = document.getElementById('scene').value;
    for (let x = 0; x < 360; x += 1) {
      const ground = scene === 'steps' ? x < obstacleX ? groundRow : x < obstacleX + 20 ? groundRow - Math.floor((x - obstacleX) / 5) * 2 :
        x < obstacleX + 75 ? groundRow - 6 : groundRow - 25 : scene === 'water' && x >= waterLeft && x < waterLeft + 50 ? groundRow + 10 : groundRow;
      for (let y = ground; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    }
    if (scene === 'tunnel') {
      for (let x = obstacleX + 20; x <= 280; x += 1) {
        for (let y = groundRow - 20; y < groundRow - 11; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      }
    }
    if (scene === 'water') {
      for (let x = waterLeft; x < waterLeft + 50; x += 1) for (let y = groundRow; y < groundRow + 10; y += 1) world.set(x, y, PARTICLE_WATER);
    }
    if (scene === 'roof') {
      const snapshot = world.snapshot();
      for (let x = 45; x < Math.max(120, 55 + artwork.width + 10); x += 1) snapshot.cells[roofRow * world.width + x] = PARTICLE_BARRIER;
      world.restore(snapshot);
    }
    unit = createPixelTerrainUnit(world, artwork, { x: 55, y: (scene === 'roof' ? roofRow : groundRow) - artwork.footRow, facing: 1,
      automated: document.getElementById('unit-automated').checked });
    initial = { water: world.waterCount, material: world.barrierCount + world.constructionCount + world.debrisCount };
    clock = createFixedStepClock(() => { if (running) step(); });
    message.textContent = 'Focus the canvas; A/D move, Space/W jumps, S/down/Ctrl crouches. Reset changes only this lab.';
    controls(); draw(); fps.reset(performance.now());
  }
  document.getElementById('reset').addEventListener('click', () => action(reset));
  document.getElementById('scene').addEventListener('change', () => action(reset));
  document.getElementById('size').addEventListener('change', () => action(reset));
  document.getElementById('unit-automated').addEventListener('change', () => action(reset));
  buttons[0].addEventListener('click', () => { running = !running; controls(); });
  buttons[1].addEventListener('click', () => action(step));
  buttons[2].addEventListener('click', () => action(() => { for (let i = 0; i < 60; i += 1) step(); }));
  buttons[3].addEventListener('click', () => action(() => {
    const state = unit.inspect(), left = Math.max(0, state.x), right = Math.min(world.width - 1, state.x + state.width - 1);
    const top = Math.min(world.height - 1, state.y + state.footRow), bottom = Math.min(world.height - 1, top + 12);
    const snapshot = world.snapshot();
    let removed = 0;
    for (let x = left; x <= right; x += 1) for (let y = top; y <= bottom; y += 1) {
      const key = y * world.width + x;
      if (snapshot.cells[key] === PARTICLE_TERRAIN) { snapshot.cells[key] = PARTICLE_EMPTY; removed += 1; }
      else if (snapshot.cells[key] === PARTICLE_BARRIER) snapshot.cells[key] = PARTICLE_DEBRIS;
    }
    world.restore(snapshot);
    message.textContent = `Removed ${removed} explicit lab terrain cells; roof barriers become conserved debris. Step to test support loss.`;
  }));
  buttons[4].addEventListener('click', () => action(() => {
    const state = unit.inspect(), pixel = state.pixels[0], x = state.x + pixel.x, y = state.y + pixel.y;
    if (world.at(x, y) !== PARTICLE_EMPTY) {
      message.textContent = 'Water contact rejected: the selected reference pixel is already occupied.'; return;
    }
    world.set(x, y, PARTICLE_WATER); addedWater += 1;
    message.textContent = 'Added one explicit lab water cell at the unit silhouette; step to inspect partial-water slowdown without displacing water.';
  }));
  document.getElementById('collision').addEventListener('change', draw);
  const bindings = { a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
    w: 'jump', arrowup: 'jump', ' ': 'jump', s: 'crouch', arrowdown: 'crouch', control: 'crouch' };
  const key = (event, pressed) => {
    const code = event.key.toLowerCase(), name = bindings[code];
    if (!name) return;
    event.preventDefault();
    if (pressed) heldKeys.add(code); else heldKeys.delete(code);
    unit.input[name] = [...heldKeys].some((key) => bindings[key] === name);
  };
  canvas.addEventListener('keydown', (event) => key(event, true));
  canvas.addEventListener('keyup', (event) => key(event, false));
  const release = () => { heldKeys.clear(); Object.keys(unit.input).forEach((name) => { unit.input[name] = false; }); };
  canvas.addEventListener('blur', release);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  new ResizeObserver(() => { if (renderer && world) { renderer.resize(640); draw(); } }).observe(canvas.parentElement);
  function frame(time) {
    try { if (!failed) { clock.advance(time); draw(); fps.record(); } }
    catch (error) { fail(error); }
    requestAnimationFrame(frame);
  }
  reset(); renderer.resize(640); requestAnimationFrame(frame);
}());
