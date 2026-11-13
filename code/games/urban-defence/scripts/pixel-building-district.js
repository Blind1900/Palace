// Districts: several styled buildings side by side in one particle world, so the infill between neighbours,
// the road along their bases and military runways can be tested against real surroundings.
// Infill is real structure (it carries load and can fall) but units walk through it like door panes:
//   narrow gaps (<= 14 px) get a skybridge between matching floors of both buildings,
//   gaps >= 8 px get street lamps beside each building, gaps >= 22 px a landmark (or a park tree between
//   different styles), and leftover ground gets railings. Every prop takes the style of the nearer building.
// The road is a colour layer on the top terrain rows under every building and gap, paved per style, with
// runway markings in front of hangars.
const PIXEL_DISTRICT_LAYOUTS = Object.freeze({
  plaza: { label: 'Wide plaza', lots: [
    { type: 'population', variant: 'slab' }, { type: 'population', variant: 'crown' },
    { type: 'population', variant: 'setback' }], gaps: [52, 66] },
  merge: { label: 'Military merge', lots: [
    { type: 'population', variant: 'slab' }, { type: 'military', variant: 'compound' },
    { type: 'population', variant: 'crown' }], gaps: [3, 8] },
  block: { label: 'Tight block', lots: [
    { type: 'population', variant: 'slab' }, { type: 'population', variant: 'setback' },
    { type: 'population', variant: 'crown' }, { type: 'population', variant: 'offset' }], gaps: [5, 12, 28] },
  base: { label: 'Military base', lots: [
    { type: 'military', variant: 'compound' }, { type: 'population', variant: 'tapered' },
    { type: 'farm', variant: 'silos' }], gaps: [10, 24] },
});

const PIXEL_DISTRICT_MARGIN = 26;

// Prop sprites, rows top to bottom; the last row stands on the ground. Parts: p post/frame, s stone,
// r roof tile, o ornament, l light, c glass, g foliage, t trunk, b bench.
const PIXEL_DISTRICT_PROPS = Object.freeze({
  gothic: {
    lamp: [' ooo ', 'olllo', ' lll ', '  p  ', '  p  ', '  p  ', '  p  ', '  p  ', '  p  ', '  p  ', ' ppp ', ' ppp '],
    landmark: ['   s   ', '  sss  ', 's  s  s', 'ss s ss', ' sssss ', '  sss  ', '  s s  ', ' ooooo ', ' sssss ',
      '  sss  ', '  sss  ', 'sssssss', 'sssssss'],
  },
  asian: {
    lamp: ['  r  ', ' rrr ', 'rrrrr', ' sls ', ' sls ', '  s  ', '  s  ', '  s  ', ' sss ', 'sssss'],
    landmark: ['r             r', 'rrrrrrrrrrrrrrr', ' ppppppppppppp ', '  p   ooo   p  ', '  p   ooo   p  ',
      '  ppppppppppp  ', '  p         p  ', '  p         p  ', '  p         p  ', '  p         p  ', '  p         p  ',
      '  p         p  ', ' ppp       ppp ', ' ppp       ppp '],
  },
  modern: {
    // Drawn arm-left; mirrored so the arm always reaches over the road towards the gap centre.
    lamp: ['pppppp ', 'l    p ', '     p ', '     p ', '     p ', '     p ', '     p ', '     p ', '     p ',
      '     p ', '     p ', '     p ', '    ppp'],
    landmark: ['rrrrrrrrrrrrr', 'p ccccccccc p', 'p c       c p', 'p c       c p', 'p c bbbbb c p', 'p c b   b c p',
      'p c b   b c p', 'p c b   b c p', 'ppppppppppppp'],
  },
  park: ['  ggg  ', ' ggggg ', 'ggggggg', ' ggggg ', '  ggg  ', '   t   ', '   t   ', ' sssss ', ' sssss '],
});

// Street furniture per style, placed between the lamps and the landmark with a clear column around each piece.
// Extra parts: w water, f flowers, y cypress, h hydrant, R/Y/G signal lights, W white marble.
// modern = New York street (signal, hydrant, bench, bin, planter tree); gothic = Rome (fountain, standing and
// broken columns, bollards); asian = Forbidden City (cypress, bronze lion, red tiled wall, marble balustrade).
const PIXEL_DISTRICT_STREET = Object.freeze({
  modern: [
    { name: 'signal', rows: ['ppp', 'pRp', 'pYp', 'pGp', 'ppp', ' p ', ' p ', ' p ', ' p ', ' p ', ' p ', 'ppp'] },
    { name: 'hydrant', rows: [' h ', 'hhh', ' h ', 'hhh'] },
    { name: 'bench', rows: ['bbbbb', 'bbbbb', 'p   p'] },
    { name: 'planter', rows: ['  ggg  ', ' ggggg ', 'ggggggg', ' ggggg ', '   t   ', '   t   ', 'sfgfgfs', 'sssssss'] },
    { name: 'bin', rows: ['ppp', 'pcp', 'ppp'] },
  ],
  gothic: [
    { name: 'fountain', rows: [' w   w ', ' ww ww ', '  www  ', '   o   ', 'w sss w', 'swwwwws', 'sssssss'] },
    { name: 'column', rows: ['sss', ' s ', ' s ', ' s ', ' s ', ' s ', ' s ', ' s ', ' s ', 'sss'] },
    { name: 'ruin', rows: [' s', ' s', 'ss', 'ss', 's ', 'ss', 'sss'] },
    { name: 'bollards', rows: ['s  s  s', 'sppspps', 's  s  s'] },
  ],
  asian: [
    { name: 'cypress', rows: ['  y  ', ' yyy ', ' yyy ', 'yyyyy', ' yyy ', 'yyyyy', 'yyyyy', ' yyy ', '  t  ', '  t  '] },
    { name: 'lion', rows: [' oo ', 'ooo ', 'oooo', 'oo o', 'WWWW', 'WWWW'] },
    { name: 'wall', rows: ['rrrrrrrrr', 'ppppppppp', 'ppppppppp', 'ppppppppp', 'WWWWWWWWW'] },
    { name: 'balustrade', rows: ['W W W W', 'WWWWWWW', 'W W W W'] },
  ],
});
// A pocket park: trees, bench and flower beds on a lawn, used where styles meet on a wide gap.
const PIXEL_DISTRICT_PARK = Object.freeze([
  { name: 'tree', rows: PIXEL_DISTRICT_PROPS.park },
  { name: 'flowers', rows: ['fgfgf', 'ggggg'] },
  { name: 'bench', rows: ['bbbbb', 'bbbbb', 'p   p'] },
  { name: 'tree', rows: ['  ggg  ', ' ggggg ', 'ggggggg', 'ggggggg', ' ggggg ', '   t   ', '   t   ', '   t   '] },
]);

const PIXEL_DISTRICT_COLORS = Object.freeze({
  gothic: { p: [52, 50, 60], s: [150, 146, 140], r: [84, 80, 96], o: [176, 150, 210], l: [255, 214, 120], c: [120, 150, 190],
    paving: [128, 122, 118], joint: [80, 74, 72], base: [70, 62, 58] },
  asian: { p: [176, 58, 46], s: [150, 140, 120], r: [60, 52, 50], o: [226, 178, 64], l: [255, 190, 90], c: [190, 120, 90],
    paving: [176, 156, 120], joint: [120, 70, 50], base: [96, 80, 60] },
  modern: { p: [120, 128, 136], s: [170, 170, 166], r: [96, 140, 170], o: [196, 224, 236], l: [240, 250, 255], c: [120, 180, 205],
    paving: [64, 66, 72], joint: [226, 190, 60], base: [44, 44, 48] },
  shared: { g: [72, 140, 70], t: [100, 72, 48], b: [150, 110, 70], w: [90, 160, 220], f: [226, 96, 140], y: [38, 88, 56],
    h: [196, 48, 40], R: [235, 60, 50], Y: [245, 196, 60], G: [70, 215, 110], W: [232, 228, 218] },
  park: { paving: [84, 150, 72], joint: [104, 170, 86], base: [96, 72, 52] },
  runway: { paving: [52, 54, 58], mark: [235, 235, 235], base: [36, 36, 40] },
});

function pixelDistrictPropColor(part, style, x = 0, y = 0) {
  const shared = PIXEL_DISTRICT_COLORS.shared[part];
  if (shared) return part === 'g' && (x * 7 + y * 3) % 5 === 0 ? shared.map((v) => Math.round(v * 1.18)) : shared;
  return PIXEL_DISTRICT_COLORS[style][part] || PIXEL_BUILDING_STYLE_PALETTES[style].frame;
}

// lots: [{ type, variant, style, owner? }], gaps: pixels between neighbouring buildings (outer reach to
// outer reach; a hangar's runway counts as part of its building). Returns the shared world, every
// building, prop cells, road colours, a unit world that knows all stairs and walk-through pixels, and
// an integration report.
function createPixelDistrict(lots, gaps, level = 4, options = {}) {
  if (!Array.isArray(lots) || !lots.length || !Array.isArray(gaps) || gaps.length !== lots.length - 1) {
    throw new Error('A district needs lots and one gap between each pair');
  }
  // Measure each lot on its own: extents relative to the seed column, including any runway.
  const reachOf = (building) => {
    const { bounds } = building.styled.geometry, runway = building.shape && building.shape.runway;
    return { left: Math.min(bounds.left, runway ? runway.from : Infinity), right: Math.max(bounds.right, runway ? runway.to : -Infinity) };
  };
  const measures = lots.map((lot) => {
    const probe = createPixelStyledBuilding(lot.type, lot.style, level,
      { variant: lot.variant, previewFinished: true, throughDoors: true, owner: lot.owner || 'left' });
    const seedX = Math.floor(probe.source.width / 2), reach = reachOf(probe);
    return { left: reach.left - seedX, right: reach.right - seedX };
  });
  const width = PIXEL_DISTRICT_MARGIN * 2 + measures.reduce((sum, m) => sum + m.right - m.left + 1, 0) + gaps.reduce((a, b) => a + b, 0);
  const source = createPixelStyleLabSource(width);
  const world = createParticleWorldFromSurfaceWaterAndTunnels(
    { heightAt: (x) => source.heights[Math.floor(x / 4)] }, () => null, [],
    { width: source.width, height: source.height, cellSize: 4, originX: 0, originY: 0,
      supportCapacity: options.supportCapacity || 1024, skipEmptyChunks: true });
  const key = (x, y) => y * world.width + x;
  const buildings = [], failures = [];
  let cursor = PIXEL_DISTRICT_MARGIN;
  lots.forEach((lot, index) => {
    try {
      const building = createPixelStyledBuilding(lot.type, lot.style, level, { variant: lot.variant, previewFinished: true, throughDoors: true,
        owner: lot.owner || 'left', world, source, x: cursor - measures[index].left });
      const reach = reachOf(building);
      buildings.push({ ...lot, building, reach, index });
      cursor = reach.right + 1 + (gaps[index] || 0);
    } catch (error) {
      failures.push(`${lot.type}/${lot.variant}: ${error.message}`);
      cursor += measures[index].right - measures[index].left + 1 + (gaps[index] || 0);
    }
  });
  const surfaceY = buildings.length ? buildings[0].building.styled.surfaceY : 0, base = surfaceY - 1;
  const keepClear = new Set(buildings.flatMap((entry) => [...entry.building.shape.keepClear]));
  const groundAt = (x) => { let y = 0; while (y < world.height - 1 && world.at(x, y) !== PARTICLE_TERRAIN) y += 1; return y; };

  // ---------- Infill ----------
  const props = new Map(), infill = [], parks = [];
  const free = (x, y) => x >= 3 && x + 3 < world.width && y >= 1 && world.at(x, y) === PARTICLE_EMPTY && !keepClear.has(key(x, y)) && !props.has(key(x, y));
  // Places a sprite with its bottom row on the ground at column `left`; all or nothing.
  const stampAt = (rows, left, style, kind, mirror = false) => {
    const cells = [];
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c += 1) {
        const part = row[mirror ? row.length - 1 - c : c];
        if (part === ' ') continue;
        const x = left + c, ground = groundAt(x), y = ground - (rows.length - r);
        cells.push({ x, y, part, style });
      }
    });
    if (!cells.every((cell) => free(cell.x, cell.y))) return false;
    for (const cell of cells) props.set(key(cell.x, cell.y), { ...cell, kind });
    return true;
  };
  // Tries the preferred column first, then slides towards `towards` (door approaches stay clear).
  const stamp = (rows, left, style, kind, mirror, towards, limit) => {
    const step = Math.sign(towards - left) || 1;
    for (let offset = 0; offset <= limit; offset += 1) if (stampAt(rows, left + offset * step, style, kind, mirror)) return true;
    return false;
  };
  // One clear column either side of a sprite and nothing already placed inside its box.
  const clearAround = (rows, left) => {
    for (let c = -1; c <= rows[0].length; c += 1) {
      const x = left + c, ground = groundAt(x);
      for (let y = ground - rows.length - 1; y < ground; y += 1) if (props.has(key(x, y)) || keepClear.has(key(x, y))) return false;
    }
    return true;
  };
  const styleAt = (x, a, b, mid) => (x < mid ? a.style : b.style);
  for (let i = 0; i + 1 < buildings.length; i += 1) {
    const a = buildings[i], b = buildings[i + 1];
    const gapLeft = a.reach.right + 1, gapRight = b.reach.left - 1, gap = gapRight - gapLeft + 1;
    const mid = Math.floor((gapLeft + gapRight + 1) / 2), report = { between: [a.index, b.index], gap, items: [] };
    if (gap <= 0) { report.items.push('touching'); infill.push(report); continue; }
    if (gap <= 14) {
      const bridge = pixelDistrictBridge(world, a, b, gapLeft, gapRight, mid, free, key);
      if (bridge) { for (const cell of bridge.cells) props.set(key(cell.x, cell.y), { ...cell, kind: 'bridge' }); report.items.push(`skybridge@storey${bridge.storey}`); }
      else report.items.push('no bridge (no shared floor)');
    }
    if (gap >= 8) {
      const lampA = PIXEL_DISTRICT_PROPS[a.style].lamp, lampB = PIXEL_DISTRICT_PROPS[b.style].lamp;
      const reach = Math.max(0, Math.floor(gap / 2) - 4);
      if (stamp(lampA, gapLeft + 1, a.style, 'lamp', a.style === 'modern', mid, reach)) report.items.push(`${a.style} lamp`);
      if (stamp(lampB, gapRight - lampB[0].length, b.style, 'lamp', false, mid - lampB[0].length, reach)) report.items.push(`${b.style} lamp`);
    }
    if (gap >= 22) {
      const same = a.style === b.style, rows = same ? PIXEL_DISTRICT_PROPS[a.style].landmark : PIXEL_DISTRICT_PROPS.park;
      const left = mid - Math.floor(rows[0].length / 2);
      if (stamp(rows, left, same ? a.style : styleAt(mid - 1, a, b, mid), same ? 'landmark' : 'park', false, left + 1, 4) ||
          stamp(rows, left - 1, same ? a.style : styleAt(mid - 1, a, b, mid), same ? 'landmark' : 'park', false, left - 2, 4)) {
        report.items.push(same ? `${a.style} landmark` : 'park tree (style boundary)');
      }
    }
    // Street furniture between the lamps; a wide gap where styles meet becomes a pocket park on a lawn.
    if (gap >= 16) {
      const parkHere = a.style !== b.style && gap >= 40;
      if (parkHere) parks.push({ from: gapLeft + 2, to: gapRight - 2 });
      const placed = [];
      let index = 0;
      for (let x = gapLeft + 2; x < gapRight - 2 && placed.length < Math.floor(gap / 9); ) {
        const style = styleAt(x, a, b, mid), list = parkHere ? PIXEL_DISTRICT_PARK : PIXEL_DISTRICT_STREET[style];
        const item = list[index % list.length], w = item.rows[0].length;
        if (x + w > gapRight - 1) break;
        if (clearAround(item.rows, x) && stampAt(item.rows, x, style, parkHere ? 'park' : 'street')) {
          placed.push(item.name); index += 1; x += w + 2;
        } else x += 1;
      }
      if (placed.length) report.items.push(`${parkHere ? 'park' : 'street'}: ${placed.join('+')}`);
    }
    // Railings fill the remaining open ground, at least one pixel clear of other props.
    let railed = 0;
    for (let x = gapLeft + 1; x < gapRight; x += 1) {
      const y = groundAt(x) - 1;
      const near = [-1, 0, 1].some((dx) => [0, -1, -2, -3, -4].some((dy) => props.has(key(x + dx, y + dy))));
      if (near || !free(x, y)) continue;
      const style = styleAt(x, a, b, mid);
      for (const cell of pixelDistrictRailing(style, x, y)) if (free(cell.x, cell.y)) { props.set(key(cell.x, cell.y), { ...cell, style, kind: 'railing' }); railed += 1; }
    }
    if (railed) report.items.push('railings');
    infill.push(report);
  }
  // Drop any prop pixel that is not connected to the ground or to a building (so nothing spawns as debris).
  const anchored = new Set(), queue = [];
  for (const [k, cell] of props) {
    const touches = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => {
      const m = world.at(cell.x + dx, cell.y + dy);
      return m === PARTICLE_TERRAIN || m === PARTICLE_BARRIER;
    });
    if (touches) { anchored.add(k); queue.push(cell); }
  }
  while (queue.length) {
    const cell = queue.shift();
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const k = key(cell.x + dx, cell.y + dy);
      if (props.has(k) && !anchored.has(k)) { anchored.add(k); queue.push(props.get(k)); }
    }
  }
  for (const k of [...props.keys()]) if (!anchored.has(k)) props.delete(k);
  buildPixelCellsInstantly(world, [...props.values()]);

  // ---------- Road ----------
  const road = new Map();
  const zones = buildings.map((entry, i) => ({ style: entry.style,
    from: i === 0 ? 0 : Math.floor((buildings[i - 1].reach.right + entry.reach.left + 1) / 2),
    to: i === buildings.length - 1 ? world.width - 1 : Math.floor((entry.reach.right + buildings[i + 1].reach.left + 1) / 2) - 1 }));
  const runways = buildings.filter((entry) => entry.building.shape.runway).map((entry) => entry.building.shape.runway);
  for (let x = 3; x < world.width - 3; x += 1) {
    const ground = groundAt(x), zone = zones.find((z) => x >= z.from && x <= z.to) || zones[0];
    const runway = runways.find((r) => x >= r.from && x <= r.to), park = parks.find((p) => x >= p.from && x <= p.to);
    for (let row = 0; row < 3; row += 1) {
      const y = ground + row;
      if (world.at(x, y) !== PARTICLE_TERRAIN) continue;
      road.set(key(x, y), pixelDistrictRoadColor(runway ? 'runway' : park && row < 2 ? 'park' : zone.style, x, row, runway));
    }
  }

  // ---------- Units and integration report ----------
  const oneWay = new Set(buildings.flatMap((entry) => [...entry.building.shape.oneWay]));
  const passThrough = new Set([...buildings.flatMap((entry) => [...entry.building.shape.passThrough]),
    ...[...props.entries()].filter(([, cell]) => cell.kind !== 'bridge').map(([k]) => k)]);
  const unitWorld = createPixelOneWayUnitWorld(world, oneWay, passThrough);
  const runwayBlocked = buildings.filter((entry) => entry.building.shape.runway).map((entry) => {
    const r = entry.building.shape.runway;
    let blocked = 0;
    for (let x = r.from; x <= r.to; x += 1) for (let y = r.clearTop; y < r.y - 1; y += 1) if (world.at(x, y) !== PARTICLE_EMPTY) blocked += 1;
    return blocked;
  });
  const doorsBlocked = buildings.reduce((sum, entry) => sum + entry.building.shape.doors.filter((door) => !door.hangar).filter((door) => {
    const x = door.x + door.side * 4;
    for (let y = door.top; y <= door.bottom; y += 1) if (world.at(x, y) === PARTICLE_BARRIER && !passThrough.has(key(x, y))) return true;
    return false;
  }).length, 0);
  return { world, source, buildings, props, road, parks, unitWorld, infill, failures, surfaceY, base,
    report: { buildings: buildings.length, failures, gaps: infill.map((g) => g.gap), runwayBlocked, doorsBlocked,
      props: [...props.values()].filter((cell) => cell.kind !== 'bridge').length,
      street: [...props.values()].filter((cell) => cell.kind === 'street' || cell.kind === 'park').length,
      bridgePixels: [...props.values()].filter((cell) => cell.kind === 'bridge').length } };
}

// Low railing for one ground column `x` whose ground-level row is `y`.
function pixelDistrictRailing(style, x, y) {
  if (style === 'gothic') {
    const cells = [{ x, y, part: 'p' }, { x, y: y - 2, part: 'p' }];
    if (x % 2 === 0) cells.push({ x, y: y - 1, part: 'p' }, { x, y: y - 3, part: 'o' });
    return cells;
  }
  if (style === 'asian') {
    // Low garden wall with a dark tile cap.
    return [{ x, y, part: 's' }, { x, y: y - 1, part: x % 4 === 0 ? 'p' : 's' }, { x, y: y - 2, part: 'r' }];
  }
  // Modern: lit bollards every fourth column.
  return x % 4 === 0 ? [{ x, y, part: 'p' }, { x, y: y - 1, part: 'p' }, { x, y: y - 2, part: 'l' }] : [];
}

// Skybridge on the lowest floor row both buildings share, spanning wall to wall at that row.
function pixelDistrictBridge(world, a, b, gapLeft, gapRight, mid, free, key) {
  const floorsA = a.building.shape.floors.filter((floor) => floor.storey >= 1);
  const floorsB = new Set(b.building.shape.floors.filter((floor) => floor.storey >= 1).map((floor) => floor.y));
  for (const floor of floorsA.sort((p, q) => p.storey - q.storey)) {
    const y = floor.y;
    if (!floorsB.has(y)) continue;
    let left = gapLeft - 1, right = gapRight + 1;
    while (left > gapLeft - 14 && world.at(left, y) !== PARTICLE_BARRIER) left -= 1;
    while (right < gapRight + 14 && world.at(right, y) !== PARTICLE_BARRIER) right += 1;
    if (world.at(left, y) !== PARTICLE_BARRIER || world.at(right, y) !== PARTICLE_BARRIER) continue;
    const cells = [];
    const styleAt = (x) => (x < mid ? a.style : b.style);
    for (let x = left + 1; x < right; x += 1) cells.push({ x, y, part: 'p', style: styleAt(x) }, { x, y: y + 1, part: 'r', style: styleAt(x) });
    const span = right - left - 1;
    for (let i = 0; i < span; i += 1) {
      const x = left + 1 + i, style = styleAt(x), edge = Math.min(i, span - 1 - i);
      if (style === 'gothic') {
        // Pointed arch underneath and a pierced parapet with finials.
        for (let d = 2; d < 2 + Math.max(0, 4 - edge); d += 1) cells.push({ x, y: y + d, part: 's', style });
        cells.push({ x, y: y - 1, part: i % 2 ? 'p' : 's', style });
        if (i % 3 === 1) cells.push({ x, y: y - 2, part: 'o', style });
      } else if (style === 'asian') {
        // Covered bridge: lacquered posts, tiled roof and a gold ridge.
        if (i % 4 === 0 || i === span - 1) for (let d = 1; d <= 5; d += 1) cells.push({ x, y: y - d, part: 'p', style });
        cells.push({ x, y: y - 6, part: 'r', style });
        if (edge >= 2) cells.push({ x, y: y - 7, part: i === Math.floor(span / 2) ? 'o' : 'r', style });
      } else {
        // Glass tube with a steel roof.
        for (let d = 1; d <= 5; d += 1) cells.push({ x, y: y - d, part: edge === 0 ? 'p' : 'c', style });
        cells.push({ x, y: y - 6, part: 'p', style });
      }
    }
    if (!cells.every((cell) => free(cell.x, cell.y))) continue;
    return { storey: floor.storey, cells };
  }
  return null;
}

// Colour of road row `row` (0 = surface) in column x for a style zone or 'runway'.
function pixelDistrictRoadColor(style, x, row, runway) {
  if (style === 'runway') {
    const colors = PIXEL_DISTRICT_COLORS.runway;
    if (row === 2) return colors.base;
    const fromEnd = runway.direction > 0 ? runway.to - x : x - runway.from;
    if (row === 0 && fromEnd < 6 && fromEnd % 2 === 0) return colors.mark;
    if (row === 1 && x % 8 < 5) return colors.mark;
    return colors.paving;
  }
  const colors = PIXEL_DISTRICT_COLORS[style];
  if (row === 2) return colors.base;
  if (style === 'modern') return row === 1 && x % 8 < 4 ? colors.joint : colors.paving;
  if (style === 'gothic') return (x + row * 2) % 3 === 0 ? colors.joint : colors.paving;
  if (style === 'park') return (x * 5 + row) % 7 === 0 ? colors.joint : colors.paving;
  return (x + row * 3) % 6 === 0 ? colors.joint : colors.paving;
}
