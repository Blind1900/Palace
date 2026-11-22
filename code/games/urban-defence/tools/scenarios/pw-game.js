// N6 - the match on the game page (pixel-world.html?mode=game). Two runs in the suite list:
//   pw-game       start=versus&side=left: the person against the computer, from a shared link;
//   pw-game-menu  no start: the menu - COMPUTER vs COMPUTER picked and started by real clicks -
//                 then the person takes a chair and hands it back.
// What it guards: the match runs with its HUD and game bar (the sandbox tools put away), both sides
// start with their purse, the person's seed goes in by real clicks only where the side can see,
// and the computer grows its side by the same rule.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const press = async (selector) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  const p = centre(el);
  await click(p.x, p.y);
  await sleep(60);
  return true;
};

// ---- The menu run: pick COMPUTER vs COMPUTER and start it -------------------------------------------
const viaMenu = !window.pwApp;
if (viaMenu) {
  check(!!document.getElementById('gm-menu'), 'the game page opens on the match menu');
  await press('#gm-menu [data-mode="watch"]');
  await press('#gm-menu [data-act="start"]');
  for (let t = 0; t < 600 && !(window.pwApp && window.pwApp.ready); t += 1) await sleep(100);
  check(!!(window.pwApp && window.pwApp.ready), 'START makes the world behind the loading screen and the match begins');
  if (!window.pwApp) return { checks };
}

const { world } = pwApp;
const m = pwApp.match();
const G = PW.game;
check(!!m, 'a match is running');
check(!!document.getElementById('gm-top') && !!document.getElementById('gm-bar'), 'the HUD and the game bar are up');
check(document.getElementById('world-tools').style.display === 'none' && !document.getElementById('gm-menu'),
  'the sandbox tools and the menu are put away');
check(G.purse(m, 'left').hm >= 500 && G.purse(m, 'right').hm >= 500 && G.purse(m, 'left').sm >= 300,
  `both sides start with their purse (HM ${Math.round(G.purse(m, 'left').hm)} / ${Math.round(G.purse(m, 'right').hm)})`);

if (m.mode === 'versus') {
  check(m.human === 'left' && m.sides.left.controller === 'human' && m.sides.right.controller === 'ai' && !!m.sides.right.ai,
    'the person plays left, the computer right');
  // A seed beyond the side's sight is refused, by a real click with the tool in hand.
  const cities = () => world.capitalGrowth.cities.length;
  const before = cities();
  await press('#gm-bar [data-tool="seed:farm"]');
  check(PW.gameUI.tool() === 'seed:farm', 'SEED FARM is in hand');
  const far = m.sides.right.home - 400;
  pwApp.focus(far, world.groundTop[far] - 60, 3);
  await sleep(150);
  const fp = pwApp.toClient(far, world.groundTop[far] - 4);
  await click(fp.x, fp.y);
  await sleep(60);
  check(cities() === before && !PW.vision.sees(world, 'left', far), 'a seed beyond the side\'s vision is refused');
  // ...and one cast past the front, where it can see, is planted.
  const front = G.frontOf(m, 'left');
  let planted = 0, at = 0;
  for (let k = 0; k < 14 && !planted; k += 1) {
    const x = front + 180 + k * 70;
    if (!PW.vision.sees(world, 'left', x)) continue;
    if (PW.gameUI.tool() !== 'seed:farm') await press('#gm-bar [data-tool="seed:farm"]');
    pwApp.focus(x, world.groundTop[x] - 60, 3);
    await sleep(120);
    const p = pwApp.toClient(x, world.groundTop[x] - 4);
    await click(p.x, p.y);
    await sleep(60);
    if (cities() > before) { planted = 1; at = x; }
  }
  const city = world.capitalGrowth.cities[world.capitalGrowth.cities.length - 1];
  check(planted === 1 && city.faction === 'left' && city.kind === 'farm' && city.style === m.sides.left.style,
    `the person's farm seed is planted by real clicks in their vision, in their style (at ${at})`);
  pwApp.stepWorld(60 * 4);
  shots.push(await shot('pw-game-versus'));
  // The computer grows its side too, by the same rule.
  pwApp.stepWorld(60 * 150);
  const ai = m.sides.right.ai.brain;
  const theirs = world.capitalGrowth.cities.filter((c) => c.faction === 'right' && c.id > 5);
  check(ai.seeds >= 1 && theirs.length >= 1, `the computer plants its own seeds (${ai.seeds} planted, last: ${ai.last})`);
  check(theirs.every((c) => PW.vision.sees(world, 'right', c.x)), 'and only where its side can see');
  check(m.clock > 150, `the match clock runs (${m.clock.toFixed(0)} s)`);
} else {
  check(m.mode === 'watch' && !m.human && m.sides.left.ai && m.sides.right.ai, 'COMPUTER vs COMPUTER: the computer plays both sides');
  pwApp.stepWorld(60 * 30);
  await sleep(300);
  // Take the left chair, then hand it back - real clicks on the top bar.
  await press('#gm-top [data-act="play"][data-side="left"]');
  check(m.human === 'left' && m.sides.left.controller === 'human' && !m.sides.left.ai && m.sides.right.controller === 'ai',
    'PLAY LEFT: the person takes the left side; the computer keeps the right');
  await sleep(300);
  check(!document.querySelector('#gm-bar [data-tool="seed:capital"]').disabled, 'the seed tools are open to the person now');
  shots.push(await shot('pw-game-took-left'));
  await press('#gm-top [data-act="handback"]');
  check(!m.human && m.sides.left.controller === 'ai' && !!m.sides.left.ai, 'HAND BACK: the computer plays the left side again');
  pwApp.stepWorld(60 * 120);
  const seeds = m.sides.left.ai.brain.seeds + m.sides.right.ai.brain.seeds;
  check(seeds >= 1, `both computer players keep growing (${seeds} seeds)`);
}
return { checks, shots: shots.length, log: m.log.slice(-8).map((l) => l.text) };
