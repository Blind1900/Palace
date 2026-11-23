'use strict';
// Salvos and their interceptors (N90, the user's - the Iron Dome and Patriot refs): three wheeled
// units, at their real size, each side's colours:
// - a rocket launcher (Grad, MLRS): a truck with a pod of 12 tubes; told a spot, it fires a salvo -
//   a ripple of rockets, one every 0.15 s, each on the high arc that comes down there, spread a
//   little (PW.shots' rocket);
// - an Iron Dome battery: its radar watches the sky round it; a rocket or missile of the other side
//   it sees, it works out where it will come down - and only if that is on its own side's ground
//   (a building of its side, a unit, within reach of the impact) it fires at it once it is on its
//   way down, the soonest to strike first - two interceptors a moment apart, each with its
//   proximity fuse's chance of destroying it (PW.shots' interceptor); one coming down on open
//   ground it lets fall. A salvo bigger than its load gets partly through;
// - a Patriot battery: further and higher, two to a threat as well - rockets, missiles, and the
//   other side's jets (PW.shots' patriot).
// Each can be taken in hand (the user's: every unit can be controlled): a click aims a launcher, F
// fires its salvo; a battery fights on its own - F holds or frees its fire. What strikes them comes
// off their armour; destroyed, their ammunition goes up.
// Our own code throughout.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, passable } = PW.mat;
  const G = () => PW.GRAVITY || 260;

  const TYPES = {
    launcher: { length: 104, ammo: 12, kind: 'rocket', hp: 60 },
    dome: { length: 90, ammo: 20, kind: 'interceptor', hp: 60, range: 4000, perThreat: 2, protect: true },
    patriot: { length: 110, ammo: 8, kind: 'patriot', hp: 70, range: 4500, perThreat: 2, protect: false, jets: true },
    // a fixed autocannon seated on its mount on a military building's roof or wall (N6's devices):
    // bursts at the enemy units it sees in its arc (see PW.units' sight) - facing 0, both ways
    turret: { length: 12, ammo: 600, kind: 'cannon', hp: 30, burst: 6, rof: 1 / 9, rest: 1.4, fixed: true },
  };
  const RIPPLE = 0.15;          // s between a salvo's rockets
  const LAUNCH_GAP = 0.2;       // s between a battery's interceptors
  const ENGAGE = 5;             // s: a Dome fires at a threat this near coming down on its ground, no sooner
  const ENGAGE_LAST = 1;        // s: ... and no later - its interceptor would meet it too low
  const LOOK_EVERY = 6;         // ticks between a battery's looks at the sky
  const COVER = 70;             // cells: a threat coming down this near its side's building or unit is a threat to it
  const STYLES = {
    modern: { body: [118, 120, 96], dark: [84, 86, 68], light: [150, 152, 124] },
    asian: { body: [92, 108, 70], dark: [64, 78, 50], light: [122, 138, 96] },
    gothic: { body: [70, 84, 58], dark: [48, 58, 40], light: [98, 112, 80] },
  };
  const stats = { salvos: 0, rockets: 0, launched: 0, ignored: 0, destroyed: 0 };
  let current = null, seq = 0;

  const blocks = (world, x, y) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
    const id = world.mat[(y | 0) * world.width + (x | 0)] & ID_MASK;
    return phase[id] >= PHASE_POWDER && !passable[id];
  };
  const PHASE_POWDER = PW.PHASE.POWDER;
  function groundUnder(world, x, from = 0) {
    for (let y = Math.max(0, from); y < world.height - 1; y += 1) if (blocks(world, x, y + 1)) return y;
    return world.height - 2;
  }

  // ---- A unit ----------------------------------------------------------------------------------------
  // (x: its middle; y: the row its wheels stand on - a turret's: its mount, the device cell)
  function create(world, spec) {
    const type = TYPES[spec.type] ? spec.type : 'launcher', T = TYPES[type];
    const x = Math.round(spec.x), y = spec.y ?? groundUnder(world, x, 0);
    const u = { kind: 'defence', type, x, y, facing: T.fixed ? (spec.facing ?? 1) : spec.facing || 1, side: spec.side || null, style: STYLES[spec.style] ? spec.style : 'modern',
      hp: T.hp, dead: false, ammo: T.ammo, salvo: 0, salvoT: 0, aim: null, gap: 0, look: 0, hold: false, engaged: new Map(), hurtBy: '',
      building: spec.building || 0, burst: 0, burstT: 0, rest: 0, aimA: 0, seed: ++seq };
    (world.defence || (world.defence = [])).push(u);
    current = world;
    return u;
  }
  // (where its tubes are, and which way they point: a Dome's near straight up - its interceptors
  // clear the town's towers round it before they turn)
  function tubeOf(u) {
    const T = TYPES[u.type];
    if (u.type === 'launcher') return { x: u.x - u.facing * 20, y: u.y - 26, up: 0.75 };
    return { x: u.x - u.facing * (T.length * 0.2), y: u.y - 30, up: u.type === 'dome' ? 1.4 : 1.2 };
  }
  // (is the way its rounds go up open - nothing solid over its tubes along it for CLEAR_RUN cells,
  // a roof, a tower, a mast? It does not fire into one. Looked at again every CLEAR_EVERY s, the
  // world changing round it)
  const CLEAR_RUN = 360, CLEAR_EVERY = 2;
  function skyClear(world, u, facing = u.facing) {
    const t = tubeOf(u), dx = Math.cos(t.up) * facing, dy = -Math.sin(t.up);
    for (let d = 4; d < CLEAR_RUN; d += 2) {
      const x = Math.round(t.x + dx * d), y = Math.round(t.y + dy * d);
      if (y < 0) return true;
      if (blocks(world, x, y)) return false;
    }
    return true;
  }

  // ---- The launcher's salvo -----------------------------------------------------------------------------
  // (the angle - the high one - that brings a rocket from (x0, y0) down at (x1, y1): its straight
  // flight on its motor, then its arc under gravity and the air's drag, flown out and corrected)
  function laying(world, x0, y0, x1, y1) {
    const K = PW.shots.KINDS.rocket, g = G(), dir = Math.sign(x1 - x0) || 1;
    const landAt = (a) => {
      let x = x0, y = y0, vx = Math.cos(a) * dir * K.speed, vy = -Math.sin(a) * K.speed;
      const dt = 1 / 30;
      for (let t = 0; t < K.life; t += dt) {
        if (t >= K.burn) vy += g * dt;
        const keep = 1 - K.drag * dt;
        vx *= keep; vy *= keep;
        x += vx * dt; y += vy * dt;
        if (vy > 0 && y >= y1) return x;
      }
      return x;
    };
    // (the high arc: from steep down, the angle whose rocket comes down at x1)
    let lo = 46 * Math.PI / 180, hi = 84 * Math.PI / 180;
    for (let k = 0; k < 24; k += 1) {
      const mid = (lo + hi) / 2, d = (landAt(mid) - x1) * dir;
      if (d > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  function fire(world, u) {
    if (!u || u.dead || u.type !== 'launcher' || u.salvo > 0 || !u.aim || u.ammo <= 0) return false;
    u.salvo = Math.min(u.ammo, TYPES.launcher.ammo);
    u.salvoT = 0;
    u.facing = Math.sign(u.aim.x - u.x) || u.facing;
    u.laid = laying(world, tubeOf(u).x, tubeOf(u).y, u.aim.x, u.aim.y);
    stats.salvos += 1;
    return true;
  }
  function stepSalvo(world, u, dt) {
    u.salvoT -= dt;
    while (u.salvo > 0 && u.salvoT <= 0) {
      const t = tubeOf(u), spread = ((PW.hash3(u.seed, u.salvo, 3) & 255) / 255 - 0.5) * 0.03, a = u.laid + spread;
      PW.shots.fire(world, { kind: 'rocket', x: t.x, y: t.y, dx: Math.cos(a) * u.facing, dy: -Math.sin(a), side: u.side, from: u });
      if (PW.shots.report) PW.shots.report(world, t.x, t.y, -Math.cos(a) * u.facing, Math.sin(a), 2);
      u.salvo -= 1; u.ammo -= 1; u.salvoT += RIPPLE;
      stats.rockets += 1;
    }
  }

  // ---- A battery's watch ------------------------------------------------------------------------------------
  // (where and when a round in flight will come down, flown out under gravity and drag: { x, t } -
  // t the seconds till then - or null; an unguided rocket's, its motor burnt out, worked out once)
  function impactAt(world, s) {
    if (s.impact && s.impact.age !== undefined) return s.impact.x === null ? null : { x: s.impact.x, t: s.impact.t - (s.age - s.impact.age) };
    const K = s.k, g = G(), dt = 1 / 20;
    let x = s.x, y = s.y, vx = s.vx, vy = s.vy, fuel = s.fuel || 0, at = null;
    for (let t = 0; t < 30; t += dt) {
      if (fuel > 0) fuel -= dt; else vy += g * dt;
      const keep = 1 - K.drag * dt;
      vx *= keep; vy *= keep;
      x += vx * dt; y += vy * dt;
      const xi = Math.floor(x);
      if (xi < 0 || xi >= world.width) break;
      if (vy > 0 && y >= world.groundTop[xi]) { at = { x, t: t + dt }; break; }
    }
    if (!K.turn && !(s.fuel > 0)) s.impact = { x: at ? at.x : null, t: at ? at.t : 0, age: s.age };
    return at;
  }
  function impactOf(world, s) { const at = impactAt(world, s); return at ? at.x : null; }
  // (is ground at x its side's - a building of its side, or its units, within COVER of it?)
  function ownGround(world, side, x) {
    for (const b of world.buildings || []) {
      const s = b.faction || b.side;
      if (s !== side || !b.body) continue;
      if (x >= b.body.left - COVER && x <= b.body.right + COVER) return true;
    }
    for (const list of [world.tanks, world.troops, world.mechs, world.defence]) for (const v of list || []) if (!v.dead && v.side === side && Math.abs(v.x - x) < COVER) return true;
    return false;
  }
  // (u.engaged: the threats it has fired at, and how many interceptors at each - two, a moment
  // apart, the second in case the first's burst does not destroy it)
  function watch(world, u, dt) {
    const T = TYPES[u.type];
    if (u.gap > 0) u.gap -= dt;
    if ((u.clearT = (u.clearT || 0) - dt) <= 0) {
      u.clearT = CLEAR_EVERY;
      u.blocked = !skyClear(world, u, 1) && !skyClear(world, u, -1);
    }
    if (u.hold || u.blocked || u.ammo <= 0 || ++u.look < LOOK_EVERY) return;
    u.look = 0;
    // (threats it has fired at that are gone: forgotten)
    for (const s of u.engaged.keys()) if (s.done || s.dead) u.engaged.delete(s);
    const threats = [];
    for (const s of world.shots || []) {
      if (s.done || !s.k.blast || !(s.kind === 'rocket' || s.kind === 'missile') || !s.side || s.side === u.side) continue;
      if (Math.hypot(s.x - u.x, s.y - u.y) > T.range) continue;
      if ((u.engaged.get(s) || 0) >= T.perThreat) continue;
      let soon = Math.hypot(s.x - u.x, s.y - u.y) / 1000;
      if (T.protect) {
        // (only what comes down on its side's ground - and that once it is on its way down to it)
        const at = impactAt(world, s);
        if (at === null || !ownGround(world, u.side, at.x)) { if (!s.letFall) { s.letFall = true; stats.ignored += 1; } continue; }
        if (at.t > ENGAGE || at.t < ENGAGE_LAST) continue;
        soon = at.t;
      }
      threats.push({ s, soon });
    }
    if (T.jets) for (const j of world.jets || []) {
      if (j.dead || j.down || !j.side || j.side === u.side || Math.hypot(j.x - u.x, j.y - u.y) > T.range) continue;
      if ((u.engaged.get(j) || 0) < T.perThreat) threats.push({ s: j, soon: Math.hypot(j.x - u.x, j.y - u.y) / 1000 });
    }
    // (what will strike soonest first, one at a time, its interceptors a moment apart)
    threats.sort((a, b) => a.soon - b.soon);
    for (const { s } of threats) {
      if (u.gap > 0 || u.ammo <= 0) break;
      // (its launcher turned to the threat's side - or, the way up shut that side, the other)
      const f = Math.sign(s.x - u.x) || u.facing;
      u.facing = skyClear(world, u, f) ? f : -f;
      const t = tubeOf(u);
      PW.shots.fire(world, { kind: T.kind, x: t.x, y: t.y, dx: Math.cos(t.up) * u.facing, dy: -Math.sin(t.up), side: u.side, from: u, target: s });
      u.engaged.set(s, (u.engaged.get(s) || 0) + 1);
      // (the gap counted from when it was due - its looks at the sky are LOOK_EVERY ticks apart)
      u.ammo -= 1; u.gap = Math.max(-LOOK_EVERY / 60, u.gap) + LAUNCH_GAP;
      stats.launched += 1;
    }
  }

  // ---- Struck ---------------------------------------------------------------------------------------------
  const DAMAGE = { bullet: 2, cannon: 12, he: 70, ap: 70, missile: 100, rocket: 60, interceptor: 30, patriot: 100 };
  function hurt(world, u, amount, cause) {
    if (u.dead || !(amount > 0)) return;
    u.hp -= amount; u.hurtBy = cause;
    if (u.hp > 0) return;
    u.dead = true;
    stats.destroyed += 1;
    if (held === u) held = null;
    // (its ammunition goes up - a turret's a little, where it sits)
    if (TYPES[u.type].fixed) { if (PW.explode) PW.explode(world, world.particles, { x: u.x, y: u.y - 4, radius: 5, power: 0.4 }); return; }
    if (PW.explode) PW.explode(world, world.particles, { x: u.x, y: u.y - 14, radius: 10, power: 0.8 });
    if (PW.addSmoulder) PW.addSmoulder(world, u.x, u.y, 30, 60);
  }
  function blast(world, cx, cy, r, power = 1) {
    for (const u of world.defence || []) {
      if (u.dead) continue;
      const d = Math.max(0, Math.hypot(u.x - cx, u.y - 14 - cy) - TYPES[u.type].length / 2), reach = r * 1.6 + 6;
      if (d < reach) hurt(world, u, 80 * power * (1 - d / reach) ** 2, 'blast');
    }
  }
  const boxOf = (u) => (TYPES[u.type].fixed ? { x0: u.x - 6, x1: u.x + 6, y0: u.y - 8, y1: u.y }
    : { x0: u.x - TYPES[u.type].length / 2, x1: u.x + TYPES[u.type].length / 2, y0: u.y - 30, y1: u.y });
  const target = {
    hit(world, s, x0, y0, x1, y1) {
      let best = null;
      for (const u of world.defence || []) {
        if (u.dead || u === s.from) continue;
        const b = boxOf(u);
        let f0 = 0, f1 = 1;
        for (const [p0, d, lo, hi] of [[x0, x1 - x0, b.x0, b.x1], [y0, y1 - y0, b.y0, b.y1]]) {
          if (Math.abs(d) < 1e-9) { if (p0 < lo || p0 > hi) { f0 = 2; break; } continue; }
          let a = (lo - p0) / d, c = (hi - p0) / d;
          if (a > c) [a, c] = [c, a];
          f0 = Math.max(f0, a); f1 = Math.min(f1, c);
          if (f0 > f1) break;
        }
        if (f0 > f1 || f0 > 1) continue;
        if (!best || f0 < best.f) best = { f: f0, x: x0 + (x1 - x0) * f0, y: y0 + (y1 - y0) * f0, ref: u, part: 1 };
      }
      return best;
    },
    strike(world, u, s) { hurt(world, u, DAMAGE[s.kind] ?? 2, s.kind); return true; },
  };

  // ---- The step ------------------------------------------------------------------------------------------------
  function step(world, dt) {
    if (PW.shots && PW.shots.addTarget && !target.added) { PW.shots.addTarget(target); target.added = true; }
    const list = world.defence;
    if (!list || !list.length || !PW.shots) return;
    current = world;
    for (const u of list) {
      // (put out of action a while - a hack: see PW.units.disable)
      if (u.dead || (u.disabledUntil || 0) > (world.tick || 0)) continue;
      if (u.type === 'turret') { turretStep(world, u, dt); continue; }
      if (u.salvo > 0) stepSalvo(world, u, dt);
      if (u.type !== 'launcher') watch(world, u, dt);
    }
    for (let q = list.length - 1; q >= 0; q -= 1) if (list[q].dead) list.splice(q, 1);
  }
  // A turret: a look round its arc now and then for an enemy it sees (PW.units' sight); one seen, a
  // burst at it - each round led where it will be - then a moment's rest.
  function turretStep(world, u, dt) {
    const T = TYPES.turret;
    if (u.burst > 0) {
      u.burstT -= dt;
      while (u.burst > 0 && u.burstT <= 0) {
        const f = u.foe;
        if (!f || f.dead || u.ammo <= 0) { u.burst = 0; break; }
        // (a burst at a spot clicked - see click - or at an enemy's body)
        const p = f.spot ? f : PW.units.body(f), mx = u.x + Math.cos(u.aimA) * 7, my = u.y - 4 - Math.sin(u.aimA) * 7;
        const d = Math.hypot(p.x - mx, p.y - my), tau = d / PW.shots.KINDS.cannon.speed, vx = f.vx || 0, vy = f.vy || 0;
        const tx = p.x + vx * tau, ty = p.y + vy * tau;
        u.aimA = Math.atan2(-(ty - my), tx - mx);
        PW.shots.fire(world, { kind: T.kind, x: mx, y: my, dx: tx - mx, dy: ty - my, side: u.side, from: u, spread: 0.015 });
        if (PW.shots.report) PW.shots.report(world, mx, my, Math.cos(u.aimA), -Math.sin(u.aimA), 1);
        u.burst -= 1; u.ammo -= 1; u.burstT += T.rof;
      }
      return;
    }
    if ((u.rest -= dt) > 0 || ++u.look < LOOK_EVERY || !PW.units) return;
    u.look = 0;
    const foe = PW.units.spot(world, u);
    if (!foe) return;
    const p = PW.units.body(foe);
    u.foe = foe; u.aimA = Math.atan2(-(p.y - (u.y - 4)), p.x - u.x);
    u.burst = T.burst; u.burstT = 0; u.rest = T.rest;
  }

  // ---- Drawn: a truck, its cab at the front, its launcher on the bed - tubes raised ----------------------------
  function draw(renderer) {
    const world = renderer.world || current, list = world && world.defence;
    if (!list || !list.length) return;
    const { ctx, camera } = renderer, z = camera.zoom;
    const cell = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), Math.max(1, Math.round(w * z)), Math.max(1, Math.round(h * z))); };
    const col = (c, k = 1) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
    for (const u of list) {
      if (u.dead) continue;
      const T = TYPES[u.type], st = STYLES[u.style], L = T.length, f = u.facing, x0 = u.x - L / 2, y = u.y;
      if (T.fixed) {
        // (a turret on its mount: a low armoured box, its mantlet, the barrel the way it last laid -
        // out of action, its barrel down)
        const off = (u.disabledUntil || 0) > (world.tick || 0), a = off ? -0.5 * (f || 1) : u.aimA || (f < 0 ? Math.PI : 0);
        cell(u.x - 6, y - 5, 12, 5, col(st.dark)); cell(u.x - 6, y - 5, 12, 1, col(st.light));
        cell(u.x - 3, y - 8, 6, 3, col(st.body));
        for (let k = 2; k <= 9; k += 1) cell(u.x + Math.cos(a) * k - 0.5, y - 6 - Math.sin(a) * k - 0.5, 1.4, 1.4, 'rgb(46,48,50)');
        continue;
      }
      // (chassis and wheels)
      cell(x0, y - 12, L, 5, col(st.body)); cell(x0, y - 12, L, 1, col(st.light));
      for (let k = 0; k < 4; k += 1) { const wx = u.x + f * (L / 2 - 12 - k * (L - 24) / 3); cell(wx - 5, y - 9, 10, 10, 'rgb(34,34,36)'); cell(wx - 2, y - 6, 4, 4, 'rgb(96,96,92)'); }
      // (the cab, at the front)
      const cx = f > 0 ? u.x + L / 2 - 22 : x0;
      cell(cx, y - 26, 22, 14, col(st.body)); cell(cx + (f > 0 ? 12 : 2), y - 24, 8, 6, 'rgb(40,56,64)');
      // (the launcher on its bed: a box of tubes raised, rows of round mouths)
      const len = u.type === 'launcher' ? 52 : 40, a = u.type === 'launcher' ? (u.laid || 0.5) : tubeOf(u).up, base = u.x - f * 14, by = y - 14;
      ctx.save();
      ctx.translate(Math.round((base - camera.x) * z), Math.round((by - camera.y) * z));
      ctx.rotate(-a * f);
      ctx.scale(f, 1);
      ctx.fillStyle = col(st.dark); ctx.fillRect(-len * z * 0.15, -14 * z, len * z, 14 * z);
      ctx.fillStyle = col(st.light); ctx.fillRect(-len * z * 0.15, -14 * z, len * z, 2 * z);
      ctx.fillStyle = 'rgb(28,28,30)';
      const rows = u.type === 'patriot' ? 2 : 3, cols = u.type === 'patriot' ? 2 : u.type === 'dome' ? 5 : 4;
      for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) ctx.fillRect(len * z * 0.85 - 2 * z, (-12 + r * 4.4 + (c % 2) * 0.8) * z, 2 * z, 2.6 * z);
      ctx.restore();
      if (u.type !== 'launcher') { cell(u.x + f * 6 - 5, y - 40, 10, 12, col(st.light, 0.9)); cell(u.x + f * 6 - 1, y - 28, 2, 16, col(st.dark)); }   // (its radar)
    }
  }
  const before = PW.drawUnitsHook;
  PW.drawUnitsHook = (renderer) => { if (before) before(renderer); draw(renderer); };

  // ---- By hand --------------------------------------------------------------------------------------------------
  let held = null;
  function tool(world, x, y, type = 'launcher', side = null) {
    const list = world.defence || [];
    if (held && (held.dead || !list.includes(held))) held = null;
    const hit = list.find((u) => !u.dead && x >= boxOf(u).x0 && x <= boxOf(u).x1 && y >= boxOf(u).y0 - 20 && y <= boxOf(u).y1 + 2);
    if (hit) { held = hit === held ? null : hit; return held; }
    if (held) { held.aim = { x, y }; return held; }
    const gx = Math.round(x);
    if (gx < 80 || gx > world.width - 80) return null;
    const gy = groundUnder(world, gx, Math.max(0, Math.round(y) - 40));
    held = create(world, { type, x: gx, y: gy, side, facing: gx < world.width / 2 ? 1 : -1 });
    return held;
  }
  function hold(u) { held = u && !u.dead && u.kind === 'defence' ? u : null; return held; }
  function key(event) {
    if (!held || held.dead || event.repeat || event.type === 'keyup') return false;
    const world = current || (window.pwApp && window.pwApp.world);
    if (event.code === 'KeyF') { if (held.type === 'launcher') fire(world, held); else held.hold = !held.hold; return true; }
    return false;
  }
  // The mouse (N102, the user's controls): a left click at a spot - a launcher lays its salvo on it,
  // a turret fires a burst at it (one that can be put out of action, out of it, does nothing). The
  // interceptor batteries fire on their own, and none has another fire: a right click is not theirs.
  // (True when the one in hand took it.)
  function click(world, x, y, button = 0) {
    const u = held;
    if (!u || u.dead || button !== 0 || (PW.units && PW.units.disabled && PW.units.disabled(world, u))) return false;
    if (u.type === 'launcher') { u.aim = { x, y }; fire(world, u); return true; }
    if (u.type === 'turret' && !(u.burst > 0) && u.ammo > 0) {
      u.foe = { spot: true, x, y, dead: false };
      u.aimA = Math.atan2(-(y - (u.y - 4)), x - u.x);
      u.burst = TYPES.turret.burst; u.burstT = 0; u.rest = TYPES.turret.rest;
      return true;
    }
    return false;
  }

  // (silenced a while - a hack on its base: see PW.units.disable)
  const disable = (u, seconds) => (PW.units ? PW.units.disable(u, seconds) : false);
  PW.defence = { create, step, draw, fire, hurt, blast, target, tool, hold, held: () => held, key, click, disable, laying, impactOf, impactAt, ownGround, skyClear, stats, TYPES };
})();
