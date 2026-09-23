/**
 * [v55] **aiDirector — 战术决策单一真源**（纯函数 · 无 Phaser 依赖 · 可台架逐条断言）
 *
 * ── 为什么必须有这个模块 ─────────────────────────────────────────────
 * 用户实报：「我控制的舰队都不会反击了，被动挨打？整体梳理下所有战术的代码，
 *   把所有散乱的逻辑做个整合，我需要更智能的 AI 对战」。
 *
 * 复盘出的根因链（2026-09-22，截图面板实读 = 「撤退补给中」）：
 *   ① 撤退/信标态的"自卫还击门"硬编码 250px（`BattleScene:4800/:4900`），
 *      而武器射程 560~880px ⇒ 敌在 300~880px 白嫖，我方**贴脸才还手**；
 *   ② `state==='retreating'` 时接敌评估整段被跳过（:4682 的 else-if 链），
 *      目标锁定/交战置位全程不跑；
 *   ③ 撤退分支"停船等补给"（`_regrouping` ⇒ 原地不动）⇒ 成了固定靶；
 *   ④ 视野清晰度（d > 0.8×vision = fuzzy 不可锁定）小于武器射程
 *      ⇒ 被超视距打击时连目标都锁不上，"被看不见的敌人打"。
 * 整合前这些判定散落在 5 处（1Hz 战略层 / executeMissionTick / per-frame 状态机 /
 *   per-frame 交战机动 / 开火门），阈值互相矛盾（250 / 400 / 500 / 900 / 1000…）。
 *
 * ── 本模块的不变量 ────────────────────────────────────────────────────
 * · **受击必还击**：8 秒内攻击过我方的敌舰 = "已暴露攻击者"，即使视野模糊 /
 *   正在撤退 / 信标任务在身，只要攻击者进入我方射程 ⇒ 必须还手（fireGate）。
 *   谁打我，我打谁（pickTarget 的 `attacker` 复仇加权）。
 * · **决策与执行分离**：本模块只回答"该不该打/打谁/什么阵型/站多远"；
 *   怎么飞/怎么转/怎么结算仍由 BattleScene + combatControl/retreatDoctrine 负责。
 * · **数据不手抄**：射程一律由调用方传入 `u.range`（config/gameData.ts 是唯一真源；
 *   旧 `getIdealEngageDist` 手抄舰种名（'航母' vs 真键 '空母'）⇒ 全部落默认值）。
 *
 * ⚠ 本模块被 `_v55_ai_sim.cjs` 直接 `require` 断言（铁律：台架打真源码）。
 */

export type Clarity = 'full' | 'partial' | 'fuzzy';

// ══════════════════════════════════════════════════════════════════════
// A. 可见性分级（原 BattleScene 内联三元判断的收口）
// ══════════════════════════════════════════════════════════════════════

/**
 * 视野内敌人按距离分级：近(≤35% 视野)=完全识别，中(35~80%)=接触，
 * 远(80~100%)=模糊（只能感知"有东西"）；视野外 = null。
 *
 * 35% 必须与 IntelSystem.assessContact 的 identified 阈值一致：`full` 是可锁定、
 * 可交战的目标，不能让玩家界面仍显示“未识别舰队”时 AI 已经开始隔空对射。
 */
export function visibilityOf(dist: number, visionRange: number): Clarity | null {
  if (!(dist < visionRange)) return null;
  if (dist > visionRange * 0.8) return 'fuzzy';
  if (dist > visionRange * 0.35) return 'partial';
  return 'full';
}

// ══════════════════════════════════════════════════════════════════════
// B. 受击台账（"受击必还击"的证据链）
// ══════════════════════════════════════════════════════════════════════

export interface IncomingFire {
  attackerId: string | number;
  at: number;
}

/** 受击还击窗口：被击中后 8 秒内攻击者视为"已暴露" */
export const INCOMING_FIRE_WINDOW_MS = 8000;

/**
 * 登记"本舰队正被 attackerId 攻击"（伤害结算处调用，一舰中弹全舰队获还击权）。
 * 只保留最近一名攻击者 —— 舰队级交战通常是 1v1/2v1，够用且零分配。
 */
export function noteIncomingFire(fleet: any, attackerId: string | number, now: number): void {
  if (!fleet) return;
  (fleet as any)._incomingFire = { attackerId, at: now } as IncomingFire;
}

/** 窗口内的攻击者 id；过期/未登记 = null */
export function activeAttacker(fleet: any, now: number, windowMs: number = INCOMING_FIRE_WINDOW_MS): string | number | null {
  const rec = (fleet as any)._incomingFire as IncomingFire | undefined;
  if (!rec || typeof rec.at !== 'number') return null;
  return now - rec.at <= windowMs ? rec.attackerId : null;
}

// ══════════════════════════════════════════════════════════════════════
// C. 统一开火门（替换散落的 `isEngaging && …` + 250px 自卫门）
// ══════════════════════════════════════════════════════════════════════

export interface FireGateSituation {
  /** 状态机判定的交战态（原 isEngaging） */
  engaged: boolean;
  /** 是否在受击还击窗口内（activeAttacker 非空） */
  underFire: boolean;
  /** 攻击者距离（未受击可传 null） */
  attackerDist: number | null;
  /** 本舰队最远武器射程（strikeRangeFrom） */
  strikeRange: number;
}

export type FireMode = 'combat' | 'return_fire' | 'none';

export interface FireGateOrder {
  canFire: boolean;
  mode: FireMode;
  reason: string;
}

/**
 * **开火门判定表**（第一条命中即返回）：
 *
 *  | # | 条件 | 结果 | 依据 |
 *  |---|------|------|------|
 *  | 1 | 交战态（状态机已接敌） | combat | 既有行为，不动 |
 *  | 2 | 受击 且 攻击者在射程内 | **return_fire** | 受击必还击：无视任务/姿态/撤退/视野模糊 |
 *  | 3 | 其余 | none | 未接敌且未受击 |
 */
export function fireGate(s: FireGateSituation): FireGateOrder {
  if (s.engaged) {
    return { canFire: true, mode: 'combat', reason: '交战中，武器组自由射击' };
  }
  if (s.underFire && s.attackerDist != null && s.attackerDist <= s.strikeRange) {
    return { canFire: true, mode: 'return_fire', reason: '受击还击：攻击者在射程内，无视任务/姿态/撤退强制还手' };
  }
  return { canFire: false, mode: 'none', reason: '未接敌且未受击' };
}

// ══════════════════════════════════════════════════════════════════════
// D. 目标选择（评分 + 滞回 + 复仇加权）
// ══════════════════════════════════════════════════════════════════════

export interface TargetCandidate {
  id: string | number;
  /** 敌方剩余血量比例 0~1 */
  hpPct: number;
  dist: number;
  power: number;
  /** attack_fleet 任务指定目标（绝对优先） */
  missionPriority?: boolean;
  /** 窗口内攻击过我方（受击必还击的目标侧：谁打我我打谁） */
  attacker?: boolean;
}

/** 旧目标滞回：新最优未领先 10% 以上则沿用旧目标（防帧间交替 ⇒ 朝向反相） */
export const TARGET_HYSTERESIS_RATIO = 0.1;
/** 复仇加权：攻击者的优先级远高于"更近的围观者"，但低于任务指定目标 */
export const TARGET_ATTACKER_BONUS = 30000;

export function scoreTarget(c: TargetCandidate): number {
  // 补刀残血优先 + 距离惩罚 + 威胁加成（评分公式与整合前逐项一致）
  let score = (1 - c.hpPct) * 300 - c.dist + c.power * 0.1;
  if (c.missionPriority) score += 100000;
  if (c.attacker) score += TARGET_ATTACKER_BONUS;
  return score;
}

export interface TargetPick {
  target: TargetCandidate | null;
  keptPrev: boolean;
  reason: string;
}

/**
 * 目标选择（含滞回）。候选**不含** fuzzy 目标（识别不了不能锁定），
 * 除非它是攻击者（被它打了 = 位置已暴露，可以还手）——由调用方在组候选时保证。
 */
export function pickTarget(
  cands: readonly TargetCandidate[],
  prevTargetId: string | number | null | undefined,
): TargetPick {
  if (!cands || cands.length === 0) return { target: null, keptPrev: false, reason: '无候选目标' };
  let best: TargetCandidate = cands[0];
  let bestScore = -Infinity;
  let prev: TargetCandidate | null = null;
  let prevScore = -Infinity;
  for (const c of cands) {
    const sc = scoreTarget(c);
    if (c.id === prevTargetId) { prev = c; prevScore = sc; }
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  if (prev && prevScore >= bestScore - Math.abs(bestScore) * TARGET_HYSTERESIS_RATIO) {
    return { target: prev, keptPrev: true, reason: '目标滞回：旧目标未落后 10% 以上' };
  }
  return { target: best, keptPrev: false, reason: '切换到评分最高目标' };
}

// ══════════════════════════════════════════════════════════════════════
// E. 理想交战距 / 射程（数据驱动，替换手抄舰种名表）
// ══════════════════════════════════════════════════════════════════════

export interface ShipCombatProfile {
  range: number;
  atk: number;
}

/** 理想交战距 = 战斗舰平均射程 × 0.95（对齐旧表 800/700/560 的口径） */
export const IDEAL_DIST_FACTOR = 0.95;
export const IDEAL_DIST_MIN = 540;
export const IDEAL_DIST_MAX = 880;
/** 舰载机母舰特征（数据驱动，不手抄舰种名）：远射程 + 低直击火力 */
export const CARRIER_STANDOFF_RANGE_MIN = 850;
export const CARRIER_STANDOFF_ATK_MAX = 25;

/**
 * 理想交战距（保持距离机动的站位半径）。
 * · 舰载机母舰在场 → 远距释放（880）；
 * · 否则 = 平均射程 × 0.95，钳制 [540, 880]；无战斗舰 → 140。
 * ⚠ 不变量：返回值 ≤ 本舰队最远射程的上限内（调用方传入的应是战斗舰，排除补给舰）——
 *   旧实现在纯 '舰载' 舰队上返回 720 > 其射程 640 ⇒ 舰队"站得比打得远"永远不开火。
 */
export function idealEngageDistFrom(ships: readonly ShipCombatProfile[]): number {
  if (!ships || ships.length === 0) return 140;
  for (const s of ships) {
    if (s.range >= CARRIER_STANDOFF_RANGE_MIN && s.atk <= CARRIER_STANDOFF_ATK_MAX) return IDEAL_DIST_MAX;
  }
  const mean = ships.reduce((a, s) => a + s.range, 0) / ships.length;
  return Math.round(Math.max(IDEAL_DIST_MIN, Math.min(IDEAL_DIST_MAX, mean * IDEAL_DIST_FACTOR)));
}

/** 本舰队最远武器射程 —— 自卫还击半径 / 拖刀开火半径（替换 250px 硬编码） */
export function strikeRangeFrom(ships: readonly ShipCombatProfile[]): number {
  let mx = 0;
  for (const s of ships) if (s.range > mx) mx = s.range;
  return mx;
}

// ══════════════════════════════════════════════════════════════════════
// F. 战斗阵型选择（两张互相矛盾的旧表的统一）
// ══════════════════════════════════════════════════════════════════════

export type CombatFormation = 'wedge' | 'line' | 'spindle' | 'circle' | 'square';

export interface FormationSituation {
  /** 有几支友军与本舰队盯同一目标 */
  alliesOnTarget: number;
  /** 兵力比 = 我/敌（>1 优势） */
  powerRatio: number;
  /** 进攻性：统帅 >80 或战法指定侧翼 */
  aggressive: boolean;
  /** 劣势规避 / 避战窗内 */
  avoiding: boolean;
}

/**
 * 阵型判定（整合前存在两张表：状态评估 :4762「ratio>1.5→wedge」与交战机动
 * :5072「aggressive && ratio>1.3→wedge」，后者每帧覆盖前者 ⇒ 前者实为死代码）。
 * 现统一为**最终生效口径**（原 :5072 表），两处调用同一函数。
 */
export function chooseFormation(s: FormationSituation): CombatFormation {
  if (s.avoiding) return 'spindle';
  if (s.alliesOnTarget >= 2) return 'circle';   // 3+ 舰队集火 → 包围
  if (s.aggressive && s.powerRatio > 1.3) return 'wedge';  // 优势+激进 → 楔形突破
  if (s.powerRatio > 0.8) return 'line';        // 均势 → 战列对射
  return 'spindle';                             // 劣势 → 纺锤防御
}

// ══════════════════════════════════════════════════════════════════════
// G. 交战承诺（阵型/侧翼机动的状态所有权）
// ══════════════════════════════════════════════════════════════════════

/**
 * 一次接战的阵型承诺。它属于舰队运行态，而不是战略层的编制数据。
 * 同一目标仍在交火时，它禁止“兵力比一变就变阵”的每帧抖动；这也是阵型
 * 动画只能由一次、可解释的命令驱动的前提。
 */
export interface CombatFormationCommitment {
  active: boolean;
  targetId: string | number | null;
  formation: CombatFormation;
}

export interface FormationCommitSituation {
  /** 本帧是否已进入战术接触（不是远距离侦察）。 */
  active: boolean;
  targetId: string | number | null;
  /** 部署/玩家命令留下的当前阵型；首次接敌必须尊重它。 */
  existingFormation: CombatFormation;
  /** AI 对新接触或换目标给出的建议。 */
  candidate: CombatFormation;
  previous: CombatFormationCommitment | null | undefined;
  /** 仅撤离/规避等安全性命令可以中断当前承诺。 */
  emergency: boolean;
}

export interface FormationCommitResult {
  formation: CombatFormation;
  state: CombatFormationCommitment;
  reason: 'opening' | 'held' | 'retarget' | 'emergency' | 'inactive';
}

/**
 * 阵型只能在五种可解释的时机决定一次：首次接敌、换目标、脱离接触、
 * 明确安全撤离，或玩家在非接战期下令。特别地，交火过程中不得因每帧
 * 重新评估的兵力比、盟军数或提督属性把楔形悄悄拉成长条。
 */
export function stabilizeCombatFormation(s: FormationCommitSituation): FormationCommitResult {
  if (!s.active) {
    return {
      formation: s.existingFormation,
      state: { active: false, targetId: null, formation: s.existingFormation },
      reason: 'inactive',
    };
  }
  if (s.emergency) {
    return {
      formation: s.candidate,
      state: { active: true, targetId: s.targetId, formation: s.candidate },
      reason: 'emergency',
    };
  }
  if (s.previous?.active && s.previous.targetId === s.targetId) {
    return { formation: s.previous.formation, state: s.previous, reason: 'held' };
  }
  // 首次接敌保留战前部署；换目标才采用新战术建议。
  const opening = !s.previous?.active;
  const formation = opening ? s.existingFormation : s.candidate;
  return {
    formation,
    state: { active: true, targetId: s.targetId, formation },
    reason: opening ? 'opening' : 'retarget',
  };
}

export interface FlankAuthorization {
  /** 指挥能力只影响偏好，不能自行生成绕侧命令。 */
  commanderAggressive: boolean;
  /** taskForce / 玩家战术明确指定的左右翼。 */
  maneuverRole?: string | null;
}

/** 侧翼机动必须来自明确的战术分配，不能仅因统帅高而背离正面战线。 */
export function shouldFlank(s: FlankAuthorization): boolean {
  return s.maneuverRole === 'left' || s.maneuverRole === 'right';
}
