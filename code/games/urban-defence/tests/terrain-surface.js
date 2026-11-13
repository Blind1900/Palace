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
  function close(actual, expected) {
    assert(Math.abs(actual - expected) < 1e-8, `expected ${expected}, got ${actual}`);
  }
  function rejects(test) {
    let failed = false;
    try { test(); } catch (error) { failed = true; }
    assert(failed, 'expected invalid input to be rejected');
  }

  check('terrain detail varies smoothly across scales and is repeatable', () => {
    function rng(seed) {
      return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    }
    const a = createTerrainDetail(9600, rng(123));
    const b = createTerrainDetail(9600, rng(123));
    const c = createTerrainDetail(9600, rng(456));
    const values = [];
    for (let x = 0; x <= 9600; x += 4) {
      const value = a(x);
      values.push(value);
      close(value, b(x));
      assert(Math.abs(value) <= 45, 'detail exceeded layer bounds');
      if (x > 0) assert(Math.abs(value - a(x - 4)) < 5, 'detail changed too sharply');
    }
    assert(Math.max(...values) - Math.min(...values) > 40, 'detail lacks variation');
    assert(values.some((value, i) => Math.abs(value - c(i * 4)) > 1), 'different random sequences match');
    close(a(-1), a(0));
    close(a(9601), a(9600));
    rejects(() => a(NaN));
    rejects(() => createTerrainDetail(0));
    rejects(() => createTerrainDetail(10, () => 1));
  });
  check('interpolates generated heights and clamps map edges', () => {
    const terrain = createTerrainSurface(16, 4, (x) => x * 2);
    close(terrain.heightAt(6), 12);
    close(terrain.heightAt(-4), 0);
    close(terrain.heightAt(20), 32);
  });
  check('craters update the same heights used by readers', () => {
    const terrain = createTerrainSurface(16, 4, () => 10);
    const collisionHeight = (x) => terrain.heightAt(x);
    terrain.crater(8, 8, 12);
    close(collisionHeight(0), 10);
    close(collisionHeight(4), 16);
    close(collisionHeight(8), 22);
    close(collisionHeight(10), 19);
    close(collisionHeight(16), 10);
    assert(terrain.revision === 1, 'revision did not change');
    terrain.crater(100, 4, 12);
    terrain.crater(8, 8, 0);
    assert(terrain.revision === 1, 'unchanged terrain changed revision');
  });
  check('edge and repeated craters accumulate without leaving bounds', () => {
    const terrain = createTerrainSurface(16, 4, () => 20);
    terrain.crater(0, 8, 4);
    terrain.crater(0, 8, 4);
    close(terrain.heightAt(0), 28);
    close(terrain.heightAt(4), 24);
    close(terrain.heightAt(8), 20);
    assert(terrain.revision === 2, 'repeated impacts not tracked');
  });
  check('rejects invalid terrain and crater inputs', () => {
    rejects(() => createTerrainSurface(10, 4, () => 0));
    rejects(() => createTerrainSurface(8, 4, () => NaN));
    const terrain = createTerrainSurface(8, 4, () => 0);
    rejects(() => terrain.heightAt(NaN));
    rejects(() => terrain.crater(4, 0, 1));
    rejects(() => terrain.crater(4, 2, -1));
    assert(terrain.revision === 0, 'invalid crater modified terrain');
  });
  const results = document.getElementById('results');
  results.textContent = checks.join('\n');
  results.dataset.failed = String(checks.filter((item) => item.startsWith('FAIL')).length);
}());
