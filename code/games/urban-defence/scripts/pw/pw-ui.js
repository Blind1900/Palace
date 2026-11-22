'use strict';
// The game's screens (N6): the match menu, the loading screen (N8's staged generation reports to it),
// and over the running match the HUD - the side's stock and what it brings in, the clock, the alerts -
// and the game bar with the side's tools. Watching the computer play itself, the bar offers either
// side's chair and the view of either side or both. All of it in the world's pixel font, square
// borders, the colours of the unit panel.
(function () {
  const PW = window.PW;

  const CSS = `
  .gm { font: 16px 'Ithaca', Consolas, monospace; color: #c8dcb0; }
  .gm button { font: inherit; color: #c8dcb0; background: #0b140f; border: 2px solid #2c4030; padding: 2px 10px 1px; cursor: pointer;
    box-shadow: 2px 2px 0 #000; }
  .gm button:hover { border-color: #4c7050; color: #e8f0d8; }
  .gm button.on { background: #2c4a30; color: #f0f6e0; border-color: #6a9a60; }
  .gm button:disabled { opacity: 0.4; cursor: default; }
  #gm-menu, #gm-loading, #gm-end { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(#0c1812 0%, #05080a 70%); z-index: 20; }
  #gm-end { background: #05080acc; }
  .gm .card { background: #08100ce8; border: 2px solid #3c5a40; box-shadow: 4px 4px 0 #000; padding: 18px 24px; min-width: 380px; }
  .gm h1 { font: 48px 'Ithaca', Consolas, monospace; margin: 0 0 4px; color: #e8f0d8; letter-spacing: 3px; }
  .gm h2 { font: 32px 'Ithaca', Consolas, monospace; margin: 0 0 10px; color: #e8f0d8; }
  .gm .sub { color: #7e9a70; margin-bottom: 14px; }
  .gm .row { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
  .gm .row > span { width: 92px; color: #9fb890; }
  .gm input { font: inherit; color: #e8f0d8; background: #0b140f; border: 2px solid #2c4030; padding: 1px 6px; width: 140px; }
  .gm .go { margin-top: 14px; font-size: 24px; padding: 4px 24px 2px; border-color: #6a9a60; }
  .gm .bar { height: 14px; background: #0b140f; border: 2px solid #2c4030; margin: 10px 0 6px; }
  .gm .bar i { display: block; height: 100%; width: 0; background: #6fae58; }
  #gm-top { position: fixed; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 14px; padding: 4px 10px;
    background: #05080ae0; border-bottom: 2px solid #2c4030; z-index: 10; }
  #gm-top .side { color: #e8f0d8; letter-spacing: 1px; }
  #gm-top .res b { color: #f0f6e0; font-weight: normal; }
  #gm-top .res i { font-style: normal; color: #7e9a70; }
  #gm-top .gap { flex: 1; }
  #gm-top .clock { color: #e8f0d8; min-width: 56px; text-align: center; }
  #gm-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 8px; display: flex; gap: 4px; padding: 4px;
    background: #05080ae0; border: 2px solid #2c4030; z-index: 10; }
  #gm-alerts { position: fixed; left: 10px; top: 40px; display: flex; flex-direction: column; gap: 3px; z-index: 9; pointer-events: none; }
  #gm-alerts div { background: #05080acc; border-left: 3px solid #3c5a40; padding: 1px 8px; }
  #gm-alerts div.good { border-color: #c8b040; color: #fff0b8; }
  #gm-alerts div.bad { border-color: #b04030; color: #ffc8b8; }
  #unit-panel { top: 44px !important; }
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

  // ---- The menu ------------------------------------------------------------------------------------
  // A person against the computer (either side), or the computer against itself; the map (the full
  // one, or a smaller one for a laptop); the seed. A URL can skip it (start=versus|watch, side=,
  // map=, seed=) - the suites and a shared link do.
  const MAPS = { standard: 36096, laptop: 24064 };
  function menu({ seed, params, onStart }) {
    style();
    const choice = { mode: 'versus', human: 'left', map: 'standard', seed };
    const fromUrl = params.get('start');
    if (fromUrl) {
      choice.mode = fromUrl === 'watch' ? 'watch' : 'versus';
      choice.human = params.get('side') === 'right' ? 'right' : 'left';
      choice.map = MAPS[params.get('map')] ? params.get('map') : 'standard';
      onStart({ ...choice, width: MAPS[choice.map] });
      return;
    }
    const root = make('div', { id: 'gm-menu', class: 'gm' });
    root.innerHTML = `<div class="card">
      <h1>URBAN DEFENCE</h1>
      <div class="sub">Destroy the enemy. Raise your capital over their ruins.</div>
      <div class="row"><span>MATCH</span><button data-mode="versus" class="on">YOU vs COMPUTER</button><button data-mode="watch">COMPUTER vs COMPUTER</button></div>
      <div class="row" data-for="side"><span>YOUR SIDE</span><button data-side="left" class="on">LEFT</button><button data-side="right">RIGHT</button></div>
      <div class="row"><span>MAP</span><button data-map="standard" class="on">STANDARD</button><button data-map="laptop">LAPTOP (SMALLER)</button></div>
      <div class="row"><span>SEED</span><input id="gm-seed" value="${seed}"><button data-act="reroll">NEW</button></div>
      <button class="go" data-act="start">START</button>
    </div>`;
    document.body.appendChild(root);
    const pick = (attr, value) => root.querySelectorAll(`[data-${attr}]`).forEach((b) => b.classList.toggle('on', b.dataset[attr] === value));
    root.addEventListener('click', (event) => {
      const b = event.target.closest('button');
      if (!b) return;
      if (b.dataset.mode) {
        choice.mode = b.dataset.mode; pick('mode', choice.mode);
        root.querySelector('[data-for="side"]').style.visibility = choice.mode === 'versus' ? 'visible' : 'hidden';
      }
      if (b.dataset.side) { choice.human = b.dataset.side; pick('side', choice.human); }
      if (b.dataset.map) { choice.map = b.dataset.map; pick('map', choice.map); }
      if (b.dataset.act === 'reroll') root.querySelector('#gm-seed').value = (Math.random() * 1e9) >>> 0;
      if (b.dataset.act === 'start') {
        choice.seed = Number(root.querySelector('#gm-seed').value) || ((Math.random() * 1e9) >>> 0);
        root.remove();
        onStart({ ...choice, width: MAPS[choice.map] });
      }
    });
  }

  // ---- The loading screen --------------------------------------------------------------------------
  let loadingEl = null;
  function loading(fraction, label) {
    style();
    if (!loadingEl) {
      loadingEl = make('div', { id: 'gm-loading', class: 'gm' }, `<div class="card"><h2>MAKING THE WORLD</h2>
        <div class="bar"><i></i></div><div class="sub" data-label></div></div>`);
      document.body.appendChild(loadingEl);
    }
    loadingEl.querySelector('.bar i').style.width = `${Math.round(fraction * 100)}%`;
    loadingEl.querySelector('[data-label]').textContent = label;
    if (fraction >= 1) { loadingEl.remove(); loadingEl = null; }
  }

  // ---- The match's HUD and game bar ----------------------------------------------------------------
  let match = null, app = null, top = null, bar = null, alerts = null, endEl = null;
  let gameTool = 'select', cursor = null, refreshAt = 0;
  const rates = { at: 0, last: null, perMin: {} };
  const TOOLS = [
    { id: 'select', label: 'SELECT', tip: 'Click a unit to select it; drag to pan' },
    { id: 'seed:capital', label: 'SEED CAPITAL', tip: 'Plant a capital seed in your vision' },
    { id: 'seed:farm', label: 'SEED FARM', tip: 'Plant a farm seed in your vision' },
    { id: 'seed:military', label: 'SEED MILITARY', tip: 'Plant a military seed in your vision' },
  ];

  function attach(m, a) {
    style();
    match = m; app = a;
    top = make('div', { id: 'gm-top', class: 'gm' },
      '<span data-info style="display:flex;gap:14px"></span><span class="gap"></span><span class="clock"></span><span class="gap"></span><span data-ctl style="display:flex;gap:4px"></span>');
    bar = make('div', { id: 'gm-bar', class: 'gm' });
    alerts = make('div', { id: 'gm-alerts', class: 'gm' });
    document.body.append(top, bar, alerts);
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
    top.querySelector('[data-info]').innerHTML = `<span class="side">${side.toUpperCase()} · ${st.style.toUpperCase()}${match.human === side ? ' (YOU)' : ' (COMPUTER)'}</span>` +
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
    // (the seed tools are for the side a person plays)
    bar.querySelectorAll('[data-tool^="seed:"]').forEach((b) => { b.disabled = !match.human; });
  }

  function renderBar() {
    bar.innerHTML = TOOLS.map((t) => `<button data-tool="${t.id}" title="${t.tip}" class="${gameTool === t.id ? 'on' : ''}">${t.label}</button>`).join('');
  }
  function setTool(id) {
    gameTool = id;
    renderBar();
    if (PW.notify) PW.notify.clear();
  }
  function onBarClick(event) {
    const b = event.target.closest('button');
    if (b && b.dataset.tool) setTool(b.dataset.tool === gameTool ? 'select' : b.dataset.tool);
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

  // ---- The tools in hand ---------------------------------------------------------------------------
  function pointerDown(event, p) {
    if (!match || !gameTool.startsWith('seed:')) return false;
    if (!match.human) return true;
    const kind = gameTool.slice(5);
    const r = PW.game.seed(match, match.human, kind, p.x);
    if (PW.notify) PW.notify.flash(r.ok ? `${kind} seed planted` : `Seed refused: ${r.note}`, r.ok ? 'good' : 'bad', 2.5);
    if (r.ok) setTool('select');
    return true;
  }
  function pointerMove(event, p) {
    cursor = p;
    if (!match || !gameTool.startsWith('seed:') || !match.human) return;
    const sees = !PW.vision || PW.vision.sees(match.world, match.human, Math.round(p.x));
    if (PW.notify) PW.notify.cursor(sees ? `Plant a ${gameTool.slice(5)} seed here` : 'Beyond your vision', sees ? '' : 'bad');
  }

  // Over the world: where a seed in hand would land.
  function drawWorld(renderer, now) {
    refresh(now);
    if (!match || !cursor || !gameTool.startsWith('seed:')) return;
    const { ctx, camera } = renderer, z = camera.zoom, world = match.world;
    const x = Math.round(cursor.x), g = world.groundTop[x] || cursor.y;
    const sx = Math.round((x - camera.x) * z), sy = Math.round((g - camera.y) * z);
    const sees = !match.human || !PW.vision || PW.vision.sees(world, match.human, x);
    ctx.fillStyle = sees ? 'rgba(255,236,170,0.9)' : 'rgba(255,120,100,0.9)';
    for (let k = 0; k < 9; k += 1) ctx.fillRect(sx - 1, sy - (k + 1) * 6 * Math.max(1, z / 2), Math.max(2, z), Math.max(2, 3 * z / 2));
  }

  PW.gameUI = { menu, loading, attach, pointerDown, pointerMove, drawWorld, setTool, tool: () => gameTool };
})();
