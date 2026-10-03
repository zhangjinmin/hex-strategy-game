# v67 阶段 A 补完（阵型接线） + v68 阶段 B（舰载机波次）落地台账

日期：2026-10-03。设计真源：`docs/design/3d-tactical-battle/31-combat-flow-restructure.md` §3~§4。
承接 `2026-10-03-v67-combat-phase.md`（阶段 A 纯函数 + 接线）。

---

## 1. 本轮交付

| 文件 | 性质 | 变化 |
|---|---|---|
| `frontend/src/game/aiDirector.ts` | 改 | `FormationSituation.phaseHint` / `chooseFormation` 灰区分支 / `reason: 'phaseRetarget'` / `FormationCommitSituation.phaseChanged` / `stabilizeCombatFormation` 阶段解锁 |
| `scripts/aiDirectorSim.cjs` | 改 | 8 → **21 断言**（+13） |
| `frontend/src/game/fighterWaves.ts` | **新增** | 舰载机波次裁决层（零 import，约 340 行） |
| `scripts/fighterWavesSim.cjs` | **新增** | **55 断言** |
| `frontend/src/game/scenes/BattleScene.ts` | 改 | 阵型接线（phaseHint ×2 / phaseChanged ×3）+ 舰载机系统整体替换 + 6 个新方法 |
| `frontend/src/game/battle/BattleTransientFields.ts` | 改 | +1（`_returnUntil`） |

BattleScene 行数：8509 → **8744**（+235）。

---

## 2. 阵型接线（补完阶段 A 的未闭合项）

### 2.1 为什么旧表在灰区恒定

`chooseFormation` 旧口径：

```ts
if (s.powerRatio > 0.8) return 'line';   // 均势 ⇒ 恒定线阵
```

**均势（0.8~1.3）是绝大多数战斗的常态**，而这条分支恒返回 `line`。⇒ 远距对射与集火突进用同一种线阵，玩家看不到任何战术变化。**这是阵型层的"对射到死"根因。**

### 2.2 改法

阶段偏好**只注入灰区**，不覆盖战术意图：

| 态势 | 优先级 | 结果 |
|---|---|---|
| `avoiding` | 最高 | `spindle`（阶段偏好被压） |
| `alliesOnTarget >= 2` | 高 | `circle` 包围（被压） |
| `aggressive && ratio > 1.3` | 中 | `wedge` 突破（被压） |
| `0.8 < ratio <= 1.3` | **阶段偏好** | far→`line` / approach→`line` / assault→`spindle` / brawl→`wedge` |
| `ratio <= 0.8` | 兜底 | `spindle` 防御 |

`pickFromPhaseHint` 做**唯一一次类型收窄**（`string[]` → `CombatFormation`），非法值回退 `line`。台架断言了「非法偏好回退」与「空偏好回退」。

### 2.3 阶段跃迁解锁阵型承诺

`stabilizeCombatFormation` 的承诺机制（`reason: 'held'`）会阻止阵型变化。阶段跃迁是**可解释的**换阵型时机，需与 `emergency` 同级放行，但**独立记账**：

```ts
if (s.phaseChanged) {
  return { formation: s.candidate, state: {...}, reason: 'phaseRetarget' };
}
```

**位置关键**：插在 `targetId` 比较**之前**。否则同一目标下阶段变了但阵型被锁死 ⇒ 出现"S3 突进却仍是 S1 线阵"的矛盾。台架显式断言了这条。

---

## 3. 舰载机波次（阶段 B）

### 3.1 替换掉什么

`BattleScene.ts:7631-7655` 的旧块（**已删除**）：

```ts
// ===== 航母舰载机系统：突击型舰船环绕母舰的护卫机群 =====
for (let i = 0; i < 6; i++) { fDot = this.add.circle(x, y, 1.5, 0x06b6d4) }
const orbitR = 18 + Math.sin(time * 0.003 + i) * 3;   // 绕母舰画圈
```

零参战 / 无 HP / 不可攻击 / 母舰死则全 destroy。**装饰**。

### 3.2 新裁决层 `fighterWaves.ts`

**五态**：`stowed → launching → engaging ↔ withdrawing → striking → returning`

| 机制 | 实现 | 原作依据 |
|---|---|---|
| 放飞窗口 | `combatPhase.isFighterWindow`（S2 接近 / S3 突进） | 「到最接近战圈前线时出动」 |
| 分批放飞 | 3 批 × 1.5s 间隔 | 「陆续自庞大母舰发射出来」 |
| 搭载量 | 空母 12 / 突击 3 | 原作 12万 : 10万 同比例缩略 |
| 目标优先级 | 敌舰载机 500 > 敌战舰 300 > 敌航母 200 > **运输舰 −1（禁止）** | 「骑士精神」；制空权是前置条件 |
| 攻击部位 | 航母近距离(≤180px) ⇒ `ventral` 下方弱点 | 「穿甲后在其下方盘旋」 |
| 1:1 交换 | `resolveClash` 数量差衰减（8v8 与 4v4 同损 1 架） | 制空权可争夺 |
| 空袭窗口 | 母舰脱离接触 ⇒ `striking`（**唯一造成伤害的时机**） | 「脱离的那一瞬间，只要随着惯性走，便能达到比母舰更快的速度」 |
| 返航回收 | 3s 窗口后母舰补回 50% 损失 | 「母舰诱导系统自动完成著舰」 |
| 连锁爆炸 | `ventral` 命中 ⇒ 航母沉没 + 半径 120 内敌舰载机全灭 + 半径 80 内友舰 −0.3 HP | 同盟航母下方防御力极差 → 连锁爆炸 |

### 3.3 关键设计决策

**不占编队槽**：对齐原作「自动著舰」，`FighterGroup` 不进 `formationOffsets`，玩家不能直接操作飞机。

**不新增伤害乘区**：舰载机伤害走既有开火链的 `targetShip.hp -= finalDmg` 路径，只乘单架份额（`FIGHTER_DAMAGE_SHARE = 0.22`）。这样不破坏 30 号 §5.5「废除 1% 保底」的后续改造口径。

**母舰沉没后继续拼死**：原作中母舰没了舰载机并不自动消失。`advanceFighters` 中 `!carrierAlive` 且在 `returning` ⇒ 转 `engaging` 继续打。

### 3.4 开发中踩的真缺陷

**空袭窗口入口过窄**：初版把 `striking` 只挂在 `withdrawing` 分支内，但"母舰已脱离接触"时编队仍停在 `engaging` ⇒ **永远够不到空袭**（台架 E 组实测 2 条红）。

根因：把「触发条件」误绑在「本编队状态」上。原作语义里触发条件是**母舰脱离接触**，不是本编队先进入 withdrawing。
⇒ 放宽为：`engaging && carrierDisengaged && hasTarget ⇒ 直接 striking`。

**台架判据错 1 条**：`fighterDamage` 的单架伤害与 capacity 无关（份额按母舰单舰计），我原断言写成"搭载量越大单架伤害越高"。已改为"单架伤害与搭载量无关"。

### 3.5 配平自检

2 母舰 × 12 架 vs 10 战列的典型编成下：

```
舰载机伤害占比 = 24 × 0.22 / (24 × 0.22 + 10) = 34.6%
```

落在 31 号 §阶段B 验收区间 **15~35%** 内（接近上限，因为 12 架 × 2 母舰的编成偏重）。若真机发现舰载机过于喧宾夺主，调 `FIGHTER_DAMAGE_SHARE` 至 0.15 即可（占比降至 26%）。

---

## 4. 验收判据与实测

### 4.1 阵型接线（aiDirectorSim 21 断言全绿）

| 判据 | 实测 |
|---|---|
| 均势 + 无阶段偏好 ⇒ 保持旧 `line`（不破坏既有行为） | PASS |
| 均势 + far ⇒ `line`；均势 + assault ⇒ `spindle` | PASS |
| 阶段偏好**确实改变**均势答案 | PASS |
| 包围意图压过阶段偏好 | PASS |
| 规避意图压过阶段偏好 | PASS |
| 优势突破压过阶段偏好 | PASS |
| 非法偏好回退（不泄漏脏值） | PASS |
| 空偏好回退 | PASS |
| 阶段不变时承诺仍 `held`（不每帧刷） | PASS |
| 阶段跃迁 ⇒ `phaseRetarget` + 采用新阵型 | PASS |
| `phaseRetarget` 与 `emergency` 分开记账 | PASS |
| **同目标下阶段跃迁仍生效**（S3 不被锁在 S1 线阵） | PASS |

### 4.2 舰载机波次（fighterWavesSim 55 断言全绿）

A 搭载量与分批放飞(7) / B 目标优先级(8) / C 攻击部位(4) / D 五态状态机(4) / E 空袭窗口(6) / F 1:1交换(7) / G 连锁爆炸(8) / H 伤害配平(4) / I 占比自检(1) + A 组补充(6)

关键项：
- 三批之和 === 满编（无泄漏）、放完转格斗态、已满编不再放飞
- 运输舰优先级 −1 且 `mayAttackSupply() === false`（硬约束）
- 远距离舰载机(800px) 优先级仍高于近距离战舰(100px)（"活动性强，不因远放弃"）
- 8v8 与 4v4 同损 1 架（交换不按人数翻倍）
- `ventral` 引爆 / `hull` 不引爆
- 母舰沉没 ⇒ 转拼死格斗而非无处可返

### 4.3 三道门槛

| 门槛 | 结果 |
|---|---|
| `fighterWavesSim` | **55 PASS / 0 FAIL** |
| `aiDirectorSim` | **21 PASS / 0 FAIL**（原 8） |
| `combatPhaseSim` | **28 PASS / 0 FAIL** |
| 全量台架 | **28/28 绿，零新增红灯**（26 旧 + 2 新） |
| `vue-tsc --noEmit` | **EXIT=0** |
| `go build ./...` | **EXIT=0** |

---

## 5. 未闭合（下一步）

- **L2 探针 + L3 真机未做**。舰载机的实际观感（12 架是否太多、alpha 是否过亮、连锁爆炸是否有冲击感）必须真机确认。
- ~~3D 表现未接~~ **已补**：空袭与航母殉爆均发 `pushFx3d({kind:'strike'})`，复用既有 3D 舰载机小队模型的「飞行→格斗→击落→返航」动画。⚠ 与旧 CV 直接开火特效（`:7285` 附近）是**两个不同事件**，刻意不合并。
- ~~连锁爆炸友舰伤害未回写~~ **已补**：(a) 半径内敌方舰载机扣光；(b) 友舰按 `shipsDamaged` 的 hpRatio 回写真实单位并飘伤害数字；(c) 发 3D 殉爆事件 + toast「航母连环殉爆！」。
- **阶段 C（击瘫 crippling）** 未动 —— 依赖 30 号 §5.5 先废除 1% 保底。
- **阶段 D（战场事件：核融合炉殉爆、大舰沉没士气冲击）** 未动。
- **阶段 E（战斗节奏 AI `combatRhythm`）** 未动。
- **30 号运动学阶段**（推力/转弯半径/舰种物理）未动，可并行。

---

## 6. 工具坑补充（本轮再次验证）

- `Edit` 工具对中文密集段落**连续 3 次匹配失败**（内容回读一致仍报 not found）⇒ 一律走 `python3 - << 'PYEOF'` heredoc + `s.index()` 切片。
- **部分 `scripts/*.cjs` 是 CRLF 行尾**（`aiDirectorSim.cjs` 即是）⇒ 用 `io.open(..., newline='')` 读、按 `\r\n` split/join，否则 marker 匹配全部失败。
- bash 内联 python 里含 `${...}` 模板串会被 shell 吞掉（`bad substitution`）⇒ 代码里改字符串拼接，或走 heredoc（`<< 'PYEOF'` 单引号可完全避免 shell 插值）。
