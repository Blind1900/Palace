// N142 (the user's: troops deployed in groups that come up at once, and advance on their own) - PS's
// half, on the game page (mode=game&start=versus&side=left&det=1&towns=1): an assault group (2 tanks
// and 6 men) and a patrol (a tank and 5 men) deployed by one press each (WGM's deployGroup):
// - every man of them comes up where he can get out - none stood behind the hangar's back wall,
//   in a pocket with no way out, its tanks waiting for him for ever (see PW.units' spawnGroup);
// - they advance on their own as one body: its tanks never far ahead of its men (the group walk:
//   a tank waits while its men lag 300 behind - not for one who cannot come);
// - a tank going through a wood holds short of a tree it would knock over while its own men stand
//   where it would come down (see PW.tanks' treeHold) - none of them killed by their own tank's tree.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const { world } = pwApp;
const m = pwApp.match(), G = PW.game;
const step = (s) => pwApp.stepWorld(Math.round(s * 60));
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
step(1.5);
const dir = m.sides.left.dir;
// (the purse full, and the army's cap a grown town's: an assault group is 12 of a new town's 8)
world.stock.left.hm = 99999; world.stock.left.sm = 99999; m.sides.left.popPeak = 100;
const groups = [];
for (const key of ['assault', 'patrol']) {
  const r = G.deployGroup(m, 'left', key);
  if (r.ok) groups.push({ key, units: r.units, x0: r.units.map((u) => u.x), mean0: r.units.reduce((s, u) => s + u.x, 0) / r.units.length, lead: 0, at: 0 });
  else check(false, `the ${key} group deployed (${r.note})`);
  step(6);
}
const LAG = 300, all = groups.flatMap((g) => g.units);
for (let t = 0; t < 160; t += 1) {
  step(0.5);
  for (const g of groups) {
    const men = g.units.filter((u) => u.kind === 'trooper' && !u.dead);
    if (!men.length) continue;
    const rear = Math.min(...men.map((u) => u.x * dir));
    for (const k of g.units) if (k.kind === 'tank' && !k.dead) g.lead = Math.max(g.lead, k.x * dir - rear);
  }
  if (t === 40) for (const g of groups) { const live = g.units.filter((u) => !u.dead); if (live.length) await view(`group-${g.key}-on-its-way`, live.reduce((s, u) => s + u.x, 0) / live.length, live[0].y - 40, 5); }
}
for (const g of groups) { const live = g.units.filter((u) => !u.dead); g.at = live.length ? (live.reduce((s, u) => s + u.x, 0) / live.length - g.mean0) * dir : 0; }
const stuck = all.filter((u) => !u.dead && Math.abs(u.x - groups.find((g) => g.units.includes(u)).x0[groups.find((g) => g.units.includes(u)).units.indexOf(u)]) < 100);
check(groups.length === 2 && groups[0].units.length === 8 && groups[1].units.length === 6 && !stuck.length,
  `the assault group (2 tanks, 6 men) and the patrol (a tank, 5 men) come up and every one of them gets out and on (${stuck.length} left where he came up)`);
check(groups.length === 2 && groups.every((g) => g.at > 2000 && g.lead <= LAG + 80),
  `they advance on their own as one body - ${groups.map((g) => `the ${g.key} ${Math.round(g.at)} cells in 80 s, its tanks at most ${Math.round(g.lead)} ahead of its rearmost man`).join('; ')}`);
const byDebris = all.filter((u) => u.dead && u.hurtBy === 'debris');
check(byDebris.length === 0, `none of their men killed by what their own tanks knock down - the trees they go through (${byDebris.length} killed so; ${all.filter((u) => u.dead).length} of ${all.length} lost in all)`);
return { checks, shots: shots.length };
