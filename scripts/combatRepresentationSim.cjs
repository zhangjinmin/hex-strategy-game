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

console.log('\n=== [v78] 折算必须按阵位空间序（用户实报"前半圆点后半模型"）===');
{
  // 模拟战损后 units 顺序错乱：数组序与 formationSlot 序**不一致**
  //   数组序:  slot 5, 3, 0, 4, 1, 2
  const scrambled = [
    { hp: 100, maxHp: 100, formationSlot: 5 },
    { hp: 100, maxHp: 100, formationSlot: 3 },
    { hp: 100, maxHp: 100, formationSlot: 0 },
    { hp: 100, maxHp: 100, formationSlot: 4 },
    { hp: 100, maxHp: 100, formationSlot: 1 },
    { hp: 100, maxHp: 100, formationSlot: 2 },
  ];
  const slotOfIndex = scrambled.map((u) => u.formationSlot);

  // 旧路径（数组序抽稀）
  const oldWay = R.projectFleetRepresentation(scrambled, 3).visibleIndexes;
  // 新路径（空间序抽稀 + 映射回原下标）
  const newWay = R.projectFleetRepresentationBySlot(scrambled, 3).visibleIndexes;

  const oldSlots = oldWay.map((i) => slotOfIndex[i]).sort((a, b) => a - b);
  const newSlots = newWay.map((i) => slotOfIndex[i]).sort((a, b) => a - b);

  console.log('    数组序 slot: [' + slotOfIndex.join(',') + ']');
  console.log('    旧(数组序)选中 slot: [' + oldSlots.join(',') + ']');
  console.log('    新(空间序)选中 slot: [' + newSlots.join(',') + ']');

  // 实算：数组序 [5,3,0,4,1,2]，6 选 3 等间隔取 pos=1,3,5
  //   旧（数组序）⇒ 下标 [1,3,5] ⇒ slot [3,4,2] ⇒ 排序 [2,3,4]（间距 1,1 = **聚集**）
  //   新（空间序）⇒ order 按 slot 升序后取 pos=1,3,5 ⇒ slot [1,3,5]（间距 2,2 = **均匀**）
  check('旧路径在错乱序上产生**聚集**（这正是用户看到的"前后分离"）',
    JSON.stringify(oldSlots) === JSON.stringify([2, 3, 4]),
    '[' + oldSlots.join(',') + ']');
  check('新路径按空间序抽稀 ⇒ 均匀分布（1,3,5）',
    JSON.stringify(newSlots) === JSON.stringify([1, 3, 5]),
    '[' + newSlots.join(',') + ']');
  check('新路径 slot 间距均匀 2,2（无"前半/后半"分离）',
    newSlots[1] - newSlots[0] === 2 && newSlots[2] - newSlots[1] === 2,
    `间距 ${newSlots[1] - newSlots[0]},${newSlots[2] - newSlots[1]}`);
  check('旧路径间距 1,1（聚集 — 对照）',
    oldSlots[1] - oldSlots[0] === 1 && oldSlots[2] - oldSlots[1] === 1,
    `间距 ${oldSlots[1] - oldSlots[0]},${oldSlots[2] - oldSlots[1]}`);
  check('容量=全员时新旧路径完全一致（零行为变更）',
    R.projectFleetRepresentationBySlot(scrambled, 6).visibleIndexes.join(',') ===
    R.projectFleetRepresentation(scrambled, 6).visibleIndexes.join(','));
  check('空数组不崩', R.projectFleetRepresentationBySlot([], 3).visibleCount === 0);
}

console.log('\n=== [v78] 折算数量量化到 5% 档（防血量微变导致忽隐忽现）===');
{
  const mk = (hp) => Array.from({ length: 100 }, () => ({ hp, maxHp: 100 }));
  const c = (hp) => R.projectFleetRepresentation(mk(hp), 100).visibleCount;
  check('满血 = 全员', c(100) === 100, String(c(100)));
  // 5% 档边界 = 0.975（19.5/20）：≥0.975 ⇒ 1.00 档；0.925~0.975 ⇒ 0.95 档
  check('血量 100→98 不改变数量（98% ≥ 97.5% ⇒ 仍在 1.00 档）',
    c(98) === c(100), `${c(98)} vs ${c(100)}`);
  check('血量 100→96 落 0.95 档 ⇒ 数量减少（量化生效）',
    c(96) < c(100) && c(96) === 95, `${c(96)} vs ${c(100)}`);
  check('量化后数量单调不增（血量降⇒数量不增）',
    c(100) >= c(90) && c(90) >= c(80) && c(80) >= c(50));
  check('同档内不抖动：93 与 94 同档（均 0.95）', c(93) === c(94), `${c(93)} vs ${c(94)}`);
  check('量化步进为 5%（相邻档差 5 个/百）',
    c(100) - c(94) === 5, `${c(100)} - ${c(94)} = ${c(100) - c(94)}`);
  check('零血 ⇒ 零可见', c(0) === 0, String(c(0)));
}

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
