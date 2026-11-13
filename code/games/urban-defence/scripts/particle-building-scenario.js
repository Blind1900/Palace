// The particle grid is authoritative for foundation support and exposed surface heights.
function createParticleBuildingScenario(saved, options = {}) {
  if (!options || (options.rows !== undefined &&
      (!Number.isInteger(options.rows) || options.rows < 1 || options.rows > 11))) {
    throw new Error('Invalid terrain and building lab dimensions');
  }
  const scale = 4;
  const surfaceRow = 75;
  const world = createParticleWorld(160, 90, { skipEmptyRows: true });
  let hm = 200;
  for (let y = surfaceRow; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) world.set(x, y, PARTICLE_TERRAIN);
  }
  for (let y = 65; y < surfaceRow; y += 1) {
    for (let x = 8; x < 30; x += 1) world.set(x, y, PARTICLE_WATER);
    world.set(7, y, PARTICLE_TERRAIN);
    world.set(30, y, PARTICLE_TERRAIN);
  }
  const surface = new Int32Array(world.width);
  let surfaceRevision = -1;
  function refreshSurface() {
    if (surfaceRevision === world.terrainRevision) return;
    for (let x = 0; x < world.width; x += 1) {
      let y = 0;
      while (y < world.height && world.at(x, y) !== PARTICLE_TERRAIN) y += 1;
      surface[x] = y * scale;
    }
    surfaceRevision = world.terrainRevision;
  }
  refreshSurface();
  const model = createCollapseModel({ ground: surfaceRow * scale, loadEnabled: true, rows: options.rows,
    minimumWallThicknessFactor: options.minimumWallThicknessFactor,
    surfaceGrid: { cellSize: scale,
      heightAt: (column) => surface[Math.max(0, Math.min(world.width - 1, column))] } });
  let waterBlocksAttached = true;
  let waterBlocksLoose = false;
  let waterDamageEnabled = false;
  if (saved !== undefined) {
    if (!saved || saved.version !== 1 || !saved.world || !saved.model) {
      throw new Error('Invalid terrain and building lab save');
    }
    world.restore(saved.world);
    refreshSurface();
    model.loadState(saved.model);
    if (saved.hm !== undefined && (!Number.isFinite(saved.hm) || saved.hm < 0)) {
      throw new Error('Invalid lab resources');
    }
    if (saved.hm !== undefined) hm = saved.hm;
    if (saved.waterBlocksAttached !== undefined && typeof saved.waterBlocksAttached !== 'boolean') {
      throw new Error('Invalid water interaction mode');
    }
    waterBlocksAttached = saved.waterBlocksAttached === true;
    if (saved.waterBlocksLoose !== undefined && typeof saved.waterBlocksLoose !== 'boolean') {
      throw new Error('Invalid loose member water interaction mode');
    }
    waterBlocksLoose = saved.waterBlocksLoose === true;
    if (saved.waterDamageEnabled !== undefined && typeof saved.waterDamageEnabled !== 'boolean') {
      throw new Error('Invalid water damage mode');
    }
    waterDamageEnabled = saved.waterDamageEnabled === true;
  }
  const foundationSections = model.sections.filter((section) => section.row === model.rows - 1 && section.vertical);
  const anchorColumns = foundationSections
    .map((section) => Math.floor((model.left + (section.column + 0.5) * model.size) / scale));
  function hasFoundation(section) {
    const x = Math.floor((model.left + (section.column + 0.5) * model.size) / scale);
    return x >= 0 && x < world.width && world.at(x, surfaceRow) === PARTICLE_TERRAIN;
  }
  function syncFoundations() {
    return model.updateFoundationSupport(hasFoundation);
  }
  function repairSiteBlockers(section, site) {
    const reasons = new Set();
    if (section.row === model.rows - 1 && section.vertical && !hasFoundation(section)) {
      reasons.add('missing foundation');
    }
    const bounds = model.sectionBounds(site);
    const minX = Math.max(0, Math.floor(bounds.left / scale));
    const maxX = Math.min(world.width - 1, Math.floor(bounds.right / scale));
    const minY = Math.max(0, Math.floor(bounds.top / scale));
    const maxY = Math.min(world.height - 1, Math.floor(bounds.bottom / scale));
    if (bounds.left < 0 || bounds.top < 0 || bounds.right > world.width * scale ||
        bounds.bottom > world.height * scale) {
      reasons.add('outside the particle world');
      return reasons;
    }
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const material = world.at(x, y);
        if (material !== PARTICLE_EMPTY && model.touchesRect(site, x * scale, y * scale, scale, scale)) {
          if (material === PARTICLE_WATER) reasons.add('water');
          else if (material === PARTICLE_TERRAIN) reasons.add('terrain');
          else if (material === PARTICLE_DEBRIS) reasons.add('particle debris');
          else reasons.add('particle barrier');
        }
      }
    }
    return reasons;
  }
  function repairOnce(eligible, detectedBlockers) {
    const blockers = new Set();
    const result = model.repair(1, hm, () => false, (section, site) => {
      if (eligible && !eligible.has(section)) return false;
      const reasons = repairSiteBlockers(section, site);
      for (const reason of reasons) {
        blockers.add(reason);
        if (detectedBlockers) detectedBlockers.add(reason);
      }
      return reasons.size === 0;
    });
    hm -= result.spent;
    if (result.state === 'Blocked') return { ...result, siteBlockers: Array.from(blockers) };
    return result;
  }
  const blockers = new Uint8Array(world.width * world.height);
  let blockerGeometry = null;
  function blocksUprightCell(section, col, row) {
    const cx = section.x + model.size / 2, cy = section.y + model.size / 2;
    const x = col * scale, y = row * scale;
    const onVertical = section.vertical && y < cy + model.size / 2 &&
      y + scale > cy - model.size / 2 &&
      (col === Math.floor(cx / scale) ||
       Math.abs(x + scale / 2 - cx) < model.wallThickness / 2);
    const onHorizontal = section.horizontal && x < cx + model.size / 2 &&
      x + scale > cx - model.size / 2 &&
      (row === Math.floor(cy / scale) ||
       Math.abs(y + scale / 2 - cy) < model.thickness / 2);
    return onVertical || onHorizontal;
  }
  function waterBlockerGrid() {
    const blocksWater = (section) => !section.cleared &&
      ((section.attached && waterBlocksAttached) || (!section.attached && waterBlocksLoose));
    const geometry = model.sections.map((section) => blocksWater(section) ?
      [section.x, section.y, section.angle, section.previousX, section.previousY,
        section.previousAngle, section.horizontal, section.vertical, section.attached] : null);
    if (blockerGeometry && geometry.every((entry, i) => {
      const previous = blockerGeometry[i];
      return entry === null ? previous === null :
        previous !== null && entry.every((value, j) => value === previous[j]);
    })) return blockers;
    blockers.fill(0);
    for (const section of model.sections) {
      if (!blocksWater(section)) continue;
      const swept = waterBlocksLoose && !section.attached;
      const distance = Math.hypot(section.x - section.previousX, section.y - section.previousY);
      const radius = Math.hypot(model.size, model.wallThickness) / 2;
      const travel = distance + Math.abs(section.angle - section.previousAngle) * radius;
      const samples = swept ? Math.max(1, Math.min(64, Math.ceil(travel / (model.thickness / 2)))) : 1;
      for (let i = swept ? 0 : samples; i <= samples; i += 1) {
        const t = i / samples;
        const x = section.previousX + (section.x - section.previousX) * t;
        const y = section.previousY + (section.y - section.previousY) * t;
        const angle = section.previousAngle + (section.angle - section.previousAngle) * t;
        const site = { ...section, x, y, angle, previousX: x, previousY: y, previousAngle: angle };
        const bounds = model.sectionBounds(site);
        const minX = Math.max(0, Math.floor(bounds.left / scale));
        const maxX = Math.min(world.width - 1, Math.floor(bounds.right / scale));
        const minY = Math.max(0, Math.floor(bounds.top / scale));
        const maxY = Math.min(world.height - 1, Math.floor(bounds.bottom / scale));
        for (let row = minY; row <= maxY; row += 1) {
          for (let col = minX; col <= maxX; col += 1) {
            const cell = row * world.width + col;
            const touches = section.attached && site.angle === 0
              ? blocksUprightCell(site, col, row)
              : model.touchesRect(site, col * scale, row * scale, scale, scale);
            if (!blockers[cell] && touches) {
              blockers[cell] = 1;
            }
          }
        }
      }
    }
    blockerGeometry = geometry;
    return blockers;
  }
  const waterDepths = new Uint32Array(world.width * world.height);
  function applyWaterDamage() {
    waterDepths.fill(0);
    function waterDepth(x, y) {
      let row = y;
      while (row >= 0 && !waterDepths[row * world.width + x] &&
          world.at(x, row) === PARTICLE_WATER) row -= 1;
      let depth = row >= 0 ? waterDepths[row * world.width + x] : 0;
      for (let next = row + 1; next <= y; next += 1) {
        depth += 1;
        waterDepths[next * world.width + x] = depth;
      }
      return depth;
    }
    function contactsWater(section, x, y) {
      if (model.touchesRect(section, x * scale, y * scale, scale, scale)) return true;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height) continue;
        const material = world.at(nx, ny);
        if ((material === PARTICLE_EMPTY || material === PARTICLE_WATER) &&
            model.touchesRect(section, nx * scale, ny * scale, scale, scale)) return true;
      }
      return false;
    }
    const damage = [];
    for (const section of model.sections) {
      if (!section.attached) continue;
      const bounds = model.sectionBounds(section);
      const minX = Math.max(0, Math.floor(bounds.left / scale) - 1);
      const maxX = Math.min(world.width - 1, Math.floor(bounds.right / scale) + 1);
      const minY = Math.max(0, Math.floor(bounds.top / scale) - 1);
      const maxY = Math.min(world.height - 1, Math.floor(bounds.bottom / scale) + 1);
      let depth = 0;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (world.at(x, y) !== PARTICLE_WATER || !contactsWater(section, x, y)) continue;
          depth = Math.max(depth, waterDepth(x, y));
        }
      }
      if (depth) damage.push({ section, amount: depth * 0.4 / 60 });
    }
    model.damageAttached(damage);
  }
  return {
    world, model, scale, surfaceRow, anchorColumns,
    foundationStatus() {
      return foundationSections.map((section, index) => ({
        column: anchorColumns[index],
        groundPresent: hasFoundation(section),
        anchored: section.anchored,
      }));
    },
    get hm() { return hm; },
    get waterBlocksAttached() { return waterBlocksAttached; },
    get waterBlocksLoose() { return waterBlocksLoose; },
    get waterDamageEnabled() { return waterDamageEnabled; },
    setWaterDamageEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Invalid water damage mode');
      waterDamageEnabled = enabled;
    },
    setWaterBlocksLoose(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Invalid loose member water interaction mode');
      waterBlocksLoose = enabled;
    },
    snapshot() {
      return { version: 1, world: world.snapshot(), model: model.saveState(), hm, waterBlocksAttached, waterBlocksLoose, waterDamageEnabled };
    },
    breachBasin() {
      return world.excavate(30, 65, 30, surfaceRow - 1);
    },
    clearParticleDebris() {
      return world.clearDebris(0, 0, world.width - 1, world.height - 1);
    },
    clearBuildingDebris() {
      return model.clearLooseMembers();
    },
    blastLeftWall() {
      const base = model.sections.find((section) => section.column === 0 && section.row === model.rows - 1);
      model.blast(model.left + model.size / 2, model.ground - model.size / 2, 1, 1000);
      return !base.attached;
    },
    undermine(index) {
      if (!Number.isInteger(index) || index < 0 || index >= anchorColumns.length) {
        throw new Error('Invalid foundation index');
      }
      const x = anchorColumns[index];
      return world.excavate(x - 5, surfaceRow, x + 5, surfaceRow + 10);
    },
    restoreGround(index) {
      if (!Number.isInteger(index) || index < 0 || index >= anchorColumns.length) {
        throw new Error('Invalid foundation index');
      }
      const x = anchorColumns[index];
      for (let y = surfaceRow; y <= surfaceRow + 10; y += 1) {
        for (let col = x - 5; col <= x + 5; col += 1) {
          const material = world.at(col, y);
          if (material !== PARTICLE_EMPTY && material !== PARTICLE_TERRAIN) {
            return { ok: false, reason: 'Water or another particle occupies the excavation.' };
          }
          if (material === PARTICLE_EMPTY && model.sections.some((section) =>
            model.touchesRect(section, col * scale, y * scale, scale, scale))) {
            return { ok: false, reason: 'A building member occupies the excavation.' };
          }
        }
      }
      let placed = 0;
      for (let y = surfaceRow; y <= surfaceRow + 10; y += 1) {
        for (let col = x - 5; col <= x + 5; col += 1) {
          if (world.at(col, y) === PARTICLE_EMPTY) {
            world.set(col, y, PARTICLE_TERRAIN);
            placed += 1;
          }
        }
      }
      refreshSurface();
      return { ok: true, placed };
    },
    repair() {
      refreshSurface();
      syncFoundations();
      return repairOnce();
    },
    repairFrontier() {
      refreshSurface();
      syncFoundations();
      const eligible = new Set(model.sections.filter((section) => section.attached ||
        (section.row === model.rows - 1 && section.vertical)));
      for (const bond of model.bonds) {
        if (bond.a.attached) eligible.add(bond.b);
        if (bond.b.attached) eligible.add(bond.a);
      }
      let spent = 0, completed = 0, result;
      const detectedBlockers = new Set();
      do {
        detectedBlockers.clear();
        result = repairOnce(eligible, detectedBlockers);
        spent += result.spent;
        if (result.spent) completed += 1;
      } while (result.spent);
      return { ...result, state: completed && result.state === 'Blocked' ? 'Rebuilding' : result.state,
        spent, completed, siteBlockers: Array.from(detectedBlockers) };
    },
    step() {
      refreshSurface();
      const lost = syncFoundations();
      if (waterDamageEnabled) applyWaterDamage();
      world.step(waterBlocksAttached || waterBlocksLoose ? waterBlockerGrid() : undefined, waterBlocksLoose);
      model.step(1 / 60);
      return lost;
    },
  };
}
