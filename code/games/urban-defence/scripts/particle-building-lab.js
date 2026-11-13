(function () {
  const canvas = document.getElementById('lab');
  const ctx = canvas.getContext('2d');
  const fps = createLabFps(document.getElementById('fps'));
  const status = document.getElementById('status');
  const saveStatus = document.getElementById('save-status');
  const repairStatus = document.getElementById('repair-status');
  const saveKey = 'urban-defence-particle-building-lab-v1';
  const pause = document.getElementById('pause');
  const looseWater = document.getElementById('loose-water');
  const waterDamage = document.getElementById('water-damage');
  const showFoundations = document.getElementById('foundations');
  const foundationStatus = document.getElementById('foundation-status');
  const pixels = document.createElement('canvas');
  pixels.width = 160;
  pixels.height = 90;
  const pixelContext = pixels.getContext('2d');
  const image = pixelContext.createImageData(pixels.width, pixels.height);
  const modelOptions = { minimumWallThicknessFactor: 1.5 };
  let scenario = createParticleBuildingScenario(undefined, modelOptions);
  let paused = false;
  let steps = 0;
  looseWater.addEventListener('change', () => {
    scenario.setWaterBlocksLoose(looseWater.checked);
    draw();
  });
  waterDamage.addEventListener('change', () => {
    scenario.setWaterDamageEnabled(waterDamage.checked);
    draw();
  });
  showFoundations.addEventListener('change', draw);
  function undermine(index) { scenario.undermine(index); draw(); }
  for (const [id, index] of [['left', 0], ['middle', 1], ['right', 2]]) {
    document.getElementById(id).addEventListener('click', () => undermine(index));
    document.getElementById(`restore-${id}`).addEventListener('click', () => {
      const result = scenario.restoreGround(index);
      repairStatus.textContent = result.ok ? `Restored ${result.placed} terrain cells.` : `Ground restoration blocked: ${result.reason}`;
      draw();
    });
  }
  document.getElementById('repair').addEventListener('click', () => {
    const result = scenario.repair();
    repairStatus.textContent = `Repair: ${result.state}. Spent ${result.spent} HM.`;
    if (result.state === 'Blocked') {
      repairStatus.textContent += result.siteBlockers.length
        ? ` Site obstacles detected: ${result.siteBlockers.join(', ')}.`
        : ' Sites may be blocked by building members, missing connections or misaligned bonds.';
      if (result.siteBlockers.length) {
        repairStatus.textContent += ' Building members, connections or bond alignment may also block repairs.';
      }
    } else if (result.state === 'Waiting for HM') {
      repairStatus.textContent += ` Each repair costs ${scenario.model.repairCost} HM.`;
    } else if (result.state === 'Destroyed') {
      repairStatus.textContent += ' No attached members remain; this frame cannot rebuild.';
    }
    draw();
  });
  document.getElementById('all').addEventListener('click', () => {
    for (let i = 0; i < scenario.anchorColumns.length; i += 1) scenario.undermine(i);
    draw();
  });
  document.getElementById('breach').addEventListener('click', () => {
    const removed = scenario.breachBasin();
    repairStatus.textContent = removed ? `Basin breached: removed ${removed} terrain cells.` : 'Basin is already breached.';
    draw();
  });
  document.getElementById('blast-wall').addEventListener('click', () => {
    const detached = scenario.blastLeftWall();
    repairStatus.textContent = detached ? 'Lower left wall is detached; water can flow through a clear opening.' :
      'Lower left wall remains attached.';
    draw();
  });
  document.getElementById('clear-particles').addEventListener('click', () => {
    const removed = scenario.clearParticleDebris();
    repairStatus.textContent = `Cleared ${removed} particle debris cells; loose building members remain.`;
    draw();
  });
  document.getElementById('clear-building').addEventListener('click', () => {
    const removed = scenario.clearBuildingDebris();
    repairStatus.textContent = `Cleared ${removed} loose building member${removed === 1 ? '' : 's'}; rebuilding still costs HM.`;
    draw();
  });
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
  });
  function advance() { scenario.step(); steps += 1; }
  document.getElementById('step').addEventListener('click', () => {
    if (!paused) { status.textContent = 'Pause before stepping.'; return; }
    advance();
    draw();
  });
  document.getElementById('reset').addEventListener('click', () => {
    scenario = createParticleBuildingScenario(undefined, modelOptions);
    looseWater.checked = scenario.waterBlocksLoose;
    waterDamage.checked = scenario.waterDamageEnabled;
    steps = 0;
    saveStatus.textContent = '';
    repairStatus.textContent = '';
    draw();
  });
  document.getElementById('save').addEventListener('click', () => {
    try {
      localStorage.setItem(saveKey, JSON.stringify({ version: 1, steps, scenario: scenario.snapshot() }));
      saveStatus.textContent = 'Lab saved in this browser; saving again replaces this slot.';
    } catch (error) {
      saveStatus.textContent = `Could not save lab: ${error.message}`;
    }
  });
  document.getElementById('load').addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(saveKey);
      if (raw === null) throw new Error('No lab save found');
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !Number.isSafeInteger(saved.steps) || saved.steps < 0 ||
          !saved.scenario) throw new Error('Invalid lab save');
      const restored = createParticleBuildingScenario(saved.scenario, modelOptions);
      scenario = restored;
      looseWater.checked = scenario.waterBlocksLoose;
      waterDamage.checked = scenario.waterDamageEnabled;
      steps = saved.steps;
      saveStatus.textContent = 'Lab save loaded.';
      repairStatus.textContent = '';
      draw();
    } catch (error) {
      saveStatus.textContent = `Could not load lab; current world unchanged: ${error.message}`;
    }
  });
  function draw() {
    const { world, model, scale } = scenario;
    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const material = world.at(x, y);
        const surface = material === PARTICLE_TERRAIN && y === scenario.surfaceRow;
        const exposed = material === PARTICLE_TERRAIN && !surface &&
          ((x > 0 && world.at(x - 1, y) !== PARTICLE_TERRAIN) ||
           (x + 1 < world.width && world.at(x + 1, y) !== PARTICLE_TERRAIN) ||
           (y > 0 && world.at(x, y - 1) !== PARTICLE_TERRAIN));
        const color = material === PARTICLE_WATER ? [31, 172, 200] :
          surface ? [63, 193, 95] : exposed ? [215, 181, 96] : [2, 2, 2];
        const i = (y * world.width + x) * 4;
        image.data[i] = color[0]; image.data[i + 1] = color[1];
        image.data[i + 2] = color[2]; image.data[i + 3] = 255;
      }
    }
    pixelContext.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pixels, 0, 0, world.width * scale, world.height * scale);
    drawParticleWaterContacts(ctx, scenario);
    for (const section of model.sections) {
      if (section.cleared) continue;
      ctx.save();
      ctx.translate(section.x + model.size / 2, section.y + model.size / 2);
      ctx.rotate(section.angle);
      ctx.strokeStyle = section.attached ? (section.health < 50 ? '#ed795e' :
        section.health < 90 ? '#e5c365' : '#bce77b') : '#c49059';
      if (section.horizontal) {
        ctx.lineWidth = model.thickness;
        ctx.beginPath(); ctx.moveTo(-model.size / 2, 0); ctx.lineTo(model.size / 2, 0); ctx.stroke();
      }
      if (section.vertical) {
        ctx.lineWidth = model.wallThickness;
        ctx.beginPath(); ctx.moveTo(0, -model.size / 2); ctx.lineTo(0, model.size / 2); ctx.stroke();
      }
      ctx.restore();
    }
    if (showFoundations.checked) {
      const labels = ['Left', 'Middle', 'Right'];
      const foundations = scenario.foundationStatus();
      ctx.save();
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 2;
      foundations.forEach((foundation, index) => {
        const x = (foundation.column + 0.5) * scale;
        const y = scenario.surfaceRow * scale + 8;
        ctx.strokeStyle = foundation.groundPresent ? '#9ee5a8' : '#ff8b6a';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.strokeRect(x - 6, y - 6, 12, 12);
        ctx.fillText(foundation.groundPresent ? '+' : 'X', x, y + 3);
        ctx.fillText(labels[index], x, y + 20);
      });
      ctx.restore();
      const description = foundations.map((foundation, index) =>
        `${labels[index]}: ground ${foundation.groundPresent ? 'present' : 'missing'}, ${foundation.anchored ? 'anchored' : 'not anchored'}`).join(' | ');
      if (foundationStatus.textContent !== description) foundationStatus.textContent = description;
    } else if (foundationStatus.textContent) {
      foundationStatus.textContent = '';
    }
    const attached = model.sections.filter((section) => section.attached);
    const damaged = attached.filter((section) => section.health < 100);
    const weakest = attached.length ? `${Math.max(0, Math.min(...attached.map((section) => section.health))).toFixed(1)}%` : 'none';
    status.textContent = `Step ${steps} | Anchors: ${attached.filter((s) => s.anchored).length} / ${scenario.anchorColumns.length} | Loose members: ${model.fragments.length} | Damaged attached: ${damaged.length} | Weakest attached: ${weakest} | Water particles: ${world.waterCount} | Water blocks: ${scenario.waterBlocksAttached ? 'attached' : 'attached off'}${scenario.waterBlocksLoose ? ' + loose (experimental)' : ''} | Water damage: ${scenario.waterDamageEnabled ? 'on' : 'off'} | HM: ${scenario.hm}`;
    fps.record();
  }
  const clock = createFixedStepClock(() => { if (!paused) advance(); });
  function frame(timestamp) { clock.advance(timestamp); draw(); requestAnimationFrame(frame); }
  draw();
  requestAnimationFrame(frame);
}());
