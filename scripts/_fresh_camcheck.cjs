/** 一次性：读真机相机方位 vs 舰队阵型轴（只读） */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const probeUrl = pathToFileURL(path.join(__dirname, '../_browser_probe.mjs')).href;
  const { launch, navigate, waitFor } = await import(probeUrl);
  const { cdp, close } = await launch();
  try {
    await navigate(cdp, 'http://localhost:5210/index.html');
    await waitFor(cdp, `document.body.innerText.includes('战术模拟')`, { timeoutMs: 40000 });
    const clickText = async (text) => {
      const p = await cdp.evaluate(`(() => {
        const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(text)});
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!p) throw new Error('no ' + text);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      }
    };
    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { timeoutMs: 15000 });
    const clickSel = async (sel) => {
      const p = await cdp.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!p) throw new Error('no sel ' + sel);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      }
    };
    await clickSel('.dispatch-slot');
    await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { timeoutMs: 15000 });
    await clickText('莱因哈特');
    await new Promise((r) => setTimeout(r, 800));
    await clickSel('.btn-launch-game');
    await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { timeoutMs: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 5; i++) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: 800, y: 400, button: 'left', clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, 250));
      for (const type of ['keyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', { type, code: 'Enter', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      }
      const started = await cdp.evaluate(`(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && (bs.entryPhase || (bs.store && !bs.store.isPaused))); })()`);
      if (started) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 3000));
    const info = await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const bs = ov && ov.battleScene;
      const cam = ov && ov.camera;
      const tgt = ov && ov.controls && ov.controls.target;
      const fleets = (bs && bs.globalFleets) || [];
      const f = fleets.find(x => (x.units || []).length > 20) || fleets[0];
      const fa = f ? (typeof f.formFacing === 'number' ? f.formFacing : (typeof f.facingAngle === 'number' ? f.facingAngle : null)) : null;
      const wantAzim = fa == null ? null : Math.atan2(-Math.cos(fa), Math.sin(fa));
      let camAzim = null;
      if (cam && tgt) camAzim = Math.atan2(cam.position.x - tgt.x, cam.position.z - tgt.z);
      return {
        fleet: f ? { id: String(f.id).slice(0,8), n: (f.units||[]).length, fa, faDeg: fa == null ? null : +(fa*180/Math.PI).toFixed(1), wantAzim, wantAzimDeg: wantAzim == null ? null : +(wantAzim*180/Math.PI).toFixed(1) } : null,
        cam: cam ? { pos: [cam.position.x, cam.position.y, cam.position.z].map(v => Math.round(v)), target: tgt ? [tgt.x, tgt.y, tgt.z].map(v => Math.round(v)) : null, camAzim, camAzimDeg: camAzim == null ? null : +(camAzim*180/Math.PI).toFixed(1), dist: tgt ? Math.round(cam.position.distanceTo(tgt)) : null } : null,
      };
    })()`);
    console.log(JSON.stringify(info, null, 2));
  } finally {
    await close().catch(() => {});
  }
})();
