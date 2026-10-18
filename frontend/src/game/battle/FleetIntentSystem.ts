export type FleetIntentKind = 'survive' | 'engage' | 'mission' | 'beacon' | 'support' | 'search' | 'patrol';

export interface IntentPoint { x: number; y: number }
export interface IntentContact { id: number; destination: IntentPoint; inWeaponRange: boolean }
export interface IntentAlly { id: number; destination: IntentPoint }
export interface IntentMission { type: string; destination: IntentPoint }

export interface FleetIntentInput {
  retreatDestination: IntentPoint | null;
  attacker: IntentContact | null;
  engagement: IntentContact | null;
  beaconDestination: IntentPoint | null;
  mission: IntentMission | null;
  knownEnemy: IntentContact | null;
  fightingAlly: IntentAlly | null;
  forwardSearch: IntentPoint | null;
  patrolPoint: IntentPoint | null;
}

export interface FleetIntent {
  kind: FleetIntentKind;
  destination: IntentPoint | null;
  fireTargetId: number | null;
  missionPaused: boolean;
  reason: string;
}

/**
 * Resolves movement and fire independently. An assigned movement order remains the
 * destination while incoming fire is answered; a deliberate engagement may pause,
 * but never erase, a mission.
 */
export function resolveFleetIntent(input: FleetIntentInput): FleetIntent {
  if (input.retreatDestination) {
    return {
      kind: 'survive', destination: input.retreatDestination,
      fireTargetId: input.attacker?.inWeaponRange ? input.attacker.id : null,
      missionPaused: !!input.mission, reason: '生存与撤离优先',
    };
  }

  if (input.engagement) {
    return {
      kind: 'engage', destination: input.engagement.destination,
      fireTargetId: input.engagement.inWeaponRange ? input.engagement.id : null,
      missionPaused: !!input.mission, reason: input.mission ? '任务途中接敌，暂缓后交战' : '已识别敌军进入接战区',
    };
  }

  const returnFire = input.attacker?.inWeaponRange ? input.attacker.id : null;
  if (input.beaconDestination) {
    return { kind: 'beacon', destination: input.beaconDestination, fireTargetId: returnFire, missionPaused: false, reason: '执行玩家信标并保持自卫' };
  }
  if (input.mission) {
    return { kind: 'mission', destination: input.mission.destination, fireTargetId: returnFire, missionPaused: false, reason: '继续执行既定任务' };
  }
  if (input.knownEnemy) {
    return {
      kind: 'engage', destination: input.knownEnemy.destination,
      fireTargetId: input.knownEnemy.inWeaponRange ? input.knownEnemy.id : returnFire,
      missionPaused: false, reason: '目标完成后追击已知敌军',
    };
  }
  if (input.fightingAlly) {
    return { kind: 'support', destination: input.fightingAlly.destination, fireTargetId: returnFire, missionPaused: false, reason: '支援正在交战的友军' };
  }
  if (input.forwardSearch) {
    return { kind: 'search', destination: input.forwardSearch, fireTargetId: returnFire, missionPaused: false, reason: '沿敌方方向继续搜索' };
  }
  return { kind: 'patrol', destination: input.patrolPoint, fireTargetId: returnFire, missionPaused: false, reason: '巡逻己方关键节点' };
}

// ══════════════════════════════════════════════════════════════════════
// B0 · 任务 → 目的地（**纯函数**，零 import、不读时钟、不碰 this）
// ══════════════════════════════════════════════════════════════════════
//
// 为什么抽出来：这段逻辑原先埋在 `BattleScene.executeMissionTick` 里，
// 而它是私有方法、依赖 `this.globalFleets / factionMap / store`
// ⇒ 台架只能靠"切源码字符串"测，改一行注释就可能失配。
// ⇒ 抽成纯函数后，第 6~9 步的接线（三段解析 / 档案投影 / 扇区扫掠）才能被真正单测。

/** 调用方已算好的档案视图（`ageMs` / `tier` 由 `intelFreshness` 在调用侧计算，本文件不 import）。 */
export interface MissionRecordLike {
  /** 档案主体（舰队 id） */
  targetId: number | string;
  /** 该舰队所属阵营（可按"阵营 id 任务"匹配） */
  factionId: number | null;
  x: number;
  y: number;
  /** 档案年龄（ms，调用方算好） */
  ageMs: number;
  /** 新鲜度档位（调用方用 `intelAgeTier` 算好） */
  tier: 'fresh' | 'stale' | 'cold';
  power: number | null;
  /** 航迹是否可靠（`invalidateKnownTrack` 置 false） */
  reliable?: boolean;
}

export interface MissionMoveInput {
  /** 任务（null = 无任务） */
  mission: { type: string; targetId?: number | string } | null;
  myPos: IntentPoint;
  /**
   * ⚠ **调用方必须先过滤**：只传入 `isKnownTrackReliable(...) === true` 的档案。
   *   本函数**不判可靠性**（否则会引入"第三套可靠判定"——见下）。
   *   `tier === 'cold'` 与坐标非有限仍由本函数兜底（那是"能不能用"，不是"可不可信"）。
   */
  records: readonly MissionRecordLike[];
  /** 已知敌基地位置（无则 null） */
  enemyBaseRec: IntentPoint | null;
  // ⚠ 刻意**不收** myTeam / myPower / myFleetCount / enemyLiveFactionCount /
  //   clueBearing / searchPoint / nowMs：
  //   它们分别属于 `computeForceRatio` / `canCommitSiege`（另两个纯函数）与**第 6 步的调用方**，
  //   本函数一个都不读 —— 签名里留着"传了但不允许影响输出"的参数，等于邀请误用
  //   （与 `SweepAim.fleetId` 被删是同一条规矩）。
}

/**
 * ⚠ **只有三个值**。刻意**不含** `'target-dead'`：
 *   "目标还在不在"只有调用方知道（要看 `resolveMissionTargets` 的返回活对象数组），
 *   本函数只回答"我该去哪"，不回答"目标还在不在"（保持纯函数边界）。
 */
export type MissionMoveReason =
  | 'has-intel'       // 命中一条可用档案 ⇒ 去档案点
  | 'base-only'       // 无可用档案但有已知敌基地 ⇒ 朝基地推进
  | 'no-intel';       // 什么都不知道 ⇒ 搜索（保持任务）

export interface MissionMoveResult {
  kind: 'mission' | 'search';
  dest: IntentPoint | null;
  /** fresh 档案 ⇒ 压上（siege）；stale/无情报 ⇒ 只朝方向摸（search） */
  stance: 'siege' | 'search';
  reason: MissionMoveReason;
  /** 命中的档案（供调用方读 power/vx/vy；未命中为 null） */
  record: MissionRecordLike | null;
}

/**
 * 档案是否可用于导航：**只判"能不能用"**（未过期 + 坐标有限）。
 *
 * ⚠ 刻意**不判** `reliable`：可靠性只有一个真源 `IntelSystem.isKnownTrackReliable`
 *   （它的约定是 `reliable === true`）。若这里再写 `!== false`，就出现两套约定
 *   （缺字段时一个判不可靠、一个判可靠）。⇒ 可靠性由调用方过滤，本函数不碰。
 */
function isUsableRecord(r: MissionRecordLike): boolean {
  if (r.tier === 'cold') return false;
  return Number.isFinite(r.x) && Number.isFinite(r.y);
}

/** 目标匹配：军议写的是**阵营 id**，规划器写的是**舰队 id** —— 两者都要认。 */
function matchesTarget(r: MissionRecordLike, targetId: number | string | undefined): boolean {
  if (targetId === undefined || targetId === null) return false;
  return r.targetId === targetId || r.factionId === targetId;
}

/**
 * 任务 → 目的地（三段解析，**顺序即优先级**）。
 *
 *   ① 有可用档案（命中目标、`reliable!==false`、`tier!=='cold'`）
 *        ⇒ `dest` = 档案末次位置；`stance` = fresh ? 'siege' : 'search'
 *        ⚠ 多条命中时取 **ageMs 最小**（最新）者；同年龄再取**离我最近**；仍相同按 targetId 字典序
 *          —— 三级 tie-break 保证**同一输入必得同一结果**（纯函数不能依赖数组顺序）。
 *   ② 无①、但有已知敌基地 ⇒ `dest` = 基地点，`stance` = 'search'
 *        ⚠ "不直扑"由 **stance** 表达（不进入 siege），而不是靠人为缩短距离
 *          —— 缩短距离需要一个规格常量，本步没有它，凭空造一个数字会把"观感"钉死。
 *   ③ 都没有 ⇒ `dest = null`，`kind = 'search'`（**保留任务**，由调用方按 searchPoint 搜索）
 *
 * ⚠ "目标已歼"不在本函数的判断范围：`live.length === 0` 由调用方判 `clearMission`。
 */
export function resolveMissionMove(input: MissionMoveInput): MissionMoveResult {
  // 调用方本不该在"无任务"时调用（`executeMissionTick` 已在 mission 为空时早退）；
  // 这里保持函数全定义：按"什么都不知道"处理，绝不抛错。
  if (!input.mission) {
    return { kind: 'search', dest: null, stance: 'search', reason: 'no-intel', record: null };
  }

  const targetId = input.mission.targetId;
  let best: MissionRecordLike | null = null;
  let bestD = Infinity;
  for (const r of input.records) {
    if (!isUsableRecord(r)) continue;
    if (!matchesTarget(r, targetId)) continue;
    const d = Math.hypot(r.x - input.myPos.x, r.y - input.myPos.y);
    if (best === null) { best = r; bestD = d; continue; }
    if (r.ageMs < best.ageMs) { best = r; bestD = d; continue; }
    if (r.ageMs === best.ageMs) {
      if (d < bestD) { best = r; bestD = d; continue; }
      if (d === bestD && String(r.targetId) < String(best.targetId)) { best = r; bestD = d; }
    }
  }

  if (best) {
    return {
      kind: 'mission',
      dest: { x: best.x, y: best.y },
      stance: best.tier === 'fresh' ? 'siege' : 'search',
      reason: 'has-intel',
      record: best,
    };
  }
  if (input.enemyBaseRec) {
    return { kind: 'mission', dest: { x: input.enemyBaseRec.x, y: input.enemyBaseRec.y }, stance: 'search', reason: 'base-only', record: null };
  }
  return { kind: 'search', dest: null, stance: 'search', reason: 'no-intel', record: null };
}
