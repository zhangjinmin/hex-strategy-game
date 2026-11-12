/** 一次性：找「开始战斗」按钮的 DOM 结构（只读，用后即弃） */
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
      if (!p) throw new Error('no text ' + text);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      }
    };
    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { timeoutMs: 15000 });
    const sel = await cdp.evaluate(`(() => {
      const el = document.querySelector('.dispatch-slot');
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: sel.x, y: sel.y, button: 'left', clickCount: 1 });
    }
    await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { timeoutMs: 15000 });
    await clickText('莱因哈特');
    await new Promise((r) => setTimeout(r, 800));
    const launch = await cdp.evaluate(`(() => {
      const el = document.querySelector('.btn-launch-game');
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: launch.x, y: launch.y, button: 'left', clickCount: 1 });
    }
    await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { timeoutMs: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    // 查找所有含「开始战斗」的元素
    const found = await cdp.evaluate(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const t = (el.textContent || '').trim();
        if (/开始战斗/.test(t) && t.length < 30) {
          const r = el.getBoundingClientRect();
          out.push({ tag: el.tagName, cls: el.className && el.className.toString().slice(0, 60), text: t.slice(0, 20), children: el.children.length, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, vis: r.width > 0 && r.height > 0 });
        }
      }
      return out;
    })()`);
    console.log('含「开始战斗」的元素：');
    for (const f of found) console.log(JSON.stringify(f));
    // 还查一下挂钟文本
    const body = await cdp.evaluate(`document.body.innerText.slice(0, 500)`);
    console.log('\n页面文本片段:\n' + body.slice(0, 400));
  } finally {
    await close().catch(() => {});
  }
})();
