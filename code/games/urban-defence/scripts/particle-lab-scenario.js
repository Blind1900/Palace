function createParticleLabScenario(snapshot) {
  if (snapshot !== undefined &&
      (!snapshot || snapshot.version !== 1 || typeof snapshot.breached !== 'boolean' ||
       typeof snapshot.extended !== 'boolean')) {
    throw new Error('Invalid or unsupported particle lab save');
  }
  const world = createParticleWorld(200, 120);
  const tunnel = { left: 66, top: 88, right: 169, bottom: 94 };
  const extension = { left: 170, top: 88, right: 193, bottom: 114 };
  const monitoredColumn = 90;
  const barrierColumn = 110;
  let breached = false;
  let extended = false;
  for (let x = 0; x < world.width; x += 1) {
    const smooth = (value) => {
      const t = Math.max(0, Math.min(1, value));
      return t * t * (3 - 2 * t);
    };
    const valley = Math.round(10 * smooth((x - 22) / 60) * smooth((178 - x) / 60));
    const distance = (x - 66) / 17;
    const surface = 55 + valley + (Math.abs(distance) < 1 ? Math.round(14 * (1 - distance * distance)) : 0);
    for (let y = surface; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    if (Math.abs(distance) < 1) {
      for (let y = 57 + valley; y < surface; y += 1) world.set(x, y, PARTICLE_WATER);
    }
  }
  world.excavate(tunnel.left, tunnel.top, tunnel.right, tunnel.bottom);
  if (snapshot !== undefined) {
    world.restore(snapshot.world);
    breached = snapshot.breached;
    extended = snapshot.extended;
  }
  return {
    world,
    tunnel,
    snapshot() { return { version: 1, breached, extended, world: world.snapshot() }; },
    breach() {
      const removed = world.excavate(64, 65, 68, 87);
      breached = true;
      return removed;
    },
    extend() {
      const removed = world.excavate(extension.left, extension.top, extension.right, extension.bottom);
      extended = true;
      return removed;
    },
    get extended() { return extended; },
    monitoredColumn,
    barrierColumn,
    constructBarrier() { return world.constructBarrier(barrierColumn, tunnel.top, tunnel.bottom); },
    damageBarrierSupports() {
      return world.excavate(barrierColumn, tunnel.top - 1, barrierColumn, tunnel.top - 1) +
        world.excavate(barrierColumn, tunnel.bottom + 1, barrierColumn, tunnel.bottom + 1);
    },
    floodDepth() {
      for (let y = tunnel.top; y <= tunnel.bottom; y += 1) {
        if (world.at(monitoredColumn, y) === PARTICLE_WATER) {
          return (tunnel.bottom - y + 1) / (tunnel.bottom - tunnel.top + 1);
        }
      }
      return 0;
    },
    isPassage(x, y) {
      return (x >= tunnel.left && x <= tunnel.right && y >= tunnel.top && y <= tunnel.bottom) ||
        (breached && x >= 64 && x <= 68 && y >= 65 && y <= 87) ||
        (extended && x >= extension.left && x <= extension.right && y >= extension.top && y <= extension.bottom);
    },
    tunnelWater() { return world.countWater(tunnel.left, tunnel.top, tunnel.right, tunnel.bottom); },
  };
}
