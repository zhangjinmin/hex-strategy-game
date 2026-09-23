/** Contract: fog contact tiers must be consumed by the live battle scene. */
const fs = require('node:fs');
const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const overlay = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition) {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Fog contact integration ===');
check('BattleScene uses the shared contact assessor', scene.includes('assessContact('));
check('contact state is exported to the battle HUD', scene.includes('contactState: contact.state'));
check('3D overlay excludes units hidden by fog', overlay.includes('u.sprite.visible === false'));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
