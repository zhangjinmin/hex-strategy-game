# 25 · 战术意图驱动（v32）：为什么"修修补补"必然失败

> 起因：用户 2026-09-19 实报四条——
> ① 「分兵按钮提示单路战法，那这个按钮到底是什么作用？」
> ② 「AI 还是直线突击，迂回什么的全都没有」
> ③ 「开局就被暂停了，很诡异，为什么要暂停？我也没有要干些什么事情」
> ④ 「攻击/协助/占领中继补给，这些战术有什么差别？中继点我也没感觉它发挥作用」
>
> 用户的判断：「整个战术战斗的逻辑是不顺畅的，这种不顺畅让所有代码都基于错误的地基，永远都是错的。」
> **本文档结论：这个判断成立，而且给出了确切的代码位置。**

---

## 1. 结论摘要

| 现象 | 确切代码原因 | 本轮 |
|---|---|---|
| 分兵按钮永远"单路战法" | `selectManeuver` 用**现有舰队数**判 `minFleets`；1 支舰队时所有多路战法全不可行 ⇒ 降级 `frontal` ⇒ 永久自锁 | ✅ 已修 |
| AI 直线冲、无迂回 | `stance==='siege'` 一律"直奔敌军坐标"、非 siege 只有 `cmdStat>80` 才包抄 ⇒ **战法从未进入决策链** | ✅ 已修 |
| 后勤猎杀/固守无效 | `_maneuverRole` / `_maneuverTargetKind` **全项目零消费**（只有 `_maneuverLateral` 被当作出边符号） | ✅ 部分修 |
| 任务无差异 | `executeMissionTick` 把 5 种任务**全部降维为 `(stance, 目的地坐标)`** | ⏳ 未做 |
| 中继点没作用 | 占领**确实**扩大补给半径（1.19×）并让运输舰改挂，但**无任何 UI 反馈** | ⏳ 未做 |
| 暂停诡异 | `deployPhase = true` 与 `isPaused = true` 耦合；且部署期**没有任何不可逆决策** | ⏳ 未做（§5） |

---

## 2. 地基诊断：意图从来没有被翻译成行为

把四条现象抽掉表象，剩下同一个结构性事实：

```
L2 计划层  ──产出──▶  意图（stance / mission / maneuver / _maneuverRole / targetKind）
                              │
                              │  ❌ 这里没有翻译层
                              ▼
L4 执行层  ──只认──▶  「一个目的地坐标 + 一个姿态枚举」
                              │
                              ▼
                        同一个万能状态机
```

**因此：无论上层选什么，执行层跑的都是同一件事。**
这不是"缺六个功能"，而是**六个功能共用的那条通路根本不存在**。

### 2.1 三条硬证据（可复现）

**证据 1 · 战术字段是死数据**

```
grep '_maneuver' frontend/src  →  消费点仅 2 处：
  BattleScene.ts:4657   _maneuverLateral  → _flankSign（选左/右符号）
  TacticalCommandSystem.ts:186  _maneuverIntent  → 头顶标签文本
_maneuverRole / _maneuverTargetKind  →  零消费
```
⇒ "猎杀运输舰"这个 `targetKind: 'enemy_supply'` **没有任何代码读它** ⇒ 分出来的那一路照样去打最近的敌军舰队。
⇒ **后勤战在代码层等于没做。**

**证据 2 · 包抄只属于高统帅提督**

```ts
// BattleScene.ts（v31 及以前）
const isAggressive = cmdStat > 80;      // 只有 command > 80 才走包抄分支
...
} else if (isAggressive && !isBehind && !isFlanking) { /* 包抄 */ }
else { /* 标准接近 = 直线冲 */ }
```
⇒ 与提督标签、战法、角色**完全无关**。绝大多数舰队永远走 `else` = 直线冲。

**证据 3 · siege 姿态绕过整个决策链**

```ts
} else if (fleet.stance === 'siege') {
    fleetTargetX = closestEnemyFleet.x;   // 直奔敌军坐标
    fleetTargetY = closestEnemyFleet.y;
} else { /* 战术决策链 */ }
```
⇒ AI 主力开局就是`assault → siege` ⇒ **开局即直线冲**，与 L2 战法无关。

### 2.2 分兵自锁的完整机理（回答"这按钮到底什么作用"）

```ts
// 修复前：feasible 用 ctx.fleetCount（现有舰队数）去比 minFleets
const feasible = (m) => MANEUVERS[m].minFleets > ctx.fleetCount ? false : ...;
```
- `flank/pincer/decoy/raid/screen` 的 `minFleets` = 2 或 3
- 而**点"分兵"的前提就是"我只有一支舰队，想拆开"** ⇒ `fleetCount = 1`
- ⇒ 全部多路战法判不可行 ⇒ 兜底 `frontal`（`minFleets` 1）⇒ 提示"**单路战法，无需拆分**"

**这是一个自锁**：按钮的执行前提判死了按钮自己。台架复现（`_v32_intent_sim.cjs` §B）：

```
米达麦亚（mobile_raid）· 1 支舰队 · 8 艘
  修复前(用舰队数判) → frontal      ← 你看到的"单路战法"
  修复后(用可编路数) → pincer       ← 3 路钳形包抄
```

另有第二处 bug：`splitFleetById` 传入 `enemySupplyPresent: false` **硬编码** ⇒ `raid`（后勤猎杀）/`screen`（补给护航）在玩家侧**永远不可行**，重后勤提督点分兵也只会退化。已一并修。

---

## 3. v32 已落地（代码就位 + 台架 23/23 PASS）

### 3.1 概念修正：分离"现有舰队数"与"可编成路数"

```ts
export interface ManeuverContext {
  fleetCount: number;   // 现在有几支
  maxRoutes: number;    // 最多能组织几路  ← 新增，判 minFleets 用这个
}
export const MIN_UNITS_PER_ROUTE = 2;
export const MAX_ROUTES = 3;
export function maxRoutesFor(unitCounts) {
  return clamp(Σ floor(units / 2), 1, 3);
}
```

| 舰数 | 8 | 6 | 5 | 4 | 3 | 2 |
|---|---|---|---|---|---|---|
| `maxRoutes` | 3 | 3 | 2 | 2 | 1 | 1 |

### 3.2 战法真正驱动执行（"AI 直线冲"的那一刀）

`BattleScene` engaging 分支**分支顺序**改为：

```
① raidTarget（后勤猎杀：直奔敌方补给节点）
② defend（驻守）
③ siege && !wantsFlank（直奔敌军 —— 旧行为，仅在未被指定侧翼时保留）
④ isCautious && !wantsFlank（低统帅正面冲 —— 同样让位于战法）
⑤ … (isAggressive || wantsFlank) 包抄 …
⑥ 标准接近
```

其中 `wantsFlank = _maneuverRole ∈ {left, right}` —— **被战法指定为侧翼就必须迂回，与提督属性无关**。
新增 `findEnemySupplyTarget()`：为 `targetKind==='enemy_supply'` 的分队找最近的**敌方运输舰**，找不到则退到**敌方已占补给点**（中继/星球/司令部）。

**台架判据 D（同场景、同姿态，只改战法角色）**：

| 输入 | 机动方式 |
|---|---|
| 无战法角色 · siege | `charge_straight`（复现旧行为） |
| **战法左翼 · siege** | **`arc_flank`（弧线迂回）** |
| **后勤猎杀 · enemy_supply** | **`raid_supply`（直奔敌方补给）** |
| 低统帅(20) · 战法右翼 | **`arc_flank`（服从战法）** |
| 低统帅(20) · 无战法 | `charge_straight`（对照） |

⇒ 机动方式从**单一"直线冲"变成 3 种分化**。

### 3.3 改动面

| 文件 | 变化 |
|---|---|
| `game/taskForce.ts` | `ManeuverContext.maxRoutes`；`maxRoutesFor()`；`MIN_UNITS_PER_ROUTE` / `MAX_ROUTES`；`feasible()` 与降级链改用 `maxRoutes` |
| `game/scenes/BattleScene.ts` | 决策链接入 `_maneuverRole` / `_maneuverTargetKind`；新增 `findEnemySupplyTarget()`；两处 `selectManeuver` 调用点传 `maxRoutes`；玩家侧补给态势不再硬编码 false |
| `_v32_intent_sim.cjs` | 新增台架（23 判据，全 PASS） |

`vue-tsc --noEmit` → **EXITCODE=0**。

---

## 4. 未做（如实登记）

| # | 项 | 为什么没做 |
|---|---|---|
| 1 | **任务差异**（攻击/协助/占领/撤回） | `executeMissionTick` 只输出 `(stance, 目的地)`。要让任务有差别，需要为每种任务定义**行为规格 + 收益**（协同 = 火力共享？占领 = 补给效率？）。属下一批 |
| 2 | **诱饵（decoy）的示弱行为** | 需要"保持距离 + 不主动进入缠斗 + 后撤诱敌"三个新机动，本轮只做了 flank / raid |
| 3 | **中继点收益可见化** | 机制**存在**（占领 → 补给半径 1.19× → 运输舰改挂），缺 UI 反馈。属第三刀 |
| 4 | **部署期重构** | 见 §5，需你先定方案 |
| 5 | 真实弧线航路 | 现在是"绕向敌军侧后 ±45°"的实时目标点，**不是预计算的三幕弧线**。观感比直线好，但还不是完整的钳形包抄 |

---

## 5. 部署期（"为什么要暂停"）诊断与三个方案

**机制**（`BattleScene.ts:911-912`）：
```ts
this.deployPhase = true;
this.store.isPaused = true;     // ← 部署期 = 全局暂停
```

**部署期玩家能做的全部事情**：
1. `1-5` 切换**旗舰**初始阵型
2. `T` 切换**旗舰**开局姿态
3. 右侧「军议」给各舰队派初始任务（仅指挥制）
4. 回车开战（演习模式有倒计时；**战役模式 `cdSec < 0` ⇒ 无倒计时，不按回车就永久停住**）

**根本矛盾**：一个暂停窗口存在的理由是"**此刻有不可逆的决策**"——而部署期这四项**战中全都能改**
（阵型有 21 处 AI 覆盖点、姿态可随时切、军议可战中改派）。
⇒ 玩家感受不到"必须现在决定"的压力 ⇒ **"我也没有要干些什么事情"**。

**三个方案**：

| 方案 | 做法 | 代价 | 评价 |
|---|---|---|---|
| A 轻 | 保留暂停，但**给足信息**：显示敌方情报等级（索敌范围/编成），让"要不要先侦察"成为真决策 | 小 | 治标 |
| **B 中（推荐）** | **软部署期**：开局时间照走，前 N 秒内改阵型/姿态**免费**，之后改要付**指挥带宽/延迟**代价 | 中 | 一个改动同时解决"停着奇怪"+"决策没意义"——**代价本身让决策有意义** |
| C 重 | 删除部署期，战前计划移到战略层，进战斗即动 | 大 | 丧失开局仪式感，且要动战略层 |

**推荐 B**。若你只想先去掉"诡异感"，A 的最小可行版是：**战役模式也挂倒计时**（消除"不按回车永久停住"）。

---

## 6. 旧案战术深度包的位置（用户问"忘记放哪了"）

**答：不是 md，是 44 张策划案图片。**

- 原始素材：`C:\Users\zhangjinmin\Desktop\银英游戏思路\`（44 张 jpg，2012 年《银河英雄传说 WEB》策划案遗留稿）
- 项目内提炼版：`docs/design/银英旧案单机化梳理与融合方案.md`
  - §2.2 未吸收缺口第 5 条 = 战术深度包
  - §3.5 = 战术深度包逐项映射
  - §四 P1 = 落地路线
  - **附「图片分类索引」= 44 图的哈希前缀索引**（战术层 6 张 + 地形 3 张）

**战术层图片前缀**：武器表 `14ce36` · 舰种表 `b8389b` · 舰船改装 `871836…b17` · **阵型表 `42a982`** · 战术流程 `55e736` · 战术界面 `738b47` · 地形表 `ae51f3…f7c` · 星域地形补充 `ac6edd`

⚠ **项目内没有这些图的副本**（`docs/` 下检索不到）⇒ 只在桌面。建议归入 `docs/asset/logh-oldplan/`，否则下次还会找不到。

**与本次重构的关系**：
- 本轮的「战法（maneuver）」管的是 **怎么打**（分几路、走什么路径、打谁）
- 旧案的 11 阵型 / 6 舰种 / 4 武器 / 11 地形管的是 **打起来什么样**（射角、火力矩阵、克制环、地形即战术）
- 两者是**正交**的，不冲突：战法给出意图，阵型/舰种/武器决定执行时的形态与数值。
  ⇒ 旧案深度包是"战术多样性"的第二层，**建议在本轮 war-doctrine 稳定后再引入**（否则两套变量同时变化，无法归因）。

---

## 7. 反方审查（自我对抗）

1. **"外挂式重构"够不够彻底？** —— 24 号文档定的原则是"重构发生在 L1–L3，BattleScene 降级为执行器"。本轮**破了这个原则**：改的是 L4 决策链。理由：L2 的意图若无人消费，加多少新模块都是死数据；**翻译层必须落在消费侧**。这不算推倒重来，但说明"不动 L4"是不成立的——**正确表述是"不动 L4 的血战参数（交战距/伤害/补给），但必须在 L4 加入意图分支"**。
2. **最大失败点**：AI 主力开局 `siege` 姿态若来自 `planFactionBattle` 的 `assault` role，那么**即使战法给了 left/right，`stance` 仍是 siege**。本轮已用 `wantsFlank` 破掉这一条，但**没有验证 stance 与 `_maneuverRole` 是否会互相覆盖**（两个写入者）。真机需重点观察。
3. **20% 复杂度换 80% 效果**：本轮的两刀（`maxRoutes` 语义修正 + `wantsFlank`/`raidTarget` 接线）就是这个 20%。整个重构的其余部分（任务规格化、诱饵、弧线航路）成本远高于其观感收益，**建议按需推进而非一次做完**。
4. **已核实的隐含假设**：`splitFleet`（`BattleScene.ts:3339-3342`）**显式写入**了子编队的
   `_maneuverRole / _maneuverLateral / _maneuverIntent / _maneuverTargetKind`
   ⇒ 拆出的侧翼分队**保留战法角色**，迂回不会因拆分而失效（此条已从"待真机验证"转为**代码已核实**）。
   ⚠ 但它同时把 `mission` 置 null、且 `{...parent}` 继承 `stance` / `state` ——
   子编队需**先接敌（`state === 'engaging'`）**才走战法分支。若母队是 `exploring`，
   子编队会先按探索行动、接敌后才显形 ⇒ 真机上会表现为"**拆完先各走各的**"，
   这是设计使然，不是故障，但**是本轮最可能被误判为"没生效"的现象**。

---

## 附 · 复跑与验证

```bash
node _v32_intent_sim.cjs          # 23 判据（战法选择 / 可编成路数 / 机动决策）
node _v31_plan_sim.cjs            # 教范 → 性格/阵型/动摇线
node _v31_taskforce_sim.cjs       # 战法编成 / 实体切分
node frontend/node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p frontend/tsconfig.json
```

真机验收判据（未做）：
1. 点「分兵」→ 米达麦亚应给出**两翼包抄**并可实际拆出 3 路（不再提示单路）
2. 拆出的侧翼分队应**走弧线绕向敌军侧后**，而非直线冲
3. `targetKind==='enemy_supply'` 的分队应**扑向敌方运输舰/补给点**，不缠斗敌方主力
4. 拆分出的子编队应**保留** `_maneuverRole`（见 §7.4）
