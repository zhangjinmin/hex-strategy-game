# 指挥制战术层设计规格 v1

> 用户决策（2026-09-02）：新增指挥制模式（command），与 hex/crt/3d 并列，保留现有模式，设置界面加选项，默认指挥制。
> 用户定位：业余项目，目标是"改完能正常玩"。实施原则：能玩优先，分阶段交付。

## 一、已核实的代码事实（改造基础）

### 模式切换管道（现成，直接复用）
- `frontend/src/store/settingsStore.ts:19` → `const battlefieldMode = ref<'hex'|'crt'|'3d'>('hex')`
  改默认值 → `ref<'hex'|'crt'|'3d'|'command'>('command')`
- `frontend/src/components/meta/BattleSetupPanel.vue:63` → `<select v-model="mapStyle">`，加一个 option 即可
- `frontend/src/game/scenes/BattleScene.ts:88` → `private mapStyle: 'hex'|'crt'|'3d' = 'hex'`
- `frontend/src/store/gameStore.ts:648` → `launchSimBattle(mapStyle)` 已参数化
- `frontend/src/store/gameStore.ts:613` → `mapStyle?: 'hex'|'crt'|'3d'`

### 舰队对象（天生连续空间，指挥制的天然基础）
```
BattleScene.ts:612-620 构造：
  id, displayId, factionId, target, state('idle'),
  units[], formation('wedge'), facingAngle(0 或 PI),
  stance('search'), lastState, halfHpTriggered,
  x: spawnX, y: spawnY        ← 连续坐标，非格子
  unit: { sprite, factionId, hp, maxHp, atk, def, range,
          classType, atkInterval, speed, lastAtkTime,
          state, supply, gridX, gridY }
```
结论：舰队已是连续 x/y + facingAngle，六边形只是叠加的约束层。
指挥制 = 解除格子约束，而非重写坐标系统。

### 可 100% 复用的战斗内核（不要动）
- AI 战术层 `BattleScene.ts:2702-2731`（距离保持/包抄/聚焦火力/撤退重组）
- CP 指挥点系统（6 通用 + 5 提督专属）
- 士气、阵型（`config/formations.ts` 5 阵型互克环）
- 战斗结算
- 战役阶段推进 `BattleScene.ts:484`（试探→缠斗→转折→决战）
- 指挥带宽 `services/CommandBandwidthSystem.ts`（165行，与补给链同构概念）

### 现有补给机制（迁移，非删除）
- `updateSupplyNetwork()` `:745-786` 图连通性传播，标记 connected
- 补给判定 `:802-832`：己方格子 && connected → +5/次；否则 drainRate 流失
- 归零后每秒扣最大生命值结构伤害 `:831-832`
- 斩链判定 `:1408` 敌方连通格子数下降 >40%

## 二、用户四个决策（硬约束）

### 决策1 补给线 = 方案C混合（距离场 + 移动中继）
- 补给基地：地图边缘己方抽象基地，补给源根节点
- AUX补给舰：有航速，需飞行时间抵达前线。"太空中要做补给舰的效果，否则后勤战就是空的"
  → 必须有可见航行轨迹、对接补给表现、被击毁特效
- 星球中继：随机散落少量星球，扩大补给范围
- 链路图结构：基地 → 星球中继 → AUX → 舰队。打掉任一中间节点即断链
- AUX 可被击毁

### 决策2 断粮惩罚：先掉士气，再掉生命值
- 初版减弱强度，实机后再调（drainRate 与结构伤害系数均调低）

### 决策3 斩链玩法必须保留
- 用户："战术部分后勤战是个非常有趣的玩法"
- 必须让战役"破网→斩链→拔旗"三阶段成立

### 决策4 参考旧案战术资产
来源：`docs/design/银英旧案单机化梳理与融合方案.md`（2012 银英WEB多人SLG未成型稿）
可借鉴：11种战场地形、6舰种参数、4类武器+射角、战术流程、旗舰击破→阵型崩溃
剔除（多人专属）：联名/悬赏提案、好友婚恋、防小号、抽卡付费

## 三、视觉要求
- CRT 扫描线风格（舰队 + 宇宙）
- 宇宙：随机线条组成的高低起伏线条，扫描线风格
- 纯宇宙，无六边形格子
- 复用 `game/scenes/crt/CrtRenderer.ts`（546行）与 `BattleScene.ts:50-86` CRT 参数

## 四、待用户拍板项
### 指挥权限范围（影响实现方向）
- 选项A 全控（单机推荐）：所有己方舰队可直接下令，操作直接，后勤战可玩性最高
- 选项B 指挥官视角（旧案3.6）：只能直接下令旗舰所在舰队，其余AI副官执行。更沉浸但单机可能束手束脚
