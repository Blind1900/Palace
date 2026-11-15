'use strict';
// Ground stability: landslides, cave-ins and avalanches. Ground stands where it rests on what is
// under it; where it reaches out over a void it is held only by the ground beside it, and each kind
// of ground can reach out only so far (its cohesion: soil a few cells, stone a wide span). Ground
// that reaches out further than that breaks loose and falls, and whatever rested on it goes with it.
// Only ground that something disturbed is looked at (a blast, a piece of a building striking it), so
// a mountain stands until it is blown open: then the rock over the hole comes down, the slope above
// it loses its footing, and the slide pours down the mountainside. A blast also shakes the steep
// ground around it, loosening the surface so it slides away.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;
  const { phase, terrain, breaksTo, cohesion, open } = PW.mat;

  const SETTLE = 8;          // ticks after a disturbance before the ground there is looked at
  const AGAIN = 20;          // and again this long after, while the slide goes on
  const ROUNDS = 40;         // at most this many looks at one disturbance
  const MAX_TALL = 1200;     // rows a look at the surface reaches up the face or slope above it
  const QUIET = 3;           // it is let be after this many looks in a row that broke nothing (what
                             // the ground rested on may still be sliding away from under it)
  const RAIN_DEPTH = 4;      // ground breaking over a void deeper than this falls as a particle
  const CELLS_PER_TICK = 16000;   // cells of a look worked through per tick
  const BREAKS_PER_TICK = 1200;   // cells broken loose per tick
  const GROW = 200;          // rows a look reaches higher when the slide goes on above its box
  const GROW_SIDE = 160;     // columns it reaches further out when the slide goes on past its sides
  // A cut face stands only so tall: a free face taller than FACE x the ground's cohesion (soil about
  // a metre, rock four or five) fails - a wedge of it comes away, thicker the higher the face
  // stood (WEDGE cells per cell of height over what it can hold), and pours down the slope; the face
  // goes on failing until what fell banks against its foot and buttresses it.
  const FACE = 4, WEDGE = 0.4, MAX_WEDGE = 80;
  const SHOCK_MIN = 6000;    // a shock weaker than this is felt by nothing (a few pebbles landing)
  const SLIDE_SPEED = 40;    // cells a second ground breaking loose comes down at, for its shock
  const SHOCK_EVERY = 6;     // ticks between gathering up the strikes of flying debris
  const FAR = 0xffff;

  function createStability(world, particles) {
    const { mat, width: W, height: H } = world;
    const F = PW.PARTICLE;
    const stats = { regions: 0, looked: 0, broken: 0, loosened: 0 };
    const pending = [];
    let tick = 0;

    // Ground that can break loose: natural or made ground no building or tunnel owns.
    const breakable = (i, x, y) => {
      const id = mat[i] & ID_MASK;
      return terrain[id] && phase[id] === PW.PHASE.SOLID && cohesion[id] < 255 && !PW.getOwner(world, x, y);
    };
    // A cell that bears weight: anything solid or heaped (a building, rubble, ground), or a propped
    // tunnel (its timbering holds its roof up). Air, gas and water do not.
    // (open sky above the ground is never a tunnel, so its flags are not looked up)
    const bears = (i, x, y) => phase[mat[i] & ID_MASK] >= PW.PHASE.POWDER
      || (y > world.groundTop[x] && open[mat[i] & ID_MASK] && (PW.getFlags(world, x, y) & PW.FLAG.TUNNEL) !== 0);
    // What holds solid ground up: solid ground, a structure, a propped tunnel - never a heap of
    // loose rubble or earth, which slides out from under it.
    const holds = (i, x, y) => phase[mat[i] & ID_MASK] === PW.PHASE.SOLID
      || (y > world.groundTop[x] && open[mat[i] & ID_MASK] && (PW.getFlags(world, x, y) & PW.FLAG.TUNNEL) !== 0);
    // Open sky a face of ground stands free against (a cave's walls and roof are held by the rock
    // round them - see reach - and a tunnel's or a building's by their props).
    const free = (x, y) => {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || y >= world.groundTop[x] || !open[mat[y * W + x] & ID_MASK]) return false;
      const o = PW.getOwner(world, x, y);
      return !(o > 0 && o < 50000);
    };

    // Work out, for every bearing cell in the box, how far it reaches out from where its load goes
    // straight down to the ground: 0 for a cell standing on a column of ground, k for a cell k
    // cells out along an overhang (a cell resting on an overhang reaches as far out as it does).
    // Ground reaching further than its cohesion breaks loose.
    // A look is worked through a few rows a tick, from the bottom of the box up; it returns the
    // number of cells that broke loose once it reaches the top, or -1 while it is still going.
    function look(region) {
      if (!region.scan) {
        const x0 = Math.max(2, region.x0), x1 = Math.min(W - 3, region.x1);
        let top = region.y1;
        for (let x = x0; x <= x1; x += 1) top = Math.min(top, world.groundTop[x]);
        // (from the disturbance up - at the surface, all the way up the face or slope over it;
        // underground, further up round by round while the slide reaches the top of the box - but
        // never above the surface)
        const y0 = Math.max(2, top - 2, region.atSurface ? Math.min(region.y0, region.y1 - MAX_TALL) : region.y0), y1 = Math.min(H - 3, region.y1);
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        region.scan = { x0, x1, y0, y1, bw, bh, top, y: y1, reach: new Uint16Array(bw * bh).fill(FAR), out: [] };
      }
      stats.stage = `scan ${region.scan.bw}x${region.scan.bh}`;
      const { x0, x1, y0, y1, bw, bh, reach, out } = region.scan;
      let budget = CELLS_PER_TICK;
      for (; region.scan.y >= y0 && budget > 0; region.scan.y -= 1, budget -= bw) {
        const y = region.scan.y;
        const row = (y - y0) * bw;
        for (let x = x0; x <= x1; x += 1) {
          const i = y * W + x;
          if (!bears(i, x, y)) continue;
          // (the box's bottom row, its sides where ground carries on beyond them, and anything not
          // ground, stand on their own)
          const edge = (x === x0 && bears(i - 1, x - 1, y)) || (x === x1 && bears(i + 1, x + 1, y));
          if (y === y1 || edge || !breakable(i, x, y)) { reach[row + x - x0] = 0; continue; }
          const below = y + 1 <= y1 ? reach[row + bw + x - x0] : 0;
          if (below !== FAR && holds(i + W, x, y + 1)) reach[row + x - x0] = below;
        }
        // Along the row both ways: a cell held from the side by solid ground reaches one further
        // than its holder.
        for (let pass = 0; pass < 2; pass += 1) {
          const step = pass ? -1 : 1;
          for (let k = 0; k < bw; k += 1) {
            const x = pass ? x1 - k : x0 + k, prev = x - step;
            if (prev < x0 || prev > x1) continue;
            const here = row + x - x0, there = row + prev - x0;
            if (reach[there] === FAR || !holds(y * W + x, x, y) || !holds(y * W + prev, prev, y)) continue;
            if (reach[there] + 1 < reach[here]) reach[here] = reach[there] + 1;
          }
        }
        // What reaches out too far breaks (and holds nothing up any more).
        for (let x = x0; x <= x1; x += 1) {
          const here = row + x - x0, i = y * W + x;
          if (!holds(i, x, y) || !breakable(i, x, y)) continue;
          if (reach[here] > cohesion[mat[i] & ID_MASK]) { out.push(i); reach[here] = FAR; }
        }
      }
      if (region.scan.y >= y0) return -1;
      stats.stage = `faces ${bw}x${bh}`;
      // Faces cut too tall fail (see FACE): a wedge comes away from each, thickest at the top.
      if (region.scan.faceY === undefined) region.scan.faceY = y0;
      if (region.scan.faceY < y1) {
        let budget = CELLS_PER_TICK;
        for (; region.scan.faceY < y1 && budget > 0; region.scan.faceY += 1, budget -= bw) {
          const y = region.scan.faceY;
          for (let x = x0 + 1; x < x1; x += 1) {
            const k = (y - y0) * bw + x - x0, i = y * W + x;
            if (reach[k] === FAR || !holds(i, x, y) || !breakable(i, x, y)) continue;
            const hc = FACE * cohesion[mat[i] & ID_MASK];
            for (const d of [-1, 1]) {
              if (!free(x + d, y)) continue;
              let depth = 0;
              while (depth <= hc + MAX_WEDGE / WEDGE && free(x + d, y + 1 + depth)) depth += 1;
              if (depth <= hc) continue;
              const wedge = Math.min(MAX_WEDGE, 1 + Math.floor((depth - hc) * WEDGE));
              for (let w = 0; w < wedge; w += 1) {
                const wx = x - d * w, kk = k - d * w;
                if (wx <= x0 || wx >= x1) break;
                const j = y * W + wx;
                if (reach[kk] === FAR || !holds(j, wx, y) || !breakable(j, wx, y)) break;
                out.push(j); reach[kk] = FAR;
                region.scan.faces = (region.scan.faces || 0) + 1;
              }
              break;
            }
          }
        }
        if (region.scan.faceY < y1) return -1;
      }
      // Nothing is left hanging cut off: solid ground is followed out from what anchors it (the
      // ground under the box, ground carrying on past its sides, buildings, propped tunnels),
      // through solid ground only; any ground it does not reach - an island left by the slide, a
      // block resting on loose rubble - comes down too.
      stats.stage = `link ${bw}x${bh}`;
      if (!region.scan.linked) {
        const linked = region.scan.linked = new Uint8Array(bw * bh), queue = region.scan.queue = [];
        for (let k = 0; k < bw * bh; k += 1) {
          const x = x0 + (k % bw), y = y0 + ((k / bw) | 0), i = y * W + x;
          if (reach[k] === FAR || !holds(i, x, y)) continue;
          if (y === y1 || x === x0 || x === x1 || !breakable(i, x, y)) { linked[k] = 1; queue.push(k); }
        }
        region.scan.head = 0;
      }
      if (region.scan.head < region.scan.queue.length) {
        const { linked, queue } = region.scan;
        let n = 0;
        while (region.scan.head < queue.length && n < CELLS_PER_TICK) {
          const k = queue[region.scan.head++];
          n += 1;
          const kx = k % bw;
          for (const j of [k - bw, k + bw, kx > 0 ? k - 1 : -1, kx < bw - 1 ? k + 1 : -1]) {
            if (j < 0 || j >= bw * bh || linked[j] || reach[j] === FAR) continue;
            const x = x0 + (j % bw), y = y0 + ((j / bw) | 0);
            if (!holds(y * W + x, x, y)) continue;
            linked[j] = 1; queue.push(j);
          }
        }
        if (region.scan.head < queue.length) return -1;
        for (let k = 0; k < bw * bh; k += 1) {
          if (linked[k] || reach[k] === FAR) continue;
          const x = x0 + (k % bw), y = y0 + ((k / bw) | 0), i = y * W + x;
          if (holds(i, x, y) && breakable(i, x, y)) { out.push(i); reach[k] = FAR; }
        }
        // (from the bottom up, so each comes away from under what rested on it)
        out.sort((a, b) => b - a);
        return -1;
      }
      // (what broke loose comes away a share at a time, from the bottom up)
      stats.stage = `break ${out.length}`;
      if (region.scan.done === undefined) { region.scan.done = 0; stats.looked += bw * bh; }
      const until = Math.min(out.length, region.scan.done + BREAKS_PER_TICK);
      // (still ground that can break: something else - a rising core, a landing piece - may have
      // taken the cell since it was looked at)
      for (; region.scan.done < until; region.scan.done += 1) { const i = out[region.scan.done], x = i % W, y = (i / W) | 0; if (breakable(i, x, y)) breakLoose(x, y, mat[i]); }
      if (region.scan.done < out.length) return -1;
      // (a slide that reached the top of the box goes on above it: the next look reaches higher;
      // one running down the surface that reached a side reaches further out, so it never stops at
      // a straight seam - a cave-in underground stays the chimney it is)
      if (out.some((i) => ((i / W) | 0) < y0 + 6) && y0 > region.scan.top) region.y0 -= GROW;
      const surface = (i) => ((i / W) | 0) < world.groundTop[i % W] + 40;
      if (region.atSurface && out.some((i) => i % W < x0 + 12 && surface(i))) region.x0 = Math.max(2, region.x0 - GROW_SIDE);
      if (region.atSurface && out.some((i) => i % W > x1 - 12 && surface(i))) region.x1 = Math.min(W - 3, region.x1 + GROW_SIDE);
      // A slide shakes the ground around it in its turn: its mass coming down (the rock that rains
      // down adds its own strikes where it lands). Trees and plants on the ground that came away
      // come down with it, and so do boulders and cover that lost their footing.
      stats.stage = `after ${out.length}`;
      if (out.length) {
        // (the last few looks that broke ground, for the tests)
        (stats.recent || (stats.recent = [])).push({ tick, box: [x0, y0, x1, y1], broke: out.length, faces: region.scan.faces || 0 });
        if (stats.recent.length > 30) stats.recent.shift();
        let sx = 0, sy = 0, bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const i of out) {
          const x = i % W, y = (i / W) | 0;
          sx += x; sy += y;
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        }
        shock(sx / out.length, sy / out.length, out.length * SLIDE_SPEED * SLIDE_SPEED / 40);
        const box = { x0: bx0 - 4, y0: by0 - 400, x1: bx1 + 4, y1: by1 + 4 };
        if (PW.flora) PW.flora.afterBlast(world, particles, box);
        if (PW.props) PW.props.afterBlast(world, particles, box);
      }
      region.scan = null;
      return out.length;
    }
    function breakLoose(x, y, m) {
      const id = m & ID_MASK, loose = breaksTo[id] || M.LOOSE_SOIL;
      const paint = PW.getLayer(world, 'paint', x, y);
      let depth = 0;
      while (depth <= RAIN_DEPTH && y + depth + 1 < H - 1 && open[mat[(y + depth + 1) * W + x] & ID_MASK]) depth += 1;
      // (on a free face it topples off outward, and pours down the slope below)
      const side = free(x - 1, y) ? -1 : free(x + 1, y) ? 1 : 0;
      // (over a deep void it falls as a particle, and rolls off what it lands on)
      if ((depth > RAIN_DEPTH || side) && particles && F) {
        PW.set(world, x, y, M.AIR);
        PW.setLayer(world, 'paint', x, y, 0);
        particles.spawn(x + 0.5, y + 0.5, (PW.hash3(x, y, 7) & 63) - 32 + side * (30 + (PW.hash3(x, y, 9) & 31)), side ? -8 : 0, loose, paint || 0, F.LAND, 8);
      } else {
        PW.set(world, x, y, loose | (m & 0xc0));
      }
      stats.broken += 1;
    }

    // Look at the ground in a box, and everything above it up to the surface, a moment from now.
    function disturb(x0, y0, x1, y1) {
      const pad = 24;   // (as far as any ground but bedrock reaches out, and more)
      // (a disturbance at the surface - anywhere along it: at the foot of a cliff too - may set off
      // a slide that runs out along it; one deep underground only a cave-in)
      let low = -Infinity;
      for (let x = Math.max(0, Math.floor(x0) - pad); x <= Math.min(W - 1, Math.ceil(x1) + pad); x += 4) low = Math.max(low, world.groundTop[x]);
      pending.push({ x0: Math.floor(x0) - pad, y0: Math.floor(y0), x1: Math.ceil(x1) + pad, y1: Math.ceil(y1), at: tick + SETTLE, rounds: 0,
        atSurface: y0 < low + 80 });
      stats.regions += 1;
    }
    // Vibration is the shock of things striking each other, as strong as the energy of the strike:
    // a falling piece's or a landing rain of rubble's kinetic energy (weight x speed squared), a
    // blast's (its heat and pressure), a slide's. Its reach grows with the cube root of the energy
    // (a blast of radius r and power p has (r p)^3): a pebble is felt by nothing, a tower coming
    // down shakes the heaps a long way off.
    function shock(x, y, energy) {
      if (!(energy > SHOCK_MIN)) return;
      const size = Math.cbrt(energy);
      shake(x, y, size * 1.65, Math.min(1.6, size / 48));
      stats.shocks = (stats.shocks || 0) + 1;
    }
    // Vibration from a shock at (cx, cy): it dies away over `reach`.
    // Each kind of ground feels it as much as the element table's `shake` says: the surface of
    // steep ground ravels away (bare soil on a steep face, gravel on gentler ones; rock and made
    // ground stand), and loose heaps within reach - sand, ash, rubble, spoil - settle and slump.
    function shake(cx, cy, reach, power = 1) {
      const x0 = Math.max(2, Math.floor(cx - reach)), x1 = Math.min(W - 3, Math.ceil(cx + reach));
      for (let x = x0; x <= x1; x += 1) {
        const g = world.groundTop[x], d = Math.hypot(x - cx, g - cy) / reach;
        if (d >= 1) continue;
        const felt = (1 - d) * Math.min(1.5, power);
        // (loose heaps at the surface here are set moving)
        if (PW.mat.shake[mat[g * W + x] & ID_MASK] > 0.2 && PW.wakeCell) PW.wakeCell(world, x, g);
        const slope = Math.abs(world.groundTop[x + 2] - world.groundTop[x - 2]) / 4;
        const depth = Math.round(felt * 7 * Math.min(1.6, slope));
        for (let y = g; y < g + depth; y += 1) {
          const i = y * W + x, m = mat[i], id = m & ID_MASK, s = PW.mat.shake[id];
          if (!s || !breakable(i, x, y)) continue;
          // (the looser the ground, the gentler the slope it ravels on)
          if (slope < 0.85 - Math.min(0.6, s * 3)) continue;
          if ((PW.hash3(x, y, 0x5ac) & 255) / 255 > Math.min(0.95, felt * s * 25)) continue;
          PW.set(world, x, y, (breaksTo[id] || M.LOOSE_SOIL) | (m & 0xc0));
          stats.loosened += 1;
        }
      }
    }
    function step() {
      tick += 1;
      // The strikes of flying debris, gathered tile by tile, each felt as one shock.
      if (tick % SHOCK_EVERY === 0 && particles && particles.drainImpacts) particles.drainImpacts(shock);
      // (one disturbance looked at at a time, a few rows a tick)
      const k = pending.findIndex((r) => r.at <= tick);
      if (k < 0) return;
      const region = pending[k];
      const started = performance.now();
      const broke = look(region);
      stats.ms = performance.now() - started;
      if (stats.ms > (stats.maxMs || 0)) { stats.maxMs = stats.ms; stats.maxStage = stats.stage; }
      if (broke < 0) return;
      region.rounds += 1;
      region.quiet = broke ? 0 : (region.quiet || 0) + 1;
      if (region.quiet < QUIET && region.rounds < ROUNDS) region.at = tick + AGAIN;
      else pending.splice(k, 1);
    }
    return { step, disturb, shock, stats, busy: () => pending.length > 0 };
  }

  PW.createStability = createStability;
})();
