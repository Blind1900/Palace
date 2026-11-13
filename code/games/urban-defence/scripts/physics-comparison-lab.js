(function () {
  const waterCanvas = document.getElementById('water-view');
  const collapseCanvas = document.getElementById('collapse-view');
  const particleCanvas = document.getElementById('particle-view');
  const hazardCanvas = document.getElementById('hazard-view');
  const waterContext = waterCanvas.getContext('2d');
  const collapseContext = collapseCanvas.getContext('2d');
  const particleContext = particleCanvas.getContext('2d');
  const hazardContext = hazardCanvas.getContext('2d');
  const waterStats = document.getElementById('water-stats');
  const collapseStats = document.getElementById('collapse-stats');
  const particleStats = document.getElementById('particle-stats');
  const hazardStats = document.getElementById('hazard-stats');
  const checks = document.getElementById('checks');
  const clockStatus = document.getElementById('clock-status');
  const runButton = document.getElementById('run');
  const colors = {
    empty: '#050805', terrain: '#71634b', water: '#239fc5',
    barrier: '#bce77b', debris: '#c88c58',
  };
  let water, collapse, particles, breached = false, running = false, animation;
  const seconds = 1 / 60;
  let hazardMessage = '';

  function makeHazards() {
    return createThermalHazardWorld();
  }

  function makeWater() {
    const world = createPhysicsTestWorld(40, 24);
    for (let y = 3; y < 22; y += 1) {
      for (let x = 2; x < 38; x += 1) world.setSolid(x, y, false);
    }
    for (let y = 4; y < 22; y += 1) world.setSolid(18, y, true);
    for (let y = 9; y <= 13; y += 1) {
      for (let x = 4; x <= 15; x += 1) world.setWater(x, y, 1);
    }
    return world;
  }

  function makeCollapse() {
    return createCollapseModel({ columns: 7, rows: 7, size: 18, left: 137, ground: 188 });
  }

  function makeParticles() {
    const world = createParticleWorld(40, 24, { skipEmptyRows: true });
    for (let x = 0; x < world.width; x += 1) world.set(x, 22, PARTICLE_TERRAIN);
    for (let y = 14; y < 22; y += 1) {
      world.set(9, y, PARTICLE_TERRAIN);
      world.set(30, y, PARTICLE_TERRAIN);
    }
    world.constructBarrier(9, 15, 20);
    world.constructBarrier(30, 15, 20);
    for (let x = 10; x < 30; x += 1) {
      const emitted = world.emitConstruction(x, 19);
      if (!emitted.ok) throw new Error(`Could not seed comparison bridge at ${x},19: ${emitted.reason}`);
      const settled = world.settleConstruction(x, 19);
      if (!settled.ok) throw new Error(`Could not support comparison bridge at ${x},19`);
    }
    for (let y = 18; y < 22; y += 1) {
      for (let x = 3; x < 8; x += 1) world.set(x, y, PARTICLE_WATER);
    }
    return world;
  }

  function reset() {
    water = makeWater();
    collapse = makeCollapse();
    particles = makeParticles();
    hazards = makeHazards();
    hazardMessage = '';
    breached = false;
    render();
  }

  function drawWater() {
    const ctx = waterContext, sx = waterCanvas.width / water.width, sy = waterCanvas.height / water.height;
    ctx.fillStyle = colors.empty; ctx.fillRect(0, 0, waterCanvas.width, waterCanvas.height);
    for (let y = 0; y < water.height; y += 1) {
      for (let x = 0; x < water.width; x += 1) {
        if (water.isSolid(x, y)) {
          ctx.fillStyle = colors.terrain;
          ctx.fillRect(x * sx, y * sy, sx, sy);
        } else if (water.waterAt(x, y) > 0) {
          ctx.fillStyle = colors.water;
          ctx.globalAlpha = 0.35 + water.waterAt(x, y) * 0.65;
          ctx.fillRect(x * sx, y * sy, sx, sy);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.fillStyle = '#d7e8d0';
    ctx.font = '12px system-ui';
    ctx.fillText('SOURCE', 38, 48);
    ctx.fillText('DRY CHAMBER', 218, 48);
    const moved = Array.from({ length: 19 }, (_, y) =>
      Array.from({ length: 18 }, (_, x) => water.waterAt(x + 19, y + 3)))
      .flat().reduce((sum, value) => sum + value, 0);
    waterStats.textContent = `Tick ${tickCount} · water ${water.totalWater().toFixed(1)} / 60.0 · chamber ${moved.toFixed(1)} · ${breached ? 'divider open' : 'divider closed'}`;
  }

  function drawCollapse() {
    const ctx = collapseContext;
    ctx.fillStyle = colors.empty; ctx.fillRect(0, 0, collapseCanvas.width, collapseCanvas.height);
    ctx.fillStyle = colors.terrain; ctx.fillRect(0, collapse.ground, collapseCanvas.width, 8);
    for (const section of collapse.sections) {
      if (section.cleared) continue;
      ctx.save();
      ctx.translate(section.x + collapse.size / 2, section.y + collapse.size / 2);
      ctx.rotate(section.angle);
      ctx.fillStyle = section.attached
        ? section.health < 40 ? '#dd675b' : section.health < 75 ? '#e5c25e' : colors.barrier
        : colors.debris;
      const width = section.horizontal ? collapse.size : collapse.wallThickness;
      const height = section.vertical ? collapse.size : collapse.thickness;
      ctx.fillRect(-width / 2, -height / 2, width, height);
      ctx.restore();
    }
    const attached = collapse.sections.filter((section) => section.attached).length;
    collapseStats.textContent = `Tick ${tickCount} · attached ${attached} / ${collapse.sections.length} · loose members ${collapse.fragments.length}`;
  }

  function drawParticles() {
    const ctx = particleContext, sx = particleCanvas.width / particles.width;
    const sy = particleCanvas.height / particles.height;
    ctx.fillStyle = colors.empty; ctx.fillRect(0, 0, particleCanvas.width, particleCanvas.height);
    for (let y = 0; y < particles.height; y += 1) {
      for (let x = 0; x < particles.width; x += 1) {
        const material = particles.at(x, y);
        if (material === PARTICLE_EMPTY) continue;
        ctx.fillStyle = material === PARTICLE_TERRAIN ? colors.terrain :
          material === PARTICLE_WATER ? colors.water :
            material === PARTICLE_BARRIER ? colors.barrier :
              material === PARTICLE_DEBRIS ? colors.debris : '#e8e4a8';
        ctx.fillRect(x * sx, y * sy, sx + 0.2, sy + 0.2);
      }
    }
    particleStats.textContent = `Tick ${tickCount} · water ${particles.waterCount} · barriers ${particles.barrierCount} · falling debris ${particles.debrisCount}`;
  }

  function drawHazards() {
    const ctx = hazardContext, sx = hazardCanvas.width / hazards.width;
    const sy = hazardCanvas.height / hazards.height;
    const { EMPTY, ROCK, BUILDING, LAVA, BASALT, DEBRIS } = hazards.materials;
    const palette = {
      [ROCK]: colors.terrain, [BUILDING]: colors.barrier, [LAVA]: '#f76c28',
      [BASALT]: '#292d30', [DEBRIS]: colors.debris,
    };
    ctx.fillStyle = colors.empty; ctx.fillRect(0, 0, hazardCanvas.width, hazardCanvas.height);
    for (let y = 0; y < hazards.height; y += 1) {
      for (let x = 0; x < hazards.width; x += 1) {
        const material = hazards.at(x, y);
        if (material !== EMPTY) {
          ctx.fillStyle = palette[material];
          ctx.fillRect(x * sx, y * sy, sx + 0.2, sy + 0.2);
          const temperature = hazards.temperatureAt(x, y);
          if (temperature > 100 && material !== LAVA) {
            ctx.fillStyle = `rgba(255, 64, 16, ${Math.min(0.82, (temperature - 100) / 1100)})`;
            ctx.fillRect(x * sx, y * sy, sx + 0.2, sy + 0.2);
          }
        }
      }
    }
    if (hazards.beam) {
      ctx.fillStyle = '#fff5a8';
      ctx.strokeStyle = '#fff5a8';
      ctx.lineWidth = Math.max(2, sy * 0.3);
      ctx.beginPath();
      ctx.moveTo(sx / 2, (hazards.beam.path[0].y + 0.5) * sy);
      const last = hazards.beam.path[hazards.beam.path.length - 1];
      ctx.lineTo((last.x + 0.5) * sx, (last.y + 0.5) * sy);
      ctx.stroke();
    }
    hazardStats.textContent = `Tick ${tickCount} · peak ${Math.round(hazards.maximumTemperature)}°C · hot cells ${hazards.hotCellCount} · damaged building cells ${hazards.damagedBuildingCount} · lava ${hazards.lavaCount} · basalt ${hazards.basaltCount}${hazardMessage ? ` · ${hazardMessage}` : ''}`;
  }

  function render() {
    drawWater();
    drawCollapse();
    drawParticles();
    drawHazards();
  }

  let tickCount = 0;
  function step() {
    water.step();
    collapse.step(seconds);
    particles.step();
    hazards.step();
    tickCount += 1;
  }

  function advance(count) {
    for (let i = 0; i < count; i += 1) step();
    render();
  }

  function setRunning(value) {
    running = value;
    runButton.textContent = running ? 'Pause all' : 'Run all';
    runButton.setAttribute('aria-pressed', String(running));
    clockStatus.textContent = running ? 'Running · fixed 60 Hz, catch-up capped' : 'Paused';
    if (running) {
      const clock = createFixedStepClock(() => { step(); render(); });
      const frame = (timestamp) => {
        if (!running) return;
        clock.advance(timestamp);
        animation = requestAnimationFrame(frame);
      };
      animation = requestAnimationFrame(frame);
    } else if (animation !== undefined) {
      cancelAnimationFrame(animation);
      animation = undefined;
    }
  }

  function runChecks() {
    const output = [];
    function check(name, run) {
      try { run(); output.push(`PASS ${name}`); }
      catch (error) { output.push(`FAIL ${name}: ${error.message}`); }
    }
    function assert(value, message) { if (!value) throw new Error(message); }
    check('water conserves total volume while flowing into the opened chamber', () => {
      const model = makeWater();
      const initial = model.totalWater();
      for (let y = 14; y <= 17; y += 1) model.setSolid(18, y, false);
      for (let i = 0; i < 600; i += 1) model.step();
      const chamber = Array.from({ length: 19 }, (_, y) =>
        Array.from({ length: 18 }, (_, x) => model.waterAt(x + 19, y + 3)))
        .flat().reduce((sum, value) => sum + value, 0);
      assert(Math.abs(model.totalWater() - initial) < 1e-8 && chamber > 0,
        'water leaked or did not enter the chamber');
    });
    check('structural support loss releases connected members', () => {
      const model = makeCollapse();
      model.blast(146, 180, 22, 200);
      for (let i = 0; i < 120; i += 1) model.step(seconds);
      assert(model.fragments.length > 0, 'damaged frame did not release debris');
    });
    check('shared-grid support loss releases barriers as conserved debris', () => {
      const model = createParticleWorld(9, 8);
      for (let x = 0; x < 9; x += 1) model.set(x, 7, PARTICLE_TERRAIN);
      assert(model.emitConstruction(4, 6).ok && model.settleConstruction(4, 6).ok,
        'supported barrier fixture could not be built');
      model.excavate(4, 7, 4, 7);
      model.step();
      assert(model.debrisCount === 1 && model.barrierCount === 0,
        'unsupported barrier did not become falling debris');
    });
    check('lava flows without losing cells, then cools into basalt', () => {
      const model = makeHazards();
      const poured = model.pour();
      for (let i = 0; i < 30; i += 1) model.step();
      assert(poured === 12 && model.lavaCount === poured, 'flowing lava lost or duplicated cells');
      for (let i = 0; i < 1260; i += 1) model.step();
      assert(model.lavaCount < poured && model.basaltCount > 0, 'stationary lava did not cool');
    });
    check('lava conducts heat into adjacent building cells', () => {
      const model = makeHazards();
      model.pour();
      for (let i = 0; i < 240; i += 1) model.step();
      assert(model.temperatureAt(17, 19) > 20,
        'lava did not warm the building beside its channel');
    });
    check('sustained lava contact damages building health', () => {
      const model = makeHazards();
      model.pour();
      for (let i = 0; i < 1260; i += 1) model.step();
      assert(model.damagedBuildingCount > 0,
        'conducted heat did not reduce any building cell health');
    });
    check('thermal conduction conserves enthalpy when ambient cooling is disabled', () => {
      const model = makeHazards();
      model.pour();
      const initial = model.totalEnthalpy();
      for (let i = 0; i < 120; i += 1) model.step({ ambientCooling: false });
      assert(Math.abs(model.totalEnthalpy() - initial) < 1e-6,
        'conduction or material movement created or lost heat');
    });
    check('exposed hot material loses heat to ambient', () => {
      const model = makeHazards();
      model.pour();
      const initial = model.totalEnthalpy();
      for (let i = 0; i < 120; i += 1) model.step();
      assert(model.totalEnthalpy() < initial,
        'ambient cooling did not remove heat');
    });
    check('sufficient heat melts rock while retaining thermal energy', () => {
      const model = makeHazards();
      const before = model.totalEnthalpy();
      model.addHeat(11, 20, 30000);
      model.step({ ambientCooling: false });
      assert(model.at(11, 20) === model.materials.LAVA &&
        model.totalEnthalpy() >= before + 29999,
      'heated rock did not melt or preserve its enthalpy');
    });
    check('laser cuts heat neighboring material', () => {
      const model = makeHazards();
      const before = model.temperatureAt(17, 13);
      model.fireLaser(14);
      assert(model.temperatureAt(17, 13) > before,
        'laser did not deposit heat beside its cut');
    });
    check('laser energy cuts building members but is limited by solid terrain', () => {
      const model = makeHazards(), before = model.buildingCount;
      const cut = model.fireLaser(14);
      assert(cut.hits > 0 && model.buildingCount < before, 'building beam did not cut structure');
      const ground = model.fireLaser(20);
      assert(ground.hits > 0 && ground.energy <= 0, 'surface beam did not spend limited energy on rock');
    });
    check('diagonal lasers cut through structure along both trajectories', () => {
      const rising = makeHazards(), risingBefore = rising.buildingCount;
      const up = rising.fireLaser(16, -0.25);
      const falling = makeHazards(), fallingBefore = falling.buildingCount;
      const down = falling.fireLaser(9, 0.25);
      assert(up.path.some((cell) => cell.y < 16) && up.hits > 0 && rising.buildingCount < risingBefore,
        'upward diagonal missed the structure');
      assert(down.path.some((cell) => cell.y > 9) && down.hits > 0 && falling.buildingCount < fallingBefore,
        'downward diagonal missed the structure');
    });
    check('meteor impacts excavate a crater and leave movable debris', () => {
      const model = makeHazards(), displaced = model.meteor();
      for (let i = 0; i < 8; i += 1) model.step();
      assert(displaced > 0 && model.debrisCount > 0,
        'impact did not create falling debris');
    });
    checks.textContent = output.join('\n');
  }

  document.getElementById('run').addEventListener('click', () => setRunning(!running));
  document.getElementById('step').addEventListener('click', () => advance(60));
  document.getElementById('reset').addEventListener('click', () => {
    setRunning(false); tickCount = 0; reset();
  });
  document.getElementById('water-breach').addEventListener('click', () => {
    if (breached) return;
    for (let y = 14; y <= 17; y += 1) water.setSolid(18, y, false);
    breached = true; render();
  });
  document.getElementById('collapse-blast').addEventListener('click', () => {
    collapse.blast(146, 180, 22, 200); render();
  });
  document.getElementById('particle-blast').addEventListener('click', () => {
    particles.impact(9, 19, 2); render();
  });
  document.getElementById('particle-build').addEventListener('click', () => {
    const placed = particles.emitConstruction(20, 18);
    if (!placed.ok) {
      document.getElementById('particle-stats').textContent = `Construction not placed: ${placed.reason}`;
      return;
    }
    const settled = particles.settleConstruction(20, 18);
    if (!settled.ok) throw new Error(`Supported construction failed: ${settled.reason}`);
    render();
  });
  document.getElementById('pour-lava').addEventListener('click', () => {
    const placed = hazards.pour();
    if (!placed) {
      hazardMessage = 'pool full; let it flow/cool before pouring again';
      render();
      return;
    }
    hazardMessage = `poured ${placed} cells`;
    render();
  });
  document.getElementById('laser-building').addEventListener('click', () => {
    const result = hazards.fireLaser(14);
    hazardMessage = `building laser cut ${result.hits}; energy ${result.energy}`;
    render();
  });
  document.getElementById('laser-up').addEventListener('click', () => {
    const result = hazards.fireLaser(16, -0.25);
    hazardMessage = `upward diagonal cut ${result.hits}; energy ${result.energy}`;
    render();
  });
  document.getElementById('laser-down').addEventListener('click', () => {
    const result = hazards.fireLaser(9, 0.25);
    hazardMessage = `downward diagonal cut ${result.hits}; energy ${result.energy}`;
    render();
  });
  document.getElementById('laser-ground').addEventListener('click', () => {
    const result = hazards.fireLaser(20);
    hazardMessage = `surface laser cut ${result.hits}; energy ${result.energy}`;
    render();
  });
  document.getElementById('meteor').addEventListener('click', () => {
    hazardMessage = `meteor displaced ${hazards.meteor()} cells`;
    render();
  });

  reset();
  runChecks();
  setRunning(true);
}());
