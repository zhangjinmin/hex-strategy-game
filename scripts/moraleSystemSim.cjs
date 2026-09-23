/** Morale and supply consequence contract. */
let morale = {};
try {
  morale = require('../frontend/src/game/battle/MoraleSystem.js');
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
}

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Morale before hull loss ===');
check('exports resolveMoraleTick', typeof morale.resolveMoraleTick === 'function');

if (typeof morale.resolveMoraleTick === 'function') {
  const supplied = morale.resolveMoraleTick({ morale: 60, supply: 10, underAttack: false, dtMs: 1000 });
  check('supply shortage reduces morale without inventing hull losses', supplied.morale < 60 && supplied.hullLossRatio === 0, JSON.stringify(supplied));

  const broken = morale.resolveMoraleTick({ morale: 0, supply: 0, underAttack: true, dtMs: 1000 });
  check('a broken fleet under fire may suffer attrition', broken.hullLossRatio > 0, JSON.stringify(broken));

  const victory = morale.resolveMoraleTick({ morale: 80, supply: 80, underAttack: false, advantage: true, dtMs: 1000 });
  check('a clear advantage creates a morale surge', victory.morale > 80 && victory.events.includes('morale-surge'), JSON.stringify(victory));
}

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
