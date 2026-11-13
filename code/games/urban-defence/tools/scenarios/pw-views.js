// Screenshots of the pixel world at several places and zoom levels (run with --page=pixel-world.html).
// Zoom indexes: -1 fit, 0 = 1/16, 1 = 1/8, 2 = 1/4, 3 = 1/2, 4 = 1, 5 = 2, 6 = 3, 7 = 4, 8 = 6, 9 = 8 px per cell.
const { layout, world } = pwApp;
const settle = async (ms = 1200) => { for (let t = 0; t < ms; t += 100) await sleep(100); };
const views = [];
const view = async (name, x, y, zoomIndex) => {
  pwApp.focus(x, y, zoomIndex);
  await settle();
  views.push({ name, x: Math.round(x), y: Math.round(y), zoomIndex, file: await shot(name) });
};
const surfaceAt = (x) => world.groundTop[Math.round(x)];
await view('pw-01-fit', world.width / 2, world.height / 2, -1);
const left = layout.sites[0];
await view('pw-02-left-base', (left.x0 + left.x1) / 2, surfaceAt((left.x0 + left.x1) / 2) - 100, 2);
const mountain = layout.mountains[0];
await view('pw-03-mountain', mountain.x, surfaceAt(mountain.x) + 200, 3);
const lake = layout.lakes.find((item) => !item.pond) || layout.lakes[0];
await view('pw-04-lake', lake.x, lake.level + 40, 4);
const node = layout.nodes[0];
await view('pw-05-ore', node.x, node.y, 6);
const middle = layout.sites[2];
await view('pw-06-surface-close', middle.x0 + 200, surfaceAt(middle.x0 + 200) - 20, 7);
const vegetation = layout.vegetation || [];
const tallTree = vegetation.filter((item) => item.kind === 'tree').sort((a, b) => b.height - a.height)[3];
if (tallTree) await view('pw-08-trees', tallTree.x + tallTree.width / 2, tallTree.y + tallTree.height / 2, 5);
if (tallTree) await view('pw-09-tree-close', tallTree.x + tallTree.width / 2, tallTree.y + tallTree.height * 0.4, 7);
const rock = vegetation.find((item) => item.kind === 'boulder' && item.height > 18);
if (rock) await view('pw-10-boulder', rock.x + rock.width / 2, rock.y + rock.height / 2, 8);
const forestView = vegetation.filter((item) => item.kind === 'tree')[Math.floor(vegetation.length / 5)];
if (forestView) await view('pw-11-forest', forestView.x, forestView.y + forestView.height * 0.6, 3);
const cave = layout.caves[0];
if (cave) await view('pw-07-cave', cave.points[Math.floor(cave.points.length / 2)].x, cave.points[Math.floor(cave.points.length / 2)].y, 4);
return { views, timings: pwApp.timings, sites: layout.sites, lakes: layout.lakes.length, mountains: layout.mountains.length,
  nodes: layout.nodes.length, caves: layout.caves.length, stats: pwApp.renderer.stats() };
