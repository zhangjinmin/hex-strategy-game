/**
 * 特技效果计算工具
 * 
 * 从特技列表中聚合计算战斗/战略修正值。
 * 乘法叠加，上限150%防止数值失控。
 */

import type { Skill, SkillEffect } from '../types/skill';

const MAX_MODIFIER = 1.5; // 总修正上限 150%

export interface CombatModifiers {
  attack: number;      // 攻击力乘数
  defense: number;     // 防御力乘数
  mobility: number;    // 机动乘数
  command: number;     // 统率乘数
  ambush: number;      // 奇袭率加值（绝对值）
  casualtyReduce: number; // 伤亡减免乘数
  moraleAura: number;  // 士气光环（绝对值）
  // ── v33 新增（旧案战术效果里现项目缺的三维，见 types/skill.ts）──
  /** 阵型崩溃抵抗 0~1（1 = 完全免疫；部分抵抗抬高士气阈值） */
  collapseResist: number;
  /** 拦截/防空加值（绝对量，0~balance.INTERCEPT.SKILL_MAX） */
  intercept: number;
  /** 射击武器专精乘数（只作用于光线炮/轨道炮类舰种，非全类型） */
  weaponFire: number;
}

export interface StrategyModifiers {
  proposal: number;    // 提案成功率加值
  warpCooldown: number; // 跃迁冷却乘数
  actionCost: number;  // 行动力消耗乘数
  growth: number;      // 成长倍率
}

/** 从特技列表计算战术修正 */
export function computeCombatModifiers(skills: Skill[]): CombatModifiers {
  const result: CombatModifiers = {
    attack: 1.0,
    defense: 1.0,
    mobility: 1.0,
    command: 1.0,
    ambush: 0,
    casualtyReduce: 1.0,
    moraleAura: 0,
    collapseResist: 0,
    intercept: 0,
    weaponFire: 1.0,
  };

  for (const skill of skills) {
    if (!skill) continue;
    for (const effect of skill.tacticalEffects) {
      if (effect.isPercentage) {
        switch (effect.type) {
          case 'attack_bonus':    result.attack *= (1 + effect.value); break;
          case 'defense_bonus':   result.defense *= (1 + effect.value); break;
          case 'mobility_bonus':  result.mobility *= (1 + effect.value); break;
          case 'command_bonus':   result.command *= (1 + effect.value); break;
          case 'casualty_reduce': result.casualtyReduce *= (1 + effect.value); break;
          // v33：三维新增（全部走"加值"语义，需与 clamp 一起看）
          case 'formation_collapse_resist': result.collapseResist += effect.value; break;
          case 'weapon_fire_bonus':         result.weaponFire *= (1 + effect.value); break;
          // 拦截按旧案是"防空加值"的绝对量语义；即便配置成百分比也按加值累加，
          // 以免 0.25 这类小值在 (1+v) 语义下几乎无效。上限在消费侧钳制。
          case 'intercept_bonus':           result.intercept += effect.value; break;
        }
      } else {
        switch (effect.type) {
          case 'ambush_bonus':    result.ambush += effect.value; break;
          case 'morale_aura':     result.moraleAura += effect.value; break;
          case 'intercept_bonus': result.intercept += effect.value; break;
        }
      }
    }
  }

  // 上限钳制
  result.attack = Math.min(result.attack, MAX_MODIFIER);
  result.defense = Math.min(result.defense, MAX_MODIFIER);
  result.mobility = Math.min(result.mobility, MAX_MODIFIER);
  result.command = Math.min(result.command, MAX_MODIFIER);
  // v33：新增维度的钳制口径
  //   · collapseResist 是"免疫比例"，> 1 无意义（且 1 已 = 完全免疫）
  //   · intercept 上限由 balance.INTERCEPT.SKILL_MAX 决定（此处不重复引入常量，消费侧钳制）
  //   · weaponFire 与 attack 同量级，共用 MAX_MODIFIER
  result.collapseResist = Math.max(0, Math.min(1, result.collapseResist));
  result.weaponFire = Math.min(result.weaponFire, MAX_MODIFIER);

  return result;
}

/** 从特技列表计算战略修正 */
export function computeStrategyModifiers(skills: Skill[]): StrategyModifiers {
  const result: StrategyModifiers = {
    proposal: 0,
    warpCooldown: 1.0,
    actionCost: 1.0,
    growth: 1.0,
  };

  for (const skill of skills) {
    if (!skill) continue;
    for (const effect of skill.strategicEffects) {
      if (effect.isPercentage) {
        switch (effect.type) {
          case 'proposal_bonus': result.proposal += effect.value; break;
          case 'warp_cooldown': result.warpCooldown *= (1 + effect.value); break;
          case 'action_cost':   result.actionCost *= (1 + effect.value); break;
          case 'growth_bonus':  result.growth *= effect.value; break;
        }
      }
    }
  }

  return result;
}

/** 获取技能效果的文本描述（用于战斗日志） */
export function getSkillCombatLog(skills: Skill[]): string[] {
  const lines: string[] = [];
  const mods = computeCombatModifiers(skills);
  
  for (const skill of skills) {
    if (!skill) continue;
    const effDescs: string[] = [];
    for (const e of skill.tacticalEffects) {
      const val = Math.round(e.isPercentage ? e.value * 100 : e.value);
      const sign = e.isPercentage && e.value > 0 ? '+' : '';
      effDescs.push(`${sign}${val}${e.isPercentage ? '%' : ''}`);
    }
    if (effDescs.length > 0) {
      lines.push(`【${skill.name}】${effDescs.join(' / ')}`);
    }
  }
  
  return lines;
}
