(function () {
  const canvas = document.getElementById('lab');
  const ctx = canvas.getContext('2d');
  const fps = createLabFps(document.getElementById('fps'));
  const status = document.getElementById('status');
  const left = 177;
  let model;
  let sectionGrid;
  let trooper;
  let hm;
  let repairState;
  let flash = null;
  const saveStatus = document.getElementById('save-status');
  const saveKey = 'urban-defence-collapse-lab-v1';
  const modelOptions = (terrain) => ({ columns: 11, rows: 11, size: 26, left, ground: 310,
    shaftColumn: 1, openGround: true, terrain, loadEnabled: true });
  function reset() {
    model = createCollapseModel(modelOptions(document.getElementById('terrain').value));
    document.getElementById('standard-wall').style.width = `${model.thickness * 3}px`;
    document.getElementById('tall-wall').style.width = `${model.wallThickness * 3}px`;
    sectionGrid = new Map(model.sections.map((section) => [`${section.row}:${section.column}`, section]));
    trooper = createCollapseTrooper(model, left, 1);
    trooper.y = model.surfaceAt(trooper.x);
    hm = 200;
    repairState = 'Complete';
    document.getElementById('hm').value = String(hm);
    document.getElementById('floor').value = '0';
    flash = null;
    saveStatus.textContent = '';
  }
  function blast(x, y, radius, strength) {
    model.blast(x, y, radius, strength);
    flash = { x, y, radius, time: 0.2 };
  }
  document.getElementById('foundation').addEventListener('click', () => blast(320, 300, 95, 220));
  document.getElementById('middle').addEventListener('click', () => blast(320, 190, 100, 175));
  document.getElementById('reset').addEventListener('click', reset);
  document.getElementById('slide-demo').addEventListener('click', () => {
    reset();
    const piece = model.sections.find((section) => section.row === 0 && section.column === 2);
    model.blast(piece.x + model.size / 2, piece.y + model.size / 2, 1, 150);
    piece.x = 50;
    piece.y = 0;
    piece.y -= model.groundPenetration(piece);
    piece.previousX = piece.x;
    piece.previousY = piece.y;
    piece.vx = 120;
    piece.vy = 0;
    document.getElementById('auto-repair').checked = false;
    saveStatus.textContent = 'Sliding demo: watch the loose beam left of the building slow down. Auto-rebuild is paused; turn it back on when ready.';
  });
  document.getElementById('spin-demo').addEventListener('click', () => {
    reset();
    const piece = model.sections.find((section) => section.row === 0 && section.column === 2);
    model.blast(piece.x + model.size * 0.85, piece.y + model.size / 2 - 4, 8, 200);
    piece.x = 50;
    piece.y = model.surfaceAt(piece.x + model.size / 2) - 140;
    piece.previousX = piece.x;
    piece.previousY = piece.y;
    piece.vx = 35;
    piece.vy = 0;
    document.getElementById('auto-repair').checked = false;
    saveStatus.textContent = 'Spin demo: watch the loose beam left of the building rotate as it falls. Auto-rebuild is paused; turn it back on when ready.';
  });
  document.getElementById('terrain').addEventListener('change', reset);
  document.getElementById('save').addEventListener('click', () => {
    try {
      const { x, y, floor, target, state, facing, moving, health, vy } = trooper;
      const saved = { version: 1, model: model.saveState(), hm,
        autoRepair: document.getElementById('auto-repair').checked,
        destination: Number(document.getElementById('floor').value),
        trooper: { x, y, floor, target, state, facing, moving, health, vy,
          manual: !!trooper.manual, onLadder: !!trooper.onLadder,
          contacts: Array.from(trooper.contacts, (section) => model.sections.indexOf(section)) } };
      localStorage.setItem(saveKey, JSON.stringify(saved));
      saveStatus.textContent = 'Lab saved in this browser.';
    } catch (error) {
      saveStatus.textContent = `Could not save lab: ${error.message}`;
    }
  });
  document.getElementById('load').addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(saveKey);
      if (!raw) throw new Error('No lab save found');
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !saved.model || !saved.trooper ||
          !Number.isFinite(saved.hm) || saved.hm < 0 || typeof saved.autoRepair !== 'boolean' ||
          !Number.isInteger(saved.destination) || saved.destination < 0 || saved.destination > 4) {
        throw new Error('Invalid lab save');
      }
      const nextModel = createCollapseModel(modelOptions(saved.model.terrain));
      nextModel.loadState(saved.model);
      const data = saved.trooper;
      if (!['x', 'y', 'health', 'vy'].every((field) => Number.isFinite(data[field])) ||
          data.health < 0 || data.health > 100 || ![0, 1, 2, 3, 4].includes(data.floor) ||
          ![0, 1, 2, 3, 4].includes(data.target) || ![-1, 1].includes(data.facing) ||
          typeof data.state !== 'string' || !['moving', 'manual', 'onLadder'].every((field) =>
            typeof data[field] === 'boolean') || !Array.isArray(data.contacts) ||
          !data.contacts.every((index) => Number.isInteger(index) && index >= 0 &&
            index < nextModel.sections.length && !nextModel.sections[index].attached)) {
        throw new Error('Invalid trooper save');
      }
      const nextTrooper = createCollapseTrooper(nextModel, left, 1);
      for (const field of ['x', 'y', 'floor', 'target', 'state', 'facing', 'moving', 'health', 'vy',
        'manual', 'onLadder']) nextTrooper[field] = data[field];
      nextTrooper.contacts = new Set(data.contacts.map((index) => nextModel.sections[index]));
      model = nextModel;
      trooper = nextTrooper;
      sectionGrid = new Map(model.sections.map((section) => [`${section.row}:${section.column}`, section]));
      hm = saved.hm;
      document.getElementById('terrain').value = model.terrain;
      document.getElementById('hm').value = String(hm);
      document.getElementById('auto-repair').checked = saved.autoRepair;
      document.getElementById('floor').value = String(saved.destination);
      heldKeys.clear();
      updateInput();
      flash = null;
      repairState = 'Loaded';
      saveStatus.textContent = 'Lab save loaded.';
    } catch (error) {
      saveStatus.textContent = `Could not load lab: ${error.message}`;
    }
  });
  document.getElementById('hm').addEventListener('change', (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value < 0 || event.target.value.trim() === '') {
      event.target.setCustomValidity('Enter a non-negative HM amount.');
      event.target.reportValidity();
      event.target.value = String(hm);
      event.target.setCustomValidity('');
      return;
    }
    hm = value;
  });
  document.getElementById('send').addEventListener('click', () => {
    trooper.requestFloor(Number(document.getElementById('floor').value));
  });
  const keys = { a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
    w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down' };
  const heldKeys = new Set();
  function updateInput() {
    for (const direction of ['left', 'right', 'up', 'down']) {
      trooper.input[direction] = Array.from(heldKeys).some((key) => keys[key] === direction);
    }
  }
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (!keys[key] || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    event.preventDefault();
    heldKeys.add(key);
    updateInput();
  });
  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (!keys[key]) return;
    heldKeys.delete(key);
    updateInput();
  });
  window.addEventListener('blur', () => { heldKeys.clear(); updateInput(); });
  canvas.addEventListener('click', (event) => {
    const bounds = canvas.getBoundingClientRect();
    blast((event.clientX - bounds.left) * canvas.width / bounds.width,
      (event.clientY - bounds.top) * canvas.height / bounds.height, 32, 90);
  });
  reset();
  const clock = createFixedStepClock((dt) => {
    model.step(dt);
    trooper.step(dt);
    if (document.getElementById('auto-repair').checked) {
      const result = model.repair(dt, hm, (x, y, size, site) =>
        model.touchesRect(site, trooper.x - 5, trooper.y - 20, 10, 20));
      hm -= result.spent;
      repairState = result.state;
      if (result.spent) document.getElementById('hm').value = String(hm);
    } else {
      repairState = 'Paused';
    }
    if (flash) {
      flash.time -= dt;
      if (flash.time <= 0) flash = null;
    }
  });
  function sectionColor(health) {
    const remaining = Math.max(0, Math.min(1, health / 100));
    const red = Math.round(remaining < 0.5 ? 235 : 235 * (1 - remaining) * 2);
    const green = Math.round(remaining < 0.5 ? 55 + remaining * 2 * 165 : 220 + (remaining - 0.5) * 2 * 20);
    return `rgb(${red}, ${green}, ${Math.round(30 + remaining * 80)})`;
  }
  function drawArchitecture() {
    const size = model.size;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#337747';
    for (const floorRow of [3, 6, 9]) {
      for (const column of [2, 3, 4, 6, 7, 8, 9]) {
        const floor = sectionGrid.get(`${floorRow}:${column}`);
        const ceiling = sectionGrid.get(`${floorRow - 3}:${column}`);
        if (!floor || !ceiling || !floor.attached || !ceiling.attached) continue;
        const x = Math.round(left + column * size + 5);
        const top = Math.round(ceiling.y + size / 2 + 8);
        const bottom = Math.round(floor.y + size / 2 - 8);
        ctx.strokeRect(x + 0.5, top + 0.5, size - 10, bottom - top);
        ctx.beginPath();
        ctx.moveTo(x + (size - 10) / 2 + 0.5, top);
        ctx.lineTo(x + (size - 10) / 2 + 0.5, bottom);
        ctx.moveTo(x, Math.round((top + bottom) / 2) + 0.5);
        ctx.lineTo(x + size - 10, Math.round((top + bottom) / 2) + 0.5);
        ctx.stroke();
      }
    }
  }
  function drawSections(alpha) {
    const size = model.size;
    for (const section of model.sections) {
      if (section.cleared) continue;
      const x = Math.round(section.previousX * (1 - alpha) + section.x * alpha);
      const y = Math.round(section.previousY * (1 - alpha) + section.y * alpha);
      const angle = section.previousAngle * (1 - alpha) + section.angle * alpha;
      ctx.save();
      ctx.translate(x + size / 2, y + size / 2);
      ctx.rotate(angle);
      ctx.strokeStyle = sectionColor(section.health);
      ctx.lineCap = 'butt';
      if (section.horizontal) {
        ctx.lineWidth = model.thickness;
        ctx.beginPath(); ctx.moveTo(-size / 2, 0); ctx.lineTo(size / 2, 0); ctx.stroke();
      }
      if (section.vertical) {
        ctx.lineWidth = model.wallThickness;
        ctx.beginPath(); ctx.moveTo(0, -size / 2); ctx.lineTo(0, size / 2); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function frame(timestamp) {
    const alpha = clock.advance(timestamp);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#57d878';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, model.surfaceAt(0));
    for (let x = 1; x <= canvas.width; x += 1) ctx.lineTo(x, model.surfaceAt(x));
    ctx.stroke();
    ctx.strokeStyle = '#438e54';
    for (const section of model.sections) {
      if (!section.anchored) continue;
      const x = section.x + model.size / 2;
      ctx.beginPath();
      ctx.moveTo(x, model.ground);
      ctx.lineTo(x, model.surfaceAt(x));
      ctx.stroke();
    }
    drawArchitecture();
    const shaftX = left + 1.5 * model.size;
    ctx.strokeStyle = '#438e54';
    ctx.lineWidth = 1;
    for (let row = 0; row < model.rows; row += 1) {
      if (!model.ladderSegment(row)) continue;
      const top = model.ground - (model.rows - row) * model.size;
      ctx.beginPath();
      ctx.moveTo(shaftX - 6, top); ctx.lineTo(shaftX - 6, top + model.size);
      ctx.moveTo(shaftX + 6, top); ctx.lineTo(shaftX + 6, top + model.size);
      for (let y = top + 5; y < top + model.size; y += 9) {
        ctx.moveTo(shaftX - 6, y); ctx.lineTo(shaftX + 6, y);
      }
      ctx.stroke();
    }
    drawSections(alpha);
    ctx.save();
    ctx.translate(Math.round(trooper.x), Math.round(trooper.y));
    ctx.scale(trooper.facing, 1);
    ctx.fillStyle = '#1a261c';
    ctx.fillRect(-5, -20, 10, 20);
    ctx.fillStyle = '#c9d5a5';
    ctx.fillRect(-3, -19, 7, 5);
    ctx.fillStyle = '#89a96b';
    ctx.fillRect(-4, -14, 8, 8);
    ctx.fillRect(-4, -6, 3, 6);
    ctx.fillRect(1, -6, 3, 6);
    ctx.fillStyle = '#d9e8ba';
    ctx.fillRect(3, -12, 7, 2);
    ctx.restore();
    if (flash) {
      ctx.strokeStyle = '#ffae5d';
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius * (1 - flash.time / 0.2), 0, Math.PI * 2);
      ctx.stroke();
    }
    const remaining = model.sections.filter((section) => section.attached).length;
    status.textContent = `Standing sections: ${remaining} / ${model.sections.length}. Debris: ${model.fragments.length}. Rebuilding: ${repairState} (${hm.toFixed(1)} HM). Trooper: ${trooper.state} (floor ${trooper.floor}), health: ${Math.ceil(trooper.health)}%.`;
    fps.record();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}());
