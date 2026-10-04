/** Regression harness for the combat-state → visual-attrition projection. */
const R = require('../frontend/src/game/combatRepresentation.ts');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Fleet combat representation ===');
const fresh = [
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
  { hp: 100, maxHp: 100, shipCount: 500 },
];
const freshState = R.projectFleetRepresentation(fresh, 6);
check('a full-health fleet displays its entire deployed formation', freshState.visibleCount === 6, String(freshState.visibleCount));
check('the ledger reports all represented ships at full strength', freshState.effectiveShips === 3000, String(freshState.effectiveShips));

const evenlyDamaged = fresh.map((u) => ({ ...u, hp: 33 }));
const damagedState = R.projectFleetRepresentation(evenlyDamaged, 6);
check('one-third fleet health projects to two visible ships rather than a full formation', damagedState.visibleCount === 2, String(damagedState.visibleCount));
check('the display selection is deterministic, not a frame-by-frame random flicker',
  damagedState.visibleIndexes.join(',') === R.projectFleetRepresentation(evenlyDamaged, 6).visibleIndexes.join(','),
  damagedState.visibleIndexes.join(','));

const sunk = fresh.map((u) => ({ ...u, hp: 0 }));
const sunkState = R.projectFleetRepresentation(sunk, 6);
check('a destroyed fleet has neither combat strength nor visible models', sunkState.effectiveShips === 0 && sunkState.visibleCount === 0);

console.log('\n=== Exclusive player beacon contract ===');
const fs = require('node:fs');
const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
check('beacon command rejects an unselected recipient instead of choosing the nearest fleet',
  scene.includes('请先选中要接收信标的己方舰队'));

console.log('\n=== [v72] culling must preserve formation shape ===');
{
  const big = Array.from({ length: 24 }, (_, i) => ({ hp: 100, maxHp: 100, shipCount: 50 }));
  const half = R.projectFleetRepresentation(big, 12);   // 50% 容量
  check('culled fleet still shows the requested count', half.visibleCount === 12, String(half.visibleCount));
  // 关键判据：入选索引必须**散布**，不能是前段
  const idx = half.visibleIndexes;
  const firstHalf = idx.filter((i) => i < 12).length;
  const secondHalf = idx.filter((i) => i >= 12).length;
  check('culled selection spans the whole formation (not a prefix)',
    firstHalf > 0 && secondHalf > 0, `前段${firstHalf}/后段${secondHalf}`);
  check('culled selection is monotonically ordered', idx.every((v, i) => i === 0 || v > idx[i - 1]), idx.join(','));
  check('culled selection is deterministic',
    R.projectFleetRepresentation(big, 12).visibleIndexes.join(',') === idx.join(','));
  // 形状保真：抽稀后相邻间距应大致均匀（若取前段则第一段间距为 0）
  const gaps = idx.slice(1).map((v, i) => v - idx[i]);
  const maxGap = Math.max(...gaps), minGap = Math.min(...gaps);
  check('sampling gaps stay bounded (prefix sampling would give a zero gap)',
    minGap > 0 && maxGap - minGap <= 2, `min=${minGap} max=${maxGap}`);
  // 受伤优先仍生效：重伤单位应被优先换掉
  const mixed = big.map((u, i) => (i % 4 === 0 ? { ...u, hp: 1 } : u));
  const mixedSel = R.projectFleetRepresentation(mixed, 12).visibleIndexes;
  const wounded = mixed.filter((_, i) => i % 4 === 0).map((_, j) => j * 4);
  const keptWounded = mixedSel.filter((i) => wounded.includes(i)).length;
  check('severely damaged slots are preferentially culled', keptWounded <= 3, `保留重伤 ${keptWounded}/6`);
}

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
