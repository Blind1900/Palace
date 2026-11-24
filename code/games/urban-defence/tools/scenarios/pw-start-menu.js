// N118 (the user's, 2026-11-23) - the game's start screen and mode menu (pixel-world.html?mode=game,
// no start=): a start screen with a START button only; then the game-mode menu - the match, the map
// size, the side, the aesthetic (R in place of asian, B of modern, P of gothic) - and no difficulty.
// Phosphor green on black, after the user's sketches (studied, not copied). Driven by real clicks and keys.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const menu = document.getElementById('gm-menu');
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const press = async (el) => { const p = centre(el); await click(p.x, p.y); await sleep(80); };
const seen = (el) => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
check(!!menu && !window.pwApp, 'the game page opens on the start screen, no world made yet');
if (!menu) return { checks };
await document.fonts.ready;
await sleep(400);

// 1. The start screen: the title and a START button - nothing else to press.
const title = menu.querySelector('[data-screen="title"]');
const buttons = [...menu.querySelectorAll('button, .ph-opt, .ph-style')].filter(seen);
check(seen(title) && buttons.length === 1 && buttons[0].textContent.trim() === 'START' && /URBAN DEFENCE/.test(title.textContent),
  `the start screen has the title and one button, START (${buttons.map((b) => b.textContent.trim()).join(', ')})`);
const green = getComputedStyle(menu).color;
check(/rgb\(110, 240, 138\)/.test(green) && /rgb\(2, 4, 2\)/.test(getComputedStyle(menu).backgroundColor), `phosphor green on black (${green} on ${getComputedStyle(menu).backgroundColor})`);
check(document.fonts.check("22px 'Ithaca'"), 'in the pixel font');
shots.push(await shot('n118-start-screen'));

// 2. START opens the mode menu.
await press(buttons[0]);
const mode = menu.querySelector('[data-screen="mode"]');
check(seen(mode) && !seen(title), 'START opens the game-mode menu');
const text = mode.textContent;
const groups = [...mode.querySelectorAll('.ph-group > span')].filter(seen).map((s) => s.textContent.trim());
check(['MATCH', 'MAP SIZE', 'SIDE', 'AESTHETIC'].every((g) => groups.includes(g)), `its choices: ${groups.join(', ')}`);
check(!/difficulty|easy|normal|hard/i.test(text), 'no difficulty option');
const maps = [...mode.querySelectorAll('[data-map]')].map((e) => e.dataset.map);
check(maps.join() === 'small,medium,large' && /5-10 MIN/.test(text) && /10-20 MIN/.test(text) && /20\+ MIN/.test(text), `map sizes small, medium and large with their times (${maps.join(', ')})`);
// (each drawn to its own shape - a wide rectangle, wider the larger)
const cw = maps.map((k) => { const c = mode.querySelector(`[data-map="${k}"] canvas`); return c ? [c.width, c.height] : [0, 1]; });
check(cw[0][0] < cw[1][0] && cw[1][0] < cw[2][0] && cw.every(([w, h]) => w / h >= 5), `each map drawn as a wide strip to its size (${cw.map(([w, h]) => `${w}x${h}`).join(', ')})`);
const letters = [...mode.querySelectorAll('.ph-style b')].map((b) => b.textContent.trim());
check(letters.join() === 'R,B,P' && !/ASIAN|MODERN|GOTHIC/.test(text), `the aesthetics are R, B and P, not the styles' names (${letters.join(', ')})`);
const styleOf = Object.fromEntries([...mode.querySelectorAll('.ph-style')].map((e) => [e.querySelector('b').textContent.trim(), e.dataset.style]));
check(styleOf.R === 'asian' && styleOf.B === 'modern' && styleOf.P === 'gothic', `R is asian, B modern, P gothic (${JSON.stringify(styleOf)})`);
// (drawn: its own size - not the blank canvas's 300 x 150 - with phosphor lit in it)
const lit = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 1; i < d.length; i += 4) if (d[i] > 60) n += 1; return n; };
const towers = [...mode.querySelectorAll('.ph-style canvas')].map((c) => [c.width, c.height, lit(c)]);
check(towers.length === 3 && towers.every(([w, h, n]) => !(w === 300 && h === 150) && n > 200), `each aesthetic shows one of its towers in phosphor (${towers.map(([w, h, n]) => `${w}x${h}:${n} lit`).join(', ')})`);
const on = (sel) => [...mode.querySelectorAll(sel)].filter((e) => e.classList.contains('on')).map((e) => e.dataset.mode || e.dataset.map || e.dataset.side);
info(`defaults: ${on('[data-mode]')} / ${on('[data-map]')} / ${on('[data-side]')}`);
shots.push(await shot('n118-mode-menu'));
// (watching, the side and the aesthetic are nobody's)
await press(mode.querySelector('[data-mode="watch"]'));
check(!seen(mode.querySelector('[data-for="side"]')) && !seen(mode.querySelector('[data-for="style"]')), 'watching, no side or aesthetic to choose');
await press(mode.querySelector('[data-mode="versus"]'));
// (Esc goes back to the start screen, Enter comes again)
key('Escape'); await sleep(60);
check(seen(title) && !seen(mode), 'Esc goes back to the start screen');
key('Enter'); await sleep(60);
check(seen(mode), 'Enter opens the mode menu again');

// 3. Chosen and started: the small map, the right side, R - the world made so.
await press(mode.querySelector('[data-map="small"]'));
await press(mode.querySelector('[data-side="right"]'));
await press(mode.querySelector('.ph-style[data-style="asian"]'));
shots.push(await shot('n118-mode-chosen'));
await press(mode.querySelector('[data-act="start"]'));
let sawLoading = false;
for (let t = 0; t < 900 && !(window.pwApp && window.pwApp.ready && pwApp.match()); t += 1) {
  const l = document.getElementById('gm-loading');
  if (l && !sawLoading) { sawLoading = true; shots.push(await shot('n118-loading')); }
  await sleep(40);
}
check(sawLoading, 'the loading screen in the same look');
const m = window.pwApp && pwApp.match();
check(!!m, 'the match begins');
if (!m) return { checks, shots };
check(pwApp.world.width === 24064, `the small map (${pwApp.world.width} wide, ${pwApp.world.height} tall)`);
check(m.human === 'right' && m.sides.right.style === 'asian', `you hold the right side, in R (${m.human}, ${m.sides.right.style})`);
const hud = document.querySelector('#gm-top [data-info] .side');
check(!!hud && /RIGHT · R \(YOU\)/.test(hud.textContent), `the HUD names the side by its letter (${hud ? hud.textContent : '-'})`);
return { checks, shots };
