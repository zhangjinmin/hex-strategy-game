/**
 * StandoffOrder — 距离保持的「接近 / 悬停 / 倒车」三态（纯函数 · 零依赖）
 *
 * 为什么需要这个模块
 * ------------------
 * 现行交战机动把「保持理想距离」写成了一个**位置 waypoint**：
 *
 *     P = lead − idealDist · û          （û = 我 → 敌的单位向量）
 *     P − me = (d − idealDist) · û
 *
 * 于是只要 `d < idealDist`，目标点就翻到舰队**正后方**：
 *
 *     ┌──────────┬─────────┬──────────────┬──────────────┐
 *     │ d/ideal  │ dot 符号│ 目标相对敌舰 │ 舰首意向     │
 *     ├──────────┼─────────┼──────────────┼──────────────┤
 *     │  1.05    │    +    │ 前方         │ 0°（朝敌）   │
 *     │  1.00    │    0    │ 重合         │ 不定         │
 *     │  0.95    │    −    │ 正后方       │ 180°（背敌） │
 *     │  0.70    │    −    │ 正后方       │ 180°（背敌） │
 *     └──────────┴─────────┴──────────────┴──────────────┘
 *
 * （`dot` = dot(P − me, E − me)；`0.70` 是 `_mPhase 0→1` 的进入线，
 *   它必然已小于 `idealDist`，所以「进入缠斗」这一迁移必然伴随一次 180° 指令。）
 *
 * 结果就是：为了修正几 px 的距离误差，舰队被命令掉头 180°；掉头协议又要
 * `brake → turn → reform`（全程 `motion='hold'`），舰首转过去就停在一个
 * 打不出炮的方位上。这不是观感问题，是**停火**。
 *
 * 本模块把这段判定收成三态，**只回答"该接近 / 悬停 / 倒车"**，不产出坐标：
 *   · approach — 目标在敌前 idealDist 处（沿用既有公式，舰首=运动方向）；
 *   · hold     — 停在原地（目标=自身；舰首意向=敌向）；
 *   · reverse  — 位移向后（目标=身后），但**舰首意向=敌向**（倒退通道）。
 *
 * 三个刻意约束
 * ------------
 *   1. `deadband` 由调用方传入，本模块**不自己算 `0.05·idealDist`** ——
 *      `idealDist` 的口径（阶段驱动 + 射程夹逼）只有调用方知道，这里再算一次
 *      就是第二真源。
 *   2. `deadband <= 0` **显式拒绝**（返回 hold + `invalid-deadband`）。
 *      不静默当成 0：0 会让 `err` 在 0 附近逐帧变号，`moveAngle` 每帧 ±180°
 *      翻面，即便有倒车通道也会把速度矢量抖成噪声。
 *   3. 非有限值 / 负距离 / 非正 `idealDist` 一律退化为 hold（`invalid-input`），
 *      **绝不让 NaN 穿透到调用方的位姿计算**（本项目被 NaN 穿过一次，代价很大）。
 *
 * 与 FIX-⑫ 的关系
 * ---------------
 * 本模块**不需要**"停船回瞄"补丁：进入 hold 的两条路径都已经舰首朝敌 ——
 *   · 从 approach 进入：此前舰首 = 运动方向 = 敌向；
 *   · 从 reverse 进入：倒车通道本来就把舰首意向钉在敌向。
 * 因此撤下 FIX-⑫ 与接入本模块是自洽的。
 *
 * 未接线：本文件只提供纯判定；`BattleScene` 的唯一写者会在撤下 FIX-⑫ 之后
 * 消费 `kind` / `facingIntent`（本模块不 import 任何渲染、寻路、数值模块）。
 */

export type StandoffKind = 'approach' | 'hold' | 'reverse';

/** 舰首意向：`enemy` = 朝敌；`motion` = 与运动方向一致。 */
export type StandoffFacing = 'enemy' | 'motion';

export interface StandoffInput {
  /** 到交战对象的当前距离（px） */
  d: number;
  /** 期望保持的交战距离（px，由调用方的阶段机 + 射程夹逼给出） */
  idealDist: number;
  /** 悬停死区半宽（px，> 0；调用方按 `clamp(ratio·idealDist, min, max)` 给出） */
  deadband: number;
  /** 上一帧的三态（用于滞回；null = 首帧/无记忆） */
  prevKind: StandoffKind | null;
  /**
   * 强制本帧走 `reverse`（无视距离误差）。
   *
   * 用途只有一个：**放弃包抄后先把舰首拧回敌向**。包抄飞行段的舰首指向切向，
   * 若此时直接落 `hold`，舰首会被冻在舷侧（本工程的 `formFacing ≡ facingSmooth`，
   * 停住就没有任何写入点会把它转回来）⇒ 永久停火。
   * 借倒车通道（位移背离、舰首钉敌）转一次头，再落 `hold`，不需要新增朝向绑定。
   *
   * ⚠ 非法 `deadband` / 非法输入**优先于**本开关（不得用它掩盖入参错误）。
   * ⚠ 本开关不改变 `prevKind` 的滞回语义：置位期间恒为 `reverse`，撤销后按 `prevKind='reverse'` 走滞回退出。
   */
  forceReverse?: boolean;
}

export interface StandoffDecision {
  kind: StandoffKind;
  facingIntent: StandoffFacing;
  /** 可读短句，台架失败时直接读（不参与任何数值判定） */
  reason: string;
}

/** `reason` 的单一真源（台架按这些字符串断言，避免手写魔法串）。 */
export const STANDOFF_REASONS = {
  beyondIdeal: 'beyond-ideal',
  inBand: 'in-band',
  tooClose: 'too-close',
  holdExitHysteresis: 'hold-exit-hysteresis',
  invalidDeadband: 'invalid-deadband',
  invalidInput: 'invalid-input',
  forcedReverse: 'forced-reverse',
} as const;

/**
 * 单帧判定。
 *
 * 规则（`err = d − idealDist`，`half = deadband / 2`）：
 *   · `prev === 'reverse'`：`err > −half` ⇒ hold（滞回退出）；否则 reverse。
 *   · `prev === 'approach'`：`err < −deadband` ⇒ reverse；`err < +half` ⇒ hold；
 *     否则 approach。
 *   · `prev === 'hold'` / `null`：`err > +deadband` ⇒ approach；
 *     `err < −deadband` ⇒ reverse；否则 hold。
 *
 * 为什么是 `half` 而不是 `deadband` 做退出线：
 *   两侧都留半带 ⇒ 边界处不会"刚进带就反向"。例如从 reverse 回来，
 *   必须走到 `idealDist − deadband/2` 以上才转 hold，不会在 `−deadband`
 *   边缘来回翻面。
 *
 * 边界吸附：所有阈值比较都带一个 `1e-9 × 尺度` 的 ε。二进制浮点下
 * `0.95 · idealDist` 可能落在 `−deadband` 的外侧；ε 只把"数学上恰好等于
 * 边界"的那一层吸回带内，不改变任何非边界输入。
 *
 * ⚠ 契约是**非对称滞回**，不是「`|err| ≤ deadband` 就恒 hold」：
 *   · **进带**用半带（`|err| < deadband/2`）——从 approach / reverse 进来；
 *   · **出带**用全带（`err > +deadband` 才回 approach，`err < −deadband` 才转 reverse）。
 *   ⇒ 处于 `half ≤ |err| ≤ deadband` 时，**结果取决于 `prevKind`**：
 *     从外面进来的保持原态，已经在带内的保持 hold。
 *   这条不对称是有意的（进严出松防翻面），任何"简化成单阈值"的改动都会让边界逐帧抖。
 */
export function resolveStandoffOrder(input: StandoffInput): StandoffDecision {
  const { d, idealDist, deadband, prevKind } = input;

  const hold = (reason: string): StandoffDecision => ({
    kind: 'hold',
    facingIntent: 'enemy',
    reason,
  });

  // 退化路径：任何非有限/非正输入都收敛到 hold，绝不把 NaN 传下去。
  if (!Number.isFinite(d) || d < 0 || !Number.isFinite(idealDist) || idealDist <= 0) {
    return hold(STANDOFF_REASONS.invalidInput);
  }
  // 显式拒绝而不是静默当 0（理由见模块头 §2）。
  if (!Number.isFinite(deadband) || deadband <= 0) {
    return hold(STANDOFF_REASONS.invalidDeadband);
  }

  // 强制倒车（用于"放弃包抄后先转头"）。位置有意放在非法入参之后：
  //   入参错误必须显式暴露；而本开关一旦置位，应当压过距离误差。
  if (input.forceReverse === true) {
    return { kind: 'reverse', facingIntent: 'enemy', reason: STANDOFF_REASONS.forcedReverse };
  }

  // 运行时容错：非法 prevKind 一律当"无记忆"，不做任何推测。
  const prev: StandoffKind | null =
    prevKind === 'approach' || prevKind === 'hold' || prevKind === 'reverse' ? prevKind : null;

  const err = d - idealDist;
  const half = deadband / 2;
  // 边界用尺度相关 ε 吸附：`0.95·idealDist` 在二进制浮点里可能落在
  // `-deadband` 的**外侧**（实测 0.95*1000 = 949.9999999999999 ⇒ err 略小于 −50），
  // 若不吸附，"恰好等于死区边界"会被判成 reverse，与契约（|err| ≤ deadband ⇒ hold）
  // 不符。ε 只影响"数学上恰好等于边界"的那一层，不改变任何非边界输入。
  const eps = 1e-9 * Math.max(1, idealDist, d, deadband);
  const bandPos = deadband + eps;
  const bandNeg = -deadband - eps;
  const halfPos = half - eps;
  const halfNeg = -half + eps;

  if (prev === 'reverse') {
    return err > halfNeg
      ? hold(STANDOFF_REASONS.holdExitHysteresis)
      : { kind: 'reverse', facingIntent: 'enemy', reason: STANDOFF_REASONS.tooClose };
  }

  if (prev === 'approach') {
    if (err < bandNeg) {
      return { kind: 'reverse', facingIntent: 'enemy', reason: STANDOFF_REASONS.tooClose };
    }
    if (err < halfPos) return hold(STANDOFF_REASONS.holdExitHysteresis);
    return { kind: 'approach', facingIntent: 'motion', reason: STANDOFF_REASONS.beyondIdeal };
  }

  if (err > bandPos) {
    return { kind: 'approach', facingIntent: 'motion', reason: STANDOFF_REASONS.beyondIdeal };
  }
  if (err < bandNeg) {
    return { kind: 'reverse', facingIntent: 'enemy', reason: STANDOFF_REASONS.tooClose };
  }
  return hold(STANDOFF_REASONS.inBand);
}
