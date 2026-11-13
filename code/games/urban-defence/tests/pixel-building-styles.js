(() => {
  const output = document.getElementById('style-results');
  const params = new URLSearchParams(location.search);
  const lines = [];
  const check = (name, ok, detail = '') => lines.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  const key = (cell) => `${cell.x},${cell.y}`;

  function structuralChecks() {
    const source = createPixelStyleLabSource();
    for (const level of [1, 3, 7]) {
      const all = [];
      for (const type of PIXEL_BUILDING_TYPES) {
        const silhouettes = new Set();
        for (const style of PIXEL_BUILDING_STYLES) {
          let building;
          try { building = createPixelStyledBuilding(type, style, level, { source }); } catch (error) {
            check(`L${level} ${style} ${type} places`, false, error.message); continue;
          }
          all.push(building);
          const { styled, prepared, world } = building;
          const frame = new Set(prepared.geometry.frameCells.map(key));
          const ornaments = [...styled.ornamentCells, ...styled.structureCells];
          check(`L${level} ${style} ${type} has style ornaments`, styled.ornamentCells.length >= 3,
            `${styled.ornamentCells.length} px`);
          if (type === 'population') {
            const all = new Set(styled.geometry.frameCells.map(key));
            const middleY = Math.round((prepared.surfaceY + Math.min(...prepared.geometry.frameCells.map((c) => c.y))) / 2);
            const thick = prepared.geometry.poles.every((pole) => [0, 1, 2].every((dx) =>
              [-2, -1, 0, 1, 2].every((dy) => all.has(`${pole + dx},${middleY + dy}`))));
            const floorRow = [...new Set(prepared.geometry.frameCells.map((c) => c.y))].find((y) =>
              y > middleY && prepared.geometry.frameCells.filter((c) => c.y === y).length > 6);
            const floorThin = !all.has(`${prepared.geometry.poles[0] + 4},${floorRow - 1}`) &&
              !all.has(`${prepared.geometry.poles[0] + 4},${floorRow + 1}`);
            check(`L${level} ${style} population pillars 3 px, floors 1 px`, thick && floorThin);
          }
          if (style === 'modern' && type !== 'farm') {
            const bodyTop = Math.min(...prepared.geometry.frameCells.map((c) => c.y));
            const top = Math.min(...styled.ornamentCells.map((c) => c.y));
            const want = type === 'population' ? 24 : 16;
            const baseWidth = styled.ornamentCells.filter((c) => c.y === bodyTop - 8).length;
            check(`L${level} modern ${type} antenna is long, thick and lit`,
              bodyTop - top >= want && baseWidth >= 3 && styled.accentCells.length === 2,
              `${bodyTop - top} px tall, ${baseWidth} px wide low on mast, ${styled.accentCells.length} beacons`);
          }
          const blocked = new Set([...prepared.foundationCells, ...prepared.basementCells, ...prepared.geometry.seeds]
            .map(key));
          prepared.geometry.poles.forEach((pole, index) => [0, 1, 2].forEach((dx) => [0, 1, 2].forEach((dy) =>
            blocked.add(key({ x: pole + dx, y: prepared.foundationRows[index] + dy })))));
          (prepared.metadata.silos || []).forEach((silo) => silo.storageCells.forEach((cell) => blocked.add(key(cell))));
          check(`L${level} ${style} ${type} ornaments avoid cores, foundation and storage`,
            ornaments.every((cell) => !blocked.has(key(cell)) && !frame.has(key(cell))));
          const reach = new Set(frame), queue = [...ornaments], pending = new Map(ornaments.map((c) => [key(c), c]));
          let progress = true;
          while (progress) {
            progress = false;
            for (const [k, cell] of pending) {
              if ([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => reach.has(`${cell.x + dx},${cell.y + dy}`))) {
                reach.add(k); pending.delete(k); progress = true;
              }
            }
          }
          check(`L${level} ${style} ${type} ornaments 4-connected to frame`, pending.size === 0 && queue.length > 0);
          check(`L${level} ${style} ${type} base frame preserved`,
            prepared.geometry.frameCells.every((cell, index) => key(styled.geometry.frameCells[index]) === key(cell)));
          check(`L${level} ${style} ${type} within world`, styled.geometry.frameCells.every((cell) =>
            cell.y >= 1 && cell.x >= styled.geometry.bounds.left && cell.x <= styled.geometry.bounds.right) &&
            styled.geometry.bounds.left >= 3 && styled.geometry.bounds.right + 3 < world.width);
          const left = styled.geometry.bounds.left, bottom = styled.surfaceY;
          silhouettes.add(styled.geometry.frameCells.map((cell) => `${cell.x - left},${bottom - cell.y}`).sort().join(';'));
        }
        check(`L${level} ${type} has three distinct style silhouettes`, silhouettes.size === 3, `${silhouettes.size}`);
      }
      if (level === 3) {
        const popHeights = all.filter((b) => b.type === 'population').map((b) => b.stats.bodyHeight / b.stats.trooperHeight);
        check('L3 population tower bodies are 15–20 trooper heights',
          popHeights.every((ratio) => ratio >= 15 && ratio <= 20.5), popHeights.map((r) => r.toFixed(1)).join(', '));
      }
    }
    const world = createParticleWorldFromSurfaceWaterAndTunnels({ heightAt: (x) => source.heights[Math.floor(x / 4)] },
      () => null, [], { width: source.width, height: source.height, cellSize: 4, originX: 0, originY: 0,
        supportCapacity: 1024, skipEmptyChunks: true });
    const prepared = prepareAdaptivePixelSeed(world, source, 0, 0, [], 40, { type: 'military', level: 3, style: 'gothic' });
    const before = JSON.stringify(prepared);
    stylePixelBuildingGeometry(world, prepared, 'gothic');
    check('styling does not mutate the prepared seed', JSON.stringify(prepared) === before);
    let rejected = false;
    try { stylePixelBuildingGeometry(world, prepared, 'baroque'); } catch (error) { rejected = true; }
    check('unknown style rejected', rejected);
  }

  function simulationChecks(level) {
    const source = createPixelStyleLabSource();
    for (const type of PIXEL_BUILDING_TYPES) {
      for (const style of PIXEL_BUILDING_STYLES) {
        const started = performance.now();
        const building = createPixelStyledBuilding(type, style, level, { source });
        const { scenario, world } = building;
        while (!scenario.finished && scenario.ticks < 300000 && !scenario.coreDestroyed) scenario.step();
        const intact = scenario.plan.every((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER);
        const ornamentsBuilt = building.styled.ornamentCells.every((cell) => world.at(cell.x, cell.y) === PARTICLE_BARRIER);
        check(`L${level} ${style} ${type} builds through simulation`, scenario.finished && intact && ornamentsBuilt,
          `${scenario.ticks} ticks, ${Math.round(performance.now() - started)} ms`);
        check(`L${level} ${style} ${type} no collapse debris`, world.debrisCount === 0, `${world.debrisCount}`);
        check(`L${level} ${style} ${type} HM accounting`, scenario.hm === scenario.initialHM - scenario.spent &&
          scenario.spent <= building.stats.hmCost, `spent ${scenario.spent}/${building.stats.hmCost}`);
      }
    }
  }

  // Every rooftop crown of every style must fit, whole, on every population shape at low, mid and top levels.
  function antennaChecks() {
    for (const level of [1, 4, 7]) {
      for (const style of PIXEL_BUILDING_STYLES) {
        const picked = new Set();
        for (const variant of PIXEL_BUILDING_VARIANTS.population) {
          for (const crown of PIXEL_ANTENNA_VARIANTS[style]) {
            const building = createPixelStyledBuilding('population', style, level, { variant, antenna: crown });
            const crowns = building.styled.metadata.crowns;
            check(`L${level} ${style} ${variant} carries ${crown} whole`, crowns.length > 0 &&
              crowns.every((c) => c.variant === crown && c.pixels > 20 && c.kept === c.pixels),
              crowns.map((c) => `${c.variant} ${c.kept}/${c.pixels}`).join(', ') || 'no crown');
          }
          const auto = createPixelStyledBuilding('population', style, level, { variant });
          for (const c of auto.styled.metadata.crowns) picked.add(c.variant);
        }
        check(`L${level} ${style} streets mix crowns`, picked.size >= 2, [...picked].join(', '));
      }
    }
  }

  function run(simulate) {
    lines.length = 0;
    try {
      structuralChecks();
      antennaChecks();
      if (simulate) simulationChecks(Number(params.get('simLevel') || 1));
    } catch (error) { check('check runner', false, error.stack || error.message); }
    const failed = lines.filter((line) => line.startsWith('FAIL')).length;
    output.textContent = `${lines.length - failed}/${lines.length} passed\n${lines.join('\n')}`;
  }

  document.getElementById('style-run-checks').addEventListener('click', () => {
    output.textContent = 'Running…'; setTimeout(() => run(true), 20);
  });
  if (params.has('checks')) setTimeout(() => run(params.get('checks') === 'sim'), 0);
})();
