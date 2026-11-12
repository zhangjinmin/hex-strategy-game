/** 一次性：列「调度现役将领」弹窗里可选提督 + 设置页结构 */
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
    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { timeoutMs: 15000 });
    // 设置页全文（看有没有阵营/攻防切换）
    const pageText = await cdp.evaluate(`document.body.innerText.slice(0, 1200)`);
    console.log('=== 设置页文本 ===\n' + pageText);
    // dispatch-slot 数量与内容
    const slots = await cdp.evaluate(`(() => {
      return [...document.querySelectorAll('.dispatch-slot')].map((el, i) => ({ i, text: (el.textContent || '').trim().slice(0, 40) }));
    })()`);
    console.log('\n=== .dispatch-slot ===');
    for (const s of slots) console.log(JSON.stringify(s));
    // 点第一个 slot 开弹窗
    const p = await cdp.evaluate(`(() => {
      const el = document.querySelector('.dispatch-slot');
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    }
    await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { timeoutMs: 15000 });
    await new Promise((r) => setTimeout(r, 600));
    const names = await cdp.evaluate(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const t = (el.textContent || '').trim();
        if (el.children.length === 0 && t.length >= 2 && t.length <= 8 && /[一-龥]/.test(t)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) out.push(t);
        }
      }
      return [...new Set(out)];
    })()`);
    console.log('\n=== 弹窗内中文短文本（含提督名）===');
    console.log(names.join(' | '));
  } finally {
    await close().catch(() => {});
  }
})();
