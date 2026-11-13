function createLabViewport(canvas) {
  if (!canvas || canvas.tagName !== 'CANVAS') throw new Error('Lab viewport requires a canvas');
  if (canvas.dataset.labViewport) throw new Error('Lab viewport already attached');
  canvas.dataset.labViewport = 'true';
  let viewport = canvas.parentElement;
  if (viewport.children.length !== 1 || viewport === document.body) {
    viewport = document.createElement('div'); canvas.before(viewport); viewport.appendChild(canvas);
  }
  const shell = document.createElement('div'); shell.className = 'lab-preview-shell';
  viewport.before(shell); shell.appendChild(viewport);
  viewport.classList.add('lab-camera-viewport');
  viewport.style.height = '640px'; viewport.style.maxHeight = '640px';
  viewport.style.width = '100%'; viewport.style.boxSizing = 'border-box';
  viewport.style.scrollbarGutter = 'stable';
  const stage = document.createElement('div'); stage.className = 'lab-camera-stage';
  viewport.appendChild(stage); stage.appendChild(canvas);
  canvas.style.position = 'absolute'; canvas.style.left = '0'; canvas.style.top = '0';
  canvas.style.transformOrigin = '0 0'; canvas.style.touchAction = 'none';
  const settings = document.createElement('div'); settings.className = 'lab-preview-settings';
  settings.setAttribute('role', 'group'); settings.setAttribute('aria-label', 'Preview controls');
  const toggle = document.createElement('span'); toggle.className = 'lab-preview-title'; toggle.textContent = 'Preview controls';
  settings.appendChild(toggle);
  const panel = document.createElement('div');
  const label = document.createElement('p'); label.setAttribute('aria-live', 'polite');
  const help = document.createElement('p'); help.textContent = 'Wheel: zoom. Drag: pan. Click: lab tool.';
  const buttons = document.createElement('div');
  settings.appendChild(panel); panel.append(label, buttons, help); shell.appendChild(settings);
  let zoom = 1, drag = null, suppressClickUntil = 0, initialView = true;
  function fitZoom() {
    return Math.max(0.25, Math.min(1, viewport.clientWidth / canvas.offsetWidth, 640 / canvas.offsetHeight));
  }
  function update() {
    const width = canvas.offsetWidth, height = canvas.offsetHeight;
    canvas.style.transform = `scale(${zoom})`;
    stage.style.height = `${height * zoom}px`;
    stage.style.minHeight = '1px';
    label.textContent = `View zoom: ${Math.round(zoom * 100)}%`;
    shell.dataset.zoom = String(zoom);
    return { width, height };
  }
  function setZoom(value, clientX, clientY) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid lab view zoom');
    const bounds = canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width, y = (clientY - bounds.top) / bounds.height;
    initialView = false; zoom = Math.max(0.25, Math.min(8, value)); update();
    const next = canvas.getBoundingClientRect();
    viewport.scrollLeft += next.left + x * next.width - clientX;
    viewport.scrollTop += next.top + y * next.height - clientY;
  }
  const centerZoom = (factor) => {
    const bounds = viewport.getBoundingClientRect();
    setZoom(zoom * factor, bounds.left + viewport.clientWidth / 2, bounds.top + viewport.clientHeight / 2);
  };
  for (const [text, operation] of [
    ['Zoom out', () => centerZoom(1 / 1.25)],
    ['Zoom in', () => centerZoom(1.25)],
    ['Reset view', () => { initialView = false; zoom = fitZoom(); update(); viewport.scrollLeft = 0; viewport.scrollTop = 0; }],
  ]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.addEventListener('click', operation); buttons.appendChild(button);
  }
  const options = document.getElementById('comparison-options') || document.getElementById('unit-options');
  const simulation = document.createElement('div'); simulation.className = 'lab-simulation-options';
  if (options) {
    const statistics = document.getElementById('comparison-statistics') || document.getElementById('unit-statistics');
    let node = options.nextSibling;
    while (node && node !== statistics) {
      const next = node.nextSibling; simulation.appendChild(node); node = next;
    }
    simulation.prepend(options);
  } else {
    const heading = document.createElement('h2'); heading.textContent = 'Options'; simulation.appendChild(heading);
    const controls = [...document.querySelectorAll('body button, body select, body input')].filter((element) =>
      !element.closest('.lab-preview-settings') && !element.closest('.lab-simulation-options'));
    for (const control of controls) {
      if (simulation.contains(control)) continue;
      const enclosingLabel = control.closest('label');
      if (enclosingLabel) { simulation.appendChild(enclosingLabel); continue; }
      const row = document.createElement('div'); row.className = 'lab-option-row';
      const associated = control.id ? [...document.querySelectorAll('label')].find((candidate) => candidate.htmlFor === control.id) : null;
      if (associated) row.appendChild(associated);
      else if (control.tagName !== 'BUTTON' && !control.getAttribute('aria-label')) {
        const label = document.createElement('label'); label.htmlFor = control.id;
        label.textContent = control.id.replace(/[-_]/g, ' '); row.appendChild(label);
      }
      row.appendChild(control); simulation.appendChild(row);
    }
  }
  for (const select of simulation.querySelectorAll('select')) {
    const label = [...simulation.querySelectorAll('label')].find((candidate) => candidate.htmlFor === select.id);
    if (label && label.parentElement === simulation && select.parentElement === simulation) {
      const row = document.createElement('div'); row.className = 'lab-option-row';
      label.before(row); row.append(label, select);
    }
  }
  if (simulation.children.length > 1) panel.appendChild(simulation);
  viewport.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    setZoom(zoom * Math.exp(-delta * 0.0015), event.clientX, event.clientY);
  }, { capture: true, passive: false });
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
  }, true);
  viewport.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; canvas.setPointerCapture(event.pointerId); }
    viewport.scrollLeft = drag.left - dx; viewport.scrollTop = drag.top - dy;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  const release = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.moved) {
      suppressClickUntil = performance.now() + 500;
      event.preventDefault(); event.stopImmediatePropagation();
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag = null;
  };
  viewport.addEventListener('pointerup', release, true);
  viewport.addEventListener('pointercancel', release, true);
  canvas.addEventListener('lostpointercapture', () => { drag = null; });
  window.addEventListener('pointerup', () => { drag = null; });
  viewport.addEventListener('click', (event) => {
    if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = 0; }
  }, true);
  new ResizeObserver(() => { if (initialView) zoom = fitZoom(); update(); }).observe(canvas);
  zoom = fitZoom();
  update();
  return {
    inspect: () => ({ zoom, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop }),
    reset() { initialView = false; zoom = fitZoom(); update(); viewport.scrollLeft = 0; viewport.scrollTop = 0; },
  };
}

(function () {
  const style = document.createElement('style');
  style.textContent = '.lab-preview-shell{position:relative;max-width:100%;margin:12px 0;background:#020202}' +
    '.lab-camera-viewport{position:relative;overflow:auto!important;max-width:100%;max-height:640px}' +
    '.lab-camera-stage{position:relative;width:100%}' +
    '.lab-preview-settings{position:absolute;right:12px;top:12px;z-index:2;color:#bce6a0;background:#102316;border:1px solid #6c9455;border-radius:4px}' +
    '.lab-preview-title{display:block;padding:5px 8px;font:14px sans-serif;font-weight:bold}' +
    '.lab-preview-settings>div{padding:6px;width:400px;max-width:calc(100vw - 90px);max-height:570px;overflow:auto;font:14px sans-serif;line-height:1.3}' +
    '.lab-preview-settings button,.lab-preview-settings select{margin:2px;padding:4px;font:inherit;min-height:28px}' +
    '.lab-preview-settings label{display:inline-flex;align-items:center;gap:4px;margin:3px}' +
    '.lab-preview-settings h2{width:100%;font-size:14px;margin:6px 0 3px;border-top:1px solid #49643b;padding-top:5px}' +
    '.lab-preview-settings p{margin:4px 0}.lab-option-row{display:inline-flex;align-items:center;flex-wrap:wrap}' +
    '.lab-simulation-options{display:flex;align-items:center;flex-wrap:wrap;gap:2px}.lab-simulation-options>p{display:contents}' +
    '.lab-preview-shell canvas{image-rendering:pixelated}';
  document.head.appendChild(style);
  document.querySelectorAll('body canvas').forEach((canvas) => createLabViewport(canvas));
}());
