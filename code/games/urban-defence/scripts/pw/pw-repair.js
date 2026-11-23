'use strict';
// Repair through the cores (step F). While any of a building's cores survives, the building heals
// itself: debris lying in its wounds is recycled into a little HM, the bundle's HM adds more, and
// each core's translator turns 1 HM every quarter second into a repair pixel - one cell of the
// building restored from its own blueprint, in the order a building grows (F2): the frame and the
// cores' housing first, then floors and stairs, then walls, then glass, the trimmings last, each
// class from the bottom up. The restored cell announces itself with a white fleck of light at the
// translator's work. A ruined building does not repair here: its cores are busy rising out of the
// rubble (the rebuild from the bed is the second half of F).
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;

  const RATE = 0.15;              // seconds per HM per living core (user: reconstruction 67% faster)
  const CELLS_PER_HM = 8;         // repair pixels one HM buys (the translator turns HM into a burst)
  // What a recycled cell of debris is worth: half a repair pixel (N100, the user's: the rubble goes
  // into the rebuild two pixels to one)
  const HM_PER_DEBRIS = 1 / (2 * CELLS_PER_HM);
  const SCAN_COLS = 8;            // canvas columns rescanned per damaged building per tick
  // The F2 order, by the blueprint's role classes (the user's support hierarchy): the cores'
  // main pillars and frame first - the primary support - then the floors that tie pillar to
  // pillar, then the back walls, then the side walls closing the building, the glass and the
  // finery last. LEAD staggers the classes by storey: the pillars run about a storey ahead of
  // the floors, and each secondary class trails the one before it down the build.
  const PRIORITY = new Uint8Array(16).fill(5);
  const ROLES = { FRAME: 12, CRADLE: 9, VAULT: 11, SLAB: 2, ROOF: 4, STAIR: 3, WALL: 1, GLASS: 5, CORE: 8, GRATE: 15 };
  for (const r of [ROLES.FRAME, ROLES.CRADLE, ROLES.VAULT]) PRIORITY[r] = 0;
  for (const r of [ROLES.SLAB, ROLES.ROOF, ROLES.STAIR]) PRIORITY[r] = 1;
  PRIORITY[ROLES.WALL] = 3;                       // (back walls take 2: see the scan's queue push)
  PRIORITY[ROLES.GLASS] = 4;
  const LEAD = [48, 0, -8, -16, -24, -24];        // sort-row head start per priority class
  const LOOSE = new Uint8Array(64);
  for (const id of [M.DEBRIS, M.RUBBLE, M.LOOSE_SOIL, M.LOOSE_STONE, M.SAND, M.ASH, M.RUIN]) LOOSE[id] = 1;
  if (M.WRECK) LOOSE[M.WRECK] = 1;   // N77: crews salvage a burnt hull for HM like any ruin
  // The resurrection is on: the structure side knows construction sites (b.growing) now.
  if (PW.REBUILD_RUINS === undefined) PW.REBUILD_RUINS = true;

  function createRepair(world, particles) {
    const F = PW.PARTICLE;
    const stats = { scanned: 0, restored: 0, backRestored: 0, recycled: 0, hmFromDebris: 0, hmFromStock: 0, waiting: 0 };
    const jobs = new Map();       // building id -> { scanCol, queue, pool, backCredit }
    const notify = (id) => {
      const b = (world.buildings || [])[id - 1];
      if (!b || !b.canvas) return;
      const job = jobs.get(id) || { scanCol: 0, queue: [], seen: new Set(), pool: 0, budget: 0 };
      // (a scan already under way finishes first; it starts over once it is done, so steady
      // bombardment cannot keep the scanner at column nought for ever)
      if (job.scanCol >= (((world.buildings || [])[id - 1] || {}).canvas || { width: 0 }).width) job.scanCol = 0;
      job.printAt = 0;   // the prints (N50: the pump) are looked over again on any damage
      jobs.set(id, job);
    };
    // N87: a building re-founded at a new level keeps its blueprint but not its old work - the
    // queue holds world cells of the old placement. The job starts over from the new one, its
    // salvage carried across - and the wreck packed into the new footing is salvage too, worth
    // what the same debris recycled would have been (the rebuild eats its own wreck).
    const refit = (id, packed = 0) => {
      const old = jobs.get(id);
      jobs.delete(id);
      notify(id);
      const job = jobs.get(id);
      if (!job) return;
      job.pool = (old ? old.pool || 0 : 0) + packed * HM_PER_DEBRIS;
      stats.hmFromDebris += packed * HM_PER_DEBRIS;
    };
    // ---- N100: the rebuild waits for the fall to end, eats its own heap, and comes down with it ----
    // (the user's: no rebuilding while the structure is still falling; as it settles the cores
    // take the rubble under them into the rebuild, two pixels of it for each one built; and as
    // the heap is used up the whole building comes down with it - not a tower left on a hill)
    const HEAP = new Uint8Array(64);
    for (const id of [M.DEBRIS, M.RUBBLE, M.RUIN]) HEAP[id] = 1;
    const EAT_PER_CELL = 2;        // heap cells taken into each restored cell
    const SINK_STEP = 3;           // rows the building comes down at a time
    const SINK_EVERY = 12;         // ticks between steps at the most
    const SINK_LOW = 16;           // heap credit under which the crews take the next rows from under the bed
    const FENCE = 96;              // cells either side of the body the heap is taken from
    const REST_LOOKS = 3, REST_STEADY = 12, REST_EVERY = 20, REST_GIVE_UP = 30 * 60;
    // (the ground row the building first stood on: it never comes down past it)
    const homeOf = (b) => (b.homeGround !== undefined ? b.homeGround : b.ground);
    const bundleAt = (x, y) => (PW.get(world, x, y) & ID_MASK) === M.PIPE || (PW.getFlags(world, x, y) & PW.FLAG.HOLLOW) !== 0;
    const tunnelAt = (x, y) => (PW.getFlags(world, x, y) & PW.FLAG.TUNNEL) !== 0;
    // (the bundle's bed beside its bore is the line's, not the heap)
    const byBore = (x, y) => bundleAt(x - 1, y) || bundleAt(x + 1, y) || bundleAt(x, y - 1) || bundleAt(x, y + 1)
      || bundleAt(x, y - 2) || bundleAt(x, y + 2);
    // The heap: wreck lying loose, and the mound a re-found packed under the building (made ground
    // in the mound's columns over the ground the building first stood on - b.mound, pw-cores)
    const moundAt = (b, x, y) => !!b.mound && x >= b.mound.x0 && x <= b.mound.x1 && y < homeOf(b) - 2
      && (PW.get(world, x, y) & ID_MASK) === M.FILL && !PW.getOwner(world, x, y) && !byBore(x, y);
    const heapAt = (b, x, y) => (HEAP[PW.get(world, x, y) & ID_MASK] === 1 && !PW.getOwner(world, x, y)) || moundAt(b, x, y);
    const looseAt = (x, y) => LOOSE[PW.get(world, x, y) & ID_MASK] === 1 && !PW.getOwner(world, x, y);
    const openAt = (x, y) => PW.mat.phase[PW.get(world, x, y) & ID_MASK] <= PW.PHASE.GAS && !PW.getOwner(world, x, y);
    // (what the bed may come down into: open air, loose wreck, the mound, the bundle - re-laid after)
    const giveAt = (b, x, y) => !tunnelAt(x, y) && (openAt(x, y) || looseAt(x, y) || bundleAt(x, y)
      || ((PW.get(world, x, y) & ID_MASK) === M.FILL && !PW.getOwner(world, x, y)));
    // (1) At rest: the building's lot - the body and the fence round it, down to where its heap
    // lies - quiet, no ball of it still rising or floating, a few looks running. Quiet is PS's
    // recipe with the solids judged by the heap's own profile (as the re-found's look does: smoke
    // drifting over a wreck keeps the sim's chunks awake long after the rubble has stopped): no
    // stability look pending in the box, no piece of anything in flight in it, and the surface
    // across it where it was at the last look. Once at work, only something coming down over it
    // again - a piece of it in the air - stands them down (a wound alone does not: a tower being
    // rammed is patched as it is struck, or it goes over). A first rise has nothing falling about
    // it and is never held; a wreck that never settles is worked after half a minute anyway.
    function settled(b, job) {
      if (b.underConstruction && !b.ruined) return true;
      const tick = world.tick || 0;
      if (tick < (job.restLookAt || 0)) return !!job.calm;
      job.restLookAt = tick + REST_EVERY;
      const x0 = Math.max(1, b.body.left - FENCE), x1 = Math.min(world.width - 2, b.body.right + FENCE);
      const y0 = b.body.top - 20, y1 = b.ground + 120;
      const fr = world.fragments;
      let piece = false;
      if (fr) for (const p of fr.list) {
        const cs = Math.cos(p.angle), sn = Math.sin(p.angle), cx = p.px + p.gx * cs - p.gy * sn, cy = p.py + p.gx * sn + p.gy * cs;
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) { piece = true; break; }
      }
      if (job.calm) {
        if (piece) { job.calm = false; job.restLooks = 0; job.steadyLooks = 0; job.restTops = null; job.restSince = tick; }
        return job.calm;
      }
      if (job.restSince === undefined) job.restSince = tick;
      if (tick - job.restSince > REST_GIVE_UP) { job.calm = true; return true; }
      const S = world.stability;
      const quiet = !(S && S.settling && S.settling(x0, y0, x1, y1));
      const tops = [];
      for (let x = x0; x <= x1; x += 3) tops.push(world.groundTop[x]);
      const prev = job.restTops;
      job.restTops = tops;
      const moved = prev && prev.length === tops.length ? tops.filter((y, i) => Math.abs(y - prev[i]) > 2).length : Infinity;
      const steady = moved <= Math.max(2, tops.length * 0.05);
      // (a ball out of its bed - climbing out of the wreck, or in the air over its bed; one come
      // down onto it, or fallen past it, waits there for the crews)
      const floating = (b.cores || []).some((c) => !c.orb && !c.standing && !c.lost && !c.dead && c.homeY !== undefined && !c.settled
        && (!c.free || c.y < c.homeY));
      job.restLooks = quiet && steady && !piece && !floating ? (job.restLooks || 0) + 1 : 0;
      // (as the re-found's look: a lot that has held its shape for four seconds with nothing in the
      // air over it is at rest, whatever bookkeeping stability still has queued round it - a
      // neighbour's crews and judges at work keep it looking there as long as they work)
      job.steadyLooks = steady && !piece && !floating ? (job.steadyLooks || 0) + 1 : 0;
      if (job.restLooks >= REST_LOOKS || job.steadyLooks >= REST_STEADY) job.calm = true;
      return !!job.calm;
    }
    // The building's foot in each canvas column - its lowest cell there (-1: none standing).
    function mapFoot(b, job) {
      const c = b.canvas, foot = new Int32Array(c.width).fill(-1);
      const y1 = Math.min(world.height - 3, b.oy + c.height);
      for (let lx = 0; lx < c.width; lx += 1) {
        const x = b.ox + lx;
        if (x < 1 || x >= world.width - 1 || printed(c)[lx] < 0) continue;
        for (let y = y1; y >= b.oy; y -= 1) if (PW.getOwner(world, x, y) === b.id) { foot[lx] = y; break; }
      }
      job.foot = foot;
    }
    // The lowest row of the blueprint in each canvas column, -1 where it has none (read once a
    // blueprint).
    const printed = (c) => {
      if (c.printBottom) return c.printBottom;
      const bottom = new Int16Array(c.width).fill(-1);
      for (let lx = 0; lx < c.width; lx += 1) for (let ly = c.height - 1; ly >= 0; ly -= 1) if (c.mat[ly * c.width + lx] || c.back[ly * c.width + lx]) { bottom[lx] = ly; break; }
      return (c.printBottom = bottom);
    };
    // (not under the building: the ground below its footing goes only as it comes down - eaten
    // from above, a column of it standing empty was dug into a pit under the wall that would stand
    // there; inside the blueprint's outline the crews dig what is in the way as they build anyway,
    // and under an eave or a wing held out over the ground it is the mound's slope)
    const beside = (b, x, y) => {
      const lx = x - b.ox;
      if (lx < 0 || lx >= b.canvas.width) return true;
      const bottom = printed(b.canvas)[lx];
      return bottom < 0 || b.oy + bottom < b.ground - 1 || y <= b.oy + bottom;
    };
    // (2) Take up to n cells of the heap round the building, from its top - the slopes of the
    // mound it stands on and the wreck lying by it, only what lies over the ground the building
    // first stood on. Each taken cell is gone.
    function eatHeap(b, job, n) {
      const tick = world.tick || 0;
      if (tick < (job.heapIdleUntil || 0)) return 0;
      const home = homeOf(b);
      let took = 0;
      const x0 = Math.max(2, b.body.left - FENCE), x1 = Math.min(world.width - 3, b.body.right + FENCE), w = x1 - x0 + 1;
      for (let k = 0; k < w && took < n; k += 1) {
        const x = x0 + (job.eatOut = ((job.eatOut || 0) + 1) % w);
        const y = world.groundTop[x];
        if (y >= home || !beside(b, x, y) || !heapAt(b, x, y)) continue;
        PW.set(world, x, y, M.AIR, { quiet: true });
        took += 1; stats.eaten = (stats.eaten || 0) + 1;
      }
      // (none left within reach: look again in a while, not every cell)
      if (!took) job.heapIdleUntil = tick + 300;
      return took;
    }
    // The building whole and home, what is left of its mound - the made ground packed beside it -
    // is taken away too, a lap of its columns at a time, so no hill of it stays (the side's stock
    // has what it was worth). False once a whole lap finds none.
    function clearMound(b, job) {
      const m = b.mound, w = m.x1 - m.x0 + 1;
      let took = 0;
      for (let k = 0; k < w && took < 40; k += 1) {
        const x = m.x0 + (job.moundCol = ((job.moundCol || 0) + 1) % w);
        const y = world.groundTop[x];
        if (y >= homeOf(b) - 2 || !beside(b, x, y) || !heapAt(b, x, y)) continue;
        PW.set(world, x, y, M.AIR, { quiet: true });
        took += 1;
      }
      job.heapCredit = (job.heapCredit || 0) + took;
      stats.eaten = (stats.eaten || 0) + took;
      return took > 0;
    }
    // (3) The building comes down with its heap: a few rows of what lies under the whole of its
    // bed are taken into the work (two of them a cell, as any heap) and the building is set down
    // into their place in the same breath - every column of it, its cells and whatever stands in
    // its rooms, its cores and its record with it (the N87 re-found's machinery, downward in
    // steps) - so it never hangs over a gap. Only while there is heap or open air under every
    // column of it, and never past the ground it first stood on; never while a ball of it is out.
    // The bundle lets go first and threads the beds again after; the crews look the blueprint
    // over afresh at its new place.
    function trySink(b, job) {
      let dy = Math.min(SINK_STEP, homeOf(b) - b.ground), any = false;
      if (dy <= 0) return false;
      if ((b.cores || []).some((q) => q.free && !q.orb && !q.standing && !q.lost && !q.dead)) return false;
      // (read afresh: the crews build lower cells as they go)
      mapFoot(b, job);
      const foot = job.foot;
      for (let lx = 0; lx < foot.length && dy > 0; lx += 1) {
        if (foot[lx] < 0) continue;
        any = true;
        const x = b.ox + lx;
        let g = 0;
        while (g < dy) {
          const y = foot[lx] + 1 + g;
          if (!giveAt(b, x, y)) break;
          g += 1;
        }
        dy = g;
      }
      if (!any || dy <= 0) return false;
      const c = b.canvas, P = world.pipes;
      const sides = new Set();
      if (P && P.lines) for (const l of P.lines) if (l.cores.some((q) => q.building === b.id)) sides.add(l.side);
      for (const side of sides) P.releaseBuilding(side, b.id);
      // (a cell of another building, a tunnel or the bundle is neither carried nor written over)
      const fixed = (x, y) => bundleAt(x, y) || tunnelAt(x, y) || (PW.getOwner(world, x, y) && PW.getOwner(world, x, y) !== b.id);
      const LAYERS = ['paint', 'back', 'deco'];
      const put = (x, ty, value, owner, layers, flags) => {
        PW.set(world, x, ty, value, { quiet: true, keepPaint: true });
        for (let k = 0; k < 3; k += 1) PW.setLayer(world, LAYERS[k], x, ty, layers[k]);
        PW.setOwner(world, x, ty, owner);
        const g = PW.getFlags(world, x, ty);
        if (g & ~flags) PW.setFlag(world, x, ty, g & ~flags, false);
        if (flags & ~g) PW.setFlag(world, x, ty, flags & ~g, true);
      };
      const NONE = [0, 0, 0];
      let ate = 0;
      for (let lx = 0; lx < foot.length; lx += 1) {
        if (foot[lx] < 0) continue;
        const x = b.ox + lx, top = Math.max(1, b.oy);
        for (let y = foot[lx] + 1; y <= foot[lx] + dy; y += 1) if (!bundleAt(x, y) && !openAt(x, y) && giveAt(b, x, y)) ate += 1;
        // (from the foot up: each cell read before anything is written over it)
        for (let y = foot[lx]; y >= top; y -= 1) {
          const ty = y + dy;
          if (fixed(x, ty)) continue;
          if (fixed(x, y)) { put(x, ty, M.AIR, 0, NONE, 0); continue; }
          put(x, ty, PW.get(world, x, y), PW.getOwner(world, x, y), LAYERS.map((l) => PW.getLayer(world, l, x, y)), PW.getFlags(world, x, y));
        }
        for (let y = top; y < top + dy; y += 1) if (!fixed(x, y)) put(x, y, M.AIR, 0, NONE, 0);
        if (PW.refreshGroundTop) PW.refreshGroundTop(world, x, Math.max(0, top - 4));
      }
      job.heapCredit = (job.heapCredit || 0) + ate;
      stats.eaten = (stats.eaten || 0) + ate;
      // the record, at its new place (the blueprint the same, its rows dy lower)
      const fresh = PW.buildingRecord(world, { canvas: c, x: b.ox, y: b.oy + dy }, {});
      if (b.y === b.oy) b.y += dy;
      for (const key of ['oy', 'ground', 'body', 'floors', 'stairs', 'doors', 'slots', 'panels', 'devices', 'windows', 'storage', 'hatches', 'gates', 'hangar', 'floating', 'runway', 'shaft']) b[key] = fresh[key];
      (b.cores || []).forEach((core, i) => {
        const f = fresh.cores[i];
        if (!f) return;
        core.vault = f.vault;
        core.homeY = f.y;
        core.y += dy;
      });
      // (its mounted guns come down on their mounts; the batteries on the ground stay where they are)
      for (const u of world.defence || []) if (u.building === b.id && u.type === 'turret' && !u.dead) { u.y += dy; if (u.base) u.base = { ...u.base, y: u.base.y + dy }; }
      if (b.base) {
        if (b.base.G !== undefined) b.base.G += dy;
        if (b.base.cores) b.base.cores = b.base.cores.map((q) => ({ x: q.x, y: q.y + dy }));
      }
      for (const side of sides) {
        const taps = P.TAPS && P.TAPS[b.type];
        for (const core of b.cores) if (!core.orb && !core.standing && !core.lost && core.vault) P.connectCore(core.x, core.homeY, side, taps, b.id);
      }
      // (the work looked over afresh from the new place - its pool and its heap credit kept; the
      // judges look again, as at any change - not as a blow: a struck site's props let go)
      job.queue = []; job.seen = new Set(); job.dead = 0; job.rot = 0; job.sinceReady = 0; job.scanCol = 0; job.printAt = 0;
      mapFoot(b, job);
      if (world.structure && world.structure.notify) world.structure.notify(b.id);
      b.sunk = (b.sunk || 0) + dy;
      stats.sunk = (stats.sunk || 0) + dy;
      return true;
    }
    // The flat list of a building's print cells (N50: world-drawn works like the lake pump,
    // captured at generation, rebuilt by the same translators as the canvas).
    const printCells = (b) => (b.prints ? (b.printList || (b.printList = b.prints.flatMap((p) => p.cells))) : EMPTY_PRINT);
    const EMPTY_PRINT = [];
    const coresAlive = (b) => (b.cores || []).filter((core) => {
      // A core is alive while any of its own heart cells still stands.
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        if ((PW.get(world, core.x + dx, core.y + dy) & ID_MASK) === M.CORE) return true;
      }
      return false;
    }).length;
    // Scan a few blueprint columns for wounds: cells the building should have and has not. While
    // a building's cores are out of their vaults, their whole descent corridor is left unscanned:
    // a risen core IS its own cells and brings them back down with it, and nothing may be rebuilt
    // across its way home. Once the cores settle, the corridor is scanned like everything else.
    const inUnit = (b, x, y) => !!b.coresOpen && (b.cores || []).some((core) => !core.orb && !core.settled && !core.lost && Math.abs(x - core.x) <= 14
      && y >= Math.min(core.y, core.homeY ?? core.y) - 18 && y <= (core.homeY ?? core.y) + 11);
    function scan(b, job) {
      const c = b.canvas, W = c.width;
      for (let n = 0; n < SCAN_COLS && job.scanCol < W; n += 1, job.scanCol += 1) {
        const lx = job.scanCol;
        for (let ly = 0; ly < c.height; ly += 1) {
          const i = ly * W + lx;
          const wanted = c.mat[i] & ID_MASK;
          const x = b.ox + lx, y = b.oy + ly;
          if (inUnit(b, x, y)) continue;
          if (wanted && c.role[i] !== ROLES.CORE && c.role[i] !== ROLES.GRATE) {
            const now = PW.get(world, x, y) & ID_MASK;
            if ((now !== wanted || PW.getOwner(world, x, y) !== b.id) && !job.seen.has(i)) {
              job.seen.add(i);
              job.queue.push({ x, y, i, back: false, p: PRIORITY[c.role[i]] });
            }
          } else if (!wanted && c.back[i]) {
            // (a back layer that is there but not owned is a ruin's smeared panel, not the wall:
            // it is re-laid and claimed like a missing one; a room still full of unowned natural
            // ground - a growing lot, a slide through the wound - is queued for digging out)
            const now = PW.get(world, x, y) & ID_MASK;
            const open = now === M.AIR && (!PW.getLayer(world, 'back', x, y) || PW.getOwner(world, x, y) !== b.id);
            if ((open || diggable(now, x, y)) && !job.seen.has(-i - 1)) {
              job.seen.add(-i - 1);
              job.queue.push({ x, y, i, back: true, p: 2 });
            }
          }
        }
        stats.scanned += 1;
      }
      // The prints after the canvas (N50): same wounds, same queue, same translators. Print
      // cells take synthetic indices past the canvas's so the seen set and tombstones hold.
      const prints = printCells(b);
      if (job.scanCol >= W && prints.length) {
        const base = c.width * c.height;
        let at = job.printAt || 0;
        for (let n = 0; n < SCAN_COLS * 40 && at < prints.length; n += 1, at += 1) {
          const pc = prints[at];
          const key = base + at;
          const now = PW.get(world, pc.x, pc.y) & ID_MASK;
          if (pc.mat) {
            const wanted = pc.mat & ID_MASK;
            if (wanted === M.CORE) continue;             // hearts are not rebuilt, as in the canvas
            if ((now !== wanted || PW.getOwner(world, pc.x, pc.y) !== b.id) && !job.seen.has(key)) {
              job.seen.add(key);
              job.queue.push({ x: pc.x, y: pc.y, i: key, print: pc, back: false, p: 2 });
            }
          } else if (pc.back) {
            const open = now === M.AIR && (!PW.getLayer(world, 'back', pc.x, pc.y) || PW.getOwner(world, pc.x, pc.y) !== b.id);
            if ((open || diggable(now, pc.x, pc.y)) && !job.seen.has(-key - 1)) {
              job.seen.add(-key - 1);
              job.queue.push({ x: pc.x, y: pc.y, i: key, print: pc, back: true, p: 2 });
            }
          }
        }
        job.printAt = at;
      }
      if (job.scanCol >= b.canvas.width && (job.printAt || 0) >= prints.length && job.queue.length) {
        if (job.dead) { job.queue = job.queue.filter(Boolean); job.dead = 0; job.rot = 0; }
        // The build order (F2): from the bottom up, the cores' pillars running a storey ahead
        // (LEAD), the floors tying them, back then side walls trailing, glass last - and each
        // row grown from the middle outward, so the work never leans lopsided off its support
        // and topples. (Work is taken from the END of the queue, so the first work sorts last.)
        const cx = (b.body.left + b.body.right) / 2;
        job.queue.sort((a, q) => ((a.y + LEAD[a.p]) - (q.y + LEAD[q.p])) || (q.p - a.p) || (Math.abs(q.x - cx) - Math.abs(a.x - cx)));
      }
    }
    // Unowned natural ground standing inside the blueprint is the builders' to dig: a growing
    // lot's hillside, or the slide that filled a wound (A2.3b). Never ore and never bedrock.
    const diggable = (now, x, y) => PW.mat.terrain[now] && now !== M.ORE && now !== M.BEDROCK && !PW.getOwner(world, x, y);
    // The work SPREADS like Life (the user's model): a cell may only be built touching work
    // that already stands, each class growing its own way - the pillars climb from the
    // translator on top of the core; the floors branch off the pillars and reach outward; the
    // back walls and side walls fill in from the pillars and floors; the finery from anything.
    // The sorted queue stays as the order the frontier PREFERS; readiness decides what it MAY
    // take. (Anything the building owns counts as standing - the bed and the gift below ground
    // are the first sources, so a newborn grows out of its translator exactly as asked.)
    const builtAt = (b, x, y) => PW.getOwner(world, x, y) === b.id;
    // The blueprint role under a neighbour (-1 outside the blueprint: the bed and the gift,
    // which count as structure).
    const roleAt = (b, x, y) => {
      const c = b.canvas, lx = x - b.ox, ly = y - b.oy;
      return lx >= 0 && ly >= 0 && lx < c.width && ly < c.height ? c.role[ly * c.width + lx] : -1;
    };
    const FLOORY = (r) => r === ROLES.SLAB || r === ROLES.ROOF || r === ROLES.STAIR;
    function ready(b, cell) {
      const { x, y, p } = cell;
      if (cell.print) {
        // A print cell grows against the building's own cells or the earth around the work
        // (the pump chamber rebuilds inward from the ground it is dug into - N50).
        const anchored = (ax, ay) => {
          if (PW.getOwner(world, ax, ay) === b.id) return true;
          const id = PW.get(world, ax, ay) & ID_MASK;
          return id !== M.AIR && id !== M.WATER && PW.mat.terrain[id];
        };
        return anchored(x - 1, y) || anchored(x + 1, y) || anchored(x, y + 1) || anchored(x, y - 1);
      }
      if (p === 0) return builtAt(b, x, y + 1) || builtAt(b, x - 1, y + 1) || builtAt(b, x + 1, y + 1) || builtAt(b, x, y - 1);
      if (p === 1) return builtAt(b, x - 1, y) || builtAt(b, x + 1, y) || builtAt(b, x, y + 1);
      if (p === 3) {
        // The side walls follow once the floors reach the ends (N23F): a wall cell climbs its
        // own wall, stands on a floor, a pillar or the bed, or starts beside the floor that
        // has just arrived at the building's end - never off the back walls alone.
        const under = roleAt(b, x, y + 1);
        if (builtAt(b, x, y + 1) && (under === ROLES.WALL || under === ROLES.FRAME || under === -1 || FLOORY(under))) return true;
        const side = (nx) => { const r = roleAt(b, nx, y); return builtAt(b, nx, y) && (FLOORY(r) || r === ROLES.WALL); };
        return side(x - 1) || side(x + 1);
      }
      return builtAt(b, x - 1, y) || builtAt(b, x + 1, y) || builtAt(b, x, y + 1) || builtAt(b, x, y - 1);
    }
    // Restore one queued cell. Debris in the wound is swept into the recycler first - that is
    // where the building's own HM comes from. The sort already orders the work storey by storey
    // with the frame ahead of the finery at each height, so every class builds in its turn.
    function restore(b, job) {
      // The queue is sorted with the first work at the END; finished or impossible entries
      // become tombstones and the array is compacted now and then. Each placement attempt
      // looks at a bounded window, the window's start going round the queue across calls -
      // the old rotate-to-front deferral moved the whole queue for every unready cell, which
      // on a sixty-thousand-cell blueprint was O(n^2) and froze the page (the user's crash;
      // repair's share of the performance pass).
      const q = job.queue;
      const kill = (idx, cell) => { q[idx] = null; job.dead = (job.dead || 0) + 1; job.seen.delete(cell.back ? -cell.i - 1 : cell.i); };
      const compact = () => {
        // (the old 2048 floor let a small job sit at 1322 entries, 1321 of them dead, for ever)
        if ((job.dead || 0) > 128 && job.dead * 3 > q.length) { job.queue = q.filter(Boolean); job.dead = 0; job.rot = 0; }
      };
      const pay = () => {
        // N100: the heap first - two of its cells into each one built: one off the mound's slopes
        // round the building each time (the whole mound goes down together), the rest from what
        // came out from under the bed as it came down - then the pool and the stock
        const credit = job.heapCredit || 0;
        job.heapCredit = credit + eatHeap(b, job, credit < EAT_PER_CELL ? EAT_PER_CELL - credit : 1);
        if (job.heapCredit >= EAT_PER_CELL) { job.heapCredit -= EAT_PER_CELL; stats.fromHeap = (stats.fromHeap || 0) + 1; return true; }
        if (job.pool >= 1 / CELLS_PER_HM) { job.pool -= 1 / CELLS_PER_HM; return true; }
        // N73: a newborn's whole body is already paid for (the growth engine's lot price) -
        // its first rise draws no stock. A world with no economy at all (the lab) builds free.
        if (b.buildFree || !world.stock) { job.pool += 1 - 1 / CELLS_PER_HM; return true; }
        // The bundle's HM tops the pool up, one unit at a time.
        const stock = world.stock && world.stock[b.side];
        if (stock && stock.hm >= 1) { stock.hm -= 1; job.pool += 1 - 1 / CELLS_PER_HM; stats.hmFromStock += 1; return true; }
        stats.waiting += 1;
        return false;
      };
      const attempt = (idx, cell, force) => {
        const c = b.canvas, i = cell.i;
        const now = PW.get(world, cell.x, cell.y) & ID_MASK;
        // Not touching standing work yet: the frontier passes it by (unless forced: an island
        // cut off in the blueprint must not stall the work forever).
        if (!force && !ready(b, cell)) return 'skip';
        if (cell.back) {
          if (LOOSE[now]) {
            PW.set(world, cell.x, cell.y, M.AIR, { quiet: true });
            job.pool += HM_PER_DEBRIS; stats.recycled += 1; stats.hmFromDebris += HM_PER_DEBRIS;
          } else if (diggable(now, cell.x, cell.y)) {
            PW.set(world, cell.x, cell.y, M.AIR, { quiet: true });
            job.pool += HM_PER_DEBRIS * 0.5; stats.dug = (stats.dug || 0) + 1;
          } else if (now !== M.AIR || (PW.getLayer(world, 'back', cell.x, cell.y) && PW.getOwner(world, cell.x, cell.y) === b.id)) { kill(idx, cell); return 'again'; }
          if (!pay()) return false;
          PW.setLayer(world, 'back', cell.x, cell.y, cell.print ? cell.print.back : c.back[i]);
          PW.setOwner(world, cell.x, cell.y, b.id);
          stats.backRestored += 1;
          job.passProgress = (job.passProgress || 0) + 1;
          kill(idx, cell);
          return true;
        }
        const wanted = (cell.print ? cell.print.mat : c.mat[i]) & ID_MASK;
        if (now === wanted && PW.getOwner(world, cell.x, cell.y) === b.id) { kill(idx, cell); return 'again'; }
        const openish = now === M.AIR || now === M.WATER || PW.mat.phase[now] === PW.PHASE.GAS;
        if (!openish && !LOOSE[now] && PW.getOwner(world, cell.x, cell.y) !== b.id) {
          // A risen core standing in the cell moves on later: the work waits its turn again.
          if (now === M.CORE || now === M.STEEL) return 'skip';
          if (!diggable(now, cell.x, cell.y)) { kill(idx, cell); return 'again'; }
        }
        if (LOOSE[now]) {
          job.pool += HM_PER_DEBRIS; stats.recycled += 1; stats.hmFromDebris += HM_PER_DEBRIS;
        } else if (!openish && diggable(now, cell.x, cell.y)) {
          job.pool += HM_PER_DEBRIS * 0.5; stats.dug = (stats.dug || 0) + 1;
        }
        // Water standing in the wound is never destroyed by the rebuild (PS's flood test:
        // every cell stamped over a flooded spot deleted a water cell). It is displaced to
        // the top of its column, the way the particles' displace() does; shut in with
        // nowhere to go, the cell waits its turn. The seat is CHECKED before pay and the
        // water MOVED only after it - lifting first duplicated a cell every time the HM ran
        // out between the two (PS's second catch: +27 cells on the same flood).
        let liftTo = -1;
        if (now === M.WATER) {
          let top = cell.y;
          while (top > 1 && (PW.get(world, cell.x, top - 1) & ID_MASK) === M.WATER) top -= 1;
          if ((PW.get(world, cell.x, top - 1) & ID_MASK) !== M.AIR) return 'skip';
          liftTo = top - 1;
        }
        if (!pay()) return false;
        if (liftTo >= 0) PW.set(world, cell.x, liftTo, PW.get(world, cell.x, cell.y), { quiet: true });
        PW.set(world, cell.x, cell.y, cell.print ? cell.print.mat : c.mat[i], { quiet: true });
        PW.setLayer(world, 'paint', cell.x, cell.y, cell.print ? cell.print.paint : c.paint[i]);
        PW.setOwner(world, cell.x, cell.y, b.id);
        // A rebuilt grated drain span gets its HATCH flag back (N64: water passes through it).
        if ((b.hatches || []).some((h) => cell.x >= h.x0 && cell.x <= h.x1 && cell.y >= h.y0 && cell.y <= h.y1)) {
          PW.setFlag(world, cell.x, cell.y, PW.FLAG.HATCH);
        }
        if (!cell.print && c.deco[i]) PW.setLayer(world, 'deco', cell.x, cell.y, c.deco[i]);
        stats.restored += 1;
        job.built = (job.built || 0) + 1;
        job.passProgress = (job.passProgress || 0) + 1;
        if (particles && F && (stats.restored & 3) === 0) {
          particles.spawn(cell.x + 0.5, cell.y + 0.5, ((PW.hash2(cell.x, cell.y) & 63) - 32) * 0.6, -26, M.DEBRIS | 3 << 6, 0, 0, 3);
        }
        // The god's foam: now and then a small white colony of Life plays over the fresh work
        // and dies away (black and white are the dead machine god's colours; pw-life runs it).
        if (world.lifeGame && (PW.hash2(cell.x, cell.y) & 31) === 7) world.lifeGame.seed(cell.x, cell.y - 3, 2, world.lifeGame.WHITE);
        kill(idx, cell);
        return true;
      };
      const SCAN_CAP = 400;
      let scanned = 0, fallbackIdx = -1, fallbackCell = null;
      const start = q.length - 1 - (job.rot || 0);
      for (let n = 0; n < q.length && scanned < SCAN_CAP; n += 1) {
        const idx = ((start - n) % q.length + q.length) % q.length;
        const cell = q[idx];
        if (!cell) continue;
        scanned += 1;
        const r = attempt(idx, cell, false);
        if (r === true) { job.sinceReady = 0; compact(); return true; }
        if (r === false) return false;
        if (r === 'skip' && fallbackIdx < 0) { fallbackIdx = idx; fallbackCell = cell; }
      }
      job.rot = ((job.rot || 0) + SCAN_CAP) % Math.max(1, q.length);
      job.sinceReady = (job.sinceReady || 0) + scanned;
      // A whole lap found nothing touching: take the best candidate anyway, so an island cut
      // off in the blueprint never stalls the work.
      if (fallbackCell && job.sinceReady > q.length + SCAN_CAP) {
        job.sinceReady = 0;
        const r = attempt(fallbackIdx, fallbackCell, true);
        if (r === true) { compact(); return true; }
        if (r === false) return false;
      }
      compact();
      return false;
    }
    // The recycler: debris lying against the building - on its floors, its roof, in its rooms -
    // is swept into the pool, a few cells a second, while the building wants HM.
    function recycle(b, job, cells) {
      const left = b.body.left - 2, right = b.body.right + 2;
      const top = b.body.top - 4, bottom = (b.ground || b.body.bottom) + 6;
      for (let n = 0; n < cells * 8 && n < (right - left + 1); n += 1) {
        const x = left + ((job.recCol = ((job.recCol || 0) + 1)) % (right - left + 1));
        for (let y = top; y <= bottom; y += 1) {
          const id = PW.get(world, x, y) & ID_MASK;
          if (!LOOSE[id]) continue;
          const touching = PW.getOwner(world, x, y - 1) === b.id || PW.getOwner(world, x, y + 1) === b.id
            || PW.getOwner(world, x - 1, y) === b.id || PW.getOwner(world, x + 1, y) === b.id;
          if (!touching) continue;
          PW.set(world, x, y, M.AIR, { quiet: true });
          job.pool += HM_PER_DEBRIS;
          job.passProgress = (job.passProgress || 0) + 1;
          stats.recycled += 1;
          stats.hmFromDebris += HM_PER_DEBRIS;
          if ((cells -= 1) <= 0) return;
        }
      }
    }
    function step(dt = 1 / 60) {
      for (const [id, job] of jobs) {
        const b = (world.buildings || [])[id - 1];
        // (a re-seated lot leaves an empty record behind: no canvas, nothing to build)
        if (!b || !b.canvas) { jobs.delete(id); continue; }
        // While this job works the building is a construction site (b.growing): the structure
        // system judges it by what stands, not against its blueprint, and it shrugs off light
        // blows. Cleared the moment the work is done or stops.
        b.growing = false;
        // The resurrection (F part 2): a ruined building rebuilds while its cores stand risen
        // over the wreck, or have already gone home alive (each settles the moment its vault is
        // rebuilt and clear, and works on from there); the descent corridors of the cores still
        // out stay open under them. When enough stands the ruin is over, the vaults close and
        // the fine work follows.
        // (a building going up for the first time counts too: its cores are already home in
        // fresh beds, nothing ever rose - but below the ruin line it must still be worked)
        const risen = PW.REBUILD_RUINS && b.ruined && (!!b.underConstruction
          || (b.cores || []).some((core) => core.free || core.settled) || !!b.coresHome);
        if (b.ruined && !risen) continue;
        // N87: while its balls float and the new bed is being decided, the crews keep off the
        // lot - eating the heap would carry the ground the bed must sit on away under it.
        if (b.refoundPending) continue;
        // N100: nor while what came down is still coming down (the user's: rebuilt only once the
        // structure has finished falling and settled)
        if (!settled(b, job)) continue;
        // A parked job stood down starved: its queue and seen set are let go (tens of
        // thousands of entries per tower - the long war's memory leak, PS's soak). It wakes
        // when HM reaches its side's stock, or when fresh damage calls notify (scanCol 0),
        // and the scan rebuilds its work from the blueprint.
        if (job.parked) {
          const stock = world.stock && world.stock[b.side];
          if (job.scanCol === 0 || (stock && stock.hm >= 1)) { job.parked = false; job.scanCol = 0; job.printAt = 0; }
          else continue;
        }
        const printsLen = printCells(b).length;
        if (job.scanCol < b.canvas.width || (job.printAt || 0) < printsLen) scan(b, job);
        if (job.queue.length - (job.dead || 0) <= 0) {
          if (job.scanCol >= b.canvas.width && (job.printAt || 0) >= printsLen) {
            // A pass that built or cleared anything may have unblocked wounds that were dropped
            // while debris or wreckage sat in them (and back walls hidden behind solids are not
            // even seen until the cell clears) - look over the blueprint again. Only a pass that
            // changed nothing ends the work.
            if ((job.passProgress || 0) > 0) { job.passProgress = 0; job.scanCol = 0; job.printAt = 0; job.queue = []; job.dead = 0; job.rot = 0; }
            // N100: whole again, but still up on what is left of its heap - the crews work on
            // down through it (what they take goes to the side's stock), the building coming
            // down with it to the ground it first stood on
            else if (homeOf(b) > b.ground && ((world.tick || 0) < (job.sinkAt || 0) || trySink(b, job))) {
              if ((world.tick || 0) >= (job.sinkAt || 0)) job.sinkAt = (world.tick || 0) + SINK_EVERY;
            } else if (b.mound && homeOf(b) <= b.ground + 3 && clearMound(b, job)) {
              // (home: the rest of the mound goes)
            } else {
              if (b.mound && homeOf(b) <= b.ground + 3) b.mound = null;
              const stock = world.stock && world.stock[b.side];
              if (stock && job.heapCredit) { stock.hm += job.heapCredit * HM_PER_DEBRIS; stats.hmFromDebris += job.heapCredit * HM_PER_DEBRIS; }
              jobs.delete(id); b.growing = false;
              // N73: the first build is over - the site opens, and later wounds pay their way.
              if (b.buildFree) b.buildFree = false;
              if (b.underConstruction) b.underConstruction = false;
            }
          }
          continue;
        }
        const alive = coresAlive(b);
        if (!alive) continue;
        b.growing = true;
        // The recyclers clear the site as fast as the translators build: wreckage lying against
        // the building's own cells melts away (during a resurrection that includes what the
        // remnant stands on - demolition comes before reconstruction).
        // A resurrected site keeps clearing at the translators' own pace after the ruin is over
        // (b.coresHome): the fine work cannot close walls into heaps of its old wreck. An
        // ordinary wounded building still only sips from the debris touching it.
        const rate = risen || b.coresHome ? alive * CELLS_PER_HM / RATE : (job.pool < 2 ? 5 : 0);
        if (rate > 0) {
          job.recycleBudget = (job.recycleBudget || 0) + dt * rate;
          if (job.recycleBudget >= 1) { recycle(b, job, Math.floor(job.recycleBudget)); job.recycleBudget %= 1; }
        }
        job.budget = Math.min(alive * CELLS_PER_HM * 2, (job.budget || 0) + dt * alive * CELLS_PER_HM / RATE);
        const before = stats.restored + stats.backRestored + stats.recycled + (stats.dug || 0);
        // N100: the stuff from the heap running low - the next rows from under the bed, and the
        // building comes down onto what is left (a few times a second at most); home, what is left
        // of the mound beside it goes into the work
        if ((job.heapCredit || 0) < SINK_LOW && (world.tick || 0) >= (job.sinkAt || 0)) {
          job.sinkAt = (world.tick || 0) + SINK_EVERY;
          if (!trySink(b, job) && b.mound && homeOf(b) <= b.ground + 3) clearMound(b, job);
        }
        while (job.budget >= 1) {
          if (!restore(b, job)) break;
          job.budget -= 1;
        }
        // Starved and still for half a minute - no cell placed, cleared or recycled, no HM in
        // the pool or the stock - the crews stand down and the job's memory is let go.
        if (stats.restored + stats.backRestored + stats.recycled + (stats.dug || 0) !== before) job.idle = 0;
        else if ((job.idle = (job.idle || 0) + 1) > 1800 && job.pool < 1 / CELLS_PER_HM
          && !(world.stock && world.stock[b.side] && world.stock[b.side].hm >= 1)) {
          job.queue = []; job.seen = new Set(); job.dead = 0; job.rot = 0; job.sinceReady = 0;
          job.scanCol = b.canvas.width; job.parked = true; job.idle = 0;
          b.growing = false;
        }
      }
    }
    return { step, notify, refit, stats, jobs };
  }

  PW.createRepair = createRepair;
})();
