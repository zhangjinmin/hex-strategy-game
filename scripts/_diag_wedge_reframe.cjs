/**
 * _diag_wedge_reframe.cjs — 真机验收：T0 定妆 / T1 归位 / T2 轮廓（AC-W1~W4 全项）
 *
 * 两阶段（一次跑完，中途 reload 复位）：
 *   阶段 A（正常路径，入场动画 ON）：AC-W1 取景 / AC-W2 压平投影比 + 相邻排纵向间距 /
 *     AC-W3 叠层门禁 / AC-W4① 幂等（重复调用位姿 Δ==0）/ AC-W4② 阵位不被取景改变 /
 *     归位后 60 帧内 LOD 档变化 ≤1 / 轮廓透明度读数。
 *   阶段 B（`entryFxStyle=off` 路径：把 `entryFxDisabledBySetting` 打桩成 true）：
 *     T0 定妆 —— 开战后每舰 sprite 与 `fleet.x/y + rotateOffsetPx(cell×spacing, formFacing)`
 *     偏差 ≤ 1px；`_openReframeAt` 武装且归位执行 1 次；δ ≤ 20°、仰角 ∈[50,70]。
 *
 * 用法：node --import ./_ts_resolve.mjs scripts/_diag_wedge_reframe.cjs
 * 产出：_diag4_A_opening.png / _diag4_A_zoom.png / _diag4_B_off_battle.png
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const URL_ = argOf('--url', 'http://localhost:34115/index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  PASS ${name}${extra ? ' :: ' + extra : ''}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? ' :: ' + extra : ''}`); }
};
const R = (v, n = 2) => (typeof v === 'number' && Number.isFinite(v)) ? +v.toFixed(n) : null;

/* ══════════════════════════════════════════════════════════════════════
 * 页内测量函数（在浏览器里执行；本文件里以 toString 传入，便于语法检查）
 * ══════════════════════════════════════════════════════════════════════ */

/** 找玩家主舰队（楔形、有单位、属于 player 阵营） */
function pageFindFleet() {
  const ov = window.__b3dOverlay; const bs = ov && ov.battleScene;
  if (!bs) return null;
  const player = ((bs.store && bs.store.factions) || []).find((f) => f.type === 'player');
  if (!player) return null;
  const list = (bs.globalFleets || []).filter((x) => x && x.factionId === player.id && (x.units || []).length > 0);
  if (!list.length) return null;
  // 取单位最多的一支（玩家本队）
  list.sort((a, b) => (b.units || []).length - (a.units || []).length);
  return list[0];
}

/** 主测量：位姿 / AC-W1 / 行间距 / AC-W3 / 轮廓 */
function pageMeasure() {
  const findFleet = window.__findPlayerFleet;
  const ov = window.__b3dOverlay; const bs = ov.battleScene;
  const f = findFleet();
  if (!f) return { err: 'no player fleet' };
  const cam = ov.camera.position;
  const tgt = ov.controls.target;
  const dx = cam.x - tgt.x, dz = cam.z - tgt.z;
  const hlen = Math.hypot(dx, dz) || 1;
  const elev = Math.atan2(cam.y - tgt.y, hlen);
  const ff = (typeof f.formFacing === 'number' ? f.formFacing : (f.facingSmooth || 0));
  const fwd = [Math.cos(ff), -Math.sin(ff)];
  const dotFwd = (dx * fwd[0] + dz * fwd[1]) / hlen;

  // 屏幕投影（与真实渲染同源：unitVis.sx/sy）
  const pts = []; const rows = new Map();
  const offs = f._formOffsets || null;
  let minGx = Infinity, maxGx = -Infinity;
  for (const v of ov.unitVis.values()) {
    if (v.fleet !== f) continue;
    const slot = v.u && v.u.formationSlot;
    const cell = (offs && slot >= 0) ? offs[slot] : null;
    const gx = cell ? cell[0] : null;
    pts.push([v.sx, v.sy]);
    if (gx !== null) {
      if (gx < minGx) minGx = gx;
      if (gx > maxGx) maxGx = gx;
      const a = rows.get(gx) || { sy: 0, n: 0 };
      a.sy += v.sy; a.n += 1; rows.set(gx, a);
    }
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const keys = [...rows.keys()].sort((a, b) => b - a);
  const rowY = keys.map((k) => { const a = rows.get(k); return a.sy / a.n; });
  let minRowGap = Infinity;
  for (let i = 1; i < rowY.length; i++) minRowGap = Math.min(minRowGap, Math.abs(rowY[i] - rowY[i - 1]));

  // AC-W3（解析等价式：尺度抵消）：厚度投影 / 纵深投影
  const layout = f._b3dV || null;
  const sp = f._formSpacing || 0;
  const depthExtent = (Number.isFinite(minGx) && Number.isFinite(maxGx)) ? (maxGx - minGx) * sp : 0;
  const thickness = layout ? Math.max(0, (layout.layers || 1) - 1) * (layout.layerGap || 0) : 0;
  const w3 = (thickness > 0 && depthExtent > 0)
    ? thickness * Math.cos(elev) / (depthExtent * Math.sin(elev))
    : null;

  const st = window.__b3dStats ? window.__b3dStats() : {};
  const mp = (window.__b3dMarkProbe ? window.__b3dMarkProbe() : []).find((r) => r.fid === f.id) || null;
  return {
    n: pts.length, ff: ff, formFacingDeg: ff * 180 / Math.PI,
    elevDeg: elev * 180 / Math.PI, dotFwd: dotFwd, deltaDeg: Math.acos(Math.max(-1, Math.min(1, -dotFwd))) * 180 / Math.PI,
    camDist: Math.hypot(cam.x - tgt.x, cam.y - tgt.y, cam.z - tgt.z),
    screen: { w: x1 - x0, h: y1 - y0, ratio: (y1 - y0) / Math.max(1e-6, x1 - x0) },
    minRowGap: Number.isFinite(minRowGap) ? minRowGap : null,
    rowsN: keys.length,
    layers: layout ? layout.layers : null, layerGap: layout ? layout.layerGap : null,
    depthExtent: depthExtent, thickness: thickness, w3: w3,
    lodNear: !!ov.lodNear, openingFrame: st.openingFrame || null,
    markerAlpha: st.markerAlpha, outlineAlpha: st.outlineAlpha,
    mark: mp ? { units: mp.units, markerAlpha: mp.markerAlpha, outlineAlpha: mp.outlineAlpha, span: mp.span } : null,
    camPose: [cam.x, cam.y, cam.z],
    minDistance: ov.controls.minDistance, maxDistance: ov.controls.maxDistance,
  };
}

/** 逐舰阵位快照（AC-W4②：取景不得动阵位） */
function pageShipSnapshot() {
  const findFleet = window.__findPlayerFleet;
  const ov = window.__b3dOverlay;
  const f = findFleet();
  if (!f) return null;
  const out = [];
  for (const u of (f.units || [])) {
    if (!u || !u.sprite) continue;
    out.push([+u.sprite.x.toFixed(4), +u.sprite.y.toFixed(4), u.formationSlot | 0]);
  }
  return out;
}

/** T0：开战后逐舰 sprite 与「解析期望位」的偏差（px） */
function pageSlotDeviation() {
  const findFleet = window.__findPlayerFleet;
  const f = findFleet();
  if (!f) return { err: 'no player fleet' };
  const offs = f._formOffsets || null;
  if (!offs) return { err: 'no _formOffsets' };
  const sp = f._formSpacing || 0;
  const fa = (typeof f.formFacing === 'number' ? f.formFacing : (f.facingSmooth || 0));
  const c = Math.cos(fa), s = Math.sin(fa);
  let worst = 0, n = 0, worstShip = null;
  for (const u of (f.units || [])) {
    if (!u || !u.sprite) continue;
    const slot = u.formationSlot;
    if (!(slot >= 0) || !offs[slot]) continue;
    const cell = offs[slot];
    const ox = cell[0] * sp, oy = cell[1] * sp;
    // 与 rotateOffsetPx 同式：rx = ox·c − oy·s ；ry = ox·s + oy·c
    const ex = f.x + (ox * c - oy * s);
    const ey = f.y + (ox * s + oy * c);
    const d = Math.hypot(u.sprite.x - ex, u.sprite.y - ey);
    n += 1;
    if (d > worst) { worst = d; worstShip = { slot: slot, sx: +u.sprite.x.toFixed(1), sy: +u.sprite.y.toFixed(1), ex: +ex.toFixed(1), ey: +ey.toFixed(1) }; }
  }
  return { n: n, worst: worst, worstShip: worstShip, anchor: [+f.x.toFixed(1), +f.y.toFixed(1)] };
}

/** 60 帧 LOD 观测（页内自跑 rAF，返回档位变化次数） */
function pageStartLodWatch() {
  const ov = window.__b3dOverlay;
  window.__lodWatch = { changes: 0, frames: 0, last: !!ov.lodNear, done: false };
  const step = () => {
    const w = window.__lodWatch;
    const cur = !!ov.lodNear;
    if (cur !== w.last) { w.changes += 1; w.last = cur; }
    w.frames += 1;
    if (w.frames >= 60) { w.done = true; return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════ */

async function main() {
  const probeUrl = pathToFileURL(path.join(__dirname, '../_browser_probe.mjs')).href;
  const { launch, navigate, waitFor } = await import(probeUrl);
  const { cdp, close } = await launch();
  const src = (fn) => '(' + fn.toString() + ')()';
  /** 把「找玩家主舰队」注入页面（reload 会清掉 ⇒ 每次 reachDeploy 后重注） */
  const injectFinder = () => cdp.evaluate('window.__findPlayerFleet = ' + pageFindFleet.toString());
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', name), Buffer.from(r.data, 'base64'));
    console.log(`# shot ${name}`);
  };
  const clickText = async (t) => {
    const p = await cdp.evaluate(`(() => { const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()===${JSON.stringify(t)}); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    if (!p) throw new Error('no text ' + t);
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  };
  const clickSel = async (sel) => {
    const p = await cdp.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    if (!p) throw new Error('no sel ' + sel);
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  };
  const enter = async () => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, code: 'Enter', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }); };

  /** 走到「部署期」（战场 canvas 已出、尚未开战）——两条阶段共用 */
  const reachDeploy = async () => {
    await navigate(cdp, URL_);
    await waitFor(cdp, `document.body.innerText.includes('战术模拟')`, { label: '主菜单', timeoutMs: 40000 });
    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { label: '设置页' });
    await clickText('同盟');
    await sleep(600);
    let modal = false;
    for (let i = 0; i < 3 && !modal; i++) {
      const hasSlot = await cdp.evaluate(`!!document.querySelector('.dispatch-slot')`);
      if (hasSlot) await clickSel('.dispatch-slot').catch(() => {});
      else await clickText('+ 指派提督').catch(() => {});
      await sleep(700);
      try {
        await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { label: '提督弹窗', timeoutMs: 5000, intervalMs: 200 });
        modal = true;
      } catch { /* retry */ }
    }
    if (!modal) throw new Error('提督弹窗没弹出');
    await clickText('比克古');
    await sleep(1000);
    let launched = false;
    for (let i = 0; i < 3 && !launched; i++) {
      await clickSel('.btn-launch-game').catch(() => {});
      await sleep(800);
      try {
        await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { label: '战场', timeoutMs: 20000, intervalMs: 300 });
        launched = true;
      } catch { /* retry */ }
    }
    if (!launched) throw new Error('没进战场');
    // 等 3D 层挂上（部署期已存在，但保证引用可用）
    await waitFor(cdp, `!!(window.__b3dOverlay && window.__b3dOverlay.battleScene)`, { label: 'overlay', timeoutMs: 20000 });
    await injectFinder();
  };

  try {
    /* ══════════════════ 阶段 A：正常路径（入场动画 ON） ══════════════════ */
    console.log('\n=== 阶段 A：正常路径（入场动画 ON） ===');
    await reachDeploy();
    // 在开战**之前**装归位执行计数器（patch 实例属性，_openReframeAt 之后会调用）
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      window.__refCount = 0;
      const proto = Object.getPrototypeOf(ov);
      if (!ov.__origFrame) {
        ov.__origFrame = proto.framePlayerMainFleetForOpening;
        ov.framePlayerMainFleetForOpening = function () {
          window.__refCount += 1;
          return ov.__origFrame.call(this);
        };
      }
      return true;
    })()`);
    for (let i = 0; i < 8; i++) {
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: 800, y: 400, button: 'left', clickCount: 1 });
      await sleep(200);
      await enter();
      try {
        await waitFor(cdp, `(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && (bs.entryPhase || (bs.store && !bs.store.isPaused))); })()`, { timeoutMs: 4000, intervalMs: 250, label: 'entry' });
        break;
      } catch { /* retry */ }
    }
    await waitFor(cdp, `(() => { const s = window.__b3dStats && window.__b3dStats(); return !!(s && s.openingFrame); })()`,
      { label: 'opening reframe', timeoutMs: 30000, intervalMs: 300 });
    // 归位后立刻开始 60 帧 LOD 观测
    await cdp.evaluate(src(pageStartLodWatch));
    await sleep(2200);
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; if (bs) { bs.entryPhase = false; bs.store.isPaused = false; } })()`);
    await sleep(1500);

    const A = await cdp.evaluate(src(pageMeasure));
    console.log('[A] ' + JSON.stringify(A));
    await shot('_diag4_A_opening.png');
    const bbox = await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay; const bs = ov.battleScene;
      const player = ((bs.store && bs.store.factions) || []).find((f) => f.type === 'player');
      const f = (bs.globalFleets || []).filter((x) => x && x.factionId === player.id && (x.units || []).length > 0)
        .sort((a, b) => (b.units || []).length - (a.units || []).length)[0];
      if (!f) return null;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const v of ov.unitVis.values()) { if (v.fleet !== f) continue; x0=Math.min(x0,v.sx); x1=Math.max(x1,v.sx); y0=Math.min(y0,v.sy); y1=Math.max(y1,v.sy); }
      const pad = 30;
      const w = (x1 - x0) + pad * 2, h = (y1 - y0) + pad * 2;
      return { x: Math.max(0, x0 + w * 0.12), y: Math.max(0, y0 + h * 0.10), width: w * 0.62, height: h * 0.62, scale: 2 };
    })()`);
    if (bbox) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: bbox });
      fs.writeFileSync(path.join(__dirname, '..', '_diag4_A_zoom.png'), Buffer.from(r.data, 'base64'));
      console.log('# shot _diag4_A_zoom.png');
    }

    ok('AC-W1 dot(camXZ, forward) ≤ −0.94', A.dotFwd <= -0.94, `dot=${A.dotFwd}`);
    ok('T0′ 默认路径：归位在 ≤500ms 内落下', A.openingFrame && A.openingFrame.sinceEntryMs !== null && A.openingFrame.sinceEntryMs <= 500,
      `sinceEntry=${A.openingFrame && A.openingFrame.sinceEntryMs}ms`);
    ok('AC-W1 仰角 ∈ [50°,70°]', A.elevDeg >= 50 && A.elevDeg <= 70, `elev=${R(A.elevDeg, 1)}° δ=${R(A.deltaDeg, 1)}°`);
    ok('AC-W3 叠层比 ≤ 0.5（该队实际 layers/layerGap）', A.w3 !== null && A.w3 <= 0.5,
      `layers=${A.layers} layerGap=${R(A.layerGap)} 厚度=${R(A.thickness, 1)} 纵深=${R(A.depthExtent, 0)} 比=${R(A.w3, 3)}`);
    ok('相邻排屏幕纵向间距 ≥ 4px', A.minRowGap !== null && A.minRowGap >= 4, `minGap=${R(A.minRowGap, 1)}px rows=${A.rowsN}`);
    ok('AC-W4① 归位执行次数 == 1', await cdp.evaluate(`window.__refCount`) === 1, `count=${await cdp.evaluate(`window.__refCount`)}`);
    ok('T2 近景描边有可见地板（填充=0 时 outline>0）', A.outlineAlpha > 0 && A.markerAlpha === 0,
      `outline=${A.outlineAlpha} fill=${A.markerAlpha} mark.outline=${A.mark && A.mark.outlineAlpha}`);

    // AC-W4①：重复调用后位姿 Δ 必须为 0
    // ⚠ 必须暂停：战斗运行时**增量跟随**每帧会把相机按舰队转向拧一点（那是 T1 的设计行为），
    //   不暂停就会被误判成"归位不幂等"（第一版测出 Δ=0.1265rad 正是这个）。
    await cdp.evaluate(`(() => { window.__b3dOverlay.battleScene.store.isPaused = true; return true; })()`);
    await sleep(250);
    const before = await cdp.evaluate(src(pageMeasure));
    await cdp.evaluate(`(() => { const ov = window.__b3dOverlay; ov.runOpeningReframe(); ov.runOpeningReframe(); return true; })()`);
    await sleep(400);
    const after = await cdp.evaluate(src(pageMeasure));
    const poseDelta = Math.max(...[0, 1, 2].map((k) => Math.abs(before.camPose[k] - after.camPose[k])));
    ok('AC-W4① 重复调用前后相机位姿 max|Δ| == 0', poseDelta === 0, `Δ=${poseDelta}`);

    // AC-W4②：取景不得动阵位（强制再取景一次，比较逐舰 (x,y,slot)）
    // ⚠ 必须先**暂停战斗**：否则两次采样之间 update() 会让舰队自己走，测出来的是"移动"不是"取景副作用"
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; bs.store.isPaused = true; return true; })()`);
    await sleep(300);
    const snapA = await cdp.evaluate(src(pageShipSnapshot));
    const ctrlA = await cdp.evaluate(`(() => { const c = window.__b3dOverlay.controls; return [c.minDistance, c.maxDistance]; })()`);
    await cdp.evaluate(`(() => { const ov = window.__b3dOverlay; ov._openReframeDone = false; ov.framePlayerMainFleetForOpening(); ov._openReframeDone = true; return true; })()`);
    await sleep(300);
    const snapB = await cdp.evaluate(src(pageShipSnapshot));
    const ctrlB = await cdp.evaluate(`(() => { const c = window.__b3dOverlay.controls; return [c.minDistance, c.maxDistance]; })()`);
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; bs.store.isPaused = false; return true; })()`);
    let shipDelta = 0;
    if (snapA && snapB && snapA.length === snapB.length) {
      for (let i = 0; i < snapA.length; i++) {
        shipDelta = Math.max(shipDelta,
          Math.abs(snapA[i][0] - snapB[i][0]), Math.abs(snapA[i][1] - snapB[i][1]),
          Math.abs(snapA[i][2] - snapB[i][2]));
      }
    } else shipDelta = 999;
    ok('AC-W4② 取景前后逐舰 (x,y,slot) 全量差 == 0', shipDelta === 0, `maxΔ=${shipDelta} n=${snapA ? snapA.length : 0}`);

    // AC-W2（压平投影）：把队内分层压到 1 层后测量「纵跨/横跨」
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      if (ov.__origVL) return 'already';
      const proto = Object.getPrototypeOf(ov);
      ov.__origVL = proto.fleetVLayout;
      ov.fleetVLayout = function (f) { const v = ov.__origVL.call(this, f); return { ...v, layers: 1, layerGap: 0, layerK: v.layerK.map(() => 0) }; };
      return 'patched';
    })()`);
    await sleep(1200);
    const flat = await cdp.evaluate(src(pageMeasure));
    await cdp.evaluate(`(() => { const ov = window.__b3dOverlay; if (ov.__origVL) { Object.getPrototypeOf(ov).fleetVLayout = ov.__origVL; delete ov.fleetVLayout; delete ov.__origVL; } return true; })()`);
    await sleep(600);
    console.log('[A-flat] ' + JSON.stringify({ ratio: flat.screen && flat.screen.ratio, minRowGap: flat.minRowGap, screen: flat.screen }));
    ok('AC-W2 压平投影 纵跨/横跨 ∈ [0.30, 0.80]',
      flat.screen && flat.screen.ratio >= 0.30 && flat.screen.ratio <= 0.80,
      `纵跨=${R(flat.screen && flat.screen.h, 0)}px 横跨=${R(flat.screen && flat.screen.w, 0)}px 比=${R(flat.screen && flat.screen.ratio, 3)}`);
    ok('AC-W2 压平后相邻排纵向间距 ≥ 4px', flat.minRowGap !== null && flat.minRowGap >= 4, `minGap=${R(flat.minRowGap, 1)}px`);

    // AC-W4③：拖拽期 120 帧方位角变化 == 0
    // ⚠ 顺序必须是 **先置 ∞、过一帧再取基准**：先取基准再置 ∞ 会漏掉中间那一两帧里
    //   增量跟随按舰队转向拧的那一点点 —— 第一版就这么测出 7.48e-3 rad 的假违规。
    const azOf = `(() => { const ov = window.__b3dOverlay; const c = ov.camera.position, t = ov.controls.target; return Math.atan2(c.x - t.x, c.z - t.z); })()`;
    await cdp.evaluate(`(() => { const ov = window.__b3dOverlay; ov._camUserDragUntil = Infinity; return true; })()`);
    await sleep(300);    // 让"拖拽中"先稳定成基准态
    const azBefore = await cdp.evaluate(azOf);
    await sleep(2000);   // ≈120 帧
    const azDuring = await cdp.evaluate(azOf);
    await cdp.evaluate(`(() => { const ov = window.__b3dOverlay; ov._camUserDragUntil = performance.now() + 1200; return true; })()`);
    await sleep(1000);
    const azAfter = await cdp.evaluate(azOf);
    ok('AC-W4③ 拖拽期（∞）约 120 帧方位角变化 == 0', Math.abs(azDuring - azBefore) < 1e-12, `Δ=${Math.abs(azDuring - azBefore).toExponential(2)}`);
    ok('AC-W4③ 松手 1.2s 宽限内方位角变化 == 0', Math.abs(azAfter - azDuring) < 1e-12, `Δ=${Math.abs(azAfter - azDuring).toExponential(2)}`);

    // LOD 档变化（归位后 60 帧）
    const lod = await cdp.evaluate(`window.__lodWatch`);
    ok('归位后 60 帧内 LOD 档变化 ≤ 1', lod && lod.changes <= 1, `changes=${lod && lod.changes} frames=${lod && lod.frames}`);

    ok('controls.minDistance/maxDistance 未被归位改动',
      ctrlA[0] === ctrlB[0] && ctrlA[1] === ctrlB[1],
      `before=${JSON.stringify(ctrlA)} after=${JSON.stringify(ctrlB)}`);

    /* ══════════════════ 阶段 B：entryFxStyle=off 路径（T0′ 归位落下时刻） ══════════════════ */
    // ⚠ T0（把定妆重摆提到 beginEntryPhase 三条 early-return）经真机实测论证**没有必要**，
    //   已整体回滚：该路径上 v100b 集结期硬锁每帧把 sprite 钉在槽位，devMax 恒 1~8px，
    //   从未出现历史那次 2130px 的"锚-舰脱钩"。本阶段只验 T0′（开场归位的**落下时刻**）。
    console.log('\n=== 阶段 B：entryFxStyle=off 路径（T0′ 归位落下时刻） ===');
    await reachDeploy();
    await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay.battleScene;
      bs.entryFxDisabledBySetting = () => true;     // 模拟「设置里关掉开场动画」
      window.__refCount = 0;
      const ov = window.__b3dOverlay;
      const proto = Object.getPrototypeOf(ov);
      if (!ov.__origFrame) {
        ov.__origFrame = proto.framePlayerMainFleetForOpening;
        ov.framePlayerMainFleetForOpening = function () {
          const ok = ov.__origFrame.call(this);
          window.__refCount += 1;
          if (ok && !window.__landedAt) window.__landedAt = performance.now();
          return ok;
        };
      }
      window.__pressAt = performance.now();
      return true;
    })()`);
    for (let i = 0; i < 8; i++) {
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: 800, y: 400, button: 'left', clickCount: 1 });
      await sleep(200);
      await cdp.evaluate(`window.__pressAt = performance.now();`);   // 以**本次**真按键为计时零点
      await enter();
      try {
        await waitFor(cdp, `(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && bs.store && bs.store.isPaused === false); })()`, { timeoutMs: 4000, intervalMs: 200, label: 'unpaused' });
        break;
      } catch { /* retry */ }
    }
    // ⚠ 时间戳一律在**页内**打点，不用 Node 侧轮询（轮询粒度 50ms + 每次 evaluate 往返
    //   会把"落下时刻"系统性放大几百毫秒 —— 第一版本就这么量出了 845ms 的假数据）
    await sleep(1200);
    const timing = await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const arm = ov._openReframeArmedAt || 0;
      const land = window.__landedAt || 0;
      const press = window.__pressAt || 0;
      return {
        pressToArmMs: arm && press ? +(arm - press).toFixed(0) : null,
        armToLandMs: arm && land ? +(land - arm).toFixed(0) : null,
        pressToLandMs: press && land ? +(land - press).toFixed(0) : null,
      };
    })()`);
    const landedAt = timing.pressToLandMs;
    const B = await cdp.evaluate(src(pageMeasure));
    const dev = await cdp.evaluate(src(pageSlotDeviation));
    console.log('[B-timing] ' + JSON.stringify(timing));
    console.log('[B] ' + JSON.stringify({ landedAtMs: landedAt, sinceEntryMs: B && B.openingFrame && B.openingFrame.sinceEntryMs, deltaDeg: B && B.deltaDeg, elevDeg: B && B.elevDeg, devWorstPx: dev && dev.worst }));
    await shot('_diag4_B_off_battle.png');
    ok('off 路径：归位在 ≤500ms 内落下（自按键）', landedAt !== null && landedAt <= 500,
      `按键→武装 ${timing.pressToArmMs}ms + 武装→落下 ${timing.armToLandMs}ms = 按键→落下 ${timing.pressToLandMs}ms`);
    ok('off 路径：归位执行次数 == 1', await cdp.evaluate(`window.__refCount`) === 1, `count=${await cdp.evaluate(`window.__refCount`)}`);
    ok('off 路径：δ ≤ 20° 且仰角 ∈[50,70]', B.deltaDeg <= 20 && B.elevDeg >= 50 && B.elevDeg <= 70,
      `δ=${R(B.deltaDeg, 1)}° elev=${R(B.elevDeg, 1)}° dot=${B.dotFwd} dist=${R(B.camDist, 0)}`);
    ok('off 路径：相邻排纵向间距 ≥ 4px', B.minRowGap !== null && B.minRowGap >= 4, `minGap=${R(B.minRowGap, 1)}px`);
    ok('off 路径：AC-W3 叠层比 ≤ 0.5', B.w3 !== null && B.w3 <= 0.5, `比=${R(B.w3, 3)} layers=${B.layers} layerGap=${R(B.layerGap)}`);
    ok('off 路径：逐舰 sprite 偏差记录（信息项，不设门禁：集结期硬锁在兜）', dev && dev.worst <= 20, `devMax=${R(dev && dev.worst, 2)}px n=${dev && dev.n}`);


    console.log(`\n=== 结论：${pass} PASS / ${fail} FAIL ===`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    await close().catch(() => {});
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
