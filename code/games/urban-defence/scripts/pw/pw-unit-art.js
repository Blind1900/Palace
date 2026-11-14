'use strict';
// Unit art from the user's trooper GIFs (assets/unit-reference.js), drawn 1:1: one GIF pixel is
// one world cell, so a standing trooper is 25 cells (about 1.8 m). The GIFs are silhouettes; each
// frame is coloured by body region (helmet, face, jacket, trousers, boots, and the rifle held
// forward) and shaded with the world's light from the upper left. Faces stay a flat, featureless
// tone. Looks: trooper, guard (the same art in lavender), miner (hard hat with headlamp, hi-vis
// jacket with a reflective stripe, a pneumatic drill in place of the rifle).
// Each faction dresses its troopers like a real army of its region:
//   asian  - green digital woodland camouflage (single-cell pixels), a green helmet with goggles
//            pushed up on it, black boots and rifle, a red patch on the chest,
//   gothic - khaki pixel camouflage in two-cell blocks of olive and brown, a dark charcoal helmet,
//            a coyote plate carrier over the chest, dark boots, a wooden-stocked rifle,
//   modern - tan multi-terrain camouflage in soft three-cell blotches, a coyote helmet with a night
//            sight mount, a ranger-green plate carrier, tan boots, a black rifle.
// Guards stay lavender whatever the faction; miners keep their hi-vis kit over faction trousers.
(function () {
  const PW = window.PW;

  const DRESS = {
    asian: { helmet: [74, 100, 58], boots: [30, 28, 26], tool: [30, 30, 32], goggles: [28, 30, 34], gogglesLit: [110, 124, 132], patch: [200, 42, 34],
      camo: { base: [92, 118, 70], spots: [[56, 78, 44], [136, 132, 92], [102, 84, 56], [122, 150, 84]], cell: 1, density: 0.55 } },
    gothic: { helmet: [56, 58, 62], boots: [44, 36, 30], tool: [70, 50, 34], vest: [126, 106, 76], vestDark: [98, 80, 56],
      camo: { base: [130, 126, 96], spots: [[94, 102, 66], [106, 86, 60], [72, 76, 52]], cell: 2, density: 0.55 } },
    modern: { helmet: [150, 134, 100], boots: [176, 148, 104], tool: [30, 30, 32], vest: [92, 98, 70], vestDark: [70, 76, 54], mount: [34, 34, 36],
      camo: { base: [156, 144, 110], spots: [[108, 116, 78], [120, 98, 70], [188, 178, 142]], blob: 3, density: 0.5 } },
  };
  // Camouflage colour at GIF cell (x, y): digital pixels, pixel blocks, or soft blotches.
  function camoAt(camo, x, y) {
    let h;
    if (camo.blob) {
      const jog = PW.hash2(Math.floor(y / camo.blob), 41) % camo.blob;   // blotch edges don't line up
      h = PW.hash2(Math.floor((x + jog) / camo.blob) * 5 + 1, Math.floor(y / camo.blob) * 7 + 3);
    } else h = PW.hash2(Math.floor(x / camo.cell) * 3 + 1, Math.floor(y / camo.cell) * 5 + 2);
    if ((h & 255) / 255 >= camo.density) return camo.base;
    return camo.spots[(h >>> 8) % camo.spots.length];
  }

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
  function bake(clip, frame, lookName, style = '') {
    const D = lookName === 'trooper' ? DRESS[style] : null;
    const L = { ...LOOKS[lookName], ...(D ? { helmet: D.helmet, boots: D.boots, tool: D.tool } : {}) };
    if (lookName === 'miner' && DRESS[style]) L.trousers = DRESS[style].camo.base.map((v) => v * 0.8);
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
        if (D) {
          const cloth = c === L.jacket || c === L.trousers;
          if (cloth) c = camoAt(D.camo, x, y);
          // A plate carrier over the chest, between the hips and the shoulders.
          if (D.vest && cloth && y >= y0 + 6 && y < hips && x >= bx0 && x <= bx1) c = y === y0 + 6 || x === bx1 ? D.vestDark : D.vest;
          if (D.goggles && ry === 1 && x <= headFront + 2) c = x === headFront ? D.gogglesLit : D.goggles;   // goggles up on the helmet
          if (D.mount && ry === 0 && x === headFront + 1) c = D.mount;                                     // night sight mount
          if (D.patch && cloth && y === y0 + 7 && x === bx0 + 1) c = D.patch;
        }
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
  // style: the faction ('asian' | 'gothic' | 'modern'), or '' for the plain olive trooper.
  function sprite(lookName, clipName, frameIndex, style = '') {
    const REF = reference();
    if (!REF) return null;
    const clip = REF.clips[clipName] || REF.clips.walk;
    const index = ((frameIndex % clip.frames.length) + clip.frames.length) % clip.frames.length;
    const key = `${lookName}|${clipName}|${index}|${style}`;
    let s = cache.get(key);
    if (!s) { s = bake(clip, clip.frames[index], lookName, style); cache.set(key, s); }
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

  PW.unitArt = { LOOKS, DRESS, sprite, frameCount, draw, lampCone, bake };
})();
