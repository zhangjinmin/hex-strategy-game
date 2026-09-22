/** Source-level regression harness for tactical contact and maneuver rules. */
const C = require('../frontend/src/game/combatControl.ts');
const D = require('../frontend/src/game/combatDoctrine.ts');
const T = require('../frontend/src/game/tacticalTasks.ts');
const fs = require('node:fs');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

const baseline = {
  inRange: false,
  recentlyHit: false,
  secondsSinceContact: 0,
  headingError: 0,
  retreatRequested: false,
  stopped: false,
  reformed: false,
};

console.log('\n=== Tactical contact and maneuver controller ===');
const locked = C.updateContact({ engaged: true, releaseAfter: 2, secondsSinceContact: 0 }, true, 0.25);
check('pursuer keeps a withdrawing fleet in contact lock', locked.engaged === true);

const disengage = C.advanceManeuver(
  { phase: 'cruise', phaseSeconds: 0 },
  { ...baseline, engaged: true, retreatRequested: true, headingError: Math.PI },
  0.25,
);
check('engaged fleet withdraws backwards before it may turn', disengage.phase === 'disengage' && disengage.motion === 'reverse');

let state = { phase: 'cruise', phaseSeconds: 0 };
const phases = [];
for (const input of [
  { ...baseline, headingError: Math.PI },
  { ...baseline, headingError: Math.PI, stopped: true },
  { ...baseline, headingError: 0, stopped: true },
  { ...baseline, headingError: 0, stopped: true, reformed: true },
]) {
  state = C.advanceManeuver(state, input, 0.25);
  phases.push(state.phase);
}
check('a free 180-degree turn brakes, turns, reforms, then cruises', phases.join(',') === 'brake,turn,reform,cruise', phases.join(','));

console.log('\n=== Supply intent ===');
const supplyBase = {
  supplyPct: 55,
  inSupplyChain: false,
  supplyShipInbound: false,
  supplyShipNear: false,
  enemyTurningAway: false,
  ourAdvantage: false,
  aggression: 0.1,
  holdingGround: false,
};
check('yellow supply in a live battle holds instead of ordering return',
  D.supplyDecision({ ...supplyBase, engaged: true }).action === 'hold');
check('critical supply requests withdrawal even during battle',
  D.supplyDecision({ ...supplyBase, supplyPct: 10, engaged: true }).action === 'return');

console.log('\n=== Tactical mission geometry ===');
const escort = T.escortDestination({ x: 100, y: 100, facing: 0 }, { x: 500, y: 100 }, 180);
check('support mission holds an escort position instead of ally center', escort.x === -80 && escort.y === 100);

console.log('\n=== BattleScene integration contract ===');
const battleSceneSource = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
check('scene imports the central combat controller', battleSceneSource.includes("from '../combatControl'"));
check('near transport ships never become a fleet movement target', !battleSceneSource.includes('fleetTargetX = nearAux.x'));
check('morale is not drained once per ship', !battleSceneSource.includes('moraleDrainPerTick(u.supply)'));
check('fleet missions use fleet IDs rather than faction fallback', !battleSceneSource.includes('fl.id === m.targetId || fl.factionId === m.targetId'));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
