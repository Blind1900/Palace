// Trooper-scale defence devices (turrets, missile launchers, interceptors, control panels) in the three
// faction styles, plus the shared core and guard colours. Roof devices are real structure pixels added to
// the building frame, so they are delivered by the construction simulation and carry load; control
// panels are interior fixtures that never block a walkway.
// Saturated glowing amber: hotter than the Asian gold trim and far deeper than the pale turret accent.
const PIXEL_CORE_COLOR = Object.freeze([255, 164, 20]);
const PIXEL_CORE_SHADE = Object.freeze([150, 78, 8]);
const PIXEL_GUARD_COLOR = Object.freeze([214, 152, 232]);
const PIXEL_DEVICE_KINDS = Object.freeze(['turret', 'launcher', 'interceptor', 'panel']);
const PIXEL_DEVICE_LABELS = Object.freeze({ turret: 'Turret', launcher: 'Missile launcher',
  interceptor: 'Interceptor', panel: 'Control panel', guards: 'Guard troops' });
// Role accents match main's map markers (turret orange, launcher salmon, interceptor cyan).
const PIXEL_DEVICE_ROLE_COLORS = Object.freeze({ turret: [239, 173, 103], launcher: [241, 126, 120],
  interceptor: [139, 217, 238], panel: [120, 230, 140] });

// Stamps face right; '#' body, 'o' style trim, 'k' steel, 'r' role accent, 's' screen, 'l' beacon.
const PIXEL_DEVICE_ART = {
  turret: {
    modern: ['..####....', '.######kkk', '.##rr##...', '.######...', '..####....', '.######...'],
    asian: ['o......o..', 'oooooooo..', '.######...', '.##r###kkk', '.######...', '.oo##oo...'],
    gothic: ['.#.#.#....', '.#####....', '.##r##kkk.', '.#####....', '.##o##....', '#######...'],
  },
  launcher: {
    modern: ['......rr.', '.....kkkr', '....kkkk.', '...kkkk..', '..kkkk...', '.####....', '.######..', '.##ss##..', '#########'],
    asian: ['......rr.', '.....kkkr', '....kkkk.', '...kkkk..', '..kkkk...', '.ooooooo.', '..#####..', '.o#ss#o..', '#########'],
    gothic: ['......rr.', '.....kkkr', '....kkkk.', '...kkkk..', '..kkkk...', '#.#####.#', '#########', '#o#ss#o##', '#########'],
  },
  interceptor: {
    modern: ['rr...rr', '.rrrrr.', '...k...', '..lkl..', '.kkkkk.', '.k#k#k.', '.#r#r#.', '.#####.', '.#k#k#.', '.#####.', '#######'],
    asian: ['rr...rr', '.rrrrr.', '...k...', '...k...', 'ooooooo', '.k#k#k.', '.#r#r#.', '.#####.', '.#o#o#.', '.#####.', '#######'],
    gothic: ['rr...rr', '.rrrrr.', '...k...', '...l...', 'o.kkk.o', '#k#k#k#', '.#r#r#.', '.#####.', '.#o#o#.', '.#####.', '#######'],
  },
  panel: {
    modern: ['kkkk..', 'kssk..', 'kssk..', 'kkkkkk', '.#rr#.', '.####.'],
    asian: ['oooo..', 'kssk..', 'kssk..', 'kkkkkk', '.#rr#.', 'o####o'],
    gothic: ['.kk...', 'kssk..', 'kssk..', 'kkkkkk', '.#rr#.', '#o##o#'],
  },
};
const PIXEL_DEVICE_PARTS = { '#': 'body', o: 'trim', k: 'steel', r: 'role', s: 'screen', l: 'light' };

function pixelDeviceStamp(kind, style, facing = 1) {
  if (!PIXEL_DEVICE_ART[kind]) throw new Error(`Unknown device ${kind}`);
  if (!PIXEL_BUILDING_STYLES.includes(style)) throw new Error('Invalid building architecture style');
  if (facing !== 1 && facing !== -1) throw new Error('Device facing must be 1 or -1');
  const rows = PIXEL_DEVICE_ART[kind][style];
  const width = Math.max(...rows.map((row) => row.length)), height = rows.length;
  const cells = [];
  rows.forEach((row, dy) => [...row].forEach((char, column) => {
    if (char === '.') return;
    cells.push({ dx: facing > 0 ? column : width - 1 - column, dy, part: PIXEL_DEVICE_PARTS[char] });
  }));
  return { kind, style, facing, width, height, cells };
}

function pixelDeviceColor(part, kind, style) {
  const palette = PIXEL_BUILDING_STYLE_PALETTES[style];
  if (part === 'trim') return palette.ornament;
  if (part === 'steel') return [70, 78, 86];
  if (part === 'role') return PIXEL_DEVICE_ROLE_COLORS[kind];
  if (part === 'screen') return PIXEL_DEVICE_ROLE_COLORS.panel;
  if (part === 'light') return [235, 52, 40];
  return palette.frame.map((value) => Math.round(value * 0.8));
}

const PIXEL_DEVICE_PLANS = Object.freeze({
  military: ['launcher', 'interceptor', 'turret', 'turret'],
  population: ['interceptor', 'turret'],
  farm: ['turret'],
});

// Mounts roof devices on flat stretches of the shape's exposed roofs (never under a finial, never in
// door approaches, interiors or stairwells) and places control panels at the descriptor's panel spots.
function placePixelDevices(world, shaped, style, options = {}) {
  if (!world || !shaped || !shaped.shape) throw new Error('Device placement requires a shaped building');
  const { shape } = shaped, W = world.width, key = (x, y) => y * W + x;
  const frame = new Set(shaped.geometry.frameCells.map((cell) => key(cell.x, cell.y)));
  const topOf = new Map();
  for (const cell of shaped.geometry.frameCells) if (!topOf.has(cell.x) || cell.y < topOf.get(cell.x)) topOf.set(cell.x, cell.y);
  const owner = shaped.metadata.owner || 'left';
  const facing = shape.hangar ? shape.hangar.door : owner === 'right' ? -1 : 1;
  const reserved = new Set();
  for (const apex of shape.apexes) for (let dx = -5; dx <= 5; dx += 1) reserved.add(apex.x + dx);
  const taken = new Set(), devices = [];
  const plan = options.kinds || PIXEL_DEVICE_PLANS[shaped.metadata.type] || [];
  const roofs = shape.roofs.filter((roof) => !roof.pitched).sort((a, b) => a.y - b.y || (b.right - b.left) - (a.right - a.left));
  const fitsAt = (stamp, x, surface) => {
    const bottom = stamp.cells.filter((cell) => cell.dy === stamp.height - 1);
    if (!bottom.every((cell) => frame.has(key(x + cell.dx, surface)) && topOf.get(x + cell.dx) === surface)) return false;
    return stamp.cells.every((cell) => {
      const px = x + cell.dx, py = surface - stamp.height + cell.dy;
      return px >= 3 && px + 3 < W && py >= 1 && !reserved.has(px) && !taken.has(px) && !frame.has(key(px, py)) &&
        !shape.keepClear.has(key(px, py)) && !shape.oneWay.has(key(px, py)) && world.at(px, py) === PARTICLE_EMPTY;
    });
  };
  for (const kind of plan) {
    const stamp = pixelDeviceStamp(kind, style, facing);
    let placed = null;
    for (const roof of roofs) {
      // Scan from the front edge of the roof so weapons sit where they can fire.
      const xs = [];
      for (let x = roof.left; x + stamp.width - 1 <= roof.right; x += 1) xs.push(x);
      if (facing > 0) xs.reverse();
      for (const x of xs) {
        const surface = topOf.get(x + stamp.cells.find((cell) => cell.dy === stamp.height - 1).dx);
        if (surface === undefined || surface > roof.y + 1) continue;
        if (fitsAt(stamp, x, surface)) { placed = { x, surface }; break; }
      }
      if (placed) break;
    }
    if (!placed) continue;
    const cells = stamp.cells.map((cell) => ({ x: placed.x + cell.dx, y: placed.surface - stamp.height + cell.dy, part: cell.part }));
    for (let dx = -1; dx <= stamp.width; dx += 1) taken.add(placed.x + dx);
    devices.push({ kind, style, facing, x: placed.x, y: placed.surface - stamp.height, width: stamp.width,
      height: stamp.height, cells, fixture: false });
  }
  for (const panel of shape.panels || []) {
    const stamp = pixelDeviceStamp('panel', style, panel.facing === -1 ? -1 : 1);
    const x = panel.x - Math.floor(stamp.width / 2), y = panel.floorY - stamp.height;
    devices.push({ kind: 'panel', style, facing: stamp.facing, x, y, width: stamp.width, height: stamp.height,
      room: panel.room, fixture: true,
      cells: stamp.cells.map((cell) => ({ x: x + cell.dx, y: y + cell.dy, part: cell.part })) });
  }
  const deviceCells = devices.filter((device) => !device.fixture).flatMap((device) => device.cells);
  return { ...shaped, devices, deviceCells,
    geometry: { ...shaped.geometry, frameCells: [...shaped.geometry.frameCells.map((cell) => ({ ...cell })),
      ...deviceCells.map(({ x, y }) => ({ x, y }))] } };
}

// Lilac guard tint applied to the trooper artwork (same figure, different uniform).
function pixelGuardColor(color) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const light = (r + g + b) / 765;
  return [Math.round(PIXEL_GUARD_COLOR[0] * (0.7 + light)), Math.round(PIXEL_GUARD_COLOR[1] * (0.7 + light)),
    Math.round(PIXEL_GUARD_COLOR[2] * (0.7 + light))].map((value) => Math.min(255, value));
}
