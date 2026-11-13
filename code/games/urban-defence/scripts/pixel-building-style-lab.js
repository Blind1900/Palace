// Building type lab: every building type in each shape variant (columns) and faction style (rows), plus a
// defences sheet of the roof devices, control panels and guard troops. Each card is its own particle world,
// so previews are real structure under load and "Build through simulation" uses the construction scenario.
(() => {
  const $ = (id) => document.getElementById(id);
  const grid = $('style-grid'), typeSelect = $('style-type'), levelSelect = $('style-level');
  const speedSelect = $('style-speed'), interiorToggle = $('style-interior'), statusLabel = $('style-fps');
  const query = new URLSearchParams(location.search);
  const SCALE = 2, SKY = [16, 25, 29], DOOR_SHADE = 0.5, STAIR_SHADE = 0.78;
  const TYPES = [...PIXEL_BUILDING_TYPES, 'defences', 'garrison', 'district', 'antennas'];
  // Antennas sheet: every population shape (columns) carries every crown of every style (rows), so each crown is
  // proven interchangeable across the population shapes.
  const DEFENCE_COLUMNS = ['turret', 'launcher', 'interceptor', 'panel', 'guards'];
  // Garrison sheet: population buildings on a wide arena, guards man the side windows against attackers.
  const GARRISON_COLUMNS = ['slab', 'setback', 'crown'], GARRISON_WIDTH = 230;
  // District sheet: layouts as columns, each style plus a mixed-style street as rows.
  const DISTRICT_MIX = ['gothic', 'asian', 'modern'];
  const TYPE_LABELS = { garrison: 'Garrison (window defence)', district: 'District (infill, roads, runway)', antennas: 'Antenna variants' };
  const art = createPixelUnitArtwork(PIXEL_UNIT_REFERENCE, { cellScale: 1, cellReduction: 4 });
  // Vehicle artworks at map scale, when their references are loaded.
  const vehicleArts = new Map();
  const vehicleArt = (kind) => {
    if (!vehicleArts.has(kind)) {
      const reference = kind === 'tank' ? (typeof PIXEL_TANK_REFERENCE !== 'undefined' ? PIXEL_TANK_REFERENCE : null)
        : kind === 'jet' ? (typeof PIXEL_JET_REFERENCE !== 'undefined' ? PIXEL_JET_REFERENCE : null)
          : (typeof PIXEL_HOPPER_REFERENCE !== 'undefined' ? PIXEL_HOPPER_REFERENCE : null);
      const roles = { tank: ['move', 'aim'], hopper: ['idle', 'jump', 'boost', 'fall'], jet: ['fly', 'shoot', 'down'] }[kind];
      vehicleArts.set(kind, reference && typeof createPixelVehicleUnit === 'function'
        ? createPixelUnitArtwork(reference, { roles, cellScale: PIXEL_UNIT_RELATIVE_SCALES[kind],
          cellReduction: 4, inPlace: kind === 'hopper' }) : null);
    }
    return vehicleArts.get(kind);
  };
  const capitalise = (text) => text[0].toUpperCase() + text.slice(1);
  for (const type of TYPES) typeSelect.add(new Option(TYPE_LABELS[type] || capitalise(type), type));
  for (let level = 1; level <= 7; level += 1) levelSelect.add(new Option(`Level ${level}`, level));
  typeSelect.value = TYPES.includes(query.get('type')) ? query.get('type') : 'population';
  levelSelect.value = String(Math.min(7, Math.max(1, Number(query.get('level')) || 4)));
  let cards = [], generation = 0, simulating = false, demo = false, fighting = false, mask = null;

  const rgb = (color) => [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  const trooperColor = (color) => { const [r, g, b] = rgb(color); return [Math.min(255, r + 40), Math.min(255, g + 120), b]; };
  const enemyColor = (color) => { const [r, g, b] = rgb(color); return [Math.min(255, r + 150), Math.round(g * 0.45), Math.round(b * 0.4)]; };
  const deadColor = (color) => { const [r, g, b] = rgb(color); const v = Math.round((r + g + b) / 6) + 30; return [v, v - 6, v - 10]; };
  const shade = (color, amount) => color.map((value) => Math.round(value * amount));
  const mix = (a, b, t) => a.map((value, index) => Math.round(value * (1 - t) + b[index] * t));
  const unitMask = (world) => {
    if (!mask) mask = createPixelTerrainUnit(world, art, { x: 2, y: 0, facing: 1 }).inspect({ sprites: false }).collision;
    return mask;
  };
  const maskBounds = () => ({ bottom: Math.max(...mask.map((p) => p.y)), left: Math.min(...mask.map((p) => p.x)),
    right: Math.max(...mask.map((p) => p.x)) });
  const groundAt = (world, x) => { let y = 0; while (y < world.height - 1 && world.at(x, y) === PARTICLE_EMPTY) y += 1; return y; };
  const peakLoad = (world) => typeof world.inspectStructuralLoads === 'function'
    ? Math.round(Math.max(0, ...world.inspectStructuralLoads().map((cell) => cell.load))) : null;

  // ---------- Building cards ----------
  // Colours for one building's pixels (frame, wall detail, windows, stairs, doors, ornaments, devices, core).
  function paintBuilding(building, style, colors, backWindows, explicitFrame = false) {
    const { world, styled, scenario, shape } = building, key = (x, y) => y * world.width + x;
    const paint = (cells, color) => { for (const cell of cells) colors.set(key(cell.x, cell.y), color); };
    const palette = PIXEL_BUILDING_STYLE_PALETTES[style];
    if (explicitFrame) paint(styled.geometry.frameCells, palette.frame);
    if (building.wallDetail) for (const [k, color] of building.wallDetail) colors.set(k, color);
    if (building.windows) {
      for (const cell of building.windows.side) colors.set(key(cell.x, cell.y), pixelWindowColor(cell.part, 'side', style));
      for (const cell of building.windows.back) backWindows.set(key(cell.x, cell.y), pixelWindowColor(cell.part, 'back', style));
    }
    for (const k of shape.oneWay) colors.set(k, shade(palette.frame, STAIR_SHADE));
    for (const k of shape.passThrough) colors.set(k, shade(palette.frame, DOOR_SHADE));
    paint(styled.ornamentCells, palette.ornament);
    paint(styled.accentCells || [], [235, 52, 40]);
    for (const device of building.devices) {
      if (device.fixture) continue;
      for (const cell of device.cells) colors.set(key(cell.x, cell.y), pixelDeviceColor(cell.part, device.kind, style));
    }
    for (const k of shape.coreHousing) colors.set(k, PIXEL_CORE_SHADE);
    paint(scenario.inspectCore().cells, PIXEL_CORE_COLOR);
    paint(styled.geometry.seeds || [], PIXEL_CORE_COLOR);
  }
  // Interior tint only where the clear cell is enclosed (frame above and on both sides), not door approaches.
  function enclosedInterior(world, keepClear, plan) {
    const key = (x, y) => y * world.width + x;
    return new Set([...keepClear].filter((k) => {
      const x = k % world.width, y = Math.floor(k / world.width);
      const hit = (dx, dy) => { for (let s = 1; s < 60; s += 1) if (plan.has(key(x + dx * s, y + dy * s))) return true; return false; };
      return hit(0, -1) && hit(-1, 0) && hit(1, 0);
    }));
  }

  function createBuildingCard(entry, simulate) {
    const level = Number(levelSelect.value);
    const garrison = entry.type === 'garrison', antennas = entry.type === 'antennas';
    const building = createPixelStyledBuilding(garrison || antennas ? 'population' : entry.type, entry.style, level,
      { variant: entry.variant, previewFinished: !simulate, ...(garrison ? { width: GARRISON_WIDTH } : {}),
        ...(antennas ? { antenna: entry.crown } : {}) });
    const { world, scenario, shape } = building, key = (x, y) => y * world.width + x;
    const colors = new Map(), backWindows = new Map();
    const palette = PIXEL_BUILDING_STYLE_PALETTES[entry.style];
    paintBuilding(building, entry.style, colors, backWindows);
    Object.assign(entry, { building, world, colors, palette, backWindows, plan: new Set(scenario.plan.map((cell) => key(cell.x, cell.y))),
      units: [], guards: [], fixtures: building.devices.filter((device) => device.fixture), demoState: null });
    entry.interior = enclosedInterior(world, shape.keepClear, entry.plan);
    unitMask(building.unitWorld);
    if (!simulate) settle(entry);
  }

  // District card: every lot in one world with infill props and the road layer.
  function createDistrictCard(entry) {
    const layout = PIXEL_DISTRICT_LAYOUTS[entry.variant], mixed = entry.style === 'mixed';
    const lots = layout.lots.map((lot, index) => ({ ...lot, style: mixed ? DISTRICT_MIX[index % DISTRICT_MIX.length] : entry.style }));
    const district = createPixelDistrict(lots, layout.gaps, Number(levelSelect.value));
    const { world } = district, key = (x, y) => y * world.width + x;
    const colors = new Map(), backWindows = new Map(), plan = new Set();
    for (const lot of district.buildings) {
      paintBuilding(lot.building, lot.style, colors, backWindows, true);
      for (const cell of lot.building.scenario.plan) plan.add(key(cell.x, cell.y));
    }
    for (const [k, cell] of district.props) colors.set(k, pixelDistrictPropColor(cell.part, cell.style, cell.x, cell.y));
    const keepClear = new Set(district.buildings.flatMap((lot) => [...lot.building.shape.keepClear]));
    Object.assign(entry, { district, building: null, world, colors, backWindows, plan, roadColors: district.road,
      palette: PIXEL_BUILDING_STYLE_PALETTES[lots[0].style], units: [], guards: [], demoState: null,
      fixtures: district.buildings.flatMap((lot) => lot.building.devices.filter((device) => device.fixture).map((device) => ({ ...device, style: lot.style }))) });
    entry.interior = enclosedInterior(world, keepClear, plan);
    unitMask(district.unitWorld);
    for (let i = 0; i < 60; i += 1) world.step();
    entry.load = peakLoad(world);
    entry.settled = true;
  }

  // Lets physics act on the finished frame, then places guards in the soldier slots.
  function settle(entry) {
    for (let i = 0; i < 30; i += 1) entry.world.step();
    entry.load = peakLoad(entry.world);
    const { shape, unitWorld } = entry.building;
    entry.slots = findPixelSoldierSlots(unitWorld, shape, mask, shape.soldiersPerFloor).map((floor) => {
      const capacity = (shape.floors.find((entry) => entry.storey === floor.storey) || {}).capacity || 0;
      return { ...floor, slots: floor.slots.slice(0, capacity) };
    });
    // Slots are found with the right-facing mask; alternate facings only where the mirrored mask also fits.
    entry.guards = entry.slots.flatMap((floor) => floor.slots).map((slot, index) => {
      if (index % 2) { try { return createPixelTerrainUnit(unitWorld, art, { x: slot.x, y: slot.y, facing: -1 }); } catch (error) { /* mirrored mask blocked */ } }
      return createPixelTerrainUnit(unitWorld, art, { x: slot.x, y: slot.y, facing: 1 });
    });
    entry.settled = true;
  }

  function buildingStatus(entry) {
    if (entry.error) return `Cannot place: ${entry.error}`;
    if (entry.battle) {
      const { stats } = entry.battle, ports = entry.battle.ports.length;
      const alive = entry.battle.defenders.filter((defender) => !defender.dead).length;
      return [`window posts manned ${entry.battle.manned()}/${ports} · guards ${alive}`,
        `guard shots ${stats.shots} · hits ${stats.hits} · kills ${stats.kills}`,
        `attackers ${stats.spawned} · return fire ${stats.enemyShots} · guards lost ${stats.guardsLost}`,
        `tick ${stats.ticks} · load ${entry.load ?? '?'}/1024 · debris ${entry.world.debrisCount}`].join('\n');
    }
    const { building, world } = entry, { stats, shape, scenario } = building;
    const capacity = shape.floors.reduce((sum, floor) => sum + (floor.capacity || 0), 0);
    const placed = entry.slots ? entry.slots.reduce((sum, floor) => sum + floor.slots.length, 0) : 0;
    const devices = building.devices.map((device) => device.kind === 'interceptor' ? 'intercept' : device.kind).join(', ') || 'none';
    const progress = building.preview ? `finished preview · load ${entry.load ?? '?'}/1024`
      : scenario.finished ? `built in ${scenario.ticks} ticks · load ${entry.load ?? '?'}/1024`
        : `${scenario.plan.filter((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER).length}/${scenario.plan.length} px · tick ${scenario.ticks}`;
    return [`${stats.storeys} floors × ${stats.soldiersPerFloor} soldiers · guards ${placed}/${capacity}`,
      `${stats.width}w × ${stats.bodyHeight}h px (${(stats.bodyHeight / 8).toFixed(1)} troopers) · ${stats.framePixels} px`,
      shape.hangar ? `${trafficLine(entry)}` : `devices: ${devices}`,
      ...(entry.crown ? [crownLine(building)] : []), `${progress} · debris ${world.debrisCount}`].join('\n');
  }
  // Antenna sheet: which crown each major roof carries and how many of its pixels were built (all = intact).
  function crownLine(building) {
    const crowns = building.styled.metadata.crowns || [];
    return crowns.length ? `crown ${crowns.map((c) => `${c.variant} ${c.kept}/${c.pixels}${c.kept === c.pixels ? '' : ' CLIPPED'}`).join(', ')}` : 'crown NONE';
  }
  function trafficLine(entry) {
    const traffic = entry.demoState && entry.demoState.traffic;
    const found = hangarOf(entry);
    if (!traffic || !Object.keys(traffic).length) return found ? mechFit(found.shape) : '';
    return Object.entries(traffic).map(([kind, r]) => `${kind} ${r.exited}/${r.spawned}${kind === 'jet' ? ` up ${r.airborne}` : ''}` +
      `${r.stuck ? ` stuck ${r.stuck}` : ''}${r.blocked ? ` blocked ${r.blocked}` : ''}`).join(' · ');
  }
  function districtStatus(entry) {
    if (entry.error) return `Cannot place: ${entry.error}`;
    const { report, infill } = entry.district, walk = entry.demoState && entry.demoState.walk;
    const gaps = infill.map((gap) => `${gap.gap}px: ${gap.items.filter((item) => item !== 'railings').join(', ') || 'railings'}`);
    return [`${report.buildings} buildings${report.failures.length ? ` · FAILED ${report.failures.join('; ')}` : ''} · props ${report.props} px · bridges ${report.bridgePixels} px`,
      gaps.join(' | '),
      `${report.runwayBlocked.length ? `runway blocked ${report.runwayBlocked.join('/')} px · ` : ''}doors blocked ${report.doorsBlocked}` +
        `${walk ? ` · street walk ${walk.done ? (walk.reached ? walk.label : `STUCK@${walk.x}`) : `x${walk.x}`}` : ''}`,
      `${hangarOf(entry) ? `${trafficLine(entry)} · ` : ''}load ${entry.load ?? '?'}/1024 · debris ${entry.world.debrisCount}`].join('\n');
  }

  // ---------- Defence cards (small pad worlds) ----------
  function createDefenceCard(entry) {
    const source = createPixelStyleLabSource(56, 0);
    const world = createParticleWorldFromSurfaceWaterAndTunnels({ heightAt: (x) => source.heights[Math.floor(x / 4)] },
      () => null, [], { width: source.width, height: source.height, cellSize: 4, originX: 0, originY: 0,
        supportCapacity: 1024, skipEmptyChunks: true });
    const ground = groundAt(world, 2), colors = new Map(), key = (x, y) => y * world.width + x;
    Object.assign(entry, { world, colors, plan: new Set(), palette: PIXEL_BUILDING_STYLE_PALETTES[entry.style],
      fixtures: [], units: [], guards: [], ground });
    unitMask(world);
    const { bottom } = maskBounds();
    if (entry.kind === 'guards') {
      // Three lilac guards patrol the pad; the green trooper stands still for comparison.
      entry.guards = [8, 22, 36].map((x, index) => createPixelTerrainUnit(world, art, { x, y: ground - 1 - bottom, facing: index % 2 ? -1 : 1 }));
      entry.units = [createPixelTerrainUnit(world, art, { x: 46, y: ground - 1 - bottom, facing: -1 })];
      entry.patrol = true;
    } else {
      const stamp = pixelDeviceStamp(entry.kind, entry.style, 1);
      const x = Math.floor((world.width - stamp.width) / 2) + 4, y = ground - stamp.height;
      const cells = stamp.cells.map((cell) => ({ x: x + cell.dx, y: y + cell.dy, part: cell.part }));
      if (entry.kind === 'panel') entry.fixtures = [{ kind: 'panel', cells }];
      else {
        buildPixelCellsInstantly(world, cells);
        for (const cell of cells) colors.set(key(cell.x, cell.y), pixelDeviceColor(cell.part, entry.kind, entry.style));
      }
      entry.stamp = stamp;
      entry.units = [createPixelTerrainUnit(world, art, { x: 3, y: ground - 1 - bottom, facing: 1 })];
      for (let i = 0; i < 30; i += 1) world.step();
    }
    entry.crop = { left: 0, top: ground - 20, width: world.width, height: 26 };
  }

  function defenceStatus(entry) {
    if (entry.error) return `Error: ${entry.error}`;
    if (entry.kind === 'guards') return ['Guard troops: ground troopers in lilac', 'uniform, same mask as the trooper.',
      'Stand in building floor slots and', 'patrol pads; green = regular trooper.'].join('\n');
    const { stamp } = entry;
    return [`${PIXEL_DEVICE_LABELS[entry.kind]} · ${stamp.width}×${stamp.height} px`,
      `${stamp.cells.length} px · ${(stamp.height / 8).toFixed(1)} trooper heights`,
      entry.kind === 'panel' ? 'interior fixture (never blocks walking)' : `real structure · debris ${entry.world.debrisCount}`,
      { turret: 'roof gun, faces the enemy side', launcher: 'angled missile rail', interceptor: 'radar dish + cells',
        panel: 'hangar / command cab console' }[entry.kind]].join('\n');
  }

  // ---------- Grid construction ----------
  function columnsFor(type) {
    return type === 'defences' ? DEFENCE_COLUMNS : type === 'garrison' ? GARRISON_COLUMNS
      : type === 'antennas' ? PIXEL_BUILDING_VARIANTS.population
      : type === 'district' ? Object.keys(PIXEL_DISTRICT_LAYOUTS) : PIXEL_BUILDING_VARIANTS[type];
  }
  function columnLabel(type, column) {
    if (type === 'district') return PIXEL_DISTRICT_LAYOUTS[column].label;
    return type === 'defences' ? PIXEL_DEVICE_LABELS[column] : PIXEL_BUILDING_VARIANT_LABELS[column] || capitalise(column);
  }

  function buildCards(simulate = false) {
    generation += 1;
    const token = generation, type = typeSelect.value, columns = columnsFor(type);
    simulating = false; demo = false; fighting = false;
    grid.textContent = '';
    grid.style.gridTemplateColumns = `80px repeat(${columns.length}, minmax(0, 1fr))`;
    grid.append(Object.assign(document.createElement('div'), { className: 'head' }));
    for (const column of columns) grid.append(Object.assign(document.createElement('div'), { className: 'head', textContent: columnLabel(type, column) }));
    cards = [];
    const rows = type === 'district' ? [...PIXEL_BUILDING_STYLES, 'mixed'].map((style) => ({ style }))
      : type === 'antennas' ? PIXEL_BUILDING_STYLES.flatMap((style) => PIXEL_ANTENNA_VARIANTS[style].map((crown) => ({ style, crown })))
        : PIXEL_BUILDING_STYLES.map((style) => ({ style }));
    for (const { style, crown } of rows) {
      grid.append(Object.assign(document.createElement('div'), { className: 'row-head',
        textContent: style === 'mixed' ? 'Mixed' : PIXEL_BUILDING_STYLE_PALETTES[style].label + (crown ? `: ${crown}` : '') }));
      for (const column of columns) {
        const card = Object.assign(document.createElement('div'), { className: 'card' });
        const canvas = document.createElement('canvas'), info = document.createElement('pre');
        canvas.setAttribute('aria-label', `${style} ${type} ${column}`);
        info.textContent = 'queued…';
        card.append(canvas, info); grid.append(card);
        cards.push({ type, style, crown, card, canvas, info, ...(type === 'defences' ? { kind: column } : { variant: column }) });
      }
    }
    let index = 0;
    const next = () => {
      if (token !== generation) return;
      if (index < cards.length) {
        const entry = cards[index];
        statusLabel.textContent = `Preparing ${index + 1}/${cards.length}…`;
        try { if (entry.kind) createDefenceCard(entry); else if (type === 'district') createDistrictCard(entry); else createBuildingCard(entry, simulate); }
        catch (error) { entry.error = error.message; entry.card.classList.add('failed'); }
        index += 1; setTimeout(next, 0); return;
      }
      if (type !== 'defences') fitCrops();
      if (type === 'garrison') { cards.forEach(startBattle); fighting = !simulate; }
      cards.forEach(draw);
      statusLabel.textContent = simulate ? 'Simulating construction…' : 'Ready';
      document.body.dataset.ready = String(token);
      if (simulate) simulating = true;
      if (type === 'garrison' && query.has('demoTicks') && !simulate) {
        // Headless checks: fight synchronously and report each building's garrison.
        const ticks = Number(query.get('demoTicks')) || 0;
        for (let t = 0; t < ticks; t += 1) for (const entry of cards) if (entry.battle) entry.battle.step();
        cards.forEach(draw);
        document.body.dataset.demo = cards.filter((entry) => entry.battle).map((entry) => {
          const { stats } = entry.battle;
          return `${entry.style}/${entry.variant}:ports=${entry.battle.ports.length},manned=${entry.battle.manned()},` +
            `shots=${stats.shots},hits=${stats.hits},kills=${stats.kills},enemyShots=${stats.enemyShots},lost=${stats.guardsLost},` +
            `spawned=${stats.spawned},debris=${entry.world.debrisCount}`;
        }).join(' ');
        fighting = false;
      }
      if (query.has('demo') && !simulate && type !== 'garrison') {
        startDemo();
        // Headless checks: advance the demo synchronously and report where every climber got to.
        const ticks = Number(query.get('demoTicks')) || 0;
        // Time-capped so a runaway card is reported (data-demo-time) instead of freezing the page.
        const spent = new Map(), deadline = performance.now() + 8000;
        let ran = 0;
        for (; ran < ticks && performance.now() < deadline; ran += 1) for (const entry of cards) {
          const t0 = performance.now(); stepDemo(entry);
          spent.set(entry, (spent.get(entry) || 0) + performance.now() - t0);
        }
        if (ticks) document.body.dataset.demoTime = `ran=${ran}/${ticks} ` + [...spent].sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([entry, ms]) => `${entry.style}/${entry.variant}=${Math.round(ms)}ms`).join(' ');
        if (ticks) {
          cards.forEach(draw);
          const traffic = (entry) => Object.entries(entry.demoState.traffic).map(([kind, r]) =>
            `${kind}=${r.exited}/${r.spawned}${kind === 'jet' ? `^${r.airborne}` : ''}${r.stuck ? `s${r.stuck}` : ''}${r.blocked ? `b${r.blocked}(${(r.error || '').slice(0, 40)})` : ''}`).join(',');
          document.body.dataset.demo = cards.filter((entry) => entry.demoState).map((entry) => {
            if (entry.district) {
              const { report } = entry.district, walk = entry.demoState.walk || {};
              return `${entry.style}/${entry.variant}:walk=${walk.reached ? walk.label : `STUCK@${walk.x}`},runway=${report.runwayBlocked.join('/') || '-'},` +
                `doors=${report.doorsBlocked},props=${report.props},bridge=${report.bridgePixels},fail=${report.failures.length},` +
                `debris=${entry.world.debrisCount},load=${entry.load}${hangarOf(entry) ? `,${traffic(entry)}` : ''}`;
            }
            const result = entry.demoState.result, hangar = entry.building.shape.hangar;
            return `${entry.style}/${entry.variant}:${result ? `${result.done ? 'TOP' : 'STUCK'}${result.reached}/${result.topStorey}` : 'none'}` +
              (hangar ? `,${traffic(entry)},${mechFit(entry.building.shape)}` : '');
          }).join(' ');
          demo = false; // Headless report done: don't keep animating (virtual-time budgets would never drain).
        }
      }
      kick();
    };
    setTimeout(next, 0);
  }

  // One shared scale per sheet: equal crop size, each centred on its own building.
  function fitCrops() {
    for (const entry of cards) {
      if (!entry.district) continue;
      const { world, district } = entry;
      const top = Math.max(0, Math.min(...district.buildings.flatMap((lot) => lot.building.styled.geometry.frameCells.map((cell) => cell.y))) - 4);
      entry.crop = { left: 0, top, width: world.width, height: Math.min(world.height - top, district.surfaceY + 7 - top + 1) };
    }
    const built = cards.filter((entry) => entry.building);
    if (!built.length) return;
    const top = Math.max(0, Math.min(...built.map((entry) => Math.min(...entry.building.styled.geometry.frameCells.map((cell) => cell.y)))) - 4);
    const bottom = Math.max(...built.map((entry) => entry.building.styled.surfaceY)) + 7;
    // Runways count towards the building's footprint so the whole strip stays in view.
    const extentOf = (entry) => {
      const { bounds } = entry.building.styled.geometry, runway = entry.building.shape && entry.building.shape.runway;
      return runway ? { left: Math.min(bounds.left, runway.from), right: Math.max(bounds.right, runway.to) } : bounds;
    };
    const width = Math.max(...built.map((entry) => { const e = extentOf(entry); return e.right - e.left + 1; })) + 34;
    for (const entry of cards) {
      if (!entry.building) continue;
      const bounds = extentOf(entry), world = entry.world;
      const centre = Math.round((bounds.left + bounds.right) / 2) - 6;
      const left = Math.max(0, Math.min(world.width - width, centre - Math.floor(width / 2)));
      entry.crop = entry.type === 'garrison' ? { left: 0, top, width: world.width, height: Math.min(world.height - top, bottom - top + 1) }
        : { left, top, width: Math.min(width, world.width), height: Math.min(world.height - top, bottom - top + 1) };
    }
  }

  function startBattle(entry) {
    if (!entry.building || !entry.settled || !entry.crop || entry.battle) return;
    const { world } = entry;
    entry.battle = createPixelGarrisonBattle({ building: entry.building, guards: entry.guards, art,
      spawn: { left: entry.crop.left + 1, right: entry.crop.left + entry.crop.width - 2, groundAt: (x) => groundAt(world, x) },
      seed: cards.indexOf(entry) + 1 });
  }

  // ---------- Drawing ----------
  function draw(entry) {
    const { canvas } = entry, context = canvas.getContext('2d');
    if (!entry.crop) {
      canvas.width = 120; canvas.height = 60; context.fillStyle = '#2a1414'; context.fillRect(0, 0, 120, 60);
      entry.info.textContent = entry.kind ? defenceStatus(entry) : entry.district ? districtStatus(entry) : buildingStatus(entry); return;
    }
    const { world, crop, colors, palette, plan } = entry, interior = interiorToggle.checked;
    const keepClear = entry.interior || null;
    if (canvas.width !== crop.width * SCALE) { canvas.width = crop.width * SCALE; canvas.height = crop.height * SCALE; }
    const image = new ImageData(crop.width, crop.height), data = image.data;
    const set = (x, y, color) => {
      const px = x - crop.left, py = y - crop.top;
      if (px < 0 || py < 0 || px >= crop.width || py >= crop.height) return;
      const index = (py * crop.width + px) * 4;
      data[index] = color[0]; data[index + 1] = color[1]; data[index + 2] = color[2]; data[index + 3] = 255;
    };
    for (let y = crop.top; y < crop.top + crop.height; y += 1) {
      for (let x = crop.left; x < crop.left + crop.width; x += 1) {
        const material = world.at(x, y), k = y * world.width + x;
        let color = SKY;
        if (material === PARTICLE_TERRAIN) color = (entry.roadColors && entry.roadColors.get(k)) || (y % 5 === 0 ? [92, 70, 48] : [110, 84, 56]);
        else if (material === PARTICLE_WATER) color = [52, 110, 190];
        else if (material === PARTICLE_BARRIER) color = colors.get(k) || palette.frame;
        else if (material === PARTICLE_DEBRIS) color = [150, 150, 150];
        else if (material === PARTICLE_CONSTRUCTION) color = [255, 150, 40];
        else if (plan.has(k)) color = shade(colors.get(k) || palette.frame, 0.3);
        else if (entry.backWindows && entry.backWindows.has(k) && (!entry.building || entry.building.preview || entry.building.scenario.finished)) color = entry.backWindows.get(k);
        else if (interior && keepClear && keepClear.has(k)) color = mix(SKY, palette.frame, 0.16);
        set(x, y, color);
      }
    }
    if (entry.building && !entry.building.preview) {
      for (const agent of entry.building.scenario.deliveries) set(agent.x, agent.y, [255, 196, 60]);
    }
    if (interior || entry.kind) {
      for (const fixture of entry.fixtures) for (const cell of fixture.cells) {
        if (world.at(cell.x, cell.y) === PARTICLE_EMPTY) set(cell.x, cell.y, pixelDeviceColor(cell.part, 'panel', fixture.style || entry.style));
      }
      if (entry.battle) {
        for (const defender of entry.battle.defenders) drawUnit(set, defender.unit, defender.dead ? deadColor : pixelGuardColor);
      } else for (const unit of entry.guards) drawUnit(set, unit, pixelGuardColor);
    }
    if (entry.battle) {
      const battle = entry.battle;
      for (const enemy of battle.enemies) drawUnit(set, enemy.unit, enemy.dead ? deadColor : enemyColor);
      for (const port of battle.ports) if (port.flash > 0) {
        for (let dy = -1; dy <= 1; dy += 1) set(port.outerX + port.outward, Math.round((port.top + port.bottom) / 2) + dy, [255, 236, 150]);
      }
      for (const bullet of battle.bullets) {
        const color = bullet.owner === 'guard' ? [255, 228, 120] : [255, 96, 80];
        set(Math.round(bullet.x), Math.round(bullet.y), color);
        set(Math.round(bullet.x - bullet.vx), Math.round(bullet.y - bullet.vy), shade(color, 0.6));
      }
      for (const spark of battle.sparks) set(spark.x, spark.y, spark.kind === 'hit' ? [255, 60, 60] : [255, 210, 140]);
    }
    for (const unit of entry.units) drawUnit(set, unit, unit.kind && unit.kind !== 'trooper' ? rgb : trooperColor);
    if (entry.building && !entry.units.length && !entry.battle) {
      // Reference trooper standing beside the building at ground level.
      const { bottom, right } = maskBounds(), x = entry.building.styled.geometry.bounds.left - right - 4;
      const pixels = art.frame('walk', 0, 1).pixels, y = groundAt(world, x + 2) - 1 - bottom;
      for (const pixel of pixels) set(x + pixel.x, y + pixel.y, trooperColor(pixel.color));
    }
    const off = document.createElement('canvas');
    off.width = crop.width; off.height = crop.height; off.getContext('2d').putImageData(image, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(off, 0, 0, canvas.width, canvas.height);
    entry.info.textContent = entry.kind ? defenceStatus(entry) : entry.district ? districtStatus(entry) : buildingStatus(entry);
    const finished = entry.building ? entry.building.preview || entry.building.scenario.finished : true;
    entry.card.classList.toggle('done', finished && world.debrisCount === 0);
    entry.card.classList.toggle('failed', Boolean(entry.error) || world.debrisCount > 0);
  }

  function drawUnit(set, unit, tint) {
    const state = unit.inspect();
    for (const pixel of state.pixels) set(state.x + pixel.x, state.y + pixel.y, tint(pixel.color));
  }

  // ---------- Unit demo: climb every stair, and the hangar spawns units out of its door ----------
  // The hangar cycles trooper, tank and jet; jets roll down the runway and pull up before its end.
  const HANGAR_CYCLE = ['trooper', 'tank', 'jet'];
  const TRACE = new URLSearchParams(location.search).has('trace');
  function hangarOf(entry) {
    if (entry.district) {
      const lot = entry.district.buildings.find((candidate) => candidate.building.shape.hangar);
      return lot ? { shape: lot.building.shape, unitWorld: entry.district.unitWorld } : null;
    }
    return entry.building.shape.hangar ? { shape: entry.building.shape, unitWorld: entry.building.unitWorld } : null;
  }
  // Mech fit uses its visible body (the current collision mask is a 20 x 30 envelope, reported to main).
  function mechFit(shape) {
    const mech = vehicleArt('hopper');
    if (!mech) return 'mech art not loaded';
    const pixels = mech.frame('idle', 0, 1).pixels, xs = pixels.map((p) => p.x), ys = pixels.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
    const clear = shape.hangar.floorY - shape.hangar.clearTop, door = shape.hangar.floorY - shape.hangar.doorTop;
    const inside = shape.hangar.right - shape.hangar.left + 1;
    return `mech ${w}x${h} ${h + 6 <= clear && h <= door && w <= inside ? 'fits' : 'TOO BIG'} (clear ${clear}, door ${door}, floor ${inside})`;
  }
  function spawnFromHangar(entry, kind) {
    const { shape, unitWorld } = hangarOf(entry), hangar = shape.hangar, state = entry.demoState;
    const record = state.traffic[kind] || (state.traffic[kind] = { spawned: 0, exited: 0, stuck: 0, airborne: 0, blocked: 0 });
    try {
      let unit;
      if (kind === 'trooper') {
        const { bottom } = maskBounds();
        unit = createPixelTerrainUnit(unitWorld, art, { x: hangar.spawn.x - 4, y: hangar.floorY - 1 - bottom, facing: hangar.door });
      } else {
        const vehicle = vehicleArt(kind);
        if (!vehicle) return;
        unitWorld.clearAnchor();
        const probe = createPixelVehicleUnit(unitWorld, vehicle, { kind, x: 4, y: 1, facing: hangar.door }).inspect({ sprites: false }).collision;
        const bottom = Math.max(...probe.map((p) => p.y)), right = Math.max(...probe.map((p) => p.x));
        const x = hangar.door > 0 ? hangar.bay.left : hangar.bay.right - right;
        unit = createPixelVehicleUnit(unitWorld, vehicle, { kind, x, y: hangar.floorY - 1 - bottom, facing: hangar.door });
        unit.bottom = bottom;
      }
      record.spawned += 1;
      entry.units.push(Object.assign(unit, { spawned: true, kind, age: 0, best: 0, idle: 0 }));
    } catch (error) { record.blocked += 1; record.error = error.message; }
  }
  function stepHangarTraffic(entry) {
    const found = hangarOf(entry);
    if (!found) return;
    const { shape, unitWorld } = found, hangar = shape.hangar, runway = shape.runway, state = entry.demoState;
    if (state.tick % 150 === 1 && entry.units.filter((unit) => unit.spawned).length < 3) {
      spawnFromHangar(entry, HANGAR_CYCLE[state.cycle % HANGAR_CYCLE.length]); state.cycle += 1;
    }
    const end = runway ? (hangar.door > 0 ? runway.to : runway.from) : null;
    for (const unit of entry.units) {
      if (!unit.spawned) continue;
      if (unit.kind === 'trooper') unitWorld.anchorUnit(unit); else unitWorld.clearAnchor();
      unit.input.left = hangar.door < 0; unit.input.right = hangar.door > 0;
      if (unit.kind === 'jet' && runway) {
        const x = unit.inspect({ sprites: false }).x, travelled = (x - runway.from) * hangar.door + (hangar.door < 0 ? runway.length : 0);
        unit.input.up = travelled > runway.length * 0.35 && unit.inspect({ sprites: false }).y > hangar.floorY - 60;
      }
      if (TRACE) console.log(`trace ${entry.style}/${entry.variant} t${state.tick} ${unit.kind} step`, JSON.stringify(unit.inspect({ sprites: false })).slice(0, 160));
      unit.step(1 / 60); unit.age += 1;
      const progress = unit.inspect({ sprites: false }).x * hangar.door;
      if (progress > unit.best) { unit.best = progress; unit.idle = 0; } else unit.idle += 1;
    }
    entry.units = entry.units.filter((unit) => {
      if (!unit.spawned) return true;
      const record = state.traffic[unit.kind], info = unit.inspect({ sprites: false }), { y } = info;
      // Leading edge: long vehicles (30+ px) would hit the next building before their origin passed the end.
      const xs = info.collision && info.collision.length ? info.collision.map((p) => info.x + p.x) : [info.x];
      const x = hangar.door > 0 ? Math.max(...xs) : Math.min(...xs);
      const past = end !== null ? (hangar.door > 0 ? x > end : x < end) : false;
      const outside = x <= entry.crop.left + 2 || x >= entry.crop.left + entry.crop.width - 12;
      if (past || outside) {
        record.exited += 1;
        if (unit.kind === 'jet' && y + unit.bottom < hangar.floorY - 10) record.airborne += 1;
        return false;
      }
      if (unit.idle > 240 || unit.age > 1200) { record.stuck += 1; return false; }
      return true;
    });
  }
  // District: one trooper walks the whole street from the left edge, through every ground floor, to the
  // right edge. A last lot with no exit on its far side (farm sheds) ends the walk at its door instead.
  function streetGoal(entry) {
    const last = entry.district.buildings[entry.district.buildings.length - 1];
    if (!last || last.building.shape.doors.some((door) => door.side > 0)) return { x: entry.world.width - 14, label: 'END' };
    const door = last.building.shape.doors.find((d) => d.side < 0);
    return door ? { x: door.x - 6, label: 'DOOR' } : { x: last.reach.left - 10, label: 'LOT' };
  }
  function stepStreetWalker(entry) {
    const state = entry.demoState, unitWorld = entry.district.unitWorld, { bottom } = maskBounds();
    if (!state.walker) {
      const x = 6;
      state.walker = Object.assign(createPixelTerrainUnit(unitWorld, art, { x, y: groundAt(entry.world, x + 3) - 1 - bottom, facing: 1 }),
        { best: 0, idle: 0 });
      entry.units.push(state.walker);
      state.goal = streetGoal(entry);
    }
    const walker = state.walker;
    if (state.walk && state.walk.done) return;
    unitWorld.anchorUnit(walker, { through: true }); walker.input.right = true; walker.input.left = false;
    walker.step(1 / 60);
    const x = walker.inspect({ sprites: false }).x;
    if (x > walker.best) { walker.best = x; walker.idle = 0; } else walker.idle += 1;
    if (x >= state.goal.x) state.walk = { done: true, reached: true, x, label: state.goal.label };
    else if (walker.idle > 240) state.walk = { done: true, reached: false, x };
    else state.walk = { done: false, x };
  }

  function startDemo() {
    demo = true;
    for (const entry of cards) {
      if ((!entry.building && !entry.district) || !entry.settled) continue;
      entry.units = []; entry.demoState = { tick: 0, climber: null, wait: 0, spawned: 0, cycle: 0, traffic: {} };
      if (entry.building) resetClimber(entry);
    }
    kick();
  }

  function resetClimber(entry) {
    const { shape, unitWorld } = entry.building, { bottom, left, right } = maskBounds(), state = entry.demoState;
    if (state.climberUnit) entry.units = entry.units.filter((unit) => unit !== state.climberUnit);
    state.climber = null; state.climberUnit = null;
    if (!shape.stairs.length) return;
    let start, direction;
    if (shape.hangar) {
      start = { x: shape.hangar.spawn.x - 4, y: shape.hangar.floorY - 1 - bottom }; direction = -shape.hangar.door;
    } else {
      const door = shape.doors.find((d) => !d.hangar && d.side < 0) || shape.doors.find((d) => !d.hangar);
      if (!door) return;
      const x = door.side < 0 ? door.x - 9 - right : door.x + 9 - left;
      start = { x, y: groundAt(entry.world, x + 3) - 1 - bottom }; direction = -door.side;
    }
    const unit = createPixelTerrainUnit(unitWorld, art, { ...start, facing: direction });
    state.climberUnit = unit; entry.units.push(unit);
    state.climber = createPixelStairClimber(unit, shape, { finalDirection: direction, unitWorld });
  }

  function stepDemo(entry) {
    const state = entry.demoState;
    if (!state) return false;
    state.tick += 1;
    if (entry.district) { stepStreetWalker(entry); stepHangarTraffic(entry); return true; }
    if (state.climber) {
      if (state.wait > 0) { state.wait -= 1; if (state.wait === 0) resetClimber(entry); }
      else { if (TRACE) console.log(`trace ${entry.style}/${entry.variant} t${state.tick} climber`); const result = state.climber.step(); if (result.done || result.stuck) { state.wait = 120; state.result = result; } }
    }
    stepHangarTraffic(entry);
    return true;
  }

  function stepPatrol(entry) {
    for (const unit of entry.guards) {
      const { x, facing } = unit.inspect({ sprites: false });
      const turn = (facing > 0 && x > entry.world.width - 16) || (facing < 0 && x < 4);
      unit.input.right = turn ? facing < 0 : facing > 0; unit.input.left = !unit.input.right;
      unit.step(1 / 60);
    }
  }

  // ---------- Main loop (time-budgeted so the page stays responsive) ----------
  let looping = false, frames = 0, last = performance.now();
  function kick() { if (!looping) { looping = true; requestAnimationFrame(loop); } }
  function loop(now) {
    const started = performance.now(), budget = 14, speed = Number(speedSelect.value);
    let active = false;
    const dirty = new Set();
    if (simulating) {
      const pending = cards.filter((entry) => entry.building && !entry.building.scenario.finished && entry.building.scenario.ticks < 400000);
      for (let round = 0; pending.length && performance.now() - started < budget; round += 1) {
        for (const entry of pending) {
          for (let i = 0; i < speed && !entry.building.scenario.finished; i += 1) entry.building.scenario.step();
          dirty.add(entry);
        }
        if (speed <= 10) break;
      }
      for (const entry of pending) if (entry.building.scenario.finished && !entry.settled) {
        settle(entry); dirty.add(entry);
        if (entry.type === 'garrison') { startBattle(entry); fighting = true; }
      }
      active = pending.some((entry) => !entry.building.scenario.finished);
      if (!active) { simulating = false; statusLabel.textContent = 'All buildings finished'; }
    }
    if (demo) for (const entry of cards) if (stepDemo(entry)) { dirty.add(entry); active = true; }
    if (fighting) for (const entry of cards) if (entry.battle) { entry.battle.step(); dirty.add(entry); active = true; }
    for (const entry of cards) if (entry.patrol) { stepPatrol(entry); dirty.add(entry); active = true; }
    dirty.forEach(draw);
    frames += 1;
    if (now - last > 1000) {
      if (simulating || demo) statusLabel.textContent = `${frames} fps${simulating ? ' · simulating' : ''}${demo ? ' · unit demo' : ''}`;
      frames = 0; last = now;
    }
    if (active || simulating) requestAnimationFrame(loop); else looping = false;
  }

  $('style-build').addEventListener('click', () => buildCards(true));
  $('style-instant').addEventListener('click', () => {
    simulating = false;
    for (const entry of cards) {
      if (!entry.building || entry.building.preview) continue;
      const { scenario } = entry.building;
      while (!scenario.finished && scenario.ticks < 400000 && !scenario.coreDestroyed) scenario.step();
      if (!entry.settled) settle(entry);
    }
    cards.forEach(draw);
  });
  $('style-pause').addEventListener('click', () => { simulating = false; demo = false; fighting = false; });
  $('style-demo').addEventListener('click', () => {
    if (typeSelect.value === 'garrison') { cards.forEach(startBattle); fighting = true; kick(); } else startDemo();
  });
  $('style-reset').addEventListener('click', () => buildCards(false));
  typeSelect.addEventListener('change', () => buildCards(false));
  levelSelect.addEventListener('change', () => buildCards(false));
  interiorToggle.addEventListener('change', () => cards.forEach(draw));
  buildCards(query.has('simulate'));
})();
