/** Deterministic contract for movement/fire arbitration and post-mission autonomy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolveFleetIntent } = require('../frontend/src/game/battle/FleetIntentSystem.ts');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (error) { process.stdout.write(`  FAIL ${name}: ${error.message}\n`); process.exitCode = 1; }
}

const point = (x, y) => ({ x, y });
console.log('\n=== Fleet intent arbitration ===');
check('incoming fire returns fire without replacing capture destination', () => {
  const intent = resolveFleetIntent({
    retreatDestination: null,
    attacker: { id: 9, destination: point(40, 0), inWeaponRange: true },
    engagement: null,
    beaconDestination: null,
    mission: { type: 'capture_planet', destination: point(500, 0) },
    knownEnemy: null, fightingAlly: null, forwardSearch: point(700, 0), patrolPoint: point(0, 0),
  });
  assert.deepEqual(intent.destination, point(500, 0));
  assert.equal(intent.fireTargetId, 9);
  assert.equal(intent.kind, 'mission');
});
check('identified enemy pauses capture without erasing it', () => {
  const intent = resolveFleetIntent({
    retreatDestination: null, attacker: null,
    engagement: { id: 12, destination: point(200, 0), inWeaponRange: true },
    beaconDestination: null,
    mission: { type: 'capture_planet', destination: point(500, 0) },
    knownEnemy: null, fightingAlly: null, forwardSearch: point(700, 0), patrolPoint: point(0, 0),
  });
  assert.equal(intent.kind, 'engage');
  assert.equal(intent.fireTargetId, 12);
  assert.equal(intent.missionPaused, true);
});
check('cleared contact resumes the preserved capture mission', () => {
  const intent = resolveFleetIntent({
    retreatDestination: null, attacker: null, engagement: null, beaconDestination: null,
    mission: { type: 'capture_planet', destination: point(500, 0) },
    knownEnemy: null, fightingAlly: null, forwardSearch: point(700, 0), patrolPoint: point(0, 0),
  });
  assert.equal(intent.kind, 'mission');
  assert.deepEqual(intent.destination, point(500, 0));
});
check('autonomy attacks known enemy after objectives are exhausted', () => {
  const intent = resolveFleetIntent({
    retreatDestination: null, attacker: null, engagement: null, beaconDestination: null, mission: null,
    knownEnemy: { id: 22, destination: point(800, 50), inWeaponRange: false },
    fightingAlly: { id: 3, destination: point(400, 10) },
    forwardSearch: point(900, 0), patrolPoint: point(0, 0),
  });
  assert.equal(intent.kind, 'engage');
  assert.deepEqual(intent.destination, point(800, 50));
});
check('autonomy falls through support, search and patrol in order', () => {
  const base = {
    retreatDestination: null, attacker: null, engagement: null, beaconDestination: null, mission: null,
    knownEnemy: null, fightingAlly: { id: 3, destination: point(400, 10) },
    forwardSearch: point(900, 0), patrolPoint: point(0, 0),
  };
  assert.equal(resolveFleetIntent(base).kind, 'support');
  assert.equal(resolveFleetIntent({ ...base, fightingAlly: null }).kind, 'search');
  assert.equal(resolveFleetIntent({ ...base, fightingAlly: null, forwardSearch: null }).kind, 'patrol');
});

console.log('\n=== Battle movement/fire integration ===');
const sceneSource = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
check('engaging fleet keeps its bow aimed at the live fire target', () => {
  assert.match(sceneSource, /if \(isEngaging && closestEnemyFleet\)[\s\S]{0,400}fAngle = Math\.atan2\(closestEnemyFleet\.y - fleet\.y/);
  assert.match(sceneSource, /const _rigid = [\s\S]{0,180}\|\| isEngaging/);
});
check('capture mission ignores objectives already owned by an allied faction', () => {
  const missionBody = sceneSource.slice(sceneSource.indexOf("m.type === 'capture_planet'"), sceneSource.indexOf("m.type === 'hold_point'"));
  assert.match(missionBody, /ownerFac[^\n]*team[^\n]*fac\.team/);
});

console.log(`\n${passed} fleet-intent assertions passed`);
