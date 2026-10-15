# P1 三方评审结论（实现 / 反对 / 审核 → 总审裁决）

日期：2026-10-15。P1 = 统一舰队生成入口（`docs/design/3d-tactical-battle/33-p1-spec.md`）。
按用户要求采用**对抗式分工**：**一个做 → 一个反对 → 一个审核 → 最后总审**，品质优先。

---

## 1. 三方角色与结论

| 角色 | 承担者 | 结论 |
|---|---|---|
| **实现** | general-purpose-1 | 交付 `fleetGeneration.ts`（118 行）+ 两轨改造 + 台架 74 断言；tsc 0 / 全量台架 31/31；自报 54/54 组逐字段相等 |
| **反对（红队）** | Explore-1 | **未能证伪**"零行为变化"（独立重建 3 条旧调用路径 × 30+ 组极端输入 ⇒ **差异 0**）；**但抓到台架第 4 类"自证"缺陷** |
| **审核** | Explore-2 | **PASS**（独立对比 **198 组** ⇒ **差异 0**；逐字复刻 `serializeTacticalFleet` 三分支 ⇒ 5/5 等价；契约边界实测正确） |
| **总审** | lead | **P1 核心通过**；台架须补强；记入 1 项连带改动与 2 项遗留缺口 |

---

## 2. 双向收敛的证据（两条独立路径得同一结论）

| 检查项 | 红队（Explore-1） | 审核方（Explore-2） |
|---|---|---|
| 独立对比组数 | 30+ 组极端输入（含 `visualCount` 0/-1/NaN/10000、`coordSource` 畸形、`campaignMods` 含 0/NaN/-3） | **198 组**（5 编制 × 多 vc × 2 mode × 3 troopOf × 3 coordSource） |
| 差异数 | **0** | **0** |
| `??` vs `\|\|` | 实测 `hpMul=0` ⇒ 实得 **0**（若用 `\|\|` 会变 1）✓ | 同样实测 ⇒ **0** ✓ |
| 门槛 | tsc EXIT=0；fleetGenerationSim 74 PASS；shipModelResolutionSim 61 PASS | 独立复跑：tsc 0；全量台架 **31/31**；新台架 **74 断言** |
| diff 范围 | 未触碰 §4 排除项 | 未触碰（`shipScaling.ts` 确认未被修改） |

⇒ **"零行为变化"成立**（两条独立路径一致，非单方自证）。

---

## 3. 红队的实质批评（本次评审最大价值）

**台架 `fleetGenerationSim.cjs` 第 4 类"零行为变化回放"是自证**：

```js
oldSeeds = buildTacticalUnits(c, vc, mods, troopOf, coord);   // 旧路径
newSeeds = buildFleetUnits({ ... }).seeds                      // 内部就是调同一个 buildTacticalUnits
                                          // ⇒ fleetGeneration.ts:91-97 逐个直传
```

⇒ 退化为 `f(x) === f(x)`。

| 它能抓到 | 它**抓不到** |
|---|---|
| 包装层丢参、`modsFromPartial` 破坏 4 个标量 | **调用方（BattleScene / gameStore 的 mods 公式）的回归** |

⚠ **而"调用方公式"恰恰是本次改动的实际位置** ⇒ 该断言**名不副实**。

**附加盲区**：第 3/4 类只测"全 1 / 全非零" mods ⇒ 即便 `modsFromPartial` 误用 `||`（0→1 的经典回归）也**测不出来**。

**⇒ 裁决：台架必须重写第 4 类**（改为对比『手工逐字重建的旧调用方表达式』vs『新调用方实际路径』），并补 0/NaN 边界用例。
（审核方虽用一次性脚本补过这一层，但**脚本已删** ⇒ 未来回归检测仍无效 ⇒ 必须固化进台架。）

---

## 4. 逐条裁定

| # | 争议点 | 裁定 | 理由 |
|---|---|---|---|
| 1 | 改了 `shipModelResolutionSim.cjs` 锚点 | **接受，但记入 P1 改动清单** | 红队与审核方**独立实测**：截获 730 字符、不含 `getTroopById(`、含 `troopLikeFromClass`，窗口 700→1200 **只更严**，非放水；旧锚点在新源码下**必然失配**，属必要连带。**记入清单**（诚实可追溯） |
| 2 | `gameStore` raw-slot 分支（`:3628-3631`）未走统一入口 | **P1 内可接受；记入 P3 待办** | 该分支吃 `normalizeRawSlots(persistedSlots)`（用户手点槽位），**不属** `buildFleetUnits` 的输入模型（composition+visualCount）⇒ 无法被吸收；**行为未变**（已差分确认） |
| 3 | `launchTacticalBattle` 崩溃兜底（`:3699`）未迁移 | **可接受** | 审核方核实：**该处根本不在本次 diff 内**，仍走原 `buildScaledSlots`+`applyStatsToSlots` ⇒ 无行为变化 |
| 4 | `diag` 新增字段 | **接受** | 红队全仓 grep：除台架外**无任何生产代码消费**；计算仅对 `seeds` 做只读累加（不改长度/内容/身份） |
| 5 | `troopOf` 上移定义位置 | **接受** | 纯闭包，仅捕获 `factionKey`（`:3578` 已判空 return）与全局 `getTroopById`；体在箭头函数内**惰性**求值 ⇒ 求值时机/副作用顺序不变 |
| 6 | `troopOf` / `coordSource` 两字段扩展 | **接受（记入定稿修订）** | 两轨 troop 真源与坐标源本就不同，纯函数无法内聚；不透传**做不到**零行为变化。**属 P3 收敛目标** |
| 7 | `ShipType` 从 `types/game` 导入（非定稿示例的 shipScaling） | **接受** | 核实 `shipScaling` 只 `import type` 未 re-export ⇒ **定稿示例是笔误**，现实现正确 |

---

## 5. 未覆盖面（三方一致承认）

| 项 | 状态 |
|---|---|
| **真机端到端**（Wails 内实跑演习/会战） | ❌ **三方均未覆盖**；node 台架无法实例化完整 Pinia store ⇒ 两轨"运行期真实数据"（`store.troopsData` / `getEffectiveStats` + `adminStore.technology`）未跑 |
| 模块加载顺序运行时影响 | ❌ 仅静态确认无循环依赖（`fleetGeneration` → `shipScaling`；反向仅 `import type`） |
| 视觉/坐标层 | ❌ `gridX/gridY` 已差分相等，但"实际画在哪"依赖下游消费，未跑 |

⇒ **这部分需要真机验证**（或用户在战术模拟里实际跑一局）。

---

## 6. 总审裁决

1. ✅ **P1 核心通过**：零行为变化经**两条独立路径**验证（红队 30+ 组 / 审核方 198 组，差异均为 0）
2. ⚠ **台架须补强**（已派实现者）：重写第 4 类消除自证 + 补 0/NaN 边界用例 + 把 2 个遗留缺口写成**可测断言**
3. 📝 **P1 改动清单补记**：`scripts/shipModelResolutionSim.cjs`（连带测试维护）
4. 📝 **P3 待办**：raw-slot 分支与崩溃兜底纳入统一入口；`troopOf`/`coordSource` 收敛
5. 🔬 **遗留验证**：真机端到端（建议用户在战术模拟实际跑一局；或我启动一次构建验证）
