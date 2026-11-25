// N133 (the user's, 2026-11-24) - a landscape for ground troops: a tank's and a trooper's walk along
// the land from one end's base to the other's, every column, through the towns standing on it; every
// place either one is stopped is listed with why - a step taller than it climbs, a slope steeper, a
// drop, no headroom (a wall), deep water. The land itself stops no one; only water may (a lake to be
// bridged). And the map's shape: 1-2 high mountains, the ends higher than the centre (a valley).
// (pixel-world, det=1)
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world, layout } = pwApp;
const W = world.width, M = PW.M;
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
const solid = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= world.height) return true;
  const id = PW.get(world, x, y) & 63;
  return PW.mat.phase[id] >= PW.PHASE.POWDER && !PW.mat.passable[id];
};
const wet = (x, y) => (PW.get(world, x, y) & 63) === M.WATER;
const KINDS = {
  tank: { height: 36, climb: Math.tan(((PW.tanks && PW.tanks.MAX_SLOPE) || 43) * Math.PI / 180) * 4 + 2, drop: 12 },
  trooper: { height: 25, climb: 9, drop: 16 },
};
// The walk: along the floor it stands on, four columns a stride; where it is stopped, the reason, and
// on from the land's surface past the place.
function walk(kind, x0, x1) {
  const K = KINDS[kind], stops = [];
  let x = x0, fy = world.groundTop[x0];
  while (x < x1) {
    const nx = x + 4;
    let best = null;
    for (let k = 0; k <= Math.ceil(K.climb) + K.drop && best === null; k += 1) {
      for (const f of [fy - k, fy + k]) {
        // (the walk keeps to the land's face - never down a mine's shaft or a drift open to the sky)
        if (best !== null || f - fy > K.drop || fy - f > K.climb || f > world.groundTop[nx] + 8) continue;
        if (solid(nx, f) && !solid(nx, f - 1)) best = f;
      }
    }
    let why = null;
    if (wet(nx, fy - 1) || wet(nx, fy - 4)) why = 'water';
    else if (best === null) {
      // (what stands there: a step up, or the floor falling away)
      let up = 0; while (up < 200 && solid(nx, fy - 1 - up)) up += 1;
      why = up > 0 ? `step ${up} rows` : 'drop';
    } else {
      for (let h = 1; h <= K.height && !why; h += 3) if (solid(nx, best - h)) why = 'no headroom';
    }
    if (why) {
      // (a building's wall the walk meets is its gate to pass - the hall's opening; a tree a tank
      // knocks over and a man steps round; a town's own ground is N141's - each told apart)
      const owner = PW.getOwner(world, nx, fy - 6);
      let tree = false;
      for (let h = 1; h <= K.height && !tree; h += 2) {
        const yy = (best ?? fy) - h;
        if ((PW.getFlags(world, nx, yy) & PW.FLAG.FLORA) || (PW.get(world, nx, yy) & 63) === M.WOOD) tree = true;
      }
      // (a town's ground: its streets, its footprints - a base's runway on its bank - and its site)
      const town = (world.settlements || []).some((s) => nx >= (s.streetLeft ?? s.x0 ?? 0) - 300 && nx <= (s.streetRight ?? s.x1 ?? 0) + 300
        || (s.footprints || []).some(([a, b]) => nx >= a - 60 && nx <= b + 60))
        || (layout.sites || []).some((s) => nx >= s.x0 - 120 && nx <= s.x1 + 120);
      stops.push({ x: nx, y: fy, why: owner > 0 && owner < 50000 ? `${why} (building ${owner})` : tree ? `${why} (tree)` : town ? `${why} (town)` : why });
      // on past it: the next column with open surface ground
      let k = nx + 4;
      while (k < x1 && (wet(k, world.groundTop[k] - 1) || wet(k, world.groundTop[k]))) k += 4;
      x = k; fy = world.groundTop[Math.min(W - 1, k)];
      continue;
    }
    x = nx; fy = best;
  }
  return stops;
}
const sites = layout.sites || [];
const xA = Math.round(sites[0] ? (sites[0].x0 + sites[0].x1) / 2 : 400), xB = Math.round(sites.length ? (sites[sites.length - 1].x0 + sites[sites.length - 1].x1) / 2 : W - 400);
for (const kind of ['trooper', 'tank']) {
  const stops = walk(kind, xA, xB);
  const land = stops.filter((s) => !s.why.startsWith('water') && !/building|tree|town/.test(s.why));
  const hist = {};
  for (const s of stops) { const k = s.why.replace(/ \d+ rows/, '').replace(/ \(building \d+\)/, ' (building)'); hist[k] = (hist[k] || 0) + 1; }
  const townStops = stops.filter((s) => /town/.test(s.why));
  if (townStops.length) info(`${kind}: ${townStops.length} stops on a town's own ground - N141's to smooth: ${townStops.slice(0, 4).map((s) => `${s.x} ${s.why}`).join(', ')}`);
  info(`${kind}: ${stops.length} stops from ${xA} to ${xB} ${JSON.stringify(hist)}; first ${stops.slice(0, 5).map((s) => `${s.x},${s.y} ${s.why}`).join(' | ')}`);
  check(land.length === 0, `nothing in the land itself stops a ${kind} from one end to the other - only water or a building's walls (${land.length} stops on open ground${land.length ? `: ${land.slice(0, 4).map((s) => `${s.x} ${s.why}`).join(', ')}` : ''})`);
  for (const s of land.slice(0, 2)) await view(`n133-stop-${kind}-${s.x}`, s.x, s.y - 30, 5);
}
// The map's shape: one or two high mountains, a valley's ends higher than its centre.
const high = (layout.mountains || []).length;
check(high >= 1 && high <= 2, `one or two high mountains (${high})`);
// (the land's own level - the mountains' columns and the lakes' left out)
const band = (a, b) => {
  let s = 0, n = 0;
  for (let x = Math.round(a); x < b; x += 8) {
    if ((layout.relief && layout.relief[x] > 0.05) || wet(x, world.groundTop[x])) continue;
    s += world.groundTop[x]; n += 1;
  }
  return s / Math.max(1, n);
};
const endL = band(W * 0.05, W * 0.2), endR = band(W * 0.8, W * 0.95), mid = band(W * 0.35, W * 0.65);
check(endL < mid && endR < mid, `the map is a valley - both ends stand higher than the centre (mean surface rows: left end ${endL | 0}, centre ${mid | 0}, right end ${endR | 0})`);
return { checks, shots };
