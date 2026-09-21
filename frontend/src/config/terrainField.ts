/**
 * [v39] 地形 **高度场 + 等高线** 的纯函数（不含 THREE / DOM 依赖）。
 *
 * ── 为什么从"扫描线"改为"等高线"（第一性原理）──────────────────────
 * v38 的扫描线是**规则等距平行线**。平行线只能编码"方向"，**不编码"高度"** ——
 * 把"起伏"这件事交给它承载是**符号错配**：近景下它必然读作"单元格填充纹理"。
 * 等高线（iso-line）天生就是高度的可视化：**每条线 = 一个高度层**，
 * 线越密 = 坡越陡，线弯曲 = 地形起伏。这也是拓扑图 / 雷达回波的标准语言，
 * 与"指挥制 = 全息读数界面"的美术方向同源。
 *
 * 设计取舍（对应实拍结论）：
 *  · **线的数量必须少**（每片 3~6 条）。v38 单格 17 条 ⇒ 纹理感。
 *  · **线必须随噪声弯曲**，不能是直线 ⇒ 用 2~3 倍频 fbm 保证形态自然。
 *  · **每条线是水平的**（y = level × amp）—— 这是等高线的定义，也正是"分层"的观感来源；
 *    不要为了让线贴着曲面而破坏 iso 语义。
 *
 * ⚠ 本模块被 `_v39_contour_sim.cjs` 直接 `require` 断言（本项目铁律：台架打真源码）。
 *   这些函数**错了不会抛错** —— 噪声取了常数、marching squares 的 case 表错位，
 *   都只会让画面变丑或空白，不会报错 ⇒ 必须能被台架量化。
 */

/** [0,1) 确定性哈希：同一个 (i, j, seed) 恒返回同一值（无状态、可复现） */
function hash2(i: number, j: number, seed: number): number {
  let h = i * 374761393 + j * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** 平滑插值（smoothstep），保证一阶连续 ⇒ 等高线不会出现折角 */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 二维 value noise：`[0,1)` 的连续场，格点值由 `hash2` 决定。
 * `cell` = 噪声特征尺寸（世界单位），越大越"团块化"。
 */
export function valueNoise2D(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell, fz = z / cell;
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = smooth(fx - i), tz = smooth(fz - j);
  const v00 = hash2(i, j, seed), v10 = hash2(i + 1, j, seed);
  const v01 = hash2(i, j + 1, seed), v11 = hash2(i + 1, j + 1, seed);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * tz;
}

/**
 * 分形叠加（fbm）→ 归一化到 **[-1, 1]**。
 *
 * ⚠ 必须归一化：下游用绝对值当高度、用固定 level 数组切等高线；
 *   若返回 [0,1]，所有 level 会挤在一侧，等高线只出现在半边。
 */
export function fbm2D(x: number, z: number, cell: number, seed: number, octaves: number): number {
  let sum = 0, amp = 1, norm = 0, c = cell;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise2D(x, z, c, seed + o * 131) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    c *= 0.5;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * 均匀的等高线高度层：`K` 条线均分 [-span, span]。
 *
 * ⚠ 刻意**不含 0**（当 K 为偶数时）—— 0 层恰好是"海平面"，
 *   它会把画面切成上下两块、观感上像"地图中线"而不是地形。
 */
export function contourLevels(K: number, span: number): number[] {
  const out: number[] = [];
  if (K <= 0 || span <= 0) return out;
  for (let k = 0; k < K; k++) out.push(-span + (span * 2 * (k + 0.5)) / K);
  return out;
}

export interface ContourSeg {
  /** 起点（网格坐标：列 c、行 r） */
  c0: number; r0: number;
  /** 终点（网格坐标） */
  c1: number; r1: number;
}

/**
 * Marching squares：在标量场 `values` 上取 `level` 的等值线段。
 *
 * `values` 尺寸 `(cols+1) × (rows+1)`，行主序（`index = r * (cols+1) + c`）。
 * 返回**网格坐标**下的线段；调用方负责映射到世界坐标。
 *
 * 角点编号：0=左上 1=右上 2=右下 3=左下
 * 边点：T=(0,1) R=(1,2) B=(2,3) L=(3,0)，交比按线性插值。
 * case 索引 = 8*v0 + 4*v1 + 2*v2 + 1*v3（`v > level` 记 1）。
 * 二义情形 5 / 10 用**中心均值**消歧（否则同一条等值线会在该格内随机连错）。
 */
export function marchingSquares(
  values: Float64Array,
  cols: number,
  rows: number,
  level: number,
  /**
   * 可选掩码（与 `values` 同尺寸）：**只有四角掩码都等于 `maskId` 的格**才取线。
   * 用于"只在该地形类型的格内画等高线"—— 靠四角全同来避免线渗到邻类区域，
   * 代价是轮廓会**内缩约一格**，故调用方需另画区域外轮廓（否则区域边界不可读）。
   */
  mask?: Uint8Array,
  maskId?: number,
): ContourSeg[] {
  const segs: ContourSeg[] = [];
  const W = cols + 1;
  const at = (c: number, r: number) => values[r * W + c];
  const mk = (c: number, r: number) => (mask ? mask[r * W + c] : 1);
  const want = maskId ?? 1;
  const lerp = (a: number, b: number) => {
    const d = b - a;
    return Math.abs(d) < 1e-12 ? 0.5 : (level - a) / d;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (mask) {
        if (mk(c, r) !== want || mk(c + 1, r) !== want || mk(c + 1, r + 1) !== want || mk(c, r + 1) !== want) continue;
      }
      const v0 = at(c, r), v1 = at(c + 1, r), v2 = at(c + 1, r + 1), v3 = at(c, r + 1);
      const idx = (v0 > level ? 8 : 0) | (v1 > level ? 4 : 0) | (v2 > level ? 2 : 0) | (v3 > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;

      // 四条边上的交点。
      // ⚠ 插值**方向必须与 lerp 的参数顺序一致**（这是本函数唯一容易写错的地方）：
      //   T：角0(c,r) → 角1(c+1,r)      ⇒ x = c + t
      //   R：角1(c+1,r) → 角2(c+1,r+1)  ⇒ r = r + t
      //   B：角2(c+1,r+1) → 角3(c,r+1)  ⇒ x = c + 1 − t     （方向与 T 相反！）
      //   L：角3(c,r+1) → 角0(c,r)      ⇒ r = r + 1 − t     （方向与 R 相反！）
      //   初版把 B / L 也写成 "+ t"，等值线会被整体拉成**对角线**（台架实测：线性场本应是
      //   竖直线 c=10，却输出 (10,r)→(11,r+1)）。这种错不会抛错，只会让线歪掉。
      const tT = lerp(v0, v1), tR = lerp(v1, v2), tB = lerp(v2, v3), tL = lerp(v3, v0);
      const T = [c + tT, r], R = [c + 1, r + tR], B = [c + 1 - tB, r + 1], L = [c, r + 1 - tL];
      const push = (a: number[], b: number[]) => segs.push({ c0: a[0], r0: a[1], c1: b[0], r1: b[1] });

      switch (idx) {
        case 1: case 14: push(L, B); break;
        case 2: case 13: push(B, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(T, R); break;
        case 6: case 9:  push(T, B); break;
        case 7: case 8:  push(L, T); break;
        case 5: case 10: {
          // 二义：中心均值决定连哪一对
          const center = (v0 + v1 + v2 + v3) / 4;
          const centerAbove = center > level;
          if ((idx === 5) === centerAbove) { push(L, T); push(B, R); }
          else { push(L, B); push(T, R); }
          break;
        }
        default: break;
      }
    }
  }
  return segs;
}

/**
 * Chaikin 切角平滑（1 次迭代把折线变成更圆滑的折线，2 次已足够）。
 *
 * 为什么需要：区域边界来自六边形格 ⇒ **天然是六边形锯齿**（近景读作"像素化块"）。
 * 平滑后读作有机空域轮廓。`closed=true` 时首尾相接。
 *
 * ⚠ Chaikin 会**收缩**轮廓（每代向质心靠近约 25%）。故调用方应配一个
 *   轻微的向外放大（或接受收缩 —— 视觉上"空域边缘略小于格域"是可接受的）。
 */
export function chaikin(points: Array<[number, number]>, iterations: number, closed = true): Array<[number, number]> {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const out: Array<[number, number]> = [];
    const n = pts.length;
    const last = closed ? n : n - 1;
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}
