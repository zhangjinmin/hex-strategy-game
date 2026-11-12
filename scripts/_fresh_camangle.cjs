/** 对照：同一楔形舰队在「世界默认侧视相机」vs「沿阵型轴相机」下的观感 */
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
    await new Promise((r) => setTimeout(r, 1000));

    const shot = async (name) => {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(__dirname, '..', name), Buffer.from(s.data, 'base64'));
      const info = await cdp.evaluate(`(() => {
        const ov = window.__b3dOverlay;
        const bs = ov && ov.battleScene;
        const cam = ov && ov.camera;
        const tgt = ov.controls && ov.controls.target;
        let fa = null, fid = null;
        for (const f of (bs.globalFleets || [])) {
          const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || {};
          if (fac.type === 'player') { fa = (typeof f.formFacing === 'number' ? f.formFacing : f.facingAngle); fid = String(f.id).slice(0,8); break; }
        }
        const camAzim = tgt ? Math.atan2(cam.position.x - tgt.x, cam.position.z - tgt.z) : null;
        return { faDeg: fa == null ? null : +(fa * 180 / Math.PI).toFixed(0), camAzimDeg: camAzim == null ? null : +(camAzim * 180 / Math.PI).toFixed(0), fid };
      })()`);
      console.log(`# ${name}`, JSON.stringify(info));
    };

    // A) 世界默认侧视相机（模拟「自动取景未跑」时用户所见）
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const bs = ov && ov.battleScene;
      let f = null;
      for (const x of (bs.globalFleets || [])) {
        const fac = (bs.factionMap && bs.factionMap.get(x.factionId)) || {};
        if (fac.type === 'player') { f = x; break; }
      }
      if (!f) return;
      const d = ov.hexR * 12;
      let cx = 0, cy = 0, nn = 0;
      for (const u of (f.units || [])) { if (!u.sprite) continue; cx += u.sprite.x; cy += u.sprite.y; nn++; }
      if (nn) { cx /= nn; cy /= nn; } else { cx = f.x; cy = f.y; }
      const t = { x: cx, y: 0, z: -cy };
      ov.controls.target.set(t.x, t.y, t.z);
      // azim=0：相机在 +z（世界默认）；elev=0.55
      ov.camera.position.set(t.x + Math.sin(0.55) * Math.sin(0) * d, t.y + Math.cos(0.55) * d, t.z + Math.sin(0.55) * Math.cos(0) * d);
      ov.camera.lookAt(t.x, t.y, t.z);
      ov.controls.update();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await shot('_fresh_cam_side.png');

    // B) 沿阵型轴（我的修复公式）
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const bs = ov && ov.battleScene;
      let f = null;
      for (const x of (bs.globalFleets || [])) {
        const fac = (bs.factionMap && bs.factionMap.get(x.factionId)) || {};
        if (fac.type === 'player') { f = x; break; }
      }
      if (!f) return;
      const fa = (typeof f.formFacing === 'number' ? f.formFacing : f.facingAngle) || 0;
      const d = ov.hexR * 12;
      let cx = 0, cy = 0, nn = 0;
      for (const u of (f.units || [])) { if (!u.sprite) continue; cx += u.sprite.x; cy += u.sprite.y; nn++; }
      if (nn) { cx /= nn; cy /= nn; } else { cx = f.x; cy = f.y; }
      const t = { x: cx, y: 0, z: -cy };
      const azim = Math.atan2(-Math.cos(fa), Math.sin(fa));
      ov.controls.target.set(t.x, t.y, t.z);
      ov.camera.position.set(t.x + Math.sin(0.55) * Math.sin(azim) * d, t.y + Math.cos(0.55) * d, t.z + Math.sin(0.55) * Math.cos(azim) * d);
      ov.camera.lookAt(t.x, t.y, t.z);
      ov.controls.update();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await shot('_fresh_cam_axis.png');

    // C) 旧硬编码 azim=0.6（我修复前的取景）
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const bs = ov && ov.battleScene;
      let f = null;
      for (const x of (bs.globalFleets || [])) {
        const fac = (bs.factionMap && bs.factionMap.get(x.factionId)) || {};
        if (fac.type === 'player') { f = x; break; }
      }
      if (!f) return;
      const d = ov.hexR * 12;
      let cx = 0, cy = 0, nn = 0;
      for (const u of (f.units || [])) { if (!u.sprite) continue; cx += u.sprite.x; cy += u.sprite.y; nn++; }
      if (nn) { cx /= nn; cy /= nn; } else { cx = f.x; cy = f.y; }
      const t = { x: cx, y: 0, z: -cy };
      const azim = 0.6;
      ov.controls.target.set(t.x, t.y, t.z);
      ov.camera.position.set(t.x + Math.sin(0.55) * Math.sin(azim) * d, t.y + Math.cos(0.55) * d, t.z + Math.sin(0.55) * Math.cos(azim) * d);
      ov.camera.lookAt(t.x, t.y, t.z);
      ov.controls.update();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await shot('_fresh_cam_old.png');
  } finally {
    await close().catch(() => {});
  }
})();
