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

  const RATE = 0.25;              // seconds per HM per living core
  const HM_PER_DEBRIS = 0.2;      // what a recycled cell of debris is worth
  const SCAN_COLS = 8;            // canvas columns rescanned per damaged building per tick
  const BACK_PER_HM = 8;          // back-wall cells restored per HM
  // The F2 order, by the blueprint's role classes.
  const PRIORITY = new Uint8Array(16).fill(4);
  const ROLES = { FRAME: 12, CRADLE: 9, VAULT: 11, SLAB: 2, ROOF: 4, STAIR: 3, WALL: 1, GLASS: 5, CORE: 8, GRATE: 15 };
  for (const r of [ROLES.FRAME, ROLES.CRADLE, ROLES.VAULT]) PRIORITY[r] = 0;
  for (const r of [ROLES.SLAB, ROLES.ROOF, ROLES.STAIR]) PRIORITY[r] = 1;
  PRIORITY[ROLES.WALL] = 2;
  PRIORITY[ROLES.GLASS] = 3;
  const LOOSE = new Uint8Array(64);
  for (const id of [M.DEBRIS, M.RUBBLE, M.LOOSE_SOIL, M.LOOSE_STONE, M.SAND, M.ASH, M.RUIN]) LOOSE[id] = 1;

  function createRepair(world, particles) {
    const F = PW.PARTICLE;
    const stats = { scanned: 0, restored: 0, backRestored: 0, recycled: 0, hmFromDebris: 0, hmFromStock: 0, waiting: 0 };
    const jobs = new Map();       // building id -> { scanCol, queue, pool, backCredit }
    const notify = (id) => {
      const b = (world.buildings || [])[id - 1];
      if (!b || !b.canvas) return;
      const job = jobs.get(id) || { scanCol: 0, queue: [], pool: 0, backCredit: 0, budget: 0 };
      // (a scan already under way finishes first; it starts over once it is done, so steady
      // bombardment cannot keep the scanner at column nought for ever)
      if (job.scanCol >= (((world.buildings || [])[id - 1] || {}).canvas || { width: 0 }).width) job.scanCol = 0;
      jobs.set(id, job);
    };
    const coresAlive = (b) => (b.cores || []).filter((core) => {
      // A core is alive while any of its own heart cells still stands.
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        if ((PW.get(world, core.x + dx, core.y + dy) & ID_MASK) === M.CORE) return true;
      }
      return false;
    }).length;
    // Scan a few blueprint columns for wounds: cells the building should have and has not.
    function scan(b, job) {
      const c = b.canvas, W = c.width;
      for (let n = 0; n < SCAN_COLS && job.scanCol < W; n += 1, job.scanCol += 1) {
        const lx = job.scanCol;
        for (let ly = 0; ly < c.height; ly += 1) {
          const i = ly * W + lx;
          const wanted = c.mat[i] & ID_MASK;
          const x = b.ox + lx, y = b.oy + ly;
          if (wanted && c.role[i] !== ROLES.CORE && c.role[i] !== ROLES.GRATE) {
            const now = PW.get(world, x, y) & ID_MASK;
            if (now !== wanted || PW.getOwner(world, x, y) !== b.id) job.queue.push({ x, y, i, back: false, p: PRIORITY[c.role[i]] });
          } else if (!wanted && c.back[i]) {
            if ((PW.get(world, x, y) & ID_MASK) === M.AIR && !PW.getLayer(world, 'back', x, y)) job.queue.push({ x, y, i, back: true, p: 3 });
          }
        }
        stats.scanned += 1;
      }
      if (job.scanCol >= b.canvas.width && job.queue.length) {
        // The build order: class by class, each from the bottom up.
        job.queue.sort((a, q) => a.p - q.p || q.y - a.y);
      }
    }
    // Restore one queued cell. Debris in the wound is swept into the recycler first - that is
    // where the building's own HM comes from.
    function restore(b, job) {
      while (job.queue.length) {
        const cell = job.queue[job.queue.length - 1];
        const c = b.canvas, i = cell.i;
        const now = PW.get(world, cell.x, cell.y) & ID_MASK;
        if (cell.back) {
          if ((PW.get(world, cell.x, cell.y) & ID_MASK) !== M.AIR || PW.getLayer(world, 'back', cell.x, cell.y)) { job.queue.pop(); continue; }
          if (job.backCredit < 1) {
            if (job.pool < 1 / BACK_PER_HM) return false;
            job.pool -= 1 / BACK_PER_HM; job.backCredit += 1;
          }
          job.backCredit -= 1;
          PW.setLayer(world, 'back', cell.x, cell.y, c.back[i]);
          stats.backRestored += 1;
          job.queue.pop();
          return true;
        }
        const wanted = c.mat[i] & ID_MASK;
        if (now === wanted && PW.getOwner(world, cell.x, cell.y) === b.id) { job.queue.pop(); continue; }
        // Loose stuff in the wound is recycled; solid foreign material blocks the cell for now.
        const openish = now === M.AIR || now === M.WATER || PW.mat.phase[now] === PW.PHASE.GAS;
        if (!openish && !LOOSE[now] && PW.getOwner(world, cell.x, cell.y) !== b.id) { job.queue.pop(); continue; }
        if (LOOSE[now]) {
          job.pool += HM_PER_DEBRIS;
          stats.recycled += 1;
          stats.hmFromDebris += HM_PER_DEBRIS;
        }
        if (job.pool < 1) {
          // The bundle's HM tops the pool up, one unit at a time.
          const stock = world.stock && world.stock[b.side];
          if (stock && stock.hm >= 1) { stock.hm -= 1; job.pool += 1; stats.hmFromStock += 1; }
          else { stats.waiting += 1; return false; }
        }
        job.pool -= 1;
        PW.set(world, cell.x, cell.y, c.mat[i], { quiet: true });
        PW.setLayer(world, 'paint', cell.x, cell.y, c.paint[i]);
        PW.setOwner(world, cell.x, cell.y, b.id);
        if (c.deco[i]) PW.setLayer(world, 'deco', cell.x, cell.y, c.deco[i]);
        stats.restored += 1;
        // The white fleck of the translator's work.
        if (particles && F && (stats.restored & 3) === 0) {
          particles.spawn(cell.x + 0.5, cell.y + 0.5, ((PW.hash2(cell.x, cell.y) & 63) - 32) * 0.6, -26, M.DEBRIS | 3 << 6, 0, 0, 3);
        }
        job.queue.pop();
        return true;
      }
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
          stats.recycled += 1;
          stats.hmFromDebris += HM_PER_DEBRIS;
          if ((cells -= 1) <= 0) return;
        }
      }
    }
    function step(dt = 1 / 60) {
      for (const [id, job] of jobs) {
        const b = (world.buildings || [])[id - 1];
        if (!b || b.ruined) { if (!b) jobs.delete(id); continue; }
        if (job.scanCol < b.canvas.width) scan(b, job);
        if (!job.queue.length) {
          if (job.scanCol >= b.canvas.width) jobs.delete(id);
          continue;
        }
        const alive = coresAlive(b);
        if (!alive) continue;
        if (job.pool < 2) {
          job.recycleBudget = (job.recycleBudget || 0) + dt * 5;
          if (job.recycleBudget >= 1) { recycle(b, job, Math.floor(job.recycleBudget)); job.recycleBudget %= 1; }
        }
        job.budget = Math.min(alive * 2, (job.budget || 0) + dt * alive / RATE);
        while (job.budget >= 1) {
          if (!restore(b, job)) break;
          job.budget -= 1;
        }
      }
    }
    return { step, notify, stats, jobs };
  }

  PW.createRepair = createRepair;
})();
