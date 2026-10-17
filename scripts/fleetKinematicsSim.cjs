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

console.log('\n=== Transport visual sync: bow source must NOT depend on sprite aliveness ===');
{
  // 真跑 SupplyChainSystem.syncAuxVisual（真源码）——运输舰在舰队列循环里被提前跳过，
  // 本函数是它**唯一**的逐帧视觉写入点，故"朝向是否写入"必须在这里被断言得住。
  const mkAux = (sprite) => ({
    unit: { hp: 100, sprite }, fleet: null,
    x: 100, y: 0, heading: 1.2345, cargo: 100,
    state: 'outbound', targetFleet: null, homeX: 0, homeY: 0,
  });
  const mkSprite = (active, visible) => ({
    x: 0, y: 0, rotation: 0, active, visible,
    _kids: { border: { rotation: 0 }, text: { rotation: 0 } },
    getByName(n) { return this._kids[n] || null; },
  });

  // ① sprite.active === false：朝向真源仍必须写入
  //    （旧实现 `if (!sprite || !sprite.active) return;` 之后才赋值 ⇒ 该分支 visHeading 永久缺失
  //     ⇒ Battle3DOverlay 回退舰队朝向 ⇒ 位置走 aux.heading、舰首跟舰队 = 横着飞）
  const sOff = mkSprite(false, false);
  const aOff = mkAux(sOff);
  S.syncAuxVisual(aOff, 1);
  check('visHeading is written even when sprite.active === false (3D bow truth must not depend on the 2D sprite)',
    aOff.unit.visHeading === aOff.heading,
    `visHeading=${aOff.unit.visHeading}, heading=${aOff.heading}`);

  // ② sprite 缺失（被销毁 / 尚未创建）
  const aNone = mkAux(null);
  S.syncAuxVisual(aNone, 1);
  check('visHeading is written even when sprite is missing',
    aNone.unit.visHeading === aNone.heading, `visHeading=${aNone.unit.visHeading}`);

  // ③ 正常 sprite：朝向 + 舰首贴图 +90° 补偿（舰队列口径）+ 文字正向
  const sOn = mkSprite(true, true);
  const aOn = mkAux(sOn);
  S.syncAuxVisual(aOn, 1);
  check('normal sprite: visHeading / rotation / bow(+90deg) / upright text all applied',
    aOn.unit.visHeading === aOn.heading
    && sOn.rotation === aOn.heading
    && Math.abs(sOn._kids.border.rotation - Math.PI / 2) < 1e-9
    && Math.abs(sOn._kids.text.rotation + aOn.heading) < 1e-9,
    `vis=${aOn.unit.visHeading}, rot=${sOn.rotation}, border=${sOn._kids.border.rotation}, text=${sOn._kids.text.rotation}`);

  // ④ 位置 = 独立坐标（硬同步）：显示位置永不落后于逻辑坐标
  const sFar = mkSprite(true, true); sFar.x = -1000; sFar.y = 0;
  const aFar = mkAux(sFar);
  S.syncAuxVisual(aFar, 1);
  check('sprite lands exactly on the independent coord in one frame (no straight-line crawl)',
    sFar.x === 100 && sFar.y === 0, `sprite=(${sFar.x},${sFar.y})`);
  const sNear = mkSprite(true, true); sNear.x = 99.5; sNear.y = 0;
  const aNear = mkAux(sNear);
  S.syncAuxVisual(aNear, 1);
  check('sprite stops exactly on the coord without overshoot', sNear.x === 100 && sNear.y === 0, `sprite=(${sNear.x},${sNear.y})`);

  // ⑤ **本轮用户报障的机制**：显示位置走"直线追赶"时，位移方向 = 指向 aux 的直线，
  //   而物理位移方向 = aux.heading（moveAuxShips 让舰首消费航向）⇒ 两者可差 90° = 「横着飞」。
  //   断言口径必须是 **位移方向 vs 朝向**（不是"角度 == 角度"）。
  {
    // 稳态：连续 60 帧 outbound 追目标，每一帧 sprite 位移方向必须 == aux.heading
    const sp = mkSprite(true, true); sp.x = 0; sp.y = 0;
    const a = mkAux(sp);
    a.x = 0; a.y = 600; a.heading = 0; a.state = 'outbound';
    a.targetFleet = { x: 0, y: 0 };      // 目标在正北 ⇒ 航向必须先转
    S.syncAuxVisual(a, 1);               // 首帧硬同步（sprite 落到 aux）
    let worst = 0;
    for (let f = 0; f < 60; f++) {
      const px = sp.x, py = sp.y;
      S.moveAuxShips([a], 1);
      S.syncAuxVisual(a, 1);
      const dx = sp.x - px, dy = sp.y - py;
      if (Math.hypot(dx, dy) < 1e-9) continue;
      let d = Math.abs(Math.atan2(dy, dx) - a.heading) * 180 / Math.PI;
      if (d > 180) d = 360 - d;
      if (d > worst) worst = d;
    }
    check('steady state: every frame the sprite displacement direction equals the hull heading',
      worst < 1e-6, `max=${worst.toExponential(2)}°`);

    // 反例自检：把位置跟随换回"固定步长直线追赶"（v21~v97 的实现），同一场景必须失败
    const legacyChase = (aux, dt) => {
      const s = aux.unit.sprite;
      const dx2 = aux.x - s.x, dy2 = aux.y - s.y, d2 = Math.hypot(dx2, dy2);
      if (d2 > 0.02) {
        const step = Math.min(S.AUX_SPEED * dt, d2);
        s.x += (dx2 / d2) * step; s.y += (dy2 / d2) * step;
      }
    };
    const spB = mkSprite(true, true); spB.x = 0; spB.y = 0;
    const aB = mkAux(spB);
    aB.x = 0; aB.y = 600; aB.heading = 0; aB.state = 'loading'; aB.targetFleet = null;
    for (let f = 0; f < 20; f++) legacyChase(aB, 1);
    const moveAng = Math.atan2(spB.y - 0, spB.x - 0);
    let diff = Math.abs(moveAng - aB.heading) * 180 / Math.PI;
    if (diff > 180) diff = 360 - diff;
    check('counterexample: the legacy crawl flies 90° across its own bow when a spawn gap exists',
      Math.abs(diff - 90) < 1e-6, `displacement vs heading = ${diff.toFixed(2)}°`);
  }

  // ⑤ 反例自检：把 visHeading 的赋值放回 `if (!sprite || !sprite.active) return` 之后（旧顺序）
  //    ⇒ 同一场景下 visHeading 必须**缺失**。这条通过 = 台架确实抓得住这次回归（而非"怎么写都绿"）。
  const legacySyncAuxVisual = (a) => {
    const sp = a.unit && a.unit.sprite;
    if (!sp || sp.active === false) return;   // ← 旧实现的提前 return
    a.unit.visHeading = a.heading;
  };
  const aBad = mkAux(mkSprite(false, false));
  legacySyncAuxVisual(aBad);
  check('counterexample: the legacy order (assign after the sprite guard) DOES leave visHeading missing',
    aBad.unit.visHeading === undefined, `visHeading=${aBad.unit.visHeading}`);

  // ⑥ 反例对照：同一条旧顺序断言在**新实现**下必须不成立（即新实现确实修好了）
  const aGood = mkAux(mkSprite(false, false));
  S.syncAuxVisual(aGood, 1);
  check('the same scenario is healed by the shipped implementation (visHeading present)',
    aGood.unit.visHeading === aGood.heading, `visHeading=${aGood.unit.visHeading}`);
}

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

console.log('\n=== [v8] 运输舰彻底解耦：不绑定任何舰队 / 自身 px LOD / 自主补给逻辑 ===');
{
  const fs = require('node:fs');
  const L = require('../frontend/src/game/three/auxLod.ts');

  // ── ① 结构：AuxShip / AuxAsset **没有 fleet 字段**（结构上不可能被"绑定"）──
  const orphan = { hp: 100, classType: '补给', factionId: 7, sprite: { x: 33, y: 44 } };
  const dead = { hp: 0, classType: '补给', factionId: 7 };
  const pooled = S.collectAuxShips(
    [{ unit: orphan, factionId: 7 }, { unit: dead, factionId: 7 }],
    (fid) => (fid === 7 ? { x: 500, y: 400 } : null),
  );
  check('collection works with a pool that has NO fleet reference at all (0 fleets ⇒ still collected)',
    pooled.length === 1 && pooled[0].unit === orphan, `n=${pooled.length}`);
  check('AuxShip carries NO fleet field (runtime `\'fleet\' in aux === false`)',
    !('fleet' in pooled[0]), `keys=${Object.keys(pooled[0]).join(',')}`);
  check('AuxShip keys are exactly the decoupled set (unit/factionId/x/y/heading/cargo/state/targetFleet/homeX/homeY)',
    ['unit', 'factionId', 'x', 'y', 'heading', 'cargo', 'state', 'targetFleet', 'homeX', 'homeY']
      .every((k) => k in pooled[0]) && Object.keys(pooled[0]).length === 10,
    `keys=${Object.keys(pooled[0]).join(',')}`);
  check('ownership truth is factionId (no container to fall back to)', pooled[0].factionId === 7);
  check('new transport spawns at its faction home port (homeOf(factionId))',
    pooled[0].homeX === 500 && pooled[0].homeY === 400,
    `home=(${pooled[0].homeX},${pooled[0].homeY})`);
  check('destroyed transports are dropped', pooled.every((a) => a.unit.hp > 0));

  // 源结构：两个 interface 里都不许再出现 `fleet:` 字段
  const supplySrc = fs.readFileSync('./frontend/src/game/SupplyChainSystem.ts', 'utf8');
  const iface = (name) => {
    const i = supplySrc.indexOf(`export interface ${name} {`);
    return i < 0 ? '' : supplySrc.slice(i, supplySrc.indexOf('\n}', i));
  };
  check('source: AuxShip interface declares no fleet field', !/\bfleet\s*:/.test(iface('AuxShip')));
  check('source: AuxAsset interface declares no fleet field', !/\bfleet\s*:/.test(iface('AuxAsset')));

  // ── ② 收集器**绝不读** asset.fleet（守卫 getter 会抛错）──
  const guarded = { unit: { hp: 100, classType: '补给', factionId: 7, sprite: { x: 1, y: 2 } }, factionId: 7 };
  Object.defineProperty(guarded, 'fleet', {
    get() { throw new Error('collectAuxShips read asset.fleet'); },
  });
  let threw = null;
  try { S.collectAuxShips([guarded]); } catch (e) { threw = e.message; }
  check('collectAuxShips never touches asset.fleet (a throwing getter is never invoked)', threw === null, String(threw));

  // 旧调用方仍带着 fleet 字段时：字段被忽略、坐标不从容器继承
  const legacyAsset = { unit: { hp: 100, classType: '补给', factionId: 7, sprite: { x: 33, y: 44 } }, factionId: 7, fleet: { factionId: 99, x: 9999, y: 9999 } };
  const fromLegacy = S.collectAuxShips([legacyAsset]);
  check('a legacy asset carrying a fleet cannot smuggle it in (nor inherit its coordinates)',
    !('fleet' in fromLegacy[0]) && fromLegacy[0].x === 33 && fromLegacy[0].y === 44,
    `x=${fromLegacy[0].x}, y=${fromLegacy[0].y}`);

  // ── ③ 跨 Tick 连续（坐标/货量/状态按 unit 保留，与任何容器无关）──
  const prev = new Map();
  prev.set(orphan, pooled[0]);
  pooled[0].x = 123; pooled[0].heading = 0.77; pooled[0].cargo = 42;
  const again = S.collectAuxShips([{ unit: orphan, factionId: 7 }], () => null, prev);
  check('state/coord/cargo survive a Tick (and no fleet key appears)',
    again.length === 1 && again[0] === pooled[0] && !('fleet' in again[0])
    && again[0].x === 123 && again[0].cargo === 42 && again[0].heading === 0.77,
    `x=${again[0].x}, cargo=${again[0].cargo}`);

  // 反例自检：旧「扫舰队」收集在容器缺失时必须收不到（证明本断言确实在钉"解耦"而不是空转）
  const legacyCollect = (fleets) => {
    const out = [];
    fleets.forEach((fl) => { fl.units.forEach((u) => { if (u.classType === '补给' && u.hp > 0) out.push(u); }); });
    return out;
  };
  check('counterexample: the legacy fleet-scanning collect returns 0 once the container is gone',
    legacyCollect([]).length === 0 && legacyCollect([{ units: [] }]).length === 0);

  // ── ④ 归属只认 factionId；缺它时**不回退任何容器** ──
  const tf = { factionId: 11, x: 1000, y: 0, units: [{ supply: 10 }] };
  const teamOf = (ref) => (typeof ref === 'number' ? (ref === 11 ? 1 : 2) : (ref && ref.factionId === 11 ? 1 : 2));
  const mk = (factionId) => ({
    unit: { hp: 100, classType: '补给' }, factionId,
    x: 0, y: 0, heading: 0, cargo: 100, state: 'outbound', targetFleet: null, homeX: 0, homeY: 0,
  });
  const sources = [{ x: 0, y: 0, team: 1, kind: 'castle' }];
  const own = mk(11);
  S.updateSupplyChain([tf], sources, [own], 1, teamOf);
  check('ownership: aux resolves its team from factionId alone',
    own.targetFleet === tf && own.state !== 'returning',
    `targetFleet=${own.targetFleet === tf}, state=${own.state}`);
  const bad = mk(undefined);
  S.updateSupplyChain([tf], sources, [bad], 1, teamOf);
  check('counterexample: without factionId nothing is claimed (there is no container to fall back to)',
    bad.targetFleet === null && bad.state === 'outbound',
    `targetFleet=${bad.targetFleet}, state=${bad.state}`);

  // 0 支舰队也要能推进状态机（运输舰不是"某舰队的零件"）
  const lonely = mk(11);
  lonely.state = 'outbound';
  S.updateSupplyChain([], sources, [lonely], 1, teamOf);
  check('the state machine ticks with ZERO fleets (no fleet is needed to drive a transport)',
    lonely.state === 'returning' && lonely.targetFleet === null, `state=${lonely.state}`);

  // ── ⑤ 自主选目标：缺补给更多的赢，即使它更远；与"谁曾承载过它"无关 ──
  //    ⚠ 两个候选都必须在**补给源圈外**（否则 `inSupply` 会让它天然不缺，测的就不是评分了）
  const A = { factionId: 11, x: 1200, y: 0, units: [{ supply: 5 }] };    // 更缺补给、更远
  const B = { factionId: 11, x: 600, y: 0, units: [{ supply: 68 }] };    // 几乎满了、更近
  const autonomous = mk(11);
  S.updateSupplyChain([A, B], sources, [autonomous], 1, teamOf);
  check('autonomous target: the neediest fleet wins even though it is farther (A@1200 supply5 vs B@600 supply68)',
    autonomous.targetFleet === A && autonomous.state === 'outbound',
    `picked=${autonomous.targetFleet === A ? 'A' : autonomous.targetFleet === B ? 'B' : 'null'}`);
  check('counterexample: a pure-nearest rule would have picked B (that is what we no longer do)',
    Math.hypot(0 - B.x, 0 - B.y) < Math.hypot(0 - A.x, 0 - A.y));
  // 纯函数直调（与 updateSupplyChain 同一实现）：不受任何外部"宿主"影响
  const info = S.updateSupplyChain([A, B], sources, [], 1, teamOf);
  check('pickAuxTarget is a pure function of (own position, fleet needs) — no host fleet is an input',
    S.pickAuxTarget(autonomous, [A, B], info, 1, teamOf) === A
    && S.pickAuxTarget({ ...autonomous, __host: { factionId: 99, x: 9999 } }, [A, B], info, 1, teamOf) === A);

  // 承诺目标补满 ⇒ **当场重选**（旧实现：`!target → returning` 空手返航）
  const C = { factionId: 11, x: 900, y: 0, units: [{ supply: 30 }] };
  const D = { factionId: 11, x: 1000, y: 0, units: [{ supply: 92 }] };   // 已被补满（≥ 释放线 85）
  const switcher = mk(11);
  switcher.state = 'supplying'; switcher.targetFleet = D;
  S.updateSupplyChain([D, C], sources, [switcher], 1, teamOf);
  check('a satisfied commitment is re-targeted in the same tick (does not fly home empty)',
    switcher.targetFleet === C && switcher.state !== 'returning',
    `target=${switcher.targetFleet === C ? 'C' : switcher.targetFleet === D ? 'D' : 'null'}, state=${switcher.state}`);

  // ── ⑥ LOD：以**自身 px** 判定（反例：用母队均值 ⇒ 贴脸仍退化光点）──
  const SELF_NEAR = 72;      // 相机贴脸时运输舰自身 px
  const MOTHER_FAR = 3.2;    // 母队（早已千里之外）成员 px 均值
  check('aux LOD input is its OWN px (never the mother-fleet mean)',
    L.auxLodPx(SELF_NEAR) === SELF_NEAR && L.auxGrowK(SELF_NEAR, 0, 8) === 1,
    `px=${L.auxLodPx(SELF_NEAR)}, grow=${L.auxGrowK(SELF_NEAR, 0, 8)}`);
  check('near camera ⇒ aux BUILDS a mesh (self px well above the keep threshold)',
    L.auxLodVerdict({ selfPx: SELF_NEAR, hasMesh: false, lodKeep: 14, lodDrop: 15 }) === 'mesh');
  check('counterexample: feeding the mother-fleet mean px degrades the same aux to a dot',
    L.auxLodVerdict({ selfPx: MOTHER_FAR, hasMesh: false, lodKeep: 14, lodDrop: 15 }) === 'none'
    && L.auxGrowK(MOTHER_FAR, 0, 8) < 0.4,
    `verdict=${L.auxLodVerdict({ selfPx: MOTHER_FAR, hasMesh: false, lodKeep: 14, lodDrop: 15 })}, grow=${L.auxGrowK(MOTHER_FAR, 0, 8).toFixed(3)}`);

  // 渲染层接线契约（3D 层无法在台架里 import three ⇒ 用源码契约钉住"接线没被改回去"）
  const overlaySrc = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');
  check('overlay: the aux pass feeds its OWN px into fleetPx (LOD representative)',
    overlaySrc.includes('avv.fleetPx = auxLodPx(apx)'));
  check('overlay: aux entries are excluded from the fleet-level px average',
    overlaySrc.includes('if ((v.fleet as any)?._isAux) continue;'));
  check('overlay: aux grow/LOD decisions go through the shared pure module',
    overlaySrc.includes('auxLodVerdict({') && overlaySrc.includes('auxGrowK(v.fleetPx'));
  check('overlay: the aux pass positions the hull from aux.x / aux.y (not from a fleet or its sprite)',
    overlaySrc.includes('avv.x = aux.x; avv.y = ay; avv.z = -aux.y;'));
}


console.log(`\n${passed + failed} assertions: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
