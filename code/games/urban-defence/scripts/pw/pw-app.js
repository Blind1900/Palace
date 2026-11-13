'use strict';
// Development bootstrap for the pixel world: generate, render, pan and zoom.
(function () {
  const PW = window.PW;
  const params = new URL(window.location.href).searchParams;
  const canvas = document.getElementById('world-canvas');
  const status = document.getElementById('world-status');
  const seed = Number(params.get('seed')) || (Math.random() * 1e9) >>> 0;

  const timings = {};
  let t = performance.now();
  const world = PW.createWorld(16384, 4096);
  timings.allocate = performance.now() - t; t = performance.now();
  const gallery = params.has('gallery');
  const gallerySet = params.get('gallery') === '1' ? 'population' : params.get('gallery');
  const layout = gallery ? PW.generateGallery(world, seed, gallerySet) : PW.generateTerrain(world, seed);
  timings.terrain = performance.now() - t; t = performance.now();
  if (PW.generateVegetation && !gallery) {
    PW.generateVegetation(world, layout, seed);
    timings.vegetation = performance.now() - t; t = performance.now();
  }
  if (PW.generateSettlements && !gallery) {
    PW.generateSettlements(world, layout, seed);
    timings.settlements = performance.now() - t; t = performance.now();
  }
  const renderer = PW.createRenderer(canvas, world, { seed });
  renderer.refreshOverview(Infinity);
  timings.overview = performance.now() - t;

  // ---- Input ------------------------------------------------------------------------------------
  const drag = { active: false, x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (event) => {
    drag.active = true; drag.x = event.clientX; drag.y = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag.active) return;
    renderer.panByDevice((event.clientX - drag.x) * renderer.view.dpr, (event.clientY - drag.y) * renderer.view.dpr);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  const release = () => { drag.active = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const ax = (event.clientX - rect.left) * renderer.view.dpr, ay = (event.clientY - rect.top) * renderer.view.dpr;
    renderer.setZoomIndex(renderer.camera.zoomIndex + (event.deltaY < 0 ? 1 : -1), ax, ay);
  }, { passive: false });
  new ResizeObserver(() => renderer.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);

  // ---- Loop -------------------------------------------------------------------------------------
  let frames = 0, fpsClock = performance.now(), fps = 0;
  function frame() {
    renderer.beginFrame();
    renderer.drawSky();
    renderer.drawBase();
    if (PW.drawUnitsHook) PW.drawUnitsHook(renderer);
    renderer.drawDeco();
    frames += 1;
    const now = performance.now();
    if (now - fpsClock >= 500) {
      fps = frames * 1000 / (now - fpsClock);
      frames = 0; fpsClock = now;
      const s = renderer.stats();
      status.textContent = `seed ${seed} | ${fps.toFixed(0)} fps | zoom ${s.zoom.toFixed(3)} lod ${s.lod} | ` +
        `cached ${s.cached} | gen ${Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join(', ')}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.pwApp = { world, layout, renderer, seed, timings, ready: true,
    focus: (x, y, zoomIndex) => renderer.focus(x, y, zoomIndex) };
})();
