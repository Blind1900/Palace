const PIXEL_BUILDING_STYLES = ['asian', 'gothic', 'modern'];
const PIXEL_BUILDING_TYPES = ['population', 'military', 'farm'];

const PIXEL_BUILDING_STYLE_PALETTES = {
  asian: { frame: [176, 58, 46], ornament: [226, 178, 64], label: 'Asian' },
  gothic: { frame: [120, 116, 132], ornament: [176, 150, 210], label: 'Gothic' },
  modern: { frame: [96, 140, 170], ornament: [196, 224, 236], label: 'Modern' },
};

// Rooftop crown variants per style for major roofs; see antennaVariant in stylePixelBuildingGeometry.
const PIXEL_ANTENNA_VARIANTS = Object.freeze({ modern: ['broadcast', 'needle', 'dish'], gothic: ['spire', 'belfry', 'triple'],
  asian: ['dragon', 'pillar', 'twin'] });

// Adds style ornaments to a prepared adaptive seed as extra frame cells. Every ornament is
// 4-connected to the existing frame so delivery crawlers can reach it, and none overlaps the
// cores, foundation, basement or silo storage space.
function stylePixelBuildingGeometry(world, prepared, style) {
  if (!world || !prepared || !prepared.ok || !prepared.geometry || !prepared.metadata) {
    throw new Error('Styled geometry requires a successfully prepared adaptive seed');
  }
  if (!PIXEL_BUILDING_STYLES.includes(style)) throw new Error('Invalid building architecture style');
  const { type } = prepared.metadata;
  if (!PIXEL_BUILDING_TYPES.includes(type)) throw new Error('Invalid styled building type');
  const key = (x, y) => y * world.width + x;
  const frame = new Map(prepared.geometry.frameCells.map((cell) => [key(cell.x, cell.y), cell]));
  const blocked = new Set([...prepared.geometry.seeds, ...prepared.foundationCells, ...prepared.basementCells]
    .map((cell) => key(cell.x, cell.y)));
  // Shaped buildings keep their interiors, stairwells and door approaches free of ornament.
  if (prepared.shape) for (const set of [prepared.shape.keepClear, prepared.shape.oneWay]) for (const index of set) blocked.add(index);
  prepared.geometry.poles.forEach((pole, index) => {
    for (let dx = 0; dx < 3; dx += 1) {
      for (let dy = 0; dy < 3; dy += 1) blocked.add(key(pole + dx, prepared.foundationRows[index] + dy));
    }
  });
  for (const silo of (prepared.metadata.silos || [])) {
    for (const cell of silo.storageCells || []) blocked.add(key(cell.x, cell.y));
  }
  const ornaments = new Map(), structure = new Map(), accents = new Set();
  const has = (x, y) => frame.has(key(x, y)) || structure.has(key(x, y)) || ornaments.has(key(x, y));
  const put = (x, y) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || has(x, y)) return;
    ornaments.set(key(x, y), { x, y });
  };
  const putStructure = (x, y) => { if (!has(x, y)) structure.set(key(x, y), { x, y }); };
  const cells = [...frame.values()];
  const minX = Math.min(...cells.map((cell) => cell.x)), maxX = Math.max(...cells.map((cell) => cell.x));
  const topAt = (x) => Math.min(...cells.filter((cell) => cell.x === x).map((cell) => cell.y));
  const roof = Math.min(...cells.map((cell) => cell.y));
  const center = Math.floor((minX + maxX) / 2);
  const rowSpan = (y) => {
    const xs = cells.filter((cell) => cell.y === y).map((cell) => cell.x);
    return xs.length ? { left: Math.min(...xs), right: Math.max(...xs) } : null;
  };
  const eave = (y, reach, upturn) => {
    const span = rowSpan(y);
    if (!span) return;
    for (let step = 1; step <= reach; step += 1) { put(span.left - step, y); put(span.right + step, y); }
    if (upturn) { put(span.left - reach, y - 1); put(span.right + reach, y - 1); }
  };
  const mast = (x, fromY, length) => { for (let i = 1; i <= length; i += 1) put(x, fromY - i); };
  // Broadcast antenna rising from row `baseY`: wide plinth, thick lower shaft with dish arms,
  // lattice equipment cage, narrower mid shaft, small upper cage and a thin whip with a red beacon.
  const antenna = (cx, baseY, length) => {
    let y = baseY;
    const rows = (count, draw) => { for (let i = 0; i < count; i += 1) { y -= 1; draw(y, i); } };
    const span = (row, half) => { for (let dx = -half; dx <= half; dx += 1) put(cx + dx, row); };
    const plinth = 2, lower = Math.round(length * 0.28), cage = Math.round(length * 0.18);
    const middle = Math.round(length * 0.16), upperCage = Math.round(length * 0.1);
    const whip = Math.max(3, length - plinth - lower - cage - middle - upperCage);
    rows(plinth, (row, i) => span(row, i === 0 ? 3 : 2));
    rows(lower, (row, i) => {
      span(row, 1);
      if (i === Math.floor(lower * 0.6)) { put(cx - 2, row); put(cx - 3, row); put(cx + 2, row); put(cx + 3, row); }
      if (i === Math.floor(lower * 0.6) + 1) { put(cx - 3, row); put(cx + 3, row); }
    });
    rows(cage, (row, i) => {
      put(cx, row); put(cx - 2, row); put(cx + 2, row);
      if (i % 3 === 0 || i === cage - 1) span(row, 2);
    });
    rows(middle, (row) => span(row, 1));
    rows(upperCage, (row, i) => {
      put(cx, row); put(cx - 1, row); put(cx + 1, row);
      if (i % 2 === 1) { put(cx - 2, row); put(cx + 2, row); }
    });
    rows(whip, (row, i) => { put(cx, row); if (i >= whip - 2) accents.add(key(cx, row)); });
  };

  const hspan = (cx, row, half, structural = false) => {
    for (let dx = -half; dx <= half; dx += 1) (structural ? putStructure : put)(cx + dx, row);
  };
  // Asian sorin: base box, bowl, a stack of rings on a mast, water-flame and a jewel at the tip.
  const sorin = (cx, baseY, length) => {
    let y = baseY;
    const row = () => { y -= 1; return y; };
    hspan(cx, row(), 2); hspan(cx, row(), 2); hspan(cx, row(), 1);
    const rings = Math.max(3, Math.min(9, Math.round((length - 10) / 2)));
    for (let i = 0; i < rings; i += 1) { hspan(cx, row(), 2); put(cx, row()); }
    hspan(cx, row(), 2); const flame = row(); put(cx - 2, flame); put(cx, flame); put(cx + 2, flame);
    hspan(cx, row(), 1); hspan(cx, row(), 1); put(cx, row());
  };
  // Asian dragon finial: a two-pixel body rising in an S coil from a lotus plinth, with dorsal spines,
  // claws, a horned head and a red pearl held before its jaws.
  const dragon = (cx, baseY, length, mirror = 1) => {
    let y = baseY;
    hspan(cx, --y, 2); hspan(cx, --y, 1);
    const body = Math.max(10, length - 6), amp = Math.max(2, Math.min(4, Math.round(length / 9)));
    const periods = length >= 30 ? 1.5 : 1;
    const at = (t) => cx + mirror * Math.round(amp * Math.min(1, t * 4) * Math.sin(t * Math.PI * 2 * periods));
    let previous = cx;
    for (let r = 0; r < body; r += 1) {
      const t = r / body, x = at(t), thick = t < 0.15 ? 1 : 2;
      y -= 1;
      for (let px = Math.min(previous, x); px <= Math.max(previous, x) + thick - 1; px += 1) put(px, y);
      // Spines on the outside of each bend, claws reaching out at two points along the body.
      if (r % 3 === 1 && t > 0.15) put(x >= cx ? x + thick : x - 1, y);
      if (Math.abs(t - 0.4) < 0.02 || Math.abs(t - 0.75) < 0.02) {
        const out = x >= cx ? 1 : -1, edge = out > 0 ? x + thick : x - 1;
        put(edge, y); put(edge + out, y); put(edge + out, y + 1);
      }
      previous = x;
    }
    const facing = at(1) - at(1 - 1 / body) >= 0 ? 1 : -1, hx = previous + (facing > 0 ? 1 : 0);
    const head = (dx, dy, accent = false) => {
      const px = hx + facing * dx, py = y - dy;
      put(px, py); if (accent) accents.add(key(px, py));
    };
    for (let dx = -1; dx <= 4; dx += 1) head(dx, 1);
    for (const dx of [0, 1, 2, 4]) head(dx, 2);
    for (let dx = -1; dx <= 5; dx += 1) head(dx, 3);
    for (let dx = -2; dx <= 1; dx += 1) head(dx, 4);
    head(-2, 5); head(-3, 5); head(-3, 6);
    head(5, 4); head(6, 4);
    for (const [dx, dy] of [[5, 1], [6, 1], [5, 2], [6, 2]]) head(dx, dy, true);
  };
  // Gothic angel statue: raised wings, head, robed body and a small pedestal.
  const ANGEL = ['#.........#', '##...#...##', '###.###.###', '.###.#.###.', '..#######..', '....###....',
    '...#####...', '...#####...', '..#######..', '..#######..', '....###....'];
  const angel = (cx, baseY) => {
    ANGEL.forEach((row, index) => [...row].forEach((char, column) => {
      if (char === '#') put(cx + column - 5, baseY - ANGEL.length + index);
    }));
  };
  // Gothic spire: stone body tapering from a broad base with crockets, crowned by an angel statue.
  const spire = (cx, baseY, length) => {
    let y = baseY;
    hspan(cx, --y, 3, true); hspan(cx, --y, 3, true);
    const body = Math.max(6, length - 12);
    for (let r = 0; r < body; r += 1) {
      const half = Math.round(2 * (1 - r / body));
      hspan(cx, --y, half, true);
      if (r % 3 === 1 && r < body - 2) { put(cx - half - 1, y); put(cx + half + 1, y); }
    }
    hspan(cx, --y, 1);
    angel(cx, y);
  };
  // Gothic belfry: square stone tower, an open arched bell chamber with a hanging bell, a pyramid cap
  // and an angel on the peak.
  const belfry = (cx, baseY, length) => {
    let y = baseY;
    hspan(cx, --y, 4, true); hspan(cx, --y, 3, true);
    const shaft = Math.max(3, Math.round(length * 0.25));
    for (let r = 0; r < shaft; r += 1) { hspan(cx, --y, 3, true); if (r % 3 === 1) { put(cx - 4, y); put(cx + 4, y); } }
    const open = 7;
    for (let r = 0; r < open; r += 1) {
      y -= 1; putStructure(cx - 3, y); putStructure(cx + 3, y);
      if (r >= open - 2) { put(cx - 2, y); put(cx + 2, y); }
      if (r >= open - 4 && r < open - 1) hspan(cx, y, r === open - 4 ? 1 : 1);
      if (r === open - 1) put(cx, y);
    }
    hspan(cx, --y, 4, true);
    for (let half = 3; half >= 1; half -= 1) hspan(cx, --y, half);
    put(cx, --y);
    angel(cx, y);
  };
  // Gothic triple spires: a tall central angel spire on a gallery between two slender side needles.
  const tripleSpire = (cx, baseY, length) => {
    hspan(cx, baseY - 1, 6, true);
    for (const side of [-5, 5]) {
      const height = Math.max(6, Math.round(length * 0.5));
      for (let r = 2; r <= height; r += 1) {
        if (r < height * 0.45) hspan(cx + side, baseY - r, 1, true); else put(cx + side, baseY - r);
        if (r % 3 === 0 && r < height * 0.45) { put(cx + side - 2, baseY - r); put(cx + side + 2, baseY - r); }
      }
      accents.add(key(cx + side, baseY - height));
    }
    spire(cx, baseY - 1, length);
  };
  // Asian dragon pillar: a lacquered staff with a dragon coiling up around it and a pearl on top.
  const dragonPillar = (cx, baseY, length) => {
    hspan(cx, baseY - 1, 3); hspan(cx, baseY - 2, 2);
    for (let i = 3; i <= length + 2; i += 1) put(cx, baseY - i);
    hspan(cx, baseY - length - 3, 1); put(cx, baseY - length - 4);
    for (const dy of [3, 4]) accents.add(key(cx, baseY - length - dy));
    dragon(cx, baseY - 2, Math.max(12, length - 4), -1);
  };
  // Asian sorin flanked by two small dragons rising from a shared lotus gallery, coiling outward.
  const twinDragons = (cx, baseY, length) => {
    hspan(cx, baseY - 1, 9);
    sorin(cx, baseY - 1, Math.round(length * 0.7));
    const small = Math.max(12, Math.round(length * 0.6));
    dragon(cx - 8, baseY - 1, small, -1);
    dragon(cx + 8, baseY - 1, small, 1);
  };
  // Modern stepped needle: art-deco setbacks narrowing to a mooring mast with a red beacon.
  const needle = (cx, baseY, length) => {
    let y = baseY;
    const tier = Math.max(2, Math.round(length * 0.13));
    for (const half of [3, 2, 1]) {
      for (let r = 0; r < tier; r += 1) { hspan(cx, --y, half); if (r === 0 && half > 1) { put(cx - half - 1, y); put(cx + half + 1, y); } }
    }
    const rest = Math.max(4, length - 3 * tier);
    for (let r = 0; r < rest; r += 1) { put(cx, --y); if (r >= rest - 2) accents.add(key(cx, y)); }
  };
  // Modern communications deck: a platform with a satellite dish on a stub and two whip masts.
  const dishMasts = (cx, baseY, length) => {
    let y = baseY;
    hspan(cx, --y, 6); hspan(cx, --y, 6);
    for (let r = 0; r < 3; r += 1) put(cx, --y);
    hspan(cx, --y, 2); hspan(cx, --y, 4); y -= 1; put(cx - 4, y); put(cx + 4, y); put(cx, y + 1); put(cx, y);
    put(cx - 4, y - 1); put(cx + 4, y - 1); put(cx, y - 1); put(cx, y - 2);
    accents.add(key(cx, y - 2));
    whipMast(cx - 6, baseY - 2, Math.round(length * 0.85));
    whipMast(cx + 6, baseY - 2, Math.round(length * 0.55));
  };
  // Which crown a major roof gets: ?metadata.antennaVariant forces one, otherwise a stable hash of the
  // building (type, level, shape and roof position) spreads the variants across a city.
  const antennaVariant = (apex) => {
    const names = PIXEL_ANTENNA_VARIANTS[style], forced = prepared.metadata.antennaVariant;
    if (Number.isInteger(forced)) return names[((forced % names.length) + names.length) % names.length];
    if (typeof forced === 'string' && names.includes(forced)) return forced;
    const text = `${type}|${prepared.metadata.level}|${prepared.metadata.variant}|${apex.x}|${apex.y}`;
    let hash = 2166136261;
    for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return names[hash % names.length];
  };
  const crowns = [];
  // Small Gothic pinnacle: flared base and a plain needle (no crossbar).
  const pinnacle = (cx, baseY) => {
    hspan(cx, baseY - 1, 1, true); hspan(cx, baseY - 2, 1, true);
    for (let i = 3; i <= 6; i += 1) putStructure(cx, baseY - i);
    put(cx, baseY - 7);
  };
  const miniSorin = (cx, baseY) => {
    hspan(cx, baseY - 1, 1);
    for (let i = 0; i < 3; i += 1) { hspan(cx, baseY - 2 - 2 * i, 1); put(cx, baseY - 3 - 2 * i); }
    put(cx, baseY - 8); put(cx - 1, baseY - 8); put(cx + 1, baseY - 8); put(cx, baseY - 9);
  };
  const whipMast = (cx, baseY, length) => {
    mast(cx, baseY, length);
    accents.add(key(cx, baseY - length)); accents.add(key(cx, baseY - length + 1));
  };
  const minorFinial = (apex) => {
    if (apex.windmill) return;
    if (style === 'asian') miniSorin(apex.x, apex.y);
    else if (style === 'gothic') pinnacle(apex.x, apex.y);
    else whipMast(apex.x, apex.y, apex.dome ? 6 : 8);
  };
  const shapeOrnaments = () => {
    const shape = prepared.shape;
    const bodyHeight = prepared.surfaceY - shape.bodyTop;
    const exterior = (x, y) => !has(x, y);
    for (const roof of shape.roofs) {
      if (roof.pitched) continue;
      for (const [side, end] of [[-1, roof.left], [1, roof.right]]) {
        if (!exterior(end + side, roof.y)) continue;
        if (style === 'asian') {
          const reach = roof.top ? 3 : 2;
          for (let i = 1; i <= reach; i += 1) put(end + side * i, roof.y);
          put(end + side * reach, roof.y - 1);
        } else if (style === 'gothic' && !roof.curved) {
          pinnacle(end - side, roof.y);
        } else if (style === 'modern' && !roof.curved) {
          put(end, roof.y - 1); put(end, roof.y - 2);
        }
      }
    }
    if (style === 'asian') {
      // Pagoda tiers: a flared eave on every other storey line between the roofs.
      for (const floor of shape.floors) {
        if (floor.storey === 0 || floor.storey % 2 === 1) continue;
        for (const [side, end] of [[-1, floor.outerLeft], [1, floor.outerRight]]) {
          if (!exterior(end + side, floor.y)) continue;
          put(end + side, floor.y); put(end + 2 * side, floor.y); put(end + 2 * side, floor.y - 1);
        }
      }
    }
    for (const wall of shape.battlements) {
      const width = wall.right - wall.left;
      for (let x = wall.left; x <= wall.right; x += 1) {
        const t = x - wall.left;
        if (style === 'gothic') { put(x, wall.y - 1); if (t % 4 < 2) put(x, wall.y - 2); }
        else if (style === 'asian') { put(x, wall.y - 1); if (t === 0 || t === width) put(x, wall.y - 2); }
        else { if (t % 4 === 0 || t === width) put(x, wall.y - 1); put(x, wall.y - 2); }
      }
    }
    if (style === 'gothic' && shape.type === 'population') {
      // Stepped flying buttresses on walls without a door.
      const ground = shape.floors.find((floor) => floor.storey === 0);
      const doorSides = new Set(shape.doors.map((door) => door.side));
      for (const [side, edge] of [[-1, ground.outerLeft], [1, ground.outerRight]]) {
        if (doorSides.has(side)) continue;
        for (let step = 1; step <= 3; step += 1) {
          for (let y = shape.base - 3 * (4 - step); y <= shape.base; y += 1) put(edge + side * step, y);
        }
      }
    }
    for (const apex of shape.apexes) {
      if (apex.size !== 'major' || apex.barn || apex.house) { minorFinial(apex); continue; }
      const length = Math.min(48, Math.max(style === 'modern' ? 24 : 16, Math.round(bodyHeight * (style === 'modern' ? 0.32 : 0.28))));
      const variant = antennaVariant(apex);
      const before = new Set([...ornaments.keys(), ...structure.keys()]);
      if (variant === 'dragon') dragon(apex.x, apex.y, length);
      else if (variant === 'pillar') dragonPillar(apex.x, apex.y, length);
      else if (variant === 'twin') twinDragons(apex.x, apex.y, length);
      else if (variant === 'spire') spire(apex.x, apex.y, length);
      else if (variant === 'belfry') belfry(apex.x, apex.y, length);
      else if (variant === 'triple') tripleSpire(apex.x, apex.y, length);
      else if (variant === 'needle') needle(apex.x, apex.y, length);
      else if (variant === 'dish') dishMasts(apex.x, apex.y, length);
      else if (shape.type === 'population' && (apex.width || 0) >= 11) {
        // Rooftop plant room carrying the broadcast antenna.
        for (let x = apex.x - 3; x <= apex.x + 3; x += 1) { put(x, apex.y - 1); put(x, apex.y - 4); }
        for (const x of [apex.x - 3, apex.x + 3]) { put(x, apex.y - 2); put(x, apex.y - 3); }
        antenna(apex.x, apex.y - 4, length);
      } else antenna(apex.x, apex.y, length);
      crowns.push({ x: apex.x, y: apex.y, variant,
        cells: [...ornaments.keys(), ...structure.keys()].filter((index) => !before.has(index)) });
    }
  };

  if (prepared.shape) {
    shapeOrnaments();
  } else if (type === 'population') {
    // Load-bearing pillars are three pixels wide (the full core width); floors stay one pixel.
    for (const pole of prepared.geometry.poles) {
      for (const x of [pole, pole + 2]) {
        const seed = prepared.geometry.seeds.find((cell) => cell.x === x);
        for (let y = topAt(x); y < seed.y; y += 1) putStructure(x, y);
      }
    }
    const floorRows = [...new Set(cells.map((cell) => cell.y))]
      .filter((y) => { const span = rowSpan(y); return span && span.left === minX && span.right === maxX; })
      .sort((a, b) => a - b);
    if (style === 'asian') {
      // Pagoda tiers: flared eaves on every other storey, widest near the ground.
      floorRows.forEach((y, index) => {
        if (index % 2 === 0) eave(y, index === floorRows.length - 1 ? 1 : 2, true);
      });
      mast(center, topAt(center), 4);
    } else if (style === 'gothic') {
      // Central spire crowned by an angel, pinnacles on every pole and stepped flying buttresses at both sides.
      mast(center, topAt(center), 4);
      angel(center, topAt(center) - 4);
      for (const pole of prepared.geometry.poles) {
        const x = pole + 1;
        if (Math.abs(x - center) > 2) mast(x, topAt(x), 4);
      }
      const ground = prepared.surfaceY - 1;
      for (const [side, edge] of [[-1, minX], [1, maxX]]) {
        for (let step = 1; step <= 3; step += 1) {
          for (let y = ground - 3 * (4 - step); y <= ground; y += 1) put(edge + side * step, y);
        }
      }
    } else {
      // Parapet walls, rooftop plant room, two slim whip antennas and a broadcast mast.
      for (const x of [minX, maxX]) mast(x, topAt(x), 2);
      for (let x = center - 3; x <= center + 3; x += 1) { put(x, roof - 1); put(x, roof - 4); }
      for (const x of [center - 3, center + 3]) { put(x, roof - 2); put(x, roof - 3); }
      mast(minX + 2, roof, 6); mast(maxX - 2, roof, 4);
      antenna(center, roof - 4, Math.max(24, Math.round((prepared.surfaceY - roof) * 0.32)));
    }
  } else if (type === 'military') {
    if (style === 'asian') {
      eave(roof, 3, true);
      for (let x = minX + 1; x <= maxX - 1; x += 1) if (has(x, roof)) put(x, roof - 1);
      mast(center, roof - 1, 2);
    } else if (style === 'gothic') {
      for (let x = minX; x <= maxX; x += 2) if (has(x, roof)) put(x, roof - 1);
      for (const pole of prepared.geometry.poles) {
        mast(pole, roof, 3); mast(pole + 2, roof, 3); mast(pole + 1, roof, 5);
      }
    } else {
      for (const x of [minX, maxX]) mast(x, roof, 2);
      const x = prepared.geometry.poles[Math.floor((prepared.geometry.poles.length - 1) / 2)] + 1;
      antenna(x, roof, 18);
    }
  } else {
    for (const silo of prepared.metadata.silos) {
      const middle = (silo.left + silo.right) / 2;
      if (style === 'asian') {
        put(silo.left - 1, silo.roof + 2); put(silo.right + 1, silo.roof + 2);
        put(silo.left - 1, silo.roof + 1); put(silo.right + 1, silo.roof + 1);
        mast(middle, silo.roof, 2);
      } else if (style === 'gothic') {
        mast(middle, silo.roof, 5);
        put(middle - 1, silo.roof - 1); put(middle + 1, silo.roof - 1);
      } else {
        for (let x = silo.left; x <= silo.right; x += 1) {
          for (let y = silo.roof; y < silo.roof + 2; y += 1) put(x, y);
        }
        put(silo.left, silo.roof - 1); put(silo.right, silo.roof - 1);
      }
    }
  }

  // Keep only ornaments that are buildable: empty, on the map, clear of foundations and
  // connected to the original frame through other ornaments.
  const candidates = new Map([...structure, ...ornaments]);
  const valid = new Map([...candidates].filter(([index, cell]) => !blocked.has(index) &&
    cell.x >= 3 && cell.x + 3 < world.width && cell.y >= 1 && cell.y < world.height &&
    world.at(cell.x, cell.y) === PARTICLE_EMPTY));
  const connected = new Map(), queue = [];
  for (const [index, cell] of valid) {
    if ([[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => frame.has(key(cell.x + dx, cell.y + dy)))) {
      connected.set(index, cell); queue.push(cell);
    }
  }
  while (queue.length) {
    const cell = queue.shift();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const index = key(cell.x + dx, cell.y + dy), next = valid.get(index);
      if (next && !connected.has(index)) { connected.set(index, next); queue.push(next); }
    }
  }
  const added = [...connected.values()].map((cell) => ({ ...cell }));
  // Crown report: how many of each rooftop crown's pixels survived pruning (clipped crowns read as broken).
  const crownReport = crowns.map(({ cells, ...crown }) => ({ ...crown, pixels: cells.length,
    kept: cells.filter((index) => connected.has(index)).length }));
  const xs = added.map((cell) => cell.x);
  const structureCells = added.filter((cell) => structure.has(key(cell.x, cell.y)));
  const ornamentCells = added.filter((cell) => !structure.has(key(cell.x, cell.y)));
  return {
    ...prepared,
    geometry: { ...prepared.geometry,
      frameCells: [...prepared.geometry.frameCells.map((cell) => ({ ...cell })), ...added],
      bounds: { left: Math.min(prepared.geometry.bounds.left, ...xs),
        right: Math.max(prepared.geometry.bounds.right, ...xs) } },
    ornamentCells, structureCells,
    accentCells: ornamentCells.filter((cell) => accents.has(key(cell.x, cell.y))),
    metadata: { ...prepared.metadata, style, ornamentCount: ornamentCells.length, crowns: crownReport,
      pillarWidth: prepared.shape ? PIXEL_INTERIOR.wall : structureCells.length ? 3 : 1 },
  };
}

// Builds a flat standalone source suitable for one adaptive building, raised for skyscrapers
// when the trooper artwork is loaded.
function createPixelStyleLabSource(width = 80, extraSky = 56) {
  const base = { width, height: 114, cellSize: 4, heights: Array(width).fill(84 * 4),
    waterLevels: Array(width).fill(null), tunnels: [] };
  const raised = typeof preparePixelSkyscraperSource === 'function' && typeof PIXEL_UNIT_REFERENCE !== 'undefined'
    ? preparePixelSkyscraperSource(base, PIXEL_UNIT_REFERENCE) : base;
  // Rooftop antennas rise above the tallest level-7 tower, beyond the generator's own sky padding.
  return { ...raised, height: raised.height + extraSky,
    heights: raised.heights.map((value) => value + extraSky * 4) };
}

// Military grows with the hangar (pixelHangarClearance): both hangar sides plus the longer runway.
const PIXEL_STYLE_LAB_WIDTHS = Object.freeze({ population: 110, farm: 180,
  military: (() => {
    const fleet = typeof pixelHangarClearance === 'function' ? pixelHangarClearance() : { width: 0 };
    const growth = Math.max(0, fleet.width + 8 - 17);
    return 230 + growth * 2 + Math.max(0, fleet.width * 3 - 56) + growth;
  })() });

// Window frames per style, drawn on the back wall of every room ('#' frame, 'g' glass). Gothic windows
// are pointed lancets, Asian windows are lattice screens and modern windows are transomed panes.
const PIXEL_WINDOW_ART = Object.freeze({
  gothic: ['..#..', '.#g#.', '#ggg#', '#ggg#', '#ggg#', '#ggg#', '#ggg#', '#####'],
  asian: ['#####', '#ggg#', '#g#g#', '#ggg#', '#####'],
  modern: ['####', '#gg#', '#gg#', '####', '#gg#', '####'],
});
const PIXEL_WINDOW_GAP = 4;

// Evenly spaced window frames as decor only (no physics). Back-wall windows use one column grid anchored
// on the building centre, so every storey's windows line up; side windows replace the outer wall over
// their full thickness at the same height on every storey. Door, stair and pass-through pixels are never glazed.
function pixelBuildingWindows(styled, style, worldWidth) {
  if (!styled || !styled.shape || !PIXEL_WINDOW_ART[style] || !Number.isInteger(worldWidth)) {
    throw new Error('Windows require a shaped building, a style and the world width');
  }
  const { shape } = styled, art = PIXEL_WINDOW_ART[style];
  const width = art[0].length, height = art.length, pitch = width + PIXEL_WINDOW_GAP;
  const frame = new Set(styled.geometry.frameCells.map((cell) => cell.y * worldWidth + cell.x));
  const solid = (x, y) => {
    const index = y * worldWidth + x;
    return frame.has(index) && !shape.passThrough.has(index) && !shape.oneWay.has(index);
  };
  const bounds = styled.geometry.bounds, centre = Math.round((bounds.left + bounds.right) / 2);
  const back = [], side = [], ports = [];
  const floors = shape.floors.filter((floor) => !floor.solid);
  // Windows sit centred in each storey's clear height, so every storey repeats at the same offsets.
  const clear = (shape.floorPitch || PIXEL_INTERIOR.floorPitch) - 1;
  const bottomOffset = 1 + Math.max(1, Math.floor((clear - height) / 2)), sideRows = Math.min(4, clear - 6);
  for (const floor of floors) {
    const bottom = floor.y - bottomOffset, top = bottom - height + 1;
    for (let k = -40; k <= 40; k += 1) {
      const left = centre - Math.floor(width / 2) + k * pitch, right = left + width - 1;
      if (left < floor.left + 1 || right > floor.right - 1) continue;
      let covered = false;
      for (let dy = 0; dy < height && !covered; dy += 1) for (let dx = 0; dx < width; dx += 1) {
        const index = (top + dy) * worldWidth + left + dx;
        if (frame.has(index) && !shape.oneWay.has(index)) { covered = true; break; }
      }
      if (covered) continue;
      art.forEach((row, dy) => [...row].forEach((char, dx) => {
        if (char !== '.') back.push({ x: left + dx, y: top + dy, part: char === 'g' ? 'glass' : 'frame', storey: floor.storey });
      }));
    }
    // Side windows replace the wall: lintel and sill span the wall, and glass fills every wall column
    // between them, so no wall pixel shows beside the pane. Panes stay load-bearing structure (like door
    // panes) but are transparent to gunfire, which makes them firing ports for a garrison.
    for (const [outer, inward] of [[floor.outerLeft, 1], [floor.outerRight, -1]]) {
      const lintel = floor.y - bottomOffset - sideRows - 1, sill = floor.y - bottomOffset;
      const columns = [];
      for (let d = 0; d < 3 && solid(outer + inward * d, lintel + 1); d += 1) columns.push(outer + inward * d);
      if (!columns.length) continue;
      let ok = true;
      for (let y = lintel; y <= sill && ok; y += 1) for (const x of columns) if (!solid(x, y)) ok = false;
      if (!ok) continue;
      for (const x of columns) { side.push({ x, y: lintel, part: 'frame', storey: floor.storey }); side.push({ x, y: sill, part: 'frame', storey: floor.storey }); }
      for (let y = lintel + 1; y < sill; y += 1) for (const x of columns) side.push({ x, y, part: y === lintel + 1 ? 'shine' : 'glass', storey: floor.storey });
      ports.push({ storey: floor.storey, floorY: floor.y, outward: -inward, outerX: outer, innerX: columns[columns.length - 1],
        top: lintel + 1, bottom: sill - 1 });
    }
  }
  return { back, side, ports, pitch, width, height };
}

function pixelWindowColor(part, layer, style) {
  const palette = PIXEL_BUILDING_STYLE_PALETTES[style];
  if (part === 'shine') return [178, 216, 230];
  if (part === 'glass') return layer === 'side' ? [92, 136, 158] : [54, 82, 100];
  return layer === 'side' ? palette.ornament : palette.frame.map((value) => Math.round(value * 0.55));
}

// Colour-only surface detail for the outer walls, so they are not one flat tone. Gothic walls are ashlar
// courses with staggered joints and a string course at every floor, Asian walls are lacquered pillars
// with gilded bracket bands, and modern walls are glinting steel mullions with panel seams and dark
// spandrels. A deterministic grain varies a few pixels. Returns Map(cell key -> [r, g, b]).
function pixelWallDetail(styled, style, worldWidth) {
  const palette = PIXEL_BUILDING_STYLE_PALETTES[style];
  if (!styled || !styled.shape || !palette || !Number.isInteger(worldWidth)) {
    throw new Error('Wall detail requires a shaped building, a style and the world width');
  }
  const { shape } = styled, frame = new Set(styled.geometry.frameCells.map((cell) => cell.y * worldWidth + cell.x));
  const pitch = shape.floorPitch || PIXEL_INTERIOR.floorPitch, wall = PIXEL_INTERIOR.wall;
  const tone = (color, amount) => color.map((value) => Math.max(0, Math.min(255, Math.round(value * amount))));
  const mixed = (a, b, t) => a.map((value, index) => Math.round(value * (1 - t) + b[index] * t));
  const grain = (x, y) => { const h = Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0; return (h >>> 13) % 16; };
  const detail = new Map();
  for (const floor of shape.floors) {
    for (const [outer, inward] of [[floor.outerLeft, 1], [floor.outerRight, -1]]) {
      for (let d = 0; d < wall; d += 1) {
        const x = outer + inward * d;
        for (let rise = 0; rise < pitch; rise += 1) {
          const y = floor.y - rise, key = y * worldWidth + x;
          if (!frame.has(key) || shape.oneWay.has(key) || shape.passThrough.has(key) || detail.has(key)) continue;
          let color = palette.frame;
          if (style === 'gothic') {
            const course = Math.floor(rise / 3), joint = rise % 3 === 0;
            color = tone(color, d === 0 ? 1.12 : d === wall - 1 ? 0.86 : 1);
            if (joint || d === (course % 2 ? 0 : wall - 1) && rise % 3 === 2) color = tone(color, 0.78);
            if (rise === 0) color = mixed(palette.frame, palette.ornament, 0.45);
          } else if (style === 'asian') {
            color = tone(color, d === 1 ? 1.16 : d === 0 ? 0.82 : 0.92);
            if (rise === 1 || rise === pitch - 1) color = palette.ornament;
            else if (rise === 2) color = tone(palette.ornament, 0.7);
            else if (rise === Math.floor(pitch / 2)) color = tone(palette.frame, 0.66);
          } else {
            color = tone(color, d === 0 ? 1.3 : d === wall - 1 ? 0.78 : 1);
            if (rise === 0) color = tone(palette.frame, 0.6);
            else if (rise % 4 === 0) color = tone(color, 0.82);
          }
          const g = grain(x, y);
          if (g === 0) color = tone(color, 0.9); else if (g === 1) color = tone(color, 1.08);
          detail.set(key, color);
        }
      }
    }
  }
  return detail;
}

// options: variant (shaped interiors, devices and descriptor styling), owner, width, unstyled,
// devices (default true for variants), antenna (crown variant index or name), previewFinished (build every frame pixel at once),
// world + source + x (place into a shared world at centre column x, used by districts).
function createPixelStyledBuilding(type, style, level = 3, options = {}) {
  const shaped = Boolean(options.variant);
  const source = options.source || createPixelStyleLabSource(options.width || (shaped ? PIXEL_STYLE_LAB_WIDTHS[type] : undefined));
  const world = options.world || createParticleWorldFromSurfaceWaterAndTunnels(
    { heightAt: (x) => source.heights[Math.floor(x / 4)] }, () => null, [],
    { width: source.width, height: source.height, cellSize: 4, originX: 0, originY: 0,
      supportCapacity: options.supportCapacity || 1024, skipEmptyChunks: true });
  const prepared = prepareAdaptivePixelSeed(world, source, 0, 0, [], Number.isInteger(options.x) ? options.x : Math.floor(source.width / 2),
    { type, level, style, owner: options.owner || 'left' });
  if (!prepared.ok) throw new Error(`${style} ${type} level ${level}: ${prepared.reason}`);
  let planned = prepared;
  if (shaped) {
    const shapeInput = options.throughDoors ? { ...prepared, metadata: { ...prepared.metadata, throughDoors: true } } : prepared;
    planned = shapePixelBuilding(world, shapeInput, options.variant);
    if (options.devices !== false) planned = placePixelDevices(world, planned, style);
  }
  if (options.antenna !== undefined) planned = { ...planned, metadata: { ...planned.metadata, antennaVariant: options.antenna } };
  const styled = options.unstyled ? { ...planned, ornamentCells: [], structureCells: [], accentCells: [] }
    : stylePixelBuildingGeometry(world, planned, style);
  const baseline = world.snapshot();
  for (const cell of styled.basementCells) {
    if (world.at(cell.x, cell.y) === PARTICLE_TERRAIN) world.excavate(cell.x, cell.y, cell.x, cell.y);
  }
  const scenario = createPixelConstructionScenario(5, { world, geometry: styled.geometry,
    foundationRows: styled.foundationRows, deliveryMode: 'inside', buriedCore: true,
    foundationCells: styled.foundationCells, initialHM: styled.geometry.frameCells.length + 1000 });
  if (options.previewFinished) {
    // Keep the laid foundation and place the whole frame; physics still runs on the next world step.
    buildPixelCellsInstantly(world, styled.geometry.frameCells);
  } else {
    // The scenario lays the finished foundation; restoring the untouched terrain lets the seed regrow it.
    world.restore(baseline);
    scenario.startFoundationGrowth(styled.basementCells);
  }
  const top = Math.min(...styled.geometry.frameCells.map((cell) => cell.y));
  const bodyTop = styled.shape ? styled.shape.bodyTop : Math.min(...prepared.geometry.frameCells.map((cell) => cell.y));
  return { type, style, level, variant: options.variant || null, source, world, prepared, styled, scenario,
    shape: styled.shape || null, devices: styled.devices || [], preview: Boolean(options.previewFinished),
    windows: styled.shape && !options.unstyled ? pixelBuildingWindows(styled, style, world.width) : null,
    wallDetail: styled.shape && !options.unstyled ? pixelWallDetail(styled, style, world.width) : null,
    unitWorld: styled.shape ? createPixelOneWayUnitWorld(world, styled.shape.oneWay, styled.shape.passThrough) : null,
    stats: { framePixels: styled.geometry.frameCells.length, ornamentPixels: styled.ornamentCells.length,
      devicePixels: (styled.deviceCells || []).length,
      hmCost: styled.geometry.frameCells.length, height: styled.surfaceY - top,
      bodyHeight: styled.surfaceY - bodyTop,
      width: styled.geometry.bounds.right - styled.geometry.bounds.left + 1,
      storeys: styled.shape ? styled.shape.floors.filter((floor) => floor.accessible).length : null,
      soldiersPerFloor: styled.shape ? styled.shape.soldiersPerFloor : null,
      trooperHeight: source.populationScale ? source.populationScale.trooperHeight : null } };
}
