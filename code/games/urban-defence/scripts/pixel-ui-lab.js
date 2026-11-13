(() => {
  'use strict';

  const STORAGE_KEY = 'urban-defence-ui-lab';
  const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  const SCREENS = [
    ['title', 'Title / main menu'], ['new-match', 'New match setup'], ['load', 'Load / save slots'], ['settings', 'Settings'],
    ['hud', 'In-game HUD'], ['pause', 'Pause overlay'], ['victory', 'Victory'], ['defeat', 'Defeat'], ['tutorial', 'Tutorial overlay']
  ];
  const WIDGETS = {
    resources: 'Resources', queue: 'Unit queue', building: 'Building panel', alerts: 'Alerts',
    minimap: 'Minimap', timer: 'Match timer', fps: 'FPS'
  };

  const DEFAULT_THEME = {
    bg: '#020202', text: '#d9d9d9', muted: '#7f7f7f', accent: '#b53201', highlight: '#ff9a4c', green: '#6ef08a',
    core: '#ffa414', blue: '#6aa8ff', red: '#ff4d3d', panel: '#0b0807', panelBorder: '#6c3a21',
    panelAlpha: 0.82, fontScale: 1, titleSize: 150, lineHeight: 1.25, spacing: 0.06, borderWidth: 2, menuY: 52,
    font: 'Ithaca', textCase: 'uppercase', buttons: 'brackets', menuAlign: 'left'
  };
  const THEME_COLORS = [['bg', 'Background'], ['text', 'Text'], ['muted', 'Muted'], ['accent', 'Accent'], ['highlight', 'Highlight'], ['green', 'Good / HM'], ['core', 'Core amber'], ['blue', 'Ally'], ['red', 'Enemy'], ['panel', 'Panel'], ['panelBorder', 'Panel border']];
  const THEME_RANGES = [['fontScale', 'Font scale', 0.6, 1.6, 0.05], ['titleSize', 'Title size', 60, 240, 2], ['lineHeight', 'Line height', 1, 1.8, 0.05], ['spacing', 'Letter spacing (em)', 0, 0.3, 0.01], ['borderWidth', 'Border width', 0, 6, 1], ['panelAlpha', 'Panel opacity', 0, 1, 0.02], ['menuY', 'Menu height %', 25, 80, 1]];
  const THEME_SELECTS = [
    ['font', 'Font', ['Ithaca', 'monospace', 'Arial']],
    ['textCase', 'Case', ['uppercase', 'none']],
    ['buttons', 'Buttons', ['brackets', 'boxed', 'underline']],
    ['menuAlign', 'Menu align', ['left', 'center', 'right']]
  ];

  const LAYOUT_PRESETS = {
    classic: {
      resources: 'top-left', timer: 'top-center', fps: 'top-right', alerts: 'middle-right',
      minimap: 'bottom-left', queue: 'bottom-center', building: 'bottom-right'
    },
    minimal: {
      resources: 'top-center', timer: 'top-right', fps: 'top-right', alerts: 'bottom-right',
      minimap: 'bottom-left', queue: 'bottom-left', building: 'bottom-right', hidden: ['building', 'fps', 'queue']
    },
    palace: {
      resources: 'top-left', alerts: 'top-right', timer: 'top-right', fps: 'top-right',
      minimap: 'bottom-right', queue: 'bottom-left', building: 'middle-left'
    }
  };

  function layoutFromPreset(name) {
    const preset = LAYOUT_PRESETS[name] || LAYOUT_PRESETS.classic;
    const hidden = new Set(preset.hidden || []);
    const widgets = {};
    Object.keys(WIDGETS).forEach(id => { widgets[id] = { anchor: preset[id] || 'top-left', visible: !hidden.has(id) }; });
    return { preset: name, margin: 32, widgets };
  }

  function defaults() {
    return { version: 1, screen: 'title', resolution: '2560x1440', backdrop: 'city', theme: { ...DEFAULT_THEME }, layout: layoutFromPreset('classic') };
  }

  function sanitize(input) {
    const base = defaults();
    if (!input || typeof input !== 'object') return base;
    const theme = { ...base.theme };
    Object.keys(theme).forEach(key => {
      const value = input.theme && input.theme[key];
      if (value === undefined) return;
      if (typeof theme[key] === 'number') { const n = Number(value); if (Number.isFinite(n)) theme[key] = n; }
      else if (typeof value === 'string' && (!/^#/.test(theme[key]) || /^#[0-9a-f]{6}$/i.test(value))) theme[key] = value;
    });
    const layout = layoutFromPreset((input.layout && input.layout.preset) || 'classic');
    if (input.layout) {
      if (Number.isFinite(Number(input.layout.margin))) layout.margin = Math.max(0, Math.min(100, Number(input.layout.margin)));
      Object.keys(WIDGETS).forEach(id => {
        const w = input.layout.widgets && input.layout.widgets[id];
        if (!w) return;
        if (ANCHORS.includes(w.anchor)) layout.widgets[id].anchor = w.anchor;
        if (typeof w.visible === 'boolean') layout.widgets[id].visible = w.visible;
      });
    }
    return {
      version: 1,
      screen: SCREENS.some(([id]) => id === input.screen) ? input.screen : base.screen,
      resolution: /^\d+x\d+$/.test(input.resolution || '') ? input.resolution : base.resolution,
      backdrop: ['city', 'none', 'image'].includes(input.backdrop) ? (input.backdrop === 'image' ? 'city' : input.backdrop) : base.backdrop,
      theme, layout
    };
  }

  function load() {
    try { return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (_) { return defaults(); }
  }

  let state = load();
  const params = new URLSearchParams(location.search);
  if (params.get('screen')) state.screen = SCREENS.some(([id]) => id === params.get('screen')) ? params.get('screen') : state.screen;
  if (params.get('res')) state.resolution = params.get('res');
  let onePixel = false;
  let backdropImage = null;

  const $ = id => document.getElementById(id);
  const stage = $('stage');
  const stageWrap = $('stage-wrap');
  const viewport = $('viewport');
  const screenEl = $('screen');
  const guides = $('guides');
  const backdrop = $('backdrop');
  const message = $('message');
  const exchange = $('exchange');

  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {} }
  function say(text) { message.textContent = text; }
  // Margin is authored at 2560x1440 and scales with the stage like the type does.
  function hudMargin() { const { w, h } = size(); return Math.round(state.layout.margin * (w < 800 ? 0.4 : Math.min(w / 2560, h / 1440))); }
  function size() { const [w, h] = state.resolution.split('x').map(Number); return { w: w || 2560, h: h || 1440 }; }

  // ---------- Pixel art helpers ----------
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  }

  function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }

  function drawSkyline(canvas, seed = 7, w = 320, h = 180) {
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const random = rng(seed);
    const bands = ['#120707', '#1d0b06', '#2a1007', '#3b1607', '#55200a', '#7a2f0d'];
    const bandH = Math.ceil(h * 0.62 / bands.length);
    bands.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * bandH, w, bandH); });
    ctx.fillStyle = '#ff9a4c';
    const sunX = Math.floor(w * 0.72), sunY = Math.floor(h * 0.42), r = Math.max(4, Math.floor(h * 0.08));
    for (let y = -r; y <= r; y++) { const span = Math.floor(Math.sqrt(r * r - y * y)); if ((y & 1) === 0 || y < 0) ctx.fillRect(sunX - span, sunY + y, span * 2, 1); }
    const layers = [['#2a1510', 0.56, 0.42, 0], ['#160c09', 0.66, 0.34, 0.5], ['#070505', 0.78, 0.25, 1]];
    layers.forEach(([color, base, tall, lit]) => {
      let x = -2;
      while (x < w) {
        const bw = 6 + Math.floor(random() * (w / 18));
        const bh = Math.floor(h * (0.08 + random() * tall));
        const top = Math.floor(h * base) - bh;
        ctx.fillStyle = color;
        ctx.fillRect(x, top, bw, h - top);
        if (random() < 0.35) ctx.fillRect(x + Math.floor(bw / 2), top - Math.floor(4 + random() * 10), 1, Math.floor(4 + random() * 10));
        if (lit) {
          for (let wy = top + 3; wy < h * 0.86; wy += 4) for (let wx = x + 2; wx < x + bw - 1; wx += 3) {
            if (random() < 0.18) { ctx.fillStyle = random() < 0.2 ? '#ffa414' : '#6e3a1c'; ctx.fillRect(wx, wy, 1, 1); }
          }
          ctx.fillStyle = color;
        }
        x += bw + Math.floor(random() * 3);
      }
    });
    ctx.fillStyle = '#3a2618';
    for (let x = 0; x < w; x++) { const g = Math.floor(h * 0.86 + Math.sin(x / 23 + seed) * 2 + Math.sin(x / 7) * 1); ctx.fillRect(x, g, 1, h - g); }
    ctx.fillStyle = '#21140c';
    ctx.fillRect(0, Math.floor(h * 0.92), w, h);
  }

  function drawBackdrop() {
    const ctx = backdrop.getContext('2d');
    backdrop.style.display = state.backdrop === 'none' ? 'none' : 'block';
    if (state.backdrop === 'image' && backdropImage) {
      backdrop.width = backdropImage.naturalWidth; backdrop.height = backdropImage.naturalHeight;
      ctx.drawImage(backdropImage, 0, 0);
      backdrop.style.objectFit = 'cover';
      backdrop.style.imageRendering = 'auto';
      return;
    }
    backdrop.style.imageRendering = 'pixelated';
    const { w, h } = size();
    drawSkyline(backdrop, 7, 320, Math.round(320 * h / w));
  }

  // ---------- Screens ----------
  const button = (label, attrs = '') => `<button type="button" class="game-button" ${attrs}>${label}</button>`;
  const go = target => `data-go="${target}"`;

  function menuScreen() {
    return `<div class="screen-menu" data-region="menu">
      <div class="eyebrow">PALACE · A PIXEL SIEGE</div>
      <h2>URBAN<br>DEFENCE</h2>
      <div class="subtitle">Every pixel is material. Build, mine, defend.</div>
      <nav class="menu-list" aria-label="Main menu">
        ${button('Continue', 'class="game-button selected" ' + go('hud'))}
        ${button('New match', go('new-match'))}
        ${button('Load game', go('load'))}
        ${button('Tutorial', go('tutorial'))}
        ${button('Settings', go('settings'))}
        ${button('Quit to Palace')}
      </nav></div>
      <div class="screen-footer"><span>v0.1 PROTOTYPE</span><span>SEED 2417 · FULL MAP</span><span>PALACE / GAMES</span></div>`;
  }

  function select(name, options, selected) {
    return `<select name="${name}">${options.map(o => `<option${o === selected ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
  }

  function newMatchScreen() {
    return `<div class="form-screen panel" data-region="form">
      <div class="eyebrow">NEW MATCH</div><h2>Match setup</h2>
      <p class="screen-intro">Choose how you play and how the city is generated.</p>
      <div class="form-grid">
        <div class="field"><fieldset><legend>Player role</legend>
          <label><input type="radio" name="role" checked> Commander (one faction)</label>
          <label><input type="radio" name="role"> God-view builder</label>
          <label><input type="radio" name="role"> Both</label></fieldset></div>
        <div class="field"><fieldset><legend>Faction</legend>
          <label><input type="radio" name="faction" checked> <span class="blue">West bloc</span></label>
          <label><input type="radio" name="faction"> <span class="red">East bloc</span></label></fieldset></div>
        <div class="field"><label>Building style</label>${select('style', ['Modern', 'Gothic', 'Asian', 'Mixed'], 'Mixed')}</div>
        <div class="field"><label>Difficulty</label>${select('difficulty', ['Recruit', 'Regular', 'Veteran', 'Siege'], 'Regular')}</div>
        <div class="field"><label>Map seed</label><div class="inline"><input value="2417" inputmode="numeric">${button('Random')}</div></div>
        <div class="field"><label>Map width</label><div class="inline"><input type="range" min="800" max="4000" value="1100"><span>1100</span></div></div>
        <div class="field full"><fieldset><legend>Win conditions</legend>
          <label><input type="checkbox" checked> Destroy the enemy military core</label>
          <label><input type="checkbox" checked> Enemy population collapse</label>
          <label><input type="checkbox"> Hold the city for 30:00</label></fieldset></div>
      </div>
      <div class="screen-actions">${button('Start match', go('hud'))}${button('Back', go('title'))}</div></div>`;
  }

  function loadScreen() {
    const slots = [['Slot 1', 'Seed 2417 · 18:42 · Modern', 'Autosave'], ['Slot 2', 'Seed 88 · 41:07 · Gothic', 'Manual'], ['Slot 3', 'Empty', '']];
    return `<div class="form-screen panel" data-region="form">
      <div class="eyebrow">WORLD SNAPSHOTS</div><h2>Load / save</h2>
      <p class="screen-intro">Snapshots store every particle, building and unit.</p>
      ${slots.map(([n, d, t], i) => `<div class="slot"><canvas data-thumb="${i}" width="150" height="80"></canvas>
        <div>${n}<small>${d}${t ? ' · ' + t : ''}</small></div>
        <div class="slot-actions">${d === 'Empty' ? button('Save') : button('Load', go('hud')) + button('Save') + button('Delete')}</div></div>`).join('')}
      <div class="screen-actions">${button('Back', go('title'))}</div></div>`;
  }

  function settingsScreen() {
    const range = (label, v) => `<div class="setting"><span>${label}</span><input type="range" min="0" max="100" value="${v}"></div>`;
    const check = (label, on) => `<div class="setting"><span>${label}</span><input type="checkbox"${on ? ' checked' : ''}></div>`;
    return `<div class="form-screen panel" data-region="form">
      <div class="eyebrow">OPTIONS</div><h2>Settings</h2>
      <p class="screen-intro">Changes apply immediately.</p>
      <div class="settings-grid">
        ${range('Master volume', 80)}${range('Effects', 70)}${range('Music', 45)}${range('Screen shake', 60)}
        ${check('Show FPS', true)}${check('Pixel-perfect scaling', true)}${check('Damage flashes', true)}${check('Edge scrolling', false)}
        <div class="setting"><span>Simulation speed</span>${select('speed', ['0.5×', '1×', '2×', '4×'], '1×')}</div>
        <div class="setting"><span>Language</span>${select('lang', ['English'], 'English')}</div>
      </div>
      <div class="keys muted">WASD / drag · pan &nbsp; Q E · zoom &nbsp; Space · pause &nbsp; 1–5 · build menu &nbsp; Esc · menu</div>
      <div class="screen-actions">${button('Apply', go('title'))}${button('Back', go('title'))}</div></div>`;
  }

  const WIDGET_HTML = {
    resources: () => `<div class="widget-heading">STOCK · WEST BLOC</div>
      <div class="resource-row"><span>HM</span><span class="green">12 480</span></div><div class="bar"><i style="width:62%"></i></div>
      <div class="resource-row"><span>SM</span><span class="amber">3 215</span></div><div class="bar"><i style="width:38%;background:var(--core)"></i></div>
      <div class="resource-row"><span>Upkeep</span><span class="red">−42 SM/min</span></div>
      <div class="resource-row"><span>Population</span><span>1 204 / 1 600</span></div>`,
    queue: () => `<div class="widget-heading">UNIT QUEUE</div>
      ${[['Trooper ×4', 'HM 40 · SM 8', 72], ['Tank', 'HM 260 · SM 30', 31], ['Mech', 'HM 420 · SM 55', 0], ['Jet', 'HM 380 · SM 70', 0]].map(([n, c, p]) => `<div class="queue-row"><span>${n}</span><span class="muted">${c}</span></div><div class="bar"><i style="width:${p}%"></i></div>`).join('')}`,
    building: () => `<div class="widget-heading">SELECTED · MILITARY TOWER L4</div>
      <div class="resource-row"><span>Integrity</span><span class="green">87%</span></div><div class="bar"><i style="width:87%;background:var(--green)"></i></div>
      <div class="resource-row"><span>Repair cache</span><span>HM 140 / 200</span></div>
      <div class="resource-row"><span>Garrison</span><span>6 troopers</span></div>
      <div class="inline">${button('Repair')}${button('Upgrade')}${button('Demolish')}</div>`,
    alerts: () => `<div class="widget-heading">ALERTS</div>
      <div class="alert red">▲ Enemy jets inbound — east</div>
      <div class="alert amber">● Farm storage full</div>
      <div class="alert green">✓ Tunnel 3 connected</div>`,
    minimap: () => `<div class="widget-heading">MAP</div><canvas class="minimap-canvas" width="220" height="70" data-minimap></canvas>`,
    timer: () => `<div class="timer"><span class="muted">MATCH</span><strong>18:42</strong>${button('Pause', go('pause'))}</div>`,
    fps: () => `<div class="fps">FPS 99 · P95 14 ms</div>`
  };

  function hudScreen() {
    const zones = ANCHORS.map(a => `<div class="anchor-zone" data-anchor="${a}"></div>`).join('');
    return `<div class="hud-layer" data-region="hud">${zones}</div>`;
  }

  function fillHud() {
    const layer = screenEl.querySelector('.hud-layer');
    if (!layer) return;
    layer.style.setProperty('--hud-margin', `${hudMargin()}px`);
    Object.keys(WIDGETS).forEach(id => {
      const cfg = state.layout.widgets[id];
      if (!cfg.visible) return;
      const el = document.createElement('section');
      el.className = 'hud-widget panel';
      el.dataset.widget = id;
      el.setAttribute('aria-label', WIDGETS[id]);
      el.innerHTML = WIDGET_HTML[id]();
      layer.querySelector(`[data-anchor="${cfg.anchor}"]`).appendChild(el);
      el.addEventListener('pointerdown', startDrag);
    });
  }

  function overlay(inner) { return hudScreen() + `<div class="overlay"><div class="overlay-card panel">${inner}</div></div>`; }

  const SCREEN_HTML = {
    title: menuScreen,
    'new-match': newMatchScreen,
    load: loadScreen,
    settings: settingsScreen,
    hud: hudScreen,
    pause: () => overlay(`<div class="eyebrow">SIMULATION HALTED</div><h2>Paused</h2><p>Particles frozen at tick 67 320.</p>
      <nav class="menu-list">${button('Resume', 'class="game-button selected" ' + go('hud'))}${button('Save snapshot', go('load'))}${button('Settings', go('settings'))}${button('Restart match', go('new-match'))}${button('Quit to menu', go('title'))}</nav>`),
    victory: () => overlay(`<div class="eyebrow green">ENEMY MILITARY CORE DESTROYED</div><h2>Victory</h2><p>The east bloc's core collapsed at 31:08.</p>
      <div class="stats"><span>Buildings raised</span><span>34</span><span>HM mined</span><span>48 210</span><span>Units lost</span><span>17</span><span>Debris created</span><span>9 812 px</span></div>
      <nav class="menu-list">${button('New match', go('new-match'))}${button('Main menu', go('title'))}</nav>`),
    defeat: () => overlay(`<div class="eyebrow red">POPULATION COLLAPSE</div><h2>Defeat</h2><p>Your last population tower fell at 24:51.</p>
      <div class="stats"><span>Buildings raised</span><span>21</span><span>HM mined</span><span>22 940</span><span>Units lost</span><span>58</span><span>Survived</span><span>24:51</span></div>
      <nav class="menu-list">${button('Retry seed', go('hud'))}${button('Main menu', go('title'))}</nav>`),
    tutorial: () => hudScreen() + `<div class="tutorial-card panel"><span class="tutorial-arrow">↖</span>
      <div class="eyebrow">TUTORIAL · 2 / 7</div><h3>Heavy matter</h3>
      <p>Miners carry <span class="green">HM</span> out of resource tunnels. Every block you build uses real material from this stock.</p>
      <div class="inline">${button('Back')}${button('Next')}${button('Skip', go('hud'))}</div></div>`
  };

  function renderScreen() {
    screenEl.innerHTML = SCREEN_HTML[state.screen]();
    fillHud();
    screenEl.querySelectorAll('canvas[data-thumb]').forEach(c => drawSkyline(c, 11 + Number(c.dataset.thumb) * 17, 150, 80));
    screenEl.querySelectorAll('canvas[data-minimap]').forEach(drawMinimap);
    $('screen-select').value = state.screen;
    updateStatus();
  }

  function drawMinimap(canvas) {
    drawSkyline(canvas, 3, 220, 70);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = state.theme.blue; ctx.fillRect(18, 52, 3, 3); ctx.fillRect(30, 50, 2, 2);
    ctx.fillStyle = state.theme.red; ctx.fillRect(190, 51, 3, 3); ctx.fillRect(170, 30, 2, 2);
    ctx.strokeStyle = state.theme.highlight; ctx.strokeRect(60.5, 10.5, 70, 50);
  }

  // ---------- Theme ----------
  function applyTheme() {
    const t = state.theme;
    const vars = themeVariables();
    Object.entries(vars).forEach(([k, v]) => stage.style.setProperty(k, v));
    stage.dataset.buttons = t.buttons;
  }

  function themeVariables() {
    const t = state.theme;
    const fonts = { Ithaca: 'Ithaca, monospace', monospace: '"Courier New", monospace', Arial: 'Arial, sans-serif' };
    return {
      '--bg': t.bg, '--text': t.text, '--muted': t.muted, '--accent': t.accent, '--highlight': t.highlight,
      '--green': t.green, '--core': t.core, '--blue': t.blue, '--red': t.red,
      '--panel': rgba(t.panel, t.panelAlpha), '--panel-border': t.panelBorder,
      '--font': fonts[t.font] || fonts.Ithaca, '--font-scale': String(t.fontScale), '--title-size': String(t.titleSize),
      '--line-height': String(t.lineHeight), '--spacing': `${t.spacing}em`, '--case': t.textCase,
      '--border-width': `${t.borderWidth}px`, '--menu-y': `${t.menuY}%`, '--menu-align': t.menuAlign,
      '--menu-flex': { left: 'flex-start', center: 'center', right: 'flex-end' }[t.menuAlign]
    };
  }

  function cssText() {
    return `:root {\n${Object.entries(themeVariables()).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n  --hud-margin: ${state.layout.margin}px;\n}\n`;
  }

  function buildThemeControls() {
    const host = $('theme-controls');
    host.innerHTML = `<div class="color-grid">${THEME_COLORS.map(([k, l]) => `<label class="control">${l.toUpperCase()} <input type="color" data-theme="${k}"></label>`).join('')}</div>`
      + THEME_RANGES.map(([k, l, min, max, step]) => `<label class="control">${l.toUpperCase()} <input type="range" data-theme="${k}" min="${min}" max="${max}" step="${step}"><output data-out="${k}"></output></label>`).join('')
      + THEME_SELECTS.map(([k, l, opts]) => `<label class="control">${l.toUpperCase()} <select data-theme="${k}">${opts.map(o => `<option>${o}</option>`).join('')}</select></label>`).join('')
      + '<button type="button" class="lab-button" id="reset-theme">RESET THEME</button>';
    host.addEventListener('input', e => {
      const key = e.target.dataset.theme;
      if (!key) return;
      state.theme[key] = typeof DEFAULT_THEME[key] === 'number' ? Number(e.target.value) : e.target.value;
      syncThemeControls(); applyTheme(); refreshCanvases(); save();
    });
    $('reset-theme').addEventListener('click', () => { state.theme = { ...DEFAULT_THEME }; syncThemeControls(); applyTheme(); refreshCanvases(); save(); say('Theme reset.'); });
  }

  function syncThemeControls() {
    document.querySelectorAll('[data-theme]').forEach(el => { el.value = state.theme[el.dataset.theme]; });
    document.querySelectorAll('[data-out]').forEach(el => { el.value = String(state.theme[el.dataset.out]); });
  }

  function refreshCanvases() { screenEl.querySelectorAll('canvas[data-minimap]').forEach(drawMinimap); }

  // ---------- Layout controls ----------
  function buildLayoutControls() {
    const host = $('layout-controls');
    host.innerHTML = Object.entries(WIDGETS).map(([id, label]) => `<div class="widget-control" data-for="${id}">
      <strong>${label.toUpperCase()}</strong>
      <label class="visible"><input type="checkbox" data-visible="${id}"> SHOW</label>
      <label class="control">ANCHOR <select data-anchor-for="${id}">${ANCHORS.map(a => `<option value="${a}">${a.replace('-', ' ').toUpperCase()}</option>`).join('')}</select></label></div>`).join('');
    host.addEventListener('change', e => {
      const v = e.target.dataset.visible, a = e.target.dataset.anchorFor;
      if (v) state.layout.widgets[v].visible = e.target.checked;
      if (a) state.layout.widgets[a].anchor = e.target.value;
      state.layout.preset = 'custom';
      renderScreen(); save();
    });
    $('margin').addEventListener('input', e => { state.layout.margin = Number(e.target.value); syncLayoutControls(); renderScreen(); save(); });
    document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      state.layout = layoutFromPreset(b.dataset.preset); syncLayoutControls(); ensureHud(); renderScreen(); save(); say(`Layout preset: ${b.dataset.preset}.`);
    }));
    $('reset-layout').addEventListener('click', () => { state.layout = layoutFromPreset('classic'); syncLayoutControls(); renderScreen(); save(); say('Layout reset.'); });
  }

  function ensureHud() { if (!['hud', 'pause', 'tutorial'].includes(state.screen)) state.screen = 'hud'; }

  function syncLayoutControls() {
    $('margin').value = state.layout.margin;
    $('margin-value').value = `${state.layout.margin}px`;
    Object.entries(state.layout.widgets).forEach(([id, w]) => {
      document.querySelector(`[data-visible="${id}"]`).checked = w.visible;
      document.querySelector(`[data-anchor-for="${id}"]`).value = w.anchor;
    });
  }

  // ---------- Stage sizing ----------
  let scale = 1;
  function layoutStage() {
    const { w, h } = size();
    stage.style.width = `${w}px`; stage.style.height = `${h}px`;
    stage.classList.toggle('phone', w < 800);
    stage.style.setProperty('--res-scale', String(w < 800 ? 1 : Math.min(w / 2560, h / 1440)));
    const hudLayer = screenEl.querySelector('.hud-layer');
    if (hudLayer) hudLayer.style.setProperty('--hud-margin', `${hudMargin()}px`);
    viewport.classList.toggle('fit', !onePixel);
    viewport.classList.toggle('pixel', onePixel);
    scale = onePixel ? 1 : Math.min((viewport.clientWidth - 2) / w, (viewport.clientHeight - 2) / h);
    stage.style.transform = `scale(${scale})`;
    stageWrap.style.width = `${w * scale}px`; stageWrap.style.height = `${h * scale}px`;
    updateStatus();
  }

  function updateStatus() {
    const { w, h } = size();
    $('preview-status').value = `${w}×${h} · ${(scale * 100).toFixed(0)}% · ${SCREENS.find(([id]) => id === state.screen)[1].toUpperCase()}`;
  }

  // ---------- Dragging ----------
  function anchorPoint(anchor, w, h, m) {
    const [row, col] = anchor.split('-');
    const x = col === 'left' ? m : col === 'right' ? w - m : w / 2;
    const y = row === 'top' ? m : row === 'bottom' ? h - m : h / 2;
    return { x, y };
  }

  function nearestAnchor(x, y, w, h, m) {
    let best = ANCHORS[0], bestD = Infinity;
    ANCHORS.forEach(a => { const p = anchorPoint(a, w, h, m); const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bestD) { bestD = d; best = a; } });
    return best;
  }

  function showGuides(on) {
    const { w, h } = size();
    guides.classList.toggle('visible', on);
    guides.innerHTML = on ? ANCHORS.map(a => { const p = anchorPoint(a, w, h, hudMargin()); return `<i style="left:${p.x}px;top:${p.y}px"></i>`; }).join('') : '';
  }

  function startDrag(e) {
    if (e.button !== 0 || e.target.closest('button,input,select')) return;
    const el = e.currentTarget;
    const id = el.dataset.widget;
    const stageRect = stage.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const offX = (e.clientX - rect.left) / scale, offY = (e.clientY - rect.top) / scale;
    const ghost = el;
    ghost.classList.add('dragging');
    ghost.style.width = `${rect.width / scale}px`;
    screenEl.querySelector('.hud-layer').appendChild(ghost);
    ghost.style.position = 'absolute';
    const move = ev => {
      ghost.style.left = `${(ev.clientX - stageRect.left) / scale - offX}px`;
      ghost.style.top = `${(ev.clientY - stageRect.top) / scale - offY}px`;
    };
    move(e);
    showGuides(true);
    el.setPointerCapture(e.pointerId);
    const up = ev => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const { w, h } = size();
      const cx = (ev.clientX - stageRect.left) / scale - offX + rect.width / scale / 2;
      const cy = (ev.clientY - stageRect.top) / scale - offY + rect.height / scale / 2;
      state.layout.widgets[id].anchor = nearestAnchor(cx, cy, w, h, hudMargin());
      state.layout.preset = 'custom';
      showGuides(false); syncLayoutControls(); renderScreen(); save();
      say(`${WIDGETS[id]} → ${state.layout.widgets[id].anchor}.`);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    e.preventDefault();
  }

  // ---------- Wiring ----------
  function setScreen(id) { state.screen = id; renderScreen(); save(); }

  function wire() {
    $('screen-select').innerHTML = SCREENS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
    $('screen-select').addEventListener('change', e => setScreen(e.target.value));
    $('resolution').addEventListener('change', e => { state.resolution = e.target.value; drawBackdrop(); layoutStage(); save(); });
    $('one-to-one').addEventListener('click', e => { onePixel = !onePixel; e.currentTarget.setAttribute('aria-pressed', String(onePixel)); layoutStage(); });
    $('backdrop-source').addEventListener('change', e => {
      state.backdrop = e.target.value;
      if (state.backdrop === 'image' && !backdropImage) say('Choose a screenshot file to use it as the backdrop.');
      drawBackdrop(); save();
    });
    $('image-file').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => { backdropImage = img; state.backdrop = 'image'; $('backdrop-source').value = 'image'; drawBackdrop(); say(`Backdrop: ${file.name}`); };
      img.src = URL.createObjectURL(file);
    });
    screenEl.addEventListener('click', e => {
      const target = e.target.closest('[data-go]');
      if (target) setScreen(target.dataset.go);
    });
    screenEl.addEventListener('pointerover', e => {
      const b = e.target.closest('.menu-list .game-button');
      if (!b) return;
      b.parentElement.querySelectorAll('.selected').forEach(s => s.classList.remove('selected'));
      b.classList.add('selected');
    });
    document.addEventListener('keydown', e => {
      if (e.target.closest('input,select,textarea')) return;
      if (e.key === 'Escape') setScreen(state.screen === 'hud' ? 'pause' : state.screen === 'pause' ? 'hud' : 'title');
      const list = screenEl.querySelector('.menu-list');
      if (list && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
        const items = [...list.querySelectorAll('.game-button')];
        let i = items.findIndex(b => b.classList.contains('selected'));
        if (e.key === 'Enter') { if (items[i]) items[i].click(); e.preventDefault(); return; }
        i = (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items.forEach(b => b.classList.remove('selected'));
        items[i].classList.add('selected');
        e.preventDefault();
      }
    });
    $('export').addEventListener('click', () => { exchange.value = JSON.stringify(state, null, 2); say('Exported settings as JSON.'); });
    $('copy-json').addEventListener('click', () => copy(JSON.stringify(state, null, 2), 'JSON'));
    $('copy-css').addEventListener('click', () => copy(cssText(), 'CSS variables'));
    $('import').addEventListener('click', () => {
      try { state = sanitize(JSON.parse(exchange.value)); syncAll(); say('Imported settings.'); }
      catch (err) { say(`Import failed: ${err.message}`); }
    });
    window.addEventListener('resize', layoutStage);
  }

  function copy(text, label) {
    exchange.value = text;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => say(`Copied ${label}.`), () => say(`${label} shown below; copy it manually.`));
    else say(`${label} shown below; copy it manually.`);
  }

  function syncAll() {
    $('resolution').value = state.resolution;
    $('backdrop-source').value = state.backdrop;
    syncThemeControls(); syncLayoutControls(); applyTheme(); drawBackdrop(); layoutStage(); renderScreen(); save();
  }

  // ---------- Self checks (?checks=1) ----------
  function runChecks() {
    const results = [];
    const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
    const saved = JSON.stringify(state);
    const resolutions = ['2560x1440', '1920x1080', '1280x720', '390x844'];
    resolutions.forEach(res => {
      state.resolution = res; layoutStage();
      const { w, h } = size();
      SCREENS.forEach(([id]) => {
        state.screen = id; renderScreen();
        check(`${res} ${id} renders`, screenEl.children.length > 0 && screenEl.textContent.trim().length > 0);
        const sr = stage.getBoundingClientRect();
        const outside = [...screenEl.querySelectorAll('.hud-widget,.panel,.menu-list,.screen-menu h2')].filter(el => {
          const r = el.getBoundingClientRect();
          return (r.left - sr.left) / scale < -1 || (r.top - sr.top) / scale < -1 || (r.right - sr.left) / scale > w + 1 || (r.bottom - sr.top) / scale > h + 1;
        });
        check(`${res} ${id} inside stage`, outside.length === 0, outside.map(el => el.dataset.widget || el.className).join(','));
      });
      ['classic', 'minimal', 'palace'].forEach(p => {
        state.layout = layoutFromPreset(p); state.screen = 'hud'; renderScreen();
        const boxes = [...screenEl.querySelectorAll('.hud-widget')].map(el => el.getBoundingClientRect());
        let overlap = 0;
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => { if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++; }));
        check(`${res} ${p} HUD widgets do not overlap`, res === '390x844' || overlap === 0, `${overlap} overlaps`);
      });
    });
    check('nearest anchor top-left', nearestAnchor(10, 10, 2560, 1440, 32) === 'top-left');
    check('nearest anchor bottom-right', nearestAnchor(2500, 1400, 2560, 1440, 32) === 'bottom-right');
    check('nearest anchor middle-center', nearestAnchor(1300, 700, 2560, 1440, 32) === 'middle-center');
    const before = defaults(); before.theme.accent = '#123456'; before.layout.widgets.fps.anchor = 'bottom-left';
    const round = sanitize(JSON.parse(JSON.stringify(before)));
    check('JSON round-trip', JSON.stringify(round) === JSON.stringify(before));
    check('sanitize rejects bad colour', sanitize({ theme: { accent: 'red;}' } }).theme.accent === DEFAULT_THEME.accent);
    check('CSS export has tokens', /--accent: #/.test(cssText()) && /--hud-margin/.test(cssText()));
    state = sanitize(JSON.parse(saved));
    syncAll();
    const passed = results.filter(r => r.ok).length;
    document.body.dataset.uiChecks = `${passed}/${results.length}`;
    const pre = $('ui-check-results');
    pre.hidden = false;
    pre.textContent = results.map(r => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail && !r.ok ? ' — ' + r.detail : ''}`).join('\n');
  }

  buildThemeControls();
  buildLayoutControls();
  wire();
  syncAll();
  const startChecks = () => runChecks();
  if (params.get('checks') === '1') (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(startChecks));
})();
