/** 验证 v104 镜头跟随：开战→舰队转向后截屏（转向后仍是三角） */
const path = require('node:path');
const fs = require('node:fs');
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
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    };
    const clickSel = async (sel) => {
      const p = await cdp.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!p) throw new Error('no sel ' + sel);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    };
    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { timeoutMs: 15000 });
    const HAS_SIDE = await cdp.evaluate(`[...document.querySelectorAll('*')].some(e => e.children.length === 0 && e.textContent.trim() === '同盟')`);
    if (HAS_SIDE) await clickText('同盟');
    await new Promise((r) => setTimeout(r, 300));
    await clickSel('.dispatch-slot');
    await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { timeoutMs: 15000 });
    await clickText('比克古');
    await new Promise((r) => setTimeout(r, 800));
    await clickSel('.btn-launch-game');
    await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { timeoutMs: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 5; i++) {
      await clickSel('canvas').catch(() => {});
      for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, code: 'Enter', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      const started = await cdp.evaluate(`(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && (bs.entryPhase || (bs.store && !bs.store.isPaused))); })()`);
      if (started) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    await new Promise((r) => setTimeout(r, 1500));
    // 先对齐取景（focusOnFleet = v103），再解除暂停让舰队跑起来
    const fid = await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay.battleScene;
      for (const f of (bs.globalFleets || [])) {
        const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || {};
        if (fac.type === 'player' && (f.units || []).length > 20) return f.id;
      } return null;
    })()`);
    await cdp.evaluate(`(() => { window.__b3dOverlay.focusOnFleet(${fid}); })()`);
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; if (bs) { bs.entryPhase = false; bs.store.isPaused = false; } })()`);
    const info = async () => await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const bs = ov && ov.battleScene;
      let fa = null, vx = null, vy = null;
      for (const f of (bs.globalFleets || [])) {
        const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || {};
        if (fac.type === 'player' && (f.units || []).length > 20) { fa = f.formFacing; vx = f.vx; vy = f.vy; break; }
      }
      const t = ov.controls.target;
      const camAzim = Math.atan2(ov.camera.position.x - t.x, ov.camera.position.z - t.z);
      return { faDeg: fa == null ? null : +(fa * 180 / Math.PI).toFixed(1), camDeg: +(camAzim * 180 / Math.PI).toFixed(1), vx, vy };
    })()`);
    const shot = async (name) => {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(__dirname, '..', name), Buffer.from(s.data, 'base64'));
      console.log(`# ${name}`, JSON.stringify(await info()));
    };
    await shot('_fresh_v104_t0.png');
    // 等舰队转向/移动（12s 内会朝任务目标转向）
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const d = await info();
      console.log(`  t+${(i + 1) * 3}s faDeg=${d.faDeg} camDeg=${d.camDeg}`);
    }
    await shot('_fresh_v104_t18.png');
  } finally {
    await close().catch(() => {});
  }
})();
