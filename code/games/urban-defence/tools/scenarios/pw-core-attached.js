// N80: no core may be separated from the building it belongs to. For every building and
// every core tier (main, descendant, sub, standing, pump), the core's bed must have an
// OWNED PATH - through the building's own solid cells - up into the structure proper.
// And no core material may stand in the world outside every building's footprint (a
// re-seat or a generator pass that leaves a vault behind is exactly the bug class).
// Checked at frame 0 (worldgen) and again after the adopted towns have acted (re-seats).
// --page=pixel-world.html --params=det=1&seed=N
const { world } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);

function coreAttached(b, core) {
  // flood from the core's position through cells owned by b; attached = the flood
  // reaches the structure proper (any owned cell at least 8 rows above b.ground... the
  // bed lives BELOW ground; the building stands above it)
  // A REMOTE core (the lake pump's, standing with its own station away from the body):
  // attached means it holds to its own owned works - a standing mass, not a thread.
  if (core.x < b.body.left - 20 || core.x > b.body.right + 20) {
    let mass = 0;
    for (let y = core.y - 30; y <= core.y + 30; y += 1) {
      for (let x = core.x - 36; x <= core.x + 36; x += 1) {
        if (PW.getOwner(world, x, y) === b.id && (PW.get(world, x, y) & 63) !== 0) mass += 1;
      }
    }
    return mass >= 40;
  }
  const L = b.body.left - 20, R = b.body.right + 20, T = b.body.top - 8, G = (core.vault ? core.vault.bottom : core.y + 14) + 12;
  const w = R - L + 1, h = G - T + 1;
  if (w <= 0 || h <= 0 || w * h > 1200000) return true;
  const seen = new Uint8Array(w * h);
  const idx = (x, y) => (y - T) * w + (x - L);
  const inBox = (x, y) => x >= L && x <= R && y >= T && y <= G;
  const stack = [];
  // seed the flood from every owned cell within 3 of the core's centre
  for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
    const x = core.x + dx, y = core.y + dy;
    if (!inBox(x, y)) continue;
    if (PW.getOwner(world, x, y) === b.id && (PW.get(world, x, y) & 63) !== 0) { const i = idx(x, y); if (!seen[i]) { seen[i] = 1; stack.push(i); } }
  }
  if (!stack.length) return false;   // a core with no owned cell around it at all
  const roofline = b.ground - 8;
  while (stack.length) {
    const j = stack.pop();
    const jx = (j % w) + L, jy = ((j / w) | 0) + T;
    if (jy <= roofline) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = jx + dx, y = jy + dy;
      if (!inBox(x, y)) continue;
      const i = idx(x, y);
      if (seen[i]) continue;
      if (PW.getOwner(world, x, y) === b.id && (PW.get(world, x, y) & 63) !== 0) { seen[i] = 1; stack.push(i); }
    }
  }
  return false;
}

function sweep(label) {
  let cores = 0, cut = [];
  for (const b of world.buildings || []) {
    if (!b || !b.body || !b.canvas || !b.cores) continue;
    for (const core of b.cores) {
      cores += 1;
      if (!coreAttached(b, core)) cut.push(`#${b.id} ${b.type} ${core.kind || (core.standing ? 'standing' : '?')}@${core.x},${core.y}`);
    }
  }
  check(cut.length === 0, `${label}: every core keeps an owned path into its building (${cores} cores${cut.length ? '; CUT: ' + cut.slice(0, 6).join(' | ') : ''})`);
  // orphan core material: CORE cells no record claims (outside every building's box,
  // including a margin for risers; the pipes' own works are owner >= 50000)
  let orphans = 0, example = '';
  const boxes = (world.buildings || []).filter((b) => b && b.body).map((b) => [b.body.left - 24, b.body.right + 24, b.body.top - 40, (b.ground || 0) + 60]);
  const step = 2;
  for (let y = 40; y < world.height - 40; y += step) {
    for (let x = 40; x < world.width - 40; x += step) {
      if ((PW.get(world, x, y) & 63) !== M.CORE) continue;
      const o = PW.getOwner(world, x, y);
      if (o >= 50000) continue;                      // the pipeline's own glow cells
      if (o > 0) continue;                           // owned by a building: the check above covers it
      let inside = false;
      for (const [l, r, t, g] of boxes) { if (x >= l && x <= r && y >= t && y <= g) { inside = true; break; } }
      if (!inside) { orphans += 1; if (!example) example = `${x},${y}`; }
    }
  }
  check(orphans === 0, `${label}: no orphan core matter stands outside every building (${orphans}${example ? ' first at ' + example : ''})`);
}

sweep('at generation');
// the adopted towns act: appends, tightens and re-seats - the eras that leave vaults behind
pwApp.stepWorld(60 * 90);
sweep('after the towns act');
return { checks, shots: 0 };
