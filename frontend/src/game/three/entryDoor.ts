/**
 * [传送门·能量块组装 / 消散入场 · v4 `GATE_STYLE = 'D'`] —— **门框几何 + 运动学纯逻辑层**。
 *
 * 用户需求（2026-10-16 四次反馈原话）：
 * 「还是不够科幻……还是觉得**之前的门**的效果更好，但是那个门的效果可以再设计下，**再科幻点**，
 *   不要像之前一样是很普通，同时**速度可以慢一点**，但这个**球状体**做的挺好」。
 *
 * ── 设计目标（把球体已**成功**的元素移植到门上，并让门"活"起来）────────────────
 *   ① **门框 = 离散能量块**：沿矩形门框均匀分布 N 个小块（默认 72，区间 60~80）；
 *      · **组装**：每块从门框**外**的随机位置飞入并旋转对齐（逐块随机延迟）⇒ 复刻球体的"组装感"；
 *      · **溶解**：末尾每块**向外飞出 + 淡出**（逐块延迟）。
 *   ② **开启动作**：组装前半段门从"一条线"**展开**成完整矩形（`doorApertureK` 0→1）。
 *   ③ 三种自发光质感（**渲染层**实现，本层只给位置/旋转/透明度）：色散镶边（红/青 3 层微偏移）/
 *      自发光块 / 外圈辉光 —— 与球体同源的层次。
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

/** 门框能量块数（用户给的参考量级 60~80；⚠ 每块 = 3 层 Mesh ⇒ 单门 draw call ≈ 3× 本值）。 */
export const DOOR_BLOCK_COUNT = 72;
/** 组装阶段时长（秒，0 → 2.6）—— 能量块从框外飞入并拼合（含"从一条线展开"的开启动作）。 */
export const DOOR_ASSEMBLE_SEC = 2.6;
/** 完整阶段时长（秒，2.6 → 4.2）—— 门框完整发光，**舰队在此窗口内被门扫过**。 */
export const DOOR_HOLD_SEC = 1.6;
/** 消散阶段时长（秒，4.2 → 6.2）—— 能量块向外飞散 + 翻滚 + 淡出。 */
export const DOOR_DISPERSE_SEC = 2.0;
/** 余晖阶段时长（秒，6.2 → 6.5）—— 外辉光 / 位面残余淡出。
 *  ⚠ 组装/完整/消散（2.6+1.6+2.0=6.2）已定，余晖取 0.3 ⇒ 总时长恰 **6.5**（= `ENTRY_TOTAL_SEC` = 球）。 */
export const DOOR_AFTERGLOW_SEC = 0.3;
/** 组装逐块**随机延迟**跨度（秒）—— 复刻"随机拼起来"（不是齐刷刷一起到位）。 */
export const DOOR_BLOCK_STAGGER = 0.8;
/** 消散逐块**随机延迟**跨度（秒）—— 复刻"随机飞散"。 */
export const DOOR_DISP_STAGGER = 0.6;
/** 组装起点**径向因子下限**（× 门半尺寸）—— 必须保证 `t=0` 时块在**门框之外**（见 `DOOR_START_DRIFT_MIN`）。 */
export const DOOR_START_DRIFT_MIN = 1.35;
/** 组装起点**径向因子上限**（× 门半尺寸）。 */
export const DOOR_START_DRIFT_MAX = 2.20;
/** 组装起点**沿法线（z）外偏**（× 1；正 z = 舰首方向 ⇒ 块从门前方飞入）。 */
export const DOOR_START_Z_MIN = 0.6;
export const DOOR_START_Z_MAX = 1.7;
/** 消散终点**径向因子下限**（× 门半尺寸）—— 保证消散末块在**门框之外**。 */
export const DOOR_DISP_DRIFT_MIN = 1.10;
/** 消散终点**径向因子上限**（× 门半尺寸）。 */
export const DOOR_DISP_DRIFT_MAX = 2.10;
/** 消散终点**沿法线（z）外偏**。 */
export const DOOR_DISP_Z_MIN = 0.5;
export const DOOR_DISP_Z_MAX = 1.6;
/** 组装起点**收缩比例**（1 = 不收缩；0.14 ⇒ 所有块聚成门心一团 ⇒ 读作"一条线/一点"再由开启动作展开）。 */
export const DOOR_START_OPEN_K = 0.14;
/** 消散期**亮度保持**起始比例：块透明度在前 `DOOR_DISP_FADE_START` 段保持 1（仍明亮），其后才快速收掉。 */
export const DOOR_DISP_FADE_START = 0.5;
/** 门"开启"动作占组装阶段的比例（0.6 ⇒ 前 60% 的组装时间内完成 从线 → 矩形 的展开）。 */
export const DOOR_APERTURE_FRAC = 0.6;
/** 几何随机种子（确定性：改此值 ⇒ 整套块布局变化，但同值两次生成逐位一致）。 */
export const DOOR_SEED = 0x1d007a1e;
/** 色散镶边的**局部偏移**（× 块局部尺寸）—— 红/青两层沿块法线微偏移 ⇒ 门框轮廓处出现红/青镶边。
 *  ⚠ 与 `entrySlice.GATE_STYLE_PARAMS.D.dispersion` **必须一致**（台架断言防两处漂移）；
 *    取球体精修后的**微妙值**量级（微偏移 ⇒ 窄丝带，不整圈粗红箍）。 */
export const DOOR_DISPERSION_K = 0.006;
/** 位面扫描光带沿门的**厚度**（局部 z，仅渲染参考；纯数据便于台架断言"确实有光带"）。 */
export const DOOR_SCAN_BAND = 0.06;

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

// ════════════════════════════════════════════════════════════════════════════
// 2) 门框块布局
// ════════════════════════════════════════════════════════════════════════════

/**
 * 矩形周长上按**弧长均匀**取点（局部 [-1,1]²，逆时针；周长 = 8）。
 * `s ∈ [0, 8)`：`[0,2)` 下边 → `[2,4)` 右边 → `[4,6)` 上边 → `[6,8)` 左边。
 */
export function rectPerimeterPoint(s: number): [number, number] {
  let t = s % 8;
  if (t < 0) t += 8;
  if (t < 2) return [-1 + t, -1];
  t -= 2;
  if (t < 2) return [1, -1 + t];
  t -= 2;
  if (t < 2) return [1 - t, 1];
  t -= 2;
  return [-1, 1 - t];
}

/** 一块门框能量块（几何槽位 + 动画随机量，全部相对**门中心**）。 */
export interface DoorBlock {
  /** 块序号（= 沿周长弧长的下标）。 */
  index: number;
  /** 槽位横向坐标（局部 [-1,1]，恰好落在门框上 ⇒ `max(|su|,|sv|) = 1`）。 */
  su: number;
  /** 槽位竖向坐标。 */
  sv: number;
  /** 槽位所在**边**（0 下 / 1 右 / 2 上 / 3 左）—— 主色分边（上下亮 / 左右更亮）用。 */
  edge: number;
  /** 组装起点径向偏移 `du`（相对门中心**向外**；`t=0` 时块在门框外）。 */
  du: number;
  /** 组装起点径向偏移 `dv`。 */
  dv: number;
  /** 组装起点沿法线（z）外偏（正 = 舰首侧）。 */
  sz: number;
  /** 组装随机延迟（秒，∈ [0, stagger]）。 */
  delay: number;
  /** 消散终点径向偏移 `ddu`（向外）。 */
  ddu: number;
  /** 消散终点径向偏移 `ddv`。 */
  ddv: number;
  /** 消散终点沿法线（z）外偏。 */
  ddz: number;
  /** 消散随机延迟（秒，∈ [0, dispStagger]）。 */
  dispDelay: number;
  /** 组装起步翻滚角（弧度）。 */
  spinA: number;
  /** 消散额外翻滚角（弧度）。 */
  spinB: number;
  /** 翻滚轴（局部单位向量，stride 3）。 */
  axis: Float64Array;
}

export interface DoorBlockSet {
  blocks: DoorBlock[];
  /** 块数（= 传入 count，便于调用方一处取用）。 */
  count: number;
  /** 各边块数直方图 `[下, 右, 上, 左]` —— 台架断言"沿框均匀分布"用。 */
  edgeHist: [number, number, number, number];
}

export interface DoorBuildOpts {
  /** 块数（默认 `DOOR_BLOCK_COUNT`）。 */
  count?: number;
  /** 随机种子（默认 `DOOR_SEED`）。 */
  seed?: number;
}

/**
 * **门框块布局**：沿矩形周长均匀撒 `count` 块，每块携带全部动画随机量。
 * 确定性：同 `(count, seed)` ⇒ 结果**逐位一致**。
 */
export function buildDoorBlocks(opts: DoorBuildOpts = {}): DoorBlockSet {
  const count = Math.max(4, Math.floor(opts.count ?? DOOR_BLOCK_COUNT));
  const seed = (opts.seed ?? DOOR_SEED) >>> 0;
  const rand = mulberry32(seed);
  const blocks: DoorBlock[] = [];
  const edgeHist: [number, number, number, number] = [0, 0, 0, 0];
  const per = 8 / count;
  for (let i = 0; i < count; i++) {
    const s = (i + 0.5) * per;                 // 沿周长弧长均匀（+0.5 ⇒ 不落在角点上，分布更均匀）
    const [su, sv] = rectPerimeterPoint(s);
    const len = Math.hypot(su, sv) || 1;
    const nx = su / len, ny = sv / len;        // 由门心向外的径向量（单位）
    // 槽位所在边
    let edge = 0;
    if (su >= 1 - 1e-9) edge = 1;
    else if (sv >= 1 - 1e-9) edge = 2;
    else if (su <= -1 + 1e-9) edge = 3;
    edgeHist[edge] += 1;
    // 组装起点：径向外偏（≥ START_DRIFT_MIN ⇒ t=0 必在框外）+ 法线外偏 + 逐块随机延迟 + 翻滚
    const startMag = randRange(rand, DOOR_START_DRIFT_MIN, DOOR_START_DRIFT_MAX);
    const du = nx * startMag, dv = ny * startMag;
    const sz = randRange(rand, DOOR_START_Z_MIN, DOOR_START_Z_MAX);
    const delay = rand() * DOOR_BLOCK_STAGGER;
    // 消散终点：径向外偏（≥ DISP_DRIFT_MIN ⇒ 消散末必在框外）+ 法线外偏 + 逐块随机延迟 + 翻滚
    const dispMag = randRange(rand, DOOR_DISP_DRIFT_MIN, DOOR_DISP_DRIFT_MAX);
    const ddu = nx * dispMag, ddv = ny * dispMag;
    const ddz = randRange(rand, DOOR_DISP_Z_MIN, DOOR_DISP_Z_MAX);
    const dispDelay = rand() * DOOR_DISP_STAGGER;
    const spinA = randRange(rand, -Math.PI, Math.PI);
    const spinB = randRange(rand, -Math.PI, Math.PI);
    const axis = new Float64Array([0, 0, 0]);
    {
      const z = randRange(rand, -1, 1);
      const phi = randRange(rand, 0, Math.PI * 2);
      const rr = Math.sqrt(Math.max(0, 1 - z * z));
      axis[0] = Math.cos(phi) * rr; axis[1] = z; axis[2] = Math.sin(phi) * rr;
    }
    blocks.push({
      index: i, su, sv, edge, du, dv, sz, delay, ddu, ddv, ddz, dispDelay, spinA, spinB, axis,
    });
  }
  return { blocks, count, edgeHist };
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
  stagger: number;
  dispStagger: number;
}

export const DOOR_MOTION_DEFAULT: DoorMotionCfg = {
  assembleSec: DOOR_ASSEMBLE_SEC,
  holdSec: DOOR_HOLD_SEC,
  disperseSec: DOOR_DISPERSE_SEC,
  afterglowSec: DOOR_AFTERGLOW_SEC,
  stagger: DOOR_BLOCK_STAGGER,
  dispStagger: DOOR_DISP_STAGGER,
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

/** 单块能量块某一时刻的运动状态。 */
export interface DoorBlockMotion {
  /** 局部横向坐标（`[-1,1]` = 门框；`t=0` 时 `|u|>1` 或 `|v|>1` = 框外）。 */
  u: number;
  /** 局部竖向坐标。 */
  v: number;
  /** 局部法线偏移（正 = 舰首侧）。 */
  z: number;
  /** 透明度 0..1。 */
  opacity: number;
  /** 翻滚角（弧度，绕 `block.axis`）。 */
  spin: number;
  /** 阶段码：1 = 组装中，2 = 完整，3 = 消散中，4 = 已结束。 */
  phase: number;
}

/**
 * **单块能量块**在 `elapsed`（秒，相对入场起点）时刻的运动状态（纯函数）。
 * 逐帧只消费本函数的输出 ⇒ 台架可直接真跑并断言"t=0 在框外 / 组装末就位 / 消散末飞散"。
 */
export function doorBlockMotion(
  block: DoorBlock, elapsed: number, cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT,
): DoorBlockMotion {
  const holdStart = cfg.assembleSec;
  const dispStart = cfg.assembleSec + cfg.holdSec;
  const dispEnd = dispStart + cfg.disperseSec;
  const asmDur = Math.max(1e-6, cfg.assembleSec - cfg.stagger);
  const dispDur = Math.max(1e-6, cfg.disperseSec - cfg.dispStagger);
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  if (t < holdStart) {
    const tp = clamp01((t - block.delay) / asmDur);
    const e = smooth01(tp);
    // 开启动作：槽位随 e 从门心（openK≈0.14 ⇒ "一条线/一点"）展开到门框（openK=1）；
    //   同时径向偏移 `(1-e)` 从**框外**收进来 ⇒ 块"飞入并对齐"。
    const openK = DOOR_START_OPEN_K + (1 - DOOR_START_OPEN_K) * e;
    const back = 1 - e;
    return {
      u: block.su * openK + block.du * back,
      v: block.sv * openK + block.dv * back,
      z: block.sz * back,
      opacity: tp,
      spin: block.spinA * back,
      phase: 1,
    };
  }
  if (t < dispStart) return { u: block.su, v: block.sv, z: 0, opacity: 1, spin: 0, phase: 2 };
  if (t < dispEnd) {
    const td = clamp01((t - dispStart - block.dispDelay) / dispDur);
    const e = smooth01(td);
    // 消散**保持亮度**：前 `DOOR_DISP_FADE_START` 段透明度恒为 1（块仍明亮，靠数量减少 + 飞散表现），
    //   其后才快速收掉（单调不增 ⇒ 不闪；`td=1` 时恰好为 0 ⇒ 消散末全透明）。
    const fade = clamp01((td - DOOR_DISP_FADE_START) / Math.max(1e-6, 1 - DOOR_DISP_FADE_START));
    return {
      u: block.su + block.ddu * e,
      v: block.sv + block.ddv * e,
      z: block.ddz * e,
      opacity: 1 - smooth01(fade),
      spin: block.spinB * e,
      phase: 3,
    };
  }
  return { u: block.su + block.ddu, v: block.sv + block.ddv, z: block.ddz, opacity: 0, spin: block.spinB, phase: 4 };
}

/**
 * **开启动作**系数 0..1：组装阶段前 `DOOR_APERTURE_FRAC` 段内，门从"一条线"展开成完整矩形。
 * 渲染层用它缩放门框轮廓（竖向从 0 → 1）⇒ 有"开启"的动作感，而不是一开始就是个静态框。
 */
export function doorApertureK(elapsed: number, cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  const dur = Math.max(1e-6, cfg.assembleSec * DOOR_APERTURE_FRAC);
  return smooth01(clamp01(elapsed / dur));
}

/** **位面 / 外辉光**强度包络 0..1：组装后半段升起 → 完整期满亮 → 消散 + 余晖段淡出（余晖 = 残余）。 */
export function doorBarrierAmt(elapsed: number, cfg: DoorMotionCfg = DOOR_MOTION_DEFAULT): number {
  const holdStart = cfg.assembleSec;
  const dispStart = cfg.assembleSec + cfg.holdSec;
  const total = doorTotalSec(cfg);
  const rise = clamp01((elapsed - holdStart * 0.35) / Math.max(1e-6, holdStart * 0.65));
  const fall = 1 - clamp01((elapsed - dispStart) / Math.max(1e-6, total - dispStart));
  return Math.min(smooth01(rise), smooth01(fall));
}

/**
 * **扫描前沿光带**强度 0..1：门沿舰队纵轴推进（`p: 0→1`）时，前缘那条明亮光带的亮度。
 * 复用 `entryGlowAmt` 的两端起落语义（两端 0、中段 1）—— 由调用方传入门的进度 `p`。
 */
export function doorScanAmt(p: number): number {
  if (!(p > 0) || p >= 1) return 0;
  const rise = Math.min(1, p / 0.15);
  const fall = Math.min(1, (1 - p) / 0.15);
  return Math.max(0, Math.min(rise, fall));
}
