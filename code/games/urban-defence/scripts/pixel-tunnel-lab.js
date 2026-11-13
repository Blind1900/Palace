function createPixelTunnelFixture() {
  const world = createParticleWorld(360, 180, { skipEmptyChunks: true });
  for (let x = 0; x < world.width; x += 1) {
    const basin = x >= 116 && x <= 143;
    for (let y = basin ? 45 : 36; y < world.height; y += 1) world.set(x, y, PARTICLE_TERRAIN);
    if (basin) for (let y = 28; y < 45; y += 1) world.set(x, y, PARTICLE_WATER);
  }
  const initialTerrain = world.terrainCount, initialWater = world.waterCount;
  const node = { x: 312, y: 77, initial: 300, remaining: 300 };
  const chamber = { x: 224, y: 121, capacity: 100, stored: 0 };
  const entrance = { x: 38, y: 77 }, miners = [];
  const coreStockpile = { x: 38, y: 31, hm: 50, initial: 50 };
  let excavated = 0, withdrawn = 0, ticks = 0, connected = false, issuedDebris = 0;
  const logistics = createPixelConstructionLogistics(world, [
    { kind: 'tunnel', x: chamber.x, y: chamber.y, available: () => chamber.stored,
      take: (amount) => withdraw(amount) },
    { kind: 'core', x: coreStockpile.x, y: coreStockpile.y, available: () => coreStockpile.hm,
      take: (amount) => {
        if (amount > coreStockpile.hm) return { ok: false, reason: 'insufficient core HM' };
        coreStockpile.hm -= amount; return { ok: true };
      } },
  ]);
  function dig(left, top, right, bottom) {
    excavated += world.excavate(left, top, right, bottom);
  }
  function connect() {
    dig(35, 30, 41, 80);
    dig(35, 74, 315, 80);
    dig(221, 77, 227, 121);
    dig(211, 113, 242, 131);
    if (!route(entrance, node).length || !route(node, chamber).length) {
      return { ok: false, reason: 'resource connection requires dry clear entrance and storage routes' };
    }
    connected = true;
    if (!miners.length) for (let i = 0; i < 2; i += 1) {
      const miner = { id: i + 1, x: node.x, y: node.y, carried: 0, route: [],
        state: 'harvesting on connection', destination: 'node', harvestTicks: 0 };
      miners.push(miner);
      harvest(miner);
      miner.route = route(miner, chamber);
    }
    audit();
    return { ok: true };
  }
  function clear(x, y) {
    if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return false;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (world.at(x + dx, y + dy) !== PARTICLE_EMPTY) return false;
    }
    return true;
  }
  function route(from, to) {
    if (!clear(from.x, from.y) || !clear(to.x, to.y)) return [];
    const start = from.y * world.width + from.x, goal = to.y * world.width + to.x;
    const parents = new Int32Array(world.width * world.height); parents.fill(-1);
    const queue = [start]; parents[start] = start;
    for (let index = 0; index < queue.length; index += 1) {
      const cell = queue[index], x = cell % world.width, y = Math.floor(cell / world.width);
      if (cell === goal) {
        const result = [];
        for (let next = goal; next !== start; next = parents[next]) {
          result.push({ x: next % world.width, y: Math.floor(next / world.width) });
        }
        return result.reverse();
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
        if (nx < 1 || ny < 1 || nx >= world.width - 1 || ny >= world.height - 1 ||
            parents[next] !== -1 || !clear(nx, ny)) continue;
        parents[next] = cell; queue.push(next);
      }
    }
    return [];
  }
  function audit() {
    const carried = miners.reduce((total, miner) => total + miner.carried, 0);
    if (world.terrainCount + excavated !== initialTerrain || world.waterCount !== initialWater ||
        node.remaining + chamber.stored + carried + withdrawn !== node.initial ||
        world.debrisCount !== issuedDebris) throw new Error('Tunnel material/HM/water conservation failed');
    const transport = logistics.audit();
    if (world.barrierCount + world.constructionCount !== transport.spent ||
        coreStockpile.initial !== coreStockpile.hm + transport.coreDrawn || withdrawn < transport.tunnelDrawn) {
      throw new Error('Delivered seed/road material conservation failed');
    }
    return { remaining: node.remaining, stored: chamber.stored, carried, withdrawn, excavated,
      water: world.waterCount, totalHM: node.initial };
  }
  function harvest(miner) {
    const reserved = miners.reduce((total, other) => total + other.carried, 0);
    const amount = Math.min(5, node.remaining, chamber.capacity - chamber.stored - reserved);
    if (amount <= 0) return;
    node.remaining -= amount; miner.carried += amount;
    miner.destination = 'chamber'; miner.route = []; miner.harvestTicks = 0;
    miner.state = 'carrying HM to chamber';
  }
  function step() {
    ticks += 1; world.step();
    for (const miner of miners) {
      const target = miner.destination === 'node' ? node : chamber;
      if (!clear(miner.x, miner.y)) {
        miner.route = []; miner.state = 'waiting: flooded or blocked current position'; continue;
      }
      if (miner.x === target.x && miner.y === target.y) {
        if (miner.destination === 'node') {
          const reserved = miners.reduce((total, other) => total + other.carried, 0);
          if (!node.remaining) { miner.state = 'resource depleted'; continue; }
          if (chamber.stored + reserved >= chamber.capacity) { miner.state = 'waiting: storage full'; continue; }
          miner.state = 'harvesting'; miner.harvestTicks += 1;
          if (miner.harvestTicks < 30) continue;
          miner.harvestTicks = 0;
          harvest(miner);
        } else {
          const amount = Math.min(miner.carried, chamber.capacity - chamber.stored);
          chamber.stored += amount; miner.carried -= amount;
          if (miner.carried) { miner.state = 'waiting: storage full'; continue; }
          miner.destination = 'node'; miner.route = [];
        }
      }
      if (ticks % 2 !== 0) continue;
      if (miner.route.length && !clear(miner.route[0].x, miner.route[0].y)) miner.route = [];
      if (!miner.route.length) {
        if (ticks % 30 !== 0) { miner.state = 'planning route'; continue; }
        const destination = miner.destination === 'node' ? node : chamber;
        miner.route = route(miner, destination);
        if (!miner.route.length) { miner.state = 'waiting: no dry clear route'; continue; }
      }
      const next = miner.route.shift();
      miner.x = next.x; miner.y = next.y;
      miner.state = miner.carried ? 'carrying HM to chamber' : 'travelling to resource';
    }
    logistics.step();
    if (ticks % 60 === 0) audit();
  }
  function withdraw(amount) {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Invalid HM withdrawal');
    if (amount > chamber.stored) return { ok: false, reason: 'insufficient stored HM' };
    chamber.stored -= amount; withdrawn += amount; return { ok: true, amount };
  }
  return {
    world, node, chamber, entrance, miners, connect, step, route, clear, audit, logistics, coreStockpile,
    get ticks() { return ticks; }, get connected() { return connected; },
    breach() { dig(127, 44, 132, 78); },
    block() {
      for (let y = 74; y <= 80; y += 1) if (world.at(180, y) === PARTICLE_EMPTY) {
        const result = world.emitDebris(180, y);
        if (!result.ok) throw new Error(`Tunnel obstruction failed: ${result.reason}`);
        issuedDebris += 1;
      }
    },
    withdraw(amount) {
      const result = withdraw(amount); audit(); return result;
    },
  };
}

if (typeof document !== 'undefined' && document.getElementById('tunnel-canvas')) {
  (function () {
    const canvas = document.getElementById('tunnel-canvas'), ctx = canvas.getContext('2d');
    const image = ctx.createImageData(canvas.width, canvas.height), cells = new Uint8Array(canvas.width * canvas.height);
    const status = document.getElementById('tunnel-status'), notice = document.getElementById('tunnel-notice');
    let fixture = createPixelTunnelFixture(), running = false, previous = null, elapsed = 0, failed = false;
    function draw() {
      fixture.world.copyCells(cells);
      const colors = [0xff1d1910, 0xff384b44, 0xffc8ac1f, 0xff7be7bc, 0xff5990c4, 0xffb1f9ef, 0xff197bbf];
      const data = new Uint32Array(image.data.buffer);
      for (let i = 0; i < cells.length; i += 1) data[i] = colors[cells[i]];
      ctx.putImageData(image, 0, 0);
      ctx.fillStyle = '#bd90d6'; ctx.fillRect(fixture.node.x - 3, fixture.node.y - 3, 7, 7);
      if (fixture.connected) {
        ctx.strokeStyle = '#8bc6d6'; ctx.strokeRect(212.5, 114.5, 28, 15);
        ctx.fillStyle = '#d6a953'; ctx.fillRect(214, 125, 25 * fixture.chamber.stored / fixture.chamber.capacity, 3);
      }
      for (const miner of fixture.miners) {
        ctx.fillStyle = miner.carried ? '#e6cd72' : '#8bc6d6'; ctx.fillRect(miner.x - 1, miner.y - 1, 3, 3);
      }
      ctx.fillStyle = '#a7c6ff'; ctx.fillRect(fixture.coreStockpile.x - 2, fixture.coreStockpile.y - 2, 5, 5);
      for (const job of fixture.logistics.jobs) if (!job.placed) {
        ctx.fillStyle = '#645e74'; for (const cell of job.cells) ctx.fillRect(cell.x, cell.y, 1, 1);
      }
      ctx.fillStyle = '#ffb78b';
      for (const agent of fixture.logistics.transporters) ctx.fillRect(agent.x, agent.y, 1, 1);
      const audit = fixture.audit();
      status.textContent = `Tick ${fixture.ticks}; excavation ${audit.excavated} terrain cells (free, yields no HM).\n` +
        `HM node ${audit.remaining} + chamber ${audit.stored}/100 + carried ${audit.carried} + withdrawn ${audit.withdrawn} = ${audit.totalHM}.\n` +
        `Water conserved: ${audit.water} cells.\n` +
        fixture.miners.map((miner) => `Miner ${miner.id}: ${miner.state}; load ${miner.carried}/5`).join('\n') +
        `\nExisting core stockpile: ${fixture.coreStockpile.hm}/50 HM; transport ledger: ` +
        JSON.stringify(fixture.logistics.audit()) + '\n' +
        fixture.logistics.jobs.map((job) => `${job.kind}: ${job.state}; delivered ${job.delivered}/${job.required} HM`).join('\n');
    }
    function action(operation) {
      try { operation(); draw(); }
      catch (error) {
        failed = true; running = false; status.textContent = `STOPPED: ${error.message}`; console.error(error);
      }
      document.getElementById('tunnel-run').textContent = running ? 'Pause' : 'Run';
    }
    document.getElementById('tunnel-dig').onclick = () => action(() => {
      const result = fixture.connect();
      notice.textContent = result.ok ? 'Resource connected: harvesting started immediately; miners carry HM to storage.' :
        `Cannot start mining: ${result.reason}.`;
    });
    document.getElementById('tunnel-run').onclick = () => action(() => { if (!failed) running = !running; previous = null; });
    document.getElementById('tunnel-step').onclick = () => action(() => { if (!failed) for (let i = 0; i < 120; i += 1) fixture.step(); });
    document.getElementById('tunnel-breach').onclick = () => action(() => fixture.breach());
    document.getElementById('tunnel-block').onclick = () => action(() => fixture.block());
    document.getElementById('tunnel-withdraw').onclick = () => action(() => {
      const result = fixture.withdraw(25); notice.textContent = result.ok ? 'Withdrew 25 stored HM.' : `Cannot withdraw: ${result.reason}.`;
    });
    document.getElementById('tunnel-seed').onclick = () => action(() => {
      const kind = document.getElementById('tunnel-build-kind').value;
      const x = { population: 12, military: 60, farm: 24, road: 46 }[kind];
      const cells = Array.from({ length: kind === 'road' ? 10 : 3 }, (_, index) => ({ x: x + index, y: 35 }));
      const result = fixture.logistics.request(kind, cells);
      notice.textContent = result.ok ? `${kind} requested: waiting for physical HM delivery.` : `Cannot request: ${result.reason}.`;
    });
    document.getElementById('tunnel-reset').onclick = () => action(() => {
      fixture = createPixelTunnelFixture(); failed = false; running = false; previous = null; elapsed = 0; notice.textContent = '';
    });
    function frame(time) {
      if (running && !failed && !document.hidden && previous !== null) {
        elapsed += Math.min(100, time - previous);
        action(() => {
          while (elapsed >= 1000 / 60) { fixture.step(); elapsed -= 1000 / 60; }
        });
      }
      previous = time; requestAnimationFrame(frame);
    }
    window.pixelTunnelLab = { get fixture() { return fixture; }, get failed() { return failed; } };
    draw(); requestAnimationFrame(frame);
  }());
}
