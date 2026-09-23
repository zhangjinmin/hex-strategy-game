/**
 * CommandAuthority — 战斗指令权威模型（纯计算 · 单一真源）
 *
 * 依据：`2026-09-23-battle-command-and-ai-flow-rebuild-design.md`
 * §Authority and state model / §Retreat, rout, and deadlock / §Failure handling
 *
 * 解决的问题（方案 Purpose）：现行战斗流是 patch-on-patch——
 *   · `CommandSystem.resolveFleetOrder` 只有 3 级 issuer（player>system>ai），
 *     不表达「rout 压过 direct」「plan role 与 mission 谁大」；
 *   · direct attack 只存格子不存目标舰队身份 ⇒ 追击无生命周期；
 *   · 撤退只有瞬时档位（retreatDoctrine.RetreatTier）没有运行时状态
 *     （withdrawing/regrouping/routed 的进出条件、超时、恢复）；
 *   · 战斗停滞无看门狗 ⇒ 低兵力双方可无限静止对峙。
 *
 * 本模块职责（纯计算、无状态入参、不碰渲染/寻路/数值）：
 *   A. 6 级指令权威解析（含「仅 rout 可拒绝直接指令」）；
 *   B. direct move / direct attack 生命周期（目标=舰队身份 + 可靠追踪档案）；
 *   C. 撤退运行时三态状态机（收口 retreatDoctrine 档位 → 三态）；
 *   D. 战斗停滞看门狗（强制 AI 三选一；绝不伪造伤害/瞬移）；
 *   E. 任务语言与运行时意图标签（术语真源，UI 只许消费）。
 *
 * 分工约定：
 *   · 瞬时撤退判定（士气/兵力/动摇线 → Tier）仍在 `retreatDoctrine.ts`（单一真源）；
 *   · 本模块只做 Tier → 运行时 State 的迁移（timer/恢复/被令清除）；
 *   · 战术分兵规划仍在 `taskForce.ts`；本模块只表达「plan role」这一权威层级。
 */

// ============================================================
// A. 指令权威（6 级优先）
// ============================================================

/** 权威层级（数字越小优先级越高） */
export type AuthorityLayer =
  | 'destroyed_or_rout'      // 1. 毁灭或真正溃散
  | 'direct_order'           // 2. 玩家直接指令
  | 'tactical_plan_role'     // 3. 已承诺的战术计划角色
  | 'strategic_mission'      // 4. 战略任务
  | 'local_combat_response'  // 5. 局部战斗响应（受击还击等）
  | 'autonomous_posture';    // 6. 自主姿态

export const AUTHORITY_PRIORITY: Record<AuthorityLayer, number> = {
  destroyed_or_rout: 1,
  direct_order: 2,
  tactical_plan_role: 3,
  strategic_mission: 4,
  local_combat_response: 5,
  autonomous_posture: 6,
};

// ------------------------------------------------------------
// B. 直接指令（direct order）
// ------------------------------------------------------------

export interface DirectMoveOrder {
  kind: 'move';
  /** 精确世界目的地（不是格子近似） */
  x: number;
  y: number;
  issuedAt: number;
}

export interface DirectAttackOrder {
  kind: 'attack';
  /** **目标舰队身份**（不是当前格子/坐标） */
  targetFleetId: number;
  issuedAt: number;
}

export interface DirectHoldOrder {
  kind: 'hold';
  issuedAt: number;
}

export type DirectOrder = DirectMoveOrder | DirectAttackOrder | DirectHoldOrder;

/** 目标可靠追踪档案（迷雾情报层写入；本模块只消费） */
export interface TargetTrack {
  targetFleetId: number;
  /** 末次确认位置与时间（= 情报接触点） */
  lastKnown: { x: number; y: number; t: number };
  /** 当前是否实时可见 */
  liveVisible: boolean;
  /** 可靠追踪是否仍成立（仅电子战/欺骗等显式反制可置 false） */
  reliable: boolean;
  /** 目标是否已毁灭 */
  destroyed: boolean;
}

export type AttackEndReason =
  | 'target_destroyed'   // 目标摧毁 → hold
  | 'track_lost'         // 目标失联 → hold（标签「目标失联」）
  | 'replaced'           // 新指令替换
  | 'invalid_target';    // 无效/已毁目标（拒绝且不替换原指令）

export interface DirectAttackState {
  order: DirectAttackOrder;
  /** 当前解析出的追踪档案（每帧刷新） */
  track: TargetTrack | null;
  /** 追击中运动目标 = 实时位置（可见）或末次位置（标签「末次位置」） */
  pursuit: { x: number; y: number; fromIntel: boolean } | null;
  completed: boolean;
  endReason: AttackEndReason | null;
}

/**
 * 指令校验（§Failure handling 第 1 条）：
 * 对无效/已毁灭目标的右键攻击**被拒绝且不替换当前指令**。
 * @returns 合法返回指令本身；非法返回 null（调用方保持原指令不变）。
 */
export function validateDirectOrder(
  order: DirectOrder,
  targetTrack: TargetTrack | null | undefined,
): DirectOrder | null {
  if (order.kind !== 'attack') return order; // move/hold 无目标合法性问题
  const t = targetTrack;
  if (!t || t.destroyed || t.targetFleetId !== order.targetFleetId) return null;
  return order;
}

/**
 * direct attack 生命周期解析（§Direct attack）：
 * 「持续解析目标的最新可靠追踪，向追踪点接敌，几何允许即开火。
 *   目标摧毁 / 可靠追踪显式中断 / 新指令替换 ⇒ 结束；完成 → hold。」
 *
 * @param state  上一帧攻击状态（null = 刚下达）
 * @param track  本帧追踪档案（null = 无任何情报档案）
 * @param nowMs  当前时刻
 */
export function tickDirectAttack(
  state: DirectAttackState | null,
  order: DirectAttackOrder,
  track: TargetTrack | null,
  nowMs: number,
): DirectAttackState {
  const s: DirectAttackState = state && !state.completed && state.order.targetFleetId === order.targetFleetId
    ? { ...state, track }
    : { order, track, pursuit: null, completed: false, endReason: null };
  if (s.completed) return s;

  if (!track || track.destroyed) {
    // 无档案 ⇒ 失联；有档案且已毁 ⇒ 摧毁
    s.completed = true;
    s.endReason = track ? 'target_destroyed' : 'track_lost';
    s.pursuit = null;
    return s;
  }
  if (!track.reliable) {
    // §Failure handling：可靠追踪显式中断 ⇒ 完成为「目标失联」，攻击方 hold
    s.completed = true;
    s.endReason = 'track_lost';
    s.pursuit = null;
    return s;
  }
  s.pursuit = track.liveVisible
    ? { x: track.lastKnown.x, y: track.lastKnown.y, fromIntel: false }
    : { x: track.lastKnown.x, y: track.lastKnown.y, fromIntel: true };
  void nowMs;
  return s;
}

/** 新指令替换时对攻击状态的收尾（endReason='replaced'） */
export function cancelDirectAttack(state: DirectAttackState | null): DirectAttackState | null {
  if (!state || state.completed) return state;
  return { ...state, completed: true, endReason: 'replaced', pursuit: null };
}

// ------------------------------------------------------------
// 权威解析
// ------------------------------------------------------------

export interface AuthorityInput {
  /** 舰队已毁灭 */
  destroyed: boolean;
  /** 运行时撤退态（§Retreat 三态） */
  retreatState: RetreatState;
  /** 玩家直接指令（无 = null） */
  direct: DirectOrder | null;
  /** 直接攻击生命周期状态（direct.kind==='attack' 时非空） */
  attack: DirectAttackState | null;
  /** 已承诺的战术计划角色（taskForce 分队；无 = null） */
  planRole: { planId: string; role: string } | null;
  /** 战略任务（mission 五词之一；无 = null） */
  mission: MissionKind | null;
  /** 局部战斗响应（受击还击/接敌交战；无 = null） */
  localCombat: { intent: string } | null;
  /** 玩家直接控制的舰队（无指令时必须保持开场部署） */
  playerControlled: boolean;
  /** 本帧是否新接受了一条直接指令（用于「成为权威后才 ack」） */
  directJustIssued: boolean;
}

export interface AuthorityDecision {
  layer: AuthorityLayer;
  /** 运动指令（与火控分离输出） */
  movement:
    | { type: 'hold'; label: string }
    | { type: 'move'; x: number; y: number; fromIntel: boolean; label: string }
    | { type: 'retreat'; label: string }
    | { type: 'plan'; planId: string; role: string; label: string }
    | { type: 'mission'; mission: MissionKind; label: string };
  /** 火控许可（独立于运动：可边机动边还击；显式攻击指令独占运动目标） */
  fire: 'free' | 'attack_target_only' | 'return_fire_only' | 'none';
  /** 接受直接指令时清空陈旧运动控制器状态（掉头/重组/相位机） */
  clearMotionState: boolean;
  /** 可见确认（ack）仅在指令真正成为权威后给出 */
  acknowledged: boolean;
  /** 直接指令被拒原因（仅 rout 拒绝；毁灭层级不产生 ack） */
  rejectReason: 'rout' | 'destroyed' | null;
  label: string;
}

/**
 * 6 级权威解析。规则（方案 §Authority and state model）：
 *   1. destroyed / **true rout 压过一切**——仅溃散可拒绝直接指令；
 *   2. 直接玩家指令（含 direct attack 未完成时**独占运动目标**）；
 *   3. 已承诺战术计划角色；
 *   4. 战略任务；
 *   5. 局部战斗响应（移动被本地交战接管，但火控可自由开火）；
 *   6. 自主姿态（玩家舰队无指令 ⇒ **保持开场部署**，不搜索/不转向/不分兵）。
 *
 * 运动与火控分离：任意层级下 local combat 都可还击（return_fire_only / free），
 * 但 direct attack 未完成时运动目标只属于该攻击（不得被本地威胁静默改成追击）。
 */
export function resolveAuthority(input: AuthorityInput): AuthorityDecision {
  const fireFromRetreat: AuthorityDecision['fire'] = input.retreatState === 'routed' ? 'none' : 'return_fire_only';

  // 1. destroyed or true rout
  if (input.destroyed) {
    return {
      layer: 'destroyed_or_rout',
      movement: { type: 'hold', label: '毁灭' },
      fire: 'none',
      clearMotionState: false,
      acknowledged: false,
      rejectReason: 'destroyed',
      label: '毁灭',
    };
  }
  if (input.retreatState === 'routed') {
    return {
      layer: 'destroyed_or_rout',
      movement: { type: 'retreat', label: '溃散' },
      fire: 'none',
      clearMotionState: false,
      acknowledged: false,
      rejectReason: 'rout',
      label: '溃散',
    };
  }

  // 2. direct player order（仅 rout/毁灭可拒绝 ⇒ 这里必接受）
  if (input.direct) {
    const clearMotionState = input.directJustIssued;
    const ack = input.directJustIssued; // 成为权威后才确认
    if (input.direct.kind === 'move') {
      return {
        layer: 'direct_order',
        movement: {
          type: 'move', x: input.direct.x, y: input.direct.y,
          fromIntel: false, label: runtimeIntentLabel('奉令', '向指定战位机动'),
        },
        // 本地火控可打射程内威胁，但**不得**把 move 静默转成追击
        fire: input.localCombat ? 'free' : 'return_fire_only',
        clearMotionState, acknowledged: ack, rejectReason: null,
        label: runtimeIntentLabel('奉令', '向指定战位机动'),
      };
    }
    if (input.direct.kind === 'attack') {
      const at = input.attack;
      const done = at?.completed === true;
      if (done) {
        // 完成 → hold（target_destroyed / track_lost 都归 hold）
        const why = at?.endReason === 'track_lost' ? '目标失联' : '目标已灭';
        return {
          layer: 'direct_order',
          movement: { type: 'hold', label: runtimeIntentLabel('奉令', why) },
          fire: 'return_fire_only',
          clearMotionState, acknowledged: ack, rejectReason: null,
          label: runtimeIntentLabel('奉令', why),
        };
      }
      const p = at?.pursuit ?? null;
      return {
        layer: 'direct_order',
        movement: p
          ? {
              type: 'move', x: p.x, y: p.y, fromIntel: p.fromIntel,
              label: runtimeIntentLabel('奉令', p.fromIntel ? '追击敌舰（末次位置）' : '追击敌舰'),
            }
          : { type: 'hold', label: runtimeIntentLabel('奉令', '接敌') },
        // 显式攻击指令独占运动目标；火控以指定目标为主，可自由开火
        fire: 'attack_target_only',
        clearMotionState, acknowledged: ack, rejectReason: null,
        label: runtimeIntentLabel('奉令', '攻击敌舰'),
      };
    }
    // hold
    return {
      layer: 'direct_order',
      movement: { type: 'hold', label: runtimeIntentLabel('奉令', '据守当前战位') },
      fire: 'free',
      clearMotionState, acknowledged: ack, rejectReason: null,
      label: runtimeIntentLabel('奉令', '据守当前战位'),
    };
  }

  // 3. active committed tactical-plan role
  if (input.planRole) {
    return {
      layer: 'tactical_plan_role',
      movement: {
        type: 'plan', planId: input.planRole.planId, role: input.planRole.role,
        label: runtimeIntentLabel('奉令', input.planRole.role),
      },
      fire: 'free',
      clearMotionState: false, acknowledged: false, rejectReason: null,
      label: runtimeIntentLabel('奉令', input.planRole.role),
    };
  }

  // 4. assigned strategic mission
  if (input.mission) {
    return {
      layer: 'strategic_mission',
      movement: { type: 'mission', mission: input.mission, label: missionLabel(input.mission) },
      fire: 'free',
      clearMotionState: false, acknowledged: false, rejectReason: null,
      label: missionLabel(input.mission),
    };
  }

  // 5. local combat response（运动被本地交战接管；火控自由还击）
  if (input.localCombat) {
    return {
      layer: 'local_combat_response',
      movement: { type: 'hold', label: runtimeIntentLabel('临机', input.localCombat.intent) },
      fire: fireFromRetreat === 'none' ? 'none' : 'free',
      clearMotionState: false, acknowledged: false, rejectReason: null,
      label: runtimeIntentLabel('交战', input.localCombat.intent),
    };
  }

  // 6. autonomous posture（玩家舰队无指令 ⇒ 保持开场部署）
  return {
    layer: 'autonomous_posture',
    movement: {
      type: 'hold',
      label: input.playerControlled ? '保持部署' : '警戒',
    },
    fire: fireFromRetreat,
    clearMotionState: false, acknowledged: false, rejectReason: null,
    label: input.playerControlled ? '保持部署' : '警戒',
  };
}

// ============================================================
// C. 撤退运行时三态（收口 retreatDoctrine 档位）
// ============================================================

/**
 * §Retreat, rout, and deadlock：
 *   withdrawing — 受损但可指挥；
 *   regrouping  — 在补给/友军附近临时重组，可指挥；
 *   routed      — 士气崩溃，暂时拒绝正常指令（唯一可拒 direct 的态）。
 *
 * 关键规则：**仅凭舰体百分比不得制造永久不可指挥状态**——
 * withdrawing/regrouping 都可被新的直接指令清除。
 */
export type RetreatState = 'none' | 'withdrawing' | 'regrouping' | 'routed';

/** retreatDoctrine 瞬时档位（保持单一真源，此处仅作类型引用） */
export type RetreatTierInput = 'none' | 'disengage' | 'withdraw' | 'rout';

export interface RetreatRuntimeState {
  state: RetreatState;
  /** 进入当前状态后经过的秒数（供 retreatSpeedMulRamped 等消费） */
  elapsedSec: number;
  /** regrouping 已用时（超时退出） */
  regroupElapsedSec: number;
}

export const RETREAT_STATE_INIT: RetreatRuntimeState = { state: 'none', elapsedSec: 0, regroupElapsedSec: 0 };

/** withdrawing → regrouping：抵达补给/友军附近，或后撤超时仍未脱敌 */
export const WITHDRAW_REGROUP_TIMEOUT_SEC = 20;
/** regrouping 最长重组时间：超时必须重返战场或另受新指令（防永久挂机） */
export const REGROUP_TIMEOUT_SEC = 15;
/** routed 恢复线：士气回升到此值 ⇒ 重新可指挥（回到 withdrawing） */
export const ROUT_RECOVER_MORALE = 20;

export interface RetreatTransitionInput {
  prev: RetreatRuntimeState;
  /** retreatDoctrine.resolveRetreatTier 的瞬时判定结果 */
  tier: RetreatTierInput;
  dtSec: number;
  /** 已抵达补给点或友军集结区（regrouping 触发） */
  nearSupplyOrAlly: boolean;
  /** 恢复条件：士气 ≥ ROUT_RECOVER_MORALE（routed 出口 / regrouping 出口） */
  recovered: boolean;
  /** 新的直接指令已接受 ⇒ 清除 withdrawing/regrouping（rout 不清） */
  directOrderAccepted: boolean;
}

/**
 * 三态迁移（纯计算）。迁移表：
 *   none        → withdrawing ← tier ∈ {disengage, withdraw}
 *   none        → routed      ← tier = rout
 *   withdrawing → none        ← tier = none（动摇条件消失，滞回由 tier 计算侧负责）
 *   withdrawing → regrouping  ← nearSupplyOrAlly 或超时 WITHDRAW_REGROUP_TIMEOUT_SEC
 *   withdrawing → routed      ← tier = rout
 *   regrouping  → none        ← recovered 或超时 REGROUP_TIMEOUT_SEC
 *   regrouping  → withdrawing ← tier 仍属撤退且离开集结区（再次受损等）
 *   regrouping  → routed      ← tier = rout
 *   routed      → withdrawing ← 士气恢复 ROUT_RECOVER_MORALE（"routed 要么恢复士气…"）
 *   withdrawing/regrouping 被 direct 清除 → none（rout 不被清除；direct 并压制同帧进入撤退）
 */
export function transitionRetreatState(input: RetreatTransitionInput): RetreatRuntimeState {
  const { prev, tier, dtSec } = input;
  let state = prev.state;
  let elapsed = prev.elapsedSec;
  let regroupElapsed = prev.state === 'regrouping' ? prev.regroupElapsedSec + dtSec : 0;

  // rout 迁入（最高优先；direct 不可压制）
  if (tier === 'rout' && state !== 'routed') {
    return { state: 'routed', elapsedSec: 0, regroupElapsedSec: 0 };
  }

  // direct 清除（§"Only a true rout may reject a direct order"）：
  // 不仅清除 withdrawing/regrouping，还**压制本帧从 none 进入撤退**——
  // 新指令与动摇判定同帧出现时，direct 权威更高。
  if (input.directOrderAccepted && state !== 'routed') {
    return { state: 'none', elapsedSec: 0, regroupElapsedSec: 0 };
  }

  if (state === 'routed') {
    // routed 出口：士气恢复 → withdrawing（离场/被毁由 BattleScene 结算，不经本函数）。
    // ⚠ 恢复判据必须是 morale ≥ ROUT_RECOVER_MORALE（调用方经 input.recovered 传入），
    //   不能用 tier !== 'rout'——resolveRetreatTier 仅在士气 < 1 给 rout，
    //   士气稍一回升 tier 即脱 rout，会让溃散态瞬间结束（无滞回）。
    if (input.recovered) {
      return { state: 'withdrawing', elapsedSec: 0, regroupElapsedSec: 0 };
    }
    return { state: 'routed', elapsedSec: prev.elapsedSec + dtSec, regroupElapsedSec: 0 };
  }

  if (state === 'none') {
    if (tier === 'disengage' || tier === 'withdraw') {
      return { state: 'withdrawing', elapsedSec: 0, regroupElapsedSec: 0 };
    }
    return { state: 'none', elapsedSec: 0, regroupElapsedSec: 0 };
  }

  if (state === 'withdrawing') {
    if (tier === 'none') {
      // 动摇条件消失 ⇒ 自行结束撤退（防"一朝受损、终身后撤"）
      return { state: 'none', elapsedSec: 0, regroupElapsedSec: 0 };
    }
    elapsed += dtSec;
    if (input.nearSupplyOrAlly || elapsed >= WITHDRAW_REGROUP_TIMEOUT_SEC) {
      return { state: 'regrouping', elapsedSec: elapsed, regroupElapsedSec: 0 };
    }
    return { state: 'withdrawing', elapsedSec: elapsed, regroupElapsedSec: 0 };
  }

  // state === 'regrouping'
  if (input.recovered || regroupElapsed >= REGROUP_TIMEOUT_SEC) {
    return { state: 'none', elapsedSec: 0, regroupElapsedSec: 0 };
  }
  if (tier === 'disengage' || tier === 'withdraw') {
    return { state: 'withdrawing', elapsedSec: 0, regroupElapsedSec: regroupElapsed };
  }
  return { state: 'regrouping', elapsedSec: prev.elapsedSec, regroupElapsedSec: regroupElapsed };
}

// ============================================================
// D. 战斗停滞看门狗
// ============================================================

/**
 * §Retreat, rout, and deadlock（末段）：
 * 「看门狗观测有意义位移、距离闭合、目标进度与武器开火。若敌对兵力仍在而
 *   双方在有界区间内都无进展，AI 舰队必须在推进/目标施压/撤退中三选一；
 *   看门狗绝不伪造伤害或瞬移舰队。」
 */
export type StallDirective = 'none' | 'advance' | 'objective_pressure' | 'withdrawal';

export interface StallWatchInput {
  /** 观测窗口累计有意义位移（世界单位） */
  displacement: number;
  /** 窗口内敌我距离闭合量（正 = 接近） */
  rangeClosure: number;
  /** 窗口内目标进度变化（0 = 无进度；正 = 有推进/占领/护送进展） */
  objectiveProgress: number;
  /** 窗口内是否发生武器开火 */
  weaponsFired: boolean;
  /** 敌对兵力是否仍在场 */
  hostilesRemain: boolean;
  /** 停滞持续秒数（调用方累计；有进展时清零） */
  stalledSec: number;
  /** 三选一策略入参：可安全推进 */
  canAdvance: boolean;
  /** 三选一策略入参：存在可施压的任务目标 */
  objectiveAvailable: boolean;
  /** 三选一策略入参：兵力严重受损（⇒ 撤退） */
  badlyHurt: boolean;
}

export const STALL_MEANINGFUL_DISPLACEMENT = 40;   // 低于此位移 ≈ 原地
export const STALL_MEANINGFUL_CLOSURE = 25;        // 有意义的距离闭合
export const STALL_OBJECTIVE_EPS = 1e-3;           // 目标进度最小判别
export const STALL_TRIGGER_SEC = 12;               // 停滞有界区间

export interface StallWatchOutput {
  directive: StallDirective;
  /** 更新后的停滞累计（有进展时清零） */
  stalledSec: number;
}

/**
 * 看门狗单帧推进。任何有意义进展（位移/闭合/目标/开火）⇒ 清零停滞计时、返回 none。
 * 停滞满 STALL_TRIGGER_SEC 且敌方仍在 ⇒ 强制 AI 三选一（输出 directive 由执行层
 * 转成目标/航向；**本模块永不产出伤害数字或位置跳变**）。
 *
 * 三选一的取舍（确定性，供台架断言）：
 *   有目标进度口径可用 ⇒ objective_pressure（向任务点施压）；
 *   兵力尚可推进 ⇒ advance；否则 ⇒ withdrawal。
 */
export function tickStallWatchdog(input: StallWatchInput): StallWatchOutput {
  const progressed =
    input.displacement >= STALL_MEANINGFUL_DISPLACEMENT ||
    input.rangeClosure >= STALL_MEANINGFUL_CLOSURE ||
    input.objectiveProgress > STALL_OBJECTIVE_EPS ||
    input.weaponsFired;
  if (progressed || !input.hostilesRemain) {
    return { directive: 'none', stalledSec: 0 };
  }
  const stalledSec = input.stalledSec;
  if (stalledSec < STALL_TRIGGER_SEC) {
    return { directive: 'none', stalledSec };
  }
  // 停滞已满有界区间 ⇒ 强制 AI 三选一（确定性策略见 chooseStallAction）
  return {
    directive: chooseStallAction(input.canAdvance, input.objectiveAvailable, input.badlyHurt),
    stalledSec,
  };
}

/**
 * AI 在看门狗强制下做三选一（确定性策略；个性只影响权重，由 BattleScene 侧传参体现）：
 *   兵力严重受损 ⇒ withdrawal；有任务目标可施压 ⇒ objective_pressure；
 *   可推进 ⇒ advance；否则 ⇒ withdrawal。
 * **绝不返回伪造伤害或位置跳变**——输出只是意图，执行层转成航向/目标。
 */
export function chooseStallAction(
  canAdvance: boolean,
  objectiveAvailable: boolean,
  badlyHurt: boolean,
): Exclude<StallDirective, 'none'> {
  if (badlyHurt) return 'withdrawal';
  if (objectiveAvailable) return 'objective_pressure';
  if (canAdvance) return 'advance';
  return 'withdrawal';
}

// ============================================================
// E. 任务语言与运行时意图（术语单一真源）
// ============================================================

/** 五类战略任务（方案 §Mission language） */
export type MissionKind =
  | 'engage_force'      // 进击敌舰队 — 追歼指定敌军
  | 'seize_objective'   // 夺取战略据点 — 攻占指定基地/目标
  | 'hold_sector'       // 固守战区 — 守住指定区域并打击进入之敌
  | 'support_ally'      // 协同友军 — 支援指定友军
  | 'withdraw_supply';  // 撤回整补 — 撤往指定补给点

const MISSION_LABELS: Record<MissionKind, string> = {
  engage_force: '进击敌舰队',
  seize_objective: '夺取战略据点',
  hold_sector: '固守战区',
  support_ally: '协同友军',
  withdraw_supply: '撤回整补',
};

/** 任务名（简洁作战用语；不含隐藏敌情） */
export function missionLabel(m: MissionKind): string {
  return MISSION_LABELS[m];
}

/** 运行时意图前缀（与任务名分列展示） */
export type IntentPrefix = '奉令' | '临机' | '交战' | '整补';

/**
 * 运行时意图标签：`奉令：右翼迂回` / `临机：追击敌旗舰` / `交战：压制敌前卫` /
 * `整补：向最近补给线撤回`。**只表达我方在做什么与为什么，
 * 不泄露隐藏敌方信息**（调用方传入的 text 必须已脱敏）。
 */
export function runtimeIntentLabel(prefix: IntentPrefix, text: string): string {
  return `${prefix}：${text}`;
}

/** 交战完成语（direct attack 结束标签） */
export const ATTACK_END_LABELS: Record<AttackEndReason, string> = {
  target_destroyed: '目标已灭',
  track_lost: '目标失联',
  replaced: '指令更新',
  invalid_target: '目标无效',
};
