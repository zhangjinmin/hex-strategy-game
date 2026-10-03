# 2026-10-02 移动观感缺陷定案（侧滑 / 转向大范围）

用户实报（3 张截图）：① 舰队转向时队形大范围拉长变形；③ V 形张开；② 运输舰向左移动但舰首朝上，"飘着一样"。

## 一、侧滑（舰首 ≠ 位移方向）——Task #1 收口

### 根因 1（已修复，上一提交）：`_rigid` 的 isEngaging 回归
W1-W3（9c099a5）把 v47 拖刀专用条件 `(isRetreating && isEngaging)` 扩大为无条件 `isEngaging`
⇒ 交战中（minFleetDist < strikeRange 即置位）全队 visHeading 锁舰队朝向、位移追槽位 ⇒ 稳态侧滑 max 180°。
修复：BattleScene `_rigid` 恢复 v47 两项与语义 + 防回归注释。探针实测 >45° 侧滑样本 -40%。

### 根因分解台架：`_probe_freeslip.cjs`（纯函数，真源提取常量，4/4 断言通过）
`stepShipSlotFollow` × `rateLimitAngle`（≡ advanceFormationFacing，同式性已断言）联合仿真：

| 场景 | 结论 |
|---|---|
| S1 稳态巡航 / S5 90° 弧线转向 | 侧滑恒 0 —— 耦合无持续性侧滑 |
| S2 急停 / S3 走停循环 | 过冲仅 0.03px —— **M3「急停过冲回摆」证伪**（舰队速度 FLEET_ACCEL=0.055 平滑，舰跟槽同相制动） |
| S4 180° 掉头 | 速度过零反向 ⇒ ~13 帧瞬态，max 159.6°（ep45=1 次/舰） |
| S6 横向离槽起步 | 起步方向 ≠ 舰队朝向 ⇒ ~8 帧瞬态，max 80.8° |
| S7 wheel 出口 reform | 槽位公转重排 ⇒ 90-170° 瞬态 ~10-15 帧/舰/次 |

**M2（切换瞬态）为唯一真实残余**：`_rigid↔free` 切换后 visHeading 以 0.16 rad/帧 甩回航迹向。
每次方向事件 ~0.15-0.25s，物理上等价于"船掉头"，非持续缺陷。

### 根因 3（测量假阳性）：探针 v2 口径缺陷
v2 的 still 阈值 spd<0.05 ≠ 代码 `_rigid` 阈值 spd²<0.02（spd<0.141），
`free` 桶混入代码判"近静止刚性"的慢速样本。台架实证该口径差区（0.05<spd<0.141）侧滑 P95 达 169-177°。

### v3 复测（`_probe_slip3.mjs`，代码口径，60s，3961 帧）
| scope | n | >45° | >90° | max |
|---|---|---|---|---|
| free | 1061765 | 11672 (1.1%) | 5111 | 170.8° |
| gapZone（M1 差区） | 15826 | 4400 (28%) | 2308 | 180.0° |
| uturn | 8034 | 5332 (66%) | 2687 | 179.0° |

- **movingNoVH = 0**：全场无"移动中缺 visHeading"的单位（3D 回退舰队朝向的侧滑通路不存在）。
  无 visHeading 的 ~120 单位/帧全程静止（疑为未入 aux 的补给单位/死亡残留，无移动 ⇒ 无可见缺陷）。
- free 残余 = M2 瞬态（与台架场景量级一致）+ uturn 协议期（见下）。

## 二、转向大范围——Task #2 首轮定量 + 根因候选 1（代码级证实）

v3 编队几何（转向帧 = |Δfacing|>0.005 或 uturn）：
- 阵位拉扯 maxSlotGap：转向 p50=**60.45px**（≈2.3 槽宽）vs 稳态 2.43px（25 倍）；p95 384-433px（双方都有 400px+ 掉队帧，与代码内 uDist>320 警告光环路径吻合 = 截图"长条弯曲队形"）。
- diam（两两最大距）：转向 p50=548.9px vs 稳态 436.7px（+26%）。

**根因候选 1（已证实）**：wheel「原地转向」协议（combatControl `case 'turn'`）`motion:'hold'`
只是把期望速度清零，舰队速度经 FLEET_ACCEL=0.055 **指数衰减滑行约 50 帧才停**（0.78→0.1）。
期间槽位随惯性舰队平移、舰追槽平移，而 `_rigid` 把 visHeading 锁在正在扫描的 `facingSmooth` 上
⇒ **"原地转向"实为"边滑边转"** = uturn 桶 66% 样本 >45° 侧滑的来源，也是转向期 slotGap 暴涨的主因之一。

**根因候选 2（待定案）**：掉队（slotGap 400px+ 帧）——速度账（P2 文档"未闭合项 2"）：
撤退 rout 3.0× 可达 2.34 px/帧 ≫ 单位 maxSpeed 0.9；`terrainSpeedMul` 是否单独突破 0.9 上限待查。
morph 换阵过渡（3.5s）与转向的相关性亦未分离。

## 三、修复方向（待裁决后实施）
1. **wheel 刹停**：'turn'/'hold' 相位加主动制动（如 `fleet.vx *= 0.82` 或反向 accel 制动），
   使"原地转向"名实相符。预期：uturn 侧滑清零、转向 slotGap 大幅回落。
2. M2 瞬态：不建议动（物理合理、每次 <0.25s）；如需压观感可给 visHeading 加速度前馈，
   但会放大抖动风险，收益低。
3. 掉队：待定案后决定（限速车队 or 提高单位 maxSpeed or 掉队观感豁免）。

## 四、门槛
- 26 个 `scripts/*Sim.cjs` 全过（fleetKinematicsSim 15/15 含 P2 四判据）；
- `vue-tsc --noEmit` exit=0；`go build ./...` exit=0。
- L3 真机验收未做（修复 wheel 刹停后一并验收）。

## 取证产物
- `_probe_freeslip.cjs`：联合纯函数台架（常量真源提取 + rateLimitAngle 同式性断言）
- `_probe_slip3.mjs`：代码口径复测探针（scope 归因 + movingNoVH + _slotGap 编队几何）
- BattleScene `_slotGap` 诊断快照（只写不读，:6946 附近）
