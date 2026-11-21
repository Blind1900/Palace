// The vehicle rule, end to end (N3): a friendly tank crosses a grown city's inner core -
// streets, ramps, gate halls and all - while an enemy tank rams its way in and is held.
// Runs on the capital lab (the first suite that does): det, a capital grown at speed,
// settled at real pace, the world ALIVE during the drive (crews clear what settling
// sheds; a frozen clock once left a wreckage clump hanging over a lane for ever).
// --page=capital-lab.html --ready="window.pwLab && pwLab.ready" --params=det=1&seed=N
const { world } = pwLab;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];

// the flattest wide stretch takes the city (steep terrace country is a named later slice)
let at = 1200, spread = 1e9;
for (let x = 500; x < world.width - 2100; x += 60) {
  let lo = 1e9, hi = -1e9;
  for (let d = 0; d < 1600; d += 20) { const g = world.groundTop[x + d]; lo = Math.min(lo, g); hi = Math.max(hi, g); }
  if (hi - lo < spread) { spread = hi - lo; at = x + 800; }
}
pwLab.setSpeed(20);
pwLab.drop(at, 'capital', 'modern');
pwLab.stepWorld(60 * 20);
pwLab.setSpeed(4);
pwLab.stepWorld(60 * 20);      // the crews catch the frontier up at a gentler clock
pwLab.setSpeed(1);
for (const b of world.buildings) if (b && b.canvas) world.repair.notify(b.id);
pwLab.stepWorld(60 * 10);      // one patrol round: silent wreckage cleared

const city = pwLab.growth.cities[0];
const main = city.main;
check(!!(main && main.placed), `the capital's main stands (${main ? main.placed.worksL + '..' + main.placed.worksR : '-'})`);
// The drive crosses the RESIDENTIAL RING to the right of the main - population towers,
// their gate halls, the streets and ramps between them. The capital's own core pit (the
// orb bunker at the city's heart) is a KEEP: its armoured bed walls a deep pit by design,
// and routing a lane through the seat of the city is a named later slice, not this rule.
const ringR = city.rings.right.filter((l) => l.placed && l.type === 'population').sort((a, b) => a.placed.worksL - b.placed.worksL);
check(ringR.length >= 3, `the ring has towers to cross (${ringR.length} on the right)`);
const from = main.placed.worksR + 30, to = ringR[ringR.length - 1].placed.worksR + 20;

// 1. the friendly crossing: the tallest hull, the city's own side
const friend = PW.tanks.create(world, { x: from, style: 'modern', side: 'lab' });
PW.tanks.drive(friend, 1);
// (a site the city is raising in its way - a fresh infill, crews mid-way up its blueprint - is the
// crews' until the build stands: the hull waits for it, up to 90 s, and drives on - the lane opens
// when the build does; the clock is the longer by the wait)
const WAIT_MAX = 60 * 90;
let lastX = friend.x, still = 0, ticks = 0, waited = 0;
for (; ticks < 60 * 120 + waited && still < 5 && friend.x < to; ticks += 1) {
  pwLab.stepWorld(1);
  if ((ticks % 60) === 59) { if (Math.abs(friend.x - lastX) < 2) still += 1; else still = 0; lastX = friend.x; }
  if (friend.blocked && still >= 1 && waited < WAIT_MAX) {
    const site = world.buildings.find((b) => b && b.underConstruction && !b.ruined && b.body && b.body.right >= friend.x && b.body.left <= friend.x + 58 + 60);
    if (site) {
      let k = 0;
      for (; k < WAIT_MAX - waited && site.underConstruction && !site.ruined; k += 1) pwLab.stepWorld(1);
      waited += k; ticks += k; still = 0; lastX = friend.x;
      PW.tanks.drive(friend, 1);
    }
  }
}
const sc = friend.stopCell ? ` stopCell ${friend.stopCell[0]},${friend.stopCell[1]}` : '';
check(friend.x >= to, `the friendly hull crosses the inner city (${Math.round(friend.x)} of ${to}, ${(ticks / 60).toFixed(0)}s${waited ? `, ${(waited / 60).toFixed(0)}s of it waiting on a site being built` : ''}, blocked='${friend.blocked || ''}'${sc})`);
pwLab.focus(Math.round(friend.x), world.groundTop[Math.round(friend.x)] - 10, 4);
for (let w = 0; w < 4; w += 1) await sleep(80);
shots.push(await shot('vh-crossed'));

// 2. the friendly drive harmed nothing: every inner tower keeps its mass. A tower the city
// is RAISING right now (a fresh infill or re-seat, crews mid-way up the blueprint) is a
// whole construction site, not a casualty - the N73 staged order at work; only a
// RUINED tower, or a finished one stripped of its mass, counts as harm. (Audited before
// the enemy drives: what it rams is meant to be smashed.)
let whole = 0, lots = 0;
for (const lot of [...city.rings.left, ...city.rings.right, main]) {
  if (!lot || !lot.placed || lot.type === 'farm') continue;
  if (lot.placed.worksR < from || lot.placed.worksL > to) continue;
  const rec = world.buildings[lot.owner - 1];
  if (!rec || !rec.canvas) continue;
  lots += 1;
  if (rec.underConstruction && !rec.ruined) { whole += 1; continue; }
  let above = 0;
  for (let y = rec.body.top; y < rec.ground - 4; y += 2) {
    for (let x = rec.body.left; x <= rec.body.right; x += 2) if (PW.getOwner(world, x, y) === rec.id) above += 1;
  }
  if (!rec.ruined && above * 4 >= (rec.body.right - rec.body.left) * Math.max(1, rec.ground - rec.body.top) * 0.3) whole += 1;
}
check(lots > 0 && whole === lots, `the inner towers stand after the friendly drive (${whole} of ${lots})`);

// 3. the enemy never crosses the city the way a friend does: it rams its way in - the
// first facade's cells crushed, grinding through at a crawl - and is held inside the
// city (N72: an enemy's building it rams; a core, foundations, reinforced lining stop it)
const foe = PW.tanks.create(world, { x: from, style: 'modern', side: 'foe' });
PW.tanks.drive(foe, 1);
lastX = foe.x; still = 0;
let crawl = Infinity, firstRam = -1;
for (let i = 0; i < ticks && still < 4; i += 1) {
  pwLab.stepWorld(1);
  if (foe.rammed && firstRam < 0) firstRam = i;
  if (firstRam >= 0 && i - firstRam < 60) crawl = Math.min(crawl, Math.abs(foe.v));
  if ((i % 60) === 59) { if (Math.abs(foe.x - lastX) < 2) still += 1; else still = 0; lastX = foe.x; }
}
pwLab.focus(Math.round(foe.x), world.groundTop[Math.round(foe.x)] - 10, 4);
for (let w = 0; w < 4; w += 1) await sleep(80);
shots.push(await shot('vh-foe-rams'));
check(foe.rammed > 0 && crawl < PW.tanks.VMAX * 0.5 && foe.x < to - 300,
  `the enemy hull rams its way in and is held inside the city (${foe.rammed || 0} cells crushed, ${crawl.toFixed(0)} cells/s at its slowest in the first facade; in the friend's ${(ticks / 60).toFixed(0)}s it got to ${Math.round(foe.x)} of ${to}, blocked='${foe.blocked || ''}')`);
return { checks, shots: shots.length };
