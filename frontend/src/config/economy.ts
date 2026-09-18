/**
 * economy.ts — 经济数值单一真源（v4 统一量纲）
 *
 * 量纲锚点（对抗性校准于 2026-08）：
 *   - 日税收基线 ≈ 70万金/日（同盟 14 星，nodeStore 公式 pop×econ×rate×治安）
 *   - 满编舰队维护 ≈ 44万金/日（收入的 ~60-80%）→ 平时微盈、战时必亏
 *   - 一场中等战损（~3000舰）重建费 ≈ 150-250万 ≈ 2-4 天收入
 *   - 一次远程跃迁 ≈ 日收入 10-15%
 * 所有关于"金"的常量集中在此文件。战术层 HP 基值在 types/game.ts SHIP_TYPES（勿混用）。
 */

// ========== 国库 ==========

/** 各阵营初始国库（按剧本） */
export const INITIAL_GOLD = {
  astarte_eve: { alliance: 100000000, empire: 120000000 },
  empire_civil_war: { alliance: 100000000, empire: 80000000 },
  great_expedition: { alliance: 50000000, empire: 200000000 },
  default: { alliance: 100000000, empire: 120000000 },
} as const;

/** AI 国库低于此值停止扩张行动 */
export const AI_TREASURY_MINIMUM = 500000;

/** 费沙初始金库（第三方经济势力，坐收贸易过路费与贷款本息） */
export const FEZZAN_INITIAL_GOLD = 200000000;

/** 国库赤字每日惩罚 */
export const DEFICIT_PENALTY = {
  morale: 3,
  supply: 2,
} as const;

// ========== 舰船 ==========

/** 舰船造价（金/艘）— 经济造价单一真源 */
export const SHIP_COST = {
  battleship: 800,
  fastBattleship: 1000,
  cruiser: 250,
  destroyer: 120,
  carrier: 1200,
  fighter: 30,
  supply: 300,      // 补给运输舰(AUX)：后勤战核心，造价适中（低于战舰，高于驱逐）
  default: 250,
} as const;

/** 舰队维护费（金/艘/日） */
export const SHIP_MAINTENANCE = {
  battleship: 6,
  fastBattleship: 5.5,
  cruiser: 2,
  destroyer: 1,
  carrier: 7,
  fighter: 0.1,
  supply: 1.5,      // 补给运输舰维护低（民用底盘）
} as const;

/** 每舰船员数（抚恤金基数） */
export const SHIP_CREW = {
  battleship: 3000,
  fastBattleship: 2500,
  cruiser: 1000,
  destroyer: 500,
  carrier: 5000,
  fighter: 50,
  supply: 200,      // 补给运输舰：少量船员（自动化货运）
} as const;

/** 抚恤金 = 船员数 × 此系数（金/人） */
export const PENSION_RATE = 5;

// ========== 提督工资（月薪制，金/月） ==========

export const ADMIRAL_SALARY: Record<number, number> = {
  1: 5000, 2: 6000, 3: 7500, 4: 10000,      // 尉官
  5: 15000, 6: 20000, 7: 25000,              // 校官
  8: 35000, 9: 50000,                        // 少将
  10: 75000, 11: 125000, 12: 200000, 13: 300000, // 上将/元帅
};

/** 赏赐提督花费（按军阶，一次性） */
export const ADMIRAL_REWARD_COST: Record<number, number> = {
  1: 25000, 2: 25000, 3: 25000, 4: 25000,
  5: 40000, 6: 40000, 7: 40000,
  8: 75000, 9: 100000,
  10: 150000, 11: 250000, 12: 250000, 13: 400000,
};

/** 晋升仪式花费 */
export const PROMOTION_CEREMONY_COST = 50000;

// ========== 费沙贷款 ==========

export const FEZZAN_LOAN = {
  /** 额度 = 当前国库 × 此系数 */
  LIMIT_MULTIPLIER: 2,
  /** 最低放贷额 */
  MIN_LOAN: 10000000,
  /** 月利率（30游戏日结息） */
  MONTHLY_INTEREST: 0.05,
  /** 还款期限档位（天） */
  TERMS: [60, 120, 240] as const,
  /** 逾期利率提升 */
  DEFAULT_INTEREST_RATE: 0.08,
  /** 逾期2期强制扣款比例 */
  FORECLOSE_RATIO: 0.30,
} as const;

// ========== 行星操作成本 ==========

export const LOCAL_OP_COST = {
  special_tax: { gold: 0, cooldown: 10, reward: 50000 },
  security_boost: { gold: 30000, cooldown: 7 },
  welfare_invest: { gold: 80000, cooldown: 15 },
  fortify_local: { gold: 400000, cooldown: 30, oncePerNode: true },
  emergency_draft: { gold: 60000, cooldown: 10 },
  intel_gather: { gold: 20000, cooldown: 5 },
} as const;

// ========== 敌方行动成本 ==========

export const ENEMY_OP_COST = {
  recon: { gold: 20000, cooldown: 7 },
  infiltrate: { gold: 30000, cooldown: 15 },
  sabotage: { gold: 50000, cooldown: 30 },
  blockade: { gold: 80000, cooldown: 20 },
} as const;

// ========== 费率 ==========

export const ECONOMY_RATES = {
  /** 基础税率滑杆默认值（0.10~0.30） */
  baseTaxRate: 0.10,
  /** 战争附加税开启时的税率 */
  warTaxRate: 0.15,
  /** 相邻星球间贸易系数：每单位 min(economy) 产出的日贸易额。
   *  [PLACEHOLDER] 对抗性校准：日税收基线≈70万金，贸易应占收入的 15%~30%（约10~20万金/日）。
   *  相邻普通星 economy≈1300 → 单条贸易线≈208金/日；14星全连接≈25条线≈2~3万金/日。
   *  （费沙抽成 fezzanTollRate=50% 后，玩家实得约1~1.5万金/日，占收入~15%） */
  tradeCoefficient: 0.16,
  /** 治理费基础费率（占 economy 比例）[PLACEHOLDER] */
  governanceBaseRate: 0.05,
  /** 治理费超额递增：每多一颗占领星，费率 +此值（非线性边际成本，模拟帝国官僚低效） */
  governanceExtraPerNode: 0.005,
  /** 免治理费递增的星域数（前 N 颗星维持基础费率） */
  governanceFreeNodes: 6,
  /** 费沙过路费抽成比例：贸易收入归费沙的比例（费沙回廊垄断） */
  fezzanTollRate: 0.5,
  /** nodeStore 税收公式的基准乘数（对应税率滑杆 10%） */
  nodeTaxBase: 0.01,
} as const;

// ========== 战损经济 ==========

export const WAR_ECONOMY = {
  /** 修理费 = HP损失 × 此系数（金/点） */
  repairCostPerHp: 2,
  /** 战利品系数：掠夺 = economy × mul + defenseHp × hpMul */
  pillageMul: 1500,
  pillageHpMul: 200,
  /** 掠夺后受损比例（经济/防御/治安） */
  pillageEconomyDamage: 0.40,
  pillageDefenseDamage: 0.40,
  pillageSecurityDamage: 0.50,
  pillageMinStat: 20,
  /** 占领/解放功勋 */
  liberateMerit: 300,
  occupyMerit: 500,
} as const;
