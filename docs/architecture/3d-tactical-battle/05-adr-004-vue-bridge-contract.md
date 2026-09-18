# ADR-004 · Vue UI 层与 3D 渲染层的通信契约

- **状态**：提议（待 team-lead 批准）
- **日期**：2026-08-30
- **决策者**：engineering-lead
- **关联**：`01-architecture.md` §3、`09-risk-register.md` R-10 / R-11 / R-12
- **参考范本**：`frontend/src/game/three/ThreeStrategicMap.ts` 的 `onHoloBoardAnchor` + `StrategicScreen.vue` 的 `initStrategicEngine`

---

## 1. 上下文

### 1.1 现有通信通道盘点（实测，共 14 条；3 条已死）

| # | 通道 | 方向 | 频率 | 现状位置 | 状态 |
|---|------|------|------|----------|:---:|
| C1 | `store.fleetsUI = uiData` | 战斗 → Vue | **每帧** | BattleScene.ts:3199 | ✅ 活 |
| C2 | `store.factions[].hp/unitCount/inVision` | 战斗 → Vue | **每帧** | BattleScene.ts:3097–3197 | ✅ 活 |
| C3 | `store.selectedTile` | 战斗 → Vue | 点击时 | BattleScene.ts:1880 | ✅ 活 |
| C4 | `store.isCastingBomb` | Vue → 战斗 | 按键时 | App.vue:207 | ✅ 活 |
| C5 | `store.triggerToast(text)` | 战斗 → Vue | 事件时 | 多处 | ✅ 活 |
| C6 | `store.addBattleLog({text,type})` | 战斗 → Vue | 事件时 | BattleScene.ts:1547 | ❌ **死**（`addBattleLog` 在 gameStore 中不存在；调用点有 `typeof` 保护，不报错） |
| C7 | `store.battleDialog` | 战斗 → Vue | 事件时 | gameStore.ts:508 定义；GameHeader.vue:23 渲染 | ❌ **死**（无人写入；`showFleetDialogue` 走 Phaser 容器） |
| C8 | `commandBridge`（reactive） | 双向 | 事件时 | BattleScene.ts:1497–1533 / App.vue:66 | ✅ 活 |
| C9 | `store.setPhaserCommandDispatcher` | Vue → 战斗 | 注册 1 次 | BattleScene.ts:1203 | ✅ 活 |
| C10 | `store.gameOver/isWin/winStatus/rewardGold` | 战斗 → Vue | 终局 | BattleScene.ts:2130–2134 | ✅ 活 |
| C11 | `store.isPaused` | 双向 | 事件时 | 多处 | ✅ 活 |
| C12 | `store.currentSpeedFactor` | Vue → 战斗 | 按键时 | App.vue:217 | ✅ 活 |
| C13 | `store.resolveCampaignBattle(winner, survivors)` | 战斗 → Vue | 终局 | BattleScene.ts:3756 | ✅ 活 |
| C14 | `tacticalState.mapStyle === 'crt'` → `showCRTBorder` CSS | Vue 内部 | 挂载时 | App.vue:179–182 | ✅ 活 |

### 1.2 核心问题：每帧写 Pinia 响应式对象

C1 与 C2 都发生在 `update()` 的**每一帧**：

```ts
// BattleScene.ts:3199 —— 每帧替换整个数组
this.store.fleetsUI = uiData;

// BattleScene.ts:3097-3197 —— 每帧写深响应式对象的字段
this.store.factions.forEach((f: any) => { f.inVision = ...; f.unitCount = ...; f.hp = ...; });
this.store.factions.forEach((f: any) => { if (f.maxHp > 0) f.hp = (f.hp / f.maxHp) * 100; });
```

`const factions = ref<Faction[]>([])`（gameStore.ts:2115）是**深响应式 ref** ⇒ 每帧对 `f.hp` 的写入会触发 Vue 的依赖通知 ⇒ `GameHeader.vue` 的 `factionsList` computed 失效并重算 ⇒ 每个阵营卡片（HP 条宽度、建制数、军费）重渲染。

**在 2D 下这已经存在，但 2D 的 GPU 开销小，掩盖了它。3D 化后渲染成本从 ~2ms 升到 ~8ms，这条通道会成为压垮 60fps 的稻草。**

量化（16 个阵营卡片 × ~6 个绑定 + 16 个舰队浮标 × ~10 个绑定）：

| 方案 | 每帧 binding 更新数 | 预估耗时 |
|---|---|---|
| 维持现状（60Hz 全量响应式） | ~256/帧 × 60 = 15,360/s | **0.5–1.5 ms/帧** `[PLACEHOLDER · 验证 A4-2]` |
| 逻辑 10Hz + 投影 60Hz 直写 DOM | 逻辑 ~256/帧 × 10 = 2,560/s；投影 16×4 次 `style` 写入/帧 | **~0.13–0.30 ms/帧** |

净节省 **0.4–1.2 ms/帧**。在 16.7ms 预算里这是 2.4%–7.2%，值得。

---

## 2. 决定

### D1：新建 `frontend/src/components/battle/TacticalScreen.vue`

`App.vue` 中 `gameState === 'game'` 分支的裸 `<div id="phaser-canvas-container">` 替换为 `<TacticalScreen />`。

**结构镜像 `StrategicScreen.vue`**（用户明确要求参考战略层的回调模式）：

```vue
<!-- TacticalScreen.vue（结构示意） -->
<template>
  <div class="game-screen">
    <GameHeader />
    <div id="tactical-3d-container" ref="containerRef"></div>
    <div v-if="mapStyle === 'crt'" class="crt-monitor-border">…</div>

    <!-- 舰队浮标层：数据来自 store.fleetsUI（10Hz），位置由渲染器 60Hz 直写 transform -->
    <div class="fleet-ui-layer">
      <div v-for="fleet in fleetsUI" :key="fleet.id"
           class="fleet-float-ui"
           :ref="(el) => registerFleetEl(fleet.id, el)">
        <!-- 内容同 App.vue:20-40，不改动 -->
      </div>
    </div>

    <GameFooter />
    <SettlementModal v-if="gameOver" />
  </div>
</template>
```

```ts
// TacticalScreen.vue <script setup>
let renderer: ThreeTacticalBattle | null = null;
let host: TacticalHost | null = null;
const fleetEls = new Map<number, HTMLElement>();        // 非响应式
const registerFleetEl = (id: number, el: any) => {
  if (el) fleetEls.set(id, el as HTMLElement); else fleetEls.delete(id);
};

const initEngine = () => {
  renderer?.destroy(); renderer = null;
  const container = containerRef.value;
  if (!container) return;
  renderer = new ThreeTacticalBattle(container, {
    mapStyle: mapStyle.value,
    // —— 与 ThreeStrategicMap.onHoloBoardAnchor 同构，但走非响应式直写 ——
    onFleetHudAnchor: (fleetId, s) => {
      const el = fleetEls.get(fleetId);
      if (!el) return;
      el.style.transform =
        `translate(-50%, -100%) translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) scale(${s.scale.toFixed(3)})`;
      el.style.zIndex = String(Math.round(s.z));
      el.style.display = s.visible ? '' : 'none';
    },
    onPickUnit: (unitId, button, cx, cy) => host?.onPickUnit(unitId, button, cx, cy),
    onPickTile: (q, r, button, cx, cy) => host?.onPickTile(q, r, button, cx, cy),
    onPickNothing: (button, cx, cy) => host?.onPickNothing(button, cx, cy),
  });
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
  setTimeout(() => { host = new TacticalHost(); host.mount(containerRef.value!, buildConfig()); }, 50);
});
onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  host?.unmount(); host = null;
  renderer?.destroy(); renderer = null;
});
```

**为什么把容器从 `App.vue` 挪进 `TacticalScreen.vue`**：
- `App.vue` 目前用 `setTimeout(tryMount, 100)` + 10 次重试轮询等 DOM（App.vue:274–286），是因为容器尺寸为 0 时 Phaser 挂不上。`TacticalScreen.vue` 在 `onMounted` 里就能拿到已挂载的 `ref`，**可以删掉这个轮询 hack**。
- 与 `StrategicScreen.vue` 的 `initStrategicEngine` / `onUnmounted` 生命周期一一对应，减少两套心智模型。

### D2：双通道拆分

| 通道 | 频率 | 载体 | 承载内容 |
|---|---|---|---|
| **逻辑数据通道** | **10 Hz** | Pinia（`store.fleetsUI` / `store.factions`） | 数值与状态：hp / maxHp / unitCount / supply / stance / name / imageId / team / gold / active / inVision |
| **屏幕投影通道** | **60 Hz** | `onFleetHudAnchor` 回调 → 直接写 `el.style` | 位置 `x/y`、深度 `z`、缩放 `scale`、可见性 `visible` |

**为什么投影不能走 Pinia**：位置每帧都变，且变化是"视觉抖动"（相机移动、舰船 lerp）。把它接进响应式系统会每帧触发所有绑定更新，而唯一真正变化的只是 `transform` —— 一个浏览器合成器属性，直写即可。

**10Hz 的 rationale**：
- `100ms` 刷新间隔对"HP 条 / 建制数 / 军费"这类慢变量完全够用（一艘战列舰从满血打到 0 需要数十秒）。
- 人眼对**数值**的闪烁敏感度远低于对**位置抖动**的敏感度。数值 10Hz 无感；位置 10Hz 会明显卡顿 ⇒ 所以位置必须 60Hz。
- 与现状的差异：现状 HP 条是每帧更新的，改成 10Hz 后 HP 条会以 100ms 步进。**这是可感知但无副作用的退化**，若 team-lead 认为不可接受，可提到 20Hz（成本翻倍但仍远低于 60Hz）。记录为 A4-Q1。

### D3：命令可用性**四态**契约（R3 · 取代 R2 的两态方案）

> ⚠️ **R3 修订**：R1 写"`CommandPanel.vue` 零改动"；R2 改为"两态（可用 / 不可用+原因），~10 行"。
> **设计侧 `10-disabled-command-state.md` 与 team-lead 的校正确认后，改为四态**（可用 / **部分生效** / **未实现** / **临时不可用**），且**四种状态的点击反馈必须走不同通道**。CommandPanel.vue 改动量修正为 **~85 行**（模板 15 + 脚本 40 + 样式 30）。这是**第二次范围变更**，已报 team-lead（E-Q2）。

#### 3.1 为什么必须四态而不是两态

两态方案（可用 / 不可用+原因）会把"未实现"和"CP 不足"压成同一种"不可用"，导致：

- 玩家分不清"等 42 秒就好"和"这个根本没做完"；
- 更要命的是**点击反馈**：临时不可用给红色抖动 + 拒绝音是合适的（"你按早了"），但未实现是**游戏没做完，玩家没做错任何事** —— 给一个"你操作失误"的红色抖动，会让玩家以为是自己的错（设计侧 §3.3）。

⇒ **状态种类必须传到渲染层**，只传一个 `string | null` 的原因不够。

#### 3.2 契约（宿主计算 → 面板消费）

```ts
// frontend/src/game/tactical/commandState.ts（新增）

/** 命令的"实现完成度"（静态表，层 2 完成一项就改一行） */
export type AbilityImplStatus =
  | { status: 'ready' }
  | { status: 'partial'; note: string }     // note = 玩家可见文案，禁止内部术语
  | { status: 'not_implemented' };

export const ABILITY_IMPL_STATUS: Record<string, AbilityImplStatus> = {
  focus_fire:         { status: 'ready' },
  ecm_jam:            { status: 'ready' },                                  // 层 1 补完目标选择后生效
  reinhard_roar:      { status: 'partial', note: '移速加成尚未实现' },
  emergency_repair:   { status: 'not_implemented' },
  evasive_maneuver:   { status: 'not_implemented' },
  kirscheis_guardian: { status: 'not_implemented' },
  bucock_bastion:     { status: 'not_implemented' },
  morale_rally:       { status: 'not_implemented' },
  formation_charge:   { status: 'not_implemented' },
  yang_magic_counter: { status: 'not_implemented' },
  reuenthal_blitz:    { status: 'not_implemented' },
};

/** 面板消费的最终状态（四态） */
export type AbilityUiState =
  | { kind: 'ready' }
  | { kind: 'partial'; note: string }
  | { kind: 'not_implemented' }
  | { kind: 'blocked'; reason: string };     // 'CP 不足' | '冷却 42s' | '需指定目标' | '需莱因哈特同场'
```

**宿主计算（唯一判定处，面板不自己算）**：

```ts
// TacticalHost.ts
function computeAbilityState(id: string): AbilityUiState {
  const impl = ABILITY_IMPL_STATUS[id] ?? { status: 'not_implemented' as const };
  if (impl.status === 'not_implemented') return { kind: 'not_implemented' };   // 优先级最高

  const ab = getAbilityById(id);
  if (!ab) return { kind: 'not_implemented' };

  // 临时不可用，按设计侧 §7 的优先级：无合法目标 > 冷却中 > CP 不足
  if (ab.requireAllyAdmiralId && !this.battleAdmiralIds.includes(ab.requireAllyAdmiralId))
    return { kind: 'blocked', reason: '需莱因哈特同场' };
  if (ab.requiresTarget && !this.hasLegalTarget())
    return { kind: 'blocked', reason: '需指定目标' };
  const cd = this.cpState.cooldowns[id] || 0;
  if (cd > 0) return { kind: 'blocked', reason: `冷却 ${Math.ceil(cd / 1000)}s` };
  if (this.cpState.currentCP < ab.cpCost) return { kind: 'blocked', reason: 'CP 不足' };

  return impl.status === 'partial' ? { kind: 'partial', note: impl.note } : { kind: 'ready' };
}

/** 合法目标 = 敌方 + 视野内（非 fuzzy）+ 未全灭 */
private hasLegalTarget(): boolean {
  return this.sim.view.fleets.some(f =>
    f.visible && f.unitCount > 0 && this.factionOf(f.factionId)?.team !== this.playerTeam);
}
```

**`CommandBridge.ts` 新增三个字段**（reactive 对象现有 7 个字段**一个都不动**）：

```ts
abilityState: Record<string, AbilityUiState>;  // abilityId → 四态之一
notImplementedCount: number;                   // 顶部汇总行的分子（动态统计，不硬编码 8）
totalCount: number;                            // 顶部汇总行的分母
```

> **为什么分子用动态统计而非硬编码 8**：层 2 每完成一项就要改文案，硬编码会腐化。`notImplementedCount = Object.values(ABILITY_IMPL_STATUS).filter(s => s.status === 'not_implemented').length`。

#### 3.3 四态的视觉与反馈（落实设计侧规格）

| 状态 | 视觉 | 点击反馈 | 键盘 focus |
|---|---|---|---|
| `ready` | 常规（实线边框、正常色） | 正常响应 | ✅ |
| `partial` | **与 ready 完全一致**（实线、可 hover、可点击）+ 描述区追加一行 `⚠ 部分生效：{note}` | 正常响应 | ✅ |
| `not_implemented` | `filter: grayscale(1)` + `1px dashed rgba(148,163,184,.35)` + 右上角 `⚠ 未实现` 角标 + 背景 `rgba(0,0,0,.35)`；提督专属卡的金色边框**一并去掉** | **不抖动、不播拒绝音** → 底部非模态提示条，2s 淡出 | ✅ **可 focus** |
| `blocked` | 常规置暗（现有 `opacity: .4`，**保持不变**） | 红色抖动 200ms + **拒绝音** | ✅ |

**三条容易踩坑的实现约束**：

1. **`not_implemented` 卡片不能用 `disabled` 属性**。设计侧 §8 明确要求"可 focus，否则读屏与键盘访问不到"。⇒ 用 `aria-disabled="true"` + 自定义点击处理，**不要用 HTML `disabled`**。
2. **`selectCommand()` 不能简单早退**。现状是 `if (!cmd.available) return;`（CommandPanel.vue:102），必须改为按 `kind` 分流：
   ```ts
   function selectCommand(cmd) {
     const st = props.abilityState?.[cmd.id] ?? { kind: 'ready' as const };
     switch (st.kind) {
       case 'ready':
       case 'partial':   /* 正常流程 */ break;
       case 'blocked':   shakeCard(cmd.id); playRejectSfx(); return;
       case 'not_implemented': showInlineHint(`「${cmd.name}」效果尚未实现，将在后续版本开放`); return;
     }
     // …正常流程
   }
   ```
3. **置灰用 `grayscale(1)` 不用 opacity**。设计侧的理由成立，我补一个可验证的计算：面板底 `rgba(10,20,40,.95)` 灰度后相对亮度 ≈ 0.006，文字 `#e2e8f0` 灰度后 ≈ 0.801 ⇒ **对比度 ≈ 15.2:1**，远超 WCAG AA 的 4.5:1。opacity 0.4 则会把对比度压到 ~3:1，**不合格**。

#### 3.4 文案表（集中管理，禁止内部术语）

```ts
// frontend/src/game/tactical/commandCopy.ts（新增）
export const CMD_COPY = {
  badge:            '⚠ 未实现',
  descLine:         '效果尚未实现 · 后续版本开放',
  clickHint:        (name: string) => `「${name}」效果尚未实现，将在后续版本开放`,
  tooltip:          (name: string) => `「${name}」的效果尚未实现，将在后续版本开放。你仍可查看它的效果说明与指挥点消耗。`,
  cpTooltip:        '这是该命令今后将消耗的指挥点数',
  summary:          (n: number, t: number) => `⚠ ${n} / ${t} 个命令的效果尚未实现，将在后续版本开放`,
  hiddenCount:      (n: number) => `已隐藏 ${n} 个未实现命令`,
  ariaNotImpl:      (name: string) => `「${name}」，不可用，效果尚未实现，将在后续版本开放`,
  partialPrefix:    '⚠ 部分生效：',
} as const;
```

**硬规则**：以上文案中**不得出现** `层 2` / `效果层` / `handler` / `调用点` / `接入点` / `durationMs` 等内部术语（设计侧 §4）。评审时逐个 grep。

#### 3.5 其他规格的落点

| 规格（设计侧 §） | 实现落点 |
|---|---|
| CP 消耗**照常显示**，降为 disabled 色，**不加删除线** | 模板保留 `cmd.cpCost` 渲染，仅改 CSS 颜色；tooltip 用 `CMD_COPY.cpTooltip` |
| **排序保持原位**（§6） | 不改 `getAvailableCommands()` 的返回顺序；过滤逻辑只用于"隐藏未实现命令"设置项 |
| **「隐藏未实现命令」设置项**（§6 配套，**默认关**） | `settingsStore` 新增 `hideUnimplementedCommands: boolean`（默认值 `false`）；隐藏后在设置项旁显示 `CMD_COPY.hiddenCount(n)` |
| **顶部汇总行**（§4） | CommandPanel 顶部，文案 `CMD_COPY.summary(notImplementedCount, totalCount)` |
| **状态优先级**（§7）：未实现 > 无合法目标 > 冷却 > CP 不足 | 已编码在 `computeAbilityState()` 的判定顺序里 |
| **非颜色冗余编码**（§8）：虚线 + ⚠ + 文字 三重 | 三条都要实现，**灰度截图可辨**是验收项（A4-9） |

#### 3.6 不可消耗 CP / 不可进入选择态的三重保障

| 层 | 保障 | 状态 |
|---|---|---|
| 1 UI | `selectCommand()` 按 `kind` 分流，`not_implemented` / `blocked` 均不进入正常流程 | 本次实现 |
| 2 宿主 | `TacticalHost` 在 `pendingCallback` 里检查 `abilityState[id].kind !== 'ready' && !== 'partial'` ⇒ 直接 return，不写 `selectedAbilityId` | 本次实现，~5 行 |
| 3 规则层 | `TacticalSim.command.executeCommandAbility` 首行拒绝 `not_implemented` | **需 E-Q3 批准**（属行为变更，会让 8 个命令不可执行） |

```ts
// TacticalHost —— 从 BattleScene.openCommandPanel / executeCommandFromPanel 逐字迁移
openCommandPanel(): void {
  if (!this.cpState) return;
  const pFac = /* … */; const pFleet = /* … */;
  commandBridge.cpState = this.cpState;
  commandBridge.fleetAdmiralId = pFac.id;
  commandBridge.battleAdmiralIds = this.store.factions.filter(f => f.active).map(f => f.id);
  commandBridge.selectedAbilityId = null;
  commandBridge.visible = true;
  commandBridge.pendingCallback = (targetId: number | null) => {
    if (commandBridge.selectedAbilityId) {
      this.sim.command.executeCommandAbility(commandBridge.selectedAbilityId, targetId);
    }
    commandBridge.visible = false;
    commandBridge.pendingCallback = null;
    this.renderer?.setTargetingMode(false);
    this.store.isPaused = false;
  };
  this.store.isPaused = true;
}
```

`App.vue` 的 `showCommandPanel` / `handleCommandClose` / `handleCommandSelectTarget` 三个函数**零改动**。

### D4：事件 → store 的映射表（宿主实现）

| `BattleEvent` | 宿主动作 | 备注 |
|---|---|---|
| `TOAST` | `store.triggerToast(text)` | C5 |
| `BANNER` | `renderer` 内部绘制（3D 空间大字）+ `store.triggerToast` | 现状 `showBattleBanner` 同时画 Phaser 文字与 toast |
| `DIALOGUE` | **新**：写 `store.battleDialog = { imageId, name, text, visible: true }`，2.9s 后 `visible = false` | 复活死通道 C7（见 §5） |
| `SHAKE` | `renderer.shake(intensity, durationMs)` | — |
| `CP_EFFECT` | `store.addBattleLog?.({text, type:'ability'})` | 保持 `typeof` 保护；若复活 C6 则直接调用 |
| `GAME_OVER` | `store.gameOver = true; store.isWin = …; store.winStatus = …` | C10 |
| `CAMPAIGN_RESOLVE` | `store.resolveCampaignBattle(winnerFactionId, survivors)` | C13 |
| `STAGE_ADVANCED` / `SCRIPT_PHASE` / `REINFORCEMENT` | `store.triggerToast(text)` | 现状即 toast |
| `DEPLOY_UI` | `store.battleDialog` 或新增的部署面板 | 见 §5 |

### D5：拾取 → 命令的映射（宿主实现）

| 渲染层回调 | 宿主动作 |
|---|---|
| `onPickTile(q, r, 0, …)` | `store.selectedTile = <格子数据>`；若 `store.isCastingBomb` → `sim.command.castBomb(x, y)`；否则 → `sim.command.buyTile(q, r)`，失败时 `store.triggerToast(reason 对应文案)` |
| `onPickTile(q, r, 2, …)` | `sim.command.deployFlare(x, y)` |
| `onPickUnit(unitId, button, …)` | 若处于 targeting 模式 → `commandBridge.pendingCallback(fleetId)`；否则 → 选中舰队（新增，见 Q1） |
| `onPickNothing(button, …)` | targeting 模式下保持；否则清空 `store.selectedTile` |

`buyTile` 的失败文案必须与现状逐字一致（BattleScene.ts:1902/1906）：
- `NOT_NEUTRAL` → `"无法直接购买敌方控制区，必须派遣舰队用炮火摧毁其补给节点！"`
- `NOT_BUYABLE`（planet）→ `"星球无法直接购买，请指派舰队靠近压制！"`

---

## 3. 完整契约签名

```ts
// ThreeTacticalBattleOptions（最终版，01-architecture.md §3.4 的细化）
export interface FleetHudScreen {
  x: number;        // 屏幕 px（相对容器左上）
  y: number;        // 屏幕 px
  rotX: number;     // 度：浮标相对相机的俯仰（本层恒为 0，保留字段以对齐战略层）
  rotY: number;     // 度：浮标相对相机的偏航（本层恒为 0）
  visible: boolean; // 在视锥内 且 迷雾可见
  z: number;        // 1..200，离相机越近值越大，用于 zIndex 排序
  scale: number;    // 0.65..1.5，随相机距离缩放
}

export interface ThreeTacticalBattleOptions {
  onFleetHudAnchor?: (fleetId: number, screen: FleetHudScreen) => void;
  onPickUnit?:      (unitId: number, button: 0 | 2, clientX: number, clientY: number) => void;
  onPickTile?:      (q: number, r: number, button: 0 | 2, clientX: number, clientY: number) => void;
  onPickNothing?:   (button: 0 | 2, clientX: number, clientY: number) => void;
  onCameraInfo?:    (info: { distance: number; polar: number; azimuth: number }) => void;
  mapStyle?: 'hex' | 'crt';
  enableIntentLines?: boolean;
}
```

**`rotX` / `rotY` 为什么恒为 0？**
战略层的 `onHoloBoardAnchor` 用它们做"CSS 立牌随相机侧转"的立体效果（ThreeStrategicMap.ts:686–698）。战术层的舰队浮标是**屏幕空间 HUD**（类似血条），不是"立在棋盘上的牌子" ⇒ 不随相机侧转，保持正对玩家 = 0。
保留字段是为了：① 与战略层签名统一，减少心智负担；② 若 art-director 后续要求"浮标随视角倾斜"，无需改签名。

**`z` 与 `scale` 的计算**（对齐 ThreeStrategicMap.ts:704–709）：

```ts
const distToCam = camera.position.distanceTo(worldPos);
const baseDist  = 24;                                                  // = D0（ADR-002 §5 的默认距离）
const scale     = THREE.MathUtils.clamp(baseDist / distToCam, 0.65, 1.5);
const z         = THREE.MathUtils.clamp((baseDist / distToCam) * 100, 1, 200);
```

`baseDist = 24` 的 rationale：`D0 ≈ 24.1`（ADR-002 §5 验算），即"默认视距下 scale = 1.0、z = 100"。拉近到 D=8 ⇒ scale = 3.0 → clamp 到 1.5（浮标放大 1.5 倍）；推远到 D=120 ⇒ scale = 0.2 → clamp 到 0.65。

**边界条件**：
- 舰队不在玩家视野内（迷雾）⇒ `visible = false` ⇒ Vue 设 `display: none`。**这与现状一致**（现状 `uiData` 只对 `isVisible` 的舰队 push，不可见的舰队压根没有浮标）。
- 舰队已全灭 ⇒ 规则层从 `view.fleets` 移除 ⇒ 不再回调 ⇒ Vue 的 `v-for` 因 `fleetsUI` 不含它而卸载节点。
- `fleetEls` 里的悬空引用：Vue 卸载时会调用 `ref` 回调传 `null` ⇒ `registerFleetEl(id, null)` ⇒ 从 Map 删除。

---

## 4. `store.fleetsUI` 的新数据结构

现状（BattleScene.ts:3176–3180）：

```ts
uiData.push({ id, x, y, name, imageId, hp, maxHp, unitCount, supply, team, stance });
// 其中 x/y 是屏幕坐标：(flagship.sprite.x - cam.worldView.x) * cam.zoom
```

**新结构（删除 `x`/`y`，其余逐字保留）**：

```ts
export interface FleetUiEntry {
  id: number;
  name: string;
  imageId: string;
  hp: number;        // 旗舰绝对 hp（现状取 flagship.hp）
  maxHp: number;
  unitCount: number;
  supply: number;    // 0..100
  team: number;
  stance: StanceId;
}
```

- `x` / `y` **移除** —— 改由 `onFleetHudAnchor` 提供。
- `App.vue:19` 的 `:style="{ left: fleet.x + 'px', top: (fleet.y - 45) + 'px' }"` 改为渲染器直写 `transform`，`-45px` 的偏移并入 `transform` 的 `translate(-50%, -100%)` 或由 CSS `margin-top` 承担。
  - **注意**：现状 `top: y - 45` 中的 `-45` 是"浮标显示在旗舰上方 45px"。3D 下改为在投影时直接减去 45px（`s.y - 45`），保持视觉一致。

---

## 5. 三条死通道的处置（C6 / C7 + 意图线）

| 通道 | 现状 | 建议 | 成本 | 需谁拍板 |
|---|---|---|---|---|
| **C7 `store.battleDialog`** | 已定义 + GameHeader 已渲染，但无人写入；`showFleetDialogue` 走 Phaser 容器（BattleScene.ts:3309） | **复活**：`DIALOGUE` 事件 → 写 `store.battleDialog`；删除 Phaser 容器实现 | ~15 行 | 用户（视觉位置会从"跟随舰船"变成"固定弹窗"） |
| **C6 `store.addBattleLog`** | `BattleLogPanel.vue` 已写，`addBattleLog` 在 gameStore 中不存在，调用点有 `typeof` 保护 | **复活**：在 gameStore 加 `addBattleLog` 写入一个 `ref<LogEntry[]>`，BattleLogPanel 消费 | ~20 行 | 用户 |
| **意图线** | `renderIntentLines()` 读 `u._target`，该字段从未赋值 ⇒ 从不绘制 | 见 ADR-003 §6：规则层加只读观测字段 `unit.targetUnitId` | ~20 行 | 用户（ADR-003 Q3） |

**复活 C7 的视觉影响（必须让用户知情）**：
- 现状：对话气泡是 Phaser 容器，**跟随在旗舰右侧**（BattleScene.ts:2109–2121，每帧同步坐标并做 `1/cam.zoom` 逆向缩放）。
- 复活后：`GameHeader.vue` 的 `.battle-dialog-overlay` 是**屏幕固定位置**的弹窗（居中偏下，带提督立绘）。
- ⇒ 这不是等价替换，是**交互形态变更**。若用户要求保持"跟随舰船"，则改为：渲染层把 `DIALOGUE` 事件的目标舰队世界坐标投影成屏幕坐标，通过一个新的 `onDialogueAnchor(fleetId, screen)` 回调驱动一个跟随式浮标。**需要用户二选一**（A4-Q2）。

---

## 6. 后果

### 正面

1. 每帧 Pinia 写入从 ~256 binding 降到 0（投影走 DOM 直写），预估省 0.4–1.2 ms/帧。
2. 生命周期管理对齐 `StrategicScreen.vue` ⇒ 删掉 `App.vue` 的 `setTimeout` 轮询 hack（App.vue:274–286）。
3. `GameHeader` / `GameFooter` / `BattleLogPanel` / `SettlementModal` **零改动**。
   ~~`CommandPanel.vue` 零改动~~ **R2 修订为 ≤15 行改动**（见 D3，因 Q8 层 2 解耦需要禁用态 + 原因文字）。`CommandBridge.ts` 的 reactive 对象本身仍零改动。
4. 三条死通道有了明确的复活或删除决定，不再悬空。

### 负面 / 代价

1. **`App.vue` 需要改动**：`gameState === 'game'` 分支整段（App.vue:7–46）迁移到 `TacticalScreen.vue`。这是**必须**的改动，且是本次唯一会碰到的非 `src/game/` 文件。
2. **10Hz 逻辑刷新是可感知退化**（HP 条 100ms 步进）。见 A4-Q1。
3. **投影直写 DOM 绕过了 Vue 的响应式系统** ⇒ Vue DevTools 看不到浮标位置的变更，调试时需要在 `onFleetHudAnchor` 里打断点。这是刻意的取舍，需在代码注释里写明。
4. **新增一个组件文件**（`TacticalScreen.vue` ~260 行）。

---

## 7. 验证方式

| 编号 | 验证 | 命令 / 判据 |
|---|---|---|
| A4-1 | 通道盘点无遗漏 | 对改造后的 `TacticalHost.ts` 做 grep：`store\.\w+\s*=` 的写入点数量必须 **≥ 14**（原 14 条通道）且每条能对应到 §1.1 的表项 |
| A4-2 | 每帧响应式成本 | dev 构建下在 `TacticalHost.#frame()` 首尾插 `performance.now()`；同时用 Chrome Performance 录制 10s，统计 `updateComponent` 总耗时。**判据：逻辑通道写 Pinia 的耗时 p95 ≤ 0.3 ms/帧** |
| A4-3 | 投影不进 Pinia | `grep -n "fleetsUI" frontend/src/game/three/ frontend/src/game/tactical/` → **必须 0 命中**（渲染层与规则层都不许写 `fleetsUI`） |
| A4-4 | 浮标跟随正确 | 录屏：相机绕棋盘旋转一圈，舰队浮标必须始终贴在对应旗舰上方 45px，无滞后、无漂移；`zIndex` 随远近正确遮挡 |
| A4-5 | ~~CommandPanel 零改动~~ **R3 修订** | `git diff --stat frontend/src/services/CommandBridge.ts` → 现有 7 个字段**一个都不动**（只新增 3 个字段）<br>`git diff --stat frontend/src/components/battle/CommandPanel.vue` → **≤ 100 行**（四态分流 + 角标 + 汇总行 + 提示条 + CSS）。**超限即越界** |
| **A4-8** | **四态契约** | ① `ecm_jam` **不置灰**（层 1 后可用）② `reinhard_roar` **可用**且描述区追加 `⚠ 部分生效：移速加成尚未实现` ③ 其余 **8 个** `{ kind:'not_implemented' }` ④ 顶部汇总行显示 `⚠ 8 / 11 …` |
| **A4-9** | **灰度截图可辨 + 对比度** | ① 对面板截图后转灰度，三种状态（可用实线 / 临时不可用置暗 / 未实现灰度+虚线+⚠）**必须仍可区分** ② 置灰卡片文字对比度实测 **≥ 4.5:1** ③ 置灰卡片**键盘可 focus**（不得用 HTML `disabled` 属性），读屏朗读 = `CMD_COPY.ariaNotImpl(name)` |
| **A4-10** | **两种拒绝反馈走不同通道** | 点击 `blocked` 卡片 → 红色抖动 200ms + 拒绝音；点击 `not_implemented` 卡片 → **不抖动、不播音**，只出底部提示条 2s 淡出。判据：分别触发一次并录屏/录音对比 |
| **A4-11** | **文案无内部术语** | `grep -nE "层 ?2|效果层|handler|调用点|接入点|durationMs" frontend/src/game/tactical/commandCopy.ts frontend/src/components/battle/CommandPanel.vue` → **0 命中** |
| **A4-12** | **状态优先级** | 构造"既未实现、又 CP 不足"的 `formation_charge` ⇒ 必须显示 `未实现`（不是 `CP 不足`）。按设计侧 §7 顺序逐个验证 |
| A4-6 | 拾取语义一致 | 手工：左键点中立邻接地块 → 扣金币且地块变色；左键点敌方地块 → 出现"无法直接购买…"toast；右键点地块 → 出现"战术信标已部署"toast（文案逐字对比 BattleScene.ts:946） |
| A4-7 | 死通道处置 | 若 Q 通过：触发一次 `engage` 对话，确认 `store.battleDialog.visible === true` 且 GameHeader 弹窗出现 |

---

## 8. 未决事项

| # | 问题 | 默认建议 | 需谁拍板 |
|---|------|----------|----------|
| A4-Q1 | 逻辑数据刷新频率 10Hz（现状 60Hz） | 采用 10Hz；争议时提到 20Hz | team-lead |
| A4-Q2 | 对话气泡形态：跟随舰船（现状）vs 屏幕固定弹窗（GameHeader 已有） | **跟随舰船**（保持现状观感），需新增 `onDialogueAnchor` 回调 | 用户 |
| A4-Q3 | 是否复活 `addBattleLog`（C6） | 复活（BattleLogPanel 已经写好却没数据） | 用户 |
| A4-Q4 | 是否复活 `battleDialog`（C7） | 复活 | 用户 |
| A4-Q5 | `setPhaserCommandDispatcher` 是否改名 | Phase 6 改名 `setTacticalCommandDispatcher`（gameStore.ts 2 行） | team-lead |
