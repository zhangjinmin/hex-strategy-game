/**
 * shipKinematics.ts — 舰种运动学表（30 号文档 §4.2）
 *
 * ============================================================================
 * 为什么需要这个模块
 * ============================================================================
 * 旧实现**五舰种在机动性上完全同质**：
 *   · 舰队级共享 FLEET_BASE_SPEED = 0.30（BattleScene:186）
 *   · 舰级共享 UNIT_MOTION_LIMITS（fleetKinematics.ts:223）
 *   · `u.speed`（战列 0.4 / 巡洋 0.5 / 驱逐 0.7 / 空母 0.35 / 舰载 1.2）
 *     在 BattleScene:1518 被解构后**在同函数内再未出现**，全项目仅两处引用
 *     （写入 :1580 / 报告 :1461）**均非运动学**。
 *
 * ⇒ 玩家没有理由偏好重舰或轻舰，因为它们 behave 一样。
 *
 * ============================================================================
 * 核心判据：转弯半径必须 > 舰长
 * ============================================================================
 * 旧值：R = v/ω = 0.30/(π/240) = **22.9px**，战列舰长 33px ⇒ **R/L = 0.69**。
 * 半径小于舰长在视觉上等价于「原地打转」，这是用户实报「移动很奇怪」的最直接一刀。
 *
 * 新表口径：R = v_max / ω_max，且**每舰种 R ≥ 1.0 L**（战列 1.8L）。
 * 掉头 180° 时舰首划过约 2πR 的弧线，肉眼可见一条大弯而不是原地扭头。
 *
 * ============================================================================
 * 与既有层的关系
 * ============================================================================
 * · 零 import（裁决层规格）
 * · 舰队级（`fleet.x/y/vx/vy/facingRate`）仍由 BattleScene 积分，但**参数改为按舰种加权**
 *   ⇒ 阶段 1（最小改动）可只改参数；阶段 2（每舰刚体）再把积分下沉到单位
 * · 舰级（`stepShipSlotFollow`）继续用 `UNIT_MOTION_LIMITS` 作为**槽位追踪**上限，
 *   不与本表冲突：本表管**舰队航行**，那个管**归位**
 */

// ══════════════════════════════════════════════════════════════════════
// A. 舰种运动学档案
// ══════════════════════════════════════════════════════════════════════

export interface ShipKinematics {
  /** 2D 贴图舰长（px）—— 半径比的分母。**必须与 BattleScene:1556-1560 的 shipLen 同源** */
  hullLen: number;
  /** 3D 真实舰长（m）—— 语义标注，不参与计算 */
  realLengthM: number;
  /** 巡航速度（px/帧@dt=1） */
  vMax: number;
  /** 满转角速率（rad/帧@dt=1） */
  omegaMax: number;
  /** 角加速度（rad/帧²）—— 决定转向建立的 sluggishness */
  alphaMax: number;
  /** 线加速度（px/帧²）—— 舰队级指数趋近的时间常数 τ = 1/accel 的倒数关系 */
  accel: number;
  /** 一句话定性（供 UI 提示与调试） */
  role: string;
}

/**
 * 舰种运动学表（唯一真源）。
 *
 * ⚠ 键名**必须严格等于** `config/gameData.ts` 的 baseStats 键
 *   （项目铁律：曾把 '空母' 写成 '航母' 导致计数恒 0）。
 *
 * ── 数值推导（R = v/ω 逐行自洽）────────────────────────────────────
 *  战列  R = 0.22/0.00367 = 60px = 1.82L  180°=14.3s  ← 重舰：掉头是一次决策
 *  高战  R = 0.28/0.00519 = 54px = 1.64L  180°=10.1s
 *  巡洋  R = 0.34/0.00895 = 38px = 1.52L  180°= 5.8s  ← 机动主力
 *  驱逐  R = 0.52/0.02364 = 22px = 1.22L  180°= 2.2s  ← 迂回是它的专属价值
 *  空母  R = 0.16/0.00182 = 88px = 2.10L  180°=28.8s  ← 战斗中几乎无法转向
 *  突击  R = 0.46/0.01095 = 42px = 1.27L  180°= 4.7s
 *  电子  R = 0.30/0.00789 = 38px = 1.52L  180°= 6.7s
 *  补给  R = 0.16/0.00160 = 100px= 2.50L  180°=31.0s  ← 极重，后勤核心
 *  舰载  R = 1.20/1.00    = 1.2px 特殊单位（跟随母舰，不独立归位）
 */
export const SHIP_KINEMATICS: Readonly<Record<string, ShipKinematics>> = Object.freeze({
  '战列': { hullLen: 33, realLengthM: 900,  vMax: 0.22, omegaMax: 0.00367, alphaMax: 0.00012, accel: 0.0060, role: '重舰·掉头需决策' },
  // ⚠ hullLen 严格对齐 BattleScene:1590 部署期真源「cls === '战列' || cls === '突击' → 33」
  '高战': { hullLen: 33, realLengthM: 760,  vMax: 0.28, omegaMax: 0.00519, alphaMax: 0.00018, accel: 0.0075, role: '高速战列·机动重舰' },
  '巡洋': { hullLen: 25, realLengthM: 570,  vMax: 0.34, omegaMax: 0.00895, alphaMax: 0.00032, accel: 0.0090, role: '机动主力' },
  '驱逐': { hullLen: 18, realLengthM: 260,  vMax: 0.52, omegaMax: 0.02364, alphaMax: 0.00090, accel: 0.0130, role: '快速迂回·不宜硬拼' },
  // ⚠ hullLen = 42：部署期空母走 isFlagship 分支（shipLen=42，BattleScene:1586-1588）
  '空母': { hullLen: 42, realLengthM: 1100, vMax: 0.16, omegaMax: 0.00182, alphaMax: 0.00006, accel: 0.0042, role: '几乎不能转向' },
  // ⚠ hullLen = 18：部署期「其余 → 18」兜底分支（BattleScene:1593）
  '舰载': { hullLen: 18, realLengthM: 180,  vMax: 1.20, omegaMax: 1.00000, alphaMax: 0.05000, accel: 0.0300, role: '特殊单位·随母舰' },
  '突击': { hullLen: 33, realLengthM: 520,  vMax: 0.46, omegaMax: 0.01095, alphaMax: 0.00040, accel: 0.0120, role: '高速突击' },
  '电子': { hullLen: 25, realLengthM: 480,  vMax: 0.30, omegaMax: 0.00789, alphaMax: 0.00028, accel: 0.0080, role: '支援' },
  '补给': { hullLen: 40, realLengthM: 1800, vMax: 0.16, omegaMax: 0.00160, alphaMax: 0.00005, accel: 0.0040, role: '极重·后勤核心' },
});

/** 兜底档案：未知舰种按巡洋处理（不做死代码，直接给可跑的中间值） */
export const DEFAULT_KINEMATICS: ShipKinematics = SHIP_KINEMATICS['巡洋'];

/** 部署期贴图尺寸真源（BattleScene:1556-1560 的口径，此处仅作交叉核对用） */
export const HULL_LEN_FROM_DEPLOY = Object.freeze({
  '战列': 33, '高战': 33, '突击': 33,   // BattleScene:1590 cls==='战列'||'突击' → 33
  '巡洋': 25, '电子': 25,                // BattleScene:1591 → 25
  '补给': 40,                // BattleScene:1592 → 40
  '空母': 42,                // BattleScene:1586-1588 isFlagship → 42
  '驱逐': 18, '舰载': 18, // BattleScene:1593 兜底 → 18
});

// ══════════════════════════════════════════════════════════════════════
// B. 查询
// ══════════════════════════════════════════════════════════════════════

export function kinematicsOf(classType: string | null | undefined): ShipKinematics {
  if (!classType) return DEFAULT_KINEMATICS;
  return SHIP_KINEMATICS[classType] || DEFAULT_KINEMATICS;
}

/** 转弯半径（px）= v/ω。台架与调试用。 */
export function turnRadius(k: ShipKinematics): number {
  return k.omegaMax > 0 ? k.vMax / k.omegaMax : Infinity;
}

/** 转弯半径比 R/L（核心判据，必须 ≥ 1.0）。 */
export function radiusRatio(k: ShipKinematics): number {
  return k.hullLen > 0 ? turnRadius(k) / k.hullLen : Infinity;
}

/** 180° 掉头耗时（秒@60fps）= π/ω × 60。 */
export function turn180Seconds(k: ShipKinematics): number {
  return k.omegaMax > 0 ? (Math.PI / k.omegaMax) * (1000 / 60) / 1000 : Infinity;
}

/** 0→95% 速度耗时（秒@60fps）。指数趋近 v += (vd−v)·a·dt ⇒ t95 = 3/a 帧。 */
export function speedRampSeconds(k: ShipKinematics): number {
  return k.accel > 0 ? (3 / k.accel) * (1000 / 60) / 1000 : Infinity;
}

// ══════════════════════════════════════════════════════════════════════
// C. 舰队级聚合
// ══════════════════════════════════════════════════════════════════════

export interface FleetKinematicsProfile {
  /** 加权巡航速度（按 hullLen² 加权 —— 大舰对fleet 机动贡献更大） */
  vMax: number;
  /** 加权角速率 */
  omegaMax: number;
  /** 加速度 */
  accel: number;
  /** 加权角加速度（rad/帧²）—— 决定转向建立的 sluggishness（τ = omegaMax/alphaMax） */
  alphaMax: number;
  /** 转向半径 */
  radius: number;
  /** 主导舰种（权重最大者） */
  dominantClass: string;
  /** 阵容是否异质（≥2 种不同 R/L 的战斗舰） */
  heterogeneous: boolean;
}

/** 空编队的兜底剖面（与旧 FLEET_BASE_SPEED 0.30 对齐，保证退化路径行为不突变） */
export const EMPTY_FLEET_PROFILE: FleetKinematicsProfile = Object.freeze({
  vMax: 0.22, omegaMax: 0.00367, accel: 0.0060, alphaMax: 0.00012, radius: 60,
  dominantClass: '战列', heterogeneous: false,
});

/**
 * 舰队运动学剖面 = 组成舰种的加权聚合。
 *
 * ⚠ 加权口径：按 `hullLen²`（面积/质量感）加权，而非算术平均。
 *   理由：一支 8 战列 + 2 驱逐的舰队，其"机动性格"应接近战列（重舰决定航迹），
 *   算术平均会让 2 驱逐把整体拉到"中速"，这正是旧实现"五舰种同质"的另一种表现。
 * ⚠ 排除 '补给'：运输舰不参与战斗机动（其极重参数会拖垮整队速度）。
 */
export function fleetProfile(units: readonly { classType?: string; hp?: number }[] | null | undefined): FleetKinematicsProfile {
  if (!units || units.length === 0) return EMPTY_FLEET_PROFILE;
  let sumW = 0, sumV = 0, sumW2 = 0, sumW3 = 0, sumW4 = 0;
  let bestW = -1, dominant = '战列';
  const seen = new Set<string>();
  for (const u of units) {
    const ct = u && u.classType;
    if (!ct || ct === '补给' || ct === '无') continue;
    if (u.hp !== undefined && u.hp <= 0) continue;   // 已沉没不参与
    const k = SHIP_KINEMATICS[ct];
    if (!k) continue;
    seen.add(ct);
    const w = k.hullLen * k.hullLen;      // 面积权重
    sumW += w;
    sumV += k.vMax * w;
    sumW2 += k.omegaMax * w;
    sumW3 += k.accel * w;
    sumW4 += k.alphaMax * w;
    if (w > bestW) { bestW = w; dominant = ct; }
  }
  if (sumW <= 0) return EMPTY_FLEET_PROFILE;
  const vMax = sumV / sumW;
  const omegaMax = sumW2 / sumW;
  return {
    vMax, omegaMax, accel: sumW3 / sumW, alphaMax: sumW4 / sumW,
    radius: omegaMax > 0 ? vMax / omegaMax : Infinity,
    dominantClass: dominant,
    heterogeneous: seen.size >= 2,
  };
}

// ══════════════════════════════════════════════════════════════════════
// D. 高速舵效衰减
// ══════════════════════════════════════════════════════════════════════

/** 高速时舵效/姿控功率不足 ⇒ 角速率上限下降。旧实现角速率与速度完全无关。 */
export const SPEED_STEER_PENALTY = 0.45;

/**
 * 速度相关的角速率上限。
 * @param k 舰种档案
 * @param speed 当前速度（px/帧）
 * @returns 有效 ω_max；全速时比静态值低 45%
 */
export function effectiveOmegaMax(k: ShipKinematics, speed: number): number {
  const ratio = k.vMax > 0 ? Math.min(1, Math.max(0, speed / k.vMax)) : 0;
  return k.omegaMax * (1 - SPEED_STEER_PENALTY * ratio);
}
