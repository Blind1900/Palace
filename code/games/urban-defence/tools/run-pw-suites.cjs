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
  { name: 'pw-pipes' }, { name: 'pw-made-ground' }, { name: 'pw-physics', params: 'det=1', limit: 420 }, { name: 'pw-piers', params: 'det=1' }, { name: 'pw-base-legs', params: 'det=1' }, { name: 'pw-ore' }, { name: 'pw-fields' }, { name: 'pw-styles' }, { name: 'pw-sandbox' }, { name: 'pw-views' }, { name: 'pw-repair' },
  { name: 'pw-slopes', params: 'gallery=slopes' }, { name: 'pw-mirror', params: 'gallery=mirror' }, { name: 'pw-pipe-cavity', params: 'det=1' }, { name: 'pw-tank', params: 'det=1' }, { name: 'pw-bore', params: 'det=1' }, { name: 'pw-core-life', params: 'det=1' }, { name: 'pw-shots', params: 'det=1' }, { name: 'pw-troops', params: 'det=1' }, { name: 'pw-jets', params: 'det=1' }, { name: 'pw-defence', params: 'det=1' }, { name: 'pw-mechs', params: 'det=1' },
  // pw-core-attached (N80) joins once the underbody-ownership slice closes its six catalogued cuts
  { name: 'pw-pipe-flow', params: 'det=1' },       // N81: bends swept, no level change blocks the flow
  { name: 'pw-pipe-lanes', params: 'det=1' },      // N83/N84: every lane unbroken end to end; the casing's jacket
  { name: 'pw-refound', params: 'det=1' },         // N86/N87: 50 clear, down at the rise's pace, the bed re-laid at the surface
  { name: 'pw-heap-rebuild', params: 'det=1' },    // N100: no work till the wreck rests; the heap eaten two to one, the tower down with it
  // (pw-collapse studies the wreck itself: its beds stay where they were - N87's re-founding
  // packs the heap into the new footing, and pw-refound tests that)
  { name: 'pw-fire', alone: true, params: 'det=1' }, { name: 'pw-collapse', alone: true, params: 'det=1&flags=REFOUND_BEDS:0' },
  // the first capital-lab suite: the vehicle rule end to end (N3) - heavy, so it runs alone
  { name: 'pw-vehicle', alone: true, page: 'capital-lab.html', ready: 'window.pwLab && pwLab.ready', params: 'det=1' },
  // N92: the tunnel and traversal lab - a squad finds its way through a course dug as it watches
  { name: 'pw-unit-lab', page: 'pw-unit-lab.html', ready: 'window.pwLab && pwLab.ready', params: 'det=1' },
  // (towns=1: the world made with its home towns and the match played from them - the match suites'
  // fixtures. N120's own opening - no territory, the first seed placed - is the game's, and is
  // pw-game-test's, pw-first-seed's and the menu runs')
  // N6: the match on the game page - against the computer from a link, and from the menu watching
  // the computer play itself (the person takes a chair and hands it back)
  { name: 'pw-game', params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  { name: 'pw-game-menu', scenario: 'pw-game', ready: "!!document.getElementById('gm-menu')", params: 'mode=game&det=1' },
  // N6: the rules - deploying, hacking, cover - and the ruins and the win
  { name: 'pw-game-rules', alone: true, limit: 420, params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  { name: 'pw-game-win', params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  // N102: the unit in hand - stands unless its keys are held, jumps, fires where the mouse is
  { name: 'pw-game-hand', params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  // N103: turrets on their bases - on the roofs, the land and the tunnel rooms; set down by a click
  { name: 'pw-turret-mounts', params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  // N111: the spawn pad in every hangar floor over the base's armoured core; units come up on it
  { name: 'pw-spawn-pad', params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  // N116: levels bought by hand, units priced in HM and SM, HM to rush a tunnel's works
  { name: 'pw-game-upgrade', params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  // N115: the gameplay test - each side places its starting capital, four times the build speed
  { name: 'pw-game-test', params: 'mode=game&start=test&side=left&det=1' },
  { name: 'pw-traverse', params: 'det=1' },        // N133: a tank's and a man's walk along the whole land
  { name: 'pw-tunnel-audit', limit: 420, params: 'det=1' },   // N144: no road through a hill; every road tunnel a whole bore
  { name: 'pw-mil-exits', limit: 480, params: 'mode=game&start=test&side=left&det=1' },   // N130: ways out, spawn cores, the link
  // N114: missile launchers and interceptors on planted bases, out under the sky
  { name: 'pw-artillery-mounts', params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  // N118: the start screen and the game-mode menu, by real clicks and keys
  { name: 'pw-start-menu', ready: "!!document.getElementById('gm-menu')", params: 'mode=game&det=1' },
  // the user's: the computer player is all three - builds, fortifies, rushes - and fights hands-on
  { name: 'pw-ai-adaptive', params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  // N123: black where never seen, grey and held where seen before, circles cut only by mountains; the view on the unit
  { name: 'pw-vision', params: 'mode=game&start=versus&side=left&det=1&towns=1' },
  // N129: a city's tunnel - a shaft down from under its core at level 3, then out sideways to the ore
  { name: 'pw-core-shaft', limit: 480, params: 'det=1' },
  // N136: two or three more lakes, underground lakes, a farm's well, bridges raised and mended by their mini cores
  { name: 'pw-lakes-water', limit: 480, params: 'det=1' },
  // N161: no branch pipe joins the main near a core or over one - it runs along to a clear column
  { name: 'pw-pipe-tees', limit: 420, params: 'det=1' },
  // N162: one pipe design - a branch one lane in its resource's colour, the main's lanes open where they are used
  { name: 'pw-pipe-highway', params: 'det=1' },
  // N8: the game is the main page, opened from disk as a downloaded copy is; the old beta still loads
  { name: 'pw-main-page', page: 'index.html', file: true, alone: true, ready: "!!document.getElementById('gm-menu')" },
  // (the old beta makes its world from Math.random: seeded, the same world each run - unseeded it
  // now and then found no dry ground for a building and threw)
  { name: 'pw-beta-legacy', page: 'beta-legacy.html', mathSeed: true },
  // N97: a sloped tower and its military wing, and the wing and its neighbour, meet with no gap
  { name: 'pw-mil-join', alone: true, page: 'capital-lab.html', ready: 'window.pwLab && pwLab.ready', params: 'det=1' },
  // N104: a road through the mountain - portals on the flats, tall enough for the army, barricaded
  { name: 'pw-road-tunnel', alone: true, page: 'capital-lab.html', ready: 'window.pwLab && pwLab.ready', params: 'det=1' },
  { name: 'pw-road-tunnel-base', page: 'capital-lab.html', ready: 'window.pwLab && pwLab.ready', params: 'det=1' },
  // N88: halls and rooms - hallways opening through door frames into rooms of every size
  { name: 'pw-tunnel-rooms', params: 'det=1' },
  // N5: the item bar, drills and dirt tunnels, guards, turrets, orders, the sentry, a skirmish
  { name: 'pw-units', page: 'pw-unit-lab.html', ready: 'window.pwLab && pwLab.ready', params: 'det=1&go=0' },
  // N99: roofs come down with their buildings - the works hold up only what they put up
  { name: 'pw-roofs', params: 'det=1' },
  // N100: rubble out on the land weathers into dirt - not on streets, rebuilt lots or the pipes
  { name: 'pw-weather', params: 'det=1' },
  // N103: the turret - on the ground and on a wall, firing on its own; its base gone, it falls
  { name: 'pw-turrets', params: 'det=1' },
].filter((s) => !args.only || args.only.split(',').includes(s.name));
const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), 'claude-scratch', 'shots');

function run(suite, attempt = 1) {
  return new Promise((resolve) => {
    const started = Date.now();
    const params = suite.params ? `${suite.params}&seed=${seed}` : `seed=${seed}`;
    const cap = suite.limit || limit;   // (a long match suite may take more than the usual cap)
    const child = spawn(process.execPath, [path.join(__dirname, 'check-beta-game.cjs'), `--page=${suite.page || 'pixel-world.html'}`, `--params=${params}`,
      ...(suite.ready ? [`--ready=${suite.ready}`] : []), ...(suite.file ? ['--file'] : []), ...(suite.mathSeed ? [`--seed=${seed}`] : []),
      '--wait=300', '--size=1600x900', `--timeout=${(cap - 10) * 1000}`, `--out=${out}`, `--scenario=tools/scenarios/${suite.scenario || suite.name}.js`],
    { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    const timer = setTimeout(() => { text += '\nRESULT: TIMEOUT'; child.kill(); }, cap * 1000);
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
