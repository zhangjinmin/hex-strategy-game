/**
 * 特技系统类型定义
 * 
 * 每个提督最多持有3个特技。
 * 特技分战略效果（战略层生效）和战术效果（战斗层生效）。
 * 隐藏特技需要特定事件触发觉醒。
 */

/** 特技稀有度 */
export type SkillRarity = 'common' | 'rare' | 'legendary';

/** 特技效果类别 */
export type SkillEffectType = 
  | 'attack_bonus'      // 攻击力加成
  | 'defense_bonus'     // 防御力加成
  | 'mobility_bonus'    // 机动加成
  | 'command_bonus'     // 统率加成
  | 'warp_speed'        // 跃迁速度
  | 'proposal_bonus'    // 提案成功率
  | 'morale_aura'       // 士气光环
  | 'ambush_bonus'      // 奇袭率
  | 'casualty_reduce'   // 伤亡减免
  | 'warp_cooldown'     // 跃迁冷却
  | 'action_cost'       // 行动力消耗
  | 'growth_bonus'      // 成长加成
  // ── v33 新增（旧案 44 图战术模块整合 P1-4.4；均为百分比，见 utils/skillEffects.ts）──
  | 'formation_collapse_resist'  // 阵型崩溃抵抗 0~1（旧案「棋手」；1 = 完全免疫）
  | 'intercept_bonus'            // 拦截/防空加值（绝对量 0~0.25，旧案「拦截强化」/「凹型」语义）
  | 'weapon_fire_bonus'          // 射击武器专精（旧案「真·神射手」：只作用于光线炮/轨道炮类，非全类型）

/** 单个特技定义 */
export interface Skill {
  id: string;
  name: string;
  rarity: SkillRarity;
  /** 战术效果 — 在战斗计算中应用 */
  tacticalEffects: SkillEffect[];
  /** 战略效果 — 在战略层计算中应用 */
  strategicEffects: SkillEffect[];
  /** 是否为隐藏特技（需事件觉醒） */
  isHidden: boolean;
  /** 觉醒条件描述（仅隐藏特技） */
  awakenCondition?: string;
  /** 描述文本 */
  description: string;
}

/** 单个技能效果 */
export interface SkillEffect {
  type: SkillEffectType;
  /** 效果值：百分比加成用小数（0.25=25%），绝对值直接使用 */
  value: number;
  /** 是否百分比 */
  isPercentage: boolean;
}

/** 特技觉醒事件 */
export interface SkillAwakenEvent {
  /** 触发条件类型 */
  triggerType: 'admiral_death' | 'location_owned' | 'event_occurred' | 'injury_sustained';
  /** 条件参数 */
  triggerParam: string | number;
  /** 觉醒的特技ID */
  skillId: string;
  /** 获取该特技的提督ID */
  admiralId: number;
  /** 替换的特技索引（如果已有3个特技，替换哪个位置的） */
  replaceIndex?: number;
}
