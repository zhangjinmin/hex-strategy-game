/**
 * wedgeReadabilitySim.cjs — **楔形「读不读得出三角」**台架（纯函数台架，零 three / 零 DOM）
 *
 * 运行：node --import ./_ts_resolve.mjs scripts/wedgeReadabilitySim.cjs
 *
 * ── 判据来源（v2，2026-10-25 质量复核后重写）────────────────────────────────────
 * v1 用「屏幕纵向 6 分箱跨度的单调性」当门禁，**已被证伪**（qa 独立复算）：
 *   δ=15°（视觉完全正常）时 Spearman = −0.26；δ=45°（已经歪了）时反而 = +1.00 ——
 *   因为 16 层纵向散布把相邻排摊进了同一个分箱。**分箱统计只能当排查线索，不许当门禁。**
 * 现在门禁换成三条**几何量**，全部可由 (θ, elev, layers, layerGap, offsets, spacing) 纯函数算出：
 *   · AC-W1 取景：`dot(normalize(camXZ − targetXZ), forward) ≤ −0.94` 且 `elev ∈ [50°, 70°]`；
 *   · AC-W2 投影比：压平投影后「纵跨/横跨」∈ [0.30, 0.80]，相邻排屏幕间距 ≥ 4px；
 *   · AC-W3 叠层：`(layers−1)·layerGap·cos(elev) / 纵深屏幕投影 ≤ 0.5`
 *     （解析等价 `tan(elev) ≥ 2·厚度/纵深` ⇒ elev ≥ 46.2°，同时证伪"只抬方位就够"）。
 * 外加四条负向断言（AC-W4①~④，每条对应一次真实事故）的**可离线部分**；
 *   需要跑类的部分（位姿 Δ、逐舰阵位差、拖拽 120 帧）由真机探针 `_diag_wedge_reframe.cjs` 验。
 *
 * ── 独立来源纪律 ──────────────────────────────────────────────────────────────
 *   · 格位/格距/旋转/分层 = 真源码（`formationLayout.ts`、`fleetTierLayout.ts`），不抄；
 *   · 相机机位 = 由「相机方向 ≡ −前向」的几何要求**用向量直接给出**（不经 atan2 公式）；
 *   · 投影 = 本文件自写针孔相机，两套独立实现互校（基向量法 vs 旋转矩阵法）；
 *   · 被测的 `atan2(−cos fa, sin fa)` 只作**被检验者**，不参与期望值构造；
 *   · `Battle3DOverlay.ts` 无法在纯台架 import（`import * as THREE` + Pinia）⇒ 其落点用**源码契约**锁定。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { formationOffsets, formationSpacing, formationFootprint, rotateOffsetPx } = require('../frontend/src/config/formationLayout.ts');
const { layerCountForFootprint, layerGapFor, TEAM_LAYERS } = require('../frontend/src/config/fleetTierLayout.ts');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (e) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}: ${e.message}\n`);
    process.exitCode = 1;
  }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const D2R = Math.PI / 180;

/* ══════════════════════════════════════════════════════════════════════════
 * 一、投影几何（独立实现）
 * ══════════════════════════════════════════════════════════════════════════ */
const FOV_Y_DEG = 50;      // = Battle3DOverlay 的 PerspectiveCamera(50, …)
const ASPECT = 16 / 9;
const W = 1600, H = 900;

/** 相机机位：eye = target + d·u，u = (cosφ·sin a, sinφ, cosφ·cos a)；φ = 高于地平线的仰角 */
function eyeOf(target, azim, phi, dist) {
  const cp = Math.cos(phi), sp = Math.sin(phi);
  return [target[0] + cp * Math.sin(azim) * dist, target[1] + sp * dist, target[2] + cp * Math.cos(azim) * dist];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
function viewBasis(eye, target) {
  const f = unit([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const s = unit(cross(f, [0, 1, 0]));
  const uu = cross(s, f);
  return { f, s, uu, eye };
}
const TAN_V = Math.tan((FOV_Y_DEG * D2R) / 2);
const TAN_H = TAN_V * ASPECT;
/** 实现 A：基向量法 */
function projectBasis(b, p) {
  const v = [p[0] - b.eye[0], p[1] - b.eye[1], p[2] - b.eye[2]];
  const depth = dot3(v, b.f);
  return { ndcX: (dot3(v, b.s) / depth) / TAN_H, ndcY: (dot3(v, b.uu) / depth) / TAN_V, depth };
}
/** 实现 B：旋转矩阵法（相机看 −Z） */
function projectMatrix(b, p) {
  const v = [p[0] - b.eye[0], p[1] - b.eye[1], p[2] - b.eye[2]];
  const R = [b.s, b.uu, [-b.f[0], -b.f[1], -b.f[2]]];
  const vc = R.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  const depth = -vc[2];
  return { ndcX: (vc[0] / depth) / TAN_H, ndcY: (vc[1] / depth) / TAN_V, depth };
}
const toScreen = (ndcX, ndcY) => [(ndcX * 0.5 + 0.5) * W, (1 - (ndcY * 0.5 + 0.5)) * H];

/** 屏幕包围盒与「纵跨/横跨」（压平投影：各舰同一 y 平面） */
function screenExtent(basis, pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    const r = projectBasis(basis, p);
    const [sx, sy] = toScreen(r.ndcX, r.ndcY);
    if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
    if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
  }
  const w = x1 - x0, h = y1 - y0;
  return { w, h, ratio: h / Math.max(1e-6, w) };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 二、阵型几何（真源码）
 * ══════════════════════════════════════════════════════════════════════════ */
const HEX_R = 50;

function fleetCells(n, formation = 'wedge') {
  const offs = formationOffsets(formation, n);
  const sp = formationSpacing(offs, HEX_R);
  return { offs, sp };
}

/** 世界坐标（相对质心）：px (x, y) → world (x, 0, −y)。旋转直接用真源码 rotateOffsetPx。 */
function shipsWorld(n, facing, formation = 'wedge') {
  const { offs, sp } = fleetCells(n, formation);
  const px = offs.map(([gx, gy]) => rotateOffsetPx(gx * sp, gy * sp, facing, 1));
  let mx = 0, my = 0;
  for (const [x, y] of px) { mx += x; my += y; }
  mx /= px.length; my /= px.length;
  return { pts: px.map(([x, y]) => [x - mx, 0, -(y - my)]), rows: offs.map(([gx]) => gx), n: offs.length, sp };
}

/** 足迹半跨（相对质心）+ 两轴整跨（W2/W3 用整跨，因为"厚度要塞进纵深"看的是整跨） */
function footprint(n, formation = 'wedge') {
  const { offs, sp } = fleetCells(n, formation);
  let cgx = 0, cgy = 0;
  for (const [gx, gy] of offs) { cgx += gx; cgy += gy; }
  cgx /= offs.length; cgy /= offs.length;
  let halfLat = 0, halfDep = 0, gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
  for (const [gx, gy] of offs) {
    halfDep = Math.max(halfDep, Math.abs((gx - cgx) * sp));
    halfLat = Math.max(halfLat, Math.abs((gy - cgy) * sp));
    gx0 = Math.min(gx0, gx); gx1 = Math.max(gx1, gx);
    gy0 = Math.min(gy0, gy); gy1 = Math.max(gy1, gy);
  }
  return { halfLat, halfDep, sp, depthExtent: (gx1 - gx0) * sp, latExtent: (gy1 - gy0) * sp };
}

/** 该队**实际生效**的 layers / layerGap / 厚度（全部来自真源码，不抄常量） */
function teamStack(n, maxShipH, formation = 'wedge') {
  const { offs, sp } = fleetCells(n, formation);
  const fp = formationFootprint(offs);
  const layerGap = layerGapFor(sp, maxShipH);
  const layers = layerCountForFootprint(fp, sp, layerGap, TEAM_LAYERS);
  return { layers, layerGap, thickness: (layers - 1) * layerGap, fp, sp };
}

/** 取景距离（"刚好装下整队"）：半跨 / tan(半视角) × 余量（独立实现，用于把比例换成屏幕量） */
function fitDistance(halfLat, halfDep, fitK = 1.2) {
  return Math.max(halfDep / TAN_V, halfLat / TAN_H) * fitK;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 三、被测公式（只作被检验者）与独立期望
 * ══════════════════════════════════════════════════════════════════════════ */
/** 工程现行公式：azim = atan2(−cos fa, sin fa)（逐字镜像，供检验） */
const framingAzimuth = (fa) => Math.atan2(-Math.cos(fa), Math.sin(fa));
/** 世界前向（px (cos fa, sin fa) → world (cos fa, −sin fa)） */
const worldForward = (fa) => [Math.cos(fa), 0, -Math.sin(fa)];

const FACINGS = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 4, -Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3];
const ELEV_FRAME = 60 * D2R;

/* ══════════════════════════════════════════════════════════════════════════
 * 四、断言
 * ══════════════════════════════════════════════════════════════════════════ */

process.stdout.write('\n[0] 投影实现互校（基向量法 vs 旋转矩阵法）\n');
check('两套独立投影实现逐点一致（|Δ| ≤ 1e-9）', () => {
  const { pts } = shipsWorld(89, 0.37);
  const eye = eyeOf([0, 0, 0], framingAzimuth(0.37), ELEV_FRAME, 500);
  const b = viewBasis(eye, [0, 0, 0]);
  for (const p of pts) {
    const A = projectBasis(b, p), B = projectMatrix(b, p);
    if (!near(A.ndcX, B.ndcX, 1e-9) || !near(A.ndcY, B.ndcY, 1e-9) || !near(A.depth, B.depth, 1e-6)) {
      throw new Error(`不一致 p=${p.map((v) => v.toFixed(2))}`);
    }
  }
});

process.stdout.write('\n[AC-W1] 取景：与 forward 点积 ≤ −0.94，仰角 ∈ [50°, 70°]，覆盖 8 个 θ\n');
check('8 个 facing 全部落在阵型纵深轴后方且满足点积门禁', () => {
  const rows = [];
  for (const fa of FACINGS) {
    const azim = framingAzimuth(fa);
    const eye = eyeOf([0, 0, 0], azim, ELEV_FRAME, 400);
    // 相机水平方向（世界 XZ）由 eye 独立还原，不用 atan2 公式的中间量
    const camXZ = unit([eye[0], 0, eye[2]]);
    const fwd = worldForward(fa);
    const dot = camXZ[0] * fwd[0] + camXZ[2] * fwd[2];
    // 仰角由 eye 独立反算（与传入值互校）
    const elev = Math.atan2(eye[1], Math.hypot(eye[0], eye[2])) / D2R;
    rows.push(`θ=${(fa / D2R).toFixed(0)}° dot=${dot.toFixed(4)} elev=${elev.toFixed(1)}°`);
    if (!(dot <= -0.94)) throw new Error(`θ=${fa} 点积 ${dot.toFixed(4)} > −0.94`);
    if (!(elev >= 50 && elev <= 70)) throw new Error(`θ=${fa} 仰角 ${elev.toFixed(1)}° 越界`);
  }
  process.stdout.write(`      ${rows.join(' | ')}\n`);
});

process.stdout.write('\n[AC-W2] 压平投影「纵跨/横跨」∈ [0.30, 0.80]，相邻排屏幕**纵向**间距 ≥ 4px\n');
/**
 * ⚠ 第二句必须量**纵向**间距（|ΔscreenY|），不是两排之间的最短欧氏距离：
 *   "排"能不能被读出来，取决于**排的推进方向是不是屏幕纵向**。横向轴取景时相邻排
 *   恰好沿屏幕**横向**排开（最短距离仍然很大），但它们在纵向上几乎重合 ⇒ 视觉上读作
 *   一条等宽带。用最短距离会放过这个反例（本台架第一版就是这么错的）。
 */
for (const n of [41, 89, 120]) {
  check(`wedge n=${n}：取景机位下投影比在带内 + 相邻排纵向间距 ≥4px`, () => {
    const fa = 0;
    const { pts, rows } = shipsWorld(n, fa);
    const fp = footprint(n);
    const dist = fitDistance(fp.halfLat, fp.halfDep);
    const b = viewBasis(eyeOf([0, 0, 0], framingAzimuth(fa), ELEV_FRAME, dist), [0, 0, 0]);
    const ext = screenExtent(b, pts);
    // 逐排屏幕纵坐标（排内取均值），再看相邻排的纵向间距
    const byRow = new Map();
    pts.forEach((p, i) => { const k = rows[i]; if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push(p); });
    const keys = [...byRow.keys()].sort((a, b2) => b2 - a);   // 队首(gx 大) → 队尾
    const rowY = keys.map((k) => {
      const ys = byRow.get(k).map((p) => { const r = projectBasis(b, p); return toScreen(r.ndcX, r.ndcY)[1]; });
      return ys.reduce((s, v) => s + v, 0) / ys.length;
    });
    let minGap = Infinity;
    for (let i = 1; i < rowY.length; i++) minGap = Math.min(minGap, Math.abs(rowY[i] - rowY[i - 1]));
    process.stdout.write(`      n=${n} dist=${dist.toFixed(0)} 纵跨=${ext.h.toFixed(0)}px 横跨=${ext.w.toFixed(0)}px 比=${ext.ratio.toFixed(3)} 相邻排纵向间距=${minGap.toFixed(1)}px\n`);
    if (!(ext.ratio >= 0.30 && ext.ratio <= 0.80)) throw new Error(`投影比 ${ext.ratio.toFixed(3)} 越界 [0.30, 0.80]`);
    if (!(minGap >= 4)) throw new Error(`相邻排纵向间距 ${minGap.toFixed(1)}px < 4px（排会糊成一坨）`);
  });
}

check('反例：横向轴取景 ⇒ 相邻排纵向间距塌陷（证伪"方位无所谓"）', () => {
  const n = 89, fa = 0;
  const { pts, rows } = shipsWorld(n, fa);
  const fp = footprint(n);
  const dist = fitDistance(fp.halfLat, fp.halfDep);
  // 横向轴：世界横向 = (sin fa, cos fa) ⇒ azim = atan2(sin fa, cos fa)（独立于取景公式）
  const b = viewBasis(eyeOf([0, 0, 0], Math.atan2(Math.sin(fa), Math.cos(fa)), 17.4 * D2R, dist), [0, 0, 0]);
  const ext = screenExtent(b, pts);
  const byRow = new Map();
  pts.forEach((p, i) => { const k = rows[i]; if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push(p); });
  const keys = [...byRow.keys()].sort((a, b2) => b2 - a);
  const rowY = keys.map((k) => {
    const ys = byRow.get(k).map((p) => { const r = projectBasis(b, p); return toScreen(r.ndcX, r.ndcY)[1]; });
    return ys.reduce((s, v) => s + v, 0) / ys.length;
  });
  let minGap = Infinity;
  for (let i = 1; i < rowY.length; i++) minGap = Math.min(minGap, Math.abs(rowY[i] - rowY[i - 1]));
  process.stdout.write(`      横向轴 17.4°：纵跨=${ext.h.toFixed(0)}px 横跨=${ext.w.toFixed(0)}px 比=${ext.ratio.toFixed(3)}（比在带内属正常，它不是判别量）相邻排纵向间距=${minGap.toFixed(1)}px\n`);
  if (minGap >= 4) throw new Error(`横向轴上相邻排纵向间距 ${minGap.toFixed(1)}px ≥ 4px（反例失效）`);
});

process.stdout.write('\n[AC-W3] 叠层门禁：(layers−1)·layerGap·cos(elev)/纵深屏幕投影 ≤ 0.5（逐舰队真值）\n');
// maxShipH 两组真机实测值（89 舰主力 H=5.89；198 舰大编队 H=8.83）
const H_CASES = [{ n: 89, maxShipH: 5.89, tag: '89 舰主力' }, { n: 198, maxShipH: 8.83, tag: '198 舰大编队' }];
for (const { n, maxShipH, tag } of H_CASES) {
  check(`${tag}：60° 仰角下叠层比 ≤ 0.5；35°（buildSpaceWorld 固定机位）越界`, () => {
    const st = teamStack(n, maxShipH);
    const fp = footprint(n);
    const dist = fitDistance(fp.halfLat, fp.halfDep);
    const { pts } = shipsWorld(n, 0);
    const ratioAt = (elevDeg) => {
      const b = viewBasis(eyeOf([0, 0, 0], framingAzimuth(0), elevDeg * D2R, dist), [0, 0, 0]);
      const ext = screenExtent(b, pts);
      // ① 按 qa 口径：厚度投影 / 纵深屏幕投影（长度都换算到屏幕像素）
      const pxPerWorld = ext.h / Math.max(1e-6, fp.depthExtent * Math.sin(elevDeg * D2R));
      const thickPx = st.thickness * Math.cos(elevDeg * D2R) * pxPerWorld;
      const ratioPx = thickPx / ext.h;
      // ② 尺度无关等价式（应逐位相等，证明解析等价）
      const ratioWorld = st.thickness * Math.cos(elevDeg * D2R) / (fp.depthExtent * Math.sin(elevDeg * D2R));
      if (!near(ratioPx, ratioWorld, 1e-6)) throw new Error(`两种口径不一致 ${ratioPx} vs ${ratioWorld}`);
      return { ratioPx, ext, st };
    };
    const r60 = ratioAt(60);
    const r35 = ratioAt(35);
    process.stdout.write(`      ${tag}: sp=${st.sp} layers=${st.layers} layerGap=${st.layerGap.toFixed(2)} 厚度=${st.thickness.toFixed(1)} 纵深=${fp.depthExtent.toFixed(0)} | 60°比=${r60.ratioPx.toFixed(3)} 35°比=${r35.ratioPx.toFixed(3)}\n`);
    if (!(r60.ratioPx <= 0.5)) throw new Error(`60° 叠层比 ${r60.ratioPx.toFixed(3)} > 0.5`);
    if (!(r35.ratioPx > 0.5)) throw new Error(`35° 叠层比 ${r35.ratioPx.toFixed(3)} 未越界（"只抬方位就够"没被证伪）`);
    // 解析等价：tan(elev) ≥ 2·厚度/纵深
    const needDeg = Math.atan(2 * st.thickness / fp.depthExtent) / D2R;
    process.stdout.write(`      解析门禁：elev ≥ ${needDeg.toFixed(1)}°（本队）\n`);
    if (!(needDeg < 60 && needDeg > 35)) throw new Error(`门禁角 ${needDeg.toFixed(1)}° 不在 (35°,60°) —— 判据与实测不一致`);
  });
}

process.stdout.write('\n[AC-W4] 四条负向断言（可离线部分 = 源码契约 + 收敛性纯数学）\n');
function readSrc(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
function methodBody(src, name) {
  const i = src.indexOf(name);
  if (i < 0) return null;
  const rest = src.slice(i);
  // 方法体到下一个「形如成员声明」的位置为止
  const m = rest.search(/\n  (?:private|public|protected|\/\*\*)/);
  return m < 0 ? rest : rest.slice(0, m);
}
check('① 幂等：唯一入口带 _openReframeDone 闸门（重复调用不得再改相机）', () => {
  const src = readSrc('frontend/src/game/three/Battle3DOverlay.ts');
  const body = methodBody(src, 'private runOpeningReframe()');
  if (!body) throw new Error('缺 runOpeningReframe');
  if (!body.includes('if (this._openReframeDone) return;')) throw new Error('缺一次性闸门');
  if ((src.match(/this\.runOpeningReframe\(\)/g) || []).length < 2) throw new Error('调用点不足（tick + entry_end）');
  if (!src.includes('private _openReframeDone = false;')) throw new Error('缺状态字段');
});
check('② 取景不动阵位：归位方法体内不得写 sprite / formationSlot / 摆位函数', () => {
  const src = readSrc('frontend/src/game/three/Battle3DOverlay.ts');
  const body = methodBody(src, 'private framePlayerMainFleetForOpening()');
  if (!body) throw new Error('缺 framePlayerMainFleetForOpening');
  const forbidden = ['placeUnitsAtFormationSlots', '.sprite.x =', '.sprite.y =', 'formationSlot ='];
  for (const f of forbidden) if (body.includes(f)) throw new Error(`归位里出现了阵位写入：${f}`);
  if (!body.includes('focusOnFleet(')) throw new Error('归位未走 focusOnFleet（会绕开唯一取景实现）');
});
check('③ 拖拽期推迟（不抢镜头）+ 跟随默认关闭 + 秒基限速 + 死区', () => {
  const src = readSrc('frontend/src/game/three/Battle3DOverlay.ts');
  const body = methodBody(src, 'private runOpeningReframe()');
  if (!body.includes('< this._camUserDragUntil')) throw new Error('缺"拖拽期推迟"分支');
  // [v108] 连续方位跟随会**自己转镜头**（只要场上有舰队在转向就每帧扭一点、且无终止条件），
  //   用户实报「没动镜头它自己动起来」即此 ⇒ 必须默认关闭，靠 `?follow=1` 显式开启。
  if (!src.includes('const CAM_FOLLOW_ENABLED_DEFAULT = false;')) throw new Error('跟随未默认关闭');
  // 限速必须**秒基**：旧 `0.05 rad/帧` 在 60fps 下 = 172°/s、144fps 下 = 412°/s，
  //   "帧率越高转得越快"本身就是缺陷，因此这里连"存在每帧常量"都要禁掉。
  if (!/const FOLLOW_MAX_RAD_PER_SEC = [\d.]+;/.test(src)) throw new Error('缺秒基限速常量');
  if (/const FOLLOW_MAX_STEP\s*=/.test(src)) throw new Error('旧的"每帧最大转角"常量仍在（帧率相关）');
  if (!src.includes('FOLLOW_MAX_RAD_PER_SEC * dt')) throw new Error('限速未按 dt 换算（仍在按帧）');
  if (!/const FOLLOW_DEADZONE_RAD = [\d.]+;/.test(src)) throw new Error('缺死区常量');
  if (!src.includes('Math.abs(d) > FOLLOW_DEADZONE_RAD')) throw new Error('死区未接入判定');
  if (!src.includes('followOn && !userBusy')) throw new Error('跟随未受开关门控');
  if (src.includes('Math.abs(d) < 0.6')) throw new Error('旧"跳过"守卫仍在（急转会留下永久 δ）');
});
check('④ 急转收敛：单帧 ≤ 速率×dt、无过冲、残差收敛进死区', () => {
  const RATE = 0.35, DT = 1 / 60, DEAD = 0.12;
  const FAC = RATE * DT;                       // 单帧最大转角（秒基换算后的值）
  let cur = 0, applied = 0, frames = 0;
  const target = 1.57;                         // 单帧 90° 急转
  while (Math.abs(target - cur) > DEAD && frames < 100000) {
    const d = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
    const step = Math.max(-FAC, Math.min(FAC, d));
    if (!(Math.abs(step) <= FAC + 1e-12)) throw new Error(`单帧步长 ${step} > ${FAC}`);
    if (Math.abs(step) > Math.abs(d) + 1e-12) throw new Error('过冲');
    if (Math.sign(step) !== Math.sign(d)) throw new Error('反向');
    cur += step; applied += Math.abs(step); frames += 1;
  }
  // 死区语义：残差允许停在 DEAD 以内（旧实现要求 δ→0，那正是"永不停止"的来源）
  if (Math.abs(target - cur) > DEAD + 1e-9) throw new Error(`残差未收敛进死区：${Math.abs(target - cur)}`);
  const theory = Math.ceil((Math.abs(target) - DEAD) / FAC);
  if (frames > theory + 1) throw new Error(`收敛帧数 ${frames} 超出理论下限 ${theory}`);
  process.stdout.write(`      90° 急转：${frames} 帧收敛进死区（理论 ${theory}），单帧 ≤ ${(FAC * 180 / Math.PI).toFixed(2)}°，累计 ${applied.toFixed(4)} rad\n`);
});

process.stdout.write('\n[契约] T1/T2 源码落点 + 跨文件常量一致性\n');
check('T1：focusOnFleet 用 atan2(−cos fa, sin fa) 取方位', () => {
  const src = readSrc('frontend/src/game/three/Battle3DOverlay.ts');
  if (!src.includes('const azim = Math.atan2(-Math.cos(_ffa), Math.sin(_ffa));')) throw new Error('方位公式被改掉');
});
check('T1：归位入口/状态/距离自适应/elev 选项齐备', () => {
  const src = readSrc('frontend/src/game/three/Battle3DOverlay.ts');
  for (const s of [
    'this._openReframeArmedAt + OPEN_REFRAME_DELAY_MS',
    'elevAboveHorizon: OPEN_REFRAME_ELEV_ABOVE_HORIZON',
    'rebaseFollow: true',
    'halfDep / Math.max(1e-3, tanV) * OPEN_REFRAME_FIT_K',
    'this.updateLodTier();',
  ]) if (!src.includes(s)) throw new Error(`缺：${s}`);
  // 不得改 OrbitControls 的缩放范围（会抹掉用户缩放）—— 只在**归位方法体内**判，
  //   全局判会撞上 OrbitControls 初始化里的正常赋值。
  const frameBody = methodBody(src, 'private framePlayerMainFleetForOpening()') || '';
  for (const s of ['controls.minDistance =', 'controls.maxDistance =', 'minDistance', 'maxDistance']) {
    if (frameBody.includes(s)) throw new Error(`归位里改动了 ${s}（会抹掉用户缩放）`);
  }
});
check("T0′：归位延迟 ≤300ms（‘开场空窗’回归护栏）+ 有 spaceBuilt 就绪判据", () => {
  const src = readSrc('frontend/src/game/three/Battle3DOverlay.ts');
  const m = src.match(/const OPEN_REFRAME_DELAY_MS = (\d+);/);
  if (!m) throw new Error('未找到 OPEN_REFRAME_DELAY_MS');
  const ms = Number(m[1]);
  process.stdout.write(`      OPEN_REFRAME_DELAY_MS = ${ms}ms\n`);
  if (!(ms <= 300)) throw new Error(`延迟 ${ms}ms > 300ms（开场会停在固定机位）`);
  if (!src.includes('if (!this.spaceBuilt) return false;')) throw new Error('缺 spaceBuilt 就绪判据（会把相机对准未生成的世界）');
  if (!src.includes('sinceEntryMs:')) throw new Error('缺 sinceEntryMs 读数（无法验收"落下时刻"）');
});

check('T2：描边近景地板 + 填充策略未变 + 迷雾门禁 + 单折线', () => {
  const src = readSrc('frontend/src/game/three/Battle3DOverlay.ts');
  for (const s of [
    'const MARKER_OUTLINE_MIN = 0.30;',
    'const outlineAlpha = Math.max(Math.max(fadeOut, MARKER_FLOOR_OUTLINE) * meshOff, outlineFloor);',
    'const markerAlpha = Math.max(fadeOut, MARKER_FLOOR) * meshOff;',
    'm.outline.visible = outlineVisible',
    'if (!this.isFleetIntelVisible(fl)) continue;',       // 迷雾门禁
  ]) if (!src.includes(s)) throw new Error(`缺：${s}`);
  // 每队恰一条折线：markerNormShape → 单个 LineLoop，且不得按排再建折线
  const mk = methodBody(src, 'private ensureFleetMark(');
  if (!mk) throw new Error('缺 ensureFleetMark');
  if ((mk.match(/new THREE\.LineLoop/g) || []).length !== 1) throw new Error('ensureFleetMark 里 LineLoop 不是恰好 1 个（按排描边会重演"楼梯"）');
  if (mk.includes('for (const') && mk.includes('LineLoop') && (mk.match(/LineLoop/g) || []).length > 1) throw new Error('出现了多条折线');
});
check('跨文件常量一致：formationLayout 注释的 SHIP_VISUAL_SCALE == overlay 真值', () => {
  const fl = readSrc('frontend/src/config/formationLayout.ts');
  const ov = readSrc('frontend/src/game/three/Battle3DOverlay.ts');
  const mOv = ov.match(/const SHIP_VISUAL_SCALE = ([\d.]+);/);
  if (!mOv) throw new Error('overlay 未找到 SHIP_VISUAL_SCALE 定义');
  const truth = Number(mOv[1]);
  const bad = [...fl.matchAll(/SHIP_VISUAL_SCALE = ([\d.]+)/g)].map((m) => Number(m[1])).filter((v) => v !== truth);
  process.stdout.write(`      overlay 真值 = ${truth}；formationLayout 注释中出现的不一致值 = ${bad.length ? bad.join(',') : '无'}\n`);
  if (bad.length) throw new Error(`注释与真值不一致：${bad.join(',')} ≠ ${truth}`);
});

process.stdout.write(`\n${passed} PASS / ${failed} FAIL\n`);
