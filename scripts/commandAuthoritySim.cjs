/** Deterministic contract for the battle command authority model (design §Authority/§Retreat/§Failure). */
const A = require('../frontend/src/game/battle/CommandAuthority.ts');
// 注：retreatDoctrine.ts 含无扩展名 import（../config/tagConfig），Node ESM 解析不加载 ⇒
// tier→state 联动在此用 tier 字符串输入做行为断言；tier 判定本身归 retreatDoctrine 台架（待办）。

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

const baseInput = {
  destroyed: false,
  retreatState: 'none',
  direct: null,
  attack: null,
  planRole: null,
  mission: null,
  localCombat: null,
  playerControlled: false,
  directJustIssued: false,
};

console.log('\n=== Authority priority (6 layers) ===');
{
  // 1 > 2: true rout rejects a direct order
  const routWithDirect = A.resolveAuthority({
    ...baseInput, retreatState: 'routed',
    direct: { kind: 'move', x: 1, y: 1, issuedAt: 0 }, directJustIssued: true,
  });
  check('true rout overrides and rejects a direct order',
    routWithDirect.layer === 'destroyed_or_rout' && routWithDirect.rejectReason === 'rout' && !routWithDirect.acknowledged);

  // destroyed beats everything
  const dead = A.resolveAuthority({ ...baseInput, destroyed: true, direct: { kind: 'hold', issuedAt: 0 } });
  check('destroyed fleet resolves at the top layer with no fire',
    dead.layer === 'destroyed_or_rout' && dead.fire === 'none' && dead.rejectReason === 'destroyed');

  // 2 > 3 > 4 > 5 > 6
  const allLower = {
    ...baseInput,
    planRole: { planId: 'p1', role: '右翼迂回' },
    mission: 'engage_force',
    localCombat: { intent: '压制敌前卫' },
    playerControlled: true,
  };
  check('direct order outranks plan role, mission, local combat and posture',
    A.resolveAuthority({ ...allLower, direct: { kind: 'hold', issuedAt: 0 } }).layer === 'direct_order');
  check('committed plan role outranks mission, local combat and posture',
    A.resolveAuthority(allLower).layer === 'tactical_plan_role');
  check('strategic mission outranks local combat and posture',
    A.resolveAuthority({ ...allLower, planRole: null }).layer === 'strategic_mission');
  check('local combat response outranks autonomous posture',
    A.resolveAuthority({ ...allLower, planRole: null, mission: null }).layer === 'local_combat_response');
  check('autonomous posture is the fallback layer',
    A.resolveAuthority({ ...allLower, planRole: null, mission: null, localCombat: null }).layer === 'autonomous_posture');
}

console.log('\n=== Direct move ===');
{
  const mv = A.resolveAuthority({
    ...baseInput, direct: { kind: 'move', x: 120, y: -40, issuedAt: 0 },
    localCombat: { intent: '还击' }, directJustIssued: true,
  });
  check('direct move stores an exact world destination',
    mv.movement.type === 'move' && mv.movement.x === 120 && mv.movement.y === -40);
  check('local fire may engage while moving without converting move into a pursuit',
    mv.fire === 'free' && mv.movement.label.includes('机动'));
  check('accepting a direct order clears stale motion state and acknowledges once authoritative',
    mv.clearMotionState === true && mv.acknowledged === true);

  const mvLater = A.resolveAuthority({
    ...baseInput, direct: { kind: 'move', x: 120, y: -40, issuedAt: 0 },
  });
  check('acknowledgement is not repeated on later frames',
    mvLater.acknowledged === false && mvLater.clearMotionState === false);
}

console.log('\n=== Direct attack lifecycle ===');
{
  const order = { kind: 'attack', targetFleetId: 7, issuedAt: 0 };
  // stores fleet identity, not a tile
  check('direct attack stores target fleet identity rather than a tile',
    order.targetFleetId === 7 && !('x' in order) && !('tile' in order));

  // pursuit on live-visible target
  let st = A.tickDirectAttack(null, order, {
    targetFleetId: 7, lastKnown: { x: 300, y: 100, t: 0 }, liveVisible: true, reliable: true, destroyed: false,
  }, 0);
  check('pursuit resolves the live track when visible',
    st.pursuit && st.pursuit.x === 300 && st.pursuit.fromIntel === false && !st.completed);

  // target leaves live vision but track remains reliable -> last-known pursuit
  st = A.tickDirectAttack(st, order, {
    targetFleetId: 7, lastKnown: { x: 355, y: 120, t: 1 }, liveVisible: false, reliable: true, destroyed: false,
  }, 1);
  check('pursuit falls back to the last-known intelligence track and labels it',
    st.pursuit && st.pursuit.x === 355 && st.pursuit.fromIntel === true);

  // tracking explicitly broken -> completes as 目标失联 and holds
  st = A.tickDirectAttack(st, order, {
    targetFleetId: 7, lastKnown: { x: 355, y: 120, t: 2 }, liveVisible: false, reliable: false, destroyed: false,
  }, 2);
  check('explicitly broken tracking completes the attack as target lost',
    st.completed === true && st.endReason === 'track_lost');

  const held = A.resolveAuthority({ ...baseInput, direct: order, attack: st });
  check('attack completion changes the fleet to hold with the 目标失联 label',
    held.movement.type === 'hold' && held.label.includes('目标失联'));

  // destroyed target -> completion reason target_destroyed -> hold
  let st2 = A.tickDirectAttack(null, order, {
    targetFleetId: 7, lastKnown: { x: 1, y: 1, t: 0 }, liveVisible: true, reliable: true, destroyed: true,
  }, 0);
  check('destroyed target completes the pursuit',
    st2.completed === true && st2.endReason === 'target_destroyed');
  const held2 = A.resolveAuthority({ ...baseInput, direct: order, attack: st2 });
  check('pursuit completion changes the fleet to hold',
    held2.movement.type === 'hold' && held2.label.includes('目标已灭'));

  // new order replaces the attack
  let st3 = A.tickDirectAttack(null, order, {
    targetFleetId: 7, lastKnown: { x: 1, y: 1, t: 0 }, liveVisible: true, reliable: true, destroyed: false,
  }, 0);
  st3 = A.cancelDirectAttack(st3);
  check('a new order replaces and ends the attack',
    st3.completed === true && st3.endReason === 'replaced');

  // movement target ownership: attack pursuit must not be silently overridden by local combat
  const atk = A.resolveAuthority({
    ...baseInput, direct: order, directJustIssued: true,
    attack: A.tickDirectAttack(null, order, {
      targetFleetId: 7, lastKnown: { x: 500, y: 500, t: 0 }, liveVisible: true, reliable: true, destroyed: false,
    }, 0),
    localCombat: { intent: '被他舰攻击' },
  });
  check('an explicit attack order owns the movement target while local combat is active',
    atk.movement.type === 'move' && atk.movement.x === 500 && atk.fire === 'attack_target_only');
}

console.log('\n=== Failure handling ===');
{
  const bad = A.validateDirectOrder(
    { kind: 'attack', targetFleetId: 9, issuedAt: 0 },
    { targetFleetId: 9, lastKnown: { x: 0, y: 0, t: 0 }, liveVisible: false, reliable: true, destroyed: true },
  );
  check('attack on an already destroyed target is rejected',
    bad === null);
  const missing = A.validateDirectOrder({ kind: 'attack', targetFleetId: 9, issuedAt: 0 }, null);
  check('attack on an invalid target is rejected without replacing the current order',
    missing === null);
  const mismatch = A.validateDirectOrder(
    { kind: 'attack', targetFleetId: 9, issuedAt: 0 },
    { targetFleetId: 8, lastKnown: { x: 0, y: 0, t: 0 }, liveVisible: true, reliable: true, destroyed: false },
  );
  check('attack order against a mismatched track is rejected', mismatch === null);
  const okMove = A.validateDirectOrder({ kind: 'move', x: 1, y: 2, issuedAt: 0 }, null);
  check('move orders pass validation untouched', okMove !== null && okMove.kind === 'move');
}

console.log('\n=== Retreat, rout and regroup runtime states ===');
{
  // direct order clears withdrawing / regrouping but not routed
  const cleared = A.transitionRetreatState({
    prev: { state: 'withdrawing', elapsedSec: 3, regroupElapsedSec: 0 },
    tier: 'withdraw', dtSec: 0.5, nearSupplyOrAlly: false, recovered: false, directOrderAccepted: true,
  });
  check('a direct order clears a cancellable withdrawing state', cleared.state === 'none');

  const clearedRegroup = A.transitionRetreatState({
    prev: { state: 'regrouping', elapsedSec: 6, regroupElapsedSec: 2 },
    tier: 'withdraw', dtSec: 0.5, nearSupplyOrAlly: true, recovered: false, directOrderAccepted: true,
  });
  check('a direct order clears a regrouping state', clearedRegroup.state === 'none');

  const routHolds = A.transitionRetreatState({
    prev: { state: 'routed', elapsedSec: 1, regroupElapsedSec: 0 },
    tier: 'rout', dtSec: 0.5, nearSupplyOrAlly: false, recovered: false, directOrderAccepted: true,
  });
  check('a direct order cannot clear a true rout', routHolds.state === 'routed');

  // hull percentage alone must not create a permanent non-commandable state
  const withdrawCmd = A.resolveAuthority({
    ...baseInput, retreatState: 'withdrawing',
    direct: { kind: 'move', x: 0, y: 0, issuedAt: 0 }, directJustIssued: true,
  });
  check('a withdrawing fleet remains commandable (accepts direct orders)',
    withdrawCmd.layer === 'direct_order' && withdrawCmd.rejectReason === null);

  // regrouping ends by recovery, timeout, or direct order
  const rec = A.transitionRetreatState({
    prev: { state: 'regrouping', elapsedSec: 2, regroupElapsedSec: 5 },
    tier: 'none', dtSec: 1, nearSupplyOrAlly: true, recovered: true, directOrderAccepted: false,
  });
  check('regrouping ends by recovery', rec.state === 'none');
  const to = A.transitionRetreatState({
    prev: { state: 'regrouping', elapsedSec: 2, regroupElapsedSec: A.REGROUP_TIMEOUT_SEC - 0.1 },
    tier: 'none', dtSec: 0.5, nearSupplyOrAlly: true, recovered: false, directOrderAccepted: false,
  });
  check('regrouping ends by timeout (no permanent hang)', to.state === 'none');

  // withdrawing -> regrouping on reaching supply/allies
  const toRegroup = A.transitionRetreatState({
    prev: { state: 'withdrawing', elapsedSec: 2, regroupElapsedSec: 0 },
    tier: 'withdraw', dtSec: 0.5, nearSupplyOrAlly: true, recovered: false, directOrderAccepted: false,
  });
  check('withdrawing regroups near supply or allies', toRegroup.state === 'regrouping');

  // withdrawing -> regrouping by timeout (no infinite stationary retreat)
  const toRegroupTo = A.transitionRetreatState({
    prev: { state: 'withdrawing', elapsedSec: A.WITHDRAW_REGROUP_TIMEOUT_SEC - 0.1, regroupElapsedSec: 0 },
    tier: 'disengage', dtSec: 0.5, nearSupplyOrAlly: false, recovered: false, directOrderAccepted: false,
  });
  check('withdrawing cannot loop forever without regrouping', toRegroupTo.state === 'regrouping');

  // withdrawing ends when the shakiness condition disappears
  const selfRec = A.transitionRetreatState({
    prev: { state: 'withdrawing', elapsedSec: 2, regroupElapsedSec: 0 },
    tier: 'none', dtSec: 0.5, nearSupplyOrAlly: false, recovered: true, directOrderAccepted: false,
  });
  check('withdrawing ends when the retreat condition clears', selfRec.state === 'none');

  // routed recovers only on morale recovery (hysteresis), not on tier flicker
  const stillRout = A.transitionRetreatState({
    prev: { state: 'routed', elapsedSec: 4, regroupElapsedSec: 0 },
    tier: 'disengage', dtSec: 0.5, nearSupplyOrAlly: false, recovered: false, directOrderAccepted: false,
  });
  check('routed persists past tier flicker until morale actually recovers', stillRout.state === 'routed');
  const routRec = A.transitionRetreatState({
    prev: { state: 'routed', elapsedSec: 4, regroupElapsedSec: 0 },
    tier: 'disengage', dtSec: 0.5, nearSupplyOrAlly: false, recovered: true, directOrderAccepted: false,
  });
  check('routed returns to command after morale recovery', routRec.state === 'withdrawing');

  // integration with the retreatDoctrine single source of truth (tier strings in, state out)
  const tierRout = A.transitionRetreatState({
    prev: { state: 'none', elapsedSec: 0, regroupElapsedSec: 0 },
    tier: 'rout', dtSec: 0.5, nearSupplyOrAlly: false, recovered: false, directOrderAccepted: false,
  });
  check('retreat tier rout maps to the routed runtime state trigger', tierRout.state === 'routed');
  const tierWithdraw = A.transitionRetreatState({
    prev: { state: 'none', elapsedSec: 0, regroupElapsedSec: 0 },
    tier: 'withdraw', dtSec: 0.5, nearSupplyOrAlly: false, recovered: false, directOrderAccepted: true,
  });
  check('low-hull withdraw state enters commandably and clears on a direct order',
    tierWithdraw.state === 'none');
}

console.log('\n=== Battle-stall watchdog ===');
{
  const quiet = {
    displacement: 0, rangeClosure: 0, objectiveProgress: 0, weaponsFired: false,
    hostilesRemain: true, stalledSec: 0, canAdvance: true, objectiveAvailable: false, badlyHurt: false,
  };
  let acc = 0;
  let fire = null;
  for (let i = 0; i < 40; i++) {
    fire = A.tickStallWatchdog({ ...quiet, stalledSec: acc });
    acc = fire.stalledSec + 0.5;
    if (fire.directive !== 'none') break;
  }
  check('a stalled battle forces an AI action once the bound expires',
    fire.directive !== 'none' && ['advance', 'objective_pressure', 'withdrawal'].includes(fire.directive),
    `directive=${fire.directive}`);
  check('the watchdog never fabricates damage or teleports (intent output only)',
    typeof fire.directive === 'string' && !('damage' in fire) && !('position' in fire));

  const moving = A.tickStallWatchdog({ ...quiet, displacement: 80, stalledSec: A.STALL_TRIGGER_SEC + 1 });
  check('meaningful displacement resets the watchdog', moving.directive === 'none' && moving.stalledSec === 0);

  const closing = A.tickStallWatchdog({ ...quiet, rangeClosure: 60, stalledSec: A.STALL_TRIGGER_SEC + 1 });
  check('range closure counts as progress', closing.directive === 'none' && closing.stalledSec === 0);

  const obj = A.tickStallWatchdog({ ...quiet, objectiveProgress: 0.2, stalledSec: A.STALL_TRIGGER_SEC + 1 });
  check('objective progress counts as progress', obj.directive === 'none');

  const shot = A.tickStallWatchdog({ ...quiet, weaponsFired: true, stalledSec: A.STALL_TRIGGER_SEC + 1 });
  check('weapons fire counts as progress', shot.directive === 'none');

  const won = A.tickStallWatchdog({ ...quiet, hostilesRemain: false, stalledSec: A.STALL_TRIGGER_SEC + 5 });
  check('the watchdog never fires after hostiles are gone', won.directive === 'none');

  check('stall action policy prefers withdrawal when badly hurt',
    A.chooseStallAction(true, true, true) === 'withdrawal');
  check('stall action policy prefers objective pressure when available',
    A.chooseStallAction(true, true, false) === 'objective_pressure');
  check('stall action policy advances when possible and falls back to withdrawal',
    A.chooseStallAction(true, false, false) === 'advance' && A.chooseStallAction(false, false, false) === 'withdrawal');
}

console.log('\n=== Opening hold for player-controlled fleets ===');
{
  const hold = A.resolveAuthority({ ...baseInput, playerControlled: true });
  check('a player fleet with no order holds its opening deployment',
    hold.layer === 'autonomous_posture' && hold.movement.type === 'hold' && hold.label === '保持部署');
  const aiPosture = A.resolveAuthority({ ...baseInput, playerControlled: false });
  check('AI fleets without orders keep an explicit autonomous posture',
    aiPosture.layer === 'autonomous_posture' && aiPosture.movement.type === 'hold');
}

console.log('\n=== Mission and intent terminology ===');
{
  const labels = ['engage_force', 'seize_objective', 'hold_sector', 'support_ally', 'withdraw_supply']
    .map(A.missionLabel);
  check('mission labels use the five operational terms',
    labels.join(',') === '进击敌舰队,夺取战略据点,固守战区,协同友军,撤回整补', labels.join(','));
  const intent = A.runtimeIntentLabel('奉令', '右翼迂回');
  check('runtime intent is prefixed and separate from mission names',
    intent === '奉令：右翼迂回');
  check('attack end labels expose what happened without leaking hidden enemy data',
    A.ATTACK_END_LABELS.track_lost === '目标失联' && A.ATTACK_END_LABELS.target_destroyed === '目标已灭');
  const missDecision = A.resolveAuthority({ ...baseInput, mission: 'seize_objective' });
  check('mission layer labels use the operational language',
    missDecision.label === '夺取战略据点');
}

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
