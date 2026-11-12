/**
 * _diag_entryfx_off.cjs — 验证「开场动画=off」路径（只读，运行时注入桩，不改仓库代码）
 *
 * 假设：`beginEntryPhase()` 在 entryFxStyle==='off' 时提前 return，不置 entryPhase
 * ⇒ `endEntryPhase()` 永不执行 ⇒ v102「开场定妆重摆」不执行 ⇒ 锚-舰脱钩、阵型散。
 * 同时入场自动聚焦被跳过 ⇒ 相机停在固定机位。
 *
 * 做法：进战场后、按 Enter 开战**之前**，把 bs.entryFxDisabledBySetting 覆写为 ()=>true。
 * 对照量：每艘舰 sprite 与「锚点+槽位」的偏差、相机 δ/仰角、entryPhase。
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const URL_ = argOf('--url', 'http://localhost:34115/index.html');
const MODE = argOf('--mode', 'off');   // off | on

async function main() {
  const probeUrl = pathToFileURL(path.join(__dirname, '../_browser_probe.mjs')).href;
  const { launch, navigate, waitFor } = await import(probeUrl);
  const { cdp, close } = await launch();
  const fs = require('node:fs');
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '..', name), Buffer.from(r.data, 'base64'));
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
    await new Promise((r) => setTimeout(r, 1500));

    // ── 开战前注入 ─────────────────────────────────────────────
    const injected = await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene;
      if (!bs) return 'no bs';
      if (${MODE === 'off' ? 'true' : 'false'}) {
        bs.entryFxDisabledBySetting = () => true;
        if (window.__b3dOverlay) window.__b3dOverlay.entryFxOff = true;   // 同时关 3D 侧的聚焦
      }
      return { entryFxOff: window.__b3dOverlay ? window.__b3dOverlay.entryFxOff : null, patched: ${MODE === 'off' ? 'true' : 'false'} };
    })()`);
    console.log('# 注入：', JSON.stringify(injected));

    // 开战
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) {
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: 800, y: 400, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 200));
      await enter();
      try {
        await waitFor(cdp, `(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && !bs.deployPhase); })()`, { timeoutMs: 4000, intervalMs: 200, label: 'battle' });
        ok = true;
      } catch { /* retry */ }
    }
    if (!ok) console.log('# 警告：未能确认开战');

    // ── 采样：锚点 vs sprite 脱钩量 ────────────────────────────
    const probe = `(() => {
      const ov = window.__b3dOverlay; const bs = ov.battleScene;
      const R = (v, n = 2) => (typeof v === 'number' && Number.isFinite(v)) ? +v.toFixed(n) : null;
      const cam = ov.camera.position, tgt = ov.controls.target;
      const dx = cam.x - tgt.x, dz = cam.z - tgt.z;
      const dl = Math.hypot(dx, dz) || 1;
      const el = Math.atan2(cam.y - tgt.y, dl) * 180 / Math.PI;
      const out = [];
      for (const f of (bs.globalFleets || [])) {
        const us = (f.units || []).filter(u => u && u.sprite && (u.formationSlot ?? -1) >= 0);
        if (us.length < 4) continue;
        const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || null;
        const ff = (typeof f.formFacing === 'number') ? f.formFacing : (f.facingSmooth ?? f.facingAngle ?? 0);
        const fwdDot = (-dx * Math.cos(ff) + dz * (-Math.sin(ff))) / dl;
        const offs = f._formOffsets || [];
        const sp = f._formSpacing ?? 26;
        let devMax = 0, devSum = 0, devN = 0;
        for (const u of us) {
          const sl = u.formationSlot;
          const c = offs[sl];
          if (!c) continue;
          const ex = c[0] * sp, ey = c[1] * sp;
          const exX = f.x + (ex * Math.cos(ff) - ey * Math.sin(ff));
          const exY = f.y + (ex * Math.sin(ff) + ey * Math.cos(ff));
          const d = Math.hypot(u.sprite.x - exX, u.sprite.y - exY);
          if (d > devMax) devMax = d;
          devSum += d; devN++;
        }
        out.push({
          id: String(f.id).slice(0, 6),
          side: fac && fac.type === 'player' ? 'P' : 'E',
          form: String(f.formation), n: us.length, state: String(f.state),
          entryPhase: !!bs.entryPhase, paused: !!bs.store.isPaused,
          ff: R(ff * 180 / Math.PI, 1),
          camEl: R(el, 1), delta: R(Math.acos(Math.max(-1, Math.min(1, fwdDot))) * 180 / Math.PI, 1),
          dist: R(Math.hypot(dx, cam.y - tgt.y, dz), 0),
          devMax: R(devMax), devAvg: R(devN ? devSum / devN : 0),
          devBad: devN ? undefined : undefined,
          reframed: !!ov._openReframeDone,
        });
      }
      return { entryPhase: !!bs.entryPhase, paused: !!bs.store.isPaused, fleets: out };
    })()`;

    const dump = async (tag) => {
      const r = await cdp.evaluate(probe);
      const o = typeof r === 'string' ? JSON.parse(r) : r;
      console.log(`\n[${tag}] entryPhase=${o.entryPhase} paused=${o.paused}`);
      console.log('  side id     form   n  state       ff     δ    camEl  dist  devMax devAvg');
      for (const f of o.fleets) {
        console.log('  ' + [f.side, f.id.padEnd(6), f.form.padEnd(7), String(f.n).padStart(3), f.state.padEnd(11),
          String(f.ff).padStart(6), String(f.delta).padStart(5), String(f.camEl).padStart(5),
          String(f.dist).padStart(5), String(f.devMax).padStart(7), String(f.devAvg).padStart(7)].join(' '));
      }
      return o;
    };

    await new Promise((r) => setTimeout(r, 300));
    await dump('开战后 0.3s');
    await shot(`_diag_entryfx_${MODE}_t0.png`);
    await new Promise((r) => setTimeout(r, 3000));
    await dump('开战后 3.3s');
    await new Promise((r) => setTimeout(r, 5000));
    await dump('开战后 8.3s');
    await shot(`_diag_entryfx_${MODE}_t8.png`);
  } finally {
    await close().catch(() => {});
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
