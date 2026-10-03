# P1 靶选与集火 + P2 提前量切片（v63）实施报告

> 日期：2026-09-30。上游提案：`docs/design/3d-tactical-battle/29-tactical-cluster-kinematics-review.md`（B 路线）。
> 本批 = 该提案执行序 **P1 全量 + P2 切片（前置追踪）**；P2 全量（舰级加速度向量）与 P3 立体军阵后置。
> 证据口径：行号以本批落盘后为准；台架全绿判据见 §5。

---

## 1. 执行决策（结论先行）

| 裁决项 | 结论 |
|---|---|
| 原诉求（编队/AI 对战/移动不满意）是否值得按 29 号 B 路线继续 | **值得**。调研（GitHub 舰船 AI/集群微操/编队/运动算法）确认：OpenRA `AutoTarget` 优先级表、Zero-K 集火/微操、gdx-ai Steering/FormationMotion、RVO2/ORCA、Reynolds Steering 与本项目"纯函数+滞回"路线兼容，借算法与参数结构、不引框架 |
| 是否存在明显更好的方案 | 无。行为树/GOAP/ECS 均被 29 号 §5 否决（框架依赖、零测试保护下大爆炸、规模未到）；共享黑板式集火表（不互相协商、订阅同一交战计划）是"军长-连长"心智模型的最低成本实现 |
| 本批最终路线 | ① `clusterAI.ts` 舰级威胁评分选靶（替换随机）② `fireCoordinator.ts` 舰队级集火表 ③ `fleetKinematics.leadInterceptPoint` 前置追踪接线 3 处追击点 |
| 风险规避 | 判定全部进纯函数模块（v29 铁律）；BattleScene 只做"快照→问模块→应用"；改行为同步改断言（battleFlowAuditSim 旧契约断言已更新）；受控输入法取证，不改任何判定状态 |

### 调研 → 本项目映射（补充 29 号 §4 之外的新证据）

| 外部真源 | 关键做法 | 本批取舍 |
|---|---|---|
| Zero-K / Heresy RTS | damage reservation 防 overkill、focus target 粘性（死亡/出界/更高优先级才换） | **粘性取**（pickShip 滞回）；**防 overkill 不取**——本作伤害为聚合结算、用户诉求是"集火秒杀/补刀"，防浪费弹药与诉求相反 |
| OpenRA `AutoTarget` | 目标优先级表 | 取（评分表驱动） |
| gdx-ai Arrive/Pursue | 前置追踪/截击几何 | 取（leadInterceptPoint） |
| UNC RVO2/ORCA、Flow fields | 千级单位避碰/共享代价场 | **不取**（本批规模百级、阵型纪律优先，留 500+ 升级路径） |

## 2. 缺陷清单 → 改法

| # | 缺陷（用户"不满意"的直接来源） | 证据 | 改法 |
|---|---|---|---|
| D1 | 开火选舰**均匀随机**：三舰各打各的，凑不出集火秒杀、残血不补刀、高威胁不压制 | 原 `BattleScene` 开火循环 `inRangeUnits[Math.floor(Math.random()*...)]` | 新 `clusterAI.ts`：`scoreShipTarget`（补刀 300 满幅 + 威胁 dps×4 + 就近 −0.25/px + 集火表加权 + 复仇 120）+ `pickShip`（滞回 12%，死亡/出界/被显著超越才换） |
| D2 | 无舰队级火力协调（"缺乏应变"观感主源） | 全项目无集火概念 | 新 `fireCoordinator.ts`：`buildFocusTable`（与舰级同一评分函数排序，表深 3）= 共享黑板；BattleScene 侧 TTL 1s / 换目标重建缓存于 `fleet._focusTable` |
| D3 | 追击=追尾（敌横向机动时"擦肩-折返"） | 3 处 `fleetTargetX = closestEnemyFleet.x/y`（siege 直冲 / 低统帅直冲 / search"疯狗咬上去"） | `fleetKinematics.leadInterceptPoint`（相对速度迭代 2 步 + 90 帧预测视界封顶；近停退化纯追踪），3 处全部改为追**汇合点** |
| D4 | 舰级受击无"谁打我我打谁"（复仇只在舰队级） | 舰级选靶无 attacker 通道 | 伤害结算两处（主炮/舰载机）写 `targetShip._lastAttackerUid/_lastAttackerAt`，`shipCandOf` 8s 窗口读取发加权 |

**设计裁决记录**：集火表 rank0 权重 = 330（**严格压过补刀满幅 300**——舰队共识不允许被单舰偏好翻掉）；rank1/2 = 180/110（**低于补刀满幅**——次要共识目标让位给"就差一炮"的补刀）。台架 A 段两条断言即此契约。

## 3. 量化验收

### 3.1 新/扩台架

| 台架 | 断言 | 结果 | 关键读数 |
|---|---|---|---|
| `scripts/clusterAiSim.cjs`（新） | 28 | **28/28** | 评分单调性 8 条；滞回/粘性 6 条；集火表 7 条；**3 舰集火收敛率 100.0%（对照组无表 49.7%）**；源码契约 5 条 |
| `scripts/fleetKinematicsSim.cjs`（扩） | 10 | **10/10** | 手算拦截点复核 (187.5,0) 一致；预测视界封顶；**截获提速 33.9%**（74 帧 vs 追尾 112 帧，速度比 2:1.5 = 舰队对舰队真实区间；试算确认提速随速度比趋近 1 单调上升） |

### 3.2 全量回归（bash for 循环逐个跑）

- `scripts/*Sim.cjs` 25 个：**全绿**（battleFlowAuditSim 33/33——唯一红灯是钉旧契约的断言"random selection"，按"改行为必须同步改断言"更新为"scored selection"，契约本体（先滤射界后选舰）不变）。
- 根目录 `_v*.cjs`：与 09-29 基线逐项一致，**零新增红灯**。5 个历史红灯定性：
  | 红灯 | 定性 |
  |---|---|
  | `_v34_spin_sim` 崩溃（找不到 `FORM_SKIP_SPIN_RAD`） | 历史遗留：该常量 v42 时代已删，`git show HEAD:` 中同样为 0 |
  | `_v38_scan_sim` 1 FAIL | 与改动面零交集（只读 balance/terrain*） |
  | `_v40_doctrine_sim` 5 FAIL | 记忆已登记"5 条旧断言 FAIL 待更正" |
  | `_v41_sim` 崩溃（`balance.FORMATION_SPIN.MODE`） | 与改动面零交集 |
  | `_v55_ai_sim` 54/55（`visibilityOf(250,500)`） | HEAD 即如此 |
- `vue-tsc --noEmit` **EXITCODE=0**。

### 3.3 L2 运行时取证（`_probe_p1_fire.mjs`，受控输入法）

构造：主菜单→战术模拟→提督→开战→回车，把敌方舰队**锚点+全舰实体**整体搬到我方舰首正前 220px（<50% 视野 = visibilityOf full 档、前向射界内）。

| 证据 | 读数 |
|---|---|
| 舰队级集火表 | 两舰队 `_focusTable` 就位，`ranks=[0,1,2]`，TTL 重建生效 |
| 舰级选靶 | 130 射手 / 6 目标（**集火度 21.67**）；108 射手 / 6 目标（18.00）；抽样 3 舰 `tgt=36/41/36`（两舰同打 36） |
| 滞回字段 | `_uid`/`_lastShipTargetUid` 全量写入，冷却相位正常（lastAtk 33000 / ivl 3500，`coolOk:false` = 刚打完在冷却） |
| 页面报错 | **0** |

⚠ 探针三坑（本批新增一条）：**只瞬移舰队锚点是假象**——单位实体按 `UNIT_FORMATION_SPEED=0.9px/帧` 慢追，实测锚距 217px 而实体相距 3337px ⇒ 永不进射程 ⇒ "零开火"假证据。受控输入必须锚点+实体整体搬移。

## 4. 改动面清单

| 文件 | 性质 |
|---|---|
| `frontend/src/game/clusterAI.ts` | 新（舰级选靶纯函数） |
| `frontend/src/game/fireCoordinator.ts` | 新（舰队级集火表纯函数） |
| `frontend/src/game/fleetKinematics.ts` | 增 `leadInterceptPoint`（纯增量，既有函数零改动） |
| `frontend/src/game/scenes/BattleScene.ts` | 接线：imports、`shipUidOf`/`shipCandOf` 助手、开火选舰块替换随机、伤害 2 处复仇台账、追击 3 处前置追踪 |
| `scripts/clusterAiSim.cjs` | 新台架 |
| `scripts/fleetKinematicsSim.cjs` | 扩 6 断言 |
| `scripts/battleFlowAuditSim.cjs` | 1 条断言契约更新（random→scored） |

## 5. 风险残留与后置项

1. **P2 全量（舰级加速度向量 + ω_max + 布阵到槽提前转向）未做**——29 号列其为四阶段中工作量最大；本批只取"前置追踪"切片。摇头=0/侧滑<15°/超调<0.3 槽宽等验收属 P2 全量。
2. **P3 立体军阵（z 分层）/ P4 形势分级/受损脱离**按执行序后置。
3. 集火表为**每舰队 × 每目标舰队**一份、TTL 1s——敌舰队分裂（taskForce 自动分兵）时表自动换 targetId 重建，暂无"跨分队联合集火"（多打一时按各舰队自己的表）。
4. `scoreShipTarget` 权重（300/4/0.25/330）为设计值，台架钉的是**单调性与收敛行为**而非绝对分值；实战手感调参只允许改 `clusterAI.ts` 常量，不许在 BattleScene 埋阈值。
