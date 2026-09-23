/** Regression contract for fleet order ownership and priority. */
const fs = require('node:fs');
const sceneSource = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
let command = {};
try {
  command = require('../frontend/src/game/battle/CommandSystem.ts');
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

console.log('\n=== Fleet order ownership ===');
check('exports resolveFleetOrder', typeof command.resolveFleetOrder === 'function');

if (typeof command.resolveFleetOrder === 'function') {
  const playerBeacon = { kind: 'beacon', issuer: 'player', target: { x: 900, y: 200 }, expiresAt: 20000 };
  const aiAdvance = { kind: 'advance', issuer: 'ai', target: { x: 100, y: 100 }, expiresAt: 30000 };
  const resolved = command.resolveFleetOrder([aiAdvance, playerBeacon], 1000);
  check('player beacon remains exclusive over a friendly AI movement order',
    resolved?.kind === 'beacon' && resolved.target.x === 900, JSON.stringify(resolved));

  const expired = command.resolveFleetOrder([playerBeacon, aiAdvance], 20001);
  check('expired player beacon releases the fleet to a valid AI order',
    expired?.kind === 'advance', JSON.stringify(expired));
}

let tactical = {};
try {
  tactical = require('../frontend/src/game/TacticalCommandSystem.ts');
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
}

console.log('\n=== Formal command fleet eligibility ===');
check('exports isFormalCommandFleet', typeof tactical.isFormalCommandFleet === 'function');
if (typeof tactical.isFormalCommandFleet === 'function') {
  check('living combat fleet is succession eligible', tactical.isFormalCommandFleet({ units: [{ hp: 10, classType: '战列' }] }) === true);
  check('scout flight is never succession eligible', tactical.isFormalCommandFleet({ _scoutFlight: true, units: [{ hp: 10, classType: '巡洋' }] }) === false);
  check('auxiliary-only and empty fleets are not eligible',
    tactical.isFormalCommandFleet({ units: [{ hp: 10, classType: '补给' }] }) === false
      && tactical.isFormalCommandFleet({ units: [] }) === false);
}
check('supreme commander selection and right-click use command authority instead of faction type',
  (sceneSource.match(/canDirectlyControlFleet\(/g) || []).length >= 4
    && !sceneSource.slice(sceneSource.indexOf('public applyFleetSelectByPick'), sceneSource.indexOf('/** 执行命令')).includes("flFac.type === 'player'"));

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
