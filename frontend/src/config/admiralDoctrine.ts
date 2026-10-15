/**
 * admiralDoctrine — 提督标准部队组成（纯数据 + 纯函数 · 零副作用）
 *
 * 解决的问题（用户原话）：**"选了提督，默认就带过来他的阵型配置和舰队组成"**。
 *   · 病灶 1：`BattleScene.initFactions` 的 `composition` 只看「军衔 + 阵营」
 *     （旧 `skirmishCompositionFor`）⇒ 同军衔同阵营的提督部队组成完全相同，提督本人不参与。
 *   · 病灶 3：`deck` 走 `simFullDeck` 硬编码 8 艘；`admInfo.deck` 全为空数组。
 *   ⇒ 本模块提供提督编制推导的**唯一入口** `resolveAdmiralComposition`（部队组成），
 *     以及**作战风格的唯一入口** `resolveAdmiralStyleTag`（阵型 formation 与组成 composition 共用）。
 *
 * 设计（定稿 docs/design/3d-tactical-battle/33-p2-spec.md §2）：
 *   · **两级推导**：`BASE_COMPOSITION_BY_FACTION`（帝国 = 巨舰大炮 / 同盟 = 空母放飞）
 *     × `STYLE_BIAS[styleTag]`（该提督军事风格的舰种权重）。
 *   · **覆盖表**：`ADMIRAL_COMPOSITION_OVERRIDES`（少数重点提督手工定制，权重口径）。
 *   · **优先级**：覆盖表 > 基准表 > 兜底；**军衔只改总量、不改比例**。
 *   · **阵型真源不在本模块**：`MILITARY_STYLE_PARAMS`（config/tagConfig.ts）仍是阵型的唯一真源，
 *     由 `retreatDoctrine.resolveAdmiralDoctrine(tags).formation` 提供；本模块只提供
 *     「该用**哪个军事风格标签**」的口径（`resolveAdmiralStyleTag`，标签优先 / 无标签用 stats 兜底）。
 *
 * ⚠ 本模块**只决定"部队组成的比例与总量"**，不碰任何战斗规则
 *   （classType / def / mods / 伤害公式 / AI 决策）—— 那是 P3。
 */

import type { MilitaryTag } from '../types/game';
// 提督标签 → 军事风格标签的**唯一解析口径**（`MILITARY_STYLE_PARAMS` 的唯一消费者）。
// 依赖方向：config/admiralDoctrine → game/retreatDoctrine → config/tagConfig → types（**无环**）。
import { resolveAdmiralDoctrine } from '../game/retreatDoctrine';

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 提督标准部队组成（兵力数；键与 `FleetComposition` / `totalsOfComposition` 兼容） */
export interface AdmiralFleetComposition {
  battleships: number;
  cruisers: number;
  destroyers: number;
  carriers?: number;
  fighters?: number;
  supplies: number;
}

export interface AdmiralCompositionInput {
  /** 阵营（'empire' | 'alliance' | …）；未知阵营走兜底（= 帝国基准） */
  faction: string;
  /** 军事风格标签（来自 `resolveAdmiralDoctrine(tags).styleTag`，可为 null） */
  styleTag: MilitaryTag | null;
  /** 军衔档位（决定规模；沿用 `skirmishMilRank` 的语义，≥8） */
  milRank: number;
  /** 提督 id（用于命中重点提督覆盖表；不传则跳过覆盖） */
  admiralId?: number;
}

/** 舰种权重（六种；用作"比例"，不是绝对兵力） */
type ShipWeights = {
  battleships: number;
  cruisers: number;
  destroyers: number;
  carriers: number;
  fighters: number;
  supplies: number;
};

const WEIGHT_KEYS: (keyof ShipWeights)[] = [
  'battleships', 'cruisers', 'destroyers', 'carriers', 'fighters', 'supplies',
];

// ────────────────────────────────────────────────────────────
// 基准表：阵营 → 舰种权重（"巨舰大炮" vs "空母放飞"）
// ────────────────────────────────────────────────────────────

/**
 * 阵营基准权重（未列出的阵营 → 走 `DEFAULT_FACTION_WEIGHTS` = 帝国基准）。
 *
 * ⚠ **[P2 · 缺口4 · 有意为之]** 本表**不含 `fastBattleships`（高速战列舰）** ⇒ 演习编制的
 *   `FleetComposition.fastBattleships` 恒为 0（`totalsOfComposition` 用 `|| 0` 兜底）。
 *   与旧 `gameStore.generateSimFullComposition`（帝国 rank10 = 高战 1200）相比，**帝国演习
 *   不再出厂高速战列舰**。理由（红队 B9 的处置选择 (b)，非疏漏）：
 *     ① P2 定稿接口（`docs/design/3d-tactical-battle/33-p2-spec.md` §2）的
 *        `AdmiralFleetComposition` 只含 6 类舰种，**高速战列舰是其省略，不是笔误**；
 *     ② 高速战列舰是「战列舰」的变体，本模块将其**归并进 `battleships`（巨舰大炮总量）**
 *        ——恢复独立权重会打破「基准表 × STYLE_BIAS」的 6 键同构（覆盖表 `unlisted = 0`
 *        的语义会让 3 个帝国重点提督反而丢掉高战），并扩大 P2 的修改面（防蔓延）；
 *     ③ `FACTION_SHIP_RESTRICTION` 本就对同盟禁用该舰种 ⇒ 它**从来不是对称基准**；
 *     ④ 影响面仅限**演习轨**（`BattleScene.initFactions` 的 composition 调用点）；战略轨
 *        （`gameStore.generateSimFullComposition`）仍保留高战 ⇒ 不是全局删除。
 *   该事实由 `scripts/admiralDoctrineSim.cjs` §6.11 固化（断言帝国/同盟基准均无高战键）。
 */
export const BASE_COMPOSITION_BY_FACTION: Record<string, ShipWeights> = {
  // 帝国：战列舰为绝对主力（巨舰大炮），空母/舰载仅作辅助
  empire:   { battleships: 5.0, cruisers: 3.0, destroyers: 1.5, carriers: 0.5, fighters: 0.5, supplies: 1.0 },
  // 同盟：空母 + 舰载机放飞为核心，战列舰比重显著低于帝国
  alliance: { battleships: 2.0, cruisers: 2.5, destroyers: 2.0, carriers: 2.0, fighters: 2.5, supplies: 1.0 },
};

const DEFAULT_FACTION_WEIGHTS: ShipWeights = { ...BASE_COMPOSITION_BY_FACTION.empire };

// ────────────────────────────────────────────────────────────
// 风格权重：军事风格 → 舰种权重乘区（只乘比例；缺项按 1 = 不改变基准）
// ────────────────────────────────────────────────────────────

/**
 * 8 种军事风格对舰种比例的乘区。缺项 = 1。
 * 方向与 `MILITARY_STYLE_PARAMS` 的语义对齐（如 `frontal_assault` → 战列↑、
 * `mobile_raid` → 驱逐↑、`logistics_focus` → 补给↑），但**阵型不由本表决定**。
 */
export const STYLE_BIAS: Record<MilitaryTag, Partial<ShipWeights>> = {
  frontal_assault: { battleships: 1.6, cruisers: 1.1, destroyers: 0.8, carriers: 0.9, fighters: 0.8 },
  counter_defense: { battleships: 1.3, cruisers: 1.2, destroyers: 0.9, carriers: 1.1, fighters: 1.1, supplies: 1.1 },
  firepower:       { battleships: 1.5, cruisers: 1.2, destroyers: 0.7, carriers: 1.0, fighters: 0.6 },
  mobile_raid:     { battleships: 0.6, cruisers: 1.1, destroyers: 2.0, carriers: 1.0, fighters: 1.5 },
  logistics_focus: { battleships: 1.0, cruisers: 1.1, destroyers: 0.9, carriers: 1.0, fighters: 0.9, supplies: 2.5 },
  intel_focus:     { battleships: 0.9, cruisers: 1.1, destroyers: 1.2, carriers: 1.3, fighters: 1.4, supplies: 1.1 },
  cautious:        { battleships: 1.2, cruisers: 1.3, destroyers: 1.0, carriers: 1.0, fighters: 0.9, supplies: 1.4 },
  aggressive:      { battleships: 1.4, cruisers: 0.9, destroyers: 1.5, carriers: 0.9, fighters: 1.3, supplies: 0.8 },
};

// ────────────────────────────────────────────────────────────
// 无军事标签提督的风格兜底（P2 缺口2：让 47.8% 的"白板"提督也有风格）
// ────────────────────────────────────────────────────────────

/** 提督能力值块（`admiralsData.stats` 结构）。`tactics` 是另一口径的大数值，本模块**不使用**。 */
export type AdmiralStatBlock = Partial<Record<
  'command' | 'operations' | 'intelligence' | 'mobility' | 'attack' | 'defense' | 'tactics',
  number
>>;

/**
 * 能力值 → 风格的映射规则。**顺序即并列时的优先级**（先出现者胜）。
 * `tactics` 故意缺席：它在 `admiralsData` 里量级为 500~3000，会恒压倒其余六维。
 */
export const STAT_STYLE_RULES: readonly { stat: keyof AdmiralStatBlock; tag: MilitaryTag }[] = [
  { stat: 'attack',       tag: 'aggressive' },        // 攻击最高 → 冒险突击
  { stat: 'mobility',     tag: 'mobile_raid' },       // 机动最高 → 机动突袭
  { stat: 'defense',      tag: 'counter_defense' },   // 防御最高 → 防守反击
  { stat: 'command',      tag: 'frontal_assault' },   // 统率最高 → 正面突击
  { stat: 'intelligence', tag: 'intel_focus' },       // 情报最高 → 情报重视
  { stat: 'operations',   tag: 'firepower' },         // 作战最高 → 火力压制
];

/**
 * ★ **能力值 → 军事风格**的兜底推导（**仅供无军事标签的提督**使用；有标签者一律优先）。
 *
 * 背景（P2 缺口2）：182 名提督中 87 名（47.8%）`resolveAdmiralDoctrine(tags).styleTag === null`
 *   ⇒ 其编制退化为纯阵营基准，同阵营同军衔者**仍完全相同**（全库 @milRank10 只有 22 种组成）。
 *
 * 规则：取 `STAT_STYLE_RULES` 中该提督**能力值最高**的一项对应风格。
 *   · **并列** → 按 `STAT_STYLE_RULES` 的固定顺序取先出现者 ⇒ **确定性**（同 stats ⇒ 同结果，**无随机**）。
 *   · 缺失/非法值按 `-Infinity` 处理；六维全缺 ⇒ 退回首条规则（`aggressive`），仍确定。
 *   · 纯函数：只读入参、不改入参、无副作用。
 */
export function deriveStyleTagFromStats(stats?: AdmiralStatBlock | null): MilitaryTag {
  let bestTag: MilitaryTag = STAT_STYLE_RULES[0].tag;
  let bestVal = -Infinity;
  for (const rule of STAT_STYLE_RULES) {
    const raw = stats ? stats[rule.stat] : undefined;
    const val = typeof raw === 'number' && Number.isFinite(raw) ? raw : -Infinity;
    if (val > bestVal) { bestVal = val; bestTag = rule.tag; }   // 严格 > ⇒ 并列保留先出现者
  }
  return bestTag;
}

/**
 * ★ 提督**有效风格**的唯一口径：**有军事标签者用标签，无标签者由能力值兜底**。
 *   供 `BattleScene.initFactions` 的两处 composition 调用点使用。
 *   `tagsResolvedStyleTag` 由调用方经 `resolveAdmiralDoctrine(tags).styleTag` 求得。
 *   **不改** `tags` 本身、**不改**任何其它行为（只决定 composition 的 styleTag 入参）。
 */
export function resolveEffectiveStyleTag(
  tagsResolvedStyleTag: MilitaryTag | null | undefined,
  stats?: AdmiralStatBlock | null,
): MilitaryTag {
  return tagsResolvedStyleTag ?? deriveStyleTagFromStats(stats);
}

/**
 * ★ **提督作战风格的唯一入口**：标签优先；无军事标签时由能力值（stats）兜底。
 *
 * 为什么还需要它（与 `resolveEffectiveStyleTag` 的分工）：
 *   · 本函数**直接吃 `tags`**（内部走 `resolveAdmiralDoctrine(tags).styleTag`）⇒ 是「提督是谁 →
 *     有效风格」的**端到端**口径；`resolveEffectiveStyleTag` 只吃"已解析出的标签"。
 *   · **`stats` 缺席时返回 `null`**（而非强行推导）⇒ 调用方回落 `resolveAdmiralDoctrine` 的中性
 *     口径（wedge）。这是**战役轨零变化**的关键：战役 faction 无 `admiralStats`/`admiralTags`
 *     （见 `BattleScene.buildCampaignEnvironment`），故其阵型与改动前**逐位相同**。
 *
 * P2 最后补救：此前 stats 兜底**只喂 composition、不喂 formation** ⇒ 87 名（47.8%）无标签提督的
 *   舰队组成已随 stats 分化（2→12 种），但**阵型仍恒为中性 wedge**。本函数把同一口径提升为
 *   **formation 与 composition 的共同真源**（`BattleScene.initFactions` 把结果写入 faction 的
 *   `admiralStyleTag` 字段，formation 站点再据此取 `resolveAdmiralDoctrine([tag]).formation`）。
 *
 * **有军事标签者行为不变**（标签优先 ⇒ formation 仍 = `MILITARY_STYLE_PARAMS[tag].formation`）。
 * 纯函数：只读入参、无副作用；确定性（并列按 `STAT_STYLE_RULES` 固定优先级）。
 */
export function resolveAdmiralStyleTag(
  tags: readonly string[] | null | undefined,
  stats?: AdmiralStatBlock | null,
): MilitaryTag | null {
  const fromTags = resolveAdmiralDoctrine(tags).styleTag;
  if (fromTags) return fromTags;
  return stats ? deriveStyleTagFromStats(stats) : null;
}

// ────────────────────────────────────────────────────────────
// 重点提督覆盖表（以"权重"给出比例；未列出的舰种 = 0 ⇒ 完全替代基准比例）
// ────────────────────────────────────────────────────────────

/**
 * 少数重点提督的手工定制（权重口径，与基准表同构）：
 *   只含"比例"信息，**总量仍由军衔决定**（见 `milRankTotal`）⇒ 不破坏
 *   "军衔只改总量不改比例"的契约，也不会让重点提督的舰队规模失真。
 * 其余提督全部走 `BASE × STYLE` 基准。
 */
export const ADMIRAL_COMPOSITION_OVERRIDES: Record<number, Partial<ShipWeights>> = {
  // 莱因哈特（元帅 · 帝国）：巨舰大炮 + 激进突击，战列舰压倒性比重
  81:  { battleships: 6.0, cruisers: 3.0, destroyers: 2.0, carriers: 1.0, fighters: 1.0, supplies: 1.0 },
  // 杨威利（少将 · 同盟）：空母放飞 + 机动谋略，舰载机与巡洋并重
  156: { battleships: 2.0, cruisers: 3.0, destroyers: 3.0, carriers: 3.0, fighters: 3.0, supplies: 1.5 },
  // 米达麦亚（中将 · 帝国）：高速机动突袭（"疾风之狼"），驱逐 / 巡洋为主
  80:  { battleships: 3.0, cruisers: 4.0, destroyers: 4.0, carriers: 1.0, fighters: 1.0, supplies: 1.0 },
  // 毕典菲尔特（中将 · 帝国）：正面突击，快速战列 + 驱逐强袭
  62:  { battleships: 6.0, cruisers: 2.0, destroyers: 3.0, carriers: 0.5, fighters: 0.5, supplies: 1.0 },
  // 亚典波罗（上校 · 同盟）：机动 + 火力，均衡的空母编队
  100: { battleships: 2.0, cruisers: 3.0, destroyers: 3.0, carriers: 2.0, fighters: 3.0, supplies: 1.0 },
};

// ────────────────────────────────────────────────────────────
// 军衔 → 编制总量（只改总量，不改比例）
// ────────────────────────────────────────────────────────────

/**
 * 军衔 → 编制总兵力。
 * 数值**镜像** `gameStore.generateSimFullComposition` 在各档位的 Σ
 * （5000 / 8000 / 12000 / 15000 / 18900 / 21000）——
 * 这样替换编制来源后，`skirmishEntityPlan` 推导的地图尺度与实体预算**不发生漂移**。
 */
export const MIL_RANK_TOTAL: Record<number, number> = {
  8: 5000, 9: 8000, 10: 12000, 11: 15000, 12: 18900, 13: 21000,
};

/** 军衔 → 总兵力（<8 归一到 8；≥13 归一到 13） */
export function milRankTotal(milRank: number): number {
  const r = Math.round(Number(milRank) || 0);
  if (r <= 8) return MIL_RANK_TOTAL[8];
  if (r >= 13) return MIL_RANK_TOTAL[13];
  return MIL_RANK_TOTAL[r];
}

// ────────────────────────────────────────────────────────────
// 推导
// ────────────────────────────────────────────────────────────

function baseWeightsFor(faction: string): ShipWeights {
  return { ...(BASE_COMPOSITION_BY_FACTION[faction] || DEFAULT_FACTION_WEIGHTS) };
}

function applyStyleBias(base: ShipWeights, styleTag: MilitaryTag | null): ShipWeights {
  const out: ShipWeights = { ...base };
  if (!styleTag) return out;
  const bias = STYLE_BIAS[styleTag];
  if (!bias) return out; // 未知标签 → 不改比例（不报错、不随机）
  for (const k of WEIGHT_KEYS) {
    const m = bias[k];
    if (typeof m === 'number' && m >= 0) out[k] = out[k] * m;
  }
  return out;
}

/** 权重 → 总量守恒的整数编制（最大余数法；Σ = total；确定性，无随机） */
function distributeByExactTotal(weights: ShipWeights, total: number): AdmiralFleetComposition {
  const sum = WEIGHT_KEYS.reduce((a, k) => a + Math.max(0, weights[k] || 0), 0);
  if (sum <= 0 || total <= 0) {
    return { battleships: 0, cruisers: 0, destroyers: 0, carriers: 0, fighters: 0, supplies: 0 };
  }
  const counts: ShipWeights = {
    battleships: 0, cruisers: 0, destroyers: 0, carriers: 0, fighters: 0, supplies: 0,
  };
  const fracs: { k: keyof ShipWeights; frac: number; idx: number }[] = [];
  let used = 0;
  WEIGHT_KEYS.forEach((k, idx) => {
    const exact = (Math.max(0, weights[k] || 0) / sum) * total;
    const base = Math.floor(exact);
    counts[k] = base;
    used += base;
    fracs.push({ k, frac: exact - base, idx });
  });
  let remainder = total - used;
  // 余数按小数部分从大到小分配；同分按键序 ⇒ 结果确定（无随机）
  fracs.sort((a, b) => (b.frac - a.frac) || (a.idx - b.idx));
  for (let i = 0; i < fracs.length && remainder > 0; i += 1) {
    counts[fracs[i].k] += 1;
    remainder -= 1;
  }
  return {
    battleships: counts.battleships,
    cruisers: counts.cruisers,
    destroyers: counts.destroyers,
    carriers: counts.carriers,
    fighters: counts.fighters,
    supplies: counts.supplies,
  };
}

/**
 * ★ 提督标准编制的**唯一入口**：覆盖表 > 基准表（faction × styleTag）> 兜底。
 * 纯函数：同输入 ⇒ 同输出（**无随机**）。总量由 `milRank` 决定，比例由阵营 × 风格（或覆盖表）决定。
 */
export function resolveAdmiralComposition(input: AdmiralCompositionInput): AdmiralFleetComposition {
  const total = milRankTotal(input.milRank);
  const override = input.admiralId != null ? ADMIRAL_COMPOSITION_OVERRIDES[input.admiralId] : undefined;

  let weights: ShipWeights;
  if (override) {
    // 覆盖表 = 完整比例替代（未列出舰种权重为 0）
    weights = { battleships: 0, cruisers: 0, destroyers: 0, carriers: 0, fighters: 0, supplies: 0 };
    for (const k of WEIGHT_KEYS) {
      const v = override[k];
      if (typeof v === 'number' && v > 0) weights[k] = v;
    }
    // 非法覆盖（全 0）→ 回落基准，保证不产生空编制
    if (WEIGHT_KEYS.every((k) => weights[k] <= 0)) {
      weights = applyStyleBias(baseWeightsFor(input.faction), input.styleTag);
    }
  } else {
    weights = applyStyleBias(baseWeightsFor(input.faction), input.styleTag);
  }

  return distributeByExactTotal(weights, total);
}
