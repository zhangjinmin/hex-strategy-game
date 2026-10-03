# 同盟侧战舰退化为程序化兜底模型 —— 根因与修复（v61 + v62 两轮）

日期：2026-09-30 ｜ 缺陷域：`buildShip` 模型解析链 + GLTF 加载器 + 战术折算 classType ｜ 状态：已修复 + 台架固化 + 运行时探针验证

> **勘误声明（二轮）**：一轮（v61）修复的"别名断键 + 编制无视阵营限制"是真实缺陷，但**不是**"大量兜底箱形"的来源——
> 一轮修复后用户实报"刷新后还是没有模型"。二轮运行时取证（探针 v3）定位到第二缺陷：
> **`alliance_battleship.lod1/lod2.glb` 是 EXT_meshopt_compression 压缩产物，GLTFLoader 未注册 MeshoptDecoder ⇒ 解析必败**。
> 一轮的"根因一句话"只覆盖了"错模型/候选落空"，未覆盖"加载失败型永久兜底"，特此更正。

## 根因（二轮·一句话，即"兜底箱形"的真来源）

`alliance_battleship.lod1/lod2.glb` 内含 `extensionsRequired=[EXT_meshopt_compression, KHR_mesh_quantization]`（102 个 GLB 中仅此两个），而 `runShipModelLoad` 的 `new GLTFLoader()` **未注册 MeshoptDecoder** ⇒ 加载必抛
`THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files` ⇒ `reg.status='failed'`；
叠加 `acquireShipModelByFiles` **失败不回退后续候选**（取到首个存在的文件即 return）⇒ 该 reg 永久挂 `pendingModel` 且永不换装 ⇒ **medium/low 档下同盟战列级舰永久程序化兜底**。
再叠加 classType 折叠缺陷（见下），高战/空母/舰载 全部以 `'战列'` 出场 ⇒ 该坏文件命中面被放大到约 80% 编制。

## 第三缺陷（同场实锤）：classType 静默折叠

`troopNames` 只有 战列/巡洋/驱逐/突击/电子/补给 六类，`trait_高战_1`/`trait_空母_1`/`trait_舰载_1` 这些 troop id **不存在**；
而 `getTroopById`（gameStore:2367）找不到 id 时**兜底返回 `troopsData[0]`**（= `empire_战列_1`，cls='战列'），
`applyStatsToSlots`（shipScaling:469）用 `t?.cls` 当 classType ⇒ 高战/空母/舰载 被折叠成 `'战列'`（错误模型 + 错误 def/speed/range/interval）。
运行时分布佐证：折叠期场上仅见 战列/巡洋/驱逐/补给 四类，且战列计数 = 战列+高战+空母+舰载 之和（敌 55+20+3+2≈80%、玩家 20+5+10≈35%，与编制比例吻合）。

## 症状→机制映射（覆盖全部症状）

| 症状 | 机制 |
|---|---|
| 同盟大面积兜底、帝国正常 | 仅 `alliance_battleship.lod1/lod2` 两文件带 meshopt required；帝国全系无压缩 ⇒ 帝国任何档位都加载成功 |
| 兜底的主要是大舰 | 战列级（含折叠进来的高战/空母/舰载）命中坏文件；巡洋/驱逐/补给 的 lod 文件健康 |
| 高档位看不出、低档位全暴露 | 坏文件只有 lod1/lod2；`detail='high'` 用基础文件（无压缩，健康）。auto-LOD 降档（≥300 实体或帧时压力）后全部迁移踩雷 |
| 刷新后依旧 | `reg='failed'` 是 URL 级终态（模块级注册表缓存），刷新重建会再次请求、再次解析失败 |
| 探针一轮"全 34 个 loading" | 方法论伪证据：采样调用自身 re-acquire 制造新鲜 reg + 远景相机下实体不建（px<14 三级表示）。二轮已修正采样法 |
| 一轮修复后"部分好转"但主症状仍在 | 一轮解决了"高战候选全空型兜底"（少数）；"加载失败型兜底"（多数）是另一层缺陷 |

## 代码证据

- GLB 容器审计（`_glb_audit.cjs`，102 文件）：仅 `alliance_battleship.lod1.glb`、`alliance_battleship.lod2.glb` 声明 `extensionsRequired=[EXT_meshopt_compression, KHR_mesh_quantization]`；其余 100 个 `extReq=[]`；全部结构健康（魔数/JSON/非零网格）。
- 运行时复现（`_probe_model_status3.mjs`，修复前）：控制台逐字报
  `Error: THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files at GLTFMeshoptCompression.loadBufferView`；
  `pendFiles = {"alliance_battleship.lod2.glb [failed v0/mv0 geofalse]": 27}`，T1/T2 双时点稳定 27/27 不收敛（= 永久，非瞬态）；
  55 个无 pending 实体（巡洋 25/驱逐 27/补给 2/旗舰 1）全部真模型。
- 折叠佐证：同场 classType 分布仅 战列 28/巡洋 25/驱逐 27/补给 2（28 = 战列+高战+空母+舰载 合并）。
- `shipModels.ts`：修复前全域无 `MeshoptDecoder`/`setMeshoptDecoder`（three 0.160 自带 `meshopt_decoder.module.js`，未接线）。
- `acquireShipModelByFiles`：取到首个 `findShipFileKey` 命中的候选即 `return reg`，与注释"候选顺序即回退顺序"契约相悖。

## 修复（v62）

| 文件 | 改动 |
|---|---|
| `shipModels.ts` | ① 导入 `MeshoptDecoder` 并 `new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)`；② `acquireShipModelByFiles` 对 `status==='failed'` 的候选 `continue` 试下一个（兑现回退契约） |
| `gameData.ts` | 新增纯函数 `troopLikeFromClass(cls)`：troop 缺失时按 `baseStats` 真源合成 TroopLike（def/speed/range/interval 不手抄） |
| `BattleScene.ts` | `spawnUnitsForFaction` 的 troopOf 改**严格查找** `troopsData.find(id)`，缺则 `troopLikeFromClass(cn)` 合成；不再裸用 `getTroopById`（消除 troopsData[0] 静默折叠） |
| `scripts/shipModelResolutionSim.cjs` | 新增 E 段 5 判据：troopLikeFromClass 真源值 / troopOf 无裸 getTroopById / MeshoptDecoder 注册 / 失败候选回退 / GLB 容器审计（含"required 扩展必须有解码器"） |

## 验证（定量）

| 判据 | 修复前 | 修复后 |
|---|---|---|
| 坏档解析（`_probe_meshopt_check.mjs` 直打两文件） | 必抛 setMeshoptDecoder 错误 | lod1 `ready` 9,992 tris / lod2 `ready` 4,850 tris，各 ~200ms |
| 运行时 pendFailed（T1/T2 双时点） | 27 / 27（不收敛） | **0 / 0** |
| 运行时兜底实体 | 27（modelVer=0） | **0**（76/76 modelVer>0） |
| classType 分布 | 战列 28（折叠） | 战列 16 / 空母 4 / 舰载 1 / 巡洋 25 / 驱逐 28 / 补给 2 |
| 加载失败计数（console） | 2（lod1+lod2） | **0** |
| `scripts/*Sim.cjs` 全量 24 台架 | — | **0 红灯**（合计 361 断言；模型台架 61/61） |
| `vue-tsc --noEmit` | 0 | **0** |

## 风险与残留

- `getTroopById` 的"找不到返回 troopsData[0]"仍是地雷（其它调用点如旧 deck 路径 BattleScene:1417 仍可能静默取错 troop）；本次只修战术折算主链，未动 getTroopById 语义（UI 展示依赖其兜底）。
- 未来若其它 GLB 经 gltf-transform 压缩出 meshopt/Draco：meshopt 已由解码器兜住；**Draco 仍无 DRACOLoader**——台架 E 段容器审计会在 `extensionsRequired` 含 draco 时直接红灯拦截。
- 一轮条目仍有效：同盟编制高战份额并入战列；旧存档残留高战走家族回退渲染为战列模型；`alliance_leda2.glb` 无代码绑定（独立事项）。
- 探针产物：`_probe_model_status3.mjs`（近景+无副作用采样+双时点差分）、`_probe_meshopt_check.mjs`（最小确定性打样）、`_glb_audit.cjs`（容器审计）。均在根目录（gitignore 外，无异地备份）。
