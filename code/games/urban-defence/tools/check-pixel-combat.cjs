const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const files = ['scripts\\particle-world.js', 'assets\\unit-reference.js', 'assets\\tank-reference.js',
  'assets\\hopper-reference.js', 'assets\\jet-reference.js', 'assets\\bullet-reference.js',
  'scripts\\pixel-unit.js', 'scripts\\pixel-unit-vehicles.js', 'scripts\\pixel-unit-combat.js',
  'scripts\\pixel-combat-fixture.js'];
const source = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
for (const file of [...files, 'scripts\\pixel-combat-lab.js', 'scripts\\pixel-generated-combat.js',
  'scripts\\pixel-unit-comparison-lab.js', 'scripts\\pixel-construction-render.js',
  'scripts\\pixel-city-map-lab.js', 'scripts\\pixel-building-style-lab.js', 'scripts\\pixel-population-scale.js',
  'scripts\\pixel-map-construction.js', 'tests\\pixel-combat-fixture.js']) {
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
const context = vm.createContext({ console, URLSearchParams });
vm.runInContext(source + '\n' + fs.readFileSync(path.join(root, 'tests\\pixel-combat-fixture.js'), 'utf8'), context);
const checks = vm.runInContext('runPixelCombatFixtureChecks()', context);
console.log(checks.join('\n'));
const output = { textContent: '', dataset: {} };
context.location = { search: '?check=combat' };
context.document = { getElementById: () => output };
vm.runInContext(fs.readFileSync(path.join(root, 'tests\\pixel-unit-comparison.js'), 'utf8'), context);
console.log(output.textContent);
if (checks.some((line) => line.startsWith('FAIL')) || Number(output.dataset.failed)) process.exitCode = 1;
context.location.search = '?check=friendly%20units%20overlap';
vm.runInContext(fs.readFileSync(path.join(root, 'tests\\pixel-unit-comparison.js'), 'utf8'), context);
console.log(output.textContent);
if (Number(output.dataset.failed)) process.exitCode = 1;
if (process.argv.some((argument) => argument === '--benchmark' || argument === '--browser') && !process.exitCode) {
  benchmark().catch((error) => { console.error(error); process.exitCode = 1; });
}

async function benchmark() {
  const http = require('node:http'), { spawn } = require('node:child_process');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]).replaceAll('/', '\\'));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : 'text/plain');
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'urban-combat-edge-'));
  const child = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-extensions',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('Edge debugging endpoint timeout')), 15000);
      child.stderr.on('data', (data) => {
        buffer += data; const found = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (found) { clearTimeout(timer); resolve(found[1]); }
      });
      child.on('error', reject);
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let serial = 0;
    const pending = new Map(), errors = [];
    socket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
      if (data.id && pending.has(data.id)) {
        const entry = pending.get(data.id); pending.delete(data.id);
        if (data.error) entry.reject(new Error(JSON.stringify(data.error))); else entry.resolve(data.result);
      }
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const target = await send('Target.createTarget', { url: 'about:blank' });
    const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }), session = attached.sessionId;
    await send('Runtime.enable', {}, session);
    await send('Page.enable', {}, session);
    await send('Page.bringToFront', {}, session);
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/pixel-combat-lab.html` }, session);
    const evaluate = async (expression, awaitPromise = false) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, session);
      if (result.exceptionDetails) {
        const exception = result.exceptionDetails.exception;
        throw new Error(exception && exception.description ? exception.description : result.exceptionDetails.text);
      }
      return result.result.value;
    };
    const deadline = Date.now() + 20000;
    while (!await evaluate('!!window.pixelCombatLab')) {
      if (Date.now() > deadline) throw new Error('Combat lab did not load');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log('BROWSER CHECKS\n' + await evaluate('document.getElementById("combat-results").textContent'));
    for (const button of ['left', 'middle']) {
      const pan = await evaluate(`(async () => {
        const canvas = document.getElementById('combat-canvas'), viewport = canvas.parentElement;
        if (document.getElementById('combat-run').textContent === 'Pause') document.getElementById('combat-run').click();
        const zoom = document.getElementById('combat-zoom');
        zoom.value = '2'; zoom.dispatchEvent(new Event('change'));
        viewport.scrollLeft = 100; viewport.scrollTop = 10;
        viewport.scrollIntoView({ block: 'start' });
        await new Promise(requestAnimationFrame);
        const bounds = viewport.getBoundingClientRect();
        if (document.elementFromPoint(bounds.left + 100, bounds.top + 100) !== canvas) {
          throw new Error('Pan test coordinates do not target the canvas');
        }
        return { x: bounds.left + 100, y: bounds.top + 100, left: viewport.scrollLeft, top: viewport.scrollTop,
          fired: window.pixelCombatLab.fixture.combat.inspect().fired };
      })()`, true);
      const modifiers = button === 'left' ? 8 : 0, buttons = button === 'left' ? 1 : 4;
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pan.x, y: pan.y,
        button, buttons, modifiers, clickCount: 1 }, session);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pan.x - 40, y: pan.y - 30,
        buttons, modifiers }, session);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pan.x - 40, y: pan.y - 30,
        button, buttons: 0, modifiers, clickCount: 1 }, session);
      console.log(await evaluate(`(() => {
        const lab = window.pixelCombatLab, viewport = document.getElementById('combat-canvas').parentElement;
        if (viewport.scrollLeft !== ${pan.left + 40} || viewport.scrollTop !== ${pan.top + 30} ||
            lab.fixture.combat.inspect().fired !== ${pan.fired}) throw new Error('Drag-to-pan moved incorrectly or fired: ' +
              JSON.stringify({ left: viewport.scrollLeft, top: viewport.scrollTop,
                expectedLeft: ${pan.left + 40}, expectedTop: ${pan.top + 30},
                fired: lab.fixture.combat.inspect().fired, expectedFired: ${pan.fired} }));
        document.getElementById('combat-fit').click();
        return 'PASS browser ${button === 'left' ? 'Shift-drag' : 'middle-drag'} panning without firing';
      })()`));
    }
    console.log(await evaluate(`(() => {
      const lab = window.pixelCombatLab, element = (id) => document.getElementById(id);
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      for (const id of ['combat-spawning', 'combat-devices', 'combat-fighting']) {
        element(id).checked = false; element(id).dispatchEvent(new Event('change'));
      }
      element('combat-reset').click(); element('combat-run').click();
      assert(!lab.failed && !element('combat-step').disabled, 'reset/pause handler failed');
      const tick = lab.fixture.ticks;
      element('combat-step').click();
      assert(lab.fixture.ticks === tick + 1, 'manual step failed');
      for (const kind of ['tank', 'hopper', 'jet']) {
        element('combat-kind').value = kind; element('combat-spawn').click();
        assert(lab.fixture.units.some((unit) => unit.owner === 'blue' && unit.kind === kind), 'manual spawn failed: ' + kind);
      }
      element('combat-spawn').click();
      assert(element('combat-spawn-status').textContent.includes('four living'), 'manual cap was bypassed');
      element('combat-owner').value = 'red'; element('combat-kind').value = 'tank'; element('combat-spawn').click();
      assert(lab.fixture.units.some((unit) => unit.owner === 'red' && unit.kind === 'tank'), 'red spawn failed');
      const shooter = element('combat-unit'), target = element('combat-target');
      shooter.value = lab.fixture.units.find((unit) => unit.owner === 'red' && unit.kind === 'tank').id;
      shooter.dispatchEvent(new Event('change'));
      assert(Array.from(target.options).every((option) => option.value.startsWith('blue-')), 'target list includes friendlies');
      assert(element('combat-selected').textContent.includes('HP 400/400'), 'selected HP readout failed');
      let fired = lab.fixture.combat.inspect({ sprites: false }).fired;
      element('combat-fire-target').click();
      assert(lab.fixture.combat.inspect({ sprites: false }).fired === fired &&
        element('combat-fire-status').textContent.includes('beyond shell arc range'), 'tank shell ignored its arc range');
      element('combat-kind').value = 'trooper'; element('combat-spawn').click();
      shooter.value = lab.fixture.units.find((unit) => unit.owner === 'red' && unit.kind === 'trooper').id;
      shooter.dispatchEvent(new Event('change'));
      element('combat-fire-target').click();
      assert(lab.fixture.combat.inspect({ sprites: false }).fired === fired + 1, 'selected red weapon did not fire');
      element('combat-fire-target').click();
      assert(lab.fixture.combat.inspect({ sprites: false }).fired === fired + 1 &&
        element('combat-fire-status').textContent.startsWith('Cannot fire:'), 'manual fire bypassed reload');
      for (let i = lab.fixture.units.length - 1; i >= 0; i -= 1) {
        const entry = lab.fixture.units[i];
        if (entry.owner !== 'blue') continue;
        lab.fixture.combat.unregister(entry.id); lab.fixture.units.splice(i, 1);
      }
      element('combat-fire-target').click();
      assert(element('combat-fire-target').disabled && !target.options.length &&
        element('combat-fire-status').textContent.includes('no longer alive'), 'stale target was not handled');
      const canvas = element('combat-canvas');
      element('combat-zoom').value = '2'; element('combat-zoom').dispatchEvent(new Event('change'));
      assert(canvas.getBoundingClientRect().width === 2200 && canvas.width === 4400 &&
        lab.fixture.world.width === 1100, 'zoom changed physical size or lost fine artwork resolution');
      element('combat-zoom').value = 'fit'; element('combat-zoom').dispatchEvent(new Event('change'));
      assert(canvas.getBoundingClientRect().width <= canvas.parentElement.clientWidth, 'fit viewport overflow');
      const bounds = canvas.getBoundingClientRect(), viewport = canvas.parentElement;
      const clientX = bounds.left + viewport.clientWidth / 2, clientY = bounds.top + Math.min(100, viewport.clientHeight / 2);
      const before = getPixelUnitAimPoint(canvas, lab.fixture.world, { clientX, clientY });
      canvas.dispatchEvent(new WheelEvent('wheel', { clientX, clientY, deltaY: -600, cancelable: true }));
      const after = getPixelUnitAimPoint(canvas, lab.fixture.world, { clientX, clientY });
      assert(canvas.getBoundingClientRect().width > bounds.width && Math.abs(before.x - after.x) <= 1 &&
        Math.abs(before.y - after.y) <= 1, 'wheel zoom did not preserve cursor world position');
      assert(element('combat-zoom-status').textContent.endsWith('%'), 'wheel zoom status missing');
      const zoomed = canvas.getBoundingClientRect().width;
      canvas.dispatchEvent(new WheelEvent('wheel', { clientX, clientY, deltaY: -600, ctrlKey: true, cancelable: true }));
      assert(canvas.getBoundingClientRect().width === zoomed, 'Ctrl+wheel hijacked browser zoom');
      element('combat-fit').click();
      assert(viewport.scrollLeft === 0 && viewport.scrollTop === 0 && element('combat-zoom').value === 'fit',
        'fit action did not reset zoom and pan');
      element('combat-core').click();
      assert(lab.fixture.combat.inspect({ sprites: false }).shots.length > 0, 'core impact handler failed');
      for (let i = 0; i < 30; i += 1) element('combat-step').click();
      assert(element('combat-impacts').textContent.includes('debris:') &&
        element('combat-impacts').textContent.includes('red-core-test'), 'real impact log was not displayed');
      element('combat-benchmark').click(); element('combat-reset').click();
      assert(element('combat-measurement').textContent.includes('cancelled'), 'benchmark reset did not cancel');
      assert(!lab.failed, 'UI actions stopped the lab');
      return 'PASS browser controls: reset, pause, step, manual types/factions, spawn cap, shooter/target selection, HP, reload, stale target, cursor-centered wheel zoom, Ctrl+wheel, fit view, core impact and benchmark cancellation';
    })()`));
    console.log(await evaluate(`(() => {
      const lab = window.pixelCombatLab, element = (id) => document.getElementById(id);
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      for (const id of ['combat-spawning', 'combat-devices', 'combat-fighting']) element(id).checked = false;
      element('combat-transporting').checked = false;
      element('combat-scenario').value = 'dry-route';
      element('combat-scenario').dispatchEvent(new Event('change')); element('combat-run').click();
      element('combat-owner').value = 'blue'; element('combat-kind').value = 'tank'; element('combat-spawn').click();
      const tank = lab.fixture.units.find((entry) => entry.owner === 'blue' && entry.kind === 'tank');
      lab.fixture.combat.fallingDebrisDamage(tank.id, 5); element('combat-step').click();
      const countRed = () => {
        const canvas = element('combat-canvas'), data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let index = 0; index < data.length; index += 4) {
          const r = data[index], g = data[index + 1], b = data[index + 2];
          if ((r === 255 && g === 53 && b === 53) ||
              (Math.abs(r - 224) <= 1 && Math.abs(g - 85) <= 1 && Math.abs(b - 89) <= 1)) count += 1;
        }
        return count;
      };
      assert(countRed() > 0, 'real damage did not render a bright-red sprite flash');
      for (let tick = 0; tick < 9; tick += 1) element('combat-step').click();
      assert(countRed() === 0, 'cached red sprite remained after flash expiry');
      for (const id of ['combat-spawning', 'combat-fighting', 'combat-transporting']) element(id).checked = true;
      element('combat-reset').click(); element('combat-run').click();
      for (let tick = 0; tick < 1800; tick += 1) lab.fixture.step();
      for (let tick = 1800; tick < 7200; tick += 120) {
        const events = lab.fixture.combat.inspect({ sprites: false }).deathEvents;
        if (events.some((event) => event.effect === 'red-burst') &&
            events.some((event) => event.effect === 'sparks')) break;
        for (let step = 0; step < 120; step += 1) lab.fixture.step();
      }
      element('combat-step').click();
      const state = lab.fixture.combat.inspect();
      assert(lab.fixture.transport.loaded >= 6 && lab.fixture.transport.deployed >= 2,
        'hands-off combat did not load multiple passengers and deploy from tanks');
      assert(state.deathEvents.some((event) => event.effect === 'red-burst') &&
        state.deathEvents.some((event) => event.effect === 'sparks'),
        'real combat did not produce both death effects: ' + JSON.stringify({ ticks: state.ticks,
          fired: state.fired, events: state.deathEvents, units: lab.fixture.units.map((entry) => ({
            kind: entry.kind, owner: entry.owner, health: lab.fixture.combat.health(entry.id).health,
            x: entry.unit.inspect().x, y: entry.unit.inspect().y, path: entry.path, tactic: entry.tactic })) }));
      assert(element('combat-behavior').textContent.includes('rear hatch') &&
        element('combat-behavior').textContent.includes('Deaths'), 'behavior readout missing real events');
      assert(!lab.failed && state.deathParticles.length <= 512, 'automatic behavior stopped or exceeded effect cap');
      return 'PASS browser behavior: quarter-scale sprites, bright-red hit flash and expiry, hands-off tank loading, rear-hatch deployment, real troop/machinery deaths and bounded effects';
    })()`));
    console.log(await evaluate(`(() => {
      const world = createParticleWorld(1100, 700), combat = createPixelUnitCombat(world, PIXEL_BULLET_REFERENCE);
      const art = window.pixelCombatLab.fixture.artworks.get('trooper');
      for (let index = 0; index < 11; index += 1) {
        const unit = createPixelTerrainUnit(world, art, { x: 500, y: 300, ownerId: 'blue' });
        combat.register('cost-' + index, unit, 'trooper', 'blue');
        combat.destroyUnit('cost-' + index); combat.unregister('cost-' + index);
      }
      if (combat.inspect().deathParticles.length !== 512) throw new Error('Worst-case effect pool was not full');
      const samples = [];
      for (let tick = 0; tick < 40; tick += 1) {
        const start = performance.now(); combat.step(); samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return '512-particle physics-only cost (local headless Edge): mean ' +
        (samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(3) +
        ' ms/tick, p95 ' + samples[Math.floor(samples.length * 0.95)].toFixed(3) +
        ' ms/tick. This excludes rendering and full-world physics.';
    })()`));
    console.log(await evaluate(`(() => {
      const world = createParticleWorld(80, 80), canvas = document.createElement('canvas');
      canvas.width = 80; canvas.height = 80;
      const ctx = canvas.getContext('2d');
      const layers = createPixelBuildingLayers(world, () => [{ owner: 'blue', cells: [],
        left: 20, right: 60, top: 20, bottom: 60, intact: () => true,
        windows: [{ x: 30, y: 35, width: 10, height: 10 }] }]);
      const state = { kind: 'tank', x: 25, y: 25, width: 25, height: 25 };
      const paint = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(25, 25, 25, 25); };
      const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, 80, 80);
      const before = JSON.stringify(world.snapshot());
      withPixelBuildingOcclusion(ctx, world, state, 'blue', layers, paint);
      if (pixel(27, 27).join() !== '18,52,86,255' || pixel(32, 38)[0] < 150 ||
          pixel(32, 38)[0] === 255) throw new Error('Vehicle was not occluded by facade or seen through tinted glass');
      withPixelBuildingOcclusion(ctx, world, { ...state, kind: 'trooper' }, 'blue', layers, paint);
      if (pixel(27, 27)[0] !== 255) throw new Error('Infantry was incorrectly forced behind building');
      if (JSON.stringify(world.snapshot()) !== before) throw new Error('Facade clipping changed physical cells');
      return 'PASS browser foreground facade / tinted-window vehicle visibility without physics changes';
    })()`));
    console.log(await evaluate(`(() => {
      const lab = window.pixelCombatLab, element = (id) => document.getElementById(id);
      element('combat-scenario').value = 'original';
      for (const id of ['combat-spawning', 'combat-transporting']) element(id).checked = true;
      for (const id of ['combat-fighting', 'combat-devices']) element(id).checked = false;
      element('combat-reset').click(); element('combat-run').click();
      let carrying = false;
      for (let tick = 0; tick < 3000 && lab.fixture.airlift.inspect().deliveries < 2; tick += 1) {
        lab.fixture.step();
        carrying = carrying || lab.fixture.units.some((entry) =>
          entry.kind === 'hopper' && entry.unit.inspect({ sprites: false }).transportPhase === 'cross');
      }
      element('combat-step').click();
      const result = lab.fixture.airlift.inspect();
      if (result.pickups < 2 || result.deliveries < 2 || !carrying || lab.failed ||
          !element('combat-behavior').textContent.includes('safe landings')) {
        throw new Error('Original hands-off scenario did not complete opposing loaded airlifts: ' +
          JSON.stringify({ result, units: lab.fixture.units.map((entry) => ({
            kind: entry.kind, x: entry.unit.inspect().x, y: entry.unit.inspect().y,
            status: entry.airliftStatus, tactic: entry.tactic })) }));
      }
      lab.fixture.audit();
      return 'PASS browser original hills/water: automatic hopper production, loaded-tank pickup, composed carry pose and opposing safe landings with conserved material';
    })()`));
    if (process.argv.includes('--benchmark')) {
      if (process.argv.includes('--profile')) {
        await send('Profiler.enable', {}, session);
        await send('Profiler.start', {}, session);
      }
      await evaluate('window.pixelCombatLab.startBenchmark()');
      await new Promise((resolve) => setTimeout(resolve, 31000));
      const result = await evaluate('window.pixelCombatLab.measurement');
      if (!result) throw new Error('Active benchmark did not finish');
      console.log('ACTIVE HEADLESS EDGE BENCHMARK\n' + JSON.stringify(result, null, 2));
      if (process.argv.includes('--profile')) {
        const { profile } = await send('Profiler.stop', {}, session);
        const counts = new Map();
        for (const id of profile.samples) counts.set(id, (counts.get(id) || 0) + 1);
        console.log('CPU SAMPLE HOTSPOTS\n' + JSON.stringify(profile.nodes.map((node) => ({
          function: node.callFrame.functionName, url: node.callFrame.url.split('/').pop(),
          line: node.callFrame.lineNumber + 1, samples: counts.get(node.id) || 0,
        })).sort((a, b) => b.samples - a.samples).slice(0, 15), null, 2));
      }
      if (!result.meets60FPSBudget) process.exitCode = 1;
    }
    if (process.argv.includes('--supply')) {
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/particle-lab.html` }, session);
      const worldDeadline = Date.now() + 30000;
      while (!await evaluate('Boolean(document.getElementById("results") && document.getElementById("results").dataset.failed)')) {
        if (Date.now() > worldDeadline) throw new Error('Particle world checks did not initialize');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      console.log(await evaluate(`(() => {
        const results = document.getElementById('results');
        if (Number(results.dataset.failed)) throw new Error(results.textContent);
        return 'PASS existing particle world regression suite: ' + results.textContent.split('\\n').length + ' checks';
      })()`));
      if (process.argv.includes('--construction')) {
        await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/pixel-construction-lab.html` }, session);
        const constructionDeadline = Date.now() + 900000;
        while (!await evaluate('Boolean(document.getElementById("results") && document.getElementById("results").dataset.failed)')) {
          if (Date.now() > constructionDeadline) throw new Error('Construction checks did not finish');
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        console.log(await evaluate(`(() => {
          const results = document.getElementById('results');
          if (Number(results.dataset.failed)) throw new Error(results.textContent.split('\\n').filter((line) => line.startsWith('FAIL')).join('\\n'));
          return 'PASS pixel construction suite: ' + results.textContent.split('\\n').length + ' checks';
        })()`));
      }
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/pixel-tunnel-lab.html` }, session);
      const tunnelDeadline = Date.now() + 30000;
      while (!await evaluate('!!window.pixelTunnelLab')) {
        if (Date.now() > tunnelDeadline) throw new Error('Tunnel lab did not load');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      console.log(await evaluate(`(() => {
        const lab = window.pixelTunnelLab, button = (id) => document.getElementById(id);
        const assert = (ok, message) => { if (!ok) throw new Error(message); };
        assert(!button('tunnel-results').textContent.includes('FAIL'), 'tunnel model checks failed in browser');
        button('tunnel-dig').click();
        assert(lab.fixture.node.remaining === 290 && lab.fixture.audit().carried === 10,
          'connection UI did not harvest immediately');
        for (let i = 0; i < 5; i += 1) button('tunnel-step').click();
        assert(lab.fixture.chamber.stored >= 10, 'step UI failed physical delivery');
        for (const kind of ['population', 'military', 'farm', 'road']) {
          button('tunnel-build-kind').value = kind; button('tunnel-seed').click();
        }
        assert(lab.fixture.logistics.jobs.length === 4 && !lab.fixture.world.barrierCount,
          'request UI failed or skipped delivery');
        for (let i = 0; i < 25; i += 1) button('tunnel-step').click();
        assert(lab.fixture.logistics.jobs.every((job) => job.placed === job.required), 'UI jobs did not finish');
        button('tunnel-withdraw').click();
        assert(button('tunnel-notice').textContent.includes('25 stored HM'), 'withdraw UI failed');
        button('tunnel-run').click(); assert(button('tunnel-run').textContent === 'Pause', 'run handler failed');
        button('tunnel-run').click(); assert(button('tunnel-run').textContent === 'Run', 'pause handler failed');
        button('tunnel-breach').click(); button('tunnel-block').click(); button('tunnel-step').click();
        assert(!lab.failed, 'flood/obstruction UI stopped the lab');
        button('tunnel-reset').click();
        assert(!lab.fixture.miners.length && !lab.fixture.logistics.jobs.length && !lab.fixture.ticks,
          'reset left cargo/jobs behind');
        return 'PASS tunnel browser controls: immediate mining, delivery, all seed/road kinds, withdraw, run/pause, flood, obstruction and reset';
      })()`));
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/pixel-city-map-lab.html?fullMap=1` }, session);
      const cityDeadline = Date.now() + 60000;
      while (!await evaluate('Boolean(document.getElementById("supply-status") && document.getElementById("supply-status").textContent.includes("Total upkeep"))')) {
        if (Date.now() > cityDeadline) throw new Error('Full-map supply UI did not initialize: ' +
          await evaluate('document.getElementById("message").textContent + " " + Array.from(document.querySelectorAll("pre")).map((node) => node.textContent).join("\\n").split("\\n").filter((line) => line.startsWith("FAIL")).join(" | ")'));
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      console.log(await evaluate(`(() => {
        const message = document.getElementById('message').textContent;
        if (message.includes('stopped') || message.includes('FAIL')) throw new Error(message);
        const checks = document.getElementById('world-results').textContent;
        if (!checks.includes('PASS compact population') || checks.includes('FAIL')) throw new Error(checks);
        return 'PASS full-map supply UI initializes with actual generation, rendering and SM shortages';
      })()`));
      console.log(await evaluate(`(() => {
        const signatures = new Map(), teamColors = { left: '#58a6ff', right: '#ef6473', neutral: '#bac5aa' };
        for (const owner of ['left', 'right', 'neutral']) for (const style of ['asian', 'gothic', 'modern']) {
          const world = createParticleWorld(160, 150), canvas = document.createElement('canvas');
          canvas.width = 320; canvas.height = 300;
          const tower = createPixelPopulationFrame([40, 48, 56], [125, 125, 125], 105, 7, undefined, style);
          const snapshot = world.snapshot();
          for (const cell of tower.cells) snapshot.cells[cell.y * world.width + cell.x] = PARTICLE_BARRIER;
          world.restore(snapshot);
          const entry = { building: { owner, style, poles: [40, 48, 56], floorHeight: 7 },
            seedPlacement: [{ x: 40, groundY: 125 }],
            scenario: { world, plan: tower.cells, finished: true, coreDestroyed: false,
              inspectCore: () => ({ cells: [] }) } };
          const renderer = createPixelConstructionRenderer(canvas, 160, 150);
          const before = JSON.stringify(world.snapshot());
          renderer.markArchitecture([entry], { [owner]: style });
          if (JSON.stringify(world.snapshot()) !== before) throw new Error('Architecture rendering changed physical material');
          const data = canvas.getContext('2d').getImageData(0, 0, 320, 300).data;
          const color = parseInt(teamColors[owner].slice(1), 16);
          let found = false, hash = 2166136261;
          for (let index = 0; index < data.length; index += 4) {
            const rgb = data[index] << 16 | data[index + 1] << 8 | data[index + 2];
            if (data[index + 3] && rgb === color) found = true;
            hash = Math.imul(hash ^ rgb, 16777619);
          }
          if (!found) throw new Error(owner + ' ' + style + ' missing visible team accents');
          if (!signatures.has(owner)) signatures.set(owner, new Set());
          signatures.get(owner).add(hash);
        }
        if ([...signatures.values()].some((values) => values.size !== 3)) throw new Error('Styles have identical rendered designs');
        return 'PASS all nine team/style combinations render distinct architecture with visible team accents and unchanged material';
      })()`));
      if (process.argv.includes('--city-frames')) {
        const timing = await evaluate(`(async () => {
          const samples = [];
          document.getElementById('pause').click();
          let previous = await new Promise(requestAnimationFrame);
          for (let index = 0; index < 120; index += 1) {
            const time = await new Promise(requestAnimationFrame);
            samples.push(time - previous); previous = time;
          }
          document.getElementById('pause').click();
          const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
          samples.sort((a, b) => a - b);
          return { frames: samples.length, fps: 1000 / mean, p95FrameMs: samples[Math.floor(samples.length * 0.95)],
            scope: 'full-map initial construction, fine-resolution drawing and shared simulation' };
        })()`, true);
        if (!timing || timing.frames !== 120 || !Number.isFinite(timing.fps)) throw new Error('Invalid full-map frame measurement');
        console.log('FULL-MAP FRAME SAMPLE\n' + JSON.stringify(timing, null, 2));
      }
      if (process.argv.includes('--city-stress')) {
        await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false }, session);
        await evaluate(`(() => {
          for (const id of ['world-spawning', 'world-fighting', 'world-devices']) {
            const box = document.getElementById(id);
            if (!box.checked) box.click();
          }
          document.getElementById('enable-upkeep').disabled || document.getElementById('enable-upkeep').click();
          document.getElementById('build-preview').click();
          return true;
        })()`);
        // Finish bases through real simulated construction, then wait for spawned units to engage.
        const warmup = Date.now();
        while (Date.now() - warmup < 240000 && await evaluate('document.getElementById("build-preview").disabled')) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        await evaluate(`(() => {
          if (document.getElementById('pause').getAttribute('aria-pressed') !== 'true') document.getElementById('pause').click();
          return document.getElementById('pause').getAttribute('aria-pressed') === 'true';
        })()`);
        while (Date.now() - warmup < 360000) {
          const combat = await evaluate(`(() => {
            const text = document.getElementById('world-combat-status').textContent;
            return { units: Number((text.match(/Units (\\d+)/) || [])[1] || 0), fired: Number((text.match(/fired (\\d+)/) || [])[1] || 0) };
          })()`);
          if (combat.units >= 6 && combat.fired > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        console.log(`FULL-MAP STRESS WARM-UP ${Math.round((Date.now() - warmup) / 1000)}s: ` +
          await evaluate('document.getElementById("message").textContent'));
        await send('Profiler.enable', {}, session);
        await send('Profiler.start', {}, session);
        const stress = await evaluate(`(async () => {
          const samples = [], before = document.getElementById('world-combat-status').textContent;
          let previous = await new Promise(requestAnimationFrame);
          for (let index = 0; index < 600; index += 1) {
            const time = await new Promise(requestAnimationFrame);
            samples.push(time - previous); previous = time;
          }
          const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
          const sorted = [...samples].sort((a, b) => a - b);
          return { frames: samples.length, viewport: innerWidth + 'x' + innerHeight, fps: 1000 / mean,
            p95FrameMs: sorted[Math.floor(sorted.length * 0.95)], worstFrameMs: sorted[sorted.length - 1],
            framesOver16_7ms: samples.filter((value) => value > 1000 / 60 + 0.5).length,
            failed: document.getElementById('message').textContent.startsWith('City experiment stopped'),
            simulationRunning: document.getElementById('pause').getAttribute('aria-pressed') === 'true',
            combatAtStart: before.split('. ').slice(1, 2).join(''),
            combatAtEnd: document.getElementById('world-combat-status').textContent.split('. ').slice(1, 2).join('') };
        })()`, true);
        const { profile } = await send('Profiler.stop', {}, session);
        const counts = new Map();
        for (const id of profile.samples) counts.set(id, (counts.get(id) || 0) + 1);
        const total = profile.samples.length;
        console.log('FULL-MAP COMBAT STRESS\n' + JSON.stringify(stress, null, 2));
        console.log('FULL-MAP SELF-TIME HOTSPOTS\n' + profile.nodes.map((node) => ({
          name: `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber + 1}`,
          samples: counts.get(node.id) || 0 })).reduce((merged, node) => {
          const found = merged.find((item) => item.name === node.name);
          if (found) found.samples += node.samples; else merged.push({ ...node });
          return merged;
        }, []).sort((a, b) => b.samples - a.samples).slice(0, 20)
          .map((node) => `${(100 * node.samples / total).toFixed(1).padStart(5)}%  ${node.name}`).join('\n'));
        // Attribute native canvas calls to the script function that issued them.
        const parentOf = new Map(), byId = new Map(profile.nodes.map((node) => [node.id, node]));
        for (const node of profile.nodes) for (const child of node.children || []) parentOf.set(child, node.id);
        const callers = new Map();
        for (const node of profile.nodes) {
          const name = node.callFrame.functionName;
          if (!['fillRect', 'fill', 'rect', 'drawImage', 'stroke', 'strokeRect'].includes(name) || node.callFrame.url) continue;
          let caller = byId.get(parentOf.get(node.id));
          while (caller && !caller.callFrame.url) caller = byId.get(parentOf.get(caller.id));
          const label = `${name} <- ${caller ? `${caller.callFrame.functionName || '(anonymous)'} ${caller.callFrame.url.split('/').pop()}:${caller.callFrame.lineNumber + 1}` : '?'}`;
          callers.set(label, (callers.get(label) || 0) + (counts.get(node.id) || 0));
        }
        console.log('FULL-MAP CANVAS CALLERS\n' + [...callers].sort((a, b) => b[1] - a[1]).slice(0, 12)
          .map(([label, samples]) => `${(100 * samples / total).toFixed(1).padStart(5)}%  ${label}`).join('\n'));
        if (stress.failed || !stress.simulationRunning || stress.fps < 60 || stress.p95FrameMs > 1000 / 60 + 0.5) process.exitCode = 1;
      }
    }
    console.log('Browser exceptions: ' + errors.length);
    if (errors.length) process.exitCode = 1;
    await send('Browser.close');
  } finally {
    if (socket) socket.close();
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}
