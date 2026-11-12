/** 三方位角对照：先 focusOnFleet 定基准，再只旋转相机方位角 */
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
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; if (bs) { bs.entryPhase = false; bs.store.isPaused = false; } })()`);
    await new Promise((r) => setTimeout(r, 800));

    // 基准 = 真实 focusOnFleet（拿 player 舰队 id）
    const fid = await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay.battleScene;
      for (const f of (bs.globalFleets || [])) {
        const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || {};
        if (fac.type === 'player' && (f.units || []).length > 20) return f.id;
      }
      return null;
    })()`);
    console.log('# player fleetId=', fid);
    await cdp.evaluate(`(() => { window.__b3dOverlay.focusOnFleet(${fid}); })()`);
    await new Promise((r) => setTimeout(r, 500));

    const shot = async (name) => {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(__dirname, '..', name), Buffer.from(s.data, 'base64'));
      console.log('# ' + name);
    };
    const setAzim = async (azimDeg) => {
      await cdp.evaluate(`(() => {
        const ov = window.__b3dOverlay;
        const t = ov.controls.target.clone();
        const d = ov.camera.position.distanceTo(t);
        const elev = 0.55;
        const azim = ${azimDeg} * Math.PI / 180;
        ov.camera.position.set(
          t.x + Math.sin(elev) * Math.sin(azim) * d,
          t.y + Math.cos(elev) * d,
          t.z + Math.sin(elev) * Math.cos(azim) * d);
        ov.camera.lookAt(t);
        ov.controls.update();
      })()`);
      await new Promise((r) => setTimeout(r, 350));
    };
    // A) 世界默认（azim=0，侧视）—— 用户"自动取景未跑/手动转视角"时所见
    await setAzim(0); await shot('_fresh_a_side0.png');
    // C) 旧硬编码（azim=34°）
    await setAzim(34); await shot('_fresh_c_old34.png');
    // B) 沿阵型轴（azim=-90，队尾后方）—— 我的修复
    await setAzim(-90); await shot('_fresh_b_axis-90.png');
  } finally {
    await close().catch(() => {});
  }
})();
