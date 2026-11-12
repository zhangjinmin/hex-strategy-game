/** 按舰队屏幕包围盒裁剪截屏（全分辨率） */
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
    await new Promise((r) => setTimeout(r, 3000));

    // 找玩家舰队屏幕包围盒
    const box = await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const bs = ov && ov.battleScene;
      const cam = ov && ov.camera;
      for (const f of (bs.globalFleets || [])) {
        const us = (f.units || []).filter(u => u && u.sprite && (u.formationSlot ?? -1) >= 0);
        if (us.length < 20) continue;
        const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || {};
        if (fac.type !== 'player') continue;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const [key, entry] of (ov.ships || new Map()).entries()) {
          if (entry.fleet !== f) continue;
          const g = entry.group;
          if (!g) continue;
          const v = g.position.clone().project(cam);
          const sx = (v.x * 0.5 + 0.5) * window.innerWidth, sy = (0.5 - v.y * 0.5) * window.innerHeight;
          if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
          if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
        }
        return { x0, y0, x1, y1, n: us.length, form: String(f.formation || '?') };
      }
      return null;
    })()`);
    console.log('# 玩家舰队盒', JSON.stringify(box));
    if (!box) return;
    const m = 40;
    const clip = {
      x: Math.max(0, Math.round(box.x0 - m)),
      y: Math.max(0, Math.round(box.y0 - m)),
      width: Math.round(box.x1 - box.x0 + m * 2),
      height: Math.round(box.y1 - box.y0 + m * 2),
      scale: 2,
    };
    clip.width = Math.min(clip.width, 2000); clip.height = Math.min(clip.height, 1600);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    fs.writeFileSync(path.join(__dirname, '..', '_fresh_fleet_zoom.png'), Buffer.from(shot.data, 'base64'));
    console.log('# 裁剪截屏 _fresh_fleet_zoom.png', JSON.stringify(clip));
  } finally {
    await close().catch(() => {});
  }
})();
