# 12 · 大战场阵型复刻（多层 · 大量战舰 · 队内 16 层 / 队间 3 档）

> 任务：`T-3D-GRANDFLEET-001`（P0，用户直接指定）；后续 `T-3D-GRANDFLEET-002`（WS8 演习路径 + WS11~14 光点阵/容量解耦/口径/K_VISUAL 档位）
> 目标文档：本文 = 设计留档与决策记录。
> 验收：`docs/qa/大战场阵型复刻验证_20260913.md`；真机截图 `docs/qa/shots-20260913/`、`docs/qa/shots-20260913v2/`。
> 修订：2026-09-13 rev1 · engineering-lead（程基岩）；rev2 · engineering-lead-2（程基岩）—— 补 WS8 / WS11~WS14、修正"队内 5 层"→16、补"恒 8 艘"真因、补两条部署路径与光点阵推导。
> rev3 · design-strategist（文策渊）—— **补 v12（WS12）增量**（§7：光点加大 / 删旗舰光柱 / 性能三档），并就地夹注修正 rev2 中已被 v12 覆盖的光点与旗舰常量（§3bis.2 / §3bis.3 / §4.1 / §6.2）。

---

## 0. 用户原始诉求（不可改写）

> "我需要的就是**大战场**的状态，**多层、大量的战舰**，能够显示出宇宙战舰对战的宏大……
> 把内容**完全替换成这个 demo 中所呈现的状态**，包括**阵型**这些都要复刻。"

demo = `D:\Download\WorkBuddy\battle-dot-demo\index.html`（8 队 × 49 舰 = 392 舰的点阵沙盘）。

**远景光点的正式语义（用户原话，不可改写）**：

> "**光点不代表多少战舰，只是用光点代表战舰，用光点来组成阵型，这个是远景，近景之后用密密麻麻的战舰阵列。**"

⇒ 远景 = **每艘战舰 1 个"看得见的圆点"**，由这些点组成阵型；近景 = 密集舰体阵列。
本文件 §3bis 的整段推导都是为了让这句话在屏幕上成立。

---

## 1. 问题定位：为什么"只出现稀疏几艘"（以及"恒为 8 艘"）

3D 战术层（`frontend/src/game/three/Battle3DOverlay.ts`）从 demo 移植了**三级表示**（下表为**现行**阈值）：

| 一级 | 判据（屏幕投影舰长 `px`） | 表示 |
|---|---|---|
| 远景 far | `px < DOT_IN_LO`(3.2) | **光点阵**（1 舰 1 点，`THREE.Points`）+ **阵型标记底框/描边** |
| 中景 mid | `DOT_IN_LO ≤ px < MESH_IN_HI` | **光点层**（全局 1 个 `Points`，1 draw call） |
| 近景 near | `px ≥ MESH_IN_HI`(26) | **GLB 实体舰**（池上限 `MAX_MESHES`） |

> ⚠ 阈值 `DOT_IN_LO = 3.2`、`MESH_IN_HI = 26` 是**缩舰 `SHIP_VISUAL_SCALE = 0.40` 之后**的值
> （`px = 舰长 /(2·tan(fov/2)·d)·H`，舰长缩 0.30 倍 ⇒ 阈值必须等比下调，否则等效距离上触发不了实体档）。
> 历史文档里写的 `6.2 / 56` 是缩舰前的旧值，**已作废**。

但上一轮（09-12 夜）只做到"三级都在"，**规模量级没跟上 demo**，于是实机观感是"稀疏几艘"：

| 维度 | demo（用户认可） | 复刻前游戏 | 后果 |
|---|---|---|---|
| 每队舰数 | 49 | `round(S/K_VISUAL)`，K=125 时满编也只有 96，但**默认档 250 → 48** | 默认档≈demo，可接受 |
| 单场实体上限 | 392 | `N_MAX = 400` | 8v8 会被硬切 |
| 单队上限 | 49 | `N_MAX_PER_FLEET = 64` | 高密档挤不出 |
| 每舰点数 | demo 滑杆 1~24（用户调到 20） | `DOT_N = 9` | 中景"点数不够、成不了阵" |
| 点径比例 | demo 滑杆（用户调到 0.20） | `DOT_SCALE = 0.24` | 点偏大、偏糊 |
| **队内层数** | demo 滑杆 1~5（用户调 **5**） | `TEAM_LAYERS = 3` | **队形没有"厚度"** |
| **队间档数** | demo `TEAM_LAYOUT='stack'`，4 队沿 Y 等距叠放 | **完全没有**（2D 平面） | **没有"多层战场"** |
| 阵型标记底框 | 底框随最长舰长垫底 | 底框 floor 用格距×0.5，**小 n 时框比舰短** | 远景"框不住船" |

> 结论（rev1）：**问题不是"三级表示没有"，而是"量级、层数、档数"三项没复刻到位**，
> 且**从未做过真机截图验收**（上一轮全部是源码级 harness）。

### 1.1 【rev2 补】"恒为 8 艘"的真因：不是量级不够，而是**根本没有数据流经过 K_VISUAL**

rev1 只讲了"稀疏"，漏了一个更硬的症状：用户把 `K_VISUAL` / `N_MAX` 调到多少，**演习（skirmish）里都恒为 8 艘**。

真因：战术层有**两条互不相干的部署路径**（详见 §1bis）。用户实际常看的是**路径 B · 演习**，
而路径 B 原本读的是**硬编码的 `deck` 列表**（`simFullDeck` = 战列×2 + 巡洋×3 + 驱逐×2 + 补给×1 = **恰好 8 艘**，
`BattleScene.ts:2635`），**完全绕过**了兵力折算层 ⇒ 调 `K_VISUAL` 对演习**零效果**。
连地图尺度也跟着错：`scaleMapForFleetCount()` 数的是"卡组条数"（8）而非折算后实体数，
于是演习里 `hexRadius` **恒为 32**（`≤8 → 32`），`spacingEff` 与舰体屏幕 `px` 一起被压小 ——
**即使把实体数改对，演习仍不是会战尺度**。

> ⇒ 这是本任务最大的坑，已独立成 §1bis，并在 §3 的 WS8 记录修复。

---

## 1bis. 【rev2 新增·第一等公民】两条互不相干的舰队部署路径

战术层的"兵力 → 可渲染实体"两条路径**历史完全不通**，是"调了没用"的根因。

### 路径 A · 战役（campaign）

```
gameStore.launchTacticalBattle(battleId, atkIds, defIds, nodeId)     store/gameStore.ts:3593
        └─ serializeTacticalFleet(fleetId, visualCount)              store/gameStore.ts:3534
                └─ 走 config/shipScaling.ts 的唯一折算入口 → 每个实体一槽 { type, count, x, y }
        └─ → tacticalState.*.slots
BattleScene.deploySide() 读 slots 建舰
```
受 `K_VISUAL` / `N_MAX` / `N_MAX_PER_FLEET` 支配。**这条路径一直是"对的"。**

### 路径 B · 演习（skirmish）

```
gameStore.enterSimMode()                                             store/gameStore.ts:640
gameStore.launchSimBattle()                                          store/gameStore.ts:654
        └─ 把 attackers / defenders 写成【空数组】（战役路径的 slots 数据流在此**断掉**）
BattleScene.initFactions()  ← 真正建舰的起点
        └─ spawnInitialFleets()  ← 原本读 fac.deck（= simFullDeck 硬编码 8 艘）
```

- **症状**：用户视角是「把 `K_VISUAL` / `N_MAX` 调到多少，演习里都恒为 8 艘」——
  因为**根本没有一条数据流经过 K_VISUAL**。
- **连带症状**：`scaleMapForFleetCount()` 按 deck 条数算 `hexRadius`（恒 32），地图尺度也不变。

### 修复（WS8，`BattleScene.ts` 新增 5 个 helper）

| helper | 行号 | 职责 |
|---|---|---|
| `skirmishMilRank(rank)` | `BattleScene.ts:1997` | 演习军衔：`< 8`（非战斗序列）会被 `getShipLimit` 判 **0** ⇒ 编制全 0 ⇒ **空舰队**。故一律抬到准将 **8** |
| `skirmishEnemyMilRank()` | `:2003` | 难度改用**兵力**表达（easy/normal/hard → 8/10/12；`simMode` 满编 13）。**废掉旧的 deck 4/6/8 口径** |
| `skirmishCompositionFor(milRank)` | `:2013` | 军衔 → 编制 = `store.generateSimFullComposition`（与战役同一真源）；取不到返回 `null`，调用方回落旧 deck |
| `skirmishEntityPlan()` | `:2026` | **纯函数式**从 store 状态复算实体预算（**不读 `initFactions` 产物** ⇒ 与 `spawnInitialFleets` 必然一致；走 `allocateVisualCounts` 全场分摊，与战役轨道**同口径**：Σ ≤ N_MAX、单队 ≤ N_MAX_PER_FLEET） |
| `spawnUnitsForFaction(fac)` | `:869` | 建舰：优先 `buildTacticalUnits`（唯一折算入口），回落旧 `fac.deck` |

- `initFactions()` 给每个 faction 补 `milRank` / `composition` / `entityBudget`（原有 `rank` 字段**保留原语义不动**，避免连带改动）。
- `scaleMapForFleetCount()` 的演习分支改为读 `skirmishEntityPlan()` 的 Σ实体。

> ⚠ `skirmishMilRank` 为什么必须存在：`rank < 8` 走 `getShipLimit` 会得到 0 ⇒ 编制全 0 ⇒ **舰队直接空掉消失**。
> 这个"空舰队"bug 与"恒 8 艘"是同一处的两面。

**实测**（来源：team-lead 记录 + 本轮 `_v5_play_skirmish.cjs` run）：

| 场景 | Σ实体 | `hexRadius` |
|---|:--:|:--:|
| 3v3（team-lead 记录） | **920** | **50** |
| 修复前（任意档） | ~8/队 | **32** |
| 2v2 `--light`（本文件作者本轮实跑，见 §5.1） | **600** | **50** |

> 验收方勘误与快照说明见 `docs/qa/大战场阵型复刻验证_20260913.md` 文首。

---

## 2. demo → 游戏的换算基准（唯一真源：`config/fleetTierLayout.ts` 头注）

demo 的滑杆值在**它自己的世界尺度**下调出来的，**绝不能照搬绝对值**：

| demo 量 | demo 值 | 比值（÷ spacingBase 1.6） | 游戏换算（**现行**） |
|---|---|---|---|
| `spacingBase` | 1.6 | 1 | `FORMATION_SPACING = 26`（像素，单一真源 `config/formationLayout.ts:35`） |
| `LAYER_GAP` | 0.5 | **0.3125** | `LAYER_GAP = 0.3125 × spacingEff` |
| `TEAM_GAP` | 4.0 | **2.5** | `TEAM_GAP = 2.5 × spacingEff` |
| `TEAM_LAYERS` | 5（用户滑杆） | — | `TEAM_LAYERS = 16`（演进见下） |
| 队间档数 | 4 队 `stack` → 4 档 | 用户定为 **3 档** | `TIER_MAX = 3` |
| `dotN` | 20（用户滑杆） | — | `DOT_N = 1`（**1 舰 1 点**；多点模式已关闭，见 §3bis） |
| `dotScale` | 0.20（用户滑杆） | — | `DOT_SCALE = 0.30`（多点模式专用，当前形同空转） |
| `dotSpread` | 0.45 | — | `DOT_SPREAD_K = 0.45/1.27 = 0.354331`（**未变**，多点模式专用） |

> `TEAM_LAYERS` 演进：demo 默认 3 → 用户定 5（"队内 5 层，3 级"）→ 用户实机看到"阶梯状的 5 层、
> 不是密密麻麻的很多层"后再定 **16**（`config/fleetTierLayout.ts:62`）。
> 能"加层数"的前提是**层距由比例项决定**（见 §2.1）：缩舰前层距被几何下限顶到 ≈ 舰高，
> 加层只会让整块板变厚；缩舰后层距 = `0.3125 × 格距` ⇒ 16 层总厚仅 ≈ 121.9 世界单位
> （≈ 4.7 个格距，而 120 舰横向足迹 ≈ 11×26 = 286）⇒ 厚:宽 ≈ 1:2.3，才读得出"密集多层的军团"，
> 对应需求里的"**12000 艘的空间宏大感**"。

### 2.1 LAYER_GAP 的几何下限（关键推导，不是照搬 0.5）

demo 的 `0.5` 不是自由选的：它的舰体高 ≈ `SHIP_LEN/2 = 0.635`（demo 的 `boardGap` 公式就用这个"板厚"），
故 `LAYER_GAP/体高 = 0.5/0.635 = 0.787`；同时 `0.5/1.6 = 0.3125`。**两条口径在 demo 里恰好相等**
（因为 `体高/spacingBase = 0.635/1.6 = 0.397`，×0.787 = 0.3125）。

⇒ 正确推广：

```
LAYER_GAP = max(0.3125 × spacingEff ,  1.2 × maxShipH)
                                    └─ SAFE 系数，必须 > 1
```

> ⚠ **SAFE 必须 > 1**（`LAYER_SHIP_H_SAFE = 1.2`，`config/fleetTierLayout.ts:70`）。
> 旧值 **0.8**（照抄 demo 的 0.787，误当成"安全系数"）在游戏尺度上直接翻车：
> 战列舰高 12.99、`0.8×12.99 = 10.39 < 12.99` ⇒ **层距 < 舰高 ⇒ 层与层在深度上互相穿插**
> ⇒ 多层面糊成一整块厚板。这正是用户实报的"**只有单层 / 阶梯状的 5 层**"的几何根因（WS 已修）。
> 现取 1.2：层间留 `0.2×舰高` 净空，读得出"一层一层"，又不浪费纵向。

**实算**（hexR=50、`spacingEff=26`、`SHIP_VISUAL_SCALE=0.40` ⇒ 最高舰 carrier `H = 5.89`）：
`0.3125×26 = 8.13` ｜ `1.2×5.89 = 7.07` ⇒ **`LAYER_GAP = 8.13`（比例项胜出）**。
层距 8.13 vs 舰高 5.89 ⇒ 净空 2.24 ✓。

### 2.2 TEAM_GAP 的间隙校验（demo 的 `boardGap` 判据）

```
厚度 = (LAYER_LAYERS-1) × LAYER_GAP
TEAM_GAP = max(2.5 × spacingEff ,  厚度 + 1.5 × maxShipH)
boardGap = TEAM_GAP − 厚度 − maxShipH   ⇒   ≥ 0.5 × maxShipH > 0   ✓
```

**实算**（hexR=50、`spacingEff=26`、carrier 队、**L=16**）：
`厚度 = 15×8.13 = 121.9`；`2.5×26 = 65`；`121.9 + 1.5×5.89 = 130.7` ⇒ **`TEAM_GAP = 130.7`**，
`boardGap = 130.7 − 121.9 − 5.89 = 2.9 > 0` ✓。

> ⚠ 纵向包络（`厚度 + (档数−1)×档距 ≈ 121.9 + 2×130.7 = 383`）会**抬升巡航高度**，
> 见 `Battle3DOverlay.computeCruiseClearance()`，否则最下面那一档会沉到地形以下。

---

## 3. 交付清单（WS1~WS7）

### WS1 [P0] 规模放大 —— `config/shipScaling.ts`

| 常量 | 前 | 后 | 依据 |
|---|:--:|:--:|---|
| `K_VISUAL_DEFAULT` | 125 | **250** | demo 中档观感：`round(12000/250)=48 ≈ demo 49/队` |
| `N_MAX` | 400 | **480** | demo 392（49×4×2）同量级；8 队 × 60 的余量；内存 +26 KB |
| `N_MAX_PER_FLEET` | 64 | **96** | 受"不互穿"几何上限约束，见下 |

> 注：`K_VISUAL_DEFAULT` / `N_MAX` / `N_MAX_PER_FLEET` 在 **rev2 进一步演进**为
> **100 / 1400 / 200**（见 §4.1 参数表与 §4.3）。

**守恒律（不可破）**：`ΣHP = Σ_t SHIP_TYPE_HP[t] × (C_t / SHIP_SCALE)` **与实体数 N、K_VISUAL 严格无关**。
调 `K_VISUAL` 只改"画几艘"，**不改战斗平衡**。（详见 §4.3。）
（反向判据：若把"实体数"误当兵力缩放系数，`ΣHP` 会偏 >50% —— 断言非平凡。）

**不互穿几何上限重推**（`N_MAX_PER_FLEET = 96` 的来由）：
不互穿条件 `spacingEff ≥ 舰宽`。最宽舰 carrier `W = 0.311×√3×hexR × SHIP_VISUAL_SCALE`。
（rev1 的 `96`/`FL=4` 口径已被 rev2 的 §4.1 参数取代，当前 `N_MAX_PER_FLEET = 200`。）

### WS2 [P0] 队内多层 —— `config/formationLayout.ts` + `fleetTierLayout.ts`

`TEAM_LAYERS = 3 → 5 → 16`（见 §2 的演进）。层偏移由 `formationLayerOffsets(offsets, layers)` 给：
以 **(gx,gy) 几何名次**取 `rank`，`li = rank % Leff − (Leff−1)/2` ⇒ **每一排都同时含全部层**
（"交错点阵"），而不是"每排整块抬升"的阶梯（后者 `ramp` 已废弃，实测 `staircase = 0.958`，反例）。

- `Leff = min(L, n)` 的**居中必须发生在生成侧**：否则 `n=1` 的单舰队会被压到 `−(L−1)/2·gap`，
  `n < L` 的队系统性下沉。
- `FORMATION_FOOTPRINT_LIMIT = 4 → 6`（`config/formationLayout.ts:54`）：为了让大 n 时格距不压缩
  （`FL=6 ⇒ halfExtent ≤ 6×hexR/spacingEff`）。

### WS3 [P0] 队间 3 档 —— **新文件** `config/fleetTierLayout.ts`

**单一真源**，与 `formationLayout`（平面 gx/gy）正交：这里是第三个维度（世界 Y）的两级叠层。

- 每方（`factionId`）的各支分舰队按 `tierCountFor(队数)` 分到最多 **3 档**，
  档位号 `tierIndexOf(i, tiers) = i % T`（round-robin ⇒ 相邻舰队从不落同档）；
  高度乘数 `tierMultipliers(3) = [−1, 0, +1]`（用户指定），**Σy = 0（居中）**。
- 档距 `TEAM_GAP` 按"**一方取各队最大值**"统一 ⇒ 同方各档等距、包络整齐。
- ⚠ **只施加在 3D 视觉层**：`BattleScene` 的 2D 逻辑 / 命中判定 / 寻路**保持平面**，
  高度**不参与命中判定**。

### WS4 [P0] 阵型标记底框修复 —— `Battle3DOverlay.markerSpan`

旧口径 `floor = spacingEff × 0.5` 在小 n 时**框比最长舰短**（实测 105 个样本失败）。新口径**分轴**：

```
floor   = max(minFloor, maxShipLen × MARKER_PAD)     // MARKER_PAD = 1.12
spanY   = max(formationHalfExtent_Y × spacingEff × 2, floor)   // 用 maxShipLen
spanX   = max(formationHalfExtent_X × spacingEff × 2, maxShipW) // 用 maxShipW，不越界施加
标记底框 y = 该队**最低层**（底框沉到队形底面）
```

实测：`spanY / 最长舰长` 最小值 **1.1200**（≥1.0 ✓）；`n=1` 补给舰 `spanX/spanY = 0.1613`
（**未被 `maxShipLen` 越界施加** → 不是方形底框），且 `spanX=25.22 ≥ 舰宽 22.52` ✓。

### WS5 [P1] 侧翼包抄（demo `splitGeom` / `splitCentersFor` / `splitMinClearance`）

新文件 `config/fleetSplitManeuver.ts`：三幕纯函数（`t ∈ [0,1]`，**纯函数、无随机、无增量累积 ⇒ 可复现、可截图定点**）：

| t | 幕 | 几何 |
|:--:|---|---|
| 0 | 对垒 | 各队原位 |
| 0.4 | 分裂 | 左右各半沿横向外移，中央让出 `CHANNEL` 宽通道 |
| 1 | 包抄 | 沿 `sin` 弧线前出到敌队后方并向内收 ⇒ 钳形 |

约束：`splitMinClearance() > 0`（两翼内缘最小间隙，**保证两翼不互穿**）；
`t=0/1` 端点精确（`ARC` 只在中间帧生效）。
**输出只作为 3D 视觉层的整队偏移**，2D 逻辑仍平面（同 WS3 的约束）。

### WS6 [P1] 换阵动画（0.4s 插值）

- **水平**：由 `BattleScene.update()` 既有的阻尼 lerp 提供（`unitLerp = min(0.08, uDist×0.003)`），
  换阵横向迁移 ~0.4s 收敛，3D 层每帧读 `sprite.x/y` ⇒ 自动继承。**无需改动**。
- **纵向**：3D 层的 `entry.cruiseY` 指数平滑，时间常数由 `FORM_ANIM_SEC = 0.4` 派生
  （`τ = FORM_ANIM_SEC / 3` ⇒ 0.4s 达 ~95%），使"换阵后重新分层"也是插值而非瞬跳。
- 层号本身用**战前编制 `formationCount0`** 做缓存键 ⇒ 战斗减员**不会让任何舰跳层**。

### WS7 [P1] 性能兜底（按 px 自动降档 + draw call 表）

- 三级分级本身就是第一层兜底（远景不画实体）。
- 第二层：实测帧时超预算时，**自适应收缩实体池预算** `meshBudget ∈ [MESH_BUDGET_MIN, MAX_MESHES]`
  并同步抬高 `MESH_KEEP/MESH_DROP` 阈值 ⇒ 多出来的舰退回光点层（观感不塌、帧率保住）。带滞回，无随机。
- **默认关闭**（`opts.perfGovernor`，见 §6 待决策 ③）。
- 交付一张 draw call / 三角形数对照表（远景/中景/近景 × 1v1 / 6v6）。

### WS8 [P0·rev2] 演习路径接进唯一折算入口 —— `BattleScene.ts`

见 §1bis。5 个 helper + `initFactions` 补字段 + `scaleMapForFleetCount` 改口径 + `spawnUnitsForFaction`
优先 `buildTacticalUnits`。**症状**：演习恒 8 艘 / hexR 恒 32 → **实测 920 实体 / hexR 50**（§1bis 表）。

### WS11 [P0·rev2] 远景改「屏幕空间均匀点阵」—— `Battle3DOverlay.writeDotLayers`

远景光点层从"用亮度（alpha）处理点太小/太密"改为"**屏幕空间点距下限**驱动"。
新增 `DOT_PITCH_MIN_PX`(3.2) / `DOT_DIAM_K`(0.85)；`DOT_MIN_PX` 由字面量 2.8 改为**派生** `3.2×0.85 = 2.72`。
`UnitVis` 增 `sx/sy`（屏幕像素坐标）；`syncShips` 复用一个临时 `Vector3` 投影出屏幕坐标；
`writeDotLayers` 重写为"屏幕像素空间按 3.2px 方格分桶、每格至多 1 点"。**完整推导见 §3bis。**

### WS12 [P0·rev2] 光点层容量解耦 —— `Battle3DOverlay`

新增 `DOT_SLOTS = N_MAX × DOT_N = 1400`；`dotPos/dotCol/dotAlpha/dotPx` 与 `writeDotLayers` 的 `DOT_CAP`
全部改用 `DOT_SLOTS`。**完整推导见 §3ter。**

### WS13 [P1·rev2] 注释口径清理 —— `Battle3DOverlay`

把 `DOT_N / DOT_SPREAD_K / DOT_SCALE / DOT_OFFSETS / syncShips 文档 / lastStats / __b3dStats /
makeDotMaterial` 等处仍把"每舰 DOT_N 个点"当作**现行**语义的注释，统一改为现行事实：
**远景正式语义 = 1 舰 1 个圆点（`DOT_N = 1`）；`DOT_N` 保留为"多点模式"开关，当前关闭。**

### WS14 [P2·rev2] `K_VISUAL_OPTIONS` 同步 —— `config/shipScaling.ts`

`[125, 250, 500] → [50, 100, 250]`（用户 2026-09-13 原话"把 1:250 改成 1:100 或者 50"；
分母越小画得越多，默认档 `K_VISUAL_DEFAULT = 100` 必须在选项内）。
该常量**当前未被 UI 引用**（`frontend/src` 内除定义外无引用），保留为档位真源。

---

## 3bis. 【rev2 新增·本次核心】远景光点阵的推导：为什么自由度不是"亮度"而是"点距"

### 3bis.1 问题建模：可读性判据 = 点径 / 点距

屏幕上"一片点"读作**点阵**还是**实心块**，只由**点径与点距之比**决定：

```
点径 / 点距  < 1   ⇒ 点之间留间隙  ⇒ 读作【点阵】   （目标区）
点径 / 点距  = 1   ⇒ 刚好相切      ⇒ 开始【糊】
点径 / 点距  > 1   ⇒ 点互相重叠    ⇒ 糊成【实心块】  （反例）
```

### 3bis.2 旧模型的两难（用亮度解决几何问题 ⇒ 必然二选一失败）

旧模型：`点径 = px × DOT_SCALE`（下限 `DOT_MIN_PX`）、`点距 ≈ 阵型格距的屏幕投影`（与 `px` 同阶）。
缩舰后 `px` 整体变小，于是出现**两难**：

| 选择 | 远处后果 |
|---|---|
| 点径锁下限（`DOT_MIN_PX` 不缩） | 远处点距 < 点径 ⇒ **糊成实心方块**（用户第 3 轮投诉） |
| 点径随距离缩 | 远处 `px < DOT_IN_LO` ⇒ 旧代码 `alpha = sstep(...) = 0` ⇒ **完全不可见**（用户第 4 轮投诉） |

**根因：用亮度（alpha）去解决一个几何问题。** 亮度只能表达"多亮"，表达不了"点与点之间还有没有间隙"。

- **反例（实心方块）**：`DOT_N = 20`（多点团）+ `DOT_SCALE = 0.36` ⇒ 比值 `0.36/(0.5×0.354) = **2.03**`
  ⇒ 每个点比点距大一倍 ⇒ 20 个点完全重叠 = 每艘舰糊成一块砖。
- **正例（现行 1 舰 1 点）**：`DOT_N = 1` ⇒ `DOT_MIN_PX / DOT_PITCH_MIN_PX = 3.60/4.0 = **0.90**`（**v12 值**；原 `2.72/3.2 = 0.85`，见 §7）
  ⇒ 有 10% 间隙（原 15%），读作"点"。

### 3bis.3 正解：把自由度换成【屏幕空间点距下限】

`DOT_PITCH_MIN_PX = 4.0`（屏幕像素，`Battle3DOverlay.ts:574`；**v12 由 3.2 抬到 4.0**，见 §7）。做法：

> 在**屏幕像素空间**按边长 `DOT_PITCH_MIN_PX` 的方格分桶，**每个方格最多只出 1 个点**。

- **近处**：方格边长 > 阵型格距的屏幕投影 ⇒ 每格至多 1 舰 ⇒ 自然退化为「**1 舰 1 点**」
  —— 正是用户要的语义（"用光点代表战舰、用光点组成阵型"）。
- **远处**：多舰落进同一格 ⇒ 合并成 1 点 ⇒ 屏幕上点距**恒 ≥ `DOT_PITCH_MIN_PX`**
  ⇒ **永不重叠成块，也永不空白**。
- 为什么可以**彻底弃用 alpha=0**：判据 `floor(sx / pitch)` 是**屏幕空间的连续量**，
  缩放时格子边界平滑移动、点阵平滑增减，**没有阈值跳变** ⇒ 不需要"太远了就抹掉"。

**点径与 alpha**：

```
点屏径 = max(DOT_MIN_PX, px × DOT_SCALE) × (1 − grow) × (旗舰 ? FLAGSHIP_DOT_GAIN : 1)
alpha  = (1 − grow) × (0.78 + 0.22 × sstep(DOT_IN_LO, DOT_IN_HI, px))   // 下限 0.78，永不归零
```

- `DOT_DIAM_K = 0.90`（`点径 ÷ 点距`，**v12 值**；原 0.85）：恒 < 1 ⇒ 恒有间隙。`DOT_MIN_PX = DOT_PITCH_MIN_PX × DOT_DIAM_K = 3.60`（派生；原 2.72）。
- **alpha 下限 0.78**：保留一点距离层次感，但**不得再出现 alpha 被距离打到 0 的分支** ——
  "太远"改由**点距下限**表达，不再由**亮度**表达。
- 旗舰点径放大 `FLAGSHIP_DOT_GAIN`(2.4) 倍并向白 lerp 0.45（1 舰 1 点体系里，大小 + 色偏是唯一区分手段）。

### 3bis.4 `DOT_N` / `DOT_SPREAD_K` / `DOT_SCALE` 的现状

`DOT_N` 已**降级为"多点模式开关（当前关闭）"**。`DOT_SPREAD_K`（点团半径比）与 `DOT_SCALE`（点径比）
**仅在多点模式（`DOT_N > 1`）下有意义**；`DOT_N = 1` 时：
单点落在舰心（`DOT_SPREAD_K` 无效）、点径由 `px × DOT_SCALE` 给出并被 `DOT_MIN_PX` 托底、
"会不会糊成块"由 `DOT_PITCH_MIN_PX` 保证。**保留这三个常量是为了让"调回多点"随时可用。**

---

## 3ter. 【rev2 新增】`DOT_SLOTS` 容量解耦的推导

**旧式容量**：光点层缓冲按 `MAX_MESHES × DOT_N` 分配（`MAX_MESHES = 400`）。
`DOT_N` 从 12 收到 **1** 后，这个式子退化为 **400 × 1 = 400** —— 而一场会战的实体预算 `N_MAX = 1400`。

⇒ **第 401 艘之后的舰：既没有 3D 实体（池上限 400）、也没有光点（缓冲容量 400）= 彻底隐形。**
这正是用户实机反馈的"**从几个角度看过去舰船就是看不见了**"的**物理原因**
（`writeDotLayers` 里 `dp + DOT_N <= DOT_CAP` 判假就整舰跳过）。

**修复**（WS12）：

```
const DOT_SLOTS = N_MAX × DOT_N = 1400 × 1 = 1400     // Battle3DOverlay.ts:574
```

- 四个缓冲 `dotPos/dotCol/dotAlpha/dotPx` 与 `DOT_CAP` 全部改用 `DOT_SLOTS`。
- 内存：`1400 槽 × (3+3+1+1) float ≈ 45 KB`，**可忽略**。
- ⚠ 定义位置：`DOT_SLOTS` 依赖 `DOT_N`，而 `DOT_N` 声明在 `MAX_MESHES` 之后 ⇒ 定义在 `:574`（`DOT_N` 下方）。
  若提前到 `MAX_MESHES` 旁会触发 TS2448 "used before its declaration"。

**与 `MAX_MESHES` 的职责分界（必须解耦）**：

| 常量 | 管什么 | 成本 |
|---|---|---|
| `N_MAX`(1400) | **画多少舰**（光点层，1 个 `THREE.Points` = 1 draw call） | 几乎免费（每实体 `DOT_N` 个顶点） |
| `MAX_MESHES`(400) | **多少舰同时挂 3D 模型** | 重活（每舰多部件 + 线框，多 draw call） |

> 二者继续绑定的话，把 `K_VISUAL` 调到 1:100 / 1:50（实体数 ×2~×4）会连带把模型上限也放大 ⇒
> 近景一次性建 1000+ 个模型 ⇒ 卡死。
> 现在：**实体预算可以很大**（光点层扛住密度），**模型池固定**（近景才可能触顶，触顶的舰退回光点，不会变成隐形洞）。

---

## 4. 单一真源地图（改一处即全生效）

```
config/formationLayout.ts     平面：gx/gy 格位、formationSpacing、formationLayerOffsets、FORMATION_FOOTPRINT_LIMIT
config/fleetTierLayout.ts     纵向：TEAM_LAYERS / TIER_MAX / LAYER_GAP / TEAM_GAP / 档位
config/fleetSplitManeuver.ts  机动：侧翼包抄三幕几何（P1，未接触发）
config/shipScaling.ts         折算：N = clamp(round(S/K))、ΣHP 守恒、SHIP_TYPE_*（唯一折算入口，见 §4.3）
        │
        ├─ 消费 1：BattleScene（2D 逻辑，**平面**，命中/寻路/数值零改动）
        └─ 消费 2：Battle3DOverlay（3D 视觉，**平面 + 队内层 + 队间档**）
                          ↑ 只读 sprite.x/y，不反向写回
```

**硬约束（全部满足）**：不改战斗数值 · 实体即真实战斗单位 · 保留既有 VFX（`fx3d`）·
单一真源 · 无随机（确定性）· 不改 Go · 不提交 git。

### 4.1 最终参数表（每个值 = 真源文件 + 一句"为什么"）

> 口径：`px` = **该舰的屏幕投影长度（像素）**，全文统一（不写"屏幕长度""投影像素"等别名）。
> 真源行号为本文件 rev2 时的快照。

**`frontend/src/game/three/Battle3DOverlay.ts`**

| 常量 | 值 | 行 | 为什么是这个值 |
|---|:--:|:--:|---|
| `SHIP_VISUAL_SCALE` | 0.40 | 136 | 缩舰的**单一杠杆**：一次乘到全舰种 L/W/H，让"几千艘小舰的密集阵列"读得出来；阈值（`MESH_IN_*`/`DOT_IN_*`）必须随它等比下调 |
| `DOT_N` | 1 | 538 | 远景正式语义 = **1 舰 1 个圆点**（用户原话）；多点模式保留但关闭。历史 20 → 12 → 1（v12 已就地更新行号） |
| `DOT_PITCH_MIN_PX` | **4.0**（v12；原 3.2） | 574 | 光点阵**屏幕空间最小点距** —— 远景"看得见又不糊成块"的唯一自由度（§7） |
| `DOT_DIAM_K` | **0.90**（v12；原 0.85） | 578 | 点径 ÷ 点距，< 1 才有间隙 ⇒ 读作点阵（§7） |
| `DOT_MIN_PX` | **3.60（派生）**（v12；原 2.72） | 586 | `= DOT_PITCH_MIN_PX × DOT_DIAM_K`；派生而非字面量，保证与二者恒成对 |
| `DOT_SLOTS` | **1400** | 595 | `= N_MAX × DOT_N`；**必须独立于 `MAX_MESHES`**，否则第 401 艘隐形（§3ter） |
| `DOT_SCALE` | **0.32**（v12；原 0.30） | 562 | 点屏径比例（多点模式专用；现行点径 = `max(DOT_MIN_PX, px×0.32)`）（§7） |
| `MAX_MESHES` | 400 | 498 | 3D 模型池硬上限（≈ 4 draw/舰的重活）；与 `N_MAX` 解耦 |
| `MESH_IN_LO / HI` | 14 / 26 | 472 / 473 | 实体淡入区间（缩舰后等比下调）；`px ≥ 26` 才完全交给实体 |
| `MESH_KEEP / DROP` | 17 / 15 | 480 / 481 | 实体池**滞回**（创建阈 > 销毁阈），避免相机推拉时每帧 build/dispose 卡顿 |
| `DOT_IN_LO / HI` | 3.2 / 5.0 | 464 / 465 | **现只驱动标记层远景强度与统计分档**；光点层已改由 `DOT_PITCH_MIN_PX` 驱动，不再有 alpha=0 截断 |
| `MARKER_FLOOR` | 0.05 | 589 | 填充中景下限：降到 0 之前留住"队形底"（与光点叠成两层） |
| `MARKER_FLOOR_OUTLINE` | 0.35 | 594 | 描边中景下限：填充淡出后，"队形轮廓"这条信息不能断 |
| `FLAGSHIP_VISUAL_GAIN` | 1.7 | 147 | 旗舰 3D 实体尺寸放大（近景可辨） |
| `FLAGSHIP_DOT_GAIN` | 2.4 | 149 | 旗舰远景点径放大（1 舰 1 点体系里，大小 + 色偏是唯一区分手段） |
| `FLAGSHIP_RING_K` | 1.35 | 151 | 指挥光环半径 ÷ 舰长 |
| ~~`FLAGSHIP_BEAM_K`~~ | **已删除**（v12） | — | 原"指挥光柱高度 ÷ 舰长"；v12 已移除旗舰竖直光柱，仅保留水平细环 `FLAGSHIP_RING_K`（§7 / §6.2） |
| `FLAGSHIP_RING_SPIN` | 0.55 | 154 | 光环自转角速度（rad/s） |
| `CAM_ELEV` | 0.6109 | 477 | 默认相机俯角 ≈ 35°；0.96 rad（55°）是近俯视，会把垂直分层压成一摞读不出来 |

**`frontend/src/config/`**

| 常量 | 值 | 真源 | 为什么 |
|---|:--:|---|---|
| `FORMATION_SPACING` | 26 | `formationLayout.ts:35` | 同队相邻舰的默认格距（像素）；足迹超预算时才压缩 |
| `FORMATION_FOOTPRINT_LIMIT` | 6 | `formationLayout.ts:54` | 半跨上限系数 `R_BUDGET = hexR × 6`；够大让大 n 不压缩 |
| `TEAM_LAYERS` | **16** | `fleetTierLayout.ts:62` | 队内垂直层数；演进 3→5→16，缩舰后 16 层才读出"密集军团"（§2） |
| `TIER_MAX` | 3 | `fleetTierLayout.ts:65` | 每方最多 3 个高度档（用户"队内 5 层，3 级"） |
| `LAYER_GAP_K` | 0.3125 | `fleetTierLayout.ts:68` | 队内层距比例（demo 0.5/1.6） |
| `LAYER_SHIP_H_SAFE` | 1.2 | `fleetTierLayout.ts:70` | 层距几何下限系数，**必须 > 1**（旧值 0.8 是层间互穿 bug，§2.1） |
| `TIER_GAP_K` | 2.5 | `fleetTierLayout.ts:72` | 队间档距比例（demo 4.0/1.6） |
| `TIER_BOARD_GAP_K` | 1.5 | `fleetTierLayout.ts:74` | 档距间隙下限系数（保证 `boardGap ≥ 0.5×体高`） |
| `FORM_ANIM_SEC` | 0.4 | `fleetTierLayout.ts:84` | 换阵/换档纵向过渡时长，与平面迁移同步 |
| `SHIP_SCALE` | 500 | `shipScaling.ts:24` | **战斗/HP 比例尺**：每 500 艘 = 1 个基准战斗单位（与 `K_VISUAL` 独立，§4.3） |
| `K_VISUAL_DEFAULT` | 100 | `shipScaling.ts:128` | **实体数比例尺**默认档（用户"把 1:250 改成 1:100 或 50"）；只改"画几艘" |
| `K_VISUAL_OPTIONS` | `[50,100,250]` | `shipScaling.ts:120` | 档位真源（当前未被 UI 引用）；分母越小画得越多 |
| `N_MAX` | 1400 | `shipScaling.ts:130` | 单场会战**实体预算**上限（覆盖 K_VISUAL=100 的 6v6 满编 1200） |
| `N_MAX_PER_FLEET` | 200 | `shipScaling.ts:145` | 单队实体上限：**防舰体互穿 + 足迹预算**的几何上限，非性能上限 |

### 4.2 三段式表示（LOD）语义

由**屏幕投影像素长 `px`** 驱动（`px = 舰长 /(2·tan(fov/2)·d)·H`，见 `pxOf()`）：

| 档 | 判据 | 表示 | 成本 |
|---|---|---|---|
| **远景** | `px < DOT_IN_LO`(3.2) | **1 舰 1 个圆点**组成的**点阵**（屏幕空间点距下限驱动）+ **阵型标记**（填充 `MARKER_FLOOR`、描边 `MARKER_FLOOR_OUTLINE`） | 光点层 1 draw call |
| **中景** | `DOT_IN_LO ≤ px < MESH_IN_HI` | 单 `THREE.Points` **光点层** | **1 draw call** |
| **近景** | `px ≥ MESH_IN_HI`(26) | **GLB 实体阵列**（池上限 `MAX_MESHES`） | 每舰多部件 + 线框，多 draw call |

- 同一支舰队的**标记底框**在中景是"点阵下面那层队形轮廓"（与光点叠两层），近景随实体长成而淡出。
- 三层由同一个 `grow`（= 实体的 `meshOn`）驱动，保证"点位置 / 点屏径 / 点透明度"锁相。

### 4.3 唯一折算入口 `config/shipScaling.ts`

**守恒律（本设计成立的核心）**：

```
ΣHP = Σ_t SHIP_TYPE_HP[t] × (C_t / SHIP_SCALE)         // C_t = 舰种 t 的兵力
```

只取决于**编制 `C_t`**，与实体数 `N`、`K_VISUAL` **严格无关** ⇒ 调 `K_VISUAL` **只改"画几艘"，不改战斗平衡**。

**两个独立的比例尺（不要混为一谈）**：

| 比例尺 | 常量 | 作用 |
|---|---|---|
| ① 战斗 / HP | `SHIP_SCALE = 500` | `s` 艘 → 1 个基准战斗单位，`hp = SHIP_TYPE_HP[t] × (s/500)` |
| ② 实体数 | `K_VISUAL` | `S` 兵力 → `N = clamp(round(S/K_VISUAL), 1, N_MAX)` 个可渲染实体；**只影响"画几艘"** |

**唯一入口（两条部署路径共用）**：

| 函数 | 职责 |
|---|---|
| `scaledSlotsForComposition` | 编制 → `N` 个实体（每个实体摊到多少兵） |
| `applyStatsToSlots` | 实体 + 倍率 → 逐实体 `hp/atk/…`（含按舰种聚合的**整数余数补偿**，使 ΣHP 只取决于兵力） |
| `buildTacticalUnits` | 外层组合：编制 + 预算 + 倍率 → 逐实体数值清单 |
| `totalsOfComposition` / `totalShipsOf` / `fleetVisualCount` / `fleetEntityCount` / `allocateVisualCounts` | 编制/兵力/实体数辅助 |

> **禁止任何调用方自己再算一遍实体数、或再写一遍 HP 公式。** 历史教训：路径 B（演习）曾绕过本文件
> 直接读硬编码 `deck`（§1bis）⇒ 调 K_VISUAL 只对战役生效。

---

## 5. 验收方式（本轮的核心变化）

上一轮**只有源码级 harness**（`_verify_*.cjs`），看不到"实机像不像 demo"。本轮补齐**真机闭环**：

```
_v2_shot.html + _v2_shot.ts   ← 把**真实** Battle3DOverlay 挂进真实 Chromium/WebGL
        │                        （Phaser BattleScene 用忠实于数据契约的替身；舰位由 BattleScene
        │                         的同一阵型公式解出稳态）
_v2_play.cjs                  ← 起 Vite → 无头 Chromium（SwiftShader）→ 按场景摆相机 → 截图
        └─ _v2_shots/*.png + manifest.json（含 __b3dStats / __b3dVLayout / __b3dPerf 数值）
_v2_report.cjs                ← manifest → 报告证据段（机器抽取），并用 config/ 单一真源**独立重算**
        │                        渲染值 vs 重算值 交叉核对（源码级 harness 给不出这类证据）
        └─ _v2_report_out.md
_v2_console_probe.cjs         ← 单页控制台错误归因（读 msg.location() 拿 URL）；配
        └─ _v2_shot_noicon.html  作为"修复前"对照页 → 归因 + 修复 双向机器证据
_v2_assemble_report.cjs       ← 叙述段 + 证据段 → 最终报告（避免手抄 21 行表 / 49 条断言）
```

截图矩阵：**4 档缩放**（px ≈ 5 / 22 / 72 / 190）× **5 阵型** × **3 档侧视** × **侧翼包抄 t=0/0.4/1** ×
**6v6 全貌**（斜视 / 低角 / **近俯视沙盘**）共 **21 场景**。

结果：`_v2_verify` 57/57、`_v2_verify_ws567` 35/35、`_v2_report` 49/49、`vue-tsc` EXIT=0、真机控制台 0 错误。

### 5.1 【rev2 补】WS8 / WS11~14 的端到端台架

`frontend/_v5_play_skirmish.cjs` —— 走**演习（skirmish）真实入口**的端到端台架
（起 Vite dev + 无头 Chromium + 读 `window.__b3dStats()`）。
**本轮运行记录**（`node _v5_play_skirmish.cjs 40 --shots --light`，2v2，viewport 1600×900，SwiftShader）：
`RESULT: 11 PASS / 0 FAIL`，0 控制台错误，0 非 2xx。

| 档位 | `units` | `meshes` | `points` | `near` | `mid` | `far` | `pooled` | `markerAlpha` |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 近景（`93_grand_fleet_close.png`） | 600 | 238 | 382 | 200 | 399 | 1 | 0 | 0 |
| 中景（`94_grand_fleet_mid.png`） | 600 | 231 | 420 | 162 | 390 | 48 | 0 | 0 |
| 远景/宽景（`95_grand_fleet_wide.png`） | 600 | 0 | **568** | 0 | 552 | 48 | 0 | 0.05 |

- **关键旁证**：宽景 `points = 568 > 400`（旧容量上限）—— 旧代码在 `DOT_CAP = 400` 时会把第 401 之后的点
  **全部丢弃**（§3ter），新 `DOT_SLOTS = 1400` 后不再丢。本次仅为 2v2（600 实体）已越过旧门槛。
- 断言含"无隐形洞（`pooled>0` 的舰都有光点）"与"Σ实体 ≤ N_MAX"，均 PASS。
- ⚠ 这些是**无头 SwiftShader 软渲染**读数，**不代表实机 GPU 帧率**（见 §6）。

---

## 6. 未决 / 登记不做的部分（含 rev2 状态）

| 项 | 状态 | 结论 |
|---|---|---|
| 演习"恒 8 艘"根因 | **已解决** | 路径 B 硬编码 `deck`（`simFullDeck`=8）；WS8 接入唯一折算入口（§1bis） |
| 单层 / 阶梯状的多层 | **已解决** | `LAYER_SHIP_H_SAFE` 由 0.8（< 1 ⇒ 层间互穿）改为 1.2（§2.1） |
| 舰长 / 格距失配 | **已解决** | `SHIP_VISUAL_SCALE` 作单一杠杆统一缩放 L/W/H |
| 远景糊成方块 | **已解决** | 屏幕空间点阵（§3bis）：`DOT_PITCH_MIN_PX` + `DOT_DIAM_K` |
| 光点层容量塌缩 | **已解决** | `DOT_SLOTS = N_MAX × DOT_N = 1400`（§3ter） |
| fx 与舰体纵向错位 | **已解决** | `fxYAtPx()` / `fxPointAt()`（`Battle3DOverlay.ts:3980/3992`）按像素坐标反查该舰实际 Y，与队内层/队间档同源 |
| 实体预算与模型池耦合 | **已解决** | `N_MAX`(1400) 与 `MAX_MESHES`(400) 解耦（§3ter） |
| 高负载三角面 | **已解决** | `autoLodByLoad`（`Battle3DOverlay.ts:2864`）按实体负载自动降档：近景三角面 **8.83M → 0.46M**（来源：`autoLodByLoad` 量化依据 / QA 侧探针；0.46M 待 QA 复测确认） |
| 演习接入唯一折算入口 | **已解决** | WS8（§1bis） |
| **① 交战初距过大** | **待决策** | `SIDE_X = hexR×22`，两军之间是大片空棋盘，观感是"两块远处的点阵"而非"犬牙交错的会战"（demo 两军是贴在一起的）。**属布局/玩法决策，不是渲染问题**：需文策渊确认交战初距，或给"会战全景"机位预设 |
| **② 侧翼包抄未接触发** | **待决策** | `config/fleetSplitManeuver.ts` 三幕已实现，但**未接任何玩法触发**（"不新增玩法"约束）；如需接入需产品决策 |
| **③ `perfGovernor` 默认关闭** | **待决策** | 按帧时自动降档默认关闭（`MESH_BUDGET_MIN 120` / `PERF_BUDGET_MS 22` / `PERF_COMFORT_MS 15` / `PERF_STEP 0.85`）；是否默认开启需产品决策 |
| **④ 实机 GPU 帧率未复测** | **待决策** | 无头环境是 SwiftShader 软渲染，读数**不代表**实机；需在用户机上复测 |
| `line` 阵 n=200 轻微互穿 | **登记不做** | 横排宽主导导致互穿；修需更大足迹（挤占棋盘），本轮不处理 |
| `K_VISUAL=50` 触顶 | **登记不做** | 单队被 `N_MAX_PER_FLEET = 200` 封顶；再要更密需同时上调 `N_MAX` |
| **两军起始间距** | **待决策** | 同 ①（同一问题的两个视角）：真机俯视图（`26_grand_6v6_plan`）暴露"两军之间大片空棋盘" |
| **真机截图的取景本身是判据的一部分** | **已登记** | 侧翼包抄初版用 `az=0/polar=34°` 取景，`lat`（世界 Z）恰落在视线方向 ⇒ 屏幕上看不出两翼分开，一度误判"没生效"（读数一直是对的）。教训：**读数对而取景错，会让"看起来没生效"**。已改 `polar=18°` 近俯视 |
| 3D 层与 2D 层的位置一致性 | **设计边界** | 3D 只读 `sprite.x/y`；纵向层/档是纯视觉，**2D 命中判定不含高度** —— 刻意边界 |

### 6.1 仍存在的主要瓶颈

- **draw call 随模型数线性增长**：尾焰已是单 `Points` 层，热点是"每舰多部件 + 线框"。
  **实测高负载瞬时可达 4291**（来源：QA 侧探针；本文件作者本轮 2v2 近景实跑峰值 `renderCalls = 1042 @ 238 meshes`）。

### 6.2 旗舰方案现状（**未完成**）

**已落地三层**（尺寸 / 远景点 / 指挥光环）：

| 层 | 手段 | 常量 |
|---|---|---|
| 近景尺寸 | 3D 实体整体放大 | `FLAGSHIP_VISUAL_GAIN = 1.7` |
| 远景点 | 点径放大 + 向白 lerp 0.45 | `FLAGSHIP_DOT_GAIN = 2.4` |
| 中近景标识 | 指挥光环（`FLAGSHIP_RING_K`，**仅水平细环**）+ 自转（`FLAGSHIP_RING_SPIN`）。~~竖直光柱 `FLAGSHIP_BEAM_K`~~ 已于 v12 删除 | — |

> ⚠ **用户要的"特殊模型"（更独特的旗舰外观）尚未做** —— 明确标注为**未完成**。
> 现方案只是"同款舰体放大 + 加标识"，不是"旗舰有专属外形"。

---

## 7. 【v12 / WS12 增量】光点加大 · 删旗舰光柱 · 性能三档

> **本节为 v12（2026-09-13 晚）增量补记**，接在 rev2 正文之后；rev2 正文中已被 v12 覆盖的数值**已就地夹注修正**（§3bis.2 / §3bis.3 / §4.1 / §6.2），本节集中说明增量本身。
> 真源：`frontend/src/game/three/Battle3DOverlay.ts`（行号为本次补记时快照）。独立验证见 `docs/qa/v12光点加大与性能改动验证_20260913.md`（V1/V2/P1/P2/P3 + 回归锁）。

### 7.1 光点加大（点径三件套同步上调）

「远景圆点太小」是用户实报项。放大**不是单独拧一个数**：点径下限是**派生值**，必须与点距、点径比**成对**改（三者恒满足 `点径/点距 = DOT_DIAM_K < 1`）：

| 常量 | rev2 | **v12** | 行 | 依据 |
|---|:--:|:--:|:--:|---|
| `DOT_PITCH_MIN_PX` | 3.2 | **4.0**（+25%） | 574 | 放宽屏幕空间点距下限，配合点径比上调后仍是"离散圆点" |
| `DOT_DIAM_K` | 0.85 | **0.90** | 578 | 点径占点距的比例提高 ⇒ 点更大；仍 < 1，间隙 = `4.0 × (1−0.90) = 0.40 px`（原 `3.2 × (1−0.85) = 0.48 px`） |
| `DOT_MIN_PX` | 2.72 | **3.60**（派生） | 586 | `= 4.0 × 0.90`；**派生值、不写字面量** ⇒ 与上二者恒成对 |
| `DOT_SCALE` | 0.30 | **0.32** | 562 | 点屏径比例（多点模式专用；`DOT_N = 1` 时点径 = `max(DOT_MIN_PX, px×0.32)` 再被 24px 封顶） |

- **净效果**：点径下限 2.72 → 3.60 px（**+32%**）；"点径/点距" 0.85 → 0.90（间隙 15% → 10%），仍读作"离散圆点"而非实心块。
- **1 舰 1 点语义不变**（`DOT_N = 1`）；放大后仍被 `DOT_MIN_PX` 托底、被 `makeDotMaterial(24,…)` 封顶。
- ⚠ 24px 是点径硬上限：若将来把 `DOT_PITCH_MIN_PX × DOT_DIAM_K` 抬过 24，必须同步放大该上限（见 `Battle3DOverlay.ts` 光点层缓冲处注释）。

### 7.2 删旗舰竖直光柱（仅留水平细环）

- `FLAGSHIP_BEAM_K`（原"指挥光柱高度 ÷ 舰长"）**已删除**；`attachFlagshipFx` 现只构建 `RingGeometry(r*0.90, r, 48)` **水平细环**，无 `CylinderGeometry`。
- 源码侧 `FLAGSHIP_BEAM_K` / 中文「光柱」引用数均为 **0**；运行时旗舰 group 子对象几何表不含 `CylinderGeometry`、`fxCylinderChildren = 0`（见 v12 验证报告 V2）。
- 旗舰三层的**中近景标识**因此从"光环 + 光柱 + 自转"变为"光环 + 自转"（§6.2 已就地更正）。

### 7.3 性能三项（P1 / P2 / P3）

| 项 | 内容 | 真源 | 为什么 |
|:--:|---|---|---|
| **P1** | WebGLRenderer `{ antialias:false, alpha:true, powerPreference:'high-performance' }`；离屏 RT **保留 MSAA** | `Battle3DOverlay.ts:1258-1262` | 本层只有两次 render，第二步把覆盖全屏的 quad 合成到默认帧缓冲 —— **默认帧缓冲上没有几何边缘**，画布级 MSAA 无效、只白占多重采样后备缓冲；几何边缘由离屏 RT 的 `samples` 保障。`powerPreference` 让双显卡机器优先请求独显 |
| **P2** | 3D 就绪后**暂停 2D 渲染**（Phaser `BattleScene.sys.settings.visible=false`、canvas `hidden`、`body.battle3d-mode`），退出时恢复 | `App.vue` 的 `setBattleSceneVisible()` | `SceneManager.render()` 看 `visible`，而 `update()/step()` 不看 ⇒ **逻辑照跑、只是不画 2D 层**，省掉一份全屏 Phaser 渲染 |
| **P3** | 画质档 `BATTLE3D_QUALITY` high/medium/low（`dprCap` + 离屏 `msaa` 同源）：high `{2, 4}`＝改动前**逐位相同**、medium `{1.5, 2}`、low `{1, 0}`；另加**帧率保护开关**（`perfGuard`）与**显示帧率**（`showFps`，默认关） | `Battle3DOverlay.ts:166-170`；`battle3dQuality` 于 :1158 / 读取于 :1236-1242 | `renderer.setPixelRatio` 与 `WebGLRenderTarget.samples` 必须同源，否则分辨率与抗锯齿不一致；档位在**本层创建时读取一次、下一场战斗生效**（与 `shipModelDetail` 同规则；热切换需重建整层）。1600×900 基准下 medium/low 省像素 **-43.75% / -75%**、省采样 **-71.875% / -93.75%**（见 v12 验证报告 P3） |

> 三项的共同取向：**默认档不改变观感**（high 与改动前逐位一致、帧率保护默认关），把"更省"交给玩家显式选择。

### 7.4 与 rev2 正文的关系

- rev2 正文（§3bis / §4.1 / §6.2）中 `DOT_PITCH_MIN_PX = 3.2`、`DOT_DIAM_K = 0.85`、`DOT_MIN_PX = 2.72`、`DOT_SCALE = 0.30`、`FLAGSHIP_BEAM_K = 3.2` 均为 **rev2 时点值**，已在原处夹注 v12 现值与本节指引；**本节的 §7.1 表为现行口径**。
- 验收产物指针：`docs/qa/v12光点加大与性能改动验证_20260913.md`（V1 光点加大 / V2 删光柱 / P1 画质与上下文 / P2 停 2D / P3 画质三档 / REG 回归锁）。
