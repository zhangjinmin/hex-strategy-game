/**
 * 提督特技分配
 * 
 * 规则：
 * 1. 著名提督（原作有明确特技的）手动指定
 * 2. 其他提督按7维能力阈值自动分配
 * 3. 每人最多3个特技，隐藏特技不计入上限（觉醒后替换）
 */

/** 手动指定特技的著名提督（按 admiral ID） */
export const MANUAL_SKILLS: Record<number, string[]> = {
  // === 帝国 ===
  81:  ['genius'],                          // 莱因哈特: 天才（霸气隐藏觉醒）
  82:  ['sharpshooter', 'calm'],            // 吉尔菲艾斯: 射撃名人+冷静
  97:  ['gale'],                            // 米达麦亚: 疾风
  103: ['fierce_wind'],                     // 毕典菲尔特: 烈风
  92:  ['iron_wall'],                       // 坎普: 铁壁
  83:  ['calm', 'eloquence'],               // 奥贝斯坦: 冷静+辩才
  94:  ['iron_wall', 'sharpshooter'],       // 法伦海特: 铁壁+射撃名人
  104: ['sharpshooter'],                    // 鲁兹: 射撃名人
  105: ['ambush_master'],                   // 瓦列: 奇襲名人
  106: ['fierce_wind', 'gale'],             // 缪拉: 烈风+疾风
  100: ['sharpshooter', 'calm'],            // 克斯拉: 射撃名人+冷静
  95:  ['eloquence'],                       // 梅克林格: 辩才
  86:  ['iron_wall', 'sharpshooter'],       // 罗严塔尔: 铁壁+射撃名人
  93:  ['gale'],                            // 连内肯普: 疾风
  107: ['iron_wall'],                       // 艾齐纳哈: 铁壁

  // === 同盟 ===
  1:   ['popularity'],                      // 杨威利: 人气（奇迹/魔手隐藏觉醒）
  2:   ['ambush_master'],                   // 先寇布: 奇襲名人（格击王隐藏觉醒）
  3:   ['ace_pilot'],                       // 波布兰: 击坠王
  4:   ['ace_pilot'],                       // 高尼夫: 击坠王
  5:   ['gale', 'calm'],                    // 亚典波罗: 疾风+冷静
  6:   ['iron_wall'],                       // 费雪: 铁壁
  7:   ['sharpshooter'],                    // 马逊: 射撃名人
  8:   ['fierce_wind'],                     // 阮文绍: 烈风
  11:  ['calm', 'eloquence'],               // 卡介伦: 冷静+辩才
  15:  ['eloquence'],                       // 席特列: 辩才
  20:  ['ambush_master'],                   // 林兹: 奇襲名人
  21:  ['gale'],                            // 拉普: 疾风
  23:  ['fierce_wind'],                     // 邱吾权: 烈风
};

/**
 * 按能力阈值自动分配特技
 * 返回应分配的特技ID列表（最多3个）
 */
export function autoAssignSkills(stats: {
  attack: number; defense: number; mobility: number;
  command: number; operations: number; intelligence: number;
}): string[] {
  const skills: string[] = [];

  // 攻击≥85 → 射撃名人 或 烈风
  if (stats.attack >= 88) skills.push('fierce_wind');
  else if (stats.attack >= 82) skills.push('sharpshooter');

  // 防御≥85 → 铁壁
  if (stats.defense >= 85) skills.push('iron_wall');

  // 机动≥80 → 疾风
  if (stats.mobility >= 80) skills.push('gale');

  // 统率≥85 → 冷静
  if (stats.command >= 85 && !skills.includes('calm')) skills.push('calm');

  // 营运≥80 → 辩才
  if (stats.operations >= 80) skills.push('eloquence');

  // 情报≥85 → 奇襲名人
  if (stats.intelligence >= 85) skills.push('ambush_master');

  // 全能型（统率+攻击+防御都高）→ 人气
  if (stats.command >= 82 && stats.attack >= 80 && stats.defense >= 80 && skills.length < 2) {
    skills.push('popularity');
  }

  // 最多3个，按稀有度排序（legendary在前）
  return skills.slice(0, 3);
}

/**
 * 获取提督的完整特技列表（手动+自动）
 */
export function getAdmiralSkills(
  admiralId: number,
  stats: { attack: number; defense: number; mobility: number; command: number; operations: number; intelligence: number }
): string[] {
  const manual = MANUAL_SKILLS[admiralId];
  if (manual) return manual;

  return autoAssignSkills(stats);
}

/** 隐藏特技觉醒配置 */
export const HIDDEN_AWAKENING: Array<{
  skillId: string;
  admiralId: number;
  triggerType: 'admiral_death' | 'location_owned' | 'event_occurred' | 'injury_sustained';
  triggerParam: string | number;
}> = [
  // 莱因哈特 → 霸气：吉尔菲艾斯死亡后
  { skillId: 'overlord', admiralId: 81, triggerType: 'admiral_death', triggerParam: '82' },
  // 杨威利 → 奇迹：拉普死亡 + 同盟拥有伊谢尔伦
  { skillId: 'miracle', admiralId: 1, triggerType: 'admiral_death', triggerParam: '21' },
  // 杨威利 → 魔手：同盟拥有伊谢尔伦时自动觉醒
  { skillId: 'demon_hand', admiralId: 1, triggerType: 'location_owned', triggerParam: '35' },
  // 尤里安 → 勇者（用格击王代替）：杨威利死亡后
  { skillId: 'melee_king', admiralId: 9, triggerType: 'admiral_death', triggerParam: '1' },
  // 先寇布 → 格击王：负伤后觉醒
  { skillId: 'melee_king', admiralId: 2, triggerType: 'injury_sustained', triggerParam: '2' },
  // 波布兰 → 真·击坠王（用天才代替）：高尼夫死亡
  { skillId: 'genius', admiralId: 3, triggerType: 'admiral_death', triggerParam: '4' },
];
