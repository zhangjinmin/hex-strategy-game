# ADR-005 · Phaser 的最终去留

- **状态**：提议（待 team-lead 批准）
- **日期**：2026-08-30
- **决策者**：engineering-lead
- **关联**：`01-architecture.md` §5、`09-risk-register.md` R-04

---

## 1. 上下文

`BattleScene extends Phaser.Scene`。3D 化后，需要判断 Phaser 在这次改造中扮演什么角色。

**关键事实（实测）**：Phaser 在本项目中还有第二个使用者 —— 地图编辑器。

| 文件 | 是否依赖 Phaser | 被谁使用 | 状态 |
|---|---|---|---|
| `game/scenes/BattleScene.ts` | 是 | `game/GameInstance.ts` | 本次改造对象 |
| `game/scenes/crt/CrtRenderer.ts` | 是（仅类型 + `Phaser.Scene`） | `BattleScene` | 随 BattleScene 一起删 |
| `game/scenes/EditorScene.ts` | 是 | `components/EditorScreen.vue:60` | **活跃，不在本次范围** |
| `game/scenes/StrategicScene.ts` | 是 | 无（仅有 `gameStore.ts:1314` 的一行注释提及） | **死代码**（另有 `StrategicScene.ts.bak`） |
| `game/GameInstance.ts` | 是 | `App.vue:101` | 随 BattleScene 一起删 |

⇒ **`phaser` 依赖不能从 `package.json` 移除**，除非连地图编辑器一起重写（那是另一个项目）。

---

## 2. 备选方案

### 方案 A：彻底移除（战术层不再 import `phaser`）

战术层的所有 Phaser 用法替换为自研基础设施；`phaser` 依赖保留给 `EditorScene`。

### 方案 B：保留 Phaser 作 headless 逻辑宿主 / 计时器

`BattleScene` 仍是 `Phaser.Scene`，保留 `this.time` / `this.tweens` / `this.input`，只把 2D 图形对象换成 Three。

- 优点：省掉自研 tween / 定时器 / 输入的工作量（约 180 行）。
- 缺点 1：**双 WebGL context**。见 §3.1。
- 缺点 2：`BattleScene` 仍是 `Phaser.Scene` ⇒ 3827 行文件无法干净拆分，`update()` 仍是 Phaser 生命周期的一部分 ⇒ 规则层依赖 `Phaser.Scene` ⇒ **headless 跑不了 ⇒ golden replay 失效 ⇒ 回归网崩溃**。这一条是致命的。
- 缺点 3：Phaser 的 `Scene.update()` 与 Three 的 rAF 循环是两个独立时钟，帧序不确定 ⇒ 逻辑 tick 与渲染可能错帧。

### 方案 C：保留 Phaser，仅作 2D 覆盖层（HUD / 伤害数字）

Three 画 3D 场景，Phaser 画 2D 覆盖层（透明 canvas 叠在上面）。

- 优点：伤害数字、对话气泡等 2D UI 可以直接沿用现有 Phaser 代码。
- 缺点：同方案 B 的缺点 1（双 context）；且两层 canvas 叠加有合成开销与事件穿透问题。

---

## 3. 决定：方案 A — 战术层彻底移除 Phaser

### 3.1 决定性理由

| # | 理由 | 证据 |
|---|------|------|
| **1** | **headless 是回归网的前提** | 若 `TacticalSim` 依赖 `Phaser.Scene`，就无法在 Node 里跑（Phaser 需要 `window` / `document` / canvas）⇒ `08-roadmap` 的 golden replay 全部失效 ⇒ 3827 行拆分失去唯一的自动化回归手段。R-01 的风险无法收敛。 |
| **2** | **双 WebGL context 的真实成本** | `GameInstance.ts:25` 用 `type: Phaser.AUTO` ⇒ 在 WebView2 下 Phaser 会选 WebGL。叠加 Three 的 `WebGLRenderer` ⇒ 同一页面 2 个 WebGL 上下文。每个 1280×720 RGBA context 的后台缓冲约 3.7 MB，加上深度缓冲与后处理 FBO（Three 的 `EffectComposer` 至少 2 个全屏 RT）⇒ 战术层峰值显存增加约 **15–25 MB**。在中低端集显（本项目目标机型）上这是实打实的压力。 |
| **3** | **Phaser 4 的包体** | 战术层为一个已不需要它的功能付出整个运行时。 |
| **4** | **替换成本极低** | 见 §4：自研基础设施约 **180 行**，且每一处都有明确的 Phaser 对应物。 |

### 3.2 为什么"保留作 headless 宿主"是个伪命题

方案 B 的卖点是"省掉自研 tween/定时器"。但：

- `this.time.delayedCall` 与 `this.tweens.add` 在 `BattleScene` 里的**全部用途都是特效**（37 处 tween + 8 处 delayedCall，逐一盘点见 §4.2）。
- 唯一的例外是突击舰舰载机的伤害结算（`onComplete` 里 `targetShip.hp -= dmgPerFighter`，BattleScene.ts:2870）。但按 ADR-001 的拆分，这个伤害**必须搬回规则层**（改成规则层的"延迟伤害"队列），因为它属于规则域。**搬走之后，tween 就 100% 是特效了。**
- ⇒ 保留 Phaser 的唯一收益是"省 180 行特效基础设施"，代价是"失去回归网 + 多一个 WebGL context"。

---

## 4. 替换成本清单（逐项实测）

### 4.1 Phaser 在 `BattleScene.ts` 的依赖面（grep 实测）

| Phaser API | 次数 | 用途域 | 替代码量 |
|---|---|---|---|
| `Phaser.Math.Distance.Between` | 36 | 规则（射程/视野/距离） | 3 行 |
| `Phaser.Math.Between` | 11 | 规则 + 渲染（抖动/散射） | 3 行 |
| `Phaser.Math.Clamp` | 1 | 相机（行 232） | 2 行 |
| `Phaser.Math.RadToDeg` | 2 | **渲染，且结果 `impactAngleDeg` 从未被使用**（行 2051、2965，两处均只赋值不读取） | **0 行（删除）** |
| `Phaser.BlendModes.ADD` | 13 | 渲染 | 0 行（Three 用 `blending: THREE.AdditiveBlending`） |
| `Phaser.GameObjects.*`（类型标注） | 22 | 类型 | 0 行（随对象一起删） |
| `Phaser.Geom.Polygon`（+ `Contains`） | 2 | 地块点击（行 991） | 0 行（改 raycast） |
| `Phaser.Input.Pointer` / `Keyboard` | 6 | 输入 | 见下 |
| `Phaser.Scene`（基类） | 1 | 生命周期 | 见下 |
| `Phaser.Types.Scenes.SettingsConfig` | 1 | 构造参数 | 0 行 |
| `Phaser.Tweens.Tween` | 1 | 类型 | 0 行 |

### 4.2 需要自研的基础设施

| 能力 | Phaser 现状用量 | 自研实现 | 码量 |
|---|---|---|---|
| **补间引擎** | `this.tweens.add` 37 处；`this.tweens.addCounter` 1 处 | `MicroTween`：支持 `targets`（对象或对象数组）、属性 `x/y/alpha/scale/scaleX/scaleY/rotation/radius/width`、`duration`、`delay`、`ease`（`Sine.easeOut` / `Sine.easeInOut` / `Cubic.easeOut` / `Expo.easeOut` / `Quad.easeOut` / `Back.easeOut` / `Linear`）、`yoyo`、`repeat`、`onUpdate`、`onComplete` | ~150 行 |
| **延时调用** | `this.time.delayedCall` 8 处 | `MicroTween.delay(ms, fn)`（复用同一时间线） | 含上 |
| **循环定时器** | `this.time.addEvent({delay:1000, loop:true})` 1 处（行 293，经济结算） | 宿主 rAF 累加器：`acc += dtMs; while (acc >= 1000) { acc -= 1000; sim.tickEconomy(); }` | 8 行 |
| **单调时钟** | `this.time.now` 5 处 | 宿主 `nowMs`（每帧累加 `dtMs`） | 2 行 |
| **输入** | `pointermove` / `wheel` / `keydown` / `addKey` / `JustDown` 共 4 个注册点 | DOM 事件 + `MicroTween` 无关 | ~40 行 |
| **场景生命周期** | `Phaser.Scene` 的 `preload/create/update` | `TacticalHost.mount/unmount` | ~60 行 |
| **数学工具** | 见 §4.1 | `mathx.ts` | ~8 行 |

**合计约 180–270 行自研基础设施**（不含渲染代码本身）。

### 4.3 `MicroTween` 必须复现的 Phaser 行为契约

| # | 行为 | 现状证据 | 要求 |
|---|------|----------|------|
| **B1** | **补间不受 `isPaused` 影响** | Phaser 的 tween 由 `Game.step` 驱动，与 `Scene.update()` 独立；`update()` 在 `isPaused` 时早退（行 1982），但 tween 继续跑 | `MicroTween.update(dtMs)` 在宿主的**每帧**调用，**不检查** `isPaused` |
| **B2** | **补间时长在创建时按速度档预缩放** | 现状写法 `duration: 900 / dt`，`dt = store.currentSpeedFactor`（行 2077 等） | 渲染层在创建补间时读当前 `speedFactor` 并做除法。**补间创建后不再随速度档变化**（与现状一致） |
| **B3** | `delay` 与 `duration` 同样按速度档缩放 | 现状 `delay: m * 35 / dt`（行 2902）、`delay: i * 150`（行 3571，**未缩放**，属既有不一致） | 逐处照抄现状的缩放写法，**不统一**（统一会改变观感） |
| **B4** | `repeat: -1` 的无限循环补间（行 933–935，信标动画） | `Phaser` 无限循环 | `MicroTween` 支持 `repeat: -1` |
| **B5** | `onComplete` 里可能销毁对象（37 处中约 30 处是 `onComplete: () => x.destroy()`） | — | `onComplete` 在移除该 tween **之后**调用，允许在回调里安全销毁 |

> **B2/B3 是行为等价的关键。** 现状的 `duration: 900 / dt` 意味着"3 倍速下特效播放速度也快 3 倍"。若 `MicroTween` 改成"实时时长 + 全局 timeScale"，在速度档切换的瞬间，已创建的补间会从"预缩放时长"变成"实时时长"，观感会跳变。**逐处照抄现状是唯一安全的做法。**

---

## 5. 删除清单与保留清单

### 5.1 删除

| 文件 / 代码 | 行数 | 时机 |
|---|---|---|
| `frontend/src/game/scenes/BattleScene.ts` | 3827 | Phase 5 |
| `frontend/src/game/scenes/crt/CrtRenderer.ts` | 546 | Phase 5（**常量先迁出**，见下） |
| `frontend/src/game/GameInstance.ts` 中 `mountGame` / `unmountGame` 的 Phaser 部分 | 51 | Phase 5 |
| `App.vue` 中 `import { mountGame, unmountGame }` 与 `watch(gameState)` 的挂载逻辑 | ~25 | Phase 2 |
| `frontend/src/game/scenes/StrategicScene.ts` + `.bak` | 死代码 | **本次不动**（与 3D 化无关，单独立项） |

### 5.2 迁出（不是删除）

```ts
// frontend/src/game/config/tacticalVisual.ts（新建，~80 行）
// 来源：CrtRenderer.ts:13-16
export const CRT_BG          = '#040810';
export const CRT_GRID_COLOR  = 0x1a3a1a;
export const CRT_ACCENT      = 0x00cc66;
export const CRT_Y_SCALE     = 1;        // 保留仅为记录历史：实测已是恒等式（F1），本层不再使用
```

### 5.3 保留（不在本次范围）

| 文件 | 理由 |
|---|---|
| `frontend/src/game/scenes/EditorScene.ts` | 地图编辑器（`EditorScreen.vue:60`）活跃依赖 |
| `package.json` 的 `"phaser": "^4.1.0"` | 同上。**不移除** |
| `frontend/src/game/scenes/StrategicScene.ts` | 死代码但本次不动（避免扩大改动面） |

---

## 6. 后果

### 正面

1. `TacticalSim` 零依赖 ⇒ headless 可跑 ⇒ golden replay 成立 ⇒ R-01 有回归网兜底。
2. 战术层从 2 个 WebGL context 降到 1 个，预估省 15–25 MB 显存。
3. `BattleScene.ts` 能被真正删除（而不是留一个 Phaser 空壳）。
4. 帧循环只有一个时钟（宿主 rAF），逻辑 tick 与渲染的帧序确定。

### 负面 / 代价

1. **自研 180–270 行基础设施**（`MicroTween` 是大头）。这部分代码需要自己的测试。
2. **B1–B5 的行为契约必须逐条验证**，否则会引入细微的观感差异（尤其是 B2/B3 的速度档缩放）。
3. **`phaser` 仍在依赖里** ⇒ 打包体积没有下降（除非未来重写地图编辑器）。**这一点要如实告知用户，不要宣称"移除了 Phaser 依赖"。**
4. **地图编辑器与战术层未来会走两条技术栈**（Phaser 2D vs Three 3D）。这是可接受的技术债，但需记录：若将来要统一，成本 = 重写 `EditorScene`（约 800 行）。

---

## 7. 验证方式

| 编号 | 验证 | 命令 / 判据 |
|---|---|---|
| A5-1 | 战术层零 Phaser | `grep -rn "phaser" frontend/src/game/tactical/ frontend/src/game/three/ frontend/src/components/battle/ -i` → **0 命中** |
| A5-2 | 规则层零渲染依赖 | 见 ADR-001 的 A1-1（同一条命令同时验证 three / phaser / DOM） |
| A5-3 | 单 WebGL context | devtools 里统计 `document.querySelectorAll('canvas')` 在 `gameState === 'game'` 时 **= 1**；`performance.memory` 或 GPU 面板确认显存未叠加 |
| A5-4 | `MicroTween` 行为等价 | 单元脚本：对 37 处 tween 的参数逐个构造，比对 Phaser 与 `MicroTween` 在 `t ∈ {0, 0.25, 0.5, 0.75, 1} × duration` 上的插值输出，**误差 ≤ 1e-6** |
| A5-5 | B1 暂停行为 | 暂停（`store.isPaused = true`）后观察已创建的补间是否继续推进 → 必须**继续**（与现状一致） |
| A5-6 | B2 速度档缩放 | 在 1× 与 3× 下分别触发同一次激光，`duration` 必须分别为 `900` 与 `300` ms |
| A5-7 | 地图编辑器不受影响 | 手动进入 `EditorScreen`，确认地块刷、颜色选择、保存均正常（`EditorScene` 未被动过） |

---

## 8. 未决事项

| # | 问题 | 默认建议 | 需谁拍板 |
|---|------|----------|----------|
| A5-Q1 | `StrategicScene.ts` + `.bak`（死代码）是否顺手删除 | **不删**（与 3D 化无关，避免扩大 diff） | team-lead |
| A5-Q2 | 未来是否重写 `EditorScene` 以彻底移除 `phaser` 依赖 | 本次不做；记录为技术债 | 用户 |
| A5-Q3 | `MicroTween` 是否需要支持 `ease` 之外的自定义曲线函数 | 支持 `ease: (t:number)=>number` 的传入形式（约 2 行） | —（已决定支持） |
