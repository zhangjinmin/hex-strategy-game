/**
 * W3 指挥继任 / 指针反馈 / 分兵生命周期 / 任务语言 —— 确定性行为契约测试台
 *
 * 对应设计判据（2026-09-23-battle-command-and-ai-flow-rebuild-design.md §Verification）：
 *   7. succession refreshes selection and direct-control UI（继任 6 步 + 指挥崩溃态）
 *   8. pointer feedback contains no persistent large hex（短暂 chevron / target-lock）
 *  10. AI splitting requires a qualified plan（canSplit 消费 + 玩家禁自动分兵 + abort 归队）
 *  12. mission and intent labels match the new terminology（五词 + 奉令/临机/交战/整补）
 *
 * 模式与 reconIntelSim.cjs 一致：
 *   · 行为断言：require 纯函数真源（taskForce.ts）直接判；
 *   · 源码契约断言：对 BattleScene.ts / Battle3DOverlay.ts / TacticalCommandSystem.ts /
 *     CouncilWarRoom.vue 的字符串/正则检查（弱补充，行为由 vue-tsc + L2 台架兜底）。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const taskForce = require('../frontend/src/game/taskForce.ts');

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

const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const overlay = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');
const tactical = fs.readFileSync('./frontend/src/game/TacticalCommandSystem.ts', 'utf8');
const warroom = fs.readFileSync('./frontend/src/components/battle/CouncilWarRoom.vue', 'utf8');

function sliceOf(src, from, to) {
  const i = src.indexOf(from);
  const j = to ? src.indexOf(to, i + from.length) : src.length;
  assert.ok(i >= 0, `missing anchor: ${from}`);
  return src.slice(i, j < 0 ? src.length : j);
}

// ============================================================
// 一、分兵禁止条件 canSplit（判据 10：不合格计划禁止分兵）
// ============================================================
console.log('\n=== 分兵禁止条件（taskForce.canSplit 真源） ===');
check('兵力不足 ⇒ force_size 拒绝', () => {
  assert.deepEqual(taskForce.canSplit({ combatUnits: 2, hpPct: 1, lateralSpace: 999, contactQuality: 2, commandDegraded: false }),
    { ok: false, reason: 'force_size' });
});
check('舰况过低 ⇒ ship_condition 拒绝', () => {
  assert.equal(taskForce.canSplit({ combatUnits: 10, hpPct: 0.3, lateralSpace: 999, contactQuality: 2, commandDegraded: false }).reason,
    'ship_condition');
});
check('侧向无空间 ⇒ no_space 拒绝', () => {
  assert.equal(taskForce.canSplit({ combatUnits: 10, hpPct: 1, lateralSpace: 10, contactQuality: 2, commandDegraded: false }).reason,
    'no_space');
});
check('情报不足 ⇒ contact_quality 拒绝', () => {
  assert.equal(taskForce.canSplit({ combatUnits: 10, hpPct: 1, lateralSpace: 999, contactQuality: 0, commandDegraded: false }).reason,
    'contact_quality');
});
check('指挥带宽降级 ⇒ command_bandwidth 拒绝', () => {
  assert.equal(taskForce.canSplit({ combatUnits: 10, hpPct: 1, lateralSpace: 999, contactQuality: 2, commandDegraded: true }).reason,
    'command_bandwidth');
});
check('全部合格 ⇒ ok 放行', () => {
  assert.deepEqual(taskForce.canSplit({ combatUnits: 10, hpPct: 1, lateralSpace: 999, contactQuality: 2, commandDegraded: false }),
    { ok: true, reason: null });
});

// ============================================================
// 二、分队归队判定 shouldRejoin（判据 10：abort 归队，不得永久分立）
// ============================================================
console.log('\n=== 分队归队判定（taskForce.shouldRejoin 真源） ===');
check('任务完成 ⇒ objective_done 归队', () => {
  assert.deepEqual(taskForce.shouldRejoin({ detachedMs: 100, startUnits: 6, nowUnits: 6, objectiveDone: true }),
    { rejoin: true, reason: 'objective_done' });
});
check('分出超时 ⇒ timeout 归队（不得仅因开局规划长期分立）', () => {
  assert.equal(taskForce.shouldRejoin({ detachedMs: taskForce.DETACH_TIMEOUT_MS, startUnits: 6, nowUnits: 6, objectiveDone: false }).reason,
    'timeout');
});
check('兵力损失过半 ⇒ attrition 归队', () => {
  assert.equal(taskForce.shouldRejoin({ detachedMs: 100, startUnits: 6, nowUnits: 3, objectiveDone: false }).reason,
    'attrition');
});
check('状态健康 ⇒ 不归队', () => {
  assert.deepEqual(taskForce.shouldRejoin({ detachedMs: 100, startUnits: 6, nowUnits: 5, objectiveDone: false }),
    { rejoin: false, reason: null });
});

// ============================================================
// 三、BattleScene 消费（判据 10 接线）
// ============================================================
console.log('\n=== BattleScene 分兵生命周期接线 ===');
check('分兵入口消费 canSplit 与拒绝原因文案', () => {
  assert.ok(scene.includes('canSplit('), 'missing canSplit(');
  assert.ok(scene.includes('SPLIT_DENY_LABELS'), 'missing SPLIT_DENY_LABELS');
});
check('分队每帧收口 shouldRejoin（abort 归队）', () => {
  assert.ok(scene.includes('shouldRejoin('), 'missing shouldRejoin(');
  assert.ok(scene.includes('REJOIN_LABELS'), 'missing REJOIN_LABELS');
});
check('自动分兵对直控玩家舰队关门（显式请求除外）', () => {
  const planBody = sliceOf(scene, 'private applyManeuver', 'public splitSelectedFleet');
  assert.ok(/canDirectlyControlFleet\(parent\)/.test(planBody), 'auto plan must skip directly controlled fleet');
});

// ============================================================
// 四、指挥继任 6 步 + 指挥崩溃态（判据 7 / §Failure handling）
// ============================================================
console.log('\n=== 指挥继任（6 步 + 指挥崩溃态） ===');
const succBody = sliceOf(scene, 'private checkSupremeSuccession', 'private spawnSupplyRelayPlanets');
check('步骤3：继任时清除已被歼灭的选中', () => {
  assert.ok(succBody.includes('battleSelectedFleetId = null'), 'must clear destroyed selection');
});
check('步骤5：无其他可指挥舰队时自动选中继任旗舰', () => {
  assert.ok(/battleSelectedFleetId = nFleet\.id/.test(succBody), 'must select successor fleet');
});
check('步骤6：确认实时指挥已可用', () => {
  assert.ok(/实时指挥/.test(succBody), 'must acknowledge real-time command');
});
check('无继任者 ⇒ 指挥崩溃态（非误导性实时指挥文案）', () => {
  assert.ok(scene.includes('commandCollapsed'), 'missing commandCollapsed state');
  assert.ok(/指挥崩溃/.test(succBody), 'succession must expose command-collapse');
});
check('指挥崩溃态禁用直接指令', () => {
  const guardBody = sliceOf(scene, 'private canDirectlyControlFleet', 'private applyFleetSelectByPick');
  assert.ok(guardBody.includes('commandCollapsed'), 'direct command must respect commandCollapsed');
});

// ============================================================
// 五、指针反馈（判据 8 / §Pointer feedback / §Failure cleanup）
// ============================================================
console.log('\n=== 指针反馈（短暂标记，无常驻大 hex） ===');
check('常驻大 hex 指示已移除（透明度钳位不再钉住）', () => {
  assert.ok(!overlay.includes('Math.max(0.45'), 'persistent selRing clamp must be removed');
});
check('overlay 提供 chevron / target-lock / 清理三接口', () => {
  assert.ok(overlay.includes('showPointerChevron'), 'missing showPointerChevron');
  assert.ok(overlay.includes('showTargetLock'), 'missing showTargetLock');
  assert.ok(overlay.includes('clearPointerMarkers'), 'missing clearPointerMarkers');
});
check('成功移动指令落目的地 chevron/ring', () => {
  const moveBody = sliceOf(scene, 'private orderFleetMove', 'private markFleetIdentified');
  assert.ok(moveBody.includes('showPointerChevron('), 'move must drop chevron');
});
check('成功攻击指令落目标锁标记', () => {
  const atkBody = sliceOf(scene, 'private orderFleetAttack', 'private orderFleetMove');
  assert.ok(atkBody.includes('showTargetLock('), 'attack must drop target lock');
});
check('战斗结算清理瞬态指针标记', () => {
  const resBody = sliceOf(scene, 'private beginBattleResolution', 'private electronicJammingOf');
  assert.ok(resBody.includes('clearPointerMarkers'), 'resolution must clear pointer markers');
});

// ============================================================
// 六、任务与意图语言（判据 12 / §Mission language）
// ============================================================
console.log('\n=== 任务与意图语言（五词 + 意图前缀） ===');
check('任务五词齐备', () => {
  for (const w of ['进击敌舰队', '夺取战略据点', '固守战区', '协同友军', '撤回整补']) {
    assert.ok(tactical.includes(w), `missing ${w}`);
  }
});
check('运行时意图四前缀：奉令/临机/交战/整补', () => {
  for (const p of ['奉令：', '临机：', '交战：', '整补：']) {
    assert.ok(tactical.includes(p), `missing ${p}`);
  }
});
check('BattleScene 意图标签走统一前缀函数', () => {
  assert.ok(scene.includes('intentLabel('), 'missing intentLabel(');
});
check('军议面板消费五词任务表', () => {
  assert.ok(warroom.includes('MISSION_TYPES'), 'CouncilWarRoom must consume MISSION_TYPES');
});
check('billboard 意图行消费 _intentLabel', () => {
  assert.ok(overlay.includes('_intentLabel'), 'billboard must render intent label');
});

// ============================================================
// 七、billboard 三概念（§Fleet billboard：态势/行动/分舰）
// ============================================================
console.log('\n=== billboard 三概念（态势/行动/分舰） ===');
check('三概念名称齐备', () => {
  for (const w of ['态势', '行动', '分舰']) {
    assert.ok(overlay.includes(w), `missing ${w}`);
  }
});
check('移动/攻击不再是常驻按钮（右键直接承担）', () => {
  const bbBody = sliceOf(overlay, 'private createBillboard', 'private createScoutBillboard');
  assert.ok(!/textContent = '移动'/.test(bbBody), 'no permanent move button');
  assert.ok(!/textContent = '攻击'/.test(bbBody), 'no permanent attack button');
});
check('按钮可用性按当前指挥权威逐帧派生（不冻结于创建帧）', () => {
  assert.ok(/canDirectlyControl|deriveAuthority|refreshAuthority/.test(overlay), 'controls must derive from live authority');
});

console.log(`\n=== uiCommandSim: ${passed} passed${process.exitCode ? ' (with FAILs)' : ''} ===`);
