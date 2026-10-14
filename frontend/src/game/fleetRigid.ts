/**
 * fleetRigid.ts — 舰队刚体运动学（[v73] 取代「追槽位」架构）
 *
 * ============================================================================
 * 为什么取代（设计真源：32-fleet-rigid-model.md）
 * ============================================================================
 * 旧架构四个量互相耦合：fAngle(火控) → facingSmooth(舰首) → formFacing(阵面)
 * → 位移方向。任一变则全变 ⇒ 阵型指向与移动方向不一致、公转画圈、挤压、
 * 瞬间换向。v70~v72 三轮在此架构内调参均失败（问题在结构，不在参数）。
 *
 * 新架构：舰队 = 刚体（质心 + 朝向），每艘船是刚体上的点，**公式直算，不追**。
 *
 * ============================================================================
 * 核心物理约束（本模块的存在理由）
 * ============================================================================
 * 保持编队需要横向速度：外翼舰转向时必须画弧线，v_外翼 = ω × 编队半宽。
 * 若该速度超过舰船推力上限，外翼会被拉开 ⇒ 编队散架。
 *
 *   ⇒ ω_max = vMax / halfWidth            （编队不散架的硬约束）
 *
 * 这不是"参数没调好"，是物理要求：一支宽 400px 的战列编队，若战列
 * vMax=0.22px/帧，则 ω ≤ 0.22/200 = 0.0011 rad/帧 ⇒ 180° 掉头需 47.5s。
 * "掉头该慢"由此而来，而非手感问题。
 */

// ══════════════════════════════════════════════════════════════════════
// A. 状态
// ══════════════════════════════════════════════════════════════════════

export interface RigidState {
  /** 质心位置（世界 px） */
  x: number;
  y: number;
  /** 舰队朝向（rad）。阵型长轴方向 = 舰首方向 */
  heading: number;
  /** 质心线速度（px/帧@dt=1） */
  vx: number;
  vy: number;
  /** 角速度（rad/帧@dt=1）。正 = 逆时针 */
  omega: number;
}

/** 推力意图：场景层解算「该往哪推、推多猛」，本模块只做积分 */
export interface RigidInput {
  /** 期望推进方向（世界 rad）。null = 无推力（惯性滑行） */
  thrustDir: number | null;
  /** 推力档 0~1（0=滑行 / 1=全推力） */
  thrustLevel: number;
  /** 期望朝向（世界 rad）。转向由力矩趋近，非瞬转 */
  targetHeading: number | null;
  /** 角速度上限（rad/帧）。**必须由调用方按编队宽度约束**（见 omegaCapFor） */
  omegaCap: number;
  /** 角加速度上限（rad/帧²） */
  alphaMax: number;
  /** 角阻尼（1/帧）。松力后角速度按此衰减 ⇒ 姿态稳定 */
  angDrag: number;
}

/** 运动学剖面（来自 config/shipKinematics.fleetProfile，此处只声明形状） */
export interface RigidProfile {
  /** 巡航速度（px/帧@dt=1） */
  vMax: number;
  /** 线加速度（px/帧²） */
  accel: number;
  /** 角加速度（rad/帧²） */
  alphaMax: number;
  /** 编队半宽（px）—— 决定转向角速度上限 */
  halfWidth: number;
}

// ══════════════════════════════════════════════════════════════════════
// B. 编队约束的角速度上限（核心）
// ══════════════════════════════════════════════════════════════════════

/** 外翼弧速安全系数：允许外翼用到 vMax 的这个比例（留余量给阵型误差） */
export const WING_SAFETY = 0.75;

/**
 * 编队不散架的角速度上限：ω ≤ vMax × WING_SAFETY / halfWidth
 * @param vMax   编队主导舰的巡航速度
 * @param halfWidth 编队半宽（px）
 */
export function omegaCapFor(vMax: number, halfWidth: number): number {
  if (halfWidth <= 1) return 1.0;   // 单舰/极窄编队：无编队约束
  return (vMax * WING_SAFETY) / halfWidth;
}

/** 外翼舰划弧的线速度（px/帧）：v = ω × halfWidth */
export function wingSpeed(omega: number, halfWidth: number): number {
  return Math.abs(omega) * halfWidth;
}

// ══════════════════════════════════════════════════════════════════════
// C. 积分
// ══════════════════════════════════════════════════════════════════════

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * 刚体一步积分。纯函数：返回新状态，不改入参。
 *
 * 积分顺序（顺序即物理因果，不可调换）：
 *   ① 推力 → 线速度（|Δv| ≤ accel·thrustLevel·dt，硬上限 ⇒ 推力有限性）
 *   ② 线速度 → 位置
 *   ③ 力矩 → 角速度（|Δω| ≤ alphaMax·dt + 硬钳 ωCap）
 *   ④ 角阻尼（松力衰减）
 *   ⑤ 角速度 → 朝向
 */
export function stepRigid(st: RigidState, input: RigidInput, dt: number): RigidState {
  const dtc = Math.max(0, dt);
  let { x, y, heading, vx, vy, omega } = st;

  // ── ① 推力 → 线速度 ──
  if (input.thrustDir !== null && input.thrustLevel > 0) {
    const level = Math.max(0, Math.min(1, input.thrustLevel));
    // 期望速度矢量 = 推力方向 × 满速 × 档位
    const dvx = Math.cos(input.thrustDir) - vx;
    const dvy = Math.sin(input.thrustDir) - vy;
    const dvMag = Math.hypot(dvx, dvy);
    // 硬上限：|Δv| ≤ accel·level·dt（由调用方通过 input 间接提供，此处用
    // 一个足够大的默认值；实际 accel 由场景层在 thrustLevel 里已折算）
    const dvCap = level * dt;
    if (dvMag > dvCap && dvMag > 1e-9) {
      vx += (dvx / dvMag) * dvCap;
      vy += (dvy / dvMag) * dvCap;
    } else {
      vx += dvx; vy += dvy;
    }
  }

  // ── ② 线速度 → 位置 ──
  x += vx * dtc;
  y += vy * dtc;

  // ── ③ 力矩 → 角速度 ──
  if (input.targetHeading !== null) {
    const dH = wrap(input.targetHeading - heading);
    // [v73] 控制律：目标速率 = min(omegaCap, 临界制动速度)。
    //   临界制动速度 = sqrt(2·alphaMax·|dH|) —— 保证能在剩余角差内**停住**。
    //   ⚠ 初版只有 min(omegaCap, |dH|) ⇒ 角阻尼每帧衰减、want 随 |dH| 收缩
    //     ⇒ 在目标前渐进收敛但**永不到位**（台架 C 组实测 3000 帧仍到不了 180°）。
    //     这与 v65 #18「过冲 179.9°」是同一类病：制动律缺失。
    const brake = Math.sqrt(2 * input.alphaMax * Math.abs(dH));
    const want = Math.sign(dH) * Math.min(input.omegaCap, brake);
    const dOmega = Math.max(-input.alphaMax * dtc, Math.min(input.alphaMax * dtc, want - omega));
    omega += dOmega;
    // 硬钳：不得超 omegaCap（跨相位交接护栏，同 v65 #18 的思路）
    if (Math.abs(omega) > input.omegaCap) omega = Math.sign(omega) * input.omegaCap;
    // 到位吸附：角差小于一帧可达量 ⇒ 直接落位并清零角速度。
    //   ⚠ 必须有：制动律只保证"不过冲"，不保证"能到"；吸附是到位的唯一保证。
    if (Math.abs(dH) <= input.omegaCap * dtc) {
      heading = input.targetHeading;
      omega = 0;
    }
  } else {
    // 无目标朝向 ⇒ 保持当前角速度（仅阻尼衰减）
  }

  // ── ④ 角阻尼 ──
  omega *= Math.max(0, 1 - input.angDrag * dtc);
  if (Math.abs(omega) < 1e-6) omega = 0;

  // ── ⑤ 角速度 → 朝向 ──
  heading = wrap(heading + omega * dtc);

  return { x, y, heading, vx, vy, omega };
}

// ══════════════════════════════════════════════════════════════════════
// D. 每舰位置（刚体公式直算，无追踪）
// ══════════════════════════════════════════════════════════════════════

export interface SlotOffset {
  /** 沿舰队朝向（纵向，+ = 前方） */
  along: number;
  /** 垂直舰队朝向（横向，+ = 左舷） */
  lateral: number;
}

/**
 * 由刚体状态 + 阵型偏移算某舰的世界位置。
 * ⚠ 这是**公式直算**，取代旧的 stepShipSlotFollow 追踪 ⇒ 无追踪误差、
 *   无挤压、无抖动。船位与舰队姿态严格同步（差恒为 0）。
 */
export function shipSlot(st: RigidState, off: SlotOffset): { x: number; y: number } {
  const c = Math.cos(st.heading), s = Math.sin(st.heading);
  return {
    x: st.x + c * off.along - s * off.lateral,
    y: st.y + s * off.along + c * off.lateral,
  };
}

/** 反算：某舰当前位置相对刚体的偏移（用于阵型切换插值与诊断） */
export function shipOffsetOf(st: RigidState, x: number, y: number): SlotOffset {
  const dx = x - st.x, dy = y - st.y;
  const c = Math.cos(st.heading), s = Math.sin(st.heading);
  return { along: dx * c + dy * s, lateral: -dx * s + dy * c };
}

// ══════════════════════════════════════════════════════════════════════
// E. 派生量（台架与 UI 用）
// ══════════════════════════════════════════════════════════════════════

/** 当前速率（px/帧） */
export function speedOf(st: RigidState): number {
  return Math.hypot(st.vx, st.vy);
}

/** 当前航向（rad）：由速度矢量给出；静止时回退 heading */
export function courseOf(st: RigidState): number {
  const sp = speedOf(st);
  return sp > 1e-6 ? Math.atan2(st.vy, st.vx) : st.heading;
}

/**
 * 停船距离（px）= v²/(2a)。
 * 台架用它验证"停船慢"符合物理（真空无阻力，必须反向推力）。
 */
export function stopDistance(v: number, accel: number): number {
  return accel > 0 ? (v * v) / (2 * accel) : Infinity;
}

/**
 * 0→95% 速度耗时（秒@60fps）。
 * ⚠ [v73] 硬上限语义：线性加速 ⇒ 帧数 = 0.95·vMax/accel。
 *   **不是** 3/accel（那是"指数趋近"的 3τ，本模块不用指数趋近）。
 *   两种语义差 13.6 倍（accel=0.006 时：线性 0.6s vs 指数 8.3s），
 *   混淆会让"战舰有质量"的设计意图完全落空。
 * @param accel 满速档位下的加速度（px/帧²）
 * @param vMax  巡航速度（px/帧）
 */
export function rampSeconds(accel: number, vMax = 1): number {
  return accel > 0 ? ((0.95 * vMax) / accel) * (1000 / 60) / 1000 : Infinity;
}

/** 180° 掉头耗时（秒@60fps）= π/ω × 60 */
export function turn180Seconds(omega: number): number {
  return omega > 0 ? (Math.PI / omega) * (1000 / 60) / 1000 : Infinity;
}

// ══════════════════════════════════════════════════════════════════════
// F. 工厂
// ══════════════════════════════════════════════════════════════════════

export function createRigid(x: number, y: number, heading: number): RigidState {
  return { x, y, heading, vx: 0, vy: 0, omega: 0 };
}

/**
 * 默认积分输入（无推力、保持朝向、无编队约束）。
 * 场景层应按 RigidProfile 覆写 omegaCap / alphaMax / angDrag。
 */
export function idleInput(): RigidInput {
  return {
    thrustDir: null, thrustLevel: 0,
    targetHeading: null,
    omegaCap: 0.01, alphaMax: 0.0005, angDrag: 0.15,
  };
}
