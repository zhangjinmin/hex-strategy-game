/**
 * combatPhase.ts — 战斗距离阶段状态机（纯函数，零依赖）
 *
 * ============================================================================
 * 为什么需要这个模块（[v67] 阶段 A）
 * ============================================================================
 * 旧实现只有「一个理想交战距」：`aiDirector.idealEngageDistFrom` 返回 540~880px
 * 的**单一标量**，双方都收敛到这个距离然后对射。结果是：
 *
 *   ① 射程 300~880px vs 理想交战距 540~880px ⇒ 双方几乎一开局就在射程内，
 *      **没有接近过程**；
 *   ② 战斗全程只有一种打法 ⇒ 「对射到死」；
 *   ③ 伤害公式 10 个乘区（BattleScene:7248）全是「谁更强」的标量修正，
 *      没有一项是「战况变了」⇒ 所有乘区可在开局前算完。
 *
 * 本模块把「距离」从标量升级为**阶段**，让最优打法随距离改变。
 * 每个阶段对应不同的最优阵型与武器，构成战斗的节奏骨架。
 *
 * ============================================================================
 * 与既有裁决层的关系（严格约束）
 * ============================================================================
 * · 零 import（与 combatDoctrine / combatControl / aiDirector 同规格）⇒ 可直接 require .ts 做台架
 * · **不碰运动学**：只产出「该待在哪个距离」与「该用哪种阵型」，
 *   执行仍由 combatControl 状态机 + fleetKinematics 负责
 * · **不碰伤害公式**：阶段只影响站位，伤害乘区在阶段 B/C 才引入击瘫
 * · 阈值全部归口本模块，**BattleScene 不得内联硬编码**
 *
 * ============================================================================
 * 阶段定义
 * ============================================================================
 *   S1 far      远距对射   >  standoff      纵列/楔形   战列超视距齐射，抢先手
 *   S2 approach 接近       ~  engage        展开线       放飞舰载机、试探侧翼
 *   S3 assault  突进       <  brawl         集火纵队     逐舰击瘫、舰载机穿甲
 *   S4 brawl    混战/脱离  <  brawl 或损失   各自机动     脱离重整
 *
 * ============================================================================
 * 滞回与防抖（三重保险）
 * ============================================================================
 * 战斗距在阈值附近抖动会导致阵型反复切换、观感极差。因此：
 *   ① 进/出阈值不同（滞回带 Hysteresis ratio 0.78）
 *   ② 最小停留时间（MIN_DWELL，各阶段不同；S1 更长以免过早卷入）
 *   ③ 损失率独立触发 S4（不必等距离进brawl 阈值）
 */

// ══════════════════════════════════════════════════════════════════════
// A. 类型
// ══════════════════════════════════════════════════════════════════════

/** 战斗阶段。字符串联合（与 combatControl.ManeuverPhase 同风格，不引 enum）。 */
export type CombatPhase = 'far' | 'approach' | 'assault' | 'brawl';

export const PHASE_ORDER: readonly CombatPhase[] = ['far', 'approach', 'assault', 'brawl'];

/** 阶段中文标签（HUD 阶段条 / 战报广播用） */
export const PHASE_LABEL: Record<CombatPhase, string> = {
  far: '远距对射',
  approach: '接近',
  assault: '突进',
  brawl: '混战',
};

/**
 * 各阶段的最优阵型偏好。
 * ⚠ 只给**偏好**，不强制：`aiDirector.chooseFormation` 仍是最终裁决者，
 *   本字段经 `combatPhaseFormationHint` 出口供其参考（见 30 号文档 §3 的裁决层边界）。
 * · far     纵列/楔形：宽射界、便于超视距齐射
 * · approach 展开线：横向铺开，暴露舰载机放飞面、便于试探侧翼
 * · assault 集火纵队：火力集中到一点，牺牲展开换单舰击瘫效率
 * · brawl   各自机动：阵型已无意义（也是脱离重整的形态）
 */
export const PHASE_FORMATION_HINT: Record<CombatPhase, readonly string[]> = {
  far: ['line', 'wedge'],
  approach: ['line', 'spindle'],
  assault: ['spindle', 'circle'],
  brawl: ['wedge'],
};

/**
 * 各阶段的目标交战距离占「地图有效跨度」的比例。
 * ⚠ 关键设计：不用绝对 px，改用**跨度比例**。
 *   原因（实测 2026-10-03）：地图跨度随参战规模动态扩容
 *   —— ≤4艘 hexRadius=26(~1300px) / ≤8艘 32(~1600) / ≤12艘 38(~1900)
 *      / ≤16艘 44(~2200) / >16艘 50(~2500)（BattleScene:3306-3310, 3390-3394）。
 *   若硬编码 S1=1200px，在 1v1（1300px）上 S1 时长≈0，等于没有远距对射阶段；
 *   在 5v5（2500px）上又过于宽松。比例制让四阶段在所有规模下等比成立。
 */
export const PHASE_DIST_RATIO: Record<CombatPhase, number> = {
  far: 0.80,      // 0.80 × 跨度
  approach: 0.42, // 0.42 × 跨度
  assault: 0.18,  // 0.18 × 跨度
  brawl: 0.07,    // 0.07 × 跨度
};

/** 滞回带比例：出阶段阈值 = 进阶段阈值 × 该值（<1 ⇒ 退出比进入更宽松，防抖） */
export const PHASE_HYSTERESIS = 0.78;

/** 各阶段最小停留时间（秒）。S1 更长⇒ 避免开局一触即发直接卷入。 */
export const PHASE_MIN_DWELL: Record<CombatPhase, number> = {
  far: 14,      // 远距对射至少 14s，让玩家先看清态势
  approach: 8,  // 接近至少 8s（够放飞舰载机）
  assault: 6,   // 突进至少 6s（够完成一次集火循环）
  brawl: 5,     // 混战至少 5s
};

/** 进入 S4（混战/脱离）的独立损失率阈值——不必等距离跌破 brawl 阈值 */
export const BRAWL_LOSS_RATIO = 0.40;
/** 损失率回落到该值以下才允许离开 S4（滞回，防"擦一下就进进出出"） */
export const BRAWL_LOSS_RELEASE = 0.28;

/** 阶段 A 不做的事（留待阶段 B/C/D，避免一次改太多） */
export const PHASE_A_NOTES = [
  '舰载机波次（阶段 B）：本模块已在 S2/S3 留出触发钩子 isFighterWindow()',
  '击瘫 crippling（阶段 C）：阶段只影响站位，伤害侧改造另做',
  '战场事件（阶段 D）：连锁爆炸/殉爆另做',
  '战斗节奏 AI（阶段 E）：combatRhythm 层另做',
] as const;

// ══════════════════════════════════════════════════════════════════════
// B. 阈值计算
// ══════════════════════════════════════════════════════════════════════

/** 地图有效跨度（px）。由 BattleScene 用 hexRadius × 实际格数算出传入。 */
export interface PhaseThresholds {
  far: number;
  approach: number;
  assault: number;
  brawl: number;
  /** 构成跨度的基础值，供 HUD 展示与台架核对 */
  span: number;
}

/**
 * 由地图跨度导出四阶段阈值。
 * @param span 地图有效跨度（px），即两方部署位置的最大可能间距
 * @param maxRange 本方最大武器射程（用于夹逼下限，避免"射程 300 打 1300 的 S1 站位"）
 */
export function phaseThresholdsFrom(span: number, maxRange: number): PhaseThresholds {
  const s = Math.max(200, span);
  const far = Math.round(s * PHASE_DIST_RATIO.far);
  const approach = Math.round(s * PHASE_DIST_RATIO.approach);
  const assault = Math.round(s * PHASE_DIST_RATIO.assault);
  const brawl = Math.round(s * PHASE_DIST_RATIO.brawl);
  return {
    far: Math.max(far, Math.round(maxRange * 1.15)),
    // 下限不得低于射程，否则会站到"打不到"的位置（v55 修过的"站得比打得远"同类问题）
    approach: Math.max(approach, Math.round(maxRange * 0.80)),
    assault: Math.max(assault, Math.round(maxRange * 0.45)),
    brawl,
    span: s,
  };
}

// ══════════════════════════════════════════════════════════════════════
// C. 状态机
// ══════════════════════════════════════════════════════════════════════

export interface PhaseState {
  phase: CombatPhase;
  /** 已在当前阶段停留的秒数 */
  dwell: number;
  /** 累计战斗秒数（用于战报与台架核对） */
  elapsed: number;
}

export interface PhaseInput {
  /** 双方舰队中心的当前距离（px） */
  dist: number;
  /** 本方累计战损比 0~1（已损血量 / 总血量） */
  lossRatio: number;
  /** 阈值（由 phaseThresholdsFrom 得出） */
  thresholds: PhaseThresholds;
  /** 上一状态 */
  prev: PhaseState;
  /** 本次推进的秒数 */
  dtSeconds: number;
  /** 双方是否已接敌（false ⇒ 保持 far，不允许因距离近而推进） */
  engaged: boolean;
}

/** 按当前距离（无滞回）算出的"名义阶段"——纯查询，供台架与调试使用 */
export function nominalPhase(dist: number, t: PhaseThresholds): CombatPhase {
  if (dist > t.far) return 'far';
  if (dist > t.approach) return 'approach';
  if (dist > t.assault) return 'assault';
  return 'brawl';
}

/**
 * 阶段进入线判据：距离 <= t[to] 即具备进入 to 的条件。**方向无关**。
 *
 * ============================================================================
 * v67 语义修正（初版有真缺陷，此处为定稿）
 * ============================================================================
 * 初版给推进与回退各写一个公式（th / H 与 th * H），**方向判反了**：
 * PHASE_ORDER 索引 far(0)->brawl(3)，而阈值 far(1040) **最大**、brawl(91) 最小。
 * 于是「推进到更近阶段」这条分支拿到 **approach 的 704**，
 * 而「回退到更远阶段」拿到 **far 的 1040** => S1 在 1040px 进不去 S2，
 * S2 在 800px 立刻「回退」S1 => far<->approach 每 tick 乒乓（实测 60s 内 460 次切换）。
 *
 * **正解：进入线只有一条，方向无关；防抖靠驻留带 + 最小停留，不靠两个公式。**
 */
function canEnter(to: CombatPhase, dist: number, t: PhaseThresholds): boolean {
  // far 的进入线是**上界**（拉远到 > far 才算进入远距对射）；
  // 其余阶段的进入线是**下界**（贴近到 <= 该值才算进入）。
  // ⚠ v67 三次修正：前两版把 far 也当作下界（dist <= t.far），
  //   导致「从 approach 回退到 far」永远不成立（1090 <= 1040 为假）。
  if (to === 'far') return dist > t.far;
  return dist <= t[to as keyof PhaseThresholds];
}

/**
 * 驻留带：距离落在 from 阶段进入线的滞回带内时**保持不动**。
 * 上沿 = t*H（回退线，比进入线更远），下沿 = t/H（推进线，比进入线更近）。
 * 下沿更宽符合物理：距离收缩通常比扩张剧烈，宽下沿避免一次机动直接跨两级。
 */
function inDwellBand(from: CombatPhase, dist: number, t: PhaseThresholds): boolean {
  const th = t[from as keyof PhaseThresholds] as number;
  return dist > th * PHASE_HYSTERESIS && dist < th / PHASE_HYSTERESIS;
}

/**
 * 阶段推进。纯函数：返回新状态，不改入参。
 *
 * 判定顺序（顺序即优先级，不可调换）：
 *   ① 接敌判据：未接敌 ⇒ 强制 far（不允许"没打就冲进肉搏"）
 *   ② 最小停留：未满 MIN_DWELL ⇒ 原地保持（只累计时间）
 *   ③ 滞回推进/回退：按距离
 *   ④ 损失率独立触发 S4：lossRatio ≥ BRAWL_LOSS_RATIO ⇒ 进 brawl；
 *      已在 brawl 且 lossRatio ≤ BRAWL_LOSS_RELEASE ⇒ 允许退出
 */
export function advancePhase(state: PhaseState, input: PhaseInput): PhaseState {
  const { prev, thresholds: t, dtSeconds, dist, lossRatio, engaged } = input;
  const dwell = prev.dwell + dtSeconds;
  const elapsed = prev.elapsed + dtSeconds;
  const keep = (p: CombatPhase): PhaseState => ({ phase: p, dwell, elapsed });

  // (1) 未接敌：强制远距对射（时间照常累计，供 S1 最短时长达标）
  if (!engaged) return keep('far');

  // (2) 损失率独立触发 S4：被打残了就该脱离，与当前距离无关。
  //     这是 S4 的独立入口，也是「变化」的一个非 DPS 来源。
  if (lossRatio >= BRAWL_LOSS_RATIO && prev.phase !== 'brawl') return keep('brawl');

  // (3) 最小停留时间：不足则原地不动（时间继续累计）
  if (dwell < PHASE_MIN_DWELL[prev.phase]) return keep(prev.phase);

  // (4) 驻留带：距离落在当前阶段进入线的滞回带内 => 保持不动
  if (inDwellBand(prev.phase, dist, t)) return keep(prev.phase);

  // (5) 目标阶段 = 由距离唯一确定的名义阶段（nominalPhase）
  const target = nominalPhase(dist, t);

  // (6) 已退 S4 且损失回落 => 允许按距离重新定位（不强制回 assault）
  if (prev.phase === 'brawl' && lossRatio > BRAWL_LOSS_RELEASE) return keep('brawl');

  // (7) 目标 == 当前 => 不动
  if (target === prev.phase) return keep(prev.phase);

  // ⚠ 方向判读（v67 二次修正，避免索引歧义）：
  //   PHASE_ORDER = [far, approach, assault, brawl]，索引**越大 = 距离越近**。
  //   因此 tgtIdx > curIdx ⇒ **更近**（接近）；tgtIdx < curIdx ⇒ **更远**（拉远）。
  //   本人前两版都把这两个方向写反过（分别造成 460 次乒乓 / far 直跳 brawl），
  //   故此处改用**语义命名**而非裸索引比较。
  const curIdx = PHASE_ORDER.indexOf(prev.phase);
  const tgtIdx = PHASE_ORDER.indexOf(target);
  const closer = tgtIdx > curIdx;

  if (closer) {
    // 接近：跨多级时**逐级**推进（每 tick 一格），避免阵型瞬变
    if (curIdx - tgtIdx === 1) return canEnter(target, dist, t) ? keep(target) : keep(prev.phase);
    const stepped = PHASE_ORDER[curIdx + 1];
    return canEnter(stepped, dist, t) ? keep(stepped) : keep(prev.phase);
  }
  // 拉远：允许直接回退到目标（阵型本就要松散，跳级无观感风险）
  return canEnter(target, dist, t) ? keep(target) : keep(prev.phase);
}

/** 初始状态 */
export function initialPhase(): PhaseState {
  return { phase: 'far', dwell: 0, elapsed: 0 };
}

// ══════════════════════════════════════════════════════════════════════
// D. 出口辅助
// ══════════════════════════════════════════════════════════════════════

/** 阶段 → 目标交战距离（接线到 idealEngageDist 的替代口径） */
export function phaseTargetDist(phase: CombatPhase, t: PhaseThresholds): number {
  return t[phase as keyof PhaseThresholds] as number;
}

/** 阶段 → 阵型偏好（供 aiDirector.chooseFormation 参考，不强制） */
export function combatPhaseFormationHint(phase: CombatPhase): readonly string[] {
  return PHASE_FORMATION_HINT[phase];
}

/** 舰载机放飞窗口（S2 与 S3）。阶段 B 的钩子，当前只做判据。 */
export function isFighterWindow(phase: CombatPhase): boolean {
  return phase === 'approach' || phase === 'assault';
}

/** 阶段是否发生跃迁（供战报广播，避免每帧刷屏） */
export function phaseChanged(prev: CombatPhase, now: CombatPhase): boolean {
  return prev !== now;
}
