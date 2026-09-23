/** Deterministic battle-tick contract; intentionally independent from Phaser/Three. */
let battle = {};
try {
  battle = require('../frontend/src/game/battle/BattleTick.ts');
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

console.log('\n=== Deterministic battle tick contract ===');
check('exports a pure advanceBattle tick', typeof battle.advanceBattle === 'function');

if (typeof battle.advanceBattle === 'function') {
  const initial = {
    tick: 0,
    fleets: [{ id: 'empire', morale: 60, supply: 10, units: [{ id: 'e-1', hp: 100, maxHp: 100 }] }],
    events: [],
  };
  const once = battle.advanceBattle(initial, 1000, () => 0.5);
  const twice = battle.advanceBattle(initial, 1000, () => 0.5);
  check('does not mutate the input state', initial.tick === 0 && once.state !== initial);
  check('replays identically for fixed input and RNG', JSON.stringify(once) === JSON.stringify(twice));
  check('advances exactly one tick', once.state.tick === 1);
  check('routes supply pressure through morale during the shared tick', once.state.fleets[0].morale < 60, JSON.stringify(once.state.fleets[0]));
}

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
