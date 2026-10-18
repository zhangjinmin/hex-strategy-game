/**
 * standoffOrderSim.cjs — StandoffOrder 纯函数台架（15 条断言 + 迁移表）
 *
 * 运行：
 *   node --import ./_ts_resolve.mjs scripts/standoffOrderSim.cjs
 *
 * 纪律：
 *   · `require` 真源码（禁手抄算法/常量）；本文件只做输入/断言/打印。
 *   · 距离一律写成 `比例 × idealDist`（I = 1000 只是台架里的"单位 1"，
 *     不是游戏常量；任何绝对值都不参与断言）。
 *
 * 变异测试（手工两步，改完必须还原）：
 *   ① 把模块里的 `deadband` 参与计算改成 0（并去掉 `deadband<=0` 拒绝）
 *      ⇒ 预期至少 3 条红：断言 2 / 3 / 9 / 11（实测 4 条）。
 *   ② 把 `prev === 'reverse' / 'approach'` 两段滞回删掉，改成
 *      "err > 0 ⇒ approach，err < 0 ⇒ reverse" 的纯符号规则
 *      ⇒ 预期断言 5 / 10 红（实测另有断言 3 红）。
 *   变异输出见交付说明；最终提交的是未变异版本。
 */
'use strict';

const assert = require('node:assert/strict');
const { resolveStandoffOrder, STANDOFF_REASONS } = require('../frontend/src/game/battle/StandoffOrder.ts');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}\n         ${error.message}\n`);
    process.exitCode = 1;
  }
}

// ── 台架单位：I = 1 个 idealDist ───────────────────────────────────────────
const I = 1000;
const DB = 0.05 * I; // 死区 = 5% idealDist（调用方口径的示例，不是模块常量）
const half = DB / 2;
const at = (ratio, prevKind, deadband = DB) => resolveStandoffOrder({
  d: ratio * I, idealDist: I, deadband, prevKind,
});

console.log('\n=== StandoffOrder：三态判定 ===');

check('1. d 远大于 ideal（1.20i），上一帧 approach ⇒ approach + 舰首=运动方向', () => {
  const r = at(1.20, 'approach');
  assert.equal(r.kind, 'approach');
  assert.equal(r.facingIntent, 'motion');
  assert.equal(r.reason, STANDOFF_REASONS.beyondIdeal);
});

check('2. 从 approach 回到 ideal（1.00i）⇒ hold + 舰首=敌向（进入死区）', () => {
  const r = at(1.00, 'approach');
  assert.equal(r.kind, 'hold');
  assert.equal(r.facingIntent, 'enemy');
  assert.equal(r.reason, STANDOFF_REASONS.holdExitHysteresis);
});

check('3. 在死区内（0.95i，|err| = deadband）⇒ hold（边界不翻成 reverse）', () => {
  const r = at(0.95, 'hold');
  assert.equal(r.kind, 'hold');
  assert.equal(r.facingIntent, 'enemy');
});

check('4. 超出死区（0.90i）⇒ reverse，但舰首仍=敌向', () => {
  const r = at(0.90, 'hold');
  assert.equal(r.kind, 'reverse');
  assert.equal(r.facingIntent, 'enemy');
  assert.equal(r.reason, STANDOFF_REASONS.tooClose);
});

check('5. 从 reverse 回到 0.98i（仍在半带内）⇒ hold，不得跳 approach', () => {
  const r = at(0.98, 'reverse');
  assert.equal(r.kind, 'hold');
  assert.equal(r.facingIntent, 'enemy');
  assert.notEqual(r.kind, 'approach');
});

check('6. 从 reverse 仍在 0.90i ⇒ 保持 reverse（滞回保持）', () => {
  const r = at(0.90, 'reverse');
  assert.equal(r.kind, 'reverse');
  assert.equal(r.facingIntent, 'enemy');
});

check('7. 非法输入：deadband<=0 / NaN / ideal<=0 / d<0 ⇒ 确定退化为 hold', () => {
  const cases = [
    { input: { d: I, idealDist: I, deadband: 0, prevKind: null }, reason: STANDOFF_REASONS.invalidDeadband },
    { input: { d: I, idealDist: I, deadband: -1, prevKind: null }, reason: STANDOFF_REASONS.invalidDeadband },
    { input: { d: I, idealDist: I, deadband: NaN, prevKind: null }, reason: STANDOFF_REASONS.invalidDeadband },
    { input: { d: I, idealDist: 0, deadband: DB, prevKind: null }, reason: STANDOFF_REASONS.invalidInput },
    { input: { d: NaN, idealDist: I, deadband: DB, prevKind: null }, reason: STANDOFF_REASONS.invalidInput },
    { input: { d: -5, idealDist: I, deadband: DB, prevKind: null }, reason: STANDOFF_REASONS.invalidInput },
  ];
  for (const c of cases) {
    const r = resolveStandoffOrder(c.input);
    assert.equal(r.kind, 'hold', `input=${JSON.stringify(c.input)} 应退化为 hold`);
    assert.equal(r.facingIntent, 'enemy');
    assert.equal(r.reason, c.reason);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  }
});

check('8. 600 帧下扫 + 上扫（1.5i→0.2i→1.5i，步长 0.005i）：迁移 ≤4，且 |err|<half 时不得 reverse', () => {
  let prev = null;
  let transitions = 0;
  let last = null;
  const step = 0.005 * I;
  const leg = () => {
    for (let d = 1.5 * I; d >= 0.2 * I; d -= step) {
      const r = resolveStandoffOrder({ d, idealDist: I, deadband: DB, prevKind: prev });
      const err = d - I;
      if (Math.abs(err) < half) {
        assert.notEqual(r.kind, 'reverse', `d/ideal=${(d / I).toFixed(3)} 在半带内不应 reverse`);
      }
      if (last !== null && r.kind !== last) transitions += 1;
      last = r.kind;
      prev = r.kind;
    }
    for (let d = 0.2 * I; d <= 1.5 * I; d += step) {
      const r = resolveStandoffOrder({ d, idealDist: I, deadband: DB, prevKind: prev });
      const err = d - I;
      if (Math.abs(err) < half) {
        assert.notEqual(r.kind, 'reverse', `d/ideal=${(d / I).toFixed(3)} 在半带内不应 reverse`);
      }
      if (last !== null && r.kind !== last) transitions += 1;
      last = r.kind;
      prev = r.kind;
    }
  };
  leg();
  assert.ok(transitions <= 4, `迁移次数=${transitions}（应 ≤4）`);
});

check('9. d 略小于 ideal（0.98i，无记忆）⇒ hold + 舰首必须=敌向', () => {
  const r = at(0.98, null);
  assert.equal(r.kind, 'hold');
  assert.equal(r.facingIntent, 'enemy');
});

check('10. reverse 回到 ideal 之上但仍在滞回带（1.02i）⇒ hold，不得跳 approach', () => {
  const r = at(1.02, 'reverse');
  assert.equal(r.kind, 'hold');
  assert.equal(r.facingIntent, 'enemy');
  assert.notEqual(r.kind, 'approach');
});

check('11. 2000 帧 sweep（1.5i→0.2i→1.5i）：迁移 ≤6，且 |err|<half 时不得 reverse', () => {
  const frames = 2000;
  const down = frames / 2;
  const step = (1.5 - 0.2) / down; // ≈0.0013i/帧（按 2000 帧均分）
  let prev = null;
  let last = null;
  let transitions = 0;
  const feed = (ratio) => {
    const d = ratio * I;
    const r = resolveStandoffOrder({ d, idealDist: I, deadband: DB, prevKind: prev });
    const err = d - I;
    if (Math.abs(err) < half) {
      assert.notEqual(r.kind, 'reverse', `d/ideal=${ratio.toFixed(4)} 在半带内不应 reverse`);
    }
    if (last !== null && r.kind !== last) transitions += 1;
    last = r.kind;
    prev = r.kind;
  };
  for (let i = 0; i < down; i++) feed(1.5 - step * i);
  for (let i = 0; i < down; i++) feed(0.2 + step * i);
  assert.ok(transitions <= 6, `迁移次数=${transitions}（应 ≤6）`);
});

check('12. |err| 在带内 + forceReverse ⇒ reverse（强制优先于 hold）', () => {
  const r = resolveStandoffOrder({
    d: 1.00 * I, idealDist: I, deadband: DB, prevKind: 'hold', forceReverse: true,
  });
  assert.equal(r.kind, 'reverse');
  assert.equal(r.facingIntent, 'enemy');
  assert.equal(r.reason, STANDOFF_REASONS.forcedReverse);
});

check('13. err > +deadband + forceReverse ⇒ 仍 reverse（强制压过 approach）', () => {
  const r = resolveStandoffOrder({
    d: 1.20 * I, idealDist: I, deadband: DB, prevKind: 'approach', forceReverse: true,
  });
  assert.equal(r.kind, 'reverse');
  assert.equal(r.facingIntent, 'enemy');
  assert.equal(r.reason, STANDOFF_REASONS.forcedReverse);
});

check('14. 不传 forceReverse 与传 false：同一组输入结果全等（防默认路径被顺带改掉）', () => {
  const prevs = [null, 'approach', 'hold', 'reverse'];
  const deadbands = [20, DB, 80];
  let n = 0;
  for (let ratio = 0.20; ratio <= 1.50 + 1e-9; ratio += 0.01) {
    const d = ratio * I;
    for (const prevKind of prevs) {
      for (const deadband of deadbands) {
        const base = { d, idealDist: I, deadband, prevKind };
        assert.deepEqual(
          resolveStandoffOrder({ ...base, forceReverse: false }),
          resolveStandoffOrder(base),
          `d/ideal=${ratio.toFixed(2)} prev=${prevKind} db=${deadband}：false 与不传必须全等`,
        );
        n += 1;
      }
    }
  }
  assert.ok(n > 1000, `样本数=${n}（应覆盖全比例段）`);
});

check('15. 非法入参优先于 forceReverse：deadband<=0 / d=NaN 不得被强制掩盖', () => {
  const badDb = resolveStandoffOrder({
    d: 1.00 * I, idealDist: I, deadband: 0, prevKind: null, forceReverse: true,
  });
  assert.equal(badDb.kind, 'hold');
  assert.equal(badDb.reason, STANDOFF_REASONS.invalidDeadband);
  const badD = resolveStandoffOrder({
    d: NaN, idealDist: I, deadband: DB, prevKind: null, forceReverse: true,
  });
  assert.equal(badD.kind, 'hold');
  assert.equal(badD.reason, STANDOFF_REASONS.invalidInput);
});

// ── 人可读迁移表（1.20i → 0.85i，步长 0.01i）────────────────────────────
console.log('\n=== 迁移表（供肉眼复核：接近 → 悬停 → 倒车）===');
console.log(' d/ideal | err/deadband | kind     | facing | reason');
let prev = null;
for (let r = 1.20; r >= 0.85 - 1e-9; r -= 0.01) {
  const d = r * I;
  const out = resolveStandoffOrder({ d, idealDist: I, deadband: DB, prevKind: prev });
  const errDb = (d - I) / DB;
  console.log(
    `  ${r.toFixed(2)}   | ${errDb >= 0 ? '+' : ''}${errDb.toFixed(2).padStart(5)}      | ` +
    `${out.kind.padEnd(8)} | ${out.facingIntent.padEnd(6)} | ${out.reason}`,
  );
  prev = out.kind;
}

// 注意：汇总行刻意不用 "FAIL" 字样 —— `_run_all_sims.cjs` 用子串 "FAIL" 判红，
// 会把 "0 FAIL" 的绿色台架误判成 RED（fighterWavesSim 等已有同款误报）。
console.log(`\n=== 结果：PASS ${passed} / 未通过 ${failed} ===\n`);
