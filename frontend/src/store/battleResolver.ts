/**
 * Battle Resolver — 战斗裁决与提督伤亡
 * 纯计算函数，所有状态通过参数传入。
 */
import type { StrategicFleet, FleetComposition } from '../types/game';
import { BattleOutcome, totalShips, EMPTY_COMPOSITION } from '../types/game';
import type { Skill } from '../types/skill';
import { computeCombatModifiers } from '../utils/skillEffects';

// ========== 常量 ==========

export const AUTO_RESOLVE_DEFAULTS = {
  typeCoeff: {
    battleships: 4.0, fast_battleships: 3.2,
    cruisers: 2.5, destroyers: 1.5,
    carriers: 2.0, fighters: 1.0,
  },
  fortressBonus: 2.0,
};

// ========== 战力计算 ==========

export function calculatePower(
  fleet: StrategicFleet,
  role: 'attack' | 'defense',
  admiral: any,
  nodeType: string | undefined,
  techLevels?: { weaponLevel?: number; armorLevel?: number; electronicLevel?: number },
  skills?: Skill[]
): number {
  const comp = fleet.composition;
  const total = totalShips(comp);
  if (total === 0) return 0;

  // 特技修正
  const skillMods = skills ? computeCombatModifiers(skills) : null;

  // 加权舰种系数
  const weightedCoeff = (
    comp.battleships * AUTO_RESOLVE_DEFAULTS.typeCoeff['battleships'] +
    comp.fastBattleships * AUTO_RESOLVE_DEFAULTS.typeCoeff['fast_battleships'] +
    comp.cruisers * AUTO_RESOLVE_DEFAULTS.typeCoeff['cruisers'] +
    comp.destroyers * AUTO_RESOLVE_DEFAULTS.typeCoeff['destroyers'] +
    comp.carriers * AUTO_RESOLVE_DEFAULTS.typeCoeff['carriers'] +
    comp.fighters * AUTO_RESOLVE_DEFAULTS.typeCoeff['fighters']
  ) / total;

  const stats = admiral?.stats || { command: 50, attack: 50, defense: 50 };
  // P1修复：统帅/角色修正设上限 1.6（原无上限，顶级提督 command=100+特技 → 2.1+ 碾压全局，
  // "抢到杨威利=赢一半"）；下限 0.6 防低统帅无限趋零。
  const commandMod = Math.min(1.6, Math.max(0.6, ((stats.command || 50) / 50) * (skillMods?.command ?? 1.0)));
  const roleStat = role === 'attack' ? (stats.attack || 50) : (stats.defense || 50);
  const roleMod = Math.min(1.6, Math.max(0.6, (roleStat / 50) * (role === 'attack' ? (skillMods?.attack ?? 1.0) : (skillMods?.defense ?? 1.0))));
  const moraleFactor = Math.max(0.3, ((fleet.morale ?? 100) + (skillMods?.moraleAura ?? 0)) / 100);

  // v2: 补给不足影响战斗力（亚姆利扎危机）
  // 补给=0 → 战斗力×0.7（弹尽粮绝）；补给<30 → ×0.8；补给<50 → ×0.9
  const supplyLevel = fleet.supply ?? 100;
  const supplyFactor = supplyLevel === 0 ? 0.7
                     : supplyLevel < 30 ? 0.8
                     : supplyLevel < 50 ? 0.9
                     : 1.0;

  const fortressMod = (role === 'defense' && nodeType === 'fortress')
    ? AUTO_RESOLVE_DEFAULTS.fortressBonus : 1.0;

  const tl = techLevels || {};
  const twm = 1 + Math.max(0, (tl.weaponLevel || 1) - 1) * 0.05;
  const tam = 1 + Math.max(0, (tl.armorLevel || 1) - 1) * 0.05;
  const tem = 1 + Math.max(0, (tl.electronicLevel || 1) - 1) * 0.06;
  const techMult = role === 'attack' ? twm * tem : tam * tem;

  return total * weightedCoeff * commandMod * roleMod * moraleFactor * supplyFactor * fortressMod * techMult;
}

// ========== 损失 ==========

export function rollBoundedLoss(minPct: number, maxPct: number): number {
  return minPct + Math.random() * (maxPct - minPct);
}

// ========== 自动战斗 ==========

function applyLossToComp(c: FleetComposition, p: number): FleetComposition {
  return {
    battleships: Math.max(0, Math.floor(c.battleships * (1 - p))),
    fastBattleships: Math.max(0, Math.floor(c.fastBattleships * (1 - p))),
    cruisers: Math.max(0, Math.floor(c.cruisers * (1 - p))),
    destroyers: Math.max(0, Math.floor(c.destroyers * (1 - p))),
    carriers: Math.max(0, Math.floor(c.carriers * (1 - p))),
    fighters: Math.max(0, Math.floor(c.fighters * (1 - p))),
  };
}

export function autoResolveBattle(
  attackerFleet: { composition: FleetComposition; morale?: number },
  defenderFleet: { composition: FleetComposition; morale?: number },
  admiralA: any,
  admiralB: any,
  nodeType: string,
  techLevels?: { weaponLevel?: number; armorLevel?: number; electronicLevel?: number },
  attackerSkills?: Skill[],
  defenderSkills?: Skill[]
): { outcome: BattleOutcome; attackerLosses: number; defenderLosses: number; attackerRemaining: number; defenderRemaining: number; summary: string } {
  const attackPower = calculatePower(attackerFleet as StrategicFleet, 'attack', admiralA, undefined, techLevels, attackerSkills);
  const defensePower = calculatePower(defenderFleet as StrategicFleet, 'defense', admiralB, nodeType, techLevels, defenderSkills);
  const ratio = defensePower > 0 ? attackPower / defensePower : 99;

  let outcome: BattleOutcome; let attackerLossPct: number; let defenderLossPct: number; let summary: string;
  // P1修复：微弱胜利不再全歼守方（原 1.0 与决定性无差异，侦察价值被抹平）
  let defenderWiped = false;

  if (ratio > 1.5) {
    outcome = BattleOutcome.DECISIVE_WIN; attackerLossPct = rollBoundedLoss(0.05, 0.10); defenderLossPct = 1.0;
    defenderWiped = true;
    summary = '决定性胜利 — 敌军防线被彻底击溃。';
  } else if (ratio > 1.0) {
    outcome = BattleOutcome.MARGINAL_WIN; attackerLossPct = rollBoundedLoss(0.15, 0.25); defenderLossPct = rollBoundedLoss(0.60, 0.85);
    summary = '微弱优势胜利 — 激烈交火后敌军主力被重创，残部退守。';
  } else if (ratio > 0.7) {
    outcome = BattleOutcome.STALEMATE; attackerLossPct = rollBoundedLoss(0.20, 0.30); defenderLossPct = rollBoundedLoss(0.20, 0.30);
    summary = '胶着状态 — 双方均遭受重创，战线未发生变动。';
  } else {
    outcome = BattleOutcome.ROUT; attackerLossPct = rollBoundedLoss(0.40, 0.60); defenderLossPct = rollBoundedLoss(0.05, 0.10);
    summary = '溃败 — 我军攻击受挫，建议立即撤退重整。';
  }

  const ab = { ...attackerFleet.composition }, db = { ...defenderFleet.composition };
  attackerFleet.composition = applyLossToComp(attackerFleet.composition, attackerLossPct);
  defenderFleet.composition = applyLossToComp(defenderFleet.composition, defenderLossPct);
  if (defenderWiped) {
    defenderFleet.composition = { ...EMPTY_COMPOSITION };
  }

  const aBefore = totalShips(ab), dBefore = totalShips(db);
  const aAfter = totalShips(attackerFleet.composition), dAfter = totalShips(defenderFleet.composition);

  return { outcome, attackerLosses: aBefore - aAfter, defenderLosses: dBefore - dAfter, attackerRemaining: aAfter, defenderRemaining: dAfter, summary };
}

// ========== 提督伤亡 ==========

export interface CasultyResult {
  admiralId: number;
  state: string;  // 'dead' | 'wounded' | 'alive'
  message: string;
}

export function rollAdmiralCasualties(
  fleets: Array<{ commanderId: number; factionId: number; composition: FleetComposition; morale: number }>,
  allAdmirals: Array<{ id: number; rankName?: string; name: string; state: string; injury?: any }>,
  winnerFactionId: number
): CasultyResult[] {
  const results: CasultyResult[] = [];

  for (const fleet of fleets) {
    const adm = allAdmirals.find(a => a.id === fleet.commanderId);
    if (!adm) continue;

    const totalLoss = totalShips(fleet.composition);
    const isWinner = fleet.factionId === winnerFactionId;
    const lossRatio = totalLoss / 20000;
    let deathChance = 0.02 * (1 + lossRatio * 2);
    if (!isWinner) deathChance *= 1.5;
    deathChance = Math.min(0.15, deathChance);

    const r = Math.random();
    if (r < deathChance) {
      adm.state = 'dead';
      fleet.commanderId = -1;
      fleet.morale = Math.max(0, fleet.morale - 40);
      results.push({ admiralId: adm.id, state: 'dead', message: `${adm.rankName || ''} ${adm.name} 阵亡于战场！` });
    } else if (r < deathChance * 2.5) {
      const sev = Math.random();
      adm.state = ('wounded' as any);
      adm.injury = { isInjured: true, severity: sev > 0.5 ? 0.6 : 0.3, recoveryTicks: Math.floor(30 + sev * 60) };
      results.push({ admiralId: adm.id, state: 'wounded', message: `${adm.rankName || ''} ${adm.name} ${sev > 0.5 ? '重伤' : '轻伤'}，需 ${adm.injury.recoveryTicks} 日静养。` });
    }
  }

  return results;
}

export function isKeyAdmiralDeath(msg: string): boolean {
  return msg.includes('莱因哈特') || msg.includes('杨威利') || msg.includes('罗波斯') || msg.includes('谬肯贝尔加');
}

export function rollSingleBattleCasualty(
  fleet: { commanderId: number; morale: number },
  allAdmirals: Array<{ id: number; rankName?: string; name: string; state: string; injury?: any }>,
  severity: 'active' | 'rout' | 'destroyed'
): CasultyResult | null {
  const adm = allAdmirals.find(a => a.id === fleet.commanderId);
  if (!adm || adm.state === 'dead') return null;

  const deathChance = severity === 'destroyed' ? 0.25 : severity === 'rout' ? 0.08 : 0.03;
  const injuryChance = severity === 'destroyed' ? 0.50 : severity === 'rout' ? 0.30 : 0.15;
  const r = Math.random();

  if (r < deathChance) {
    adm.state = 'dead';
    fleet.commanderId = -1;
    fleet.morale = Math.max(0, fleet.morale - 40);
    return { admiralId: adm.id, state: 'dead', message: `${adm.rankName || ''} ${adm.name} 随舰队一起阵亡！` };
  } else if (r < deathChance + injuryChance) {
    adm.state = ('wounded' as any);
    adm.injury = { isInjured: true, severity: 0.4, recoveryTicks: 30 + Math.floor(Math.random() * 30) };
    return { admiralId: adm.id, state: 'wounded', message: `${adm.rankName || ''} ${adm.name} 负伤，需 ${adm.injury.recoveryTicks} 日静养。` };
  }
  return null;
}
