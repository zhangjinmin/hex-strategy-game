/**
 * 战术层「兵力 → 可渲染实体」折算配置 + 舰种数值单一真源。
 *
 * 背景：战略层用 FleetComposition（7 舰种整数）表示 12,000 艘量级舰队，而战术层
 *      只渲染有限个实体。两者之间存在**两套互不相同的比例尺**，必须分开：
 *
 *   ① HP / 战斗比例尺（SHIP_SCALE = 500）：s 艘 → 1 个基准战斗单位，
 *      hp = SHIP_TYPE_HP[t] * (s / 500)。正向装载（gameStore.serializeTacticalFleet）
 *      与反向回写（BattleScene 战后清点）共用本表，禁止各写一份。
 *   ② 实体数比例尺（K_VISUAL）：S 兵力 → N 个可渲染实体，
 *      N = clamp(round(S / K_VISUAL), 1, N_MAX)。只影响「画几艘」。
 *
 * 守恒等式（本设计成立的核心）：把一支舰队的 N 个实体按舰种比例分配，舰种 t 分到 n_t 个
 *   实体（有兵的舰种 n_t ≥ 1），则每个实体摊到 s_t = C_t / n_t 艘，于是
 *     ΣHP = Σ_t n_t * SHIP_TYPE_HP[t] * (s_t / 500) = Σ_t SHIP_TYPE_HP[t] * C_t / 500
 *   只取决于编制 C_t，与 N、K_VISUAL **无关**。调 K_VISUAL 只改「画几艘」，不改战斗平衡总量。
 *
 * 注：`SHIP_TYPE_HP` 与 types/game.ts 里语义不同的 `SHIP_TACTICAL_HP`（造船 HP 口径）
 *     是两张独立的表，请勿混用。
 */
import type { ShipType } from '../types/game';

/** 战斗/HP 比例尺：每 500 艘 = 1 个基准战斗单位 */
export const SHIP_SCALE = 500;

/** ShipType（单数）→ FleetComposition 的键（复数）。
 *  ⚠ 单一真源：`store/fleetStore.ts` 的 `shipTypeToCompKey` 由此重导出，禁止两处各写一份。 */
export const SHIP_TO_COMP_KEY: Record<ShipType, string> = {
  battleship: 'battleships',
  fast_battleship: 'fastBattleships',
  cruiser: 'cruisers',
  destroyer: 'destroyers',
  carrier: 'carriers',
  fighter: 'fighters',
  supply: 'supplies',
};

/** 舰种战术 HP 基准（单一真源：正向装载与反向回写共用） */
export const SHIP_TYPE_HP: Record<ShipType, number> = {
  battleship: 2000,
  fast_battleship: 1700,
  cruiser: 1200,
  destroyer: 800,
  carrier: 1500,
  fighter: 300,
  supply: 900,
};

/** 舰种战术 ATK 基准 */
export const SHIP_TYPE_ATK: Record<ShipType, number> = {
  battleship: 150,
  fast_battleship: 140,
  cruiser: 90,
  destroyer: 120,
  carrier: 60,
  fighter: 110,
  supply: 20,
};

/** 舰种基础防御（getTroopById 取不到时的兜底） */
export const SHIP_TYPE_BASE_DEF: Record<ShipType, number> = {
  battleship: 15,
  fast_battleship: 13,
  cruiser: 10,
  destroyer: 5,
  carrier: 12,
  fighter: 2,
  supply: 5,
};

/** 英文 key → 中文 cls（getTroopById 的 troopId 需要中文） */
export const SHIP_TYPE_CN: Record<ShipType, string> = {
  battleship: '战列',
  fast_battleship: '高战',
  cruiser: '巡洋',
  destroyer: '驱逐',
  carrier: '空母',
  fighter: '舰载',
  supply: '补给',
};

/** 中文 cls → 英文 key（旧存档 / 演习层 classType 为中文时的反向归一） */
export const CN_TO_SHIP_TYPE: Record<string, ShipType> = {
  '战列': 'battleship',
  '高战': 'fast_battleship',
  '巡洋': 'cruiser',
  '驱逐': 'destroyer',
  '空母': 'carrier',
  '舰载': 'fighter',
  '补给': 'supply',
};

/** 固定舰种顺序（用于比例分摊与展示，保证输出稳定） */
export const SHIP_TYPE_ORDER: ShipType[] = [
  'battleship', 'fast_battleship', 'cruiser', 'destroyer', 'carrier', 'fighter', 'supply',
];

/** 把任意 classType（英文 ShipType / 中文 cls）归一为 ShipType；无法识别返回 undefined */
export function resolveShipType(code: string | null | undefined): ShipType | undefined {
  if (!code) return undefined;
  if (Object.prototype.hasOwnProperty.call(SHIP_TYPE_HP, code)) return code as ShipType;
  return CN_TO_SHIP_TYPE[code];
}

// ────────────────────────────────────────────────────────────
// 实体数折算
// ────────────────────────────────────────────────────────────

/**
 * 实体数比例尺档位：**50 / 100 / 250**（数值越小画得越多；用户 2026-09-13 原话
 * "把 1:250 改成 1:100 或者 50"）。默认档 `K_VISUAL_DEFAULT = 100` 必须在选项内。
 * 分母上限（K_VISUAL=50）的几何含义：
 *   · 单队先被 `N_MAX_PER_FLEET = 200` 封顶（100 已接近、50 必触顶）；
 *   · 全场先看 `N_MAX = 1400`：6v6 满编 = 6 队/方 × 2 方 × 200 = **1200 ≤ 1400** ✓ 不触顶；
 *     7v7 满编 = 7 × 2 × 100（均摊）… 实为触顶档：14 队 × 100 = **1400 = N_MAX** 恰好用满，
 *     再要更密只能同时上调 N_MAX（不鼓励，见 N_MAX 的注释）。
 * ⚠ 本常量**当前未被 UI 引用**（frontend/src 内除定义外无引用点），保留为档位真源，
 *   供设置面板/调试口后续接入。
 */
export const K_VISUAL_OPTIONS: readonly number[] = [50, 100, 250];
/**
 * 默认档位 = **100**（用户 2026-09-13 指定："把 1:250 改成 1:100 或者 50"）。
 * 口径：分母越小画得越多。rank11 上将 15000 艘 ⇒ round(15000/100) = **150 艘/队**；
 *       rank12 一级上将 18000 ⇒ 180/队（≤ N_MAX_PER_FLEET=200 不被封顶）。
 * 想再翻倍可设 50（⇒ 300~400 艘/队，会触到 N_MAX_PER_FLEET 与 N_MAX 上限，需同步上调）。
 * ⚠ 这只是一个**默认值**：分母越小画得越多，与守恒律无关（见文件头 ΣHP 等式）。
 */
export const K_VISUAL_DEFAULT = 100;
/**
 * 单场会战（攻守双方**全部舰队合计**）可渲染实体上限。
 * 1400 = 7 队/方 × 2 方 × **100/队**，覆盖"K_VISUAL=100 下的 6v6 满编（6×200=1200）"并留余量。
 * 演进：392（demo 8 队×49）→ 480 → 720 → **1400**（K_VISUAL 默认改 1:100 后同步抬升）。
 *
 * ⚠ 本值只约束**实体预算**（光点层 1 个 draw call，成本 ≈ 每实体 DOT_N 个顶点，可忽略）；
 *   "同时挂 3D 模型的数量"由 Battle3DOverlay 的 `MAX_MESHES`(=400) 独立把关。
 *   二者混成一个常量会把"多画几艘"直接变成"多建几百个模型"。
 * 内存代价（每实体）：dotPos/dotCol 各 DOT_N×3、dotAlpha/dotPx 各 DOT_N；DOT_N=12 时 ≈ 192 B/实体
 *   ⇒ 720 → 1400 净增约 +130 KB，可忽略。
 */
export const N_MAX = 1400;

// 单支舰队实体上限。不是性能上限，是**防舰体互穿 + 足迹预算**的几何上限。
// 推导（2026-09 缩舰后重推；舰体尺寸 = Battle3DOverlay.ts 的 SHIP_RATIO × SHIP_VISUAL_SCALE）：
//   缩舰 0.40 后最宽舰 carrier：W = 0.311*√3*hexR*0.40 = 0.2155*hexR（hexR=50 ⇒ **10.77**）。
//   ① 不互穿：spacingEff >= 10.77。formationSpacing = min(FORMATION_SPACING, FL*hexR/halfExtent)
//      = min(26, 300/halfExtent) ⇒ 压缩 regime 要求 300/halfExtent >= 10.77 ⇒ halfExtent <= 27.9。
//   ② 保持 26 不压缩（"一格一舰"的紧凑观感）：300/halfExtent >= 26 ⇒ halfExtent <= 11.5，
//      楔形 halfExtent = R-1、R = ceil(√n) ⇒ R <= 12 ⇒ **n <= 144** 才不压缩。
//   n=200 ⇒ R=15 ⇒ halfExtent=14 ⇒ spacingEff = min(26, 300/14 = 21.4) = 21.4：
//     比 26 密 18%（"密集编队"），但仍 ≥ 舰宽 10.77 ⇒ **不互穿** ✓（要 100% 不压缩需 n ≤ 144）。
//   n=144 ⇒ R=12 ⇒ halfExtent=11 ⇒ spacingEff=26（未压缩）✓，且远在 ① 的界内。
// ⚠ 抬上限的收益是"军团更密"，代价是绘制量：实体档最坏 120×6 = 720 个模型 × 4 draw。
//   兜底是 Battle3DOverlay 的三级分级（远景只画光点）+ WS7 性能兜底（帧时超预算时收 meshBudget）。
// ⚠ line 阵（横向排宽主导）仍会轻微互穿 —— 既有问题，本轮不处理，仅在此登记。
export const N_MAX_PER_FLEET = 200;

/** 单支舰队预算实体数：S<=0 → 0（不画船）；否则 clamp(round(S/K), 1, min(N_MAX, N_MAX_PER_FLEET)) */
export function fleetVisualCount(
  strength: number,
  kVisual: number = K_VISUAL_DEFAULT,
  nMax: number = N_MAX,
): number {
  if (!(strength > 0)) return 0;
  return Math.min(nMax, N_MAX_PER_FLEET, Math.max(1, Math.round(strength / kVisual)));
}

/**
 * 最大余数法分摊：把 total 个配额按 weights 占比分给 n 份，每份至少 minEach 个。
 * 调用方需保证 total >= n * minEach。输出 Σ = total。
 */
function apportion(weights: number[], total: number, minEach: number): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || total <= 0) return out;
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return out;

  let used = 0;
  const rems: { i: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const prop = (weights[i] / sum) * total;
    const base = Math.max(0, Math.floor(prop));
    out[i] = base;
    used += base;
    rems.push({ i, r: prop - Math.floor(prop) });
  }
  // 保底：不足 minEach 的补到 minEach
  for (let i = 0; i < n; i++) {
    while (out[i] < minEach) {
      out[i] += 1;
      used += 1;
    }
  }
  // 保底后超预算则从多的开始削（不低于 minEach）
  if (used > total) {
    const order = out.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
    for (const o of order) {
      while (used > total && out[o.i] > minEach) {
        out[o.i] -= 1;
        used -= 1;
      }
      if (used <= total) break;
    }
  }
  // 用最大余数补足到 total
  rems.sort((a, b) => b.r - a.r);
  let k = 0;
  const guard = n * (total + 1) + 16;
  while (used < total && k < guard) {
    out[rems[k % n].i] += 1;
    used += 1;
    k += 1;
  }
  return out;
}

/**
 * 全场多舰队实体预算分配：Σn ≤ nMax，按各舰队兵力占比分摊，兵力 > 0 的舰队至少 1。
 * 若各舰队「单舰队预算」之和 ≤ nMax，则原样返回（不放大）。
 */
export function allocateVisualCounts(
  strengths: number[],
  kVisual: number = K_VISUAL_DEFAULT,
  nMax: number = N_MAX,
): number[] {
  const raw = strengths.map((s) => fleetVisualCount(s, kVisual, nMax));
  const sumRaw = raw.reduce((a, b) => a + b, 0);
  if (sumRaw <= nMax) return raw;

  const active = strengths
    .map((s, i) => ({ i, s: Math.max(0, s) }))
    .filter((x) => x.s > 0);
  const out = new Array<number>(strengths.length).fill(0);
  if (active.length === 0) return out;

  // 舰队数已超预算：只保留兵力最大的 nMax 支，各 1（其余为 0）
  if (active.length >= nMax) {
    [...active].sort((a, b) => b.s - a.s).slice(0, nMax).forEach((x) => { out[x.i] = 1; });
    return out;
  }

  const counts = apportion(active.map((x) => x.s), nMax, 1);
  active.forEach((x, idx) => { out[x.i] = counts[idx]; });
  // 单队上限同样适用于摊薄路径：apportion 会把 nMax 全给兵力最大的那支
  for (let i = 0; i < out.length; i++) out[i] = Math.min(out[i], N_MAX_PER_FLEET);
  return out;
}

/** 一支舰队按舰种摊派后的分组结果 */
export interface UnitGroup {
  type: ShipType;
  /** 该舰种的实体数 */
  units: number;
  /** 每个实体摊到的兵力（可小数） */
  shipsPerUnit: number;
}

/** 该编制下实际会生成的实体数（有兵的舰种至少 1 个；无兵返回 0） */
export function effectiveFleetUnits(
  totals: Partial<Record<ShipType, number>>,
  visualCount: number,
): number {
  const active = SHIP_TYPE_ORDER.filter((t) => (totals[t] || 0) > 0);
  if (active.length === 0 || visualCount <= 0) return 0;
  return Math.max(visualCount, active.length);
}

/**
 * ★ 编制 → **该舰队最终会画出几个实体**（含"有兵舰种至少 1"的抬升）。
 *
 * 存在的唯一理由：地图尺度的自变量（`BattleScene.scaleMapForFleetCount` → `hexRadius`）必须是
 * **折算后的实体数**，而不是任何"卡组条数"。历史上演习轨道用 `deck.length`（= 8）算 hexRadius，
 * 与战役轨道（用 `slots.length` = 折算后实体数）不同源 ⇒ 演习里地图尺度恒按 8 艘口径算，
 * `hexRadius` 被压到 32、`spacingEff` 与舰体 px 一起变小 —— 即使把实体数改对，演习仍不是会战尺度。
 *
 * ⚠ 任何"我需要知道这支舰队会有几艘"的地方都必须调本函数，禁止再写 `deck.length` / `enemyCount * 8`。
 */
export function fleetEntityCount(
  totals: Partial<Record<ShipType, number>>,
  kVisual: number = K_VISUAL_DEFAULT,
): number {
  const strength = SHIP_TYPE_ORDER.reduce((a, t) => a + (totals[t] || 0), 0);
  return effectiveFleetUnits(totals, fleetVisualCount(strength, kVisual));
}

/**
 * [v14 ②] **单支舰队的补给舰实体上限**（per-fleet supply entity cap）。
 *
 * 背景（用户实机反馈"补给船数量不对称"）：演习 5vs1 时每队 entityBudget=200、
 * 编制 supplies 权重 1000/21000，`apportion` 会给每队 ≈ 9 个补给实体；而每个补给
 * 实体都会驱动 1 艘独立往返运输舰（`collectAuxShips` 无上限）⇒ 一支 200 实体的
 * 舰队里挤进 9 艘运输舰，观感失衡且远超"1-2 艘"设计意图。
 *
 * 处置：在本唯一折算入口把补给实体**封顶到 2**，多出的实体按各舰种兵力权重回补给
 * 其他舰种，保持 Σunits = effectiveFleetUnits（守恒不破——每个舰种总兵力只按
 * `shipsPerUnit = totals[t] / counts[t]` 摊到自己的实体上，ΣHP/ΣATK 仍只取决于编制）。
 *
 * ⚠ 两条部署路径（战役 scaledSlotsForComposition / 演习 buildTacticalUnits）都经本函数，
 *   无需各自再写一份 cap。
 */
export const SUPPLY_UNIT_CAP = 2;

/**
 * 把一支舰队的 visualCount 个实体按各舰种兵力占比摊派到舰种上。
 * 有兵的舰种至少 1 个实体（避免该舰种兵力凭空丢失）；返回 Σunits = effectiveFleetUnits。
 *
 * [v14 ②] 补给舰实体封顶 `SUPPLY_UNIT_CAP`：超出部分回补其他舰种（保持 Σ=nEff、各舰种 ≥1）。
 */
export function allocateUnitsPerType(
  totals: Partial<Record<ShipType, number>>,
  visualCount: number,
): UnitGroup[] {
  const active = SHIP_TYPE_ORDER.filter((t) => (totals[t] || 0) > 0);
  if (active.length === 0 || visualCount <= 0) return [];
  const nEff = Math.max(visualCount, active.length);
  const counts = apportion(active.map((t) => totals[t] || 0), nEff, 1);

  // ── [v14 ②] 补给舰 per-fleet 封顶 ──
  const supIdx = active.indexOf('supply');
  if (supIdx >= 0 && counts[supIdx] > SUPPLY_UNIT_CAP) {
    const excess = counts[supIdx] - SUPPLY_UNIT_CAP;
    counts[supIdx] = SUPPLY_UNIT_CAP;
    const others = active.map((_, i) => i).filter((i) => i !== supIdx);
    if (others.length > 0) {
      const wsum = others.reduce((a, i) => a + (totals[active[i]] || 0), 0) || others.length;
      const add = others.map((i) => ({ i, f: ((totals[active[i]] || 0) / wsum) * excess }));
      let used = 0;
      add.forEach((a) => { const k = Math.floor(a.f); counts[a.i] += k; used += k; });
      const rem = add.map((a) => ({ i: a.i, r: a.f - Math.floor(a.f) })).sort((a, b) => b.r - a.r);
      let k = 0;
      while (used < excess) { counts[rem[k % rem.length].i] += 1; used += 1; k += 1; }
    } else {
      // 退化：只有补给舰种（理论上不会出现 7 舰种编制）——保底塞回补给，不破坏 Σ
      counts[supIdx] += excess;
    }
  }

  return active.map((t, i) => ({
    type: t,
    units: counts[i],
    shipsPerUnit: (totals[t] || 0) / counts[i],
  }));
}

// ────────────────────────────────────────────────────────────
// ★ 唯一折算入口（两条部署路径共用）
//
// 背景（T-3D-GRANDFLEET-002）：战术层有**两条互不相干的部署路径**
//   路径 A｜战役  gameStore.launchTacticalBattle → serializeTacticalFleet → slots → BattleScene.deploySide
//   路径 B｜演习  gameStore.launchSimBattle       → BattleScene.initFactions + spawnInitialFleets
// 历史上路径 B 读的是**硬编码 deck 列表**（simFullDeck = 8 艘），完全绕过本文件的折算 ⇒
// "把 K_VISUAL/N_MAX 调大"只在战役生效，用户在演习里看到的恒是 8 艘。
// 现在两条路径**都必须**经过下面这两个函数：
//   scaledSlotsForComposition：编制 → N 个实体（每个实体摊到多少兵）
//   applyStatsToSlots       ：实体 + 倍率 → 每个实体的 hp/atk/…（含守恒余数补偿）
// 禁止任何调用方再自己算一遍实体数或再自己写一遍 HP 公式。
// ────────────────────────────────────────────────────────────

/** FleetComposition（复数键）→ ShipType 总量表（键映射只此一份） */
export function totalsOfComposition(
  comp: Partial<Record<string, number>> | null | undefined,
): Partial<Record<ShipType, number>> {
  const out: Partial<Record<ShipType, number>> = {};
  for (const t of SHIP_TYPE_ORDER) out[t] = Number((comp as any)?.[SHIP_TO_COMP_KEY[t]] || 0);
  return out;
}

/** 折算出的一个实体（**只有几何与兵力**，还没有 hp/atk） */
export interface ScaledSlot {
  type: ShipType;
  /** 该实体摊到的兵力（可小数）。Σcount = 该舰队总兵力，不丢兵 */
  count: number;
  x: number;
  y: number;
}

/**
 * 编制 + 实体预算 → 实体清单（唯一口径）。
 * 有兵的舰种至少 1 个实体（否则该舰种兵力凭空丢失）。
 * coordSource：持久化槽位，**只复用其坐标**，且仅当条数与重算实体数相等时复用；否则按网格重排。
 */
export function scaledSlotsForComposition(
  totals: Partial<Record<ShipType, number>>,
  visualCount: number,
  coordSource?: { x?: number; y?: number }[] | null,
): ScaledSlot[] {
  const groups = allocateUnitsPerType(totals, visualCount);
  const totalUnits = groups.reduce((a, g) => a + g.units, 0);
  if (totalUnits <= 0) return [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(totalUnits)));
  const coords = Array.isArray(coordSource) && coordSource.length === totalUnits ? coordSource : [];
  const out: ScaledSlot[] = [];
  let idx = 0;
  for (const g of groups) {
    for (let u = 0; u < g.units; u++) {
      const src = coords[idx];
      out.push({
        type: g.type,
        count: g.shipsPerUnit,
        x: src && typeof src.x === 'number' ? src.x : idx % cols,
        y: src && typeof src.y === 'number' ? src.y : Math.floor(idx / cols),
      });
      idx += 1;
    }
  }
  return out;
}

/** 战术层单个实体的**数值**（不含任何 Phaser/Three 对象）——两条路径唯一共用产物 */
export interface TacticalUnitSeed {
  /** 归一后的舰种 */
  type: ShipType;
  /** 中文 cls（= 旧实现 getTroopById 的 classType 口径） */
  classType: string;
  /** 该实体摊到的兵力（可小数）——正向 HP 折算与反向精确回写共用 */
  count: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  speed: number;
  range: number;
  interval: number;
  /** 布阵格位 */
  gridX: number;
  gridY: number;
}

/**
 * 数值倍率上下文。两条路径各自把"提督属性 / 科技 / 补给 / 士气 / 难度"折算成这 4 个标量后传进来，
 * **公式本身只有一份**（见 applyStatsToSlots）。
 */
export interface ShipStatMods {
  /** HP 侧统一倍率 = 防御属性倍率 × 补给系数 × 装甲科技倍率 */
  hpMul: number;
  /** ATK 侧统一倍率 = 攻击属性倍率 × 士气系数 × 武器科技倍率 */
  atkMul: number;
  /** 防御数值倍率（只影响 def 字段） */
  defMul: number;
  /** 引擎科技倍率 */
  engineMul: number;
}

/** getTroopById 返回值的**结构子集**（两条路径的 troop 数据源不同，但字段口径相同） */
export interface TroopLike {
  cls?: string;
  def?: number;
  speed?: number;
  range?: number;
  interval?: number;
}

/**
 * 实体清单 + 倍率 → 每实体数值（唯一 HP/ATK 公式 + **守恒余数补偿**）。
 *
 * 守恒：同一舰种被拆成 n 个实体时，逐实体 floor 会让 ΣHP 随实体数漂移。
 * 这里按舰种聚合，把整数余数补偿回各实体，使
 *   ΣHP = round(SHIP_TYPE_HP[t] × hpMul × C_t / SHIP_SCALE)
 * 只取决于该舰种总兵力 C_t，**与实体数（K_VISUAL）严格无关**。
 */
export function applyStatsToSlots(
  slots: ScaledSlot[],
  mods: ShipStatMods,
  troopOf: (type: ShipType) => TroopLike | undefined,
): TacticalUnitSeed[] {
  const units: TacticalUnitSeed[] = slots.map((s) => {
    const t = troopOf(s.type);
    const scaleCount = Math.max(0, s.count) / SHIP_SCALE;
    const classType = t?.cls || SHIP_TYPE_CN[s.type];
    return {
      gridX: s.x,
      gridY: s.y,
      type: s.type,
      count: s.count,
      classType,
      hp: Math.floor(SHIP_TYPE_HP[s.type] * mods.hpMul * scaleCount),
      maxHp: Math.floor(SHIP_TYPE_HP[s.type] * mods.hpMul * scaleCount),
      atk: Math.floor(SHIP_TYPE_ATK[s.type] * mods.atkMul * scaleCount),
      def: Math.floor((t?.def ?? SHIP_TYPE_BASE_DEF[s.type]) * mods.defMul),
      speed: (t?.speed ?? 0.5) * mods.engineMul,
      range: t?.range ?? 150,
      interval: t?.interval ?? 3000,
    };
  });

  // 按舰种聚合补偿整数余数 → ΣHP / ΣATK 只取决于兵力
  const agg = new Map<ShipType, { idxs: number[]; ships: number }>();
  units.forEach((u, i) => {
    const a = agg.get(u.type) || { idxs: [], ships: 0 };
    a.idxs.push(i);
    a.ships += u.count || 0;
    agg.set(u.type, a);
  });
  agg.forEach((a, type) => {
    const n = a.idxs.length;
    const distribute = (get: (u: TacticalUnitSeed) => number, add: (u: TacticalUnitSeed, d: number) => void, ideal: number) => {
      let delta = ideal - a.idxs.reduce((s, i) => s + get(units[i]), 0);
      let k = 0;
      const guard = n * (Math.abs(delta) + 2) + 16;
      while (delta > 0 && k < guard) { add(units[a.idxs[k % n]], 1); delta -= 1; k += 1; }
      k = 0;
      while (delta < 0 && k < guard) {
        const u = units[a.idxs[k % n]];
        if (get(u) > 0) { add(u, -1); delta += 1; }
        k += 1;
      }
    };
    distribute((u) => u.maxHp, (u, d) => { u.maxHp += d; u.hp += d; },
      Math.round(SHIP_TYPE_HP[type] * mods.hpMul * (a.ships / SHIP_SCALE)));
    distribute((u) => u.atk, (u, d) => { u.atk += d; },
      Math.round(SHIP_TYPE_ATK[type] * mods.atkMul * (a.ships / SHIP_SCALE)));
  });

  return units;
}

/** ★ 唯一折算入口：编制 + 实体预算 + 倍率 → 逐实体数值清单 */
export function buildTacticalUnits(
  totals: Partial<Record<ShipType, number>>,
  visualCount: number,
  mods: ShipStatMods,
  troopOf: (type: ShipType) => TroopLike | undefined,
  coordSource?: { x?: number; y?: number }[] | null,
): TacticalUnitSeed[] {
  return applyStatsToSlots(scaledSlotsForComposition(totals, visualCount, coordSource), mods, troopOf);
}

/** 该编制下"不画任何东西"的判据：总兵力 ≤ 0 */
export function totalShipsOf(totals: Partial<Record<ShipType, number>>): number {
  return SHIP_TYPE_ORDER.reduce((a, t) => a + (totals[t] || 0), 0);
}
