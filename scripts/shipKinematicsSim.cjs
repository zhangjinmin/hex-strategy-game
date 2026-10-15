/**
 * shipKinematicsSim.cjs — 舰种运动学台架（[v69] 阶段 2）
 *
 * 纪律：require 真源码 .ts，零手抄常量；断言打行为/数值不测实现。
 * 运行：node --import ./_ts_resolve.mjs scripts/shipKinematicsSim.cjs
 */
const K = require('../frontend/src/config/shipKinematics.ts');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (cond) passed++; else failed++;
}

console.log('\n=== A. 核心判据：转弯半径必须 > 舰长 ===');
{
  const rows = [];
  let allOk = true;
  for (const [ct, k] of Object.entries(K.SHIP_KINEMATICS)) {
    if (ct === '舰载') continue;         // 特殊单位，随母舰
    const r = K.turnRadius(k);
    const ratio = K.radiusRatio(k);
    const ok = ratio >= 1.0;
    if (!ok) allOk = false;
    rows.push(`${ct}: R=${r.toFixed(1)}px L=${k.hullLen} R/L=${ratio.toFixed(2)} 180=${K.turn180Seconds(k).toFixed(1)}s`);
  }
  console.log('    ' + rows.join('\n    '));
  check('所有战斗舰 R/L >= 1.0（旧值 0.69 是病根）', allOk);
  check('战列 R/L >= 1.5（重舰必须划大弯）', K.radiusRatio(K.SHIP_KINEMATICS['战列']) >= 1.5,
    K.radiusRatio(K.SHIP_KINEMATICS['战列']).toFixed(2));
}

console.log('\n=== B. 掉头时长：重舰是决策，轻舰是机动 ===');
{
  const t = {};
  for (const ct of ['战列', '高战', '巡洋', '驱逐', '空母', '突击', '电子', '补给']) {
    t[ct] = K.turn180Seconds(K.SHIP_KINEMATICS[ct]);
  }
  check('战列掉头 >= 12s（掉头是一次战术决策）', t['战列'] >= 12, t['战列'].toFixed(1) + 's');
  check('空母掉头 >= 25s（战斗中几乎无法转向）', t['空母'] >= 25, t['空母'].toFixed(1) + 's');
  check('驱逐掉头 <= 3s（快速迂回是它的专属价值）', t['驱逐'] <= 3, t['驱逐'].toFixed(1) + 's');
  check('巡洋居中（机动主力，5~8s）', t['巡洋'] >= 4 && t['巡洋'] <= 8, t['巡洋'].toFixed(1) + 's');
  check('重舰排序：战列 > 巡洋 > 驱逐（越重越慢转）',
    t['战列'] > t['巡洋'] && t['巡洋'] > t['驱逐']);
  check('补给最重（>=25s，后勤核心）', t['补给'] >= 25, t['补给'].toFixed(1) + 's');
}

console.log('\n=== C. 加速：推力有限性 ===');
{
  const a = {};
  for (const ct of ['战列', '巡洋', '驱逐', '空母', '补给']) a[ct] = K.speedRampSeconds(K.SHIP_KINEMATICS[ct]);
  check('战列 0→95% >= 6s（旧值 0.81s，快 8 倍）', a['战列'] >= 6, a['战列'].toFixed(1) + 's');
  // [W5.6] **双重护栏：上界锁住 v73/v75 感知校准值**。
  //   下半界（>=6s）防"起步过快失去质量感"；本上界（<=9.5s）防"顺手把 accel 调慢"——
  //   v73 才把战列 accel 从 0.0060 校准到 0.00042（ramp 0.81s→8.3s），v75 教训禁止单方面下调。
  //   ⚠ 若无本上界，把 accel 再砍半（ramp 16.6s）**不会触发任何断言** ⇒ 属"无台架保护的误改"。
  check('战列 0→95% <= 9.5s（锁住 v73 校准：起步不得再变慢）', a['战列'] <= 9.5, a['战列'].toFixed(1) + 's');
  // ramp = 达到 95% 速度的秒数，**越大 = 越慢起步 = 越重**
  check('加速排序：空母 > 战列 > 巡洋 > 驱逐（越重越慢起步）',
    a['空母'] > a['战列'] && a['战列'] > a['巡洋'] && a['巡洋'] > a['驱逐'],
    `空母${a['空母'].toFixed(1)} 战列${a['战列'].toFixed(1)} 巡洋${a['巡洋'].toFixed(1)} 驱逐${a['驱逐'].toFixed(1)}`);
  // [v73] 硬上限语义自洽：帧数 = 0.95·vMax/accel，与 speedRampSeconds 一致
  for (const ct of ['战列', '巡洋', '驱逐']) {
    const k = K.SHIP_KINEMATICS[ct];
    const frames = (0.95 * k.vMax) / k.accel;
    check(`${ct} accel 与 ramp 自洽（0.95·vMax/accel）`,
      Math.abs(K.speedRampSeconds(k) - frames / 60) < 0.05,
      `${frames.toFixed(0)}帧 / ${K.speedRampSeconds(k).toFixed(1)}s`);
  }
  check('补给起步最慢（>=12s）', a['补给'] >= 12, a['补给'].toFixed(1) + 's');
}

console.log('\n=== D. 高速舵效衰减（角速率随速度下降） ===');
{
  const kb = K.SHIP_KINEMATICS['战列'];
  const stopped = K.effectiveOmegaMax(kb, 0);
  const half = K.effectiveOmegaMax(kb, kb.vMax * 0.5);
  const full = K.effectiveOmegaMax(kb, kb.vMax);
  check('静止时 ω = 静态值', Math.abs(stopped - kb.omegaMax) < 1e-12, stopped.toFixed(5));
  check('全速时 ω 下降 45%', Math.abs(full - kb.omegaMax * 0.55) < 1e-12, full.toFixed(5));
  check('半速时 ω 单调居中', full < half && half < stopped);
  check('超速不产生负 ω（钳制）', K.effectiveOmegaMax(kb, kb.vMax * 5) > 0);
  // 全速掉头时间应进一步拉长
  const fullT = Math.PI / full * (1000 / 60) / 1000;
  check('战列全速掉头比静止更久（>=15s）', fullT >= 15, fullT.toFixed(1) + 's');
}

console.log('\n=== E. 舰队聚合：重舰决定航迹 ===');
{
  const BB = { classType: '战列', hp: 100 };
  const DD = { classType: '驱逐', hp: 100 };
  // 8 战列 + 2 驱逐：应接近战列（面积加权），不是算术平均
  const mixed = K.fleetProfile([...Array(8).fill(BB), ...Array(2).fill(DD)]);
  const pureBB = K.fleetProfile(Array(9).fill(BB));
  const pureDD = K.fleetProfile(Array(9).fill(DD));
  check('8战列+2驱逐 ≈ 纯战列（面积加权，非算术平均）',
    Math.abs(mixed.vMax - pureBB.vMax) / pureBB.vMax < 0.12,
    `mixed=${mixed.vMax.toFixed(3)} pureBB=${pureBB.vMax.toFixed(3)}`);
  check('算术平均会被驱逐拉走（对照：混合速度明显低于纯驱逐）',
    mixed.vMax < pureDD.vMax * 0.75, `${mixed.vMax.toFixed(3)} vs DD ${pureDD.vMax.toFixed(3)}`);
  check('主导舰种 = 战列', mixed.dominantClass === '战列', mixed.dominantClass);
  check('异质阵容被标记', mixed.heterogeneous === true);
  check('纯编队非同质', pureBB.heterogeneous === false);
}

console.log('\n=== F. 聚合边界：退化路径不崩 ===');
{
  check('空数组 → 兜底剖面', K.fleetProfile([]).vMax === K.EMPTY_FLEET_PROFILE.vMax);
  check('null → 兜底剖面', K.fleetProfile(null).vMax === K.EMPTY_FLEET_PROFILE.vMax);
  const supplyOnly = K.fleetProfile([{ classType: '补给', hp: 100 }]);
  check('纯补给编队 → 兜底（运输舰不参与战斗机动）',
    supplyOnly.vMax === K.EMPTY_FLEET_PROFILE.vMax);
  const allDead = K.fleetProfile([{ classType: '战列', hp: 0 }]);
  check('全沉没 → 兜底', allDead.vMax === K.EMPTY_FLEET_PROFILE.vMax);
  const unknown = K.fleetProfile([{ classType: '不存在的舰种', hp: 100 }]);
  check('未知舰种 → 兜底', unknown.vMax === K.EMPTY_FLEET_PROFILE.vMax);
  check('部分沉没只计存活者', K.fleetProfile([
    { classType: '战列', hp: 100 }, { classType: '战列', hp: 0 },
  ]).vMax > 0);
}

console.log('\n=== G. 舰长与部署期真源一致 ===');
{
  // BattleScene:1556-1560 部署期：战列/突击 33、巡洋/电子 25、补给 40、旗舰 42、其余 18
  const expect = { '战列': 33, '高战': 33, '突击': 33, '巡洋': 25, '电子': 25, '补给': 40, '空母': 42, '驱逐': 18, '舰载': 18 };  // BattleScene:1585-1593
  let ok = true;
  const bad = [];
  for (const [ct, len] of Object.entries(expect)) {
    if (K.SHIP_KINEMATICS[ct].hullLen !== len) { ok = false; bad.push(`${ct}:${K.SHIP_KINEMATICS[ct].hullLen}!=${len}`); }
  }
  check('本表 hullLen 与 BattleScene 部署期 shipLen 逐项一致', ok, bad.join(' '));
}

console.log('\n=== H. 查表：未知舰种不抛 ===');
{
  check('未知舰种返回兜底档案', K.kinematicsOf('航母') === K.DEFAULT_KINEMATICS);
  check('null 返回兜底档案', K.kinematicsOf(null) === K.DEFAULT_KINEMATICS);
  check('正确键返回真实档案', K.kinematicsOf('巡洋').vMax === 0.34);
  check('兜底档案 = 巡洋（机动主力，中间值）', K.DEFAULT_KINEMATICS.role === '机动主力');
}

console.log(`\n=== shipKinematicsSim: ${passed} PASS / ${failed} FAIL ===`);
process.exit(failed > 0 ? 1 : 0);
