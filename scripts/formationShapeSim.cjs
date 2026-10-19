/**
 * formationShapeSim.cjs — 阵型**几何形状**台架（`config/formationLayout.ts`）
 *
 * 运行：node --import ./_ts_resolve.mjs scripts/formationShapeSim.cjs
 *
 * 为什么单独一个台架：本项目反复踩"阵型看起来不对"的坑，而根因每次都在几何层
 * （格线两套 / 余量堆末排 / 阵位越界）。这些错误**不会让任何现有断言变红** ——
 * 舰数对了、没重叠、位置也是"某个合法阵型"，只是形状读不出来。
 * ⇒ 这里把"读得出来"量化成三条硬指标：
 *   ① 格数 == 舰数（不多不少）
 *   ② 无重复格（不会两舰叠一格）
 *   ③ **楔形排宽必须等差**：单调不降，且相邻两排的宽度差 ≤ 2
 *      （差 3 就会在后缘形成一条平宽横杠 —— 用户实报的"梯形/长条"）
 */
'use strict';

const { formationOffsets } = require('../frontend/src/config/formationLayout.ts');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (e) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}: ${e.message}\n`);
    process.exitCode = 1;
  }
}

/** 按 gx 分组求每排宽度（gx 从 0 递减 = 由前到后）。 */
function rowWidths(offs) {
  const rows = new Map();
  for (const [gx] of offs) rows.set(gx, (rows.get(gx) || 0) + 1);
  return [...rows.keys()].sort((a, b) => b - a).map((k) => rows.get(k));
}

// ── ① ② 所有阵型：格数守恒 + 无重复 ─────────────────────────────────────
for (const f of ['wedge', 'line', 'spindle', 'circle', 'square']) {
  check(`${f}：各舰数下格数守恒且无重复格`, () => {
    for (let n = 1; n <= 90; n++) {
      const offs = formationOffsets(f, n);
      if (offs.length !== n) throw new Error(`n=${n} 得到 ${offs.length} 格`);
      const seen = new Set();
      for (const [x, y] of offs) {
        const k = `${x},${y}`;
        if (seen.has(k)) throw new Error(`n=${n} 重复格 ${k}`);
        seen.add(k);
      }
    }
  });
}

// ── ③ 楔形排宽等差（单调 + 跳变 ≤ 2）────────────────────────────────────
check('wedge：排宽单调不降（三角不能出现"中间收窄"）', () => {
  for (let n = 5; n <= 90; n++) {
    const w = rowWidths(formationOffsets('wedge', n));
    for (let i = 1; i < w.length; i++) {
      if (w[i] < w[i - 1]) throw new Error(`n=${n} 排宽下降 [${w.join(',')}]`);
    }
  }
});

check('wedge：相邻排宽差 ≤ 2（差 3 会形成后缘横杠 ⇒ 视觉上不成三角）', () => {
  for (let n = 5; n <= 90; n++) {
    const w = rowWidths(formationOffsets('wedge', n));
    for (let i = 1; i < w.length; i++) {
      const jump = w[i] - w[i - 1];
      if (jump > 2) throw new Error(`n=${n} 第 ${i} 排跳变 +${jump} [${w.join(',')}]`);
    }
  }
});

// ── 反例：确认上面两条断言真的咬得住（旧实现 n=24 ⇒ [1,3,5,6,9]）──────
check('反例：把排宽换成"余量全堆末排"的旧算法 ⇒ 断言必须失败', () => {
  const oldWedge = (n) => {
    const R = Math.max(1, Math.ceil(Math.sqrt(n)));
    const Wmax = (2 * n) / (R + 1);
    const w = [];
    for (let r = 0; r < R; r++) w.push(Math.max(1, Math.round((Wmax * (r + 1)) / R)));
    w[0] = 1;
    let sum = w.reduce((a, b) => a + b, 0);
    while (sum > n) {
      let trimmed = false;
      for (let r = R - 1; r >= 1 && sum > n; r--) {
        while (sum > n && w[r] > w[r - 1]) { w[r] -= 1; sum -= 1; trimmed = true; }
      }
      if (!trimmed) break;
    }
    if (sum < n) w[R - 1] += n - sum;   // ← 病灶
    return w;
  };
  const w = oldWedge(24);
  let worst = 0;
  for (let i = 1; i < w.length; i++) worst = Math.max(worst, w[i] - w[i - 1]);
  if (worst <= 2) throw new Error(`旧算法 n=24 竟未触发：${w.join(',')}`);
});

// ── 顺带打印关键样本，便于人工核对 ─────────────────────────────────────
process.stdout.write('\n样本（楔形排宽）：\n');
for (const n of [24, 33, 40, 60]) {
  process.stdout.write(`  n=${String(n).padStart(2)} ⇒ [${rowWidths(formationOffsets('wedge', n)).join(',')}]\n`);
}

process.stdout.write(`\n=== 结果：PASS ${passed} / 未通过 ${failed} ===\n\n`);
