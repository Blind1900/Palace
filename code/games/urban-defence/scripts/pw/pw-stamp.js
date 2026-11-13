'use strict';
// Stamping building canvases into the world, and a flat gallery world for inspecting buildings.
(function () {
  const PW = window.PW;
  const { M } = PW;

  // Write a building canvas into the world with its ground row on world row `groundY`.
  // Interior air above the ground replaces any terrain; cells below the ground keep the soil
  // except where the building has structure (buried cores).
  function stampBuilding(world, canvas, worldX, groundY, options = {}) {
    const ox = Math.round(worldX), oy = Math.round(groundY - canvas.ground);
    const { width, height } = canvas;
    const quiet = { quiet: true, keepPaint: true };
    for (let y = 0; y < height; y += 1) {
      const wy = oy + y;
      if (wy < 0 || wy >= world.height) continue;
      for (let x = 0; x < width; x += 1) {
        const wx = ox + x;
        if (wx < 0 || wx >= world.width) continue;
        const i = y * width + x;
        const mat = canvas.mat[i];
        if (mat) {
          PW.set(world, wx, wy, mat, quiet);
          PW.setLayer(world, 'paint', wx, wy, canvas.paint[i]);
        } else if (canvas.back[i] && y < canvas.ground) {
          const current = world.mat[wy * world.width + wx] & 63;
          if (current !== M.AIR && current !== M.WATER) PW.set(world, wx, wy, M.AIR, quiet);
        }
        if (canvas.back[i]) PW.setLayer(world, 'back', wx, wy, canvas.back[i]);
        if (canvas.deco[i]) PW.setLayer(world, 'deco', wx, wy, canvas.deco[i]);
      }
    }
    return { x: ox, y: oy, width, height, canvas };
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
    if (set === 'military') {
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
  PW.flattenStrip = flattenStrip;
  PW.generateGallery = generateGallery;
})();
