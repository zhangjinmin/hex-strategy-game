# 战术层 3D 化 — 架构文档集

路径：`docs/architecture/3d-tactical-battle/`
目标文件：`frontend/src/game/scenes/BattleScene.ts`（3827 行，Phaser 2D 线框）
目标状态：棋盘与舰队改为 Three.js 3D 渲染，**战斗规则 / 数值 / AI 逻辑零改动**，Phaser 从战术层移除。

配套文档：
- `docs/art/3d-tactical-battle/`（视觉规格，art-director）
- `docs/design/3d-tactical-battle/`（交互与可读性规格，design-strategist）

本目录只讲**工程结构与接口**。**分工原则**：视觉参数以 art 目录为准、交互与可读性判据以 design 目录为准、接口签名与坐标公式以本目录为准。三方数值冲突的处置见 §3.5 / §3.6。

---

## 0. 一页速览（实习生先看这一页）

| # | 决策 | 选了什么 | 放弃了什么 |
|---|------|----------|------------|
| D1 | 分层 | 五层单向流：`TacticalHost → TacticalSim(规则) → BattleView(快照) → BattleRenderer(Three) → Vue` | 放弃"渲染层直接持有逻辑实体引用"的现状 |
| D2 | 渲染器接口 | **快照驱动 + 对象池**（逻辑层每 tick 产出只读 SoA 快照，渲染层无状态同步） | 放弃命令缓冲（渲染层要复制状态机，易漂移）、放弃直接引用（就是现状的病根） |
| D3 | 坐标系 | 逻辑层**保持 2D**（x,y 像素），3D 高度是**纯渲染语义** | 放弃把 AI/距离/射程改成 3D（会违反"规则零改动"） |
| D4 | 拾取 | **InstancedMesh raycast**（棋盘 + 舰船各一次），hover 节流 30Hz | 放弃"射线打 y=0 平面再反解 hex"（27° 仰角下视差误差最大 1.67 格，见 ADR-003 §2.2） |
| D5 | 相机 | `OrbitControls` **只负责 Orbit + 阻尼**；平移与缩放由工程侧自研（中键+Shift / `WASD` / 方向键 = 平移；滚轮 = **离散 8 档**、朝光标推进）。`maxPolarAngle = 0.35π`（仰角下限 27°，art/UX 的 S 级约束） | 放弃工程侧原拟的 `0.42π`；接受 +120 行自研平移/缩放（OrbitControls 默认不满足 UX 的 4 项要求） |
| **D12** | **输入映射** | **采用 UX 侧映射**：中键拖拽=Orbit（主）/ 右键拖拽=Orbit（备）/ 右键点击=信标 / 左键=选择舰队 / `Alt+左键`=选单舰 / 滚轮=缩放 / `F`=聚焦 / `Home`=复位 | 放弃工程侧原拟的「左键拖拽=旋转、右键拖拽=平移」（UX 理由更强：右键信标是高频操作、左键拖拽手感是 2D 遗留记忆、WASD 解决触摸板无中键） |
| **D11** | **单位制** | **1 world unit = 1 个六边形中心间距 = √3·hexRadius px**（棋盘世界尺寸恒定 50×43） | 放弃 art 侧的 `1 unit ≈ 15 px`（固定换算 ⇒ 棋盘尺寸随 `hexRadius` 变化 1.92 倍）。**换算：`V_eng = V_art / 3`** |
| D6 | Phaser | 战术层**彻底移除**；`phaser` 依赖保留给 `EditorScene`（地图编辑器） | 放弃"Phaser 降级为 headless 计时器宿主"（省不掉双 WebGL context） |
| D7 | 棋盘渲染 | **基板 + 顶盖（16 块分块剔除）+ 高格裙边（阈值 0.25）** ⇒ 10,206 tris（典型）/ 20,094（上限）/ 18 draw call | 放弃 R1 的"全裙边"（31,216 tris，会顶到美术 36,000 硬上限） |
| D8 | 回归验证 | **Golden Replay**：先在 2D 版上把 `Math.random()` 换成 seeded RNG，录 golden，改造后逐 tick 比对 | 放弃"靠人肉试玩找回归" |
| D9 | 存档 | 不新增 `gameState` 值，不写战术状态进存档 ⇒ **旧存档零影响** | — |
| D10 | 2D 回退 | 不保留可发布的 2D 回退路径（遵守用户铁律）；但开发期保留 `?renderer=both` 影子对照，**Phase 5 结束前删除** | — |
| **D13** | **两档缩放** | 默认档 **25px**（D = 25.5 格）/ 全局档**按地图自适应**（D = 39.8–60.1 格，10.6–16.0px）；**按"战列舰屏幕投影长度"反解距离而非写死**；切换用**几何插值** tween（Basic 500ms / Standard 600ms / Comprehensive **瞬时**） | 放弃线性插值（2.4 倍距离变化会"前段不动后段飞出"）；放弃写死距离（地图尺寸差 4 倍） |
| **D14** | **LOD 判据** | **统一用「舰船屏幕投影高度 px」**（team-lead 对 C-7 的裁决），采纳设计侧 L0≥48 / L1 24–48 / L2 12–24 / L3<12 px | 放弃世界距离判据。收益：**R-16 单位制冲突在 LOD 维度上完全消解**（px 是唯一真相，三方不用换算） |
| **D15** | **效果层扩展点** | 渲染层**永不 switch 效果类型**：一次性表现走 `CP_EFFECT` 事件（不看类型），持续态走**通用图标槽位 + 图标 UV 查表**，特殊表现走 **`registerEffectVisual` 注册表**。`EffectViewEntry.effectType` 用 `string` 而非联合类型 + `FALLBACK_UV` "?" 图标 | 放弃"渲染层按效果类型分支"的写法。目标：**层 2 新增效果时渲染核心零改动**（ADR-007 §3.4 自检表） |
| **D16** | **雷达 / 尾焰选型** | 雷达 = **2D Canvas 覆盖层**（0 draw call、不受后处理污染、软渲染仍可用、可移植 `ThreeStrategicMap.drawMinimap`）；尾焰 = **Cone**（1,536 tris / 2 draw call，配 Additive + 顶点色渐变 + 与 2D 相同的双频闪烁） | 放弃正交相机第二遍渲染（+18~83 draw call，软渲染翻倍）；放弃粒子系统（overdraw 在软渲染下致命，且与 2D 贴图观感不连续） |
| **D17** | **全局档投影** | **真 `OrthographicCamera`（双相机切换）**；`minPolarAngle = 0.08π` 不改值，改由"预设位姿绕过 OrbitControls"实现顶视例外（同时覆盖 `V` 键顶视兜底）；全局档战列舰 14.3px ⇒ LOD **L2（实体+线框）**，draw call 49 → **84**、tris 13.8k → **~25k**，仍在 180 / 36,000 预算内 | 放弃"小 fov 透视模拟正交"（far plane 需 400→4000+、深度精度崩溃、永远只是近似正交）。见 `11-adr-008` |

---

## 0.1 性能预算（R2 · 已与美术侧对账）

| 项 | 美术侧 | 工程侧 R2 推导 | 判定 |
|---|---|---|---|
| **三角形峰值** | ~30,000 | **~19,000**（默认档）/ **~25,000**（全局档） | ✅ 余量 17% |
| **三角形硬上限** | 36,000 | **~26,000**（最坏组合） | ✅ 余量 28% |
| **draw call** | **< 180** | **95**（默认档 L1）/ **120**（最近 L0）/ **84**（全局档 L2） | ✅ 余量 53% |
| **粒子 / 并发实例** | ≤ 3,000 | **~1,016**（池容量） | ✅ 余量 66% |
| **后处理** | 3 pass | 2 个可见 pass（Bloom 0.5× + CRT） | ✅ |

**关键认知**：最坏场景是「**最近 + 特效最密**」（L0 特写），**不是**「最远」。但注意 **Q9 方案 B（全局档顶视正交、战列舰 14.3px）已把全局档从 L3 抬进 L2**，全局档不再"最省"（tris 13.8k → 25k、draw call 49 → 84），详见 `11-adr-008` §6。R1 版把"全盘可见"当成最坏是算错方向；而"全局档最省"的旧结论同样只对方案 A（6.6px billboard）成立。

**R1 → R2 的两处关键修正**：
1. 棋盘从"全裙边"（31,216 tris）改为**基板 + 顶盖 + 高格裙边**（10,206 / 20,094）⇒ 削减 **78%**，这是能落在 36,000 硬上限内的决定性因素。
2. LOD 从"世界距离"改为**屏幕投影 px** ⇒ 消解 R-16 在 LOD 上的阻塞。

**连带效果**：**R-18（draw call 余量仅 2 个）从 A 级降为 C 级**（美术预算是 180 而非我 R1 自定的 120）。

---

## 1. 文档地图

| 文件 | 内容 | 谁该读 |
|------|------|--------|
| `README.md` | 本文件：速览 + 术语 + 现状实测数据 | 所有人 |
| `01-architecture.md` | **主架构**：BattleScene 拆分方案、逻辑域/渲染域边界判定规则、完整接口签名、新目录结构 | 接手开发者 |
| `02-adr-001-renderer-interface.md` | ADR：渲染器接口设计（快照 vs 命令缓冲 vs 直接引用） | 接手开发者 |
| `03-adr-002-coordinate-mapping.md` | ADR：2D 战术坐标 → 3D 世界坐标映射 + 场景图结构 + 第三维语义 | 接手开发者、art-director |
| `04-adr-003-picking-and-camera.md` | ADR：raycast 拾取 + OrbitControls 相机参数（含视差误差公式） | 接手开发者 |
| `05-adr-004-vue-bridge-contract.md` | ADR：Vue UI ↔ 3D 渲染层通信契约（对齐 `onHoloBoardAnchor` 模式） | 接手开发者 |
| `06-adr-005-phaser-retirement.md` | ADR：Phaser 去留论证（含依赖面实测统计与替换成本） | 接手开发者、team-lead |
| `07-adr-006-board-rendering-and-lod.md` | ADR：棋盘三层结构 / 舰船合批 / **LOD px 判据** / 性能预算（已与美术对账）/ **雷达与尾焰选型定案** | 接手开发者、art-director |
| **`10-adr-007-command-effect-extension-points.md`** | **ADR：指挥点效果层扩展点 +「层 2」边界**（Q8 定案）。11 个命令有效性逐条核实、效果接入点三类分法、`isDefending` 修正建议、**本次不做的完整清单** | 接手开发者、**层 2 负责人** |
| **`11-adr-008-global-zoom-orthographic-projection.md`** | **ADR：全局档正交投影**（真 OrthographicCamera vs 小 fov 透视 / `minPolarAngle` 顶视例外 / draw call 重算 / 14.3px 信息呈现复核）。补全 Q9 方案 B 的三个工程连锁后果 | 接手开发者、art-director、design-strategist |
| `08-roadmap-and-acceptance.md` | 分阶段路线 + 每阶段**可运行、可看、可测**的验收标准与命令 | 接手开发者、team-lead |
| `09-risk-register.md` | 风险清单（20 条）+ 缓解措施 + 验证手段 + 存档兼容专项 | team-lead、用户 |

---

## 1.1 本次 3D 化的范围边界（Q8 定案，**评审红线**）

| 范畴 | 本次做 / 不做 |
|---|---|
| **做** | 棋盘与舰队的 3D 呈现；两档相机；分层拾取；舰队选择；**CP 目标选择的交互呈现层**；效果扩展点（`EffectView` + `registerEffectVisual`）；未实现命令的禁用态；战术雷达 |
| **不做（层 2）** | **任何命令效果的规则实现**；`getSpeedMultiplier` / `getMoraleModifier` / `getActiveEffects` 的调用；`reflect` / `teleport` / `heal` handler；`isDefending` 拆分；`durationMs: 0` 修正；效果数值平衡 |

> **评审红线**：本次 3D 化的任何 PR，`git diff --name-only` 中**不得出现**
> `frontend/src/services/CommandPointSystem.ts` 或 `frontend/src/config/commandAbilities.ts`。
> 完整清单见 `10-adr-007` §5.2。

---

## 2. 术语表（文档里不再重复解释）

| 术语 | 定义 |
|------|------|
| **规则域 / Rules Domain** | 影响战斗结果的一切：血量、伤害、射程、AI 状态机、补给、占领、迷雾、结算。**本次改造中一字不改。** |
| **渲染域 / Render Domain** | 只影响画面的一切：mesh、材质、粒子、屏幕投影、相机、DOM 浮标位置。 |
| **宿主域 / Host Domain** | 帧循环、定时器、补间引擎、输入事件、生命周期。 |
| **L1 / L2 / L3** | 见 `01-architecture.md` §2：L1=`TacticalSim`（规则）、L2=`BattleView`（快照）、L3=`BattleRenderer`（Three）。 |
| **逻辑平面 / Logic Plane** | 现有 2D 战术坐标系，单位=像素，`hexRadius` 决定缩放。规则域的唯一坐标系。 |
| **世界空间 / World Space** | Three.js 右手系，Y 向上，单位=**1 格六边形间距**（见 ADR-002 §1）。 |
| **泳道 / Lane** | 舰船在 Y 轴上的高度分量，由舰种决定。纯渲染语义。 |
| **golden replay** | 把一局战斗的输入序列 + 随机种子录下来，逐 tick 比对观测向量的回归测试。 |
| **影子模式 / shadow mode** | 开发期同时挂 2D 与 3D 渲染器对照。**不是回退路径**，Phase 5 前删除。 |

---

## 3. 现状实测数据（本目录所有阈值的依据）

数据来源：对 `BattleScene.ts` 逐行盘点（2026-08-30），非估算。

### 3.1 规模

| 项 | 实测值 |
|---|---|
| `BattleScene.ts` 行数 | 3827 |
| `update(time, delta)` 单方法行数 | **1341**（1968–3308） |
| 类中方法数 | 45 |
| `Phaser.Math.Distance.Between` 调用 | 36 |
| `this.tweens.add` | 37 |
| `this.cameras.main` 引用 | 35 |
| `Math.random()` 调用 | **30**（⇒ 当前无法回放，见 R-05） |
| `mapStyle === 'crt'` 分支 | 26 处 |
| 逻辑层读取渲染对象坐标（`u.sprite.x/y`） | **72 行**（⇒ 最大结构风险，见 R-01） |

### 3.2 地图规模（决定性能预算）

| 地图 | 格子数 | 计算式 |
|------|--------|--------|
| `random`（默认） | **1951** | `\|q\|≤25, \|r\|≤25, \|q+r\|≤25` |
| `random_large` | 933 | `\|q\|≤16, \|r\|≤16, \|q+r\|≤20` |
| `random_rect` | 861 | `41 × 21` |
| 伊谢尔伦（campaign） | 867 | `51 × 17` |
| `default` | 139 | `\|q\|≤6, \|r\|≤6, \|q+r\|≤7` |
| campaign 圆形 | 127 | `radius=6` |

### 3.3 同屏单位数

- 演习模式：每支舰队 = `deck` 长度，最多 8（`generateSimFullComposition` 满编 8 类，实际 deck 数组长度 8）；舰队数 = 玩家提督数 + `activeFactionCount`（默认 2）。
- 战役模式：每支舰队 `slots.length` ≤ 6（`serializeTacticalFleet` 最多 6 类舰种）。
- **实测上限取 128**（见 `07-adr-006` §5 预算表推导）。

### 3.4 关键既有事实（容易被忽略，但决定方案）

| # | 事实 | 影响 |
|---|------|------|
| F1 | `CrtRenderer.ts:13` → `export const CRT_Y_SCALE = 1` | CRT 模式的"伪 3D 压扁"已被中和成恒等式。⇒ CRT 模式**不是**竞争性 3D 方案，它现在只是一套 2D 线框外观。3D 化后 CRT 退化为**材质/后处理风格开关**，几何不受影响。 |
| F2 | `store/battleResolver.ts` **不被 BattleScene 引用**（只被 `gameStore.ts` / `aiEngine.ts` 用于自动裁决） | 战术层的逐舰战斗逻辑**全部在 `BattleScene.update()` 内**，没有第二份实现。⇒ 拆分边界干净，但也意味着没有"参考实现"可对照。 |
| F3 | 突击舰舰载机伤害在 `this.tweens.add({onComplete})` 里结算（BattleScene.ts:2870 `targetShip.hp -= dmgPerFighter`） | **规则住在补间回调里**。拆分时必须改成"逻辑层延迟伤害事件 + 渲染层纯表现"，见 R-02。 |
| F4 | `phaserProjectiles` 数组在 `update()` 里自行移动 + 判定命中 + 扣血（2028–2088） | 这是**玩法系统**（弹道飞行时间影响伤害时机），不是特效。必须升格到规则域，见 R-03。 |
| F5 | Phaser 补间由 `Phaser.Game.step` 驱动，与 `Scene.update()` 独立 | 现状：`store.isPaused = true` 时 `update()` 早退，但**补间仍在跑**。3D 化的 `MicroTween` 必须复现此行为，否则暂停时特效会冻住（行为变更）。 |
| F6 | `gameStore.ts:297` 存档写 `nodes`，`gameStore.ts:403` 读档读 `data.strategicNodes` | **既有缺陷**：读档后 `strategicNodes` 恒为空。与 3D 化无关，但会污染回归测试的判断。记录为 R-14，**本次不改**。 |
| F7 | `const factions = ref<Faction[]>([])`（`gameStore.ts:2115`，深响应式） | 逻辑层每帧写 `f.hp / f.unitCount / f.inVision` ⇒ 每帧触发 Vue 深层依赖通知。拆分时应把战斗运行时数值移出响应式对象，见 R-11。 |
| F8 | 前端 `vue-tsc --noEmit` **当前 0 error**（实测 23s） | 可作为每阶段的硬门禁。见 `08-roadmap` §0。 |
| F9 | `docs/art/3d-tactical-battle/ship-assets.md` 已定稿：半透明实体 + 线框叠加、**旗舰单独复杂程序化体**、底面免建模 | 面数预算来自 art 侧（战列 410 tris / 名舰旗舰 1,100 tris）。工程侧的合批与预算据此推导，见 `07-adr-006` §3、§5。 |
| F10 | `CrtRenderer.ts:405` → `const hoverH = isFlagship ? 26 : 10;`（**像素**） | 这是 art 侧悬空高度数值的来源。本文档按 ADR-002 §3.6 换算为 `0.222 / 0.577` 工程单位。 |

---

## 3.5 与 `docs/art/3d-tactical-battle/`（art 侧）的接口

art-director 已产出 4 份视觉规格。**分工**：art 侧定"长什么样"，本目录定"怎么实现"。冲突时**视觉参数以 art 侧为准、接口签名与坐标公式以本目录为准**。

| 冲突点 | art 侧 | 本目录 | 处置 |
|---|---|---|---|
| **世界单位** | `1 unit ≈ 15 px` | `1 unit = 六边形中心间距`（`hexRadius=26` 时 45.03 px） | **相差 3.00 倍**。采用本目录，换算 `V_eng = V_art / 3`。理由与换算表见 `03-adr-002` §2.1.1。**需 art-director 会签（Q6，S 级）** |
| **`maxPolarAngle`** | `0.35π`（仰角下限 27°），用户已拍板禁仰视 | 原拟 `0.42π` | **采纳 art 侧 `0.35π`**。`04-adr-003` §3.2 已更新 |
| **LOD 阈值** | `< 8 / 8–20 / > 20`（art 单位） | 换算为 `< 2.67 / 2.67–6.67 / > 6.67` ⇒ 默认视距 24 全是 LOD2 | **需重新标定**（Q7，S 级）。工程侧建议 `< 8 / 8–24 / > 24`（本目录单位） |
| **悬空高度 HOVER** | `0.67 / 1.73`（art 单位，旗舰/常规） | `0.222 / 0.577`（本目录单位） | 同一组像素（26 px / 10 px），无实质冲突 |
| **舰体分层材质** | 实体层 `opacity 0.22` + 线框层 `0.88` + 发光层，均 `depthWrite: false` | 合批为 `InstancedMesh` per `(faction × class)` × 3 层 | 无冲突。但 **InstancedMesh 无法逐实例排序**半透明 ⇒ 会有叠加顺序错误，已接受（A6-Q2） |
| **旗舰不进 InstancedMesh** | 明确要求（§6.5） | 接受，代价 24 draw call | 无冲突 |

**art 侧尚未产出但 `README.md` §4 声明会有的两份**（`performance-budget.md`、`accessibility.md`）—— 本目录 `07-adr-006` §5 已给出工程侧的性能预算；若 art 侧的版本数值不同，以 art 侧为准并回填本文档。可访问性分级（Basic/Standard/Comprehensive）尚未落到工程侧，记录为待办。

---

### 3.6 与 `docs/design/3d-tactical-battle/`（UX / design-strategist）的接口

UX 侧已产出 7 份（`01` 信息架构 / `02` 交互规格 / `03` CP 命令流程 / `04` 反馈通道 / `05` 可读性风险 / `06` 可访问性与动效 / `README`）。**分工**：UX 定「玩家怎么操作、看到什么」，本目录定「怎么实现」。

| 冲突点 | UX 侧 | 本目录（**已收敛**） | 处置 |
|---|---|---|---|
| **输入映射** | 中键 Orbit / 右键备 Orbit / 右键点击=信标 / 左键=选择 | 初稿是「左键拖拽=旋转」 | **工程侧让步，采用 UX 映射**。`04-adr-003` §2.5 改稿 |
| **点击阈值** | 选择 `8px/300ms`；右键信标 `5px/200ms` | 初稿 `6px/250ms` | **采用 UX 值**。Q2 关闭 |
| **拾取可达性** | P1 忽略遮挡（被前排挡住的后排舰仍可选）；P2 结果是**舰队**不是单舰；代理体 `MIN_PX=12px` + 回退圆域 `18px` | 初稿只做「取最近命中」 | **工程侧全部采纳**，已改为「收集全部命中 + 屏幕距离排序」。`04-adr-003` §2.6 |
| **缩放** | 离散 8 档、朝光标、`dMin = hexRadius×2.5` | 初稿用 OrbitControls 连续 dolly | **采纳离散档 + 朝光标**；`dMin` 折中为 **4 格**（UX 的 1.44 格太贴脸，工程原拟 8 格）。**需 UX 会签（Q7b）** |
| **平移速度** | 按屏幕像素分三档（1800/1200/800 px·s⁻¹） | 初稿用 `panSpeed`（世界单位） | **采纳像素定义**，`OrbitControls.enablePan = false` |
| **阻尼** | 帧率无关指数阻尼（逐帧 lerp 在 30fps 下只有一半效果） | 初稿沿用 `dampingFactor = 0.08` | **采纳**，改为固定 16.67ms 子步驱动 `controls.update()` |
| **事件相机** | R-16：一骑讨/最后一击**不要移动相机**（玩家丢失定向） | 现状会 tween zoom | **默认关闭**，改「时间减速 + 台词卡 + 双高亮」。**这是行为变更，需用户拍板（Q9）** |
| **`fov`** | `05` 的推导用 50° | 本目录用 45°（战略层同款） | **保持 45°**（下缘有效仰角 4.5° > 0，更安全）。**需 art/UX 知悉（Q8）** |
| **阵型间距** | `05` 第 107 行要求重算 `spacing = 28px` | **坚持不改** | 改 spacing = 改逻辑距离 = 改射程判定 = 违反「规则零改动」。改由缩小舰体 / 接受重叠 / 高度交错解决。**需会签（A2-Q8）** |
| **单位制** | `05` 第 44 行声明以 art 的 `15 px/unit` 为准 | 本目录用 `1 unit = 六边形间距` | 同 R-16。**收敛方案：距离阈值用「格」、尺寸用「像素」**（`03-adr-002` §2.1.1） |
| **CP 选目标** | `03` §1 独立核实：`pendingCallback` **从未传入非空 `targetFleetId`** | 本目录 R-08 独立发现同一问题 | 两边结论一致 ⇒ **这是「补完」不是「迁移」**，合并为一个问题提交用户（Q1 = UX 的 Q5） |

---

## 4. 硬性约束（写进代码评审 checklist）

1. **本次只产出设计文档，不改任何源代码。** 实施阶段开始前，`src/` 下一行都不动。
2. **规则域零改动**：AI 状态机、伤害公式、射程、补给、占领、迷雾、结算、数值常量（含 `SHIP_TACTICAL_HP`、各阈值）逐字保留。若发现"必须改逻辑才能 3D 化"，停下来写 ADR 补充案，不许就地改数。
3. **不写"上线后再调"。** 每个数值/阈值必须带 rationale；不确定的标 `[PLACEHOLDER · 附验证路径]`，并在 `08-roadmap` 里挂一个验收命令。
4. **文档只写接口签名、坐标公式、边界条件、验收命令。** 模糊形容词（"大约""尽量""适当"）不进文档。
5. **不保留 2D 回退路径**（用户已拍板）。开发期影子模式是临时调试开关，必须在 Phase 5 结束前删除。

---

## 5. 需要用户/team-lead 拍板的问题

| # | 问题 | 我的默认建议 | 不拍板的后果 |
|---|------|--------------|--------------|
| **Q1** | **CP 命令的「战场选目标」是否补完**（**2D 时代从未工作过**：`pendingCallback` 从未传入非空 `targetFleetId`；且 `handleTileClick` 在暂停时直接 return，玩家点不了任何东西） | **补完**。工程侧（R-08）与 UX 侧（`03` §1，Q5）**独立核实得到同一结论** | 不补 ⇒ 所有 `requiresTarget` 命令仍是残废，3D 化后也不会自动变好。**这是新增功能，超出「纯呈现层改造」的字面范围，需用户确认范围** |
| ~~Q2~~ | ~~拖拽阈值~~ | **已解决**：采用 UX 侧值（选择 `8px/300ms`；右键信标 `5px/200ms`） | — |
| Q3 | CRT 模式（`mapStyle==='crt'`）在 3D 下保留为**风格开关**还是**直接删除** | 保留为风格开关（材质 + 扫描线后处理，默认关） | 影响 art-director 的材质规格与 26 处分支的清理范围 |
| Q4 | `setPhaserCommandDispatcher` 是否改名 | Phase 6 改名为 `setTacticalCommandDispatcher`（gameStore.ts 2 行改动） | 不改名会留下"Phaser"字样误导后来者；改名要碰 gameStore |
| Q5 | 是否接受"先把 30 处 `Math.random()` 换成 seeded RNG"作为 Phase 0（在 2D 版本上做） | **必须做**，否则 golden replay 无从建立 | 不做 ⇒ 整个回归验证体系失效，3827 行拆分只能靠人肉试玩 |
| **Q6（S 级）** | **单位制采用哪一套**：工程侧 `1 unit = 六边形间距` vs art 侧 `1 unit ≈ 15 px` | **工程侧**，换算 `V_eng = V_art / 3` | **阻塞开工**：两套数值无法对接；art 侧的固定换算会让相机/LOD/拾取阈值需按 `hexRadius` 写 5 套参数 |
| **Q7（S 级）** | **LOD 距离阈值重新标定**：art 侧的 `8 / 20` 换算后是 `2.67 / 6.67` 工程单位，而默认视距是 24 ⇒ **默认视角下所有舰船都是 billboard** | 改为工程单位的 `< 8 / 8–24 / > 24` | 不标定 ⇒ 3D 化的核心卖点（看到立体舰队）在默认视角下消失 |
| **Q7b** | `minDistance` 取 UX 的 1.44 格、工程折中的 4 格，还是工程原拟的 8 格 | **4 格**（可见 5.9 格；一支完整舰队跨度 2.5 格） | UX（design-strategist） |
| **Q8** | `fov` 取 45°（战略层同款）还是 UX 推导用的 50° | **45°**（下缘有效仰角 4.5° > 0，更安全） | art + UX |
| **Q9** | **事件相机（一骑讨 / 最后一击 zoom）是否保留**（UX `05` R-16 认为会丢失空间定向） | **默认关闭**，改「时间减速 + 台词卡 + 双高亮」。**这是行为变更** | **用户** |
| **Q10/Q11** | 平移速度三档（UX `06`）/ 拾取代理体 `MIN_PX=12px`、回退圆域 `18px` | 采纳 UX 值 | UX |

---

## 6. 关联文档

- 视觉规格：`docs/art/3d-tactical-battle/`（`README.md` / `ship-assets.md` / `materials-and-lighting.md` / `signature-effects.md`）
- 交互与可读性规格：`docs/design/3d-tactical-battle/`（`01` 信息架构 / `02` 交互规格 / `03` CP 命令流程 / `04` 反馈通道 / `05` 可读性风险 / `06` 可访问性与动效）
- 参考实现（3D 范本）：`frontend/src/game/three/ThreeStrategicMap.ts`（2131 行）
- 参考挂载方式：`frontend/src/components/meta/StrategicScreen.vue`（`initStrategicEngine` / `onHoloBoardAnchor` / `handleResize` / `onUnmounted`）
- CP 系统：`frontend/src/services/CommandPointSystem.ts`（纯计算层，无 Phaser/Vue 依赖 —— 是本次拆分的**正确范式**）
