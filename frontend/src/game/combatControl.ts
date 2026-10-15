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
 *     · brake 5s（停船）
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
  if (state.phase === 'brake' && elapsed > MANEUVER_PHASE_TIMEOUT.brake) {
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
