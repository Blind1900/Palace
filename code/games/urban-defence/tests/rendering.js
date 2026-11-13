(function () {
  const checks = [];
  function check(name, test) {
    try { test(); checks.push(`PASS ${name}`); }
    catch (error) { checks.push(`FAIL ${name}: ${error.message}`); }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  check('faction architecture styles are assigned once as a unique session-wide set', () => {
    const styles = createFactionArchitectureStyles(() => 0);
    assert(new Set(Object.values(styles)).size === 3, 'factions share an architecture style');
    assert(['left', 'right', 'neutral'].every((owner) =>
      ['asian', 'gothic', 'modern'].includes(styles[owner])), 'faction received an unknown style');
    assert(Object.isFrozen(styles), 'session style assignments are mutable');
  });

  check('building renderer draws each current kind without changing model data', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 200;
    const ctx = canvas.getContext('2d');
    const kinds = ['tower', 'flat', 'shed', 'bunker', 'farm', 'military', 'mine'];
    const styles = ['asian', 'gothic', 'modern'];
    const buildings = kinds.map((kind, index) => ({
      kind, style: styles[index % styles.length], x: 10 + index * 35, width: 20, height: 20, owner: 'left', health: 100,
      seed: 1, neutral: false, cropLeft: 4, cropRight: 4, level: 4, direction: 1,
      defenseHealth: 100, damageMarks: index === 0 ? [{ x: 5, y: 5, damage: 50 }] : [],
    }));
    const cores = [{ x: 5, owner: 'left' }];
    const pieces = [{ x: 260, width: 20, top: 60, fractureY: 80, direction: 1, angle: 0.1, age: 1, color: '#356496' }];
    const before = JSON.stringify({ buildings, cores, pieces });
    const renderer = createBuildingRenderer({
      ctx, camera: { x: 0, y: 0, zoom: 1 }, surfaceYAt: () => 100, terrainYAt: () => 100,
      worldToScreen: (x, y) => ({ x, y }),
      drawPixelLine: (x1, y1, x2, y2, color, width = 1.5) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      },
      drawPixelRect: (x, y, width, height, color) => {
        ctx.fillStyle = color; ctx.fillRect(x, y, width, height);
      },
      farmBuildingWidth: 14, buildingBlueprints: buildings, cores, collapsedBuildings: pieces,
    });
    renderer.drawSettlements();
    renderer.drawCollapsedBuildings();
    assert(renderer.buildingColor(buildings[0]) === '#315b82', 'building palette changed');
    assert(ctx.getImageData(0, 0, 300, 200).data.some((value, index) => index % 4 === 3 && value > 0),
      'building renderer produced no visible pixels');
    assert(JSON.stringify({ buildings, cores, pieces }) === before, 'drawing changed simulation data');
  });

  check('bullet tracer fade opacity is honored without leaking canvas state', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 8;
    const ctx = canvas.getContext('2d');
    const renderer = createWorldObjectRenderer();
    ctx.globalAlpha = 0.8;
    renderer.bullet(ctx, { x: 2, y: 4 }, { x: 28, y: 4 }, 0.25);
    assert(ctx.globalAlpha === 0.8, 'bullet fade changed the caller canvas opacity');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const alphas = [];
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) alphas.push(pixels[index]);
    }
    assert(alphas.length > 0 && Math.max(...alphas) < 255,
      'faded bullet tracer was invisible or rendered fully opaque');
  });

  check('architecture palettes pair blue and red styles at matching brightness', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const renderer = createBuildingRenderer({
      ctx, camera: { x: 0, y: 0, zoom: 1 }, surfaceYAt: () => 100, terrainYAt: () => 100,
      worldToScreen: (x, y) => ({ x, y }), drawPixelLine() {}, drawPixelRect() {},
      farmBuildingWidth: 14, buildingBlueprints: [], cores: [], collapsedBuildings: [],
    });
    const styles = ['asian', 'gothic', 'modern'];
    const luminance = (color) => {
      const channels = color.slice(1).match(/.{2}/g).map((channel) => Number.parseInt(channel, 16));
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const leftColors = styles.map((style) => renderer.buildingColor({ owner: 'left', style, kind: 'flat' }));
    const rightColors = styles.map((style) => renderer.buildingColor({ owner: 'right', style, kind: 'flat' }));
    assert(new Set(leftColors).size === styles.length && new Set(rightColors).size === styles.length,
      'architecture styles do not have distinct team shades');
    styles.forEach((style, index) => {
      assert(Math.abs(luminance(leftColors[index]) - luminance(rightColors[index])) <= 5,
        `${style} team colors are not similarly bright`);
    });

    const geometry = styles.map((style) => {
      const paths = [];
      const drawingContext = {
        save() {}, restore() {}, translate() {}, scale() {}, beginPath() {},
        moveTo(x, y) { paths.push(['move', x, y]); },
        lineTo(x, y) { paths.push(['line', x, y]); },
        stroke() {},
      };
      const building = { kind: 'flat', style, x: 20, width: 30, height: 40, owner: 'left', health: 100 };
      const styledRenderer = createBuildingRenderer({
        ctx: drawingContext, camera: { x: 0, y: 0, zoom: 1 }, surfaceYAt: () => 100, terrainYAt: () => 100,
        worldToScreen: (x, y) => ({ x, y }),
        drawPixelLine: (...line) => paths.push(['detail', ...line]),
        drawPixelRect: (...rect) => paths.push(['detail-rect', ...rect]),
        farmBuildingWidth: 14, buildingBlueprints: [building], cores: [], collapsedBuildings: [],
      });
      styledRenderer.drawSettlements();
      return JSON.stringify(paths);
    });
    assert(new Set(geometry).size === styles.length, 'architecture styles do not change building geometry');

    const factionStyles = { left: 'asian', right: 'gothic', neutral: 'modern' };
    const factionRenderer = createBuildingRenderer({
      ctx, camera: { x: 0, y: 0, zoom: 1 }, surfaceYAt: () => 100, terrainYAt: () => 100,
      worldToScreen: (x, y) => ({ x, y }), drawPixelLine() {}, drawPixelRect() {},
      farmBuildingWidth: 14, buildingBlueprints: [], cores: [], collapsedBuildings: [], factionArchitectureStyles: factionStyles,
    });
    const repeatedBuildings = ['left', 'right', 'neutral'].map((owner) => ({ owner, kind: 'flat' }));
    const repeatedColors = repeatedBuildings.map((building) => factionRenderer.buildingColor(building));
    assert(new Set(repeatedColors).size === 3, 'factions do not keep distinct side-wide appearances');
    assert(repeatedBuildings.every((building, index) =>
      factionRenderer.buildingColor(building) === repeatedColors[index]), 'buildings on one side changed style');
  });

  check('faction-generated architecture styles retain distinct buildings and visible damage marks', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 450; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    const factionArchitectureStyles = { left: 'asian', right: 'gothic', neutral: 'modern' };
    const kinds = ['tower', 'flat', 'farm', 'military', 'mine'];
    const owners = ['left', 'right', 'neutral'];
    const buildings = owners.flatMap((owner, factionIndex) => kinds.map((kind, kindIndex) => ({
      kind, owner, x: 18 + factionIndex * 145 + kindIndex * 23, width: 18,
      height: 30 + kindIndex * 4, health: 65, defenseHealth: 80, level: 3, direction: 1,
      seed: kindIndex, cropLeft: 2, cropRight: 2,
      damageMarks: [{ x: 9, y: 15, damage: 70 }],
    })));
    const before = JSON.stringify(buildings);
    const renderer = createBuildingRenderer({
      ctx, camera: { x: 0, y: 0, zoom: 1 }, surfaceYAt: () => 150, terrainYAt: () => 150,
      worldToScreen: (x, y) => ({ x, y }),
      drawPixelLine: (x1, y1, x2, y2, color, width = 1.5) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      },
      drawPixelRect: (x, y, width, height, color) => {
        ctx.fillStyle = color; ctx.fillRect(x, y, width, height);
      },
      farmBuildingWidth: 14, buildingBlueprints: buildings, cores: [], collapsedBuildings: [],
      factionArchitectureStyles,
    });
    renderer.drawSettlements();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let damagePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 180 && pixels[index + 1] < 90 && pixels[index + 2] < 70) damagePixels += 1;
    }
    assert(damagePixels > 0, 'missile-style damage marks were not visible over the generated buildings');
    assert(buildings.every((building) => building.style === undefined &&
      renderer.buildingColor(building) === renderer.buildingColor({
        ...building, style: factionArchitectureStyles[building.owner],
      })), 'a generated building did not inherit its faction architecture style');
    assert(JSON.stringify(buildings) === before, 'drawing styled, damaged buildings changed their simulation data');
  });

  check('object renderers preserve current paths, colors, and input data', () => {
    const calls = [];
    const ctx = {
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() { calls.push(['begin']); },
      moveTo(x, y) { calls.push(['move', x, y]); },
      lineTo(x, y) { calls.push(['line', x, y]); },
      stroke() { calls.push(['stroke', this.strokeStyle, this.lineWidth, this.shadowColor, this.shadowBlur]); },
      strokeRect(x, y, width, height) { calls.push(['rect', x, y, width, height, this.strokeStyle]); },
      fillRect(x, y, width, height) { calls.push(['fill', x, y, width, height, this.fillStyle]); },
    };
    const renderer = createWorldObjectRenderer();
    const points = [{ x: 2, y: 8 }, { x: 9, y: 12 }];
    const before = JSON.stringify(points);
    renderer.road(ctx, points);
    assert(JSON.stringify(calls.slice(0, 4)) === JSON.stringify([
      ['begin'], ['move', 2, 6], ['line', 9, 10], ['stroke', '#000000', 1, null, null],
    ]), 'road drawing changed');
    calls.length = 0;
    renderer.bullet(ctx, points[0], points[1]);
    assert(calls[3][1] === '#bba473' && calls[3][2] === 0.7, 'bullet drawing changed');
    calls.length = 0;
    renderer.tunnel(ctx, { points, interiorWidth: 14 }, false, true, true, 1.5);
    assert(calls[3][1] === '#6ef08a' && calls[3][2] === 17 && calls[3][4] === 5, 'tunnel wall changed');
    calls.length = 0;
    renderer.tunnel(ctx, { points, interiorWidth: 14 }, true, true, true, 1.5);
    assert(calls[3][1] === '#020202' && calls[3][2] === 14 && calls[3][4] === 0, 'tunnel interior changed');
    calls.length = 0;
    renderer.defensiveMine(ctx, 10, 20, '#123456');
    assert(JSON.stringify(calls[0]) === JSON.stringify(['rect', 7, 20, 6, 3, '#123456']), 'defensive mine changed');
    calls.length = 0;
    renderer.missile(ctx, { x: 10, y: 20 }, false);
    renderer.missile(ctx, { x: 10, y: 20 }, true);
    assert(calls[0][5] === '#ffe1a0' && calls[1][5] === '#c9f8ff' && calls[0][3] === 4,
      'missile or interceptor appearance changed');
    assert(JSON.stringify(points) === before, 'drawing changed model data');
  });
  document.getElementById('results').textContent = checks.join('\n');
})();
