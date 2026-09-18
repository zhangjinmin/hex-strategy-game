# 09 · 风险清单与缓解措施

> 读者：team-lead、用户。
> 每条风险都给了**代码证据（文件:行号）**、**量化影响**、**缓解措施**、**验证命令**。
> 严重度：**S** = 阻塞（不解决不能开工）/ **A** = 高（会导致返工或不可发布）/ **B** = 中（会延期）/ **C** = 低（可接受技术债）。

---

## 1. 风险总表

| ID | 风险 | 严重度 | 概率 | 阶段 |
|---|---|:---:|:---:|---|
| **R-01** | `u.sprite` 是位置权威，逻辑层 72 行读渲染对象坐标 | **S** | 已确认 | P1 |
| **R-02** | 突击舰舰载机伤害在 tween 回调里结算 | **A** | 已确认 | P1 |
| **R-03** | `phaserProjectiles`（弹道 + 命中 + 扣血）住在渲染循环里 | **A** | 已确认 | P1 |
| **R-04** | 逻辑层每帧 ~24.4 万次距离计算（≈ 3.7 ms） | **A** | 已确认 | P2 |
| **R-05** | 30 处 `Math.random()` ⇒ 战斗不可复现 ⇒ 无法自动化回归 | **S** | 已确认 | **P0** |
| **R-06** | 双 WebGL context（若保留 Phaser） | **A** | 可避免 | P5 |
| **R-07** | 1951 格棋盘的三角形 / draw call / 拾取视差 | **A** | 高 | P3 |
| **R-08** | 敌人意图线是死功能（`u._target` 从未赋值） | **B** | 已确认 | P4 |
| **R-09** | 暂停语义：tween/定时器不受 `isPaused` 影响 | **B** | 中 | P2 |
| **R-10** | 每帧写 Pinia 深响应式对象 | **B** | 已确认 | P2 |
| **R-11** | `mapStyle === 'crt'` 分支散落 26 处 | **B** | 已确认 | P5 |
| **R-12** | 死代码与死通道（5 个未用 import、2 条从未写入的 store 通道、1 份重复实现） | **C** | 已确认 | P6 |
| **R-13** | 战役回写依赖 `u.gridX/gridY`，两条 spawn 路径不一致 | **B** | 中 | P1 |
| **R-14** | **既有存档 bug**：存 `nodes` 读 `strategicNodes` | **A**（既有） | 已确认 | **不在本次范围** |
| **R-15** | WebView2 可能落到软件渲染（SwiftShader / WARP） | **A** | 中 | P4 |
| **R-16** | **单位制冲突**：art 侧 1 unit = 15px vs 工程侧 1 unit = 六边形间距 | **S → B**（R2 降级） | 已确认 | **开工前（仅相机距离维度）** |
| **R-18** | draw call 余量（LOD0 ~120，美术预算 <180） | **A → C**（R2 降级） | 已确认 | P3 |
| **R-17** | `fortressWeapon` 规则对象里混了 4 个 Phaser 显示对象 | **B** | 已确认 | P1 |
| **R-19** | **层 2 边界被穿透**：效果实现被误当"遗漏"带进本次 3D 化；或本次改动碰到规则层文件 | **A** | 中 | P1–P4 |
| **R-20** | **`reuenthal_blitz` 的 `durationMs: 0`** —— 效果入库即被剪掉，层 2 写了 handler 也拿不到 | **B**（层 2 阻塞） | 已确认 | 层 2 第 1 项 |

> **注**：R-05（seeded RNG）是**开工前**必须解决的唯一 S 级；R-01 是 Phase 1 的核心工作。
>
> **R2 更新（team-lead C-7 裁决后）**：
> - **R-16 降级 S → B**：LOD 判据改为"屏幕投影 px"后，art / UX / 工程三方写的是同一个数，**不需要换算** ⇒ 单位制冲突在 LOD 维度上完全消解。剩余冲突只剩"相机距离用格还是用 art-unit"，可用 ADR-002 §2.1.1 的"阈值用格、尺寸用像素"共存 ⇒ **不再阻塞开工**。
> - **R-18 降级 A → C**：R1 我自定 draw call 预算 120，推导出 118 ⇒ 余量 2 个。美术侧实际预算是 **<180**，工程推导 95（默认档）/ 120（最近）/ 49（全局档）⇒ 余量 47%。**不再是风险，降为已知约束。**
> - 新增 **A6-Q8 / A6-Q9 / A6-Q10 / Q12 / Q13**（见 §8）：默认档 25 vs 28px、全局档两种定义二选一、L1/L2 是否合并。
>
> **R3 更新（Q8 层 2 独立立项后）**：新增 R-19 / R-20，并新增 **E-Q1 / E-Q2 / E-Q3 / E-Q4 / E-Q5**（见 §8）：置灰命令口径（8 还是 10）、`CommandPanel.vue` 最小改动是否批准、规则层安全网是否加、层 2 是否按效果成本分类立项、是否补 CP 的 golden 用例。

---

## 2. 严重度 S（阻塞项）

### R-01 · `u.sprite` 是位置权威

**证据**：

```ts
// 写（BattleScene.ts:2755-2756）—— 逻辑往渲染对象里写位置
u.sprite.x += (targetUnitX - u.sprite.x) * unitLerp;
u.sprite.y += (targetUnitY - u.sprite.y) * unitLerp;

// 读（72 行）—— 逻辑从渲染对象里读位置做规则判定
// 例 1 射程判定（:2807）
Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, eu.sprite.x, eu.sprite.y) <= effectiveRange
// 例 2 补给/占领的格子反解（:783-785）
const realY = flagship.sprite.y / yComp;
const fQ = Math.round((Math.sqrt(3)/3 * flagship.sprite.x - 1/3 * realY) / this.hexRadius);
// 例 3 要塞目标选择（:3631）const pos = { x: u.sprite.x, y: u.sprite.y, hp: u.hp };
// 例 4 迷雾可见性（:3120-3121）const fx = flagship.sprite.x; const fy = flagship.sprite.y;
// 例 5 舰队浮标屏幕投影（:3174-3175）
const screenX = (flagship.sprite.x - cam.worldView.x) * cam.zoom;
```

**量化影响**：`grep -c "sprite\.x\|sprite\.y" BattleScene.ts` = **72 行**。3D 化后若 `u.sprite` 变成 Three 对象，坐标语义从"2D 像素 + zoom"变成"3D 世界坐标"，这 72 行**全部失效**，且失效方式是**静默的**（不报错，只是距离/射程/占领全错）。

**为什么严重度是 S**：它是 R-05（无法回归）的孪生问题。若不做 R-01 的迁移，`TacticalSim` 无法脱离 DOM 运行 ⇒ golden replay 不成立 ⇒ 3827 行拆分**没有任何自动化验证**。

**缓解**：
1. 逐处机械替换 `u.sprite.x/y` → `u.x/u.y`（数值语义完全不变）。
2. 迁移完成后加编译期与 grep 门禁（见验证）。
3. `UnitState` 里**不再有** `sprite` 字段；渲染层通过 `unitId` 关联自己的对象。

**验证命令**：
```bash
grep -rn "sprite\.x\|sprite\.y" frontend/src/game/tactical/        # 必须为 0
grep -rn "\.sprite" frontend/src/game/tactical/                     # 必须为 0
npx esbuild frontend/src/game/tactical/TacticalSim.ts --bundle --platform=node \
  --format=esm --outfile=.tmp/l1.mjs --log-level=warning \
  && grep -cE "three|phaser|document\.|window\." .tmp/l1.mjs        # 必须为 0
```
**附加验证**：golden replay 3 个 case 全部 PASS（迁移前后逐 tick 相等）。

---

### R-05 · 30 处 `Math.random()` ⇒ 战斗不可复现

**证据**：`grep -c "Math.random()" BattleScene.ts` = **30**。用途包括：舷侧包抄方向（:2451、`Math.random() > 0.5`）、目标选择（:2809）、导弹散射（:2922）、地块生成（:1133/1716/1730/1745/1762）、初始阵型（:658）、AI 抽提督（:1654）、信标最近舰队（无关）等。

**量化影响**：**当前无法录制任何回归基线**。任何改动（哪怕是纯重构）都无法证明"行为未变"。这是 3827 行拆分的**单点故障**。

**缓解**：
1. **Phase 0 第一步**：在 2D 版本上把 30 处 `Math.random()` 换成注入的 `mulberry32(seed)`（复用 `ThreeStrategicMap.ts:30` 的实现）。**只换随机源，不动任何调用点之外的逻辑。**
2. 每个需要随机的子系统用**独立的 RNG 流**（`rng.ai()` / `rng.combat()` / `rng.vfx()`），避免"多画一个粒子"改变 AI 决策。
   - **注意**：这是 R-05 的一个陷阱。若所有子系统共用一个流，渲染层的随机消耗会污染规则层的序列 ⇒ 一旦调整特效数量，AI 行为就变。必须分流。
3. 种子从 `tacticalState.seed` 注入，缺省 `Date.now()`。

**验证命令**：
```bash
grep -c "Math.random()" frontend/src/game/scenes/BattleScene.ts    # 必须为 0
# 确定性验证：同 seed 连跑 3 次，digest 数组完全一致
node .tmp/replay.mjs --case skirmish-normal --mode verify --seed 20260830 --ticks 3000
```
**附加验证**：20 个不同 seed 的胜率落在 30%–70%（V-P0-4），证明换 RNG 源无系统性偏差。

---

### R-16 · 单位制冲突（art 侧 vs 工程侧）— **阻塞 art 与工程对齐**

**证据**：
- `docs/art/3d-tactical-battle/ship-assets.md` §5.0：**1 世界单位 ≈ 15 px**（锚点：战列舰 33 px ↔ 2.2 单位）。
- 本文档 `03-adr-002` §2.1：**1 世界单位 = 1 个六边形中心间距 = √3 · hexRadius px**（`hexRadius=26` 时 = 45.03 px）。
- 两者相差 **3.00 倍**。

**量化影响**：
- art 侧的 `15 px/unit` 是**固定**换算，而 `hexRadius ∈ {26, 32, 38, 44, 50}` 是**动态**的 ⇒ art 单位下棋盘宽度在 **150**（R=26）与 **288**（R=50）之间变化 1.92 倍 ⇒ `minDistance = 8`、LOD 阈值、拾取阈值在所有 `hexRadius` 下含义不同。
- art 侧的 LOD 阈值 `< 8 / 8–20 / > 20` 若直接采用，在本工程单位下 = `< 2.67 / 2.67–6.67 / > 6.67` ⇒ **默认相机距离 24 单位下所有舰船都是 LOD2（billboard）**，与"3D 化"目标直接冲突。

**缓解**：见 `03-adr-002` §2.1.1。核心原则：**像素是唯一真相，world unit 只是缩放标签**。两种约定对同一组像素只是不同标签，不会丢失美术意图。换算规则：
> 读到 art 文档里的任何"世界单位"值 `V_art` → 使用 `V_eng = V_art / 3`。

**必须在开工前会签**（否则 art 与工程的数值无法对接）。**验证**：A2-2（5 种 `hexRadius` 下棋盘世界宽度恒为 50.0）+ A2-6（阵型 XZ 分量与现状逐值 diff 为 0）。

---

## 3. 严重度 A

### R-02 · 伤害在 tween 回调里结算

**证据**：
```ts
// BattleScene.ts:2863-2877
this.tweens.add({
  targets: fighter, x: tgtX, y: tgtY, duration: (500 + Math.random() * 400) / dt,
  ease: 'Sine.easeInOut',
  onComplete: () => {
    fighter.destroy();
    /* … */
    targetShip.hp -= dmgPerFighter;          // ← 规则住在补间回调里
    if (targetShip.sprite && targetShip.sprite.active) { /* 闪白 */ }
  }
});
```

**量化影响**：1 处。但这 1 处让"逻辑层可 headless 运行"不成立 —— 补间引擎是渲染层组件，headless 环境下没有 tween ⇒ 伤害永远不结算 ⇒ 突击舰（航母）在回放中表现为"零伤害"。

**缓解**：改为规则层的**延迟伤害队列**：
```ts
// 规则层
interface PendingDamage { applyAtMs: number; dstUnitId: number; damage: number; srcUnitId: number; }
// 开火时 push 4 条（对应 4 架舰载机），tick 时检查 applyAtMs <= nowMs 则结算
// 渲染层收到 UNIT_LAUNCH_FIGHTERS 事件后自己播飞行动画，时长与规则层的延迟保持一致
```

**关键**：规则层的延迟时长（`500 + rng()*400` ms）与渲染层的动画时长**必须用同一个数**。做法：规则层把 `flightMs` 放进事件，渲染层读它。

**验证**：golden replay 中构造一支含突击舰的舰队，验证伤害在正确的 tick 结算（V-P1-1）。

---

### R-03 · `phaserProjectiles` 是玩法系统却住在渲染循环

**证据**：BattleScene.ts:2028–2088。数组自己推进位置、判定命中、扣血、触发护盾涟漪。

**量化影响**：塔伤害（唯一由弹道承载的伤害源）在 3D 化后如果一起删掉，塔就变成装饰。

**缓解**：升格为规则层 `ProjectileState[]`，快照暴露 `ProjectileView`，渲染层只画。移动/命中/扣血逻辑逐字迁移。

**验证**：golden replay 中构造一个"舰队进入敌塔 140px 内"的场景，验证塔伤害按现有节奏结算。

---

### R-04 · 逻辑层每帧 ~24.4 万次距离计算

**证据**：见 `07-adr-006` §6.1 的逐行推导。最坏场景（`random` 地图 1951 格 × 8 舰队）下：

| 行 | 每帧次数 |
|---|---|
| 2545（探索打分，含 6 邻居内层） | 93,648 |
| 3216（迷雾，内层 ~38 视界源） | 74,138 |
| 2401/2408（撤退补给点） | 31,216 |
| 2233 + 2247 | 31,216 |
| 3280（接壤高亮） | 11,706 |
| 2003（塔射击） | 1,951 |
| **合计** | **≈ 243,875** |

按 ~15 ns/次估算 ⇒ **≈ 3.7 ms/帧**，占 60fps 预算的 22%。加 3D 渲染 8ms + Vue 1ms + 合成 4ms = **16.7 ms，零余量**。

**缓解**：`07-adr-006` §6.2 的 O1–O4（平方距离 / 视界源缓存 / 价值地块索引 / 塔索引），目标 **3.7 → 1.5 ms**。

**不许做的"优化"**（会改变行为）：把迷雾/探索降到低频率。**除非用户明确批准**——那属于规则变更，需要单独流程。

**验证**：A6-6（优化前后 golden replay 逐项相等）+ V-P2-3（tick p95 ≤ 1.5 ms）。

---

### R-06 · 双 WebGL context

**证据**：`GameInstance.ts:25` 用 `type: Phaser.AUTO` ⇒ WebView2 下 Phaser 会选 WebGL。叠加 Three 的 `WebGLRenderer` ⇒ 2 个上下文。

**量化影响**：每个 1280×720 RGBA 后台缓冲 ≈ 3.7 MB + 深度缓冲 ≈ 1.8 MB；Three 的 `EffectComposer` 另需 ≥ 2 个全屏 RT。合计战术层峰值显存增加 **15–25 MB**。中低端集显上是实打实的压力，且部分驱动对多 context 有额外同步开销。

**缓解**：ADR-005 决定**战术层彻底移除 Phaser**。

**验证**：A5-3 —— `document.querySelectorAll('canvas').length === 1`（战斗中）。

---

### R-07 · 1951 格棋盘的三角形 / draw call / 拾取视差

**证据**：`random` 地图 1951 格（`README.md` §3.2 严格枚举）。

| 子风险 | 量化 | 缓解 | 验证 |
|---|---|---|---|
| 三角形爆炸 | 全棱柱（带底盖）46,824 tris | **顶盖(4 tris) + 裙边(12 tris) 分离** ⇒ 31,216；再按 16×16 分块（8 chunk）剔除 ⇒ D=8 时只提交 ~3,900 | A6-1（≤ 60,000；分块后最坏 ~41,900，余量 30%） |
| draw call | 分块后棋盘 16 个 | LOD0 场景合计 ~108，预算 120（余量 10%）。超标时按 §5.3 的三个手段降 | A6-1（≤ 120） |
| 拾取视差 | 平面反解误差最大 **1.67 格**（27° 仰角） | 改用 InstancedMesh raycast（ADR-003 §2.2–2.3）。分块后需对 8 个 topMesh + 8 个 skirtMesh 共 16 个对象做 `intersectObjects`，但只有 ray 命中的 chunk 会进入实例循环 | A3-1（误选率 = 0） |
| `computeBoundingSphere` 每帧调用 | 分块后 16 个 mesh（棋盘）+ 12 个（舰船） | 棋盘只在 `tiles.revision` 变化时调用；舰船每帧调用，若成热点改为固定超大球 + `frustumCulled = false` | A3-2（p95 ≤ 2.0 ms） |

---

### R-14 · **既有存档 bug**：存 `nodes` 读 `strategicNodes`（**不在本次范围**）

**证据**：
```ts
// gameStore.ts:297 —— 写
nodes: nodeStore.nodes as unknown as StarNode[],
// gameStore.ts:403 —— 读
const loadedNodes: StarNode[] = (data.strategicNodes || []).map(...)
```

**实测**：`build/HexFront_Saves.json` 的两个存档槽 `data` 里**只有 `nodes`（59 条），没有 `strategicNodes`** ⇒ 读档后 `strategicNodes` 恒为 `[]`。

**量化影响**：读档后星图空白。**与 3D 化无关**（既有缺陷）。

**为什么不改**：超出本次范围；改了会改变所有旧存档的读档行为，需要单独的回归。

**对本次的实际影响（重要）**：这个 bug 会让"读档 → 战略层 → 触发战斗"的回归路径**必然失败**（星图空白，点不出战斗）。

**缓解（本次要做）**：`08-roadmap` 的 V-P5-6 存档兼容验收**改走演习路径**：
> 读档 → 主菜单 → 战术模拟（sim）→ 开战 → 打完 → 回主菜单。
> **不走战略层。** 否则验收会假失败，把既有 bug 误判成 3D 化的回归。

**验证命令**：
```bash
# 存档文件在"只读不写"操作前后 checksum 不变
node -e "const c=require('crypto'),f=require('fs');\
console.log(c.createHash('sha256').update(f.readFileSync('build/HexFront_Saves.json')).digest('hex'))"
```
**立一项**（不在本次）：`gameStore.ts:403` 的 `data.strategicNodes` 改为 `data.strategicNodes ?? data.nodes`，并做旧档回归。

---

### R-15 · WebView2 可能落到软件渲染

**证据**：Wails v2 在 Windows 用 Edge WebView2（Chromium）。无 GPU 驱动 / VM / 远程桌面下会回落到 SwiftShader / WARP / Microsoft Basic Render Driver。

**量化影响**：`UnrealBloomPass` 在 1280×720 软渲染下可达 **100+ ms/帧** ⇒ 完全不可玩（约 8–10 fps）。

**缓解**：ADR-006 §5.1 的启动探测 + 三档画质。`low` 档：关 Bloom、只留 CRT 单 pass、`pixelRatio = 1.0`、强制 LOD2。

**验证**：A6-5 —— 在 3 台机器（独显台式 / 集显笔记本 / 无 GPU 驱动的 VM）上打印 `UNMASKED_RENDERER_WEBGL` 并记录落档。

---

### R-18 · draw call 余量仅 2 个（本预算中最紧的一项）

**证据**：`07-adr-006` §5.3 的逐项推导。LOD0 场景：

| 来源 | draw call |
|---|---|
| 棋盘（8 chunk × 顶盖/裙边） | 16 |
| 舰船（12 个 `faction×class` × 3 材质层 + 8 旗舰 × 3 层） | 65 |
| 特效池（激光/导弹/涟漪/爆炸/伤害数字/尾焰×2/光环×2/舰载机） | 10 |
| **L3 编队聚合标记**（`ship-assets.md` §4.4，需 `depthTest:false` 不能合批） | 8 |
| 星球 / 要塞 / 网格线 / 引导线 / 背景 | 7 |
| 后处理（RenderPass + UnrealBloom ~10 sub-pass + CRT） | 12 |
| **合计** | **118** |

**量化影响**：预算 120，**余量 2 个**。任何新增的必须独立渲染的元素都会直接击穿预算。

**缓解**（按启用优先级，实测超标时依次启用）：
1. 关闭舰船发光层（LOD1 时已关）⇒ **−16**
2. 编队聚合标记改为单个 `InstancedMesh` + 图集 ⇒ **−7**（代价：失去 `depthTest:false` 的常驻可见性，需 art/UX 评估）
3. CRT pass 合并进 Bloom 的最后一个 sub-pass ⇒ **−1**
4. chunk 从 8 降到 4 ⇒ **−8**（代价：三角形 +13k）

**预防性约束（写进 PR checklist）**：渲染层新增任何 `Mesh` / `InstancedMesh` / `Line` 之前，必须先在 `07-adr-006` §5.3 的表格里加一行并更新合计数。**合计数 > 120 的 PR 不予合并且不给以后再优化的豁免。**

**验证**：A6-1（`renderer.info.render.calls <= 120`），在 LOD0 最坏场景下采样。

---

### R-19 · 层 2 边界被穿透

**证据**：本次 3D 化与层 2（命令效果实现）解耦，但两者共用同一批代码：`CommandPointSystem.ts` / `commandAbilities.ts` / `BattleScene.ts` 的伤害与速度公式。边界不清会导致两个方向的穿透：
- **向内**：实施者看到 `getSpeedMultiplier` 零调用，顺手接上 ⇒ 改变了移速 ⇒ **违反"数值/公式零改动"**，且 golden replay 会立刻红（这是好事，能挡住）。
- **向外**：本次改动碰到 `CommandPointSystem.ts`（例如"顺手"修 `isDefending`）⇒ 规则层改动混进渲染层改造的 PR，回归无法定位。

**缓解**（写进 PR checklist）：
1. **评审红线**：本次 3D 化的任何 PR，`git diff --name-only` 中**不得出现** `frontend/src/services/CommandPointSystem.ts` 或 `frontend/src/config/commandAbilities.ts`。唯一允许的例外是"层 2 未实现命令清单"常量，且它放在 `TacticalHost.ts` 里，不进这两个文件。
2. **扩展点已就绪**：`10-adr-007` §3 的 `EffectView` + `registerEffectVisual` 让层 2 新增效果时**渲染层零改动** ⇒ 不存在"不顺便实现就做不了"的情况。
3. **验收守护**：V-E2（渲染层产物中不含 `CommandPointSystem` 的任何符号）。

**验证**：V-E1（加假效果后渲染层不报错且不改渲染核心）、V-E2、V-E3。

### R-20 · `reuenthal_blitz` 的 `durationMs: 0`（层 2 阻塞项，本次不改）

**证据**：
```ts
// commandAbilities.ts:152
effect: { type: 'teleport', value: 3.0, durationMs: 0 },
```
```ts
// CommandPointSystem.ts:86-106 updateCPState
for (let i = state.effects.length - 1; i >= 0; i--) {
  const e = state.effects[i];
  e.remainingMs -= dtMs;
  if (e.remainingMs <= 0) { state.effects.splice(i, 1); }
}
```
`executeCommand` 以 `remainingMs = ability.effect.durationMs = 0` 入库 ⇒ **同一次 `updateCPState` 调用中就被剪掉**（`0 - 16 = -16 <= 0`）。

**量化影响**：层 2 即使写了 teleport handler，用这个配置**拿不到任何效果** ⇒ 该命令会"CP 扣了、冷却启动了、什么都没发生"，且**没有任何报错**。

**缓解**：本次不动（属层 2）。层 2 立项时第一件事应是二选一：
1. 把 `durationMs` 改成实际持续时间（如 `1000`，用于"折跃完成前的无敌帧"）；或
2. 为瞬时效果在 `executeCommand` 里走**单独的 `onExecute` 通道**（这条通道 `heal` 也需要，见 `10-adr-007` §2.4）。

**验证**：层 2 实施后，执行 `reuenthal_blitz` 应能看到舰队位置发生突变（或至少效果在剪枝前被消费一次）。

---

## 4. 严重度 B

### R-08 · 敌人意图线是死功能

**证据**：`renderIntentLines()`（BattleScene.ts:1578–1603）遍历 `u._target`；但 `grep -rn "_target\b" BattleScene.ts` 只命中 **1585/1586 两行的读取处**，**没有任何赋值处** ⇒ 意图线从不绘制。
同时 `CommandPanel.vue:55` 提示"已选: XXX — 点击战场选择目标"，玩家暂停后什么都看不到。

**缓解**：见 ADR-003 §6。规则层新增**只读观测字段** `unit.targetUnitId`（在开火判定确定 `targetShip` 处赋值），不加任何判定 ⇒ 不违反"规则零改动"。

**需用户拍板**（Q3）。

---

### R-09 · 暂停语义：tween/定时器不受 `isPaused` 影响

**证据**：Phaser 的 tween 由 `Game.step` 驱动，与 `Scene.update()` 独立。`update()` 在 `isPaused` 时早退（:1982），但 tween 继续跑。**这是现状行为。**

**量化影响**：若自研的 `MicroTween` 在暂停时停止推进，暂停期间所有特效会冻住 —— 行为变更（虽然多数玩家不会注意）。

**缓解**：ADR-005 §4.3 的契约 B1：`MicroTween.update(dtMs)` 在宿主每帧调用，**不检查** `isPaused`。

**验证**：A5-5 —— 暂停后观察已创建的补间是否继续推进（必须继续）。

---

### R-10 · 每帧写 Pinia 深响应式对象

**证据**：`const factions = ref<Faction[]>([])`（gameStore.ts:2115）。`update()` 每帧写 `f.inVision / f.unitCount / f.hp / f.maxHp`（:3097–3197），并 `this.store.fleetsUI = uiData`（:3199）。

**量化影响**：~256 个 binding 更新/帧 ⇒ **0.5–1.5 ms/帧**（推导值）。

**缓解**：ADR-004 D2 —— 逻辑数据 10Hz 同步到 Pinia，屏幕投影 60Hz 直写 DOM。

**验证**：A4-2（写 Pinia 的部分 p95 ≤ 0.3 ms/帧）+ A4-3（`grep fleetsUI` 在渲染层与规则层 0 命中）。

---

### R-11 · `mapStyle === 'crt'` 分支散落 26 处

**证据**：`grep -c "mapStyle" BattleScene.ts` = **26**。

**关键事实（降低本风险）**：`CrtRenderer.ts:13` → `export const CRT_Y_SCALE = 1`。CRT 模式的"伪 3D 压扁"已被中和成恒等式 ⇒ **CRT 现在只是一套 2D 线框外观，不是竞争性 3D 方案**。

**缓解**：3D 化后 CRT 退化为**材质 + 后处理风格开关**。规则层 0 处分支；渲染层 1 处开关。常量迁入 `tacticalVisual.ts`。

**验证**：`grep -c "mapStyle" frontend/src/game/tactical/` → **0**。

---

### R-13 · 战役回写依赖 `u.gridX/gridY`，两条 spawn 路径不一致

**证据**：
```ts
// spawnStrategicFleets（:634-635）—— 存了
gridX: slot.x,
gridY: slot.y
// spawnInitialFleets（:722-726）—— 没存
fleet.units.push({ sprite, factionId, hp, maxHp, atk, def, range, classType, atkInterval, speed, tier, lastAtkTime, state, supply });
// checkGameEnd（:3744-3745）—— 用
x: u.gridX, y: u.gridY
```

**当前为什么没爆**：`resolveCampaignBattle` 只在 `isCampaign` 分支调用，而 campaign 走 `spawnStrategicFleets` ⇒ `gridX/gridY` 有值。

**风险**：重构时若把两条 spawn 路径合并（看起来很自然），`gridX/gridY` 会丢失 ⇒ 战役回写产生 `x: undefined, y: undefined` ⇒ **宏观层舰队位置损坏，且是静默的**。

**缓解**：
1. 合并 spawn 路径时，`gridX/gridY` 必须有默认值（`?? 0`）。
2. 在 `checkGameEnd` 的 survivors 构造处加断言：`if (u.gridX === undefined) console.error(...)`。
3. golden replay 加一个 campaign case（`campaign-iserlohn`），验证 survivors 的 `x/y` 非 undefined。

**验证**：`campaign-iserlohn` case 的 golden 中包含 survivors 结构的摘要。

---

### R-17 · `fortressWeapon` 规则对象里混了 4 个 Phaser 显示对象

**证据**：BattleScene.ts:93–110 —— `laserGraphics` / `chargeGraphics` / `hpBarBg` / `hpBarFill` 与 `chargeTimer` / `fortressHp` 在同一个对象字面量里。

**缓解**：`01-architecture.md` §1.4 的 `FortressState` 拆分。HP 条改由渲染层从 `fortressHp / fortressMaxHp` 自行绘制。

**验证**：`grep -n "Graphics\|Rectangle" frontend/src/game/tactical/fortress.ts` → 0 命中。

---

## 5. 严重度 C（技术债）

### R-12 · 死代码与死通道

| 项 | 证据 | 处置 |
|---|---|---|
| 5 个未使用的 import | `CommandPointSystem` 的 `getSpeedMultiplier` / `getMoraleModifier` / `canExecute` / `getCooldownMs` / `getActiveEffects` 在 `BattleScene.ts:21` 被 import，**全文仅此一处出现** | P6 清理 |
| 2 处死变量 | `impactAngleDeg`（:2051, :2965）计算后从未使用 | P6 清理 |
| 1 份重复实现 | `pointToSegmentDist_`（:3699）与 `pointToSegmentDist = this.pointToSegmentDist_`（:3708）—— 方法 + 别名两份 | P6 合并 |
| 2 条从未写入的 store 通道 | `store.addBattleLog`（gameStore 中不存在，调用点有 `typeof` 保护）、`store.battleDialog`（已定义已渲染，无人写入） | 见 ADR-004 §5，需用户拍板是否复活 |
| `StrategicScene.ts` + `.bak` | 无任何引用（仅 gameStore.ts:1314 一行注释提及） | P6 删除（A5-Q1） |

**量化影响**：约 60 行死代码 + 3 个误导性符号。**不阻塞**，但会浪费接手者的排查时间。

---

## 6. 旧存档兼容性（专项）

### 6.1 结论：**3D 化对旧存档零影响**

**证据（对 `build/HexFront_Saves.json` 的实测）**：

| 检查项 | 结果 |
|---|---|
| 存档槽 | `autosave`（2026-08-28）、`slot_1787037677176`（2026-08-18） |
| `data` 顶层键数 | 18 / 17 |
| 是否含战术层运行时状态（units / tiles / tacticalState / cpState / fortress） | **否** |
| `data.gameState` | 两个槽都是 `'strategy'` |
| 是否含 `tacticalSlots` 之外的战斗数据 | 否（`strategicFleets` 属战略层） |

`data` 的 18 个键（autosave）：
```
factionGold, fezzanGold, metaGold, tacticalMerit, adminMerit, allAdmirals,
admiralsBase, nodes, customMapsData, mapsPool, playerAdmiralId, playerRank,
strategicFleets, universeDate, strategicTimeSpeed, gameState,
strategicMapInitialized, adminState
```

**⇒ 存档里没有任何会被 3D 化改变结构的数据。**

### 6.2 保障约束（写进 checklist）

| # | 约束 | 理由 |
|---|---|---|
| S-1 | **不新增 `gameState` 值**，继续用 `'game'` | 旧档里可能存了 `'game'`；新增值会让旧档读档后落到一个不存在的界面 |
| S-2 | **不往存档里写任何战术层状态** | 旧档缺这些字段 ⇒ 读档崩溃 |
| S-3 | **不动 `serializeTacticalFleet` 的输入输出**（`strategicFleets[].tacticalSlots` 结构） | 它是 `strategicFleets` 的一部分，会进存档 |
| S-4 | **不动 `strategicFleets` 的结构** | 同上 |
| S-5 | `BattleSetupConfig` 的所有新增字段（如 `seed`）**必须有默认值** | 若玩家在战斗中存档，读档后 `tacticalState` 是内存残留的旧结构，缺 `seed` 会崩 |
| S-6 | `mapStyle` 不进存档 | 它本来就在内存里（`tacticalState.mapStyle`） |

### 6.3 存档兼容的验收命令

```bash
# ① checksum：只读操作前后存档文件不变
node -e "const c=require('crypto'),f=require('fs');\
console.log(c.createHash('sha256').update(f.readFileSync('build/HexFront_Saves.json')).digest('hex'))"

# ② 读档冒烟（走演习路径，绕开 R-14）
#    wails dev → 主菜单 → 读档(autosave) → 战术模拟 → 开战 → 打完 → 回主菜单
#    判据：无 console error；无白屏；存档 checksum 仅在主动存档时改变

# ③ 结构断言（Node 脚本，可作为 CI 步骤）
node -e "
const d=require('./build/HexFront_Saves.json');
const bad=[];
for(const [k,s] of Object.entries(d)){
  const keys=Object.keys(s.data||{});
  if(keys.some(x=>/^(units|tiles|tacticalState|cpState|fortress)/.test(x))) bad.push(k+': 含战术状态');
  if(!['title','menu','editor','game','strategy','sim'].includes(s.data?.gameState)) bad.push(k+': 未知 gameState='+s.data?.gameState);
}
console.log(bad.length?('FAIL '+bad.join('; ')):'PASS 存档结构与 3D 化无冲突');
"
```

---

## 7. 3827 行剥离的回归防护体系（专项）

三层防护，**缺一不可**：

### 第 1 层：Golden Replay（自动，最强）

- 覆盖：规则层的**每一个**可观测结果（单位位置/hp、地块归属、阵营金币、事件序列、终局）。
- 频率：每次提交前跑（3 case × 3000 tick，实测应在 10 秒内跑完）。
- 能力：**能定位到具体 tick**（输出首个不一致的 tick 号与该 tick 的完整观测向量）。
- 前提：R-05（seeded RNG）必须先解决。

### 第 2 层：截图对照（半自动，覆盖渲染）

- 原理：RNG seeded 之后，**相同 seed + 相同 tick = 完全相同的画面** ⇒ 截图是可比的。
- 做法：5 个 seed × 5 个 tick（0 / 300 / 900 / 1800 / 3000）= 25 张基准图，每个 Phase 结束各录一套，逐张并排比对。
- 覆盖：Phase 0（2D 基线）→ Phase 1（2D 抽取后）→ Phase 2（2D 事件化后）→ Phase 3 起（3D）。
- 判据：**舰船位置、血条、地块归属、要塞状态一一对应**；允许像素级抗锯齿差异。

### 第 3 层：影子模式（开发期临时，覆盖渲染层切换）

- `?renderer=both` 时 2D 与 3D 并列渲染同一个 `TacticalSim`。
- **这不是回退路径**（用户已拍板不保留）—— 它是开发期的 A/B 对照工具，**Phase 5 结束前必须删除**。
- 判据：两者舰船位置同步移动、地块归属同步变化。

### 第 4 层：编译期门禁

- `npx vue-tsc --noEmit` 基线 **0 error**（实测 23s）。
- 分层 import 门禁（grep，见 R-01 的验证命令）。

---

## 8. 需要用户 / team-lead 拍板的汇总

| ID | 问题 | 默认建议 | 需谁 | 阻塞什么 |
|---|---|---|---|---|
| **Q1** | **CP 命令的「战场选目标」是否补完**（2D 时代从未工作过；工程 R-08 与 UX `03` §1 独立核实同一结论） | **补完**。这是"新增功能"而非"迁移" | **用户** | P4（CP 系统可用性） |
| ~~Q2~~ | ~~点击/拖拽阈值~~ | **已解决**：采用 UX 值（选择 8px/300ms，右键信标 5px/200ms） | — | — |
| Q3 | 是否修复从未生效的敌人意图线（R-08） | 修复 | 用户 | P4 |
| Q4 | 是否复活 `addBattleLog` / `battleDialog`（R-12） | 复活 | 用户 | P4 |
| **Q5（S 级 → 降为 B）** | **单位制**：art 侧 `1 unit ≈ 15 px` vs 工程侧 `1 unit = 六边形间距`（UX `05` 第 44 行也锚定 art 侧） | 工程侧；**收敛方案：距离阈值用「格」、尺寸与 LOD 用「像素」** | **art-director + UX** | ~~开工前~~ **不再阻塞**（LOD 已改用 px） |
| ~~Q6（S 级）~~ | ~~LOD 距离阈值重新标定~~ | **已解决**（team-lead C-7 裁决）：改用**屏幕投影高度 px**，采纳设计侧 L0≥48 / L1 24–48 / L2 12–24 / L3<12 px | — | — |
| Q7 | CRT 模式保留为风格开关还是删除 | 保留为开关 | 用户 | P5 |
| **Q7b** | `minDistance` 取 1.44 / 4 / 8 格 | **4 格** | UX（design-strategist） | P3 |
| **Q8** | `fov` 取 45° 还是 UX 推导用的 50° | **45°** | art + UX | P3 |
| **Q9** | **事件相机（一骑讨 / 最后一击 zoom）是否保留**（UX `05` R-16：会丢失空间定向） | **默认关闭**，改"时间减速 + 台词卡 + 双高亮"。**这是行为变更** | **用户** | P3/P4 |
| **Q10/Q11** | 平移速度三档（UX `06`）/ 拾取代理体 `MIN_PX=12px` 与回退圆域 `18px` | 采纳 UX 值 | UX | P3 |
| Q12 | 逻辑数据刷新 10Hz（现状 60Hz） | 采用 10Hz | team-lead | P2 |
| Q13 | `setPhaserCommandDispatcher` 改名 | P6 改名 | team-lead | P6 |
| Q14 | 是否暴露画质档位到设置面板 | 暴露 | 用户 | P6 |
| Q15 | R-14（读档星图空白）是否立项修复 | 建议立项（不在本次） | 用户 | — |
| **A2-Q8** | **阵型间距 `spacing = 28px` 是否重算**（UX `05` 第 107 行要求） | **不重算**（改 spacing = 改射程判定 = 违反规则零改动）；改由缩小舰体 ≤26px / 接受重叠 / 高度交错解决 | **art-director + UX** | P1/P3 |
| **Q12** | **全局档按哪个定义**：`棋盘填满×1.15`（D=60.1 格，战列舰 10.6px）还是 `对齐 2D zoom 0.2`（D=96.5 格，6.6px，棋盘只占屏宽 35%） | **前者**。用户描述里两处说法**相差 1.85 倍**，必须回确认 | **用户 + UX** | P3 |
| **Q13** | 默认档取 25px（用户原话）还是 28px（距 L1 下界 24px 留裕度） | **28 px** | UX（design-strategist） | P3 |
| **A6-Q10** | L1（24–48px）与 L2（12–24px）层策略相同，是否合并 | 保持分离；若实测线框降采样收益不明显再合并 | art-director | P4 |
| **E-Q1** | **置灰命令口径**：8 个（完全无效）还是 10 个（含 2 个部分有效） | **10 个** —— 部分有效的命令描述与实现不符（"视野减半""移速+30%"未生效），玩家会误以为已实现 | **用户** | P4 |
| **E-Q2** | **`CommandPanel.vue` 需要 ~10 行改动**（显示"效果尚未实现"原因文字）—— 这打破了我 ADR-004 里"CommandPanel 零改动"的承诺 | **批准**。这是 Q8 层 2 解耦带来的范围变更，我主动报备 | **team-lead** | P4 |
| **E-Q3** | 是否在 `TacticalSim.command.executeCommandAbility` 加 1 行"未实现命令拒绝执行"的安全网 | **建议加**（防御纵深，UI 可被绕过）。但它是规则层改动，会让 8–10 个命令不可执行 ⇒ **属行为变更（正是用户决定想要的），需明确批准** | **用户** | P4 |
| **E-Q4** | 层 2 是否接受"效果分三类、成本差异极大"的结论并据此拆分立项 | 建议层 2 先做 **A 类乘数型**（damage_boost/debuff/shield/reflect/speed_boost，补调用即可），**B 类状态型**（heal/morale）与 **C 类突变型**（teleport）单独评估 —— 后两类需要新增规则维度 | 层 2 负责人 | 层 2 |
| **E-Q5** | golden replay 是否补一个 CP 用例（`skirmish-cp`） | **建议补**。现有 3 个 case 不执行任何 CP 命令 ⇒ **CP 相关改动目前没有 golden 覆盖**（已知缺口） | team-lead | P2 |
