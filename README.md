# LOGH-Strategy（银河英雄传说 · 星域战略）

基于《银河英雄传说》题材的 **Windows 桌面端**星域战略游戏：在 3D 星图上推进战役、经营星域经济与行政，会战进入全 3D 指挥制战术战斗。

> 本文件同时面向两类读者：**人**（表格 + 下载链接，快速看懂）和 **AI / 新接手的开发者**（第 2 节是可直接复制执行的接手手册：clone → 装 Wails → 装依赖 → 跑基线 → 开始改）。

---

## 0. 30 秒速览

| 项目 | 值 |
| --- | --- |
| 仓库地址 | https://github.com/zhangjinmin/hex-strategy-game |
| Go module 名 | `hex-strategy-game`（历史遗留：早期是六角格玩法，现已演进为 3D 星域战略） |
| 应用 / 产物名 | `LOGH-Strategy`，窗口标题「银河英雄传说」 |
| 当前版本 | `0.1.0`（真源：`wails.json` → `info.productVersion`） |
| 最新 Release | https://github.com/zhangjinmin/hex-strategy-game/releases/tag/v0.1.0 （最新入口：/releases/latest） |
| 目标平台 | Windows 10 / 11 x64（依赖 WebView2 Runtime） |
| 桌面外壳 | Go + Wails v2.16.0 |
| 前端 | Vue 3 + TypeScript + Pinia + Vite + Phaser 4 + Three.js 0.160 |
| 开发验收方式 | `wails dev`（桌面窗口 + HMR），**不是**纯浏览器静态站 |
| 存档 | `build/HexFront_Saves.json`（由 Go 侧写入，不入库） |
| 许可 | 仓库**当前未包含 LICENSE 文件**；使用或再分发前请先与作者确认授权 |

### 0.1 游戏里有什么

| 功能 | 说明 | 主要实现位置 |
| --- | --- | --- |
| 3D 战略星图 | 星系、势力范围、舰队航路与星球经营一图呈现 | `game/three/ThreeStrategicMap.ts`、`game/scenes/StrategicScene.ts` |
| 指挥制 3D 战术战斗 | 战场可旋转、镜头自由；舰队按编制折算展开大军团阵型 | `game/scenes/BattleScene.ts`、`game/three/Battle3DOverlay.ts` |
| 银英风格舰船与特效 | 帝国 / 同盟各舰种 GLB、旗舰专属模型、护盾涟漪、激光束、尾焰 | `game/three/`、`assets/ship/` |
| 提督与指挥链 | 提督扮演、指挥权限、旗舰沉没继任、AI 意图可见、军议实时下令 | `game/battle/CommandAuthority.ts`、`game/TacticalCommandSystem.ts` |
| 后勤战 | 补给链判定、运输舰往返、断粮士气惩罚 | `game/SupplyChainSystem.ts`、`game/formationMorale.ts`、`game/retreatDoctrine.ts` |
| 军议与行政 | 提案、行政院审议、职位职权矩阵 | `components/meta/`、`store/` |
| 经济 | 税源结算、国库台账、造船生产管线 | `config/economy.ts` |
| 双轨开战 | 战役（结果回写宏观兵力 / 领土）与演习（战术模拟） | `game/fleetGeneration.ts`、`components/battle/` |
| 关卡编辑器 / 图鉴 | 场景编辑与 Wiki 词条 | `game/scenes/EditorScene.ts`、`components/wiki/` |

---

## 1. 只想玩：直接下载，不需要装任何开发环境

| 资产 | 大小 | 适用 | 说明 |
| --- | --- | --- | --- |
| `LOGH-Strategy-amd64-installer.exe` | 292,333,798 B（约 279 MiB） | 推荐 | NSIS 安装版，带开始菜单快捷方式与卸载程序 |
| `LOGH-Strategy-v0.1.0-win-x64.zip` | 293,331,078 B（约 280 MiB） | 不想安装 | 便携版，解压后运行 `LOGH-Strategy.exe` |
| `SHA256SUMS.txt` | 201 B | 校验 | 前两个安装包的 SHA-256 |

| 运行前提 | 说明 |
| --- | --- |
| 系统 | Windows 10 / 11 x64 |
| WebView2 Runtime | Win11 内置；Win10 首次启动可能联网自动补装 |
| 代码签名 | 未签名，SmartScreen 可能拦截 → 选「更多信息 → 仍要运行」 |
| 需要 Go / Node / Wails 吗 | **不需要**，Release 里的 exe 已把前端资源嵌入 |

---

## 2. 给 AI 的接手手册（从 clone 到第一处改动）

> 下面是**可执行**的顺序，不依赖本机已有环境（除 Go / Node / Git 外）。

### 2.1 一次性命令

```bash
# 0) 拉取
git clone https://github.com/zhangjinmin/hex-strategy-game.git
cd hex-strategy-game

# 1) 安装 Wails CLI（版本必须与 go.mod 对齐）
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
#    确认 $(go env GOPATH)/bin 在 PATH 里，然后：
wails doctor

# 2) 装依赖：根目录和 frontend 两处都要装，缺一不可
npm install                          # 根目录：pinia / vue / typescript / vue-tsc + 台架命令
cd frontend && npm ci && cd ..       # 前端：vite / three / phaser 等（用 lock 固定版本）

# 3) 确认两个"看着没用但必须存在"的文件还在
ls frontend/dist/.gitkeep _ts_resolve.mjs

# 4) 改动前先建立基线（避免把已有失败算到自己头上）
npm run typecheck
npm run sim
go build ./...
wails dev
```

| 步骤 | 为什么必须 |
| --- | --- |
| 根目录 `npm install` | `pinia`、`vue-tsc` 声明在**根** `package.json`。只装 `frontend/` 会在 `vue-tsc` 阶段报 `Cannot find module 'pinia'`（CI 真实踩过） |
| `frontend/npm ci` | 前端 `package-lock.json` 固定 Vite / Three.js / Phaser 版本 |
| `frontend/dist/.gitkeep` | `main.go` 的 `//go:embed all:frontend/dist` 要求目录里至少有一个文件，否则 `go build` 直接报 `no matching files found` |
| `_ts_resolve.mjs` | Node 的 ESM 钩子，让台架能直接 `require()` 项目里的 `.ts` 真源码；`npm run sim` 依赖它 |
| `wails dev` | 唯一真机验收方式：同时起 Vite HMR 和 Go 绑定。`localhost:34115` 是调试入口 |

### 2.2 两条最重要的架构约束

| 约束 | 后果 |
| --- | --- |
| 前端通过 `frontend/wailsjs/go/main/App.js` 调用 `window.go.main.App.SaveGameData / LoadGameData`（`app.go`） | **纯 `vite dev` / 静态网页版会丢失存读档能力**，不能当作完整游戏；必须跑 `wails dev` / `wails build` |
| 战场视觉真源是 Three.js 的 `Battle3DOverlay`，Phaser 的 `BattleScene` 是**无渲染的逻辑引擎** | `body.battle3d-mode` 会隐藏 Phaser 画布，但战场逻辑、`tilesList` / `tilesDict` 仍被依赖，**不可删** |

### 2.3 想改什么 → 去哪里 → 怎么验

| 想改的东西 | 主文件 / 目录 | 改完跑什么 |
| --- | --- | --- |
| 窗口标题 / 尺寸 / 启动最大化 | `main.go` | `go build ./...` + `wails dev` |
| 存档读写、Go 侧能力 | `app.go`（改完需重新生成 `frontend/wailsjs/` 绑定） | `go build ./...` |
| 战略层 UI、军议、菜单、设置 | `frontend/src/components/meta/`、`frontend/src/store/` | `npm run typecheck` + `wails dev` |
| 战术层 HUD、军议覆盖层 | `frontend/src/components/battle/` | `npm run typecheck` + `npm run sim` |
| 战斗逻辑（AI、阵型、情报、撤退、指令） | `frontend/src/game/` 下的纯函数模块（`aiDirector.ts`、`combatDoctrine.ts`、`combatControl.ts`、`retreatDoctrine.ts`）、`frontend/src/game/battle/`（指令 / 情报 / 侦察子系统）、`frontend/src/config/formations.ts`、`frontend/src/game/scenes/BattleScene.ts` | `npm run sim`（44 个台架） |
| 3D 战场 / 星图渲染、舰船 GLB | `frontend/src/game/three/`、`frontend/src/assets/ship/` | `wails dev` 真机截图验收 |
| 数值（射程、舰种、经济、兵力折算） | `frontend/src/config/`（射程与舰种的唯一真源是 `gameData.ts`） | `npm run sim` |
| UI 配色 / 字号 / 阵营皮肤 | `frontend/src/theme/design-system.css`（`tokens.css` 仅是兼容别名层） | `wails dev` 真机 |
| 构建 / 发版 | `wails.json`、`build-exe.cmd`、`.github/workflows/release.yml` | 第 8 节流程 |

> 项目约定：阈值 / 状态判定一律放进纯函数模块（`frontend/src/game/` 下的 `aiDirector.ts`、`combatDoctrine.ts`、`combatControl.ts`、`retreatDoctrine.ts`，以及 `frontend/src/config/formations.ts`），`BattleScene` 只做「快照 → 问模块 → 应用」。

### 2.4 提交前门禁

| 门禁 | 命令 | 通过标准 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 退出码 0 |
| Go 编译 | `go build ./...` | 退出码 0 |
| 回归台架 | `npm run sim` | 与第 7 节基线对比，**不得新增 FAIL** |
| 真机验收 | `wails dev` | 桌面窗口实际走一遍改动路径 |

---

## 3. 仓库地图

### 3.1 根目录

| 路径 | 类型 | 作用 | 备注 |
| --- | --- | --- | --- |
| `main.go` | Go 入口 | `wails.Run` 窗口配置、`//go:embed all:frontend/dist`、`Bind: app` | 窗口 1600×1200，启动最大化 |
| `app.go` | Go 后端 | `SaveGameData` / `LoadGameData`；存档写到 exe 同级（dev 产物在 `build/bin/` 时上移一级） | 目前 Go 侧唯一业务逻辑 |
| `go.mod` / `go.sum` | Go 依赖 | module `hex-strategy-game`，`go 1.25.0`，Wails `v2.16.0` | 版本真源 |
| `wails.json` | Wails 配置 | 产物名、前端 `install/build/dev` 命令、Windows 版本元数据 | **只有 `info.productVersion` 生效**，顶层 `productVersion` / `icon` 在 v2 不读 |
| `package.json` / `package-lock.json` | 根依赖与命令 | `pinia` `vue` `typescript` `vue-tsc`；`typecheck` / `sim` / `sim:wedge` | 不要只装前端依赖 |
| `_ts_resolve.mjs` | Node ESM 钩子 | 让台架直接 `require()` `.ts` 源码 | `npm run sim` 必需，`.gitignore` 里是白名单例外 |
| `scripts/` | 台架与工具 | 44 个 `*Sim.cjs` 行为回归台架、`runAllSims.cjs` 聚合门禁、`build_tracker.py` 追踪看板 | 台架必须引用真源码，禁止手抄常量 |
| `frontend/` | 前端工程 | Vue3 + Vite + Phaser + Three.js | 详见 3.2 |
| `build/` | 构建输入 / 输出 | `appicon.png`、`windows/`（图标、manifest、NSIS 模板）、`bin/`（产物，已忽略） | `build/HexFront_Saves.json` 是游戏存档，不入库 |
| `build-exe.cmd` | 本机构建脚本 | 一键产出 exe + NSIS 安装包 + zip | 需 `makensis` 在 PATH |
| `.github/workflows/release.yml` | CI 发版 | push `v*` tag → Windows 构建 → 自动上传 Release 资产 | 使用 Actions 内置 `GITHUB_TOKEN` |
| `docs/` | 文档 | 系统设计、ADR、3D 战术设计、PRD、QA 验收记录 | 索引见第 9 节 |
| `tools/` | 辅助 | QA 相关工具 | |
| `.gitignore` | 忽略规则 | 忽略 `build/bin/`、`*.exe`、存档、`frontend/dist/*`、根目录 `/_*` 探针 | 两个例外：`!frontend/dist/.gitkeep`、`!/_ts_resolve.mjs` |

### 3.2 `frontend/`

| 路径 | 作用 |
| --- | --- |
| `index.html` / `vite.config.ts` / `tsconfig*.json` | Vite 与 TypeScript 配置 |
| `package.json` / `package-lock.json` | 前端脚本：`dev` / `build`（`vue-tsc --noEmit && vite build`）/ `preview` / `generate:ship-lods` |
| `scripts/generateShipLods.mjs` | `predev` / `prebuild` 自动生成舰船 LOD |
| `src/main.ts` / `src/App.vue` | Vue 挂载、根组件与界面切换 |
| `src/components/meta/` | 战略层 UI：主菜单、军议、星图面板、设置等 |
| `src/components/battle/` | 战术层 HUD、战前军议覆盖层、指令卡等 |
| `src/components/wiki/` / `EditorScreen.vue` | 图鉴词条、关卡编辑器界面 |
| `src/game/scenes/` | `BattleScene.ts`（战术逻辑引擎）、`StrategicScene`、`EditorScene` |
| `src/game/three/` | `Battle3DOverlay`（战术 3D 视觉真源）、`ThreeStrategicMap`、舰船 GLB 加载管线 |
| `src/game/*.ts`（根目录散文件） | 战斗**纯函数模块**：`aiDirector.ts`、`combatDoctrine.ts`、`combatControl.ts`、`retreatDoctrine.ts`、`fleetKinematics.ts`、`taskForce.ts` 等；零 import 的模块可被台架直接 `require()` |
| `src/game/battle/` | 战斗子系统：`BattleTick`、`CommandAuthority`、`CommandSystem`、`IntelSystem`、`ScoutSystem` 等 |
| `src/config/formations.ts` | 阵型互克表（`FORMATION_COUNTERS`） |
| `src/store/` | Pinia：`gameStore`（含存档调用）、`fleetStore`、`settingsStore` |
| `src/config/` | 数值真源：`gameData.ts`（射程 / 舰种）、`economy.ts`、兵力折算等 |
| `src/theme/` | `design-system.css`（`--ui-*` / `--fs-*` 令牌与阵营皮肤）、`tokens.css`（兼容别名层） |
| `src/assets/` | 舰船 GLB、提督立绘、字体、音乐、星球 / 场景贴图；命名规范见 `ship/模型命名规范.md`、`scene/模型命名规范.md` |
| `src/services/` / `types/` / `utils/` | 服务层、类型定义、工具函数 |
| `public/` | 原样拷贝进 `dist/` 的静态资源 |
| `wailsjs/` | **Wails 自动生成**的 Go 绑定（`go/main/App.js`），勿手改 |
| `dist/` | Vite 构建产物，被 `go:embed` 嵌入 exe；版本库里只保留 `.gitkeep` 占位 |

---

## 4. 架构与数据流

| 层 | 实现 | 关键约束 |
| --- | --- | --- |
| 桌面外壳 | Wails v2（Go）+ WebView2 | Windows 目标；exe 内嵌前端产物 |
| Go 后端 | `app.go` | 目前只负责存读档 |
| 前后端桥 | `frontend/wailsjs/go/main/App.js` → `window.go.main.App` | 脱离 Wails 时 `window.go` 不存在，存读档失效 |
| 界面 | Vue 3 + Pinia + `theme/design-system.css` | 阵营皮肤只在已进入对局时生效 |
| 战术逻辑 | Phaser `BattleScene`（无渲染逻辑引擎）+ `game/*.ts` 纯函数模块 + `game/battle/` 子系统 | 阈值 / 状态判定不写死在 Scene 里 |
| 视觉 | Three.js `Battle3DOverlay` / `ThreeStrategicMap` + GLB 舰船 | 3D 是视觉真源；Phaser 画布在 `battle3d-mode` 下隐藏但不可删 |
| 资源嵌入 | `main.go` 的 `//go:embed all:frontend/dist` | `frontend/dist/` 必须至少有一个文件 |

```
Vue 组件 ──→ Pinia store ──→ BattleScene（战术逻辑）──→ game/*.ts 纯函数模块
    │              │                    │
    │              │                    └──→ Battle3DOverlay（Three.js）──→ 屏幕
    │              └──→ wailsjs 绑定 ──→ app.go ──→ HexFront_Saves.json
    └──→ ThreeStrategicMap（战略 3D 星图）
```

---

## 5. 环境要求

| 工具 | 版本 | 版本真源 | 安装 / 校验 |
| --- | --- | --- | --- |
| Go | ≥ 1.25.0（本机 1.27.0） | `go.mod` | `go version` |
| Wails CLI | **v2.16.0** | `go.mod`、`.github/workflows/release.yml` | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`；`wails doctor`；确认 `$(go env GOPATH)/bin` 在 PATH |
| Node.js | 22（CI `setup-node` 固定；本机 22.22.2） | `.github/workflows/release.yml` | `node -v` |
| npm | 10+（本机 10.9.7） | 随 Node | `npm -v` |
| Git | 较新版本即可 | | `git --version` |
| Windows 10/11 x64 + WebView2 Runtime | 运行 / 打包目标 | | Win11 内置 |
| NSIS（`makensis.exe`） | 仅打安装包时需要 | | 安装后加入 PATH，否则 Wails 只警告「Cannot create installer」 |
| GitHub Actions | 云端发版使用 | | 无需本机 `gh` CLI 或 API token |

---

## 6. 命令速查

| 命令 | 执行目录 | 作用 | 预期结果 |
| --- | --- | --- | --- |
| `wails dev` | 仓库根 | 开发模式：Go 绑定 + Vite HMR | 桌面窗口；调试入口 `http://localhost:34115` |
| `npm run dev` | `frontend/` | 只起 Vite（**无 Go 绑定，存档不可用**） | 仅用于纯 UI 调试 |
| `npm run typecheck` | 仓库根 | `vue-tsc --noEmit` 全量类型检查 | 退出码 0 |
| `npm run sim` | 仓库根 | `scripts/runAllSims.cjs` 跑全部 44 个 `*Sim.cjs` | 见第 7 节基线 |
| `npm run sim:wedge` | 仓库根 | 单独跑楔形阵可读性台架 | |
| `npm run build` | `frontend/` | `vue-tsc --noEmit && vite build` | 生成 `frontend/dist/` |
| `go build ./...` | 仓库根 | 校验 Go 侧可编译 | 退出码 0 |
| `wails build` | 仓库根 | 前端 + Go 打成单文件 exe | `build/bin/LOGH-Strategy.exe` |
| `wails build -clean -trimpath -nsis` | 仓库根 | 追加 NSIS 安装包 | `build/bin/LOGH-Strategy-amd64-installer.exe` |
| `build-exe.cmd` | 仓库根（Windows cmd） | 一键：exe + 安装包 + zip | 产物列在 `build/bin/` |
| `python scripts/build_tracker.py` | 仓库根 | 生成 `tracking-dashboard.html` 进度看板 | |

---

## 7. 当前验证基线（v0.1.0 / commit `e060893`，改代码前请先对齐）

| 门禁 | 实测结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | 退出码 **0** | 无报错 |
| `go build ./...` | 退出码 **0** | 无报错 |
| `npm run sim` | 44 个台架：**PASS 43 / FAIL 1**，退出码 **1** | 唯一失败是 `uiVisibilitySim.cjs` 的过期断言 `选择器缺失: .battle-loss`（UI 类名已改），**不是新回归** |
| `wails build -clean -trimpath -nsis` | 成功 | 需 NSIS 在 PATH 且 `build/windows/icon.ico` 合法（>1 MB 的坏 ico 会让 Wails 重新从 `appicon.png` 生成） |
| Release `v0.1.0` | 3 个资产均可下载 | 由 GitHub Actions 发布，非草稿、非 prerelease |

> 判据：**不得新增 FAIL**，而不是「必须全绿」。若把 `.battle-loss` 断言修好，基线应更新为 44/0。

---

## 8. 打包与发版

| 步骤 | 动作 | 关键点 |
| --- | --- | --- |
| 1. 改版本号 | 同步 `wails.json` → `info.productVersion`、`build-exe.cmd` → `VERSION` / `ZIP`、tag | 顶层 `productVersion` 在 Wails v2 **不生效**，缺失时会被写成 `1.0.0` |
| 2. 本地验证 | `npm run typecheck`、`npm run sim`、`go build ./...`、`wails dev` 真机 | |
| 3. 本机出包（可选） | 双击 / 运行 `build-exe.cmd` | 会检查 `wails dev` 是否占用、把 NSIS 加进 PATH、自愈坏图标、补 `.gitkeep`、产出 zip |
| 4. 推送代码 | `git push origin main` | |
| 5. 打 tag 触发 CI | `git tag -a v0.1.1 -m "..." && git push origin v0.1.1` | `.github/workflows/release.yml` 监听 `v*`，也支持 `workflow_dispatch` 手动触发 |
| 6. CI 构建 | `windows-latest`：装 Go / Node 22 / Wails / NSIS → 根目录 `npm install` + `frontend/npm ci` → `npm run build` → `wails build -s -clean -trimpath -nsis` → 打 zip 和 `SHA256SUMS.txt` | `-s` 表示跳过重复的前端构建 |
| 7. 发布 | `softprops/action-gh-release@v2` 用内置 `GITHUB_TOKEN` 上传 3 个资产 | **本机不需要 `gh` CLI 或 GitHub API token** |

| 注意 | 原因 |
| --- | --- |
| 打 tag 前先推 main | tag 指向的 commit 必须包含最新修复 |
| 版本号三处对齐 | 否则 exe 元数据、zip 名、Release 名会不一致 |
| `build/windows/installer/wails_tools.nsh` 保持模板态 | 构建时会临时把 `{{.Info.*}}` 占位符替换写回，别把生成态提交进仓库 |

---

## 9. 设计文档索引

| 主题 | 路径 |
| --- | --- |
| 3D 战术总览 | `docs/3d-tactical-battle-overview.md` |
| 3D 战术设计（01–35 + README） | `docs/design/3d-tactical-battle/`，其中 `26-combat-rebuild-proposal.md` 是对战重构计划真源、`30`~`35` 是最新的战斗结构 / 剧本切片 |
| 架构决策记录（ADR） | `docs/architecture/3d-tactical-battle/` |
| 系统设计 / 类图 / 时序图 | `docs/system_design.md`、`system_design_v3.md`、`class-diagram*.mermaid`、`sequence-diagram*.mermaid` |
| 指令 / 星球模型规范 | `docs/design/command_mode_spec.md`、`docs/design/战略地图星球模型规范.md` |
| 银英旧案单机化梳理 | `docs/design/银英旧案单机化梳理与融合方案.md` |
| 产品需求 | `docs/PRD_*.md`（人物标签、军议与行政、舰队后勤等） |
| QA 验收记录 | `docs/qa/v*.md`（按版本编号，含问题描述、独立验证与真机结论） |
| 模型命名规范 | `frontend/src/assets/ship/模型命名规范.md`、`frontend/src/assets/scene/模型命名规范.md` |
| 进度看板 | `scripts/build_tracker.py` 生成 `tracking-dashboard.html` |

---

## 10. 注意事项（踩过的坑，别重复）

| 不要做 | 原因 |
| --- | --- |
| 删 `frontend/dist/.gitkeep` | `go:embed all:frontend/dist` 会报 `no matching files found`，裸 `go build` 直接失败 |
| 删 `_ts_resolve.mjs` | `npm run sim` 的 44 个台架无法 `require()` `.ts` 真源码 |
| 只装 `frontend/` 依赖 | `pinia` 在根 `package.json`，CI 已因此失败过一次 |
| 在 `wails dev` 运行时跑 `wails build` / `npx vite build` | 会挂掉 Wails 的 Vite 子进程和 HMR，只能重启 `wails dev` |
| 用 `127.0.0.1:34115` 做验收 | 本机代理没排除 loopback，可能返回 502 假象；用 `localhost:34115` |
| 用「旧构建 / 缓存」解释真机问题 | `wails dev` 是 HMR 实时代码，出现「我这边对、用户仍见问题」只能是代码问题 |
| 手改 `frontend/wailsjs/` | Wails 自动生成的绑定 |
| 提交 `build/bin/`、`*.exe`、`frontend/dist/*`、存档、探针输出 | `.gitignore` 已覆盖，别用 `-f` 强加 |
| 改战斗阈值时直接写进 `BattleScene` | 项目约定放进 `game/` 下的纯函数模块，并用 `scripts/*Sim.cjs` 台架锁行为 |

---

## 11. 存档、许可与作者

| 项 | 说明 |
| --- | --- |
| 存档位置 | 开发期 `build/HexFront_Saves.json`；发布版在 exe 同级目录。由 `app.go` 的 `getSavePath()` 决定 |
| 存档入库 | 否，`.gitignore` 已排除 |
| 许可 | 仓库当前**没有 LICENSE 文件**，使用 / 再分发前请联系作者确认授权 |
| 作者 | JM@IN · damocles@sina.com |
| 调试面板 | 真机按 `Ctrl+Shift+D` 可查看情报 / 3D 诊断信息 |

---

如果你只是想接着开发：**第 2.1 节的命令清单 + 第 7 节基线**就是全部起点。
