/** Regression harness for fleet tactical-plan invariants. */
const A = require('../frontend/src/game/aiDirector.ts');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Formation commitment ===');
const opening = A.stabilizeCombatFormation({
  active: true,
  targetId: 7,
  existingFormation: 'wedge',
  candidate: 'line',
  previous: null,
  emergency: false,
});
check('first contact preserves the deployed wedge instead of silently becoming a line',
  opening.formation === 'wedge', opening.formation);

const sustained = A.stabilizeCombatFormation({
  active: true,
  targetId: 7,
  existingFormation: 'wedge',
  candidate: 'spindle',
  previous: opening.state,
  emergency: false,
});
check('an active firefight does not re-form because the power ratio changed',
  sustained.formation === 'wedge', sustained.formation);

const emergency = A.stabilizeCombatFormation({
  active: true,
  targetId: 7,
  existingFormation: 'wedge',
  candidate: 'spindle',
  previous: sustained.state,
  emergency: true,
});
check('a verified emergency may release the formation commitment',
  emergency.formation === 'spindle', emergency.formation);

const retarget = A.stabilizeCombatFormation({
  active: true,
  targetId: 9,
  existingFormation: 'wedge',
  candidate: 'circle',
  previous: sustained.state,
  emergency: false,
});
check('a target change creates a new tactical commitment', retarget.formation === 'circle', retarget.formation);

console.log('\n=== Maneuver authorization ===');
check('high command alone is not permission to flank',
  A.shouldFlank({ commanderAggressive: true, maneuverRole: undefined }) === false);
check('an explicitly assigned wing is permitted to flank',
  A.shouldFlank({ commanderAggressive: false, maneuverRole: 'left' }) === true);

console.log('\n=== BattleScene integration contract ===');
const fs = require('node:fs');
const source = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
check('scene imports the formation commitment authority', source.includes('stabilizeCombatFormation'));
check('tactical flare prefers the selected fleet over a proximity guess', source.includes('battleSelectedFleetId'));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
