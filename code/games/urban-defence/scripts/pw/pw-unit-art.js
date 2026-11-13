'use strict';
// Unit art from the user's trooper GIFs (assets/unit-reference.js), drawn 1:1: one GIF pixel is
// one world cell, so a standing trooper is 25 cells (about 1.8 m). The GIFs are silhouettes; each
// frame is coloured by body region (helmet, face, jacket, trousers, boots, and the rifle held
// forward) and shaded with the world's light from the upper left. Faces stay a flat, featureless
// tone. Looks: trooper, guard (the same art in lavender), miner (hard hat with headlamp, hi-vis
// jacket with a reflective stripe, a pneumatic drill in place of the rifle).
(function () {
  const PW = window.PW;

  const LOOKS = {
    trooper: { helmet: [70, 80, 56], face: [168, 128, 100], jacket: [88, 100, 68], trousers: [66, 74, 54], boots: [38, 34, 30], tool: [50, 52, 56] },
    guard: { helmet: [150, 104, 168], face: [176, 134, 106], jacket: [214, 152, 232], trousers: [168, 116, 186], boots: [52, 40, 58], tool: [60, 56, 66] },
    miner: { helmet: [232, 184, 40], face: [170, 130, 102], jacket: [212, 108, 38], trousers: [50, 58, 82], boots: [36, 32, 28], tool: [104, 108, 116],
      stripe: [226, 228, 214], lamp: [255, 248, 206], brim: [196, 150, 30] },
  };
  const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v | 0;
  const tone = (c, k) => [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)];

  function frameMask(clip, frame) {
    const w = clip.width, h = clip.height;
    const mask = new Uint8Array(w * h);
    for (const [x, y, n] of frame.runs) for (let i = 0; i < n; i += 1) mask[y * w + x + i] = 1;
    return mask;
  }
  // Colour one silhouette frame. Returns { canvas, footX, footY, top, width, height } in GIF cells
  // (native facing: left).
  function bake(clip, frame, lookName) {
    const L = LOOKS[lookName];
    const w = clip.width, h = clip.height;
    const mask = frameMask(clip, frame);
    const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (mask[y * w + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const tall = y1 - y0 + 1;
    // The body column: where the legs and hips are (the rifle reaches out in front of it).
    let bx0 = w, bx1 = -1;
    for (let y = Math.max(y0, y1 - Math.round(tall * 0.45)); y <= y1 - 3; y += 1) {
      for (let x = 0; x < w; x += 1) if (on(x, y)) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; }
    }
    if (bx1 < 0) { bx0 = x0; bx1 = x1; }
    // The head: the top rows; its front edge marks where the face is.
    let headFront = w;
    for (let y = y0; y <= y0 + 4; y += 1) for (let x = 0; x < w; x += 1) if (on(x, y)) { headFront = Math.min(headFront, x); break; }
    const hips = y0 + Math.round(tall * 0.5);
    const pixels = new Uint32Array(w * h);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (!on(x, y)) continue;
        const ry = y - y0;
        let c;
        if (ry <= 2) c = L.helmet;
        else if (ry <= 4) c = x <= headFront + 3 ? L.face : L.helmet;
        else if (y >= y1 - 1) c = L.boots;
        else if (x < bx0 - 1 && y > y0 + 4 && y < hips + 2) c = L.tool;
        else if (y < hips) c = L.jacket;
        else c = L.trousers;
        if (L.stripe && c === L.jacket && y === y0 + 9) c = L.stripe;
        // Light from the upper left, shade on the lower right; thin parts stay mid-tone.
        const lit = !on(x - 1, y) || !on(x, y - 1), dark = !on(x + 1, y) || !on(x, y + 1);
        const k = lit && !dark ? 1.2 : dark && !lit ? 0.72 : 1;
        c = c === L.face ? c : tone(c, k);
        pixels[y * w + x] = PW.abgr(c[0], c[1], c[2]);
      }
    }
    if (L.lamp) {
      // Hard-hat brim jutting forward, and the headlamp on the front of the hat.
      for (let x = 0; x < w; x += 1) if (on(x, y0 + 2)) { pixels[(y0 + 2) * w + x - 1] = PW.abgr(...L.brim); break; }
      for (let x = 0; x < w; x += 1) if (on(x, y0 + 1)) { pixels[(y0 + 1) * w + x] = PW.abgr(...L.lamp); break; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const image = new ImageData(new Uint8ClampedArray(pixels.buffer), w, h);
    canvas.getContext('2d').putImageData(image, 0, 0);
    // The lamp cell (for the light cone), in native-facing coordinates.
    let lamp = null;
    if (L.lamp) for (let x = 0; x < w; x += 1) if (on(x, y0 + 1)) { lamp = { x, y: y0 + 1 }; break; }
    return { canvas, footX: Math.round((bx0 + bx1) / 2), footY: y1, top: y0, width: w, height: h, lamp };
  }

  // assets/unit-reference.js declares a top-level const (not a window property).
  // eslint-disable-next-line no-undef
  const reference = () => (typeof PIXEL_UNIT_REFERENCE !== 'undefined' ? PIXEL_UNIT_REFERENCE : null);
  const cache = new Map();
  function sprite(lookName, clipName, frameIndex) {
    const REF = reference();
    if (!REF) return null;
    const clip = REF.clips[clipName] || REF.clips.walk;
    const index = ((frameIndex % clip.frames.length) + clip.frames.length) % clip.frames.length;
    const key = `${lookName}|${clipName}|${index}`;
    let s = cache.get(key);
    if (!s) { s = bake(clip, clip.frames[index], lookName); cache.set(key, s); }
    return s;
  }
  function frameCount(clipName) {
    const REF = reference();
    return REF ? (REF.clips[clipName] || REF.clips.walk).frames.length : 1;
  }

  // Draw a unit with its feet on world cell (x, y), facing -1 (left, the GIF's own facing) or +1.
  function draw(renderer, s, x, y, facing) {
    const { ctx, camera } = renderer;
    const z = camera.zoom;
    const left = facing < 0 ? Math.round(x) - s.footX : Math.round(x) + s.footX - s.width + 1;
    const top = Math.round(y) - s.footY;
    const sx = Math.round((left - camera.x) * z), sy = Math.round((top - camera.y) * z);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (facing > 0) {
      ctx.translate(sx + s.width * z, sy);
      ctx.scale(-1, 1);
      ctx.drawImage(s.canvas, 0, 0, s.width * z, s.height * z);
    } else {
      ctx.drawImage(s.canvas, sx, sy, s.width * z, s.height * z);
    }
    ctx.restore();
  }
  // Headlamp beam: a narrow cone of warm light in front of a miner, cell by cell.
  function lampCone(renderer, s, x, y, facing, length = 46, tilt = 0.18) {
    if (!s.lamp) return;
    const { ctx, camera } = renderer;
    const z = camera.zoom, size = Math.max(1, Math.round(z));
    const lx = facing < 0 ? Math.round(x) - s.footX + s.lamp.x : Math.round(x) + s.footX - s.lamp.x;
    const ly = Math.round(y) - s.footY + s.lamp.y;
    ctx.beginPath();
    for (let d = 2; d <= length; d += 1) {
      const half = Math.floor(d * 0.22);
      const cy = ly + Math.round(d * tilt);
      for (let o = -half; o <= half; o += 1) {
        if (((d + o) & 1) && d > length * 0.6) continue;    // dithers out towards the end
        ctx.rect(Math.round((lx + facing * d - camera.x) * z), Math.round((cy + o - camera.y) * z), size, size);
      }
    }
    ctx.fillStyle = 'rgba(255,236,170,0.10)';
    ctx.fill();
  }

  PW.unitArt = { LOOKS, sprite, frameCount, draw, lampCone, bake };
})();
