// ==================================================
// File: src/config/roleConfig.ts
// 职权权限配置中心：提案权限矩阵 + 舰队调动权 + 职位适配度
// ==================================================

import type { NationalRole, ProposalType, StrategicFleet, AbilityTag, AdminOperationType, LocalOperationType, EnemyOpType } from '../types/game';
import type { BaseAdmiral } from './admiralsData';
import { ROLE_FITNESS_MAP } from './tagConfig';

// ─── 14 职位 × 7 提案类型 完整权限矩阵（v3 瘦身后） ───
// 每个 NationalRole 可发起的 ProposalType 列表（删除 tax/logistics/tech_mobilize/intel_op/diplomat_op）
export const ROLE_PERMISSIONS_V2: Record<NationalRole, ProposalType[]> = {
  emperor:               ['invasion', 'defense', 'budget', 'personnel', 'conscription',
                          'morale_boost', 'fortify'],
  prime_minister:        ['budget', 'personnel'],
  military_minister:     ['budget', 'conscription', 'fortify'],
  high_command_chief:    ['invasion', 'defense'],
  space_fleet_commander: ['invasion', 'morale_boost'],
  space_fleet_deputy:    ['invasion', 'morale_boost'],
  intel_minister:        ['defense'],
  defense_commander:     ['defense', 'fortify'],
  fleet_commander:       ['invasion'],
  fleet_staff:           [],
  council:               ['invasion', 'defense', 'budget', 'personnel', 'conscription',
                          'morale_boost', 'fortify'],
  joint_ops_chief:       ['invasion', 'defense'],
  joint_ops_deputy:      ['invasion', 'morale_boost'],
  none:                  [],
};

// ─── v3 新增：行政院操作权限矩阵 ───
export const ROLE_ADMIN_PERMISSIONS: Record<NationalRole, AdminOperationType[]> = {
  emperor:               ['logistics', 'tech_mobilize', 'intel_op', 'diplomat_op'],
  council:               ['logistics', 'tech_mobilize', 'intel_op', 'diplomat_op'],
  prime_minister:        ['logistics', 'diplomat_op'],
  military_minister:     ['logistics', 'tech_mobilize'],
  intel_minister:        ['intel_op', 'diplomat_op'],
  high_command_chief:    ['intel_op'],
  joint_ops_chief:       ['intel_op'],
  space_fleet_commander: [],
  space_fleet_deputy:    [],
  defense_commander:     [],
  fleet_commander:       [],
  fleet_staff:           [],
  joint_ops_deputy:      [],
  none:                  [],
};

// ─── v3 新增：友方节点本地操作权限矩阵 ───
export const ROLE_LOCAL_PERMISSIONS: Record<NationalRole, LocalOperationType[]> = {
  emperor:               ['special_tax', 'security_boost', 'welfare_invest', 'fortify_local', 'set_hq', 'emergency_draft', 'intel_gather'],
  council:               ['special_tax', 'security_boost', 'welfare_invest', 'fortify_local', 'set_hq', 'emergency_draft', 'intel_gather'],
  prime_minister:        ['special_tax', 'welfare_invest', 'set_hq'],
  military_minister:     ['security_boost', 'fortify_local', 'emergency_draft'],
  defense_commander:     ['special_tax', 'security_boost', 'welfare_invest', 'fortify_local', 'set_hq', 'emergency_draft', 'intel_gather'],
  intel_minister:        ['intel_gather'],
  high_command_chief:    ['emergency_draft', 'intel_gather'],
  joint_ops_chief:       ['emergency_draft', 'intel_gather'],
  space_fleet_commander: ['emergency_draft', 'intel_gather'],
  space_fleet_deputy:    ['emergency_draft', 'intel_gather'],
  fleet_commander:       ['security_boost', 'emergency_draft'],
  fleet_staff:           [],
  joint_ops_deputy:      ['emergency_draft', 'intel_gather'],
  none:                  [],
};

// ─── v3 新增：敌方节点操作权限矩阵 ───
export const ROLE_ENEMY_PERMISSIONS: Record<NationalRole, EnemyOpType[]> = {
  emperor:               ['recon', 'infiltrate', 'subvert'],
  council:               ['recon', 'infiltrate', 'subvert'],
  prime_minister:        ['recon'],
  military_minister:     ['recon'],
  intel_minister:        ['recon', 'infiltrate', 'subvert'],
  high_command_chief:    ['recon', 'infiltrate'],
  joint_ops_chief:       ['recon', 'infiltrate'],
  space_fleet_commander: ['recon'],
  space_fleet_deputy:    ['recon'],
  defense_commander:     ['recon'],
  fleet_commander:       [],
  fleet_staff:           [],
  joint_ops_deputy:      [],
  none:                  [],
};

// ─── 职位 → 期望能力标签映射表 ───
// 用于计算职位适配效率（calculateRoleEfficiency）
// 部分映射参照 ROLE_FITNESS_MAP 的反向关系，同时补充了 ROLE_FITNESS_MAP 中未覆盖的职务
const ROLE_TAG_MAP: Record<string, AbilityTag> = {
  'fleet_commander':       'tactician',
  'space_fleet_commander': 'tactician',
  'space_fleet_deputy':    'tactician',
  'high_command_chief':    'strategist',
  'joint_ops_chief':       'strategist',
  'prime_minister':        'politician',
  'council':               'politician',
  'military_minister':     'administrator',
  'defense_commander':     'administrator',
  'intel_minister':        'diplomat',
};

// ─── 职位 → 舰队调动权限等级 ───
export const ROLE_FLEET_AUTHORITY: Record<NationalRole, 'all' | 'group' | 'station' | 'self' | 'none'> = {
  emperor:               'all',
  council:               'all',
  high_command_chief:    'all',
  joint_ops_chief:       'all',
  space_fleet_commander: 'group',
  space_fleet_deputy:    'group',
  defense_commander:     'station',
  fleet_commander:       'self',
  prime_minister:        'none',
  military_minister:     'none',
  intel_minister:        'none',
  joint_ops_deputy:      'self',
  fleet_staff:           'none',
  none:                  'none',
};

/**
 * 校验提督是否有权调动指定舰队
 *
 * 权限规则：
 * - emperor / council / high_command_chief / joint_ops_chief：可调动所有舰队
 * - space_fleet_commander / space_fleet_deputy：仅可调动归属自己指挥的舰队（parentCommanderId 匹配）
 * - defense_commander：仅可调动驻留自己防卫节点的舰队（currentNodeId 匹配）
 * - fleet_commander：仅可调动自己担任司令的舰队（commanderId 匹配）
 * - 其他职位：无权调动
 *
 * @param admiral - 提督对象
 * @param fleet - 目标舰队
 * @returns 是否有权调动
 */
export function canCommandFleet(admiral: BaseAdmiral, fleet: StrategicFleet): boolean {
  const role = admiral.role as string;

  // 统帅级：可调动所有舰队
  if (role === 'emperor' || role === 'council') return true;
  if (role === 'high_command_chief' || role === 'joint_ops_chief') return true;

  // 宇宙舰队司令/副司令：仅可调动归属自己指挥的舰队
  if (role === 'space_fleet_commander' || role === 'space_fleet_deputy') {
    return fleet.parentCommanderId === admiral.id;
  }

  // 防卫司令官：仅可调动驻留自己防卫节点的舰队
  if (role === 'defense_commander') {
    return fleet.currentNodeId === admiral.assignedNodeId;
  }

  // 分舰队司令：仅可调动自己担任司令的舰队
  if (role === 'fleet_commander') {
    return fleet.commanderId === admiral.id;
  }

  return false;
}

/**
 * 校验提督是否有权编辑指定舰队的编成和阵型
 * 规则：与 canCommandFleet 相同 —— 能调动的舰队就能编辑。
 */
export function canEditFleet(admiral: BaseAdmiral, fleet: StrategicFleet): boolean {
  return canCommandFleet(admiral, fleet);
}

/**
 * 计算提督在当前职位的适配效率
 *
 * 基于 ROLE_TAG_MAP（参照 ROLE_FITNESS_MAP 反向映射）判断提督的能力标签是否匹配职位期望：
 * - 匹配（tags 包含期望标签）：效率 1.3（130%）
 * - 不匹配：效率 0.7（70%）
 * - 职位无期望标签（如 emperor/council/none）：效率 1.0（100%，默认值）
 *
 * @param admiral - 提督对象
 * @returns 适配效率系数 (0.7 ~ 1.3)
 */
export function calculateRoleEfficiency(admiral: BaseAdmiral): number {
  const tags = admiral.tags || [];
  const role = admiral.role as string;

  // 先查 ROLE_TAG_MAP
  let expectedTag: AbilityTag | undefined = ROLE_TAG_MAP[role];

  // 回退：从 ROLE_FITNESS_MAP 反向查找（处理 ROLE_TAG_MAP 未覆盖的职位）
  if (!expectedTag) {
    for (const [tag, roles] of Object.entries(ROLE_FITNESS_MAP)) {
      if (roles.includes(role as NationalRole)) {
        expectedTag = tag as AbilityTag;
        break;
      }
    }
  }

  // 无期望标签的职位（如 emperor/council/none）使用默认效率
  if (!expectedTag) return 1.0;

  return tags.includes(expectedTag) ? 1.3 : 0.7;
}

/**
 * 校验提督是否有权发起指定类型的提案
 *
 * 查询 ROLE_PERMISSIONS_V2 权限矩阵，判断提督职位是否被授权该提案类型。
 *
 * @param admiral - 提督对象
 * @param proposalType - 提案类型
 * @returns 是否有权发起
 */
export function canPropose(admiral: BaseAdmiral, proposalType: ProposalType): boolean {
  const allowed = ROLE_PERMISSIONS_V2[admiral.role] || [];
  return allowed.includes(proposalType);
}

// ─── P1 链式指挥链：职级层级定义（数值越小，权限越高）───
const ROLE_HIERARCHY: Record<string, number> = {
  emperor:               0,
  council:               0,
  high_command_chief:    1,
  joint_ops_chief:       1,
  prime_minister:        1,
  military_minister:     1,
  intel_minister:        1,
  space_fleet_commander: 2,
  space_fleet_deputy:    2,
  joint_ops_deputy:      2,
  defense_commander:     3,
  fleet_commander:       4,
  fleet_staff:           5,
  none:                  6,
};

const ROLE_HIERARCHY_SUPERIOR: Record<string, string[]> = {
  emperor:               [],
  council:               [],
  high_command_chief:    ['emperor', 'council'],
  joint_ops_chief:       ['emperor', 'council'],
  prime_minister:        ['emperor', 'council'],
  military_minister:     ['emperor', 'council', 'high_command_chief'],
  intel_minister:        ['emperor', 'council', 'high_command_chief'],
  space_fleet_commander: ['high_command_chief', 'joint_ops_chief'],
  space_fleet_deputy:    ['high_command_chief', 'joint_ops_chief', 'space_fleet_commander'],
  joint_ops_deputy:      ['high_command_chief', 'joint_ops_chief'],
  defense_commander:     ['space_fleet_commander', 'space_fleet_deputy', 'high_command_chief'],
  fleet_commander:       ['space_fleet_commander', 'space_fleet_deputy', 'defense_commander'],
  fleet_staff:           ['fleet_commander', 'space_fleet_commander'],
  none:                  ['fleet_commander', 'space_fleet_commander'],
};

/** 查找提案人的直属上司（指挥链中向上第一个存在的角色） */
export function findSuperior(proposer: BaseAdmiral, allAdmirals: BaseAdmiral[]): BaseAdmiral | null {
  const candidateRoles = ROLE_HIERARCHY_SUPERIOR[proposer.role] || [];
  const faction = proposer.faction || 'alliance';
  const factionAdmirals = allAdmirals.filter(a => (a.faction || 'alliance') === faction);
  for (const role of candidateRoles) {
    const superior = factionAdmirals.find(a => a.role === role);
    if (superior) return superior;
  }
  return null;
}

/** 获取角色的职级层级数值 */
export function getRoleLevel(role: string): number {
  return ROLE_HIERARCHY[role] ?? 6;
}
