/**
 * _diag_wedge_view.cjs — 楔形「数据对 / 视觉不对」归因实验（只读前端源码，不改仓库）
 *
 * 三个对照帧：
 *   A 原样
 *   B 队内高度分层归零（layerK 全 0）
 *   C 相机移到舰队正上方俯视
 * 若 B/C 出现清晰三角而 A 不是 ⇒ 根因在 3D 纵向分层 / 取景，而非阵位几何。
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const URL_ = argOf('--url', 'http://localhost:34115/index.html');

async function main() {
  const probeUrl = pathToFileURL(path.join(__dirname, '../_browser_probe.mjs')).href;
  const { launch, navigate, waitFor } = await import(probeUrl);
  const { cdp, close } = await launch();
  const fs = require('node:fs');
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(__dirname, '..', name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log(`# shot ${name}`);
  };
  try {
    await navigate(cdp, URL_);
    await waitFor(cdp, `document.body.innerText.includes('战术模拟')`, { label: '主菜单', timeoutMs: 40000 });
    const clickText = async (text) => {
      const p = await cdp.evaluate(`(() => {
        const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(text)});
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!p) throw new Error(`找不到可点击文本：${text}`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      }
    };
    const clickSelector = async (sel) => {
      const p = await cdp.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!p) throw new Error(`找不到可点击元素：${sel}`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      }
    };
    const pressEnter = async () => {
      for (const type of ['keyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', {
          type, code: 'Enter', key: 'Enter', text: '\r',
          windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        });
      }
    };

    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { label: '设置页' });
    await clickText('同盟');
    await new Promise((r) => setTimeout(r, 300));
    await clickSelector('.dispatch-slot');
    await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { label: '提督弹窗' });
    await clickText('比克古');
    await new Promise((r) => setTimeout(r, 800));
    await clickSelector('.btn-launch-game');
    await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { label: '战场', timeoutMs: 60000 });

    for (let i = 0; i < 8; i++) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: 800, y: 400, button: 'left', clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, 200));
      await pressEnter();
      try {
        await waitFor(cdp, `(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && (bs.entryPhase || (bs.store && !bs.store.isPaused))); })()`,
          { timeoutMs: 4000, intervalMs: 250, label: 'entry' });
        break;
      } catch { /* retry */ }
    }
    await new Promise((r) => setTimeout(r, 2500));
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; if (bs) { bs.entryPhase = false; bs.store.isPaused = false; } })()`);
    await new Promise((r) => setTimeout(r, 4000));

    // ── 取 wedge 玩家舰队 + 纵向布局读数 ──────────────────────────────
    const info = await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay; const bs = ov.battleScene;
      const R = (v, n = 2) => (typeof v === 'number' && Number.isFinite(v)) ? +v.toFixed(n) : null;
      const outs = [];
      for (const f of (bs.globalFleets || [])) {
        const us = (f.units || []).filter(u => u && u.sprite && (u.formationSlot ?? -1) >= 0);
        if (us.length < 4) continue;
        const v = f._b3dV || null;
        const face = (typeof f.formFacing === 'number') ? f.formFacing : (f.facingSmooth ?? f.facingAngle ?? 0);
        const sp = f._formSpacing ?? null;
        // 平面局部坐标（去高度）
        const loc = us.map(u => {
          const dx = u.sprite.x - f.x, dy = u.sprite.y - f.y;
          return {
            s: u.formationSlot,
            a: R(dx * Math.cos(face) + dy * Math.sin(face)),
            l: R(-dx * Math.sin(face) + dy * Math.cos(face)),
          };
        }).sort((p, q) => q.a - p.a);
        outs.push({
          id: String(f.id).slice(0, 8),
          n: us.length, form: String(f.formation), state: String(f.state),
          faceDeg: R(face * 180 / Math.PI, 1),
          spacing: R(sp), count0: f.formationCount0,
          layers: v ? v.layers : null, layerGap: v ? R(v.layerGap) : null,
          maxH: v ? R(v.maxH) : null, fp: v ? v.footprint : null,
          layerKSpan: v ? R(Math.max(...v.layerK) - Math.min(...v.layerK)) : null,
          layerKthick: v && v.layerGap != null ? R((Math.max(...v.layerK) - Math.min(...v.layerK)) * v.layerGap) : null,
          tierY: (ov.constructor && 0) || null,
          _scx: null,
          loc,
        });
      }
      return outs;
    })()`);
    const data = typeof info === 'string' ? JSON.parse(info) : info;
    for (const f of data) {
      const rowW = new Map();
      for (const c of f.loc) { const k = Math.round(c.a / 26); rowW.set(k, (rowW.get(k) || 0) + 1); }
      console.log(`\n== fleet ${f.id} form=${f.form} n=${f.n} count0=${f.count0} state=${f.state} face=${f.faceDeg}° spacing=${f.spacing}`);
      console.log(`   layers=${f.layers} layerGap=${f.layerGap} maxH=${f.maxH} fp=${JSON.stringify(f.fp)}`);
      console.log(`   layerK 跨度=${f.layerKSpan} 层 → 纵向厚度=${f.layerKthick} 世界单位`);
      console.log(`   平面局部系按排(26px)计数: ${[...rowW.entries()].sort((a,b)=>b[0]-a[0]).map(([k,c])=>`r${k}:${c}`).join(' ')}`);
      const latMax = Math.max(...f.loc.map(c => Math.abs(c.l)));
      const aMax = Math.max(...f.loc.map(c => c.a)), aMin = Math.min(...f.loc.map(c => c.a));
      console.log(`   平面 hadow: 纵深 ${(aMax-aMin).toFixed(1)}px / 横向 ±${latMax.toFixed(1)}px`);
    }

    await shot('_diag_A_normal.png');

    // ── B：队内高度分层归零 ────────────────────────────────────────────
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay; const bs = ov.battleScene;
      window.__savedV = [];
      for (const f of (bs.globalFleets || [])) {
        const v = f._b3dV; if (!v) continue;
        window.__savedV.push([f, v]);
        f._b3dV = { ...v, layerK: v.layerK.map(() => 0), layerGap: 0, layers: 1 };
        f._b3dVKey = 'FORCED_FLAT';
      }
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
    await shot('_diag_B_noLayers.png');

    // ── C：恢复分层 + 相机移到舰队正上方俯视 ─────────────────────────
    await cdp.evaluate(`(() => {
      const ov = window.__b3dOverlay; const bs = ov.battleScene;
      for (const [f, v] of (window.__savedV || [])) { f._b3dV = v; f._b3dVKey = undefined; }
      const f = (bs.globalFleets || []).find(x => String(x.formation) === 'wedge' && (x.units || []).length > 20);
      if (!f) return 'no fleet';
      ov._camUserDragUntil = performance.now() + 12000;
      const cx = f.x, cz = -f.y;
      ov.camera.position.set(cx, cz + 900, cz + 0.001);
      ov.controls.target.set(cx, 0, cz);
      ov.controls.update();
      return 'ok';
    })()`);
    await new Promise((r) => setTimeout(r, 1500));
    await shot('_diag_C_topdown.png');
  } finally {
    await close().catch(() => {});
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
