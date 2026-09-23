/** Deterministic behavioral contract for lightweight three-sector scout flights. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  launchScoutFlights,
  advanceScoutFlight,
  shouldLaunchScouts,
  resolveScoutForwardHeading,
} = require('../frontend/src/game/battle/ScoutSystem.ts');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    process.stdout.write(`  FAIL ${name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

console.log('\n=== Lightweight scout flights ===');
const parentUnits = [{ id: 'flagship' }, { id: 'cruiser-sample' }];
const launch = {
  parentFleetId: 7,
  factionId: 1,
  team: 1,
  x: 100,
  y: 200,
  heading: Math.PI / 2,
  parentSpeed: 1,
  now: 5000,
};
const flights = launchScoutFlights(launch);

check('one launch creates left, centre and right flights', () => {
  assert.deepEqual(flights.map(f => f.sector), ['left', 'centre', 'right']);
});
check('flight headings form a forward 60-degree fan', () => {
  assert.ok(Math.abs(flights[0].heading - (launch.heading - Math.PI / 6)) < 1e-9);
  assert.ok(Math.abs(flights[1].heading - launch.heading) < 1e-9);
  assert.ok(Math.abs(flights[2].heading - (launch.heading + Math.PI / 6)) < 1e-9);
});
check('scouts are lightweight entities without fleet command state', () => {
  for (const flight of flights) {
    assert.equal('commanderId' in flight, false);
    assert.equal('mission' in flight, false);
    assert.equal('formation' in flight, false);
    assert.ok(flight.speed >= launch.parentSpeed * 2.2);
  }
  assert.equal(parentUnits.length, 2);
});
check('outbound scout moves forward instead of orbiting its parent', () => {
  const result = advanceScoutFlight(flights[1], {
    now: 6000,
    deltaSeconds: 1,
    parent: { x: 100, y: 200, alive: true },
    hostiles: [],
  });
  assert.ok(result.flight.y > flights[1].y);
  assert.equal(result.flight.phase, 'outbound');
});
check('contact produces a report and starts persistent tracking', () => {
  const result = advanceScoutFlight({ ...flights[1], x: 100, y: 500 }, {
    now: 7000,
    deltaSeconds: 1,
    parent: { x: 100, y: 200, alive: true },
    hostiles: [{ id: 99, x: 100, y: 900, alive: true }],
  });
  assert.equal(result.report?.targetId, 99);
  assert.equal(result.flight.phase, 'tracking');
  assert.equal(result.flight.contactId, 99);
  assert.ok(result.flight.y > 500, 'the scout should continue toward the contact');
});
check('tracking follows a moving contact instead of resuming a random sweep', () => {
  const result = advanceScoutFlight({ ...flights[1], x: 100, y: 500, phase: 'tracking', contactId: 99 }, {
    now: 8000,
    deltaSeconds: 1,
    parent: { x: 100, y: 200, alive: true },
    hostiles: [{ id: 99, x: 500, y: 560, alive: true }],
  });
  assert.equal(result.flight.phase, 'tracking');
  assert.equal(result.flight.contactId, 99);
  assert.ok(result.flight.x > 100, 'the scout should update course toward the moving target');
});
check('scout fan points toward the enemy front, not the parent hull heading', () => {
  const heading = resolveScoutForwardHeading({
    x: 100,
    y: 200,
    currentHeading: Math.PI,
    hostilePositions: [{ x: 900, y: 220 }],
    hostileObjectives: [],
  });
  assert.ok(Math.abs(heading) < 0.1, `expected an eastward heading, received ${heading}`);
});
check('scout can return defensive fire while continuing its lifecycle', () => {
  const result = advanceScoutFlight({ ...flights[0], x: 100, y: 500 }, {
    now: 7000,
    deltaSeconds: 1,
    parent: { x: 100, y: 200, alive: true },
    hostiles: [{ id: 88, x: 110, y: 505, alive: true }],
  });
  assert.equal(result.fireTargetId, 88);
});
check('destroyed scout is lost without mutating parent roster', () => {
  const result = advanceScoutFlight({ ...flights[2], hp: 0 }, {
    now: 7000,
    deltaSeconds: 1,
    parent: { x: 100, y: 200, alive: true },
    hostiles: [],
  });
  assert.equal(result.flight.phase, 'lost');
  assert.equal(parentUnits.length, 2);
});

console.log('\n=== Automatic launch policy ===');
check('AI launches when intelligence is stale and no flight is live', () => {
  assert.equal(shouldLaunchScouts({ now: 30000, lastContactAt: 0, cooldownUntil: 0, liveFlightCount: 0 }), true);
});
check('AI does not relaunch during cooldown or with live flights', () => {
  assert.equal(shouldLaunchScouts({ now: 30000, lastContactAt: 0, cooldownUntil: 31000, liveFlightCount: 0 }), false);
  assert.equal(shouldLaunchScouts({ now: 30000, lastContactAt: 0, cooldownUntil: 0, liveFlightCount: 1 }), false);
});
check('fresh contact suppresses unnecessary scouting', () => {
  assert.equal(shouldLaunchScouts({ now: 30000, lastContactAt: 26000, cooldownUntil: 0, liveFlightCount: 0 }), false);
});

console.log('\n=== Battle integration contract ===');
const sceneSource = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const overlaySource = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');
check('BattleScene stores scouts outside the formal fleet roster', () => {
  assert.match(sceneSource, /scoutFlights\s*:/);
  assert.match(sceneSource, /getRenderableFleets/);
});
check('launch no longer removes a represented cruiser from the parent fleet', () => {
  const launchBody = sceneSource.slice(
    sceneSource.indexOf('private launchScoutForFaction'),
    sceneSource.indexOf('private activateElectronicWarfare'),
  );
  assert.doesNotMatch(launchBody, /parent\.units\.splice/);
  assert.match(launchBody, /launchScoutFlights/);
});
check('parent fleets are not held while scouts are active', () => {
  assert.doesNotMatch(sceneSource, /_scoutHold/);
  assert.doesNotMatch(sceneSource, /scoutingHold/);
});
check('overlay gives scout flights a compact non-command billboard', () => {
  assert.match(overlaySource, /_scoutFlight/);
  assert.match(overlaySource, /createScoutBillboard/);
});
check('BattleScene derives scout direction from the hostile battlefront', () => {
  assert.match(sceneSource, /resolveScoutForwardHeading/);
  const launchBody = sceneSource.slice(
    sceneSource.indexOf('private launchScoutForFaction'),
    sceneSource.indexOf('private createScoutFlightRuntime'),
  );
  assert.doesNotMatch(launchBody, /heading:\s*parent\.facingSmooth/);
});

console.log(`\n${passed} scout-flight assertions passed`);
