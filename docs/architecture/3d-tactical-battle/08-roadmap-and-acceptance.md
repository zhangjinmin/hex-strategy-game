# 08 · 分阶段实施路线与验收标准

> 读者：接手开发者 + team-lead。
> 每一阶段的验收标准都必须**能跑、能看、能测**。禁止出现"完成开发""联调通过"这类无法判定的条目。
> 每条验收项都给了**具体命令**或**具体数值判据**；做不到就标 `[PLACEHOLDER]`，不许含糊过关。

---

## 0. 通用门禁（每个阶段都必须过）

| 编号 | 命令 | 判据 | 备注 |
|---|---|---|---|
| **G-1** | `cd frontend && npx vue-tsc --noEmit` | **exit 0，0 error** | **基线已实测：当前 0 error，耗时 23s**（2026-08-30）。任何阶段不得回退 |
| **G-2** | `cd frontend && npm run build` | exit 0，产物生成 | `= vue-tsc --noEmit && vite build` |
| **G-3** | golden replay 全量 | 3 个 case **全部 PASS** | 命令见下方 §0.1 |
| **G-4** | 冒烟 | `wails dev` → 主菜单 → 演习 → 开战 → 打完一局 → 回主菜单 → 进战略层 → 再进一次战斗 | 无 console error；无白屏；无内存泄漏（第 3 次进战斗时 `performance.memory.usedJSHeapSize` 相对第 1 次的增长 ≤ 20%） |
| **G-5** | 文档同步 | 本目录下所有 ADR 的"验证方式"表中，本阶段涉及的编号全部记录实测值；仍是推导值的保留 `[PLACEHOLDER]` 标记 |

### 0.1 golden replay harness（Phase 0 建立，后续全程使用）

```
# 目录
frontend/tests/tactical/
├── replay.ts                    # 入口：--case <name> --mode record|verify [--ticks N] [--seed S]
├── setups/                      # 3 个 case 的 BattleSetupConfig 构造
│   ├── skirmish-normal.ts
│   ├── campaign-iserlohn.ts
│   └── skirmish-sim.ts
├── golden/                      # 录制的基线（JSON + digest 数组）
└── README.md
```

**运行命令**（在 `frontend/` 目录下执行）：

```bash
# 录制基线（仅在 Phase 0 或有意的规则变更后执行）
npx esbuild tests/tactical/replay.ts --bundle --platform=node --format=esm \
  --outfile=.tmp/replay.mjs --log-level=warning \
  && node .tmp/replay.mjs --case skirmish-normal --mode record --seed 20260830 --ticks 3000

# 验证（每次改动后必跑）
npx esbuild tests/tactical/replay.ts --bundle --platform=node --format=esm \
  --outfile=.tmp/replay.mjs --log-level=warning \
  && for c in skirmish-normal campaign-iserlohn skirmish-sim; do \
       node .tmp/replay.mjs --case $c --mode verify --seed 20260830 --ticks 3000 || exit 1; \
     done
```

**观测向量与摘要算法**（实现必须逐字照做，否则基线不可比）：

```ts
// 每 tick 的观测向量（按稳定顺序序列化后取 FNV-1a 32 位摘要）
interface Observation {
  tick: number;
  aliveUnits: number;
  hpSum: number;                                  // 所有存活单位 hp 之和（float64 原始值）
  units: [id, round(x*100), round(y*100), round(hp*100), classId, alive][];   // 按 id 升序
  tileOwners: number[];                           // 按 (q, r) 字典序
  factionGold: number[];                          // 按 factionId 升序
  events: string[];                               // 本 tick 事件序列化： `${t}|${...字段}`
}
const digest = (o: Observation) => fnv1a32(JSON.stringify(o));
```

**判据**：
- 3 个 case × 3000 tick，**逐 tick 摘要全部相等**。
- 首次不一致时输出 `FAIL: case=<x> tick=<t> expected=<h1> actual=<h2>` 并 dump 该 tick 的完整 `Observation` 便于 diff。
- `hp` 用 `round(hp*100)` 比较（容忍 float 累积误差 < 0.01）。

**为什么这套能成立**：Phase 0 之后所有随机源都是 seeded 的 ⇒ 相同 seed + 相同 tick 序列 = 完全相同的结果，**包括画面**。⇒ 截图也可作为回归证据（见各阶段的"截图对照"验收项）。

---

## Phase 0 — 前提工程：让回归可验证

> **这是阻塞项。Phase 0 不完成，后面所有阶段都无法验证正确性。**
> 本阶段**不改任何渲染**，画面与现在完全一致。

### 任务

| # | 任务 | 涉及 |
|---|------|------|
| P0-1 | 把 `BattleScene.ts` 中 **30 处 `Math.random()`** 替换为注入的 seeded PRNG（`mulberry32`，复用 `ThreeStrategicMap.ts:30` 的实现）。RNG 实例挂在 `BattleScene` 上，种子来自 `tacticalState.seed`（缺省 `Date.now()`） | 30 处 |
| P0-2 | 把 `this.time.now`（5 处）改为 `BattleScene` 内部累加的 `nowMs`（每帧 `+= dtMs`）。**数值语义不变**，只是来源从 Phaser 时钟改为自有时钟 | 5 处 |
| P0-3 | 加 `dtMs` 上限：`const dtMs = Math.min(rawDt, 100)`。防止切标签页回来后一帧跑完整场战斗 | 1 处 |
| P0-4 | 建立 `tests/tactical/` harness（见 §0.1） | 新增 |
| P0-5 | 录制 3 个 case 的 golden 基线 | 新增 |

### 验收标准

| 编号 | 判据 |
|---|---|
| **V-P0-1** | `grep -c "Math.random()" frontend/src/game/scenes/BattleScene.ts` → **0** |
| **V-P0-2** | `grep -c "this.time.now" frontend/src/game/scenes/BattleScene.ts` → **0** |
| **V-P0-3** | 用同一 seed 连跑 3 次 `skirmish-normal`，三次的 digest 数组**完全相同**（证明确定性成立） |
| **V-P0-4** | 用 20 个不同 seed 各跑一局，输出 `winner / totalTicks / 玩家方最终 hp%`。**判据：胜率在 30%–70% 之间，无全胜/全败**（证明换 RNG 源没有引入系统性偏差） |
| **V-P0-5** | 人工试玩 3 局，确认 AI 行为与改造前**无可见差异**（包抄、撤退、变阵、塔攻击、要塞开火全部正常）。截图存档至 `evidence/phase0/` |
| **V-P0-6** | G-1 / G-2 / G-4 通过 |

---

## Phase 1 — 抽取规则内核（**画面不变**）

> 目标：`TacticalSim` 成立，`BattleScene` 变成"薄壳 + 2D 渲染适配器"。
> **本阶段结束时，玩家看到的画面必须与 Phase 0 完全一致。**

### 任务

| # | 任务 | 规模 |
|---|---|---|
| P1-1 | 新建 `frontend/src/game/tactical/`，迁 `BattleView.ts` / `BattleEvents.ts` / `rng.ts` / `mathx.ts` | ~320 行 |
| P1-2 | **位置权威迁移**：`u.sprite.x/y` → `u.x/u.y`（读 72 处 + 写 2 处）。数值语义逐字不变 | 74 处 |
| P1-3 | **`phaserProjectiles` 升格**：从 `update()` 里的渲染数组改为规则层 `ProjectileState[]`，快照暴露 `ProjectileView` | ~60 行 |
| P1-4 | **舰载机伤害出 tween**：`onComplete` 里的 `targetShip.hp -= dmgPerFighter`（BattleScene.ts:2870）改为规则层的"延迟伤害队列"（`{applyAtMs, dstUnitId, damage}`），tween 只做飞行动画 | ~25 行 |
| P1-5 | 迁规则方法到 `TacticalSim`：`initFactions` / `buildMapData` / `buildCampaignEnvironment`（数据部分）/ `scaleMapForFleetCount` / `updateSupplyNetwork` / `processSupplyAndCapture` / `getTerrain*` / `calculateFleetPower` / `isAdjacentToTeam` / `getVisionRange` / `getIdealEngageDist` / `checkBattleStage` / `updateScriptPhase` / `updateReinforcement` / `checkGameEnd` / `pointToSegmentDist` / 要塞的计时与目标选择 | ~1100 行 |
| P1-6 | 迁 `update()` 中 2148–3046 的舰队主循环（视野/状态机/目标/位移/阵型/开火/伤害） | ~900 行 |
| P1-7 | `BattleScene.update()` 改为：`if (paused) {...} sim.tick(dt, nowMs); this.render2D(sim.view, sim.drainEvents());` | — |
| P1-8 | **拆分 `fortressWeapon`**：计时/目标/伤害 → 规则层 `FortressState`；`laserGraphics/chargeGraphics/hpBarBg/hpBarFill` 留在 2D 适配器 | ~40 行 |

### 验收标准

| 编号 | 判据 |
|---|---|
| **V-P1-1** | **golden replay 3 个 case 全部 PASS，逐 tick 相等**（G-3） |
| **V-P1-2** | `npx esbuild frontend/src/game/tactical/TacticalSim.ts --bundle --platform=node --format=esm --outfile=.tmp/l1.mjs --log-level=warning` 成功，且 `grep -cE "three|phaser|document\.|window\." .tmp/l1.mjs` → **0**（规则层零渲染依赖） |
| **V-P1-3** | `grep -rn "sprite\.x\|sprite\.y" frontend/src/game/tactical/` → **0 命中**（规则层不再读渲染对象坐标） |
| **V-P1-4** | 在 `random` 地图 + 8 舰队最坏场景下，`TacticalSim.tick` 的 p95 耗时 ≤ **3.0 ms**（插桩 `performance.now()`，跑 1800 帧取 p95） |
| **V-P1-5** | **截图对照**：对 5 个固定 seed × 固定 tick（0 / 300 / 900 / 1800 / 3000）各截一张图，与 `evidence/phase0/` 同名图并排比对。**判据：舰船位置、血条、地块归属、要塞状态一一对应；允许像素级抗锯齿差异** |
| **V-P1-6** | G-1 / G-2 / G-4 通过 |

---

## Phase 2 — 事件化 + 逻辑优化（**画面不变**）

### 任务

| # | 任务 | 规模 |
|---|---|---|
| P2-1 | 把 37 处 `this.tweens.add` + 8 处 `delayedCall` 的**视觉部分**改为由 `BattleEvent` 驱动：`UNIT_FIRED_LASER` / `UNIT_FIRED_MISSILE` / `UNIT_HIT` / `UNIT_DESTROYED` / `TILE_CAPTURED` / `FORTRESS_CHARGE_START` / `FORTRESS_FIRED` / `DIALOGUE` / `BANNER` / `SHAKE` / `CP_EFFECT` / … | ~200 行 |
| P2-2 | 事件只携带逻辑坐标与实体 id，**不含视觉参数**（ADR-001 规则 3） | — |
| P2-3 | 性能优化 O1（平方距离）、O2（视界源缓存）、O3（价值地块索引）、O4（塔索引）—— 见 `07-adr-006` §6.2 | ~80 行 |
| P2-4 | 自研 `MicroTween`（ADR-005 §4.2），2D 适配器改用它（**先不删 Phaser tween，两套并存直到 Phase 5**） | ~150 行 |
| P2-5 | 把 `store.fleetsUI` 与 `store.factions` 的写入从"每帧"改为 **10Hz 节流**（ADR-004 D2），2D 适配器的浮标位置改由适配器直写 DOM | ~40 行 |

### 验收标准

| 编号 | 判据 |
|---|---|
| **V-P2-1** | **golden replay 3 个 case 全部 PASS**（证明 P2-1 与 P2-3 未改变任何规则结果） |
| **V-P2-2** | 事件序列单独 digest 比对：把 3 个 case 的全部事件按序序列化取摘要，与 Phase 1 结束时录的基线**相等** |
| **V-P2-3** | `TacticalSim.tick` p95 ≤ **1.5 ms**（从 Phase 1 的 3.0ms 优化下来；若达不到，说明 O3/O4 未生效） |
| **V-P2-4** | 逻辑通道（写 Pinia）p95 ≤ **0.3 ms/帧**（Chrome Performance 中 `updateComponent` + script 部分） |
| **V-P2-5** | **截图对照**：与 `evidence/phase1/` 逐张比对，5 seed × 5 tick 共 25 张，**一一对应** |
| **V-P2-6** | `MicroTween` 单元验证：对 37 处 tween 的参数逐个构造，与 Phaser 在 `t ∈ {0, 0.25, 0.5, 0.75, 1} × duration` 上的插值输出**误差 ≤ 1e-6** |
| **V-P2-7** | G-1 / G-2 / G-4 通过 |

---

## Phase 3 — Three 骨架（**第一次能看**）

### 任务

| # | 任务 | 规模 |
|---|---|---|
| P3-1 | 新建 `frontend/src/game/three/ThreeTacticalBattle.ts` + `tactical/{boardMesh,shipMesh,cameraRig,postfx}.ts` | ~900 行 |
| P3-2 | 坐标系实现（ADR-002）：`S = 1/(√3·hexRadius)`、`worldX/Z/Y` 分解、`CylinderGeometry` 朝向 | ~120 行 |
| P3-3 | 棋盘：顶盖 + 裙边两个 `InstancedMesh`，归属色 `instanceColor`，顶面描边 shader | ~260 行 |
| P3-4 | 舰船：`InstancedMesh` per `(faction × class)` + 独立旗舰 mesh | ~320 行 |
| P3-5 | 相机：`OrbitControls`（只负责 Orbit + 阻尼）+ 自研平移（`中键+Shift` / `WASD` / 方向键，按像素速度）+ 自研缩放（离散 8 档、朝光标推进）+ `CameraShaker` + 帧率无关子步阻尼 | ~280 行（比原估 +120） |
| P3-6 | 拾取：分层拾取（膨胀代理体 → 屏幕空间圆域兜底 → 编队标记 → 空域）+ **忽略遮挡**（P1）+ 结果映射到 fleetId（P2）+ 输入语义映射（UX 版） | ~200 行（比原估 +80） |
| P3-7 | `TacticalHost`（帧循环 / 输入 / 定时器 / store 桥接）+ `TacticalScreen.vue` | ~480 行 |
| P3-8 | **影子模式**：`?renderer=both` 时 2D 与 3D 并列渲染（同一 `TacticalSim`） | ~60 行 |
| P3-9 | `frontend/src/game/config/tacticalVisual.ts`（CRT 常量 + 高度表 + 泳道表） | ~80 行 |
| **P3-10** | **两档缩放预设 + 一键切换**（`distanceForShipPx()` 反解、全局档按地图自适应、几何插值 tween、三档可访问性时长、过渡期输入互斥）—— ADR-003 §3.7；**全局档改正交相机**（`OrthographicCamera` 双相机切换 + `minPolarAngle` 顶视例外 + 正交分支的 LOD/拾取/雾/抖动）—— ADR-008 §2–§5 | ~110 行 + **~60 行**（正交相机路径） |
| **P3-11** | **LOD px 判据**（每帧算 `pxPerHex`、四档 + ±4px 滞回、按舰队统一档位）—— ADR-006 §3.2 | ~70 行 |
| **P3-12** | **棋盘 B5 三层结构**（基板 + 顶盖 16 块分块 + 高格裙边阈值 0.25）—— ADR-006 §2.2 | ~180 行 |

**本阶段不做**：后处理、特效池、伤害数字、意图线、小地图、**战术雷达**、**CP 目标选择补完（P4）**。

### 验收标准

| 编号 | 判据 |
|---|---|
| **V-P3-1** | **能跑**：`wails dev` → 演习 → 战斗正常进入，无 console error；`?renderer=both` 下左右并排（或上下分层）同时显示 2D 与 3D，两者**舰船位置同步移动** |
| **V-P3-2** | **能看**：棋盘正确渲染 1951 格；归属色与 2D 一致；六边形朝向与 2D 一致（尖角朝屏幕上下）—— 截图与 2D 对照 |
| **V-P3-3** | **能转能移能聚焦**：中键拖拽=旋转；`中键+Shift` / `WASD` / 方向键=平移；滚轮=离散 8 档缩放且朝光标推进；`F`=聚焦选中编队（角度与距离不变）；`Home`=复位。
  判据：`polar ∈ [14.4°, 63°]`、`distance ∈ [4, 120]`（A3-7）；`polar=63° & distance=4` 时截图确认看不到舰船底面；A3-10（离散档位 + 朝光标，位移 ≤ 2px）、A3-11（60fps 与 30fps 下旋转停止时间差 ≤ 15%）通过 |
| **V-P3-4** | **能点**：左键点舰船 → 选中其所属舰队；`Alt+左键` → 选中单舰；左键点中立邻接地块 → 扣金币且地块变色；右键点地块 → 出现「战术信标已部署」toast（文案逐字对比 `BattleScene.ts:946`）；右键拖拽 → 旋转且不投放信标。
  判据：A3-1（误选率 = 0）、A3-3（输入语义全通过）、A3-9（拾取可达性 P1/P2：重叠后排仍可选、5px 远舰必中、返回 fleetId） |
| **V-P3-5** | **坐标自洽**：A2-1（1951/1951 往返相等）、A2-2（5 种 `hexRadius` 下世界宽度 = 50.0 ± 0.01）、A2-4（舰船四向朝向正确）全部通过 |
| **V-P3-6** | **性能**：`renderer.info.render.triangles ≤ 30,000（峰值）/ 36,000（硬上限）` 且 `calls ≤ 180`（A6-1）；`renderer.sync` p95 ≤ **8.0 ms**（A6-3） |
| **V-P3-7** | **golden replay 3 个 case 全部 PASS**（证明 3D 渲染没有反过来污染规则层） |
| **V-P3-8** | G-1 / G-2 / G-4 通过 |
| **V-P3-9** | **两档切换**：A3-12（距离符合 §3.7.1 表格、切换过程匀速、polar/azimuth/target 方差 = 0、过渡中可被打断）、A3-13（三档时长 500 / 600 / 0 ms）全部通过 |
| **V-P3-10** | **两档切换后预算不退化**：A6-8 —— 连续切换 20 次，每次读数 `triangles ≤ 30,000`；**全局档（L2 正交）按 A8-4 读数 `≤ 26,000`**（Q9 方案 B 后全局档不再是最省档，见 ADR-008 §6） |
| **V-P3-11** | **LOD 无抖动**：A6-9 —— 缓慢推拉穿过 48 / 24 / 12 px 三个边界各 5 次，每个边界切换次数 **= 5**（不是 10+） |
| **V-P3-12** | **棋盘无穿帮**：在 `polar = 63° & distance = 4` 下截图，确认低格（`pending` 0.22）与高格（`fortress` 0.85）之间没有露出背景的缝隙（B5 基板的验证） |

---

## Phase 4 — 特效、后处理、Vue 契约（**视觉对齐**）

### 任务

| # | 任务 | 规模 |
|---|---|---|
| P4-1 | `fxPool.ts`：激光 / 导弹 / 涟漪 / 爆炸 / 伤害数字 / 尾焰 / 光环 / 舰载机 8 个 InstancedMesh 池 | ~380 行 |
| P4-2 | `postfx.ts`：Bloom（0.5× 分辨率）+ CRT ShaderPass，移植自 `ThreeStrategicMap.ts:405-445` | ~120 行 |
| P4-3 | WebGL 能力探测 + 三档画质（ADR-006 §5.1） | ~60 行 |
| P4-4 | `onFleetHudAnchor` 接通，舰队浮标跟随（ADR-004 §2） | ~80 行 |
| P4-5 | `commandBridge` 流程接通：空格 → 面板 → 选目标 → 执行；`setTargetingMode` | ~60 行 |
| **P4-9** | **CP 目标选择的交互呈现层（Q8 定案后范围收窄）**：合法目标脉动轮廓 + **编号徽章 ①②③**（按距玩家舰队升序，每 100ms 重算）、`1`–`9` 数字键快选、非法目标降饱和 60%、高成本命令二次确认条（`cpCost ≥ 3 \|\| cooldownMs ≥ 240000`）、点空不取消选择态、目标失效撤销；**外加**：`EffectView` 快照字段、渲染层通用效果图标槽位 + 进度环 + `registerEffectVisual` 扩展点、未实现命令禁用态 | **~330 行**（其中包含 P4-9a/b，见下） |
| **P4-10** | **战术雷达**：2D Canvas 覆盖层（ADR-006 §4.1），复用 `ThreeStrategicMap.drawMinimap` 画法，分层重绘（地块按 `tiles.revision`、舰队每帧） | **~150 行** |
| P4-6 | 意图线（若 Q3 通过） | ~90 行 |
| P4-7 | 复活 `store.battleDialog` / `addBattleLog`（若 A4-Q3 / Q4 通过） | ~35 行 |
| P4-8 | 自动降级阶梯（ADR-006 §7） | ~70 行 |

> **P4-9 / P4-10 的工作量说明**（**Q8 定案后重新估算**）：
>
> Q8 之前我估 P4-9 = 400 行，那包含了"9 个命令效果要重新验证平衡"的隐含包袱。层 2 独立立项后，P4-9 收窄为**纯交互呈现层**：
>
> | 子项 | 行数 | 说明 |
> |---|---|---|
> | P4-9a 拾取与命中测试 | 200 | **已计入 P3-6**，此处不重复计算（分层拾取无论是否补完 CP 都要做） |
> | **P4-9b 目标选择交互层** | **240** | 状态机（进入/退出/点空不取消/目标失效撤销）80 + 高亮与徽章 120 + `1`–`9` 快选 40 |
> | P4-9c 二次确认条 | 60 | `cpCost ≥ 3 \|\| cooldownMs ≥ 240000` |
> | **P4-9d 效果扩展点** | **100** | `EffectView` 快照 + 通用图标槽位 + 进度环 + `registerEffectVisual` 注册表（**不含任何具体效果实现**） |
> | **P4-9e 命令可用性四态** | **130** | 静态表 15 + 宿主 `computeAbilityState()` 30 + `commandBridge` 新增 3 字段 + **CommandPanel.vue 四态改造 85 行**（模板 15 + 脚本 40 + 样式 30）+ 文案表 + `settingsStore` 1 字段。**R2 估 30 → R3 估 130**，增量来自四态分流、两种反馈通道、可访问性（可 focus + 读屏） |
> | **P4-9 合计（扣除已计入 P3-6 的 200）** | **~530** | Q8 前 400 → Q8 后 430 → **四态校正后 530**。增量 = 效果扩展点 100（Q8 硬要求）+ 四态 100（设计侧 `10-disabled-command-state.md` 规格） |
>
> - **P4-10 战术雷达 ≈ 150 行 / +1 天**。成本低的三个原因：① 战略层有可移植的 2D canvas 实现（`ThreeStrategicMap.drawMinimap`）；② 数据完全来自 `BattleView`，**不给规则层加任何新接口**；③ 选 **2D Canvas 而非正交相机** ⇒ **0 draw call** 且不受 Bloom/CRT 污染（选型对比见 ADR-006 §4.1）。
> - **两者合计 +580 行 / +3–4 天，全部落在 Phase 4**，不影响 Phase 0–3 排期，**不触碰规则层的数值与公式** ⇒ 不产生规则回归，golden replay 仍有效。
>
> **本次明确不做（层 2 范围）**：任何命令效果的规则实现；`getSpeedMultiplier` / `getMoraleModifier` / `getActiveEffects` 的调用；`reflect` / `teleport` / `heal` 的 handler；`isDefending` 拆分；效果数值平衡。完整清单见 `10-adr-007` §5.2。
> **评审红线**：本次 PR 若碰到 `frontend/src/services/CommandPointSystem.ts`，**即越界**。

### 验收标准

| 编号 | 判据 |
|---|---|
| **V-P4-1** | **三大招牌特效 1:1 对照**：按 `docs/art/3d-tactical-battle/signature-effects.md` 的基准值（护盾涟漪 `rx 0.311→0.711 / ry 0.178→0.400 / span 0.45→0.6π / 1100ms`；激光 `900ms / Expo.easeOut`；尾焰 `3:1 长宽比 + 双频闪烁`）录屏 2D 与 3D 各一段，**art-director 目视签字确认视觉等价** |
| **V-P4-2** | 伤害数字、爆炸、舰载机、尾焰、光环全部出现且数量正确（一艘航母 6 架舰载机、一次齐射 6 发导弹） |
| **V-P4-3** | **性能**：最坏场景（8 舰队齐射 + 要塞开火）下 `triangles ≤ 60,000` 且 `calls ≤ 120`（A6-4） |
| **V-P4-4** | **帧时间**：`sim p95 ≤ 3.0 ms` 且 `renderer p95 ≤ 8.0 ms`（A6-3）；整机 fps ≥ **45**（1280×720，集显） |
| **V-P4-5** | **CP 系统**：空格 → 面板弹出 → 游戏暂停 → 选一个 `requiresTarget` 命令 → 面板提示"点击战场选择目标" → 点敌方舰船 → 命令执行 + `commandBridge.cpState.currentCP` 正确扣减 + CP 效果生效（`getDamageMultiplier` 返回值改变） |
| **V-P4-6** | **CommandPanel / CommandBridge 零改动**：`git diff --stat frontend/src/components/battle/CommandPanel.vue frontend/src/services/CommandBridge.ts` → **无输出**（A4-5） |
| **V-P4-7** | **浮标跟随**：录屏旋转相机一圈，舰队浮标始终贴对应旗舰上方 45px，无滞后；`zIndex` 随远近正确遮挡（A4-4） |
| **V-P4-8** | **降级阶梯**：人为 `pixelRatio = 4` 制造卡顿，确认 L-1→L-4 依次触发；恢复后 2 分钟内逐级回退（A6-7） |
| **V-P4-9** | **golden replay 3 个 case 全部 PASS** |
| **V-P4-10** | G-1 / G-2 / G-4 通过 |
| **V-P4-11** | **CP 目标选择补完（P4-9）**：① 选一个 `requiresTarget` 命令 → 战场出现脉动轮廓 + **编号徽章 ①②③**（按距玩家舰队升序）；② 非法目标（友军 / `fuzzy` / 已灭）**降饱和 60% 且无徽章**；③ 按数字键 `1`–`9` 能选中对应徽章；④ `cpCost ≥ 3` 或 `cooldownMs ≥ 240000` 的命令弹二次确认条；⑤ **点空（虚空）不取消选择态**；⑥ 目标在确认前被消灭 → 撤销选择并提示 |
| **V-P4-12** | **战术雷达（P4-10）**：战场缩略图显示的舰队位置与 `BattleView.fleets[].x/y` 一致（随机采样 10 次比对）；地块归属着色与 3D 主视图一致；每 100ms 刷新一次且无闪烁 |
| **V-P4-13** | **新增功能不产生规则回归**：P4-9 / P4-10 完成后重跑 golden replay 3 个 case，**全部 PASS**（证明二者未触碰规则层） |
| **V-P4-14** | **效果扩展点就绪（Q8 硬要求）**：V-E1（加假效果后渲染层不报错、显示"?"图标、`ThreeTacticalBattle.ts`/`fxPool.ts`/`shipMesh.ts` 零 diff）、V-E2（渲染层产物不含 `CommandPointSystem` 任何符号）、V-E3（8–10 个未实现命令逐个：置灰 + 显示原因 + CP 不扣 + 不进选择态）、V-E4（`focus_fire` 仍生效且倍率 = 1.3）全部通过 |
| **V-P4-15** | **层 2 边界未被穿透**：本次全部 PR 的 `git diff --name-only` 并集中，**不得出现** `frontend/src/services/CommandPointSystem.ts` 与 `frontend/src/config/commandAbilities.ts`（R-19 的评审红线） |

---

## Phase 5 — 删除 2D 与 Phaser（**不可回退**）

> ⚠️ 本阶段**不可逆**。开始前必须确认 Phase 4 全部验收通过，且 `evidence/phase4/` 截图已归档。

### 任务

| # | 任务 |
|---|---|
| P5-1 | 删除 `frontend/src/game/scenes/BattleScene.ts`（3827 行） |
| P5-2 | 删除 `frontend/src/game/scenes/crt/CrtRenderer.ts`（546 行）；常量已在 P3-9 迁出 |
| P5-3 | 删除 `frontend/src/game/GameInstance.ts` 中的 Phaser 部分（改由 `TacticalHost` 承担） |
| P5-4 | 删除 `App.vue` 中 `mountGame/unmountGame` 的 import 与 `watch(gameState)` 挂载逻辑（含 `setTimeout` 轮询 hack，App.vue:274–286） |
| P5-5 | 删除影子模式（`?renderer=both`）相关代码 |
| P5-6 | 删除 2D 渲染适配器 |
| P5-7 | `mapStyle === 'crt'` 的 26 处分支收敛到 `tacticalVisual.ts`（规则层 0 处） |

### 验收标准

| 编号 | 判据 |
|---|---|
| **V-P5-1** | `grep -rn "phaser" frontend/src/game/tactical/ frontend/src/game/three/ frontend/src/components/battle/ -i` → **0 命中**（A5-1） |
| **V-P5-2** | `ls frontend/src/game/scenes/` → 只剩 `EditorScene.ts`（+ 本次不动的 `StrategicScene.ts*`） |
| **V-P5-3** | `document.querySelectorAll('canvas').length` 在战斗中 = **1**（A5-3） |
| **V-P5-4** | `git diff --stat` 显示**净删除 ≥ 4,000 行**（`BattleScene.ts` 3827 + `CrtRenderer.ts` 546 − 新增的适配器残留） |
| **V-P5-5** | **golden replay 3 个 case 全部 PASS** |
| **V-P5-6** | **存档兼容**：用 `build/HexFront_Saves.json` 的 `autosave` 与 `slot_1787037677176` 两个档各读一次，确认：①读档不报错 ②战略层能进入 ③能触发一次战斗 ④战斗结束能回写。**存档文件本身的 checksum 在"只读不写"操作前后不变** |
| **V-P5-7** | **全量冒烟**：G-4 的完整路径跑 3 轮；第 3 轮结束时的 `usedJSHeapSize` 相对第 1 轮开始增长 ≤ **20%**（无内存泄漏） |
| **V-P5-8** | G-1 / G-2 通过 |

---

## Phase 6 — 收尾（可选）

| # | 任务 | 前置 |
|---|---|---|
| P6-1 | `setPhaserCommandDispatcher` → `setTacticalCommandDispatcher` 改名（gameStore.ts 2 行） | Q4 / A4-Q5 通过 |
| P6-2 | 小地图（移植 `ThreeStrategicMap.drawMinimap`） | Q4 通过 |
| P6-3 | 画质档位写进 `settingsStore`，暴露到设置面板 | A6-Q5 通过 |
| P6-4 | 回填所有 `[PLACEHOLDER]` 的实测值 | 目标机型实测完成（A6-5） |
| P6-5 | 删除死代码 `StrategicScene.ts` / `.bak` | A5-Q1 通过 |

---

## 阶段间的硬依赖

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
  │            │            │
  │            │            └─ 优化必须在事件化之后（事件是观测手段）
  │            └─ 规则抽取必须在 golden 基线存在之后
  └─ golden 基线必须在 Seeded RNG 之后（否则不可复现）
```

**不允许跳阶段**。特别是：
- **不许在 Phase 0 之前动任何一行业务代码** —— 否则 golden 基线失去意义。
- **不许把 Phase 3（3D）提前到 Phase 1 之前** —— 否则无法区分"渲染 bug"与"规则 bug"。

---

## 估算（供排期，非承诺）

| 阶段 | 新增/修改 | 删除 | 净 |
|---|---|---|---|
| Phase 0 | ~80 行 + 测试 harness ~300 行 | — | +380 |
| Phase 1 | ~1,500 行（规则层）+ ~400 行（2D 适配器） | — | +1,900 |
| Phase 2 | ~470 行 | — | +470 |
| Phase 3 | ~2,780 行（含 P3-10 两档缩放 110 + P3-11 LOD px 70 + P3-12 棋盘 B5 180） | — | +2,780 |
| Phase 4 | ~895 行 + **P4-9 目标选择交互层 430** + **P4-10 战术雷达 150** = **~1,475 行** | — | +1,475 |
| Phase 5 | ~50 行 | ~4,450 行 | **−4,400** |
| **合计** | **~6,505 行** | ~4,450 行 | **+2,055 行**（相对当前 3,827 行单文件） |

**R2 相对 R1 的估算变化**：

| 项 | R1 | R2 | 原因 |
|---|---|---|---|
| Phase 3 | 2,300 | **2,780** |

**R2 相对 R1 的估算变化**：

| 项 | R1 | R2 | 原因 |
|---|---|---|---|
| Phase 3 | 2,300 | **2,780** | +P3-10 两档缩放（110）、+P3-11 LOD px 判据（70）、+P3-12 棋盘 B5（180）；另 P3-5 相机 +120（自研平移/缩放）、P3-6 拾取 +80（分层拾取 + 忽略遮挡） |
| Phase 4 | 895 | **1,475** | **+P4-9 目标选择交互层（430，含效果扩展点 100）、+P4-10 战术雷达（150）** —— 两项均为新增功能，**均不触碰规则层** |
| **合计** | +1,245 | **+2,025** | **+780 行 / +3–4 天**（全部落在 Phase 4） |

**两项新增功能的风险特征**：都**不触碰规则层** ⇒ 不产生规则回归风险，golden replay 仍然有效，不与 Phase 0–2 的验证体系冲突。这也是我把它们全部排在 Phase 4 的原因。

最终形态：规则层 ~3,600 行（分 12 个文件）+ 渲染层 ~2,570 行（分 9 个文件）+ 宿主 ~480 行。**单文件最大行数从 3,827 降到 ~900（`TacticalSim.ts`）。**
