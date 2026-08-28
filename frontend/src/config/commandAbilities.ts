/**
 * commandAbilities.ts — 指挥点命令数据定义
 *
 * 结构：
 *   COMMAND_ABILITIES: 命令定义（通用命令 + 提督专属命令）
 *   getAvailableCommands(): 根据当前战场提督返回可用命令列表
 *   getAbilityById():     ID查找
 */

export interface CommandEffect {
  type: 'damage_boost' | 'heal' | 'shield' | 'debuff' | 'teleport' | 'morale' | 'reflect' | 'speed_boost';
  value: number;
  durationMs: number;         // 0 = 瞬时
  range?: number;             // px，作用范围
}

export interface CommandAbility {
  id: string;
  name: string;
  description: string;
  cpCost: number;
  cooldownMs: number;
  requiresTarget: boolean;
  targetType: 'enemy' | 'self' | 'ally' | 'none' | 'enemy_fleet' | 'self_fleet';
  admiralId?: number;         // 专属命令 → 绑定提督ID，undefined = 通用
  requireAllyAdmiralId?: number; // 齐格飞→需要莱因哈特同场
  effect: CommandEffect;
}

// ── 6 种通用命令 ──

const GENERIC_COMMANDS: CommandAbility[] = [
  {
    id: 'focus_fire',
    name: '集中火力',
    description: '指定舰队所有舰船集火单一目标，伤害+30%',
    cpCost: 2,
    cooldownMs: 60000,
    requiresTarget: true,
    targetType: 'enemy_fleet',
    effect: { type: 'damage_boost', value: 0.3, durationMs: 20000 },
  },
  {
    id: 'emergency_repair',
    name: '紧急抢修',
    description: '旗舰立即恢复20%HP，5秒内护盾增强50%',
    cpCost: 1,
    cooldownMs: 90000,
    requiresTarget: false,
    targetType: 'self_fleet',
    effect: { type: 'shield', value: 0.5, durationMs: 5000 },
  },
  {
    id: 'ecm_jam',
    name: '电子干扰',
    description: '目标敌方舰队视野减半、命中率-25%',
    cpCost: 2,
    cooldownMs: 120000,
    requiresTarget: true,
    targetType: 'enemy_fleet',
    effect: { type: 'debuff', value: 0.25, durationMs: 15000 },
  },
  {
    id: 'evasive_maneuver',
    name: '紧急回避',
    description: '指定舰队获得2秒无敌帧，闪避所有攻击',
    cpCost: 1,
    cooldownMs: 180000,
    requiresTarget: false,
    targetType: 'self_fleet',
    effect: { type: 'shield', value: 1.0, durationMs: 2000 },
  },
  {
    id: 'morale_rally',
    name: '士气鼓舞',
    description: '全军士气+30，持续15秒',
    cpCost: 2,
    cooldownMs: 60000,
    requiresTarget: false,
    targetType: 'none',
    effect: { type: 'morale', value: 30, durationMs: 15000 },
  },
  {
    id: 'formation_charge',
    name: '阵型突击',
    description: '楔形阵→前3秒速度×2，冲锋到目标身后',
    cpCost: 2,
    cooldownMs: 90000,
    requiresTarget: true,
    targetType: 'enemy_fleet',
    effect: { type: 'speed_boost', value: 1.0, durationMs: 3000 },
  },
];

// ── 5 个提督专属命令 ──

const ADMIRAL_COMMANDS: CommandAbility[] = [
  {
    id: 'yang_magic_counter',
    name: '魔术师的反击',
    description: '舰队5秒无敌并反弹50%伤害，结束后士气+50',
    cpCost: 3,
    cooldownMs: 300000,
    requiresTarget: false,
    targetType: 'self_fleet',
    admiralId: 156, // 杨威利
    effect: { type: 'reflect', value: 0.5, durationMs: 5000 },
  },
  {
    id: 'reinhard_roar',
    name: '黄金狮子的咆哮',
    description: '全军伤害+50%、移速+30%，持续20秒',
    cpCost: 3,
    cooldownMs: 300000,
    requiresTarget: false,
    targetType: 'none',
    admiralId: 81, // 莱因哈特
    effect: { type: 'damage_boost', value: 0.5, durationMs: 20000 },
  },
  {
    id: 'kirscheis_guardian',
    name: '红发的守护',
    description: '替代莱因哈特承受所有伤害，持续15秒',
    cpCost: 3,
    cooldownMs: 240000,
    requiresTarget: false,
    targetType: 'self_fleet',
    admiralId: 15, // 吉尔菲艾斯(齐格飞)
    requireAllyAdmiralId: 81, // 需要莱因哈特同场
    effect: { type: 'shield', value: 1.0, durationMs: 15000 },
  },
  {
    id: 'bucock_bastion',
    name: '老将的坚壁',
    description: '舰队速度归零，伤害+20%，防御+50%',
    cpCost: 2,
    cooldownMs: 240000,
    requiresTarget: false,
    targetType: 'self_fleet',
    admiralId: 136, // 比克古
    effect: { type: 'shield', value: 0.5, durationMs: 30000 },
  },
  {
    id: 'reuenthal_blitz',
    name: '双璧的猛袭',
    description: '舰队瞬间传送到目标身后，下一击×3暴击',
    cpCost: 3,
    cooldownMs: 240000,
    requiresTarget: true,
    targetType: 'enemy_fleet',
    admiralId: 98, // 罗严塔尔
    effect: { type: 'teleport', value: 3.0, durationMs: 0 },
  },
];

// ── 合并 ──

const ALL_COMMANDS: CommandAbility[] = [...GENERIC_COMMANDS, ...ADMIRAL_COMMANDS];

// ── 导出查询函数 ──

/** 获取指定提督可用的所有命令（通用 + 该提督的专属） */
export function getAvailableCommands(
  fleetAdmiralId: number,
  allBattleAdmiralIds: number[]
): CommandAbility[] {
  const commands = [...GENERIC_COMMANDS];
  for (const cmd of ADMIRAL_COMMANDS) {
    if (cmd.admiralId !== fleetAdmiralId) continue;
    // 齐格飞专属需要莱因哈特同场
    if (cmd.requireAllyAdmiralId && !allBattleAdmiralIds.includes(cmd.requireAllyAdmiralId)) {
      continue;
    }
    commands.push(cmd);
  }
  return commands;
}

export function getAbilityById(id: string): CommandAbility | undefined {
  return ALL_COMMANDS.find(c => c.id === id);
}

export function getAdmiralCommandIds(): number[] {
  return ADMIRAL_COMMANDS.map(c => c.admiralId).filter((id): id is number => id !== undefined);
}
