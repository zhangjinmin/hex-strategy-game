# 可玩性冲刺（W1~W5）评审台账

日期：2026-10-15。范围：提交 `69e964a`（W1-W4）、`85e6aff`（W5）。
流程：**多人做 → 反对（红队）→ 测试（审核）→ 总审核（lead）**。

---

## 1. 红队结论（Explore-1）：**已证伪**（两处）

### 1.1 ★★ 台架无牙齿（最要害）

`scripts/fleetAutonomySim.cjs` 的 **24 条断言全部是源码字符串匹配**（`block.includes(...)`），
**不做任何决策链模拟** ⇒ 5 项核心 W3 修复**可被静默回退而台架全绿**：

| 变异 | 期望 | 实测 |
|---|---|---|
| `HOLD_POINT_MAX_MS = 25000` → `999999999999`（超时永不触发） | FAIL | **24/24 PASS** ❌ |
| `patrolRadius: Math.max(120, …)` → `0`（退回原地死守） | FAIL | **24/24 PASS** ❌ |
| 看门狗条件追加 `&& false`（自愈恒不执行） | FAIL | **24/24 PASS** ❌ |
| 广播 `fl.mission = mm` → 只给 `facFleets[0]`（退回只命中首支） | FAIL | **24/24 PASS** ❌ |
| W3.4 条件插入 `&& false`（默认任务恒不派） | FAIL | **24/24 PASS** ❌ |

**⇒ 复现了 P1 红队抓过的"自证"缺陷**：`block.includes('HOLD_POINT_MAX_MS')` 是
"拿实现字符串匹配实现字符串"= `f(x)===f(x)` —— 只对"整段删除"敏感，对**语义/取值/行为完全不敏感**。

⚠ 且 `34` 号定稿 §3 明确要求它"**用纯函数模拟决策链**"，成品却是源码契约匹配 ⇒ **实现未达定稿要求**。

**公平记录**：`shipKinematicsSim.cjs` 新增的 ramp 上界断言**有牙齿**（变异 `战列 accel 0.00042→0.00021`
⇒ `34 PASS / 2 FAIL`，退出码 1）✅

### 1.2 ★ 用户可见的回归：唯一的可见部署界面仍在说"自动开战"

- `frontend/src/components/battle/BattleIntroOverlay.vue:154-156` 的 `cdLine` 仍渲染「**N 秒后自动开战**」
- 但 **W4.1 已取消自动开战** ⇒ W4.1 只改了**不可见的** Phaser `updateDeployText`（`BattleScene:1221`）
  与 `GameFooter`，**漏改了唯一可见的全屏层**
- ⇒ 用户看到"20 秒后自动开战"、实际不自动开战 ⇒ **这正是"流程乱"**

### 1.3 ★ 部署期横幅被遮挡

`BattleBanner` z-index **40** < `BattleIntroOverlay` z-index **60**（`BattleIntroOverlay.vue:314`）
⇒ W4.3 的两个部署期横幅（「战前部署」`BattleScene:1158` /「部署时间到」`:1190`）
恰在部署层打开时触发 ⇒ **看不见**。（阶段①与"时间到"两条不可见）

### 1.4 「固守战区」只守 25s（W3.2 误伤玩家明令）

`hold_point` 若**没有** `patrolRadius` ⇒ 走 W3.2 的 25s 超时自动放弃。
而玩家在军议面板下的"固守"正是**无 patrolRadius** 的 `hold_point`
⇒ **玩家明令"固守战区"却只守 25 秒**。W3.2 本为 AI 自动驻守设计，误伤了玩家命令。

### 1.5 战前「N 艘」与战场实体差约 100×

`simShipTotalFor` = 兵力总量（`MIL_RANK_TOTAL`，5000~21000），
而战场实际建舰 = `round(总量 / K_VISUAL=100)` 且上限 200
⇒ 面板显示"8000 艘"实际只画 **80 个实体**。此坑**早于 W2**（非本次回归）。

### 1.6 其它（无法证伪 / 公平记录）

| 项 | 结论 |
|---|---|
| W3.1 看门狗对玩家同样生效、不覆盖直接指令 | ✅ 成立 |
| W3.4 五重护栏 | ✅ 成立（但**玩家选 search 时本队无条件投入自动攻击**，无"先观战"开关） |
| W3.3 广播 / W3.5 航点重掷 / W3.6 恒等移除 | ✅ 代码正确（但**无台架担保**） |
| 全仓扫描"第二条永久静止路径" | ✅ 未发现 |
| W3.1 的 `objective_pressure` 分支 | ⚠ 对"卡在自己任务目标上"的舰队 **不是自愈**（只是重下同一命令） |
| B7 战斗期横幅可见性 | ✅ 可见（z-index 40 > canvas 0，且 2 条 3D CSS 均不命中） |
| B9 `commandNotice` 链路 | ✅ 完整 |
| C11/C12/C14/C15 | ✅ 无越界、无暴露调试口、零行为变化 |
| D18 ramp 上界断言 | ✅ 有牙齿 |

---

## 2. 必修项（lead 裁决，等审核 + 真机会合后统一修）

| # | 问题 | 处置 |
|---|---|---|
| **R1** | `fleetAutonomySim` 无牙齿 | **重写为"真跑决策链"**（定稿 §3 本就如此要求）：构造"无 mission 舰队 + 敌对在场 + 停滞 12s"输入，断言 `_missionDest` 从 null 变非 null；构造 `hold_point(patrolRadius=0)`，推进 26s 断言 `mission===null`。**并补齐定稿 §3 要求但缺失的 `uiVisibilitySim.cjs`** |
| **R2** | `BattleIntroOverlay.cdLine` 仍说"自动开战" | **立即修文案**（与 W4.1 的新行为一致） |
| **R3** | 部署期横幅被 `BattleIntroOverlay` 遮挡 | **抬 z-index 到 >60**（或部署期不叠加横幅，二选一，实现者给理由） |
| **R4** | 玩家明令"固守"只守 25s | **区分来源**：玩家（军议/姿态）下的 `hold_point` **不受 25s 超时**；只有 AI 自动派的才走超时 |
| **R5** | 战前"N 艘"≠实体数（差 100×） | 记录为已知口径问题；**本轮至少让 UI 文案不误导**（如标注"编制"而非"艘"） |
| **R6** | W5.6 加速度未改（用户"手感差"物理本体） | **待真机结论**再定：若真机确认"移动看不出" ⇒ 必须调；否则维持"读出来"方案 |

---

## 3. 方法论教训（本轮新增）

1. **"源码字符串断言"不是行为断言** —— `block.includes('CONST_NAME')` 只保证"这行还在"，
   不保证"取值/语义/行为正确" ⇒ **任何关键修复的台架必须跑决策链或纯函数**（`f(x)===f(x)` 的变体）
2. **"改了 A，忘了 B"**：W4.1 改了不可见的 Phaser 文案，**漏改唯一可见的 Vue 文案**
   ⇒ 与 P2 的"`:1576` 死代码"同类：**改动一个行为时，必须全仓扫描"同一个语义还有几个出口"**
3. **多出口的语义必须同步**：`deployText`（不可见）/ `GameFooter`（可见）/ `BattleIntroOverlay`（可见）
   ⇒ 三处都描述"部署期倒计时"，改一处必须改三处

---

## 4. 审核方结论（Explore-2）：**通过**

### 4.1 独立复跑
| 项 | 结果 |
|---|---|
| `vue-tsc` | **EXIT=0** |
| 全量台架（带 loader） | **33/33 PASS** |
| `fleetAutonomySim` | 24/24（但它**同意红队**：全是字符串匹配） |
| ⚠ 抖动 | `uiCommandSim` 约 1/50 概率 FAIL（并发大进程时）⇒ 记为**已知 flaky** |

`_run_all_sims.cjs` 的两处缺陷被独立确认（不加载 loader + 把断言名里的"必须 FAIL"当失败）⇒ **不可用作门槛**。

### 4.2 范围核对
- 两提交改动文件**全在 W1~W5 内，无越界**
- **数值正则过滤**（`classType|def|mods|hpMul|atkMul|defMul|engineMul|SHIP_TYPE_HP|SHIP_TYPE_ATK|damage|atkInterval`）⇒ **`+` 行零命中**
- `config/` 下全部数值表（`shipKinematics`/`gameData`/`balance`/`shipScaling`/`admiralDoctrine`）**均未改**

### 4.3 ★ 它做了台架做不到的事：真跑决策链
把 `BattleScene.ts` 的**真** `hold_point` 分支抽出，经 node `stripTypeScriptTypes` 去型后用 `new Function` **真正执行**（**非抄写副本**）：
- 巡逻 `hold_point`（W3.5）：60s 每 tick 复位后执行 ⇒ **从未进入 `defend`**、运动目标离开锚点 ✅
- 无半径 `hold_point`：首 tick 进 defend（复现旧病灶基线）⇒ **≤26s 内超时清 mission 并转 `search`** ✅
- **内存变异**：回退 W3.5（`patrolR` 恒 0）⇒ 巡逻场景被检出 defend；回退 W3.2（超时禁用）⇒ 永不超时 ⇒ **断言非空转** ✅

⇒ **行为正确性由审核方的一次性脚本坐实**；红队指出的 R1 是"**缺少永久回归防线**"，**不是"代码错了"**。

### 4.4 界面可见性
- **全仓 grep 无任何 CSS 命中 `.b3d-bb-layer`** ⇒ 该层不被隐藏 ✅
- `BattleBanner`（z40）为 `.game-screen` 内 3D canvas 的**同级兄弟**且在 3D 之上 ✅
- ⚠ **但**：`BattleBanner` 挂载条件是 `v-if="battle3dReady"`，而 `enter3dMode()`（隐藏画布）**先于** `battle3dReady` 生效 ⇒ 存在"画布已隐、DOM 未挂"窗口 ⇒ **部署期首条横幅（2.2s）有可能整个落在窗口内被漏掉**（与红队 R3 相关，时序需真机确认）

### 4.5 契约核对
- W4.1 `deployAutoStart` 默认 **false**；`startBattleAfterDeploy` 全仓仅 3 个调用点（Enter / 按钮 / 倒计时），倒计时点被门控 ✅
- W5.1 战中 1-5 **无**换阵型；App.vue 速度档加 `inDeployPhase ⇒ return` ⇒ 两条路径验通 ✅
- W3.6 `deployAdj` 恒 1.15 与改前**逐位等价**（`_deployTactic` 全仓无写入点）✅
- W2 同源 13/13 PASS（`milRank` 两式在 11 个取值上全等）✅

### 4.6 审核方存疑点（与红队互补）
1. **`BattleBanner` 挂载窗口**（见 4.4）—— 与红队 R3 交叉，**需真机确认**
2. 玩家显式"驻守"时静止且**无显式警告**（34 号 §2 R5 曾要求 UI 明示）
3. W2「N 艘」= 编制强度 ≠ 3D 实建实体数（**既有语义**，非本次引入）
4. `uiCommandSim` 已知 flaky（~1/50）
5. 真机端到端未跑（它只做源码级/纯函数级）

---

## 6. 审核方增补：交叉验证红队两条 UI 缺陷 + 发现验收缺口（均成立）

### 6.1 缺陷 R2 实锤（W4.1 文案回归，**用户可见**）
- `BattleIntroOverlay.vue:154-156` `cdLine` = `cdSec<0 ? '等待你的命令' : \`${cdSec} 秒后自动开战\``，渲染于 `:13`
- 该组件 `visible = deployPhase && !closed && gameState==='game'`（`:147-148`），`.io-overlay` 是**全屏**层
  ⇒ **这是部署期唯一常显的倒计时文案**
- W4.1 只改了**不可见**的 Phaser `updateDeployText`（`BattleScene:1221`）与 `GameFooter` ⇒ **漏改此处**
- ⇒ 玩家看到「20…0 秒后自动开战」而实际不会开战 —— **承诺与行为直接矛盾**（比"没提示"更糟）

### 6.2 缺陷 R3 实锤（部署期横幅被全屏层遮死）
- `BattleIntroOverlay.vue:314` `.io-overlay{ position:absolute; inset:0; z-index:60 }`，
  背景 `radial-gradient(…rgba(8,18,34,0.94)~0.985)` ⇒ **近乎不透明全覆盖**
- `BattleBanner.vue:46` z-index **40** ⇒ 被 z60 完全压住
- ⚠ **叠加影响**：W4.3 的「战前部署」与 W4.1 的「部署时间到」横幅**均在 `deployPhase===true` 期间触发**
  ⇒ **两条在默认流程下根本看不到**；且 **W4.1 的"替身提示"本身也在被遮层之下**
  ⇒ "不开战"+"替代提示也看不见" ⇒ 玩家只能靠回车/按钮，或先 Esc 收起
- 战斗期横幅（开局/决战/结束）因 `deployPhase` 已 false、overlay 已卸载 ⇒ 可见（与红队一致）

### 6.3 ★ 缺口 R7：`scripts/uiVisibilitySim.cjs` **未创建**（验收未达标）
- 实测 `ls scripts/uiVisibilitySim.cjs` ⇒ **不存在**（`scripts/` 下只有 `uiCommandSim` / `fogUiIntegrationSim`）
- 而 34 号定稿 §3（`:190-191`）**明列**它并要求"**这是本次最重要的防线**"
- ⇒ 实际只交付了 `fleetAutonomySim.cjs`
- **责任归属：lead 派单时漏写**（W1+W2、W3+W4 的 prompt 都未提）⇒ 这条防线缺失，
  使"承诺自动开战 / 横幅被遮"这类**可见层缺陷没有任何台架能拦住**

### 6.4 审核方的结论强度建议（lead 采纳）
> 机制层（W3 会动 / W4.1 默认不开战 / W5 键位 / W3.6 等价 / 门槛全绿 / diff 未越界）**维持通过**；
> 但"用户实报的『看不出变化 / 流程乱 / 手感差』是否真被解决"这一层，
> 上述缺陷说明**部署期的可见文案与阶段横幅仍有明确回归/失效**，R7 说明**验收标准未达标**。
> ⇒ **建议下调"可玩性已解决"的结论强度**，收口前修掉 R2/R3 + 补 `uiVisibilitySim`。

**lead 采纳**：在 R2/R3/R4/R7 修完并重新验证前，**不宣布"可玩性冲刺完成"**。

---

## 6.5 必修项的精确定位与修法（lead 已读码确认，供修复派单直接使用）

### R2 · `BattleIntroOverlay.vue:154-156`（可见层仍在承诺"自动开战"）
```ts
const cdLine = computed<string>(() => {
  if (cdSec.value < 0) return '等待你的命令';
  return `${cdSec.value} 秒后自动开战`;      // ← 与 W4.1 新行为矛盾
});
```
**修法**：文案改为与 W4.1 一致，例如
- `cdSec < 0` ⇒ `'等待你的命令'`（不变）
- `cdSec > 0` ⇒ `'${cdSec} 秒 · 到点仅提示（不会自动开战）'`
- `cdSec === 0` ⇒ `'部署时间到 · 可继续调整，回车开战'`（**当前到 0 仍显示"0 秒后自动开战"**）

### R3 · 部署期横幅被全屏层遮死
- `BattleIntroOverlay.vue:314` `.io-overlay { z-index: 60 }`（近乎不透明全屏）
- `BattleBanner.vue:46` 横幅 `z-index: 40`
**修法（二选一，实现者给理由）**：
- (a) 横幅 z-index 抬到 **>60**（如 70）—— 但会盖住全屏部署层，需确认不遮挡其操作区
- (b) **部署期不叠加横幅**，改由 `GameFooter` 常驻提示承担（W4.2 已做）⇒ 更干净
- ⚠ 另注意审核方 4.4：`BattleBanner` 挂载条件 `v-if="battle3dReady"` 与 `enter3dMode()` 有时序窗口

### R4 · 玩家明令"固守"只守 25 秒
现状（`BattleScene` `hold_point` 分支）：
```ts
const patrolR = m.patrolRadius ?? 0;
if (patrolR > 0) { /* 巡逻 */ }
else { /* 到位后 _holdArrivedAt，超 HOLD_POINT_MAX_MS（25s）⇒ clearMission() + search */ }
```
玩家在**军议面板**下的"固守"= 无 `patrolRadius` 的 `hold_point`（`dispatchFleetCommand` 的 mission 分支，
`:3335-3337` 给缺省坐标）⇒ **被 AI 用的超时误伤**。
**修法**：区分来源 —— 在 `Mission` 上加 `manual?: boolean`（或 `holdIndefinite?: boolean`），
玩家入口（`dispatchFleetCommand` 的 mission 分支 / `CouncilWarRoom`）置真；
`executeMissionTick` 的超时分支 **跳过 `manual`** ⇒ 玩家明令固守**不超时**，只有 AI 自动派的才超时转巡逻。
⚠ **不得**用"给玩家 hold 也加 patrolRadius"代替（那会把"固守"变成"巡逻"，语义错误）。

### R7 · 补 `scripts/uiVisibilitySim.cjs`（定稿 §3 明列，实际缺失）
**内容**（对应定稿 §3）：**源码契约断言** —— 3D 模式下的每个 UI 都必须有 DOM 实现，
即扫描"只画在 Phaser 上、无 DOM 对应"的 UI。至少覆盖：
- `showBattleBanner` / `updateDeployText` / `battleLossText` 三者在 DOM 侧都有对应实现（`BattleBanner.vue` / `BattleIntroOverlay.vue` / `GameFooter.vue`）
- **z-index 断言**：DOM 层的 z-index 必须高于其需要覆盖的层（**这条能捕获 R3**）
- **文案一致性断言**：`deployCountdownSec` 的**所有**渲染出口（`BattleIntroOverlay` / `GameFooter` / Phaser `updateDeployText`）
  对"是否自动开战"的表述必须一致（**这条能捕获 R2**）
- `body.battle3d-mode` 的隐藏规则不得命中任何"已 DOM 化"的 UI 层（**这条能捕获"W1.4 类误判"**）
⇒ **每条断言必须配反例行**（改坏后必须 FAIL）

### R1 · `fleetAutonomySim.cjs` 改为真跑决策链
红队证明 24 条断言全是 `block.includes(...)`。**修法**：按审核方已验证可行的手法改造 ——
把 `BattleScene` 的真实分支抽出、经 node `stripTypeScriptTypes` 去型后 `new Function` **真正执行**：
- 巡逻 `hold_point`（`patrolRadius>0`）⇒ 断言**从未进入 `defend`**、目标离开锚点
- 无半径 `hold_point` ⇒ 断言 **≤26s 内 `mission===null`** 且 `stance==='search'`
- 变异自检：`patrolR` 恒 0 / 超时禁用 ⇒ 必须 FAIL

### R5 · 战前"N 艘"≠实体数（既有口径，非回归）
**修法（文案层）**：把 "N 艘" 改为 "编制 N"（或加 tooltip 说明"编制强度 ≠ 屏幕上可见舰数"）。


---

## 8. ★★ 真机验证（general-purpose-1）：W1/W2/W4/W5 通过；**W3 判定 FAIL**

### 8.0 环境修正（会卡住其他人，务必记住）
- **`C:/Users/damocles/AppData/Local/ms-playwright` 不存在** ⇒ Playwright 自带浏览器**未安装**，
  `chromium.launch()` 直接报 `Executable doesn't exist`
- **可用替代**：用系统 **Edge**：`chromium.launch({ channel: 'msedge', headless: false })`（WebGL 2.0 正常）
- 真实 GPU 帧率 **104 fps**（Intel Arc B390 / D3D11）；⚠ 加 `--use-angle=swiftshader` 会掉到 6fps（**自己引入的假象**）

### 8.1 真机确认有效（可以收）
| 项 | 证据 |
|---|---|
| W2.1/W2.2 指派槽「阵型 + 编成明细」，5 槽各不相同 | `夏伍汀 5000艘 阵型圆形阵 战列×1908…` / `连内肯普 12000艘 阵型楔形阵 战列×6690…` |
| W2.3 战场 HUD 显示阵型+编成 | 左上舰队卡（方阵/横阵/纺锤阵 + 编成明细） |
| W4.2 部署期常驻提示 | `.ui-footer .text-deploy` = `◤ 战前部署 ◢ 阵型:圆形阵 姿态:索敌 · 回车开战` |
| W4.1 倒计时到 0 **不**自动开战 | 120s 轮询：`1 秒后自动开战 → 0 秒后自动开战` ⇒ 横幅「部署时间到」⇒ 仍在部署期、`.io-go` 仍在 |
| W1.2 阶段横幅（DOM） | 点开战后 601ms 捕获 `.battle-banner` = `战役开始 / 第一阶段：试探接触` |
| W5.4 billboard 含意图+速度%+相位 | `.b3d-bb-layer` 8 个 `.b3d-bb`；`◆席特尼舰队 / 奉令：进击敌舰队 / 机动 巡航 · 速度 0%` |
| W5.1 footer 文案修正 | `指令: 空格·指挥点面板 · 1-5·速度档 · X·分舰队`（旧「空格暂停」已消失） |
| W5.2/W5.5 CP 按钮 / ⚑ 主队 | body 文本含 `⚡ 指挥点 6/6`、`⚑ 主队` |
| console | **`pageErrors: []`** —— 无任何 JS 异常 ⇒ 卡住**不是**异常隔离造成，是状态机逻辑 |

### 8.2 ★★ R8（最高优先级）：舰队 `state` 卡在 `assembling` ⇒ 开局全场站桩

**真机数据**（真 GPU / 104fps / 3x 倍速，`window.__fleetSnap()` 前后对比）：
```
80s 净位移：95px / 114px / 288px / 281px   ← 而目标在 4000~5900px 外
折合 1~3.6 px/秒 ⇒ 要 1 小时以上才能接敌 ⇒ 玩家观感 = 「原地不动」
billboard 速度显示 0%
（swiftshader 6fps 那轮：距离逐像素完全不变 4718→4718→4718）
唯一真正在动的是 state=exploring 的舰队
```
⇒ **与用户实报「友军有的会动有的不动 / 敌方也是原地不动」精确吻合**：
判别量就是 **`state`** —— `exploring`/`engaging` 会动，**`assembling` 不动（含敌方 AI）**。

**根因（lead 已逐条独立核实）**：
| # | 机制 | 位置 |
|---|---|---|
| R8-a | 舰队初始 `state:'assembling'` | `:1647` |
| R8-b | **没有任何"assembling → 其它"的迁移写在"无敌人时可达"的路径上**；唯一写 `exploring` 的入口嵌套在 `if (closestEnemyFleet && minFleetDist < engageDist)` 之内 ⇒ 开局相距 4000+px **永远进不去** | `:6772-6773` ⊂ `:6648` |
| R8-c | 每帧目标默认 = 自身：`let fleetTargetX = fleet.x; let fleetTargetY = fleet.y;` | `:6318` |
| R8-d | **`_missionDest` 的牵引点位于 `if (fleet.state === 'exploring')` 分支内部** | `:7256` ⊂ `:7123` |
| R8-e | ⇒ `assembling` 时 `fleetTargetX/Y = fleet.x/y` ⇒ `distToTarget=0` ⇒ 只吃斥力 ⇒ **速度≈0** | `:7681 distToTarget<5` |
| R8-f | W3 的四项修复只写 `stance`/`mission`/`_missionDest`，**没有一处动 `state`** ⇒ 对"开局不动"**无效** | — |

**⇒ 关键判断：任务链是通的（真机快照 `target=` 有值），瓶颈在状态机不消费它。**

**修法（二选一或组合，实现者给理由）**：
- (a) **在 `assembling` 分支也消费 `_missionDest`**（有任务目的地就牵引）—— 最小改动、不改变 `assembling` 语义
- (b) **给 `assembling` 加结束条件**（如开局 N 秒后 / 各单位就位后 ⇒ 自动转 `exploring`）
- (c) 组合：先 (a) 保证"有任务就能走"，再 (b) 保证"没任务也会进入探索"

### 8.3 真机也确认了 R2
`_verify_shots/04-deploy.png` **右上角可见「20 秒后自动开战」** —— 与红队/审核一致（R2 实锤）。

### 8.4 真机建议
> W1/W2/W4/W5 的"看得见"部分**真机确认有效，可以收**；
> 但**"能不能玩"的短板仍是 W3**：必须补"无敌人时也把舰队从 `assembling` 迁出（或在 `assembling` 下消费 `_missionDest`）"，
> 否则开局全场站桩、玩家等不到接敌。**优先于其它收尾项。**

**lead 采纳**：R8 列为**最高优先级**，与 R1~R7 一并修。

### 8.5 关于 R6（加速度）的重新裁决
真机显示"速度 0%"**是 `assembling` 的结果，不是加速度不够** ⇒ **修完 R8 后舰队将以
`vMax≈0.22px/帧 × 60fps × 倍速 ≈ 40px/s（3x）` 正常推进** ⇒ **R6 维持"不改"，待 R8 修完真机复验再定**。

---

## 9. 修复总清单（lead 定稿，按优先级）

| # | 优先级 | 内容 |
|---|---|---|
| **R8** | ★★★ | `assembling` 不消费 `_missionDest` ⇒ 开局全场站桩（**"能不能玩"的总开关**） |
| **R2** | ★★ | `BattleIntroOverlay.vue:154-156` 文案仍承诺"自动开战"（可见层说谎） |
| **R3** | ★★ | 部署期横幅被全屏层遮死（z40 < z60） |
| **R7** | ★★ | 补 `scripts/uiVisibilitySim.cjs`（定稿 §3 明列的"最重要防线"，未交付） |
| **R1** | ★★ | `fleetAutonomySim.cjs` 改为真跑决策链（24 断言全无牙齿） |
| **R4** | ★ | 玩家明令"固守"只守 25s（AI 超时误伤玩家命令） |
| **R5** | ☆ | 战前"N 艘"≠实体数（既有口径，改文案澄清） |
| **R6** | — | 加速度：**维持不改**（8.5） |



