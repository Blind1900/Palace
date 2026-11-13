function runPixelTunnelChecks() {
  const lines = [], assert = (ok, message) => { if (!ok) throw new Error(message); };
  const check = (name, run) => {
    try { run(); lines.push(`PASS ${name}`); } catch (error) { lines.push(`FAIL ${name}: ${error.message}`); }
  };
  check('excavation connects resource and branching chamber without creating HM', () => {
    const fixture = createPixelTunnelFixture();
    assert(!fixture.route(fixture.entrance, fixture.node).length && fixture.miners.length === 0, 'miners exist before connection');
    fixture.connect(); fixture.connect();
    assert(fixture.miners.length === 2 && fixture.route(fixture.entrance, fixture.node).length &&
      fixture.route(fixture.node, fixture.chamber).length, 'physical routes missing or miners duplicated');
    assert(fixture.audit().remaining === 290 && fixture.audit().carried === 10 &&
      fixture.audit().excavated > 0 && fixture.chamber.stored === 0 && fixture.ticks === 0,
      'connection did not immediately harvest or bypassed physical delivery');
    assert(fixture.audit().remaining + fixture.audit().carried === 300, 'excavation created HM');
  });
  check('miners harvest carry and store finite HM, stop at capacity and resume after withdrawal', () => {
    const fixture = createPixelTunnelFixture(); fixture.connect();
    for (let i = 0; i < 16000; i += 1) fixture.step();
    assert(fixture.chamber.stored === 100 && fixture.audit().carried === 0, 'storage never filled or cargo exceeded reservation');
    const remaining = fixture.node.remaining;
    for (let i = 0; i < 1000; i += 1) fixture.step();
    assert(fixture.node.remaining === remaining, 'full storage kept harvesting');
    assert(!fixture.withdraw(101).ok && fixture.withdraw(25).ok, 'withdrawal validation failed');
    for (let i = 0; i < 5000; i += 1) fixture.step();
    assert(fixture.chamber.stored === 100 && fixture.node.remaining === remaining - 25 &&
      fixture.audit().withdrawn === 25, 'spending did not resume collection');
    fixture.audit();
  });
  check('route obstruction and real flooding stop dry travel while preserving HM and water', () => {
    const fixture = createPixelTunnelFixture(); fixture.connect(); fixture.block();
    assert(!fixture.route(fixture.entrance, fixture.node).length, 'miner path crossed a blocked tunnel');
    for (let i = 0; i < 60; i += 1) fixture.step();
    assert(fixture.miners.every((miner) => fixture.clear(miner.x, miner.y)), 'miner walked inside settled debris');
    fixture.audit();
    const flooded = createPixelTunnelFixture(); flooded.connect(); flooded.breach();
    for (let i = 0; i < 180; i += 1) flooded.step();
    assert(flooded.world.at(129, 76) === PARTICLE_WATER && !flooded.route(flooded.entrance, flooded.node).length,
      'basin did not flood real tunnel or dry path ignored water');
    flooded.audit();
  });
  check('every building kind and roads wait for physical HM transport and prefer tunnel storage', () => {
    for (const kind of ['population', 'military', 'farm', 'road']) {
      const fixture = createPixelTunnelFixture(); fixture.connect();
      for (let i = 0; i < 600; i += 1) fixture.step();
      assert(fixture.chamber.stored >= 10, 'initial miners did not deliver HM');
      const left = { population: 12, military: 60, farm: 24, road: 46 }[kind];
      const cells = Array.from({ length: kind === 'road' ? 10 : 3 }, (_, x) => ({ x: left + x, y: 35 }));
      const result = fixture.logistics.request(kind, cells);
      assert(result.ok && fixture.world.barrierCount === 0, 'request placed material immediately');
      assert(!fixture.logistics.request(kind, cells).ok, 'duplicate footprint was not reserved');
      for (let i = 0; i < 30; i += 1) fixture.step();
      assert(fixture.logistics.transporters.length === 1 && fixture.world.barrierCount === 0,
        'transport missing or material placed before arrival');
      assert(fixture.logistics.transporters[0].source === 'tunnel', 'core chosen ahead of tunnel HM');
      for (let i = 0; i < 2400; i += 1) fixture.step();
      assert(result.job.placed === cells.length && fixture.world.barrierCount === cells.length &&
        fixture.logistics.audit().spent === cells.length && fixture.coreStockpile.hm === 50,
        'building/road delivery failed, duplicated material or debited core stock');
      fixture.audit();
    }
  });
  check('core fallback is finite and blocked loaded transporters retain HM until clearance returns', () => {
    const fixture = createPixelTunnelFixture();
    const result = fixture.logistics.request('population', [{ x: 12, y: 35 }, { x: 13, y: 35 }, { x: 14, y: 35 }]);
    fixture.step();
    const agent = fixture.logistics.transporters[0], snapshot = fixture.world.snapshot();
    assert(agent && agent.source === 'core' && fixture.coreStockpile.hm === 47, 'core fallback not debited exactly');
    fixture.world.set(agent.x, agent.y, PARTICLE_WATER);
    for (let i = 0; i < 60; i += 1) fixture.logistics.step();
    assert(agent.carried === 3 && !result.job.placed && agent.state.includes('blocked'), 'blocked cargo was lost or placed');
    fixture.world.restore(snapshot);
    for (let i = 0; i < 300; i += 1) fixture.step();
    assert(result.job.placed === 3 && fixture.logistics.audit().drawn === 3, 'unblocked delivery charged twice');
    fixture.audit();
    const world = createParticleWorld(30, 10);
    for (let x = 0; x < 30; x += 1) world.set(x, 8, PARTICLE_TERRAIN);
    const empty = createPixelConstructionLogistics(world, [{ kind: 'core', x: 2, y: 7,
      available: () => 0, take: () => { throw new Error('Empty supply must not be charged'); } }]);
    const waiting = empty.request('road', [{ x: 10, y: 7 }]).job;
    for (let i = 0; i < 100; i += 1) empty.step();
    assert(!waiting.placed && waiting.state.includes('no reachable stocked supply') && empty.audit().drawn === 0,
      'empty supply created material');
  });
  check('concurrent seeds and roads never build a solid pixel onto another loaded transporter', () => {
    const fixture = createPixelTunnelFixture(); fixture.connect();
    for (let i = 0; i < 600; i += 1) fixture.step();
    for (const [kind, left] of [['population', 12], ['military', 60], ['farm', 24], ['road', 46]]) {
      const result = fixture.logistics.request(kind, Array.from({ length: kind === 'road' ? 10 : 3 },
        (_, index) => ({ x: left + index, y: 35 })));
      assert(result.ok, 'concurrent demo placement rejected');
    }
    for (let i = 0; i < 3000; i += 1) fixture.step();
    assert(fixture.logistics.jobs.every((job) => job.placed === job.required) &&
      fixture.logistics.audit().spent === 19 && !fixture.logistics.transporters.length,
      'concurrent delivery trapped a courier or did not finish all 19 pixels: ' +
      fixture.logistics.jobs.map((job) => `${job.kind} ${job.delivered}/${job.required} ${job.state}`).join('; ') +
      JSON.stringify(fixture.logistics.transporters.map((agent) => ({ x: agent.x, y: agent.y, state: agent.state }))));
    fixture.audit();
  });
  return lines;
}
if (typeof document !== 'undefined' && document.getElementById('tunnel-results')) {
  document.getElementById('tunnel-results').textContent = runPixelTunnelChecks().join('\n');
}
