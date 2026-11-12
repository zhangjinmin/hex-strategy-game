/**
 * [传送门·连续光带门框 · v7 `GATE_STYLE = 'D'`] —— **门框几何 + 运动学纯逻辑层**。
 *
 * ── v7 改动（用户 2026-10-16 第 7 次反馈）────────────────────────────────────
 * 「**中间这个光条太抢戏了，删掉不要了**，其余的继续推进」。
 * ⇒ 真机**分部隐藏隔离测试**（冻结同一相位，逐个子对象隐藏后与全开逐像素比对**门内区域**）判定：
 *   门内亮度的 **~80% 来自 `scan`（扫描前沿光带）**，而 v6 的门内位面（水平扫描线）只有 ~5%。
 *   ⇒ **两样都删**：
 *     · **门内位面**（v6 的 `DOOR_SCAN_LINES` 水平扫描线层 + 其贴图 / 网格）—— 整块移除；
 *       本文件不再导出任何 `doorScanLine*` / `doorScanFalloff` 符号。
 *     · **扫描前沿光带**（`doorScanAmt` + 渲染层那个横贯门中的亮条 `scan`）—— 一并移除。
 *       它本就是"舰队被裁剪面扫过"的**视觉冗余**：真正的推进机制是 **5 个裁剪平面**
 *       （`entryGateWritePlanes`，随 `g.p` 沿舰队朝向平移），与它无关。
 *   ⇒ **门内现在是空的**：只剩"空门 + 舰队"，**没有任何横贯的光条**（"不遮挡舰队"天然满足）。
 * ⚠ 「位面与门框同步消退」这条随位面删除而**作废**（无对象可消退）；
 *   但**陪衬元素**（`rim` 锐利内缘 / 外柔边辉光 / 轮廓线 `aperture`）仍要「生长优先 + 与门框同刻归零」
 *   ⇒ 保留包络函数（v7 由 `doorPlaneFadeK` 更名 `doorAuxFadeK`，语义不变）。
 *   ⚠ **`aperture`（轮廓线）保留** —— 它是"门框从一条线展开"的动作感来源，不是中间光条。
 *
 * ── v6 落地：门框"电弧化"（**保留**）─────────────────────────────────────────
 * 用户第 6 次反馈：「**边框呼吸感不够，没什么流动感**……比如**边框曲线抖动起来，像是电弧一样的那种，
 *   有呼吸感**，现在还是**太死板了**」。
 * 诊断（对照 v5 实现）：v5 的 `ω = [0.55…2.10]`（周期 3~11 秒）⇒ 读作**静止**；幅度仅 1.8%；
 *   纯正弦叠加 ⇒ 规则平滑。
 * ⇒ ① 提高 `ω`（周期 0.30~1.80 秒）② 层数 5 → 6 ③ 加**电弧脉冲**幅度调制（间歇性加剧 = 呼吸/放电）
 *   ④ 加**尖峰化**（`|n|^p`，出现尖角而非圆滑波浪）⑤ 幅度 1.8% → 3.0%。
 *
 * ── v5 门框设计（保留：连续光带 + 微随机曲线 + 圆角矩形 + 沿周长生长/收回）───────
 *   ① **连续发光带（ribbon）**：沿矩形周长**连续采样** `DOOR_RIBBON_SAMPLES` 点，每点在轮廓**法线**
 *      两侧各偏移 `DOOR_RIBBON_HALF_W` ⇒ 生成一条**闭合的带状网格**（UV：u = 弧长参数 / v = 横跨带宽）。
 *      带宽 = 门尺寸的 1%~2%（细带，不是粗棒）。
 *   ② **微微的随机曲线（v6 改为"电弧抖动"）**：轮廓点 = **圆角矩形**轮廓
 *      + `normal(t) × DOOR_NOISE_AMP × noise(t, time)`。
 *      · `noise` = **6 个整数频率**的 `sin` 叠加 × **电弧脉冲幅度调制** → **尖峰化**
 *        （整数频率 ⇒ 对 `t` 严格周期 ⇒ 闭合无缝；归一化 ⇒ `|noise| ≤ 1` 有界）；
 *      · 幅度 `DOOR_NOISE_AMP` = 门半尺寸的 **3.0%**（"微微一颤"，不是"扭曲"）；
 *      · 随时间**快速抖动**（`ω` 周期 0.30~1.80 秒）+ **间歇性加剧**（脉冲调制）⇒ 边框"电弧化"。
 *   ③ **门框 = 圆角矩形**：四角做**圆角过渡**（`DOOR_CORNER_R`）⇒ 法线沿轮廓**处处连续**
 *      （直角处的法线不连续会读作"折角 / 断线"，正是要消除的观感）。
 *   ④ **组装 = 沿周长生长 / 消散 = 沿周长反向收回**（渲染层用 `drawRange` 消费 `doorRibbonGrowthK`）。
 *
 * ── 为什么独立成模块（沿用本项目 R1 教训）────────────────────────────────────
 * 台架里 `block.includes('...')` 式断言**没有牙齿**。把"数学/时序"收敛到本模块的纯函数后，
 * `scripts/entryDoorSim.cjs` 可**直接 require 本文件真跑**，并用"改坏源码再跑 ⇒ 断言必须红"自检。
 *
 * ⚠ 本文件**零 import**（不依赖 three / phaser）⇒ 与 `entrySlice.ts` / `entrySphere.ts` 同构，
 *   可被离线台架直接执行、也可被 vue-tsc 静态检查。
 * ⚠ 所有随机量都用**固定 seed 的伪随机**（`mulberry32`）⇒ **确定性**：同 seed 两次生成逐位一致。
 * ⚠ 坐标约定：门局部系 `u ∈ [-1, 1]`（横向）/ `v ∈ [-1, 1]`（竖向）/ `z`（= 门法线 = 舰队朝向，
 *   正 z 指向**舰首**）；渲染层用 `root.scale.set(halfU, halfV, 1)` 把它映到世界。
 */

// ════════════════════════════════════════════════════════════════════════════
// 0) 可调参数（全部集中此处，便于按真机截图迭代）
// ════════════════════════════════════════════════════════════════════════════

/** 门框光带**沿周长的采样点数**（连续采样 ⇒ 带状网格的"段数"）。 */
export const DOOR_RIBBON_SAMPLES = 200;
/** 门框光带的**半宽**（局部单位；门在局部跨 [-1,1] ⇒ 门尺寸 = 2 ⇒ 带宽 2×本值 = 3.2% 半尺寸 = 1.6% 门尺寸）。 */
export const DOOR_RIBBON_HALF_W = 0.016;
/** 门框**圆角半径**（局部单位）—— 四角做圆角过渡 ⇒ 法线沿轮廓处**处连续**（消除折角/断线观感）。 */
export const DOOR_CORNER_R = 0.10;
/** 曲线噪声**幅度**（× 门半尺寸；**3.0%** ⇒ 电弧抖动的可见幅度 —— 仍是"微微一颤"，不扭曲几何）。 */
export const DOOR_NOISE_AMP = 0.030;
/** 曲线噪声**空间频率**（整数 ⇒ 对弧长参数 `t` 严格周期 ⇒ 闭合无接缝）—— **6 层高频**叠加
 *  ⇒ 不规则"电弧"感（层数越多越不像"规则正弦"，但仍严格周期可闭合）。 */
export const DOOR_NOISE_FREQS: number[] = [3, 5, 7, 11, 17, 23];
/** 曲线噪声各频率**权重**（和 = 1 ⇒ `|noise| ≤ 1` ⇒ 位移恒 ≤ `DOOR_NOISE_AMP`）——
 *  高频层留足权重（0.13/0.09/0.06）⇒ 细节 / 电弧"毛刺"感。 */
export const DOOR_NOISE_WEIGHTS: number[] = [0.30, 0.24, 0.18, 0.13, 0.09, 0.06];
/** 曲线噪声各频率的**时间角速度**（弧度/秒）—— **提高一档**（周期 0.30~1.80 秒）
 *  ⇒ 边框明显"抖 / 颤"，而不是"缓慢起伏"（用户："太死板了"）。 */
export const DOOR_NOISE_OMEGA: number[] = [3.5, 5.0, 7.5, 11.0, 16.0, 21.0];
/** **电弧脉冲**幅度调制深度 0..1：每层权重再乘 `1 + DEPTH × (2·u^1.5 − 1)`（`u = (1+sin(ω_p·time+φ))/2`）
 *  ⇒ 抖动**间歇性加剧**（放电 / 呼吸感），而不是恒定幅度的匀速抖动。
 *  ⚠ 归一化因子 `1 + DEPTH` 同时除掉 ⇒ `|noise| ≤ 1` 恒成立（调制只改变"何时更抖"，不放大位移上限）。 */
export const DOOR_NOISE_PULSE_DEPTH = 0.6;
/** **电弧脉冲**的角速度（弧度/秒，与频率层一一对应）—— 取较低频 ⇒ "呼吸式"放电（周期 1.6~5.2 秒）。 */
export const DOOR_NOISE_PULSE_OMEGA: number[] = [4.0, 3.1, 2.4, 1.9, 1.5, 1.2];
/** **尖峰化**指数（< 1 ⇒ 输出被推离 0、更常贴近极值 ⇒ "尖角 / 放电"特征；= 1 ⇒ 关闭）。
 *  ⚠ 仍是**连续**且 Lipschitz 有界（仅在 0 附近斜率略增大）—— 不是白噪声 / 锯齿。 */
export const DOOR_NOISE_SPIKE = 0.9;
/** **流动光**沿周长（u 方向）的滚动速度（UV 单位/秒；单调为正 ⇒ 亮波只朝一个方向流）。 */
export const DOOR_FLOW_SPEED = 0.16;
/** 光带上**移动亮点**数量（能量脉冲沿门框跑；渲染层贴图里等距撒亮点，随 UV 滚动而移动）。 */
export const DOOR_PULSE_COUNT = 3;
/** 组装阶段时长（秒，0 → 2.6）—— 光带沿周长**生长**（含"从一条线展开"的开启动作）。 */
export const DOOR_ASSEMBLE_SEC = 2.6;
/** 完整阶段时长（秒，2.6 → 4.2）—— 门框完整发光，**舰队在此窗口内被门扫过**。 */
export const DOOR_HOLD_SEC = 1.6;
/** 消散阶段时长（秒，4.2 → 6.2）—— 光带沿周长**反向收回** + 淡出。 */
export const DOOR_DISPERSE_SEC = 2.0;
/** 余晖阶段时长（秒，6.2 → 6.5）—— 外辉光残余淡出。
 *  ⚠ 组装/完整/消散（2.6+1.6+2.0=6.2）已定，余晖取 0.3 ⇒ 总时长恰 **6.5**（= `ENTRY_TOTAL_SEC` = 球）。 */
export const DOOR_AFTERGLOW_SEC = 0.3;
/** 门"开启"动作占组装阶段的比例（0.6 ⇒ 前 60% 的组装时间内完成 从线 → 矩形 的展开）。 */
export const DOOR_APERTURE_FRAC = 0.6;
/** 几何随机种子（确定性：改此值 ⇒ 噪声相位整组变化，但同值两次生成逐位一致）。 */
export const DOOR_SEED = 0x1d007a1e;
/** 色散镶边的**局部偏移**（× 门半尺寸）—— 红/青两层沿门法线（z）微偏移 + 轻微缩放
 *  ⇒ 门框轮廓处出现红/青镶边（**加在光带上**，不再是"块"上）。
 *  ⚠ 与 `entrySlice.GATE_STYLE_PARAMS.D.dispersion` **必须一致**（台架断言防两处漂移）；
 *    取球体精修后的**微妙值**量级（微偏移 ⇒ 窄丝带，不整圈粗红箍）。 */
export const DOOR_DISPERSION_K = 0.006;

// ════════════════════════════════════════════════════════════════════════════
// 1) 工具：确定性伪随机 / 缓动（自包含，零 import）
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

/** 噪声各频率的**初相**（由 `DOOR_SEED` 确定性导出 ⇒ 同 seed 逐位一致）。 */
const NOISE_PHASES: number[] = (() => {
  const rand = mulberry32(DOOR_SEED >>> 0);
  return DOOR_NOISE_FREQS.map(() => rand() * Math.PI * 2);
})();

/** **电弧脉冲**各频率的**初相**（另取一段 seed 派生 ⇒ 与 `NOISE_PHASES` 不相关 ⇒ 放电时刻不规则）。 */
const NOISE_PULSE_PHASES: number[] = (() => {
  const rand = mulberry32((DOOR_SEED ^ 0x9e3779b9) >>> 0);
  return DOOR_NOISE_FREQS.map(() => rand() * Math.PI * 2);
})();

// ════════════════════════════════════════════════════════════════════════════
// 2) 门框轮廓（圆角矩形的弧长参数化）—— **法线处处连续**
// ════════════════════════════════════════════════════════════════════════════

/** 圆角矩形每条**直边**长度（局部单位）。 */
const SEG_STRAIGHT = 2 - 2 * DOOR_CORNER_R;
/** 圆角矩形每个**圆角**弧长（局部单位，90° 圆弧）。 */
const SEG_ARC = (Math.PI / 2) * DOOR_CORNER_R;
/** 门框轮廓**周长**（局部单位）= 4 直边 + 4 圆角。 */
export const DOOR_RIBBON_PERIMETER = 4 * SEG_STRAIGHT + 4 * SEG_ARC;

/** 轮廓上一点：位置 + **单位外法线**（圆角矩形 ⇒ 沿轮廓处处连续）。 */
export interface DoorRibbonPoint {
  /** 局部横向坐标。 */
  x: number;
  /** 局部竖向坐标。 */
  y: number;
  /** 单位外法线 x 分量（由门心向外）。 */
  nx: number;
  /** 单位外法线 y 分量。 */
  ny: number;
}

/**
 * **门框轮廓**（圆角矩形，逆时针 CCW）按**弧长**参数化的点 / 法线。
 * 顺序：下边直段 → 右下圆角 → 右边直段 → 右上圆角 → 上边直段 → 左上圆角 → 左边直段 → 左下圆角。
 * `t ∈ [0,1)` 为归一化弧长（`t=0` ⇒ 下边直段起点）。
 * ⚠ 四角做圆角 ⇒ 法线沿 `t` **连续**（无"折角处法线突变"⇒ 光带不会在角上读作断线）。
 */
export function doorRibbonOutline(t: number): DoorRibbonPoint {
  const P = DOOR_RIBBON_PERIMETER;
  const tt = t - Math.floor(t);                 // 归一化到 [0,1)（含负 t 兜底）
  let s = tt * P;
  const L = SEG_STRAIGHT, A = SEG_ARC;
  const R = DOOR_CORNER_R;
  const segs = [L, A, L, A, L, A, L, A];
  let i = 0;
  while (i < 7 && s >= segs[i]) { s -= segs[i]; i++; }
  switch (i) {
    case 0:   // 下边直段（自左向右）
      return { x: -1 + R + s, y: -1, nx: 0, ny: -1 };
    case 1: { // 右下圆角
      const th = -Math.PI / 2 + (s / A) * (Math.PI / 2);
      return { x: (1 - R) + R * Math.cos(th), y: (-1 + R) + R * Math.sin(th), nx: Math.cos(th), ny: Math.sin(th) };
    }
    case 2:   // 右边直段（自下向上）
      return { x: 1, y: -1 + R + s, nx: 1, ny: 0 };
    case 3: { // 右上圆角
      const th = (s / A) * (Math.PI / 2);
      return { x: (1 - R) + R * Math.cos(th), y: (1 - R) + R * Math.sin(th), nx: Math.cos(th), ny: Math.sin(th) };
    }
    case 4:   // 上边直段（自右向左）
      return { x: 1 - R - s, y: 1, nx: 0, ny: 1 };
    case 5: { // 左上圆角
      const th = Math.PI / 2 + (s / A) * (Math.PI / 2);
      return { x: (-1 + R) + R * Math.cos(th), y: (1 - R) + R * Math.sin(th), nx: Math.cos(th), ny: Math.sin(th) };
    }
    case 6:   // 左边直段（自上向下）
      return { x: -1, y: 1 - R - s, nx: -1, ny: 0 };
    default: { // 左下圆角
      const th = Math.PI + (s / A) * (Math.PI / 2);
      return { x: (-1 + R) + R * Math.cos(th), y: (-1 + R) + R * Math.sin(th), nx: Math.cos(th), ny: Math.sin(th) };
    }
  }
}

/**
 * **尖峰化**：`sign(n) × |n|^p`（`p = DOOR_NOISE_SPIKE < 1`）。
 * 把取值**推离 0**（`0<x<1 ⇒ x^p > x`）⇒ 波形更常贴近极值、过零点更陡 ⇒ "尖角 / 放电"特征。
 * ⚠ `p = 1` ⇒ 恒等（关闭）；`|n| ≤ 1 ⇒ |输出| ≤ 1`（不放大幅度）。
 */
export function arcNoiseSpike(n: number): number {
  if (!(Math.abs(n) > 1e-9)) return 0;
  const s = Math.pow(Math.abs(n), DOOR_NOISE_SPIKE);
  return n < 0 ? -s : s;
}

/**
 * **曲线噪声** `noise(t, time) ∈ [-1, 1]`：多个**整数频率** `sin` 叠加（权值和 = 1 ⇒ 有界），
 * 带时间相位（**快速**演变）+ **电弧脉冲幅度调制**（间歇性加剧）+ **尖峰化**。
 *
 *  · 整数频率 ⇒ 对 `t` **严格周期**（`noise(t+1) = noise(t)`）⇒ 门框闭合无接缝；
 *  · 幅度调制 `m_i(time) ∈ [1−D, 1+D]` 只依赖 `time` ⇒ 对 `t` 的导数不含它，且整体除以 `1+D`
 *    ⇒ `|noise| ≤ 1` 与"位移 ≤ 幅度"两条性质**恒成立**；
 *  · 仍是**连续**函数（`sin` + 连续调制 + `|x|^p` 连续）—— **绝不是白噪声 / 锯齿**。
 */
export function doorRibbonNoise(t: number, time: number): number {
  const TWO_PI = Math.PI * 2;
  const norm = 1 + DOOR_NOISE_PULSE_DEPTH;
  let n = 0;
  for (let i = 0; i < DOOR_NOISE_FREQS.length; i++) {
    const u = 0.5 + 0.5 * Math.sin(NOISE_PULSE_PHASES[i] + DOOR_NOISE_PULSE_OMEGA[i] * time);
    const pulse = 1 + DOOR_NOISE_PULSE_DEPTH * (2 * Math.pow(u, 1.5) - 1);
    n += DOOR_NOISE_WEIGHTS[i] * pulse
      * Math.sin(TWO_PI * DOOR_NOISE_FREQS[i] * t + NOISE_PHASES[i] + DOOR_NOISE_OMEGA[i] * time);
  }
  return arcNoiseSpike(n / norm);
}

/** 门框光带**中心线**上一点 = 轮廓点 + `normal × 幅度 × 噪声`。 */
export function doorRibbonPoint(t: number, time: number, amp = DOOR_NOISE_AMP): { x: number; y: number } {
  const o = doorRibbonOutline(t);
  const d = doorRibbonNoise(t, time) * amp;
  return { x: o.x + o.nx * d, y: o.y + o.ny * d };
}

/**
 * 光带**中心线**的连续采样：返回 `Float32Array`，每采样点 4 个分量 `[x, y, nx, ny]`
 * （`nx/ny` = **未加噪的轮廓法线**，用于把中心线扩成带宽；小噪声下与真实法线差异可忽略，
 *  且不会自交 ⇒ 光带干净）。采样点 `i` 的参数 `t = i / count`。
 */
export function doorRibbonSamples(time: number, count = DOOR_RIBBON_SAMPLES, ampK = 1): Float32Array {
  const n = Math.max(8, Math.floor(count));
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const o = doorRibbonOutline(t);
    const d = doorRibbonNoise(t, time) * DOOR_NOISE_AMP * ampK;   // ampK：辉光层传小值 ⇒ 宽带的波浪不会被放大
    out[i * 4] = o.x + o.nx * d;
    out[i * 4 + 1] = o.y + o.ny * d;
    out[i * 4 + 2] = o.nx;
    out[i * 4 + 3] = o.ny;
  }
  return out;
}

/**
 * 光带**带状顶点**（渲染层直接塞进 `BufferGeometry.position`）：
 * 每采样点 2 个顶点（沿法线 −halfW / +halfW）⇒ 长度 `count × 2 × 3`。
 * 相邻两点连成的四边形宽度**恒为 `2 × halfW`**（细带，不随曲率变化 ⇒ 不出现"粗细不均"）。
 * 传入 `out`（长度 ≥ `count×6` 的缓冲）⇒ **就地写入**（渲染层逐帧复用同一 `BufferAttribute` ⇒ 零分配）。
 * `kx / ky` = **带宽的轴向补偿系数**（默认 1）：渲染层的 `root.scale = (halfU, halfV, 1)` 会把
 *   "局部等宽"带拉成"横竖不等宽"（矩形门 ⇒ 左右两条比上下两条粗）。传
 *   `kx = ref/halfU, ky = ref/halfV`（`ref = (halfU+halfV)/2`）即让**世界空间带宽处处相等**。
 */
export function doorRibbonBandVertices(
  time: number, count = DOOR_RIBBON_SAMPLES, halfW = DOOR_RIBBON_HALF_W, out?: Float32Array,
  kx = 1, ky = 1, ampK = 1,
): Float32Array {
  const n = Math.max(8, Math.floor(count));
  const s = doorRibbonSamples(time, n, ampK);
  const dst = (out && out.length >= n * 6) ? out : new Float32Array(n * 2 * 3);
  const wx = halfW * kx, wy = halfW * ky;
  for (let i = 0; i < n; i++) {
    const cx = s[i * 4], cy = s[i * 4 + 1], nx = s[i * 4 + 2], ny = s[i * 4 + 3];
    const b = i * 6;
    dst[b] = cx - nx * wx; dst[b + 1] = cy - ny * wy; dst[b + 2] = 0;
    dst[b + 3] = cx + nx * wx; dst[b + 4] = cy + ny * wy; dst[b + 5] = 0;
  }
  return dst;
}

/**
 * 求"世界空间等宽"所需的轴向补偿系数 `[kx, ky]`（纯函数 ⇒ 台架可直接断言）。
 * 门局部 `[-1,1]²` 被 `root.scale = (halfU, halfV, 1)` 映到世界；`ref = (halfU+halfV)/2` 是
 * 一个**各向同性参考尺度**（使带宽 ≈ 门尺寸的 `DOOR_RIBBON_HALF_W` 比例，且横竖一致）。
 */
export function doorRibbonAspectK(halfU: number, halfV: number): [number, number] {
  const hu = Number.isFinite(halfU) && halfU > 1e-6 ? halfU : 1;
  const hv = Number.isFinite(halfV) && halfV > 1e-6 ? halfV : 1;
  const ref = 0.5 * (hu + hv);
  return [ref / hu, ref / hv];
}

/** 光带**UV**：`u = i / count`（沿周长，0→1 ⇒ 贴图沿 u 滚动 = 光波沿门框流动）；`v = 0 / 1`（横跨带宽）。 */
export function doorRibbonBandUvs(count = DOOR_RIBBON_SAMPLES): Float32Array {
  const n = Math.max(8, Math.floor(count));
  const out = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    out[i * 4] = u; out[i * 4 + 1] = 0;
    out[i * 4 + 2] = u; out[i * 4 + 3] = 1;
  }
  return out;
}

/** 光带**索引**（闭合三角带；`count × 6` 个索引 ⇒ `count × 2` 个三角形）。 */
export function doorRibbonBandIndices(count = DOOR_RIBBON_SAMPLES): Uint16Array {
  const n = Math.max(8, Math.floor(count));
  const out = new Uint16Array(n * 6);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;              // 闭合：末点连回首点
    const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
    const o = i * 6;
    out[o] = a; out[o + 1] = b; out[o + 2] = d;
    out[o + 3] = a; out[o + 4] = d; out[o + 5] = c;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 3) 三阶段运动学（纯函数）
// ════════════════════════════════════════════════════════════════════════════

/** 运动学时序参数（默认取上面那组常量）。 */
export interface DoorMotionCfg {
  assembleSec: number;
  holdSec: number;
  disperseSec: number;
  afterglowSec: number;
}

export const DOOR_MOTION_DEFAULT: DoorMotionCfg = {
  assembleSec: DOOR_ASSEMBLE_SEC,
  holdSec: DOOR_HOLD_SEC,
  disperseSec: DOOR_DISPERSE_SEC,
  afterglowSec: DOOR_AFTERGLOW_SEC,
};

/** 入场总时长（秒）= 组装 + 完整 + 消散 + 余晖。默认 **6.5**，必须 = `ENTRY_TOTAL_SEC`。 */
export function doorTotalSec(cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  return cfg.assembleSec + cfg.holdSec + cfg.disperseSec + cfg.afterglowSec;
}

/** 完整阶段起始（秒）。 */
export function doorHoldStart(cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  return cfg.assembleSec;
}
/** 消散阶段起始（秒）。 */
export function doorDisperseStart(cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  return cfg.assembleSec + cfg.holdSec;
}
/** 消散阶段结束（秒）。 */
export function doorDisperseEnd(cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  return cfg.assembleSec + cfg.holdSec + cfg.disperseSec;
}

/**
 * **光带生长系数** `0..1`（渲染层用它设 `drawRange` ⇒ 光带沿周长"画出来" / "收回去"）。
 *   · 组装 `[0, assembleSec)`：`0 → 1` **单调不减**（从一点开始，沿周长生长到闭合）；
 *   · 完整 `[assembleSec, disperseStart)`：恒 `1`（完整门框）；
 *   · 消散 `[disperseStart, disperseEnd)`：`1 → 0` **单调不增**（沿周长**反向收回**）；
 *   · 余晖及以后：恒 `0`。
 */
export function doorRibbonGrowthK(elapsed: number, cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  const holdStart = cfg.assembleSec;
  const dispStart = cfg.assembleSec + cfg.holdSec;
  const dispEnd = dispStart + cfg.disperseSec;
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  if (t <= 0) return 0;
  if (t < holdStart) return smooth01(t / Math.max(1e-6, holdStart));
  if (t < dispStart) return 1;
  if (t < dispEnd) return 1 - smooth01((t - dispStart) / Math.max(1e-6, cfg.disperseSec));
  return 0;
}

/**
 * 「**生长优先**」跟随系数 0..1 —— 陪衬元素（`rim` 锐利内缘 / 外柔边辉光 / 轮廓线 `aperture`）
 * 的不透明度乘子。取 `doorRibbonGrowthK` 的**后半段**：
 *   · 光带生长 < 50% ⇒ 恒 `0`（画面上**只有**"正在沿周长长出来的光带"）；
 *   · 生长 ≥ 100% ⇒ 恒 `1`（完整态的陪衬齐备）。
 * 为什么需要：否则光带才画到一半，画面上已经是一个"完整的白框"⇒ 组装期读不出"生长"。
 */
export function doorLateFollowK(growthK: number): number {
  return smooth01((growthK - 0.5) * 2);
}

/**
 * ★[v7] **陪衬元素的消退包络** 0..1 —— `rim` / 外柔边辉光 / 轮廓线 `aperture` 的 opacity 乘子，
 * 取「**生长优先**」+「**与门框同刻归零**」两侧语义的组合。
 *
 * （历史：v6 时它叫 `doorPlaneFadeK`，为的是让**门内位面**不晚于门框消失；v7 位面已删除，
 *   但同一包络仍被上述**陪衬元素**沿用 ⇒ 更名 `doorAuxFadeK`，**语义 / 数值完全不变**。）
 *
 * 分两侧，各自取该侧该用的语义：
 *   · **组装 / 完整侧**：用 `doorLateFollowK(gk)` —— 「生长优先」，光带长过半陪衬才亮（读得出"生长"）；
 *   · **消散 / 余晖侧**：直接用 `gk` —— **门框画到多少，陪衬就剩多少** ⇒
 *     `doorAuxFadeK` 与 `doorRibbonGrowthK` **同刻归零**（`disperseEnd`）。
 * ⚠ 两侧在 `disperseStart` 处均为 1（`doorLateFollowK(1) = 1 = gk`）⇒ 包络连续，无跳变。
 */
export function doorAuxFadeK(elapsed: number, cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  const gk = doorRibbonGrowthK(elapsed, cfg);
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  const dispStart = cfg.assembleSec + cfg.holdSec;
  if (t >= dispStart) return gk;          // 收回侧：与门框**同刻**归零
  return doorLateFollowK(gk);             // 组装 / 完整侧：生长优先
}

/**
 * **流动光**沿周长（u 方向）的累计相位（UV 单位）—— 渲染层设 `texture.offset.x`。
 * 单调不减（恒速 `DOOR_FLOW_SPEED`）⇒ 亮波**只朝一个方向流**（不会来回摆）。
 */
export function doorRibbonFlowOffset(elapsed: number): number {
  const t = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  return t * DOOR_FLOW_SPEED;
}

/**
 * **开启动作**系数 0..1：组装阶段前 `DOOR_APERTURE_FRAC` 段内，门从"一条线"展开成完整矩形。
 * 渲染层用它缩放门框轮廓（竖向从 0 → 1）⇒ 有"开启"的动作感，而不是一开始就是个静态框。
 */
export function doorApertureK(elapsed: number, cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  const dur = Math.max(1e-6, cfg.assembleSec * DOOR_APERTURE_FRAC);
  return smooth01(clamp01(elapsed / dur));
}

/** **外辉光**强度包络 0..1：组装后半段升起 → 完整期满亮 → 消散 + 余晖段淡出（余晖 = 残余）。 */
export function doorBarrierAmt(elapsed: number, cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  const holdStart = cfg.assembleSec;
  const dispStart = cfg.assembleSec + cfg.holdSec;
  const total = doorTotalSec(cfg);
  const rise = clamp01((elapsed - holdStart * 0.35) / Math.max(1e-6, holdStart * 0.65));
  const fall = 1 - clamp01((elapsed - dispStart) / Math.max(1e-6, total - dispStart));
  return Math.min(smooth01(rise), smooth01(fall));
}
