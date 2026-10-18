# 舰种键中英失配：修复结论与未闭合项（2026-10-18）

> 结论先行：已在**查表入口**归一（`resolveClassTypeCn`），战役轨六个静默空转的子系统复活。
> 本文只登记「已修 / 未修 / 判定不该修」三件事，避免同一结论在多个 issue 里各写一份。

## 1. 缺陷

两条部署轨写进 `u.classType` 的口径不同：

| 轨 | 入口 | 写入值 |
|---|---|---|
| 战役 | `BattleScene.deploySide` | 英文 `ShipType`（`slot.type`） |
| 演习 | `spawnUnitsForFaction` / `applyStatsToSlots` | 中文 `cls`（`SHIP_TYPE_CN`） |

战术侧写表**全部以中文为键**（`SHIP_ARMOR` / `SHIP_INTERCEPT` / `SHIP_PREFERRED_BAND` /
`SHIP_KINEMATICS`）。英文键查不到时**不报错、不告警**，各自走 fallback：

| 子系统 | 失效表现 | 修复后 |
|---|---|---|
| 三向装甲 `dirArmorMul` | 恒 1.0（前/侧/后无差别） | 战列背击 1.62 / 高战侧击 1.53 |
| 防空拦截 `fleetInterceptRate` | 恒 0 | 巡洋单舰 0.375 |
| 偏好距离带 `shipBandMul` | 恒 1.0 | 命中 1.05 / 未命中 0.97 |
| 舰队运动学 `fleetProfile` | 全 skip → `EMPTY_FLEET_PROFILE` | 按 `hullLen²` 加权（空母+巡洋组合 vMax 0.187） |
| 舰载机（`空母`/`突击` 判定） | 恒 false ⇒ 不放舰载机 | 正常放飞 |
| 电子战（`电子` 判定） | 恒 false ⇒ 永不触发 | 干扰/欺骗/权限门恢复 |

口径差示例：`EMPTY_FLEET_PROFILE.accel = 0.0060`，真实的空母/巡洋混编约 `0.00032`
（≈ 18.6 倍）。所以"跑起来不报错"掩盖的是**加速度差一个量级**。

## 2. 修法

- 单一真源：`config/shipScaling.ts` 新增 `resolveClassTypeCn(classType)`，复用既有
  `SHIP_TYPE_CN` / `CN_TO_SHIP_TYPE`，**不新建映射表**。已是中文 → 原样；命中英文 → 中文；
  未知键 → 原样（保持原 fallback，不抛错）。
- 归一点选在**查表的函数入口**，不在建舰处：建舰处改只能救"以后新建的舰"，
  存量存档 / 演习轨 / 战后回写 / 3D 层 / 台架仍会传英文键。
- 表键名与数值**一字未动**；`formationColumns.shipBandMul` 无需改动（只经
  `getShipPreferredBand` 取表，归一已在其入口）。
- 台架：`scripts/shipKeySim.cjs`（等价性 + 反向证据 + 变异自检）。
  运行 `node --import ./_ts_resolve.mjs scripts/shipKeySim.cjs`。

**平衡影响**：战役轨舰种第一次真正分档（速度/转向/加速按舰种取值，此前整队跑战列档，
且 `accel` 高一个量级）。这是平衡级变化，须真机跑一局对照观感。

## 3. 未闭合项（同族缺陷，不建议混进技术修复）

- **阵亡抚恤 `crew = cls === '战列' ? 3000 : …`**（`BattleScene` 的舰队损失结算）
  同上吃了键失配：战役轨全舰种落到 `500` 的兜底。修它会把战列抚恤抬到 **6 倍**
  ⇒ 属**经济平衡决策**，需另行拍板，不与键归一同批。
- **3D 层的中英映射有两份**：`Battle3DOverlay.CLS_ALIAS`（中文→英文模型 key）与
  `shipModels.SHIP_CLASS_ALIAS`（中英双向→规范 key），功能重叠且都是手抄。
  统一它会改变"极端情况下选哪个 GLB"，风险在模型选错，建议另开一笔并配截图对照。

## 4. 结论：3D 层不受本次归一影响（已核查）

判定：**不受影响**。依据三条：

1. 本次没有改任何 `classType` 的**写入**，也没有改传给 3D 的任何入参 —— 归一函数只在
   判定/查表时**读**（`resolveClassTypeCn(u.classType) === '…'`），不回写 `u.classType`。
2. 3D 入口本来就同时接受两种口径：`dimsOf` 里 `SHIP_RATIO[classType] ? classType : CLS_ALIAS[classType]`
   （英文直命中 / 中文经别名），模型解析走 `shipModels.SHIP_CLASS_ALIAS`，该表**同时登记了
   英文与中文**（`battleship`/`战列`、`carrier`/`空母`/`突击`/`CV` …）⇒ 两轨各自命中。
3. 唯一可能外泄的返回值 `fleetProfile().dominantClass` **无任何消费点**（全仓 `grep` 仅台架）。

附带收益：`Battle3DOverlay` 的"速度 %"读数用 `fleetProfile(units).vMax`，此前对战役轨
恒按 `0.22` 算，现在按真实剖面 ⇒ 读数变准（**是数值读数，不是模型选择**）。
