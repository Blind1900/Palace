'use strict';
// Pixel world renderer. Chunks are rasterised once into small canvases (per level of detail) and
// redrawn only when their cells change. Zoom snaps to steps where every cell covers a whole number
// of screen pixels (or a whole power-of-two group of cells per pixel), so no pixel is ever split.
(function () {
  const PW = window.PW;
  const { M, ID_MASK, CHUNK, CHUNK_SHIFT, CHUNK_MASK, DIRTY_BASE, DIRTY_DECO } = PW;
  const { palettes, phase } = PW.mat;

  // Device pixels per cell. Below 1, each screen pixel shows a power-of-two block of cells.
  const ZOOM_STEPS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 3, 4, 6, 8];
  const MAX_LOD = 3;            // chunk rasters exist for 1, 1/2, 1/4 and 1/8 scale
  const OVERVIEW_LOD = 3;       // whole-map overview is stored at 1/8 scale
  const RASTER_BUDGET = 28;     // new chunk rasters per frame (the rest show a coarser placeholder)
  const CACHE_LIMIT = 1400;     // cached chunk canvases before least-recently-used eviction

  const SKY_TOP = [8, 13, 22];
  const SKY_HORIZON = [34, 50, 60];

  function makeCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }

  function createRenderer(canvas, world, options = {}) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const camera = { x: 0, y: 0, zoom: 1, zoomIndex: 4, fitZoom: 1 };
    const view = { width: 1, height: 1, dpr: 1 };
    const cache = new Map();   // key -> { canvas, version, used }
    let frame = 0;
    let rastersThisFrame = 0;

    // ---- Cell colour (tunnel network lab shading) --------------------------------------------
    const { mat, width: W } = world;
    const groundTop = world.groundTop;
    // Original surface line: depth darkening is measured from it so craters don't recolour rock.
    const surface0 = world.surface0 || groundTop;
    // 256 = full brightness. Rock darkens by up to 28% over the first 1260 cells of depth.
    const depthTone = new Uint16Array(world.height + 1);
    for (let depth = 0; depth <= world.height; depth += 1) depthTone[depth] = Math.round(256 * (1 - Math.min(0.28, depth / 1260)));
    // Wavy strata bands, 27 cells tall.
    const bandWobble = new Int16Array(W);
    for (let x = 0; x < W; x += 1) bandWobble[x] = Math.round(9 * Math.sin(x / 33) + 4 * Math.sin(x / 151 + 1.3));
    const BAND_TONES = [256, 241, 266];
    const natural = new Uint8Array(64), banded = new Uint8Array(64);
    for (const id of [M.GRASS, M.TOPSOIL, M.SOIL, M.CLAY, M.GRAVEL, M.STONE, M.BEDROCK, M.SAND, M.LOOSE_SOIL, M.LOOSE_STONE]) natural[id] = 1;
    for (const id of [M.SOIL, M.CLAY, M.GRAVEL, M.STONE]) banded[id] = 1;
    const voidColor = [30, 24, 19];
    const waterTop = PW.abgr(128, 186, 236);
    const waterBase = [52, 120, 200];
    const oreBase = [163, 91, 214], oreSpark = PW.abgr(240, 210, 255), pebble = [114, 96, 74];
    const ORE_FACETS = [302, 243, 200];
    const liningBase = [191, 123, 25];

    function toned(rgb, k) {
      const r = Math.min(255, rgb[0] * k >> 8), g = Math.min(255, rgb[1] * k >> 8), b = Math.min(255, rgb[2] * k >> 8);
      return (0xff000000 | b << 16 | g << 8 | r) >>> 0;
    }
    function shade(color, k) {
      const r = Math.min(255, (color & 255) * k >> 8), g = Math.min(255, (color >>> 8 & 255) * k >> 8);
      const b = Math.min(255, (color >>> 16 & 255) * k >> 8);
      return (color & 0xff000000 | b << 16 | g << 8 | r) >>> 0;
    }
    const grainOf = (h) => h >>> 13 & 15;
    const grainTone = (g) => g < 3 ? 236 : g > 13 ? 271 : 256;
    function openAt(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= world.height) return false;
      return (mat[y * W + x] & ID_MASK) === M.AIR;
    }

    // Colour of one cell for the base layer (0 = transparent sky). waterDepth counts the water
    // cells from the surface down to this one (1 = the surface cell).
    function baseColor(x, y, paintChunk, backChunk, waterDepth) {
      const index = y * W + x;
      const m = mat[index];
      const id = m & ID_MASK;
      const local = (y & CHUNK_MASK) << CHUNK_SHIFT | x & CHUNK_MASK;
      if (id === M.AIR) {
        if (backChunk) {
          const back = backChunk[local];
          if (back) return back;
        }
        if (y < groundTop[x]) return 0;
        return toned(voidColor, grainOf(PW.hash2(x, y)) < 4 ? 218 : 256);
      }
      if (paintChunk) {
        const paint = paintChunk[local];
        if (paint) return paint;
      }
      const h = PW.hash2(x, y);
      const g = grainOf(h);
      if (id === M.WATER) {
        if (waterDepth <= 1) return waterTop;
        const k = Math.round(256 * (1.05 - Math.min(waterDepth, 36) * 0.01167)) * (g === 0 ? 287 : 256) >> 8;
        return toned(waterBase, k);
      }
      if (natural[id]) {
        const depth = Math.max(0, y - surface0[x]);
        const dk = depthTone[Math.min(depth, world.height)];
        if (banded[id]) {
          if ((h & 1023) === 0 || (h & 1023) === 1) return toned(pebble, dk * grainTone(g) >> 8);
          const band = ((((y + bandWobble[x]) / 27) | 0) % 3 + 3) % 3;
          return shade(palettes[id][(m >> 6) * 2 + (h & 1)], (BAND_TONES[band] * dk >> 8) * grainTone(g) >> 8);
        }
        return shade(palettes[id][(m >> 6) * 2 + (h & 1)], (id === M.GRASS ? 256 : dk) * grainTone(g) >> 8);
      }
      if (id === M.ORE) {
        if ((m >> 6) === 3 && (h & 3) === 0) return oreSpark;
        return toned(oreBase, ORE_FACETS[(x + y) % 3]);
      }
      if (id === M.LINING) {
        const course = (y / 6) | 0;
        const joint = y % 6 === 0 || (x + (course & 1) * 6) % 12 === 0;
        const facing = openAt(x - 1, y) || openAt(x + 1, y) || openAt(x, y - 1) || openAt(x, y + 1);
        const k = (joint ? 205 : 256) * (facing ? 292 : 243) >> 8;
        return toned(liningBase, k * (g === 0 ? 230 : g === 1 ? 276 : 256) >> 8);
      }
      return shade(palettes[id][(m >> 6) * 2 + (h & 1)], grainTone(g));
    }

    // ---- Chunk rasters -----------------------------------------------------------------------
    const scratch = new Map();  // "w,h" -> { image, pixels }
    function scratchImage(width, height = width) {
      const key = width * 1024 + height;
      let entry = scratch.get(key);
      if (!entry) {
        const image = new ImageData(width, height);
        entry = { image, pixels: new Uint32Array(image.data.buffer) };
        scratch.set(key, entry);
      }
      return entry;
    }
    const waterRun = new Int32Array(CHUNK);

    // Raster a chunk at a level of detail; at full resolution an optional local cell rectangle
    // [lx0..lx1] x [ly0..ly1] limits the work to the part that changed.
    function rasterBase(c, lod, lx0 = 0, ly0 = 0, lx1 = CHUNK - 1, ly1 = CHUNK - 1) {
      const cx = c % world.chunksX, cy = (c / world.chunksX) | 0;
      const size = CHUNK >> lod, step = 1 << lod, half = step >> 1;
      if (lod > 0) { lx0 = 0; ly0 = 0; lx1 = size - 1; ly1 = size - 1; }
      const w = lx1 - lx0 + 1, h = ly1 - ly0 + 1;
      const { image, pixels } = scratchImage(w, h);
      const paintChunk = world.paint[c], backChunk = world.back[c];
      const x0 = cx << CHUNK_SHIFT, y0 = cy << CHUNK_SHIFT;
      // Water depth above the first sampled row of each column (scan up to 40 cells).
      for (let tx = 0; tx < w; tx += 1) {
        const x = x0 + (lx0 + tx) * step + half;
        let run = 0;
        for (let y = y0 + ly0 * step + half - 1; y >= 0 && run < 40; y -= 1) {
          if ((mat[y * W + x] & ID_MASK) !== M.WATER) break;
          run += 1;
        }
        waterRun[tx] = run;
      }
      let i = 0;
      for (let ty = 0; ty < h; ty += 1) {
        const y = y0 + (ly0 + ty) * step + half;
        for (let tx = 0; tx < w; tx += 1) {
          const x = x0 + (lx0 + tx) * step + half;
          const isWater = (mat[y * W + x] & ID_MASK) === M.WATER;
          // Rows skipped between samples at coarser levels count as water when this sample is.
          waterRun[tx] = isWater ? waterRun[tx] + (ty === 0 ? 1 : step) : 0;
          pixels[i++] = baseColor(x, y, paintChunk, backChunk, waterRun[tx]);
        }
      }
      return image;
    }
    function rasterDeco(c, lod) {
      const decoChunk = world.deco[c];
      if (!decoChunk) return null;
      const size = CHUNK >> lod, step = 1 << lod, half = step >> 1;
      const { image, pixels } = scratchImage(size);
      let any = false, i = 0;
      for (let ty = 0; ty < size; ty += 1) {
        const row = (ty * step + half) << CHUNK_SHIFT;
        for (let tx = 0; tx < size; tx += 1) {
          const color = decoChunk[row | tx * step + half];
          pixels[i++] = color;
          if (color) any = true;
        }
      }
      return any ? image : null;
    }

    function chunkRaster(c, lod, layer, allowNew) {
      const key = (c * 8 + lod) * 2 + (layer === 'deco' ? 1 : 0);
      let entry = cache.get(key);
      const version = world.chunkVersion[c];
      if (entry && entry.version === version) { entry.used = frame; return entry; }
      if (!allowNew || rastersThisFrame >= RASTER_BUDGET) return entry && entry.canvas ? entry : null;
      const rect = world.dirtyRect, o = c * 4;
      if (layer === 'base' && lod === 0 && entry && entry.canvas && rect[o] >= 0) {
        // Only part of the chunk changed: redraw that rectangle (snapped to 16-cell tiles so the
        // scratch image sizes stay few) into the cached canvas.
        const rx0 = rect[o] & ~15, ry0 = rect[o + 1] & ~15, rx1 = rect[o + 2] | 15, ry1 = rect[o + 3] | 15;
        const area = (rx1 - rx0 + 1) * (ry1 - ry0 + 1);
        rastersThisFrame += Math.max(0.05, area / (CHUNK * CHUNK));
        const image = rasterBase(c, 0, rx0, ry0, rx1, ry1);
        entry.canvas.getContext('2d').putImageData(image, rx0, ry0);
        rect[o] = -1;
        entry.version = version;
        entry.used = frame;
        return entry;
      }
      rastersThisFrame += 1;
      if (layer === 'base' && lod === 0) rect[o] = -1;
      const image = layer === 'deco' ? rasterDeco(c, lod) : rasterBase(c, lod);
      if (!entry) { entry = { canvas: null, version, used: frame }; cache.set(key, entry); }
      entry.version = version;
      entry.used = frame;
      if (!image) { entry.canvas = null; entry.empty = true; return entry; }
      entry.empty = false;
      if (!entry.canvas || entry.canvas.width !== image.width) entry.canvas = makeCanvas(image.width, image.height);
      entry.canvas.getContext('2d').putImageData(image, 0, 0);
      return entry;
    }

    function evict() {
      if (cache.size <= CACHE_LIMIT) return;
      const entries = [...cache.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < entries.length - CACHE_LIMIT * 0.8; i += 1) cache.delete(entries[i][0]);
    }

    // ---- Whole-map overview (1/8 scale) ---------------------------------------------------------
    const overviewScale = 1 << OVERVIEW_LOD;
    const overview = makeCanvas(world.width / overviewScale, world.height / overviewScale);
    const overviewCtx = overview.getContext('2d');
    const overviewVersion = new Uint32Array(world.chunkCount).fill(0xffffffff);
    function refreshOverview(limit) {
      let done = 0;
      const size = CHUNK >> OVERVIEW_LOD;
      for (let c = 0; c < world.chunkCount && done < limit; c += 1) {
        if (overviewVersion[c] === world.chunkVersion[c]) continue;
        overviewVersion[c] = world.chunkVersion[c];
        const image = rasterBase(c, OVERVIEW_LOD);
        const deco = world.deco[c] ? rasterDeco(c, OVERVIEW_LOD) : null;
        const cx = c % world.chunksX, cy = (c / world.chunksX) | 0;
        if (deco) {
          // Merge deco over base for the overview.
          const base = new Uint32Array(image.data.buffer.slice(0));
          const top = new Uint32Array(deco.data.buffer);
          for (let i = 0; i < base.length; i += 1) if (top[i]) base[i] = top[i];
          overviewCtx.putImageData(new ImageData(new Uint8ClampedArray(base.buffer), size, size), cx * size, cy * size);
        } else {
          overviewCtx.putImageData(image, cx * size, cy * size);
        }
        done += 1;
      }
      return done;
    }

    // ---- Camera ---------------------------------------------------------------------------------
    function resize(cssWidth, cssHeight) {
      view.dpr = window.devicePixelRatio || 1;
      view.width = Math.max(1, Math.round(cssWidth * view.dpr));
      view.height = Math.max(1, Math.round(cssHeight * view.dpr));
      canvas.width = view.width;
      canvas.height = view.height;
      camera.fitZoom = Math.min(view.width / world.width, view.height / world.height * 3);
      clampCamera();
    }
    function zoomValue(index) { return index < 0 ? camera.fitZoom : ZOOM_STEPS[index]; }
    function minZoomIndex() {
      // The fit zoom is the furthest view; steps smaller than it are skipped.
      let index = 0;
      while (index < ZOOM_STEPS.length - 1 && ZOOM_STEPS[index] < camera.fitZoom) index += 1;
      return index - 1;   // -1 means "fit"
    }
    function setZoomIndex(index, anchorX = view.width / 2, anchorY = view.height / 2) {
      index = Math.max(minZoomIndex(), Math.min(ZOOM_STEPS.length - 1, index));
      const before = screenToWorldDevice(anchorX, anchorY);
      camera.zoomIndex = index;
      camera.zoom = zoomValue(index);
      camera.x = before.x - anchorX / camera.zoom;
      camera.y = before.y - anchorY / camera.zoom;
      clampCamera();
    }
    function clampCamera() {
      const visibleW = view.width / camera.zoom, visibleH = view.height / camera.zoom;
      camera.x = visibleW >= world.width ? (world.width - visibleW) / 2 : Math.max(0, Math.min(world.width - visibleW, camera.x));
      // The view may rise above the grid (open sky for jets and missiles) but never below bedrock.
      const top = -world.height * 0.3;
      camera.y = visibleH >= world.height - top ? world.height - visibleH
        : Math.max(top, Math.min(world.height - visibleH, camera.y));
      // Snap so cell edges land on whole device pixels.
      if (camera.zoom >= 1) {
        camera.x = Math.round(camera.x * camera.zoom) / camera.zoom;
        camera.y = Math.round(camera.y * camera.zoom) / camera.zoom;
      } else {
        const block = 1 / camera.zoom;
        camera.x = Math.round(camera.x / block) * block;
        camera.y = Math.round(camera.y / block) * block;
      }
    }
    function screenToWorldDevice(x, y) { return { x: x / camera.zoom + camera.x, y: y / camera.zoom + camera.y }; }
    function screenToWorld(cssX, cssY) { return screenToWorldDevice(cssX * view.dpr, cssY * view.dpr); }
    function worldToScreen(x, y) {   // returns CSS pixels
      return { x: (x - camera.x) * camera.zoom / view.dpr, y: (y - camera.y) * camera.zoom / view.dpr };
    }
    function worldToDevice(x, y) { return { x: (x - camera.x) * camera.zoom, y: (y - camera.y) * camera.zoom }; }
    function focus(x, y, zoomIndex) {
      if (zoomIndex !== undefined) { camera.zoomIndex = zoomIndex; camera.zoom = zoomValue(zoomIndex); }
      camera.x = x - view.width / camera.zoom / 2;
      camera.y = y - view.height / camera.zoom / 2;
      clampCamera();
    }
    function panByDevice(dx, dy) {
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      clampCamera();
    }

    // ---- Sky ------------------------------------------------------------------------------------
    const sky = createSky(world, options.seed || 1);
    function drawSky() {
      const gradient = ctx.createLinearGradient(0, (-world.height * 0.35 - camera.y) * camera.zoom, 0,
        (world.height * 0.5 - camera.y) * camera.zoom);
      gradient.addColorStop(0, `rgb(${SKY_TOP})`);
      gradient.addColorStop(1, `rgb(${SKY_HORIZON})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, view.width, view.height);
      sky.draw(ctx, camera, view, frame);
    }

    // ---- Layers ---------------------------------------------------------------------------------
    function visibleChunkRange() {
      const x0 = Math.max(0, Math.floor(camera.x) >> CHUNK_SHIFT);
      const y0 = Math.max(0, Math.floor(camera.y) >> CHUNK_SHIFT);
      const x1 = Math.min(world.chunksX - 1, Math.floor(camera.x + view.width / camera.zoom) >> CHUNK_SHIFT);
      const y1 = Math.min(world.chunksY - 1, Math.floor(camera.y + view.height / camera.zoom) >> CHUNK_SHIFT);
      return { x0, y0, x1, y1 };
    }
    function lodForZoom() {
      if (camera.zoom >= 1) return 0;
      return Math.min(MAX_LOD + 1, Math.round(Math.log2(1 / camera.zoom)));
    }
    function chunkScreenRect(cx, cy) {
      const left = Math.round(((cx << CHUNK_SHIFT) - camera.x) * camera.zoom);
      const top = Math.round(((cy << CHUNK_SHIFT) - camera.y) * camera.zoom);
      const right = Math.round((((cx + 1) << CHUNK_SHIFT) - camera.x) * camera.zoom);
      const bottom = Math.round((((cy + 1) << CHUNK_SHIFT) - camera.y) * camera.zoom);
      return { left, top, width: right - left, height: bottom - top };
    }
    function drawOverviewRegion() {
      const sx = camera.x / overviewScale, sy = camera.y / overviewScale;
      const sw = view.width / camera.zoom / overviewScale, sh = view.height / camera.zoom / overviewScale;
      ctx.imageSmoothingEnabled = camera.zoom < 1 / overviewScale;
      // Clip the source rect to the overview to avoid browser edge differences.
      const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy);
      const cx1 = Math.min(overview.width, sx + sw), cy1 = Math.min(overview.height, sy + sh);
      if (cx1 <= cx0 || cy1 <= cy0) return;
      const dx = (cx0 - sx) / sw * view.width, dy = (cy0 - sy) / sh * view.height;
      const dw = (cx1 - cx0) / sw * view.width, dh = (cy1 - cy0) / sh * view.height;
      ctx.drawImage(overview, cx0, cy0, cx1 - cx0, cy1 - cy0, dx, dy, dw, dh);
      ctx.imageSmoothingEnabled = false;
    }
    function drawLayer(layer) {
      const lod = lodForZoom();
      if (lod > MAX_LOD) {
        if (layer === 'base') drawOverviewRegion();
        return;
      }
      ctx.imageSmoothingEnabled = false;
      const range = visibleChunkRange();
      for (let cy = range.y0; cy <= range.y1; cy += 1) {
        for (let cx = range.x0; cx <= range.x1; cx += 1) {
          const c = cy * world.chunksX + cx;
          if (layer === 'deco' && !world.deco[c]) continue;
          let entry = chunkRaster(c, lod, layer, true);
          let usedLod = lod;
          // Placeholder from a coarser raster while the budget catches up.
          for (let coarser = lod + 1; (!entry || !entry.canvas && !entry.empty) && coarser <= MAX_LOD; coarser += 1) {
            const fallback = cache.get((c * 8 + coarser) * 2 + (layer === 'deco' ? 1 : 0));
            if (fallback && fallback.canvas) { entry = fallback; usedLod = coarser; }
          }
          const rect = chunkScreenRect(cx, cy);
          if (!entry || !entry.canvas) {
            if (layer === 'base' && (!entry || !entry.empty)) {
              const size = CHUNK >> OVERVIEW_LOD;
              ctx.drawImage(overview, cx * size, cy * size, size, size, rect.left, rect.top, rect.width, rect.height);
            }
            continue;
          }
          ctx.drawImage(entry.canvas, 0, 0, CHUNK >> usedLod, CHUNK >> usedLod, rect.left, rect.top, rect.width, rect.height);
        }
      }
    }

    function beginFrame() {
      frame += 1;
      rastersThisFrame = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      // Keep the overview current in the background (a few chunks per frame).
      refreshOverview(camera.zoom < 1 / 4 ? 48 : 12);
      if (frame % 120 === 0) evict();
    }
    function drawBase() { drawLayer('base'); }
    function drawDeco() { drawLayer('deco'); }
    // Draw a cell-art canvas with its top-left at world cell (x, y), scaled `scale` cells per art pixel.
    function drawCells(image, x, y, sw, sh, flip) {
      const left = Math.round((Math.round(x) - camera.x) * camera.zoom);
      const top = Math.round((Math.round(y) - camera.y) * camera.zoom);
      const right = Math.round((Math.round(x) + sw - camera.x) * camera.zoom);
      const bottom = Math.round((Math.round(y) + sh - camera.y) * camera.zoom);
      if (right < 0 || bottom < 0 || left > view.width || top > view.height) return;
      if (flip) {
        ctx.save();
        ctx.translate(left + right, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(image, 0, 0, sw, sh, left, top, right - left, bottom - top);
        ctx.restore();
      } else {
        ctx.drawImage(image, 0, 0, sw, sh, left, top, right - left, bottom - top);
      }
    }
    // Fill one world cell (or a block) in screen space, aligned to the grid.
    function fillCell(x, y, color, size = 1) {
      const gx = Math.floor(x), gy = Math.floor(y);
      const left = Math.round((gx - camera.x) * camera.zoom);
      const top = Math.round((gy - camera.y) * camera.zoom);
      const extent = Math.max(1, Math.round((gx + size - camera.x) * camera.zoom) - left);
      ctx.fillStyle = color;
      ctx.fillRect(left, top, extent, Math.max(1, Math.round((gy + size - camera.y) * camera.zoom) - top));
    }
    function invalidateAll() { for (const c of world.chunkVersion.keys()) world.chunkVersion[c] += 1; }

    resize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
    camera.zoomIndex = minZoomIndex();
    camera.zoom = zoomValue(camera.zoomIndex);
    clampCamera();

    return {
      ctx, camera, view, ZOOM_STEPS,
      resize, setZoomIndex, focus, panByDevice, clampCamera, minZoomIndex,
      screenToWorld, screenToWorldDevice, worldToScreen, worldToDevice,
      beginFrame, drawSky, drawBase, drawDeco, drawCells, fillCell, refreshOverview, invalidateAll,
      stats: () => ({ cached: cache.size, frame, zoom: camera.zoom, lod: lodForZoom() }),
      get frame() { return frame; },
    };
  }

  // ---- Night sky: stars, moon and drifting pixel clouds (cells on the same grid) ----------------
  function createSky(world, seed) {
    const random = PW.createRandom(seed * 7919 + 17);
    const top = -Math.round(world.height * 1.4);
    const stars = [];
    for (let i = 0; i < 5200; i += 1) {
      const y = Math.round(top + random() * (world.height * 0.5 - top));
      stars.push({ x: Math.round(random() * world.width), y, b: random(), twinkle: random() * 6.28, big: random() < 0.06 });
    }
    const moon = { x: Math.round(world.width * (0.25 + random() * 0.5)), y: Math.round(-world.height * 0.3), r: 46 };
    const moonCanvas = drawMoon(moon.r, random);
    const clouds = [];
    for (let i = 0; i < 30; i += 1) {
      const sprite = drawCloud(random, 180 + random() * 420, 40 + random() * 70);
      clouds.push({ sprite, x: random() * world.width, y: Math.round(-world.height * 0.15 + random() * world.height * 0.33),
        speed: 0.6 + random() * 1.4 });
    }
    let last = 0;
    function draw(ctx, camera, view, frame) {
      const now = performance.now() / 1000;
      const dt = last ? Math.min(0.1, now - last) : 0;
      last = now;
      const z = camera.zoom;
      const x0 = camera.x, y0 = camera.y, x1 = camera.x + view.width / z, y1 = camera.y + view.height / z;
      const px = Math.max(1, Math.round(z));
      for (const star of stars) {
        if (star.x < x0 || star.x > x1 || star.y < y0 || star.y > y1) continue;
        const flicker = 0.65 + 0.35 * Math.sin(now * 1.7 + star.twinkle);
        const level = Math.round((70 + star.b * 150) * flicker);
        ctx.fillStyle = `rgb(${level},${level + 8},${Math.min(255, level + 30)})`;
        const sx = Math.round((star.x - x0) * z), sy = Math.round((star.y - y0) * z);
        ctx.fillRect(sx, sy, px, px);
        if (star.big && z >= 2) {
          ctx.globalAlpha = 0.45;
          ctx.fillRect(sx - px, sy, px, px); ctx.fillRect(sx + px, sy, px, px);
          ctx.fillRect(sx, sy - px, px, px); ctx.fillRect(sx, sy + px, px, px);
          ctx.globalAlpha = 1;
        }
      }
      const mx = Math.round((moon.x - moon.r - x0) * z), my = Math.round((moon.y - moon.r - y0) * z);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(moonCanvas, mx, my, Math.round(moonCanvas.width * z), Math.round(moonCanvas.height * z));
      for (const cloud of clouds) {
        cloud.x += cloud.speed * dt;
        if (cloud.x > world.width + 400) cloud.x = -cloud.sprite.width;
        const cx = Math.round(cloud.x), cy = cloud.y;
        if (cx + cloud.sprite.width < x0 || cx > x1 || cy + cloud.sprite.height < y0 || cy > y1) continue;
        ctx.drawImage(cloud.sprite, Math.round((cx - x0) * z), Math.round((cy - y0) * z),
          Math.round(cloud.sprite.width * z), Math.round(cloud.sprite.height * z));
      }
    }
    return { draw, stars, moon, clouds };
  }
  function drawMoon(r, random) {
    const size = r * 2 + 1;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const pixels = new Uint32Array(image.data.buffer);
    const craters = Array.from({ length: 9 }, () => ({ x: (random() * 1.4 - 0.7) * r, y: (random() * 1.4 - 0.7) * r,
      r: r * (0.08 + random() * 0.18) }));
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - r, dy = y - r;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        let light = 0.78 + 0.22 * (-(dx + dy) / (r * 1.4));
        for (const crater of craters) if (Math.hypot(dx - crater.x, dy - crater.y) < crater.r) light -= 0.12;
        if (d > r - 1.5) light -= 0.1;
        const dither = (PW.hash2(x, y) & 7) / 7 * 0.05;
        const v = Math.max(0, Math.min(1, light + dither));
        pixels[y * size + x] = PW.abgr(Math.round(170 * v + 40), Math.round(176 * v + 40), Math.round(160 * v + 46));
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }
  function drawCloud(random, width, height) {
    width = Math.round(width); height = Math.round(height);
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    const pixels = new Uint32Array(image.data.buffer);
    const puffs = Array.from({ length: 7 + Math.floor(random() * 6) }, () => ({
      x: width * (0.12 + random() * 0.76), y: height * (0.45 + random() * 0.3), r: height * (0.22 + random() * 0.32) }));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let density = 0;
        for (const puff of puffs) {
          const d = Math.hypot((x - puff.x) / 1.6, y - puff.y) / puff.r;
          if (d < 1) density = Math.max(density, 1 - d);
        }
        if (y > height * 0.78) density *= Math.max(0, 1 - (y - height * 0.78) / (height * 0.22));
        if (density <= 0) continue;
        // Ordered dithering keeps the soft edge on whole cells.
        const threshold = ((x & 3) * 4 + (y & 3) ^ 5) / 16;
        if (density * 2.2 < threshold) continue;
        const lit = y < height * 0.5 ? 1 : 0.8;
        pixels[y * width + x] = PW.abgr(Math.round(34 * lit + 6), Math.round(42 * lit + 6), Math.round(58 * lit + 8), 200);
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  PW.createRenderer = createRenderer;
  PW.ZOOM_STEPS = ZOOM_STEPS;
})();
