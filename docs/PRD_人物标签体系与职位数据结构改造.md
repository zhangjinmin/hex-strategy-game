# 增量 PRD：人物标签体系 + 职位数据结构改造

> **项目**: 银河英雄传说 策略游戏 (hex-strategy-game)
> **技术栈**: Vue 3 + Phaser + Pinia + TypeScript
> **版本**: v1.0
> **日期**: 2025-07

---

## 1. 产品目标

用**标签数组体系**替代现有 `hiddenStats` 数值模型（野心/义理/相性），并为 `StrategicFleet` 新增舰队归属字段以正确表达「宇宙舰队司令长官与副司令分权平级」的指挥关系，使 AI 决策逻辑更直观、标签可直接注入 AI prompt，同时保证旧存档平滑过渡。

---

## 2. 用户故事

| # | 角色 | 故事 | 价值 |
|---|------|------|------|
| US-1 | 玩家 | 作为帝国玩家，我希望军议投票时提督们表现出鲜明的政治立场（如大贵族派抵制改革派提案），这样每次投票都有戏剧张力而非随机数 | 沉浸感 |
| US-2 | 玩家 | 作为玩家，我希望看到敌方提督在战场上有截然不同的战术风格（如有的正面突击、有的防守反击），这样不同对手需要不同应对策略 | 策略深度 |
| US-3 | 玩家 | 作为玩家，我希望莱因哈特和谬肯贝尔加各自独立指挥一半帝国舰队，而非一个从属于另一个，这样能还原原著的双头指挥格局 | 原著还原 |
| US-4 | 玩家 | 作为玩家，我希望 AI 驱动的提督对话/提案能体现其性格标签（如冷酷型提督措辞强硬、义理型提督注重道义），这样让角色更鲜活 | 角色塑造 |
| US-5 | 模组作者 | 作为模组作者，我希望能通过标签编辑器直观地为新人物打标签，而不用理解三个 0-100 数值的具体含义 | 可维护性 |

---

## 3. 需求池

### P0 — Must Have（本阶段必须完成）

| ID | 需求 | 说明 |
|----|------|------|
| P0-1 | 标签类型系统定义 | 在 `types/game.ts` 中定义 `AdmiralTag` 联合类型及 4 大分类枚举 |
| P0-2 | BaseAdmiral 接口改造 | `BaseAdmiral` 新增 `tags: AdmiralTag[]` 字段；`hiddenStats` 标记为 `@deprecated` 但保留 |
| P0-3 | 183 人物标注 | 为 `admiralsData.ts` 中全部 183 名提督完成标签标注（基于现有 hiddenStats 数值 + 原著设定） |
| P0-4 | StrategicFleet 舰队归属字段 | `StrategicFleet` 新增 `parentCommanderId: number \| null` 和 `fleetNumber: number` |
| P0-5 | 数据迁移脚本 | 编写 `migrateHiddenStatsToTags()` 函数，将旧 hiddenStats 映射为标签数组 |
| P0-6 | 存档兼容层 | 存档加载时检测：有 `tags` 用 tags，无 tags 则调用迁移函数自动生成 |

### P1 — Should Have（本阶段尽量完成）

| ID | 需求 | 说明 |
|----|------|------|
| P1-1 | AI 投票算法改造 | `calculateAIVote()` 从读 hiddenStats 改为读 tags，按标签组合计算投票倾向 |
| P1-2 | 提案成功率改造 | `calculateProposalSuccess()` 改为基于标签兼容性计算 |
| P1-3 | 派系自动生成 | 基于政治立场标签聚类，自动生成帝国内部派系（大贵族派/改革派等） |
| P1-4 | 舰队归属初始化 | 游戏开局时按职位体系为 StrategicFleet 设置 `parentCommanderId` 和 `fleetNumber` |

### P2 — Nice to Have（后续迭代）

| ID | 需求 | 说明 |
|----|------|------|
| P2-1 | AI Prompt 模板 | 为 AI 驱动模式编写标签注入 prompt 模板（如 "该提督标签：[冷酷, 野心派, 战术家]"） |
| P2-2 | 标签编辑器 UI | 在编辑器场景中提供可视化标签勾选面板 |
| P2-3 | 战场 AI 行为差异 | 根据军事风格标签调整战场 AI 的阵型选择、进攻/防守倾向 |
| P2-4 | 事件触发系统 | 根据人格特质标签触发特殊事件（如野心派提督叛变、义理型提督死战不退） |

---

## 4. 标签体系完整定义

### 4.1 类型定义

```typescript
// types/game.ts 新增

// A. 政治立场类
export type PoliticalTag =
  | 'aristocrat'        // 大贵族派
  | 'reformer'          // 改革派
  | 'democrat'          // 民主派
  | 'militarist'        // 军国派
  | 'pacifist'          // 和平派
  | 'royalist'          // 保皇派
  | 'ambition_faction'; // 野心派

// B. 军事风格类
export type MilitaryTag =
  | 'frontal_assault'   // 正面突击
  | 'counter_defense'   // 防守反击
  | 'firepower'         // 火力压制
  | 'mobile_raid'       // 机动突袭
  | 'logistics_focus'   // 后勤重视
  | 'intel_focus'       // 情报重视
  | 'cautious'          // 谨慎型
  | 'aggressive';       // 冒险型

// C. 人格特质类
export type PersonalityTag =
  | 'high_charisma'     // 高魅力
  | 'high_iq'           // 高智商
  | 'high_eq'           // 高情商
  | 'ruthless'          // 冷酷
  | 'righteous'         // 义理
  | 'opportunist'       // 投机
  | 'idealist'          // 理想主义
  | 'realist';          // 现实主义

// D. 能力倾向类
export type AbilityTag =
  | 'tactician'         // 战术家
  | 'strategist'        // 战略家
  | 'politician'        // 政客
  | 'administrator'     // 行政官
  | 'diplomat';         // 外交官

export type AdmiralTag = PoliticalTag | MilitaryTag | PersonalityTag | AbilityTag;

// 标签元数据（用于 UI 展示和算法查询）
export interface TagMeta {
  id: AdmiralTag;
  label: string;          // 中文显示名
  category: 'political' | 'military' | 'personality' | 'ability';
  description: string;    // 标签说明
}
```

### 4.2 各标签定义与行为影响系数

#### A. 政治立场类（影响军议投票、派系归属、叛变倾向）

| 标签 | 中文名 | 定义 | 对入侵提案 | 对防御提案 | 对预算提案 | 对人事提案 | 叛变阈值 |
|------|--------|------|-----------|-----------|-----------|-----------|---------|
| `aristocrat` | 大贵族派 | 维护门阀贵族利益，抵制改革，忠于传统体制 | -0.2 | +0.3 | +0.1（维护秩序） | -0.3（反对异类晋升） | 低 |
| `reformer` | 改革派 | 主张制度革新，打破贵族垄断 | +0.2 | 0 | -0.1 | +0.3（支持新锐） | 中 |
| `democrat` | 民主派 | 追求民主制度（主要为同盟人物） | +0.1 | +0.4 | 0 | +0.2 | 极低 |
| `militarist` | 军国派 | 崇尚武力扩张，军功至上 | +0.5 | +0.1 | +0.2（要军费） | 0 | 中高 |
| `pacifist` | 和平派 | 反对战争，主张外交解决 | -0.4 | +0.2 | -0.2 | +0.1 | 极低 |
| `royalist` | 保皇派 | 绝对忠于皇室（帝国专属） | 0 | +0.3 | 0 | -0.2 | 极低 |
| `ambition_faction` | 野心派 | 追求个人权力，伺机夺权 | +0.3 | -0.2 | -0.3（不让他人拿钱） | -0.2 | **高** |

> **叛变判定**：拥有 `ambition_faction` 标签 + 无 `royalist`/`righteous` 标签 → 当忠诚度 < 30 时触发叛变事件

#### B. 军事风格类（影响战场 AI、舰队行为）

| 标签 | 中文名 | 定义 | 阵型倾向 | 进攻系数 | 撤退阈值 | 特殊行为 |
|------|--------|------|---------|---------|---------|---------|
| `frontal_assault` | 正面突击 | 偏好主力正面决战 | wedge（楔形） | ×1.3 | 剩余 20% | 优先攻击敌方旗舰 |
| `counter_defense` | 防守反击 | 以守为攻，消耗后反击 | square（方阵） | ×0.8 | 剩余 35% | 等待敌方先攻击 |
| `firepower` | 火力压制 | 依赖远程火力优势 | line（横阵） | ×1.1 | 剩余 25% | 优先保持射程优势 |
| `mobile_raid` | 机动突袭 | 高速穿插，打乱阵型 | spindle（纺锤） | ×1.2 | 剩余 30% | 优先攻击侧翼/后卫 |
| `logistics_focus` | 后勤重视 | 注重补给线与持续作战 | circle（环形） | ×0.9 | 剩余 40% | 补给低于 30% 必撤 |
| `intel_focus` | 情报重视 | 依赖侦察与信息优势 | 灵活切换 | ×1.0 | 剩余 30% | 优先侦察后再行动 |
| `cautious` | 谨慎型 | 宁可保守不失 | square/line | ×0.7 | 剩余 45% | 兵力劣势时提前撤退 |
| `aggressive` | 冒险型 | 敢于冒险，孤注一掷 | wedge/spindle | ×1.4 | 剩余 15% | 兵力劣势仍可能进攻 |

> **冲突规则**：`cautious` 与 `aggressive` 互斥，不可同时标注；`frontal_assault` 与 `mobile_raid` 互斥。一个人物最多标注 2 个军事风格标签。

#### C. 人格特质类（影响忠诚度、互动、事件触发）

| 标签 | 中文名 | 定义 | 忠诚度修正 | 提案成功率修正 | 事件触发 |
|------|--------|------|-----------|--------------|---------|
| `high_charisma` | 高魅力 | 天生领袖气质，容易获得追随 | +10 | +15 | 部下忠诚度衰减减半 |
| `high_iq` | 高智商 | 战略洞察力强，善于谋略 | 0 | +10 | 可识破敌方计策 |
| `high_eq` | 高情商 | 善于人际周旋，协调矛盾 | +5 | +20 | 派系冲突时可调解 |
| `ruthless` | 冷酷 | 不择手段，功利至上 | -5 | -5 | 可执行残酷命令无惩罚 |
| `righteous` | 义理 | 重信守义，忠贞不二 | +20 | -10 | 绝不叛变；被俘不降 |
| `opportunist` | 投机 | 见风使舵，唯利是图 | -15 | +5 | 强弱悬殊时可能倒戈 |
| `idealist` | 理想主义 | 为信念而战，不计得失 | +10 | -15 | 拒绝违背信念的命令 |
| `realist` | 现实主义 | 务实权衡，灵活应变 | 0 | +10 | 可接受不利条件下的妥协 |

> **互斥规则**：`ruthless` 与 `righteous` 互斥；`idealist` 与 `realist` 互斥。

#### D. 能力倾向类（影响职位适配、行政效率）

| 标签 | 中文名 | 定义 | 最佳职位 | 行政效率修正 | 职位适配度 |
|------|--------|------|---------|------------|-----------|
| `tactician` | 战术家 | 擅长战场指挥与临阵应变 | fleet_commander, defense_commander | ×0.8 | 前线指挥 +30% |
| `strategist` | 战略家 | 擅长全局规划与长远布局 | high_command_chief, joint_ops_chief | ×1.0 | 战略层 +30% |
| `politician` | 政客 | 擅长权力博弈与派系运作 | prime_minister, council | ×1.2 | 政治层 +30% |
| `administrator` | 行政官 | 擅长内政管理与资源调度 | military_minister, defense_commander | ×1.5 | 后勤层 +40% |
| `diplomat` | 外交官 | 擅长谈判与情报外交 | intel_minister | ×1.1 | 外交层 +30% |

> **适配度规则**：提督担任非适配职位时，相关效率 ×0.7。担任适配职位时 ×1.3。

---

## 5. 职位体系完整定义

### 5.1 指挥链图

```
                    ┌─────────────────────────────────────────────────┐
                    │              皇帝 (emperor)                      │
                    │         佛瑞德李希四世 [id:181]                   │
                    │    （终极权力，不参与日常投票，一票否决）            │
                    └───────────────────────┬─────────────────────────┘
                                            │
                 ┌──────────────────────────┼──────────────────────────┐
                 │                          │                          │
    ┌────────────▼───────────┐  ┌──────────▼──────────┐  ┌────────────▼──────────┐
    │  帝国宰相               │  │  统帅本部总长         │  │  军务尚书              │
    │  (prime_minister)       │  │  (high_command_chief)│  │  (military_minister)   │
    │  统管全局与财政          │  │  管辖战略调动与作战权  │  │  管辖军费与造船         │
    │  斯坦赫夫? ※待确认       │  │  斯坦赫夫 [id:34]     │  │  艾伦博克 [id:7]       │
    └────────────┬───────────┘  └──────────┬──────────┘  └────────────────────────┘
                 │                          │
                 │              ┌───────────┴───────────┐
                 │              │                       │
                 │   ┌──────────▼──────────┐  ┌─────────▼──────────┐
                 │   │ 宇宙舰队司令长官     │  │ 宇宙舰队副司令       │
                 │   │ (space_fleet_       │  │ (space_fleet_       │
                 │   │  commander)         │  │  deputy)            │
                 │   │ 谬肯贝尔加 [id:82]  │  │ 莱因哈特 [id:81]    │
                 │   │ ── 分权平级 ──      │  │ ── 分权平级 ──      │
                 │   │ 管辖第1~9舰队(一半)  │  │ 管辖第10~18舰队(一半)│
                 │   └──────────┬──────────┘  └─────────┬──────────┘
                 │              │                       │
                 │   ┌──────────▼───────────────────────▼──────────┐
                 │   │          分舰队司令 (fleet_commander)         │
                 │   │  各舰队司令直接向所属上级司令汇报              │
                 │   │  parentCommanderId 指向谬肯贝尔加或莱因哈特    │
                 │   └──────────────────────┬───────────────────────┘
                 │                          │
    ┌────────────▼───────────┐  ┌──────────▼──────────┐
    │  情报部长               │  │  防卫司令官           │
    │  (intel_minister)       │  │  (defense_commander) │
    │  管辖情报预算与敌情获取   │  │  行星/要塞最高军政长官 │
    └────────────────────────┘  └─────────────────────┘
```

**同盟侧指挥链**：

```
                    ┌─────────────────────────────────┐
                    │     最高评议会 (council)          │
                    │     同盟最高评议会 [id:165]       │
                    │     统管全局与财政                 │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
         ┌──────────▼──────┐  ┌─────▼──────────┐  ┌──▼──────────────┐
         │ 统合作战本部长    │  │ 统合作战本部次长 │  │ 宇宙舰队司令长官 │
         │(joint_ops_chief) │  │(joint_ops_deputy)│  │(space_fleet_   │
         │                  │  │                  │  │ commander)     │
         │ 管辖战略与作战     │  │ 辅助本部长       │  │ 罗波斯[id:164] │
         └──────────┬───────┘  └──────────────────┘  └───────┬───────┘
                    │                                        │
                    └────────────────┬───────────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │ 分舰队司令           │
                          │(fleet_commander)    │
                          │ 各舰队司令          │
                          └─────────────────────┘
```

### 5.2 职权矩阵

| 职位 | 类型 | 军议投票权重 | 可提提案类型 | 作战指挥权 | 财政权 | 人事权 | 特殊权力 |
|------|------|------------|------------|-----------|--------|--------|---------|
| emperor | 帝国 | 1000（否决权） | 全部 | 全军 | 全额 | 全权 | 一票否决/强制通过 |
| prime_minister | 帝国 | 100 | budget, personnel | 无直接 | 全额 | 中级 | 财政审批 |
| military_minister | 帝国 | 80 | budget | 造船调度 | 军费分配 | 后勤人事 | 造船优先权 |
| high_command_chief | 帝国 | 80 | invasion, defense | **全军战略调动** | 无 | 军令人事 | 战略部署权 |
| space_fleet_commander | 帝国 | 60 | invasion | **所属舰队群** | 无 | 舰队内部 | 直接作战指挥 |
| space_fleet_deputy | 帝国 | 50 | invasion | **所属舰队群** | 无 | 舰队内部 | 直接作战指挥 |
| intel_minister | 共通 | 40 | defense | 情报单位 | 情报预算 | 情报人事 | 敌情信息优先获取 |
| defense_commander | 共通 | 20 | defense | 驻地防卫 | 驻地资源 | 驻地人事 | 要塞防御加成 |
| fleet_commander | 共通 | 10 | invasion | **本舰队** | 无 | 本舰队长官 | 舰队战术决策 |
| fleet_staff | 共通 | 2 | 无 | 辅助指挥 | 无 | 无 | 建议权 |
| council | 同盟 | 100 | 全部 | 全军 | 全额 | 全权 | 集体决议 |
| joint_ops_chief | 同盟 | 80 | invasion, defense | **全军战略调动** | 无 | 军令人事 | 战略部署权 |
| joint_ops_deputy | 同盟 | 50 | invasion | 辅助战略调动 | 无 | 辅助人事 | 代理权 |
| none | 共通 | 0 | 无 | 无 | 无 | 无 | — |

### 5.3 舰队归属规则

#### 数据结构变更

```typescript
// types/game.ts — StrategicFleet 接口新增字段

export interface StrategicFleet {
  // ... 现有字段保持不变 ...

  // === 新增：舰队归属字段 ===
  parentCommanderId: number | null;  // 归属的上级司令 (space_fleet_commander 或 space_fleet_deputy 的 Admiral.id)
                                       // null = 无上级，独立舰队
  fleetNumber: number;                // 舰队番号 (如 1 = 第1舰队, 13 = 第13舰队)
                                       // 0 = 未编号/临时编组
}
```

#### 归属规则

| 规则 | 说明 |
|------|------|
| 帝国舰队分割 | 皇帝将帝国宇宙舰队一分为二：第 1-9 舰队归 `space_fleet_commander`（谬肯贝尔加），第 10-18 舰队归 `space_fleet_deputy`（莱因哈特） |
| 平级汇报 | 两位司令官**互不隶属**，各自直接向统帅本部总长汇报 |
| 分舰队归属 | 每个 `fleet_commander` 的 `parentCommanderId` 指向其所属的上级司令 |
| 同盟舰队 | 同盟只有一个 `space_fleet_commander`（罗波斯），所有分舰队 `parentCommanderId` 均指向该司令 |
| 防卫舰队 | `defense_commander` 管辖的驻防舰队 `parentCommanderId` 为 null（独立于舰队序列） |
| 临时编组 | 玩家/AI 可创建临时舰队，`parentCommanderId` 为 null，`fleetNumber` 为 0 |

#### 初始化逻辑（伪代码）

```typescript
function initFleetAssignment(admirals: BaseAdmiral[], fleets: StrategicFleet[]): void {
  // 帝国侧
  const empireCommander = admirals.find(a => a.role === 'space_fleet_commander');  // 谬肯贝尔加
  const empireDeputy = admirals.find(a => a.role === 'space_fleet_deputy');        // 莱因哈特

  fleets.forEach((fleet, idx) => {
    if (fleet.factionId === EMPIRE_FACTION_ID) {
      // 偶数舰队归司令长官，奇数舰队归副司令（或其他分割策略）
      if (fleet.fleetNumber <= 9) {
        fleet.parentCommanderId = empireCommander?.id ?? null;
      } else {
        fleet.parentCommanderId = empireDeputy?.id ?? null;
      }
    } else {
      // 同盟侧：全部归罗波斯
      const allianceCommander = admirals.find(a => a.role === 'space_fleet_commander' && a.faction === 'alliance');
      fleet.parentCommanderId = allianceCommander?.id ?? null;
    }
  });
}
```

---

## 6. 数据迁移方案

### 6.1 hiddenStats → tags 映射规则

现有 `hiddenStats` 三个维度 → 标签的映射逻辑：

#### 6.1.1 野心 (ambition: 0-100) → 政治立场 + 人格特质

| ambition 值 | 映射标签 | 说明 |
|------------|---------|------|
| ≥ 85 | `ambition_faction` | 极高野心 → 野心派 |
| 70-84 | `opportunist` (若无 `righteous` 冲突) | 高野心 → 投机 |
| 30-69 | （无额外标签） | 中等野心 → 不触发 |
| ≤ 20 | （无额外标签，但可标注 `righteous` 如果 righteousness 也高） | 低野心 → 忠诚 |

#### 6.1.2 义理 (righteousness: 0-100) → 人格特质

| righteousness 值 | 映射标签 | 说明 |
|-----------------|---------|------|
| ≥ 80 | `righteous` | 高义理 → 义理型 |
| 60-79 | `realist` (若无 `idealist` 冲突) | 中高义理 → 现实主义 |
| 40-59 | （无额外标签） | 中等 → 中立 |
| ≤ 30 | `opportunist` (若无 `righteous` 冲突) | 低义理 → 投机 |

#### 6.1.3 相性 (compatibility: 0-100) → 派系归属参考

相性不直接映射为单个标签，而是用于**派系聚类**的参考值：
- compatibility 相近（差值 ≤ 15）的提督倾向于归入同一派系
- compatibility ≥ 75 → 倾向 `royalist`（帝国）或 `democrat`（同盟）
- compatibility ≤ 35 → 倾向 `ambition_faction`（异类/野心派）

#### 6.1.4 数值属性 (stats) → 能力倾向 + 军事风格

| stats 条件 | 映射标签 |
|-----------|---------|
| `command ≥ 80` 且 `attack ≥ 80` | `tactician` + `frontal_assault` |
| `command ≥ 75` 且 `mobility ≥ 70` | `tactician` + `mobile_raid` |
| `operations ≥ 85` 且 `intelligence ≥ 80` | `strategist` |
| `operations ≥ 80` 且 `defense ≥ 70` | `counter_defense` |
| `operations ≥ 90` 且 `command < 50` | `administrator` |
| `intelligence ≥ 85` | `intel_focus` + `high_iq` |
| `defense ≥ 80` 且 `attack < 50` | `cautious` |
| `attack ≥ 85` 且 `defense < 50` | `aggressive` |

#### 6.1.5 特殊人物手动标注

以下关键人物需**手动标注**，不依赖自动映射：

| 人物 | id | 标签（手动） | 理由 |
|------|-----|------------|------|
| 莱因哈特 | 81 | `[reformer, militarist, ambition_faction, high_charisma, high_iq, tactician, strategist, frontal_assault, aggressive]` | 原著核心设定 |
| 谬肯贝尔加 | 82 | `[aristocrat, royalist, cautious, counter_defense, administrator]` | 保守派老将 |
| 杨威利 | 156 | `[democrat, pacifist, high_iq, idealist, strategist, mobile_raid, intel_focus, cautious]` | 同盟天才 |
| 奥贝斯坦 | 10 | `[reformer, ruthless, realist, high_iq, strategist, intel_focus]` | 冷酷谋士 |
| 佛瑞德李希四世 | 181 | `[aristocrat, royalist, opportunist, realist]` | 昏庸皇帝 |
| 艾伦博克 | 7 | `[royalist, administrator, cautious]` | 军务尚书 |
| 斯坦赫夫 | 34 | `[royalist, strategist, administrator]` | 统帅本部总长 |
| 罗波斯 | 164 | `[democrat, cautious, counter_defense, administrator]` | 同盟老将 |

### 6.2 迁移函数

```typescript
// utils/tagMigration.ts

import type { BaseAdmiral, AdmiralTag } from '../types/game';

/**
 * 将旧 hiddenStats + stats 自动映射为标签数组
 * 注意：自动映射仅作为兜底，关键人物应手动标注
 */
export function migrateHiddenStatsToTags(admiral: BaseAdmiral): AdmiralTag[] {
  const tags: AdmiralTag[] = [];
  const { hiddenStats, stats } = admiral;
  if (!hiddenStats || !stats) return tags;

  // === 野心 → 政治立场/人格 ===
  if (hiddenStats.ambition >= 85) {
    tags.push('ambition_faction');
  } else if (hiddenStats.ambition >= 70 && hiddenStats.righteousness < 60) {
    tags.push('opportunist');
  }

  // === 义理 → 人格特质 ===
  if (hiddenStats.righteousness >= 80) {
    tags.push('righteous');
  } else if (hiddenStats.righteousness <= 30 && hiddenStats.ambition > 50) {
    if (!tags.includes('opportunist')) tags.push('opportunist');
  }

  // === 相性 → 派系倾向（仅作参考，具体派系标签由手动标注） ===
  if (admiral.faction === 'empire' && hiddenStats.compatibility >= 75) {
    tags.push('royalist');
  }

  // === 能力倾向（基于 stats） ===
  if (stats.operations >= 85 && stats.intelligence >= 80) {
    tags.push('strategist');
  } else if (stats.command >= 75 && (stats.attack >= 75 || stats.mobility >= 70)) {
    tags.push('tactician');
  }

  if (stats.operations >= 90 && stats.command < 50) {
    tags.push('administrator');
  }

  // === 军事风格 ===
  if (stats.command >= 80 && stats.attack >= 80) {
    tags.push('frontal_assault');
  } else if (stats.command >= 75 && stats.mobility >= 70) {
    tags.push('mobile_raid');
  }

  if (stats.defense >= 80 && stats.attack < 50) {
    tags.push('cautious', 'counter_defense');
  } else if (stats.attack >= 85 && stats.defense < 50) {
    tags.push('aggressive');
  }

  if (stats.intelligence >= 85) {
    tags.push('high_iq', 'intel_focus');
  }

  // 去重
  return [...new Set(tags)];
}

/**
 * 存档兼容：加载时确保每个 admiral 都有 tags
 */
export function ensureTags(admiral: BaseAdmiral): AdmiralTag[] {
  if (admiral.tags && admiral.tags.length > 0) {
    return admiral.tags;
  }
  // 旧存档：自动迁移
  return migrateHiddenStatsToTags(admiral);
}
```

### 6.3 存档兼容策略

```
存档加载流程:
  1. 读取存档 JSON
  2. 遍历每个 admiral:
     ├─ 有 tags 字段且非空 → 直接使用 (新存档)
     └─ 无 tags 或为空 → 调用 ensureTags() 自动迁移 (旧存档)
  3. hiddenStats 字段保留不删（过渡期共存）
  4. 新逻辑只读 tags，不读 hiddenStats
  5. 保存存档时写入 tags（旧 hiddenStats 也写入以兼容更旧版本）
```

---

## 7. 算法改造要点（P1 详情）

### 7.1 AI 投票算法改造

**现有逻辑**（基于 hiddenStats）：
```typescript
// 旧：读数值
supportScore += (voter.hiddenStats.ambition - 50) * 0.6;
supportScore -= (voter.hiddenStats.righteousness - 50) * 0.3;
```

**新逻辑**（基于 tags）：
```typescript
// 新：读标签，用第4节定义的影响系数
function calculateAIVote(voter: BaseAdmiral, proposal: Proposal, proposer: BaseAdmiral): boolean {
  let score = 50;

  // 1. 政治立场标签影响
  voter.tags.forEach(tag => {
    const coef = POLITICAL_VOTE_COEFFICIENTS[tag]?.[proposal.type] ?? 0;
    score += coef * 30; // 系数 ×基础权重
  });

  // 2. 提案人与投票人的标签兼容性
  const compatibility = calculateTagCompatibility(voter.tags, proposer.tags);
  score += compatibility; // -20 ~ +20

  // 3. 职务影响（保留现有逻辑）
  const roleInfluence = ROLE_VOTE_INFLUENCE[voter.role]?.[proposal.type] ?? 0;
  score += roleInfluence;

  // 4. 随机扰动
  score += (Math.random() * 20 - 10);

  return score >= 60;
}
```

### 7.2 标签兼容性计算

```typescript
function calculateTagCompatibility(tagsA: AdmiralTag[], tagsB: AdmiralTag[]): number {
  let score = 0;

  // 政治立场：相同立场 +15，对立立场 -20
  const politicalA = tagsA.filter(isPoliticalTag);
  const politicalB = tagsB.filter(isPoliticalTag);
  const sharedPolitical = politicalA.filter(t => politicalB.includes(t));
  score += sharedPolitical.length * 15;

  // 对立标签检测
  ANTAGONISTIC_TAGS.forEach(([a, b]) => {
    if (tagsA.includes(a) && tagsB.includes(b)) score -= 20;
    if (tagsA.includes(b) && tagsB.includes(a)) score -= 20;
  });

  // 人格特质：righteous 与 opportunist 冲突 -15
  if (tagsA.includes('righteous') && tagsB.includes('opportunist')) score -= 15;

  return Math.max(-20, Math.min(20, score));
}
```

---

## 8. 待确认问题

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| Q-1 | 帝国宰相 (prime_minister) 目前数据中无人担任此职位。斯坦赫夫 [id:34] 现为 `high_command_chief`，是否应同时担任或改任宰相？ | 影响指挥链完整性 | 建议确认：帝国宰相是否由另一个人担任，或该职位暂缺 |
| Q-2 | 舰队分割策略：第1-9归谬肯贝尔加、第10-18归莱因哈特——是否按此数字分割？还是按其他规则（如按现有 assignedFleetId）？ | 影响 `initFleetAssignment` 实现 | 建议确认分割方式 |
| Q-3 | 标签数量上限：一个人物最多标注几个标签？当前设计约 4-6 个（每类 1-2 个） | 影响 UI 和数据体积 | 建议：政治 1 个、军事 1-2 个、人格 1-2 个、能力 1 个，上限 6 个 |
| Q-4 | 同盟侧是否有 `space_fleet_deputy`？现有数据中同盟只有一个 `space_fleet_commander`（罗波斯 [id:164]）。同盟是否需要副司令？ | 影响同盟指挥链对称性 | 建议确认同盟是否也设副司令职位 |
| Q-5 | 183 人物的标签标注工作量较大。是否优先标注关键人物（约 30 人：各舰队司令+高层），其余用自动映射兜底？ | 影响 P0-3 完成时间 | 建议：P0 阶段手动标注 ~30 名关键人物 + 自动迁移兜底其余，P1 阶段逐步完善 |
| Q-6 | `joint_ops_deputy`（统合作战本部次长）目前数据中也无人担任。是否需要补人？ | 影响同盟指挥链 | 建议确认是否暂缺或需补人 |
| Q-7 | 旧存档中 `StrategicFleet` 没有 `parentCommanderId` 和 `fleetNumber` 字段，加载旧存档时这两个字段默认值如何设置？ | 影响存档兼容 | 建议：`parentCommanderId` 默认 null，`fleetNumber` 默认 0，加载后调用 `initFleetAssignment` 补全 |

---

## 附录 A：标签互斥规则汇总

```
政治立场互斥组（同一人物最多选 1 个）:
  aristocrat ↔ reformer ↔ democrat ↔ militarist ↔ pacifist ↔ ambition_faction
  (royalist 可与 aristocrat 共存)

军事风格互斥组:
  cautious ↔ aggressive
  frontal_assault ↔ mobile_raid

人格特质互斥组:
  ruthless ↔ righteous
  idealist ↔ realist
```

## 附录 B：标签数量统计

| 分类 | 标签数 | 建议每人物标注数 |
|------|--------|---------------|
| 政治立场 | 7 | 1-2 |
| 军事风格 | 8 | 1-2 |
| 人格特质 | 8 | 1-2 |
| 能力倾向 | 5 | 1 |
| **合计** | **28** | **4-6** |
