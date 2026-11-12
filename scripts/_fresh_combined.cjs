/**
 * 合并探针：同一次运行里 截图 + 逐舰队屏幕定位 + 形位指标
 * 测试对象 = 同盟/比克古（用户口径）
 */
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SEC = parseInt(argOf('--sec', '10'), 10);

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
      if (!p) throw new Error('找不到 ' + text);
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
      if (!p) throw new Error('找不到 ' + sel);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      }
    };
    const pressEnter = async () => {
      for (const type of ['keyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', { type, code: 'Enter', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      }
    };

    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { label: '设置页' });
    const HAS_SIDE = await cdp.evaluate(`[...document.querySelectorAll('*')].some(e => e.children.length === 0 && e.textContent.trim() === '同盟')`);
    if (HAS_SIDE) await clickText('同盟');
    await new Promise((r) => setTimeout(r, 300));
    await clickSel('.dispatch-slot');
    await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { label: '提督弹窗' });
    await clickText('比克古');
    await new Promise((r) => setTimeout(r, 800));
    await clickSel('.btn-launch-game');
    await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { label: '战场', timeoutMs: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 5; i++) {
      await clickSel('canvas').catch(() => {});
      await pressEnter();
      const started = await cdp.evaluate(`(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && (bs.entryPhase || (bs.store && !bs.store.isPaused))); })()`);
      if (started) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    await new Promise((r) => setTimeout(r, 1500));
    // 强制解除入场暂停
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; if (bs) { bs.entryPhase = false; bs.store.isPaused = false; } })()`);
    await new Promise((r) => setTimeout(r, 2500));

    // 截图 + 逐舰队屏幕定位（同帧）
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', '_fresh_combined.png'), Buffer.from(shot.data, 'base64'));
    const vw = await cdp.evaluate(`({ w: window.innerWidth, h: window.innerHeight })`);
    console.log(`# 截屏 _fresh_combined.png  viewport=${vw.w}x${vw.h}`);

    const fleets = await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      const bs = ov && ov.battleScene;
      const cam = ov && ov.camera;
      const out = [];
      for (const f of (bs.globalFleets || [])) {
        const us = (f.units || []).filter(u => u && u.sprite && (u.formationSlot ?? -1) >= 0);
        if (us.length < 3) continue;
        const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || {};
        // mesh 屏幕点
        const pts = [];
        for (const [key, entry] of (ov.ships || new Map()).entries()) {
          if (entry.fleet !== f) continue;
          const g = entry.group;
          if (!g) continue;
          const v = g.position.clone().project(cam);
          pts.push({ x: (v.x * 0.5 + 0.5), y: (0.5 - v.y * 0.5) });   // 归一屏幕坐标 0..1
        }
        if (!pts.length) continue;
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
        // 形位（与 _fresh_live_shape 同口径）
        const facing = (typeof f.formFacing === 'number') ? f.formFacing : (typeof f.facingSmooth === 'number') ? f.facingSmooth : (typeof f.facingAngle === 'number') ? f.facingAngle : 0;
        const offs = f._formOffsets || null;
        const sp = (typeof f._formSpacing === 'number') ? f._formSpacing : 26;
        let devMax = 0, ringN = 0, alongMin = 1e9, alongMax = -1e9, latMin = 1e9, latMax = -1e9;
        const alongs = [];
        for (const u of us) {
          const dx = u.sprite.x - f.x, dy = u.sprite.y - f.y;
          const along = dx * Math.cos(facing) + dy * Math.sin(facing);
          const lat = -dx * Math.sin(facing) + dy * Math.cos(facing);
          alongs.push(along);
          if (along < alongMin) alongMin = along;
          if (along > alongMax) alongMax = along;
          if (lat < latMin) latMin = lat;
          if (lat > latMax) latMax = lat;
          const c = offs && offs[u.formationSlot];
          if (!c) { ringN++; continue; }
          const ex = c[0] * sp, ey = c[1] * sp;
          const dev = Math.hypot(dx - (ex * Math.cos(facing) - ey * Math.sin(facing)), dy - (ex * Math.sin(facing) + ey * Math.cos(facing)));
          if (dev > devMax) devMax = dev;
        }
        alongs.sort((a, b) => a - b);
        const gaps = [];
        for (let i = 1; i < alongs.length; i++) gaps.push(+(alongs[i] - alongs[i - 1]).toFixed(1));
        gaps.sort((a, b) => b - a);
        // 迷你散点（12x6）看形状
        const W = 12, H = 6;
        const grid = Array.from({ length: H }, () => Array(W).fill('.'));
        for (const p of pts) {
          const gx = Math.max(0, Math.min(W - 1, Math.round((p.x - Math.min(...xs)) / Math.max(1e-6, Math.max(...xs) - Math.min(...xs)) * (W - 1))));
          const gy = Math.max(0, Math.min(H - 1, Math.round((p.y - Math.min(...ys)) / Math.max(1e-6, Math.max(...ys) - Math.min(...ys)) * (H - 1))));
          grid[gy][gx] = '#';
        }
        out.push({
          side: fac.type === 'player' ? 'P' : 'E',
          disp: String(f.displayId ?? ''),
          cmd: String((f.flagshipName || f.commanderId || f.id)).slice(0, 10),
          n: us.length, mesh: pts.length, form: String(f.formation || '?'),
          face: +(facing * 180 / Math.PI).toFixed(0),
          ctr: [Math.round(cx * ${vw.w}), Math.round(cy * ${vw.h})],
          box: [Math.round(Math.min(...xs) * ${vw.w}), Math.round(Math.min(...ys) * ${vw.h}), Math.round(Math.max(...xs) * ${vw.w}), Math.round(Math.max(...ys) * ${vw.h})],
          devMax: Math.round(devMax), ringN,
          gaps: gaps.slice(0, 3),
          aSpan: Math.round(alongMax - alongMin), lSpan: Math.round(latMax - latMin),
          mini: grid.map(r => r.join('')).join('/'),
        });
      }
      return out.sort((a, b) => b.n - a.n);
    })()`);

    console.log(`\n# 舰队数：${fleets.length}（ctr=屏幕中心像素，box=屏幕包围盒 x0,y0,x1,y1）`);
    for (const f of fleets) {
      console.log(`\n${f.side} disp=${f.disp} ${f.cmd} n=${f.n} mesh=${f.mesh} form=${f.form} face=${f.face}°`);
      console.log(`  ctr=(${f.ctr[0]},${f.ctr[1]}) box=${f.box.join(',')} devMax=${f.devMax} ringN=${f.ringN} gaps=[${f.gaps.join(',')}] aSpan=${f.aSpan} lSpan=${f.lSpan}`);
      console.log('  ' + f.mini);
    }
    void SEC;
  } finally {
    await close().catch(() => {});
  }
})();
