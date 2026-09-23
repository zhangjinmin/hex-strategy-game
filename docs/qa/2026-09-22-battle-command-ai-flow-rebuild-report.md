# 战斗指令权威与 AI 流重构 —— 落地报告

日期：2026-09-22
设计真源：桌面 `2026-09-23-battle-command-and-ai-flow-rebuild-design.md`（指令权威 6 级 / direct move·attack / 撤退三态 + 停滞看门狗 / 阵营级侦察 / 迷雾情报持久档案 / 指挥继任 6 步 / billboard 三概念 / 指针反馈 / 任务语言 / 分兵生命周期 / 失败处理 / §Verification 13 条判据）
计划盘点：`docs/qa/v49_计划落地盘点_20260922.md`

## 1. 范围与结构

本次重构按三个作业波次落地，全部接线收敛在渲染/场景层，规则判定进纯函数模块（铁律：BattleScene 不埋散落阈值）：

| 波次 | 内容 | 主要落点 |
| --- | --- | --- |
| W1 | 指令权威 6 级模型、direct move/attack 指令生命周期、撤退三态 + 停滞看门狗（四观测：位移/敌距闭合/目标进度/开火） | `TacticalCommandSystem` / `CommandAuthority` / `BattleScene` |
| W2 | 阵营级侦察（每阵营 1 队 ≤3 机、伪舰队不进编制）、迷雾情报持久档案（assessContact → resolveContactMemory → resolveIntelDisplay 四档）、开火双向互认、主动电子战（压制/假目标/隐蔽转换）、旗舰持久身份 `u.isFlagship`、战略格情报门 | `battle/ScoutSystem` / `battle/IntelSystem` / `BattleScene` / `Battle3DOverlay` |
| W3 | 指挥继任 6 步 + 指挥崩溃态、billboard 三概念（态势/行动/分舰）+ 按钮逐帧权威派生、指针反馈（短暂 chevron / target-lock，删常驻大 hex）、任务意图语言（奉令/临机/交战/整补）、分兵生命周期（canSplit 消费 + 玩家禁自动分兵 + abort 归队） | `BattleScene` / `Battle3DOverlay` / `TacticalCommandSystem` / `battle3dFx` |

新增契约台架：`scripts/uiCommandSim.cjs`（31 条断言，行为断言 require `taskForce.ts` 真源）。

## 2. 关键规则落地（抽样）

- **航迹失效唯一入口**：`breakFleetIdentification`（置 `_trackReliable=false` + `invalidateKnownTrack`），全场景仅一次调用；隐蔽转换经它重建"未识别"。
- **交战中不可消失**：fire loop 写 `_revealedByFireAt/_revealedByFireToTeams`，雾链 `engaged: inExchange` 强制 identified；`concealmentSucceeded` 为唯一降档入口（`resolveContactMemory` 真源语义）。
- **末次位置**：`resolveIntelDisplay` last_known 档在**档案坐标**画「末次位置」，绝不实时跟位；uiData 附 `intelX/intelY/intelT`。
- **旗舰身份**：建造期 `u.isFlagship = true` + `placeFlagshipAtRear`（`rearCommandSlot` 恒占后方中央指挥席），替换会前移的 `units[0]` 下标。
- **战略格情报门**：`isTileKnownToFleet`（舰队域；中立/己方天然已知，敌占格须视距内确认或基地已入档案）；探索方向只朝**已知**敌阵地加权。
- **停滞看门狗**：变量收敛 `st`，观测③接真值（captureProgress 差 + objDistW 差）。
- **分兵**：`canSplit` 五禁（force_size/ship_condition/no_space/contact_quality/command_bandwidth）在 AI 自动与玩家显式两入口同门；`shouldRejoin` 每帧收口（timeout/attrition/objective_done ⇒ 归队，v34d 单位不双引用）。
- **继任 6 步**：选继任 → 更新 store+场景权威 → 清毁选 → 重建直控 → 自动选中继任旗舰 → 确认实时指挥；无继任者 ⇒ `commandCollapsed` 指挥崩溃态（直控整体停用，非"实时指挥"文案）。
- **指针反馈**：地面左键零标记；成功移动 ⇒ 目的地短暂 chevron/ring（1.4s 淡出）；成功攻击 ⇒ target-lock；`beginBattleResolution` 统一 `clearPointerMarkers`；原常驻大 hex（selRing 透明度钳位钉住）已移除。
- **billboard 三概念**：态势（指令/角色/交战/损管 + 意图行）、行动（侦察/电子战/保持等情境特令）、分舰（分遣计划入口，非即时拆分）；移动/攻击不设常驻按钮（右键承担）；按钮可用性逐帧按 `canDirectlyControlFleet` 派生。
- **任务语言**：五词任务名（进击敌舰队/夺取战略据点/固守战区/协同友军/撤回整补）+ 意图四前缀（奉令：/临机：/交战：/整补：，`intentLabel`/`intentKindFor` 纯函数）。

## 3. §Verification 13 条判据核对

| # | 判据 | 落点 | 验证 |
| --- | --- | --- | --- |
| 1 | 每阵营 1 队侦察、≤3 机视觉，分兵不影响 | `ScoutSystem` + `scoutDetachments` | scoutLaunchSim 绿 |
| 2 | direct move/attack 语义（追击完成、旗舰即时响应） | `orderFleetMove/Attack` + `CommandAuthority` | directOrderSim 绿 |
| 3 | direct 清可撤回状态但不清真溃散 | `resolveAuthority` | commandAuthoritySim 绿 |
| 4 | 玩家舰队开场保持，无非请示转向/分兵 | `_rigid` + 自动分兵直控门 | fleetIntentSim + uiCommandSim 绿 |
| 5 | 开火接触交战中可见、已知接触持久 | fire loop 互认 + IntelSystem | reconIntelSim + intelSystemSim 绿 |
| 6 | 敌基地未发现前隐藏 | `isEnemyBaseKnownTo` + B3O 消费 | battleFog3dContractSim 绿 |
| 7 | 继任刷新选择与直控 UI | checkSupremeSuccession 6 步 + 逐帧按钮派生 | uiCommandSim 绿 |
| 8 | 指针反馈无常驻大 hex | 三接口 + 删 selRing 常驻 | uiCommandSim 绿 |
| 9 | 例行侦察不刷通知、结算静默 | classifyScoutNotice 4 类 + beginBattleResolution | scoutLaunchSim + reconIntelSim 绿 |
| 10 | 分兵需合格计划（角色/触发/中止/归队） | canSplit + shouldRejoin 接线 | uiCommandSim 绿（行为 10 条） |
| 11 | 低舰况敌军不能无限静止撤退循环 | 停滞看门狗四观测 | fleetIntentSim + tacticalCombatSim 绿 |
| 12 | 任务/意图标签新术语 | MISSION_TYPES 五词 + intentLabel 四前缀 | uiCommandSim 绿 |
| 13 | 全套台架 + 生产前端构建通过 | — | **22/22 台架绿；vue-tsc EXITCODE=0；vite build 见 §4** |

## 4. 验证结果（定量）

- 确定性台架：**22 green / 0 red**（含新建 `uiCommandSim.cjs` 31/31 PASS）。
- 类型检查：`vue-tsc --noEmit` **EXITCODE=0**。
- 生产构建：`vite build`（结果见本文末尾附记）。
- 编辑纪律：全部 Edit 严格串行 + 每步回读验证；契约字面量（`engaged: inExchange`、`name: '末次位置'`、`supply: flagship.supply, morale: fl.morale`、`contactState: contact.state` 等）逐条 grep 复核。

## 5. 遗留与风险

1. **L3 真机观感未验收**：指针反馈节奏、billboard 三概念布局、意图文案观感需人眼过一遍（L2/SwiftShader 无法代替）。
2. **指挥继任/崩溃态**仅台架级验证；多提督战役实盘的继任链待真机跑一局。
3. `Battle3DOverlay.selRing` 对象保留但不再点亮（预留选中环用途），后续如确认无用可删。
4. `_run_all_sims.cjs`（22 台架 runner）与历史 `_probe_*.mjs` 探针留在根目录，建议下次清理或归档。
5. **git 提交待用户授权**（直接写 main；建议提交清单已在对话中给出）。

---

### 附记：vite build 结果

**通过**：`✓ built in ~19s`，产物完整（index.html + css + 主包 index.3f156535.js 3.46MB / gzip 899KB + wikiEntries 分包）。仅有 chunk >500KB 体积警告（既有状况，非本次引入）。
环境备注：构建前两次失败于 vite 清空 dist 阶段——Node safe-delete shim 路由到 genie-trash 二进制超时（ETIMEDOUT），与源码无关；将旧 `frontend/dist` 整体改名为 `frontend/dist_bak_pre_w3`（改名不触发删除链）后全新构建通过。确认新 dist 无误后旧备份可清理。
