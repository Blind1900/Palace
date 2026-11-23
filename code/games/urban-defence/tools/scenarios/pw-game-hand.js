// N102 (part of N6) - the unit in hand, on the game page (mode=game&start=versus&side=left). One unit
// of one's own selected is the person's: it stands while no key is held - whatever it was doing -
// and moves only while A / D or the arrows are held; Space, W or Up jumps; a left click fires at the
// spot, a right click is its second fire (a trooper's grenade); a click on an enemy is a shot, not a
// selection; Shift+right-click still sends it on an order; P pauses; Q lets it go its own way.
// (Keys go in as keyboard events on the window, clicks as pointer events on the canvas - the same
// handlers a keyboard and a mouse reach.)
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const shots = [];
const { world } = pwApp;
const m = pwApp.match();
const G = PW.game;
const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const canvas = document.getElementById('world-canvas');
const ptr = (type, wx, wy, opts = {}) => {
  const p = pwApp.toClient(wx, wy);
  canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, ...opts }));
};
const clickAt = (wx, wy, button = 0, opts = {}) => {
  ptr('pointerdown', wx, wy, { button, buttons: button === 2 ? 2 : 1, ...opts });
  ptr('pointerup', wx, wy, { button, buttons: 0, ...opts });
};
const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
const tap = (code, ticks) => { key('keydown', code); pwApp.stepWorld(ticks); key('keyup', code); };

// A trooper of one's own, deployed by a real click, on its way somewhere.
const el = document.querySelector('#gm-bar [data-deploy="trooper"]');
const pc = centre(el);
await click(pc.x, pc.y);
await sleep(60);
const u = G.unitsOf(m, 'left').filter((q) => q.kind === 'trooper').pop();
check(!!u, 'a trooper is deployed');
if (!u) return { checks };
pwApp.stepWorld(60);
const dir = m.sides.left.dir;
G.order(m, [u], { type: 'move', x: Math.round(u.x + 600 * dir), y: world.groundTop[Math.round(u.x + 600 * dir)] - 1 });
pwApp.stepWorld(60);
pwApp.focus(u.x, u.y - 30, 4);
await sleep(200);

// 1. Selected, it is in hand - and stands, though it was on its way.
clickAt(u.x, u.y - 12);
const hand = pwApp.selected && pwApp.selected();
check(!!hand && hand.t === u && PW.gameUI.command().sel.length === 1, 'a click on it selects it and takes it in hand');
check(u.game.order.type === 'manual', `in hand it is the person's (order ${u.game.order.type})`);
let x0 = u.x;
pwApp.stepWorld(120);
// (N110: taken in hand at a jog, it brakes to a stop in a cell or two - on its errand it would go 88)
check(Math.abs(u.x - x0) < 3, `with no key held it stands, its errand dropped (moved ${(u.x - x0).toFixed(1)} in 2 s)`);

// 2. It moves only while A / D or an arrow is held.
for (const [code, sgn] of [['KeyD', 1], ['ArrowLeft', -1], ['ArrowRight', 1], ['KeyA', -1]]) {
  x0 = u.x;
  key('keydown', code);
  pwApp.stepWorld(45);
  const moved = u.x - x0;
  key('keyup', code);
  pwApp.stepWorld(20);
  const x1 = u.x;
  pwApp.stepWorld(60);
  check(moved * sgn > 4 && Math.abs(u.x - x1) < 1, `${code} held walks it (${moved.toFixed(1)} cells), let go it stands (${(u.x - x1).toFixed(1)} after)`);
}

// 3. Space, W or Up jumps.
for (const code of ['Space', 'KeyW', 'ArrowUp']) {
  pwApp.stepWorld(40);
  const y0 = u.y;
  let top = y0;
  key('keydown', code);
  for (let k = 0; k < 30; k += 1) { pwApp.stepWorld(1); top = Math.min(top, u.y); }
  key('keyup', code);
  pwApp.stepWorld(60);
  check(top < y0 - 2, `${code} jumps (${(y0 - top).toFixed(0)} cells up)`);
}

// 4. A left click fires at the spot, a right click throws a grenade; a click on an enemy is a shot.
pwApp.stepWorld(120);
let ahead = Math.round(u.x + 80 * dir);
for (let k = 0; k < 20 && PW.gameUI.command().unitAt(ahead, u.y - 14); k += 1) ahead += dir * 24;   // (clear of one's own units)
const shots0 = (u.mag ?? 0) + (u.ammo ?? 0), g0 = u.grenades ?? 0;
clickAt(ahead, u.y - 14, 0);
pwApp.stepWorld(30);
check((u.mag ?? 0) + (u.ammo ?? 0) < shots0, `a left click fires its rifle at the spot (${shots0} -> ${(u.mag ?? 0) + (u.ammo ?? 0)} rounds)`);
clickAt(ahead, u.y - 14, 2);
pwApp.stepWorld(30);
check((u.grenades ?? 0) === g0 - 1, `a right click throws a grenade there (${g0} -> ${u.grenades})`);
// (the enemy set down where no unit of one's own stands to take the click - a turret on its base, N103 -
// and the turrets round about told to hold their fire, so it stands to be shot by the one in hand)
for (const t of world.defence || []) if (t.type === 'turret' && Math.abs(t.x - u.x) < 1200) t.hold = true;
let fx = Math.round(u.x + 120 * dir);
for (let k = 0; k < 20 && PW.gameUI.command().unitAt(fx, world.groundTop[fx] - 12); k += 1) fx += dir * 24;
const foe = PW.troops.create(world, { x: fx + 0.5, y: world.groundTop[fx], side: 'right', style: 'modern', facing: -dir });
pwApp.stepWorld(90);
const r0 = (u.mag ?? 0) + (u.ammo ?? 0);
clickAt(foe.x, foe.y - 12, 0);
pwApp.stepWorld(20);
check(PW.gameUI.command().sel.length === 1 && PW.gameUI.command().sel[0] === u && (u.mag ?? 0) + (u.ammo ?? 0) < r0,
  'a click on an enemy is a shot at it - the selection stays');
foe.dead = true;

// 4b. Its shots go where the mouse is: the pointer moved over the world, its aim follows it - and F
// fires there too.
const spot = { x: Math.round(u.x - 90 * dir), y: u.y - 40 };
ptr('pointermove', spot.x, spot.y, { buttons: 0 });
await sleep(80);
check(!!u.aim && Math.abs(u.aim.x - spot.x) < 3 && Math.abs(u.aim.y - spot.y) < 3,
  `its aim follows the mouse (aim ${u.aim ? `${Math.round(u.aim.x)},${Math.round(u.aim.y)}` : 'none'}, mouse ${spot.x},${spot.y})`);
const r1 = (u.mag ?? 0) + (u.ammo ?? 0);
tap('KeyF', 20);
check((u.mag ?? 0) + (u.ammo ?? 0) < r1 && Math.sign(u.facing) === -dir, 'F fires at the mouse - it turns to it');

// 5. Shift+right-click still sends it on an order.
let goal = Math.round(u.x + 200 * dir);
for (let k = 0; k < 20 && PW.gameUI.command().unitAt(goal, world.groundTop[goal] - 4); k += 1) goal += dir * 24;
clickAt(goal, world.groundTop[goal] - 4, 2, { shiftKey: true });
check(u.game.order.type === 'move' && Math.abs(u.game.order.x - goal) < 40, `Shift+right-click sends it there (${u.game.order.type})`);

// 6. P pauses and resumes.
const p0 = pwApp.paused();
tap('KeyP', 0);
const p1 = pwApp.paused();
tap('KeyP', 0);
check(p1 === !p0 && pwApp.paused() === p0, 'P pauses, and P again resumes');

// 7. The view follows the unit in hand as its keys walk it out of the middle of the screen.
clickAt(u.x, u.y - 12);
// (the view set with the unit near its edge the way it will walk)
const cam = pwApp.renderer.camera, VW = pwApp.renderer.view.width / cam.zoom;
cam.x = u.x - (dir > 0 ? 0.78 : 0.22) * VW;
pwApp.renderer.clampCamera();
await sleep(50);
const cam0 = cam.x;
key('keydown', dir > 0 ? 'KeyD' : 'KeyA');
for (let k = 0; k < 30; k += 1) { pwApp.stepWorld(6); await sleep(16); }
key('keyup', dir > 0 ? 'KeyD' : 'KeyA');
await sleep(100);
const d = pwApp.renderer.worldToDevice(u.x, u.y), W = pwApp.renderer.view.width;
check((pwApp.renderer.camera.x - cam0) * dir > 0 && d.x > 0 && d.x < W, `the view comes after it (${Math.round(pwApp.renderer.camera.x - cam0)} cells; it is in sight)`);
shots.push(await shot('n102-in-hand'));

// 8. Q lets it go its own way: out of hand, on its own.
tap('KeyQ', 0);
check(PW.gameUI.command().sel.length === 0 && !(pwApp.selected && pwApp.selected()) && u.game.order.type === 'auto',
  `Q lets it go its own way (order ${u.game.order.type})`);
return { checks, shots: shots.length };
