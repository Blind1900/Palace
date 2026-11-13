function createConstructionScenario(rows = 9) {
  if (![5, 9, 11].includes(rows)) throw new Error('Invalid construction height');
  const options = { rows, minimumWallThicknessFactor: 1.5 };
  const template = createParticleBuildingScenario(undefined, options);
  const initial = template.snapshot();
  initial.model.sections.forEach((section, index) => {
    if (template.model.sections[index].anchored) return;
    section.attached = false;
    section.anchored = false;
    section.cleared = true;
  });
  initial.model.bonds.forEach((bond) => { bond.active = false; bond.stress = 0; });
  const scenario = createParticleBuildingScenario(initial, options);
  const blueprint = createConstructionBlueprint(scenario.model);
  const blueprintDuration = 240;
  let blueprintTicks = 0, ticks = 0, finished = false;
  let result = { state: 'Building', spent: 0, completed: 0, siteBlockers: [] };
  return {
    scenario, blueprint,
    get result() { return result; },
    get finished() { return finished; },
    get ticks() { return ticks; },
    get blueprintProgress() { return blueprintTicks / blueprintDuration; },
    step() {
      scenario.step();
      if (finished) return;
      if (blueprintTicks < blueprintDuration) {
        blueprintTicks += 1;
        return;
      }
      ticks += 1;
      if (ticks < 60) return;
      ticks = 0;
      result = scenario.repairFrontier();
      if (result.state === 'Complete') finished = true;
    },
  };
}
