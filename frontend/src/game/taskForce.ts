/**
 * taskForce — 分舰队（战术编队）编成与战法（纯计算模块 · 单一真源）
 *
 * 解决的问题（用户原话）：
 *   「**迂回、包抄、后勤战、分舰队、诱饵舰队**这些都没有……我需要的是个**大构建**，
 *     从底层就能够实现**战术的多样性、可玩性、变化**」
 *
 * 核心判断（见 `docs/design/3d-tactical-battle/24-tactical-architecture-rebuild.md` §2）：
 *   **迂回 / 包抄 / 诱饵 / 后勤战 —— 四项全是"多路协同"，共同前提是"力量可分解"。**
 *   现状 `globalFleets` 里一支舰队是**不可分的原子** ⇒ 上述战法在结构上无法表达。
 *   ⇒ 补上"分舰队"这一个抽象，四者就从"四个功能"变成"**计划的四种取值**"。
 *
 * 本模块只做**编成规划**（要分几路、每路多少兵力、往哪一侧、干什么），
 *   **不碰渲染、不碰寻路、不碰战斗数值** —— 执行由 BattleScene（L4）承担。
 *   机动几何（两翼不互穿的闭式解）复用既有的 `config/fleetSplitManeuver.ts`。
 */

// ============================================================
// A. 战法（Maneuver）
// ============================================================

export type ManeuverType = 'frontal' | 'flank' | 'pincer' | 'decoy' | 'raid' | 'screen' | 'hold';

/** 分舰队在战法中的角色 */
export type DetachRole = 'main' | 'left' | 'right' | 'decoy' | 'raider' | 'screen' | 'reserve';

export interface DetachmentSpec {
  role: DetachRole;
  /** 兵力占比（相对母舰队，各 role 之和应为 1） */
  share: number;
  /** 相对交战轴的侧向符号：-1 左 / 0 正面 / +1 右 */
  lateral: -1 | 0 | 1;
  /** 该路的意图描述（用于头顶标签 / UI 可读性） */
  intent: string;
  /** 该路的主要目标类型 */
  targetKind: 'enemy_fleet' | 'enemy_supply' | 'ally_supply' | 'point' | 'escort_main';
}

export interface ManeuverTemplate {
  id: ManeuverType;
  label: string;
  /** 至少需要多少支舰队才能编成（不足则降级到 `frontal`） */
  minFleets: number;
  detachments: DetachmentSpec[];
  /** 偏好此战法的提督风格标签（空数组 = 通用兜底） */
  preferredBy: string[];
}

/**
 * 战法库。**每一项都是"分舰队的取值的组合"**，而非独立功能 ——
 * 这正是"从底层实现多样性"的落点：新增战法只需加一条数据，无需改执行层。
 */
export const MANEUVERS: Record<ManeuverType, ManeuverTemplate> = {
  /** 正面突击：一路压上，靠进攻性取胜（毕典菲尔特式） */
  frontal: {
    id: 'frontal', label: '正面突击', minFleets: 1,
    detachments: [
      { role: 'main', share: 1.0, lateral: 0, intent: '正面压上', targetKind: 'enemy_fleet' },
    ],
    preferredBy: ['frontal_assault', 'aggressive'],
  },
  /** 迂回：主力正面牵制 + 一翼侧击 */
  flank: {
    id: 'flank', label: '一翼迂回', minFleets: 2,
    detachments: [
      { role: 'main', share: 0.6, lateral: 0, intent: '正面牵制', targetKind: 'enemy_fleet' },
      { role: 'right', share: 0.4, lateral: 1, intent: '右翼迂回', targetKind: 'enemy_fleet' },
    ],
    preferredBy: ['mobile_raid', 'firepower'],
  },
  /** 钳形包抄：正面牵制 + 两翼同时包夹（几何复用 fleetSplitManeuver） */
  pincer: {
    id: 'pincer', label: '两翼包抄', minFleets: 3,
    detachments: [
      { role: 'main', share: 0.4, lateral: 0, intent: '正面牵制', targetKind: 'enemy_fleet' },
      { role: 'left', share: 0.3, lateral: -1, intent: '左翼包夹', targetKind: 'enemy_fleet' },
      { role: 'right', share: 0.3, lateral: 1, intent: '右翼包夹', targetKind: 'enemy_fleet' },
    ],
    preferredBy: ['mobile_raid', 'intel_focus'],
  },
  /** 诱饵：小股示弱引出敌军，主力侧击（损失可控的非对称战法） */
  decoy: {
    id: 'decoy', label: '诱饵诱敌', minFleets: 2,
    detachments: [
      { role: 'decoy', share: 0.25, lateral: 0, intent: '示弱诱敌', targetKind: 'enemy_fleet' },
      { role: 'main', share: 0.75, lateral: 1, intent: '侧击主力', targetKind: 'enemy_fleet' },
    ],
    preferredBy: ['intel_focus'],
  },
  /** 后勤猎杀：一路切敌方补给链，主力牵制（连既有补给链基础设施） */
  raid: {
    id: 'raid', label: '后勤猎杀', minFleets: 2,
    detachments: [
      { role: 'raider', share: 0.3, lateral: 1, intent: '猎杀运输舰', targetKind: 'enemy_supply' },
      { role: 'main', share: 0.7, lateral: 0, intent: '牵制主力', targetKind: 'enemy_fleet' },
    ],
    preferredBy: ['logistics_focus'],
  },
  /** 掩护：主力作战 + 一路护航己方补给 */
  screen: {
    id: 'screen', label: '补给护航', minFleets: 2,
    detachments: [
      { role: 'main', share: 0.7, lateral: 0, intent: '主力作战', targetKind: 'enemy_fleet' },
      { role: 'screen', share: 0.3, lateral: -1, intent: '护航补给', targetKind: 'ally_supply' },
    ],
    preferredBy: ['logistics_focus', 'counter_defense'],
  },
  /** 固守：不拆分，守要点 */
  hold: {
    id: 'hold', label: '固守要点', minFleets: 1,
    detachments: [
      { role: 'main', share: 1.0, lateral: 0, intent: '固守要点', targetKind: 'point' },
    ],
    preferredBy: ['cautious', 'counter_defense'],
  },
};

/** 降级链：舰队数不足时逐级退到可执行的最小战法 */
const DEGRADE: Record<ManeuverType, ManeuverType> = {
  pincer: 'flank', flank: 'frontal', decoy: 'frontal', raid: 'frontal',
  screen: 'frontal', frontal: 'frontal', hold: 'hold',
};

// ============================================================
// B. 战法选择（教范 × 态势）
// ============================================================

/** 每一路最少需要几艘战斗舰（低于此不编路，避免建出 1 艘的"舰队"） */
export const MIN_UNITS_PER_ROUTE = 2;
/** 路数上限 = 战法库里最大的 `minFleets`（目前是 `pincer` 的 3 路） */
export const MAX_ROUTES = 3;

export interface ManeuverContext {
  /** 可用舰队数（= 该阵营在场且未溃的舰队数）。
   *  ⚠ **`selectManeuver` 当前不消费它** —— 可行性一律按 `maxRoutes` 判。
   *  保留为调用方上下文 / UI 备用，避免后来者误以为它影响战法选择。 */
  fleetCount: number;
  /**
   * **可编成的路数上限**（含"拆分现有舰队补足路数"的能力）。
   *
   * ⚠ 必须与 `fleetCount` **分离** —— 这是 2026-09-19 实报 bug 的根因：
   *   `feasible()` 原先用 `fleetCount` 去比 `minFleets`，但**"分兵"的前提恰恰是现有舰队不够**。
   *   于是 1 支舰队时 `flank/pincer/decoy/raid/screen`（minFleets ≥ 2）全判不可行
   *   ⇒ 降级到 `frontal` ⇒ 分兵按钮**永远**提示"单路战法，无需拆分"（自锁，用户实报
   *   "米达麦亚、莱因哈特都提示单路战法"）。
   *   语义修正：`fleetCount` = 现在有几支；`maxRoutes` = **最多能组织几路**。
   */
  maxRoutes: number;
  /** 兵力比 = 我方 / 敌方（>1 优势） */
  forceRatio: number;
  /** 该阵营是否有可猎杀的敌方补给（敌方运输舰在场） */
  enemySupplyPresent?: boolean;
  /** 我方是否有需要护航的补给 */
  ownSupplyPresent?: boolean;
  /** 是否处于劣势方（>1 时倾向保守战法） */
  defensive?: boolean;
}

/**
 * 按**教范偏好 → 态势可行性 → 降级**三层选战法。
 * 纯函数、无随机 ⇒ 同输入必同输出（便于台架与回放）。
 *
 * 优先级：
 *   ① 教范 `preferredBy` 命中且**兵力/舰队数可行** → 采用；
 *   ② 否则按态势兜底：劣势 → `hold`；有敌方补给且风格重后勤 → `raid`；优势 → `pincer`（够 3 队时）；
 *   ③ 仍不可行 → 按 `DEGRADE` 链逐级降级到 `frontal`。
 */
export function selectManeuver(preferredBy: string[], ctx: ManeuverContext): ManeuverType {
  const feasible = (m: ManeuverType): boolean => {
    const t = MANEUVERS[m];
    // 用 `maxRoutes`（可编成路数）而非 `fleetCount`（现有舰队数）——见 `ManeuverContext.maxRoutes` 注释。
    if (t.minFleets > ctx.maxRoutes) return false;
    if (m === 'raid') return !!ctx.enemySupplyPresent;
    if (m === 'screen') return !!ctx.ownSupplyPresent;
    return true;
  };

  // ① 教范偏好（按 preferredBy 的顺序取第一个可行的）
  for (const style of preferredBy) {
    const cands = (Object.keys(MANEUVERS) as ManeuverType[])
      .filter(m => MANEUVERS[m].preferredBy.includes(style))
      // 同一风格下优先"拆分更多路"的战法（更有战术含量），但受可行性约束
      .sort((a, b) => MANEUVERS[b].detachments.length - MANEUVERS[a].detachments.length);
    for (const m of cands) if (feasible(m)) return m;
  }

  // ② 态势兜底
  if (ctx.defensive || ctx.forceRatio < 0.8) return feasible('hold') ? 'hold' : 'frontal';
  if (ctx.forceRatio > 1.5 && feasible('pincer')) return 'pincer';
  if (ctx.enemySupplyPresent && feasible('raid')) return 'raid';
  if (feasible('flank')) return 'flank';

  // ③ 降级链（同样按"可编成路数"而非现有舰队数）
  let m: ManeuverType = 'frontal';
  while (MANEUVERS[m].minFleets > ctx.maxRoutes && DEGRADE[m] !== m) m = DEGRADE[m];
  return m;
}

// ============================================================
// C. 编成（把 N 支舰队分配到战法的各路）
// ============================================================

export interface FleetRef {
  id: number | string;
  /** 战力（用于分配兵力占比，并让强队优先担任 main） */
  power: number;
}

export interface DetachmentPlan {
  role: DetachRole;
  /** 编入本路的舰队 id（按战力降序） */
  fleetIds: (number | string)[];
  lateral: -1 | 0 | 1;
  intent: string;
  targetKind: DetachmentSpec['targetKind'];
}

/**
 * 把若干舰队编成到某战法的各路。
 *
 * 规则（确定性，无随机）：
 *   ① 舰队按战力降序；
 *   ② `main` 路先分（拿最强的一支作为核心）；
 *   ③ 其余路按 `share` 由大到小，依次从剩余舰队里按**序号取模**分配（保证每路至少一支，若够）；
 *   ④ 若舰队数 < 战法要求，自动降级（见 `selectManeuver` 的降级链）。
 */
export function assignDetachments(fleets: FleetRef[], maneuver: ManeuverType): DetachmentPlan[] {
  const tpl = MANEUVERS[maneuver];
  const sorted = [...fleets].sort((a, b) => b.power - a.power);
  if (sorted.length === 0) return [];

  const dets = [...tpl.detachments].sort((a, b) => b.share - a.share);
  const buckets: (number | string)[][] = dets.map(() => []);

  // ① main 先拿最强
  if (dets[0]) buckets[0].push(sorted[0].id);
  // ② 其余按序号取模轮转，保证每路都有（若数量足够）
  for (let i = 1; i < sorted.length; i++) {
    const target = dets.length === 1 ? 0 : (i % dets.length);
    buckets[target].push(sorted[i].id);
  }

  return dets.map((spec, i) => ({
    role: spec.role,
    fleetIds: buckets[i],
    lateral: spec.lateral,
    intent: spec.intent,
    targetKind: spec.targetKind,
  }));
}

/**
 * 按编成计划把 `unitCount` 个实体切分到各路。
 *
 * 目的：给出"每路带走几艘舰"的**确定性**整数分配（执行层据此切 `fleet.units`）。
 * 规则：
 *   ① 按 `share` 比例取整；
 *   ② 余数按**小数部分降序**补齐（并列则按路序，保证确定性）；
 *   ③ 若 `unitCount >= 路数`，则**保证每路至少 1 艘**（否则会建出空编队）。
 *
 * ⚠ 运输舰（`classType==='补给'`）**不参与**本分配 —— 与 `formationSlot` 的口径一致，
 *   补给舰走独立的往返补给逻辑（见 `SupplyChainSystem`）。
 */
export function splitUnitCounts(unitCount: number, dets: { share: number }[]): number[] {
  const n = dets.length;
  if (n === 0 || unitCount <= 0) return dets.map(() => 0);

  const raw = dets.map(d => d.share * unitCount);
  const out = raw.map(v => Math.floor(v));
  let rem = unitCount - out.reduce((a, b) => a + b, 0);

  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  for (let k = 0; k < order.length && rem > 0; k++, rem--) out[order[k].i]++;

  // 保底：每路至少 1（仅当实体数够）
  if (unitCount >= n) {
    for (let i = 0; i < n; i++) {
      if (out[i] > 0) continue;
      // 从当前最多的一路借 1
      let donor = 0;
      for (let j = 1; j < n; j++) if (out[j] > out[donor]) donor = j;
      if (out[donor] > 1) { out[donor]--; out[i]++; }
    }
  }
  return out;
}

/** 某战法需要的路数（用于 UI 提示/可行性判断） */
export function requiredFleets(maneuver: ManeuverType): number {
  return MANEUVERS[maneuver].minFleets;
}

/**
 * **可编成路数**：手上这些舰队一共能编出几路（含拆分能力）。
 * 路数 = Σ floor(该队舰数 / `MIN_UNITS_PER_ROUTE`)，上限 `MAX_ROUTES`，下限 1（`frontal` 恒可用）。
 *
 * 例：8 艘 ⇒ 4 → clamp 3；6 艘 ⇒ 3；4 艘 ⇒ 2；2 艘 ⇒ 1。
 * 这是 `ManeuverContext.maxRoutes` 的唯一来源，取代原来误用的"现有舰队数"。
 */
export function maxRoutesFor(unitCounts: readonly number[]): number {
  const total = unitCounts.reduce((s, n) => s + Math.floor(Math.max(0, n) / MIN_UNITS_PER_ROUTE), 0);
  return Math.max(1, Math.min(total, MAX_ROUTES));
}

/** 战法中文名（UI） */
export function maneuverLabel(maneuver: ManeuverType): string {
  return MANEUVERS[maneuver]?.label ?? maneuver;
}

// ============================================================
// D. 分兵禁止条件与分队生命周期（design §Tactical plans and splitting 后半）
// ============================================================

/** 分兵禁止原因（拒绝时给玩家可读反馈） */
export type SplitDenyReason =
  | 'force_size'         // 总兵力不足阈值
  | 'ship_condition'     // 舰况（hpPct）过低
  | 'no_space'           // 侧向无展开余地
  | 'contact_quality'    // 情报不足（没有可靠接触）
  | 'command_bandwidth'; // 指挥带宽降级中（协同能力不足）

/** 分兵禁止条件的中文反馈（UI toast 消费） */
export const SPLIT_DENY_LABELS: Record<SplitDenyReason, string> = {
  force_size: '兵力不足，无法编成多路',
  ship_condition: '舰况过差，不宜再分散兵力',
  no_space: '侧向无展开余地，无法分进',
  contact_quality: '情报不足，分兵将失去目标',
  command_bandwidth: '指挥带宽降级中，无法协同多路',
};

/** 总兵力阈值：拆两路、每路至少 MIN_UNITS_PER_ROUTE 艘 */
export const MIN_SPLIT_UNITS = MIN_UNITS_PER_ROUTE * 2;
/** 舰况阈值：平均 hpPct 低于此禁止分兵 */
export const MIN_SPLIT_HP_PCT = 0.5;
/** 侧向展开空间阈值（世界 px；DETACH_SPACING=200 的翼侧部署需留余量） */
export const MIN_SPLIT_LATERAL_SPACE = 240;
/** 接触质量阈值：0=情报不足（拒）/1=档案接触（含末次位置）/2=实时识别 */
export const MIN_SPLIT_CONTACT_QUALITY = 1;

export interface SplitCheckInput {
  /** 参与拆分的战斗舰数（不含补给/运输） */
  combatUnits: number;
  /** 平均舰况（0..1） */
  hpPct: number;
  /** 侧向可用展开空间（世界 px，调用方按地图边界算） */
  lateralSpace: number;
  /** 接触质量：0=情报不足 / 1=档案接触 / 2=实时识别 */
  contactQuality: 0 | 1 | 2;
  /** 指挥带宽是否降级（旗舰降级/中继收缩窗口） */
  commandDegraded: boolean;
}

export interface SplitCheckResult {
  ok: boolean;
  reason: SplitDenyReason | null;
}

/**
 * **分兵禁止条件**（design §Tactical plans and splitting：不够则拒绝并反馈原因）。
 * 判定顺序：force size → 舰况 → 可用空间 → 接触质量 → 协同能力。
 * 纯函数、无随机 ⇒ 同输入必同输出（台架可逐条打）。
 */
export function canSplit(input: SplitCheckInput): SplitCheckResult {
  if ((input.combatUnits ?? 0) < MIN_SPLIT_UNITS) return { ok: false, reason: 'force_size' };
  if ((input.hpPct ?? 0) < MIN_SPLIT_HP_PCT) return { ok: false, reason: 'ship_condition' };
  if ((input.lateralSpace ?? 0) < MIN_SPLIT_LATERAL_SPACE) return { ok: false, reason: 'no_space' };
  if ((input.contactQuality ?? 0) < MIN_SPLIT_CONTACT_QUALITY) return { ok: false, reason: 'contact_quality' };
  if (input.commandDegraded) return { ok: false, reason: 'command_bandwidth' };
  return { ok: true, reason: null };
}

/** 分队归队原因（abort → rejoin） */
export type RejoinReason = 'timeout' | 'attrition' | 'objective_done';

export const REJOIN_LABELS: Record<RejoinReason, string> = {
  timeout: '分出超时，归队重组',
  attrition: '兵力损失过重，归队重组',
  objective_done: '任务完成，归队重组',
};

/** 分出超时上限（ms）：不得仅因开局规划长期分立 */
export const DETACH_TIMEOUT_MS = 45000;
/** 兵力损失阈值：现存兵力低于分出时的比例 ⇒ 归队 */
export const DETACH_ATTRITION_PCT = 0.5;

export interface RejoinCheckInput {
  /** 分出至今的时间（ms） */
  detachedMs: number;
  /** 分出时战斗舰数 */
  startUnits: number;
  /** 当前战斗舰数 */
  nowUnits: number;
  /** 任务已完成/目标已失（调用方合并判定「错过触发/丢目标/任务完成」） */
  objectiveDone: boolean;
}

export interface RejoinCheckResult {
  rejoin: boolean;
  reason: RejoinReason | null;
}

/**
 * **分队归队判定**（每支分队必须有目的与归队路径）：
 * 错过触发/丢目标/达 abort 阈值（超时 / 兵力损失 / 任务完成）⇒ 归队。
 * 纯函数；调用方在 updateFleets / applyManeuver 后逐分队收口。
 */
export function shouldRejoin(input: RejoinCheckInput): RejoinCheckResult {
  if (input.objectiveDone) return { rejoin: true, reason: 'objective_done' };
  if ((input.detachedMs ?? 0) >= DETACH_TIMEOUT_MS) return { rejoin: true, reason: 'timeout' };
  const start = input.startUnits ?? 0;
  if (start > 0 && (input.nowUnits ?? 0) <= start * DETACH_ATTRITION_PCT) {
    return { rejoin: true, reason: 'attrition' };
  }
  return { rejoin: false, reason: null };
}
