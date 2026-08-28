# LOGH-Strategy（银河英雄传说 · 六角战略）

基于《银河英雄传说》题材的桌面端六角格战略游戏。玩家在银河战场上进行舰队调度、星球经营与政治博弈，融合 2D 动画风格战斗演出与 3D 战略地图推演。

> 仓库模块名：`hex-strategy-game`；应用产物名：`LOGH-Strategy`；当前版本：`0.1.0`。

## 特性

- **六角格战略地图**：基于 Three.js 的三维星图，支持星系、势力范围与舰队调动的直观呈现。
- **2D 战斗演出（银英风格）**：基于 Phaser 的 BattleScene，含护盾涟漪、激光束、战舰尾焰等科幻特效。
- **军议与行政系统**：军议提案、行政院审议、职位职权与权限矩阵，驱动决策流程。
- **星球本地化经营**：星球级操作（友方 / 敌方差异化规则）、经济与每日结算。
- **人物与舰队体系**：人物标签、 Admiral 编成、舰队归属与后勤（库存 / 运输 / 兵工厂）。
- **完整游戏循环**：开场流程、通讯、设置与多档存档。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面外壳 / 后端 | Go + [Wails](https://wails.io) v2.12 |
| 前端框架 | Vue 3 + TypeScript + Pinia |
| 2D 战斗 | Phaser 4 |
| 3D 战略地图 | Three.js |
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

直接启动 `build/bin/LOGH-Strategy.exe` 即可。

## 项目结构

```
hex-strategy-game/
├── main.go / app.go        # Wails 应用入口与 Go 后端逻辑
├── go.mod / go.sum         # Go 依赖
├── wails.json              # Wails 项目配置（产物名、前端脚本等）
├── frontend/               # Vue3 + Phaser + Three.js 前端
│   ├── src/                # 源码（components / store / game / config）
│   ├── public/             # 静态资源（美术、音频）
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
- `class-diagram.mermaid` / `class-diagram-v3.mermaid` — 类图
- `sequence-diagram.mermaid` / `sequence-diagram-v3.mermaid` — 时序图
- `PRD_人物标签体系与职位数据结构改造.md`
- `PRD_军议重构_行政系统_职位职权_舰队归属.md`
- `PRD_军议瘦身_行政院补全_星球本地化.md`
- `PRD_舰队后勤体系_库存运输兵工厂.md`

## 追踪看板

`scripts/build_tracker.py` 可生成项目进度追踪看板（HTML），用于概览统计、更新时间线与机制说明。

## 许可

详见仓库 LICENSE 文件（如未提供，请与作者联系确认使用条款）。

---

作者：JM@IN · 邮箱：damocles@sina.com
