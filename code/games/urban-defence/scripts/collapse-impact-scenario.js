function createCollapseImpactScenario(offset, options = {}) {
  if (![-8, 0, 8].includes(offset)) throw new Error('Invalid impact offset');
  const model = createCollapseModel({ columns: 3, rows: 4, size: 20, left: 100, ground: 300,
    experimentalImpactSpin: true, optimizeCollisionSearch: options.optimizeCollisionSearch === true });
  model.blast(130, 250, 500, 1000);
  const upper = model.sections.find((s) => s.row === 0 && s.column === 1);
  const lower = model.sections.find((s) => s.row === 3 && s.column === 1);
  model.sections.filter((s) => s !== upper && s !== lower).forEach((s, i) => {
    Object.assign(s, { x: 450 + (i % 4) * 30, y: 20 + Math.floor(i / 4) * 30,
      vx: 0, vy: 0, angle: 0, angularVelocity: 0 });
  });
  Object.assign(upper, { x: 200 + offset, y: 100, vx: 0, vy: 180, angle: 0, angularVelocity: 0 });
  Object.assign(lower, { x: 200, y: 120, vx: 0, vy: 0, angle: 0, angularVelocity: 0 });
  for (const section of model.sections) {
    section.previousX = section.x;
    section.previousY = section.y;
    section.previousAngle = section.angle;
  }
  return { model, upper, lower };
}
