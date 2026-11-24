'use strict';
// The game's screens (N6): the match menu, the loading screen (N8's staged generation reports to it),
// and over the running match the HUD - the side's stock and what it brings in, the clock, the alerts -
// and the game bar with the side's tools. Watching the computer play itself, the bar offers either
// side's chair and the view of either side or both. All of it in the world's pixel font, square
// borders, the colours of the unit panel.
(function () {
  const PW = window.PW;

  // N119 (the user's): the whole game UI simplified - text on plain black in the menu's phosphor green,
  // the buttons bracketed words (no boxes, no shadows, no gradients), the one in use lit.
  const CSS = `
  .gm { --ph: #6ef08a; --ph-dim: #3c9a58; --ph-lit: #d8ffe0; font: 16px 'Ithaca', Consolas, monospace; color: var(--ph);
    letter-spacing: 0.04em; -webkit-font-smoothing: none; }
  .gm button { font: inherit; color: var(--ph); background: none; border: none; padding: 1px 2px; cursor: pointer; letter-spacing: inherit; }
  .gm button:before { content: '[ '; color: var(--ph-dim); }
  .gm button:after { content: ' ]'; color: var(--ph-dim); }
  .gm button:hover { color: var(--ph-lit); }
  .gm button.on { color: #020402; background: var(--ph); }
  #gm-bar button.dim { color: var(--ph-dim); }
  #gm-bar button.go { border: 1px solid var(--ph-dim); padding: 0 8px; }
  #gm-bar button.go.lit { color: #020402; background: var(--ph); border-color: var(--ph); }
  .gm button.on:before, .gm button.on:after { color: #020402; }
  .gm button:disabled { color: #24503a; cursor: default; }
  .gm button:disabled:before, .gm button:disabled:after { color: #1c3a2a; }
  #gm-end { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #000; z-index: 20; }
  .gm .card { background: #000; padding: 18px 24px; min-width: 380px; }
  .gm h1 { font: 48px 'Ithaca', Consolas, monospace; margin: 0 0 4px; color: var(--ph); letter-spacing: 3px; font-weight: normal; }
  .gm h2 { font: 32px 'Ithaca', Consolas, monospace; margin: 0 0 10px; color: var(--ph); font-weight: normal; }
  .gm .sub { color: var(--ph-dim); margin-bottom: 14px; }
  .gm .go { margin-top: 14px; font-size: 24px; }
  #gm-top { position: fixed; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 14px; padding: 4px 10px;
    background: #000; z-index: 10; }
  #gm-top .side { color: var(--ph-lit); }
  #gm-top .res b { color: var(--ph-lit); font-weight: normal; }
  #gm-top .res i { font-style: normal; color: var(--ph-dim); }
  #gm-top .gap { flex: 1; }
  #gm-top .clock { color: var(--ph-lit); min-width: 56px; text-align: center; }
  #gm-bar { position: fixed; left: 0; bottom: 0; display: flex; flex-wrap: wrap; gap: 2px 8px; padding: 4px 8px; max-width: calc(100vw - 460px);
    background: #000; z-index: 10; }
  #gm-bar .grp { color: var(--ph-dim); margin-left: 10px; align-self: center; }
  #gm-quit { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.7); z-index: 30; }
  #gm-quit .card { text-align: center; font-size: 22px; }
  #gm-upg { position: fixed; inset: 0; pointer-events: none; z-index: 8; }
  #gm-upg button { position: absolute; pointer-events: auto; transform: translate(-50%, -100%); white-space: nowrap; background: #000; padding: 1px 4px; }
  #gm-alerts { position: fixed; left: 10px; top: 34px; display: flex; flex-direction: column; gap: 2px; z-index: 9; pointer-events: none; }
  #gm-alerts div { background: #000; padding: 1px 8px; }
  #gm-alerts div.good { color: var(--ph-lit); }
  #gm-alerts div.bad { color: #ff7a5c; }
  #unit-panel { top: 34px !important; background: #000 !important; border: none !important; color: #6ef08a !important;
    font: 15px 'Ithaca', Consolas, monospace !important; box-shadow: none !important; }
  #unit-panel h3 { font: 18px 'Ithaca', Consolas, monospace !important; color: #d8ffe0 !important; }
  #unit-panel kbd { background: none !important; border: none !important; color: #d8ffe0 !important; }
  #unit-panel .bar, #gm-sel .bar { background: #0a1a10 !important; border: none !important; }
  #unit-panel .bar i { background: #6ef08a !important; }
  #unit-panel .bar i.hurt { background: #e0c050 !important; }
  #unit-panel .bar i.grave { background: #ff7a5c !important; }
  #gm-sel { position: fixed; right: 8px; top: 34px; width: 250px; display: none; background: #000; padding: 8px; z-index: 10; }
  #gm-sel h3 { margin: 0 0 4px; font: 20px 'Ithaca', Consolas, monospace; color: var(--ph-lit); font-weight: normal; }
  #gm-sel .deploys { display: flex; flex-wrap: wrap; gap: 2px 8px; margin-top: 4px; }
  #gm-map { position: fixed; right: 0; bottom: 0; width: 440px; height: 70px; border: none; z-index: 10;
    image-rendering: pixelated; cursor: pointer; background: #000; }
  `;
  let styled = false;
  function style() {
    if (styled) return;
    styled = true;
    const el = document.createElement('style');
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  const make = (tag, attrs = {}, html = '') => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (html) el.innerHTML = html;
    return el;
  };

  // ---- The start screen and the mode menu (N118) ---------------------------------------------------
  // The user's: a start screen with a START button only, then the game-mode menu - the match, the map
  // size, the side, the aesthetic (R, B and P in place of the styles' names) - no difficulty. Phosphor
  // green text on a plain black screen (N119: no radar behind it, no scanlines, no glow): the UI lab's
  // layout and pixel font in the references' colours, their corner-bracket frame and centre line
  // drawn straight and even. A URL still skips
  // it all (start=versus|watch|test, side=, map=, style=, seed=) - the suites and a shared link do.
  // (maps: wide rectangles, four thousand cells tall - Terraria's shape; the old names still read)
  const MAPS = { small: 24064, medium: 36096, large: 48128 };
  const MAP_ALIAS = { laptop: 'small', standard: 'medium' };
  const MAP_TIME = { small: '5-10 MIN', medium: '10-20 MIN', large: '20+ MIN' };
  // (the aesthetics by letter - the user's: R for asian, B for modern, P for gothic)
  const STYLE_LETTER = { asian: 'R', modern: 'B', gothic: 'P' };
  const STYLE_OF = { R: 'asian', B: 'modern', P: 'gothic' };
  const MENU_CSS = `
  #gm-menu, #gm-loading { --ph: #6ef08a; --ph-dim: #3c9a58; --ph-faint: #173f26; --ph-bg: #020402;
    position: fixed; inset: 0; z-index: 20; background: var(--ph-bg); color: var(--ph); font: 22px 'Ithaca', Consolas, monospace;
    letter-spacing: 0.08em; text-transform: uppercase; -webkit-font-smoothing: none; user-select: none; }
  .ph-frame { position: absolute; inset: 4vh 4vw; }
  .ph-frame i { position: absolute; width: 56px; height: 56px; border-color: var(--ph); border-style: solid; border-width: 0; }
  .ph-frame i.tl { left: 0; top: 0; border-left-width: 3px; border-top-width: 3px; }
  .ph-frame i.tr { right: 0; top: 0; border-right-width: 3px; border-top-width: 3px; }
  .ph-frame i.bl { left: 0; bottom: 0; border-left-width: 3px; border-bottom-width: 3px; }
  .ph-frame i.br { right: 0; bottom: 0; border-right-width: 3px; border-bottom-width: 3px; }
  .ph-frame b.rule { position: absolute; left: 80px; right: 80px; height: 3px; background: var(--ph-dim); }
  .ph-frame b.rule.top { top: 0; } .ph-frame b.rule.bottom { bottom: 0; }
  #gm-menu .ph-screen { position: absolute; inset: 0; display: none; }
  #gm-menu .ph-screen.on { display: block; }
  #gm-menu h1 { position: absolute; left: 0; right: 0; top: 13vh; margin: 0; text-align: center; font: 13vh 'Ithaca', Consolas, monospace;
    letter-spacing: 0.14em; color: var(--ph); font-weight: normal; }
  #gm-menu .ph-line { position: absolute; left: 0; right: 0; top: 56vh; display: flex; align-items: center; gap: 28px; }
  #gm-menu .ph-line b { flex: 1; height: 3px; background: var(--ph-dim); }
  #gm-menu button { font: inherit; letter-spacing: inherit; text-transform: inherit; color: var(--ph); background: none; border: 0;
    padding: 4px 6px; cursor: pointer; box-shadow: none; }
  #gm-menu button:before { content: '[ '; color: var(--ph-dim); }
  #gm-menu button:after { content: ' ]'; color: var(--ph-dim); }
  #gm-menu button:hover, #gm-menu button:focus-visible { color: #d8ffe0; outline: none; }
  #gm-menu button:hover:before, #gm-menu button:hover:after, #gm-menu button:focus-visible:before, #gm-menu button:focus-visible:after { color: var(--ph); }
  #gm-menu button.start { font-size: 44px; animation: ph-pulse 1.6s steps(2) infinite; }
  @keyframes ph-pulse { 50% { color: var(--ph-dim); } }
  #gm-menu .ph-mode { position: absolute; inset: 9vh 8vw 9vh 8vw; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr auto;
    column-gap: 7vw; row-gap: 3vh; }
  #gm-menu .ph-mode h2 { grid-column: 1 / 3; margin: 0; font: 48px 'Ithaca', Consolas, monospace; letter-spacing: 0.14em; font-weight: normal; }
  #gm-menu .ph-col { display: flex; flex-direction: column; gap: 3.2vh; min-width: 0; }
  #gm-menu .ph-group > span { display: block; color: var(--ph); border-bottom: 3px solid var(--ph-dim); padding-bottom: 6px; margin-bottom: 10px; }
  #gm-menu .ph-opts { display: flex; flex-direction: column; gap: 4px; }
  #gm-menu .ph-opts.row { flex-direction: row; flex-wrap: wrap; gap: 4px 18px; }
  #gm-menu .ph-opt { display: grid; grid-template-columns: 26px auto 1fr; align-items: center; column-gap: 12px; cursor: pointer; padding: 2px 0; }
  #gm-menu .ph-opt:before { content: ''; width: 14px; height: 14px; border: 3px solid var(--ph-dim); justify-self: center; }
  #gm-menu .ph-opt.on:before { background: var(--ph); border-color: var(--ph); }
  #gm-menu .ph-opt:hover { color: #d8ffe0; }
  #gm-menu .ph-opt small { grid-column: 2 / 4; color: var(--ph-dim); font-size: 16px; }
  #gm-menu .ph-opt canvas { image-rendering: pixelated; justify-self: start; }
  #gm-menu .ph-styles { display: flex; gap: 22px; }
  #gm-menu .ph-style { display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; padding: 8px 10px 4px;
    border: 3px solid transparent; }
  #gm-menu .ph-style.on { border-color: var(--ph); }
  #gm-menu .ph-style b { font: 34px 'Ithaca', Consolas, monospace; font-weight: normal; }
  #gm-menu .ph-style canvas { image-rendering: pixelated; width: 96px; height: 128px; }
  #gm-menu .ph-foot { grid-column: 1 / 3; display: flex; justify-content: space-between; align-items: center; }
  #gm-menu .ph-foot .go { font-size: 34px; }
  #gm-menu .ph-hidden { visibility: hidden; }
  #gm-loading .ph-load { position: absolute; left: 20vw; right: 20vw; top: 44vh; }
  #gm-loading .ph-load h2 { margin: 0 0 18px; font: 40px 'Ithaca', Consolas, monospace; letter-spacing: 0.14em; font-weight: normal; }
  #gm-loading .ph-bar { height: 18px; border: 3px solid var(--ph-dim); padding: 3px; }
  #gm-loading .ph-bar i { display: block; height: 100%; width: 0; background: var(--ph);
    background-image: repeating-linear-gradient(90deg, transparent 0 9px, var(--ph-bg) 9px 12px); }
  #gm-loading [data-label] { margin-top: 12px; color: var(--ph-dim); font-size: 18px; }
  `;
  const FRAME = '<div class="ph-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><b class="rule top"></b><b class="rule bottom"></b></div>';
  // A style's look in phosphor: one of its towers, drawn from the building kit, each cell's light as
  // the menu's green.
  function stylePreview(canvas, style) {
    const T = PW.buildingTypes;
    if (!T || !T.population) return;
    let c = null;
    try { c = T.population({ style, level: 3, variant: 'slab', seed: 11, facing: 1, storeys: 4 }); } catch (e) { return; }
    const x0 = Math.max(0, c.body.left - 4), x1 = Math.min(c.width - 1, c.body.right + 4), y1 = c.ground;
    let y0 = 0;
    for (; y0 < y1; y0 += 1) { let any = false; for (let x = x0; x <= x1 && !any; x += 1) if (c.mat[y0 * c.width + x]) any = true; if (any) break; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const i = (y + y0) * c.width + (x + x0), o = (y * w + x) * 4;
      const p = c.mat[i] ? c.paint[i] : c.back[i];
      if (!p) continue;
      const [r, g, b] = PW.unpack(p);
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255 * (c.mat[i] ? 1 : 0.45);
      const k = Math.round(Math.min(1, 0.25 + lum * 1.1) * 4) / 4;   // (four steps of phosphor)
      img.data[o] = 110 * k; img.data[o + 1] = 240 * k; img.data[o + 2] = 138 * k; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    canvas.style.width = `${Math.round(128 * w / h)}px`;
  }
  // A map size as its own shape: the world a wide strip, the land's line across it.
  function mapPreview(canvas, width) {
    const w = Math.round(width / 300), h = Math.round(4096 / 300);
    canvas.width = w; canvas.height = h;
    canvas.style.width = `${w * 2}px`; canvas.style.height = `${h * 2}px`;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#173f26'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#6ef08a';
    for (let x = 0; x < w; x += 1) {
      const g = Math.round(h * 0.42 + Math.sin(x * 0.21) * 1.2 + Math.sin(x * 0.07 + 1) * 1.6);
      ctx.fillRect(x, g, 1, 1);
    }
    ctx.fillRect(0, 0, w, 1); ctx.fillRect(0, h - 1, w, 1); ctx.fillRect(0, 0, 1, h); ctx.fillRect(w - 1, 0, 1, h);
  }
  function menu({ seed, params, onStart }) {
    style();
    const choice = { mode: 'versus', human: 'left', map: 'medium', seed, test: false, style: null };
    const fromUrl = params.get('start');
    const mapOf = (name) => (MAPS[name] ? name : MAP_ALIAS[name] || 'medium');
    if (fromUrl) {
      // (N115: start=test - the gameplay test: you against the computer, each placing its capital)
      choice.mode = fromUrl === 'watch' ? 'watch' : 'versus';
      choice.test = fromUrl === 'test';
      // (towns=1: the world made with its home towns, the match played from them - the suites'
      // fixtures for what is not the opening; N120's opening is the game's)
      choice.towns = params.get('towns') === '1';
      choice.human = params.get('side') === 'right' ? 'right' : 'left';
      choice.map = mapOf(params.get('map'));
      const st = params.get('style');
      choice.style = st ? (STYLE_OF[st.toUpperCase()] || (STYLE_LETTER[st] ? st : null)) : null;
      onStart({ ...choice, width: MAPS[choice.map] });
      return;
    }
    if (!document.getElementById('gm-menu-css')) {
      const el = document.createElement('style');
      el.id = 'gm-menu-css'; el.textContent = MENU_CSS;
      document.head.appendChild(el);
    }
    const root = make('div', { id: 'gm-menu' });
    const opt = (attr, value, label, small = '', extra = '') => `<div class="ph-opt" data-${attr}="${value}" role="radio" tabindex="0">${extra}<span>${label}</span>${small ? `<small>${small}</small>` : ''}</div>`;
    root.innerHTML = `${FRAME}
      <section class="ph-screen ph-title on" data-screen="title">
        <h1>URBAN DEFENCE</h1>
        <div class="ph-line"><b></b><button class="start" data-act="enter">START</button><b></b></div>
      </section>
      <section class="ph-screen" data-screen="mode">
        <div class="ph-mode">
          <h2>SELECT MODE</h2>
          <div class="ph-col">
            <div class="ph-group"><span>MATCH</span><div class="ph-opts">
              ${opt('mode', 'versus', 'YOU VS COMPUTER', 'Destroy the enemy, raise your capital over its ruins')}
              ${opt('mode', 'watch', 'COMPUTER VS COMPUTER', 'Watch - take either side when you like')}
              ${opt('mode', 'test', 'GAMEPLAY TEST', 'You against the computer, everything built 4x as fast')}
            </div></div>
            <div class="ph-group"><span>MAP SIZE</span><div class="ph-opts">
              ${Object.keys(MAPS).map((k) => opt('map', k, k.toUpperCase(), MAP_TIME[k], '')).join('')}
            </div></div>
          </div>
          <div class="ph-col">
            <div class="ph-group" data-for="side"><span>SIDE</span><div class="ph-opts row">
              ${opt('side', 'left', 'LEFT')}${opt('side', 'right', 'RIGHT')}
            </div></div>
            <div class="ph-group" data-for="style"><span>AESTHETIC</span><div class="ph-styles">
              ${['R', 'B', 'P'].map((L) => `<div class="ph-style" data-style="${STYLE_OF[L]}" role="radio" tabindex="0"><canvas></canvas><b>${L}</b></div>`).join('')}
            </div></div>
          </div>
          <div class="ph-foot"><button data-act="back">BACK</button><button class="go" data-act="start">START</button></div>
        </div>
      </section>`;
    document.body.appendChild(root);
    // (each map size drawn to its own width, beside its name)
    root.querySelectorAll('.ph-opt[data-map]').forEach((el) => { const cv = document.createElement('canvas'); el.insertBefore(cv, el.querySelector('small')); mapPreview(cv, MAPS[el.dataset.map]); });
    root.querySelectorAll('.ph-style').forEach((el) => stylePreview(el.querySelector('canvas'), el.dataset.style));
    // (the side's aesthetic: the one the world's dice give it, until chosen)
    const pickAll = () => {
      root.querySelectorAll('[data-mode]').forEach((e) => e.classList.toggle('on', e.dataset.mode === (choice.test ? 'test' : choice.mode)));
      root.querySelectorAll('[data-map]').forEach((e) => e.classList.toggle('on', e.dataset.map === choice.map));
      root.querySelectorAll('[data-side]').forEach((e) => e.classList.toggle('on', e.dataset.side === choice.human));
      root.querySelectorAll('[data-style]').forEach((e) => e.classList.toggle('on', e.dataset.style === choice.style));
      // (watching, no side is the person's - nor an aesthetic)
      for (const g of root.querySelectorAll('[data-for]')) g.classList.toggle('ph-hidden', choice.mode === 'watch');
    };
    const show = (name) => {
      root.querySelectorAll('.ph-screen').forEach((s) => s.classList.toggle('on', s.dataset.screen === name));
      const first = root.querySelector(`[data-screen="${name}"] ${name === 'title' ? 'button' : '.go'}`);
      if (first) first.focus();
    };
    const begin = () => {
      root.remove();
      document.removeEventListener('keydown', onKey);
      onStart({ ...choice, width: MAPS[choice.map] });
    };
    const act = (el) => {
      if (!el) return;
      if (el.dataset.act === 'enter') show('mode');
      else if (el.dataset.act === 'back') show('title');
      else if (el.dataset.act === 'start') begin();
      else if (el.dataset.mode) { choice.test = el.dataset.mode === 'test'; choice.mode = choice.test ? 'versus' : el.dataset.mode; }
      else if (el.dataset.map) choice.map = el.dataset.map;
      else if (el.dataset.side) choice.human = el.dataset.side;
      else if (el.dataset.style) choice.style = el.dataset.style;
      pickAll();
    };
    root.addEventListener('click', (event) => act(event.target.closest('button, .ph-opt, .ph-style')));
    // (keys: Enter or Space on the start screen, or on what has the focus; Esc back)
    const onKey = (event) => {
      if (!root.isConnected) return;
      const onTitle = root.querySelector('[data-screen="title"]').classList.contains('on');
      if (event.key === 'Enter' || event.key === ' ') {
        const f = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
        act(onTitle ? root.querySelector('[data-act="enter"]') : f || root.querySelector('[data-act="start"]'));
        event.preventDefault();
      } else if (event.key === 'Escape' && !onTitle) show('title');
    };
    document.addEventListener('keydown', onKey);
    pickAll();
    show('title');
  }

  // ---- The loading screen --------------------------------------------------------------------------
  let loadingEl = null;
  function loading(fraction, label) {
    style();
    if (!document.getElementById('gm-menu-css')) {
      const el = document.createElement('style');
      el.id = 'gm-menu-css'; el.textContent = MENU_CSS;
      document.head.appendChild(el);
    }
    if (!loadingEl) {
      loadingEl = make('div', { id: 'gm-loading' }, `${FRAME}<div class="ph-load"><h2>MAKING THE WORLD</h2>
        <div class="ph-bar"><i></i></div><div data-label></div></div>`);
      document.body.appendChild(loadingEl);
    }
    loadingEl.querySelector('.ph-bar i').style.width = `${Math.round(fraction * 100)}%`;
    loadingEl.querySelector('[data-label]').textContent = label;
    if (fraction >= 1) { loadingEl.remove(); loadingEl = null; }
  }

  // ---- The match's HUD and game bar ----------------------------------------------------------------
  let match = null, app = null, top = null, bar = null, alerts = null, endEl = null;
  let gameTool = 'select', cursor = null, refreshAt = 0;
  const rates = { at: 0, last: null, perMin: {} };
  // (N119: one short row - the tools grouped under a dim word, the names cut to the bone; the prices
  // HM+SM. N122: a city is raised by the button over it, not a tool.)
  const TOOLS = [
    { id: 'select', label: 'SELECT', tip: 'Click a unit to select it; drag to pan' },
    { id: 'seed:capital', group: 'SEED', label: 'CAPITAL', tip: 'Plant a capital seed in your vision' },
    { id: 'seed:farm', label: 'FARM', tip: 'Plant a farm seed in your vision' },
    { id: 'seed:military', label: 'MILITARY', tip: 'Plant a military seed in your vision' },
    // N103: a turret set on its base on flat ground (or a tunnel room's floor) in your vision
    { id: 'turret', group: 'BUILD', label: 'TURRET 60', tip: 'Set a turret on its base on flat ground in your vision (60 HM)' },
    // N114: the missile artillery, set on a base like a turret - out under the sky
    { id: 'art:launcher', label: 'ROCKETS 70+15', tip: 'Set a rocket launcher on its base on flat ground open to the sky, in your vision (70 HM, 15 SM)' },
    { id: 'art:dome', label: 'DOME 90+15', tip: 'Set an Iron Dome on its base on flat ground open to the sky, in your vision (90 HM, 15 SM)' },
    { id: 'art:patriot', label: 'PATRIOT 120+20', tip: 'Set a Patriot on its base on flat ground open to the sky, in your vision (120 HM, 20 SM)' },
    // N116: HM rushes a tunnel's works
    { id: 'rush', label: 'RUSH 50', tip: 'Click one of your tunnels: its next 4 minutes of growth in 1 (50 HM)' },
  ];

  let cmd = null, attachedAt = 0, slowTold = false, fpsSum = 0, fpsN = 0;
  function attach(m, a) {
    style();
    match = m; app = a;
    attachedAt = performance.now();
    cmd = PW.command.create({ world: m.world, side: () => match.human, order: (units, ord) => PW.game.order(match, units, ord) });
    selEl = make('aside', { id: 'gm-sel', class: 'gm' });
    selEl.addEventListener('click', onSelClick);
    mapEl = make('canvas', { id: 'gm-map', width: MAP_W, height: MAP_H, title: 'Click to look there' });
    mapCtx = mapEl.getContext('2d');
    mapEl.addEventListener('click', onMapClick);
    document.body.append(selEl, mapEl);
    top = make('div', { id: 'gm-top', class: 'gm' },
      '<span data-info style="display:flex;gap:14px"></span><span class="gap"></span><span class="clock"></span><span class="gap"></span><span data-ctl style="display:flex;gap:4px"></span>');
    bar = make('div', { id: 'gm-bar', class: 'gm' });
    alerts = make('div', { id: 'gm-alerts', class: 'gm' });
    document.body.append(top, bar, alerts);
    // (N115: the test opens with the capital seed in hand - the side's starting capital)
    gameTool = match.phase === 'placing' && match.human ? 'seed:capital' : 'select';
    renderBar();
    top.addEventListener('click', onTopClick);
    bar.addEventListener('click', onBarClick);
    // (look at the side being played, or the left capital when watching: half a cell a pixel, the
    // whole capital in view)
    const home = match.sides[match.human || 'left'].home;
    app.focus(home, (app.world.groundTop[home] || 1600) - 200, 3);
    refresh(performance.now(), true);
  }

  // The side the HUD reads out: the one played, else the one viewed (left when viewing both).
  const viewSide = () => match.human || (match.view === 'right' ? 'right' : 'left');
  const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function refresh(now, force = false) {
    if (!match || (!force && now - refreshAt < 250)) return;
    refreshAt = now;
    const side = viewSide(), st = match.sides[side], p = PW.game.purse(match, side);
    // (what the stock brings in: per minute of match time, sampled every 5 s)
    if (match.clock - rates.at >= 5 || !rates.last) {
      if (rates.last && match.clock > rates.at) {
        const k = 60 / (match.clock - rates.at);
        for (const r of ['hm', 'sm', 'water']) rates.perMin[r] = (p[r] - rates.last[r]) * k;
      }
      rates.at = match.clock; rates.last = p;
    }
    const rate = (r) => (rates.perMin[r] === undefined ? '' : ` <i>${rates.perMin[r] >= 0 ? '+' : ''}${fmt(rates.perMin[r])}/m</i>`);
    top.querySelector('[data-info]').innerHTML = `<span class="side">${side.toUpperCase()} · ${STYLE_LETTER[st.style] || st.style.toUpperCase()}${match.human === side ? ' (YOU)' : ' (COMPUTER)'}</span>` +
      `<span class="res">HM <b>${fmt(p.hm)}</b>${rate('hm')}</span><span class="res">SM <b>${fmt(p.sm)}</b>${rate('sm')}</span>` +
      `<span class="res">WATER <b>${fmt(p.water)}</b>${rate('water')}</span><span class="res">POP <b>${fmt(p.pop)}</b></span>` +
      `<span class="res">WORKERS <b>${fmt(p.workers)}</b></span>`;
    top.querySelector('.clock').textContent = clock(match.clock);
    // (the buttons are rebuilt only when what they show changes - a click is never lost to a redraw)
    const watch = match.mode === 'watch';
    const key = `${match.human}|${match.view}|${app.speed()}|${app.paused()}`;
    const ctl = top.querySelector('[data-ctl]');
    if (ctl.dataset.key !== key) {
      ctl.dataset.key = key;
      const chair = watch ? (match.human
        ? `<button data-act="handback">HAND BACK</button>`
        : `<button data-act="play" data-side="left">PLAY LEFT</button><button data-act="play" data-side="right">PLAY RIGHT</button>`) : '';
      const views = watch && !match.human ? ['left', 'both', 'right'].map((v) => `<button data-act="view" data-view="${v}" class="${match.view === v ? 'on' : ''}">${v.toUpperCase()}</button>`).join('') : '';
      const speeds = [1, 2, 4].map((k) => `<button data-act="speed" data-k="${k}" class="${app.speed() === k ? 'on' : ''}">${k}x</button>`).join('');
      ctl.innerHTML = `${views}${chair}<button data-act="pause" class="${app.paused() ? 'on' : ''}">PAUSE</button>${speeds}`;
    }
    // The alert list: the last few lines for this side (or everyone), fading after a while.
    const lines = match.log.filter((l) => (l.side === null || l.side === side || match.view === 'both') && match.clock - l.t < 14).slice(-5);
    alerts.innerHTML = lines.map((l) => `<div class="${l.tone}">${l.text}</div>`).join('');
    if (match.over && !endEl) showEnd();
    // (a slow machine - a laptop on the full map - is told once what to do about it)
    if (!slowTold && now - attachedAt > 12000 && app.fps() > 0) {
      fpsSum += app.fps(); fpsN += 1;
      if (fpsN >= 20) {
        slowTold = true;
        if (fpsSum / fpsN < 40 && app.world.width > MAPS.small) PW.game.alert(match, null, `Running at ${Math.round(fpsSum / fpsN)} fps here: for a smoother game start a new match on the SMALL map`, 'bad');
      }
    }
    // (the seed and deploy tools are for the side a person plays)
    bar.querySelectorAll('[data-tool^="seed:"], [data-tool^="art:"], [data-tool="turret"], [data-tool="rush"], [data-deploy], [data-deploy-go]').forEach((b) => { if (!match.human) b.disabled = true; else if (b.dataset.tool || b.dataset.deploy) b.disabled = false; });
    refreshDeploys();
    renderSel();
  }

  // The game bar: the tools, then a deploy button per unit kind - from the selected base, or else
  // from the base nearest the front that can.
  function renderBar() {
    const K = PW.game.UNIT_KINDS;
    const grp = (word) => `<span class="grp">${word}</span>`;
    bar.innerHTML = TOOLS.map((t) => `${t.group ? grp(t.group) : ''}<button data-tool="${t.id}" title="${t.tip}" class="${gameTool === t.id ? 'on' : ''}">${t.label}</button>`).join('') +
      grp('DEPLOY') +
      // (N116: each costs HM and SM both - shown HM+SM. N126, the user's: the kinds are options -
      // one picked at a time - and a single DEPLOY button lights when the picked one can go)
      Object.keys(K).map((k) => `<button data-deploy="${k}" class="opt${deployKind === k ? ' on' : ''}" title="Pick ${K[k].label.toLowerCase()} to deploy (${K[k].hm} HM, ${K[k].sm || 0} SM)">${K[k].label} ${K[k].hm}+${K[k].sm || 0}</button>`).join('') +
      `<button data-deploy-go="1" class="go" title="Deploy the picked unit">DEPLOY</button>`;
    deployKey = '';
  }
  let deployKey = '', deployKind = 'trooper';
  function refreshDeploys() {
    if (!match.human) return;
    const base = cmd.building && PW.game.ownerOf(cmd.building) === match.human && cmd.building.type === 'military' ? cmd.building : null;
    const can = Object.keys(PW.game.UNIT_KINDS).map((k) => PW.game.canDeploy(match, match.human, k, base));
    const key = `${deployKind}|${can.map((c) => (c.ok ? '1' : c.note)).join('|')}`;
    if (key === deployKey) return;
    deployKey = key;
    // (an option that cannot go now is dimmed, but may still be picked; DEPLOY lights for the picked one)
    bar.querySelectorAll('[data-deploy]').forEach((b, i) => {
      b.classList.toggle('dim', !can[i].ok);
      b.classList.toggle('on', b.dataset.deploy === deployKind);
      b.title = can[i].ok ? `Pick ${PW.game.UNIT_KINDS[b.dataset.deploy].label.toLowerCase()} to deploy` : `${PW.game.UNIT_KINDS[b.dataset.deploy].label}: ${can[i].note}`;
    });
    const go = bar.querySelector('[data-deploy-go]'), pick = Object.keys(PW.game.UNIT_KINDS).indexOf(deployKind);
    if (go) {
      const ok = pick >= 0 && can[pick].ok;
      go.disabled = !ok;
      go.classList.toggle('lit', ok);
      go.title = ok ? `Deploy a ${PW.game.UNIT_KINDS[deployKind].label.toLowerCase()}` : pick >= 0 ? can[pick].note : 'Pick a unit first';
    }
  }
  function deployPicked() {
    if (!match.human || !deployKind) return;
    const base = cmd.building && PW.game.ownerOf(cmd.building) === match.human && cmd.building.type === 'military' ? cmd.building : null;
    const r = PW.game.deploy(match, match.human, deployKind, base);
    if (PW.notify) PW.notify.flash(r.ok ? `${PW.game.UNIT_KINDS[deployKind].label} deployed` : r.note, r.ok ? 'good' : 'bad', 2);
    deployKey = '';
  }
  function setTool(id) {
    gameTool = id;
    renderBar();
    if (PW.notify) PW.notify.clear();
  }
  function onBarClick(event) {
    const b = event.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool === gameTool ? 'select' : b.dataset.tool);
    if (b.dataset.deploy && match.human) { deployKind = b.dataset.deploy; deployKey = ''; refreshDeploys(); }
    if (b.dataset.deployGo && match.human) deployPicked();
  }
  function onTopClick(event) {
    const b = event.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'pause') app.setPaused(!app.paused());
    else if (act === 'speed') app.setSpeed(Number(b.dataset.k));
    else if (act === 'view') match.view = b.dataset.view;
    else if (act === 'play') PW.game.takeOver(match, b.dataset.side);
    else if (act === 'handback') { PW.game.handBack(match); setTool('select'); }
    refresh(performance.now(), true);
  }

  function showEnd() {
    const won = match.human ? match.winner === match.human : null;
    const title = match.winner ? (won === null ? `${match.winner.toUpperCase()} WINS` : won ? 'VICTORY' : 'DEFEAT') : 'MATCH OVER';
    endEl = make('div', { id: 'gm-end', class: 'gm' }, `<div class="card"><h1>${title}</h1><div class="sub">${match.reason || ''}</div>
      <button class="go" data-act="again">NEW MATCH</button></div>`);
    endEl.addEventListener('click', (event) => { if (event.target.closest('[data-act="again"]')) window.location.reload(); });
    document.body.appendChild(endEl);
  }

  // ---- The hand: selection, orders, the tools in hand ----------------------------------------------
  // A plain left click (one that does not drag) selects; a left drag pans; Shift+drag draws a box;
  // a right click sends the selection (a unit in hand fires instead - N102). With a seed in hand a
  // left click plants it.
  const down = { x: 0, y: 0, on: false, box: false };
  function pointerDown(event, p) {
    if (!match) return false;
    if (event.button === 0 && gameTool.startsWith('seed:')) {
      if (!match.human) return true;
      const kind = gameTool.slice(5);
      // (N115: the test's opening - the capital seed in hand is the side's starting capital)
      const first = match.phase === 'placing' && kind === 'capital';
      const r = first ? PW.game.placeStart(match, match.human, p.x) : PW.game.seed(match, match.human, kind, p.x);
      if (PW.notify) PW.notify.flash(r.ok ? (first ? 'Your starting capital is placed' : `${kind} seed planted`) : `Seed refused: ${r.note}`, r.ok ? 'good' : 'bad', 2.5);
      if (r.ok) setTool('select');
      return true;
    }
    if (event.button === 0 && gameTool === 'turret') {
      if (!match.human) return true;
      const r = PW.game.placeTurret(match, match.human, p.x, p.y);
      if (PW.notify) PW.notify.flash(r.ok ? 'Turret set on its base' : `Turret: ${r.note}`, r.ok ? 'good' : 'bad', 2.5);
      if (r.ok) setTool('select');
      return true;
    }
    // N114: a launcher or an interceptor set on its base
    if (event.button === 0 && gameTool.startsWith('art:')) {
      if (!match.human) return true;
      const type = gameTool.slice(4), A = PW.game.ARTILLERY[type];
      const r = PW.game.placeArtillery(match, match.human, type, p.x);
      if (PW.notify) PW.notify.flash(r.ok ? `${A.label} set on its base` : `${A.label}: ${r.note}`, r.ok ? 'good' : 'bad', 2.5);
      if (r.ok) setTool('select');
      return true;
    }
    // N116: a tunnel's works rushed, paid in HM (a city is raised by the button over it - N122)
    if (event.button === 0 && gameTool === 'rush') {
      if (!match.human) return true;
      const r = PW.game.rushTunnel(match, match.human, p.x, p.y);
      if (PW.notify) PW.notify.flash(r.ok ? 'Tunnel works rushed' : `Rush: ${r.note}`, r.ok ? 'good' : 'bad', 2.5);
      if (r.ok) setTool('select');
      return true;
    }
    // N102: the unit in hand fires where the person clicks - left its weapon, right its second (a
    // grenade, the other round, a missile); a click on an enemy is a shot at it, on another unit of
    // one's own takes that one instead. Shift keeps the hand's other ways: Shift+click and
    // Shift+drag select, Shift+right-click sends it on an order (go, attack, hack).
    const held = inHand();
    if (held && !event.shiftKey && (event.button === 0 || event.button === 2)) {
      const other = cmd.unitAt(p.x, p.y);
      const friend = other && other !== held.t && cmd.mine(other);
      if (!friend) { if (other !== held.t) app.clickUnit(held, p, event.button); return true; }
      if (event.button === 2) return true;   // (never a shot at one's own)
    }
    if (event.button === 2) {
      if (!cmd.sel.some(cmd.mine)) return false;   // (nothing to send: a right drag pans)
      const n = cmd.command(p);
      if (n && PW.notify) PW.notify.flash(`${n} sent`, '', 1.2);
      return true;
    }
    if (event.button !== 0) return false;
    if (event.shiftKey) { cmd.boxStart(p); down.box = true; return true; }
    down.on = true; down.x = event.clientX; down.y = event.clientY;
    return false;
  }
  function pointerMove(event, p) {
    cursor = p;
    if (!match) return;
    if (down.box) cmd.boxMove(p);
    if (gameTool === 'turret' && match.human) {
      const sees = !PW.vision || PW.vision.sees(match.world, match.human, Math.round(p.x));
      const can = PW.game.canTurret(match, match.human);
      if (PW.notify) PW.notify.cursor(!sees ? 'Beyond your vision' : can.ok ? 'Set a turret here (flat ground)' : `Turret: ${can.note}`, sees && can.ok ? '' : 'bad');
      return;
    }
    if (gameTool.startsWith('art:') && match.human) {
      const type = gameTool.slice(4), A = PW.game.ARTILLERY[type];
      const sees = !PW.vision || PW.vision.sees(match.world, match.human, Math.round(p.x));
      const can = PW.game.canArtillery(match, match.human, type);
      if (PW.notify) PW.notify.cursor(!sees ? 'Beyond your vision' : can.ok ? `Set ${A.label.toLowerCase()} here (flat ground, open sky)` : `${A.label}: ${can.note}`, sees && can.ok ? '' : 'bad');
      return;
    }
    if (gameTool === 'rush' && match.human) {
      const net = PW.game.tunnelAt(match, match.human, p.x, p.y);
      const rushed = net && net.rushUntil > PW.tunnels.state(match.world).time;
      if (PW.notify) PW.notify.cursor(!net ? 'Point into one of your tunnels' : rushed ? 'Rushed already'
        : `Rush these works: ${PW.game.RUSH.hm} HM`, net && !rushed ? '' : 'bad');
      return;
    }
    if (!gameTool.startsWith('seed:') || !match.human) return;
    // (the note reads the same preview the line is drawn from: why it can't, or what it will be)
    const kind = gameTool.slice(5), first = match.phase === 'placing' && kind === 'capital';
    const look = seedLook(Math.round(p.x));
    if (PW.notify) PW.notify.cursor(look.ok ? (first ? 'Place your core here (free)' : `Plant a ${kind} seed here`) : look.note, look.ok ? '' : 'bad');
  }
  function pointerUp(event, p) {
    if (!match) return;
    if (down.box) { down.box = false; cmd.boxEnd(p, true); selectionChanged(); return; }
    if (!down.on) return;
    down.on = false;
    if (Math.abs(event.clientX - down.x) + Math.abs(event.clientY - down.y) > 5) return;   // (that was a pan)
    cmd.click(p, event.shiftKey);
    selectionChanged();
  }
  // One unit of one's own selected is also held - its keys drive it and its panel shows (N78) - and
  // it is in the person's hands at once (N102): it drops whatever it was doing and stands, moving
  // only while its keys are held. A group or a building gets the selection panel.
  const N78_KIND = { trooper: 'troop', mech: 'mech', jet: 'jet', defence: 'defence' };
  function selectionChanged() {
    const own = cmd.sel.filter(cmd.mine);
    const one = own.length === 1 && cmd.sel.length === 1 ? own[0] : null;
    const was = app.selected && app.selected();
    if (one) app.select({ kind: N78_KIND[one.kind] || 'tank', t: one });
    else app.select(null);
    if (one && (!was || was.t !== one)) {
      tookControl();
      // (a jet cannot stand - it flies on; the batteries' guns are their own)
      if (one.kind !== 'jet' && one.kind !== 'defence' && PW.units && PW.units.order) PW.units.order(match.world, one, { type: 'hold' });
    }
    selKey = '';
    renderSel();
  }
  // The unit in hand: the one unit of one's own selected (null: none, a group, a building).
  function inHand() {
    const s = app.selected && app.selected();
    return s && cmd.sel.length === 1 && cmd.sel[0] === s.t && cmd.mine(s.t) && !s.t.dead ? s : null;
  }
  // (in hand, or a key a held unit took: it is the person's now, off its own way until they leave it be)
  function tookControl() {
    const u = cmd.sel.length === 1 ? cmd.sel[0] : null;
    if (!u || !u.game || !cmd.mine(u)) return;
    u.game.order = { type: 'manual' };
    u.game.manualAt = match.clock;
  }
  // The game's keys: WASD and the arrows pan the view (the unit in hand takes them first), Esc lets
  // the selection go, H holds the selection where it stands and Q sends it on its own way again - a
  // unit in hand let go of with it (in hand, it would only stand).
  const PAN_KEYS = { KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0], KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1] };
  // (the user's: Esc asks before it quits - YES back to the start screen, NO or Esc again goes on; the
  // match waits while it asks)
  let quitEl = null, quitWasPaused = false;
  function askQuit() {
    if (quitEl) return;
    quitWasPaused = app.paused();
    app.setPaused(true);
    quitEl = make('div', { id: 'gm-quit', class: 'gm' }, '<div class="card"><h2>QUIT THE MATCH?</h2><button data-q="yes">YES</button> <button data-q="no">NO</button></div>');
    quitEl.addEventListener('click', (event) => {
      const b = event.target.closest('button[data-q]');
      if (!b) return;
      if (b.dataset.q === 'yes') location.href = location.pathname + (/(^|[?&])mode=game/.test(location.search) ? '?mode=game' : '');
      else closeQuit();
    });
    document.body.appendChild(quitEl);
    quitEl.querySelector('[data-q="no"]').focus();
  }
  function closeQuit() {
    if (!quitEl) return;
    quitEl.remove(); quitEl = null;
    app.setPaused(quitWasPaused);
  }
  function key(event) {
    if (!match) return false;
    if (quitEl) {
      if (event.code === 'Escape' || event.code === 'KeyN') closeQuit();
      else if (event.code === 'KeyY' || event.code === 'Enter') quitEl.querySelector(`[data-q="${event.code === 'KeyY' ? 'yes' : document.activeElement && document.activeElement.dataset.q || 'no'}"]`).click();
      return true;
    }
    if (event.code === 'Escape') {
      // (first it lets go of what is in hand - a selection, a tool; with nothing, it asks to quit)
      if (cmd.sel.length || cmd.building || gameTool !== 'select') { cmd.clear(); setTool('select'); selectionChanged(); return true; }
      askQuit();
      return true;
    }
    const own = cmd.sel.filter(cmd.mine);
    if (event.code === 'KeyH' && own.length) { PW.game.order(match, own, { type: 'hold' }); return true; }
    if (event.code === 'KeyQ' && own.length) {
      if (inHand()) { cmd.clear(); selectionChanged(); }
      PW.game.order(match, own, { type: 'auto' });
      return true;
    }
    const pan = PAN_KEYS[event.code];
    if (pan) { app.renderer.panByDevice(-pan[0] * 90 * app.renderer.view.dpr, -pan[1] * 90 * app.renderer.view.dpr); return true; }
    return false;
  }

  // ---- The selection panel: a group, or a building (a base of one's own deploys from it) ----------
  let selEl = null, selKey = '';
  const BUILDING_NAMES = { population: 'TOWER', military: 'MILITARY', farm: 'FARM', core: 'BASE CORE', mine: 'MINE', joint: 'JOINT' };
  function renderSel() {
    if (!selEl) return;
    const own = cmd.sel.filter(cmd.mine);
    const b = cmd.building;
    if (!b && own.length <= 1) { selEl.style.display = 'none'; selKey = ''; return; }
    const G = PW.game, side = match.human;
    if (b) {
      const owner = G.ownerOf(b) || 'neutral', mineB = owner === side;
      const kinds = Object.keys(G.UNIT_KINDS);
      const can = mineB && b.type === 'military' ? kinds.map((k) => G.canDeploy(match, side, k, b)) : [];
      const key = `b${b.id}|${owner}|${b.level}|${can.map((c) => (c.ok ? 1 : 0)).join('')}|${b.coresOpen ? 1 : 0}`;
      if (key === selKey) return;
      selKey = key;
      const health = Math.round((b.health ?? 1) * 100);
      selEl.innerHTML = `<h3>${BUILDING_NAMES[b.type] || (b.type || 'BUILDING').toUpperCase()} · LV ${b.level || 1}</h3>` +
        `<div>${owner.toUpperCase()}${mineB ? ' (YOURS)' : ''} · ${b.coresOpen ? 'RUINED' : `standing ${health}%`}</div>` +
        (can.length ? `<div class="sub" style="margin-top:6px">DEPLOY FROM HERE</div><div class="deploys">${kinds.map((k, i) =>
          `<button data-deploy="${k}" ${can[i].ok ? '' : 'disabled'} title="${can[i].ok ? '' : can[i].note}">${G.UNIT_KINDS[k].label} ${G.UNIT_KINDS[k].hm}</button>`).join('')}</div>` : '');
    } else {
      const counts = {};
      for (const u of own) { const k = G.kindOf(u); counts[k] = (counts[k] || 0) + 1; }
      const key = `g${Object.entries(counts).map(([k, n]) => k + n).join(',')}`;
      if (key === selKey) return;
      selKey = key;
      selEl.innerHTML = `<h3>${own.length} SELECTED</h3><div>${Object.entries(counts).map(([k, n]) => `${n} ${(G.UNIT_KINDS[k] || { label: k }).label}`).join(' · ')}</div>` +
        `<div class="sub" style="margin-top:6px">right-click: go / attack</div>` +
        `<div class="deploys"><button data-order="hold">HOLD (H)</button><button data-order="auto">ON THEIR OWN (Q)</button></div>`;
    }
    selEl.style.display = 'block';
  }
  function onSelClick(event) {
    const btn = event.target.closest('button');
    if (!btn || !match.human) return;
    if (btn.dataset.deploy && cmd.building) {
      const r = PW.game.deploy(match, match.human, btn.dataset.deploy, cmd.building);
      if (PW.notify) PW.notify.flash(r.ok ? `${PW.game.UNIT_KINDS[btn.dataset.deploy].label} deployed` : r.note, r.ok ? 'good' : 'bad', 2);
      selKey = '';
    }
    if (btn.dataset.order) PW.game.order(match, cmd.sel.filter(cmd.mine), { type: btn.dataset.order });
  }

  // ---- The minimap: the whole map, its buildings and the units the side can see -------------------
  let mapEl = null, mapCtx = null, mapAt = 0, profile = null, profileAt = -1e9;
  const MAP_W = 440, MAP_H = 70;
  function drawMap(now) {
    if (!mapEl || now - mapAt < 400) return;
    mapAt = now;
    const world = match.world, k = world.width / MAP_W, side = viewSide();
    // (the ground's skyline, sampled anew every 10 s: blasts and growth change it slowly)
    if (!profile || now - profileAt > 10000) {
      profileAt = now;
      profile = new Float32Array(MAP_W);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < MAP_W; i += 1) { const g = world.groundTop[Math.min(world.width - 1, Math.round((i + 0.5) * k))]; profile[i] = g; lo = Math.min(lo, g); hi = Math.max(hi, g); }
      profile.lo = lo; profile.hi = hi;
    }
    const yOf = (y) => 8 + (y - profile.lo + 200) / (profile.hi - profile.lo + 500) * (MAP_H - 14);
    const ctx = mapCtx;
    ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, MAP_W, MAP_H);
    ctx.fillStyle = '#3a3226';
    for (let i = 0; i < MAP_W; i += 1) { const y = yOf(profile[i]); ctx.fillRect(i, y, 1, MAP_H - y); }
    // (the fog: what the side does not see is dimmed)
    if (match.view !== 'both' || match.human) {
      const spans = PW.vision ? PW.vision.spans(world, side) : [[0, world.width]];
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      let x = 0;
      for (const [a, b] of spans) { if (a > x) ctx.fillRect(x / k, 0, (a - x) / k, MAP_H); x = Math.max(x, b); }
      if (x < world.width) ctx.fillRect(x / k, 0, (world.width - x) / k, MAP_H);
    }
    const tone = (owner) => (owner === side ? '#e8dcb0' : owner === 'neutral' || !owner ? '#8a9488' : '#ff8c96');
    for (const b of world.buildings || []) {
      if (!b || !b.body || b.dismantled || b.body.left < 0) continue;
      ctx.fillStyle = tone(PW.game.ownerOf(b));
      ctx.globalAlpha = b.coresOpen ? 0.35 : 1;
      const h = Math.max(2, (b.ground - b.body.top) / 120);
      ctx.fillRect(b.body.left / k, yOf(b.ground) - h, Math.max(1, (b.body.right - b.body.left) / k), h);
    }
    ctx.globalAlpha = 1;
    const both = match.view === 'both' && !match.human;
    for (const u of [...(world.troops || []), ...(world.tanks || []), ...(world.mechs || []), ...(world.jets || []), ...(world.defence || [])]) {
      if (u.dead) continue;
      if (!both && u.side !== side && PW.vision && !PW.vision.sees(world, side, u.x, (u.y ?? 0) - 12)) continue;
      ctx.fillStyle = tone(u.side);
      ctx.fillRect(Math.round(u.x / k) - 1, Math.round(yOf(u.y)) - 2, 2, 2);
    }
    // (the view's frame)
    const cam = app.renderer.camera, view = app.renderer.view;
    ctx.strokeStyle = '#c8dcb0'; ctx.lineWidth = 1;
    ctx.strokeRect(cam.x / k + 0.5, 1.5, view.width / cam.zoom / k, MAP_H - 3);
  }
  function onMapClick(event) {
    const r = mapEl.getBoundingClientRect(), world = match.world;
    const x = Math.round((event.clientX - r.left) / r.width * world.width);
    app.focus(x, (world.groundTop[Math.max(0, Math.min(world.width - 1, x))] || 1600) - 150);
  }

  // ---- Over the world: the fog, the selection, where a seed in hand would land ---------------------
  // N102: the view keeps the unit in hand in sight while it moves - its keys are its own now, not the
  // view's: walked out of the middle of the screen, the view comes after it. (Standing, it is left
  // be: the person may be looking about with a drag.)
  let followAt = null;
  function follow(renderer) {
    const s = inHand();
    if (!s) { followAt = null; return; }
    // N123 (the user's): the view keeps the selected unit centred - it comes after it as it moves
    // (swiftly, not in one jerk), and a drag only looks about until the unit moves again
    const u = s.t, moved = !followAt || Math.abs(u.x - followAt.x) + Math.abs(u.y - followAt.y) > 0.05;
    followAt = { x: u.x, y: u.y };
    if (!moved) return;
    const d = renderer.worldToDevice(u.x, u.y - 20), W = renderer.view.width, H = renderer.view.height;
    const dx = W / 2 - d.x, dy = H / 2 - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) renderer.panByDevice(dx * 0.25, dy * 0.25);
  }
  // ---- N122: the upgrade button over each of the side's cities -----------------------------------------
  // A seed never levels by itself (N116): over the main building of each of the person's cities a
  // button raises it - and the buildings round it - a level, for its price. It stands until the city is
  // fully grown, dimmed while it is short of HM; while its main is growing it says so.
  let upgEl = null;
  const upgButtons = new Map();
  function upgrades() {
    const side = match.human, eng = match.world.capitalGrowth;
    if (!upgEl) {
      upgEl = make('div', { id: 'gm-upg', class: 'gm' });
      upgEl.addEventListener('click', (event) => {
        const b = event.target.closest('button[data-city]');
        if (!b || b.disabled) return;
        const city = eng.cities.find((c) => c.id === Number(b.dataset.city));
        const r = city ? PW.game.upgrade(match, side, city) : { ok: false, note: 'gone' };
        if (PW.notify) PW.notify.flash(r.ok ? `${city.kind} raised to level ${r.level}` : `Upgrade: ${r.note}`, r.ok ? 'good' : 'bad', 2.5);
      });
      document.body.appendChild(upgEl);
    }
    const show = !!side && !!eng && match.phase !== 'placing' && !match.over;
    upgEl.style.display = show ? '' : 'none';
    if (!show) return;
    const live = new Set();
    for (const city of eng.cities) {
      if (city.faction !== side || city.fallen || !city.main || !city.main.placed || city.level >= eng.topLevel(city)) continue;
      const p = city.main.placed, at = app.toClient((p.x0 + p.x1) / 2, p.y0 - 6);
      if (at.x < 0 || at.x > innerWidth || at.y < 40 || at.y > innerHeight - 60) continue;
      live.add(city.id);
      let b = upgButtons.get(city.id);
      if (!b) { b = make('button', { 'data-city': String(city.id) }); upgEl.appendChild(b); upgButtons.set(city.id, b); }
      const rec = match.world.buildings[city.main.owner - 1];
      // (N122: growing, it says so - and may be raised again all the same; each raise starts its
      // growing time over)
      const growing = !!rec && (rec.underConstruction || (rec.health ?? 1) < 0.98);
      const can = PW.game.canUpgrade(match, side, city);
      const text = `UPGRADE LV ${city.level}>${city.level + 1} · ${PW.game.upgradeCost(city)} HM${growing ? ' · GROWING' : ''}`;
      if (b.textContent !== text) b.textContent = text;
      b.disabled = !can.ok;
      b.title = can.ok ? `Raise ${city.kind} ${city.id} and the buildings round it a level${growing ? ' (it is still growing from its last)' : ''}` : can.note;
      b.style.left = `${Math.round(at.x)}px`; b.style.top = `${Math.round(at.y)}px`;
    }
    for (const [id, b] of upgButtons) if (!live.has(id)) { b.remove(); upgButtons.delete(id); }
  }
  function drawWorld(renderer, now) {
    refresh(now);
    if (!match) return;
    upgrades();
    follow(renderer);
    const { ctx, camera, view } = renderer, z = camera.zoom, world = match.world;
    // The fog: the ground the side does not see is veiled (the other side's units in it are not its
    // to see - PS's draws skip them as the fog query lands there).
    // N123 (the user's): ground never seen is black; ground seen but out of sight now is grey,
    // showing what it was when last seen (the renderer holds those chunks' pictures).
    const fogged = (match.view !== 'both' || match.human) && PW.vision && !PW.FOG_OFF;
    world.fogSide = fogged ? viewSide() : null;
    if (fogged) {
      const T = PW.vision.TILE, x0 = camera.x, y0 = camera.y, x1 = camera.x + view.width / z, y1 = camera.y + view.height / z;
      const grey = [], black = [];
      PW.vision.fogRuns(world, world.fogSide, x0, y0, x1, y1, (state, c, r0, r1) => (state ? grey : black).push(c, r0, r1));
      const rect = (list) => {
        for (let k = 0; k < list.length; k += 3) {
          const left = Math.floor((list[k] * T - camera.x) * z), top = Math.floor((list[k + 1] * T - camera.y) * z);
          ctx.fillRect(left, top, Math.ceil(((list[k] + 1) * T - camera.x) * z) - left, Math.ceil(((list[k + 2] + 1) * T - camera.y) * z) - top);
        }
      };
      if (grey.length) {
        // (drained of colour, then dimmed)
        ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; rect(grey);
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(8, 10, 12, 0.42)'; rect(grey);
      }
      ctx.fillStyle = '#000'; rect(black);
    }
    cmd.draw(renderer, now);
    drawMap(now);
    if (!cursor || !gameTool.startsWith('seed:') || !match.human) return;
    // N120/N112 (the user's): a line from the pointer down to the ground - green where the seed can
    // go, red where it can't - and where it can, the outline of what would stand there.
    const look = seedLook(Math.round(cursor.x));
    const x = look.x, g = world.groundTop[x] || cursor.y;
    const sx = Math.round((x + 0.5 - camera.x) * z), top = Math.round((Math.min(cursor.y, g - 4) - camera.y) * z), sy = Math.round((g - camera.y) * z);
    ctx.fillStyle = look.ok ? 'rgba(110, 240, 138, 0.95)' : 'rgba(255, 90, 70, 0.95)';
    ctx.fillRect(sx - Math.max(1, Math.round(z / 2)), top, Math.max(2, Math.round(z)), Math.max(2, sy - top));
    ctx.fillRect(sx - Math.round(4 * Math.max(1, z / 2)), sy - 1, Math.round(8 * Math.max(1, z / 2)), Math.max(2, Math.round(z)));
    if (!look.ok || !look.canvas) return;
    const cells = outlineOf(look.canvas), c = look.canvas, oy = look.floor - c.ground, s = Math.max(1, z);
    ctx.fillStyle = 'rgba(110, 240, 138, 0.55)';
    for (let k = 0; k < cells.length; k += 2) {
      const wx = look.worldX + cells[k], wy = oy + cells[k + 1];
      ctx.fillRect(Math.floor((wx - camera.x) * z), Math.floor((wy - camera.y) * z), Math.ceil(s), Math.ceil(s));
    }
  }
  // (the preview read at most once a few cells of the pointer's travel - the measure is not free)
  let lookAt = null;
  function seedLook(x) {
    const kind = gameTool.slice(5), start = match.phase === 'placing' && kind === 'capital';
    const key = `${kind}|${start}|${Math.round(x / 3)}|${match.phase}`;
    if (lookAt && lookAt.key === key && (performance.now() - lookAt.t) < 1000) return lookAt.look;
    const look = PW.game.seedPreview(match, match.human, kind, x, { start });
    lookAt = { key, look, t: performance.now() };
    return look;
  }
  // (a building's outline: its solid cells with open air beside them, as pairs of canvas x, y)
  const outlines = new WeakMap();
  function outlineOf(c) {
    let cells = outlines.get(c);
    if (cells) return cells;
    const out = [], W = c.width, solid = (x, y) => x >= 0 && y >= 0 && x < W && y < c.height && !!c.mat[y * W + x];
    for (let y = 0; y < c.height; y += 1) for (let x = 0; x < W; x += 1) {
      if (!solid(x, y)) continue;
      if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) out.push(x, y);
    }
    cells = Int32Array.from(out);
    outlines.set(c, cells);
    return cells;
  }

  PW.gameUI = { menu, loading, attach, pointerDown, pointerMove, pointerUp, key, tookControl, drawWorld, setTool,
    tool: () => gameTool, command: () => cmd, STYLE_LETTER };
})();
