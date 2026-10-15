# P2 验收报告：提督配置带过来（部队组成 + 阵型）

日期：2026-10-15。流程：**多人做 → 反对（红队）→ 测试（审核）→ 总审核（lead）**，三轮迭代。

---

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `frontend/src/config/admiralDoctrine.ts` | **新增** —— `resolveAdmiralComposition()`（组成）+ `resolveAdmiralStyleTag()`（**风格唯一入口**）+ `deriveStyleTagFromStats()` + `ADMIRAL_COMPOSITION_OVERRIDES`（5 提督） |
| `frontend/src/game/scenes/BattleScene.ts` | `initFactions` 写 `fac.admiralStyleTag`（基础 stats 算得）；**4 个 formation 站点**（`:987` AI 1Hz / `:1106` 玩家 deployFormation / `:1337` planFactionBattle / `:1595` spawn）+ 2 处 composition 统一走新入口 |
| `scripts/admiralDoctrineSim.cjs` | **新增** —— 台架 **68 断言** |

**门槛**：`vue-tsc` EXIT=0 · 全量台架 **32/32** · 新台架 **68 断言 0 FAIL**

---

## 2. 三轮迭代（每轮都有"被证伪"的产出）

| 轮次 | 红队发现 | 处置 |
|---|---|---|
| **1** | **`:1576` 的阵型改动是死代码** —— 被 `activateDeployPhase` 的 `:1129 pFleet.formation = deployFormation`（默认 `'wedge'`）覆盖；**玩家可见阵型行为逐位不变** | 补救 1：`:1094-1101` 在 `activateDeployPhase()` **之前**用提督教范初始化 `deployFormation` |
| **1** | **47.8%（87/182）提督无军事标签** ⇒ 组成仍是通用基准（**182 人只产出 22 种**） | 补救 1：`deriveStyleTagFromStats` 用 `stats` 推导风格 ⇒ 无标签组成 **2 → 12 种** |
| **2** | 补救 1 **只喂 composition、不喂 formation** ⇒ 87 人阵型仍恒 `wedge` | 补救 2：`resolveAdmiralStyleTag` 提升为**共同真源** ⇒ 无标签 formation **1 → 4 种** |
| **3** | **`applyStanceToFleet(:5075)` 是第 5 个写者**（只读 `admiralTags`）⇒ 无标签提督**命令后阵型**与默认脱节 | **裁决：不影响 P2 目标**（不覆盖开局/推进路径，仅由指令分发器触发）⇒ **记 P3 待办** |
| **3** | **9.8% 的"同阵营无标签不同 stats"对** formation 会撞（8 风格 → 5 阵型必然多对一） | **覆盖率天花板，非 bug** ⇒ 如实上报 |
| **3** | 台架 `:506` 注释称"**完全等价**"（`stats` 缺失时不成立） | **已修**（lead 收口） |

---

## 3. 最终效果（三方独立统计，口径一致）

| 指标（@milRank10） | 修复前 | 修复后 |
|---|---|---|
| **玩家可见开局阵型** | **恒 `wedge`** | **提督教范阵型** |
| composition 种类数（全部 182） | 2 | **21** |
| composition 种类数（无标签 87） | 2 | **12** |
| formation 种类数（无标签 87） | **1（恒 wedge）** | **4** |

覆盖表 5 提督（**81 莱因哈特 / 156 杨威利 / 80 米达麦亚 / 62 毕典菲尔特 / 100 亚典波罗**）命中且与基准不同。

---

## 4. 行为不变性（逐位验证）

| 项 | 结果 |
|---|---|
| **有标签提督 95 名** | `resolveAdmiralStyleTag(tags,stats) === resolveAdmiralDoctrine(tags).styleTag` ⇒ **零不一致**；formation/composition **逐位 0 差异** |
| **战役轨** | `resolveAdmiralStyleTag(undefined, undefined) === null`（三组测试）⇒ 回落 `wedge` ⇒ **逐位不变** |
| **未触碰战斗规则** | 正则过滤 diff（`classType\|def\|mods\|damage\|hpMul\|attackMod\|retreatThreshold`…）⇒ **0 命中** |

---

## 5. 台架有效性（红队的真实变异测试）

在**镜像目录**里施加 5 组真实变异，全部被断言捕获：

| 变异 | 结果 |
|---|---|
| `:987` 改回只读 `admiralTags` | **FAIL §7.6+§7.7** |
| `:1595` 改回只读 `admiralTags` | **FAIL §7.6+§7.7** |
| `:1106` 改回硬编码 `'wedge'` | **FAIL §6.1/6.2/6.3/6.5 + §7.6/7.7** |
| 删玩家侧 `admiralStyleTag` 写入 | **FAIL §7.6** |
| `deriveStyleTagFromStats` 短路 | **FAIL §6.7/6.9/6.11 + §7.1/7.2/7.4** |

参照系独立性：§2 用**独立重写**的最大余数法；§3/§7.3 用 `tagConfig.MILITARY_STYLE_PARAMS` **真源**；§6.9/§7.1 用**手写 stats 构造** ⇒ **未发现 `f(x)===f(x)` 自证**。

---

## 6. 未覆盖面与已知边界（不掩盖）

| 项 | 状态 |
|---|---|
| **真机端到端** | ❌ 未跑（node 台架无法实例化 Pinia store）⇒ 沿用 P1 定下的规矩：**每期安排"战术模拟实跑"验收** |
| **台架覆盖盲区** | production 接线主要靠**字符串计数正则**（能抓"接线丢失"，抓不到"字段写错/传错 stats"等语义错误）；**运行时语义断言需真机** |
| **`applyStanceToFleet` 口径缺口** | 87 名无标签提督**命令后**阵型仍走旧硬编码表（P3 待办） |
| **formation 覆盖率天花板** | 8 风格 → 5 阵型 ⇒ **9.8%** 的同阵营无标签对会撞（composition 仍不同） |
| **帝国高速战列舰** | 新基准/风格表**不含 `fastBattleships`** ⇒ **帝国演习不再出高战**（总量守恒、并入战列）⇒ **待用户确认是否接受** |
| **工具缺陷** | 仓库自带的批量台架脚本**会"假红"**（把断言名里的"必须 FAIL"与汇总行"0 FAIL"误判为失败）⇒ **全量台架必须以逐个 + 退出码口径复跑** |

---

## 7. 方法论沉淀（本轮新增）

1. **"改了一行" ≠ "行为变了"** —— 必须查**调用顺序与后续覆写**（本轮 `:1576` 死代码的教训：改动被同帧的 `activateDeployPhase` 覆盖）
2. **"部分达成"是最危险的状态** —— 补救 1 只做了 composition，红队立刻指出"formation 仍恒 wedge"；**指标要建在正确的子集上**（"无标签子集 1→4"而非"全量 5→5"）
3. **指标口径本身会被推翻**：实现者两次修正 lead 的预期指标（"全量种类数是理论上界"、"formation 全量不变但分布变了"）
4. **"统一入口"要全仓扫描写者** —— 红队扫出**第 5 个写者**；漏一个就等于没统一
