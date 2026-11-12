/** 验证 v106：拖拽期镜头不自转（方位角单调跟随手势）、松手后停在用户视角 */
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

    // 逐帧记录镜头方位角
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay;
      window.__camTrace = { az: [], done: false, t0: performance.now() };
      const tick = () => {
        const S = window.__camTrace;
        const t = ov.controls.target;
        const az = Math.atan2(ov.camera.position.x - t.x, ov.camera.position.z - t.z) * 180 / Math.PI;
        S.az.push(+az.toFixed(1));
        if (performance.now() - S.t0 > 6000) { S.done = true; return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`);

    // 模拟拖拽：从 (760,420) 向右拖 260px（应平滑转 ~30°+，不许来回摆）
    const cx = 760, cy = 420;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 20; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 13, y: cy, button: 'left' });
      await new Promise((r) => setTimeout(r, 30));
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 260, y: cy, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 2500));
    const done = await cdp.evaluate(`!!(window.__camTrace && window.__camTrace.done)`);
    const az = await cdp.evaluate(`JSON.stringify(window.__camTrace.az)`);
    const arr = JSON.parse(az);
    // 分析：拖拽段（前 1s）方位角变化应单调（无往返）；松手后 1.5s 内应静止
    let reversals = 0, prev = 0, dir = 0;
    for (let i = 1; i < Math.min(arr.length, 40); i++) {
      const d = arr[i] - arr[i - 1];
      if (Math.abs(d) > 0.2) {
        const nd = Math.sign(d);
        if (dir !== 0 && nd !== dir) reversals++;
        dir = nd;
      }
    }
    const tail = arr.slice(-30);
    const drift = Math.max(...tail) - Math.min(...tail);
    console.log(`# 采样帧=${arr.length} done=${done}`);
    console.log(`# 拖拽段方向反转次数=${reversals}（应≤2；≫2=自转）`);
    console.log(`# 松手后尾段漂移=${drift.toFixed(1)}°（应≈0；大=跟不住/继续转）`);
    console.log('# 方位角序列(每3帧): ' + arr.filter((_, i) => i % 3 === 0).map(v => v.toFixed(0)).join(','));
  } finally {
    await close().catch(() => {});
  }
})();
