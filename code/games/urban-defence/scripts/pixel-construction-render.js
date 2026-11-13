const PIXEL_FARM_STORAGE_COLORS = Object.freeze({ structure: '#8bc6d6', food: '#d6a953' });
// Matches PIXEL_CORE_COLOR [255,164,20] in pixel-building-devices.js, which this renderer's pages do not load.
const PIXEL_CORE_CSS = '#ffa414';

function createPixelConstructionRenderer(canvas, width = 160, height = 90) {
  const ctx = canvas.getContext('2d');
  const pixels = document.createElement('canvas');
  pixels.width = width; pixels.height = height;
  const pixelContext = pixels.getContext('2d');
  const image = pixelContext.createImageData(pixels.width, pixels.height);
  const raster = new Uint8Array(width * height);
  const rgba = new Uint32Array(image.data.buffer);
  const colors = [[2, 2, 2], [2, 2, 2], [31, 172, 200],
    [188, 231, 123], [196, 144, 89], [239, 249, 177], [191, 123, 25]];
  const pack = (color) => new Uint32Array(Uint8Array.from([...color, 255]).buffer)[0];
  const palette = colors.map(pack), surfaceColor = pack([63, 193, 95]);
  let surfaceRevision = -1, surface = null, surfaceWorld = null;
  // Integer-scale frames reuse a cached terrain/structure layer and repaint changed cells only.
  let base = null, baseContext = null, baseWorld = null;
  // Optional device-pixel rectangle that is actually on screen; frames clip all painting to it.
  let view = null, clipped = false;
  const drawn = new Uint32Array(width * height), materials = new Uint8Array(width * height);
  const rasterWords = new Uint32Array(raster.buffer, 0, raster.length >> 2);
  const materialWords = new Uint32Array(materials.buffer, 0, materials.length >> 2);
  const cssCache = new Map();
  const cssColor = (packed) => {
    if (!cssCache.has(packed)) {
      const [r, g, b] = new Uint8Array(Uint32Array.of(packed).buffer);
      cssCache.set(packed, `rgb(${r},${g},${b})`);
    }
    return cssCache.get(packed);
  };
  const baseLayer = (world) => {
    if (!base) { base = document.createElement('canvas'); baseContext = base.getContext('2d'); }
    base.width = canvas.width; base.height = canvas.height; baseWorld = world;
    return baseContext;
  };
  const visibleSize = (scale) => scale >= 4 ? scale - 1 : scale;
  // Core cells and plans only grow together, so per-building shapes are reused until the plan grows.
  const architectureShapes = new WeakMap();
  // Load overlays given as flat [color, x, y, w, h] ops keep one cached path per color (in first-use order),
  // rebuilt only when the ops change. Load cells never overlap, so this matches painting the rects one by one.
  const loadsPaths = { ops: null, paths: null };
  const economyPaths = { source: null, scale: 0, scaled: null, cache: null };
  const militarySprites = new Map();
  const fillOpsByColor = (cache, ops) => {
    let same = cache.ops && cache.ops.length === ops.length;
    for (let index = 0; same && index < ops.length; index += 1) same = ops[index] === cache.ops[index];
    if (!same) {
      cache.paths = new Map();
      for (let index = 0; index < ops.length; index += 5) {
        let path = cache.paths.get(ops[index]);
        if (!path) { path = new Path2D(); cache.paths.set(ops[index], path); }
        path.rect(ops[index + 1], ops[index + 2], ops[index + 3], ops[index + 4]);
      }
      cache.ops = ops;
    }
    for (const [color, path] of cache.paths) { ctx.fillStyle = color; ctx.fill(path); }
  };
  const architectureLayer = { canvas: null, context: null, batch: new Map(), size: 0, bounds: null };
  // Opaque sprites whose detail rects land on whole device pixels are rasterized once and blitted 1:1,
  // which reproduces the per-detail fillRect output exactly. Anything else falls back to direct painting.
  const spriteCache = new Map();
  let spriteFlat = new Float64Array(4096);
  const drawCachedSprite = (unit, scale, groundOffset, snap) => {
    let ox = unit.x * scale, oy = (unit.y + groundOffset) * scale;
    // Snapping only moves the drawn sprite to the nearest device pixel; physics positions are untouched.
    if (snap && Number.isInteger(scale)) { ox = Math.round(ox); oy = Math.round(oy); }
    if (!Number.isInteger(scale) || !Number.isInteger(ox) || !Number.isInteger(oy)) return false;
    let length = 0, hash = 2166136261;
    const mix = (value) => { hash = Math.imul(hash ^ (value | 0), 16777619); };
    for (const pixel of unit.pixels) {
      const details = pixel.details;
      const count = details ? details.length : 1;
      for (let index = 0; index < count; index += 1) {
        const detail = details ? details[index] : null;
        const x = (pixel.x + (detail ? detail.x : 0)) * scale, y = (pixel.y + (detail ? detail.y : 0)) * scale;
        const size = (detail ? detail.size : 1) * scale, color = (detail ? detail.color : pixel.color) >>> 0;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(size) || color >>> 24 !== 255) return false;
        if (length + 4 > spriteFlat.length) {
          const grown = new Float64Array(spriteFlat.length * 2); grown.set(spriteFlat); spriteFlat = grown;
        }
        spriteFlat[length] = x; spriteFlat[length + 1] = y; spriteFlat[length + 2] = size; spriteFlat[length + 3] = color;
        length += 4; mix(x); mix(y); mix(size); mix(color);
      }
    }
    const key = `${hash >>> 0}:${length}:${unit.tintColor || ''}:${Boolean(unit.hitFlash)}`;
    let entry = spriteCache.get(key);
    if (entry) {
      for (let index = 0; index < length; index += 1) {
        if (entry.flat[index] !== spriteFlat[index]) { entry = null; break; }
      }
    }
    if (!entry) {
      if (spriteCache.size >= 512) spriteCache.clear();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let index = 0; index < length; index += 4) {
        minX = Math.min(minX, spriteFlat[index]); minY = Math.min(minY, spriteFlat[index + 1]);
        maxX = Math.max(maxX, spriteFlat[index] + spriteFlat[index + 2]);
        maxY = Math.max(maxY, spriteFlat[index + 1] + spriteFlat[index + 2]);
      }
      entry = { flat: spriteFlat.slice(0, length), canvas: null, x: 0, y: 0 };
      if (length) {
        const sprite = document.createElement('canvas');
        sprite.width = maxX - minX; sprite.height = maxY - minY;
        const context = sprite.getContext('2d');
        for (let index = 0; index < length; index += 4) {
          const rgb = spriteFlat[index + 3] & 0xffffff;
          context.fillStyle = unit.hitFlash ? '#ff3535' : rgb === 0 && unit.tintColor ? unit.tintColor : `#${rgb.toString(16).padStart(6, '0')}`;
          context.fillRect(spriteFlat[index] - minX, spriteFlat[index + 1] - minY, spriteFlat[index + 2], spriteFlat[index + 2]);
        }
        entry.canvas = sprite; entry.x = minX; entry.y = minY;
      }
      spriteCache.set(key, entry);
    }
    if (entry.canvas) ctx.drawImage(entry.canvas, ox + entry.x, oy + entry.y);
    return true;
  };
  // Style-lab facade colours (pixel-map-construction.js pixelSiteFacade), pulled 30% toward the team colour
  // so factions stay readable. Memoised per owner and colour.
  const facadeTints = new Map();
  const teamTint = (hex, team) => {
    const memo = `${team}${hex}`;
    let color = facadeTints.get(memo);
    if (!color) {
      const a = parseInt(hex.slice(1), 16), b = parseInt(team.slice(1), 16);
      const mix = (shift) => Math.round(((a >> shift) & 255) * 0.7 + ((b >> shift) & 255) * 0.3);
      color = `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0')}`;
      facadeTints.set(memo, color);
    }
    return color;
  };
  const facadeColor = (facade, cell, palette) => {
    const side = facade.side.get(cell);
    if (side) return side;
    if (facade.doors.has(cell)) return palette[1];
    if (facade.stairs.has(cell)) return teamTint('#2a333a', palette[0]);
    const wall = facade.wall.get(cell);
    return wall ? teamTint(wall, palette[0]) : null;
  };
  const architectureShape = (entry) => {
    const plan = entry.scenario.plan;
    let cached = architectureShapes.get(entry);
    if (!cached || cached.plan !== plan || cached.length !== plan.length) {
      let roof = Infinity, left = Infinity, right = -Infinity;
      for (const cell of plan) {
        if (cell.y < roof) roof = cell.y;
        if (cell.x < left) left = cell.x;
        if (cell.x > right) right = cell.x;
      }
      cached = { plan, length: plan.length, roof, left, right,
        core: new Set(entry.scenario.inspectCore().cells.map((cell) => cell.y * width + cell.x)) };
      architectureShapes.set(entry, cached);
    }
    return cached;
  };
  return {
    get pixelSize() { return visibleSize(canvas.width / pixels.width); },
    markBuildingSupplies(entries, supply) {
      if (!supply) return;
      const scale = canvas.width / pixels.width, size = visibleSize(scale);
      for (const storage of supply.buildings) {
        const entry = entries[storage.index], world = entry.scenario.world;
        const left = Math.min(...entry.seedPlacement.map((cell) => cell.x)) + 4;
        const right = Math.max(...entry.seedPlacement.map((cell) => cell.x)) - 3;
        const y = entry.seedPlacement[0].groundY - 2;
        const room = [];
        for (let x = left; x <= right && room.length < 12; x += 1) {
          if (world.at(x, y) === PARTICLE_EMPTY) room.push({ x, y });
        }
        const split = Math.ceil(room.length / 2);
        for (const [index, cell] of room.entries()) {
          const food = index < split, offset = food ? index : index - split;
          const capacity = food ? split : room.length - split;
          const fill = food ? storage.sm / storage.capacity : storage.hm / storage.hmCapacity;
          ctx.fillStyle = offset < Math.ceil(fill * capacity) ? food ? '#d6a953' : '#a7c6ff' : '#38434a';
          ctx.fillRect(cell.x * scale, cell.y * scale, size, size);
        }
        if (storage.dock) {
          ctx.strokeStyle = storage.supplied ? '#8bc6d6' : '#ed795e';
          ctx.strokeRect(storage.dock.x * scale, storage.dock.y * scale, scale, scale);
        }
      }
      ctx.fillStyle = '#f6cc68';
      for (const agent of supply.transporters) ctx.fillRect(agent.x * scale, agent.y * scale, size, size);
    },
    markProjectileTrails(trails) {
      const scale = canvas.width / pixels.width;
      ctx.save();
      ctx.scale(scale, scale);
      drawPixelProjectileTrails(ctx, trails);
      ctx.restore();
    },
    markUnitDeathEffects(particles, effects = {}) {
      const scale = canvas.width / pixels.width;
      ctx.save(); ctx.scale(scale, scale);
      drawPixelUnitDeathEffects(ctx, particles, effects);
      ctx.restore();
    },
    markBuildingFacades(world, layers) {
      const scale = canvas.width / pixels.width;
      ctx.save(); ctx.scale(scale, scale);
      drawPixelBuildingFacades(ctx, world, layers);
      ctx.restore();
    },
    markArchitecture(entries, styles) {
      const scale = canvas.width / pixels.width, size = visibleSize(scale);
      const palettes = { left: ['#536d86', '#58a6ff'], right: ['#865660', '#ef6473'],
        neutral: ['#747d70', '#bac5aa'] };
      // Integer cells can share one path fill per color without changing any pixel.
      const batch = Number.isInteger(scale) ? new Map() : null;
      const paint = (color, x, y) => {
        if (!batch) { ctx.fillStyle = color; ctx.fillRect(x * scale, y * scale, size, size); return; }
        if (!batch.has(color)) batch.set(color, []);
        batch.get(color).push(x * scale, y * scale);
      };
      // Plan cells (settled barrier) and bay cells (empty) never overlap, so one global batch is order-independent.
      const flush = () => {};
      for (const entry of entries) {
        const owner = entry.building.owner, style = entry.building.style || styles[owner], palette = palettes[owner];
        if (!palette || !['asian', 'gothic', 'modern'].includes(style)) throw new Error('Invalid building team or architecture style');
        const world = entry.scenario.world;
        const { core, roof, left, right } = architectureShape(entry);
        const floorHeight = entry.building.floorHeight || 4, facade = entry.building.facade;
        for (const cell of entry.scenario.plan) {
          if (core.has(cell.y * width + cell.x) || cell.y >= entry.seedPlacement[0].groundY ||
              entry.scenario.world.at(cell.x, cell.y) !== PARTICLE_BARRIER) continue;
          const styled = facade && facadeColor(facade, cell.y * width + cell.x, palette);
          if (styled) { paint(styled, cell.x, cell.y); continue; }
          const accent = style === 'asian' ? cell.y <= roof + 2 || (cell.y - roof) % floorHeight === 0 :
            style === 'gothic' ? (cell.x - left) % 8 === 0 || cell.y <= roof + 3 :
              (cell.y - roof) % floorHeight === 0 || cell.x === right;
          paint(palette[accent ? 1 : 0], cell.x, cell.y);
        }
        if (!entry.scenario.finished || entry.scenario.coreDestroyed) { flush(); continue; }
        if (facade && facade.shaped) {
          // Back-wall windows stay only while the storey floor under them stands.
          for (const cell of facade.back) {
            if (world.at(cell.x, cell.y) === PARTICLE_EMPTY && world.at(cell.x, cell.floorY) === PARTICLE_BARRIER) paint(cell.color, cell.x, cell.y);
          }
          flush(); continue;
        }
        const poles = entry.building.poles || [left, right - 2];
        for (let bay = 0; bay < poles.length - 1; bay += 1) {
          const start = poles[bay] + 2, end = poles[bay + 1];
          const center = Math.floor((start + end) / 2);
          for (let y = roof + floorHeight + 2; y < entry.seedPlacement[0].groundY - 4; y += floorHeight) {
            if (world.at(poles[bay] + 1, y - 2) !== PARTICLE_BARRIER ||
                world.at(poles[bay + 1] + 1, y - 2) !== PARTICLE_BARRIER) continue;
            for (let x = start; x <= end; x += 1) for (let dy = 0; dy < 3; dy += 1) {
              if (style === 'gothic' && (Math.abs(x - center) > 1 || dy === 0 && x !== center) ||
                  style === 'modern' && dy > 1) continue;
              if (world.at(x, y + dy) !== PARTICLE_EMPTY) continue;
              const accent = style === 'asian' ? dy === 1 || (x - start) % 2 === 0 :
                style === 'gothic' ? x === center : dy === 0;
              paint(accent ? palette[1] : '#26313b', x, y + dy);
            }
          }
        }
        flush();
      }
      if (!batch) return;
      // Reuse the previous raster when the painted cell list is unchanged; drawImage at 1:1 integer offsets is exact.
      const cache = architectureLayer;
      let same = cache.canvas && cache.canvas.width === canvas.width && cache.canvas.height === canvas.height &&
        cache.size === size && cache.batch.size === batch.size;
      if (same) {
        for (const [color, points] of batch) {
          const previous = cache.batch.get(color);
          if (!previous || previous.length !== points.length) { same = false; break; }
          for (let index = 0; index < points.length; index += 1) {
            if (previous[index] !== points[index]) { same = false; break; }
          }
          if (!same) break;
        }
      }
      if (!same) {
        if (!cache.canvas || cache.canvas.width !== canvas.width || cache.canvas.height !== canvas.height) {
          cache.canvas = document.createElement('canvas');
          cache.canvas.width = canvas.width; cache.canvas.height = canvas.height;
          cache.context = cache.canvas.getContext('2d');
        }
        const layer = cache.context;
        if (cache.bounds) layer.clearRect(cache.bounds[0], cache.bounds[1], cache.bounds[2], cache.bounds[3]);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [color, points] of batch) {
          layer.fillStyle = color;
          for (let index = 0; index < points.length; index += 2) {
            const x = points[index], y = points[index + 1];
            layer.fillRect(x, y, size, size);
            if (x < minX) minX = x; if (y < minY) minY = y;
            if (x > maxX) maxX = x; if (y > maxY) maxY = y;
          }
        }
        cache.bounds = minX === Infinity ? null : [minX, minY, maxX - minX + size, maxY - minY + size];
        cache.batch = batch; cache.size = size;
      }
      if (cache.bounds) {
        const [x, y, w, h] = cache.bounds;
        ctx.drawImage(cache.canvas, x, y, w, h, x, y, w, h);
      }
    },
    markCore(scenario) {
      if (!scenario.inspectCore) return;
      const core = scenario.inspectCore(), scale = canvas.width / pixels.width;
      if (!core.enabled) return;
      for (const cell of core.cells) {
        if (cell.material !== PARTICLE_BARRIER) continue;
        ctx.fillStyle = core.destroyed ? '#ed795e' : PIXEL_CORE_CSS;
        ctx.fillRect(cell.x * scale, cell.y * scale, visibleSize(scale), visibleSize(scale));
      }
    },
    markTransported(scenario) {
      if (scenario.deliveryMode !== 'inside') return;
      const scale = canvas.width / pixels.width, size = visibleSize(scale);
      const counts = new Map();
      for (const agent of scenario.deliveries) {
        const key = agent.y * width + agent.x;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const [key, count] of counts) {
        const x = key % width, y = Math.floor(key / width);
        const material = scenario.world.at(x, y);
        // Do not conceal water or debris that has moved under a waiting delivery.
        if (material !== PARTICLE_EMPTY && material !== PARTICLE_BARRIER) continue;
        ctx.fillStyle = count > 1 ? '#ffffff' : '#eff9b1';
        ctx.fillRect(x * scale, y * scale, size, size);
      }
    },
    markLoads(world) {
      const scale = canvas.width / pixels.width, size = visibleSize(scale);
      // The load list is rebuilt only when the world reports a new structural load revision.
      const revision = world.structuralLoadRevision;
      let ops = loadsPaths.ops;
      if (revision === null || revision === undefined || loadsPaths.world !== world ||
          loadsPaths.revision !== revision || loadsPaths.scale !== scale) {
        ops = [];
        for (const cell of world.inspectStructuralLoads()) {
          const fraction = cell.load / cell.capacity;
          if (fraction < 0.5) continue;
          ops.push(fraction >= 0.8 ? '#ed795e' : '#e6cd72', cell.x * scale, cell.y * scale, size, size);
        }
        Object.assign(loadsPaths, { world, revision, scale });
      }
      if (Number.isInteger(scale)) { fillOpsByColor(loadsPaths, ops); return; }
      loadsPaths.ops = ops;
      for (let index = 0; index < ops.length; index += 5) {
        ctx.fillStyle = ops[index]; ctx.fillRect(ops[index + 1], ops[index + 2], ops[index + 3], ops[index + 4]);
      }
    },
    markDiagnostics(diagnostics) {
      const scale = canvas.width / pixels.width, size = visibleSize(scale);
      ctx.lineWidth = 1;
      const outline = (cell, color) => {
        ctx.strokeStyle = color;
        ctx.strokeRect(cell.x * scale + 0.5, cell.y * scale + 0.5, size - 1, size - 1);
      };
      const seen = new Set();
      for (const source of diagnostics.sources) {
        const key = source.y * width + source.x;
        if (!source.ready || seen.has(key)) continue;
        seen.add(key); outline(source, '#9edcf0');
      }
      for (const cell of diagnostics.blockers) outline(cell, '#e49ce5');
    },
    markSelected(cell) {
      if (!cell) return;
      const scale = canvas.width / pixels.width;
      ctx.strokeStyle = '#9edcf0';
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.x * scale + 0.5, cell.y * scale + 0.5, scale - 1, scale - 1);
    },
    markSeedGuide(pointer, surfaceY, valid) {
      const scale = canvas.width / pixels.width;
      const x = pointer.x * scale, y = pointer.y * scale, surface = surfaceY * scale;
      ctx.strokeStyle = valid ? '#3fc15f' : '#ed795e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, surface);
      ctx.moveTo(x - 5, surface); ctx.lineTo(x + 5, surface);
      ctx.stroke();
    },
    markFarm(farm) {
      const scale = canvas.width / pixels.width;
      ctx.strokeStyle = '#8bc6d6';
      ctx.lineWidth = Math.max(1, scale / 3);
      for (const source of farm.sources) {
        ctx.beginPath();
        source.path.forEach((cell, index) => {
          if (!index) ctx.moveTo((cell.x + 0.5) * scale, (cell.y + 0.5) * scale);
          else ctx.lineTo((cell.x + 0.5) * scale, (cell.y + 0.5) * scale);
        });
        ctx.stroke();
        ctx.strokeRect(source.intake.x * scale, source.intake.y * scale, scale, scale);
        if (source.pump) {
          // Pump head on the surface: housing, outlet spout and a walking-beam arm over the well.
          const px = source.pump.x * scale, py = source.pump.y * scale;
          ctx.fillStyle = '#4f7380';
          ctx.fillRect(px - scale, py - scale, scale * 3, scale * 2);
          ctx.fillStyle = '#9fd3e2';
          ctx.fillRect(px + 2 * scale, py - scale * 0.5, scale, scale * 0.5);
          ctx.fillStyle = '#2f4650';
          ctx.fillRect(px - 1.5 * scale, py - 2 * scale, scale * 4, scale * 0.5);
          ctx.fillRect(px + scale * 0.25, py - 2 * scale, scale * 0.5, scale);
        }
      }
      for (const cell of farm.fields) {
        ctx.fillStyle = '#80662d';
        ctx.fillRect(cell.x * scale, (cell.y - 0.4) * scale, scale, scale * 0.4);
        ctx.fillStyle = farm.rate > 0 ? '#e6cd72' : '#aa975c';
        const stem = Math.max(1, scale / 4);
        ctx.fillRect((cell.x + 0.45) * scale, (cell.y - 2.5) * scale, stem, scale * 2.2);
        ctx.fillRect((cell.x + 0.15) * scale, (cell.y - 2.1) * scale, scale * 0.7, stem);
        ctx.fillRect((cell.x + 0.25) * scale, (cell.y - 2.5) * scale, scale * 0.5, stem);
      }
    },
    markFarmStorage(farm, world) {
      const scale = canvas.width / pixels.width;
      for (const silo of farm.storageSilos) {
        ctx.fillStyle = PIXEL_FARM_STORAGE_COLORS.structure;
        for (const cell of silo.borderCells) {
          if (world.at(cell.x, cell.y) === PARTICLE_BARRIER) ctx.fillRect(cell.x * scale, cell.y * scale, scale, scale);
        }
        if (!silo.intact || silo.stored <= 0) continue;
        const interior = silo.storageCells.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_EMPTY)
          .sort((a, b) => b.y - a.y || a.x - b.x);
        const count = Math.ceil(interior.length * silo.stored / silo.capacity);
        ctx.fillStyle = PIXEL_FARM_STORAGE_COLORS.food;
        for (const cell of interior.slice(0, count)) ctx.fillRect(cell.x * scale, cell.y * scale, scale, scale);
      }
    },
    // Tunnel ladders, pipe casing and channels are cached as per-colour paths; stock fills and moving cargo
    // are a handful of rects painted directly.
    markEconomy(overlay) {
      if (!overlay) return;
      const scale = canvas.width / pixels.width;
      if (economyPaths.source !== overlay.staticOps || economyPaths.scale !== scale) {
        const ops = overlay.staticOps, scaled = new Array(ops.length);
        for (let index = 0; index < ops.length; index += 5) {
          scaled[index] = ops[index];
          for (let part = 1; part < 5; part += 1) scaled[index + part] = ops[index + part] * scale;
        }
        economyPaths.source = ops; economyPaths.scale = scale; economyPaths.cache = { ops: null, paths: null };
        economyPaths.scaled = scaled;
      }
      fillOpsByColor(economyPaths.cache, economyPaths.scaled);
      const ops = overlay.dynamic;
      for (let index = 0; index < ops.length; index += 5) {
        ctx.fillStyle = ops[index];
        ctx.fillRect(ops[index + 1] * scale, ops[index + 2] * scale, ops[index + 3] * scale, ops[index + 4] * scale);
      }
    },
    markRoads(roads) {
      const scale = canvas.width / pixels.width;
      for (const road of roads) for (const cell of road.cells) {
        ctx.fillStyle = '#92978e';
        ctx.fillRect(cell.x * scale, (cell.y + 0.2) * scale, scale, scale * 0.8);
        if (cell.x % 4 === 0) {
          ctx.fillStyle = '#e6cd72';
          ctx.fillRect((cell.x + 0.2) * scale, (cell.y + 0.45) * scale, scale * 0.6, Math.max(1, scale * 0.2));
        }
      }
    },
    markUrbanDetails(details) {
      const scale = canvas.width / pixels.width;
      for (const detail of details) {
        if (detail.type === 'paving') continue;
        const cell = detail.cells[0];
        const rect = (dx, dy, w, h) => ctx.fillRect((cell.x + dx) * scale, (cell.y + dy) * scale, w * scale, h * scale);
        if (detail.type === 'lamp') {
          ctx.fillStyle = '#8bc6d6'; rect(0.45, -2, 0.1, 2.7);
          ctx.fillStyle = '#e6cd72'; rect(0.2, -2, 0.6, 0.3);
        } else if (detail.type === 'utility-box') {
          ctx.fillStyle = '#687f88'; rect(0.15, -0.7, 0.7, 1.4);
          ctx.fillStyle = '#e6cd72'; rect(0.3, -0.3, 0.15, 0.15);
        } else if (detail.type === 'planter') {
          ctx.fillStyle = '#80662d'; rect(0.1, 0.1, 0.8, 0.6);
          ctx.fillStyle = '#3fc15f'; rect(0.3, -0.7, 0.4, 0.9);
        }
      }
    },
    markUnit(unit, showCollision = false, options = {}) {
      if (unit.transportPhase) unit = { ...unit, x: unit.renderX, y: unit.renderY };
      const scale = canvas.width / pixels.width;
      if (options.buildingLayers) {
        ctx.save(); ctx.scale(scale, scale);
        withPixelBuildingOcclusion(ctx, options.world, unit, unit.ownerId, options.buildingLayers, () => {
          ctx.save(); ctx.scale(1 / scale, 1 / scale);
          this.markUnit(unit, showCollision, { ...options, buildingLayers: null });
          ctx.restore();
        });
        ctx.restore(); return;
      }
      const groundOffset = pixelUnitGroundArtworkOffset(unit);
      if (!drawCachedSprite(unit, scale, groundOffset, options.snap)) for (const pixel of unit.pixels) {
        for (const detail of pixel.details || [{ x: 0, y: 0, size: 1, color: pixel.color }]) {
          const rgb = detail.color & 0xffffff;
          ctx.fillStyle = unit.hitFlash ? '#ff3535' : rgb === 0 && unit.tintColor ? unit.tintColor : `#${rgb.toString(16).padStart(6, '0')}`;
          ctx.globalAlpha = (detail.color >>> 24) / 255;
          ctx.fillRect((unit.x + pixel.x + detail.x) * scale,
            (unit.y + pixel.y + detail.y + groundOffset) * scale, detail.size * scale, detail.size * scale);
        }
      }
      ctx.globalAlpha = 1;
      if (showCollision) {
        ctx.strokeStyle = '#e6cd72'; ctx.lineWidth = 1;
        for (const pixel of unit.collision) ctx.strokeRect((unit.x + pixel.x) * scale + 0.5,
          (unit.y + pixel.y) * scale + 0.5, scale - 1, scale - 1);
      }
    },
    markMilitary(inspection) {
      const scale = canvas.width / pixels.width;
      for (const device of inspection.placements) {
        const { x, y, width: w, height: h } = device;
        // Device-local fill list; drawn from a cached sprite when the device origin lands on a whole pixel.
        const ops = [];
        let fill = '';
        const rect = (dx, dy, width, height) => ops.push(fill, dx * scale, dy * scale, width * scale, height * scale);
        fill = '#92978e';
        for (const anchor of device.anchors) {
          if (anchor.y > y + h) rect(anchor.x - x + 0.35, h, 0.3, anchor.y - y - h);
        }
        if (device.type === 'guard') {
          fill = '#f2dfbc';
          rect(0.25, 0, 0.5, 0.5);
          fill = '#d698e8';
          rect(0.15, 0.5, 0.7, 0.8);
          rect(0.15, 1.3, 0.25, 0.7); rect(0.6, 1.3, 0.25, 0.7);
        } else {
          fill = device.type === 'turret' ? '#efad67' :
            device.type === 'missile-launcher' ? '#f17e78' : '#8bd9ee';
          rect(0, h - 0.5, w, 0.5);
          if (device.type === 'turret') {
            rect(0.75, 0.5, 1.5, 1); rect(device.facing < 0 ? 0 : 1.5, 0.2, 1.5, 0.4);
          } else if (device.type === 'missile-launcher') {
            rect(0.3, 0.5, 0.6, 2); rect(1.2, 0, 0.6, 2.5); rect(2.1, 0.5, 0.6, 2);
          } else {
            rect(1.2, 0.8, 0.6, 1.7); rect(0.3, 0.2, 2.4, 0.6);
            rect(0, 1, 0.5, 0.5); rect(2.5, 1, 0.5, 0.5);
          }
        }
        const ox = x * scale, oy = y * scale;
        if (!Number.isInteger(ox) || !Number.isInteger(oy)) {
          for (let index = 0; index < ops.length; index += 5) {
            ctx.fillStyle = ops[index];
            ctx.fillRect(ox + ops[index + 1], oy + ops[index + 2], ops[index + 3], ops[index + 4]);
          }
          continue;
        }
        // Anti-aliased fractional rects on the map-wide canvas are slow, so each distinct device shape is
        // rasterized once at an integer offset and blitted; translation by whole pixels keeps the output identical.
        const key = ops.join(',');
        let sprite = militarySprites.get(key);
        if (!sprite) {
          let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
          for (let index = 0; index < ops.length; index += 5) {
            left = Math.min(left, ops[index + 1]); top = Math.min(top, ops[index + 2]);
            right = Math.max(right, ops[index + 1] + ops[index + 3]); bottom = Math.max(bottom, ops[index + 2] + ops[index + 4]);
          }
          left = Math.floor(left); top = Math.floor(top);
          const image = document.createElement('canvas');
          image.width = Math.max(1, Math.ceil(right) - left); image.height = Math.max(1, Math.ceil(bottom) - top);
          const context = image.getContext('2d');
          for (let index = 0; index < ops.length; index += 5) {
            context.fillStyle = ops[index];
            context.fillRect(ops[index + 1] - left, ops[index + 2] - top, ops[index + 3], ops[index + 4]);
          }
          if (militarySprites.size >= 512) militarySprites.clear();
          sprite = { image, left, top };
          militarySprites.set(key, sprite);
        }
        const dx = ox + sprite.left, dy = oy + sprite.top;
        if (view && (dx > view.left + view.width || dy > view.top + view.height ||
          dx + sprite.image.width < view.left || dy + sprite.image.height < view.top)) continue;
        ctx.drawImage(sprite.image, dx, dy);
      }
    },
    markPlacement(entry) {
      const scale = canvas.width / pixels.width;
      const outline = (cells, color) => {
        const keys = new Set(cells.map((cell) => cell.y * width + cell.x));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const cell of cells) {
          const x = cell.x * scale + 0.5, y = cell.y * scale + 0.5;
          if (!keys.has((cell.y - 1) * width + cell.x)) { ctx.moveTo(x, y); ctx.lineTo(x + scale, y); }
          if (!keys.has((cell.y + 1) * width + cell.x)) { ctx.moveTo(x, y + scale); ctx.lineTo(x + scale, y + scale); }
          if (!keys.has(cell.y * width + cell.x - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + scale); }
          if (!keys.has(cell.y * width + cell.x + 1)) { ctx.moveTo(x + scale, y); ctx.lineTo(x + scale, y + scale); }
        }
        ctx.stroke();
      };
      outline(entry.scenario.plan, '#9edcf0');
      outline(entry.basementCells, '#e49ce5');
      outline(entry.scenario.inspectCore().cells, PIXEL_CORE_CSS);
      outline(entry.seedPlacement, '#ffffff');
    },
    markWaiting(deliveries) {
      const scale = canvas.width / pixels.width;
      ctx.strokeStyle = '#ed795e';
      ctx.fillStyle = '#ed795e';
      ctx.lineWidth = 1;
      for (const delivery of deliveries) {
        if (!delivery.state.startsWith('waiting')) continue;
        if (scale >= 4) {
          ctx.strokeRect(delivery.x * scale + 0.5, delivery.y * scale + 0.5,
            visibleSize(scale) - 1, visibleSize(scale) - 1);
        } else {
          ctx.fillRect(delivery.x * scale, delivery.y * scale, 1, 1);
        }
      }
    },
    resize(minimumHeight = 0, detailScale = 2) {
      if (!Number.isInteger(detailScale) || detailScale < 2 || detailScale > 8) throw new Error('Invalid renderer detail scale');
      const ratio = window.devicePixelRatio || 1, quantum = pixels.width * detailScale;
      const width = quantum * Math.max(1,
        Math.ceil(minimumHeight * ratio / (pixels.height * detailScale)),
        Math.floor(canvas.parentElement.clientWidth * ratio / quantum));
      if (canvas.width !== width) {
        canvas.width = width;
        canvas.height = width * pixels.height / pixels.width;
      }
      const displayHeight = Math.max(minimumHeight,
        quantum * Math.max(1, Math.floor(canvas.parentElement.clientWidth * ratio / quantum)) *
        pixels.height / pixels.width / ratio);
      canvas.style.width = `${displayHeight * pixels.width / pixels.height}px`;
      canvas.style.height = `${displayHeight}px`;
    },
    setView(rect) {
      if (!rect) { view = null; return; }
      const left = Math.max(0, Math.floor(rect.left) - 2), top = Math.max(0, Math.floor(rect.top) - 2);
      const right = Math.min(canvas.width, Math.ceil(rect.left + rect.width) + 2);
      const bottom = Math.min(canvas.height, Math.ceil(rect.top + rect.height) + 2);
      view = right > left && bottom > top && (right - left < canvas.width || bottom - top < canvas.height) ?
        { left, top, width: right - left, height: bottom - top } : null;
    },
    draw(scenario) {
      const { world } = scenario;
      if (world.width !== pixels.width || world.height !== pixels.height) {
        throw new Error('Pixel renderer and world dimensions do not match');
      }
      if (clipped) { ctx.restore(); clipped = false; }
      if (view) {
        // Off-screen pixels stay stale until scrolled into view; the host redraws on scroll.
        ctx.save(); ctx.beginPath(); ctx.rect(view.left, view.top, view.width, view.height); ctx.clip();
        clipped = true;
      }
      const scale = canvas.width / world.width, size = visibleSize(scale);
      world.copyCells(raster);
      const terrainChanged = surfaceWorld !== world || surfaceRevision !== world.terrainRevision;
      if (terrainChanged) {
        surface = findParticleSurfaceRows(raster, world.width, world.height);
        surfaceRevision = world.terrainRevision;
        surfaceWorld = world;
      }
      const w = world.width, last = w - 1;
      const colorAt = (x, y, material) => {
        if (material !== PARTICLE_TERRAIN) return palette[material];
        const top = surface[x];
        // Inline isParticleSurfaceEdge without passages.
        return y === top || (y > top && ((x > 0 && y <= surface[x - 1]) || (x < last && y <= surface[x + 1])))
          ? surfaceColor : palette[material];
      };
      const cached = Number.isInteger(scale) && base && base.width === canvas.width &&
        base.height === canvas.height && baseWorld === world;
      if (!cached) {
        for (let y = 0, i = 0; y < world.height; y += 1) {
          for (let x = 0; x < w; x += 1, i += 1) rgba[i] = colorAt(x, y, raster[i]);
        }
        pixelContext.putImageData(image, 0, 0);
        const target = Number.isInteger(scale) ? baseLayer(world) : ctx;
        target.imageSmoothingEnabled = false;
        target.drawImage(pixels, 0, 0, world.width * scale, world.height * scale);
        if (size < scale) {
          target.fillStyle = '#020202';
          for (let y = 0, i = 0; y < world.height; y += 1) {
            for (let x = 0; x < w; x += 1, i += 1) {
              const material = raster[i];
              if (material !== PARTICLE_BARRIER && material !== PARTICLE_CONSTRUCTION) continue;
              // Visual gutters do not expose an empty physics cell.
              target.fillRect(x * scale + size, y * scale, scale - size, scale);
              target.fillRect(x * scale, y * scale + size, size, scale - size);
            }
          }
        }
        if (target !== ctx) drawn.set(rgba);
      } else {
        // Repaint only cells whose displayed color changed since the cached layer was drawn.
        const layer = baseContext;
        const fills = new Map(), gutters = [];
        const paint = (i, color, material) => {
          const x = i % w, y = (i - x) / w;
          let list = fills.get(color);
          if (!list) { list = []; fills.set(color, list); }
          list.push(x * scale, y * scale);
          if (size < scale && (material === PARTICLE_BARRIER || material === PARTICLE_CONSTRUCTION)) gutters.push(x * scale, y * scale);
          drawn[i] = color; materials[i] = material;
        };
        if (terrainChanged) {
          for (let y = 0, i = 0; y < world.height; y += 1) {
            for (let x = 0; x < w; x += 1, i += 1) {
              const material = raster[i], color = colorAt(x, y, material);
              if (color !== drawn[i] || material !== materials[i]) paint(i, color, material);
            }
          }
        } else {
          const words = raster.length >> 2;
          for (let word = 0; word < words; word += 1) {
            if (rasterWords[word] === materialWords[word]) continue;
            for (let i = word << 2, end = i + 4; i < end; i += 1) {
              const material = raster[i];
              if (material === materials[i]) continue;
              const x = i % w;
              paint(i, colorAt(x, (i - x) / w, material), material);
            }
          }
          for (let i = words << 2; i < raster.length; i += 1) {
            const material = raster[i];
            if (material === materials[i]) continue;
            const x = i % w;
            paint(i, colorAt(x, (i - x) / w, material), material);
          }
        }
        // Integer, axis-aligned fillRects are pixel-identical to path rects and batch on the GPU without path
        // tessellation; gutters are drawn last because each gutter lies inside its own cell.
        for (const [color, points] of fills) {
          layer.fillStyle = cssColor(color);
          for (let index = 0; index < points.length; index += 2) layer.fillRect(points[index], points[index + 1], scale, scale);
        }
        if (gutters.length) {
          layer.fillStyle = '#020202';
          for (let index = 0; index < gutters.length; index += 2) {
            const x = gutters[index], y = gutters[index + 1];
            layer.fillRect(x + size, y, scale - size, scale);
            layer.fillRect(x, y + size, size, scale - size);
          }
        }
      }
      if (Number.isInteger(scale)) {
        materials.set(raster);
        ctx.imageSmoothingEnabled = false;
        if (view) ctx.drawImage(base, view.left, view.top, view.width, view.height, view.left, view.top, view.width, view.height);
        else ctx.drawImage(base, 0, 0);
      }
      ctx.strokeStyle = '#52634a';
      ctx.fillStyle = '#52634a';
      ctx.lineWidth = 1;
      // Integer cells draw crisp 1px edges as fillRects; they match strokeRect pixels exactly and avoid GPU path work.
      const batched = Number.isInteger(scale) && size >= 2;
      const vl = view ? view.left - size : -Infinity, vt = view ? view.top - size : -Infinity;
      const vr = view ? view.left + view.width : Infinity, vb = view ? view.top + view.height : Infinity;
      for (const cell of scenario.blueprintCells()) {
        if (world.at(cell.x, cell.y) === PARTICLE_EMPTY) {
          const x = cell.x * scale, y = cell.y * scale;
          if (x < vl || x > vr || y < vt || y > vb) continue;
          const building = (bx, by) => bx >= 0 && by >= 0 && bx < world.width && by < world.height &&
            (world.at(bx, by) === PARTICLE_BARRIER || world.at(bx, by) === PARTICLE_CONSTRUCTION);
          const repairGap = (building(cell.x - 1, cell.y) && building(cell.x + 1, cell.y)) ||
            (building(cell.x, cell.y - 1) && building(cell.x, cell.y + 1));
          if (repairGap) continue;
          if (!batched) {
            ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
            continue;
          }
          ctx.fillRect(x, y, size, 1);
          ctx.fillRect(x, y + size - 1, size, 1);
          if (size > 2) { ctx.fillRect(x, y + 1, 1, size - 2); ctx.fillRect(x + size - 1, y + 1, 1, size - 2); }
        }
      }
    },
  };
}
