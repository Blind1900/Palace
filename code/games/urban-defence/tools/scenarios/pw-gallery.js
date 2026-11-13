// Building gallery screenshots (run with --page=pixel-world.html --params=gallery=<population|military|farm>).
const { world } = pwApp;
const set = new URL(location.href).searchParams.get('gallery');
const settle = async (ms = 1200) => { for (let t = 0; t < ms; t += 100) await sleep(100); };
const shots = [];
const view = async (name, x, y, zoomIndex) => {
  pwApp.focus(x, y, zoomIndex);
  await settle();
  shots.push({ name, file: await shot(name) });
};
const placed = world.gallery;
const center = (item) => ({ x: item.x + item.width / 2, y: item.y + item.height / 2 });
for (const style of ['asian', 'gothic', 'modern']) {
  const items = placed.filter((item) => item.style === style);
  const mid = items[Math.floor(items.length / 2)];
  await view(`gal-${set}-${style}-row`, center(mid).x, center(mid).y, 3);
}
for (const [index, item] of placed.entries()) {
  if (set === 'population' && index % 7 !== 0 && index % 7 !== 4) continue;
  if (set !== 'population' && item.style !== 'asian' && index % 2) continue;
  await view(`gal-${item.style}-${item.kind}`, center(item).x, center(item).y + item.height * 0.12, 5);
}
return { shots: shots.length, buildings: placed.map((p) => `${p.style}/${p.kind} ${p.width}x${p.height}`) };
