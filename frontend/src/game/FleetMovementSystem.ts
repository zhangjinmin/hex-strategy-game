/**
 * FleetMovementSystem — 舰队战术移动物理系统（重构版）
 * 
 * 设计原则（第一性原理）：
 * 
 * 1. **物理真实性**：太空战舰的运动必须遵循牛顿力学
 *    - 主引擎只能沿舰首方向推进 → 推力方向 = 舰首朝向
 *    - 姿态控制（RCS）独立于位移 → 转身是原地姿态调整，不是飞机式弧线转弯
 *    - 惯性存在于线速度和角速度两个维度 → 起步/停船/转向都有"质量感"
 * 
 * 2. **行为分层**：不同战术状态下采用不同的运动学模型
 *    - **巡航状态**（非接战）：舰队可以自由转向、重组阵型
 *       → 采用"原地转身 + 直线加速"模型：舰首快速转向目标方向，然后沿舰首方向直线加速
 *    - **接战状态**（敌距 < 250px）：舰队保持交战姿态
 *       → 禁止大角度转向（防止"还在对战就转头"），只允许小角度微调
 *    - **撤退状态**（被追击）：舰队缓缓后退
 *       → 舰首朝敌（保持火力），位移背离敌人（倒退脱离）
 *    - **倒退脱离**（近距相位 2）：类似撤退，但速度更慢
 * 
 * 3. **阵型与舰体分离**：
 *    - 舰体朝向 (`facingSmooth`)：每艘战舰的实际朝向，驱动推力和 sprite 旋转
 *    - 阵型朝向 (`formFacing`)：整个舰队阵型的格位旋转基准
 *    - 关键洞察：**阵型朝向应该锁定为"部署时的初始朝向"或"上次完成转向后的朝向"**，
 *      而不是实时跟随舰首或速度方向。这样转向时阵型不会绕中心旋转。
 * 
 * 4. **原地转向协议**（掉头协议增强版）：
 *    - 触发条件：目标航向差 > ENTER_RAD (25°) 且 非交战/非撤退状态
 *    - 协议行为：
 *      ① 舰首快速转向目标方向（RATE_MUL 倍速，无惯量）
 *      ② 推力压死（THRUST = 0.06）→ 几乎停在原地转身
 *      ③ **阵型朝向保持冻结**（不随舰首转 → 无公转）
 *    - 退出协议：
 *      ① 航向差 < EXIT_RAD (12°) 时退出
 *      ② **阵型朝向一步阶跃**到新舰首朝向
 *      ③ 各舰限速直线飞向新阵位（列队重排）
 * 
 * 5. **接战纪律**：
 *    - 真正接舷（敌距 < 250px）时禁止大角度转向
 *    - 理由：现实中两军缠斗时不可能突然掉头
 *    - 实现：`turnDiscipline` 返回 `denied` → 保持当前航向（不清零，只是不主动转）
 * 
 * 6. **撤退/倒退的物理**：
 *    - 撤退时被追击：舰首朝敌（火力方向），位移朝补给点（倒退）
 *    - 这是唯一允许"舰首与位移分离"的状态
 *    - 倒退速度 = 常规速度的 55% → "缓缓后退"
 * 
 * 参数调优建议：
 *   - HEADING_TURN_RATE = π/240 rad/帧 ≈ 0.75°/帧 @60fps = 45°/秒
 *     → 180°掉头 ≈ 4 秒（厚重感）
 *   - FLEET_BASE_SPEED = 0.30 px/帧 = 18 px/秒
 *     → 从 800px 外接近需 ~44 秒（战略纵深）
 *   - 若想增加转弯半径：提高 FLEET_BASE_SPEED（不是降低转角速率）
 *     → v=0.90 时 R = v/ω ≈ 69px ≈ 2.8 倍舰长（读作"划弧前进"而非"原地打转"）
 */

// ============================================================
// A. 核心常量（从 BattleScene 迁移至此，集中管理）
// ============================================================

/** 舰首转向角速率（rad/帧 @ dt=1）= 45°/秒 */
export const HEADING_TURN_RATE = Math.PI / 240;

/** 转向角加速度建立速率（rad/帧²）≈ 21 帧满转率 */
export const TURN_RATE_ACCEL = HEADING_TURN_RATE / 21;

/** 临界制动安全系数（0.85 = 留 15% 余量） */
export const BRAKE_SAFETY = 0.85;

/** 推力对齐下限（0.45 = 即使完全没对齐也保留近半推力） */
export const THRUST_IDLE = 0.45;

/** 线速度惯性系数（0.055 = τ≈0.27s，"质量感"） */
export const FLEET_ACCEL = 0.055;

/** 舰队基准航速（px/帧 @ dt=1） */
export const FLEET_BASE_SPEED = 0.30;

/** 阵型朝向跟随速率（rad/帧）= 90°/秒，仅用于低通滤波防抖 */
export const FORM_FACING_RATE = Math.PI / 120;

/** 阵型朝向的最小速度阈值平方（低于此冻结阵型朝向） */
export const FORM_FACING_MIN_SPD2 = 0.02 * 0.02;

/** 逐舰显示航向最大角速率（rad/帧@dt=1，≈9.2°/帧） */
export const UNIT_VIS_TURN_RATE = 0.16;

/** 单位阵位跟随的除零保护阈值（px） */
export const UNIT_CHASE_EPS = 0.02;

/** 阵型过渡 morph 时长（秒） */
export const FORMATION_MORPH_DUR = 3.5;

// ============================================================
// B. 数据结构
// ============================================================

/** 舰队运动状态（挂在 fleet 对象上） */
export interface FleetMotionState {
  /** 平滑后的舰首朝向（rad） */
  facingSmooth: number;
  /** 舰首角速度（rad/帧） */
  facingRate: number;
  /** 线速度 X（px/帧） */
  vx: number;
  /** 线速度 Y（px/帧） */
  vy: number;
  /** 阵型朝向（rad）—— 只在协议退出时更新 */
  formFacing?: number;
  /** 是否在掉头协议中 */
  _uturn?: boolean;
  /** 掉头协议刚结束（下降沿检测） */
  _uturnJustEnded?: boolean;
  /** 机动相位（0=接近，1=交战，2=脱离） */
  _mPhase?: number;
  /** 阵型 morph 相关 */
  _formMorphT?: number;
  _formMorphDur?: number;
  _formMorphA?: [number, number][];
  _formMorphB?: [number, number][];
}

/** 转向纪律输入 */
export interface TurnDisciplineInput {
  /** 是否真正接舷（敌距 < 250px） */
  engaged: boolean;
  /** 是否在脱离（撤退或 phase=2） */
  disengaging: boolean;
  /** 目标转向角度绝对值（rad） */
  angleToTurn: number;
  /** 提督进攻性（0~1） */
  aggression: number;
}

/** 转向纪律输出 */
export interface TurnDisciplineOutput {
  /** 'allowed' = 正常转向 | 'limited' = 受限转向 | 'denied' = 禁止转向 */
  mode: 'allowed' | 'limited' | 'denied';
  /** 转向速率倍率（0~1） */
  rateMul: number;
}

// ============================================================
// C. 转向纪律（接战时的转向限制）
// ============================================================

/**
 * 计算接战时的转向纪律
 * 
 * 设计意图：
 *   - 真正接舷（<250px）时禁止大角度转向（防止"还在对战就转头"）
 *   - 脱离时允许转向（需要调整航向撤离）
 *   - 进攻性高的提督更愿意在交战中转向（高风险高回报）
 */
export function turnDiscipline(input: TurnDisciplineInput): TurnDisciplineOutput {
  const { engaged, disengaging, angleToTurn, aggression } = input;
  
  // 未接战：自由转向
  if (!engaged) {
    return { mode: 'allowed', rateMul: 1.0 };
  }
  
  // 接战中但在脱离：允许转向（需要拉开距离）
  if (disengaging) {
    return { mode: 'allowed', rateMul: 1.0 };
  }
  
  // 接战中且不脱离：根据角度和进攻性判定
  const largeAngle = angleToTurn > Math.PI / 4; // 45° 算大角度
  
  if (largeAngle) {
    // 大角度转向：进攻性越低越不允许
    // aggression=0 → denied; aggression=1 → limited(0.16)
    const baseMul = 0.06 + aggression * 0.10; // 0.06 ~ 0.16
    return baseMul < 0.12 ? { mode: 'denied', rateMul: 0 } : { mode: 'limited', rateMul: baseMul };
  }
  
  // 小角度微调：总是允许（战术调整）
  return { mode: 'allowed', rateMul: 1.0 };
}

// ============================================================
// D. 主力函数：计算舰队本帧运动
// ============================================================

export interface FleetMovementInput {
  /** 舰队当前坐标 */
  x: number;
  y: number;
  /** 目标坐标（由战术决策层给出） */
  targetX: number;
  targetY: number;
  /** 最近敌舰坐标（可选，用于接战判定） */
  nearestEnemyX?: number;
  nearestEnemyY?: number;
  /** 舰队状态 */
  state: 'assembling' | 'search' | 'engaging' | 'retreating' | 'flaring';
  /** 姿态 */
  stance: 'search' | 'siege' | 'defend' | 'fallback';
  /** 是否正在撤退（与 state='retreating' 可能不同步） */
  isRetreating: boolean;
  /** 是否接战中（根据距离判定） */
  isEngaging: boolean;
  /** 机动相位（2=脱离） */
  mPhase: number;
  /** 理想交战距离（用于相位判定） */
  idealEngageDist: number;
  /** 时间倍率（store.currentSpeedFactor） */
  dt: number;
  /** 地形速度倍率 */
  terrainSpeedMul: number;
  /** 补给因子（0.55~1.0） */
  supplyFactor: number;
  /** 士气速度因子（0.7~1.0） */
  moraleSpeedMul: number;
  /** 指挥点速度修正 */
  cpSpeedMul: number;
  /** 撤退速度档位倍率 */
  retreatSpeedBonus: number;
  /** 阵型崩溃速度修正 */
  collapseSpeedMul: number;
  /** 提督进攻性（0~1） */
  aggression: number;
  /** 排斥力（已限幅） */
  repulseX: number;
  repulseY: number;
  /** 拥堵减速（0.3~1.0） */
  congestionSlowdown: number;
}

export interface FleetMovementOutput {
  /** 新的舰首朝向（rad） */
  newFacing: number;
  /** 新的位置 */
  newX: number;
  newY: number;
  /** 新的速度 */
  newVx: number;
  newVy: number;
  /** 运动状态更新 */
  motion: Partial<FleetMotionState>;
  /** 调试信息 */
  debug: {
    thrustFactor: number;
    backing: boolean;
    uturn: boolean;
    turnMode: string;
  };
}

/**
 * 计算舰队本帧运动（纯函数，无副作用）
 * 
 * @param fleet 舰队对象（会读取 motion 状态）
 * @param input 输入参数
 * @returns 输出结果（调用方负责写回 fleet）
 */
export function computeFleetMovement(
  fleet: any & { motion?: FleetMotionState },
  input: FleetMovementInput
): FleetMovementOutput {
  const {
    x, y, targetX, targetY,
    nearestEnemyX, nearestEnemyY,
    state, stance, isRetreating, isEngaging, mPhase, idealEngageDist,
    dt, terrainSpeedMul, supplyFactor, moraleSpeedMul, cpSpeedMul, retreatSpeedBonus, collapseSpeedMul,
    aggression, repulseX, repulseY, congestionSlowdown,
  } = input;
  
  // 初始化 motion 状态
  const motion: FleetMotionState = fleet.motion ?? {
    facingSmooth: 0,
    facingRate: 0,
    vx: 0,
    vy: 0,
  };
  
  // 计算目标方向
  const dx = targetX - x;
  const dy = targetY - y;
  const distToTarget = Math.hypot(dx, dy);
  
  // 计算目标航向（如果距离太近则保持当前朝向）
  let targetHeading = motion.facingSmooth;
  let moveAngle = motion.facingSmooth;
  
  if (distToTarget > 5) {
    targetHeading = Math.atan2(dy, dx);
    moveAngle = targetHeading;
    
    // 拖刀战术：撤退时若被追击，舰首朝敌但位移朝补给点
    if (isRetreating && isEngaging && nearestEnemyX != null) {
      targetHeading = Math.atan2(nearestEnemyY! - y, nearestEnemyX! - x);
      // moveAngle 保持朝补给点
    }
    // 倒退脱离：同理
    else if (mPhase === 2 && isEngaging && nearestEnemyX != null) {
      targetHeading = Math.atan2(nearestEnemyY! - y, nearestEnemyX! - x);
    }
  } else if (isEngaging && nearestEnemyX != null) {
    // 已抵达射击位置：舰首锁定敌军
    targetHeading = Math.atan2(nearestEnemyY! - y, nearestEnemyX! - x);
  }
  
  // 检测是否需要倒退脱离（近距脱离 = 舰首朝敌、倒退拉开）
  const backing = state === 'engaging' && mPhase === 2 && isEngaging && !isRetreating && stance !== 'fallback'
    && nearestEnemyX != null && nearestEnemyY != null
    && Math.hypot(nearestEnemyX - x, nearestEnemyY - y) < idealEngageDist * 0.6;
  
  // ============================================================
  // 1. 舰首转向计算（核心：原地转身协议）
  // ============================================================
  
  const dGoal = Math.abs(wrapAngle(targetHeading - motion.facingSmooth));
  const noProto = isRetreating || (isRetreating && isEngaging); // 拖刀例外
  
  // 掉头协议触发器（滞回进/出）
  const uturn = motion._uturn ?? false;
  const enterRad = 25 * Math.PI / 180; // 25°
  const exitRad = 12 * Math.PI / 180;  // 12°
  const newUturn = !noProto && (uturn ? dGoal > exitRad : dGoal > enterRad);
  
  // 转向纪律判定
  const minFleetDist = nearestEnemyX != null && nearestEnemyY != null
    ? Math.hypot(nearestEnemyX - x, nearestEnemyY - y)
    : Infinity;
  const td = turnDiscipline({
    engaged: minFleetDist < 250,
    disengaging: isRetreating || mPhase === 2,
    angleToTurn: dGoal,
    aggression,
  });
  
  let newFacingRate = motion.facingRate;
  let newFacing = motion.facingSmooth;
  
  if (newUturn) {
    // 协议期：快档、无惯量
    if (td.mode === 'denied') {
      // 交战中禁止大角度转向：保持航向
      newFacingRate = 0;
    } else {
      const rateMul = td.rateMul;
      const uStep = HEADING_TURN_RATE * 6 * rateMul * dt; // RATE_MUL = 6
      if (dGoal <= uStep) {
        newFacing = targetHeading;
        newFacingRate = 0;
      } else {
        newFacing += Math.sign(wrapAngle(targetHeading - motion.facingSmooth)) * uStep;
        newFacingRate = Math.sign(wrapAngle(targetHeading - motion.facingSmooth)) * uStep;
      }
    }
  } else if (dGoal <= HEADING_TURN_RATE * dt) {
    // 到达目标
    newFacing = targetHeading;
    newFacingRate = 0;
  } else {
    // 正常低通转向（带惯量和制动）
    const dF = wrapAngle(targetHeading - motion.facingSmooth);
    const rateAccel = TURN_RATE_ACCEL * dt;
    const brakeF = Math.sqrt(2 * rateAccel * BRAKE_SAFETY * Math.abs(dF));
    const wantF = Math.sign(dF) * Math.min(HEADING_TURN_RATE * dt, brakeF);
    newFacingRate += Math.max(-rateAccel, Math.min(rateAccel, wantF - motion.facingRate));
    newFacing += newFacingRate;
  }
  
  // ============================================================
  // 2. 推力计算（物理：主引擎只能沿舰首推进）
  // ============================================================
  
  // 推力对齐度 = cos(位移方向 - 舰首朝向)
  const actualMoveAngle = backing || (isRetreating && isEngaging) ? moveAngle : newFacing;
  const thrustAlign = Math.max(0, Math.cos(actualMoveAngle - newFacing));
  
  // 推力因子：协议期压死，交战中不压
  const thrustFactor = (isRetreating || backing)
    ? 1.0
    : (newUturn && !isEngaging ? 0.06 : THRUST_IDLE + (1 - THRUST_IDLE) * Math.sqrt(thrustAlign));
  
  // 基础速度计算
  const fleetBaseSpeed = (
    FLEET_BASE_SPEED * supplyFactor * moraleSpeedMul * retreatSpeedBonus * cpSpeedMul * thrustFactor * collapseSpeedMul
  );
  
  // ============================================================
  // 3. 速度向量计算
  // ============================================================
  
  let rawVX = 0, rawVY = 0;
  
  if (state === 'assembling' && distToTarget < 15) {
    // 集结完成：只受排斥力
    rawVX = repulseX * dt;
    rawVY = repulseY * dt;
  } else if (distToTarget < 5) {
    // 抵达目标：只受排斥力
    rawVX = repulseX * dt;
    rawVY = repulseY * dt;
  } else if (backing) {
    // 倒退脱离：朝脱离点倒退（速度 55%）
    const backSpeed = fleetBaseSpeed * 0.55;
    rawVX = (Math.cos(actualMoveAngle) * backSpeed * terrainSpeedMul + repulseX) * dt;
    rawVY = (Math.sin(actualMoveAngle) * backSpeed * terrainSpeedMul + repulseY) * dt;
  } else if (isEngaging && state !== 'flaring' && distToTarget < 120 && !isRetreating) {
    // 交战中：缓慢接近（0.05 px/帧）
    const engageSpeed = 0.05 * retreatSpeedBonus;
    rawVX = (Math.cos(actualMoveAngle) * engageSpeed + repulseX) * dt * congestionSlowdown;
    rawVY = (Math.sin(actualMoveAngle) * engageSpeed + repulseY) * dt * congestionSlowdown;
  } else if (stance !== 'defend') {
    // 正常移动
    rawVX = (Math.cos(actualMoveAngle) * fleetBaseSpeed * terrainSpeedMul + repulseX) * dt * congestionSlowdown;
    rawVY = (Math.sin(actualMoveAngle) * fleetBaseSpeed * terrainSpeedMul + repulseY) * dt * congestionSlowdown;
  }
  
  // ============================================================
  // 4. 惯性平滑（线速度）
  // ============================================================
  
  const desiredVX = rawVX, desiredVY = rawVY;
  const accel = Math.min(1, FLEET_ACCEL * dt);
  const newVx = motion.vx + (desiredVX - motion.vx) * accel;
  const newVy = motion.vy + (desiredVY - motion.vy) * accel;
  const newX = x + newVx;
  const newY = y + newVy;
  
  // ============================================================
  // 5. 阵型朝向管理（关键：只在协议退出时更新）
  // ============================================================
  
  let formFacing = motion.formFacing ?? newFacing;
  if (motion._uturn && !newUturn) {
    // 协议退出帧：阵型朝向一步阶跃到新舰首朝向
    formFacing = newFacing;
  }
  // 其他情况冻结（包括协议期内）
  
  return {
    newFacing,
    newX,
    newY,
    newVx,
    newVy,
    motion: {
      facingSmooth: newFacing,
      facingRate: newFacingRate,
      vx: newVx,
      vy: newVy,
      formFacing,
      _uturn: newUturn,
      _uturnJustEnded: motion._uturn && !newUturn,
    },
    debug: {
      thrustFactor,
      backing,
      uturn: newUturn,
      turnMode: td.mode,
    },
  };
}

// ============================================================
// E. 辅助函数
// ============================================================

/** 将角度差 wrap 到 [-π, π] */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** 角度逼近（带最大步长限制） */
export function approachAngle(cur: number, target: number, maxStep: number): number {
  let d = wrapAngle(target - cur);
  if (Math.abs(d) <= maxStep) return cur + d;
  return cur + Math.sign(d) * maxStep;
}
