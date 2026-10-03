/**
 * v64 任务目标解析（resolveMissionTargets 真源）—— 确定性行为契约测试台
 *
 * 取证背景（_probe_stall.mjs 三相实验，2026-09-30）：
 *   军议 UI targetOptions 写**阵营 id**，旧 executeMissionTick 只按**舰队 id** 查找 ⇒
 *   演习轨道舰队 id（Math.random 浮点）与阵营 id 永不相交 ⇒ attack_fleet/support_fleet
 *   任务 1 个解算周期内静默 clearMission（PhaseB 实证：下达后首个采样窗任务即消失）。
 *
 * 判据（行为断言，require 真源码 TacticalCommandSystem.ts）：
 *   1. 阵营 id 命中（UI 语义）：解析到该阵营全部存活舰队，距 from 近者在前；
 *   2. 舰队 id 精确命中（规划器语义）：优先于阵营命中；
 *   3. 两个 id 空间碰撞时舰队 id 语义优先，且 relation 合法（不追错关系/不追自己）；
 *   4. 目标歼灭（units 空）⇒ 空数组 = 任务完成；
 *   5. relation 过滤：attack 只认敌方、support 只认友方且排除自己。
 */
const assert = require('node:assert/strict');
const { resolveMissionTargets } = require('../frontend/src/game/TacticalCommandSystem.ts');

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

// —— 仿真舰队集（id 空间含碰撞情形）——
// 我方 factionId=81（舰队 id 0.91 浮点 + id=2 的碰撞舰）；敌方 factionId=10147（舰队 id 0.49 浮点 + id=81 的碰撞舰）。
const fleets = [
  { id: 0.91, factionId: 81, x: 0, y: 0, units: [{ hp: 10 }] },       // 我方主力
  { id: 2, factionId: 81, x: 100, y: 0, units: [{ hp: 10 }] },        // 我方二队（id=2 撞"阵营 2"）
  { id: 0.49, factionId: 10147, x: 900, y: 0, units: [{ hp: 10 }] },  // 敌方主力（近）
  { id: 81, factionId: 10147, x: 400, y: 0, units: [{ hp: 10 }] },    // 敌方二队（id=81 撞我方阵营 id）
  { id: 0.2, factionId: 10147, x: 2000, y: 0, units: [] },            // 敌方残骸（units 空 = 歼灭）
];
const myTeam = 1, enemyTeam = 2;
const teamOf = (fl) => (fl.factionId === 81 ? myTeam : enemyTeam);
const isEnemy = (fl) => teamOf(fl) === enemyTeam;
const isAllyNotSelf = (self) => (fl) => teamOf(fl) === myTeam && fl.id !== self.id;

process.stdout.write('=== resolveMissionTargets（TacticalCommandSystem 真源） ===\n');

check('阵营 id 命中（UI 语义）⇒ 解析到该阵营全部存活舰队', () => {
  const out = resolveMissionTargets(fleets, 10147, { relation: isEnemy, from: { x: 0, y: 0 } });
  assert.equal(out.length, 2);
  assert.ok(out.every((fl) => fl.factionId === 10147 && fl.units.length > 0));
});

check('阵营 id 命中多支 ⇒ 距 from 近者在前', () => {
  const out = resolveMissionTargets(fleets, 10147, { relation: isEnemy, from: { x: 0, y: 0 } });
  assert.equal(out[0].id, 81); // 敌二队 x=400 近于敌主力 x=900
});

check('舰队 id 精确命中（规划器语义）⇒ 优先于阵营命中', () => {
  // 专用碰撞夹具：targetId=10147 同时命中「id=10147 的敌舰」与「factionId=10147 的敌舰群」——
  // 必须返回 id 精确命中的那一支（且只那一支），证明舰队 id 语义优先。
  const collide = [
    { id: 10147, factionId: 555, x: 50, y: 0, units: [{ hp: 1 }] },
    { id: 0.9, factionId: 10147, x: 5, y: 0, units: [{ hp: 1 }] },
  ];
  const out = resolveMissionTargets(collide, 10147, {
    relation: (fl) => fl.factionId !== 81, from: { x: 0, y: 0 },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 10147);
});

check('碰撞不追错关系：attack 目标 id=2（我方舰 id）⇒ 不解析到自己人', () => {
  const out = resolveMissionTargets(fleets, 2, { relation: isEnemy, from: { x: 0, y: 0 } });
  assert.equal(out.length, 0); // id=2 是我方舰，敌方无阵营 2 ⇒ 敌侧无合法目标
});

check('support 语义：阵营 id 命中友军且排除自己', () => {
  const self = fleets[0];
  const out = resolveMissionTargets(fleets, 81, { relation: isAllyNotSelf(self), from: { x: 0, y: 0 } });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 2); // 只剩我方二队
});

check('目标歼灭（units 空）⇒ 空数组 = 任务完成', () => {
  const onlyWreck = [{ id: 0.2, factionId: 10147, x: 0, y: 0, units: [] }];
  const out = resolveMissionTargets(onlyWreck, 10147, { relation: isEnemy, from: { x: 0, y: 0 } });
  assert.equal(out.length, 0);
});

check('舰队 id 命中但该舰已歼灭 ⇒ 不返回残骸，落回阵营语义', () => {
  const out = resolveMissionTargets(fleets, 0.2, { relation: isEnemy, from: { x: 0, y: 0 } });
  assert.equal(out.length, 0); // 0.2 是残骸；无阵营 id=0.2 ⇒ 空（任务完成）——不许返回 units 空的残骸
});

check('targetId 未定义 ⇒ 空数组（调用方 clearMission）', () => {
  const out = resolveMissionTargets(fleets, undefined, { relation: isEnemy, from: { x: 0, y: 0 } });
  assert.equal(out.length, 0);
});

process.stdout.write(`\n${passed} passed\n`);
