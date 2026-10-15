# 33-P1 · 统一舰队生成入口（实施定稿）

> 本文件是 P1 的**实施基准**。按用户要求采用**对抗式分工**：
> **实现者（A）写代码 → 反对方（B）证伪"零行为变化" → 审核方（C）独立验证 → 总审（lead）裁决**。

---

## 0. ★ 前提修正（重要，P1 因此大幅简化）

**底层数值引擎已经是共享的**：
- `config/shipScaling.ts:517` `buildTacticalUnits(totals, visualCount, mods, troopOf, coordSource?)`
  注释自述「**★ 唯一折算入口：编制 + 实体预算 + 倍率 → 逐实体数值清单**」
- 两轨都调用它（演习 `BattleScene.ts:1507`；战役经 `gameStore.ts:3556` `scaledSlotsForComposition` + `applyStatsToSlots`）
- `TacticalUnitSeed`（`shipScaling.ts:410-424`）**已产出中文 `classType` 与 `def/range/interval`**

**⇒ 所以"两套平行"不是引擎分叉，而是「5 个输入参数的计算」分叉：**

| 输入 | 演习轨 | 战役轨 | 备注 |
|---|---|---|---|
| `totals` 编制 | `fac.composition`（`simFullDeck` 硬编码八艘） | 大地图 `fleet.composition` | |
| `visualCount` | `fac.entityBudget` | `visualCount`（军衔） | |
| **`mods`** | **≡1**（`BattleScene.ts:1505`） | 提督属性 × 补给 × 士气 × 科技（`gameStore.ts:3572-3601`） | P3 目标：统一 |
| **`classType`** | 用 `seed.classType`（**中文**） | 用 `slot.type`（**英文**）⇒ 方向装甲/拦截/距离带**失效** | P3 目标：统一 |
| **`def`/`atkInterval`** | 用 `seed.def` / `seed.interval` | **硬编码 `def:10` / `2000`** | P3 目标：统一 |

**⇒ 引擎不动；P1 只统一"参数构造"。**

---

## 1. P1 目标（严格限定）

**建立唯一入口 `buildFleetUnits`，两轨都调它；★ 行为必须与改前逐字段一致。**
（数值口径的统一留到 P3 —— 这样 P1 可被**严格验证**，为后续立一个不会跑偏的地基。）

---

## 2. 交付物

### 2.1 新增 `frontend/src/game/fleetGeneration.ts`（纯函数，零 import 副作用）

```ts
import type { ShipStatMods, TacticalUnitSeed, ShipType } from '../config/shipScaling';

/** 单支舰队的生成输入（两轨共用；差异用 mode 显式化） */
export interface FleetGenInput {
  /** 编制（兵力数，按舰种） */
  composition: Partial<Record<ShipType, number>>;
  /** 实体预算（军衔 → 编制位） */
  visualCount: number;
  /** 提督属性（演习轨当前不消费；保留字段以便 P3 统一） */
  admiralStats?: { attack: number; defense: number } | null;
  /** 战役轨专属修正（补给/士气/科技）；演习轨传 undefined */
  campaignMods?: Partial<ShipStatMods> | null;
  /** ★ 轨道标识（P1 用它保持两轨现有行为；P3 将移除该分叉） */
  mode: 'campaign' | 'sim';
}

export interface FleetGenResult {
  seeds: TacticalUnitSeed[];
  mods: ShipStatMods;
  /** 可观测诊断（供台架断言与真机核对） */
  diag: {
    mode: 'campaign' | 'sim';
    totals: number;        // Σ 编制兵力
    visualCount: number;
    entityCount: number;   // seeds.length
    sumHp: number;         // Σ maxHp
    sumAtk: number;        // Σ atk
    mods: ShipStatMods;
  };
}

export function buildFleetUnits(input: FleetGenInput): FleetGenResult;
```

**行为约定（P1 必须保持）**：
- `mode === 'sim'` ⇒ `mods = { hpMul:1, atkMul:1, defMul:1, engineMul:1 }`（与 `:1505` 一致）
- `mode === 'campaign'` ⇒ `mods` 取 `input.campaignMods`（**由调用方按现有公式算好传入**）
  ⇒ **P1 不搬运公式**，只搬运**结果**（最小改动面、零行为变化）
- 返回的 `seeds` 必须与改前 `buildTacticalUnits(...)` 的返回值**逐字段相同**

### 2.2 改造两轨调用点

| 文件 | 位置 | 改动 |
|---|---|---|
| `game/scenes/BattleScene.ts` | `spawnUnitsForFaction`（`:1507` 的 `buildTacticalUnits` 调用） | 改为调 `buildFleetUnits({ mode:'sim', ... })`，用返回的 `seeds` |
| `store/gameStore.ts` | `serializeTacticalFleet`（`:3556-3601`） | 改为调 `buildFleetUnits({ mode:'campaign', campaignMods: mods, ... })` |

**⚠ 硬性约束**：
- **不得改变任何数值**（本次唯一目标）
- **不得改变 `classType` 值**（演习仍是中文、战役仍是英文 —— P3 才统一）
- **不得改动 `shipScaling.ts` 的任何逻辑**

### 2.3 新增台架 `scripts/fleetGenerationSim.cjs`

**必须包含以下断言**（用 `_ts_resolve` 直接 require 真源码，禁手抄常量）：

1. **守恒律**：同 `composition` + 同 `visualCount` ⇒ `ΣmaxHp` / `Σatk` 在两 `mode` 下**相等**
2. **实体数**：`entityCount === visualCount`（或在编制不足时按现有规则）
3. **mods 语义**：`mode='sim'` ⇒ mods 全 1；`mode='campaign'` ⇒ mods = 传入值
4. **零行为变化回放**：构造 3 组代表性编制（纯战列 / 混编 / 含补给），
   把 `buildFleetUnits` 的输出 `seeds` 与**旧路径**（直接调 `buildTacticalUnits`）**逐字段对比**，
   断言完全相等

---

## 3. 验收标准（三方各自的口径）

| 角色 | 验收动作 |
|---|---|
| **实现者 A** | 交付 `fleetGeneration.ts` + 两处调用改造 + 台架；`tsc` 0 错、全量台架 30/30+ 绿 |
| **反对方 B** | **必须尝试证伪"零行为变化"**：找任意输入使新旧输出不同（给出反例与行号）；若找不到，明确说"未能证伪" |
| **审核方 C** | **独立复现**：不看 A 的解释，自己跑台架 + 自己构造输入对比 + 核对 `git diff` 是否只动了预期位置 |
| **总审（lead）** | 交叉 B/C 结论；若有分歧则裁决；确认为"零行为变化"后才进入 P2 |

---

## 4. 明确不在 P1 范围（防蔓延）

- 不动 `classType` 语言（P3）
- 不动 `def` / `atkInterval` 硬编码（P3）
- 不动演习的 `mods≡1`（P3）
- 不动 `simFullDeck`（P2 提督配置）
- 不动棋盘格 / 部署阶段（P4）
- 不动战后结算（P5）
- 不修 `deployAdj` / 不做 AI 托管（P6）
