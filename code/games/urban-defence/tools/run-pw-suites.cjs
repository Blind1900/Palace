// Runs the pixel-world scenario suites in parallel and prints one line per suite as each finishes,
// then a summary. Suites with timing budgets run alone at the end (parallel runs would skew them).
// A suite whose page never got ready is retried once; each suite is capped at --limit seconds.
//
// Usage (from code/games/urban-defence, with Node or ELECTRON_RUN_AS_NODE=1 Code.exe):
//   node tools/run-pw-suites.cjs [--jobs=2] [--seed=7] [--only=pw-fire,pw-pipes] [--limit=240]
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const jobs = Number(args.jobs || 2), seed = String(args.seed || 7), limit = Number(args.limit || 240);
// (det=1: the physics suites run deterministic - no time-sliced work, the world stepped only by
// the test - so they come out the same on a loaded machine; see PW.DETERMINISTIC)
const SUITES = [
  { name: 'pw-grounding', params: 'det=1' }, { name: 'pw-settlements' }, { name: 'pw-tunnels' }, { name: 'pw-mining', params: 'det=1' },
  { name: 'pw-pipes' }, { name: 'pw-made-ground' }, { name: 'pw-physics', params: 'det=1' }, { name: 'pw-ore' }, { name: 'pw-fields' }, { name: 'pw-styles' }, { name: 'pw-sandbox' }, { name: 'pw-views' }, { name: 'pw-repair' },
  { name: 'pw-slopes', params: 'gallery=slopes' }, { name: 'pw-mirror', params: 'gallery=mirror' }, { name: 'pw-pipe-cavity', params: 'det=1' }, { name: 'pw-tank', params: 'det=1' }, { name: 'pw-bore', params: 'det=1' },
  { name: 'pw-fire', alone: true, params: 'det=1' }, { name: 'pw-collapse', alone: true, params: 'det=1' },
].filter((s) => !args.only || args.only.split(',').includes(s.name));
const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), 'claude-scratch', 'shots');

function run(suite, attempt = 1) {
  return new Promise((resolve) => {
    const started = Date.now();
    const params = suite.params ? `${suite.params}&seed=${seed}` : `seed=${seed}`;
    const child = spawn(process.execPath, [path.join(__dirname, 'check-beta-game.cjs'), '--page=pixel-world.html', `--params=${params}`,
      '--wait=300', '--size=1600x900', `--timeout=${(limit - 10) * 1000}`, `--out=${out}`, `--scenario=tools/scenarios/${suite.name}.js`],
    { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    const timer = setTimeout(() => { text += '\nRESULT: TIMEOUT'; child.kill(); }, limit * 1000);
    child.on('close', async () => {
      clearTimeout(timer);
      const result = (text.match(/RESULT: .*/) || ['RESULT: no result'])[0];
      const fails = text.split('\n').filter((l) => /^\s+"FAIL /.test(l)).map((l) => l.trim().replace(/^"|",?$/g, ''));
      const error = (text.match(/"error": "([^"]{0,200})/) || [])[1];
      if (/ready=false/.test(result) && attempt === 1) { resolve(await run(suite, 2)); return; }
      const line = `${suite.name.padEnd(15)} ${result.replace('RESULT: ', '')}  (${Math.round((Date.now() - started) / 1000)} s${attempt > 1 ? ', retried' : ''})`;
      console.log(line);
      for (const f of fails) console.log(`    ${f}`);
      if (error) console.log(`    error: ${error}`);
      resolve({ suite: suite.name, ok: /^RESULT: PASS/.test(result), line });
    });
  });
}

(async () => {
  const t0 = Date.now();
  const queue = SUITES.filter((s) => !s.alone);
  const results = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) results.push(await run(queue.shift()));
  }));
  for (const s of SUITES.filter((x) => x.alone)) results.push(await run(s));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} suites pass in ${Math.round((Date.now() - t0) / 1000)} s` +
    (failed.length ? ` - failing: ${failed.map((r) => r.suite).join(', ')}` : ''));
})();
