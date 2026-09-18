# 16 · 3d-tactical-battle 文档集勘误台账（命令系统「效果层未实现」口径）

> **台账建立**：2026-09-15 · 责任人：文策渊（design-strategist） · 任务板 #42 / #43（DOC-1）
> **性质**：勘误台账（长期留存）。记录本批文档（写于 2026-08-30）中**已被代码现实超越**的结论，逐条给出「原结论 → 现值 → 依据（文件:行号）」。
> **纪律**：只读代码 + 只写 `docs/**`；未改任何 `src/**`（`frontend/src/**` 处于验收冻结期）；未改 `docs/qa/**`（QA 冻结证据）。
> **原则**：**保留留痕，不静默改写历史**——旧文档结论一律保留，采用「原文 + 勘误段」形式回写，不删除、不覆盖。

---

## 0. 一句话摘要

本批文档的核心前提是「**CP 命令效果层大面积未实现**」（8 个置灰、`teleport`/`reflect`/`heal` 无 handler、多个乘区函数零调用）。该前提**自 2026-09-01/09-04 起已被代码侧接线超越**，今日（09-15）命令目标选择链路（2a）亦已完成收口并经 QA 独立验证放行。**现值：11 个命令中 1 个置灰 + 4 个半生效 + 6 个可用**。本文档集中登记全部勘误，供后续读者以现值决策。

---

## 1. 方法：判据来源与核实原则

| 项 | 说明 |
|----|------|
| **判据唯一权威** | 源码实读（**不采信旧分析，也不采信他人转述**）。所有行号为本轮实测。 |
| 读源 | `frontend/src/config/commandAbilities.ts`（201 行）· `frontend/src/services/CommandPointSystem.ts`（203 行）· `frontend/src/game/scenes/BattleScene.ts`（5457 行）· `frontend/src/game/three/Battle3DOverlay.ts`（5367 行）· `frontend/src/components/battle/CommandPanel.vue`（255 行）· `frontend/src/App.vue`（789 行）· `frontend/src/services/CommandBridge.ts`（31 行） |
| 可引用证据（**勿改写，QA 冻结**） | 实现：`docs/qa/v15_命令链路贯通_目标选择修复_20260914.md`；独立验证：`docs/qa/v15_命令链路贯通_独立验证_20260915.md` |
| **行号漂移声明（重要）** | 旧文档引用 `BattleScene.ts:2845` 等行号时该文件约 3827 行，现值 **5457 行**。**旧行号属版本漂移，非结论错误**；本台账一律给**现值行号**。 |

---

## 2. 勘误核心一：命令状态计数对照（旧 → 新）

### 2.1 计数字典

| 口径 | 置灰（未实现） | 半生效（partialNote） | 可用 | 合计 |
|------|:---:|:---:|:---:|:---:|
| **旧（README §0 / `10` §1，2026-08-30）** | **8** | 1（`reinhard_roar`） | 2（`focus_fire`/`ecm_jam`） | 11 |
| **新（2026-09-15 实读）** | **1** | **4** | **6** | 11 |

> 旧口径的第三种状态「部分生效」当年只给了 `reinhard_roar` 一个；现值**部分生效扩展到 4 个**（见下表），且 **`reinhard_roar` 自身已转为完整可用**（其移速部分已接线）。

### 2.2 逐命令现值表（含依据）

| 命令 | CP | `effect.type` | **现值状态** | 依据（现值行号） |
|------|:--:|---------------|:---:|------------------|
| 集中火力 `focus_fire` | 2 | `damage_boost` | ✅ **可用**（+30% 伤害 20s）。⚠️ 但「集火**单一**目标」语义**仍未实现**——加成作用于施令舰队**全部**攻击，与所选目标无关 | `CommandPointSystem.ts:128-130`（按 `casterFleetId` 匹配，非 `targetFleetId`） |
| 电子干扰 `ecm_jam` | 2 | `debuff` | ✅ **可用**（**2a 补完目标后真实生效**） | T1：CP −2、`effect.targetFleetId`=敌 id、`getDamageMultiplier`=0.75（`v15_独立验证` §2 T1） |
| 紧急抢修 `emergency_repair` | 1 | `shield` | ✅ **可用**：瞬时 heal 20% 已落地；护盾 0.5 减伤经受击乘区生效 | heal：`BattleScene.ts:2652-2657`；减伤：`:4382` |
| 紧急回避 `evasive_maneuver` | 1 | `shield` | ✅ **可用**（shield 1.0 → 减伤下限 0.05，近似无敌帧） | `CommandPointSystem.ts:158-162`（下限）· `:4382`（消费） |
| 士气鼓舞 `morale_rally` | 2 | `morale` | ✅ **可用**：`getMoraleModifier` 已接线；**且士气系统本身已存在** | `BattleScene.ts:4365-4366`（消费）· 士气系统见 §4 |
| 黄金狮子的咆哮 `reinhard_roar` | 3 | `damage_boost` | ✅ **可用**：伤害 +50%（`:4363`）+ 移速 ×1.3（`reinhard_roar` 专属分支）**双通道均已生效** | 伤害 `:4363`；移速 `CommandPointSystem.ts:184-186` → `BattleScene.ts:4118` |
| 阵型突击 `formation_charge` | 2 | `speed_boost` | ⚠️ **半生效**：速度 ×2 已生效；「自动冲锋到目标身后」**未实现** | `partialNote` `commandAbilities.ts:97`；速度 `:4118` |
| 魔术师的反击 `yang_magic_counter` | 3 | `reflect` | ⚠️ **半生效**：反弹 50% + 减伤 50% 已生效；「结束后士气 +50」**未实现** | `partialNote` `:115`；反弹 `BattleScene.ts:4384-4389`、减伤 `:4382` |
| 红发的守护 `kirscheis_guardian` | 3 | `shield` | ⚠️ **半生效**：护盾全减伤已生效；「**伤害转移**（替代承伤）」**未实现** | `partialNote` `:141`；减伤 `:4382` |
| 老将的坚壁 `bucock_bastion` | 2 | `shield` | ⚠️ **半生效**：防御 +50% 已生效；「速度归零」（需玩家手动切驻守姿态）、「伤害 +20%」**未实现** | `partialNote` `:154`；减伤 `:4382` |
| 双璧的猛袭 `reuenthal_blitz` | 3 | `teleport` | ❌ **置灰（唯一）**：`implemented: false`，无 `teleport` handler | `commandAbilities.ts:167`；`teleport` 全仓仅 config 内 3 处命中，无 handler |

**计数依据（可复现）**：`implemented: false` 全文件仅 **1 处**（`:167`）；`partialNote` 全文件 **4 处**（`:97`/`:115`/`:141`/`:154`）；其余 6 条无任何标注。

---

## 3. 勘误核心二：五个乘区函数 + 一个死代码函数（现值接线位置）

旧文档（README §3.2、`07` §1.1、`11` §1.1）称这些函数「从未调用 / 仅 1 处且 `isDefending=false` / handler 不存在」。**现值如下（本轮实测）**：

| 规则层函数 | 定义位置 | **消费点（现值）** | 状态 | 旧结论 |
|-----------|:---:|:---:|:---:|--------|
| `getDamageMultiplier` | `CommandPointSystem.ts:124` | **`BattleScene.ts:4363`**（实参 `isFleetDefending` = `fleet.stance === 'defend'`，`:4362`） | ✅ 已接线，**非**常量 `false` | ❌ 证伪 |
| `getIncomingMultiplier` | `:146` | **`BattleScene.ts:4382`** | ✅ 已接线 | ❌ 证伪 |
| `getReflectRatio` | `:166` | **`BattleScene.ts:4384`**（反弹结算 `:4385-4389`） | ✅ 已接线 | ❌ 证伪（旧称「无 reflect handler」） |
| `getSpeedMultiplier` | `:177` | **`BattleScene.ts:4118`**（并入 `fleetBaseSpeed` `:4119`） | ✅ 已接线 | ❌ 证伪 |
| `getMoraleModifier` | `:192` | **`BattleScene.ts:4365`**（并入 `cpMoraleMult` `:4366`） | ✅ 已接线 | ❌ 证伪 |
| `getActiveEffects` | `:113` | **无消费点**（连 `import` 都没有） | ❌ **仍为死代码** | ✅ **仍成立，保留** |

> **旧文档的行号对照（版本漂移，非结论错误）**：旧文写 `getDamageMultiplier` 在 `BattleScene.ts:2845`、`shield` 分支 `CommandPointSystem.ts:126`、`speed_boost` `:138`、`morale` `:153`、`reflect` 注释 `:132` —— 现值分别为 `:4363`、`:146/:150`、`:177/:180`、`:192/:197`、`:166`。

**关于 `teleport` / `heal`**：
- `teleport`：**仍无 handler**（旧结论成立，保留）。
- `heal`：规则层**仍无 `heal` 类型 handler**（且无任何命令使用 `heal` 类型）；但 `emergency_repair` 描述的「恢复 20% HP」**现已通过 `showCommandEffect` 落地**（`BattleScene.ts:2652-2657`）——所以「不产生任何治疗」这条**已证伪**。

---

## 4. 勘误核心三：士气系统已存在（`11 §2.3` 结论被证伪）

旧文档称「**士气系统完全不存在**」（`11` §2.3、`10` §1 的 `morale_rally` 行、`07` §1.2）。**现值证伪**——士气系统已是一套真实、有消费点的机制：

| 环节 | 现值实现 | 依据 |
|------|----------|------|
| 士气字段 | 每舰队 `morale`，初始化 100 | `BattleScene.ts:973`；`:836`（从 fleetData 读） |
| 自然变化 | 断粮掉士气（`−1.5`）、补给回涨（`+1`） | `:1347` / `:1333` |
| **影响移速** | `moraleSpeedMult = 0.7 + 0.3 × (morale/100)` | `:4107`，并入 `fleetBaseSpeed` `:4119` |
| **影响伤害** | `moraleDmgMult = 0.6 + 0.4 × (morale/100)` | `:4330`、`:4567`，并入 `finalDmg` `:4371` |
| CP 士气的额外加成 | `cpMoraleMult = 1 + max(0, cpMorale) × 0.003`（每 10 点 +3%） | `:4365-4366` |

> 结论：`morale_rally` **不是**「需要从零建一套系统」，而是「一套已存在系统上的一条命令」。旧文档基于「士气不存在」得出的工作量评估（`11` §6 建议单独拆任务、`11` §2.3 称工作量最大）**已不适用**。

---

## 5. 勘误核心四：2a 目标选择链路已贯通（层 1 已完成，QA 放行）

旧文档称「`requiresTarget` 命令**目标选择未实现**」「`commandBridge.pendingCallback` 全项目仅被 `null` 调用过」（README §3.2/§1、`03` §1.1、`07` 头部）。**现值：已实现最小闭环并通过独立验证。**

| 落点 | 方法 / 位置（现值） |
|------|---------------------|
| 进入选目标态 | `BattleScene.enterTargetSelect` `:2545` |
| 对舰队执行（含非法→提示保持态） | `BattleScene.tryExecuteOnFleet` `:2562` |
| 退出选目标态（清 3 字段，不动 `isPaused`） | `BattleScene.exitTargetSelect` `:2587` |
| 关闭面板（退选 + 清桥 + 恢复实时） | `BattleScene.closeCommandPanel` `:2597` |
| 2D 拾取 | `BattleScene.pickFleetAtWorld` `:2606`（阈值 40px） |
| 3D 拾取 | `Battle3DOverlay.pickFleetAtScreen` `:5066`（只拾取候选集内 id） |
| 面板 4 emit | `CommandPanel.vue:88-98`（`execute`/`select-target`/`cancel-target`/`cancel`） |
| App 4 handler | `App.vue:155`（execute）/`:168`（cancel）/`:182`（select-target）/`:188`（cancel-target） |
| 无可见目标置灰 | `commandBridge.hasVisibleTargets`（`CommandBridge.ts`）+ `CommandPanel.vue:120` |

**关键成果**：`ecm_jam` 补完目标后**真实生效**——独立验证 T1 实测：CP 扣 2、`effect.targetFleetId`=敌 id、`getDamageMultiplier`=0.75。

**QA 放行结论**：`v15_命令链路贯通_独立验证_20260915.md` §E.7 质量门判定 **PASS**（BUG-1 Blocker 已消除，原 11 条 BUG-1 家族 FAIL 全转 PASS，回归 `vue-tsc EXIT=0` + 阵型三维 `931/931`）。**最终放行权归用户**。

**剩余未做（2a-2 增强，明确不做）**：编号徽章①②③ / 数字键 `1-9` / `Tab` 循环 / 雷达列表 / 面板打开后 500ms 动态重算（见 `v15_..._修复` §6、`v15_..._独立验证` 附录 B）。

---

## 6. 被证伪的旧结论清单（汇总）

| # | 旧结论（出处） | 现值 | 判定 |
|:--:|----------------|------|:----:|
| 1 | 「11 个命令中 8 个置灰」（README §0、`10` 全篇） | 1 置灰 + 4 半生效 + 6 可用 | ❌ 证伪 |
| 2 | 「11 个命令中只有 2 个有部分实际效果」（README §3.2） | 6 个完整可用（另 4 个半生效） | ❌ 证伪 |
| 3 | 「`getSpeedMultiplier` / `getMoraleModifier` 从未调用」（README §3.2、`07` §1.1、`11` §1.1） | 均已接线（`:4118` / `:4365`） | ❌ 证伪 |
| 4 | 「`getDamageMultiplier` 仅 1 处且只以 `isDefending=false` 调用；`shield` 分支永远不可达」 | `:4363` 传真实 `isFleetDefending`；护盾减伤经 `:4382` 生效 | ❌ 证伪 |
| 5 | 「`teleport`/`reflect`/`heal` handler 不存在」 | `reflect` 已实现（`:4384`）；`heal` 无类型 handler 但 `emergency_repair` 治疗已落地（`:2652`）；`teleport` 仍无 handler | ⚠️ 部分证伪 |
| 6 | 「`emergency_repair` 不产生任何治疗」（README §3.1） | 瞬时 heal 20% 已落地 | ❌ 证伪 |
| 7 | 「`requiresTarget` 目标选择未实现；`pendingCallback` 仅被 `null` 调用」（README §3.2/§1、`03` §1.1、`07` 头部） | 2a 已完成并 QA 放行 | ❌ 证伪 |
| 8 | 「士气系统完全不存在」（`11` §2.3、`10` §1、`07` §1.2） | 士气系统已存在且影响移速/伤害 | ❌ 证伪 |
| 9 | 「4 个 `requiresTarget` 命令里只有 `ecm_jam` 能被目标选择真正修复」（README §3.2） | `ecm_jam` 已修好（成立）；`formation_charge` 速度、`focus_fire` 已可用——口径需更新 | ⚠️ 部分证伪 |
| 10 | 「11 个命令中 9 个无效」（`03` §4.3 表） | 1 无效 + 4 半生效 | ❌ 证伪 |

---

## 7. 仍然成立的欠账（**不得**一并宣称「全部完成」）

| # | 欠账 | 依据 | 状态 |
|:--:|------|------|:----:|
| 1 | `reuenthal_blitz` 仍置灰（`teleport` 无 handler + `durationMs: 0` 语义问题） | `commandAbilities.ts:167` | ❌ 未做 |
| 2 | `getActiveEffects` 仍为死代码（零调用、零 import） | `CommandPointSystem.ts:113` | ❌ 未做 |
| 3 | `focus_fire`「集火单一目标」语义未实现（加成作用于全部攻击） | `CommandPointSystem.ts:128-130` | ❌ 未做 |
| 4 | `formation_charge`「冲锋到目标身后」未实现 | `commandAbilities.ts:97` | ❌ 未做 |
| 5 | `yang_magic_counter`「结束后士气 +50」未实现 | `:115` | ❌ 未做 |
| 6 | `kirscheis_guardian`「伤害转移（替代承伤）」未实现 | `:141` | ❌ 未做 |
| 7 | `bucock_bastion`「速度归零 / 伤害 +20%」未实现 | `:154` | ❌ 未做 |
| 8 | 2a-2 增强（编号徽章 / 数字键 / `Tab` / 雷达 / 500ms 重算） | `v15_..._修复` §6 | ❌ 未做 |
| 9 | `15-battle-tactics-review.md` 的方向 3 / 方向 4 未开工 | `15` §3 | ❌ 未做 |

### 7.1 观察项（待复核 —— **仅登记，未确认、未修改代码**）

| # | 观察项 | 说明 | 处置 |
|:--:|--------|------|------|
| 1 | `formation_charge` 在**交战态**的速度是否叠乘 | `BattleScene.ts:4131` 的 `engageSpeed` 计算**不含** `cpSpeedMult`（该乘区的消费点在 `:4118`，并入 `fleetBaseSpeed`）。因此「速度 ×2」是否在**交战（engage）态**同样生效，**尚未确认** | 本轮 `src/**` 冻结，**只登记不核**；待后续专项复核 |
| 2 | `15-battle-tactics-review.md` 的行号快照已漂移 | 该文 `:350` 引用五乘区消费点为 `BattleScene.ts:3883` / `:4079` / `:4081` / `:4098` / `:4100`，与本台账现值 `:4363` / `:4382` / `:4384` / `:4118` / `:4365` **不一致**。原因：`15` 的行号取自其 **2026-09-14 自身快照**（该文附录已声明），2a 工程改动（09-14/09-15）致此后漂移——**属版本漂移，非该文结论错误** | **不改 `15` 正文**（#43 边界）；建议 2a 完全收口后统一重核 `15` 的行号 |

### 7.2 本批新增勘误观察项（V18 期 · `#71` 回填 · 2026-09-16）

> **来源**：`#71` 文档回填批次（DOC-2）。以下两项为本轮**新发现**的"文档/注释与代码现实不一致"项，**只登记**，不改 `src/**`、不改 `docs/qa/**` 冻结件。

| # | 观察项 | 说明 | 处置 |
|:--:|--------|------|------|
| **E-新1** | `Battle3DOverlay.ts:5045-5046` **陈旧注释** | 注释写「屏幕空间命中**玩家/盟军**舰队 → 选中并吞掉本次点击」，但实际过滤在 `BattleScene.ts:2890`（`applyFleetSelectByPick` 内 `flFac.type === 'player'`，`#63-a` 已移除恒假 `ally` 分支）⇒ **盟军/僚舰实际不可选**。属**注释与实现不一致**（**非行为缺陷**，行为以 `BS:2890` 为准） | **只登记**；修复需改 `src` 注释 ⇒ **单独立单，本轮不动**（`src/**` 冻结期） |
| **E-新2** | `15-battle-tactics-review.md` §2.4「对手可读性」行**枚举计数不一致** | 该行括注**写「6 种」但实际列举 7 项**（撤退补给/交战中/前往信标/集结中/驻守警戒/攻坚推进/索敌推进）；代码侧 `fleetIntentText` 的状态/姿态分支**实为 8 个取值**（含 `fallback`→"撤退"，及 `engaging` 命中目标名分支 `攻击 <名>`） | **只登记**（`15` 正文已在 `#71` 加留痕注，**不追改原表**）；精确口径**统一以内容锚点 `TacticalCommandSystem.ts:156-184` 为准** |

> **关联**：E-新1 与 §7.1-2「`15` 行号快照漂移」同属"文档/注释与代码现实不一致"类；E-新2 与 `17` §1.1 P11 行、`15` §2.4 留痕块**同源**（均出自 `#71` 回填）。
> **边界（重申）**：§7.2 仅登记，未改任何 `src/**`；`frontend/src/**` 仍处验收冻结期，行号为本轮实测。

---

## 8. 勘误落点索引（改了哪些文件 / 哪一节）

| 文件 | 勘误落点 | 形式 |
|------|----------|------|
| `README.md` | 头部 + §0「关键数字」+ §1「立场」+ §3.1 表 + §3.2 标题/表/结论 + §7.0 Q8 行 + §9 验收清单 | 头部勘误块 + 目标行内批注（标「2026-09-15 复核」）+ 指向本台账 |
| `10-disabled-command-state.md` | 头部 + §1 计数与逐命令表 + §2 四态表 + §9 验收清单 | 头部勘误块 + §1 表内「现值」列 + 文末勘误段 |
| `07-target-selection-spec.md` | 头部状态 + §1.1 表 + §1.2 11 命令表 + §8.1/§8.2 | 头部状态改「✅ 已完成」+ §1.x 表内「现值」列 + §8 标注已完成/剩余 |
| `11-layer2-effect-implementation.md` | 头部 + §1.1 表 + §1.3 待修清单 + §2 前置问题 + §3 逐类型 | 头部勘误块 + §1.1/§1.3 表内「现值」列 + 文末勘误段 |
| `03-command-flow-3d.md` | 头部必读前提 + §1.1 步骤表 + §1.2 断点 A/B + §4.3 表 | 头部勘误块 + 步骤 ④ 改 ✅ + 断点标注已修复/仍缺 |
| `15-battle-tactics-review.md` | §6 Q3（加一行进度注记，**不改结论**）+ §5 README 行（追加「已执行」交叉引用） | 行内注记（共 2 处，均不改结论） |
| `16-command-docs-errata.md` | §0–§9 全篇（本台账自身） | **新建**；§2 为计数权威、§8 为落点索引、§9 为真源指针 |

**完成状态（2026-09-15 07:53 本地 / 23:53Z）**：全套写入完成 **7 / 7 文件**（6 改 + 1 新建）；`README.md` §0 复核注去重完成；行内「2026-09-15 复核」标记覆盖全部受勘误文件；**本台账为计数权威**。边界：只读源码 + 只写本目录 `.md`，未碰 `src/**` / `docs/qa/**`；临时产物已清零（本目录仅 17 个 `.md`）。

**追加（2026-09-16 · `#71` 回填）**：新增 **§7.2**（E-新1/E-新2 两项观察项，见上）；本批**未改** `src/**`、未改 `docs/qa/**` 冻结件；本目录新增 `notes/` 子目录（存 `#67` 盟友 triage 裁定副本）。

---

## 9. 后续方向的真源指针

本批文档的 §3.2 / `10` / `11` 旧结论已过时，**读者请以下列文件为当前真源**：

- **对战逻辑与战术深度的后续方向** → **`15-battle-tactics-review.md`**（WS16-B，2026-09-14）：结论摘要、现状复盘、诊断、四个改进方向、待用户拍板 3 条。**不要**再以 README §3.2 的旧结论做决策。
- **命令链路（层 1）的实现与验证证据** → `docs/qa/v15_命令链路贯通_目标选择修复_20260914.md` + `docs/qa/v15_命令链路贯通_独立验证_20260915.md`。
- **命令数据层的现行真源** → `frontend/src/config/commandAbilities.ts`（`implemented` / `partialNote` 即当前状态）。

---

## 附：本文档的核实边界与自述

- 本文档所有 `file:line` 均为 **2026-09-15 本轮实测**（读取时哈希见交付回执）；`frontend/src/**` 处于验收冻结期，若后续有工程改动，行号需重新核。
- 本文档**只记录勘误，不改任何结论方向**；对被证伪的旧结论一律**保留原文**并在原文档内标注勘误，符合「保留留痕」原则。
- 本文档**未**使用「最先进 / 第一」类营销性表述；出现的「唯一」仅作**事实判定**用（§1「判据唯一权威」、§2.2「置灰（唯一）」= `implemented: false` 全文件仅 1 处）。所有计数均为源码可复现的枚举结果，非估计值。
