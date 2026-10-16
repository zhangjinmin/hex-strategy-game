/**
 * 切片传送入场（家园2 式 hyperspace entry）—— **纯逻辑层**。
 *
 * 设计见 `docs/design/3d-tactical-battle/35-hyperspace-entry.md`。
 * 本文件**不依赖 three / phaser**（零 import）⇒ 可被两个消费方共用、也可被离线台架
 * `scripts/entryAnimationSim.cjs` 用 `stripTypeScriptTypes` + `new Function` **真跑**：
 *   · 2D 侧（`BattleScene.placeUnitsAtFormationSlots`）只取 `entryDelayForSlot`
 *     （按阵位索引错开的入场相位）；
 *   · 3D 侧（`Battle3DOverlay.updateEntryFx`）取平面推进 / 裁剪挂载 / 辉光包络。
 *
 * ── 为什么把"数学"独立成模块 ──────────────────────────────────────────────
 * 本项目 R1 教训：台架里 `block.includes('...')` 式断言**没有牙齿**（只对"整段删除"敏感，
 * 对取值/语义/行为完全不敏感，5 组变异全绿）。把行为**收敛到本模块的纯函数**后，
 * 台架可以直接执行源码、并用变异（改坏某个常量/分支）自检"断言真的能红"。
 *
 * ── 平面约定（务必与 three 的语义对齐）──────────────────────────────────────
 * three 的 `THREE.Plane(normal, constant)`：`distanceToPoint(p) = normal·p + constant`，
 * **distance < 0 的一侧被裁掉**。本模块取 `normal = (0, -dir, 0)`：
 *   `distance = -dir·y + constant`。
 *   · `dir = +1`：`constant = front` ⇒ 可见域 `y ≤ front`（`front` 从包围盒底 → 顶）
 *   · `dir = -1`：`constant = -front` ⇒ 可见域 `y ≥ front`（法线翻转，故常数取负）
 *   ⇒ 两种情况都可统一描述为"可见域 = **`front` 的一侧**，`front` 逐帧从包围盒一端扫到另一端"。
 * 于是 `t = 0` ⇒ `front` 在包围盒之外（全不可见）；`t = 总时长` ⇒ 全可见。
 * ⚠ `front` 是**世界 Y 坐标**（用于扫描面片定位）；写进 `plane.constant` 前必须过
 *   `entryPlaneConstant(front, dir)`（`dir < 0` 时取负），否则自上而下的扫描会**方向反了**。
 */

// ════════════════════════════════════════════════════════════════════════════
// 可调参数（全部集中此处，便于按真机截图迭代 —— 验收要求）
// ════════════════════════════════════════════════════════════════════════════

/** 切片扫描轴：世界 Y（垂直）—— 核磁共振式垂直切片。 */
export const SLICE_AXIS = 'y';
/** 扫描方向：+1 = 自下而上（舰体从下往上"升起"）；-1 = 自上而下（扫描仪式）。 */
export const SLICE_DIR = 1;
/** 单舰从"完全不可见"到"完全实体"的时长（秒）。 */
export const SLICE_DUR_PER_SHIP = 0.9;
/** 逐舰错开的总跨度（秒）—— 沿阵位排序铺开 ⇒ 波次感（不是所有船同时浮现）。 */
export const SLICE_SPREAD = 1.6;
/** 扫描辉光面片半径系数：半径 = 舰长 × 该值（0.35 ⇒ 辉光盘直径 ≈ 0.7×舰长）。 */
export const SLICE_GLOW_SPAN_K = 0.35;
/** 全场入场时长硬上限（秒）。**必须 ≤ `ASSEMBLE_MAX_MS`(4s)**，且不得改动那个常量。 */
export const SLICE_TOTAL_MAX = 3.5;
/** 舰体包围盒的垂直半跨系数：半跨 = 舰长 × 该值（保证平面扫过整个舰体高度）。 */
export const SLICE_HALF_SPAN_K = 0.75;
/** 入场登记窗口（秒）：只在该窗口内首次见到的单位才登记入场 ⇒ 后续（如迷雾发现、
 *  战后增援）不再触发"切片现身"，避免与既有 LOD/迷雾观感打架。 */
export const ENTRY_REG_WINDOW_SEC = 4.0;
/** 扫描辉光实例池上限（= `Battle3DOverlay.MAX_MESHES`；超出者只切不发光）。 */
export const ENTRY_GLOW_MAX = 900;
/** 一键关闭的**编译期**开关（默认 true）。运行时开关见 `window.__entryFxEnabled = false`。 */
export const SLICE_ENTRY_ENABLED_DEFAULT = true;

// ════════════════════════════════════════════════════════════════════════════
// ★ v2 参数（一队一门「传送门」，用户 2026-10-16 真机反馈后重做；见文档 §7~§12）
//   v1 的失败根因：开场远景无模型（裁剪切的是光点）+ 世界 Y 扫描轴 + 无门形体 + 无暂停窗。
//   v2 八条：N1 聚焦我方主力 / N2 有模型 / N3 入场暂停 / N4 时长 5s /
//            N5 从舰首沿舰队朝向往舰尾扫 / N6 门尺寸 = 投影 max(宽,高)×PAD /
//            N7 5 个裁剪面围成无限长方柱 / N8 可见的门框+位面+扫描亮面。
// ════════════════════════════════════════════════════════════════════════════

/** [v2 · N4] 整队入场总时长（秒）。**刻意 > `ASSEMBLE_MAX_MS`(4s)** ⇒ 入场结束必须重置
 *  `_assemblingSince`，否则解除暂停瞬间舰队直接跳进 `exploring`（见 `ENTRY_NEEDS_ASSEMBLE_RESET`）。
 *  [v4] 5.0 → **6.5**（用户「速度可以慢一点」）—— 门与球**同源**（`doorTotalSec` / `sphereTotalSec`
 *  都必须等于本值，台架断言）。 */
export const ENTRY_TOTAL_SEC = 6.5;
/** [v2 · N6] 门外扩系数：门截面尺寸 = 全队投影 `max(宽, 高)` × 本值（用户原话「比最大值再往外扩一点」）。 */
export const ENTRY_GATE_PAD = 1.25;
/** [v2] 扫描行程余量下限（世界单位）：保证 `p = 0` 时推进面落在**舰首之外**（全不可见）。 */
export const ENTRY_GATE_MIN_MARGIN = 2.0;
/** [v2] 扫描行程余量（= 舰队沿朝向跨度的该比例，与下限取大）。 */
export const ENTRY_GATE_MARGIN_K = 0.08;
/** [v2 · N8] 是否绘制**可见的门本体**（门框 + 位面 + 扫描亮面）。关掉只剩裁剪（≈ v1 的"看不出来"）。 */
export const ENTRY_GATE_VISIBLE = true;
/** [v2 · N1] 开战自动把镜头聚焦到我方主力舰队。 */
export const ENTRY_AUTO_FOCUS = true;
/** [v2 · N3] 入场期间保持游戏暂停。 */
export const ENTRY_HOLD_PAUSE = true;
/** [v2 · N1] 聚焦目标相机高度 = `ENTRY_FOCUS_CAMY_K × initCamY`（须 < LOD 近景档进入线 0.75）⇒ 保证有模型。 */
export const ENTRY_FOCUS_CAMY_K = 0.36;
/** [v2 · N1] 聚焦俯角（弧度）—— 与 `focusOnFleet` 内部一致，用于反解聚焦距离。 */
export const ENTRY_FOCUS_ELEV = 0.55;
/** [v2 · N3] 解除暂停相对 3D 动画的宽限（秒）：3D 在 `entry_start` 之后若干帧才起算，
 *  暂停必须**略长于**动画 ⇒ 结束时舰体已完整（不会"边跑边被切"）。 */
export const ENTRY_RESUME_GRACE_SEC = 0.35;
/** [v2 · N3] 入场时长 > `ASSEMBLE_MAX_MS` ⇒ 入场结束**必须**重置 `_assemblingSince`（红队检查项）。 */
export const ENTRY_NEEDS_ASSEMBLE_RESET = ENTRY_TOTAL_SEC > 4.0;
/** [v2 · N5] 扫描轴 = **舰队朝向**（水平），不是世界 Y。 */
export const ENTRY_GATE_AXIS = 'heading';
/** [v2 · N5] 推进方向：+1 = 舰首 → 舰尾。 */
export const ENTRY_GATE_DIR = 1;

// ════════════════════════════════════════════════════════════════════════════
// ★ v3 · 门**外观**参数（用户 2026-10-16 二次反馈：「边框太丑、要有设计感、精致点」）
//
//   v2 的门观感问题（真机截图实报）：
//     ① 一块**巨大实心不透明青蓝平面**斜插战场，**把舰队整个盖住**；
//     ② 边缘是**硬直边**（粗亮带 + 平面硬边）⇒ 像纸板/塑料片，无能量感；
//     ③ 颜色**死板**（单一青蓝），无"亮心 → 边缘 → 外辉光"的层次。
//
//   v3 目标（参考家园2 hyperspace 门）：亮心（近白细线）→ 边缘（青/蓝紫）→
//   外辉光（低饱和、**柔边**）；门内位面**高度透明**（能透过它看清舰船）；**边缘不得硬直边**。
//
//   ⚠ 本区块**只是常量**（纯数据，零 three 依赖）⇒ 可被离线台架直接执行校验。
//   ⚠ 三方案只换**外观**：几何 / 5 个裁剪平面 / 入场时序**完全共用** ⇒ `GATE_STYLE` 一键切换。
// ════════════════════════════════════════════════════════════════════════════

/** [v3] 门框视觉方案：`A` 能量环门（家园2 式）/ `B` 光栅门 / `C` 量子碎门 /
 *  `S` **六边形球体组装·消散**（用户 2026-10-16 三次反馈后重做，见 `entrySphere.ts`）/
 *  `D` **[v4] 传送门·能量块组装·消散**（科幻化重做，见 `entryDoor.ts`；用户反馈"门的观感更好"⇒ 默认）。 */
export type GateStyleId = 'A' | 'B' | 'C' | 'S' | 'D';
/** [v4] **默认 / 回退**风格 —— `D`（传送门能量块）。
 *  ⚠ 运行时真源是**设置项** `entryFxStyle`：3D 层创建时经 `gateStyleForEntryFx` 映射到内部风格
 *  （`'door'→D` / `'sphere'→S` / `'off'→null` 完全跳过）；本常量只在设置不可得时兜底。
 *  A/B/C 的代码与参数**完整保留**（Q/A 回退），`GATE_STYLE_PARAMS` 覆盖全部 5 套。 */
export const GATE_STYLE: GateStyleId = 'D';

// ── [v4] 开场动画设置项（settingsStore.entryFxStyle）→ 内部风格的**唯一映射** ──
/** 用户可选的开场动画形式（与 `settingsStore.entryFxStyle` 同构；纯数据 ⇒ 台架可真跑）。 */
export type EntryFxStyle = 'door' | 'sphere' | 'off';
/** 设置项默认值（存量存档迁移亦回落此值）。 */
export const ENTRY_FX_STYLE_DEFAULT: EntryFxStyle = 'door';
/**
 * 设置项 → 内部门风格：`'door'→'D'` / `'sphere'→'S'` / `'off'→null`（**完全跳过**入场特效）；
 * 未设置 / 非法值 ⇒ 回退编译期默认 `GATE_STYLE`。**唯一映射点**（防两处各说各话）。
 */
export function gateStyleForEntryFx(fx: EntryFxStyle | string | undefined | null): GateStyleId | null {
  if (fx === 'door') return 'D';
  if (fx === 'sphere') return 'S';
  if (fx === 'off') return null;
  return GATE_STYLE;
}

/** [v3] 单个方案的**全部外观旋钮**（集中此处便于按真机截图迭代）。 */
export interface GateStyleParams {
  /** 门框**边缘**主色（0xRRGGBB）—— 层次里的"边缘"层。 */
  edge: number;
  /** 门框**亮心**细线颜色（近白）—— 层次里的"亮心"层。 */
  core: number;
  /** 外辉光颜色（低饱和青/蓝紫）—— 层次里的"外辉光"层。 */
  halo: number;
  /** 四角**切角**比例（占半边长 0..0.5；0=直角；0.12 ≈ 八角门）。 */
  chamfer: number;
  /** 门框边缘**环带厚度**（局部比例；WebGL 线宽不可调 ⇒ 用面片模拟"稍粗"）。 */
  edgeWidth: number;
  /** 内侧**渐隐 / 羽化**宽度（局部比例；0 = 无 ⇒ 锐利单线观感）。 */
  feather: number;
  /** 位面不透明度（**必须极小** ⇒ 不遮舰队）。 */
  barrierOpacity: number;
  /** 位面纹理**流动速度**（每单位进度 `p` 的 UV 位移）。 */
  flow: number;
  /** 位面纹路**密度**（列/行数）。 */
  density: number;
  /** 门框**呼吸脉冲**幅度 0..1（0 = 不呼吸）。 */
  pulse: number;
  /** 门框是否**碎片化**（C 方案：短线拼接、有间隙 ⇒ 不稳定感）。 */
  shard: boolean;
  // ── 以下为 **[v3.1 · S] 球体方案专属**旋钮（A/B/C 不填 ⇒ undefined，不参与 A/B/C 渲染路径）──
  //   ⚠ 球体的**时序**真源在 `three/entrySphere.ts`（`SPHERE_*_SEC`），此处只放**外观**旋钮；
  //     台架 `entrySphereSim.cjs` 断言 "本处的数值 == entrySphere 的几何常量" ⇒ 防两处漂移。
  /** [S] 球面瓦片数（= `entrySphere.SPHERE_TILE_COUNT`）。 */
  tileCount?: number;
  /** [S] 瓦片**主色**（近侧 = 面向相机的一侧；浅蓝白 ⇒ 参考图里的蓝白瓦片）。 */
  tileColor?: number;
  /** [S] 瓦片**远侧主色**（背向相机的一侧；蓝紫 ⇒ 参考图 1/2 里那些深紫瓦片）。 */
  tileFarColor?: number;
  /** [S] 色散镶边层 **A**（红端）色 —— 复刻参考图 1 左边缘那条红蓝镶边。 */
  dispA?: number;
  /** [S] 色散镶边层 **B**（蓝端）色。 */
  dispB?: number;
  /** [S] 亮白**核心球**颜色（参考图 2 球心那团亮白）。 */
  coreColor?: number;
  /** [S] 外圈**紫色辉光**颜色（参考图 2 外圈紫光）。 */
  glowColor?: number;
  /** [S] 色散层沿瓦片法线的径向偏移（× R）。 */
  dispersion?: number;
  /** [S] 瓦片顶点朝质心收缩比例（留缝 ⇒ 参考图 1 的"有间隙"）。 */
  gapRatio?: number;
  // ── [v4 · D] **传送门能量块**方案专属旋钮（其余方案不填 ⇒ undefined，不参与其渲染路径）──
  //   ⚠ 时序真源在 `three/entryDoor.ts`（`DOOR_*_SEC`），此处只放**外观**旋钮；
  //     台架断言 "本处 blockCount == entryDoor.DOOR_BLOCK_COUNT 且 dispersion == DOOR_DISPERSION_K" ⇒ 防漂移。
  /** [D] 门框能量块数（= `entryDoor.DOOR_BLOCK_COUNT`，60~80）。 */
  blockCount?: number;
  /** [D] 能量块**主色**（亮青白 ⇒ 自发光能量块）。 */
  blockColor?: number;
  /** [D] 位面**扫描光带**颜色（门沿舰队纵轴推进时的明亮前缘）。 */
  scanColor?: number;
}

/** [v3] 三套外观参数（颜色 / 线宽 / 切角 / 位面不透明度 / 纹路 / 脉冲）。 */
export const GATE_STYLE_PARAMS: Record<GateStyleId, GateStyleParams> = {
  // A · 能量环门：双层细线 + 八角切角 + 垂直细纹流动 + 柔边外辉光（最像家园2）。
  A: {
    edge: 0x54b4f0, core: 0xeaf8ff, halo: 0x5fc8ff,
    chamfer: 0.12, edgeWidth: 0.012, feather: 0.0,
    barrierOpacity: 0.07, flow: 3.0, density: 30, pulse: 0.10, shard: false,
  },
  // B · 光栅门：单亮线 + 内侧渐隐（羽化）+ 水平扫描线；最低调、最不抢舰队。
  B: {
    edge: 0x8ecfe8, core: 0xeafcff, halo: 0x9fd8f0,
    chamfer: 0.0, edgeWidth: 0.006, feather: 0.20,
    barrierOpacity: 0.05, flow: 1.6, density: 40, pulse: 0.05, shard: false,
  },
  // C · 量子碎门：短线拼接（有间隙）+ 噪点/星尘；野性量子跃迁观感。
  C: {
    edge: 0x7f9ff0, core: 0xffffff, halo: 0x9a86ff,
    chamfer: 0.18, edgeWidth: 0.008, feather: 0.0,
    barrierOpacity: 0.05, flow: 2.2, density: 46, pulse: 0.16, shard: true,
  },
  // S · **六边形球体**（组装 → 完整 → 消散）：三层质感 = 色散镶边（红/蓝双层）> 亮白核心 > 紫辉光。
  //   参考图 1（组装中：瓦片零散、有间隙、左缘红蓝镶边）/ 图 2（完整态：亮白核心 + 蓝紫边 + 外圈紫辉光）/
  //   图 3（消散中：瓦片飞散）。`edge/core/halo` 沿用"边缘 / 亮心 / 外辉光"的既有语义。
  S: {
    edge: 0x9fd0ff, core: 0xffffff, halo: 0x9b5cff,
    chamfer: 0, edgeWidth: 0, feather: 0,
    barrierOpacity: 0, flow: 0, density: 0, pulse: 0, shard: false,
    tileCount: 120,
    // v3.2 精修：近侧提成**亮青白**（自己发光的能量体）、远侧压深为**蓝紫**（拉开冷暖层次）
    tileColor: 0x93ddff,
    tileFarColor: 0x5a2fd8,
    // 色散镶边：红端**大幅减弱**（参考图里红/青只在轮廓边缘、很微妙），青端略强
    dispA: 0xff5a78,
    dispB: 0x5ad6ff,
    coreColor: 0xffffff,
    glowColor: 0x9b5cff,
    // v3.2：色散偏移由 0.016 收到 0.005（窄丝带 ⇒ 边缘微色散，不成环）；须与入口常量同步
    dispersion: 0.005,
    gapRatio: 0.08,
  },
  // D · **[v4] 传送门·能量块组装**（用户反馈「之前那个门的效果更好，但可以再科幻点」⇒ 把球体已成功的
  //   离散块组装/消散、色散镶边、自发光、外圈辉光**移植到门框**，并让门"活"起来）。
  //   观感三层（同球体优先级）：色散镶边（红/青，沿块法线微偏移）> 亮青白能量块 > 青/紫外辉光。
  //   `blockCount` 与 `entryDoor.DOOR_BLOCK_COUNT` 同源（台架断言防漂移）。
  D: {
    // 门框"边缘 / 亮心 / 外辉光"三层色 —— 亮青白为主，外辉光取紫（与球体一致的冷色层次）
    edge: 0x63c4ff, core: 0xffffff, halo: 0x8f7bff,
    // A/B/C 的旧旋钮 D 不使用（位面走自绘 flowing 纹理；脉冲由 `doorBarrierAmt` 驱动）
    chamfer: 0, edgeWidth: 0, feather: 0,
    barrierOpacity: 0.085, flow: 0, density: 0, pulse: 0, shard: false,
    blockCount: 72,
    blockColor: 0x8fe9ff,
    scanColor: 0xdaf6ff,
    dispA: 0xff5a78,
    dispB: 0x5ad6ff,
    coreColor: 0xffffff,
    glowColor: 0x8f7bff,
    // 与球体一致的微妙色散（窄丝带 ⇒ 轮廓处微色散，不整圈粗红箍）
    dispersion: 0.006,
  },
};

/** [v3] 横截面尺寸下限（世界单位，半值）—— 单舰 / 极扁队形时避免门退化成"一条缝"。 */
export const ENTRY_GATE_MIN_HALF = 0.5;


export interface EntryCfg {
  dir: number;
  durPerShip: number;
  spread: number;
  totalMax: number;
  /** [v2] 整队「一门」的扫掠总时长（秒）—— 见 `ENTRY_TOTAL_SEC`。 */
  total: number;
  /** [v2] 门外扩系数 —— 见 `ENTRY_GATE_PAD`。 */
  pad: number;
}

export const ENTRY_CFG_DEFAULT: EntryCfg = {
  dir: SLICE_DIR,
  durPerShip: SLICE_DUR_PER_SHIP,
  spread: SLICE_SPREAD,
  totalMax: SLICE_TOTAL_MAX,
  total: ENTRY_TOTAL_SEC,
  pad: ENTRY_GATE_PAD,
};

/** 单舰入场状态（3D 侧 `entryStates` 的值）。 */
export interface EntryShip {
  /** 入场事件起点（秒，与 `performance.now()/1000` 同基准）—— 首次见到该单位的时刻。 */
  t0: number;
  /** 该舰的错开延迟（秒，相对 `t0`）。 */
  delay: number;
  /** 是否已完成（完成后调用方必须已清空 `clippingPlanes`）。 */
  done: boolean;
}

/** 单舰某时刻的切片相位（纯函数输出，调用方只负责"写"到材质/平面/辉光上）。 */
export interface EntryStep {
  /** true = 仍需裁剪；false = 已结束，调用方**必须清空 `clippingPlanes`**。 */
  active: boolean;
  /** 扫描先锋的**世界 Y 坐标**（仅 `active = true` 时有意义；写材质需过 `entryPlaneConstant`）。 */
  front: number;
  /** 扫描辉光强度 0..1（两端淡出，中段满亮）。 */
  glow: number;
}

// ════════════════════════════════════════════════════════════════════════════
// 1) 相位 / 时序
// ════════════════════════════════════════════════════════════════════════════

/**
 * 有效逐舰错开跨度：压缩 `spread` 使 `spread + durPerShip ≤ totalMax`。
 * 默认值下 = min(1.6, 3.5 − 0.9 = 2.6) = **1.6**（不压缩）。
 */
export function entrySpreadEffective(spread: number, durPerShip: number, totalMax: number): number {
  const room = Math.max(0, totalMax - durPerShip);
  return Math.max(0, Math.min(spread, room));
}

/** 全场入场总时长（秒）= 有效跨度 + 单舰时长。默认 1.6 + 0.9 = **2.5s**。 */
export function entryTotalSec(spread: number, durPerShip: number, totalMax: number): number {
  return durPerShip + entrySpreadEffective(spread, durPerShip, totalMax);
}

/**
 * 逐舰错开延迟（秒）：按**阵位索引**在 `[0, spread]` 上线性铺开 ⇒
 * 阵位序（前→后 / 左→右）即显现序 ⇒ "从一侧扫向另一侧"的波次感。
 * `count ≤ 1` ⇒ 0（单舰无错开）。
 */
export function entryDelayForSlot(slotIdx: number, count: number, spread: number): number {
  const n = Math.max(1, Math.floor(count));
  if (n <= 1) return 0;
  const s = Math.min(Math.max(Math.floor(slotIdx), 0), n - 1);
  return (s / (n - 1)) * Math.max(0, spread);
}

/** 单舰切片进度 `p ∈ [0, 1]`（0 = 完全不可见，1 = 完全实体）。 */
export function entryShipProgress(now: number, t0: number, delay: number, durPerShip: number): number {
  const dur = Math.max(1e-6, durPerShip);
  const p = (now - (t0 + Math.max(0, delay))) / dur;
  if (!(p > 0)) return 0;      // 含 NaN 兜底
  return p >= 1 ? 1 : p;
}

// ════════════════════════════════════════════════════════════════════════════
// 2) 平面几何
// ════════════════════════════════════════════════════════════════════════════

/** 三维裁剪平面的法线 Y 分量：`dir = +1 ⇒ -1`（此时 `constant = front`，可见域 `y ≤ front`）；
 *  `dir = -1 ⇒ +1`（此时 `constant = -front`，可见域 `y ≥ front`）。 */
export function entryPlaneNormalY(dir: number): number {
  return dir >= 0 ? -1 : 1;
}

/** 扫描先锋的**世界 Y 坐标**（可见域边界）：`p` 由 0→1 时从包围盒底 `yLo` 推到顶 `yHi`
 *  （`dir = +1`，舰体自下而上"升起"）；`dir = -1` 时反向（自上而下）。
 *  ⇒ `p = 0` 时 `front` 在包围盒**之外**（全舰被裁）；`p = 1` 时全舰可见。 */
export function entryPlaneFront(p: number, yLo: number, yHi: number, dir: number): number {
  const t = p <= 0 ? 0 : (p >= 1 ? 1 : p);
  return dir >= 0 ? yLo + (yHi - yLo) * t : yHi + (yLo - yHi) * t;
}

/** `front`（世界 Y 边界）→ `THREE.Plane.constant`：`dir < 0` 时法线翻转 ⇒ 常数取负。
 *  ⚠ 写材质前必须过本函数；扫描面片定位仍用 `front` 本身。 */
export function entryPlaneConstant(front: number, dir: number): number {
  return dir >= 0 ? front : -front;
}

/** 扫描辉光强度：两端 0、中段 1（15% 起落斜坡，避免"啪"地出现/消失）。 */
export function entryGlowAmt(p: number): number {
  if (!(p > 0) || p >= 1) return 0;
  const rise = Math.min(1, p / 0.15);
  const fall = Math.min(1, (1 - p) / 0.15);
  return Math.max(0, Math.min(rise, fall));
}

/** 单舰某一时刻的完整相位（纯函数）—— 3D 侧逐帧调用。 */
export function stepEntrySlice(
  now: number, st: EntryShip, yLo: number, yHi: number, cfg: EntryCfg,
): EntryStep {
  const p = entryShipProgress(now, st.t0, st.delay, cfg.durPerShip);
  if (p >= 1) return { active: false, front: entryPlaneFront(1, yLo, yHi, cfg.dir), glow: 0 };
  return {
    active: true,
    front: entryPlaneFront(p, yLo, yHi, cfg.dir),
    glow: entryGlowAmt(p),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 3) 写入侧（对 three 对象做**结构化**操作 ⇒ 台架可用普通对象直接执行）
// ════════════════════════════════════════════════════════════════════════════

/** 材质侧最小契约（`THREE.Material` 天然满足：其 `clippingPlanes: Plane[] | null` ⊆ `unknown`）。 */
export interface SliceMatLike {
  clippingPlanes: unknown;
}

/** 平面侧最小契约（`THREE.Plane.constant: number` 天然满足）。 */
export interface SlicePlaneLike {
  constant: number;
}

/**
 * 挂载 / 卸载裁剪平面。
 * ⚠ 只在**开始**与**结束**各调用一次（不要逐帧重赋）：three 的裁剪平面**数量**进 program
 *   cache key，数量变化会触发一次重编译；数量不变时逐帧重赋虽然不重编译，但没有必要。
 * `active = false` ⇒ 写 `null`（= 材质默认值，等价于"零裁剪平面"）。
 */
export function entryApplyClipping(mats: SliceMatLike[] | undefined, planes: unknown, active: boolean): void {
  if (!mats) return;
  const v = active ? planes : null;
  for (const m of mats) m.clippingPlanes = v;
}

/** 推进扫描平面的 `constant`（逐帧只改 `constant`，不重赋数组 ⇒ 不触发重编译）。
 *  ⚠ 入参是 `front`（世界 Y 边界），内部经 `entryPlaneConstant` 换算（`dir < 0` 取负）。 */
export function entryWritePlanes(planes: SlicePlaneLike[] | undefined, front: number, dir: number): void {
  if (!planes) return;
  const c = entryPlaneConstant(front, dir);
  for (const p of planes) p.constant = c;
}

/** 平面初始常数：置于舰队包围盒**之外** ⇒ 首帧（未推进前）全舰不可见。 */
export function entryPlaneInitConstant(dir: number): number {
  return entryPlaneConstant(entryPlaneFront(0, -1e6, 1e6, dir), dir);
}

// ════════════════════════════════════════════════════════════════════════════
// ★ v2 · 「传送门」几何（一队一门，5 个裁剪平面围成无限长方柱）
//
// 坐标约定：`fwd / right / up` 为**世界正交基**，`s = p·fwd`（沿朝向）、
// `u = p·right`（横向）、`v = p·up`（竖直）。门的可见域 = 
//     { s ≥ gatePos } ∩ { |u − cu| ≤ halfU } ∩ { |v − cv| ≤ halfV }
// 即"从舰首一侧推进的一个**无限长（矩形截面）方柱**"：推进面沿 `fwd` 从舰首扫到舰尾，
// 4 个侧面把方柱的横截面钉死在门框边界上 ⇒ 观感 = 舰队**从这个门里钻出来**。
// [v3 **改矩形**] 横截面由 v2 的**正方形**（同 half）改为**矩形**（halfU/halfV 各自取自包围盒宽/高）
//   用户反馈：正方形门"竖向空了一大半、显得笨重" ⇒ 矩形紧贴舰队轮廓。
//
// why 5 个面而不是 1 个：v1 只有 1 个无限平面 ⇒ 没有"门"的形体（用户实报"看不出来"）。
// ⚠ 同队所有舰**共享这 5 个 Plane 实例**（一次 `entryGateWritePlanes` 全队生效）。
// ════════════════════════════════════════════════════════════════════════════

/** 只读三维向量（`THREE.Vector3` 天然满足）。 */
export interface Vec3Like { x: number; y: number; z: number; }

/** `THREE.Plane` 的**结构**契约（台架可用普通对象真跑；three 的 Plane 天然满足）。 */
export interface GatePlaneLike {
  normal: { set(x: number, y: number, z: number): void };
  constant: number;
}

/** 舰队在「垂直于朝向」平面上的投影包围盒 + 沿朝向的行程（全部为**世界坐标**的投影标量）。 */
export interface EntryGateBox {
  /** 横向投影范围 `p·right` */
  uLo: number; uHi: number;
  /** 竖直投影范围 `p·up` */
  vLo: number; vHi: number;
  /** 沿朝向范围 `p·fwd`（已含各舰半长 ⇒ 覆盖舰首/舰尾） */
  sLo: number; sHi: number;
}

/** 空包围盒（累加起点）。 */
export function entryGateEmptyBox(): EntryGateBox {
  return { uLo: Infinity, uHi: -Infinity, vLo: Infinity, vHi: -Infinity, sLo: Infinity, sHi: -Infinity };
}

/**
 * 把一艘舰的**包围盒**累加进门包围盒。
 * @param box  累加目标（原地修改并返回）
 * @param s    舰心沿朝向的坐标（`p·fwd`）；舰首 = `s + halfLen`
 * @param u    舰心横向坐标（`p·right`）
 * @param v    舰心竖直坐标（`p·up`）
 * @param halfLen/halfW/halfH 舰体半长 / 半宽 / 半高（**必须给半值**，否则门会少一截）
 */
export function entryGateAccumulate(
  box: EntryGateBox, s: number, u: number, v: number,
  halfLen: number, halfW: number, halfH: number,
): EntryGateBox {
  const hl = Math.max(0, halfLen), hw = Math.max(0, halfW), hh = Math.max(0, halfH);
  if (s - hl < box.sLo) box.sLo = s - hl;
  if (s + hl > box.sHi) box.sHi = s + hl;
  if (u - hw < box.uLo) box.uLo = u - hw;
  if (u + hw > box.uHi) box.uHi = u + hw;
  if (v - hh < box.vLo) box.vLo = v - hh;
  if (v + hh > box.vHi) box.vHi = v + hh;
  return box;
}

/** 包围盒是否有效（至少有一艘舰被累加过，且沿朝向跨度非负）。 */
export function entryGateValid(box: EntryGateBox): boolean {
  return Number.isFinite(box.sLo) && Number.isFinite(box.sHi)
    && Number.isFinite(box.uLo) && Number.isFinite(box.vLo)
    && box.sHi >= box.sLo && box.uHi >= box.uLo && box.vHi >= box.vLo;
}

/**
 * [v2 · N6 → v3 **改矩形**] 门截面**横向跨度**（世界单位）= 投影宽 × `pad`。
 *
 * v2 原实现取 `max(宽, 高)×pad` ⇒ 门是**正方形**；用户 2026-10-16 二次反馈「竖向空了一大半、
 * 显得笨重」⇒ 改为**宽、高各自取各自跨度 × pad**（见 `entryGateSizeV`），使门**紧贴舰队轮廓**。
 * 两支配套使用：`halfU = entryGateSizeU/2`、`halfV = entryGateSizeV/2`。
 */
export function entryGateSizeU(box: EntryGateBox, pad: number): number {
  const w = Math.max(0, box.uHi - box.uLo);
  return w * Math.max(0, pad);
}

/** [v3 **改矩形**] 门截面**竖向跨度**（世界单位）= 投影高 × `pad`（与 `entryGateSizeU` 配对）。 */
export function entryGateSizeV(box: EntryGateBox, pad: number): number {
  const h = Math.max(0, box.vHi - box.vLo);
  return h * Math.max(0, pad);
}

/** 门截面横向中心 = 投影包围盒中心（`p·right`）。 */
export function entryGateCenterU(box: EntryGateBox): number { return (box.uLo + box.uHi) / 2; }
/** 门截面竖直中心 = 投影包围盒中心（`p·up`）。 */
export function entryGateCenterV(box: EntryGateBox): number { return (box.vLo + box.vHi) / 2; }

/** 扫描行程余量：保证 `p = 0` 时推进面在**舰首之外**（全不可见）。 */
export function entryGateMargin(box: EntryGateBox): number {
  const span = Math.max(0, box.sHi - box.sLo);
  return Math.max(ENTRY_GATE_MIN_MARGIN, span * ENTRY_GATE_MARGIN_K);
}

/**
 * [v2 · N5] 门推进面的**沿朝向坐标**：`p = 0` ⇒ `sHi + margin`（舰首之外 ⇒ 全隐）；
 * `p = 1` ⇒ `sLo − margin`（舰尾之外 ⇒ 全显）；随 `p` **单调递减** ⇒ 从舰首扫向舰尾。
 */
export function entryGateFront(p: number, sLo: number, sHi: number, margin: number): number {
  const t = p <= 0 ? 0 : (p >= 1 ? 1 : p);
  const lo = sLo - margin, hi = sHi + margin;
  return hi + (lo - hi) * t;
}

/**
 * [v2 · N7 → v3 矩形截面] 写出门的 **5 个裁剪平面**（法线 + 常数）—— 同队共享同一组实例 ⇒ 一次调用全队生效。
 * three 语义：`distance(p) = normal·p + constant`，**`distance ≥ 0` 可见**。
 *   `planes[0]` 推进面：法线 = `fwd`，`constant = −gatePos` ⇒ 可见域 `s ≥ gatePos`
 *   `planes[1..2]` 左右侧面：法线 = `∓right` ⇒ 可见域 `|u − cu| ≤ halfU`
 *   `planes[3..4]` 上下侧面：法线 = `∓up`   ⇒ 可见域 `|v − cv| ≤ halfV`
 * ⚠ `halfU` / `halfV` **分别**给（横向/竖向各自来自包围盒宽/高）⇒ 截面是**矩形**而非正方形。
 * ⚠ 逐帧**只改 `constant`/`normal`**（数量恒为 5）⇒ 不触发 program 重编译。
 */
export function entryGateWritePlanes(
  planes: GatePlaneLike[] | undefined,
  fwd: Vec3Like, right: Vec3Like, up: Vec3Like,
  cu: number, cv: number, halfU: number, halfV: number, gatePos: number,
): void {
  if (!planes || planes.length < 5) return;
  planes[0].normal.set(fwd.x, fwd.y, fwd.z);
  planes[0].constant = -gatePos;
  planes[1].normal.set(-right.x, -right.y, -right.z);
  planes[1].constant = cu + halfU;
  planes[2].normal.set(right.x, right.y, right.z);
  planes[2].constant = halfU - cu;
  planes[3].normal.set(-up.x, -up.y, -up.z);
  planes[3].constant = cv + halfV;
  planes[4].normal.set(up.x, up.y, up.z);
  planes[4].constant = halfV - cv;
}
