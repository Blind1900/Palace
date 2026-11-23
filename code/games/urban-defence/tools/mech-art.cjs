// The hopper mech's art, from the user's own drawings (assets/hopper-reference.js: the idle, jump,
// boost and glide-or-falling clips of Mechs(hoppers), and assets/bullet-reference.js: Bullet.gif):
// each frame's pixels as drawn, about its body point (where the drawing is densest), with where its
// feet and the pod under its wing are; how far the body travels between frames on the ground (the
// clips' own movement); and, for the frames the mech goes from one to the next, the in-betweens -
// each drawing carried smoothly on to the next one's pose (a coherent drift of its pixels, found by
// annealing: soft matches, every pixel of the other drawing pulling on those nearest it, the pull
// smoothed over neighbours so the drawing moves as a whole). Written into scripts/pw/pw-mechs.js
// between its "generated" markers.
//
// Usage (from code/games/urban-defence): node tools/mech-art.cjs   (or ELECTRON_RUN_AS_NODE=1 Code.exe)
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const asset = (file) => {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const name = src.match(/const (\w+) =/)[1];
  return new Function(`${src}; return ${name};`)();
};
const HOPPER = asset('assets/hopper-reference.js'), BULLET = asset('assets/bullet-reference.js');
const pixelsOf = (frame) => { const px = []; for (const [x, y, n, argb] of frame.runs) for (let k = 0; k < n; k += 1) px.push([x + k, y, argb]); return px; };

// ---- The frames, about their body points ----------------------------------------------------------
function bodyOf(px) {
  const set = new Set(px.map(([x, y]) => y * 1000 + x));
  let best = -1, bx = 0, by = 0;
  for (const [x, y] of px) {
    let n = 0;
    for (let dy = -6; dy <= 6; dy += 1) for (let dx = -6; dx <= 6; dx += 1) if (dx * dx + dy * dy <= 36 && set.has((y + dy) * 1000 + x + dx)) n += 1;
    if (n > best) { best = n; bx = x; by = y; }
  }
  return [bx, by];
}
// (its feet: the lowest cells, in up to two clumps - an ankle a few cells over each)
function feetOf(px) {
  const yMax = Math.max(...px.map(([, y]) => y));
  const low = px.filter(([, y]) => y >= yMax - 2).map(([x]) => x).sort((a, b) => a - b);
  const clumps = [];
  for (const x of low) { const c = clumps[clumps.length - 1]; if (c && x - c[c.length - 1] <= 4) c.push(x); else clumps.push([x]); }
  clumps.sort((a, b) => b.length - a.length);
  return { bottom: yMax, ankles: clumps.slice(0, 2).map((c) => [Math.round(c.reduce((s, x) => s + x, 0) / c.length), yMax - 3]) };
}
const CLIPS = { idle: 'idle', jump: 'jump', boost: 'boost', glide: 'fall' };
// (the ground each clip's drawings stand on: the first frame's feet; a drawing whose feet are
// over it is off the ground - the hop's kick - and none is drawn into it. The leap's last two
// frames and the glide's are in the air: they are hung from the body, not stood on their feet)
const GROUND = { idle: [0, 1, 2, 3, 4], jump: [0, 1], boost: [0, 1, 2, 3], glide: [] };
const frames = [], clips = {}, byKey = new Map();
for (const [clip, src] of Object.entries(CLIPS)) {
  clips[clip] = HOPPER.clips[src].frames.map((fr) => {
    const raw = pixelsOf(fr), [bx, by] = bodyOf(raw), feet = feetOf(raw), i = HOPPER.clips[src].frames.indexOf(fr);
    const ground = feetOf(pixelsOf(HOPPER.clips[src].frames[0])).bottom;
    const rel = raw.map(([x, y]) => [x - bx, y - by]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    // (the same drawing in two clips - the crouch the idle, the jump and the boost start from - is one frame)
    const key = rel.map((p) => p.join(',')).join(';');
    if (byKey.has(key)) return byKey.get(key);
    const id = frames.length;
    frames.push({ id, at: [bx, by], hang: feet.bottom - by, px: rel,
      // (how high its body stands over the ground, standing: 0 in the air)
      lift: GROUND[clip].includes(i) ? Math.max(ground - by, feet.bottom - by) : 0,
      feet: feet.ankles.map(([x, y]) => [x - bx, y - by]),
      // (the pod under its wing - the cannon pointing forward, the jet back: under the body, behind its middle)
      pod: [5, 4] });
    byKey.set(key, id);
    return id;
  });
}
for (const [clip, ids] of Object.entries(clips)) ids.forEach((id, i) => { if (!frames[id].label) frames[id].label = `${clip}${i}`; });

// ---- How far the body goes, frame to frame, on the ground (the clip's own movement) --------------------
// (its feet planted where they are drawn: from the last frame round to the first, the body goes on
// as far as keeps its feet where they were)
function track(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 1) {
    const A = frames[ids[i]], B = frames[ids[(i + 1) % ids.length]];
    if (i + 1 < ids.length) out.push(B.at[0] - A.at[0]);
    else {
      const footA = A.feet.reduce((s, f) => s + f[0], 0) / A.feet.length, footB = B.feet.reduce((s, f) => s + f[0], 0) / B.feet.length;
      out.push(Math.round(footA - footB));
    }
  }
  return out;
}

// ---- In-betweens ----------------------------------------------------------------------------------------
function drift(Y, X, iters = 60) {
  const M = Y.length, N = X.length;
  const vx = new Float64Array(M), vy = new Float64Array(M), rx = new Float64Array(M), ry = new Float64Array(M), w = new Float64Array(M);
  const zx = new Float64Array(M), zy = new Float64Array(M), den = new Float64Array(N);
  for (let it = 0; it < iters; it += 1) {
    const f = it / (iters - 1), sigma = 18 * Math.pow(1.2 / 18, f), beta = 14 * Math.pow(3 / 14, f);
    const k2 = 1 / (2 * sigma * sigma), cut = 18 * sigma * sigma;
    for (let m = 0; m < M; m += 1) { zx[m] = Y[m][0] + vx[m]; zy[m] = Y[m][1] + vy[m]; }
    for (let n = 0; n < N; n += 1) {
      let s = 1e-6;
      for (let m = 0; m < M; m += 1) { const dx = X[n][0] - zx[m], dy = X[n][1] - zy[m], d2 = dx * dx + dy * dy; if (d2 < cut) s += Math.exp(-d2 * k2); }
      den[n] = s;
    }
    for (let m = 0; m < M; m += 1) {
      let p1 = 0, px = 0, py = 0;
      for (let n = 0; n < N; n += 1) { const dx = X[n][0] - zx[m], dy = X[n][1] - zy[m], d2 = dx * dx + dy * dy; if (d2 >= cut) continue; const p = Math.exp(-d2 * k2) / den[n]; p1 += p; px += p * X[n][0]; py += p * X[n][1]; }
      if (p1 > 1e-9) { rx[m] = px / p1 - Y[m][0]; ry[m] = py / p1 - Y[m][1]; w[m] = p1; } else { rx[m] = vx[m]; ry[m] = vy[m]; w[m] = 1e-3; }
    }
    const b2 = 1 / (2 * beta * beta), bcut = 18 * beta * beta;
    for (let m = 0; m < M; m += 1) {
      let sw = 0, sx = 0, sy = 0;
      for (let k = 0; k < M; k += 1) { const dx = Y[m][0] - Y[k][0], dy = Y[m][1] - Y[k][1], d2 = dx * dx + dy * dy; if (d2 >= bcut) continue; const g = Math.exp(-d2 * b2) * w[k]; sw += g; sx += g * rx[k]; sy += g * ry[k]; }
      vx[m] = sx / sw; vy[m] = sy / sw;
    }
  }
  return Y.map((_, m) => [vx[m], vy[m]]);
}
// The frames the mech goes between: in each clip, frame to frame (round again where it loops); and
// the ways from one clip into another.
const F = (clip, i) => clips[clip][i];
const LINKS = [
  ...[0, 1, 2, 3, 4].map((i) => [F('idle', i), F('idle', (i + 1) % 5)]),
  [F('jump', 0), F('jump', 1)], [F('jump', 1), F('jump', 2)], [F('jump', 2), F('jump', 3)], [F('jump', 3), F('glide', 0)],
  [F('glide', 0), F('glide', 1)], [F('glide', 1), F('glide', 2)], [F('glide', 2), F('glide', 0)], [F('glide', 2), F('glide', 3)], [F('glide', 3), F('glide', 4)],
  [F('glide', 3), F('idle', 4)], [F('glide', 4), F('idle', 4)], [F('jump', 2), F('idle', 4)], [F('jump', 3), F('idle', 4)],
  [F('boost', 0), F('boost', 1)], [F('boost', 1), F('boost', 2)], [F('boost', 2), F('boost', 3)], [F('boost', 3), F('boost', 1)], [F('boost', 3), F('idle', 0)],
  [F('idle', 2), F('jump', 1)], [F('idle', 4), F('jump', 1)], [F('glide', 0), F('boost', 2)], [F('boost', 2), F('glide', 0)], [F('jump', 2), F('boost', 2)],
].filter(([a, b], i, all) => a !== b && all.findIndex(([c, d]) => (c === a && d === b) || (c === b && d === a)) === i);

const q8 = (v) => Math.max(-127, Math.min(127, Math.round(v * 2)));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const t0 = Date.now();
const pairs = {};
for (const [a, b] of LINKS) {
  const A = frames[a].px, B = frames[b].px;
  const da = drift(A, B), db = drift(B, A);
  pairs[`${a}>${b}`] = [b64(Int8Array.from(da.flatMap(([x, y]) => [q8(x), q8(y)])).buffer), b64(Int8Array.from(db.flatMap(([x, y]) => [q8(x), q8(y)])).buffer)];
  process.stdout.write(`${frames[a].label}>${frames[b].label} `);
}
console.log(`\n${LINKS.length} links in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---- The bullet: its frames as drawn (flying left), about the round's head ---------------------------------
const bulletColours = [];
const bullet = BULLET.clips.fly.frames.map((fr, i) => {
  const px = pixelsOf(fr);
  // (the head: the leftmost cells of the first frames, where it is; the burst, about the same spot)
  return px.map(([x, y, argb]) => {
    let c = bulletColours.indexOf(argb >>> 0);
    if (c < 0) { c = bulletColours.length; bulletColours.push(argb >>> 0); }
    return [x, y, c];
  });
});
const head = (() => { const f0 = bullet[0]; const x = Math.min(...f0.map(([x]) => x)); const ys = f0.filter(([xx]) => xx <= x + 1).map(([, y]) => y); return [x, Math.round(ys.reduce((s, y) => s + y, 0) / ys.length)]; })();

// ---- Written out ----------------------------------------------------------------------------------------------
const ART = {
  frames: frames.map((f) => ({ label: f.label, lift: f.lift, hang: f.hang, feet: f.feet, pod: f.pod, px: b64(Uint8Array.from(f.px.flatMap(([x, y]) => [x + 64, y + 64])).buffer) })),
  clips, track: { idle: track(clips.idle), boost: [frames[clips.boost[1]].at[0] - frames[clips.boost[0]].at[0], ...track(clips.boost.slice(1))] },
  pairs,
  bullet: { head, colours: bulletColours.map((c) => [(c >>> 16) & 255, (c >>> 8) & 255, c & 255]), frames: bullet.map((px) => b64(Uint8Array.from(px.flatMap(([x, y, c]) => [x, y, c])).buffer)) },
};
const text = `  // ---- generated by tools/mech-art.cjs from the user's drawings (assets/hopper-reference.js, assets/bullet-reference.js) - do not edit ----\n`
  + `  const ART = {\n${Object.entries(ART).map(([k, v]) => {
    // (a frame, a pair, to a line)
    if (k === 'frames') return `    frames: [\n${v.map((f) => `      ${JSON.stringify(f)},`).join('\n')}\n    ],`;
    if (k === 'pairs') return `    pairs: {\n${Object.entries(v).map(([p, d]) => `      '${p}': ${JSON.stringify(d)},`).join('\n')}\n    },`;
    return `    ${k}: ${JSON.stringify(v)},`;
  }).join('\n')}\n  };\n  // ---- end generated ----\n`;
const file = path.join(root, 'scripts/pw/pw-mechs.js');
const src = fs.readFileSync(file, 'utf8');
const re = /  \/\/ ---- generated by tools\/mech-art\.cjs[\s\S]*?\/\/ ---- end generated ----\n/;
if (!re.test(src)) throw new Error('pw-mechs.js has no generated block to fill');
fs.writeFileSync(file, src.replace(re, text));
console.log(`frames ${frames.length} (${frames.map((f) => `${f.label} ${f.px.length}`).join(', ')}); tracks ${JSON.stringify(ART.track)}; lifts ${frames.map((f) => f.lift).join(',')}; ${(text.length / 1024).toFixed(0)} KB`);
