// ==================================================
// File: src/utils/tagMigration.ts
// 数据迁移引擎：hiddenStats→tags 映射、存档兼容、关键人物标签表
// ==================================================

import type { AdmiralTag, PoliticalTag, MilitaryTag, PersonalityTag, AbilityTag } from '../types/game';
import type { BaseAdmiral } from '../config/admiralsData';
import { TAG_LIMITS, MAX_TAGS_PER_ADMIRAL } from '../config/tagConfig';

// ─── 30 关键人物标签表（手动标注，覆盖主要剧情人物与各舰队司令） ───
// 关键人物优先使用此表，不依赖自动迁移，确保标签与原著设定一致
export const KEY_CHARACTER_TAGS: Record<number, AdmiralTag[]> = {
  // ===== 核心人物（9 人）=====
  81:  ['ambition_faction', 'high_charisma', 'high_iq', 'tactician', 'aggressive'],  // 莱因哈特
  82:  ['aristocrat', 'cautious', 'counter_defense', 'administrator'],                   // 谬肯贝尔加
  156: ['democrat', 'high_iq', 'idealist', 'strategist', 'mobile_raid', 'cautious'],                 // 杨威利
  10:  ['reformer', 'ruthless', 'high_iq', 'strategist', 'intel_focus'],                   // 奥贝斯坦
  181: ['royalist', 'opportunist', 'realist'],                                         // 佛瑞德李希四世
  7:   ['royalist', 'administrator', 'cautious'],                                                     // 艾伦博克
  34:  ['royalist', 'strategist', 'logistics_focus', 'high_iq'],                                       // 斯坦赫夫
  164: ['democrat', 'cautious', 'counter_defense', 'administrator'],                                  // 罗波斯
  165: ['democrat', 'politician', 'realist'],                                                         // 同盟最高评议会

  // ===== 帝国舰队司令（12 人）=====
  0:   ['militarist', 'frontal_assault', 'ruthless'],                                                 // 艾齐纳哈
  15:  ['royalist', 'high_charisma', 'righteous', 'tactician'],                                       // 吉尔菲艾斯
  29:  ['militarist', 'frontal_assault', 'aggressive'],                                               // 坎普
  62:  ['militarist', 'frontal_assault', 'aggressive'],                                               // 毕典菲尔特
  65:  ['militarist', 'mobile_raid', 'aggressive'],                                                   // 法伦海特
  71:  ['aristocrat', 'opportunist'],                                                                 // 布朗胥百克
  80:  ['militarist', 'mobile_raid', 'high_iq', 'tactician'],                                         // 米达麦亚
  84:  ['militarist', 'logistics_focus', 'high_iq', 'strategist'],                                    // 梅克林格
  85:  ['royalist', 'counter_defense', 'righteous', 'tactician'],                                     // 梅尔卡兹
  97:  ['militarist', 'frontal_assault', 'ruthless'],                                                 // 连内肯普
  98:  ['ambition_faction', 'high_iq', 'tactician', 'aggressive'],                                    // 罗严塔尔
  99:  ['militarist', 'counter_defense', 'righteous'],                                                // 瓦列

  // ===== 同盟舰队司令（9 人）=====
  101: ['democrat', 'frontal_assault'],                                                               // 阿普顿
  103: ['democrat', 'firepower'],                                                                     // 亚尔·沙列姆
  106: ['democrat', 'frontal_assault', 'aggressive'],                                                 // 伍兰夫
  113: ['democrat', 'counter_defense', 'administrator'],                                              // 库布斯里
  136: ['democrat', 'righteous', 'tactician'],                                                        // 比克古
  147: ['democrat', 'firepower'],                                                                     // 赫伍得
  149: ['democrat', 'mobile_raid'],                                                                   // 波罗汀
  161: ['democrat', 'counter_defense', 'cautious'],                                                   // 鲁格拉希
  162: ['democrat', 'firepower', 'cautious'],                                                         // 路菲普
};

// ─── 互斥标签对快速查询（用于自动迁移时避免冲突） ───
const MUTUAL_EXCLUSION_PAIRS: [AdmiralTag, AdmiralTag][] = [
  ['cautious', 'aggressive'],
  ['frontal_assault', 'mobile_raid'],
  ['ruthless', 'righteous'],
  ['idealist', 'realist'],
];

/**
 * 移除互斥冲突标签：当两个互斥标签同时存在时，保留先出现的那个
 * @param tags 待清洗的标签数组
 * @returns 无互斥冲突的标签数组
 */
function removeMutualExclusionConflicts(tags: AdmiralTag[]): AdmiralTag[] {
  const result: AdmiralTag[] = [];
  for (const tag of tags) {
    const conflictPair = MUTUAL_EXCLUSION_PAIRS.find(
      ([a, b]) => (a === tag && result.includes(b)) || (b === tag && result.includes(a))
    );
    if (!conflictPair) {
      result.push(tag);
    }
  }
  return result;
}

/**
 * 将 hiddenStats + stats 数值映射为标签数组（自动迁移）
 *
 * 迁移规则：
 * 1. 若 admiral.id 在 KEY_CHARACTER_TAGS 中，直接返回手动标注值
 * 2. 否则基于 hiddenStats 和 stats 数值自动推导标签
 * 3. 自动推导的标签确保通过 validateTags（无互斥冲突、不超分类上限）
 *
 * @param admiral 提督数据（必须含 hiddenStats 和 stats）
 * @returns 标签数组（最多 6 个，无互斥冲突）
 */
export function migrateHiddenStatsToTags(admiral: BaseAdmiral): AdmiralTag[] {
  // 1. 关键人物优先返回手动标注
  const keyTags = KEY_CHARACTER_TAGS[admiral.id];
  if (keyTags) {
    return [...keyTags];
  }

  const { hiddenStats, stats, faction } = admiral;
  const tags: AdmiralTag[] = [];

  // === 政治标签（最多 1 个） ===
  const politicalTag = derivePoliticalTag(hiddenStats, faction);
  if (politicalTag) {
    tags.push(politicalTag);
  }

  // === 军事标签（最多 2 个） ===
  const militaryTags = deriveMilitaryTags(stats, hiddenStats);
  tags.push(...militaryTags);

  // === 人格标签（最多 2 个） ===
  const personalityTags = derivePersonalityTags(stats, hiddenStats);
  tags.push(...personalityTags);

  // === 能力标签（最多 1 个） ===
  const abilityTag = deriveAbilityTag(stats, hiddenStats);
  if (abilityTag) {
    tags.push(abilityTag);
  }

  // === 清洗互斥冲突 ===
  const cleanedTags = removeMutualExclusionConflicts(tags);

  // === 截断到上限 6 个 ===
  return cleanedTags.slice(0, MAX_TAGS_PER_ADMIRAL);
}

/**
 * 根据 hiddenStats 和阵营推导政治标签
 */
function derivePoliticalTag(
  hiddenStats: { ambition: number; righteousness: number; compatibility: number },
  faction: 'empire' | 'alliance'
): PoliticalTag | null {
  if (hiddenStats.ambition >= 85) {
    return 'ambition_faction';
  }
  if (faction === 'alliance' && hiddenStats.righteousness >= 70) {
    return 'democrat';
  }
  if (faction === 'empire' && hiddenStats.righteousness >= 60 && hiddenStats.ambition < 50) {
    return 'royalist';
  }
  if (faction === 'empire' && hiddenStats.ambition >= 70 && hiddenStats.righteousness < 45) {
    return 'militarist';
  }
  if (faction === 'empire' && hiddenStats.righteousness < 40 && hiddenStats.ambition < 60) {
    return 'aristocrat';
  }
  if (hiddenStats.ambition >= 60 && hiddenStats.righteousness >= 50) {
    return 'reformer';
  }
  if (hiddenStats.ambition < 35) {
    return 'pacifist';
  }
  return null;
}

/**
 * 根据 stats 推导军事风格标签（最多 2 个，无互斥冲突）
 */
function deriveMilitaryTags(
  stats: BaseAdmiral['stats'],
  hiddenStats: { ambition: number; righteousness: number; compatibility: number }
): MilitaryTag[] {
  const tags: MilitaryTag[] = [];

  // 攻击型标签
  if (stats.attack >= 85 && stats.mobility >= 75) {
    tags.push('mobile_raid');
  } else if (stats.attack >= 85) {
    tags.push('frontal_assault');
  } else if (stats.defense >= 85) {
    tags.push('counter_defense');
  }

  // 辅助型标签
  if (tags.length < 2) {
    if (stats.operations >= 80) {
      tags.push('logistics_focus');
    } else if (stats.intelligence >= 80) {
      tags.push('intel_focus');
    } else if (stats.attack >= 75 && stats.defense >= 75) {
      tags.push('firepower');
    }
  }

  // 性格型军事标签
  if (tags.length < 2) {
    if (hiddenStats.righteousness >= 70) {
      tags.push('cautious');
    } else if (hiddenStats.righteousness < 40) {
      tags.push('aggressive');
    }
  }

  // 清除互斥冲突
  const cleaned = removeMutualExclusionConflicts(tags) as MilitaryTag[];
  return cleaned.slice(0, TAG_LIMITS.military);
}

/**
 * 根据 stats 和 hiddenStats 推导人格特质标签（最多 2 个，无互斥冲突）
 */
function derivePersonalityTags(
  stats: BaseAdmiral['stats'],
  hiddenStats: { ambition: number; righteousness: number; compatibility: number }
): PersonalityTag[] {
  const tags: PersonalityTag[] = [];

  // 智力型
  if (stats.command >= 85 || stats.intelligence >= 85) {
    tags.push('high_iq');
  }

  // 人际型
  if (hiddenStats.compatibility >= 75) {
    tags.push('high_eq');
  }

  // 道德型
  if (tags.length < 2) {
    if (hiddenStats.righteousness >= 80) {
      tags.push('righteous');
    } else if (hiddenStats.righteousness < 35) {
      tags.push('ruthless');
    }
  }

  // 价值观型
  if (tags.length < 2) {
    if (hiddenStats.ambition >= 75 && hiddenStats.righteousness < 50) {
      tags.push('opportunist');
    } else if (hiddenStats.righteousness >= 60 && hiddenStats.ambition < 45) {
      tags.push('idealist');
    } else {
      tags.push('realist');
    }
  }

  // 清除互斥冲突
  const cleaned = removeMutualExclusionConflicts(tags) as PersonalityTag[];
  return cleaned.slice(0, TAG_LIMITS.personality);
}

/**
 * 根据 stats 推导能力倾向标签（最多 1 个）
 */
function deriveAbilityTag(
  stats: BaseAdmiral['stats'],
  hiddenStats: { ambition: number; righteousness: number; compatibility: number }
): AbilityTag | null {
  if (stats.command >= 80 && stats.attack >= 80) {
    return 'tactician';
  }
  if (stats.intelligence >= 80 && stats.operations >= 60) {
    return 'strategist';
  }
  if (stats.operations >= 80) {
    return 'administrator';
  }
  if (hiddenStats.compatibility >= 70 && stats.intelligence >= 60) {
    return 'diplomat';
  }
  if (hiddenStats.ambition >= 70 && hiddenStats.righteousness < 50) {
    return 'politician';
  }
  if (stats.command >= 70) {
    return 'tactician';
  }
  return null;
}

/**
 * 存档兼容函数：确保提督有合法的 tags 数组
 *
 * 调用时机：gameStore.loadFromSlot() 中检测到 admiral 无 tags 时调用
 * 行为：
 *   - 若 admiral.tags 存在且非空，直接返回（存档已有标签）
 *   - 否则调用 migrateHiddenStatsToTags 自动迁移生成
 *
 * @param admiral 提督数据（可能来自旧存档，tags 字段可能为空）
 * @returns 标签数组
 */
export function ensureTags(admiral: BaseAdmiral): AdmiralTag[] {
  // 运行时检查：旧存档可能没有 tags 字段（JSON.parse 后为 undefined）
  if (admiral.tags && Array.isArray(admiral.tags) && admiral.tags.length > 0) {
    return admiral.tags;
  }
  return migrateHiddenStatsToTags(admiral);
}
