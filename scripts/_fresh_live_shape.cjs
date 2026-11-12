/**
 * _fresh_live_shape.cjs — 全新复盘·真机形位取证（只读）
 *
 * 用 CDP 连 dev server，走完整 UI 流程进战场，在**入场暂停窗 + 开战后**
 * 逐帧采样舰队的实际排布，并定量分类形状：
 *   · alongSpan / latSpan —— 舰队局部系下纵/横向跨度
 *   · corr(depth,|lateral|) —— 楔形应 ≈1（越靠后越宽）；直线/彗尾 ≈0
 *   · gaps —— 沿轴间隙（"1 艘 + 空隙 + 一堆"的定量特征）
 *   · dev —— 与 _formOffsets 槽位表的逐舰偏差（max/p90）
 * 同时截屏 3 张（入场中/入场结束/开战后），人眼可直接对照。
 *
 * 纪律：只读；不改 frontend/**；不手抄战斗常量（spacing/facing 直接读运行时字段）。
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const URL = argOf('--url', 'http://127.0.0.1:5210/index.html');
const SEC = parseInt(argOf('--sec', '18'), 10);

async function main() {
  const probeUrl = pathToFileURL(path.join(__dirname, '../_browser_probe.mjs')).href;
  const { launch, navigate, waitFor } = await import(probeUrl);
  const { cdp, close } = await launch();
  const shots = [];
  try {
    console.log(`# 打开 ${URL}`);
    await navigate(cdp, URL);
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
    const pressEnter = async () => {
      for (const type of ['keyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', {
          type, code: 'Enter', key: 'Enter', text: '\r',
          windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        });
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

    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { label: '设置页' });
    // ★ 测试对象 = 同盟侧 比克古（用户明确指出：莱因哈特本来就是对的，错误的是同盟侧）
    const HAS_SIDE = await cdp.evaluate(`[...document.querySelectorAll('*')].some(e => e.children.length === 0 && e.textContent.trim() === '同盟')`);
    if (HAS_SIDE) await clickText('同盟');
    await new Promise((r) => setTimeout(r, 300));
    await clickSelector('.dispatch-slot');
    await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { label: '提督弹窗' });
    await clickText('比克古');
    await new Promise((r) => setTimeout(r, 800));
    await clickSelector('.btn-launch-game');
    await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { label: '战场', timeoutMs: 60000 });

    // 开战：点画布聚焦 + Enter（与 _diag_turn180 同路径）；DOM「开始战斗」按钮作补充尝试
    const startBtn = `(() => {
      const el = [...document.querySelectorAll('button,div,span')].find(e => e.children.length === 0 && /开始战斗/.test(e.textContent || ''));
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`;
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) {
      // ① 点画布（Phaser 键盘监听需要画布焦点）
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: 800, y: 400, button: 'left', clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, 250));
      // ② 尝试 DOM 开始按钮（若军议面板仍在）
      const b = await cdp.evaluate(startBtn);
      if (b) {
        for (const type of ['mousePressed', 'mouseReleased']) {
          await cdp.send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      // ③ Enter 开战
      await pressEnter();
      try {
        await waitFor(cdp, `(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && (bs.entryPhase || (bs.store && !bs.store.isPaused))); })()`,
          { timeoutMs: 6000, intervalMs: 300, label: 'entry/start' });
        ok = true;
      } catch { /* retry */ }
    }
    if (!ok) console.log('# 警告：未能确认开战，继续采样（可能仍在部署期）');

    console.log(`# 开战成功，注入形位采样器（${SEC}s）`);
    // ★ 强制结束入场暂停：探针环境 Phaser delayedCall 不触发（真机会自动解除），
    //   不强制就永远只采样「冻结摆位态」，看不到 update() 跑起来后的活战场。
    await new Promise((r) => setTimeout(r, 3000));
    await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay.battleScene;
      if (bs) { bs.entryPhase = false; bs.store.isPaused = false; }
    })()`);
    console.log('# 已强制解除入场暂停（模拟 endEntryPhase）');
    await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay.battleScene;
      window.__shape = { samples: [], startedAt: performance.now(), done: false };
      const R = (v, n = 2) => (typeof v === 'number' && Number.isFinite(v)) ? +v.toFixed(n) : null;
      const tick = () => {
        const S = window.__shape;
        const now = performance.now();
        if (S.samples.length >= 400 || now - S.startedAt > ${SEC * 1000}) { S.done = true; return; }
        const fleets = (bs.globalFleets || []).filter(f => (f.units || []).length >= 4);
        for (const f of fleets) {
          const us = (f.units || []).filter(u => u && u.sprite && (u.formationSlot ?? -1) >= 0);
          if (us.length < 4) continue;
          const facing = (typeof f.formFacing === 'number') ? f.formFacing
                       : (typeof f.facingSmooth === 'number') ? f.facingSmooth
                       : (typeof f.facingAngle === 'number') ? f.facingAngle : 0;
          const cf = Math.cos(-facing), sf = Math.sin(-facing);
          let alongMin = 1e9, alongMax = -1e9, latMin = 1e9, latMax = -1e9;
          const items = [];
          const offs = f._formOffsets || null;
          const sp = (typeof f._formSpacing === 'number') ? f._formSpacing : 26;
          let devMax = 0, devSum = 0, devN = 0;
          for (const u of us) {
            const dx = u.sprite.x - f.x, dy = u.sprite.y - f.y;
            // 旋转回阵型局部系：along=纵向（舰首方向），lat=横向
            const along = dx * Math.cos(facing) + dy * Math.sin(facing);
            const lat = -dx * Math.sin(facing) + dy * Math.cos(facing);
            if (along < alongMin) alongMin = along;
            if (along > alongMax) alongMax = along;
            if (lat < latMin) latMin = lat;
            if (lat > latMax) latMax = lat;
            // 与槽位表的偏差（槽位表按 formationSlot 直接索引；稠密时即真值）
            let dev = null, cell = null;
            if (offs) {
              const c = offs[u.formationSlot];
              if (c) {
                cell = c;
                const ex = c[0] * sp, ey = c[1] * sp;
                dev = Math.hypot(dx - (ex * Math.cos(facing) - ey * Math.sin(facing)),
                                 dy - (ex * Math.sin(facing) + ey * Math.cos(facing)));
                if (dev > devMax) devMax = dev;
                devSum += dev; devN++;
              } else {
                cell = '∅';
                dev = -1;
              }
            }
            items.push({ s: u.formationSlot, a: R(along), l: R(lat), d: R(dev), c: cell === '∅' ? '∅' : (cell ? cell[0] + ',' + cell[1] : null) });
          }
          items.sort((a, b) => a.a - b.a);          // 按纵向（前→后）排序
          // 沿轴间隙：相邻舰纵向距离（找 "1 + 空隙 + 一堆"）
          const gaps = [];
          for (let i = 1; i < items.length; i++) gaps.push(+(items[i].a - items[i - 1].a).toFixed(1));
          gaps.sort((x, y) => y - x);
          // 楔形相关度 corr(|lat|, -along)（越靠后越宽 ⇒ 正相关）
          let sX = 0, sY = 0, sXY = 0, sX2 = 0, sY2 = 0, n = 0;
          for (const it of items) {
            const X = -it.a, Y = Math.abs(it.l);
            sX += X; sY += Y; sXY += X * Y; sX2 += X * X; sY2 += Y * Y; n++;
          }
          const cov = sXY / n - (sX / n) * (sY / n);
            const vx = sX2 / n - (sX / n) ** 2, vy = sY2 / n - (sY / n) ** 2;
          const corr = (vx > 0 && vy > 0) ? cov / Math.sqrt(vx * vy) : 0;
          const alongSpan = alongMax - alongMin, latSpan = latMax - latMin;
          const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || (bs.store && (bs.store.factions || []).find((x) => x.id === f.factionId)) || null;
          S.samples.push({
            t: +(now - S.startedAt).toFixed(0),
            id: String(f.id).slice(0, 8),
            side: fac && fac.type === 'player' ? 'P' : 'E',
            n: us.length,
            form: String(f.formation || '?'),
            st: String(f.state || '?'),
            face: R(facing * 180 / Math.PI, 1),
            entry: !!(bs.entryPhase),
            paused: !!(bs.store && bs.store.isPaused),
            morphT: R(Number(f._formMorphT ?? -1), 2),
            morphDur: R(Number(f._formMorphDur ?? -1), 2),
            flip: !!f._slotFlip,
            ctK: R(Number(f._ctKNow ?? 1), 2),
            aSpan: R(alongSpan), lSpan: R(latSpan),
            ratio: R(latSpan / Math.max(1, alongSpan), 3),
            corr: R(corr, 3),
            topGaps: gaps.slice(0, 3),
            devMax: R(devMax), devAvg: R(devN ? devSum / devN : 0),
            devBad: items.filter(it => it.d != null && it.d > 25).length,
            ringN: items.filter(it => it.c === '∅').length,
            // 前 3 / 后 3 舰的局部坐标（看 "1 艘打头"）
            head: items.slice(0, 3).map(it => it.a + '/' + it.l),
            tail: items.slice(-3).map(it => it.a + '/' + it.l),
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`);

    // 中途截图：2s（入场中）/ 7s（入场末）/ 14s（开战后）
    const shotAt = async (ms, name) => {
      await new Promise((r) => setTimeout(r, ms));
      try {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const buf = Buffer.from(shot.data, 'base64');
        const fs = require('node:fs');
        const out = path.join(__dirname, '..', name);
        fs.writeFileSync(out, buf);
        shots.push(out);
        console.log(`# 截屏 ${name} (${buf.length} bytes)`);
      } catch (e) { console.log(`# 截屏失败 ${name}: ${e.message}`); }
    };
    await shotAt(2500, '_fresh_shot_entry.png');
    await shotAt(5000, '_fresh_shot_entryend.png');
    await shotAt(8000, '_fresh_shot_battle.png');

    // 等采样结束
    const t0 = Date.now();
    while (Date.now() - t0 < SEC * 1000 + 5000) {
      const done = await cdp.evaluate(`!!(window.__shape && window.__shape.done)`);
      if (done) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const payload = await cdp.evaluate(`JSON.stringify(window.__shape)`);
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    analyze(data.samples || []);
  } finally {
    await close().catch(() => {});
  }
}

function analyze(samples) {
  console.log(`\n# 采样数：${samples.length}`);
  if (!samples.length) return;
  // 逐舰队（用户可能盯着任意一支，尤其小队）列出形位 + 异常判定
  const byId = new Map();
  for (const s of samples) {
    const cur = byId.get(s.id);
    if (!cur || s.t > cur.t) byId.set(s.id, s);   // 取每队最后一帧
  }
  const rows = [...byId.values()].sort((a, b) => (a.side === b.side ? b.n - a.n : a.side.localeCompare(b.side)));
  console.log('\nside id        n   form    face  aSpan lSpan ratio  corr  devMax bad ring topGaps       判定');
  for (const last of rows) {
    const flags = [];
    if (last.devMax > 40) flags.push(`偏差${last.devMax}px`);
    if (last.ringN > 0) flags.push(`ring${last.ringN}`);
    if (last.topGaps[0] > 60) flags.push(`空隙${last.topGaps[0]}`);
    if (last.topGaps[0] > 2 * Math.max(1, last.topGaps[2])) flags.push(`间隙不均`);
    if (last.form === 'wedge' && last.corr < 0.5) flags.push(`楔形corr=${last.corr}`);
    if (last.morphT >= 0 && last.morphDur > 0 && last.morphT < last.morphDur) flags.push(`morph在途`);
    if (last.flip) flags.push('flip');
    console.log(
      `${last.side}    ${String(last.id).padEnd(8)} ${String(last.n).padStart(3)}  ${String(last.form).padEnd(7)} ` +
      `${String(last.face).padStart(5)} ${String(last.aSpan).padStart(5)} ${String(last.lSpan).padStart(5)} ` +
      `${String(last.ratio).padStart(5)} ${String(last.corr).padStart(5)} ${String(last.devMax).padStart(6)}  ` +
      `${String(last.devBad).padStart(3)} ${String(last.ringN).padStart(3)} [${last.topGaps.join(',')}]  ` +
      (flags.length ? '⚠ ' + flags.join(' ｜ ') : '✓')
    );
  }
  // 打印异常舰队的头/尾局部坐标（定位「1 艘+空隙+一堆」）
  for (const last of rows) {
    if (last.devMax > 40 || last.ringN > 0 || last.topGaps[0] > 60) {
      console.log(`\n异常舰队 ${last.id} (${last.side}, n=${last.n}, ${last.form}) 头/尾：`);
      console.log(`  head=${last.head.join(' ')}  tail=${last.tail.join(' ')}`);
      console.log(`  topGaps=[${last.topGaps.join(',')}]`);
    }
  }
}

main().catch((e) => { console.error('探针失败:', e); process.exit(1); });
