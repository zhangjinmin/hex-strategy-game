/**
 * 切片传送入场（家园2 式 hyperspace entry）—— **纯逻辑层**。
 *
 * 设计见 `docs/design/3d-tactical-battle/35-hyperspace-entry.md`。
 * 本文件**不依赖 three / phaser**（零 import）⇒ 可被两个消费方共用、也可被离线台架
 * `scripts/entryAnimationSim.cjs` 用 `stripTypeScriptTypes` + `new Function` **真跑**：
 *   · 2D 侧（`BattleScene.placeUnitsAtFormationSlots`）只取 `entryDelayForSlot`
 *     （按阵位索引错开的入场相位）；
 *   · 3D 侧（`Battle3DOverlay.updateEntryFx`）取平面推进 / 裁剪挂载 / 辉光包络。
 *
 * ── 为什么把"数学"独立成模块 ──────────────────────────────────────────────
 * 本项目 R1 教训：台架里 `block.includes('...')` 式断言**没有牙齿**（只对"整段删除"敏感，
 * 对取值/语义/行为完全不敏感，5 组变异全绿）。把行为**收敛到本模块的纯函数**后，
 * 台架可以直接执行源码、并用变异（改坏某个常量/分支）自检"断言真的能红"。
 *
 * ── 平面约定（务必与 three 的语义对齐）──────────────────────────────────────
 * three 的 `THREE.Plane(normal, constant)`：`distanceToPoint(p) = normal·p + constant`，
 * **distance < 0 的一侧被裁掉**。本模块取 `normal = (0, -dir, 0)`：
 *   `distance = -dir·y + constant`。
 *   · `dir = +1`：`constant = front` ⇒ 可见域 `y ≤ front`（`front` 从包围盒底 → 顶）
 *   · `dir = -1`：`constant = -front` ⇒ 可见域 `y ≥ front`（法线翻转，故常数取负）
 *   ⇒ 两种情况都可统一描述为"可见域 = **`front` 的一侧**，`front` 逐帧从包围盒一端扫到另一端"。
 * 于是 `t = 0` ⇒ `front` 在包围盒之外（全不可见）；`t = 总时长` ⇒ 全可见。
 * ⚠ `front` 是**世界 Y 坐标**（用于扫描面片定位）；写进 `plane.constant` 前必须过
 *   `entryPlaneConstant(front, dir)`（`dir < 0` 时取负），否则自上而下的扫描会**方向反了**。
 */

// ════════════════════════════════════════════════════════════════════════════
// 可调参数（全部集中此处，便于按真机截图迭代 —— 验收要求）
// ════════════════════════════════════════════════════════════════════════════

/** 切片扫描轴：世界 Y（垂直）—— 核磁共振式垂直切片。 */
export const SLICE_AXIS = 'y';
/** 扫描方向：+1 = 自下而上（舰体从下往上"升起"）；-1 = 自上而下（扫描仪式）。 */
export const SLICE_DIR = 1;
/** 单舰从"完全不可见"到"完全实体"的时长（秒）。 */
export const SLICE_DUR_PER_SHIP = 0.9;
/** 逐舰错开的总跨度（秒）—— 沿阵位排序铺开 ⇒ 波次感（不是所有船同时浮现）。 */
export const SLICE_SPREAD = 1.6;
/** 扫描辉光面片半径系数：半径 = 舰长 × 该值（0.35 ⇒ 辉光盘直径 ≈ 0.7×舰长）。 */
export const SLICE_GLOW_SPAN_K = 0.35;
/** 全场入场时长硬上限（秒）。**必须 ≤ `ASSEMBLE_MAX_MS`(4s)**，且不得改动那个常量。 */
export const SLICE_TOTAL_MAX = 3.5;
/** 舰体包围盒的垂直半跨系数：半跨 = 舰长 × 该值（保证平面扫过整个舰体高度）。 */
export const SLICE_HALF_SPAN_K = 0.75;
/** 入场登记窗口（秒）：只在该窗口内首次见到的单位才登记入场 ⇒ 后续（如迷雾发现、
 *  战后增援）不再触发"切片现身"，避免与既有 LOD/迷雾观感打架。 */
export const ENTRY_REG_WINDOW_SEC = 4.0;
/** 扫描辉光实例池上限（= `Battle3DOverlay.MAX_MESHES`；超出者只切不发光）。 */
export const ENTRY_GLOW_MAX = 900;
/** 一键关闭的**编译期**开关（默认 true）。运行时开关见 `window.__entryFxEnabled = false`。 */
export const SLICE_ENTRY_ENABLED_DEFAULT = true;

export interface EntryCfg {
  dir: number;
  durPerShip: number;
  spread: number;
  totalMax: number;
}

export const ENTRY_CFG_DEFAULT: EntryCfg = {
  dir: SLICE_DIR,
  durPerShip: SLICE_DUR_PER_SHIP,
  spread: SLICE_SPREAD,
  totalMax: SLICE_TOTAL_MAX,
};

/** 单舰入场状态（3D 侧 `entryStates` 的值）。 */
export interface EntryShip {
  /** 入场事件起点（秒，与 `performance.now()/1000` 同基准）—— 首次见到该单位的时刻。 */
  t0: number;
  /** 该舰的错开延迟（秒，相对 `t0`）。 */
  delay: number;
  /** 是否已完成（完成后调用方必须已清空 `clippingPlanes`）。 */
  done: boolean;
}

/** 单舰某时刻的切片相位（纯函数输出，调用方只负责"写"到材质/平面/辉光上）。 */
export interface EntryStep {
  /** true = 仍需裁剪；false = 已结束，调用方**必须清空 `clippingPlanes`**。 */
  active: boolean;
  /** 扫描先锋的**世界 Y 坐标**（仅 `active = true` 时有意义；写材质需过 `entryPlaneConstant`）。 */
  front: number;
  /** 扫描辉光强度 0..1（两端淡出，中段满亮）。 */
  glow: number;
}

// ════════════════════════════════════════════════════════════════════════════
// 1) 相位 / 时序
// ════════════════════════════════════════════════════════════════════════════

/**
 * 有效逐舰错开跨度：压缩 `spread` 使 `spread + durPerShip ≤ totalMax`。
 * 默认值下 = min(1.6, 3.5 − 0.9 = 2.6) = **1.6**（不压缩）。
 */
export function entrySpreadEffective(spread: number, durPerShip: number, totalMax: number): number {
  const room = Math.max(0, totalMax - durPerShip);
  return Math.max(0, Math.min(spread, room));
}

/** 全场入场总时长（秒）= 有效跨度 + 单舰时长。默认 1.6 + 0.9 = **2.5s**。 */
export function entryTotalSec(spread: number, durPerShip: number, totalMax: number): number {
  return durPerShip + entrySpreadEffective(spread, durPerShip, totalMax);
}

/**
 * 逐舰错开延迟（秒）：按**阵位索引**在 `[0, spread]` 上线性铺开 ⇒
 * 阵位序（前→后 / 左→右）即显现序 ⇒ "从一侧扫向另一侧"的波次感。
 * `count ≤ 1` ⇒ 0（单舰无错开）。
 */
export function entryDelayForSlot(slotIdx: number, count: number, spread: number): number {
  const n = Math.max(1, Math.floor(count));
  if (n <= 1) return 0;
  const s = Math.min(Math.max(Math.floor(slotIdx), 0), n - 1);
  return (s / (n - 1)) * Math.max(0, spread);
}

/** 单舰切片进度 `p ∈ [0, 1]`（0 = 完全不可见，1 = 完全实体）。 */
export function entryShipProgress(now: number, t0: number, delay: number, durPerShip: number): number {
  const dur = Math.max(1e-6, durPerShip);
  const p = (now - (t0 + Math.max(0, delay))) / dur;
  if (!(p > 0)) return 0;      // 含 NaN 兜底
  return p >= 1 ? 1 : p;
}

// ════════════════════════════════════════════════════════════════════════════
// 2) 平面几何
// ════════════════════════════════════════════════════════════════════════════

/** 三维裁剪平面的法线 Y 分量：`dir = +1 ⇒ -1`（此时 `constant = front`，可见域 `y ≤ front`）；
 *  `dir = -1 ⇒ +1`（此时 `constant = -front`，可见域 `y ≥ front`）。 */
export function entryPlaneNormalY(dir: number): number {
  return dir >= 0 ? -1 : 1;
}

/** 扫描先锋的**世界 Y 坐标**（可见域边界）：`p` 由 0→1 时从包围盒底 `yLo` 推到顶 `yHi`
 *  （`dir = +1`，舰体自下而上"升起"）；`dir = -1` 时反向（自上而下）。
 *  ⇒ `p = 0` 时 `front` 在包围盒**之外**（全舰被裁）；`p = 1` 时全舰可见。 */
export function entryPlaneFront(p: number, yLo: number, yHi: number, dir: number): number {
  const t = p <= 0 ? 0 : (p >= 1 ? 1 : p);
  return dir >= 0 ? yLo + (yHi - yLo) * t : yHi + (yLo - yHi) * t;
}

/** `front`（世界 Y 边界）→ `THREE.Plane.constant`：`dir < 0` 时法线翻转 ⇒ 常数取负。
 *  ⚠ 写材质前必须过本函数；扫描面片定位仍用 `front` 本身。 */
export function entryPlaneConstant(front: number, dir: number): number {
  return dir >= 0 ? front : -front;
}

/** 扫描辉光强度：两端 0、中段 1（15% 起落斜坡，避免"啪"地出现/消失）。 */
export function entryGlowAmt(p: number): number {
  if (!(p > 0) || p >= 1) return 0;
  const rise = Math.min(1, p / 0.15);
  const fall = Math.min(1, (1 - p) / 0.15);
  return Math.max(0, Math.min(rise, fall));
}

/** 单舰某一时刻的完整相位（纯函数）—— 3D 侧逐帧调用。 */
export function stepEntrySlice(
  now: number, st: EntryShip, yLo: number, yHi: number, cfg: EntryCfg,
): EntryStep {
  const p = entryShipProgress(now, st.t0, st.delay, cfg.durPerShip);
  if (p >= 1) return { active: false, front: entryPlaneFront(1, yLo, yHi, cfg.dir), glow: 0 };
  return {
    active: true,
    front: entryPlaneFront(p, yLo, yHi, cfg.dir),
    glow: entryGlowAmt(p),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 3) 写入侧（对 three 对象做**结构化**操作 ⇒ 台架可用普通对象直接执行）
// ════════════════════════════════════════════════════════════════════════════

/** 材质侧最小契约（`THREE.Material` 天然满足：其 `clippingPlanes: Plane[] | null` ⊆ `unknown`）。 */
export interface SliceMatLike {
  clippingPlanes: unknown;
}

/** 平面侧最小契约（`THREE.Plane.constant: number` 天然满足）。 */
export interface SlicePlaneLike {
  constant: number;
}

/**
 * 挂载 / 卸载裁剪平面。
 * ⚠ 只在**开始**与**结束**各调用一次（不要逐帧重赋）：three 的裁剪平面**数量**进 program
 *   cache key，数量变化会触发一次重编译；数量不变时逐帧重赋虽然不重编译，但没有必要。
 * `active = false` ⇒ 写 `null`（= 材质默认值，等价于"零裁剪平面"）。
 */
export function entryApplyClipping(mats: SliceMatLike[] | undefined, planes: unknown, active: boolean): void {
  if (!mats) return;
  const v = active ? planes : null;
  for (const m of mats) m.clippingPlanes = v;
}

/** 推进扫描平面的 `constant`（逐帧只改 `constant`，不重赋数组 ⇒ 不触发重编译）。
 *  ⚠ 入参是 `front`（世界 Y 边界），内部经 `entryPlaneConstant` 换算（`dir < 0` 取负）。 */
export function entryWritePlanes(planes: SlicePlaneLike[] | undefined, front: number, dir: number): void {
  if (!planes) return;
  const c = entryPlaneConstant(front, dir);
  for (const p of planes) p.constant = c;
}

/** 平面初始常数：置于舰队包围盒**之外** ⇒ 首帧（未推进前）全舰不可见。 */
export function entryPlaneInitConstant(dir: number): number {
  return entryPlaneConstant(entryPlaneFront(0, -1e6, 1e6, dir), dir);
}
