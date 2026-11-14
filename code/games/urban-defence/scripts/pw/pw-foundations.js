'use strict';
// Slope-adaptive building bases. A building placed on uneven ground keeps the ground as it is
// around it: its floor is set at a level between the high and the low ground, the uphill part is
// cut into the hill behind a retaining wall with steps down a sunken forecourt to the door, and
// the downhill part stands on a structure down to the slope, with a stage beyond the wall and
// steps down to the ground. Each faction builds these its own way:
//   asian  - downhill: a kake-zukuri stage (as at Kiyomizu-dera): a grid of tall timber pillars
//            locked by horizontal nuki tie-beams on stone footings; uphill: an ishigaki wall of big
//            irregular stones, battered in a fan curve (steep at the top, flaring at the foot).
//   gothic - downhill: a vaulted undercroft, an arcade of pointed arches on masonry piers, with
//            stepped buttresses walking down the hill; uphill: a coursed ashlar wall with
//            buttresses and a sloped base course.
//   modern - downhill: slender concrete pilotis under a cantilevered deck, cross-braced in steel
//            when tall; uphill: a board-formed concrete wall with tie-back anchor plates and weep
//            holes, and a steel railing.
// The amber cores stay buried in real ground: under the footings where the floor is raised.
(function () {
  const PW = window.PW;
  const { M, FLAG, ID_MASK } = PW;
  const K = PW.buildingKit;
  const { STYLES, tone, mix } = K;
  const rgb = (c) => PW.abgr(Math.max(0, Math.min(255, c[0])) | 0, Math.max(0, Math.min(255, c[1])) | 0, Math.max(0, Math.min(255, c[2])) | 0);

  const FLAT = 3;          // ground within this of the floor counts as level
  const PLINTH = 6;        // a gap up to this under the floor is filled with a solid plinth
  const CUT_MAX = 64;      // deepest cut into a hill (about 4.5 m of retaining wall)
  const CUT_MAX_HANGAR = 96;   // a hangar is dug in deeper to keep its door at grade
  const EMBED = 3;         // footings go this far into the ground
  const COURT_MAX = 48;    // widest sunken forecourt in front of a retaining wall (about 3.4 m)
  const COURT_MIN = 16;    // the narrow area left in front of a wall climbed by a ladder
  const REACH = 400;       // how far either side of a lot the natural ground is remembered
  const STYLE = {
    asian: { bias: 0.2, supportMax: 170, stage: 22, deck: 3 },
    gothic: { bias: 0.5, supportMax: 130, stage: 10, deck: 5 },
    modern: { bias: 0.35, supportMax: 150, stage: 14, deck: 4 },
  };
  const C = {
    asian: { post: [112, 82, 58], postLit: [140, 106, 76], postDark: [80, 58, 42], beam: [100, 72, 50], beamLit: [128, 96, 66],
      boards: [128, 92, 60], stone: [[132, 128, 120], [114, 110, 104], [146, 142, 132], [104, 100, 94]], joint: [56, 54, 52], footing: [120, 116, 110] },
    gothic: { stone: [128, 124, 138], stoneLit: [150, 146, 160], stoneDark: [96, 92, 106], joint: [76, 72, 86], vault: [44, 42, 52], rib: [64, 60, 74] },
    modern: { concrete: [164, 166, 162], concreteLit: [184, 186, 182], concreteDark: [128, 130, 126], board: [148, 150, 146],
      anchor: [84, 90, 98], bolt: [150, 156, 164], weep: [46, 48, 50], steel: [96, 140, 170], steelDark: [64, 96, 120], glass: [150, 200, 220] },
  };

  // ---- Cells ----------------------------------------------------------------------------------------
  function put(world, x, y, mat, color, owner) {
    if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return;
    PW.set(world, x, y, mat, { quiet: true });
    PW.setLayer(world, 'paint', x, y, rgb(color));
    PW.setLayer(world, 'deco', x, y, 0);
    if (owner) PW.setOwner(world, x, y, owner);
  }
  function dig(world, x, y) {
    const id = PW.get(world, x, y) & ID_MASK;
    if (id !== M.AIR && id !== M.BEDROCK) PW.set(world, x, y, M.AIR, { quiet: true });
    PW.setLayer(world, 'deco', x, y, 0);
  }
  function deco(world, x, y, color, owner) {
    if ((PW.get(world, x, y) & ID_MASK) !== M.AIR) return;
    PW.setLayer(world, 'deco', x, y, rgb(color));
    if (owner) PW.setOwner(world, x, y, owner);
  }
  const ground = (world, x) => world.groundTop[Math.max(0, Math.min(world.width - 1, x))];

  // ---- Plan -----------------------------------------------------------------------------------------
  // Where the floor goes for a canvas placed at worldX, and what each side needs. Returns null if
  // the lot is under water or too steep for the style.
  function plan(world, canvas, worldX, style) {
    const s = STYLE[style] || STYLE.modern;
    const x0 = worldX + canvas.body.left, x1 = worldX + canvas.body.right;
    let gMin = Infinity, gMax = -Infinity;
    const rows = [];
    for (let x = x0; x <= x1; x += 1) {
      const g = ground(world, x);
      if ((PW.get(world, x, g) & ID_MASK) === M.WATER) return null;
      rows.push(g); gMin = Math.min(gMin, g); gMax = Math.max(gMax, g);
    }
    const sorted = rows.slice().sort((a, b) => a - b);
    // The ground as it was before any cutting, for the walls and structures around the lot.
    const nx0 = Math.max(0, x0 - REACH), nat = world.groundTop.slice(nx0, Math.min(world.width, x1 + REACH + 1));
    const natural = (x) => nat[Math.max(0, Math.min(nat.length - 1, x - nx0))];
    const outside = (side) => natural(side < 0 ? x0 - 1 : x1 + 1);
    // A hangar's floor is set at the ground outside its door so vehicles drive out at grade (the
    // building is dug into the hill behind it instead).
    const hangarSide = canvas.hangar ? (canvas.hangar.door.x > (canvas.body.left + canvas.body.right) / 2 ? 1 : -1) : 0;
    let G;
    if (gMax - gMin <= FLAT * 2) G = sorted[sorted.length >> 1];
    else {
      G = hangarSide ? outside(hangarSide) : Math.round(gMin + s.bias * (gMax - gMin));
      G = Math.min(G, gMin + (hangarSide ? CUT_MAX_HANGAR : CUT_MAX));   // never cut deeper than the wall allows
      G = Math.max(G, gMax - s.supportMax);                              // nor stand taller than the structure allows
    }
    return { x0, x1, G, gMin, gMax, style, natural, hangarSide, uphill: [-1, 1].filter((side) => outside(side) < G - FLAT),
      downhill: [-1, 1].filter((side) => outside(side) > G + FLAT), steep: gMax - gMin > FLAT * 2 };
  }

  // ---- Uphill: cut, forecourt, retaining wall, steps -------------------------------------------------
  function retainingWall(world, p, side, owner) {
    const { style, G, natural } = p;
    const edge = side < 0 ? p.x0 : p.x1;
    const at = (k) => edge + side * k;
    const P = STYLES[style];
    const H0 = G - natural(at(1));
    if (H0 <= 0) return null;
    const T = style === 'asian' ? 8 : 6;
    // The wall for a forecourt `court` cells wide: as tall as the hill where it stands (the ground
    // keeps rising behind the court), its face battered back into the hill as it rises, and its
    // top level a little above the highest ground it retains.
    const layout = (court) => {
      const wallX = at(court + 1);
      let H = H0;
      for (let t = 0; t < T; t += 1) H = Math.max(H, G - natural(wallX + side * t));
      const batter = (h) => style === 'asian' ? Math.round(H * 0.32 * (1 - Math.pow(1 - h / H, 2)))
        : style === 'gothic' ? (h < 6 ? 6 - h : 0) * -1 : 0;
      const faceAt = (h) => wallX + side * batter(Math.max(0, Math.min(H, h)));
      let wallTop = G - H;
      for (let t = 0; t < T; t += 1) wallTop = Math.min(wallTop, natural(faceAt(H) + side * t) - 2);
      const Hw = G - wallTop;
      const startX = faceAt(Hw) - side;
      return { court, wallX, H, faceAt, wallTop, Hw, startX, room: Math.abs(startX - edge) - 1 };
    };
    // The forecourt is widened until a 45° flight of steps from the top of the wall fits. Where
    // the hill is too steep for that (widening the court only makes the wall taller) it stays a
    // narrow area and a ladder climbs the wall.
    let L = layout(Math.max(14, Math.min(COURT_MAX, H0 + 10)));
    for (let n = 0; n < 8 && L.Hw + 4 > L.room && L.court < COURT_MAX; n += 1) {
      L = layout(Math.min(COURT_MAX, L.court + (L.Hw + 4 - L.room) + 2));
    }
    if (L.Hw + 4 > L.room) L = layout(COURT_MIN);
    const { court, wallX, H, faceAt, wallTop, Hw, startX, room } = L;
    const thick = (h) => T + (style === 'asian' ? Math.round((H - Math.max(0, h)) * 0.08) : 0);
    // Cut the forecourt down to the floor: every column in front of the wall's face is opened to
    // the sky (the face leans back into the hill as it rises when battered).
    for (let h = 1; h <= Hw + 2; h += 1) {
      const y = G - h, n = Math.abs(faceAt(h) - edge);
      for (let k = 1; k < n; k += 1) if (y >= natural(at(k))) dig(world, at(k), y);
    }
    for (let k = 1; k <= court + 2 + Math.round(H * 0.32); k += 1) {
      for (let y = G - Hw - 240; y < G; y += 1) PW.setLayer(world, 'deco', at(k), y, 0);
    }
    // Forecourt paving.
    const pave = PW.settlementTools ? PW.settlementTools.PAVING[style] : null;
    for (let k = 1; k <= court; k += 1) {
      const x = at(k);
      put(world, x, G, M.ASPHALT, pave ? tone(pave.paving, (x % 9 === 0) ? 0.85 : 1) : [110, 108, 100], owner);
      put(world, x, G + 1, M.ROADBED, pave ? pave.base : [80, 76, 70], owner);
    }
    // The wall, from the floor's footing up to its level top (an ishigaki wall is thicker at its
    // foot).
    for (let h = -4; h <= Hw; h += 1) {
      const y = G - h, face = faceAt(h);
      for (let t = 0; t < thick(h); t += 1) {
        const x = face + side * t;
        put(world, x, y, M.MASONRY, wallCell(style, x, y, t, h, H, P), owner);
      }
    }
    // Modern: tie-back anchors and weep holes on the face; a railing on top. Gothic: buttresses.
    if (style === 'modern') {
      for (let h = 8; h < Hw - 4; h += 14) {
        const x = faceAt(h) + side;
        for (let dy = -1; dy <= 1; dy += 1) put(world, x, G - h + dy, M.MASONRY, dy === 0 ? C.modern.bolt : C.modern.anchor, owner);
      }
      for (let h = 2; h < Math.min(Hw, 8); h += 6) put(world, faceAt(h), G - h, M.MASONRY, C.modern.weep, owner);
      for (let k = 0; k < T; k += 1) for (let dy = 1; dy <= 9; dy += 1) if (dy === 9 || k % 4 === 0) deco(world, faceAt(Hw) + side * k, wallTop - dy, C.modern.steel, owner);
    } else if (style === 'gothic') {
      for (let h = 0; h < Hw - 6; h += 1) {
        // A buttress on the forecourt side, stepping back as it rises.
        const out = h < Hw * 0.35 ? 6 : h < Hw * 0.7 ? 4 : 2;
        for (let d = 1; d <= out; d += 1) put(world, faceAt(h) - side * d, G - h, M.MASONRY, (h % 6 === 0) ? C.gothic.joint : d === out ? C.gothic.stoneLit : C.gothic.stone, owner);
      }
    } else {
      // Asian: a tiled cap on the wall.
      for (let k = -1; k <= T; k += 1) { put(world, faceAt(Hw) + side * k, wallTop - 1, M.TILE, P.roof, owner); put(world, faceAt(Hw) + side * k, wallTop - 2, M.TILE, P.roofLight, owner); }
    }
    // Steps from the top of the wall down the forecourt towards the door (45°, 4-cell steps), or a
    // ladder up the face where the court is too narrow for the flight.
    let access = 'steps';
    if (Hw + 4 <= room) {
      for (let i = 0; wallTop + i * 4 < G; i += 1) {
        const surface = wallTop + i * 4;
        for (let j = 0; j < 4; j += 1) {
          const x = startX - side * (i * 4 + j);
          for (let y = surface; y < G; y += 1) put(world, x, y, M.MASONRY, stepCell(style, y === surface, x, y, P), owner);
        }
      }
    } else {
      access = 'ladder';
      const rail = style === 'asian' ? C.asian.post : style === 'gothic' ? C.gothic.stoneDark : C.modern.steelDark;
      const rung = style === 'asian' ? C.asian.beamLit : style === 'gothic' ? [96, 92, 100] : C.modern.steel;
      // It leans on the face of a battered ishigaki wall; elsewhere it stands clear of the base course.
      const ladderAt = (h) => (style === 'asian' ? faceAt(h) : faceAt(0));
      for (let y = wallTop - 6; y < G; y += 1) for (let d = 1; d <= 8; d += 1) {
        const x = ladderAt(G - y) - side * d;
        const isRail = d === 1 || d === 8, isRung = (y - wallTop) % 6 === 0;
        if (isRail || isRung) PW.setLayer(world, 'back', x, y, rgb(isRail ? rail : rung));
        PW.setFlag(world, x, y, FLAG.LADDER);
        if (owner) PW.setOwner(world, x, y, owner);
      }
    }
    return { side, edge, wallX, court, height: Hw, top: wallTop, access, far: faceAt(Hw) + side * thick(Hw),
      ladderAt: access === 'ladder' ? (y) => (style === 'asian' ? faceAt(G - y) : faceAt(0)) - side * 4 : null };
  }
  function wallCell(style, x, y, t, h, H, P) {
    if (style === 'asian') {
      // Big irregular stones (a jittered cell grid) with dark joints.
      const gx = Math.floor((x + (Math.floor(y / 7) & 1) * 4) / 9), gy = Math.floor(y / 7);
      const hh = PW.hash2(gx * 7 + 1, gy * 13 + 3);
      const edgeX = (x + (Math.floor(y / 7) & 1) * 4) % 9 === 0 || (hh & 1 && (x + 3) % 9 === 0);
      if (y % 7 === 0 || edgeX) return C.asian.joint;
      return tone(C.asian.stone[hh % 4], t === 0 ? 1.12 : 1);
    }
    if (style === 'gothic') {
      const course = Math.floor(y / 6);
      if (y % 6 === 0 || (x + (course & 1) * 6) % 12 === 0) return C.gothic.joint;
      if (h < 4) return C.gothic.stoneDark;                       // sloped base course
      return t === 0 ? C.gothic.stoneLit : C.gothic.stone;
    }
    const k = (y % 6 === 0) ? 0.9 : 1;                            // board-formed lifts
    return tone(t === 0 ? C.modern.concreteLit : C.modern.concrete, k);
  }
  function stepCell(style, nose, x, y, P) {
    if (style === 'asian') return nose ? [150, 146, 138] : C.asian.stone[PW.hash2(x >> 2, y >> 2) % 4];
    if (style === 'gothic') return nose ? C.gothic.stoneLit : C.gothic.stone;
    return nose ? C.modern.concreteLit : C.modern.concrete;
  }

  // ---- Downhill: deck, stage and the structure under them ----------------------------------------------
  function underStructure(world, p, owner) {
    const { style, G } = p;
    const S = STYLE[style];
    const P = STYLES[style];
    // Everything here is measured from the ground as it was: the plinth and footings built on it
    // are not terrain, so the live ground line drops below them.
    const ground = (_, x) => p.natural(x);
    // Columns that need the raised deck: inside the body where the ground is low, plus the stage.
    const cols = [];
    for (let x = p.x0; x <= p.x1; x += 1) if (ground(world, x) > G + FLAT) cols.push(x);
    const stages = [];
    for (const side of p.downhill) {
      const edge = side < 0 ? p.x0 : p.x1;
      for (let k = 1; k <= S.stage; k += 1) cols.push(edge + side * k);
      stages.push({ side, end: edge + side * S.stage });
    }
    if (!cols.length) return null;
    cols.sort((a, b) => a - b);
    const D = S.deck;
    // Plinth where the ground is only a little lower than the floor (under the stage as well).
    for (let x = Math.min(p.x0, ...cols); x <= Math.max(p.x1, ...cols); x += 1) {
      const g = ground(world, x);
      if (g > G && g <= G + PLINTH) for (let y = G; y < g + (g > G + FLAT ? EMBED : 0); y += 1) put(world, x, y, M.FOUNDATION, [118, 116, 110], owner);
    }
    // The deck.
    for (const x of cols) for (let r = 0; r < D; r += 1) {
      let c;
      if (style === 'asian') c = r === 0 ? (x % 6 === 0 ? tone(C.asian.boards, 0.82) : C.asian.boards) : C.asian.beam;
      else if (style === 'gothic') c = r === 0 ? tone(P.frame, 1.12) : r === D - 1 ? C.gothic.stoneDark : C.gothic.stone;
      else c = r === 0 ? C.modern.concreteLit : r === D - 1 ? C.modern.concreteDark : C.modern.concrete;
      put(world, x, G + r, style === 'asian' ? M.WOOD : style === 'gothic' ? M.MASONRY : M.CONCRETE, c, owner);
    }
    const lo = cols[0], hi = cols[cols.length - 1];
    const span = (x) => ({ top: G + D, bottom: ground(world, x) + EMBED });
    if (style === 'asian') {
      // Round timber pillars (5 cells, about 35 cm) every 22 cells from the outer ends inward on
      // stone footings, locked by nuki tie-beams running through them every 20 rows.
      const posts = [];
      for (let x = hi - 2; x >= lo + 2; x -= 22) posts.push(x);
      if (!posts.length || posts[posts.length - 1] - lo > 11) posts.push(lo + 2);
      for (const px of posts) {
        const { top, bottom } = span(px);
        if (bottom - top < 3 || ground(world, px) - G <= PLINTH) continue;
        const shade = [C.asian.postLit, C.asian.post, C.asian.post, C.asian.post, C.asian.postDark];
        for (let y = top; y < bottom; y += 1) for (let d = -2; d <= 2; d += 1) put(world, px + d, y, M.WOOD, shade[d + 2], owner);
        const gy = ground(world, px);
        for (let dy = -2; dy <= 1; dy += 1) for (let d = -4 + Math.max(0, -dy - 1); d <= 4 - Math.max(0, -dy - 1); d += 1) {
          put(world, px + d, gy + dy, M.MASONRY, dy < -1 ? tone(C.asian.footing, 1.15) : dy < 0 ? tone(C.asian.footing, 1.05) : C.asian.footing, owner);
        }
      }
      const pl = Math.min(...posts) - 2, pr = Math.max(...posts) + 2;
      for (let y = G + D + 14; y < G + S.supportMax; y += 20) {
        let any = false;
        for (let x = pl; x <= pr; x += 1) {
          if (y + 2 >= ground(world, x) - 1) continue;
          any = true;
          put(world, x, y, M.WOOD, C.asian.beamLit, owner);
          put(world, x, y + 1, M.WOOD, C.asian.beam, owner);
          put(world, x, y + 2, M.WOOD, tone(C.asian.beam, 0.78), owner);
        }
        if (!any) break;
      }
      // Railing along the stage edge (front layer).
      for (const st of stages) {
        const edge = st.side < 0 ? p.x0 : p.x1;
        for (let k = 1; k <= S.stage; k += 1) {
          const x = edge + st.side * k;
          deco(world, x, G - 9, P.frame, owner);
          if (k % 6 === 0 || k === S.stage) for (let dy = 1; dy < 9; dy += 1) deco(world, x, G - dy, tone(P.frame, 0.8), owner);
        }
      }
    } else if (style === 'gothic') {
      // Piers every 30 cells with pointed arches between them; the vault behind is dark stone.
      const piers = [];
      for (let x = hi - 3; x >= lo + 3; x -= 30) piers.push(x);
      if (piers[piers.length - 1] - lo > 12) piers.push(lo + 3);
      piers.sort((a, b) => a - b);
      for (let x = lo; x <= hi; x += 1) {
        const { top, bottom } = span(x);
        const g = ground(world, x);
        for (let y = top; y < g; y += 1) {
          PW.setLayer(world, 'back', x, y, rgb((x - lo) % 14 === 0 ? C.gothic.rib : C.gothic.vault));
          PW.setOwner(world, x, y, owner);
        }
        void bottom;
      }
      for (let n = 0; n < piers.length; n += 1) {
        const px = piers[n];
        const { top, bottom } = span(px);
        if (ground(world, px) - G > PLINTH) for (let y = top; y < bottom; y += 1) for (let d = -3; d <= 2; d += 1) {
          put(world, px + d, y, M.MASONRY, (y % 6 === 0) ? C.gothic.joint : d === -3 ? C.gothic.stoneLit : d === 2 ? C.gothic.stoneDark : C.gothic.stone, owner);
        }
        // The pointed arch to the next pier (two arcs meeting at the crown, each centred on the
        // far springing point): masonry spandrel above the curve, open below it.
        if (n + 1 < piers.length) {
          const a = px + 3, b = piers[n + 1] - 4, half = (b - a) / 2, mid = (a + b) / 2;
          const lowest = Math.min(ground(world, a), ground(world, b));
          // Keep at least 32 cells of headroom under the springing so troops walk through.
          const rise = Math.max(4, Math.min(half * 1.732, lowest - top - 4 - 32));
          const spring = top + 4 + rise;
          for (let x = a; x <= b; x += 1) {
            const d = Math.abs(x - mid) / half;                               // 0 at the crown, 1 at a pier
            const above = half * Math.sqrt(Math.max(0, 4 - (d + 1) * (d + 1)));  // arc height over the springing
            const intrados = Math.round(spring - above * rise / (half * 1.732));
            for (let y = top; y < Math.min(intrados, ground(world, x)); y += 1) {
              put(world, x, y, M.MASONRY, (y % 6 === 0) ? C.gothic.joint : y >= intrados - 2 ? C.gothic.stoneLit : C.gothic.stone, owner);
            }
          }
        }
      }
      // Stepped buttresses down the slope beyond the outer piers.
      for (const st of stages) {
        const x0 = st.end;
        const { top } = span(x0);
        const g = ground(world, x0);
        for (let y = top; y < g + EMBED; y += 1) {
          const out = 3 + Math.floor((y - top) / 16) * 3;
          for (let d = 1; d <= out; d += 1) {
            const x = x0 + st.side * d;
            if (y >= ground(world, x) + EMBED) continue;
            put(world, x, y, M.MASONRY, (y - top) % 16 === 0 ? C.gothic.stoneLit : (y % 6 === 0) ? C.gothic.joint : C.gothic.stone, owner);
          }
        }
      }
    } else {
      // Pilotis every 30 cells, set back from the deck's ends (the deck cantilevers), braced
      // in steel when tall, on footing pads.
      const posts = [];
      for (let x = hi - 10; x >= lo + 10; x -= 30) posts.push(x);
      if (!posts.length) posts.push(Math.round((lo + hi) / 2));
      for (const px of posts) {
        const { top, bottom } = span(px);
        if (ground(world, px) - G <= PLINTH) continue;
        for (let y = top; y < bottom; y += 1) for (let d = -1; d <= 2; d += 1) put(world, px + d, y, M.CONCRETE, d === -1 ? C.modern.concreteLit : d === 2 ? C.modern.concreteDark : C.modern.concrete, owner);
        const gy = ground(world, px);
        for (let dy = 0; dy < 3; dy += 1) for (let d = -4; d <= 5; d += 1) put(world, px + d, gy + dy, M.FOUNDATION, [124, 122, 116], owner);
      }
      posts.sort((a, b) => a - b);
      for (let n = 0; n + 1 < posts.length; n += 1) {
        const a = posts[n] + 3, b = posts[n + 1] - 2;
        const top = G + D + 2, bottom = Math.min(ground(world, a), ground(world, b)) - 2;
        if (bottom - top < 50) continue;
        for (const [x0, y0, x1, y1] of [[a, top, b, bottom], [a, bottom, b, top]]) {
          const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
          for (let s = 0; s <= steps; s += 1) {
            const x = Math.round(x0 + (x1 - x0) * s / steps), y = Math.round(y0 + (y1 - y0) * s / steps);
            if (y >= ground(world, x)) continue;
            put(world, x, y, M.STEEL, C.modern.steel, owner);
            put(world, x, y + 1, M.STEEL, C.modern.steelDark, owner);
          }
        }
      }
      for (const st of stages) {
        const edge = st.side < 0 ? p.x0 : p.x1;
        for (let k = 1; k <= S.stage; k += 1) {
          const x = edge + st.side * k;
          for (let dy = 1; dy <= 9; dy += 1) deco(world, x, G - dy, dy === 9 ? C.modern.steel : mix(C.modern.glass, [255, 255, 255], (x + dy) % 7 === 0 ? 0.4 : 0), owner);
        }
      }
    }
    // Down from the end of the stage: a 45° flight of steps where it meets the slope within a
    // short run (timber treads on posts, a solid stone perron, concrete treads on columns), or a
    // ladder where the hill falls away about as fast as the steps would.
    const RUN = 96;
    const stepMat = style === 'asian' ? M.WOOD : style === 'gothic' ? M.MASONRY : M.CONCRETE;
    for (const st of stages) {
      const out = (k) => st.end + st.side * k;
      const treadAt = (k) => G + 4 * (((k - 1) >> 2) + 1);
      if (p.natural(out(2)) - G < 6 && st.side !== p.hangarSide) { st.access = 'level'; continue; }
      if (st.side === p.hangarSide) {
        // Vehicles leave a hangar down a 1:2 ramp (the road grade), paved on a solid embankment
        // faced like the style's retaining walls.
        const pave = PW.settlementTools ? PW.settlementTools.PAVING[style] : null;
        let k = 1;
        for (; k <= RUN * 2; k += 1) {
          const x = out(k), s = G + (k >> 1), g = p.natural(x);
          if (s >= g) break;
          for (let y = k === 1 ? Math.min(s, G + D - 1) : s; y < g + EMBED; y += 1) {
            const c = y === s ? (pave ? pave.paving : [96, 96, 92]) : y === s + 1 ? (pave ? pave.base : [80, 76, 70]) : wallCell(style, x, y, 1, y - s, 99, P);
            put(world, x, y, style === 'modern' ? M.CONCRETE : M.MASONRY, c, owner);
          }
        }
        st.access = 'ramp';
        st.run = k - 1;
        continue;
      }
      let n = 1;
      while (n <= RUN && treadAt(n) < p.natural(out(n))) n += 1;
      if (n > RUN) {
        st.access = 'ladder';
        const rail = style === 'asian' ? C.asian.post : style === 'gothic' ? C.gothic.stoneDark : C.modern.steelDark;
        const rung = style === 'asian' ? C.asian.beamLit : style === 'gothic' ? [96, 92, 100] : C.modern.steel;
        st.ladderX = out(5);
        for (let d = 1; d <= 8; d += 1) {
          const x = out(d);
          for (let y = G - 6; y < p.natural(x); y += 1) {
            const isRail = d === 1 || d === 8, isRung = (y - G) % 6 === 0;
            if (isRail || isRung) PW.setLayer(world, 'back', x, y, rgb(isRail ? rail : rung));
            PW.setFlag(world, x, y, FLAG.LADDER);
            if (owner) PW.setOwner(world, x, y, owner);
          }
        }
        continue;
      }
      st.access = 'steps';
      st.run = n - 1;
      const postEvery = style === 'asian' ? 8 : 12;
      for (let k = 1; k < n; k += 1) {
        const x = out(k), s = treadAt(k), g = p.natural(x);
        // The first tread is tied into the deck; posts (and the last steps) go down to the ground.
        const top = k === 1 ? Math.min(s, G + D - 1) : s;
        const toGround = style === 'gothic' || k % postEvery < 2 || g - s <= 9;
        const bottom = toGround ? g + EMBED : s + 5;
        for (let y = top; y < bottom; y += 1) {
          const post = y >= s + 5;
          const c = style === 'asian' ? (y === s ? C.asian.boards : post ? (k % postEvery ? C.asian.postDark : C.asian.post) : C.asian.beam)
            : stepCell(style, y === s, x, y);
          put(world, x, y, stepMat, c, owner);
        }
      }
    }
    return { cols: cols.length, stages };
  }

  // A buried amber core in its cradle at world (cx, cy).
  function core(world, cx, cy, owner) {
    const r = 4;
    for (let y = cy - r - 2; y <= cy + r + 2; y += 1) for (let x = cx - r - 2; x <= cx + r + 2; x += 1) {
      const dx = x - cx, dy = y - cy;
      if (Math.abs(dx) <= r && Math.abs(dy) <= r) put(world, x, y, M.CORE, tone(K.CORE_COLOR, 1.25 - (dx + dy + 8) / 16 * 0.45), owner);
      else if (dy > r || (Math.abs(dx) > r && dy >= 0)) put(world, x, y, M.FOUNDATION, tone(K.CORE_SHADE, 0.95), owner);
    }
  }

  // ---- Place a building with its base ------------------------------------------------------------------
  // Plans the floor, cuts and builds the base, stamps the canvas at the floor (its buried cores are
  // set into the real ground under it) and returns { stamp, plan }. null if the lot can't take it.
  function place(world, canvas, worldX, options = {}) {
    const style = options.style || (canvas.meta && canvas.meta.style) || 'modern';
    const p = plan(world, canvas, worldX, style);
    if (!p) return null;
    const owner = options.owner || 0;
    const { G } = p;
    // Clear plants over the lot, then cut the building's own footprint down to the floor.
    for (let x = p.x0 - 2; x <= p.x1 + 2; x += 1) {
      for (let y = Math.min(ground(world, x), G) - 240; y < Math.min(ground(world, x), G); y += 1) PW.setLayer(world, 'deco', x, y, 0);
      for (let y = Math.min(ground(world, x), G); y < G; y += 1) dig(world, x, y);
    }
    const walls = p.uphill.map((side) => retainingWall(world, p, side, owner)).filter(Boolean);
    const under = underStructure(world, p, owner);
    const stamp = PW.stampBuilding(world, canvas, worldX, G, { owner, skipBuried: true });
    // Cores: where the floor is raised, down into the ground under the footing.
    const cores = [];
    for (const c of canvas.cores) {
      const wx = worldX + c.x, depth = c.y - canvas.ground;
      if (depth <= 0) { cores.push({ x: wx, y: G + depth }); continue; }   // above the floor (a hangar cradle): stamped with the canvas
      const g = Math.max(G, p.natural(wx));
      core(world, wx, g + depth, owner);
      cores.push({ x: wx, y: g + depth });
    }
    return { stamp, plan: p, walls, under, cores };
  }

  PW.foundations = { plan, place, core, STYLE, CUT_MAX };
})();
