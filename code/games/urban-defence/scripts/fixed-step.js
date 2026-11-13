function createFixedStepClock(update, stepSeconds = 1 / 60, maxFrameSeconds = 0.1) {
  if (typeof update !== 'function' || !(stepSeconds > 0) || !(maxFrameSeconds >= stepSeconds)) {
    throw new Error('Invalid fixed-step clock configuration');
  }
  let previousTime;
  let accumulator = 0;
  return {
    advance(timestamp) {
      if (!Number.isFinite(timestamp)) throw new Error('Invalid frame timestamp');
      if (previousTime === undefined) {
        previousTime = timestamp;
        return 0;
      }
      const elapsed = Math.max(0, Math.min(maxFrameSeconds, (timestamp - previousTime) / 1000));
      previousTime = timestamp;
      accumulator += elapsed;
      while (accumulator + 1e-10 >= stepSeconds) {
        update(stepSeconds);
        accumulator -= stepSeconds;
      }
      accumulator = Math.max(0, accumulator);
      return accumulator / stepSeconds;
    },
  };
}
