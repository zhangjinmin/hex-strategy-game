# LOGH-Strategy（银河英雄传说 · 星域战略）

基于《银河英雄传说》题材的桌面端星域战略游戏。玩家在三维星图上推进战役、经营星域经济与行政，会战进入**全 3D 指挥制战术战斗**——可自由旋转的战场星域、按编制折算的大舰队、提督指挥链与后勤补给线。

> 仓库模块名：`hex-strategy-game`（历史遗留，早期版本为六角格玩法，现已演进为 3D 星域战略）；应用产物名：`LOGH-Strategy`；当前版本：`0.1.0`。

## 特性

- **3D 战略星图**：基于 Three.js 的三维银河地图，星系、势力范围、舰队航路与星球经营一图呈现。
- **指挥制 3D 战术战斗**：BattleScene 逻辑层 + Three.js 战场渲染，星空可旋转、镜头自由；舰队按兵力折算（1:100）展开为大军团阵型，主炮/导弹/舰载机/护盾涟漪全套银英风格特效。
- **真实舰船模型**：GLB 模型管线（帝国/同盟各舰种 + 旗舰专属模型自动装配、推进火焰、舰船图鉴一键检阅全部模型）。
- **提督与指挥链**：提督扮演、总指挥权限、旗舰沉没指挥继任、AI 意图可见、军议面板实时下令。
- **后勤战**：补给链判定、运输舰独立往返、断粮士气崩溃三段式惩罚——远征与驻防的攻守差异由此而来。
- **军议与行政系统**：军议提案、行政院审议、职位职权与权限矩阵，驱动战略层决策。
- **经济系统**：单一税源结算、国库台账、造船生产管线（经济配置见 `frontend/src/config/economy.ts`）。
- **双轨开战**：战役（大地图会战，结果回写宏观兵力/领土）与演习（战术模拟）两条进入战术层的通道。
- **关卡编辑器**：内置场景编辑（EditorScene）与 Wiki 词条面板。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面外壳 / 后端 | Go + [Wails](https://wails.io) v2.12 |
| 前端框架 | Vue 3 + TypeScript + Pinia |
| 战术战斗逻辑 | Phaser 场景（无渲染依赖的逻辑引擎） |
| 3D 渲染（战略星图 + 战术战场） | Three.js |
| 舰船模型 | GLTF（GLB）+ 自研加载/换装管线 |
| 构建工具 | Vite |
| 语言 | Go 1.23+ / TypeScript |

## 环境要求

- **Go** 1.23 或更高（`go.mod` 指定 `go 1.23.0`）
- **Node.js** 18+（LTS 推荐）
- **Wails CLI** v2：

  ```bash
  go install github.com/wailsapp/wails/v2/cmd/wails@latest
  ```

- 当前构建目标为 **Windows**（图标资源为 `.ico`）；其他平台需相应调整 `wails.json` 的 `icon` 与构建标签。

## 快速开始

### 1. 安装依赖

Wails 会在首次 `dev` / `build` 时自动执行 `npm install`。也可手动预装：

```bash
cd frontend
npm install
```

### 2. 开发模式（热重载）

```bash
wails dev
```

- 启动 Vite 开发服务器，前端改动即时热重载。
- 同时监听 `http://localhost:34115`，可在浏览器中打开并调用 Go 侧方法。

### 3. 生产构建

```bash
wails build
```

产物位于 `build/bin/LOGH-Strategy.exe`（该目录已被 `.gitignore` 排除，不进入版本库）。

### 4. 运行

直接启动 `build/bin/LOGH-Strategy.exe` 即可（应用启动即最大化窗口）。

## 项目结构

```
hex-strategy-game/
├── main.go / app.go        # Wails 应用入口与 Go 后端逻辑
├── go.mod / go.sum         # Go 依赖
├── wails.json              # Wails 项目配置（产物名、前端脚本等）
├── frontend/               # Vue3 + Phaser + Three.js 前端
│   ├── src/
│   │   ├── components/     # 界面（battle 战术层 / meta 战略层 / wiki / editor）
│   │   ├── game/
│   │   │   ├── scenes/     # BattleScene（战术逻辑）/ StrategicScene / EditorScene
│   │   │   ├── three/      # Battle3DOverlay（战术3D）/ ThreeStrategicMap（战略3D）/ shipModels（GLB管线）
│   │   │   ├── SupplyChainSystem.ts   # 补给链与运输舰
│   │   │   └── TacticalCommandSystem.ts  # 指挥点与指挥链
│   │   ├── store/          # Pinia 状态（gameStore / fleetStore / settingsStore 等）
│   │   ├── config/         # 数值与折算（shipScaling 兵力折算 / economy / gameData）
│   │   └── assets/         # 舰船 GLB 模型 / 音乐 / 场景资产（模型命名规范见 assets/ship/模型命名规范.md）
│   ├── public/             # 静态资源
│   └── package.json
├── docs/                   # 设计文档与 PRD（见下文）
├── scripts/                # 辅助脚本（如构建追踪看板）
├── build/                  # 构建产物与图标（部分被 gitignore）
└── README.md
```

## 存档

游戏存档默认写入 `build/HexFront_Saves.json`（已被 `.gitignore` 排除，不会提交到仓库）。

## 设计文档

`docs/` 目录包含系统设计与产品需求文档：

- `system_design.md` / `system_design_v3.md` — 系统设计方案
- `architecture/3d-tactical-battle/` — 3D 战术战斗架构决策记录（ADR）
- `class-diagram.mermaid` / `class-diagram-v3.mermaid` — 类图
- `sequence-diagram.mermaid` / `sequence-diagram-v3.mermaid` — 时序图
- `PRD_人物标签体系与职位数据结构改造.md`
- `PRD_军议重构_行政系统_职位职权_舰队归属.md`
- `PRD_军议瘦身_行政院补全_星球本地化.md`
- `PRD_舰队后勤体系_库存运输兵工厂.md`

## 追踪看板

`scripts/build_tracker.py` 可生成项目进度追踪看板（`tracking-dashboard.html`），用于概览统计、更新时间线与机制说明。

## 许可

详见仓库 LICENSE 文件（如未提供，请与作者联系确认使用条款）。

---

作者：JM@IN · 邮箱：damocles@sina.com
