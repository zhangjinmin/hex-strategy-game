/**
 * [v40] **战术决策层** —— 把散落在 `BattleScene` 里的" situation → 行动"判断收拢成
 * **可断言的纯函数表**。
 *
 * ── 为什么必须有这个模块（用户原话）────────────────────────────────
 * 「补给变黄了，不论性格不论情况，就是直接转回去，不管三七二十一的，
 *   这种战场判断光是罗列情况和判断都可以列出几十条出来，都不用 AI，用 if 或者 switch 都可以啊」
 *
 * 确诊（带行号，2026-09-20 复核）：
 *  · v29 确实把「撤退触发」改成了性格驱动（`BattleScene:4556` `resolveRetreatTier`
 *    用 `doctrine.retreatThreshold` + 士气 + 兵力；补给**已不是**触发条件）——**这处是对的**；
 *  · **但 `:4977` 还留着 `needsTethering = currentSupply < 75`**：探索期补给低于 75%（黄色区）
 *    就"极度抗拒脱离后勤网"——**硬阈值、无性格、无态势，且优先级高于一切战术判断**；
 *  · 另有 `:4811` 补给圈内 `<90` 即停船。
 * ⇒ 玩家看到的"集体回头"来自这两条**没被重构**的旧逻辑，不是 v29 那条。
 *
 * ── 设计约束 ────────────────────────────────────────────────────────
 * · **全部纯函数**：输入态势，输出行动；无随机、无副作用、不读时钟
 *   ⇒ 同一态势恒同一决策（可复现、可截图定点、可被台架逐条断言）。
 * · **决策与执行分离**：本模块只回答"该做什么"，怎么飞/怎么转仍由 BattleScene 的
 *   运动学负责（v34b 的"方向与大小自洽"不受影响）。
 * · **性格用既有真源**：`AdmiralDoctrine.retreatThreshold`（动摇线）本身就是性格参数 ——
 *   高 = 谨慎、低 = 大胆。**不新增性格字段**，避免出现第二份性格真源。
 *
 * ⚠ 本模块被 `_v40_doctrine_sim.cjs` 直接 `require` 断言（铁律：台架打真源码）。
 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 简化、稳定的进取度：以中性动摇线为锚做线性映射，越低越大胆 */
export function aggression(retreatThreshold: number, neutralThreshold: number): number {
  if (!Number.isFinite(retreatThreshold) || !Number.isFinite(neutralThreshold) || neutralThreshold === 0) return 0.5;
  // threshold = neutral ⇒ 0.5；threshold = 0 ⇒ 1；threshold = 2×neutral ⇒ 0
  return clamp(1 - retreatThreshold / (2 * neutralThreshold), 0, 1);
}

// ══════════════════════════════════════════════════════════════════════
// A. 转向纪律
// ══════════════════════════════════════════════════════════════════════

export type TurnMode = 'free' | 'limited' | 'denied';

export interface TurnSituation {
  /** 是否正在交战（敌在接敌距离内） */
  engaged: boolean;
  /** 是否正在脱离（撤退 / 拖刀）—— 允许"边退边转"，但速率受限 */
  disengaging: boolean;
  /** 当前阵型朝向与目标方向的夹角（rad，0~π） */
  angleToTurn: number;
  /** 提督进取度 [0,1]：大胆的提督在交战中仍会抢 T 字位（小幅机动） */
  aggression: number;
}

export interface TurnOrder {
  mode: TurnMode;
  /** 乘在 `FORM_FACING_RATE` 上的速率倍率 */
  rateMul: number;
  /** 本次允许的最大转向角（rad；denied 时仍给一个小修正角，不是死 0） */
  maxStep: number;
  /** 决策依据（给战报/调试，一眼看出为什么） */
  reason: string;
}

/**
 * **转向纪律**（用户给出的规格，逐字实现）：
 *
 *  · 「没有敌人的情况下，直接转向」            → `free`
 *  · 「对战时要缓慢后退，再逐步转向」          → `limited`（脱离中：低速 + 限角）
 *  · 「还在对战就不能转向」                    → `denied`（交战中：只许小幅修正）
 *
 * 追加两条让"denied"不至于变成卡死：
 *  · 交战中若目标方向只偏一点点（< 25°），按"航向微调"放行（否则追击时会永远追不上）；
 *  · 大胆的提督（aggression 高）在交战中可获得更大的修正角（抢 T 字位的语义）。
 */
export function turnDiscipline(s: TurnSituation): TurnOrder {
  const deg = s.angleToTurn * 180 / Math.PI;
  // ⚠ 脱离态必须**先于**"未接敌"判断：撤退中的舰队仍可能挨打，
  //   且用户规格是「对战时**缓慢后退**，再逐步转向」—— 正是脱离态的语义。
  //   初版先判 `!engaged`，撤退态被误判成 free（台架 ② 抓住）。
  if (s.disengaging) {
    // 脱离中：允许转向，但速率压到 55% —— 「缓慢后退、逐步转向」
    return { mode: 'limited', rateMul: 0.55, maxStep: Math.PI, reason: '脱离接触中，限速转向' };
  }
  if (!s.engaged) {
    return { mode: 'free', rateMul: 1.0, maxStep: Math.PI, reason: '未接敌，自由转向' };
  }
  // 交战中
  if (deg <= 25) {
    return { mode: 'limited', rateMul: 0.9, maxStep: Math.PI, reason: '交战中航向微调（≤25°）' };
  }
  const bold = 0.06 + s.aggression * 0.10;               // 6%~16% 的速率
  const maxRad = (0.10 + s.aggression * 0.15) * Math.PI; // 18°~45° 的单次上限
  return {
    mode: 'denied', rateMul: bold, maxStep: maxRad,
    reason: `交战中禁止大角度转向（需转 ${deg.toFixed(0)}°，仅允许 ${f1(maxRad * 180 / Math.PI)}° 修正）`,
  };
}

function f1(v: number) { return v.toFixed(1); }

// ══════════════════════════════════════════════════════════════════════
// B. 补给 / 追击判定
// ══════════════════════════════════════════════════════════════════════

export type SupplyAction = 'pursue' | 'hold' | 'return';

export interface SupplySituation {
  /** 补给百分比 0~100 */
  supplyPct: number;
  /** 是否仍在己方补给网内（补给源圈 / 运输舰覆盖） */
  inSupplyChain: boolean;
  /** 是否有运输舰正在赶来 / 正在补给本队 */
  supplyShipInbound: boolean;
  /**
   * [v41] 运输舰**已经在附近**（距离 < `AUX_NEAR_DIST`，可一两帧到达）。
   * 与 `supplyShipInbound`（在途，可能还很远）的区别就是用户的原话：
   * 「后面不远处就是运输舰队，明明继续前进/停下来就可以了，偏要掉个头」。
   */
  supplyShipNear?: boolean;
  /**
   * [v41] 上一帧的决策（**决策滞回**用）。
   * 没有它就会出现用户实报的「掉头掉一半，补给满了，然后又继续掉头」——
   * 会合途中补给回升 ⇒ 决策翻回 ⇒ 第二次大掉头。每帧独立判定的系统**必然振荡**。
   */
  prevAction?: SupplyAction;
  /** 敌方是否正在转向脱离（敌舰首背离我方 ⇒ 追击窗口） */
  enemyTurningAway: boolean;
  /** 我方是否占优（兵力比 ≥ 1.15 或士气显著高于敌） */
  ourAdvantage: boolean;
  /** 提督进取度 [0,1] */
  aggression: number;
  /** 阵地命令（驻守/攻坚 ⇒ 不许擅自脱离） */
  holdingGround: boolean;
}

export interface SupplyOrder {
  action: SupplyAction;
  /** 命中的规则名（台架逐条断言的就是它；也是战报文案的来源） */
  rule: string;
  reason: string;
}

/**
 * **补给 / 追击判定表** —— 这是用户要的"罗列情况和判断"的那张表。
 *
 * 优先级自上而下（第一条命中即返回）：
 *
 *  | # | 条件 | 行动 | 依据 |
 *  |---|------|------|------|
 *  | 1 | 补给 < 15（真断粮） | return | 唯一的硬规则：船都开不动了 |
 *  | 2 | 阵地命令（驻守/攻坚） | hold | 指令优先于一切自主判断 |
 *  | 3 | 补给 < 75 且 运输舰在途 且 敌正转向脱离 | **pursue** | 「后续补给船正在过来，可以不断追击」 |
 *  | 4 | 补给 < 75 且 运输舰在途 且 我方占优 且 大胆 | **pursue** | 大胆提督乘胜咬住 |
 *  | 5 | 补给 < 75 且 运输舰在途 | hold | 原地接战等补给，不追也不逃 |
 *  | 6 | 补给 < 75 且 敌正转向脱离 且 大胆 | **pursue** | 敌露背后，机不可失 |
 *  | 7 | 补给 < 75 且 我方占优 且 极大胆(≥0.75) | **pursue** | 优势时不给敌人喘息 |
 *  | 8 | 补给 < 75 且 谨慎(≤0.35) | return | 谨慎提督见黄就回 |
 *  | 9 | 补给 < 75 且 仍在补给网内 | hold | 网内补给可持续，不必回港 |
 *  | 10| 补给 < 75（已脱离补给网） | return | 无锚定、无增援 ⇒ 回 |
 *  | 11| 其余（补给充足） | hold | 正常作战 |
 */
export function supplyDecision(s: SupplySituation): SupplyOrder {
  const raw = decideSupplyRaw(s);
  // ── [v41] 决策滞回（S-H 回程锁定）──
  // 掉头是大机动（十几秒），而补给是连续量：掉头途中任何一个恢复信号都会把
  // 每帧独立判定翻回去 ⇒ 「掉头掉一半又掉回来」（用户实报的第二次丑陋机动）。
  // 规则：return 一旦成立，只有**强恢复证据**才允许翻回 ——
  //   补给大体恢复（≥90）/ 已进补给网 / 运输舰已在附近（那时是停下，不是第二次掉头）。
  if (s.prevAction === 'return' && raw.action !== 'return') {
    const recovered = s.supplyPct >= 90 || s.inSupplyChain || s.supplyShipNear === true;
    if (!recovered) {
      return {
        action: 'return',
        rule: 'S-H 回程锁定',
        reason: `已下令返航且补给仅 ${Math.round(s.supplyPct)}% —— 掉头中途不得反复（防二次机动）`,
      };
    }
  }
  return raw;
}

function decideSupplyRaw(s: SupplySituation): SupplyOrder {
  const aggr = s.aggression;
  const low = s.supplyPct < 75;
  const critical = s.supplyPct < 15;

  // [v41] S0（新增，插在断粮之后）：运输舰已在附近 ⇒ **原地停船等补给**。
  //   用户的原话：「明明继续前进就可以了，哪怕停下来都比掉个头要好」。
  //   船在一两帧路程内时，任何掉头/会合机动都纯粹是浪费；停下它自己会开过来。
  if (s.supplyShipNear) return { action: 'hold', rule: 'S0-船近停等', reason: '运输舰已在附近，原地接收补给（不掉头）' };
  if (critical) return { action: 'return', rule: 'S1-断粮', reason: `补给 ${Math.round(s.supplyPct)}%，仅存的硬规则：断粮必须回` };
  if (s.holdingGround) return { action: 'hold', rule: 'S2-阵地命令', reason: '驻守/攻坚指令优先于自主判断' };
  if (!low) return { action: 'hold', rule: 'S11-补给充足', reason: `补给 ${Math.round(s.supplyPct)}%，正常作战` };

  if (s.supplyShipInbound && s.enemyTurningAway) {
    return { action: 'pursue', rule: 'S3-补给在途+敌露背后', reason: '补给船正在赶来且敌正在转向脱离——追击窗口' };
  }
  if (s.supplyShipInbound && s.ourAdvantage && aggr >= 0.5) {
    return { action: 'pursue', rule: 'S4-补给在途+我方占优', reason: '运输舰在途，大胆提督乘胜咬住' };
  }
  if (s.supplyShipInbound) {
    return { action: 'hold', rule: 'S5-补给在途', reason: '原地接战等补给，不追也不逃' };
  }
  if (s.enemyTurningAway && aggr >= 0.5) {
    return { action: 'pursue', rule: 'S6-敌露背后', reason: '敌正在转向脱离，机不可失' };
  }
  if (s.ourAdvantage && aggr >= 0.75) {
    return { action: 'pursue', rule: 'S7-压倒优势', reason: '优势时不给敌人喘息' };
  }
  if (aggr <= 0.35) {
    return { action: 'return', rule: 'S8-谨慎提督', reason: '补给转黄且性格谨慎 ⇒ 返航' };
  }
  if (s.inSupplyChain) {
    return { action: 'hold', rule: 'S9-仍在补给网', reason: '补给网内可持续回补，不必回港' };
  }
  return { action: 'return', rule: 'S10-脱离补给网', reason: '补给转黄且已脱离补给网、无增援 ⇒ 回' };
}

// ══════════════════════════════════════════════════════════════════════
// C. 接近阶段横向分离（分兵后各走各的，而不是三路并成一路）
// ══════════════════════════════════════════════════════════════════════

/**
 * 接近阶段的**横向偏移量**（世界单位）。
 *
 * `_maneuverLateral` 目前只在**接敌后**生效（`BattleScene:4847+` 的包抄选边）；
 * 接敌**之前**三路目标点完全相同 ⇒ 远距离看就是"一起直线冲"（用户实报"为分而分"）。
 *
 * 本函数给"接敌前"的目标点加一个横向偏移：
 *  · 偏移量随距离**收敛到 0**（`t = clamp(dist/spread, 0, 1)`，越近偏得越少）
 *    ⇒ 接敌时各路已对齐，不干扰既有包抄逻辑；
 *  · 只对被战法指定了侧翼的队生效（`lateral = ±1`），中路为 0。
 *
 * ⚠ 只改**目标点**，不改位移方向 —— 舰队会自然转向该目标点，
 *   不破坏 v34b 的"位移方向与推力方向自洽"。
 */
export function approachLateralOffset(
  lateral: number,
  distToEnemy: number,
  spreadDist: number,
  maxOffset: number,
): number {
  if (lateral === 0 || spreadDist <= 0) return 0;
  const t = clamp(distToEnemy / spreadDist, 0, 1);
  // 用 t² 让中段收敛更快（远处分得很开、中段已开始归位）
  return lateral * maxOffset * t * t;
}
