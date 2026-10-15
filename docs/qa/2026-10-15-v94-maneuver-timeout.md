# v94 机动相位超时兜底（修"舰队永久冻结"）+ 对战全链路梳理

日期：2026-10-15。用户实报：
> 我方舰队都不动，就停在原地，下达军议命令也不会有任何动作
> **战斗只有我一个人在打，友军还是有问题的，你应该将对战的所有代码都做个梳理，
> 现在已越改越烂了**

---

## 1. ⚠ 修复：机动相位无超时 ⇒ 永久 `hold` ⇒ 舰队冻结

### 根因（`combatControl.ts:66-89`）

```ts
if (state.phase === 'reform' && input.reformed) { return { phase: 'cruise', ... }; }
return { ...state, phaseSeconds: elapsed, motion: maneuverOrder(state.phase).motion };
//                                    ↑ 只累加，从未用于超时判定
```

`brake` / `turn` / `reform` 的**退出条件全部依赖物理量收敛**：

| 相位 | 退出条件 |
|---|---|
| `brake` | `input.stopped`（速度 < 0.02） |
| `turn` | `input.headingError ≤ π/24` |
| `reform` | `input.reformed`（阵面收敛 + `maxSlotGap ≤ 6`） |

而 `phaseSeconds` **只累加、从不判定** ⇒ 一旦因**友/敌 200px 排斥力、地形阻挡、
阵位冲突**导致永不收敛，就**永久停在 `motion === 'hold'`**
⇒ `BattleScene.ts:7439` 把 `rawVX/rawVY` **清零** ⇒ **舰队完全不动**。
（命令改的是"目标"，而 `hold` 清零点在目标解算之后 ⇒ 命令也无效。）

### 修复：`MANEUVER_PHASE_TIMEOUT`

```ts
export const MANEUVER_PHASE_TIMEOUT = { brake: 5, turn: 35, reform: 10 } as const;
```

在正常转移之后追加**安全阀**（超时强制推进下一相位）：

| 相位 | 超时 | 强制转到 |
|---|---|---|
| `brake` | 5s | `turn` |
| `turn` | 35s | `reform` |
| `reform` | 10s | `cruise` |

⇒ **任何相位停留时间有上界 ⇒ 不会永久 hold ⇒ 不会冻结**。

⚠ 取值依据：`turn` 35s 覆盖"大编队 180° 掉头最慢 28.8s"
（见 `shipKinematics.turn180Seconds`）；`brake`/`reform` 的正常耗时都只需数秒。

## 2. 对战全链路梳理结论（后台调研）

### 2.1 AI 决策是**通用**的，不是 AI 专属

- **每帧唯一战术入口** = `update()` 的 `globalFleets.forEach`（`BattleScene.ts:5895`）
  —— **玩家舰队与 AI 舰队走完全同一套战术逻辑**（接敌/开火/包夹/撤退）
- 差异只有 **2 处**：
  1. **1Hz 战略层跳过玩家**：`BattleScene.ts:871` `if (aiFac.type === 'player') continue;`
     （⇒ 玩家舰队不会被自动设 `stance` / 阵型 / 避战窗）
  2. **停滞看门狗跳过玩家**：`BattleScene.ts:6281` `myFac.type !== 'player'`
- `playerControlled: myFac.type === 'player'`（`:6182`）的**唯一消费点**是
  `CommandAuthority.ts:361,365` 的 **label 文案**（`'保持部署'` vs `'警戒'`）——
  **对行为零影响**。

### 2.2 "友军不参战"的真实成因（非"单舰队闸门"）

| # | 成因 | 证据 |
|---|---|---|
| 1 | **非总指挥舰队没有任务时不主动出击** —— 只在自己视野内出现"完全识别（full）"敌人时接敌（`dist < 0.35×vision`） | `aiDirector.ts:44-49` |
| 2 | **`stance==='defend'` ⇒ 站桩**：`fleetTarget = 自身`（`:7026`），且 `:7435` 的守卫 `stance !== 'defend'` 直接排除速度项 ⇒ **即使接战也不推进**（`:6668` 交战态下目标恒为自身） | `:6668` / `:7026` / `:7435` |
| 3 | 玩家阵营（`type==='player'`）**不参与 1Hz 战略评估** ⇒ 不像 AI 那样被自动驱动进攻 | `:871` |

**⇒ 结论**：**"只有我一个人在打"主要是设计使然**（玩家 = 总指挥，需为每支舰队下达任务），
叠加 `defend` 的"只对射不机动"观感。

### 2.3 命令链路（已核实通畅）

- 军议面板 `ownFactions = store.factions.filter(f => f.team===1 && f.active)`
  （`CouncilWarRoom.vue:97`）⇒ **"一支舰队"在数据上就是一个 `faction`**
- 下达 ⇒ `dispatchFleetCommand(fac.id, 'mission', m)`（`:187`）
- 消费端**先按 fleetId、再按 factionId/commanderId 兜底**（`BattleScene.ts:3296-3298`）
- `type==='mission'` 时**任何己方舰队**都可收（`:3303-3312`，无 commanderId 限制）
- ⚠ **残留风险**：若传 factionId 且该阵营**已分兵**，只会命中**母队**（分队在 `globalFleets`
  中排在其后）⇒ 给"分舰队"下任务会打到母队。

## 3. 关于"越改越烂"（我的自我评估）

本会话我连续改了 **5 个子系统**（LOD 四改 / 制动律 / 尾焰移除 / 异常隔离 / 最小尺寸），
**每轮只验证自己改的那个点，没有做跨模块回归评估**。用户的主观感受**有事实基础**。

⇒ 已写入长期记忆：**改动前先列"会经过哪些共享路径"；改动后至少真机走一遍关键流程**
（移动 / 开火 / 切档 / 命令下达），不能只看"我改的指标达标"。

## 4. 门槛

全量台架 **30/30 绿** · `vue-tsc` EXIT=0 · `go build` EXIT=0

## 5. 待用户裁决（友军方案，本轮不擅自改设计）

| 方案 | 内容 | 风险 |
|---|---|---|
| **A. 保持设计** | 明确"总指挥需给每支舰队下任务" | 零 |
| **B. 加 AI 托管开关** | 玩家阵营非旗舰舰队可切"自动作战"（放开 `:871` 的跳过） | 中 |
| **C. 默认"支援旗舰"任务** | 开局给友军默认任务 ⇒ 观感立刻改善 | 低 |

## 6. 产物

- `frontend/src/game/combatControl.ts`：`MANEUVER_PHASE_TIMEOUT` + 超时兜底
- 本台账
