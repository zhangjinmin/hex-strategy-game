/**
 * 特技配置数据 — 14个核心特技（3档）
 * 
 * 数据来源：4EX原作 + WEB企划PRD + 银英小说设定
 * 数值：[PLACEHOLDER] 待 playtest 调参
 */

import type { Skill } from '../types/skill';

export const ALL_SKILLS: Skill[] = [
  // ========== 第一档：常见特技（5个）==========

  {
    id: 'gale',
    name: '疾风',
    rarity: 'common',
    tacticalEffects: [{ type: 'mobility_bonus', value: 0.10, isPercentage: true }],
    strategicEffects: [{ type: 'warp_cooldown', value: -0.20, isPercentage: true }],
    isHidden: false,
    description: '跃迁冷却时间−20%，战术移动+10%',
  },
  {
    id: 'iron_wall',
    name: '铁壁',
    rarity: 'common',
    tacticalEffects: [
      { type: 'defense_bonus', value: 0.20, isPercentage: true },
      { type: 'casualty_reduce', value: -0.50, isPercentage: true },
    ],
    strategicEffects: [],
    isHidden: false,
    description: '防御力+20%，提督负伤率−50%',
  },
  {
    id: 'sharpshooter',
    name: '射撃名人',
    rarity: 'common',
    tacticalEffects: [{ type: 'attack_bonus', value: 0.15, isPercentage: true }],
    strategicEffects: [],
    isHidden: false,
    description: '射击武器伤害+15%',
  },
  {
    id: 'eloquence',
    name: '辩才',
    rarity: 'common',
    tacticalEffects: [],
    strategicEffects: [{ type: 'proposal_bonus', value: 0.20, isPercentage: true }],
    isHidden: false,
    description: '军议提案成功率+20%',
  },
  {
    id: 'calm',
    name: '冷静',
    rarity: 'common',
    tacticalEffects: [],
    strategicEffects: [
      { type: 'proposal_bonus', value: 0.10, isPercentage: true },
      { type: 'command_bonus', value: 0.10, isPercentage: true },
    ],
    isHidden: false,
    description: '士气低下防止，情报活动+10%',
  },

  // ========== 第二档：稀有特技（4个）==========

  {
    id: 'fierce_wind',
    name: '烈风',
    rarity: 'rare',
    tacticalEffects: [{ type: 'attack_bonus', value: 0.25, isPercentage: true }],
    strategicEffects: [{ type: 'action_cost', value: -0.30, isPercentage: true }],
    isHidden: false,
    description: '全力攻击时火力+25%，强制提案消耗−30%',
  },
  {
    id: 'ambush_master',
    name: '奇襲名人',
    rarity: 'rare',
    tacticalEffects: [
      { type: 'ambush_bonus', value: 0.10, isPercentage: true },
      { type: 'morale_aura', value: 10, isPercentage: false },
    ],
    strategicEffects: [],
    isHidden: false,
    description: '奇袭率+10%，白兵战效果+20%，士气上限+10',
  },
  {
    id: 'ace_pilot',
    name: '击坠王',
    rarity: 'rare',
    tacticalEffects: [
      { type: 'attack_bonus', value: 0.20, isPercentage: true },
      { type: 'casualty_reduce', value: -0.50, isPercentage: true },
    ],
    strategicEffects: [],
    isHidden: false,
    description: '舰载机效果+20%，负伤率−50%',
  },
  {
    id: 'popularity',
    name: '人气',
    rarity: 'rare',
    tacticalEffects: [{ type: 'morale_aura', value: 5, isPercentage: false }],
    strategicEffects: [{ type: 'proposal_bonus', value: 0.50, isPercentage: true }],
    isHidden: false,
    description: '提案成功率+50%，全军士气+5（光环）',
  },

  // ========== 第三档：传说特技（5个）==========

  {
    id: 'overlord',
    name: '霸气',
    rarity: 'legendary',
    tacticalEffects: [
      { type: 'attack_bonus', value: 0.30, isPercentage: true },
      { type: 'defense_bonus', value: 0.15, isPercentage: true },
      { type: 'ambush_bonus', value: -0.10, isPercentage: true }, // 奇袭防止（降低敌方奇袭率）
    ],
    strategicEffects: [{ type: 'action_cost', value: -0.50, isPercentage: true }],
    isHidden: true,
    awakenCondition: '吉尔菲艾斯死亡后觉醒',
    description: '全行动力消费−50%，奇袭防止（隐藏）',
  },
  {
    id: 'miracle',
    name: '奇迹',
    rarity: 'legendary',
    tacticalEffects: [{ type: 'command_bonus', value: 0.50, isPercentage: true }],
    strategicEffects: [
      { type: 'proposal_bonus', value: 1.00, isPercentage: true },
      { type: 'action_cost', value: -0.50, isPercentage: true },
    ],
    isHidden: true,
    awakenCondition: '拉普死亡 + 同盟拥有伊谢尔伦时觉醒',
    description: '提案成功率+100%，全行动力−50%，冷却−50%（隐藏）',
  },
  {
    id: 'genius',
    name: '天才',
    rarity: 'legendary',
    tacticalEffects: [{ type: 'command_bonus', value: 0.30, isPercentage: true }],
    strategicEffects: [{ type: 'growth_bonus', value: 2.0, isPercentage: true }],
    isHidden: false,
    description: '活跃度+50%，人物成长率×2',
  },
  {
    id: 'melee_king',
    name: '格击王',
    rarity: 'legendary',
    tacticalEffects: [
      { type: 'attack_bonus', value: 0.30, isPercentage: true },
      { type: 'ambush_bonus', value: 0.10, isPercentage: true },
    ],
    strategicEffects: [],
    isHidden: true,
    awakenCondition: '特定事件后觉醒',
    description: '白兵战效果+30%，奇袭率+10%（隐藏）',
  },
  {
    id: 'demon_hand',
    name: '魔手',
    rarity: 'legendary',
    tacticalEffects: [
      { type: 'ambush_bonus', value: 0.10, isPercentage: true },
      { type: 'morale_aura', value: 10, isPercentage: false },
    ],
    strategicEffects: [],
    isHidden: true,
    awakenCondition: '特定事件后觉醒',
    description: '奇袭率+10%，士气上限+10（隐藏）',
  },
];

/** 按ID快速查找 */
export const SKILL_MAP: Record<string, Skill> = {};
ALL_SKILLS.forEach(s => { SKILL_MAP[s.id] = s; });
