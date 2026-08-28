/**
 * Balance Config — 游戏全局数值配置单一真源
 * 
 * 所有数值修改只需改此文件。每个常量必须标注:
 *   - 用途
 *   - 单位/量纲
 *   - [PLACEHOLDER] 标记（表示尚未 playtest 验证的值）
 */

// ========== 时间系统 ==========

/** 每天包含的 tick 数（游戏最小时间单位） */
export const TICKS_PER_DAY = 10;

// ========== 经济系统（已迁移到 economy.ts）==========
// INITIAL_FACTION_GOLD, AI_TREASURY_MINIMUM, WARP_COST, PLANET_ECONOMY 等已迁移

/** Warp 跃迁征途消耗公式系数：(totalShips / RATE_DIVISOR) * travelDays * COST_PER_UNIT（v4：一次远程跃迁≈日收入10-15%） */
export const WARP_COST = {
  RATE_DIVISOR: 100,
  COST_PER_UNIT: 100,   // 100舰·日 = ₮100
} as const;

// ========== 战斗系统 ==========

/** 自动战斗裁决默认参数 */
export const AUTO_RESOLVE = {
  /** 舰种系数（加权战斗力计算） */
  TYPE_COEFF: {
    battleships: 4.0,
    fast_battleships: 3.2,
    cruisers: 2.5,
    destroyers: 1.5,
    carriers: 2.0,
    fighters: 1.0,
  },
  /** 防守方要塞加成倍率 */
  FORTRESS_BONUS: 2.0,
  /** 决定性胜利（战力比 > 1.5）攻方损失范围 */
  DECISIVE_LOSS: { min: 0.05, max: 0.10 },
  /** 微弱胜利（1.0 < 战力比 <= 1.5）损失范围 */
  MARGINAL_LOSS: { min: 0.15, max: 0.25 },
  /** 胶着（0.7 < 战力比 <= 1.0）双方损失范围 */
  STALEMATE_LOSS: { min: 0.20, max: 0.30 },
  /** 溃败（战力比 <= 0.7）攻方损失范围 */
  ROUT_LOSS: { min: 0.40, max: 0.60 },
  /** 溃败守方损失范围 */
  ROUT_DEFENSE_LOSS: { min: 0.05, max: 0.10 },
} as const;

/** 撤退舰队损失率 */
export const RETREAT_LOSS = {
  MIN: 0.03,
  MAX: 0.08,
} as const;

// ========== 经济科技修正 ==========

/** 科技对经济的加成（科技等级 → 修正系数） */
export const TECH_ECONOMY_MOD = {
  MILITARY_MAINT_REDUCTION: [0, 0, 0.10, 0.20, 0],   // L2 军事:维护费-10%, L3: -20%
  POLITICAL_TAX_BOOST:      [0, 0.10, 0, 0, 0],       // L1 政略:税收+10%
  LOGISTICS_WARP_REDUCTION: [0, 0, 0, 0.30, 0],       // L3 后勤:跃迁消耗-30%
} as const;

// ========== 经济约束系统 ==========
// 舰船造价与维护费已统一迁移至 economy.ts（SHIP_COST / SHIP_MAINTENANCE），此处不再保留旧量级副本。

// ========== 提督伤亡系统 ==========

/** 战斗阵亡基础概率 */
export const CASUALTY = {
  BASE_DEATH_CHANCE: 0.02,       // 基础 2%
  MAX_DEATH_CHANCE: 0.15,        // 上限 15%
  LOSER_MULTIPLIER: 1.5,         // 败方概率 ×1.5
  INJURY_MULTIPLIER: 2.5,        // 受伤概率 = 阵亡概率 ×2.5
  KEY_ADMIRAL_MORALE_LOSS: 25,   // 关键提督阵亡时全军士气−25
  DATA_LOSS_DIVISOR: 20000,      // 损失数/此值用于计算额外风险
} as const;

/** 单舰队自动战斗伤亡概率 */
export const SINGLE_BATTLE_CASUALTY = {
  DESTROYED: { death: 0.25, injury: 0.50 },
  ROUT:      { death: 0.08, injury: 0.30 },
  ACTIVE:    { death: 0.03, injury: 0.15 },
} as const;

// ========== 科技系统 ==========

/** 科技等级加成（每级额外%） */
export const TECH_BONUS = {
  WEAPON: 0.05,      // 每级 +5%
  ARMOR: 0.05,       // 每级 +5%
  ENGINE: 0.04,      // 每级 +4%
  ELECTRONIC: 0.06,  // 每级 +6%
} as const;

// ========== Warp 系统 ==========

/** Warp 跃迁常量 */
export const WARP = {
  /** 跃迁速度（像素/天） */
  SPEED_PX_PER_DAY: 160,
  /** 跃迁行动最小间隔（tick）[PLACEHOLDER] */
  MIN_INTERVAL_TICKS: TICKS_PER_DAY * 2,
} as const;

// ========== 防御 AI ==========

/** 每轮最多派遣的防御舰队数 */
export const DEFENSIVE_AI_MAX_MOVES = 2; // [PLACEHOLDER]

// ========== 战术模拟默认 ==========

/** 战术模拟默认参数 */
export const SIM_DEFAULTS = {
  SHIPS_PER_FLEET: 5000,
  FLEETS_PER_SIDE: 1,
} as const;

// ========== 军衔系统 ==========

/** 每个军衔可指挥的最大舰队数 */
export const RANK_FLEET_LIMIT: Record<number, number> = {
  1: 1,   // 准尉
  2: 1,   // 少尉
  3: 1,   // 中尉
  4: 1,   // 上尉
  5: 2,   // 少校
  6: 2,   // 中校
  7: 2,   // 上校
  8: 3,   // 准将
  9: 3,   // 少将（可配副官）
  10: 4,  // 中将
  11: 0,  // 上将（无限制）
  12: 0,  // 一级上将
  13: 0,  // 元帅
} as const;

// ========== 提案系统 ==========

/** 每月自动生成提案数 */
export const PROPOSALS_PER_MONTH = 3; // [PLACEHOLDER]

// ========== 存档系统 ==========

/** 自动存档间隔（游戏日） */
export const AUTO_SAVE_INTERVAL_DAYS = 7;

// ========== 事件系统 ==========

/** 每日随机事件触发概率 */
export const DAILY_EVENT_CHANCE = 0.29; // [PLACEHOLDER]
