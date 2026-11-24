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
// The cores' vaults hang under the floor with it: in the ground, or among a stage's piers.
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
  // Every foundation is the dead machine god's own work (the user's lore: the cores are the
  // DMG's gifts, given to build great, strong cities and armies) - so whatever FORM each style's
  // base takes to meet the terrain (battered walls, stone stages, anchored concrete), its
  // MATERIAL is the one gun-metal plate-and-concrete of the core beds and the gallery between
  // them. The faction's own colours begin above the ground line.
  const C = {
    asian: { post: [86, 90, 98], postLit: [112, 118, 126], postDark: [58, 60, 66], beam: [74, 78, 86], beamLit: [104, 110, 118],
      boards: [96, 100, 106], stone: [[104, 108, 114], [92, 96, 102], [118, 122, 128], [80, 84, 90]], joint: [48, 50, 56], footing: [96, 100, 106] },
    gothic: { stone: [100, 104, 112], stoneLit: [122, 126, 134], stoneDark: [72, 76, 84], joint: [56, 58, 64], vault: [38, 40, 46], rib: [66, 70, 78] },
    modern: { concrete: [108, 112, 118], concreteLit: [132, 136, 142], concreteDark: [84, 88, 94], board: [98, 102, 108],
      anchor: [66, 70, 78], bolt: [150, 156, 164], weep: [42, 44, 48], steel: [96, 102, 110], steelDark: [62, 66, 74], glass: [140, 170, 180] },
  };

  // ---- Cells ----------------------------------------------------------------------------------------
  function put(world, x, y, mat, color, owner) {
    if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return;
    // N83: never over the supply bundle - its casing and its carved lanes alike. The
    // wall parts around the pipe; the pipe sleeves on through the works.
    const was = PW.get(world, x, y) & ID_MASK;
    if (was === M.PIPE || (PW.getFlags(world, x, y) & PW.FLAG.HOLLOW)) return;
    PW.set(world, x, y, mat, { quiet: true });
    PW.setLayer(world, 'paint', x, y, rgb(color));
    PW.setLayer(world, 'deco', x, y, 0);
    if (owner) PW.setOwner(world, x, y, owner);
  }
  function dig(world, x, y) {
    const id = PW.get(world, x, y) & ID_MASK;
    if (id === M.PIPE || (PW.getFlags(world, x, y) & PW.FLAG.HOLLOW)) return;   // N83: the bundle stands
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
  // Where the wall on `side` goes and how it is climbed (no cells written). null if no wall is needed.
  function wallLayout(p, side) {
    const { style, G, natural } = p;
    const edge = side < 0 ? p.x0 : p.x1;
    const at = (k) => edge + side * k;
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
    const thick = (h) => T + (style === 'asian' ? Math.round((L.H - Math.max(0, h)) * 0.08) : 0);
    // (the far side of the wall top includes an ishigaki wall's tiled cap, one cell past the stones)
    return { ...L, side, edge, at, T, thick, access: L.Hw + 4 <= L.room ? 'steps' : 'ladder', far: L.faceAt(L.Hw) + side * (Math.max(thick(L.Hw), T) + 1) };
  }
  function retainingWall(world, p, side, owner) {
    const L = wallLayout(p, side);
    if (!L) return null;
    const { style, G, natural } = p;
    const P = STYLES[style];
    const { edge, at, T, thick, court, wallX, H, faceAt, wallTop, Hw, startX, access } = L;
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
    if (access === 'steps') {
      for (let i = 0; wallTop + i * 4 < G; i += 1) {
        const surface = wallTop + i * 4;
        for (let j = 0; j < 4; j += 1) {
          const x = startX - side * (i * 4 + j);
          for (let y = surface; y < G; y += 1) put(world, x, y, M.MASONRY, stepCell(style, y === surface, x, y, P), owner);
        }
      }
    } else {
      const rail = style === 'asian' ? C.asian.post : style === 'gothic' ? C.gothic.stoneDark : C.modern.steelDark;
      const rung = style === 'asian' ? C.asian.beamLit : style === 'gothic' ? [96, 92, 100] : C.modern.steel;
      // It leans on the face of a battered ishigaki wall; elsewhere it stands clear of the base course.
      const ladderAt = (h) => (style === 'asian' ? faceAt(h) : faceAt(0));
      for (let y = wallTop - 6; y < G; y += 1) for (let d = 1; d <= 8; d += 1) {
        const x = ladderAt(G - y) - side * d;
        const isRail = d === 1 || d === 8, isRung = (y - wallTop) % 6 === 0;
        if (isRail || isRung) { PW.setLayer(world, 'back', x, y, rgb(isRail ? rail : rung)); PW.setFlag(world, x, y, FLAG.FITTING); }
        PW.setFlag(world, x, y, FLAG.LADDER);
        if (owner) PW.setOwner(world, x, y, owner);
      }
    }
    return { side, edge, wallX, court, height: Hw, top: wallTop, access, far: L.far,
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
  // How the stage on `side` is left (no cells written): down a 1:2 vehicle ramp from a hangar, a
  // flight of steps (4 down per 5 along, 38.7° - under the tanks' 43° limit) where it meets the
  // slope within a short run, a ladder where the hill falls away about as fast as the steps
  // would, or level with the ground.
  const RUN = 96;
  const treadRow = (G, k) => G + 4 * (Math.floor((k - 1) / 5) + 1);
  function stagePlan(p, side) {
    const { G, natural } = p;
    const end = (side < 0 ? p.x0 : p.x1) + side * STYLE[p.style].stage;
    const out = (k) => end + side * k;
    if (side === p.hangarSide) {
      let k = 1;
      while (k <= RUN * 2 && G + (k >> 1) < natural(out(k))) k += 1;
      return { side, end, out, access: 'ramp', run: k - 1 };
    }
    if (natural(out(2)) - G < 6) return { side, end, out, access: 'level', run: 0 };
    let n = 1;
    while (n <= RUN && treadRow(G, n) < natural(out(n))) n += 1;
    return n > RUN ? { side, end, out, access: 'ladder', run: 8, ladderX: out(5) } : { side, end, out, access: 'steps', run: n - 1 };
  }
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
      stages.push(stagePlan(p, side));
    }
    if (!cols.length) return null;
    cols.sort((a, b) => a - b);
    const D = S.deck;
    // The plinth carries on under the stage where the ground there is only a little lower.
    for (const x of cols) {
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
        // (every column of a pillar goes down into the ground under it: none hangs on a slope)
        for (let d = -2; d <= 2; d += 1) for (let y = top; y < span(px + d).bottom; y += 1) put(world, px + d, y, M.WOOD, shade[d + 2], owner);
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
        const { top } = span(px);
        if (ground(world, px) - G > PLINTH) for (let d = -3; d <= 2; d += 1) for (let y = top; y < span(px + d).bottom; y += 1) {
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
        const { top } = span(px);
        if (ground(world, px) - G <= PLINTH) continue;
        for (let d = -1; d <= 2; d += 1) for (let y = top; y < span(px + d).bottom; y += 1) put(world, px + d, y, M.CONCRETE, d === -1 ? C.modern.concreteLit : d === 2 ? C.modern.concreteDark : C.modern.concrete, owner);
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
    // Down from the end of the stage: a flight of steps (treadRow: 38.7°) where it meets the slope within a
    // short run (timber treads on posts, a solid stone perron, concrete treads on columns), or a
    // ladder where the hill falls away about as fast as the steps would.
    const stepMat = style === 'asian' ? M.WOOD : style === 'gothic' ? M.MASONRY : M.CONCRETE;
    for (const st of stages) {
      const { out } = st;
      if (st.access === 'level') continue;
      if (st.access === 'ramp') {
        // Vehicles leave a hangar down a 1:2 ramp (the road grade), paved on a solid embankment
        // faced like the style's retaining walls.
        const pave = PW.settlementTools ? PW.settlementTools.PAVING[style] : null;
        for (let k = 1; k <= st.run; k += 1) {
          const x = out(k), s = G + (k >> 1), g = p.natural(x);
          for (let y = k === 1 ? Math.min(s, G + D - 1) : s; y < g + EMBED; y += 1) {
            const c = y === s ? (pave ? pave.paving : [96, 96, 92]) : y === s + 1 ? (pave ? pave.base : [80, 76, 70]) : wallCell(style, x, y, 1, y - s, 99, P);
            put(world, x, y, style === 'modern' ? M.CONCRETE : M.MASONRY, c, owner);
          }
        }
        continue;
      }
      if (st.access === 'ladder') {
        const rail = style === 'asian' ? C.asian.post : style === 'gothic' ? C.gothic.stoneDark : C.modern.steelDark;
        const rung = style === 'asian' ? C.asian.beamLit : style === 'gothic' ? [96, 92, 100] : C.modern.steel;
        for (let d = 1; d <= 8; d += 1) {
          const x = out(d);
          for (let y = G - 6; y < p.natural(x); y += 1) {
            const isRail = d === 1 || d === 8, isRung = (y - G) % 6 === 0;
            if (isRail || isRung) { PW.setLayer(world, 'back', x, y, rgb(isRail ? rail : rung)); PW.setFlag(world, x, y, FLAG.FITTING); }
            PW.setFlag(world, x, y, FLAG.LADDER);
            if (owner) PW.setOwner(world, x, y, owner);
          }
        }
        continue;
      }
      const postEvery = style === 'asian' ? 8 : 12;
      for (let k = 1; k <= st.run; k += 1) {
        const x = out(k), s = treadRow(G, k), g = p.natural(x);
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
    // N124 (the user's: units pass poles): the space under the deck - its posts, piers, ties and
    // braces - is the building's to let its own side through, as its gate piers are (record.gates)
    const posts = [];
    for (const x of cols) { const g = ground(world, x); if (g - 1 >= G + D) posts.push({ x, y0: G + D, y1: g - 1 }); }
    return { cols: cols.length, stages, posts };
  }

  // ---- Steep ground -----------------------------------------------------------------------------------
  // How steep the land under [x0, x1] is, as it lies now: its relief (top to bottom) and its grade
  // (the mean rise per column over 16-column runs). Each kind of building needs land gentle enough
  // for it - a farm the gentlest (its yard is worked), houses, cores and mines gentle land - and
  // only military buildings go on mountain tops and sides, on solid foundations.
  const STEEP = {
    farm: { grade: 0.22, relief: 40 },
    population: { grade: 0.35, relief: 64 },
    core: { grade: 0.35, relief: 64 },
    mine: { grade: 0.5, relief: 90 },
  };
  function lie(world, x0, x1) {
    let lo = Infinity, hi = -Infinity, rise = 0, runs = 0;
    for (let x = x0; x <= x1; x += 1) { const g = ground(world, x); lo = Math.min(lo, g); hi = Math.max(hi, g); }
    for (let x = x0; x + 16 <= x1; x += 4) { rise += Math.abs(ground(world, x + 16) - ground(world, x)) / 16; runs += 1; }
    return { relief: hi - lo, grade: runs ? rise / runs : 0 };
  }
  // Whether a building of `type` may stand on the land under [x0, x1].
  function allows(world, type, x0, x1) {
    const limit = STEEP[type], l = lie(world, x0, x1);
    return { ok: !limit || (l.grade <= limit.grade && l.relief <= limit.relief), ...l, limit: limit || null };
  }

  // ---- Measure ----------------------------------------------------------------------------------------
  // The columns [left, right] that place() would build on for this canvas at worldX (walls,
  // forecourts, stages, steps, ramps and buttresses), without writing anything. null if the lot
  // can't take the building.
  function measure(world, canvas, worldX, style) {
    const p = plan(world, canvas, worldX, style);
    if (!p) return null;
    let left = p.x0 - 2, right = p.x1 + 2;
    const reach = (side, x) => { if (side < 0) left = Math.min(left, x); else right = Math.max(right, x); };
    // (and how tall a retaining wall each side needs: the town's layout keeps a lot off ground
    // that would need one much taller than the deepest cut)
    const wall = { '-1': 0, 1: 0 };
    for (const side of p.uphill) {
      const L = wallLayout(p, side);
      if (L) { reach(side, L.far + side * 2); wall[side] = L.Hw; }
    }
    for (const side of p.downhill) {
      const st = stagePlan(p, side);
      // A gothic stage ends in a buttress stepping out 3 cells for every 16 it falls.
      const buttress = p.style === 'gothic' ? 3 + Math.floor((p.natural(st.end) + EMBED - p.G) / 16) * 3 : 0;
      reach(side, st.end + side * (Math.max(st.run, buttress) + 2));
    }
    return { plan: p, left, right, wall };
  }

  // ---- Stepped rock foundations (military on mountains) ----------------------------------------------
  // A mountain outpost does not perch on the peak: the summit is cut down to a bench, and under
  // the bench's edges the rock is built up in solid stepped terraces of battered courses, down to
  // the massif on either flank (the mountain-fortress ref). Each terrace is a flat tread a guard
  // can stand on. Returns the span of the works and the treads, or null if the bench would need
  // more build-up than a solid foundation can give.
  const TREAD = 13, RISE = 14, STEPS_MAX = 7, BUILD_MAX = 110;
  const UP_TREAD = 10, UP_RISE = 12, UP_MAX = 10;
  const TERRACE_C = {
    asian: { fill: [122, 118, 112], face: [104, 100, 96], cap: [146, 142, 132], joint: [62, 60, 58] },
    gothic: { fill: [128, 124, 138], face: [106, 102, 116], cap: [150, 146, 160], joint: [76, 72, 86] },
    modern: { fill: [158, 160, 156], face: [136, 138, 134], cap: [184, 186, 182], joint: [108, 110, 108] },
  };
  function rockTerrace(world, x0, x1, Y, style, owner) {
    const col = TERRACE_C[style] || TERRACE_C.modern;
    const reach = Math.max(STEPS_MAX * TREAD, UP_MAX * UP_TREAD);
    // The ground as it is now, before any cutting (the works are measured against it).
    const nat = [];
    for (let x = x0 - reach; x <= x1 + reach; x += 1) nat[x - (x0 - reach)] = ground(world, x);
    const natural = (x) => nat[Math.max(0, Math.min(nat.length - 1, x - (x0 - reach)))];
    for (let x = x0; x <= x1; x += 1) if (natural(x) - Y > BUILD_MAX) return null;
    // Where the flank falls away, the bench's edge is carried down on stepped terraces of solid
    // fill; where the mountain rises on, the cut is benched instead - a back-wall of steps up to
    // the natural ground, each face short enough to hold (never one sheer cut that sheds).
    const uphill = { '-1': natural(x0 - 2) < Y - FLAT, 1: natural(x1 + 2) < Y - FLAT };
    const target = (x) => {
      const side = x < x0 ? -1 : x > x1 ? 1 : 0;
      if (!side) return Y;
      const out = side < 0 ? x0 - x : x - x1;
      return uphill[side] ? Y - Math.min(UP_MAX, Math.ceil(out / UP_TREAD)) * UP_RISE
        : Y + Math.min(STEPS_MAX, Math.ceil(out / TREAD)) * RISE;
    };
    const edge = { '-1': x0 - 1, 1: x1 + 1 };
    for (const side of [-1, 1]) {
      let x = side < 0 ? x0 : x1;
      const works = (k) => uphill[side] ? target(k) > natural(k) : target(k) < natural(k);
      while (Math.abs(x - (side < 0 ? x0 : x1)) < reach && works(x + side)) x += side;
      // A back-wall that would still be mid-cliff after its last step cannot be benched: no works.
      if (uphill[side] && works(x + side)) return null;
      edge[side] = x;
    }
    const treads = [];
    for (let x = edge[-1]; x <= edge[1]; x += 1) {
      const T = target(x), g = natural(x);
      // Clear plants over the works, cut the rock above the profile...
      for (let y = Math.min(g, T) - 240; y < Math.min(g, T); y += 1) PW.setLayer(world, 'deco', x, y, 0);
      for (let y = Math.min(g, T); y < T; y += 1) dig(world, x, y);
      // ...and build the profile up to the rock below it in solid battered courses: coursed fill,
      // a darker outer face on the risers, a lit cap along every tread (a benched back-wall gets
      // the cap alone: its steps are cut rock, not fill).
      const course = (y) => (y - Y) % 7 === 0 || (x + ((((y - Y) / 7) | 0) & 1) * 4) % 11 === 0;
      const outward = x < x0 ? -1 : 1;
      for (let y = T; y < T + 2; y += 1) put(world, x, y, M.FOUNDATION, col.cap, owner);
      for (let y = T + 2; y < g + EMBED; y += 1) {
        const riser = target(x + outward) !== T;   // column at a step's outer face
        put(world, x, y, M.FOUNDATION, course(y) ? col.joint : riser ? col.face : col.fill, owner);
      }
      if (T > Y && T < g && target(x + outward) > T) treads.push({ x, y: T, side: outward });
    }
    return { x0: edge[-1], x1: edge[1], treads };
  }

  // ---- Place a building with its base ------------------------------------------------------------------
  // Plans the floor, cuts and builds the base, stamps the canvas at the floor (with its core vaults
  // under it) and returns { stamp, plan }. null if the lot can't take it.
  // The god's work does not stop dead at the lot line: a skirt of its metal runs on just under
  // the turf either side, stepping with the terrain and breaking up into it with distance - the
  // city radiating outward from its cores (the user's roots/circuit rule), and the band's ends
  // smoothed into the land instead of a vertical face.
  function giftSkirt(world, p, owner) {
    for (const side of [-1, 1]) {
      const edge = side < 0 ? p.x0 : p.x1;
      for (let d = 1; d <= 14; d += 1) {
        const x = edge + side * d;
        if (x < 2 || x >= world.width - 2) break;
        const g = ground(world, x);
        if (PW.getFlags(world, x, g) & FLAG.ROAD) break;        // the street's own base takes over
        if (PW.getOwner(world, x, g + 2)) break;                // a neighbour's work already there
        // Only bare, natural turf takes the skirt: any style's paving - or its flared road base
        // reaching past the flags - stops it dead.
        const sid = PW.get(world, x, g) & ID_MASK;
        if (![M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.SAND, M.LOOSE_SOIL, M.LOOSE_STONE].includes(sid)) break;
        const depth = d < 6 ? 3 : d < 10 ? 2 : 1;
        for (let k = 0; k < depth; k += 1) {
          const y = g + 2 + k;
          // (breaking up with distance - in CLUMPS, never lone speckle cells)
          if ((PW.hash2(x >> 2, k) & 7) < (d > 8 ? 4 : d > 4 ? 2 : 0)) continue;
          const id = PW.get(world, x, y) & ID_MASK;
          if (!PW.mat.terrain[id] || id === M.ORE || id === M.BEDROCK) continue;
          const c = mix([96, 100, 106], [100, 92, 76], Math.min(1, d / 14));
          put(world, x, y, M.FOUNDATION, tone(c, (PW.hash2(x, y) & 3) === 0 ? 0.88 : 1), owner);
        }
      }
    }
  }

  // Roots: under every bed a few fingers of the god's metal wander down into the earth, an ink
  // trace inside each, thinning to a black spear point - the circuit rooting the city (the
  // user's rule: the cores radiate everything outward, deeper into natural ground). Never
  // through ore or bedrock; the fingers thread what ground is really there.
  function coreRoots(world, cx, yTop, owner) {
    const lay = (x, y, color) => {
      const id = PW.get(world, x, y) & ID_MASK;
      if (!PW.mat.terrain[id] || id === M.ORE || id === M.BEDROCK) return;
      put(world, x, y, M.FOUNDATION, color, owner);
    };
    for (let r = 0; r < 3; r += 1) {
      let x = cx + [-7, 1, 8][r] + (PW.hash2(cx, r) & 1);
      const len = 12 + (PW.hash2(cx + r * 17, yTop) & 15);
      for (let d = 0; d < len; d += 1) {
        const y = yTop + d;
        if ((PW.hash2(x, y) & 3) === 3) x += (PW.hash2(y, x) & 1) ? 1 : -1;
        const tipD = len - d;
        if (tipD <= 2) { lay(x, y, [8, 8, 10]); continue; }
        lay(x, y, d % 5 === 2 ? [40, 40, 44] : [84, 88, 94]);
        if (tipD > 5) lay(x + 1, y, (d & 3) === 1 ? [8, 8, 10] : [74, 78, 84]);
      }
    }
  }

  // The deck between a building's beds is a flat layer ABOVE the land, not a slab through it
  // (the user's rule: the metal terrain matches the varying terrain). Where the old ground runs
  // close under the deck, the god-metal embeds a few cells into it; where the land falls away,
  // slender piers carry the deck down to it and the slope shows through underneath. It radiates
  // like everything else: more finished against the beds, earthing with distance.
  function bedUnderbody(world, beds, G, naturalAt, owner) {
    const wall = (PW.buildingKit && PW.buildingKit.VAULT ? PW.buildingKit.VAULT.wall : 4);
    const deckBot = G + 8;
    const lay = (x, y, color) => {
      const id = PW.get(world, x, y) & ID_MASK;
      if (PW.mat.structural[id] || id === M.ORE || id === M.BEDROCK) return;
      const o = PW.getOwner(world, x, y);
      if (o && o !== owner) return;
      put(world, x, y, M.FOUNDATION, color, owner);
    };
    // Every bed stands on its own solid plinth first: god-metal from the vault's underside down
    // into the ground it was cut into, so no armoured vault ever borders open air below (debris
    // through an under-deck gap must not reach a core's underside).
    for (const bed of beds) {
      const bot = bed.bottom ?? deckBot;
      for (let x = bed.x0 - 2; x <= bed.x1 + 2; x += 1) {
        const n = Math.max(bot + 4, Math.round(naturalAt(x)) + 5);
        for (let y = bot + 1; y <= n; y += 1) {
          lay(x, y, mix(tone([96, 100, 106], (PW.hash2(x >> 1, y >> 1) & 3) === 0 ? 0.9 : 1), [98, 90, 74], Math.min(1, (y - bot) / 14)));
        }
      }
    }
    for (let i = 0; i + 1 < beds.length; i += 1) {
      const a = beds[i], b = beds[i + 1];
      const x0 = a.x1 + wall + 2, x1 = b.x0 - wall - 2;
      if (x1 - x0 < 2) continue;
      const half = Math.max(1, (x1 - x0) / 2);
      for (let x = x0; x <= x1; x += 1) {
        const t = 1 - Math.min(x - x0, x1 - x) / half;
        const n = Math.max(deckBot - 4, Math.round(naturalAt(x)));
        const gap = n - deckBot;
        if (gap <= 6) {
          // the land runs close: the deck embeds into it, breaking up with depth (in clumps,
          // never lone speckle cells)
          for (let y = deckBot + 1; y <= n + 5; y += 1) {
            if ((PW.hash2(x >> 2, y >> 1) & 7) < (y > n + 2 ? 3 : 0)) continue;
            lay(x, y, mix(tone([96, 100, 106], (PW.hash2(x, y) & 3) === 0 ? 0.9 : 1), [98, 90, 74], Math.min(1, (1 - t) * 0.45 + (y - deckBot) / 16)));
          }
        } else if (((x - x0) % 18) < 2) {
          // the land falls away: a slender pier carries the deck down to it, an ink dash in it,
          // a black spear foot driven into the ground
          for (let y = deckBot + 1; y <= n + 6; y += 1) {
            lay(x, y, y > n + 3 ? [8, 8, 10] : (y - deckBot) % 6 === 3 ? [40, 40, 44] : [84, 88, 94]);
          }
        }
      }
    }
  }

  // N73: the first stamp lays only the gift - everything from two rows over the floor line
  // down (beds, vaults, the gallery between them) plus every core and grate wherever it
  // stands (repair never rebuilds hearts) - and leaves the body above as blueprint, for
  // repair to raise out of the translator: pillars up the core's top, floors branching
  // outward, walls trailing (the F2 order, the user's build rule).
  function stampGift(world, canvas, worldX, groundY, owner) {
    const ox = Math.round(worldX), oy = Math.round(groundY - canvas.ground);
    const { width, height } = canvas;
    const R = PW.buildingKit.ROLE;
    const keep = (i, ly) => ly >= canvas.ground - 2 || canvas.role[i] === R.CORE || canvas.role[i] === R.GRATE;
    for (let ly = 0; ly < height; ly += 1) {
      const wy = oy + ly;
      if (wy < 1 || wy >= world.height - 1) continue;
      for (let lx = 0; lx < width; lx += 1) {
        const wx = ox + lx;
        if (wx < 1 || wx >= world.width - 1) continue;
        const i = ly * width + lx;
        if (!keep(i, ly) || (!canvas.mat[i] && !canvas.back[i])) continue;
        if (canvas.mat[i]) {
          PW.set(world, wx, wy, canvas.mat[i], { quiet: true, keepPaint: true });
          PW.setLayer(world, 'paint', wx, wy, canvas.paint[i]);
        } else {
          const current = PW.get(world, wx, wy) & 63;
          if (current !== M.AIR && current !== M.WATER) PW.set(world, wx, wy, M.AIR, { quiet: true });
        }
        if (canvas.back[i]) PW.setLayer(world, 'back', wx, wy, canvas.back[i]);
        if (canvas.deco[i] || canvas.mat[i]) PW.setLayer(world, 'deco', wx, wy, canvas.deco[i]);
        PW.setOwner(world, wx, wy, owner);
      }
    }
    // The gift band's grated spans keep N64's drain flag (the body's get theirs from repair).
    for (const h of canvas.hatches || []) {
      for (let ly = Math.max(0, h.y0); ly <= Math.min(height - 1, h.y1); ly += 1) {
        const wy = oy + ly;
        if (wy < 1 || wy >= world.height - 1) continue;
        for (let lx = h.x0; lx <= h.x1; lx += 1) {
          const wx = ox + lx, i = ly * width + lx;
          if (wx >= 1 && wx < world.width - 1 && canvas.mat[i] && keep(i, ly)) PW.setFlag(world, wx, wy, PW.FLAG.HATCH);
        }
      }
    }
    return { x: ox, y: oy, width, height, canvas };
  }

  // N3 vehicle rule, the PAD RIM: the apron's outward face is a foundation ramp a tank
  // climbs - never a cliff nor an undercut lip. The drives stopped 'too steep' right at
  // the rim, and tower 5's floor edge hung over a dropping street with air beneath it
  // (PS's stopCell diagnostics). Where the land falls away from the pad, a god-metal
  // wedge steps down and out at a tank's grade until it meets the ground.
  function apronRamp(world, p, owner, works, skipSide) {
    const reach = [0, 0];
    for (const side of [-1, 1]) {
      if (side === skipSide) continue;   // (a hangar's runway side carries its own designed ramp)
      const edge = side < 0 ? works[0] : works[1];
      // only a ramp that MEETS the land gets laid - a wedge ending in mid-air over a deep
      // fall leaves a worse cliff than the stage piers it replaced (the slopes suite's
      // 43-cell drop at the stage's foot)
      let meets = false;
      for (let d = 1; d <= 26 && !meets; d += 1) {
        const x = edge + side * d;
        if (x < 2 || x >= world.width - 2) break;
        if (p.G + (d >> 1) >= ground(world, x) + 1) meets = true;
      }
      if (!meets) continue;
      for (let d = 1; d <= 26; d += 1) {
        const x = edge + side * d;
        if (x < 2 || x >= world.width - 2) break;
        const lineY = p.G + (d >> 1);              // about 26 degrees, down and out
        const g = ground(world, x);
        if (lineY >= g + 1) break;                 // met the land: the ramp is home
        const go = PW.getOwner(world, x, g);
        if (go && go !== owner) break;             // a neighbour's works: theirs to keep
        for (let y = lineY; y <= Math.min(world.height - 2, g + 2); y += 1) {
          const id = PW.get(world, x, y) & ID_MASK;
          if (PW.mat.structural[id] || id === M.ORE || id === M.BEDROCK) continue;
          const o = PW.getOwner(world, x, y);
          if (o && o !== owner) continue;
          put(world, x, y, M.FOUNDATION, mix([108, 106, 100], [98, 90, 74], Math.min(1, d / 22)), owner);
        }
        reach[side < 0 ? 0 : 1] = d;
        PW.refreshGroundTop(world, x);
      }
    }
    return reach;
  }

  function place(world, canvas, worldX, options = {}) {
    const style = options.style || (canvas.meta && canvas.meta.style) || 'modern';
    const extent = measure(world, canvas, worldX, style);
    if (!extent) return null;
    const p = extent.plan;
    const owner = options.owner || 0;
    const { G } = p;
    // Clear plants over the lot, then cut the building's own footprint down to the floor.
    for (let x = p.x0 - 2; x <= p.x1 + 2; x += 1) {
      for (let y = Math.min(ground(world, x), G) - 240; y < Math.min(ground(world, x), G); y += 1) PW.setLayer(world, 'deco', x, y, 0);
      for (let y = Math.min(ground(world, x), G); y < G; y += 1) dig(world, x, y);
    }
    // A plinth under the floor wherever the ground is only a little lower (on a level lot too).
    for (let x = p.x0; x <= p.x1; x += 1) {
      const g = p.natural(x);
      if (g > G && g <= G + PLINTH) for (let y = G; y < g + (g > G + FLAT ? EMBED : 0); y += 1) put(world, x, y, M.FOUNDATION, [118, 116, 110], owner);
    }
    const walls = p.uphill.map((side) => retainingWall(world, p, side, owner)).filter(Boolean);
    const under = underStructure(world, p, owner);
    giftSkirt(world, p, owner);
    // N3 vehicle rule: the rim ramps - and its reach is part of the WORKS, so the suite's
    // extent relations, re-seat erasure and the apron sigs all see the same span.
    const runwaySide = canvas.runway ? Math.sign(canvas.runway.direction || (canvas.meta && canvas.meta.facing) || 0) : 0;
    const rampReach = apronRamp(world, p, owner, [extent.left, extent.right], runwaySide);
    // (the cores' vaults hang under the floor with it, in the ground or among the stage's piers)
    // N73 (options.grow): cores first - only the gift is stamped; the body stays blueprint.
    const stamp = options.grow ? stampGift(world, canvas, worldX, G, owner)
      : PW.stampBuilding(world, canvas, worldX, G, { owner });
    if (stamp && under && under.posts) stamp.posts = under.posts;   // (N124: see underStructure)
    const beds =canvas.cores.filter((k) => !k.standing && k.vault)
      .map((k) => ({ x0: worldX + k.vault.x0, x1: worldX + k.vault.x1, bottom: G + k.vault.bottom - canvas.ground + 11 })).sort((u, v) => u.x0 - v.x0);
    bedUnderbody(world, beds, G, p.natural, owner);
    for (const k of canvas.cores) {
      if (k.standing || !k.vault) continue;
      coreRoots(world, worldX + k.x, G + k.vault.bottom - canvas.ground + 12, owner);
    }
    const cores = canvas.cores.map((c) => ({ x: worldX + c.x, y: G + c.y - canvas.ground }));
    return { stamp, plan: p, walls, under, cores,
      works: [extent.left - (rampReach ? rampReach[0] : 0), extent.right + (rampReach ? rampReach[1] : 0)], grown: !!options.grow };
  }

  PW.foundations = { plan, measure, place, lie, allows, rockTerrace, coreRoots, bedUnderbody, STEEP, STYLE, CUT_MAX, CUT_MAX_HANGAR };
})();
