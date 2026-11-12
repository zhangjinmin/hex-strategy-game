/**
 * _fresh_screen_audit.cjs — 全新复盘·屏幕排布审计
 *
 * 投影审计 v1 只量了包围盒宽高比（全部 ≤1.58 ⇒ "侧视成线"假说证伪）。
 * 但「1 艘 + 空隙 + 一堆」完全可能藏在正常宽高比里 —— 本脚本按**真实相机**
 * （focusOnFleet: fov=50, elev=0.55, azim=0.6）把楔形 89 点投到屏幕，
 * 直接打**散点图**，复现用户眼里看到的排布。
 *
 * 台架纪律：格位/旋转/格距一律 require 真源码，禁手抄。
 */
const { formationOffsets, formationSpacing, rotateOffsetPx } = require('../frontend/src/config/formationLayout.ts');

// ── 真源参数 ──────────────────────────────────────────────────────────────
const HEX_R = 50;                 // BattleScene: >16艘 → hexRadius=50
const FOV = 50;                   // Battle3DOverlay: PerspectiveCamera(50, ...)
const ASPECT = 16 / 9;
const ELEV = 0.55;                // focusOnFleet
const AZIM = 0.6;
const N = 89;

const offs = formationOffsets('wedge', N);
const spacing = formationSpacing(offs, HEX_R);
console.log(`=== 屏幕排布审计（真实相机 fov=${FOV} elev=${ELEV} azim=${AZIM}）===`);
console.log(`n=${offs.length} spacing=${spacing.toFixed(2)}px hexR=${HEX_R}`);

// 半跨度（格位）
let maxAbsX = 0, maxAbsY = 0;
for (const [gx, gy] of offs) { maxAbsX = Math.max(maxAbsX, Math.abs(gx)); maxAbsY = Math.max(maxAbsY, Math.abs(gy)); }
console.log(`格位半跨: gx∈[0,${-Math.min(...offs.map(c => c[0]))}] gy∈[${Math.min(...offs.map(c => c[1]))},${Math.max(...offs.map(c => c[1]))}]`);
console.log(`像素足迹: ${((maxAbsX * 2) * spacing).toFixed(0)} × ${((maxAbsY * 2) * spacing).toFixed(0)}px`);

// ── 相机 ─────────────────────────────────────────────────────────────────
// 世界坐标约定（Battle3DOverlay）: 像素 (dx,dy) → 世界 (dx, y≈0, -dy)
function makeCam(dist) {
  const target = { x: 0, y: 0, z: 0 };
  const cam = {
    x: target.x + Math.sin(ELEV) * Math.sin(AZIM) * dist,
    y: target.y + Math.cos(ELEV) * dist,
    z: target.z + Math.sin(ELEV) * Math.cos(AZIM) * dist,
    target, dist,
  };
  return cam;
}

function project(px, py, cam) {
  // 世界坐标
  const wx = px, wy = 0, wz = -py;
  // 视图矩阵：lookAt(target) —— 基向量
  const fx = cam.target.x - cam.x, fy = cam.target.y - cam.y, fz = cam.target.z - cam.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  const f = { x: fx / fl, y: fy / fl, z: fz / fl };
  // up = (0,1,0); right = f × up (归一)
  let rx = f.y * 0 - f.z * 1, ry = f.z * 0 - f.x * 0, rz = f.x * 1 - f.y * 0;
  // right = cross(f, up) = (f.y*up.z - f.z*up.y, f.z*up.x - f.x*up.z, f.x*up.y - f.y*up.x)
  rx = f.y * 0 - f.z * 1; ry = f.z * 0 - f.x * 0; rz = f.x * 1 - f.y * 0;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const R = { x: rx / rl, y: ry / rl, z: rz / rl };
  // up' = cross(R, f)
  const U = {
    x: R.y * f.z - R.z * f.y,
    y: R.z * f.x - R.x * f.z,
    z: R.x * f.y - R.y * f.x,
  };
  // 相机空间
  const dx = wx - cam.x, dy = wy - cam.y, dz = wz - cam.z;
  const cx = dx * R.x + dy * R.y + dz * R.z;
  const cy = dx * U.x + dy * U.y + dz * U.z;
  const cz = dx * f.x + dy * f.y + dz * f.z;   // 沿视线为正
  const depth = Math.max(0.1, cz);
  const tanHalf = Math.tan((FOV * Math.PI / 180) / 2);
  const ndcX = (cx / depth) / (tanHalf * ASPECT);
  const ndcY = (cy / depth) / tanHalf;
  return { sx: ndcX, sy: ndcY, depth };
}

function scatter(pts, label) {
  // 归一到 72×24 字符网格
  const W = 72, H = 26;
  const xs = pts.map(p => p.sx), ys = pts.map(p => p.sy);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const grid = Array.from({ length: H }, () => Array(W).fill(' '));
  for (const p of pts) {
    const gx = Math.round(((p.sx - x0) / Math.max(1e-6, x1 - x0)) * (W - 1));
    const gy = Math.round(((p.sy - y0) / Math.max(1e-6, y1 - y0)) * (H - 1));
    // 近的用 ● 远的用 ·（透视感知）
    const ch = p.depth < 0 ? 'X' : '●';
    grid[H - 1 - gy][gx] = ch;
  }
  console.log(`\n--- ${label}  屏幕跨度 ${(x1 - x0).toFixed(3)} × ${(y1 - y0).toFixed(3)} (ndc) ---`);
  for (const row of grid) console.log('|' + row.join('') + '|');
  return { w: x1 - x0, h: y1 - y0 };
}

function classify(pts) {
  // 屏幕上的「锥形可读性」：按深度分 3 档，看每档的横向离散与点数
  const sorted = [...pts].sort((a, b) => a.depth - b.depth);   // 近 → 远
  const n = sorted.length;
  const near = sorted.slice(0, Math.floor(n / 3));
  const mid = sorted.slice(Math.floor(n / 3), Math.floor(2 * n / 3));
  const far = sorted.slice(Math.floor(2 * n / 3));
  const spread = (arr) => {
    const xs = arr.map(p => p.sx);
    return (Math.max(...xs) - Math.min(...xs));
  };
  const row = (name, arr) => `  ${name}: ${arr.length}艘  屏幕横向离散=${spread(arr).toFixed(3)}  平均深度=${(arr.reduce((s, p) => s + p.depth, 0) / arr.length).toFixed(0)}`;
  console.log('  分档（近→远）：');
  console.log(row('近1/3', near));
  console.log(row('中1/3', mid));
  console.log(row('远1/3', far));
  // 「1+空隙+一堆」判据：近档点数 ≤2 且 远档横向离散 > 近档 3 倍
  const verdict = (near.length <= 2 && spread(far) > spread(near) * 3 + 0.05)
    ? '⚠ 符合「1 艘打头 + 远处一堆」'
    : (spread(mid) < spread(near) * 0.25 && spread(far) < spread(near) * 0.25)
      ? '⚠ 全部塌成一条线'
      : '✓ 近中远三档均有横向展开（可读为面/三角）';
  console.log('  判定: ' + verdict);
}

for (const facingDeg of [0, 180]) {
  const facing = facingDeg * Math.PI / 180;
  console.log(`\n════ formFacing=${facingDeg}° （${facingDeg === 0 ? '攻方' : '守方'}） ════`);
  for (const distK of [12, 8, 5]) {
    const dist = HEX_R * distK;
    const cam = makeCam(dist);
    const pts = offs.map(([gx, gy]) => {
      const [rx, ry] = rotateOffsetPx(gx * spacing, gy * spacing, facing, 1);
      return project(rx, ry, cam);
    });
    scatter(pts, `facing=${facingDeg}° dist=${dist}px`);
    classify(pts);
  }
}

// ── 关键对比：把舰级（大小）混进来，看「小舰打头」感知 ────────────────────
console.log('\n════ 感知测试：楔尖=小舰 vs 楔尖=大舰（facing=0, dist=600）════');
{
  const cam = makeCam(HEX_R * 12);
  const pts = offs.map(([gx, gy], i) => {
    const [rx, ry] = rotateOffsetPx(gx * spacing, gy * spacing, 0, 1);
    const p = project(rx, ry, cam);
    return p;
  });
  // 楔尖（cell[0]=gx=0）在最近处；标注其屏幕尺寸效应
  const tip = pts[0];
  const rear = pts[offs.length - 1];
  console.log(`  楔尖 slot0: 深度=${tip.depth.toFixed(0)} 屏幕(${tip.sx.toFixed(3)},${tip.sy.toFixed(3)})`);
  console.log(`  末位 slot${offs.length - 1}: 深度=${rear.depth.toFixed(0)} 屏幕(${rear.sx.toFixed(3)},${rear.sy.toFixed(3)})`);
  console.log(`  深度比（末位/楔尖）= ${(rear.depth / tip.depth).toFixed(2)} ⇒ 远端视觉缩小到 ${(tip.depth / rear.depth * 100).toFixed(0)}%`);
  classify(pts);
}
