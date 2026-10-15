/**
 * [W3/W4/W8 · 可玩性冲刺] 舰队自主行动 + 流程引导 + 集结态迁移。
 *
 * 设计目标（红队 R1 修法）：
 *   **真跑决策链** —— 把 `BattleScene.ts` 的**真实分支**抽出，经 node
 *   `stripTypeScriptTypes` 去型后用 `new Function` **真正执行**（**不手抄副本**），
 *   断言其**行为**（而非 `block.includes(...)` 的字符串匹配 —— 那是 `f(x)===f(x)`，
 *   只对"整段删除"敏感，对取值/语义/行为完全不敏感，5 组变异全绿 ⇒ 无牙齿）。
 *
 * 行为层（真跑 + 变异自检，改坏必须 FAIL）：
 *   · W3.5 巡逻 hold_point（patrolRadius>0）⇒ 从**不**进入 defend、目标离开锚点
 *   · W3.2 无半径 hold_point（AI）⇒ ≤26s 内 mission===null 且 stance==='search'
 *   · R4   玩家 manual hold_point ⇒ **不**超时（mission 仍在、stance 停在 defend）
 *   · R8-b assembling 超时 / 抵达任务目的地 ⇒ 转 exploring
 *   · R8-a assembling 有 _missionDest ⇒ 目标被牵引到任务点
 *
 * 源码契约层（保留；防"整段删除"）：
 *   W3.1 看门狗、W3.3 阵营广播、W3.4 默认任务、W3.6、W3.7、W4.1、W4.2、W4.4
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');

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

/** 既有字符串切片（保留：源码契约层） */
const slice = (startMark, endMark) => {
  const start = scene.indexOf(startMark);
  if (start < 0) return '';
  const end = scene.indexOf(endMark, start + startMark.length);
  return end < 0 ? scene.slice(start) : scene.slice(start, end);
};

/** 唯一锚点抽取：锚点缺失或**不唯一**一律抛错（本项目有过"锚点被注释误匹配"的教训）。
 *  `includeEnd`：结束锚点本身是**目标块自己的闭合 `}`** 时置 1（把该 `}` 纳进来，保证括号平衡）。 */
function extractUnique(startMark, endMark, includeEnd = 0) {
  const first = scene.indexOf(startMark);
  if (first < 0) throw new Error(`锚点缺失: ${startMark}`);
  if (scene.indexOf(startMark, first + 1) >= 0) throw new Error(`锚点不唯一: ${startMark}`);
  const end = scene.indexOf(endMark, first + startMark.length);
  if (end < 0) throw new Error(`结束锚点缺失: ${endMark}`);
  return scene.slice(first, end + includeEnd);
}

/** 提取 → 去型 → 编译为可调用函数（mutate 可选，用于变异自检）。
 *  ⚠ 目标分支体内含 `return;`（超时分支早退）⇒ 不能把裸块交给 stripTypeScriptTypes（会对顶层 return 报
 *  ERR_INVALID_TYPESCRIPT_SYNTAX）⇒ 先包进 `function(params){...}` 再剥型，然后 `new Function` 产出回调。 */
function compileBlock(startMark, endMark, leadingReplace, paramNames, mutate, includeEnd = 0) {
  let src = extractUnique(startMark, endMark, includeEnd);
  if (leadingReplace) {
    const [from, to] = leadingReplace;
    src = src.split(from).join(to);
  }
  // ⚠ mutate 必须在 `this.` 重绑定**之前**应用（变异串按源码原文书写）。
  if (mutate) src = mutate(src);
  src = src.split('this.time.now').join('now');
  src = src.split('this.isStanceLocked(fleet)').join('isStanceLocked(fleet)');
  const wrapped = `(function(${paramNames.join(', ')}) {\n${src}\n})`;
  const js = stripTypeScriptTypes(wrapped);
  return new Function(`return ${js};`)();
}

// ── Phaser 距离函数垫片（与 Phaser.Math.Distance.Between 语义一致）──
const Phaser = { Math: { Distance: { Between: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1) } } };

// ════════════════════════════════════════════════════════════════════
// 行为层 1：executeMissionTick 的 hold_point 真实分支
// ════════════════════════════════════════════════════════════════════
const HOLD_START = "} else if (m.type === 'hold_point') {";
const HOLD_END = "} else if (m.type === 'support_fleet') {";
const HOLD_PARAMS = ['fleet', 'm', 'dist', 'clearMission', 'isStanceLocked', 'now', 'HOLD_POINT_MAX_MS'];

function compileHold(mutate) {
  // HOLD_END 以目标分支自己的闭合 `}` 开头 ⇒ includeEnd=1 把它纳入，保证 `if { ... }` 括号平衡。
  return compileBlock(HOLD_START, HOLD_END, [HOLD_START, "if (m.type === 'hold_point') {"], HOLD_PARAMS, mutate, 1);
}

const makeFleet = (o = {}) => Object.assign({ id: 1, x: 100, y: 100, stance: 'search', _missionDest: null }, o);

/** 巡逻场景：返回 { sawDefend, sawAway, maxAway }（目标是否离开锚点）。 */
function runPatrol(tick) {
  const fleet = makeFleet();
  const m = { type: 'hold_point', x: 100, y: 100, patrolRadius: 300 };
  const dist = (x, y) => Math.hypot(fleet.x - x, fleet.y - y);
  const clearMission = () => { fleet._missionDest = null; };
  let sawDefend = false, sawAway = false, maxAway = 0;
  for (let t = 0; t <= 60000; t += 1000) {
    tick(fleet, m, dist, clearMission, () => false, t, 25000);
    if (fleet.stance === 'defend') sawDefend = true;
    if (fleet._missionDest) {
      const away = Math.hypot(fleet._missionDest.x - 100, fleet._missionDest.y - 100);
      maxAway = Math.max(maxAway, away);
      if (away > 100) sawAway = true;
      fleet.x = fleet._missionDest.x; fleet.y = fleet._missionDest.y;   // 模拟抵达 ⇒ 下帧重掷航点
    }
  }
  return { sawDefend, sawAway, maxAway };
}

/** 无半径场景（AI / 或 manual 玩家）：返回 { missionCleared, clearedAtMs, finalStance }。 */
function runHoldNoRadius(tick, manual) {
  const fleet = makeFleet();                              // 起点即锚点 ⇒ arrived 立即为真
  const m = { type: 'hold_point', x: 100, y: 100 };
  if (manual) m.manual = true;
  let live = m;                                           // 模拟 1Hz 循环：mission 被清则不再调用
  const dist = (x, y) => Math.hypot(fleet.x - x, fleet.y - y);
  const clearMission = () => { live = null; fleet._missionDest = null; };
  let clearedAtMs = -1;
  for (let t = 0; t <= 60000; t += 1000) {
    if (live) tick(fleet, m, dist, clearMission, () => false, t, 25000);
    if (live === null && clearedAtMs < 0) clearedAtMs = t;
  }
  return { missionCleared: live === null, clearedAtMs, finalStance: fleet.stance };
}

console.log('\n=== W3.5 巡逻 hold_point（真跑：从不 defend / 目标离开锚点）===');
{
  const tick = compileHold();
  const r = runPatrol(tick);
  check('巡逻 hold_point 从不进入 defend（patrolRadius>0 分支恒走 search）', () => r.sawDefend === false);
  check('巡逻 hold_point 目标离开锚点（_missionDest 在圆周上 > 100px）', () => r.sawAway === true && r.maxAway > 100);
}

console.log('\n=== W3.2 无半径 hold_point 到位超时（真跑：≤26s 清 mission 转 search）===');
{
  const tick = compileHold();
  const r = runHoldNoRadius(tick, false);
  check('AI 无半径 hold_point ≤26s 内 mission===null', () => r.missionCleared === true && r.clearedAtMs > 0 && r.clearedAtMs <= 26000);
  check('超时后 stance 落回 search', () => r.finalStance === 'search');
}

console.log('\n=== R4 玩家明令 hold_point（manual）不受 25s 超时误伤 ===');
{
  const tick = compileHold();
  const r = runHoldNoRadius(tick, true);
  check('manual hold_point 60s 内 mission 仍在（未被超时清空）', () => r.missionCleared === false);
  check('manual hold_point 到位后保持 defend', () => r.finalStance === 'defend');
}

console.log('\n=== 变异自检 1：巡逻半径恒 0 ⇒ 必须 FAIL ===');
{
  const tickMut = compileHold((s) => s.split('const patrolR = m.patrolRadius ?? 0;').join('const patrolR = 0;'));
  const r = runPatrol(tickMut);
  check('变异已生效：巡逻分支被破坏 ⇒ 进入 defend（断言可检出）', () => r.sawDefend === true);
}

console.log('\n=== 变异自检 2：超时禁用 ⇒ 必须 FAIL ===');
{
  const tickMut = compileHold((s) => s
    .split('!m.manual && this.time.now - (fleet as any)._holdArrivedAt > HOLD_POINT_MAX_MS').join('false'));
  const r = runHoldNoRadius(tickMut, false);
  check('变异已生效：超时禁用 ⇒ AI hold 永不清 mission（断言可检出）', () => r.missionCleared === false);
}

console.log('\n=== 变异自检 3：忽略 manual ⇒ 玩家固守被误伤（必须可检出）===');
{
  const tickMut = compileHold((s) => s.split('!m.manual && ').join(''));
  const r = runHoldNoRadius(tickMut, true);
  check('变异已生效：manual 被忽略 ⇒ 玩家 hold 被 25s 超时清空（断言可检出）', () => r.missionCleared === true);
}

// ════════════════════════════════════════════════════════════════════
// 行为层 2：R8 — assembling 迁移 + 任务牵引
// ════════════════════════════════════════════════════════════════════
const R8B_START = "if (fleet.state === 'assembling') {";
const R8B_END = '// 确定当前优先级状态';
const R8A_START = "} else if (fleet.state === 'assembling' && fleet._missionDest) {";
const R8A_END = '// === 恐慌响应';

function compileAssembleTick(mutate) {
  return compileBlock(R8B_START, R8B_END, null, ['fleet', 'Phaser', 'now', 'ASSEMBLE_MAX_MS'], mutate);
}

function compileAssemblePull(mutate) {
  // 该块写局部变量 fleetTargetX/Y ⇒ 前置声明 + 返回，使其可观测。
  let src = extractUnique(R8A_START, R8A_END);
  src = src.split(R8A_START).join("if (fleet.state === 'assembling' && fleet._missionDest) {");
  src = src.split('this.time.now').join('now');
  if (mutate) src = mutate(src);
  const wrapped = `(function(fleet, Phaser) {\nlet fleetTargetX = fleet.x; let fleetTargetY = fleet.y;\n${src}\nreturn { fleetTargetX, fleetTargetY };\n})`;
  const js = stripTypeScriptTypes(wrapped);
  return new Function(`return ${js};`)();
}

/** 组装态 tick 的返回 state。 */
function runAssembleTick(tick, fleet, now, maxMs) {
  tick(fleet, Phaser, now, maxMs);
  return fleet.state;
}

console.log('\n=== R8-b assembling 结束条件（真跑）===');
{
  const tick = compileAssembleTick();
  check('assembling 且无任务：开局未超时 ⇒ 仍为 assembling', () => {
    const f = { id: 1, x: 100, y: 100, state: 'assembling', _missionDest: null };
    return runAssembleTick(tick, f, 0, 4000) === 'assembling';
  });
  check('assembling 超过 ASSEMBLE_MAX_MS ⇒ 转 exploring（即使无任务）', () => {
    const f = { id: 1, x: 100, y: 100, state: 'assembling', _missionDest: null };
    runAssembleTick(tick, f, 0, 4000);
    return runAssembleTick(tick, f, 4500, 4000) === 'exploring';
  });
  check('assembling 已抵达任务目的地（<120px）⇒ 立即转 exploring', () => {
    const f = { id: 1, x: 100, y: 100, state: 'assembling', _missionDest: { x: 180, y: 100 } };
    return runAssembleTick(tick, f, 0, 4000) === 'exploring';
  });
}

console.log('\n=== R8-a assembling 消费 _missionDest（真跑）===');
{
  const pull = compileAssemblePull();
  check('assembling + 远处任务点 ⇒ fleetTarget 被牵引到任务点', () => {
    const f = { id: 1, x: 100, y: 100, state: 'assembling', stance: 'search', _missionDest: { x: 5000, y: 300 } };
    const r = pull(f, Phaser);
    return r.fleetTargetX === 5000 && r.fleetTargetY === 300;
  });
  check('assembling + 任务点在近距(≤60px) ⇒ 目标保持自身（不抖动）', () => {
    const f = { id: 1, x: 100, y: 100, state: 'assembling', stance: 'search', _missionDest: { x: 130, y: 100 } };
    const r = pull(f, Phaser);
    return r.fleetTargetX === 100 && r.fleetTargetY === 100;
  });
  check('非 assembling 状态 ⇒ 本分支不介入（目标保持自身）', () => {
    const f = { id: 1, x: 100, y: 100, state: 'exploring', stance: 'search', _missionDest: { x: 5000, y: 300 } };
    const r = pull(f, Phaser);
    return r.fleetTargetX === 100 && r.fleetTargetY === 100;
  });
}

console.log('\n=== 变异自检 4：R8-a 牵引禁用 ⇒ 必须 FAIL ===');
{
  const pullMut = compileAssemblePull((s) => s.split('if (_asmdD > 60)').join('if (false)'));
  const f = { id: 1, x: 100, y: 100, state: 'assembling', stance: 'search', _missionDest: { x: 5000, y: 300 } };
  const r = pullMut(f, Phaser);
  check('变异已生效：牵引被禁用 ⇒ 目标不再指向任务点（断言可检出）', () => r.fleetTargetX === 100);
}

console.log('\n=== 变异自检 5：R8-b 超时禁用 ⇒ 必须 FAIL ===');
{
  const tick = compileAssembleTick();
  const f = { id: 1, x: 100, y: 100, state: 'assembling', _missionDest: null };
  const at = (now, max) => runAssembleTick(tick, f, now, max);
  check('变异已生效：ASSEMBLE_MAX_MS 巨大 ⇒ 永不转 exploring（断言可检出）', () => {
    at(0, Number.MAX_SAFE_INTEGER);
    return at(9_000_000, Number.MAX_SAFE_INTEGER) === 'assembling';
  });
}

// ════════════════════════════════════════════════════════════════════
// 源码契约层（保留；防"整段删除"）
// ════════════════════════════════════════════════════════════════════
console.log('\n=== W3.5 buildMission(hold_point) 透传（纯函数）===');
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
  return block.includes("stallOut.directive !== 'none' && !w1DOrder")
    && !block.includes("myFac.type !== 'player'");
});
check('看门狗对玩家舰队不施加 withdrawal（不覆写玩家手动姿态）', () =>
  scene.includes("w1PlayerFleet && stallOut.directive === 'withdrawal'"));

console.log('\n=== W3.2 hold_point 到位超时（源码契约）===');
check('HOLD_POINT_MAX_MS 常量已定义', () => /const HOLD_POINT_MAX_MS = \d+;/.test(scene));
check('executeMissionTick 的 hold_point 分支使用到位超时并 clearMission', () => {
  const block = slice(HOLD_START, HOLD_END);
  return block.includes('HOLD_POINT_MAX_MS') && block.includes('clearMission()') && block.includes('_holdArrivedAt');
});
check('超时分支受 manual 守卫 + L1 姿态锁保护', () => {
  const block = slice(HOLD_START, HOLD_END);
  return block.includes('!m.manual &&') && /isStanceLocked\(fleet\)\)\s*fleet\.stance = 'search'/.test(block);
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

console.log('\n=== R4 玩家任务通道标记 manual ===');
check('mission 分支把玩家下达的任务标记 manual:true', () => {
  const block = slice("if (type === 'mission') {", 'return;');
  return block.includes('manual: true');
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
  const block = slice(HOLD_START, HOLD_END);
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
check('暴露 window.__fleetSnap 只读调试口', () => scene.includes('__fleetSnap'));

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
