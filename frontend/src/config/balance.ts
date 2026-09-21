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

// ========== 战术层增维（v33：旧案 44 图战术模块整合）==========
//
// 全部为**新增乘区/状态**，每一项都有独立总开关（回退只需改此处）。
// 设计口径：**只借旧案结构，数值一律重标定**——旧案数值来自 2012 年草稿，
// 与现项目量纲差 1~2 个数量级（旧案舰体 hp 1500 / 装甲 120，现项目 hp 1200 / def 15）。

/**
 * 总开关：关掉即回到 v32 行为（零回归面）。
 * 分项开关便于定位"哪一项导致了手感变化"。
 */
export const TACTICAL_V33 = {
  /** P0-1 阵型互克收口（单一真源）。关掉 = 战术层退回旧内联表（不推荐，仅用于对比取证） */
  UNIFIED_COUNTERS: true,
  /** P0-2 列位 × 距离带矩阵 */
  COLUMN_MATRIX: true,
  /** P0-3 前/侧/后 三档方向装甲 */
  DIRECTION_ARMOR: true,
  /** P1-4.1 地形索敌修正 + 机雷/杰夫粒子云持续损伤 */
  TERRAIN_VISION: true,
  TERRAIN_DOT: true,
  /** P1-4.2 拦截减伤 */
  INTERCEPT: true,
  /** P1-4.3 阵型崩溃状态 */
  FORMATION_COLLAPSE: true,
  /** P1-4.5 舰种偏好距离带 */
  SHIP_BAND: true,
} as const;

/**
 * 列位 × 距离带矩阵（P0-2）。
 *
 * 值域语义：**1.0 = 基准**。旧案原表（前列 150/80/100/120 …）的三个行均值不等
 * （112.5 / 102.5 / 100），直接采用等于给全部单位**隐性加成 ~5%**。
 * 故此处已**按行归一**（各除以自身均值）：
 *   前列 150,80,100,120 / 112.5 → 133,71,89,107
 *   中列 100,150,80,80  / 102.5 →  98,146,78,78
 *   后列  80,120,150,50 / 100   →  80,120,150,50
 * ⚠ 消费侧的最终乘区还要再除「该阵型在近/中/远三档的**等权平均**」
 *   （见 formationColumns.columnBaseline）⇒ **净增益恒为 1.0**，
 *   矩阵只把"能否维持理想交战距"变成**阵型敏感项**。
 */
export const COLUMN_MATRIX: Record<string, { near: number; mid: number; far: number; strike: number }> = {
  front:  { near: 1.33, mid: 0.71, far: 0.89, strike: 1.07 },
  mid:    { near: 0.98, mid: 1.46, far: 0.78, strike: 0.78 },
  rear:   { near: 0.80, mid: 1.20, far: 1.50, strike: 0.50 },
  /** 中心对称阵型（圆形/方阵）专用：无前后列之分 ⇒ 恒中性 */
  center: { near: 1.00, mid: 1.00, far: 1.00, strike: 1.00 },
};

/**
 * 距离带阈值（相对该舰队"理想交战距" `getIdealEngageDist` 的比例）。
 *
 * ⚠ **不可用绝对格数**：射程与 `hexRadius` 都随地图缩放（26~50），
 *   用绝对格数分档会让小地图全部落进同一档。
 *
 * **滞回**是必需的：单位距离逐帧变化，若单阈值会让伤害数字逐帧跳变
 * （用户会直接当成 bug 报回来）。进入/退出用不同阈值。
 */
export const RANGE_BAND = {
  /** 进入 near 的上界；退出 near 的下界（= HYST_NEAR） */
  ENTER_NEAR: 0.85,
  /** near ↔ mid 的滞回带宽：d > ENTER_NEAR + 此值 才算离开 near */
  HYST_NEAR: 0.05,
  /** 进入 far 的下界；退出 far 的上界（= ENTER_FAR − HYST_FAR） */
  ENTER_FAR: 1.15,
  HYST_FAR: 0.05,
} as const;

/**
 * 方向装甲（P0-3）。旧案三向装甲只取**偏序**，绝对量级由此处重标定。
 * 倍率 = clamp((前装甲 / 该方向装甲)^ARMOR_EXP, 下限, 上限)
 *   ARMOR_EXP = 0.30（幂次压缩）：线性用装甲比会得到 8.33× 这种破坏平衡的值。
 * clamp **不夹任何舰种**（台架断言覆盖全部 7 个有剖面的舰种）⇒ 旧案偏序完整保留。
 * clamp 下限**锚定现状**：背面下界 1.20 > 正面，上界 2.00 容得下旧实现的固定 ×1.5
 *   ⇒ 现有平衡不会突变（战列背面 1.62 vs 旧固定 1.5，差 0.12）。
 */
export const DIRECTION_ARMOR = {
  /**
   * 幂次压缩指数。**取 0.30 而不是 0.5（开方）—— 台架实测开方会「clamp 饱和吃掉偏序」**：
   * 开方下 战列 前/后 = 5 → 2.236、高战 前/后 = 8.33 → 2.887，两者都被 REAR_MAX=2.00 夹住
   * ⇒ "高速战舰最怕后击"这条旧案偏序在背面档**失效**（都变成 2.00）。
   * 改 0.30 后全部落在 clamp 区间内、偏序完整：
   *   背面：高战 1.89 > 驱逐 1.71 > 战列/巡洋 1.62 > 电子 1.44 > 空母 1.34 > 补给 1.32
   *   侧面：高战 1.53 > 巡洋 1.32 > 战列/驱逐 1.23 > 电子 1.15 > 空母/补给 1.09
   * 且战列背面 1.62 仍贴近旧实现的固定 ×1.5（差 0.12）⇒ 既有平衡不突变。
   */
  EXP: 0.30,
  SIDE_MIN: 1.00,
  SIDE_MAX: 1.60,
  REAR_MIN: 1.20,
  REAR_MAX: 2.00,
  /** 方向分档边界（弧度，以"受击方朝向"为参考系）：≤45° 正面 / ≤135° 侧面 / 其余背面 */
  FRONT_MAX_RAD: Math.PI * 0.25,
  SIDE_MAX_RAD: Math.PI * 0.75,
  /** 判 CRIT! 提示的阈值（沿用既有 isCrit 口径） */
  CRIT_THRESHOLD: 1.2,
  /** 参考舰队朝向取"实际运动方向"的速度平方下限；低于此值回退 formFacing/facingAngle。
   *  取舰首**平滑值**会在急转/撤退时出现"背向敌人却在挨正面的伤"的观感矛盾。 */
  MIN_SPD2_FOR_MOTION: 0.25,
} as const;

/**
 * 拦截减伤（P1-4.2）。**不做弹道实体**——现项目无弹道层，加实体收益/成本比不成立。
 * 改为在 finalDmg 上乘 1/(1+rate)。
 * rate = clamp(加权防空均值/100 × K, 0, MAX)
 *   舰种防空权重取旧案**偏序**（巡航舰 150 最高 = 防空核心 → 现项目"巡洋"）
 */
export const INTERCEPT = {
  /** 加权防空均值(100 基准) → rate 的斜率 */
  K: 0.25,
  MAX: 0.55,
  /** 特技 intercept_bonus 的贡献上限（绝对加值） */
  SKILL_MAX: 0.25,
} as const;

/**
 * 阵型崩溃（P1-4.3）。旧案效果"火力、回避、机动 −50%"。
 * ⚠ 旧案把「崩溃」列在**阵型表**里，那是"当前状态"视角列表 ⇒
 *   此处实现为**状态**（`fleet._formationCollapsed`），不是玩家可选的阵型项。
 * 定位：**士气崩坏与撤退档之间的中间态**（补 `retreatDoctrine` 三档之前的空缺）。
 */
export const FORMATION_COLLAPSE = {
  FIRE_MUL: 0.50,
  /** 受击防御乘区（作用于 effectiveDef；<1 = 更脆弱） */
  DEF_MUL: 0.50,
  SPEED_MUL: 0.50,
  /** 进入：士气低于此值（落在 DISENGAGE_MORALE 60 与 WITHDRAW_MORALE 25 之间） */
  ENTER_MORALE: 40,
  /** 进入：且兵力比例低于此值（避免"仅士气低"就崩溃，需战场态势配合） */
  ENTER_HP_FRAC: 0.60,
  /** 恢复：士气回到此值以上（= RALLY_MORALE 同口径） */
  RECOVER_MORALE: 70,
  /** 旗舰（formationSlot === 0）自上场以来首次消失 → 必然触发一次 */
  FLAGSHIP_LOSS_TRIGGERS: true,
  /** 溃散（rout）时必然崩溃 */
  ROUT_TRIGGERS: true,
} as const;

/**
 * 地形影响（P1-4.1）。等级 → 乘系数（借旧案"无/小/中/大/极大"的**偏序**）。
 *
 * 视觉保真（损伤列 = DOT）：机雷/杰夫粒子云的持续损伤，
 * 每 DOT_TICK_MS 对格内单位扣 maxHp × DOT_PCT。
 */
export const TERRAIN_RULES = {
  /** 等级 → 乘数（用于移速/射程/索敌） */
  LEVEL: { none: 1.00, small: 0.90, mid: 0.75, large: 0.55, huge: 0.35 } as Record<string, number>,
  DOT_TICK_MS: 3000,
  DOT_ENABLED_DEFAULT: true,
  /**
   * ⚠ [v35 G1] **地形效果总开关**（移速/射程/闪避/索敌/持续损伤一并受控）。
   *
   * 为什么要有它：这五项**代码一直都在**（v33 之前就写好了），但 `terrain` 字段
   * **从未从 `mapDataMatrix` 搬进战场 tile**（`BattleScene.renderHexMap` 重建 tile 对象时漏了）
   * ⇒ `getTerrainAt().terrain` 恒 `undefined` ⇒ 六个消费者全部空转 ⇒ 战场"零地形"。
   * 2026-09-20 补上字段搬运后，这五项会**同时第一次生效**（移速 0.55~1.30 / 射程 0.70 /
   * 闪避 ÷1.20 / 索敌 ×0.80~0.96 / 机雷每 3s 扣 1.5% maxHp）
   * ⇒ 属**行为变更**，故给一个总开关：置 `false` 即回到"有地形视觉、无地形效果"。
   */
  BATTLE_ENABLED: true,
  /**
   * ⚠ 视野修正的**削弱系数**（0 = 地形完全不影响视野，1 = 用原始等级乘数）。
   *
   * 为什么需要它：`getVisionRange()` 的返回值是**索敌硬门**（`d < visionRange` 才进
   * `visibleEnemies`，再由 `clarity` 分级；`closestEnemyFleet` 又只取非 fuzzy 者）。
   * 实测基线：hexRadius=50 时非索敌姿态视野 ≈ 484px，而接战发生在数百 px 上。
   * 若直接乘「索敌 大 = 0.55」⇒ 视野掉到 266px（≈5.3 格），**舰队将看不见敌人、
   * 目标永久丢失**（AI 会在这些地形里空转）——这是"改一个乘数打断一个系统"的典型。
   * 取 0.45 ⇒ 0.55 生效为 **0.80（−20%）**、0.75 → 0.89、0.90 → 0.96：
   * 足够形成"索敌困难、需逼近才发现"的体感，又不越过丢目标的悬崖。
   */
  VISION_STRENGTH: 0.45,
  /**
   * [v36d] **地形生成模式开关**：
   *   `true`  = 区域化（播种子 + 泛洪生长 ⇒ 少量大片区域）
   *   `false` = 旧的**逐格独立掷骰**（26% 覆盖率的白噪声）
   *
   * 为什么要改：逐格独立掷骰下 6 种地形均分 ⇒ **P(相邻两格同类型) ≈ 4%**
   * ⇒ 96% 的相邻边都是"类型分界" ⇒ 画面上必然是"六边形彩色马赛克"，
   * 而不是"空域地形"。真实宇宙地貌是**空间连贯的区域**（一片星云、一条小行星带），
   * 所以问题不在配色/透明度，在**生成粒度**。
   */
  REGION_GEN: true,
  /** 区域化的总体覆盖率（占"可放置格"的比例）；旧模式为 ~27% */
  COVERAGE: 0.18,
  /** 单个区域的格数区间 `[min, max]`（大小混合 ⇒ 形状与体量都有层次） */
  REGION_SIZE: [22, 62] as [number, number],
  /** 区域之外额外撒的零散单格比例（保留一点随机颗粒感，0 = 完全无颗粒） */
  SCATTER: 0.04,
} as const;

/**
 * [v36c] 空域地形**分区层**在 3D 战场的呈现参数。
 *
 * 为什么地形必须画进 3D 层：`App.vue` 在 3D 就绪后给 body 加 `battle3d-mode`，
 * 其 CSS 是 `body.battle3d-mode #phaser-canvas-container canvas { visibility: hidden }`
 * ⇒ 指挥制（`is3dBattle` 含 `'command'`）下**整个 Phaser 画布被隐藏**。
 * 也就是说，画在 `BattleScene` 里的地形标记在实机上是**结构性不可见**的
 * （2026-09-20 实测：把 801 个地形斑填成不透明品红，屏幕上品红像素 = 0）。
 *
 * 这组参数是"多亮才读得出来 / 多亮开始刺眼"的纯观感取舍，集中在此便于一次调参。
 */
export const TERRAIN_ZONE = {
  /**
   * [v38] 呈现方式。
   * · `'scanline'`（**默认**，2026-09-20 起）= CRT 扫描线：把地形格**按连通区域合并**后，
   *   沿世界 X 方向逐行画细线，线高按正弦起伏 ⇒ 读作"起伏的扫描线"而不是"色块"。
   * · `'fill'` = v36c 的六边形面填充（保留以便一键回退；该模式已被用户判为"彩色拼贴"）。
   * 两者**共享同一份数据与颜色真源**，切换只影响画法。
   */
  MODE: 'contour' as 'contour' | 'scanline' | 'fill',
  /**
   * 面填充不透明度（`AdditiveBlending` 叠加）。
   *
   * ⚠ **不能按"线性叠加"直觉取值**：3D 层的全屏合成 shader 会把线性值做 sRGB 编码
   * （`col=pow(col,1/2.4)` 那段），而 sRGB 编码在暗区**大幅抬升**对比 ——
   * 线性 +0.07 落在 0.005 的背景上，显示端 ≈ 从 6/255 跳到 76/255。
   * 故 0.20 实测读作"彩色拼贴"，一路收到 **0.07** 才落到"环境底色"的量级。
   * 以后调这个值请以 **L2 截图实测**为准，不要按数值比例推。
   */
  FILL_ALPHA: 0.07,
  /**
   * **危险地形**（`terrainEffects.dotPct > 0`：机雷区 / 杰夫粒子云）的边界带不透明度。
   *
   * ⚠ 只有危险地形画边界 —— 这不是省事，是修一个观感缺陷：
   *   `nbSame` 触发"跳过内部边"的概率 = P(邻居是**同一种**地形)。
   *   实测密度 814/3169 = 26%、6 种均分 ⇒ 单邻居同类概率仅 ≈4.3%
   *   ⇒ **96% 的边都是边界** ⇒ 每一格都套一圈亮边 = 六边形马赛克
   *   （首版 EDGE_ALPHA=0.6 时用户视角即"彩色拼贴"，且与
   *   "指挥制刻意隐藏 hex"的设计直接矛盾）。
   *   收敛为"只给会掉血的两种描边"：马赛克消失，而**唯一有玩法意义的信号**
   *   （哪里会持续损伤）反而更突出。
   */
  EDGE_ALPHA: 0.45,
  /**
   * 边界带半宽（× hexR）。用**带状网格**而非 `LineSegments`：
   * WebGL 下 `LineBasicMaterial.linewidth` 恒为 1 物理像素，远视角会细到看不见。
   */
  EDGE_HALF_WIDTH_K: 0.05,
  /** 离地高度（× hexR），略高于 y=0 的网格基准面，避免 z-fighting */
  Y_K: 0.06,
} as const;

/**
 * [v38 · G3] 占领进度环（`Battle3DOverlay.updateCaptureRings`）。
 *
 * 为什么必须画在 3D 层：占领进度原本唯一的反馈是"hex 透明度"（`BattleScene:1689`），
 * 而指挥制下 Phaser 画布被 `body.battle3d-mode` 整体隐藏 ⇒ 该反馈一个像素都看不到。
 * 全部尺寸以 hexR 为分母（hexR 随地图缩放 26~50，不可写绝对像素）。
 */
export const CAPTURE_RING = {
  /** 环内径（× hexR）—— 留出中继点模型本身的位置 */
  INNER_K: 0.62,
  /** 环外径（× hexR） */
  OUTER_K: 0.86,
  /** 离地高度（× hexR），略高于地形扫描线，避免叠在一起看不清 */
  Y_K: 0.34,
  /** 争夺色（琥珀）：刻意**不用阵营色** —— 本层不判定"谁在占"，避免与结算逻辑分叉 */
  COLOR: 0xfbbf24,
  /** 基准不透明度（再乘脉冲） */
  ALPHA: 0.85,
  /** 脉冲：读作"正在写入" */
  PULSE_BASE: 0.72,
  PULSE_AMP: 0.28,
  /** 脉冲频率（Hz） */
  PULSE_HZ: 1.1,
} as const;

/**
 * [v39] 地形 **等高线** 参数（`TERRAIN_ZONE.MODE === 'contour'`，当前默认）。
 *
 * 取代 v38 的扫描线：扫描线是规则等距平行线，只能编码"方向"、**不编码"高度"**，
 * 近景必然读作"单元格填充纹理"（用户实拍：「太整齐了…就是太密集，还不如六边形好看」）。
 * 等高线天生是高度的可视化：**每条线 = 一个高度层**。
 */
export const TERRAIN_CONTOUR = {
  /** 采样网格步长（× hexR）。0.40 ⇒ R=50、跨度 2000 时为 100×100 网格（一次性计算） */
  GRID_K: 0.40,
  /** 噪声特征尺寸（× hexR）—— 决定"地形团块"的尺度 */
  NOISE_CELL_K: 9.0,
  /** fbm 倍频数（2~3 足够；再多只加细节，在游戏缩放比下看不见） */
  OCTAVES: 3,
  /** 噪声种子（固定 ⇒ 同一局地形稳定、可复现） */
  SEED: 20260920,
  /**
   * 等高线条数 —— **"疏朗 vs 纹理化"的核心参数**。
   * v38 扫描线是每格 17 条（密排 ⇒ hatch）；这里全图只有 5 条。
   */
  LINES: 5,
  /** 等高线覆盖的高度范围（±此值；fbm 已归一化到 [-1,1]） */
  HEIGHT_SPAN: 0.85,
  /** 高度分层幅度（× hexR）：每条等高线的 y = baseY + level × amp */
  HEIGHT_AMP_K: 0.42,
  /** 线宽（× hexR） */
  WIDTH_K: 0.028,
  /** 亮度倍率：最低那条线 / 最高那条线（高处更亮 ⇒ 峰顶发光，读作高程） */
  LEVEL_BASE_MUL: 0.55,
  LEVEL_TOP_MUL: 1.35,
  /** 区域外轮廓亮度（环境 / 危险地形） */
  OUTLINE_BRIGHT_ENV: 0.85,
  OUTLINE_BRIGHT_HAZARD: 1.30,
  /** Chaikin 切角平滑迭代次数（1 次已明显去六边形锯齿；2 次更圆但收缩更多） */
  CHAIKIN_ITERS: 2,
  /** 轮廓外扩倍率 —— 补偿 Chaikin 的向心收缩 */
  OUTLINE_GROW: 1.035,
  /** 不透明度：环境 / 危险地形 */
  ALPHA_ENV: 0.62,
  ALPHA_HAZARD: 0.92,
} as const;

/**
 * [v38] 地形 **CRT 扫描线** 参数（`TERRAIN_ZONE.MODE === 'scanline'` 时生效）。
 *
 * ── 为什么改成扫描线（第一性原理）────────────────────────────────────
 * v36c 的"每格一个六边形色块 + 边界带"有两个绕不开的问题：
 *   ① **形状语言错**：地形是"一片空域"，而六边形是**网格语言**（指挥制刻意隐藏 hex）；
 *   ② **白噪声**：逐格上色 ⇒ 相邻格类型不同处必然产生边界，无论怎么调 alpha，
 *      读出来的都是"撒盐粒/拼贴"，而不是"这里有一片星云"。
 * v38 改法：**先在数据层把同类地形按连通区域合并，再按扫描行画线**。
 *   线在区域内部**贯通**（相邻同类格之间不再断），只在区域外缘停止
 *   ⇒ 形状由**区域的并集**自然给出，不再有六边形痕迹。
 *   线的 y 按正弦起伏 ⇒ 视觉上是"扫描波形"，正是 CRT 的语感。
 *
 * ⚠ 所有量都以 **hexR 为分母**（射程/格距随地图缩放 26~50），不可写绝对像素。
 */
export const TERRAIN_SCAN = {
  /** 扫描线间距（× hexR）。R=50 ⇒ 6.0 世界 px ⇒ 单格约 17 条线 */
  STEP_K: 0.12,
  /**
   * 危险地形（`dotPct > 0`）的间距倍率 —— 线**更密**。
   * "密 = 危险"是可读的视觉语言，比再加一圈描边更符合扫描线风格。
   */
  HAZARD_STEP_MUL: 0.60,
  /**
   * 线宽（× hexR，沿 z 方向的带厚）。
   * ⚠ 用**带状网格**而不是 `LineSegments`：WebGL 下 `LineBasicMaterial.linewidth`
   * 恒为 1 物理像素，远视角会细到看不见；但扫描线本来就该细，故取 0.030（R=50 ⇒ 1.5px）。
   */
  WIDTH_K: 0.024,
  /** 起伏振幅（× hexR）——"起伏"的主要来源 */
  AMP_K: 0.150,
  /** 起伏波长（× hexR）——每条线自身的波动疏密 */
  WAVE_LEN_K: 3.20,
  /**
   * 沿 z 的相位推进（× hexR）。
   * 相邻扫描线相位不同 ⇒ 整片读作"一道波在区域里传播"，这是扫描感的关键；
   * 若全部同相，所有线会同步上下 = 像一块被抬起的板，不是扫描线。
   */
  PHASE_Z_K: 1.10,
  /**
   * 区间合并阈值（× hexR）。
   * ⚠ 这是"区域感"的核心参数：设 0 则只合并真正重叠的区间，区域内的**凹口**会留下断口；
   * 给一点容差后，同一片空域的扫描线贯通成整条。
   */
  MERGE_GAP_K: 0.42,
  /** 每条扫描线的分段长度上限（× hexR）。段越短 ⇒ 起伏被采样得越密 */
  SEG_LEN_K: 1.10,
  /** 单条扫描线最多分几段（防止超长区间把顶点数拉爆） */
  SEG_MAX: 24,
  /** 弦半宽小于此值（× hexR）的行不画 —— 六边形上下顶点附近弦极短，画出来是碎点 */
  MIN_CHORD_K: 0.07,
  /** 不透明度：环境类 / 危险类（`AdditiveBlending` 叠加，实际亮度高于此值） */
  ALPHA_ENV: 0.28,
  ALPHA_HAZARD: 0.62,
  /**
   * 扫描刷新：每 N 条出现一条**亮线**（亮度 × `REFRESH_MUL`）。
   * 用**顶点色**实现（因为 alpha 是材质级、无法逐线变化），模拟 CRT 的场刷新。
   */
  REFRESH_PERIOD: 5,
  REFRESH_MUL: 1.75,
} as const;

/**
 * v33 新增乘区的**合并钳制**：`colMul × bandMul × collapseFireMul × interceptMul` 的乘积上下限。
 *
 * 为什么必须有：`BattleScene` 的 `finalDmg` 在 v32 已有 **9 个乘区**，v33 再追加 4 个
 * ⇒ 理论上限会从 ~3.0× 推到 5× 以上（各乘区独立可到 1.33 / 1.05 / 1.0 / 1.0，
 * 反向叠加时下界同样会击穿）。单看每个乘区都"温和"，但**乘区是相乘的**。
 * 这不是精度问题，而是"某一帧出现秒杀级伤害"的成因（见 docs/design/loch-web-plan/02 §6.2）。
 *
 * 口径：对本轮新增的 4 个乘区**先合并再钳制**，不动既有的 9 个（它们的平衡已 playtest）。
 */
export const TACTICAL_COMBO_CLAMP = {
  MIN: 0.30,
  MAX: 1.80,
} as const;

/**
 * 舰种偏好距离带（P1-4.5）。旧案的"主炮/轨道炮/导弹"三武器槽 → 不新增结构，
 * 只在**语义层**给每个舰种标注它最舒服的距离带，命中则小幅增益。
 * ±5% ⇒ 鼓励混编（各带都有舰），但不至于碾压。
 */
export const SHIP_BAND = {
  MATCH_MUL: 1.05,
  MISMATCH_MUL: 0.97,
} as const;

/** [v42] FORMATION_SPIN 已删除：格位朝向冻结后 snap/arc 模式与吸附阈值均无消费
 *  （转向重做详见 docs/qa/v42_转向重做_20260921.md 与 BattleScene :5369 注释）。 */

/**
 * [v41b] **掉头协议**（原地转身）参数 —— 修「整个阵型绕一个小原点画圈转向」。
 *
 * 卡点（三层叠加，单看每层都合理）：
 *   ① 位移方向 = `facingSmooth`（v34b 位移与推力自洽，正确）；
 *   ② `facingSmooth` 是慢速低通（π/240 rad/帧 + 角加速度惯量）—— 180° 要 ~5 秒；
 *   ③ v41 吸附判据 = |moveDir − formFacing|，而 **moveDir 是实际速度方向** ——
 *      弧线转弯时 moveDir 与 formFacing 一起慢转，两者差永远 ≈ 0
 *      ⇒ **吸附分支结构性永不触发**（判据测不到掉头）。
 *   ⇒ 位移方向以 0.75°/帧 慢转 ⇒ 中心航迹 = R = v/ω = 0.30×240/π ≈ **23px 的小圆**
 *      ⇒ 整个阵型像刚体绕一个小原点画圈（用户实报）。
 *
 * 协议：目标航向差 > ENTER ⇒ ① facingSmooth 快档转身（RATE_MUL 倍，无惯量）；
 *   ② [v47] 阵面 formFacing 协议期**冻结**（格位不平移 ⇒ 无公转），退出帧由 BattleScene formFacing
 *      管理器**一步阶跃**到新朝向 ⇒ 各舰限速直线飞入新阵位（列队重排）；
 *   ③ thrustFactor 压到 THRUST ⇒ 弧半径 < 1px = **原地转身**（用户：每艘舰自身原地变向）。
 *   差 < EXIT 退出，恢复正常低通。ENTER > EXIT 构成滞回，防阈值附近抖动。
 */
export const FACING_TURN = {
  /** 进入掉头协议的目标航向差。[v47] 50°→25°：用户要的是**一切有意义的改向**都走
   *  「原地转向 → 阵面阶跃 → 直线列队落位」，只让 ≥50° 走协议时，25~49° 的改向仍以
   *  R=v/ω 弧线拖阵型 ⇒ 小半径绕圈观感仍在（2026-09-21 实报）。 */
  ENTER_RAD: (25 * Math.PI) / 180,
  /** 退出协议（回到正常巡航转向）的目标航向差。[v47] 30°→12°：与新 ENTER 保持滞回带 */
  EXIT_RAD: (12 * Math.PI) / 180,
  /** 协议期转身速率 = HEADING_TURN_RATE × 此倍率（6× ⇒ 180° 约 40 帧 ≈ 0.67s） */
  RATE_MUL: 6,
  /** 协议期推力（0.30×0.06 = 0.018px/帧 ⇒ 航迹弧半径 < 1px，等于原地） */
  THRUST: 0.06,
} as const;
