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
/**
 * 被克制方倍率。
 *
 * ⚠ 本常量此前导出后**全项目零消费**（死代码），原值 0.90；
 * v33 起战术层改为消费它（见 `formationCounterMul`），值对齐战术层既有口径 **0.70**
 * —— 目的是把"互克关系"收口为单一真源时**不改动既有战术平衡**。
 * 战略层（`getFormationCounterBonus`）不消费本常量，故修改它不影响战略层。
 */
export const FORMATION_COUNTERED_PENALTY = 0.70;

/**
 * 互克环的**唯一真源**（v33 收口）。
 *
 * 收口原因：本文件与 `BattleScene.ts` 曾各持一张表，且**两者互克关系相反**——
 *   本文件（+注释）：楔→横→纺→圆→方→楔
 *   BattleScene（内联）：楔→纺→圆→方→横→楔
 * ⇒ 同一对"楔 vs 横"，战略层判"楔克横"、战术层判"互不克制"；
 *   "楔 vs 纺" 则在战术层才成立。玩家在军议/参谋提示看到的信息与实战结算对不上。
 *
 * 取本文件口径的依据：① 在 config 层且有文档注释；② 战略层已引用；
 * ③ 军事直觉更顺——楔形突破薄正面故克横阵、横阵火力密度故克长条纺锤。
 * 行为变更：战术层 `wedge↔spindle`、`line↔wedge` 两组关系翻转（需台架+真机确认）。
 */
export const FORMATION_COUNTERS: Record<FormationType, FormationType> = {
  wedge: FORMATIONS.wedge.counters,
  line: FORMATIONS.line.counters,
  spindle: FORMATIONS.spindle.counters,
  circle: FORMATIONS.circle.counters,
  square: FORMATIONS.square.counters,
};

/**
 * 战术层互克乘区（攻方 → 守方）。单一入口，禁止再在任何地方内联 beats 表。
 *   · 攻方克制守方 → FORMATION_COUNTER_BONUS（1.30）
 *   · 被守方克制   → FORMATION_COUNTERED_PENALTY（0.70）
 *   · 互不克制     → 1.0
 * 未知阵型（undefined/新值）一律返回 1.0，不抛错。
 */
export function formationCounterMul(attacker: FormationType | string, defender: FormationType | string): number {
  if (!FORMATION_COUNTERS[attacker as FormationType] || !FORMATION_COUNTERS[defender as FormationType]) return 1.0;
  if (FORMATION_COUNTERS[attacker as FormationType] === defender) return FORMATION_COUNTER_BONUS;
  if (FORMATION_COUNTERS[defender as FormationType] === attacker) return FORMATION_COUNTERED_PENALTY;
  return 1.0;
}

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
