function createFrameRateMeter(startTime) {
  let start = startTime;
  let frames = 0;
  return {
    record() { frames += 1; },
    sample(now) {
      const elapsed = now - start;
      if (elapsed <= 0) return null;
      const fps = frames * 1000 / elapsed;
      start = now;
      frames = 0;
      return fps;
    },
    reset(now) { start = now; frames = 0; },
  };
}

function formatLabFps(fps) {
  if (!Number.isFinite(fps) || fps < 0) throw new Error('Invalid lab frame rate');
  return `Render FPS: ${fps.toFixed(1)}${fps < 40 ? ' | Below 40 FPS: performance review needed' : ''}`;
}

function createLabFps(element) {
  const meter = createFrameRateMeter(performance.now());
  function update() {
    if (document.hidden) {
      meter.reset(performance.now());
      element.textContent = 'Render FPS: hidden tab';
      return;
    }
    const fps = meter.sample(performance.now());
    if (fps !== null) element.textContent = formatLabFps(fps);
  }
  document.addEventListener('visibilitychange', () => {
    meter.reset(performance.now());
    element.textContent = document.hidden ? 'Render FPS: hidden tab' : 'Render FPS: measuring...';
  });
  setInterval(update, 1000);
  return meter;
}
