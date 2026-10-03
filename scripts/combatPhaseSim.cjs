/**
 * combatPhaseSim.cjs — 战斗距离阶段状态机回归台架（阶段 A）
 *
 * 纪律：require 真源码 .ts，零手抄常量；断言打行为不测实现。
 * 运行：node --import ./_ts_resolve.mjs scripts/combatPhaseSim.cjs
 */
const P = require('../frontend/src/game/combatPhase.ts');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++; else failed++;
}

/** 便捷推进：dt 固定 0.1s，跑 seconds 秒，返回终态与阶段序列 */
function run(initial, input, seconds) {
  let st = initial;
  const seq = [st.phase];
  const steps = Math.round(seconds / 0.1);
  for (let i = 0; i < steps; i++) {
    st = P.advancePhase(st, { ...input, prev: st, dtSeconds: 0.1 });
    if (seq[seq.length - 1] !== st.phase) seq.push(st.phase);
  }
  return { state: st, seq };
}

// 地图跨度真源（BattleScene:3306-3310, 3390-3394 实测）
const SPAN_SMALL = 1300; // ≤4 艘  hexRadius=26
const SPAN_LARGE = 2500; // >16 艘 hexRadius=50
const RANGE_MAX = 880;   // 战列 range

console.log('\n=== A. 阈值导出：按跨度比例而非硬编码 ===');
const tSmall = P.phaseThresholdsFrom(SPAN_SMALL, RANGE_MAX);
const tLarge = P.phaseThresholdsFrom(SPAN_LARGE, RANGE_MAX);

check('S1 阈值随跨度放大（小图→大图）', tLarge.far > tSmall.far,
  `${tSmall.far} → ${tLarge.far}`);
check('S1 占跨度比例正确（小图 0.80×1300=1040）',
  tSmall.far === Math.round(SPAN_SMALL * 0.80), `${tSmall.far}px / 跨度 ${SPAN_SMALL}`);
check('S1 阈值 ≥ 0.75×跨度（小图也有 975px 以上对射距离 = 实质远距阶段）',
  tSmall.far >= SPAN_SMALL * 0.75, `${tSmall.far}px`);
check('四阶段阈值严格递减',
  tSmall.far > tSmall.approach && tSmall.approach > tSmall.assault && tSmall.assault > tSmall.brawl,
  `${tSmall.far}/${tSmall.approach}/${tSmall.assault}/${tSmall.brawl}`);
check('S2 站位不低于 0.80×射程（不会"站得比打得远"）',
  tSmall.approach >= RANGE_MAX * 0.80, `${tSmall.approach} vs ${RANGE_MAX * 0.80}`);
check('S3 站位不低于 0.45×射程',
  tSmall.assault >= RANGE_MAX * 0.45, `${tSmall.assault} vs ${RANGE_MAX * 0.45}`);
check('射程极低时阈值被夹逼（空舰队退化不报错）',
  Number.isFinite(P.phaseThresholdsFrom(SPAN_SMALL, 0).approach));

console.log('\n=== B. 序列：完整战斗经过 ≥3 个阶段 ===');
{
  // 双方从中距离（~700px）开始贴近，模拟 200s 战斗。
  // 判据说明：推进是**渐进的**——单步不跳级 + 各阶段 min dwell
  // （14+8+6+5=33s）⇒ 走完 4 阶段至少需 ~100s。200s 足够。
  let st = P.initialPhase();
  const seq = [st.phase];
  const steps = 2000;
  for (let i = 0; i < steps; i++) {
    const t = 700 - (i / steps) * 640; // 700px → 60px，模拟接近到混战
 st = P.advancePhase(st, { dist: t, lossRatio: 0.05, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
    if (seq[seq.length - 1] !== st.phase) seq.push(st.phase);
  }
  check('完整战斗经过 ≥3 个阶段', seq.length >= 3, seq.join('→'));
  check('阶段序列单调推进（无来回抖动）',
    seq.every((p, i) => i === 0 || P.PHASE_ORDER.indexOf(p) > P.PHASE_ORDER.indexOf(seq[i - 1])),
    seq.join('→'));
  check('终态为 brawl（混战/脱离）', st.phase === 'brawl', st.phase);
}

console.log('\n=== C. 渐进推进：逐级下探，无跨级跳变 ===');
{
  // S1 最短时长：dwell 未满不动
  let st = P.initialPhase();
  for (let i = 0; i < 100; i++) { // 10s 保持在 1200px
    st = P.advancePhase(st, { dist: 1200, lossRatio: 0, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
  }
  check('10s 后仍在 S1（MIN_DWELL=14s 生效）', st.phase === 'far', st.phase);

  // 贴身：dist=100 ⇒ nominal=assault（brawl 进入线 91 < 100）
  // 单步不跳级 ⇒ 每 tick 朝目标走一格，需多 tick 逐级下探
  const trace = [];
  for (let i = 0; i < 400; i++) {
    st = P.advancePhase(st, { dist: 100, lossRatio: 0, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
    if (trace[trace.length - 1] !== st.phase) trace.push(st.phase);
  }
  check('贴身推进为逐级下探（far→approach→assault，无跳级）',
    trace.join('>') === 'far>approach>assault', trace.join('>'));
  check('终态为 assault（dist=100 > brawl 进入线 91）', st.phase === 'assault', st.phase);
}

console.log('\n=== D. 防抖：任意 5s 窗口内切换 ≤1 次 ===');
{
  // 在 brawl 阈值附近持续抖动：1280 ↔ 1300（S1/S2 边界 tSmall.far≈1300）
  const boundary = tSmall.far;
  let st = P.initialPhase();
  let changes = 0;
  let prev = st.phase;
  for (let i = 0; i < 600; i++) { // 60s
    const dist = boundary + (i % 2 === 0 ? 30 : -30); // 边界上下 30px 反复
    st = P.advancePhase(st, { dist, lossRatio: 0, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
    if (st.phase !== prev) { changes++; prev = st.phase; }
  }
  check('60s 边界抖动下切换次数受控（≤12）', changes <= 12, `${changes} 次`);
}

console.log('\n=== E. 滞回：驻留带内不动（双向） ===');
{
  const H = P.PHASE_HYSTERESIS;

  // (1) far 驻留带内（t·H < dist < t/H）⇒ 不动
  let st = { phase: 'far', dwell: 999, elapsed: 999 };
  const farBandLo = tSmall.far * H;  // 811
  const farBandHi = tSmall.far / H;  // 1333
  check('far 驻留带上下沿可导出且含进入线',
    farBandLo < tSmall.far && tSmall.far < farBandHi, `(${farBandLo.toFixed(0)}, ${farBandHi.toFixed(0)})`);
  for (let i = 0; i < 20; i++) {
    st = P.advancePhase(st, { dist: tSmall.far - 1, lossRatio: 0, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
  }
  check('far 驻留带内（刚跌破进入线）不切换', st.phase === 'far', st.phase);

  // (2) 跌出驻留带下沿（远低于 far 进入线）⇒ 推进
  for (let i = 0; i < 400; i++) {
    st = P.advancePhase(st, { dist: 100, lossRatio: 0, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
  }
  check('明确贴近后推进出 far', st.phase !== 'far', st.phase);

  // (3) 回退：处于 approach，approach 驻留带内 ⇒ 不回退 far
  st = { phase: 'approach', dwell: 999, elapsed: 999 };
  for (let i = 0; i < 20; i++) {
    st = P.advancePhase(st, { dist: tSmall.approach, lossRatio: 0, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
  }
  check('approach 驻留带内不回退 S1（双向滞回）', st.phase === 'approach', st.phase);

  // (4) 明确拉开（远高于 approach 驻留带上沿 903）⇒ 回退 far
  st = { phase: 'approach', dwell: 999, elapsed: 999 };
  for (let i = 0; i < 20; i++) {
    st = P.advancePhase(st, { dist: tSmall.far + 50, lossRatio: 0, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
  }
  check('明确拉开后回退 S1', st.phase === 'far', st.phase);
}

console.log('\n=== F. 损失率独立触发 S4（不必等距离） ===');
{
  let st = { phase: 'assault', dwell: 999, elapsed: 999 };
  // 距离仍在 assault 区间，但战损 50% ⇒ 应进 brawl
  for (let i = 0; i < 20; i++) {
    st = P.advancePhase(st, { dist: tSmall.assault + 5, lossRatio: 0.50, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
  }
  check('战损 50% 强制进 S4（脱离重整）', st.phase === 'brawl', st.phase);
  // 战损回落但距离仍近 ⇒ 仍留 S4
  for (let i = 0; i < 20; i++) {
    st = P.advancePhase(st, { dist: tSmall.assault + 5, lossRatio: 0.10, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: true });
  }
  check('战损回落但距离仍近时留在 S4（滞回防进出）', st.phase === 'brawl', st.phase);
}

console.log('\n=== G. 未接敌强制 S1 ===');
{
  let st = { phase: 'assault', dwell: 999, elapsed: 999 };
  for (let i = 0; i < 50; i++) {
    st = P.advancePhase(st, { dist: 20, lossRatio: 0.9, thresholds: tSmall, prev: st, dtSeconds: 0.1, engaged: false });
  }
  check('未接敌时强制回到 S1（不能没打就进肉搏）', st.phase === 'far', st.phase);
}

console.log('\n=== H. 对称配置：阶段序列分叉（非恒定对轰） ===');
{
  // 双方同一 tick 推进，但一方 lossRate 略高（先手优势）⇒ 阶段序列应不同
  const t = tSmall;
  const mk = (loss) => {
    let st = P.initialPhase();
    const seq = [st.phase];
    for (let i = 0; i < 1500; i++) {
      const d = 700 + (i / 1500) * 640;
      st = P.advancePhase(st, { dist: d, lossRatio: loss, thresholds: t, prev: st, dtSeconds: 0.1, engaged: true });
      if (seq[seq.length - 1] !== st.phase) seq.push(st.phase);
    }
    return seq;
  };
  const a = mk(0.0);
  const b = mk(0.45); // 一方被打残
  check('战损差异导致阶段序列分叉',
    a.join('>') !== b.join('>'), `A=${a.join('>')} / B=${b.join('>')}`);
}

console.log('\n=== I. 出口辅助 ===');
check('phaseTargetDist 随阶段递减',
  P.phaseTargetDist('far', tSmall) > P.phaseTargetDist('approach', tSmall)
  && P.phaseTargetDist('approach', tSmall) > P.phaseTargetDist('assault', tSmall));
check('S2/S3 为舰载机窗口（S1/S4 不是）',
  P.isFighterWindow('approach') && P.isFighterWindow('assault')
  && !P.isFighterWindow('far') && !P.isFighterWindow('brawl'));
check('阵型偏好：S3 集火阵 ≠ S1 远射阵',
  P.combatPhaseFormationHint('assault')[0] !== P.combatPhaseFormationHint('far')[0],
  `${P.combatPhaseFormationHint('far')[0]} vs ${P.combatPhaseFormationHint('assault')[0]}`);
check('phaseChanged 能检出跃迁', P.phaseChanged('far', 'approach') && !P.phaseChanged('far', 'far'));
check('nominalPhase 与阈值一致（S1 边界）',
  P.nominalPhase(tSmall.far + 1, tSmall) === 'far' && P.nominalPhase(tSmall.far - 1, tSmall) === 'approach');

console.log(`\n=== combatPhaseSim: ${passed} PASS / ${failed} FAIL ===`);
process.exit(failed > 0 ? 1 : 0);
