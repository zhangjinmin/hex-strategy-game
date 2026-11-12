/**
 * [传送门·**连续光带门框**（生长 / 收回）· v5 `GATE_STYLE = 'D'` + 开场动画设置项
 *  + **v6 门框电弧化** + **v7 门内光条全删（位面 + 扫描前沿光带）**] 离线台架。
 *
 * ── v7 改动（用户 2026-10-16 第 7 次反馈）────────────────────────────────────
 * 「**中间这个光条太抢戏了，删掉不要了**，其余的继续推进」。
 * ⇒ 真机**分部隐藏隔离测试**（冻结同一相位，逐个子对象隐藏后与全开逐像素比对**门内区域**）判定：
 *   门内亮度的 **~80% 来自 `scan`（扫描前沿光带）**，v6 的**门内位面**（水平扫描线）只有 ~5%
 *   ⇒ **两样都删**：
 *     · **门内位面**：`DOOR_SCAN_LINES` / `doorScanLine*` / `doorScanFalloff` / `makeDoorScanLineTexture`
 *       / `DoorScanLineVis` / `DoorVis.scanLines|scanTex` —— 整块移除；
 *     · **扫描前沿光带**：`doorScanAmt` / `makeDoorScanTexture` / `DoorVis.scan|scanMat` / `scanColor` ——
 *       一并移除（它本就是"5 个裁剪平面随 `g.p` 沿舰队朝向平移"的**视觉冗余**，
 *       裁剪机制与它无关 ⇒ 删掉后"舰队被门扫过"的表达**依然成立**）。
 * ⇒ 台架对应：**删除位面 / 扫描线 / 扫描前沿的全部断言与反例**；**新增可执行契约断言**
 *   （真跑模块对象不再导出位面符号；渲染块不含位面记号、也不含横贯光条记号；`DoorVis` 无任何门内光条句柄；
 *    门根组 `root.add(` 恰好 4 处；裁剪推进机制仍在）——**每条都配反例（改坏必须 FAIL）**。
 * ⚠ 「位面与门框同步消退」随位面删除而作废；但**陪衬包络**（`doorAuxFadeK`，v6 的 `doorPlaneFadeK` 更名）
 *   仍要「生长优先 + 与门框同刻归零」⇒ 保留对应断言（改称"陪衬"，语义 / 数值不变）。
 * ⚠ **门内已无任何横贯光条 ⇒ 门内只剩"空门 + 舰队"**（"不遮挡舰队"由"门内为空"天然满足）。
 * ⚠ `aperture`（轮廓线，"门框从一条线展开"的动作感来源）**保留**，它不是中间光条。
 *
 * ── v6 落地：门框**电弧化**（保留；v7"其余的继续推进"即沿用这套噪声）────────────
 * 用户第 6 次反馈：「**边框呼吸感不够……边框曲线抖动起来，像是电弧一样的那种，有呼吸感**，现在还是
 *   **太死板了**」。
 * ⇒ ω 提高一档（周期 0.30~1.80 秒）/ 6 层整数频率 / **脉冲幅度调制**（间歇性加剧 = 呼吸/放电）/
 *   **尖峰化**（`|n|^p`，出现尖角）/ 幅度 1.8% → 3.0%。
 *
 * ── v5 重做背景（用户 2026-10-16 五次反馈，语气强烈）──────────────────────────
 * 「**这个边框是什么鬼，一根虚线吗！！这个也太丑了**……可以**再长方形的边框上下功夫**，
 *   比如有**流动的光线**，或者把**边框变成微微的随机曲线，让边框流动起来**，
 *   都比现在这个**上面一格一格的什么玩意**强……但**边框中间的部分效果还是可以的**」。
 * ⇒ v4 的"72 个离散能量块"读作**虚线 / 珠子串**（块是"小段"，球体瓦片是"面片"）；方向性错误。
 * ⇒ v5 门框 = **一条连续的发光带** + **微随机平滑曲线** + **沿周长流动的光**。
 *
 * ── 为什么这样写（沿用本项目 R1 教训）────────────────────────────────────────
 * `block.includes('...')` 式断言**没有牙齿**。本台架因此：
 *   ① **真跑纯逻辑层** —— `require('../frontend/src/game/three/entryDoor.ts')`，
 *      并**变异模块源码**后重跑（改坏常量/算法必须 FAIL ⇒ 证明断言有牙齿）；
 *   ② **真跑 Wiring** —— 把 `Battle3DOverlay.entryFxOn` / `startEntryFx` 的**原文**切出来
 *      （`stripTypeScriptTypes` + `new Function`）真跑，断言 `'off'` 时**不建对象 / 不聚焦**；
 *   ③ 源码契约层（少量，只用于防"整段删除"与"接线丢失"；行为由上面的真跑保证）。
 *
 * ── 被验证的关键命题（v5 + v6 + v7）───────────────────────────────────────────
 *   · 门框 = **连续光带**：采样 ≥ 100 点；相邻点**间距有上界且均匀**（不是"一格一格"）；
 *     UV / 索引**闭合连通**（一条带，不是一堆点）；带宽 ∈ [1%,2%] 门尺寸
 *   · **曲线平滑**：轮廓**圆角**（法线沿周长夹角有上界 ⇒ 不是折角）；噪声函数**Lipschitz + 二阶差分**有上界
 *     （改白噪声 ⇒ 必红 ⇒ 证明"不是锯齿"）；噪声幅度 ∈ [1.5%,3%] 半尺寸（**不是 0，也不是大扭曲**）
 *   · ★v6 **电弧感**：ω 提高一档（0.12s 内明显位移 ⇒ 不是"太死板"）；**脉冲幅度调制**（rms 起伏 > 1.5×）；
 *     **尖峰化**（`|n|^p`，p<1 ⇒ 推离 0）；且仍**平滑有界 + 严格周期**（不是白噪声、闭合无缝）
 *   · ★v7 **门内光条全删**：纯逻辑层不再导出位面符号、也不再导出 `doorScanAmt`；
 *     渲染块不含位面 / 横贯光条记号；`DoorVis` 无 `scanLines|scanTex|scan|scanMat`；门根组 `root.add(` = 4
 *   · ★v7 **裁剪推进机制仍在**（`entryGateWritePlanes` + `g.p` + `entryGateFront` ⇒ "舰队被门扫过"不受影响）
 *   · ★v7 **陪衬与门框同刻归零**：`doorAuxFadeK` 在消散末 = 0，且**归零时刻 ≤ 门框归零时刻**
 *   · **确定性**：同 seed 两次采样逐位一致；噪声对 `t` **严格周期**（闭合无缝）
 *   · 组装 = 沿周长**生长**（growth 单调不减、中期在半程 ⇒ 不是"一步到位"）；
 *     消散 = 沿周长**反向收回**（growth 单调不增、消散末 0）；流动 offset **单调增**（亮波只朝一个方向流）
 *   · 三阶段时序 2.6 / 1.6 / 2.0 / 0.3 = **6.5** = `ENTRY_TOTAL_SEC` = 球（三者同源）
 *   · 设置项 `entryFxStyle`：`'door'→'D'` / `'sphere'→'S'` / `'off'→null`；未设置 ⇒ 回退 `GATE_STYLE`
 *   · ★`'off'`：`entryFxOn()` 返回 false（不建任何特效对象）；`startEntryFx` **不聚焦**；**不暂停**
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');

// 真源码（纯逻辑层；零 import ⇒ 可被 require / 也可被文本变异后重跑）
const D = require('../frontend/src/game/three/entryDoor.ts');
const S = require('../frontend/src/game/three/entrySphere.ts');
const E = require('../frontend/src/game/entrySlice.ts');

const doorSrc = fs.readFileSync('./frontend/src/game/three/entryDoor.ts', 'utf8');
// ⚠ 变异自检用**归一化成 LF 的源码**（仓库里 `.ts` 是 CRLF；不归一化则含 `\n` 的变异串匹配不上 ⇒ 变异静默失效）
const doorSrcLF = doorSrc.replace(/\r\n/g, '\n');
const entrySrc = fs.readFileSync('./frontend/src/game/entrySlice.ts', 'utf8');
const entrySrcLF = entrySrc.replace(/\r\n/g, '\n');
const overlay = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');
const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const settingsStore = fs.readFileSync('./frontend/src/store/settingsStore.ts', 'utf8');
const settingsPanel = fs.readFileSync('./frontend/src/components/meta/SettingsPanel.vue', 'utf8');

let passed = 0;
let failed = 0;
function check(name, body) {
  try {
    assert.equal(body(), true);
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}: ${error.message}\n`);
  }
}
function checkThrows(name, body) {
  let threw = false;
  try { body(); } catch { threw = true; }
  check(name, () => threw === true);
}

// ════════════════════════════════════════════════════════════════════════════
// 通用：把 entryDoor.ts 源码编成"模块对象"（供变异自检重跑）
// ════════════════════════════════════════════════════════════════════════════
function loadDoorModule(src) {
  const names = [];
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  for (const m of src.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  let body = src.replace(/export\s+const\s+/g, 'const ').replace(/export\s+function\s+/g, 'function ');
  body = stripTypeScriptTypes(body);
  const factory = new Function(`${body}\nreturn { ${names.join(', ')} };`);
  return factory();
}
function loadEntryModule(src) {
  const names = [];
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  for (const m of src.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  let body = src.replace(/export\s+const\s+/g, 'const ').replace(/export\s+function\s+/g, 'function ');
  body = stripTypeScriptTypes(body);
  const factory = new Function(`${body}\nreturn { ${names.join(', ')} };`);
  return factory();
}
const ENTRY = loadEntryModule(entrySrc);

/** 唯一锚点抽取（锚点缺失 / 不唯一一律抛错）。
 *  说明：本台架**直接执行源码文本**，本项目 R1 教训要求"改坏必须红"。 */
function extractUnique(src, startMark, endMark) {
  const first = src.indexOf(startMark);
  if (first < 0) throw new Error(`锚点缺失: ${startMark}`);
  if (src.indexOf(startMark, first + 1) >= 0) throw new Error(`锚点不唯一: ${startMark}`);
  const end = src.indexOf(endMark, first + startMark.length);
  if (end < 0) throw new Error(`结束锚点缺失: ${endMark}`);
  return src.slice(first, end + endMark.length);
}
function compile(wrappedJs, mutate) {
  let js = wrappedJs;
  if (mutate) js = mutate(js);
  return new Function(`return ${stripTypeScriptTypes(js)};`)();
}

// ════════════════════════════════════════════════════════════════════════════
// 通用：光带几何统计 / 命题（**section 1/2 与 section 7 变异自检共用同一份谓词**）
// ════════════════════════════════════════════════════════════════════════════
const PROBE_TIMES = [0, 1.3, 2.9, 4.7, 6.1];

/** 对 `time` 求中心线采样统计：最大/最小步长、法线夹角上界、二阶差分上界。 */
function ribbonStats(M, time) {
  const N = Math.floor(M.DOOR_RIBBON_SAMPLES);
  const s = M.doorRibbonSamples(time, N);
  const pts = [], nrm = [];
  for (let i = 0; i < N; i++) { pts.push([s[i * 4], s[i * 4 + 1]]); nrm.push([s[i * 4 + 2], s[i * 4 + 3]]); }
  let maxStep = 0, minStep = Infinity, maxAng = 0, maxSecond = 0;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const step = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
    maxStep = Math.max(maxStep, step); minStep = Math.min(minStep, step);
    const a0 = Math.atan2(nrm[i][1], nrm[i][0]);
    const a1 = Math.atan2(nrm[j][1], nrm[j][0]);
    let da = Math.abs(a1 - a0); if (da > Math.PI) da = 2 * Math.PI - da;
    maxAng = Math.max(maxAng, da);
  }
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 1 + N) % N], b = pts[i], c = pts[(i + 1) % N];
    maxSecond = Math.max(maxSecond, Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1]));
  }
  return { N, pts, nrm, maxStep, minStep, maxAng, maxSecond, ratio: maxStep / Math.max(1e-12, minStep) };
}

/** 噪声函数在 `t` 上的 Lipschitz / 二阶差分上界（密集网格；**直接测噪声本身** ⇒ 与幅度解耦，有牙齿）。 */
function noiseStats(M, time = 0.7, N = 1024) {
  const h = 1 / N;
  let maxD = 0, maxDD = 0, maxAbs = 0;
  for (let i = 0; i < N; i++) {
    const t = i * h;
    const a = M.doorRibbonNoise(t - h, time);
    const b = M.doorRibbonNoise(t, time);
    const c = M.doorRibbonNoise(t + h, time);
    maxD = Math.max(maxD, Math.abs(b - a));
    maxDD = Math.max(maxDD, Math.abs(a - 2 * b + c));
    maxAbs = Math.max(maxAbs, Math.abs(b));
  }
  return { maxD, maxDD, maxAbs };
}

/** 全部"必须成立"的几何 / 运动学命题（**section 1/2 正向断言 + section 7 变异反例共用**）。 */
const Pred = {
  // ── 连续（不是"一格一格"）──
  samplesEnough: (M) => M.DOOR_RIBBON_SAMPLES >= 100,
  continuous: (M) => PROBE_TIMES.every((t) => ribbonStats(M, t).maxStep <= 0.09),
  uniform: (M) => PROBE_TIMES.every((t) => ribbonStats(M, t).ratio <= 1.8),
  // ── 平滑（不是折角 / 不是锯齿）──
  smoothNormal: (M) => PROBE_TIMES.every((t) => ribbonStats(M, t).maxAng <= 0.6),
  smoothCurve: (M) => PROBE_TIMES.every((t) => ribbonStats(M, t).maxSecond <= 0.05),
  // ★v6 新参数下的**解析上界**：`|d noise/dt| ≤ 2π·Σ(w·f)/1`，其中 `Σ(w·f) = 7.70`
  //   ⇒ `≤ 2π×7.70 = 48.38`；尖峰化 `|n|^0.9` 在 0 附近再放大约 1.4× ⇒ 连续上界 ≲ 0.07。
  //   **实测**（取样密度 N=1024，与 `noiseStats` 默认一致；扫过 8 个 time）：
  //     maxD = 0.036，maxDD = 0.0069 ⇒ 阈值取 **0.06 / 0.012**（各留 ~1.7× 余量）。
  //   ⚠ 这个阈值**有牙齿**：白噪声相邻样本跳变量级 ≈ 1.0、二阶差分 ≈ 2.0 ⇒ 阈值比它小 **16~166 倍**
  //     （见 section 7 变异 C：把噪声改成白噪声 ⇒ 必红）。**不是为了"过"而随手放大**。
  noiseSmooth: (M) => { const s = noiseStats(M); return s.maxD <= 0.06 && s.maxDD <= 0.012; },
  noiseBounded: (M) => noiseStats(M).maxAbs <= 1 + 1e-9,
  /** ★v6 电弧脉冲：噪声的**有效幅度**随时间起伏（rms 比值 > 1.5 ⇒ 间歇性加剧 / 呼吸感）。 */
  noiseArcPulse: (M) => {
    const rmsAt = (tm) => {
      let s = 0; const K = 256;
      for (let i = 0; i < K; i++) { const v = M.doorRibbonNoise(i / K, tm); s += v * v; }
      return Math.sqrt(s / K);
    };
    const list = [];
    for (let k = 0; k < 10; k++) list.push(rmsAt(k * 0.37));
    const mn = Math.min(...list), mx = Math.max(...list);
    return M.DOOR_NOISE_PULSE_DEPTH > 0.3 && mx > mn * 1.5;
  },
  /** ★v6 尖峰化：`sign(n)·|n|^p`（`p<1`）把取值推离 0（`0<x<1 ⇒ x^p > x`）⇒ "尖角 / 放电"；`p=1` ⇒ 关闭。 */
  noiseSpikeShapes: (M) => M.DOOR_NOISE_SPIKE < 1 && M.DOOR_NOISE_SPIKE > 0.5
    && M.arcNoiseSpike(0.25) > 0.25 + 0.005 && M.arcNoiseSpike(-0.25) < -0.25 - 0.005
    && Math.abs(M.arcNoiseSpike(1) - 1) < 1e-9 && M.arcNoiseSpike(0) === 0,
  /** ★v6 电弧抖动：同一点在**很短的 Δt（0.12s）**内就明显变化 ⇒ 读作"抖 / 颤"（不是"缓慢起伏"）。 */
  curveArcJitter: (M) => {
    // 门槛按"噪声本身"给：0.12s 内的平均位移 > 0.08 × 幅度（旧参数 ω 太慢 ⇒ 必红）。
    let sum = 0, changed = 0;
    for (let i = 0; i < 200; i++) {
      const t = i / 200;
      const a = M.doorRibbonPoint(t, 0), b = M.doorRibbonPoint(t, 0.12);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      sum += d;
      if (d > 1e-4) changed += 1;
    }
    return sum / 200 > 0.08 * M.DOOR_NOISE_AMP && changed > 150;
  },
  noisePeriodic: (M) => [0, 0.9, 2.3].every((tm) =>
    Math.abs(M.doorRibbonNoise(1, tm) - M.doorRibbonNoise(0, tm)) < 1e-9),
  outlineClosed: (M) => Math.hypot(
    M.doorRibbonOutline(1 - 1e-9).x - M.doorRibbonOutline(0).x,
    M.doorRibbonOutline(1 - 1e-9).y - M.doorRibbonOutline(0).y) < 1e-6,
  cornerSmooth: (M) => M.DOOR_CORNER_R > 0.02,
  // ── 微随机曲线：幅度在 [1.5%, 3%] 半尺寸（不是 0，也不是大扭曲）──
  noiseAmpOk: (M) => M.DOOR_NOISE_AMP >= 0.015 && M.DOOR_NOISE_AMP <= 0.03,
  curveDeviationBounded: (M) => {
    let maxDev = 0;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const o = M.doorRibbonOutline(t);
      const p = M.doorRibbonPoint(t, 1.234);
      maxDev = Math.max(maxDev, Math.hypot(p.x - o.x, p.y - o.y));
    }
    return maxDev <= M.DOOR_NOISE_AMP + 1e-6 && maxDev > M.DOOR_NOISE_AMP * 0.1;
  },
  /** 随时间**确实演进**（同一点两时刻不同），且位移恒 ≤ 2×幅度（调制只改变"何时更抖"，不放大上限）。 */
  curveEvolvesBounded: (M) => {
    let changed = 0;
    for (let i = 0; i < 200; i++) {
      const t = i / 200;
      const a = M.doorRibbonPoint(t, 0), b = M.doorRibbonPoint(t, 1.7);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 1e-4) changed += 1;
      if (d > 2 * M.DOOR_NOISE_AMP + 1e-9) return false;
    }
    return changed > 100;
  },
  // ── 一个**连通**的带（UV / 索引完备；不是一堆离散点）──
  bandConnected: (M) => {
    const N = Math.floor(M.DOOR_RIBBON_SAMPLES);
    const idx = M.doorRibbonBandIndices(N);
    if (idx.length !== N * 6) return false;
    const seen = new Set();
    for (const v of idx) seen.add(v);
    if (seen.size !== N * 2) return false;                       // 每个顶点都被用到
    for (let i = 0; i < N; i++) {                                 // 段段相接（含首尾回环）
      const j = (i + 1) % N;
      if (idx[i * 6] !== i * 2 || idx[i * 6 + 3] !== i * 2) return false;
      if (idx[i * 6 + 2] !== j * 2 + 1) return false;
    }
    return true;
  },
  bandWidthUniform: (M) => {
    const N = Math.floor(M.DOOR_RIBBON_SAMPLES);
    const bv = M.doorRibbonBandVertices(0.5, N);
    const expect = 2 * M.DOOR_RIBBON_HALF_W;
    for (let i = 0; i < N; i++) {
      const w = Math.hypot(bv[i * 6 + 3] - bv[i * 6], bv[i * 6 + 4] - bv[i * 6 + 1]);
      if (Math.abs(w - expect) > 1e-5) return false;
    }
    return true;
  },
  bandWidthInRange: (M) => {
    const w = 2 * M.DOOR_RIBBON_HALF_W;       // 局部：门尺寸 = 2
    const frac = w / 2;
    return frac >= 0.01 && frac <= 0.02;
  },
  /** 带宽在**世界空间处处相等**（矩形门用轴向补偿 `kx/ky` ⇒ 左右两条不会比上下两条粗）。 */
  bandWidthWorldUniform: (M) => {
    const N = Math.floor(M.DOOR_RIBBON_SAMPLES);
    const hU = 3, hV = 1.5;
    const [kx, ky] = M.doorRibbonAspectK(hU, hV);
    const bv = M.doorRibbonBandVertices(0.5, N, M.DOOR_RIBBON_HALF_W, undefined, kx, ky);
    const expect = 2 * M.DOOR_RIBBON_HALF_W * 0.5 * (hU + hV);
    for (let i = 0; i < N; i++) {
      const dx = (bv[i * 6 + 3] - bv[i * 6]) * hU;
      const dy = (bv[i * 6 + 4] - bv[i * 6 + 1]) * hV;
      if (Math.abs(Math.hypot(dx, dy) - expect) > 1e-4) return false;
    }
    return true;
  },
  /** 方形门（halfU = halfV）⇒ 补偿系数恒为 1（不引入无谓的各向异性）。 */
  aspectKIdentity: (M) => {
    const [a, b] = M.doorRibbonAspectK(2, 2);
    return Math.abs(a - 1) < 1e-12 && Math.abs(b - 1) < 1e-12;
  },
  /** ★补偿确实**必要**（不补偿时横竖世界宽度差 > 1.4×）⇒ 证明上一条断言不是"恒真"。 */
  bandWidthNeedsAspectK: (M) => {
    const N = Math.floor(M.DOOR_RIBBON_SAMPLES);
    const hU = 3, hV = 1.5;
    const bv = M.doorRibbonBandVertices(0.5, N);   // kx = ky = 1（不补偿）
    let minW = 1e9, maxW = -1e9;
    for (let i = 0; i < N; i++) {
      const w = Math.hypot((bv[i * 6 + 3] - bv[i * 6]) * hU, (bv[i * 6 + 4] - bv[i * 6 + 1]) * hV);
      minW = Math.min(minW, w); maxW = Math.max(maxW, w);
    }
    return maxW / minW > 1.4;
  },
  uvMonotone: (M) => {
    const N = Math.floor(M.DOOR_RIBBON_SAMPLES);
    const uv = M.doorRibbonBandUvs(N);
    if (uv.length !== N * 4) return false;
    for (let i = 0; i < N; i++) {
      if (Math.abs(uv[i * 4] - i / N) > 1e-6) return false;
      if (uv[i * 4 + 1] !== 0 || uv[i * 4 + 3] !== 1) return false;
    }
    return true;
  },
  // ── 确定性 ──
  deterministic: (M) => {
    const fp = (x) => Array.from(x).join(',');
    return PROBE_TIMES.every((t) => fp(M.doorRibbonSamples(t, M.DOOR_RIBBON_SAMPLES))
      === fp(M.doorRibbonSamples(t, M.DOOR_RIBBON_SAMPLES)));
  },
  // ── 生长 / 收回 / 流动 ──
  growthStartsZero: (M) => M.doorRibbonGrowthK(0, M.DOOR_MOTION_DEFAULT) === 0,
  growthMid: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    const g = M.doorRibbonGrowthK(cfg.assembleSec * 0.5, cfg);
    return g > 0.05 && g < 0.95;
  },
  growthMonotoneUp: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const g = M.doorRibbonGrowthK((cfg.assembleSec * i) / 200, cfg);
      if (g < prev - 1e-12) return false;
      prev = g;
    }
    return true;
  },
  growthFullOnHold: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    return M.doorRibbonGrowthK(cfg.assembleSec, cfg) === 1
      && M.doorRibbonGrowthK(M.doorDisperseStart(cfg), cfg) === 1;
  },
  growthMonotoneDown: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    const a = M.doorDisperseStart(cfg), b = M.doorDisperseEnd(cfg);
    let prev = Infinity;
    for (let i = 0; i <= 200; i++) {
      const g = M.doorRibbonGrowthK(a + ((b - a) * i) / 200, cfg);
      if (g > prev + 1e-12) return false;
      prev = g;
    }
    return true;
  },
  growthRetractMid: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    const g = M.doorRibbonGrowthK(M.doorDisperseStart(cfg) + cfg.disperseSec * 0.5, cfg);
    return g > 0.05 && g < 0.95;
  },
  growthEndsZero: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    return M.doorRibbonGrowthK(M.doorDisperseEnd(cfg), cfg) === 0
      && M.doorRibbonGrowthK(M.doorTotalSec(cfg), cfg) === 0
      && M.doorRibbonGrowthK(99, cfg) === 0;
  },
  // ── 「生长优先」：陪衬元素（rim / 位面 / 外辉光 / 轮廓线）必须**等光带长过半**才跟上 ──
  lateFollowGated: (M) => M.doorLateFollowK(0) === 0 && M.doorLateFollowK(0.25) === 0
    && M.doorLateFollowK(0.5) === 0 && M.doorLateFollowK(0.6) < 0.25
    && M.doorLateFollowK(0.85) > 0.5 && M.doorLateFollowK(1) === 1,
  lateFollowMonotone: (M) => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = M.doorLateFollowK(i / 100);
      if (v < prev - 1e-12 || v < 0 || v > 1) return false;
      prev = v;
    }
    return true;
  },
  flowIncreases: (M) => (M.doorRibbonFlowOffset(3) - M.doorRibbonFlowOffset(1)) > 0.05,
  flowMonotone: (M) => {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const f = M.doorRibbonFlowOffset((6.5 * i) / 200);
      if (f < prev - 1e-12) return false;
      prev = f;
    }
    return true;
  },
  // ══════════ ★v7 陪衬包络：`rim` / 外辉光 / 轮廓线 / 扫描前沿光带 **必须与门框一起归零** ══════════
  //   （v6 时该包络服务于"门内位面"，名叫 `doorPlaneFadeK`；v7 位面已删除 ⇒ 更名为 `doorAuxFadeK`，
  //    **语义 / 数值不变**，继续为上述陪衬元素提供「生长优先 + 同刻归零」。）
  /** 消散期陪衬**跟着门框一起收**：包络恒 ≤ 门框生长系数 + 单调不增（不可能"剩得比门框多"）。 */
  auxTracksFrameDisperse: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    const a = M.doorDisperseStart(cfg), b = M.doorDisperseEnd(cfg);
    let prev = Infinity;
    for (let i = 0; i <= 400; i++) {
      const t = a + ((b - a) * i) / 400;
      const pk = M.doorAuxFadeK(t, cfg), gk = M.doorRibbonGrowthK(t, cfg);
      if (pk > gk + 1e-9) return false;
      if (pk > prev + 1e-12 || pk < 0 || pk > 1) return false;
      prev = pk;
    }
    return true;
  },
  /** 门框归零（消散末 / 总末 / 超时）时陪衬**必须为 0**。 */
  auxFadeZeroWhenFrameGone: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    return M.doorAuxFadeK(M.doorDisperseEnd(cfg), cfg) === 0
      && M.doorAuxFadeK(M.doorTotalSec(cfg), cfg) === 0
      && M.doorAuxFadeK(99, cfg) === 0;
  },
  /** 完整期陪衬**确实亮着**（不是"永远为 0"的假通过）。 */
  auxAliveOnHold: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    return M.doorAuxFadeK(M.doorHoldStart(cfg), cfg) > 0.5
      && M.doorAuxFadeK(M.doorDisperseStart(cfg), cfg) > 0.5;
  },
  /** ★决定性：**陪衬首次归零时刻 ≤ 门框首次归零时刻**（反例：让陪衬晚于门框 ⇒ FAIL）。 */
  auxDiesNoLaterThanFrame: (M) => {
    const cfg = M.DOOR_MOTION_DEFAULT;
    const firstZeroAfter = (fn) => {
      let prev = fn(0.5);
      for (let i = 1; i <= 3000; i++) {
        const t = 0.5 + (7.5 * i) / 3000;
        const v = fn(t);
        if (prev > 1e-9 && v <= 1e-9) return t;
        prev = v;
      }
      return Infinity;
    };
    const gkZero = firstZeroAfter((t) => M.doorRibbonGrowthK(t, cfg));
    const pkZero = firstZeroAfter((t) => M.doorAuxFadeK(t, cfg));
    return Number.isFinite(gkZero) && Number.isFinite(pkZero) && pkZero <= gkZero + 1e-9;
  },
};

// ── ★v7 契约谓词：纯逻辑层**不再导出**任何"门内位面"符号（真跑模块对象；正向 + 反例共用）──
//   （v6 位面 = `DOOR_SCAN_LINES` 水平扫描线层：数据 + `doorScanLineY/Fade/WaveOffset` +
//    `doorScanFalloff` + `DOOR_SCAN_BAND` / `DOOR_SCAN_MAX_OPACITY` / `DOOR_SCAN_EDGE_FADE` /
//    `DOOR_SCAN_END_TAPER`。v7 全部删除 ⇒ 这些名字在模块对象上必须**全部 undefined**。）
function noPlaneExports(M) {
  return M.DOOR_SCAN_LINES === undefined
    && M.DOOR_SCAN_BAND === undefined
    && M.DOOR_SCAN_MAX_OPACITY === undefined
    && M.DOOR_SCAN_EDGE_FADE === undefined
    && M.DOOR_SCAN_END_TAPER === undefined
    && M.doorScanLineY === undefined
    && M.doorScanLineFade === undefined
    && M.doorScanLineWaveOffset === undefined
    && M.doorScanLineLimit === undefined
    && M.doorScanFalloff === undefined;
}
// ── ★v7 契约谓词：渲染块源码**不含**任何位面痕迹（大小写敏感的 ASCII 记号；正向 + 反例共用）──
const PLANE_MARKERS = [
  'DOOR_SCAN_LINES', 'DoorScanLineVis', 'DoorScanLine',
  'doorScanLineY', 'doorScanLineFade', 'doorScanLineWaveOffset', 'doorScanLineLimit',
  'doorScanFalloff', 'makeDoorScanLineTexture', 'scanLines', 'scanTex', 'SEG_X',
];
function noPlaneCode(text) {
  return PLANE_MARKERS.every((m) => !text.includes(m));
}
// ── ★v7 契约谓词：**门内横贯光条（扫描前沿光带 `scan`）**已删除（正向 + 反例共用）──
//   只要有下面任一记号，就说明那条横贯门中的亮条又回来了（它是用户第 7 轮点名要删的东西）。
const INNER_STRIP_MARKERS = ['makeDoorScanTexture', 'scanMat', 'doorScanAmt', 'scanColor', 'root.add(scan'];
function noInnerStrip(text) {
  return INNER_STRIP_MARKERS.every((m) => !text.includes(m));
}

// ════════════════════════════════════════════════════════════════════════════
// 1) 门框光带几何（真跑）：连续 / 均匀 / 平滑 / 微随机 / 带宽 / 闭合 / 确定性
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 1. 门框**连续光带**几何：连续 · 平滑 · 微随机 · 带宽 · 确定性 ===');
{
  const st = ribbonStats(D, 2.9);
  check('★采样点 ≥ 100（连续采样；不是"一格一格"的离散块）', () => Pred.samplesEnough(D));
  check('★光带**连续**：相邻采样点间距有上界（无跳变）', () => Pred.continuous(D));
  check('★光带**均匀**：最大/最小间距 < 1.8（无"忽密忽疏"）', () => Pred.uniform(D));
  check('★曲线**平滑**（法线夹角）：相邻法线夹角 ≤ 0.6 rad（圆角 ⇒ 无折角）', () => Pred.smoothNormal(D));
  check('★曲线**平滑**（位置二阶差分）：≤ 0.05（证明不是锯齿）', () => Pred.smoothCurve(D));
  check('★四角做**圆角过渡**（DOOR_CORNER_R > 2%）⇒ 法线处处连续', () => Pred.cornerSmooth(D));
  check('★噪声函数**平滑**（Lipschitz ≤ 0.06 且二阶差分 ≤ 0.012 ⇒ 不是白噪声/锯齿；白噪声量级 ~1.0/~2.0 ⇒ 差 16~166 倍）',
    () => Pred.noiseSmooth(D));
  check('★v6 噪声有**电弧脉冲**（rms 随时间起伏 > 1.5× ⇒ 间歇性加剧 / 呼吸感）', () => Pred.noiseArcPulse(D));
  check('★v6 噪声有**尖峰化**（|n|^p，p<1 ⇒ 推离 0 ⇒ 尖角/放电；p=1 恒等）', () => Pred.noiseSpikeShapes(D));
  check('噪声**有界** |noise| ≤ 1', () => Pred.noiseBounded(D));
  check('★噪声对 t **严格周期**（闭合无接缝：noise(1)=noise(0)）', () => Pred.noisePeriodic(D));
  check('轮廓**闭合**（outline(1) = outline(0)）', () => Pred.outlineClosed(D));
  check('★噪声幅度在 **[1.5%, 3%]** 门半尺寸区间（不是 0，也不是大扭曲）', () => Pred.noiseAmpOk(D));
  check('曲线位移**有界**（≤ 噪声幅度，且确实非零 ⇒ 真的"微微"弯了）', () => Pred.curveDeviationBounded(D));
  check('★v6 曲线**电弧抖动**（0.12s 内平均位移 > 0.08×幅度 ⇒ 明显"抖/颤"，不是"缓慢起伏"）',
    () => Pred.curveArcJitter(D));
  check('曲线**随时间演进**（不是静止）且位移恒 ≤ 2×幅度（调制不放大上限）', () => Pred.curveEvolvesBounded(D));
  check('★光带是**一条连通带**：索引闭合连通（每个顶点被用到、段段相接）', () => Pred.bandConnected(D));
  check('★带宽**恒定**（每采样点 = 2×halfW ⇒ 不出现"粗细不均"）', () => Pred.bandWidthUniform(D));
  check('★带宽 ∈ **[1%, 2%]** 门尺寸（细带，不是粗棒）', () => Pred.bandWidthInRange(D));
  check('★带宽在**世界空间处处相等**（矩形门轴向补偿 ⇒ 左右两条不比上下两条粗）', () =>
    Pred.bandWidthWorldUniform(D) && Pred.aspectKIdentity(D));
  check('★该补偿确实**必要**（不补偿时横竖世界宽度差 > 1.4× ⇒ 断言非"恒真"）', () =>
    Pred.bandWidthNeedsAspectK(D));
  check('UV：u 沿周长为 i/N，v = 0/1（供沿 u 滚动 ⇒ 流动光）', () => Pred.uvMonotone(D));
  check('★同 seed 两次采样**逐位一致**（确定性）', () => Pred.deterministic(D));
  check('★确定性**跨模块加载**也成立（相位由 seed 导出 ⇒ 两次加载逐位一致）', () => {
    const fp = (src) => Array.from(loadDoorModule(src).doorRibbonSamples(0.7, 32)).join(',');
    return fp(doorSrcLF) === fp(doorSrcLF);
  });
  check('不同 time ⇒ 曲线不同（证明噪声真的随时间演进）', () =>
    Array.from(D.doorRibbonSamples(0, 64)).join(',') !== Array.from(D.doorRibbonSamples(1.7, 64)).join(','));
  process.stdout.write(`  [info] N=${st.N} 步长∈[${st.minStep.toFixed(4)},${st.maxStep.toFixed(4)}] `
    + `法线夹角上界=${st.maxAng.toFixed(4)} 二阶差分上界=${st.maxSecond.toFixed(4)} `
    + `噪声Amp=${D.DOOR_NOISE_AMP} 半宽=${D.DOOR_RIBBON_HALF_W}\n`);
  process.stdout.write(`  [info] 噪声 f=${D.DOOR_NOISE_FREQS.join(',')} ω=${D.DOOR_NOISE_OMEGA.join(',')} `
    + `脉冲深度=${D.DOOR_NOISE_PULSE_DEPTH} 尖峰指数=${D.DOOR_NOISE_SPIKE}\n`);
}

// ════════════════════════════════════════════════════════════════════════════
// 2) 组装 = 生长 / 消散 = 反向收回 / 流动（真跑纯函数）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 2. 组装（生长）/ 完整 / 消散（反向收回）+ 流动（真跑） ===');
{
  const cfg = D.DOOR_MOTION_DEFAULT;
  const holdStart = D.doorHoldStart(cfg);
  const dispStart = D.doorDisperseStart(cfg);
  const dispEnd = D.doorDisperseEnd(cfg);

  check('相位边界：组装 [0,2.6) / 完整 [2.6,4.2) / 消散 [4.2,6.2) / 余晖 [6.2,6.5]', () =>
    Math.abs(holdStart - 2.6) < 1e-9 && Math.abs(dispStart - 4.2) < 1e-9
    && Math.abs(dispEnd - 6.2) < 1e-9 && Math.abs(D.doorTotalSec(cfg) - 6.5) < 1e-9);

  check('★t=0 ⇒ 生长系数 0（光带从"一点"开始，不是一上来就完整框）', () => Pred.growthStartsZero(D));
  check('★组装期生长**单调不减**（沿周长一点点画出来）', () => Pred.growthMonotoneUp(D));
  check('★组装中期（50%）生长系数在半程（0.05~0.95 ⇒ 真的在"生长"，不是"一步到位"）', () => Pred.growthMid(D));
  check('★完整期生长系数恒 1（完整门框）', () => Pred.growthFullOnHold(D));
  check('★消散期生长系数**单调不增**（沿周长反向收回）', () => Pred.growthMonotoneDown(D));
  check('★消散中期（50%）生长系数在半程（真的在"收回"，不是恒亮/一步消失）', () => Pred.growthRetractMid(D));
  check('★消散末 / 余晖末 / 超时 ⇒ 生长系数恒 0（收回干净，不"复活"）', () => Pred.growthEndsZero(D));
  check('★**生长优先**：光带长过半之前，陪衬（rim/外辉光/轮廓线/扫描前沿光带）**完全不可见**',
    () => Pred.lateFollowGated(D) && Pred.lateFollowMonotone(D));
  check('★流动 offset **单调不减**（亮波只朝一个方向流，不回摆）', () => Pred.flowMonotone(D));
  check('★流动 offset **确实在流动**（1s → 3s 增量 > 0.05）', () => Pred.flowIncreases(D));
  check('流动速度为正且"慢"（0 < DOOR_FLOW_SPEED ≤ 1 ⇒ 缓慢流动）', () =>
    D.DOOR_FLOW_SPEED > 0 && D.DOOR_FLOW_SPEED <= 1);
  check('移动亮点数 ≥ 1（能量脉冲沿门框跑）', () => D.DOOR_PULSE_COUNT >= 1);

  // 生长系数是"收回"而不是"凭空消失"：消散中每一时刻的已画出比例 = 组装中某时刻的比例
  check('★消散期是**反向收回**：给定比例 r，组装到达 r 的时刻与消散回到 r 的时刻都唯一且有限', () => {
    const findUp = (r) => { for (let i = 0; i <= 400; i++) { if (D.doorRibbonGrowthK((holdStart * i) / 400, cfg) >= r) return true; } return false; };
    const findDown = (r) => { for (let i = 0; i <= 400; i++) { const t = dispStart + ((dispEnd - dispStart) * i) / 400; if (D.doorRibbonGrowthK(t, cfg) <= r) return true; } return false; };
    return [0.25, 0.5, 0.75].every((r) => findUp(r) && findDown(r));
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 2b) ★v7 陪衬元素（rim / 外辉光 / 轮廓线 / 扫描前沿光带）与门框**同刻归零**
//     （包络 `doorAuxFadeK` = v6 `doorPlaneFadeK` 更名；位面已删除，语义 / 数值不变）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 2b. ★陪衬包络与门框**同步归零**（生长优先 + 同刻归零）===');
{
  const cfg = D.DOOR_MOTION_DEFAULT;
  const dispEnd = D.doorDisperseEnd(cfg);
  const total = D.doorTotalSec(cfg);
  check('★门框归零瞬间（消散末 / 总末 / 超时）⇒ 陪衬包络**必须为 0**（不会晚于门框）',
    () => Pred.auxFadeZeroWhenFrameGone(D));
  check('★t = 组装末+完整期+消散末 ⇒ **门框包络 0 且陪衬包络 0**（同一刻一起归零）', () => {
    const t0 = cfg.assembleSec + cfg.holdSec + cfg.disperseSec;
    return D.doorRibbonGrowthK(t0, cfg) === 0 && D.doorAuxFadeK(t0, cfg) === 0;
  });
  check('★陪衬在**消散期跟着门框一起收**（包络 ≤ 门框生长系数 + 单调不增）', () => Pred.auxTracksFrameDisperse(D));
  check('★**决定性**：陪衬首次归零时刻 ≤ 门框首次归零时刻', () => Pred.auxDiesNoLaterThanFrame(D));
  check('完整期陪衬**确实亮着**（不是"永远为 0"的假通过）', () => Pred.auxAliveOnHold(D));
  check('陪衬包络在生长 < 50% 时恒 0（沿用 v5「生长优先」；组装期读得出"生长"）',
    () => Pred.lateFollowGated(D) && D.doorAuxFadeK(1.0, cfg) === 0);
  // 归零时刻实例化（便于报告）
  const firstZero = (fn) => {
    let prev = fn(0.5);
    for (let i = 1; i <= 3000; i++) {
      const t = 0.5 + (7.5 * i) / 3000;
      const v = fn(t);
      if (prev > 1e-9 && v <= 1e-9) return t;
      prev = v;
    }
    return Infinity;
  };
  process.stdout.write(`  [info] 门框归零 t=${firstZero((t) => D.doorRibbonGrowthK(t, cfg)).toFixed(3)}s `
    + `陪衬归零 t=${firstZero((t) => D.doorAuxFadeK(t, cfg)).toFixed(3)}s `
    + `（消散末=${dispEnd} 总末=${total}）\n`);
}

// ════════════════════════════════════════════════════════════════════════════
// 2c) ★v7 门内位面**已彻底移除**（真跑模块对象 + 渲染块源码契约）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 2c. ★门内位面**已移除**（纯逻辑层不再导出位面符号）===');
{
  check('★真跑：`entryDoor` 模块**不再导出**任何位面符号（`DOOR_SCAN_LINES` / `doorScanLine*` / `doorScanFalloff` / `DOOR_SCAN_BAND`）',
    () => noPlaneExports(D));
  // 反例：把位面符号重新加回去 ⇒ 必须红
  checkThrows('★反例：源码重新导出一个位面符号 ⇒ "不再导出位面符号"断言必须红', () => {
    const M = loadDoorModule(`${doorSrcLF}\nexport const DOOR_SCAN_LINES = [1];`);
    assert.equal(noPlaneExports(M), true);
  });
  // 反例：`doorScanFalloff`（同为位面专用）重新出现 ⇒ 亦须红
  checkThrows('★反例：重新导出 `doorScanFalloff` ⇒ 断言必须红', () => {
    const M = loadDoorModule(`${doorSrcLF}\nexport function doorScanFalloff(u) { return u; }`);
    assert.equal(noPlaneExports(M), true);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 3) 门的"开启"动作 + 外辉光 / 扫描前沿包络（**保留项**；位面相关已随 v7 删除）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 3. 门"开启"动作 + 外辉光 / 扫描前沿包络（保留） ===');
{
  const cfg = D.DOOR_MOTION_DEFAULT;
  check('★doorApertureK：t=0 ⇒ 0（门塌成一条线）；组装前 60% 末 ⇒ 1（展开成完整矩形）', () =>
    D.doorApertureK(0, cfg) === 0
    && D.doorApertureK(cfg.assembleSec * D.DOOR_APERTURE_FRAC, cfg) === 1);
  check('doorApertureK 单调不减且有界 0..1', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = D.doorApertureK((cfg.assembleSec * i) / 100, cfg);
      if (v < prev - 1e-12 || v < 0 || v > 1) return false;
      prev = v;
    }
    return true;
  });
  check('门框展开在**组装阶段内**完成（aperture 时长远短于组装 ⇒ 之后是"完整框"）', () =>
    cfg.assembleSec * D.DOOR_APERTURE_FRAC < cfg.assembleSec);

  check('doorBarrierAmt：两端 0、完整期满亮', () =>
    D.doorBarrierAmt(0, cfg) === 0 && D.doorBarrierAmt(D.doorHoldStart(cfg), cfg) === 1
    && D.doorBarrierAmt(D.doorDisperseStart(cfg), cfg) === 1
    && D.doorBarrierAmt(D.doorTotalSec(cfg), cfg) === 0);
  check('doorBarrierAmt 非负且有界（0..1）', () => {
    for (let i = 0; i <= 200; i++) {
      const v = D.doorBarrierAmt((D.doorTotalSec(cfg) * i) / 200, cfg);
      if (v < 0 || v > 1) return false;
    }
    return true;
  });
  check('★v7：纯逻辑层**不再有** `doorScanAmt`（扫描前沿光带的强度包络已随之删除）', () =>
    D.doorScanAmt === undefined);
  check('★`entryGlowAmt`（entrySlice，被 A/B/C 与球体共用）**仍在且行为未变**（只删了门这边的消费）', () =>
    typeof E.entryGlowAmt === 'function'
    && E.entryGlowAmt(0) === 0 && E.entryGlowAmt(0.5) === 1 && E.entryGlowAmt(1) === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 4) 参数一致性 + 总时长同源（门 / 球 / ENTRY_TOTAL_SEC 三者 = 6.5）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 4. 参数一致性 + 门/球/ENTRY_TOTAL_SEC 总时长同源 ===');
{
  const P = E.GATE_STYLE_PARAMS.D;
  check('★总时长三者**同源**：doorTotalSec = sphereTotalSec = ENTRY_TOTAL_SEC = 6.5', () =>
    Math.abs(D.doorTotalSec() - 6.5) < 1e-9
    && Math.abs(S.sphereTotalSec() - 6.5) < 1e-9
    && Math.abs(E.ENTRY_TOTAL_SEC - 6.5) < 1e-9
    && Math.abs(D.doorTotalSec() - E.ENTRY_TOTAL_SEC) < 1e-9
    && Math.abs(S.sphereTotalSec() - D.doorTotalSec()) < 1e-9);
  check('★ENTRY_NEEDS_ASSEMBLE_RESET 仍为 true（6.5 > 4 ⇒ 必须重置集结计时；表达式未被改动）', () =>
    E.ENTRY_NEEDS_ASSEMBLE_RESET === true && E.ENTRY_TOTAL_SEC > 4.0);
  check('★外观常量与几何模块**一致**（防两处漂移）：ribbonSamples / dispersion', () =>
    P.ribbonSamples === D.DOOR_RIBBON_SAMPLES
    && Math.abs(P.dispersion - D.DOOR_DISPERSION_K) < 1e-12);
  check('D 方案门框有**三层质感颜色**（光带 / 亮心 / 外辉光）', () =>
    typeof P.bandColor === 'number' && typeof P.core === 'number' && typeof P.halo === 'number');
  check('★色散镶边**红/青两端不同**、且都不等于主色（轮廓微色散）', () =>
    typeof P.dispA === 'number' && typeof P.dispB === 'number'
    && P.dispA !== P.dispB && P.dispA !== P.bandColor && P.dispB !== P.bandColor);
  check('色散偏移是**微妙值**（0 < dispersion ≤ 0.02 ⇒ 窄丝带，不整圈粗红箍）', () =>
    P.dispersion > 0 && P.dispersion <= 0.02);
  check('★v7：`scanColor`（扫描前沿光带用色）已随光带删除（连 `GATE_STYLE_PARAMS.D` 里都不再留死旋钮）', () =>
    P.scanColor === undefined);
  check('位面不透明度极小（≤ 0.12 ⇒ 透过门能看清舰队）', () =>
    P.barrierOpacity > 0 && P.barrierOpacity <= 0.12);
  check('门框光带方案**不再有 blockCount**（v4 的离散块已废弃）', () =>
    P.blockCount === undefined && P.blockColor === undefined);
}

// ════════════════════════════════════════════════════════════════════════════
// 5) 设置项 entryFxStyle → 内部风格的**唯一映射**（真跑 + 变异自检）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 5. 设置项 entryFxStyle → 内部门风格（三取值 + 回退） ===');
{
  check('★ENTRY_FX_STYLE_DEFAULT = \'door\'（默认传送门 —— 用户认可门观感更好）', () =>
    E.ENTRY_FX_STYLE_DEFAULT === 'door');
  check('★\'door\' → \'D\'（传送门·连续光带门框）', () => E.gateStyleForEntryFx('door') === 'D');
  check('★\'sphere\' → \'S\'（六边形球体，**保留**）', () => E.gateStyleForEntryFx('sphere') === 'S');
  check('★\'off\' → null（完全跳过入场特效）', () => E.gateStyleForEntryFx('off') === null);
  check('未设置 / undefined / 非法值 ⇒ 回退编译期默认 GATE_STYLE', () =>
    E.gateStyleForEntryFx(undefined) === E.GATE_STYLE
    && E.gateStyleForEntryFx(null) === E.GATE_STYLE
    && E.gateStyleForEntryFx('bogus') === E.GATE_STYLE
    && E.GATE_STYLE === 'D');
  check('三取值映射**互不相同**（不会两值落到同一风格）', () => {
    const a = E.gateStyleForEntryFx('door'), b = E.gateStyleForEntryFx('sphere'), c = E.gateStyleForEntryFx('off');
    return a !== b && b !== c && a !== c;
  });

  // 变异：把 'sphere' 也映射回 D（两值落到同一风格）⇒ "互不相同"必须红
  const mutMap = loadEntryModule(entrySrcLF.replace(
    "if (fx === 'sphere') return 'S';",
    "if (fx === 'sphere') return 'D';"));
  checkThrows('变异（sphere 误映射回 D）已被"三取值互不相同"断言检出', () => {
    const a = mutMap.gateStyleForEntryFx('door'), b = mutMap.gateStyleForEntryFx('sphere'), c = mutMap.gateStyleForEntryFx('off');
    assert.equal(a !== b && b !== c && a !== c, true);
  });
  // 变异：'off' 不再返回 null（关闭失效）⇒ "off → null"必须红
  const mutOff = loadEntryModule(entrySrcLF.replace(
    "if (fx === 'off') return null;",
    "if (fx === 'off') return 'S';"));
  checkThrows('变异（off 不再跳过）已被"off → null"断言检出', () => {
    assert.equal(mutOff.gateStyleForEntryFx('off') === null, true);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 6) ★'off' 的**完整行为** + 光带接线契约（真跑原文 + 契约）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 6. ★设置项 \'off\'：不建特效对象 / 不聚焦 / 不暂停 + 光带接线 ===');
{
  // ── 真跑 entryFxOn 的**原文**（注入编译期开关；window 在 Node 为 undefined）──
  const FXON_START = 'private entryFxOn(): boolean {';
  const FXON_END = 'return !(w && w.__entryFxEnabled === false) && !this.entryFxOff;';
  function compileEntryFxOn(mutate) {
    let body = extractUnique(overlay, FXON_START, FXON_END);
    body = body.split(FXON_START).join('');
    return compile(`(function(SLICE_ENTRY_ENABLED_DEFAULT) {\nreturn function() {\n${body}\n};\n})`, mutate);
  }
  const fxOnFn = compileEntryFxOn();
  const runFxOn = (off) => {
    const self = { entryFxOff: off };
    return fxOnFn.call(self, E.SLICE_ENTRY_ENABLED_DEFAULT).call(self);
  };
  check('★entryFxOn：entryFxOff=true（设置 off）⇒ **false**（不建任何特效对象）', () => runFxOn(true) === false);
  check('entryFxOn：entryFxOff=false（door/sphere）⇒ **true**（照常播）', () => runFxOn(false) === true);

  // 变异：删掉 `&& !this.entryFxOff` ⇒ off 时仍返回 true ⇒ 断言必须红
  const fxOnMut = compileEntryFxOn((s) => s.split(' && !this.entryFxOff').join(''));
  checkThrows('变异（entryFxOn 忽略 off）已被"off ⇒ false"断言检出', () => {
    const self = { entryFxOff: true };
    assert.equal(fxOnMut.call(self, E.SLICE_ENTRY_ENABLED_DEFAULT).call(self), false);
  });

  // ── 真跑 startEntryFx 的**原文**：off 时**不聚焦**（否则会强行拉镜头 ⇒ 舰船跑出视野）──
  const SEF_START = 'startEntryFx(): void {';
  const SEF_END = 'if (ENTRY_AUTO_FOCUS && !this.entryFxOff) this.focusOnPlayerMainFleetForEntry();';
  function compileStartEntryFx(mutate) {
    let body = extractUnique(overlay, SEF_START, SEF_END);
    body = body.split(SEF_START).join('');
    return compile(`(function(ENTRY_AUTO_FOCUS) {\nreturn function() {\n${body}\n};\n})`, mutate);
  }
  const sefFn = compileStartEntryFx();
  const runStart = (off) => {
    let focused = 0;
    const self = {
      entryStates: new Map(), entryEpoch: 0, entryStarted: false, entryFxOff: off,
      finishAllEntryGates: () => {},
      focusOnPlayerMainFleetForEntry: () => { focused += 1; return true; },
    };
    sefFn.call(self, E.ENTRY_AUTO_FOCUS).call(self);
    return { focused, started: self.entryStarted };
  };
  check('★startEntryFx：off ⇒ **不聚焦**（不拉镜头），但仍置 entryStarted（无特效）', () => {
    const r = runStart(true);
    return r.focused === 0 && r.started === true;
  });
  check('startEntryFx：非 off ⇒ 聚焦我方主力舰队一次（N1 保留）', () => runStart(false).focused === 1);
  // 变异自检：删掉 `&& !this.entryFxOff` ⇒ off 时仍会聚焦（证明上一条断言有牙齿）
  const sefMut = compileStartEntryFx((s) => s.split('&& !this.entryFxOff').join(''));
  {
    const self = {
      entryStates: new Map(), entryEpoch: 0, entryStarted: false, entryFxOff: true,
      finishAllEntryGates: () => {}, _f: 0,
      focusOnPlayerMainFleetForEntry: () => { self._f += 1; return true; },
    };
    sefMut.call(self, E.ENTRY_AUTO_FOCUS).call(self);
    check('★变异自检：删掉 `&& !this.entryFxOff` 后 off 仍会聚焦（证明"off 不聚焦"断言有牙齿）', () => self._f === 1);
  }

  // ── 契约（防"整段删除"；行为已由真跑覆盖）──
  const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b); return (i >= 0 && j > i) ? src.slice(i, j) : ''; };
  check('构造器读取设置：`gateStyleForEntryFx(useSettingsStore().getEntryFxStyleValue())`', () =>
    overlay.includes('gateStyleForEntryFx(useSettingsStore().getEntryFxStyleValue())'));
  check('构造器把 null（off）落到 `entryFxOff`，非 null 落到 `gateStyle`', () =>
    overlay.includes('this.entryFxOff = mapped === null;') && overlay.includes('if (mapped) this.gateStyle = mapped;'));
  check('★ensureFleetGate 外观分派含 **D 分支**（buildDoorVisual + placeDoorVisual）', () => {
    const blk = slice(overlay, 'private ensureFleetGate(', 'private attachEntryClippingTo(');
    return blk.includes("} else if (this.gateStyle === 'D') {") && blk.includes('this.buildDoorVisual(g);')
      && blk.includes('this.placeDoorVisual(g, 0);');
  });
  check('★finishEntryGate 结束**必须** dispose 传送门（零残留红线）', () =>
    slice(overlay, 'private finishEntryGate(g: FleetGate): void {', 'private finishAllEntryGates(): void {')
      .includes('this.disposeDoorVisual(g);'));
  check('★updateEntryFx 每帧推进传送门（`this.placeDoorVisual(g, el)`）', () =>
    slice(overlay, 'private updateEntryFx(): void {', 'for (const [fleet, g] of this.fleetGates)')
      .includes('this.placeDoorVisual(g, el)'));
  check('★disposeDoorVisual：scene.remove + disposeTree（去重共享几何）+ 置空 g.door', () => {
    const blk = slice(overlay, 'private disposeDoorVisual(g: FleetGate): void {', 'private entryRevealScale(');
    return blk.includes('this.scene.remove(d.root)') && blk.includes('disposeTree(') && blk.includes('g.door = null');
  });

  // ── ★v5 光带接线（**门框不再是离散块**；逐帧就地更新 + drawRange 生长 + 贴图流动）──
  const doorBlk = slice(overlay, 'private buildDoorVisual(g: FleetGate): void {', 'private disposeDoorVisual(g: FleetGate): void {');
  check('★v5：门框几何来自**纯逻辑层**的连续光带（doorRibbonBandVertices / UV / 索引）', () =>
    doorBlk.includes('doorRibbonBandVertices(') && doorBlk.includes('doorRibbonBandUvs(')
    && doorBlk.includes('doorRibbonBandIndices(') && doorBlk.includes('DOOR_RIBBON_SAMPLES'));
  check('★v5：光带 3 层 Mesh **共享同一份几何**（disposeTree 去重 ⇒ 零残留）', () =>
    doorBlk.includes('ribbonMats.push(') && doorBlk.includes('ribbonMeshes.push(')
    && doorBlk.includes('new THREE.Mesh(ribbonGeo, mat)'));
  check('★v5：组装/消散走 `drawRange`（**同一段索引区间 0..count** ⇒ 生长 / 反向收回）', () =>
    doorBlk.includes('setDrawRange(0, 0)')
    && doorBlk.includes('setDrawRange(0, idxCount)') && doorBlk.includes('doorRibbonGrowthK('));
  check('★v5：流动光 = 贴图沿 u 滚动（`tex.offset.x = doorRibbonFlowOffset(...)`）+ 逐帧**就地**更新顶点', () =>
    doorBlk.includes('rb.tex.offset.x') && doorBlk.includes('doorRibbonFlowOffset(')
    && doorBlk.includes('rb.pos.needsUpdate = true'));
  check('★v5：**离散能量块彻底移除**（无 buildDoorBlocks / PlaneGeometry(1,1) 逐块网格）', () =>
    !overlay.includes('buildDoorBlocks') && !overlay.includes('doorBlockMotion')
    && !overlay.includes('blocks.push(') && !doorSrc.includes('buildDoorBlocks'));
  /* [v127] 面状雾（`makeGateHaloTexture` + PlaneGeometry）已删除：它是"一张贴图盖在面片"
     （guizang-game-skill 明确点名的廉价感来源），且挂在 root.scale 下会随阵型宽高比变形。
     替换为**四角能量节点**（世界尺度恒定）。保留项：rim / aperture / 四角节点。 */
  check('★v7/v127：门框**锐利内缘 rim / 四角能量节点 / 轮廓线 aperture 仍在**（保留项未丢；面状雾已按"贴图盖面片"反模式删除）', () =>
    doorBlk.includes('rimMat') && doorBlk.includes('cornerMats')
    && !doorBlk.includes('makeGateHaloTexture(')
    && doorBlk.includes('const aperture = new THREE.LineLoop(')
    && doorBlk.includes('d.aperture.scale.set(1, ap, 1)'));
  check('★v7：**门内位面已彻底移除**（渲染块不含位面记号：makeDoorScanLineTexture / DOOR_SCAN_LINES / doorScanLine* / doorScanFalloff / scanLines / scanTex）', () =>
    noPlaneCode(doorBlk));
  // 反例：把位面记号塞回渲染块 ⇒ 必须红
  checkThrows('★反例：渲染块重新出现 `makeDoorScanLineTexture(` ⇒ "位面已移除"断言必须红', () => {
    assert.equal(noPlaneCode(`${doorBlk}\n    const scanTex = this.makeDoorScanLineTexture();`), true);
  });
  checkThrows('★反例：渲染块重新出现 `DOOR_SCAN_LINES` ⇒ "位面已移除"断言必须红', () => {
    assert.equal(noPlaneCode(`${doorBlk}\n    for (const line of DOOR_SCAN_LINES) {}`), true);
  });
  check('★v7：**门内有横贯光条已彻底移除**（渲染块不含：makeDoorScanTexture / scanMat / `doorScanAmt` / `scanColor`）', () =>
    noInnerStrip(doorBlk));
  /* [v126] 4 → 5：新增**带状辉光**（门框更宽的两层同源光带，宽 5×/2.5×）。
     它们挂在门根组、沿门框走，**不是门内位面**（不遮挡舰队），语义与 v7 契约不冲突；
     门内光条的反例检查（`root.add(scan`）保持不变。 */
  check('★v7/v126：**门内只剩**"空门 + 舰队"——门根组只 add 了「3 层光带 + aperture + rim + halo + 2 层带状辉光」（5 处 `root.add(`）', () => {
    const adds = (doorBlk.match(/root\.add\(/g) || []).length;
    return adds === 5 && !doorBlk.includes('root.add(scan');
  });
  // 反例：把横贯光条塞回渲染块 ⇒ 必须红
  checkThrows('★反例：渲染块重新出现 `makeDoorScanTexture(`（横贯光条）⇒ "门内无横贯光条"断言必须红', () => {
    assert.equal(noInnerStrip(`${doorBlk}\n    const t = this.makeDoorScanTexture(0xffffff);`), true);
  });
  checkThrows('★反例：渲染块重新出现 `d.scanMat.opacity = ...`（横贯光条）⇒ "门内无横贯光条"断言必须红', () => {
    assert.equal(noInnerStrip(`${doorBlk}\n    d.scanMat.opacity = 0.55;`), true);
  });
  checkThrows('★反例：渲染块重新出现 `doorScanAmt(`（横贯光条强度包络）⇒ "门内无横贯光条"断言必须红', () => {
    assert.equal(noInnerStrip(`${doorBlk}\n    d.scanMat.opacity = doorScanAmt(g.p);`), true);
  });
  check('★v7：`DoorVis` 接口**不再声明** `scanLines` / `scanTex` / `scan` / `scanMat`（门内光条句柄全部删除）', () => {
    const dvis = slice(overlay, 'interface DoorVis {', 'interface SphereTileVis {');
    return dvis.length > 0 && !dvis.includes('scanLines') && !dvis.includes('scanTex')
      && !/\bscan\b/.test(dvis) && !dvis.includes('scanMat');
  });
  checkThrows('★反例：`DoorVis` 重新声明 `scanLines` ⇒ "接口不再含门内光条句柄"断言必须红', () => {
    const dvis = slice(overlay, 'interface DoorVis {', 'interface SphereTileVis {');
    const mutated = `${dvis}\n  scanLines: unknown[];`;
    assert.equal(mutated.length > 0 && !mutated.includes('scanLines') && !mutated.includes('scanTex'), true);
  });
  checkThrows('★反例：`DoorVis` 重新声明 `scanMat` ⇒ 断言必须红', () => {
    const dvis = slice(overlay, 'interface DoorVis {', 'interface SphereTileVis {');
    const mutated = `${dvis}\n  scanMat: THREE.MeshBasicMaterial;`;
    assert.equal(mutated.length > 0 && !mutated.includes('scanMat') && !/\bscan\b/.test(mutated), true);
  });
  check('★v7：陪衬（rim / 外辉光 / 轮廓线 aperture）opacity **一律乘 `doorAuxFadeK`**（生长优先 + 同刻归零）', () => {
    const n = doorBlk.split('doorAuxFadeK(').length - 1;
    return n >= 1 && doorBlk.includes('const fadeK = doorAuxFadeK(elapsed, cfg);')
      && !doorBlk.includes('doorPlaneFadeK(');
  });
  check('★v7：**不再有**任何"门内位面"整面 / 竖直能量流（`makeDoorPlaneTexture` / `d.barrierTex` 已移除）', () =>
    !overlay.includes('makeDoorPlaneTexture') && !doorBlk.includes('d.barrierTex'));
  check('★v7：**"舰队被门扫过"的机制仍在**（5 个裁剪平面 + 沿舰队朝向推进 ⇒ 与已删的视觉冗余无关）', () =>
    overlay.includes('entryGateWritePlanes(') && overlay.includes('g.p = p;')
    && overlay.includes('entryGateFront(p, g.box.sLo, g.box.sHi, g.margin)'));


  // ── ★'off' 不暂停：BattleScene.beginEntryPhase 有 off 提前返回 + 显式解除暂停 ──
  // ⚠ 这里**不能**用逐字字符串匹配。旧写法断言源码里存在
  //   `if (this.entryFxDisabledBySetting()) { this.store.isPaused = false; return; }` 一整行，
  //   它锁的其实是「early-return 里没有别的东西」这个**旧形态**：
  //   将来谁按"开场定妆重摆"在 unpause 之前插入一次摆位，改对了反而会变红（QA-B3 实测过）。
  //   改为**结构 + 顺序**断言：三条 early-return 分支必须 (a) 显式解除暂停、(b) 在其后 return；
  //   若将来插入 `settleFormationOnBattleStart()`，必须位于 unpause **之前**
  //   （settle 之后才解除暂停 ⇒ 同一 tick 内锚点不会先动，摆位才对得上）。
  check('★BattleScene.beginEntryPhase：三条 early-return 显式解除暂停后 return；若插入开场定妆重摆必须在 unpause 之前', () => {
    const i0 = scene.indexOf('private beginEntryPhase(');
    if (i0 < 0) return false;
    const i1 = scene.indexOf('private entryFxDisabledBySetting(', i0);
    const body = i1 > i0 ? scene.slice(i0, i1) : scene.slice(i0, i0 + 4000);
    const heads = ['if (!ENTRY_HOLD_PAUSE)', 'if (this.entryFxDisabledBySetting())', 'if (!has3d)'];
    for (const h of heads) {
      const at = body.indexOf(h);
      if (at < 0) return false;
      const open = body.indexOf('{', at);
      if (open < 0) return false;
      let depth = 0; let end = -1;
      for (let i = open; i < body.length; i++) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) return false;
      const blk = body.slice(open, end + 1);
      const iUnpause = blk.indexOf('this.store.isPaused = false;');
      const iReturn = blk.lastIndexOf('return;');
      if (iUnpause < 0 || iReturn < 0 || iReturn < iUnpause) return false;
      const iSettle = blk.indexOf('settleFormationOnBattleStart(');
      if (iSettle >= 0 && iSettle > iUnpause) return false;
    }
    return true;
  });
  check('★BattleScene 的 off 判定复用**同一设置项** getEntryFxStyleValue() === \'off\'（与 3D 层同源）', () =>
    scene.includes("getEntryFxStyleValue() === 'off'"));
  check('★3D 层与 BattleScene **同判**（两边都读 getEntryFxStyleValue ⇒ 永不背离）', () =>
    overlay.includes('getEntryFxStyleValue()') && scene.includes('getEntryFxStyleValue()'));

  // ── 设置项本身（store / 迁移 / UI）──
  check('★settingsStore：entryFxStyle 默认 \'door\'', () =>
    settingsStore.includes("const entryFxStyle = ref<'door' | 'sphere' | 'off'>('door')"));
  check('★settingsStore：存量存档迁移（白名单校验，缺失/非法 ⇒ 回落 \'door\'）', () =>
    settingsStore.includes("data.entryFxStyle === 'door'") && settingsStore.includes('? data.entryFxStyle'));
  check('★settingsStore：写入持久化（save 含 entryFxStyle + settingsVersion 3）', () =>
    settingsStore.includes('entryFxStyle: entryFxStyle.value') && settingsStore.includes('settingsVersion: 3'));
  check('★settingsStore：auto-save watch 含 entryFxStyle；resetDefaults 恢复 \'door\'', () =>
    settingsStore.includes('battle3dShowFps, entryFxStyle]') && settingsStore.includes("entryFxStyle.value = 'door';"));
  check('★设置界面：新增「开场动画」下拉（传送门 / 能量球 / 关闭）', () =>
    settingsPanel.includes('开场动画') && settingsPanel.includes(':value="entryFx"')
    && settingsPanel.includes('<option value="door">') && settingsPanel.includes('<option value="sphere">')
    && settingsPanel.includes('<option value="off">'));
  check('★设置界面：onEntryFxChange 白名单（只接受三取值）', () =>
    settingsPanel.includes("v === 'door' || v === 'sphere' || v === 'off'"));
}

// ════════════════════════════════════════════════════════════════════════════
// 7) 变异自检：改坏 entryDoor.ts ⇒ 对应断言必须 FAIL（**每条正向断言都配一个反例**）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 7. 变异自检（改坏 entryDoor.ts ⇒ 断言必须能红） ===');
{
  const mut = (from, to) => {
    const s = doorSrcLF.split(from).join(to);
    assert.notEqual(s, doorSrcLF, `变异未生效（锚点未匹配）: ${from.slice(0, 60)}…`);
    return loadDoorModule(s);
  };

  // A：四角**不做圆角**（R=0 ⇒ 直角处法线突变）⇒ "法线夹角有上界 / 圆角" 必须红
  checkThrows('★变异A（R=0 ⇒ 直角折角）已被"法线夹角 ≤ 0.6 / 圆角 > 2%"断言检出', () => {
    const M = mut('export const DOOR_CORNER_R = 0.10;', 'export const DOOR_CORNER_R = 0;');
    assert.equal(Pred.smoothNormal(M) && Pred.cornerSmooth(M) && Pred.smoothCurve(M), true);
  });

  // B：采样点太少（又变成"离散的点"）⇒ "连续/采样够密" 必须红
  checkThrows('★变异B（N=40 ⇒ 又成离散点）已被"采样 ≥ 100 / 间距 ≤ 0.09"断言检出', () => {
    const M = mut('export const DOOR_RIBBON_SAMPLES = 200;', 'export const DOOR_RIBBON_SAMPLES = 40;');
    assert.equal(Pred.samplesEnough(M) && Pred.continuous(M) && Pred.uniform(M), true);
  });

  // C：平滑噪声改成**白噪声**（锯齿）⇒ "噪声平滑（Lipschitz/二阶差分）" 必须红
  checkThrows('★变异C（噪声改白噪声 ⇒ 锯齿）已被"噪声 Lipschitz / 二阶差分有上界"断言检出', () => {
    const M = mut(
      `    n += DOOR_NOISE_WEIGHTS[i] * pulse
      * Math.sin(TWO_PI * DOOR_NOISE_FREQS[i] * t + NOISE_PHASES[i] + DOOR_NOISE_OMEGA[i] * time);`,
      `    n = (Math.sin(t * 9973.0 + i * 1.7) > 0 ? 1 : -1) * 0.5;`);
    assert.equal(Pred.noiseSmooth(M), true);
  });

  // C2：★去掉**电弧脉冲调制**（回归"匀速抖动"）⇒ "电弧脉冲" 必须红
  checkThrows('★变异C2（PULSE_DEPTH = 0 ⇒ 无间歇放电 / 无呼吸）已被"电弧脉冲 rms 起伏 > 1.5×"断言检出', () => {
    const M = mut('export const DOOR_NOISE_PULSE_DEPTH = 0.6;', 'export const DOOR_NOISE_PULSE_DEPTH = 0;');
    assert.equal(Pred.noiseArcPulse(M), true);
  });

  // C3：★去掉**尖峰化**（p=1 ⇒ 恒等）⇒ "尖峰化" 必须红
  checkThrows('★变异C3（SPIKE = 1 ⇒ 恒等，无尖角）已被"尖峰化 |n|^p 推离 0"断言检出', () => {
    const M = mut('export const DOOR_NOISE_SPIKE = 0.9;', 'export const DOOR_NOISE_SPIKE = 1;');
    assert.equal(Pred.noiseSpikeShapes(M), true);
  });

  // C4：★把 ω 退回 v5 的"缓慢"档（周期 2~11 秒）⇒ "电弧抖动" 必须红（证明用户"太死板"确被修掉）
  checkThrows('★变异C4（ω 退回 v5 缓慢档 ⇒ 又"太死板"）已被"0.12s 内明显位移"断言检出', () => {
    const M = mut('export const DOOR_NOISE_OMEGA: number[] = [3.5, 5.0, 7.5, 11.0, 16.0, 21.0];',
      'export const DOOR_NOISE_OMEGA: number[] = [0.55, 0.80, 1.15, 1.55, 2.10, 2.60];');
    assert.equal(Pred.curveArcJitter(M), true);
  });

  // D：噪声幅度为 0（边框变"笔直的光带"⇒ 丢掉用户点名的"随机曲线"）⇒ "幅度 ∈ [1.5%,3%]" 必须红
  checkThrows('★变异D（噪声幅度 = 0 ⇒ 没有"微微的随机曲线"）已被"幅度 ∈ [1.5%,3%]"断言检出', () => {
    const M = mut('export const DOOR_NOISE_AMP = 0.030;', 'export const DOOR_NOISE_AMP = 0;');
    assert.equal(Pred.noiseAmpOk(M) && Pred.curveDeviationBounded(M), true);
  });

  // E：噪声幅度过大（大扭曲）⇒ "幅度 ∈ [1.5%,3%]" 必须红
  checkThrows('★变异E（噪声幅度 = 0.4 ⇒ 大扭曲）已被"幅度 ≤ 3% / 位移有界"断言检出', () => {
    const M = mut('export const DOOR_NOISE_AMP = 0.030;', 'export const DOOR_NOISE_AMP = 0.4;');
    assert.equal(Pred.noiseAmpOk(M) && Pred.curveDeviationBounded(M), true);
  });

  // F：带宽过粗（18% 门尺寸 ⇒ 粗棒）⇒ "带宽 ∈ [1%,2%]" 必须红
  checkThrows('★变异F（半宽 0.09 ⇒ 粗棒）已被"带宽 ∈ [1%,2%] 门尺寸"断言检出', () => {
    const M = mut('export const DOOR_RIBBON_HALF_W = 0.016;', 'export const DOOR_RIBBON_HALF_W = 0.09;');
    assert.equal(Pred.bandWidthInRange(M) && Pred.bandWidthUniform(M), true);
  });

  // F2：丢掉带宽的**轴向补偿**（横竖世界宽度不等）⇒ "世界等宽" 必须红
  checkThrows('★变异F2（去掉 kx/ky 补偿 ⇒ 左右两条比上下两条粗）已被"世界等宽"断言检出', () => {
    const M = mut('    dst[b] = cx - nx * wx; dst[b + 1] = cy - ny * wy; dst[b + 2] = 0;\n'
      + '    dst[b + 3] = cx + nx * wx; dst[b + 4] = cy + ny * wy; dst[b + 5] = 0;',
    '    dst[b] = cx - nx * halfW; dst[b + 1] = cy - ny * halfW; dst[b + 2] = 0;\n'
      + '    dst[b + 3] = cx + nx * halfW; dst[b + 4] = cy + ny * halfW; dst[b + 5] = 0;');
    assert.equal(Pred.bandWidthWorldUniform(M), true);
  });

  // F3：补偿系数恒 1（等于不补偿）⇒ "世界等宽" 必须红
  checkThrows('★变异F3（doorRibbonAspectK 恒返回 1 ⇒ 等于不补偿）已被"世界等宽"断言检出', () => {
    const M = mut('  return [ref / hu, ref / hv];', '  return [1, 1];');
    assert.equal(Pred.bandWidthWorldUniform(M), true);
  });

  // G：组装"不生长"（一上来就是完整框）⇒ "生长中期在半程" 必须红
  checkThrows('★变异G（组装期 growth 恒 1 ⇒ 不生长）已被"组装中期在半程"断言检出', () => {
    const M = mut('  if (t < holdStart) return smooth01(t / Math.max(1e-6, holdStart));',
      '  if (t < holdStart) return 1;');
    assert.equal(Pred.growthMid(M) && Pred.growthStartsZero(M), true);
  });

  // H：消散"不收回"（growth 恒 1）⇒ "消散末 = 0" 必须红
  checkThrows('★变异H（消散期 growth 恒 1 ⇒ 不收回）已被"消散中期在半程 / 单调不增"断言检出', () => {
    const M = mut('  if (t < dispEnd) return 1 - smooth01((t - dispStart) / Math.max(1e-6, cfg.disperseSec));',
      '  if (t < dispEnd) return 1;');
    assert.equal(Pred.growthEndsZero(M) && Pred.growthMonotoneDown(M) && Pred.growthRetractMid(M), true);
  });

  // H2：「生长优先」失效（陪衬恒 1 ⇒ 光带才长一半就已是个完整白框）⇒ 断言必须红
  checkThrows('★变异H2（doorLateFollowK 恒 1 ⇒ 组装期就已是完整白框）已被"生长优先"断言检出', () => {
    const M = mut('  return smooth01((growthK - 0.5) * 2);', '  return 1;');
    assert.equal(Pred.lateFollowGated(M), true);
  });

  // I：流动停滞（offset 恒 0）⇒ "确实在流动" 必须红
  checkThrows('★变异I（流动 offset 恒 0 ⇒ 不流动）已被"流动增量 > 0.05"断言检出', () => {
    const M = mut('  return t * DOOR_FLOW_SPEED;', '  return 0;');
    assert.equal(Pred.flowIncreases(M) && Pred.flowMonotone(M), true);
  });

  // J：噪声不再对 t 周期（闭合处出现接缝）⇒ "严格周期" 必须红
  checkThrows('★变异J（噪声加非整数频率 ⇒ 闭合接缝）已被"noise(1)=noise(0)"断言检出', () => {
    const M = mut('export const DOOR_NOISE_FREQS: number[] = [3, 5, 7, 11, 17, 23];',
      'export const DOOR_NOISE_FREQS: number[] = [2.5, 3.1, 5.3, 8.7, 13.4, 19.3];');
    assert.equal(Pred.noisePeriodic(M) && Pred.outlineClosed(M), true);
  });

  // K：总时长漏掉余晖（6.2 ≠ 6.5）⇒ "三者同源" 必须红
  checkThrows('★变异K（总时长漏算余晖）已被"= ENTRY_TOTAL_SEC"断言检出', () => {
    const M = mut('  return cfg.assembleSec + cfg.holdSec + cfg.disperseSec + cfg.afterglowSec;',
      '  return cfg.assembleSec + cfg.holdSec + cfg.disperseSec;');
    assert.equal(Math.abs(M.doorTotalSec(M.DOOR_MOTION_DEFAULT) - E.ENTRY_TOTAL_SEC) < 1e-9, true);
  });

  // L：开启动作恒 1（一上来就是完整矩形，无"开启"感）⇒ "doorApertureK(0)=0" 必须红
  checkThrows('★变异L（开启动作失效 ⇒ 一上来就是完整框）已被"t=0 aperture=0"断言检出', () => {
    const M = mut('  return smooth01(clamp01(elapsed / dur));', '  return 1;');
    assert.equal(M.doorApertureK(0, M.DOOR_MOTION_DEFAULT) === 0, true);
  });

  // M：噪声相位改用 Math.random（非确定性）⇒ "跨模块加载确定性" 必须红
  checkThrows('★变异M（噪声相位改 Math.random ⇒ 不确定）已被"跨加载确定性"断言检出', () => {
    const from = '  return DOOR_NOISE_FREQS.map(() => rand() * Math.PI * 2);';
    const to = '  return DOOR_NOISE_FREQS.map(() => Math.random() * Math.PI * 2);';
    const s = doorSrcLF.split(from).join(to);
    assert.notEqual(s, doorSrcLF, '变异未生效（锚点未匹配）');
    const fp = (src) => Array.from(loadDoorModule(src).doorRibbonSamples(0.7, 32)).join(',');
    assert.equal(fp(s) === fp(s), true);
  });

  // N：陪衬包络改回 doorBarrierAmt（比门框晚 0.3s 归零）⇒ 必须红
  checkThrows('★变异N（陪衬包络改回 doorBarrierAmt ⇒ 陪衬比门框晚 0.3s 归零）已被断言检出', () => {
    const M = mut('  if (t >= dispStart) return gk;          // 收回侧：与门框**同刻**归零\n  return doorLateFollowK(gk);             // 组装 / 完整侧：生长优先',
      '  return doorBarrierAmt(elapsed, cfg);');
    assert.equal(Pred.auxDiesNoLaterThanFrame(M) && Pred.auxFadeZeroWhenFrameGone(M) && Pred.auxTracksFrameDisperse(M), true);
  });
  // N2：陪衬**不跟门框**（恒 1 ⇒ 门框没了它还全亮）⇒ 必须红
  checkThrows('★变异N2（doorAuxFadeK 恒 1 ⇒ 门框没了陪衬还亮）已被断言检出', () => {
    const M = mut('  if (t >= dispStart) return gk;          // 收回侧：与门框**同刻**归零\n  return doorLateFollowK(gk);             // 组装 / 完整侧：生长优先',
      '  return 1;');
    assert.equal(Pred.auxFadeZeroWhenFrameGone(M) && Pred.auxTracksFrameDisperse(M), true);
  });

  // ── ★v7 反例：位面 / 扫描前沿光带"复活"（把导出加回源码）必须被对应契约断言检出 ──
  checkThrows('★变异T（把 `DOOR_SCAN_LINES` 加回纯逻辑层 ⇒ 位面"复活"）已被"不再导出位面符号"断言检出', () => {
    const M = loadDoorModule(`${doorSrcLF}\nexport const DOOR_SCAN_LINES = [{ a: 0.2 }];`);
    assert.equal(noPlaneExports(M), true);
  });
  checkThrows('★变异U（把 `doorScanAmt` 加回纯逻辑层 ⇒ 横贯光条"复活"）已被"不再有 doorScanAmt"断言检出', () => {
    const M = loadDoorModule(`${doorSrcLF}\nexport function doorScanAmt(p) { return p; }`);
    assert.equal(M.doorScanAmt === undefined, true);
  });
  // U2：渲染层把横贯光条塞回来 ⇒ 必须被"门内无横贯光条"断言检出
  checkThrows('★变异U2（渲染块把 `makeDoorScanTexture` 塞回来 ⇒ 横贯光条"复活"）已被断言检出', () => {
    const blk = slice(overlay, 'private buildDoorVisual(g: FleetGate): void {', 'private disposeDoorVisual(g: FleetGate): void {');
    assert.equal(noInnerStrip(`${blk}\n    const scan = this.makeDoorScanTexture(0xffffff);`), true);
  });
}

console.log(`\n[entryDoorSim] passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exit(1);
}
