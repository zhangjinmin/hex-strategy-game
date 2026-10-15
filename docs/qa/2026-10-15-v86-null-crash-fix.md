# v86 修复 null 崩溃导致全场停摆（受击方引用错误）

日期：2026-10-15。用户实报：
> 突然卡住不动了，但是军议面板中下达命令是能够有界面反应的，跳出了顶部的通知条，
> 但是就是舰队不动。
> 控制台：`Uncaught TypeError: Cannot read properties of null (reading '_formationCollapsed')`
> at BattleScene.ts:7941:91 → 7660:25 → BattleScene.update (5864:27)

---

## 1. 为什么"UI 有反应但舰队不动"

**异常在 `BattleScene.update` 内抛出且未捕获** ⇒ **update 循环中断** ⇒
后续所有舰队（以及所有帧）都不再更新。
而 UI 面板 / 通知条走**独立的事件路径**（不依赖 update）⇒ 仍有反应。

⇒ 这个"症状组合"本身就是**异常中断**的指纹（不是逻辑卡住）。

## 2. 根因：受击方引用错人 + 未判空

`BattleScene:7941`（旧）在 `if (targetShip)` 块内：

```ts
const tgtCollapseDefMul = collapseMuls((closestEnemyFleet as any)._formationCollapsed === true).def;
const terrainDodge = this.getTerrainDodgeMul(closestEnemyFleet.x, closestEnemyFleet.y);
```

而**受击方选的是 `fireTargetFleet`**（同块上方）：

```ts
const fireTargetFleet = (authFire === 'attack_target_only' && attackTargetFleet) ? attackTargetFleet
    : (gate.mode === 'return_fire' && attackerFleet) ? attackerFleet : closestEnemyFleet;
if (fireTargetFleet) { ... pickShip(...) -> targetShip ... }
if (targetShip) { /* 7941 却用 closestEnemyFleet */ }
```

**双重错误**：

| # | 错误 | 后果 |
|---|---|---|
| 1 | `closestEnemyFleet` 可为 `null` | **`return_fire` 模式下受击方是 `attackerFleet`**，若此时无"最近敌" ⇒ null ⇒ **抛异常 ⇒ 全场停摆** |
| 2 | 语义错 | 本块算的是"**受击方**防御乘区 / 地形闪避 / 方向装甲"，必须用**受击方** |

## 3. 修复（同块内共 7 处引用）

| 位置 | 旧 | 新 |
|---|---|---|
| `tgtCollapseDefMul` | `closestEnemyFleet._formationCollapsed` | **`fireTargetFleet._formationCollapsed`** |
| `terrainDodge` | `getTerrainDodgeMul(closestEnemyFleet.x, .y)` | **`fireTargetFleet.x, .y`** |
| `tgtSpd2` | `closestEnemyFleet.vx/vy` | **`fireTargetFleet.vx/vy`** |
| `tgtFacing` | `closestEnemyFleet.vy/vx`、`formFacing ?? facingAngle` | **`fireTargetFleet.*`** |
| `angleToAttacker` | `u.sprite.* - closestEnemyFleet.x/y` | **`fireTargetFleet.x/y`** |

**安全性论证**：`targetShip` 只在 `if (fireTargetFleet)` 块内被赋值
⇒ `if (targetShip)` 为真时 `fireTargetFleet` **必非空** ⇒ 新引用安全。

## 4. 防复发：台架守卫（`battleFlowAuditSim` 33 → **37 断言**）

```
· 受击方块存在（口径基准）
· 受击方块能定位到结束（口径基准）
· 受击方块内不得访问 closestEnemyFleet（防 null 崩溃 + 语义错）
· 受击方块确实消费 fireTargetFleet（受击方语义）
```

⇒ 将来任何人在该块内写回 `closestEnemyFleet.` 都会被台架拦下。

## 5. 门槛

全量台架 **30/30 绿**（`battleFlowAuditSim` 内含新增 4 断言）·
`vue-tsc` EXIT=0 · `go build` EXIT=0

## 6. 未闭合

- 仅修了 `if (targetShip)` 块。**其他位置的 `closestEnemyFleet.` 属性访问**
  （文件内共约 30 处）已粗筛，均处于 `if (closestEnemyFleet)` 保护内
  （否则早就会崩）—— 但**未逐处静态验证**。
- 建议后续：为 `update` 主体加一层**异常隔离**（把单舰结算包在 try/catch 内），
  使单点异常不再冻结全场。本轮未做（避免掩盖错误）。

## 7. 产物

- `frontend/src/game/scenes/BattleScene.ts`：7 处受击方引用修正
- `scripts/battleFlowAuditSim.cjs`：+4 断言（受击方块守卫）
- 本台账
