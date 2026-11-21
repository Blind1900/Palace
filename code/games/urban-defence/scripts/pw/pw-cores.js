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
  if (M.WRECK) LOOSE[M.WRECK] = 1;   // N77: a rising core pushes through a wreck on its pit
  const SETTLE = 60;        // ticks after the gratings blow before the cores start to rise (1 s)
  const FLOAT_HOLD = 120;   // D15: a risen ball floats this long before it will descend (2 s)
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
          if ((PW.get(world, x, y) & ID_MASK) === M.CORE && PW.getOwner(world, x, y) === b.id) PW.setOwner(world, x, y, 0);
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
    // The core's own cells: the energy ball alone (freed from the building, so unowned). The
    // bed stays put when the ball rises - only the ball travels, so nothing of the plate drags
    // up with it and scrambles the climb (the user's rise glitch).
    const own = (x, y) => (PW.get(world, x, y) & ID_MASK) === M.CORE && !PW.getOwner(world, x, y);
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
    // N18O: a core with nothing under it comes down WHOLE, held together by its field - the
    // ground may sink or be blown from under the god's gift, but the gift never bends or
    // shears with it. One row per step, the same column shuffle as sink, gated on every
    // column standing over open air; it lands on the first thing that bears any column
    // (rubble included) and stands there.
    function fall(core) {
      // Only the ball's own body falls (x within 7 of the axis): the thin connector filaments
      // at the unit's edge tear and stay at the rim - the gift torn from its sockets - rather
      // than hold the whole ball hanging off a floating bed remnant.
      const s = spans(core).filter(([x]) => Math.abs(x - core.x) <= 7);
      if (!s.length) return false;
      for (const [x, , hi] of s) {
        const below = PW.get(world, x, hi + 1) & ID_MASK;
        if (below !== M.AIR && PW.mat.phase[below] > PW.PHASE.GAS) return false;
      }
      for (const [x, lo, hi] of s) {
        const displaced = cellAt(x, hi + 1);
        for (let y = hi + 1; y > lo; y -= 1) put(x, y, cellAt(x, y - 1));
        put(x, lo, displaced);
      }
      core.y += 1;
      return true;
    }
    // The sag's (or any caller's) word that the ground under a region changed: every core and
    // seed in the box looks at its support on its next step. The physics track calls
    // world.cores.supportLost(x0, y0, x1, y1) from the sinkhole re-check; blasts are covered
    // by the free cores' own periodic look.
    function supportLost(x0, y0, x1, y1) {
      const mark = (holder) => {
        if (holder.x + REACH >= x0 && holder.x - REACH <= x1 && holder.y + 14 >= y0 && holder.y - 20 <= y1) holder.checkSupport = tick || 1;
      };
      for (const b of world.buildings || []) for (const core of b.cores || []) if (!core.orb) mark(core);
      for (const s of world.seedCores || []) mark(s);
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
          // Flood water in the vault is never destroyed by the re-seat: it leaves as a water
          // particle (PS's catch on the N42O flood - 17 cells vanished under a settling core).
          if (id === M.WATER && particles) particles.spawn(x + 0.5, y + 0.5, 0, -30, M.WATER, 0, F.WATER, 6);
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
    // Does the bed still stand under the home - enough of the building's own cells in the bed
    // region to bear the unit? homeOpen alone reads an empty VOID as a clear home (nothing
    // bars the way), and settling into one stamped a floating unit over nothing - the user's
    // floating grating box (N18O). The repair rebuilds bottom-up, so the bed returns first.
    function bedStands(b, core) {
      let n = 0;
      for (let x = core.x - 6; x <= core.x + 6; x += 1) {
        for (let y = core.homeY + 7; y <= core.homeY + 12; y += 1) {
          if (PW.getOwner(world, x, y) === b.id) { n += 1; break; }
        }
      }
      return n >= 4;
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
    // The god's gift does not die quietly (the user's rule): a ball whose last core cell is
    // destroyed detonates - a real blast and a burst of white sparks. Alive again (rebuilt by
    // repair), it may die again another day.
    function deathWatch() {
      const watch = (holder, x, y, big, id) => {
        let alive = false;
        for (let dy = -3; dy <= 3 && !alive; dy += 1) for (let dx = -3; dx <= 3 && !alive; dx += 1) {
          if ((PW.get(world, x + dx, y + dy) & ID_MASK) === M.CORE) alive = true;
        }
        if (alive) { holder.wasAlive = true; holder.dead = false; return; }
        if (!holder.wasAlive || holder.dead) return;
        holder.dead = true;
        if (PW.explode) PW.explode(world, particles, { x, y, radius: big ? 30 : 18, power: big ? 2 : 1.3 });
        if (world.pipes && world.pipes.notifyDamage) world.pipes.notifyDamage(x - 46, x + 46);
        if (particles && F) {
          for (let i = 0; i < 14; i += 1) {
            const h = PW.hash3(x, i, tick), a = (i / 14) * Math.PI * 2;
            particles.spawn(x + 0.5, y + 0.5, Math.cos(a) * (90 + (h & 63)), Math.sin(a) * (90 + (h >> 6 & 63)), M.DEBRIS | 3 << 6, 0, F.LAND, 6);
          }
        }
        if (id && world.onDamage) world.onDamage(id);
      };
      for (const b of world.buildings || []) {
        for (const core of b.cores || []) {
          if (core.standing) continue;
          watch(core, core.x, core.y, !!core.orb, b.id);
        }
      }
      for (const s of world.seedCores || []) if (!s.building) watch(s, s.x, s.y, false, 0);
    }
    function step() {
      tick += 1;
      if (tick % 30 === 17) deathWatch();
      // (a planted seed core over sunk or blown-out ground comes down whole too)
      for (const s of world.seedCores || []) {
        if (s.building) continue;
        if (s.checkSupport || tick % 15 === 7) { s.checkSupport = 0; for (let n = 0; n < 3 && fall(s); n += 1); }
      }
      // D15: the ball's white energy is a real Game of Life (PS's half in pw-life) - every
      // drawn ball steps its disc each tick: agitated out of its vault, at rest at home.
      if (PW.coreLife) {
        for (const s of world.seedCores || []) if (!s.building && !s.dead) PW.coreLife.step(world, s, 1);
        for (const b of world.buildings || []) {
          for (const core of b.cores || []) {
            if (core.standing || core.dead) continue;
            PW.coreLife.step(world, core, !core.settled && b.coresOpen ? 2 : 1);
          }
        }
      }
      for (const b of world.buildings || []) {
        if (!b.cores || !b.cores.length) continue;
        // (a building still going up for the first time is no ruin to expose - its cores are
        // already home in fresh beds; the flag drops once it first stands all but whole)
        if (b.underConstruction && (b.health || 0) >= 0.9) b.underConstruction = false;
        if (b.ruined && !b.coresOpen && !b.underConstruction) expose(b);
        // N18O support checks. A settled unit whose vault floor is gone from under it is given
        // up by the vault: its ball is freed and managed again (and falls whole just below).
        // A free ball over nothing comes down whole - marked by the sag's supportLost, and
        // looked at on its own every quarter second for the blast cases.
        for (const core of b.cores) {
          if (core.orb) continue;
          // A unit that is the building's - pristine (never risen: homeY unset) or settled -
          // gives its ball up when the vault floor is gone from under it.
          const partOf = core.settled || core.homeY === undefined;
          if (partOf && core.checkSupport) {
            core.checkSupport = 0;
            // The unit is held while its own bed still stands under the ball - a rigid deck
            // spanning a hollow is support (the sag leaves made solids standing). Only when
            // the bed itself is gone from under the ball is the ball given up.
            let bears = 0;
            for (let x = core.x - 6; x <= core.x + 6; x += 1) {
              for (let y = core.y + 2; y <= core.y + 12; y += 1) {
                const id = PW.get(world, x, y) & ID_MASK;
                // (the cradle, the bed, rubble, anything - but never the ball's own matter)
                if (id !== M.AIR && id !== M.CORE && PW.mat.phase[id] > PW.PHASE.GAS) { bears += 1; break; }
              }
            }
            if (bears < 4) {
              core.settled = false; core.free = false;
              if (core.homeY === undefined) core.homeY = core.y;
              const c = columnOf(core);
              for (let y = c.top; y <= c.bottom; y += 1) for (let x = c.x0; x <= c.x1; x += 1) {
                if ((PW.get(world, x, y) & ID_MASK) === M.CORE && PW.getOwner(world, x, y) === b.id) PW.setOwner(world, x, y, 0);
              }
              if (!b.coresOpen) b.coresOpen = tick;
              core.checkSupport = tick;   // (the freed ball looks down next step and falls)
              if (world.onDamage) world.onDamage(b.id);
            }
          } else if (!partOf && core.checkSupport) {
            // (event-driven only: the sag's re-check and the blast wrapper call supportLost.
            // A periodic look while free re-read the collapse's churning rubble as voids and
            // dropped balls into pockets, dancing them against the rise - the suites caught it)
            core.checkSupport = 0;
            let fell = 0;
            while (fell < 3 && fall(core)) fell += 1;
            if (fell === 3) core.checkSupport = tick;   // still falling: carry on next tick
          }
        }
        // A free core goes home as soon as its vault region is rebuilt and clear - the repair
        // works from the bottom up, so the bed is ready long before the ruin is over. Near home
        // it sinks row by row; from high up, or where its own rebuilt storeys stand in the way,
        // its field carries it home in one move (the settle snap). It only descends towards a
        // vault that is READY: sinking blind at an unready one buried it, the sweep un-freed
        // it, rise dug it back to the open, and it traded the same three rows for ever (PS's
        // trace of the no-hinge seed-7 stall - the loop was 1803F/1806/1803F once a second).
        // Standing exposed, it holds its ground until the repair opens the way.
        if (b.coresOpen && tick % 2 === 0) {
          for (const core of b.cores) {
            if (core.orb || !core.free) continue;
            // D15: risen clear of the wreck, the ball FLOATS two seconds - its Life burning
            // bright - before it will descend towards a ready vault. (A ball that fell past
            // its home still settles at once: hovering over a void is the old glitch.)
            if (core.y < core.homeY && tick - (core.freeAt || 0) < FLOAT_HOLD) continue;
            // (at or below home - a sink arrived, or a fall carried it past (N18O): it settles
            // whenever there is a bed to sit on - a wreck-filled vault is still home, as it
            // always was - but never onto NOTHING: settling over a void stamped the floating
            // grating box of the user's screenshot)
            if (core.y >= core.homeY) { if (bedStands(b, core)) settle(b, core); continue; }
            if (core.y < core.homeY && core.homeY - core.y <= 30 && homeOpen(b, core) && bedStands(b, core) && sink(b, core)) continue;
            if (homeOpen(b, core) && bedStands(b, core)) settle(b, core);
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
          // (a ball that FELL below its home (N18O) climbs back the way it came - the rise
          // rule below serves for that too: up through the void and its own wreck towards
          // the vault, where the go-home branch settles it once the bed stands again)
          if (!core.free && tick % RISE_EVERY === 0) {
            if (exposed(core) || !rise(b, core)) {
              core.free = true;
              core.freeAt = tick;   // (D15: the two-second float starts here)
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
    // The ball lives (the user's design): two white points orbit it like an atom's electrons on
    // crossed ellipses, and every so often a streak of lightning snaps off a pole and dies away.
    // Drawn over the world each frame for the cores in view.
    function draw(renderer, time) {
      const { ctx, camera, view } = renderer;
      const z = camera.zoom;
      if (z < 0.5) return;
      const t = time * 0.001;
      const put = (wx, wy, c, a) => {
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
        ctx.fillRect(Math.round((wx - camera.x) * z), Math.round((wy - camera.y) * z), Math.max(1, Math.round(z)), Math.max(1, Math.round(z)));
      };
      const vx0 = camera.x - 20, vx1 = camera.x + view.width / z + 20, vy0 = camera.y - 20, vy1 = camera.y + view.height / z + 20;
      const WHITE = [238, 242, 246], DIM = [168, 174, 180];
      // N38: the white energy is a LIGHT EQUATION, not scripted sprites - a standing-wave
      // field over the ball whose interference breathes and orbits like an atom's shells:
      //   I(r, th, t) = |sin(k r - w t)| * |cos(m th + phi(t))| * pole(th)
      // radial vibration x angular lobes, the lobes slowly precessing, everything brighter
      // towards the poles (the god's rule: the lightning crowds the poles). Drawn additively
      // per cell of the ball's disc; the old electrons and streaks fall out of the equation
      // itself - bright knots race the shells and spikes stand off the poles.
      const each = (x, y, seed) => {
        const ph = seed * 0.37;
        for (let dy = -8; dy <= 8; dy += 1) {
          for (let dx = -8; dx <= 8; dx += 1) {
            const r = Math.hypot(dx, dy);
            if (r > 8.4 || r < 1.2) continue;
            const th = Math.atan2(dy, dx);
            const radial = Math.sin(r * 1.85 - t * 2.4 + ph);
            const lobes = Math.cos(3 * th + Math.sin(t * 0.6 + ph) * 2.2);
            const pole = 0.45 + 1.25 * Math.pow(Math.abs(Math.sin(th)), 3);
            let I = Math.abs(radial) * Math.abs(lobes) * pole * Math.max(0, 1 - r / 9);
            if (I < 0.34) continue;
            I = Math.min(1, I);
            put(x + dx, y + dy, I > 0.72 ? WHITE : DIM, I * I);
          }
        }
        // (a vibration spike off a pole now and then: the equation's overdriven moment)
        const phase = Math.floor(t * 2.3) + seed;
        if (((Math.imul(phase, 2654435761) >>> 27) & 7) < 2) {
          const up = (phase & 1) ? -1 : 1;
          const aa = up * Math.PI / 2 + (((Math.imul(phase, 40503) >>> 24) / 255) - 0.5) * 0.9;
          for (let s = 3; s <= 9; s += 1) {
            const j = ((PW.hash3(phase, s, seed) & 3) - 1.5) * 0.6;
            put(x + Math.cos(aa) * s + Math.cos(aa + Math.PI / 2) * j, y + Math.sin(aa) * s + Math.sin(aa + Math.PI / 2) * j, WHITE, 1 - (s - 3) * 0.12);
          }
        }
      };
      // D15: with the Life half standing, the white IS the simulation - the old light
      // equation only serves where pw-life is absent (the gallery pages).
      for (const b of world.buildings || []) {
        for (const core of b.cores || []) {
          if (core.standing || core.dead) continue;
          if (core.x < vx0 || core.x > vx1 || core.y < vy0 || core.y > vy1) continue;
          if (PW.coreLife) PW.coreLife.draw(renderer, core);
          else each(core.x, core.y, (core.x * 7 + core.y) & 1023);
        }
      }
      for (const s of world.seedCores || []) {
        if (s.building || s.dead || s.x < vx0 || s.x > vx1 || s.y < vy0 || s.y > vy1) continue;
        if (PW.coreLife) PW.coreLife.draw(renderer, s);
        else each(s.x, s.y, (s.x * 7 + s.y) & 1023);
      }
    }
    const api = { step, expose, exposed, supportLost, stats, draw };
    world.cores = api;
    return api;
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
