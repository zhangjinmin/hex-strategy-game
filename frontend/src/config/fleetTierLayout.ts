/**
 * 战术层「队内分层（层数/层距）」+「队间叠层（档数/档距）」的**单一真源**。
 *
 * 这是 battle-dot-demo 里 `TEAM_LAYERS / LAYER_GAP / TEAM_GAP / YS` 四件套在游戏侧的等价物。
 * 为什么单独立一个文件：阵型**平面**排布的真源是 `formationLayout.ts`（gx/gy 格位），
 * 而这里是第三个维度（世界 Y）的两级叠层 —— 二者正交、消费者也不同的模块，
 * 混在一个文件里会让"改层数顺手改了格距"这类事故变得可能。
 *
 * 两级叠层的语义（务必分清）：
 *   · 队内 LAYER_GAP：**同一支分舰队**内部，各舰按 (排号, 排内序号) 用 R2 低差异序列
 *     **去相关**地分到 L 层；L 本身由平面足迹推导（见 layerCountForFootprint）。
 *     （偏移乘数由 formationLayout.formationLayerOffsets 给，本文件只给"1 个层距 = 多少世界单位"。）
 *   · 队间 TEAM_GAP：**同一方**的若干支分舰队各占一个"高度档"，居中分布，档间错开 TEAM_GAP。
 *
 * ── 换算约束（用户从 demo 定的滑杆 → 游戏世界单位）────────────────────────────
 * demo 的滑杆是在**自己的世界尺度**下调出来的：spacingBase=1.6、LAYER_GAP=0.5、TEAM_GAP=4.0、
 * 舰长 SHIP_LEN=1.27（≈ 1.27 × hexR）。游戏 FORMATION_SPACING=26 是**像素**，对应的战列舰长
 * = 0.733×√3×hexR×SHIP_VISUAL_SCALE（hexR=50、Battle3DOverlay.SHIP_VISUAL_SCALE=0.40
 * ⇒ 63.5×0.40 ≈ 25.4px ≈ 格距 26），即游戏编队比 demo 密得多，**绝不能照搬绝对值**。
 * ⚠ 本段历史上写过 `FORMATION_SPACING=28` 且舰长 63.5px（漏乘 SHIP_VISUAL_SCALE），
 *   两处均已按单一真源订正；改格距或改 SHIP_VISUAL_SCALE 时请一并回看此处。
 * 因此纵向偏移一律按"该队实际生效间距 spacingEff（= fleet._formSpacing ?? formationSpacing(offs,hexR)）"
 * 的比例换算：
 *   LAYER_GAP 比值 = 0.5 / 1.6 = 0.3125 × spacingEff
 *   TEAM_GAP  比值 = 4.0 / 1.6 = 2.5    × spacingEff
 * 但同时必须过**几何下限**，否则上下层/上下档的舰体互穿（见下）。
 *
 * ── LAYER_GAP 的几何下限（关键推导）──────────────────────────────────────────
 * demo 的 0.5 不是自由选的：它的舰体高 ≈ SHIP_LEN/2 = 0.635（demo 自己在 boardGap 公式里用的
 * "板厚"），故 demo 的 LAYER_GAP/modelH = 0.5/0.635 = 0.787；同时 0.5/1.6 = 0.3125。
 * ⇒ 推广为 LAYER_GAP = max(0.3125 × spacingEff, SAFE × maxShipH)。
 *
 * ⚠ SAFE 必须 > 1，否则上下层在深度上**互相穿插**。
 *   旧值 0.8（照抄 demo 的 0.787，但误当成"安全系数"）在游戏尺度上直接翻车：
 *   战列舰高 12.99（hexR=50，未缩舰）、0.8×12.99 = 10.39 < 12.99 ⇒ 层距 < 舰高 ⇒
 *   5 层糊成一块厚板 —— 这正是用户实报的"只有单层 / 阶梯状的 5 层"。
 *   现取 1.2：层与层之间留 0.2×舰高的净空，读得出"一层一层"，且不浪费纵向。
 *
 * 实算（hexR=50，spacingEff=26，SHIP_VISUAL_SCALE=0.40 ⇒ 最高舰 carrier H = 5.89）：
 *   0.3125×26 = 8.13 ｜ 1.2×5.89 = 7.07 ⇒ LAYER_GAP = 8.13（**比例项胜出** —— 缩舰后才成立，
 *   缩舰前是几何下限胜出、且小于舰高）。层距 8.13 vs 舰高 5.89 ⇒ 净空 2.24 ✓
 *
 * ── TEAM_GAP 的间隙校验（demo 判据 boardGap = TEAM_GAP − 厚度 − 体高 > 0）──────
 * 厚度 = (L−1) × LAYER_GAP（队内最高层到最低层）。取
 *   TEAM_GAP = max(2.5 × spacingEff, 厚度 + 1.5 × maxShipH)
 * 后一项保证 boardGap ≥ 0.5 × maxShipH > 0。实算（carrier 队，L=16）：
 *   厚度 = 15×8.13 = 121.9；2.5×26 = 65；121.9+1.5×5.89 = 130.7 ⇒ TEAM_GAP = 130.7，
 *   boardGap = 130.7 − 121.9 − 5.89 = 2.9 > 0 ✓
 *
 * ⚠ 纵向包络（厚度 + (档数−1)×档距 ≈ 121.9 + 2×130.7 = 383）会**抬升巡航高度**：
 *   见 Battle3DOverlay.computeCruiseClearance()，否则最下面那一档会沉到地形以下。
 *
 * ⚠ 这两条高度只施加在 **3D 视觉层**：BattleScene（2D 逻辑/命中/寻路）保持平面，
 *   纵向分层**不参与命中判定**（见 docs/design/3d-tactical-battle/12-grand-fleet-formation.md）。
 */

/**
 * 队内垂直层数的**上限（cap）**。
 *
 * ⚠ 语义已变更：**实际层数不再等于本值**，而由 `layerCountForFootprint()` 按该舰队的
 *   平面足迹推导（≤ 本值）。原因（用户实机报障）：本值被恒定施加时，平面足迹小的舰队
 *   纵向远超水平跨 ⇒ 成了"竖直的针"（`line n=12`：纵 89.4 vs 横跨 26，`thin` = 3.4）。
 *   独立台架实测：只换分层算法（R2）修不掉这一条 —— `line n=20` 的 `thin` 反而从 1.72
 *   升到 2.19。必须同时让层数随足迹收缩。
 *
 * 演进：demo 默认 3 → 用户定 5（"队内5层，3级"）→ 用户实机看到"阶梯状的 5 层、不是密密麻麻的很多层"
 * 后再定 **16**。层数能与"缩舰"配合的前提是层距由比例项决定（见上方推导）：
 * 缩舰前层距被几何下限顶到 ≈ 舰高，"加层数"只会让整块板不断变厚；缩舰后层距 = 0.3125×格距，
 * 16 层总厚仅 121.9 世界单位（≈ 4.7 个格距，而 120 舰舰队横向足迹 ≈ 11×26 = 286），
 * 才开始读得出"密集多层的军团"（厚:宽 ≈ 1:2.3）。
 *
 * 大编队（足迹大到被本值封顶）会停在"宽扁板"形态 —— 这是**设计意图**：
 * 正面宽度是舰队规模的主要可读信号，纵向无限增长只会让它读起来像"塔"而不是"军团"。
 */
export const TEAM_LAYERS = 16;

/** 队间最多档数。每方参战舰队按高度分成最多 3 档（用户原话"队内5层，3级"）。 */
export const TIER_MAX = 3;

/** LAYER_GAP = 0.3125 × spacingEff（demo 0.5/1.6）。 */
export const LAYER_GAP_K = 0.3125;
/** LAYER_GAP 的几何下限系数：必须 > 1，否则层间深度互穿（旧值 0.8 是 bug，见上方推导）。 */
export const LAYER_SHIP_H_SAFE = 1.2;
/** TEAM_GAP = 2.5 × spacingEff（demo 4.0/1.6）。 */
export const TIER_GAP_K = 2.5;
/** TEAM_GAP 的间隙下限系数：TEAM_GAP ≥ 厚度 + 1.5×体高 ⇒ boardGap ≥ 0.5×体高。 */
export const TIER_BOARD_GAP_K = 1.5;

/**
 * 换阵/换档的**纵向**过渡时长（秒，WS6）。
 *
 * 平面（横向）迁移由 BattleScene.update() 既有的阻尼 lerp 负责
 * （`unitLerp = min(0.08, uDist×0.003)` ⇒ 约 0.4s 收敛），3D 层每帧读 `sprite.x/y` 自动继承。
 * 纵向（队内层 + 队间档）是 3D 层独占的，必须在这里定一个等价的时间常数：
 * 指数平滑在 3τ 处到达 ~95%，故 `TAU = SEC/3` ⇒ 0.4s 收敛，与平面迁移同步。
 */
export const FORM_ANIM_SEC = 0.4;
/** 纵向指数平滑时间常数（秒）= FORM_ANIM_SEC / 3。 */
export const FORM_ANIM_TAU = FORM_ANIM_SEC / 3;

/**
 * 队内层距（世界单位）＝ max(ratio 换算, 几何下限)。
 * @param spacingEff 该舰队实际生效格距（= fleet._formSpacing ?? formationSpacing(offs, hexR)）
 * @param maxShipH   该舰队最高舰体的世界高度（= max dimsOf(t).H）
 */
export function layerGapFor(spacingEff: number, maxShipH: number): number {
  const ratio = LAYER_GAP_K * spacingEff;
  const floor = LAYER_SHIP_H_SAFE * maxShipH;
  return Math.max(ratio, floor);
}

/**
 * 纵向厚度相对平面**最薄跨**的比例（K = 1.0 ⇒ 厚度 ≈ 平面最薄跨）。
 *
 * 依据（第一性原理）：3D 阵型要"从任何角度都是一个有体积的块"，纵向跨必须与水平跨
 * 同量级 —— 与"平面各向同性"是同一个诉求，故取 1.0。
 * 调小时舰队会读作"薄板"（俯视清楚、侧视变扁）；调大时会读作"柱"（侧视清楚、俯视变糊）。
 */
export const LAYER_COUNT_K = 1.0;

/**
 * 由**平面足迹**推导的队内层数。
 *
 * 为什么要随足迹走（用户实机报障）：`TEAM_LAYERS = 16` 恒被施加时，平面足迹小的舰队
 * 纵向远超水平跨 ⇒ 成了"竖直的针"（`line n=12`：纵 89.4 vs 横跨 26，`thin` = 3.4）。
 * 独立台架实测（`_v8c_final.log`）：只换分层算法（R2）修不掉这一条 ——
 * `line n=20` 的 `thin` 反而从 1.72 升到 2.19。必须同时让层数随足迹收缩。
 *
 * 取 `min(widCells, depCells)`（平面**最薄**方向）而非最大方向：厚度对齐最薄跨 ⇒
 * 三个轴向跨度同量级 ⇒ 各视角投影都不退化。用最大方向会让扁长阵型（line/spindle）
 * 越叠越高。
 *
 * @param fp         平面足迹（formationLayout.formationFootprint 的输出）
 * @param spacingEff 该舰队实际生效格距
 * @param layerGap   该舰队实际生效层距（layerGapFor 的输出）
 * @param cap        层数上限，默认 TEAM_LAYERS
 */
export function layerCountForFootprint(
  fp: { widCells: number; depCells: number },
  spacingEff: number,
  layerGap: number,
  cap = TEAM_LAYERS,
): number {
  const minSpan = Math.min(fp.widCells, fp.depCells) * spacingEff;
  const raw = 1 + Math.round(LAYER_COUNT_K * minSpan / Math.max(1e-6, layerGap));
  return Math.max(1, Math.min(cap, raw));
}

/**
 * 队间档距（世界单位）＝ max(ratio 换算, 厚度 + 1.5×体高)。
 * 调用方请**按"一方"取各舰队的最大值**再统一用，否则同方不同队会落在不等距的档上。
 * @param spacingEff 该舰队实际生效格距
 * @param layerGap   该舰队的队内层距（layerGapFor 的输出）
 * @param maxShipH   该舰队最高舰体的世界高度
 * @param layers     该舰队的有效层数 Leff（= min(TEAM_LAYERS, 实体数)）
 */
export function teamGapFor(spacingEff: number, layerGap: number, maxShipH: number, layers = TEAM_LAYERS): number {
  const thickness = Math.max(0, layers - 1) * layerGap;
  const ratio = TIER_GAP_K * spacingEff;
  const need = thickness + TIER_BOARD_GAP_K * maxShipH;
  return Math.max(ratio, need);
}

/**
 * 队间档位高度乘数（居中、对称）。tiers 档 ⇒ 第 k 档 = k − (tiers−1)/2。
 *   tiers=3 → [-1, 0, +1]（用户指定：3 档时 y = [-1,0,+1] × TEAM_GAP）
 *   tiers=2 → [-0.5, +0.5]；tiers=1 → [0]
 */
export function tierMultipliers(tiers: number): number[] {
  const T = Math.max(1, Math.floor(tiers));
  const out: number[] = [];
  for (let k = 0; k < T; k++) out.push(k - (T - 1) / 2);
  return out;
}

/** 单档的高度乘数（等价于 tierMultipliers(tiers)[k]）。 */
export function tierOffsetOf(tier: number, tiers: number): number {
  const T = Math.max(1, Math.floor(tiers));
  return Math.max(0, Math.min(T - 1, Math.floor(tier))) - (T - 1) / 2;
}

/**
 * 舰队序号 → 档位号：round-robin（i % tiers），保证相邻舰队落在不同档、各档舰队数尽量均衡。
 * 纯整数、确定性（同输入同输出，不引入随机；否则每帧重算会闪）。
 * 例：6 队 3 档 → 0,1,2,0,1,2；4 队 3 档 → 0,1,2,0。
 */
export function tierIndexOf(index: number, tiers: number): number {
  const T = Math.max(1, Math.floor(tiers));
  return ((Math.floor(index) % T) + T) % T;
}

/** 每方参战舰队数 → 实际档数（≤ TIER_MAX，且不超过舰队数）。 */
export function tierCountFor(fleetCount: number): number {
  return Math.max(1, Math.min(TIER_MAX, Math.floor(fleetCount)));
}
