# 舰队后勤体系 PRD —— 库存 / 退役 / 运输 / 兵工厂 / 战斗机归航母

> 日期：2026-08-25
> 前置依据：`舰队管理系统修复与完善计划.md` 复盘 + 四次设计拍板
> 定位：把舰队管理从"编成面板"升级为"后勤战略层"，复刻杨威利/比克古游击战

---

## 一、Fun Hypothesis 与 Design Pillars

**Fun Hypothesis**：这游戏好玩的核心是——玩家在「在哪造、造什么、怎么运到前线、囤多少」这几个后勤决策里，用更少的钱维持更长的战线，最终用后勤优势拖垮对手。

**Design Pillars（不可妥协）**：
1. **后勤即战略**：每个后勤决策（造/存/运/退）都必须产生一个"玩家此刻在权衡什么"的决策点，禁止无脑操作。
2. **权力受限**：玩家只能支配直属舰队的舰船与库存，不能动 AI 提督的资源。你是个提督，不是军务部长。
3. **就地取材**：高工业力星球才能支撑兵工厂，玩家要抢/保高工业星球才能打游击。
4. **经济闭环**：新增的每个 sink（停泊费、运输费、兵工厂）都要有来源和出口，禁止制造"钱没处花"或"钱花不完"。

---

## 二、系统总览（后勤链）

```
兵工厂(星球) → 建造 → 星球库存 → 运输(护航) → 前线星球库存 → 编入舰队
                                      ↑
                            退役退款 ← ┘ (永久裁撤，返 50% 造价，不进库存)
```

四个子系统按依赖顺序：**退役退款/战斗机归航母 → 星球库存 → 兵工厂 → 运输**。后三者有严格依赖，不可并行。

---

## 三、数据结构设计（基于真实代码，字段 + rationale）

### 3.1 新增 `FleetInventory`（星球库存）

```typescript
// types/game.ts
export interface FleetInventory {
  battleships: number;
  fastBattleships: number;
  cruisers: number;
  destroyers: number;
  carriers: number;
  // 无 fighters：战斗机归航母，不独立库存
}
```

**rationale**：库存是"停泊在星球船坞、未编入任何舰队"的舰船。字段名与 `FleetComposition` 对齐（除 fighters），保证 `shipTypeToCompKey` 可直接复用。

### 3.2 `StarNode` 加库存字段

```typescript
// types/game.ts - StarNode 接口新增
fleetInventory: FleetInventory;  // 该星球停泊的未编入舰船库存
```

**rationale**：库存挂在星球而非舰队，天然实现"行星级库存"——A 星球减少的船进 A 星球库存，其他星球舰队要动用必须回到 A 星球。这与现有 `buildShips` 要求"停靠首都/要塞"的逻辑一致（跃迁途中 `currentNodeId < 0` 时不能调编成）。

### 3.3 删除 fighter（战斗机归航母，方案 A）

波及 11 处（必须全部同步删除，否则类型报错）：

| 位置 | 删除内容 |
|---|---|
| `FleetComposition` | `fighters: number` 字段 |
| `FleetInventory` | 同上 |
| `totalShips` | `+ comp.fighters` |
| `totalPowerWeight` | `+ comp.fighters * 0.3` |
| `EMPTY_COMPOSITION` | `fighters: 0` |
| `SHIP_TYPES` | fighter 条目 |
| `SHIP_COST` / `SHIP_MAINTENANCE` / `SHIP_CREW` | fighter 条目 |
| `FleetHQPanel.shipTypes` | fighters 行 |
| `FleetHQPanel.compKeyToShipType` | fighters 映射 |
| `fleetStore.shipTypeToCompKey` | fighter 映射 |
| `getTacticalDeployment` | fighter 分支 |

**替代设计**：每艘航母自带 100 舰载机，含在航母造价内，不单独管理、不单独损耗。航母战术属性中舰载机贡献已并入 `SHIP_TYPES` 的 atk（见 3.5）。

### 3.4 兵工厂复用 `shipyardLevel`

`StarNode.shipyardLevel` 已存在（首都 5 级、资源星 1 级、empty 0 级），**直接复用为兵工厂等级**，不新增字段。

- `shipyardLevel = 0`：无兵工厂，不能建造
- `shipyardLevel ≥ 1`：可建造基础舰种（驱逐/巡洋）
- `shipyardLevel ≥ 3`：可建造战列/航母

**rationale**：复用现有字段避免存档迁移风险；等级门槛让"抢高等级兵工厂星球"成为战略目标。

### 3.5 舰载机战术属性并入航母（方案 A 落地）

```typescript
// getTacticalDeployment 的 carrier 分支
if (shipType === 'carrier') {
  const fighterContribution = assignedCount * 100; // 每航母自带 100 舰载机
  return {
    ...,
    atk: (baseStats.atk + fighterContribution * 0.006) * Math.sqrt(assignedCount), // 舰载机提升航母火力
    ...
  };
}
```

**rationale**：不新增 fighter 实体，舰载机是航母的"火力附加值"，用系数并入 atk。系数 `0.006` 使满编航母火力 ≈ 原"航母+独立战斗机"之和，保持战力不变。`[PLACEHOLDER]` 待 playtest 平衡。

---

## 四、经济变量表（数值 + rationale）

| 变量 | 公式/值 | rationale | 状态 |
|---|---|---|---|
| **停泊费** | `SHIP_MAINTENANCE × 50%` | 低于编入舰队维护费（否则没人敢囤），高于 0（否则无限囤） | 已拍板 |
| battleship 停泊 | 3 金/艘/日 | 维护费 6 × 0.5 | 派生 |
| fastBattleship 停泊 | 2.75 金/艘/日 | 维护费 5.5 × 0.5 | 派生 |
| cruiser 停泊 | 1 金/艘/日 | 维护费 2 × 0.5 | 派生 |
| destroyer 停泊 | 0.5 金/艘/日 | 维护费 1 × 0.5 | 派生 |
| carrier 停泊 | 3.5 金/艘/日 | 维护费 7 × 0.5 | 派生 |
| **退役退款** | `SHIP_COST × 50%` | 返部分造价让国库喘口气，但低于造价避免"造退套利" | 已拍板 |
| battleship 退款 | 400 金/艘 | 造价 800 × 0.5 | 派生 |
| carrier 退款 | 600 金/艘 | 造价 1200 × 0.5 | 派生 |
| **库存容量** | `shipyardLevel × 2000` 吨位 | 硬上限，维护费管不住有钱人 | [PLACEHOLDER] |
| 吨位权重 | 战列 1 / 驱逐 0.3 / 航母 2 | 引导别全囤主力舰 | [PLACEHOLDER] |
| **战斗损耗回收** | 战损 × 30% 进所在星球库存 | 缓解挫败 + 战争有成本 | 已拍板 |
| **运输被劫概率** | 基础 25%，随航线治安降低 | 无护航运输是移动钱包 | [PLACEHOLDER] |
| **兵工厂建设消耗** | 钱 + 该星球 economy 值 | 不是有钱就能秒建，工业力是硬约束 | [PLACEHOLDER] |

---

## 五、Sources / Sinks 闭环

| 类型 | 项目 | 新增 | 量级 |
|---|---|---|---|
| Source | 税收 / 贸易 / 事件奖励 | 无 | — |
| Sink | 造船（建造订单） | 无 | 满编 44万/日 |
| Sink | 舰船维护（编入舰队） | 无 | — |
| Sink | **停泊费**（库存） | ✅ | 维护费 × 50% |
| Sink | **运输费**（跃迁燃料+护航） | ✅ | [PLACEHOLDER] |
| Sink | **兵工厂建设**（钱+工业力） | ✅ | [PLACEHOLDER] |
| Sink | 提督工资/抚恤/修理 | 无 | — |

**关键平衡风险**：退役退款是唯一"把钱放回 source"的逆向口。若退款比例过高，玩家可"造了退、退了造"套利。50% 已留出 50% 损耗，但需在 playtest 确认无套利空间。

---

## 六、权力边界（本游戏命根子）

- 玩家直属舰队减少的船 → 进**玩家当前驻扎星球**库存，玩家可支配
- AI 提督舰队减少的船 → 进**各自**驻扎星球库存，玩家不可见、不可动
- 实现：AI 提督舰队默认不触发库存操作（`adjustShips` 只在 `canEdit` 为 true 时可用，AI 无编辑权）

**rationale**：符合"玩家是提督不是军务部长"的设定，且为未来"请求调拨友军舰船"外交玩法留接口。

---

## 七、存档迁移方案

1. 旧存档 `composition.fighters` 字段：读档时**自动清零**（战斗机已归航母，旧数据无意义），不影响其他字段。
2. 新字段 `StarNode.fleetInventory`：旧存档缺失时自动初始化 `{ battleships: 0, ... }`。
3. `getTacticalDeployment` 已兼容旧 `tacticalSlots`（字符串数组跳过逻辑保留）。

---

## 八、实现优先级与验收标准

### 阶段 0：退役退款 + 战斗机归航母（低风险，先行）

- [ ] 退役操作返 50% 造价，进国库，不进库存
- [ ] 战斗机从 11 处删除，航母行显示"搭载舰载机 ×100"
- [ ] 航母战术属性包含舰载机贡献，满编战力与改动前持平

### 阶段 1：星球库存（后续系统地基）

- [ ] 星球显示库存，舰队减少船进所在星球库存
- [ ] 舰队增加船优先从所在星球库存取，不足才建造
- [ ] 库存有容量上限（船坞等级 × 2000 吨位），超限提示
- [ ] 停泊费每日结算，进财政账本
- [ ] 权力边界：AI 提督库存玩家不可见

### 阶段 2：兵工厂

- [ ] shipyardLevel 0 的星球不能建造，≥3 才能造战列/航母
- [ ] 建设/升级兵工厂消耗钱 + economy

### 阶段 3：运输

- [ ] 库存舰船可装船运输到其他星球
- [ ] 运输需护航，无护航有被劫概率

---

## 九、残留 [PLACEHOLDER] 与验证路径

| 参数 | 待验证问题 | 验证方式 |
|---|---|---|
| 库存容量 2000 吨位/级 | 是否限制住囤船？ | 观察玩家是否因容量被迫决策"造还是运" |
| 吨位权重 | 驱逐 0.3 是否导致玩家全囤驱逐？ | 统计库存舰种分布 |
| 停泊费 50% | 玩家是否愿意为战略灵活性付停泊费？ | 观察是否有人长期空库存（说明停泊费太高） |
| 舰载机系数 0.006 | 航母是否过强/过弱？ | 战术 playtest 对比改动前后航母战力 |
| 被劫概率 25% | 运输是否太危险/太安全？ | 统计运输被劫率与玩家护航意愿 |
