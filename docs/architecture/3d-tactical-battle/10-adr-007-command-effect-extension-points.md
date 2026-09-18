# ADR-007 · 指挥点效果层扩展点设计与「层 2」边界

- **状态**：提议（待 team-lead 批准）
- **日期**：2026-08-30
- **决策者**：engineering-lead
- **触发**：Q8 定案 —— 层 2（命令效果实现）独立立项，本次 3D 化**只做层 1（目标选择交互呈现层）**，架构必须预留效果层扩展点
- **关联**：`01-architecture.md` §3、`05-adr-004`、`08-roadmap`、`09-risk-register.md` R-19

---

## 1. 上下文：11 个命令的真实状态（逐条核实）

`commandAbilities.ts` 定义了 6 通用 + 5 提督专属 = **11 个命令**。我逐条追到 `CommandPointSystem.ts` 的实现与 `BattleScene.ts` 的调用点，结论如下。

| # | 命令 | `effect.type` | 伤害部分 | 描述里的其余部分 | 判定 |
|---|---|---|---|---|---|
| 1 | `focus_fire` 集中火力 | `damage_boost` 0.3 | ✅ 生效（CP:121-123） | — | **有效** |
| 2 | `ecm_jam` 电子干扰 | `debuff` 0.25 | ✅ 降敌输出（CP:129-131） | ❌ 视野减半 | **部分有效** |
| 3 | `reinhard_roar` 黄金狮子的咆哮 | `damage_boost` 0.5 | ✅ 生效 | ❌ 移速+30%（CP:144-147 的硬编码特例是死的，因为 `getSpeedMultiplier` 零调用） | **部分有效** |
| 4 | `emergency_repair` 紧急抢修 | `shield` 0.5 | ❌ 不可达（`isDefending` 恒 false） | ❌ 旗舰回血 20%（无实现） | **无效** |
| 5 | `evasive_maneuver` 紧急回避 | `shield` 1.0 | ❌ 不可达 | — | **无效** |
| 6 | `kirscheis_guardian` 红发的守护 | `shield` 1.0 | ❌ 不可达 | ❌ 替莱因哈特承伤（无实现） | **无效** |
| 7 | `bucock_bastion` 老将的坚壁 | `shield` 0.5 | ❌ 不可达 | ❌ 速度归零 / 伤害+20%（无实现） | **无效** |
| 8 | `morale_rally` 士气鼓舞 | `morale` 30 | ❌ `getMoraleModifier` 零调用 | — | **无效** |
| 9 | `formation_charge` 阵型突击 | `speed_boost` 1.0 | ❌ `getSpeedMultiplier` 零调用 | ❌ 冲锋到目标身后（无实现） | **无效** |
| 10 | `yang_magic_counter` 魔术师的反击 | `reflect` 0.5 | ❌ CP:134 只有一行注释 | ❌ 5 秒无敌 / 士气+50（无实现） | **无效** |
| 11 | `reuenthal_blitz` 双璧的猛袭 | `teleport` 3.0, `durationMs: 0` | ❌ 无 handler | ❌ 传送 / 下一击×3（无实现） | **无效** |

> **口径（R3 定稿，team-lead 与 design-strategist 已校正，我接受）**：按**层 1 完成之后**的状态分类 ——
> **正常可用 2 个**（`focus_fire`、`ecm_jam`）+ **部分生效 1 个**（`reinhard_roar`）+ **完全无效 8 个**（其余）。
>
> **我原报告的两处偏差，校正成立**：
> 1. **`ecm_jam` 我错归为"部分有效"**。它的 `debuff` 分支条件是 `e.targetFleetId === fleetId && !isDefending`（CP:129-131），唯一调用点传 `isDefending=false`，敌方舰队攻击时 `fleetId === e.targetFleetId` ⇒ **分支可达**。它此前无效的唯一原因是 `targetFleetId` 恒为 `null`（`pendingCallback` 从未收到非空值），而**层 1 修的正是这个** ⇒ 层 1 完成后即生效，**不应置灰**。
> 2. **`reinhard_roar` 的移速那一路"不是函数没接上，是配置里压根没有"**。`commandAbilities.ts:118` 只有 `effect: { type: 'damage_boost', value: 0.5, durationMs: 20000 }` 一条，描述里的"移速+30%"没有任何配置承载。而 `getSpeedMultiplier` 里的 `reinhard_roar` 硬编码特例（CP:145-147）是死的 ⇒ 伤害 +50% 真实生效，移速没有 ⇒ **保持可用 + 诚实标注"部分生效"**（整条置灰会剥夺一个 3CP 换 20 秒全军 +50% 输出的高性价比命令）。
>
> **残留一项待确认（不阻塞）**：`ecm_jam` 描述里的"**视野减半**"仍**未实现** —— 战术层 `getVisionRange`（BattleScene:1484）不含任何 CP 效果项。按与 `reinhard_roar` 相同的标准，它严格来说也属"描述超出实现"。**建议层 2 修正 `ecm_jam` 的描述文案**（或补视野效果），而不是现在改状态（避免再次动摇 8/11 的口径）。记录为层 2 待办。

**两个容易被忽略的实现缺陷**（层 2 立项时必须知道）：

1. **`reuenthal_blitz` 的 `durationMs: 0` 会导致效果"入库即过期"**。`updateCPState`（CP:99-105）每 tick 执行 `e.remainingMs -= dtMs; if (e.remainingMs <= 0) splice(i,1)`。以 `durationMs = 0` 入库的效果在**同一 tick 内**就被剪掉 ⇒ 即使层 2 写了 teleport handler，用这个配置也拿不到效果。**层 2 必须把它改成 `durationMs > 0` 或为瞬时效果走单独通道。**
2. **`teleport` 在战术层里没有对应概念**。舰队位置由 `fleet.x += rawVX` 的积分驱动（BattleScene:2689-2690），没有任何"位置突变"的钩子。⇒ teleport 不是"补一个乘数"，而是**新增一类规则**。

---

## 2. 回答 1：效果接入点在哪（时机 / 调用者）

### 2.1 铁律

> **效果查询只能在 `TacticalSim`（规则层）内部调用，渲染层永远不得调用 `CommandPointSystem` 的任何函数。**

这是 ADR-001 单向数据流的直接推论：渲染层调用规则函数 = 规则计算结果依赖渲染时机 = 帧率会影响战斗结果。

### 2.2 三类效果，三种接入点（关键结论）

层 2 的 7 种效果类型不是同质的，它们的接入点**成本差异极大**：

| 类 | 效果类型 | 接入点 | 现状是否存在 | 性质 |
|---|---|---|---|---|
| **A 乘数型** | `damage_boost` / `debuff` / `shield` / `reflect` | 在现有公式里**乘一个系数** | ✅ 公式存在，只是部分缺调用 | 纯乘法，**不改公式结构** |
| **B 状态型** | `heal` / `morale` | 需要**新增状态维度** | ❌ 战术层无 HP 恢复、无士气 | **规则新增** |
| **C 突变型** | `teleport` | 需要**位置突变钩子** | ❌ 位置由积分独占驱动 | **规则新增** |

⇒ **层 2 立项时应把这三类分开估**：A 类是低成本（补调用 + 拆函数），B/C 类是高成本（要动规则与数值，需要重新走平衡验证）。这是我在架构侧能给层 2 的最有价值的提醒。

### 2.3 A 类的具体接入点（层 2 可直接照抄）

| 函数 | 调用时机 | 现状对应位置 | Phase 1 迁移后的位置 | 层 2 要做什么 |
|---|---|---|---|---|
| `updateCPState(state, dtMs)` | `tick()` 最开头（CP 恢复 + 冷却递减 + 效果剪枝） | BattleScene:1555 `applyCommandEffects` | `TacticalSim.tick()` 第 1 步 | 已接入 ✅ 无需改动 |
| `getDamageMultiplier(cp, fleetId, isDefending)` | 伤害公式内，**攻击方**视角 | BattleScene:2845 | `ai/combat.ts` 伤害公式 | **已接入**；但应拆分，见 §4 |
| `getSpeedMultiplier(cp, fleetId)` | 计算 `fleetBaseSpeed` 处 | BattleScene:2668 附近 `const fleetBaseSpeed = ((0.30 + mobility*0.003) * fleetSupplyFactor) * retreatSpeedBonus;` | `TacticalSim.tick()` 的位移段 | **层 2 新增调用**：`* getSpeedMultiplier(cp, fleet.id)` |
| `getActiveEffects(cp, fleetId)` | 被上面各函数内部调用 | 零调用 | 查询工具 | 内部工具，非规则；渲染层不直接调 |

**调用频率与成本**：均为 `O(|effects|)`，`|effects| ≤ 16` ⇒ 每舰队每次 < 16 次比较。8 舰队 × 60fps ⇒ 可忽略。

### 2.4 B / C 类接入点（本次只登记，不实现）

| 效果 | 需要的接入点 | 为什么现在是空的 |
|---|---|---|
| `heal` | 命令执行时的**立即 HP 修改**（非持续效果） | `ActiveEffect` 模型只有"持续时间内的乘数"，没有"瞬时结算"通道 ⇒ 需要新增一个 `onExecute` 钩子 |
| `morale` | 伤害或速度公式里**新增一项** | 战术层伤害公式（BattleScene:2823-2853）的因子是 `atk / def / supply / 提督属性 / 地形 / 背刺 / CP / 逆境 / 决战`，**没有士气项**；`fleet.morale` 是**战略层**字段，从不进战术层 ⇒ `getMoraleModifier` 不是"忘了调用"，是"没有可乘的地方" |
| `teleport` | 命令执行时**直接改写 `fleet.x/y`** | 位置由 `fleet.x += rawVX` 积分独占，无突变钩子 |

---

## 3. 回答 2：渲染层如何响应新效果（层 2 不改渲染层）

### 3.1 `ActiveEffect` 的数据结构会变吗

**会变，但渲染层看到的契约不变。**

`ActiveEffect`（规则层内部）在层 2 大概率要加字段（heal 需要记录实际回复量、teleport 需要 origin/dest）。但渲染层**不直接读 `ActiveEffect`**，它读的是一个**稳定的只读视图**：

```ts
// frontend/src/game/tactical/BattleView.ts
export interface EffectViewEntry {
  readonly commandId: string;      // 'focus_fire' | 'reuenthal_blitz' | ...
  readonly effectType: string;     // 'damage_boost' | 'shield' | ... | 层2 新增类型
  readonly casterFleetId: number;
  readonly targetFleetId: number;  // -1 = 无目标（自身/全局）
  readonly remainingMs: number;
  readonly durationMs: number;     // 0 = 瞬时（渲染层据此决定是否画进度环）
  readonly value: number;          // 强度，渲染层**只**用于选图标档位，绝不做规则判定
}

// BattleView 新增一个字段：
readonly effects: readonly EffectViewEntry[];   // ≤ 16，AoS（数量小，可读性优先）
```

**契约稳定性保证**：`EffectViewEntry` 只加字段、不改语义，`effectType` 是 **string 而非联合类型** ⇒ 层 2 新增效果类型时，**TypeScript 不会要求渲染层改动**。

### 3.2 渲染层的三层响应机制

| 层 | 机制 | 是否与效果类型耦合 |
|---|---|---|
| **① 一次性表现** | 收 `CP_EFFECT` 事件 → 在施法舰队位置播一次**通用闪光**（就是现状 `showCommandEffect` 的那圈光环） | ❌ **完全不耦合**，不 `switch(effectType)` |
| **② 持续态表现** | 每帧读 `view.effects`，在 caster / target 舰队上方画**效果图标槽位**：<br>• 最多 4 个图标，超出折叠为 `+N`<br>• 图标 UV 来自**一张效果图标图集**，按 `effectType` 查表<br>• 进度环 = `remainingMs / durationMs`（`durationMs === 0` 时不画环） | ⚠️ 只通过**数据表**耦合（见下） |
| **③ 特殊表现（可选扩展点）** | 见 §3.3 | ❌ 通过**注册表**解耦 |

**② 的查表（渲染层里唯一知道类型名的地方）**：

```ts
// frontend/src/game/three/tactical/effectIcons.ts
export const EFFECT_ICON_UV: Record<string, [number, number]> = {
  damage_boost: [0, 0],
  debuff:       [1, 0],
  shield:       [2, 0],
  speed_boost:  [3, 0],
  morale:       [4, 0],
  // ↓ 层 2 新增效果时，只需要在这个表里加一行
  // heal:     [5, 0],
  // teleport: [6, 0],
  // reflect:  [7, 0],
};
const FALLBACK_UV: [number, number] = [15, 0];   // 未知类型 → "?" 图标，不报错、不崩
```

⇒ **未知效果类型不会崩，只会显示 "?"**。这样即使层 2 加了效果但忘了同步图标表，也只是缺一张图，不会白屏。

### 3.3 扩展点：效果视觉处理器注册表

层 2 若要做"效果期间舰体持续发光""teleport 时画一道折跃光带"这类**非常规表现**，不该去改 `ThreeTacticalBattle.ts`。提供注册表：

```ts
// frontend/src/game/three/tactical/effectVisuals.ts
export interface EffectVisualHandler {
  /** 效果出现的第一帧 */
  onStart(e: EffectViewEntry): void;
  /** 效果存续期间每帧；dtMs 已按速度档缩放 */
  onTick(e: EffectViewEntry, dtMs: number): void;
  /** 效果结束（自然到期 / 被打断） */
  onEnd(e: EffectViewEntry): void;
}

/**
 * 注册某个效果类型的特殊视觉表现。
 * 未注册的类型 → 只走 ② 的通用图标 + 进度环。
 */
export function registerEffectVisual(effectType: string, h: EffectVisualHandler): void;
```

- 渲染核心每帧维护 `prevEffects` 与 `view.effects` 的差集，自动触发 `onStart` / `onEnd`。差集键用 `commandId + casterFleetId + targetFleetId`（足以区分同类效果的多次施放）。
- **默认不注册任何 handler** ⇒ 本次 3D 化交付时，所有效果只有通用图标，没有特殊表现。这正是"本次不做效果"的正确落地方式。

### 3.4 Open-Closed 自检表

层 2 新增一个效果（以 `teleport` 为例）时，各文件的改动量：

| 文件 | 改动 | 行数 |
|---|---|---|
| `commandAbilities.ts` | 修 `durationMs: 0` | 1 |
| `CommandPointSystem.ts` / 新增 handler | teleport 规则实现 | 层 2 范围 |
| `TacticalSim.ts` | B/C 类接入点 | 层 2 范围 |
| **`BattleView.ts`** | **零改动**（`effectType: string` 已容纳新类型） | 0 |
| **`ThreeTacticalBattle.ts`** | **零改动** | 0 |
| **`fxPool.ts` / `shipMesh.ts`** | **零改动** | 0 |
| `effectIcons.ts` | 加一行 UV | 1（可选，缺失时显示 "?"） |
| `effectVisuals.ts` | 加一个 `registerEffectVisual`（仅当要特殊表现） | 层 2 范围，可选 |

⇒ **渲染核心零改动** ✅

---

## 4. 回答 3：`isDefending` 该怎么修（**本次不实现**）

### 4.1 根因

`getDamageMultiplier(state, fleetId, isDefending)` 把**两个方向相反的乘数**塞进了一个函数：

```ts
// CommandPointSystem.ts:117-135
export function getDamageMultiplier(state: CPState, fleetId: number, isDefending: boolean): number {
  let mult = 1.0;
  for (const e of state.effects) {
    if (e.casterFleetId === fleetId && !isDefending) {
      if (e.effect.type === 'damage_boost') mult *= (1 + e.effect.value);   // 攻击方加成
    }
    if ((e.targetFleetId === fleetId || e.casterFleetId === fleetId) && isDefending) {
      if (e.effect.type === 'shield') mult *= (1 - e.effect.value);          // 防守方减伤 ⇒ 不可达
    }
    if (e.targetFleetId === fleetId && !isDefending) {
      if (e.effect.type === 'debuff') mult *= (1 - e.effect.value);          // 敌 debuff 降我输出
    }
    // reflect → 只有注释
  }
  return Math.max(0.1, mult);
}
```

唯一调用点是 **BattleScene:2845 `getDamageMultiplier(this.cpState, fleet.id, false)`**，位于**攻击方**的伤害公式里 ⇒ `isDefending` 恒为 `false` ⇒ shield 分支（`emergency_repair` / `evasive_maneuver` / `kirsche_guardian` / `bucock_bastion` 四个命令）**全部不可达**。

**更深一层的问题**：不只是"参数传错了"，而是**伤害结算路径上根本没有防守方视角的调用点**。现状是攻击方算完 `finalDmg` 直接 `targetShip.hp -= finalDmg`，全程没有问过"目标有没有盾"。

### 4.2 建议（层 2 实施，本次不做）

**拆成两个语义显式的函数，并补上缺失的防守方调用点：**

```ts
/** 攻击方视角：自身 damage_boost、自身受到的 debuff */
export function getOutgoingDamageMultiplier(state: CPState, attackerFleetId: number): number;

/** 防守方视角：shield 减伤、reflect 反弹 */
export function getIncomingDamageMultiplier(state: CPState, defenderFleetId: number): number;

// 保留旧签名做 deprecated 转发，避免任何遗漏的调用点静默失效
/** @deprecated 用上面两个显式函数 */
export function getDamageMultiplier(state: CPState, fleetId: number, isDefending: boolean): number {
  return isDefending ? getIncomingDamageMultiplier(state, fleetId)
                     : getOutgoingDamageMultiplier(state, fleetId);
}
```

然后在伤害应用前补一行（**这才是真正的行为变更，必须留在层 2**）：

```ts
// 层 2 才做（本次不做）：
const incoming = getIncomingDamageMultiplier(cpState, fleetIdOf(targetShip));
finalDmg *= incoming;
```

### 4.3 为什么本次连"拆分"都不做

拆分本身是**行为中性**的（旧函数保留为转发），但：

1. **它改的是规则域代码。** 我的规则是：规则域的每一处改动都必须有 golden replay 佐证。为一个"将来才用"的扩展点增加一次规则层改动，收益不抵风险。
2. **`BattleScene.ts` 在 Phase 5 就会被整个删除。** 现在给它做手术是给一个即将消失的文件增加改动面。
3. **team-lead 明确要求本次不实现。**

⇒ **Phase 1 迁移时逐字保留 `getDamageMultiplier(this.cpState, fleet.id, false)`**，把 `isDefending` 的问题作为**层 2 的设计债**记录在本 ADR §4，并在 `CommandPointSystem.ts` 的改动清单里作为层 2 的第一项。

> **注**：本 ADR 本身**不修改任何源码**（遵守"只写文档"约束）。层 2 立项时按 §4.2 实施即可。

---

## 5. 回答 4：本次 3D 化的明确边界

### 5.1 本次**做**（层 1 · 目标选择交互呈现）

| # | 项目 | 行数 |
|---|---|---|
| 1 | 分层拾取（膨胀代理体 + 屏幕圆域兜底 + 编队标记可点 + 忽略遮挡 + 返回 `fleetId`） | 200（已计入 P3-6） |
| 2 | **目标选择状态机**：`setTargetingMode` 进入/退出、点空不取消、目标失效撤销 | 80 |
| 3 | **命中测试与高亮**：合法目标脉动轮廓、非法目标降饱和 60%、编号徽章 ①②③ | 120 |
| 4 | **`1`–`9` 数字键快选**（暂停态接管，因阵型键在暂停时已禁用） | 40 |
| 5 | **二次确认条**（`cpCost ≥ 3 \|\| cooldownMs ≥ 240000`） | 60 |
| 6 | **`EffectView` 快照字段** + 渲染层的通用图标槽位 + 进度环 + `registerEffectVisual` 扩展点 | 100 |
| 7 | **命令可用性四态**：`ABILITY_IMPL_STATUS` 静态表 + 宿主 `computeAbilityState()` + `commandBridge` 新增 3 字段 + **CommandPanel.vue 四态改造 ~85 行** + `commandCopy.ts` 文案表 + `settingsStore` 新增 `hideUnimplementedCommands`（默认 `false`） | **130**（原估 30，因四态 + 两种反馈通道 + 可访问性而膨胀） |
| | **合计（P4-9 修订后）** | **~330 行新增**（扣除已计入 P3-6 的 200 行拾取 + 与 P4-5 重叠部分） |

**P4-9 子项明细（Q8 + 四态校正后重估）**：

| 子项 | 行数 | 说明 |
|---|---|---|
| P4-9a 拾取与命中测试 | 200 | **已计入 P3-6**，不重复计算 |
| P4-9b 目标选择交互层 | 240 | 状态机 80 + 高亮与徽章 120 + `1`–`9` 快选 40 |
| P4-9c 二次确认条 | 60 | `cpCost ≥ 3 \|\| cooldownMs ≥ 240000` |
| P4-9d 效果扩展点 | 100 | `EffectView` + 通用图标槽位 + 进度环 + `registerEffectVisual` |
| **P4-9e 命令可用性四态** | **130** | 静态表 + 宿主计算 + `commandBridge` 3 字段 + **CommandPanel 85 行** + 文案表 + 设置项 |
| **P4-9 合计（扣除 P3-6 的 200）** | **530** | R2 估 430 → R3 估 **530**（增量全部来自四态） |

### 5.2 本次**不做**（层 2 范围，逐条写清避免误判为遗漏）

| # | 不做的事 | 归属 |
|---|---|---|
| 1 | 任何命令效果的**规则实现**（伤害/速度/士气/护盾/反射/治疗/传送） | 层 2 |
| 2 | 调用 `getSpeedMultiplier` / `getMoraleModifier` / `getActiveEffects` | 层 2 |
| 3 | `reflect` / `teleport` / `heal` 的 handler | 层 2 |
| 4 | `isDefending` 拆分与防守方调用点（§4） | 层 2 第 1 项 |
| 5 | `reuenthal_blitz` 的 `durationMs: 0` 修正 | 层 2 |
| 6 | 任何**特殊**效果视觉（`registerEffectVisual` 的具体 handler） | 层 2（可选） |
| 7 | 效果图标图集里 `heal` / `teleport` / `reflect` 的图标 | 层 2（缺失时显示 "?"） |
| 8 | 新效果的数值平衡验证 | 层 2 |
| 9 | 为士气/治疗**新增战术层状态维度** | 层 2（属规则新增，需单独评估） |
| 10 | **`ecm_jam` 的"视野减半"效果** | 层 2（描述超出实现，见 §1 的"残留一项待确认"；建议修正描述文案而非改状态） |
| 11 | **`reinhard_roar` 的"移速+30%"补齐**（需先给配置加一条 `speed_boost`，再接上 `getSpeedMultiplier`） | 层 2 |

### 5.3 边界的守护机制

- **代码位置即边界**：层 1 的所有代码在 `frontend/src/components/battle/` 与 `frontend/src/game/three/tactical/`；层 2 的代码在 `frontend/src/game/tactical/`（规则层）与 `frontend/src/services/CommandPointSystem.ts`。**评审时若发现本次 3D 化的 PR 碰到后者，即越界。**
- **扩展点守护**：`effectIcons.ts` 的 `FALLBACK_UV` 保证未知效果类型不崩；`EffectViewEntry.effectType` 是 `string` 保证层 2 加类型时不触发类型错误。
- **验收守护**：见 §6 的 V-E1 / V-E2。

---

## 6. 验证方式

| 编号 | 验证 | 命令 / 判据 |
|---|---|---|
| **V-E1** | **扩展点有效性（不改渲染层）** | 人为往 `commandAbilities.ts` 加一个假效果 `type: 'dummy_effect'`（**测试后删除**），执行它 → 渲染层必须：① 不报错 ② 出现通用施法闪光 ③ 舰队上方出现 **"?" 图标** ④ 战斗不中断。**且 `git diff --stat` 不得出现 `ThreeTacticalBattle.ts` / `fxPool.ts` / `shipMesh.ts`** |
| **V-E2** | **渲染层零规则依赖** | `npx esbuild frontend/src/game/three/ThreeTacticalBattle.ts --bundle --platform=node --format=esm --outfile=.tmp/l3.mjs --log-level=warning` → 产物中 `grep -c "CommandPointSystem\|getDamageMultiplier\|getSpeedMultiplier"` = **0** |
| **V-E3** | **禁用态不可消耗 CP** | 对 8 个（或 10 个，取决于口径）未实现命令逐个尝试：① 面板中置灰 ② 点击无响应 ③ `commandBridge.cpState.currentCP` **不变** ④ 不进入目标选择态 |
| **V-E4** | **有效命令仍可用** | `focus_fire`：执行 → CP 扣 2、冷却启动、目标舰队伤害提升（用 golden replay 的伤害观测验证倍率 = 1.3） |
| **V-E5** | **`EffectView` 契约稳定** | 快照字段 `effects` 存在且 ≤ 16；层 2 加字段时 `EffectViewEntry` 只增不减（评审检查） |
| **V-E6** | **golden replay 不受影响** | 本次改动后 3 个 case 全部 PASS（若 golden case 不覆盖 CP，则本条为 N/A，需在层 2 立项时补一个 CP 用例） |

> ⚠️ **V-E6 的已知缺口**：我现有的 3 个 golden case（`skirmish-normal` / `campaign-iserlohn` / `skirmish-sim`）**不执行任何 CP 命令** ⇒ CP 相关改动目前**没有 golden 覆盖**。层 2 立项时应补一个 `skirmish-cp` 用例（固定 seed + 固定 tick 执行 `focus_fire`）。本次不动。

---

## 7. 未决事项

| # | 问题 | 默认建议 | 需谁拍板 |
|---|------|----------|----------|
| ~~E-Q1~~ | ~~置灰命令口径：8 个还是 10 个~~ | **已解决（R3）**：**8 个置灰** + `ecm_jam` 不置灰 + `reinhard_roar` 部分生效。校正依据见 §1 | — |
| **E-Q2** | **`CommandPanel.vue` 需要 ~85 行改动**（四态分流 + 角标 + 汇总行 + 提示条 + CSS + 可访问性）—— 这**第二次**打破了我 ADR-004 里"零改动"的承诺（R2 时报的是 ~10 行） | **批准**。这是 Q8 + 四态校正带来的范围变更，我主动报备 | **team-lead** |
| **E-Q6** | `settingsStore` 新增 `hideUnimplementedCommands`（默认 `false`）—— 设计侧 §6 配套的"隐藏未实现命令"设置项需要一个落点 | **建议加**，1 个布尔字段 | team-lead |
| **E-Q2** | `CommandPanel.vue` 是否需要最小改动以显示"效果尚未实现"的原因文字 | **需要**（~10 行）。这**打破了我 ADR-004 里"CommandPanel 零改动"的承诺**，属本次范围变更，需确认 | **team-lead** |
| **E-Q3** | 是否在 `TacticalSim.command.executeCommandAbility` 里加 1 行"未实现命令拒绝执行"的安全网 | **建议加**。UI 置灰只是第一道防线，`TacticalSim` 是唯一能保证的地方。它会让 8–10 个命令不可执行 ⇒ **是行为变更（但正是用户决定想要的）** | **用户** |
| **E-Q4** | 层 2 是否接受"A/B/C 三类成本差异极大"这个结论，并据此拆分立项 | 建议层 2 先做 A 类（乘数型，低成本），B/C 类单独评估 | 层 2 负责人 |
| **E-Q5** | golden replay 是否补一个 CP 用例 | 建议补（`skirmish-cp`），否则层 2 无回归网 | team-lead |