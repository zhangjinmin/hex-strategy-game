# 27 · aiDirector 战术 AI 决策整合（v55）

> 用户实报（2026-09-22）：「我控制的不对，都不会反击了，被动挨打？整体梳理下所有战术的代码，
> 对于 AI 的逻辑做个全面梳理，把所有散乱的逻辑做个整合，我需要更智能的 AI 对战」。
> 本文 = 战术/AI 决策点全景清单 + 根因链 + 整合架构 + 验证记录。

---

## 1. 根因链：「被超视距白嫖不反击」四层门（截图面板实读 = 「撤退补给中」）

| # | 病灶 | 位置（修复前） | 后果 |
|---|------|--------------|------|
| ① | 撤退/信标态**自卫还击门硬编码 250px** | `BattleScene` flaring/retreating 分支 | 武器射程 560~880px ⇒ 敌在 300~880px 白嫖，**贴脸才还手** |
| ② | `state==='retreating'` 时**接敌评估整段跳过**（else-if 链） | 状态机 `fleet.targetFlare / retreating` 分支 | 目标锁定/交战置位全程不跑 ⇒ 连"该打谁"都不知道 |
| ③ | 撤退分支**停船等补给**（`_regrouping` 原地驻留） | retreating → `supplyChainLive` 子分支 | 原地不动 = **固定靶**，边挨打边等补给 |
| ④ | 视野 **fuzzy（d>80% 视野）不可锁定** 小于武器射程 | `visibleEnemies/clearEnemies` 组装 | 被超视距打击时连目标都锁不上 = **被看不见的敌人打** |

**附带发现**（梳理过程中暴露的散乱证据）：

| # | 缺陷 | 证据 |
|---|------|------|
| ⑤ | `getIdealEngageDist` 手抄舰种名 `'航母'/'carrier'`，而 `config/gameData.ts` 真键是 `空母` | 计数恒 0 **全落默认 720**；纯 `舰载` 舰队 720 > 其射程 640 = "站得比打得远"**永不接战** |
| ⑥ | 两张**互相矛盾**的阵型表：状态评估处（ratio>1.5→wedge）与交战机动处（aggressive&&ratio>1.3→wedge） | 后者每帧覆盖前者 ⇒ 前者实为**死代码** |
| ⑦ | `supplyDecision` 的 `engaged` 又一处 250px 硬编码 | 补给/追击决策与开火门口径不一致 |
| ⑧ | 还击/接敌阈值散落 5 处互相矛盾 | 250 / 400 / 500 / 900 / 1000px 并存 |

---

## 2. 整合前：战术/AI 决策点全景清单

| 决策层 | 决策点 | 位置 | 内容 | 整合后归属 |
|--------|--------|------|------|-----------|
| 战略层（1Hz） | 战略姿态/阵型倾向 | `BattleScene` 1Hz 循环（AI-only） | 态势评估、`_avoidUntil` 避战窗 | 不变（战略层） |
| 任务层 | Mission 五类 | `TacticalCommandSystem.ts` | attack_fleet / capture_planet / hold_point / support_fleet / retreat_supply；`fleetIntentText` 面板文案 | 不变 |
| 任务层 | mission→stance/dest | `executeMissionTick` | 任务目标坐标解算 | 不变 |
| 战法层 | 战法库 MANEUVERS | `taskForce.ts` | frontal/flank/pincer/decoy/raid/screen/hold + `selectManeuver` + `assignDetachments` | 不变 |
| 运动层 | 接触/推进 | `combatControl.ts` | `updateContact`（2s 释放窗）、`advanceManeuver`（cruise→brake→turn→reform / disengage） | 不变 |
| 运动层 | 转向纪律 | `combatDoctrine.ts` `turnDiscipline` | free/limited/denied | 不变 |
| 运动层 | 补给/追击决策表 | `combatDoctrine.ts` `supplyDecision` | S0~S11、回程锁定滞回 | `engaged` 输入口径改为真射程 |
| 运动层 | 护航站位 | `tacticalTasks.ts` `escortDestination` | 纯几何 | 不变 |
| 撤退层 | 撤退三档 | `retreatDoctrine.ts` | disengage/withdraw/rout、士气/补给连续量 | 不变 |
| **战术层（本次收口）** | 可见性分级 | 原内联三元 | full/partial/fuzzy | **`aiDirector.visibilityOf`** |
| **战术层** | 受击台账 | 无（本次新增） | 8s 还击窗口证据链 | **`aiDirector.noteIncomingFire/activeAttacker`** |
| **战术层** | 开火门 | 原 `isEngaging && …` + 250px 自卫门 | 该不该开火 | **`aiDirector.fireGate`** |
| **战术层** | 目标选择 | 原内联评分+滞回 | 打谁 | **`aiDirector.pickTarget`** |
| **战术层** | 理想交战距/还击半径 | 原手抄舰种表 + 250px | 站多远 | **`aiDirector.idealEngageDistFrom/strikeRangeFrom`** |
| **战术层** | 战斗阵型 | 原两张矛盾表 | 什么阵型 | **`aiDirector.chooseFormation`** |

---

## 3. 整合后架构：决策/执行分离

```
                    ┌────────────────────────────────┐
   态势快照（每帧）  │  BattleScene（执行层）           │
   ─────────────────►  快照 → 问模块 → 应用            │
                    │  · 位移/转向/阵型应用             │
                    │  · 伤害结算（此处写受击台账）      │
                    └───────┬────────────────────────┘
                            │ 纯数据问答（无 Phaser 依赖）
        ┌───────────────────┼───────────────────────┐
        ▼                   ▼                       ▼
┌──────────────┐  ┌──────────────────┐  ┌────────────────────┐
│ aiDirector   │  │ retreatDoctrine  │  │ combatDoctrine     │
│ · visibility │  │ 撤退三档/士气/   │  │ 转向纪律/补给决策/  │
│ · 受击台账    │  │ 补给连续量       │  │ 进取度              │
│ · fireGate   │  └──────────────────┘  └────────────────────┘
│ · pickTarget │  ┌──────────────────┐  ┌────────────────────┐
│ · 距离/射程   │  │ combatControl    │  │ taskForce          │
│ · 阵型       │  │ 接触/推进运动学   │  │ 战法库/分舰队指派   │
└──────────────┘  └──────────────────┘  └────────────────────┘
```

**核心不变量（aiDirector 头部已固化）**：

1. **受击必还击**：8s 内攻击过我方的敌舰 = "已暴露攻击者"。即使视野模糊 / 正在撤退 / 信标任务在身，
   只要攻击者进入我方射程 ⇒ 必须还手；**谁打我，我打谁**（复仇加权 30000）。
2. **决策与执行分离**：aiDirector 只回答"该不该打/打谁/什么阵型/站多远"；
   怎么飞/怎么转/怎么结算仍由 BattleScene + 运动层模块负责。
3. **数据不手抄**：射程一律由调用方传入 `u.range`（`config/gameData.ts` 唯一真源）⇒ ⑤ 类错键缺陷不可能再现。

---

## 4. 判定表（全部可台架逐条断言）

### 4.1 开火门 `fireGate`（第一条命中即返回）

| # | 条件 | 结果 | 依据 |
|---|------|------|------|
| 1 | 交战态（状态机已接敌） | `combat` | 既有行为，不动 |
| 2 | 受击 且 攻击者距离 ≤ 本舰队最远射程 | **`return_fire`** | 受击必还击：无视任务/姿态/撤退/视野模糊 |
| 3 | 其余 | `none` | 未接敌且未受击 |

### 4.2 目标评分 `scoreTarget`（层级：任务 > 复仇 > 基础）

```
score = (1-敌血量%)×300 − 距离 + 战力×0.1        ← 基础（与整合前逐项一致）
      + 任务指定目标 ? 100000 : 0                ← attack_fleet 绝对优先
      + 攻击者(8s窗口) ? 30000 : 0               ← 复仇加权：谁打我我打谁
```
滞回 `pickTarget`：旧目标仍在候选且新最优未领先 10% ⇒ 沿用（防帧间交替 ⇒ 朝向反相）。
候选 = 清晰目标（fuzzy 不可锁定）**+ 攻击者**（位置已暴露 ⇒ 可还击）。

### 4.3 理想交战距 `idealEngageDistFrom` / 还击半径 `strikeRangeFrom`

| 规则 | 值 | 依据 |
|------|----|------|
| 舰载机母舰（range≥850 且 atk≤25，数据驱动） | 880 | 远距释放，舰载机抛射后撤 |
| 其余 | mean(range)×0.95，钳 [540, 880] | 对齐旧表 800/700/560 口径 |
| 空舰队 | 140 | 兜底 |
| 不变量 | ideal ≤ 本舰队任一战斗舰射程 | 杜绝"站得比打得远"（⑤ 的回归钉） |
| 还击半径 | max(range)（排除补给舰） | 替换 250px 硬编码 |

### 4.4 阵型 `chooseFormation`（两张矛盾表收口为最终生效口径）

| # | 条件 | 阵型 |
|---|------|------|
| 1 | 避战窗内 / 劣势规避 | spindle（压倒一切） |
| 2 | 同目标友军 ≥ 2 | circle（3+ 舰队集火包围） |
| 3 | 激进（统帅>80 或战法侧翼）且兵力比 > 1.3 | wedge |
| 4 | 兵力比 > 0.8 | line |
| 5 | 其余 | spindle |

### 4.5 可见性 `visibilityOf`

| 距离/视野 | 分级 | 锁定 |
|-----------|------|------|
| <50% | full | 可 |
| 50~80% | partial | 可（识别类型） |
| 80~100% | fuzzy | 不可（除非是攻击者） |
| ≥100% | null | 不可 |

---

## 5. BattleScene 接线清单（14 处，2026-09-22）

| # | 接线点 | 内容 |
|---|--------|------|
| 1 | import 块 | 引入 aiDirector 全部决策函数 |
| 2 | `clearEnemies` 锁定后 | **受击攻击者解析注入**：`activeAttacker` → 无清晰目标时以攻击者为 `closestEnemyFleet`（fuzzy/视外 亦可锁定）——根因②④的修复 |
| 3 | 同块后 | 战斗舰射程画像（排除补给舰）→ `strikeRange` |
| 4 | flaring 自卫门 | 250px → `strikeRange`（根因①） |
| 5 | retreating 自卫门 | 250px → `strikeRange`（根因①，主病灶） |
| 6 | 停船等补给 | **受击豁免**：挨打时改"边补给边滑开"（背离攻击者 140px 滑开点），不做固定靶（根因③） |
| 7 | 开火门 | `isEngaging && …` → `fireGate`（return_fire 模式强制打攻击者） |
| 8 | 伤害结算 | `tgtFleet = fireTargetFleet` + **`noteIncomingFire` 台账写入** |
| 9 | 目标选择 | 内联评分+滞回 → `pickTarget`（候选含 attacker 项） |
| 10 | 状态评估阵型表 | → `chooseFormation` |
| 11 | 交战机动阵型表 | → `chooseFormation`（与 #10 同一函数 ⇒ 双表收口） |
| 12 | `getIdealEngageDist` | 重写为委托 `idealEngageDistFrom`（根除错键⑤） |
| 13 | 可见性分级 | 内联三元 → `visibilityOf` |
| 14 | `supplyDecision` 输入 | `engaged` 250px → `strikeRange`（⑦） |

---

## 6. 验证记录（2026-09-22）

| 层 | 手段 | 结果 |
|----|------|------|
| L1 | `_v55_ai_sim.cjs`（require 真源码，55 断言） | **55/55 PASS**，EXITCODE=0 |
| L1 | `scripts/tacticalCombatSim.cjs` 回归 | **10/10 PASS**（保持） |
| L1 | `vue-tsc --noEmit` | **EXITCODE=0** |
| L2/L3 | 无头探针 / 真机手感 | **待验收**（见 §7） |

台架含**端到端最小复现**（用户 bug 的可执行钉）：
撤退态（engaged=false）+ 视野外攻击者 700px 持续射击
⇒ `fireGate` 必须 `return_fire`（旧 250px 门下 = 不还击）；
开火目标 = 攻击者（不是近处围观者）；8s 后窗口关闭（还击是窗口行为不是永久锁）。

---

## 7. 遗留与后续

1. **L2 探针**：`_probe_v55_return_fire.mjs`（场景级：制造"撤退中受击"并断言实际开火）——建议下轮补。
2. **真机（L3）验收**：`wails dev` 下复现原截图场景（撤退补给中被白嫖）⇒ 确认已还手；
   波浪舞/手感类观感仍须人眼。
3. 档位 UI（disengage/withdraw/rout 显式切换）未做（v29 遗留）。
4. 追击豁免（v48）、相位滞回（v46-C）等运动学机制**未动**——本次只收口"决策"，不动"运动"。
