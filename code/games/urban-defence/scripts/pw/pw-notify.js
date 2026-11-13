'use strict';
// Notes next to the cursor: a short line of pixel text that follows the pointer while a tool is
// planning something (and briefly after an action). Any system can post one: PW.notify.cursor(text,
// tone) while hovering, PW.notify.flash(text, tone, seconds) after an action, PW.notify.clear().
(function () {
  const PW = window.PW;
  const state = { x: 0, y: 0, text: '', tone: '', until: 0, sticky: false };
  let element = null;
  const el = () => element || (element = document.getElementById('cursor-note'));
  function place() {
    const e = el();
    if (!e) return;
    if (!state.text || (!state.sticky && performance.now() > state.until)) { e.style.display = 'none'; return; }
    e.textContent = state.text;
    e.className = state.tone || '';
    e.style.display = 'block';
    // Beside the pointer, kept inside the window.
    const w = e.offsetWidth, h = e.offsetHeight;
    const x = Math.min(window.innerWidth - w - 4, state.x + 18), y = Math.min(window.innerHeight - h - 4, state.y + 18);
    e.style.left = `${Math.max(4, x)}px`;
    e.style.top = `${Math.max(4, y)}px`;
  }
  window.addEventListener('pointermove', (event) => { state.x = event.clientX; state.y = event.clientY; place(); });
  function cursor(text, tone = '') { state.text = text; state.tone = tone; state.sticky = true; place(); }
  function flash(text, tone = '', seconds = 2.5) {
    state.text = text; state.tone = tone; state.sticky = false; state.until = performance.now() + seconds * 1000; place();
    setTimeout(place, seconds * 1000 + 30);
  }
  function clear() { if (state.sticky) { state.text = ''; state.sticky = false; } place(); }
  PW.notify = { cursor, flash, clear, state };
})();
