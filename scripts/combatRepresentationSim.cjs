/** Regression harness for the combat-state → visual-attrition projection. */
const R = require('../frontend/src/game/combatRepresentation.ts');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Fleet combat representation ===');
const fresh = [
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
];
const freshState = R.projectFleetRepresentation(fresh, 6);
check('a full-health fleet displays its entire deployed formation', freshState.visibleCount === 6, String(freshState.visibleCount));
check('the ledger reports all represented ships at full strength', freshState.effectiveShips === 3000, String(freshState.effectiveShips));

const evenlyDamaged = fresh.map((u) => ({ ...u, hp: 33 }));
const damagedState = R.projectFleetRepresentation(evenlyDamaged, 6);
check('one-third fleet health projects to two visible ships rather than a full formation', damagedState.visibleCount === 2, String(damagedState.visibleCount));
check('the display selection is deterministic, not a frame-by-frame random flicker',
  damagedState.visibleIndexes.join(',') === R.projectFleetRepresentation(evenlyDamaged, 6).visibleIndexes.join(','),
  damagedState.visibleIndexes.join(','));

const sunk = fresh.map((u) => ({ ...u, hp: 0 }));
const sunkState = R.projectFleetRepresentation(sunk, 6);
check('a destroyed fleet has neither combat strength nor visible models', sunkState.effectiveShips === 0 && sunkState.visibleCount === 0);

console.log('\n=== Exclusive player beacon contract ===');
const fs = require('node:fs');
const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
check('beacon command rejects an unselected recipient instead of choosing the nearest fleet',
  scene.includes('请先选中要接收信标的己方舰队'));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
