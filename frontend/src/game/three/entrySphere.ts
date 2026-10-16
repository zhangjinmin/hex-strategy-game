/**
 * [六边形球体组装 / 消散入场 · v3 `GATE_STYLE = 'S'`] —— **球面几何 + 运动学纯逻辑层**。
 *
 * 用户需求（2026-10-16 原话）：
 * 「这个还是差点……我看到一个动画……这个是个圆球，用**六边形拼接**的，就是**从零开始随机组装拼接，
 *   组成一个圆球**，然后再**随机消散**，……就是**一个圆包裹，显示组成，然后消散，舰队就在里面出现**，
 *   然后再加点科幻的特效之类的」。
 *
 * ── 本文件做什么 ───────────────────────────────────────────────────────────
 *   ① **球面 Voronoi 剖分**（自研，不引第三方库）：Fibonacci 球均匀撒 N 个种子 ⇒ 每个种子在
 *      其切平面上取 k 近邻、逐条半平面裁剪出 2D Voronoi 单元 ⇒ 顶点投影回球面；
 *      ⇒ 得到 N 块「球面多边形瓦片」（多为六边形、少数五边形）。
 *   ② 瓦片**顶点朝质心收缩** `gapRatio` ⇒ 瓦片之间留缝（参考图 1 的"零散、有间隙"）。
 *   ③ 每块瓦片的**三角扇**（以质心为扇心）= 可直接喂 `THREE.BufferGeometry` 的索引。
 *   ④ **组装 / 完整 / 消散**三阶段的逐瓦片运动学（径向位移 + 翻滚 + 透明度），以及与
 *      球心/辉光/核心的包络 —— 全部是**纯函数**。
 *   ⑤ 舰队**包围球拟合**（球体尺寸真源）与**对象树资源释放**（结束必须 dispose，防泄漏）。
 *
 * ── 为什么要独立成模块（沿用本项目 R1 教训）────────────────────────────────
 * 台架里 `block.includes('...')` 式断言**没有牙齿**（历史上 5 组变异全绿）。把"数学/时序"
 * 收敛到本模块的纯函数后，`scripts/entrySphereSim.cjs` 可以**直接 require 本文件真跑**，
 * 并用"改坏源码再跑 ⇒ 断言必须红"来自检断言有牙齿。
 *
 * ⚠ 本文件**零 import**（不依赖 three / phaser；不 import 任何模块）⇒ 与 `entrySlice.ts` 同构，
 *   可被离线台架直接执行、也可被 vue-tsc 静态检查。
 * ⚠ 所有随机量都用**固定 seed 的伪随机**（`mulberry32`）⇒ **确定性**：同 seed 两次生成逐位一致
 *   （台架断言项）。几何**只在入场开始时生成一次**，动画期间只改 `position/rotation/opacity`。
 */

// ════════════════════════════════════════════════════════════════════════════
// 0) 可调参数（全部集中此处，便于按真机截图迭代）
// ════════════════════════════════════════════════════════════════════════════

/** 球面瓦片数量（用户给的参考图观感量级；120~180 之间）。⚠ 性能不足时**先减瓦片数**，
 *  不要减色散/辉光（科幻感来源优先级：色散镶边 > 发光层次 > 瓦片形状）。
 *  ⚠ 每块瓦片 = **3 层独立 Mesh**（主色 + 色散红/蓝）⇒ 单球 draw call ≈ 3 × 本值。 */
export const SPHERE_TILE_COUNT = 120;
/**
 * 同时**可见球体**的舰队数上限（按"离相机最近"取前 N 支 —— 即 `fleetPx` 最大的 N 支）。
 *
 * 为什么需要上限：每球 ≈ `3 × 瓦片数` 个 Mesh ⇒ 若所有可见舰队各建一球，draw call 会失控。
 * 上限之外**不建门**（`ensureFleetGate` 返回 undefined）⇒ 那些舰队不参与入场特效（照常显示）。
 * 相机已被 `focusOnPlayerMainFleetForEntry()` 聚到**我方主力舰队** ⇒ 最近的那支必然入选。
 */
export const SPHERE_MAX_INSTANCES = 1;
/** 每块瓦片参与裁剪的近邻数（Voronoi 单元只需最近的 ~6 个，取 12 留足余量防"未闭合单元"）。 */
export const SPHERE_NEIGHBOR_K = 12;
/** 瓦片顶点朝质心收缩比例（0.08 ⇒ 瓦片间留 8% 缝隙；0 ⇒ 严丝合缝）。 */
export const SPHERE_GAP_RATIO = 0.08;
/** 几何随机种子（确定性：改此值 ⇒ 整套瓦片布局变化，但同值两次生成逐位一致）。 */
export const SPHERE_SEED = 0x5eed51a1;
/** 切平面上初始裁剪方块的半边长（单位球切平面坐标，弧度量级）。瓦片典型半径 ≈ 0.31 rad。 */
export const SPHERE_TANGENT_SPAN = 0.80;

/** 组装阶段时长（秒，0 → 2.6）—— 瓦片从球外飞入并拼合。
 *  [v4] 1.8 → **2.6**（用户「速度可以慢一点」）；须与门同源（`sphereTotalSec === ENTRY_TOTAL_SEC === 6.5`）。 */
export const SPHERE_ASSEMBLE_SEC = 2.6;
/** 完整阶段时长（秒，2.6 → 4.2）—— 球体完整发光，**舰队在此窗口内显现**。[v4] 1.2 → 1.6。 */
export const SPHERE_HOLD_SEC = 1.6;
/** 消散阶段时长（秒，4.2 → 6.2）—— 瓦片沿径向飞散 + 翻滚 + 淡出。[v4] 1.5 → 2.0。 */
export const SPHERE_DISPERSE_SEC = 2.0;
/** 余晖阶段时长（秒，6.2 → 6.5）—— 亮心/紫辉光残余淡出。
 *  ⚠ [v4] 0.5 → **0.3**：组装/完整/消散（2.6+1.6+2.0=6.2）已定，余晖取 0.3 ⇒ 总时长恰 **6.5**（= 门）。 */
export const SPHERE_AFTERGLOW_SEC = 0.3;
/** 组装逐瓦片**随机延迟**跨度（秒）—— 复刻"随机拼起来"（不是齐刷刷一起到位）。 */
export const SPHERE_TILE_STAGGER = 0.6;
/** 消散逐瓦片**随机延迟**跨度（秒）—— 复刻"随机飞散"。 */
export const SPHERE_DISP_STAGGER = 0.5;
/** 组装起点径向因子下限（× R）—— `1.5 ⇒ |pos| = 1.5R`（在球外）。 */
export const SPHERE_START_R_MIN = 1.5;
/** 组装起点径向因子上限（× R）。 */
export const SPHERE_START_R_MAX = 3.0;
/** 消散终点径向因子下限（× R）。 */
export const SPHERE_DISP_R_MIN = 1.8;
/** 消散终点径向因子上限（× R）。 */
export const SPHERE_DISP_R_MAX = 3.2;
/** 舰队包围球外扩系数（球半径 = 最大包络 × 该值 ⇒ 舰队确实"在里面"）。 */
export const SPHERE_RADIUS_PAD = 1.12;
/** 球半径下限（× hexR）—— 单舰 / 极扁队形时避免球退化成"一个点"。 */
export const SPHERE_RADIUS_MIN_K = 3.0;

/** 色散镶边的径向偏移量（× R）—— 红/蓝两层沿瓦片法线微偏移 ⇒ 边缘出现红蓝镶边（参考图 1 左侧）。
 *  ⚠ 实测：偏移过大（0.03）会在球体轮廓处拉出红/蓝"尖刺"、且球体整体过曝 ⇒ 收到 0.016。
 *  ⚠ v3.2 精修：参考图的红/青镶边**很微妙、只在轮廓边缘、断续非成环** ⇒ 进一步收到 0.005
 *     （偏移越小 ⇒ 分离丝带越窄 ⇒ 读作"边缘微色散"而不是"一整圈明显红边"）。 */
export const SPHERE_DISPERSION_K = 0.005;
/** 亮白核心球半径系数（× R）—— 完整期球心那团亮白（参考图 2）。
 *  ⚠ v3.2：接近全球覆盖（0.92）—— 它同时充当**柔光填充**（把瓦片之间的缝隙照亮 ⇒ 球体读作"发光实心球"
 *     而非"深色蜂窝框"）；但梯度做成"白核 → 青 → 蓝紫"（不是纯白）⇒ 不压平外圈的冷色层次。 */
export const SPHERE_CORE_R_K = 0.92;
/** 外圈紫色辉光**亮环**半径系数（× R）—— 参考图 2 外圈那圈紫光。 */
export const SPHERE_GLOW_R_K = 1.15;
/** 外圈辉光**贴图面片**的半边长系数（× R）—— 必须 > `SPHERE_GLOW_R_K`
 *  （亮环在面片内部、外侧留出柔边）⇒ 否则亮环正好压在球体轮廓上，看不出"外圈辉光"。 */
export const SPHERE_GLOW_HALF_K = 1.45;

// ── v3.2「瓦片质感」精修旋钮（发光能量体 / 冷暖层次 / 径向亮核 / 弱色散 / 消散保亮）──
//   参考图观感主体 = "像一颗发光的能量球"（而不是"有很多六边形"）⇒ 这里全部服务于**发光感**。
//   ⚠ 本工程无 bloom 后处理（只有自定义 CRT post）⇒ 用**加法混合 + 逐顶点亮度衰减 + 径向正对增益**
//     在瓦片自身做出"自发光 / 内部亮度 / 中心过曝"。

/** 单块瓦片内的**边缘压暗**系数（顶点色：质心 = 1.0，周长顶点 = 本值）。
 *  ⇒ 每块瓦片"自己从中心发光"（内部亮度衰减），而不是一块被均匀照亮的平板/瓷片。
 *  ⚠ 实测：过小（0.34）⇒ 相邻瓦片边缘叠加后出现**明显暗缝**（读作"深色蜂窝框"，不是发光球）⇒ 取 0.72（很轻）。 */
export const SPHERE_TILE_EDGE_DIM = 0.92;

/** 瓦片亮度增益的**轮廓下限**（"正对相机程度" = 0 时的增益）。
 *  ⚠ 实测：< 1（压暗轮廓瓦片）会让"包住轮廓的那圈瓦片"变暗 ⇒ 它们之间的**缝隙露出暗背景**
 *     ⇒ 整球读作"深色蜂窝框"（不是发光球）⇒ 必须** ≥ 1**（瓦片近等亮）；径向亮核改由核心柔光承担。 */
export const SPHERE_TILE_FACE_FLOOR = 1.0;
/** 瓦片亮度增益的**正对增量**：增益 = `FLOOR + LIFT × 正对程度`（正对相机 = 投在球心 ⇒ 略亮一点）。 */
export const SPHERE_TILE_FACE_LIFT = 0.15;

/** 正对相机的瓦片再向**纯白**提亮的比例（复刻参考图 2 球心"过曝亮白"）。0..1。 */
export const SPHERE_TILE_CORE_WHITEN = 0.35;

/** 色散（红/青）镶边的**轮廓权重下限**：色散层不透明度按"轮廓程度"加权 ⇒ 只在轮廓边缘明显、
 *  球心几乎不出现（局部边缘而非整圈均匀红边）。 */
export const SPHERE_DISP_SIL_FLOOR = 0.15;

/** 亮白核心球的基础不透明度（× `sphereCoreAmt` 包络）—— 充满球体的柔光"亮核"（发光感主体）。 */
export const SPHERE_CORE_OPACITY = 0.90;
/** 外圈紫色辉光的基础不透明度（× `sphereGlowAmt` 包络）—— 紧贴球体轮廓的紫光。 */
export const SPHERE_GLOW_OPACITY = 0.85;

/** 消散期**亮度保持**起始比例：瓦片透明度在前 `SPHERE_DISP_FADE_START` 段**保持 1**（仍明亮），
 *  其后才快速收掉 ⇒ "消散靠数量减少 + 飞散来表现，不是靠瓦片变暗"（参考图 3 消散期瓦片仍白/浅蓝）。0..1。 */
export const SPHERE_DISP_FADE_START = 0.55;

/** 舰队显现：吸收段（秒）—— 开战瞬间舰队被"吸进"球里（1 → 0）。 */
export const SPHERE_ABSORB_SEC = 0.35;
/** 舰队显现：显现起始时刻（秒，相对入场起点）—— 略早于组装结束，让"拼合"与"显现"衔接。
 *  [v4] 1.40 → **1.90**：组装延到 2.6s 后，显现起点仍须 ≥ `assembleSec × 0.6`（台架断言）且
 *  满足「最晚一舰在消散开始(4.2s)前完全显现」（`revealStart + spread + revealDur ≤ dispStart`）。 */
export const SPHERE_REVEAL_START = 1.90;
/** 舰队显现：单舰从 0 → 1 的时长（秒）。 */
export const SPHERE_REVEAL_DUR = 0.75;
/** 舰队显现：逐舰随机/径向错开跨度（秒）⇒ 不是所有舰同时浮现。 */
export const SPHERE_REVEAL_SPREAD = 0.55;

// ════════════════════════════════════════════════════════════════════════════
// 1) 工具：确定性伪随机 / 缓动 / 向量
// ════════════════════════════════════════════════════════════════════════════

/** mulberry32 —— 确定性 32 位 PRNG（同 seed ⇒ 同序列 ⇒ 台架可断言"确定性"）。 */
export function mulberry32(seed: number): () => number {
  let a = (seed >>> 0) | 0;
  return function rand(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 归一化钳位到 [0,1]（含 NaN 兜底 ⇒ NaN → 0）。 */
export function clamp01(v: number): number {
  if (!(v > 0)) return 0;
  return v >= 1 ? 1 : v;
}

/** 平滑阶跃 `3t²−2t³`（端点导数为 0 ⇒ 起落不"啪"）。 */
export function smooth01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** 在 `[lo, hi]` 上取确定性伪随机。 */
export function randRange(rand: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}

/** 单位球上**均匀分布**的 Fibonacci 球点（`count` 个，stride 3）。`radius` 默认单位球。 */
export function sphereSeedPoints(count: number, radius = 1): Float64Array {
  const n = Math.max(1, Math.floor(count));
  const r = Math.max(1e-9, radius);
  const out = new Float64Array(n * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));   // 黄金角
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) * 2) / n;       // 均匀分层 ⇒ 球面均匀
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i;
    out[i * 3] = Math.cos(th) * rr * r;
    out[i * 3 + 1] = y * r;
    out[i * 3 + 2] = Math.sin(th) * rr * r;
  }
  return out;
}

/**
 * 球面多边形的**面积**（单位球，顶点为**单位向量**，stride 3）。
 *
 * 用 Gauss–Bonnet：凸球面多边形 `面积 = 2π − Σ(外角)`。外角在顶点切平面上量取
 * （把进出边向量投影到该点切平面，再取有符号夹角）⇒ 小多边形时 `Σ外角 → 2π`、面积 → 0。
 * 返回**绝对值**（对朝向不敏感），并钳到 `[0, 4π]`。
 */
export function sphericalPolygonArea(verts: Float64Array): number {
  const n = Math.floor(verts.length / 3);
  if (n < 3) return 0;
  let turn = 0;
  for (let i = 0; i < n; i++) {
    const i0 = ((i - 1 + n) % n) * 3, i1 = i * 3, i2 = ((i + 1) % n) * 3;
    const ax = verts[i1], ay = verts[i1 + 1], az = verts[i1 + 2];
    // 进边 / 出边（弦向量）
    const d1x = ax - verts[i0], d1y = ay - verts[i0 + 1], d1z = az - verts[i0 + 2];
    const d2x = verts[i2] - ax, d2y = verts[i2 + 1] - ay, d2z = verts[i2 + 2] - az;
    // 投影到顶点切平面（去掉法向 = 顶点方向的分量）
    const p1 = d1x * ax + d1y * ay + d1z * az;
    const p2 = d2x * ax + d2y * ay + d2z * az;
    const t1x = d1x - p1 * ax, t1y = d1y - p1 * ay, t1z = d1z - p1 * az;
    const t2x = d2x - p2 * ax, t2y = d2y - p2 * ay, t2z = d2z - p2 * az;
    const l1 = Math.hypot(t1x, t1y, t1z);
    const l2 = Math.hypot(t2x, t2y, t2z);
    if (l1 < 1e-12 || l2 < 1e-12) continue;      // 退化边 ⇒ 跳过（不让 NaN 污染面积）
    const u1x = t1x / l1, u1y = t1y / l1, u1z = t1z / l1;
    const u2x = t2x / l2, u2y = t2y / l2, u2z = t2z / l2;
    // 有符号转角：以顶点法向为轴
    const cx = u1y * u2z - u1z * u2y;
    const cy = u1z * u2x - u1x * u2z;
    const cz = u1x * u2y - u1y * u2x;
    const sinT = cx * ax + cy * ay + cz * az;
    const cosT = u1x * u2x + u1y * u2y + u1z * u2z;
    turn += Math.atan2(sinT, cosT);
  }
  const area = 2 * Math.PI - Math.abs(turn);     // 外角和 = Σ|外角|（凸多边形同号）
  return Math.max(0, Math.min(4 * Math.PI, area));
}

// ════════════════════════════════════════════════════════════════════════════
// 2) 球面 Voronoi 剖分
// ════════════════════════════════════════════════════════════════════════════

/** 一块球面瓦片（几何 + 动画随机量，全部相对**球心**；球心由调用方平移）。 */
export interface SphereTile {
  /** 瓦片序号（= 种子下标）。 */
  index: number;
  /** 质心单位方向（球心为原点）。 */
  dir: Float64Array;
  /** 质心相对球心坐标（= `dir × R`）。 */
  center: Float64Array;
  /** 瓦片周长顶点相对球心坐标（stride 3；**每个都在球面上**，`|v| ≈ R`）。 */
  verts: Float64Array;
  /** 三角扇索引（顶点 0 = 质心，1..nv = 周长顶点）—— 可直接喂 `BufferGeometry.index`。 */
  fan: Uint32Array;
  /** 周长顶点数（六边形 = 6）。 */
  nv: number;
  /** 组装起点径向因子（> 1 ⇒ 在球外）。 */
  startK: number;
  /** 消散终点径向因子（> 1 ⇒ 飞散到球外）。 */
  dispK: number;
  /** 组装随机延迟（秒，∈ [0, stagger]）。 */
  delay: number;
  /** 消散随机延迟（秒，∈ [0, dispStagger]）。 */
  dispDelay: number;
  /** 组装起步的翻滚角（弧度）。 */
  spinA: number;
  /** 消散终点额外翻滚角（弧度）。 */
  spinB: number;
  /** 翻滚轴（单位向量）。 */
  axis: Float64Array;
  /** 色散镶边的红/蓝两层偏移方向 = `dir`（沿球面法线）。 */
  dispersion: Float64Array;
}

/** 一次剖分的完整结果。 */
export interface SphereTileSet {
  tiles: SphereTile[];
  /** 球半径（世界单位）—— 与 `radius` 参数同值，便于调用方一处取用。 */
  radius: number;
  /** 种子点（单位球，stride 3；诊断用）。 */
  seedPoints: Float64Array;
  /** 覆盖率 = Σ瓦片球面面积 / 4π（< 1 ⇒ 有缝隙；`gapRatio=0` 时 ≈ 1）。 */
  coverage: number;
}

export interface SphereBuildOpts {
  /** 球半径（世界单位）。 */
  radius: number;
  /** 瓦片数（默认 `SPHERE_TILE_COUNT`）。 */
  count?: number;
  /** 随机种子（默认 `SPHERE_SEED`）—— 决定瓦片布局与全部动画随机量。 */
  seed?: number;
  /** 顶点朝质心收缩比例（默认 `SPHERE_GAP_RATIO`）。 */
  gapRatio?: number;
  /** 近邻数（默认 `SPHERE_NEIGHBOR_K`）。 */
  neighborK?: number;
}

/** 取某点切平面的一组正交基 `(u, v, w=p)`（右手：`u × v = p`）。 */
function tangentBasis(px: number, py: number, pz: number): [number, number, number, number, number, number] {
  // 选一个与 p 不平行的辅助轴（避免 |p·a| ≈ 1 时退化）
  const ax = Math.abs(px) < 0.9 ? 1 : 0;
  const ay = Math.abs(px) < 0.9 ? 0 : 1;
  const az = 0;
  const d = ax * px + ay * py + az * pz;
  let ux = ax - d * px, uy = ay - d * py, uz = az - d * pz;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  // v = p × u
  const vx = py * uz - pz * uy;
  const vy = pz * ux - px * uz;
  const vz = px * uy - py * ux;
  return [ux, uy, uz, vx, vy, vz];
}

/** Sutherland–Hodgman 半平面裁剪：保留满足 `na·a + nb·b ≤ d` 的一侧。 */
function clipHalf(poly: number[][], na: number, nb: number, d: number): number[][] {
  const out: number[][] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const A = poly[i];
    const B = poly[(i + 1) % n];
    const fa = na * A[0] + nb * A[1] - d;
    const fb = na * B[0] + nb * B[1] - d;
    if (fa <= 0) out.push(A);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }
  return out;
}

/** 去掉相邻的重复顶点（裁剪会产生重合点 ⇒ 不清会拖出退化三角形）。 */
function dedupePoly(poly: number[][], eps: number): number[][] {
  const out: number[][] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < eps && Math.abs(last[1] - p[1]) < eps) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps) out.pop();
    else break;
  }
  return out;
}

/**
 * 单个种子的球面 Voronoi 单元（单位球顶点，stride 3，stride 长度 = 3·顶点数）。
 *
 * 算法：把 `p` 的全部近邻 `q` 的条件 `X·p ≥ X·q`（X 在 p 的切平面上）化为半平面
 * `a·(u·q) + b·(v·q) ≤ 1 − p·q`，逐个裁剪初始方块 ⇒ 2D Voronoi 单元；再朝质心收缩
 * `gapRatio` 后**投影回单位球面**（归一化）⇒ 每个顶点都在球面上。
 *
 * @returns null = 单元退化（顶点 < 3）⇒ 该瓦片跳过
 */
function cellVertsUnit(
  pts: Float64Array, count: number, i: number, k: number, gapRatio: number,
): Float64Array | null {
  const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
  // ── k 近邻（按球面距离 = 点积降序；球面上点积越大越近）──
  const nb: number[] = [];
  const nbd: number[] = [];
  for (let j = 0; j < count; j++) {
    if (j === i) continue;
    const d = px * pts[j * 3] + py * pts[j * 3 + 1] + pz * pts[j * 3 + 2];
    // 插入排序（k 很小，省一次 sort 分配）
    let ins = nb.length;
    while (ins > 0 && nbd[ins - 1] < d) ins--;
    nb.splice(ins, 0, j);
    nbd.splice(ins, 0, d);
    if (nb.length > k) { nb.pop(); nbd.pop(); }
  }
  const [ux, uy, uz, vx, vy, vz] = tangentBasis(px, py, pz);
  const S = SPHERE_TANGENT_SPAN;
  let poly: number[][] = [[-S, -S], [S, -S], [S, S], [-S, S]];
  for (const j of nb) {
    const qx = pts[j * 3], qy = pts[j * 3 + 1], qz = pts[j * 3 + 2];
    const dot = px * qx + py * qy + pz * qz;
    const na = ux * qx + uy * qy + uz * qz;   // u·q
    const nbb = vx * qx + vy * qy + vz * qz;  // v·q
    poly = clipHalf(poly, na, nbb, 1 - dot);
    if (poly.length < 3) return null;         // 被裁空 ⇒ 退化
  }
  poly = dedupePoly(poly, 1e-6);
  if (poly.length < 3) return null;
  // ── 朝质心收缩（留缝）后投影回单位球 ──
  let ca = 0, cb = 0;
  for (const p of poly) { ca += p[0]; cb += p[1]; }
  ca /= poly.length; cb /= poly.length;
  const s = 1 - Math.min(0.6, Math.max(0, gapRatio));
  const out = new Float64Array(poly.length * 3);
  for (let t = 0; t < poly.length; t++) {
    const a = ca + (poly[t][0] - ca) * s;
    const b = cb + (poly[t][1] - cb) * s;
    let X = px + a * ux + b * vx;
    let Y = py + a * uy + b * vy;
    let Z = pz + a * uz + b * vz;
    const L = Math.hypot(X, Y, Z) || 1;
    X /= L; Y /= L; Z /= L;
    out[t * 3] = X; out[t * 3 + 1] = Y; out[t * 3 + 2] = Z;
  }
  return out;
}

/**
 * **球面 Voronoi 剖分**：生成 `count` 块瓦片（多为六边形、少数五边形）。
 *
 * 确定性：同 `(radius, count, seed, gapRatio, neighborK)` ⇒ 结果**逐位一致**。
 * 每个瓦片携带全部动画随机量（`startK/dispK/delay/dispDelay/spinA/spinB/axis`）。
 */
export function buildSphereTiles(opts: SphereBuildOpts): SphereTileSet {
  const count = Math.max(4, Math.floor(opts.count ?? SPHERE_TILE_COUNT));
  const radius = Math.max(1e-6, opts.radius);
  const seed = (opts.seed ?? SPHERE_SEED) >>> 0;
  const gapRatio = Math.max(0, opts.gapRatio ?? SPHERE_GAP_RATIO);
  const k = Math.max(3, Math.floor(opts.neighborK ?? SPHERE_NEIGHBOR_K));
  const rand = mulberry32(seed);
  const pts = sphereSeedPoints(count, 1);   // 单位球
  const tiles: SphereTile[] = [];
  let areaSum = 0;
  for (let i = 0; i < count; i++) {
    const unit = cellVertsUnit(pts, count, i, k, gapRatio);
    if (!unit) continue;
    const nv = Math.floor(unit.length / 3);
    if (nv < 3) continue;
    // 质心（投影回球面）
    let mx = 0, my = 0, mz = 0;
    for (let t = 0; t < nv; t++) { mx += unit[t * 3]; my += unit[t * 3 + 1]; mz += unit[t * 3 + 2]; }
    const ml = Math.hypot(mx, my, mz) || 1;
    const dir = new Float64Array([mx / ml, my / ml, mz / ml]);
    // 世界（相对球心）坐标：球面顶点 × R
    const verts = new Float64Array(nv * 3);
    for (let t = 0; t < nv * 3; t++) verts[t] = unit[t] * radius;
    // 三角扇：顶点 0 = 质心，1..nv = 周长顶点
    const fan = new Uint32Array(nv * 3);
    for (let t = 0; t < nv; t++) {
      fan[t * 3] = 0;
      fan[t * 3 + 1] = t + 1;
      fan[t * 3 + 2] = ((t + 1) % nv) + 1;
    }
    areaSum += sphericalPolygonArea(unit);
    // 动画随机量（确定性；顺序固定 ⇒ 同 seed 同序列）
    const startK = randRange(rand, SPHERE_START_R_MIN, SPHERE_START_R_MAX);
    const dispK = randRange(rand, SPHERE_DISP_R_MIN, SPHERE_DISP_R_MAX);
    const delay = rand() * SPHERE_TILE_STAGGER;
    const dispDelay = rand() * SPHERE_DISP_STAGGER;
    const spinA = randRange(rand, -Math.PI, Math.PI);
    const spinB = randRange(rand, -Math.PI, Math.PI);
    const axis = new Float64Array([0, 0, 0]);
    {
      // 球面均匀随机轴（避免极点聚集）
      const z = randRange(rand, -1, 1);
      const phi = randRange(rand, 0, Math.PI * 2);
      const rr = Math.sqrt(Math.max(0, 1 - z * z));
      axis[0] = Math.cos(phi) * rr; axis[1] = z; axis[2] = Math.sin(phi) * rr;
    }
    tiles.push({
      index: i, dir, center: new Float64Array([dir[0] * radius, dir[1] * radius, dir[2] * radius]),
      verts, fan, nv, startK, dispK, delay, dispDelay, spinA, spinB, axis,
      dispersion: new Float64Array([dir[0], dir[1], dir[2]]),
    });
  }
  return { tiles, radius, seedPoints: pts, coverage: areaSum / (4 * Math.PI) };
}

// ════════════════════════════════════════════════════════════════════════════
// 3) 三阶段运动学（纯函数）
// ════════════════════════════════════════════════════════════════════════════

/** 运动学时序参数（默认取上面那组常量）。 */
export interface SphereMotionCfg {
  assembleSec: number;
  holdSec: number;
  disperseSec: number;
  afterglowSec: number;
  stagger: number;
  dispStagger: number;
}

export const SPHERE_MOTION_DEFAULT: SphereMotionCfg = {
  assembleSec: SPHERE_ASSEMBLE_SEC,
  holdSec: SPHERE_HOLD_SEC,
  disperseSec: SPHERE_DISPERSE_SEC,
  afterglowSec: SPHERE_AFTERGLOW_SEC,
  stagger: SPHERE_TILE_STAGGER,
  dispStagger: SPHERE_DISP_STAGGER,
};

/** 入场总时长（秒）= 组装 + 完整 + 消散 + 余晖。默认 **6.5**，必须 = `ENTRY_TOTAL_SEC`。 */
export function sphereTotalSec(cfg: SphereMotionCfg = SPHERE_MOTION_DEFAULT): number {
  return cfg.assembleSec + cfg.holdSec + cfg.disperseSec + cfg.afterglowSec;
}

/** 组装阶段起始（秒）。 */
export function sphereHoldStart(cfg: SphereMotionCfg = SPHERE_MOTION_DEFAULT): number {
  return cfg.assembleSec;
}
/** 消散阶段起始（秒）。 */
export function sphereDisperseStart(cfg: SphereMotionCfg = SPHERE_MOTION_DEFAULT): number {
  return cfg.assembleSec + cfg.holdSec;
}
/** 消散阶段结束（秒）。 */
export function sphereDisperseEnd(cfg: SphereMotionCfg = SPHERE_MOTION_DEFAULT): number {
  return cfg.assembleSec + cfg.holdSec + cfg.disperseSec;
}

/** 单块瓦片某一时刻的运动状态。 */
export interface SphereTileMotion {
  /** 径向因子：位置 = `球心 + dir × (R × k)`。组装期 `startK(>1) → 1`；消散期 `1 → dispK(>1)`。 */
  k: number;
  /** 翻滚角（弧度，绕 `tile.axis`）—— 组装期从 `spinA → 0`；消散期 `0 → spinB`。 */
  spin: number;
  /** 透明度 0..1。 */
  opacity: number;
  /** 阶段码：1 = 组装中，2 = 完整，3 = 消散中，4 = 已结束。 */
  phase: number;
}

/**
 * **单块瓦片**在 `elapsed`（秒，相对入场起点）时刻的运动状态（纯函数）。
 * 逐帧只消费本函数的输出 ⇒ 台架可直接真跑并断言"t=0 在球外 / 组装末就位 / 消散末飞散"。
 */
export function sphereTileMotion(
  tile: SphereTile, elapsed: number, cfg: SphereMotionCfg = SPHERE_MOTION_DEFAULT,
): SphereTileMotion {
  const holdStart = cfg.assembleSec;
  const dispStart = cfg.assembleSec + cfg.holdSec;
  const dispEnd = dispStart + cfg.disperseSec;
  const asmDur = Math.max(1e-6, cfg.assembleSec - cfg.stagger);
  const dispDur = Math.max(1e-6, cfg.disperseSec - cfg.dispStagger);
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  if (t < holdStart) {
    const tp = clamp01((t - tile.delay) / asmDur);
    const e = smooth01(tp);
    return { k: tile.startK + (1 - tile.startK) * e, opacity: tp, spin: tile.spinA * (1 - e), phase: 1 };
  }
  if (t < dispStart) return { k: 1, opacity: 1, spin: 0, phase: 2 };
  if (t < dispEnd) {
    const td = clamp01((t - dispStart - tile.dispDelay) / dispDur);
    const e = smooth01(td);
    // 消散**保持亮度**：前 `SPHERE_DISP_FADE_START` 段透明度恒为 1（瓦片仍明亮、靠数量减少 + 飞散表现"消散"），
    //   其后一段才快速收掉（单调不增 ⇒ 不闪；`td=1` 时恰好为 0 ⇒ 消散末全透明）。
    const fade = clamp01((td - SPHERE_DISP_FADE_START) / Math.max(1e-6, 1 - SPHERE_DISP_FADE_START));
    return { k: 1 + (tile.dispK - 1) * e, opacity: 1 - smooth01(fade), spin: tile.spinB * e, phase: 3 };
  }
  return { k: tile.dispK, opacity: 0, spin: tile.spinB, phase: 4 };
}

/** 亮白**核心球**强度包络 0..1：组装后半段升起 → 完整期满亮 → 消散前半段褪去。
 *  ⚠ 起点取 `assembleSec × 0.30`（而非 0.5）——参考图 1（组装中）里球心**已经开始发亮**。 */
export function sphereCoreAmt(elapsed: number, cfg: SphereMotionCfg = SPHERE_MOTION_DEFAULT): number {
  const holdStart = cfg.assembleSec;
  const dispStart = cfg.assembleSec + cfg.holdSec;
  const riseStart = holdStart * 0.30;
  const rise = clamp01((elapsed - riseStart) / Math.max(1e-6, holdStart - riseStart));
  const fall = 1 - clamp01((elapsed - dispStart) / Math.max(1e-6, cfg.disperseSec * 0.8));
  return Math.min(smooth01(rise), smooth01(fall));
}

/** 外圈**紫色辉光**强度包络 0..1：完整期亮起 → 消散 + 余晖段淡出（余晖 = 残余）。 */
export function sphereGlowAmt(elapsed: number, cfg: SphereMotionCfg = SPHERE_MOTION_DEFAULT): number {
  const holdStart = cfg.assembleSec;
  const dispStart = cfg.assembleSec + cfg.holdSec;
  const total = sphereTotalSec(cfg);
  const rise = clamp01((elapsed - holdStart * 0.75) / Math.max(1e-6, holdStart * 0.5));
  const fall = 1 - clamp01((elapsed - dispStart) / Math.max(1e-6, total - dispStart));
  return Math.min(smooth01(rise), smooth01(fall));
}

// ════════════════════════════════════════════════════════════════════════════
// 4) 舰队显现（"舰队就在里面出现"）
// ════════════════════════════════════════════════════════════════════════════

export interface SphereRevealCfg {
  /** 吸收段时长（秒）：开战瞬间舰队被"吸进"球里（1 → 0）。 */
  absorbSec: number;
  /** 显现起始时刻（秒，相对入场起点）。 */
  revealStart: number;
  /** 单舰显现时长（秒）。 */
  revealDur: number;
  /** 逐舰错开跨度（秒）。 */
  spread: number;
}

export const SPHERE_REVEAL_DEFAULT: SphereRevealCfg = {
  absorbSec: SPHERE_ABSORB_SEC,
  revealStart: SPHERE_REVEAL_START,
  revealDur: SPHERE_REVEAL_DUR,
  spread: SPHERE_REVEAL_SPREAD,
};

/**
 * 单舰**显现系数** 0..1（缩放淡入），纯函数：
 *   · `elapsed ≤ 0` ⇒ 1（入场尚未开始，舰队照常可见）
 *   · 吸收段 `[0, absorbSec]` ⇒ 1 → 0（被吸进球里）
 *   · `[absorbSec, revealStart + delay]` ⇒ 0（藏在球里）
 *   · `[revealStart + delay, +revealDur]` ⇒ 0 → 1（在球里显现）
 *   · 之后 ⇒ 1（完全显现）
 * ⚠ `delay = 0` 时 `revealStart + revealDur = 2.65s < 4.2s`（消散开始）⇒ **显现必在球体内完成**。
 */
export function sphereRevealAmt(
  elapsed: number, delay: number, cfg: SphereRevealCfg = SPHERE_REVEAL_DEFAULT,
): number {
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  if (t <= 0) return 1;
  if (t < cfg.absorbSec) return 1 - smooth01(clamp01(t / Math.max(1e-6, cfg.absorbSec)));
  const p = (t - cfg.revealStart - Math.max(0, delay)) / Math.max(1e-6, cfg.revealDur);
  return smooth01(clamp01(p));
}

/**
 * 按"**距球心的归一化距离**"给出逐舰显现延迟（秒，∈ [0, spread]）——
 * 靠近球心的舰先显现 ⇒ 观感 = "球心先亮、舰队由内向外浮现"。
 * @param dist    舰到球心的距离
 * @param maxDist 全队最大距离（≤0 ⇒ 退化为 0）
 */
export function sphereRevealDelayByRadius(
  dist: number, maxDist: number, spread: number = SPHERE_REVEAL_SPREAD,
): number {
  if (!(maxDist > 0)) return 0;
  return clamp01(dist / maxDist) * Math.max(0, spread);
}

// ════════════════════════════════════════════════════════════════════════════
// 5) 舰队包围球拟合
// ════════════════════════════════════════════════════════════════════════════

/** 参与包围球拟合的一个单位（位置 + 自身包络半径，如舰长一半）。 */
export interface SphereFitItem {
  x: number;
  y: number;
  z: number;
  /** 该单位的包络半径（半长）—— 保证舰首/舰尾也在球内。 */
  r: number;
}

export interface SphereFit {
  cx: number;
  cy: number;
  cz: number;
  r: number;
}

/**
 * **球体尺寸真源**：舰队包围球。球心 = 成员质心；半径 = `max(minR, (max距离 + 成员包络) × pad)`。
 * ⇒ 保证"舰队确实在球里面"。空队 ⇒ null（调用方据此不开球）。
 */
export function sphereBoundsFit(
  items: SphereFitItem[], pad: number, minR: number,
): SphereFit | null {
  if (!items || items.length === 0) return null;
  let cx = 0, cy = 0, cz = 0;
  for (const it of items) { cx += it.x; cy += it.y; cz += it.z; }
  cx /= items.length; cy /= items.length; cz /= items.length;
  let maxD = 0;
  for (const it of items) {
    const d = Math.hypot(it.x - cx, it.y - cy, it.z - cz) + Math.max(0, it.r);
    if (d > maxD) maxD = d;
  }
  const r = Math.max(Math.max(0, minR), maxD * Math.max(0, pad));
  if (!Number.isFinite(r) || r <= 0) return null;
  return { cx, cy, cz, r };
}

// ════════════════════════════════════════════════════════════════════════════
// 6) 资源释放（结束必须 dispose —— 红队重点检查项）
// ════════════════════════════════════════════════════════════════════════════

/** 材质的最小契约（three 的 `Material` 天然满足；`map` 为可选的贴图）。 */
export interface DisposableMaterialLike {
  dispose(): void;
  /** 贴图（`MeshBasicMaterial.map` 等）—— 也需释放，否则贴图泄漏。 */
  map?: { dispose(): void } | null;
}

/** 可释放节点的**结构契约**（`THREE.Object3D` 天然满足；台架可用普通对象真跑）。 */
export interface DisposableNode {
  geometry?: { dispose(): void } | null;
  material?: DisposableMaterialLike | DisposableMaterialLike[] | null;
  children?: DisposableNode[];
}

/**
 * 深度优先释放整棵对象树的**几何 + 材质 + 材质贴图**，返回实际调用 `dispose()` 的次数。
 *
 * ⇒ 「创建计数 == 释放计数」可被台架直接断言（不依赖 three 运行时）。
 * ⚠ **同一对象只释放一次**（用 `Set` 去重）：球体的 3 层瓦片网格**共享同一份几何**，
 *   不去重就会对同一 `BufferGeometry` 调 3 次 `dispose()`（three 虽容忍，但计数语义会失真）。
 * ⚠ 只 **dispose 资源**，**不负责**从父级摘除（`parent.remove()` 由调用方做）。
 */
export function disposeTree(root: DisposableNode | null | undefined): number {
  if (!root) return 0;
  let n = 0;
  const geos = new Set<{ dispose(): void }>();
  const mappers = new Set<{ dispose(): void }>();
  const seen = new Set<DisposableMaterialLike>();
  const stack: DisposableNode[] = [root];
  const disposeMat = (one: DisposableMaterialLike | null | undefined): void => {
    if (!one || typeof one.dispose !== 'function' || seen.has(one)) return;
    seen.add(one);
    one.dispose(); n += 1;
    const map = one.map;
    if (map && typeof map.dispose === 'function' && !mappers.has(map)) {
      mappers.add(map);
      map.dispose(); n += 1;
    }
  };
  while (stack.length > 0) {
    const node = stack.pop() as DisposableNode;
    const geo = node.geometry;
    if (geo && typeof geo.dispose === 'function' && !geos.has(geo)) {
      geos.add(geo);
      geo.dispose(); n += 1;
    }
    const mat = node.material;
    if (Array.isArray(mat)) { for (const one of mat) disposeMat(one); }
    else disposeMat(mat);
    const ch = node.children;
    if (ch) for (const c of ch) stack.push(c);
  }
  return n;
}
