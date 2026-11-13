'use strict';
// Supply pipelines (ported from the beta's pipeline rules, at native scale). Each base runs an SM,
// an HM and a water line underground between its own structures. A line follows the ground at its
// cover depth and dips under basements, the core pit and buried cores; where it crosses a tunnel or
// a shaft it is fixed to the back wall, so it never blocks the way. Risers connect each building,
// the lake pump and the mining operations. Cargo flows towards the core and stops at a break. A
// blast that cuts a line leaves the broken span until the crew re-lays it around the crater, a few
// cells a second, for HM per cell. Pumps only measure their lake: they never take water out.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;
  const { structural, terrain } = PW.mat;

  const LINES = [
    { resource: 'sm', depth: 22, casing: [52, 130, 46], channel: [14, 30, 14], cargo: [127, 214, 91] },
    { resource: 'hm', depth: 32, casing: [150, 120, 40], channel: [34, 27, 12], cargo: [230, 205, 114] },
    { resource: 'water', depth: 42, casing: [67, 115, 128], channel: [10, 26, 34], cargo: [140, 210, 226] },
  ];
  const BORE = 5;                    // casing, three channel rows, casing (0.35 m)
  const OWNER_BASE = 60000;
  const REPAIR_DELAY = 6 * 60, REPAIR_CELLS_PER_TICK = 0.1, REPAIR_HM_PER_CELL = 0.25;
  const CARGO_SPACING = 20, CARGO_SPEED = 30;    // cells, cells per second

  const rgb = (c) => PW.abgr(c[0] | 0, c[1] | 0, c[2] | 0);
  const tone = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
  // Which lines each kind of building draws from or feeds.
  const USES = {
    core: { sm: 'in', hm: 'in', water: 'in' }, population: { sm: 'in', water: 'in' }, military: { hm: 'in', sm: 'in' },
    farm: { sm: 'out', water: 'in' }, mine: { hm: 'out' }, pump: { water: 'out' }, mining: { hm: 'out' },
  };

  function createPipes(world) {
    const { mat, width: W, height: H } = world;
    const lines = [];
    const stats = { lines: 0, cells: 0, broken: 0, repaired: 0, repairHM: 0 };
    let tick = 0;

    // ---- Routing ----------------------------------------------------------------------------------
    const isTunnel = (x, y) => (PW.getFlags(world, x, y) & FLAG.TUNNEL) !== 0;
    const buildingOwned = (x, y) => { const o = PW.getOwner(world, x, y); return o > 0 && o < OWNER_BASE - 10000; };
    function blocked(x, y) {
      const i = y * W + x, id = mat[i] & ID_MASK;
      if (id === M.ORE || id === M.CORE || (structural[id] && !isTunnel(x, y))) return true;
      // An underground cavity (a cave, a blast hole) is gone round below, not bridged.
      if (PW.mat.open[id] && y > world.groundTop[x] && !isTunnel(x, y) && !buildingOwned(x, y) && !PW.getLayer(world, 'back', x, y)) return true;
      return buildingOwned(x, y) && !isTunnel(x, y);   // a building (not a tunnel network)
    }
    // Pipe top row per column: cover depth under the ground, then below anything in the way.
    function contour(x0, x1, depth) {
      const ys = new Int32Array(x1 - x0 + 1);
      // The ground a line follows: the shallowest ground within BRIDGE columns, so it crosses a
      // shaft or a narrow cut (fixed to its back wall) instead of diving down into it. Under a lake
      // the ground is its bed, not the water surface.
      const BRIDGE = 20;
      const groundAt = (x) => {
        let g = world.groundTop[x];
        if ((mat[g * W + x] & ID_MASK) === M.WATER) g = PW.supportBelow(world, x, g, true);
        return g;
      };
      for (let x = x0; x <= x1; x += 1) {
        // Bridge only openings that belong to a tunnel or a building (a shaft, the core pit's
        // edge); open ground lowered by a crater is followed down, so the line goes under it.
        const own = groundAt(x);
        let ground = own;
        for (let dx = -BRIDGE; dx <= BRIDGE; dx += 2) ground = Math.min(ground, groundAt(Math.max(0, Math.min(W - 1, x + dx))));
        for (let y = ground; y < own && ground < own; y += 1) {
          const id = mat[y * W + x] & ID_MASK;
          if (PW.mat.open[id] && !isTunnel(x, y) && !buildingOwned(x, y)) ground = own;
        }
        let y = ground + depth;
        for (let scan = ground; scan < y + BORE + 3 && scan < H - 40; scan += 1) {
          if (blocked(x, scan)) y = Math.max(y, scan + 4);
        }
        ys[x - x0] = y;
      }
      // Bends no steeper than 45°: only ever deepen to clear neighbours.
      for (let k = 1; k < ys.length; k += 1) ys[k] = Math.max(ys[k], ys[k - 1] - 1);
      for (let k = ys.length - 2; k >= 0; k -= 1) ys[k] = Math.max(ys[k], ys[k + 1] - 1);
      return ys;
    }
    function pipeColor(spec, row, along, vertical) {
      let c = row === 0 ? tone(spec.casing, 1.18) : row === BORE - 1 ? tone(spec.casing, 0.72) : spec.channel;
      if (row > 0 && row < BORE - 1 && along % 24 === 0) c = tone(spec.casing, 0.9);   // flange
      if (vertical && (row === 0 || row === BORE - 1)) c = tone(spec.casing, row === 0 ? 1.1 : 0.78);
      return c;
    }
    // Lay one pipe cell: in rock it is a PIPE cell; across open tunnel it is drawn on the back wall.
    function layCell(line, x, y, color) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      const id = mat[y * W + x] & ID_MASK;
      if (id === M.AIR) {
        if (!isTunnel(x, y) && y < world.groundTop[x]) return false;   // never in the open sky
        PW.setLayer(world, 'back', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      }
      if (id === M.REINFORCED || id === M.LINING) {
        // Through a tunnel's lining in a sleeve: the wall stays, the pipe shows in it.
        PW.setLayer(world, 'paint', x, y, rgb(color));
        PW.setFlag(world, x, y, FLAG.FIXTURE);
        return true;
      }
      if (!terrain[id] && id !== M.PIPE) return false;
      if (id === M.ORE) return false;
      PW.set(world, x, y, M.PIPE, { quiet: true });
      PW.setLayer(world, 'paint', x, y, rgb(color));
      PW.setOwner(world, x, y, line.owner);
      return true;
    }
    function layColumn(line, x) {
      const y = line.ys[x - line.x0];
      for (let r = 0; r < BORE; r += 1) layCell(line, x, y + r, pipeColor(line.spec, r, x, false));
    }
    // A riser between the line and an anchor at (x, yEnd); returns its column (x) and rows.
    function layRiser(line, anchor) {
      const lineY = line.ys[Math.max(0, Math.min(line.ys.length - 1, anchor.x - line.x0))];
      const yA = Math.min(anchor.y, lineY), yB = Math.max(anchor.y, lineY + BORE - 1);
      for (let y = yA; y <= yB; y += 1) {
        for (let r = 0; r < 3; r += 1) {
          const color = r === 1 ? line.spec.channel : tone(line.spec.casing, r === 0 ? 1.12 : 0.76);
          layCell(line, anchor.x - 1 + r, y, (y - yA) % 24 === 0 && r === 1 ? tone(line.spec.casing, 0.9) : color);
        }
      }
      return { x: anchor.x, y0: yA, y1: yB, flow: anchor.flow };
    }

    // ---- Anchors -------------------------------------------------------------------------------------
    // Where each building connects: under its floor (below anything it owns in that column).
    function buildingAnchor(b, kind) {
      const cx = Math.round((b.body.left + b.body.right) / 2);
      for (let shift = 0; shift < 60; shift += 6) {
        for (const x of [cx + shift, cx - shift]) {
          let y = b.ground + 1, clear = true;
          while (y < b.ground + 140 && PW.getOwner(world, x, y) === b.id) y += 1;
          for (let k = y; k < y + 8; k += 1) if (blocked(x, k)) clear = false;
          if (clear) return { x, y, kind, building: b.id };
        }
      }
      return { x: cx, y: b.ground + 12, kind, building: b.id };
    }
    function anchorsFor(settlement) {
      const out = [];
      for (const b of settlement.buildings) {
        if (USES[b.type]) out.push(buildingAnchor(b, b.type));
        if (b.pump) out.push({ x: b.pump.x, y: b.pump.y + 2, kind: 'pump', building: b.id });
      }
      for (const op of world.miningOps || []) {
        if (op.side === settlement.side && op.riser) out.push({ x: op.riser.x, y: op.riser.y, kind: 'mining', op: op.id });
      }
      return out;
    }

    // ---- Build -------------------------------------------------------------------------------------
    function build() {
      for (const settlement of world.settlements || []) {
        if (settlement.side === 'neutral') continue;   // neutral towns have no supply lines until captured
        const anchors = anchorsFor(settlement);
        const core = settlement.buildings.find((b) => b.type === 'core');
        const coreX = core ? Math.round((core.body.left + core.body.right) / 2) : (settlement.streetLeft + settlement.streetRight) >> 1;
        LINES.forEach((spec, index) => {
          const users = anchors.filter((a) => USES[a.kind] && USES[a.kind][spec.resource]);
          if (users.length < 2) return;
          const x0 = Math.min(...users.map((a) => a.x)) - 4, x1 = Math.max(...users.map((a) => a.x)) + 4;
          const line = { id: lines.length, side: settlement.side, resource: spec.resource, spec, owner: OWNER_BASE + lines.length,
            x0, x1, ys: contour(x0, x1, spec.depth), coreX, risers: [], broken: new Uint8Array(x1 - x0 + 1), brokenAt: new Int32Array(x1 - x0 + 1) };
          for (let x = x0; x <= x1; x += 1) layColumn(line, x);
          for (const a of users) line.risers.push(layRiser(line, { ...a, flow: USES[a.kind][spec.resource] }));
          lines.push(line);
          void index;
        });
      }
      stats.lines = lines.length;
      world.pipes = api;
      return lines;
    }

    // ---- Breaks and repair -----------------------------------------------------------------------------
    const intactAt = (line, x) => {
      const y = line.ys[x - line.x0];
      for (let r = 1; r < BORE - 1; r += 1) {
        const id = mat[(y + r) * W + x] & ID_MASK;
        if (id === M.PIPE) return true;
        if (id === M.AIR && isTunnel(x, y + r) && PW.getLayer(world, 'back', x, y + r)) return true;     // along a tunnel wall
        if ((id === M.REINFORCED || id === M.LINING) && (PW.getFlags(world, x, y + r) & FLAG.FIXTURE)) return true;   // in a sleeve
      }
      return false;
    };
    function check() {
      let broken = 0;
      for (const line of lines) {
        for (let x = line.x0; x <= line.x1; x += 1) {
          const k = x - line.x0;
          if (!intactAt(line, x)) {
            if (!line.broken[k]) { line.broken[k] = 1; line.brokenAt[k] = tick; }
            broken += 1;
          } else line.broken[k] = 0;
        }
      }
      stats.broken = broken;
    }
    // The crew re-lays broken columns after a delay, along the new contour (around the crater).
    let repairBudget = 0;
    function repair() {
      repairBudget = Math.min(4, repairBudget + REPAIR_CELLS_PER_TICK);
      for (const line of lines) {
        for (let k = 0; k < line.broken.length && repairBudget >= 1; k += 1) {
          if (!line.broken[k] || tick - line.brokenAt[k] < REPAIR_DELAY) continue;
          const x = line.x0 + k;
          const fresh = contour(Math.max(line.x0, x - 2), Math.min(line.x1, x + 2), line.spec.depth);
          line.ys[k] = Math.max(fresh[Math.min(2, x - Math.max(line.x0, x - 2))], line.ys[k]);
          layColumn(line, x);
          if (intactAt(line, x)) {
            line.broken[k] = 0;
            repairBudget -= 1;
            stats.repaired += 1;
            stats.repairHM += REPAIR_HM_PER_CELL;
            // Keep the bends no steeper than 45°: neighbours step down to meet a deeper span.
            for (const n of [k - 1, k + 1]) {
              if (n < 0 || n >= line.ys.length || line.broken[n]) continue;
              if (line.ys[n] < line.ys[k] - 1) { line.ys[n] = line.ys[k] - 1; layColumn(line, line.x0 + n); }
            }
          }
        }
      }
    }
    function step() {
      tick += 1;
      if (tick % 30 === 0) check();
      if (stats.broken) repair();
    }
    // Is the line carrying from (x) to the core? (no break between them)
    function flowing(line, x) {
      const a = Math.min(x, line.coreX), b = Math.max(x, line.coreX);
      for (let c = Math.max(line.x0, a); c <= Math.min(line.x1, b); c += 1) if (line.broken[c - line.x0]) return false;
      return true;
    }
    function lineFor(side, resource) { return lines.find((l) => l.side === side && l.resource === resource) || null; }
    // Connect a mining operation opened during play: extend its side's HM line to it if needed,
    // then lay the riser up from its hopper.
    function attach(op) {
      const line = lineFor(op.side, 'hm');
      if (!line || !op.riser) return false;
      const x = op.riser.x;
      if (x - 4 < line.x0 || x + 4 > line.x1) {
        const x0 = Math.min(line.x0, x - 4), x1 = Math.max(line.x1, x + 4);
        const ys = new Int32Array(x1 - x0 + 1), fresh = contour(x0, x1, line.spec.depth);
        for (let c = x0; c <= x1; c += 1) ys[c - x0] = c >= line.x0 && c <= line.x1 ? line.ys[c - line.x0] : fresh[c - x0];
        const broken = new Uint8Array(ys.length), brokenAt = new Int32Array(ys.length);
        broken.set(line.broken, line.x0 - x0); brokenAt.set(line.brokenAt, line.x0 - x0);
        const old0 = line.x0, old1 = line.x1;
        Object.assign(line, { x0, x1, ys, broken, brokenAt });
        for (let c = x0; c <= x1; c += 1) if (c < old0 || c > old1) layColumn(line, c);
      }
      line.risers.push(layRiser(line, { x, y: op.riser.y, flow: 'out' }));
      return true;
    }

    // ---- Cargo overlay ----------------------------------------------------------------------------------
    function draw(renderer, time) {
      const { ctx, camera, view } = renderer;
      const z = camera.zoom;
      if (z < 0.5) return;
      const size = Math.max(1, Math.round(z));
      const vx0 = camera.x - 4, vx1 = camera.x + view.width / z + 4, vy0 = camera.y - 4, vy1 = camera.y + view.height / z + 4;
      const shift = time * CARGO_SPEED;
      for (const line of lines) {
        const x0 = Math.max(line.x0, Math.floor(vx0)), x1 = Math.min(line.x1, Math.ceil(vx1));
        if (x1 < x0) continue;
        ctx.fillStyle = `rgb(${line.spec.cargo})`;
        ctx.beginPath();
        // Along the line, towards the core; a break stops everything beyond it.
        for (let x = x0; x <= x1; x += 1) {
          const k = x - line.x0, y = line.ys[k] + 2;
          if (y < vy0 || y > vy1 || line.broken[k] || !flowing(line, x)) continue;
          const toward = x < line.coreX ? 1 : -1;
          const phase = ((x * toward - shift) % CARGO_SPACING + CARGO_SPACING) % CARGO_SPACING;
          if (phase < 3) ctx.rect(Math.round((x - camera.x) * z), Math.round((y - camera.y) * z), size, size);
        }
        // Up or down each riser.
        for (const riser of line.risers) {
          if (riser.x < vx0 || riser.x > vx1 || !flowing(line, riser.x)) continue;
          const into = riser.flow === 'out';    // producers feed the line
          const anchorAbove = riser.y0 < line.ys[Math.max(0, Math.min(line.ys.length - 1, riser.x - line.x0))];
          const down = into === anchorAbove;
          for (let y = Math.max(riser.y0, Math.floor(vy0)); y <= Math.min(riser.y1, vy1); y += 1) {
            const phase = (((down ? y : -y) - shift) % CARGO_SPACING + CARGO_SPACING) % CARGO_SPACING;
            if (phase < 3) ctx.rect(Math.round((riser.x - camera.x) * z), Math.round((y - camera.y) * z), size, size);
          }
        }
        ctx.fill();
      }
    }

    const api = { build, step, draw, attach, lines, stats, flowing, lineFor, contour, LINES };
    return api;
  }

  PW.createPipes = createPipes;
  PW.PIPE_LINES = LINES;
})();
