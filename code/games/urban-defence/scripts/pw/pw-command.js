'use strict';
// Commanding units (N6, the user's design doc): click a unit to select it, Shift+click to add or take
// one away, Shift+drag a box over many; right-click sends the selection - onto one of the enemy's
// units or buildings to attack it, onto the ground to go there. A click on a building selects that
// (a military one deploys from its panel). Esc lets the selection go.
// It works for any unit kind and any page: it reads the world's unit lists, and the order itself is
// handed to the caller (the game sends it through PW.game.order, the unit lab through its own) - so
// controlling one or many is built once (N88).
(function () {
  const PW = window.PW;

  // The box a click finds each kind by (the small ones first: a trooper beside a tank is the one
  // picked), as the unit panel's.
  const KINDS = [
    { list: 'troops', box: (t) => [t.x - 6, t.y - (t.crouch ? 19 : 27), t.x + 6, t.y + 3] },
    // (a mech's height from its module - the hopper is lower since N101 - and its body's lift off its soles)
    { list: 'mechs', box: (m) => [m.x - 18, m.y - ((PW.mechs && PW.mechs.HEIGHT) || 74) - (m.lift || 0), m.x + 18, m.y + 3] },
    // (N111: the jets give way to PS's smaller avenger drones - the box is the airframe's own
    // length nose to tail, about 150 for the drone)
    { list: 'jets', box: (j) => { const half = ((PW.jets && PW.jets.LENGTH) || 150) / 2 + 3; return [j.x - half, j.y - 22, j.x + half, j.y + 20]; } },
    { list: 'defence', box: (u) => { const half = ((PW.defence && PW.defence.TYPES[u.type]) || { length: 100 }).length / 2; return [u.x - half - 2, u.y - 50, u.x + half + 2, u.y + 3]; } },
    { list: 'tanks', box: (t) => [t.x - 64, t.y - 50, t.x + 64, t.y + 8] },
  ];
  // (which list a unit is in: the tanks are the ones without a kind)
  const LIST_OF = { trooper: 'troops', mech: 'mechs', jet: 'jets', defence: 'defence' };
  const boxOf = (u) => KINDS.find((K) => K.list === (LIST_OF[u.kind] || 'tanks')).box(u);

  // opts: { world, side: () => the side the hand commands (null: none), order: (units, ord) => n }
  function create(opts) {
    const world = opts.world;
    const cmd = { sel: [], building: null, box: null, marks: [] };

    function unitAt(x, y) {
      for (const K of KINDS) {
        for (const u of world[K.list] || []) {
          if (u.dead) continue;
          const [x0, y0, x1, y1] = K.box(u);
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return u;
        }
      }
      return null;
    }
    function buildingAt(x, y) {
      let best = null;
      for (const b of world.buildings || []) {
        if (!b || !b.body || b.dismantled) continue;
        const B = b.body;
        if (x < B.left || x > B.right || y < B.top || y > b.ground + 2) continue;
        if (!best || (B.right - B.left) < (best.body.right - best.body.left)) best = b;
      }
      return best;
    }
    const mine = (u) => !!u && u.side === opts.side() && !u.dead;
    const prune = () => { cmd.sel = cmd.sel.filter((u) => !u.dead && (world.troops || []).concat(world.tanks || [], world.mechs || [], world.jets || [], world.defence || []).includes(u)); };

    // A click: a unit of one's own selects it (Shift: adds it, or takes it away); anyone else's unit
    // or a building is selected to be looked at; empty ground lets the selection go.
    function click(p, shift) {
      const u = unitAt(p.x, p.y);
      if (u) {
        cmd.building = null;
        if (!mine(u)) { cmd.sel = [u]; return cmd.sel; }
        if (shift) {
          cmd.sel = cmd.sel.filter(mine);
          if (cmd.sel.includes(u)) cmd.sel = cmd.sel.filter((q) => q !== u); else cmd.sel.push(u);
        } else cmd.sel = [u];
        return cmd.sel;
      }
      const b = buildingAt(p.x, p.y);
      if (b && !shift) { cmd.sel = []; cmd.building = b; return cmd.sel; }
      if (!shift) { cmd.sel = []; cmd.building = null; }
      return cmd.sel;
    }
    // Shift+drag: every unit of one's own whose box the drawn box touches.
    function boxStart(p) { cmd.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; }
    function boxMove(p) { if (cmd.box) { cmd.box.x1 = p.x; cmd.box.y1 = p.y; } }
    function boxEnd(p, add) {
      if (!cmd.box) return cmd.sel;
      boxMove(p);
      const x0 = Math.min(cmd.box.x0, cmd.box.x1), x1 = Math.max(cmd.box.x0, cmd.box.x1);
      const y0 = Math.min(cmd.box.y0, cmd.box.y1), y1 = Math.max(cmd.box.y0, cmd.box.y1);
      cmd.box = null;
      const got = [];
      for (const K of KINDS) for (const u of world[K.list] || []) {
        if (!mine(u)) continue;
        const [a, b, c, d] = K.box(u);
        if (c >= x0 && a <= x1 && d >= y0 && b <= y1) got.push(u);
      }
      cmd.building = null;
      cmd.sel = add ? [...new Set([...cmd.sel.filter(mine), ...got])] : got;
      return cmd.sel;
    }
    // A right-click: the selection (its own units only) attacks what is there, or goes there.
    function command(p) {
      prune();
      const units = cmd.sel.filter(mine);
      if (!units.length) return 0;
      const side = opts.side();
      const u = unitAt(p.x, p.y);
      const b = !u ? buildingAt(p.x, p.y) : null;
      const owner = b ? (b.faction ?? b.side) : null;
      let ord;
      // (one trooper sent to an enemy base or tower goes to hack its panel, on the top floor)
      const panel = b && owner !== side && units.length === 1 && units[0].kind === 'trooper'
        && (b.type === 'military' || b.type === 'population') && (b.panels || [])[0];
      // (the hack order carries the floor row under where the man stands: see PW.game.standAt)
      const spot = panel && PW.game && PW.game.standAt ? PW.game.standAt(world, panel) : panel && { x: panel.x, y: panel.y - 1 };
      if (panel) ord = { type: 'hack', x: spot.x, y: spot.y + 1, target: { x: panel.x, y: panel.y, building: b } };
      else if (u && u.side !== side) ord = { type: 'attack', x: u.x, y: u.y, target: { x: u.x, y: u.y, unit: u } };
      else if (b && owner !== side) ord = { type: 'attack', x: (b.body.left + b.body.right) / 2, y: b.ground, target: { x: (b.body.left + b.body.right) / 2, y: b.ground - 40, building: b } };
      else ord = { type: 'move', x: p.x, y: p.y };
      cmd.marks.push({ x: ord.x, y: ord.type === 'move' ? (world.groundTop[Math.round(ord.x)] || p.y) : ord.y, attack: ord.type !== 'move', t: performance.now() });
      if (cmd.marks.length > 6) cmd.marks.shift();
      return opts.order(units, ord);
    }
    function clear() { cmd.sel = []; cmd.building = null; cmd.box = null; }

    // Drawn over the world: a bracket on each selected unit, the box being drawn, the selected
    // building's outline, and where the last orders were sent.
    function draw(renderer, now) {
      prune();
      const { ctx, camera } = renderer, z = camera.zoom;
      const X = (x) => (x - camera.x) * z, Y = (y) => (y - camera.y) * z;
      ctx.save();
      const pulse = 0.68 + 0.27 * Math.sin(now / 280);
      const side = opts.side();
      for (const u of cmd.sel) {
        const [bx0, by0, bx1, by1] = boxOf(u);
        const x0 = X(bx0), x1 = X(bx1), y0 = Y(by0), y1 = Y(by1);
        const arm = Math.max(3, Math.min(8 * z, (x1 - x0) / 3, (y1 - y0) / 3));
        ctx.beginPath();
        for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
          ctx.moveTo(cx + dx * arm, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * arm);
        }
        ctx.strokeStyle = 'rgba(5, 8, 10, 0.75)'; ctx.lineWidth = Math.max(3, Math.round(z) + 2); ctx.stroke();
        ctx.strokeStyle = u.side === side ? `rgba(228, 240, 200, ${pulse.toFixed(3)})` : `rgba(255, 140, 150, ${pulse.toFixed(3)})`;
        ctx.lineWidth = Math.max(1, Math.round(z)); ctx.stroke();
        // (its health under it: green, then yellow, then red - the user's design doc)
        const hp = Math.max(0, Math.min(1, (u.hp ?? 100) / (u.hpMax || (u.kind === 'defence' && PW.defence ? PW.defence.TYPES[u.type].hp : 100))));
        const w = Math.max(8, x1 - x0);
        ctx.fillStyle = 'rgba(5,8,10,0.8)'; ctx.fillRect(x0, y1 + 3, w, 3);
        ctx.fillStyle = hp > 0.6 ? '#6fae58' : hp > 0.3 ? '#d8b040' : '#c84a30'; ctx.fillRect(x0, y1 + 3, w * hp, 3);
      }
      if (cmd.building && cmd.building.body) {
        const B = cmd.building.body, own = (cmd.building.faction ?? cmd.building.side) === side;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = own ? 'rgba(228,240,200,0.85)' : 'rgba(255,140,150,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(X(B.left) - 2, Y(B.top) - 2, (B.right - B.left) * z + 4, (cmd.building.ground - B.top) * z + 4);
        ctx.setLineDash([]);
      }
      if (cmd.box) {
        ctx.strokeStyle = 'rgba(228,240,200,0.9)'; ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(228,240,200,0.08)';
        const x0 = X(Math.min(cmd.box.x0, cmd.box.x1)), y0 = Y(Math.min(cmd.box.y0, cmd.box.y1));
        const w = Math.abs(cmd.box.x1 - cmd.box.x0) * z, h = Math.abs(cmd.box.y1 - cmd.box.y0) * z;
        ctx.fillRect(x0, y0, w, h); ctx.strokeRect(x0, y0, w, h);
      }
      for (const m of cmd.marks) {
        const age = (now - m.t) / 900;
        if (age > 1) continue;
        const r = (4 + age * 10) * Math.max(1, z);
        ctx.strokeStyle = m.attack ? `rgba(255,120,110,${1 - age})` : `rgba(228,240,200,${1 - age})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    return Object.assign(cmd, { unitAt, buildingAt, click, boxStart, boxMove, boxEnd, command, clear, draw, prune, mine });
  }

  PW.command = { create, boxOf };
})();
