/** Deterministic fog-of-war contact contract. */
const fs = require('node:fs');
let intel = {};
try {
  intel = require('../frontend/src/game/battle/IntelSystem.js');
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

console.log('\n=== Fog-of-war contact states ===');
check('exports assessContact', typeof intel.assessContact === 'function');

if (typeof intel.assessContact === 'function') {
  check('a fleet outside sensor coverage is unknown', intel.assessContact({ distance: 1001, sensorRange: 1000 }).state === 'unknown');
  check('the outer sensor shell gives only an anomaly', intel.assessContact({ distance: 900, sensorRange: 1000 }).state === 'anomaly');
  check('a normal contact reveals position but not composition', intel.assessContact({ distance: 600, sensorRange: 1000 }).state === 'contact');
  check('close reconnaissance identifies the fleet', intel.assessContact({ distance: 250, sensorRange: 1000 }).state === 'identified');
  check('a scout report identifies a remote contact', intel.assessContact({ distance: 900, sensorRange: 1000, scoutReport: true }).state === 'identified');
}

console.log('\n=== Persistent combat identification ===');
check('exports resolveContactMemory', typeof intel.resolveContactMemory === 'function');
if (typeof intel.resolveContactMemory === 'function') {
  check('once identified, a fleet remains identified after leaving sensor range',
    intel.resolveContactMemory({ previous: 'identified', observed: 'unknown', fired: false, concealmentSucceeded: false }) === 'identified');
  check('opening fire permanently identifies the firing fleet',
    intel.resolveContactMemory({ previous: 'unknown', observed: 'anomaly', fired: true, concealmentSucceeded: false }) === 'identified');
  check('only successful EW concealment may break persistent identification',
    intel.resolveContactMemory({ previous: 'identified', observed: 'unknown', fired: false, concealmentSucceeded: true }) === 'unknown');
}

console.log('\n=== Battle visibility integration ===');
const sceneSource = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
check('player rendering resolves observations through persistent contact memory',
  /resolveContactMemory\(\{[\s\S]{0,500}previous,[\s\S]{0,500}observed:\s*contact\.state,[\s\S]{0,500}concealmentSucceeded/.test(sceneSource));
check('weapon fire permanently identifies the shooter to the defending team',
  /markFleetIdentified\([^\n]*fleet\)/.test(sceneSource) && /_revealedByFireAt/.test(sceneSource));
check('ordinary range loss cannot clear identification',
  !/breakFleetIdentification\([^\n]*\)[^\n]*;\s*\/\/\s*range loss/.test(sceneSource));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
