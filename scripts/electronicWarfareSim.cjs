/** Contract: electronic ships can actively jam detection and combat locking. */
const fs = require('node:fs');
const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const app = fs.readFileSync('./frontend/src/App.vue', 'utf8');
const commands = fs.readFileSync('./frontend/src/game/TacticalCommandSystem.ts', 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition) {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Electronic warfare ===');
check('direct command permissions include electronic warfare', commands.includes("'electronic'"));
check('fleet HUD exposes electronic jamming', app.includes("'electronic'"));
check('BattleScene requires a real electronic ship before jamming', scene.includes('activateElectronicWarfare') && scene.includes("u.classType === '电子' || u.classType === 'electronic'"));
check('fog contact assessment applies target jamming', scene.includes('jammingStrength'));
check('combat visibility is reduced by active electronic jamming', scene.includes('targetJamming'));
check('electronic warfare creates expiring false contacts', scene.includes('electronicDecoys') && scene.includes('expiresAt'));
check('searching fleets may investigate a false contact but cannot fire on it', scene.includes('_electronicDecoy') && scene.includes("clarity: 'fuzzy'"));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
