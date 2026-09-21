/**
 * terrainEffects — 战场地形影响表（v33 · 单一真源 · 纯数据）
 *
 * 现状问题：`BattleScene` 里三个并列 switch（`getTerrainSpeedMul` / `getTerrainRangeMul` /
 * `getTerrainDodgeMul`）各写一份 `terrain` 分支 ⇒ 新增一种地形要改三处、易漏；
 * 而旧案 44 图地形表（`docs/design/loch-web-plan/01_*` §6.6）的**5 列**
 * （移动 / 索敌 / 损伤 / 清除 / 冒险）里，现项目只实现了 3 列且**没有索敌与损伤**。
 *
 * 本模块把三列收口成一张表，并补上：
 *   · `visionMul`（索敌列）—— 现项目**已有插槽**：`getVisionRange()` 返回视野半径、
 *     `clarity` 已按 `d/visionRange` 分 full/partial/fuzzy，只是从没被地形影响过。
 *   · `dotPct`（损伤列）—— 机雷 / 杰夫粒子云的持续损伤。
 *
 * ── 等级取值直接来自旧案表的偏序（无/小/中/大/极大），不借绝对数值 ──────────
 *   LEVEL = { none 1.00, small 0.90, mid 0.75, large 0.55, huge 0.35 }（见 balance.TERRAIN_RULES）
 *
 * ── ⚠ 既有 4 种地形的现有乘数一律**原样保留** ────────────────────────────
 * 只"新增"索敌列，不"重标定"既有列 ⇒ 本项对既有手感的改变仅来自视野。
 *
 * ── 不做「清除 / 冒险使用」两列 ──────────────────────────────────────────
 * 前者需要新指令（排雷）、后者需要新机制（强行穿越的额外风险），
 * 与现项目「自动交战 + 少量指令」的节奏不匹配，留待战役玩法批次。
 */

import { TERRAIN_RULES } from './balance';

export interface TerrainEffect {
  /** 展示名（渲染标记与战报用） */
  label: string;
  /** 移速乘区 */
  speedMul: number;
  /** 射程乘区（开火方所在格） */
  rangeMul: number;
  /** 闪避乘区（>1 = 更难被命中 ⇒ 既有口径是"除以 dodgeMul"） */
  dodgeMul: number;
  /** 视野乘区（P1-4.1 新增；1.0 = 不影响索敌） */
  visionMul: number;
  /** 持续损伤：每 `TERRAIN_RULES.DOT_TICK_MS` 扣 `maxHp × dotPct`（0 = 无损伤） */
  dotPct: number;
}

/**
 * 地形 id → 影响。`key` 与 `BattleScene.tile.terrain` 同域。
 *
 * 旧案出处对照（只借等级，不借数值）：
 *   小行星带  → asteroid（移动 中 / 索敌 大 / 损伤 中）
 *   陨石带    → debris  （移动 中 / 索敌 大 / 损伤 大）
 *   异常重力区 → gravity （移动 大，本项目既有实现为"加速 1.3"的引力点）
 *   杰夫粒子云 → nebula（索敌 小 → 0.90；本项目既有实现另给闪避 +20%，两处同向）
 *   机雷      → mine    （移动 大 / 索敌 中 / 损伤 特殊）
 *   杰夫粒子云 → jeff   （移动 小 / 索敌 小 / 损伤 特殊）
 */
export const TERRAIN_EFFECT_TABLE: Record<string, TerrainEffect> = {
  nebula:   { label: '星云',       speedMul: 0.60, rangeMul: 1.00, dodgeMul: 1.20, visionMul: 0.90, dotPct: 0 },
  asteroid: { label: '小行星带',   speedMul: 0.80, rangeMul: 0.70, dodgeMul: 1.00, visionMul: 0.55, dotPct: 0 },
  gravity:  { label: '引力点',     speedMul: 1.30, rangeMul: 1.00, dodgeMul: 1.00, visionMul: 0.55, dotPct: 0 },
  debris:   { label: '残骸区',     speedMul: 0.85, rangeMul: 1.00, dodgeMul: 1.00, visionMul: 0.55, dotPct: 0 },
  /** 机雷：旧案"损伤 = 特殊" ⇒ 唯一实现为按 tick 的持续损伤（1.5%/3s ≈ 30%/分钟） */
  mine:     { label: '机雷区',     speedMul: 0.55, rangeMul: 1.00, dodgeMul: 1.00, visionMul: 0.75, dotPct: 0.015 },
  /** 杰夫粒子云：损伤更缓（0.8%/3s），但视野与移速也受影响，定位为"隐蔽但危险" */
  jeff:     { label: '杰夫粒子云', speedMul: 0.90, rangeMul: 1.00, dodgeMul: 1.00, visionMul: 0.90, dotPct: 0.008 },
};

/** 中性（无地形 / 未登记地形）。 */
export const NEUTRAL_TERRAIN: TerrainEffect = {
  label: '', speedMul: 1.0, rangeMul: 1.0, dodgeMul: 1.0, visionMul: 1.0, dotPct: 0,
};

/** 地形 id → 影响；null/未登记 → `NEUTRAL_TERRAIN`（不抛错）。 */
export function terrainEffect(terrain: string | null | undefined): TerrainEffect {
  // [v35 G1] 总开关：置 false 时地形只"看得见"、不产生任何数值影响（一键回退用）
  if (!TERRAIN_RULES.BATTLE_ENABLED) return NEUTRAL_TERRAIN;
  if (!terrain) return NEUTRAL_TERRAIN;
  return TERRAIN_EFFECT_TABLE[terrain] ?? NEUTRAL_TERRAIN;
}

/** 是否会造成持续损伤（供 BattleScene 的 DOT tick 提前剪枝）。 */
export function isDamagingTerrain(terrain: string | null | undefined): boolean {
  const e = terrainEffect(terrain);
  return e.dotPct > 0 && TERRAIN_RULES.DOT_ENABLED_DEFAULT;
}

/**
 * 视野修正的**实际生效值**（削弱后）。
 *
 * ⚠ 不能让原始等级乘数直接生效：`getVisionRange()` 是**索敌硬门**
 * （`d < visionRange` 才进 `visibleEnemies`，`closestEnemyFleet` 又只取非 fuzzy 者）。
 * 基线视野仅 ≈484px，而「索敌 大 = 0.55」会把视野压到 266px（≈5.3 格）
 * ⇒ 舰队在这些地形里**看不见敌人、永久丢目标**（AI 空转）。
 * 故按 `TERRAIN_RULES.VISION_STRENGTH`（0.45）削弱：
 *   0.55 → 0.80（−20%）/ 0.75 → 0.89 / 0.90 → 0.96
 * —— 保住"索敌困难、必须逼近"的体感，又不越过丢目标的悬崖。
 */
export function effectiveVisionMul(e: TerrainEffect): number {
  const s = TERRAIN_RULES.VISION_STRENGTH;
  return 1 - (1 - e.visionMul) * s;
}

/** 可被随机地形生成投放的 id 列表（顺序 = 抽签顺序，保持既有 4 种权重不变）。 */
export const SPAWNABLE_TERRAINS = ['nebula', 'asteroid', 'gravity', 'debris', 'mine', 'jeff'] as const;

/**
 * 地形 → 呈现（颜色 + 图标）。**单一真源**：
 *   · 2D 标记 —— `BattleScene.renderTerrainMarkers`
 *   · 3D 分区层 —— `Battle3DOverlay.buildTerrainZones`
 *   · 战场图例 —— `App.vue` 的地形图例
 * 三处都读这里，避免"同一地形三种颜色"（本项目已多次因重复真源翻车）。
 *
 * 取色原则：3D 层用 `AdditiveBlending` 叠在黑色宇宙上 ⇒ 颜色需偏亮才读得出来，
 * 因此 `asteroid` / `debris` 比"贴近真实陨石灰"更亮一档，而非按物理直觉取色。
 */
export const TERRAIN_VISUAL: Record<string, { color: number; glyph: string }> = {
  // ── 环境类（只是改数值，不伤人）→ **低饱和冷色**，读作"环境底色" ──
  nebula: { color: 0x7c6bd6, glyph: '☁' },
  asteroid: { color: 0x8b8f9a, glyph: '◍' },
  gravity: { color: 0xb0862f, glyph: '◎' },
  debris: { color: 0x6b7a8f, glyph: '✕' },
  // ── 危险类（持续掉血）→ **高饱和告警色**，形成"一眼看出哪里会掉血"的信息层级 ──
  mine: { color: 0xef4444, glyph: '✳' },
  jeff: { color: 0x14b8a6, glyph: '⋮' },
};

/** 地形 id → `#rrggbb`（图例 / DOM 层用；Three.js 侧直接用数值）。 */
export function terrainColorHex(terrain: string): string {
  const c = TERRAIN_VISUAL[terrain]?.color ?? 0x7dd3fc;
  return '#' + (c >>> 0).toString(16).padStart(6, '0');
}

/**
 * 战场图例的**唯一数据源**：按抽签顺序列出"地形 + 效果一句话"。
 * 文案由 `TERRAIN_EFFECT_TABLE` 的乘数**推导**（不手抄），保证图例与实装数值永不脱节。
 */
export function terrainLegendRows(): { id: string; label: string; color: string; glyph: string; desc: string }[] {
  const pct = (v: number) => `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  return SPAWNABLE_TERRAINS.map((id) => {
    const e = TERRAIN_EFFECT_TABLE[id];
    const v = TERRAIN_VISUAL[id];
    const parts: string[] = [];
    if (e.speedMul !== 1) parts.push(`移速 ${pct(e.speedMul)}`);
    if (e.rangeMul !== 1) parts.push(`射程 ${pct(e.rangeMul)}`);
    if (e.dodgeMul !== 1) parts.push(`闪避 ${pct(e.dodgeMul)}`);
    // 索敌展示**削弱后的生效值**（`effectiveVisionMul`）——原始等级乘数并不直接生效
    const vis = effectiveVisionMul(e);
    if (Math.abs(vis - 1) > 1e-6) parts.push(`索敌 ${pct(vis)}`);
    if (e.dotPct > 0) parts.push(`持续损伤 ${(e.dotPct * 100).toFixed(1)}%/3s`);
    return { id, label: e.label, color: terrainColorHex(id), glyph: v?.glyph ?? '·', desc: parts.join(' · ') };
  });
}
