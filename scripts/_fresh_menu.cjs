const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const probeUrl = pathToFileURL(path.join(__dirname, '../_browser_probe.mjs')).href;
  const { launch, navigate, waitFor } = await import(probeUrl);
  const { cdp, close } = await launch();
  try {
    await navigate(cdp, 'http://localhost:5210/index.html');
    await waitFor(cdp, `document.body.innerText.includes('战术模拟')`, { timeoutMs: 40000 });
    await new Promise((r) => setTimeout(r, 1200));
    const text = await cdp.evaluate(`document.body.innerText.slice(0, 900)`);
    console.log('=== 主菜单 ===\n' + text);
  } finally {
    await close().catch(() => {});
  }
})();
