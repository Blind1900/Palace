'use strict';
// N44: capital growth. A dropped seed grows a settlement over lab time: a capital raises rings of
// population towers (newest ring loosest, the centre tightening as the city levels - N43 - and the
// skyline falling off from tall centre to low edge - N45); a farm spreads crop fields across the
// flatland, with lesser plank bridges over small water and never through mountains (N46); a
// military seed digs in where it stands. Cities stay cut off from water bodies and mountains until
// they reach a high enough level (N44), then capitals bridge the water and climb the flanks.
// The buildings are the real kit canvases seated by PW.foundations.place, so they look exactly as
// they do in the game. This module is the growth system's first slice: the lab drives it by hand,
// the game will drive it from seeds.
(function () {
  const PW = window.PW;
  const { M, FLAG } = PW;
  const Q = { quiet: true };

  const GROW_EVERY = 3.2;        // growth-seconds between a city's actions
  const MAX_LEVEL = 7;
  const UNLOCK = 5;              // N44: capitals cross water / climb mountains from this level
  const TUNNEL_MAX = 560;        // N3: longest drive the crews bore through a mountain
  const TUNNEL_CLEAR = 38;       // ...headroom over its floor: the tallest hull and its margin
  const FARM_BRIDGE_LEVEL = 3;   // N46: farms bridge small water from this level...
  const FARM_BRIDGE_MAX = 72;    // ...and only this narrow (a lesser bridge)
  const CAPITAL_BRIDGE_MAX = 1400;
  const TIGHTEN = 3, GAP_MIN = 7;    // N43: gaps tighten toward the centre as the city levels
  const GAP0 = 12, GAP_RING = 9;     // (fallback only: lots carry their own gap now - N51)
  const APPEND_EVERY = 110;      // growth-seconds before a side's edge creeps out another ring
  const INFILL_EVERY = 160;      // growth-seconds between looks for a gap worth filling in (N51)
  const AGE_PER_LEVEL = 140;     // N48: a building levels up as it stands - one level per this much age
  // N54: growth shapes the ground. A spreading town or farm regrades the span ahead into one
  // straight slope - built along the original shape - but only while the work is modest.
  const GRADE = { maxSlope: 0.5, maxMove: 26 };         // a town's earthworks (streets take a 1-in-2)
  const FARM_GRADE = { maxSlope: 0.4, maxMove: 20 };    // a farm's lighter ones
  const CLAIM = 46;              // land a city claims beyond its built edge (where merges happen)
  const RIPEN = 1 / 260;         // crop growth per growth-second: a field ripens in ~4 lab minutes

  function createCapitalGrowth(world, opts = {}) {
    const T = PW.buildingTypes;
    const ST = PW.settlementTools;
    const cities = [];
    const flashes = [];
    const dbg = [];
    const rand = PW.createRandom((opts.seed || 1) + 4242);
    let seedN = (opts.seed || 1) * 31 + 7;
    // N4 (first slice): a faction city's growth is paid for and paced by what the bundle
    // actually delivers to its side's stock - HM pays for the works, and the levels only
    // rise at full pace while the city is watered and fed. The lab's sandbox cities carry
    // no faction and grow free, as a design lab should.
    const COST_HM = { lot: 24, level: 50, mil: 40 };
    const RESERVE_HM = 60;       // the war chest the growth never spends into
    const purseOf = (city) => (city && city.faction && world.stock && world.stock[city.faction]) || null;
    function pay(city, kind) {
      const purse = purseOf(city);
      if (!purse) return true;
      const cost = COST_HM[kind] || 0;
      if ((purse.hm || 0) < cost + RESERVE_HM) return false;
      purse.hm -= cost;
      return true;
    }
    const supplied = (city) => { const p = purseOf(city); return !p || ((p.water || 0) >= 20 && (p.sm || 0) >= 20); };

    // ---- N4: the people. Standing towers house population; the people drink and eat from
    // the side's stores on their own clock (farms send SM down the line, pumps send water -
    // the drain is what makes the thresholds LIVE); the fed and watered field the whole
    // workforce, a starved side a skeleton crew. Workers drive the feed: how fast the
    // towers come of age. A world without purses (the lab) runs free, as ever.
    const POP_PER_LEVEL = 6;       // souls a tower houses per level
    const DRINK = 0.004;           // water a soul draws from the stores, per second
    const EAT = 0.0028;            // and soft materials
    const ECON_EVERY = 2;          // seconds between census and consumption passes
    let econClock = 0;
    function economy(dt) {
      econClock += dt;
      if (econClock < ECON_EVERY || !world.stock) return;
      const dtE = econClock;
      econClock = 0;
      const census = {};
      for (const city of cities) {
        if (!city.faction) continue;
        let pop = 0;
        for (const lot of [...city.rings.left, ...city.rings.right, city.main]) {
          if (!lot || !lot.placed || lot.type !== 'population' || lot.mil) continue;
          const b = world.buildings[lot.owner - 1];
          if (!b || !b.canvas || b.underConstruction || b.ruined) continue;
          pop += Math.max(1, lot.level || 1) * POP_PER_LEVEL;
        }
        census[city.faction] = (census[city.faction] || 0) + pop;
      }
      for (const faction of Object.keys(census)) {
        const purse = world.stock[faction] || (world.stock[faction] = { sm: 0, hm: 0, water: 0 });
        purse.pop = census[faction];
        purse.water = Math.max(0, (purse.water || 0) - purse.pop * DRINK * dtE);
        purse.sm = Math.max(0, (purse.sm || 0) - purse.pop * EAT * dtE);
        const fed = (purse.water || 0) >= 20 && (purse.sm || 0) >= 20;
        purse.workers = Math.round(purse.pop * (fed ? 1 : 0.25));
      }
    }

    // ---- Reading the land --------------------------------------------------------------------
    const surf = (x) => (world.surface0 || world.groundTop)[Math.max(0, Math.min(world.width - 1, x))];
    const wetAt = (x) => (PW.get(world, x, world.groundTop[x]) & 63) === M.WATER;
    // Water bodies and mountain flanks, judged once on the natural ground: the barriers growth
    // stops at (N44). Steepness is judged over 16 columns, like ploughable land (about 1 in 1.8).
    function computeBarriers() {
      const out = [], W = world.width;
      for (let x = 8; x < W - 8; x += 1) {
        if (!wetAt(x)) continue;
        let x1 = x; while (x1 < W - 8 && wetAt(x1 + 1)) x1 += 1;
        if (x1 - x >= 8) out.push({ kind: 'water', x0: x - 2, x1: x1 + 2 });
        x = x1;
      }
      let run0 = -1;
      for (let x = 24; x < W - 8; x += 1) {
        const steep = Math.abs(surf(x) - surf(x - 16)) > 9;
        if (steep && run0 < 0) run0 = x - 16;
        if (!steep && run0 >= 0) { if (x - run0 >= 24) out.push({ kind: 'mountain', x0: run0, x1: x }); run0 = -1; }
      }
      if (run0 >= 0) out.push({ kind: 'mountain', x0: run0, x1: W - 9 });
      // A water body's shore can read steep: steep ground overlapping water belongs to the water,
      // so a bridged pond does not leave a phantom mountain behind.
      const waters = out.filter((b) => b.kind === 'water');
      const land = [];
      for (const m of out) {
        if (m.kind !== 'mountain') { land.push(m); continue; }
        let pieces = [[m.x0, m.x1]];
        for (const w of waters) {
          const cut = [w.x0 - 18, w.x1 + 18];
          pieces = pieces.flatMap(([a, b]) => {
            if (cut[1] < a || cut[0] > b) return [[a, b]];
            const kept = [];
            if (cut[0] - 1 > a) kept.push([a, cut[0] - 1]);
            if (cut[1] + 1 < b) kept.push([cut[1] + 1, b]);
            return kept;
          });
        }
        for (const [a, b] of pieces) if (b - a >= 24) land.push({ kind: 'mountain', x0: a, x1: b });
      }
      land.sort((a, b) => a.x0 - b.x0);
      return land;
    }
    const barriers = computeBarriers();
    function barrierIn(xa, xb) {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
      let hit = null;
      for (const b of barriers) if (b.x1 >= x0 && b.x0 <= x1 && (!hit || (b.kind === 'water' && hit.kind !== 'water'))) hit = b;
      return hit;
    }

    // ---- Owners and records ------------------------------------------------------------------
    // Each building owns a slot in world.buildings (structure, cores and blasts find it there).
    // An emptied slot (a dismantled lot) must still look like a building to every engine sweep:
    // pw-structure's collapse walks ALL records reading body/works (a body-less placeholder
    // crashed the frame when the user blasted near a dismantled lot), and analyse/repair read
    // the canvas. The empty record lives far off-world with a one-cell canvas.
    const EMPTY_CANVAS = { width: 1, height: 1, ground: 0, body: { left: 0, right: 0, top: 0, bottom: 0 },
      mat: new Uint16Array(1), back: new Uint32Array(1), deco: new Uint32Array(1), paint: new Uint32Array(1), role: new Uint8Array(1),
      floors: [], stairs: [], doors: [], slots: [], panels: [], cores: [], devices: [], windows: [], storage: [], lamps: [] };
    // (at the world's origin with one cell, NOT off-world: N42O's structure sweep clamps a
    // record's scan box to the world and an off-world box went negative - a crashing array)
    const emptyRecord = (id) => ({ id, canvas: EMPTY_CANVAS, ox: 0, oy: 0, ground: 0,
      cores: [], floors: [], stairs: [], doors: [], slots: [], panels: [], devices: [], windows: [], storage: [],
      health: 0, body: { left: 0, right: 0, top: 0, bottom: 0 }, works: [0, 0] });
    function allotOwner() { const id = world.buildings.length + 1; world.buildings.push(emptyRecord(id)); return id; }

    function clearSimAround(x0, y0, x1, y1) {
      if (!PW.clearSimRect || !world.chunksX) return;
      const CS = world.width / world.chunksX;
      const c0x = Math.max(0, Math.floor(x0 / CS)), c1x = Math.min(world.chunksX - 1, Math.floor(x1 / CS));
      const c0y = Math.max(0, Math.floor(y0 / CS)), c1y = Math.min(Math.ceil(world.height / CS) - 1, Math.floor(y1 / CS));
      for (let cy = c0y; cy <= c1y; cy += 1) for (let cx = c0x; cx <= c1x; cx += 1) PW.clearSimRect(world, cy * world.chunksX + cx);
      if (world.activeList) {
        let keep = 0;
        for (let i = 0; i < world.activeList.length; i += 1) {
          const v = world.activeList[i];
          const x = v % world.width, y = (v / world.width) | 0;
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { if (world.simActive) world.simActive[v] = 0; continue; }
          world.activeList[keep] = v; keep += 1;
        }
        world.activeList.length = keep;
      }
    }

    // ---- Stamping, erasing, moving -----------------------------------------------------------
    // N45: the growth system's own skyline curve - a far wider spread of storeys than the town
    // generator uses, so the centre towers over the low-rise edge. The capital keeps the kit's
    // default: the widest building, not the tallest (N33).
    const skylineStoreys = (level) => Math.max(4, Math.round(1.6 + level * 2.5));
    function canvasFor(city, lot) {
      const level = lot.type === 'military' ? (lot.variant === 'tower' ? Math.max(1, Math.min(6, lot.level)) : Math.max(2, Math.min(5, 1 + lot.level))) :
        lot.type === 'farm' ? Math.max(1, Math.min(7, lot.level)) : Math.max(1, Math.min(7, lot.level));   // N69: farms reach as high as the rest
      const opts = { style: city.style, level, variant: lot.variant, seed: lot.seedN, facing: lot.side === 'left' ? 1 : -1 };
      if (lot.type === 'population' && lot.ring >= 0) opts.storeys = skylineStoreys(level);
      // N33: the capital's seat houses the MAIN core - the heart of the side's core tree.
      if (city.kind === 'capital' && lot.ring === -1 && lot.type === 'population') opts.mainCore = true;
      if (lot.type === 'military') {
        opts.vertical = true;   // N57: taller bases, narrower hangars
        if (city.setting && city.setting !== 'urban') opts.setting = city.setting;   // N59: dressed for its ground
      }

      let cv = T[lot.type](opts);
      // N55/N63: a militarised tower is rebuilt bulkier - armour skin, steel floors, gunmetal,
      // and the grey annex merged on its outward flank (the user's sketch).
      if (lot.mil && lot.type === 'population' && PW.militarise) {
        cv = PW.militarise(cv, city.style, lot.milBoth ? 0 : (lot.side === 'left' ? -1 : 1));
      }
      return cv;
    }
    const bodyWidth = (canvas) => canvas.body.right - canvas.body.left + 1;

    const apronSig = (p) => {
      let sig = 0;
      for (let x = Math.max(2, p.worksL - 18); x <= p.worksL - 2; x += 1) sig += world.groundTop[x];
      for (let x = p.worksR + 2; x <= Math.min(world.width - 3, p.worksR + 18); x += 1) sig += world.groundTop[x];
      return sig;
    };
    // N75: when two same-side cities meet, their pipelines become one - the engine's own
    // merge event is the authoritative touch (the lines trail the cities' edges by their
    // approach spans, so distance alone never closes a welded seam's twin bundles).
    function linkLines(city, other) {
      if (!city || !other || !city.faction || other.faction !== city.faction) return;
      if (world.pipes && world.pipes.unite) world.pipes.unite(city.faction, Math.min(city.x, other.x), Math.max(city.x, other.x));
    }
    // N73: a lot whose building is still rising from its core (its first build job working).
    const stillBuilding = (lot) => {
      const r = lot && lot.owner ? world.buildings[lot.owner - 1] : null;
      return !!(r && r.underConstruction);
    };
    function placeLot(city, lot, centerX) {
      const canvas = lot.canvas || (lot.canvas = canvasFor(city, lot));
      const w = bodyWidth(canvas);
      const worldX = Math.round(centerX - canvas.body.left - w / 2);
      // N3: no lot seats over a mountain drive - its terracing and aprons reach ~30 cells
      // past the body and would chew the road's earthworks (the seatChain's transient
      // re-seats did exactly that). The drive is the road's ground, kept clear like a
      // barrier's. One rule here covers appends, infill, chains and joints alike.
      for (const t of lot.ring >= 0 ? city.tunnels || [] : []) {
        const tA = Math.min(t.nearX ?? t.x0, t.farX ?? t.x1) - 34, tB = Math.max(t.nearX ?? t.x0, t.farX ?? t.x1) + 34;
        if (centerX + w / 2 > tA && centerX - w / 2 < tB) return false;
      }
      // N73: cores first - with a repair system standing, only the gift and the hearts are
      // stamped; the body above is blueprint, raised by the translators cell by cell.
      const grow = !!(world.repair && !PW.INSTANT_BUILDS);
      const res = PW.foundations.place(world, canvas, worldX, { style: city.style, owner: lot.owner, grow });
      if (!res) return false;
      lot.x = Math.round(centerX);
      lot.placed = { x0: res.stamp.x, y0: res.stamp.y, x1: res.stamp.x + res.stamp.width - 1,
        y1: res.stamp.y + res.stamp.height - 1, worksL: res.works[0], worksR: res.works[1] };
      for (let x = lot.placed.worksL - 4; x <= lot.placed.worksR + 4; x += 1) PW.refreshGroundTop(world, x);
      // N57: remember the lie of the ground BESIDE the works (the approach strips - over the
      // works themselves groundTop reads the building's own roof). A neighbour's later
      // earthmoving is noticed by this signature changing, and the lot re-seats.
      lot.groundSig = apronSig(lot.placed);
      world.buildings[lot.owner - 1] = PW.buildingRecord(world, res.stamp,
        // (side is layout here; faction is the real allegiance - the tanks' gate rule keys
        // off b.faction ?? b.side, PS's half)
        { id: lot.owner, side: 'left', faction: city.faction || null, type: lot.type, style: city.style, level: lot.level, kind: city.kind });
      // The newcomer threads its vault cores onto its faction's bundle (the worldgen rule,
      // step E): the line grows out to it or the stretch is taken up and re-laid through
      // its connectors - which also heals any cut the foundation work just made. A re-seat
      // released the old threading in eraseLot, so the pair never doubles up.
      lot.faction = city.faction;
      if (world.pipes && world.pipes.connectCore && city.faction) {
        const rec = world.buildings[lot.owner - 1];
        for (const core of rec.cores || []) {
          if (core.orb || core.standing || !core.vault) continue;
          world.pipes.connectCore(core.x, core.y, city.faction, world.pipes.TAPS[lot.type], lot.owner);
        }
      }
      // N73: the build order the user asked for - the cores stand first and the pipes already
      // run out of their sides; now repair raises the body out of the translator (pillars up
      // the core's top, floors branching outward, walls trailing - the F2 order), the lot a
      // construction site until it stands whole. Its whole body is prepaid by the lot price.
      if (res.grown) {
        const rec = world.buildings[lot.owner - 1];
        rec.underConstruction = true;
        rec.buildFree = true;
        rec.health = 0.02;
        rec.siteWanted = true;
        rec.growing = true;
        rec.grewAt = world.tick || 0;
        world.repair.jobs.delete(lot.owner);   // (a re-seat's old job holds stale coordinates)
        world.repair.notify(lot.owner);
      }
      clearSimAround(lot.placed.x0 - 8, lot.placed.y0 - 8, lot.placed.x1 + 8, lot.placed.y1 + 60);
      flashes.push({ box: { ...lot.placed }, age: 0 });
      return true;
    }

    // Take a building out of the world and regrow the natural ground under it, so it can be
    // seated again (a level-up, or the centre tightening - N43).
    function eraseLot(lot) {
      const p = lot.placed;
      if (!p) return;
      // Let go of the bundle first: spans and threaded cores off, the pipe itself stays.
      if (lot.faction && world.pipes && world.pipes.releaseBuilding) world.pipes.releaseBuilding(lot.faction, lot.owner);
      // N73: a build job still working this lot dies with it (its coordinates go stale).
      if (world.repair && world.repair.jobs) world.repair.jobs.delete(lot.owner);
      // A wing's welds go with it (they live OUTSIDE the lot's own box).
      if (lot.weldL) clearWeld(lot, 'weldL');
      if (lot.weldR) clearWeld(lot, 'weldR');
      const x0 = p.worksL - 8, x1 = p.worksR + 8;
      // (from the top of its canvas: a tower's crown stands well over its body's top - left behind,
      // it floated in the sky over the new tower, the seed-11 re-seat)
      const rec = world.buildings[lot.owner - 1];
      const canvasTop = rec && Number.isFinite(rec.oy) ? rec.oy : p.y0 - 220;
      const y0 = Math.max(2, Math.min(p.y0 - 4, canvasTop - 2)), y1 = Math.min(world.height - 30, p.y1 + 150);
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
        if (PW.getOwner(world, x, y) !== lot.owner) continue;
        PW.set(world, x, y, M.AIR, Q);
        PW.setLayer(world, 'paint', x, y, 0);
        PW.setLayer(world, 'back', x, y, 0);
        PW.setLayer(world, 'deco', x, y, 0);
        PW.setOwner(world, x, y, 0);
        PW.setFlag(world, x, y, FLAG.LADDER | FLAG.FIXTURE | FLAG.HATCH | FLAG.NOBUILD | FLAG.CARVED, false);
      }
      for (let x = x0; x <= x1; x += 1) {
        const s = surf(x);
        for (let y = Math.max(y0, s); y <= y1; y += 1) {
          if ((PW.get(world, x, y) & 63) !== M.AIR || PW.getLayer(world, 'back', x, y)) continue;
          const d = y - s;
          const id = d < 3 ? M.GRASS : d < 16 ? M.TOPSOIL : d < 260 ? M.SOIL : M.STONE;
          PW.set(world, x, y, id | (PW.hash2(x >> 3, y >> 3) & 3) << 6, Q);
        }
        PW.refreshGroundTop(world, x);
      }
      clearSimAround(x0, y0, x1, y1);
      lot.placed = null;
      world.buildings[lot.owner - 1] = emptyRecord(lot.owner);
    }

    // ---- Streets and bridges -----------------------------------------------------------------
    function paveSegment(city, a, b) {
      const x0 = Math.max(4, Math.min(a, b)), x1 = Math.min(world.width - 5, Math.max(a, b));
      if (x1 - x0 < 3) return;
      ST.paveStreet(world, x0, x1, (x) => {
        const g = world.groundTop[x];
        if (PW.getOwner(world, x, g) || PW.getOwner(world, x, g - 1)) return null;
        if ((PW.get(world, x, g) & 63) === M.WATER) return null;
        if (PW.getFlags(world, x, g) & FLAG.FIELD) return null;
        return g;
      }, () => city.style);
      for (let x = x0; x <= x1; x += 1) PW.refreshGroundTop(world, x);
    }

    // A bridge across a water barrier. A farm's lesser bridge is a plank deck on slim timber
    // piers (N46, weaker than the main ones); a capital's main bridge is a steel deck on pillars.
    function bridge(city, b, strong) {
      const deckTop = Math.min(surf(b.x0 - 2), surf(b.x1 + 2)) - 2;
      const rows = strong ? 4 : 2, pierEvery = strong ? 18 : 12;
      const plank = [[126, 96, 58], [110, 84, 50], [96, 72, 44]];
      const steel = [[96, 100, 106], [84, 88, 94], [70, 74, 80]];
      const piers = [], legGap = strong ? 5 : 4;
      for (let x = b.x0 - 2; x <= b.x1 + 2; x += 1) {
        for (let r = 0; r < rows; r += 1) {
          const y = deckTop + r;
          const id = PW.get(world, x, y) & 63;
          if (id !== M.AIR && id !== M.WATER) continue;
          PW.set(world, x, y, (strong ? M.BRIDGE : M.WOOD) | ((PW.hash2(x, y) & 3) << 6), Q);
          const joint = (x % 6) === 0;
          const c = strong ? (r === 0 ? (joint ? [226, 190, 60] : steel[0]) : steel[1 + (r & 1)])
            : (joint ? [70, 52, 34] : plank[PW.hash2(x, r) % 3]);
          PW.setLayer(world, 'paint', x, y, PW.abgr ? PW.abgr(c[0], c[1], c[2], 255) : 0);
          PW.setFlag(world, x, y, FLAG.BRIDGE);
        }
        // N56: each pier is an open truss the river passes THROUGH - two slim legs with brace
        // dashes between them. Real support for the deck, no dam in the water: the flow runs
        // round the legs and through the windows between the braces.
        if (((x - b.x0) % pierEvery) === 2 && x > b.x0 + 1 && x < b.x1 - 2 - legGap) {
          let bottom = deckTop + rows;
          for (const px of [x, x + legGap]) {
            for (let y = deckTop + rows; y < world.height - 30; y += 1) {
              const id = PW.get(world, px, y) & 63;
              if (id !== M.AIR && id !== M.WATER) break;
              PW.set(world, px, y, (strong ? M.PILLAR : M.WOOD) | ((PW.hash2(px, y) & 3) << 6), Q);
              PW.setLayer(world, 'paint', px, y, PW.abgr ? PW.abgr(...(strong ? [84, 88, 94, 255] : [92, 70, 44, 255])) : 0);
              PW.setFlag(world, px, y, FLAG.BRIDGE);
              bottom = Math.max(bottom, y);
            }
          }
          for (let y = deckTop + rows + 2; y < bottom - 1; y += 4) {
            for (let bx = x + 1; bx < x + legGap; bx += 1) {
              const id = PW.get(world, bx, y) & 63;
              if (id !== M.AIR && id !== M.WATER) break;
              PW.set(world, bx, y, (strong ? M.PILLAR : M.WOOD) | ((PW.hash2(bx, y) & 3) << 6), Q);
              PW.setLayer(world, 'paint', bx, y, PW.abgr ? PW.abgr(...(strong ? [70, 74, 80, 255] : [78, 60, 38, 255])) : 0);
              PW.setFlag(world, bx, y, FLAG.BRIDGE);
            }
          }
          piers.push(x);
        }
      }
      for (let x = b.x0 - 3; x <= b.x1 + 3; x += 1) PW.refreshGroundTop(world, x);
      clearSimAround(b.x0 - 4, deckTop - 4, b.x1 + 4, deckTop + 60);
      city.bridges.push({ x0: b.x0 - 2, x1: b.x1 + 2, y: deckTop, rows, strong, piers, legGap, sag: 0 });
      note(city, strong ? 'main bridge raised' : 'lesser bridge laid');
    }

    // N3: a mountain in the road is CROSSED, not noted. One constant-grade drive runs
    // portal to portal at the hulls' slope: columns the rock roofs are BORED as the side's
    // own tunnel (lining follows at the dig system's pace, a struck vein opens a mine);
    // shallow rock above the line is CUT open; ground below it is FILLED as embankment;
    // the whole drive is paved. Where the two ends stand far apart the drive runs on into
    // the high flank until the grade meets the ground (a real mountain road's length).
    // Refused - left blocked as before - when the massif outruns the crews (TUNNEL_MAX),
    // when water stands anywhere over the line (a flooded bore), or over a true chasm.
    function mountainPass(city, b, side) {
      if (!ST || !ST.paveStreet) return false;
      const dir = side === 'left' ? -1 : 1;
      let nearX = dir > 0 ? Math.max(6, b.x0 - 8) : Math.min(world.width - 7, b.x1 + 8);
      let farX = dir > 0 ? Math.min(world.width - 7, b.x1 + 8) : Math.max(6, b.x0 - 8);
      // the portal stands clear of the city's own works - the whole corridor column (an
      // edge lot's armoured vault bed can jut over the face), with a LOOK-AHEAD so the
      // drive never starts under a bed it must yield to. The city's own street grading
      // owns everything before the portal.
      const worksAt = (x) => {
        const g = world.groundTop[x];
        for (let y = g - 44; y <= g + 2; y += 3) {
          const o = PW.getOwner(world, x, y);
          if (o > 0 && o < 50000) return true;   // a building's; the pipeline's own spans re-lay
        }
        return false;
      };
      const clearRun = (x) => {
        for (let k = 0; k < 18; k += 1) {
          const cx = x + dir * k;
          if (cx < 6 || cx > world.width - 7) return false;
          if (worksAt(cx)) return false;
        }
        return true;
      };
      while (!clearRun(nearX)) {
        nearX += dir;
        if (Math.abs(farX - nearX) < 40) return false;   // the city's own works wall the face
      }
      const G = 0.45;                                  // the drive's grade, under the hulls' 0.58
      const yNear = world.groundTop[nearX] - 1;
      if (Math.abs(world.groundTop[farX] - 1 - yNear) > Math.abs(farX - nearX) * G) {
        const need = Math.ceil(Math.abs(world.groundTop[farX] - 1 - yNear) / G);
        farX = Math.max(6, Math.min(world.width - 7, nearX + dir * need));
      }
      if (Math.abs(farX - nearX) > TUNNEL_MAX) return false;
      const yFar = world.groundTop[farX] - 1;
      const span = farX - nearX;
      if (Math.abs(yFar - yNear) > Math.abs(span) * (G + 0.1)) return false;
      const fAt = (x) => Math.round(yNear + (yFar - yNear) * (x - nearX) / span);
      const x0 = Math.min(nearX, farX), x1 = Math.max(nearX, farX);
      // the guards: no water over the line, no chasm under it, no neighbour's works carved
      for (let x = x0; x <= x1; x += 1) {
        const f = fAt(x), g = world.groundTop[x];
        if (g - f > 60) return false;        // a true chasm: a causeway won't bank it (no road)
        for (let y = Math.min(g, f - TUNNEL_CLEAR); y <= f + 2; y += 1) {
          if ((PW.get(world, x, y) & 63) === M.WATER) return false;      // the bore would flood
        }
      }
      // bore the roofed stretches as the side's own tunnel
      const sideName = city.faction || 'right';
      let net = null, cells = 0;
      for (let sx = x0; sx <= x1; sx += 14) {
        const ex = Math.min(x1, sx + 15);
        const top = Math.min(fAt(sx), fAt(ex)) - TUNNEL_CLEAR;
        let roofed = false;
        for (let x = sx; x <= ex; x += 3) if (world.groundTop[x] < top - 4) { roofed = true; break; }
        if (!roofed || !PW.tunnels) continue;
        if (!net) {
          for (let x = x0; x <= x1 && !net; x += 20) {
            const f = PW.tunnels.networkAt(world, x, fAt(x) - 8);
            if (f && f.side === sideName) net = f;
          }
          if (!net) net = PW.tunnels.createNetwork(world, { side: sideName, x: Math.round((x0 + x1) / 2), y: fAt(Math.round((x0 + x1) / 2)) });
        }
        const r = PW.tunnels.digBox(world, net, sx, top, ex, Math.max(fAt(sx), fAt(ex)) + 2);
        if (r && r.cells) cells += r.cells;
        if (r && r.ok && PW.mining) {
          const op = PW.mining.afterDig(world, net, { x0: sx, y0: top, x1: ex, y1: Math.max(fAt(sx), fAt(ex)) + 2 });
          if (op && !op.blocked && world.pipes && world.pipes.attach) world.pipes.attach(op);
        }
      }
      // cut the shallow faces open, fill the dips - the road's own earthworks
      for (let x = x0; x <= x1; x += 1) {
        const f = fAt(x), g = world.groundTop[x], ceil = f - TUNNEL_CLEAR;
        if (g <= ceil - 4) { /* roofed: the bore above took it */ }
        else {
          // open stretch: a DAYLIGHT cut - everything above the road line is cleared to the
          // sky, so no lip is left hanging to avalanche into the corridor. The pipeline's
          // old spans clear with the rock (the line heals itself along the new grade - the
          // N3 heals - a surface pipe like any city street's, a bump the hulls step over).
          // Dips fill as embankment.
          let air = 0;
          for (let y = f - 1; y >= 2 && air < 12; y -= 1) {
            const o = PW.getOwner(world, x, y);
            if (o > 0 && o < 50000) break;         // a building's works stand; the road yields
            const id = PW.get(world, x, y) & 63;
            if (!id) { air += 1; continue; }
            if (id === M.ORE || id === M.BEDROCK) { air = 0; continue; }
            air = 0;
            PW.set(world, x, y, M.AIR, { quiet: true });
            PW.setLayer(world, 'paint', x, y, 0); PW.setLayer(world, 'deco', x, y, 0);
          }
          for (let y = g; y > f; y -= 1) {
            const o = PW.getOwner(world, x, y);
            if (o > 0 && o < 50000) continue;
            PW.set(world, x, y, M.FOUNDATION, { quiet: true });
          }
        }
        PW.refreshGroundTop(world, x);
      }
      ST.paveStreet(world, x0, x1, (x) => fAt(x), () => city.style);
      for (let x = x0; x <= x1; x += 1) PW.refreshGroundTop(world, x);
      (city.tunnels = city.tunnels || []).push({ x0: b.x0, x1: b.x1, nearX, farX, floorL: fAt(x0), floorR: fAt(x1), cells });
      note(city, cells ? 'the road bores through the mountain' : 'the road is cut over the flank');
      return true;
    }

    // ---- Cities ------------------------------------------------------------------------------
    function note(city, text) { city.notes.push(text); if (city.notes.length > 4) city.notes.shift(); }
    const claimSpan = (c) => [c.edge.left - CLAIM, c.edge.right + CLAIM];
    // (N6: a fallen city - every core of it destroyed, see PW.game - claims nothing: its ruins are
    // open ground for anyone's seed)
    function claimed(x0, x1, self) {
      for (const c of cities) {
        if (c === self || c.fallen) continue;
        const [l, r] = claimSpan(c);
        if (r >= Math.min(x0, x1) && l <= Math.max(x0, x1)) return c;
      }
      return null;
    }

    // `faction` names the side ('left'/'right') whose supply bundle the city threads onto as
    // it grows (the live world passes it; the lab has no lines and passes none).
    // N33: a side's capitals rank by founding order - the first is the grandest (cap 7),
    // each later one caps a level lower, floored at 4. Adopted towns count: a standing
    // town that joined first IS the side's seat, and a seed after it founds a lesser city.
    function capitalCap(faction) {
      const rank = cities.filter((o) => o.kind === 'capital' && (o.faction || null) === (faction || null)).length + 1;
      return Math.max(4, MAX_LEVEL - (rank - 1));
    }

    function drop(xIn, kind, style, faction) {
      const x = Math.round(xIn);
      if (x < 120 || x > world.width - 120) return { ok: false, note: 'off the map' };
      const b = barrierIn(x - 40, x + 40);
      if (b && (b.kind === 'water' || kind !== 'military')) return { ok: false, note: b.kind === 'water' ? 'open water' : 'mountain: only military digs in here' };
      const other = claimed(x - 60, x + 60, null);
      if (other) {
        // N55: the military is the most versatile - dropped inside a capital's claim it
        // squeezes a hangar tower into a gap, or merges into the nearest tower outright.
        if (kind === 'military' && other.kind === 'capital') return militariseDrop(other, x);
        return { ok: false, note: `claimed by ${other.kind} ${other.id}` };
      }
      let setting = null;
      if (kind === 'military') {
        // N59: the base reads its ground - mountains at hand, fields or a farm nearby, else urban
        const nearMtn = barrierIn(x - 140, x + 140);
        let farmish = false;
        for (let dx = -300; dx <= 300 && !farmish; dx += 12) {
          const gx = x + dx;
          if (gx < 4 || gx >= world.width - 4) continue;
          if (PW.getFlags(world, gx, world.groundTop[gx]) & FLAG.FIELD) farmish = true;
        }
        if (!farmish) for (const o of cities) if (o.kind === 'farm' && Math.abs(o.x - x) < 700) farmish = true;
        setting = nearMtn && nearMtn.kind === 'mountain' ? 'mountain' : farmish ? 'farm' : 'urban';
      }
      const city = { id: cities.length + 1, kind, style, x, setting, faction: faction || null, level: 1, clock: 0, actions: 0,
        appendClock: { left: APPEND_EVERY, right: APPEND_EVERY },   // the first rings come at once
        infillClock: 0,
        rings: { left: [], right: [] }, edge: { left: x, right: x }, capEdge: { left: x, right: x },
        blocked: { left: null, right: null }, fields: [], fieldEdge: { left: x, right: x },
        bridges: [], joints: [], jointClock: 0, merged: new Set(), notes: [] };
      // N33: the FIRST capital of a side is the grandest - each later seat caps a level
      // lower (never under 4), so the founding city keeps its crown as the side spreads.
      if (kind === 'capital') city.levelCap = capitalCap(faction);
      // N2: the seed grows a core with a LEVEL-1 building - the seat is born modest
      // (core and gift first, the body raised by the crews) and re-seats grander with
      // every level-up, to its rank's cap (N33).
      const main = { type: kind === 'capital' ? 'population' : kind, level: 1, ring: -1, side: 'right',
        bornLevel: 1, variant: kind === 'capital' ? 'offset' : kind === 'farm' ? 'homestead' : 'compound',
        seedN: seedN += 17, owner: allotOwner(), x };
      if (!placeLot(city, main, x)) {
        world.buildings.pop();
        return { ok: false, note: 'ground too steep for a seed' };
      }
      city.main = main;
      city.capEdge = { left: main.placed.worksL - 2, right: main.placed.worksR + 2 };
      city.edge = { left: city.capEdge.left, right: city.capEdge.right };
      city.fieldEdge = { left: main.placed.worksL - 4, right: main.placed.worksR + 4 };
      cities.push(city);
      if (kind === 'military') layRunway(city);   // N57: the base's runway from the first day
      note(city, `${kind} seed takes root`);
      return { ok: true, city };
    }

    // ---- N3: the worldgen towns adopt the engine -----------------------------------------------
    // The towns that generated with the world join the growth system as standing cities:
    // their population towers become ring lots, AGED so their levels stand (the aging only
    // ever raises them from here); their farms, bases and the core building hold their
    // ground as FIXED ring members the chains never move; and from then on the engine runs
    // their appends, infill, level-ups and joints like any seed city's - paid from the
    // faction's stock like everything else (N4), threaded on the bundle like everything
    // else (the worldgen already threaded them; re-seats release and re-thread).
    function adoptSettlements() {
      let adopted = 0;
      for (const s of world.settlements || []) {
        if (s.adopted) continue;
        const buildings = (s.buildings || []).filter((b) => b && b.body && b.works);
        if (buildings.length < 2) continue;
        const main = buildings.find((b) => b.type === 'core') || buildings[0];
        const cx = Math.round((main.body.left + main.body.right) / 2);
        const city = { id: cities.length + 1, kind: 'capital', style: s.style, x: cx, setting: 'urban',
          faction: s.side || null, level: 1, clock: 0, actions: 0,
          appendClock: { left: APPEND_EVERY * 0.5, right: APPEND_EVERY * 0.5 }, infillClock: 0,
          rings: { left: [], right: [] }, edge: { left: cx, right: cx }, capEdge: { left: main.works[0] - 2, right: main.works[1] + 2 },
          blocked: { left: null, right: null }, fields: [], fieldEdge: { left: main.works[0] - 4, right: main.works[1] + 4 },
          bridges: [], joints: [], jointClock: 0, merged: new Set(), notes: [], adopted: true };
        city.main = { type: 'core', level: main.level || 1, ring: -1, side: 'right', bornLevel: 1,
          variant: 'core', seedN: 1, owner: main.id, x: cx, fixed: true, faction: s.side || null,
          placed: { x0: main.body.left, y0: main.body.top, x1: main.body.right, y1: main.body.bottom, worksL: main.works[0], worksR: main.works[1] } };
        let maxLevel = 1;
        for (const b of buildings) {
          if (b === main) continue;
          const meta = (b.canvas && b.canvas.meta) || {};
          const bx = Math.round((b.body.left + b.body.right) / 2);
          const side = bx < cx ? 'left' : 'right';
          const pop = b.type === 'population';
          const lot = { type: b.type, level: b.level || meta.level || 1, age: 0, ring: 0, side,
            bornLevel: 1, variant: meta.variant || b.variant || 'slab', seedN: meta.seed || (b.id * 31 + 7),
            owner: b.id, x: bx, gapWant: GAP_MIN + 12, faction: s.side || null, fixed: !pop,
            placed: { x0: b.body.left, y0: b.body.top, x1: b.body.right, y1: b.body.bottom, worksL: b.works[0], worksR: b.works[1] } };
          lot.age = Math.max(0, (lot.level - 1) * AGE_PER_LEVEL + (AGE_PER_LEVEL >> 1));
          if (pop) maxLevel = Math.max(maxLevel, lot.level);
          city.rings[side].push(lot);
        }
        for (const side of ['left', 'right']) {
          const dir = side === 'left' ? -1 : 1;
          city.rings[side].sort((a, b) => (dir * (a.x - b.x) > 0 ? 1 : -1));
          city.rings[side].forEach((l, i) => { l.ring = i; });
          const last = city.rings[side][city.rings[side].length - 1];
          city.edge[side] = last ? (dir > 0 ? last.placed.worksR + 2 : last.placed.worksL - 2) : city.capEdge[side];
        }
        // N33: the town ranks like any capital - but never capped under what already stands.
        city.levelCap = Math.max(Math.min(MAX_LEVEL, Math.max(2, maxLevel)), capitalCap(s.side || null));
        city.level = Math.min(MAX_LEVEL, Math.max(2, maxLevel));
        cities.push(city);
        s.adopted = true;
        adopted += 1;
        note(city, 'the standing town joins the growth');
      }
      return adopted;
    }

    // ---- Capital growth (N43 rings, N45 skyline) ---------------------------------------------
    const POP_LOT_VARIANTS = ['slab', 'setback', 'tapered', 'spire', 'needle', 'crown'];
    // N51: spacing is no uniform row. Each lot carries its own gap, set when it is placed -
    // a little jitter on level land, and mostly the lie of the ground: where the terrain
    // rises or falls across the span, the buildings stand further apart.
    function terrainGap(xa, xb) {
      let lo = 1e9, hi = -1e9;
      for (let x = Math.max(4, Math.min(xa, xb)); x <= Math.min(world.width - 5, Math.max(xa, xb)); x += 2) {
        const s = surf(x);
        lo = Math.min(lo, s); hi = Math.max(hi, s);
      }
      return hi < lo ? 0 : Math.max(0, Math.min(46, Math.round((hi - lo) * 1.4)));
    }
    const gapFor = (city, lot) => Math.max(GAP_MIN,
      (lot.gapWant ?? (GAP0 + lot.ring * GAP_RING)) - TIGHTEN * (city.level - lot.bornLevel));

    // N54: the earthwork. [xa, xb] is regraded into one straight slope from the ground at one
    // end to the ground at the other (cut above the line, fill below it) - growth built along
    // the original shape. Refused when the line would run steeper than maxSlope, any column
    // would move more than maxMove, a cut would bite into rock, or anything built, paved,
    // sown or wet stands in the way. The graded line becomes the land's new natural shape
    // (surface0), so spacing, erasing and re-seating all read it as the ground thereafter.
    let regradeCount = 0;
    function regrade(xa, xb, maxSlope, maxMove) {
      let x0 = Math.max(8, Math.round(Math.min(xa, xb))), x1 = Math.min(world.width - 9, Math.round(Math.max(xa, xb)));
      // N3: a mountain drive's earthworks are already at the hulls' grade - the pre-seat
      // grading stops at its portals (a second line cut through the drive chews the road)
      for (const c of cities) {
        for (const t of c.tunnels || []) {
          const tA = Math.min(t.nearX ?? t.x0, t.farX ?? t.x1), tB = Math.max(t.nearX ?? t.x0, t.farX ?? t.x1);
          if (x1 < tA || x0 > tB) continue;
          if (x0 < tA && x1 <= tB) x1 = tA - 1;
          else if (x0 >= tA && x1 > tB) x0 = tB + 1;
          else return false;
        }
      }
      if (x1 - x0 < 8) return false;
      const g0 = world.groundTop[x0], g1 = world.groundTop[x1];
      const refuse = (why) => { dbg.push(`grade-${why}@${x0}`); if (dbg.length > 40) dbg.shift(); return false; };
      if (Math.abs(g1 - g0) / (x1 - x0) > maxSlope) return refuse('slope');
      const line = (x) => Math.round(g0 + (g1 - g0) * (x - x0) / (x1 - x0));
      const soilish = (id) => id === M.GRASS || id === M.TOPSOIL || id === M.SOIL || id === M.LOOSE_SOIL || id === M.SAND;
      let needed = false, lo = 1e9, hi = -1e9;
      for (let x = x0; x <= x1; x += 1) {
        const g = world.groundTop[x], t = line(x);
        if (Math.abs(g - t) > maxMove) return refuse('move');
        if ((PW.get(world, x, g) & 63) === M.WATER) return refuse('wet');
        if (PW.getFlags(world, x, g) & (FLAG.ROAD | FLAG.FIELD)) return refuse('paved');
        if (PW.getOwner(world, x, g) || PW.getOwner(world, x, g - 1)) return refuse('built');
        for (let y = Math.min(g, t); y < Math.max(g, t); y += 1) {
          if (y >= g && !soilish(PW.get(world, x, y) & 63)) return refuse('rock');
          if (PW.getOwner(world, x, y)) return refuse('built');
        }
        if (Math.abs(g - t) > 2) needed = true;
        lo = Math.min(lo, Math.min(g, t)); hi = Math.max(hi, Math.max(g, t));
      }
      if (!needed) return true;
      for (let x = x0; x <= x1; x += 1) {
        const g = world.groundTop[x], t = line(x);
        if (g < t) {
          for (let y = g; y < t; y += 1) PW.set(world, x, y, M.AIR, Q);           // cut the bump
          PW.setLayer(world, 'deco', x, g - 1, 0);
        } else {
          for (let y = t; y < g; y += 1) {                                        // fill the dip
            const d = y - t;
            PW.set(world, x, y, (d < 3 ? M.GRASS : d < 16 ? M.TOPSOIL : M.SOIL) | (PW.hash2(x >> 3, y >> 3) & 3) << 6, Q);
          }
        }
        for (let y = t; y < t + 3; y += 1) {
          if ((PW.get(world, x, y) & 63) !== M.AIR) PW.set(world, x, y, M.GRASS | (PW.hash2(x, y) & 3) << 6, Q);
        }
        for (let y = t - 30; y < t; y += 1) PW.setLayer(world, 'deco', x, y, 0);  // plants over the works are cleared
        world.surface0[x] = t;
        PW.refreshGroundTop(world, x);
      }
      clearSimAround(x0, lo - 4, x1, hi + 6);
      regradeCount += 1;
      return true;
    }
    // N69: a farm SMOOTHS the ground it grows over and keeps the slope - the profile is
    // eased toward its own windowed mean, so the land keeps its shape with the bumps and
    // nicks taken out, never flattened to a line. Moves are clamped to the budget rather
    // than refused, and a column the works may not touch (wet, paved, built, rock in the
    // cut) is frozen where it lies, the easing relaxing into it over a couple of cells.
    function smoothGrade(xa, xb, maxMove, reach = 18) {
      const x0 = Math.max(8, Math.round(Math.min(xa, xb))), x1 = Math.min(world.width - 9, Math.round(Math.max(xa, xb)));
      if (x1 - x0 < 10) return false;
      const n = x1 - x0 + 1;
      const g = new Int32Array(n), t = new Int32Array(n), frozen = new Uint8Array(n);
      const soilish = (id) => id === M.GRASS || id === M.TOPSOIL || id === M.SOIL || id === M.LOOSE_SOIL || id === M.SAND;
      for (let k = 0; k < n; k += 1) g[k] = world.groundTop[x0 + k];
      for (let k = 0; k < n; k += 1) {
        let sum = 0, wsum = 0;
        for (let d = -reach; d <= reach; d += 1) {
          const j = Math.max(0, Math.min(n - 1, k + d));
          const w = reach + 1 - Math.abs(d);
          sum += g[j] * w; wsum += w;
        }
        t[k] = g[k] + Math.max(-maxMove, Math.min(maxMove, Math.round(sum / wsum) - g[k]));
      }
      for (let k = 0; k < n; k += 1) {
        const x = x0 + k, gk = g[k];
        let ok = (PW.get(world, x, gk) & 63) !== M.WATER
          && !(PW.getFlags(world, x, gk) & (FLAG.ROAD | FLAG.FIELD))
          && !PW.getOwner(world, x, gk) && !PW.getOwner(world, x, gk - 1);
        for (let y = Math.min(gk, t[k]); ok && y < Math.max(gk, t[k]); y += 1) {
          if (y >= gk && !soilish(PW.get(world, x, y) & 63)) ok = false;
          if (PW.getOwner(world, x, y)) ok = false;
        }
        if (!ok) { t[k] = gk; frozen[k] = 1; }
      }
      // (the easing never steps more than two cells a column into a frozen stretch)
      for (let pass = 0; pass < 3; pass += 1) {
        for (let k = 1; k < n; k += 1) if (!frozen[k]) t[k] = Math.max(t[k - 1] - 2, Math.min(t[k - 1] + 2, t[k]));
        for (let k = n - 2; k >= 0; k -= 1) if (!frozen[k]) t[k] = Math.max(t[k + 1] - 2, Math.min(t[k + 1] + 2, t[k]));
      }
      let changed = false, lo = 1e9, hi = -1e9;
      for (let k = 0; k < n; k += 1) {
        if (Math.abs(t[k] - g[k]) < 2) continue;
        const x = x0 + k, gk = g[k], tk = t[k];
        if (gk < tk) {
          for (let y = gk; y < tk; y += 1) PW.set(world, x, y, M.AIR, Q);
          PW.setLayer(world, 'deco', x, gk - 1, 0);
        } else {
          for (let y = tk; y < gk; y += 1) {
            const d = y - tk;
            PW.set(world, x, y, (d < 3 ? M.GRASS : d < 16 ? M.TOPSOIL : M.SOIL) | (PW.hash2(x >> 3, y >> 3) & 3) << 6, Q);
          }
        }
        for (let y = tk; y < tk + 3; y += 1) {
          if ((PW.get(world, x, y) & 63) !== M.AIR) PW.set(world, x, y, M.GRASS | (PW.hash2(x, y) & 3) << 6, Q);
        }
        for (let y = tk - 30; y < tk; y += 1) PW.setLayer(world, 'deco', x, y, 0);
        world.surface0[x] = tk;
        PW.refreshGroundTop(world, x);
        changed = true;
        lo = Math.min(lo, Math.min(gk, tk)); hi = Math.max(hi, Math.max(gk, tk));
      }
      if (changed) { clearSimAround(x0, lo - 4, x1, hi + 6); regradeCount += 1; }
      return changed;
    }
    // N3 vehicle rule: the street strip between two works is graded to armour's limits - a
    // straight ramp no steeper than ~30 degrees, cut and filled with the farms' machinery,
    // frozen where buildings, laid roads, water or fields stand. Too steep to ramp at all
    // (a cliff between pads tighter than the grade allows) is left honest and unpaved.
    function gradeLane(xa, xb) {
      let x0 = Math.max(8, Math.round(Math.min(xa, xb))), x1 = Math.min(world.width - 9, Math.round(Math.max(xa, xb)));
      // N3: a mountain drive is already graded at the hulls' slope by its own earthworks -
      // the street grading stops at its portals instead of re-cutting a second road
      // through the span (two graders fighting left interleaved steps).
      for (const c of cities) {
        for (const t of c.tunnels || []) {
          const tA = Math.min(t.nearX ?? t.x0, t.farX ?? t.x1), tB = Math.max(t.nearX ?? t.x0, t.farX ?? t.x1);
          if (x1 < tA || x0 > tB) continue;
          if (x0 < tA && x1 <= tB) x1 = tA - 1;
          else if (x0 >= tA && x1 > tB) x0 = tB + 1;
          else if (x0 >= tA && x1 <= tB) return false;   // wholly inside the drive: nothing to do
          else return false;                             // spans the whole drive: the drive stands
        }
      }
      const n = x1 - x0 + 1;
      if (n < 4) return false;
      const g = new Int32Array(n), t = new Int32Array(n), frozen = new Uint8Array(n);
      const soilish = (id) => id === M.GRASS || id === M.TOPSOIL || id === M.SOIL || id === M.LOOSE_SOIL || id === M.SAND;
      for (let k = 0; k < n; k += 1) g[k] = world.groundTop[x0 + k];
      const dh = g[n - 1] - g[0];
      if (Math.abs(dh) > Math.floor(n * 0.58)) return false;   // steeper than armour climbs: no ramp fits
      for (let k = 0; k < n; k += 1) t[k] = g[0] + Math.round(dh * k / Math.max(1, n - 1));
      frozen[0] = 1; frozen[n - 1] = 1; t[0] = g[0]; t[n - 1] = g[n - 1];
      for (let k = 0; k < n; k += 1) {
        const x = x0 + k, gk = g[k];
        let ok = (PW.get(world, x, gk) & 63) !== M.WATER
          && !(PW.getFlags(world, x, gk) & FLAG.FIELD)
          && !PW.getOwner(world, x, gk) && !PW.getOwner(world, x, gk - 1);
        for (let y = Math.min(gk, t[k]); ok && y < Math.max(gk, t[k]); y += 1) {
          if (y >= gk && !soilish(PW.get(world, x, y) & 63) && (PW.get(world, x, y) & 63) !== M.ASPHALT) ok = false;
          if (PW.getOwner(world, x, y)) ok = false;
        }
        if (!ok) { t[k] = gk; frozen[k] = 1; }
      }
      for (let pass = 0; pass < 3; pass += 1) {
        for (let k = 1; k < n; k += 1) if (!frozen[k]) t[k] = Math.max(t[k - 1] - 2, Math.min(t[k - 1] + 2, t[k]));
        for (let k = n - 2; k >= 0; k -= 1) if (!frozen[k]) t[k] = Math.max(t[k + 1] - 2, Math.min(t[k + 1] + 2, t[k]));
      }
      let changed = false, lo = 1e9, hi = -1e9;
      for (let k = 0; k < n; k += 1) {
        if (t[k] === g[k]) continue;
        const x = x0 + k, gk = g[k], tk = t[k];
        if (gk < tk) {
          for (let y = gk; y < tk; y += 1) PW.set(world, x, y, M.AIR, Q);
          PW.setLayer(world, 'deco', x, gk - 1, 0);
        } else {
          for (let y = tk; y < gk; y += 1) {
            const d = y - tk;
            PW.set(world, x, y, (d < 3 ? M.GRASS : d < 16 ? M.TOPSOIL : M.SOIL) | (PW.hash2(x >> 3, y >> 3) & 3) << 6, Q);
          }
        }
        for (let y = tk - 30; y < tk; y += 1) PW.setLayer(world, 'deco', x, y, 0);
        world.surface0[x] = tk;
        PW.refreshGroundTop(world, x);
        changed = true;
        lo = Math.min(lo, Math.min(gk, tk)); hi = Math.max(hi, Math.max(gk, tk));
      }
      if (changed) { clearSimAround(x0, lo - 4, x1, hi + 6); regradeCount += 1; }
      return changed;
    }
    // (grading beside a standing lot changes the apron the N57 watcher reads - the sig is
    // refreshed so a LANE's own earthworks never read as a neighbour's and churn a re-seat)
    function refreshSigs(city, x0, x1) {
      for (const lot of [...city.rings.left, ...city.rings.right, city.main]) {
        if (!lot || !lot.placed) continue;
        if (lot.placed.worksR + 18 < x0 || lot.placed.worksL - 18 > x1) continue;
        lot.groundSig = apronSig(lot.placed);
      }
    }
    // A long span grades in strides: a polyline of straight slopes along the original shape,
    // each stride cut and filled on its own (a refused stride stays as it was).
    function regradeRun(xa, xb, grade) {
      let x0 = Math.round(Math.min(xa, xb));
      const x1 = Math.round(Math.max(xa, xb));
      // the street's flare at the span's head is stepped past, not a reason to refuse
      while (x0 < x1 && (PW.getFlags(world, x0, world.groundTop[x0]) & FLAG.ROAD)) x0 += 1;
      let any = false;
      for (let a = x0; a < x1; a += 96) any = regrade(a, Math.min(x1, a + 96), grade.maxSlope, grade.maxMove) || any;
      return any;
    }

    function tryAppend(city, side) {
      if (city.blocked[side] === 'merged' || city.blocked[side] === 'edge') return false;
      const dir = side === 'left' ? -1 : 1;
      const ring = city.rings[side].length;
      // The spread outruns its upkeep: no more rings than the city's level affords (N44 size).
      if (ring >= city.level + 3) { if (!city.blocked[side]) city.blocked[side] = 'upkeep'; return false; }
      // N60: the edge does not build into a fresh crater's reach
      if (nearBlast(Math.min(city.edge[side], city.edge[side] + dir * 320) - 120, Math.max(city.edge[side], city.edge[side] + dir * 320) + 120)) return false;
      const lot = { type: 'population', level: 1, age: 0, ring, side, bornLevel: city.level,
        variant: POP_LOT_VARIANTS[rand.int(0, POP_LOT_VARIANTS.length - 1)], seedN: seedN += 17, owner: 0 };
      const canvas = canvasFor(city, lot);
      const w = bodyWidth(canvas);
      // N54: the ground ahead is graded in strides into straight slopes while the work is
      // modest. The spread then reads the smoothed ground: a graded stretch packs close, and
      // ground the earthworks refuse still spreads the N51 way or blocks as a barrier.
      regradeRun(city.edge[side], city.edge[side] + dir * (GAP_MIN + 21 + w + 36), GRADE);
      // N51: the town spreads out - gaps start loose and varied, with the odd plaza-sized hole
      // left open (one lot in six), and the infill fills them in as it grows (the tightening
      // on level-up pulls the centre in besides).
      lot.gapWant = GAP_MIN + rand.int(8, 34) + (rand.int(0, 5) === 0 ? 110 + rand.int(0, 50) : 0)
        + terrainGap(city.edge[side], city.edge[side] + dir * (w + 36));
      let cursor = city.edge[side] + dir * lot.gapWant;
      let far = cursor + dir * (w + 6);
      if (far < 80 || far > world.width - 80) { city.blocked[side] = 'edge'; return false; }
      const b = barrierIn(cursor, far);
      if (b) {
        if (city.level < UNLOCK) { city.blocked[side] = b.kind; return false; }
        if (b.kind === 'water') {
          if (b.x1 - b.x0 > CAPITAL_BRIDGE_MAX) { city.blocked[side] = 'water-wide'; return false; }
          if (!city.bridges.some((g) => g.x0 === b.x0)) bridge(city, b, true);
        } else {
          // N3: the road bores a tunnel through the mountain (wider massifs stay walls)
          if (b.x1 - b.x0 > TUNNEL_MAX) { city.blocked[side] = 'mountain-wide'; return false; }
          if (!(city.tunnels || []).some((t) => t.x0 === b.x0)) mountainPass(city, b, side);
        }
        cursor = dir > 0 ? b.x1 + 8 : b.x0 - 8;
        // N3: the next lot seats CLEAR of the drive's earthworks - a lot's own terracing
        // and aprons reach back ~26 cells, and a failed try leaves its groundwork (the
        // engine never unwinds terrain), so repeated failed seats would chew the road
        const drive = (city.tunnels || []).find((t) => t.x0 === b.x0);
        if (drive && drive.farX !== undefined) cursor = dir > 0 ? Math.max(cursor, drive.farX + 30) : Math.min(cursor, drive.farX - 30);
        lot.massEdge = cursor;                      // born on the far side: it stays there (N43)
        far = cursor + dir * (w + 6);
        if (barrierIn(cursor, far)) { city.blocked[side] = 'mountain'; return false; }
      }
      // Claims: a military base never stops the town (N59) - the spread passes it and grows
      // alongside, holding beyond it as its own land mass. Any other claim merges as before.
      for (let hops = 0; hops < 2; hops += 1) {
        const other = claimed(cursor, cursor + dir * (w + 6), city);
        if (!other) break;
        if (other.kind !== 'military' || city.kind === 'military') {
          city.blocked[side] = 'merged';
          if (!city.merged.has(other.id)) {
            city.merged.add(other.id); other.merged.add(city.id);
            linkLines(city, other);   // N75: met - one pipeline now
            const oside = other.x > city.x ? 'left' : 'right';
            other.blocked[oside] = 'merged';
            if (!PW.NO_LANE_GRADING) gradeLane(city.edge[side], dir > 0 ? other.edge.left : other.edge.right);   // N3 vehicle rule
            paveSegment(city, city.edge[side], dir > 0 ? other.edge.left : other.edge.right);
            refreshSigs(city, Math.min(city.edge[side], other.edge.left), Math.max(city.edge[side], other.edge.right));
            note(city, `merged with ${other.kind} ${other.id}`); note(other, `merged with ${city.kind} ${city.id}`);
          }
          return false;
        }
        cursor = dir > 0 ? other.edge.right + CLAIM + 6 : other.edge.left - CLAIM - 6;
        lot.massEdge = cursor;
        if (!city.merged.has(other.id)) {
          city.merged.add(other.id); other.merged.add(city.id);
          linkLines(city, other);   // N75
          note(city, 'the town grows alongside the base');
        }
        const past = cursor + dir * (w + 6);
        if (Math.min(cursor, past) < 80 || Math.max(cursor, past) > world.width - 80) { city.blocked[side] = 'edge'; return false; }
        const b2 = barrierIn(cursor, past);
        if (b2) { city.blocked[side] = b2.kind; return false; }
      }
      far = cursor + dir * (w + 6);
      // The map's edge stops the spread (the adopted border towns sit right against it -
      // an append that walked off the world threaded cores at negative x into the bundle).
      if (Math.min(cursor, far) < 80 || Math.max(cursor, far) > world.width - 80) { city.blocked[side] = 'edge'; return false; }
      if (!pay(city, 'lot')) { city.blocked[side] = 'upkeep'; return false; }   // N4: the works are paid for
      lot.canvas = canvas;
      lot.owner = allotOwner();
      const center = cursor + dir * (w / 2 + 2);
      if (!placeLot(city, lot, center)) {
        world.buildings.pop();
        // too steep for a lot right here: step past the rough patch next attempt
        city.edge[side] += dir * 12;
        return false;
      }
      // N51: if the newcomer's works reached back and swallowed the gap, re-seat it further out.
      {
        const got = Math.abs((dir > 0 ? lot.placed.worksL : lot.placed.worksR) - city.edge[side]);
        if (got + 3 < lot.gapWant) {
          const c2 = center + dir * (lot.gapWant - got);
          eraseLot(lot);
          if (!placeLot(city, lot, c2)) placeLot(city, lot, center);
          if (!lot.placed) { world.buildings.pop(); return false; }
        }
      }
      city.rings[side].push(lot);
      const prevEdge = city.edge[side];
      city.edge[side] = dir > 0 ? Math.max(prevEdge, lot.placed.worksR + 2) : Math.min(prevEdge, lot.placed.worksL - 2);
      // N3 vehicle rule: the new strip is graded to armour's limits before it is paved
      if (!PW.NO_LANE_GRADING) gradeLane(prevEdge, dir > 0 ? lot.placed.worksL : lot.placed.worksR);
      paveSegment(city, prevEdge, dir > 0 ? lot.placed.worksL : lot.placed.worksR);
      // ...and the APPROACH beyond the city's new outer edge ramps long into the open
      // country, so a bank at the frontier never stands steeper than a tank climbs
      // (PS's drive: a 57-degree bank left a whole tower unreachable from its own side).
      if (!PW.NO_LANE_GRADING) gradeLane(city.edge[side], city.edge[side] + dir * 160);
      refreshSigs(city, Math.min(prevEdge, lot.placed.worksL) - 10, Math.max(prevEdge, lot.placed.worksR) + 170);
      city.blocked[side] = null;
      return true;
    }

    // N51: as the town grows it fills its gaps in. The widest hole between two neighbours (or
    // against the capital's works) that can take a level-1 tower with its margins gets one -
    // a young, small building squeezed in between its elders (N48 keeps it low until it has
    // stood a while). The newcomer takes the inner lot's land mass.
    function tryInfill(city) {
      for (const side of ['left', 'right']) {
        const dir = side === 'left' ? -1 : 1;
        const lots = city.rings[side];
        if (!lots.length) continue;
        let best = null;
        for (let i = 0; i < lots.length; i += 1) {
          if (!lots[i].placed) continue;
          const inner = i === 0 ? city.capEdge[side] : (dir > 0 ? lots[i - 1].placed.worksR : lots[i - 1].placed.worksL);
          const outer = dir > 0 ? lots[i].placed.worksL : lots[i].placed.worksR;
          if (dir > 0 ? outer <= inner : outer >= inner) continue;   // out of order: never fill into a scramble
          const room = Math.abs(outer - inner);
          if (!best || room > best.room) best = { i, room, inner, outer };
        }
        if (!best) continue;
        const lot = { type: 'population', level: 1, age: 0, ring: best.i, side, bornLevel: city.level,
          variant: 'slab', seedN: seedN += 17, owner: 0 };   // the narrowest design takes the slot
        const canvas = canvasFor(city, lot);
        const w = bodyWidth(canvas);
        if (best.room < w + 2 * GAP_MIN + 6) { dbg.push(`infill-tight ${side} room${best.room} need${w + 2 * GAP_MIN + 6}`); if (dbg.length > 40) dbg.shift(); continue; }
        if (barrierIn(best.inner, best.outer)) { dbg.push(`infill-barrier ${side}`); if (dbg.length > 40) dbg.shift(); continue; }
        const center = Math.round((best.inner + best.outer) / 2);
        // N59: never fill into a military base's claim - a span across the base reads as one
        // huge gap, and an infill once planted a tower mid-claim
        const midC = claimed(center - (w >> 1) - 6, center + (w >> 1) + 6, city);
        if (midC) { dbg.push(`infill-claimed ${side}`); if (dbg.length > 40) dbg.shift(); continue; }
        lot.canvas = canvas;
        lot.gapWant = GAP_MIN + rand.int(2, 10);
        lot.massEdge = best.i === 0 ? null : lots[best.i - 1].massEdge;
        if (!pay(city, 'lot')) return false;   // N4
        lot.owner = allotOwner();
        if (!placeLot(city, lot, center)) { world.buildings.pop(); continue; }
        lots.splice(best.i, 0, lot);
        lots.forEach((l, k) => { l.ring = k; });
        note(city, 'a gap fills in');
        return true;
      }
      return false;
    }

    // Seat one lot at its tightened gap from `edge`. A lot stays on the land mass it was born
    // on (N43's drift-free rule): one born across a barrier is held past it (lot.massEdge), one
    // born on the near side packs up against the shore and never crosses. Returns the new outer
    // edge, or null if the lot could not be seated at all.
    function seatOne(city, lot, dir, edge) {
      const w = bodyWidth(lot.canvas || (lot.canvas = canvasFor(city, lot)));
      let cursor = edge + dir * gapFor(city, lot);
      if (lot.massEdge != null) cursor = dir > 0 ? Math.max(cursor, lot.massEdge) : Math.min(cursor, lot.massEdge);
      const b = barrierIn(cursor, cursor + dir * (w + 6));
      if (b) {
        if ((dir > 0 && lot.x <= b.x0) || (dir < 0 && lot.x >= b.x1)) {
          // its own shore: hold short of the barrier. If the shore is already full, there is
          // no seat left on this land mass - the lot is dismantled rather than stamped over
          // its neighbour (the overlap that scrambled the gothic waterfront).
          const shore = dir > 0 ? b.x0 - 6 - w : b.x1 + 6 + w;
          cursor = dir > 0 ? Math.min(cursor, shore) : Math.max(cursor, shore);
          if (dir > 0 ? cursor < edge + GAP_MIN : cursor > edge - GAP_MIN) return null;
        } else {
          cursor = dir > 0 ? b.x1 + 8 : b.x0 - 8;   // born beyond it: the bridge or road is laid
        }
      }
      // N59: a military base in the way of a re-seat - the town holds short of its claim
      // when the slot fits, and otherwise passes beyond it; it never builds over the base
      // (the base's growing claim used to swallow re-seated lots).
      if (cursor !== null && city.kind !== 'military') {
        const span0 = Math.min(cursor, cursor + dir * (w + 6)), span1 = Math.max(cursor, cursor + dir * (w + 6));
        const milC = (() => { const o = claimed(span0, span1, city); return o && o.kind === 'military' ? o : null; })();
        if (milC) {
          const cl = milC.edge.left - CLAIM - 4, cr = milC.edge.right + CLAIM + 4;
          if (dir > 0) {
            const hold = Math.min(cursor, cl - (w + 6));
            if (hold >= edge + GAP_MIN) cursor = hold;
            else { cursor = cr; lot.massEdge = cursor; }
          } else {
            const hold = Math.max(cursor, cr + (w + 6));
            if (hold <= edge - GAP_MIN) cursor = hold;
            else { cursor = cl; lot.massEdge = cursor; }
          }
        }
      }
      let center = cursor === null ? lot.x : cursor + dir * (w / 2 + 2);
      // The map's edge: the chain may not push past it - the caller holds everything from
      // here at its old seat (jumping some lots and holding others scrambled the order, and
      // the infill then stamped into the scramble).
      if (center - w / 2 < 60 || center + w / 2 > world.width - 60) return 'stop';
      if (!placeLot(city, lot, center) && !placeLot(city, lot, center + dir * 8) && !placeLot(city, lot, lot.x)) return null;
      // N51: honour the gap as the eye sees it. A building's works (retaining walls, stages)
      // can reach back toward its inner neighbour and swallow the spacing - if they did,
      // re-seat once, further out by what was lost.
      if (cursor !== null && !b) {
        const want = Math.abs(cursor - edge);
        const got = Math.abs((dir > 0 ? lot.placed.worksL : lot.placed.worksR) - edge);
        if (got + 3 < want) {
          const c2 = center + dir * (want - got);
          eraseLot(lot);
          if (!placeLot(city, lot, c2) && !placeLot(city, lot, center)) return null;
        }
      }
      return dir > 0 ? lot.placed.worksR + 2 : lot.placed.worksL - 2;
    }
    // Re-seat a side's rings from `fromRing` outward: everything shuffles to its tightened gap
    // (N43), pushed out or pulled in as the widths demand.
    function seatChain(city, side, fromRing) {
      const dir = side === 'left' ? -1 : 1;
      const lots = city.rings[side];
      clearJoints(city, side, fromRing);   // N58: a joint comes down before its neighbours move
      let chain = lots.slice(fromRing);
      // N3 adoption: a standing town's own farm, base or core building never moves - the
      // chain re-seats up to it, and everything beyond keeps its ground.
      const fixedAt = chain.findIndex((l) => l.fixed);
      if (fixedAt >= 0) chain = chain.slice(0, fixedAt);
      for (const l of chain) eraseLot(l);
      let edge = fromRing === 0 ? city.capEdge[side] :
        (dir > 0 ? lots[fromRing - 1].placed.worksR + 2 : lots[fromRing - 1].placed.worksL - 2);
      for (let n = 0; n < chain.length; n += 1) {
        const e = seatOne(city, chain[n], dir, edge);
        if (e === 'stop') {
          // against the map's edge: this lot and all beyond it keep exactly their old seats
          city.blocked[side] = 'edge';
          for (let m = n; m < chain.length; m += 1) {
            const r = chain[m];
            if (!placeLot(city, r, r.x)) r.placed = null;
            else edge = dir > 0 ? r.placed.worksR + 2 : r.placed.worksL - 2;
          }
          break;
        }
        if (e === null) { chain[n].placed = null; continue; }
        edge = e;
      }
      city.rings[side] = lots.filter((l) => l.placed);
      city.rings[side].forEach((l, i) => { l.ring = i; });
      // (the side's edge is the OUTERMOST stand - with a fixed tail beyond the chain, the
      // chain's own end is not the town's end)
      const lastL = city.rings[side][city.rings[side].length - 1];
      city.edge[side] = lastL ? (dir > 0 ? lastL.placed.worksR + 2 : lastL.placed.worksL - 2) : edge;
      return city.edge[side];
    }

    // N48: levels rise with age. A building starts at level 1 when the edge reaches it and
    // levels up as it stands, so the innermost are the highest for having stood longest, and
    // the rise rolls outward with time - the N45 skyline is the age gradient made visible.
    // (A lot never outlevels its city.) A taller tower is wider too: it keeps its tightened
    // inner gap (N43), and it and every lot outward of it re-seat, the chain shuffling out by
    // the width gained - the centre stays packed while the towers rise. One building comes of
    // age per tick, oldest first.
    function ageLots(city) {
      for (const lot of [...city.rings.left, ...city.rings.right].sort((a, b) => a.ring - b.ring)) {
        if (lot.type !== 'population' && !(lot.type === 'military' && lot.variant === 'tower')) continue;
        if (city.blocked[lot.side] === 'edge') continue;   // pinned at the map's edge: no room to grow
        if (lot.placed && nearBlast(lot.placed.worksL, lot.placed.worksR)) continue;   // N60: never into a live collapse
        if (stillBuilding(lot)) continue;   // N73: a tower finishes rising before it ages
        const target = Math.min(MAX_LEVEL, city.level, 1 + Math.floor(lot.age / AGE_PER_LEVEL));
        if (target <= lot.level) continue;
        // N4: a tower coming of age is a level-up - it is paid for. An unfunded town stops
        // aging (so its re-seats stop churning its bundle: the mend then drains the cuts
        // instead of racing free age-ups for ever - the adoption era's bundle-break fix).
        if (!pay(city, 'level')) continue;
        lot.level += 1;
        lot.canvas = canvasFor(city, lot);
        seatChain(city, lot.side, lot.ring);
        if (!lot.placed) {
          lot.level -= 1; lot.canvas = null;
          seatChain(city, lot.side, Math.min(lot.ring, city.rings[lot.side].length));
          dbg.push(`age-lost ${lot.side}`);
          if (dbg.length > 40) dbg.shift();
          return false;
        }
        note(city, `ring ${lot.ring} comes of age: level ${lot.level}`);
        // N55: the military spreads along as it grows - every other level, the armour takes
        // the next tower over, and the merged bases tie themselves together below grade.
        if ((lot.mil || lot.variant === 'tower') && lot.level % 2 === 0) {
          const lots = city.rings[lot.side];
          const next = [lots[lot.ring - 1], lots[lot.ring + 1]].find((n) => n && n.placed && n.type === 'population' && !n.mil && !stillBuilding(n));
          if (next) {
            next.mil = true; next.canvas = null;
            seatChain(city, lot.side, Math.min(lot.ring, next.ring));
            if (!next.placed) { next.mil = false; next.canvas = null; seatChain(city, lot.side, Math.min(lot.ring, next.ring)); }
            else note(city, 'the armour spreads to the next tower');
          }
        }
        if (lot.mil || lot.variant === 'tower') layPodiums(city, lot.side);
        return true;
      }
      return false;
    }

    // The city levels up: the capital grows grander, and the whole cluster tightens toward it
    // (N43) - every ring is re-seated inner-first with its tightened gap. Rings past a barrier
    // stay on their own land mass, pulled up against its shore.
    function levelUp(city) {
      city.level += 1;
      // N3 adoption: a standing town's main is the god's own core building - it is never
      // erased or re-stamped; the rings tighten around it as it stands.
      if (!city.main.fixed) {
        eraseLot(city.main);
        // N33: the seat's own grandeur follows its rank - a later capital's main stays
        // below the first's even full-grown.
        city.main.level = Math.min(city.levelCap || 7, city.level + 1);
        city.main.canvas = null;
        if (!placeLot(city, city.main, city.main.x)) { city.main.level -= 1; city.main.canvas = null; placeLot(city, city.main, city.main.x); }
        city.capEdge = { left: city.main.placed.worksL - 2, right: city.main.placed.worksR + 2 };
      }
      for (const side of ['left', 'right']) {
        seatChain(city, side, 0);
        if (city.blocked[side] && city.blocked[side] !== 'merged' && city.blocked[side] !== 'edge') city.blocked[side] = null;
      }
      paveSegment(city, city.edge.left, city.edge.right);
      note(city, `level ${city.level}: the centre tightens`);
      return true;
    }

    // ---- Farms (N46): fields first, outbuildings sometimes -----------------------------------
    function extendFields(city, side) {
      if (city.blocked[side] && city.blocked[side] !== 'water' && city.blocked[side] !== 'water-wide') return false;
      const dir = side === 'left' ? -1 : 1;
      const from = city.fieldEdge[side] + dir * 3;
      const len = 44 + rand.int(0, 26);
      const to = from + dir * len;
      if (Math.min(from, to) < 60 || Math.max(from, to) > world.width - 60) { city.blocked[side] = 'edge'; return false; }
      const b = barrierIn(from, to);
      if (b) {
        if (b.kind === 'mountain') { city.blocked[side] = 'farm-mountain'; return false; }   // farms never cross
        if (b.x1 - b.x0 > FARM_BRIDGE_MAX) { city.blocked[side] = 'water-wide'; return false; }
        if (city.level < FARM_BRIDGE_LEVEL) { city.blocked[side] = 'water'; return false; }
        if (!city.bridges.some((g) => g.x0 === b.x0)) bridge(city, b, false);
        city.fieldEdge[side] = dir > 0 ? b.x1 + 3 : b.x0 - 3;
        city.blocked[side] = null;
        return true;
      }
      // N54/N69: the farm smooths its land first - the slope KEEPS its relative height,
      // the shape just eased (never flattened to a line); what the smoothing cannot
      // touch, the old slope gate still judges.
      smoothGrade(from, to, FARM_GRADE.maxMove);
      for (let x = Math.min(from, to) + 16; x <= Math.max(from, to); x += 1) {
        if (Math.abs(surf(x) - surf(x - 16)) > 9) { city.blocked[side] = 'farm-mountain'; return false; }
      }
      const other = claimed(from, to, city);
      if (other) {
        if (other.kind === 'military') {
          // N59: the base never stops the farm - the fields pass it and carry on beyond
          city.fieldEdge[side] = dir > 0 ? other.edge.right + CLAIM + 4 : other.edge.left - CLAIM - 4;
          if (!city.merged.has(other.id)) { city.merged.add(other.id); other.merged.add(city.id); linkLines(city, other); note(city, 'the fields pass the base'); }
          return true;
        }
        city.blocked[side] = 'merged';
        if (!city.merged.has(other.id)) { city.merged.add(other.id); other.merged.add(city.id); linkLines(city, other); note(city, `fields meet ${other.kind} ${other.id}`); }
        return false;
      }
      const field = ST.sowField(world, Math.min(from, to), Math.max(from, to), (x) => world.groundTop[x], rand);
      field.growth = 0.12;
      ST.drawCrop(world, field);
      field.stage = 0;
      city.fields.push(field);
      city.fieldEdge[side] = to;
      city.edge[side] = dir > 0 ? Math.max(city.edge[side], to) : Math.min(city.edge[side], to);
      city.blocked[side] = null;
      return true;
    }
    const FARM_OUT = ['barn', 'greenhouse', 'silos'];
    function farmOutbuilding(city, side) {
      // Outbuildings are the exception among the fields, never a march of their own: a blocked
      // side stays blocked, the map's edge stops them, and they stay few against the fields
      // (unchecked, a line of 46 barns once crawled thirteen thousand cells off the map).
      if (city.blocked[side]) return false;
      if (city.rings[side].length >= 2 + Math.floor(city.fields.length / 4)) return false;
      const dir = side === 'left' ? -1 : 1;
      const lot = { type: 'farm', level: 1 + rand.int(0, 1), ring: city.rings[side].length, side, bornLevel: city.level,
        variant: FARM_OUT[rand.int(0, FARM_OUT.length - 1)], seedN: seedN += 17, owner: 0 };
      const canvas = canvasFor(city, lot);
      const w = bodyWidth(canvas);
      const cursor = city.fieldEdge[side] + dir * 10;
      const far = cursor + dir * (w + 8);
      if (Math.min(cursor, far) < 80 || Math.max(cursor, far) > world.width - 80) { city.blocked[side] = 'edge'; return false; }
      if (barrierIn(cursor, far) || claimed(cursor, far, city)) return false;
      if (!pay(city, 'lot')) { city.blocked[side] = 'upkeep'; return false; }   // N4
      lot.canvas = canvas;
      lot.owner = allotOwner();
      if (!placeLot(city, lot, cursor + dir * (w / 2 + 2))) { world.buildings.pop(); return false; }
      city.rings[side].push(lot);
      city.fieldEdge[side] = dir > 0 ? lot.placed.worksR + 4 : lot.placed.worksL - 4;
      city.edge[side] = dir > 0 ? Math.max(city.edge[side], lot.placed.worksR) : Math.min(city.edge[side], lot.placed.worksL);
      return true;
    }

    // N55: dropped into the city, the military squeezes a vertical hangar between buildings
    // if a gap takes it, and otherwise merges into the nearest population tower - the tower
    // militarised: bulkier, harder walls and floors, an armour layer over its bones.
    function militariseDrop(city, x) {
      for (const side of ['left', 'right']) {
        const dir = side === 'left' ? -1 : 1;
        const lots = city.rings[side];
        for (let i = 0; i < lots.length; i += 1) {
          if (!lots[i].placed) continue;
          const inner = i === 0 ? city.capEdge[side] : (dir > 0 ? lots[i - 1].placed.worksR : lots[i - 1].placed.worksL);
          const outer = dir > 0 ? lots[i].placed.worksL : lots[i].placed.worksR;
          if (dir > 0 ? outer <= inner : outer >= inner) continue;
          const lo = Math.min(inner, outer), hi = Math.max(inner, outer);
          if (x < lo + 20 || x > hi - 20) continue;            // the drop must point into this gap
          if (hi - lo < 116 + 2 * GAP_MIN) continue;           // the tower needs its slot
          const lot = { type: 'military', level: Math.max(1, city.level - 2), age: 0, ring: i, side, bornLevel: city.level,
            variant: 'tower', seedN: seedN += 17, owner: 0, gapWant: GAP_MIN + rand.int(2, 8) };
          lot.canvas = canvasFor(city, lot);
          lot.massEdge = i === 0 ? null : lots[i - 1].massEdge;
          if (!pay(city, 'mil')) return { ok: false, note: 'the war chest is short' };   // N4
          lot.owner = allotOwner();
          if (!placeLot(city, lot, Math.round((lo + hi) / 2))) { world.buildings.pop(); continue; }
          lots.splice(i, 0, lot);
          lots.forEach((l, k) => { l.ring = k; });
          layPodiums(city, side);
          layWingRunway(city, lot);
          note(city, 'a hangar tower squeezes in between the buildings');
          return { ok: true, city };
        }
      }
      // N67: a drop aimed AT an already-militarised tower grows its SECOND wing - add-ons
      // stand on the left, the right, or both sides, each joining the building beside it.
      const secondWing = (l) => {
        if (nearBlast(l.placed.worksL, l.placed.worksR)) return { ok: false, note: 'under fire - wait for the dust' };
        if (!pay(city, 'mil')) return { ok: false, note: 'the war chest is short' };   // N4
        l.milBoth = true; l.canvas = null;
        clearWeld(l, 'weldL'); clearWeld(l, 'weldR');
        seatChain(city, l.side, l.ring);
        if (!l.placed) { l.milBoth = false; l.canvas = null; seatChain(city, l.side, Math.min(l.ring, city.rings[l.side].length)); return { ok: false, note: 'the works would not fit' }; }
        layPodiums(city, l.side);
        note(city, 'the second wing goes up: add-ons both sides');
        return { ok: true, city };
      };
      for (const side of ['left', 'right']) for (const l of city.rings[side]) {
        if (l.mil && !l.milBoth && l.placed && x >= l.placed.worksL - 12 && x <= l.placed.worksR + 12) return secondWing(l);
      }
      let best = null;
      for (const side of ['left', 'right']) for (const l of city.rings[side]) {
        if (l.type !== 'population' || l.mil || !l.placed) continue;
        if (!best || Math.abs(l.x - x) < Math.abs(best.x - x)) best = l;
      }
      // (with every tower already militarised, the drop falls to the nearest single wing)
      if (!best) {
        for (const side of ['left', 'right']) for (const l of city.rings[side]) {
          if (l.type !== 'population' || !l.mil || l.milBoth || !l.placed) continue;
          if (!best || Math.abs(l.x - x) < Math.abs(best.x - x)) best = l;
        }
        if (!best) return { ok: false, note: 'no tower to militarise' };
        return secondWing(best);
      }
      if (nearBlast(best.placed.worksL, best.placed.worksR)) return { ok: false, note: 'under fire - wait for the dust' };
      if (!pay(city, 'mil')) return { ok: false, note: 'the war chest is short' };   // N4
      best.mil = true; best.canvas = null;
      seatChain(city, best.side, best.ring);
      if (!best.placed) { best.mil = false; best.canvas = null; seatChain(city, best.side, Math.min(best.ring, city.rings[best.side].length)); return { ok: false, note: 'the works would not fit' }; }
      layPodiums(city, best.side);
      layWingRunway(city, best);
      note(city, 'a tower is militarised: armour over its bones');
      return { ok: true, city };
    }
    // N55: the bases of armoured neighbours merge - an armoured tie below grade redesigns the
    // ground between them into one defensive footing, a hazard seam at the surface.
    function layPodiums(city, side) {
      const lots = city.rings[side];
      const armoured = (l) => l && l.placed && (l.mil || l.variant === 'tower');
      for (let i = 0; i + 1 < lots.length; i += 1) {
        const a = lots[i], b2 = lots[i + 1];
        if (!armoured(a) || !armoured(b2)) continue;
        const [L, R] = a.placed.worksR < b2.placed.worksR ? [a, b2] : [b2, a];
        const x0 = L.placed.worksR + 1, x1 = R.placed.worksL - 1;
        if (x1 - x0 < 2 || x1 - x0 > 160) continue;
        for (let x = x0; x <= x1; x += 1) {
          const g = world.groundTop[x];
          // the apron is FLUSH with the grade - the grass row becomes plate, no step to climb
          for (let y = g; y <= g + 5; y += 1) {
            const id = PW.get(world, x, y) & 63;
            if (id === M.FOUNDATION) break;
            if (id !== M.GRASS && id !== M.TOPSOIL && id !== M.SOIL) continue;
            PW.set(world, x, y, M.FOUNDATION, Q);
            const hazard = y === g && (x & 7) < 3;
            PW.setLayer(world, 'paint', x, y, PW.abgr ? PW.abgr(...(hazard ? [196, 164, 58, 255] : y === g ? [96, 100, 106, 255] : ((x + y) & 1) ? [74, 78, 84, 255] : [64, 67, 73, 255])) : 0);
          }
          PW.setLayer(world, 'deco', x, g - 1, 0);   // the grass blades over the apron are cleared
        }
        clearSimAround(x0, world.groundTop[x0] - 2, x1, world.groundTop[x1] + 8);
      }
    }

    // N57: a military base gets its runway for the planes and mechs - graded level with the
    // hangar floor out from the door, paved the settlements' way. Laid at the drop and again
    // after each level-up (the door moves as the base grows).
    function layRunway(city) {
      const rec = world.buildings[city.main.owner - 1];
      if (!rec || !rec.runway || !ST.paveRunway) return;
      const len = Math.min(rec.runway.length || 380, 380);
      const from = rec.runway.from, dir = rec.runway.direction, end = from + dir * len;
      if (Math.min(from, end) < 60 || Math.max(from, end) > world.width - 60) return;
      if (barrierIn(Math.min(from, end), Math.max(from, end))) return;   // never over water or a flank
      ST.terracePad(world, Math.min(from, end), Math.max(from, end), rec.ground);
      ST.paveRunway(world, from, dir, len, rec.ground, city.style);
      for (let x = Math.min(from, end) - 2; x <= Math.max(from, end) + 2; x += 1) PW.refreshGroundTop(world, x);
      clearSimAround(Math.min(from, end), rec.ground - 6, Math.max(from, end), rec.ground + 8);
      city.runway = { from, to: end, y: rec.ground };
      if (dir > 0) city.edge.right = Math.max(city.edge.right, end + 4);
      else city.edge.left = Math.min(city.edge.left, end - 4);
      note(city, 'the runway is laid');
    }
    // N65: a militarised tower's wing lays its own runway - a strip out from the wing's foot
    // at the grade, paved the settlements' way. The PAD stops short of the next building, but
    // the PAVING runs on into its apron (the user's rule: runways merge with the base of farm
    // and population buildings) - it rides the podium plates, cutting nothing.
    function layWingRunway(city, lot) {
      if (!ST.paveRunway || !ST.terracePad || !lot.placed) return;
      const dir = lot.side === 'left' ? -1 : 1;
      const from = dir > 0 ? lot.placed.worksR + 2 : lot.placed.worksL - 2;
      const lots = city.rings[lot.side];
      const next = lots[lot.ring + 1];
      const open = next && next.placed ? Math.abs((dir > 0 ? next.placed.worksL : next.placed.worksR) - from) - 4 : 150;
      let padLen = Math.max(24, Math.min(170, open));
      let paveLen = Math.min(200, padLen + (next && next.placed ? 26 : 0));
      let end = from + dir * paveLen;
      if (Math.min(from, end) < 60 || Math.max(from, end) > world.width - 60) { city.runwayNote = 'edge'; return; }
      // a pond or a flank in the way shortens the strip - the runway stops at the shore.
      // Even a short strip is laid: between towers it is the apron joining the two bases.
      const bar = barrierIn(Math.min(from, end), Math.max(from, end));
      if (bar) {
        const stop = dir > 0 ? bar.x0 - 6 : bar.x1 + 6;
        paveLen = Math.max(0, Math.abs(stop - from) - 2);
        padLen = Math.min(padLen, paveLen);
        if (paveLen < 18) { city.runwayNote = `shore at ${bar.x0}..${bar.x1}`; return; }
        end = from + dir * paveLen;
      }
      city.runwayNote = `laid ${paveLen}`;
      const g = world.groundTop[from];
      const padEnd = from + dir * padLen;
      ST.terracePad(world, Math.min(from, padEnd), Math.max(from, padEnd), g);
      ST.paveRunway(world, from, dir, paveLen, g, city.style);
      for (let x = Math.min(from, end) - 2; x <= Math.max(from, end) + 2; x += 1) PW.refreshGroundTop(world, x);
      clearSimAround(Math.min(from, end), g - 6, Math.max(from, end), g + 8);
      note(city, 'the wing lays its runway');
    }
    // N65: a re-seat beside a wing regrows the ground over its strip - so, like the base
    // runways (laid again after each level-up), the wings' strips are mended as the city
    // settles: one a step at most, under the heavy-work budget.
    function mendWingRunways(city) {
      for (const side of ['left', 'right']) {
        for (const l of city.rings[side]) {
          if (!l.placed || !(l.mil || (l.type === 'military' && l.variant === 'tower'))) continue;
          const dir = side === 'left' ? -1 : 1;
          const x = (dir > 0 ? l.placed.worksR : l.placed.worksL) + dir * 12;
          if (x < 2 || x >= world.width - 2) continue;
          // judge by the MATERIAL, not the flag: a re-seat's regrow turns the asphalt back
          // to grass but the ROAD flag survives it, and a flag test slept through the ruin
          const id = PW.get(world, x, world.groundTop[x]) & 63;
          if (id === M.ASPHALT || id === M.ROADBED) continue;
          layWingRunway(city, l);
          return true;
        }
      }
      return false;
    }
    // N66/N67: the merged mass reads as ONE building - no slot of air between a wing and
    // the building it reaches toward. A settle pass welds the gap world-side, the N58 way:
    // the wing's floor rows carried across as gallery slabs, the roof rows carried over
    // (the host's terrace design on a sloped tower), the band between back-filled, and a
    // doorway cut into the neighbour at every floor with a room behind the wall. The weld
    // belongs to the wing's owner; a dismantled wing takes it up (eraseLot wipes weldSpan),
    // and a re-seated neighbour gets it laid afresh (the signature goes stale).
    const S = PW.buildingKit.S;   // (KIT is declared further down; the kit global is loaded first)
    function clearWeld(l, key) {
      const w = l[key];
      if (!w) { l[key] = null; return; }
      // (N97: exactly the cells the weld laid - its runs reach into the buildings' recesses, and a
      // box round them took the wing's own glacis with it, the wing being the weld's owner too)
      const take = (x, y) => {
        if (PW.getOwner(world, x, y) !== l.owner) return;
        PW.set(world, x, y, M.AIR, Q);
        PW.setLayer(world, 'paint', x, y, 0);
        PW.setLayer(world, 'back', x, y, 0);
        PW.setOwner(world, x, y, 0);
      };
      if (w.cells) for (const i of w.cells) take(i % world.width, (i / world.width) | 0);
      else if (w.span) {
        const [wx0, wx1, wy0, wy1] = w.span;
        for (let y = Math.max(2, wy0); y <= Math.min(world.height - 2, wy1); y += 1) for (let x = wx0; x <= wx1; x += 1) take(x, y);
      }
      l[key] = null;
    }
    function weldWingAt(city, l, n, dir) {
      const key = dir > 0 ? 'weldR' : 'weldL';
      const a = dir > 0 ? l.placed.worksR + 1 : n.placed.worksR + 1;
      const b = dir > 0 ? n.placed.worksL - 1 : l.placed.worksL - 1;
      const gapW = b - a + 1;
      if (gapW < 1 || gapW > 46) return false;
      // N97: the faces are met as they STAND - so the weld waits until both buildings have risen
      // (N73, as the joints do), and is laid once more when both are whole: a weld laid round a
      // blueprint met no face and carried nothing across (the user's gaps).
      if (stillBuilding(l) || stillBuilding(n)) return false;
      const rec = world.buildings[l.owner - 1], nrec = world.buildings[n.owner - 1];
      const whole = (r) => ((r && r.health) || 0) >= 0.99 ? 1 : 0;
      const sig = `${n.placed.x0}|${a}|${whole(rec)}${whole(nrec)}`;
      if (l[key] && l[key].sig === sig) return false;
      const wing = (rec.floors || []).filter((f) => f.wing).sort((p, q) => p.y - q.y);
      if (!wing.length) return false;
      clearWeld(l, key);
      const sloped = ['setback', 'tapered', 'crown', 'spire', 'needle'].includes(l.variant || '');
      const wingTopY = wing[0].y - S.FLOOR + S.SLAB;   // the wing's roof band sits here
      const backTone = (x, y) => (((x + y) % 9) ? [34, 38, 46] : [40, 45, 54]);
      const slabRow = new Map();
      for (const f of wing) for (let r = 0; r < S.SLAB; r += 1) slabRow.set(f.y + r, r);
      // N97: every row of the merged height is carried across from the one building's face to
      // the other's - the faces as they stand, not the lots' works lines: a sloped tower's
      // storeys recede inside its works, and a weld laid between the works lines left open air
      // either side of it (and a band under each slab bare). Roof rows as the roof, floor rows
      // as gallery slabs, every row between them back-walled, all of it the wing's.
      const xc = Math.round((a + b) / 2);
      const open = (x, y) => (PW.get(world, x, y) & 63) === M.AIR && !PW.getLayer(world, 'back', x, y) && !PW.getOwner(world, x, y);
      const own = (x, y) => { const o = PW.getOwner(world, x, y); return o === l.owner || o === n.owner; };
      const REACH = 70;
      let spanL = a, spanR = b;
      const faceAt = new Map();   // row -> the neighbour's face met there
      const laid = [];            // every cell the weld lays (clearWeld takes up exactly these)
      const bottomY = world.groundTop[Math.max(0, Math.min(world.width - 1, xc))];
      for (let yy = wingTopY - 1; yy < bottomY; yy += 1) {
        if (!open(xc, yy)) continue;
        let L = xc, R = xc;
        while (xc - L < REACH && open(L - 1, yy)) L -= 1;
        while (R - xc < REACH && open(R + 1, yy)) R += 1;
        // (closed in on both sides by the two buildings - else it is sky or ground, not a gap)
        if (!own(L - 1, yy) || !own(R + 1, yy)) continue;
        faceAt.set(yy, dir > 0 ? R + 1 : L - 1);
        spanL = Math.min(spanL, L); spanR = Math.max(spanR, R);
        for (let x = L; x <= R; x += 1) {
          if (yy <= wingTopY) {
            PW.set(world, x, yy, sloped ? M.CONCRETE : M.STEEL, Q);
            PW.setLayer(world, 'paint', x, yy, PW.abgr(...(sloped ? [104, 106, 110, 255] : (((x >> 1) & 1) ? [196, 164, 58, 255] : [64, 68, 74, 255]))));
          } else if (slabRow.has(yy)) {
            PW.set(world, x, yy, M.STEEL, Q);
            PW.setLayer(world, 'paint', x, yy, PW.abgr(...(slabRow.get(yy) === 0 ? [88, 92, 100, 255] : [56, 60, 68, 255])));
          } else PW.setLayer(world, 'back', x, yy, PW.abgr(...backTone(x, yy), 255));
          PW.setOwner(world, x, yy, l.owner);
          laid.push(yy * world.width + x);
        }
      }
      // ...and no pocket of open air is left sealed in the joined mass: between the two
      // buildings' middles, under the wing's roof, a run with neither cell nor back wall closed
      // in on both sides by the two (an armour skin's plates and belts round a recess left
      // some) is back-walled, the wing's
      const recN = world.buildings[n.owner - 1];
      const mid = (r, p) => (r && r.body ? Math.round((r.body.left + r.body.right) / 2) : Math.round((p.worksL + p.worksR) / 2));
      const px0 = Math.min(mid(rec, l.placed), mid(recN, n.placed)), px1 = Math.max(mid(rec, l.placed), mid(recN, n.placed));
      for (let yy = wingTopY - 1; yy < bottomY; yy += 1) {
        let x = px0;
        while (x <= px1) {
          if (!open(x, yy)) { x += 1; continue; }
          let e = x;
          while (e <= px1 && open(e, yy)) e += 1;
          if (e <= px1 && e - x <= 40 && own(x - 1, yy) && own(e, yy)) {
            for (let k = x; k < e; k += 1) {
              PW.setLayer(world, 'back', k, yy, PW.abgr(...backTone(k, yy), 255));
              PW.setOwner(world, k, yy, l.owner);
              laid.push(yy * world.width + k);
            }
            spanL = Math.min(spanL, x); spanR = Math.max(spanR, e - 1);
          }
          x = e;
        }
      }
      // a doorway into the neighbour at every floor with a room behind its wall - cut where its
      // face stands at that row
      for (const f of wing) {
        const face = faceAt.get(f.y - 2);
        const wallX0 = face !== undefined ? (dir > 0 ? face : face - 7) : (dir > 0 ? n.placed.worksL : n.placed.worksR - 7);
        const probeX = dir > 0 ? wallX0 + 9 : wallX0 - 2;
        let roomRows = 0;
        for (let yy = f.y - S.DOOR_H; yy < f.y; yy += 1) {
          if ((PW.get(world, probeX, yy) & 63) === M.AIR && PW.getLayer(world, 'back', probeX, yy)) roomRows += 1;
        }
        if (roomRows < S.DOOR_H * 0.6) continue;
        for (let yy = f.y - S.DOOR_H; yy < f.y; yy += 1) {
          for (let d = 0; d < 8; d += 1) {
            const x = wallX0 + d;
            if (PW.getOwner(world, x, yy) !== n.owner) continue;
            const id = PW.get(world, x, yy) & 63;
            if (!PW.mat.structural[id] && id !== M.GLASS) continue;
            PW.set(world, x, yy, M.AIR, Q);
            PW.setLayer(world, 'paint', x, yy, 0);
            if (!PW.getLayer(world, 'back', x, yy)) PW.setLayer(world, 'back', x, yy, PW.abgr(40, 44, 52, 255));
          }
        }
      }
      l[key] = { sig, span: [spanL, spanR, wingTopY - 2, bottomY], cells: laid };
      clearSimAround(spanL - 2, wingTopY - 4, spanR + 2, bottomY + 4);
      note(city, 'the wing is welded to its neighbour: one building');
      return true;
    }
    function weldWings(city) {
      for (const side of ['left', 'right']) {
        const lots = city.rings[side];
        const dir = side === 'left' ? -1 : 1;
        for (const l of lots) {
          if (!l.mil || !l.placed) continue;
          const out = lots[l.ring + 1];
          if (out && out.placed && weldWingAt(city, l, out, dir)) return true;
          // N67: a both-sided tower also joins the building on its inner flank
          if (l.milBoth) {
            const inn = l.ring > 0 ? lots[l.ring - 1] : null;
            if (inn && inn.placed && weldWingAt(city, l, inn, -dir)) return true;
          }
        }
      }
      return false;
    }
    // N57: the bases of population and farm buildings adapt to the military's terrain changes
    // as it grows - a neighbour whose facing lots sit on reshaped ground re-seats there.
    function adaptNeighbours(milCity) {
      const clL = milCity.edge.left - CLAIM, clR = milCity.edge.right + CLAIM;
      for (const other of cities) {
        if (other === milCity || other.kind === 'military') continue;
        const side = other.x < milCity.x ? 'right' : 'left';
        const lots = other.rings[side];
        // N59: the base grew - lots held beyond it move their hold out with it, and any lot
        // the new works now reach under re-seats clear of them.
        for (const lot of lots) {
          if (lot.massEdge == null) continue;
          if (lot.massEdge > clL && lot.massEdge < clR) lot.massEdge = other.x < milCity.x ? clR + 6 : clL - 6;
        }
        for (let i = 0; i < lots.length; i += 1) {
          const lot = lots[i];
          if (!lot.placed) continue;
          if (lot.placed.worksR >= clL && lot.placed.worksL <= clR) {
            seatChain(other, side, lot.ring);
            note(other, 'the town makes room for the base');
            break;
          }
        }
        for (let i = Math.max(0, lots.length - 2); i < lots.length; i += 1) {
          const lot = lots[i];
          if (!lot.placed || lot.groundSig === undefined) continue;
          if (apronSig(lot.placed) === lot.groundSig) continue;
          seatChain(other, side, lot.ring);
          note(other, 'the town re-seats around the military works');
          break;
        }
      }
    }

    // ---- Military ----------------------------------------------------------------------------
    const MIL_MAIN = ['compound', 'fortress', 'command', 'bastion'];
    function militaryAct(city) {
      if (city.actions % 3 === 2 && city.level < 6 && !nearBlast(city.capEdge.left, city.capEdge.right)) {
        city.level += 1;
        eraseLot(city.main);
        city.main.level = city.level;
        city.main.variant = MIL_MAIN[Math.min(3, (city.level - 1) >> 1)];
        city.main.canvas = null;
        if (!placeLot(city, city.main, city.main.x)) { city.main.level -= 1; city.main.canvas = null; placeLot(city, city.main, city.main.x); }
        city.capEdge = { left: city.main.placed.worksL - 2, right: city.main.placed.worksR + 2 };
        city.edge = { left: Math.min(city.edge.left, city.capEdge.left), right: Math.max(city.edge.right, city.capEdge.right) };
        layRunway(city);          // N57: the door moved with the bigger base - the strip follows
        adaptNeighbours(city);    // N57: the neighbours' bases adapt to the reshaped ground
        note(city, `dug in deeper: level ${city.level}`);
        return true;
      }
      const side = city.actions % 2 ? 'left' : 'right';
      if (city.rings[side].length >= 2) return false;
      const dir = side === 'left' ? -1 : 1;
      const lot = { type: 'military', level: 1, ring: city.rings[side].length, side, bornLevel: city.level,
        variant: 'compound', seedN: seedN += 17, owner: 0 };
      const canvas = canvasFor(city, lot);
      const w = bodyWidth(canvas);
      const cursor = city.edge[side] + dir * 14;
      if (barrierIn(cursor, cursor + dir * (w + 8)) || claimed(cursor, cursor + dir * (w + 8), city)) return false;
      if (!pay(city, 'lot')) { city.blocked[side] = 'upkeep'; return false; }   // N4
      lot.canvas = canvas;
      lot.owner = allotOwner();
      if (!placeLot(city, lot, cursor + dir * (w / 2 + 2))) { world.buildings.pop(); return false; }
      city.rings[side].push(lot);
      city.edge[side] = dir > 0 ? lot.placed.worksR + 2 : lot.placed.worksL - 2;
      if (!PW.NO_LANE_GRADING) gradeLane(city.capEdge[side], dir > 0 ? lot.placed.worksL : lot.placed.worksR);   // N3 vehicle rule
      paveSegment(city, city.capEdge[side], dir > 0 ? lot.placed.worksL : lot.placed.worksR);
      refreshSigs(city, Math.min(city.capEdge[side], lot.placed.worksL), Math.max(city.capEdge[side], lot.placed.worksR));
      return true;
    }

    // ---- N58: merge points ---------------------------------------------------------------------
    // Where two buildings stand close, they join through a merge point: a three-floor base
    // spanning the gap, continuing the floor design, with a monument, statue, fountain or
    // park in its ground hall - whichever suits the pair - and at its middle a NEW PRIMAL
    // CORE in its own vault. When either neighbour re-seats, the joint is taken down first
    // and the pair may merge again once they stand still.
    const JOINT_EVERY = 200, JOINT_MIN = 10, JOINT_MAX = 110;   // N70: a tight slot is the divided wall - it joints too
    const KIT = PW.buildingKit;
    const tone = KIT.tone;
    function jointDecorKind(a, b) {
      const kinds = [a, b].sort().join('+');
      if (kinds.includes('military')) return kinds.includes('population') ? 'statue' : 'monument';
      if (kinds.includes('farm')) return 'park';
      return (PW.hash2(seedN, 7) & 1) ? 'fountain' : 'park';
    }
    function jointDecor(c, kind, cx, ground, P) {
      const d = KIT.deco, s = (x, y, m, col) => KIT.solid(c, x, y, m, col, 6);
      if (kind === 'fountain') {
        for (let dx = -13; dx <= 13; dx += 1) {
          const edge = Math.abs(dx) >= 12;
          s(cx + dx, ground - 1, M.MASONRY, edge ? tone(P.ornament, 1.1) : [96, 152, 192]);
          s(cx + dx, ground - 2, M.MASONRY, edge ? tone(P.ornament, 0.9) : [134, 192, 226]);
        }
        s(cx - 1, ground - 3, M.MASONRY, tone(P.ornament, 1.05)); s(cx + 1, ground - 3, M.MASONRY, tone(P.ornament, 1.05));
        s(cx, ground - 4, M.MASONRY, tone(P.ornament, 1.15));
        for (let dy = 5; dy <= 14; dy += 1) d(c, cx, ground - dy, dy > 12 ? [214, 238, 252] : [152, 206, 240]);
        for (const [dx, dy] of [[-2, 12], [2, 12], [-4, 9], [4, 9], [-1, 14], [1, 14], [-3, 6], [3, 6]]) d(c, cx + dx, ground - dy, [192, 226, 246]);
      } else if (kind === 'statue') {
        for (let dx = -5; dx <= 5; dx += 1) for (let dy = 1; dy <= 3; dy += 1) {
          s(cx + dx, ground - dy, M.MASONRY, tone(P.ornament, dy === 3 ? 1.2 : 1));
        }
        const bronze = [104, 84, 56], dark = [74, 60, 40];
        for (let dy = 4; dy <= 10; dy += 1) { s(cx - 1, ground - dy, M.COVER_METAL, dy & 1 ? bronze : dark); s(cx + 1, ground - dy, M.COVER_METAL, dy & 1 ? dark : bronze); }
        for (let dy = 11; dy <= 14; dy += 1) s(cx, ground - dy, M.COVER_METAL, bronze);
        s(cx, ground - 15, M.COVER_METAL, [128, 104, 70]);                        // the head
        s(cx - 2, ground - 12, M.COVER_METAL, dark); s(cx - 3, ground - 13, M.COVER_METAL, bronze);   // the raised arm
      } else if (kind === 'monument') {
        for (let dx = -6; dx <= 6; dx += 1) for (let dy = 1; dy <= 3; dy += 1) s(cx + dx, ground - dy, M.MASONRY, tone(P.ornament, dy === 3 ? 1.15 : 0.95));
        for (let dy = 4; dy <= 30; dy += 1) {
          const half = Math.max(1, Math.round(3 * (1 - (dy - 4) / 30)));
          for (let dx = -half; dx <= half; dx += 1) s(cx + dx, ground - dy, M.MASONRY, dx < 0 ? [168, 164, 156] : dx > 0 ? [112, 110, 104] : [142, 139, 132]);
        }
        d(c, cx, ground - 31, [226, 190, 60]);                                    // the gold cap
      } else {   // the park
        for (let dx = -16; dx <= 16; dx += 1) s(cx + dx, ground - 1, M.GRASS, [86, 126, 56]);
        for (const tx of [cx - 10, cx + 9]) {
          for (let dy = 2; dy <= 7; dy += 1) s(tx, ground - dy, M.WOOD, [104, 76, 48]);
          for (let dy = 6; dy <= 12; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
            if (Math.abs(dx) + Math.abs(dy - 9) <= 4) d(c, tx + dx, ground - dy, (PW.hash2(tx + dx, dy) & 3) ? [84, 136, 60] : [108, 162, 74]);
          }
        }
        for (let dx = -2; dx <= 2; dx += 1) d(c, cx + dx, ground - 3, [140, 104, 66]);   // the bench
        d(c, cx - 2, ground - 2, [96, 70, 46]); d(c, cx + 2, ground - 2, [96, 70, 46]);
      }
    }
    // The joint's canvas: three floors on the kit's own pitch, slabs and back walls in the
    // pair's style, frame columns at the seams, the decor in the ground hall, the primal
    // core's vault under the middle.
    // N70: where two bases meet they CONNECT - the joint roots its core in the centre of
    // the gap, and a central PILLAR rises from the joint block to the shorter tower's
    // roofline, tying the two through their floors (slab arms at every storey row) and
    // their roofs (the spine's cap). `rise` is how far the spine climbs above the block.
    function buildJoint(style, w, decorKind, rise = 0) {
      const S2 = KIT.S, P = KIT.STYLES[style], R = KIT;
      const ground = 3 * S2.FLOOR + 10 + Math.max(0, rise);
      const c = R.createCanvas(w, ground + R.VAULT_DEPTH + 5, ground);
      c.meta = { type: 'joint', style, decor: decorKind };
      const floorRow = (k) => ground - k * S2.FLOOR;
      for (let k = 0; k < 3; k += 1) {
        const fRow = floorRow(k);
        R.rect(c, 2, fRow - S2.CLEAR, w - 3, fRow - 1, (x, y) => R.back(c, x, y, R.backWallColor(style, x, y, fRow - 1 - y, 2, w - 3)));
        for (let wx = 10; wx < w - 16; wx += 30) if (k > 0) R.backWindow(c, style, wx, fRow, (PW.hash2(wx, k) & 3) !== 0);
        R.ceilingLamp(c, style, w >> 1, fRow - S2.CLEAR + 2);
        for (let x = 2; x < w - 2; x += 1) for (let r = 0; r < S2.SLAB; r += 1) {
          R.solid(c, x, floorRow(k + 1) + r, M.CONCRETE, R.slabColor(style, r, x, floorRow(k + 1) + r), k === 2 ? 4 : 2);
        }
      }
      for (let x = 2; x < w - 2; x += 1) for (let r = 0; r < S2.SLAB; r += 1) {
        R.solid(c, x, ground - 1 - r, M.CONCRETE, R.slabColor(style, r, x, ground - 1 - r), 2);
      }
      for (const lx of [0, 1, w - 2, w - 1]) {
        for (let y = floorRow(3) - S2.SLAB; y < ground; y += 1) R.solid(c, lx, y, M.STEEL, tone(P.frame, lx < 2 ? 1.05 : 0.8), 1);
      }
      // The spine: the central pillar over the core, arms at every storey row, the cap.
      if (rise > S2.FLOOR && w >= 12) {
        const cx = w >> 1;
        const spineTop = floorRow(3) - rise;                 // rows above the block it climbs
        const arms = Math.floor((rise - 8) / S2.FLOOR);
        for (let y = Math.max(6, spineTop); y <= floorRow(3); y += 1) {
          for (let dx = -3; dx <= 4; dx += 1) {
            const edge = dx === -3 || dx === 4;
            const band = ((floorRow(3) - y) % S2.FLOOR) < 2;
            R.solid(c, cx + dx, y, M.PILLAR, tone(P.frame, edge ? 0.78 : band ? 1.18 : 1), 1);
          }
        }
        for (let j = 1; j <= arms; j += 1) {
          const ay = floorRow(3 + j);
          if (ay < Math.max(6, spineTop) + 4) break;
          for (let x = 0; x < w; x += 1) {
            for (let r = 0; r < S2.SLAB; r += 1) R.solid(c, x, ay + r, M.CONCRETE, R.slabColor(style, r, x, ay + r), 2);
          }
          // a thin rail over the open bridge, posts every few cells
          for (let x = 3; x < w - 3; x += 6) {
            for (let r = 1; r <= 3; r += 1) R.solidIfEmpty(c, x, ay - r, M.STEEL, tone(P.ornament, r === 3 ? 1.1 : 0.85), 4);
          }
          R.ceilingLamp(c, style, cx - 8, ay - S2.CLEAR + 10);
        }
        const capY = Math.max(4, spineTop - 2);
        for (let x = 0; x < w; x += 1) {
          for (let r = 0; r < S2.SLAB; r += 1) R.solid(c, x, capY + r, M.CONCRETE, R.slabColor(style, r, x, capY + r), 4);
        }
        for (const lx of [1, w - 2]) for (let r = 1; r <= 2; r += 1) R.solidIfEmpty(c, lx, capY - r, M.CONCRETE, tone(P.ornament, 0.9), 4);
      }
      if (w >= 26) jointDecor(c, decorKind, w >> 1, ground, P);   // (a narrow slot has no room for the piece)
      R.core(c, w >> 1, ground);
      R.corePillars(c, style);
      if (!PW.NO_UNDERCROFT) R.undercroft(c, style, 0, w - 1);   // N3 vehicle rule: the spine arches over the lane at grade
      R.bakeLights(c, style);
      c.body = { left: 0, right: w - 1, top: 0, bottom: ground - 1 };
      return c;
    }
    function eraseJoint(city, J) {
      eraseLot({ owner: J.owner, placed: J.placed, faction: J.faction || city.faction || null });
      const un = (ow) => {
        for (const side of ['left', 'right']) for (const l of city.rings[side]) if (l.owner === ow) l.jointWith = null;
      };
      un(J.a); un(J.b);
    }
    function clearJoints(city, side, fromRing) {
      // joints find their neighbours by OWNER at call time - ring indices go stale the moment
      // an infill splices or a lot is dismantled (a stale index left one joint standing alone
      // in the open after its towers re-seated away)
      const lots = city.rings[side];
      const ringOf = (ow) => { const l = lots.find((q) => q.owner === ow); return l ? l.ring : Infinity; };
      for (let j = city.joints.length - 1; j >= 0; j -= 1) {
        const J = city.joints[j];
        if (J.side !== side) continue;
        if (ringOf(J.a) >= fromRing || ringOf(J.b) >= fromRing) { eraseJoint(city, J); city.joints.splice(j, 1); }
      }
    }
    function tryJoint(city) {
      // N70: a joint its towers have OUTGROWN rebuilds with a taller spine - the user's
      // case: two towers aged past their stubby early joint, a dead shaft of air between
      // them. One rebuild a pass; the ordinary pair scan re-joints it next call.
      const storeysOf = (ow) => { const r3 = world.buildings[ow - 1]; return (r3 && r3.canvas && r3.canvas.meta && r3.canvas.meta.storeys) || 3; };
      const riseFor = (aOw, bOw) => Math.max(0, Math.min(10 * KIT.S.FLOOR, (Math.min(storeysOf(aOw), storeysOf(bOw)) - 3) * KIT.S.FLOOR - 6));
      for (let ji = 0; ji < city.joints.length; ji += 1) {
        const J = city.joints[ji];
        if (riseFor(J.a, J.b) > (J.rise || 0) + KIT.S.FLOOR) {
          eraseJoint(city, J);
          city.joints.splice(ji, 1);
          note(city, 'the towers outgrew their joint: the spine rises taller');
          break;   // (fall through: the pair scan below re-joints it in this same call)
        }
      }
      for (const side of ['left', 'right']) {
        const dir = side === 'left' ? -1 : 1, lots = city.rings[side];
        for (let i = 0; i + 1 < lots.length; i += 1) {
          const A = lots[i], B = lots[i + 1];
          if (!A.placed || !B.placed || A.jointWith || B.jointWith) continue;
          if (A.level < 2 || B.level < 2) continue;
          if (stillBuilding(A) || stillBuilding(B)) continue;   // N73: joints weld finished towers
          const [L2, R2] = A.placed.worksR < B.placed.worksR ? [A, B] : [B, A];
          const gap = R2.placed.worksL - L2.placed.worksR - 1;
          if (gap < JOINT_MIN || gap > JOINT_MAX) continue;
          if (barrierIn(L2.placed.worksR, R2.placed.worksL)) continue;
          // the joint welds wall to wall: it reaches 3 cells into each neighbour's apron (the
          // works' edge is wider than the visible wall - a flush joint, no slit of air)
          const x0 = L2.placed.worksR - 2, w = gap + 6;
          const decorKind = jointDecorKind(A.type, B.type);
          // N70: the spine climbs to the SHORTER tower's roofline, tying floors and roofs.
          const rise = riseFor(A.owner, B.owner);
          const canvas = buildJoint(city.style, w, decorKind, rise);
          const owner = allotOwner();
          // N73: the joint too - its core lands first, and the spine climbs out of it.
          const growJ = !!(world.repair && !PW.INSTANT_BUILDS);
          const res = PW.foundations.place(world, canvas, x0, { style: city.style, owner, grow: growJ });
          if (!res) { world.buildings.pop(); continue; }
          const rec = PW.buildingRecord(world, res.stamp, { id: owner, side: 'left', faction: city.faction || null, type: 'joint', style: city.style, level: 1, kind: city.kind });
          for (const k of rec.cores) k.kind = 'main';
          rec.primal = true;
          world.buildings[owner - 1] = rec;
          const placed = { x0: res.stamp.x, y0: res.stamp.y, x1: res.stamp.x + res.stamp.width - 1,
            y1: res.stamp.y + res.stamp.height - 1, worksL: res.works[0], worksR: res.works[1] };
          for (let x = placed.worksL - 2; x <= placed.worksR + 2; x += 1) PW.refreshGroundTop(world, x);
          // N70: doorways through both towers' walls at every arm row with a room behind it,
          // so the floors genuinely run through the spine (the N66 weld's probe rule).
          {
            const S3 = KIT.S;
            const groundW = world.buildings[owner - 1].ground;
            const arms = Math.floor((rise - 8) / S3.FLOOR);
            for (let j = 1; j <= arms + 3; j += 1) {
              const fy = groundW - j * S3.FLOOR;
              for (const [wallX0, probeX, into] of [[placed.worksL, placed.worksL + 9, L2], [placed.worksR - 7, placed.worksR - 9, R2]]) {
                let roomRows = 0;
                for (let yy = fy - S3.DOOR_H; yy < fy; yy += 1) {
                  if ((PW.get(world, probeX + (into === L2 ? -14 : 14), yy) & 63) === M.AIR && PW.getLayer(world, 'back', probeX + (into === L2 ? -14 : 14), yy)) roomRows += 1;
                }
                if (roomRows < S3.DOOR_H * 0.6) continue;
                for (let yy = fy - S3.DOOR_H; yy < fy; yy += 1) {
                  for (let d = 0; d < 8; d += 1) {
                    const x = wallX0 + d;
                    if (PW.getOwner(world, x, yy) !== into.owner) continue;
                    const id = PW.get(world, x, yy) & 63;
                    if (!PW.mat.structural[id] && id !== M.GLASS) continue;
                    PW.set(world, x, yy, M.AIR, Q);
                    PW.setLayer(world, 'paint', x, yy, 0);
                    if (!PW.getLayer(world, 'back', x, yy)) PW.setLayer(world, 'back', x, yy, PW.abgr(40, 44, 52, 255));
                  }
                }
              }
            }
          }
          // N70/slice 2: the joint's primal core threads the faction's bundle like any other.
          if (city.faction && world.pipes && world.pipes.connectCore) {
            for (const k of rec.cores) {
              if (k.orb || k.standing || !k.vault) continue;
              world.pipes.connectCore(k.x, k.y, city.faction, world.pipes.TAPS.population, owner);
            }
          }
          if (res.grown) {
            rec.underConstruction = true; rec.buildFree = true; rec.health = 0.02;
            rec.siteWanted = true; rec.growing = true; rec.grewAt = world.tick || 0;
            world.repair.jobs.delete(owner);
            world.repair.notify(owner);
          }
          clearSimAround(placed.x0 - 6, placed.y0 - 6, placed.x1 + 6, placed.y1 + 40);
          flashes.push({ box: placed, age: 0 });
          city.joints.push({ owner, side, a: A.owner, b: B.owner, ringA: A.ring, ringB: B.ring, placed, decor: decorKind, faction: city.faction || null, rise });
          A.jointWith = B.owner; B.jointWith = A.owner;
          note(city, `a ${decorKind} joins the two: core at the centre, the spine ties their floors`);
          return true;
        }
      }
      return false;
    }

    // ---- N56: bridge support -------------------------------------------------------------------
    // A bridge with too little support bends at its point of least resistance, snaps and
    // breaks apart (the earthquake references). Every half second each bridge checks its
    // piers: one holds while either leg runs unbroken from the deck to the bed. The longest
    // unheld run sags the deck a little further each check; past the limit the deck snaps at
    // the sag's centre and the freed span falls as rigid pieces for the fragments to break.
    const SAG_SPAN = { strong: 120, plank: 70 };
    const SNAP_SAG = 5;
    function legHolds(br, px) {
      for (let y = br.y + br.rows; y < world.height - 28; y += 1) {
        const id = PW.get(world, px, y) & 63;
        if (id === M.PILLAR || id === M.WOOD || id === M.BRIDGE) continue;   // leg, plank or the sagged deck itself
        if (id === M.AIR || id === M.WATER || PW.mat.phase[id] === PW.PHASE.GAS) return false;
        // rubble heaped against a cut leg is no footing - only solid ground holds a bridge
        if (id === M.DEBRIS || id === M.RUBBLE || id === M.SAND || id === M.ASH || id === M.LOOSE_SOIL || id === M.LOOSE_STONE) return false;
        return true;
      }
      return false;
    }
    const pierHolds = (br, px) => legHolds(br, px) || legHolds(br, px + br.legGap);
    function stepBridges(city) {
      for (const br of city.bridges) {
        if (br.dead) continue;
        const holds = [br.x0, ...(br.piers || []).filter((px) => pierHolds(br, px)).map((px) => px + (br.legGap >> 1)), br.x1];
        let worst = null;
        for (let i = 0; i + 1 < holds.length; i += 1) {
          const run = holds[i + 1] - holds[i];
          if (!worst || run > worst.run) worst = { run, a: holds[i], b: holds[i + 1] };
        }
        const limit = br.strong ? SAG_SPAN.strong : SAG_SPAN.plank;
        if (!worst || worst.run <= limit) { br.sag = 0; continue; }
        br.sag += 1;
        br.sagAt = Math.round((worst.a + worst.b) / 2);
        bendDeck(br, worst);
        if (br.sag >= SNAP_SAG) snapBridge(city, br, worst);
      }
    }
    function bendDeck(br, span) {
      br.off = br.off || new Int16Array(br.x1 - br.x0 + 1);
      const mid = (span.a + span.b) / 2, half = Math.max(1, (span.b - span.a) / 2);
      for (let x = Math.max(br.x0, span.a + 1); x <= Math.min(br.x1, span.b - 1); x += 1) {
        const t = 1 - Math.abs(x - mid) / half;
        const want = Math.round(br.sag * t * t * 1.4);
        const k = x - br.x0;
        while (br.off[k] < want) {
          const yTop = br.y + br.off[k], yBot = yTop + br.rows - 1;
          const below = PW.get(world, x, yBot + 1) & 63;
          if (below !== M.AIR && below !== M.WATER && PW.mat.phase[below] !== PW.PHASE.GAS) break;
          for (let y = yBot; y >= yTop; y -= 1) {
            PW.set(world, x, y + 1, PW.get(world, x, y), Q);
            PW.setLayer(world, 'paint', x, y + 1, PW.getLayer(world, 'paint', x, y));
            PW.setFlag(world, x, y + 1, FLAG.BRIDGE);
          }
          PW.set(world, x, yTop, below === M.WATER ? M.WATER : M.AIR, Q);
          PW.setLayer(world, 'paint', x, yTop, 0);
          PW.setFlag(world, x, yTop, FLAG.BRIDGE, false);
          br.off[k] += 1;
        }
      }
      clearSimAround(span.a - 2, br.y - 2, span.b + 2, br.y + br.rows + SNAP_SAG + 6);
    }
    function snapBridge(city, br, span) {
      const cut = Math.min(Math.max(br.sagAt, span.a + 4), span.b - 4);
      const deckCells = (xa, xb) => {
        const cells = [];
        for (let x = Math.max(br.x0, xa); x <= Math.min(br.x1, xb); x += 1) {
          const k = x - br.x0, y0 = br.y + (br.off ? br.off[k] : 0);
          for (let y = y0; y < y0 + br.rows; y += 1) {
            if (PW.getFlags(world, x, y) & FLAG.BRIDGE) {
              cells.push(y * world.width + x);
              PW.setFlag(world, x, y, FLAG.BRIDGE, false);
            }
          }
        }
        return cells;
      };
      for (let x = cut - 1; x <= cut + 1; x += 1) {
        const k = x - br.x0, y0 = br.y + (br.off ? br.off[k] : 0);
        for (let y = y0; y < y0 + br.rows; y += 1) {
          if (!(PW.getFlags(world, x, y) & FLAG.BRIDGE)) continue;
          PW.set(world, x, y, M.AIR, Q);
          PW.setLayer(world, 'paint', x, y, 0);
          PW.setFlag(world, x, y, FLAG.BRIDGE, false);
        }
      }
      const bed = br.y + br.rows + 60;
      const launch = (cells, dir) => {
        if (!cells.length) return;
        if (world.fragments && world.fragments.spawn) {
          world.fragments.spawn({ cells, drop: true, floor: bed, base: bed, omega: dir * 0.04 });
        } else {
          for (const i of cells) PW.set(world, i % world.width, (i / world.width) | 0, M.DEBRIS | 2 << 6, {});
        }
      };
      launch(deckCells(span.a + 1, cut - 2), -1);
      launch(deckCells(cut + 2, span.b - 1), 1);
      br.dead = true;
      note(city, 'the bridge gives: it bends, snaps, and falls');
    }

    // ---- The clock ---------------------------------------------------------------------------
    function act(city) {
      city.actions += 1;
      if (city.kind === 'capital') {
        const lots = city.rings.left.length + city.rings.right.length;
        if (lots >= city.level * 2 && city.level < (city.levelCap || MAX_LEVEL)
          && !nearBlast(city.edge.left, city.edge.right)) { if (!pay(city, 'level')) return false; return levelUp(city); }   // N60 fire gate; N4 paid; N33 rank cap
        // The edge creeps out on its own slow clock; the towers level by age, not here (N48).
        const sides = city.rings.left.length <= city.rings.right.length ? ['left', 'right'] : ['right', 'left'];
        for (const s of sides) {
          if (city.appendClock[s] < APPEND_EVERY) continue;
          if (tryAppend(city, s)) { city.appendClock[s] = 0; return true; }
          city.appendClock[s] = APPEND_EVERY * 0.6;   // blocked: look again a little later
        }
        if (city.infillClock >= INFILL_EVERY) {       // N51: the town fills its gaps as it grows
          city.infillClock = 0;
          if (tryInfill(city)) return true;
        }
        return false;
      }
      if (city.kind === 'farm') {
        if (city.actions % 5 === 4) {
          if (city.level < 7 && city.actions % 10 === 9 && pay(city, 'level')) {   // N69 cap; N4 paid
            city.level += 1;
            eraseLot(city.main);
            city.main.level = Math.min(7, city.level + 1);
            city.main.variant = city.level >= 4 ? 'silos' : 'homestead';
            city.main.canvas = null;
            if (!placeLot(city, city.main, city.main.x)) { city.main.level -= 1; city.main.canvas = null; placeLot(city, city.main, city.main.x); }
            city.capEdge = { left: city.main.placed.worksL - 2, right: city.main.placed.worksR + 2 };
            note(city, `the farm grows: level ${city.level}`);
            return true;
          }
          const s1 = city.actions % 2 ? 'left' : 'right';
          return farmOutbuilding(city, s1) || farmOutbuilding(city, s1 === 'left' ? 'right' : 'left');
        }
        const sides = city.actions % 2 ? ['left', 'right'] : ['right', 'left'];
        for (const s of sides) if (extendFields(city, s)) return true;
        return false;
      }
      return militaryAct(city);
    }

    // N60: the lab must run smoothly through mass development and blast storms at once. The
    // crews take cover: while the air is thick (particles) or pieces are still falling
    // (fragments), growth does NO heavy work - no appends, no re-seats, no joints - and even
    // in calmer moments only one heavy op runs per tick while any dust hangs. A fresh crater
    // keeps restamps away locally besides (never rebuild into a live collapse).
    // A storm is falling pieces, a very recent blast, or an extreme particle load - NOT the
    // smoke that hangs for minutes after (the long smoulders kept the crews in cover forever).
    const stormy = () => {
      if (world.fragments && typeof world.fragments.list === 'function') {
        const fl = world.fragments.list();
        if (fl && fl.length > 0) return true;
      }
      if (world.particles && world.particles.count > 6000) return true;
      if (world.labBlasts && world.labBlasts.length) {
        const last = world.labBlasts[world.labBlasts.length - 1];
        if ((world.tick || 0) - last.t < 240) return true;
      }
      return false;
    };
    const nearBlast = (x0, x1) => {
      if (!world.labBlasts) return false;
      const now = world.tick || 0;
      for (const bl of world.labBlasts) {
        if (now - bl.t > 180) continue;
        if (bl.x >= x0 - 400 && bl.x <= x1 + 400) return true;
      }
      return false;
    };
    let stepTick = 0;
    function step(dt) {
      // Idle engine, idle cost: with no city grown (the live world before any seed lands)
      // nothing is scanned - the storm check alone walked the falling-pieces list every
      // tick and that garbage showed in pw-collapse's at-the-line budget.
      if (!cities.length && !flashes.length) return;
      economy(dt);   // N4: census, consumption, workers
      stepTick += 1;
      if (stepTick % 30 === 0) for (const city of cities) stepBridges(city);   // N56
      const storm = stormy();
      const heavyMax = storm ? 0 : (world.particles && world.particles.count > 1500 ? 1 : 3);
      let heavy = 0;
      for (const city of cities) {
        if (city.fallen) continue;   // (N6: nothing grows from a fallen city)
        if (city.kind === 'farm') {
          for (const field of city.fields) {
            if (field.growth >= 1) continue;
            field.growth = Math.min(1, field.growth + dt * RIPEN);
            const stage = field.growth >= 0.85 ? 2 : field.growth >= 0.4 ? 1 : 0;
            if (stage !== field.stage) { field.stage = stage; ST.drawCrop(world, field); }
          }
        }
        if (city.kind === 'capital') {
          city.appendClock.left += dt; city.appendClock.right += dt;
          city.infillClock += dt;
          // N4: the WORKERS set the pace the towers come of age - the whole workforce when
          // fed and watered, the skeleton crew when the stores run dry.
          const purse = purseOf(city);
          const feed = purse && purse.pop ? Math.max(0.25, Math.min(1, (purse.workers || 0) / purse.pop))
            : supplied(city) ? 1 : 0.25;
          for (const side of ['left', 'right']) for (const l of city.rings[side]) l.age += dt * feed;
        }
        city.jointClock += dt;
        if (city.jointClock >= JOINT_EVERY) {   // N58: close neighbours join through a merge point
          city.jointClock = 0;
          if (heavy < heavyMax && tryJoint(city)) heavy += 1;
        }
        city.clock += dt;
        while (city.clock >= GROW_EVERY && heavy < heavyMax) {
          city.clock -= GROW_EVERY;
          if (act(city)) heavy += 1;
        }
        if (city.clock > GROW_EVERY * 4) city.clock = GROW_EVERY * 4;
        if (city.kind === 'capital' && heavy < heavyMax && ageLots(city)) heavy += 1;
        if (city.kind === 'capital' && heavy < heavyMax && mendWingRunways(city)) heavy += 1;
        if (city.kind === 'capital' && heavy < heavyMax && weldWings(city)) heavy += 1;
      }
      for (let i = flashes.length - 1; i >= 0; i -= 1) { flashes[i].age += 1 / 60; if (flashes[i].age > 0.9) flashes.splice(i, 1); }
    }

    // ---- Overlay -----------------------------------------------------------------------------
    const BLOCK_NOTES = { water: `water · level ${UNLOCK} bridges it`, 'water-wide': 'water · too wide',
      mountain: `mountain · level ${UNLOCK} climbs it`, 'farm-mountain': 'mountain · farms never cross',
      merged: 'merged', edge: 'map edge', upkeep: 'upkeep holds the spread' };
    const BLOCK_TONES = { water: '#6fb7e8', 'water-wide': '#6fb7e8', mountain: '#b9b2a4', 'farm-mountain': '#b9b2a4',
      merged: '#e8c86f', edge: '#888', upkeep: '#9fc28a' };
    function draw(renderer, time) {
      const { ctx, camera } = renderer, z = camera.zoom;
      const sx = (x) => Math.round((x - camera.x) * z), sy = (y) => Math.round((y - camera.y) * z);
      ctx.save();
      ctx.font = `${Math.max(11, Math.min(18, Math.round(10 * Math.max(1, z * 2))))}px Consolas, monospace`;
      ctx.textAlign = 'center';
      for (const f of flashes) {
        ctx.strokeStyle = `rgba(255,255,230,${(0.9 - f.age) * 0.8})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(sx(f.box.x0) - 2, sy(f.box.y0) - 2, (f.box.x1 - f.box.x0) * z + 4, (f.box.y1 - f.box.y0) * z + 4);
      }
      for (const city of cities) {
        if (!city.main || !city.main.placed) continue;
        const topY = sy(city.main.placed.y0) - 10;
        ctx.fillStyle = '#e8f0d8';
        ctx.fillText(`${city.kind.toUpperCase()} ${city.id} · LV ${city.level}`, sx(city.x), topY);
        if (city.notes.length) { ctx.fillStyle = 'rgba(232,240,216,0.55)'; ctx.fillText(city.notes[city.notes.length - 1], sx(city.x), topY + 14); }
        for (const side of ['left', 'right']) {
          const why = city.blocked[side];
          if (!why || why === null) continue;
          const bx = city.kind === 'farm' ? city.fieldEdge[side] : city.edge[side];
          const dir = side === 'left' ? -1 : 1;
          const gx = sx(bx + dir * 8), gy = sy(world.groundTop[Math.max(0, Math.min(world.width - 1, bx))]);
          const pulse = 0.55 + 0.35 * Math.sin(time * 3 + city.id);
          ctx.strokeStyle = BLOCK_TONES[why] || '#aaa';
          ctx.globalAlpha = pulse;
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(gx, gy - 34); ctx.lineTo(gx, gy + 4); ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.fillStyle = BLOCK_TONES[why] || '#aaa';
          ctx.fillText(BLOCK_NOTES[why] || why, gx, gy - 40);
        }
      }
      ctx.restore();
    }

    function describe() {
      if (!cities.length) return 'drop a seed: CAPITAL, FARM or MILITARY, then click the land';
      return cities.map((c) => {
        const lots = c.rings.left.length + c.rings.right.length;
        const blocked = ['left', 'right'].filter((s) => c.blocked[s]).map((s) => `${s[0].toUpperCase()}:${c.blocked[s]}`).join(' ');
        return `#${c.id} ${c.kind} ${c.style} lv${c.level} lots ${lots}${c.fields.length ? ` fields ${c.fields.length}` : ''}${blocked ? ` [${blocked}]` : ''}`;
      }).join(' | ');
    }

    const api = { cities, barriers, drop, adoptSettlements, step, draw, describe, dbg, regrades: () => regradeCount,
      _adapt: adaptNeighbours };   // (test hook: the N57 neighbour re-seat, called by the harness)
    world.capitalGrowth = api;     // N2: vision reads the engine's cities off the world
    return api;
  }

  PW.createCapitalGrowth = createCapitalGrowth;
})();
