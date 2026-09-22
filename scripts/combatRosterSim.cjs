/** Regression harness for separating logistics ships from combat eligibility. */
const R = require('../frontend/src/game/combatRoster.ts');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Combat roster boundary ===');
const onlyTransport = { units: [{ classType: 'supply', hp: 100 }] };
const combatAndTransport = { units: [{ classType: '补给', hp: 100 }, { classType: '巡洋', hp: 1 }] };

check('a surviving transport alone does not keep a fleet combat-active', R.hasCombatUnits(onlyTransport) === false);
check('a surviving warship keeps the fleet combat-active even with a transport attached', R.hasCombatUnits(combatAndTransport) === true);
check('a logistics ship remains a valid fire target so supply lines can be cut', R.targetableUnits(combatAndTransport).length === 2);

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
