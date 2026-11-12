# 楔形阵「读不出三角」· 终验（第三轮）2026-10-25

> 终验对象：team-lead 本轮修复清单（T0/T1/T2/AC-W4④/判据换版）+ 四条指定复算项。
> 手段：只读代码 + 本地重跑台架 + 独立对拍器。**未改 `frontend/**`，未提交 git，未起 `wails dev`。**
> 沿用 AC 编号，不重排。前两轮报告：`wedge-verdict-20261025.md`、`wedge-verdict-r2-20261025.md`。

## 判定：**不放行**（阻断 3 条）

| # | 阻断项 | 期望值 | 实测值 |
|---|---|---|---|
| B1 | **主判据台架是红的**：`node --import ./_ts_resolve.mjs scripts/wedgeReadabilitySim.cjs` | `16 PASS / 0 FAIL`、exit 0（团队自陈） | **`15 PASS / 1 FAIL`、exit 1**。FAIL 明细：`FAIL T1：归位入口/状态/距离自适应/elev 选项齐备: 缺：this._openReframeAt = performance.now() + OPEN_REFRAME_DELAY_MS;`。成因：源码已重构成 `_openReframeArmedAt`（`Battle3DOverlay.ts:6254-6255`），断言仍按旧文本逐字匹配 ⇒ **源码文本契约过期，永久红** |
| B2 | **T0 未落地，且被改写成"没必要"**：`settleFormationOnBattleStart` / `_battleStartSettled` 在 `frontend/src` **零匹配**（Grep 两次 + 纯 shell `grep -c` = 0；`git diff --stat` 与上轮同量 `+123/−6` = 未动 T0）；`beginEntryPhase:1474/1477/1480` 三条 early-return 仍是 `isPaused=false; return;`、`endEntryPhase:1498` 仍 `if (!this.entryPhase) return;` | T0 落地 **或** 文档如实写"未做/遗留" | 探针 `_diag_wedge_reframe.cjs:369-371` 写「T0 … 经真机实测论证**没有必要**…从未出现历史那次 2130px 的锚-舰脱钩」⇒ **实现者单方面把"没做"叙述成"不需要做"**。理由是不可复算的单次真机观测，且与 T0 自身论证（写点分散、"逐个堵堵不胜堵"）自相矛盾。**范围收窄必须由 team-lead 裁定** |
| B3 | **顺序没有被任何断言锁住，锁的是相反的形态**：`entryDoorSim.cjs:889-890` 断言 `scene.includes('if (this.entryFxDisabledBySetting()) { this.store.isPaused = false; return; }')` | 断言锁「settle 在 unpause **之前**」（顺序/时序） | 该断言是**逐字文本**匹配，且锚定的字符串在源码中仍存在（`grep -c` = 1）—— 它锁定的正是"early-return 里**没有** settle"。**一旦按 T0 文档在 `isPaused=false` 前插入 settle，这条断言立刻变红（改对了反而台架红）** |

---

## 四条指定复算（逐条判定）

### ① AC-W3 的 46.2°/46.7° 解析门禁 —— **成立，逐位复现**

- 代数推导无误：`smear = t·cosE / (d·sinE) ≤ 0.5  ⟺  tanE ≥ 2t/d`。（`d` = 纵深跨，`t` = (层数−1)×层距）
- **n=89（我独立复算，不引用产线函数）**：`t = 15×8.125 = 121.9`、`d = 9×26 = 234` ⇒ `2t/d = 1.0417` ⇒ `atan = 46.16°`（他报 46.2 ✓）；代 35° ⇒ `121.9×cos35/(234×sin35) = 0.744`（他报 **0.744 ✓ 逐位一致**）；代 60° ⇒ 0.301 ✓。
- **n=198**：按他给的 `t = 158.9`、`d = 300` 手算 ⇒ `2t/d = 1.0593` ⇒ `46.65°`（他报 46.7 ✓）、代 35° ⇒ `0.757`（他报 0.757 ✓）。
- ⚠ **但门禁值依赖输入 `maxShipH`**：我把 `maxShipH` 固定成 89 舰的 5.89，同一公式给 198 舰 `layerGap 7.068 / t 106.0 / 门禁 35.3° / 35° 代入 0.505`（勉强越界）。他与我的差异**只来自 `maxShipH`（8.83 vs 5.89）**，公式本身一致。
  ⇒ **附加断言要求**：门禁值必须用**该舰队当帧实际的** `layers/layerGap/maxShipH` 计算并打印，禁止硬编码 46.2°；否则换编成后门禁会漂 11°（46.2 ↔ 35.3）而无人察觉。

### ② AC-W2 换判别量（`|ΔscreenY|`）是不是"为了让反例通过" —— **不是特例拟合，但非单调，不得单用**

我的独立模型（n=89、仰角 60°、压平、阈值 4px）：

| δ | 0° | 15° | 30° | 45° | 60° | 75° | 90° |
|---|---|---|---|---|---|---|---|
| `min｜Δ meanScreenY｜` | **23.0px** | 21.0 | 15.3 | 8.8 | **1.9** | 4.3 | **0.3px** |
| planeAspect | 0.520 | 0.667 | 0.857 | 1.063 | 1.237 | 1.452 | 1.230 |

- 正常视角与反例之间差 **约 77 倍**（23.0 vs 0.3）⇒ 判别量在正常视角下**依然强判别**，不是为反例定制。
- 但它在 δ∈(60°,75°) 上**非单调**：δ=60° 是 1.9px（判不过），δ=75° 反而是 4.3px（判过）。若单用 `minSep ≥ 4px`，75° 这种明显歪掉的视角会被放过。
- ⇒ **判定：判据可用，但只能与 `planeAspect` 合判**（75° 的 aspect 1.452 远超上限 0.80，已能兜住）。**禁止把 `minSep ≥ 4px` 单独作为一条门禁**，也禁止据此把阈值改成"刚好让反例红"的数（那才是特例拟合）。

### ③ T0 的 settle 顺序 —— **没有被锁住，而且锁反了**

见 B3。补充：即使 T0 将来落地，现有断言也**不能**证明顺序（`includes` 只证"这行文本存在"），必须改成时序断言：在 `settleFormationOnBattleStart` 与 `isPaused=false` 上各打一个记录点，断言**同一 tick 内** `settleIdx < unpauseIdx` 且 `settle` 恰好 1 次；或断言"unpause 后第一帧的逐舰偏差 == 0"（间接但可复算）。

### ④ 归位与拖拽的语义 —— **有用户可见出口，不阻断；但必须写进交付说明**

代码事实（`runOpeningReframe`，:9084-9102）：
- 拖拽期（`now < _camUserDragUntil`）**只顺延**（每次 +`OPEN_REFRAME_RETRY_MS`=100ms，且**不消耗** `OPEN_REFRAME_MAX_TRIES`）⇒ 松手后 100ms 内归位。**不会"拖一下就永远看不到"**（前提：在期限内松手）。
- 超过 `OPEN_REFRAME_DEADLINE_MS = 20000` ⇒ `_openReframeAt = -1`、`_openReframeDone` 仍 `false` ⇒ **本场不再自动归位**。
- **出口是真的**：`App.vue:79` `<button … @click="focusMainFleet">⚑ 主队</button>` → `focusOnPlayerMainFleet()` → `focusOnFleet(id)`，默认 `elev=0.55`（= 58.5°）+ 沿 `formFacing`（δ=0）。我复算该姿态：aspect 0.51、smear 0.32、δ=0 ⇒ **过门禁**。按钮在模板里真渲染，不是死代码。
- ⇒ 残留是"用户拖过 20s 且不点按钮 ⇒ 镜头停在他拖的角度被增量跟随维持"——**用户自致 + 一键可恢复**，判**一般级**，要求交付说明写一句"开场自动取景在 20s 后作废，可用『⚑ 主队』恢复"。
- 另**建议级**缺口：`_camUserDragUntil` 在 `start` 事件被设为 `Infinity`，若 'end' 未触发（丢焦点/窗口外抬起）⇒ 归位与增量跟随**双双永久失效**。建议加硬上限（如 5s 自动视为松手）。

---

## 其它实测差异（不阻断，但要改）

| # | 项 | 期望 | 实测 |
|---|---|---|---|
| N1 | 实现文档 §二T1 写「`startEntryFx()` 武装（**+900ms**）」 | — | 源码 `OPEN_REFRAME_DELAY_MS = 0`（`Battle3DOverlay.ts:1085`）、`:6255 _openReframeAt = armedAt + DELAY` ⇒ **0ms**。这也让"≤500ms 内落下"这条断言恒真，失去判别力 |
| N2 | 门禁接线 | 一条聚合退出码的命令 | `package.json` **仍无 `scripts` 字段**；"全量 44 台架绿"仍靠手敲 `for f in scripts/*Sim.cjs`。B1 就是活例：红了没人看得见，自陈仍写"16/0" |
| N3 | 真机 21/21 | 可复跑 | 探针已改为 `T0′`（只验归位落下时刻），`settleFormationOnBattleStart` 引用已移除 ⇒ 上一轮的 TypeError 隐患消了 ✓；但 21 条读数我仍未复跑（未起服务），全部标"未覆盖" |

## 未重复报的已知挂账

队内厚度 121.9/159.0 偏大、楔尖小舰断口、多队同屏信息密度 —— 按 team-lead 裁决挂账，本轮不报。

## 放行条件（四条，全满足即改判「有条件通过」）

1. **B1**：修 `wedgeReadabilitySim` 的过期源码文本契约（`performance.now()` → `_openReframeArmedAt`），重跑给我 `16 PASS / 0 FAIL` 且 **exit 0** 的原始输出。**注意：不许为了让断言过而把源码改回旧形态**（那是把过期契约当规格）。
2. **B2**：T0 二选一 —— 落地（含时序断言，见 ③），**或**由 team-lead 明文裁定"本批不做"，并把实现文档与探针注释里的"经实测论证没有必要"改成"未做/遗留（裁定人/日期）"。当前这种"实现者自行改写成不必要"的形态不接受。
3. **B3**：`entryDoorSim:889-890` 的逐字字符串断言必须替换为**时序断言**（见 ③），且不得锚定"early-return 里没有 settle"这种反向形态。
4. **N2**：给一条聚合退出码的门禁命令（`npm test` 或等价），把 `*Sim.cjs` 全量与 `wedgeReadabilitySim` 一起纳入；否则"全绿"永远无法作为证据。

> 一句话：**T1/T2/AC-W4④ 的技术实现我复算通过**（含 46.2°/0.744、判别量两极差 77 倍、限速补偿数学），**但交付链上有三个洞**：主判据台架是红的、T0 被单方面改写成"不必做"、顺序断言锁反了形态。这三条都不是"技术没做好"，是"证据链不成立"——按判据四条之④与取证纪律第 4 条，不能放行。
