#!/usr/bin/env node
'use strict';
/**
 * orbitAudit.cjs — 「绕圈」审计器（纯数据 → 指标，**零 src 依赖**）
 *
 * 背景：用户实报「舰队开局正对敌舰开火，随后整体转动、像绕圆心转，最后舷侧对敌」。
 *   本脚本把「看录屏凭感觉」变成「一份可复跑的样本 + 一条可断言的判据」。
 *
 * 用法
 *   node scripts/orbitAudit.cjs <samples.json>        # 审计实测样本
 *   node scripts/orbitAudit.cjs --selftest            # 合成样本自测（无样本也能跑）
 *   node scripts/orbitAudit.cjs <samples.json> --windows   # 额外按子窗定位
 *
 * 输入契约（`window.__fleetTrack()` 的 JSON；数组或 { samples: [...] } 皆可）
 *   { t, id, x, y, ff, fs, off, d, band, bow, phase, fireSeq, enemyId, angleDiff,
 *     stance?, engaged?, retreatTier?, motion? }
 *   · t         : **模拟秒**（不是墙钟、不是帧号）。必须与 `updateContact` 同一时钟。
 *   · ff / fs   : 弧度。`formFacing`（阵面朝向）/ `facingSmooth`（舰首）。
 *   · off       : 弧度，**带符号**，= wrap(敌方位 − fs)。缺它无法判「舷侧」。
 *   · d         : 到最近敌的距离（px）。
 *   · fireSeq   : 单调递增的开火计数（**不要**传 `weaponsFired`，那是闩锁）。
 *   · angleDiff : |wrap((敌方位+π) − 敌方舰首)|；0=敌正对我，π=敌背对我。
 *   · phase     : 'cruise'|'brake'|'turn'|'reform'|'disengage'（可选，缺省视为 cruise）。
 *   · stance / engaged / retreatTier / motion：可选；缺失时对应豁免不生效（会打 WARN）。
 *
 * 为什么用 `ff` 而不是舰队中心轨迹：
 *   「绕圆心转」的圆心是**编队质心**，舰队中心的位移可能接近 0，真正在转的是槽位。
 *   用中心位移写的 orbitRatio 结构性测不到该症状（3 秒窗口只有约 40px，噪声级）。
 *   故主判据用**姿态角 Δff**，中心轨迹只用于「有没有走出一条路」的辅助判定。
 *
 * 退出码（**空样本的 0 命中必须与"确实没绕圈"可区分**）：
 *   0 = 样本可用且未命中
 *   1 = 样本可用且命中 F1/F2（可 gate）
 *   2 = 参数 / 读取错误
 *   3 = **结论不可用**（样本量不足 / 总时长 < 10s / BLOCKED 占比 > 50%）——不是通过
 */

const fs = require('node:fs');

// ══════════════════════════════════════════════════════════════════════
// A. 阈值（全部具名；每条都写清「为什么取这个值」）
// ══════════════════════════════════════════════════════════════════════

/**
 * F1：姿态净转 ≥ 90° 判「转了一大圈」。
 * 取 90° 而非 45°：`turnDiscipline` 的 denied 档单次修正上限就是 45°，90° 已是它的两倍；
 * 且 90° 是肉眼能明确说出「整队转过来了」的下限。
 */
const F1_SPIN_DEG = 90;

/**
 * F1：中心路径长 < 0.25×R 判「几乎没挪窝」。
 * R≈760px（战列理想交战距）⇒ 190px ≈ 14 秒巡航（vMax 0.22px/帧@60fps ≈ 13.2px/s）。
 * 低于它说明舰队没有走出「一条自己的路」，只是原地打转。
 * 用比例而非绝对值：地图缩放 / 舰种编成都会改 R。
 */
const F1_PATH_FRAC = 0.25;

/**
 * F2：绕敌方位净转 ≥ 90° 判「绕飞」。
 * 与 F1 同源（可见的"半圈"），但量的是**相对敌人**的方位，抓的是"绕着敌人兜圈"。
 */
const F2_SWEEP_DEG = 90;

/**
 * F2：首末距离相对变化 < 15% 判「距离没变」。
 * 取 15%：`RANGE_BAND` 的滞回只有 ±5%，而 `_mPhase` 的换带阈值是 0.35/0.70（65%+）——
 * 15% 落在两者之间，是「既没换带、也不是被滞回抖出来的」保守值。
 */
const F2_DRIFT_FRAC = 0.15;

/**
 * 豁免：`brake/turn/reform` 样本占比 > 30% ⇒ 整段跳过。
 * 这三个相 `motion='hold'`，本来就"不该动"；用原地转向去判绕圈是假阳性。
 * 30% 而非 50%：只要机动协议占了近三分之一时长，其余样本的几何意义已被污染。
 */
const EX_MANEUVER_FRAC = 0.30;

/**
 * 豁免（仅 F1）：`bow===1`（停船回瞄态）样本占比 > 10% ⇒ 跳过 F1。
 * 回瞄会让姿态缓慢旋转而中心几乎不动 —— 形态与"原地公转"完全一致，无法用几何区分。
 * 该形态属"阵面 ≡ 舰首"（P1-1）的已知债务，不在本轮判。
 */
const EX_BOWAIM_FRAC = 0.10;

/**
 * 豁免：撤退/倒退样本占比 > 10% ⇒ 跳过。
 * 「拖刀」「拉开距离」是合法的姿态与位移分离，`motion==='reverse'` 或 `retreatTier!=='none'` 即豁免。
 * 采样缺这两个字段时本豁免**不生效**，并在输出里打 WARN（宁可漏豁免，不要假绿）。
 */
const EX_RETREAT_FRAC = 0.10;

/**
 * 判「进入敌后半球」：`angleDiff > 120°`。
 * `angleDiff` 是"敌方舰首 vs 敌→我方位"的夹角：0=敌正对我，π=敌背对我。
 * 120° 对应"我大致位于敌后方扇区"（留 60° 余量给判定抖动）。
 * 进入即视为**真包抄**，F1/F2 全部豁免 —— 这是唯一"看起来像绕圈但其实正确"的形态。
 */
const REAR_ENTER_DEG = 120;

/** 样本量下限：少于 20 条（≈0.33s@60fps）不足以算路径长。 */
const MIN_SAMPLES = 20;
/** 片段时长下限（模拟秒）：短于此的片段不判（起步/收尾的边界段）。 */
const MIN_DURATION_SEC = 2;
/** 相邻样本时间间隔超过此值（模拟秒）⇒ 断成两个片段（暂停 / 跳帧）。 */
const EPISODE_GAP_SEC = 1.0;
/** 子窗：路径长达到 0.5×R 切一段（用于 --windows 定位）。 */
const WINDOW_PATH_FRAC = 0.5;
/** 子窗时长上限（模拟秒）。 */
const WINDOW_MAX_SEC = 60;

/**
 * 可用性门槛：**空样本的 0 命中必须与"确实没绕圈"在输出上可区分**。
 * 否则"没测"会被读成"通过"——这与"缺字段当 0"是同一个错误，只是发生在样本层。
 *   · 需要至少 1 个可用片段；
 *   · 全部可用片段的模拟时长合计 ≥ 10s（≈一次接战的量级，短于此无法覆盖一次转向）；
 *   · BLOCKED 片段占比 ≤ 50%（过半测不了 ⇒ 整体结论不可信）。
 * 不满足 ⇒ 结论行打「结论不可用」并 exit 3（与 0=通过 / 1=命中 区分）。
 */
const MIN_TOTAL_SIM_SEC = 10;
const MAX_BLOCKED_RATIO = 0.5;

const RAD2DEG = 180 / Math.PI;
const deg = (rad) => rad * RAD2DEG;
const wrapPi = (a) => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
};
const hypot = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
const frac = (arr, pred) => (arr.length === 0 ? 0 : arr.filter(pred).length / arr.length);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ══════════════════════════════════════════════════════════════════════
// B. 分组：样本 → 交战片段（episode）
// ══════════════════════════════════════════════════════════════════════

/**
 * 片段切分规则（不是"3 秒窗口"）：
 *   `enemyId` 连续相同 && `stance` 不变 && `engaged` 为真 && 采样间隔 < EPISODE_GAP_SEC。
 * 为什么不按固定时长：本作 vMax≈13.2px/s，3 秒只有约 40px（≈一艘战列的长度），
 * 短窗口的路径长全在量化噪声里；按"同一交战关系"切段，几何量才有意义。
 */
function buildEpisodes(samples) {
  const byFleet = new Map();
  for (const s of samples) {
    if (!finite(s.t) || !finite(s.x) || !finite(s.y)) continue;
    if (!byFleet.has(s.id)) byFleet.set(s.id, []);
    byFleet.get(s.id).push(s);
  }
  const episodes = [];
  for (const [id, arr] of byFleet) {
    arr.sort((a, b) => a.t - b.t);
    let cur = [];
    const flush = () => {
      if (cur.length) episodes.push({ id, samples: cur });
      cur = [];
    };
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      const p = cur[cur.length - 1];
      let cut = false;
      if (p) {
        if (s.enemyId !== p.enemyId) cut = true;
        else if ((s.stance ?? null) !== (p.stance ?? null)) cut = true;
        else if (s.engaged === false || p.engaged === false) cut = true;
        else if (s.t - p.t > EPISODE_GAP_SEC) cut = true;
      }
      if (cut) flush();
      cur.push(s);
    }
    flush();
  }
  return episodes;
}

// ══════════════════════════════════════════════════════════════════════
// C. 单片段指标
// ══════════════════════════════════════════════════════════════════════

function unwrapTotal(values) {
  if (values.length < 2) return 0;
  let prev = values[0];
  let sum = 0;
  for (let i = 1; i < values.length; i++) {
    sum += wrapPi(values[i] - prev);
    prev = values[i];
  }
  return sum;
}

function analyzeEpisode(ep) {
  const s = ep.samples;
  const first = s[0];
  const last = s[s.length - 1];
  const duration = last.t - first.t;

  let pathLen = 0;
  for (let i = 1; i < s.length; i++) {
    pathLen += hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  }
  const netDisp = hypot(last.x - first.x, last.y - first.y);

  // β = fs + off：只信 off 的符号语义（off 缺失时退化为 beta=fs，并在输出 WARN）
  const beta = s.map((r) => (finite(r.off) && finite(r.fs) ? r.fs + r.off : r.fs));
  const dFf = deg(unwrapTotal(s.map((r) => r.ff)));
  const dBeta = deg(unwrapTotal(beta));

  const dArr = s.map((r) => r.d).filter(finite);
  const dMean = dArr.length ? dArr.reduce((a, b) => a + b, 0) / dArr.length : 0;
  const dStart = finite(first.d) ? first.d : dMean;
  const dEnd = finite(last.d) ? last.d : dMean;
  const drift = dMean > 0 ? Math.abs(dEnd - dStart) / Math.max(1e-6, dStart) : 1;

  const fireSeqKnown = s.every((r) => finite(r.fireSeq));
  const dFire = fireSeqKnown ? last.fireSeq - first.fireSeq : 0;

  // 字段完整性：缺字段时**不判**（INCONCLUSIVE），而不是当成 0 —— 假绿比报错危险。
  const offKnown = s.every((r) => finite(r.off));
  const dKnown = s.every((r) => finite(r.d));
  const phaseKnown = s.some((r) => typeof r.phase === 'string');

  // 「进入」敌后半球 = 由 ≤120° 跨到 >120°；整段都在敌后不算「进入」
  let enteredRear = false;
  let rearLatched = false;
  for (let i = 0; i < s.length; i++) {
    if (!finite(s[i].angleDiff)) continue;
    const isRear = deg(s[i].angleDiff) > REAR_ENTER_DEG;
    if (isRear && !rearLatched) {
      if (i > 0) enteredRear = true;
      rearLatched = true;
    } else if (!isRear) {
      rearLatched = false;
    }
  }

  const bandChanged = first.band !== last.band;
  const fManeuver = frac(s, (r) => r.phase === 'brake' || r.phase === 'turn' || r.phase === 'reform');
  const fCruise = frac(s, (r) => (r.phase ?? 'cruise') === 'cruise');
  const fBowAim = frac(s, (r) => r.bow === 1);
  const hasRetreatField = s.some((r) => 'retreatTier' in r || 'motion' in r);
  const fRetreat = hasRetreatField
    ? frac(s, (r) => (r.retreatTier && r.retreatTier !== 'none') || r.motion === 'reverse')
    : 0;

  const m = {
    id: ep.id, t0: first.t, t1: last.t, duration,
    dFf, dBeta, pathLen, netDisp, dMean, drift, dFire,
    fireSeqKnown, offKnown, dKnown, phaseKnown,
    enteredRear, bandChanged, fManeuver, fCruise, fBowAim, fRetreat, hasRetreatField,
    samples: s,
  };

  m.valid = s.length >= MIN_SAMPLES && duration >= MIN_DURATION_SEC;
  m.exManeuver = fManeuver > EX_MANEUVER_FRAC;
  m.exBowAim = fBowAim > EX_BOWAIM_FRAC;
  m.exRetreat = fRetreat > EX_RETREAT_FRAC;
  m.exRear = enteredRear || bandChanged;

  // 缺字段 ⇒ 不判（BLOCKED），不当成 0。与放行卡 §0 的口径一致。
  const inc = [];
  if (!m.valid) inc.push('样本不足/时长过短');
  if (!fireSeqKnown) inc.push('fireSeq 缺失');
  if (!phaseKnown) inc.push('phase 缺失（无法排除原地转向）');
  if (!dKnown) inc.push('d 缺失（无法判距离不变性）');
  const incF1 = inc.slice();
  const incF2 = inc.slice();
  if (!offKnown) incF2.push('off 缺失（Δβ 退化为 Δfs，会误判）');
  m.inconclusiveF1 = incF1;
  m.inconclusiveF2 = incF2;

  m.f1 = incF1.length === 0
    && Math.abs(dFf) >= F1_SPIN_DEG
    && pathLen < F1_PATH_FRAC * Math.max(1, dMean)
    && dFire === 0
    && fCruise >= 1 - EX_MANEUVER_FRAC
    && !m.exManeuver && !m.exBowAim && !m.exRetreat && !m.exRear;

  m.f2 = incF2.length === 0
    && Math.abs(dBeta) >= F2_SWEEP_DEG
    && drift < F2_DRIFT_FRAC
    && dFire === 0
    && fCruise >= 1 - EX_MANEUVER_FRAC
    && !m.exManeuver && !m.exRetreat
    && !enteredRear && !bandChanged;

  return m;
}

/** 定位：片段内姿态净转首次达到 F1_SPIN_DEG 的时刻（用于打印"触发的样本区间"）。 */
function spinReachTime(m) {
  const s = m.samples;
  let prev = s[0].ff;
  let acc = 0;
  for (let i = 1; i < s.length; i++) {
    acc += wrapPi(s[i].ff - prev);
    prev = s[i].ff;
    if (Math.abs(deg(acc)) >= F1_SPIN_DEG) return { t: s[i].t, acc: deg(acc) };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// D. 报告
// ══════════════════════════════════════════════════════════════════════

function fmt(n, digits = 1) {
  if (!Number.isFinite(n)) return 'NaN';
  return n.toFixed(digits);
}

function hitReasons(m, which) {
  const r = [];
  if (which === 'F1') {
    if (Math.abs(m.dFf) >= F1_SPIN_DEG) r.push(`|Δff|=${fmt(Math.abs(m.dFf))}°≥${F1_SPIN_DEG}°`);
    if (m.pathLen < F1_PATH_FRAC * Math.max(1, m.dMean)) r.push(`pathLen=${fmt(m.pathLen)}px<${fmt(F1_PATH_FRAC * m.dMean)}px`);
  } else {
    if (Math.abs(m.dBeta) >= F2_SWEEP_DEG) r.push(`|Δβ|=${fmt(Math.abs(m.dBeta))}°≥${F2_SWEEP_DEG}°`);
    if (m.drift < F2_DRIFT_FRAC) r.push(`距离漂移=${fmt(m.drift * 100)}%<${F2_DRIFT_FRAC * 100}%`);
  }
  if (m.dFire === 0) r.push('ΔfireSeq=0');
  return r;
}

function exemptReasons(m) {
  const r = [];
  if (m.exManeuver) r.push(`机动协议占比=${fmt(m.fManeuver * 100, 0)}%`);
  if (m.exBowAim) r.push(`回瞄态占比=${fmt(m.fBowAim * 100, 0)}%`);
  if (m.exRetreat) r.push(`撤退/倒退占比=${fmt(m.fRetreat * 100, 0)}%`);
  if (m.enteredRear) r.push('进入敌后半球（真包抄）');
  if (m.bandChanged) r.push('距离带变化');
  return r;
}

function printEpisode(m) {
  const blocked = !m.f1 && !m.f2 && (m.inconclusiveF1.length > 0 || m.inconclusiveF2.length > 0);
  const tag = m.f1 && m.f2 ? 'F1+F2 ' : m.f1 ? 'F1 HIT' : m.f2 ? 'F2 HIT' : blocked ? 'BLOCKED' : 'ok    ';
  console.log(
    `  ${tag} fleet=${m.id} t=${fmt(m.t0)}..${fmt(m.t1)}s (${fmt(m.duration)}s)  `
    + `Δff=${fmt(m.dFf)}° Δβ=${fmt(m.dBeta)}° path=${fmt(m.pathLen)}px net=${fmt(m.netDisp)}px `
    + `R̄=${fmt(m.dMean)}px drift=${fmt(m.drift * 100)}% Δfire=${m.dFire}`,
  );
  if (m.f1) console.log(`        F1 命中原因: ${hitReasons(m, 'F1').join(' / ')}`);
  if (m.f2) console.log(`        F2 命中原因: ${hitReasons(m, 'F2').join(' / ')}`);
  if (blocked) {
    const why = Array.from(new Set([...m.inconclusiveF1, ...m.inconclusiveF2]));
    console.log(`        [BLOCKED] 缺字段/样本不足，不判: ${why.join(' / ')}`);
  }
  if ((m.f1 || m.f2) && m.f1) {
    const reach = spinReachTime(m);
    if (reach) console.log(`        触发区间: t=${fmt(m.t0)}..${fmt(reach.t)}s（姿态净转 ${fmt(reach.acc)}°）`);
  } else if (!m.f1 && !m.f2 && !blocked && exemptReasons(m).length) {
    console.log(`        豁免: ${exemptReasons(m).join(' / ')}`);
  }
  if (!m.hasRetreatField) console.log('        [WARN] retreatTier/motion 缺失 ⇒ 撤退豁免未生效');
}

// ══════════════════════════════════════════════════════════════════════
// E. 合成自测（没有 selftest 的审计脚本等于没有牙齿）
// ══════════════════════════════════════════════════════════════════════

/**
 * 合成样本。
 *   sweepBetaDeg   : 敌方位 β 从 0 线性扫到该值（β 是"我在敌的哪个方位"）。
 *   sweepFfDeg     : `formFacing` 从 0 线性扫到该值（姿态角，F1 的被测量）。
 *   angleDiffFrom/To: |wrap((β+π) − 敌方舰首)|，用来构造"进入敌后半球"的跨度。
 *   moving         : static（原地）/ arc（绕敌圆弧，半径 d）/ line（直线）。
 * fs = β − off，off 恒 +20° ⇒ 由 fs+off 反算 β 能逐位还原（验证"β 从 off 来"的契约）。
 */
function synth({
  durationSec = 6, hz = 60, d = 760, sweepBetaDeg = 0, sweepFfDeg = 0,
  angleDiffFrom = 20, angleDiffTo = 20,
  moving = 'static', fireSeq = 0, bow = 0, phase = 'cruise', band = 'mid', id = 1, enemyId = 7,
}) {
  const n = Math.max(MIN_SAMPLES + 1, Math.round(durationSec * hz));
  const out = [];
  const OFF = (20 * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const t = u * durationSec;
    const beta = (u * sweepBetaDeg * Math.PI) / 180;
    const fs = beta - OFF;
    let x = 0;
    let y = 0;
    if (moving === 'arc') {
      x = d * Math.cos(beta);
      y = d * Math.sin(beta);
    } else if (moving === 'line') {
      x = u * 200;
    }
    out.push({
      t, id, x, y,
      ff: (u * sweepFfDeg * Math.PI) / 180,
      fs,
      off: OFF,
      d,
      band,
      bow,
      phase,
      fireSeq,
      enemyId,
      angleDiff: ((angleDiffFrom + (angleDiffTo - angleDiffFrom) * u) * Math.PI) / 180,
    });
  }
  return out;
}

function selftest() {
  let pass = 0;
  let fail = 0;
  const check = (name, cond, detail = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
    cond ? pass++ : fail++;
  };

  console.log('\n=== [合成自测] A. 原地转 120°、没挪窝、没开火 ⇒ F1 必须命中 ===');
  {
    const m = analyzeEpisode({ id: 1, samples: synth({ sweepFfDeg: 120, moving: 'static' }) });
    check('F1 命中', m.f1 === true, `Δff=${fmt(m.dFf)}° path=${fmt(m.pathLen)}px`);
    check('F2 不命中（方位没绕敌人转）', m.f2 === false);
  }

  console.log('\n=== [合成自测] B. 真包抄到敌后半球（绕弧 110°）⇒ F1/F2 必须都不命中 ===');
  {
    const m = analyzeEpisode({
      id: 1,
      samples: synth({
        durationSec: 10, moving: 'arc', sweepBetaDeg: 110, sweepFfDeg: 110,
        angleDiffFrom: 30, angleDiffTo: 130,
      }),
    });
    check('F1 不命中', m.f1 === false, `path=${fmt(m.pathLen)}px`);
    check('F2 不命中', m.f2 === false, `enteredRear=${m.enteredRear}`);
    check('确实进入敌后半球', m.enteredRear === true, `angleDiff 30°→130°`);
  }

  console.log('\n=== [合成自测] B2. 原地转 120° 但确实进入敌后 ⇒ F1 必须被"真包抄"豁免 ===');
  {
    const m = analyzeEpisode({
      id: 1,
      samples: synth({ sweepFfDeg: 120, moving: 'static', angleDiffFrom: 30, angleDiffTo: 130 }),
    });
    check('F1 不命中', m.f1 === false);
    check('豁免命中', m.exRear === true);
  }

  console.log('\n=== [合成自测] C. 绕敌 100°、距离没变、没开火、没进敌后 ⇒ F2 必须命中 ===');
  {
    const m = analyzeEpisode({
      id: 1,
      samples: synth({
        durationSec: 10, moving: 'arc', sweepBetaDeg: 100, sweepFfDeg: 100,
        angleDiffFrom: 20, angleDiffTo: 60,
      }),
    });
    check('F2 命中', m.f2 === true, `Δβ=${fmt(m.dBeta)}° drift=${fmt(m.drift * 100)}%`);
  }

  console.log('\n=== [合成自测] D. 机动协议占多数 ⇒ 必须豁免 ===');
  {
    const m = analyzeEpisode({
      id: 1,
      samples: synth({ sweepFfDeg: 180, moving: 'static', phase: 'turn' }),
    });
    check('F1 不命中', m.f1 === false);
    check('豁免命中', m.exManeuver === true, `fManeuver=${fmt(m.fManeuver * 100)}%`);
  }

  console.log('\n=== [合成自测] E. 有开火 ⇒ 不得判为无效绕圈 ===');
  {
    const base = synth({ sweepFfDeg: 120, moving: 'static' });
    base.forEach((s, i) => { s.fireSeq = i > base.length / 2 ? 5 : 0; });
    const m = analyzeEpisode({ id: 1, samples: base });
    check('F1 不命中（有输出）', m.f1 === false, `Δfire=${m.dFire}`);
  }

  console.log('\n=== [合成自测] F. 缺 fireSeq ⇒ 必须 BLOCKED，不得命中（假绿比报错危险）===');
  {
    const base = synth({ sweepFfDeg: 120, moving: 'static' });
    base.forEach((s) => { delete s.fireSeq; });
    const m = analyzeEpisode({ id: 1, samples: base });
    check('F1 不命中', m.f1 === false);
    check('标记 BLOCKED', m.inconclusiveF1.length > 0, m.inconclusiveF1.join(' / '));
  }

  console.log('\n=== [合成自测] G. 缺 off ⇒ F2 必须 BLOCKED（否则 Δβ 退化成 Δfs 会误判）===');
  {
    const base = synth({ durationSec: 10, moving: 'arc', sweepBetaDeg: 100, sweepFfDeg: 100 });
    base.forEach((s) => { delete s.off; });
    const m = analyzeEpisode({ id: 1, samples: base });
    check('F2 不命中', m.f2 === false);
    check('标记 BLOCKED', m.inconclusiveF2.some((x) => x.includes('off')), m.inconclusiveF2.join(' / '));
  }

  console.log(`\n=== [合成自测] ${pass} PASS / ${fail} FAIL ===`);
  return fail === 0;
}

// ══════════════════════════════════════════════════════════════════════
// F. main
// ══════════════════════════════════════════════════════════════════════

function main(argv) {
  if (argv.includes('--selftest')) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
  }

  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('用法: node scripts/orbitAudit.cjs <samples.json> [--windows]');
    console.error('      node scripts/orbitAudit.cjs --selftest');
    process.exit(2);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`读取失败: ${file}\n${e.message}`);
    process.exit(2);
  }
  const samples = Array.isArray(raw) ? raw : Array.isArray(raw.samples) ? raw.samples : null;
  if (!samples) {
    console.error('输入必须是样本数组，或 { samples: [...] }');
    process.exit(2);
  }

  console.log(`\n=== [实测样本] ${file}（${samples.length} 条）===`);
  const episodes = buildEpisodes(samples);
  console.log(`片段数: ${episodes.length}\n`);

  const results = episodes.map(analyzeEpisode).sort((a, b) => (b.f1 - a.f1) || (b.f2 - a.f2) || (a.t0 - b.t0));
  results.forEach(printEpisode);

  const f1 = results.filter((r) => r.f1).length;
  const f2 = results.filter((r) => r.f2).length;
  const blocked = results.filter((r) => !r.f1 && !r.f2
    && (r.inconclusiveF1.length > 0 || r.inconclusiveF2.length > 0)).length;
  const validEpisodes = results.filter((r) => r.valid).length;
  const totalSimSec = results.filter((r) => r.valid).reduce((a, r) => a + r.duration, 0);
  const blockedRatio = results.length ? blocked / results.length : 1;

  const shortfalls = [];
  if (results.length === 0) shortfalls.push('没有任何可分析片段');
  if (validEpisodes < 1) shortfalls.push('可用片段 = 0');
  if (totalSimSec < MIN_TOTAL_SIM_SEC) shortfalls.push(`总模拟时长 ${fmt(totalSimSec)}s < ${MIN_TOTAL_SIM_SEC}s`);
  if (blockedRatio > MAX_BLOCKED_RATIO) shortfalls.push(`BLOCKED 占比 ${fmt(blockedRatio * 100, 0)}% > ${MAX_BLOCKED_RATIO * 100}%`);
  const usable = shortfalls.length === 0;

  console.log(`\n=== 结论 ===`);
  console.log(`  F1（原地公转）= ${f1} 段   F2（无效绕飞）= ${f2} 段   BLOCKED = ${blocked} 段   片段总数 = ${results.length}`);
  console.log(`  可用片段 = ${validEpisodes}   总模拟时长 = ${fmt(totalSimSec)}s   BLOCKED 占比 = ${fmt(blockedRatio * 100, 0)}%`);

  if (!usable) {
    console.log('');
    console.log('  ============================================================');
    console.log(`  结论不可用：样本不足或字段缺失 —— ${shortfalls.join(' / ')}`);
    console.log('  本次 0 命中不代表「没绕圈」，只代表「测不出来」。');
    console.log('  ============================================================');
  } else if (f1 + f2 === 0) {
    console.log('  未命中（样本可用）。注意：这只说明本段样本里没有满足判据的绕圈，不等于全局已修复。');
  }
  if (blocked > 0) console.log('  BLOCKED 段不计入通过：缺字段按放行卡 §0 口径判 BLOCKED，不是 PASS。');

  const strict = !argv.includes('--no-gate');
  if (!strict) process.exit(0);
  if (!usable) process.exit(3);         // 3 = 结论不可用（区别于 0=通过 / 1=命中）
  process.exit(f1 + f2 > 0 ? 1 : 0);
}

main(process.argv.slice(2));
