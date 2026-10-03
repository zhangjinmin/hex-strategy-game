/**
 * clusterAI —— 舰级战术单位的本地决策纯函数（P1：开火选舰）。
 *
 * 依据 29 号提案 §6.1：每舰 = 一个带本地决策循环的战术单位，舰队级下发"交战计划"
 * （集火优先级表），舰级在约束内自主细化。本模块零实例状态、零对象开销——
 * 100+ 舰 = 同一纯函数跑 100+ 份快照；滞回状态由调用方存单位字段（_lastShipTargetUid）。
 *
 * 评分模型 = 威胁评估加权（业界通行做法：距离 / 血量 / 输出 / 兵种价值）：
 *   补刀残血（第一原则：集中火力快速减员）+ 高输出压制 + 就近 + 舰队集火表加权 + 复仇。
 *
 * ⚠ 本文件是"打哪一艘"的唯一真源。严禁在 BattleScene 埋散落选靶阈值（v29 铁律）。
 */

export interface ShipTargetCandidate {
  id: string | number;
  /** 敌舰剩余血量比例 0~1 */
  hpPct: number;
  /** 与射手的距离（px）。舰队级集火表排序时传 0（同舰队内近似常数，排序不吃距离项） */
  dist: number;
  /** 期望输出：atk / (atkInterval 秒) */
  dps: number;
  /** 舰队集火表排名：0 = 表内第一目标；不在表 = -1 */
  focusRank: number;
  /** 窗口内攻击过我（谁打我我打谁） */
  attacker?: boolean;
}

/** 旧目标滞回：新最优未领先 12% 以上则沿用旧目标（防帧间交替 ⇒ 逐帧换射） */
export const SHIP_TARGET_HYSTERESIS_RATIO = 0.12;

/**
 * 集火表加权（rank 0/1/2）。**rank0 = 330 严格压过最强个人偏好（补刀满幅 300）**——
 * 舰队共识目标不允许被任何单舰偏好翻掉，否则集火表只是建议噪声。
 * rank1/rank2（180/110）低于补刀满幅：次要共识目标让位给"就差一炮"的补刀（快速减员仍是第一原则）。
 */
export const SHIP_FOCUS_BONUS = [330, 180, 110] as const;

/** 复仇加权：打我的那艘船次优先还击（低于集火表 rank0） */
export const SHIP_ATTACKER_BONUS = 120;

/** 补刀权重：满幅 300，与舰队级 aiDirector.scoreTarget 同量纲 */
export const SHIP_LOW_HP_WEIGHT = 300;

/** 威胁压制权重：dps 25（atk50/2s）→ 100 分 ≈ 33% 血量差 */
export const SHIP_DPS_WEIGHT = 4;

/** 距离惩罚权重：射程边缘 880px → −220 分；同型同血时近者优先，但不压过补刀/威胁 */
export const SHIP_DIST_WEIGHT = 0.25;

export function scoreShipTarget(c: ShipTargetCandidate): number {
  let score = (1 - c.hpPct) * SHIP_LOW_HP_WEIGHT
    + c.dps * SHIP_DPS_WEIGHT
    - c.dist * SHIP_DIST_WEIGHT;
  if (c.focusRank >= 0 && c.focusRank < SHIP_FOCUS_BONUS.length) {
    score += SHIP_FOCUS_BONUS[c.focusRank];
  }
  if (c.attacker) score += SHIP_ATTACKER_BONUS;
  return score;
}

export interface ShipPick {
  target: ShipTargetCandidate | null;
  keptPrev: boolean;
  reason: string;
}

/**
 * 开火选舰（含滞回）。换目标必须领先 SHIP_TARGET_HYSTERESIS_RATIO 以上；
 * 旧目标死亡/出射界 = 不在候选里 ⇒ 自然换人（"死亡/出界/更高优先级才换"的粘性契约）。
 */
export function pickShip(
  cands: readonly ShipTargetCandidate[],
  prevId: string | number | null | undefined,
): ShipPick {
  if (!cands || cands.length === 0) return { target: null, keptPrev: false, reason: '无候选目标' };
  let best: ShipTargetCandidate = cands[0];
  let bestScore = -Infinity;
  let prev: ShipTargetCandidate | null = null;
  let prevScore = -Infinity;
  for (const c of cands) {
    const sc = scoreShipTarget(c);
    if (c.id === prevId) { prev = c; prevScore = sc; }
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  if (prev && prevScore >= bestScore - Math.abs(bestScore) * SHIP_TARGET_HYSTERESIS_RATIO) {
    return { target: prev, keptPrev: true, reason: '目标滞回：旧目标未落后 12% 以上' };
  }
  return { target: best, keptPrev: false, reason: '切换到评分最高目标' };
}
