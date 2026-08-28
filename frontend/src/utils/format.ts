/**
 * format.ts — 金额与数字格式化工具（单一真源）
 *
 * 设计意图：
 *  - 千分位：金融 dashboard 的核心诉求，大数字必须按千分位分隔（1,234,567,890）
 *  - 缩写：面板空间受限时用「亿/万」缩写，但保留千分位的精确性语义
 *  - 统一货币符号 ₮（银英世界货币，与全局 gold 一致）
 */

/** 货币符号 */
export const CURRENCY = '₮';

/**
 * 完整千分位格式化（保留小数 0 位，四舍五入）。
 * 例：1234567890 → "1,234,567,890"；-50000 → "-50,000"
 */
export function formatGold(v: number): string {
  return Math.round(v || 0).toLocaleString('en-US');
}

/**
 * 带货币符号的完整千分位。
 * 例：1234567890 → "₮ 1,234,567,890"
 */
export function formatGoldCurrency(v: number): string {
  return `${CURRENCY} ${formatGold(v)}`;
}

/**
 * 中文缩写（亿/万），用于空间受限的紧凑场景。
 * 例：1234567890 → "12.3亿"；500000 → "50.0万"；9999 → "9,999"
 * 保留两位有效精度，避免误导。
 */
export function formatGoldShort(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)}亿`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}万`;
  return `${sign}${Math.floor(abs).toLocaleString('en-US')}`;
}

/**
 * 千分位 + 正负号（用于净收益等带方向的数值）。
 * 例：+50000 → "+50,000"；-12345 → "-12,345"
 */
export function formatSignedGold(v: number): string {
  const sign = v >= 0 ? '+' : '-';
  return `${sign}${formatGold(Math.abs(v))}`;
}

/**
 * 百分比（保留 0 位小数）。
 */
export function formatPercent(v: number): string {
  return `${Math.round(v)}%`;
}
