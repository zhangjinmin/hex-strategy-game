/** Regression harness for bounded formation and logistics movement. */
const K = require('../frontend/src/game/fleetKinematics.ts');
const S = require('../frontend/src/game/SupplyChainSystem.ts');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Bounded formation movement ===');
const far = K.moveTowardsAtSpeed({ x: 0, y: 0 }, { x: 1000, y: 0 }, 1.5);
check('a far-away slot cannot catch up faster just because its target jumped', far.x === 1.5 && far.y === 0, JSON.stringify(far));

const near = K.moveTowardsAtSpeed({ x: 0, y: 0 }, { x: 1, y: 0 }, 1.5);
check('a slot stops exactly at its target without overshooting', near.x === 1 && near.y === 0, JSON.stringify(near));

const facing = K.advanceFormationFacing(0, Math.PI, Math.PI / 12);
check('formation orientation advances by a bounded angular step instead of jumping 180 degrees',
  Math.abs(facing - Math.PI / 12) < 1e-9, String(facing));

console.log('\n=== Transport hull-following movement ===');
const aux = {
  unit: { hp: 100 }, fleet: null, x: 0, y: 0, heading: 0, cargo: 100,
  state: 'outbound', targetFleet: { x: 0, y: 100 }, homeX: 0, homeY: 0,
};
S.moveAuxShips([aux], 1);
const motionHeading = Math.atan2(aux.y, aux.x);
const headingError = Math.abs(Math.atan2(Math.sin(motionHeading - aux.heading), Math.cos(motionHeading - aux.heading)));
check('transport displacement follows its hull heading rather than sliding directly toward a side target',
  Math.hypot(aux.x, aux.y) < 1e-9 || headingError < 1e-9, `motion=${motionHeading}, hull=${aux.heading}`);

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
