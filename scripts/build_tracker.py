#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银英策略游戏 (hex-strategy-game / LOGH-Strategy) 追踪看板生成器
-----------------------------------------------------------------
无 git 仓库，故以「文件修改时间」作为更新权威信号。
扫描项目源码/文档/资产，生成自包含 HTML 看板（内嵌 logo、按日期倒序的时间线）。

运行（受管 Python）:
  C:\\Users\\zhangjinmin\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe scripts/build_tracker.py

输出: tracking-dashboard.html (项目根目录)
"""
import base64
import os
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGO = PROJECT_ROOT / "build" / "appicon.png"
OUT = PROJECT_ROOT / "tracking-dashboard.html"

ASSET_EXT = {".jpg", ".jpeg", ".png", ".mp3", ".woff2", ".gif", ".svg", ".ico"}
EXCLUDE_DIRS = {"node_modules", "dist", ".workbuddy", ".git"}

# ---------------------------------------------------------------- scan
code_files = []   # (mtime:datetime, rel:str, ext:str, top:str)
asset_files = []  # (mtime:datetime, rel:str, ext:str, top:str)
doc_files = []    # (mtime:datetime, rel:str)

for p in PROJECT_ROOT.rglob("*"):
    if not p.is_file():
        continue
    rel_parts = p.relative_to(PROJECT_ROOT).parts
    if any(seg in EXCLUDE_DIRS for seg in rel_parts):
        continue
    ext = p.suffix.lower()
    mtime = datetime.fromtimestamp(p.stat().st_mtime)
    rel = str(p.relative_to(PROJECT_ROOT))
    top = rel_parts[0] if len(rel_parts) > 1 else ""
    if ext in ASSET_EXT:
        asset_files.append((mtime, rel, ext, top))
    else:
        code_files.append((mtime, rel, ext, top))
    if top == "docs" and ext in (".md", ".mermaid"):
        doc_files.append((mtime, rel))

code_files.sort(key=lambda x: x[0], reverse=True)
asset_files.sort(key=lambda x: x[0], reverse=True)
doc_files.sort(key=lambda x: x[0], reverse=True)

last_update = code_files[0][0] if code_files else datetime.now()
first_update = code_files[-1][0] if code_files else datetime.now()

total_source = len(code_files) + len(asset_files)
code_count = len(code_files)
asset_count = len(asset_files)
ts_count = sum(1 for f in code_files if f[2] == ".ts")
vue_count = sum(1 for f in code_files if f[2] == ".vue")
doc_count = len(doc_files)

# ---------------------------------------------------------------- timeline
CAT_LABEL = {
    "store": "状态", "config": "配置", "components": "UI", "game": "引擎",
    "utils": "工具", "types": "类型", "theme": "主题", "services": "服务",
    "docs": "文档", "scripts": "脚本", "frontend": "前端", "": "根",
}
timeline_html = ""
cur_date = None
day_block = ""
for mtime, rel, ext, top in code_files:
    d = mtime.date()
    if d != cur_date:
        if day_block:
            timeline_html += f'<div class="day"><div class="day-h">{cur_date.isoformat()}</div><div class="day-list">{day_block}</div></div>\n'
        cur_date = d
        day_block = ""
    cat = CAT_LABEL.get(top, top)
    day_block += (
        f'<div class="file"><span class="cat">{cat}</span>'
        f'<span class="fname">{rel}</span>'
        f'<span class="ftime">{mtime.strftime("%H:%M")}</span></div>\n'
    )
if day_block:
    timeline_html += f'<div class="day"><div class="day-h">{cur_date.isoformat()}</div><div class="day-list">{day_block}</div></div>\n'

# ---------------------------------------------------------------- mechanisms (curated from docs)
mechanisms = [
    {"name": "军议提案系统", "cat": "政治 / 决策", "status": "已实现 · 第三轮瘦身为 7 类",
     "desc": "每月自动生成提案（invasion/defense/conscription/morale_boost/personnel/budget/fortify），经政治投票系数表决后由 executeProposalEffect 执行效果。v3 从原 12 类删减为 7 类，系数与权限同步收敛。",
     "files": "utils/proposalEngine.ts · CouncilPanel.vue · PoliticalCouncilPanel.vue",
     "doc": "PRD_军议重构… · system_design_v3.md §3.1/§4.1"},
    {"name": "行政院系统", "cat": "行政 / 治理", "status": "已实现 · 6 模块",
     "desc": "外交/情报/财政/科技等模块；原军议 5 类其中 4 类迁移为 AdminOperationType（logistics/tech_mobilize/intel_op/diplomat_op），在 AdminPanel 外交/情报 tab 实现完整交互，财政/科技新增按钮入口，受 ROLE_ADMIN_PERMISSIONS 约束。",
     "files": "store/adminStore.ts · components/meta/AdminPanel.vue",
     "doc": "PRD_军议瘦身… · system_design_v3.md §1.1/§4.2"},
    {"name": "二次确认机制", "cat": "交互 / 安全", "status": "已实现",
     "desc": "ConfirmDialog.vue 通用弹窗，≥₮2000 的高成本操作弹确认框；由 gameStore.pendingConfirm 驱动显示，行政院与星球本地操作均可触发。",
     "files": "components/meta/ConfirmDialog.vue · store/gameStore.ts",
     "doc": "system_design_v3.md §1.1/§2.2"},
    {"name": "星球本地化操作", "cat": "战略 / 地图", "status": "已实现",
     "desc": "友方 7 项（LocalOperationType：special_tax/security_boost/welfare_invest/fortify_local/set_hq/emergency_draft/intel_gather），敌方 3 项（EnemyOpType：recon/infiltrate/subvert）。Phaser Container 绘制面板，带本地冷却 localCooldowns。",
     "files": "game/scenes/StrategicScene.ts · store/adminStore.ts",
     "doc": "PRD_军议瘦身… §6 · system_design_v3.md §4.3/§T03"},
    {"name": "权限矩阵", "cat": "规则 / 约束", "status": "已实现",
     "desc": "ROLE_PERMISSIONS_V2（7 类）+ ROLE_ADMIN_PERMISSIONS + ROLE_LOCAL_PERMISSIONS + ROLE_ENEMY_PERMISSIONS 四表并列，提供统一权限校验入口。",
     "files": "config/roleConfig.ts",
     "doc": "system_design_v3.md §1.1/§3.5/§7.5"},
    {"name": "人物标签体系", "cat": "角色 / 数值", "status": "已实现",
     "desc": "TAG_META_MAP / PERSONALITY_MODIFIERS / MILITARY_STYLE_PARAMS / POLITICAL_VOTE_COEFFICIENTS；政治标签影响提案投票权重，性格/军事风格影响将领行为。",
     "files": "config/tagConfig.ts · PRD_人物标签体系…",
     "doc": "PRD_人物标签体系与职位数据结构改造.md §4/§7"},
    {"name": "职位职权矩阵", "cat": "人事 / 数值", "status": "已实现",
     "desc": "职位体系 + calculateRoleEfficiency 适配度计算；军衔/职务与权限、指挥权绑定，驱动人事任免与效率。",
     "files": "config/roleConfig.ts · store/adminStore.ts",
     "doc": "PRD_军议重构… §6 · system_design_v3.md §3.2"},
    {"name": "舰队归属", "cat": "军事 / 编制", "status": "已实现",
     "desc": "initFleetAssignment / assignFleetByNovel 按小说设定分配舰队归属；canCommandFleet 控制调动权限（硬约束，v3 不变）。",
     "files": "store/fleetStore.ts · utils/*",
     "doc": "PRD_军议重构… §7 · system_design_v3.md §1.3"},
    {"name": "每日结算", "cat": "经济 / 模拟", "status": "已实现",
     "desc": "processDailyFinance / Personnel / Welfare / Technology 推进国政；processDailyLocalCooldowns 推进星球本地操作冷却。",
     "files": "store/adminStore.ts",
     "doc": "system_design_v3.md §1.3/§3.6"},
    {"name": "战斗系统", "cat": "战斗 / 模拟", "status": "已实现",
     "desc": "battleResolver 战损与胜负结算 + fleetStore 舰队状态 + formations 阵型 + aiEngine AI 决策；BattleScene 银英风格特效（护盾涟漪/激光束/尾焰）。",
     "files": "store/battleResolver.ts · store/aiEngine.ts · config/formations.ts · game/scenes/BattleScene.ts",
     "doc": "—（代码实现，无独立 PRD）"},
    {"name": "经济系统", "cat": "经济 / 数值", "status": "迭代中 · Aug 24 活跃",
     "desc": "config/economy.ts + balance.ts 经济数值与平衡参数；EconomyPanel.vue 经济面板、StrategicScreen 战略大屏集成。当前最活跃开发方向。",
     "files": "config/economy.ts · config/balance.ts · components/meta/EconomyPanel.vue · StrategicScreen.vue",
     "doc": "—（最新迭代，见时间线）"},
    {"name": "战略地图", "cat": "地图 / 可视化", "status": "已实现",
     "desc": "ThreeStrategicMap.ts（Three.js 3D）与 StrategicScene.ts（Phaser 2D）双渲染；星图节点、舰队、右键菜单/本地化操作面板。",
     "files": "game/three/ThreeStrategicMap.ts · game/scenes/StrategicScene.ts",
     "doc": "system_design_v3.md §4.3"},
    {"name": "通讯面板", "cat": "UI / 叙事", "status": "迭代中 · Aug 24 活跃",
     "desc": "CommsPanel.vue 情报/通讯流，呈现战报与事件推送。随大屏/经济模块一起迭代。",
     "files": "components/meta/CommsPanel.vue",
     "doc": "—（最新迭代，见时间线）"},
    {"name": "设置与存档", "cat": "系统", "status": "已实现",
     "desc": "settingsStore + SettingsPanel + SaveManagerModal；HexFront_Saves.json 存档，loadFromSlot 兼容旧档（过滤已删提案类型、缺失冷却填充空对象）。",
     "files": "store/settingsStore.ts · components/meta/SaveManagerModal.vue · build/HexFront_Saves.json",
     "doc": "system_design_v3.md §1.1/§2.2"},
    {"name": "开场与战役流程", "cat": "流程", "status": "已实现",
     "desc": "TitleScreen / OpeningBriefing / ScenarioSelectModal / MainMenu / AdmiralSelectModal 串联开局→选将→选剧本→主菜单流程。",
     "files": "components/meta/{TitleScreen,OpeningBriefing,ScenarioSelectModal,MainMenu,AdmiralSelectModal}.vue",
     "doc": "—（代码实现）"},
]

mech_html = ""
for m in mechanisms:
    mech_html += f"""
    <div class="mech">
      <div class="mech-head">
        <span class="mech-name">{m['name']}</span>
        <span class="mech-cat">{m['cat']}</span>
      </div>
      <div class="mech-status">{m['status']}</div>
      <div class="mech-desc">{m['desc']}</div>
      <div class="mech-meta"><b>关键文件</b> {m['files']}</div>
      <div class="mech-meta"><b>文档</b> {m['doc']}</div>
    </div>"""

# ---------------------------------------------------------------- docs index
doc_html = ""
for mtime, rel in doc_files:
    name = Path(rel).name
    kind = "PRD" if name.startswith("PRD") else ("系统设计" if "system_design" in name else ("类图" if "class-diagram" in name else ("时序图" if "sequence" in name else "文档")))
    doc_html += f'<div class="doc"><span class="doc-kind">{kind}</span><span class="doc-name">{name}</span><span class="doc-date">{mtime.strftime("%Y-%m-%d")}</span></div>\n'

# ---------------------------------------------------------------- logo
logo_uri = ""
if LOGO.exists():
    b64 = base64.b64encode(LOGO.read_bytes()).decode()
    logo_uri = f"data:image/png;base64,{b64}"

GEN_TIME = datetime.now().strftime("%Y-%m-%d %H:%M")

# ---------------------------------------------------------------- html
html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>银河英雄传说 · 策略游戏 追踪看板</title>
<style>
  :root {{
    --bg:#0a0e1a; --panel:#121829; --panel2:#0f1424; --line:#243049;
    --txt:#e7edfb; --mut:#8da0c4; --gold:#d4af37; --cyan:#4fd1ff;
    --green:#46d39a; --amber:#f5b94a;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--txt);
    font-family:"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    line-height:1.55; }}
  .wrap {{ max-width:1180px; margin:0 auto; padding:28px 22px 60px; }}
  header.top {{ display:flex; align-items:center; gap:18px;
    border-bottom:1px solid var(--line); padding-bottom:20px; margin-bottom:26px; }}
  .logo {{ width:74px; height:74px; border-radius:12px; border:1px solid var(--gold);
    box-shadow:0 0 22px rgba(212,175,55,.25); object-fit:cover; }}
  .title h1 {{ margin:0; font-size:24px; letter-spacing:.5px; }}
  .title .sub {{ color:var(--mut); font-size:13px; margin-top:4px; }}
  .stack {{ margin-top:8px; }}
  .badge {{ display:inline-block; font-size:11px; color:var(--cyan);
    border:1px solid var(--line); border-radius:20px; padding:2px 10px; margin-right:6px; }}
  h2.sec {{ font-size:17px; margin:34px 0 14px; padding-left:11px;
    border-left:3px solid var(--gold); letter-spacing:.5px; }}
  .stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; }}
  .stat {{ background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }}
  .stat .n {{ font-size:26px; font-weight:700; color:var(--gold); }}
  .stat .l {{ font-size:12px; color:var(--mut); margin-top:3px; }}
  .state {{ background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px 20px; }}
  .state li {{ margin:5px 0; }}
  .state b {{ color:var(--cyan); }}
  .day {{ margin-bottom:10px; border-left:2px solid var(--line); padding-left:16px; position:relative; }}
  .day::before {{ content:""; position:absolute; left:-6px; top:6px; width:10px; height:10px;
    border-radius:50%; background:var(--gold); box-shadow:0 0 10px rgba(212,175,55,.5); }}
  .day-h {{ font-weight:700; color:var(--gold); font-size:14px; margin-bottom:6px; }}
  .day-list {{ display:flex; flex-direction:column; gap:3px; }}
  .file {{ display:flex; align-items:center; gap:10px; font-size:13px; flex-wrap:wrap; }}
  .cat {{ font-size:10px; color:var(--cyan); border:1px solid var(--line); border-radius:6px; padding:1px 7px; }}
  .fname {{ color:var(--txt); font-family:"Cascadia Code",Consolas,monospace; font-size:12.5px; }}
  .ftime {{ color:var(--mut); font-size:11px; margin-left:auto; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); gap:14px; }}
  .mech {{ background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:15px 17px; }}
  .mech-head {{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; }}
  .mech-name {{ font-size:15px; font-weight:700; }}
  .mech-cat {{ font-size:11px; color:var(--mut); }}
  .mech-status {{ font-size:11.5px; color:var(--green); margin:5px 0 8px; }}
  .mech-desc {{ font-size:13px; color:#cdd7ee; }}
  .mech-meta {{ font-size:11.5px; color:var(--mut); margin-top:7px; }}
  .mech-meta b {{ color:var(--cyan); font-weight:600; }}
  .doc {{ display:flex; align-items:center; gap:12px; background:var(--panel2);
    border:1px solid var(--line); border-radius:9px; padding:9px 14px; margin-bottom:7px; font-size:13px; }}
  .doc-kind {{ font-size:10px; color:var(--gold); border:1px solid var(--line); border-radius:6px; padding:1px 8px; }}
  .doc-name {{ flex:1; font-family:Consolas,monospace; font-size:12.5px; }}
  .doc-date {{ color:var(--mut); font-size:11px; }}
  footer {{ margin-top:40px; border-top:1px solid var(--line); padding-top:16px;
    color:var(--mut); font-size:12px; }}
  code {{ background:#0c1120; border:1px solid var(--line); border-radius:5px; padding:1px 6px; color:var(--cyan); }}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    {f'<img class="logo" src="{logo_uri}" alt="logo">' if logo_uri else ''}
    <div class="title">
      <h1>银河英雄传说 · 策略游戏 追踪看板</h1>
      <div class="sub">hex-strategy-game · 可执行 LOGH-Strategy.exe · 生成于 {GEN_TIME}</div>
      <div class="stack">
        <span class="badge">Vue 3</span><span class="badge">Phaser</span>
        <span class="badge">Pinia</span><span class="badge">TypeScript</span>
        <span class="badge">Wails / Go</span><span class="badge">Three.js</span>
      </div>
    </div>
  </header>

  <h2 class="sec">概览统计</h2>
  <div class="stats">
    <div class="stat"><div class="n">{total_source}</div><div class="l">项目文件总数（不含 node_modules/dist）</div></div>
    <div class="stat"><div class="n">{code_count}</div><div class="l">代码/配置/文档文件</div></div>
    <div class="stat"><div class="n">{asset_count}</div><div class="l">美术/音频资产（jpg/mp3/png）</div></div>
    <div class="stat"><div class="n">{ts_count}</div><div class="l">TypeScript 文件</div></div>
    <div class="stat"><div class="n">{vue_count}</div><div class="l">Vue 组件</div></div>
    <div class="stat"><div class="n">{doc_count}</div><div class="l">设计文档 / 图</div></div>
    <div class="stat"><div class="n" style="color:var(--cyan)">{last_update.strftime('%Y-%m-%d')}</div><div class="l">最近更新日期</div></div>
    <div class="stat"><div class="n" style="color:var(--cyan)">{first_update.strftime('%Y-%m-%d')}</div><div class="l">最早记录日期</div></div>
  </div>

  <h2 class="sec">当前状态</h2>
  <div class="state">
    <ul>
      <li><b>技术栈</b>：Vue3 + Phaser（2D 战棋/战略）+ Three.js（3D 战略地图）+ Pinia 状态管理 + TypeScript，后端 Wails(Go)，已产出 Windows 可执行 <code>LOGH-Strategy.exe</code>（dev 构建 Aug 24）。</li>
      <li><b>最活跃方向（Aug 24）</b>：经济系统（config/economy.ts、balance.ts 数值平衡）、战略大屏（StrategicScreen.vue）、通讯面板（CommsPanel.vue）、核心 Store（gameStore/adminStore）与格式化工具迭代。</li>
      <li><b>近期完成（Aug 20–23）</b>：提案引擎、舰队/战斗/AI 引擎、3D 战略地图（ThreeStrategicMap.ts）、设置与存档系统落地。</li>
      <li><b>机制完整度</b>：军议/行政院/星球本地化/权限矩阵/人物标签/职位职权/舰队归属/每日结算/战斗/经济/战略地图/通讯/设置存档 共 15 大机制，详见下方「机制体系」。</li>
      <li><b>数据基线</b>：设计文档集中于 2026-07-05（三份 PRD + 系统设计 v1/v3 + 类图/时序图），代码实现持续迭代至 2026-08-24。</li>
    </ul>
  </div>

  <h2 class="sec">更新时间线（按日期倒序）</h2>
  <p style="color:var(--mut);font-size:12.5px;margin-top:-6px;">仅含代码/配置/文档类改动（资产 jpg/mp3 不计入）；无 git，时间线以文件修改时间为准。</p>
  {timeline_html}

  <h2 class="sec">机制体系（15 项）</h2>
  <div class="grid">{mech_html}</div>

  <h2 class="sec">设计文档索引</h2>
  {doc_html}

  <footer>
    本看板由 <code>scripts/build_tracker.py</code> 扫描项目实时生成（无 git，以文件修改时间为更新信号）。<br>
    重新生成：<code>python scripts/build_tracker.py</code> · 已配置每日自动化「银英游戏追踪看板」刷新本页并写入工作区记忆，后续对话可直接回顾最新更新。<br>
    数据基准日：{GEN_TIME}
  </footer>
</div>
</body>
</html>
"""

OUT.write_text(html, encoding="utf-8")
print(f"OK -> {OUT}")
print(f"code_files={code_count} asset_files={asset_count} docs={doc_count} last={last_update.date()}")
