'use strict';
// Stamping building canvases into the world, and a flat gallery world for inspecting buildings.
(function () {
  const PW = window.PW;
  const { M } = PW;

  // Write a building canvas into the world with its ground row on world row `groundY`.
  // Cells with a back colour are open space (interiors above ground, the bunker pit below it), so
  // any terrain there is carved out; other cells below the ground keep their soil unless the
  // building has structure there (buried cores). Every written cell gets the owner id.
  function stampBuilding(world, canvas, worldX, groundY, options = {}) {
    const ox = Math.round(worldX), oy = Math.round(groundY - canvas.ground);
    const { width, height } = canvas;
    const owner = options.owner || 0;
    const quiet = { quiet: true, keepPaint: true };
    for (let y = 0; y < height; y += 1) {
      const wy = oy + y;
      if (wy < 0 || wy >= world.height) continue;
      for (let x = 0; x < width; x += 1) {
        const wx = ox + x;
        if (wx < 0 || wx >= world.width) continue;
        const i = y * width + x;
        const mat = canvas.mat[i];
        const any = mat || canvas.back[i] || canvas.deco[i];
        if (!any) continue;
        if (mat) {
          PW.set(world, wx, wy, mat, quiet);
          PW.setLayer(world, 'paint', wx, wy, canvas.paint[i]);
        } else if (canvas.back[i]) {
          const current = world.mat[wy * world.width + wx] & 63;
          if (current !== M.AIR && current !== M.WATER) PW.set(world, wx, wy, M.AIR, quiet);
        }
        if (canvas.back[i]) PW.setLayer(world, 'back', wx, wy, canvas.back[i]);
        // Building deco replaces wild deco (grass) in the same cell.
        if (canvas.deco[i] || mat) PW.setLayer(world, 'deco', wx, wy, canvas.deco[i]);
        if (owner) PW.setOwner(world, wx, wy, owner);
      }
    }
    return { x: ox, y: oy, width, height, canvas };
  }

  // World-space copy of a stamped canvas's metadata (floors, stairs, doors, slots, panels...).
  function buildingRecord(world, stamp, info) {
    const { canvas, x: ox, y: oy } = stamp;
    const pt = (p) => ({ ...p, x: p.x + ox, y: p.y + oy });
    const box = (b) => b && { left: b.left + ox, right: b.right + ox, top: b.top + oy, bottom: b.bottom + oy };
    const record = {
      ...info,
      canvas, ox, oy,
      ground: canvas.ground + oy,
      body: box(canvas.body),
      floors: canvas.floors.map((f) => ({ ...f, y: f.y + oy, left: f.left + ox, right: f.right + ox })),
      stairs: canvas.stairs.map((s) => ({ ...s, from: s.from + ox, to: s.to + ox, floorRow: s.floorRow + oy, upperRow: s.upperRow + oy })),
      doors: canvas.doors.map((d) => ({ ...d, x: d.x + ox, top: d.top + oy, bottom: d.bottom + oy })),
      slots: canvas.slots.map(pt), panels: canvas.panels.map(pt), cores: canvas.cores.map(pt),
      devices: canvas.devices.map(pt), windows: canvas.windows.map(pt), storage: (canvas.storage || []).map(pt),
      hangar: canvas.hangar && { ...box(canvas.hangar), door: { x: canvas.hangar.door.x + ox, top: canvas.hangar.door.top + oy, bottom: canvas.hangar.door.bottom + oy },
        spawn: pt(canvas.hangar.spawn) },
      runway: canvas.runway && { ...canvas.runway, from: canvas.runway.from + ox, y: canvas.runway.y + oy },
      shaft: canvas.shaft && { x: canvas.shaft.x + ox, top: canvas.shaft.top + oy },
      pit: canvas.pit && { left: canvas.pit.left + ox, right: canvas.pit.right + ox, depth: canvas.pit.depth },
      floating: box(canvas.floating),
      health: 1,
    };
    return record;
  }

  // Flat world strip for the building gallery.
  function flattenStrip(world, x0, x1, groundY) {
    const { mat, width: W, height: H } = world;
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
      for (let y = 0; y < H; y += 1) {
        let id;
        if (y < groundY) id = M.AIR;
        else if (y < groundY + 3) id = M.GRASS;
        else if (y < groundY + 16) id = M.TOPSOIL;
        else if (y < groundY + 260) id = M.SOIL;
        else if (y < H - 26) id = M.STONE;
        else id = M.BEDROCK;
        mat[y * W + x] = id | (PW.hash2(x >> 3, y >> 3) & 3) << 6;
      }
    }
  }

  function generateGallery(world, seed, set = 'population') {
    const groundY = 1500;
    flattenStrip(world, 0, world.width, groundY);
    world.surface0 = new Int32Array(world.width).fill(groundY);
    PW.rebuildGroundTop(world);
    const placed = [];
    let x = 160;
    const styles = ['asian', 'gothic', 'modern'];
    const row = (y, kinds) => {
      x = 160;
      for (const style of styles) {
        for (const kind of kinds) {
          const canvas = kind.make(style);
          placed.push({ ...stampBuilding(world, canvas, x, y), style, kind: kind.name });
          x += canvas.width + 50;
        }
        x += 160;
      }
    };
    const T = PW.buildingTypes;
    if (set === 'mirror') {
      // Each design facing right, then mirrored facing left, to compare the pairs.
      const pairs = [
        ['population-offset', (style, f) => T.population({ style, level: 5, variant: 'offset', seed: seed + 3, facing: f })],
        ['population-crown', (style, f) => T.population({ style, level: 4, variant: 'crown', seed: seed + 5, facing: f })],
        ['military-fortress', (style, f) => T.military({ style, level: 4, variant: 'fortress', seed: seed + 7, facing: f })],
        ['farm-silos', (style, f) => T.farm({ style, level: 5, variant: 'silos', seed: seed + 11, facing: f })],
        ['farm-greenhouse', (style, f) => T.farm({ style, level: 3, variant: 'greenhouse', seed: seed + 13, facing: f })],
        ['mine', (style, f) => T.mine({ style, facing: f, seed })],
      ];
      row(groundY, pairs.flatMap(([name, make]) => [1, -1].map((f) => ({ name: `${name}${f > 0 ? '' : '-mirrored'}`, make: (style) => make(style, f) }))));
    } else if (set === 'military') {
      row(groundY, [...PW.MILITARY_VARIANTS.map((variant, index) => ({ name: `military-${variant}`,
        make: (style) => T.military({ style, level: 3 + index % 3, variant, seed: seed + index * 17, facing: 1 }) })),
      { name: 'core', make: (style) => T.core({ style, facing: 1 }) }]);
    } else if (set === 'farm') {
      row(groundY, [...PW.FARM_VARIANTS.map((variant, index) => ({ name: `farm-${variant}`,
        make: (style) => T.farm({ style, level: 2 + index, variant, seed: seed + index * 13, facing: 1 }) })),
      { name: 'mine', make: (style) => T.mine({ style, facing: 1, seed }) }]);
    } else {
      row(groundY, PW.POPULATION_VARIANTS.map((variant, index) => ({ name: `population-${variant}`,
        make: (style) => T.population({ style, level: 1 + index % 7, variant, seed: seed + index * 31, facing: 1 }) })));
    }
    PW.rebuildGroundTop(world);
    world.gallery = placed;
    return { placed, groundY, sites: [], lakes: [], mountains: [], nodes: [], caves: [], baseY: groundY };
  }

  PW.stampBuilding = stampBuilding;
  PW.buildingRecord = buildingRecord;
  PW.flattenStrip = flattenStrip;
  PW.generateGallery = generateGallery;
})();
