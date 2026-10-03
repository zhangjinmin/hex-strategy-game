# v70 转向物理与掉头阵型修复台账

日期：2026-10-03。用户实机试玩后反馈两个问题（附截图）。

---

## 1. 用户实报的两个问题

> ① 只一半的转向，比如转个 40°，会出现突然舰首一下子转过去，接着向那个方向前进，
>    而不是舰船缓慢转向，是一个瞬间完成了转向
> ② 掉头还是会出现大范围的阵型变换，就是首尾变换的情况。
>    我的预想中其实掉头就是**停船 → 舰船原地转向 → 原来的头部变成阵型的尾部，
>    原来的尾部变成阵型的头部，再适当调整下**，而不是这种大范围的阵型变换

**截图关键信息**：我方舰队（画面中央）**挤成一团、舰首朝向杂乱**；
敌方舰队（右上）却是**整齐线阵**。
⇒ 阵型系统本身没坏，问题在**阵面旋转与舰船追击的速度失配**，以及**转向走了无惯量旁路**。

---

## 2. 病根（代码级定位，非推断）

### 2.1 问题① 瞬间转向 = 原地转向走的是**纯位置积分**

`BattleScene.ts` 原地转向分支（旧）：

```ts
const uStep = kinOmegaNow * FACING_TURN.RATE_MUL * _td.rateMul * dt;
if (Math.abs(dF) <= uStep) { fleet.facingSmooth = fAngle; fleet.facingRate = 0; }
else { fleet.facingSmooth += Math.sign(dF) * uStep; fleet.facingRate = ...; }
```

**问题**：`facingSmooth += sign(dF) · uStep` 是**位置直接积分**——转 40° 和转 180° 都以
**相同角速度**甩过去，且**完全绕过角速度惯量与制动律**（v65 #18 修过的过冲问题在此复现）。

⇒ 转 40° 只需 ~0.8s 就"完成"，视觉上就是"突然一下转过去"。

### 2.2 问题② 掉头阵型大变换 = 阵面在 reform 阶段**连续旋转 2 秒**

```ts
(fleet as any).formFacing = advanceFormationFacing(ff0, facingSmooth, FORM_FACING_RATE * dt);
// FORM_FACING_RATE = π/120 = 90°/s
```

180° 掉头 ⇒ 阵面需 **2 秒**匀速旋转。**这 2 秒内槽位目标绕中心持续公转**，
所有舰船沿圆弧追槽位 ⇒ 视觉即「整支舰队大范围扫过」= 用户看到的大范围阵型变换。

⚠ **代码注释里写着「画圆不可构造」**，但连续旋转阵面恰恰在构造公转。
v31-D / v41b / v41c / v41e / v42 四代修复全部败在这个判断失误上。

---

## 3. 修复

### 3.1 修复①：原地转向改为角速度积分

```ts
const uRateCap = kinOmegaNow * FACING_TURN.RATE_MUL * _td.rateMul;
const uAccel   = Math.min(kinProfile.alphaMax, TURN_RATE_ACCEL) * dt;
const uBrake   = Math.sqrt(2 * uAccel * BRAKE_SAFETY * Math.abs(dF));  // 临界制动包络
const uWant    = Math.sign(dF) * Math.min(uRateCap, uBrake);
fleet.facingRate += clamp(uWant - fleet.facingRate, ±uAccel);
if (|facingRate| > uBrake) facingRate = sign · uBrake;    // 硬钳包络（同 v65 #18）
fleet.facingSmooth += fleet.facingRate;
```

**效果**：
- 小角度（40°）受制动包络限制 ⇒ **角速度上限 = √(2·a·0.85·dF) 很小** ⇒ 自然缓慢
- 大角度（180°）才允许达到满转率 ⇒ 完整转向时间
- 过冲由临界制动律保证不会发生

`RATE_MUL` 保留为**战术倍率**（应急快转仍可用），但不再是"绕过物理的旁路"。

### 3.2 修复②a：阵面一步到位（消除公转）

```ts
(fleet as any).formFacing = fleet.facingSmooth ?? ff0;   // 取消 advanceFormationFacing
```

reform 起始帧**一次性对齐**新舰首，不再连续旋转 ⇒ 槽位不再绕中心公转。

### 3.3 修复②b：格位身份反转（首尾交换 = 用户的物理预想）

```ts
const rawSlot = u.formationSlot >= 0 ? u.formationSlot : index;
let slotIdx = rawSlot;
if (fleet._slotFlip && fc0 > 0 && rawSlot < fc0) {
    slotIdx = fc0 - 1 - rawSlot;        // 对侧槽位
}
```

**物理依据**：阵型槽位沿舰首方向编号（前 0、中 1、后 2…）。舰首转 180° 后，
**同序号槽位自然落到原队形的对侧** ⇒ 原头部(new 0) 跑到 new 尾部 = 首尾交换，
且**每艘走直线**，不绕中心公转。

**翻转只触发一次**（toggle，非持续）：

```ts
if (fleet._uturnJustEnded) {          // turn→reform 交接的那一帧
    fleet._slotFlip = !fleet._slotFlip;
}
```

⚠ 若在整个 reform 期间持续为 true，每次掉头都会反复镜像 ⇒ 队列在两种排列间来回跳，
又变成新的抖动源。`_uturnJustEnded` 在 `:7060` 定义，消费点 `:7359`，顺序正确。

---

## 4. 关键设计决策

### 4.1 为什么阵面"一步到位"是对的

真实战舰原地转向时，**阵列整体不动**，只有每艘舰在原地转舰首。
转向完成后，所有舰首已指向新方向，队列自然就是"新方向下的同一序列"。

**不需要**让格位从旧位置连续旋转到新位置——那是视觉特效，不是物理。
（旧实现的 2 秒公转纯粹是"让阵型转过来"的错误实现）

### 4.2 为什么必须配"格位反转"而不是"格位不换"

若阵面一步到位而格位不换，则转 180° 后：
- slot 0（原本在舰首前方）的舰会跑到**新航向的后方**（因为阵面已转 180°）
- 结果与"首尾交换"一致，但**没有显式保证**在对称阵型下正确

显式反转 `(N-1-i)` 在**对称阵型**（line/wedge/spindle）下给出确定的、玩家可预期的结果：
原来的排头变排尾。这正是用户描述的预想。

### 4.3 瞬态登记

`_slotFlip` 已加入 `BATTLE_TRANSIENT_FIELDS`——若不登记，
第二局开局的翻转态会污染新战局的阵型分配。

---

## 5. 验收判据

| 判据 | 期望 | 状态 |
|---|---|---|
| 转向小角度不瞬转 | 40° 转向时间随角差平方增长（制动包络） | 逻辑已实现，**待真机确认** |
| 转向不过冲 | 临界制动律保证 | 逻辑已实现（同 v65 #18 已验证的护栏） |
| 掉头无阵面公转 | 取消 advanceFormationFacing | 已实现 |
| 掉头首尾交换 | `_slotFlip` toggle + `N-1-i` | 已实现，**待真机确认** |
| 连续掉头不抖动 | toggle 而非持续 | 已实现 |
| 存档不污染 | `_slotFlip` 登记瞬态 | 已实现 |
| 三道门槛 | tsc 0 / go build 0 / 台架零新增红灯 | **全绿** |

---

## 6. 门槛

| 门槛 | 结果 |
|---|---|
| 全量台架 | **29/29 绿，零新增红灯** |
| `vue-tsc --noEmit` | **EXIT=0** |
| `go build ./...` | **EXIT=0** |

---

## 7. 未闭合

- **L3 真机未做**（本轮是两个用户可见的物理问题，**必须真机确认**）：
  - 40° 转向是否真的变缓慢（而非瞬间）
  - 掉头是否变成"停船 → 转舰首 → 首尾交换"而非大范围扫过
  - 截图里"挤成一团"是否消除
- **阵面一步到位的观感未验证**：槽位瞬移可能导致视觉跳变（虽然每艘走直线追槽，但第一帧目标位会跳）。
  若真机出现"队列瞬间错位一格"，可考虑改为"阵面一步到位 + 槽位目标**延后一帧**下发"。
- 未改动：`FORM_FACING_RATE` 常量现已无调用点（保留未删，注释说明）。
- 30 号 §5 炮塔 / §6 反馈通道（音效/震感/尾焰耦合 thrustLevel）、31 号阶段 C/D/E 未动。

---

## 8. 产物

- `BattleScene.ts`：转向积分（:7152 附近）、formFacing 一步到位（:7340 附近）、
  slotIdx 反转（:7487 附近）
- `BattleTransientFields.ts`：+1（`_slotFlip`）
- 本台账 `docs/qa/2026-10-03-v70-turn-physics-slot-flip.md`
