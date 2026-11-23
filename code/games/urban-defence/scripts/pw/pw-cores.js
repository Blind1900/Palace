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
  const CLEAR_RISE = 50;    // N86: once clear of the wreck the ball climbs on - at least this many
                            // rows above the rubble over it (the user's 50 px at the default zoom,
                            // 1.0: one cell per pixel) - before it frees to float
  const BLOCKED_HOLD = 180; // N86: ticks a rising ball presses against what bars its way before it frees there (3 s)
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
    // N86: the open drop under the ball - the fewest open rows below any of its body columns
    // before the first thing that bears (the rubble's highest point under it).
    function gapBelow(core) {
      let gap = Infinity;
      for (const [x, , hi] of spans(core)) {
        if (Math.abs(x - core.x) > 7) continue;
        let n = 0;
        while (n <= CLEAR_RISE && PW.mat.phase[PW.get(world, x, hi + 1 + n) & ID_MASK] <= PW.PHASE.GAS) n += 1;
        if (n < gap) gap = n;
      }
      return gap === Infinity ? 0 : gap;
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
      core.sunk = (core.sunk || 0) + 1;   // (the travelled descent, apart from any fall)
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
    // ---- N87: the bed follows the surface ---------------------------------------------------
    // A ball floating over its wreck does not wait for its old bed to come back. Once the wreck
    // has come to rest it lays a NEW bed flush with the ground as it now lies - up on a rubble
    // heap, down in a crater - and the building is re-founded there: its blueprint moves to the
    // new ground line, the rubble under the new footprint is packed into made ground, the gift
    // below the ground line (beds, vaults, footings) is set whole as a seed's is, the bundle
    // re-threads to the new beds, and the repair raises the body from them. The ball then comes
    // down into its new vault at the speed it rose (N86). Blasted again, the cycle runs again.
    const REFOUND_LOOK = 30, REFOUND_QUIET = 4;   // PS's at-rest recipe: a look every 30 ticks, 4 quiet in a row (2 s)
    const REFOUND_GIVE_UP = 60 * 60;   // a lot too wild or flooded for a minute: the old bed is rebuilt instead
    // (flags=REFOUND_BEDS:0 keeps the old beds - for scenes that study the wreck itself)
    const refoundable = (b) => PW.REFOUND_BEDS !== false && !!b.canvas && !b.pit && !b.runway && !b.shaft
      && (b.cores || []).some((q) => !q.orb && !q.standing) && !(b.cores || []).some((q) => q.orb);
    // The ground as it now lies under the building's body: per column the first cell down that
    // is not open, not a ball, and not a standing remnant of the building itself (those are
    // razed) - and its median as the new ground line.
    function surfaceOf(b) {
      const tops = [];
      let wet = false;
      for (let x = b.body.left; x <= b.body.right; x += 1) {
        let y = Math.max(1, b.body.top - 6);
        for (; y < b.ground + 140 && y < world.height - 2; y += 1) {
          const id = PW.get(world, x, y) & ID_MASK;
          if (PW.mat.phase[id] <= PW.PHASE.GAS) continue;
          if (id === M.CORE && !PW.getOwner(world, x, y)) continue;
          if (PW.getOwner(world, x, y) === b.id) continue;
          if (id === M.WATER) wet = true;
          break;
        }
        tops.push(y);
      }
      if (!tops.length) return null;
      const sorted = [...tops].sort((p, q) => p - q);
      return { G: sorted[sorted.length >> 1], lo: sorted[0], hi: sorted[sorted.length - 1], wet, tops };
    }
    function refound(b, G) {
      const dy = G - b.ground;
      const c = b.canvas;
      // (N100: the ground the building first stood on - the heap above it is the cores' to eat)
      if (b.homeGround === undefined) b.homeGround = b.ground;
      const isBundle = (x, y) => (PW.get(world, x, y) & ID_MASK) === M.PIPE || (PW.getFlags(world, x, y) & PW.FLAG.HOLLOW);
      const tunnel = (x, y) => (PW.getFlags(world, x, y) & PW.FLAG.TUNNEL) !== 0;
      // 1. What stands of the old building is its wreck now: above the new ground line it is
      // shattered (the crews recycle it as they build); below it, it is packed into the made
      // ground with the heap - left standing as unowned structure under the new footing, the
      // judges took it for wreck and crumbled it, and the rubble ran out from under the slab.
      // (the whole lot round it, not just the old blueprint's box: pieces of the tower flung
      // out as it fell still answer to it, and taken for footing they crumbled out from under
      // the new slab later)
      let packed = 0;
      const wx0 = Math.max(1, b.ox - 96), wx1 = Math.min(world.width - 2, b.ox + c.width + 96);
      const wy0 = Math.max(1, Math.min(b.oy, G - c.ground) - 20), wy1 = Math.min(world.height - 2, Math.max(b.oy, b.oy + dy) + c.height + 40);
      for (let y = wy0; y <= wy1; y += 1) {
        for (let x = wx0; x <= wx1; x += 1) {
          if (PW.getOwner(world, x, y) !== b.id) continue;
          const id = PW.get(world, x, y) & ID_MASK;
          if (id === M.CORE || isBundle(x, y)) continue;
          if (y < G - 2) {
            if (PW.mat.structural[id]) PW.set(world, x, y, PW.mat.breaksTo[id] || M.DEBRIS, { quiet: true });
          } else if (PW.mat.phase[id] > PW.PHASE.GAS && id !== M.WATER) {
            PW.set(world, x, y, M.FILL, { quiet: true, keepPaint: true });
            packed += 1;
          }
          PW.setOwner(world, x, y, 0);
        }
      }
      // 2. The new placement: the same blueprint, its ground row on the surface.
      const fresh = PW.buildingRecord(world, { canvas: c, x: b.ox, y: b.oy + dy }, {});
      if (b.y === b.oy) b.y += dy;
      for (const key of ['oy', 'ground', 'body', 'floors', 'stairs', 'doors', 'slots', 'panels', 'devices', 'windows', 'storage', 'hatches', 'gates', 'hangar', 'floating']) b[key] = fresh[key];
      b.cores.forEach((core, i) => {
        const f = fresh.cores[i];
        if (!f) return;
        core.vault = f.vault;
        core.homeY = f.y;
        // (a ball the blast destroyed is LOST: its new vault stays empty - re-seeding it is a
        // later slice. Redrawn whole at the new home by the re-seat, it was taken for a dying
        // ball when its cells went, and its death blast tore the new footing.)
        if (!core.orb && !core.standing && !spans(core).length) { core.lost = true; core.dead = true; core.free = false; }
      });
      if (b.base) {
        b.base.G = (b.base.G ?? G - dy) + dy;
        if (b.base.cores) b.base.cores = b.base.cores.map((q) => ({ x: q.x, y: q.y + dy }));
      }
      // 3. The gift below the ground line is set whole at the new level, the cradle with it (the
      // bed the ball comes down onto) - only the ball's own place and its grating left open.
      for (let ly = Math.max(0, c.ground - 2); ly < c.height; ly += 1) {
        const wy = b.oy + ly;
        if (wy < 1 || wy >= world.height - 1) continue;
        for (let lx = 0; lx < c.width; lx += 1) {
          const wx = b.ox + lx, i = ly * c.width + lx;
          if (wx < 1 || wx >= world.width - 1) continue;
          if (!c.mat[i] && !c.back[i]) continue;
          const role = c.role[i];
          if (role === 15 || role === 8) continue;   // GRATE, CORE
          if (isBundle(wx, wy) || tunnel(wx, wy)) continue;
          if (c.mat[i]) {
            PW.set(world, wx, wy, c.mat[i], { quiet: true, keepPaint: true });
            PW.setLayer(world, 'paint', wx, wy, c.paint[i]);
          } else {
            const now = PW.get(world, wx, wy) & ID_MASK;
            if (now !== M.AIR && now !== M.WATER) PW.set(world, wx, wy, M.AIR, { quiet: true });
          }
          if (c.back[i]) PW.setLayer(world, 'back', wx, wy, c.back[i]);
          PW.setLayer(world, 'deco', wx, wy, c.deco[i]);
          PW.setOwner(world, wx, wy, b.id);
        }
      }
      // 4. The ground under it is packed into made ground: under every cell of the gift down to
      // the first firm natural ground (the loose heap and the old basements' hollows alike), and
      // beside the body a flank sloping away at 45 degrees - a mound, not a block with sheer
      // sides. Never a tunnel, the bundle or water, and never on past firm ground into a cave.
      // (deep is soft: past it the packing carries on while the column is still loose or open -
      // a blast from below leaves its ejecta lying at the foot of its cavity, and left loose it
      // settled and the packed column above sank a row from under the slab)
      // (down to `deep` every open pocket under the lot is backfilled, however much ground lies
      // over it - a blast from below leaves its cavity there, and the ground over it subsided
      // with the footing on it. Natural caves lie far deeper - 220 rows under the surface at the
      // least - and the dug tunnels are flagged and passed by.)
      const reach = 64, deep = Math.max(G, b.ground - dy) + 100, deepest = Math.max(G, b.ground - dy) + 200;
      const x0 = Math.min(b.body.left, b.ox) - reach, x1 = Math.max(b.body.right, b.ox + c.width - 1) + reach;
      for (let x = Math.max(1, x0); x <= Math.min(world.width - 2, x1); x += 1) {
        // (the line the fill comes up to: the ground line in any column the gift stands in -
        // every hollow round and under its piers packed, its own cells and rooms left as they
        // are - and beside it the 45-degree flank)
        let gift = false;
        for (let y = G - 2; y <= deep && !gift; y += 1) if (PW.getOwner(world, x, y) === b.id) gift = true;
        const top = gift ? G - 2 : G + (x < b.body.left ? b.body.left - x : x > b.body.right ? x - b.body.right : 0);
        // (the deepest open pocket in this column within `deep`, read once)
        let lowestPocket = -1;
        for (let y = Math.min(deep, world.height - 3); y > top; y -= 1) {
          if (PW.mat.phase[PW.get(world, x, y) & ID_MASK] <= PW.PHASE.GAS && !tunnel(x, y) && !isBundle(x, y) && PW.getOwner(world, x, y) !== b.id) { lowestPocket = y; break; }
        }
        for (let y = top; y <= deepest && y < world.height - 2; y += 1) {
          const id = PW.get(world, x, y) & ID_MASK;
          if (y > deep && id !== M.FILL && !LOOSE[id] && PW.mat.phase[id] > PW.PHASE.GAS) break;
          if (PW.getOwner(world, x, y) === b.id) continue;   // (the gift itself)
          if (id === M.WATER) continue;
          // (a live tunnel's open way and the bundle's live bore are left as they are; a tunnel
          // or a blasted bore the collapse choked with rubble is packed with the rest - left
          // loose, it slumped down its shaft from under the slab; the regrowth lays its pipe anew)
          if ((tunnel(x, y) || isBundle(x, y)) && !LOOSE[id]) continue;
          if (PW.getFlags(world, x, y) & PW.FLAG.HOLLOW) PW.setFlag(world, x, y, PW.FLAG.HOLLOW, false);
          if (id === M.FILL) continue;   // (made ground already - packed remains, the bundle's bed)
          if (!LOOSE[id] && PW.mat.phase[id] > PW.PHASE.GAS) {
            // Firm natural ground ends the column - unless an open pocket still lies under it
            // within `deep` (a blast cavity: seed 11's crater subsided into one after the packing,
            // the footing with it). The ground over it is passed through and the pocket packed.
            if (lowestPocket <= y) break;
            continue;
          }
          if (LOOSE[id]) packed += 1;
          const paint = PW.getLayer(world, 'paint', x, y);
          PW.set(world, x, y, M.FILL, { quiet: true });
          if (LOOSE[id] && paint) PW.setLayer(world, 'paint', x, y, paint);
          PW.setOwner(world, x, y, 0);
        }
        if (PW.refreshGroundTop) PW.refreshGroundTop(world, x, Math.max(0, G - 260));
      }
      // N100: the mound is the wreck's still - packed hard enough to bear the footing (loose
      // rubble packed there, PS's judges broke it loose from under the slab), but it is the heap
      // the crews eat into the rebuild, two for one, as the building comes down through it to the
      // ground it first stood on (pw-repair). Where FILL was left for good, the tower stood on a
      // hill, and the next collapse heaped a higher one on it - the user's mountain.
      const was = b.mound;
      b.mound = { x0: Math.max(1, x0), x1: Math.min(world.width - 2, x1) };
      if (was) { b.mound.x0 = Math.min(b.mound.x0, was.x0); b.mound.x1 = Math.max(b.mound.x1, was.x1); }
      // 5. The bundle lets go of the old beds and threads the new ones.
      const P = world.pipes;
      // (N100: let go by the line's side - releaseBuilding(side, id); called with the id alone it
      // let go of nothing, and the beds were threaded twice)
      const sides = new Set();
      if (P && P.releaseBuilding && P.lines) for (const l of P.lines) if (l.cores.some((q) => q.building === b.id)) sides.add(l.side);
      for (const side of sides) {
        P.releaseBuilding(side, b.id);
        const taps = P.TAPS && P.TAPS[b.type];
        for (const core of b.cores) {
          if (core.orb || core.standing || !core.vault) continue;
          P.connectCore(core.x, core.homeY, side, taps, b.id);
        }
      }
      // 6. The crews start over from the new placement; the judges look again.
      // (N100: the packed heap is no credit any more - the crews spend the heap itself, cell by cell)
      if (world.repair && world.repair.refit) world.repair.refit(b.id, 0);
      else if (world.repair) world.repair.notify(b.id);
      if (world.onDamage) world.onDamage(b.id);
      if (world.structure && world.structure.urgent) world.structure.urgent(b.id);   // (PS: judged afresh at once)
      b.refounded = (b.refounded || 0) + 1;
      b.refoundedAt = tick;
      stats.refounded = (stats.refounded || 0) + 1;
    }
    // Every half second while the balls float: is the wreck at rest, and the lot gentle and dry?
    // Then re-found (or, where the surface is the old ground line still, just go home).
    function lookToRefound(b) {
      const done = () => { b.refoundFor = b.coresOpen; b.refoundQuiet = 0; b.refoundSince = undefined; b.refoundTops = null; b.refoundG = undefined; b.refoundSteady = 0; b.refoundPending = false; };
      if (b.refoundSince === undefined) b.refoundSince = tick;
      // (a wreck that never settles, a lot too wild or flooded, a ball that never gets out: after
      // a minute the old bed is rebuilt as it always was - no ball hangs in the sky for good)
      if (tick - b.refoundSince > REFOUND_GIVE_UP) { b.refoundWait = `gave up (${b.refoundWait})`; done(); return; }
      // (every live ball out and through its float first - a ball destroyed, or blown apart to
      // nothing in a blast from below, is not waited for)
      const balls = b.cores.filter((q) => !q.orb && !q.standing && !q.dead && spans(q).length);
      if (!balls.length) { done(); return; }
      if (!balls.every((q) => q.free && tick - (q.freeAt || 0) >= FLOAT_HOLD)) { b.refoundWait = 'balls rising'; return; }
      const s = surfaceOf(b);
      if (!s) return;
      const top = Math.min(s.lo, b.ground) - 40, bottom = Math.max(s.hi, b.ground) + 40;
      // At rest, judged on the solids (PS's recipe, the chunk half swapped for the heap's own
      // profile: smoke drifting over the heap keeps its chunks awake long after the rubble has
      // stopped): no stability look pending in the box, no falling piece in it, and the
      // surface under the body unchanged since the last look.
      const x0 = b.body.left, x1 = b.body.right;
      // (stability is asked about the heap itself - the lot's own columns from just over the heap
      // down - and the balls' columns are left out: a floating ball's field sweeps the grit that
      // lands on it every few ticks, and a neighbour's crews and judges at work beside the lot
      // keep stability looking there for as long as they work; neither is the wreck moving)
      const skip = balls.map((q) => [q.x - REACH - 6, q.x + REACH + 6]).sort((p, r) => p[0] - r[0]);
      let settlingNow = false;
      if (world.stability && world.stability.settling) {
        let from = x0;
        for (const [a, z] of [...skip, [x1 + 1, x1 + 1]]) {
          const to = Math.min(x1, a - 1);
          if (to >= from && world.stability.settling(from, s.lo - 2, to, bottom)) { settlingNow = true; break; }
          from = Math.max(from, z + 1);
        }
      }
      let still = !settlingNow, piece = false;
      const fr = world.fragments;
      if (fr) for (const p of fr.list) {
        const cs = Math.cos(p.angle), sn = Math.sin(p.angle), cx = p.px + p.gx * cs - p.gy * sn, cy = p.py + p.gx * sn + p.gy * cs;
        if (cx >= x0 && cx <= x1 && cy >= top && cy <= bottom) { piece = true; still = false; break; }
      }
      // (the heap as a whole has stopped - its median within a row of the last look, and no
      // more than a few of its columns shifting more than two cells - though grains still land
      // and trickle at its edges; a slump into a void under it is still moving)
      const prev = b.refoundTops, prevG = b.refoundG;
      b.refoundTops = s.tops;
      b.refoundG = s.G;
      const moved = prev && prev.length === s.tops.length ? s.tops.filter((y, i) => Math.abs(y - prev[i]) > 2).length : Infinity;
      const steady = moved <= Math.max(2, s.tops.length * 0.05) && Math.abs(s.G - (prevG ?? -1e9)) <= 1;
      if (!steady) still = false;
      // (a heap that has held its shape for four seconds with nothing falling onto it is at rest,
      // whatever bookkeeping stability still has queued round it)
      b.refoundSteady = steady ? (b.refoundSteady || 0) + 1 : 0;
      if (b.refoundSteady >= REFOUND_QUIET * 2 && !piece) still = true;
      b.refoundLook = { settling: settlingNow, piece, moved, dG: s.G - (prevG ?? s.G), steady: b.refoundSteady };
      b.refoundQuiet = still ? (b.refoundQuiet || 0) + 1 : 0;
      if (b.refoundQuiet < REFOUND_QUIET) { b.refoundWait = 'wreck moving'; return; }
      // (a flooded crater waits for its water to go; an uneven heap is levelled at its median -
      // the proud rubble the crews recycle, the dips under the beds are packed)
      if (s.wet) { b.refoundWait = 'flooded'; return; }
      b.refoundWait = '';
      if (Math.abs(s.G - b.ground) > 2) refound(b, s.G);
      done();
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
          if (core.standing || core.lost) continue;
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
            // (a ball floating over its home is held by its own field - D15/N86: it rose clear of
            // the wreck to float there, and over a crater that clearance IS open air; only a ball
            // that has come below its home falls whole)
            if (core.free && core.homeY !== undefined && core.y < core.homeY) continue;
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
        // N86: the descent runs at the RISE'S OWN PACE - every tick, one row (the user's
        // rule: back down at the same speed it went up). The old half-rate gate and the
        // 30-row snap-home are gone: the ball TRAVELS down whenever home is ready and the
        // way is open, and the field carries it (settle) only when a sink step is blocked.
        // N87: while its balls float, the building waits for its wreck to come to rest, then
        // re-founds at the surface as it now lies (or finds it the old ground line still).
        const refounding = b.coresOpen && b.refoundFor !== b.coresOpen && refoundable(b);
        // (the crews keep off the heap from the moment the balls are out until the bed is decided)
        b.refoundPending = !!refounding && (b.cores || []).some((q) => !q.orb && !q.standing && !q.settled);
        if (refounding && tick % REFOUND_LOOK === 0) lookToRefound(b);
        if (b.coresOpen && tick % RISE_EVERY === 0) {
          for (const core of b.cores) {
            if (core.orb || !core.free) continue;
            if (refounding && b.refoundFor !== b.coresOpen) continue;   // (floating until the bed is decided)
            // D15: risen clear of the wreck, the ball FLOATS two seconds - its Life burning
            // bright - before it will descend towards a ready vault. (A ball that fell past
            // its home still settles at once: hovering over a void is the old glitch.)
            if (core.y < core.homeY && tick - (core.freeAt || 0) < FLOAT_HOLD) continue;
            // (at or below home - a sink arrived, or a fall carried it past (N18O): it settles
            // whenever there is a bed to sit on - a wreck-filled vault is still home, as it
            // always was - but never onto NOTHING: settling over a void stamped the floating
            // grating box of the user's screenshot)
            if (core.y >= core.homeY) { if (bedStands(b, core)) settle(b, core); continue; }
            if (homeOpen(b, core) && bedStands(b, core)) {
              if (sink(b, core)) continue;   // travelling down, a row a tick
              settle(b, core);               // blocked mid-way with home ready: the field takes it the rest
            }
          }
        }
        // The vaults close only once the ruin is over (while it stands, closing them would only
        // re-trigger expose and blow the gratings off again); until then settled cores simply
        // wait at home, part of the building again, while the rebuild climbs.
        if (b.coresOpen && !b.ruined && (b.cores || []).every((q) => q.orb || q.settled || q.lost)) {
          b.coresOpen = 0;
          b.coresHome = tick;   // home and alive: the fine work carries on from below
          if (world.repair) world.repair.notify(b.id);
          continue;
        }
        if (!b.coresOpen || tick - b.coresOpen < SETTLE) continue;
        for (const core of b.cores) {
          if (core.orb || core.settled || core.lost) continue;   // (the base's main core already stands in its open pit; a settled core is the building's again; a lost one is gone)
          // (a ball that FELL below its home (N18O) climbs back the way it came - the rise
          // rule below serves for that too: up through the void and its own wreck towards
          // the vault, where the go-home branch settles it once the bed stands again)
          if (!core.free && tick % RISE_EVERY === 0) {
            // N86: clear of the wreck the ball CLIMBS ON - at least CLEAR_RISE rows above
            // the rubble that covered it (the user's 50 px) - and only then frees to
            // float. Blocked overhead it frees where it stands: obstruction caps the climb.
            // (measured as the open gap under the ball itself, not rows counted while climbing:
            // a tower still coming down round a rising ball heaps up under it as it goes, and a
            // count let it free 25 cells over a heap that had caught up)
            const clear = exposed(core);
            if (clear && gapBelow(core) >= CLEAR_RISE) {
              core.free = true;
              core.freeAt = tick;   // (D15: the two-second float starts here)
              core.blockedSince = 0;
              core.capped = '';
              // (what the gratings and the core held up is looked at again, and comes down)
              if (world.onDamage) world.onDamage(b.id);
            } else if (rise(b, core)) {
              core.blockedSince = 0;
            } else {
              // Blocked overhead - most often its own building still coming down over it. It
              // keeps pressing a few seconds for the way to open; only then does the obstruction
              // cap the climb and the ball free where it stands.
              if (!core.blockedSince) core.blockedSince = tick;
              if (tick - core.blockedSince >= BLOCKED_HOLD) {
                core.free = true;
                core.freeAt = tick;
                core.blockedSince = 0;
                core.capped = core.stopped;   // (what capped its climb, for the record)
                if (world.onDamage) world.onDamage(b.id);
              }
            }
          } else if (core.free) {
            // N86: while it floats - before its way down is decided - it keeps station at least
            // CLEAR_RISE over the rubble: a heap still settling up under it lifts it again, at the
            // pace it rose (once it is coming down, the approach to its bed is its own business).
            const hovering = core.y < (core.homeY ?? core.y + 1) && (b.refoundPending || tick - (core.freeAt || 0) < FLOAT_HOLD);
            if (hovering && tick % RISE_EVERY === 0 && gapBelow(core) < CLEAR_RISE) rise(b, core);
            if (tick % SWEEP_EVERY === 0) {
              sweep(b, core);
              // (buried again by the heap slumping onto it, it rises again)
              // (checked every third of a second: heaps of rubble can rain down on it at any time)
              if (tick % (SWEEP_EVERY * 2) === 0 && !exposed(core)) core.free = false;
            }
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
