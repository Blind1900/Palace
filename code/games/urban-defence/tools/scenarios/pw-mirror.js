// Mirrored building pairs (run with --page=pixel-world.html --params=gallery=mirror&seed=N).
// Each design is stamped facing right and then facing left: the pair must be mirror images in
// shape, while the light still comes from the upper left on both.
const { world } = pwApp;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const settle = async (ms = 1000) => { for (let t = 0; t < ms; t += 100) await sleep(100); };
const shots = [];
const view = async (name, x, y, zoomIndex) => { pwApp.focus(x, y, zoomIndex); await settle(); shots.push(await shot(name)); };
const placed = world.gallery;
const report = [];
for (let i = 0; i + 1 < placed.length; i += 2) {
  const a = placed[i], b = placed[i + 1];
  const ca = a.canvas, cb = b.canvas;
  // Shape: solid cells of A mirrored about the body must match B's solid cells.
  let same = 0, total = 0;
  const bodyA = ca.body, bodyB = cb.body;
  for (let y = 0; y < Math.min(ca.height, cb.height); y += 1) {
    for (let x = bodyA.left; x <= bodyA.right; x += 1) {
      const mxB = bodyB.left + (bodyA.right - x);
      const sa = ca.mat[y * ca.width + x] !== 0, sb = mxB >= 0 && mxB < cb.width && cb.mat[y * cb.width + mxB] !== 0;
      if (sa || sb) { total += 1; if (sa === sb) same += 1; }
    }
  }
  const match = total ? same / total : 1;
  // Front: the facing-right design has its front (doors, devices, stairs start, panel) mirrored.
  const devA = ca.devices.map((d) => d.facing).join(''), devB = cb.devices.map((d) => -d.facing).join('');
  report.push(`${a.style}/${a.kind}: mirror match ${(match * 100).toFixed(1)}%, devices ${devA || '-'} vs mirrored ${devB || '-'}`);
  check(match > 0.97 && devA === devB, `${a.style} ${a.kind} and its mirror are mirror images (${(match * 100).toFixed(1)}% of cells)`);
}
for (const style of ['asian', 'gothic', 'modern']) {
  const items = placed.filter((item) => item.style === style);
  for (let i = 0; i + 1 < items.length; i += 2) {
    const a = items[i], b = items[i + 1];
    if (i === 0 || i === 4 || (style === 'asian' && i === 2)) await view(`mir-${style}-${a.kind}`, (a.x + b.x + b.width) / 2, a.y + a.height / 2, 3);
  }
}
return { checks, report, shots: shots.length };
