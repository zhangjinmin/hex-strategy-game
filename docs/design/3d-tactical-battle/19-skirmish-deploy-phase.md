# 19 · 演习模式「战前部署窗口」设计方案

> **性质**：**方案设计文档（只读源码 + 只写 `docs/`）**。**未修改任何 `frontend/src/**`、未改 `.vue`、未起 dev server、未跑 `wails build`、无 git 写操作。**
> **作者**：文策渊（design-strategist-2） · 任务 **#74**
> **决策依据**：用户 JM 本轮拍板 —— **选择 A：演习模式也要拿到「真暂停 + 中央部署菜单」**（同时军议面板同步进入战前态）。Q2 AI 形态拍板「确定性规划」（与本方案无关，仅留痕）。
> **触发（用户原话 · 逐字）**：
> > 「现在右键的功能是恢复了，但是你一直说的一开始会暂停然后布置战术的的界面从未见过，只有在最右侧的作战会议面板，这个有用吗？」
> **前序/交叉引用**（**先读再写，避免与既有结论冲突**）：
> - `18-preplan-council-command.md`（战前规划 × 战中军议 × 总指挥任命；§2.4 演习 vs 战役、§2.5 #58 同步、§2.6 盟友定位）
> - `15-battle-tactics-review.md`（`deployPhase` 相关方向；§3 方向 1 战前布阵盘、§2f 信息真实性纪律）
> - `17-ai-battle-planning-options.md`（§2.2 接入点表内 `activateDeployPhase` 的用法）
>
> **行号约定（重要，沿用仓库既有惯例）**：`BattleScene.ts`（BS）/`Battle3DOverlay.ts`（B3D）/`gameStore.ts` 在本轮前后被并发修改，**本文所有论断以「内容锚点」（函数名 / 代码片段 / 字符串）为准，行号仅为快照参考值**。快照见 §附 A。
> **术语一致性**：`18` §1.0「战前战术制定 = `activateDeployPhase` 部署阶段」口径沿用；`deployPhase`（BS 私有字段）与 `battleDeployPhase`（store 镜像）为两处同名概念，本文分别用**字段名**指代，不用中文简称。
>
> **修订记录**
> - `r1`（2026-09 · #74）：初稿。基于只读取证（§附 A 快照）产出 6 节设计。

---

## 0. 结论摘要（主理人直读）

| # | 问题 | 结论 |
|:--:|------|------|
| **1** | 演习为什么进不去部署界面？ | **不是断链，是分支错配**。部署菜单真实存在且功能完整（`activateDeployPhase()` / `updateDeployText()`），但入口有一道门 `if (this.store.simMode \|\| !hasPlayer)`（锚 `if (this.store.simMode || !hasPlayer) {`）；**演习启动恒置 `simMode=true`** ⇒ 演习永远走早退分支。见 **§1** |
| **2** | 怎么改？ | **把 `simMode` 从这道门里拿掉**——早退分支只保留「无玩家阵营」这一种情形；有玩家的演习/战役/对战**统一进入真暂停部署窗口**。**关键纪律：`planAiFactionsForDeploy()` 与 `publishSupremeCommanderPanel()` 必须各留在「互斥分支内」，不得上提，否则会双重调用。** 见 **§1**（附完整伪代码） |
| **3** | 演习节奏怎么定？ | **推荐 A2**：保留 JM 要的「真暂停 + 中央菜单 + 回车开战」，**追加 20s 倒计时自动开战**（鼠标悬停军议面板时倒计时暂停）。既尊重 JM 拍板，又消掉「每次开局多按一次回车」的摩擦。见 **§2** |
| **4** | 中央菜单里的「战术指令（突袭/合围/稳守）」留不留？ | **它现在是死项**（F2 去镜像后对 AI 无效果；对玩家舰队也无写入点）——**保留即"假信息"**。**推荐改为真正作用于玩家的「旗舰开局姿态」**（本批可落地，小改）；最小改备选 = **直接删除该项**。见 **§3** |
| **5** | 有没有阻塞性风险？ | **有 1 处必须一并修的守卫漏洞**：`SPACE`（pause / 指挥点面板）在 `update()` 里先于 `isPaused` 早退被处理，**部署期按 `SPACE` 会在部署菜单之上叠开指挥点面板**。缓解 = 一行守卫 `!this.deployPhase`。其余守卫（`BS:3515`/`B3D:5050`/右键/`:2561`/`:2604`）语义**仍正确**。见 **§5** |
| **6** | 交互闭环自洽吗？ | **在指挥制下自洽**：部署期玩家可做 = 键盘（阵型 / 开机姿态 / 回车）+ 军议 DOM 面板（任务 / 总指挥）+ 相机平移缩放。**部署期不能"把旗舰挪位"是既有局限（战役同款），补它 = 布阵盘（`15` 方向 1），不在本批。** 见 **§5** |

---

## 1. §1 分支改造方案

### 1.1 现状（内容锚点）

`private activateDeployPhase()`（BS 快照 `:744`）：

```ts
const state = (this.store as any).tacticalState;
const isCampaign = state && state.mode === 'campaign';        // ⚠ 本函数内未被使用（死变量）
const hasPlayer = this.store.factions.some((f: any) => f.type === 'player' && f.active);
if (this.store.simMode || !hasPlayer) {                       // ← 这道门让演习永远早退
    if (this.mapStyle === 'command') {
        (this.store as any).warRoomOpen = true;               // 只展开军议，不暂停
    }
    this.planAiFactionsForDeploy();                           // 早退分支的调用 A
    this.publishSupremeCommanderPanel();                      // 早退分支的调用 B
    return;                                                   // ← deployPhase 从不置真
}

this.deployPhase = true;
this.store.isPaused = true;
(this.store as any).battleDeployPhase = true;
if (this.mapStyle === 'command') (this.store as any).warRoomOpen = true;
const pFac = this.store.factions.find((f: any) => f.type === 'player');
const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
if (pFleet) pFleet.formation = this.deployFormation;
this.updateDeployText();
this.planAiFactionsForDeploy();                               // 部署分支的调用 A
this.publishSupremeCommanderPanel();                          // 部署分支的调用 B
```

**三支现状（互斥）**：

| 支 | 进入条件 | 副作用 | 现状命中 |
|:--:|----------|--------|:--:|
| 早退 | `simMode===true` 或 `!hasPlayer` | `warRoomOpen=true`(仅指挥制) + 调 A/B + `return` | 演习（含指挥制）/ 观战 |
| 部署 | 其余（有玩家 + 非演习） | 真暂停 + 中央菜单 + `battleDeployPhase` + 调 A/B | **战役 / 对战** |

> **一个易被忽略的事实（重要）**：**对战轨早已走部署分支**——对战 `hasPlayer=true` 且 `simMode=false` ⇒ 不满足早退条件。所以本批改动的**唯一净效果 = 把「演习（有玩家）」从"早退"移到"部署"**，战役/对战的现有行为**零变化**。

**演习恒为 `simMode=true` 的两处证据**：`launchSimBattle` 内 `tacticalState.value = { mode: 'skirmish', … }`（锚 `mode: 'skirmish'`）且 `enterSimMode()` 写 `simMode.value = true`（锚 `simMode.value = true`）。

**演习"有玩家阵营"成立**：`initFactions()` 对 `dispatchAdmirals` 逐位建阵营，首位 `type: index === 0 ? 'player' : 'ai'`（锚 `type: index === 0 ? 'player' : 'ai', team: 1`）⇒ `hasPlayer===true`；`launchSimBattle` 有 `simSelectedAdmirals.length === 0` 的前置拦截，故首位必然存在。⇒ **演习确实满足"有玩家"，只是被 `simMode` 单独挡在门外。**

### 1.2 改造后的完整分支结构（推荐实现 · 直接照抄）

```ts
private activateDeployPhase() {
    // 1) 判定"是否有玩家阵营参与"——这是唯一还应早退的情形
    const hasPlayer = this.store.factions.some((f: any) => f.type === 'player' && f.active);

    // ── 分支①：观战 / 无玩家阵营（保持现状，不暂停）──
    //    进入条件：!hasPlayer
    //    语义：没有"玩家决策者"，部署暂停无意义 → 仅展开军议 + 生成 AI 计划 + 镜像总指挥卡
    if (!hasPlayer) {
        if (this.mapStyle === 'command') (this.store as any).warRoomOpen = true;
        this.planAiFactionsForDeploy();          // 调用点①-A（本分支唯一）
        this.publishSupremeCommanderPanel();     // 调用点①-B（本分支唯一）
        return;
    }

    // ── 分支②：有玩家（战役 / 演习 / 对战）→ 一律真暂停部署窗口 ──
    //    进入条件：hasPlayer（不再看 simMode）
    this.deployPhase = true;
    this.store.isPaused = true;
    (this.store as any).battleDeployPhase = true;
    if (this.mapStyle === 'command') (this.store as any).warRoomOpen = true;
    const pFac = this.store.factions.find((f: any) => f.type === 'player');
    const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
    if (pFleet) pFleet.formation = this.deployFormation;
    this.updateDeployText();
    this.planAiFactionsForDeploy();              // 调用点②-A（本分支唯一）
    this.publishSupremeCommanderPanel();         // 调用点②-B（本分支唯一）
}
```

**逐支进入条件与副作用（表）**：

| 支 | 进入条件 | 副作用 | 覆盖的运行场景 |
|:--:|----------|--------|---------------|
| ① 观战/无玩家 | `!hasPlayer` | `warRoomOpen=true`(指挥制) · 调 A/B · `return`（**不暂停、不置 `deployPhase`/`battleDeployPhase`**） | 纯观战、调试、任何"没有 `type==='player'` 阵营"的局 |
| ② 有玩家 | `hasPlayer`（**不看 `simMode`**） | `deployPhase=true` · `isPaused=true` · `battleDeployPhase=true` · `warRoomOpen=true`(指挥制) · 中央菜单 · 调 A/B | **战役 / 对战（行为不变）+ 演习（本批新增）** |

### 1.3 调用次数与位置的结论（**避免双重调用**）

> **结论：改造后 `planAiFactionsForDeploy()` 与 `publishSupremeCommanderPanel()` 各被调用恰好一次。**

- 现状：两分支**互斥**（早退支 `return`），A/B 在两支各写一份 —— 任一局只走一支 ⇒ **本来就只有 1 次**。
- 改造后：分支①（`!hasPlayer`，`return`）与分支②互斥，A/B **各留在自己的分支内** ⇒ **仍只有 1 次**。
- **红线（务必写进实现注释）**：**不得**把 A/B 提到 `if (!hasPlayer)` 之前统一调用——那样分支②会再调一次，造成**双重调用**（`planFactionBattle` 会重写 `fleet.mission`；`publishSupremeCommanderPanel` 会重刷候选镜像，且两次之间若 `warRoomOpen` 已置真会造成不必要的重复广播）。
- **次要清理项**：`const isCampaign = …` 在 `activateDeployPhase` 内**当前未被使用**（死变量）。改造时**删除或复用它**（若采纳 §1.4 备选"仅指挥制加暂停"，可用 `mapStyle==='command'` 代替，无需 `isCampaign`）。

### 1.4 非指挥制演习（`hex/crt/3d`）的处理——**给明确的取舍**

改造后，**非指挥制演习（hex/crt/3d）也会进入真暂停 + 中央菜单**。判断如下：

| 选项 | 内容 | 取舍 |
|:--:|------|------|
| **B1（推荐）· 统一加暂停** | 所有"有玩家"的局（含 hex/crt/3d 演习）都进部署窗口 | 分支最简（只有一道门）；中央菜单是 Phaser 层文本、**与 `mapStyle` 无关**，hex/crt/3d/command 都能画；行为一致，回归面小。**代价**：2D/3D 非指挥制演习新增一次暂停——但 `crt/hex` 是残留层、`3d` 与指挥制同属 3D 覆盖层，影响可接受 |
| **B2 · 仅指挥制加暂停** | 分支②条件再加 `&& this.mapStyle === 'command'`；非指挥制演习维持"不暂停" | 只在用户实际抱怨的指挥制上生效，**最保守**；代价 = 分支多一个条件、两模式行为再度分叉（与 `18` §2.4「两模式同一机制」的取向相反） |

> **推荐 B1**：① 用户诉求是"**演习**也要拿到部署窗口"，未限定指挥制；② 中央菜单天然与 `mapStyle` 解耦，B1 无需额外代码；③ `18` §2.4 的设计取向是"两模式同一机制，只差一个仪式窗口"——B1 正是该取向的落地。**若 JM 只想要指挥制，改选 B2（一行条件）。**

### 1.5 影响文件清单（供工程侧排期）

| 文件（内容锚点） | 改动 |
|------|------|
| `BattleScene.ts` · `activateDeployPhase()` | 早退条件去掉 `this.store.simMode`；删除死变量 `isCampaign`；A/B 保持在各自分支内 |
| `BattleScene.ts` · `updateDeployText()` | 菜单文案（见 §3 最终版） |
| `BattleScene.ts` · `update()` 的 SPACE 探测 | 加 `!this.deployPhase` 守卫（见 §5 漏洞 H1） |
| `BattleScene.ts` · `startBattleAfterDeploy()` | 若采纳 §3「旗舰开局姿态」：写 `pFleet.stance`；若采纳 §2 倒计时：清倒计时定时器 |
| `CouncilWarRoom.vue` | 仅文案同步（§4 hint）——**`battleDeployPhase=true` 后其余交互自动生效，无需改逻辑** |
| `gameStore.ts` | 无（`battleDeployPhase` / `supremeCommanderOverrideId` / `warRoomOpen` 字段均已存在） |

> **本批零改动的既有基建**：中央菜单（`updateDeployText`）、回车开战（`startBattleAfterDeploy`）、军议战前态（`canReassignMission(rank, true)===true`）、总指挥确认卡（`publishSupremeCommanderPanel`）、AI 战前计划（`planAiFactionsForDeploy`）**全部已存在**——本方案本质是**接一根断了的线**，不是新建系统。

---

## 2. §2 演习的体验节奏设计（核心策划判断）

### 2.1 冲突陈述

演习定位 = **快速开打、练手**（`18` §2.4：「演习要快进快出」）；而 JM 本轮拍板 A = **真暂停 + 必须决策**。**前者怕打断节奏，后者要仪式窗口。** 二者需要一个显式的调和设计，否则会把"看不见界面"的抱怨换成"每次都要点一下"的抱怨。

**要量化的成本**：A（字面版）下，**每次开局多一次"读菜单 + 回车"**。观测口径 = 阅读中央菜单（约 4 行文本）+ 决策阵型 + 按回车 ≈ **2–5 秒/局**；对"反复开同一局练手"的玩家，摩擦随开局次数线性累加，且**没有任何"我这次不决策"的出口**。

### 2.2 三个体验方案对比

| 方案 | 默认停在哪 | 决策时间 | 一键跳过 | 到期默认行为 | 与 JM 拍板 |
|:--:|------------|----------|----------|--------------|:--:|
| **A1 · 全等战役** | 开局即暂停，中央菜单 | 无限（等玩家） | 仅「回车」 | — | ✅ 完全忠实 |
| **A2 · 精简 + 倒计时（推荐）** | 开局即暂停，中央菜单 + 倒计时 | **20 秒**（悬停军议面板时暂停计时） | 「回车」立即开战；**或等倒计时** | **以当前选择自动开战** | ✅ A + 一层保险 |
| **A3 · 不暂停 + 强制聚焦军议** | 不暂停，军议常驻 | 实时（无窗口） | 无需 | — | ❌ 与 A 冲突（且现状已证伪） |

**各方案取舍**：

- **A1**：实现最省（零新增状态机），与战役**完全同构**、最易解释。**缺点**：把"快速练手"拖成"每次多一步"，且没有"我不决策"的出路——**对演习定位不友好**。
- **A3**：零摩擦，但**直接违背本轮 JM 拍板**，且「不暂停也看不到界面」正是用户抱怨的现状病根（`18` §2.4 已记录 v2/v3 两次补救）；**不采纳**。
- **A2**：**在 A 的骨架内加一层"自动放行"**——想决策的人有完整窗口（真暂停 + 菜单 + 军议战前态），不想决策的人**什么都不做也会自动开战**，摩擦归零。代价 = 一个 20s 定时器 + 到期清理 + （可选）悬停暂停计时。

### 2.3 推荐：A2（细化到可实现）

| 项 | 规则 |
|----|------|
| **默认** | 进入部署后**立即暂停**，中央菜单 + 军议面板同时可见（同 A） |
| **决策时间** | **20 秒**倒计时；**鼠标悬停在军议面板上时倒计时暂停**（避免"正改任务时被打断"） |
| **到期行为** | **自动开战**：等价于调用 `startBattleAfterDeploy()`，采用**玩家当前已选**的阵型/姿态与**已下达**的任务（未动则用默认：楔形阵 · 稳守） |
| **一键开战** | **`回车`** 立即开战（与 JM 拍板一致） |
| **无额外跳过键** | **不新增"跳过键"**——`空格` 已被指挥点面板占用（见 §5 漏洞 H1），`Esc` 已用于取消选中；"跳过"的出口就是"回车"或"什么都不做等 20s" |
| **倒计时显示** | 中央菜单末行 + 军议战前 hint（§4）**同步显示剩余秒数**（单一数据源，避免两处不一致） |
| **作用范围** | **仅演习（`simMode`）启用倒计时**；**战役保持 A1（无限等待）**——战役是"认真开作战会议"的仪式窗口（`18` §2.4），不该被倒计时催 |

> **降级开关**：若 JM 只要字面 A（不想要倒计时），把倒计时时长视为 `Infinity`（或去掉定时器）即退回 A1——**同一份分支，只是时长参数不同**。

### 2.4 为什么倒计时不"违背" JM 的拍板

JM 拍板的原话口径是"**真暂停 + 中央部署菜单 + 回车开战**"——A2 **完整保留**这三件事（暂停、菜单、回车可用）；倒计时只是在"玩家不做任何操作"时**替玩家按了一次回车**。它把"强制决策"变成"可选的决策窗口"，是**加强**而非削弱 A 的意图。**建议 §2 定稿前请 JM 确认一次"20s 自动开战"是否可接受**（这是 A2 相对 A 的唯一新增项）。

---

## 3. §3 中央部署菜单的内容适配

### 3.1 阵型口径核对（以 `getFormationCnName` 为准）

`private getFormationCnName(form: string)`（BS 快照 `:2432`）返回值：

| 按键 | 内部键 | **中文名（代码真源）** |
|:--:|:--:|:--:|
| `1` | `wedge` | **楔形阵** |
| `2` | `line` | **横阵** |
| `3` | `spindle` | **纺锤阵** |
| `4` | `circle` | **圆形阵** |
| `5` | `square` | **方阵** |

> ⚠ **勘误提示**：任务简报里写的「楔形/战列/纺锤/圆阵/…」与代码真源**不一致**。**以 `getFormationCnName` 的返回为准**（`横阵` 而非 `战列`；`圆形阵` 而非 `圆阵`；`方阵` 为第 5 项）。菜单文案请直接用上表中文名。按键映射来源：键盘处理里 `const formName = { '1':'wedge','2':'line','3':'spindle','4':'circle','5':'square' }`。

### 3.2 核心判断：「战术指令（突袭/合围/稳守）」现在是**死项**

**事实链（内容锚点）**：

1. `updateDeployText()` 末尾注释明确写：`[V18-A · F2 去镜像] 指令卡不再镜像写入 AI 阵营的 _deployTactic`；消费侧 `deployAdj` 保留，但 **AI 阵营 `_deployTactic` 永不被写 → 恒取默认值**。
2. 唯一消费点 `deployAdj`（锚 `const deployAdj = aiFac._deployTactic === 'aggressive' ? 0.85 …`）读的是 **`aiFac._deployTactic`**——该字段**全仓无写入点**。
3. `this.deployTactic`（BS 私有字段）全仓写入点只有键盘 `T` 键切换，**读取点只有 `updateDeployText` 的标签拼接**——**从未写进任何舰队**。

⇒ **结论：该指令卡对 AI 无效果（F2 去镜像）、对玩家自身舰队也无写入点（无消费侧）——语义上等于"只改了一个显示文字"。** 把它原样保留在演习菜单里 = **让玩家按一个"没有效果"的选项做决策 = 假信息**（与 `15` §2f 已确立的「信息真实性」纪律同源）。

### 3.3 建议（本批给出明确取舍）

| 选项 | 做法 | 成本 | 落在本批？ | 评价 |
|:--:|------|:--:|:--:|------|
| **R1（推荐）· 替换为「旗舰开局姿态」** | 把「突袭/合围/稳守」从"死指令卡"改为**玩家旗舰的开局姿态**，开战时写 `pFleet.stance`：突袭→`siege`(攻坚推进) · 合围→`search`(索敌推进) · 稳守→`defend`(驻守警戒) | **小**（`startBattleAfterDeploy` / `activateDeployPhase` 内约 5–8 行） | ✅ | **让这个窗口第一次有"真实决策"**；旗舰无 mission（军议面板显示"直接指挥中"）⇒ 与军议的初始任务**零冲突**（姿态 vs 任务分工不重叠） |
| **R2（最小改备选）· 直接删除该项** | 菜单只留「阵型 + 开战」 | **零** | ✅ | **诚实止血**（同 `15` §2f "先删文案保信息真实"）；代价 = 菜单更薄（但演习"快速"定位下反而更清爽） |
| R3 · 原样保留 | 不动 | 零 | — | ❌ **不采纳**：保留死项 = 假信息 |
| R4 · 接线旧机制（让指令卡真的影响 AI） | 恢复 F2 之前的镜像 | 中 | ❌ | ❌ **与 JM 已裁定的 F2「不再镜像」直接冲突**（`17` r3 / `18` §2.1） |

> **推荐 R1**（理由：JM 本轮的核心诉求是"这个窗口**有用**"——R1 让菜单里的每个选项都真正影响战局；R2 更省但不增加价值）。**R1 的姿态映射与现有 `stance` 枚举完全对齐，不新增机制**；不写 `_userStanceLockUntil`（开局初值，无需锁）。

### 3.4 菜单文案最终建议版（中文 · 含按键提示 · 与仓库口径一致）

**推荐版（采纳 R1 + §2 的 A2 倒计时）**：

```
◤ 战前部署 ◢

  初始阵型：楔形阵          [1-5 切换]
    1 楔形阵 · 2 横阵 · 3 纺锤阵 · 4 圆形阵 · 5 方阵
  旗舰开局姿态：稳守        [T 切换]
    突袭：旗舰开局压上接敌（攻坚）
    合围：旗舰开局分散索敌（索敌）
    稳守：旗舰开局驻守待机（驻守）

  右侧「军议」为各舰队分配初始任务 · 确认总指挥

  [回车] 立即开战          20 秒后自动开战
```

**说明**：
- 第 2 行的五阵型一览把 `[1-5]` 的映射直接列出，**消除"按键对应哪个阵"的记忆负担**（现有菜单只有"初始阵型：X [1-5 切换]"一行，玩家不知道 1–5 各是什么）。
- 「旗舰开局姿态」标题 + 选项后的（攻坚/索敌/驻守）**标注真实效果**，兑现 `15` §2f 的"信息真实性"。
- 末行 `[回车] 立即开战` **保留 JM 拍板口径**；`20 秒后自动开战` 为演习专属（战役不显示此行，见 §2.3）。
- **指挥制专属行**「右侧军议…」建议在 `mapStyle==='command'` 时才显示（非指挥制无该面板，显示会造成"找不到面板"的新困惑）——需在 `updateDeployText` 里按 `mapStyle` 拼行（小改）。

**最小改备选版（采纳 R2，删死项）**：

```
◤ 战前部署 ◢
  初始阵型：楔形阵    [1-5 切换]
    1 楔形阵 · 2 横阵 · 3 纺锤阵 · 4 圆形阵 · 5 方阵
  [回车] 立即开战
```

---

## 4. §4 军议面板战前态（`battleDeployPhase = true` 之后）

### 4.1 会被新激活的交互（逐项）

`CouncilWarRoom.vue` 的 `deployPhase = computed(store.battleDeployPhase)`（锚 `const deployPhase = computed<boolean>(() => unwrap<boolean>(store.battleDeployPhase))`）。置真后：

| # | 模板锚点 | 从无到有的交互 | 生效机制 |
|:--:|----------|----------------|----------|
| **I1** | `wr-supreme-actions`（`v-if="deployPhase"`） | 总指挥卡的动作区出现：候选下拉 + **[确认]** + **[换人]** | `confirmSupreme()` 写 `supremeCommanderOverrideId = supremeId`；`swapSupreme()` 写 `supremeCommanderOverrideId = next.id` 且 `supremeCommanderId = next.id` |
| **I2** | `wr-hint`（`v-if="deployPhase"`） | 顶部 hint 切到「战前军议：为各舰队分配初始任务，回车开战」 | 纯文案（**§2 若采纳倒计时需同步**，见 §4.4） |
| **I3** | `v-else-if="canReassign(fac)"` + `wr-form` | **全员可改派**：每支非旗舰己方舰队出现「任务类型 + 目标 + [下达]」表单，**不再受 `rank ≥ 8` 限制** | `canReassign = canReassignMission(fac.rank, deployPhase)`；`canReassignMission(rank, true) === true`（`deployPhase` 为真时短路返回 true） |
| **I4** | `v-if="fac.id === supremeId"` → 「直接指挥中」 | **不变**（旗舰仍无任务表单） | `v-if` 优先于 `v-else-if`，旗舰保持锁定 |

> **`ownFactions` 列表不变**（锚 `factions.filter(f => f.team === 1 && f.active)`）——演习下即"玩家旗舰 + 玩家选中的其余提督舰队（`type:'ai'`，`team:1`）"。

### 4.2 `swapSupreme` 的两次写入是否会被 `computeSupremeCommander()` 覆盖？

> **结论：不会被覆盖。玩家在战前态选的「换人」结果会原样带进战斗。**

**证据链**：
1. `startBattleAfterDeploy()` 在开战时调用 `this.computeSupremeCommander()`（锚 `computeSupremeCommander();`）。
2. `computeSupremeCommander()` 的判定优先级（锚 `const override = (this.store as any).supremeCommanderOverrideId;` → `if (typeof override === 'number' && override >= 0) { supremeId = override; }`）：
   **`override`（玩家本场指定）> 非战役分支的 `dispatchAdmirals[0]` > 战役分支的自动选举**。
3. 因 `swapSupreme()` 把 `supremeCommanderOverrideId` 写成了 `next.id`（数值），开战时 `computeSupremeCommander()` **走 override 分支** ⇒ 玩家指定的总指挥**被保留**。
4. 演习（非战役）下 `dispatchAdmirals[0]` 是"编成面板第一格"（`18` §3.1）；override 优先级高于它 ⇒ **演习的"换人"同样有效**，与战役口径一致。

**两处细节（建议在实现注释中留痕）**：
- `swapSupreme()` 里写 `supremeCommanderId = next.id` 是**UI 侧乐观镜像**（让面板立刻高亮新总指挥）；其**权威值**由开战时的 `computeSupremeCommander()` 重算落定。即便镜像与权威短暂不一致，开战后以权威为准，**不会产生"面板说 A、战场是 B"的持久错位**。
- **[确认] 与 [换人] 的语义差异**：`confirmSupreme()` **只写 override**（= "认同当前自动选出的总指挥"）；`swapSupreme()` 写 override + mirror。二者都落在 override 通道 ⇒ **优先级口径统一**。
- **不可用候选**（`commanderId == null`）在 `publishSupremeCommanderPanel()` 里标 `disabled: cid == null || !adm`，`swapSupreme()` 会拒绝（`if (!next || next.disabled) return`）⇒ **不会把总指挥指到"无指挥官"的舰队**。

### 4.3 演习下候选卡是否有数据？（前置确认）

`publishSupremeCommanderPanel()` 仅 `mapStyle==='command'` 时构建候选，候选来自 `this.globalFleets` 中 `fac.team === 1` 的 `fl.commanderId`。演习舰队由 `spawnInitialFleets()`（BS 快照 `:375` 调用）创建，`commanderId: fac.id`（锚 `commanderId: fac.id`）⇒ **演习舰队带 `commanderId`，候选卡有数据**，`[确认]/[换人]` 可用。（对照：`18` §3.3.1 G6 的"mock 舰队无 commanderId"仅影响 `debugForceBattle` 调试路径，不影响演习/对战/战役正式路径。）

### 4.4 hint 文案是否需按 §2 改？

> **需要。** 现 hint（锚 `wr-hint` 的 `deployPhase` 分支）是「战前军议：为各舰队分配初始任务，回车开战」。

- **若采纳 §2 的 A2（推荐）**：改为 **「战前军议：为各舰队分配初始任务 · 回车开战（20 秒后自动开战）」**，其中秒数与中央菜单**同源**（同一个倒计时变量），避免两处倒计时读数打架。
- **若采纳 A1（字面版）**：hint 保持原样即可。
- **悬停暂停倒计时时**，hint 可显示「（已暂停计时）」，给玩家"我正在操作、不会被催"的确定感。

---

## 5. §5 `deployPhase` 守卫语义复核

### 5.1 逐处复核

| # | 守卫（内容锚点 · 快照行号） | 作用 | 演习进入部署期后语义是否仍正确 | 判定 |
|:--:|------|------|------|:--:|
| **G1** | `handleTileClick()` 首行 `if (pointer.getDistance() > 30 \|\| this.store.gameOver \|\| this.store.isPaused) return;`（`:3465`） | 暂停/拖拽期间不处理地块点击 | 部署期 `isPaused=true` ⇒ **右键 move / 投放信标 / 买地 全部被此守卫拦下**（**注意：拦它的是 `isPaused`，不是 `deployPhase`**） | ✅ 正确 |
| **G2** | 2D 左键选舰队 `if ((mapStyle==='hex'\|\|mapStyle==='crt') && !this.cpCommandMode && !this.deployPhase)`（`:3514`） | hex/crt 下左键选中舰队 | 非指挥制演习进部署 ⇒ `deployPhase=true` ⇒ 跳过选中（部署期不选舰队，符合语义）。指挥制 `mapStyle==='command'` ⇒ **该支本就永不进入** | ✅ 正确 |
| **G3** | `B3D` 左键选舰队 `if (button === 0 && !(this.battleScene as any).deployPhase)`（`B3D:5050`） | 3D 层左键拾取己方舰队 | 指挥制演习进部署 ⇒ `deployPhase=true` ⇒ 3D 左键选舰队禁用（与 G2 一致） | ✅ 正确 |
| **G4** | `updateScriptPhase()` 首行 `if (this.store.gameOver \|\| this.store.isPaused \|\| this.deployPhase) return;`（`:2561`） | 剧本阶段推进 | 部署期不推进剧本（不该在"战前"就报"主力接触"） | ✅ 正确 |
| **G5** | `updateReinforcement()` 首行 `if (this.store.gameOver \|\| this.store.isPaused \|\| this.deployPhase) return;`（`:2604`） | 每 90s 增援 | 部署期不给增援 | ✅ 正确 |
| **G6** | 键盘部署块 `if (this.deployPhase) { … 1-5 / T / 回车 … return; }`（`:463`） | 部署期键位独占 | 部署期 `1-5`=选阵型、`T`=切指令卡、`回车`=开战；其余按键被 `return` 吞掉（**注意：吞的是通过 `keydown` 注册的键；`SPACE` 不在此列，见 H1**） | ✅ 正确 |
| **G7** | `Esc` 处理器 `this.input.keyboard!.on('keydown-ESC', …)`（`:441`） | 取消选目标态 / 清选中 | 部署期无选中、无选目标态 ⇒ `Esc` 走"清选中"空分支（**无副作用**） | ✅ 无害 |

### 5.2 ⚠ 发现 1 处守卫漏洞（**建议本批一并修，1 行**）

> **H1 · SPACE 在部署期会叠开指挥点面板（阻塞性问题）**

- **机制**：`update()` 内的 `SPACE` 探测 `if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey)) { … openCommandPanel() … }`（`:3594`）**位于 `if (this.store.isPaused) { … return; }`（`:3603`）之前**，且**不含 `deployPhase` 守卫**。`openCommandPanel()`（`:2672`）自身也不查 `deployPhase`。
- **后果**：部署期（`isPaused=true`）按 `SPACE` → 在**中央部署菜单之上**叠开指挥点命令面板，造成"两个暂停界面叠层"，玩家可在此面板里下达 11 个临战命令——**这既破坏"战前"语义，也让部署菜单被遮挡**。
- **严重度**：🔴 **阻塞**——它是"部署期会不会被别的暂停界面抢焦点"的确定性问题，且**现有战役部署期同样存在**（本批把演习也纳入部署后，暴露面扩大）。
- **缓解（二选一，均可，成本 1 行）**：
  - (a) 在 `update()` 的 SPACE 分支加 `&& !this.deployPhase`；
  - (b) 在 `openCommandPanel()` 首行加 `if (this.deployPhase) return;`（**推荐 (b)**——把"部署期不开放指挥点面板"这条规则收敛在开口处，一处生效、不留旁路）。

### 5.3 交互闭环是否自洽？（关键问题）

**问**：部署期禁用了「3D/2D 左键选舰队」与「右键 move/信标」，那么在一个暂停窗口里，玩家还能做什么？闭环自洽吗？

**答：指挥制下自洽。** 部署期玩家的可用动词 = 三条并行通道：

| 通道 | 动词 | 是否可达 |
|------|------|:--:|
| **键盘** | `1-5` 选初始阵型 · `T` 切旗舰开局姿态（§3 R1）· `回车` 立即开战 | ✅ |
| **军议 DOM 面板** | 为各舰队下达/改派初始任务 · 确认/更换总指挥 | ✅（DOM 层，不受 Phaser `isPaused` 影响，见 §4） |
| **相机** | 平移（`pointermove`+`isDown`）· 缩放（`wheel`） | ✅（两处均**未**被 `isPaused` 拦截） |

⇒ **"战前决策"的兑现路径是完整的**：阵型、姿态、任务、总指挥——四类决策全在部署窗口内可达；**它们都不需要"先选中舰队再操作"**，所以 G2/G3 禁用"左键选舰队"不打断闭环。

**唯一被 G1 挡掉的能力是"把旗舰挪到指定位置"。** 判断：

- 这是**既有局限**（**战役部署期同样不能挪位**，不是演习新增的割裂）；
- 补它 = `15` §3 方向 1「**战前布阵盘**」（中成本、需 `spawnStrategicFleets.deploySide` 从"每侧一个坐标"扩为"逐队坐标"）——**属玩法变更，不在本批**；
- **建议**：在中央菜单/军议 hint 里**不承诺**"可移动舰队"，避免玩家反复尝试点选（否则会撞上 G1/G2/G3 的"点了没反应"）。**登记为后续独立项（见 §6 不做清单）**。

**非指挥制演习（`hex/crt/3d`，若采纳 §1.4 B1）**：部署期只有"键盘 + 相机"两通道（无军议面板），闭环更薄但**仍成立**（选阵型/姿态 → 回车/等自动开战）。若 JM 认为 2D 演习不值得这次暂停，改选 §1.4 B2。

---

## 6. §6 边界与不做 + 风险清单

### 6.1 本批**不做**（含理由与后续归属）

| # | 不做项 | 理由 | 后续归属 |
|:--:|------|------|------|
| N1 | **部署期"右键把旗舰挪到指定位置"** | = 战前布阵盘（`15` §3 方向 1），需逐队坐标数据流，属玩法变更 | 独立立项（`15` P6 / 方向 1） |
| N2 | **改 AI 规划层**（`planFactionBattle` / 重规划） | 本方案**复用**现成 `planAiFactionsForDeploy()`，零改动 | `17` / `18` 既有批次 |
| N3 | **战役侧任何行为改动** | 战役早已走部署分支；本批只把演习接入，**战役应零变化**（回归判据见 §6.3） | — |
| N4 | **"倒计时"以外的节奏改造**（如"关键节点自动减速""部署期可播放 BGM 切换"） | 超出本批；倒计时已足以消摩擦 | 视觉/音频侧另议 |
| N5 | **3D 覆盖层 / 渲染改动** | 中央菜单是 Phaser 层文本，与 3D 覆盖层解耦 | — |
| N6 | **`15` 其余方向（真实化通路 / 临场指令 / 后勤战）** | 与本方案正交，不合并 | `15` 各方向独立排期 |
| N7 | **"旗舰开局姿态"之外的新增菜单项** | 避免把战前窗口做成第二个军议面板（认知过载红线） | — |

### 6.2 已知风险与缓解（5 条）

| # | 风险 | 等级 | 缓解 |
|:--:|------|:--:|------|
| **R1** | **A/B 双重调用**：改造时若把 `planAiFactionsForDeploy()` / `publishSupremeCommanderPanel()` 上提出分支，会二次写入 `fleet.mission` / 候选镜像 | 🔴 高（隐蔽） | 严格按 §1.2 伪代码：A/B **各留在互斥分支内**；评审时以"两分支各一次"为验收点 |
| **R2** | **SPACE 叠开指挥点面板**（漏洞 H1） | 🔴 高 | `openCommandPanel()` 首行加 `if (this.deployPhase) return;`（§5.2） |
| **R3** | **非指挥制演习被新增暂停**（若采纳 §1.4 B1） | 🟡 中 | 若 JM 只想要指挥制：改选 §1.4 B2（分支②加 `&& mapStyle==='command'`，一行） |
| **R4** | **倒计时打断军议操作**（若采纳 §2 A2） | 🟡 中 | 悬停军议面板即暂停计时（§2.3）；时长取 20s 留足余量 |
| **R5** | **`battleDeployPhase` 残留为 true**（异常退出/未走 `startBattleAfterDeploy`） | 🟢 低 | 开战路径已清 `battleDeployPhase=false`；建议在 `create()` 起始（已有清 `supremeCommanderOverrideId=null` 之处）**并清一次 `battleDeployPhase=false` / `deployPhase=false`**，双保险 |

### 6.3 验收判据（建议工程侧照此验收）

1. **演习（指挥制）开局**：截图可见**中央「◤ 战前部署 ◢」菜单**，且军议面板 hint 为战前口径、总指挥卡出现 `[确认]/[换人]`、全员行出现任务表单。
2. **回车** → 战斗立即开始（`isPaused=false`、`battleDeployPhase=false`、菜单销毁）。
3. **（若 A2）静置 20s** → 自动开战，采用当前选择（默认楔形阵 · 稳守）。
4. **战役回归**：战役部署窗口行为与改动前**逐像素一致**（本批不应改战役）。
5. **对战回归**：`hasPlayer` 对战仍进部署窗口，行为不变。
6. **观战/无玩家回归**：仍**不暂停**，仅展开军议 + 生成 AI 计划。
7. **调用计数**（可加临时日志）：任一局 `planAiFactionsForDeploy` / `publishSupremeCommanderPanel` 各执行 **1 次**。
8. **H1 修复验证**：部署期按 `SPACE` **不**打开指挥点面板。
9. `tsc` EXIT=0；战斗数值路径 hunk 为空。

### 6.4 待用户（JM）确认项

- **Q-A**：§2 推荐 **A2**（追加"20s 倒计时自动开战"）是否接受？若否，退回字面 **A1**（无限等待，仅回车）。
- **Q-B**：§1.4 非指挥制演习（`hex/crt/3d`）是否也要暂停？推荐 **B1（统一加）**；若要保守改 **B2**。
- **Q-C**：§3 死项处置：推荐 **R1（替换为「旗舰开局姿态」）**；若求最小改选 **R2（删除）**。

---

## 附 A · 读取快照与内容锚点

### A.1 快照（`#74` 只读实测）

| 文件 | 字节 | 本文引用锚点 |
|------|---:|------|
| `frontend/src/game/scenes/BattleScene.ts` | 360137 | `activateDeployPhase` / `updateDeployText` / `startBattleAfterDeploy` / `planAiFactionsForDeploy` / `planFactionBattle` / `publishSupremeCommanderPanel` / `computeSupremeCommander` / `getFormationCnName` / 键盘部署块 / `handleTileClick` / `update` SPACE 探测 / `openCommandPanel` |
| `frontend/src/game/three/Battle3DOverlay.ts` | — | `button === 0 && !(this.battleScene as any).deployPhase` |
| `frontend/src/components/battle/CouncilWarRoom.vue` | 10996 | `wr-supreme-actions` / `wr-hint` / `canReassign` / `swapSupreme` / `confirmSupreme` |
| `frontend/src/game/TacticalCommandSystem.ts` | 6677 | `canReassignMission` / `REASSIGN_MIN_RANK` / `PLAN_ROLE_LABEL` |
| `frontend/src/store/gameStore.ts` | — | `launchSimBattle` / `enterSimMode` / `battleDeployPhase` / `supremeCommanderOverrideId` / `warRoomOpen` |

> **行号漂移声明**：上表行号为**快照值**，工程侧改动后请以「内容锚点」检索定位（与 `17`/`18` 既有约定一致）。

### A.2 关键锚点速查（检索用内容串）

| 论断 | 内容锚点 |
|------|----------|
| 演习早退门 | `if (this.store.simMode || !hasPlayer) {` |
| 部署置真 | `this.deployPhase = true;` / `this.store.isPaused = true;` / `(this.store as any).battleDeployPhase = true;` |
| 中央菜单文本 | `◤ 战前部署 ◢` |
| 战前态 hint | `战前军议：为各舰队分配初始任务，回车开战` |
| 指令卡死项证据 | `[V18-A · F2 去镜像] 指令卡不再镜像写入 AI 阵营的 _deployTactic` |
| 指令卡唯一消费侧 | `const deployAdj = aiFac._deployTactic === 'aggressive' ? 0.85` |
| override 优先级 | `if (typeof override === 'number' && override >= 0) { supremeId = override; }` |
| 换人写点 | `(store as any).supremeCommanderOverrideId = next.id;` |
| 全员可改派 | `if (deployPhase) return true;`（`canReassignMission`） |
| 右键被暂停拦 | `if (pointer.getDistance() > 30 \|\| this.store.gameOver \|\| this.store.isPaused) return;` |
| 2D 左键选舰队守卫 | `&& !this.cpCommandMode && !this.deployPhase)` |
| 3D 左键选舰队守卫 | `if (button === 0 && !(this.battleScene as any).deployPhase) {` |
| 剧本/增援守卫 | `if (this.store.gameOver \|\| this.store.isPaused \|\| this.deployPhase) return;` |
| 部署期键位块 | `if (this.deployPhase) {` … `return; // 部署阶段屏蔽其他按键` |
| **漏洞 H1** | `if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {`（在 `if (this.store.isPaused) {` 之前） |
| 演习舰队 commanderId | `commanderId: fac.id, flagshipName:`（`spawnInitialFleets`） |
| 演习首位=玩家 | `type: index === 0 ? 'player' : 'ai', team: 1,` |

### A.3 引用文档

| 文档 | 用途 |
|------|------|
| `docs/design/3d-tactical-battle/18-preplan-council-command.md` | §1.0 术语、§2.4 演习 vs 战役、§2.5 #58、§2.6 盟友定位、§3.1 总指挥来源 |
| `docs/design/3d-tactical-battle/17-ai-battle-planning-options.md` | §2.2 接入点表（`activateDeployPhase`）、F2 决策 |
| `docs/design/3d-tactical-battle/15-battle-tactics-review.md` | §3 方向 1 布阵盘、§2f 信息真实性纪律 |

### A.4 本文边界声明

1. **只做方案设计**，**未修改任何 `frontend/src/**`、未改 `.vue`、未修改他人文档、未起 dev server、未跑 `wails build`、无 git 写操作**。
2. 行号以**内容锚点**为准，快照行号仅供检索。
3. 成本/摩擦为**定性 + 量级判断**，非工时承诺。
4. 未使用"最先进 / 唯一 / 第一"类表述。
