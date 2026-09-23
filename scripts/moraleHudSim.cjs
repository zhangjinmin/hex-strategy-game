/** Contract: battle morale must reach the player-facing fleet HUD. */
const fs = require('node:fs');
const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const app = fs.readFileSync('./frontend/src/App.vue', 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition) {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Morale HUD contract ===');
check('BattleScene exports fleet morale with its HUD data', scene.includes('supply: flagship.supply, morale: fl.morale'));
check('fleet HUD renders a morale bar', app.includes('fleet.morale') && app.includes('士气'));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
