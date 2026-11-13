(function () {
  const canvas = document.getElementById('lab'), ctx = canvas.getContext('2d');
  const fps = createLabFps(document.getElementById('fps'));
  const pause = document.getElementById('pause'), status = document.getElementById('status');
  const frameHeight = document.getElementById('frame-height');
  const waterDamage = document.getElementById('water-damage');
  const message = document.getElementById('message');
  const gallery = document.getElementById('silhouettes'), galleryCtx = gallery.getContext('2d');
  const silhouetteHeight = document.getElementById('silhouette-height');
  const widths = [38, 62, 58, 60, 32, 60, 30];
  const heights = [155, 145, 150, 140, 135, 145, 165];
  function drawSilhouettes() {
    const heightScale = Number(silhouetteHeight.value);
    galleryCtx.fillStyle = '#020202';
    galleryCtx.fillRect(0, 0, gallery.width, gallery.height);
    galleryCtx.strokeStyle = '#75bd83';
    galleryCtx.fillStyle = '#bce6a0';
    galleryCtx.lineWidth = 1.5;
    galleryCtx.font = '10px sans-serif';
    galleryCtx.textAlign = 'center';
    buildingSilhouetteNames.forEach((name, index) => {
      const center = 50 + index * 100, ground = 190;
      const outline = createBuildingSilhouette(name, center - widths[index] / 2, ground,
        widths[index], heights[index] * heightScale);
      galleryCtx.beginPath();
      galleryCtx.moveTo(outline[0].x, outline[0].y);
      for (const point of outline.slice(1)) galleryCtx.lineTo(point.x, point.y);
      galleryCtx.stroke();
      galleryCtx.fillText(name, center, 212);
    });
    galleryCtx.beginPath();
    galleryCtx.moveTo(0, 190); galleryCtx.lineTo(gallery.width, 190); galleryCtx.stroke();
  }
  silhouetteHeight.addEventListener('change', drawSilhouettes);
  drawSilhouettes();
  const pixels = document.createElement('canvas');
  pixels.width = 160; pixels.height = 90;
  const pixelContext = pixels.getContext('2d');
  const image = pixelContext.createImageData(pixels.width, pixels.height);
  let construction = createConstructionScenario(), paused = false;
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
  });
  document.getElementById('step').addEventListener('click', () => {
    if (!paused) { message.textContent = 'Pause before stepping.'; return; }
    construction.step(); draw();
  });
  document.getElementById('reset').addEventListener('click', () => {
    construction = createConstructionScenario(Number(frameHeight.value));
    waterDamage.checked = construction.scenario.waterDamageEnabled;
    message.textContent = `Construction restarted with ${construction.scenario.model.rows} rows.`;
    draw();
  });
  document.getElementById('undermine').addEventListener('click', () => {
    construction.scenario.undermine(1);
    message.textContent = 'Middle foundation excavated; support updates on the next step.';
    draw();
  });
  document.getElementById('restore').addEventListener('click', () => {
    const result = construction.scenario.restoreGround(1);
    message.textContent = result.ok ? `Restored ${result.placed} ground cells.` : `Restoration blocked: ${result.reason}`;
    draw();
  });
  document.getElementById('clear').addEventListener('click', () => {
    const count = construction.scenario.clearBuildingDebris();
    message.textContent = `Cleared ${count} loose members.`;
    draw();
  });
  document.getElementById('breach').addEventListener('click', () => {
    const removed = construction.scenario.breachBasin();
    message.textContent = removed ? `Basin breached: removed ${removed} terrain cells.` : 'Basin is already breached.';
    draw();
  });
  document.getElementById('blast-wall').addEventListener('click', () => {
    const detached = construction.scenario.blastLeftWall();
    message.textContent = detached ? 'Lower left anchor is detached.' : 'Lower left anchor remains attached.';
    draw();
  });
  waterDamage.addEventListener('change', () => {
    construction.scenario.setWaterDamageEnabled(waterDamage.checked);
    draw();
  });
  function draw() {
    const { world, model, scale } = construction.scenario;
    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const material = world.at(x, y);
        const color = material === PARTICLE_WATER ? [31, 172, 200] :
          material === PARTICLE_TERRAIN && (y === 0 || world.at(x, y - 1) !== PARTICLE_TERRAIN) ? [63, 193, 95] : [2, 2, 2];
        const index = (y * world.width + x) * 4;
        image.data[index] = color[0]; image.data[index + 1] = color[1];
        image.data[index + 2] = color[2]; image.data[index + 3] = 255;
      }
    }
    pixelContext.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pixels, 0, 0, world.width * scale, world.height * scale);
    drawParticleWaterContacts(ctx, construction.scenario);
    ctx.save();
    ctx.fillStyle = '#52634a';
    const dotSize = model.thickness;
    for (const dot of construction.blueprint.dots(construction.blueprintProgress)) {
      ctx.fillRect(dot.x - dotSize / 2, dot.y - dotSize / 2, dotSize, dotSize);
    }
    ctx.restore();
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
    const attached = model.sections.filter((section) => section.attached);
    const damaged = attached.filter((section) => section.health < 100);
    const weakest = attached.length ? `${Math.max(0, Math.min(...attached.map((section) => section.health))).toFixed(1)}%` : 'none';
    const result = construction.result;
    const obstacles = result.siteBlockers.length
      ? ` | Last attempt detected: ${result.siteBlockers.join(', ')}` : '';
    const lastAttempt = result.state === 'Building' ? 'Last attempt: none yet' :
      `Last attempt: ${result.completed} members or bonds, ${result.spent} HM${obstacles}`;
    const phase = construction.blueprintProgress < 1
      ? `Blueprint: ${(construction.blueprintProgress * 100).toFixed(0)}%`
      : construction.finished
        ? `Construction complete; automatic work stopped | ${lastAttempt}`
        : `${result.state} | ${lastAttempt} | Next attempt: ${((60 - construction.ticks) / 60).toFixed(1)} s`;
    status.textContent = `Frame: ${model.rows} rows | Attached: ${attached.length} / ${model.sections.length} | Loose: ${model.fragments.length} | Damaged: ${damaged.length} | Weakest: ${weakest} | Water: ${world.waterCount} | Water damage: ${construction.scenario.waterDamageEnabled ? 'on' : 'off'} | HM: ${construction.scenario.hm} | ${phase}`;
    fps.record();
  }
  const clock = createFixedStepClock(() => { if (!paused) construction.step(); });
  function frame(time) { clock.advance(time); draw(); requestAnimationFrame(frame); }
  draw();
  requestAnimationFrame(frame);
}());
