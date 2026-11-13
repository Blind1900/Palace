// Road / tunnel-entrance seams (testing-lane prototype).
// A road that passes OVER a shaft mouth is handled by the road planner's hatch (pixel-surface-roads.js).
// A road that ENDS at a mouth gets a portal landing: the last stretch ramps down 1:`grade` into an open pit
// beside the shaft, the pit's shaft-side wall is the shaft lining, the mouth is lidded flush with the ground
// (the ladder ends at a manhole under the lid) and a guard rail caps the pit edge on the far side. Units
// driving down the road stop on the landing, and units arriving from the far side stop at the rail, so
// nothing can drop into the shaft or off the pit edge.
const PIXEL_ROAD_PORTAL_DEFAULTS = Object.freeze({ depth: 6, landing: 34, grade: 2, rail: 4, slope: 6 });

// Shaft mouths: runs of tunnel columns that are carved at the surface, with the lining wall either side.
function findPixelShaftMouths(world, network) {
  const mouths = [];
  const open = (x) => x > 0 && x < world.width - 1 && network.isCarved(x, network.surface[x]);
  for (let x = 1; x < world.width - 1; x += 1) {
    if (!open(x) || open(x - 1)) continue;
    let right = x;
    while (open(right + 1)) right += 1;
    const top = (col) => { let y = 0; while (y < world.height - 1 && world.at(col, y) === PARTICLE_EMPTY) y += 1; return y; };
    // Ground at the mouth is the top of the lining (flush with the surrounding surface).
    const ground = Math.min(top(x - 1), top(right + 1));
    mouths.push({ left: x, right, x: Math.round((x + right) / 2), ground,
      lining: { left: x - 1, right: right + 1 }, owner: network.ownerAt(x, network.surface[x]) });
    x = right;
  }
  return mouths;
}

// Plan a portal landing on `side` (+1 = the road arrives from the right, -1 = from the left) of `mouth`.
// options: depth, landing, grade, rail, slope (max ground deviation across the pit), protect(x, y).
function planPixelRoadPortal(world, network, mouth, side, options = {}) {
  const s = { ...PIXEL_ROAD_PORTAL_DEFAULTS, ...options };
  const protect = options.protect || (() => false);
  const fail = (reason, at) => ({ ok: false, reason, at });
  if (side !== 1 && side !== -1) return fail('side must be 1 or -1');
  const G = mouth.ground, F = G + s.depth, edge = side > 0 ? mouth.lining.right : mouth.lining.left;
  const top = (x) => { let y = 0; while (y < world.height - 1 && world.at(x, y) === PARTICLE_EMPTY) y += 1; return y; };
  const rampLength = s.depth * s.grade, columns = [];
  for (let k = 1; k <= s.landing + rampLength; k += 1) {
    const x = edge + side * k;
    if (x < 1 || x > world.width - 2) return fail('portal runs off the world', x);
    const ramp = k - s.landing, floor = ramp <= 0 ? F : F - Math.floor(ramp / s.grade);
    const ground = top(x);
    if (Math.abs(ground - G) > s.slope) return fail('ground too uneven for a portal landing', x);
    const cut = [], fill = [];
    for (let y = Math.min(ground, floor); y < Math.max(ground, floor); y += 1) {
      const m = world.at(x, y);
      if (network.isCarved(x, y)) return fail('portal would cut into a tunnel', x);
      if (protect(x, y)) return fail('portal would cut the pipeline', x);
      if (m === PARTICLE_WATER) return fail('portal would flood', x);
      if (m === PARTICLE_BARRIER || m === PARTICLE_CONSTRUCTION) return fail('a building is in the way', x);
      (ground < floor ? cut : fill).push(y);
    }
    // Keep a solid footing under the floor (the floor row itself stays/turns solid).
    if (network.isCarved(x, floor)) return fail('landing floor sits on a tunnel', x);
    columns.push({ x, floor, cut, fill, part: ramp <= 0 ? 'landing' : 'ramp' });
  }
  // Shaft-side wall of the pit: the lining from the floor up to ground level must be solid.
  const wall = [];
  for (let y = G; y < F; y += 1) if (world.at(edge, y) !== PARTICLE_WALL && world.at(edge, y) !== PARTICLE_TERRAIN) wall.push({ x: edge, y });
  const lid = [];
  for (let x = mouth.left; x <= mouth.right; x += 1) lid.push({ x, y: G, manhole: network.isLadder(x, G) || network.isLadder(x, G + 1) });
  // The rail stands `rail` px above the highest ground a far-side unit could approach from.
  const farLining = side > 0 ? mouth.lining.left : mouth.lining.right;
  let approach = G;
  for (let k = 0; k <= 10; k += 1) { const x = farLining - side * k; if (x > 0 && x < world.width - 1) approach = Math.min(approach, top(x)); }
  const rail = [];
  for (let y = approach - s.rail; y < G; y += 1) if (!network.isCarved(edge, y)) rail.push({ x: edge, y });
  const last = columns[columns.length - 1];
  const landing = columns.filter((c) => c.part === 'landing').map((c) => c.x);
  return { ok: true, reason: 'planned', mouth, side, ground: G, floor: F, edge, columns, wall, lid, rail,
    landing: { left: Math.min(...landing), right: Math.max(...landing), floor: F },
    ramp: { from: columns.find((c) => c.part === 'ramp').x, to: last.x },
    // Where the surface road should end: the first column past the ramp top, at natural ground.
    roadEnd: { x: last.x + side, y: G } };
}

function buildPixelRoadPortal(world, network, plan) {
  if (!plan || !plan.ok) throw new Error('Portal plan is not valid');
  const ledger = { cut: 0, filled: 0, walls: 0, lid: 0, rail: 0 };
  for (const c of plan.columns) {
    for (const y of c.cut) {
      const m = world.at(c.x, y);
      if (m === PARTICLE_TERRAIN) ledger.cut += world.excavate(c.x, y, c.x, y);
      else if (m === PARTICLE_DEBRIS) world.clearDebris(c.x, y, c.x, y);
    }
    for (const y of c.fill) if (world.at(c.x, y) === PARTICLE_EMPTY) { world.set(c.x, y, PARTICLE_TERRAIN); ledger.filled += 1; }
    if (world.at(c.x, c.floor) === PARTICLE_EMPTY) { world.set(c.x, c.floor, PARTICLE_TERRAIN); ledger.filled += 1; }
  }
  const wall = (x, y, key) => { if (world.at(x, y) === PARTICLE_EMPTY && world.placeWall(x, y).ok) ledger[key] += 1; };
  for (const cell of plan.wall) wall(cell.x, cell.y, 'walls');
  for (const cell of plan.lid) {
    wall(cell.x, cell.y, 'lid');
    // The ladder now ends under the manhole lid instead of standing up into open air.
    for (let y = cell.y - 1; y >= 0 && network.isCarved(cell.x, y); y -= 1) network.removeLadder(cell.x, y);
  }
  for (const cell of plan.rail) wall(cell.x, cell.y, 'rail');
  return ledger;
}

// Cells a renderer can colour: ramp/landing paving, the lid (manhole on the ladder column) and the rail.
function pixelRoadPortalCells(plan) {
  const cells = [];
  for (const c of plan.columns) cells.push({ x: c.x, y: c.floor, part: c.part });
  for (const cell of plan.lid) cells.push({ x: cell.x, y: cell.y, part: cell.manhole ? 'manhole' : 'lid' });
  for (const cell of plan.rail) cells.push({ x: cell.x, y: cell.y, part: 'rail' });
  return cells;
}
