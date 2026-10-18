/**
 * Deterministic tactical movement control.
 *
 * The controller owns the legal order of large fleet maneuvers. It deliberately
 * has no Phaser dependency so a battle can be tested without rendering it.
 */

export type ManeuverPhase = 'cruise' | 'brake' | 'turn' | 'reform' | 'disengage';
export type MotionDirective = 'forward' | 'reverse' | 'hold';

export interface ContactState {
  engaged: boolean;
  /** Seconds out of weapons contact before a fleet is free to turn. */
  releaseAfter: number;
  secondsSinceContact: number;
}

export interface ManeuverState {
  phase: ManeuverPhase;
  phaseSeconds: number;
  motion?: MotionDirective;
}

export interface ManeuverInput {
  engaged: boolean;
  retreatRequested: boolean;
  /** Absolute difference between current and requested fleet heading, radians. */
  headingError: number;
  stopped: boolean;
  reformed: boolean;
  /**
   * [FIX-⑤] 是否处于**近距离缠斗**（调用方口径：最近敌距离 < 250px）。
   *
   * 近距离**不得**进入"刹车→原地转向→重排"序列，原因有二：
   *   ① 物理：贴脸交战时应保持航速，原地掉头等于送给对方一个静止靶；
   *   ② 结构性：`turn` 相的退出条件是 headingError ≤ π/24，而交战中大角度转向会被
   *      `turnDiscipline` 判成 denied ⇒ 转速 0 ⇒ **永不收敛**，只能等 35s 超时
   *      ⇒ `motion='hold'` 冻结数十秒（用户实报"舰队不动 / 乱动"）。
   * 近距离时保持 cruise，让常规限速转向在航行中完成（画弧，而不是原地扭）。
   */
  closeContact?: boolean;
  /**
   * [FIX-⑥] 本舰种**刹停所需时间**（秒）；缺省用 `MANEUVER_PHASE_TIMEOUT.brake`。
   *
   * 原固定 5s 小于重舰实际刹停时间（战列 vMax=0.22、accel=0.00042 ⇒ (0.22−0.02)/0.00042
   * ≈ 476 帧 ≈ 7.9s）⇒ 超时先到，舰队带着约 43% 残余速度进入 turn 相（原地转向）。
   * 调用方按 `1.2 × vMax / accel / 60` 传入（战列 ≈ 10.5s）。
   */
  brakeTimeoutSec?: number;
}

export interface ManeuverOrder {
  phase: ManeuverPhase;
  motion: MotionDirective;
  /** Rotate hulls in place; formation slots must stay frozen while true. */
  rotateInPlace: boolean;
  /** Assign new formation slots once when entering reformation. */
  beginReform: boolean;
}

export const TURN_THRESHOLD = Math.PI / 6;

/**
 * [v94] **机动相位超时兜底（秒）** —— 防「卡在 hold ⇒ 舰队永久冻结」。
 *
 *   背景（用户实报「我方舰队都不动，下达军议命令也无任何动作」）：
 *   brake / turn / reform 三个相位的退出条件都依赖**物理量收敛**
 *     · brake  → input.stopped（速度 < 0.02）
 *     · turn   → input.headingError ≤ π/24
 *     · reform → input.reformed（阵面收敛 + maxSlotGap ≤ 6）
 *   而 phaseSeconds 只累加、**从未用于超时判定** ⇒ 若因**友/敌 200px 排斥力、
 *   地形阻挡、阵位冲突**导致永不收敛，就会**永久停在 motion==='hold'**
 *   ⇒ BattleScene 把 rawVX/rawVY 清零 ⇒ **舰队完全不动**（命令改变目标也无效，
 *     因为 hold 清零点在目标解算之后）。
 *   ⇒ 本超时是**安全阀**：到点后强制推进到下一相位，保证链路一定可恢复。
 *   ⚠ 取值须大于「该相位的正常最长耗时」（否则会打断正常机动）：
 *     · brake 5s（停船；[FIX-⑥] 调用方可按舰种覆盖为 1.2×vMax/accel，战列约 10.5s
 *       —— 固定 5s 短于战列实际刹停 7.9s ⇒ 带着 ~43% 残速进入 turn）
 *     · turn 35s（大编队 180° 掉头最慢约 28.8s — 见 shipKinematics.turn180Seconds）
 *     · reform 10s（阵面重排只需数秒；卡住必是收敛失败）
 */
export const MANEUVER_PHASE_TIMEOUT = { brake: 5, turn: 35, reform: 10 } as const;
export const DEFAULT_CONTACT_RELEASE_SECONDS = 2;

export function updateContact(previous: ContactState, inRange: boolean, dtSeconds: number): ContactState {
  const releaseAfter = previous.releaseAfter || DEFAULT_CONTACT_RELEASE_SECONDS;
  if (inRange) return { engaged: true, releaseAfter, secondsSinceContact: 0 };
  const secondsSinceContact = previous.secondsSinceContact + Math.max(0, dtSeconds);
  return {
    engaged: previous.engaged && secondsSinceContact < releaseAfter,
    releaseAfter,
    secondsSinceContact,
  };
}

export function maneuverOrder(phase: ManeuverPhase): ManeuverOrder {
  switch (phase) {
    case 'disengage': return { phase, motion: 'reverse', rotateInPlace: false, beginReform: false };
    case 'brake': return { phase, motion: 'hold', rotateInPlace: false, beginReform: false };
    case 'turn': return { phase, motion: 'hold', rotateInPlace: true, beginReform: false };
    case 'reform': return { phase, motion: 'hold', rotateInPlace: false, beginReform: true };
    default: return { phase, motion: 'forward', rotateInPlace: false, beginReform: false };
  }
}

export function advanceManeuver(state: ManeuverState, input: ManeuverInput, dtSeconds: number): ManeuverState {
  const elapsed = state.phaseSeconds + Math.max(0, dtSeconds);
  // A fleet under live fire cannot start or continue a free-space turn.
  if (input.engaged && (input.retreatRequested || state.phase === 'disengage')) {
    return { phase: 'disengage', phaseSeconds: elapsed, motion: 'reverse' };
  }
  // Contact released: a withdrawing fleet can now turn toward its withdrawal route.
  if (state.phase === 'disengage') {
    return { phase: input.headingError > TURN_THRESHOLD ? 'brake' : 'cruise', phaseSeconds: 0 };
  }
  // [FIX-⑤] 近距离缠斗 ⇒ **立即退出**原地转向序列（brake/turn/reform 全都 motion='hold'）。
  //   为什么必须放在 disengage 之后：撤退（disengage）是更高优先级的姿态，不能被它打断
  //   —— 上面两支已把 disengage 分流完毕，能走到这里的只可能是 cruise/brake/turn/reform。
  //   为什么直接回 cruise 而不是 brake→reform：reform 相同样 hold，且 formFacing 追赶新
  //   航向所需时间与舰首同源（战列 180° ≈ 14s）⇒ 仍是十几秒零位移。近距离时**航速优先**，
  //   转向交给常规限速转向（舰首边走边转），零位移时长归零。
  if (input.closeContact) {
    return { phase: 'cruise', phaseSeconds: 0 };
  }
  if (state.phase === 'cruise' && input.headingError > TURN_THRESHOLD) {
    return { phase: 'brake', phaseSeconds: 0 };
  }
  if (state.phase === 'brake' && input.stopped) {
    return { phase: 'turn', phaseSeconds: 0 };
  }
  if (state.phase === 'turn' && input.headingError <= TURN_THRESHOLD / 4) {
    return { phase: 'reform', phaseSeconds: 0 };
  }
  if (state.phase === 'reform' && input.reformed) {
    return { phase: 'cruise', phaseSeconds: 0 };
  }
  // [v94] **超时兜底**：正常退出依赖物理量收敛（见上方）；超时仍未收敛 ⇒ 强制推进。
  //   防「永不收敛 ⇒ 永久 hold ⇒ 舰队冻结」（用户实报「舰队都不动」）。
  // [FIX-⑥] brake 超时改为**按舰种**（`brakeTimeoutSec`）；缺省仍用旧常量。
  if (state.phase === 'brake' && elapsed > (input.brakeTimeoutSec ?? MANEUVER_PHASE_TIMEOUT.brake)) {
    return { phase: 'turn', phaseSeconds: 0 };
  }
  if (state.phase === 'turn' && elapsed > MANEUVER_PHASE_TIMEOUT.turn) {
    return { phase: 'reform', phaseSeconds: 0 };
  }
  if (state.phase === 'reform' && elapsed > MANEUVER_PHASE_TIMEOUT.reform) {
    return { phase: 'cruise', phaseSeconds: 0 };
  }
  return { ...state, phaseSeconds: elapsed, motion: maneuverOrder(state.phase).motion };
}
