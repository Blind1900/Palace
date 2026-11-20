'use strict';
// Structural integrity of buildings after damage. A building's frame is its structure cells AND its
// back walls (in this side view the back walls stand for the facade and party walls that carry the
// floors: the end walls are mostly door and window). When a building is hit it is analysed (within a
// time budget, once per few ticks while it keeps being damaged):
//   - every part no longer joined to the ground (or to a neighbour it leans on) falls as a rigid
//     piece - straight down, grinding through whatever is left of the building under it - and small
//     bits crumble;
//   - each row above the floor compares the load it carries per supporting column with what it
//     carried as built (so every style is equally sturdy): a row that has lost too much of its
//     support gives way, and so does one whose load now overhangs its remaining supports;
//   - water standing or running against it pushes on it as a whole: a storey whose frame cannot
//     take the push of all the water against the building above its floor shears through (swept);
//   - everything above the failing row becomes ONE rigid piece that hinges down towards the side
//     that failed (crushing the stump as it goes) or, when it lost its supports evenly, drops into
//     its own footprint floor by floor - or, swept, is shoved off the way the water pushes; a
//     jagged band crumbles at the break;
//   - fittings (lamps, signs, railings) left hanging without what held them come down.
// A building that has lost three quarters of its frame is ruined.
(function () {
  const PW = window.PW;
  const { M, ID_MASK, CHUNK_SHIFT, CHUNK_MASK } = PW;
  const { phase, structural, breaksTo, hardness } = PW.mat;
  const groundMat = PW.mat.ground;

  const FAIL_RATIO = 1.8;     // a row gives way when each support carries 1.8 times its built load
  const TOPPLE_MARGIN = 3;    // cells the centre of the load may overhang its supports
  const MIN_LOAD = 80;        // rows carrying less than this are not checked (roof ornaments...)
  const CRUMBLE_ONLY = 40;    // parts smaller than this crumble instead of falling whole
  const SPAN = 60;            // cells (about 4 m) a floor spans unsupported before it sags in
  const REPEAT = 15;          // ticks between analyses of a building still being damaged
  const SOLID = 1, BACK = 2, FIT = 4, FRAME = SOLID | BACK;
  // A construction site (see analyse) is judged only once it has lost more than GROW_LOSS cells
  // of its frame from the most it had (light blows do not break into it: only something heavy
  // takes it away); its works hold its loose parts up while it was worked within SITE_IDLE ticks;
  // it is a building like any other again once SITE_DONE of it stands and the work has stopped.
  const GROW_LOSS = 60, SITE_IDLE = 1800, SITE_DONE = 0.9;
  // Water against a building pushes on it with its pressure: in a row of its outer face, as a head
  // of water, the depth of the water standing outside it there (and, running at it, its speed's
  // v^2 / 2g more), less the water against its other face. The push on all of it above a row is
  // what the row's frame must take, sideways (it is a storey's shear): each frame cell across it
  // takes SHEAR x its stuff's hardness (a back wall stands for brick facades and party walls - in
  // this side view about a twentieth of the building's depth of brick, which shears at about
  // 0.3 MPa: some 22 cells of water head a cell). So a tower 13 m long gives way under a flood
  // some 6 m deep against one side, a cottage under 2-3 m, a concrete bunker hardly at all; and
  // what gives way is shoved off the way the water pushes, as fast as the push over what it
  // holds, over its weight, gives it while the water falls on it.
  const SHEAR = 55;             // head (cells) a frame cell across a storey takes, per unit of hardness
  const BACK_HARD = 0.4;        // a back wall's hardness (brick)
  const SURGE_HEAD = 13;        // cells: water running at it at a surge's speed (60 cells/s: see pw-sim)
  const WATER_HEAD_MAX = 400;
  const FACE_REACH = 40;        // cells out from its face the water's depth is looked for (past its eaves, a canopy)
  const WET_FOR = 300;          // ticks after water last pressed on a building that it is looked for
  const WATER_QUICK = 48, WATER_REPEAT = 6;   // ticks, from when water first comes against it, it is looked at this often
  const FRAME_WEIGHT = 0.35;    // a frame cell weighs about a third of a cell of water (for the same depth)
  const SWEEP_TIME = 0.5;       // s: about how long the push lasts on what gives way
  const SWEEP_MAX = 120;        // cells/s

  function createStructure(world, fragments) {
    const { mat, width: W, height: H } = world;
    const due = new Map();
    const stats = { analysed: 0, collapses: 0, detached: 0, crumbled: 0, orphans: 0, ms: 0, maxMs: 0, last: null };
    let tick = 0;
    const isStructure = (id) => phase[id] === PW.PHASE.SOLID && (structural[id] || groundMat[id]);
    // The water's push on a row of a building (rightward, as a head of water x cells). A building is
    // a box: its walls, doors and windows keep the water out - or, broken in, the water running
    // through its rooms spends its head on all that is in them, its partitions, stairs and far wall
    // - so the push on it is the water against its outer face upstream less that against its face
    // downstream: the head of water standing there (as deep as it stands out from the face - under
    // its eaves or a canopy only to their underside - or followed up under them to where it stands
    // open: see pw-sim's waterHead), and, running at it, its surge. Water as deep on both sides of
    // it pushes it no way at all. An open frame - a hall on pillars, a gate - the water runs
    // through, pushing only on the share of the row its frame fills; and water poured in at an open
    // ground floor runs on into it, so a short-lived flood pushes such a building less. A row
    // pushed against the ground - a vault in its pit, a wall dug into a slope - the ground holds.
    function waterOn(S, state, y, xl, xr, frame) {
      const push = headOf(xl - 1, y, 1) - headOf(xr + 1, y, -1);
      if (!push || groundAt(push > 0 ? xr + 1 : xl - 1, y)) return 0;
      return push * frame / (xr - xl + 1);
    }
    const groundAt = (x, y) => x < 1 || x >= W - 1 || (PW.mat.terrain[mat[y * W + x] & ID_MASK] === 1 && phase[mat[y * W + x] & ID_MASK] === PW.PHASE.SOLID);
    // (the head of water at (x, y) pushing the way `dir`, 0 out of the water: the deepest it stands
    // in that row out from there, as far as FACE_REACH)
    // (the rows are looked at going down: how high each column's water reaches, kept from the row
    // above, so a column is climbed once an analysis)
    const colRow = new Map(), colTop = new Map();
    function headOf(x, y, dir) {
      if (x < 1 || x >= W - 1) return 0;
      const m = mat[y * W + x];
      if ((m & ID_MASK) !== M.WATER) return 0;
      let h = world.waterHead ? world.waterHead(x, y) : 1;
      for (let s = 0, cx = x; s < FACE_REACH && cx >= 1 && cx < W - 1 && (mat[y * W + cx] & ID_MASK) === M.WATER; s += 1, cx -= dir) {
        let top;
        if (colRow.get(cx) === y - 1) top = colTop.get(cx);
        else { top = y; for (let j = (y - 1) * W + cx; y - top < WATER_HEAD_MAX && top > 1 && (mat[j] & ID_MASK) === M.WATER; j -= W) top -= 1; }
        colRow.set(cx, y); colTop.set(cx, top);
        if (y - top + 1 > h) h = y - top + 1;
      }
      return (m & 0x80) && ((m & 0x40) ? 1 : -1) === dir ? h + SURGE_HEAD : h;
    }
    // (by material: frame, and what holds frame up - ground, or structure it does not own)
    const frameOf = new Uint8Array(ID_MASK + 1), holds = new Uint8Array(ID_MASK + 1);
    for (let id = 0; id <= ID_MASK; id += 1) {
      frameOf[id] = isStructure(id) ? 1 : 0;
      holds[id] = phase[id] === PW.PHASE.SOLID && (groundMat[id] === 1 || structural[id] === 1) ? 1 : 0;
    }
    const building = (id) => (world.buildings || [])[id - 1] || null;
    const size = 1 << CHUNK_SHIFT;

    // ---- What a building is made of, now -----------------------------------------------------------
    // The area it can occupy (its canvas, its works and the ground under it).
    function areaOf(b) {
      if (b.area) return b.area;
      // (below its floor: its cores, and the stage, piers and walls of a base on a slope)
      const works = b.works || [b.body.left, b.body.right];
      b.area = { x0: Math.max(0, Math.min(b.ox, works[0]) - 4), x1: Math.min(W - 1, Math.max(b.ox + b.canvas.width, works[1]) + 4),
        y0: Math.max(0, b.oy - 4), y1: Math.min(H - 1, b.ground + (b.base ? 190 : 40)) };
      return b.area;
    }
    // (the grids an analysis works on, building-sized, kept and cleared for the next one: one
    // analysis after another round a falling building, they were megabytes a second to the garbage
    // collector. An analysis is never inside another)
    const GRIDS = new Map();
    function grid(key, Type, n, clear = true) {
      let a = GRIDS.get(key);
      if (!a || a.length < n) { a = new Type(Math.max(n, a ? a.length * 2 : 0)); GRIDS.set(key, a); }
      else if (clear) a.fill(0, 0, n);
      return a;
    }
    // Classify every cell the building owns: frame (structure, back wall) and fittings in front.
    // Reads the sparse layers chunk by chunk (no per-cell lookups).
    function scan(b) {
      const { x0, x1, y0, y1 } = areaOf(b);
      const gw = x1 - x0 + 3, gh = y1 - y0 + 3;
      const cls = grid('cls', Uint8Array, gw * gh);
      const at = (x, y) => (y - y0 + 1) * gw + (x - x0 + 1);
      let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity, count = 0;
      const fits = [];
      for (let cy = y0 >> CHUNK_SHIFT; cy <= y1 >> CHUNK_SHIFT; cy += 1) {
        for (let cx = x0 >> CHUNK_SHIFT; cx <= x1 >> CHUNK_SHIFT; cx += 1) {
          const c = cy * world.chunksX + cx;
          const own = world.owner[c];
          if (!own) continue;
          const back = world.back[c], deco = world.deco[c];
          const bx = cx << CHUNK_SHIFT, by = cy << CHUNK_SHIFT;
          const ly0 = Math.max(0, y0 - by), ly1 = Math.min(size - 1, y1 - by), lx0 = Math.max(0, x0 - bx), lx1 = Math.min(size - 1, x1 - bx);
          for (let ly = ly0; ly <= ly1; ly += 1) {
            const y = by + ly;
            for (let lx = lx0; lx <= lx1; lx += 1) {
              const l = ly << CHUNK_SHIFT | lx;
              if (own[l] !== b.id) continue;
              const x = bx + lx;
              let k = 0;
              if (frameOf[mat[y * W + x] & ID_MASK]) k = SOLID;
              else if (back && back[l]) k = BACK;
              if (deco && deco[l]) k |= FIT;
              if (!k) continue;
              cls[at(x, y)] = k;
              count += 1;
              if (k & FRAME) { if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y; }
              else fits.push(at(x, y));
            }
          }
        }
      }
      // (fits: the fittings standing free of the frame, by cls index)
      fits.sort((a, b) => a - b);
      return { x0, y0, x1, y1, gw, gh, cls, at, count, fx0, fx1, fy0, fy1, fits };
    }
    // As built, from its canvas: per row above the floor, the load (frame above the row), the
    // supporting columns (frame with frame on top), their span and centre, the widest gap between
    // them, and whether the load sat over them.
    function blueprintOf(b) {
      if (b.blueprint) return b.blueprint;
      const c = b.canvas, rows = c.ground;
      const isFrame = new Uint8Array(rows * c.width);
      for (let i = 0; i < isFrame.length; i += 1) isFrame[i] = frameOf[c.mat[i] & ID_MASK] || c.back[i] !== 0 ? 1 : 0;
      const frame = (x, y) => isFrame[y * c.width + x] === 1;
      const load = new Float32Array(rows), support = new Int32Array(rows), left = new Int32Array(rows).fill(1e9), right = new Int32Array(rows).fill(-1e9);
      const supportX = new Float64Array(rows), maxGap = new Int32Array(rows), balanced = new Uint8Array(rows);
      let total = 0, above = 0, aboveX = 0;
      for (let y = 0; y < rows; y += 1) {
        load[y] = above;
        let rowX = 0, rowN = 0, last = -1;
        for (let x = 0; x < c.width; x += 1) {
          if (!frame(x, y)) continue;
          rowN += 1; rowX += x + b.ox + 0.5; total += 1;
          if (y > 0 && frame(x, y - 1)) {
            support[y] += 1; supportX[y] += x + b.ox + 0.5; left[y] = Math.min(left[y], x + b.ox); right[y] = Math.max(right[y], x + b.ox);
            if (last >= 0) maxGap[y] = Math.max(maxGap[y], x - last - 1);
            last = x;
          }
        }
        if (above) { const centre = aboveX / above; balanced[y] = centre >= left[y] - TOPPLE_MARGIN && centre <= right[y] + 1 + TOPPLE_MARGIN ? 1 : 0; }
        above += rowN; aboveX += rowX;
      }
      b.blueprint = { load, support, supportX, maxGap, left, right, balanced, total };
      return b.blueprint;
    }

    // ---- Analysis ---------------------------------------------------------------------------------
    // (a building is analysed at most once every REPEAT ticks however often it is hit - but when
    // water first comes against it, `soon`, at once and every WATER_REPEAT ticks for a while: a
    // flood's push is greatest as it strikes, and falls off as the water spreads)
    const last = new Map();
    function notify(id, soon = false) {
      const b = building(id);
      if (!b || (due.has(id) && !soon)) return;
      if (soon) b.floodAt = tick;
      due.set(id, soon ? Math.min(due.get(id) ?? Infinity, tick + 2) : Math.max(tick + 2, (last.get(id) ?? -1e9) + REPEAT));
    }
    // (what is found to come away is lifted out of the world as a falling piece on the tick after:
    // for a tower the search and the lifting are each tens of thousands of cells, and are not done
    // in the one tick - nor is anything else looked at in the tick it is lifted)
    const spawnQueue = [];
    const spawnLater = (spec) => { spawnQueue.push(spec); };
    let sweepAt = 0, blueprintAt = 0;
    function step(budgetMs = 1.5) {
      tick += 1;
      const t0 = performance.now();
      while (spawnQueue.length) fragments.spawn(spawnQueue.shift());
      // (when each building was last being built - see PW.isGrowing - and so a site: see analyse)
      // (it becomes one once it has been judged as it stands, and stands: what damage started the
      // work is judged first)
      for (const b of world.buildings || []) if (b.growing) { b.grewAt = world.tick || 0; if (!b.site) b.siteWanted = true; }
      // (now and then a damaged building is looked at again: what held a bit of it up can go
      // without its knowing - rubble sliding off, a ruin that propped it crumbling, a risen core
      // clearing the heap)
      const all = world.buildings || [];
      if (tick % 15 === 0 && all.length) {
        for (let k = 0; k < all.length; k += 1) {
          const b = all[(sweepAt + k) % all.length];
          if (b.health === undefined || b.health >= 1 || due.has(b.id) || tick - (last.get(b.id) ?? -1e9) < 60) continue;
          notify(b.id);
          sweepAt = (sweepAt + k + 1) % all.length;
          break;
        }
      }
      for (const [id, at] of due) {
        if (at > tick) continue;
        // (the time has gone - on pieces lifted out, or the last building looked at)
        if (!PW.DETERMINISTIC && performance.now() - t0 > budgetMs) break;
        due.delete(id);
        last.set(id, tick);
        analyse(building(id));
      }
      // (with time to spare, one building a tick has its blueprint worked out ahead of the first
      // blow to it, so the analysis right after a blast does not pay for that too - it is the same
      // whenever it is worked out)
      if (all.length && performance.now() - t0 < budgetMs * 0.5) {
        for (let k = 0; k < all.length; k += 1) {
          const b = all[(blueprintAt + k) % all.length];
          if (b.blueprint || !b.canvas) continue;
          blueprintOf(b);
          blueprintAt = (blueprintAt + k + 1) % all.length;
          break;
        }
      }
      stats.ms = performance.now() - t0;
      stats.maxMs = Math.max(stats.maxMs, stats.ms);
    }
    // Mark the building's frame that is anchored - joined, 8-connected, to ground or to structure
    // it does not own - in `state`; [frame cells, anchored cells]. (A tower is a hundred thousand
    // cells, its rooms walled behind: its frame is searched in runs - unbroken stretches of a row -
    // each joined to the runs it touches, corners too, in the rows above and below.)
    function anchor(b, S, state) {
      const { cls, at, gw } = S;
      const fy0 = S.fy0, fx0 = S.fx0, fx1 = S.fx1, runRows = S.fy1 - S.fy0 + 1;
      const rowAt = new Int32Array(runRows + 1), runX0 = [], runX1 = [], held = [];
      let frame = 0, anchored = 0;
      // (ground, or structure the building does not own, next to frame at cls index j, world i)
      const support = (j, i) => !(cls[j] & FRAME) && holds[mat[i] & ID_MASK] === 1;
      // The main base's armoured block floats over its pit, held up by its core's field for as
      // long as the core lives.
      const f = b.floating;
      const floats = !!f && (b.cores || []).some((core) => (mat[core.y * W + core.x] & ID_MASK) === M.CORE);
      for (let y = fy0; y <= S.fy1; y += 1) {
        rowAt[y - fy0] = runX0.length;
        const floatRow = floats && y >= f.top && y <= f.bottom;
        for (let x = fx0, k = at(x, y), i = y * W + x; x <= fx1; x += 1, k += 1, i += 1) {
          if (!(cls[k] & FRAME)) continue;
          const start = x;
          let seed = 0;
          for (; x <= fx1 && (cls[k] & FRAME); x += 1, k += 1, i += 1) {
            // (a core holds itself up by its field - risen out of the ruins too, hanging over the
            // wreck - and whatever is built onto it)
            if (!seed && ((mat[i] & ID_MASK) === M.CORE || (y + 1 < H && support(k + gw, i + W)) || (x + 1 < W && support(k + 1, i + 1)) || (x > 0 && support(k - 1, i - 1)) || (y > 0 && support(k - gw, i - W))
              || (floatRow && x >= f.left && x <= f.right))) seed = 1;
          }
          frame += x - start;
          runX0.push(start); runX1.push(x - 1); held.push(seed);
        }
      }
      rowAt[runRows] = runX0.length;
      const runs = runX0.length, runRow = new Int32Array(runs), stack = [];
      for (let r = 0; r < runRows; r += 1) for (let q = rowAt[r]; q < rowAt[r + 1]; q += 1) runRow[q] = r;
      for (let q = 0; q < runs; q += 1) if (held[q]) stack.push(q);
      while (stack.length) {
        const q = stack.pop(), a = runX0[q] - 1, z = runX1[q] + 1;
        for (let r = runRow[q] - 1; r <= runRow[q] + 1; r += 2) {
          if (r < 0 || r >= runRows) continue;
          // (the first run in that row reaching a, then each on that starts by z)
          let lo = rowAt[r], hi = rowAt[r + 1];
          while (lo < hi) { const mid = (lo + hi) >> 1; if (runX1[mid] < a) lo = mid + 1; else hi = mid; }
          for (let s = lo; s < rowAt[r + 1] && runX0[s] <= z; s += 1) if (!held[s]) { held[s] = 1; stack.push(s); }
        }
      }
      for (let q = 0; q < runs; q += 1) {
        if (!held[q]) continue;
        const k = at(runX0[q], fy0 + runRow[q]), n = runX1[q] - runX0[q] + 1;
        state.fill(1, k, k + n);
        anchored += n;
      }
      return [frame, anchored];
    }
    function analyse(b) {
      if (!b) return null;
      stats.analysed += 1;
      const S = scan(b);
      const { cls, at, gw, gh } = S;
      const report = { id: b.id, frame: 0, anchored: 0, detached: 0, failed: null, orphans: 0 };
      if (S.fx1 < S.fx0) { b.health = 0; b.ruined = true; loosePanels(b); return report; }
      // Anchored frame: joined to ground or to structure the building does not own (8-connected).
      const state = grid('state', Uint8Array, gw * gh);   // 1 anchored frame
      [report.frame, report.anchored] = anchor(b, S, state);
      // (the parts not anchored are searched cell by cell, on cls indices: frame lies inside the
      // scan's padded box, so a cell's 8 neighbours are k + NEAR)
      const queue = grid('queue', Int32Array, S.count + 1, false), NEAR = [-gw - 1, -gw, -gw + 1, -1, 1, gw - 1, gw, gw + 1];
      // A building going up - built or repaired cell by cell (b.growing) - is a construction site
      // (b.site) from the first time it is worked until it is all but whole (SITE_DONE), even
      // while the work pauses or stalls. What is being put up is not yet joined to what holds it -
      // a lintel over a doorway before its jambs, a floor put up before the pillars under it, the
      // heap or the risen core it was built against cleared away - so while the work goes on
      // (within SITE_IDLE of it), a site's loose parts are held up by the works (scaffolded);
      // abandoned, they come down as rubble where they are. Only once a site has lost much of
      // its frame (`lost`: a blast, a heavy piece through it - frame destroyed, not just cut off)
      // do its loose parts fall as any building's do. And a site is never judged against its
      // blueprint (half built, every storey of it falls short of it), only by what stood (below).
      const site = !!b.site, working = site && (world.tick || 0) - (b.grewAt ?? -1e9) <= SITE_IDLE;
      const bp = blueprintOf(b);
      const lost = site && !!b.asBuilt && report.frame < (b.grownFrame ?? 0) - GROW_LOSS;
      // Parts no longer joined to anything fall; small bits crumble.
      if (report.anchored < report.frame) {
        const seen = grid('seen', Uint8Array, gw * gh);
        // (world index of the cell at cls index k)
        const toCell = (k) => ((k / gw | 0) - 1 + S.y0) * W + (k % gw) - 1 + S.x0;
        for (let y = S.fy0; y <= S.fy1; y += 1) for (let x = S.fx0, k0 = at(S.fx0, y); x <= S.fx1; x += 1, k0 += 1) {
          if (!(cls[k0] & FRAME) || state[k0] || seen[k0]) continue;
          const part = [];
          let top = 0;
          queue[top++] = k0;
          seen[k0] = 1;
          while (top) {
            const kp = queue[--top];
            part.push(toCell(kp));
            for (let d = 0; d < 8; d += 1) {
              const k = kp + NEAR[d];
              if ((cls[k] & FRAME) && !state[k] && !seen[k]) { seen[k] = 1; queue[top++] = k; }
            }
          }
          if (site && !lost) {
            if (working) { stats.scaffolded = (stats.scaffolded || 0) + part.length; continue; }
            crumble(part); stats.crumbled += part.length; report.detached += part.length; continue;
          }
          report.detached += part.length;
          if (part.length < CRUMBLE_ONLY) { crumble(part); stats.crumbled += part.length; continue; }
          // A big part drops into the footprint under it, grinding down; a small one tumbles.
          const big = part.length >= 300;
          spawnLater({ cells: part.concat(fittingsOn(S, part)), owner: b.id, drop: big, floor: b.ground, base: b.ground,
            omega: big ? 0 : ((PW.hash2(x, y) % 7) - 3) * 0.05 });
          if (big) (b.failures || (b.failures = [])).push('drop');
          stats.detached += 1;
          // (the last part that came away, for the tests: where, how big, how much of it wall)
          let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity, walls = 0;
          for (const i of part) { const ix = i % W, iy = (i / W) | 0; if (ix < px0) px0 = ix; if (ix > px1) px1 = ix; if (iy < py0) py0 = iy; if (iy > py1) py1 = iy; if (cls[at(ix, iy)] === BACK) walls += 1; }
          stats.lastDetached = { id: b.id, cells: part.length, walls, box: [px0, py0, px1, py1] };
        }
      }
      // Each row above the floor: load per support against the blueprint, and overhang (the
      // building's own columns only: a skybridge it owns rests on its neighbour, not on it).
      // A site is judged so only once it has lost much of what stood - and then against what
      // each row carried at its most (b.asBuilt), not against its blueprint; and no gap is too
      // wide on a site (its floors go up ahead of their pillars).
      const judge = !site || lost;
      const ref = site ? b.asBuilt : bp;
      const rows = bp.load.length, rowLoad = new Float32Array(rows), rowSup = new Int32Array(rows);
      const cx0 = Math.max(S.fx0, b.body.left - 2), cx1 = Math.min(S.fx1, b.body.right + 2);
      let load = 0, loadX = 0, fail = null, pushed = 0;
      // (only a building water has pressed on lately - see pw-sim's pushOn)
      const wet = (world.tick || 0) - (b.waterAt ?? -1e9) < WET_FOR;
      colRow.clear(); colTop.clear();
      for (let y = S.fy0; y <= Math.min(S.fy1, b.ground - 1); y += 1) {
        const r = y - b.oy;
        let rowN = 0, rowX = 0, carried = 0, carriedX = 0, left = Infinity, right = -Infinity, last = -1, gap = 0, gapAt = 0, xl = -1, xr = -1;
        for (let x = cx0, k = at(cx0, y); x <= cx1; x += 1, k += 1) {
          if (!state[k]) continue;
          if (xl < 0) xl = x;
          xr = x;
          rowN += 1; rowX += x + 0.5;
          if (state[k - gw]) {
            carried += 1; carriedX += x + 0.5; if (x < left) left = x; if (x > right) right = x;
            if (last >= 0 && x - last - 1 > gap) { gap = x - last - 1; gapAt = (x + last) >> 1; }
            last = x;
          }
        }
        const support = carried;
        if (r >= 0 && r < rows) { rowLoad[r] = load; rowSup[r] = support; }
        if (judge && r >= 0 && r < rows && load >= MIN_LOAD && ref.support[r] > 0 && bp.support[r] > 0) {
          const built = ref.load[r] / ref.support[r];
          const centreX = loadX / load;
          if (!support || load / support > FAIL_RATIO * Math.max(1, built)) {
            // Crushed: the side that lost more of its support drops, pivoting about the far edge;
            // when it lost them evenly it comes straight down into its footprint. (Which side lost
            // more: how far what still carries it has moved from where its supports stood as
            // built - a sliver of wall left at a corner does not count as the side standing.)
            const span = bp.right[r] - bp.left[r] + 1;
            const shift = support ? (carriedX / support - bp.supportX[r] / bp.support[r]) / span : 0;
            const dir = shift > 0 ? -1 : 1;
            const even = support < ref.support[r] * 0.08 || Math.abs(shift) < 0.1;
            fail = { y, dir, pivotX: dir < 0 ? (support ? right + 1 : bp.right[r] + 1) : (support ? left : bp.left[r]),
              reason: even ? 'pancake' : 'crushed', load, support, built, shift, row: r, builtSupport: ref.support[r] };
          } else if (!site && gap > Math.max(SPAN, bp.maxGap[r] * 1.5 + 12) && state[at(gapAt, y - 1)]) {
            // Its walls blown out from under it: what is left of the row above spans a gap far
            // wider than anything it spanned as built, and comes down into it.
            fail = { y, dir: 1, pivotX: gapAt, reason: 'pancake', load, support, built, gap };
          } else if (bp.balanced[r] && (centreX < left - TOPPLE_MARGIN || centreX > right + 1 + TOPPLE_MARGIN)) {
            const dir = centreX < left ? -1 : 1;
            fail = { y, dir, pivotX: dir < 0 ? left : right + 1, reason: 'overhang', load, support, built };
          }
          // (keep going down: the lowest failing row brings the most down)
        }
        // Swept: the water against it above here pushes more than this row of its frame takes.
        if (wet && xl >= 0) {
          pushed += waterOn(S, state, y, xl, xr, rowN);
          if (pushed) {
            let holds = 0;
            for (let x = xl, k = at(xl, y), i = y * W + xl; x <= xr; x += 1, k += 1, i += 1) {
              if (state[k]) holds += SHEAR * (cls[k] & SOLID ? hardness[mat[i] & ID_MASK] : BACK_HARD);
            }
            if (Math.abs(pushed) > holds) fail = { y, dir: Math.sign(pushed), reason: 'swept', load, support: carried, push: Math.abs(pushed), holds };
            // (the row nearest giving way, for the tests)
            if (!report.water || Math.abs(pushed) / holds > report.water.share) report.water = { y, push: Math.round(pushed), holds: Math.round(holds), share: Math.abs(pushed) / holds };
          }
        }
        load += rowN; loadX += rowX;
      }
      if (fail) {
        report.failed = fail;
        (b.failed || (b.failed = [])).push({ reason: fail.reason, y: fail.y, support: fail.support, built: fail.builtSupport, shift: fail.shift && +fail.shift.toFixed(3), row: fail.row,
          push: fail.push && Math.round(fail.push), holds: fail.holds && Math.round(fail.holds) });
        collapse(b, fail, S, state);
      }
      report.orphans = clearFittings(b, S, state);
      const standing = report.anchored - (fail ? fail.cells || 0 : 0);
      // (a site: the most frame it had, the most that stood and what each row carried then;
      // judged, what it has and what stands now - it is judged against that from here on)
      if (site) {
        b.grownFrame = lost ? report.frame - (fail ? fail.cells || 0 : 0) : Math.max(b.grownFrame ?? 0, report.frame);
        if (!fail && (judge || standing >= (b.grownAnchored ?? 0))) { b.grownAnchored = standing; b.asBuilt = { load: rowLoad, support: rowSup }; }
        else if (fail) b.grownAnchored = standing;
      } else if (b.siteWanted && !fail) {
        // (judged as it stands, and standing: a site from now on, as it is now)
        b.site = true; b.siteWanted = false;
        b.grownFrame = report.frame; b.grownAnchored = standing; b.asBuilt = { load: rowLoad, support: rowSup };
      }
      report.site = site;
      b.health = Math.max(0, Math.min(1, standing / Math.max(1, bp.total)));
      b.ruined = b.health < 0.25;
      // (all but whole, and no longer being worked: a building like any other again)
      if ((site || b.siteWanted) && b.health >= SITE_DONE && !PW.isGrowing(world, b)) { b.site = false; b.siteWanted = false; b.asBuilt = null; b.grownAnchored = undefined; b.grownFrame = undefined; }
      if (b.health < 1) loosePanels(b);
      // (the water has just come against it: looked at again soon - see notify)
      if (!fail && tick - (b.floodAt ?? -1e9) < WATER_QUICK) due.set(b.id, tick + WATER_REPEAT);
      stats.last = report;
      return report;
    }
    // (round a damaged building, the bits of its ruins and their panels stand only while something
    // holds them: see pw-stability's loose)
    function loosePanels(b) {
      if (!world.stability || !world.stability.looseLater) return;
      const A = areaOf(b);
      world.stability.looseLater(A.x0 - 48, A.y0 - 120, A.x1 + 48, A.y1);
    }
    // Fittings in front that hang on a falling part (a sign on its wall, a lamp on its corner) go
    // with it: those joined to it through other fittings.
    // (on cls indices - a part is tens of thousands of cells: the same search, in the same order)
    const AROUND = (gw) => [-gw - 1, -gw, -gw + 1, -1, 0, 1, gw - 1, gw, gw + 1];
    function fittingsOn(S, part) {
      const { cls, at, gw, x0, y0 } = S, around = AROUND(gw);
      const out = [], seen = grid('fitSeen', Uint8Array, S.gw * S.gh);
      const queue = [];
      for (const i of part) queue.push(at(i % W, (i / W) | 0));
      for (let q = 0; q < queue.length; q += 1) {
        const k0 = queue[q];
        for (let d = 0; d < 9; d += 1) {
          const k = k0 + around[d];
          if (cls[k] !== FIT || seen[k]) continue;
          seen[k] = 1; out.push((((k / gw) | 0) - 1 + y0) * W + (k % gw) - 1 + x0); queue.push(k);
        }
      }
      return out;
    }
    // Fittings (front deco the building owns) left with nothing holding them come down: one stays
    // while it is joined to standing frame or stands on something solid.
    function clearFittings(b, S, state) {
      const { cls, gw, gh, x0, y0 } = S;
      const held = grid('held', Uint8Array, gw * gh);
      const queue = [];
      // (fittings over the frame travel with it; these are the free-standing ones)
      for (const k of S.fits) {
        const x = (k % gw) - 1 + x0, y = ((k / gw) | 0) - 1 + y0;
        // (standing on firm ground or structure: loose debris under it can slide away)
        if (phase[mat[Math.min(H - 1, y + 1) * W + x] & ID_MASK] === PW.PHASE.SOLID || state[k + 1] || state[k - 1] || state[k + gw] || state[k - gw]) { held[k] = 1; queue.push(k); }
      }
      for (let q = 0; q < queue.length; q += 1) {
        const kq = queue[q];
        for (let dy = -gw; dy <= gw; dy += gw) for (let dx = -1; dx <= 1; dx += 1) {
          const k = kq + dy + dx;
          if (cls[k] === FIT && !held[k]) { held[k] = 1; queue.push(k); }
        }
      }
      let removed = 0;
      for (const k of S.fits) {
        if (held[k]) continue;
        const x = (k % gw) - 1 + x0, y = ((k / gw) | 0) - 1 + y0;
        if (PW.getOwner(world, x, y) !== b.id || !PW.getLayer(world, 'deco', x, y)) continue;
        const color = PW.getLayer(world, 'deco', x, y);
        PW.setLayer(world, 'deco', x, y, 0);
        if (!isStructure(mat[y * W + x] & ID_MASK) && !PW.getLayer(world, 'back', x, y)) PW.setOwner(world, x, y, 0);
        removed += 1;
        if (world.particles && (PW.hash2(x, y) & 7) === 0) world.particles.spawn(x + 0.5, y + 0.5, ((PW.hash3(x, y, 5) & 255) / 255 - 0.5) * 60, -10, M.DEBRIS, color, PW.PARTICLE.LAND, 6, 0);
      }
      stats.orphans += removed;
      return removed;
    }
    // Small bits of frame break up where they are: structure turns to debris that falls, back wall
    // is thrown off as debris.
    function crumble(cells) {
      for (const i of cells) {
        const x = i % W, y = (i / W) | 0;
        const id = mat[i] & ID_MASK;
        if (isStructure(id)) PW.set(world, x, y, breaksTo[id] || M.DEBRIS);
        else {
          const back = PW.getLayer(world, 'back', x, y);
          PW.setLayer(world, 'back', x, y, 0);
          // (in panels: whole patches of it come away as chunks, the rest to dust)
          if (world.particles && (PW.hash2(Math.floor((x + (PW.hash2(y >> 1, 3) & 3)) / 5), Math.floor(y / 5)) % 3) === 0) world.particles.spawn(x + 0.5, y + 0.5, 0, 0, M.DEBRIS, back, PW.PARTICLE.LAND, 6, 0);
        }
        PW.setOwner(world, x, y, 0);
      }
    }
    // The building gives way at row fail.y: a jagged band crumbles and everything above it falls as
    // one piece, free - nothing swings it about a hinge. Coming straight down into its footprint
    // it sinks into it storey by storey; come down on the stump of one side only (the side that
    // lost its supports gone from under it), that is where it strikes, and the blow turns it over
    // that way; and wherever it strikes it folds up and breaks apart as its frame lets it (see
    // pw-fragments' strike, crumple and breaks).
    function collapse(b, fail, S, state) {
      const { at } = S;
      const yf = fail.y;
      const piece = [], band = [];
      const jags = new Int8Array(S.fx1 - S.fx0 + 1);
      for (let x = S.fx0; x <= S.fx1; x += 1) jags[x - S.fx0] = (PW.hash2(x >> 1, yf) % 5) - 2;    // the break is ragged
      for (let y = S.fy0; y <= S.fy1; y += 1) {
        for (let x = S.fx0, k = at(x, y); x <= S.fx1; x += 1, k += 1) {
          if (!state[k]) continue;
          const jag = jags[x - S.fx0];
          if (y < yf + jag - 1) { piece.push(y * W + x); state[k] = 0; }
          else if (y <= yf + jag + 2) { band.push(y * W + x); state[k] = 0; }
        }
      }
      if (piece.length < CRUMBLE_ONLY) { crumble(piece.concat(band)); fail.cells = piece.length + band.length; return; }
      crumble(band);
      for (const i of band) if ((PW.hash2(i, 3) & 7) === 0) fragments.puff(i % W, ((i / W) | 0) - 1, 2, 4, 2);
      if (fail.reason === 'pancake') spawnLater({ cells: piece, owner: b.id, drop: true, floor: yf, base: b.ground, dir: fail.dir });
      else if (fail.reason === 'swept') {
        // (shoved off the way the water pushes: the push over what the row held, over its weight)
        const vx = fail.dir * Math.min(SWEEP_MAX, PW.GRAVITY * (fail.push - fail.holds) / (piece.length * FRAME_WEIGHT) * SWEEP_TIME);
        spawnLater({ cells: piece, owner: b.id, floor: yf, base: b.ground, dir: fail.dir, vx });
        stats.swept = (stats.swept || 0) + 1;
      } else spawnLater({ cells: piece, owner: b.id, floor: yf, base: b.ground, dir: fail.dir });
      fail.cells = piece.length + band.length;
      b.collapses = (b.collapses || 0) + 1;
      (b.failures || (b.failures = [])).push(fail.reason);
      stats.collapses += 1;
      // The stump is checked again, and so are neighbours that leaned on it.
      due.set(b.id, tick + REPEAT);
      for (const other of world.buildings || []) {
        // (a lot cleared for building - see the capital lab - is a record with no body yet)
        if (other === b || !other || !other.body || other.body.right < b.body.left - 60 || other.body.left > b.body.right + 60) continue;
        notify(other.id);
      }
    }

    // (the world's: water pressing on a building tells it - see pw-sim's pushOn)
    world.structure = { notify, step, analyse, stats, blueprintOf };
    return world.structure;
  }

  PW.createStructure = createStructure;
})();
