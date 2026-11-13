function runPixelTunnelNetworkChecks() {
  const results = [];
  const check = (name, test) => {
    try {
      const detail = test();
      results.push(`PASS ${name}${detail ? ` (${detail})` : ''}`);
    } catch (error) {
      results.push(`FAIL ${name}: ${error.message}`);
    }
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const flatWorld = (width, height, ground) => {
    const world = createParticleWorld(width, height);
    for (let y = ground; y < height; y += 1) for (let x = 0; x < width; x += 1) world.set(x, y, PARTICLE_TERRAIN);
    return world;
  };
  const runUntil = (stepper, done, limit) => {
    for (let i = 0; i < limit; i += 1) { if (done()) return i; stepper(); }
    if (!done()) throw new Error(`condition not reached within ${limit} ticks`);
    return limit;
  };

  check('wall pixels separate tunnels from terrain', () => {
    const world = flatWorld(12, 12, 6);
    assert(world.placeWall(3, 6).ok && world.placeWall(4, 4).ok, 'walls should replace terrain or empty cells');
    assert(world.placeWall(3, 6).reason === 'complete', 'repeated wall placement should be idempotent');
    assert(world.wallCount === 2 && world.terrainCount === 71, 'wall/terrain counts drifted');
    assert(world.surfaceRow(4) === 4, 'surface scan should stop at a wall');
    const snapshot = world.snapshot();
    world.excavate(3, 6, 3, 6);
    assert(world.wallCount === 1, 'excavation should remove walls');
    world.restore(snapshot);
    assert(world.wallCount === 2 && world.at(3, 6) === PARTICLE_WALL, 'snapshot restore lost walls');
    world.set(4, 3, PARTICLE_WATER);
    for (let i = 0; i < 4; i += 1) world.step();
    assert(world.at(4, 4) === PARTICLE_WALL && world.waterCount === 1, 'water should rest on walls');
    const hit = world.impact(3, 6, 1);
    assert(hit.wall === 1 && world.at(3, 6) === PARTICLE_DEBRIS, 'impacts should break walls into debris');
  });

  check('construction follows survey -> wall line -> clear order', () => {
    const world = flatWorld(40, 60, 10);
    const network = createPixelTunnelNetwork(world);
    const plan = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 20, y: 8 }, { x: 20, y: 40 }] });
    assert(plan.ok, plan.reason);
    const segment = plan.segment;
    network.step();
    assert(segment.phase === 'survey' && network.markers.size === 4 && network.excavated === 0,
      'survey markers should appear before any digging');
    assert([...network.markers].every((k) => (Math.floor(k / 40) - 8) % 2 === 0), 'markers should be on every other cell');
    runUntil(() => network.step(), () => segment.phase !== 'survey', 40);
    assert(network.markers.size === segment.survey.length, 'all markers should be placed before lining');
    runUntil(() => network.step(), () => segment.phase === 'clear', 60);
    assert(network.markers.size === segment.survey.length, 'markers stay while walls are lined');
    const ticks = runUntil(() => network.step(), () => segment.phase === 'complete', 40) + network.ticks;
    assert(network.markers.size === 0, 'markers should be cleared at completion');
    assert(network.ticks < 56, `32-cell shaft should beat the 56-frame reference, took ${network.ticks}`);
    return `${ticks} ticks, ${network.lined} wall px`;
  });

  check('walls stay underground and ladders sit on the chosen side', () => {
    const world = flatWorld(40, 60, 10);
    const network = createPixelTunnelNetwork(world);
    const left = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 10, y: 8 }, { x: 10, y: 30 }] }).segment;
    const right = network.plan({ kind: 'shaft', from: 'surface', ladderSide: 'right',
      points: [{ x: 28, y: 8 }, { x: 28, y: 30 }] }).segment;
    runUntil(() => network.step(), () => network.idle(), 200);
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 40; x += 1) assert(world.at(x, y) !== PARTICLE_WALL, `wall above ground at ${x},${y}`);
    }
    for (let y = 10; y <= 30; y += 1) {
      assert(world.at(8, y) === PARTICLE_WALL && world.at(12, y) === PARTICLE_WALL, `missing wall pair at row ${y}`);
      assert(network.isLadder(9, y) && !network.isLadder(11, y), `left ladder missing at row ${y}`);
      assert(network.isLadder(29, y) && !network.isLadder(27, y), `right ladder missing at row ${y}`);
    }
    assert(world.at(10, 32) === PARTICLE_WALL && world.at(10, 31) === PARTICLE_EMPTY, 'shaft floor should be walled');
    for (let y = 0; y < 9; y += 1) assert(!network.isLadder(9, y) && !network.isLadder(29, y), `ladder above the shaft at row ${y}`);
    assert(network.isLadder(9, 9), 'ladder should reach the ground line so units can climb out');
    return `${left.steps.length + right.steps.length} steps`;
  });

  check('branches start inside a parent tunnel and open a junction', () => {
    const world = flatWorld(80, 60, 10);
    const network = createPixelTunnelNetwork(world);
    const shaft = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 20, y: 8 }, { x: 20, y: 30 }] }).segment;
    const bad = network.plan({ kind: 'tunnel', from: shaft.id, points: [{ x: 40, y: 30 }, { x: 60, y: 30 }] });
    assert(!bad.ok && /inside the parent/.test(bad.reason), 'detached branch should be rejected');
    const buried = network.plan({ kind: 'tunnel', from: 'surface', points: [{ x: 40, y: 20 }, { x: 60, y: 20 }] });
    assert(!buried.ok, 'surface tunnels must start above ground');
    const branch = network.plan({ kind: 'tunnel', from: shaft.id, points: [{ x: 20, y: 30 }, { x: 60, y: 30 }] });
    assert(branch.ok, branch.reason);
    network.step();
    assert(/waiting/.test(branch.segment.state) && branch.segment.dug === 0, 'branch should wait for its parent');
    runUntil(() => network.step(), () => network.idle(), 300);
    for (let y = 29; y <= 31; y += 1) {
      assert(world.at(22, y) === PARTICLE_EMPTY, `junction blocked at 22,${y}`);
      assert(world.at(23, y) === PARTICLE_EMPTY, `branch blocked at 23,${y}`);
    }
    assert(world.at(40, 28) === PARTICLE_WALL && world.at(40, 32) === PARTICLE_WALL, 'branch should be walled');
    assert(network.route({ x: 20, y: 30 }, { x: 58, y: 30 }), 'units should walk through the junction');
  });

  check('routes refuse water and structures and pause at floods', () => {
    const world = flatWorld(60, 60, 10);
    world.excavate(40, 30, 43, 33);
    for (let y = 30; y < 34; y += 1) for (let x = 40; x < 44; x += 1) world.set(x, y, PARTICLE_WATER);
    world.excavate(10, 40, 10, 40);
    assert(world.constructBarrier(10, 40, 40).ok, 'test barrier should be placed');
    const network = createPixelTunnelNetwork(world);
    const wet = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 42, y: 8 }, { x: 42, y: 40 }] }, { dryRun: true });
    assert(!wet.ok && /water/.test(wet.reason), 'water crossing should be rejected');
    const nearWet = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 38, y: 8 }, { x: 38, y: 40 }] }, { dryRun: true });
    assert(!nearWet.ok && /water pressure/.test(nearWet.reason), 'wall line touching water should be rejected');
    const solid = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 10, y: 8 }, { x: 10, y: 45 }] }, { dryRun: true });
    assert(!solid.ok && /structure/.test(solid.reason), 'structure crossing should be rejected');
    const shaft = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 25, y: 8 }, { x: 25, y: 40 }] }).segment;
    runUntil(() => network.step(), () => shaft.dug > 10, 100);
    const face = 9 + shaft.dug;
    world.excavate(25, face, 25, face); world.set(25, face, PARTICLE_WATER);
    const dug = shaft.dug;
    for (let i = 0; i < 5; i += 1) network.step();
    assert(/flooded/.test(shaft.state) && shaft.dug === dug, `flooded face should pause the crew, got ${shaft.state}`);
    assert(world.at(25, face) === PARTICLE_WATER, 'crew must not dig out water');
  });

  check('ladders let 3x3 units climb; no ladder means fall-only', () => {
    const world = flatWorld(40, 60, 10);
    const network = createPixelTunnelNetwork(world);
    network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 20, y: 8 }, { x: 20, y: 40 }] });
    runUntil(() => network.step(), () => network.idle(), 200);
    const top = { x: 20, y: 8 }, bottom = { x: 20, y: 40 };
    const up = network.route(bottom, top);
    assert(up && up.length === 32, 'units should climb the ladder to the surface');
    assert(network.route({ x: 20, y: 8 }, { x: 30, y: 8 }), 'units should step out onto the surface');
    for (let y = 0; y < 60; y += 1) network.removeLadder(19, y);
    assert(network.route(bottom, top) === null, 'without ladders units cannot climb');
    assert(network.route(top, bottom), 'units can still drop down an unladdered shaft');
  });

  const miningWorld = (capacity) => {
    const world = flatWorld(140, 90, 10);
    const network = createPixelTunnelNetwork(world);
    const node = network.addNode({ id: 'ore', owner: 'blue', x: 110, y: 40, remaining: 120 });
    generatePixelTunnelSystem(network, [{ owner: 'blue', entranceX: 20, depth: 15, nodes: [node] }]);
    const mining = createPixelTunnelMining(network, { capacity });
    return { world, network, node, mining };
  };
  check('connecting a tunnel to a node starts mining on that step', () => {
    const { network, node, mining } = miningWorld(100);
    const branch = network.segments[2];
    let dugAtConnect = -1;
    runUntil(() => {
      mining.step();
      if (node.connected && dugAtConnect < 0) dugAtConnect = branch.dug;
    }, () => node.connected, 300);
    const last = branch.steps[branch.steps.length - 1].center;
    assert(dugAtConnect === branch.steps.length, `node should connect on the final branch step, got ${dugAtConnect}`);
    assert(node.face.x === last.x && node.face.y === last.y && last.x === 105 && last.y === 40,
      `connection face should be beside the ore, got ${node.face.x},${node.face.y}`);
    assert(mining.miners.length === 2 && node.remaining === node.initial - 10, 'two miners should take the first loads');
    assert(world_has_exposed_ore(network, node), 'ore face should stay unwalled');
    return `${mining.sites[0].shaft ? 'storage planned' : 'no storage'}`;
  });
  function world_has_exposed_ore(network, node) {
    for (let y = node.y - node.radius; y <= node.y + node.radius; y += 1) {
      for (let x = node.x - node.radius; x <= node.x + node.radius; x += 1) {
        if (network.world.at(x, y) === PARTICLE_WALL) return false;
      }
    }
    return true;
  }

  check('miners dig their own storage, haul HM, and stop when full', () => {
    const { network, node, mining } = miningWorld(30);
    runUntil(() => mining.step(), () => mining.sites.length > 0, 300);
    const site = mining.sites[0];
    assert(site.shaft && site.chamber, 'storage should be planned');
    runUntil(() => network.step(), () => site.shaft.phase === 'line', 20);
    const parked = site.shaft.dug;
    for (let i = 0; i < 40; i += 1) network.step();
    assert(site.shaft.dug === parked, 'storage must only advance while miners dig');
    let audits = 0;
    runUntil(() => {
      mining.step();
      for (const row of mining.audit()) { audits += 1; assert(row.conserved, `HM ledger broke at tick ${network.ticks}`); }
    }, () => site.ready, 1500);
    assert(site.chamber.phase === 'complete' && site.stored === 0, 'storage should be dug before deliveries');
    runUntil(() => mining.step(), () => mining.miners.every((miner) => miner.state === 'storage full'), 3000);
    const [row] = mining.audit();
    assert(row.stored === 30 && row.carried === 0 && row.conserved, `storage should fill exactly, got ${JSON.stringify(row)}`);
    assert(node.remaining === 90, 'mining should stop once storage is full');
    return `${audits} audits, ready at ${site.chamber.completedTick}`;
  });

  const pipelineWorld = (options = {}) => {
    const world = flatWorld(80, 30, 10);
    const pipeline = createPixelPipelineNetwork(world, { dispatchTicks: 1, ...options });
    const stock = { blue: 20, red: 20 }, received = { blue: 0, red: 0 };
    const source = (owner, x) => pipeline.addEndpoint({ id: `${owner}-store`, owner, resource: 'HM', role: 'source', x,
      tapY: 20, available: () => stock[owner], take: (n) => { stock[owner] -= n; return n; } });
    const sink = (owner, x) => pipeline.addEndpoint({ id: `${owner}-cellar`, owner, resource: 'HM', role: 'sink', x,
      tapY: 16, demand: () => 10 - received[owner], give: (_, n) => { received[owner] += n; } });
    return { world, pipeline, stock, received, source, sink };
  };
  check('pipeline has separate HM and SM lines under the surface and only feeds allies', () => {
    const { world, pipeline, received, source, sink } = pipelineWorld();
    source('blue', 5); sink('blue', 30); sink('red', 60);
    pipeline.layTrunk('red', 'HM', 40, 60);
    let smFed = 0;
    pipeline.addEndpoint({ id: 'silo', owner: 'blue', resource: 'SM', role: 'source', x: 8, available: () => 99, take: (n) => n });
    pipeline.addEndpoint({ id: 'house-sm', owner: 'blue', resource: 'SM', role: 'sink', x: 32,
      demand: () => 6 - smFed, give: (_, n) => { smFed += n; } });
    for (const [k, pipe] of pipeline.pipes) {
      const y = Math.floor(k / 80);
      if (pipe.kind === 'line') assert(y === (pipe.resource === 'SM' ? 12 : 15), `${pipe.resource} channel at row ${y}`);
      if (pipe.kind === 'tap' && pipe.resource === 'SM') assert(y <= 12, 'SM taps should rise to the surface');
      if (pipe.kind === 'tap' && pipe.resource === 'HM') assert(y >= 15, 'HM taps should drop underground');
    }
    for (const [k, pipe] of pipeline.pipes) {
      if (pipe.owner !== 'blue') continue;
      for (const [other, otherPipe] of pipeline.pipes) {
        if (otherPipe.owner !== 'blue' || otherPipe.resource === pipe.resource) continue;
        assert(Math.max(Math.abs(k % 80 - other % 80), Math.abs(Math.floor(k / 80) - Math.floor(other / 80))) >= 3,
          'HM and SM channels need their own casings between them');
      }
    }
    for (const [k, shell] of pipeline.casing) {
      const y = Math.floor(k / 80);
      if (k % 80 > 9 && k % 80 < 29) assert(y === (shell.resource === 'SM' ? 11 : 14) || y === (shell.resource === 'SM' ? 13 : 16),
        `${shell.resource} casing at row ${y} should wrap its channel`);
    }
    let threw = false;
    try { pipeline.addEndpoint({ id: 'bad', owner: 'blue', resource: 'HM', role: 'sink', x: 20, demand: () => 1, give() {} }); }
    catch (error) { threw = true; }
    assert(threw, 'HM must be delivered to underground storage, not the surface');
    const water = world.waterCount;
    for (let i = 0; i < 80; i += 1) pipeline.step();
    assert(received.blue === 10 && received.red === 0, `allied delivery only, got ${JSON.stringify(received)}`);
    assert(smFed === 6 && pipeline.ledger.delivered.SM === 6, 'SM should travel on its own line');
    assert(pipeline.ledger.delivered.HM === 10 && world.waterCount === water, 'ledger or water drifted');
  });

  check('HM and SM lines stay apart over cliffs and mountains', () => {
    const world = createParticleWorld(120, 70);
    const ground = (x) => (x < 30 ? 20 : x < 50 ? 14 : x < 60 ? 20 - (x - 50) * 2 : x < 80 ? 6 + Math.abs(x - 70) : 24);
    for (let x = 0; x < 120; x += 1) for (let y = ground(x); y < 70; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const pipeline = createPixelPipelineNetwork(world, { surfaceAt: ground });
    pipeline.layTrunk('blue', 'SM', 2, 117); pipeline.layTrunk('blue', 'HM', 2, 117);
    for (const line of pipeline.lines.values()) {
      assert(line.cells.length >= 116, `${line.resource} line should span the map`);
      for (let i = 1; i < line.cells.length; i += 1) {
        const a = line.cells[i - 1], b = line.cells[i];
        assert(Math.abs(a % 120 - b % 120) + Math.abs(Math.floor(a / 120) - Math.floor(b / 120)) === 1, 'line must be 4-connected');
      }
      for (const k of line.cells) {
        assert(pipeline.depthAt(k % 120, Math.floor(k / 120)) === pipeline.lineDepth[line.resource],
          `${line.resource} line left its depth at ${k % 120},${Math.floor(k / 120)}`);
      }
    }
    return `${[...pipeline.lines.values()].map((line) => `${line.resource} ${line.cells.length}px`).join(', ')}`;
  });

  check('pipeline cargo moves as particles and holds at breaks until the pipe repairs itself', () => {
    const { world, pipeline, received, source, sink } = pipelineWorld({ repairDelay: 40 });
    source('blue', 5); sink('blue', 50);
    pipeline.step();
    assert(pipeline.particles.length === 5 && pipeline.particles.every((particle) => particle.resource === 'HM'),
      'a 5 HM batch should become 5 particles');
    for (let i = 0; i < 4; i += 1) pipeline.step();
    const spots = new Set(pipeline.particles.map((particle) => `${particle.x},${particle.y}`));
    assert(spots.size === 5, 'particles should travel spaced out along the line');
    world.excavate(30, 14, 30, 16);
    for (let i = 0; i < 30; i += 1) pipeline.step();
    assert(received.blue === 0 && pipeline.particles[0].state === 'waiting at pipe break', 'lead particle should wait at the break');
    assert(pipeline.particles.slice(1).every((particle) => particle.state === 'queued'), 'following particles should queue');
    assert(pipeline.breaks.size === 3 && pipeline.ledger.dispatched.HM === pipeline.ledger.delivered.HM + pipeline.inTransit('HM'),
      'breaks should be tracked without losing cargo');
    for (let i = 0; i < 80; i += 1) pipeline.step();
    assert(world.at(30, 15) === PARTICLE_TERRAIN && world.at(30, 14) === PARTICLE_TERRAIN && world.at(30, 16) === PARTICLE_TERRAIN,
      'channel and casing should be refilled');
    assert(pipeline.breaks.size === 0 && pipeline.ledger.repaired === 3, `3 repairs expected, got ${pipeline.ledger.repaired}`);
    assert(received.blue === 10, `self-repaired pipe should finish deliveries, got ${received.blue}`);
  });

  check('self-repair leaves tunnel crossings open and waits out floods', () => {
    const { world, pipeline, source, sink } = pipelineWorld({ repairDelay: 5, isBridge: (x) => x === 40 });
    source('blue', 5); sink('blue', 50);
    world.excavate(40, 15, 40, 15);
    world.excavate(20, 15, 20, 15); world.set(20, 15, PARTICLE_WATER);
    for (let i = 0; i < 30; i += 1) pipeline.step();
    assert(world.at(40, 15) === PARTICLE_EMPTY && !pipeline.breaks.has(15 * 80 + 40), 'a tunnel bridge is not a break');
    const flooded = pipeline.breaks.get(15 * 80 + 20);
    assert(flooded && /flooded/.test(flooded.state) && world.at(20, 15) === PARTICLE_WATER, 'water must not be destroyed');
  });

  check('dig tool starts from the surface or a tunnel wall', () => {
    const world = flatWorld(80, 60, 10);
    const network = createPixelTunnelNetwork(world);
    const down = network.digSpec({ type: 'surface', x: 20, y: 10 }, { x: 22, y: 40 });
    assert(down.from === 'surface' && down.points[0].y === 8 && down.points[1].x === 20, 'steep targets dig a shaft first');
    const shaft = network.plan(down).segment;
    runUntil(() => network.step(), () => network.idle(), 200);
    const anchors = network.digAnchors();
    assert(anchors.some((anchor) => anchor.type === 'surface' && anchor.x === 50 && anchor.y === 10), 'surface line glows');
    const side = anchors.find((anchor) => anchor.type === 'wall' && anchor.x === 18 && anchor.y === 30);
    assert(side && side.segment === shaft.id, 'tunnel outer walls should be anchors');
    const branch = network.digSpec(side, { x: 2, y: 30 });
    assert(branch.from === shaft.id && branch.points[0].x === 20 && branch.points[1].y === 30, 'side wall branches run sideways');
    const floor = network.digSpec({ type: 'wall', x: 21, y: 42 }, { x: 60, y: 50 });
    assert(floor.from === shaft.id && floor.points[0].x === floor.points[1].x && floor.points[1].y === 50, 'floor walls branch downward first');
    assert(network.plan(branch).ok && network.plan(floor).ok, 'both branches should be valid');
    runUntil(() => network.step(), () => network.idle(), 400);
    assert(network.route({ x: 20, y: 8 }, { x: 58, y: 50 }), 'units should reach the new branch end');
  });

  check('a ground-level tunnel can pierce a mountain so troops walk through', () => {
    const world = createParticleWorld(120, 70);
    const ground = (x) => 40 - Math.max(0, 30 - 2 * Math.abs(x - 60));
    for (let x = 0; x < 120; x += 1) for (let y = ground(x); y < 70; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const network = createPixelTunnelNetwork(world);
    assert(network.route({ x: 10, y: 38 }, { x: 110, y: 38 }) === null, 'the mountain should block troops before digging');
    const spec = network.digSpec({ type: 'surface', x: 30, y: 40 }, { x: 95, y: 39 });
    assert(spec.points.length === 2 && spec.points[0].y === 38 && spec.points[1].y === 38, 'pass should run level with the ground');
    const plan = network.plan(spec);
    assert(plan.ok, plan.reason);
    runUntil(() => network.step(), () => network.idle(), 300);
    assert(world.at(60, 36) === PARTICLE_WALL && world.at(60, 40) === PARTICLE_WALL, 'pass should be lined inside the mountain');
    for (let y = 37; y <= 39; y += 1) assert(world.at(95, y) === PARTICLE_EMPTY && world.at(97, y) === PARTICLE_EMPTY, 'far portal should be open');
    const path = network.route({ x: 10, y: 38 }, { x: 110, y: 38 });
    assert(path, 'troops should walk through the mountain');
    return `${path.length} steps`;
  });

  check('dig routes snap to tunnels or the surface and reroute around water', () => {
    const world = flatWorld(100, 70, 10);
    const network = createPixelTunnelNetwork(world);
    const shaft = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 20, y: 8 }, { x: 20, y: 40 }] }).segment;
    const other = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 80, y: 8 }, { x: 80, y: 40 }] }).segment;
    runUntil(() => network.step(), () => network.idle(), 400);
    const wall = network.digAnchors().find((a) => a.type === 'wall' && a.segment === shaft.id && a.x === 22 && a.y === 30);
    const joined = network.routeDig(wall, { x: 76, y: 31 });
    assert(joined.ok && joined.snap.type === 'tunnel' && joined.snap.segment === other.id, 'targets near a tunnel should snap to it');
    const end = joined.spec.points[joined.spec.points.length - 1];
    assert(end.x === 80 && end.y === 31, `snap should land on the other centre line, got ${JSON.stringify(end)}`);
    const exit = network.routeDig(wall, { x: 50, y: 4 });
    assert(exit.ok && exit.snap.type === 'surface' && exit.spec.points[exit.spec.points.length - 1].y === 8, 'air targets snap to a ground exit');
    world.excavate(45, 26, 55, 34);
    for (let y = 26; y <= 34; y += 1) for (let x = 45; x <= 55; x += 1) world.set(x, y, PARTICLE_WATER);
    const wet = network.routeDig(wall, { x: 70, y: 30 }, {}, { snap: false });
    assert(wet.ok && wet.rerouted && /water/.test(wet.problem), `water should force a detour, got ${wet.reason}`);
    for (const cell of network.centerline(wet.spec.points)) {
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        assert(world.at(cell.x + dx, cell.y + dy) !== PARTICLE_WATER, 'detour must keep its walls out of the water');
      }
    }
    return `detour ${wet.spec.points.length - 1} legs`;
  });

  check('tunnels build straight through open caves and wall them off', () => {
    const world = flatWorld(80, 50, 10);
    const network = createPixelTunnelNetwork(world);
    world.excavate(30, 22, 40, 34);
    const plan = network.plan({ kind: 'tunnel', from: 'surface', points: [{ x: 10, y: 8 }, { x: 10, y: 28 }, { x: 60, y: 28 }] });
    assert(plan.ok, plan.reason);
    runUntil(() => network.step(), () => network.idle(), 400);
    for (const x of [32, 35, 38]) {
      assert(world.at(x, 26) === PARTICLE_WALL && world.at(x, 30) === PARTICLE_WALL, `cave gap at x ${x} should be walled`);
    }
    assert(network.route({ x: 12, y: 28 }, { x: 58, y: 28 }), 'units should walk across the cave on the new floor');
    const room = network.plan({ kind: 'chamber', from: 'standalone', rect: { left: 28, top: 32, right: 34, bottom: 36 } });
    assert(!room.ok && /cave/.test(room.reason), 'sealed storage still refuses caves');
  });

  check('lab world generates deterministically and supplies both factions', () => {
    const a = createPixelTunnelLabWorld(7), b = createPixelTunnelLabWorld(7), c = createPixelTunnelLabWorld(8);
    assert(a.plans.every((plan) => plan.ok), 'generated plans should all be valid');
    for (const building of a.buildings.filter((entry) => entry.consumes.HM)) {
      assert(building.cellar && building.cellar.rect.top - 1 > building.ground + a.pipeline.lineDepth.HM,
        `${building.id} needs an underground HM cellar`);
      assert(a.world.at(building.cellar.rect.left, building.cellar.rect.top) === PARTICLE_EMPTY &&
        a.world.at(building.cellar.rect.left, building.cellar.rect.top - 1) === PARTICLE_WALL, 'cellar should be dug and lined');
    }
    const water = a.world.waterCount;
    for (let i = 0; i < 1500; i += 1) { a.step(); b.step(); }
    const cellsA = new Uint8Array(360 * 180), cellsB = new Uint8Array(360 * 180), cellsC = new Uint8Array(360 * 180);
    a.world.copyCells(cellsA); b.world.copyCells(cellsB); c.world.copyCells(cellsC);
    assert(cellsA.every((value, i) => value === cellsB[i]), 'same seed should give identical worlds');
    assert(!cellsA.every((value, i) => value === cellsC[i]), 'different seeds should differ');
    assert(a.mining.sites.length === 2 && a.mining.sites.every((site) => site.ready), 'both storages should be ready');
    assert(a.mining.audit().every((row) => row.conserved), 'HM must be conserved');
    assert(a.pipeline.ledger.delivered.HM > 0 && a.pipeline.ledger.delivered.SM > 0, 'HM and SM should be delivered');
    const cellarHM = a.buildings.reduce((sum, building) => sum + (building.cellar ? building.cellar.stored + building.consumed.HM : 0), 0);
    assert(cellarHM === a.pipeline.ledger.delivered.HM, 'all delivered HM should land in underground cellars');
    assert(a.world.waterCount === water, 'farm silos must not drain the basin');
    return `HM ${a.pipeline.ledger.delivered.HM}, SM ${a.pipeline.ledger.delivered.SM}`;
  });

  check('dig routes never climb over the surface into open sky', () => {
    const skyCells = (network, spec) => {
      const { world, radius } = network;
      return network.centerline(spec.points).filter((cell) =>
        cell.y < Math.min(network.surface[cell.x], world.surfaceRow(cell.x)) - radius - 1 &&
        !network.carvedAt(cell.x, cell.y));
    };
    // Reported case: a valley start aimed at a mountain peak used to run a leg straight up through the sky.
    const world = createParticleWorld(160, 90);
    const ground = (x) => 50 - Math.max(0, 40 - 3 * Math.abs(x - 110));
    for (let x = 0; x < 160; x += 1) for (let y = ground(x); y < 90; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    const network = createPixelTunnelNetwork(world);
    const peak = network.routeDig({ type: 'surface', x: 30, y: 50 }, { x: 110, y: 6 });
    assert(!peak.spec || !skyCells(network, peak.spec).length, 'peak route should stay under the surface');
    const sky = network.plan({ kind: 'tunnel', from: 'surface', points: [{ x: 30, y: 48 }, { x: 30, y: 8 }, { x: 108, y: 8 }] }, { dryRun: true });
    assert(!sky.ok && /over the surface/.test(sky.reason), 'plans through open sky must be refused');
    const shaft = network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 20, y: 48 }, { x: 20, y: 75 }] }).segment;
    for (let i = 0; i < 400 && !network.idle(); i += 1) network.step();
    const wall = network.digAnchors().find((a) => a.type === 'wall' && a.segment === shaft.id && a.x === 22 && a.y === 70);
    const high = network.routeDig(wall, { x: 70, y: 5 }, {}, { snap: false });
    assert(!high.ok || !skyCells(network, high.spec).length, 'wall branches aimed at the sky must not leave the ground');
    // Randomized sweep across generated lab worlds: every accepted route stays at or below portal height.
    let accepted = 0, refused = 0;
    for (const seed of [3, 7, 11]) {
      const lab = createPixelTunnelLabWorld(seed), net = lab.network, w = lab.world;
      let state = seed * 2654435761 >>> 0;
      const random = () => { state = Math.imul(state ^ (state >>> 15), 2246822519) + 0x9e3779b9 >>> 0; return state / 4294967296; };
      const anchors = net.digAnchors();
      for (let trial = 0; trial < 14; trial += 1) {
        const anchor = anchors[Math.floor(random() * anchors.length)];
        const tx = 2 + Math.floor(random() * (w.width - 4));
        const ty = random() < 0.5 ? Math.floor(random() * Math.max(1, w.surfaceRow(tx))) : Math.floor(random() * (w.height - 2));
        const result = net.routeDig(anchor, { x: tx, y: ty }, {}, { limit: 60000, snap: random() < 0.7 });
        if (!result.ok) { refused += 1; continue; }
        accepted += 1;
        const bad = skyCells(net, result.spec);
        assert(!bad.length, `seed ${seed}: route from ${anchor.type} (${anchor.x}, ${anchor.y}) to (${tx}, ${ty}) ` +
          `climbs into the sky at (${bad[0] && bad[0].x}, ${bad[0] && bad[0].y})`);
      }
    }
    assert(accepted > 0, 'the sweep should accept some routes');
    return `${accepted} accepted routes underground, ${refused} refused`;
  });

  if (typeof createPixelSurfaceRoads === 'function') {
    const roadAudit = (world, road) => {
      for (let i = 0; i < road.columns.length; i += 1) {
        const c = road.columns[i];
        assert([PARTICLE_TERRAIN, PARTICLE_WALL].includes(world.at(c.x, c.deck)), `deck missing at x ${c.x}`);
        for (let h = 1; h <= 3; h += 1) assert(world.at(c.x, c.deck - h) === PARTICLE_EMPTY, `no headroom at x ${c.x}`);
        if (i) assert(Math.abs(c.deck - road.columns[i - 1].deck) <= 1, `step too tall at x ${c.x}`);
      }
    };
    check('surface roads grade hills by cutting bumps and filling dips', () => {
      const world = createParticleWorld(120, 60);
      const ground = (x) => 30 - (x >= 40 && x <= 50 ? 6 : 0) + (x >= 70 && x <= 76 ? 4 : 0);
      for (let x = 0; x < 120; x += 1) for (let y = ground(x); y < 60; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      const roads = createPixelSurfaceRoads(world);
      const plan = roads.plan({ owner: 'blue', from: { x: 10 }, to: { x: 110 } });
      assert(plan.ok && plan.grade === 0.5, plan.reason);
      assert(plan.cut > 0 && plan.filled > 0, 'the bump should be cut and the dip filled');
      roads.buildNow(plan.road);
      roadAudit(world, plan.road);
      const decks = plan.road.columns.map((c) => c.deck);
      for (let i = 6; i < decks.length; i += 1) assert(Math.abs(decks[i] - decks[i - 6]) <= 4, 'grade should stay near 1:2');
      return `cut ${plan.cut}px, filled ${plan.filled}px`;
    });

    check('surface roads bridge water and deep ravines without draining them', () => {
      const world = flatWorld(140, 60, 30);
      world.excavate(30, 30, 60, 44);
      for (let y = 33; y <= 44; y += 1) for (let x = 30; x <= 60; x += 1) world.set(x, y, PARTICLE_WATER);
      world.excavate(85, 30, 96, 42);
      const water = world.waterCount;
      const roads = createPixelSurfaceRoads(world);
      const plan = roads.plan({ owner: 'blue', from: { x: 10 }, to: { x: 125 } });
      assert(plan.ok, plan.reason);
      const bridge = plan.columns.filter((c) => c.bridge);
      assert(bridge.some((c) => c.x === 45) && bridge.some((c) => c.x === 90), 'pool and ravine should both be bridged');
      assert(plan.columns.filter((c) => c.x >= 30 && c.x <= 60).every((c) => c.deck <= 31), 'deck must stay above the water');
      roads.buildNow(plan.road);
      for (let i = 0; i < 60; i += 1) { world.step(); roads.step(); }
      roadAudit(world, plan.road);
      assert(world.waterCount === water, 'bridges must not drain the pool');
      const pillars = bridge.filter((c) => c.pillar.length);
      assert(pillars.length && pillars.every((c) => c.x > 60) && world.at(pillars[0].x, pillars[0].deck + 3) === PARTICLE_WALL,
        'ravine bridge should stand on pillars (none in the water)');
      return `${bridge.length} bridge px, ${pillars.length} pillars`;
    });

    check('surface roads hatch over tunnel mouths and cross no other roads', () => {
      const world = flatWorld(120, 60, 20);
      const network = createPixelTunnelNetwork(world);
      network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 60, y: 18 }, { x: 60, y: 45 }] });
      runUntil(() => network.step(), () => network.idle(), 400);
      const roads = createPixelSurfaceRoads(world, { network });
      const over = roads.plan({ owner: 'blue', from: { x: 40 }, to: { x: 80 } }, { dryRun: true });
      assert(over.ok && over.hatches === 3 && over.columns.every((c) => c.deck === 20), `road should hatch the shaft mouth flush, got ${over.reason}`);
      const a = roads.plan({ owner: 'blue', from: { x: 5 }, to: { x: 40 } });
      assert(a.ok, a.reason);
      const b = roads.routeRoad({ x: 42, y: 20 }, { x: 54, y: 20 });
      assert(b.ok && b.from.type === 'road' && b.from.x === 40, 'starting next to a road end should snap and join it');
      const crossing = roads.plan({ owner: 'blue', from: { x: 20 }, to: { x: 50 } }, { dryRun: true });
      assert(!crossing.ok && /road/.test(crossing.reason), 'roads must not overlap except at joined ends');
    });

    check('road ends snap strongly so any road can be extended, and joined ends stop snapping', () => {
      const world = flatWorld(160, 60, 20);
      const roads = createPixelSurfaceRoads(world);
      const a = roads.plan({ owner: 'blue', from: { x: 10 }, to: { x: 60 } });
      assert(a.ok, a.reason);
      roads.buildNow(a.road);
      const far = roads.snapPoint({ x: 70, y: 8 });
      assert(far.type === 'road' && far.x === 60 && far.end === 'end', `mouse 10px off the end should snap to it, got ${JSON.stringify(far)}`);
      const onDeck = roads.snapPoint({ x: 50, y: 19 });
      assert(onDeck.type === 'road' && onDeck.x === 60, 'hovering the deck snaps to the nearest open end');
      const ext = roads.routeRoad({ x: 66, y: 12 }, { x: 110, y: 20 });
      assert(ext.ok && ext.from.type === 'road' && ext.from.x === 60, `extension should start at the road end: ${ext.reason}`);
      const b = roads.plan(ext.spec);
      assert(b.ok && b.columns[0].deck === a.columns[a.columns.length - 1].deck, 'extension continues at the same deck');
      roads.buildNow(b.road);
      const next = roads.snapPoint({ x: 62, y: 20 });
      assert(next.type === 'road' && next.x === 110, `the joined end must not snap again; got ${JSON.stringify(next)}`);
      return `extended ${a.columns.length} + ${b.columns.length} px`;
    });

    check('a road over a shaft mouth lays a flush hatch with a manhole, trims the ladder and repairs itself', () => {
      const world = flatWorld(80, 50, 20);
      const network = createPixelTunnelNetwork(world);
      network.plan({ kind: 'shaft', from: 'surface', points: [{ x: 40, y: 18 }, { x: 40, y: 34 }] });
      runUntil(() => network.step(), () => network.idle(), 400);
      const roads = createPixelSurfaceRoads(world, { network });
      const r = roads.plan({ owner: 'blue', from: { x: 10 }, to: { x: 70 } });
      assert(r.ok, r.reason);
      roads.buildNow(r.road);
      for (let x = 39; x <= 41; x += 1) {
        assert(world.at(x, 20) === PARTICLE_WALL && roads.hatchAt(x, 20), `hatch deck missing at ${x}`);
        for (let y = 17; y < 20; y += 1) assert(!network.isLadder(x, y), 'no ladder may stand up through the road');
      }
      const lids = [39, 40, 41].filter((x) => roads.hatchAt(x, 20).manhole);
      assert(lids.length === 1 && network.isLadder(lids[0], 21), 'one manhole lid sits on top of the ladder');
      assert(network.isCarved(40, 25) && world.at(40, 25) === PARTICLE_EMPTY, 'the shaft below stays open');
      world.blast(40, 20, 2);
      runUntil(() => roads.step(), () => [39, 40, 41].every((x) => world.at(x, 20) === PARTICLE_WALL), 400);
      return `hatch ${r.hatches} px, manhole at x=${lids[0]}`;
    });

    check('bridges over water take the asian, gothic or modern style without touching the river', () => {
      const out = [];
      const expect = { modern: ['arch', 'cable', 'pier'], gothic: ['voussoir', 'keystone', 'spire', 'baluster'],
        asian: ['roof', 'redTimber', 'pier', 'bracket', 'eave'] };
      for (const style of PIXEL_BRIDGE_STYLES) {
        for (const span of [60, 18]) {
          const W = span + 40, world = flatWorld(W, 60, 30);
          for (let x = 20; x < 20 + span; x += 1) {
            for (let y = 30; y < 44; y += 1) world.excavate(x, y, x, y);
            for (let y = 34; y < 44; y += 1) world.set(x, y, PARTICLE_WATER);
          }
          const water = world.waterCount;
          const roads = createPixelSurfaceRoads(world, { styleOf: () => style });
          const r = roads.plan({ owner: 'blue', from: { x: 5 }, to: { x: W - 6 } });
          assert(r.ok && r.road.style === style && r.bridges > 0, `${style} ${span}: ${r.reason}`);
          roads.buildNow(r.road);
          const decor = roads.bridgeDecor(r.road), parts = new Set(decor.map((c) => c.part));
          const wanted = span < 22 && style === 'asian' ? ['archRed', 'roof', 'stone'] : span < 22 && style === 'gothic' ? ['voussoir', 'baluster'] : expect[style];
          for (const part of wanted) assert(parts.has(part), `${style} ${span}px bridge is missing ${part}`);
          for (const c of decor) {
            const m = world.at(c.x, c.y);
            assert(m === PARTICLE_EMPTY || m === PARTICLE_WATER, `${style} decor sits on solid ground at ${c.x},${c.y}`);
            assert(r.road.deck.get(c.x) !== c.y, 'decor never replaces the deck');
          }
          assert(world.waterCount === water, `${style} bridge drained the river`);
          assert(decor.some((c) => c.y < r.road.deck.get(Math.min(Math.max(c.x, 5), W - 6)) - 4), `${style} bridge has a superstructure`);
          if (span > 22) out.push(`${style} ${decor.length}`);
        }
      }
      const other = createPixelSurfaceRoads(flatWorld(60, 40, 20), { styleOf: (o) => (o === 'red' ? 'gothic' : 'modern') });
      assert(other.plan({ owner: 'red', from: { x: 5 }, to: { x: 50 } }).road.style === 'gothic', 'styleOf picks the faction style');
      return out.join(', ');
    });

    check('a surface road runs through a dug mountain pass', () => {
      const world = createParticleWorld(120, 70);
      const ground = (x) => 40 - Math.max(0, 30 - 2 * Math.abs(x - 60));
      for (let x = 0; x < 120; x += 1) for (let y = ground(x); y < 70; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      const network = createPixelTunnelNetwork(world);
      const roads = createPixelSurfaceRoads(world, { network });
      const over = roads.routeRoad({ x: 10, y: 40 }, { x: 110, y: 40 });
      assert(!over.ok || Math.min(...over.columns.map((c) => c.deck)) < 30, 'without a pass the road must climb over the peak');
      network.plan(network.digSpec({ type: 'surface', x: 30, y: 40 }, { x: 95, y: 39 }));
      runUntil(() => network.step(), () => network.idle(), 300);
      const through = roads.routeRoad({ x: 10, y: 40 }, { x: 110, y: 40 });
      assert(through.ok && through.tunnel >= 20, `road should follow the pass floor, got ${through.reason}`);
      const plan = roads.plan(through.spec);
      roads.buildNow(plan.road);
      roadAudit(world, plan.road);
      assert(plan.road.deck.get(60) === 40 && plan.road.grade === 0.5, 'deck should be the level pass floor');
      return `${through.tunnel} px inside the pass`;
    });

    check('roads repair blast damage and only speed up allies', () => {
      const world = flatWorld(100, 50, 25);
      const roads = createPixelSurfaceRoads(world);
      const plan = roads.plan({ owner: 'blue', from: { x: 10 }, to: { x: 90 } });
      roads.buildNow(plan.road);
      assert(roads.multiplier(48, 50, 25, 'blue') === 1.25, 'allied units should be faster on the road');
      assert(roads.multiplier(48, 50, 25, 'red') === 1, 'enemy units get no road bonus');
      assert(roads.multiplier(92, 94, 25, 'blue') === 1, 'no bonus off the road');
      world.blast(50, 26, 3);
      roads.step(); roads.step(); roads.step(); roads.step();
      assert(roads.breaks.size > 0 && roads.multiplier(48, 50, 25, 'blue') === 1, 'damage should be detected and cancel the bonus');
      runUntil(() => { world.step(); roads.step(); }, () => !roads.breaks.size, 400);
      roadAudit(world, plan.road);
      assert(roads.multiplier(48, 50, 25, 'blue') === 1.25 && roads.ledger.repaired > 0, 'repaired road restores the bonus');
      return `${roads.ledger.repaired} px repaired`;
    });

    check('lab world lays a road along each faction building strip', () => {
      const lab = createPixelTunnelLabWorld(4);
      assert(lab.roads.roads.length === 2 && lab.roads.roads.every((road) => road.phase === 'complete'), 'both roads should be built');
      for (const road of lab.roads.roads) {
        roadAudit(lab.world, road);
        for (const building of lab.buildings.filter((b) => b.owner === road.owner)) {
          assert(road.left <= building.left && road.right >= building.right, `${building.id} should front the road`);
          assert(road.deck.get(building.left + 1) === building.ground, `${building.id} pad should stay level`);
        }
      }
      for (let i = 0; i < 200; i += 1) lab.step();
      const pop = lab.buildings.find((b) => b.kind === 'population');
      assert(lab.roads.markingAt(pop.left + 2) === 'white' && lab.roads.markingAt(lab.mountain.left + 10) === 'yellow',
        'urban stretches get white markings, open country yellow');
      assert(lab.roads.roads.every((road) => road.columns.every((c) => lab.roads.intact(c.x))), 'roads must survive the pipeline and miners');
    });
  }
  return results;
}
