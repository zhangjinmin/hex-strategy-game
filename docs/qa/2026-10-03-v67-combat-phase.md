# v67 阶段 A：战斗距离阶段（四阶段制）落地台账

日期：2026-10-03。设计真源：`docs/design/3d-tactical-battle/31-combat-flow-restructure.md` §4。

---

## 1. 目标与背景

**病根**（31 号文档 §0）：伤害公式 10 个乘区全是「谁更强」的标量修正，没有一项是「战况变了」⇒ 双方开局即在射程内、全程同一种打法 ⇒ **「对射到死」**。

旧实现只有**单一标量**理想交战距：`aiDirector.idealEngageDistFrom` 返回 540~880px。而射程本身是 300~880px ⇒ **双方几乎开局就在射程内，没有接近过程**。

**阶段 A 只做一件事**：把「距离」从标量升级为**四阶段状态机**，让最优打法随距离改变。**不碰运动学、不碰伤害公式**（可与 30 号并行）。

---

## 2. 交付物

| 文件 | 性质 | 行数 |
|---|---|---|
| `frontend/src/game/combatPhase.ts` | **新增**纯函数模块（零 import） | 287 |
| `scripts/combatPhaseSim.cjs` | **新增**台架（require 真源码，零手抄） | 205 |
| `frontend/src/game/scenes/BattleScene.ts` | 改：`getIdealEngageDist` 阶段驱动 + 4 个新方法 + update 内接线 | 8386 → 8509（+123） |
| `frontend/src/game/battle/BattleTransientFields.ts` | 改：登记 `_phaseState` | +2 |

---

## 3. 关键设计决策

### 3.1 阈值按「跨度比例」而非绝对 px

**实测依据**（`BattleScene.ts:3306-3310, 3390-3394`）：地图跨度随参战规模动态扩容 —— ≤4艘 `hexRadius=26`(~1300px) / ≤8艘 32(~1600) / ≤12艘 38(~1900) / ≤16艘 44(~2200) / >16艘 50(~2500)。

⇒ 若硬编码 S1=1200px，在 1v1（1300px）上 S1 时长≈0 等于没有；5v5（2500px）又过宽。
⇒ 改用比例制 `PHASE_DIST_RATIO = {far:0.80, approach:0.42, assault:0.18, brawl:0.07}` × 跨度，四阶段在所有规模下等比成立。
⇒ 跨度口径 = `hexRadius × 50`（由实测跨度表线性拟合：26×50=1300、50×50=2500）。

### 3.2 射程下限夹逼

`phaseThresholdsFrom(span, maxRange)` 对每个阈值做下限夹逼：
- `far ≥ maxRange × 1.15`（超视距对射位必须在射程外一点，否则不叫"远距"）
- `approach ≥ maxRange × 0.80` / `assault ≥ maxRange × 0.45`

⇒ 复用了 v55 修过的「站得比打得远」同类问题的解法（`getIdealEngageDist:3651-3654` 注释）。

### 3.3 阶段判定顺序（优先级不可调换）

```
(1) 未接敌        → 强制 far（不允许"没打就冲进肉搏"）
(2) 损失率 ≥40%   → 强制 brawl（S4 独立入口，与距离无关）
(3) MIN_DWELL 未满 → 不动（far14s/approach8s/assault6s/brawl5s）
(4) 驻留带内       → 不动（t·H < dist < t/H，H=0.78）
(5) nominalPhase  → 目标阶段
(6) 接近方向逐级 / 拉远方向直达
```

### 3.4 阶段不碰运动学与伤害

只产出「该待在哪」+「该用哪种阵型」；执行仍由 `combatControl` 状态机 + `fleetKinematics` 负责。`combatPhaseFormationHint()` 仅作**偏好**输出给 `aiDirector.chooseFormation` 参考，不强制。

---

## 4. 开发过程中踩的三个真缺陷（均已修，均由台架抓出）

### 缺陷 1：`canEnter` 方向判反 ⇒ far↔approach 每 tick 乒乓

初版给推进/回退各写一个公式（`th / H` 与 `th * H`）。但 `PHASE_ORDER = [far, approach, assault, brawl]` 索引**越大 = 距离越近**，而阈值 `far(1040)` **最大**、`brawl(91)` 最小 ⇒ 两个方向拿到的尺子正好错位。

**实测症状**：60s 内切换 **460 次**，序列 `far→approach→far→approach→…`（B 组、H 组全红）。

**修法**：进入线只有一条且方向无关（`dist ≤ t[to]`），防抖改由「驻留带 + MIN_DWELL + 单步推进」三件独立机制承担。

### 缺陷 2：回退方向也限单级 ⇒ 永远回不到 far

`approach` 在 1090px 时 `nominalPhase = far`，但代码对回退也限"走一格"⇒ 只能退到 `assault`，**永远回不到 `far`**（台架 E 组红灯）。

**修法**：单步限制的本意是防「接近时一次跨多级 ⇒ 阵型瞬变」；**拉远时阵型本就要松散，跳级无观感风险** ⇒ 回退允许直达。

### 缺陷 3：`canEnter` 把 `far` 当下界 ⇒ 回退判据恒假

`far` 是最远阶段，其"进入线"只能从上界理解。写成 `dist <= t.far` 时，`1090 <= 1040` 为假 ⇒ 回退永不成立。
**修法**：`if (to === 'far') return dist > t.far;`

### 教训（值得沉淀）

**同一类错误（索引方向判反）在开发中犯了两次**（缺陷 1、缺陷 2 的注释里都留了自述）。根因是用裸索引比较表达"更近/更远"语义。
⇒ 定稿改用**语义命名** `const closer = tgtIdx > curIdx`，并在注释里显式写明「索引越大 = 距离越近」。

**另一条工程教训**：`Edit` 工具在本项目对含全角引号 `「」` 与 `⇒` 的长注释块**连续三次匹配失败**（内容与文件完全一致，仍报 not found）。改用 `python3 - << 'PYEOF'` heredoc + `s.index()/s[:i]` 切片替换后一次成功。**中文密集段落一律走 python 路径，不要用 Edit。**

---

## 5. 验收判据与实测结果

| 判据（31 号 §8 阶段 A） | 实测 | 结论 |
|---|---|---|
| 完整战斗经过 ≥3 个阶段 | `far→approach→assault→brawl` | PASS |
| 阶段序列单调（无来回抖动） | 同上 | PASS |
| S1 持续足够（真先打远炮） | MIN_DWELL 14s，10s 时仍 S1 | PASS |
| 阶段转换不抖动（5s 窗口 ≤1 次） | 边界抖动 60s 内 **0 次**切换 | PASS |
| 双方配置相同阶段序列不同 | `A=far` / `B=far→brawl` | PASS |
| 对称配置非恒定对轰 | 战损差异导致序列分叉 | PASS |
| 26 台架零新增红灯 | **27/27 全绿**（26 旧 + 1 新） | PASS |
| `vue-tsc --noEmit` | **EXIT=0** | PASS |
| `go build ./...` | **EXIT=0** | PASS |

### combatPhaseSim 分组（28 断言全绿）

A 阈值导出(6) / B 序列(3) / C 渐进推进(3) / D 防抖(1) / E 双向滞回(5) / F 损失率触发(2) / G 未接敌(1) / H 对称分叉(1) / I 出口辅助(6)

---

## 6. 接线方式（最小侵入）

**不改 `getIdealEngageDist` 签名，不改其 7 处调用点** —— 改为方法内部读该舰队的当前阶段：

| 调用点 | 用途 |
|---|---|
| `:3182` | 部署期站位 |
| `:5759`(原) | 距离带 `nextRangeBand` 输入 |
| `:6105` | 接敌/脱离判据 |
| `:6494` | `d.idl` 意图显示 |
| `:6512` | 撤退判据 |
| `:6698` | 接近减速半径 |

新增方法：
- `getPhaseThresholds(fleet, maxRange)` — 按跨度导出阈值，带 key 缓存（Map，上限 512 防泄漏）
- `readPhase(fleet)` — 惰性初始化 `_phaseState`
- `advanceFleetPhase(fleet, dist, engaged, dt)` — 推进阶段，返回跃迁信息或 null
- `phaseLabelOf` / `phaseFormationHint` — HUD/战报/阵型偏好出口

`update` 循环内接线点选在 `_rangeBand` 赋值之后（两者都吃 `minFleetDist` + `idealEngageDist`，但 band 是**伤害乘区**、phase 是**站位目标**，互不嵌套）。

**接敌判据用实际火力接触**：`minFleetDist < strikeRangeFrom(ships)`，**不用** `state === 'engaging'`（后者在 900px 外就置位，会把远距对射误判成接敌 —— v46-D 同类病灶）。

**时间基准**：`Math.min(delta, 100) / 1000 * dt`（与既有 `w1DtSec` 同式）。⚠ `w1DtSec` 定义在上一 `if` 块内、本接线点在块外，故重算为 `w1PhaseDtSec`。

**瞬态登记**：`_phaseState` 已加入 `BATTLE_TRANSIENT_FIELDS`，避免污染存档 `build/HexFront_Saves.json`。

---

## 7. 未闭合

- **L2 探针 + L3 真机未做**。阶段条的 toast/banner 实际观感（是否刷屏、是否与既有战报冲突）待真机确认。
- **阵型切换未接线**：`phaseFormationHint()` 已导出但未接进 `aiDirector.chooseFormation`。当前阶段只影响**站位距离**，不影响阵型。接阵型是下一步（会让 S3 真正"收成集火纵队"，是阶段代价的载体）。
- 阶段 B（舰载机波次）/ C（击瘫）/ D（战场事件）/ E（战斗节奏 AI）未动。
- 30 号文档的运动学阶段（推力/转弯半径/舰种物理）未动，**与本阶段可并行**。

---

## 8. 产物

- `frontend/src/game/combatPhase.ts`
- `scripts/combatPhaseSim.cjs`
- `docs/design/3d-tactical-battle/30-space-combat-restructure.md`
- `docs/design/3d-tactical-battle/31-combat-flow-restructure.md`
- 本台账 `docs/qa/2026-10-03-v67-combat-phase.md`
