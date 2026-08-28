/**
 * CRT 全息战术投影渲染系统（v2 伪3D等轴测版）
 * 从 BattleScene 提取，负责全部 CRT 模式的视觉渲染
 *
 * v2 升级：平面棋盘 → 立体全息投影台
 * - hex 六边形 → 等轴测"全息棱柱"（顶面 + 3个可见侧面线框，高度按格类型分层）
 * - 舰队 → 浮空舰船（旗舰悬空最高 + 地面椭圆投影 + 尾焰光柱）
 * - 保留扫描线/雷达波（3D 投影下全息感更强）
 */
import * as Phaser from 'phaser';

// ===== CRT 视觉常量 =====
export const CRT_Y_SCALE = 1;
export const CRT_BG = '#040810';
export const CRT_GRID_COLOR = 0x1a3a1a;
export const CRT_ACCENT = 0x00cc66;
export const CRT_SCAN_COLOR = 0x00ff88;
export const CRT_TEXT_COLOR = '#00cc66';
export const CRT_SCANLINE_ALPHA = 0.08;

/** 等轴测压扁系数（y 轴压缩，营造斜视俯视感） */
const ISO_Y_SCALE = 0.72;
/** 全息棱柱高度（像素，按格类型） */
const PRISM_HEIGHT: Record<string, number> = {
  castle: 20, fortress: 18, planet: 14, tower: 11, barracks: 10,
  pier: 8, gold_mine: 8, mine: 8, pending: 6, default: 6,
};
/** 全息棱柱侧面填充透明度（多层叠加模拟"高度衰减光"） */
const PRISM_FILL_ALPHA = [0.16, 0.08, 0.04]; // 顶→中→底
const PRISM_EDGE_ALPHA = 0.45;
const PRISM_TOP_HIGHLIGHT_ALPHA = 0.85; // 顶面高亮（细线）

/** 静态背景：星域深空 + 投影网格 */
export function drawCRTBackground(cam: Phaser.Cameras.Scene2D.Camera, g: Phaser.GameObjects.Graphics) {
    const w = (cam.width || 1200) / cam.zoom;
    const h = (cam.height || 800) / cam.zoom;
    g.clear();

    // 星域背景：散布微弱星点
    for (let i = 0; i < 200; i++) {
        const sx = (Math.random() - 0.5) * w * 2.5;
        const sy = (Math.random() - 0.5) * h * 2.5;
        const sr = Math.random() * 1.2 + 0.3;
        g.fillStyle(0xffffff, Math.random() * 0.25 + 0.05);
        g.fillCircle(sx, sy, sr);
    }

    // 暗绿参考网格（批量路径绘制）
    const gridStep = 80;
    const extent = Math.max(w, h) * 1.5;

    g.lineStyle(0.5, CRT_GRID_COLOR, 0.12);
    g.beginPath();
    for (let x = -extent; x < extent; x += gridStep * 2) { g.moveTo(x, -extent); g.lineTo(x, extent); }
    for (let y = -extent; y < extent; y += gridStep * 2) { g.moveTo(-extent, y); g.lineTo(extent, y); }
    g.strokePath();

    g.lineStyle(0.5, CRT_GRID_COLOR, 0.04);
    g.beginPath();
    for (let x = -extent + gridStep; x < extent; x += gridStep * 2) { g.moveTo(x, -extent); g.lineTo(x, extent); }
    for (let y = -extent + gridStep; y < extent; y += gridStep * 2) { g.moveTo(-extent, y); g.lineTo(extent, y); }
    g.strokePath();

    g.lineStyle(1, CRT_ACCENT, 0.15);
    g.lineBetween(-w, 0, w, 0);
    g.lineBetween(0, -h, 0, h);

    for (let r = 100; r < Math.max(w, h); r += 150) {
        g.lineStyle(0.5, CRT_ACCENT, 0.04);
        g.strokeCircle(0, 0, r);
    }
}

export interface CrtContext {
    hexRadius: number;
    factionMap: Map<number, any>;
    store: any;
}

/** 计算 hex 的等轴测顶点（顶面，y 压扁） */
function isoHexTopPoints(x: number, y: number, r: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        pts.push(x + r * Math.cos(angle));
        pts.push(y + r * Math.sin(angle) * ISO_Y_SCALE);
    }
    return pts;
}

/** 绘制单个全息棱柱：顶面 + 3个可见侧面（右下/下方/左下），分层精细化 */
function drawPrism(
    g: Phaser.GameObjects.Graphics,
    x: number, y: number,
    hexRadius: number,
    height: number,
    strokeColor: number,
    strokeAlpha: number,
    strokeWidth: number,
) {
    const top = isoHexTopPoints(x, y, hexRadius);

    // ── 1. 棱柱侧面：3段 alpha 衰减填充（顶→底，模拟光从顶部照射的衰减） ──
    // 三个可见侧面（按z序：右下 → 下方 → 左下）
    const visibleSides: [number, number][] = [[3, 4], [4, 5], [5, 0]];
    visibleSides.forEach(([a, b]) => {
        const ax = top[a * 2], ay = top[a * 2 + 1];
        const bx = top[b * 2], by = top[b * 2 + 1];
        // 上半段（最亮）+ 中半段（次亮）+ 下半段（最暗），用 3 个三角形叠出渐变感
        const midA = { x: (ax + bx) / 2, y: (ay + by) / 2 };
        const baseA = { x: ax, y: ay + height };
        const baseB = { x: bx, y: by + height };
        const topMid = { x: (ax + bx) / 2, y: ay + height / 2 };
        const baseMid = { x: (ax + bx) / 2, y: ay + height };
        // 顶段：顶面→中点
        g.fillStyle(strokeColor, PRISM_FILL_ALPHA[0]);
        g.fillTriangle(ax, ay, bx, by, topMid.x, topMid.y);
        // 中段：中点→底中
        g.fillStyle(strokeColor, PRISM_FILL_ALPHA[1]);
        g.fillTriangle(ax, ay, bx, by, baseA.x === baseB.x ? baseA.x : baseMid.x, baseMid.y);
        g.fillTriangle(topMid.x, topMid.y, bx, by, baseB.x === baseA.x ? baseB.x : baseMid.x, baseMid.y);
        // 底段：底中→底面
        g.fillStyle(strokeColor, PRISM_FILL_ALPHA[2]);
        g.fillTriangle(baseA.x, baseA.y, baseB.x, baseB.y, midA.x, midA.y);
        // 垂直棱线（细线 0.8px，顶亮底暗）
        g.lineStyle(strokeWidth * 0.8, strokeColor, PRISM_EDGE_ALPHA);
        g.lineBetween(ax, ay, baseA.x, baseA.y);
        g.lineBetween(bx, by, baseB.x, baseB.y);
        // 底面边（连接两垂线底端）
        g.lineStyle(strokeWidth * 0.5, strokeColor, PRISM_EDGE_ALPHA * 0.6);
        g.lineBetween(baseA.x, baseA.y, baseB.x, baseB.y);
    });

    // ── 2. 顶面：底色填充（极淡）+ 描边 + 高亮双线 ──
    g.fillStyle(strokeColor, PRISM_FILL_ALPHA[0] * 0.4);
    g.beginPath();
    g.moveTo(top[0], top[1]);
    for (let i = 2; i < top.length; i += 2) g.lineTo(top[i], top[i + 1]);
    g.closePath();
    g.fillPath();

    // 主描边（1.0px 标准）
    g.lineStyle(strokeWidth, strokeColor, strokeAlpha);
    g.beginPath();
    g.moveTo(top[0], top[1]);
    for (let i = 2; i < top.length; i += 2) g.lineTo(top[i], top[i + 1]);
    g.closePath();
    g.strokePath();

    // 高亮细线（0.5px，最亮）：模拟"全息投影的扫描高光带"
    if (strokeWidth >= 1) {
        g.lineStyle(0.5, strokeColor, PRISM_TOP_HIGHLIGHT_ALPHA * strokeAlpha);
        g.beginPath();
        g.moveTo(top[0], top[1]);
        for (let i = 2; i < top.length; i += 2) g.lineTo(top[i], top[i + 1]);
        g.closePath();
        g.strokePath();
    }

    // ── 3. 顶部刻度标识（小三角定位记号，4个角）──
    g.lineStyle(0.5, strokeColor, strokeAlpha * 0.7);
    const tickLen = 4;
    for (let i = 0; i < 6; i += 2) {
        const vx = top[i * 2], vy = top[i * 2 + 1];
        // 从顶点沿外法向延伸 4px 短刻度
        const midNext = { x: top[((i + 1) % 6) * 2], y: top[((i + 1) % 6) * 2 + 1] };
        const mx = (vx + midNext.x) / 2, my = (vy + midNext.y) / 2;
        const dx = mx - x, dy = (my - y) * ISO_Y_SCALE;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        g.lineBetween(mx, my, mx + (dx / len) * tickLen, my + (dy / len) * tickLen);
    }
}

/** 全息线框地图 v2：平面hex → 等轴测全息棱柱 */
export function renderCRTWireframeMap(
    g: Phaser.GameObjects.Graphics,
    mapDataMatrix: any[],
    ctx: CrtContext,
) {
    g.clear();

    const groups = new Map<string, { color: number; alpha: number; width: number; paths: number[][] }>();
    const prismTiles: { x: number; y: number; height: number; color: number; alpha: number; width: number }[] = [];

    mapDataMatrix.forEach(data => {
        const x = ctx.hexRadius * (Math.sqrt(3) * data.q + Math.sqrt(3) / 2 * data.r);
        const y = ctx.hexRadius * (3 / 2 * data.r) * CRT_Y_SCALE;

        const ownerFac = ctx.factionMap.get(data.ownerId);
        let strokeColor = CRT_GRID_COLOR;
        let strokeAlpha = 0.25;
        let strokeWidth = 0.5;

        if (ownerFac) {
            const pFac = ctx.store.factions.find((f: any) => f.type === 'player');
            const isFriend = pFac && (ownerFac.id === pFac.id || ownerFac.team === pFac.team);
            if (isFriend) { strokeColor = ownerFac.color; strokeAlpha = 0.55; strokeWidth = 1.5; }
        } else if (data.type === 'planet') { strokeColor = 0x00aa44; strokeAlpha = 0.45; strokeWidth = 1; }
        else if (data.type === 'fortress') { strokeColor = 0xcc3311; strokeAlpha = 0.5; strokeWidth = 1.2; }
        else if (data.type === 'sea') { strokeColor = 0x1a4488; strokeAlpha = 0.35; strokeWidth = 1.0; }
        else if (data.type === 'ruined') { strokeColor = 0x554433; strokeAlpha = 0.30; strokeWidth = 0.8; }
        else if (data.type === 'pier') { strokeColor = 0x0088cc; strokeAlpha = 0.35; strokeWidth = 0.8; }

        // v2：棱柱高度按格类型（sea/ruined 扁平，战略要地拔高）
        const height = data.type === 'sea' || data.type === 'ruined'
            ? 2
            : (PRISM_HEIGHT[data.type] ?? PRISM_HEIGHT.default);

        // 普通格（pending/sea/ruined）走批量线框；战略格走棱柱
        if (data.type === 'sea' || data.type === 'ruined' || data.type === 'pending') {
            const top = isoHexTopPoints(x, y - height, ctx.hexRadius);
            const key = `${strokeColor}_${strokeAlpha}_${strokeWidth}`;
            let group = groups.get(key);
            if (!group) { group = { color: strokeColor, alpha: strokeAlpha, width: strokeWidth, paths: [] }; groups.set(key, group); }
            group.paths.push(top);
            // 低矮格：轻微棱柱（高度2px的侧面几乎不可见，只画顶面）
        } else {
            prismTiles.push({ x, y, height, color: strokeColor, alpha: strokeAlpha, width: strokeWidth });
        }
    });

    // 批量绘制低矮格顶面线框
    groups.forEach(group => {
        g.lineStyle(group.width, group.color, group.alpha);
        g.beginPath();
        for (const pts of group.paths) {
            g.moveTo(pts[0], pts[1]);
            for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
            g.lineTo(pts[0], pts[1]);
        }
        g.strokePath();
    });

    // 绘制战略格全息棱柱（先画低的，后画高的，实现z排序）
    prismTiles.sort((a, b) => a.y - b.y);
    prismTiles.forEach(t => {
        drawPrism(g, t.x, t.y, ctx.hexRadius, t.height, t.color, t.alpha, t.width);
    });

    // 地形符号（叠加在棱柱顶面之上，保持原有可读性）
    mapDataMatrix.forEach(data => {
        const x = ctx.hexRadius * (Math.sqrt(3) * data.q + Math.sqrt(3) / 2 * data.r);
        const y = ctx.hexRadius * (3 / 2 * data.r) * CRT_Y_SCALE;
        const height = data.type === 'sea' || data.type === 'ruined'
            ? 2 : (PRISM_HEIGHT[data.type] ?? PRISM_HEIGHT.default);
        const topY = y - height;
        const pFac = ctx.store.factions.find((f: any) => f.type === 'player');
        const tOwnerFac = ctx.factionMap.get(data.ownerId);
        if (tOwnerFac && pFac && tOwnerFac.id !== pFac.id && tOwnerFac.team !== pFac.team) return;

        if (data.type === 'planet') {
            // 星球：核心圆 + 辐射光晕 + 同步轨道环（3 圈）
            g.fillStyle(0x00cc66, 0.4); g.fillCircle(x, topY, 4);
            g.fillStyle(0x00ff88, 0.18); g.fillCircle(x, topY, 9);
            g.lineStyle(0.6, 0x00ff88, 0.55); g.strokeCircle(x, topY, 8);
            // 3 圈轨道（银英战术台标识）
            g.lineStyle(0.4, 0x00ff88, 0.25);
            g.strokeEllipse(x, topY, 18, 18 * ISO_Y_SCALE);
            g.strokeEllipse(x, topY, 24, 24 * ISO_Y_SCALE);
            g.strokeEllipse(x, topY, 30, 30 * ISO_Y_SCALE);
        } else if (data.type === 'castle') {
            const ownerFac = ctx.factionMap.get(data.ownerId);
            if (ownerFac) {
                // 基地：菱形 + 十字锚 + 双层光晕（旗舰）
                const c = ownerFac.color;
                g.lineStyle(1.5, c, 0.85); g.strokeCircle(x, topY, 9);
                g.lineStyle(0.4, c, 0.3); g.strokeCircle(x, topY, 14);
                g.lineStyle(1.2, c, 0.7);
                g.lineBetween(x - 14, topY, x + 14, topY);
                g.lineBetween(x, topY - 14, x, topY + 14);
                // 菱形锚标
                g.lineStyle(0.8, c, 0.6);
                g.beginPath();
                g.moveTo(x, topY - 7); g.lineTo(x + 5, topY);
                g.lineTo(x, topY + 7); g.lineTo(x - 5, topY); g.closePath();
                g.strokePath();
            }
        } else if (data.type === 'fortress') {
            // 要塞：双同心圆 + 红色放射光晕
            g.fillStyle(0xff3311, 0.2); g.fillCircle(x, topY, 14);
            g.lineStyle(1.2, 0xff3311, 0.7); g.strokeCircle(x, topY, 12);
            g.lineStyle(0.6, 0xff3311, 0.5); g.strokeCircle(x, topY, 6);
            // 6 个外部锚点
            g.lineStyle(0.6, 0xff3311, 0.45);
            for (let k = 0; k < 6; k++) {
                const a = k * Math.PI / 3;
                g.lineBetween(x + Math.cos(a) * 12, topY + Math.sin(a) * 12, x + Math.cos(a) * 16, topY + Math.sin(a) * 16);
            }
        } else if (data.type === 'sea') {
            // 海域：交叉斜线 + 涟漪波纹
            g.lineStyle(0.6, 0x3366aa, 0.4);
            g.lineBetween(x - 6, topY - 6, x + 6, topY + 6);
            g.lineBetween(x + 6, topY - 6, x - 6, topY + 6);
            g.lineStyle(0.4, 0x2255aa, 0.3);
            g.strokeEllipse(x, topY, 14, 14 * ISO_Y_SCALE);
            g.strokeEllipse(x, topY, 10, 10 * ISO_Y_SCALE);
        } else if (data.type === 'ruined') {
            // 废墟：6 道放射短线（被破坏感）
            g.lineStyle(0.6, 0x887766, 0.35);
            for (let k = 0; k < 6; k++) {
                const a = k * Math.PI / 3;
                g.lineBetween(x + Math.cos(a) * 4, topY + Math.sin(a) * 4, x + Math.cos(a) * 11, topY + Math.sin(a) * 11);
            }
            // X 叉
            g.lineStyle(0.8, 0x665544, 0.5);
            g.lineBetween(x - 4, topY - 4, x + 4, topY + 4);
            g.lineBetween(x + 4, topY - 4, x - 4, topY + 4);
        } else if (data.type === 'pier') {
            // 港口：正方形 + 锚标
            g.fillStyle(0x0088cc, 0.35); g.fillRect(x - 3, topY - 3, 6, 6);
            g.lineStyle(0.5, 0x06b6d4, 0.5); g.strokeRect(x - 4, topY - 4, 8, 8);
        } else if (data.type === 'mine') {
            // 矿场：双三角（菱形）+ 金色光晕
            g.fillStyle(0xd4a017, 0.4);
            g.fillTriangle(x, topY - 5, x + 5, topY, x, topY + 5);
            g.fillTriangle(x, topY - 5, x - 5, topY, x, topY + 5);
            g.lineStyle(0.5, 0xfbbf24, 0.6); g.strokeCircle(x, topY, 5);
            g.lineStyle(0.3, 0xfbbf24, 0.3); g.strokeCircle(x, topY, 8);
        } else if (data.type === 'tower') {
            // 塔：六芒星锚点 + 紫罗兰光晕
            g.fillStyle(0x9a7acc, 0.18); g.fillCircle(x, topY, 9);
            g.lineStyle(0.6, 0x9a7acc, 0.5);
            for (let k = 0; k < 6; k++) {
                const a = k * Math.PI / 3;
                g.lineBetween(x + Math.cos(a) * 3, topY + Math.sin(a) * 3, x + Math.cos(a) * 7, topY + Math.sin(a) * 7);
            }
            // 中心点
            g.fillStyle(0xc4a8ff, 0.6); g.fillCircle(x, topY, 2);
            g.lineStyle(0.4, 0x9a7acc, 0.4); g.strokeCircle(x, topY, 7);
        }
    });
}

/** 逐帧动态效果：雷达扫描波 + 扫描线 + 舰队线框（v2 增加全息投影基准面微光） */
export function updateCRTEffects(
    scene: Phaser.Scene,
    time: number,
    crtGlowTime: { val: number },
    crtFleetRedrawTimer: { val: number },
    crtOverlay: Phaser.GameObjects.Graphics,
    store: any,
    tilesList: any[],
    factionMap: Map<number, any>,
    globalFleets: any[],
    mapStyle: string,
    redrawFn: () => void,
) {
    crtGlowTime.val += 16;
    const cam = scene.cameras.main;
    const g = crtOverlay;
    g.clear();

    // 引力波纹（在棱柱顶面高度上扩散）
    if (Math.floor(time / 80) !== Math.floor((time - 16) / 80)) {
        const pFac = store.factions.find((f: any) => f.type === 'player');
        tilesList.forEach((t: any) => {
            if (t.type !== 'planet' && t.type !== 'fortress' && t.type !== 'castle') return;
            const tOwner = factionMap.get(t.ownerId);
            if (tOwner && pFac && tOwner.id !== pFac.id && tOwner.team !== pFac.team) return;
            const waveColor = t.type === 'planet' ? 0x00cc66 : (t.type === 'fortress' ? 0xcc3311 : CRT_ACCENT);
            for (let ring = 0; ring < 3; ring++) {
                const phase = (time * 0.003 + ring * 2.1 + t.q * 0.5) % (Math.PI * 2);
                const radius = 10 + Math.sin(phase) * 20 + ring * 8;
                const alpha = 0.15 - ring * 0.04;
                if (alpha > 0) { g.lineStyle(0.5, waveColor, alpha); g.strokeEllipse(t.x, t.y - 12, radius * 2, radius * 2 * ISO_Y_SCALE); }
            }
        });
    }

    // 舰队线框（每200ms节流）
    crtFleetRedrawTimer.val -= 16;
    if (crtFleetRedrawTimer.val <= 0) {
        crtFleetRedrawTimer.val = 200;
        redrawFn();
    }
}

/** 舰队线框重绘 v2：平面标记 → 浮空舰船（旗舰悬空+地面投影+尾焰光柱） */
export function redrawCRTFleets(
    fg: Phaser.GameObjects.Graphics,
    crtGlowTime: { val: number },
    store: any,
    globalFleets: any[],
) {
    fg.clear();
    const scanPhase = Math.floor(crtGlowTime.val / 60) % 3;

    store.factions.forEach((fac: any) => {
        if (!fac.active) return;
        const fColor = fac.color;
        globalFleets.filter((fl: any) => fl.factionId === fac.id).forEach((fl: any) => {
            if (!fl.units || fl.units.length === 0) return;
            if (!fl._fogVisible) return;
            const flagship = fl.units[0];
            if (!flagship.sprite) return;

            fl.units.forEach((u: any, idx: number) => {
                const ux = u.sprite.x;
                const uy = u.sprite.y * CRT_Y_SCALE;
                const isFlagship = idx === 0;
                const yPhase = Math.abs(Math.round(uy / 8)) % 3;
                const scanAlpha = yPhase === scanPhase ? 1.0 : 0.35;

                // v2：浮空高度 —— 旗舰悬空最高，常规舰贴地
                const hoverH = isFlagship ? 26 : 10;
                const hoverY = uy - hoverH;

                // 地面椭圆投影（在真实坐标 y 上，始终可见）
                const shadowW = isFlagship ? 9 : 6;
                fg.fillStyle(0x00cc66, 0.15 * scanAlpha);
                fg.fillEllipse(ux, uy, shadowW * 2, shadowW * 0.9);

                // 尾焰光柱（舰底到投影的垂直光柱）
                fg.lineStyle(0.8, fColor, 0.25 * scanAlpha);
                fg.lineBetween(ux, hoverY + 3, ux, uy);

                // 移动轨迹（v2 保留：浮空层上的残影）
                if (u._prevX !== undefined) {
                    const ga = 0.12 * scanAlpha;
                    if (isFlagship) {
                        const r = 9;
                        fg.lineStyle(0.8, fColor, ga);
                        fg.strokeTriangle(
                            u._prevX + Math.cos(fl._facingAngle || 0) * r, u._prevY - hoverH + Math.sin(fl._facingAngle || 0) * r,
                            u._prevX + Math.cos((fl._facingAngle || 0) + 2.4) * r, u._prevY - hoverH + Math.sin((fl._facingAngle || 0) + 2.4) * r,
                            u._prevX + Math.cos((fl._facingAngle || 0) - 2.4) * r, u._prevY - hoverH + Math.sin((fl._facingAngle || 0) - 2.4) * r);
                    } else {
                        fg.lineStyle(0.5, fColor, ga);
                        fg.strokeRect(u._prevX - 3, u._prevY - hoverH - 3, 6, 6);
                    }
                }
                u._prevX = ux; u._prevY = uy;

                // 舰船主体（浮空层）
                if (isFlagship) {
                    // 旗舰：圆形主体 + 三角船首（朝向）+ 旋转扫描环（动态）+ 呼吸脉冲
                    const fAngle = fl.facingAngle || 0;
                    const r = 8;
                    // 主体：圆 + 三角前
                    fg.fillStyle(fColor, 0.75 * scanAlpha);
                    fg.fillCircle(ux, hoverY, r);
                    fg.lineStyle(1, fColor, 0.95 * scanAlpha);
                    fg.strokeCircle(ux, hoverY, r);
                    // 三角船首（朝向）
                    fg.fillStyle(fColor, 0.85 * scanAlpha);
                    fg.fillTriangle(
                        ux + Math.cos(fAngle) * (r + 4), hoverY + Math.sin(fAngle) * (r + 4),
                        ux + Math.cos(fAngle + 2.4) * r, hoverY + Math.sin(fAngle + 2.4) * r,
                        ux + Math.cos(fAngle - 2.4) * r, hoverY + Math.sin(fAngle - 2.4) * r);
                    // 旋转扫描环（动态 — 用 crtGlowTime 旋转）
                    const ringRot = crtGlowTime.val * 0.006 + idx * 0.8;
                    fg.lineStyle(0.6, CRT_SCAN_COLOR, 0.4 * scanAlpha);
                    fg.beginPath();
                    for (let a = 0; a < Math.PI; a += 0.15) {
                        const seg = ringRot + a;
                        const x1 = ux + Math.cos(seg) * (r + 5);
                        const y1 = hoverY + Math.sin(seg) * (r + 5) * ISO_Y_SCALE;
                        const x2 = ux + Math.cos(seg + 0.3) * (r + 5);
                        const y2 = hoverY + Math.sin(seg + 0.3) * (r + 5) * ISO_Y_SCALE;
                        a === 0 ? fg.moveTo(x1, y1) : fg.lineTo(x1, y1);
                        fg.lineTo(x2, y2);
                    }
                    fg.strokePath();
                    // 呼吸脉冲（浮空感）
                    const pulse = 5 + Math.sin(crtGlowTime.val * 0.012 + idx * 0.5) * 2;
                    fg.lineStyle(0.5, CRT_SCAN_COLOR, 0.25 * scanAlpha);
                    fg.strokeCircle(ux, hoverY, r + pulse);
                } else {
                    // 常规舰：菱形 + 内点（小而精）
                    const sr = 4;
                    fg.fillStyle(fColor, 0.5 * scanAlpha);
                    fg.fillCircle(ux, hoverY, sr);
                    fg.lineStyle(0.6, fColor, 0.7 * scanAlpha);
                    fg.strokeCircle(ux, hoverY, sr);
                    // 朝向指示
                    const fAngle2 = fl.facingAngle || 0;
                    fg.lineStyle(0.5, fColor, 0.6 * scanAlpha);
                    fg.lineBetween(ux, hoverY, ux + Math.cos(fAngle2) * (sr + 3), hoverY + Math.sin(fAngle2) * (sr + 3));
                }
            });
        });
    });
}

/** 视口对齐的 HUD 叠加层 v2：4角定位记号 + HUD 文字 + 顶部细刻度 */
export function drawCRTOverlays(
    scene: Phaser.Scene,
    crtOverlay: Phaser.GameObjects.Graphics,
    crtHudLabel: { ref: Phaser.GameObjects.Text | null },
    mapStyle: string,
) {
    const cam = scene.cameras.main;
    const g = crtOverlay;
    const zoom = cam.zoom;
    const vw = (cam.width || 1200) / zoom;
    const vh = (cam.height || 800) / zoom;
    const cx = cam.scrollX + vw / 2;
    const cy = cam.scrollY + vh / 2;
    const left = cx - vw / 2;
    const right = cx + vw / 2;
    const top = cy - vh / 2;
    const bottom = cy + vh / 2;
    const m = 12;
    const cl = 22;

    // ── 4 角定位记号（双层 L 形：主定位 + 内层精定位）──
    g.lineStyle(2, CRT_ACCENT, 0.55);
    g.lineBetween(left + m, top + m + cl, left + m, top + m);
    g.lineBetween(left + m, top + m, left + m + cl, top + m);
    g.lineBetween(right - m, top + m + cl, right - m, top + m);
    g.lineBetween(right - m, top + m, right - m - cl, top + m);
    g.lineBetween(left + m, bottom - m - cl, left + m, bottom - m);
    g.lineBetween(left + m, bottom - m, left + m + cl, bottom - m);
    g.lineBetween(right - m, bottom - m - cl, right - m, bottom - m);
    g.lineBetween(right - m, bottom - m, right - m - cl, bottom - m);

    // 内层精定位（更细更暗的 L）
    g.lineStyle(0.5, CRT_ACCENT, 0.25);
    const m2 = m + cl + 4;
    g.lineBetween(left + m2, top + m, left + m2, top + m + 12);
    g.lineBetween(left + m, top + m2, left + m + 12, top + m2);
    g.lineBetween(right - m2, top + m, right - m2, top + m + 12);
    g.lineBetween(right - m, top + m2, right - m - 12, top + m2);
    g.lineBetween(left + m2, bottom - m, left + m2, bottom - m - 12);
    g.lineBetween(left + m, bottom - m2, left + m + 12, bottom - m2);
    g.lineBetween(right - m2, bottom - m, right - m2, bottom - m - 12);
    g.lineBetween(right - m, bottom - m2, right - m - 12, bottom - m2);

    // ── 顶部水平刻度（细刻度 + 短竖线，每 30px 一格）──
    const tickY = top + m + 16;
    g.lineStyle(0.5, CRT_ACCENT, 0.35);
    for (let x = left + 60; x < right - 60; x += 60) {
        g.lineBetween(x, tickY - 4, x, tickY + 4);
    }
    g.lineStyle(0.3, CRT_ACCENT, 0.2);
    g.lineBetween(left + 60, tickY, right - 60, tickY);

    // ── HUD 标签（左侧）──
    if (!crtHudLabel.ref) {
        crtHudLabel.ref = scene.add.text(0, 0, '', {
            fontSize: '9px', fontFamily: 'monospace', color: CRT_TEXT_COLOR,
        }).setDepth(101).setAlpha(0.7);
    }
    crtHudLabel.ref.setText(`▣ TAC-PROJECTION // ISO-HOLO // ⏚`);
    crtHudLabel.ref.setPosition(left + m + 8, top + m + 6);
}
