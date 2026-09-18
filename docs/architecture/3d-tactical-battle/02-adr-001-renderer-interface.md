# ADR-001 · 渲染器接口设计：逻辑层如何驱动渲染层

- **状态**：提议（待 team-lead 批准）
- **日期**：2026-08-30
- **决策者**：engineering-lead
- **关联**：`01-architecture.md` §3、`09-risk-register.md` R-01 / R-02 / R-03

---

## 1. 上下文

现状（`BattleScene.ts`）里，逻辑层与渲染层的耦合形态是**双向直接引用**：

```ts
// 逻辑层往渲染对象里写位置（BattleScene.ts:2755-2756）
u.sprite.x += (targetUnitX - u.sprite.x) * unitLerp;
u.sprite.y += (targetUnitY - u.sprite.y) * unitLerp;

// 逻辑层又从渲染对象里读位置做规则判定（72 处，例：BattleScene.ts:2807）
const inRangeUnits = closestEnemyFleet.units.filter((eu: any) =>
  Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, eu.sprite.x, eu.sprite.y) <= effectiveRange
);
```

后果（这是本次改造**最大的结构风险**，见 R-01）：
1. 渲染对象（`Phaser.GameObjects.Container`）成了**位置权威**。3D 化后如果 `u.sprite` 变成 Three 对象，位置语义就从"2D 像素 + zoom"变成"3D 世界坐标"，规则层的 72 处读取**全部失效**。
2. 规则层无法 headless 运行 ⇒ 无法自动化回归 ⇒ 3827 行拆分只能靠人肉试玩。
3. 无法做 golden replay（渲染对象不可序列化）。

约束（来自用户）：
- 战斗规则 / 数值 / AI 逻辑**零改动**。
- 单轨直切，**不保留 2D 回退路径**。

---

## 2. 备选方案

### 方案 A：快照驱动 + 对象池（Selected）

逻辑层每 tick 把状态写进一组**只读的 typed-array 快照**（`BattleView`），渲染层每帧读快照并同步到自己的对象池。渲染层的唯一可变状态是"对象池里哪个槽位对应哪个实体 id"和"VFX 时间线"。

### 方案 B：命令缓冲（Command Buffer）

逻辑层发命令（`CREATE_UNIT(id, class)`, `MOVE_UNIT(id, x, y)`, `FIRE_LASER(src, dst)`…），渲染层维护自己的场景图并 replay 命令。

- 优点：带宽最低（只传变化量）。
- 缺点 1：渲染层必须维护一份与逻辑层**等价的实体状态机**（位置 lerp、阵型偏移、存活状态）。两队状态机一旦漂移，画面与规则不符——而"画面与规则不符"正是本项目最难发现的一类 bug。
- 缺点 2：漏命令 / 乱序 / 场景重建（切设置、resize）时需要"重放全量历史"或"补一发全量快照"⇒ 最终还是要实现 A 的全量同步路径。
- 缺点 3：与"规则零改动"冲突——现有 `update()` 是**拉模型**（每帧遍历所有舰队重算），改成推模型要重写全部遍历逻辑。

### 方案 C：直接对象引用（现状）

渲染层持有逻辑实体引用，直接读写。

- 优点：零改造成本。
- 缺点：**这就是现状**，也是本次改造要消灭的病根。3D 化后位置语义变更会让 72 处读取全部出问题。

### 方案 D：逻辑层直接调用渲染层方法（`renderer.onUnitHit(...)`）

比 C 好一点（单向），但仍是推模型，且规则层要 import 渲染层类型 ⇒ 违反 L1 零依赖，headless 跑不了。

---

## 3. 决定

**选 A：快照驱动 + 对象池。** 并补三条硬规则：

### 规则 1：位置权威归规则层

新增 `UnitState.x / UnitState.y`（逻辑平面像素，与现状 `u.sprite.x/y` **完全同义**），并逐处替换：

| 旧 | 新 | 影响行数 |
|---|---|---|
| `u.sprite.x` / `u.sprite.y`（读） | `u.x` / `u.y` | 72 行 |
| `u.sprite.x += ...; u.sprite.y += ...`（写） | `u.x += ...; u.y += ...` | 2 行（2755–2756） |
| `u.sprite.setAlpha(a)` | `u.alpha = a`（写进 `UnitView.alpha`，渲染层读） | ~6 行 |
| `u.sprite.setVisible(v)` | `u.visible = v`（写进 `UnitView.visible`） | ~8 行 |
| `u.sprite.rotation = fAngle` | `u.facing = fAngle`（写进 `UnitView.facing`） | 2 行 |

**替换的性质是纯机械改名**，`u.x/u.y` 的数值语义与 `u.sprite.x/u.sprite.y` 完全一致（同一套 lerp、同一套阵型公式、同一套距离公式）⇒ 满足"规则零改动"。

### 规则 2：单向数据流

```
TacticalSim ──BattleView(只读快照)──► BattleRenderer
TacticalSim ──BattleEvent[]（一次性）──► BattleRenderer
BattleRenderer ──TacticalSim.command.*（意图）──► TacticalSim
```

- 渲染层**禁止**写 `BattleView` 的任何字段（`as const` / 编译期 `readonly` 已标，运行时靠 code review）。
- 渲染层**禁止**持有 `TacticalSim` 的引用。
- `BattleView` 的 typed array **每帧原地复用**（不重新分配），渲染层禁止跨帧持有 array 引用做缓存（只能持有 `revision` 号）。

### 规则 3：视觉参数不进事件

事件只带"规则事实"（谁打了谁、多少伤害、几发导弹），**视觉参数（颜色、粗细、时长、rx/ry/span）全部由渲染层按 `docs/art/3d-tactical-battle/signature-effects.md` 的基准值自行决定**。

例：`UNIT_HIT` 事件只发 `{dstUnitId, damage, crit}`，护盾涟漪的 `rx:14 → 32 / ry:8 → 18 / span:0.45 → 0.6π / duration:1100ms` 由渲染层从 art 规格表读。

理由：视觉参数是 art-director 的调参领域，规则层不该知道它们；且调参时不应触发规则层的回归测试。

---

## 4. 快照的成本核算（证明"每帧拷贝"不是问题）

以实测上限计算（`README.md` §3）：

| 数据 | 规模 | 每帧写入量 |
|------|------|-----------|
| 地块 `ownerId/type/terrain/elevation/hp/connected/explored/visible/highlight` | 1951 × 9 | 17.6k 次写入 |
| 舰船 `x/y/facing/hp/hpMax/supply01/lane/formHeight/moving/visible/alpha/alive` | 128 × 12 | 1.5k |
| 弹道 | ≤ 64 × 5 | 0.3k |
| 舰队 AoS | ≤ 16 × 14 字段 | 0.2k |

合计 ≈ **19.6k 次 typed-array 写入/帧**。typed-array 单次写入 ≈ 1–2ns ⇒ **≈ 0.03 ms/帧**。60fps 下 1.8 ms/s。**可忽略。**

**进一步优化（已在接口里预留）**：
- 地块数组只在 `tiles.revision` 变化时**全量重写**；未变化时不写。地块状态变化频率 ≈ 1–10 Hz（占领/买地/迷雾）。
  - **例外**：迷雾 `visible` 每帧都变（舰队在动）。所以 `TileView.visible` 与 `highlight` **不参与 revision 门控**，每帧重写（1951 × 2 = 3.9k 写入 ≈ 0.006ms，仍可忽略）。
- 舰队 AoS（16 个对象）每帧重建对象字面量 ⇒ 16 次小对象分配/帧。GC 压力可忽略；若 profile 有异议改为预分配 + 原地写（接口不变）。

---

## 5. 为什么"对象池"而不是"每帧重建"

渲染层维护 `Map<entityId, instanceSlot>`：

```ts
// ThreeTacticalBattle 内部（示意，非最终实现）
private slotOf = new Map<number, number>();   // unitId -> instance slot
private slotOwner = new Int32Array(128);      // instance slot -> unitId（-1 = 空闲）
```

- 实体创建（`spawnInitialFleets` 等）→ 分配 slot。
- 实体死亡（`UNIT_DESTROYED` 或 `alive[i] === 0`）→ 回收 slot（写 `instanceMatrix` 为缩放 0，不从 InstancedMesh 移除）。
- 每帧只写 `instanceMatrix.array` + `instanceColor.array`，`needsUpdate = true`。

原因：Three 的 `InstancedMesh` 容量固定（`count`），运行时扩容要重建 GPU buffer。预分配 128 槽 + 缩放 0 隐藏 = 零运行时分配。

---

## 6. 后果

### 正面

1. **`TacticalSim` 可 headless 运行**（零 DOM / 零 Three / 零 Phaser）⇒ golden replay 成立 ⇒ 3827 行拆分有自动化回归网。这是选 A 的**决定性理由**。
2. 渲染层可随时销毁重建（切设置、resize、热重载）而不影响战斗进程。
3. 快照可序列化 ⇒ 可以录一局战斗存成 JSON，用于美术调参时反复回放同一局面。
4. 逻辑/渲染的职责边界可由编译器部分强制（`readonly` + 分层 import 约束）。

### 负面（必须接受的代价）

1. **每帧拷贝**：≈ 0.03 ms/帧（§4 实测推导）。可接受。
2. **事件驱动 VFX 的表达力上限**：某些"边飞行边变形"的特效（如导弹蛇形轨迹）在事件里只有起点/终点，中间形态要靠渲染层自己插值。
   - 影响面：导弹蛇形轨迹（BattleScene.ts:2912–2914 的 `wobbleAmp/wobbleMed`）⇒ 由渲染层按 `missile.id` 持续时间线自行生成。**视觉等价性由 art-director 目视确认**（见 `08-roadmap` Phase 4 验收项 V-07）。
3. **单帧多事件顺序**：同一 tick 内 `UNIT_HIT` 与 `UNIT_DESTROYED` 的先后必须保留（先扣血再判定死亡）。
   - 约束：`TacticalSim` 内部 `events.push` 顺序 = 逻辑发生顺序；`drainEvents()` 保序。渲染层按序消费。
4. **改造期要同时维护两套**：Phase 0–2 期间 2D 渲染适配器与未来的 3D 渲染器都读同一份 `BattleView` ⇒ 需要先写适配器（约 400 行），这部分工作是"纯过渡成本"，Phase 5 删除。

---

## 7. 验证方式

| 编号 | 验证 | 命令 / 判据 |
|------|------|-------------|
| A1-1 | L1 零依赖 | `npx esbuild frontend/src/game/tactical/TacticalSim.ts --bundle --platform=node --format=esm --outfile=.tmp/l1.mjs --log-level=warning` → **产物中不得出现 `three`、`phaser`、`document`、`window`**（`grep -c` 校验） |
| A1-2 | 快照写入成本 | 在 `TacticalSim.tick` 末尾插桩 `performance.now()`，跑 `random` 地图 128 舰 600 tick，p95 `tick` 耗时 ≤ 3.0 ms（见 `07-adr-006` §5） |
| A1-3 | 事件保序 | golden replay 中比对事件序列的 `(t, dstUnitId)` 元组序列，必须与 golden 逐项相等 |
| A1-4 | 渲染层无回写 | code review checklist 条目；运行时在 dev 构建下对 `BattleView` 数组套 `Object.freeze` 代理（dev-only，release 关闭） |

---

## 8. 未决事项

| # | 问题 | 处理 |
|---|------|------|
| A1-Q1 | 相机状态（位置/朝向）是否也进快照？ | **否**。相机是纯渲染状态，规则层不需要。ADR-003 定义其归属。 |
| A1-Q2 | 暂停时的快照是否继续更新？ | **是**。`tick` 不推进，但 `view` 仍是可读的最新状态；渲染层继续渲染（现状 `update()` 早退后 Phaser 仍会绘制）。 |
| A1-Q3 | `BattleView.revision` 溢出 | `number` 到 2^53 前不会溢出；单场战斗最多 ~10^6 tick，安全。 |
