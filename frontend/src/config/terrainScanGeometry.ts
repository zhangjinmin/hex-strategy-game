/**
 * [v38] 地形扫描线的**纯几何**（不含 THREE / DOM 依赖）。
 *
 * 抽出来的唯一理由：本项目铁律要求「台架必须 `require` 真源码，不得复制常量」，
 * 而扫描线的正确性集中在两个纯函数上 —— **六边形水平弦**与**区间合并**。
 * 二者错了不会抛错，只会让扫描线画到格外面、或区域断成碎段（静默的视觉缺陷），
 * 因此必须能被 `_v38_scan_sim.cjs` 直接断言。
 *
 * ── 约定 ────────────────────────────────────────────────────────────
 * · 世界平面用 (x, z)，其中 `z = −(2D 的 y)`（3D 层统一口径）。
 * · 六边形 = **pointy-top**（有上下顶点），顶点角 `θ_k = (π/3)·k − π/6`，
 *   与 `Battle3DOverlay.buildTerrainZones` 的 `COS/SIN` 构造一致。
 */

/** √3/2：pointy-top 六边形"腰宽"与外接半径之比 */
export const HEX_WAIST_K = 0.8660254037844386;
/** √3：上下顶点收敛段的斜率 */
export const HEX_TIP_K = 1.7320508075688772;

/**
 * 六边形（外接半径 R、中心 z = 0）在水平线 `z = dz` 处的**弦半宽**。
 *
 * 闭式解，无需射线与边求交：
 *   `|dz| ≤ R/2` ⇒ `√3/2·R`（两条竖边之间的整宽，与 dz 无关）
 *   `R/2 < |dz| ≤ R` ⇒ `√3·(R − |dz|)`（向上下顶点线性收敛）
 *   `|dz| > R` ⇒ 0（线在格之外）
 *
 * 连续性自检：`dz = R/2` 时两式同为 `√3/2·R`；`dz = R` 时第二式为 0。
 */
export function hexChordHalfWidth(R: number, dz: number): number {
  const a = Math.abs(dz);
  if (a > R) return 0;
  if (a <= R * 0.5) return HEX_WAIST_K * R;
  return HEX_TIP_K * (R - a);
}

/**
 * 一维区间集合的**排序 + 合并**。
 *
 * `mergeGap` 是"区域感"的关键：设 0 则只合并真正重叠的区间，区域内的凹口会留下断口；
 * 给一点容差后，同一片空域的扫描线贯通成整条（形状由区域并集给出，而不是逐格）。
 *
 * @returns 合并后的区间（按 x0 升序），**不复用入参对象**（便于台架断言无副作用）
 */
export function mergeSpans(
  spans: ReadonlyArray<{ x0: number; x1: number }>,
  mergeGap: number,
): { x0: number; x1: number }[] {
  if (spans.length === 0) return [];
  const sorted = spans.slice().sort((p, q) => p.x0 - q.x0);
  const out: { x0: number; x1: number }[] = [];
  let cx0 = sorted[0].x0, cx1 = sorted[0].x1;
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    if (it.x0 <= cx1 + mergeGap) {
      if (it.x1 > cx1) cx1 = it.x1;
    } else {
      out.push({ x0: cx0, x1: cx1 });
      cx0 = it.x0; cx1 = it.x1;
    }
  }
  out.push({ x0: cx0, x1: cx1 });
  return out;
}

/**
 * 扫描线的起伏高度。
 * `phase` 逐扫描行推进 ⇒ 相邻线不同相 ⇒ 整片读作"一道波在区域里传播"；
 * 若全部同相，所有线会同步上下 ⇒ 读作"一块被抬起的板"，不是扫描线。
 */
export function scanLineY(x: number, lam: number, amp: number, phase: number, baseY: number): number {
  if (lam <= 0) return baseY;
  return baseY + amp * Math.sin((x / lam) * Math.PI * 2 + phase);
}

/**
 * 把一个长区间切成最多 `segMax` 段（每段长度不超过 `segLen`），以采样起伏。
 * 返回段数（≥1）。
 */
export function scanSegCount(len: number, segLen: number, segMax: number): number {
  if (segLen <= 0) return 1;
  return Math.max(1, Math.min(segMax, Math.ceil(len / segLen)));
}
