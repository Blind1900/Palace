'use strict';
// Jets (N90), after the user's jet GIFs (Jetflying, jet shooting, Jetshotdown: a fighter seen side
// on, its wings showing as it rolls), drawn at their real size - a fighter's 15-19 m, about 190
// cells - each side's its own army's:
//   modern - an F-16: light gull grey, a bubble canopy, the intake under its chin;
//   asian  - a J-10: blue-grey, a red star on its fin;
//   gothic - a Su-27: two-tone blue-grey, a white cross on its fin.
// It flies: on along its heading at its speed, its engine's thrust against the air's drag and its
// weight's pull as it climbs or dives; too slow, it stalls, its nose dropping until it has its speed
// again. To go the other way it pulls up over the top - a half loop - and rolls upright again. From
// a runway (the military bases' - see pw-settlements) it takes off: rolling along the strip, its
// nose up at its rotation speed, its wheels off the ground, climbing away.
// It fights: a cannon in its nose (PW.shots' cannon rounds, in bursts) for strafing, and two missiles
// (PW.shots' missile, steering for the unit nearest where they are aimed). What strikes it - rounds,
// a blast, a missile - comes off its armour; when that is gone it is shot down: burning, trailing
// smoke, out of control, it goes down nose first and crashes - a fireball of its fuel, its wreck
// left burning on the ground (see pw-fragments' wreck pieces, as a tank's).
// Every jet can be taken in hand (the user's): A / D fly left or right (turning round over the top),
// W / S climb or dive (a notch at a time), F fires a cannon burst, G a missile at the unit nearest
// the spot last clicked; a click on a runway puts a jet on it and it takes off.
// Our own code throughout.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, passable } = PW.mat;
  const POWDER = PW.PHASE.POWDER;

  const LENGTH = 190;           // cells, nose to tail
  const CRUISE = 360, VMAX = 520, STALL = 160, V_ROT = 190;   // cells/s (the game's quarter-scale speeds)
  const THRUST = 300;           // cells/s^2 at full throttle
  const DRAG = THRUST / (VMAX * VMAX);
  const GROUND_ROLL = 80;       // cells/s^2 it speeds up along a runway
  const PITCH_RATE = 1.3;       // rad/s it pitches at, at most
  const CLIMB_MAX = 60;         // degrees it climbs or dives at, as it is told, at most
  const ROLL = 0.7;             // s its roll upright takes, after a half loop
  const ARMOUR = 100;
  const DAMAGE = { bullet: 3, cannon: 14, he: 60, ap: 60, missile: 100, rocket: 60, interceptor: 40, patriot: 100 };
  const BURST = 12, ROF = 1 / 18, MISSILES = 2;
  const G = () => PW.GRAVITY || 260;
  const deg = Math.PI / 180;
  const stats = { created: 0, tookOff: 0, shotDown: 0, crashed: 0, fired: 0, missiles: 0 };
  let current = null, seq = 0;

  // ---- The look ---------------------------------------------------------------------------------------
  const STYLES = {
    modern: { base: [150, 156, 162], dark: [112, 118, 126], light: [188, 192, 196], canopy: [62, 56, 38], fin: [70, 78, 92], mark: [210, 214, 220] },
    asian: { base: [118, 132, 146], dark: [86, 98, 112], light: [156, 168, 180], canopy: [40, 58, 70], fin: [86, 98, 112], mark: [196, 40, 36] },
    gothic: { base: [112, 128, 148], dark: [78, 92, 112], light: [160, 174, 192], canopy: [34, 50, 62], fin: [64, 76, 96], mark: [236, 236, 236] },
  };
  const NOZZLE = [62, 60, 58], WHEEL = [36, 36, 38];
  const inPoly = (poly, x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const rgb = (c, k = 1) => PW.abgr(Math.max(0, Math.min(255, c[0] * k)) | 0, Math.max(0, Math.min(255, c[1] * k)) | 0, Math.max(0, Math.min(255, c[2] * k)) | 0);
  // Its side view, facing right (u forward, v down), its belly at v = +7: the fuselage, its nose cone,
  // the canopy over the cockpit, the intake, the fin and tailplane, the wing edge on, the nozzle, the
  // missiles on their rails under the wing; the gear, down on the ground. Shaded from above.
  const FIN = [[-50, -7], [-74, -38], [-88, -38], [-93, -7]];
  function shapeAt(u, v, gear) {
    if (u > 95 || u < -95) return 0;
    // (the fuselage's top and belly along it: a cone at the nose, the spine, the tail tapering)
    const r = u > 58 ? 7 * Math.pow((95 - u) / 37, 0.65) : u < -82 ? 6 - (-82 - u) * 0.12 : 7;
    const top = -r - (u > 22 && u < 56 ? 6 * Math.sqrt(Math.max(0, 1 - ((u - 39) / 17) ** 2)) : 0);
    const belly = u > 58 ? r : u < -82 ? r - 1 : 7 + (u > 8 && u < 44 ? 3 : 0);
    if (v >= top && v <= belly) return u > 22 && u < 56 && v < -6.5 ? 'canopy' : u < -88 ? 'nozzle' : 'body';
    if (inPoly(FIN, u, v)) return 'fin';
    if (u > -96 && u < -66 && v >= 1 && v <= 2.5) return 'body';                  // tailplane, edge on
    if (u > -44 && u < 18 && v >= 2 && v <= 3.5) return 'body';                    // wing, edge on
    if (u > -26 && u < 10 && v >= 8 && v <= 10) return 'missile';                  // its missiles under the wing
    if (gear && ((Math.abs(u - 40) < 2.5 && v > 7 && v <= 16) || (Math.abs(u + 30) < 3 && v > 7 && v <= 16))) return v > 12 ? 'wheel' : 'strut';
    return 0;
  }
  const arts = new Map();
  function artOf(style, gear) {
    const key = `${style}|${gear ? 1 : 0}`;
    if (arts.has(key)) return arts.get(key);
    const st = STYLES[style] || STYLES.modern, x0 = -96, x1 = 96, y0 = -40, y1 = 17, w = x1 - x0 + 1, h = y1 - y0 + 1;
    const px = new Uint32Array(w * h), kind = new Array(w * h);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) kind[(y - y0) * w + (x - x0)] = shapeAt(x + 0.5, y + 0.5, gear);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const k = (y - y0) * w + (x - x0), part = kind[k];
      if (!part) continue;
      const up = y > y0 && kind[k - w], down = y < y1 && kind[k + w];
      const light = !up ? 1.18 : !down ? 0.68 : 1 - (y - y0) / h * 0.2;
      let c;
      if (part === 'canopy') c = (x + y) % 7 === 0 ? rgb([200, 210, 220]) : rgb(st.canopy, light);
      else if (part === 'nozzle') c = rgb(NOZZLE, light);
      else if (part === 'missile') c = x > 6 ? rgb([200, 200, 196]) : rgb([150, 154, 150], light);
      else if (part === 'wheel') c = rgb(WHEEL);
      else if (part === 'strut') c = rgb([120, 124, 128]);
      else if (part === 'fin') c = (x > -84 && x < -76 && y > -30 && y < -22) ? rgb(st.mark) : rgb(st.fin, light);
      else c = rgb(style === 'gothic' && ((x >> 4) + (y >> 3)) & 1 ? st.dark : st.base, light);
      px[k] = c;
    }
    const a = { x0, y0, x1, y1, w, h, px };
    arts.set(key, a);
    return a;
  }
  const at = (s, x, y) => (x < s.x0 || y < s.y0 || x > s.x1 || y > s.y1 ? 0 : s.px[(y - s.y0) * s.w + (x - s.x0)]);

  // ---- A jet ---------------------------------------------------------------------------------------------
  // (x, y: its middle; facing: the way its nose points, left or right; pitch: its nose's angle over
  // the horizontal, the way it faces; roll: 1 upside down, 0 upright)
  function create(world, spec) {
    const style = STYLES[spec.style] ? spec.style : 'modern';
    const j = { kind: 'jet', style, side: spec.side || null, x: spec.x, y: spec.y, facing: spec.facing || 1, pitch: (spec.pitch || 0) * deg,
      v: spec.speed ?? (spec.onGround ? 0 : CRUISE), throttle: 1, want: spec.facing || 1, climb: 0, roll: 0, turning: false,
      onGround: !!spec.onGround, runway: spec.runway || null, hp: ARMOUR, dead: false, down: false, spin: 0, burst: 0, burstT: 0,
      missiles: MISSILES, aim: null, hurtBy: '', smoke: 0, seed: ++seq };
    (world.jets || (world.jets = [])).push(j);
    current = world;
    stats.created += 1;
    return j;
  }
  // (its heading, world angle: 0 right, up positive)
  const heading = (j) => (j.facing > 0 ? j.pitch : Math.PI - j.pitch);
  // (a point of it in its own frame - u along it, v down - in the world)
  function toWorld(j, u, v) {
    const c = Math.cos(j.pitch), s = Math.sin(j.pitch), vv = j.roll > 0.5 ? -v : v;
    return [j.x + j.facing * (u * c + vv * s), j.y - u * s + vv * c];
  }
  // (what of it is at world point (x, y): its art's colour, or 0)
  // (its pose for looking points up: its turn, its roll, its art - made once for many points)
  function poseOf(j) {
    const squash = Math.abs(Math.cos(j.roll * Math.PI));
    return { j, c: Math.cos(j.pitch), s: Math.sin(j.pitch), k: (j.roll > 0.5 ? -1 : 1) / Math.max(0.15, squash), gone: squash < 0.15, art: artOf(j.style, j.onGround) };
  }
  function pixelP(P, x, y) {
    if (P.gone) return 0;
    const j = P.j, dx = (x - j.x) * j.facing, dy = y - j.y;
    // (rolling: seen squashed as its wings come round - and upside down past the middle of it)
    return at(P.art, Math.floor(dx * P.c - dy * P.s), Math.floor((dx * P.s + dy * P.c) * P.k));
  }
  const pixel = (j, x, y) => pixelP(poseOf(j), x, y);
  const blocks = (world, x, y) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
    const id = world.mat[(y | 0) * world.width + (x | 0)] & ID_MASK;
    return phase[id] >= POWDER && !passable[id];
  };

  // ---- Flying -----------------------------------------------------------------------------------------------
  function stepOne(world, j, dt) {
    if (j.dead) return;
    const g = G();
    if (j.onGround) return roll(world, j, dt);
    if (j.down) {
      // (shot down: no thrust, its nose dropping, turning over as it goes - burning, smoking)
      j.pitch = Math.max(-75 * deg, j.pitch - 0.9 * dt);
      j.spin += dt * 2.2;
      j.roll = (Math.sin(j.spin) + 1) / 2;
      j.v = Math.min(VMAX * 1.2, j.v + g * Math.sin(-j.pitch) * dt * 0.6);
      trail(world, j, dt, true);
    } else {
      // Its nose: turning round over the top if told the other way; else up or down to the climb asked.
      if (j.want !== j.facing && !j.turning) j.turning = true;
      if (j.turning) {
        j.pitch += PITCH_RATE * dt;
        if (j.pitch >= Math.PI / 2) { j.facing = -j.facing; j.pitch = Math.PI / 2; j.turning = false; j.roll = 1; }
      } else {
        // (stalled, it noses down and dives until it has its speed again, with some to spare)
        if (j.v < STALL) j.stalled = true; else if (j.v > STALL * 1.4) j.stalled = false;
        const target = j.stalled ? -0.6 : j.climb * deg;
        j.pitch += Math.max(-PITCH_RATE * dt, Math.min(PITCH_RATE * dt, target - j.pitch));
      }
      if (j.roll > 0 && !j.turning) j.roll = Math.max(0, j.roll - dt / ROLL);
      // Its speed: thrust against drag, and its weight as it climbs.
      j.v += (THRUST * j.throttle - DRAG * j.v * j.v - g * Math.sin(j.pitch)) * dt;
      j.v = Math.max(40, j.v);
      if (j.hp < ARMOUR * 0.4) trail(world, j, dt, false);
    }
    const hd = heading(j);
    j.x += Math.cos(hd) * j.v * dt;
    j.y -= Math.sin(hd) * j.v * dt;
    fireStep(world, j, dt);
    // What it flies into: the ground, a building, a mountain - it crashes.
    for (const [u, v] of [[94, 0], [60, 7], [0, 7], [-60, 6], [-90, -36], [0, -7]]) {
      const [wx, wy] = toWorld(j, u, v);
      if (blocks(world, Math.floor(wx), Math.floor(wy))) { crash(world, j); return; }
    }
    if (j.y > world.height || j.x < -400 || j.x > world.width + 400) { j.dead = true; }
  }
  // (on the ground: rolling along its runway to its rotation speed, its nose up, off - or, landed,
  // braking to a stop)
  function roll(world, j, dt) {
    j.pitch = 0;
    j.v = Math.min(V_ROT * 1.15, j.v + GROUND_ROLL * dt);
    j.x += j.facing * j.v * dt;
    if (j.v >= V_ROT) {
      j.onGround = false; j.climb = 15; j.pitch = 4 * deg;
      stats.tookOff += 1;
    }
    // (its wheels on the strip: past its end without its speed, it runs off and crashes)
    const [wx, wy] = toWorld(j, 40, 16);
    if (!blocks(world, Math.floor(wx), Math.floor(wy) + 1) && j.onGround) {
      let y = Math.floor(wy);
      while (y < world.height - 1 && !blocks(world, Math.floor(wx), y + 1) && y - wy < 40) y += 1;
      if (y - wy >= 40) crash(world, j);
      else j.y += y - wy;
    }
  }
  // (smoke from its engine - grey as it is hurt, black with flame shot down)
  function trail(world, j, dt, burning) {
    const particles = world.particles, F = PW.PARTICLE;
    if (!particles || !F) return;
    j.smoke += dt * (burning ? 70 : 20);
    while (j.smoke >= 1) {
      j.smoke -= 1;
      const h = PW.hash3(j.seed, (j.smoke * 1000) | 0, (world.tick || 0)), [x, y] = toWorld(j, -92 - (h & 7), (h >>> 3 & 7) - 3);
      if (burning && (h >>> 6 & 1)) particles.spawn(x, y, ((h >>> 7 & 31) - 16), -10, 0, PW.abgr(46, 42, 40, 220), F.FIRE, 0.3 + (h >>> 12 & 7) * 0.06);
      else { const k = burning ? 40 : 120; particles.spawn(x, y, ((h >>> 7 & 31) - 16) * 0.5, -6, 0, PW.abgr(k, k - 2, k - 4, 210), F.SMOKE | F.THIN, 2.5 + (h >>> 12 & 7) * 0.4); }
    }
  }

  // ---- Fighting -----------------------------------------------------------------------------------------
  function muzzle(j) {
    const [x, y] = toWorld(j, 97, 2), hd = heading(j);
    return { x, y, dx: Math.cos(hd), dy: -Math.sin(hd) };
  }
  // F: a burst from its cannon, along its nose (strafing: it is its nose that aims it).
  function fire(world, j) {
    if (!j || j.dead || j.down || j.onGround || j.burst > 0) return false;
    j.burst = BURST; j.burstT = 0;
    return true;
  }
  function fireStep(world, j, dt) {
    if (!j.burst || !PW.shots) return;
    j.burstT -= dt;
    while (j.burst > 0 && j.burstT <= 0) {
      const m = muzzle(j);
      PW.shots.fire(world, { kind: 'cannon', x: m.x, y: m.y, dx: m.dx, dy: m.dy, side: j.side, from: j, spread: 0.012 });
      j.burst -= 1; j.burstT += ROF;
      stats.fired += 1;
    }
  }
  // G: a missile at the unit nearest where it is aimed (or on ahead).
  function launch(world, j) {
    if (!j || j.dead || j.down || j.onGround || j.missiles <= 0 || !PW.shots) return null;
    const m = muzzle(j), aim = j.aim || { x: m.x + m.dx * 600, y: m.y + m.dy * 600 };
    let target = null, best = 250;
    for (const list of [world.tanks, world.troops, world.jets]) for (const u of list || []) {
      if (u.dead || u === j || (j.side && u.side === j.side)) continue;
      const d = Math.hypot(u.x - aim.x, u.y - aim.y);
      if (d < best) { best = d; target = u; }
    }
    const [wx, wy] = toWorld(j, -10, 11);
    j.missiles -= 1;
    stats.missiles += 1;
    return PW.shots.fire(world, { kind: 'missile', x: wx, y: wy, dx: m.dx, dy: m.dy + 0.15, side: j.side, from: j, target: target || aim, aimDy: target && target.kind !== 'jet' ? 14 : 0 });
  }
  function hurt(world, j, amount, cause) {
    if (j.dead || j.down || !(amount > 0)) return;
    j.hp -= amount;
    j.hurtBy = cause;
    if (j.hp <= 0) {
      j.hp = 0;
      if (j.onGround) { crash(world, j); return; }
      j.down = true; j.burst = 0;
      stats.shotDown += 1;
      if (held === j) held = null;
    }
  }
  // A blast near it (a missile's, an interceptor's, flak) hurts it by how near.
  function blast(world, cx, cy, r, power = 1) {
    for (const j of world.jets || []) {
      if (j.dead) continue;
      const d = Math.max(0, Math.hypot(j.x - cx, j.y - cy) - 40), reach = r * 2 + 20;
      if (d < reach) hurt(world, j, 90 * power * (1 - d / reach), 'blast');
    }
  }
  // (crashed: its fuel goes up in a fireball where it hit, and its wreck lies there burning)
  const burnt = (c, x, y) => { const h = PW.hash2(x, y), k = 0.28 + ((h >>> 3) & 7) / 50; return PW.abgr(Math.min(255, (c & 255) * k + 14), Math.min(255, (c >>> 8 & 255) * k + 12), Math.min(255, (c >>> 16 & 255) * k + 10)); };
  function crash(world, j) {
    if (j.dead) return;
    j.dead = true;
    stats.crashed += 1;
    if (held === j) held = null;
    const fr = world.fragments, { mat, width: W, height: H } = world;
    const xs = [], ys = [], cs = [];
    const r = 100, P = poseOf(j);
    for (let y = Math.max(1, Math.floor(j.y - r)); y <= Math.min(H - 2, Math.ceil(j.y + r)); y += 1) {
      for (let x = Math.max(1, Math.floor(j.x - r)); x <= Math.min(W - 2, Math.ceil(j.x + r)); x += 1) {
        const col = pixelP(P, x + 0.5, y + 0.5);
        if (!col || !PW.mat.open[mat[y * W + x] & ID_MASK]) continue;
        xs.push(x); ys.push(y); cs.push(burnt(col, x, y));
      }
    }
    const [hx, hy] = toWorld(j, 60, 0);
    if (PW.explode) PW.explode(world, world.particles, { x: hx, y: hy, radius: 16, power: 1.0 });
    if (fr && xs.length) {
      const n = xs.length, hd = heading(j);
      fr.spawn({ data: { x: Int32Array.from(xs), y: Int32Array.from(ys), color: Uint32Array.from(cs), byte: new Uint8Array(n).fill(M.STEEL), solid: new Uint8Array(n).fill(1) },
        vx: Math.cos(hd) * j.v * 0.25, vy: -Math.sin(hd) * j.v * 0.15 - 40, omega: j.facing * 1.5, wreck: true });
    }
    if (world.heatSystem) world.heatSystem.heatDisc(j.x, j.y, 30, 800);
    if (PW.addSmoulder) PW.addSmoulder(world, j.x, j.y, 50, 80);
  }
  // What a round meets of it: its own pixels as drawn.
  const target = {
    hit(world, s, x0, y0, x1, y1) {
      const list = world.jets;
      if (!list || !list.length) return null;
      let best = null;
      const sx = x1 - x0, sy = y1 - y0, n = Math.max(1, Math.ceil(Math.hypot(sx, sy)));
      for (const j of list) {
        if (j.dead || j === s.from) continue;
        const f0 = Math.max(0, Math.min(1, ((j.x - x0) * sx + (j.y - y0) * sy) / (sx * sx + sy * sy || 1)));
        if (Math.hypot(x0 + sx * f0 - j.x, y0 + sy * f0 - j.y) > 110) continue;
        const P = poseOf(j);
        for (let q = 0; q <= n; q += 1) {
          const f = q / n;
          if (best && f >= best.f) break;
          if (pixelP(P, x0 + sx * f, y0 + sy * f)) { best = { f, x: x0 + sx * f, y: y0 + sy * f, ref: j, part: 1 }; break; }
        }
      }
      return best;
    },
    strike(world, j, s) {
      hurt(world, j, DAMAGE[s.kind] ?? 3, s.kind);
      return true;
    },
  };

  // ---- The step ---------------------------------------------------------------------------------------------
  function step(world, dt) {
    if (PW.shots && PW.shots.addTarget && !target.added) { PW.shots.addTarget(target); target.added = true; }
    const list = world.jets;
    if (!list || !list.length) return;
    current = world;
    for (const j of list) stepOne(world, j, dt);
    for (let q = list.length - 1; q >= 0; q -= 1) if (list[q].dead) list.splice(q, 1);
  }

  // ---- Drawn ------------------------------------------------------------------------------------------------
  let canvas = null, ctx2 = null, image = null, px32 = null;
  function draw(renderer) {
    const world = renderer.world || current;
    const list = world && world.jets;
    if (!list || !list.length) return;
    const { ctx, camera, view } = renderer;
    const z = camera.zoom, skip = Math.max(1, Math.floor(1 / z));
    const vx0 = camera.x, vy0 = camera.y, vx1 = vx0 + view.width / z, vy1 = vy0 + view.height / z;
    for (const j of list) {
      if (j.dead) continue;
      // (the box round it as it is turned: its art's corners in the world)
      const P = poseOf(j);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const [u, v] of [[-97, -41], [97, -41], [-97, 18], [97, 18]]) {
        const [wx, wy] = toWorld(j, u, v);
        bx0 = Math.min(bx0, wx); bx1 = Math.max(bx1, wx); by0 = Math.min(by0, wy); by1 = Math.max(by1, wy);
      }
      const x0 = Math.max(Math.floor(bx0) - 1, Math.floor(vx0)), x1 = Math.min(Math.ceil(bx1) + 1, Math.ceil(vx1));
      const y0 = Math.max(Math.floor(by0) - 1, Math.floor(vy0)), y1 = Math.min(Math.ceil(by1) + 1, Math.ceil(vy1));
      if (x1 <= x0 || y1 <= y0) continue;
      const iw = Math.ceil((x1 - x0) / skip), ih = Math.ceil((y1 - y0) / skip);
      if (!canvas || canvas.width < iw || canvas.height < ih) {
        canvas = document.createElement('canvas');
        canvas.width = Math.ceil(Math.max(iw, canvas ? canvas.width : 0) / 64) * 64; canvas.height = Math.ceil(Math.max(ih, canvas ? canvas.height : 0) / 64) * 64;
        ctx2 = canvas.getContext('2d'); image = ctx2.createImageData(canvas.width, canvas.height); px32 = new Uint32Array(image.data.buffer);
      }
      const stride = canvas.width;
      for (let jy = 0; jy < ih; jy += 1) {
        const wy = y0 + jy * skip + 0.5, row = jy * stride;
        px32.fill(0, row, row + iw);
        for (let ix = 0; ix < iw; ix += 1) { const col = pixelP(P, x0 + ix * skip + 0.5, wy); if (col) px32[row + ix] = col; }
      }
      ctx2.putImageData(image, 0, 0, 0, 0, iw, ih);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, iw, ih, Math.round((x0 - vx0) * z), Math.round((y0 - vy0) * z), Math.round(iw * skip * z), Math.round(ih * skip * z));
      // (its afterburner, a short flame out of its nozzle at full throttle)
      if (!j.down && j.throttle > 0.9 && !j.onGround) {
        const [fx, fy] = toWorld(j, -98, 0), hd = heading(j);
        ctx.fillStyle = 'rgba(255,170,70,0.85)';
        for (let k = 0; k < 8; k += 1) ctx.fillRect(Math.round((fx - Math.cos(hd) * k - vx0) * z), Math.round((fy + Math.sin(hd) * k - vy0) * z), Math.max(1, z * (3 - k * 0.3)), Math.max(1, z * (3 - k * 0.3)));
      }
    }
  }
  const before = PW.drawUnitsHook;
  PW.drawUnitsHook = (renderer) => { if (before) before(renderer); draw(renderer); };

  // ---- By hand -------------------------------------------------------------------------------------------------
  // A click on a jet takes it in hand (again: lets it go); with one in hand a click is where its
  // missiles go; a click on or near a base's runway puts a jet on the strip, and it takes off along it.
  let held = null, dropN = 0;
  function runwayNear(world, x, y) {
    let best = null, bd = 120;
    for (const s of world.settlements || []) {
      const r = s.runway;
      if (!r) continue;
      const lo = Math.min(r.from, r.to), hi = Math.max(r.from, r.to);
      const d = Math.max(0, lo - x, x - hi) + Math.abs(y - r.y);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  function tool(world, x, y, shift = false) {
    const list = world.jets || [];
    if (held && (held.dead || !list.includes(held))) held = null;
    const hit = list.find((j) => !j.dead && pixel(j, x, y));
    if (hit) { held = hit === held ? null : hit; return held; }
    if (held && !shift) { held.aim = { x, y }; return held; }
    const r = runwayNear(world, x, y);
    if (!r) return null;
    held = takeOff(world, r, ['modern', 'asian', 'gothic'][dropN++ % 3], null);
    return held;
  }
  // (a jet put at the start of runway r, rolling for take-off along it)
  function takeOff(world, r, style, side) {
    const dir = Math.sign(r.to - r.from) || 1;
    let s = side;
    if (!s) for (const st of world.settlements || []) if (st.runway === r) s = st.side || null;
    return create(world, { x: r.from + dir * 100, y: r.y - 17, facing: dir, onGround: true, runway: r, style, side: s, speed: 0 });
  }
  function hold(j) { held = j && !j.dead && j.kind === 'jet' ? j : null; return held; }
  function key(event) {
    if (!held || held.dead || held.down || event.repeat) return false;
    const j = held, world = current || (window.pwApp && window.pwApp.world), k = event.code;
    if (k === 'KeyA' || k === 'ArrowLeft') j.want = -1;
    else if (k === 'KeyD' || k === 'ArrowRight') j.want = 1;
    else if (k === 'KeyW' || k === 'ArrowUp') j.climb = Math.min(CLIMB_MAX, j.climb + 15);
    else if (k === 'KeyS' || k === 'ArrowDown') j.climb = Math.max(-CLIMB_MAX, j.climb - 15);
    else if (k === 'KeyF') fire(world, j);
    else if (k === 'KeyG') launch(world, j);
    else return false;
    return true;
  }

  PW.jets = { create, step, draw, fire, launch, hurt, blast, target, tool, takeOff, hold, held: () => held, key, pixel, heading, stats, runwayNear,
    LENGTH, CRUISE, VMAX, STALL, V_ROT, ARMOUR, MISSILES };
})();
