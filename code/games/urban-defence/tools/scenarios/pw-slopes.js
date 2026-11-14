// Slope-adaptive bases (run with --page=pixel-world.html --params=gallery=slopes): every style's
// buildings on a gentle rise, a steep hillside and the foot of a mountain.
const { world } = pwApp;
const { M, FLAG } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const settle = async (ms = 1200) => { for (let t = 0; t < ms; t += 100) await sleep(100); };
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); await settle(); shots.push(await shot(name)); };

const placed = world.gallery || [];
check(placed.length === 9, `9 lots placed (got ${placed.length})`);
const id = (x, y) => PW.get(world, x, y) & 63;
const solid = (x, y) => { const p = PW.mat.phase[id(x, y)]; return p === PW.PHASE.SOLID || p === PW.PHASE.POWDER; };
const report = [];
for (const lot of placed) {
  const { plan: p, owner } = lot;
  const G = p.G;
  const name = `${lot.style}/${lot.kind}`;
  const own = (x, y) => PW.getOwner(world, x, y) === owner;
  // Extent of everything the lot built.
  let ox0 = Infinity, ox1 = -Infinity, oy0 = Infinity;
  for (let x = p.x0 - 260; x <= p.x1 + 260; x += 1) for (let y = Math.min(lot.y, G - 420) - 4; y < G + 260; y += 1) {
    if (own(x, y)) { ox0 = Math.min(ox0, x); ox1 = Math.max(ox1, x); oy0 = Math.min(oy0, y); }
  }
  // Nothing floats: every owned solid cell is joined to undisturbed ground (side by side or
  // corner to corner, as pixel lines are drawn).
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const X0 = ox0 - 2, Y0 = oy0 - 2, w = ox1 - ox0 + 5, h = G + 262 - Y0;
  const seen = new Uint8Array(w * h);
  const queue = [];
  let total = 0;
  for (let y = Y0 + 1; y < Y0 + h - 1; y += 1) for (let x = X0 + 1; x < X0 + w - 1; x += 1) {
    if (!own(x, y) || !solid(x, y)) continue;
    total += 1;
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !own(x + dx, y + dy) && PW.mat.ground[id(x + dx, y + dy)]);
    if (touches) { seen[(y - Y0) * w + (x - X0)] = 1; queue.push(x, y); }
  }
  for (let q = 0; q < queue.length; q += 2) {
    const x = queue[q], y = queue[q + 1];
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx <= X0 || ny <= Y0 || nx >= X0 + w - 1 || ny >= Y0 + h - 1) continue;
      const k = (ny - Y0) * w + (nx - X0);
      if (seen[k] || !own(nx, ny) || !solid(nx, ny)) continue;
      seen[k] = 1; queue.push(nx, ny);
    }
  }
  const floating = total - queue.length / 2;
  // Where the unsupported cells are (bounding box and materials), to say what floats.
  let fx0 = Infinity, fx1 = -Infinity, fy0 = Infinity, fy1 = -Infinity;
  const fmat = {};
  if (floating) for (let y = Y0 + 1; y < Y0 + h - 1; y += 1) for (let x = X0 + 1; x < X0 + w - 1; x += 1) {
    if (!own(x, y) || !solid(x, y) || seen[(y - Y0) * w + (x - X0)]) continue;
    fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x); fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y);
    const n = PW.mat.names[id(x, y)]; fmat[n] = (fmat[n] || 0) + 1;
  }
  check(floating === 0, `${name}: nothing floats (${floating} of ${total} cells unsupported` +
    (floating ? ` at x ${fx0 - p.x0}..${fx1 - p.x0} y ${fy0 - G}..${fy1 - G} from the floor: ${JSON.stringify(fmat)})` : ')'));
  // The hill is cut back out of the building and its forecourts.
  let inside = 0;
  for (let x = p.x0; x <= p.x1; x += 1) for (let y = lot.y; y < G; y += 1) if (!own(x, y) && PW.mat.ground[id(x, y)]) inside += 1;
  check(inside === 0, `${name}: no ground left inside the building (${inside} cells)`);
  for (const wall of lot.walls) {
    let left = 0;
    for (let k = 1; k <= wall.court; k += 1) {
      const x = wall.edge + wall.side * k;
      for (let y = wall.top - 12; y < G; y += 1) if (!own(x, y) && PW.mat.ground[id(x, y)]) left += 1;
    }
    check(left === 0, `${name}: forecourt ${wall.side < 0 ? 'left' : 'right'} open to the sky (${left} cells of hill left)`);
    // A way up the wall: steps no higher than 5 cells from the floor to the ground behind the
    // wall, or a ladder all the way up.
    if (wall.access === 'steps') {
      let worst = 0, last = G;
      for (let k = 1; ; k += 1) {
        const x = wall.edge + wall.side * k;
        if ((x - wall.far) * wall.side > 4) break;
        let top = wall.top - 30;
        while (top < G && !solid(x, top)) top += 1;
        worst = Math.max(worst, Math.abs(top - last));
        last = top;
      }
      check(worst <= 5, `${name}: steps from the floor over the ${wall.height}-cell wall (largest rise ${worst})`);
    } else {
      let rungs = 0;
      for (let y = wall.top; y < G; y += 1) if (PW.getFlags(world, wall.ladderAt(y), y) & FLAG.LADDER) rungs += 1;
      check(rungs === G - wall.top, `${name}: ladder up the ${wall.height}-cell wall (${rungs}/${G - wall.top} rows)`);
    }
  }
  // A way down from each stage to the ground below it.
  for (const st of (lot.under ? lot.under.stages : [])) {
    if (st.access === 'steps' || st.access === 'ramp') {
      let worst = 0, last = G;
      for (let k = 0; k <= st.run + 6; k += 1) {
        const x = st.end + st.side * k;
        let top = G - 10;
        while (top < G + 400 && !solid(x, top)) top += 1;
        worst = Math.max(worst, Math.abs(top - last));
        last = top;
      }
      if (st.access === 'ramp') check(worst <= 2, `${name}: vehicle ramp down from the hangar (${st.run} cells, largest drop ${worst})`);
      else check(worst <= 5, `${name}: steps down from the stage (${st.run} cells, largest drop ${worst})`);
    } else if (st.access === 'ladder') {
      const g = world.groundTop[st.ladderX];
      let rungs = 0;
      for (let y = G; y < g; y += 1) if (PW.getFlags(world, st.ladderX, y) & FLAG.LADDER) rungs += 1;
      check(rungs === g - G, `${name}: ladder down from the stage (${rungs}/${g - G} rows)`);
    }
  }
  // A hangar's door opens at grade or onto a ramp.
  if (p.hangarSide) {
    const outside = world.surface0[p.hangarSide < 0 ? p.x0 - 1 : p.x1 + 1];
    const ramp = lot.under && lot.under.stages.some((st) => st.side === p.hangarSide && st.access === 'ramp');
    check(ramp || Math.abs(outside - G) <= 3, `${name}: hangar door at grade (${outside - G} cells) or on a ramp (${ramp})`);
  }
  // The amber cores sit in real ground.
  const buried = lot.cores.filter((c) => c.y > G);
  const ok = buried.filter((c) => id(c.x, c.y) === M.CORE && world.groundTop[c.x] < c.y - 3);
  check(ok.length === buried.length && buried.length > 0, `${name}: cores buried (${ok.length}/${buried.length})`);
  // The ground beyond the works is as it was.
  let changed = 0;
  for (const x of [...Array(60).keys()].flatMap((k) => [ox0 - 1 - k, ox1 + 1 + k])) if (world.groundTop[x] !== world.surface0[x]) changed += 1;
  check(changed === 0, `${name}: ground beyond the works untouched (${changed} columns changed)`);
  report.push(`${name} G ${G} span ${p.gMax - p.gMin} walls ${lot.walls.map((w) => `${w.height}/${w.court}/${w.access}`).join(',') || '-'} ` +
    `stages ${lot.under ? lot.under.stages.map((s) => s.access).join(',') : '-'} works ${ox0}..${ox1}`);
}

// Screenshots: each lot, then a wider view of each style's band.
for (const lot of placed) {
  await view(`slope-${lot.style}-${lot.kind}`, (lot.plan.x0 + lot.plan.x1) / 2, lot.plan.G - 60, 5);
  // Close-ups of the retaining wall and the structure under the raised part.
  for (const wall of lot.walls) await view(`slope-${lot.style}-${lot.kind}-wall`, wall.edge + wall.side * (wall.court / 2 + 6), lot.plan.G - wall.height / 2, 6);
  for (const st of (lot.under ? lot.under.stages : [])) await view(`slope-${lot.style}-${lot.kind}-under`, st.end - st.side * 50, lot.plan.G + 40, 6);
}
for (const style of ['asian', 'gothic', 'modern']) {
  const lots = placed.filter((l) => l.style === style);
  if (lots.length) await view(`slope-${style}-band`, (lots[0].plan.x0 + lots[lots.length - 1].plan.x1) / 2, lots[1].plan.G - 120, 3);
}
return { checks, report, shots: shots.length };
