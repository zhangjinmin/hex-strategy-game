# R10 批次台账 · 已知边界与登记项

> **性质**：只写 `docs/`，**未改动 `frontend/src/**` 任何字节**。本文件为 R10 批次（#49 + #52 + #53）落盘后的**边界与登记台账**，供统一 QA（quality-lead-3）作基线引用。
> **作者**：程基岩（engineering-lead-7）· 触发：team-lead「批次冻结」口令
> **冻结时刻**：R10 三波全部落盘且经 team-lead 独立核验通过。**src 现已冻结**。

---

## §0 批次与冻结基线（哈希快照链）

### 0.1 四文件终态（落笔时磁盘实测，ReadAllLines 口径）

| 文件 | SHA256 | 字节 | 行数 | 本批次状态 |
|---|---|---|---|---|
| `frontend/src/game/scenes/BattleScene.ts` | `1A675F90DFF62A900832A6975E5DAAC9C89D7447B77BF24F21B40D7EC214CE74` | 347301 | 5694 | #49+#52+#53 均改此文件 |
| `frontend/src/game/three/Battle3DOverlay.ts` | `E05FFFFCEFFA595D498D3A5208A66B39563978ECD3D57D5B299AFD553D34CBA2` | 299860 | 5411 | #49 改（#52/#53 未碰） |
| `frontend/src/game/SupplyChainSystem.ts` | `FB33698085AEC00064CC1AEA72D8586EE890BF1C167D48FF6E9C9F661CAB79B5` | 14527 | 295 | **未动**（R10-A1 后即冻结） |
| `frontend/src/App.vue` | `C6A5A8987DF8C8BDE1ABDF91EEAF6C9CE24C3D08798B78292F47F1F2DAC485C2` | 43896 | 789 | **未动** |

~ 口径说明：全仓库为 CRLF；`[IO.File]::ReadAllLines` 与 `node split('\n')` 差 1（尾部换行），本表统一用 **ReadAllLines 口径**。team-lead 侧 `_lead_53_verify.txt` 记 5695/5412/296/789 = `split('\n')` 口径（+1）。

### 0.2 快照链（每波落盘后的 BattleScene/Battle3DOverlay 哈希）

| 节点 | BattleScene.ts | Battle3DOverlay.ts |
|---|---|---|
| **R10 基线（#49 前）** | `CC0E11D8417E344DAD68A722E3EB8A894149963FD77A9542DA769C0C2649E592` / 333919 B | `528DF35EEBB5F67FE579ABBCC2FBF937C8E07F6AB4D10A2B7586F56B73F37577` / 296833 B |
| **#49 后**（FIX-3 限速航向角） | `8B151969C7AC7B99E25DC92341BEA7A300207D71EE5D391A31358AC0A8B14E80` / 337606 B | `9FF232FAA21939CC887C4F1C83A35B5B33A7337F2BD88347FDDF0B9260F1D1F5` / 298524 B |
| **#52 后**（BW-02 幽灵信标门控前移） | `1F46783AD2E109230541CF47BC77BCDBE5854AC41CACDCAC40CD0A647A0E50AC` / 338959 B | `9FF232FA…`（未变） / 298524 B |
| **#53 后**（右键 move 命令） | `1A675F90DFF62A900832A6975E5DAAC9C89D7447B77BF24F21B40D7EC214CE74` / 347301 B | `E05FFFFCEFFA595D498D3A5208A66B39563978ECD3D57D5B299AFD553D34CBA2` / 299860 B |

> ⚠ **#52 的哈希为「#52 落盘时快照」**：其后 #53 又改 `BattleScene.ts`，故 #52 的**最终证据哈希**（`1F46783A…`/338959 B）**不等于**当前磁盘现状；引用 #52 证据时须标注时点。#52 的独立 QA 见 quality-lead-3；#52 回执见 team-lead 核验记录。

---

## §1 #52 登记项（BW-02 幽灵信标，`engineering-lead-7`）

> 背景：#52 把 `deployFlare` 由「先建视觉 → 后判定门控」改为**门控前移**——抽出 `createPlayerFlareVisual(x,y)`（视觉块整段搬移、逐字等价），`deployFlare` 重排为「选舰队 → `nearest===null` 守卫 → 门控三分支 → 各分支动作」。被拒（silent/频道满）时**不建视觉**，旧信标天然保留。

### R3（**已完成**，纳入本次修复）
- 例 D 纳入：`nearest === null`（附近无己方舰队）→ toast `⌁ 附近无可接收信标的己方舰队，未投放信标。` + `return`（**不建视觉**，零残留）。
- 现状：`(deployFlare)` :1591 · 守卫锚点 `if (!nearest) {` :1601。

### R4（**登记不修**）
- **delayed 视觉与送达不一致**：delayed 路径在**点击时**即创建信标视觉，但命令送达受 `executeRelayedOrder` 两道拦截影响——
  - `if (!fleet || fleet.units.length === 0) return;`（收件人已失联 → 订单作废）:2937；
  - `if (fleet.state === 'engaging') return;`（交战中不接收，保持战斗连贯）:2943。
- ⇒ 可能出现「点击即显视觉 → 但订单最终作废」的观感差。**登记不修**（属设计取舍，非缺陷）。

### R5（**登记不修**）
- 视觉 `destroy()` 不 kill 那 3 段 `repeat:-1` tween（hex 呼吸 / ring 旋转 / dot 脉冲）。
- 与**既有先例一致**：`clearFleetFlareIfCaptured` 的 `this.playerFlare.destroy()` 同样不 kill，已验收（:1528 一带）。
- ⇒ 沿用同款；**如真机见残留 tween**，再于销毁处补 `this.tweens.killTweensOf(...)`。**登记不修**。

---

## §2 #53 前须知（右键 move 命令，`engineering-lead-6`）

> #53 新增「选中舰队 → 右键点地 = 移动该舰队」：`battleSelectedFleetId` 字段（:201）、2D 拾取 `pickFleetAtWorld`（:2749，40px 阈值）、应用选中 `applyFleetSelectByPick`（:2771）、移动执行 `orderFleetMove`（:1648）、右键分支 `if (pointer.button === 2)`（:3366；选中读取 :3367；派发 :3373）、左键选中分支（:3395；拾取 :3397 → 应用 :3398）。move 与信标**同通道**（`targetFlare`+`stance='search'`）、**同门控**（带宽三分支），差别仅在「选哪支舰队」：信标取最近，move 取玩家选中。

- **① `playerFlare` 全局单例限制**：`orderFleetMove` 复用 `createPlayerFlareVisual(x,y)`（delayed :1672 / 生效 :1685），与信标**共用同一视觉槽** `this.playerFlare`（字段 :104）。
  - ⇒ 未来**玩家多舰队**时，「move 目标位」与「信标位」会**争用同一视觉槽**（后建覆盖前建，且 `createPlayerFlareVisual` 首行无条件 `destroy` 旧容器）。
  - **现状不触发**（玩家仅 1 舰队）；**登记为已知限制**，多舰队改造时须一并拆分视觉槽。
- **② 2D 左键点舰队 = 选中会吞掉本次买地点击**（40px 阈值内）：属**设计意图**（交互规范 02 §1.3），但**值得真机确认手感**（点舰队与买地的命中区是否互斥清晰）。
- **③ 3D 盟军选中视觉**：当前盟军与己方**同用满亮轮廓**，el-6 建议未来做**独立视觉区分**（登记，非本批）。

---

## §3 #49 相关（FIX-3 限速航向角，`engineering-lead-5`）

- #49 的 **before 侧为「逆向重放重建」**（非 git 快照）——本仓库无覆盖 R10-B1 之前状态的 git 提交，基线文件**无法按字节取回**。
- 由 `_r10b1_reconstruct.cjs` 逆向重放确定性编辑重建；重建后**行数精确回到基线**（BattleScene 5516 / Battle3DOverlay 5383），hunk 结构与行号可信；**字节残差 −15 B / −298 B 仅注释措辞与行尾空白**。
- ⚠ **不得**将 `_r10b1_before_*.ts` 当作权威 before 源引用。
- 详见 **`_r10b1_diff_evidence.md` §0（文件哈希新旧对照）与 §5（诚实性声明与复核方式）**。

---

## §4 git 纪律更正（本轮实证）

- **只读 git 允许**：`git diff --no-index`、`git status`、`git log` 等**只读**命令可用于证据（本轮 #52 亦用 `diff --no-index` 做逐字等价校验）。
- **写 git 严禁**（本批次）：`commit` / `add` / `checkout` / `reset` 等**写操作**被禁止——
  - ① 该状态**无覆盖性提交**可回退（`HEAD` 的 `BattleScene.ts` 仅 4617 行，远早于 R10 基线），写 git 无法取回基线，反可能覆盖共享工作树；
  - ② 多队友**并发编辑同一文件**（#49/#52/#53 三段接力），任何 checkout/reset 会破坏他人在途改动。
- 实证文件：`_r10b1_gitprobe.txt`、`_r10b1_gitprobe2.txt`、`_lead_git_forensic.txt`。

---

## §5 本批次未纳入项（已登记待拍板）

> 以下均为**已识别但本批不修/不实现**的项，属「已登记待拍板」状态，防止从记忆中蒸发。

| # | 项 | 来源 | 状态 |
|---|---|---|---|
| 1 | **R3-D4：退出撤退即回城堡** | V16-R3 AI 复盘 §D4 | 已登记待拍板（#47 时 D4 明确 skip） |
| 2 | **B7：2 个 dead field**（`_userStanceLockUntil` / `_escortPlayer` 写而不读） | V16-R3 §5.2-B7 / V17-R1 | 已登记待拍板（B7 本批注册不修） |
| 3 | **三按钮 UX 文案**（索敌/攻坚/驻守无语义说明、无即时反馈） | V16-R2 §3.3（R3）/ 02 交互规范 | 已登记待拍板 |
| 4 | **F2：指令卡镜像 AI** | V16-R3 关联项 | 已登记待拍板 |

---

## 附：本台账引用的证据文件（只读，不再改动）

| 文件 | 用途 |
|---|---|
| `_r10b1_diff_evidence.md`（§0/§5） | #49 before 逆向重放说明 |
| `_lead_53_verify.txt` / `_lead_53_evidence.txt` | #53 终态核验与产物清单 |
| `_r10_batch_hashcheck.txt` | 本台账 §0 落笔时磁盘实测哈希 |
| `_v17r3_*.txt`（`_v17r3_probe` / `_v17r3_hunks` / `_v17r3_tsc_raw`） | #52 自证原始输出（S-2/S-3/S-4/S-5） |
| `docs/review/v16_03_AI与补给行为复盘.md` · `v17_01_AI决策全链路复盘.md` | R3/D4/B7、F2 登记项来源 |
