/**
 * SectorSweep.ts — 搜索扇区的**纯几何**（四航点 + 扇区分配 + 稳定哈希）
 *
 * ============================================================================
 * 本模块做什么 / 不做什么
 * ============================================================================
 * · **做**：给定 `origin / clueBearing / R / sectorIndex`，算出四个航点；
 *   给定 `fleetId`，确定性地分配扇区（0 / 1 / 2）。
 * · **不做**：**tier 阶梯**（`R0 → 1.35R0 → 1.7R0` 的搜索升级）由「搜索升级半径」切片
 *   （spec §C5）实现，涉及 `_searchTier` 状态与 `STALEMATE_MS` 兜底。
 *   ⇒ 本模块只提供"**给定 R 的几何**"；读代码时不要以为扫掠半径是固定的。
 *   ⚠ 引用切片时**必须带语义名**（字母只是辅助）—— 本轮切片编号已重排过三次，
 *     只写字母的注释会在下次重排后指向错误的地方。
 * · **纯几何**：无随机、无时间、无抖动。同一入参必须逐位相等（台架 S3-01）。
 *
 * ============================================================================
 * 为什么必须是纯几何（不要加"微抖动"）
 * ============================================================================
 * 曾考虑给航点加 `jitter × 0.15R` 让多次搜索不完全重合，但那会让
 * `|WP0 − origin| = 0.45R` 变成 `hypot(0.45R, jitter)`
 * ⇒ **几何就不再能被精确断言检查**（只能退化成"大概在那个方向"）。
 * ⇒ 覆盖率的增长由 **tier 阶梯**承担，而不是靠抖动。
 *
 * ============================================================================
 * 航点序列（按规格）
 * ============================================================================
 *   WP0 = origin + axis(0.45R)        axis = clueBearing + sectorOffset
 *                                     sectorOffset：1 → 0°、0 → −25°、2 → +25°
 *   WP1 = WP0 + lateral(+0.5R)
 *   WP2 = WP1 + lateral(−1.0R)        ⇒ |WP2 − WP1| = 1.0R（横向全宽）
 *   WP3 = WP2 + lateral(+0.5R)        ⇒ |WP3 − WP2| = 0.5R（回轴）
 *
 * ⚠ **代数退化（有意，不是算错）**：
 *   `WP1 = WP0 + L/2`、`WP2 = WP1 − L = WP0 − L/2`、`WP3 = WP2 + L/2 = **WP0**`
 *   ⇒ 序列 `0 → 1 → 2 → 3` 实际是 `0 → 1 → 2 → 0`。
 *   本设计是「**单点周围横线往返 + tier 扩大半径**」，不是「沿走廊逐行推进」
 *   —— 所以往返净位移为 0 是正确的。
 *   若将来要改成推进式，序列必须**单调**（0→1→2→3→4…），而不是往返（0→1→2→3→2→1→0）。
 */

export interface SweepPoint {
  x: number;
  y: number;
}

export interface SweepAim {
  /** 扇区：0 → −25°、1 → 0°、2 → +25°（相对 clueBearing） */
  sectorIndex: number;
  origin: SweepPoint;
  /** 线索方位（rad） */
  clueBearing: number;
  /** 本级的搜索半径（tier 阶梯由「搜索升级半径」切片 §C5 传入，本模块不负责升级） */
  R: number;
}

/** 三个扇区相对线索方位的偏移（rad）。索引即 sectorIndex。 */
export const SECTOR_OFFSET_RAD: readonly number[] = Object.freeze([
  (-25 * Math.PI) / 180,
  0,
  (25 * Math.PI) / 180,
]);

/** 航点比例（相对 R）—— 台架按这些比例断言，改动即视为几何变更。 */
export const SWEEP_GEOMETRY = Object.freeze({
  /** 首段前出距离 */
  legOut: 0.45,
  /** 横向半宽（WP0→WP1） */
  halfWidth: 0.5,
  /** 横向全宽（WP1→WP2） */
  fullWidth: 1.0,
  /** 回轴（WP2→WP3） */
  legBack: 0.5,
});

/**
 * 四航点（纯函数）。
 * ⚠ `WP3` 与 `WP0` **代数相等**（见文件头"代数退化"），这是规格行为。
 */
export function sweepWaypoints(aim: SweepAim): SweepPoint[] {
  const origin = aim.origin;
  const R = Number.isFinite(aim.R) ? aim.R : 0;
  const offset = SECTOR_OFFSET_RAD[aim.sectorIndex] ?? 0;
  const bearing = (Number.isFinite(aim.clueBearing) ? aim.clueBearing : 0) + offset;

  const ax = Math.cos(bearing);
  const ay = Math.sin(bearing);
  // lateral = axis 逆时针旋转 90°（+90°），保证与 axis 严格正交
  const lx = -ay;
  const ly = ax;

  const out = R * SWEEP_GEOMETRY.legOut;
  const half = R * SWEEP_GEOMETRY.halfWidth;
  const full = R * SWEEP_GEOMETRY.fullWidth;
  const back = R * SWEEP_GEOMETRY.legBack;

  const wp0 = { x: origin.x + ax * out, y: origin.y + ay * out };
  const wp1 = { x: wp0.x + lx * half, y: wp0.y + ly * half };
  const wp2 = { x: wp1.x - lx * full, y: wp1.y - ly * full };
  const wp3 = { x: wp2.x + lx * back, y: wp2.y + ly * back };

  return [wp0, wp1, wp2, wp3];
}

/**
 * 稳定 32 位哈希（FNV-1a over 各参数的 4 字节小端表示）。
 *
 * ⚠ **刻意不导出**：只服务本文件的 `defaultSectorIndex`。
 *   导出它等于邀请别处做「第二套派生」—— 函数仍只有一份，但两种用法会各自演化出
 *   对参数含义的不同假设（A 处传 `(fleetId, sector, leg)`、B 处传 `(fleetId, 0, 0)`，
 *   签名上看不出区别）⇒ 这是比"重复实现"更隐蔽的分裂。
 * ⚠ **纯函数**：同入参恒同输出，**禁止**引入 `Date.now()` / `Math.random()` /
 *   `performance.now()` —— "确定性"是它存在的全部价值
 *   （台架 S3-03 通过 `defaultSectorIndex` 的重复调用间接锁这一点）。
 * ⚠ 非有限值（NaN / Infinity）统一按 0 处理：不抛错、不产生分叉。
 */
function stableHash32(...parts: number[]): number {
  let h = 0x811c9dc5 >>> 0;
  for (const p of parts) {
    const v = Number.isFinite(p) ? (Math.trunc(p) | 0) : 0;
    for (let i = 0; i < 4; i += 1) {
      h ^= (v >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/**
 * 舰队 → 默认搜索扇区（0 / 1 / 2），确定性分配。
 * ⚠ 只做**分派**，不做"哪个扇区更可能有敌人"的判断（那是情报层的职责）。
 */
export function defaultSectorIndex(fleetId: number): 0 | 1 | 2 {
  return (stableHash32(fleetId, 0x5eed) % 3) as 0 | 1 | 2;
}
