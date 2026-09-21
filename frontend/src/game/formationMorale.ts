/**
 * formationMorale — 阵型崩溃状态机（v33 · 纯计算 · 无状态）
 *
 * 来源：旧案 44 图阵型表（`docs/design/loch-web-plan/01_*` §6.5）的一行：
 *   「崩溃 | 基本 | 无 | 近30中45远45 | 80% | — | — | **火力、回避、机动 −50%**」
 *
 * ── 关键概念澄清（实施前必须先读）───────────────────────────────────────
 * 旧案把「崩溃」与「纺锤/球型/凹型/包围」并列在**阵型表**里，是因为那张表按
 * **"当前状态"视角**列条目（同表的「无阵」也是"未编队"状态，不是可选阵型）。
 * 因此本项目**不把「崩溃」做成玩家可选阵型**，而是实现为**舰队状态**
 * （`fleet._formationCollapsed`）。
 *
 * ── 定位：补士气链的中间档 ───────────────────────────────────────────────
 * 既有链路（`retreatDoctrine`）：士气下降 → 三档撤退（disengage 1.3 / withdraw 2.0 / rout 3.0）。
 * 缺的是**"还没退、但已经打不动了"**这一档——旧案 -50% 正是它：
 *   士气 < `ENTER_MORALE`(40) 且兵力 < `ENTER_HP_FRAC`(60%)
 *     → 崩溃（火力/防御/机动 ×0.5）
 *     → 士气继续掉到 25 → 撤离；掉到 1 → 溃散
 * ⇒ 崩溃是**动摇了但仍在打**，撤退是**已经不想打了**。二者叠加时乘区会叠乘，
 *   这是期望行为（一支崩溃且正在撤离的舰队应该几乎无输出）。
 *
 * ── 三个触发源（与旧案一致）─────────────────────────────────────────────
 *   ① 士气 + 兵力态势
 *   ② **旗舰被击破**（旧案阵型表的「旗舰」列 = 风险与增益的交换；
 *      本项由 `BattleScene` 在旗舰沉没分支写入 `_flagshipSunkAt`）
 *   ③ 敌方特技「阵型崩溃」（旧案特技表：冷静 / 幽雅 施加，**棋手 防止**）
 * ③ 的防止通过 `resist`（0~1）实现：`resist >= 1` 完全免疫；部分抵抗则抬高士气阈值。
 */

import { FORMATION_COLLAPSE, TACTICAL_V33 } from '../config/balance';
import type { RetreatTier } from './retreatDoctrine';

export type CollapseReason = 'morale' | 'flagship' | 'rout' | 'skill' | null;

export interface CollapseEval {
  /** 当前士气 0–100 */
  morale: number;
  /** 兵力比例 0–1（= 总 HP / 总 maxHP） */
  hpPct: number;
  /** 本舰队旗舰被击沉的时间戳（ms；undefined = 旗舰健在） */
  flagshipSunkAt?: number;
  /** 当前撤退档位（`retreatDoctrine` 产物） */
  retreatTier?: RetreatTier;
  /** 特技抗性 0–1（来自 `skillEffects.computeCombatModifiers().collapseResist`） */
  resist?: number;
  /** 本帧被敌方特技施加崩溃（一次性外部信号） */
  forced?: boolean;
}

export interface CollapseResult {
  collapsed: boolean;
  reason: CollapseReason;
}

const KEEP: CollapseResult = { collapsed: false, reason: null };

/**
 * 推进崩溃状态。
 *
 * @param prev 上一帧的 `fleet._formationCollapsed`
 * @returns 本帧状态（写入 `fleet._formationCollapsed` / `fleet._collapseReason`）
 *
 * 设计要点：
 *   · **恢复门槛（RECOVER_MORALE 70）远高于进入门槛（ENTER_MORALE 40）**——
 *     故意做成强滞回，否则士气在 40 附近抖动会让乘区每帧翻转（"忽强忽弱"的观感 bug）。
 *   · `resist` 只作用于**士气触发**（抬高门槛）；旗舰沉没与溃散是**物理事件**，
 *     不因"阵型控制力强"而消失。
 */
export function updateFormationCollapse(prev: boolean, e: CollapseEval): CollapseResult {
  if (!TACTICAL_V33.FORMATION_COLLAPSE) return KEEP;
  const resist = Math.max(0, Math.min(1, e.resist ?? 0));
  if (resist >= 1) return KEEP;                          // 完全免疫（棋手类特技）

  // ── 已崩溃：只判恢复 ──
  if (prev) {
    if ((e.morale ?? 100) >= FORMATION_COLLAPSE.RECOVER_MORALE) return KEEP;
    return { collapsed: true, reason: 'morale' };
  }

  // ── 未崩溃：按严重度自高到低判进入 ──
  if (e.forced) return { collapsed: true, reason: 'skill' };
  if (FORMATION_COLLAPSE.ROUT_TRIGGERS && e.retreatTier === 'rout') return { collapsed: true, reason: 'rout' };
  if (FORMATION_COLLAPSE.FLAGSHIP_LOSS_TRIGGERS && e.flagshipSunkAt != null) {
    return { collapsed: true, reason: 'flagship' };
  }
  // 部分抵抗 ⇒ 抬高士气门槛（resist 0.5 → 门槛 20，更难崩）
  const moraleGate = FORMATION_COLLAPSE.ENTER_MORALE * (1 - resist);
  if ((e.morale ?? 100) < moraleGate && (e.hpPct ?? 1) < FORMATION_COLLAPSE.ENTER_HP_FRAC) {
    return { collapsed: true, reason: 'morale' };
  }
  return KEEP;
}

/** 崩溃时给 UI / 战报的可读文本。 */
export const COLLAPSE_REASON_TEXT: Record<Exclude<CollapseReason, null>, string> = {
  morale: '士气涣散',
  flagship: '旗舰沉没',
  rout: '全面溃散',
  skill: '敌方特技',
};

/** 崩溃状态 → 火力/防御/速度乘区（供 BattleScene 直接取）。 */
export function collapseMuls(collapsed: boolean): { fire: number; def: number; speed: number } {
  if (!collapsed || !TACTICAL_V33.FORMATION_COLLAPSE) return { fire: 1, def: 1, speed: 1 };
  return {
    fire: FORMATION_COLLAPSE.FIRE_MUL,
    def: FORMATION_COLLAPSE.DEF_MUL,
    speed: FORMATION_COLLAPSE.SPEED_MUL,
  };
}
