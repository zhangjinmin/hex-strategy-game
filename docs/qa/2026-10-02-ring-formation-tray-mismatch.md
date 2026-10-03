# 2026-10-02 · 环形部队 + 长方形托盘（归队槽位越界）根因与修复

**用户实报**（真机截图）：「敌方部队是这样一个环形的，但是托盘是长方形的」——红方舰体排成大环形，
托盘却是长方形，两者形状完全脱节。

## 1. 根因（代码级定案）

**触发路径 = 分队归队合并**（`BattleScene.rejoinDetachment`，旧实现 :4480-4492）：

```ts
parent.units.push(...kid.units);
parent.units.forEach((u, i) => { u.formationSlot = i; u.gridX = 0; u.gridY = 0; });  // ← 缺陷两处
this.placeFlagshipAtRear(parent);
```

1. **按 `units` 数组下标全量编号**——运输舰也占阵位号（部署期口径：运输舰 `formationSlot = -1`
   不占号，见 :1380-1381 / :4206-4208）；
2. **漏改 `parent.formationCount0`**——归队后战斗舰数增加，阵位表长度仍是旧值。

**后果链**：合并后大量单位 `slotIdx ≥ formOffsets.length` ⇒ 单位循环的越界兜底
`formOffsets[slotIdx] || ringCell(slotIdx)`（BattleScene:6933）全部命中——
`ringCell` 是黄金角螺旋（`r=√(i+0.5)` 格位、`a=i·137.5°`，:296-303），高号段单位的
半径集中在 5~8 格 ⇒ **舰体排成环带**；而托盘（`writeFleetMarks`）仍按 `formOffsets`
（旧 `formationCount0` 格）画**矩形**。两者各走各的。

与 :4161-4165 分兵旧案注释记载的症状完全一致（「全落兜底环位、托盘与部队各走各的」
——当年实测托盘 vs 舰船质心偏移 119.5px），当年修复只堵了分兵路径（先裁剪再重编号 +
子队独立编号），**归队路径的槽位重排一直带着这两个口径缺陷**。

## 2. 修复（BattleScene.ts `rejoinDetachment`）

槽位重排改与部署期口径一致（对照 `splitFleet` :4206 母队重建）：

- 运输舰 `formationSlot = -1` 不占阵位号；
- 战斗舰 0..N-1 连续编号；
- **同步重算 `parent.formationCount0 = 战斗舰数`**（与 :4197/:4208 的分兵路径同口径；
  阵型形状随编制变化重建、战损不改的语义不变）；
- `placeFlagshipAtRear` 在重排后调用（旗舰回后方指挥席）。

## 3. 验证

**新增台架 `_diag_rejoin.cjs`（35/35 PASS）**：`rejoinDetachment` 真实方法抽取执行
（`stripTypeScriptTypes` + 假 this）、`isSupplyUnit` 源码抽取、`formationOffsets` require 真源。
判据：战斗舰槽位连续无洞无重 / 运输舰恒 -1 / `formationCount0` = 战斗舰数 /
**∀ slotIdx < formationCount0（ringCell 兜底 0 命中）** / 全槽位可索引进真源 formOffsets /
归队生命周期收口。含补给舰在数组头/尾（下标无关性）、大编队（24+16）、连续两次归队幂等。
历史对照：旧口径镜像下 ringCell 命中 8 个单位（环形根因复现）。

**门槛全绿**：26/26 `scripts/*Sim.cjs`、`vue-tsc --noEmit` exit=0、`go build ./...` exit=0。

**L3 真机验收（待做）**：下一轮测试观察归队后敌/我部队阵型与托盘形状是否一致。

## 4. 附带发现：fleetIntentSim 金标过时（已订正）

批量回归时发现 `scripts/fleetIntentSim.cjs` 红灯：源码文本元断言仍要求
`const _rigid = … || isEngaging`（交战即锁舰首的**旧契约**），与 2026-10-02 早些时候定案的
拖刀两项与 `(isRetreating && isEngaging)`（交战中舰首跟航迹防侧滑，W1-W3 9c099a5 回归教训）冲突。
已按新语义订正金标，并加负向守卫（`_rigid` 内不得再出现裸 `|| isEngaging`）。

**教训**：行为契约变更时必须同步排查源码文本元断言类台架——它们锁的是旧语义，
会以「红灯」形式暴露，但根因是金标过时而非代码回归。
