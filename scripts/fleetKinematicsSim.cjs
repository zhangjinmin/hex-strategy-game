/** Regression harness for bounded formation and logistics movement. */
const K = require('../frontend/src/game/fleetKinematics.ts');
const S = require('../frontend/src/game/SupplyChainSystem.ts');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('\n=== Bounded formation movement ===');
const far = K.moveTowardsAtSpeed({ x: 0, y: 0 }, { x: 1000, y: 0 }, 1.5);
check('a far-away slot cannot catch up faster just because its target jumped', far.x === 1.5 && far.y === 0, JSON.stringify(far));

const near = K.moveTowardsAtSpeed({ x: 0, y: 0 }, { x: 1, y: 0 }, 1.5);
check('a slot stops exactly at its target without overshooting', near.x === 1 && near.y === 0, JSON.stringify(near));

const facing = K.advanceFormationFacing(0, Math.PI, Math.PI / 12);
check('formation orientation advances by a bounded angular step instead of jumping 180 degrees',
  Math.abs(facing - Math.PI / 12) < 1e-9, String(facing));

console.log('\n=== Transport hull-following movement ===');
const aux = {
  unit: { hp: 100 }, fleet: null, x: 0, y: 0, heading: 0, cargo: 100,
  state: 'outbound', targetFleet: { x: 0, y: 100 }, homeX: 0, homeY: 0,
};
S.moveAuxShips([aux], 1);
const motionHeading = Math.atan2(aux.y, aux.x);
const headingError = Math.abs(Math.atan2(Math.sin(motionHeading - aux.heading), Math.cos(motionHeading - aux.heading)));
check('transport displacement follows its hull heading rather than sliding directly toward a side target',
  Math.hypot(aux.x, aux.y) < 1e-9 || headingError < 1e-9, `motion=${motionHeading}, hull=${aux.heading}`);

console.log('\n=== Lead pursuit / intercept course (P2 提前量) ===');
{
  // 静止目标 ⇒ 退化为纯追踪（返回目标原位）
  const still = K.leadInterceptPoint({ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 0 }, 2);
  check('stationary target degrades to pure pursuit', still.x === 100 && still.y === 50, JSON.stringify(still));

  // 我方近停 ⇒ 不做预测（closingSpeed ≤ 0）
  const stopped = K.leadInterceptPoint({ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 1, y: 0 }, 0);
  check('near-stationary shooter falls back to the current target position', stopped.x === 100 && stopped.y === 50);

  // 运动目标 ⇒ 预测点在目标速度方向**前方**（前置追踪，不是追尾）
  const lead = K.leadInterceptPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 1, y: 0 }, 2);
  check('predicted point lies ahead of the target along its velocity',
    lead.x > 100 && Math.abs(lead.y) < 1e-9, JSON.stringify(lead));
  // 手算复核（独立于实现）：t0=50 → iter1 t=75 → iter2 t=87.5 ⇒ lead=(187.5, 0)
  check('iterative convergence matches the hand-computed intercept point',
    Math.abs(lead.x - 187.5) < 1e-9, `lead.x=${lead.x}`);

  // 预测视界封顶：maxLeadFrames=10 ⇒ 预测点 = 目标 + vel×10
  const capped = K.leadInterceptPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 1, y: 0 }, 2, 10);
  check('prediction horizon is capped by maxLeadFrames',
    Math.abs(capped.x - 110) < 1e-9, JSON.stringify(capped));

  // 对照实验：横向穿越场景。速度比 2:1.5 ≈ 舰队对舰队真实区间（双方航速接近），
  // 追尾式纯追踪在该区间损失最大（试算：gain 随速度比趋近 1 单调上升）。
  const MY = 2, TGT = 1.5;
  const sim = (aimFn) => {
    let cx = 0, cy = 0, tx = 0, ty = 100, frames = 0;
    while (frames < 5000) {
      const aim = aimFn(cx, cy, tx, ty);
      const d = Math.hypot(aim.x - cx, aim.y - cy);
      if (d > 0) { cx += (aim.x - cx) / d * MY; cy += (aim.y - cy) / d * MY; }
      tx += TGT;
      frames++;
      if (Math.hypot(tx - cx, ty - cy) < 2) return frames;
    }
    return Infinity;
  };
  const pureFrames = sim((cx, cy, tx, ty) => ({ x: tx, y: ty }));
  const interceptFrames = sim((cx, cy, tx, ty) => K.leadInterceptPoint({ x: cx, y: cy }, { x: tx, y: ty }, { x: TGT, y: 0 }, MY));
  check('intercept course catches a crossing target faster than pure pursuit (>=20%)',
    interceptFrames < pureFrames * 0.8,
    `intercept=${interceptFrames} vs pure=${pureFrames} (${(100 * (1 - interceptFrames / pureFrames)).toFixed(1)}% faster)`);
}

console.log('\n=== [P2 acceptance] ship kinematics criteria (29 §6.2: shake / sideslip / settle) ===');
{
  // 落点说明：29 号 §8 原写「扩展 tacticalCombatSim.cjs」；v63 已把「截获提速」判据落在本台架
  // ⇒ P2 四判据收口同一台架一次性审计（落点按代码现实微调，判据阈值不变）。
  const F = require('../frontend/src/config/formationLayout.ts');
  const L = K.UNIT_MOTION_LIMITS;
  const VIS = K.UNIT_VIS_TURN_RATE;
  const SPACING = F.FORMATION_SPACING;
  const SLIP_LIMIT = 15 * Math.PI / 180;

  // 结构前提：舰首跟随率必须显著大于速度转速上限（否则侧滑结构性超限，判据失去保证）
  check('structural premise: visHeading turn rate > omegaMax', VIS > L.omegaMax * 2, `vis=${VIS}, omegaMax=${L.omegaMax}`);

  // v47 rateLimitAngle 行为模型（BattleScene :288 无法 require；跟随率常量取自真源 K.UNIT_VIS_TURN_RATE）
  const rateLimit = (cur, want, step) => {
    const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    return Math.abs(d) <= step ? want : cur + Math.sign(d) * step;
  };

  // 受控机动：编队就位直航 120 帧 → formFacing 限速转 180°（120 帧，v42 掉头压力段）→ 新航向直航 400 帧。
  // 槽位 = 舰队质心 + rotate(格位×SPACING, formFacing)；质心 0.9px/帧沿 formFacing 推进。
  // 外缘槽轨速 ω·r > maxSpeed ⇒ 转弯期必然滞后-复归 = 历史「转向后摇头晃脑」压力复现。
  // ⚠ 180° 掉头后外缘舰需跨队形横渡 ~147px ⇒ T3 必须 ≥ 400 帧才谈得上「稳态」；
  //   稳态窗 = 末 180 帧（此前的收敛段属渡越瞬态，阻尼过冲不计摇头——判据原文即「稳态段」）。
  const FORM_FACING_RATE = Math.PI / 120; // 场景受控输入（BattleScene formFacing reform 限速）
  // ⚠ 舰队巡航速必须用真实档 FLEET_BASE_SPEED=0.30（BattleScene :186），不能拿单位 maxSpeed 当巡航速——
  //   等速追及（巡航 == 单位极速）会让纵向滞后永远追不回（本台架首轮 33px 残留即此场景产物）。
  //   现实工况单位有 3× 追赶余量；溃散档 3.0×0.30=0.90 恰好贴 maxSpeed 是已知边缘（另行记录）。
  const FLEET_CRUISE = 0.30;
  const cell = [[0, 0], [-1, 1], [-1, -1], [-2, 2], [-2, -2]];
  const T1 = 120, T2 = 120, T3 = 400, STEADY = 180;
  let fx = 0, fy = 0, ff = 0;
  const units = cell.map(([gx, gy]) => {
    const x = gx * SPACING, y = gy * SPACING;
    return {
      // 初始即在位且与槽同速（无就位暖机污染统计）
      t: { x, y, vx: FLEET_CRUISE, vy: 0, slotX: x, slotY: y },
      vis: 0,
      slips: [],
      thetas: [],
    };
  });
  for (let f = 0; f < T1 + T2 + T3; f++) {
    if (f >= T1) ff = Math.min(Math.PI, ff + FORM_FACING_RATE);
    fx += Math.cos(ff) * FLEET_CRUISE;
    fy += Math.sin(ff) * FLEET_CRUISE;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const [gx, gy] = cell[i];
      const ox = gx * SPACING, oy = gy * SPACING;
      const sx = fx + ox * Math.cos(ff) - oy * Math.sin(ff);
      const sy = fy + ox * Math.sin(ff) + oy * Math.cos(ff);
      u.t = K.stepShipSlotFollow(u.t, sx, sy, L, 1);
      const sp = Math.hypot(u.t.vx, u.t.vy);
      // 近静止（< 5% 满速）方向无意义，不进侧滑统计（与 ω_max 门槛同理）
      if (sp > 0.05 * L.maxSpeed) {
        const mdir = Math.atan2(u.t.vy, u.t.vx);
        u.vis = rateLimit(u.vis, mdir, VIS);
        u.slips.push(Math.abs(Math.atan2(Math.sin(mdir - u.vis), Math.cos(mdir - u.vis))));
        if (f >= T1 + T2 + T3 - STEADY) {
          u.thetas.push(u.vis);
          u.slotDist = Math.max(u.slotDist || 0, Math.hypot(u.t.x - sx, u.t.y - sy));
        }
      }
    }
  }

  // 判据①摇头：稳态段 sign(Δθ) 翻转次数 = 0（禁「绕心累计转角」零判别力口径）
  let flips = 0;
  let maxTailD = 0, maxSlotDist = 0;
  for (const u of units) {
    let prevSign = 0;
    maxSlotDist = Math.max(maxSlotDist, u.slotDist || 0);
    for (let i = 1; i < u.thetas.length; i++) {
      const d = Math.atan2(Math.sin(u.thetas[i] - u.thetas[i - 1]), Math.cos(u.thetas[i] - u.thetas[i - 1]));
      if (Math.abs(d) > maxTailD) maxTailD = Math.abs(d);
      const s = Math.abs(d) < 1e-9 ? 0 : Math.sign(d);
      if (s !== 0 && prevSign !== 0 && s !== prevSign) flips++;
      if (s !== 0) prevSign = s;
    }
  }
  check('no head-shake: sign(dTheta) flips = 0 in the steady segment', flips === 0,
    `flips=${flips}, windowMax|dTheta|=${maxTailD.toExponential(2)}rad, windowMaxSlotDist=${maxSlotDist.toFixed(2)}px`);

  // 判据②侧滑：位移方向与舰首夹角 P95 < 15°（拖刀除外；报中位数）
  const slips = units.flatMap((u) => u.slips).sort((a, b) => a - b);
  const quantile = (q) => slips[Math.min(slips.length - 1, Math.floor(slips.length * q))];
  check('sideslip: P95 of |motion - visHeading| < 15deg (median reported)',
    quantile(0.95) < SLIP_LIMIT,
    `median=${(quantile(0.5) * 180 / Math.PI).toFixed(2)}deg, P95=${(quantile(0.95) * 180 / Math.PI).toFixed(2)}deg, n=${slips.length}`);
}

console.log('\n=== [P2 acceptance] slot settle drift (0.3 spacing budget) ===');
{
  // 判据③到位超调：到位判定后 3s 窗口漂移 < 0.3 槽宽。初速背离静止槽 = 反向+制动压力场景
  const F = require('../frontend/src/config/formationLayout.ts');
  const L = K.UNIT_MOTION_LIMITS;
  const BUDGET = 0.3 * F.FORMATION_SPACING;
  let t = { x: 60, y: 0, vx: 0.5, vy: 0 };
  let arrived = -1, drift3s = 0, driftLong = 0;
  for (let f = 1; f <= 600; f++) {
    t = K.stepShipMotion(t, { targetX: 0, targetY: 0 }, L, 1);
    const d = Math.hypot(t.x, t.y);
    // 到位 = 停稳且在阵位预算内（死区扩大后舰停在 ARRIVE_EPS 尺度，不能用 d<1 判定）
    if (arrived < 0 && Math.hypot(t.vx, t.vy) < 0.03 && d < BUDGET) arrived = f;
    if (arrived >= 0) {
      driftLong = Math.max(driftLong, d);
      if (f - arrived <= 180) drift3s = Math.max(drift3s, d);
    }
  }
  check('settle: ship reaches its slot within 300 frames', arrived >= 0 && arrived <= 300, `arrivedAt=${arrived}`);
  check('settle: drift < 0.3 spacing in the 3s window after arrival',
    drift3s < BUDGET, `drift3s=${drift3s.toFixed(3)}px, budget=${BUDGET}px, longRun=${driftLong.toFixed(3)}px`);
}

console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
