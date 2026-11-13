(function () {
  const canvas = document.getElementById('lab');
  const ctx = canvas.getContext('2d');
  const fps = createLabFps(document.getElementById('fps'));
  const status = document.getElementById('status');
  const pause = document.getElementById('pause');
  let scenario = createCollapseImpactScenario(8);
  let paused = false;
  let steps = 0;
  for (const [id, offset] of [['left', -8], ['center', 0], ['right', 8]]) {
    document.getElementById(id).addEventListener('click', () => {
      scenario = createCollapseImpactScenario(offset);
      steps = 0;
      draw();
    });
  }
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
  });
  function advance() { scenario.model.step(1 / 60); steps += 1; }
  document.getElementById('step').addEventListener('click', () => {
    if (!paused) { status.textContent = 'Pause before stepping.'; return; }
    advance();
    draw();
  });
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    const zoom = 3;
    const cameraY = (scenario.upper.y + scenario.lower.y) / 2 + scenario.model.size / 2;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-210, -cameraY);
    ctx.strokeStyle = '#57d878';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(0, scenario.model.ground);
    ctx.lineTo(canvas.width, scenario.model.ground);
    ctx.stroke();
    for (const [section, color] of [[scenario.upper, '#f2cb68'], [scenario.lower, '#64bfd7']]) {
      ctx.save();
      ctx.translate(section.x + scenario.model.size / 2, section.y + scenario.model.size / 2);
      ctx.rotate(section.angle);
      ctx.strokeStyle = color;
      ctx.lineWidth = scenario.model.thickness;
      ctx.beginPath();
      ctx.moveTo(-scenario.model.size / 2, 0);
      ctx.lineTo(scenario.model.size / 2, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    status.textContent = `Step ${steps} | Upper angle: ${(scenario.upper.angle * 180 / Math.PI).toFixed(1)}° | Lower angle: ${(scenario.lower.angle * 180 / Math.PI).toFixed(1)}°`;
    fps.record();
  }
  const clock = createFixedStepClock(() => { if (!paused) advance(); });
  function frame(timestamp) {
    clock.advance(timestamp);
    draw();
    requestAnimationFrame(frame);
  }
  draw();
  requestAnimationFrame(frame);
}());
