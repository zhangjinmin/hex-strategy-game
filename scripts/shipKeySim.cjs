/**
 * shipKeySim.cjs — 舰种键「中英等价」台架
 *
 * 存在理由（这是本台架唯一的价值）：
 *   现有台架**全部喂中文键**，所以"战役轨传英文 classType ⇒ 战术表全查不到 ⇒ 静默空转"
 *   这个 bug 在整套台架里永远不会红。本文件把"英文键 ≡ 中文键"本身变成断言：
 *   同一组参数分别传 `SHIP_TYPE_CN` 的英文键与中文键，结果必须**逐位相同**，
 *   并且必须**不是退化值**（1.0 / 0 / EMPTY_FLEET_PROFILE）。
 *
 * 纪律：require 真源码 .ts，零手抄常量（键对从 `SHIP_TYPE_CN` 现取）；
 *   断言打行为/数值，不复制实现。
 *
 * 运行：node --import ./_ts_resolve.mjs scripts/shipKeySim.cjs
 */
const S = require('../frontend/src/config/shipScaling.ts');
const P = require('../frontend/src/config/shipTacticalProfile.ts');
const K = require('../frontend/src/config/shipKinematics.ts');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (cond) passed++; else failed++;
}

/** 键对：只从单一真源取，禁止在本文件手抄中英映射 */
const PAIRS = Object.entries(S.SHIP_TYPE_CN);      // [['battleship','战列'], …]

console.log('\n=== A. 键归一本身（7 键全测，不只 battleship）===');
{
  let enToCn = true, cnToEn = true, bad = [];
  for (const [en, cn] of PAIRS) {
    if (S.resolveClassTypeCn(en) !== cn) { enToCn = false; bad.push(`${en}→${S.resolveClassTypeCn(en)}`); }
    if (S.resolveShipType(cn) !== en) { cnToEn = false; bad.push(`${cn}→${S.resolveShipType(cn)}`); }
  }
  check(`${PAIRS.length} 键 英文 → 中文`, enToCn, bad.join(' '));

  // 往返：cn → en → cn 与 en → cn → en
  let roundTrip = true;
  const rtBad = [];
  for (const [en, cn] of PAIRS) {
    const back = S.resolveClassTypeCn(S.resolveShipType(cn));
    if (back !== cn) { roundTrip = false; rtBad.push(`${cn}→${back}`); }
    const back2 = S.resolveShipType(S.resolveClassTypeCn(en));
    if (back2 !== en) { roundTrip = false; rtBad.push(`${en}→${back2}`); }
  }
  check('7 键双向往返（cn→en→cn / en→cn→en）', roundTrip, rtBad.join(' '));

  check('幂等：resolveClassTypeCn(resolveClassTypeCn(en)) === cn',
    PAIRS.every(([en, cn]) => S.resolveClassTypeCn(S.resolveClassTypeCn(en)) === cn));
  check("战术专有舰种原样返回：'电子'", S.resolveClassTypeCn('电子') === '电子');
  check("战术专有舰种原样返回：'突击'", S.resolveClassTypeCn('突击') === '突击');
  check("未知键原样返回：'航母'（历史错字必须继续走 fallback，不能被猜成空母）",
    S.resolveClassTypeCn('航母') === '航母');
  let threw = false;
  try { S.resolveClassTypeCn(undefined); S.resolveClassTypeCn(null); } catch { threw = true; }
  check('undefined / null 不抛错', !threw);
}

console.log('\n=== B. 三向装甲：英文键 ≡ 中文键，且不是 1.0 退化 ===');
{
  let same = true, notDegenerate = true;
  const rows = [];
  for (const [en, cn] of PAIRS) {
    for (const side of ['side', 'rear']) {
      const a = P.dirArmorMul(side, en);
      const b = P.dirArmorMul(side, cn);
      if (a !== b) { same = false; rows.push(`${en}/${side}: ${a} != ${b}`); }
      // '舰载' 是三向各向同性（表里登记为 null）⇒ 1.0 是正确值，不算退化；
      // 其余舰种必须有真实倍率，否则就是"查不到表 ⇒ if(!prof) return 1.0"又回来了。
      if (en !== 'fighter' && !(a > 1.0)) { notDegenerate = false; rows.push(`${en}/${side} 退化=${a}`); }
    }
  }
  check('side / rear 两档 × 7 键：英文键与中文键逐位相同', same, rows.join(' '));
  check('除舰载（各向同性）外，倍率均 > 1.0（不是查表失败的 1.0）', notDegenerate, rows.join(' '));
  // 正面恒 1.0 是设计值：这里只锁"不因键口径而变"
  check('front 恒 1.0（与键口径无关）',
    PAIRS.every(([en, cn]) => P.dirArmorMul('front', en) === P.dirArmorMul('front', cn)));
}

console.log('\n=== C. 防空拦截：英文键 ≡ 中文键，且不是 0 退化 ===');
{
  const rate = (ct) => P.fleetInterceptRate([{ classType: ct }]);
  const en3 = P.fleetInterceptRate([{ classType: 'cruiser' }, { classType: 'battleship' }, { classType: 'destroyer' }]);
  const cn3 = P.fleetInterceptRate([{ classType: '巡洋' }, { classType: '战列' }, { classType: '驱逐' }]);
  check('巡洋（全表最高 150）：英文 ≠ 中文', rate('cruiser') === rate('巡洋'), `${rate('cruiser')}`);
  check('单舰巡洋拦截率 > 0（不是查表失败的 0）', rate('cruiser') > 0, `${rate('cruiser')}`);
  check('三舰混编：英文键与中文键逐位相同', en3 === cn3, `${en3}`);
  check('三舰混编拦截率 > 0', en3 > 0);
  let perKey = true;
  const bad = [];
  for (const [en, cn] of PAIRS) {
    if (rate(en) !== rate(cn)) { perKey = false; bad.push(`${en}:${rate(en)}!=${rate(cn)}`); }
  }
  check('7 键逐项：英文键与中文键逐位相同', perKey, bad.join(' '));
  check('未知键仍 0（原 fallback 不变）', P.fleetInterceptRate([{ classType: '航母' }]) === 0);
}

console.log('\n=== D. 距离带：英文键 ≡ 中文键 ===');
{
  let same = true;
  const bad = [];
  for (const [en, cn] of PAIRS) {
    const a = P.getShipPreferredBand(en);
    const b = P.getShipPreferredBand(cn);
    if (JSON.stringify(a) !== JSON.stringify(b)) { same = false; bad.push(`${en}:${JSON.stringify(a)}!=${JSON.stringify(b)}`); }
  }
  check('7 键偏好带数组逐项相同', same, bad.join(' '));
  check("空母（'carrier'）返回数组而非 null", Array.isArray(P.getShipPreferredBand('carrier')),
    JSON.stringify(P.getShipPreferredBand('carrier')));
  check('未知键仍返回 null（中性，原行为）', P.getShipPreferredBand('航母') === null);
}

console.log('\n=== E. 舰队运动学：不退化 + 加权真生效 ===');
{
  const mixEn = [
    ...Array(8).fill({ classType: 'battleship', hp: 1000 }),
    ...Array(2).fill({ classType: 'destroyer', hp: 400 }),
  ];
  const mixCn = [
    ...Array(8).fill({ classType: '战列', hp: 1000 }),
    ...Array(2).fill({ classType: '驱逐', hp: 400 }),
  ];
  const en = K.fleetProfile(mixEn);
  const cn = K.fleetProfile(mixCn);
  const single = K.fleetProfile(Array(10).fill({ classType: 'battleship', hp: 1000 }));
  const E = K.EMPTY_FLEET_PROFILE;

  check('8 战列 + 2 驱逐：英文键与中文键全字段逐位相同',
    en.vMax === cn.vMax && en.omegaMax === cn.omegaMax && en.accel === cn.accel
    && en.alphaMax === cn.alphaMax && en.radius === cn.radius
    && en.dominantClass === cn.dominantClass && en.heterogeneous === cn.heterogeneous,
    `vMax ${en.vMax} / ${cn.vMax}`);
  check('vMax 严格大于 EMPTY_FLEET_PROFILE.vMax（不是全 skip 的退化）',
    en.vMax > E.vMax, `${en.vMax} > ${E.vMax}`);
  check('omegaMax 严格大于 EMPTY（不是全 skip 的退化）',
    en.omegaMax > E.omegaMax, `${en.omegaMax} > ${E.omegaMax}`);
  check('accel 不等于 EMPTY（EMPTY 的 accel 是旧硬上限口径，比真实战列大一个量级：退化会掩盖）',
    en.accel !== E.accel && en.accel < E.accel, `${en.accel} vs ${E.accel}`);
  check('dominantClass = 战列（重舰决定航迹）', en.dominantClass === '战列', en.dominantClass);
  check('heterogeneous = true（识别出两种 R/L）', en.heterogeneous === true);

  // 加权真生效：混编 ≠ 纯战列（否则又回到"五舰种同质"）
  check('混编 vMax ≠ 纯 10 战列 vMax（hullLen² 加权生效）',
    en.vMax !== single.vMax, `${en.vMax} vs ${single.vMax}`);
  check('纯战列 10 艘 = 战列档案原值（无稀释；浮点用 1e-12 容差）',
    Math.abs(single.vMax - K.SHIP_KINEMATICS['战列'].vMax) < 1e-12 && single.heterogeneous === false);

  let perKey = true;
  const bad = [];
  for (const [enKey, cnKey] of PAIRS) {
    if (enKey === 'supply') continue;   // 补给被显式排除在战斗机动之外（预期 − 不参与加权）
    const a = K.fleetProfile(Array(4).fill({ classType: enKey, hp: 100 }));
    const b = K.fleetProfile(Array(4).fill({ classType: cnKey, hp: 100 }));
    if (a.vMax !== b.vMax || a.omegaMax !== b.omegaMax) { perKey = false; bad.push(`${enKey}:${a.vMax}!=${b.vMax}`); }
  }
  check('6 个战斗舰种逐项：英文键剖面 = 中文键剖面', perKey, bad.join(' '));
  check('补给单舰种仍被排除（走 EMPTY，与中文键同一条分支）',
    K.fleetProfile([{ classType: 'supply', hp: 100 }]).vMax === E.vMax
    && K.fleetProfile([{ classType: '补给', hp: 100 }]).vMax === E.vMax);
  check('已沉没单位（hp<=0）仍不参与加权（与键口径无关）',
    K.fleetProfile([{ classType: 'battleship', hp: 0 }]).vMax === E.vMax);
  check("kinematicsOf('destroyer') === kinematicsOf('驱逐')",
    K.kinematicsOf('destroyer').vMax === K.kinematicsOf('驱逐').vMax,
    `${K.kinematicsOf('destroyer').vMax}`);
}

console.log('\n=== F. 表仍以中文为唯一键（禁止把英文键塞进表里当第二真源）===');
{
  const leak = [];
  for (const [en] of PAIRS) {
    if (en === 'fighter') continue;                 // 舰载在装甲表里合法登记为 null（各向同性）
    if (Object.prototype.hasOwnProperty.call(P.SHIP_ARMOR, en)) leak.push(`SHIP_ARMOR.${en}`);
    if (Object.prototype.hasOwnProperty.call(P.SHIP_INTERCEPT, en)) leak.push(`SHIP_INTERCEPT.${en}`);
    if (Object.prototype.hasOwnProperty.call(K.SHIP_KINEMATICS, en)) leak.push(`SHIP_KINEMATICS.${en}`);
  }
  check('三张中文表都不含英文键（归一只有一处）', leak.length === 0, leak.join(' '));
  check('反证：直查英文键取不到（这正是归一存在的理由）',
    P.SHIP_ARMOR['cruiser'] === undefined
    && P.SHIP_INTERCEPT['destroyer'] === undefined
    && K.SHIP_KINEMATICS['carrier'] === undefined);
}

console.log(`\n=== shipKeySim: ${passed} PASS / ${failed} FAIL ===`);
process.exit(failed > 0 ? 1 : 0);
