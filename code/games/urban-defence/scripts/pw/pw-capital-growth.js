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
  const FARM_BRIDGE_LEVEL = 3;   // N46: farms bridge small water from this level...
  const FARM_BRIDGE_MAX = 72;    // ...and only this narrow (a lesser bridge)
  const CAPITAL_BRIDGE_MAX = 1400;
  const GAP0 = 12, GAP_RING = 9, TIGHTEN = 3, GAP_MIN = 7;   // N43: ring gaps and their tightening
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
    const emptyRecord = (id) => ({ id, cores: [], floors: [], stairs: [], doors: [], slots: [], panels: [], devices: [], windows: [], health: 1 });
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
      const level = lot.type === 'military' ? Math.max(2, Math.min(5, 1 + lot.level)) :
        lot.type === 'farm' ? Math.max(1, Math.min(6, lot.level)) : Math.max(1, Math.min(7, lot.level));
      const opts = { style: city.style, level, variant: lot.variant, seed: lot.seedN, facing: lot.side === 'left' ? 1 : -1 };
      if (lot.type === 'population' && lot.ring >= 0) opts.storeys = skylineStoreys(level);
      return T[lot.type](opts);
    }
    const bodyWidth = (canvas) => canvas.body.right - canvas.body.left + 1;

    function placeLot(city, lot, centerX) {
      const canvas = lot.canvas || (lot.canvas = canvasFor(city, lot));
      const w = bodyWidth(canvas);
      const worldX = Math.round(centerX - canvas.body.left - w / 2);
      const res = PW.foundations.place(world, canvas, worldX, { style: city.style, owner: lot.owner });
      if (!res) return false;
      lot.x = Math.round(centerX);
      lot.placed = { x0: res.stamp.x, y0: res.stamp.y, x1: res.stamp.x + res.stamp.width - 1,
        y1: res.stamp.y + res.stamp.height - 1, worksL: res.works[0], worksR: res.works[1] };
      for (let x = lot.placed.worksL - 4; x <= lot.placed.worksR + 4; x += 1) PW.refreshGroundTop(world, x);
      world.buildings[lot.owner - 1] = PW.buildingRecord(world, res.stamp,
        { id: lot.owner, side: 'left', type: lot.type, style: city.style, level: lot.level, kind: city.kind });
      clearSimAround(lot.placed.x0 - 8, lot.placed.y0 - 8, lot.placed.x1 + 8, lot.placed.y1 + 60);
      flashes.push({ box: { ...lot.placed }, age: 0 });
      return true;
    }

    // Take a building out of the world and regrow the natural ground under it, so it can be
    // seated again (a level-up, or the centre tightening - N43).
    function eraseLot(lot) {
      const p = lot.placed;
      if (!p) return;
      const x0 = p.worksL - 8, x1 = p.worksR + 8;
      const y0 = Math.max(2, p.y0 - 4), y1 = Math.min(world.height - 30, p.y1 + 150);
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
        if (((x - b.x0) % pierEvery) === 2 && x > b.x0 + 1 && x < b.x1 - 2) {
          for (const px of [x, x + 1]) {
            for (let y = deckTop + rows; y < world.height - 30; y += 1) {
              const id = PW.get(world, px, y) & 63;
              if (id !== M.AIR && id !== M.WATER) break;
              PW.set(world, px, y, (strong ? M.PILLAR : M.WOOD) | ((PW.hash2(px, y) & 3) << 6), Q);
              PW.setLayer(world, 'paint', px, y, PW.abgr ? PW.abgr(...(strong ? [84, 88, 94, 255] : [92, 70, 44, 255])) : 0);
            }
          }
        }
      }
      for (let x = b.x0 - 3; x <= b.x1 + 3; x += 1) PW.refreshGroundTop(world, x);
      clearSimAround(b.x0 - 4, deckTop - 4, b.x1 + 4, deckTop + 60);
      city.bridges.push({ x0: b.x0, x1: b.x1, y: deckTop, strong });
      note(city, strong ? 'main bridge raised' : 'lesser bridge laid');
    }

    // ---- Cities ------------------------------------------------------------------------------
    function note(city, text) { city.notes.push(text); if (city.notes.length > 4) city.notes.shift(); }
    const claimSpan = (c) => [c.edge.left - CLAIM, c.edge.right + CLAIM];
    function claimed(x0, x1, self) {
      for (const c of cities) {
        if (c === self) continue;
        const [l, r] = claimSpan(c);
        if (r >= Math.min(x0, x1) && l <= Math.max(x0, x1)) return c;
      }
      return null;
    }

    function drop(xIn, kind, style) {
      const x = Math.round(xIn);
      if (x < 120 || x > world.width - 120) return { ok: false, note: 'off the map' };
      const b = barrierIn(x - 40, x + 40);
      if (b && (b.kind === 'water' || kind !== 'military')) return { ok: false, note: b.kind === 'water' ? 'open water' : 'mountain: only military digs in here' };
      const other = claimed(x - 60, x + 60, null);
      if (other) return { ok: false, note: `claimed by ${other.kind} ${other.id}` };
      const city = { id: cities.length + 1, kind, style, x, level: 1, clock: 0, actions: 0,
        rings: { left: [], right: [] }, edge: { left: x, right: x }, capEdge: { left: x, right: x },
        blocked: { left: null, right: null }, fields: [], fieldEdge: { left: x, right: x },
        bridges: [], merged: new Set(), notes: [] };
      const main = { type: kind === 'capital' ? 'population' : kind, level: 2, ring: -1, side: 'right',
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
      note(city, `${kind} seed takes root`);
      return { ok: true, city };
    }

    // ---- Capital growth (N43 rings, N45 skyline) ---------------------------------------------
    const POP_LOT_VARIANTS = ['slab', 'setback', 'tapered', 'spire', 'needle', 'crown'];
    const gapFor = (city, lot) => Math.max(GAP_MIN, GAP0 + lot.ring * GAP_RING - TIGHTEN * (city.level - lot.bornLevel));

    function tryAppend(city, side) {
      if (city.blocked[side] === 'merged' || city.blocked[side] === 'edge') return false;
      const dir = side === 'left' ? -1 : 1;
      const ring = city.rings[side].length;
      // The spread outruns its upkeep: no more rings than the city's level affords (N44 size).
      if (ring >= city.level + 3) { if (!city.blocked[side]) city.blocked[side] = 'upkeep'; return false; }
      const lot = { type: 'population', level: 1, ring, side, bornLevel: city.level,
        variant: POP_LOT_VARIANTS[rand.int(0, POP_LOT_VARIANTS.length - 1)], seedN: seedN += 17, owner: 0 };
      const canvas = canvasFor(city, lot);
      const w = bodyWidth(canvas);
      let cursor = city.edge[side] + dir * (GAP0 + ring * GAP_RING);
      let far = cursor + dir * (w + 6);
      if (far < 80 || far > world.width - 80) { city.blocked[side] = 'edge'; return false; }
      const b = barrierIn(cursor, far);
      if (b) {
        if (city.level < UNLOCK) { city.blocked[side] = b.kind; return false; }
        if (b.kind === 'water') {
          if (b.x1 - b.x0 > CAPITAL_BRIDGE_MAX) { city.blocked[side] = 'water-wide'; return false; }
          if (!city.bridges.some((g) => g.x0 === b.x0)) bridge(city, b, true);
        } else note(city, 'the road climbs the flank');
        cursor = dir > 0 ? b.x1 + 8 : b.x0 - 8;
        lot.massEdge = cursor;                      // born on the far side: it stays there (N43)
        far = cursor + dir * (w + 6);
        if (barrierIn(cursor, far)) { city.blocked[side] = 'mountain'; return false; }
      }
      const other = claimed(cursor, far, city);
      if (other) {
        city.blocked[side] = 'merged';
        if (!city.merged.has(other.id)) {
          city.merged.add(other.id); other.merged.add(city.id);
          const oside = other.x > city.x ? 'left' : 'right';
          other.blocked[oside] = 'merged';
          paveSegment(city, city.edge[side], dir > 0 ? other.edge.left : other.edge.right);
          note(city, `merged with ${other.kind} ${other.id}`); note(other, `merged with ${city.kind} ${city.id}`);
        }
        return false;
      }
      lot.canvas = canvas;
      lot.owner = allotOwner();
      const center = cursor + dir * (w / 2 + 2);
      if (!placeLot(city, lot, center)) {
        world.buildings.pop();
        // too steep for a lot right here: step past the rough patch next attempt
        city.edge[side] += dir * 12;
        return false;
      }
      city.rings[side].push(lot);
      const prevEdge = city.edge[side];
      city.edge[side] = dir > 0 ? Math.max(prevEdge, lot.placed.worksR + 2) : Math.min(prevEdge, lot.placed.worksL - 2);
      paveSegment(city, prevEdge, dir > 0 ? lot.placed.worksL : lot.placed.worksR);
      city.blocked[side] = null;
      return true;
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
          // its own shore: hold short of the barrier, or stay put if the mass is packed full
          const shore = dir > 0 ? b.x0 - 6 - w : b.x1 + 6 + w;
          cursor = dir > 0 ? Math.min(cursor, shore) : Math.max(cursor, shore);
          if (dir > 0 ? cursor < edge + GAP_MIN : cursor > edge - GAP_MIN) cursor = null;
        } else {
          cursor = dir > 0 ? b.x1 + 8 : b.x0 - 8;   // born beyond it: the bridge or road is laid
        }
      }
      let center = cursor === null ? lot.x : cursor + dir * (w / 2 + 2);
      if (center - w / 2 < 60 || center + w / 2 > world.width - 60) { center = lot.x; city.blocked[lot.side] = 'edge'; }
      if (!placeLot(city, lot, center) && !placeLot(city, lot, center + dir * 8) && !placeLot(city, lot, lot.x)) return null;
      return dir > 0 ? lot.placed.worksR + 2 : lot.placed.worksL - 2;
    }
    // Re-seat a side's rings from `fromRing` outward: everything shuffles to its tightened gap
    // (N43), pushed out or pulled in as the widths demand.
    function seatChain(city, side, fromRing) {
      const dir = side === 'left' ? -1 : 1;
      const lots = city.rings[side];
      const chain = lots.slice(fromRing);
      for (const l of chain) eraseLot(l);
      let edge = fromRing === 0 ? city.capEdge[side] :
        (dir > 0 ? lots[fromRing - 1].placed.worksR + 2 : lots[fromRing - 1].placed.worksL - 2);
      for (const l of chain) {
        const e = seatOne(city, l, dir, edge);
        if (e === null) { l.placed = null; continue; }
        edge = e;
      }
      city.rings[side] = lots.filter((l) => l.placed);
      city.rings[side].forEach((l, i) => { l.ring = i; });
      city.edge[side] = edge;
      return edge;
    }

    // N45: the skyline falls off from the centre - a lot may rise only as high as the city's
    // level, less its ring. Level-ups go to the innermost lot still under its cap. A taller
    // tower is wider too: it keeps its tightened inner gap (N43), and it and every lot outward
    // of it re-seat, the chain shuffling out by the width gained - the centre stays packed
    // while the towers rise.
    function tryUpgrade(city) {
      const all = [...city.rings.left, ...city.rings.right].sort((a, b) => a.ring - b.ring);
      for (const lot of all) {
        if (lot.type !== 'population') continue;
        const cap = Math.max(1, city.level - lot.ring);
        if (lot.level >= cap) continue;
        lot.level += 1;
        lot.canvas = canvasFor(city, lot);
        seatChain(city, lot.side, lot.ring);
        if (!lot.placed) {
          lot.level -= 1; lot.canvas = null;
          seatChain(city, lot.side, Math.min(lot.ring, city.rings[lot.side].length));
          dbg.push(`upgrade-lost ${lot.side}`);
          if (dbg.length > 40) dbg.shift();
        }
        return true;
      }
      return false;
    }

    // The city levels up: the capital grows grander, and the whole cluster tightens toward it
    // (N43) - every ring is re-seated inner-first with its tightened gap. Rings past a barrier
    // stay on their own land mass, pulled up against its shore.
    function levelUp(city) {
      city.level += 1;
      eraseLot(city.main);
      city.main.level = Math.min(7, city.level + 1);
      city.main.canvas = null;
      if (!placeLot(city, city.main, city.main.x)) { city.main.level -= 1; city.main.canvas = null; placeLot(city, city.main, city.main.x); }
      city.capEdge = { left: city.main.placed.worksL - 2, right: city.main.placed.worksR + 2 };
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
      for (let x = Math.min(from, to) + 16; x <= Math.max(from, to); x += 1) {
        if (Math.abs(surf(x) - surf(x - 16)) > 9) { city.blocked[side] = 'farm-mountain'; return false; }
      }
      const other = claimed(from, to, city);
      if (other) {
        city.blocked[side] = 'merged';
        if (!city.merged.has(other.id)) { city.merged.add(other.id); other.merged.add(city.id); note(city, `fields meet ${other.kind} ${other.id}`); }
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
      const dir = side === 'left' ? -1 : 1;
      const lot = { type: 'farm', level: 1 + rand.int(0, 1), ring: city.rings[side].length, side, bornLevel: city.level,
        variant: FARM_OUT[rand.int(0, FARM_OUT.length - 1)], seedN: seedN += 17, owner: 0 };
      const canvas = canvasFor(city, lot);
      const w = bodyWidth(canvas);
      const cursor = city.fieldEdge[side] + dir * 10;
      if (barrierIn(cursor, cursor + dir * (w + 8)) || claimed(cursor, cursor + dir * (w + 8), city)) return false;
      lot.canvas = canvas;
      lot.owner = allotOwner();
      if (!placeLot(city, lot, cursor + dir * (w / 2 + 2))) { world.buildings.pop(); return false; }
      city.rings[side].push(lot);
      city.fieldEdge[side] = dir > 0 ? lot.placed.worksR + 4 : lot.placed.worksL - 4;
      city.edge[side] = dir > 0 ? Math.max(city.edge[side], lot.placed.worksR) : Math.min(city.edge[side], lot.placed.worksL);
      return true;
    }

    // ---- Military ----------------------------------------------------------------------------
    const MIL_MAIN = ['compound', 'fortress', 'command', 'bastion'];
    function militaryAct(city) {
      if (city.actions % 3 === 2 && city.level < 6) {
        city.level += 1;
        eraseLot(city.main);
        city.main.level = city.level;
        city.main.variant = MIL_MAIN[Math.min(3, (city.level - 1) >> 1)];
        city.main.canvas = null;
        if (!placeLot(city, city.main, city.main.x)) { city.main.level -= 1; city.main.canvas = null; placeLot(city, city.main, city.main.x); }
        city.capEdge = { left: city.main.placed.worksL - 2, right: city.main.placed.worksR + 2 };
        city.edge = { left: Math.min(city.edge.left, city.capEdge.left), right: Math.max(city.edge.right, city.capEdge.right) };
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
      lot.canvas = canvas;
      lot.owner = allotOwner();
      if (!placeLot(city, lot, cursor + dir * (w / 2 + 2))) { world.buildings.pop(); return false; }
      city.rings[side].push(lot);
      city.edge[side] = dir > 0 ? lot.placed.worksR + 2 : lot.placed.worksL - 2;
      paveSegment(city, city.capEdge[side], dir > 0 ? lot.placed.worksL : lot.placed.worksR);
      return true;
    }

    // ---- The clock ---------------------------------------------------------------------------
    function act(city) {
      city.actions += 1;
      if (city.kind === 'capital') {
        const lots = city.rings.left.length + city.rings.right.length;
        if (lots >= city.level * 2 && city.level < MAX_LEVEL) return levelUp(city);
        const sides = city.rings.left.length <= city.rings.right.length ? ['left', 'right'] : ['right', 'left'];
        if (city.actions % 2 === 0) {
          for (const s of sides) if (tryAppend(city, s)) return true;
          return tryUpgrade(city);
        }
        if (tryUpgrade(city)) return true;
        for (const s of sides) if (tryAppend(city, s)) return true;
        return false;
      }
      if (city.kind === 'farm') {
        if (city.actions % 5 === 4) {
          if (city.level < 6 && city.actions % 10 === 9) {
            city.level += 1;
            eraseLot(city.main);
            city.main.level = Math.min(6, city.level + 1);
            city.main.variant = city.level >= 4 ? 'silos' : 'homestead';
            city.main.canvas = null;
            if (!placeLot(city, city.main, city.main.x)) { city.main.level -= 1; city.main.canvas = null; placeLot(city, city.main, city.main.x); }
            city.capEdge = { left: city.main.placed.worksL - 2, right: city.main.placed.worksR + 2 };
            note(city, `the farm grows: level ${city.level}`);
            return true;
          }
          return farmOutbuilding(city, city.actions % 2 ? 'left' : 'right');
        }
        const sides = city.actions % 2 ? ['left', 'right'] : ['right', 'left'];
        for (const s of sides) if (extendFields(city, s)) return true;
        return false;
      }
      return militaryAct(city);
    }

    function step(dt) {
      let heavy = 0;
      for (const city of cities) {
        if (city.kind === 'farm') {
          for (const field of city.fields) {
            if (field.growth >= 1) continue;
            field.growth = Math.min(1, field.growth + dt * RIPEN);
            const stage = field.growth >= 0.85 ? 2 : field.growth >= 0.4 ? 1 : 0;
            if (stage !== field.stage) { field.stage = stage; ST.drawCrop(world, field); }
          }
        }
        city.clock += dt;
        while (city.clock >= GROW_EVERY && heavy < 3) {
          city.clock -= GROW_EVERY;
          if (act(city)) heavy += 1;
        }
        if (city.clock > GROW_EVERY * 4) city.clock = GROW_EVERY * 4;
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

    return { cities, barriers, drop, step, draw, describe, dbg };
  }

  PW.createCapitalGrowth = createCapitalGrowth;
})();
