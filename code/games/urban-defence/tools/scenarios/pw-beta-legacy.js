// N8 - the old beta, moved to beta-legacy.html when index.html became the game, still loads and runs.
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
check(/beta-legacy\.html/.test(location.pathname), `the old beta is beta-legacy.html (${location.pathname.split('/').pop()})`);
check(typeof commandControl !== 'undefined' && typeof missileControl !== 'undefined', 'its controllers are up');
await sleep(1500);
check(!!document.querySelector('canvas'), 'it draws');
return { checks, shots: [await shot('pw-beta-legacy')].length };
