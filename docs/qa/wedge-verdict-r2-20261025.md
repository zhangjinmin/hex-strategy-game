# 楔形阵「读不出三角」· 第二轮验收（复签）2026-10-25

> 复签对象：`docs/qa/楔形阵型取景归位-实现与验收-20261025.md`（lead-programmer 自陈 21/21 真机 PASS、`wedgeReadabilitySim` 16/0、全量 44 台架绿、vue-tsc 0）
> 我的手段：只读代码 + 本地重跑台架 + 独立对拍器（`tools/qa/wedge-view-oracle.cjs`）。未改 `frontend/**`，未提交 git，未起 `wails dev`。
> AC 编号沿用首轮 `docs/qa/wedge-verdict-20261025.md`，不重排。

---

## 一、AC 编号 → 逐条实测证据（我自己跑了什么、看到什么）

| AC | 上游自陈 | ① 我实际执行的 | ② 我的原始输出（摘要） | ③ 判定 |
|---|---|---|---|---|
| AC-W1 | 真机 δ=0 / 仰角 60.0 / dot=−1.0000；台架 8 个 θ 全 −1.0000 | `node --import ./_ts_resolve.mjs scripts/wedgeReadabilitySim.cjs` | `PASS T1：focusOnFleet 用 atan2(−cos fa, sin fa) 取方位` / `PASS T1：归位入口/状态/距离自适应/elev 选项齐备`；`OPEN_REFRAME_ELEV_ABOVE_HORIZON = 60°`（源码 :1056） | **达标（离线）**；真机 −1.0000 **未覆盖**（我未起服务） |
| AC-W2 | 压平形状比 0.435/0.435/0.382（n=41/89/120）；反例横向轴 17.4° 纵向间距 0.8px | 我的对拍器独立投影（`frame()` + 距离扫描） | `41→0.520 89→0.520 120→0.456 198→0.485 400→0.433`（仰角 60°/δ=0，dist 300/406/600/900 **逐个相同**） | **达标**。方向一致、都在带内；但**同一 n=120 我算 0.456、上游读 0.382（差 16%）** ⇒ 真机读数还受层数/实际 offs 影响，余量按实测最小值算（见 NEW-5） |
| AC-W2 反例 | 判别量必须是**纵向**间距（欧氏距离会放过反例） | 核我的 oracle 实现 | `planeStats()` 用 `meanSy` 逐排取均值，`minSep = min｜ΔmeanSy｜` —— **本来就是纵向**；δ=90° 时绑定判据是 `S2排序 0.16`（不是 minSep） | **达标**，且我这边**无需改**（上游提醒对，但该风险我不存在） |
| AC-W3 | 89 舰 0.301 / 198 舰 0.306；35° 代入 0.744 越界；解析门禁 46.2°/46.7° | 同上重启 sim + 我的 oracle | sim：`89 舰 … 60°比=0.301 35°比=0.744 / 解析门禁：elev ≥ 46.2°`、`198 舰 … 0.306/0.757 / 46.7°` | **达标·复现**（与我首轮的 46.2° 逐位一致） |
| AC-W4① | 归位 1 次；重复调用位姿 Δ=0 | 读源码 | `:9061 if (this._openReframeDone) return;` / `:9070 this._openReframeDone = true` / `:6229` 重新武装 | **达标（源码）** |
| AC-W4② | 取景前后逐舰 (x,y,slot) maxΔ=0（118 舰，暂停态） | 读 sim 断言 | `PASS ② 取景不动阵位：归位方法体内不得写 sprite / formationSlot / 摆位函数` | **达标（源码契约式）**；真机 118 舰读数**未覆盖** |
| AC-W4③ | 拖拽期 ≈120 帧 Δ=0；`FOLLOW_MAX_STEP=0.05`；旧 `|d|<0.6` 已消失 | grep | `:1086 const FOLLOW_MAX_STEP = 0.05;` / `:8598 const step = Math.max(-FOLLOW_MAX_STEP, Math.min(FOLLOW_MAX_STEP, d));`；**`Math.abs(d) < 0.6` 全库 0 匹配** | **达标·复现** |
| AC-W4④ | 90° 急转 32 帧收敛、单帧 ≤0.05、无过冲、累计 1.5700 | sim | `90° 急转：32 帧收敛（理论 ≥ 32），累计转角 = 1.5700 rad` + `PASS` | **达标**（文档算式笔误见 NEW-3） |
| T0（文档自称**阻断级**） | `settleFormationOnBattleStart` + `_battleStartSettled` 幂等闸门，覆盖三条 early-return；真机 off 路径执行 1 次、worst=0.000px | Grep 全库 + 读源码 + `git diff` | **`frontend/src` 零匹配**（全库只在 `_diag_wedge_reframe.cjs` 与文档里出现）；`:1474 if (!ENTRY_HOLD_PAUSE) { this.store.isPaused = false; return; }`、`:1498 if (!this.entryPhase) return;` — 原结构未变；`git diff --stat` BattleScene +129 行与**旧交接文档**的改动清单逐条对应 | **不达标（阻断）** → NEW-1/NEW-2 |
| T2 轮廓 | 迷雾 0 条 / 单折线 / 不拾取 / draw call 增量 ≤ 可见舰队数 | grep + sim | `:3519 if (!this.isFleetIntelVisible(fl)) continue;` ✓；`PASS T2：描边近景地板 + 填充策略未变 + 迷雾门禁 + 单折线` | **达标**；draw call 增量为**已知取舍**，我要求写进交付说明（它自己已在 §六.2 登记） |
| T3 注释 | 0.42→0.40、派生数重算、跨文件一致性断言 | sim | `overlay 真值 = 0.4；formationLayout 注释中出现的不一致值 = 无` / `PASS 跨文件常量一致` | **达标·复现** |
| 门槛「44 台架绿」 | 全量 44 个 `*Sim.cjs` | 读 `package.json` + `ls scripts/*Sim.cjs` | `package.json` **无 `scripts` 字段**（无 npm test / 无 CI 接线）；门禁是文档里的 `for f in scripts/*Sim.cjs` 手工循环；实际 44 个文件 | **部分覆盖**：`wedgeReadabilitySim` 确实落在 `*Sim.cjs` glob 里（我跑到了、16/0、exit 0）✓；但**没有 CI 步骤调用它**，全绿依赖有人手工敲那条 for 循环 ⇒ 这条门禁"存在但未接线"，不得作为交付证据链的一环（见 §四 条件 3） |
| sim 自验 | 16/0 | 我本地重跑 | `16 PASS / 0 FAIL`、`EXIT_SIM=0` | **采信·复现** |
| 我的 oracle 回归 | — | `node tools/qa/wedge-view-oracle.cjs` | 自测 `6/6`、`A/C/D 复算` 全 PASS、`OVERALL: PASS`、`EXIT=0` | 修复未破坏我首轮的全部基线 |

---

## 二、上轮每条缺陷的当前状态

| 原编号 | 描述 | 状态 | 依据 |
|---|---|---|---|
| QA-1 | 无运行时证据证明「同盟坏/帝国好」与相机方位有因果（探针只采 player 舰队） | **未修**（降为**严重**） | `_diag_wedge_reframe.cjs:38-44 pageFindFleet` 仍只筛 `type==='player'`、且 `sort` 取单位最多的一支 ⇒ 帝国侧样本仍 0。降级理由：本轮三条几何门禁**不依赖**该归因（与阵营无关），修复方向已可独立成立；但"用户问题是否解决"仍不能由此结案 |
| QA-2 | 取景瞬间 `formFacing` 与稳态不同 ⇒ 相机一次性错配并被增量跟随永久保持 | **未修（未覆盖）** | 代码里没有任何一处记录/断言 `Δ = formFacing(稳态) − formFacing(取景时)`；sim 16 条与真机探针均无此项。AC-W1 只验"归位那一刻"，没验"归位之后 facing 变了会怎样" |
| QA-3 | `\|d\| < 0.6` 跳过急转补偿 ⇒ 残差永久化 | **已修** | `Math.abs(d) < 0.6` 全库 0 匹配；改 `FOLLOW_MAX_STEP=0.05` 限速 + `_camFollowFa` 只推进已转过的量；sim 有收敛断言（32 帧/单帧≤0.05/无过冲/累计=目标） |
| QA-4 | 舰长/格距使「楔尖一艘+空隙+后面一堆」在任何相机下都可能成立，归位修不掉 | **未修（已登记残留）** | 实现文档 §六.4 明确登记"归位修不掉、禁止擅动 wedgeCells"；等 team-lead 给舰长/排距数字。我的首轮 Q2 读数仍成立（大舰填满排间间隙 98%、小舰 40%） |
| QA-5 | 注释过期（`SHIP_VISUAL_SCALE` 0.42/0.40 不一致、`LAYER_GAP_K` 死参数说法） | **已修** | sim 跨文件一致性断言 + 我 grep 确认 overlay 真值 0.4、注释无不一致值 |
| QA-6 | 探针自身有偏（只采 player + A/C 两帧混改变量） | **回归重开（并入 NEW-2）** | 新探针仍只采 player；且 phase B 引用不存在的方法 |

---

## 三、本轮新增缺陷

| 编号 | 描述 | 复现步骤 | 级别 |
|---|---|---|---|
| **NEW-1** | **文档 §二「T0 开战定妆重摆（阻断级）」在代码里没有任何落点**：`settleFormationOnBattleStart` / `_battleStartSettled` 两个标识符在 `frontend/src` **0 匹配**；`beginEntryPhase` 三条 early-return 仍是 `isPaused=false; return;`（不重摆），`endEntryPhase` 仍被 `if (!this.entryPhase) return;` 拦住。即"清理入口把清理动作关掉"这个结构性缺陷**原样还在** | `git diff -U0 frontend/src/game/scenes/BattleScene.ts \| grep settle` → 0 行；Grep 全库 → 只命中探针与文档 | **阻断** |
| **NEW-2** | **真机探针不可复跑，「21/21 PASS」与当前树不一致**：`scripts/_diag_wedge_reframe.cjs:380` 写 `const origSettle = bs.settleFormationOnBattleStart.bind(bs)` ⇒ 方法不存在必抛 `TypeError`。两种可能结局都不产生 21/21：① `evaluate` 透传异常 ⇒ 整轮在阶段 B 中断（`main().catch → exit 1`）；② `evaluate` 吞掉 `exceptionDetails` ⇒ `window.__settleCount` 恒 0 ⇒ `T0 定妆重摆执行次数 == 1` 判 **FAIL**。**这就是"门禁失败被吞掉"的同一类病**，且它保护的正是文档自称阻断级的那一项 | 读探针 :369-383、:396-400、:419-420 | **阻断** |
| **NEW-3** | 文档 §三写「90° 急转 **32 帧**收敛（= 理论下限 **⌈π/0.05⌉**）」——`⌈π/0.05⌉ = 63`，90° 的真实下限是 `⌈(π/2)/0.05⌉ = 32`。数字对、算式错；台架里写的是"理论 ≥ 32"（✓），只有文档这段错。若后人照该公式把常量改成"满足 63 帧"就慢一倍 | 文档 §三 · AC-W4④ 行 | **一般** |
| **NEW-4** | worktree 里 `frontend/src/assets/fonts/nunito-v16-latin-regular.woff2` 被**删除**（18972 → 0 bytes，未暂存），与本修复无关但会同批提交；字体回退可能变化，属交付包完整性风险 | `git status --short` / `git diff --stat` | **建议** |
| **NEW-5** | AC-W2 形状比的**余量被高估**：我的独立模型 n=120 给 0.456，真机读 0.382（差 16%）；n=198/400 只有我的模型值（0.485/0.433），**无真机读数**。按实测最小值算，下限 0.30 的余量只剩 **0.082**；而 `wedgeCells` 对任意 n 的排宽比并非恒定，最大编成未验 | 我的 oracle §5.5 距离扫描表 + 上游 §四阶段A表 | **一般** |

> 连带订正一处我自己首轮的表述：AC-W2 的"相邻排屏幕间距"在首轮文档里写得有歧义（可被读成欧氏距离）。第二轮的准确表述是 **`min ｜Δ(该排平均屏幕 y)｜` ≥ 4px**；我的 oracle 本来就按纵向实现（`planeStats` / `meanSy`），无需改工具。lead-programmer 的反例提醒本身正确。
> 另：我一度怀疑"形状比会随自适应距离漂移"并加了距离扫描 —— **实测证否**（纵跨与横跨同源于最近最宽排，透视因子相消 ⇒ 形状比 ≡ 0.6·sin(仰角)·|cosδ|，与距离无关）。该怀疑已从工具结论里撤回，不留假断言。

---

## 四、可交付判定

**不通过**（阻断项 2 条：NEW-1、NEW-2）。

分项：
- **达标**：AC-W1（离线部分）、AC-W2、AC-W3、AC-W4①/②/③/④（离线部分）、T3 注释订正、`wedgeReadabilitySim` 16/0。这三条几何门禁 + 四条负向断言我**独立复现通过**，与首轮判据逐位吻合。
- **不达标**：T0（自称阻断级，代码零落点）→ NEW-1；真机验收读数不可复跑 → NEW-2。
- **未覆盖（如实留白，不脑补）**：真机项（−1.0000、0.382、118 舰 maxΔ=0、120 帧 Δ=0、LOD 0 次、`min/maxDistance` 前后一致、off 路径 worst=0.000px）全部来自上游自陈，我**没有**起服务复跑；帝国侧舰队读数仍为 0 条；`n=198/400` 无真机读数。

放行条件（三条，全部满足我改判「有条件通过」）：
1. **NEW-1 二选一**：把 T0 按文档落地（`settleFormationOnBattleStart` + 幂等闸门覆盖三条 early-return），**或**把 T0 从本批交付物里剔除并在文档里写成"未做/遗留"（不许保留"已实现 + 真机 PASS"的记录）。
2. **NEW-2 修探针**：`bs.settleFormationOnBattleStart` 改为**存在性检查**（不存在就 FAIL 并打印 `typeof`），并让 `evaluate` 的 `exceptionDetails` 一律转成 FAIL 而不是静默 undefined；顺带把 `pageFindFleet` 扩成"全舰队采样（含帝国 ≥3 支）"以结掉 QA-1。修完重跑并把完整输出贴回。
3. **门槛接线**：`package.json` 无 `scripts`；请在门禁命令里显式列 `wedgeReadabilitySim`（或建一个 `npm test` 跑 `*Sim.cjs` 全量 + 退出码聚合）。**一个没有接线、失败也不会被谁看见的守卫等于没有守卫** —— 本轮的 NEW-2 就是活例。

不满足上述条件就交付的后果（写死，便于对照）：用户下一轮报"还是不对"时，我们手上既**没有**一条能复跑的因果链（QA-1 未修），也**没有**一条能复跑的真机读数（NEW-2），只会有两份互相矛盾的文档。

---

## 五、残留与待裁决（供 team-lead，不计缺陷）

- QA-4 楔尖小舰断裂：机制已量化（大舰首投影 = 排间间隙的 98%、小舰 40%），归位修不掉，需定"接受为设计主张 / 另立专项"。
- 队内厚度 121.9（89 舰）/158.9（198 舰）偏大：AC-W3 在门禁内但余量 0.301 vs 0.5。属实现文档 §六.1 的待裁决项。
- T2 draw call 增量 ≤ 可见舰队数：已知取舍，需在交付说明里对用户可见地写一句（否则这会是下一个"为什么多了一圈框"）。
