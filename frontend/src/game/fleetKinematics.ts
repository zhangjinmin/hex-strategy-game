/**
 * Shared low-level motion rules for tactical entities.
 *
 * Positions are advanced by a fixed per-tick budget. A destination changing
 * far away is never permission to move faster; it only lengthens the trip.
 */
export interface Point {
  x: number;
  y: number;
}

export function moveTowardsAtSpeed(current: Point, target: Point, maxStep: number): Point {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || maxStep <= 0) return { x: current.x, y: current.y };
  const step = Math.min(distance, maxStep);
  return { x: current.x + dx / distance * step, y: current.y + dy / distance * step };
}

/** Move an orientation towards its target via the shortest arc, with no jump. */
export function advanceFormationFacing(current: number, target: number, maxStep: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  if (Math.abs(delta) <= maxStep) return current + delta;
  return current + Math.sign(delta) * Math.max(0, maxStep);
}

/** Absolute wrapped difference between two headings. */
export function headingDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/**
 * 前置追踪（lead pursuit / intercept course）：预测匀速运动目标在我方抵达时刻的位置。
 *
 * 追尾式纯追踪（朝目标当前位置走）对横向机动目标永远在"擦肩而过-再折返"，
 * 截获时间劣于前置追踪（业界通行做法：飞行模拟/RTS 拦截几何）。
 *
 * 口径：所有速度量均为**每帧像素位移**（与 `fleet.vx` / `dt` 缩放口径一致，
 * 见 BattleScene 惯性模型 `fleet.x += fleet.vx`）；`closingSpeedPerFrame` = 我方每帧位移。
 * 预测时间 t（帧）以相对速度迭代 2 步收敛（纯追踪 → 前置追踪切换），
 * 并以 `maxLeadFrames` 封顶预测视界 —— 低速远距追击不许把预测点推到地图外。
 * 我方近停（closingSpeed ≈ 0）时退化为纯追踪（返回目标当前位置）。
 */
export function leadInterceptPoint(
  me: Point,
  target: Point,
  targetVel: Point,
  closingSpeedPerFrame: number,
  maxLeadFrames = 90,
): Point {
  if (!(closingSpeedPerFrame > 1e-6)) return { x: target.x, y: target.y };
  let t = Math.hypot(target.x - me.x, target.y - me.y) / closingSpeedPerFrame;
  for (let i = 0; i < 2; i++) {
    const px = target.x + targetVel.x * t;
    const py = target.y + targetVel.y * t;
    t = Math.hypot(px - me.x, py - me.y) / closingSpeedPerFrame;
  }
  const tc = Math.min(t, maxLeadFrames);
  return { x: target.x + targetVel.x * tc, y: target.y + targetVel.y * tc };
}

/* ══════════════════════════════════════════════════════════════════════════
 * [P2] 舰级六方向加速度向量运动学（29 号方案 §6.2 落地）
 *
 * 六方向定义（H1 裁定）：六角格 6 轴向基底 e_0..e_5（k·π/3）。
 *   v = Σ s_i·e_i（连续合成，六角轴向作基底；2D 过完备基底下与向量形式数学等价，
 *   `hexAxisComponents`/`hexAxisCompose` 保留分解/合成契约供台架断言基底完备性）。
 *
 * 物理约束（两层，缺一不可）：
 *   · |dv/dt| ≤ accel        —— 推力上限（质量感）
 *   · |d(θ_v)/dt| ≤ omegaMax —— 操纵性上限（大船不能瞬间甩头改向）
 *
 * 期望速度 = **目标点速度前馈 + Arrive 制动项**（gdx-ai Arrive/Pursue 公式族）：
 *   · 前馈 = 布阵「到槽时间提前转向」的控制论实现：槽位随舰队横移时，
 *     期望速度立即含横移分量 ⇒ 船头提前响应，不再"目标跑了再追"；
 *   · Arrive 项 = 临界制动律 `min(maxSpeed, c·sqrt(2·a·d))`（c=0.85 安全系数，
 *     与 v29 BRAKE_SAFETY 同思想）⇒ 连续模型零超调、离散化余量吸收 ⇒
 *     到位漂移 < 0.3 槽宽有数学保证。
 *
 * ⚠ 口径：速度均为 px/帧@dt=1（与 BattleScene 位移预算一致），dt=速度倍率。
 * ⚠ 拖刀/顶敌倒退的"位移≠舰首"语义不进本模块——那是 visHeading 刚性例外
 *   （v47）的职责；本模块只管位移积分，朝向真源保持单一（visHeading）。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 六角 6 轴向单位向量 e_0..e_5（角度 k·π/3，e_0 沿 +X）。 */
export const HEX_AXES: readonly Point[] = Object.freeze(
  Array.from({ length: 6 }, (_, k) => {
    const a = (k * Math.PI) / 3;
    return Object.freeze({ x: Math.cos(a), y: Math.sin(a) }) as Point;
  }),
);

/**
 * 速度 → 六角轴向分量（**最小范数分解**）。
 * ⚠ 6 轴向是 2D 过完备基底：朴素投影 s_i = v·e_i 合成得 3v（Σ e_i e_iᵀ = 3I），
 *   须取 s_i = (v·e_i)/3 才满足 v = Σ s_i·e_i（伪逆解）。
 */
export function hexAxisComponents(v: Point): number[] {
  return HEX_AXES.map((e) => (v.x * e.x + v.y * e.y) / 3);
}

/** 六角轴向分量 → 速度 v = Σ s_i·e_i（与 hexAxisComponents 互逆：compose∘decompose = id）。 */
export function hexAxisCompose(s: readonly number[]): Point {
  let x = 0; let y = 0;
  for (let k = 0; k < 6; k++) {
    const sk = s[k] || 0;
    x += sk * HEX_AXES[k].x;
    y += sk * HEX_AXES[k].y;
  }
  return { x, y };
}

/** 舰级运动状态（零实例状态铁律：状态由调用方存单位字段，本模块只做纯函数推进）。 */
export interface ShipMotionState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ShipMotionLimits {
  /** 速度上限（px/帧@dt=1） */
  maxSpeed: number;
  /** 加速度向量上限 |dv/dt|（px/帧²） */
  accel: number;
  /** 速度方向转速上限 ω_max（rad/帧）：操纵性约束，独立于 accel */
  omegaMax: number;
}

export interface ShipMotionInput {
  /** 追踪目标点（阵位槽；调用方可先叠加提前量） */
  targetX: number;
  targetY: number;
  /** 目标点速度（前馈项，px/帧；静止目标传 0/缺省） */
  targetVx?: number;
  targetVy?: number;
}

/** Arrive 制动律的安全系数（与 BRAKE_SAFETY=0.85 同源：吸收离散化误差）。 */
export const ARRIVE_BRAKE_SAFETY = 0.85;
/**
 * 到位死区（px）：小于此时视为已贴合，Arrive 项清零、期望速度 = 纯槽速前馈。
 * ⚠ 0.5 → 2.5 的由来（_diag_p2flip 取证）：修正向量绕槽旋转率 v/d 在小半径远超 ω_max
 *   ⇒ 舰被修正项拖着「绕槽螺旋」，航向以 ω_max 来回扫（可见懒摆）且要 ~110 帧才衰减。
 *   死区必须覆盖螺旋半径（实测 0.4~3.5px）：入区后修正项关闭 ⇒ 期望速度 = 槽速（恒定方向），
 *   速度匹配经 accel 单调收敛、位置误差冻结在区内 ⇒ 无环。
 *   v21「死区极限环」不回潮的原因：前馈使贴槽舰仍随槽全速移动（旧病是死区内完全停动）。
 *   代价 = 阵位残差 ≤ ~2.5px（≈0.1 槽宽，远小于 0.3 槽宽超调预算 7.8px）。
 */
export const ARRIVE_EPS = 2.5;

/**
 * 舰级运动推进（纯函数）：期望速度 = 目标速度前馈 + Arrive 制动项，
 * 经 |dv/dt| ≤ accel 与速度方向转速 ≤ omegaMax 双重约束后积分位置。
 */
export function stepShipMotion(
  state: ShipMotionState,
  input: ShipMotionInput,
  limits: ShipMotionLimits,
  dt: number,
): ShipMotionState {
  const { maxSpeed, accel, omegaMax } = limits;
  const step = Math.max(0, dt);
  const dx = input.targetX - state.x;
  const dy = input.targetY - state.y;
  const dist = Math.hypot(dx, dy);

  // ① Arrive 制动项：v_allow = c·sqrt(2·a·d)（临界刹停速度），远距封顶 maxSpeed
  let ax = 0; let ay = 0;
  if (dist > ARRIVE_EPS) {
    const vAllow = Math.min(maxSpeed, ARRIVE_BRAKE_SAFETY * Math.sqrt(2 * accel * dist));
    ax = (dx / dist) * vAllow;
    ay = (dy / dist) * vAllow;
  }

  // ② 前馈：目标点自身速度（槽位随舰队运动时"到槽时间提前转向"）
  let desX = ax + (input.targetVx || 0);
  let desY = ay + (input.targetVy || 0);
  const desMag = Math.hypot(desX, desY);
  if (desMag > maxSpeed) { desX = (desX / desMag) * maxSpeed; desY = (desY / desMag) * maxSpeed; }

  // ③ 加速度约束：|dv| ≤ accel·dt
  let dvx = desX - state.vx;
  let dvy = desY - state.vy;
  const dvMag = Math.hypot(dvx, dvy);
  const dvCap = accel * step;
  if (dvMag > dvCap && dvMag > 0) { dvx = (dvx / dvMag) * dvCap; dvy = (dvy / dvMag) * dvCap; }
  let vx = state.vx + dvx;
  let vy = state.vy + dvy;

  // ④ 操纵性约束：速度方向每帧转角 ≤ omegaMax·dt（幅值保留）。
  // ⚠ 生效门槛 = 一帧加速度预算 accel·step（不是 1e-6）：|dv| ≤ accel·step 时
  //   dot(v0,v1) ≥ sp0·(sp0 − accel·step) > 0（sp0 > 门槛 ⇒ 转角必 < 90°，
  //   atan2 的 π 奇异只可能出现在门槛以下的近零速区）。近零速"方向"无物理意义，
  //   原地换向不需转弯半径 ⇒ 约束须退化为无约束，否则速度反向被误判成 180° 转向
  //   钳回原方向、蠕行渐远（_probe_p2motion.cjs 场景 C 实证）。
  const sp0 = Math.hypot(state.vx, state.vy);
  const sp1 = Math.hypot(vx, vy);
  const speedGate = accel * step;
  if (sp0 > speedGate && sp1 > speedGate) {
    const turn = Math.atan2(state.vx * vy - state.vy * vx, state.vx * vx + state.vy * vy);
    const cap = omegaMax * step;
    if (Math.abs(turn) > cap) {
      const targetAngle = Math.atan2(state.vy, state.vx) + Math.sign(turn) * cap;
      vx = Math.cos(targetAngle) * sp1;
      vy = Math.sin(targetAngle) * sp1;
    }
  }

  return { x: state.x + vx * step, y: state.y + vy * step, vx, vy };
}

/**
 * [v100] **阵位追踪预算**（追赶预算，单一真源）。
 *
 * ── 为什么 0.9 追不上 ────────────────────────────────────────────────────────
 * 阵位目标（槽位）随舰队机动而移动，其横向摆速 ≈ ω × r（舰队转向角速率 × 槽位臂长）。
 * 大舰队外缘槽臂 300px、转向 ω≈0.02 rad/帧 ⇒ 槽位摆速 ~6px/帧，是
 * `UNIT_MOTION_LIMITS.maxSpeed = 0.9`（"阵位内相对机动"上限）的 ~7 倍。
 * 舰队巡航时上面叠加 `_fleetSpd` 尚可覆盖；**舰队一停（vx/vy≈0）**，叠加项消失，
 * 船以 0.9px/帧去追一个刚才以 6px/帧移动过的槽位 ⇒ 每次机动欠下数百 px 残差，
 * 要爬数百帧才收敛 —— 表现即"排头一艘、中间空一段、后面一截"（转向中）与
 * "偶尔自行变正常"（残差终于爬完）。
 *
 * ── 方案：残差自适应预算 ─────────────────────────────────────────────────────
 * 以**当前位置到槽位的距离**（slotGapPx）为自变量放大预算：
 *   · gap ≤ SMALL（15px ≈ 0.6 槽宽）：逐位还原 `base`（不引入任何行为变化）；
 *   · gap > SMALL：预算 = base + (gap − SMALL) × GAIN（线性放大；追赶期仍受
 *     accel / omegaMax 约束 —— 速度从 0 起步，accel 决定"多久能追上"，不会瞬移）；
 *   · 追近后预算自动回落 ⇒ 稳态行为与旧实现相同（残差冻结在 ARRIVE_EPS 附近）。
 * 舰队巡航叠加（`+ fleetSpd`）在调用方继续生效：预算 = 本函数结果 + fleetSpd。
 *
 * ⚠ 这是纯函数：同输入恒同输出，台架可直接 require 断言"312px 残差的新旧收敛帧数夹逼"。
 *
 * @param base      基础相对机动上限（= UNIT_MOTION_LIMITS.maxSpeed，禁手抄）
 * @param slotGapPx 当前船位到槽位的距离（px）
 */
export function slotTrackingMaxSpeed(base: number, slotGapPx: number): number {
  const gap = Number(slotGapPx);
  if (!Number.isFinite(gap) || gap <= SLOT_TRACK_SMALL_GAP) return base;
  return base + (gap - SLOT_TRACK_SMALL_GAP) * SLOT_TRACK_CATCHUP_GAIN;
}
/** 残差低于此值（px）不放大预算（≈0.6 槽宽；稳态 ARRIVE_EPS=2.5 远小于它 ⇒ 零行为变化）。 */
export const SLOT_TRACK_SMALL_GAP = 15;
/** 追赶增益：每 1px 残差追加的预算（px/帧）。0.12 ⇒ 312px 残差首帧预算 ≈ 0.9 + 35.6。 */
export const SLOT_TRACK_CATCHUP_GAIN = 0.12;

/**
 * [P2] 舰级运动参数（单一真源；BattleScene 引用，台架同源断言——禁手抄常量）。
 *
 * 自洽验算（dt=1，槽距 FORMATION_SPACING=26）：
 *   · 刹停距离 v²/2a = 0.81/0.12 = 6.75px < 0.3 槽宽 = 7.8px ⇒ 到位超调预算有余量；
 *   · 最小转弯半径 v/ω = 0.9/0.03 = 30px ≈ 1.2 舰长（25px）⇒ 划弧而非原地打转；
 *   · 0→满速 0.9 需 15 帧（0.25s@60fps）⇒ 质量感不迟钝；
 *   · 舰首跟随率 0.16 ≫ ω_max 0.03 ⇒ 侧滑滞后角有界（P95 < 15° 判据的结构性保证）。
 */
export const UNIT_MOTION_LIMITS: ShipMotionLimits = Object.freeze({
  /** 阵位移动硬速度上限（px/帧@dt=1），沿用 UNIT_FORMATION_SPEED 口径 */
  maxSpeed: 0.9,
  /** 舰级加速度向量上限 |dv/dt|（px/帧²）：**阵位保持带宽**（不是舰队机动性）。
   *  [v108] 0.06 → **0.28**。
   *  量化复盘（`_probe_snake.cjs`，n=300 / hexR=74 / 战列 12.7°/s 转向）：
   *    0.06 ⇒ 队形刚体残差峰值 **9.1% 半跨**、尾舰滞后 **168px**、转向后 **>480 帧仍不回稳**；
   *    0.28 ⇒ **2.4%**、滞后 36px、**108 帧回稳**。
   *  即：0.06 让尾舰永远追不上槽位，残差只增不减 —— 这就是用户说的"尾巴像一根绳子在飘"。
   *  ⚠ 与"厚重感"不冲突：**舰队**的机动性由 `shipKinematics` 的 vMax/omegaMax/alphaMax 决定
   *    （战列 180° 仍需 14~26s）；本值只管"舰在队内保持位置"的响应速度。
   *    真实舰船保持队位是主动 RCS 闭环，响应快；转向慢的是整支舰队。 */
  accel: 0.28,
  /** 速度方向转速上限 ω_max（rad/帧）：操纵性约束，满速转弯半径 = maxSpeed/omegaMax */
  omegaMax: 0.03,
});

/** [v47] 逐舰舰首跟随位移航迹的最大角速率（rad/帧@dt=1，≈9.2°/帧）。
 *  快到贴得住航迹（消灭「舰首朝前却侧滑平移」），慢到滤得掉逐帧方向噪声。
 *  ⚠ 恒须 > UNIT_MOTION_LIMITS.omegaMax（0.16 ≫ 0.03）——舰首必须跟得上速度向转率，
 *  否则侧滑角结构性超限。 */
export const UNIT_VIS_TURN_RATE = 0.16;

/** 舰级槽位追踪状态（滞回量存单位字段；本模块零实例状态）。 */
export interface ShipSlotTrack {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 上一帧槽位（前馈有限差分用；undefined = 首帧 ⇒ 前馈为 0） */
  slotX?: number;
  slotY?: number;
}

/**
 * [P2] 舰级阵位槽追踪（BattleScene 单位循环的唯一推进入口）。
 *
 * 「布阵按到槽时间提前转向」的控制论实现 = **槽速前馈**：期望速度 = 槽速 + Arrive 制动项。
 * 槽位随舰队横移时，期望速度立即含横移分量 ⇒ 船头提前响应，而非"目标跑了再追"（纯追踪
 * 永远滞后半个身位）；到位后前馈=槽速 ⇒ 稳态漂移趋零。
 * 槽速由槽位有限差分给出（自动涵盖舰队平移 + formFacing 旋转 + 换阵 morph）。
 */
export function stepShipSlotFollow(
  state: ShipSlotTrack,
  slotX: number,
  slotY: number,
  limits: ShipMotionLimits,
  dt: number,
): ShipSlotTrack {
  let tvx = 0;
  let tvy = 0;
  if (typeof state.slotX === 'number' && typeof state.slotY === 'number' && dt > 0) {
    tvx = (slotX - state.slotX) / dt;
    tvy = (slotY - state.slotY) / dt;
  }
  const m = stepShipMotion(
    { x: state.x, y: state.y, vx: state.vx, vy: state.vy },
    { targetX: slotX, targetY: slotY, targetVx: tvx, targetVy: tvy },
    limits,
    dt,
  );
  return { ...m, slotX, slotY };
}
