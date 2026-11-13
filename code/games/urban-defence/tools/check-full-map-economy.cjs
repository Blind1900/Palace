// Headless check of the mined full-map HM economy (?fullMap=1&economy=mined).
// Usage: node tools/check-full-map-economy.cjs [--ticks=N]
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const totalTicks = Number((process.argv.find((arg) => arg.startsWith('--ticks=')) || '--ticks=12000').slice(8));

async function main() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]).replaceAll('/', path.sep));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' :
        file.endsWith('.css') ? 'text/css' : 'text/plain');
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'urban-economy-edge-'));
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
      if (data.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(data.params.exceptionDetails).slice(0, 600));
      if (data.id && pending.has(data.id)) {
        const entry = pending.get(data.id); pending.delete(data.id);
        if (data.error) entry.reject(new Error(JSON.stringify(data.error))); else entry.resolve(data.result);
      }
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const target = await send('Target.createTarget', { url: 'about:blank' });
    const session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await send('Runtime.enable', {}, session);
    await send('Page.enable', {}, session);
    const evaluate = async (expression, awaitPromise = false) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, session);
      if (result.exceptionDetails) {
        const exception = result.exceptionDetails.exception;
        throw new Error(exception && exception.description ? exception.description : result.exceptionDetails.text);
      }
      return result.result.value;
    };
    const nodeArg = process.argv.find((arg) => arg.startsWith('--nodeHM='));
    const crewArg = process.argv.find((arg) => arg.startsWith('--crew='));
    const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
    // The terrain generator uses Math.random; a seed makes a map reproducible across runs.
    if (seedArg) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let s = ${Number(seedArg.slice(7)) >>> 0} || 1;
        Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();` }, session);
    }
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/pixel-city-map-lab.html?fullMap=1&economy=mined` +
      (nodeArg ? `&nodeHM=${Number(nodeArg.slice(9))}` : '') +
      (crewArg ? `&crew=${encodeURIComponent(crewArg.slice(7))}` : '') +
      (process.argv.includes('--no-caves') ? '&caves=0' : '') +
      (process.argv.includes('--tunnels=ai') ? '&tunnels=ai' : '') }, session);
    const deadline = Date.now() + 90000;
    while (!await evaluate('Boolean(window.pixelCityMapLab && window.pixelCityMapLab.economy) || document.getElementById("message").textContent.includes("stopped")')) {
      if (Date.now() > deadline) throw new Error('Mined economy did not initialize: ' + await evaluate('document.getElementById("message").textContent'));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const message = await evaluate('document.getElementById("message").textContent');
    if (message.includes('stopped')) {
      const failures = await evaluate('(document.getElementById("world-results") || {}).textContent || ""');
      throw new Error(message + '\n' + failures.split('\n').filter((line) => line.startsWith('FAIL')).join('\n'));
    }
    const summary = `(() => {
      const lab = window.pixelCityMapLab, state = lab.economy.inspect();
      return { tick: state.ticks, ok: state.ok, checks: state.checks, factions: state.factions, hmDepth: state.hmDepth,
        tunnelHM: state.tunnelHM, orders: state.orders,
        sites: state.sites, withdrawn: state.withdrawn, inTransit: state.inTransit, stored: state.stored,
        transferred: state.transferred, unserved: state.unserved,
        miners: [...new Set(state.miners)], tunnels: state.tunnels.filter((t) => t.phase !== 'complete').map((t) => t.label + ':' + t.state),
        cellars: state.cellars.map((c) => 'B' + (c.index + 1) + ' ' + c.owner + ' ' + c.stored + '/' + c.capacity + ' hm' + c.buildingHM + ' ' + c.state),
        buildings: lab.city.entries.map((e, i) => 'B' + (i + 1) + (e.scenario.paidGrowth ? ' mined' : ' funded') +
          ' growth ' + (e.scenario.foundationGrowth.complete ? 'done' : 'pending') + ' finished ' + e.scenario.finished +
          ' spent ' + e.scenario.spent + ' growthPaid ' + e.scenario.growthPaid + ' received ' + e.scenario.received + ' hm ' + e.scenario.hm) };
    })()`;
    console.log('INITIAL', JSON.stringify(await evaluate(summary), null, 1));
    if (process.argv.includes('--tunnels=ai')) {
      const reason = await evaluate(`(() => { const e = window.pixelCityMapLab.economy, f = e.factions.find((x) => x.ok);
        return [e.playerTunnels, e.quoteTunnel(f.owner, { type: 'surface', x: f.entranceX, y: 0 }, { x: f.entranceX, y: 300 }).reason,
          document.getElementById('tunnel-controls').hidden]; })()`);
      if (reason[0] || !reason[1].includes('AI-only') || !reason[2]) throw new Error('AI-only tunnel mode still accepts player orders: ' + reason);
      console.log('AI-only tunnel mode rejects player orders:', reason[1]);
    }
    const combatMode = process.argv.includes('--combat');
    if (combatMode) {
      await evaluate(`(() => { const c = window.pixelCityMapLab.combat;
        if (!c) throw new Error('Generated combat missing');         c.configure({ spawning: true, fighting: ${!process.argv.includes('--peaceful')}, devices: ${!process.argv.includes('--peaceful')} }); })()`);
    }
    const production = `(() => {
      const lab = window.pixelCityMapLab, c = lab.combat, up = lab.city.inspectUpkeep();
      return { units: c.units.filter((u) => !u.scaleReference).map((u) => u.owner + ':' + u.kind),
        bases: c.bases.map((b) => ({ owner: b.owner, spawned: b.spawned, issuedHM: b.issuedHM || 0, issuedSM: b.issuedSM || 0,
          hm: b.entry.scenario.hm, ammoAndUnitsHM: b.entry.scenario.issued, sm: lab.city.buildingSM(lab.city.entries.indexOf(b.entry)), status: b.status })),
        upkeep: up && { upkeepPerMinute: up.upkeepPerMinute, drawn: up.drawn, consumed: up.consumed, stored: up.stored,
          short: up.buildings.filter((b) => !b.supplied).map((b) => 'B' + (b.index + 1) + ' ' + b.type + ' ' +
            lab.city.entries[b.index].building.owner + ' L' + lab.city.entries[b.index].building.level + ' dock ' +
            (b.dock ? b.dock.x + ',' + b.dock.y : 'none') + ' ' + b.state),
          supplied: up.buildings.filter((b) => b.supplied).map((b) => 'B' + (b.index + 1) + ' ' + b.type + ' ' +
            lab.city.entries[b.index].building.owner + ' L' + lab.city.entries[b.index].building.level + ' sm ' + b.sm) },
        smStorage: lab.city.inspectSMStorage(),
        farms: lab.city.entries.map((e, i) => e.building && e.building.type === 'farm' ? (() => { const f = lab.city.inspectFarm(i);
          return 'B' + (i + 1) + ' ' + e.building.owner + ' finished ' + e.scenario.finished + ' silos ' +
            f.storageSilos.map((s) => s.stored).join('/') + ' ' + (f.state || '') + ' sources ' +
            f.sources.map((s) => s.kind + (s.kind === 'pump' ? ':' + s.cave + ' lift ' + s.lift : '') + ' d' + s.distance).join(', '); })() : null).filter(Boolean),
        caves: lab.city.inspectAquifers().map((c) => c.id + ' @' + c.x + ',' + c.y + ' water ' + c.volume + '/' + c.water),
        dryFarms: lab.city.entries.filter((e, i) => e.building && e.building.type === 'farm' && e.scenario.finished &&
          !e.scenario.coreDestroyed && !lab.city.inspectFarm(i).capacity).length,
        dryDetail: lab.city.entries.filter((e, i) => e.building && e.building.type === 'farm' && e.scenario.finished &&
          !e.scenario.coreDestroyed && !lab.city.inspectFarm(i).capacity).map((e) => {
          const xs = e.scenario.plan.map((c) => c.x), cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
          return 'x ' + Math.min(...xs) + '-' + Math.max(...xs) + ' L' + e.building.level + ' ground ' + lab.city.world.surfaceRow(cx) + ' caves ' +
            lab.city.waterCaves.map((c) => c.id + ' dx ' + (c.x - cx) + ' wl ' + c.waterline + ' groundAbove ' + lab.city.world.surfaceRow(c.x)).join('; ');
        }),
        couriers: up ? up.transporters.map((t) => t.state) : [] };
    })()`;
    const batch = 600;
    let stepMs = 0;
    // --order: at tick 3000 probe placement rules and order a real tunnel; it must finish, paid from mine storage.
    const orderMode = process.argv.includes('--order');
    const orderScript = `(() => {
      const lab = window.pixelCityMapLab, e = lab.economy, net = e.network, r = net.radius, out = { probes: {} };
      const f = e.factions.find((x) => x.ok && x.owner === 'left') || e.factions.find((x) => x.ok);
      const owner = f.owner, trunk = f.segments[1], trunkY = trunk.line[0].y, [low, high] = e.zoneLimits(owner);
      const xs = trunk.line.map((c) => c.x), tl = Math.min(...xs), th = Math.max(...xs);
      const anchors = [];
      for (let x = tl + 4; x <= th - 4; x += 3) { const a = e.anchorNear(owner, { x, y: trunkY + r + 1 }, 1); if (a) anchors.push(a); }
      for (const dx of [-14, 14, -24, 24]) { const a = e.anchorNear(owner, { x: f.entranceX + dx, y: lab.city.world.surfaceRow(f.entranceX + dx) }, 3); if (a) anchors.push(a); }
      out.anchors = anchors.length;
      const probe = anchors[0];
      out.probes.zone = e.quoteTunnel(owner, probe, { x: owner === 'left' ? high + 30 : low - 30, y: trunkY });
      const other = owner === 'left' ? 'right' : 'left';
      out.probes.enemyStart = e.quoteTunnel(other, probe, { x: probe.x, y: probe.y + 20 });
      const cave = lab.city.waterCaves.find((c) => c.x >= low && c.x <= high);
      if (cave) out.probes.cave = e.quoteTunnel(owner, probe, { x: cave.x, y: cave.top - 2 });
      const reserved = pixelBuildingReservations(lab.city.entries, lab.city.world.width);
      const entry = lab.city.entries.find((en) => en.scenario.paidGrowth && en.basementCells.length &&
        en.basementCells.some((c) => c.x >= low && c.x <= high));
      if (entry) {
        const cell = entry.basementCells.filter((c) => reserved.has(c.y * lab.city.world.width + c.x))
          .reduce((a, b) => b.y > a.y ? b : a);
        out.probes.building = e.quoteTunnel(owner, probe, { x: cell.x, y: cell.y });
      }
      for (const key of Object.keys(out.probes)) out.probes[key] = { ok: out.probes[key].ok, reason: out.probes[key].reason };
      let quote = null, used = null;
      search: for (const a of anchors) for (const dy of [26, 18, 34]) for (const dx of [0, 16, -16, 28, -28]) {
        const q = e.quoteTunnel(owner, a, { x: a.x + dx, y: a.y + dy });
        if (q.ok && q.line.length >= 30) { quote = q; used = { anchor: a, target: { x: a.x + dx, y: a.y + dy } }; break search; }
      }
      if (!quote) return { ...out, ordered: false };
      const before = e.inspect().tunnelHM;
      const result = e.orderTunnel(owner, used.anchor, used.target);
      return { ...out, ordered: result.ok, reason: result.reason, order: result.order, estimate: quote.price, area: quote.area,
        premiumArea: quote.premiumArea, cells: quote.line.length, chunks: quote.chunks, from: used, ledgerBefore: before };
    })()`;
    const orderStatus = `(() => { const e = window.pixelCityMapLab.economy, s = e.inspect();
      const order = e.orders[e.orders.length - 1];
      return { orders: s.orders, tunnelHM: s.tunnelHM, ok: s.ok, checks: s.checks,
        priced: order ? order.segments.reduce((sum, seg) => sum + seg.priceHM, 0) : 0,
        dug: order ? order.segments.every((seg) => seg.phase === 'complete') : false }; })()`;
    let ordered = null;
    for (let done = 0; done < totalTicks; done += batch) {
      stepMs += await evaluate(`(() => { const lab = window.pixelCityMapLab, start = performance.now();
        for (let i = 0; i < ${batch}; i += 1) lab.advance(); return performance.now() - start; })()`);
      if (orderMode && done + batch === 3000) {
        ordered = await evaluate(orderScript);
        console.log('ORDER', JSON.stringify(ordered, null, 1));
      }
      if (orderMode && ordered && (done + batch) % 3000 === 0) console.log('ORDER STATUS', done + batch, JSON.stringify(await evaluate(orderStatus)));
      if ((done + batch) % 3000 === 0) {
        console.log('TICK', done + batch, JSON.stringify(await evaluate(summary), null, 1));
        if (combatMode) console.log('PRODUCTION', done + batch, JSON.stringify(await evaluate(production), null, 1));
      }
    }
    const economyMs = await evaluate(`(() => { const e = window.pixelCityMapLab.economy, start = performance.now();
      for (let i = 0; i < 600; i += 1) e.step(); return (performance.now() - start) / 600; })()`);
    const final = await evaluate(summary);
    console.log('FINAL', JSON.stringify(final, null, 1));
    console.log(`Average full tick ${(stepMs / totalTicks).toFixed(3)} ms; economy step alone ${economyMs.toFixed(3)} ms`);
    if (errors.length) throw new Error('Page exceptions: ' + errors.join(' | '));
    if (!final.ok) throw new Error('Economy audit failed');
    if (final.factions.some((faction) => !faction.ok)) throw new Error('A faction tunnel system could not be planned');
    if (!final.transferred) throw new Error('No mined HM reached any building');
    console.log('TUNNEL HM', JSON.stringify(final.tunnelHM));
    if (orderMode) {
      if (!ordered) throw new Error('Order test did not run (needs --ticks >= 3000)');
      for (const [name, probe] of Object.entries(ordered.probes)) {
        if (probe.ok) throw new Error(`Tunnel placement probe "${name}" should have been rejected`);
      }
      if (!ordered.ordered) throw new Error('No valid tunnel order could be placed: ' + JSON.stringify(ordered));
      const status = await evaluate(orderStatus), order = status.orders[status.orders.length - 1];
      console.log('ORDER FINAL', JSON.stringify(status));
      if (!order.done || !status.dug) throw new Error('Ordered tunnel did not finish: ' + order.state);
      if (order.paid !== status.priced || order.paid <= 0) throw new Error('Ordered tunnel payment does not match its segment prices');
      if (Math.abs(order.paid - ordered.estimate) > Math.max(3, ordered.estimate * 0.25)) {
        throw new Error(`Ordered tunnel charged ${order.paid} HM against a ${ordered.estimate} HM quote`);
      }
      const minimum = Math.ceil(ordered.area / 5) - 3;
      if (order.paid < minimum) throw new Error('Ordered tunnel was charged below the plain-rock rate');
    }
    if (nodeArg && final.factions.some((faction) => faction.ok && faction.nodes < 2)) {
      throw new Error('A faction did not survey a replacement ore node after its node ran low');
    }
    if (combatMode) {
      const result = await evaluate(production);
      console.log('PRODUCTION FINAL', JSON.stringify(result, null, 1));
      if (!result.bases.some((base) => base.issuedHM > 0)) throw new Error('No unit production drew HM');
      if (!result.caves.length) throw new Error('No underground water caves were generated');
      if (result.dryFarms) throw new Error(`${result.dryFarms} finished farm(s) found no basin or cave pump`);
    }
    const shot = process.argv.find((arg) => arg.startsWith('--screenshot='));
    if (shot) {
      await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false }, session);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const clip = await evaluate(`(() => {
        const lab = window.pixelCityMapLab, f = lab.economy.factions[0], canvas = document.getElementById('lab');
        canvas.scrollIntoView(); const rect = canvas.getBoundingClientRect(), s = rect.width / lab.city.world.width;
        return { x: rect.left + window.scrollX + (f.entranceX - 120) * s, y: rect.top + window.scrollY + (f.node.y - 170) * s,
          width: 420 * s, height: 220 * s, scale: Math.max(1, 3 / s) };
      })()`);
      const image = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true }, session);
      fs.writeFileSync(shot.slice(13), Buffer.from(image.data, 'base64'));
      console.log('Screenshot', shot.slice(13), JSON.stringify(clip));
    }
    console.log('PASS mined full-map economy: tunnels, mining, pipeline and cellars deliver conserved HM to faction buildings');
  } finally {
    if (socket) socket.close();
    child.kill(); server.close();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (error) { /* profile still locked */ } }, 1500);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
