/** W1 direct-order wiring contract for BattleScene
 *  (design §Direct attack / §Failure handling / §Retreat, rout, and deadlock / §Deadlock watchdog).
 *  行为断言打 CommandAuthority 纯函数；source 契约断言打 BattleScene.ts 接线（右键分支、
 *  resolveAuthority/tickStallWatchdog 调用、信标真源停用）。
 */
const fs = require('fs');
const A = require('../frontend/src/game/battle/CommandAuthority.ts');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

const trackOf = (over = {}) => ({
  targetFleetId: 7,
  lastKnown: { x: 100, y: 50, t: 1000 },
  liveVisible: true,
  reliable: true,
  destroyed: false,
  ...over,
});

console.log('\n=== validateDirectOrder (invalid target is rejected WITHOUT replacing) ===');
{
  const atk = { kind: 'attack', targetFleetId: 7, issuedAt: 0 };
  check('move order is always valid',
    A.validateDirectOrder({ kind: 'move', x: 1, y: 2, issuedAt: 0 }, null) !== null);
  check('hold order is always valid',
    A.validateDirectOrder({ kind: 'hold', issuedAt: 0 }, null) !== null);
  check('attack with a valid track is accepted',
    A.validateDirectOrder(atk, trackOf()) === atk);
  check('attack with no track is rejected (null)',
    A.validateDirectOrder(atk, null) === null);
  check('attack against a destroyed track is rejected (null)',
    A.validateDirectOrder(atk, trackOf({ destroyed: true })) === null);
  check('attack with a mismatched track identity is rejected (null)',
    A.validateDirectOrder(atk, trackOf({ targetFleetId: 9 })) === null);
}

console.log('\n=== tickDirectAttack lifecycle (pursuit -> completed -> hold) ===');
{
  const order = { kind: 'attack', targetFleetId: 7, issuedAt: 0 };
  // 可见 ⇒ 追实时位
  const live = A.tickDirectAttack(null, order, trackOf(), 2000);
  check('live-visible target pursues the real-time position (fromIntel=false)',
    !live.completed && !!live.pursuit && live.pursuit.fromIntel === false
    && live.pursuit.x === 100 && live.pursuit.y === 50);
  // 不可见 ⇒ 追末次位置（fromIntel 标签「末次位置」）
  const intel = A.tickDirectAttack(null, order, trackOf({ liveVisible: false }), 2000);
  check('invisible target pursues the last-known position (fromIntel=true)',
    !intel.completed && !!intel.pursuit && intel.pursuit.fromIntel === true);
  // 档案销毁 ⇒ 目标已灭
  const dead = A.tickDirectAttack(null, order, trackOf({ destroyed: true, liveVisible: false }), 2000);
  check('destroyed track completes as target_destroyed and drops pursuit',
    dead.completed && dead.endReason === 'target_destroyed' && dead.pursuit === null);
  // 无档案 ⇒ 目标失联
  const lost = A.tickDirectAttack(null, order, null, 2000);
  check('no track completes as track_lost',
    lost.completed && lost.endReason === 'track_lost');
  // 可靠追踪显式中断 ⇒ 目标失联（电子战口径，_trackReliable=false 的唯一来源）
  const jammed = A.tickDirectAttack(null, order, trackOf({ reliable: false }), 2000);
  check('unreliable track completes as track_lost (explicit countermeasures only)',
    jammed.completed && jammed.endReason === 'track_lost');
  // 跨帧状态延续（同目标 ⇒ 续 state；换目标 ⇒ 重建）
  const next = A.tickDirectAttack(live, order, trackOf({ lastKnown: { x: 110, y: 60, t: 3000 } }), 3000);
  check('same-target tick keeps the attack state and refreshes pursuit',
    next.order.targetFleetId === 7 && next.pursuit.x === 110);
  // 完成后 resolveAuthority 归 hold（§Failure handling：目标已灭/失联 → hold）
  const afterLost = A.resolveAuthority({
    destroyed: false, retreatState: 'none', direct: order, attack: lost,
    planRole: null, mission: null, localCombat: null,
    playerControlled: true, directJustIssued: false,
  });
  check('completed direct attack resolves to hold（奉令：目标失联）',
    afterLost.movement.type === 'hold' && afterLost.label.includes('目标失联'));
  // 新指令替换收尾
  const replaced = A.cancelDirectAttack(live);
  check('cancelDirectAttack marks the in-flight attack as replaced',
    replaced.completed && replaced.endReason === 'replaced' && replaced.pursuit === null);
  check('cancelDirectAttack keeps an already-completed state untouched',
    A.cancelDirectAttack(lost) === lost);
}

console.log('\n=== resolveAuthority direct-order movement (wired inputs) ===');
{
  const base = {
    destroyed: false, retreatState: 'none', attack: null,
    planRole: null, mission: null, localCombat: null,
    playerControlled: true, directJustIssued: true,
  };
  const mv = A.resolveAuthority({ ...base, direct: { kind: 'move', x: 300, y: -120, issuedAt: 0 } });
  check('direct move drives movement to the exact world destination',
    mv.layer === 'direct_order' && mv.movement.type === 'move'
    && mv.movement.x === 300 && mv.movement.y === -120);
  const hold = A.resolveAuthority({ ...base, direct: { kind: 'hold', issuedAt: 0 } });
  check('direct hold stops the fleet and keeps free fire',
    hold.movement.type === 'hold' && hold.fire === 'free');
  // attack 追击点驱动运动（fromIntel ⇒ 意图标签「末次位置」）
  const atkState = A.tickDirectAttack(null, { kind: 'attack', targetFleetId: 7, issuedAt: 0 }, trackOf({ liveVisible: false }), 0);
  const ap = A.resolveAuthority({
    ...base,
    direct: { kind: 'attack', targetFleetId: 7, issuedAt: 0 },
    attack: atkState,
  });
  check('direct attack motion is the pursuit point with fire limited to the target',
    ap.movement.type === 'move' && ap.movement.fromIntel === true
    && ap.movement.label.includes('末次位置') && ap.fire === 'attack_target_only');
  // 仅 true rout 可拒 direct（其余必接 + ack）
  const accepted = A.resolveAuthority({
    ...base, retreatState: 'withdrawing', direct: { kind: 'move', x: 0, y: 0, issuedAt: 0 },
  });
  check('withdrawing fleet still accepts a direct order and clears motion state',
    accepted.layer === 'direct_order' && accepted.acknowledged && accepted.clearMotionState);
  // 玩家无指令 ⇒ 保持部署（不搜索/转向/分兵由 BattleScene 分支保证，见下方 source 契约）
  const idle = A.resolveAuthority({
    destroyed: false, retreatState: 'none', direct: null, attack: null,
    planRole: null, mission: null, localCombat: null,
    playerControlled: true, directJustIssued: false,
  });
  check('orderless player fleet resolves to autonomous hold（保持部署）',
    idle.layer === 'autonomous_posture' && idle.movement.type === 'hold' && idle.label === '保持部署');
}

console.log('\n=== stall watchdog (bounded 12s, three-way choice, no fake damage/teleport) ===');
{
  const stalledInput = {
    displacement: 0, rangeClosure: 0, objectiveProgress: 0,
    weaponsFired: false, hostilesRemain: true, stalledSec: 12,
    canAdvance: true, objectiveAvailable: false, badlyHurt: false,
  };
  check('12s stall with hostiles forces a directive (advance when pushable)',
    A.tickStallWatchdog(stalledInput).directive === 'advance');
  check('progress (weapons fired) resets the stall timer',
    A.tickStallWatchdog({ ...stalledInput, weaponsFired: true }).stalledSec === 0
    && A.tickStallWatchdog({ ...stalledInput, weaponsFired: true }).directive === 'none');
  check('meaningful displacement resets the stall timer',
    A.tickStallWatchdog({ ...stalledInput, displacement: 40 }).directive === 'none');
  check('range closure resets the stall timer',
    A.tickStallWatchdog({ ...stalledInput, rangeClosure: 25 }).directive === 'none');
  check('no hostiles means no forced action',
    A.tickStallWatchdog({ ...stalledInput, hostilesRemain: false }).directive === 'none');
  check('under the trigger window the watchdog only counts time',
    A.tickStallWatchdog({ ...stalledInput, stalledSec: 6 }).directive === 'none');
  check('chooseStallAction: badly hurt => withdrawal',
    A.chooseStallAction(true, true, true) === 'withdrawal');
  check('chooseStallAction: objective available => objective_pressure',
    A.chooseStallAction(true, true, false) === 'objective_pressure');
  check('chooseStallAction: pushable => advance',
    A.chooseStallAction(true, false, false) === 'advance');
  check('chooseStallAction: nothing left => withdrawal',
    A.chooseStallAction(false, false, false) === 'withdrawal');
}

console.log('\n=== retreat runtime wiring semantics (transitionRetreatState) ===');
{
  const init = A.RETREAT_STATE_INIT;
  check('direct order acceptance clears withdrawing (rout is never cleared)',
    A.transitionRetreatState({
      prev: { state: 'withdrawing', elapsedSec: 3, regroupElapsedSec: 0 },
      tier: 'withdraw', dtSec: 0.1, nearSupplyOrAlly: false, recovered: false,
      directOrderAccepted: true,
    }).state === 'none'
    && A.transitionRetreatState({
      prev: { state: 'routed', elapsedSec: 3, regroupElapsedSec: 0 },
      tier: 'rout', dtSec: 0.1, nearSupplyOrAlly: true, recovered: true,
      directOrderAccepted: true,
    }).state !== 'none');
  check('morale recovery at ROUT_RECOVER_MORALE brings routed back to withdrawing',
    A.transitionRetreatState({
      prev: { state: 'routed', elapsedSec: 5, regroupElapsedSec: 0 },
      tier: 'rout', dtSec: 0.1, nearSupplyOrAlly: false,
      recovered: true, directOrderAccepted: false,
    }).state === 'withdrawing');
  check('withdrawing near supply/ally enters regrouping',
    A.transitionRetreatState({
      prev: { state: 'withdrawing', elapsedSec: 1, regroupElapsedSec: 0 },
      tier: 'withdraw', dtSec: 0.1, nearSupplyOrAlly: true,
      recovered: false, directOrderAccepted: false,
    }).state === 'regrouping');
  check('init state with no tier stays none',
    A.transitionRetreatState({
      prev: init, tier: 'none', dtSec: 0.1, nearSupplyOrAlly: false,
      recovered: false, directOrderAccepted: false,
    }).state === 'none');
}

console.log('\n=== BattleScene wiring contract (source) ===');
{
  const sceneSource = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
  // 右键分支：从 pointer.button === 2 起取一块作为分支区域
  const rmbIdx = sceneSource.indexOf('pointer.button === 2');
  check('handleTileClick has a right-click branch', rmbIdx >= 0);
  const branch = rmbIdx >= 0 ? sceneSource.slice(rmbIdx, rmbIdx + 1600) : '';
  check('right-click branch routes enemy tiles to direct attack (attack + targetFleetId contract)',
    /orderFleetAttack\(/.test(branch)
    && /kind:\s*'attack'/.test(sceneSource) && /targetFleetId/.test(sceneSource));
  check('right-click branch routes empty tiles to direct move',
    /orderFleetMove\(/.test(branch));
  check('right-click branch no longer fires the beacon flare (orderFleetBeacon/deployFlare)',
    !/orderFleetBeacon\(/.test(branch) && !/deployFlare\(/.test(branch));
  check('invalid direct target is rejected without replacing the standing order',
    /目标无效/.test(sceneSource) && /validateDirectOrder\(/.test(sceneSource));
  check('resolveAuthority is imported and called every frame per fleet',
    /import\s*\{[^}]*resolveAuthority[\s\S]*?\}\s*from\s*'..\/battle\/CommandAuthority'/.test(sceneSource)
    && /resolveAuthority\(\{/.test(sceneSource));
  check('tickDirectAttack drives the direct-attack lifecycle each frame',
    /tickDirectAttack\(/.test(sceneSource));
  check('tickStallWatchdog is called from the per-fleet update',
    /tickStallWatchdog\(\{/.test(sceneSource));
  check('transitionRetreatState is called at the retreat-tier consumption point',
    /transitionRetreatState\(\{/.test(sceneSource));
  check('commitDirectOrder clears stale motion state (cruise phase reset + flare drop)',
    /_combatControl\s*=\s*\{\s*phase:\s*'cruise'/.test(sceneSource) && /targetFlare = null/.test(sceneSource));
  check('orderless player fleet is held in place (保持部署, no search/turn/split)',
    /保持部署/.test(sceneSource) && /autonomous_posture/.test(sceneSource));
  check('fire gate consumes the authority fire mode (authGateOk override)',
    /authGateOk/.test(sceneSource) && /attack_target_only/.test(sceneSource));
  check('weapons-fired events feed the stall watchdog observation',
    /weaponsFired = true/.test(sceneSource));
}

process.stdout.write(`\ndirectOrderSim: ${passed} passed, ${failed} failed\n`);
process.exitCode = failed > 0 ? 1 : 0;
