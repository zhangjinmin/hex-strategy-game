/**
 * 战术层「侧翼包抄」机动的**纯函数**单一真源（WS5）。
 *
 * 来源：battle-dot-demo/index.html 的 `SPLIT` / `splitGeom()` / `splitCentersFor(t)` /
 *       `splitMinClearance()` —— 逐条移植，只把 demo 的世界尺度换成游戏的真源尺度。
 *
 * 三幕（`t ∈ [0,1]` 的**纯函数**：无随机、无增量累积 ⇒ 可复现、可截图定点）：
 *   t = 0    对垒：各队各就原位（偏移恒为 0 ⇒ 端点精确）
 *   t ≈ 0.4  分裂：左右各半沿**横向轴**外移，中央让出 CHANNEL 宽的通道
 *   t = 1    包抄：沿弧线（sin 鼓包）前出到敌队后方，并向内收 ⇒ 钳形
 *
 * ⚠ 坐标约定（与 Battle3DOverlay 的 3D 世界一致，勿在此模块内做 2D↔3D 转换）：
 *   · 纵深轴 depth = 交战轴 = 世界 X（攻方在 −X，守方在 +X）
 *   · 横向轴  lat  = 世界 Z
 *   本模块只输出**整队中心的偏移量**（相对该队自己的原位），调用方叠加到该队所有单位的取景位上。
 *
 * ⚠ 只作为 **3D 视觉层**的整队偏移使用：BattleScene 的 2D 逻辑 / 命中判定 / 寻路
 *   保持平面，与 `fleetTierLayout` 的高度档同属"视觉层专属"。**不接任何玩法触发**
 *   （本轮约束：不新增玩法、2D 逻辑零改动）—— 由外部（验收口 / 未来产品决策）驱动 `t`。
 *
 * ── 尺度换算（同 fleetTierLayout 的口径）──────────────────────────────────────
 * demo 的滑杆是在它自己的世界尺度下调出来的（spacingBase = 1.6），故一律按
 * **该方实际生效间距 spacingEff** 的比例换算，绝不照搬绝对值：
 *   CHANNEL   6 /1.6 = 3.75   × spacingEff
 *   FINAL_GAP 3 /1.6 = 1.875  × spacingEff
 *   ARC       6 /1.6 = 3.75   × spacingEff
 *   LEAD      4 /1.6 = 2.5    × spacingEff
 *   T_SPLIT / SEC 无量纲，原样保留。
 */

/** 三幕常量（比值） + 动画时长（秒） */
export const SPLIT = {
  /** 分裂幕结束的归一化时间 */
  T_SPLIT: 0.4,
  /** t≈0.4 时两翼内缘之间让出的通道宽度（× spacingEff） */
  CHANNEL_K: 3.75,
  /** t=1 时两翼内缘之间的最小间隙（× spacingEff）—— >0 保证两翼不互穿 */
  FINAL_GAP_K: 1.875,
  /** 包抄途中的弧线外鼓量（× spacingEff；b=0/1 时为 0，只影响中间帧 ⇒ 端点精确） */
  ARC_K: 3.75,
  /** 到位后我方队心再越过敌队后缘的余量（× spacingEff） */
  LEAD_K: 2.5,
  /** 动画时长（秒） */
  SEC: 4.0,
} as const;

/** 参与机动的一支舰队的几何摘要 */
export interface SplitFleetGeom {
  /** 稳定标识（调用方给；一般 = 舰队 id） */
  id: number;
  /** 队心：纵深（世界 X） */
  depth: number;
  /** 阵型足迹的半宽（横向半跨，世界单位） */
  halfW: number;
  /** 阵型足迹的半深（纵深半跨，世界单位） */
  halfD: number;
}

/** `splitGeom()` 的产物：一次算好、供三幕复用（全部为世界单位） */
export interface SplitGeom {
  /** 我方各队最大横向足迹（= max 2×halfW） */
  footW: number;
  /** 我方各队最大纵深足迹（= max 2×halfD） */
  footD: number;
  /** 敌队沿纵深轴最靠后的后缘位置 */
  enemyRear: number;
  /** t≈0.4 时的两翼中心横向偏移量 */
  latSplit: number;
  /** t=1 时的两翼中心横向偏移量 */
  latFinal: number;
  /** 包抄终点：我方队心应到达的纵深位置 */
  depthEnd: number;
}

const smooth01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * 机动几何：**全部从当前阵型的实际足迹派生**（换阵型自动跟随，不另设参数）。
 * @param own    我方诸队（≥1）
 * @param enemy  敌方诸队（≥1）
 * @param spacingEff 该方实际生效格距（= fleet._formSpacing ?? formationSpacing(offs, hexR)）
 */
export function splitGeom(own: SplitFleetGeom[], enemy: SplitFleetGeom[], spacingEff: number): SplitGeom {
  let footW = 0, footD = 0;
  for (const f of own) {
    footW = Math.max(footW, 2 * f.halfW);
    footD = Math.max(footD, 2 * f.halfD);
  }
  let enemyRear = -Infinity;
  for (const f of enemy) enemyRear = Math.max(enemyRear, f.depth + f.halfD);
  if (!Number.isFinite(enemyRear)) enemyRear = 0;

  const s = Math.max(1e-6, spacingEff);
  return {
    footW, footD, enemyRear,
    latSplit: footW / 2 + (SPLIT.CHANNEL_K * s) / 2,
    latFinal: footW / 2 + (SPLIT.FINAL_GAP_K * s) / 2,
    depthEnd: enemyRear + footD / 2 + SPLIT.LEAD_K * s,
  };
}

/**
 * 纯函数：`t → 我方各队队心偏移`（相对各队**原位**）。除 `geoms` 外**不读任何可变状态**。
 * 返回与 `own` 同序：`{ id, lat, depth }`，调用方把它叠加到该队所有单位的取景位上。
 *
 * 分翼：`own` 的前半（索引 < ceil(len/2)）为左翼（sg = −1），其余为右翼（sg = +1）。
 * 端点性质：`t = 0 ⇒ {0, 0}`（精确原位）；`t = 1 ⇒ {±latFinal, depthEnd − 本队纵深}`（精确落位）。
 */
export function splitOffsetsFor(
  t: number,
  geoms: SplitGeom,
  own: SplitFleetGeom[],
  spacingEff: number,
): Array<{ id: number; lat: number; depth: number }> {
  const u = Math.max(0, Math.min(1, t));
  const a = smooth01(u / SPLIT.T_SPLIT);                            // 分裂进度
  const b = smooth01((u - SPLIT.T_SPLIT) / (1 - SPLIT.T_SPLIT));    // 包抄进度
  const arc = SPLIT.ARC_K * Math.max(1e-6, spacingEff);
  const half = Math.ceil(own.length / 2);

  return own.map((f, i) => {
    const sg = i < half ? -1 : 1;                                   // 左翼 / 右翼
    const lat = sg * (geoms.latSplit + (geoms.latFinal - geoms.latSplit) * b
      + arc * Math.sin(Math.PI * b)) * a;
    const depth = (geoms.depthEnd - f.depth) * b;
    return { id: f.id, lat, depth };
  });
}

/**
 * `t ∈ [T_SPLIT, 1]` 全程两翼内缘之间的**最小间隙**（> 0 才不互穿）。
 *
 * 闭式：`clearance(b) = 2·|lat(b)| − footW = CHANNEL + (FINAL_GAP − CHANNEL)·b + 2·ARC·sin(πb)`
 * 导数 = `(FINAL_GAP − CHANNEL) + 2·ARC·π·cos(πb)`；因 `CHANNEL > FINAL_GAP` 且 ARC 鼓包在中段
 * （b≈0.47）形成**局部极大** ⇒ 全局最小落在端点 `b = 1` ⇒ `clearance_min = FINAL_GAP`。
 * 本函数按数值扫描实现（与 demo 同构）用于**独立复核**闭式结论。
 */
export function splitMinClearance(geoms: SplitGeom, spacingEff: number, samples = 100): number {
  const arc = SPLIT.ARC_K * Math.max(1e-6, spacingEff);
  let m = Infinity;
  for (let i = 0; i <= samples; i++) {
    const b = SPLIT.T_SPLIT + (1 - SPLIT.T_SPLIT) * (i / samples);   // a = 1（u ≥ T_SPLIT）
    const latAbs = geoms.latSplit + (geoms.latFinal - geoms.latSplit) * b + arc * Math.sin(Math.PI * b);
    m = Math.min(m, 2 * latAbs - geoms.footW);
  }
  return m;
}

/** 闭式最小间隙（世界单位）：`FINAL_GAP_K × spacingEff`。断言"数值扫描 == 闭式"用。 */
export function splitMinClearanceClosedForm(spacingEff: number): number {
  return SPLIT.FINAL_GAP_K * Math.max(1e-6, spacingEff);
}

/** 由阵型半跨（单位 = 格位：halfGx = 纵深轴、halfGy = 横向轴）与格距求足迹半宽/半深（世界单位） */
export function splitFootprint(halfGx: number, halfGy: number, spacingEff: number): { halfW: number; halfD: number } {
  return { halfW: halfGy * spacingEff, halfD: halfGx * spacingEff };
}
