# 增量 PRD：军议重构 + 行政系统 + 职位职权完善 + 舰队归属小说设定修正

> **项目**: 银河英雄传说 策略游戏 (hex-strategy-game)
> **技术栈**: Vue 3 + Phaser + Pinia + TypeScript
> **版本**: v2.0（增量）
> **日期**: 2025-07
> **前置文档**: `PRD_人物标签体系与职位数据结构改造.md`（标签体系已完成交付）

---

## 1. 产品目标

| # | 目标 | 度量标准 |
|---|------|---------|
| G-1 | **军议非侵入式重构**：消除每月1号强制弹窗，改为顶部菜单按钮+红点提醒的主动访问模式；提案从4条扩展至12条，每条提案通过/否决均产生实际战略影响 | 玩家可忽略军议继续游戏；12条提案全部有游戏系统耦合效果 |
| G-2 | **行政系统落地**：建立财政/人事/科技/民生/外交/情报六大行政模块，与职位职权挂钩，每日结算 | 6模块均有数据结构+结算逻辑+UI面板 |
| G-3 | **职位职权逻辑化**：将职权矩阵从数据结构定义升级为运行时约束逻辑——谁能提案什么、谁能下令调动哪些舰队、权限不足时如何拒绝 | `RolePermissions` 扩展至12提案类型；舰队调动权限校验上线 |
| G-4 | **舰队归属按小说设定修正**：帝国舰队司令按原著派系逐人归类至莱因哈特/谬肯贝尔加麾下，不再按 fleetNumber 粗暴分割 | 米达麦亚等9人归莱因哈特；艾齐纳哈等8人归谬肯贝尔加 |

---

## 2. 用户故事

| # | 角色 | 故事 | 价值 |
|---|------|------|------|
| US-1 | 玩家 | 作为玩家，我希望军议不再每月强制弹出打断我的战略节奏，而是像收件箱一样我可以随时打开查看和处理，这样我能掌控自己的游戏节奏 | 流畅体验 |
| US-2 | 玩家 | 作为玩家，我希望军议提案有真实的战略影响——比如征兵提案通过后真能增加兵源、侵攻提案通过后舰队获得 Warp 速度加成，而不是只加减金锭 | 策略深度 |
| US-3 | 玩家 | 作为玩家，我希望提案被否决也有后果——比如申请军费被否决会导致舰队维护费不足、士气下降，这样每次投票都有紧张感 | 决策张力 |
| US-4 | 玩家 | 作为帝国玩家，我希望能通过行政面板管理税收、任免提督、研发科技，而且这些操作受我的职位职权约束——比如我当军务尚书才能管军费，当统帅本部总长才能调动舰队 | 角色扮演 |
| US-5 | 玩家 | 作为玩家，我希望莱因哈特麾下的提督（米达麦亚、罗严塔尔等）真的归莱因哈特指挥，而不是被系统错误地分到谬肯贝尔加下面，这样能还原原著的派系格局 | 原著还原 |
| US-6 | 玩家 | 作为玩家，我希望防卫司令官不只是个头衔——他驻守的星系应该真的获得防御加成和治安维护效果，这样委任防卫司令才有意义 | 系统完整性 |
| US-7 | 玩家 | 作为玩家，我希望提案类型丰富到能覆盖战略层面——不只是预算和征兵，还有情报战、外交施压、科技动员、后勤改革等，这样军议是战略工具而非形式 | 策略工具 |
| US-8 | 玩家 | 作为玩家，我希望军议和行政面板能同时存在于顶部菜单，我可以在它们之间自由切换而不互相干扰，就像同时打开多个政府职能部门 | 多任务管理 |

---

## 3. 需求池

### P0 — Must Have

| ID | 需求 | 说明 |
|----|------|------|
| P0-1 | 军议非侵入式 UI | 移除 `strategicTick` 中每月1号 `triggerCouncilMeeting()` 强制暂停+弹窗逻辑；改为顶部菜单「军议」按钮+红点提醒（有待处理提案时显示）；点击后侧滑面板展开（非居中模态），不暂停战略时钟 |
| P0-2 | 12 条提案完整定义 | 定义 12 条提案（详见第 4 节），每条含：名称、类型、效果、否决后果、风险、所需职位权限、游戏耦合点；扩展 `ProposalType` 联合类型 |
| P0-3 | 提案效果执行引擎 | 新增 `executeProposalEffect(proposal)` 函数，提案通过后实际修改游戏状态（舰队属性、经济值、科技等级等），替代现有 CouncilPanel.vue 中仅加减 `metaGold` 的逻辑 |
| P0-4 | 军议月度自动提案生成 | 每月1号由系统根据当前局势自动生成 3-5 条待处理提案（而非强制弹窗），玩家可在军议面板中逐一处理；未处理的提案累积，红点数字递增 |
| P0-5 | 财政模块 | 税收（基础税+战争税）/ 军费（舰队维护费）/ 国库盈亏的每日结算；`processDailyEconomy()` 扩展 |
| P0-6 | 人事模块 | 提督任免/晋升/忠诚度系统；忠诚度受标签（`righteous`/`opportunist`/`ambition_faction`）和派系冲突影响 |
| P0-7 | 职权约束逻辑 | `RolePermissions` 从 6 类型扩展至 12 提案类型；新增舰队调动权限校验 `canCommandFleet(admiral, fleet)` |
| P0-8 | 舰队归属小说设定修正 | `initFleetAssignment` 改为按 admiral ID 硬编码映射表分类，不再按 fleetNumber 粗暴分割 |

### P1 — Should Have

| ID | 需求 | 说明 |
|----|------|------|
| P1-1 | 提案否决后果执行 | 提案被否决后执行否决后果（如军费申请被否→维护费扣减不足→舰队士气下降） |
| P1-2 | 科技模块 | 舰船技术等级（武器/装甲/引擎/电子战），影响战术战斗参数；每日研发进度推进 |
| P1-3 | 民生模块 | 治安度/开发度，影响税收效率和随机事件触发率 |
| P1-4 | 防卫司令官效果实现 | `defense_commander` 驻守节点获得：防御 HP +50%、治安 +10/日、补给恢复 ×2 |
| P1-5 | 职位适配度影响行政效率 | 提督担任非适配职位时，相关行政效率 ×0.7；适配职位 ×1.3（基于 `AbilityTag`） |
| P1-6 | 军议历史记录 | 保留最近 20 条提案记录，可在军议面板中翻阅 |

### P2 — Nice to Have

| ID | 需求 | 说明 |
|----|------|------|
| P2-1 | 外交模块 | 与中立势力/第三阵营的外交关系管理（宣战/媾和/贸易协定） |
| P2-2 | 情报模块 | 情报等级影响敌方舰队信息可见度（低情报→只看到大致兵力，高情报→看到详细编制和移动意图） |
| P2-3 | 提案辩论动画 | 提案投票时的动画演出（提督立绘+发言气泡） |
| P2-4 | 行政面板数据可视化 | 财政收支图表、科技树进度图 |

---

## 4. 军议 12 条提案完整定义

### 4.1 提案类型扩展

```typescript
// types/game.ts — ProposalType 扩展
export type ProposalType =
  // === 原有 6 类 ===
  | 'invasion'        // 战略侵攻
  | 'defense'         // 星域防卫
  | 'budget'          // 特别军费
  | 'personnel'       // 人事任免
  | 'tax'             // 临时加税
  | 'conscription'    // 扩大征兵
  // === 新增 6 类 ===
  | 'logistics'       // 后勤改革
  | 'tech_mobilize'   // 科技动员
  | 'intel_op'        // 情报行动
  | 'diplomat_op'     // 外交施压
  | 'morale_boost'    // 士气鼓舞
  | 'fortify'         // 要塞强化;
```

### 4.2 提案完整定义表

#### 提案 1：战略侵攻动员

| 字段 | 内容 |
|------|------|
| **名称** | 战略侵攻动员 |
| **类型** | `invasion` |
| **提案效果** | 通过后：全阵营舰队 Warp 速度 +30%（持续 15 天）；进攻方舰队士气 +20 |
| **否决后果** | 无直接后果，但若连续 2 个月被否决，主战派标签提督忠诚度 -10 |
| **风险** | 侵攻期间后勤消耗 ×1.5；和平派提督忠诚度 -5 |
| **所需职位权限** | `emperor`, `high_command_chief`, `joint_ops_chief`, `space_fleet_commander`, `space_fleet_deputy` |
| **游戏耦合点** | `strategicTick` 中 `fleet.moveProgress` 计算读取 `warpSpeedBuff`；`fleet.morale` 修正 |

#### 提案 2：星域防卫令

| 字段 | 内容 |
|------|------|
| **名称** | 星域防卫令 |
| **类型** | `defense` |
| **提案效果** | 通过后：指定星域（提案时可选择目标节点）防御 HP +100%（持续 30 天）；防卫司令官辖区内舰队补给消耗 -50% |
| **否决后果** | 无直接后果，但该星域下次被攻击时无防御加成 |
| **风险** | 防卫令消耗国库 ₮2000 |
| **所需职位权限** | `emperor`, `high_command_chief`, `joint_ops_chief`, `intel_minister`, `defense_commander` |
| **游戏耦合点** | `StarNode.defenseHp` 临时 buff；`fleet.supply` 消耗修正 |

#### 提案 3：申请特别军费

| 字段 | 内容 |
|------|------|
| **名称** | 申请特别军费 |
| **类型** | `budget` |
| **提案效果** | 通过后：国库 +₮5000 |
| **否决后果** | 本月舰队维护费从国库强制扣减（若国库不足，每支舰队士气 -5/日） |
| **风险** | 频繁申请（连续 3 个月）触发「财政浪费」弹劾事件，行政功勋 -200 |
| **所需职位权限** | `emperor`, `prime_minister`, `council`, `military_minister` |
| **游戏耦合点** | `metaGold` 修改；`fleet.morale` 联动 |

#### 提案 4：人事任免

| 字段 | 内容 |
|------|------|
| **名称** | 人事任免令 |
| **类型** | `personnel` |
| **提案效果** | 通过后：可任免一名提督的职位（晋升/降职/调任）；被任免提督的忠诚度受标签影响（`righteous` +10，`ambition_faction` -15） |
| **否决后果** | 该提督维持原职；若提案人是改革派且被保守派否决，改革派提督忠诚度 +5（同仇敌忾） |
| **风险** | 频繁任免同一人触发「朝令夕改」事件，该提督忠诚度 -20 |
| **所需职位权限** | `emperor`, `prime_minister`, `council` |
| **游戏耦合点** | `BaseAdmiral.role` 修改；`fleet.commanderId` 可能变更；忠诚度系统 |

#### 提案 5：征收临时国防税

| 字段 | 内容 |
|------|------|
| **名称** | 征收临时国防税 |
| **类型** | `tax` |
| **提案效果** | 通过后：国库 +₮10000；但全阵营星系治安度 -15、开发度 -10 |
| **否决后果** | 无直接后果，但国库赤字持续 |
| **风险** | 治安度 <30 的星系有概率触发「民众暴动」事件（该星系暂停产税 10 天） |
| **所需职位权限** | `emperor`, `prime_minister`, `council` |
| **游戏耦合点** | `metaGold` 修改；`StarNode.security` / `StarNode.economy` 修正 |

#### 提案 6：扩大强制征兵

| 字段 | 内容 |
|------|------|
| **名称** | 扩大强制征兵令 |
| **类型** | `conscription` |
| **提案效果** | 通过后：全阵营每支舰队立即补充舰船至满编的 80%；新增 2 支临时舰队（各 8000 舰）部署至首都 |
| **否决后果** | 无直接后果 |
| **风险** | 全阵营舰队士气 -15（强制征兵引发不满）；治安度 -10 |
| **所需职位权限** | `emperor`, `military_minister`, `council` |
| **游戏耦合点** | `FleetComposition` 补充；`fleet.morale` 修正；`StarNode.security` 修正 |

#### 提案 7：后勤改革方案

| 字段 | 内容 |
|------|------|
| **名称** | 后勤改革方案 |
| **类型** | `logistics` |
| **提案效果** | 通过后：全阵营舰队补给消耗 -30%（持续 30 天）；补给线最大有效距离 +2 跳 |
| **否决后果** | 无直接后果，但下月后勤消耗 +10%（官僚怠工） |
| **风险** | 改革期间造船厂效率 -20% |
| **所需职位权限** | `emperor`, `military_minister`, `prime_minister`, `council` |
| **游戏耦合点** | `fleet.supply` 消耗修正；`calculateSupplyDistance` 阈值修正；造船厂 `tickConstruction` 修正 |

#### 提案 8：科技动员令

| 字段 | 内容 |
|------|------|
| **名称** | 科技动员令 |
| **类型** | `tech_mobilize` |
| **提案效果** | 通过后：全阵营科技研发速度 ×2（持续 30 天）；立即获得 500 战术功勋 |
| **否决后果** | 无直接后果 |
| **风险** | 消耗国库 ₮3000；和平派提督忠诚度 -5 |
| **所需职位权限** | `emperor`, `military_minister`, `prime_minister`, `council` |
| **游戏耦合点** | 科技模块研发进度修正；`tacticalMerit` 修改 |

#### 提案 9：情报行动授权

| 字段 | 内容 |
|------|------|
| **名称** | 情报行动授权 |
| **类型** | `intel_op` |
| **提案效果** | 通过后：敌方全阵营舰队信息可见度提升一级（持续 20 天）——可看到敌方舰队详细编制和移动意图；揭示 3 个敌方节点驻军详情 |
| **否决后果** | 无直接后果 |
| **风险** | 被敌方情报部门反制时（10% 概率），己方 1 名情报人员暴露，情报等级 -1 |
| **所需职位权限** | `emperor`, `intel_minister`, `high_command_chief`, `joint_ops_chief` |
| **游戏耦合点** | 情报模块可见度等级；敌方舰队信息渲染 |

#### 提案 10：外交施压

| 字段 | 内容 |
|------|------|
| **名称** | 外交施压 |
| **类型** | `diplomat_op` |
| **提案效果** | 通过后：目标阵营（可选择）下月税收 -20%（经济封锁效果）；若目标阵营情报等级低于己方，有 15% 概率策反其 1 名提督（忠诚度 -30） |
| **否决后果** | 无直接后果 |
| **风险** | 外交关系恶化，目标阵营对己方侵攻概率 +25% |
| **所需职位权限** | `emperor`, `prime_minister`, `council`, `intel_minister` |
| **游戏耦合点** | 外交模块关系值；敌方 AI 侵略倾向修正 |

#### 提案 11：全军士气鼓舞

| 字段 | 内容 |
|------|------|
| **名称** | 全军士气鼓舞令 |
| **类型** | `morale_boost` |
| **提案效果** | 通过后：全阵营舰队士气立即恢复至 80（若已高于 80 则 +10）；持续 15 天士气衰减速度 -50% |
| **否决后果** | 无直接后果，但若当前平均士气 <40 且被否决，触发「军心涣散」事件（2 支随机舰队士气 -20） |
| **风险** | 消耗国库 ₮2000 |
| **所需职位权限** | `emperor`, `space_fleet_commander`, `space_fleet_deputy`, `high_command_chief`, `joint_ops_chief`, `council` |
| **游戏耦合点** | `fleet.morale` 修正；士气衰减逻辑 |

#### 提案 12：要塞强化工程

| 字段 | 内容 |
|------|------|
| **名称** | 要塞强化工程 |
| **类型** | `fortify` |
| **提案效果** | 通过后：指定星系（提案时可选择目标节点）防御 HP 永久 +50%、防御炮塔 +20；若该节点有防卫司令官，额外获得「要塞守护」效果（驻守舰队防御力 ×1.5） |
| **否决后果** | 无直接后果 |
| **风险** | 消耗国库 ₮5000；工期 15 天，期间该节点税收 -50% |
| **所需职位权限** | `emperor`, `military_minister`, `defense_commander`, `prime_minister`, `council` |
| **游戏耦合点** | `StarNode.defenseHp` / `maxDefenseHp` / `defenseTurrets` 修改；防卫司令官效果系统 |

---

## 5. 行政 6 模块详细设计

### 5.1 数据结构总定义

```typescript
// types/game.ts 新增

/** 行政模块状态 */
export interface AdminState {
  finance: FinanceState;
  personnel: PersonnelState;
  technology: TechnologyState;
  welfare: WelfareState;
  diplomacy: DiplomacyState;
  intelligence: IntelligenceState;
}

/** 财政模块 */
export interface FinanceState {
  treasury: number;              // 国库余额 (= metaGold)
  baseTaxRate: number;           // 基础税率 (0.1 ~ 0.3)
  warTaxRate: number;            // 战争附加税 (0 ~ 0.2)
  fleetMaintenanceCost: number;  // 本月舰队维护费（每日计算）
  monthlyIncome: number;         // 本月预计收入
  monthlyExpense: number;        // 本月预计支出
}

/** 人事模块 */
export interface PersonnelState {
  appointments: AppointmentRecord[];  // 当前任命记录
  loyaltyModifiers: Record<number, number>; // admiralId → 忠诚度修正值
}

export interface AppointmentRecord {
  admiralId: number;
  role: NationalRole;
  appointedDate: string;  // universeDate
  efficiency: number;     // 行政效率 (0.5 ~ 1.5)，受职位适配度影响
}

/** 科技模块 */
export interface TechnologyState {
  weaponLevel: number;    // 武器技术 (1-10)
  armorLevel: number;     // 装甲技术 (1-10)
  engineLevel: number;    // 引擎技术 (1-10)
  electronicLevel: number;// 电子战技术 (1-10)
  researchProgress: Record<TechField, number>; // 各领域研发进度 (0-100)
  researchSpeed: number;  // 基础研发速度 (每日进度)
}

export type TechField = 'weapon' | 'armor' | 'engine' | 'electronic';

/** 民生模块 */
export interface WelfareState {
  avgSecurity: number;    // 全阵营平均治安度
  avgDevelopment: number; // 全阵营平均开发度
  unrestRisk: number;     // 暴动风险指数 (0-100)
}

/** 外交模块 (P2) */
export interface DiplomacyState {
  relations: Record<number, number>; // factionId → 关系值 (-100 ~ 100)
  treaties: Treaty[];
}

export interface Treaty {
  targetFactionId: number;
  type: 'ceasefire' | 'trade' | 'alliance' | 'war';
  expiryDate: string;
}

/** 情报模块 (P2) */
export interface IntelligenceState {
  intelLevel: Record<number, IntelLevel>; // targetFactionId → 情报等级
  revealedFleets: number[]; // 已揭示详细信息的敌方舰队 ID
}

export type IntelLevel = 'none' | 'basic' | 'detailed' | 'full';
```

### 5.2 财政模块

**功能清单**：
- 基础税收：每日从己方星系收取 `economy × baseTaxRate` 金锭
- 战争附加税：可由有权职位的提督开启/关闭，开启后税收 ×(1+warTaxRate) 但治安 -0.5/日
- 舰队维护费：每支舰队每日消耗 `(battleships × 2 + cruisers × 1 + destroyers × 0.5) × 0.1` 金锭
- 国库赤字处理：若国库 < 0，全阵营舰队士气 -3/日、补给 -2/日

**与职位的关联**：
| 职位 | 财政权 |
|------|--------|
| `emperor` / `prime_minister` / `council` | 可调整 baseTaxRate (0.1~0.3)、可开启/关闭战争税 |
| `military_minister` | 可查看军费明细、可申请特别军费（提案） |
| 其他职位 | 只读 |

**每日结算逻辑**（伪代码）：
```typescript
function processDailyFinance(): void {
  const income = sumOwnedNodes(node => node.economy * finance.baseTaxRate);
  const warTax = finance.warTaxRate > 0
    ? sumOwnedNodes(node => node.economy * finance.warTaxRate)
    : 0;
  const maintenance = strategicFleets.value
    .filter(f => f.factionId === playerFactionId)
    .reduce((sum, f) => sum + (f.composition.battleships * 2 + f.composition.cruisers * 1 + f.composition.destroyers * 0.5) * 0.1, 0);

  metaGold.value += income + warTax - maintenance;
  finance.monthlyIncome = income + warTax;
  finance.monthlyExpense = maintenance;

  // 国库赤字
  if (metaGold.value < 0) {
    strategicFleets.value
      .filter(f => f.factionId === playerFactionId)
      .forEach(f => { f.morale = Math.max(0, f.morale - 3); f.supply = Math.max(0, f.supply - 2); });
    triggerToast('国库赤字！舰队士气与补给下降。');
  }

  // 战争税治安惩罚
  if (finance.warTaxRate > 0) {
    ownedNodes.forEach(n => { n.security = Math.max(0, n.security - 0.5); });
  }
}
```

### 5.3 人事模块

**功能清单**：
- 任免/晋升：通过军议 `personnel` 提案执行；任免后更新 `AppointmentRecord`
- 忠诚度系统：每名提督有 `loyalty` (0-100)，每日自然衰减 -0.5，受标签修正
- 派系冲突检测：当同一阵营内不同政治立场标签的提督忠诚度差异 >40 时，低忠诚方触发「派系摩擦」事件

**与职位的关联**：
| 职位 | 人事权 |
|------|--------|
| `emperor` / `prime_minister` / `council` | 可提案任免任何职位 |
| `space_fleet_commander` / `space_fleet_deputy` | 可提案调动麾下舰队司令（仅限 parentCommanderId 指向自己的） |
| 其他职位 | 无 |

**每日结算逻辑**：
```typescript
function processDailyPersonnel(): void {
  const factionAdmirals = getFactionAdmirals(playerFactionId);
  factionAdmirals.forEach(adm => {
    // 基础衰减
    adm.loyalty = Math.max(0, (adm.loyalty || 70) - 0.5);

    // 标签修正
    if (hasTag(adm, 'righteous')) adm.loyalty = Math.min(100, adm.loyalty + 0.3);
    if (hasTag(adm, 'opportunist')) adm.loyalty = Math.max(0, adm.loyalty - 0.2);
    if (hasTag(adm, 'ambition_faction') && adm.loyalty < 30) {
      // 叛变检测
      triggerMutinyEvent(adm);
    }

    // 职位适配度
    const efficiency = calculateRoleEfficiency(adm);
    updateAppointmentEfficiency(adm.id, efficiency);
  });
}
```

### 5.4 科技模块 (P1)

**功能清单**：
- 4 个科技领域：武器/装甲/引擎/电子战，各 1-10 级
- 每日研发进度推进 `researchSpeed` 点，满 100 升级
- 科技等级影响战术战斗参数：武器→攻击力、装甲→防御力、引擎→机动性、电子战→先手值

**与职位的关联**：
| 职位 | 科技权 |
|------|--------|
| `emperor` / `military_minister` / `prime_minister` / `council` | 可指定研发重点领域、可提案科技动员 |

**每日结算逻辑**：
```typescript
function processDailyTechnology(): void {
  const focusedField = tech.researchFocus || 'weapon';
  tech.researchProgress[focusedField] += tech.researchSpeed;

  if (tech.researchProgress[focusedField] >= 100) {
    tech.researchProgress[focusedField] = 0;
    switch (focusedField) {
      case 'weapon': tech.weaponLevel = Math.min(10, tech.weaponLevel + 1); break;
      case 'armor': tech.armorLevel = Math.min(10, tech.armorLevel + 1); break;
      case 'engine': tech.engineLevel = Math.min(10, tech.engineLevel + 1); break;
      case 'electronic': tech.electronicLevel = Math.min(10, tech.electronicLevel + 1); break;
    }
    triggerToast(`科技突破：${fieldLabel[focusedField]} 提升至 ${tech[`${focusedField}Level`]} 级`);
  }
}
```

### 5.5 民生模块 (P1)

**功能清单**：
- 治安度（0-100）：影响税收效率（治安 <30 时税收 ×0.5）和暴动概率
- 开发度（0-100）：影响基础经济值增长率
- 每日自动恢复：治安 +0.5/日（有防卫司令官的节点 +1.5/日），开发度 +0.2/日

**与职位的关联**：
| 职位 | 民生权 |
|------|--------|
| `defense_commander` | 驻守节点治安恢复 ×3、暴动概率 -50% |
| `prime_minister` / `council` | 可调整民生政策（优先治安 vs 优先开发） |

### 5.6 外交模块 (P2)

**功能清单**：
- 与每个阵营的关系值（-100 ~ 100）
- 条约系统：停战/贸易/同盟/战争
- 外交施压提案影响关系值

**与职位的关联**：
| 职位 | 外交权 |
|------|--------|
| `emperor` / `prime_minister` / `council` / `intel_minister` | 可提案外交施压、可缔结条约 |

### 5.7 情报模块 (P2)

**功能清单**：
- 对每个阵营的情报等级：none/basic/detailed/full
- 情报等级影响敌方舰队信息可见度：
  - `none`：只看到舰队存在标记，无兵力信息
  - `basic`：看到大致兵力级别（少/中/多）
  - `detailed`：看到舰船类型分布
  - `full`：看到精确编制 + 移动意图
- 情报行动提案可临时提升情报等级

**与职位的关联**：
| 职位 | 情报权 |
|------|--------|
| `intel_minister` | 情报研发 +50% 速度、可提案情报行动 |
| `emperor` / `high_command_chief` / `joint_ops_chief` | 可提案情报行动 |

---

## 6. 职位职权矩阵

### 6.1 扩展后的职权权限表

> 基于 `RolePermissions` 现有结构扩展至 12 提案类型 + 舰队调动权

| 职位 | 可提提案类型 | 舰队调动权 | 财政权 | 人事权 | 特殊权力 |
|------|------------|-----------|--------|--------|---------|
| `emperor` | 全部 12 类 | 全军 | 全额 | 全权 | 一票否决/强制通过 |
| `prime_minister` | budget, personnel, tax, logistics, diplomat_op | 无直接 | 全额 | 中级（可提案任免） | 财政审批 |
| `military_minister` | budget, conscription, logistics, tech_mobilize, fortify | 造船调度 | 军费分配 | 后勤人事 | 造船优先权 |
| `high_command_chief` | invasion, defense, intel_op | **全军战略调动** | 无 | 军令人事 | 战略部署权 |
| `space_fleet_commander` | invasion, morale_boost | **所属舰队群**（parentCommanderId=self 的舰队） | 无 | 舰队内部 | 直接作战指挥 |
| `space_fleet_deputy` | invasion, morale_boost | **所属舰队群**（parentCommanderId=self 的舰队） | 无 | 舰队内部 | 直接作战指挥 |
| `intel_minister` | defense, intel_op, diplomat_op | 情报单位 | 情报预算 | 情报人事 | 敌情信息优先获取 |
| `defense_commander` | defense, fortify | 驻地防卫舰队 | 驻地资源 | 驻地人事 | 要塞防御加成 |
| `fleet_commander` | invasion | **本舰队**（commanderId=self 的舰队） | 无 | 本舰队长官 | 舰队战术决策 |
| `fleet_staff` | 无 | 辅助指挥（可建议） | 无 | 无 | 建议权 |
| `council` | 全部 12 类 | 全军 | 全额 | 全权 | 集体决议 |
| `joint_ops_chief` | invasion, defense, intel_op | **全军战略调动** | 无 | 军令人事 | 战略部署权 |
| `joint_ops_deputy` | invasion, morale_boost | 辅助战略调动 | 无 | 辅助人事 | 代理权 |
| `none` | 无 | 无 | 无 | 无 | — |

### 6.2 舰队调动权限校验逻辑

```typescript
/**
 * 校验提督是否有权调动/指挥某舰队
 * @returns true=可指挥, false=无权
 */
function canCommandFleet(admiral: BaseAdmiral, fleet: StrategicFleet): boolean {
  const role = admiral.role as string;

  // 皇帝/评议会：全军
  if (role === 'emperor' || role === 'council') return true;

  // 统帅本部总长/统合作战本部长：全军战略调动
  if (role === 'high_command_chief' || role === 'joint_ops_chief') return true;

  // 宇宙舰队司令长官/副司令：仅所属舰队群
  if (role === 'space_fleet_commander' || role === 'space_fleet_deputy') {
    return fleet.parentCommanderId === admiral.id;
  }

  // 防卫司令官：驻地防卫舰队
  if (role === 'defense_commander') {
    return fleet.currentNodeId === admiral.assignedNodeId;
  }

  // 分舰队司令：仅本舰队
  if (role === 'fleet_commander') {
    return fleet.commanderId === admiral.id;
  }

  // 军务尚书：造船调度（不直接指挥舰队，但可调配新建舰船）
  if (role === 'military_minister') return false; // 通过造船间接影响

  return false;
}
```

### 6.3 职位适配度行政效率

基于上一期标签体系的 `AbilityTag`，提督担任职位时的行政效率修正：

| 能力标签 | 适配职位 | 效率修正 |
|---------|---------|---------|
| `tactician` | fleet_commander, space_fleet_commander, space_fleet_deputy | ×1.3 |
| `strategist` | high_command_chief, joint_ops_chief | ×1.3 |
| `politician` | prime_minister, council | ×1.3 |
| `administrator` | military_minister, defense_commander | ×1.3 |
| `diplomat` | intel_minister | ×1.3 |
| 任何标签担任非适配职位 | — | ×0.7 |

```typescript
function calculateRoleEfficiency(admiral: BaseAdmiral): number {
  const tags = admiral.tags || [];
  const role = admiral.role as string;

  const roleTagMap: Record<string, AbilityTag> = {
    'fleet_commander': 'tactician',
    'space_fleet_commander': 'tactician',
    'space_fleet_deputy': 'tactician',
    'high_command_chief': 'strategist',
    'joint_ops_chief': 'strategist',
    'prime_minister': 'politician',
    'council': 'politician',
    'military_minister': 'administrator',
    'defense_commander': 'administrator',
    'intel_minister': 'diplomat',
  };

  const expectedTag = roleTagMap[role];
  if (!expectedTag) return 1.0;
  return tags.includes(expectedTag) ? 1.3 : 0.7;
}
```

---

## 7. 舰队归属小说设定表

### 7.1 问题分析

**现有逻辑**（`initFleetAssignment`）按 `fleetNumber` 分割：
- fleetNumber 1~9 → 谬肯贝尔加 (id:82)
- fleetNumber 10+ → 莱因哈特 (id:81)

**问题**：米达麦亚 (id:80) 的舰队如果被分配了 fleetNumber ≤ 9，就会错误地归到谬肯贝尔加麾下。这违反了小说设定——米达麦亚是莱因哈特的核心部下。

**解决方案**：改为按 **admiral ID 硬编码映射表** 分类，不再依赖 fleetNumber。

### 7.2 帝国舰队司令逐人归类

#### 莱因哈特麾下（改革派/少壮派）— 9 人

| 提督 | ID | 小说派系 | 说明 |
|------|-----|---------|------|
| 米达麦亚 | 80 | 改革派 | 「疾风之狼」，莱因哈特麾下第一猛将 |
| 罗严塔尔 | 98 | 改革派 | 「金银妖瞳」，莱因哈特麾下与米达麦亚齐名的双璧 |
| 毕典菲尔特 | 62 | 改革派 | 「黑色枪骑兵」，黑色舰队司令 |
| 法伦海特 | 65 | 改革派 | 原同盟出身，后归莱因哈特 |
| 梅克林格 | 84 | 改革派 | 「艺术家」，文武双全 |
| 连内肯普 | 97 | 改革派 | 莱因哈特提拔的提督 |
| 瓦列 | 99 | 改革派 | 莱因哈特麾下提督 |
| 坎普 | 29 | 改革派 | 莱因哈特麾下勇将 |
| 吉尔菲艾斯 | 15 | 改革派 | 莱因哈特挚友，红发青年 |

#### 谬肯贝尔加麾下（传统派/贵族派）— 8 人

| 提督 | ID | 小说派系 | 说明 |
|------|-----|---------|------|
| 艾齐纳哈 | 0 | 传统派 | 老成持重的提督 |
| 斯特汀 | 36 | 传统派 | 大贵族派系 |
| 休特克豪简 | 37 | 传统派 | 传统派提督 |
| 杰克特 | 44 | 传统派 | 伊谢尔伦驻守提督 |
| 布朗胥百克 | 71 | 传统派 | 大贵族门阀首领 |
| 梅尔卡兹 | 85 | 传统派 | 传统派老将（后归莱因哈特，但初期属谬肯贝尔加麾下） |
| 立典亥姆 | 89 | 传统派 | 大贵族派系 |
| 立典拉德 | 90 | 传统派 | 首席宰相，传统派核心 |

#### 帝国高层（不归入舰队序列）

| 提督 | ID | 职位 | 说明 |
|------|-----|------|------|
| 佛瑞德李希四世 | 181 | emperor | 皇帝，不参与舰队指挥 |
| 谬肯贝尔加 | 82 | space_fleet_commander | 司令长官，管辖上述 8 人 |
| 莱因哈特 | 81 | space_fleet_deputy | 副司令，管辖上述 9 人 |
| 艾伦博克 | 7 | military_minister | 军务尚书 |
| 斯坦赫夫 | 34 | high_command_chief | 统帅本部总长 |

### 7.3 同盟侧舰队归属

同盟只有一个 `space_fleet_commander`（罗波斯 id:164），所有舰队司令全部归其麾下：

| 提督 | ID | 说明 |
|------|-----|------|
| 阿普顿 | 101 | 同盟舰队司令 |
| 亚尔·沙列姆 | 103 | 同盟舰队司令 |
| 伍兰夫 | 106 | 同盟舰队司令 |
| 库布斯里 | 113 | 同盟舰队司令 |
| 格林希尔 | 114 | 同盟舰队司令 |
| 席特尼 | 123 | 同盟舰队司令 |
| 比克古 | 136 | 同盟老将 |
| 布隆兹 | 145 | 同盟舰队司令 |
| 赫伍得 | 147 | 同盟舰队司令 |
| 波罗汀 | 149 | 同盟舰队司令 |
| 杨威利 | 156 | 同盟天才，第13舰队司令 |
| 鲁格拉希 | 161 | 同盟舰队司令 |
| 路菲普 | 162 | 同盟舰队司令 |

### 7.4 修正后的 initFleetAssignment 逻辑

```typescript
// store/gameStore.ts — initFleetAssignment 重写

/** 莱因哈特麾下舰队司令 ID 列表（小说设定） */
const REINHARD_FLEET_COMMANDERS = new Set([80, 98, 62, 65, 84, 97, 99, 29, 15]);

/** 谬肯贝尔加麾下舰队司令 ID 列表（小说设定） */
const MUECKENBERGER_FLEET_COMMANDERS = new Set([0, 36, 37, 44, 71, 85, 89, 90]);

function initFleetAssignment(admirals: BaseAdmiral[], fleets: StrategicFleet[]) {
  const empireCommander = admirals.find(
    a => a.role === 'space_fleet_commander' && a.faction === 'empire'
  );  // 谬肯贝尔加 id:82
  const empireDeputy = admirals.find(
    a => a.role === 'space_fleet_deputy'
  );  // 莱因哈特 id:81
  const allianceCommander = admirals.find(
    a => a.role === 'space_fleet_commander' && a.faction === 'alliance'
  );  // 罗波斯 id:164

  fleets.forEach((fleet) => {
    const commander = admirals.find(a => a.id === fleet.commanderId);

    if (fleet.factionId === FACTION_EMPIRE_ID) {
      // 帝国侧：按小说设定的 admiral ID 映射表分类
      if (commander && REINHARD_FLEET_COMMANDERS.has(commander.id)) {
        fleet.parentCommanderId = empireDeputy?.id ?? null;  // 归莱因哈特
      } else if (commander && MUECKENBERGER_FLEET_COMMANDERS.has(commander.id)) {
        fleet.parentCommanderId = empireCommander?.id ?? null;  // 归谬肯贝尔加
      } else {
        // 玩家舰队或未归类舰队：按 fleetNumber 兜底分割
        fleet.parentCommanderId = fleet.fleetNumber <= EMPIRE_FLEET_SPLIT_THRESHOLD
          ? (empireCommander?.id ?? null)
          : (empireDeputy?.id ?? null);
      }
    } else if (fleet.factionId === FACTION_ALLIANCE_ID) {
      // 同盟侧：全部归罗波斯
      fleet.parentCommanderId = allianceCommander?.id ?? null;
    }
  });
}
```

---

## 8. UI 设计要点

### 8.1 顶部菜单栏扩展

```
┌─────────────────────────────────────────────────────────────────┐
│  [战略地图]  [军议 ●]  [行政院]  [情报]  ...  日期: 796.03.15  │
└─────────────────────────────────────────────────────────────────┘
```

- **军议按钮**：常驻顶部菜单；有待处理提案时显示红点 + 数字（待处理数量）
- **行政院按钮**：常驻顶部菜单；无红点机制（随时可访问）
- 两个按钮可同时存在，点击后各自展开侧滑面板，不互斥

### 8.2 军议面板（侧滑式，非模态）

```
┌──────────────────────────────────────────────────────────────────┐
│  军议大厅                                              [×关闭]  │
│  ┌─────────────────────────┬──────────────────────────────────┐ │
│  │ 操作者档案              │ 待处理提案 (3)                   │ │
│  │ ┌───┐                   │ ┌──────────────────────────────┐ │ │
│  │ │头像│ 莱因哈特         │ │ 📋 战略侵攻动员  [投票]      │ │ │
│  │ └───┘ 副司令 · 元帅     │ │ 📋 申请特别军费  [投票]      │ │ │
│  │       票权: 50          │ │ 📋 后勤改革方案  [投票]      │ │ │
│  │                       │ └──────────────────────────────┘ │ │
│  │ 政治生态                │                                  │ │
│  │ [████████████░░░░]     │ 历史决议 (20)                    │ │
│  │  主战 55% 中立 25%     │ ┌──────────────────────────────┐ │ │
│  │  保守 20%              │ │ ✅ 征兵令  [12:5]  796.03.01│ │ │
│  │                       │ │ ❌ 国防税  [3:8]   796.02.01│ │ │
│  │ 议会成员               │ │ ...                          │ │ │
│  │ · 米达麦亚  元帅  改革 │ └──────────────────────────────┘ │ │
│  │ · 罗严塔尔  元帅  改革 │                                  │ │
│  │ · 艾齐纳哈  上将  保守 │                                  │ │
│  └─────────────────────────┴──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**关键设计点**：
- 从右侧滑入（`transform: translateX`），宽度 480px，不覆盖全屏
- **不暂停战略时钟**——战略地图继续运行
- 投票按钮点击后弹出提案详情卡片（效果/风险/权限），确认后执行投票
- 已投票的提案从「待处理」移至「历史决议」
- 侧滑面板可随时关闭，战略地图仍可见可操作

### 8.3 行政院面板（侧滑式）

```
┌──────────────────────────────────────────────────────────────────┐
│  行政院                                              [×关闭]  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ [财政] [人事] [科技] [民生] [外交] [情报]                 │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │                                                            │ │
│  │  💰 财政总览                                               │ │
│  │  ┌──────────────┬──────────────┐                          │ │
│  │  │ 国库         │ ₮ 12,450     │                          │ │
│  │  │ 本月收入     │ +₮ 3,200     │                          │ │
│  │  │ 本月支出     │ -₮ 1,800     │                          │ │
│  │  │ 预计盈亏     │ +₮ 1,400     │                          │ │
│  │  └──────────────┴──────────────┘                          │ │
│  │                                                            │ │
│  │  税率设置                                                  │ │
│  │  基础税率: [━━━━●━━] 20%                                   │ │
│  │  战争附加税: [●━━━━━━] 0%  [开启]                          │ │
│  │                                                            │ │
│  │  舰队维护费明细                                            │ │
│  │  · 第1舰队(艾齐纳哈): -₮120/日                            │ │
│  │  · 第2舰队(米达麦亚): -₮95/日                             │ │
│  │  · ...                                                     │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**关键设计点**：
- 同样从右侧滑入，宽度 520px
- Tab 切换 6 个模块（P0 模块：财政/人事；P1 模块：科技/民生；P2 模块：外交/情报灰色禁用）
- 各模块内可查看数据、执行有权操作（操作按钮受 `RolePermissions` 约束，无权时 disabled + tooltip 提示原因）

### 8.4 CouncilPanel.vue 改造要点

| 现状 | 改造后 |
|------|--------|
| `v-if="showCouncilModal"` 全屏 overlay | 侧滑面板 `v-if="showCouncilPanel"`，`position: fixed; right: 0; top: 0; height: 100vh; width: 480px` |
| `strategicPaused = true` 暂停游戏 | 不暂停，战略时钟继续 |
| 4 个提案按钮 | 12 个提案卡片，分「待处理」和「历史」两组 |
| `handleProposal` 直接执行 | 先弹详情确认卡，再执行 `submitProposal` + `executeProposalEffect` |
| 关闭时 `strategicPaused = false` | 无需恢复暂停（本来就没暂停） |

### 8.5 strategicTick 改造要点

```typescript
// 现有代码（删除）:
// if (universeDate.value.endsWith('.01')) {
//     strategicPaused.value = true;
//     triggerCouncilMeeting();
// }

// 改造后:
if (universeDate.value.endsWith('.01')) {
    // 非侵入式：生成待处理提案，不暂停、不弹窗
    generateMonthlyProposals();
    // 设置红点提醒
    councilPendingCount.value = pendingProposals.value.length;
}
```

---

## 9. 待确认问题

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| Q-1 | 梅尔卡兹 (id:85) 在小说后期归顺莱因哈特，但初期属谬肯贝尔加麾下。本 PRD 按初期设定归类，是否需要设计「后期叛变归顺」事件自动转移归属？ | 影响剧情还原度 | 建议 P2 阶段实现事件驱动的归属变更 |
| Q-2 | 玩家选择的提督如果既不在莱因哈特 9 人名单也不在谬肯贝尔加 8 人名单中（如玩家选了奥贝斯坦），其舰队归属如何处理？ | 影响 initFleetAssignment 兜底逻辑 | 建议按 fleetNumber 兜底分割（现有逻辑保留为 fallback） |
| Q-3 | 12 条提案的「否决后果」是否对玩家阵营也适用？还是仅影响 NPC 阵营？ | 影响游戏平衡性 | 建议否决后果仅影响提案人所在阵营（玩家阵营），避免对 NPC 阵营产生不可见的影响 |
| Q-4 | 行政面板中的操作（如调整税率）是否需要通过军议投票，还是有权职位可直接执行？ | 影响行政系统与军议系统的耦合度 | 建议：日常操作（调税率、指定科技重点）由有权职位直接执行；重大操作（人事任免、宣战）需通过军议提案 |
| Q-5 | 忠诚度系统中的叛变事件触发后，叛变提督的舰队归属如何处理？是否自动转移至敌方阵营？ | 影响游戏进程 | 建议叛变提督舰队 `factionId` 变更为敌方，`parentCommanderId` 变更为 null |
| Q-6 | 外交模块和情报模块列为 P2，是否在本次增量中实现基础框架（数据结构+空UI）还是完全推迟？ | 影响开发工作量 | 建议本次仅实现数据结构定义和 UI 占位（灰色 Tab），逻辑推迟至下一期 |
| Q-7 | 布朗胥百克 (id:71) 和立典拉德 (id:90) 在小说中是大贵族派核心人物，但他们是否有舰队指挥权？还是纯政治角色？ | 影响 fleet_commander 部署逻辑 | 建议确认：若为纯政治角色，不应在 `initStrategicMap` 中被 `deployFleet` 部署为舰队司令 |
| Q-8 | 「全军士气鼓舞令」提案的所需权限包含了 `space_fleet_commander` 和 `space_fleet_deputy`，但现有 `RolePermissions` 中这两个职位的权限列表只有 `['invasion', 'defense']`。是否确认扩展其权限至包含 `morale_boost`？ | 影响 RolePermissions 改动范围 | 建议确认并扩展 |

---

## 附录 A：提案效果执行引擎伪代码

```typescript
/**
 * 执行提案通过后的效果
 * 在 submitProposal 返回 true 后调用
 */
function executeProposalEffect(proposal: { type: ProposalType; targetNodeId?: number }): void {
  switch (proposal.type) {
    case 'invasion':
      // Warp 速度 +30%，持续 15 天
      applyFactionBuff(playerFactionId, 'warpSpeed', 0.3, 15);
      applyFactionMoraleBuff(playerFactionId, 20);
      break;

    case 'defense':
      // 指定星域防御 +100%，持续 30 天
      if (proposal.targetNodeId) {
        applyNodeBuff(proposal.targetNodeId, 'defenseHp', 2.0, 30);
      }
      break;

    case 'budget':
      metaGold.value += 5000;
      break;

    case 'personnel':
      // 人事任免效果在提案提交时已指定目标，此处执行
      break;

    case 'tax':
      metaGold.value += 10000;
      applyFactionNodeDebuff(playerFactionId, 'security', -15);
      applyFactionNodeDebuff(playerFactionId, 'economy', -10);
      break;

    case 'conscription':
      replenishFleetComposition(playerFactionId, 0.8);
      applyFactionMoraleDebuff(playerFactionId, -15);
      applyFactionNodeDebuff(playerFactionId, 'security', -10);
      break;

    case 'logistics':
      applyFactionBuff(playerFactionId, 'supplyEfficiency', 0.7, 30);  // 消耗 ×0.7
      applyFactionBuff(playerFactionId, 'supplyRange', 2, 30);  // +2 跳
      break;

    case 'tech_mobilize':
      applyTechBuff(playerFactionId, 2.0, 30);  // 研发速度 ×2
      tacticalMerit.value += 500;
      metaGold.value -= 3000;
      break;

    case 'intel_op':
      applyIntelBuff(playerFactionId, 'levelUp', 20);  // 20 天
      revealEnemyNodes(3);
      break;

    case 'diplomat_op':
      applyDiplomatPressure(playerFactionId, targetFactionId);
      break;

    case 'morale_boost':
      strategicFleets.value
        .filter(f => f.factionId === playerFactionId)
        .forEach(f => { f.morale = Math.max(80, f.morale + 10); });
      applyFactionBuff(playerFactionId, 'moraleDecayReduction', 0.5, 15);
      metaGold.value -= 2000;
      break;

    case 'fortify':
      if (proposal.targetNodeId) {
        const node = getNode(proposal.targetNodeId);
        node.maxDefenseHp = Math.floor(node.maxDefenseHp * 1.5);
        node.defenseHp = node.maxDefenseHp;
        node.defenseTurrets += 20;
        metaGold.value -= 5000;
        // 15 天工期：该节点税收 -50%
        applyNodeBuff(proposal.targetNodeId, 'taxRate', 0.5, 15);
      }
      break;
  }
}

/**
 * 执行提案被否决后的后果
 */
function executeProposalRejection(proposal: { type: ProposalType }): void {
  switch (proposal.type) {
    case 'budget':
      // 维护费强制扣减
      const maintenance = calculateFleetMaintenance(playerFactionId);
      metaGold.value -= maintenance;
      if (metaGold.value < 0) {
        applyFactionMoraleDebuff(playerFactionId, -5);
      }
      break;

    case 'morale_boost':
      const avgMorale = getFactionAvgMorale(playerFactionId);
      if (avgMorale < 40) {
        // 触发军心涣散
        const randomFleets = getRandomFleets(playerFactionId, 2);
        randomFleets.forEach(f => { f.morale = Math.max(0, f.morale - 20); });
        triggerToast('军心涣散！2 支舰队士气暴跌。');
      }
      break;

    case 'invasion':
      // 连续 2 次否决检测
      if (getRecentRejectionCount('invasion', 2) >= 2) {
        applyFactionLoyaltyDebuffByTag(playerFactionId, 'militarist', -10);
      }
      break;

    // 其他类型：无直接否决后果
  }
}
```

## 附录 B：月度提案生成逻辑

```typescript
/**
 * 每月1号自动生成待处理提案
 * 根据当前战略局势智能选择 3-5 条提案
 */
function generateMonthlyProposals(): void {
  const context = analyzeStrategicContext(playerFactionId);
  // context: { atWar, treasury, avgMorale, avgSupply, enemyThreat, ... }

  const candidates: ProposalType[] = [];

  // 战时优先：侵攻/士气/征兵
  if (context.atWar) {
    candidates.push('invasion', 'morale_boost', 'conscription');
  }

  // 国库低：军费/加税
  if (context.treasury < 3000) {
    candidates.push('budget', 'tax');
  }

  // 士气低：士气鼓舞
  if (context.avgMorale < 50) {
    candidates.push('morale_boost');
  }

  // 补给线长：后勤改革
  if (context.avgSupplyDistance > 3) {
    candidates.push('logistics');
  }

  // 常规提案：科技/情报/防卫/要塞
  candidates.push('tech_mobilize', 'intel_op', 'defense', 'fortify');

  // 去重 + 随机选 3-5 条
  const uniqueCandidates = [...new Set(candidates)];
  const selected = shuffle(uniqueCandidates).slice(0, 4);

  selected.forEach(type => {
    pendingProposals.value.push({
      id: Date.now() + Math.random(),
      type,
      generatedDate: universeDate.value,
      status: 'pending',
    });
  });

  councilPendingCount.value = pendingProposals.value.length;
}
```

## 附录 C：现有代码改造清单

| 文件 | 改造内容 | 优先级 |
|------|---------|--------|
| `store/gameStore.ts` `strategicTick` | 删除每月1号 `triggerCouncilMeeting()` 强制暂停；改为 `generateMonthlyProposals()` | P0 |
| `store/gameStore.ts` `submitProposal` | 扩展 `RolePermissions` 至 12 类型；提案通过后调用 `executeProposalEffect` | P0 |
| `store/gameStore.ts` `initFleetAssignment` | 改为按 admiral ID 硬编码映射表分类 | P0 |
| `store/gameStore.ts` `evaluateRandomEvents` | 扩展为行政系统每日结算入口，调用 6 模块结算函数 | P0 |
| `store/gameStore.ts` | 新增 `executeProposalEffect` / `executeProposalRejection` / `generateMonthlyProposals` / `canCommandFleet` / `calculateRoleEfficiency` | P0 |
| `store/gameStore.ts` | 新增 `adminState` ref 及 6 模块状态 | P0 |
| `types/game.ts` `ProposalType` | 扩展至 12 类型 | P0 |
| `types/game.ts` | 新增 `AdminState` / `FinanceState` / `PersonnelState` / `TechnologyState` / `WelfareState` / `DiplomacyState` / `IntelligenceState` | P0 |
| `components/meta/CouncilPanel.vue` | 全屏模态 → 侧滑面板；4 提案 → 12 提案；不暂停游戏 | P0 |
| `components/meta/` 新建 `AdminPanel.vue` | 行政院侧滑面板，6 模块 Tab | P0 |
| `components/meta/StrategicScreen.vue` | 顶部菜单新增「军议」和「行政院」按钮 + 红点 | P0 |
| `config/tagConfig.ts` | 新增 `RolePermissions` 扩展（12 类型）+ 舰队调动权限配置 | P0 |
