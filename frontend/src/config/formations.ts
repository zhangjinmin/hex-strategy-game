/**
 * 阵型系统配置
 * 
 * 5种阵型覆盖战略层自动裁决和战术层初始布阵。
 * 互克关系：楔→方→纵→纺锤→横→楔（五行式闭合环）
 */

export type FormationType = 'wedge' | 'line' | 'spindle' | 'circle' | 'square';

export interface FormationConfig {
  id: FormationType;
  name: string;
  description: string;
  icon: string;           // 单字标识
  attackMod: number;      // 攻击乘数
  defenseMod: number;     // 防御乘数
  speedMod: number;       // 机动乘数
  moraleCost: number;     // 阵型转换士气消耗
  counters: FormationType; // 克制谁
}

/**
 * 阵型配置表
 * 
 * 互克环（完整五边形闭环）：
 *   楔→横→纺→圆→方→楔
 *   楔形突破横阵正面，横阵火力压制纺锤，
 *   纺锤机动绕圆阵，圆阵消耗方阵，方阵抵御楔形突击
 */
export const FORMATIONS: Record<FormationType, FormationConfig> = {
  wedge: {
    id: 'wedge',
    name: '楔形阵',
    description: '帝国军经典突击阵型，舰首集中突破。克制横阵。',
    icon: '楔',
    attackMod: 1.15,
    defenseMod: 0.85,
    speedMod: 0.90,
    moraleCost: 10,
    counters: 'line',
  },
  line: {
    id: 'line',
    name: '横阵',
    description: '展开正面战线，火力密度最大。克制纺锤阵。',
    icon: '横',
    attackMod: 1.25,
    defenseMod: 0.75,
    speedMod: 0.85,
    moraleCost: 5,
    counters: 'spindle',
  },
  spindle: {
    id: 'spindle',
    name: '纺锤阵',
    description: '同盟军经典机动作战阵型。克制圆形阵。',
    icon: '纺',
    attackMod: 1.00,
    defenseMod: 1.10,
    speedMod: 1.10,
    moraleCost: 8,
    counters: 'circle',
  },
  circle: {
    id: 'circle',
    name: '圆形阵',
    description: '全方位防御阵型，适合护卫/撤退。克制方阵。',
    icon: '圆',
    attackMod: 0.70,
    defenseMod: 1.35,
    speedMod: 0.60,
    moraleCost: 12,
    counters: 'square',
  },
  square: {
    id: 'square',
    name: '方阵',
    description: '铁壁防御阵型，360°火力覆盖。克制楔形阵。',
    icon: '方',
    attackMod: 0.80,
    defenseMod: 1.25,
    speedMod: 0.70,
    moraleCost: 8,
    counters: 'wedge',
  },
};

/** 默认阵型（无选择时使用） */
export const DEFAULT_FORMATION: FormationType = 'wedge';

/**
 * 7x7棋盘上的阵型模板坐标（一键布阵使用）
 * 坐标以棋盘左上角为原点 (x: 0-6, y: 0-6)
 */
export const FORMATION_LAYOUTS: Record<FormationType, [number, number][]> = {
  wedge:   [[0,3],[1,2],[1,4],[2,1],[2,5],[3,0],[3,6],[4,2],[4,4],[5,3]], // 楔形 V字
  line:    [[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3]],                  // 横阵 单行
  spindle: [[3,1],[3,2],[3,3],[3,4],[3,5],[2,2],[4,2],[2,3],[4,3],[2,4],[4,4]], // 纺锤 中心列
  circle:  [[2,2],[3,2],[4,2],[2,3],[4,3],[2,4],[3,4],[4,4]],            // 圆形 环
  square:  [[1,1],[2,1],[3,1],[4,1],[5,1],[1,2],[5,2],[1,3],[5,3],[1,4],[5,4],[1,5],[2,5],[3,5],[4,5],[5,5]], // 方阵 边框
};

/** 一键布阵：按阵型模板将编成舰种放置到棋盘 */
export function layoutFormationSlots(
  formation: FormationType,
  composition: { battleships?: number; fastBattleships?: number; cruisers?: number; destroyers?: number; carriers?: number; fighters?: number },
): { x: number; y: number; type: string; count: number }[] {
  const template = FORMATION_LAYOUTS[formation] || FORMATION_LAYOUTS.wedge;
  const slots: { x: number; y: number; type: string; count: number }[] = [];

  // 舰种优先级：主力舰居中，支援舰外围
  const priority: [string, number][] = [
    ['battleships', (composition.battleships || 0) + (composition.fastBattleships || 0)],
    ['carriers', composition.carriers || 0],
    ['cruisers', composition.cruisers || 0],
    ['destroyers', composition.destroyers || 0],
    ['fighters', composition.fighters || 0],
  ].filter(([, c]) => c > 0) as [string, number][];

  // 中心优先：楔形模板第1-2个坐标为中心，依次外扩
  const centerFirst = [...template].sort((a, b) => (Math.abs(a[0]-3)+Math.abs(a[1]-3)) - (Math.abs(b[0]-3)+Math.abs(b[1]-3)));

  let idx = 0;
  for (const [type, count] of priority) {
    if (idx >= centerFirst.length) break;
    const [x, y] = centerFirst[idx];
    slots.push({ x, y, type, count: Math.floor(count / 10) * 10 || 100 });
    idx++;
  }
  return slots;
}

/** 阵型互克加成倍率（克制方对被克制方） */
export const FORMATION_COUNTER_BONUS = 1.30;
/** 被克制方战力惩罚倍率（供战术/战略层引用） */
export const FORMATION_COUNTERED_PENALTY = 0.90;

/**
 * 计算阵型互克加成
 * @returns bonus: 攻击方对阵防守方的额外加成（1.0 = 无加成，1.30 = +30%）
 */
export function getFormationCounterBonus(attackerForm: FormationType, defenderForm: FormationType): number {
  const form = FORMATIONS[attackerForm];
  if (!form) return 1.0;
  return form.counters === defenderForm ? FORMATION_COUNTER_BONUS : 1.0;
}

/**
 * 获取阵型综合战力修正
 * 用于战略层 autoResolveBattle / calculatePower
 */
export function getFormationCombatMods(form: FormationType): {
  attackMod: number;
  defenseMod: number;
  speedMod: number;
} {
  const cfg = FORMATIONS[form];
  if (!cfg) return { attackMod: 1.0, defenseMod: 1.0, speedMod: 1.0 };
  return {
    attackMod: cfg.attackMod,
    defenseMod: cfg.defenseMod,
    speedMod: cfg.speedMod,
  };
}
