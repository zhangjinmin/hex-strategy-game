# 战斗僵持修复报告：军议任务 id 空间错配 + 敌方迷雾期龟缩（v64）

- 日期：2026-09-30
- 症状（用户实报）：战斗画面在动、按钮可用，但双方分不出胜负、战局不推进（"僵持打不完"）；
  卡住前刚"打开军议/下达任务"。附带左上舰队卡第二行被裁切（"只有一半"）。
- 结论先行：**双根因叠加**——①军议下达的任务因 id 空间错配在 1 个解算周期内静默消亡；
  ②敌方主力在迷雾期掉进 hold_point 兜底、开局龟缩永不接敌。两修复 + UI 卡片布局修复
  已落地并经三相探针、受控全流程、终验探针（18/18）与台架定量闭环。

---

## 1. 根因

### 1.1 id 空间错配（任务静默消亡）
| 环节 | 位置 | id 口径 |
|---|---|---|
| 军议 UI 下达 `attack_fleet`/`support_fleet` | `CouncilWarRoom.targetOptions` | **阵营 id**（`enemyFactions.map(f=>f.id)`） |
| 任务解算 `executeMissionTick` | `BattleScene` 1Hz 循环 | **舰队 id** 精确查找 |
| 舰队 id 生成（演习轨道） | `spawnInitialFleets:1488` | `Math.random()` 浮点 |
| 舰队 id 生成（战役轨道） | `gameStore:1433-1434` | `++globalFleetSeq` |

演习轨道两命名空间永不相交 ⇒ 查找恒空 ⇒ 任务静默 `clearMission`（下达后 1 秒内消亡），
玩家意图（攻击/支援）从未进入机动牵引链（`_missionDest`）——战局退回无任务默认行为。

### 1.2 敌方主力迷雾期龟缩
`planFactionBattle`（`BattleScene:1173`）assault 分支条件 `idx===0 && enemyFleets.length>0`。
迷雾期 `enemyFleets=0`（getKnownContact 可靠接触门）⇒ 主力掉进 `isLast && cautious` 的
hold_point fallthrough ⇒ 敌方开局 `stance='defend'` 驻守原地。双方都不主动推进 ⇒
"僵持打不完"的观感（探针实测：HP 全程零损伤、敌距仅以 ~28px/s 匀速接近）。

## 2. 修复

1. **`TacticalCommandSystem.resolveMissionTargets`（新纯函数，契约唯一实现）**——
   Mission 契约「targetId = 舰队 id **或** factionId」：relation 过滤存活舰队（有舰在编）→
   舰队 id 精确命中优先 → 无则 factionId 命中取距 from 最近 → 全无 = 空数组（任务完成）。
   `executeMissionTick` 的 attack_fleet/support_fleet 分支接入（support 同队且排除自己）。
2. **`planFactionBattle`**：主力（idx===0）恒领突击；迷雾期 `enemyFleets=0` 时降级
   `targetId=敌方阵营 id`（同一契约的阵营语义）。
3. **UI**：GameHeader 卡片 `max-height:132px + overflow:hidden` → `200px + overflow-y:auto`
   （实测卡高 94px ⇒ 两行 2×94+10=198 口径；旧值把第二行切在标题条）。
4. **3D 分队标签**：后缀由固定「·分队」改为 `_maneuverIntent`（两翼包抄一次拆 2 队时固定后缀
   必然重名；intent 同一战法内各路互异，如 左翼包夹/右翼包夹；无 intent 落回「·分队」）。

## 3. 定量验收

### 3.1 三相探针 `_probe_stall.mjs`（自然观察 → 阵营 id 任务 → 舰队 id 任务）
| 指标 | 修复前 | 修复后 |
|---|---|---|
| PhaseB（UI 同构·targetId=阵营 id）任务存活 | `m=[-M]`（1 窗内消亡） | `m=[MM]` 持续存活至终态 |
| 敌方开局任务 | `hold_point/坚守指定空域` | `attack_fleet/81/攻击 莱因哈特舰队` |
| 150s 窗口 HP | 70240/72640 全程零损伤 | 双向互冲、损伤建立 |
| 敌距闭合速率 | ~4px/s（匀速接近=僵持观感） | **7.3px/s**（加速闭合） |

### 3.2 受控全流程 `_probe_freeze.mjs`（260px 摆位）
engaging→retreating→**gameOver=true（t+100s）** 战终闭合；errN=0；fiScroll=94=fiClient（2 卡不裁）。

### 3.3 终验探针 `_probe_ui6.mjs`（5 提督×敌 5 支「总力战」= 真实 10 阵营）：18/18
| 判据 | 结果 |
|---|---|
| A4a 开战早期窗口敌方母舰队任务 | **5/5 = attack_fleet**（零 hold_point） |
| A1 六卡两行布局 | rows=2、scrollH=198≤200、每卡完整可见 |
| A2 超两行滚动契约 | 16 卡 4 行 scrollH=406>200、overflowY=auto、任意卡可滚动完整露出 |
| A3 分队标签 | 我方分队 5/5 在场 = 母队名·意图；同母 2 队互异；全场 12 名唯一；无孤儿标签 |
| A3h 敌方缺席标签 | 7/7 处迷雾未确认档（last_known/hidden）= 设计行为（`isFleetIntelVisible` 门） |
| A4c 页面异常 | consoleErrors=0 |

### 3.4 门槛与台架
vue-tsc `--noEmit` EXITCODE=0；`go build ./...` EXITCODE=0。
battleFlowAuditSim 33/33、missionResolveSim 8/8（新建）、clusterAiSim 28/28（修活）、
fleetKinematicsSim 10/10、uiCommandSim 31/31、tacticalCombatSim 10/10。

## 4. 教训（已制度化进项目记忆）
1. **探针双实例坑**：改源码后 vite HMR 把 App 侧导入重写为 `?t=` 时间戳 ⇒ 探针裸 URL import
   拿到另一模块实例（`getGameInstance()`=null 但游戏正常）⇒ 从 resource timing 发现真实 URL
   多变体试实例。
2. **Node ESM 无扩展名导入坑**：`import './clusterAI'`（vite/vue-tsc 标准）在 require() 激活
   ESM 图时 ERR_MODULE_NOT_FOUND ⇒ 台架侧 `Module.registerHooks` 补 `.ts` 重试；
   TS 4.9.5 不支持 `allowImportingTsExtensions`/`moduleResolution:"Bundler"` ⇒ 禁改源码迁就台架。
3. **晚期任务采样零判别力**：任务会被消费/清空，判「任务链/龟缩」必须采开战早期窗口。
4. **固定后缀不具备区分度**：标签后缀必须取同一生成器内各实例互异的字段；探针断言不得写恒真式。

## 5. 遗留
- P2 全量（六方向运动学）/P3 立体军阵/P4 决策应变：待用户裁决（`29-tactical-cluster-kinematics-review.md`）。
- 本轮改动未提交（git 写操作需逐次授权）：15 文件修改 + 7 新增（含本报告）。
