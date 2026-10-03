/**
 * fighterWaves.ts — 舰载机波次裁决层（纯函数，零 import）
 *
 * ============================================================================
 * 为什么需要这个模块（[v68] 阶段 B）
 * ============================================================================
 * 现状「航母舰载机系统」（BattleScene.ts:7497-7530）是**装饰**：
 *   · carrierFighters = 6 个半径 1.5px 的青色圆点，orbitR = 18 + sin(t)*3 绕母舰画圈
 *   · **零参战**：不瞄准 / 不开火 / 不选目标 / 不计命中
 *   · **无 HP**、不可被攻击；母舰沉没 ⇒ 圆点全部 destroy
 *   · 唯一的"舰载机攻击"在 :7285-7300，且是另一条路径（突击舰开火时生成 4 个三角
 *     tween 飞向目标），伤害 = finalDmg/4 平摊，无独立目标 / 无消耗 / 无损失
 * ⇒ 结果是「有舰载机的名字与动画，没有舰载机」，战斗只能"对射到死"。
 *
 * 原作口径（本模块的设计依据，已查证 5 处来源）
 * ---------------------------------------------------------------------------
 * · 放飞时机：「到**最接近战圈前线**时出动」，不全程跟随母舰
 * · 放飞方式：「脱离的那一瞬间，**只要随着惯性走，便能达到比母舰更快的速度**」
 * · 定位：「机型小巧，**火力虽较弱，但活动性强**，最适合**近距离肉博战**」
 * · 回收：底部侦测器接收与母舰距离，**母舰诱导系统自动完成著舰**
 * · 不对称：同盟航母舰载机密集停放、**舰体下方防御力极差** ⇒ 穿甲后在其下方盘旋
 *   可致**连锁爆炸**（中岛海战原型）；帝国航母两侧舱门划出（慢但安全）
 *
 * ============================================================================
 * 设计约束（严格遵守）
 * ============================================================================
 * ① 零 import —— 与 combatPhase / combatControl / aiDirector 同规格，可直接 require .ts
 * ② **不碰伤害公式** —— 本模块只裁决「放飞 / 选靶 / 脱离 / 返航 / 空袭」与数量变化，
 *    实际扣血由 BattleScene 在既有开火链里结算
 * ③ **不占编队槽** —— 对齐原作「自动著舰」：FighterGroup 不进 formationOffsets
 * ④ 目标优先级硬约束：**禁止攻击敌方运输舰**（骑士精神）⇒ 改为护航
 */

// ══════════════════════════════════════════════════════════════════════
// A. 类型
// ══════════════════════════════════════════════════════════════════════

/** 舰载机五态（对齐原作叙述顺序） */
export type FighterPhase =
  /** 待放飞：在母舰储舰库中 */
  | 'stowed'
  /** 放飞中：分批脱离 */
  | 'launching'
  /** 格斗中：与敌舰载机交换 / 攻击敌舰 */
  | 'engaging'
  /** 脱离中：数量比失衡或损失过半，准备返航 */
  | 'withdrawing'
  /** 返航中：飞回母舰自动著舰 */
  | 'returning'
  /** 空袭：脱离途中穿甲突击（**唯一造成伤害的时机**） */
  | 'striking';

export const FIGHTER_PHASE_LABEL: Record<FighterPhase, string> = {
  stowed: '待放',
  launching: '放飞',
  engaging: '格斗',
  withdrawing: '脱离',
  returning: '返航',
  striking: '空袭',
};

/** 目标类别（优先级从高到低，见 targetPriority） */
export type FighterTargetKind = 'fighter' | 'battleship' | 'carrier' | 'supply' | 'none';

export interface FighterGroupState {
  id: string;
  /** 所属舰队 id */
  fleetId: string | number;
  /** 阵营（决定用哪套命名与模型：帝国王尔古雷 / 同盟斯巴达尼恩） */
  factionId: string;
  phase: FighterPhase;
  /** 存活架数 */
  alive: number;
  /** 满编搭载量（放飞时的分母） */
  capacity: number;
  /** 待放飞架数（分批用） */
  pending: number;
  /** 本波已造成伤害累计（统计与配平用） */
  dealt: number;
  /** 已损失架数累计 */
  lost: number;
  /** 当前锁定目标 uid（null = 无目标） */
  targetUid: string | number | null;
  /** 锁定目标类别（避免每帧重算分类） */
  targetKind: FighterTargetKind;
  /** 攻击部位：'ventral' 表示敌方舰体下方（航母弱点） */
  hitZone: 'hull' | 'ventral';
  /**
   * 返航完成时刻（Phaser time.now 毫秒；0 = 未在返航窗口内）。
   * ⚠ 由场景层使用（返航需要真实时钟，裁决层保持纯函数无时间源）。
   * 返航完成 ⇒ 母舰诱导系统补充一半损失（对齐原作「自动著舰」）。
   */
  _returnUntil?: number;
}

// ══════════════════════════════════════════════════════════════════════
// B. 搭载量与放飞
// ════════════════════════════════════════��═════════════════════════════

/** 每艘母舰的默认搭载量。原作帝国宇宙母舰 12 万 / 同盟 10 万（同比例缩略）。 */
export const FIGHTER_CAPACITY = 12;
/** 分批放飞的批数（原作"陆续自母舰发射"⇒ 不是一个齐投） */
export const FIGHTER_LAUNCH_BATCHES = 3;
/** 批间隔（秒） */
export const FIGHTER_LAUNCH_INTERVAL = 1.5;

/** 单舰（空母/突击）搭载量随舰级缩放：高阶母舰带得多 */
export function fighterCapacityFor(classType: string, count: number): number {
  if (!classType || count <= 0) return 0;
  // 空母 = 主搭载舰；突击（CV）= 少量护航机
  if (classType === '空母') return FIGHTER_CAPACITY * count;
  if (classType === '突击') return Math.max(2, Math.round(FIGHTER_CAPACITY * 0.25)) * count;
  return 0;
}

/** 放飞一批：返回本批架数（不足一批则给剩余） */
export function launchBatch(g: FighterGroupState): number {
  if (g.phase !== 'stowed' && g.phase !== 'launching') return 0;
  if (g.pending <= 0) return 0;
  const perBatch = Math.ceil(g.capacity / FIGHTER_LAUNCH_BATCHES);
  const n = Math.min(g.pending, perBatch);
  g.pending -= n;
  g.alive += n;
  g.phase = g.pending > 0 ? 'launching' : 'engaging';
  return n;
}

// ══════════════════════════════════════════════════════════════════════
// C. 目标优先级（"变化"的核心来源）
// ══════════════════════════════════════════════════════════════════════

/**
 * 目标优先级评分。分越高越优先。
 *
 * ============================================================================
 * 为什么这张表就是"变化"（31 号文档 §3.4）
 * ============================================================================
 * 敌舰载机 ★★★★★：1:1 交换 ⇒ 制空权是后续一切的前置条件
 * 敌战舰   ★★★☆：削弱火力节点
 * 敌航母   ★★☆☆☆：专打下方弱点 ⇒ 连锁爆炸
 * 敌运输舰 ✗ 禁止：骑士精神，改为护航
 *
 * ⇒ 由此派生出四条收益/风险完全不同的战术路径，这就是"对战有变化"的来源。
 */
export function targetPriority(kind: FighterTargetKind, dist: number): number {
  switch (kind) {
    case 'fighter': return 500 - Math.min(200, dist * 0.2);
    // 距离惩罚弱化：舰载机"活动性强、适合近距离肉博"，不应因远而放弃
    case 'battleship': return 300 - Math.min(150, dist * 0.15);
    // 航母价值最高但难打（下方暴露窗口窄）⇒ 基值低于战舰
    case 'carrier': return 200 - Math.min(120, dist * 0.12);
    // 运输舰：硬性禁止 ⇒ 返回 -1（调用方必须视为不可选）
    case 'supply': return -1;
    default: return 0;
  }
}

/** 运输舰是否可作为舰载机目标（硬约束：禁止） */
export function mayAttackSupply(): boolean {
  return false;
}

/** 攻击部位：只有航母（且在近距离）才打下方弱点 */
export function hitZoneFor(kind: FighterTargetKind, dist: number): 'hull' | 'ventral' {
  if (kind === 'carrier' && dist <= FIGHTER_VENTRAL_RANGE) return 'ventral';
  return 'hull';
}

/** 航母下方弱点暴露距离（px）。原作需穿甲后在其下方盘旋 ⇒ 窗口窄。 */
export const FIGHTER_VENTRAL_RANGE = 180;

// ══════════════════════════════════════════════════════════════════════
// D. 状态机
// ══════════════════════════════════════════════════════════════════════

export interface FighterSituation {
  /** 己方与敌方舰载机数量比（分母为 0 时记为 99） */
  ratio: number;
  /** 本波损失率 0~1 */
  lossRate: number;
  /** 母舰是否仍在战场（沉没则全部无法返航） */
  carrierAlive: boolean;
  /** 母舰是否已脱离接触（⇒ 触发空袭窗口） */
  carrierDisengaged: boolean;
  /** 是否有可攻击目标（false ⇒ 转返航） */
  hasTarget: boolean;
}

export interface FighterDecision {
  phase: FighterPhase;
  /** 是否进入/维持空袭（唯一有伤害的时机） */
  striking: boolean;
  reason: 'stow' | 'launch' | 'engage' | 'withdraw' | 'return' | 'strike';
}

/**
 * 舰载机五态推进。纯函数语义：改写 g 并返回决策，便于台架直接断言状态。
 * ⚠ 阈值来自 31 号文档 §3.3，全部归口本模块，场景不得内联。
 */
export function advanceFighters(
  g: FighterGroupState,
  s: FighterSituation,
  dtSeconds: number,
): FighterDecision {
  // 待放飞：不消耗任何时间，等放飞窗口
  if (g.phase === 'stowed') return { phase: 'stowed', striking: false, reason: 'stow' };

  if (g.alive <= 0) {
    g.phase = 'returning';
    return { phase: 'returning', striking: false, reason: 'return' };
  }

  // 母舰沉没 ⇒ 无处返航，只能继续打到最后（原作：母舰没了就拼死）
  if (!s.carrierAlive) {
    if (g.phase === 'returning' || g.phase === 'withdrawing') {
      g.phase = 'engaging';
      return { phase: 'engaging', striking: false, reason: 'engage' };
    }
  }

  // 放飞中：逐批出机
  if (g.phase === 'launching') {
    return { phase: 'launching', striking: false, reason: 'launch' };
  }

  // ⚠ [v68 实测修正] 空袭窗口的入口比初版更宽：
  //   初版把空袭只挂在 withdrinking 分支内，但那样"母舰已脱离接触"时，
  //   编队仍停在 engaging 态 ⇒ 永远够不到空袭（台架 E 组实测 failing）。
  //   原作语义是「**脱离的那一瞬间**，只要随着惯性走便能达到比母舰更快的速度」
  //   —— 触发条件是**母舰脱离接触**，而不是本编队必须先进入 withdrawing。
  //   故此处放宽：只要母舰已脱离接触且有目标，格斗中的编队也可直接拉起空袭。
  if (g.phase === 'engaging' && s.carrierDisengaged && s.hasTarget) {
    g.phase = 'striking';
    return { phase: 'striking', striking: true, reason: 'strike' };
  }

  // 返航中：等重新上舰
  if (g.phase === 'returning') {
    if (s.carrierAlive) return { phase: 'returning', striking: false, reason: 'return' };
    g.phase = 'engaging';
    return { phase: 'engaging', striking: false, reason: 'engage' };
  }

  // 脱离判定：数量比失衡 或 损失过半
  const shouldWithdraw = s.ratio < FIGHTER_WITHDRAW_RATIO || s.lossRate >= FIGHTER_WITHDRAW_LOSS;
  if (g.phase === 'engaging' && shouldWithdraw) {
    g.phase = 'withdrawing';
  }

  if (g.phase === 'withdrawing') {
    // **空袭窗口**：母舰已脱离接触 ⇒ 脱离途中穿甲突击
    //   对应原作「脱离的那一瞬间，只要随着惯性走，便能达到比母舰更快的速度」
    if (s.carrierDisengaged && s.hasTarget) {
      g.phase = 'striking';
      return { phase: 'striking', striking: true, reason: 'strike' };
    }
    // 无目标 ⇒ 直接返航
    if (!s.hasTarget || !s.carrierAlive) {
      g.phase = 'returning';
      return { phase: 'returning', striking: false, reason: 'return' };
    }
    return { phase: 'withdrawing', striking: false, reason: 'withdraw' };
  }

  // 空袭结束 ⇒ 拉起返航
  if (g.phase === 'striking') {
    if (!s.hasTarget || s.lossRate >= FIGHTER_STRIKE_END_LOSS) {
      g.phase = 'returning';
      return { phase: 'returning', striking: false, reason: 'return' };
    }
    return { phase: 'striking', striking: true, reason: 'strike' };
  }

  // 格斗中：无目标则转入脱离
  if (g.phase === 'engaging' && !s.hasTarget) {
    g.phase = 'withdrawing';
    return { phase: 'withdrawing', striking: false, reason: 'withdraw' };
  }
  return { phase: g.phase, striking: false, reason: 'engage' };
}

/** 数量比低于此 ⇒ 脱离（舰载机不打消耗战） */
export const FIGHTER_WITHDRAW_RATIO = 0.6;
/** 损失率超过此 ⇒ 脱离 */
export const FIGHTER_WITHDRAW_LOSS = 0.5;
/** 空袭中损失率超过此 ⇒ 放弃空袭拉起（避免全灭在突进路上） */
export const FIGHTER_STRIKE_END_LOSS = 0.65;

// ══════════════════════════════════════════════════════════════════════
// E. 损耗与配平
// ══════════════════════════════════════════════════════════════════════

/**
 * 一次交战结算后的架数变化。
 * ⚠ **1:1 交换** 是刻意的：舰载机对舰载机同归于尽，使制空权成为可争夺的资源。
 * ⚠ 同时交战时按数量差衰减，避免 4v4 秒掉 4 架。
 */
export function resolveClash(aliveA: number, aliveB: number, round: number): number {
  if (round < 1) return 0;
  const a = Math.max(0, aliveA);
  const b = Math.max(0, aliveB);
  if (a === 0 || b === 0) return 0;
  // 劣势方按数量比衰减交换率：4v4 时各损 1；4v1 时劣势方几乎无损
  const ratio = Math.min(a, b) / Math.max(a, b);
  return Math.max(1, Math.min(round, Math.round(round * (0.5 + 0.5 * ratio))));
}

/** 单架舰载机的伤害（占母舰总火力的一小份） */
export function fighterDamage(capacity: number, perShip: number): number {
  if (capacity <= 0) return 0;
  return perShip * FIGHTER_DAMAGE_SHARE;
}
/** 单架占母舰单舰火力的比例 */
export const FIGHTER_DAMAGE_SHARE = 0.22;

// ══════════════════════════════════════════════════════════════════════
// F. 连锁爆炸（航母下方弱点 → 殉爆）
// ══════════════════════════════════════════════════════════════════════

/** 航母沉没时对半径内敌方舰载机的影响半径（px）。原作：王尔古雷在航母下方盘旋。 */
export const CHAIN_BLAST_FIGHTER_R = 120;
/** 对友舰的冲击波半径（px） */
export const CHAIN_BLAST_SHIP_R = 80;
/** 友舰冲击波伤害比例 */
export const CHAIN_BLAST_SHIP_DAMAGE = 0.3;

export interface ChainBlastResult {
  /** 半径内的敌方舰载机（应全灭） */
  fightersKilled: string[];
  /** 受冲击波影响的友舰 uid → 剩余 HP 比例 */
  shipsDamaged: { uid: string | number; hpRatio: number }[];
  /** 航母是否被引爆（带 ventral 命中才引） */
  carrierDestroyed: boolean;
}

/**
 * 航母连锁爆炸结算。
 * ⚠ 只有命中**下方弱点**（hitZone='ventral'）才引爆 —— 这是对原作
 *   「穿甲后在其下方盘旋可致连锁爆炸」的口径实现；打其他部位只是普通伤害。
 */
export function resolveChainBlast(input: {
  carrierUid: string | number;
  hitZone: 'hull' | 'ventral';
  carrierX: number;
  carrierY: number;
  enemyFighters: { id: string; x: number; y: number }[];
  friendlyShips: { uid: string | number; x: number; y: number; hpRatio: number }[];
}): ChainBlastResult {
  const empty: ChainBlastResult = { fightersKilled: [], shipsDamaged: [], carrierDestroyed: false };
  if (input.hitZone !== 'ventral') return empty;
  const fightersKilled: string[] = [];
  for (const f of input.enemyFighters) {
    if (Math.hypot(f.x - input.carrierX, f.y - input.carrierY) <= CHAIN_BLAST_FIGHTER_R) {
      fightersKilled.push(f.id);
    }
  }
  const shipsDamaged: { uid: string | number; hpRatio: number }[] = [];
  for (const sh of input.friendlyShips) {
    if (Math.hypot(sh.x - input.carrierX, sh.y - input.carrierY) <= CHAIN_BLAST_SHIP_R) {
      shipsDamaged.push({ uid: sh.uid, hpRatio: Math.max(0.1, sh.hpRatio - CHAIN_BLAST_SHIP_DAMAGE) });
    }
  }
  return { fightersKilled, shipsDamaged, carrierDestroyed: true };
}

// ══════════════════════════════════════════════════════════════════════
// G. 工厂
// ══════════════════════════════════════════════════════════════════════

export function createFighterGroup(
  id: string, fleetId: string | number, factionId: string, capacity: number,
): FighterGroupState {
  return {
    id, fleetId, factionId,
    phase: capacity > 0 ? 'stowed' : 'returning',
    alive: 0, capacity, pending: capacity,
    dealt: 0, lost: 0,
    targetUid: null, targetKind: 'none', hitZone: 'hull',
  };
}
