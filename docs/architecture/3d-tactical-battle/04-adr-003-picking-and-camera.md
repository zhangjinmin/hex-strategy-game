# ADR-003 · 拾取（Raycasting）与相机控制方案

- **状态**：提议（待 team-lead 批准；Q1 / Q2 需用户拍板）
- **日期**：2026-08-30
- **决策者**：engineering-lead
- **关联**：`03-adr-002`（坐标系）、`05-adr-004`（Vue 契约）、`09-risk-register.md` R-06 / R-07

---

## 1. 上下文

现状（2D）：

| 能力 | 现状实现 | 位置 |
|---|---|---|
| 地块点击 | `poly.setInteractive(new Phaser.Geom.Polygon(points), Phaser.Geom.Polygon.Contains)` + `handleTileClick` | BattleScene.ts:991, 1866 |
| 左键 = 买地 / 扩张补给线 | `pointer.button === 0` | BattleScene.ts:1898 |
| 右键 = 投放战术信标 | `pointer.button === 2` | BattleScene.ts:1892 |
| 舰船点击 | **不存在**（舰队指令走 Vue 浮标按钮 `dispatchFleetCommand`） | App.vue:36 |
| 相机平移 | `pointermove` + `pointer.isDown`，直接改 `scrollX/scrollY` | BattleScene.ts:225–230 |
| 相机缩放 | `wheel` → `setZoom(clamp(zoom - deltaY*0.001, 0.2, 2.5))` | BattleScene.ts:231–233 |
| 相机旋转 | **不存在** | — |
| 点击/拖拽判定 | `if (pointer.getDistance() > 30) return;` | BattleScene.ts:1867 |

3D 化后要新增：旋转、纵深理解、舰船拾取。

**已发现的既有缺陷（影响本 ADR 的范围）**：
- `renderIntentLines()`（BattleScene.ts:1578）遍历 `u._target`，但 **`u._target` 在全代码库中从未被赋值**（实测 grep：`_target` 仅出现在 1585/1586 两行的读取处）。
- ⇒ **敌人意图线是一个从未生效的功能**。CommandPanel 提示"点击战场选择目标"（CommandPanel.vue:55），但暂停后画面上不会出现任何意图线。
- 处置：见 §6 与 R-08。本次**建议顺带修复**（成本极低），但需用户拍板（Q3）。

---

## 2. 拾取方案

### 2.1 备选

| 方案 | 描述 | 优点 | 缺点 |
|---|---|---|---|
| **P1 平面反解** | raycast 打 `y=0` 无限平面 → 命中点 → 除以 S → 用 `getTerrainAt` 的 `Math.round` 公式反解 (q,r) | O(1)，零依赖 | **视差误差**（见 §2.2） |
| **P2 InstancedMesh raycast** | 对棋盘 / 舰船的 `InstancedMesh` 做 `raycaster.intersectObject`，读 `intersection.instanceId` | 精确，自动处理高度与遮挡 | 每次 O(实例数) |
| **P3 BVH 加速** | 引 `three-mesh-bvh` | 最快 | **新增依赖**（用户已说明不新增依赖），且对 6 边棱柱收益有限 |

### 2.2 视差误差量化（P1 被否决的依据）

相机仰角 θ（地平线以上）观察一个高出拾取基准面 `h` 的点，射线打在 `y=0` 平面上的落点会**沿视线反方向偏离**真实位置：

```
d = h / tan(θ)          （单位：world unit，1 unit = 1 格间距）
```

地块顶面最高 `h = ELEVATION[fortress] = 0.85 unit`（ADR-002 §3.3）：

| 仰角 θ | polar 角 | `tan θ` | 误差 `d` | 是否可接受 |
|---|---|---|---|---|
| 75.6°（最俯视，`minPolarAngle = 0.08π`） | 14.4° | 3.894 | **0.22 格** | ✅ |
| 55°（**默认**，`POLAR_DEFAULT = 35°`） | 35° | 1.428 | **0.60 格** | ❌ 超过半格 |
| **27°（最平视，`maxPolarAngle = 0.35π`）** | **63°** | **0.510** | **1.67 格** | ❌ |

**结论**：即使把默认俯角设为 55°，P1 的误差（0.60 格）也已超过半格 ⇒ 会把玩家的点击判给相邻格。在最平视的 27° 下误差达 1.67 格。
要让 P1 可用，需要 `d < 0.5` ⇒ `θ > atan(0.85 / 0.5) = 59.5°` ⇒ `polar ≤ 30.5°`，即**必须锁死在接近顶视的角度** —— 这与"3D 可旋转视角"的目标直接冲突，也违反 art/UX 侧"仰角下限 27°"的要求（`ship-assets.md` §3.1，用户已拍板）。

> **注**：`maxPolarAngle = 0.35π` 由 art/UX 侧定为 S 级可读性约束（掠射角下一艘舰可遮蔽后方 200+ 像素），本文档采纳。这**不改变** P1 被否决的结论，反而让误差更大。

**⇒ 否决 P1 作为主路径。**

### 2.3 决定：P2（InstancedMesh raycast），两级剪枝

```ts
// ThreeTacticalBattle.pick(clientX, clientY): void
const rect = this.renderer.domElement.getBoundingClientRect();
this.ndc.set(
  ((clientX - rect.left) / rect.width) * 2 - 1,
  -((clientY - rect.top) / rect.height) * 2 + 1,
);
this.raycaster.setFromCamera(this.ndc, this.camera);

// ① 舰船（优先）
const shipHits = this.raycaster.intersectObjects(this.shipPickList, false);  // 12 个 InstancedMesh
// ② 棋盘
const tileHits = this.raycaster.intersectObject(this.tileMesh, false);
// 取距离更近者；相等时舰船优先
```

- `intersection.instanceId` → `slotOwner[instanceId]` → `unitId`（舰船）/ `tileIndex`（棋盘）。
- 舰船优先的意义：舰船悬浮在棋盘上方（`HOVER = 0.55`），从俯视角度射线先命中舰船是符合直觉的；且 Q1 拍板后"点舰船选目标"是 CP 系统的关键交互。

**必须调用 `computeBoundingSphere()`**：Three r160 的 `InstancedMesh.raycast` 用 `this.boundingSphere` 做整体剔除，它**不会**随 `instanceMatrix` 自动更新。棋盘/舰船的 instance 矩阵每次变化后（即 `view.tiles.revision` 变化或舰船移动后）需调用：

```ts
this.tileMesh.computeBoundingSphere();
```
（舰船每帧移动 ⇒ 每帧一次；12 个 mesh × 128 实例 ≈ 可忽略，见 §2.4）

### 2.4 成本核算与降级预案

| 场景 | 实例数 | 单次 raycast 预估 |
|---|---|---|
| 棋盘 | `tileMesh.count = 1951`（`random` 地图；其余地图 127–933） | ~1951 次「矩阵合成 + 包围球测试」 |
| 舰船 | 12 个 mesh，`count` 之和 = 实际舰数（≤ 128，**不是**容量 1536） | ~128 次 |
| 合计 | ~2079 | **预估 0.15–0.60 ms** `[PLACEHOLDER · 见验证 A3-2]` |

- hover 节流到 **30 Hz**（`setTimeout` 节流，不是每次 `pointermove`）。
- 点击（低频）不做节流。

**降级预案（仅在实测超标时启用，按顺序）**：

1. **`count` 用实际值而非容量**：`InstancedMesh.count = 实际实体数`，未使用的槽位不参与 raycast 循环。这是**默认就做的**，不是降级。
2. **棋盘 AABB 预剪枝**：先算射线与棋盘外接盒（50×0.85×43）的交，不相交直接跳过 1951 次测试。成本 ~0.01ms。
   - 触发条件：实测单次 pick > 2 ms。
3. **两级拾取**：先用平面反解（P1）得候选 `(q,r)`，再对**候选格及其 6 邻居**做**解析的 ray-vs-六棱柱**测试（不进 Three 的 raycast）。
   - 误差前提：P1 的误差 `d ≤ 3.31 格`（§2.2），7 格邻域**不足以覆盖** ⇒ 需 13 格邻域（半径 2）。
   - 触发条件：实测单次 pick > 4 ms。

### 2.5 输入语义映射（**已按 UX 侧规格收敛**）

> ⚠️ 本节在 `docs/design/3d-tactical-battle/02-interaction-spec.md` 发布后**已改稿**。初稿是"左键拖拽=旋转 / 右键拖拽=平移"；UX 侧的映射有更充分的依据（右键 deployFlare 是高频操作、左键拖拽手感是 2D 遗留记忆 R-18、WASD/方向键解决触摸板无中键的问题）⇒ **工程侧让步，采用 UX 映射**。

| 输入 | 位移 / 时长 | 行为 | 对应现状 / 出处 |
|---|---|---|---|
| 左键 down→up | 位移 < **8px** 且 时长 < **300ms** | **选择舰队**（命中舰船 → 其所属舰队；未命中舰船则命中地块 → 买地 / 选中格子） | UX `02` §2；2D `handleTileClick` `button===0` |
| **`Alt` + 左键单击** | 同上 | **选择单舰**（仅信息查询，无对应指令） | UX `02` §2（P2） |
| **`Shift`/`Ctrl` + 左键** | 同上 | 多选追加 / 切换（**MVP 不实现**） | UX `02` §4 |
| 左键拖拽 | 位移 ≥ **8px** | **框选**（屏幕空间 AABB；**MVP 不实现，此期间不触发任何其他行为**） | UX `02` §2.2 |
| **中键拖拽** | 任意 | **轨道旋转**（Orbit）— 水平=方位角，垂直=仰角 | UX `02` §1.2 |
| **右键拖拽** | 位移 ≥ **5px** 或 时长 ≥ **200ms** | **轨道旋转**（Orbit，备选入口） | UX `02` §1.4 |
| 右键 down→up | 位移 < **5px** 且 时长 < **200ms** | **投放战术信标** → `onPickTile(q, r, 2, …)` | 2D `handleTileClick` `button===2` → `deployFlare` |
| **中键 + `Shift` 拖拽** | 任意 | **平移** | UX `02` §1.2 |
| **`W`/`A`/`S`/`D` 或 方向键** | 按住 | **平移**（晕动症敏感用户与精确操作的首选） | UX `02` §1.2 |
| 滚轮 | 一次 = 一档 | **推拉（离散 8 档）**，朝光标方向推进 | UX `02` §2.3 |
| **`F`** | — | **聚焦**：相机平移到选中编队，**不改变角度与距离** | UX `02` §1.2 |
| **`Home`** | — | **一键复位**到默认视角 | UX `05` R-18 |
| **`Esc`** / 左键点空域 | — | 取消选择 | UX `02` §2 |

**阈值来源（不再自创）**：
- 选择：`8px / 300ms`（UX `02` §3 表格）。
- 右键信标 vs 右键旋转：`5px / 200ms`（UX `02` §1.4）。
- UX 已给出校准方法：让测试者连续 20 次"放信标"与 20 次"转视角"，统计误判率，目标 **< 5%**（A3-8）。

**对每个"UX 要求 vs OrbitControls 默认"的实现对策**：

| UX 要求 | OrbitControls 默认 | 对策 |
|---|---|---|
| Orbit 用中键（主）+ 右键（备），不用左键 | `LEFT: ROTATE` | `mouseButtons = { LEFT: null, MIDDLE: ROTATE, RIGHT: ROTATE }`；左键的框选/选择由**我们自己的** pointer 事件处理（不走 OrbitControls） |
| 平移用 `中键+Shift` / `WASD` / 方向键 | `RIGHT: PAN` / `MIDDLE: PAN` | 禁用 OrbitControls 的 PAN（`mouseButtons.RIGHT` 已给 ROTATE）；**自己实现**平移：`Shift+中键拖拽` 与 `WASD/方向键` 都调用同一个 `panCamera(dxPx, dyPx)` |
| 缩放走**离散 8 档**，非连续 | 连续 dolly | `controls.enableZoom = false`；自己监听 `wheel`，做档位切换 + 400ms 指数阻尼过渡（UX `02` §2.3）。`dMin = hexRadius × 2.5`、`dMax = 棋盘 AABB 完整入画 × 1.15`（**注意单位**：UX 这两个值是 art 单位制，见 §2.7） |
| 缩放**朝光标**（光标下的世界点保持不动） | dolly 到 `controls.target` | Three r160 的 OrbitControls **支持** `zoomToCursor = true`；但若接管了 wheel 做离散档位，需自己实现"光标射线与棋盘平面交点 → 设为新 target" |
| 平移速度按**屏幕像素**定义（1800/1200/800 px·s⁻¹，见 UX `06`） | `panSpeed`（世界单位） | 自己实现的 `panCamera` 天然按像素；`panSpeed` 参数弃用 |
| **帧率无关指数阻尼** | `dampingFactor = 0.08`（逐帧 lerp，30fps 下实际阻尼只有 60fps 的一半） | UX 的论证成立。对策：保留 `dampingFactor = 0.08`，但把 `controls.update()` 的调用改为**按固定 16.67ms 子步累积**（`acc += dt; while (acc >= 16.67) { controls.update(); acc -= 16.67; }`，单帧最多 3 子步）。这样阻尼行为与帧率无关，且不需替换 OrbitControls |

**右键与 `contextmenu` 的冲突处理**：
OrbitControls 在 `onContextMenu` 里调用 `event.preventDefault()` 但**不** `stopPropagation`，因此我们自己的 `contextmenu` 监听器仍会触发。为避免"右键拖拽旋转后松手误投放信标"，在 `contextmenu` 回调里检查本次右键按下期间的累计位移：

```ts
let rightDragDist = 0;   // pointerdown(button=2) 时清零，pointermove 时累加
dom.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (rightDragDist > 6) return;   // 这是一次平移，不是点击
  this.pick(e.clientX, e.clientY, 2);
});
```

let rightDragDist = 0;   // pointerdown(button=2) 时清零，pointermove 时累加
dom.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (rightDragDist >= 5) return;   // 这是一次旋转，不是点击（阈值对齐 UX 的 5px）
  this.pick(e.clientX, e.clientY, 2);
});
```

### 2.6 拾取代理体与可达性（**UX 侧 P1/P2 要求，工程侧必须实现**）

UX `02-interaction-spec.md` §3 指出：3D 透视 + `hexRadius=50` 下最远舰船的屏幕投影高度可能只有 **3–8 px**，直接 raycast 命中率极低。UX 给出四条分层拾取策略（§3 第 127–155 行）与两条硬要求（P1/P2）。**工程侧全部采纳**：

| 层 | 策略 | 工程实现 |
|---|---|---|
| **1** | **膨胀代理体**：每艘舰的拾取半径不小于屏幕 12px | 给每个舰船 `InstancedMesh` 额外维护一组**不可见代理体**（`visible = false` 但仍参与 raycast 的 `InstancedMesh`，或直接改用解析球体测试）。半径公式（UX `02` §3）：<br>`r_pick = max(r_body, 2 * MIN_PX * d * tan(fov/2) / viewportH_px)`<br>`MIN_PX = 12 px` `[PLACEHOLDER · UX 标注需 playtest]` |
| **2** | **屏幕空间近邻兜底**：层 1 未命中时，在光标周围 `R_FALLBACK = 18 px` 圆域内搜索最近的舰船投影中心 | 把每艘舰的世界位置 `project()` 到屏幕，取圆域内屏幕距离最近者 |
| **3** | **编队聚合标记兜底**：`L3` 档下舰船退化为 ▲/◆ 标记，标记本身可点 | 标记已按 UX `01` §4 定义，同样走屏幕空间测试 |
| **4** | 判定为空域点击 | `onPickNothing` |

**P1 · 拾取忽略遮挡**（UX 硬要求）：
> "被前排挡住的目标必须仍然可被点击（用第 2/3 层代理体，不做深度剔除）。否则玩家无法对后排目标下达命令，这是 3D 引入的、2D 不存在的能力退化。"

⇒ **修正本 ADR 初稿的"取距离最近者"**。新规则：
- 层 1（膨胀代理体 raycast）：**收集全部命中**，不取最近。
- 层 2（屏幕空间圆域）：在全部命中中取**屏幕距离光标最近**者；若层 1 无命中，则在所有投影中心中取圆域内最近者。
- ⇒ 后排被遮挡的舰船只要其投影落在光标附近，就能被选中。

**P2 · 拾取结果永远是舰队，不是单舰**：
> 与命令的 `targetType: 'enemy_fleet'` 对齐。`Alt + 左键` 才选单舰，且仅用于查看信息。

⇒ 接口修正：`onPickUnit(unitId, ...)` 保持传 `unitId`（渲染层只知道 unit），**映射 `unitId → fleetId` 由宿主完成**（宿主持有 `BattleView.units.fleetId`）。`Alt` 按下时宿主不映射，直接把单舰信息推给 tooltip。

**键盘补充**：UX 要求暂停选目标时 `1`–`9` 数字键对应编号徽章快选（可用是因为阵型键 `1`–`5` 在暂停态被禁用，`BattleScene.ts:266` 已确认）。⇒ 宿主要在 `select-target` 期间接管数字键，按"距玩家舰队升序"给合法目标编号。

### 2.7 单位制：与 art/UX 的 `1 unit ≈ 15 px` 的最终处理（**阻塞项 R-16 的收敛方案**）

**现状**：art（`ship-assets.md` §5.0）与 UX（`05-readability-risks.md` 第 44 行明确声明）**两侧**都锚定 `1 世界单位 ≈ 15 px`；工程侧（`03-adr-002` §2.1）用 `1 unit = 六边形中心间距 = √3·hexRadius px`。相差 **3.00 倍**（`hexRadius = 26` 时）。

**工程侧的坚持理由**（`03-adr-002` §2.1.1）：`hexRadius ∈ {26,32,38,44,50}` 是动态的，而 `15 px/unit` 是固定换算 ⇒ 在 art/UX 单位下棋盘宽度在 **150**（R=26）与 **288**（R=50）之间变化 1.92 倍，导致所有**绝对距离阈值**（相机 `minDistance`、LOD 阈值、拾取半径）在不同 `hexRadius` 下含义不同。

**收敛方案（工程侧提案，需 art/UX 会签）**：

> **距离阈值一律用「格（hex）」书写，尺寸数值一律用「像素」书写。**

| 类别 | 书写单位 | 理由 |
|---|---|---|
| 相机 `minDistance` / `maxDistance` / 默认距离 | **格** | 相机要看"多少格"，与 `hexRadius` 无关 |
| LOD 距离阈值 | **格** | 同上 |
| 拾取最小可点半径 | **屏幕像素**（UX 已如此定义：`MIN_PX = 12px`） | 可读性由屏幕尺寸决定，与世界尺度无关 |
| 舰体尺寸 / 悬空高度 / 涟漪 `rx` | **像素**（现状 2D 值，唯一真相） | 保持与 2D 观感一致；两套单位只是缩放标签 |
| 地块高度 / 泳道 / 阵型高度分量 | **格**（本文档 `03-adr-002` 已如此定义） | 相对棋盘尺度的比例，必须 R 无关 |

**换算工具**（放在 `frontend/src/game/config/tacticalVisual.ts`）：
```ts
export const PX_PER_HEX  = (hexRadius: number) => Math.sqrt(3) * hexRadius;  // 1 格 = ? px
export const PX_PER_ART  = 15;                                               // art/UX 侧单位
export const hexToPx  = (v: number, hexRadius: number) => v * PX_PER_HEX(hexRadius);
export const artToPx  = (v: number) => v * PX_PER_ART;
export const artToHex = (v: number, hexRadius: number) => v * PX_PER_ART / PX_PER_HEX(hexRadius);
```

**按此规则重述 UX 给的两个相机距离**（UX `02` §2.3）：
- `dMin = hexRadius × 2.5`（art 单位，R=26 时 = `1.73 × 2.5 = 4.33` art-unit = 65 px = **1.44 格**）
  - ⇒ 用格表达：**`dMin = 1.44 格`**。工程侧原值 `minDistance = 8 格`。
  - **冲突**：UX 的 1.44 格 vs 工程侧的 8 格。1.44 格时可见 `1.4729 × 1.44 = 2.1 格` —— 只比一支舰队的阵型跨度（2.5 格）略小，**几乎贴脸**。
  - 工程侧意见：`dMin` 至少要让一支完整舰队（跨度 ~2.5 格）入画 ⇒ 可见 ≥ 4 格 ⇒ `dMin ≥ 4/1.4729 = 2.7 格`。同时 `06-accessibility` 的晕动症约束要求相机不能太近。⇒ **建议 `dMin = 4 格`**（可见 5.9 格），折中 UX 的 1.44 与工程侧的 8。**需 UX 会签（Q7）**。
- `dMax = 棋盘 AABB 完整入画 × 1.15`（R 无关，两套单位下都成立）⇒ 工程侧 `maxDistance = 120 格` 满足（可见 176.7 格 ≫ 最大地图 86.6 格）。✅ 无冲突。

### 2.8 命令面板的"选目标"模式

`CommandPanel` 对 `requiresTarget` 的命令走 `emit('select-target', abilityId)`（CommandPanel.vue:104-108），然后提示"点击战场选择目标"。

**决定**：宿主收到 `select-target` 后调用 `renderer.setTargetingMode(true)`，渲染层：
- **禁用地块拾取**（按 §2.6 的分层策略只测舰船与编队标记）；
- 高亮所有**合法**目标（敌方 + 非 `fuzzy` + 未灭）→ 脉动轮廓 + **编号徽章 ①②③…**（按距玩家舰队升序）；
- **非法目标**（友军 / `fuzzy` / 已灭）降饱和 60% 且不显示徽章（UX `03` 步骤 3）；
- 命中 → `onPickUnit(unitId, 0, x, y)` → 宿主映射 `unitId → fleetId` → `commandBridge.pendingCallback(fleetId)`；
- **未命中 → 保持 targeting 模式，不取消**（UX `03` C3：防误操作中断）；
- `Esc` 或 CP 关闭 → `setTargetingMode(false)`；
- 暂停期间数字键 `1`–`9` 由宿主接管为"徽章快选"（阵型键在暂停态已被禁用，`BattleScene.ts:266`）；
- 合法目标集**每 100ms 重算**（UX `03` 第 92 行；暂停态下开销可忽略）。

> **⚠️ 这是"补完"而非"迁移"**（UX `03` §1 已独立核实）：`commandBridge.pendingCallback` 在整个 `frontend/src` 中只有 3 处出现——定义（`CommandBridge.ts:13`）、赋值（`BattleScene.ts:1510`）、**以 `null` 调用**（`App.vue:135`）。**没有任何一处传入非空 `targetFleetId`。** 且 `handleTileClick` 首行 `if (... || this.store.isPaused) return;`（`BattleScene.ts:1867`）⇒ 命令面板打开（暂停）期间地块点击被吞掉。
> ⇒ **CP 命令的"选目标"在 2D 时代从未工作过。** 与本文档 R-08（意图线死功能）是同一个根因的两面。UX 已作为 **Q5** 提交用户拍板；本 ADR 的 Q1 与 UX 的 Q5 是**同一件事**，合并处理。

---

## 3. 相机控制

### 3.1 决定：复用 `OrbitControls`（战略层同款）

`three/examples/jsm/controls/OrbitControls.js` —— `ThreeStrategicMap.ts:2` 已在用，无需新增依赖，且手感与战略层一致。

**否决"自研相机控制器"**：需要处理阻尼、球面插值、平移平面、触摸手势、事件捕获，约 300 行且容易做出与战略层不一致的手感。收益为负。

### 3.2 参数表（每个值都带 rationale）

```ts
// cameraRig.ts —— 注意：PAN 与 ZOOM 已由我们自己的实现接管（见 §2.5 的对策表）
this.controls = new OrbitControls(camera, renderer.domElement);
this.controls.enableDamping   = true;
this.controls.dampingFactor   = 0.08;              // 战略层同款（ThreeStrategicMap.ts:400）
this.controls.minDistance     = 4;                 // 格 —— 见下（由 8 改为 4，折中 UX 的 1.44）
this.controls.maxDistance     = 120;               // 格
this.controls.minPolarAngle   = Math.PI * 0.08;    // 14.4°：距 +Y 轴
this.controls.maxPolarAngle   = Math.PI * 0.35;    // 63°（仰角 27°）
this.controls.enablePan       = false;             // 平移自己实现（中键+Shift / WASD / 方向键）
this.controls.enableZoom      = false;             // 缩放自己做离散 8 档
this.controls.rotateSpeed     = 0.6;
this.controls.autoRotate      = false;
this.controls.mouseButtons = {
  LEFT:   null,                  // 左键留给选择/框选（我们自己处理）
  MIDDLE: THREE.MOUSE.ROTATE,    // UX 主入口
  RIGHT:  THREE.MOUSE.ROTATE,    // UX 备选入口（与"右键点击=信标"按 5px/200ms 阈值区分）
};
this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
// 帧率无关阻尼：按固定 16.67ms 子步驱动 controls.update()
private updateControls(dtMs: number) {
  this.dampAcc += dtMs;
  let steps = 0;
  while (this.dampAcc >= 16.67 && steps < 3) { this.controls.update(); this.dampAcc -= 16.67; steps++; }
  if (steps === 3) this.dampAcc = 0;   // 掉帧过久时丢弃积压，避免"快进"
}
```

| 参数 | 值 | rationale |
|---|---|---|
| `dampingFactor` | 0.08 | 战略层同款，跨层手感一致（ThreeStrategicMap.ts:400）。**但改用固定子步驱动**，见 §2.5 对策表（UX `02` §2.2 指出逐帧 lerp 在 30fps 下实际阻尼只有 60fps 的一半） |
| `minDistance` | **4 格** | 工程侧原值 8 格（可见 11.8 格）；UX `02` §2.3 给的是 `hexRadius × 2.5` = **1.44 格**（可见 2.1 格，比一支舰队的阵型跨度 2.5 格还小，几乎贴脸）。折中取 **4 格**（可见 5.9 格），保证一支完整舰队（跨度 ~2.5 格）有余量入画，同时不违反 `06-accessibility` 的晕动症约束。**需 UX 会签（Q7）** |
| `maxDistance` | 120 格 | 可见 177 格 ≫ 棋盘最大 86.6 格（伊谢尔伦长边）⇒ 任何地图都能全图预览 + 留白。与 UX 的 `dMax = 棋盘 AABB 完整入画 × 1.15` 一致（R 无关）✅ |
| `minPolarAngle` | 0.08π (14.4°) | 禁止纯顶视：顶视下高度信息全部消失，3D 化无意义 |
| `maxPolarAngle` | **0.35π (63°)**，即最小仰角 27° | **来自 art/UX 侧，用户已拍板**（`ship-assets.md` §3.1）。UX `05` R-01 补充了独立论据：fov 50° 下 9° 中心仰角意味着**画面下缘的有效仰角是 −16°**，即相机在画面下缘看向棋盘平面以下 —— 直接违反用户决策"禁止看底部"。本文档原拟 0.42π，**已让步为 0.35π** |
| `enablePan` | `false` | 平移改为自己实现（按屏幕像素定义速度，见 UX `06`：1800/1200/800 px·s⁻¹） |
| `enableZoom` | `false` | 缩放改为**离散 8 档** + 400ms 指数阻尼过渡 + 朝光标推进（UX `02` §2.3） |
| `rotateSpeed` | 0.6（默认 1.0） | 战术层需要精细取景（对准某支舰队），战略层的 1.0 在此尺度下过于灵敏。**具体角速度上限遵循 UX `06` 的晕动症规格（Basic 120°/s / Standard 60°/s / Comprehensive 锁定）** |
| `mouseButtons.LEFT` | `null` | 左键留给选择（`Alt+` 选单舰）与框选（MVP 不做），不走 OrbitControls |

### 3.3 相机初值

见 ADR-002 §5：`initZoom` 计算式逐字保留，`D0 = clamp((W / initZoom) · S / (2·tan(fov/2)·aspect), 8, 120)`，默认 polar 35°。

```ts
camera = new THREE.PerspectiveCamera(45, w / h, 0.5, 400);
```

- `near = 0.5`：`minDistance = 4 格` 下最近的物体距离 ≥ 4 − 1 ≈ 3 ⇒ 0.5 足够且能避免 z-fighting。
- `far = 400`：深空背景 plane 挂在相机局部 `z = -200`，尺寸 800×800 ⇒ 需 `far > 200`；取 400 有余量且深度精度充足（比值 800:1）。
- **`fov`**：本文档用 **45°**（战略层同款）。**注意 UX `05` 的遮挡纵深推导用的是 `fov = 50°`**（第 58 行）。两者对"有效仰角"的影响：`θ_eff_下缘 = θ_中心 − fov/2`，45° 下是 `−22.5°` 偏移，50° 下是 `−25°` 偏移 ⇒ 在 `maxPolarAngle = 0.35π`（中心仰角 27°）下，45° fov 的下缘有效仰角 = **4.5°**，50° fov 下 = **2°**。**两者都 > 0**（不违反"禁止看底部"），45° 更安全。**保持 45°，需 art/UX 知悉（Q8）**。

### 3.4 相机抖动（`cameras.main.shake` 的等价物）

现状 4 处调用：

| 位置 | 行 | 参数 |
|---|---|---|
| 一骑讨 | 2190 | `shake(300, 0.004)` |
| 逆境宣言 | 2221 | `shake(250, 0.003)` |
| 要塞开火 | 3489 | `shake(600, 0.025)` |
| 战役阶段横幅 | 578 | `shake(200, 0.003)` |

Phaser 的 `shake(duration, intensity)` 语义：偏移量 = `intensity × 相机视口宽/高`（px）。3D 等价换算：

```ts
// cameraRig.ts
shake(intensity: number, durationMs: number): void {
  const visibleWorldW = 2 * this.camera.position.distanceTo(this.controls.target)
                      * Math.tan(THREE.MathUtils.degToRad(45) / 2)
                      * this.camera.aspect;
  this.shakeAmp    = Math.max(this.shakeAmp, intensity * visibleWorldW);   // world unit
  this.shakeDur    = durationMs;
  this.shakeElapsed = 0;
}
```
验算：`intensity = 0.025`，D = 24.1，aspect = 1.7778 ⇒ `0.025 × 35.5 = 0.888 unit`。
对应 2D：`0.025 × 1280px = 32px`；32px 在 D=24.1 下 = `32 × 35.5/1280 = 0.888 unit` ✓ **幅度等价**。

实现要点（必须与 OrbitControls 共存）：

```ts
// 每帧顺序：controls.update() → shaker.apply() → composer.render()
apply(camera: THREE.Camera, dtMs: number): void {
  camera.position.sub(this.offset);        // ① 先还原上一帧偏移，否则会累积漂移
  this.shakeElapsed += dtMs;
  const k = 1 - this.shakeElapsed / this.shakeDur;
  if (k <= 0 || this.shakeAmp <= 0) { this.offset.set(0, 0, 0); return; }
  const a = this.shakeAmp * k * k;         // 二次衰减（Phaser 用线性，二次更自然且同终点）
  // ② 在相机局部平面内抖动（不做前后推拉），再转到世界系
  this.offset.set(
    a * Math.sin(this.shakeElapsed * 0.09),
    a * Math.sin(this.shakeElapsed * 0.13 + 1.7),
    0,
  ).applyQuaternion(camera.quaternion);
  camera.position.add(this.offset);
}
```

- 用**确定性多频正弦**而非 `Math.random()`：Phaser 用随机，但确定性版本在 golden replay / 录屏回放中可复现，且视觉上无差别。
- 与暂停的关系：抖动由 `sync()` 驱动（每帧都跑），但**触发它的事件只在不暂停时产生**（4 处调用点都在 `update()` 或其调用的 `showBattleBanner` 内，而 `update()` 在 `isPaused` 时早退）⇒ 净行为与现状一致。

### 3.5 事件相机（一骑讨 / 逆境宣言 / 最后一击）— **行为变更，需用户拍板**

现状 `update()` 中有三处**相机抢夺控制权**：

| 事件 | 行 | 现状行为 |
|---|---|---|
| 一骑讨（双方 < 95px） | 2184–2199 | `cameras.main.shake(300, 0.004)` + tween 相机 `zoom × 1.4`（400ms）再回落（1200ms） |
| 逆境宣言 | 2221 | `shake(250, 0.003)` |
| 最后一击（敌全灭） | 2136–2140 | `setZoom(1.5)` + `shake(600, 0.008)`，2500ms 后 `setZoom(1)` |

**UX `05` R-16 指出**：事件相机抢夺控制权会让玩家丢失空间定向（"我的舰队怎么没了"），属 **A 级风险**。UX 建议默认改为「**时间减速 + 台词卡 + 双高亮**」，**不移动相机**（UX 已作为 Q4 提交用户）。

**工程侧处理**：
- `shake` 保留（不改变相机位置基准，只是叠加衰减偏移）⇒ 无定向丢失风险。
- **zoom tween / setZoom 改为默认关闭**，由配置项 `enableEventCameraZoom: boolean` 控制，默认 `false`。
- 若用户拍板保留事件 zoom（Q9），则实现为：`DUEL` / `LAST_STRIKE` 事件 → 宿主调用 `renderer.pushEventCamera({zoom, duration, holdMs})`，且与玩家的手动操作互斥（玩家一动滚轮/旋转就立即取消事件相机，交还控制权）。

> ⚠️ **这是行为变更**，不是纯渲染迁移。必须作为 Q9 提交用户拍板，不得在 P3/P4 擅自实现或删除。

### 3.6 暂停时的相机

现状：暂停（`store.isPaused = true`）时 `update()` 早退（BattleScene.ts:1982），相机不响应任何输入（Phaser input 仍在监听，但 `scrollX/scrollY` 的修改在 `update()` 之外的 `pointermove` 回调里 —— 严格说现状**暂停时仍能拖拽平移**）。

**决定**：3D 下暂停时**相机保持完全可操作**（旋转 / 平移 / 缩放全部可用）。这与 UX `03` 步骤 1 一致："这是 3D 相对 2D 的关键增强：选目标需要转视角、拉远看清全局，暂停期间不得锁死相机"。

唯一变化是暂停时额外绘制**敌人意图线**（现状 `renderIntentLines()`，见 §6）。

`isPaused` 只影响：`TacticalSim.tick()` 是否推进。**不影响** `renderer.sync()`，也**不影响**任何输入。

### 3.7 两档缩放预设与一键切换（Q7 定案）

> **本节为 Q7 定案后新增**（用户拍板：默认档 + 全局档，两档一键切换）。

#### 3.7.1 两档按「战列舰屏幕投影长度」反解距离

用户给的判据是**像素**（默认档 25px / 全局档 6.6px），所以两档都按 px 反解而非写死距离 —— 这样在任何分辨率下观感一致。

```ts
// cameraRig.ts
const VIS_H_PER_D = 2 * Math.tan(THREE.MathUtils.degToRad(45) / 2);  // 0.8284 格 / 单位距离
const BB_HEX      = 33 / (Math.sqrt(3) * 26) * (26 / 26);            // 0.7328 格（= 33px @ hexRadius 26）

/** 由"希望战列舰在屏幕上有多长(px)"反解相机距离（格） */
function distanceForShipPx(targetPx: number, viewportH: number): number {
  return (BB_HEX * viewportH) / (VIS_H_PER_D * targetPx);   // = 636.92 / targetPx  @ 720p
}
```

**换算表**（1280×720，fov 45°，`random` 地图 50.0 × 43.3 格）：

| 档 | 目标投影 | 距离 D | 可见格宽 × 格高 | 棋盘占屏宽 | 命中的 LOD 档（ADR-006 §3.2） |
|---|---|---|---|---|---|
| **默认档（主用）** | **25 px** | **25.5 格** | 37.5 × 21.1 | 133%（看到 3/4 张图） | **L1**（24–48 px） |
| **全局档 A（推荐）** | 10.6 px | **60.1 格** | 88.5 × 49.8 | **100%**（恰好填满） | **L3**（<12 px） |
| **全局档 B（= 2D zoom 0.2）** | **6.6 px** | **96.5 格** | 142.1 × 79.9 | **35%** | **L3** |
| 最近（`minDistance`） | 159 px | 4 格 | 5.9 × 3.3 | — | **L0** |

> ⚠️ **用户描述里对全局档的两处说法不一致，需回确认（A6-Q9）**：
> - 「`dMax` = 棋盘填满屏幕」⇒ D = 52.3 格（无余量）/ 60.1 格（×1.15）⇒ 战列舰 **12.2 / 10.6 px**
> - 「战列舰投影降到约 6.6px（即 2D 的 `zoom=0.2`）」⇒ D = 96.5 格 ⇒ **棋盘只占屏宽 35%**
>
> 两者相差 **1.85 倍**。我核对了 6.6px：`33px × 0.2 = 6.6px` ✓ 与 2D `zoom=0.2` 精确对应；而 2D zoom 0.2 时可见宽度 `1280/0.2 = 6400 px`，棋盘宽 2252 px ⇒ 占屏 **35%**，确实不是"填满屏幕"。
>
> **工程侧建议取全局档 A（D = 60.1 格，10.6 px）**：同时满足"能看整个战场"与"战列舰不小于 6.6px"，且比 B 少浪费 65% 的屏幕面积。

**全局档按地图自适应**（地图尺寸差 4 倍，不能写死距离）：

```ts
// boardWorldW/H 来自 TacticalSim 的 tiles 包围盒（单位 = 格）
const fitD = Math.max(boardWorldW / (VIS_H_PER_D * aspect), boardWorldH / VIS_H_PER_D) * 1.15;  // UX 02 §2.3 的 ×1.15
const D_global = Math.min(distanceForShipPx(6.6, viewportH), fitD);  // 不超过 zoom 0.2，也不小于"填满"
```

| 地图 | 世界尺寸（格） | `fitD`（×1.15） | 6.6px 对应 D | **取用** | 战列舰投影 |
|---|---|---|---|---|---|
| `random` | 50.0 × 43.3 | 60.1 | 96.5 | **60.1** | 10.6 px |
| 伊谢尔伦 | 51 × 13.9 | 39.8 | 96.5 | **39.8** | 16.0 px |
| campaign 圆形（r=6） | 13 × 13 | 18.1 | 96.5 | **18.1** | 35.2 px |

⇒ `min(...)` 保证小地图不会被拉到荒谬距离，`fitD` 保证大地图一定填满。

#### 3.7.2 切换：过渡还是瞬时？

**决定：做过渡（tween），但为晕动症档提供瞬时选项。**

| 可访问性档（UX `06`） | 切换时长 | 缓动 | 依据 |
|---|---|---|---|
| **Basic** | **500 ms** | `Sine.easeInOut` | 项目现有一骑讨相机用的就是它（BattleScene.ts:2196），观感一致 |
| **Standard** | **600 ms** | `Sine.easeInOut` | UX `06` §2.3 定"档位间 400ms 过渡"；两档跳跃跨度约 2 个离散档 ⇒ 400 × 1.5 |
| **Comprehensive** | **瞬时（0 ms）** | — | **UX `06` 已把 Comprehensive 的缩放定为"瞬时"**。反直觉但正确：晕动症患者对**持续相机运动**敏感，瞬时跳变虽突兀但没有运动过程 |

**实现要点（三条都不能漏）**：

1. **距离必须走几何插值，不能线性插值。** 25 → 60 格是 2.4 倍，线性插值会让"前 1/3 时间几乎不动、后 1/3 飞出去"。
   ```ts
   const D = D0 * Math.pow(D1 / D0, ease(t));    // 等价于对 log(D) 线性插值 ⇒ 视觉上匀速缩放
   ```
   **这是两档切换观感好坏的关键。**

2. **只改距离，不改 polar / azimuth / target。** 旋转是晕动症的主要诱因（UX `05` R-13），两档切换不应引入任何旋转。

3. **过渡期间禁用手动相机输入**（滚轮 / 中键 / WASD），玩家一动就**立即取消 tween 并交还控制权**（与 §3.5 事件相机同一套互斥规则）。

**与暂停的关系**：两档切换在暂停态同样可用（§3.6）。CP 选目标时"拉远看清全局"是核心用例 ⇒ 必须支持。

#### 3.7.3 全局档下的拾取与 CP 命令

**工程侧结论：支持，实现成本 ≈ 0。**

全局档落在 L3（<12 px），而这**正是 UX `02` §3 分层拾取要解决的极端情况** —— 该机制 Phase 3 就要实现（A3-9），全局档只是它的另一个触发点，走**同一条代码路径**：

| 层 | 全局档下的表现 | 何时实现 |
|---|---|---|
| 1 膨胀代理体（`MIN_PX = 12 px`） | 战列舰实际 10.6 px < 12 px ⇒ **代理体始终生效**，拾取半径被撑到 12 px | ✅ Phase 3 |
| 2 屏幕空间圆域兜底（18 px） | 命中率进一步提升 | ✅ Phase 3 |
| 3 **编队聚合标记 ▲/◆** | L3 下标记是主要识别通道，**标记本身可点** | ✅ Phase 3（渲染）/ Phase 4（可点） |
| P1 忽略遮挡 | 全局档舰船密集，此条更关键 | ✅ Phase 3 |
| P2 返回 `fleetId` | 与命令的 `targetType: 'enemy_fleet'` 对齐 | ✅ Phase 3 |

**唯一需要新增的规则（≈ 10 行）**：

> **全局档下禁用地块拾取（买地），保留右键信标。**

| 操作 | 全局档 | 理由 |
|---|---|---|
| 选中舰队 / 选 CP 目标 | ✅ 可用 | 这正是全局档的用途 |
| `Alt+左键` 选单舰 | ✅ 可用 | 纯信息查询 |
| **右键投放战术信标** | ✅ **保留** | 信标是"大尺度指令"（让舰队去地图另一端），全局档是它最自然的场景 |
| **左键买地** | ❌ **禁用** | 全局档下 1 格 ≈ 14 px，点中特定格容易误操作；"一边看全局一边买地"是设计坏味道。提示文案：`回到默认档后可操作地块` |

**不建议做成"纯观察态"**：那会强迫玩家在"看全局"与"下命令"之间反复切换，而拾取机制已为 L3 做好准备，禁用反而要额外写代码。

---

## 4. 玩家如何理解纵深（UX 手段，不依赖数学直觉）

| 手段 | 实现 | 成本 |
|---|---|---|
| 舰船底部椭圆全息投影 | `auraMesh`（2 个 InstancedMesh，每阵营一个），贴在棋盘表面对应 (x,z) | 2 draw call |
| 舰船到棋盘的垂直引导线 | 细 `LineSegments`，仅旗舰显示（≤ 16 条） | 1 draw call |
| 棋盘正交网格线 | 沿 X/Z 的 `GridHelper`（色 `0x1a3a1a`，art 规格已定） | 1 draw call |
| 高度分层可读 | 舰种泳道（ADR-002 §3.5）让同类舰在同一层，形成"层理" | 0 |
| 限制俯角 | `maxPolarAngle = 0.35π`（仰角下限 27°）⇒ 永远俯视，不会看到舰船底面 | 0 |
| 小地图（可选） | 战略层已有 `drawMinimap` 实现可移植 | 0 draw call（独立 2D canvas） |

---

## 5. 后果

### 正面

1. 拾取精确（自动处理高度、遮挡、舰船悬浮），无 P1 的视差问题。
2. 输入语义与现状 1:1（左=买地/选中，右=信标），玩家肌肉记忆不破。
3. 相机手感与战略层一致（`OrbitControls` + 同 `dampingFactor`）。
4. 抖动幅度与 2D 等价（§3.4 验算），观感不退化。

### 负面 / 代价

1. **舰船拾取是新功能，需要新交互设计**（Q1）。若用户否决，CP 系统的 `requiresTarget` 命令在 3D 中无目标可选 ⇒ 必须给出替代（例如在 CommandPanel 里列舰队下拉框）。
2. **hover raycast 的 CPU 成本**：`[PLACEHOLDER 0.15–0.60ms · 验证 A3-2]`。若超标启用 §2.4 的降级预案。
3. **`computeBoundingSphere()` 每帧调用**（舰船移动）：12 个 mesh × 128 实例。若实测成为热点，改为"每帧用固定的超大 boundingSphere + `frustumCulled=false`"（棋盘已经这么做）。
4. **右键 ROTATE 与 contextmenu 的耦合**需要手动维护 `rightDragDist`（§2.5）。OrbitControls 未来版本若改为 `stopPropagation` 会打破此假设 ⇒ 在 `package.json` 中 three 版本已锁定 `^0.160.0`，升级 three 时需重测本项（写进升级 checklist）。
5. **平移与缩放已由工程侧自己实现**（`controls.enablePan = false` / `enableZoom = false`），OrbitControls 只负责 ROTATE + 阻尼。这偏离了"尽量复用 OrbitControls"的初衷，代价约 **+120 行**（离散档位 + 朝光标推进 + WASD/方向键平移 + 屏幕像素速度）。理由是 UX 的 4 项要求（中键 Orbit、离散档位、朝光标、像素速度）OrbitControls 默认都不满足。

---

## 6. 意图线（既有死功能）的处置

**现状**：`renderIntentLines()`（BattleScene.ts:1578–1603）读取 `u._target`，但该字段从未赋值 ⇒ 意图线从不绘制。

**建议（需用户拍板 Q3）**：顺带修复，成本约 20 行。

- 规则层：新增**只读观测字段** `unit.targetUnitId: number`（当前开火锁定的目标），在开火判定的 `targetShip` 确定处赋值（BattleScene.ts:2809 附近）。
  - **不改任何判定**，只是把已有的决策结果暴露出来 ⇒ 不违反"规则零改动"。
- 快照：`UnitView` 增加 `targetUnitId: Int32Array`。
- 渲染层：`setPaused(true)` 且 `enableIntentLines` 时，对**敌方**单位画 `unit → targetUnit` 的红色细线 + 箭头（沿用现状的 `0xff4444`，alpha 0.5）。

若不修复：3D 化后"暂停看意图"的能力仍然是零，CommandPanel 的提示文案会继续误导玩家。

---

## 7. 验证方式

| 编号 | 验证 | 命令 / 判据 |
|---|---|---|
| A3-1 | 点击拾取正确性 | 手工测试矩阵：在 polar ∈ {14.4°, 35°, 63°}、distance ∈ {4, 24, 120} 下，点击 `fortress`（最高格）与 `sea`（最低格）各 10 次，**误选率 = 0**。截图存档至 `docs/architecture/3d-tactical-battle/evidence/A3-1/` |
| A3-7 | 相机限制 | 拖拽到极限，确认 polar ∈ [14.4°, 63°]、distance ∈ [4, 120]，且相机 `position.y > 0`（永不穿到板下）；在 polar = 63° 且 distance = 4 时截图确认**看不到任何舰船底面** |
| A3-2 | raycast 成本 | dev 构建下在 `pick()` 前后插 `performance.now()`，hover 30Hz 跑 10s，记录 p50/p95。**判据：p95 ≤ 2.0 ms**。若超标启用 §2.4 降级预案并记录 |
| A3-3 | 输入语义（UX 映射） | 手工：左键点击舰船 → 选中其所属舰队；`Alt+左键` → 选中单舰；左键点击地块 → 买地；中键拖拽 → 旋转；右键点击 → 投放信标；右键拖拽 → 旋转且不投放信标；`中键+Shift` / `WASD` / 方向键 → 平移；`F` → 聚焦选中编队（角度与距离不变）；`Home` → 复位 |
| A3-4 | 舰船优先 | 在舰船正上方（屏幕重叠处）点击 → 必须命中舰船；在没有舰船的格子点击 → 命中地块。**注意**：按 UX P1，被前排遮挡的后排舰在光标落在其投影上时也必须可选（见 A3-9） |
| A3-5 | 抖动幅度等价 | 录屏 2D（改造前）与 3D（改造后）的要塞开火片段，逐帧比较画面位移幅度，**差值 ≤ 20%** |
| A3-6 | 意图线 | 暂停后截屏：敌方单位与目标之间必须出现红色细线（若 Q3 通过） |
| **A3-8** | **点击/拖拽阈值校准**（UX 方法） | 让 3 名测试者各做 20 次"放信标"与 20 次"选舰队"，统计误判率。**判据：误判率 < 5%**。若超标，调 5px/8px 与 200ms/300ms 并重测 |
| **A3-9** | **拾取可达性**（UX P1/P2） | ① 构造"两舰前后重叠"场景，点击前排舰 → 后排舰必须**仍可通过 `Tab` 循环器或 `Alt+点击` 选中**（P1 忽略遮挡）。② 在最远缩放档点击一艘屏幕高度 5px 的舰 → **必须命中**（代理体 + 18px 圆域兜底）。③ 普通左键点击 → 返回结果必须是 **fleetId 而非 unitId**（P2） |
| **A3-10** | **离散缩放档位** | 滚轮 8 次从最远到最近，每次一档、400ms 过渡；任一档下最远舰队的屏幕投影高度 ≥ 8px；朝光标推进时光标下的世界点保持不动（前后截屏对比该点屏幕坐标，**位移 ≤ 2px**） |
| **A3-11** | **帧率无关阻尼** | 在 60fps 与 30fps（人为降帧）下分别从同一角度旋转 90°，比较停止所需时间。**判据：两者相差 ≤ 15%** |
| **A3-12** | **两档一键切换** | ① 切换后读 `controls.getDistance()`：**默认档 = 25.5 ± 0.5 格**、全局档按 §3.7.1 表格（随地图变化）。② 录屏观察：切换过程中**匀速缩放**（不得出现"前段不动后段飞出"）⇒ 验证几何插值生效。③ 切换过程中 `polar` / `azimuth` / `controls.target` **保持不变**（逐帧采样，方差 = 0）。④ 过渡中按滚轮 → tween 立即取消、控制权交还 |
| **A3-13** | **切换时长与可访问性档联动** | 在 Basic / Standard / Comprehensive 三档下各切换一次并计时：**500 / 600 / 0 ms（±50ms）** |
| **A3-14** | **全局档拾取** | 全局档下：① 点一支舰队的 ▲/◆ 标记 → 选中该舰队 ② `Alt+左键` 可查单舰 ③ 右键 → 投放信标成功 ④ 左键点地块 → **不触发买地**，出现提示文案 |


---

## 8. 未决事项

| # | 问题 | 默认建议 | 需谁拍板 |
|---|------|----------|----------|
| Q1 | 是否补完 CP 命令的"战场选目标"（**2D 时代从未工作过**，与 UX 的 Q5 是同一件事） | **补完**。这是"新增功能"而非"迁移"，需用户确认范围 | **用户** |
| Q2 | ~~点击/拖拽阈值~~ | **已解决**：采用 UX 侧值（选择 `8px/300ms`，右键信标 `5px/200ms`），见 §2.5 | — |
| Q3 | 是否顺带修复从未生效的敌人意图线 | **修复**（+20 行，规则层只加只读观测字段） | 用户 |
| Q4 | 是否需要小地图 | 本次不做（Phase 6 备选） | team-lead |
| **Q7** | **`minDistance` 取 4 格**（UX 给 1.44 格，工程原拟 8 格） | **4 格**（可见 5.9 格，一支完整舰队跨度 2.5 格） | **UX（design-strategist）** |
| **Q8** | **`fov` 取 45° 还是 UX 推导用的 50°** | **45°**（战略层同款；下缘有效仰角 4.5° > 0，更安全） | **art + UX** |
| **Q9** | **事件相机（一骑讨 / 最后一击 zoom）是否保留** | **默认关闭**，改"时间减速 + 台词卡 + 双高亮"（UX `05` R-16）。**这是行为变更** | **用户** |
| **Q10** | 平移速度用 UX `06` 的三档（1800/1200/800 px·s⁻¹） | 采用 | UX |
| **Q11** | 拾取代理体 `MIN_PX = 12px` / 回退圆域 `18px` | 采用（UX 已标 `[PLACEHOLDER · 需 playtest]`） | UX |
| **Q12** | **全局档按哪个定义**：`棋盘填满×1.15`（D=60.1 格，10.6px）还是 `对齐 2D zoom 0.2`（D=96.5 格，6.6px，棋盘占屏 35%） | **前者**（10.6px 已满足"看整个战场"，且比 6.6px 可读一倍）。两者相差 1.85 倍，**用户描述里两处说法不一致，需回确认** | **用户 + UX** |
| **Q13** | 默认档取 25px（用户原话）还是 28px（距 L1 下界 24px 留裕度） | **28 px** | UX（design-strategist） |
| Q5 | `maxPolarAngle` 取值 | **已解决**：采用 art/UX 侧的 `0.35π`（仰角下限 27°）；用户已拍板"禁止看到舰船底部" | — |
| Q6 | 舰队浮标是否需要随视角倾斜（`rotX/rotY` 非 0） | 恒为 0（屏幕空间 HUD），见 ADR-004 §3 | art-director |
