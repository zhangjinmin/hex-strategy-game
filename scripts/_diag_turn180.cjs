/**
 * _diag_turn180.cjs — 「0→1 掉头 / 2→1 对射」一帧证伪探针（只读）
 *
 * 背景（已由代数确认，脚本用于在真机上把它钉死）：
 *   标准接近支：P = lead − idealDist·û，û = 我→敌
 *   ⇒ P − me = (d − idealDist)·û
 *   ⇒ d > idealDist 时目标在前（舰首 0°）；d < idealDist 时目标在**正后方**（舰首 180°）。
 *   `_mPhase 0→1` 的进入线是 d < 0.70·idealDist，必然已 < idealDist
 *   ⇒ 若在 `_mPhase===1` 的停船帧里看到 dot < 0，就证明它是 **0→1 路径（180°）**；
 *     全部 dot > 0 则是 **2→1 路径（`_backing` 已把舰首钉在敌向，0°）**。
 *
 * 纪律：
 *   · 只读。不改任何 `frontend/**` 源码、不写游戏状态、不提交。
 *   · 不手抄常量：离线部分用 `require` 加载真源码算阈值；在线部分只读运行时字段。
 *   · 判据只用两个可观测量：dot 的符号、|wrap(敌方位 − facingSmooth)|。
 *
 * 运行（两种模式）：
 *   1) 离线：打印当前射程下的阶段阈值 + 说明（不需要 dev server）
 *        node --import ./_ts_resolve.mjs scripts/_diag_turn180.cjs
 *   2) 真机：连 dev server（默认 http://127.0.0.1:5200）采样 15s
 *        node --import ./_ts_resolve.mjs scripts/_diag_turn180.cjs --live
 *      可选：--live --url http://127.0.0.1:5200 --sec 20 --out _diag_turn180.json
 *
 * 读到的运行时字段（真机）：
 *   f.x / f.y                   舰队中心
 *   f.facingSmooth / facingAngle 舰首（渲染真源 / 上一次移动目标方向）
 *   f.state / f.stance / f._mPhase / f._flankPhase / f._maneuverRole
 *   f.directOrder?.kind          'move' | 'attack' | null（有直接指令时运动目标被覆盖，单独分组）
 *   f._dbg.tx / ty              本帧最终站位目标（已含权威覆盖 / 看门狗 override）
 *   f._dbg.ex / ey              本帧交战对象（closestEnemyFleet）
 *   f._dbg.mfd / idl            minFleetDist / idealEngageDist
 *   f._dbg.eng                  是否在交战态（isEngaging）
 *   f._stall?.weaponsFired      当前停滞窗口内是否开过火
 *   ⚠ FIX-⑫ 的 _dbg.fa/fs/dt/bow 不属于稳定字段，本脚本**不依赖**它们。
 *
 * 判据（印在输出里）：
 *   dot = (tx−x)·(ex−x) + (ty−y)·(ey−y)
 *     dot < 0 ⇒ 站位目标在**敌舰的反方向**（身后）
 *       · **C 修好之前**：这等价于 0→1 路径 ⇒ 舰首会被带到 180°
 *       · **C 修好之后**：倒退时目标本来就该在身后，此时 dot<0 是**预期**，
 *         判据改用 bowOff（倒退通道应让舰首仍朝敌）
 *     dot > 0 ⇒ 站位目标在**敌舰同侧**（前方）⇒ 2→1 路径 ⇒ 0° 对射
 *   bowOff = |wrap(atan2(ey−y, ex−x) − facingSmooth)|
 *     ≥ 90° ⇒ 舷侧/尾对（超出 ±75.6° 火弧 ⇒ 不能开火）
 *   ⇒ 结论口径：**修前看 dot，修后看 bowOff**；两者本脚本都会打印。
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const WRAP = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = (r) => (r * 180) / Math.PI;
const round = (v, n = 1) => (Number.isFinite(v) ? +v.toFixed(n) : null);

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const argOf = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const LIVE = has('--live');
const URL = argOf('--url', 'http://127.0.0.1:5200/index.html');
const SEC = Math.max(5, Number(argOf('--sec', '15')) || 15);
const OUT = argOf('--out', '');
const MAX_RANGE = Number(argOf('--range', '880')) || 880;   // 战列主炮射程（仅离线阈值用）
// ⚠ 下面两个都是**本探针的输入**，不是游戏常量：
//   · span    = 地图有效跨度（1v1 时 hexRadius=26 ⇒ 26×50=1300，见 combatPhase 注释）
//   · maxRange= 战列主炮射程（示例 880，实际以 gameData 为准）
//   判据全部按 `idealDist` 的比例表达，换图/换舰种不需要改脚本。
const SPAN = Number(argOf('--span', '1300')) || 1300;

// ── 离线：加载真源码（禁手抄常量）────────────────────────────────────────
function loadRealSource() {
  // 说明：这些模块是纯函数、零 Phaser 依赖，可直接在 Node 下 require。
  const combatPhase = require(path.join(__dirname, '../frontend/src/game/combatPhase.ts'));
  const aiDirector = require(path.join(__dirname, '../frontend/src/game/aiDirector.ts'));
  return {
    phaseThresholdsFrom: combatPhase.phaseThresholdsFrom,
    phaseTargetDist: combatPhase.phaseTargetDist,
    idealEngageDistFrom: aiDirector.idealEngageDistFrom,
    strikeRangeFrom: aiDirector.strikeRangeFrom,
  };
}

function offline(src) {
  console.log('\n=== A. 离线：阶段阈值（真源码计算，绝对值为当前射程下的示例）===');
  console.log(`输入：maxRange=${MAX_RANGE}px（--range 可改；这不是游戏常量，只是本探针的示例射程）`);

  // 阶段阈值依赖 span 与 maxRange。span 取 1v1 的 hexRadius=26 × 50 = 1300（--span 可改）。
  // ⚠ 只用于把比例翻译成人话；判据全部按 idealDist 的比例表达。
  const span = SPAN;
  const t = src.phaseThresholdsFrom(span, MAX_RANGE);
  const idealFar = src.phaseTargetDist('far', t);
  console.log(
    `span=${span} ⇒ far=${t.far} / approach=${t.approach} / assault=${t.assault} / brawl=${t.brawl}`,
  );
  console.log(
    `_mPhase 阈值（相对 ideal=far=${idealFar}）：` +
    `dIn=${(0.35).toFixed(2)}·ideal / dOut=${(0.5).toFixed(2)}·ideal / ` +
    `eIn=${(0.70).toFixed(2)}·ideal / eOut=${(0.85).toFixed(2)}·ideal`,
  );

  console.log('\n=== B. 离线：标准接近支的 dot 符号（代数，不是模拟）===');
  console.log('P = lead − ideal·û  ⇒  dot(P−me, E−me) 的符号 = sign(d − ideal)');
  console.log(' d/ideal |  dot 符号  | 目标相对敌舰 | 舰首意向 | 说明');
  for (const r of [1.20, 1.05, 1.00, 0.95, 0.85, 0.70, 0.50, 0.35]) {
    const sign = r > 1 ? '+' : r < 1 ? '−' : '0';
    const rel = r > 1 ? '前方' : r < 1 ? '正后方' : '重合';
    const bow = r > 1 ? '0°（朝敌）' : r < 1 ? '180°（背敌）' : '不定';
    const note = r < 0.70 ? '★ 0→1 进入线以内' : r === 0.70 ? '0→1 进入线' : '';
    console.log(
      `  ${r.toFixed(2)}  |     ${sign}      |   ${rel.padEnd(4)}   | ${bow.padEnd(10)} | ${note}`,
    );
  }
  console.log(
    '\n⇒ 结论：任何 d < ideal 的帧，标准接近支都会把目标放到正后方；' +
    '\n   `_mPhase 0→1` 只能发生在 d < 0.70·ideal ⇒ 必然是 180° 路径。' +
    '\n   真机验证见 --live：在 `_mPhase===1` 的停船帧统计 dot 的符号。\n',
  );
}

// ── 在线：CDP 采样 ──────────────────────────────────────────────────────
async function live() {
  const probeUrl = pathToFileURL(path.join(__dirname, '../_browser_probe.mjs')).href;
  const { launch, navigate, waitFor } = await import(probeUrl);
  const { cdp, close } = await launch();
  try {
    console.log(`# 打开 ${URL}`);
    await navigate(cdp, URL);
    await waitFor(cdp, `document.body.innerText.includes('战术模拟')`, { label: '主菜单', timeoutMs: 30000 });

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
        await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      }
    };

    const clickXY = async (x, y) => {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
    };
    const clickSelector = async (sel) => {
      const p = await cdp.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!p) throw new Error(`找不到可点击元素：${sel}`);
      await clickXY(p.x, p.y);
    };

    await clickText('战术模拟');
    await waitFor(cdp, `document.body.innerText.includes('前线出战序列')`, { label: '设置页' });
    await clickSelector('.dispatch-slot');
    await waitFor(cdp, `document.body.innerText.includes('调度现役将领')`, { label: '提督弹窗' });
    await clickText('莱因哈特');
    await new Promise((r) => setTimeout(r, 800));
    await clickSelector('.btn-launch-game');
    await waitFor(cdp, `document.querySelectorAll('canvas').length > 0`, { label: '战场', timeoutMs: 60000 });

    // 开战：点击画布 + Enter（部署期 Enter = 开战），最多 6 次
    const hook = `(() => { const bs = window.__b3dOverlay && window.__b3dOverlay.battleScene; return !!(bs && bs.tilesList && bs.tilesList.length > 0); })()`;
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: 800, y: 400, button: 'left', clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, 300));
      await pressEnter();
      try { await waitFor(cdp, hook, { timeoutMs: 8000, intervalMs: 400, label: 'tilesList' }); ok = true; } catch { /* retry */ }
    }
    if (!ok) throw new Error('未能进入战场（tilesList 一直为空）');

    console.log(`# 开战成功，采样 ${SEC}s（rAF 页面内累积，避免 CDP 往返混叠）`);
    await cdp.evaluate(`(() => {
      const bs = window.__b3dOverlay.battleScene;
      window.__diagTurn180 = { frames: [], startedAt: performance.now(), done: false };
      const R = (v, n = 3) => (typeof v === 'number' && Number.isFinite(v)) ? +v.toFixed(n) : null;
      const tick = () => {
        const S = window.__diagTurn180;
        if (S.frames.length >= 20000 || performance.now() - S.startedAt > ${SEC * 1000}) { S.done = true; return; }
        const alive = (bs.globalFleets || []).filter(f => (f.units || []).some(u => u && u.hp > 0));
        for (const f of alive) {
          const d = f._dbg || {};
          if (d.tx == null || d.ex == null) continue;          // 本帧没有目标解算
          const vx = d.tx - f.x, vy = d.ty - f.y;              // 我 → 站位目标
          const ex = d.ex - f.x, ey = d.ey - f.y;              // 我 → 敌
          const dt = Math.hypot(vx, vy);                       // 到站位目标
          const mfd = Math.hypot(ex, ey);
          const dot = vx * ex + vy * ey;                       // <0 ⇒ 目标在身后
          const bow = Math.atan2(ey, ex);
          const fs = (typeof f.facingSmooth === 'number') ? f.facingSmooth
                   : (typeof f.facingAngle === 'number') ? f.facingAngle : null;
          S.frames.push({
            t: +(performance.now() - S.startedAt).toFixed(0),
            id: String(f.id).slice(0, 8),
            st: f.state || null,
            stance: f.stance || null,
            role: f._maneuverRole || null,
            mp: (typeof f._mPhase === 'number') ? f._mPhase : null,
            fp: (typeof f._flankPhase === 'number') ? f._flankPhase : null,
            order: f.directOrder ? (f.directOrder.kind || 'direct') : null,
            eng: d.eng === 1 ? 1 : 0,
            fired: (f._stall && f._stall.weaponsFired === true) ? 1 : 0,
            x: R(f.x), y: R(f.y),
            dt: R(dt), mfd: R(mfd), dot: R(dot, 6),
            bowOffDeg: fs == null ? null : R(Math.abs(DEG(WRAP(bow - fs))), 1),
            dOverIdeal: (typeof d.idl === 'number' && d.idl > 0) ? R(mfd / d.idl, 4) : null,
            tx: R(d.tx), ty: R(d.ty), ex: R(d.ex), ey: R(d.ey),
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`);

    // 等待采样结束
    const t0 = Date.now();
    while (Date.now() - t0 < SEC * 1000 + 8000) {
      const done = await cdp.evaluate(`!!(window.__diagTurn180 && window.__diagTurn180.done)`);
      if (done) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const payload = await cdp.evaluate(`JSON.stringify(window.__diagTurn180)`);
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const frames = (data && data.frames) || [];
    console.log(`# 采样帧数：${frames.length}`);
    analyze(frames);
    if (OUT) {
      fs.writeFileSync(path.resolve(process.cwd(), OUT), JSON.stringify(frames, null, 0));
      console.log(`# 原始帧已写入 ${OUT}`);
    }
  } finally {
    await close();
  }
}

// ── 分析 ────────────────────────────────────────────────────────────────
function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function analyze(frames) {
  console.log('\n=== C. 真机判据 ===');
  console.log('dot = (tx−x)·(ex−x) + (ty−y)·(ey−y)');
  console.log('  dot < 0 ⇒ 站位目标在敌舰**反方向**（身后）⇒ 0→1 路径 ⇒ 180° 掉头');
  console.log('  dot > 0 ⇒ 站位目标在敌舰同侧（前方）  ⇒ 2→1 路径 ⇒ 0° 对射');
  console.log('bowOff = |wrap(敌方位 − facingSmooth)|；≥90° 即舷侧/尾对（超出 ±75.6° 火弧）\n');

  const byFleet = new Map();
  for (const f of frames) {
    if (!byFleet.has(f.id)) byFleet.set(f.id, []);
    byFleet.get(f.id).push(f);
  }

  let verdict = 'NO-DATA';
  const bump = (v) => { if (verdict === 'NO-DATA' || verdict === 'INCONCLUSIVE') verdict = v; };

  for (const [id, F] of byFleet) {
    const direct = F.filter((f) => f.order != null);
    const branch = F.filter((f) => f.order == null);
    // 只看"停船且 _mPhase===1"的帧 —— 这正是 lead 要判的那一帧
    const stopP1 = branch.filter((f) => f.mp === 1 && f.dt != null && f.dt <= 5);
    const flightP1 = branch.filter((f) => f.mp === 1 && f.dt != null && f.dt > 5);
    const behind = stopP1.filter((f) => f.dot != null && f.dot < 0);
    const ahead = stopP1.filter((f) => f.dot != null && f.dot > 0);
    const bows = stopP1.map((f) => f.bowOffDeg).filter((v) => typeof v === 'number');

    console.log(`--- fleet ${id} | frames=${F.length} branch=${branch.length} direct=${direct.length} ---`);
    if (direct.length) {
      const od = [...new Set(direct.map((f) => f.order))].join('/');
      console.log(`  ⚠ 有直接指令（${od}）：运动目标被 :7771 覆盖，下列分支判据**已排除**这些帧。`);
    }
    console.log(`  _mPhase=1 停船帧：${stopP1.length}（dot<0: ${behind.length} / dot>0: ${ahead.length}）`);
    console.log(`  _mPhase=1 飞行帧：${flightP1.length}`);
    if (bows.length) {
      console.log(
        `  bowOff（停船帧）：p50=${pct(bows, 0.5)}° p90=${pct(bows, 0.9)}° max=${Math.max(...bows)}°`,
      );
      const bad = bows.filter((v) => v >= 90).length;
      console.log(`  bowOff ≥ 90°（舷侧/尾对，打不出）：${bad}/${bows.length}`);
    }
    if (stopP1.length) {
      if (behind.length > 0) {
        console.log('  ⇒ 判定：**0→1 路径（180°）** —— 停船时站位目标在敌舰身后。');
        bump('0to1-180');
      } else if (ahead.length > 0) {
        console.log('  ⇒ 判定：**2→1 路径（0°）** —— 停船时站位目标在敌舰同侧（`_backing` 已把舰首钉在敌向）。');
        bump('2to1-0');
      }
    }

    // 首次 dot 由正转负的时间点（180° 指令的触发帧）
    let prev = null;
    for (const f of branch) {
      if (f.mp !== 1 || f.dot == null) { prev = f; continue; }
      if (prev && prev.dot != null && prev.dot > 0 && f.dot < 0) {
        console.log(
          `  ↳ 首次 dot>0→<0 @t=${f.t}ms：d/ideal=${f.dOverIdeal} dt=${f.dt} bowOff=${f.bowOffDeg}°` +
          `（此后若 bowOff→180°，即为飞行段掉头）`,
        );
        break;
      }
      prev = f;
    }
  }

  console.log(`\n=== D. 总结：${verdict} ===`);
  if (verdict === '0to1-180') {
    console.log('  ⇒ 0→1 路径成立：`_mPhase 0→1` 的停船帧里目标在身后。');
    console.log('  ⇒ 修法挂 C：`d<ideal` 时不要生成身后 waypoint，改倒退通道 + 死区。');
    console.log('  ⇒ **C 修好后的验收要改口径**：倒退时 dot<0 是预期的，');
    console.log('     判据改为 `bowOff（停船/倒退帧）p95 ≤ 45°、max < 60°`。');
  } else if (verdict === '2to1-0') {
    console.log('  ⇒ 只见 2→1：`_backing` 已把舰首钉在敌向；舷侧应另找来源（包抄支 / move 令 / 停船未回瞄）。');
  } else {
    console.log('  ⇒ 没有采到 `_mPhase===1` 的停船帧：可能未接敌 / 全被直接指令覆盖 / 采样太短。');
    console.log('     先确认舰队进入 engaging 且有 closestEnemyFleet，再重跑；或加 --sec 30。');
  }
}

// ── main ────────────────────────────────────────────────────────────────
(async () => {
  let src;
  try {
    src = loadRealSource();
  } catch (e) {
    console.error('[warn] 无法加载真源码（离线阈值部分跳过）：', e && e.message);
    src = null;
  }
  if (src) offline(src);
  if (LIVE) {
    await live();
  } else {
    console.log('（未加 --live：只跑了离线阈值。真机判据请加 --live）\n');
  }
})().catch((e) => {
  console.error('[diag_turn180] 失败：', e && e.stack || e);
  process.exitCode = 1;
});
