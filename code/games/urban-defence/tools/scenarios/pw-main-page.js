// N8 - the game is the main page (index.html), and it runs from a downloaded copy: opened from disk
// (file://, as a double-click opens it), no server. It opens on the menu; START makes the world behind
// the loading screen, stage by stage, and the match begins with its HUD. The old beta still loads
// (beta-legacy.html: its own suite).
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
check(location.protocol === 'file:', `opened from disk (${location.protocol}//)`);
check(!!document.getElementById('gm-menu') && !window.pwApp, 'index.html opens on the match menu');
check(!document.getElementById('world-tools'), 'the sandbox tools are the dev page\'s, not the game\'s');
const btn = document.querySelector('#gm-menu [data-act="start"]');
const r = btn.getBoundingClientRect();
const started = performance.now();
await click(r.left + r.width / 2, r.top + r.height / 2);
// (the loading screen: each stage reports before it runs)
const labels = new Set();
let firstSeen = 0;
for (let t = 0; t < 900 && !(window.pwApp && window.pwApp.ready); t += 1) {
  const el = document.getElementById('gm-loading');
  if (el) { if (!firstSeen) firstSeen = performance.now(); labels.add(el.querySelector('[data-label]').textContent); }
  await sleep(20);
}
const loaded = performance.now() - started;
check(firstSeen && firstSeen - started < 500, `the loading screen is up at once (${Math.round(firstSeen - started)} ms after START)`);
check(labels.size >= 4, `it shows the stages as they run (${[...labels].join(' / ')})`);
check(!!(window.pwApp && window.pwApp.ready && pwApp.match()), `the match begins (${(loaded / 1000).toFixed(1)} s from START to playable)`);
checks.push(`INFO generation ${Object.entries(pwApp.timings).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')} ms`);
check(!!document.getElementById('gm-top') && !!document.getElementById('gm-map') && !document.getElementById('gm-loading'), 'the HUD and minimap are up, the loading screen gone');
// (the pixel font loads from disk too)
await document.fonts.ready;
check(document.fonts.check("16px 'Ithaca'"), 'the pixel font loads from disk');
await sleep(2500);
const perf = pwApp.perf();
checks.push(`INFO ${Math.round(pwApp.fps())} fps; p95 ms a frame: ${Object.entries(perf.parts).map(([k, v]) => `${k} ${v.p95.toFixed(1)}`).join(', ')}`);
const shots = [await shot('pw-main-page')];
return { checks, shots: shots.length };
