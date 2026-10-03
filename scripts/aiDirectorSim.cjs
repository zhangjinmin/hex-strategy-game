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

console.log('\n=== [v67 phase A] phase-driven formation ===');
// 1) 均势灰区：旧表恒返回 line，阶段偏好让它按阶段给不同答案
const evenFight = { alliesOnTarget: 0, powerRatio: 1.0, aggressive: false, avoiding: false };
check('even fight without phase hint keeps the legacy line formation',
  A.chooseFormation(evenFight) === 'line', A.chooseFormation(evenFight));
check('far phase prefers line (broad arc for long-range duel)',
  A.chooseFormation({ ...evenFight, phaseHint: ['line', 'wedge'] }) === 'line');
check('assault phase prefers spindle (fire concentration column)',
  A.chooseFormation({ ...evenFight, phaseHint: ['spindle', 'circle'] }) === 'spindle');
check('phase hint actually changes the even-fight answer',
  A.chooseFormation({ ...evenFight, phaseHint: ['spindle', 'circle'] })
  !== A.chooseFormation({ ...evenFight, phaseHint: ['line', 'wedge'] }));
// 2) 阶段偏好不得压过战术意图
check('surround intent still wins over phase hint',
  A.chooseFormation({ alliesOnTarget: 3, powerRatio: 1.0, aggressive: false, avoiding: false, phaseHint: ['line'] }) === 'circle');
check('evading intent still wins over phase hint',
  A.chooseFormation({ alliesOnTarget: 0, powerRatio: 1.0, aggressive: false, avoiding: true, phaseHint: ['line'] }) === 'spindle');
check('superiority breakthrough still wins over phase hint',
  A.chooseFormation({ alliesOnTarget: 0, powerRatio: 2.0, aggressive: true, avoiding: false, phaseHint: ['spindle'] }) === 'wedge');
// 3) 非法偏好必须回退，不得当 CombatFormation 漏出去
check('illegal phase hint falls back instead of leaking a bad value',
  A.chooseFormation({ ...evenFight, phaseHint: ['not_a_formation'] }) === 'line');
check('empty phase hint falls back', A.chooseFormation({ ...evenFight, phaseHint: [] }) === 'line');
// 4) 阶段跃迁解锁承诺（与 emergency 同级、独立 reason）
const heldBase = { active: true, targetId: 7, formation: 'line' };
check('a held commitment is respected when the phase is unchanged',
  A.stabilizeCombatFormation({
    active: true, targetId: 7, existingFormation: 'line', candidate: 'spindle',
    previous: heldBase, emergency: false,
  }).reason === 'held');
const phaseSwap = A.stabilizeCombatFormation({
  active: true, targetId: 7, existingFormation: 'line', candidate: 'spindle',
  previous: heldBase, emergency: false, phaseChanged: true,
});
check('a phase change releases the commitment and adopts the new formation',
  phaseSwap.formation === 'spindle' && phaseSwap.reason === 'phaseRetarget',
  phaseSwap.formation + '/' + phaseSwap.reason);
check('phase retarget is booked separately from emergency',
  phaseSwap.reason !== 'emergency');
check('phase change applies even when the target is unchanged (S3 must not stay in S1 line)',
  phaseSwap.state.targetId === 7 && phaseSwap.state.formation === 'spindle');

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;