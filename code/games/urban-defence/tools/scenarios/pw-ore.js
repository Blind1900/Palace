// Ore deposits (run with --page=pixel-world.html --params=seed=N): seams, lenses, pockets, rocky
// clusters, botryoidal masses and breccia pipes, in depth bands that grow with depth.
const { world, layout } = pwApp;
const { M } = PW;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); for (let t = 0; t < 8; t += 1) await sleep(100); shots.push(await shot(name)); };
const W = world.width;
const cell = (x, y) => PW.get(world, x, y);
const isOre = (x, y) => (cell(x, y) & 63) === M.ORE;

const nodes = layout.nodes || [];
const forms = {};
for (const n of nodes) (forms[n.form] = forms[n.form] || []).push(n);
check(Object.keys(forms).length >= 5, `deposits take many forms (${Object.entries(forms).map(([f, list]) => `${f} ${list.length}`).join(', ')})`);
check(nodes.every((n) => n.amount >= 20), `every deposit holds ore (smallest ${Math.min(...nodes.map((n) => n.amount))} cells, at least 20)`);
// Ore grows with depth: the deep bands hold more per deposit than the shallow ones.
const mean = (tier) => { const list = nodes.filter((n) => n.tier === tier); return list.length ? list.reduce((s, n) => s + n.amount, 0) / list.length : 0; };
check(mean('stringer') < mean('vein') && mean('vein') < mean('lode') && mean('lode') < mean('mother lode'),
  `deposits grow with depth (stringer ${mean('stringer') | 0}, vein ${mean('vein') | 0}, lode ${mean('lode') | 0}, mother lode ${mean('mother lode') | 0})`);

// Connected pieces of ore in a node's box (a cluster is several separate lumps).
function pieces(n) {
  const { x0, y0, x1, y1 } = n.box, w = x1 - x0 + 1;
  const seen = new Uint8Array(w * (y1 - y0 + 1));
  let count = 0;
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    if (!isOre(x, y) || seen[(y - y0) * w + (x - x0)]) continue;
    count += 1;
    const stack = [[x, y]]; seen[(y - y0) * w + (x - x0)] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const k = (ny - y0) * w + (nx - x0);
        if (seen[k] || !isOre(nx, ny)) continue;
        seen[k] = 1; stack.push([nx, ny]);
      }
    }
  }
  return count;
}
if (forms.cluster) {
  const counts = forms.cluster.map(pieces);
  check(counts.some((c) => c >= 3), `a cluster is a group of separate rocky lumps (${counts.join(', ')} pieces)`);
}
if (forms.breccia) {
  // Host rock fragments inside the pipe: rock the outside host rock cannot reach (walled in by
  // ore), rimmed with pale selvage (variant 0) where it meets the ore.
  let fragments = 0, edge = 0, rimmed = 0;
  for (const n of forms.breccia) {
    const { x0, y0, x1, y1 } = n.box, w = x1 - x0 + 1;
    const outside = new Uint8Array(w * (y1 - y0 + 1)), stack = [];
    for (let x = x0; x <= x1; x += 1) stack.push([x, y0], [x, y1]);
    for (let y = y0; y <= y1; y += 1) stack.push([x0, y], [x1, y]);
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < x0 || y < y0 || x > x1 || y > y1 || isOre(x, y) || outside[(y - y0) * w + (x - x0)]) continue;
      outside[(y - y0) * w + (x - x0)] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    for (let y = y0 + 1; y < y1; y += 1) for (let x = x0 + 1; x < x1; x += 1) {
      if (isOre(x, y) || outside[(y - y0) * w + (x - x0)] || (cell(x, y) & 63) !== M.STONE) continue;
      fragments += 1;
      const oreNear = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => cell(x + dx, y + dy)).filter((c) => (c & 63) === M.ORE);
      if (oreNear.length) { edge += 1; if (oreNear.every((c) => (c >> 6) === 0)) rimmed += 1; }
    }
  }
  check(fragments > 30 && rimmed > edge * 0.8, `a breccia pipe holds broken host rock rimmed with selvage (${fragments} rock cells walled in by ore, ${rimmed}/${edge} edge cells rimmed)`);
}
if (forms.lens) {
  const flat = forms.lens.every((n) => (n.box.x1 - n.box.x0) > 2.5 * (n.box.y1 - n.box.y0));
  check(flat, `a lens lies along the strata (${forms.lens.map((n) => `${n.box.x1 - n.box.x0}x${n.box.y1 - n.box.y0}`).join(', ')})`);
}
// One of each, close up.
for (const [form, list] of Object.entries(forms)) {
  const n = list.slice().sort((a, b) => b.amount - a.amount)[0];
  const span = Math.max(n.box.x1 - n.box.x0, (n.box.y1 - n.box.y0) * 1.8);
  await view(`ore-${form}-${n.tier.replace(' ', '-')}`, (n.box.x0 + n.box.x1) / 2, (n.box.y0 + n.box.y1) / 2, span > 260 ? 5 : span > 120 ? 6 : 7);
}
return { checks, forms: Object.fromEntries(Object.entries(forms).map(([f, list]) => [f, list.map((n) => `${n.tier} ${n.amount}`)])), shots: shots.length };
