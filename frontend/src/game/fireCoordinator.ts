/**
 * fireCoordinator —— 舰队级火力协调（集火表 = 共享黑板）。
 *
 * 依据 29 号提案 §6.1/§7：集群 AI 不互相协商，而是订阅同一份"交战计划"——
 * 舰队级按威胁评分排出敌舰优先级，舰级选靶（clusterAI.pickShip）对表内目标加权。
 * 等价于"军长下达火力分配"，比集群协商协议便宜一个量级，且直接命中"缺乏应变"观感。
 *
 * ⚠ 本模块零实例状态；表的缓存（TTL / 换目标重建）由 BattleScene 侧以 fleet 字段承载。
 */

// ⚠ 无扩展名相对导入是 vite/vue-tsc（moduleResolution Node）标准写法；Node ESM 不做扩展名推断，
//   scripts/clusterAiSim.cjs 需在 require 前挂扩展名补全钩子（见该台架头部 registerHooks）。
import { scoreShipTarget, type ShipTargetCandidate } from './clusterAI';

/** 集火表深度：表内前三目标获得加权（权重见 clusterAI.SHIP_FOCUS_BONUS） */
export const FOCUS_TABLE_SIZE = 3;

export interface FocusEntry {
  id: string | number;
  /** 0 = 首要集火目标 */
  rank: number;
  score: number;
}

/**
 * 生成集火表：按与舰级选靶**同一评分函数**排序（dist 传 0 —— 同一敌舰队内各舰
 * 距离近似常数，排序只看威胁输出与补刀价值；focusRank 传 -1 防自我加权）。
 */
export function buildFocusTable(
  cands: readonly ShipTargetCandidate[],
  k: number = FOCUS_TABLE_SIZE,
): FocusEntry[] {
  if (!cands || cands.length === 0) return [];
  const scored = cands.map((c) => ({
    id: c.id,
    s: scoreShipTarget({ ...c, dist: 0, focusRank: -1 }),
  }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, Math.max(0, k)).map((e, i) => ({ id: e.id, rank: i, score: e.s }));
}
