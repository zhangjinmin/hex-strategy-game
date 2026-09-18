# 01 · 主架构：BattleScene 拆分方案

> 读者：接手开发者。
> 目标：把 `frontend/src/game/scenes/BattleScene.ts`（3827 行）拆成"规则域（不可动）"与"渲染域（可替换）"，定义两者的接口边界。
> 约定：本文出现的类型签名即最终签名，实施时照抄；如需改动，先改本文。

---

## 1. 现状盘点：3827 行里每一行属于哪一域

### 1.1 判定规则（3 问定域，冲突时从上到下取第一个命中）

| 序 | 判定 | 归属 |
|---|------|------|
| 1 | 删除它，战斗结果（谁赢 / 谁剩多少血 / 哪块地归谁）会变吗？ | 会 → **规则域** |
| 2 | 删除它，玩家还能操作、还能看到发生了什么吗？（只影响"好不好看"） | 是 → **渲染域** |
| 3 | 它提供时间/循环/事件基础设施？ | 是 → **宿主域** |

### 1.2 成员变量分类（BattleScene.ts:48–122）

| 成员 | 行 | 域 | 处置 |
|------|----|----|------|
| `store` | 49 | 宿主 | 保留在宿主；规则层改为接收**纯数据配置**，不直接持有 Pinia |
| `globalFleets`（含 `units[].hp/atk/range/supply/state`） | 50 | **规则** | → `TacticalSim.fleets`，`units[].sprite` 字段**删除** |
| `phaserProjectiles` | 51 | **规则**（F4：弹道+伤害在此结算） | → `TacticalSim.projectiles`，改为纯数据 |
| `tilesList` / `tilesDict` | 52–53 | **规则** | → `TacticalSim.tiles`（SoA + 索引 Map），`sprite`/`text` 字段删除 |
| `hpBarsGraphics` | 54 | 渲染 | 删除，改 CSS2D / Sprite |
| `playerFlare` | 55 | 渲染 | 删除；`fleet.targetFlare: {x,y}` 属**规则**，保留 |
| `carrierFighters: Map<number, Arc[]>` | 56 | 渲染 | 删除，改 InstancedMesh |
| `activeDialogues: Container[]` | 57 | 渲染 | 删除，改 `DIALOGUE` 事件 + Vue 渲染 |
| `factionMap: Map<number, any>` | 58 | 规则 | 保留（纯查找缓存，无渲染依赖） |
| `battleStage` / `stageReported` | 60–61 | 规则 | 保留 |
| `battleLosses` / `battleLossText` | 63–64 | 规则 / 渲染 | 拆：`battleLosses` 规则；`battleLossText` 改 Vue |
| `duelCooldown` / `lastDuelPair` / `adversityTriggered` | 66–68 | 规则 | 保留（`duelCooldown` 依赖 `this.time.now` → 改为宿主传入 `nowMs`） |
| `deployPhase` / `deployText` / `deployFormation` / `deployTactic` | 70–73 | 规则 / 渲染 | 拆：三个状态变量规则；`deployText` 改 Vue |
| `reinforceTimer` / `reinforceInterval` / `reinforceUsed` | 75–77 | 规则 | 保留 |
| `scriptPhase` / `scriptReported` | 79–80 | 规则 | 保留 |
| `mapStyle: 'hex' \| 'crt'` | 83 | 渲染 | 迁到 `TacticalVisualConfig`（见 Q3）；**不进规则层** |
| `crtGraphics/Wireframe/Fleets/Overlay`, `crtHudLabel`, `crtGlowTime`, `crtFleetRedrawTimer` | 84–90 | 渲染 | 删除（F1：`CRT_Y_SCALE === 1`，CRT 已退化为外观） |
| `fortressWeapon` | 93–110 | **混合** | 拆：计时/目标选择/伤害 → 规则；`laserGraphics`/`chargeGraphics`/`hpBarBg`/`hpBarFill` → 删除（见 §1.4） |
| `hexRadius` / `baseHexRadius` | 112–113 | 规则（影响距离判定） | 保留 |
| `directions`（6 邻居偏移） | 114 | 规则 | 保留 |
| `cpState` / `cpCommandMode` / `pendingAbilityId` | 117–119 | 规则 / 宿主 | `cpState` 规则；后两者属 UI 流程，移到宿主 |
| `intentLines` | 120 | 渲染 | 删除，改 3D 意图线 |
| `damageNumbers` | 121 | 渲染 | 删除，改事件驱动 |
| `spaceKey` | 122 | 宿主 | 删除，宿主接管键盘 |

### 1.3 方法分类（45 个方法）

| 方法 | 行 | 域 | 新位置 |
|------|----|----|--------|
| `preload` | 128 | 渲染 | 删除（贴图改 Three 材质） |
| `create` | 137 | 宿主 | → `TacticalHost.mount()` + `TacticalSim.init()` + `BattleRenderer.build()` |
| `activateDeployPhase` | 498 | 规则 | `TacticalSim` |
| `updateDeployText` | 515 | 渲染 | → `BANNER`/`DEPLOY_UI` 事件 + Vue |
| `startBattleAfterDeploy` | 541 | 规则 | `TacticalSim.command.requestDeployment()` |
| `showBattleBanner` | 561 | 渲染 | → `BANNER` 事件 |
| `spawnStrategicFleets` | 587 | **混合** | 拆：单位数据构造 → `TacticalSim.init`；`add.container/image/text` → 删除 |
| `spawnInitialFleets` | 648 | **混合** | 同上 |
| `updateSupplyNetwork`（BFS 连通） | 731 | **规则** | `TacticalSim` |
| `processSupplyAndCapture` | 774 | **规则**（读 `flagship.sprite.y` → 改为读 `unit.y`） | `TacticalSim` |
| `deployFlare` | 892 | 混合 | 拆：状态写入 → 规则；六边形环/动画 → 渲染 |
| `renderHexMap` | 951 | 渲染 | → `BattleRenderer.buildBoard()` |
| `buildCampaignMap` | 1067 | 规则 | `TacticalSim` |
| `buildCampaignEnvironment` | 1080 | **混合** | 拆：地图矩阵/阵营/要塞参数 → 规则；`add.rectangle/graphics` → 删除 |
| `setupCommandDispatcher` | 1202 | 宿主 | `TacticalHost`（写 `store.setPhaserCommandDispatcher`） |
| `scaleMapForFleetCount` | 1241 | 规则 | `TacticalSim` |
| `getFormationCnName` | 1281 | 渲染 | → 前端文案表 |
| `getTerrainAt` | 1287 | **规则** | `TacticalSim`（坐标反解；`CRT_Y_SCALE` 项删除） |
| `getTerrainSpeedMul` / `RangeMul` / `DodgeMul` | 1296–1322 | **规则** | `TacticalSim` |
| `renderTerrainMarkers` | 1325 | 渲染 | 删除 |
| `checkBattleStage` | 1353 | 规则 | `TacticalSim` |
| `updateScriptPhase` | 1386 | 规则 | `TacticalSim` |
| `updateReinforcement` | 1429 | 规则 | `TacticalSim` |
| `getIdealEngageDist` | 1458 | 规则 | `TacticalSim` |
| `getVisionRange` | 1484 | 规则 | `TacticalSim` |
| `openCommandPanel` | 1497 | 宿主 | `TacticalHost`（操作 `commandBridge`） |
| `executeCommandFromPanel` | 1521 | 规则 + 宿主 | 拆：`executeCommand()` → 规则；`isPaused=false` → 宿主 |
| `showCommandEffect` | 1536 | 渲染 | → `CP_EFFECT` 事件 |
| `applyCommandEffects` | 1553 | 规则 | `TacticalSim` |
| `spawnDamageNumber` | 1563 | 渲染 | → `UNIT_HIT` 事件 |
| `renderIntentLines` | 1578 | 渲染 | 删除，改 3D 意图线 |
| `initFactions` | 1605 | 规则 | `TacticalSim`（纯数据构造） |
| `buildMapData` | 1709 | 规则 | `TacticalSim` |
| `calculateFleetPower` | 1845 | 规则 | `TacticalSim` |
| `isAdjacentToTeam` | 1856 | 规则 | `TacticalSim` |
| `handleTileClick` | 1866 | 宿主 + 规则 | 拆：raycast → `BattleRenderer`；买地/信标/轰炸 → `TacticalSim.command` |
| `castBomb` | 1943 | 规则 | `TacticalSim` |
| **`update(time, delta)`** | **1968–3308** | **混合** | 见 §1.5 逐段拆解 |
| `showFleetDialogue` | 3309 | 渲染 | → `DIALOGUE` 事件 |
| `updateFortressWeapon` | 3376 | 规则（+渲染污染） | `TacticalSim`，删掉 `hpBarBg/hpBarFill` 写入 |
| `startFortressCharge` | 3409 | 渲染 | → `FORTRESS_CHARGE_START` 事件 |
| `fireFortressLaser` | 3478 | **规则**（范围伤害 `u.hp -= 1500`，行 3604）+ 渲染 | 拆：伤害结算 → 规则；光束/爆炸 → 事件 |
| `selectFortressTarget` | 3623 | 规则 | `TacticalSim` |
| `pointToSegmentDist_` / `pointToSegmentDist` | 3699–3708 | 规则 | `TacticalSim`（**注意**：存在两份，一份别名一份实现，是冗余，见 R-13） |
| `checkGameEnd` | 3710 | 规则 | `TacticalSim` |
| `drawCRTBackground` 等 5 个 CRT 委托 | 3783–3826 | 渲染 | 删除 |

### 1.4 `fortressWeapon` 的拆分（混合最深的一个）

现状（BattleScene.ts:93–110）：一个 **规则对象**里混进了 4 个 Phaser 显示对象。

```ts
// 规则域（保留，改名 FortressState，移到 TacticalSim）
export interface FortressState {
  chargeTimer: number;        // ms，累计
  chargeInterval: number;     // 90000
  firstFireDelay: number;     // 50000
  maxRange: number;           // 1200（逻辑像素单位）
  fireAngle: number;          // 0（固定向右，保留现状语义）
  fortressX: number;          // 逻辑 px
  fortressY: number;          // 逻辑 px
  fortressHp: number;         // 10000
  fortressMaxHp: number;      // 10000
  ownerFactionId: number;
  destroyed: boolean;
  isCharging: boolean;
}
// 渲染域（删除）：laserGraphics / chargeGraphics / hpBarBg / hpBarFill
```
HP 条改由渲染层从 `fortressHp / fortressMaxHp` 自行绘制（Vue 或 CSS2D），**不再由规则层持有显示对象**。

### 1.5 `update()` 1341 行的逐段拆解（这是改造的主战场）

| 行段 | 内容 | 域 | 新位置 |
|------|------|----|--------|
| 1969–1985 | 空格键 / `isPaused` 早退 | 宿主 | `TacticalHost`（注意：早退时仍要调用 `renderIntentLines()`，见下） |
| 1987 | `hpBarsGraphics.clear()` | 渲染 | 删除 |
| 1990 | `applyCommandEffects(delta)` | 规则 | `TacticalSim.tick` |
| 1993–1994 | 重建 `factionMap` | 规则 | `TacticalSim.tick` |
| 1997–1999 | `updateCRTEffects` | 渲染 | 删除 |
| 2003–2088 | **塔射击 + 炮弹推进 + 命中扣血 + 护盾涟漪** | **混合** | 弹道/命中/扣血 → 规则；涟漪/闪光 → 事件 |
| 2090–2146 | 死亡过滤、战损账单、对话气泡跟随、全灭判定、慢镜头 | **混合** | 规则部分（扣血/战损/全灭/胜负）→ 规则；气泡坐标/慢镜头 → 事件 + 渲染 |
| 2109–2121 | 对话气泡跟随（读 `cam.zoom` 做逆向缩放） | 渲染 | 删除，改 Vue + 投影回调 |
| 2148–2370 | 视野/迷雾、一骑讨、逆境宣言、目标选择（舰队/地块/塔）、状态机 | **规则** | `TacticalSim.tick`（`this.cameras.main.shake` / `tweens` 调用抽成事件） |
| 2373–2613 | 目标坐标解算：信标 / 撤退补给点 / 交战位 / 包抄 / 探索打分 | **规则** | `TacticalSim.tick` |
| 2615–2623 | 恐慌响应（被看不见的敌人打 → 机动） | 规则 | `TacticalSim.tick` |
| 2625–2690 | 朝向、友军斥力、速度、地形修正、位移 | **规则** | `TacticalSim.tick` |
| 2692–2698 | 阵型克制伤害倍率 | 规则 | `TacticalSim.tick` |
| 2700–2734 | **阵型槽位表** `positions` | **规则** | `TacticalSim`（XZ 分量**逐字保留**；Y 分量新增，见 ADR-002 §3） |
| 2736–2799 | 单位位置 lerp、朝向、尾焰、光环、文字 | **混合** | `pos` lerp → **规则**（射程判定依赖它，见 R-01）；尾焰/光环/文字 → 渲染 |
| 2800–3046 | **开火判定、伤害公式、背刺、暴击、CP 修正、舰载机、导弹、激光、受击后坐力、护盾涟漪、地块轰击与占领** | **规则**（含 F3 舰载机 tween 内扣血） | `TacticalSim.tick`；视觉全部转事件 |
| 3050–3084 | 航母舰载机环绕 | 渲染 | 删除，改 InstancedMesh |
| 3086–3199 | **UI 数据聚合 + 迷雾可见性 + `store.fleetsUI` 赋值 + 地块迷雾着色 + 接壤高亮** | **混合** | 可见性判定 → **规则**；`fleetsUI` 屏幕坐标 → **渲染**（见 ADR-004）；地块着色 → 渲染 |
| 3297–3302 | 要塞武器更新 | 规则 | `TacticalSim.tick` |
| 3304 | `checkGameEnd()` | 规则 | `TacticalSim.tick` |

**关键结论**：`update()` 里**规则域代码约 900 行，渲染域约 440 行**，且两者交错在同一条 `forEach` 链里。这就是必须"先抽规则、再换渲染"而非"边换边抽"的原因。

---

## 2. 五层模型

```
┌──────────────────────────────────────────────────────────────┐
│ L4  Vue UI (Pinia + DOM)                                     │
│     TacticalScreen.vue / CommandPanel / GameHeader / ...      │
└───────────▲──────────────────────────────┬───────────────────┘
            │ 只读 snapshot (10Hz)          │ 用户意图
            │ 屏幕投影 (60Hz, 非响应式)      │ (stance/formation/CP/买地)
            │                               ▼
┌───────────┴──────────────────────────────────────────────────┐
│ L0  TacticalHost  (宿主域)                                     │
│   rAF 主循环 · 定时器 · MicroTween · 输入事件 · 生命周期        │
│   持有 commandBridge · store 桥接 · resize                     │
└───────┬──────────────────────────────────────▲───────────────┘
        │ tick(dtMs, nowMs)                    │ drainEvents()
        ▼                                      │ view
┌───────────────────────────┐          ┌───────┴────────────────┐
│ L1  TacticalSim (规则域)    │  L2 BattleView │ L3 BattleRenderer │
│   纯 TS · 零 DOM · 零 Phaser│ ─────────────► │   Three.js         │
│   零 Three · 可 headless    │  (只读快照)     │   零规则 · 无状态   │
└───────────────────────────┘                 └────────────────────┘
```

**依赖方向（强制）**：
- `L1` 不 import `three` / `phaser` / `vue` / 任何 DOM API。
- `L3` 不 import `L1` 的可变内部状态；只读 `L2`。
- `L3` 对 `L1` 的唯一输出通道是 `TacticalSim.command.*` 与 `L0` 转发。
- `L0` 是唯一同时认识 `L1` 与 `L3` 的层。

**为什么必须这样**：`L1` 零依赖 ⇒ 可以用 esbuild 打进 Node 跑 headless（见 `08-roadmap` §0 验收命令）⇒ golden replay 成立 ⇒ 3827 行拆分有回归网。

---

## 3. 接口签名（最终版，照抄）

### 3.1 L1 `TacticalSim`

```ts
// frontend/src/game/tactical/TacticalSim.ts

export interface BattleSetupConfig {
  mode: 'campaign' | 'skirmish';
  battleNodeId?: number;
  mapStyle: 'hex' | 'crt';          // 仅作为视觉风格透传给渲染层，规则层不使用
  mapId: string;                     // 'random' | 'random_large' | 'random_rect' | 'custom_*' | 默认
  difficulty: 'easy' | 'normal' | 'hard';
  simMode: boolean;
  activeFactionCount: number;
  selectedFactionId: string;
  dispatchAdmirals: number[];
  allAdmirals: any[];
  customMapsData: Record<string, any>;
  attackers: any[];                  // campaign: [{fleetId,factionId,commanderName,imageId,formation,slots}]
  defenders: any[];
  playerAdmiralId: number;
  getTroopById: (id: string) => any; // 从 gameStore 注入，避免规则层依赖 Pinia
  seed: number;                      // ← 必须，见 R-05
}

export type FormationId = 'wedge' | 'line' | 'spindle' | 'circle' | 'square';
export type StanceId = 'search' | 'siege' | 'defend' | 'fallback' | 'stealth';

export type BuyResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_ADJACENT' | 'NOT_NEUTRAL' | 'NO_GOLD' | 'NOT_BUYABLE' | 'NO_PLAYER' };

export class TacticalSim {
  constructor(cfg: BattleSetupConfig);

  /** 纯逻辑推进。nowMs 由宿主传入（取代 this.time.now，见 F5）。 */
  tick(dtMs: number, nowMs: number): void;

  /** 只读快照，引用稳定（同一对象每帧复用，渲染层禁止持有跨帧引用之外的用途）。 */
  readonly view: BattleView;

  /** 取走并清空本 tick 产生的事件。宿主每帧调用一次，转交渲染层。 */
  drainEvents(): BattleEvent[];

  readonly command: {
    setFormation(fleetId: number, form: FormationId): void;
    setStance(fleetId: number, stance: StanceId): void;
    deployFlare(worldX: number, worldY: number): void;   // 逻辑平面坐标(px)
    buyTile(q: number, r: number): BuyResult;
    castBomb(worldX: number, worldY: number): void;      // 逻辑平面坐标(px)
    executeCommandAbility(abilityId: string, targetFleetId: number | null): void;
    endDeployPhase(formation: FormationId, tactic: 'aggressive' | 'encircle' | 'balanced'): void;
  };

  dispose(): void;
}
```

### 3.2 L2 `BattleView`

```ts
// frontend/src/game/tactical/BattleView.ts

/** 地块类型枚举（与 tile.type 字符串一一对应，用数字便于 SoA） */
export const enum TileType {
  Pending = 0, Sea = 1, Ruined = 2, Pier = 3, Planet = 4, Fortress = 5,
  Castle = 6, Tower = 7, Mine = 8, GoldMine = 9, Barracks = 10,
}
export const enum TerrainId { None = 0, Nebula = 1, Asteroid = 2, Gravity = 3, Debris = 4 }
export const enum ShipClass { BB = 0, FBB = 1, CA = 2, DD = 3, CV = 4, FIGHTER = 5, EW = 6, AUX = 7 }

export interface TileView {
  readonly count: number;
  readonly q: Int16Array;
  readonly r: Int16Array;
  readonly ownerId: Int32Array;       // 0 = 中立
  readonly type: Uint8Array;          // TileType
  readonly terrain: Uint8Array;       // TerrainId
  readonly elevation: Float32Array;   // world unit，由渲染层按 art 规格计算后回写，规则层只读语义
  readonly hp: Float32Array;          // 绝对 hp（占领进度）
  readonly hpMax: Float32Array;
  readonly connected: Uint8Array;     // 补给网连通
  readonly explored: Uint8Array;
  readonly visible: Uint8Array;       // 本帧对玩家可见（迷雾）
  readonly highlight: Uint8Array;     // 可购买接壤高亮（0/1）
  /** 拓扑/归属/类型任一变化 → ++。渲染层用它跳过重建。 */
  readonly revision: number;
}

export interface UnitView {
  readonly count: number;             // = 存活单位数（数组按 slot 复用，用 alive 判定）
  readonly capacity: number;          // 数组容量，= 128
  readonly id: Int32Array;            // 稳定 id，渲染层对象池 key
  readonly fleetId: Int32Array;
  readonly factionId: Int32Array;
  readonly classId: Uint8Array;       // ShipClass
  readonly isFlagship: Uint8Array;
  readonly x: Float32Array;           // 逻辑平面 px
  readonly y: Float32Array;           // 逻辑平面 px
  readonly facing: Float32Array;      // 弧度，atan2(dy, dx)（逻辑平面）
  readonly hp: Float32Array;
  readonly hpMax: Float32Array;
  readonly supply01: Float32Array;    // 0..1
  readonly lane: Float32Array;        // world unit，泳道高度（ADR-002 §4）
  readonly formHeight: Float32Array;  // world unit，阵型高度分量（ADR-002 §3）
  readonly moving: Uint8Array;        // 尾焰开关
  readonly visible: Uint8Array;       // 迷雾 / 隐身
  readonly alpha: Float32Array;       // 0.25=隐身己方, 1.0=正常
  readonly alive: Uint8Array;
}

export interface FleetView {
  readonly id: number;
  readonly factionId: number;
  readonly x: number;                 // 逻辑平面 px（舰队锚点）
  readonly y: number;
  readonly facingAngle: number;
  readonly formation: FormationId;
  readonly stance: StanceId;
  readonly state: 'assembling' | 'exploring' | 'engaging' | 'retreating' | 'flaring';
  readonly unitCount: number;
  readonly hpSum: number;
  readonly hpMaxSum: number;
  readonly supply01: number;
  readonly targetFleetId: number | null;   // 意图线用
  readonly targetTileKey: string | null;
  readonly visible: boolean;          // 迷雾：本帧对玩家可见
}

export interface ProjectileView {
  readonly count: number;
  readonly id: Int32Array;
  readonly kind: Uint8Array;          // 0=tower, 1=fortress
  readonly x: Float32Array;
  readonly y: Float32Array;           // 逻辑平面 px
  readonly facing: Float32Array;
  readonly factionId: Int32Array;
}

export interface FortressView {
  readonly x: number; readonly y: number;   // 逻辑平面 px
  readonly hp: number; readonly hpMax: number;
  readonly ownerFactionId: number;
  readonly isCharging: boolean;
  readonly chargeProgress01: number;        // 0..1，充能进度（渲染层画聚能球）
  readonly destroyed: boolean;
}

export interface HudView {
  readonly nowMs: number;
  readonly stage: number;             // P2 阶段 1/2/3
  readonly scriptPhase: 'probe' | 'clash' | 'turn' | 'final';
  readonly deployPhase: boolean;
  readonly losses: { ships: number; pension: number };
  readonly cp: { current: number; max: number; cooldowns: Record<string, number> };
  /** 阵营聚合（渲染层直读，10Hz 同步到 Pinia，见 ADR-004 §3） */
  readonly factions: {
    id: number; name: string; imageId: string; team: number; color: number;
    hp01: number; unitCount: number; gold: number; active: boolean; inVision: boolean;
  }[];
}

export interface BattleView {
  readonly hexRadius: number;         // 逻辑 px
  readonly scale: number;             // S = 1/(√3 · hexRadius)，px → world unit
  readonly originX: number;           // 逻辑平面中心 CX（px），worldX = (x - CX) * S
  readonly originY: number;           // 逻辑平面中心 CY（px）
  readonly tiles: TileView;
  readonly fleets: FleetView[];
  readonly units: UnitView;
  readonly projectiles: ProjectileView;
  readonly fortress: FortressView | null;
  readonly hud: HudView;
  readonly revision: number;          // 任意内容变化 → ++（渲染层做整体脏检查）
}
```

### 3.3 事件（L1 → L3）

**硬约束**：事件只携带**逻辑平面坐标（px）**、**实体 id**、**数值**。禁止出现屏幕坐标、Three 对象、DOM 节点、颜色以外的视觉参数。

```ts
// frontend/src/game/tactical/BattleEvents.ts
export type BattleEvent =
  // —— 战斗 ——
  | { t: 'UNIT_FIRED_LASER';    srcUnitId: number; dstUnitId: number; nowMs: number }
  | { t: 'UNIT_FIRED_MISSILE';  srcUnitId: number; dstUnitId: number; burst: number; nowMs: number }
  | { t: 'UNIT_LAUNCH_FIGHTERS';srcUnitId: number; dstUnitId: number; count: number; nowMs: number }
  | { t: 'UNIT_HIT';            dstUnitId: number; damage: number; crit: boolean; nowMs: number }
  | { t: 'UNIT_DESTROYED';      unitId: number; fleetId: number; factionId: number; x: number; y: number; nowMs: number }
  | { t: 'TILE_SHELL_FIRED';    srcUnitId: number; q: number; r: number; nowMs: number }
  // —— 弹道（F4 升格）——
  | { t: 'PROJECTILE_SPAWNED';  id: number; kind: 0 | 1; factionId: number; x: number; y: number; nowMs: number }
  | { t: 'PROJECTILE_HIT';      id: number; dstUnitId: number; damage: number; nowMs: number }
  // —— 占领 / 领土 ——
  | { t: 'TILE_CAPTURED';       q: number; r: number; factionId: number; nowMs: number }
  | { t: 'PLANET_CAPTURED';     q: number; r: number; factionId: number; nowMs: number }
  | { t: 'CASTLE_FELL';         q: number; r: number; factionId: number; nowMs: number }
  // —— 要塞 ——
  | { t: 'FORTRESS_CHARGE_START'; durationMs: number; nowMs: number }
  | { t: 'FORTRESS_FIRED'; fromX: number; fromY: number; toX: number; toY: number; radius: number; nowMs: number }
  // —— 演出 ——
  | { t: 'DIALOGUE'; fleetId: number; text: string; nowMs: number }
  | { t: 'BANNER';   title: string; subtitle: string; color: string; nowMs: number }
  | { t: 'TOAST';    text: string; nowMs: number }
  | { t: 'SHAKE';    intensity: number; durationMs: number; nowMs: number }
  | { t: 'CP_EFFECT'; casterFleetId: number; effectType: string; nowMs: number }
  | { t: 'FORMATION_CHANGED'; fleetId: number; formation: FormationId; nowMs: number }
  | { t: 'DUEL';      aFleetId: number; bFleetId: number; nowMs: number }
  | { t: 'ADVERSITY'; fleetId: number; nowMs: number }
  | { t: 'STAGE_ADVANCED';  stage: number; nowMs: number }
  | { t: 'SCRIPT_PHASE';    phase: string; nowMs: number }
  | { t: 'REINFORCEMENT';   nowMs: number }
  | { t: 'DEPLOY_UI';       formation: FormationId; tactic: string; nowMs: number }
  // —— 终局 ——
  | { t: 'GAME_OVER'; win: boolean; status: string; nowMs: number }
  | { t: 'CAMPAIGN_RESOLVE'; winnerFactionId: number; survivors: { fleetId: number; remainingSlots: any[] }[]; nowMs: number };
```

**事件里为什么没有"护盾涟漪"**：涟漪是 `UNIT_HIT` 的视觉表现，由渲染层在收到 `UNIT_HIT` 时按 art 规格（`docs/art/3d-tactical-battle/signature-effects.md` 的 rx/ry/span 基准值）自行生成。规则层只说"谁挨了多少伤害"。

### 3.4 L3 `BattleRenderer`

```ts
// frontend/src/game/three/ThreeTacticalBattle.ts
export interface ThreeTacticalBattleOptions {
  /** 舰队浮标屏幕投影（每帧，非响应式；对齐 ThreeStrategicMap.onHoloBoardAnchor） */
  onFleetHudAnchor?: (
    fleetId: number,
    screen: { x: number; y: number; rotX: number; rotY: number; visible: boolean; z: number; scale: number },
  ) => void;
  /** 拾取结果 */
  onPickUnit?: (unitId: number, button: 0 | 2, clientX: number, clientY: number) => void;
  onPickTile?: (q: number, r: number, button: 0 | 2, clientX: number, clientY: number) => void;
  onPickNothing?: (button: 0 | 2, clientX: number, clientY: number) => void;
  /** 相机状态（暂停/小地图用） */
  onCameraInfo?: (info: { distance: number; polar: number; azimuth: number; targetX: number; targetZ: number }) => void;
  /** 视觉风格（Q3：'crt' 时启用扫描线/暗角后处理与全息材质） */
  mapStyle?: 'hex' | 'crt';
  /** 开发期影子对照开关，Phase 5 前删除 */
  enableIntentLines?: boolean;
}

export class ThreeTacticalBattle {
  constructor(container: HTMLElement, opts?: ThreeTacticalBattleOptions);

  /** 首帧构建：棋盘 InstancedMesh、对象池、后处理管线。只在 view.tiles.revision 变化时重建棋盘。 */
  build(view: BattleView): void;

  /** 每帧同步：写 instanceMatrix / 更新 VFX 时间线 / 渲染。view 只读。 */
  sync(view: BattleView, events: BattleEvent[], dtMs: number, nowMs: number): void;

  /** 命令面板"选目标"模式：true 时禁用地块拾取、仅舰船可点（Q1） */
  setTargetingMode(on: boolean): void;

  /** 由宿主转发（Phaser 的 cameras.main.shake 等价物） */
  shake(intensity: number, durationMs: number): void;

  /** 逻辑平面 px → 屏幕 px；供 Vue 层定位一次性（非每帧）UI */
  projectLogic(x: number, y: number, height?: number): { x: number; y: number; visible: boolean };

  setPaused(paused: boolean): void;
  resize(): void;
  destroy(): void;
}
```

### 3.5 L0 `TacticalHost`

```ts
// frontend/src/game/tactical/TacticalHost.ts
export class TacticalHost {
  /** 取代 GameInstance.mountGame('phaser-canvas-container') */
  mount(container: HTMLElement, cfg: BattleSetupConfig): void;
  unmount(): void;

  /** 取代 store.setPhaserCommandDispatcher 的注册点 */
  private onFleetCommand(id: number, type: string, payload: any): void;

  /** 速度档位（App.vue Digit1-5 → store.currentSpeedFactor） */
  setSpeedFactor(f: number): void;
}
```

**职责边界**：
- 每帧：`dtMs = min(rawDt, 100)`（`100ms` 上限，防止切标签页回来后一帧跑完整场战斗；现状无此保护，属**新增但必要**的健壮性改动，不影响正常帧）。
- `sim.tick(dtMs * speedFactor, nowMs)` → `view`。
- `renderer.sync(view, sim.drainEvents(), dtMs, nowMs)`。
- `renderer` 的拾取回调 → `sim.command.*`。
- 空格键 → `commandBridge`（保持现状流程）。
- 每秒定时器 → `sim.tickEconomy()`（现状 `this.time.addEvent({delay:1000, loop:true})`，行 293）。

---

## 4. 每帧时序（ASCII）

```
[rAF]
  │
  ├─ dtMs = clamp(now - last, 0, 100)
  ├─ nowMs += dtMs                       ← 取代 this.time.now
  │
  ├─ MicroTween.update(dtMs)             ← 实时推进，不受 isPaused 影响（F5）
  │
  ├─ if (!store.isPaused && !store.gameOver)
  │     sim.tick(dtMs * speedFactor, nowMs)
  │       ├─ 空暂停检查 / CP 效果
  │       ├─ 重建 factionMap
  │       ├─ 塔射击 + 弹道推进 + 命中扣血
  │       ├─ 死亡过滤 + 战损累计 + 胜负判定
  │       ├─ [每舰队] 视野 → 目标选择 → 状态机 → 目标坐标 → 位移 → 阵型 → 开火 → 伤害
  │       ├─ [每舰队] 舰载机(规则部分)
  │       ├─ 迷雾可见性 + HUD 聚合
  │       ├─ 要塞 + checkGameEnd
  │       └─ events.push(...)
  │
  ├─ events = sim.drainEvents()
  ├─ host 消费规则性事件：TOAST / BANNER / DIALOGUE / GAME_OVER / CAMPAIGN_RESOLVE / SHAKE
  │      → store.triggerToast / addBattleLog / commandBridge / renderer.shake()
  │
  ├─ renderer.sync(view, events, dtMs, nowMs)
  │     ├─ if (view.tiles.revision !== lastRevision) rebuildBoardInstances()
  │     ├─ 写 units / projectiles 的 instanceMatrix
  │     ├─ 事件 → VFX 时间线（激光/导弹/涟漪/爆炸/伤害数字/尾焰）
  │     ├─ controls.update() → 相机 → shake offset
  │     ├─ composer.render()
  │     └─ 投影舰队锚点 → opts.onFleetHudAnchor(fleetId, screen)
  │
  └─ [10Hz 节流] store.fleetsUI / factions 聚合值同步（ADR-004 §3）
```

---

## 5. 新目录结构

```
frontend/src/game/tactical/                 ← 新增，规则域 + 宿主域
├── TacticalSim.ts              ~900 行   规则域主体（从 BattleScene 迁入，逻辑逐字保留）
├── BattleView.ts               ~180 行   快照类型 + SoA 分配器
├── BattleEvents.ts             ~90 行    事件类型
├── TacticalHost.ts             ~220 行   帧循环 / 输入 / 定时器 / store 桥接 / commandBridge
├── rng.ts                      ~20 行    mulberry32（复用 ThreeStrategicMap.ts:30 的实现）
├── mathx.ts                    ~30 行    hypot / randInt / clamp / pointToSegmentDist（替 Phaser.Math）
├── MicroTween.ts               ~180 行   补间引擎（替 this.tweens）
├── economy.ts                  ~120 行   每秒结算 tick（从 create() 行 293–488 迁入）
├── ai/
│   ├── fleetBrain.ts           ~380 行   目标选择 / 状态机 / 探索打分（update 行 2148–2613）
│   ├── combat.ts               ~300 行   开火判定 + 伤害公式（update 行 2800–3046）
│   └── supply.ts               ~180 行   BFS 补给网 + 占领（731–890）
├── board/
│   ├── mapBuilder.ts           ~160 行   buildMapData / buildCampaignMap / buildCampaignEnvironment 的数据部分
│   └── terrain.ts              ~60 行    getTerrainAt + 三个修正倍率
├── fortress.ts                 ~180 行   要塞状态机 + 目标选择 + 范围伤害
└── setups.ts                   ~200 行   initFactions / scaleMapForFleetCount / spawn*Fleets 的数据部分

frontend/src/game/three/                    ← 新增，渲染域
├── ThreeTacticalBattle.ts      ~700 行   场景 / 相机 / 拾取 / 主同步（对齐 ThreeStrategicMap 结构）
├── tactical/
│   ├── boardMesh.ts            ~260 行   棋盘 InstancedMesh + 高度/颜色/描边 shader
│   ├── shipMesh.ts             ~320 行   舰船 InstancedMesh（按 faction×class 合批）+ 尾焰 + 光环
│   ├── fxPool.ts               ~380 行   激光 / 导弹 / 涟漪 / 爆炸 / 舰载机 / 伤害数字
│   ├── intentLines.ts          ~90 行    意图线（暂停时）
│   ├── cameraRig.ts            ~160 行   OrbitControls 配置 + CameraShaker + 初值公式
│   └── postfx.ts               ~120 行   Bloom + CRT ShaderPass（从 ThreeStrategicMap.ts:405-445 移植）
└── config/
    └── tacticalVisual.ts       ~80 行   CRT_BG/CRT_GRID_COLOR/CRT_ACCENT + 高度表 + 泳道表

frontend/src/components/battle/
├── TacticalScreen.vue          ~260 行   新增：3D 容器 + 舰队浮标层（对齐 StrategicScreen.vue）
└── （CommandPanel / GameHeader / GameFooter / BattleLogPanel / SettlementModal 保持不动）

frontend/src/game/scenes/
├── BattleScene.ts              → 删除（3827 行）
└── crt/CrtRenderer.ts          → 删除（546 行）；常量迁入 tacticalVisual.ts
```

**净行数预估**：规则域 ~3600 行（比原来的规则部分略多，因为拆分增加接口与类型）、渲染域 ~2100 行、宿主 ~220 行。删除 ~4400 行（原 BattleScene + CrtRenderer + Phaser 相关）。

---

## 6. 旧方法 → 新位置 速查表

| 旧符号 | 新符号 |
|--------|--------|
| `BattleScene.create()` | `TacticalHost.mount()` |
| `BattleScene.update(t, d)` | `TacticalHost.#frame()` → `TacticalSim.tick()` + `ThreeTacticalBattle.sync()` |
| `this.store.fleetsUI = uiData` | `ThreeTacticalBattle.onFleetHudAnchor` + 10Hz 逻辑同步 |
| `this.cameras.main.shake(ms, i)` | `BattleEvent.SHAKE` → `ThreeTacticalBattle.shake()` |
| `this.tweens.add({...})` | `MicroTween.add({...})`（渲染层） |
| `this.time.delayedCall(ms, fn)` | `MicroTween.delay(ms, fn)` |
| `this.time.now` | 宿主 `nowMs` 参数 |
| `this.add.circle/rectangle/graphics/text` | `fxPool` / `boardMesh` / Vue |
| `u.sprite.x` / `u.sprite.y` | `unit.x` / `unit.y`（`UnitView.x/y`，规则层权威） |
| `Phaser.Math.Distance.Between` | `mathx.hypot`（同一实现） |
| `Phaser.Math.Between` | `mathx.randInt` |
| `this.input.on('pointermove'/'wheel')` | `cameraRig` 内的 DOM 事件 |
| `this.input.keyboard!.on('keydown')` | `TacticalHost` 的 `window.addEventListener('keydown')` |
| `handleTileClick` | `onPickTile` → `TacticalSim.command.buyTile / deployFlare` |
| `mapStyle === 'crt'`（26 处） | `tacticalVisual.ts` 的视觉配置 + `postfx` 开关（规则层 0 处） |

---

## 7. 拆分的执行顺序（为什么是这个顺序）

1. **先抽规则，不改渲染。** Phase 0–2 期间画面仍是 2D 线框，但 `BattleScene` 已变成"薄壳 + 规则层 + 2D 渲染适配器"。
2. **再换渲染，不动规则。** Phase 3 起 `BattleRenderer` 从 2D 适配器换成 Three。
3. **最后删壳。** Phase 5 删除 `BattleScene.ts` / `CrtRenderer.ts` / `GameInstance.ts` 的 Phaser 部分。

理由：如果先换渲染再抽规则，任何一次画面 bug 都无法判断是"渲染写错了"还是"规则改坏了"。顺序错 ⇒ 回归无法定位。
