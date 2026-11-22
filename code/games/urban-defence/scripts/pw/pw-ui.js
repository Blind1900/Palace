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
  #gm-bar { position: fixed; left: 8px; bottom: 8px; display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; max-width: calc(100vw - 480px);
    background: #05080ae0; border: 2px solid #2c4030; z-index: 10; }
  #gm-alerts { position: fixed; left: 10px; top: 40px; display: flex; flex-direction: column; gap: 3px; z-index: 9; pointer-events: none; }
  #gm-alerts div { background: #05080acc; border-left: 3px solid #3c5a40; padding: 1px 8px; }
  #gm-alerts div.good { border-color: #c8b040; color: #fff0b8; }
  #gm-alerts div.bad { border-color: #b04030; color: #ffc8b8; }
  #unit-panel { top: 44px !important; }
  #gm-sel { position: fixed; right: 8px; top: 44px; width: 250px; display: none; background: #05080ae0; border: 2px solid #2c4030;
    padding: 8px; z-index: 10; }
  #gm-sel h3 { margin: 0 0 4px; font: 20px 'Ithaca', Consolas, monospace; color: #e8f0d8; letter-spacing: 1px; }
  #gm-sel .deploys { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  #gm-sel .deploys button { padding: 1px 6px; font-size: 14px; }
  #gm-map { position: fixed; right: 8px; bottom: 8px; width: 440px; height: 70px; border: 2px solid #2c4030; z-index: 10;
    image-rendering: pixelated; cursor: pointer; background: #05080a; }
  #gm-bar button[data-deploy] { font-size: 14px; padding: 2px 6px 1px; }
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
      <div class="sub" style="margin:14px 0 0;font-size:14px">Click selects · Shift+drag boxes · right-click sends · WASD pans · F3 costs ·
        <a href="beta-legacy.html" style="color:#7e9a70">old beta</a> · <a href="pixel-world.html" style="color:#7e9a70">sandbox</a></div>
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

  let cmd = null;
  function attach(m, a) {
    style();
    match = m; app = a;
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
    // (the seed and deploy tools are for the side a person plays)
    bar.querySelectorAll('[data-tool^="seed:"], [data-deploy]').forEach((b) => { if (!match.human) b.disabled = true; else if (b.dataset.tool) b.disabled = false; });
    refreshDeploys();
    renderSel();
  }

  // The game bar: the tools, then a deploy button per unit kind - from the selected base, or else
  // from the base nearest the front that can.
  function renderBar() {
    const K = PW.game.UNIT_KINDS;
    bar.innerHTML = TOOLS.map((t) => `<button data-tool="${t.id}" title="${t.tip}" class="${gameTool === t.id ? 'on' : ''}">${t.label}</button>`).join('') +
      '<span style="width:10px"></span>' +
      Object.keys(K).map((k) => `<button data-deploy="${k}" title="Deploy a ${K[k].label.toLowerCase()} (${K[k].hm} HM)">${K[k].label} ${K[k].hm}</button>`).join('');
    deployKey = '';
  }
  let deployKey = '';
  function refreshDeploys() {
    if (!match.human) return;
    const base = cmd.building && PW.game.ownerOf(cmd.building) === match.human && cmd.building.type === 'military' ? cmd.building : null;
    const can = Object.keys(PW.game.UNIT_KINDS).map((k) => PW.game.canDeploy(match, match.human, k, base));
    const key = can.map((c) => (c.ok ? '1' : c.note)).join('|');
    if (key === deployKey) return;
    deployKey = key;
    bar.querySelectorAll('[data-deploy]').forEach((b, i) => { b.disabled = !can[i].ok; b.title = can[i].ok ? b.title.replace(/ - .*/, '') : `${PW.game.UNIT_KINDS[b.dataset.deploy].label}: ${can[i].note}`; });
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
    if (b.dataset.deploy && match.human) {
      const base = cmd.building && PW.game.ownerOf(cmd.building) === match.human && cmd.building.type === 'military' ? cmd.building : null;
      const r = PW.game.deploy(match, match.human, b.dataset.deploy, base);
      if (PW.notify) PW.notify.flash(r.ok ? `${PW.game.UNIT_KINDS[b.dataset.deploy].label} deployed` : r.note, r.ok ? 'good' : 'bad', 2);
      deployKey = '';
    }
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
  // a right click sends the selection. With a seed in hand a left click plants it.
  const down = { x: 0, y: 0, on: false, box: false };
  function pointerDown(event, p) {
    if (!match) return false;
    if (event.button === 0 && gameTool.startsWith('seed:')) {
      if (!match.human) return true;
      const kind = gameTool.slice(5);
      const r = PW.game.seed(match, match.human, kind, p.x);
      if (PW.notify) PW.notify.flash(r.ok ? `${kind} seed planted` : `Seed refused: ${r.note}`, r.ok ? 'good' : 'bad', 2.5);
      if (r.ok) setTool('select');
      return true;
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
    if (!gameTool.startsWith('seed:') || !match.human) return;
    const sees = !PW.vision || PW.vision.sees(match.world, match.human, Math.round(p.x));
    if (PW.notify) PW.notify.cursor(sees ? `Plant a ${gameTool.slice(5)} seed here` : 'Beyond your vision', sees ? '' : 'bad');
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
  // One unit of one's own selected is also held - its keys drive it and its panel shows (N78);
  // a group or a building gets the selection panel.
  const N78_KIND = { trooper: 'troop', mech: 'mech', jet: 'jet', defence: 'defence' };
  function selectionChanged() {
    const own = cmd.sel.filter(cmd.mine);
    if (own.length === 1 && cmd.sel.length === 1) app.select({ kind: N78_KIND[own[0].kind] || 'tank', t: own[0] });
    else app.select(null);
    selKey = '';
    renderSel();
  }
  // (a key a held unit took: it is the person's now, off its own way until they leave it be)
  function tookControl() {
    const u = cmd.sel.length === 1 ? cmd.sel[0] : null;
    if (!u || !u.game || !cmd.mine(u)) return;
    u.game.order = { type: 'manual' };
    u.game.manualAt = match.clock;
  }
  // The game's keys: WASD and the arrows pan the view (a held unit takes them first), Esc lets the
  // selection go, H holds the selection where it stands and Q sends it on its own way again.
  const PAN_KEYS = { KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0], KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1] };
  function key(event) {
    if (!match) return false;
    if (event.code === 'Escape') { cmd.clear(); setTool('select'); selectionChanged(); return true; }
    const own = cmd.sel.filter(cmd.mine);
    if (event.code === 'KeyH' && own.length) { PW.game.order(match, own, { type: 'hold' }); return true; }
    if (event.code === 'KeyQ' && own.length) { PW.game.order(match, own, { type: 'auto' }); return true; }
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
      if (!both && u.side !== side && PW.vision && !PW.vision.sees(world, side, u.x)) continue;
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
  function drawWorld(renderer, now) {
    refresh(now);
    if (!match) return;
    const { ctx, camera, view } = renderer, z = camera.zoom, world = match.world;
    // The fog: the ground the side does not see is veiled (the other side's units in it are not its
    // to see - PS's draws skip them as the fog query lands there).
    if (match.view !== 'both' || match.human) {
      const spans = PW.vision ? PW.vision.spans(world, viewSide()) : [];
      const x0 = camera.x, x1 = camera.x + view.width / z;
      ctx.fillStyle = 'rgba(3, 5, 9, 0.55)';
      let x = x0;
      for (const [a, b] of spans) {
        if (b < x0) continue;
        if (a > x1) break;
        if (a > x) ctx.fillRect(Math.floor((x - camera.x) * z), 0, Math.ceil((a - x) * z), view.height);
        x = Math.max(x, b);
      }
      if (x < x1) ctx.fillRect(Math.floor((x - camera.x) * z), 0, Math.ceil((x1 - x) * z), view.height);
    }
    cmd.draw(renderer, now);
    drawMap(now);
    if (!cursor || !gameTool.startsWith('seed:')) return;
    const x = Math.round(cursor.x), g = world.groundTop[x] || cursor.y;
    const sx = Math.round((x - camera.x) * z), sy = Math.round((g - camera.y) * z);
    const sees = !match.human || !PW.vision || PW.vision.sees(world, match.human, x);
    ctx.fillStyle = sees ? 'rgba(255,236,170,0.9)' : 'rgba(255,120,100,0.9)';
    for (let k = 0; k < 9; k += 1) ctx.fillRect(sx - 1, sy - (k + 1) * 6 * Math.max(1, z / 2), Math.max(2, z), Math.max(2, 3 * z / 2));
  }

  PW.gameUI = { menu, loading, attach, pointerDown, pointerMove, pointerUp, key, tookControl, drawWorld, setTool,
    tool: () => gameTool, command: () => cmd };
})();
