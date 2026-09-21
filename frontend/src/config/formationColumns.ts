/**
 * formationColumns — 阵型「列位 × 距离带」派生层（v33 · 单一真源 · 纯计算）
 *
 * 来源：旧案 44 图《银英 WEB》阵型表（`docs/design/loch-web-plan/01_*` §6.5）的
 *   「前列 / 中列 / 后列 × 近火 / 中火 / 远火 / 舰载」矩阵 + 「配置（前 N 后 M）」「射角」两列。
 *
 * ── 本模块只做「读」，不做「改」────────────────────────────────────────────
 * 旧案的「配置（前3后1）」「旗舰位」「射角（近/中/远）」**都是对既有几何的读法**，
 * 不是新的几何需求：`formationLayout.formationOffsets()` 已返回 `[gx, gy]`，
 * 而 `gx` 就是前进轴（+ = 朝敌）。
 * ⇒ 「前列 / 中列 / 后列」= 对 `gx` 做区间三分。**`formationLayout.ts` 零改动**。
 *
 * 为什么必须零几何改动（本项目既有教训）：
 *   ① `formationLayout` 的格距/足迹上限/R2 分层是**调优过的复合体**，动一处牵连全队侧向剪影；
 *   ② [v31-D] 对称阵型（line/circle/square）掉头跳过阵位旋转，依赖"旋转下格位集合与自身重合"
 *      —— 给阵型引入前后不对称的几何改动会让"整体画圆"复发（用户反馈过 3 次）。
 *
 * ── 两个维度的独立性（这是本设计的关键，也是对原方案的修正）──────────────
 * 原方案（`02_*` §3.2）写成「按**单位自身**到敌距离查 band」。实施时发现这会导致**退化**：
 *   单位 —— 列位由几何决定（前列 ⟺ gx 最大 ⟺ 离敌最近），
 *   若 band 也由该单位自身距离决定，则**列位与距离带被构造性地绑死**
 *   （前列必落 near、后列必落 far）⇒ 矩阵两端全部命中最高值 ⇒ 退化成"全体同样加成"的常数。
 * 故改为：
 *   · **列位 = 单位级**（由阵型几何决定，固定不变）—— 玩家的**编制选择**；
 *   · **距离带 = 舰队级**（该舰队当前实距 / 其理想交战距）—— 战场的**态势**；
 * 两个维度因而正交：矩阵的语义变成「**在当前的接敌距离下，哪一列在吃红利**」，
 * 玩家的选择是"用什么阵型去接这个距离的仗"。
 *
 * ── 归一（保证不引入净增益）───────────────────────────────────────────────
 * 旧案矩阵三行均值不等（112.5 / 102.5 / 100），直接乘等于给全部单位隐性 +5%。
 * 故 `balance.COLUMN_MATRIX` 已按行归一，且消费侧的最终乘区还要除
 * `columnBaseline()` = **该阵型在近/中/远三档上的等权平均**
 * ⇒ 一个阵型在整场战斗中经过三档时的**期望乘区恒为 1.0**，
 *   矩阵只把"能否维持理想交战距"变成**阵型敏感项**（各阵型幅度不同）。
 */

import { COLUMN_MATRIX, RANGE_BAND, SHIP_BAND, TACTICAL_V33 } from './balance';
import { getShipPreferredBand } from './shipTacticalProfile';
import type { FormationCell } from './formationLayout';

/** 列位。`center` = 中心对称阵型（圆形/方阵）专用：无前后列之分，恒中性。 */
export type FormationColumn = 'front' | 'mid' | 'rear' | 'center';

/** 距离带（舰队级）。 */
export type RangeBand = 'near' | 'mid' | 'far';

/** 无前后轴、不给列位红利的几何（与 `BattleScene` 的 `_sym` 判定同源口径）。 */
const CENTER_SYMMETRIC = new Set(['circle', 'square']);

/**
 * 阵型几何 → 单位级列位数组（长度 = offsets.length，与 `slotIdx` 一一对应）。
 *
 * 三分规则：`ratio = (gx − gxMin) / (gxMax − gxMin)`，`gx` 为前进轴且 + 朝敌，
 * 故 `gx` 最大者 = 前列。用**实际极值**归一化，不假设 gx=0 就是最前——
 * `circle/square` 会出现正 gx（虽然它们走 `center` 分支，但未知阵型也走同一兜底）。
 *
 * 兜底（任一条件成立即整队 `center`，即不给列位红利）：
 *   · 中心对称阵型（circle/square）
 *   · 单排/单格（gxMax === gxMin）—— 没有纵深，谈"前后列"无意义
 *   · offsets 为空
 */
export function formationColumns(geometry: string, offsets: FormationCell[]): FormationColumn[] {
  const n = offsets.length;
  if (n === 0) return [];
  if (CENTER_SYMMETRIC.has(geometry)) return new Array<FormationColumn>(n).fill('center');

  let gxMin = Infinity; let gxMax = -Infinity;
  for (const [gx] of offsets) { if (gx < gxMin) gxMin = gx; if (gx > gxMax) gxMax = gx; }
  if (!(gxMax > gxMin)) return new Array<FormationColumn>(n).fill('center');

  const span = gxMax - gxMin;
  return offsets.map(([gx]) => {
    const ratio = (gx - gxMin) / span;
    if (ratio > 2 / 3) return 'front' as FormationColumn;
    if (ratio < 1 / 3) return 'rear' as FormationColumn;
    return 'mid' as FormationColumn;
  });
}

/** 列位分布（归一化权重）。分母恒为 n（保证 Σ = 1）。 */
export function columnWeights(columns: FormationColumn[]): Record<FormationColumn, number> {
  const w: Record<FormationColumn, number> = { front: 0, mid: 0, rear: 0, center: 0 };
  if (columns.length === 0) return w;
  for (const c of columns) w[c] += 1;
  const inv = 1 / columns.length;
  w.front *= inv; w.mid *= inv; w.rear *= inv; w.center *= inv;
  return w;
}

/** 阵型 × 兵力数 的列位侧写（可缓存产物）。 */
export interface ColumnProfile {
  columns: FormationColumn[];
  weights: Record<FormationColumn, number>;
  /** 火力维基准：该阵型在近/中/远三档上的**等权平均**乘区 */
  baseline: number;
  /** 舰载维基准（同上，取矩阵的 strike 分量） */
  baselineStrike: number;
}

/**
 * 由几何 + 格位表构建列位侧写。
 *
 * ⚠ 基准取「三档等权平均」而非「中档」或「最大值」：
 *   · 取中档 ⇒ 中距成为唯一的"不亏"档，且三档平均 > 1，等价于隐性加成；
 *   · 取最大 ⇒ 该阵型的最佳档不亏、其余全亏，同样给"必须站对距离"的硬约束；
 *   · 取等权平均 ⇒ **整场期望恒为 1.0**，零净增益，只留"档位敏感度"的差异。
 */
export function columnProfile(geometry: string, offsets: FormationCell[]): ColumnProfile {
  const columns = formationColumns(geometry, offsets);
  const weights = columnWeights(columns);
  const keys: FormationColumn[] = ['front', 'mid', 'rear', 'center'];
  let sumFire = 0; let sumStrike = 0;
  for (const band of ['near', 'mid', 'far'] as RangeBand[]) {
    for (const c of keys) {
      const cell = COLUMN_MATRIX[c];
      if (!cell) continue;
      sumFire += weights[c] * cell[band];
      sumStrike += weights[c] * cell.strike;
    }
  }
  return {
    columns,
    weights,
    baseline: Math.max(1e-6, sumFire / 3),
    baselineStrike: Math.max(1e-6, sumStrike / 3),
  };
}

/** (geometry, offsets) → 侧写的记忆化。offsets 数组是每舰队的稳定引用（`_formOffsets`）。 */
const PROFILE_CACHE = new WeakMap<FormationCell[], ColumnProfile>();
export function columnProfileCached(geometry: string, offsets: FormationCell[]): ColumnProfile {
  let p = PROFILE_CACHE.get(offsets);
  if (!p) { p = columnProfile(geometry, offsets); PROFILE_CACHE.set(offsets, p); }
  return p;
}

/**
 * 距离带（舰队级）。带**滞回**：单阈值会让"单位到敌距离逐帧跨越阈值"时伤害数字逐帧跳变
 * （观感 = 伤害忽大忽小，会被直接当成 bug）。
 *
 * @param d      该舰队到最近敌舰队的距离（px）
 * @param ideal  该舰队理想交战距（`BattleScene.getIdealEngageDist`，560~880）
 * @param prev   上一帧的档位（无状态调用可传 undefined）
 */
export function nextRangeBand(d: number, ideal: number, prev?: RangeBand): RangeBand {
  if (!(ideal > 0) || !Number.isFinite(d)) return prev ?? 'mid';
  const r = d / ideal;
  const enterNear = RANGE_BAND.ENTER_NEAR;
  const leaveNear = RANGE_BAND.ENTER_NEAR + RANGE_BAND.HYST_NEAR;
  const enterFar = RANGE_BAND.ENTER_FAR;
  const leaveFar = RANGE_BAND.ENTER_FAR - RANGE_BAND.HYST_FAR;

  if (prev === 'near') {
    if (r <= leaveNear) return 'near';
    if (r >= enterFar) return 'far';
    return 'mid';
  }
  if (prev === 'far') {
    if (r >= leaveFar) return 'far';
    if (r <= enterNear) return 'near';
    return 'mid';
  }
  if (r <= enterNear) return 'near';
  if (r >= enterFar) return 'far';
  return 'mid';
}

/**
 * 列位矩阵乘区（火力维）。**净增益恒 1.0**（见 `columnProfile` 注释）。
 * @param slotIdx 单位在阵型中的格位序号（= `u.formationSlot`，与 offsets 同序）
 */
export function columnMatrixMul(
  profile: ColumnProfile,
  slotIdx: number,
  band: RangeBand,
  strike = false,
): number {
  if (!TACTICAL_V33.COLUMN_MATRIX) return 1.0;
  const col = profile.columns[slotIdx];
  if (!col) return 1.0;                       // 越界槽位（n 变化中）→ 中性
  const cell = COLUMN_MATRIX[col];
  if (!cell) return 1.0;
  const base = strike ? profile.baselineStrike : profile.baseline;
  return (strike ? cell.strike : cell[band]) / base;
}

/**
 * 舰种偏好距离带乘区（P1-4.5）。
 * 旧案的「主炮 / 轨道炮 / 导弹」三武器槽不在现项目结构里，故只在**语义层**落地：
 * 每个舰种标注它最舒服的距离带，命中则 +5%、否则 −3% ⇒ 鼓励混编，但不碾压。
 */
export function shipBandMul(classType: string, band: RangeBand): number {
  if (!TACTICAL_V33.SHIP_BAND) return 1.0;
  const prefer = getShipPreferredBand(classType);
  if (!prefer || prefer.length === 0) return 1.0;   // 未登记舰种（运输/无）→ 中性
  return prefer.includes(band) ? SHIP_BAND.MATCH_MUL : SHIP_BAND.MISMATCH_MUL;
}
