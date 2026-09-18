# ADR-008 · 全局档正交投影方案（OrthographicCamera 选型 + minPolarAngle 例外 + draw call 重算）

- **状态**：提议（待 team-lead 批准；`minPolarAngle` 例外与 `14.3px` 信息呈现结论需 art/design 会签）
- **日期**：2026-08-31
- **决策者**：eng-ortho-lead（程基岩）
- **关联**：`04-adr-003`（相机 / 拾取，§3.2 的 `minPolarAngle`、§3.7 两档缩放）、`07-adr-006`（LOD px 判据 §3.2、draw call 预算 §5.3）、`docs/design/3d-tactical-battle/09-dual-zoom-modes.md`（方案 B 定案）、`docs/design/3d-tactical-battle/01-information-architecture.md`（信息 LOD §4）

---

## 0. 结论先行（TL;DR）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 真 `OrthographicCamera` vs 小 fov 透视模拟 | **用真 `THREE.OrthographicCamera`**（双相机切换）。小 fov 透视是数值病态（far plane 需 400→4000+、深度精度崩溃），且永远只是"近似正交"，与全局档"零透视失真"的成立理由自相矛盾 |
| 2 | `minPolarAngle = 0.08π` 顶视冲突 | **全局档是"预设位姿"，不经 OrbitControls polar 钳制**。`minPolarAngle` 约束的是"自由导航的下限"，不约束玩家显式调用的固定姿态。此例外同时覆盖既有的 `V` 键顶视兜底 |
| 3 | 全局档 draw call 重算 | 全局档从 L3（billboard）升 **L2（实体+线框）**：draw call **49 → 84**，tris **~13.8k → ~25k**（典型 64 舰）。**仍落在 180 / 36,000 预算内，余量 ~53% / ~30%** |
| 4 | 设计侧 14.3px 信息呈现 | **14.3px 稳定落在 L2（12–24px），设计侧结论正确**；真正的约束是**阵型间距 12.1px 而非舰体尺寸**，故单舰 UI 仍全部隐藏，真正解锁的是"舰体几何"（billboard → 实体+线框）。需修正两处**陈旧术语**（"LOD1 简化几何"、"LOD2/billboard"） |

---

## 1. 上下文

### 1.1 决策链

1. 用户拍板 **Q7 双档缩放**：默认档（战列舰 25px）+ 全局档（一键看全战场）。
2. 用户拍板 **Q9 全局档方案 B**（design `09-dual-zoom-modes.md` §1.4）：**顶视（polar = 0）+ 棋盘短边填满屏幕短边**，战列舰 **14.3px**，几何保真 = **正交、零透视失真**。相比方案 A（27° 仰角 + 6.6px，棋盘占屏 26%）省下 74% 屏幕浪费。
3. 方案 B 引入三个工程连锁后果，此前未书面回答（缺口 1–3），本 ADR 补全：
   - 投影从透视变正交 → **raycast 射线构造、后处理管线、LOD px 判据**都要改（§2/§3/§4）。
   - polar = 0 顶视 → 与 `minPolarAngle = 0.08π` 冲突（§5）。
   - 战列舰 14.3px 从 L3（<12px）跨进 **L2（12–24px）** → 舰船从 billboard 升为实体+线框 → **draw call / tris 上升**（§6）。

### 1.2 关键既有事实（本 ADR 的依据）

- `04-adr-003` §3.2：`minPolarAngle = Math.PI * 0.08`（14.4°），理由"禁止纯顶视：顶视下高度信息全部消失，3D 化无意义"。
- `04-adr-003` §3.7.1：全局档按地图自适应（`fitD = max(boardW/(VIS_H_PER_D·aspect), boardH/VIS_H_PER_D) × 1.15`），战列舰投影 `BB_HEX = 0.7328 格`。
- `07-adr-006` §3.2：LOD 判据统一为**屏幕投影 px**，四档 `L0≥48 / L1 24–48 / L2 12–24 / L3<12`，按**舰队**统一档位、滞回 ±4px。
- `07-adr-006` §5.3：draw call 预算 L0=120 / L1=95 / **L3 全局档=49**；美术预算 `<180`。
- design `09` §3.2：14.3px 下信息呈现的完整显示/隐藏清单（单舰 HP 条 / 状态图标 / 蓄力条 / 伤害数字全隐藏；阵营标记 / 阵型字形 / 编队聚合 HP / 舰数 / 旗舰★ / 舰队标签保留）。
- design `01` §4：信息 LOD 表已声明"**全局档方案 B 的 14.3px 稳定落在 L2**"；L2 显示"阵营标记 + 编队聚合 HP 条"，隐藏单舰 HP / 状态图标。

---

## 2. 决策 1：真 `OrthographicCamera`，不用小 fov 透视模拟

### 2.1 备选

| 方案 | 描述 | 优点 | 缺点 |
|---|---|---|---|
| **O1 真正交相机（选定）** | 新增一个 `THREE.OrthographicCamera`，全局档时与默认档的 `PerspectiveCamera` 切换 | 真零透视失真；`px/格` 全屏恒定 ⇒ LOD px 判据退化为常数、拾取代理体公式化简；`Raycaster.setFromCamera` 原生支持正交 | 需双相机切换 + 一套正交专用参数（frustum 尺寸 / near-far / 抖动） |
| **O2 小 fov 透视模拟** | 沿用单个 `PerspectiveCamera`，全局档时把 fov 压到 ~1–2° 并拉远 | 单相机，相机/拾取/LOD 代码零改动 | 数值病态（见 §2.2）；永远只是"近似正交"，残余失真 |

### 2.2 O2 为什么被否决（精算）

"小 fov + 大距离 → 逼近正交"在数学上成立，但要逼近到"零失真"，fov→0 且距离→∞，工程上不可行：

**（a）far plane 必须暴涨。** 全局档要"棋盘短边填满屏幕短边"。棋盘半高约 36 art-unit（1080px / 2 / 15），用 fov = 2°（半角 1°）的透视相机要看全，距离 `d = 36 / tan(1°) ≈ 2063 unit`。现有 `PerspectiveCamera(45, w/h, 0.5, 400)`（`04-adr-003` §3.3）的 `far = 400` 会把整个棋盘裁掉 ⇒ far 需开到 2000+。

**（b）深度精度崩溃。** far 开到 2300 后 `near/far = 0.5/2300 ≈ 4600:1`，24-bit 深度缓冲在 `[0.5, 2300]` 内每级 ≈ 0.5 unit —— 而棋盘高度只有 0.85 格（`ELEVATION[fortress]`），舰船悬空 `HOVER = 0.577` 格。高度差小于深度分辨率 ⇒ **z-fighting / 拾取抖动**。

**（c）永远不是真正交。** fov = 2° 时画面边缘 vs 中心的尺度比 ≈ `1/cos(1°) ≈ 1.00015`（0.015% 残余失真）。数值上可忽略，但"零透视失真"正是全局档相对方案 A 的**唯一成立理由**（design `09` §1.2–1.3：全局档的价值是"几何上更准确的平面态势图"）。用一个"近似正交"去实现"零失真"的卖点，自相矛盾。

**（d）LOD px 判据无法真正简化。** 透视下 `pxPerHex` 依赖距离**和屏幕位置**（中心 vs 边缘），小 fov 只是把位置依赖压小，没有消除。正交下 `pxPerHex` 是单一常数，这才是干净的实现。

### 2.3 决定：O1（双相机切换）

```ts
// cameraRig.ts
private perspCam: THREE.PerspectiveCamera;   // 默认档（现有）
private orthoCam:  THREE.OrthographicCamera;  // 全局档（新增，懒建）
private activeCam: THREE.Camera;              // 每帧 render / raycast 用 this.activeCam

enterGlobalZoom() {
  this.savePose();                       // 保存 perspCam + OrbitControls 完整位姿
  this.buildOrthoFrustum();              // §4
  this.activeCam = this.orthoCam;
  this.controls.enabled = false;         // 全局档禁旋转/平移/缩放（design 09 §2.3）
}
exitGlobalZoom() {
  this.activeCam = this.perspCam;
  this.restorePose();                    // 恢复完整位姿
  this.controls.enabled = true;
}
```

- `renderer.render(scene, this.activeCam)` 与 `raycaster.setFromCamera(ndc, this.activeCam)` 都只取 `activeCam` 引用，**拾取主路径零改动**（§3）。
- 后处理（Bloom / CRT）是**屏幕空间**全屏 quad，与投影类型无关，**零改动**（§4）。

---

## 3. 正交对拾取的影响（`04-adr-003` §2 的增量）

### 3.1 主路径不变

`Raycaster.setFromCamera` 内部对 `OrthographicCamera` 走 `Vector3.unproject`（用逆投影矩阵），产出的射线**方向平行、原点在屏幕平面内偏移**。Three r160 对正交相机的 `intersectObject(InstancedMesh)` 行为与透视一致 ⇒ **P2 InstancedMesh raycast（§2.3）、屏幕空间圆域兜底（§2.6 层 2）、编队标记可点（层 3）全部复用，零改动**。

### 3.2 需要正交分支的两处公式

| 公式 | 透视（现状） | 正交（新增分支） |
|---|---|---|
| 拾取代理体半径（`04-adr-003` §2.6 层 1） | `r_pick = max(r_body, 2·MIN_PX·d·tan(fov/2)/viewportH)` | `r_pick = max(r_body, 2·MIN_PX / pxPerUnit)`，其中 `pxPerUnit = viewportH / (2·orthoHalfH)`（常数） |
| LOD px 判据（`07-adr-006` §3.2） | `pxPerHex = viewportH / (2·d·tan(fov/2))`，逐舰队算 | `pxPerHex = pxPerUnit`（全局唯一常数），`screenPx = FLEET_SILHOUETTE_HEX · pxPerUnit` |

**推论（实现简化）**：全局档位姿固定（无缩放/平移/旋转）⇒ 全局档期间**所有舰队 LOD 恒定 = L2**，LOD 判据不需要每帧重算，可直接在 `enterGlobalZoom()` 时算一次并存为常量。

---

## 4. 正交对后处理 / 雾 / 抖动的影响

| 子系统 | 影响 | 处置 |
|---|---|---|
| **Bloom / CRT（后处理）** | 无（屏幕空间，投影无关） | 零改动；`12` draw call 不变 |
| **雾（Fog）** | 顶视正交下相机到棋盘为**单一深度**，动态雾 `fog.near = camD+55 / far = camD+385`（原型教训）会把全图洗白或糊掉 | 全局档下**禁用雾**或强制 `fog.near > 棋盘深度`。原型曾出现"全局档远端雾衰减 86% 糊成背景"的 bug，见项目 memory 2026-08-30 |
| **相机抖动（CameraShaker）** | 顶视正交下沿视线轴（世界 −Y）的抖动**无视觉效应**（正交相机沿视轴平移不改画面） | 全局档下抖动只作用于水平面（x/z），或直接抑制（要塞开火在全局档不抖）。~5 行 |
| **正交 near/far** | 正交仍需深度做遮挡排序（舰船 `HOVER 0.577` 在棋盘 `0–0.85` 之上） | `orthoCam.near/far = [-2, +2]`（世界 Y），覆盖棋盘高 + 舰船悬空 + 余量，保持深度精度 |

### 4.1 正交 frustum 尺寸（按地图 AABB 自适应，不写死）

design `09` §1.3 的"2500×2500 → 0.432"是**方形近似**；真实棋盘是矩形（`random` 50.0 × 43.3 格，伊谢尔伦 51 × 13.9 格，差 4 倍）。工程侧按棋盘 AABB 反解：

```ts
// cameraRig.ts —— 全局档正交 frustum（棋盘短边填满屏幕短边，×1.15 余量）
private buildOrthoFrustum() {
  const bw = this.boardWorldW, bh = this.boardWorldH;   // 棋盘 AABB（格）
  const vw = this.viewportW, vh = this.viewportH;       // px
  const MARGIN = 1.15;                                   // UX 02 §2.3
  // 棋盘短边 ↔ 屏幕短边：反解 pxPerUnit（格→px 缩放）
  const pxPerUnit = (Math.min(vw, vh) / MARGIN) / Math.min(bw, bh);
  this.ortho.left = -vw / (2 * pxPerUnit);  this.ortho.right =  vw / (2 * pxPerUnit);
  this.ortho.top  =  vh / (2 * pxPerUnit);  this.ortho.bottom = -vh / (2 * pxPerUnit);
  this.ortho.updateProjectionMatrix();
}
```

**战列舰投影核算**（`random` 地图 50.0 × 43.3 格，1920×1080）：

| 量 | 值 |
|---|---|
| `pxPerUnit = (1080/1.15) / 43.3` | **21.7 px/格** |
| 棋盘占屏（50 格 × 21.7 / 43.3 格 × 21.7） | **1085 × 939 px**（左右各留 ~418px HUD 槽） |
| 战列舰（`BB_HEX = 0.7328 格`） | **0.7328 × 21.7 ≈ 15.9px** |

> **精度注**：design 的 14.3px 用"方形 2500×2500"近似，工程按真实矩形 AABB 得 **~15.9px**（差 ~1.6px）。两者都稳落 **L2（12–24px）**，LOD 结论不变。此 ~1.6px 差需 art/design 知悉（Q1，见 §9），不影响本 ADR 的任何决策。

---

## 5. 决策 2：`minPolarAngle = 0.08π` 的例外机制

### 5.1 冲突的本质

`minPolarAngle = 0.08π`（`04-adr-003` §3.2）的 rationale 是"**禁止纯顶视**：顶视下高度信息全部消失，3D 化无意义"。全局档方案 B 恰恰要求 polar = 0（顶视）。**表面冲突，实则作用域不同。**

### 5.2 决定：`minPolarAngle` 约束"自由导航"，不约束"预设位姿"

| 概念 | 说明 | `minPolarAngle` 是否适用 |
|---|---|---|
| **自由导航（navigable range）** | 玩家在默认档用中键/右键旋转相机，OrbitControls 把 polar 钳在 `[0.08π, 0.35π]` | ✅ 适用，防止玩家在主动旋转中无意滑到顶视、丢失高度感知 |
| **预设位姿（preset pose）** | 玩家**显式调用**的固定相机姿态：全局档（`G`）、顶视兜底（`V`）。进入时直接 `set` 相机、禁用 OrbitControls，退出时恢复 | ❌ 不适用。玩家主动请求、姿态固定、且任何旋转输入立即退出（design `09` §2.1/2.3），不存在"迷失在顶视"的风险 |

**实现**：

```ts
// 进入全局档：绕过 OrbitControls polar 钳制（不是把 minPolarAngle 改小）
enterGlobalZoom() {
  this.controls.enabled = false;                 // 先禁用，避免 update() 里被钳回
  this.orthoCam.position.set(cx, camD, cz);      // 顶视：从棋盘中心正上方向下看
  this.orthoCam.up.set(0, 0, -1);                // 保持"上北下南"（design 09 §2.2 沿用进入前 yaw）
  this.orthoCam.lookAt(cx, 0, cz);
  this.activeCam = this.orthoCam;
}
```

**为什么这是干净的解法而非 hack**：
1. `minPolarAngle` 是 OrbitControls 的属性，全局档的相机**根本不归 OrbitControls 管**（`controls.enabled = false`），钳制自然失效。
2. design `09` §2.3 已定"全局档下旋转/平移/缩放全部禁用，任何旋转 = 退出全局档"——所以玩家**无法**在顶视下继续导航，`minPolarAngle` 想防的"玩家在顶视下失去高度感知"场景在全局档里根本不会发生（它是一个**看完全战场就退出**的瞬态模式）。
3. 例外是**显式、受控、可逆**的：退出即恢复完整位姿与钳制，`minPolarAngle` 的值（14.4°）**一字不改**。

### 5.3 同机制覆盖既有的 `V` 键顶视兜底

design `01` §2.2 I-15 已声明"低仰角下侧棱互相遮挡，需要 `V` 顶视切换兜底"。`V` 键同样是 polar = 0 的预设位姿，与 `minPolarAngle` 冲突的方式与全局档完全一致。**本 ADR 的"预设位姿例外"一并覆盖 `V` 键**，实现为同一个 `pushTopDownPreset()/popTopDownPreset()` 机制（`G` 走正交、`V` 走透视顶视，共用"禁用 OrbitControls + 保存/恢复位姿"的骨架）。

> 结论：**不改 `minPolarAngle = 0.08π` 的值**。冲突通过"预设位姿绕过 OrbitControls"解决，而不是通过放宽自由导航下限解决。

---

## 6. 决策 3：全局档 draw call / tris 重算（L3 → L2）

### 6.1 draw call 重算

基准 = `07-adr-006` §5.3 的 L3 全局档（49）。方案 B 把战列舰从 6.6px（L3）抬到 14.3px（L2），舰船层策略从 billboard 变为实体+线框：

| 来源 | 旧 L3 全局档（6.6px） | **新 L2 全局档（14.3px）** | 变化 |
|---|---|---|---|
| 棋盘（基板 1 + 顶盖 16 + 裙边 1） | 18 | 18 | 0 |
| 舰船 | 1（billboard） | **40**（实体 24 + 线框 16，关发光） | **+39** |
| 特效池 | 3 | **7** | +4 |
| L3 编队聚合标记（▲/◆ 24px） | 8 | **0**（L2 舰体几何承载识别） | **−8** |
| 星球 / 要塞 / 网格线 / 引导线 / 背景 | 7 | 7 | 0 |
| 后处理（Render + Bloom~10 + CRT） | 12 | 12 | 0 |
| **合计** | **49** | **84** | **+35** |

**逐项 rationale**：

1. **舰船 1 → 40**：`07-adr-006` §3.1 "LOD1/L2 关发光 ⇒ 36→24（常规）、24→16（旗舰），合计 40"。14.3px 属 L2，用实体+线框（关发光）。
2. **L3 编队聚合标记 8 → 0**：该标记（每舰队 1 个 ▲/◆ 24px，`depthTest:false`）只在 L3 舰船退化 billboard 后承担敌我识别。L2 下舰体几何 + 阵营色已承载识别，标记撤除；design `09` §3.2 里的"阵营标记（▲/◆，minPx 10，**每舰**）"与"阵型字形（12px，每队）"是另一层 W+ 覆盖元素，**不是**这 8 个 draw call，不冲突。
3. **特效池 3 → 7**：尾焰 2 + 舰载机 1 + 激光 1 + 导弹 1 + 护盾涟漪 1 + 爆炸 1。**伤害数字关**（design `09` §3.2 全隐藏）；**底盘光环（接地投影）关**——顶视正交下光环被舰体正上方遮挡、无深度提示价值，省 2 draw call（若 design 坚持保留则 +2，合计 86，仍在预算内）。

**判定：84 draw call = 美术预算 180 的 47%，余量 96 个（53%）✅。** 全局档从"最省（49）"变为"接近默认档（95）"，但远未触顶。

### 6.2 tris 重算

| 来源 | 旧 L3 全局档 | **新 L2 全局档** |
|---|---|---|
| 棋盘（顶视全提交，无剔除；典型 200 裙边） | 10,206 | 10,206 |
| 舰船（64 舰：8 旗舰 × 380 + 56 常规 × 150） | 128（billboard） | **11,440** |
| 特效 | 1,008 | ~1,008 |
| 星球 | 1,920 | 1,920 |
| 杂项 | 500 | 500 |
| **合计** | **13,762** | **~25,074** |

**判定**：~25k tris < 峰值 30,000（余量 17%）< 硬上限 36,000（余量 30%）✅。

**诚实声明（与 `README` §0.1 的旧结论相反）**：R2 曾断言"全局档下所有舰船都是 L3 billboard，反而最省"——那是在**方案 A（6.6px）**下的结论。方案 B（14.3px）把全局档抬进 L2 后，全局档**不再是"最省场景"**，tris 从 13.8k 升到 ~25k、draw call 从 49 升到 84。这是**用预算换 14.3px 可读性**的代价，仍在安全区内。

### 6.3 上限组合（需知悉，非阻塞）

| 组合 | 棋盘（裙边满 1024） | 舰船 L2 | 合计 | vs 硬上限 |
|---|---|---|---|---|
| 64 舰 + 裙边打满 | 20,094 | 11,440 | ~34,500 | 余量 ~4% ⚠️ |
| 128 舰（硬上限）+ 典型裙边 | 10,206 | 21,000 | ~34,200 | 余量 ~5% ⚠️ |

- 64 舰 + 裙边打满、或 128 舰满编，在全局档 L2 下会**逼近 36,000**。
- 缓解：现有**自动降级阶梯**（`07-adr-006` §7）在 fps 跌破阈值时把常规舰降 billboard；且这两组是极端边缘场景（长时间对局 + 满编舰队 + 全局档）。**不改变本 ADR 决策，但建议在 A8-4 实测时覆盖 128 舰用例。**

---

## 7. 设计侧 14.3px 信息呈现评估（缺口 4 的工程侧复核）

design `09` §3 已完成设计侧评估，工程侧复核结论：**方向正确，两处术语需修正**。

### 7.1 确认正确的三点

1. **14.3px 稳落 L2**：距 L3 下界 12px 有 2.3px 裕度、距 L1 上界 24px 有 9.7px ⇒ **无 LOD 抖动风险**（对比：默认档 25px 距 L1 下界 24px 仅 1px，才是真正的抖动隐患，`07-adr-006` §3.2 A6-Q8 已标）。
2. **"约束是阵型间距 12.1px 而非舰体尺寸"（design `09` §3.1）是对的**：14.3px 舰体已 > 12.1px 间距（舰体近似首尾相接），单舰 UI 元素（单舰 HP 20px / 状态图标 20px / 蓄力条 18px）全部 > 12.1px，必然跨舰重叠 ⇒ 维持隐藏的结论成立，且与舰体是 6.6px 还是 14.3px 无关。
3. **"真正解锁的是舰体几何而非单舰 UI"（design `09` §3.2）是对的**：14.3px 让舰体从 billboard 升到实体+线框，玩家重新获得"看舰种轮廓/朝向"的能力；但没有任何一个单舰级文字/条状元素被解锁。

### 7.2 需修正的两处陈旧术语

| 位置 | 现状（陈旧） | 应改为 | 原因 |
|---|---|---|---|
| design `09` §3.4 | "改用 **LOD1 简化几何**" | "改用 **LOD2 实体+线框（关发光、线框降采样）**" | 14.3px 属 **L2（12–24px）**，不是 L1（24–48px）。工程 LOD 标签与 `07-adr-006` §3.2 的 px 判据必须一致；"LOD1"是 art 侧对"实体+线框"的旧叫法，工程侧已细分为 L1/L2 |
| design `09` §6 验收清单 | "全局档下强制 **LOD2/billboard**" | "全局档下强制 **LOD2/实体+线框（关发光）**" | 这是方案 A（6.6px）时代的残留；方案 B 下全局档不再 billboard |

### 7.3 一个补充判断（舰载机）

全局档 14.3px 下**舰载机仍 ~2.6px**（`FLEET_SILHOUETTE` 远小于 12px 下界）。但 LOD 判据按**舰队**统一（`07-adr-006` §3.2），舰载机随所属航母舰队走 L2 实体+线框，不单独降 billboard——**无碍**，舰载机的可读性从来不是靠全局档解决的（它是默认档 L3 拾取困难的主体，见 `04-adr-003` §2.6）。

---

## 8. 验证方式

| 编号 | 验证 | 命令 / 判据 |
|---|---|---|
| **A8-1** | **正交投影正确性** | 全局档下在屏幕上取棋盘两端两点，读其世界坐标差换算成 px，与"`pxPerUnit × 格数`"一致；同屏上、下、左、右四角的 `pxPerUnit` **完全相等**（证伪透视残余）。判据：四角读数方差 = 0 |
| **A8-2** | **相机切换** | `G` 进入 → 读 `activeCam.type === 'OrthographicCamera'`、`controls.enabled === false`、polar 语义 = 0；再次 `G`/`Home`/旋转 → 退出，`activeCam` 回透视、位姿完整恢复。连续切换 20 次无泄漏（`performance.memory.usedJSHeapSize` 增长 ≤ 5%） |
| **A8-3** | **`minPolarAngle` 例外** | 全局档下 polar = 0 且**不可旋转**（中键/右键拖拽无效或即退出）；退出后 OrbitControls 钳制恢复 `[14.4°, 63°]`（复用 A3-7 的边界拖拽判据）。`minPolarAngle` 常量值在源码中仍为 `Math.PI * 0.08`（`grep` 确认未改） |
| **A8-4** | **draw call / tris 重算实测** | dev 构建读 `renderer.info.render.{triangles, calls}`：全局档（64 舰典型）**calls ≤ 90、triangles ≤ 26,000**；128 舰满编 + 全局档 **calls ≤ 90、triangles ≤ 36,000**（§6.3 边缘用例）。三档 L0/L1/全局各采样一次记录 |
| **A8-5** | **正交拾取** | 全局档下：点 ▲/◆ 阵营标记/舰体 → 选中该舰队；`Alt+左键` 查单舰；右键 → 投放信标成功；左键点地块 → 不触发买地 + 提示文案（复用 A3-14，但相机改为正交） |
| **A8-6** | **后处理不退化** | 全局档截屏确认 Bloom/CRT 正常（屏幕空间，预期无差异）；雾在全局档下**不糊棋盘**（棋盘最远格 Δ 色差 ≥ 50，复用原型 `Δ<50=不可见` 的教训） |
| **A8-7** | **LOD 恒定** | 全局档期间逐帧采样舰队 LOD，判据：**全程 = L2，切换次数 = 0**（证明"姿态固定 ⇒ LOD 常量"的 §3.2 推论） |

---

## 9. 未决事项

| # | 问题 | 默认建议 | 需谁拍板 |
|---|---|---|---|
| **Q1** | 战列舰全局档投影取 design 的 **14.3px**（方形 2500×2500 近似）还是工程矩形 AABB 的 **~15.9px** | 以工程 AABB 为准（~15.9px，`random` 地图）。两者都稳落 L2，不影响决策；但需统一口径以免文档互相打架 | **art + design** |
| **Q2** | 全局档下**底盘光环（接地投影）**是否关闭 | **关闭**（顶视下被舰体遮挡、无深度提示价值，省 2 draw call）。若坚持保留，draw call 84 → 86，仍安全 | **art** |
| **Q3** | 全局档下**要塞开火等相机抖动** | **抑制**（正交顶视沿视轴抖动无视觉效应）。保留水平面抖动亦可，二选一，工程量都 ~5 行 | **design** |
| **Q4** | design `09` §3.4 / §6 的两处陈旧术语（"LOD1 简化几何" / "LOD2/billboard"） | 按 §7.2 修正 | **design（design-strategist）** |

---

## 10. 后果

### 正面

1. **真零透视失真**，全局档的"几何准确态势图"卖点成立（而非"近似正交"）。
2. **LOD px 判据与拾取代理体公式在全局档退化为常数**，实现更简单（§3.2 推论）。
3. `minPolarAngle = 0.08π` **一字不改**，通过"预设位姿绕过 OrbitControls"干净解决冲突，且顺带覆盖 `V` 键顶视兜底。
4. 全局档 L2 的 84 draw call / ~25k tris **仍在预算内**，余量充足。

### 负面 / 代价

1. **双相机切换**引入 ~60 行新代码（ortho frustum 重建 + 保存/恢复位姿 + 雾/抖动正交分支），且相机相关代码从此有两套投影假设，需在"相机升级 checklist"里标注（同 `04-adr-003` §5.4 对 OrbitControls 升级的做法）。
2. 全局档**不再是"最省场景"**（README §0.1 旧结论需修正）：tris 13.8k → 25k、draw call 49 → 84，余量收窄但安全。极端组合（128 舰 / 裙边满）逼近 36,000，依赖降级阶梯兜底（§6.3）。
3. 拾取代理体、LOD 判据需要**正交/透视双分支**（§3.2 两张公式表），增加分支维护成本。

---

*本 ADR 由 eng-ortho-lead（程基岩）产出，只修订 `docs/` 下文档，未改动任何 `.ts` / `.vue` 源码。*
