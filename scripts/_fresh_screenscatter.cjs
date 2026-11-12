/** 一次性：mesh 真实屏幕投影散点（所见即所得） */
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
    await new Promise((r) => setTimeout(r, 6000));   // 等入场显现基本完成
    const data = await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const bs = ov && ov.battleScene;
      const cam = ov && ov.camera;
      const fleets = (bs && bs.globalFleets) || [];
      const out = [];
      for (const f of fleets) {
        const us = (f.units || []).filter(u => u && u.sprite && (u.formationSlot ?? -1) >= 0);
        if (us.length < 3) continue;
        const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || null;
        const pts = [];
        for (const [key, entry] of (ov.ships || new Map()).entries()) {
          if (entry.fleet !== f) continue;
          const g = entry.group;
          if (!g) continue;
          const v = g.position.clone().project(cam);
          pts.push({ sx: +v.x.toFixed(3), sy: +v.y.toFixed(3) });
        }
        out.push({ id: String(f.id).slice(0,8), side: fac && fac.type === 'player' ? 'P' : 'E', n: us.length, mesh: pts.length, form: String(f.formation || '?'), pts });
      }
      return out;
    })()`);
    if (!data || !data.length) { console.log('取数失败'); return; }
    for (const fl of data) {
      if (!fl.pts.length) { console.log(`
--- ${fl.side} ${fl.id} n=${fl.n} form=${fl.form} mesh=0（无实体）---`); continue; }
      const pts = fl.pts;
      const W = 64, H = 16;
      const xs = pts.map(p => p.sx), ys = pts.map(p => p.sy);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const grid = Array.from({ length: H }, () => Array(W).fill(' '));
      for (const p of pts) {
        const gx = Math.round(((p.sx - x0) / Math.max(1e-6, x1 - x0)) * (W - 1));
        const gy = Math.round(((p.sy - y0) / Math.max(1e-6, y1 - y0)) * (H - 1));
        grid[H - 1 - gy][gx] = '#';
      }
      const ratio = (y1 - y0) / Math.max(1e-6, x1 - x0);
      console.log(`
--- ${fl.side} ${fl.id} n=${fl.n} mesh=${fl.mesh} form=${fl.form} ratio=${ratio.toFixed(2)} ---`);
      for (const row of grid) console.log('|' + row.join('') + '|');
    }
  } finally {
    await close().catch(() => {});
  }
})();
