// N111 (part of N89) - the user's spawn pad, on the game page in a match (mode=game&start=versus&
// side=left&det=1). Every military base with a hangar has a pad 140 wide set flush in the hangar
// floor, over the base's core - now in an armoured vault under the floor, the old core column on the
// floor gone. Troopers, tanks and mechs deployed come up on the pad and leave by the hangar door (in a
// town, by way of its gate); batteries are set down as before; the jets are shown as DRONES (PS's
// N106 replaces them). The crews rebuild a broken pad like the rest of the base.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const info = (t) => checks.push(`INFO ${t}`);
const shots = [];
const { world } = pwApp;
const m = pwApp.match(), G = PW.game, M = PW.M;
const id = (x, y) => PW.get(world, x, y) & 63;
const open = (x, y) => PW.mat.phase[id(x, y)] <= PW.PHASE.GAS;
const step = (s) => pwApp.stepWorld(Math.round(s * 60));
const view = async (name, x, y, z) => { pwApp.focus(x, y, z); for (let t = 0; t < 6; t += 1) await sleep(100); shots.push(await shot(name)); };
step(1.5);

// 1. Every hangar base: one pad, 140 wide, flush in its floor, a vault core under its middle, no
// core column standing on the floor.
const hangars = world.buildings.filter((b) => b && b.type === 'military' && b.canvas && b.canvas.meta
  && ['compound', 'fortress', 'command', 'bastion'].includes(b.canvas.meta.variant));
info(`hangar bases: ${hangars.length} (${hangars.map((b) => `${b.canvas.meta.variant}:${b.side || b.owner || '-'}`).join(' ')})`);
const bad = [];
for (const b of hangars) {
  const p = b.pad;
  if (!p) { bad.push(`${b.id} no pad`); continue; }
  if (p.x1 - p.x0 + 1 !== 140) bad.push(`${b.id} ${p.x1 - p.x0 + 1} wide`);
  if (p.y !== b.ground) bad.push(`${b.id} deck ${p.y} not the floor ${b.ground}`);
  if (!b.hangar || p.x0 < b.hangar.left || p.x1 > b.hangar.right) bad.push(`${b.id} outside its hangar`);
  const mid = (p.x0 + p.x1) / 2;
  const core = (b.cores || []).find((q) => q.vault && Math.abs(q.x - mid) <= 2);
  if (!core || core.vault.lid !== p.y) bad.push(`${b.id} no vault core under its middle`);
  if ((b.cores || []).some((q) => q.standing)) bad.push(`${b.id} a core still stands on the floor`);
}
check(hangars.length >= 2 && !bad.length, `every hangar base has a 140-wide pad flush in its floor over a vault core (${hangars.length} bases${bad.length ? `: ${bad.slice(0, 4).join(', ')}` : ''})`);
// (the deck whole and the base's own, open over it to the lift's clearance)
let deck = 0, cols = 0, clear = 0;
for (const b of hangars) {
  if (!b.pad) continue;
  for (let x = b.pad.x0; x <= b.pad.x1; x += 1) {
    cols += 1;
    if (!open(x, b.pad.y) && PW.getOwner(world, x, b.pad.y) === b.id) deck += 1;
    let n = 0; while (n < 50 && open(x, b.pad.y - 1 - n)) n += 1;
    if (n >= 50) clear += 1;
  }
}
check(deck >= cols * 0.97, `the deck is whole, the base's own (${deck} of ${cols} columns)`);
check(clear >= cols * 0.95, `clear over the pad for a tank, a mech, a drone (${clear} of ${cols} columns with 50 rows open)`);
// (the core under it in its armoured casing: plate shoulders either side of the vault)
let cased = 0;
for (const b of hangars) {
  const p = b.pad, core = p && (b.cores || []).find((q) => q.vault && Math.abs(q.x - (p.x0 + p.x1) / 2) <= 2);
  if (!core) continue;
  let n = 0;
  for (const side of [-1, 1]) for (let d = 15; d <= 19; d += 1) for (let y = p.y + 4; y <= p.y + 30; y += 2) {
    if (id(core.x + side * d, y) === M.STEEL && PW.getOwner(world, core.x + side * d, y) === b.id) n += 1;
  }
  if (n >= 100) cased += 1;
}
check(cased >= hangars.filter((b) => b.pad).length - 1, `the core under the pad stands in its armoured casing (${cased} of ${hangars.filter((b) => b.pad).length})`);

// 2. Deploying: troopers, tanks and mechs come up on the pad and leave by the hangar door.
world.stock.left.hm = 5000;
const mine = G.bases(m, 'left').filter((b) => b.pad);
check(mine.length > 0, `the left side has a base with a pad (${mine.length})`);
if (!mine.length) return { checks, shots };
const home = mine[0];
for (const b of world.buildings) if (b && b.type === 'military' && G.bases(m, 'left').includes(b)) b.level = Math.max(b.level || 1, 5);
const dir = m.sides.left.dir;
const outside = (u) => (dir > 0 ? u.x > home.hangar.door.x + 10 : u.x < home.hangar.door.x - 10);
const kinds = ['trooper', 'tank', 'mech'];
const up = {};
for (const kind of kinds) {
  const r = G.deploy(m, 'left', kind, home);
  if (!r.ok) { check(false, `a ${kind} deploys from the base (${r.note})`); continue; }
  const u = r.unit, foot = kind === 'tank' ? u.y : u.y + 1;
  up[kind] = u;
  check(u.x >= home.pad.x0 && u.x <= home.pad.x1 && Math.abs(foot - home.pad.y) <= 2,
    `a ${kind} comes up on the pad (at ${Math.round(u.x)},${Math.round(u.y)}; the pad ${home.pad.x0}..${home.pad.x1} at ${home.pad.y})`);
  if (kind === 'tank') await view('n111-tank-on-the-pad', Math.round((home.pad.x0 + home.pad.x1) / 2), home.pad.y - 50, 5);
  step(4);
}
await view('n111-core-under-the-pad', Math.round((home.pad.x0 + home.pad.x1) / 2), home.pad.y - 10, 7);
for (let s = 0; s < 40 && kinds.some((k) => up[k] && !up[k].dead && !outside(up[k])); s += 1) step(1);
for (const kind of kinds) {
  const u = up[kind];
  if (!u) continue;
  check(!u.dead && outside(u), `the ${kind} leaves by the hangar door (at ${Math.round(u.x)}, the door ${home.hangar.door.x}${u.blocked ? `, stopped: ${u.blocked}` : ''})`);
}
await view('n111-out-the-door', home.hangar.door.x + dir * 80, home.pad.y - 50, 4);
// (a battery does not come up on the pad: it cannot drive out)
const bat = G.deploy(m, 'left', 'launcher', home);
if (bat.ok) check(!(bat.unit.x >= home.pad.x0 && bat.unit.x <= home.pad.x1 && Math.abs(bat.unit.y + 1 - home.pad.y) <= 2), `a battery is set down off the pad (at ${Math.round(bat.unit.x)},${Math.round(bat.unit.y)})`);
else info(`launcher: ${bat.note}`);

// 3. The jets are shown as the drones that replace them.
const bar = [...document.querySelectorAll('[data-deploy]')].map((el) => el.textContent);
check(G.UNIT_KINDS.jet.label === 'DRONE' && bar.some((t) => /^DRONE /.test(t)) && !bar.some((t) => /JET/.test(t)), `the jets are shown as DRONES (${bar.join(', ')})`);

// 4. The crews rebuild a broken pad.
const cut = [];
for (let x = home.pad.x0 + 8; x <= home.pad.x0 + 40; x += 1) for (const y of [home.pad.y, home.pad.y + 1]) {
  if (PW.getOwner(world, x, y) === home.id && !open(x, y)) { PW.set(world, x, y, M.AIR); PW.setOwner(world, x, y, 0); cut.push([x, y]); }
}
if (world.repair && world.repair.notify) world.repair.notify(home.id);
for (let s = 0; s < 60 && cut.some(([x, y]) => open(x, y)); s += 1) step(1);
const back = cut.filter(([x, y]) => !open(x, y) && PW.getOwner(world, x, y) === home.id).length;
check(cut.length > 20 && back >= cut.length * 0.9, `the crews rebuild a broken pad (${back} of ${cut.length} cells)`);

// 5. N142 (the user's): a whole group in one press - the squad up together at one summed cost,
// every man of it sharing one group key, none standing in another, all off at once; the group bar
// buttons shown. (Mechs go one at a time - the user's answer, 2026-11-27: no mech group.)
{
  world.stock.left.hm = Math.max(world.stock.left.hm, 2000); world.stock.left.sm = Math.max(world.stock.left.sm, 500);
  const hm0 = world.stock.left.hm, sm0 = world.stock.left.sm;
  const plan = G.groupPlan(m, 'left', 'squad');
  const r = G.deployGroup(m, 'left', 'squad', home);
  const squad = r.ok ? r.units : [];
  const want = plan.kinds.length;
  check(r.ok && want === 3 && squad.length === want && squad.every((u) => u.group && u.group === squad[0].group),
    `the squad comes up as one group of three sharing a key (${r.ok ? `${squad.length}, ${squad[0] && squad[0].group}` : r.note})`);
  check(r.ok && hm0 - world.stock.left.hm === plan.hm && sm0 - world.stock.left.sm === plan.sm,
    `paid as one summed cost (${hm0 - world.stock.left.hm} HM, ${sm0 - world.stock.left.sm} SM for ${plan.hm}+${plan.sm})`);
  let apart = true;
  for (const u of squad) for (const v of squad) if (u !== v && Math.abs(u.x - v.x) < 3 && Math.abs(u.y - v.y) < 10) apart = false;
  check(squad.length === want && apart, `none of them stands in another (${squad.map((u) => Math.round(u.x)).join(', ')})`);
  // (the user's three groups: 3 troops; 5 troops and a tank; 6 troops and 2 tanks - and no mech group)
  const count = (g, k) => G.groupPlan(m, 'left', g).kinds.filter((q) => q === k).length;
  const groupBtns = [...document.querySelectorAll('[data-deploy^="group:"]')].map((el) => el.textContent);
  check(groupBtns.length === 3 && count('squad', 'trooper') === 3 && count('patrol', 'trooper') === 5 && count('patrol', 'tank') === 1
    && count('assault', 'trooper') === 6 && count('assault', 'tank') === 2 && !G.GROUPS.mechs,
    `the user's three groups stand on the bar, no mech group (${groupBtns.join(', ')})`);
  if (squad[0]) await view('n142-squad-up', squad[0].x, squad[0].y - 30, 4);
  // (and off at once: within two seconds every man of it is moving, none left standing at the pad)
  const x0 = squad.map((u) => u.x);
  step(2);
  const moved = squad.filter((u, i) => !u.dead && Math.abs(u.x - x0[i]) > 3).length;
  check(squad.length === want && moved === squad.length, `the group sets off at once (${moved} of ${squad.length} moving after 2 s)`);
}
return { checks, shots };
