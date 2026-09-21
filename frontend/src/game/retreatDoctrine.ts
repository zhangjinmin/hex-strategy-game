/**
 * retreatDoctrine — 提督作战风格 + 撤退档位（纯计算模块 · 单一真源）
 *
 * 解决的问题（两条都是用户实报）：
 *   1. **提督军事风格标签从未生效**：`MILITARY_STYLE_PARAMS`（`config/tagConfig.ts`）定义了
 *      8 种风格 × {阵型偏好, 进攻系数, 撤退阈值}，但全项目**零引用** ⇒ 无论提督是谁，
 *      战场行为完全一致（"人物个性标签没有用到"）。
 *   2. **撤退由"补给度 < 30"这一与战局无关的硬阈值触发** ⇒ 交战到点即抛下敌人
 *      以 3 倍速掉头，且没有"缓慢撤退"过渡（用户原话"离谱"）。
 *
 * 模型（v29）：
 *   · **补给不再是撤退触发器**——改为影响「战斗力持续衰减」与「士气衰减速率」（消费侧在 BattleScene）。
 *   · **撤退由"提督动摇线（个性）+ 士气 + 兵力态势"触发**，分三档：
 *       disengage（脱离接触，边打边退，可被追击）→ withdraw（撤离）→ rout（溃散）。
 *   · **脱离时间**：进入撤退后需数秒才能升到全速——交战中不能一帧掉头。
 *
 * 本模块**纯计算、无状态、不碰渲染**：BattleScene 每帧调用，结果写入 `fleet._retreatTier`。
 */

import { MILITARY_STYLE_PARAMS } from '../config/tagConfig';
import type { MilitaryTag } from '../types/game';
import type { FormationType } from '../config/formations';

// ============================================================
// A. 提督作战风格（个性标签 → 战术参数）
// ============================================================

export interface AdmiralDoctrine {
  /** 命中的军事风格标签（无军事标签时为 null ⇒ 用中性默认） */
  styleTag: MilitaryTag | null;
  /** 该提督接敌时的默认阵型偏好（'flexible' 已归一化到 'line'，因其非合法阵型） */
  formation: FormationType;
  /** 进攻系数（1.0 = 中性；>1 更主动推进，<1 更保守） */
  attackMod: number;
  /** **动摇线**：兵力低于此比例且士气不高时进入撤退（0.15~0.45） */
  retreatThreshold: number;
}

/** 中性默认（提督无军事风格标签时）—— 与旧行为最接近，保证不引入"隐形难度" */
export const NEUTRAL_DOCTRINE: AdmiralDoctrine = {
  styleTag: null,
  formation: 'wedge',
  attackMod: 1.0,
  retreatThreshold: 0.30,
};

/**
 * 从提督标签解析作战风格。标签上限为 military: 2，**取首个命中的军事标签为主风格**
 * （顺序由标签数组给定；与 `TAG_LIMITS` 的设定一致）。
 * 无军事标签 → 中性默认（不报错、不退化）。
 */
export function resolveAdmiralDoctrine(tags?: readonly string[] | null): AdmiralDoctrine {
  if (!tags || tags.length === 0) return { ...NEUTRAL_DOCTRINE };
  for (const t of tags) {
    const p = MILITARY_STYLE_PARAMS[t as MilitaryTag];
    if (!p) continue;
    return {
      styleTag: t as MilitaryTag,
      // 'flexible' 不是合法 FormationType（formations.ts 仅 5 种）⇒ 归一到 'line'
      formation: (p.formation === 'flexible' ? 'line' : p.formation) as FormationType,
      attackMod: p.attackMod,
      retreatThreshold: p.retreatThreshold,
    };
  }
  return { ...NEUTRAL_DOCTRINE };
}

// ============================================================
// B. 撤退档位
// ============================================================

export type RetreatTier = 'none' | 'disengage' | 'withdraw' | 'rout';

export interface RetreatTierParams {
  /** 速度乘区（相对常规航速） */
  speedMul: number;
  /** 火力乘区（撤退中的输出，0 = 完全停火） */
  fireMul: number;
  /** 受击防御乘区（>1 = 更耐打；溃散时 0.5 = 更容易被收割） */
  defMul: number;
}

/**
 * 三档参数。**关键设计**：旧实现的 `retreatSpeedBonus = 3.0`（一帧掉头 ×3 速）
 * 在此**降级为 `rout`（溃散）专用**——只有士气彻底崩溃才会那样跑。
 */
export const RETREAT_TIER_PARAMS: Record<Exclude<RetreatTier, 'none'>, RetreatTierParams> = {
  /** 脱离接触：边打边退，保留大部分火力，**可被追击、可反打** */
  disengage: { speedMul: 1.3, fireMul: 0.70, defMul: 1.00 },
  /** 撤离：明确后撤，仍有自保能力 */
  withdraw: { speedMul: 2.0, fireMul: 0.40, defMul: 0.80 },
  /** 溃散：士气归零，只求脱离战场（旧 ×3.0 行为的唯一去处） */
  rout: { speedMul: 3.0, fireMul: 0.00, defMul: 0.50 },
};

const NEUTRAL_TIER_PARAMS: RetreatTierParams = { speedMul: 1.0, fireMul: 1.0, defMul: 1.0 };

export function retreatParams(tier: RetreatTier): RetreatTierParams {
  return tier === 'none' ? NEUTRAL_TIER_PARAMS : RETREAT_TIER_PARAMS[tier];
}

/** 士气低于此值 → 撤离档（不再恋战） */
export const WITHDRAW_MORALE = 25;
/** 士气低于此值 → 溃散（= 0 或濒临 0） */
export const ROUT_MORALE = 1;
/** 士气回升到此值**且**兵力回到动摇线以上 → 可退出撤退、重返战场 */
export const RALLY_MORALE = 70;
/** 兵力跌破此绝对线（无论提督个性）→ 至少进入撤离档 */
export const CRITICAL_HP_FRAC = 0.15;
/** 进入"脱离接触"还需士气低于此值——避免"兵力一低就退"变成新的硬开关 */
export const DISENGAGE_MORALE = 60;

export interface RetreatEval {
  /** 当前士气 0–100 */
  morale: number;
  /** 兵力比例 0–1（= 总 HP / 总 maxHP） */
  hpPct: number;
  /** 该提督的动摇线 0–1（来自 `resolveAdmiralDoctrine().retreatThreshold`） */
  threshold: number;
  /** 玩家手动撤退（stance='fallback'）或任务强制 */
  manual?: boolean;
}

/**
 * 士气 + 兵力态势 → 撤退档位。**这是替代 `currentSupply < 30` 的新判据**。
 * 判据自高到低（先判最严重者）：
 *   rout       ← 士气归零
 *   withdraw   ← 士气 < 25 / 兵力 < 15% / 手动撤退
 *   disengage  ← 兵力 < 该提督动摇线 **且** 士气 < 60（个性在此生效：谨慎 45% 就动摇，冒险 15% 才动摇）
 *   none       ← 其余
 */
export function resolveRetreatTier(e: RetreatEval): RetreatTier {
  if (e.manual) return 'withdraw';
  if (e.morale < ROUT_MORALE) return 'rout';
  if (e.morale < WITHDRAW_MORALE) return 'withdraw';
  if (e.hpPct < CRITICAL_HP_FRAC) return 'withdraw';
  if (e.hpPct < e.threshold && e.morale < DISENGAGE_MORALE) return 'disengage';
  return 'none';
}

// ============================================================
// C. 脱离时间（"缓慢撤退"的实现）
// ============================================================

/** 进入撤退后升到全速所需的"脱离时间"（秒）——交战中不能一帧掉头 */
export const DISENGAGE_RAMP_SEC = 3.5;

/**
 * 撤退速度乘区（含脱离时间过渡）。从 1.0 平滑升到该档目标乘区。
 * @param tier       当前撤退档位
 * @param elapsedSec 进入撤退后经过的秒数
 * 例外：`rout`（溃散）几乎没有纪律可言 ⇒ 立即脱离（ramp = 1），保留"雪崩"观感。
 */
export function retreatSpeedMulRamped(tier: RetreatTier, elapsedSec: number): number {
  if (tier === 'none') return 1.0;
  const target = RETREAT_TIER_PARAMS[tier].speedMul;
  const ramp = tier === 'rout'
    ? 1
    : Math.min(1, Math.max(0, elapsedSec / DISENGAGE_RAMP_SEC));
  return 1.0 + (target - 1.0) * ramp;
}

// ============================================================
// D. 补给 → 战斗力（连续衰减，替换旧的二值开关）
// ============================================================

/** 补给高于此比例 ⇒ 不减益（满状态） */
export const SUPPLY_FULL_PCT = 40;
/** 补给归零时的机动/战力乘区下限 */
export const SUPPLY_EMPTY_FACTOR = 0.55;

/**
 * 补给度 → 速度/战力乘区。旧实现是二值开关（`>30 → 1.0，否则 0.5`），
 * 在 30 处**断崖**；现改为连续：40% 以上不衰减，40%→0% 线性降到 0.55。
 * ⇒ 补给变成"越打越弱"的**资源**，而不是"过线就砍半"的**开关**。
 */
export function supplyFactor(supplyPct: number): number {
  if (supplyPct >= SUPPLY_FULL_PCT) return 1.0;
  return SUPPLY_EMPTY_FACTOR + (1.0 - SUPPLY_EMPTY_FACTOR) * (supplyPct / SUPPLY_FULL_PCT);
}

/** 断粮士气衰减：补给越低掉得越快（30% 附近 −1.0/帧，归零时 −2.0/帧）。旧实现恒为 −1.5。 */
export function moraleDrainPerTick(supplyPct: number): number {
  if (supplyPct >= 30) return 0;
  const severity = 1 - supplyPct / 30;   // 0（=30%）→ 1（=0%）
  return 1.0 + 1.0 * severity;
}
