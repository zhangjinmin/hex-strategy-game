# ADR-002 · Three.js 场景图结构与 2D 战术坐标 → 3D 世界坐标映射

- **状态**：提议（待 team-lead 批准；§4 高度表需 art-director 会签）
- **日期**：2026-08-30
- **决策者**：engineering-lead
- **关联**：`01-architecture.md` §3.2、`04-adr-003`（拾取）、`07-adr-006`（棋盘 mesh）、`docs/art/3d-tactical-battle/README.md`

---

## 1. 上下文

现有战术层坐标是 **2D 平面 + `hexRadius` 缩放**（逻辑平面，单位=像素）：

```ts
// 正解（BattleScene.ts:955-956, 196-199, 1148-1149 等处）
x = hexRadius * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
y = hexRadius * (3 / 2 * r);

// 反解（BattleScene.ts:784-785, 1290-1291 等处，pointy-top axial）
q = Math.round((Math.sqrt(3) / 3 * x - 1 / 3 * y) / hexRadius);
r = Math.round((2 / 3 * y) / hexRadius);
```

`hexRadius` 由参战舰队数动态决定（`scaleMapForFleetCount`，BattleScene.ts:1241）：`26 / 32 / 38 / 44 / 50`。

需要回答三个问题：
1. 3D 的第三个维度（高度/纵深）从哪来？
2. 它的**语义**是什么？（是否影响玩法？）
3. 棋盘/舰船在 Y 轴上如何分布？

**硬约束**：战斗规则、数值、AI 逻辑零改动 ⇒ **规则层的所有距离/射程/视野判定必须继续在 2D 逻辑平面上计算**。任何"把距离改成 3D 欧氏距离"的方案都会改变 AI 行为，直接违反约束。

---

## 2. 决定：映射公式

### 2.1 缩放因子 S 的选择

**决定**：`S = 1 / (√3 · hexRadius)`，即 **1 world unit = 1 个六边形中心间距**。

```ts
// frontend/src/game/tactical/BattleView.ts（由 TacticalSim 计算并写入 view）
export const worldScale = (hexRadius: number): number => 1 / (Math.sqrt(3) * hexRadius);
```

推导：相邻格子（q+1, r）的 x 间距 = `√3 · hexRadius` px。令其等于 1 world unit ⇒ `S = 1/(√3 · hexRadius)`。

**这个选择的收益（关键）**：棋盘的世界尺寸**与 `hexRadius` 无关**，因为 `hexRadius` 本身就是"为容纳更多舰队而放大棋盘"的补偿系数。

| 地图 | 逻辑尺寸 (px) @ R=26 | 逻辑尺寸 (px) @ R=50 | **世界尺寸 (unit)** |
|------|---------------------|---------------------|---------------------|
| `random`(默认) | 2252 × 1950 | 4330 × 3750 | **50.0 × 43.3** |
| `random_large` | — | — | **31.5 × 31.5**（933 格） |
| 伊谢尔伦 | 3900 × 624 (R=26) | — | **86.6 × 13.9** |

（世界尺寸 = 逻辑尺寸 × S；`random` 的 50.0 = 2252/45.03 = 4330/86.60，两者相等，验证成立。）

⇒ **相机默认距离、near/far、雾效、LOD 阈值可以全部写成常数，不必随舰队数变化。** 这是选这个 S 的唯一理由，但足够充分。

### 2.1.1 与 art 侧单位约定的对齐（**必须读，否则会与美术规格错位**）

`docs/art/3d-tactical-battle/ship-assets.md` §5.0 定义的是 **`1 世界单位 ≈ 15 px`**（锚点：2D 战列舰 33 px ↔ 3D 长 2.2 单位）。本文档定义的是 **`1 世界单位 = 1 个六边形中心间距 = √3 · hexRadius px`**（`hexRadius = 26` 时 = 45.03 px）。

两者**相差 3 倍**：`45.03 / 15 = 3.00`。

| 量 | 像素（唯一真相） | art 单位（÷15） | 本文档单位（÷√3·R, R=26） |
|---|---|---|---|
| `hexRadius` | 26 px | 1.73 | **0.577** |
| 六边形中心间距 | 45.03 px | 3.00 | **1.000** |
| 战列舰长度 | 33 px | 2.20 | **0.733** |
| 旗舰长度 | 42 px | 2.80 | **0.933** |
| 常规舰悬空高 | 10 px | 0.67 | **0.222** |
| 旗舰悬空高 | 26 px | 1.73 | **0.577** |
| 阵型间距 `spacing` | 28 px | 1.87 | **0.622** |
| 护盾涟漪 `rx` | 14 → 32 px | 0.93 → 2.13 | **0.311 → 0.711** |
| 棋盘宽（`random`） | 2252 px | 150 | **50.0** |

**决定：采用本文档的单位（1 unit = 六边形中心间距）。**

理由：
1. **棋盘世界尺寸恒定**。art 侧的 `15 px/unit` 是**固定**换算，而 `hexRadius ∈ {26, 32, 38, 44, 50}` 是**动态**的 ⇒ art 侧单位下棋盘宽度会在 `150`（R=26）与 `288`（R=50）之间变化 1.92 倍。这会让 `minDistance = 8`、LOD 阈值（`8 / 20` 单位）、拾取阈值等所有绝对值在不同舰队数下含义不同。
2. **舰船与格子的比例恒定**。战列舰 0.733 unit、格子间距 1.0 unit —— 无论 `hexRadius` 多少，"一艘战列舰占 0.73 格宽"永远成立。art 侧单位下，`hexRadius=50` 时战列舰仍是 2.2 单位但格子变成 5.77 单位 ⇒ 视觉比例变化 1.92 倍。
3. **像素是唯一真相**。art 规格里的所有数值都能追溯到 2D 像素（船体尺寸来自 `BattleScene.ts:699-704`，悬空高来自 `CrtRenderer.ts:405` 的 `isFlagship ? 26 : 10`）。两种单位只是对同一组像素的不同缩放标签，**不会丢失任何美术意图**。

**给实施者的换算规则**：
> 读到 `docs/art/3d-tactical-battle/*.md` 里的任何"世界单位"数值 **`V_art`**，一律换算为 **`V_eng = V_art / 3`** 后使用（该换算在 `hexRadius = 26` 下精确；其他 `hexRadius` 下 art 规格的相对比例仍然成立，因为像素才是真相）。
> 反过来，本文档中任何数值若需回写给 art 侧，乘 3。

**需 art-director 会签（A2-Q7）**。

> **补充（UX 侧也锚定了 `15 px/unit`，见 `05-readability-risks.md` 第 44 行）**。为降低三方对齐成本，工程侧追加一条收敛规则：
>
> **距离阈值一律用「格（hex）」书写，尺寸数值一律用「像素」书写。**
>
> | 类别 | 书写单位 | 理由 |
> |---|---|---|
> | 相机 `minDistance` / `maxDistance` / 默认距离 | **格** | 相机要看"多少格"，与 `hexRadius` 无关 |
> | LOD 距离阈值 | **格** | 同上 |
> | 拾取最小可点半径 | **屏幕像素** | 可读性由屏幕尺寸决定，与世界尺度无关（UX 已如此定义 `MIN_PX = 12px`） |
> | 舰体尺寸 / 悬空高度 / 涟漪 `rx` | **像素**（2D 现状值，唯一真相） | 保持与 2D 观感一致 |
> | 地块高度 / 泳道 / 阵型高度分量 | **格** | 相对棋盘尺度的比例，必须 R 无关 |
>
> 换算工具放 `frontend/src/game/config/tacticalVisual.ts`：
> ```ts
> export const PX_PER_HEX = (hexRadius: number) => Math.sqrt(3) * hexRadius;
> export const PX_PER_ART = 15;                                  // art/UX 侧单位
> export const hexToPx  = (v: number, R: number) => v * PX_PER_HEX(R);
> export const artToPx  = (v: number) => v * PX_PER_ART;
> export const artToHex = (v: number, R: number) => v * PX_PER_ART / PX_PER_HEX(R);
> ```
>
> 若 art/UX 侧坚持 `15 px/unit` 且不接受"阈值用格"，则工程侧的后果是：相机/LOD/拾取阈值必须按 `hexRadius` 写 5 套参数（26/32/38/44/50），并在每次调整舰队规模配置时同步复核。

### 2.2 完整映射

```ts
// 逻辑平面 (px) → 世界空间 (unit)
worldX = (logicX - originX) * S;
worldZ = (logicY - originY) * S;      // 注意：logic y → world Z（不是 -Z）
worldY = f(tile, unit, formation, t); // 见 §3、§4
```

- `originX / originY` = 逻辑平面的包围盒中心（px）。由 `TacticalSim` 在 `buildMapData` 后算一次，写进 `BattleView.originX/Y`。
- **手性**：Three.js 右手系 Y-up。相机默认位于 `+Z` 侧俯视原点 ⇒ 屏幕上方 ≈ 世界 `-Z`，屏幕右方 ≈ 世界 `+X`。
  逻辑 `+y` 在 2D 里是"屏幕向下" ⇒ 映射到世界 `+Z` = "屏幕向下"。**与 2D 观感一致** ✓

### 2.3 舰船朝向映射

2D 现状：`facing = Math.atan2(dy, dx)`（逻辑平面），`u.sprite.rotation = facing`，内部贴图再转 `+π/2` 使舰头从"上"转到"右"。
⇒ **约定：3D 舰船几何体的舰头指向 local +X**（与 2D 约定一致）。

```ts
// Three Ry(α) 作用于 local +X (1,0,0) 得世界方向 (cos α, 0, -sin α)
// 目标世界方向 (cos facing, 0, sin facing)
// ⇒ α = -facing
mesh.rotation.y = -facing;
```

验算：
- `facing = 0` → 逻辑 +x → 世界 +X；`α = 0` → nose = (1,0,0) ✓
- `facing = π/2` → 逻辑 +y（屏幕下方）→ 世界 +Z；`α = -π/2` → nose = (0,0,1) ✓

### 2.4 六边形几何体朝向（实现细节，容易踩坑）

游戏的 hex 顶点在逻辑平面是 `(cos(60i−30°), sin(60i−30°)) · R`，顶点集合为
`{(0.866,±0.5), (0,±1), (±0.866,∓0.5)}·R` —— **沿 logic-y 轴有尖角（pointy-top）**。

`THREE.CylinderGeometry(r, r, h, 6)` 默认 `thetaStart=0`，顶点为 `(sin θ, cos θ)·r`，θ = 0,60°,…300°：
`{(0,1), (0.866,0.5), (0.866,−0.5), (0,−1), (−0.866,−0.5), (−0.866,0.5)}·r`

**两个集合相同** ⇒ `CylinderGeometry` 默认朝向与游戏 hex 朝向一致，映射到 (x,z) 后无需额外旋转。

```ts
// boardMesh.ts
const R_WORLD = 1 / Math.sqrt(3);          // 0.57735：circumradius，使中心间距 = 1 unit
const geo = new THREE.CylinderGeometry(R_WORLD * 0.94, R_WORLD * 0.94, 1, 6, 1, false);
geo.translate(0, 0.5, 0);                   // 原点移到棱柱底面中心 ⇒ scale.y = h 即"从 0 长到 h"
const mesh = new THREE.InstancedMesh(geo, mat, 2048);
mesh.frustumCulled = false;                 // 单 mesh 覆盖全盘，剔除无意义
```

- `0.94` = 格间缝隙系数（视觉参数，art-director 可调；写入 `tacticalVisual.ts`）。
- `radialSegments = 6`，`heightSegments = 1`，`openEnded = false` ⇒ 每柱 **24 三角形**（侧面 12 + 上下盖各 6）。1951 格 = **46.8k 三角形**。
  - 超 `07-adr-006` 的 60k 预算中棋盘配额（35k）⇒ **去掉底盖**（`openEnded` 无法单独关底盖），改为手搓 18 三角形的 geometry（侧 12 + 顶 6）。见 `07-adr-006` §2。

---

## 3. 第三维的语义（本 ADR 的核心）

### 3.1 铁律

> **Y 轴（高度）不参与任何规则判定。**
> 不改变距离、不改变射程、不改变命中、不改变视野、不改变 AI 决策。
> 所有规则计算继续在 2D 逻辑平面进行，用的是 `UnitView.x / UnitView.y`。

**推论**：3D 化后，`Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)` 的语义**逐字保留**（2D 平面距离），只是坐标系名字从 `sprite.x/y` 换成 `x/y`。这是"规则零改动"能成立的根本原因。

### 3.2 Y 轴的组成（可加性分解）

```ts
worldY = ELEVATION[type]        // ①地块棱柱高度（棋盘表面）
       + HOVER                  // ②舰船悬浮高度
       + lane[classId]          // ③舰种泳道
       + formHeight[formation][slotIndex]  // ④阵型高度分量
       + bob(unitIndex, t)      // ⑤呼吸浮动
```

| 分量 | 性质 | 由谁算 | 是否影响规则 |
|------|------|--------|:---:|
| ① `ELEVATION[type]` | 纯装饰 + 可读性 | 渲染层（`tacticalVisual.ts`） | 否 |
| ② `HOVER` | 常数 | 渲染层 | 否 |
| ③ `lane[classId]` | 视觉分层，**有玩法映射**（映射自舰种） | 渲染层（表驱动，键是 `ShipClass`） | 否 |
| ④ `formHeight[formation][i]` | 视觉分层，**映射自阵型** | `TacticalSim`（纯函数，见 §3.4） | 否 |
| ⑤ `bob(i, t)` | 纯动画 | 渲染层 | 否 |

**为什么 ④ 放在规则层？** 因为阵型槽位表 `positions[formation][index]` 本身就在规则层（BattleScene.ts:2700–2734），且它的 **XZ 分量必须与现状逐字相同**。把 Y 分量与 XZ 分量放在同一张表里，能保证"改了 XZ 就一定是 bug，改了 Y 一定是美术调整"，review 时一眼可辨。Y 分量本身仍是**纯渲染数据**（写进 `UnitView.formHeight`，规则层从不读取它做任何判定）。

### 3.3 ① 地块高度表（world unit）

`1 unit = 1 格间距`。棋盘宽 50 unit，所以 `0.85 unit` ≈ 不到一格的 1/5 高度 —— 视觉上是"薄板上的浮雕"，符合 art-director 的"全息作战台"定位。

| `tile.type` | `ELEVATION` | rationale |
|---|---|---|
| `sea` | 0.10 | 最低：视觉上"凹陷的空域"，与不可通行语义呼应 |
| `ruined` | 0.14 | 残骸低平 |
| `pending` | 0.22 | **基准层**，其余高度以此为参照 |
| `pier` | 0.26 | 略高于基准，表示人工设施 |
| `mine` | 0.30 | 矿区 |
| `gold_mine` | 0.32 | 略高于普通矿（价值可读） |
| `barracks` | 0.42 | 兵营：明显凸起 |
| `castle` | 0.52 | 司令部：仅次于要塞 |
| `tower` | 0.58 | 塔：细高，最高的人造物 |
| `planet` | 0.70 | 星球（棱柱是基座，球体另画） |
| `fortress` | 0.85 | 要塞（伊谢尔伦）：最高，一眼可辨 |

**边界条件**：`ELEVATION` 上限 **0.85**。理由：拾取视差误差 = `h / tan(仰角)`，h 越大误差越大；0.85 是在"可读性"与"拾取精度"之间的折中（ADR-003 §2.2 给出量化）。超过 0.85 会让低视角下的相邻格误选率显著上升。

### 3.4 ④ 阵型高度分量（world unit）

**约束**：`formHeight` 只依赖 `(formation, slotIndex)`，**不依赖时间、位置、敌情、随机数** ⇒ 纯函数，可缓存，零规则影响。

现状的 2D 槽位表（BattleScene.ts:2700–2734，单位=槽位，×`spacing=28px` 后为像素）：

```ts
wedge:   [[0,0],[-1,1],[-1,-1],[-2,2],[-2,-2],[-3,3],[-3,-3],[-4,0]]
line:    idx>0 → [-col, col*(idx%2===0?-1:1)*0.3]，col = floor((idx+1)/2)
spindle: [[0,0],[1,0],[0,1],[0,-1],[-1,0],[1,1],[1,-1],[-1,1]]
circle:  idx>0 → [cos(θ)*1.8, sin(θ)*1.8]，θ = (idx-1)/max(1,n-1) * 2π
square:  [-row+1.5, (col-0.5)*1.5]，row = floor(idx/2)，col = idx%2
default: [[0,0],[-1,0],[-2,0],[-3,0],[-1,1],[-2,1],[-3,1],[-4,0]]
```

**这些值全部保留不动**（XZ 分量）。新增 Y 分量表：

| 阵型 | `formHeight(i)`（world unit） | 视觉意图 |
|---|---|---|
| `wedge` | `-0.15 * \|gx\|`，clamp ≥ −0.45 | V 字向前下方俯冲，旗舰（i=0）最高 |
| `line` | `i === 0 ? 0 : (i % 2 === 0 ? +0.18 : -0.18)` | 上下交错，避免纵队首尾互相遮挡 |
| `spindle` | `clamp(0.30 - 0.15 * (\|gx\| + \|gy\|), -0.45, +0.30)` | 中心高、两端收窄 ⇒ 纺锤体 |
| `circle` | `0.22 * Math.sin(3 * θ_i)`（θ_i 同 2D 表） | 环形起伏，像包围球面的三条纬线 |
| `square` | `row % 2 === 0 ? +0.20 : -0.20` | 上下两层，像一堵墙 |
| `default` | 同 `wedge` | — |

`gx, gy` = 上表中该 index 的 2D 槽位坐标。

### 3.5 ③ 舰种泳道（world unit）

| `ShipClass` | 对应 `classType` | `lane` | 意图 |
|---|---|---|---|
| `BB` | `战列` / `battleship` | **0.00** | 主战线基准层 |
| `FBB` | `高战` / `fast_battleship` | **+0.10** | 前卫，略高 |
| `CA` | `巡洋` / `cruiser` | **−0.10** | 主战线下方的护卫层 |
| `DD` | `驱逐` / `destroyer` | **+0.16** | 高速游击，浮在上方 |
| `CV` | `空母` / `carrier` / `突击` | **−0.26** | 后排下方（远离接战线） |
| `FIGHTER` | `舰载` / `fighter` | **+0.24** | 最上层 |
| `EW` | `电子` | **−0.18** | 与空母同侧，偏后 |
| `AUX` | `补给` / `无` | **−0.14** | 后勤层 |

旗舰加成：`isFlagship ? +0.08 : 0`（旗舰略高，便于识别；与 2D 的 `★` 标记等价）。

### 3.6 ② HOVER 与 ⑤ bob

**HOVER 继承 2D 的既有值**（`CrtRenderer.ts:405`：`const hoverH = isFlagship ? 26 : 10;` —— CRT 模式已实现"旗舰悬空最高、常规舰贴地"的分层）：

| 舰船 | 2D 像素 | 本文档单位（÷ 45.03） |
|---|---|---|
| 常规舰 | 10 px | **0.222** |
| 旗舰 | 26 px | **0.577** |

（art 侧的 `0.67 / 1.73` 与本文档的 `0.222 / 0.577` 是同一组像素，见 §2.1.1 换算表。）

穿插检验：地块最高 `0.85`，最低泳道 `−0.26`，`formHeight` 下限 `−0.45`。
常规舰底面 = `0.222 − 0.26 − 0.45 = −0.488` ⇒ 若该舰飞越 `fortress`（0.85）上方，`0.85 + (−0.488) = 0.362 > 0` ✓ **不穿模**。
⇒ 不需要提高 HOVER。`0.222` 足够。

```ts
// ⑤ 呼吸浮动（对应 2D 的 breatheX/breatheY，BattleScene.ts:2745-2746）
const isStopped = /* 规则层算出，写进 UnitView.moving 的反义 */;
const bobX = isStopped ? 0.027 * Math.sin(t * 0.0012 + i * 1.7) : 0;   // world unit
const bobZ = isStopped ? 0.027 * Math.cos(t * 0.0015 + i * 1.3) : 0;
const bobY = isStopped ? 0.035 * Math.sin(t * 0.0009 + i * 2.1) : 0;
```

- XZ 幅度 `0.027` = 2D 的 `1.2 px × S`（R=26 时 `1.2 × 0.022206 = 0.0266`）⇒ **视觉幅度与现状一致**。
- Y 分量是 3D 新增，`0.035` 与 XZ 同量级（art-director 可调）。
- `isStopped` 判定**来自规则层**（现状：`distToTarget < 5 || (isEngaging && stance !== 'siege')`），不是渲染层自己猜 ⇒ 保证与 2D 行为一致。

### 3.7 阵型间距 `spacing = 28px` **不可改**（回应 UX `05` 第 107 行）

UX `05-readability-risks.md` 第 107 行提出：**"阵型间距按舰体尺寸重算：2D 的 `spacing = 28px` 是为 11×33 的贴图设计的。3D 舰体尺寸不同，必须重算，判据是『任意缩放下，同编队相邻舰船的屏幕投影不得重叠』"**。

**工程侧的结论：`spacing` 必须保持 28px，不能改。**

论证：

1. `spacing` 乘的是**逻辑平面槽位坐标**（`positions[i] = [gx, gy]`，单位=槽位），结果是**逻辑平面像素偏移**（`ox = gx * spacing`）。
2. 逻辑平面坐标是**规则层的唯一坐标系**：射程判定 `Distance.Between(u.x, u.y, eu.x, eu.y) <= effectiveRange`（BattleScene.ts:2807）、视野判定、塔射程（140px）、要塞范围伤害（`hexRadius * 2`，行 3596）**全部在逻辑平面上算**。
3. ⇒ 改 `spacing` 就改了单位间的**逻辑距离** ⇒ 改了射程内外的判定 ⇒ **直接违反"规则零改动"**。

**"视觉与逻辑脱钩"更不可接受**：有种折中做法是给渲染层单独一个"视觉散布系数 K"，只缩放世界坐标而不改逻辑坐标。但 UX `05` 第 90–91 行自己给出了反对理由——
> "射程用贴地圆表达……玩家读的是**贴地圆之间的交叠关系**"
> "tooltip 中的距离以**格（hex）**或**世界单位**显示，与战斗规则的计算口径一致"

⇒ 一旦视觉与逻辑脱钩，贴地射程圆就会**撒谎**，玩家看到的"在射程内"与规则判定的"在射程内"不一致。这是比"舰船重叠"严重得多的可读性问题。

**舰船重叠问题该怎么解（不改 spacing 的三条路）**：

| 路 | 做法 | 归属 |
|---|---|---|
| **1** | **缩小舰体尺寸**。2D 战列舰 33px 长、11px 宽；3D 若按 `ship-assets.md` 的 2.2 art-unit（= 33px）建模，纵向必然与 28px 间距重叠。建议舰体长度降到 **≤ 26px**（0.578 工程单位） | **art-director** |
| **2** | **接受重叠**。2D 现状就是重叠的（`line` 阵型纵向间距 28px < 舰长 33px），玩家没有抱怨。3D 有透视与高度分层（泳道 + 阵型高度分量），重叠比 2D 更不显眼 | 默认选项 |
| **3** | 用**阵型高度分量**化解：`line` 阵型已有 ±0.18 的上下交错（§3.4），可在视觉上错开 | 已实现 |

**验算**：`line` 阵型 `[-col, col*(idx%2===0?-1:1)*0.3]`，纵向间距 = `1 × 28 = 28px`，横向交错 = `0.3 × 28 × 2 = 16.8px`。舰宽 11px < 16.8px ⇒ **横向不重叠** ✓。纵向 28px vs 舰长 33px ⇒ **重叠 5px**（17%）。3D 下有 ±0.18 工程单位（≈ 8px）的高度交错 + 透视 ⇒ 视觉上可接受。

**需 art-director 与 UX 会签（A2-Q8）**。若坚持重算 `spacing`，必须走"规则变更"流程（改变射程/视野的有效距离），不在本次范围。

### 3.8 纵深的语义（回答"玩家怎么理解纵深"）

棋盘是**一块薄板**：宽 50 unit，最高起伏 0.85 unit（1.7%）。因此：

- **X 轴 = 战线推进方向**。campaign 模式攻击者出生在 `x = −spawnDist`、防守者在 `+spawnDist`（BattleScene.ts:1176–1184），3D 后仍然是"左军 vs 右军"。
- **Z 轴 = 战线宽度**（包抄、侧翼展开在这个轴上）。
- **Y 轴 = 编队层次**（不承载空间语义）。

**给玩家的可读性手段**（不依赖玩家理解 3D 数学）：
1. 每艘舰正下方投一个**椭圆全息投影到棋盘表面**（art 规格已定）⇒ 提供"这艘船在哪个格子上方"的锚点。
2. 棋盘表面画**正交网格线**（沿 X/Z），与战略层的 GridHelper 语言一致。
3. 相机限制 `maxPolarAngle = 0.35π`（见 ADR-003 §3.2；该值由 art/UX 侧定为 S 级可读性约束，用户已拍板"禁止看到舰船底部"）⇒ 永远俯视，不会看到板底穿帮。

---

## 4. 场景图结构

```
scene (THREE.Scene, background = 0x02040a)
│
├── camera (PerspectiveCamera, fov=45, near=0.5, far=400)
│   └── bgPlane (Mesh, 800×800, ShaderMaterial, position.z = -200, frustumCulled=false)
│        移植自 ThreeStrategicMap.buildDynamicBackground()，参数改用战术层配色
│
├── boardGroup
│   ├── tileMesh        InstancedMesh(hexPrism18tri, 2048)    ← 1 draw call，§2.4
│   ├── tileTopLine     ← 无独立 mesh：顶面描边在 tileMesh 的 fragment shader 里画
│   └── overlayGroup    信标 / 购买高亮 / 占领进度环（≤ 8 个 mesh，非每帧重建）
│
├── unitGroup
│   ├── hullMesh[factionId][classId]   InstancedMesh × 12     ← 2 阵营 × 6 主class
│   ├── flameMesh[factionId]           InstancedMesh × 2      ← 尾焰
│   ├── auraMesh[factionId]            InstancedMesh × 2      ← 底盘光环（椭圆全息投影）
│   └── fighterMesh                    InstancedMesh × 1      ← 航母舰载机（≤ 384）
│
├── fxGroup（全部为预分配 InstancedMesh 池，见 07-adr-006 §4）
│   ├── laserPool / missilePool / ripplePool / explosionPool / damageNumberPool
│   └── fortressBeam（要塞光束，非池化，最多 6 个 mesh 同时存在）
│
├── fortressGroup（伊谢尔伦：棱柱已在 boardGroup，此处放星球/炮塔装饰）
│
└── labelRoot（CSS2DRenderer：舰队名牌 + 要塞 HP 条，≤ 17 个 DOM 节点）
```

**与 `ThreeStrategicMap` 的结构对照**（保证视觉语言一致）：

| 战略层 | 战术层 | 一致性 |
|---|---|---|
| `scene.background = 0x02040a` | 同 | ✓ |
| `buildDynamicBackground()` 挂 camera 的 Shader plane | 同（改配色） | ✓ |
| `EffectComposer` + `RenderPass` + `UnrealBloomPass` + CRT `ShaderPass` | 同（Bloom 分辨率同样取 0.5×） | ✓ |
| `CSS2DRenderer`（节点标签） | 同（舰队名牌） | ✓ |
| `OrbitControls`（damping 0.08） | 同（参数见 ADR-003） | ✓ |
| `nodeMeshes: Map<number, Object3D>`（AoS 独立对象） | `tileMesh: InstancedMesh` | ✗ **有意偏离**，因格子数 1951 vs 59 |

---

## 5. 相机初值（从现状推导，不自创数值）

现状（BattleScene.ts:153–159）：

```ts
this.cameras.main.centerOn(0, 0);
let initZoom = Math.max(0.3, 0.8 * (this.baseHexRadius / this.hexRadius));
if (selectedMapId.startsWith('custom_')) initZoom = Math.min(initZoom, 0.7);
else if (selectedMapId === 'random_large') initZoom = Math.min(initZoom, 0.45);
else if (selectedMapId === 'random_rect')  initZoom = Math.min(initZoom, 0.55);
this.cameras.main.setZoom(initZoom);
```

**决定：`initZoom` 的计算式逐字保留**，用它反推 3D 相机距离：

```ts
// cameraRig.ts
const S = 1 / (Math.sqrt(3) * hexRadius);
const halfFov = THREE.MathUtils.degToRad(45) / 2;
const visibleHexes = (container.clientWidth / initZoom) * S;      // 可见宽度，unit
const D0 = THREE.MathUtils.clamp(
  visibleHexes / (2 * Math.tan(halfFov) * (container.clientWidth / container.clientHeight)),
  8,    // minDistance
  120,  // maxDistance
);
```

验算（1280×720，hexRadius=26，initZoom=0.8）：
`S = 0.022206` → `visibleHexes = (1280/0.8) × 0.022206 = 35.53`
`D0 = 35.53 / (2 × 0.41421 × 1.7778) = 35.53 / 1.4729 = 24.1` ✓

**关键性质**：因为 §2.1 的 S 选择，`visibleHexes ≈ 35.5` 对**任何 `hexRadius` 都成立**（`initZoom` 与 `hexRadius` 成反比，正好抵消）⇒ `D0 ≈ 24` 是稳定初值，不需要按地图类型写第二套数值。地图类型的差异已由 `initZoom` 的三条 clamp 表达。

**默认俯角**：

```ts
const POLAR_DEFAULT = THREE.MathUtils.degToRad(35);   // 距 +Y 轴 35° ⇒ 地平线以上 55°
camera.position.set(
  target.x + D0 * Math.sin(POLAR_DEFAULT) * Math.sin(AZIMUTH_DEFAULT),
  target.y + D0 * Math.cos(POLAR_DEFAULT),
  target.z + D0 * Math.sin(POLAR_DEFAULT) * Math.cos(AZIMUTH_DEFAULT),
);
const AZIMUTH_DEFAULT = 0;   // 相机在 +Z 侧，屏幕上方 = 世界 -Z
```

`35°` 的 rationale：
- 战略层默认 polar ≈ **56°**（相机 `(0, 0.62d, 0.92d)`，φ = atan2(0.92, 0.62) = 56.0°）—— 那是为"星球悬浮带 + 全息桌面"设计的**低角度电影感**视角。
- 战术层棋盘是**薄板**（高度/宽度 = 0.85/50 = 1.7%）。在 56° polar（地平线上 34°）下，50 unit 宽的棋盘在屏幕上被压缩到 `50 × sin(34°) = 28 unit` 的视觉高度，格子严重前缩、互相遮挡，几乎不可读。
- `35°` polar（地平线上 55°）下压缩到 `50 × sin(55°) = 41 unit`，格子接近正六边形，可读性接近 2D，同时保留明显的透视纵深。
- **有意偏离战略层，理由如上。需 art-director 会签**（见 §7 未决 A2-Q1）。

**campaign 伊谢尔伦的既有特殊处理**（BattleScene.ts:1170–1171 `setZoom(0.3); centerOn(fX, 0)`）同样保留：`initZoom = 0.3` ⇒ `D0 = 35.53 × (0.8/0.3) / 1.4729 = 64.3`，`controls.target = (worldX(fX), 0, 0)`。

---

## 6. 后果

### 正面

1. **规则层零改动成立**：所有距离/射程/AI 判定继续在 2D 逻辑平面，坐标只是从 `u.sprite.x` 改名为 `u.x`。
2. **相机/雾效/LOD 参数是常数**，不随 `hexRadius`（舰队数）变化 —— 因为棋盘世界尺寸恒定 50 × 43。
3. **六边形朝向零调参**：`CylinderGeometry` 默认朝向与游戏 hex 顶点集合完全一致（§2.4 已验算）。
4. **高度语义可解释**：每个分量都有单一来源（地块类型 / 舰种 / 阵型 / 动画），调参互不干扰。

### 负面 / 代价

1. **"3D"其实是 2.5D**：高度不参与玩法，所谓纵深主要是视觉层次。这是"规则零改动"约束下的**必然结果**，不是妥协 —— 任何让高度参与玩法的方案都需要重做全部 AI 与数值。
   - 若用户后续希望"高度参与玩法"（如高空轰炸规避），需要新开一条"规则变更"流程，不在本次范围。
2. **薄板 + 低视角的拾取视差**：见 ADR-003 §2.2，必须走 InstancedMesh raycast，不能走平面反解。
3. **`formHeight` 放进规则层是刻意的例外**：它破坏了"规则层不含渲染数据"的纯粹性。理由见 §3.2（与 XZ 分量同表便于 review）。代价是规则层的 `BattleView` 里有两个字段（`lane` / `formHeight`）规则层自己从不读取 —— 需在代码注释里写明"规则层禁止读取本字段"。

---

## 7. 验证方式

| 编号 | 验证 | 命令 / 判据 |
|------|------|-------------|
| A2-1 | 正解/反解自洽 | 单元脚本：对 `q,r ∈ [-25,25]` 全部 1951 格做 `→(x,y)→(q,r)` 往返，要求 **1951/1951 相等**。命令见 `08-roadmap` §Phase1-A |
| A2-2 | 世界尺寸恒定 | 对 `hexRadius ∈ {26,32,38,44,50}` 各算一次 `random` 地图包围盒，要求世界宽度 **全部 = 50.0 ± 0.01 unit** |
| A2-3 | 六边形朝向一致 | 截图比对：3D 棋盘单格截图 与 2D `renderHexMap` 单格截图，六边形顶点方向必须一致（尖角朝屏幕上下） |
| A2-4 | 舰船朝向一致 | 令 `facing` 依次为 `0, π/2, π, 3π/2`，截图确认舰头分别指向屏幕 右/下/左/上 |
| A2-5 | 高度不参与规则 | 在 headless replay 中把 `ELEVATION` 表全部置 0，重跑 golden，**要求事件序列与结果逐项相等**（证明高度是纯渲染数据） |
| A2-6 | 阵型 XZ 分量不变 | 从 `TacticalSim` 导出 `positions` 表，与 `BattleScene.ts:2700-2734` 逐值 diff，要求 **XZ 分量 0 差异** |

---

## 8. 未决事项

| # | 问题 | 默认处理 | 需谁拍板 |
|---|------|----------|----------|
| A2-Q1 | 默认俯角 `POLAR_DEFAULT = 35°`（偏离战略层 56°） | 采用 35° | art-director 会签 |
| A2-Q2 | 格间缝隙系数 `0.94` | 采用 0.94 | art-director |
| A2-Q3 | 地块高度表（§3.3）11 个数值 | 采用表中值 | art-director 会签 |
| A2-Q4 | 舰种泳道表（§3.5）8 个数值 | 采用表中值 | art-director 会签 |
| A2-Q5 | `HOVER = 0.55`（§3.6） | 采用 0.55 | art-director |
| A2-Q6 | 是否给"高度参与玩法"留扩展位 | **不留**。若将来要加，走新流程 | 用户 |
| **A2-Q8** | **阵型间距 `spacing = 28px` 是否重算**（UX `05` 第 107 行要求重算） | **不重算**（§3.7 论证：改 spacing = 改逻辑距离 = 改射程判定 = 违反规则零改动）。改为：缩小舰体到 ≤ 26px / 接受重叠 / 用阵型高度分量错开 | **art-director + UX** |
