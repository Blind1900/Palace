const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const files = ['scripts\\particle-world.js', 'scripts\\pixel-tunnel-network.js', 'scripts\\pixel-tunnel-mining.js',
  'scripts\\pixel-surface-roads.js', 'scripts\\pixel-pipeline-network.js', 'tests\\pixel-tunnel-network.js'];
const context = vm.createContext({ console });
for (const file of files) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const results = vm.runInContext('runPixelTunnelNetworkChecks()', context);
console.log(results.join('\n'));
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
