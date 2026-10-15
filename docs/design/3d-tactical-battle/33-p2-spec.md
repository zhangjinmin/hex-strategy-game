# 33-P2 · 提督配置带过来（部队组成 + 阵型）

> 承接 P1（统一生成入口）。P2 目标 = 用户原话：「**选了提督，默认就带过来他的阵型配置和舰队组成**」。
> 流程同 P1：**多人做 → 反对（红队）→ 测试（审核）→ 总审核（lead）**。

---

## 0. 病灶定位（已核实，两处）

| # | 现状代码 | 问题 |
|---|---|---|
| 1 | `composition: this.skirmishCompositionFor(this.skirmishMilRank(admInfo.rank), admInfo.faction)`（`BattleScene.ts:5146`，敌方在 `:5217`） | **只看「军衔 + 阵营」**，**不看提督本人** ⇒ 同军衔同阵营的提督部队组成完全相同 |
| 2 | `formation: ['wedge','line','spindle','circle','square'][Math.floor(Math.random() * 5)]`（`:1570`，`spawnInitialFleets` 内） | **阵型是纯随机** ⇒ **完全忽略提督风格** |
| 3 | `deck: isSimMode ? simFullDeck(admInfo.faction) : admInfo.deck`（`:5139`） | `simFullDeck` 硬编码 8 艘；`admInfo.deck` 全为空数组 |
| — | `resolveAdmiralDoctrine(tags)`（`retreatDoctrine.ts:52`，**已存在**） | 能产出提督的 **`formation`** / `attackMod` / `retreatThreshold`（源自 `MILITARY_STYLE_PARAMS`）—— **但当前只被用于撤退逻辑，未接到 composition/formation** |

**⇒ 结论：`formation` 的真源已经有了，只是没接；`composition` 需要新建推导。**

---

## 1. 目标（可验收）

1. **选了不同提督 ⇒ 部队组成不同**（同军衔同阵营也须不同，若风格不同）
2. **选了不同提督 ⇒ 阵型不同**（且**不再随机**）
3. **重点提督有手工定制配置**（莱因哈特 / 杨威利等，见 §3）
4. **`MILITARY_STYLE_PARAMS` 是阵型唯一真源**（不新建第二套阵型表）
5. **难度仍只作用在「敌方编制/属性」层**，不改任何战斗规则（保持 P1 的"两轨同源"成果）

---

## 2. 接口（新增）

**新建 `frontend/src/config/admiralDoctrine.ts`**（纯数据 + 纯函数，零副作用）：

```ts
/** 提督标准部队组成（兵力数；总规模由军衔/编制预算决定） */
export interface AdmiralFleetComposition {
  battleships: number;
  cruisers: number;
  destroyers: number;
  carriers?: number;
  fighters?: number;
  supplies: number;
}

export interface AdmiralCompositionInput {
  /** 阵营（'empire' | 'alliance' | …） */
  faction: string;
  /** 军事风格标签（来自 resolveAdmiralDoctrine(tags).styleTag，可为 null） */
  styleTag: MilitaryTag | null;
  /** 军衔档位（决定规模；沿用现有 skirmishMilRank 的语义） */
  milRank: number;
  /** 提督 id（用于命中重点提督覆盖表；不传则跳过覆盖） */
  admiralId?: number;
}

/** ★ 提督标准编制的唯一入口：覆盖表 > 基准表（faction × styleTag）> 兜底 */
export function resolveAdmiralComposition(input: AdmiralCompositionInput): AdmiralFleetComposition;
```

**设计要点**：
- **基准表**：`BASE_COMPOSITION_BY_FACTION`（帝国 = 巨舰大炮；同盟 = 空母/舰载放飞）×
  `STYLE_BIAS[styleTag]`（如 `frontal_assault` → 战列权重↑；`mobile_raid` → 驱逐/巡洋↑；`logistics_focus` → 补给↑）
  ⇒ **两级相乘/加权，避免 182×8 全手写**
- **覆盖表**：`ADMIRAL_COMPOSITION_OVERRIDES: Record<number, Partial<AdmiralFleetComposition>>`
  ⇒ **只写少数重点提督**（用户未指定名单 ⇒ 先放 3~5 个代表性的，其余走基准）
- **军衔缩放**：`milRank` 只改**总量**，不改**比例**（比例由 faction×style 决定）

---

## 3. 改动点（`BattleScene.ts`，仅 2~3 处）

| 位置 | 改动 |
|---|---|
| `:5146`（玩家侧 composition） | 改调 `resolveAdmiralComposition({ faction, styleTag: resolveAdmiralDoctrine(admInfo.tags).styleTag, milRank, admiralId: admInfo.id })` |
| `:5217`（敌方 composition） | 同上（敌方提督同样带自己的风格） |
| `:1570`（`formation: 随机`） | 改为 **`resolveAdmiralDoctrine(fleet.admiralTags).formation`**（**删除 `Math.random()`**） |

**⚠ 注意**：`formation` 的取值必须来自 `admiralTags`。当前 `spawnInitialFleets` 处是否能拿到该舰队的 `admiralTags`？**实现者必须先确认**；若拿不到，需要把 `admiralTags` 透传到该作用域（属允许的接线改动，但要**最小化**）。

---

## 4. 验收标准（三方各自的口径）

| 角色 | 验收 |
|---|---|
| **实现** | `tsc` 0；全量台架全绿；新增台架断言全绿 |
| **红队（反对）** | 攻：① 是否**真的**不再随机（把 `Math.random` 塞回去 ⇒ 断言必须 FAIL）② 基准推导是否**只改比例不改总量**③ 覆盖表是否真生效且**不误伤**未列出的提督 ④ 是否有"同军衔同阵营 ⇒ 仍相同"的漏网 ⑤ 是否偷偷改了战斗规则（P2 不得动规则） |
| **审核** | 独立：跑门槛 + 独立构造若干提督对，验证 composition/formation **确实不同** + 覆盖表命中 + 生产码 diff 范围 |
| **总审（lead）** | 交叉裁决 + 收口 + 提交 |

**新增台架** `scripts/admiralDoctrineSim.cjs`（必须含**变异可捕获性**断言）：
1. **不同风格 ⇒ 不同 composition**（同 faction 同 milRank，styleTag 不同 ⇒ 结果不同）
2. **重点提督 ⇒ 走覆盖**（覆盖值生效；且未列出的提督走基准）
3. **`formation` 来自 `resolveAdmiralDoctrine`**（对每个 `MilitaryTag` ⇒ 期望阵型逐项断言，**禁止随机**）
4. **军衔只改总量不改比例**（两个 milRank 下，比例一致、总量不同）
5. **变异自检**：把 `resolveAdmiralComposition` 里的 styleTag 分支短路 ⇒ 断言 1 **必须 FAIL**

---

## 5. 明确不做（防蔓延）

- **不动** battle 内的战斗规则（`classType` 语言 / `def` / `mods` 公式）—— 那是 P3
- **不动** 棋盘格 / 部署阶段 UI —— 那是 P4
- **不动** 战后结算 —— 那是 P5
- **不动** `deployAdj` / AI 托管 —— 那是 P6
- **不新建第二套阵型表**（`MILITARY_STYLE_PARAMS` 是唯一真源）

---

## 6. 未决假设（lead 已按建议默认推进，若用户要改请提出）

1. **提督配置初始化**：采用「**按 faction × styleTag 推基准 + 少数重点提督手工覆盖**」（不手写 182 个）
2. **难度作用层**：**只改敌方 composition/规模**，不改规则
3. **`admiralsData.deck`**：**保留字段（兼容）但演习不再依赖它**（改读 `resolveAdmiralComposition`）
