/**
 * _fresh_projection_audit.cjs — 【全新复盘·决定性一步】楔形在真实相机下的屏幕投影形态
 *
 * 运行：node --import ./_ts_resolve.mjs scripts/_fresh_projection_audit.cjs
 *
 * 问题重述（忘掉旧修复链）：数据层健康（u0 精确在槽位、cells 正确、审计 9/9），
 * 但玩家看到的是"一条斜线 / 前面一艘+空隙+后面一堆"。
 * ⇒ 病灶只可能在「3D 世界坐标 → 屏幕」这一段：楔形被近乎**侧视**（沿 gy 宽度轴看）时，
 *   390px 宽的三角在屏幕上塌成一条线；且楔形逐排 1,3,5,6,8… 舰，
 *   投影后正是「1 艘 + 疏 + 密」的视觉。
 *
 * 本审计：用 focusOnFleet 的真实相机（elev=0.55, azim=0.6）+ 不同 formFacing
 * 投影 89 个楔形点，输出屏幕包围盒宽高比。比值 ≫ 1 = 侧视成线；≈ 足迹比 = 正常三角。
 */
'use strict';

const { formationOffsets, formationSpacing, rotateOffsetPx } = require('../frontend/src/config/formationLayout.ts');

const N = 89;
const offs = formationOffsets('wedge', N);
const spacing = formationSpacing(offs, 50);

// ── 复刻 focusOnFleet 的相机几何（Battle3DOverlay）────────────────────────────
const ELEV = 0.55, AZIM = 0.6;
// 相机在 t + (sin(elev)sin(azim), cos(elev), sin(elev)cos(azim)) * dist，看向 t
// 视线方向（相机→t）：
const V = [-(Math.sin(ELEV) * Math.sin(AZIM)), -Math.cos(ELEV), -(Math.sin(ELEV) * Math.cos(AZIM))];
const vLen = Math.hypot(V[0], V[1], V[2]);
const vd = V.map(v => v / vLen);
// 屏幕水平轴 = normalize(cross(viewDir, up))；up=(0,1,0)
const UP = [0, 1, 0];
let S = [
  vd[1] * UP[2] - vd[2] * UP[1],
  vd[2] * UP[0] - vd[0] * UP[2],
  vd[0] * UP[1] - vd[1] * UP[0],
];
const sLen = Math.hypot(S[0], S[1], S[2]);
S = S.map(v => v / sLen);

/** 2D 点 (px,py) → 世界 (px, 0, -py) → 屏幕 (horiz, depth-ish) */
function project(px, py) {
  const w = [px, 0, -py];
  const sx = w[0] * S[0] + w[1] * S[1] + w[2] * S[2];   // 屏幕水平
  return sx;
}

console.log(`=== 楔形 n=${N} 在真实相机（elev=${ELEV} azim=${AZIM}）下的投影 ===\n`);
console.log('formFacing(弧度) | 投影水平跨度 | 垂直于视线的地面跨度 | 宽高比 | 形态判定');

const results = [];
for (let deg = 0; deg < 180; deg += 15) {
  const f = (deg * Math.PI) / 180;
  let sxMin = 1e9, sxMax = -1e9;
  // 垂直方向 = 视线在地面投影的深度轴（屏幕垂直 ≈ 地面纵深投影）
  let syMin = 1e9, syMax = -1e9;
  for (const [gx, gy] of offs) {
    const [ox, oy] = rotateOffsetPx(gx * spacing, gy * spacing, f, 1);
    const w = [ox, 0, -oy];
    const sx = w[0] * S[0] + w[1] * S[1] + w[2] * S[2];
    // 屏幕垂直分量用地面深度轴（viewDir 与 up 张成的平面内的地面分量）
    const G = [vd[0], 0, vd[2]];
    const gl = Math.hypot(G[0], G[1], G[2]) || 1;
    const sy = (w[0] * G[0] + w[1] * G[1] + w[2] * G[2]) / gl;
    sxMin = Math.min(sxMin, sx); sxMax = Math.max(sxMax, sx);
    syMin = Math.min(syMin, sy); syMax = Math.max(syMax, sy);
  }
  const wSpan = sxMax - sxMin, dSpan = syMax - syMin;
  const ratio = Math.max(wSpan, dSpan) / Math.max(1, Math.min(wSpan, dSpan));
  const verdict = ratio > 3 ? '⚠ 侧视成线' : (ratio > 2 ? '△ 压扁' : '✓ 三角可读');
  console.log(`${String(deg).padStart(3)}° (${f.toFixed(2)})   | ${wSpan.toFixed(0).padStart(6)}px     | ${dSpan.toFixed(0).padStart(6)}px            | ${ratio.toFixed(2).padStart(5)} | ${verdict}`);
  results.push({ deg, ratio, verdict });
}

// ── 判定 ────────────────────────────────────────────────────────────────────
console.log('');
const lineAngles = results.filter(r => r.ratio > 3).map(r => r.deg);
if (lineAngles.length > 0) {
  console.log(`⚠ 存在 ${lineAngles.length} 个朝向使楔形投影成线（deg: ${lineAngles.join(', ')}）`);
  console.log('  ⇒ 只要 formFacing 落进这些朝向，玩家就会看到"一条线"而非三角 —— 数据完全正确也会"看起来坏"');
} else {
  console.log('✓ 所有朝向下楔形投影均可读为三角 —— 视觉线状必来自数据（需回到位置写点）');
}

// ── 附：逐排投影（验证"1 艘+疏+密"视觉）──────────────────────────────────────
console.log(`\n=== 逐排投影（facing=0，验证"前面一艘+空隙+后面一堆"）===`);
const rows = new Map();
for (const [gx, gy] of offs) {
  if (!rows.has(gx)) rows.set(gx, []);
  rows.get(gx).push(gy);
}
for (const gx of [...rows.keys()].sort((a, b) => b - a)) {
  const gys = rows.get(gx);
  console.log(`  gx=${String(gx).padStart(3)} 舰数=${String(gys.length).padStart(2)}  gy跨度=[${Math.min(...gys)},${Math.max(...gys)}]`);
}
console.log('\n（排宽 1,3,5,6,8… = 侧视投影下"1 艘打头 + 疏 + 密集成堆"的来源）');
