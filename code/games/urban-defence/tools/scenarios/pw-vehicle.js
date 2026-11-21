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
// A bounded settle so the crossed ring is BUILT before the drive (a fresh infill in the
// lane would make the drive wait out its clock) - but capped, so the city stays modest
// and does not balloon into new geometry and self-collapses.
for (let w = 0; w < 18; w += 1) {
  pwLab.stepWorld(60 * 5);
  const c0 = pwLab.growth.cities[0];
  const ring = c0.rings.right.filter((l) => l.placed && l.type === 'population');
  if (ring.length >= 3 && ring.slice(0, 5).every((l) => { const b = world.buildings[l.owner - 1]; return b && b.canvas && !b.underConstruction; })) break;
}

const city = pwLab.growth.cities[0];
const main = city.main;
check(!!(main && main.placed), `the capital's main stands (${main ? main.placed.worksL + '..' + main.placed.worksR : '-'})`);
// The drive crosses the RESIDENTIAL RING to the right of the main - population towers,
// their gate halls, the streets and ramps between them. The capital's own core pit (the
// orb bunker at the city's heart) is a KEEP: its armoured bed walls a deep pit by design,
// and routing a lane through the seat of the city is a named later slice, not this rule.
const ringR = city.rings.right.filter((l) => l.placed && l.type === 'population').sort((a, b) => a.placed.worksL - b.placed.worksL);
check(ringR.length >= 3, `the ring has towers to cross (${ringR.length} on the right)`);
// Cross the inner residential ring - the first few towers out from the main, their gate
// halls, streets and ramps. (Marching the whole of an arbitrarily large ring is not the
// rule, and only adds the city's far churn as noise.)
const crossR = ringR.slice(0, Math.min(5, ringR.length));
const from = main.placed.worksR + 30, to = crossR[crossR.length - 1].placed.worksR + 20;

// 1. the friendly crossing: the tallest hull, the city's own side.
// A friendly hull GHOSTS its own side's buildings - it never rams one. PS's ram() stamps
// rec.ram = { at: tick } on anything it crushes; a ghosted building is never stamped. So
// the harm test, immune to the city's own churn (re-seats, mid-build collapses), is: no
// crossed tower carries a ram stamp from the friendly drive's own tick window.
const driveStart = world.tick || 0;
const ruinedBefore = new Set((world.buildings || []).filter((b) => b && b.ruined).map((b) => b.id));
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

// 2. the friendly drive rammed nothing of its own side: no crossed tower carries a ram
// stamp from the drive's tick window. (A tower the city re-seated or let collapse on its
// own in the same window is not the hull's doing - only a ram stamp is.)
let whole = 0, lots = 0;
const driveEnd = world.tick || 0;
for (const lot of [...city.rings.left, ...city.rings.right, main]) {
  if (!lot || !lot.placed || lot.type === 'farm') continue;
  if (lot.placed.worksR < from || lot.placed.worksL > to) continue;
  const rec = world.buildings[lot.owner - 1];
  if (!rec || !rec.canvas) continue;
  lots += 1;
  const rammed = rec.ram && rec.ram.at >= driveStart && rec.ram.at <= driveEnd;
  if (!rammed) whole += 1;
}
check(lots > 0 && whole === lots, `the friendly drive rammed none of its own towers (${whole} of ${lots} unrammed)`);

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
