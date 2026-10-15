# v87 根除 null 访问（TS 静态验证）+ 主循环异常隔离

日期：2026-10-15。用户指令：
> 当然都做了，该隔离隔离，但异常还是需要修复的。

---

## 1. 根治思路：把「运行时才发现」变成「编译期就报错」

`closestEnemyFleet` 原声明为 **`any`**：
```ts
let minFleetDist = 99999; let closestEnemyFleet: any = null;
```
⇒ TS **完全放行**任何属性访问 ⇒ null bug 只能在运行时暴露（v86 就是这么炸的）。

**改法**：声明为**带 `null` 的宽松对象类型**：
```ts
let closestEnemyFleet: ({ [k: string]: any } & Record<string, any>) | null = null;
```

**⇒ tsc 一次性列出全部 8 处未判空访问**（这正是"异常需要修复"的根治手段）：

| 行 | 问题 | 修复 |
|---|---|---|
| 6384/6385 | `if (pickedEf)` 块内用 `closestEnemyFleet`（TS 对外层 `let` 在嵌套块内赋值**不做窄化**） | 改用刚判非空的局部变量 **`pickedEf`** |
| 6398 | 出块后仍用 `closestEnemyFleet.id` | **整段交战判定包进 `if (closestEnemyFleet) {`** |
| 6421/6426/6451 | 同上（`canEngage` 分支内） | 由上面的包裹覆盖 |
| 6739 | **`forEach` 闭包内**（TS 对闭包不做窄化） | 条件里显式加 `closestEnemyFleet &&` |

**⇒ 修复后 `tsc` 错误数 = 0。**

> 为什么用"宽松索引签名"而非精确 Fleet 类型：本函数内对它的字段访问很杂
> （`x/y/vx/vy/facingAngle/state/id/formation/formFacing/_formationCollapsed`…），
> 精确类型会引入大量**无关**的类型错误，反而掩盖真正要修的"未判空"问题。

## 2. 韧性：主循环异常隔离（不掩盖根因）

用户要求"该隔离隔离"。对**舰队主循环**（`this.globalFleets.forEach(fleet => { ... })`，
即 v86 崩溃点所在处）与链路维护循环加兜底：

```ts
try {
    /* 单舰队本帧所有结算 */
} catch (fleetTickErr) {
    this.reportTickError(fleet, fleetTickErr);
}
```

`reportTickError`：
- **`console.error` 原文输出**（**不掩盖**，含累计计数与舰队 id）
- **2s 节流**（防刷屏，但异常仍在控制台可见）

**效果**：单舰队出错 ⇒ 只跳过该舰队本帧 ⇒ **其余舰队继续** ⇒
不再出现 v86 那种"命令有反应但整个战场静止"。

## 3. 防复发：台架守卫（`battleFlowAuditSim` 33 → **41 断言**）

| 断言 | 目的 |
|---|---|
| 受击方块内不得访问 `closestEnemyFleet` | 防 v86 复发 |
| 受击方块确实消费 `fireTargetFleet` | 正向确认受击方语义 |
| 主循环存在单舰队异常隔离（try/catch） | 防隔离被误删 |
| 隔离处调用 `reportTickError` 记账 | 确认不是空 catch |
| `reportTickError` 用 `console.error` | **防"静默吞异常"** |
| `reportTickError` 有 2s 节流 | 防刷屏 |

## 4. 门槛

全量台架 **30/30 绿** · `vue-tsc` EXIT=0（**0 处 TS18047**）· `go build` EXIT=0

## 5. 未闭合

- 隔离粒度是**单舰队**（非单舰）：若某舰队内几个单位出错，该舰队整帧跳过。
  权衡：单舰粒度会显著增加 try/catch 开销（每帧数千次），当前粒度已消除"全场停摆"。
- 其余声明为 `any` 的变量（如 `attackerFleet`、`targetShip`）**尚未做同类 TS 收紧** ——
  它们同样存在"运行时才暴露"的风险。建议后续逐个收紧。

## 6. 产物

- `frontend/src/game/scenes/BattleScene.ts`：类型收紧 + 8 处判空 + 主循环 try/catch + `reportTickError`
- `scripts/battleFlowAuditSim.cjs`：33 → 41 断言
- 本台账
