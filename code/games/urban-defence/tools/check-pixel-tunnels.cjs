const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const files = ['scripts\\particle-world.js', 'scripts\\pixel-construction-logistics.js',
  'assets\\unit-reference.js', 'scripts\\pixel-unit.js', 'scripts\\pixel-population-scale.js',
  'scripts\\pixel-tunnel-lab.js', 'scripts\\pixel-city-upkeep.js',
  'scripts\\particle-terrain-import.js', 'scripts\\pixel-construction-scenario.js',
  'scripts\\pixel-city-farms.js', 'scripts\\pixel-city-military.js', 'scripts\\pixel-map-construction.js',
  'scripts\\pixel-building-styles.js',
  'tests\\pixel-tunnel-fixture.js', 'tests\\pixel-city-upkeep.js'];
const context = vm.createContext({ console });
const selector = process.argv.indexOf('--check');
if (selector !== -1) {
  if (!process.argv[selector + 1]) throw new Error('--check requires a check name');
  context.pixelCheckFilter = process.argv[selector + 1];
}
const limit = process.argv.indexOf('--construction-limit');
if (limit !== -1) {
  const value = Number(process.argv[limit + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error('Invalid construction test tick limit');
  context.pixelConstructionLimit = value;
}
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}
const results = vm.runInContext(selector === -1 ?
  '[...runPixelTunnelChecks(), ...runPixelCityUpkeepChecks()]' : 'runPixelCityUpkeepChecks()', context);
console.log(results.join('\n'));
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
