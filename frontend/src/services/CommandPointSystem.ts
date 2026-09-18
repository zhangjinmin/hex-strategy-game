/**
 * CommandPointSystem — 指挥点引擎
 *
 * 纯计算层，不依赖 Phaser 或 Vue。
 * 管理 CP 值、冷却倒计时、活跃效果的状态机。
 */

import type { CommandAbility, CommandEffect } from '../config/commandAbilities';
import { getAbilityById } from '../config/commandAbilities';

// ── 公开状态 ──

export interface CPState {
  maxCP: number;
  currentCP: number;
  recoveryRate: number;           // CP/秒 (默认 1CP / 15s ≈ 0.0667)
  cooldowns: Record<string, number>;  // 命令ID → 剩余冷却 ms
  effects: ActiveEffect[];          // 当前活跃的命令效果
}

export interface ActiveEffect {
  commandId: string;
  effect: CommandEffect;
  targetFleetId: number | null;     // 作用目标舰队ID（null=全局/自身）
  casterFleetId: number;
  casterFactionId?: number;         // 施法方阵营（"全军"类命令按阵营归属判定，防止误益敌方）
  remainingMs: number;              // 剩余时间 ms
  startedAt: number;                // 生效时间戳
}

// ── 实例化 ──

export function createCPState(commanderCommand: number): CPState {
  const baseCP = 3 + Math.floor(commanderCommand / 25); // 统帅100→7CP, 统帅50→5CP
  return {
    maxCP: baseCP,
    currentCP: baseCP,
    recoveryRate: 1 / 15, // 每15秒恢复1CP
    cooldowns: {},
    effects: [],
  };
}

// ── 查询 ──

export function canExecute(state: CPState, abilityId: string): boolean {
  const ability = getAbilityById(abilityId);
  if (!ability) return false;
  if (state.currentCP < ability.cpCost) return false;
  if ((state.cooldowns[abilityId] || 0) > 0) return false;
  return true;
}

export function getCooldownMs(state: CPState, abilityId: string): number {
  return state.cooldowns[abilityId] || 0;
}

// ── 执行命令 ──

export function executeCommand(
  state: CPState,
  abilityId: string,
  casterFleetId: number,
  targetFleetId: number | null,
  casterFactionId?: number
): ActiveEffect | null {
  const ability = getAbilityById(abilityId);
  if (!ability || !canExecute(state, abilityId)) return null;

  // 扣除CP + 启动冷却
  state.currentCP -= ability.cpCost;
  state.cooldowns[abilityId] = ability.cooldownMs;

  const active: ActiveEffect = {
    commandId: abilityId,
    effect: { ...ability.effect },
    targetFleetId,
    casterFleetId,
    casterFactionId,
    remainingMs: ability.effect.durationMs,
    startedAt: Date.now(),
  };
  state.effects.push(active);
  return active;
}

// ── 每帧更新（在 BattleScene.update 中调用）──

export function updateCPState(state: CPState, dtMs: number) {
  // CP恢复
  state.currentCP = Math.min(
    state.maxCP,
    state.currentCP + state.recoveryRate * (dtMs / 1000)
  );

  // 冷却递减
  for (const key of Object.keys(state.cooldowns)) {
    state.cooldowns[key] = Math.max(0, (state.cooldowns[key] || 0) - dtMs);
  }

  // 活跃效果递减
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const e = state.effects[i];
    e.remainingMs -= dtMs;
    if (e.remainingMs <= 0) {
      state.effects.splice(i, 1);
    }
  }
}

// ── 效果查询（在 applyCommandEffects 中使用）──

export function getActiveEffects(state: CPState, fleetId: number): ActiveEffect[] {
  return state.effects.filter(
    e => e.targetFleetId === fleetId || e.targetFleetId === null || e.casterFleetId === fleetId
  );
}

/** 获取特定舰队的伤害倍率修正（叠加所有活跃效果）
 *  isDefending=true（驻守姿态）时抑制自身 damage_boost（防御时不输出强化）
 *  护盾减伤见 getIncomingMultiplier —— 出手/受伤两条链路分离，避免护盾误伤己方输出
 *  factionId：查询舰队所属阵营，用于"全军"类命令（如莱因哈特咆哮）的归属判定
 */
export function getDamageMultiplier(state: CPState, fleetId: number, isDefending: boolean, factionId?: number): number {
  let mult = 1.0;
  for (const e of state.effects) {
    // 自身有 damage_boost → 提升攻击（驻守时抑制；reinhard_roar 走下方阵营分支，避免重复加成）
    if (e.casterFleetId === fleetId && !isDefending && e.commandId !== 'reinhard_roar') {
      if (e.effect.type === 'damage_boost') mult *= (1 + e.effect.value);
    }
    // 全军型咆哮：同阵营所有舰队共享伤害加成（修复旧版只加成施法旗舰的问题）
    if (e.commandId === 'reinhard_roar' && !isDefending && factionId !== undefined && e.casterFactionId === factionId) {
      mult *= (1 + e.effect.value);
    }
    // 敌方的 debuff 作用在自己身上 → 降低攻击
    if (e.targetFleetId === fleetId && !isDefending) {
      if (e.effect.type === 'debuff') mult *= (1 - e.effect.value);
    }
  }
  return Math.max(0.1, mult);
}

/** 获取特定舰队受到伤害的减免倍率（护盾分支）
 *  激活条件：舰队处于驻守姿态（isDefending）或持有活跃 shield 效果（紧急抢修/紧急回避等主动护盾不要求驻守）
 */
export function getIncomingMultiplier(state: CPState, fleetId: number, isDefending: boolean): number {
  let mult = 1.0;
  for (const e of state.effects) {
    // 自身有 shield → 降低受伤
    if ((e.targetFleetId === fleetId || e.casterFleetId === fleetId) && e.effect.type === 'shield') {
      mult *= (1 - e.effect.value);
    }
    // reflect（魔术师的反击）→ 反弹的同时减伤 50%（以反击姿态偏转来袭火力）
    if ((e.targetFleetId === fleetId || e.casterFleetId === fleetId) && e.effect.type === 'reflect') {
      mult *= (1 - e.effect.value);
    }
  }
  if (isDefending) {
    // 驻守姿态常驻减伤 20%（与护盾效果叠加）
    mult *= 0.8;
  }
  return Math.max(0.05, mult);
}

/** 获取特定舰队的 reflect 反弹系数（取最大值；0 = 无反弹） */
export function getReflectRatio(state: CPState, fleetId: number): number {
  let ratio = 0;
  for (const e of state.effects) {
    if ((e.targetFleetId === fleetId || e.casterFleetId === fleetId) && e.effect.type === 'reflect') {
      ratio = Math.max(ratio, e.effect.value);
    }
  }
  return ratio;
}

/** 获取作用于特定舰队的速度倍率修正 */
export function getSpeedMultiplier(state: CPState, fleetId: number, factionId?: number): number {
  let mult = 1.0;
  for (const e of state.effects) {
    if (e.casterFleetId === fleetId && e.effect.type === 'speed_boost') {
      mult *= (1 + e.effect.value);
    }
    // 莱因哈特咆哮 +30% 移速：仅同阵营舰队（修复旧版无归属判定、敌我同时加速）
    if (e.commandId === 'reinhard_roar' && factionId !== undefined && e.casterFactionId === factionId) {
      mult *= 1.3;
    }
  }
  return mult;
}

/** 获取作用于特定舰队的士气修正 */
export function getMoraleModifier(state: CPState, fleetId: number, factionId?: number): number {
  let mod = 0;
  for (const e of state.effects) {
    // 自身施法，或"全军"型（targetFleetId=null）且同阵营
    const friendlyGlobal = e.targetFleetId === null && factionId !== undefined && e.casterFactionId === factionId;
    if ((e.casterFleetId === fleetId || friendlyGlobal) && e.effect.type === 'morale') {
      mod += e.effect.value;
    }
  }
  return mod;
}
