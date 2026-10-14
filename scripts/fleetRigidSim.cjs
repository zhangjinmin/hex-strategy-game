/**
 * fleetRigidSim.cjs — 舰队刚体运动学台架（[v73]）
 *
 * 纪律：require 真源码 .ts，零手抄常量；断言打**物理量级**不测实现。
 * 运行：node --import ./_ts_resolve.mjs scripts/fleetRigidSim.cjs
 */
const R = require('../frontend/src/game/fleetRigid.ts');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (cond) passed++; else failed++;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log('\n=== A. 编队约束：ω ≤ vMax/halfWidth ===');
{
  check('omegaCapFor 随半宽增大而减小（宽编队必须慢转）',
    R.omegaCapFor(0.22, 100) > R.omegaCapFor(0.22, 200)
    && R.omegaCapFor(0.22, 200) > R.omegaCapFor(0.22, 400));
  check('omegaCapFor = vMax × WING_SAFETY / halfWidth',
    near(R.omegaCapFor(0.22, 200), 0.22 * R.WING_SAFETY / 200),
    R.omegaCapFor(0.22, 200).toFixed(6));
  check('单舰（halfWidth≤1）无编队约束', R.omegaCapFor(0.22, 1) === 1.0);
  // 外翼弧速不得超 vMax（否则编队散架）
  for (const hw of [100, 200, 400]) {
    const w = R.wingSpeed(R.omegaCapFor(0.22, hw), hw);
    check(`halfWidth=${hw} 时外翼弧速 ≤ vMax×SAFETY`, w <= 0.22 * R.WING_SAFETY + 1e-9, w.toFixed(4));
  }
  check('宽编队掉头更慢（物理要求，不是手感）',
    R.turn180Seconds(R.omegaCapFor(0.22, 100)) < R.turn180Seconds(R.omegaCapFor(0.22, 400)),
    `${R.turn180Seconds(R.omegaCapFor(0.22, 100)).toFixed(1)}s vs ${R.turn180Seconds(R.omegaCapFor(0.22, 400)).toFixed(1)}s`);
}

console.log('\n=== B. 推力有限性：起步慢、停船慢 ===');
{
  // 0→95% 速度
  // [v73] 硬上限语义：帧数 = 0.95·vMax/accel（**不是** 3/accel 的指数趋近）
  check('rampSeconds = 0.95·vMax/accel（硬上限，非指数趋近）',
    near(R.rampSeconds(0.006, 0.22), (0.95 * 0.22 / 0.006) * (1000 / 60) / 1000, 1e-3),
    R.rampSeconds(0.006, 0.22).toFixed(2) + 's');
  check('硬上限语义比指数趋近快 13.6 倍（语义混淆的量化后果）',
    R.rampSeconds(0.006, 0.22) < (3 / 0.006) * (1000 / 60) / 1000 / 10,
    `${R.rampSeconds(0.006, 0.22).toFixed(2)}s vs 8.33s`);
  // 注意：8.3s 需配 vMax=0.22 的硬上限 accel=0.00042，而非指数趋近的 0.006
  check('战列（accel 0.00042, vMax 0.22）起步 8.3s',
    near(R.rampSeconds(0.00042, 0.22), 8.33, 0.15), R.rampSeconds(0.00042, 0.22).toFixed(2) + 's');
  check('停船距离 = v²/(2a)', near(R.stopDistance(0.22, 0.006), 0.22 * 0.22 / 0.012, 1e-6));
  check('高速停船距离显著（不能瞬停）', R.stopDistance(0.22, 0.006) > 3, R.stopDistance(0.22, 0.006).toFixed(2) + 'px');
  check('加速度越大停船越短', R.stopDistance(0.22, 0.006) > R.stopDistance(0.22, 0.013));

  // 实测积分：从静止加速，t95 应约等于 rampSeconds
  let st = R.createRigid(0, 0, 0);
  const accel = 0.006;
  const inp = { thrustDir: 0, thrustLevel: 1, targetHeading: null,
    omegaCap: 0.01, alphaMax: 0.0005, angDrag: 0 };
  //  thrustLevel 折算：每帧 dv 上限 = level·dt，故 level 需 = accel 才等效 accel
  const inpA = { ...inp, thrustLevel: accel };
  let t95 = Infinity;
  for (let i = 1; i <= 600; i++) {
    st = R.stepRigid(st, inpA, 1);
    if (R.speedOf(st) >= 0.95) { t95 = i; break; }
  }
  //  thrustLevel = accel ⇒ 每帧 dv 上限 = accel·dt = accel（dt=1）
  //  ⇒ 线性加速，n 帧后 v = min(n·accel, 1)。0→95% 需 0.95/accel 帧。
  check('积分实测 0→95% 帧数 = 0.95/accel（线性加速）',
    t95 !== Infinity && Math.abs(t95 - 0.95 / accel) <= 2, `${t95} 帧（理论 ${Math.round(0.95 / accel)}）`);
}

console.log('\n=== C. 转向：力矩积分 + 阻尼稳定 ===');
{
  const omegaCap = R.omegaCapFor(0.22, 200);
  const alphaMax = 0.0005, angDrag = 0.15;
  let st = R.createRigid(0, 0, 0);
  const inp = { thrustDir: null, thrustLevel: 0, targetHeading: Math.PI,
    omegaCap, alphaMax, angDrag };
  // 稳态角速度解析解：omega_new = (1-drag)*(omega + clamp(want-omega, ±a·dt))
  //   稳态时 dOmega = drag/(1-drag) * omega；若 want=omegaCap 且未触 alphaMax 上限，
  //   则 omega_ss = omegaCap*(1-drag)。阻尼让实际转向比理论慢 drag/(1-drag) 比例。
  const omegaSS = omegaCap * (1 - angDrag);
  let t180 = Infinity, omegaObserved = 0;
  for (let i = 1; i <= 8000; i++) {
    st = R.stepRigid(st, inp, 1);
    if (i === 600) omegaObserved = st.omega;   // 中段采样稳态
    if (Math.abs(st.heading) >= Math.PI - 1e-3) { t180 = i; break; }
  }
  check('180° 掉头能到达（吸附生效）', t180 !== Infinity, `${t180} 帧`);
  check('实测帧数 ≈ π/稳态角速度（含阻尼）',
    t180 !== Infinity && Math.abs(t180 - Math.PI / omegaSS) < Math.PI / omegaSS * 0.15,
    `${t180} vs 理论 ${Math.round(Math.PI / omegaSS)}`);
  check('稳态角速度 = omegaCap×(1-drag)',
    Math.abs(omegaObserved - omegaSS) < omegaSS * 0.02,
    `${omegaObserved.toExponential(3)} vs ${omegaSS.toExponential(3)}`);
  check('阻尼使转向慢于无阻尼理论（物理真实）',
    t180 !== Infinity && t180 > Math.PI / omegaCap,
    `慢 ${((t180 / (Math.PI / omegaCap) - 1) * 100).toFixed(0)}%`);
  check('角速度不超 omegaCap', Math.abs(st.omega) <= omegaCap + 1e-9, st.omega.toFixed(6));

  // 松开目标 ⇒ 阻尼收敛到 0（姿态稳定，不会永久自转）
  const free = R.stepRigid(st, { ...inp, targetHeading: null }, 1);
  check('松开目标后角速度衰减', Math.abs(free.omega) < Math.abs(st.omega) || Math.abs(st.omega) < 1e-6);
  let s2 = st;
  for (let i = 0; i < 600; i++) s2 = R.stepRigid(s2, { ...inp, targetHeading: null }, 1);
  check('600 帧后角速度归零（姿态稳定）', Math.abs(s2.omega) < 1e-6, s2.omega.toExponential(2));
}

console.log('\n=== D. 刚体公式：船位与姿态严格同步 ===');
{
  const st = { x: 100, y: 50, heading: Math.PI / 6, vx: 0.2, vy: 0.1, omega: 0.001 };
  const off = { along: 80, lateral: 30 };
  const p = R.shipSlot(st, off);
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  check('船位 = 质心 + R(heading)·偏移',
    near(p.x, 100 + c * 80 - s * 30) && near(p.y, 50 + s * 80 + c * 30),
    `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  // 反算自洽
  const back = R.shipOffsetOf(st, p.x, p.y);
  check('反算偏移自洽', near(back.along, off.along) && near(back.lateral, off.lateral),
    `(${back.along.toFixed(3)}, ${back.lateral.toFixed(3)})`);
  // 原地转 180°：船位应到对侧（首尾交换）
  const flipped = { ...st, heading: st.heading + Math.PI };
  const pf = R.shipSlot(flipped, off);
  check('掉头后同偏移船位落到对侧（首尾交换）',
    near(pf.x - st.x, -(p.x - st.x), 1e-6) && near(pf.y - st.y, -(p.y - st.y), 1e-6),
    `(${(pf.x - st.x).toFixed(2)}, ${(pf.y - st.y).toFixed(2)}) vs (${(p.x - st.x).toFixed(2)}, ${(p.y - st.y).toFixed(2)})`);
  // 零偏移 = 质心
  check('零偏移船位 = 质心', near(R.shipSlot(st, { along: 0, lateral: 0 }).x, st.x));
}

console.log('\n=== E. 拖刀：推力方向可与舰首分离 ===');
{
  // 物理：舰首朝敌 + 质心后退 ⇒ thrustDir 与 heading 可差 180°
  let st = R.createRigid(0, 0, 0);
  const inp = { thrustDir: Math.PI, thrustLevel: 0.006, targetHeading: 0,
    omegaCap: 0.01, alphaMax: 0.0005, angDrag: 0 };
  for (let i = 0; i < 100; i++) st = R.stepRigid(st, inp, 1);
  check('拖刀：质心后退（vx<0）', st.vx < 0, st.vx.toFixed(4));
  check('拖刀：舰首不变（仍朝原方向）', near(st.heading, 0, 1e-6), st.heading.toFixed(6));
  check('拖刀：航向与舰首分离 180°',
    Math.abs(Math.atan2(Math.sin(R.courseOf(st) - st.heading), Math.cos(R.courseOf(st) - st.heading))) > Math.PI - 1e-3);
}

console.log('\n=== F. 纯函数契约 ===');
{
  const st = R.createRigid(0, 0, 0.5);
  const before = JSON.stringify(st);
  R.stepRigid(st, { thrustDir: 0, thrustLevel: 0.01, targetHeading: 1,
    omegaCap: 0.01, alphaMax: 0.0005, angDrag: 0.1 }, 1);
  check('stepRigid 不改入参（纯函数）', JSON.stringify(st) === before);
  check('createRigid 初态为零速零角速',
    st.vx === 0 && st.vy === 0 && st.omega === 0 && st.heading === 0.5);
  const idle = R.idleInput();
  check('idleInput 无推力无目标', idle.thrustDir === null && idle.targetHeading === null && idle.thrustLevel === 0);
  check('dt=0 时状态不变', (() => {
    const a = R.stepRigid(st, { ...R.idleInput(), targetHeading: 1 }, 0);
    return a.x === st.x && a.y === st.y && near(a.heading, st.heading);
  })());
  check('负 dt 被钳为 0（不回退）', (() => {
    const a = R.stepRigid(st, { ...R.idleInput(), thrustDir: 0, thrustLevel: 0.01 }, -1);
    return a.x === st.x;
  })());
}

console.log('\n=== G. 编队宽度 → 掉头时长全景（设计自检）===');
{
  const rows = [];
  for (const hw of [50, 100, 200, 300]) {
    const w = R.omegaCapFor(0.22, hw);
    rows.push(`halfW=${hw}: ω=${w.toFixed(5)} 180°=${R.turn180Seconds(w).toFixed(1)}s 外翼弧速=${R.wingSpeed(w, hw).toFixed(3)}`);
  }
  console.log('    ' + rows.join('\n    '));
  check('最窄编队掉头 ≤ 30s（可玩下限）',
    R.turn180Seconds(R.omegaCapFor(0.22, 50)) <= 30,
    R.turn180Seconds(R.omegaCapFor(0.22, 50)).toFixed(1) + 's');
  check('所有半宽下外翼弧速 ≤ vMax×SAFETY',
    [50, 100, 200, 300].every((hw) => R.wingSpeed(R.omegaCapFor(0.22, hw), hw) <= 0.22 * R.WING_SAFETY + 1e-9));
}

console.log(`\n=== fleetRigidSim: ${passed} PASS / ${failed} FAIL ===`);
process.exit(failed > 0 ? 1 : 0);
