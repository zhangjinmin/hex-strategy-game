/** Contract: 3D battle presentation and combat locks must obey the same intelligence state. */
const fs = require('node:fs');
const overlay = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');
const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const director = require('../frontend/src/game/aiDirector.ts');

let passed = 0;
let failed = 0;
function check(name, condition) {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}\n`);
  if (condition) passed++; else failed++;
}

console.log('\n=== 3D fog-of-war command contract ===');
check('3D fleet board exposes scout and electronic warfare commands', overlay.includes("['search', 'scout', 'electronic', 'siege', 'defend']"));
check('3D enemy billboards are suppressed until the contact is identified', overlay.includes('isFleetIntelVisible(fleet)'));
check('3D intent lines do not disclose an unidentified enemy target', overlay.includes('isEnemyIntelVisible'));
check('3D transport supply visuals do not disclose an unidentified enemy convoy', overlay.includes('isFleetIntelVisible'));
check('normal combat target acquisition accepts identified contacts only', scene.includes("const clearEnemies = visibleEnemies.filter(v => v.clarity === 'full')"));
check('combat full-contact threshold matches the 35% identified sensor threshold', director.visibilityOf(36, 100) === 'partial');
check('strategic tiles require a fleet-local intelligence check before AI may select them', scene.includes('isTileKnownToFleet(fleet, myFac, t)'));
check('exploration no longer derives a route from omniscient enemy-castle coordinates', !scene.includes('const enemyCastles = this.tilesList.filter'));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
