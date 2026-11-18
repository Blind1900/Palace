'use strict';
// Cores once their building falls. While a building stands, each of its cores is sealed in its vault
// under a steel grating in the ground floor (the hangar's stands on its floor, the base's main core
// in its pit). When the building is ruined the gratings are blown off, and each core's field lifts
// it up out of its vault through the rubble that fell on it: the core rises a row at a time,
// shouldering the rubble down past itself (every cell of it kept), until it stands on top of the
// ruins with its orb in the open. From then on the field keeps grit and dust off it. However deep a
// fallen building buries its cores, troops can always reach them and hit them.
(function () {
  const PW = window.PW;
  const { M, ID_MASK } = PW;

  const LOOSE = new Uint8Array(64);
  // (a ruin - a piece of the building come to rest whole - it shoulders aside too)
  for (const id of [M.DEBRIS, M.RUBBLE, M.LOOSE_SOIL, M.LOOSE_STONE, M.SAND, M.ASH, M.RUIN]) LOOSE[id] = 1;
  const SETTLE = 60;        // ticks after the gratings blow before the cores start to rise (1 s)
  const RISE_EVERY = 1;     // ticks per row risen (60 rows a second: up through a tower's heap in seconds)
  const SWEEP_EVERY = 6;    // ticks between sweeps once a core stands in the open
  const PER_SWEEP = 80;     // cells a core throws off per sweep (a heap can rain down on it)
  const REACH = 13;         // the core unit with its connector sockets: 13 cells either side of its axis

  function createCores(world, particles) {
    const F = PW.PARTICLE;
    const stats = { opened: 0, blown: 0, risen: 0, cleared: 0 };
    let tick = 0;
    const cellAt = (x, y) => ({ m: PW.get(world, x, y), paint: PW.getLayer(world, 'paint', x, y), owner: PW.getOwner(world, x, y) });
    const put = (x, y, c) => { PW.set(world, x, y, c.m); PW.setLayer(world, 'paint', x, y, c.paint); PW.setOwner(world, x, y, c.owner); };

    // Blow the gratings off a ruined building's vaults: the steel is flung up and out as debris.
    // Each core is freed from the ruin: it is no part of the building's frame any more (so the
    // ruin's collapse does not take it down with it), held up by its own field.
    function expose(b) {
      b.coresOpen = tick;
      b.coresHome = 0;
      stats.opened += 1;
      if (world.onDamage) world.onDamage(b.id);
      for (const core of b.cores || []) {
        if (core.orb) continue;
        core.settled = false;   // freed anew: managed by rise/sweep again
        if (core.homeY === undefined) core.homeY = core.y;   // where it sinks back to (F part 2)
        const c = columnOf(core);
        for (let y = c.top; y <= c.bottom; y += 1) for (let x = c.x0; x <= c.x1; x += 1) {
          const id = PW.get(world, x, y) & ID_MASK;
          if ((id === M.CORE || id === M.STEEL) && PW.getOwner(world, x, y) === b.id) PW.setOwner(world, x, y, 0);
        }
        const v = core.vault;
        if (!v) continue;
        for (let y = v.lid; y < v.top; y += 1) for (let x = v.x0; x <= v.x1; x += 1) {
          if ((PW.get(world, x, y) & ID_MASK) !== M.PLATFORM) continue;
          PW.set(world, x, y, M.AIR);
          PW.setLayer(world, 'paint', x, y, 0);
          PW.setOwner(world, x, y, 0);
          stats.blown += 1;
          if (particles && F && (x + y) % 3 === 0) {
            const h = PW.hash2(x, y);
            particles.spawn(x + 0.5, y - 0.5, ((h & 127) - 64) * 1.2, -90 - (h >>> 7 & 63), M.DEBRIS | 3 << 6, 0, F.LAND | F.DAMAGE, 5);
          }
        }
      }
    }
    // The rows the core unit takes: from the translator's mouth down to its bed's underside (the
    // vault floor below it is the building's, and stays behind when the core rises).
    const columnOf = (core) => ({ x0: core.x - REACH, x1: core.x + REACH, top: core.y - 17, bottom: core.y + 11 });
    // (air, smoke and dust are open; rubble is pushed aside; anything else stands in the way)
    const open = (x, y) => PW.mat.phase[PW.get(world, x, y) & ID_MASK] <= PW.PHASE.GAS;
    const loose = (x, y) => LOOSE[PW.get(world, x, y) & ID_MASK] === 1;
    // The core's own cells: its orb, rings and clamps (freed from the building, so unowned).
    const own = (x, y) => { const id = PW.get(world, x, y) & ID_MASK; return (id === M.CORE || id === M.STEEL) && !PW.getOwner(world, x, y); };
    // Each column of the core: its topmost and lowest cell.
    function spans(core) {
      const c = columnOf(core), out = [];
      for (let x = c.x0; x <= c.x1; x += 1) {
        let lo = -1, hi = -1;
        for (let y = c.top; y <= c.bottom; y += 1) if (own(x, y)) { if (lo < 0) lo = y; hi = y; }
        if (lo >= 0) out.push([x, lo, hi]);
      }
      return out;
    }
    // Is the core out in the open: its top clear (a few grains of grit don't bury it), and its orb
    // clear on one side?
    function exposed(core) {
      const s = spans(core);
      if (!s.length || s.filter(([x, lo]) => loose(x, lo - 1)).length > s.length / 4) return false;
      // (any part of the orb's flank in the open will do)
      const x0 = s[0][0], x1 = s[s.length - 1][0];
      for (let y = core.y - 5; y <= core.y + 5; y += 1) if (open(x0 - 1, y) || open(x1 + 1, y)) return true;
      return false;
    }
    // Lift the core one row: in each of its columns, its cells (and the gaps between them) move up
    // one and the cell that was above goes down under them. A broken remnant of its own fallen
    // building lying on it is shattered into rubble first; anything else that still stands, or
    // the ground, stops it.
    function rise(b, core) {
      const s = spans(core);
      if (!s.length) { core.stopped = 'gone'; return false; }
      for (const [x, lo, hi] of s) {
        for (let y = lo - 1; y <= hi; y += 1) {
          // (gas, water and rubble give way)
          if (PW.mat.phase[PW.get(world, x, y) & ID_MASK] < PW.PHASE.SOLID || own(x, y)) continue;
          const m = PW.get(world, x, y), id = m & ID_MASK;
          // (a remnant of the fallen building - still its own, or come to rest as a ruin or
          // packed rubble - is shattered by the core's field)
          if ((PW.getOwner(world, x, y) === b.id && PW.mat.structural[id] && PW.mat.breaksTo[id]) || id === M.RUIN || id === M.RUBBLE) {
            PW.set(world, x, y, PW.mat.breaksTo[id] || M.DEBRIS);
            PW.setOwner(world, x, y, 0);
            continue;
          }
          core.stopped = `${x},${y}:${PW.mat.names[id]}:o${PW.getOwner(world, x, y)}`;
          return false;
        }
      }
      for (const [x, lo, hi] of s) {
        const displaced = cellAt(x, lo - 1);
        for (let y = lo - 1; y < hi; y += 1) put(x, y, cellAt(x, y + 1));
        put(x, hi, displaced);
      }
      core.y -= 1;
      stats.risen += 1;
      return true;
    }
    // Sink the core one row towards home: the mirror of rise(). In each of its columns, its cells
    // move down one and the cell that was below goes up over them; loose grit gives way, anything
    // solid stops it until the repair clears the way.
    function sink(b, core) {
      const s = spans(core);
      if (!s.length) return false;
      for (const [x, lo, hi] of s) {
        for (let y = lo; y <= hi + 1; y += 1) {
          // (its own cells, open air and loose grit all give way - grit rides down with it)
          if (PW.mat.phase[PW.get(world, x, y) & ID_MASK] < PW.PHASE.SOLID || own(x, y) || loose(x, y)) continue;
          return false;
        }
      }
      for (const [x, lo, hi] of s) {
        const displaced = cellAt(x, hi + 1);
        for (let y = hi + 1; y > lo; y -= 1) put(x, y, cellAt(x, y - 1));
        put(x, lo, displaced);
      }
      core.y += 1;
      return true;
    }
    // Home again: whatever is left of the descent is snapped - the risen copy is taken apart and
    // the unit redrawn from the blueprint in its vault, around the bundle's sockets (the pipe
    // keeps its lanes through the connectors) - and the grating closes over it.
    function settle(b, core) {
      core.free = false;
      // Home, redrawn and owned by its building again: no longer managed by rise/sweep (whose
      // spans see only unowned cells, so they would mistake it for gone and free it again).
      core.settled = true;
      const c = b.canvas;
      if (c) {
        // Take the risen copy apart (its unowned cells, wherever it stopped)...
        const col = columnOf(core);
        for (let y = col.top - 4; y <= col.bottom + 4; y += 1) for (let x = col.x0; x <= col.x1; x += 1) {
          if (own(x, y)) { PW.set(world, x, y, M.AIR, { quiet: true }); PW.setLayer(world, 'paint', x, y, 0); }
        }
        core.y = core.homeY;
        // ...and set the unit back in its bed from the blueprint, with the grating over it.
        for (let ly = 0; ly < c.height; ly += 1) for (let lx = 0; lx < c.width; lx += 1) {
          const i = ly * c.width + lx;
          const role = c.role[i];
          if (role !== 15 && role !== 8 && role !== 9) continue;   // GRATE, CORE, CRADLE
          const x = b.ox + lx, y = b.oy + ly;
          if (Math.abs(x - core.x) > REACH || y < core.homeY - 18 || y > core.homeY + 12) {
            if (role !== 15 || Math.abs(x - core.x) > REACH) continue;
          }
          const id = PW.get(world, x, y) & ID_MASK;
          if (id === M.PIPE) continue;   // the bundle's socket stays
          if (id !== M.AIR && !LOOSE[id] && PW.getOwner(world, x, y) !== b.id && PW.getOwner(world, x, y) !== 0) continue;
          PW.set(world, x, y, c.mat[i], { quiet: true });
          PW.setLayer(world, 'paint', x, y, c.paint[i]);
          PW.setOwner(world, x, y, b.id);
        }
      }
      // (its corridor is scannable again: one more look over the blueprint)
      if (world.repair) world.repair.notify(b.id);
      stats.settled = (stats.settled || 0) + 1;
    }
    // Throw loose cells that land on a core that stands in the open off it, outward from the
    // building.
    function sweep(b, core) {
      const c = columnOf(core), mid = (b.body.left + b.body.right) / 2;
      let moved = 0;
      for (let y = c.top - 6; y <= c.bottom && moved < PER_SWEEP; y += 1) {
        for (let x = c.x0 - 2; x <= c.x1 + 2 && moved < PER_SWEEP; x += 1) {
          const m = PW.get(world, x, y);
          if (!LOOSE[m & ID_MASK]) continue;
          PW.set(world, x, y, M.AIR);
          moved += 1;
          if (particles && F) {
            const h = PW.hash3(x, y, tick), side = core.x < mid ? -1 : 1;
            particles.spawn(x + 0.5, y + 0.5, side * (40 + (h & 31)), -60 - (h >>> 5 & 31), m, 0, F.LAND, 6);
          }
        }
      }
      stats.cleared += moved;
    }
    // Is the core's home region rebuilt and clear - nothing foreign and nothing loose in the
    // vault box it would occupy? (Its own building's cells and open air are what belong there.)
    function homeOpen(b, core) {
      for (let y = core.homeY - 16; y <= core.homeY + 11; y += 1) {
        for (let x = core.x - 11; x <= core.x + 11; x += 1) {
          const id = PW.get(world, x, y) & ID_MASK;
          if (id === M.AIR || LOOSE[id]) continue;
          if (PW.getOwner(world, x, y) === b.id) continue;
          if (id === M.PIPE) continue;   // the bundle's sockets interlock with the bed
          // Unowned core steel is the bed's own remains (expose() freed the whole column);
          // settle() redraws straight over it.
          if ((id === M.CORE || id === M.STEEL) && !PW.getOwner(world, x, y)) continue;
          // Unowned ground (the made ground the bed is cut into) belongs beside the vault;
          // only wreckage (unowned structural) and other buildings' cells bar the way home.
          if (PW.mat.terrain[id] && !PW.getOwner(world, x, y)) continue;
          return false;
        }
      }
      return true;
    }
    function step() {
      tick += 1;
      for (const b of world.buildings || []) {
        if (!b.cores || !b.cores.length) continue;
        if (b.ruined && !b.coresOpen) expose(b);
        // A free core goes home as soon as its vault region is rebuilt and clear - the repair
        // works from the bottom up, so the bed is ready long before the ruin is over. Near home
        // it sinks row by row; from high up, or where its own rebuilt storeys stand in the way,
        // its field carries it home in one move (the settle snap).
        if (b.coresOpen && tick % 2 === 0) {
          for (const core of b.cores) {
            if (core.orb || !core.free) continue;
            if (core.y >= core.homeY) { settle(b, core); continue; }
            if (core.homeY - core.y <= 30 && sink(b, core)) continue;
            if (homeOpen(b, core)) settle(b, core);
          }
        }
        // The vaults close only once the ruin is over (while it stands, closing them would only
        // re-trigger expose and blow the gratings off again); until then settled cores simply
        // wait at home, part of the building again, while the rebuild climbs.
        if (b.coresOpen && !b.ruined && (b.cores || []).every((q) => q.orb || q.settled)) {
          b.coresOpen = 0;
          b.coresHome = tick;   // home and alive: the fine work carries on from below
          if (world.repair) world.repair.notify(b.id);
          continue;
        }
        if (!b.coresOpen || tick - b.coresOpen < SETTLE) continue;
        for (const core of b.cores) {
          if (core.orb || core.settled) continue;   // (the base's main core already stands in its open pit; a settled core is the building's again)
          if (!core.free && tick % RISE_EVERY === 0) {
            if (exposed(core) || !rise(b, core)) {
              core.free = true;
              // (what the gratings and the core held up is looked at again, and comes down)
              if (world.onDamage) world.onDamage(b.id);
            }
          } else if (core.free && tick % SWEEP_EVERY === 0) {
            sweep(b, core);
            // (buried again by the heap slumping onto it, it rises again)
            // (checked every third of a second: heaps of rubble can rain down on it at any time)
            if (tick % (SWEEP_EVERY * 2) === 0 && !exposed(core)) core.free = false;
          }
        }
      }
    }
    return { step, expose, exposed, stats };
  }

  PW.createCores = createCores;

  // ---- The core hierarchy (step D) ---------------------------------------------------------------
  // MAIN cores are each base's genesis (the orb in the core bunker's pit); DESCENDANT cores sit in
  // vaults under every building a city grows; SUB cores come later, when level-ups widen a
  // building (step H). The tree is read by the pipeline (E: the bundle runs core to core), repair
  // (F: translators turn HM into repair pixels) and seeds (G: a dropped seed grows a new
  // descendant). Built on demand from the buildings standing now.
  function coreTree(world) {
    const tree = { main: [], descendants: [], subs: [] };
    for (const b of world.buildings || []) {
      for (const core of b.cores || []) {
        const entry = { x: core.x, y: core.y, building: b.id, side: b.side, core };
        if (core.kind === 'main' || core.orb) tree.main.push(entry);
        else if (core.kind === 'sub') tree.subs.push(entry);
        else tree.descendants.push(entry);
      }
    }
    return tree;
  }
  PW.coreTree = coreTree;
})();
