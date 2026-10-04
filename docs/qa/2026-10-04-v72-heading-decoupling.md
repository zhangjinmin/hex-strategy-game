# v72 朝向解耦与阵型裁剪修复台账

日期：2026-10-04。用户实机试玩反馈（附三张截图）。

---

## 1. 用户实报的三个问题

> ① 这个阵型等腰三角形是向着右下角的，但是阵型的移动是往右上角移动
> ② 远景是全部由点组成的填充满的，但是近景的时候只有长条形的阵型了，搞不懂为什么
> ③ 掉头的问题更严重了，诡异的移动，舰尾对着移动方向在做阵型移动，
>    就是固定方向不动，然后快速画圈移动，比以前还不如

**截图证据**：
- 图1：三角形阵型指向右下，移动箭头指向右上（差约 90°）
- 图2：近景呈**长条形**排列
- 图3：掉头时"固定方向不动 + 快速画圈"

---

## 2. 取证先行：先探针后改代码

新建 `_probe_heading3.mjs`，**只读取证不改代码**，输出三个角度量的实测轨迹。

### 取证 A：火控解算在拉扯舰首（复刻图1）

场景：舰队停船交战，`fAngle` 从 45° 切到 −45°（`moveAngle` 保持 45°）。

```
  帧 | fAngle目标 | moveAngle移动 | facingSmooth舰首 | formFacing阵面
  200 |    -45.0°  |      45.0°    |      41.8°      |     41.8°
  250 |    -45.0°  |      45.0°    |      31.3°      |     31.3°
  300 |    -45.0°  |      45.0°    |      20.8°      |     20.8°
  350 |    -45.0°  |      45.0°    |      10.3°      |     10.3°
⇒ 终态：舰首 vs 移动方向差 -45.0°（阵面 = 舰首，跟着一起甩）
```

**结论**：`facingSmooth` 在 100 帧内**回转 90°**去追火控解算 ⇒ 阵型跟着甩 ⇒ 图1。

### 取证 B：阵面旋转必然导致公转（几何恒等式）

```
阵面旋转  0° ⇒ 首舰目标 (50.0, 0.0)
阵面旋转 45° ⇒ 首舰目标 (35.4, 35.4)
阵面旋转 90° ⇒ 首舰目标 (0.0, 50.0)
⇒ 转 90° 时首舰目标移动 70.7px（= 2 个舰长）
```

**结论**：阵面**任何**旋转都会让槽位目标公转，这是几何恒等式，无法回避。
唯一解是**让公转速度趋零**（阵面与舰首同速 ⇒ 相对位移 ≈ 0）。

### 取证 C：掉头协议期阵面同步 = 画圈（复刻图3）

代码原注释写着「formFacing 同步（阵位/托盘/位移一个真源 ⇒ **整阵绕锚点刚性转**）」。

```
  帧 | 舰首 | 阵面(=同步) | 首舰目标X | 首舰目标Y
   0 |  1.3° |       1.3°  |    16.5   |     0.4
  30 | 39.1° |      39.1°  |    12.8   |    10.4
  50 | 63.6° |      63.6°  |     7.3   |    14.8
⇒ 首舰目标在 60 帧内绕中心划过整圈 ⇒ 这就是「原地画圈」
```

**结论**：「整阵刚性转」不是解法，它**就是症状的实现**。

---

## 3. 根因

### 3.1 病根：`facingSmooth` 追 `fAngle`，而 `fAngle` 是火控解算

`BattleScene:7061-7063`（旧）：

```ts
} else if (isEngaging && closestEnemyFleet) {
    fAngle = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
    fleet.facingAngle = fAngle;   // ← 舰首目标被火控解算接管
}
```

**物理错误**：把「炮口该朝哪」与「舰首该朝哪」混为一谈。
真实战舰主炮塔可独立回转 360°，舰首朝向由**航行**决定，不由火控决定。

### 3.2 病根：v71 的 `max()` 让「阵面与舰首同源」等于没写

```ts
const ffRate = Math.max(
    FORM_FACING_RATE * dt,                                  // 90°/s
    (kinOmegaNow + Math.abs(fleet.facingRate || 0)) * dt,   // 战列 12.6°/s
);
```

`FORM_FACING_RATE` 比战列角速率**大 7 倍** ⇒ `max` 恒取前者 ⇒ 上一轮的核心改动**完全无效**。

### 3.3 病根：3D 实体裁剪取数组前 N 个

`combatRepresentation.ts`（旧）：

```ts
const visibleIndexes = live.slice(0, visibleCount)...
```

大编队被裁剪时近景只渲染**连续一段** ⇒ 三角形被砍成**长条形**；
而远景光点层用全部 `DOT_SLOTS` 不受裁剪 ⇒ **同一舰队两个距离两种阵型** = 图2。

---

## 4. 修复

### 4.1 火控解算与舰首解耦

```ts
const _fireAngle = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
(fleet as any)._fireControlAngle = _fireAngle;   // 火控（供 30 号 §5 炮塔层消费）
fAngle = fleet.facingAngle || fAngle;            // 舰首保持停船时航向
```

**刻意不写** `fleet.facingAngle` ⇒ 舰首不被火控拉扯 ⇒ 阵型不甩。

### 4.2 阵面速率 = 纯舰首角速率（去掉无效的 max）

```ts
const ffRate = kinOmegaNow * dt;    // 不加任何兜底
```

阵面与舰首同速 ⇒ 相对角差恒为 0 ⇒ 槽位目标相对舰船近似静止 ⇒ 无论 45° 还是 180° 都不公转。

### 4.3 实体裁剪改为等间隔抽样

```ts
const ranked = live.slice().sort((a, b) => b.ratio - a.ratio || a.index - b.index);
for (let k = 0; k < visibleCount; k++) {
    const pos = Math.floor(((k + 0.5) * ranked.length) / visibleCount);
    picked.push(ranked[...]);
}
```

- **健康优先**：伤重的排前段因而优先入选
- **形状保真**：等间隔抽样保证入选集合散布全编队 ⇒ 三角形仍是三角形（只是变稀）
- **确定性**：同一 hpPct 恒定产出同一结果 ⇒ 不闪

实测：24 选 12 ⇒ 索引 `1,3,5,7,9,11,13,15,17,19,21,23`（旧实现是 `0,1` 前段）。

---

## 5. 验收判据

| 判据 | 实测 |
|---|---|
| 交战中火控不拽舰首 | 金标更新 + 负向守卫（分支内禁写 `fleet.facingAngle`） |
| 阵面速率纯舰首同源 | 去掉 `max()`，`ffRate = kinOmegaNow * dt` |
| 裁剪保形 | 24 选 12 ⇒ 索引完全均匀（gap 全为 2） |
| 裁剪确定性 | 两次调用结果一致 |
| 重伤优先被裁 | 6 个重伤槽位只保留 2 个 |
| 未误伤 `distToTarget>5` 分支 | 断言保留原契约 |
| 三道门槛 | **29/29 台架绿 · tsc 0 · go build 0** |

### `combatRepresentationSim` 6 → 12 断言

新增：跨编队散布 / 单调有序 / 确定性 / 间距有界（前段抽样会出现 gap=0）/ 重伤优先

### `fleetIntentSim` 金标订正

**旧金标锁的是错误契约**（"交战中 fAngle 必须朝敌"）——那正是本轮改掉的病根。
教训重申：**行为契约变更必须同步排查源码文本元断言类台架，红灯根因可能是金标过时而非代码回归**。

---

## 6. 未闭合

- **L3 真机未做**（连续第四轮）。本轮三处都是结构级修正，必须真机确认：
  - 图1 阵型指向与移动方向是否一致
  - 图2 远景/近景阵型是否同形
  - 图3 掉头是否还画圈
- `_fireControlAngle` 已落库但**尚无消费者**（炮塔层 30 号 §5 未做）⇒ 火控解算现在不影响开火朝向。
  开火仍用 `visHeading` 射界判定（`:7101` 附近 `isTargetWithinFireArc`），暂不受影响。
- 30 号 §5 炮塔 / §6 反馈通道、31 号阶段 C/D/E 未动。

---

## 7. 产物

- `frontend/src/game/scenes/BattleScene.ts`：火控解耦（:7061 附近）、阵面速率（:7456 附近）
- `frontend/src/game/combatRepresentation.ts`：等间隔抽样
- `scripts/combatRepresentationSim.cjs`：+6 断言（6→12）
- `scripts/fleetIntentSim.cjs`：金标订正 + 负向守卫
- `_probe_heading3.mjs`：三量轨迹取证探针（只读）
