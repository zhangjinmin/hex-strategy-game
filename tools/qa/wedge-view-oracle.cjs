#!/usr/bin/env node
/**
 * wedge-view-oracle.cjs — 楔形阵「读不读得出三角」的**独立几何对拍器**（只读，纯 JS）
 *
 * 用途：把「用户能看出三角」翻译成可复算的屏幕判据，并回答三个问题：
 *   Q1  同一相机方位下，不同 formFacing 的舰队凭什么一侧正常一侧异常？（方位/仰角各自的影响是不是必需）
 *   Q2  「异常时楔尖是小舰」是否可能只是**舰长 vs 纵深间隙**的几何效应（与相机无关）？
 *   Q4  取景归位要落到什么仰角/方位才算达标（给门限的推导，而不是拍一个数）。
 *
 * ── 独立性纪律（判据四条之①）────────────────────────────────────────────────
 * 本文件**不 import 任何 frontend/** 的模块**，也不读 TestSubject 的中间量：
 *   · 楔形排宽序列由本文件**自己**按规格（等差排宽、Σw=n、w[0]=1）生成，与产线 `wedgeCells` 互不引用；
 *   · 相机/投影由本文件自己实现的标准 look-at + 针孔投影给出，不引用 `focusOnFleet` 的实现；
 *   · 期望值全部是「投影后再测量」的结果，不是抄产线常量。
 * 下面 `SPEC` 里那几个常量是**物理输入**（格距、缩舰系数、层距系数），等同"用尺子量"，
 * 在报告里与产线注释逐条对数过（见 docs/qa/wedge-verdict-20261025.md 采信矩阵）。
 *
 * 调用：node tools/qa/wedge-view-oracle.cjs            # 全量 + 自测，退出码 0/1
 *       node tools/qa/wedge-view-oracle.cjs --quiet    # 只打结论行
 *
 * 判据（AC 编号与验收报告一致）：
 *   AC-S1  rowOrder    : |Spearman(排号, 该排平均屏幕 y)| ≥ 0.90   —— 各排必须"叠"而不是"缠"
 *   AC-S2  rowSep      : 相邻排屏幕间距 ≥ 4px                      —— 排必须可分辨
 *   AC-S3  binWidths   : 屏幕纵向等分 6 箱，箱内横向跨度的 Spearman ≥ 0.90 —— 探针同口径
 *   AC-S4  aspect      : 屏幕纵跨/横跨 ∈ [0.30, 0.80]              —— 不是一根柱、也不是一张毯
 */
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 0. 物理输入（规格值；与产线注释逐条对过数，见采信矩阵）
// ─────────────────────────────────────────────────────────────────────────────
const SPEC = {
  spacing: 26,              // FORMATION_SPACING（formationLayout.ts:36）
  hexR: 50,                 // 会战期 hexRadius
  shipVisualScale: 0.40,    // Battle3DOverlay.ts:191
  layerGapK: 0.3125,        // LAYER_GAP_K
  layerSafe: 1.2,           // LAYER_SHIP_H_SAFE
  layersCap: 16,            // TEAM_LAYERS
  footprintLimit: 6,        // FORMATION_FOOTPRINT_LIMIT
  layerCountK: 1.0,         // LAYER_COUNT_K
  maxShipH: 5.89,           // 该队最高舰体世界高度（fleetTierLayout 注释实算值，hexR=50/scale .40）
  hullLen: 25.4,            // 战列舰舰长（= 0.733*√3*50*0.40），用于 Q2
  hullLenSmall: 10.5,       // 小舰（驱逐）舰长的量级，用于 Q2 对照
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. 独立的楔形排宽生成（规格：等差排宽 / Σw=n / w[0]=1 / 单调不降）
//    与产线 wedgeCells 的实现路径不同（这里是"先算理想值再一次配平"，产线是"先四舍五入再修"），
//    但只要同规格，结果必须一致 —— 这本身就是对产线 A 结论的复算。
// ─────────────────────────────────────────────────────────────────────────────
function wedgeRowWidths(n) {
  const R = Math.max(1, Math.ceil(Math.sqrt(n)));
  if (R === 1) return [1];
  const denom = (R * (R - 1)) / 2;
  const a = Math.max(1, (n - R) / denom);
  const w = [];
  for (let r = 0; r < R; r++) w.push(Math.max(1, Math.round(1 + a * r)));
  w[0] = 1;
  // 配平：单调不降约束下把 Σw 调回 n（从最宽的后排开始削/补）
  let sum = w.reduce((x, y) => x + y, 0);
  let guard = 0;
  while (sum !== n && guard++ < 10000) {
    if (sum > n) {
      let done = false;
      for (let i = R - 1; i >= 1; i--) {
        if (w[i] > w[i - 1] && w[i] > 1) { w[i]--; sum--; done = true; break; }
      }
      if (!done) break;
    } else {
      let done = false;
      for (let i = R - 1; i >= 1; i--) {
        if (w[i] - w[i - 1] < 2) { w[i]++; sum++; done = true; break; }
      }
      if (!done) { w[R - 1] += n - sum; sum = n; }
    }
  }
  return w;
}

/** 排内第 k 个格位的横向格位号（与产线同一约定：整数格、偶数排整体左偏半格） */
function gyOf(width, k) { return k - Math.floor((width - 1) / 2); }

/** 楔形格位集合：index 0 = 楔尖 [0,0]（保证与产线锚点语义一致） */
function wedgeCells(n) {
  const w = wedgeRowWidths(n);
  const out = [];
  for (let r = 0; r < w.length; r++) for (let k = 0; k < w[r]; k++) out.push({ gx: -r, gy: gyOf(w[r], k), row: r });
  const [x0, y0] = [out[0].gx, out[0].gy];
  return { cells: out.map((c) => ({ ...c, gx: c.gx - x0, gy: c.gy - y0 })), widths: w };
}

/** 足迹 / 实际格距 / 层数 / 层距（与 fleetTierLayout 同一组公式，但独立实现） */
function vLayout(cells) {
  let he = 0, gxMin = 1e9, gxMax = -1e9, gyMin = 1e9, gyMax = -1e9;
  const rowCnt = new Map();
  for (const c of cells) {
    he = Math.max(he, Math.abs(c.gx), Math.abs(c.gy));
    gxMin = Math.min(gxMin, c.gx); gxMax = Math.max(gxMax, c.gx);
    gyMin = Math.min(gyMin, c.gy); gyMax = Math.max(gyMax, c.gy);
    rowCnt.set(c.gx, (rowCnt.get(c.gx) || 0) + 1);
  }
  let wid = 1; rowCnt.forEach((v) => { if (v > wid) wid = v; });
  const widCells = Math.max(1, wid - 1);
  const depCells = Math.max(1, rowCnt.size - 1);
  const spacingEff = Math.min(SPEC.spacing, (SPEC.hexR * SPEC.footprintLimit) / Math.max(1, he));
  const layerGap = Math.max(SPEC.layerGapK * spacingEff, SPEC.layerSafe * SPEC.maxShipH);
  const minSpan = Math.min(widCells, depCells) * spacingEff;
  const layersRaw = 1 + Math.round((SPEC.layerCountK * minSpan) / Math.max(1e-6, layerGap));
  const layers = Math.max(1, Math.min(SPEC.layersCap, layersRaw));
  const thickness = (layers - 1) * layerGap;
  return { he, gxMin, gxMax, gyMin, gyMax, widCells, depCells, spacingEff, layerGap, layers, layersRaw, thickness };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 相机 + 针孔投影（独立实现）
//    坐标口径：2D (px,py) → world (x=px, z=-py)，与产线 `sprite.x/worldX`、`-sprite.y/worldZ` 一致。
//    elevDeg = 相机高出地平线的仰角；azim = 相机水平偏移方位（atan2(X,Z) 口径）。
//    "正后方"（δ=0）时 azim = atan2(-cos fa, sin fa)。
// ─────────────────────────────────────────────────────────────────────────────
function camBackAzim(fa) { return Math.atan2(-Math.cos(fa), Math.sin(fa)); }

function project(points, { elevDeg, azim, dist = 600 }) {
  const E = (elevDeg * Math.PI) / 180;
  const cam = [
    Math.cos(E) * Math.sin(azim) * dist,
    Math.sin(E) * dist,
    Math.cos(E) * Math.cos(azim) * dist,
  ];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const f = norm(sub([0, 0, 0], cam));            // 视线：相机 → 原点
  const right = norm(cross(f, [0, 1, 0]));
  const up = cross(right, f);
  const scr = points.map((p) => {
    const q = sub(p, cam);
    const z = dot(q, f);
    // 乘 dist 把归一化坐标还原成**像素量级**（在注视平面上 1 世界单位 ≈ 1px，与产线 hexR=50/px 口径一致）
    return { sx: (dot(q, right) / z) * dist, sy: (dot(q, up) / z) * dist };
  });
  return scr;
}

/** 格位 → 世界坐标（含队内层偏移；layers=0 表示压平） */
function cellsToWorld(cells, v, fa, layerOff, layers) {
  const cf = Math.cos(fa), sf = Math.sin(fa);
  return cells.map((c, i) => {
    const ox = c.gx * v.spacingEff, oy = c.gy * v.spacingEff;
    const px = ox * cf - oy * sf;               // 与 rotateOffsetPx 同式（2D）
    const py = ox * sf + oy * cf;
    const y = layers > 1 ? (layerOff[i] || 0) * v.layerGap : 0;
    return [px, y, -py];
  });
}

/** 确定性去相关层号（替代产线 R2 序列；结论只依赖"层号与排号去相关"这一规格性质） */
function scatterLayers(nrow, layers) {
  const out = new Array(nrow).fill(0);
  const PHI = 0.6180339887498949;
  for (let i = 0; i < nrow; i++) {
    const u = ((i * PHI) % 1 + 1) % 1;
    out[i] = Math.floor(u * layers) - (layers - 1) / 2;
  }
  // 居中（与产线一致：按实际极值居中）
  const lo = Math.min(...out), hi = Math.max(...out);
  const mid = (lo + hi) / 2;
  return out.map((v) => v - mid);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 统计
// ─────────────────────────────────────────────────────────────────────────────
function spearman(xs, ys) {
  const n = xs.length;
  if (n < 2) return 1;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n).fill(0);
    for (let k = 0; k < n; k++) r[idx[k][1]] = k + 1;
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy || 1e-12);
}

/**
 * 四项屏幕判据（每一项都能独立复算，互不引用投影中间量）
 *   S1 planeAspect  : 压平投影（layers=1）的 纵跨/横跨 —— "像不像一个三角"的形状量
 *   S2 rowStack     : 压平投影下 |Spearman(排号, 该排屏幕 y)| 与相邻排间距 —— 排是否"叠"
 *   S3 layerSmear   : 分层厚度投影 / 纵深投影 ≤ 0.5 —— 叠层是否把三角糊成竖块（C 的可量化形式）
 *   S4 binSpans     : 探针同口径（16 层 + 屏幕纵向 6 等分箱）跨度序列 |Spearman| ≥ 0.9 且逆序 ≤ 1
 */
const AC = { planeAspectMin: 0.30, planeAspectMax: 0.80, minRowSepPx: 4, layerSmearMax: 0.5, binSpearMin: 0.9, binInversionMax: 1 };

function planeStats(cells, scr, spansByRow) {
  const byRow = new Map();
  for (let i = 0; i < cells.length; i++) {
    const a = byRow.get(cells[i].row) || { sy: [] };
    a.sy.push(scr[i].sy);
    byRow.set(cells[i].row, a);
  }
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]);
  const meanSy = rows.map(([, a]) => a.sy.reduce((s, v) => s + v, 0) / a.sy.length);
  let minSep = Infinity;
  for (let i = 1; i < meanSy.length; i++) minSep = Math.min(minSep, Math.abs(meanSy[i] - meanSy[i - 1]));
  return { rowOrder: Math.abs(spearman(rows.map(([r]) => r), meanSy)), minSep, meanSy, spans: spansByRow };
}

function screenExtent(scr) {
  const sy = scr.map((p) => p.sy), sx = scr.map((p) => p.sx);
  return { vExt: Math.max(...sy) - Math.min(...sy), hExt: Math.max(...sx) - Math.min(...sx), y0: Math.min(...sy) };
}

function measure(cells, scrFlat, scrLayered, v) {
  // S1/S2：压平投影
  const rowSpan = new Map();
  for (let i = 0; i < cells.length; i++) {
    const a = rowSpan.get(cells[i].row) || { lo: 1e9, hi: -1e9 };
    a.lo = Math.min(a.lo, scrFlat[i].sx); a.hi = Math.max(a.hi, scrFlat[i].sx);
    rowSpan.set(cells[i].row, a);
  }
  const rowKeys = [...rowSpan.keys()].sort((a, b) => a - b);
  const spans = rowKeys.map((k) => rowSpan.get(k).hi - rowSpan.get(k).lo);
  const flat = planeStats(cells, scrFlat, spans);
  const extFlat = screenExtent(scrFlat);
  const planeAspect = extFlat.vExt / (extFlat.hExt || 1e-9);
  const depthScreen = extFlat.vExt;                    // 压平后纵跨 = 纵深投影
  const layerSmear = 0;                                // 由 frame() 用真实仰角重算

  // S4：分层投影 + 屏幕纵向 6 等分箱（探针同口径）
  const ext = screenExtent(scrLayered);
  const bins = new Map();
  for (const p of scrLayered) {
    const k = Math.min(5, Math.floor(((p.sy - ext.y0) / Math.max(1e-9, ext.vExt)) * 6));
    const a = bins.get(k) || { lo: 1e9, hi: -1e9 };
    a.lo = Math.min(a.lo, p.sx); a.hi = Math.max(a.hi, p.sx);
    bins.set(k, a);
  }
  const binKeys = [...bins.keys()].sort((a, b) => a - b);
  const binSpans = binKeys.map((k) => bins.get(k).hi - bins.get(k).lo);
  const binSpear = spearman(binKeys, binSpans);
  let binInv = 0;
  const dir = binSpear >= 0 ? 1 : -1;
  for (let i = 1; i < binSpans.length; i++) if (dir * (binSpans[i] - binSpans[i - 1]) < -2) binInv++;

  return { planeAspect, rowOrder: flat.rowOrder, minSep: flat.minSep, spans, binSpans, binSpear, binInv, depthScreen, layerSmear };
}

/** 一帧：n 舰楔形 + formFacing + 相机 (elev, δ) */
function frame(n, fa, elevDeg, deltaDeg, opts = {}) {
  const dist = opts.dist || 600;
  const { cells, widths } = wedgeCells(n);
  const v = vLayout(cells);
  const azim = camBackAzim(fa) + (deltaDeg * Math.PI) / 180;
  const flat = cellsToWorld(cells, v, fa, new Array(cells.length).fill(0), 1);
  const lay = cellsToWorld(cells, v, fa, scatterLayers(cells.length, v.layers), v.layers);
  const scrFlat = project(flat, { elevDeg, azim, dist });
  const scrLay = project(lay, { elevDeg, azim, dist });
  const m = measure(cells, scrFlat, scrLay, v);
  const E = (elevDeg * Math.PI) / 180;
  m.layerSmear = (v.thickness * Math.cos(E)) / Math.max(1e-9, m.depthScreen);
  m.pass = m.planeAspect >= AC.planeAspectMin && m.planeAspect <= AC.planeAspectMax
    && m.rowOrder >= 0.9 && m.minSep >= AC.minRowSepPx
    && m.layerSmear <= AC.layerSmearMax
    && Math.abs(m.binSpear) >= AC.binSpearMin && m.binInv <= AC.binInversionMax;
  return { widths, v, m };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 自测（判据四条之②：先自验，再对他人下结论）
// ─────────────────────────────────────────────────────────────────────────────
const SELF_TESTS = [];
function t(name, fn) { SELF_TESTS.push({ name, fn }); }

// T1 已知答案（手算，正交极限）：正俯视 89.9° + dist→∞ 时，每排横跨之比必须**恰好** = (w-1) 之比
t('T1 正交极限下每排横跨比 == (w-1) 比（手算已知答案，校验投影器本身）', () => {
  const { cells, widths } = wedgeCells(89);
  const v = vLayout(cells);
  const world = cellsToWorld(cells, v, 0, new Array(cells.length).fill(0), 1);
  const scr = project(world, { elevDeg: 89.9, azim: camBackAzim(0), dist: 1e6 });
  const byRow = new Map();
  for (let i = 0; i < cells.length; i++) {
    const a = byRow.get(cells[i].row) || { lo: 1e9, hi: -1e9 };
    a.lo = Math.min(a.lo, scr[i].sx); a.hi = Math.max(a.hi, scr[i].sx);
    byRow.set(cells[i].row, a);
  }
  const keys = [...byRow.keys()].sort((a, b) => a - b);
  const spans = keys.map((k) => byRow.get(k).hi - byRow.get(k).lo);
  const last = spans[spans.length - 1];
  const errs = spans.map((s, i) => Math.abs(s / last - (widths[keys[i]] - 1) / (widths[keys[keys.length - 1]] - 1)));
  const worst = Math.max(...errs);
  return { ok: worst < 2e-3, detail: `最坏相对误差=${worst.toExponential(2)}（阈值 2e-3）` };
});

// T2 单调性方向正确（负向对照）：把排宽倒序 → Spearman 必为 -1
t('T2 倒序排宽 ⇒ 箱跨度 Spearman ≈ -1（统计量方向自检）', () => {
  const n = 89; const { cells } = wedgeCells(n);
  const flipped = cells.map((c) => ({ ...c, row: 9 - c.row }));
  const v = vLayout(cells);
  const flat = cellsToWorld(flipped, v, 0, new Array(cells.length).fill(0), 1);
  const lay = cellsToWorld(flipped, v, 0, new Array(cells.length).fill(0), 1);
  const m = measure(flipped, project(flat, { elevDeg: 58.5, azim: camBackAzim(0) }), project(lay, { elevDeg: 58.5, azim: camBackAzim(0) }), v);
  return { ok: m.binSpear < -0.9, detail: `binSpear=${m.binSpear.toFixed(3)}` };
});

// T3 命中样本：δ=0 / 仰角 58.5° / 分层开 ⇒ 四项全过
t('T3 正后方 + 58.5° + 16 层 ⇒ 判定为"能看出三角"（应命中）', () => {
  const r = frame(89, 0, 58.5, 0);
  return { ok: r.m.pass, detail: `planeAspect=${r.m.planeAspect.toFixed(2)} rowOrder=${r.m.rowOrder.toFixed(2)} minSep=${r.m.minSep.toFixed(1)} smear=${r.m.layerSmear.toFixed(2)} binSpear=${r.m.binSpear.toFixed(2)}` };
});

// T4 不命中样本：同一仰角、侧向 δ=90° ⇒ 必须判失败
t('T4 侧向 δ=90°（同 58.5°）⇒ 必须判"读不出"（应不命中）', () => {
  const r = frame(89, 0, 58.5, 90);
  return { ok: !r.m.pass, detail: `planeAspect=${r.m.planeAspect.toFixed(2)} rowOrder=${r.m.rowOrder.toFixed(2)} binSpear=${r.m.binSpear.toFixed(2)}` };
});

// T5 不命中样本：低仰角 17.4° 即便正后方也读不出 ⇒ 证明"仰角"是独立必要条件
t('T5 低仰角 17.4° + δ=0 ⇒ 必须判"读不出"（仰角独立性）', () => {
  const r = frame(89, 0, 17.4, 0);
  return { ok: !r.m.pass, detail: `planeAspect=${r.m.planeAspect.toFixed(2)} 需≥${AC.planeAspectMin}；smear=${r.m.layerSmear.toFixed(2)}` };
});

// T6 门限可达：沿仰角扫描必须出现"由差变好"的翻转（判据非恒真恒假）
t('T6 仰角扫描 10→90° 存在判定翻转（门限可达、非恒真恒假）', () => {
  let seenBad = false, seenGood = false;
  for (let e = 10; e <= 90; e += 2) { const r = frame(89, 0, e, 0); if (r.m.pass) seenGood = true; else seenBad = true; }
  return { ok: seenBad && seenGood, detail: `bad=${seenBad} good=${seenGood}` };
});

function runSelfTests(quiet) {
  let pass = 0;
  const rows = [];
  for (const { name, fn } of SELF_TESTS) {
    let r;
    try { r = fn(); } catch (e) { r = { ok: false, detail: `EXC ${e.message}` }; }
    if (r.ok) pass++;
    rows.push([r.ok ? 'PASS' : 'FAIL', name, r.detail]);
  }
  if (!quiet) {
    console.log('\n── 自测（先自验，再下结论）──');
    for (const [s, n, d] of rows) console.log(`  ${s}  ${n}\n        ${d}`);
  }
  console.log(`  自测：${pass}/${SELF_TESTS.length} 通过`);
  return pass === SELF_TESTS.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 主报告
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const quiet = process.argv.includes('--quiet');
  console.log('楔形阵可读性 · 独立几何对拍器（只读，不引用 frontend/**）');

  const selfOk = runSelfTests(quiet);

  // ── 5.1 A 复算：n=89 的排宽 / 足迹 / 格距 / 层数
  const cellsA = wedgeCells(89);
  const vA = vLayout(cellsA.cells);
  const upstreamWidths = '1,3,5,6,8,10,12,13,15,16';
  const myWidths = cellsA.widths.join(',');
  const sumOk = cellsA.widths.reduce((a, b) => a + b, 0) === 89;
  const monoOk = cellsA.widths.every((w, i) => i === 0 || w >= cellsA.widths[i - 1]);
  const stepOk = cellsA.widths.every((w, i) => i === 0 || w - cellsA.widths[i - 1] <= 2);
  console.log('\n── A 复算（n=89 楔形几何）──');
  console.log(`  排宽（本器）= [${myWidths}]  Σ=${cellsA.widths.reduce((a, b) => a + b, 0)}`);
  console.log(`  排宽（上游）= [${upstreamWidths}]  ⇒ ${myWidths === upstreamWidths ? '逐位一致 ✓' : '不一致 ✗'}`);
  console.log(`  规格性质：Σw=89 ${sumOk ? '✓' : '✗'} / 单调不降 ${monoOk ? '✓' : '✗'} / 排宽差≤2 ${stepOk ? '✓' : '✗'}`);
  console.log(`  纵深 = ${(vA.gxMax - vA.gxMin)} 格 × ${vA.spacingEff}px = ${((vA.gxMax - vA.gxMin) * vA.spacingEff).toFixed(0)}px`);
  console.log(`  横向 gy ∈ [${vA.gyMin}, ${vA.gyMax}] ⇒ 屏幕跨 [${(vA.gyMin * vA.spacingEff).toFixed(0)}, +${(vA.gyMax * vA.spacingEff).toFixed(0)}]px`
    + `（总跨 ${((vA.gyMax - vA.gyMin) * vA.spacingEff).toFixed(0)}px，非对称量 ${((vA.gyMax + vA.gyMin) * vA.spacingEff).toFixed(0)}px = 半格左偏）`);
  console.log(`  格距 spacingEff = min(26, ${SPEC.hexR * SPEC.footprintLimit}/${vA.he}) = ${vA.spacingEff.toFixed(3)}px`);
  console.log(`  层距 layerGap = max(${SPEC.layerGapK}×${vA.spacingEff.toFixed(2)}=${(SPEC.layerGapK * vA.spacingEff).toFixed(3)}, `
    + `${SPEC.layerSafe}×${SPEC.maxShipH}=${(SPEC.layerSafe * SPEC.maxShipH).toFixed(3)}) = ${vA.layerGap.toFixed(3)}`
    + `  ⇒ ${SPEC.layerGapK * vA.spacingEff > SPEC.layerSafe * SPEC.maxShipH ? '比例项胜出（注释"几何下限恒胜出"已过期 ✓ D 成立）' : '几何下限胜出（D 不成立）'}`);
  console.log(`  层数 = min(16, 1+round(${Math.min(vA.widCells, vA.depCells)}×${vA.spacingEff.toFixed(2)}/${vA.layerGap.toFixed(3)})) = ${vA.layers}（未截断值 ${vA.layersRaw}）`);
  console.log(`  纵向厚度 = (${vA.layers}-1)×${vA.layerGap.toFixed(3)} = ${vA.thickness.toFixed(1)} 世界单位`);

  // ── 5.2 Q1/Q4：方位 × 仰角 二维扫描（把"方位"与"仰角"分离）
  console.log('\n── Q1/Q4 二维扫描：仰角 × 相对方位 δ（n=89，formFacing=0，16 层）──');
  const deltas = [0, 15, 30, 45, 60, 75, 90];
  const elevs = [17.4, 27, 35, 45, 50, 58.5, 65, 70, 80];
  console.log('  elev\\δ ' + deltas.map((d) => String(d).padStart(5)).join('') + '   ★=四项全过（可读）');
  for (const e of elevs) {
    const line = deltas.map((d) => {
      const r = frame(89, 0, e, d);
      return (r.m.pass ? '★' : '·') + r.m.planeAspect.toFixed(2).slice(0, 4);
    });
    console.log('  ' + String(e).padStart(5) + '  ' + line.map((s) => s.padStart(5)).join(''));
  }
  console.log('  （数字 = 压平投影的 纵跨/横跨；· = 至少一项判据不达标）');

  // 判据绑定项：每个格子里到底是哪一条在拦
  console.log('\n  判定绑定项（每格列出未达标的第一条）：');
  for (const e of [17.4, 35, 45, 50, 58.5]) {
    const cells2 = deltas.map((d) => {
      const r = frame(89, 0, e, d).m;
      if (r.pass) return `${String(d).padStart(2)}°:过`;
      if (r.planeAspect < AC.planeAspectMin) return `${String(d).padStart(2)}°:S1形状${r.planeAspect.toFixed(2)}`;
      if (r.layerSmear > AC.layerSmearMax) return `${String(d).padStart(2)}°:S3叠层${r.layerSmear.toFixed(2)}`;
      if (r.rowOrder < 0.9) return `${String(d).padStart(2)}°:S2排序${r.rowOrder.toFixed(2)}`;
      if (r.minSep < AC.minRowSepPx) return `${String(d).padStart(2)}°:S2排距${r.minSep.toFixed(1)}`;
      return `${String(d).padStart(2)}°:S4箱宽${r.binSpear.toFixed(2)}`;
    });
    console.log('    ' + String(e).padStart(5) + '°  ' + cells2.join('  '));
  }

  // 判定边界：每个 δ 下"最小可读仰角"
  console.log('\n  每个 δ 下最小可读仰角（2° 步进）：');
  for (const d of deltas) {
    let best = null;
    for (let e = 10; e <= 90; e += 2) { if (frame(89, 0, e, d).m.pass) { best = e; break; } }
    console.log(`    δ=${String(d).padStart(2)}° ⇒ ${best === null ? '不存在（任何仰角都读不出）' : best + '°'}`);
  }

  // 门限的解析来源（不拍脑袋）：S3 反解仰角下限
  const needTanE = (2 * vA.thickness) / ((vA.gxMax - vA.gxMin) * vA.spacingEff);
  console.log(`\n  门限推导：S3（叠层投影 ≤ 纵深投影的 50%）⇔ tan(仰角) ≥ 2×厚度/纵深 = ${needTanE.toFixed(3)}`
    + ` ⇔ 仰角 ≥ ${((Math.atan(needTanE) * 180) / Math.PI).toFixed(1)}°`);
  console.log(`            S1（纵跨/横跨 ≥ 0.30）在 δ=0 时 ⇔ sin(仰角) ≥ 0.5 ⇔ 仰角 ≥ 30.0°（更松）`
    + ` ⇒ 50° 门限的**严格**依据是 S3 的 ${((Math.atan(needTanE) * 180) / Math.PI).toFixed(1)}° + 余量。`);

  // ── 5.3 Q1：入场取景与开战取景两条路径的实际参数
  console.log('\n── Q1 两条取景路径（从代码反算，无需起服务）──');
  // 路径① 入场聚焦 focusOnFleet：elev 参数 0.55 → 仰角 = 90° - 31.5°
  const entryElev = 90 - (0.55 * 180) / Math.PI;
  const entryFrame = frame(89, 0, entryElev, 0);
  console.log(`  ① 入场聚焦 focusOnFleet(elev=0.55) ⇒ 仰角 ${entryElev.toFixed(1)}°，方位严格沿 formFacing 反方向（δ=0）`);
  console.log(`     ⇒ 若取景瞬间的 formFacing 与稳态一致 ⇒ 判定 ${entryFrame.m.pass ? '通过 ★' : '不通过'}`);
  // 路径② buildSpaceWorld 固定机位：y=sin(0.6109)d，水平=cos(0.6109)d ⇒ 仰角 35°，方位 azim=0
  const openElev = (0.6109 * 180) / Math.PI;
  console.log(`  ② 世界建成机位（buildSpaceWorld）⇒ 仰角 ${openElev.toFixed(1)}°，方位 azim=0（**与任何舰队的 formFacing 无关**）`);
  for (const faDeg of [0, 45, 90, 135, 180]) {
    const fa = (faDeg * Math.PI) / 180;
    const delta = ((Math.atan2(Math.sin(0 - camBackAzim(fa)), Math.cos(0 - camBackAzim(fa)))) * 180) / Math.PI;
    const r = frame(89, fa, openElev, delta);
    const bind = r.m.planeAspect < AC.planeAspectMin ? `S1形状 ${r.m.planeAspect.toFixed(2)}`
      : r.m.layerSmear > AC.layerSmearMax ? `S3叠层 ${r.m.layerSmear.toFixed(2)}`
        : r.m.rowOrder < 0.9 ? `S2排序 ${r.m.rowOrder.toFixed(2)}` : `S4箱宽 ${r.m.binSpear.toFixed(2)}`;
    console.log(`     formFacing=${String(faDeg).padStart(3)}° ⇒ 相对方位 δ=${delta.toFixed(0).padStart(4)}° ⇒ ${r.m.pass ? '通过 ★' : '不通过（' + bind + '）'}`);
  }
  console.log('  ⇒ 同一台固定机位（azim=0）下，formFacing 决定可读性：这是"一侧正常一侧异常"的**机制**来源；'
    + '但哪一侧坏由各方实际 formFacing 决定，不能由阵营推断。');

  // ── 5.4 Q2：楔尖舰长 vs 纵深间隙（与相机无关的第二因子）
  console.log('\n── Q2 楔尖舰长 vs 纵深排间间隙（与相机无关）──');
  for (const elev of [58.5, 45, 35, 17.4]) {
    const sepPx = SPEC.spacing * Math.sin((elev * Math.PI) / 180);
    const bigProj = SPEC.hullLen * Math.sin((elev * Math.PI) / 180);
    const smallProj = SPEC.hullLenSmall * Math.sin((elev * Math.PI) / 180);
    console.log(`  仰角 ${String(elev).padStart(4)}°：排间屏幕间隙 ${sepPx.toFixed(1)}px`
      + ` ｜ 大舰首投影 ${bigProj.toFixed(1)}px（填满 ${((bigProj / sepPx) * 100).toFixed(0)}%）`
      + ` ｜ 小舰首投影 ${smallProj.toFixed(1)}px（填满 ${((smallProj / sepPx) * 100).toFixed(0)}%）`);
  }
  console.log('  ⇒ 若楔尖舰首投影 < 排间间隙的 ~60%，"楔尖一艘 + 空隙 + 后面一堆"在几何上就成立'
    + '（与相机方位无关 ⇒ 归位后仍会剩这一条）。');

  // ── 5.5 距离不敏感性（曾经怀疑 AC-W2 的形状比会随自适应距离漂移 —— 实测证否）
  console.log('\n── 5.5 AC-W2 形状比 vs 相机距离（仰角 60°/δ=0；曾怀疑会漂移，实测否掉）──');
  console.log('  n\\dist\t300\t406\t600\t900   （夹取下限 6×hexR=300；入场上限 18×hexR=900）');
  for (const n of [41, 89, 120, 198, 400]) {
    const row = [300, 406, 600, 900].map((d) => frame(n, 0, 60, 0, { dist: d }).m.planeAspect.toFixed(3));
    console.log(`  ${String(n).padStart(4)}\t${row.join('\t')}`);
  }
  console.log('  ⇒ 对距离**不敏感**：纵跨与横跨同源于最近（最宽）那一排，透视放大因子 z 相消 ⇒ 形状比 ≡ 0.6·sin(仰角)·|cosδ|。'
    + '\n    这是好消息：AC-W2 对「距离按足迹自适应」稳健。真正的变数是 **n**（0.520 → 0.433），门禁余量按最大编成的实测值取。');

  // ── 5.6 终验补测：AC-W2 判别量（|Δ meanScreenY|）在两极的判别力 + AC-W3 解析门禁独立复算
  console.log('\n── 5.6a S2 判别量 min|Δ meanScreenY| vs 相对方位 δ（n=89，仰角 60°，压平，阈值 4px）──');
  for (const d of [0, 15, 30, 45, 60, 75, 90]) {
    const r = frame(89, 0, 60, d).m;
    console.log(`  δ=${String(d).padStart(2)}° ⇒ minSep=${r.minSep.toFixed(1)}px `
      + `(阈值 4px 的 ${(r.minSep / 4).toFixed(1)} 倍，${r.minSep >= 4 ? '判过' : '判不过'}) ｜ planeAspect=${r.planeAspect.toFixed(3)}`
      + ` ｜ rowOrder=${r.rowOrder.toFixed(2)}`);
  }
  console.log('  ⇒ 正常视角（δ=0）与反例（δ=90°）之间差一个数量级 ⇒ 该判别量**不是为让反例通过而定制的**。');

  console.log('\n── 5.6b AC-W3 解析门禁独立复算（不引用产线函数，只用厚度与纵深）──');
  for (const n of [89, 198]) {
    const { cells } = wedgeCells(n);
    const v = vLayout(cells);
    const depth = (v.gxMax - v.gxMin) * v.spacingEff;
    const need = (2 * v.thickness) / depth;
    const deg = (Math.atan(need) * 180) / Math.PI;
    const smear35 = (v.thickness * Math.cos((35 * Math.PI) / 180)) / (depth * Math.sin((35 * Math.PI) / 180));
    const smear60 = (v.thickness * Math.cos((60 * Math.PI) / 180)) / (depth * Math.sin((60 * Math.PI) / 180));
    console.log(`  n=${n}: 层数 ${v.layers} × 层距 ${v.layerGap.toFixed(3)} ⇒ 厚度 ${v.thickness.toFixed(1)}, 纵深 ${depth.toFixed(0)}`
      + ` ⇒ 2t/d = ${need.toFixed(4)} ⇒ 门禁仰角 ${deg.toFixed(1)}°`
      + ` ｜ 35° 代入 ${smear35.toFixed(3)}（${smear35 > 0.5 ? '越界 ✓' : '未越界 ✗'}） ｜ 60° 代入 ${smear60.toFixed(3)}`);
  }

  // ── 5.7 结论
  const cEntry = frame(89, 0, entryElev, 0).m.pass;
  const cSide = frame(89, 0, 58.5, 90).m.pass;
  const cLow = frame(89, 0, 17.4, 0).m.pass;
  const cFlat35 = frame(89, 0, openElev, 0).m.pass;
  const claims = [
    ['AC-S 入场聚焦(58.5°/δ=0) 判定通过', cEntry === true],
    ['AC-S 侧向(58.5°/δ=90°) 判定不通过', cSide === false],
    ['AC-S 低仰角(17.4°/δ=0) 判定不通过（仰角是独立必要条件）', cLow === false],
    ['AC-S 开战固定机位(35°/δ=0) 判定不通过（叠层糊化）⇒ 只抬方位不抬仰角不够', cFlat35 === false],
    ['A 复算：排宽与上游逐位一致 + 规格三条性质成立', myWidths === upstreamWidths && sumOk && monoOk && stepOk],
    ['D 复算：89 舰下 spacingEff=26 ⇒ 比例项胜出（注释已过期）', Math.abs(vA.spacingEff - 26) < 1e-9
      && SPEC.layerGapK * vA.spacingEff > SPEC.layerSafe * SPEC.maxShipH],
    ['C 复算：层数 16 / 层距 8.125 / 厚度 121.9（±0.1）', vA.layers === 16 && Math.abs(vA.layerGap - 8.125) < 0.01
      && Math.abs(vA.thickness - 121.875) < 0.1],
  ];
  console.log('\n── 结论 ──');
  let allOk = selfOk;
  for (const [n, ok] of claims) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) allOk = false; }
  console.log(allOk ? '\nOVERALL: PASS' : '\nOVERALL: FAIL');
  process.exit(allOk ? 0 : 1);
}

main();
