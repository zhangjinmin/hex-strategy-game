/**
 * CommandSpaceRenderer.ts — 指挥制专用：Tron 式矢量扫描空间
 *
 * 视觉目标（对标 1982《电子世界争霸战》扫描画面 / 用户参考图）：
 *   1. 绿色扭曲网格：横竖两组折线共享同一"时空扭曲"位移场，
 *      形成起伏的扫描网面（不是均匀方格，是弯折的、有引力凹陷感的网格）
 *   2. 橙色线框质量体：若干圆柱/圆盘状线框（椭圆环 + 竖向母线），
 *      像参考图中央的橙色扫描盘——表示"引力异常区"，纯装饰不参与战斗
 *   3. 星点：低亮度白点，数量克制，不抢网格戏
 *   4. 扫描线 overlay：全屏水平细线 + 缓慢下移的亮扫描带 + 四角取景框
 *
 * （原「与 renderCRTWireframeMap 的区别」一段已随「全息战术投影」模式删除 —— 现在只有本文件这一种渲染。）
 */

// ===== Tron 扫描风格配色 =====
/** 强调色（取景框 / 索敌标记等）：亮绿 */
const CRT_ACCENT = 0x00cc66;
/** 扫描线颜色：更亮的青绿 */
const CRT_SCAN_COLOR = 0x00ff88;
/** 网格主色：青绿（参考图的绿色网面） */
const TRON_GRID = 0x1fd28f;
/** 网格亮线（每 4 条一次的加亮主线） */
const TRON_GRID_MAJOR = 0x3dffb0;
/** 质量体橙色（参考图的橙红线框） */
const TRON_ORANGE = 0xff5a1f;
const TRON_ORANGE_DIM = 0xcc4414;

/** 确定性伪随机（mulberry32）：同一 seed 同一布局，避免重开背景跳变 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 时空扭曲位移场：由若干"引力凹陷"叠加，返回 (x,y) 处的位移向量。
 * wells 的坐标在网格生成前确定，网格围绕质量体产生凹陷弯折——
 * 正是参考图中绿色网格被橙色物体"压弯"的观感。
 */
function makeWarpField(wells: { x: number; y: number; r: number; k: number }[]) {
  return (x: number, y: number): { dx: number; dy: number } => {
    let dx = Math.sin(x * 0.0021 + y * 0.0013) * 16 + Math.sin(y * 0.0037 - x * 0.0009) * 10;
    let dy = Math.cos(x * 0.0016 - y * 0.0027) * 12 + Math.sin(x * 0.0041 + y * 0.0007) * 8;
    for (const w of wells) {
      const vx = x - w.x, vy = y - w.y;
      const d = Math.sqrt(vx * vx + vy * vy) + 1;
      // 引力凹陷：靠近质量体被"吸"过去，远处衰减归零
      const pull = w.k * Math.exp(-d / w.r);
      dx += (vx / d) * pull;
      dy += (vy / d) * pull;
    }
    return { dx, dy };
  };
}

/** 单个线框质量体：堆叠椭圆环 + 竖向母线（参考图的橙色圆盘/圆柱） */
function drawWireWell(
  g: Phaser.GameObjects.Graphics,
  x: number, y: number, radius: number, height: number, squash: number, rings: number,
): void {
  const segs = 18;
  // 水平椭圆环（自上而下堆叠 = 圆柱体感）
  for (let i = 0; i <= rings; i++) {
    const ry = y - height / 2 + (height / rings) * i;
    // 中间环略大：桶形轮廓，比纯圆柱更接近参考图的"盘状"物体
    const bulge = 1 + 0.12 * Math.sin((i / rings) * Math.PI);
    g.lineStyle(1.1, TRON_ORANGE, 0.55);
    g.beginPath();
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const px = x + Math.cos(a) * radius * bulge;
      const py = ry + Math.sin(a) * radius * bulge * squash;
      if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.strokePath();
  }
  // 竖向母线
  const verts = 10;
  g.lineStyle(1, TRON_ORANGE_DIM, 0.45);
  for (let v = 0; v < verts; v++) {
    const a = (v / verts) * Math.PI * 2;
    const px = x + Math.cos(a) * radius;
    g.lineBetween(px, y - height / 2 + Math.sin(a) * radius * squash,
                  px, y + height / 2 + Math.sin(a) * radius * squash);
  }
  // 顶部内环（扫描盘中心的"轴口"，参考图顶部的小圆柱凸起）
  g.lineStyle(1.2, TRON_ORANGE, 0.6);
  g.beginPath();
  for (let s = 0; s <= segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    const px = x + Math.cos(a) * radius * 0.28;
    const py = (y - height / 2 - height * 0.18) + Math.sin(a) * radius * 0.28 * squash;
    if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.strokePath();
  g.lineStyle(1, TRON_ORANGE_DIM, 0.5);
  g.lineBetween(x, y - height / 2, x, y - height / 2 - height * 0.18);
}

/**
 * 绘制指挥制宇宙背景：扭曲网格 + 橙色线框质量体 + 星点
 * @param cam  相机（保留参数签名兼容，实际用固定世界范围）
 * @param g    Graphics 对象（本函数负责 clear）
 * @param seed 布局种子，保证同一局形状稳定
 */
export function drawCommandSpace(cam: Phaser.Cameras.Scene2D.Camera, g: Phaser.GameObjects.Graphics, seed = 1): void {
  // 固定世界范围：create() 阶段 cam.width/zoom 可能尚未初始化
  const w = 4200;
  const h = 2800;
  g.clear();

  const halfW = w / 2;
  const halfH = h / 2;
  const rng = mulberry32(seed);

  // ---- 1. 质量体布局（先定物体，再让网格围绕它们凹陷）----
  const wellCount = 4 + Math.floor(rng() * 3); // 4-6 个
  const wells: { x: number; y: number; r: number; k: number; radius: number; height: number; rings: number }[] = [];
  for (let i = 0; i < wellCount; i++) {
    const wx = (rng() - 0.5) * w * 0.86;
    const wy = (rng() - 0.5) * h * 0.86;
    const radius = 70 + rng() * 130;
    wells.push({
      x: wx, y: wy,
      radius,
      height: 40 + rng() * 80,
      rings: 3 + Math.floor(rng() * 3),
      r: 260 + rng() * 200,          // 引力影响半径
      k: 30 + rng() * 45,            // 凹陷强度
    });
  }
  const warp = makeWarpField(wells);

  // ---- 2. 星点（低亮度，白+少量绿）----
  for (let i = 0; i < 200; i++) {
    const sx = (rng() - 0.5) * w * 1.1;
    const sy = (rng() - 0.5) * h * 1.1;
    const sr = rng() * 1.2 + 0.25;
    g.fillStyle(i % 9 === 0 ? TRON_GRID : 0xffffff, rng() * 0.18 + 0.04);
    g.fillCircle(sx, sy, sr);
  }

  // ---- 3. 扭曲网格（核心：共享位移场的横竖折线）----
  const gridStep = 96;
  const cols = Math.floor(w / gridStep) + 1;
  const rows = Math.floor(h / gridStep) + 1;

  // 预计算位移后的格点（横竖线共用，保证网格连续不散架）
  const pts: { x: number; y: number }[][] = [];
  for (let r = 0; r <= rows; r++) {
    pts[r] = [];
    for (let c = 0; c <= cols; c++) {
      const bx = -halfW + c * gridStep;
      const by = -halfH + r * gridStep;
      const { dx, dy } = warp(bx, by);
      pts[r][c] = { x: bx + dx, y: by + dy };
    }
  }

  // 横向线：主线（每 4 条）加亮，普通线暗一些 → 参考图的疏密层次
  for (let r = 0; r <= rows; r++) {
    const major = r % 4 === 0;
    g.lineStyle(major ? 1.1 : 0.7, major ? TRON_GRID_MAJOR : TRON_GRID, major ? 0.30 : 0.16);
    g.beginPath();
    g.moveTo(pts[r][0].x, pts[r][0].y);
    for (let c = 1; c <= cols; c++) g.lineTo(pts[r][c].x, pts[r][c].y);
    g.strokePath();
  }
  // 纵向线
  for (let c = 0; c <= cols; c++) {
    const major = c % 4 === 0;
    g.lineStyle(major ? 1.1 : 0.7, major ? TRON_GRID_MAJOR : TRON_GRID, major ? 0.26 : 0.13);
    g.beginPath();
    g.moveTo(pts[0][c].x, pts[0][c].y);
    for (let r = 1; r <= rows; r++) g.lineTo(pts[r][c].x, pts[r][c].y);
    g.strokePath();
  }

  // ---- 4. 橙色线框质量体（盖在网格上）----
  for (const well of wells) {
    drawWireWell(g, well.x, well.y, well.radius, well.height, 0.34, well.rings);
  }

  // ---- 5. 中心十字方位参照（沿用 CRT 风格，极低透明）----
  g.lineStyle(1, CRT_ACCENT, 0.10);
  g.lineBetween(-halfW * 0.5, 0, halfW * 0.5, 0);
  g.lineBetween(0, -halfH * 0.5, 0, halfH * 0.5);
}

/**
 * 指挥制扫描线 overlay（相机空间，需随相机每 ~60ms 重绘）：
 * 全屏水平扫描细线 + 缓慢下移的亮扫描带 + 四角取景框
 */
export function drawCommandScanOverlay(cam: Phaser.Cameras.Scene2D.Camera, g: Phaser.GameObjects.Graphics, timeMs: number): void {
  const zoom = cam.zoom || 1;
  const vw = (cam.width || 1200) / zoom;
  const vh = (cam.height || 800) / zoom;
  const left = cam.scrollX;
  const top = cam.scrollY;
  const right = left + vw;
  const bottom = top + vh;
  g.clear();

  // 水平扫描细线（每 4px 一条，黑色半透明 → CRT 隔行感）
  g.lineStyle(1, 0x000000, 0.16);
  g.beginPath();
  for (let y = top; y <= bottom; y += 4) { g.moveTo(left, y); g.lineTo(right, y); }
  g.strokePath();

  // 缓慢下移的亮扫描带（12 秒扫过一屏）
  const bandH = 46;
  const bandY = top - bandH + ((timeMs * 0.055) % (vh + bandH * 2));
  g.fillStyle(CRT_SCAN_COLOR, 0.035);
  g.fillRect(left, bandY, vw, bandH);
  g.lineStyle(1, CRT_SCAN_COLOR, 0.14);
  g.lineBetween(left, bandY, right, bandY);
  g.lineStyle(1, CRT_SCAN_COLOR, 0.06);
  g.lineBetween(left, bandY + bandH, right, bandY + bandH);

  // 四角取景框
  const m = 12, cl = 22;
  g.lineStyle(2.5, CRT_ACCENT, 0.6);
  g.lineBetween(left + m, top + m + cl, left + m, top + m);
  g.lineBetween(left + m, top + m, left + m + cl, top + m);
  g.lineBetween(right - m, top + m + cl, right - m, top + m);
  g.lineBetween(right - m, top + m, right - m - cl, top + m);
  g.lineBetween(left + m, bottom - m - cl, left + m, bottom - m);
  g.lineBetween(left + m, bottom - m, left + m + cl, bottom - m);
  g.lineBetween(right - m, bottom - m - cl, right - m, bottom - m);
  g.lineBetween(right - m, bottom - m, right - m - cl, bottom - m);
}

/**
 * 指挥制舰队渲染：在扫描空间上画舰队标记
 * 与 redrawCRTFleets 的区别：不吃六边形坐标，直接用 fleet.x / fleet.y 连续坐标
 */
export function drawCommandFleets(
  g: Phaser.GameObjects.Graphics,
  fleets: any[],
  glowTime: number,
  factionMap: Map<number, any>,
): void {
  g.clear();
  const pulse = 0.5 + 0.5 * Math.sin(glowTime * 0.003);

  fleets.forEach((fleet: any) => {
    if (!fleet || fleet.x === undefined || fleet.y === undefined) return;
    const fac = factionMap.get(fleet.factionId);
    const color = fac?.color ?? 0x00ff88;
    const isAlive = fleet.units && fleet.units.length > 0;
    if (!isAlive) return;

    // 舰队光环（脉冲）
    g.lineStyle(1.5, color, 0.25 + pulse * 0.2);
    g.strokeCircle(fleet.x, fleet.y, 18 + pulse * 3);

    // 朝向指示（facingAngle）
    if (fleet.facingAngle !== undefined) {
      const dx = Math.cos(fleet.facingAngle) * 30;
      const dy = Math.sin(fleet.facingAngle) * 30;
      g.lineStyle(1.2, color, 0.35);
      g.lineBetween(fleet.x, fleet.y, fleet.x + dx, fleet.y + dy);
    }

    // 舰队核心点
    g.fillStyle(color, 0.85);
    g.fillCircle(fleet.x, fleet.y, 4);
  });
}
