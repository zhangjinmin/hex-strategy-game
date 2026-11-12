/**
 * _diag_framing_audit.cjs — 补证 Q1（只读，不改前端）
 *
 * qa 阻断项：上一版探针只采 player 舰队 ⇒ 帝国侧样本 0 条，「帝国正常」从未被测量。
 * 本探针：冷启动 → 战术模拟 → 同盟/比克古 → 开战，**全程不碰相机**，
 * 逐秒采【每支舰队（含帝国）】的 formFacing、相对相机的 δ、仰角、点位，
 * 以及楔尖(slot 0)与第 1 排的屏幕间隙 vs 双方舰长 —— 同时验 Q1（方位）与 Q2（楔尖孤立）。
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const URL_ = argOf('--url', 'http://localhost:34115/index.html');

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
    for (let i = 0; i < 8; i++) {
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: 800, y: 400, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 200));
      await enter();
      try {
        await waitFor(cdp, `(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && (bs.entryPhase || (bs.store && !bs.store.isPaused))); })()`, { timeoutMs: 4000, intervalMs: 250, label: 'entry' });
        break;
      } catch { /* retry */ }
    }

    // ── 采样器：全程不碰相机 ────────────────────────────────────────
    await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay.battleScene;
      window.__fr = { rows: [], done: false };
      const R = (v, n = 2) => (typeof v === 'number' && Number.isFinite(v)) ? +v.toFixed(n) : null;
      const t0 = performance.now();
      const tick = () => {
        const S = window.__fr;
        const now = performance.now();
        if (now - t0 > 22000) { S.done = true; return; }
        const ov = window.__b3dOverlay;
        const cam = ov.camera.position, tgt = ov.controls.target;
        const dx = cam.x - tgt.x, dz = cam.z - tgt.z;
        const dl = Math.hypot(dx, dz) || 1;
        const el = Math.atan2(cam.y - tgt.y, dl) * 180 / Math.PI;
        const az = Math.atan2(dx, dz) * 180 / Math.PI;
        for (const f of (bs.globalFleets || [])) {
          const us = (f.units || []).filter(u => u && u.sprite && (u.formationSlot ?? -1) >= 0 && u.hp > 0);
          if (us.length < 4) continue;
          const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || null;
          const ff = (typeof f.formFacing === 'number') ? f.formFacing : (f.facingSmooth ?? f.facingAngle ?? 0);
          // 阵型 forward（世界 XZ）= (cos ff, -sin ff)；相机方向 = (dx, dz) 归一
          const fwdDot = (-dx * Math.cos(ff) + dz * (-Math.sin(ff))) / dl;  // 相机在后方 ⇒ +1
          const deltaDeg = Math.acos(Math.max(-1, Math.min(1, fwdDot))) * 180 / Math.PI;
          // slot0（楔尖）与第 1 排的屏幕关系
          const pts = [];
          for (const v of ov.unitVis.values()) { if (v.fleet === f) pts.push(v); }
          const s0 = pts.find(v => v.u && v.u.formationSlot === 0) || null;
          const offs = f._formOffsets || null;
          const sp = f._formSpacing ?? 26;
          let tipGap = null, rowGapScreen = null, tipLen = null, row1Len = null;
          if (s0 && offs && pts.length) {
            // 第 1 排 = gx 最接近 -1 的格位上的舰
            let r1 = null, best = 1e9;
            for (const v of pts) {
              const sl = v.u && v.u.formationSlot;
              if (sl == null || sl < 0 || !offs[sl]) continue;
              const gx = offs[sl][0];
              if (gx === 0) continue;
              const d = Math.abs(gx + 1);
              if (d < best) { best = d; r1 = v; }
            }
            if (r1) {
              tipGap = +Math.hypot(s0.sx - r1.sx, s0.sy - r1.sy).toFixed(1);
              row1Len = R(r1.shipLen);
            }
            tipLen = R(s0.shipLen);
            // 相邻排屏幕间距：按 gx 分组的屏幕平均位置差
            const byGx = new Map();
            for (const v of pts) {
              const sl = v.u && v.u.formationSlot;
              if (sl == null || sl < 0 || !offs[sl]) continue;
              const gx = offs[sl][0];
              const a = byGx.get(gx) || [0, 0, 0];
              a[0] += v.sx; a[1] += v.sy; a[2]++;
              byGx.set(gx, a);
            }
            const rows = [...byGx.entries()].sort((p, q) => q[0] - p[0]).map(([gx, a]) => [gx, a[0] / a[2], a[1] / a[2]]);
            const gaps = [];
            for (let i = 1; i < rows.length; i++) gaps.push(Math.hypot(rows[i][1] - rows[i - 1][1], rows[i][2] - rows[i - 1][2]));
            gaps.sort((a, b) => a - b);
            rowGapScreen = gaps.length ? R(gaps[Math.floor(gaps.length / 2)]) : null;
          }
          S.rows.push({
            t: R(now - t0, 0),
            id: String(f.id).slice(0, 6),
            side: fac && fac.type === 'player' ? 'P' : 'E',
            n: us.length, form: String(f.formation), state: String(f.state),
            st_speed: R(Math.hypot(f.vx || 0, f.vy || 0)),
            ff: R(ff * 180 / Math.PI, 1),
            camAz: R(az, 1), camEl: R(el, 1), dist: R(Math.hypot(dx, cam.y - tgt.y, dz), 0),
            delta: R(deltaDeg, 1),
            entry: !!bs.entryPhase,
            tipLen, row1Len, tipGap, rowGapScreen,
            layers: f._b3dV ? f._b3dV.layers : null,
            layerGap: f._b3dV ? R(f._b3dV.layerGap) : null,
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`);

    await new Promise((r) => setTimeout(r, 3000));
    await shot('_diag_frame_entry_nocam.png');
    console.log('# 已截入场帧（未碰相机）');

    // 自然结束入场（探针环境 delayedCall 不触发，只做这一步；不改相机）
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; if (bs) { bs.entryPhase = false; bs.store.isPaused = false; } })()`);
    await new Promise((r) => setTimeout(r, 9000));
    await shot('_diag_frame_steady_nocam.png');
    console.log('# 已截稳态帧（未碰相机）');

    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const done = await cdp.evaluate(`!!(window.__fr && window.__fr.done)`);
      if (done) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const payload = await cdp.evaluate(`JSON.stringify(window.__fr.rows)`);
    const rows = typeof payload === 'string' ? JSON.parse(payload) : payload;

    // 按 (side, id) 聚合成时间线摘要
    const byKey = new Map();
    for (const r of rows) {
      const k = r.side + '|' + r.id;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }
    console.log('\n# 每条舰队时间线（每 2s 抽一帧）');
    for (const [k, arr] of byKey) {
      const picked = arr.filter((r, i) => i % Math.max(1, Math.floor(arr.length / 8)) === 0);
      console.log(`\n== ${k}  form=${arr[0].form} n=${arr[0].n} rows=${arr.length}`);
      console.log('   t    entry  ff     camAz  camEl dist  δ(deg)  state      tipLen row1Len tipGap rowGap L  layerGap');
      for (const r of picked) {
        console.log('  ' + [String(r.t).padStart(4), r.entry ? 'Y' : 'n', String(r.ff).padStart(6), String(r.camAz).padStart(6),
          String(r.camEl).padStart(5), String(r.dist).padStart(5), String(r.delta).padStart(6),
          String(r.state).padEnd(10), String(r.tipLen ?? '-').padStart(6), String(r.row1Len ?? '-').padStart(7),
          String(r.tipGap ?? '-').padStart(6), String(r.rowGapScreen ?? '-').padStart(6),
          String(r.layers ?? '-').padStart(2), String(r.layerGap ?? '-')].join(' '));
      }
    }
  } finally {
    await close().catch(() => {});
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
