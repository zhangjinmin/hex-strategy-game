/**
 * _diag_wedge_view2.cjs — 楔形视觉归因（v2，只读）
 *
 * 四帧对照：
 *   A 开场默认取景
 *   B 队内高度分层归零（覆盖 fleetVLayout 方法，确保生效）
 *   C 相机移到阵型**侧向**（横向轴方向）—— 复现用户截图角度
 *   D 侧面 + 分层归零
 * 并打印每帧屏幕投影形状（用 unitVis 的 sx/sy）与相机方位/formFacing 夹角。
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const URL_ = argOf('--url', 'http://localhost:34115/index.html');

async function main() {
  const probeUrl = pathToFileURL(path.join(__dirname, '../_browser_probe.mjs')).href;
  const { launch, navigate, waitFor } = await import(probeUrl);
  const { cdp, close } = await launch();
  const fs = require('node:fs');
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', name), Buffer.from(r.data, 'base64'));
    console.log(`# shot ${name}`);
  };
  try {
    await navigate(cdp, URL_);
    await waitFor(cdp, `document.body.innerText.includes('战术模拟')`, { label: '主菜单', timeoutMs: 40000 });
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

    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { label: '设置页' });
    await clickText('同盟');
    await new Promise((r) => setTimeout(r, 300));
    await clickSel('.dispatch-slot');
    await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { label: '提督弹窗' });
    await clickText('比克古');
    await new Promise((r) => setTimeout(r, 700));
    await clickSel('.btn-launch-game');
    await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { label: '战场', timeoutMs: 60000 });
    for (let i = 0; i < 8; i++) {
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: 800, y: 400, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 200));
      await enter();
      try {
        await waitFor(cdp, `(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && (bs.entryPhase || (bs.store && !bs.store.isPaused))); })()`, { timeoutMs: 4000, intervalMs: 250, label: 'entry' });
        break;
      } catch { /* retry */ }
    }
    await new Promise((r) => setTimeout(r, 2500));
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; if (bs) { bs.entryPhase = false; bs.store.isPaused = false; } })()`);
    await new Promise((r) => setTimeout(r, 3500));

    // 屏幕投影形状分析（读 unitVis 的 sx/sy —— 与真实渲染同源）
    const shapeOf = `(() => {
      const ov = window.__b3dOverlay; const bs = ov.battleScene;
      const R = (v, n = 2) => (typeof v === 'number' && Number.isFinite(v)) ? +v.toFixed(n) : null;
      const f = (bs.globalFleets || []).find(x => String(x.formation) === 'wedge' && (x.units || []).length > 20
        && ((bs.factionMap.get(x.factionId) || {}).type === 'player'));
      if (!f) return { err: 'no wedge player fleet' };
      const pts = [];
      for (const v of ov.unitVis.values()) { if (v.fleet !== f) continue; pts.push([v.sx, v.sy]); }
      if (pts.length < 4) return { err: 'no vis', n: pts.length };
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      // 三角形度：按屏幕纵向分箱，看每箱的横向宽度是否"越靠尾部越宽"
      const bins = new Map();
      const H = Math.max(1, y1 - y0);
      for (const [x, y] of pts) { const k = Math.floor((y - y0) / H * 6); const a = bins.get(k) || [1e9, -1e9, 0]; a[0] = Math.min(a[0], x); a[1] = Math.max(a[1], x); a[2]++; bins.set(k, a); }
      const widths = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, a]) => k + ':' + (a[1] - a[0]).toFixed(0) + 'px/' + a[2]);
      // 相机方位（相对舰队）
      const cam = ov.camera.position; const tgt = ov.controls.target;
      const az = Math.atan2(cam.x - tgt.x, cam.z - tgt.z);           // 世界 XZ 方位
      const el2 = Math.atan2(cam.y - tgt.y, Math.hypot(cam.x - tgt.x, cam.z - tgt.z));
      const ff = (typeof f.formFacing === 'number' ? f.formFacing : (f.facingSmooth ?? 0));
      // 阵型轴（世界 XZ）：forward = (cos ff, -sin ff)；横向 = (sin ff, cos ff)
      const fwd = [Math.cos(ff), -Math.sin(ff)];
      const lat = [Math.sin(ff), Math.cos(ff)];
      const dir = [(cam.x - tgt.x), (cam.z - tgt.z)];
      const dlen = Math.hypot(dir[0], dir[1]) || 1;
      const dotFwd = (dir[0] * fwd[0] + dir[1] * fwd[1]) / dlen;
      const dotLat = (dir[0] * lat[0] + dir[1] * lat[1]) / dlen;
      return {
        n: pts.length,
        screen: { x0: R(x0), x1: R(x1), y0: R(y0), y1: R(y1), w: R(x1 - x0), h: R(y1 - y0) },
        widths,
        camAzDeg: R(az * 180 / Math.PI, 1), camElDeg: R(el2 * 180 / Math.PI, 1),
        formFacingDeg: R(ff * 180 / Math.PI, 1),
        camOnForwardAxis: R(dotFwd, 3), camOnLateralAxis: R(dotLat, 3),
        state: String(f.state), speed: R(Math.hypot(f.vx || 0, f.vy || 0)),
        layers: f._b3dV ? f._b3dV.layers : null, layerGap: f._b3dV ? R(f._b3dV.layerGap) : null,
      };
    })()`;

    const dump = async (tag) => {
      const r = await cdp.evaluate(shapeOf);
      const o = typeof r === 'string' ? JSON.parse(r) : r;
      console.log(`\n[${tag}] ${JSON.stringify(o)}`);
    };

    await dump('A 默认取景');
    await shot('_diag2_A_default.png');

    // B：覆盖实例方法 → 队内分层归零（保证生效）
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      if (ov.__origVL) return 'already';
      const proto = Object.getPrototypeOf(ov);
      ov.__origVL = proto.fleetVLayout;
      ov.fleetVLayout = function (f) {
        const v = ov.__origVL.call(this, f);
        return { ...v, layers: 1, layerGap: 0, layerK: v.layerK.map(() => 0) };
      };
      return 'patched';
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
    await dump('B 分层归零');
    await shot('_diag2_B_flat.png');

    // C：恢复分层 + 相机移到阵型侧向（横向轴），低仰角
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay; const bs = ov.battleScene;
      if (ov.__origVL) { Object.getPrototypeOf(ov).fleetVLayout = ov.__origVL; delete ov.fleetVLayout; delete ov.__origVL; }
      const f = (bs.globalFleets || []).find(x => String(x.formation) === 'wedge' && (x.units || []).length > 20 && ((bs.factionMap.get(x.factionId) || {}).type === 'player'));
      if (!f) return 'no fleet';
      const ff = (typeof f.formFacing === 'number' ? f.formFacing : (f.facingSmooth ?? 0));
      const lat = [Math.sin(ff), Math.cos(ff)];   // 世界 XZ 横向
      const R = 700;
      ov._camUserDragUntil = performance.now() + 20000;
      const cx = f.x, cz = -f.y;
      ov.camera.position.set(cx + lat[0] * R, 260, cz + lat[1] * R);
      ov.controls.target.set(cx, 40, cz);
      ov.controls.update();
      return 'ok';
    })()`);
    await new Promise((r) => setTimeout(r, 1500));
    await dump('C 侧向视角（复现用户角度）');
    await shot('_diag2_C_side.png');

    // D：侧向 + 分层归零
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const proto = Object.getPrototypeOf(ov);
      ov.__origVL = proto.fleetVLayout;
      ov.fleetVLayout = function (f) {
        const v = ov.__origVL.call(this, f);
        return { ...v, layers: 1, layerGap: 0, layerK: v.layerK.map(() => 0) };
      };
      return 'patched';
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
    await dump('D 侧向 + 分层归零');
    await shot('_diag2_D_side_flat.png');
  } finally {
    await close().catch(() => {});
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
