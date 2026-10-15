/**
 * fleetGeneration.ts — P1 统一舰队生成入口。
 *
 * 背景（见 docs/design/3d-tactical-battle/33-p1-spec.md）：
 *   战术层两条部署路径（演习 BattleScene.spawnUnitsForFaction / 战役 gameStore.serializeTacticalFleet）
 *   历史上**各自计算**折算引擎的输入参数（totals / visualCount / mods / troopOf / coordSource），
 *   而底层引擎 config/shipScaling.buildTacticalUnits 其实已经是共用的唯一折算入口。
 *
 *   P1 只统一**参数构造的入口**：两轨都经 `buildFleetUnits` 调 `buildTacticalUnits`，
 *   **不改任何数值口径**（mods 语义 / classType 语言 / def·interval 硬编码全部按各轨现状原样透传），
 *   因此可被"零行为变化回放"严格证伪 —— 这是把两条轨道收敛到同一地基的第一步（P3 才统一口径）。
 *
 * 本文件是**纯函数**：零 import 副作用；不引 Phaser / Vue / store。
 */
import {
  buildTacticalUnits, totalShipsOf,
  type ShipStatMods, type TacticalUnitSeed, type TroopLike,
} from '../config/shipScaling';
// 注：定稿 §2.1 示例写 `type ShipType` 从 shipScaling 导出，但 shipScaling 只 `import type` 未 re-export，
// 故按仓库真源从 types/game 取（与 shipScaling 内部同一符号）。
import type { ShipType } from '../types/game';

/** 单支舰队的生成输入（两轨共用；数值口径差异用 mode 显式化） */
export interface FleetGenInput {
  /** 编制（兵力数，按舰种）——已归一为 ShipType 键（调用方用 totalsOfComposition 转好） */
  composition: Partial<Record<ShipType, number>>;
  /** 实体预算（军衔 → 编制位） */
  visualCount: number;
  /** 提督属性（演习轨当前不消费；保留字段以便 P3 统一） */
  admiralStats?: { attack: number; defense: number } | null;
  /** 战役轨专属修正（补给/士气/科技）；演习轨传 undefined */
  campaignMods?: Partial<ShipStatMods> | null;
  /** ★ 轨道标识（P1 用它保持两轨现有行为；P3 将移除该分叉） */
  mode: 'campaign' | 'sim';
  /**
   * [P1 对定稿 §2.1 的唯一结构扩展] troop 真源回调。
   * 两条轨道的 troop 来源本就不同（演习 = store.troopsData 严格查找 + baseStats 合成兜底；
   * 战役 = getTroopById(`${faction}_${中文cls}_1`)）⇒ 为保证"零行为变化"必须由调用方透传，
   * 不在本纯函数里统一。P3 收敛 troop 真源时移除该项。
   */
  troopOf: (type: ShipType) => TroopLike | undefined;
  /** [P1 结构扩展] 坐标来源（只复用坐标；条数不等则重排）。演习轨不传。 */
  coordSource?: { x?: number; y?: number }[] | null;
}

export interface FleetGenResult {
  seeds: TacticalUnitSeed[];
  mods: ShipStatMods;
  /** 可观测诊断（供台架断言与真机核对） */
  diag: {
    mode: 'campaign' | 'sim';
    /** Σ 编制兵力 */
    totals: number;
    visualCount: number;
    /** seeds.length */
    entityCount: number;
    /** Σ maxHp */
    sumHp: number;
    /** Σ atk */
    sumAtk: number;
    mods: ShipStatMods;
  };
}

/** 演习轨倍率 = 全 1（与 BattleScene 历史行为一致：演习无"提督属性乘到单舰"这一层） */
const SIM_MODS: ShipStatMods = { hpMul: 1, atkMul: 1, defMul: 1, engineMul: 1 };

/** 战役轨倍率为调用方算好的 Partial；缺项按 1 兜底（与"无修正"等价） */
function modsFromPartial(partial?: Partial<ShipStatMods> | null): ShipStatMods {
  return {
    hpMul: partial?.hpMul ?? 1,
    atkMul: partial?.atkMul ?? 1,
    defMul: partial?.defMul ?? 1,
    engineMul: partial?.engineMul ?? 1,
  };
}

/**
 * ★ 两支舰队（演习/战役）的统一生成入口。
 *
 * 行为（P1 必须保持）：
 *   · mode === 'sim'      ⇒ mods = 全 1（每次返回**新的**对象，与旧 `const mods = {...}` 一致）
 *   · mode === 'campaign' ⇒ mods = input.campaignMods（**公式由调用方算好传入**，P1 不搬运公式）
 *   · 返回 seeds 与改前 `buildTacticalUnits(composition, visualCount, mods, troopOf, coordSource)`
 *     **逐字段相同**（含 classType 中/英文现状差异 —— P1 不统一）。
 */
export function buildFleetUnits(input: FleetGenInput): FleetGenResult {
  const mods: ShipStatMods =
    input.mode === 'sim' ? { ...SIM_MODS } : modsFromPartial(input.campaignMods);

  const seeds = buildTacticalUnits(
    input.composition,
    input.visualCount,
    mods,
    input.troopOf,
    input.coordSource,
  );

  let sumHp = 0;
  let sumAtk = 0;
  for (const s of seeds) {
    sumHp += s.maxHp;
    sumAtk += s.atk;
  }

  const diag = {
    mode: input.mode,
    totals: totalShipsOf(input.composition),
    visualCount: input.visualCount,
    entityCount: seeds.length,
    sumHp,
    sumAtk,
    mods,
  };

  return { seeds, mods, diag };
}
