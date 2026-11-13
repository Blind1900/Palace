// Loads the Urban Defence beta (index.html) in headless Edge and reports script errors,
// an optional gameplay scenario, FPS and screenshots.
//
// Run from the urban-defence folder with Node (VS Code's Electron works):
//   ELECTRON_RUN_AS_NODE=1 "C:\Program Files\Microsoft VS Code\Code.exe" tools/check-beta-game.cjs [options]
//
// Options:
//   --page=index.html       page to open (relative to the urban-defence folder)
//   --params=a=1&b=2        query string for the page
//   --seed=N                replace Math.random with a seeded PRNG so the generated world repeats
//   --size=1600x900         viewport in CSS pixels
//   --wait=3000             ms to let the game run after it is ready (before the scenario)
//   --scenario=file.js      body of an async function run in the page after the wait (see helpers below);
//                           its return value is printed as JSON. Return { checks: ['PASS ...', 'FAIL ...'] }
//                           to have FAIL lines set a failing exit code.
//   --eval="expression"     quick expression evaluated after the scenario; result printed as JSON
//   --fps=3000              measure requestAnimationFrame rate over this many ms (headless, software GPU)
//   --screenshot=path.png   screenshot after everything else
//   --out=dir               folder for scenario screenshots (default: OS temp)
//   --timeout=60000         overall scenario timeout in ms
//
// Helpers available to scenarios (all return promises):
//   shot(name)              screenshot saved as <out>/<name>.png
//   click(x, y)             real mouse click at viewport CSS coordinates
//   drag(x1, y1, x2, y2, steps)  real mouse drag
//   wheel(x, y, deltaY)     real mouse wheel
//   sleep(ms)
//   toClient(worldX, worldY)    -> {x, y} viewport coordinates of a world point (uses worldToScreen)
//   worldClick(worldX, worldY)  real click on a world point
//   focusWorld(worldX, worldY, zoomFactor)  centre the camera on a world point (zoomFactor x fit zoom;
//                           on pixel-world.html it is a zoom step index instead)
// Page globals from scripts/main.js (commandControl, missileControl, buildingBlueprints, cores, camera, ...) are in scope.
// On pixel-world.html the pixel world is window.pwApp (world, layout, renderer, focus, toClient, ...).
// Exit code: 1 when the page throws, logs console errors, fails to load a file, or a scenario check FAILs.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = {};
for (const argument of process.argv.slice(2)) {
  const match = argument.match(/^--([^=]+)(?:=([\s\S]*))?$/);
  if (match) args[match[1]] = match[2] === undefined ? true : match[2];
}
const [width, height] = String(args.size || '1600x900').split('x').map(Number);
const wait = Number(args.wait ?? 3000);
const page = String(args.page || 'index.html');
const outDir = path.resolve(String(args.out || path.join(os.tmpdir(), 'urban-beta-shots')));
const timeout = Number(args.timeout || 60000);
const TYPES = { '.js': 'application/javascript', '.cjs': 'application/javascript', '.html': 'text/html',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ttf': 'font/ttf', '.txt': 'text/plain' };

const PAGE_HELPERS = `(() => {
  ${args.seed !== undefined ? `{
    let seed = ${Number(args.seed) >>> 0} || 1;
    Math.random = () => {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }` : ''}
  const pending = new Map();
  let serial = 0;
  const cdp = (op, data = {}) => new Promise((resolve) => {
    const id = ++serial;
    pending.set(id, resolve);
    window.__cdp(JSON.stringify({ id, op, ...data }));
  });
  window.__cdpDone = (id, value) => { const resolve = pending.get(id); pending.delete(id); if (resolve) resolve(value); };
  window.shot = (name) => cdp('shot', { name: String(name) });
  window.click = (x, y) => cdp('click', { x, y });
  window.drag = (x1, y1, x2, y2, steps = 8) => cdp('drag', { x1, y1, x2, y2, steps });
  window.wheel = (x, y, deltaY) => cdp('wheel', { x, y, deltaY });
  window.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.toClient = (worldX, worldY) => {
    if (window.pwApp) return window.pwApp.toClient(worldX, worldY);
    const canvasElement = document.getElementById('game-canvas');
    const rect = canvasElement.getBoundingClientRect();
    const screen = worldToScreen(worldX, worldY);
    return { x: rect.left + canvasElement.clientLeft + screen.x, y: rect.top + canvasElement.clientTop + screen.y };
  };
  window.worldClick = (worldX, worldY) => { const point = toClient(worldX, worldY); return click(point.x, point.y); };
  window.focusWorld = (worldX, worldY, zoomFactor = 4) => {
    // Pixel world: zoomFactor is a zoom step index (-1 fit, 4 = 1 px per cell, 7 = 4 px per cell).
    if (window.pwApp) { window.pwApp.focusWorld(worldX, worldY, zoomFactor); return new Promise(requestAnimationFrame); }
    camera.zoom = getFitZoom() * zoomFactor;
    camera.x = worldX - viewport.width / (2 * camera.zoom);
    camera.y = worldY - viewport.height / (2 * camera.zoom);
    clampCamera();
    return new Promise(requestAnimationFrame);
  };
})();`;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const server = http.createServer((request, response) => {
    if (request.url.split('?')[0] === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const file = path.resolve(root, '.' + decodeURIComponent(request.url.split('?')[0]).replaceAll('/', path.sep));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'urban-beta-edge-'));
  const child = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', `--window-size=${width},${height}`,
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const report = { url: '', errors: [], warnings: [], logs: [] };
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('Edge debugging endpoint timeout')), 20000);
      child.stderr.on('data', (data) => {
        buffer += data;
        const found = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (found) { clearTimeout(timer); resolve(found[1]); }
      });
      child.on('error', reject);
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let serial = 0;
    const pending = new Map();
    let session = '';
    const send = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params, sessionId: sessionId || undefined }));
    });
    const evaluate = async (expression, awaitPromise = false) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (result.exceptionDetails) {
        const exception = result.exceptionDetails.exception;
        throw new Error(exception && exception.description ? exception.description : result.exceptionDetails.text);
      }
      return result.result.value;
    };
    const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
    const handleBinding = async (payload) => {
      const request = JSON.parse(payload);
      let value = null;
      try {
        if (request.op === 'shot') {
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          const file = path.join(outDir, `${request.name.replace(/[^\w.-]+/g, '_')}.png`);
          fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
          value = file;
        } else if (request.op === 'click') {
          await mouse('mouseMoved', request.x, request.y, { buttons: 0 });
          await mouse('mousePressed', request.x, request.y, { button: 'left', buttons: 1, clickCount: 1 });
          await mouse('mouseReleased', request.x, request.y, { button: 'left', buttons: 0, clickCount: 1 });
          value = true;
        } else if (request.op === 'drag') {
          await mouse('mouseMoved', request.x1, request.y1, { buttons: 0 });
          await mouse('mousePressed', request.x1, request.y1, { button: 'left', buttons: 1, clickCount: 1 });
          for (let step = 1; step <= request.steps; step += 1) {
            const t = step / request.steps;
            await mouse('mouseMoved', request.x1 + (request.x2 - request.x1) * t,
              request.y1 + (request.y2 - request.y1) * t, { button: 'left', buttons: 1 });
          }
          await mouse('mouseReleased', request.x2, request.y2, { button: 'left', buttons: 0, clickCount: 1 });
          value = true;
        } else if (request.op === 'wheel') {
          await mouse('mouseWheel', request.x, request.y, { deltaX: 0, deltaY: request.deltaY });
          value = true;
        }
      } catch (error) {
        value = { error: error.message };
      }
      await evaluate(`window.__cdpDone(${request.id}, ${JSON.stringify(value)})`).catch(() => {});
    };
    socket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const entry = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) entry.reject(new Error(`${entry.method}: ${JSON.stringify(data.error)}`));
        else entry.resolve(data.result);
        return;
      }
      const params = data.params || {};
      if (data.method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails;
        const description = details.exception && details.exception.description || details.text;
        report.errors.push(`exception: ${description} (${details.url || ''}:${details.lineNumber + 1})`);
      } else if (data.method === 'Runtime.consoleAPICalled') {
        const text = params.args.map((arg) => arg.value !== undefined ? String(arg.value)
          : arg.description || arg.type).join(' ');
        if (params.type === 'error' || params.type === 'assert') report.errors.push(`console.${params.type}: ${text}`);
        else if (params.type === 'warning') report.warnings.push(text);
        else report.logs.push(text);
      } else if (data.method === 'Log.entryAdded') {
        const entry = params.entry;
        if (entry.level === 'error') report.errors.push(`log: ${entry.text} ${entry.url || ''}`);
      } else if (data.method === 'Runtime.bindingCalled' && params.name === '__cdp') {
        handleBinding(params.payload);
      }
    });
    const target = await send('Target.createTarget', { url: 'about:blank' }, '');
    session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, '')).sessionId;
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable');
    await send('Runtime.addBinding', { name: '__cdp' });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.bringToFront');
    const port = server.address().port;
    report.url = `http://127.0.0.1:${port}/${page}${args.params ? `?${args.params}` : ''}`;
    await send('Page.navigate', { url: report.url });

    const readyExpression = String(args.ready || "document.readyState === 'complete' && ((typeof commandControl !== 'undefined' && typeof missileControl !== 'undefined') || (window.pwApp && window.pwApp.ready))");
    const readyDeadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      ready = await evaluate(`(() => { try { return !!(${readyExpression}); } catch (error) { return false; } })()`).catch(() => false);
      if (ready) break;
      if (report.errors.length && Date.now() > readyDeadline - 25000) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    report.ready = ready;
    if (ready) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (args.scenario) {
        const body = fs.readFileSync(path.resolve(String(args.scenario)), 'utf8');
        const started = Date.now();
        report.scenario = await Promise.race([
          evaluate(`(async () => {\n${body}\n})()`, true),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`scenario timeout after ${timeout} ms`)), timeout)),
        ]).catch((error) => ({ error: error.message }));
        report.scenarioMs = Date.now() - started;
      }
      if (args.eval) report.eval = await evaluate(String(args.eval), true).catch((error) => ({ error: error.message }));
      if (args.fps) {
        report.fps = await evaluate(`(async () => {
          const durations = [];
          let last = performance.now();
          const end = last + ${Number(args.fps)};
          while (performance.now() < end) {
            await new Promise(requestAnimationFrame);
            const now = performance.now();
            durations.push(now - last);
            last = now;
          }
          durations.sort((a, b) => a - b);
          const total = durations.reduce((sum, value) => sum + value, 0);
          return { frames: durations.length, fps: +(durations.length / (total / 1000)).toFixed(1),
            p50: +durations[Math.floor(durations.length * 0.5)].toFixed(1),
            p95: +durations[Math.floor(durations.length * 0.95)].toFixed(1) };
        })()`, true).catch((error) => ({ error: error.message }));
      }
    }
    if (args.screenshot) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.resolve(String(args.screenshot)), Buffer.from(shot.data, 'base64'));
      report.screenshot = path.resolve(String(args.screenshot));
    }
  } finally {
    if (socket) socket.close();
    child.kill();
    server.close();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (error) { /* Edge may still hold the profile */ } }, 500);
  }
  const checks = report.scenario && Array.isArray(report.scenario.checks) ? report.scenario.checks : [];
  const failedChecks = checks.filter((line) => String(line).startsWith('FAIL'));
  report.logs = report.logs.slice(-40);
  report.warnings = report.warnings.slice(-40);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready || report.errors.length || failedChecks.length || (report.scenario && report.scenario.error)) {
    console.log(`RESULT: FAIL (ready=${report.ready}, errors=${report.errors.length}, failedChecks=${failedChecks.length}${report.scenario && report.scenario.error ? ', scenario error' : ''})`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT: PASS${checks.length ? ` (${checks.length} checks)` : ''}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
