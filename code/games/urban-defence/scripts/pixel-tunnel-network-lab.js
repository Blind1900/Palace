(() => {
  const canvas = document.getElementById('net-canvas');
  const context = canvas.getContext('2d');
  let image = null, pixels = null;
  const rgb = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  const tone = (c, a) => rgb(clamp(c[0] * a), clamp(c[1] * a), clamp(c[2] * a));
  const mixArr = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  // Same integer grain hash as the building lab's wall detail, so textures share one look.
  const grain = (x, y) => (Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 13) & 15;
  const C = {
    skyTop: [8, 13, 22], skyLow: [34, 50, 60], void: [30, 24, 19], grass: [88, 124, 54], grassDark: [64, 96, 42],
    soil: [104, 80, 52], rock: [92, 72, 48], pebble: [114, 96, 74], pave: [98, 96, 90],
    water: [52, 120, 200], waterTop: [128, 186, 236], wall: [191, 123, 25], barrier: [140, 150, 160],
    debris: [120, 104, 84], construction: [170, 160, 140], tunnel: [24, 23, 22], floor: [44, 36, 28],
    prop: [76, 54, 32], lamp: [255, 220, 140], rail: [150, 112, 62], rung: [214, 178, 112],
    asphalt: [26, 27, 30], dash: [236, 200, 60], dashWhite: [236, 236, 228], kerb: [118, 110, 96], kerbUrban: [150, 148, 140],
    concrete: [156, 152, 142], railing: [196, 196, 186], hatch: [118, 128, 138], hatchLid: [70, 76, 84],
    post: [92, 96, 104],
  };
  const colors = {
    marker: rgb(242, 242, 242), node: [163, 91, 214], nodeEmpty: [80, 60, 96],
    pipeHM: [150, 120, 40], pipeSM: [52, 130, 46], broken: rgb(224, 69, 58),
    repaired: rgb(255, 250, 220), HM: [230, 205, 114], SM: [127, 214, 91], miner: rgb(255, 225, 77),
    blue: [70, 130, 220], red: [210, 70, 70], silo: rgb(220, 220, 180),
    valid: rgb(90, 240, 120), invalid: rgb(240, 70, 60), pick: rgb(255, 255, 255),
  };
  const packed = (c) => rgb(c[0], c[1], c[2]);
  const glow = [255, 214, 120], hover = [90, 230, 255];
  const notice = document.getElementById('net-notice');
  const status = document.getElementById('net-status');
  const logView = document.getElementById('net-log');
  const modeSelect = document.getElementById('net-mode');
  const query = new URLSearchParams(location.search);
  let lab = null, running = false, anchorCache = null, hovered = [], picked = null, preview = null, mouse = null;
  let roadStart = null, roadPreview = null, roadHover = null;

  // ---------- Styled buildings from the building lab (visual only) ----------
  const SPRITE_STYLE = { blue: 'modern', red: 'gothic' };
  const SPRITE_VARIANT = { population: 'slab', military: 'compound', farm: 'silos' };
  const SPRITE_KINDS = ['population', 'military', 'farm'];
  let spriteNote = '';
  function enclosed(world, keepClear, frame) {
    const W = world.width;
    return new Set([...keepClear].filter((k) => {
      const x = k % W, y = Math.floor(k / W);
      const hit = (dx, dy) => { for (let s = 1; s < 60; s += 1) if (frame.has((y + dy * s) * W + x + dx * s)) return true; return false; };
      return hit(0, -1) && hit(-1, 0) && hit(1, 0);
    }));
  }
  // Mirrors the building lab's paintBuilding colours, then crops everything above ground into a sprite.
  function buildSprite(kind, style) {
    const b = createPixelStyledBuilding(kind, style, 1, { variant: SPRITE_VARIANT[kind], previewFinished: true });
    const { world, styled, shape, scenario } = b, W = world.width, key = (x, y) => y * W + x;
    const palette = PIXEL_BUILDING_STYLE_PALETTES[style];
    const map = new Map(), back = new Map();
    const paint = (cells, color) => { for (const cell of cells) map.set(key(cell.x, cell.y), color); };
    if (b.wallDetail) for (const [k, color] of b.wallDetail) map.set(k, color);
    if (b.windows) {
      for (const cell of b.windows.side) map.set(key(cell.x, cell.y), pixelWindowColor(cell.part, 'side', style));
      for (const cell of b.windows.back) back.set(key(cell.x, cell.y), pixelWindowColor(cell.part, 'back', style));
    }
    if (shape) {
      for (const k of shape.oneWay) map.set(k, palette.frame.map((v) => Math.round(v * 0.78)));
      for (const k of shape.passThrough) map.set(k, palette.frame.map((v) => Math.round(v * 0.5)));
    }
    paint(styled.ornamentCells || [], palette.ornament);
    paint(styled.accentCells || [], [235, 52, 40]);
    for (const device of b.devices) {
      if (device.fixture) continue;
      for (const cell of device.cells) map.set(key(cell.x, cell.y), pixelDeviceColor(cell.part, device.kind, style));
    }
    if (shape) for (const k of shape.coreHousing) map.set(k, PIXEL_CORE_SHADE);
    paint(scenario.inspectCore().cells, PIXEL_CORE_COLOR);
    paint(styled.geometry.seeds || [], PIXEL_CORE_COLOR);
    const frame = new Set(styled.geometry.frameCells.map((cell) => key(cell.x, cell.y)));
    const inside = shape ? enclosed(world, shape.keepClear, frame) : new Set();
    const tint = mixArr([20, 28, 36], palette.frame, 0.16);
    const { left, right } = styled.geometry.bounds, ground = styled.surfaceY;
    const cells = [];
    let top = ground;
    for (let y = 0; y < ground; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const m = world.at(x, y), k = key(x, y);
        let color = null;
        if (m === PARTICLE_BARRIER || m === PARTICLE_CONSTRUCTION) color = map.get(k) || palette.frame;
        else if (m === PARTICLE_EMPTY && back.has(k)) color = back.get(k);
        else if (m === PARTICLE_EMPTY && inside.has(k)) color = tint;
        if (!color) continue;
        cells.push({ dx: x - left, dy: y - ground, color: packed(color) });
        top = Math.min(top, y);
      }
    }
    return { kind, style, width: right - left + 1, height: ground - top, cells };
  }
  let sprites = null;
  if (!query.has('classic') && typeof createPixelStyledBuilding === 'function') {
    try {
      sprites = new Map();
      for (const owner of ['blue', 'red']) for (const kind of SPRITE_KINDS) sprites.set(`${owner}-${kind}`, buildSprite(kind, SPRITE_STYLE[owner]));
      spriteNote = 'Buildings drawn with the building lab styles (blue modern, red gothic).';
    } catch (error) {
      sprites = null; spriteNote = `Styled buildings unavailable (${error.message}); showing outlines.`;
      console.warn(error);
    }
  }
  function labOptions() {
    if (!sprites) return { roadOptions };
    const plots = SPRITE_KINDS.map((kind) => {
      const list = [...sprites.values()].filter((sprite) => sprite.kind === kind);
      return { kind, w: Math.max(...list.map((s) => s.width)), h: Math.max(...list.map((s) => s.height)) };
    });
    const span = plots.reduce((sum, plot) => sum + plot.w + 6, 8);
    const sky = Math.max(...plots.map((plot) => plot.h)) + 22;
    const height = Math.max(180, sky + 170);
    return { width: Math.max(360, 2 * (span + 75) + 110), height, groundRatio: sky / height, plots, roadOptions };
  }
  const roadOptions = { styleOf: (owner) => SPRITE_STYLE[owner] || 'modern' };

  function regenerate() {
    const seed = Math.max(1, Math.floor(Number(document.getElementById('net-seed').value) || 1));
    lab = createPixelTunnelLabWorld(seed, labOptions());
    if (canvas.width !== lab.world.width || canvas.height !== lab.world.height || !image) {
      canvas.width = lab.world.width; canvas.height = lab.world.height;
      image = context.createImageData(canvas.width, canvas.height);
      pixels = new Uint32Array(image.data.buffer);
    }
    pw = canvas.width; ph = canvas.height;
    anchorCache = null; picked = null; preview = null; hovered = []; roadStart = null; roadPreview = null; roadHover = null;
    const failed = lab.plans.filter((plan) => !plan.ok);
    notice.textContent = (failed.length ? `Seed ${seed}: ${failed.length} generated route(s) rejected - ${failed[0].reason}`
      : `Seed ${seed}: ${lab.plans.length} tunnel segments planned.`) + (spriteNote ? ` ${spriteNote}` : '');
    draw();
  }
  // put/blend draw into the current target (the main canvas, or a bridge-sheet panel while it renders).
  let pw = canvas.width, ph = canvas.height;
  const inside = (x, y) => x >= 0 && y >= 0 && x < pw && y < ph;
  const put = (x, y, color) => { if (inside(x, y)) pixels[y * pw + x] = color; };
  const blend = (x, y, [r, g, b], amount) => {
    if (!inside(x, y)) return;
    const i = y * pw + x, c = pixels[i];
    const mix = (from, to) => Math.round(from + (to - from) * amount);
    pixels[i] = rgb(mix(c & 255, r), mix((c >> 8) & 255, g), mix((c >> 16) & 255, b));
  };

  function anchors() {
    const { world, network } = lab;
    const stamp = `${world.terrainRevision}:${network.segments.length}:${network.segments.filter((s) => s.phase === 'complete').length}`;
    if (!anchorCache || anchorCache.stamp !== stamp) anchorCache = { stamp, list: network.digAnchors() };
    return anchorCache.list;
  }
  // Thin outline glow: tints the wall/surface pixel itself, plus a faint 1 px halo only in open sky,
  // so tunnel interiors, ladders and pipes stay readable underneath.
  function paintGlow(list, color, strength) {
    for (const anchor of list) {
      blend(anchor.x, anchor.y, color, strength * 0.75);
      if (anchor.type !== 'surface') continue;
      const gy = anchor.y - 1;
      if (inside(anchor.x, gy) && lab.world.at(anchor.x, gy) === PARTICLE_EMPTY && !lab.network.isCarved(anchor.x, gy)) {
        blend(anchor.x, gy, color, strength * 0.25);
      }
    }
  }

  // ---------- Textured base layer ----------
  let horizon = 1;
  function baseColor(x, y, material, top, footprint) {
    const { world, network } = lab, g = grain(x, y), carved = network.isCarved(x, y);
    if (material === PARTICLE_EMPTY) {
      if (network.isLadder(x, y)) return y % 3 === 0 ? packed(C.rung) : tone(C.rail, g < 3 ? 0.9 : 1);
      if (carved && y >= lab.surface[x]) {
        const above = network.isCarved(x, y - 1), below = network.isCarved(x, y + 1);
        if (!below) return tone(C.floor, g < 4 ? 0.9 : 1);
        const props = x % 16 === 0 && network.isCarved(x - 2, y) && network.isCarved(x + 2, y) &&
          !(network.isCarved(x, y - 3) && network.isCarved(x, y + 3) && !network.isCarved(x - 3, y));
        if (props || (!above && (x % 16 <= 1 || x % 16 === 15) && network.isCarved(x - 2, y) && network.isCarved(x + 2, y))) {
          return tone(C.prop, g < 4 ? 0.85 : 1);
        }
        return tone(C.tunnel, (above ? 1 : 0.8) * (g === 0 ? 1.25 : 1));
      }
      if (y >= top) return tone(C.void, g < 4 ? 0.85 : 1);
      const t = Math.min(1, y / horizon);
      const sky = mixArr(C.skyTop, C.skyLow, t * t);
      if (t < 0.55 && g === 0 && grain(y, x) === 3) return packed([150, 160, 175]);
      return packed(sky);
    }
    if (material === PARTICLE_TERRAIN) {
      const d = y - top;
      if (footprint && d <= 1) return tone(C.pave, d === 0 ? 1.12 : g < 6 ? 0.9 : 1);
      if (d === 0 && y <= lab.surface[x] + 2) return packed(g < 5 ? C.grassDark : C.grass);
      if (d <= 2) return tone(C.soil, g < 5 ? 0.9 : 1);
      if (g === 0 && grain(x >> 1, y >> 1) === 0) return packed(C.pebble);
      const band = ((Math.floor((y + 3 * Math.sin(x / 11)) / 9) % 3) + 3) % 3;
      const depth = 1 - Math.min(0.28, Math.max(0, y - lab.surface[x]) / 420);
      return tone(C.rock, [1, 0.94, 1.04][band] * depth * (g < 3 ? 0.92 : g > 13 ? 1.06 : 1));
    }
    if (material === PARTICLE_WATER) {
      if (world.at(x, y - 1) !== PARTICLE_WATER) return packed(C.waterTop);
      let depth = 1;
      while (depth < 12 && y - depth >= 0 && world.at(x, y - depth) === PARTICLE_WATER) depth += 1;
      return tone(C.water, (1.05 - depth * 0.035) * (g === 0 ? 1.12 : 1));
    }
    if (material === PARTICLE_WALL) {
      // Stone courses like the building lab's gothic walls: 3-row courses, staggered joints, lit inner face.
      const course = Math.floor(y / 3), joint = y % 3 === 0 || (x + (course % 2) * 2) % 4 === 0;
      const facing = network.isCarved(x - 1, y) || network.isCarved(x + 1, y) || network.isCarved(x, y - 1) || network.isCarved(x, y + 1);
      return tone(C.wall, (joint ? 0.8 : 1) * (facing ? 1.14 : 0.95) * (g === 0 ? 0.9 : g === 1 ? 1.08 : 1));
    }
    if (material === PARTICLE_BARRIER) return tone(C.barrier, g < 4 ? 0.9 : 1);
    if (material === PARTICLE_DEBRIS) return tone(C.debris, g < 6 ? 0.85 : 1.05);
    if (material === PARTICLE_CONSTRUCTION) return tone(C.construction, g < 4 ? 0.9 : 1);
    return packed(C.skyTop);
  }

  // ---------- Surface roads ----------
  const BRIDGE_DECK = { modern: [176, 178, 180], gothic: [122, 116, 108], asian: [150, 92, 58] };
  // Part colours per style, after the reference bridges: white tied arch, grey gothic viaduct, red covered gallery.
  const BRIDGE_PARTS = {
    modern: { girder: [206, 210, 214], pier: [188, 190, 194], cap: [160, 164, 170], arch: [244, 246, 248], cable: [190, 204, 220] },
    gothic: { stone: [100, 96, 92], voussoir: [138, 130, 120], keystone: [176, 166, 150], pier: [88, 84, 80],
      baluster: [146, 140, 130], balRail: [160, 154, 144], finial: [178, 170, 158], tower: [98, 94, 92], buttress: [76, 74, 72],
      tracery: [34, 32, 40], spire: [126, 122, 118], cornice: [136, 130, 122], roof: [64, 68, 78] },
    asian: { redTimber: [182, 50, 38], lattice: [116, 36, 30], roof: [58, 56, 56], tile: [86, 80, 74], eave: [212, 168, 72],
      ridge: [150, 118, 58], finial: [230, 190, 80], pier: [150, 144, 132], bracket: [124, 74, 40], stone: [142, 134, 122],
      archRed: [196, 62, 46] },
  };
  function drawBridgeDecor(road, done, solidAt) {
    const { world, roads } = lab, palette = BRIDGE_PARTS[road.style];
    if (!palette || !roads.bridgeDecor) return;
    const first = road.columns[0].x, last = road.columns[road.columns.length - 1].x;
    for (const cell of roads.bridgeDecor(road)) {
      // Superstructure rises as the deck under it is paved; a broken deck column drops its decor.
      const cx = Math.max(Math.min(first, last), Math.min(Math.max(first, last), cell.x));
      const index = Math.abs(cx - first), column = road.columns[index];
      if (index >= done || !column || !solidAt(column.x, column.deck)) continue;
      const m = world.at(cell.x, cell.y), color = palette[cell.part] || [200, 0, 200];
      const g = grain(cell.x, cell.y), shade = g < 3 ? 0.88 : g > 13 ? 1.08 : 1;
      if (m === PARTICLE_WATER) blend(cell.x, cell.y, color.map((v) => v * 0.7), 0.7);
      else if (m === PARTICLE_EMPTY && !lab.network.isCarved(cell.x, cell.y)) {
        if (cell.part === 'cable') blend(cell.x, cell.y, color, 0.55);
        else if (cell.part === 'tracery') blend(cell.x, cell.y, color, 0.8);
        else put(cell.x, cell.y, tone(color, shade));
      }
    }
  }
  const openAir = (x, y) => inside(x, y) && lab.world.at(x, y) === PARTICLE_EMPTY && !lab.network.isCarved(x, y);
  function drawRoads() {
    const { world, network, roads } = lab;
    if (!roads) return;
    const solidAt = (x, y) => inside(x, y) && [PARTICLE_TERRAIN, PARTICLE_WALL].includes(world.at(x, y));
    for (const road of roads.roads) {
      const done = road.phase === 'complete' ? road.columns.length : road.built;
      road.columns.forEach((c, i) => {
        const { x, deck: D } = c;
        if (i >= done) {
          // Surveyed but not yet paved: dotted deck line, with the paving head blinking.
          if (i === done && (lab.ticks >> 2) % 2 === 0) put(x, D, packed(C.dash));
          else if (x % 2 === 0) blend(x, D, [255, 255, 255], 0.45);
          return;
        }
        if (!solidAt(x, D)) { put(x, D, colors.broken); return; }
        const g = grain(x, D), inPass = network.isCarved(x, D - 1);
        if (c.hatch) {
          // Steel hatch over a tunnel mouth: hazard-striped frame, grated deck, manhole lid over the ladder.
          const frame = !road.columns[i - 1] || !road.columns[i - 1].hatch || !road.columns[i + 1] || !road.columns[i + 1].hatch;
          if (c.manhole) put(x, D, (lab.ticks >> 3) % 8 === 0 ? packed(C.rung) : tone(C.hatchLid, g < 5 ? 0.9 : 1));
          else if (frame) put(x, D, packed((x + D) % 2 ? C.dash : C.asphalt));
          else put(x, D, tone(C.hatch, x % 2 ? 0.8 : 1.05));
          if (inside(x, D + 1) && network.isCarved(x, D + 1) && world.at(x, D + 1) === PARTICLE_EMPTY) blend(x, D + 1, C.hatch, 0.45);
          return;
        }
        if (c.bridge) {
          const deckTone = BRIDGE_DECK[road.style] || C.concrete;
          put(x, D, tone(deckTone, x % 6 === 0 ? 0.82 : g < 4 ? 0.92 : 1));
          if (openAir(x, D - 1)) put(x, D - 1, tone(C.asphalt, 1.1));
          if (openAir(x, D - 2) && !inPass && road.style === 'modern') put(x, D - 2, tone(C.railing, x % 3 === 0 ? 1 : 0.8));
          if (openAir(x, D + 1)) blend(x, D + 1, deckTone, 0.55);
          for (const y of c.pillar) if (solidAt(x, y)) put(x, y, tone(deckTone, (y - D) % 4 === 0 ? 0.78 : grain(x, y) < 4 ? 0.9 : 1));
          return;
        }
        const urban = roads.markingAt(x) === 'white';
        const dash = x % 10 < 4 && !inPass;
        put(x, D, dash ? tone(urban ? C.dashWhite : C.dash, g < 3 ? 0.9 : 1) : tone(C.asphalt, g < 3 ? 1.35 : g > 12 ? 0.85 : 1));
        if (solidAt(x, D + 1)) put(x, D + 1, tone(urban ? C.kerbUrban : C.kerb, g < 5 ? 0.85 : 1));
        if (solidAt(x, D + 2) && world.at(x, D + 2) === PARTICLE_TERRAIN && grain(x, D + 2) < 6) put(x, D + 2, tone(C.kerb, 0.75));
        // Street lamps every 24 px on open-air stretches.
        if (x % 24 === 12 && !inPass && [1, 2, 3, 4, 5, 6].every((h) => openAir(x, D - h))) {
          for (let h = 1; h <= 5; h += 1) put(x, D - h, tone(C.post, h === 5 ? 1.2 : 1));
          put(x + road.dir, D - 6, packed(C.lamp));
          for (let h = 1; h <= 3; h += 1) if (openAir(x + road.dir, D - 6 + h)) blend(x + road.dir, D - 6 + h, C.lamp, 0.3 / h);
        }
      });
      // Owner-coloured end posts.
      for (const end of [road.columns[0], road.columns[road.columns.length - 1]]) {
        const post = end.x + (end === road.columns[0] ? -road.dir : road.dir);
        if (!solidAt(end.x, end.deck) || road.built === 0) continue;
        if (roads.roads.some((other) => other !== road && other.deck.get(end.x) === end.deck)) continue;
        for (let h = 1; h <= 3; h += 1) if (openAir(post, end.deck - h)) put(post, end.deck - h, h === 3 ? packed(colors[road.owner] || C.post) : packed(C.post));
      }
      drawBridgeDecor(road, done, solidAt);
    }
    for (const entry of roads.breaks.values()) if ((lab.ticks >> 2) % 2 === 0) put(entry.x, entry.y, colors.broken);
    for (const fix of roads.repairs) if ((roads.ticks - fix.tick) % 6 < 3) put(fix.x, fix.y, colors.repaired);
  }
  function snapRing(point, color, strength = 0.9) {
    const pulse = 2 + Math.floor((performance.now() / 90) % 4);
    for (let a = 0; a < 24; a += 1) {
      const angle = a / 24 * Math.PI * 2;
      blend(Math.round(point.x + Math.cos(angle) * pulse), Math.round(point.y + Math.sin(angle) * pulse), color, strength - (pulse - 2) * 0.2);
    }
    put(point.x, point.y, colors.pick);
  }
  // Vertical guide from the mouse to the snapped surface marker (plus a short jog if the snap moved sideways).
  function roadGuide(marker) {
    if (!mouse || !tipAt || !marker || marker.type === 'none') return;
    const color = marker.type === 'road' ? [255, 214, 90] : marker.type === 'ground' ? [255, 255, 255] : hover;
    const mx = Math.max(0, Math.min(lab.world.width - 1, Math.round(mouse.x))), my = Math.round(mouse.y);
    const step = my <= marker.y ? 1 : -1;
    for (let y = my; y !== marker.y; y += step) if (((y - marker.y) >> 1) % 2 === 0) blend(mx, y, color, 0.75);
    const dx = marker.x >= mx ? 1 : -1;
    for (let x = mx; x !== marker.x; x += dx) blend(x, marker.y, color, 0.75);
    blend(mx, my, color, 1);
  }
  function drawRoadTool() {
    if (!roadStart) {
      if (roadHover && roadHover.type !== 'none') {
        roadGuide(roadHover);
        snapRing(roadHover, roadHover.type === 'ground' ? [255, 255, 255] : roadHover.type === 'road' ? [255, 214, 90] : hover);
      }
      return;
    }
    snapRing(roadStart, roadStart.type === 'road' ? [255, 214, 90] : hover);
    const p = roadPreview;
    if (!p) return;
    roadGuide(p.to);
    if (p.ok) {
      for (const c of p.columns) {
        for (const y of c.cut) blend(c.x, y, [255, 150, 60], 0.55);
        for (const y of c.fill) blend(c.x, y, [230, 200, 120], 0.6);
        for (const y of c.pillar) blend(c.x, y, [150, 200, 255], 0.6);
        put(c.x, c.deck, c.hatch ? rgb(255, 214, 90) : c.bridge ? rgb(120, 190, 255) : colors.valid);
      }
    } else if (p.deck && p.xs) {
      p.xs.forEach((x, i) => put(x, p.deck[i], (x - p.at) * (p.xs[1] - p.xs[0]) >= 0 ? colors.invalid : rgb(150, 200, 150)));
    }
    if (p.to && p.to.type !== 'none') snapRing(p.to, p.to.type === 'ground' ? [255, 255, 255] : p.to.type === 'road' ? [255, 214, 90] : hover);
    if (!p.ok && Number.isInteger(p.at)) {
      for (let y = 0; y < lab.world.height; y += 1) if ((y >> 1) % 2 === 0) blend(p.at, y, [255, 60, 40], 0.35);
    }
  }

  function draw() {
    const { world, network, mining, pipeline } = lab;
    const { width, height } = world;
    const tops = new Int32Array(width), footprint = new Uint8Array(width);
    horizon = Math.max(1, lab.surface.reduce((sum, v) => sum + v, 0) / width);
    for (let x = 0; x < width; x += 1) tops[x] = world.surfaceRow(x);
    for (const building of lab.buildings) for (let x = building.left; x <= building.right; x += 1) footprint[x] = 1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) pixels[y * width + x] = baseColor(x, y, world.at(x, y), tops[x], footprint[x]);
    }
    // Ladder rungs reach one pixel into the shaft so they read as rungs, not a stripe.
    for (let y = 0; y < height; y += 3) {
      for (let x = 1; x < width - 1; x += 1) {
        if (!network.isLadder(x, y) || world.at(x, y) !== PARTICLE_EMPTY) continue;
        const inward = network.isCarved(x + 1, y) && !network.isLadder(x + 1, y) && world.at(x + 1, y) === PARTICLE_EMPTY ? x + 1 : x - 1;
        if (world.at(inward, y) === PARTICLE_EMPTY && network.isCarved(inward, y)) blend(inward, y, C.rung, 0.55);
      }
    }
    // Ceiling lamps every 32 px along horizontal runs, with a warm halo.
    const lights = [];
    for (let x = 8; x < width; x += 32) {
      for (let y = 1; y < height - 1; y += 1) {
        if (world.at(x, y) !== PARTICLE_EMPTY || !network.isCarved(x, y) || network.isCarved(x, y - 1) || y < lab.surface[x]) continue;
        if (!network.isCarved(x - 2, y) || !network.isCarved(x + 2, y)) continue;
        put(x, y, packed(C.lamp)); lights.push({ x, y });
      }
    }
    const warm = (cx, cy, reach, amount) => {
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
          if (!d || !inside(x, y) || world.at(x, y) !== PARTICLE_EMPTY || !network.isCarved(x, y)) continue;
          blend(x, y, C.lamp, amount / d);
        }
      }
    };
    for (const light of lights) warm(light.x, light.y, 3, 0.22);
    const fillRect = (rect, stored, capacity) => {
      const span = rect.right - rect.left + 1, rows = rect.bottom - rect.top + 1;
      const filled = Math.round(span * rows * Math.min(1, stored / capacity));
      const topRow = rect.bottom - Math.floor((filled - 1) / span);
      for (let i = 0; i < filled; i += 1) {
        const x = rect.left + (i % span), y = rect.bottom - Math.floor(i / span), g = grain(x, y);
        if (world.at(x, y) !== PARTICLE_EMPTY) continue;
        put(x, y, tone(colors.HM, y === topRow ? 1.12 : g < 3 ? 0.78 : g > 13 ? 1.1 : 0.92));
      }
    };
    for (const site of mining.sites) if (site.ready && site.chamber.rect) fillRect(site.chamber.rect, site.stored, site.capacity);
    for (const building of lab.buildings) {
      if (building.cellar && building.cellar.segment.phase === 'complete') {
        fillRect(building.cellar.rect, building.cellar.stored, building.cellar.capacity);
      }
    }
    for (const k of network.markers) if ((k + lab.ticks >> 3) % 2 === 0 || !running) put(k % width, Math.floor(k / width), colors.marker);
    for (const node of network.nodes) {
      const base = node.remaining > 0 ? colors.node : colors.nodeEmpty;
      for (let y = node.y - node.radius; y <= node.y + node.radius; y += 1) {
        for (let x = node.x - node.radius; x <= node.x + node.radius; x += 1) {
          if (world.at(x, y) === PARTICLE_EMPTY) continue;
          const facet = ((x - node.x) + (y - node.y) + 9) % 3;
          const sparkle = node.remaining > 0 && grain(x, y + (lab.ticks >> 4)) === 0;
          put(x, y, sparkle ? rgb(240, 210, 255) : tone(base, [1.18, 0.95, 0.78][facet]));
        }
      }
    }
    // Tubes: lit top edge, shadowed underside and darker flange bands every 12 px.
    for (const [k, shell] of pipeline.casing) {
      const x = k % width, y = Math.floor(k / width);
      if (world.at(x, y) === PARTICLE_EMPTY && !network.isCarved(x, y)) continue;
      if (!pipeline.intactAt(x, y)) { put(x, y, colors.broken); continue; }
      const base = shell.resource === 'HM' ? colors.pipeHM : colors.pipeSM;
      const above = pipeline.pipes.has(k + width), below = pipeline.pipes.has(k - width);
      const flange = x % 12 === 0 || x % 12 === 1;
      put(x, y, tone(base, (above ? 1.3 : below ? 0.72 : 1) * (flange ? 0.72 : 1) * (flange && above && x % 12 === 0 ? 1.5 : 1)));
    }
    for (const [k, pipe] of pipeline.pipes) {
      const x = k % width, y = Math.floor(k / width);
      put(x, y, pipeline.intactAt(x, y) ? (pipe.resource === 'HM' ? rgb(34, 27, 12) : rgb(14, 30, 14)) : colors.broken);
    }
    for (const entry of pipeline.breaks.values()) put(entry.x, entry.y, colors.broken);
    for (const fix of pipeline.repairs) if ((pipeline.ticks - fix.tick) % 6 < 3) put(fix.x, fix.y, colors.repaired);
    drawRoads();
    for (const building of lab.buildings) {
      const sprite = sprites && sprites.get(`${building.owner}-${building.kind}`);
      const owner = colors[building.owner];
      if (sprite) {
        const left = building.left + Math.floor((building.right - building.left + 1 - sprite.width) / 2);
        for (const cell of sprite.cells) {
          const x = left + cell.dx, y = building.ground + cell.dy;
          if (inside(x, y) && world.at(x, y) === PARTICLE_EMPTY && !network.isCarved(x, y)) put(x, y, cell.color);
        }
      } else {
        const color = packed(owner);
        for (let x = building.left; x <= building.right; x += 1) {
          put(x, building.top, color);
          if (building.kind !== 'farm') put(x, building.bottom, color);
        }
        for (let y = building.top; y <= building.bottom; y += 1) { put(building.left, y, color); put(building.right, y, color); }
      }
      // Supply gauge above the roof: owner tab, then SM stock (or silo stock for farms).
      const farmSilos = lab.silos.filter((silo) => silo.id.startsWith(`${building.id}-`));
      const level = building.kind === 'farm'
        ? farmSilos.reduce((s, silo) => s + silo.stock, 0) / Math.max(1, farmSilos.reduce((s, silo) => s + silo.capacity, 0))
        : building.stock.SM / building.capacity;
      if (sprites || building.kind === 'farm' || building.consumes.SM) {
        const gy = building.top - 3, gl = building.left + 3, gw = Math.min(24, building.right - building.left - 5);
        for (let x = 0; x < gw; x += 1) put(gl + x, gy, x < Math.round(gw * Math.min(1, level)) ? packed(colors.SM) : rgb(30, 38, 34));
        put(gl - 2, gy, packed(owner)); put(gl - 2, gy - 1, packed(owner));
      }
    }
    if (!sprites) {
      for (const silo of lab.silos) {
        const top = lab.surface[silo.x] - 8, level = Math.round(6 * silo.stock / silo.capacity);
        for (let y = top; y < lab.surface[silo.x]; y += 1) {
          put(silo.x - 1, y, colors.silo); put(silo.x + 1, y, colors.silo);
          put(silo.x, y, lab.surface[silo.x] - y <= level ? packed(colors.SM) : packed(C.skyLow));
        }
      }
    }
    for (const particle of pipeline.particles) {
      if (particle.done || particle.delay > 0) continue;
      const color = colors[particle.resource];
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (pipeline.casing.has((particle.y + dy) * width + particle.x + dx)) blend(particle.x + dx, particle.y + dy, color, 0.35);
      }
      put(particle.x, particle.y, tone(color, 1.15));
    }
    for (const miner of mining.miners) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          put(miner.x + dx, miner.y + dy, miner.carried && dy === -1 ? packed(colors.HM) : dy === 1 ? rgb(120, 96, 40) : colors.miner);
        }
      }
      if (!miner.carried) put(miner.x, miner.y - 1, rgb(255, 255, 220));
      if (miner.y >= lab.surface[miner.x]) warm(miner.x, miner.y - 1, 3, 0.18);
    }
    if (modeSelect.value === 'dig') {
      if (!picked) {
        paintGlow(anchors(), glow, 1);
        paintGlow(hovered, hover, 1);
      } else {
        paintGlow([picked], hover, 1);
        if (preview) {
          for (const cell of preview.hazards) blend(cell.x, cell.y, [255, 60, 40], 0.9);
          if (preview.snap && preview.snap.type !== 'free') {
            const near = (a) => Math.abs(a.x - preview.snap.x) <= 4 && Math.abs(a.y - preview.snap.y) <= 4 + network.radius;
            paintGlow(anchors().filter((a) => (preview.snap.type === 'surface' ? a.type === 'surface'
              : a.type === 'wall' && a.segment === preview.snap.segment) && near(a)), hover, 1);
          }
          for (const cell of preview.line) put(cell.x, cell.y, preview.ok ? colors.valid : colors.invalid);
          if (preview.snap && preview.snap.type !== 'free') {
            const pulse = 2 + Math.floor((performance.now() / 90) % 4);
            for (let a = 0; a < 24; a += 1) {
              const angle = a / 24 * Math.PI * 2;
              blend(Math.round(preview.snap.x + Math.cos(angle) * pulse), Math.round(preview.snap.y + Math.sin(angle) * pulse),
                [255, 255, 255], 0.9 - (pulse - 2) * 0.2);
            }
            put(preview.snap.x, preview.snap.y, colors.pick);
          }
        }
        put(picked.x, picked.y, colors.pick);
      }
    }
    if (modeSelect.value === 'road') drawRoadTool();
    context.putImageData(image, 0, 0);
    renderStatus();
  }

  function renderStatus() {
    const { network, mining, pipeline } = lab;
    const lines = [`tick ${lab.ticks}   walls ${lab.world.wallCount}px   water ${lab.world.waterCount}px`, '', 'Segments'];
    for (const row of network.inspect()) lines.push(`  #${row.id} ${row.label} [${row.kind}] ${row.progress} ${row.state}`);
    lines.push('', 'HM storage');
    for (const row of mining.audit()) {
      lines.push(`  ${row.node}: node ${row.remaining}/${row.initial}, stored ${row.stored}, carried ${row.carried}, ` +
        `piped out ${row.withdrawn}${row.conserved ? '' : '  LEDGER ERROR'}`);
    }
    for (const miner of mining.miners) lines.push(`  ${miner.id}: ${miner.state}${miner.carried ? ` (${miner.carried} HM)` : ''}`);
    const moving = (resource) => pipeline.particles.filter((p) => !p.done && p.resource === resource).length;
    lines.push('', `Pipeline HM line: ${pipeline.ledger.delivered.HM}/${pipeline.ledger.dispatched.HM} delivered, ${moving('HM')} particle(s) moving`,
      `Pipeline SM line: ${pipeline.ledger.delivered.SM}/${pipeline.ledger.dispatched.SM} delivered, ${moving('SM')} particle(s) moving`);
    for (const building of lab.buildings) {
      const cellar = building.cellar ? `cellar HM ${building.cellar.stored}/${building.cellar.capacity}` : 'no cellar';
      lines.push(`  ${building.id}: ${cellar}, SM ${building.stock.SM}`);
    }
    for (const silo of lab.silos) lines.push(`  ${silo.id}: SM ${silo.stock}/${silo.capacity}`);
    const issues = pipeline.endpoints.filter((endpoint) => endpoint.blocked);
    for (const endpoint of issues) lines.push(`  ${endpoint.id}: ${endpoint.state}`);
    if (lab.roads) {
      lines.push('', `Roads (cut ${lab.roads.ledger.cut}px, filled ${lab.roads.ledger.filled}px, bridged ${lab.roads.ledger.bridged}px, ` +
        `repaired ${lab.roads.ledger.repaired}px)`);
      for (const row of lab.roads.inspect()) {
        lines.push(`  #${row.id} ${row.label} x ${row.left}-${row.right} ${row.progress} ${row.state}, ${row.cost} HM` +
          `${row.bridges ? `, ${row.bridges} px bridge` : ''}`);
      }
      if (lab.roads.breaks.size) lines.push(`  ${lab.roads.breaks.size} damaged road px awaiting repair`);
    }
    status.textContent = lines.join('\n');
    const events = [...mining.log, ...(lab.roads ? lab.roads.log : [])];
    logView.textContent = ['Events', ...events.slice(-24).map((entry) => `  ${entry.tick}: ${entry.text}`)].join('\n');
  }

  function advance(ticks) { for (let i = 0; i < ticks; i += 1) lab.step(); draw(); }
  function loop() {
    if (!running) return;
    advance(Number(document.getElementById('net-speed').value));
    requestAnimationFrame(loop);
  }
  function canvasPoint(event) {
    const box = canvas.getBoundingClientRect();
    return { x: Math.floor((event.clientX - box.left) * canvas.width / box.width),
      y: Math.floor((event.clientY - box.top) * canvas.height / box.height) };
  }
  function nearestAnchor(point, reach = 8) {
    let best = null, bestDistance = Infinity;
    for (const anchor of anchors()) {
      const d = Math.hypot(anchor.x - point.x, anchor.y - point.y);
      if (d < bestDistance) { best = anchor; bestDistance = d; }
    }
    return bestDistance <= reach ? best : null;
  }
  const tip = document.createElement('div');
  tip.style.cssText = 'position:absolute;pointer-events:none;display:none;padding:3px 7px;border-radius:4px;' +
    'font:12px system-ui;color:#fff;background:rgba(10,14,18,0.88);border:1px solid #5ae6ff;white-space:nowrap;z-index:5';
  document.body.appendChild(tip);
  let tipAt = null, previewQueued = false;
  function showTip() {
    if (modeSelect.value === 'road') { showRoadTip(); return; }
    if (!tipAt || !picked || !preview || modeSelect.value !== 'dig') { tip.style.display = 'none'; return; }
    const water = /water/.test(preview.problem || '') || /water/.test(preview.reason || '');
    const snapText = preview.snap && preview.snap.type === 'tunnel' ? `Snapped to tunnel #${preview.snap.segment}`
      : preview.snap && preview.snap.type === 'surface' ? 'Snapped to surface exit' : '';
    let text, border;
    if (!preview.ok) {
      text = `\u2716 ${water ? 'Water in the way - ' : ''}${preview.reason}`; border = '#f04a3c';
    } else if (preview.rerouted) {
      text = `\u26a0 ${water ? 'Water in the way' : preview.problem} - rerouted`; border = '#ffb84a';
    } else {
      text = '\u2714 Click to dig'; border = '#5af078';
    }
    tip.textContent = snapText ? `${text}  \u2022  ${snapText}` : text;
    tip.style.borderColor = border;
    tip.style.left = `${tipAt.x + 16}px`; tip.style.top = `${tipAt.y + 14}px`;
    tip.style.display = 'block';
  }
  function placeTip(text, border) {
    tip.textContent = text; tip.style.borderColor = border;
    tip.style.left = `${tipAt.x + 16}px`; tip.style.top = `${tipAt.y + 14}px`;
    tip.style.display = 'block';
  }
  const snapLabel = (s) => (!s ? '' : s.type === 'road' ? (!roadStart || roadStart === s ? `extends road #${s.road} from its ${s.end || 'end'}` : `joins road #${s.road} at its ${s.end || 'end'}`)
    : s.type === 'tunnel' ? 'enters a tunnel pass'
    : s.type === 'ground' ? 'on the ground' : 'no ground here');
  function showRoadTip() {
    if (!tipAt) { tip.style.display = 'none'; return; }
    if (!roadStart) {
      if (!roadHover || roadHover.type === 'none') { tip.style.display = 'none'; return; }
      placeTip(`Start road here (${snapLabel(roadHover)})`, roadHover.type === 'ground' ? '#cfd8dc' : '#5ae6ff');
      return;
    }
    const p = roadPreview;
    if (!p) { tip.style.display = 'none'; return; }
    if (!p.ok) { placeTip(`\u2716 ${p.reason}`, '#f04a3c'); return; }
    const parts = [`${p.columns.length} px`, `${p.cost} HM`];
    if (p.cut) parts.push(`cut ${p.cut}`);
    if (p.filled) parts.push(`fill ${p.filled}`);
    if (p.bridges) parts.push(`${bridgeStyle() || roadOptions.styleOf('blue')} bridge ${p.bridges}`);
    if (p.hatches) parts.push(`hatch over ${p.hatches} px tunnel mouth`);
    if (p.tunnel) parts.push(`${p.tunnel} px through tunnels`);
    const ramp = p.grade > 0.5 ? `  \u26a0 steep ramps 1:${Math.max(1, Math.round(1 / p.grade))}` : '';
    placeTip(`\u2714 Click to build road (${parts.join(', ')})${ramp}  \u2022  ${snapLabel(p.to)}`, ramp ? '#ffb84a' : '#5af078');
  }
  function bridgeStyle() {
    const value = document.getElementById('net-bridge-style').value;
    return value === 'auto' ? undefined : value;
  }
  function updateRoadPreview(point) {
    roadPreview = null;
    if (!roadStart || !lab.roads) return;
    roadPreview = lab.roads.routeRoad(roadStart, point, { owner: 'blue', label: `blue road ${lab.roads.roads.length}`, style: bridgeStyle() });
    notice.textContent = roadPreview.ok ? `Valid road: ${roadPreview.columns.length} px, ${roadPreview.cost} HM. Click to build.`
      : `Invalid road: ${roadPreview.reason}`;
  }
  function cancelRoad(message) {
    roadStart = null; roadPreview = null; tip.style.display = 'none';
    if (message) notice.textContent = message;
    draw();
  }
  function hazardsOf(spec) {
    const cells = [], seen = new Set(), r = lab.network.radius + 1;
    if (!spec) return cells;
    let line;
    try { line = lab.network.centerline(spec.points); } catch (error) { return cells; }
    for (const c of line) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const x = c.x + dx, y = c.y + dy, k = y * lab.world.width + x;
          if (!inside(x, y) || seen.has(k)) continue;
          seen.add(k);
          const m = lab.world.at(x, y);
          if (m === PARTICLE_WATER || m === PARTICLE_BARRIER || m === PARTICLE_CONSTRUCTION) cells.push({ x, y });
        }
      }
    }
    return cells;
  }
  function updatePreview(point) {
    preview = null;
    if (!picked) return;
    const result = lab.network.routeDig(picked, point, { owner: 'blue', label: `dug to (${point.x}, ${point.y})` });
    if (!result.spec) { notice.textContent = 'Move the target away from the start.'; return; }
    let line = [];
    try { line = lab.network.centerline(result.spec.points); } catch (error) { /* invalid geometry stays red */ }
    preview = { ...result, line, hazards: hazardsOf(result.directSpec || result.spec) };
    notice.textContent = result.ok
      ? `${result.rerouted ? `Rerouted around: ${result.problem}. ` : ''}Valid route (${result.spec.points.length - 1} leg(s)); click to dig.`
      : `Invalid: ${result.reason}`;
  }
  function queuePreview() {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => {
      previewQueued = false;
      if (picked && mouse) updatePreview(mouse);
      showTip();
      if (!running) draw();
    });
  }
  function animateSnap() {
    if (!picked) return;
    if (!running && preview && preview.snap && preview.snap.type !== 'free') draw();
    setTimeout(() => requestAnimationFrame(animateSnap), 90);
  }
  function animateRoad() {
    if (!roadStart || modeSelect.value !== 'road') return;
    if (!running) draw();
    setTimeout(() => requestAnimationFrame(animateRoad), 90);
  }
  function cancelDig(message) {
    picked = null; preview = null; tip.style.display = 'none';
    if (message) notice.textContent = message;
    draw();
  }

  canvas.addEventListener('mousemove', (event) => {
    if (modeSelect.value === 'road') {
      mouse = canvasPoint(event);
      tipAt = { x: event.pageX, y: event.pageY };
      if (lab.roads) {
        if (roadStart) updateRoadPreview(mouse);
        else roadHover = lab.roads.snapPoint(mouse);
      }
      showTip();
      if (!running) draw();
      return;
    }
    if (modeSelect.value !== 'dig') return;
    mouse = canvasPoint(event);
    tipAt = { x: event.pageX, y: event.pageY };
    if (picked) { queuePreview(); return; }
    const near = nearestAnchor(mouse);
    hovered = near ? anchors().filter((a) => a.type === near.type && (a.type === 'surface' || a.segment === near.segment) &&
      Math.max(Math.abs(a.x - near.x), Math.abs(a.y - near.y)) <= 2) : [];
    if (!running) draw();
  });
  canvas.addEventListener('mouseleave', () => { hovered = []; roadHover = null; tipAt = null; showTip(); if (!running) draw(); });
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (picked) cancelDig('Dig cancelled.');
    if (roadStart) cancelRoad('Road cancelled.');
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (picked) cancelDig('Dig cancelled.');
    if (roadStart) cancelRoad('Road cancelled.');
  });
  modeSelect.addEventListener('change', () => { roadStart = null; roadPreview = null; roadHover = null; cancelDig(''); });

  canvas.addEventListener('click', (event) => {
    if (dragged) { dragged = false; return; }
    const point = canvasPoint(event);
    if (modeSelect.value === 'road') {
      tipAt = { x: event.pageX, y: event.pageY };
      if (!lab.roads) { notice.textContent = 'Roads are unavailable in this world.'; return; }
      if (!roadStart) {
        const start = lab.roads.snapPoint(point);
        if (start.type === 'none') { notice.textContent = 'Start a road on solid ground, a road end or a tunnel pass.'; return; }
        roadStart = start; roadHover = null;
        notice.textContent = `Road from (${start.x}, ${start.y}) - ${snapLabel(start)}; click an end point (right-click or Esc cancels).`;
        updateRoadPreview(point); showTip(); animateRoad(); draw();
        return;
      }
      updateRoadPreview(point);
      if (!roadPreview || !roadPreview.ok) { showTip(); draw(); return; }
      const result = lab.roads.plan(roadPreview.spec);
      cancelRoad(result.ok ? `Road planned: ${result.columns.length} px, paving one column every ${lab.roads.settings.buildTicks} ticks.`
        : `Rejected: ${result.reason}`);
      return;
    }
    if (modeSelect.value === 'blast') {
      lab.world.blast(point.x, point.y, 4);
      notice.textContent = `Blast at (${point.x}, ${point.y}).`;
    } else if (!picked) {
      const anchor = nearestAnchor(point);
      if (!anchor) { notice.textContent = 'Click near the glowing surface line or a tunnel outer wall.'; return; }
      picked = anchor; hovered = [];
      notice.textContent = `Digging from the ${anchor.type === 'surface' ? 'surface' : 'tunnel wall'} at (${anchor.x}, ${anchor.y}); ` +
        'click a target (right-click or Esc cancels).';
      tipAt = { x: event.pageX, y: event.pageY };
      updatePreview(point); showTip(); animateSnap();
    } else {
      if (!preview || mouse === null || mouse.x !== point.x || mouse.y !== point.y) updatePreview(point);
      if (!preview || !preview.ok) { showTip(); draw(); return; }
      const result = lab.network.plan(preview.spec);
      cancelDig(result.ok ? `Tunnel planned with ${result.segment.steps.length} steps.` : `Rejected: ${result.reason}`);
      return;
    }
    draw();
  });

  // ---------- View: wheel zoom toward the mouse, drag to pan (CSS transform, so canvasPoint stays exact) ----------
  const viewBox = document.getElementById('net-view');
  const zoomLabel = document.getElementById('net-zoom');
  const view = { s: 1, x: 0, y: 0 };
  let pan = null, dragged = false;
  function applyView() {
    const w = viewBox.clientWidth, h = viewBox.clientHeight;
    view.s = Math.max(1, Math.min(12, view.s));
    view.x = Math.min(0, Math.max(w - w * view.s, view.x));
    view.y = Math.min(0, Math.max(h - h * view.s, view.y));
    canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    if (zoomLabel) zoomLabel.textContent = `${view.s.toFixed(1)}x`;
  }
  function resetView() { view.s = 1; view.x = 0; view.y = 0; applyView(); }
  viewBox.addEventListener('wheel', (event) => {
    event.preventDefault();
    const box = viewBox.getBoundingClientRect();
    const mx = event.clientX - box.left, my = event.clientY - box.top;
    const next = Math.max(1, Math.min(12, view.s * Math.exp(-event.deltaY * 0.0015)));
    view.x = mx - (mx - view.x) * next / view.s;
    view.y = my - (my - view.y) * next / view.s;
    view.s = next;
    applyView();
  }, { passive: false });
  viewBox.addEventListener('mousedown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault();
    pan = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
    dragged = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!pan) return;
    const dx = event.clientX - pan.x, dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true;
    viewBox.classList.add('panning');
    view.x = pan.vx + dx; view.y = pan.vy + dy;
    applyView();
  });
  window.addEventListener('mouseup', () => {
    if (!pan) return;
    dragged = pan.moved;
    pan = null;
    viewBox.classList.remove('panning');
    // A drag that ends off the canvas fires no click, so don't let it swallow the next real click.
    setTimeout(() => { dragged = false; }, 0);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === '0' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) resetView();
  });
  window.addEventListener('resize', applyView);
  document.getElementById('net-view-reset').addEventListener('click', resetView);

  document.getElementById('net-regen').addEventListener('click', regenerate);
  // ---------- Bridge style sheet: the same road planner and renderer on small river worlds ----------
  function bridgeDemo(style, span, seed) {
    const W = span + 64, H = 76, ground = 38, bed = ground + 14;
    const world = createParticleWorld(W, H);
    for (let x = 0; x < W; x += 1) {
      const inRiver = x >= 32 && x < 32 + span, bank = Math.min(x - 32, 31 + span - x);
      const floor = inRiver ? bed - Math.max(0, 3 - bank) * 3 : ground + Math.round(Math.sin((x + seed) / 7));
      for (let y = floor; y < H; y += 1) world.set(x, y, PARTICLE_TERRAIN);
      if (inRiver) for (let y = ground + 3; y < floor; y += 1) world.set(x, y, PARTICLE_WATER);
    }
    const water = world.waterCount;
    const network = createPixelTunnelNetwork(world);
    const roads = createPixelSurfaceRoads(world, { network, styleOf: () => style });
    const plan = roads.plan({ owner: 'blue', from: { x: 6 }, to: { x: W - 7 }, label: `${style} bridge` });
    if (plan.ok) roads.buildNow(plan.road);
    const surface = Array.from({ length: W }, (_, x) => world.surfaceRow(x));
    return { world, network, roads, plan, surface, water, buildings: [], ticks: 0 };
  }
  function renderBridgeSheet() {
    const host = document.getElementById('net-bridges');
    if (!host || typeof createPixelSurfaceRoads !== 'function') return;
    host.textContent = '';
    const saved = { lab, pixels, pw, ph, horizon };
    try {
      for (const style of PIXEL_BRIDGE_STYLES) {
        const row = document.createElement('div');
        row.className = 'bridge-row';
        const title = document.createElement('h3');
        title.textContent = style[0].toUpperCase() + style.slice(1);
        row.appendChild(title);
        for (const span of [72, 20]) {
          const demo = bridgeDemo(style, span, style.length);
          const { world } = demo, figure = document.createElement('figure'), view = document.createElement('canvas');
          view.width = world.width; view.height = world.height;
          view.style.width = `${world.width * 3}px`; view.style.imageRendering = 'pixelated';
          const img = view.getContext('2d').createImageData(world.width, world.height);
          lab = demo; pixels = new Uint32Array(img.data.buffer); pw = world.width; ph = world.height;
          horizon = demo.surface.reduce((s, v) => s + v, 0) / world.width;
          for (let y = 0; y < world.height; y += 1) {
            for (let x = 0; x < world.width; x += 1) pixels[y * pw + x] = baseColor(x, y, world.at(x, y), demo.surface[x], 0);
          }
          drawRoads();
          view.getContext('2d').putImageData(img, 0, 0);
          const parts = {};
          if (demo.plan.ok) for (const cell of demo.roads.bridgeDecor(demo.plan.road)) parts[cell.part] = (parts[cell.part] || 0) + 1;
          const caption = document.createElement('figcaption');
          caption.textContent = demo.plan.ok
            ? `${span}px river · deck ${demo.plan.bridges}px · ${Object.entries(parts).map(([k, v]) => `${k} ${v}`).join(', ')} · water ${world.waterCount === demo.water ? 'untouched' : 'CHANGED'}`
            : `failed: ${demo.plan.reason}`;
          figure.append(view, caption);
          row.appendChild(figure);
        }
        host.appendChild(row);
      }
    } finally {
      ({ lab, pixels, pw, ph, horizon } = saved);
    }
  }
  document.getElementById('net-bridge-style').addEventListener('change', () => { if (roadStart && mouse) updateRoadPreview(mouse); draw(); });
  document.getElementById('net-step').addEventListener('click', () => advance(60));
  document.getElementById('net-run').addEventListener('click', (event) => {
    running = !running;
    event.target.textContent = running ? 'Pause' : 'Run';
    if (running) loop();
  });
  document.getElementById('net-checks').addEventListener('click', () => {
    const results = document.getElementById('net-results');
    results.textContent = 'Running...';
    setTimeout(() => { results.textContent = runPixelTunnelNetworkChecks().join('\n'); }, 20);
  });
  regenerate();
  renderBridgeSheet();
  const preset = Number(new URLSearchParams(location.search).get('ticks'));
  if (Number.isInteger(preset) && preset > 0) advance(Math.min(preset, 20000));
  window.pixelTunnelNetworkLab = {
    get lab() { return lab; }, regenerate, advance, draw, anchors,
    pick(x, y) { picked = nearestAnchor({ x, y }); return picked; },
    target(x, y) {
      updatePreview({ x, y });
      return preview && { ok: preview.ok, rerouted: !!preview.rerouted, problem: preview.problem || null,
        snap: preview.snap && preview.snap.type, hazards: preview.hazards.length, notice: notice.textContent };
    },
    commit() { const result = preview && preview.ok ? lab.network.plan(preview.spec) : null; cancelDig(''); return result; },
    road(fromX, fromY, toX, toY, build = false) {
      roadStart = lab.roads.snapPoint({ x: fromX, y: fromY });
      updateRoadPreview({ x: toX, y: toY });
      const p = roadPreview, summary = p && { ok: p.ok, reason: p.reason, from: p.from && p.from.type, to: p.to && p.to.type,
        cost: p.cost, bridges: p.bridges, tunnel: p.tunnel, grade: p.grade, notice: notice.textContent };
      if (build && p && p.ok) { const result = lab.roads.plan(p.spec); summary.built = result.ok; roadStart = null; roadPreview = null; }
      draw();
      return summary;
    },
  };
})();
