(function () {
  const checks = [];
  function check(name, test) {
    try {
      test();
      checks.push(`PASS ${name}`);
    } catch (error) {
      checks.push(`FAIL ${name}: ${error.message}`);
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function rejects(test) {
    let failed = false;
    try { test(); } catch (error) { failed = true; }
    assert(failed, 'expected invalid configuration to be rejected');
  }

  check('both sides have equal starting resources and independent balances', () => {
    const economies = createStartingEconomies({ hm: 500, sm: 300, pop: 10 }, [{ side: 0 }, { side: 1 }]);
    assert(JSON.stringify(economies.left) === JSON.stringify(economies.right), 'starting resources differ');
    assert(economies.left.assigned === 1 && economies.left.pop - economies.left.assigned === 9, 'starting miner is not allocated');
    economies.left.hm -= 10;
    assert(economies.right.hm === 500, 'balances are shared');
  });
  check('custom resources and miner counts are honored', () => {
    const economies = createStartingEconomies({ hm: 12, sm: 7, pop: 3 }, [{ side: 0 }, { side: 0 }, { side: 1 }]);
    assert(economies.left.hm === 12 && economies.right.sm === 7, 'custom resources ignored');
    assert(economies.left.assigned === 2 && economies.right.assigned === 1, 'miner counts incorrect');
  });
  check('invalid resources and insufficient population are rejected', () => {
    rejects(() => createStartingEconomies({ hm: -1, sm: 0, pop: 1 }, []));
    rejects(() => createStartingEconomies({ hm: 0, sm: NaN, pop: 1 }, []));
    rejects(() => createStartingEconomies({ hm: 0, sm: 0, pop: 1.5 }, []));
    rejects(() => createStartingEconomies({ hm: 0, sm: 0, pop: 0 }, [{ side: 0 }]));
    rejects(() => createStartingEconomies({ hm: 0, sm: 0, pop: 1 }, [{ side: 2 }]));
  });
  check('flooding pauses construction without spending or losing progress', () => {
    const funds = { hm: 20, sm: 10, pop: 10, assigned: 1 };
    const building = { health: 100, kind: 'flat', height: 6, population: 0, construction: { stage: 0, progress: 7 } };
    advanceSeedConstruction(building, funds, 5, false);
    assert(building.construction.progress === 7 && building.construction.stage === 0, 'flooded construction progressed');
    assert(funds.hm === 20 && funds.sm === 10 && funds.pop === 10 && funds.assigned === 1, 'flooded construction consumed resources');
    advanceSeedConstruction(building, funds, 1, true);
    assert(building.construction.stage === 1 && building.construction.progress === 0 && building.height === 11, 'dry construction did not resume');
    assert(funds.hm === 16 && funds.sm === 8 && funds.pop === 11 && funds.assigned === 1, 'resumed construction charged incorrect resources');
  });
  check('flooded final stage and damaged or destroyed seeds do not grow', () => {
    const funds = { hm: 20, sm: 10, pop: 10, assigned: 1 };
    const building = { health: 100, kind: 'military', height: 21, level: 3, construction: { stage: 3, progress: 8 } };
    advanceSeedConstruction(building, funds, 1, false);
    assert(building.construction.stage === 3 && funds.assigned === 1 && funds.hm === 20, 'flooded final stage completed');
    building.rebuildHeight = 21;
    advanceSeedConstruction(building, funds, 1, true);
    delete building.rebuildHeight;
    building.health = 0;
    advanceSeedConstruction(building, funds, 1, true);
    assert(building.construction.stage === 3 && funds.assigned === 1, 'damaged or destroyed seed grew');
    building.health = 100;
    advanceSeedConstruction(building, funds, 1, true);
    assert(building.construction.stage === 4 && building.level === 4 && funds.assigned === 0, 'final stage did not resume');
  });
  check('farm construction still waits for resources and uses farm growth', () => {
    const funds = { hm: 3, sm: 2, pop: 10, assigned: 1 };
    const building = { health: 100, kind: 'farm', height: 6, construction: { stage: 0, progress: 7 } };
    advanceSeedConstruction(building, funds, 1, true);
    assert(building.construction.stage === 0 && building.construction.progress === 8 && funds.hm === 3, 'resource shortage did not pause construction');
    funds.hm = 4;
    advanceSeedConstruction(building, funds, 1, true);
    assert(building.construction.stage === 1 && building.height === 8 && funds.hm === 0 && funds.sm === 0, 'farm construction changed');
  });
  const results = document.getElementById('results');
  results.textContent = checks.join('\n');
  results.dataset.failed = String(checks.filter((item) => item.startsWith('FAIL')).length);
}());
