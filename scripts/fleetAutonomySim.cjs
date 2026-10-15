/**
 * [W3/W4 · 可玩性冲刺] 舰队自主行动 + 流程引导 —— 行为与源码契约断言。
 *
 * 设计：以「源码契约 + 纯函数行为」双重断言锁定本次修复。任何一处被回退（变异测试）都会 FAIL。
 * 覆盖：
 *   W3.1 停滞看门狗不再整体排除玩家阵营（且仍以 !w1DOrder 守住"不越权覆盖玩家直接指令"）
 *   W3.2 hold_point 到位后加超时（HOLD_POINT_MAX_MS），消除永久驻守
 *   W3.3 任务下达改为阵营广播（全阵营舰队而非只第一支）
 *   W3.4 玩家本队无指令时给默认自主任务（attack_fleet），玩家一动手即撤销
 *   W3.5 敌方末位保守舰队改为"据点附近巡逻 + 接敌即战"（patrolRadius）
 *   W3.6 `_deployTactic` 断供机制已移除（恒 1.15）
 *   W3.7 每 2s 舰队行为快照（可观测性）
 *   W4.1 演习倒计时到点不再自动开战（deployAutoStart 默认 false）
 *   W4.2 部署期 GameFooter 常驻提示（不再只显示"系统演算已暂停"）
 *   W4.4 GameFooter 操作文案修正（空格=指挥点面板）
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const tactical = require('../frontend/src/game/TacticalCommandSystem.ts');

const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const store = fs.readFileSync('./frontend/src/store/gameStore.ts', 'utf8');
const footer = fs.readFileSync('./frontend/src/components/battle/GameFooter.vue', 'utf8');

let passed = 0;
let failed = 0;
function check(name, body) {
  try {
    assert.equal(body(), true);
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}: ${error.message}\n`);
  }
}

const slice = (startMark, endMark) => {
  const start = scene.indexOf(startMark);
  if (start < 0) return '';
  const end = scene.indexOf(endMark, start + startMark.length);
  return end < 0 ? scene.slice(start) : scene.slice(start, end);
};

console.log('\n=== W3.5 巡逻任务（纯函数行为）===');
check('buildMission(hold_point) 透传 patrolRadius（>0 ⇒ 巡逻，非原地驻守）', () =>
  tactical.buildMission('hold_point', { x: 10, y: 20, patrolRadius: 380 }).patrolRadius === 380);
check('buildMission(hold_point) 未给 patrolRadius ⇒ 保持原地驻守语义', () =>
  tactical.buildMission('hold_point', { x: 10, y: 20 }).patrolRadius === undefined);
check('buildMission 对非 hold_point 类型不引入 patrolRadius 副作用', () => {
  const m = tactical.buildMission('attack_fleet', { targetId: 3, targetName: '敌' });
  return m.type === 'attack_fleet' && m.patrolRadius === undefined;
});

console.log('\n=== W3.1 停滞看门狗不再整体排除玩家 ===');
check('看门狗执行块仅以 !w1DOrder 守卫（不再有 myFac.type !== \'player\'）', () => {
  const block = slice('三选一执行（chooseStallAction 策略已在 tickStallWatchdog 内裁决）', '执行后重开观测窗');
  return block.includes('stallOut.directive !== \'none\' && !w1DOrder')
    && !block.includes("myFac.type !== 'player'");
});
check('看门狗对玩家舰队不施加 withdrawal（不覆写玩家手动姿态）', () =>
  scene.includes("w1PlayerFleet && stallOut.directive === 'withdrawal'"));

console.log('\n=== W3.2 hold_point 到位超时（消除永久驻守）===');
check('HOLD_POINT_MAX_MS 常量已定义', () => /const HOLD_POINT_MAX_MS = \d+;/.test(scene));
check('executeMissionTick 的 hold_point 分支使用到位超时并 clearMission', () => {
  const block = slice("} else if (m.type === 'hold_point') {", "} else if (m.type === 'support_fleet') {");
  return block.includes('HOLD_POINT_MAX_MS') && block.includes('clearMission()') && block.includes('_holdArrivedAt');
});
check('超时后转 search 且受 L1 姿态锁保护', () => {
  const block = slice("} else if (m.type === 'hold_point') {", "} else if (m.type === 'support_fleet') {");
  return /isStanceLocked\(fleet\)\)\s*fleet\.stance = 'search'/.test(block);
});

console.log('\n=== W3.3 任务下达改为阵营广播 ===');
check('mission 分支同步到该 faction 全部舰队', () => {
  const block = slice("if (type === 'mission') {", 'return;');
  return block.includes('facFleets') && block.includes('for (const fl of facFleets)') && block.includes('fl.mission = mm');
});
check('hold_point 缺省坐标逐支解析（"各守当前位置"）', () => {
  const block = slice("if (type === 'mission') {", 'return;');
  return /mm\.x = Math\.round\(fl\.x\)/.test(block) && /mm\.y = Math\.round\(fl\.y\)/.test(block);
});

console.log('\n=== W3.4 玩家本队默认自主任务 ===');
check('startBattleAfterDeploy 为玩家本队派默认 attack_fleet（无指令/非驻守时）', () => {
  const block = slice('private startBattleAfterDeploy()', 'private planAiFactionsForDeploy()');
  return block.includes("buildMission('attack_fleet'") && block.includes('_playerDefaultMission');
});
check('玩家显式选择"驻守"时不派默认任务', () => {
  const block = slice('private startBattleAfterDeploy()', 'private planAiFactionsForDeploy()');
  return block.includes("this.deployTactic !== 'defend'");
});
check('applyStanceToFleet 收到玩家姿态指令即撤下默认任务（交回玩家控制）', () => {
  const block = slice('private applyStanceToFleet(fleet: any, payload: string) {', 'fleet.stance = payload;');
  return block.includes('_playerDefaultMission') && block.includes('fleet.mission = null');
});

console.log('\n=== W3.5 敌方末位改巡逻 ===');
check('planFactionBattle 末位 conservative 分支带 patrolRadius', () => {
  const block = slice('const isLast = idx === scored.length - 1;', 'fl.mission = mission;');
  return block.includes("buildMission('hold_point'") && block.includes('patrolRadius');
});
check('executeMissionTick 支持 patrolRadius 巡逻航点', () => {
  const block = slice("} else if (m.type === 'hold_point') {", "} else if (m.type === 'support_fleet') {");
  return block.includes('patrolR > 0') && block.includes('_patrolWaypoint');
});

console.log('\n=== W3.6 _deployTactic 断供机制移除 ===');
check('不再有 _deployTactic 的消费分支（已废弃）', () => !scene.includes('aiFac._deployTactic ==='));
check('deployAdj 恒为常量 1.15（行为不变）', () => /const deployAdj = 1\.15;/.test(scene));

console.log('\n=== W3.7 舰队行为快照（可观测性）===');
check('存在 2s 节流的舰队快照输出', () =>
  scene.includes('FLEET_SNAPSHOT_INTERVAL_MS') && scene.includes('collectFleetSnapshot') && scene.includes('maybeLogFleetSnapshot'));
check('快照含 阵营/type/mission/stance/state/target/距目标 字段', () => {
  const block = slice('private collectFleetSnapshot()', 'private maybeLogFleetSnapshot');
  return ['type=', 'mission=', 'stance=', 'state=', 'target=', '距目标='].every((k) => block.includes(k));
});
check('快照同时暴露到 store.fleetBehaviorSnapshot', () => scene.includes('fleetBehaviorSnapshot'));

console.log('\n=== W4.1 倒计时不再自动开战 ===');
check('store 提供 deployAutoStart（默认 false）', () =>
  /const deployAutoStart = ref<boolean>\(false\)/.test(store));
check('倒计时到点仅在 deployAutoStart===true 时自动开战', () => {
  const block = slice('this.deployCountdownTimer = this.time.addEvent({', 'this.planAiFactionsForDeploy();');
  return block.includes('s.deployAutoStart === true') && block.includes("showBattleBanner('部署时间到'");
});

console.log('\n=== W4.2 / W4.4 GameFooter ===');
check('部署期 footer 显示阵型/姿态/回车开战（常驻提示）', () =>
  footer.includes('battleDeployPhase') && footer.includes('回车开战') && footer.includes('formCn') && footer.includes('tacticCn'));
check('footer 不再把"空格"写成"暂停"（改为指挥点面板）', () =>
  !footer.includes('空格暂停') && footer.includes('指挥点面板'));

console.log(`\n[fleetAutonomySim] passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exit(1);
}
