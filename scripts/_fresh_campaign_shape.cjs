/**
 * 战役轨形位探针（只读游戏状态）
 * 路径：主菜单 → 注入真实规模 campaign tacticalState → BattleScene(spawnStrategicFleets) → 采样 + 截屏
 */
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SEC = parseInt(argOf('--sec', '14'), 10);

(async () => {
  const probeUrl = pathToFileURL(path.join(__dirname, '../_browser_probe.mjs')).href;
  const { launch, navigate, waitFor } = await import(probeUrl);
  const { cdp, close } = await launch();
  try {
    await navigate(cdp, 'http://localhost:5210/index.html');
    await waitFor(cdp, `document.body.innerText.includes('战术模拟')`, { timeoutMs: 40000 });

    const inject = `(() => {
      try {
        const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__;
        const pinia = app && app.config.globalProperties.$pinia;
        if (!pinia) return 'no pinia';
        const stores = pinia._s || new Map();
        let store = null;
        for (const [k, v] of stores.entries()) { if (v && typeof v.debugForceBattle === 'function') { store = v; break; } }
        if (!store) return 'no store; keys=' + [...stores.keys()].join(',');
        const mk = (type, n, hp, atk) => Array.from({ length: n }, (_, i) => ({ type, count: 500 + (i % 7) * 300, shipCount: 500, hp, maxHp: hp, atk }));
        const atk = { fleetId: 9991, factionId: 1, commanderId: 901, commanderName: '比克古 (宇宙舰队司令长官)', flagshipName: '亚尔沙留姆', imageId: '156',
          formation: 'wedge', slots: mk('battleship', 30, 6000, 150).concat(mk('cruiser', 45, 2400, 90)).concat(mk('destroyer', 45, 1600, 120)) };
        const def = { fleetId: 9992, factionId: 2, commanderId: 902, commanderName: '罗严塔尔 (帝国双璧)', flagshipName: '托利斯坦', imageId: '81',
          formation: 'wedge', slots: mk('battleship', 25, 4000, 150).concat(mk('cruiser', 40, 1800, 90)).concat(mk('destroyer', 40, 1400, 110)) };
        const st = { mode: 'campaign', battleId: 'DEBUG_BIG', battleNodeId: 1, attackers: [atk], defenders: [def] };
        try { store.$patch({ tacticalState: st }); } catch (e) { store.tacticalState = st; }
        store.strategicPaused = false;
        store.pendingArrival = null;
        store.pendingPostBattle = null;
        store.gameOver = false;
        store.isWin = false;
        store.isPaused = false;
        store.gameState = 'game';
        return 'ok atk=' + atk.slots.length + ' def=' + def.slots.length;
      } catch (e) { return 'err ' + e.message; }
    })()`;
    console.log('# 注入战役状态 ⇒', await cdp.evaluate(inject));
    await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { timeoutMs: 30000, label: '战场 canvas' });
    await new Promise((r) => setTimeout(r, 2500));
    const mode = await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene;
      return bs ? { entry: !!bs.entryPhase, paused: !!(bs.store && bs.store.isPaused), fleets: (bs.globalFleets||[]).length, sizes: (bs.globalFleets||[]).map(f => (f.units||[]).length) } : null;
    })()`);
    console.log('# 战场状态', JSON.stringify(mode));

    await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay.battleScene;
      window.__shape = { samples: [], startedAt: performance.now(), done: false };
      const R = (v, n = 2) => (typeof v === 'number' && Number.isFinite(v)) ? +v.toFixed(n) : null;
      const tick = () => {
        const S = window.__shape;
        const now = performance.now();
        if (S.samples.length >= 300 || now - S.startedAt > ${SEC * 1000}) { S.done = true; return; }
        const fleets = (bs.globalFleets || []).filter(f => (f.units || []).length >= 3);
        for (const f of fleets) {
          const us = (f.units || []).filter(u => u && u.sprite && (u.formationSlot ?? -1) >= 0);
          if (us.length < 3) continue;
          const facing = (typeof f.formFacing === 'number') ? f.formFacing
                       : (typeof f.facingSmooth === 'number') ? f.facingSmooth
                       : (typeof f.facingAngle === 'number') ? f.facingAngle : 0;
          let alongMin = 1e9, alongMax = -1e9, latMin = 1e9, latMax = -1e9;
          const items = [];
          const offs = f._formOffsets || null;
          const sp = (typeof f._formSpacing === 'number') ? f._formSpacing : 26;
          let devMax = 0;
          for (const u of us) {
            const dx = u.sprite.x - f.x, dy = u.sprite.y - f.y;
            const along = dx * Math.cos(facing) + dy * Math.sin(facing);
            const lat = -dx * Math.sin(facing) + dy * Math.cos(facing);
            if (along < alongMin) alongMin = along;
            if (along > alongMax) alongMax = along;
            if (lat < latMin) latMin = lat;
            if (lat > latMax) latMax = lat;
            let dev = null, cell = null;
            if (offs) {
              const c = offs[u.formationSlot];
              if (c) {
                cell = c;
                const ex = c[0] * sp, ey = c[1] * sp;
                dev = Math.hypot(dx - (ex * Math.cos(facing) - ey * Math.sin(facing)),
                                 dy - (ex * Math.sin(facing) + ey * Math.cos(facing)));
                if (dev > devMax) devMax = dev;
              } else { cell = '∅'; dev = -1; }
            }
            items.push({ s: u.formationSlot, a: R(along), l: R(lat), d: R(dev), c: cell === '∅' ? '∅' : (cell ? cell[0] + ',' + cell[1] : null) });
          }
          items.sort((a, b) => a.a - b.a);
          const gaps = [];
          for (let i = 1; i < items.length; i++) gaps.push(+(items[i].a - items[i - 1].a).toFixed(1));
          gaps.sort((x, y) => y - x);
          const fac = (bs.factionMap && bs.factionMap.get(f.factionId)) || null;
          S.samples.push({
            t: +(now - S.startedAt).toFixed(0),
            id: String(f.id).slice(0, 8),
            side: fac && fac.type === 'player' ? 'P' : 'E',
            n: us.length, form: String(f.formation || '?'),
            face: R(facing * 180 / Math.PI, 1),
            entry: !!bs.entryPhase, paused: !!(bs.store && bs.store.isPaused),
            aSpan: R(alongMax - alongMin), lSpan: R(latMax - latMin),
            ratio: R((latMax - latMin) / Math.max(1, alongMax - alongMin), 3),
            devMax: R(devMax),
            devBad: items.filter(it => it.d != null && it.d > 25).length,
            ringN: items.filter(it => it.c === '∅').length,
            topGaps: gaps.slice(0, 3),
            head: items.slice(0, 3).map(it => it.a + '/' + it.l),
            tail: items.slice(-3).map(it => it.a + '/' + it.l),
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`);

    await new Promise((r) => setTimeout(r, 2500));
    await cdp.evaluate(`(() => { const bs = window.__b3dOverlay.battleScene; if (bs) { bs.entryPhase = false; bs.store.isPaused = false; } })()`);
    console.log('# 已强制解除入场暂停');

    const shotAt = async (ms, name) => {
      await new Promise((r) => setTimeout(r, ms));
      try {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, '..', name), Buffer.from(shot.data, 'base64'));
        console.log(`# 截屏 ${name}`);
      } catch (e) { console.log(`# 截屏失败 ${name}: ${e.message}`); }
    };
    await shotAt(1500, '_fresh_camp_entry.png');
    await shotAt(6000, '_fresh_camp_live.png');

    const t0 = Date.now();
    while (Date.now() - t0 < SEC * 1000 + 5000) {
      if (await cdp.evaluate(`!!(window.__shape && window.__shape.done)`)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const payload = await cdp.evaluate(`JSON.stringify(window.__shape)`);
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const samples = data.samples || [];
    console.log(`\n# 采样数：${samples.length}`);
    const byId = new Map();
    for (const s of samples) { const cur = byId.get(s.id); if (!cur || s.t > cur.t) byId.set(s.id, s); }
    const rows = [...byId.values()].sort((a, b) => b.n - a.n);
    console.log('\nside id        n   form    face  aSpan lSpan ratio  devMax bad ring topGaps       判定');
    for (const last of rows) {
      const flags = [];
      if (last.devMax > 40) flags.push(`偏差${last.devMax}`);
      if (last.ringN > 0) flags.push(`ring${last.ringN}`);
      if (last.topGaps[0] > 60) flags.push(`空隙${last.topGaps[0]}`);
      if (last.topGaps[0] > 2 * Math.max(1, last.topGaps[2])) flags.push('间隙不均');
      console.log(
        `${last.side}    ${String(last.id).padEnd(8)} ${String(last.n).padStart(3)}  ${String(last.form).padEnd(7)} ` +
        `${String(last.face).padStart(5)} ${String(last.aSpan).padStart(5)} ${String(last.lSpan).padStart(5)} ` +
        `${String(last.ratio).padStart(5)} ${String(last.devMax).padStart(6)}  ${String(last.devBad).padStart(3)} ` +
        `${String(last.ringN).padStart(3)} [${last.topGaps.join(',')}]  ` + (flags.length ? '⚠ ' + flags.join('｜') : '✓'));
      if (flags.length) console.log(`     head=${last.head.join(' ')} tail=${last.tail.join(' ')}`);
    }
  } finally {
    await close().catch(() => {});
  }
})();
