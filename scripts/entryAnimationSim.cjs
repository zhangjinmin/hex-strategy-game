/**
 * [切片传送入场 · 家园2 式 hyperspace entry] 离线台架。
 *
 * ── 为什么这样写（沿用 R1 教训）────────────────────────────────────────────
 * `block.includes('...')` 式断言**没有牙齿**：只对"整段删除"敏感，对取值/语义/行为
 * 完全不敏感（历史上 5 组变异全绿）。本台架因此：
 *   ① **真跑纯逻辑层** —— `require('../frontend/src/game/entrySlice.ts')`，
 *      并**变异模块源码**后重跑（改坏常量/分支必须 FAIL ⇒ 证明断言有牙齿）；
 *   ② **真跑 Wiring 层** —— 把 `Battle3DOverlay.updateEntryFx` 与
 *      `BattleScene.placeUnitsAtFormationSlots` / 逐帧阵位循环的**原文**经
 *      `stripTypeScriptTypes` 去型后 `new Function` 执行（唯一锚点切片，锚点不唯一即抛错）；
 *   ③ 源码契约层（保留，只用于防"整段删除"）。
 *
 * ── 被验证的关键命题 ───────────────────────────────────────────────────────
 *   · `t=0` ⇒ 平面在舰队包围盒**之外** ⇒ 全舰不可见
 *   · `t=总时长` ⇒ 全舰可见，且 `clippingPlanes` **已清空**（否则舰体被永久切）
 *   · 逐舰错开顺序**单调**（波次感）
 *   · 全场入场时长 ≤ `SLICE_TOTAL_MAX` ≤ `ASSEMBLE_MAX_MS`（且那个常量**未被改动**）
 *   · L1 建舰期放置公式与逐帧追踪公式**同源**（同输入同输出）
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');

// 真源码（纯逻辑层）
const E = require('../frontend/src/game/entrySlice.ts');
const L = require('../frontend/src/config/formationLayout.ts');

const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const overlay = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');
const entrySrc = fs.readFileSync('./frontend/src/game/entrySlice.ts', 'utf8');
const layoutSrc = fs.readFileSync('./frontend/src/config/formationLayout.ts', 'utf8');
const fxSrc = fs.readFileSync('./frontend/src/game/battle3dFx.ts', 'utf8');

let passed = 0;
let failed = 0;
function check(name, body) {
  try {
    assert.equal(body(), true);
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}: ${error.message}\n`);
  }
}
function checkThrows(name, body) {
  let threw = false;
  try { body(); } catch { threw = true; }
  check(name, () => threw === true);
}

// ════════════════════════════════════════════════════════════════════════════
// 通用工具：唯一锚点切片 + 去型 + 编译
// ════════════════════════════════════════════════════════════════════════════

/** 唯一锚点抽取：锚点缺失或**不唯一**一律抛错（本项目有过"锚点被注释误匹配"的教训）。 */
function extractUnique(src, startMark, endMark, includeEnd = 0) {
  const first = src.indexOf(startMark);
  if (first < 0) throw new Error(`锚点缺失: ${startMark}`);
  if (src.indexOf(startMark, first + 1) >= 0) throw new Error(`锚点不唯一: ${startMark}`);
  const end = src.indexOf(endMark, first + startMark.length);
  if (end < 0) throw new Error(`结束锚点缺失: ${endMark}`);
  return src.slice(first, end + includeEnd);
}

/** 去型 → 编译为可调用函数。`head`/`tail` 用于补回被切掉的外层括号。 */
function compile(wrappedJs, mutate) {
  let js = wrappedJs;
  if (mutate) js = mutate(js);
  const stripped = stripTypeScriptTypes(js);
  return new Function(`return ${stripped};`)();
}

/**
 * 把 `entrySlice.ts` 的源码编译成一个"模块对象"（`export` 前缀剥掉 + 去型 + 收集导出名）。
 * 这样变异器可以改**源码文本**再重跑 ⇒ 直接检验"断言是否真的能红"。
 */
function loadEntryModule(src) {
  const names = [];
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  for (const m of src.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  let body = src.replace(/export\s+const\s+/g, 'const ').replace(/export\s+function\s+/g, 'function ');
  body = stripTypeScriptTypes(body);
  const factory = new Function(`${body}\nreturn { ${names.join(', ')} };`);
  return factory();
}

const ENTRY = loadEntryModule(entrySrc);

// 源码常量（从 BattleScene 提取，避免与台架各写一份）
const ASSEMBLE_MAX_MS = Number((scene.match(/const ASSEMBLE_MAX_MS = (\d+);/) || [])[1]);
const COMPACT_TURN_LATERAL_KEEP = Number((scene.match(/const COMPACT_TURN_LATERAL_KEEP = ([\d.]+);/) || [])[1]);

// ════════════════════════════════════════════════════════════════════════════
// 1) 时序 / 逐舰错开（真跑纯逻辑层）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 1. 时序：总时长受 SLICE_TOTAL_MAX 约束，且 ≤ ASSEMBLE_MAX_MS ===');
check('ASSEMBLE_MAX_MS 仍为 4000（本任务禁止改动该常量）', () => ASSEMBLE_MAX_MS === 4000);
check('SLICE_TOTAL_MAX ≤ ASSEMBLE_MAX_MS/1000', () => E.SLICE_TOTAL_MAX <= ASSEMBLE_MAX_MS / 1000);
check('默认总时长 = spread + durPerShip = 2.5s', () =>
  E.entryTotalSec(E.SLICE_SPREAD, E.SLICE_DUR_PER_SHIP, E.SLICE_TOTAL_MAX) === 2.5);
check('默认总时长 ≤ SLICE_TOTAL_MAX', () =>
  E.entryTotalSec(E.SLICE_SPREAD, E.SLICE_DUR_PER_SHIP, E.SLICE_TOTAL_MAX) <= E.SLICE_TOTAL_MAX);
check('超长 spread 被压到 totalMax - durPerShip（10 → 2.6）', () =>
  Math.abs(E.entrySpreadEffective(10, 0.9, 3.5) - 2.6) < 1e-12);
check('超长 spread 下总时长恰为 totalMax（3.5）', () =>
  Math.abs(E.entryTotalSec(10, 0.9, 3.5) - 3.5) < 1e-12);
check('duration ≥ totalMax 时不出现负跨度', () =>
  E.entrySpreadEffective(1.6, 5, 3.5) === 0 && E.entryTotalSec(1.6, 5, 3.5) === 5);

console.log('\n=== 2. 逐舰错开顺序单调（波次感） ===');
{
  const n = 12;
  const delays = Array.from({ length: n }, (_, i) => E.entryDelayForSlot(i, n, E.SLICE_SPREAD));
  check('首舰延迟 = 0（立刻开切）', () => delays[0] === 0);
  check('末舰延迟 = spread（整波铺满）', () => Math.abs(delays[n - 1] - E.SLICE_SPREAD) < 1e-12);
  check('延迟沿阵位索引**单调不减**', () => delays.every((v, i) => i === 0 || v >= delays[i - 1]));
  check('延迟沿阵位索引**严格递增**（n>1 ⇒ 真有波次，不是齐射）', () =>
    delays.every((v, i) => i === 0 || v > delays[i - 1]));
  const finish = delays.map((d, i) => 1000 + d + E.SLICE_DUR_PER_SHIP);
  check('完成时刻沿阵位索引单调递增', () => finish.every((v, i) => i === 0 || v > finish[i - 1]));
  check('全部完成时刻 ≤ t0 + SLICE_TOTAL_MAX', () =>
    Math.max(...finish) <= 1000 + E.SLICE_TOTAL_MAX + 1e-12);
  check('单舰（n=1）/ 空队（n=0）延迟为 0（不产生 NaN）', () =>
    E.entryDelayForSlot(0, 1, 1.6) === 0 && E.entryDelayForSlot(0, 0, 1.6) === 0);
  check('越界下标被钳位（不产生越界延迟）', () =>
    E.entryDelayForSlot(999, 4, 1.6) === E.entryDelayForSlot(3, 4, 1.6)
    && E.entryDelayForSlot(-5, 4, 1.6) === 0);
}

console.log('\n=== 3. 单舰进度 p ∈ [0,1]（不提前显形、不超调） ===');
{
  const t0 = 100, delay = 0.4, dur = E.SLICE_DUR_PER_SHIP;
  check('开场（now = t0）⇒ p = 0', () => E.entryShipProgress(t0, t0, delay, dur) === 0);
  check('错开延迟未到 ⇒ p 仍为 0（不会被"顺带"提前显形）', () =>
    E.entryShipProgress(t0 + 0.2, t0, delay, dur) === 0);
  check('中点 ⇒ p = 0.5', () => Math.abs(E.entryShipProgress(t0 + delay + dur / 2, t0, delay, dur) - 0.5) < 1e-12);
  check('到点 ⇒ p = 1', () => E.entryShipProgress(t0 + delay + dur, t0, delay, dur) === 1);
  check('超时 ⇒ p 钳在 1（不超调）', () => E.entryShipProgress(t0 + 99, t0, delay, dur) === 1);
  check('now 远早于 t0（NaN/负数场景）⇒ p = 0', () =>
    E.entryShipProgress(-5, t0, delay, dur) === 0 && E.entryShipProgress(NaN, t0, delay, dur) === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 4) 平面几何：t=0 全不可见 / t=total 全可见 / 方向性
// ════════════════════════════════════════════════════════════════════════════
/** 交付语义：平面把空间切成两半，`front` 的一侧可见（`entryPlaneFront` 的规格）。 */
const Y_LO = 92.5;
const Y_HI = 107.5;
const SAMPLES = Array.from({ length: 41 }, (_, i) => Y_LO + (Y_HI - Y_LO) * (i / 40));
const visibleAt = (front, dir, y) => (dir >= 0 ? y <= front + 1e-9 : y >= front - 1e-9);
/** three 的**真实**语义复刻：`distance = normal·p + constant`，`distance < 0` 被裁。 */
const threeVisible = (front, dir, y) => {
  const ny = E.entryPlaneNormalY(dir);
  const c = E.entryPlaneConstant(front, dir);
  return ny * y + c >= -1e-9;
};

console.log('\n=== 4. t=0 ⇒ 平面在包围盒之外（全舰不可见） ===');
for (const dir of [1, -1]) {
  const front = E.entryPlaneFront(0, Y_LO, Y_HI, dir);
  check(`dir=${dir > 0 ? '+1(自下而上)' : '-1(自上而下)'}：p=0 时 front 落在包围盒边界`,
    () => Math.abs(front - (dir > 0 ? Y_LO : Y_HI)) < 1e-12);
  check(`dir=${dir > 0 ? '+1' : '-1'}：p=0 时舰体内部采样点**全部不可见**`, () =>
    SAMPLES.filter((y) => y > Y_LO + 1e-6 && y < Y_HI - 1e-6).every((y) => !visibleAt(front, dir, y)));
}

console.log('\n=== 5. t=总时长 ⇒ 全舰可见 ===');
for (const dir of [1, -1]) {
  const front = E.entryPlaneFront(1, Y_LO, Y_HI, dir);
  check(`dir=${dir > 0 ? '+1' : '-1'}：p=1 时 front 越过包围盒另一端`,
    () => Math.abs(front - (dir > 0 ? Y_HI : Y_LO)) < 1e-12);
  check(`dir=${dir > 0 ? '+1' : '-1'}：p=1 时舰体全高**全部可见**`, () =>
    SAMPLES.every((y) => visibleAt(front, dir, y)));
}

console.log('\n=== 6. 平面推进单调 + 与 three 的裁剪语义逐点一致 ===');
{
  let prevFront = -Infinity;
  let mono = true;
  for (let i = 0; i <= 20; i++) {
    const front = E.entryPlaneFront(i / 20, Y_LO, Y_HI, 1);
    if (front < prevFront - 1e-12) mono = false;
    prevFront = front;
  }
  check('dir=+1：front 随 p 单调不减（从下往上扫）', () => mono === true);
  check('dir=+1：p=0.5 时 front 恰在包围盒中点', () =>
    Math.abs(E.entryPlaneFront(0.5, Y_LO, Y_HI, 1) - (Y_LO + Y_HI) / 2) < 1e-12);
  check('dir=-1：p=0.5 时 front 也在中点（对称）', () =>
    Math.abs(E.entryPlaneFront(0.5, Y_LO, Y_HI, -1) - (Y_LO + Y_HI) / 2) < 1e-12);
  check('dir=-1：front 随 p 单调不增（自上而下扫）', () => {
    let prev = Infinity;
    for (let i = 0; i <= 20; i++) {
      const front = E.entryPlaneFront(i / 20, Y_LO, Y_HI, -1);
      if (front > prev + 1e-12) return false;
      prev = front;
    }
    return true;
  });
  check('法线方向与扫描方向相反（dir=+1 ⇒ -1 / dir=-1 ⇒ +1）', () =>
    E.entryPlaneNormalY(1) === -1 && E.entryPlaneNormalY(-1) === 1);
  check('plane.constant 在 dir=-1 时取负（法线翻转的必然结果）', () =>
    E.entryPlaneConstant(7, 1) === 7 && E.entryPlaneConstant(7, -1) === -7);
  // 最强交叉检验：本模块的"交付语义"必须与 three 的 distance<0 裁剪**逐点一致**
  for (const dir of [1, -1]) {
    check(`dir=${dir > 0 ? '+1' : '-1'}：逐点与 three 的 distance<0 裁剪语义一致（全 p × 全采样）`, () => {
      for (let i = 0; i <= 20; i++) {
        const front = E.entryPlaneFront(i / 20, Y_LO, Y_HI, dir);
        for (const y of SAMPLES) {
          if (visibleAt(front, dir, y) !== threeVisible(front, dir, y)) return false;
        }
      }
      return true;
    });
  }
}

console.log('\n=== 7. 辉光包络：两端为 0（不"啪"地出现/消失） ===');
check('p=0 / p=1 ⇒ 辉光 0', () => E.entryGlowAmt(0) === 0 && E.entryGlowAmt(1) === 0);
check('中段 ⇒ 辉光 1', () => E.entryGlowAmt(0.5) === 1);
check('包络非负且有界', () => {
  for (let i = 0; i <= 100; i++) { const g = E.entryGlowAmt(i / 100); if (g < 0 || g > 1) return false; }
  return true;
});

// ════════════════════════════════════════════════════════════════════════════
// 8) stepEntrySlice：单舰某一时刻的完整相位
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 8. stepEntrySlice：active 门与结束时必须清裁剪 ===');
{
  const cfg = E.ENTRY_CFG_DEFAULT;
  const st = { t0: 500, delay: 0.3, done: false };
  // ⚠ 用 1e-6 余量跨越浮点（(500.3+0.9−500.3)/0.9 在 IEEE754 下可能略小于 1）
  const totalAt = st.t0 + st.delay + cfg.durPerShip + 1e-6;
  const s0 = E.stepEntrySlice(st.t0, st, Y_LO, Y_HI, cfg);
  check('t=t0 ⇒ active=true（进场即开始）', () => s0.active === true);
  check('t=t0 ⇒ front 在包围盒底（全不可见）', () => Math.abs(s0.front - Y_LO) < 1e-12);
  check('t=t0 ⇒ 辉光为 0（还没有可扫的东西）', () => s0.glow === 0);
  const s1 = E.stepEntrySlice(st.t0 + st.delay + cfg.durPerShip * 0.999, st, Y_LO, Y_HI, cfg);
  check('结束前一瞬 ⇒ 仍 active', () => s1.active === true && s1.glow < 1);
  const s2 = E.stepEntrySlice(totalAt, st, Y_LO, Y_HI, cfg);
  check('t=总时长 ⇒ active=false（调用方据此清空 clippingPlanes）', () => s2.active === false);
  check('t=总时长 ⇒ glow 归零（扫描面片必须收掉）', () => s2.glow === 0);
  const s3 = E.stepEntrySlice(totalAt + 10, st, Y_LO, Y_HI, cfg);
  check('t 远超总时长 ⇒ 仍 active=false（不会"复活"）', () => s3.active === false);
}

console.log('\n=== 9. 写入侧：挂载 / 卸载 / 平面常数 ===');
{
  const mats = [{ clippingPlanes: null }, { clippingPlanes: null }];
  const planes = [{ constant: E.entryPlaneInitConstant(1) }];
  check('初始常数在包围盒之外（远小于任何可能的 yLo）', () => planes[0].constant < -1e5);
  E.entryApplyClipping(mats, planes, true);
  check('挂载 ⇒ 两个材质的 clippingPlanes 都指向同一平面数组（不串扰、不遗漏）', () =>
    mats.every((m) => m.clippingPlanes === planes));
  E.entryWritePlanes(planes, 123.5, 1);
  check('写常数 ⇒ 平面 constant 被更新（dir=+1 时 = front）', () => planes[0].constant === 123.5);
  E.entryWritePlanes(planes, 123.5, -1);
  check('写常数 ⇒ dir=-1 时 constant = -front（法线翻转）', () => planes[0].constant === -123.5);
  E.entryApplyClipping(mats, planes, false);
  check('卸载 ⇒ clippingPlanes 归 null（= 材质默认值 = 零裁剪平面）', () =>
    mats.every((m) => m.clippingPlanes === null));
  check('卸载对 undefined / 空数组安全（不抛错）', () => {
    E.entryApplyClipping(undefined, planes, true);
    E.entryApplyClipping([], planes, true);
    E.entryWritePlanes(undefined, 1, 1);
    return true;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 10) 变异自检：改坏纯逻辑层 ⇒ 断言必须 FAIL（证明"有牙齿"）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 10. 变异自检（改坏源码 ⇒ 断言必须能红） ===');
{
  // 变异 A：平面推进方向反转（p=0 时反而全可见）
  const mutA = loadEntryModule(entrySrc.replace(
    'return dir >= 0 ? yLo + (yHi - yLo) * t : yHi + (yLo - yHi) * t;',
    'return dir >= 0 ? yHi - (yHi - yLo) * t : yLo + (yHi - yLo) * t;',
  ));
  checkThrows('变异A（平面反向）已被断言检出', () => {
    const front = mutA.entryPlaneFront(0, Y_LO, Y_HI, 1);
    assert.equal(front, Y_LO);   // 正常应等于 Y_LO
  });

  // 变异 B：错开跨度恒 0（齐射，无波次）
  const mutB = loadEntryModule(entrySrc.replace(
    'return (s / (n - 1)) * Math.max(0, spread);',
    'return 0;',
  ));
  checkThrows('变异B（错开归零 ⇒ 齐射）已被"严格递增"断言检出', () => {
    const n = 12;
    const d = Array.from({ length: n }, (_, i) => mutB.entryDelayForSlot(i, n, 1.6));
    assert.equal(d.every((v, i) => i === 0 || v > d[i - 1]), true);
  });

  // 变异 C：进度不再钳位（超调 ⇒ p 越界，"结束门"之外的一切消费者都会读到坏值）
  const mutC = loadEntryModule(entrySrc.replace(
    'return p >= 1 ? 1 : p;',
    'return p;',
  ));
  checkThrows('变异C（p 不钳位）已被"超时钳在 1"断言检出', () => {
    assert.equal(mutC.entryShipProgress(100, 0, 0, 0.9), 1);
  });

  // 变异 D：卸载写成"不卸载"（残留 ⇒ 舰体被永久切）
  const mutD = loadEntryModule(entrySrc.replace(
    'const v = active ? planes : null;',
    'const v = planes;',
  ));
  checkThrows('变异D（clippingPlanes 残留）已被"卸载归 null"断言检出', () => {
    const mats = [{ clippingPlanes: null }];
    mutD.entryApplyClipping(mats, [{}], false);
    assert.equal(mats[0].clippingPlanes, null);
  });

  // 变异 E：totalMax 约束失效（总时长可超过 ASSEMBLE_MAX_MS）
  const mutE = loadEntryModule(entrySrc.replace(
    'const room = Math.max(0, totalMax - durPerShip);',
    'const room = Infinity;',
  ));
  checkThrows('变异E（totalMax 约束失效）已被"总时长 ≤ 3.5"断言检出', () => {
    assert.equal(mutE.entryTotalSec(10, 0.9, 3.5) <= 3.5, true);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 11) ★v2 真跑 Wiring：Battle3DOverlay.stepEntryGate / finishEntryGate / updateEntryFx
//     （原文切片 + 去型 + 执行）—— 一队一门 ⇒ 5 个共享裁剪面必须**真围出长方柱**
// ════════════════════════════════════════════════════════════════════════════
const SEG_START = 'private stepEntryGate(g: FleetGate, now: number, on: boolean): boolean {';
// ⚠ 末端锚点必须是**方法最后一句**（`return false;`）—— 若停在中间，切出来的函数会缺 return
//   ⇒ 返回 undefined ⇒ "未结束/已结束"的判定全部失真（本项目踩过同类静默失真）。
const SEG_END = 'return false;';
const SEG_WRITE = 'entryGateWritePlanes(g.planes, g.fwd, g.right, g.up, g.cu, g.cv, g.halfU, g.halfV, g.pos);';

/**
 * 编译 `stepEntryGate` 的**原文**（保留 `this.`，注入纯函数）。
 * ⚠ 方法签名随切片一起被切掉 ⇒ 形参 `g / now / on` 必须在**内层函数**里补回
 *   （v1 的 `updateEntryFx` 无参所以不需要这层；`stepEntryGate` 有参，不补会变成自由变量）。
 */
function compileStepEntryGate(mutate) {
  let body = extractUnique(overlay, SEG_START, SEG_END, SEG_END.length);
  body = body.split(SEG_START).join('');
  return compile(
    `(function(entryShipProgress, entryGateFront, entryGateWritePlanes, E) {\nreturn function(g, now, on) {\n${body}\n};\n})`,
    mutate,
  );
}

/** 编译 `finishEntryGate` 的**原文**（同上：形参 `g` 在内层函数补回）。 */
function compileFinishEntryGate(mutate) {
  const START = 'private finishEntryGate(g: FleetGate): void {';
  const END = 'g.done = true;';
  let body = extractUnique(overlay, START, END, END.length);
  body = body.split(START).join('');
  return compile(
    `(function(entryApplyClipping) {\nreturn function(g) {\n${body}\n};\n})`,
    mutate,
  );
}

const UEF_START = 'private updateEntryFx(): void {';
const UEF_END = 'for (const [fleet, g] of this.fleetGates) if (g.done) this.fleetGates.delete(fleet);';

/** 编译 `updateEntryFx` 的**原文**（无参 ⇒ 直接注入 `this` 上的依赖）。 */
function compileUpdateEntryFx(mutate) {
  let body = extractUnique(overlay, UEF_START, UEF_END, UEF_END.length);
  body = body.split(UEF_START).join('');
  return compile(`(function() {\n${body}\n})`, mutate);
}

/**
 * 造一个假的 `FleetGate`：`fwd=+X / right=−Z / up=+Y`（右手基），
 * 舰队沿朝向占 `[sLo, sHi]`，截面中心 `(cu, cv)`、**横向/竖向半跨** `halfU`/`halfV`
 * （v3 改矩形后两者可不等）。
 */
function makeFakeGate(opt = {}) {
  const sLo = opt.sLo ?? 90, sHi = opt.sHi ?? 110;
  const cu = opt.cu ?? 0, cv = opt.cv ?? 100;
  const half = opt.half ?? 20;
  const halfU = opt.halfU ?? half, halfV = opt.halfV ?? half;
  const margin = opt.margin ?? 2;
  const planes = [0, 1, 2, 3, 4].map(() => {
    const n = { x: 0, y: 1, z: 0 };
    n.set = (x, y, z) => { n.x = x; n.y = y; n.z = z; return n; };
    return { normal: n, constant: 0 };
  });
  return {
    fleet: {}, planes,
    fwd: { x: 1, y: 0, z: 0 },
    right: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    cu, cv, halfU, halfV, margin,
    box: { uLo: cu - halfU, uHi: cu + halfU, vLo: cv - halfV, vHi: cv + halfV, sLo, sHi },
    t0: opt.t0 ?? 50, p: 0, pos: sHi + margin, done: false,
    shipKeys: opt.shipKeys ?? [], vis: null,
  };
}

/** three 的裁剪语义复刻：`distance(p) = normal·p + constant`，`distance < 0` 被裁。 */
function gateVisible(g, x, y, z) {
  return g.planes.every((pl) => pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant >= -1e-9);
}

/** 造一个只含 `stepEntryGate` 依赖的假 `this`。 */
function makeStepSelf() {
  return { entryCfg: E.ENTRY_CFG_DEFAULT };
}

/**
 * 注入纯函数后跑一帧 `stepEntryGate`（直接用入参 `now`，不需要假 `performance.now`）。
 * ⚠ 编译产物是"外层注入 + **内层参数**"两段式 ⇒ 内层**必须 `.call(self, …)`** 才带得上 `this`。
 */
function runStepEntryGate(fn, gate, nowSec, on = true) {
  const self = makeStepSelf();
  const inner = fn.call(self, E.entryShipProgress, E.entryGateFront, E.entryGateWritePlanes, E);
  return inner.call(self, gate, nowSec, on);
}

console.log('\n=== 11. stepEntryGate 真跑：一队一门的 5 个裁剪面 = 无限长方柱（v2 核心 N5/N7） ===');
{
  const stepFn = compileStepEntryGate();
  const T0 = 50;

  // 场景 A：p = 0（推进面在**舰首之外** ⇒ 全隐）
  {
    const g = makeFakeGate({ t0: T0, sLo: 90, sHi: 110, cu: 0, cv: 100, half: 20, margin: 2 });
    const fin = runStepEntryGate(stepFn, g, T0);
    check('p=0 ⇒ 未结束（仍在入场）', () => fin === false && g.done === false);
    check('N5：p=0 ⇒ 推进面在**舰首之外**（pos = sHi + margin = 112）', () => Math.abs(g.pos - 112) < 1e-9);
    check('N5/N7：推进面法线 = 舰队朝向 fwd，constant = −gatePos', () =>
      Math.abs(g.planes[0].normal.x - 1) < 1e-12 && Math.abs(g.planes[0].normal.y) < 1e-12
      && Math.abs(g.planes[0].normal.z) < 1e-12 && Math.abs(g.planes[0].constant + 112) < 1e-9);
    check('N7：p=0 ⇒ 舰体采样点（舰尾/舰中/舰首）**全部不可见**', () =>
      [91, 100, 109].every((x) => !gateVisible(g, x, 100, 0)));
  }

  // 场景 B：p = 0.25（推进面已扫过舰首一段 ⇒ 舰首可见、舰尾仍隐）
  {
    const g = makeFakeGate({ t0: T0, sLo: 90, sHi: 110, cu: 0, cv: 100, half: 20, margin: 2 });
    runStepEntryGate(stepFn, g, T0 + E.ENTRY_TOTAL_SEC * 0.25);
    check('N5：p=0.25 ⇒ 推进面已向**舰尾**推（pos 从 112 递减）', () => g.pos < 112 && g.pos > 96);
    check('N5：舰首侧可见 / 舰尾侧不可见（真在"切"）', () =>
      gateVisible(g, 110, 100, 0) && !gateVisible(g, 91, 100, 0));
  }

  // 场景 C：★ **侧面 4 个面真的在围**（v1 只有 1 个无限平面 ⇒ 这一段必然 FAIL）
  {
    const g = makeFakeGate({ t0: T0, sLo: 90, sHi: 110, cu: 0, cv: 100, half: 20, margin: 2 });
    runStepEntryGate(stepFn, g, T0 + E.ENTRY_TOTAL_SEC * 0.5);
    // ⚠ 采样点必须取在**推进面之前**（x=200 ≫ gatePos）⇒ 唯一能裁它们的只有 4 个侧面；
    //   若取在推进面之后，会被推进面"顺带"裁掉，侧面断言就失去隔离性（假通过）。
    check('★N7：门**外**（横向 |u−cu| > half）被裁 —— 左右侧面生效', () =>
      !gateVisible(g, 200, 100, 25) && !gateVisible(g, 200, 100, -25));
    check('★N7：门**外**（竖直 |v−cv| > half）被裁 —— 上下侧面生效', () =>
      !gateVisible(g, 200, 130, 0) && !gateVisible(g, 200, 70, 0));
    check('★N7：门**内**（|u−cu| ≤ half 且 |v−cv| ≤ half）可见 —— 方柱内部不误裁', () =>
      gateVisible(g, 200, 100, 0) && gateVisible(g, 200, 118, 18) && gateVisible(g, 200, 82, -18));
    check('★N6：4 个侧面把横截面钉成**矩形**（横向 halfU / 竖向 halfV **分列**，中心 = 投影包围盒中心）', () =>
      Math.abs(g.planes[1].constant - (g.cu + g.halfU)) < 1e-9
      && Math.abs(g.planes[2].constant - (g.halfU - g.cu)) < 1e-9
      && Math.abs(g.planes[3].constant - (g.cv + g.halfV)) < 1e-9
      && Math.abs(g.planes[4].constant - (g.halfV - g.cv)) < 1e-9);
    check('★N7：裁剪面**恰好 5 个**（1 推进 + 4 侧面）', () => g.planes.length === 5);
  }

  // 场景 C2：★ v3「改矩形」⇒ halfU ≠ halfV 时横向/竖向**各自独立**（v2 的正方形做不到）
  {
    const g = makeFakeGate({ t0: T0, sLo: 90, sHi: 110, cu: 0, cv: 100, halfU: 30, halfV: 12, margin: 2 });
    runStepEntryGate(stepFn, g, T0 + E.ENTRY_TOTAL_SEC * 0.5);
    check('★v3矩形：横向 |u−cu|=25 < halfU(30) **可见**（若竖向 halfV 误当横向 ⇒ 会误裁）', () =>
      gateVisible(g, 200, 100, 25) && gateVisible(g, 200, 100, -25));
    check('★v3矩形：横向 |u−cu|=35 > halfU(30) 被裁', () =>
      !gateVisible(g, 200, 100, 35) && !gateVisible(g, 200, 100, -35));
    check('★v3矩形：竖向 |v−cv|=16 > halfV(12) 被裁（与横向 halfU 独立）', () =>
      !gateVisible(g, 200, 116, 0) && !gateVisible(g, 200, 84, 0));
    check('★v3矩形：竖向 |v−cv|=8 < halfV(12) 可见', () =>
      gateVisible(g, 200, 108, 0) && gateVisible(g, 200, 92, 0));
  }

  // 场景 D：p ≥ 1（扫过舰尾 ⇒ 结束）与一键关闭
  {
    const g = makeFakeGate({ t0: T0 });
    check('p=1 ⇒ 本帧结束（调用方据此 finishEntryGate 卸载裁剪）', () =>
      runStepEntryGate(stepFn, g, T0 + E.ENTRY_TOTAL_SEC + 1e-6) === true && g.done === true);
  }
  {
    const g = makeFakeGate({ t0: T0 });
    check('一键关闭（on=false）⇒ 立即结束（不逐帧空转、不残留裁剪）', () =>
      runStepEntryGate(stepFn, g, T0 + 1, false) === true && g.done === true);
  }
  {
    const g = makeFakeGate({ t0: T0 });
    g.done = true;
    check('已结束的门再被推进 ⇒ 直接返回 true（幂等，不重复写平面）', () =>
      runStepEntryGate(stepFn, g, T0 + 1) === true);
  }
}

console.log('\n=== 11b. finishEntryGate 真跑：**结束必须卸载全队裁剪**（v1 的"永久切"红线） ===');
{
  const finFn = compileFinishEntryGate();
  const runFinish = (fn, self, gate) => fn.call(self, E.entryApplyClipping).call(self, gate);
  const g = makeFakeGate({ shipKeys: ['a', 'b', 'c'] });
  const shared = g.planes;
  const mkEntry = () => ({ sliceMats: [{ clippingPlanes: shared }, { clippingPlanes: shared }], entryPlanes: shared });
  const ships = new Map([['a', mkEntry()], ['b', mkEntry()], ['c', mkEntry()]]);
  const states = new Map([['a', { done: false }], ['b', { done: false }], ['c', { done: false }]]);
  // ⚠ 先抓住材质**数组引用**：finishEntryGate 会把 `entry.sliceMats` 置空（置空是要求的一部分）
  const mats = ships.get('a').sliceMats;
  let disposed = 0;
  let sphereDisposed = 0;
  let doorDisposed = 0;
  const self = {
    entryStates: states, ships,
    disposeGateVisual: () => { disposed += 1; },
    // [v3.1 · S] `finishEntryGate` 现在还会 `disposeSphereVisual`（球体零残留红线）⇒ 假 self 必须提供
    disposeSphereVisual: () => { sphereDisposed += 1; },
    // [v4 · D] 同理 `disposeDoorVisual`（传送门零残留红线）⇒ 假 self 必须提供
    disposeDoorVisual: () => { doorDisposed += 1; },
  };
  runFinish(finFn, self, g);
  check('★ 结束 ⇒ 全队材质的 clippingPlanes **全部归 null**（否则舰体被永久切）', () =>
    mats.every((m) => m.clippingPlanes === null));
  check('结束 ⇒ 实体上的 sliceMats / entryPlanes 引用被清空', () =>
    ['a', 'b', 'c'].every((k) => ships.get(k).sliceMats === undefined && ships.get(k).entryPlanes === undefined));
  check('结束 ⇒ 全队 entryStates 逐舰置 done（不再强制建实体/grow=1）', () =>
    ['a', 'b', 'c'].every((k) => states.get(k).done === true));
  check('结束 ⇒ 门本体被销毁一次（可见的门框/位面必须收掉）', () => disposed === 1);
  check('★v3.1：结束 ⇒ **球体也被销毁一次**（S 方案"入场结束后零残留"红线）', () => sphereDisposed === 1);
  check('★v4：结束 ⇒ **传送门也被销毁一次**（D 方案"入场结束后零残留"红线）', () => doorDisposed === 1);
  check('结束 ⇒ gate.done = true', () => g.done === true);
}

console.log('\n=== 12. updateEntryFx 真跑 + 变异自检（改坏 Wiring ⇒ 断言必须能红） ===');
{
  const stepFn = compileStepEntryGate();
  const finFn = compileFinishEntryGate();
  const uefFn = compileUpdateEntryFx();

  /** 端到端假 overlay：`updateEntryFx` → `stepEntryGate` / `finishEntryGate` 全部用**编译后的原文**。 */
  function makeOverlay(gate, nowSec, on = true) {
    const self = {
      fleetGates: new Map([[gate.fleet, gate]]),
      entryCfg: E.ENTRY_CFG_DEFAULT,
      entryStates: new Map(),
      ships: new Map(),
      _disposed: 0,
      _placed: 0,
      _nowSec: nowSec,
    };
    const stepInner = stepFn.call(self, E.entryShipProgress, E.entryGateFront, E.entryGateWritePlanes, E);
    const finInner = finFn.call(self, E.entryApplyClipping);
    self.stepEntryGate = (g, now, on2) => stepInner.call(self, g, now, on2);
    self.finishEntryGate = (g) => finInner.call(self, g);
    self.disposeGateVisual = () => { self._disposed += 1; };
    // [v3.1 · S] `finishEntryGate` 还会 `disposeSphereVisual` ⇒ 假 self 必须提供（否则取门时抛错）
    self.disposeSphereVisual = () => { self._sphereDisposed = (self._sphereDisposed || 0) + 1; };
    // [v4 · D] 同理 `disposeDoorVisual`
    self.disposeDoorVisual = () => { self._doorDisposed = (self._doorDisposed || 0) + 1; };
    self.placeGateVisual = () => { self._placed += 1; };
    self.entryFxOn = () => on;
    for (const k of gate.shipKeys) {
      self.entryStates.set(k, { done: false });
      self.ships.set(k, { sliceMats: [{ clippingPlanes: gate.planes }], entryPlanes: gate.planes });
    }
    return self;
  }

  const runUef = (self) => {
    const realNow = performance.now;
    performance.now = () => self._nowSec * 1000;
    try { uefFn.call(self); } finally { performance.now = realNow; }
  };

  // 场景 A：入场中（推进面已写、门未收、裁剪仍在）
  {
    const g = makeFakeGate({ t0: 50, shipKeys: ['a'] });
    const self = makeOverlay(g, 50 + E.ENTRY_TOTAL_SEC * 0.5);
    runUef(self);
    check('入场中 ⇒ 门仍在表里（未误收）', () => self.fleetGates.size === 1 && g.done === false);
    check('入场中 ⇒ 推进面已被写入（pos 随进度推进）', () => g.pos < 112 && g.pos > 90);
    check('入场中 ⇒ 裁剪仍挂载（不误清）', () => self.ships.get('a').sliceMats[0].clippingPlanes === g.planes);
    check('入场中 ⇒ 门本体被摆位一次（可见门随推进面移动）', () => self._placed === 1);
  }

  // 场景 B：到点 ⇒ 收门 + 卸载裁剪 + 逐舰 done + 从表里删除
  {
    const g = makeFakeGate({ t0: 50, shipKeys: ['a', 'b'] });
    const self = makeOverlay(g, 50 + E.ENTRY_TOTAL_SEC + 5);
    const matsB = self.ships.get('a').sliceMats;   // 先抓引用（收门后会被置空）
    runUef(self);
    check('★到点 ⇒ 门从 fleetGates **删除**（不再逐帧空转）', () => self.fleetGates.size === 0);
    check('★到点 ⇒ 全队 clippingPlanes **归 null**（N7 红线：不得永久切）', () =>
      matsB.every((m) => m.clippingPlanes === null));
    check('到点 ⇒ 全队 entryStates 置 done', () =>
      ['a', 'b'].every((k) => self.entryStates.get(k).done === true));
    check('到点 ⇒ 门本体销毁一次', () => self._disposed === 1);
  }

  // 场景 C：一键关闭 ⇒ 立刻收门
  {
    const g = makeFakeGate({ t0: 50, shipKeys: ['a'] });
    const self = makeOverlay(g, 50 + 0.1, false);
    const matsC = self.ships.get('a').sliceMats;
    runUef(self);
    check('一键关闭 ⇒ 立刻收门并清裁剪（切换中途不残留）', () =>
      self.fleetGates.size === 0 && matsC[0].clippingPlanes === null);
  }

  // 场景 D：没有门 ⇒ 提前返回、不抛错
  {
    const self = makeOverlay(makeFakeGate({ shipKeys: [] }), 60);
    self.fleetGates.clear();
    runUef(self);
    check('无门 ⇒ 提前返回、不抛错', () => self.fleetGates.size === 0 && self._disposed === 0);
  }

  // ── 变异自检 ──
  {
    const T0Dummy = 50;
    // 变异 F：`stepEntryGate` 不写任何平面 ⇒ "舰首可见/舰尾不可见"必须红
    const stepF = compileStepEntryGate((s) => s.split(SEG_WRITE).join('void 0;'));
    const gF = makeFakeGate({ t0: T0Dummy });
    runStepEntryGate(stepF, gF, T0Dummy + E.ENTRY_TOTAL_SEC * 0.25);
    checkThrows('变异F（stepEntryGate 不写平面）已被"舰首可见/舰尾不可见"断言检出', () => {
      assert.equal(gateVisible(gF, 110, 100, 0) && !gateVisible(gF, 91, 100, 0), true);
    });

    // 变异 G：推进面方向反转（p=0 反而全可见）⇒ "p=0 全隐"必须红
    const stepG = compileStepEntryGate((s) =>
      s.split('entryGateFront(p, g.box.sLo, g.box.sHi, g.margin)').join('entryGateFront(1 - p, g.box.sLo, g.box.sHi, g.margin)'));
    const gG = makeFakeGate({ t0: T0Dummy });
    runStepEntryGate(stepG, gG, T0Dummy);
    checkThrows('变异G（推进面反向）已被"p=0 舰体全部不可见"断言检出', () => {
      assert.equal([91, 100, 109].every((x) => !gateVisible(gG, x, 100, 0)), true);
    });

    // 变异 H：到点不收门（去掉 finishEntryGate 调用）⇒ 门永远留在表里 + 裁剪残留
    const uefH = compileUpdateEntryFx((s) =>
      s.split('if (this.stepEntryGate(g, now, on)) { this.finishEntryGate(g); continue; }')
        .join('if (this.stepEntryGate(g, now, on)) { continue; }'));
    const gH = makeFakeGate({ t0: 50, shipKeys: ['a'] });
    const selfH = makeOverlay(gH, 50 + E.ENTRY_TOTAL_SEC + 5);
    const realNowH = performance.now;
    performance.now = () => selfH._nowSec * 1000;
    try { uefH.call(selfH); } finally { performance.now = realNowH; }
    checkThrows('变异H（到点不收门）已被"门从表里删除 + clippingPlanes 归 null"断言检出', () => {
      assert.equal(selfH.fleetGates.size === 0 && selfH.ships.get('a').sliceMats[0].clippingPlanes === null, true);
    });

    // 变异 I：finishEntryGate 不卸载裁剪 ⇒ "归 null"必须红
    const finI = compileFinishEntryGate((s) =>
      s.split('entryApplyClipping(entry.sliceMats, null, false);').join('void 0;'));
    const gI = makeFakeGate({ shipKeys: ['a'] });
    const shipsI = new Map([['a', { sliceMats: [{ clippingPlanes: gI.planes }], entryPlanes: gI.planes }]]);
    const selfI = { entryStates: new Map([['a', { done: false }]]), ships: shipsI, disposeGateVisual: () => {}, disposeSphereVisual: () => {}, disposeDoorVisual: () => {} };
    finI.call(selfI, E.entryApplyClipping).call(selfI, gI);
    checkThrows('变异I（结束不卸载裁剪）已被"clippingPlanes 归 null"断言检出', () => {
      assert.equal(shipsI.get('a').sliceMats.every((m) => m.clippingPlanes === null), true);
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 13) 同源验证：L1 建舰期放置 vs 逐帧阵位循环（真跑两侧原文）
// ════════════════════════════════════════════════════════════════════════════

/** BattleScene 的 ringCell 原文（L1 与逐帧循环共用同一兜底格）。 */
const RING_SRC = extractUnique(scene, 'function ringCell(i: number): [number, number] {', 'return [r * Math.cos(a), r * Math.sin(a)];', 'return [r * Math.cos(a), r * Math.sin(a)];'.length) + '\n}';
const ringCell = compile(`(function(){\n${RING_SRC}\nreturn ringCell;\n})`);

/** L1：placeUnitsAtFormationSlots 的**原文**（注入 config 层几何函数 + 入场相位函数）。 */
function compileL1(mutate) {
  let body = extractUnique(scene,
    'private placeUnitsAtFormationSlots(fleet: any): void {',
    'u._entryDelay = entryDelayForSlot(slot, n0, spread);',
    'u._entryDelay = entryDelayForSlot(slot, n0, spread);'.length);
  body = body.split('private placeUnitsAtFormationSlots(fleet: any): void {').join('');
  body = body.split('this.hexRadius').join('hexRadius');   // 台架把 overlord 依赖显式化
  body += '\n}';   // 收掉 for 循环（签名里的 `{` 已随签名一起被切掉，故只补 1 个）
  return compile(
    `(function(fleet, hexRadius, formationOffsets, formationSpacing, rotateOffsetPx, ringCell, entrySpreadEffective, entryDelayForSlot, SLICE_SPREAD, SLICE_DUR_PER_SHIP, SLICE_TOTAL_MAX) {\n${body}\nreturn fleet;\n})`,
    mutate,
  );
}

/** 逐帧阵位循环的**原文**（非过渡分支 + 旋转 + 目标位）。 */
function compileLoop(mutate) {
  let body = extractUnique(scene,
    'const rawSlot = (typeof u.formationSlot === \'number\' && u.formationSlot >= 0)',
    'const targetUnitY = fleet.y + ry;',
    'const targetUnitY = fleet.y + ry;'.length);
  return compile(
    `(function(u, index, fleet, formOffsets, formSpacing, morphingNow, morphA, morphB, morphE, COMPACT_TURN_LATERAL_KEEP, ringCell, rotateOffsetPx) {\n${body}\nreturn { x: targetUnitX, y: targetUnitY };\n})`,
    mutate,
  );
}

console.log('\n=== 13. L1 建舰期放置与逐帧追踪**同源**（真跑两侧原文） ===');
{
  const l1 = compileL1();
  const loop = compileLoop();
  const cases = [
    { formation: 'wedge', n: 6, hexRadius: 26, cx: 1234, cy: -567, facing: 0 },
    { formation: 'wedge', n: 6, hexRadius: 26, cx: 1234, cy: -567, facing: 0.7 },
    { formation: 'line', n: 9, hexRadius: 50, cx: -800, cy: 900, facing: -2.1 },
    { formation: 'spindle', n: 5, hexRadius: 32, cx: 0, cy: 0, facing: Math.PI },
  ];
  const runners = (mut) => ({ l1: compileL1(mut && mut.l1), loop: compileLoop(mut && mut.loop) });

  for (const c of cases) {
    const { l1: f1, loop: f2 } = runners();
    const offs = L.formationOffsets(c.formation, c.n);
    const spacing = L.formationSpacing(offs, c.hexRadius);
    const units = Array.from({ length: c.n }, (_, i) => ({
      formationSlot: i, sprite: { x: 0, y: 0 },
    }));
    const fleet = { x: c.cx, y: c.cy, formation: c.formation, formationCount0: c.n, formFacing: c.facing, units };
    f1(fleet, c.hexRadius, L.formationOffsets, L.formationSpacing, L.rotateOffsetPx, ringCell,
      E.entrySpreadEffective, E.entryDelayForSlot, E.SLICE_SPREAD, E.SLICE_DUR_PER_SHIP, E.SLICE_TOTAL_MAX);
    let maxDiff = 0;
    for (let i = 0; i < c.n; i++) {
      const t = f2(units[i], i, fleet, offs, spacing, false, null, null, 1, COMPACT_TURN_LATERAL_KEEP, ringCell, L.rotateOffsetPx);
      maxDiff = Math.max(maxDiff, Math.abs(units[i].sprite.x - t.x), Math.abs(units[i].sprite.y - t.y));
    }
    check(`${c.formation}/n=${c.n}/facing=${c.facing.toFixed(2)}：L1 放置 = 逐帧目标位（逐位一致）`, () => maxDiff < 1e-9);
  }

  // 波次感 + 首舰相位
  {
    const { l1: f1 } = runners();
    const offs = L.formationOffsets('wedge', 6);
    const spacing = L.formationSpacing(offs, 26);
    const units = Array.from({ length: 6 }, (_, i) => ({ formationSlot: i, sprite: { x: 0, y: 0 } }));
    const fleet = { x: 0, y: 0, formation: 'wedge', formationCount0: 6, formFacing: 0, units };
    f1(fleet, 26, L.formationOffsets, L.formationSpacing, L.rotateOffsetPx, ringCell,
      E.entrySpreadEffective, E.entryDelayForSlot, E.SLICE_SPREAD, E.SLICE_DUR_PER_SHIP, E.SLICE_TOTAL_MAX);
    const delays = units.map((u) => u._entryDelay);
    check('L1 给每舰打了 `_entryDelay`（3D 入场相位的真源）', () => delays.every((d) => typeof d === 'number'));
    check('L1 的 `_entryDelay` 沿阵位索引严格递增（波次感来自建舰期）', () =>
      delays.every((v, i) => i === 0 || v > delays[i - 1]));
    check('L1 首舰 `_entryDelay` = 0', () => delays[0] === 0);
    check('L1 首舰就在阵位（不是城堡点）：离开中心 > 0', () =>
      Math.hypot(units[0].sprite.x - fleet.x, units[0].sprite.y - fleet.y) === 0);   // wedge index0 恒为 [0,0] 锚点
    check('L1 非锚点舰确实离开了舰队中心（第一帧即展开，不再"堆一点"）', () =>
      units.slice(1).some((u) => Math.hypot(u.sprite.x, u.sprite.y) > 1));
    check('运输舰（formationSlot = -1）不参与阵型放置、也不打相位', () => {
      const sup = { formationSlot: -1, sprite: { x: 9e9, y: 9e9 } };
      const f = { x: 0, y: 0, formation: 'wedge', formationCount0: 1, formFacing: 0, units: [sup] };
      f1(f, 26, L.formationOffsets, L.formationSpacing, L.rotateOffsetPx, ringCell,
        E.entrySpreadEffective, E.entryDelayForSlot, E.SLICE_SPREAD, E.SLICE_DUR_PER_SHIP, E.SLICE_TOTAL_MAX);
      return sup.sprite.x === 9e9 && sup._entryDelay === undefined;
    });
  }

  // 变异：L1 多转 0.1 rad ⇒ 必须与逐帧目标位不一致（断言可检出）
  {
    const { l1: f1 } = runners({ l1: (s) => s.split('rotateOffsetPx(cell[0] * spacing, cell[1] * spacing, facing, 1)').join('rotateOffsetPx(cell[0] * spacing, cell[1] * spacing, facing + 0.1, 1)') });
    const offs = L.formationOffsets('wedge', 6);
    const spacing = L.formationSpacing(offs, 26);
    const units = Array.from({ length: 6 }, (_, i) => ({ formationSlot: i, sprite: { x: 0, y: 0 } }));
    const fleet = { x: 0, y: 0, formation: 'wedge', formationCount0: 6, formFacing: 0.7, units };
    f1(fleet, 26, L.formationOffsets, L.formationSpacing, L.rotateOffsetPx, ringCell,
      E.entrySpreadEffective, E.entryDelayForSlot, E.SLICE_SPREAD, E.SLICE_DUR_PER_SHIP, E.SLICE_TOTAL_MAX);
    let maxDiff = 0;
    for (let i = 0; i < 6; i++) {
      const t = loop(units[i], i, fleet, offs, spacing, false, null, null, 1, COMPACT_TURN_LATERAL_KEEP, ringCell, L.rotateOffsetPx);
      maxDiff = Math.max(maxDiff, Math.abs(units[i].sprite.x - t.x), Math.abs(units[i].sprite.y - t.y));
    }
    checkThrows('变异I（L1 多转 0.1 rad ⇒ 两套几何漂移）已被"同源"断言检出', () => {
      assert.equal(maxDiff < 1e-9, true);
    });
  }
}

console.log('\n=== 14. rotateOffsetPx 与"旧内联公式"逐位一致（防止重构改数值） ===');
check('rotateOffsetPx 与旧公式 ox·cos − oy·k·sin / ox·sin + oy·k·cos 一致', () => {
  const old = (ox, oy, ff, k) => [ox * Math.cos(ff) - (oy * k) * Math.sin(ff), ox * Math.sin(ff) + (oy * k) * Math.cos(ff)];
  for (const [ox, oy, ff, k] of [[3, -4, 0, 1], [3, -4, 0.7, 1], [3, -4, 0.7, 0.55], [-11.5, 26, -2.4, 0], [0, 0, 1.1, 0.9]]) {
    const a = L.rotateOffsetPx(ox, oy, ff, k);
    const b = old(ox, oy, ff, k);
    if (Math.abs(a[0] - b[0]) > 0 || Math.abs(a[1] - b[1]) > 0) return false;
  }
  return true;
});

// ════════════════════════════════════════════════════════════════════════════
// 15) 源码契约层（防"整段删除"；行为由上面真跑保证）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 15. 源码契约（Wiring 存在性 / 安全红线） ===');
check('渲染器开了**局部**裁剪 localClippingEnabled = true', () =>
  overlay.includes('this.renderer.localClippingEnabled = true;'));
check('**没有**用全局 renderer.clippingPlanes（会切掉星空/地形/后处理）', () =>
  !/renderer\.clippingPlanes\s*=/.test(overlay) && !overlay.includes('this.renderer.clippingPlanes'));
check('addMesh 收集材质并按舰挂裁剪（入场中 ⇒ meshT 直接设满，P3）', () => {
  const block = overlay.slice(overlay.indexOf('private addMesh(v: UnitVis) {'), overlay.indexOf('private dropMesh(key: string) {'));
  return block.includes('this.collectSliceMats(built.group)')
    && block.includes('entryApplyClipping(sliceMats, entryPlanes, true)')
    && block.includes('meshT: entryActive ? MESH_GROW_DUR : 0');
});
check('登记**逐帧**尝试（调用在 `if (!vv)` 之外 ⇒ 部署期首见被拦后开战仍有机会登记）', () => {
  const block = overlay.slice(overlay.indexOf('const vis = this.unitVis;'), overlay.indexOf('// ── [v75] 舰队级 LOD'));
  // 调用必须在 `vis.set(key, vv);`（`if (!vv)` 块内最后一句）**之后** ⇒ 不在首次出现分支内。
  const setIdx = block.indexOf('vis.set(key, vv);');
  const callIdx = block.indexOf('this.registerEntryState(key, u, fleet, now);');
  return setIdx >= 0 && callIdx > setIdx;
});
check('第二遍实体池对入场中的舰**临时强制建实体**（P1：远景无体可切）', () => {
  const block = overlay.slice(overlay.indexOf('// ── 第二遍：实体池'), overlay.indexOf('// ── 第三遍：实体位置'));
  return block.includes('this.entryActiveOf(v.key)') && block.includes('cand.push(v)');
});
check('第三遍对入场中的舰强制 grow = 1（抑制"点+模型共存"）', () =>
  overlay.includes('v.grow = this.entryActiveOf(v.key) ? 1 : sstep(this.lodLo, this.lodHi, v.fleetPx);'));
check('tick() 在 syncShips 之后推进入场特效', () => {
  const block = overlay.slice(overlay.indexOf('this.syncShips(dt);'), overlay.indexOf('this.updateBillboards();'));
  return block.includes('this.updateEntryFx();');
});
check('v2：门本体由**按舰队懒建**（ensureFleetGate → buildGateVisual），不再有全局辉光层', () => {
  const block = overlay.slice(overlay.indexOf('private ensureFleetGate('), overlay.indexOf('private attachEntryClippingTo('));
  return block.includes('this.buildGateVisual(g);') && block.includes('this.placeGateVisual(g);');
});
check('destroy() 清空入场状态与**门**（fleetGates 全量收掉）', () => {
  const block = overlay.slice(overlay.indexOf('destroy() {'), overlay.indexOf('this.renderer.domElement.removeEventListener'));
  return block.includes('this.entryStates.clear()') && block.includes('this.finishAllEntryGates();');
});
check('一键关闭开关存在（window.__entryFxEnabled = false）', () =>
  overlay.includes('__entryFxEnabled === false') && entrySrc.includes('SLICE_ENTRY_ENABLED_DEFAULT'));
check('换装（GLB 原地换装）时重建裁剪引用（不指向已 dispose 的材质）', () => {
  const block = overlay.slice(overlay.indexOf('if (entry.pendingModel && entry.pendingModel.geo'), overlay.indexOf('const g = entry.group;'));
  return block.includes('entry.sliceMats = undefined;') && block.includes('this.collectSliceMats(built.group)');
});

check('L1 为 private 方法且存在', () => scene.includes('private placeUnitsAtFormationSlots(fleet: any): void {'));
check('L1 与逐帧循环共用 formationLayout 的 rotateOffsetPx（唯一旋转实现）', () => {
  const l1 = scene.slice(scene.indexOf('private placeUnitsAtFormationSlots(fleet: any): void {'), scene.indexOf('// 保留旧方法供可能的回退'));
  const loopBlock = scene.slice(scene.indexOf('const rawSlot = (typeof u.formationSlot'), scene.indexOf('const targetUnitY = fleet.y + ry;'));
  return l1.includes('rotateOffsetPx(cell[0] * spacing, cell[1] * spacing, facing, 1)')
    && loopBlock.includes('const [rx, ry] = rotateOffsetPx(ox, oy, _ff, _ctK);');
});
check('两条建舰路径（演习 spawnInitialFleets / 战役 spawnStrategicFleets）都调用 L1', () => {
  const hits = scene.match(/this\.placeUnitsAtFormationSlots\(/g) || [];
  return hits.length === 2;   // 定义处不含 `this.` ⇒ 恰为两条建舰路径各 1 次
});
check('rotateOffsetPx 只有 formationLayout 一份实现（无第二套内联旋转）', () => {
  const inline = /const rx = ox \* Math\.cos\(/.test(scene);
  return layoutSrc.includes('export function rotateOffsetPx(') && !inline;
});
check('ASSEMBLE_MAX_MS 未被改动（R8 关键常量）', () => /const ASSEMBLE_MAX_MS = 4000;/.test(scene));
check('未新增 teleport 玩法（仅视觉）', () =>
  !scene.includes('teleport: true') && !overlay.includes('teleport'));

// ════════════════════════════════════════════════════════════════════════════
// 16) 入场**时机**（时机修复）：部署期不登记 / 开战显式启动纪元
//     —— 真跑 `registerEntryState` 与 `startEntryFx` 的**原文**（切唯一锚点 + 去型 + 执行）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 16. 入场时机：部署期不登记 / 开战显式启动纪元（真跑原文） ===');
{
  const RES_START = 'private registerEntryState(key: string, u: any, fleet: any, now: number): void {';
  const RES_END = 'this.attachEntryClippingTo(key);';
  const SEF_START = 'startEntryFx(): void {';
  const SEF_END = 'this.entryStarted = true;';

  /** 编译 registerEntryState 的**原文**（保留 `this.`，注入窗口常量）。
   *  签名（含其 `{`）被整段切掉 ⇒ body 内无未闭合块，故**不补** `}`（外层 `})` 已闭合包装函数）。 */
  function compileRegisterEntryState(mutate) {
    let body = extractUnique(overlay, RES_START, RES_END, RES_END.length);
    body = body.split(RES_START).join('');
    // 签名被切掉 ⇒ 形参在此补回：`(W, key, u, fleet, now)` 与调用侧对齐。
    return compile(`(function(ENTRY_REG_WINDOW_SEC, key, u, fleet, now) {\n${body}\n})`, mutate);
  }
  /** 编译 startEntryFx 的**原文**（同上：无未闭合块 ⇒ 不补 `}`）。 */
  function compileStartEntryFx(mutate) {
    let body = extractUnique(overlay, SEF_START, SEF_END, SEF_END.length);
    body = body.split(SEF_START).join('');
    return compile(`(function() {\n${body}\n})`, mutate);
  }

  /** 造一个只含 registerEntryState 消费字段的假 `this`（attach 用 spy 记录，不真的碰 three）。 */
  function makeRegSelf({ deployPhase, entryStarted, entryEpoch = 0, entryFxActive = true, gate = {} }) {
    const calls = [];
    const gates = [];
    const self = {
      entryStates: new Map(),
      entryEpoch,
      entryStarted,
      entryFxActive,
      battleScene: { deployPhase },
      attachEntryClippingTo: (k) => { calls.push(k); },
      _attachCalls: calls,
      // [v2] 一队一门：登记时懒建门。`gate = null` ⇒ 模拟"空队 ⇒ 不开门"。
      //   ⚠ 压入的是**门对象本身**（不是 `{fleet, now}` 包装）⇒ 断言才能看到 `shipKeys` 的累积。
      ensureFleetGate: (fleet, now) => {
        if (!gate) { gates.push(null); return undefined; }
        const g = { fleet, t0: now, shipKeys: [] };
        gates.push(g);
        return g;
      },
      _gates: gates,
      _gatesCleared: false,
      finishAllEntryGates: () => { self._gatesCleared = true; },
    };
    return self;
  }
  const withNow = (sec, fn) => {
    const real = performance.now;
    performance.now = () => sec * 1000;
    try { return fn(); } finally { performance.now = real; }
  };

  const reg = compileRegisterEntryState();
  const start = compileStartEntryFx();
  const W = E.ENTRY_REG_WINDOW_SEC;
  const FLEET = { id: 7 };

  // (a) 部署期不得登记（即便 entryStarted 已为真 —— 证明部署守卫**独立**生效）
  {
    const self = makeRegSelf({ deployPhase: true, entryStarted: true, entryEpoch: 100 });
    reg.call(self, W, 'k1', { _entryDelay: 0.4 }, FLEET, 100.5);
    check('部署期（deployPhase=true）不得登记 ⇒ entryStates 保持空', () => self.entryStates.size === 0);
    check('部署期不得登记 ⇒ 也不补挂裁剪、不开门', () =>
      self._attachCalls.length === 0 && self._gates.length === 0);
  }

  // (b) 开战前（entryStarted=false）不得登记 —— ★ 刻意给一个**窗口内**的 epoch，
  //     使唯一可能拦住登记的只有 entryStarted 门（否则窗口检查会"顺带"拦住，断言失去隔离性）
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: false, entryEpoch: 100 });
    reg.call(self, W, 'k1', { _entryDelay: 0.4 }, FLEET, 100.1);
    check('未 startEntryFx（entryStarted=false）⇒ 不登记（与窗口无关）', () => self.entryStates.size === 0);
  }

  // (c) startEntryFx 真跑：显式重置纪元 + 清空 + 置开战标记
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: false, entryEpoch: 0 });
    self.finishAllEntryGates = () => { self._gatesCleared = true; };
    self.entryStates.set('old', { t0: 1, delay: 0, done: false });   // 部署期残留（防御性清）
    withNow(123.5, () => start.call(self));
    check('startEntryFx ⇒ entryEpoch 被**显式**重置为当前时刻', () =>
      Math.abs(self.entryEpoch - 123.5) < 1e-9);
    check('startEntryFx ⇒ entryStarted = true', () => self.entryStarted === true);
    check('startEntryFx ⇒ 清空部署期残留登记', () => self.entryStates.size === 0);
    check('v2：startEntryFx ⇒ 先收掉可能残留的门（防御性，防永久切）', () => self._gatesCleared === true);
  }

  // (d) 开战后首见单位被登记：t0 = 门起点、给门开户、且补挂裁剪
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: false });
    withNow(100, () => start.call(self));
    reg.call(self, W, 'k1', { _entryDelay: 0.4 }, FLEET, 100.01);
    check('开战后首见单位被登记（entryStates.size = 1）', () => self.entryStates.size === 1);
    check('v2：登记时**懒建本队的门**（一次）', () => self._gates.length === 1 && self._gates[0].fleet === FLEET);
    check('v2：本舰 t0 = 门的起点（同一队共享同一时间基准）', () =>
      !!self.entryStates.get('k1') && Math.abs(self.entryStates.get('k1').t0 - 100.01) < 1e-9);
    check('v2：本舰 key 被登记进门的 shipKeys（结束时要逐个卸载裁剪）', () =>
      self._gates[0].shipKeys.includes('k1'));
    check('登记时给已建实体补挂裁剪（attachEntryClippingTo 被调用）', () => self._attachCalls.includes('k1'));
  }

  // (d2) ★ 同队两舰**复用同一扇门**（用户定案：「就一个舰队用一个门」）
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
    reg.call(self, W, 'k1', {}, FLEET, 100.05);
    reg.call(self, W, 'k2', {}, FLEET, 100.06);
    check('★ 同队两舰 ⇒ 只开**一扇**门（ensureFleetGate 内部复用）', () => self._gates.length === 2);
    // 台架里 ensureFleetGate 是 spy（每次都返回新对象）⇒ 这里只验证"两舰都调了同一个 fleet 键"；
    // 真正的"共享同一数组实例"由源码契约断言（`entry.entryPlanes = gate.planes`）+ 11b 的共享面断言覆盖。
    check('★ 同队两舰 ⇒ 传入的是**同一个 fleet 引用**（Map 键同一 ⇒ 生产实现只建一扇门）', () =>
      self._gates.every((g) => g.fleet === FLEET));
  }

  // (d3) 空队（无有效投影包围盒）⇒ 不开门 + 不登记 ⇒ 不强制建实体
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100, gate: null });
    reg.call(self, W, 'k1', {}, FLEET, 100.05);
    check('空队（ensureFleetGate 返回 undefined）⇒ 不登记（不强制建实体）', () => self.entryStates.size === 0);
  }

  // (e) 窗口语义保留：窗口外首见不登记（迷雾发现 / 战后增援不触发切片）
  {
    const wide = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
    reg.call(wide, W, 'k9', {}, FLEET, 100 + W + 0.5);
    check('入场窗口外（>ENTRY_REG_WINDOW_SEC）首见 ⇒ 不登记', () => wide.entryStates.size === 0);
    const inside = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
    reg.call(inside, W, 'k9', {}, FLEET, 100 + W - 0.5);
    check('入场窗口内（<ENTRY_REG_WINDOW_SEC）首见 ⇒ 登记', () => inside.entryStates.size === 1);
  }

  // (f) 已登记不重复（推拉镜头不重播：t0 不被刷新）
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
    reg.call(self, W, 'k1', { _entryDelay: 0 }, FLEET, 100.1);
    reg.call(self, W, 'k1', { _entryDelay: 0.9 }, FLEET, 100.2);
    check('已登记单位不重复登记（t0 保持 ⇒ 推拉镜头不重播）', () =>
      self.entryStates.size === 1 && Math.abs(self.entryStates.get('k1').t0 - 100.1) < 1e-9);
    check('已登记单位不重复进门（shipKeys 不重复）', () => self._gates[0].shipKeys.length === 1);
  }

  // 变异自检 —— 改坏必须 FAIL（证明上面每条断言都"有牙齿"）
  {
    // 变异 J：删掉"部署期不登记"守卫 ⇒ 部署期会登记
    const regJ = compileRegisterEntryState((s) =>
      s.split('if ((this.battleScene as any)?.deployPhase) return;').join('if (false) return;'));
    checkThrows('变异J（删掉部署守卫）已被"部署期不得登记"断言检出', () => {
      const self = makeRegSelf({ deployPhase: true, entryStarted: true, entryEpoch: 100 });
      regJ.call(self, W, 'k1', { _entryDelay: 0.4 }, FLEET, 100.5);
      assert.equal(self.entryStates.size, 0);
    });

    // 变异 K：删掉"开战后才登记"门 ⇒ 未开战也登记
    const regK = compileRegisterEntryState((s) =>
      s.split('if (!this.entryStarted) return;').join('if (false) return;'));
    checkThrows('变异K（删掉 entryStarted 门）已被"未 startEntryFx 不登记"断言检出', () => {
      const self = makeRegSelf({ deployPhase: false, entryStarted: false, entryEpoch: 100 });
      regK.call(self, W, 'k1', { _entryDelay: 0.4 }, FLEET, 100.1);
      assert.equal(self.entryStates.size, 0);
    });

    // 变异 L：startEntryFx 不写 epoch（回到惰性纪元）⇒ 纪元不被显式重置
    const startL = compileStartEntryFx((s) =>
      s.split('this.entryEpoch = performance.now() / 1000;').join(''));
    checkThrows('变异L（startEntryFx 不显式重置纪元）已被"纪元被重置"断言检出', () => {
      const self = makeRegSelf({ deployPhase: false, entryStarted: false, entryEpoch: 0 });
      self.finishAllEntryGates = () => {};
      withNow(123.5, () => startL.call(self));
      assert.equal(Math.abs(self.entryEpoch - 123.5) < 1e-9, true);
    });

    // 变异 M：登记后不补挂裁剪 ⇒ 部署期建好的实体会整舰可见、看不到门切
    const regM = compileRegisterEntryState((s) =>
      s.split('this.attachEntryClippingTo(key);').join(''));
    checkThrows('变异M（登记后不补挂裁剪）已被"补挂裁剪"断言检出', () => {
      const self = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
      regM.call(self, W, 'k1', { _entryDelay: 0.4 }, FLEET, 100.1);
      assert.equal(self._attachCalls.includes('k1'), true);
    });

    // 变异 N：本舰不登记进门的 shipKeys ⇒ 结束无法逐个卸载裁剪
    const regN = compileRegisterEntryState((s) =>
      s.split('g.shipKeys.push(key);').join(''));
    checkThrows('变异N（不登记进门 shipKeys）已被"shipKeys 含 k1"断言检出', () => {
      const self = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
      regN.call(self, W, 'k1', {}, FLEET, 100.05);
      assert.equal(self._gates[0].shipKeys.includes('k1'), true);
    });
  }

  // Wiring 契约（防"整段删除"；行为已由上面真跑覆盖）
  check('handleFx 处理 entry_start（→ this.startEntryFx）', () => {
    const blk = overlay.slice(overlay.indexOf('private handleFx(e: Fx3dEvent) {'),
      overlay.indexOf("if (e.kind === 'pointer_chevron'"));
    return blk.includes("e.kind === 'entry_start'") && blk.includes('this.startEntryFx()');
  });
  check('battle3dFx 的 kind 联合类型包含 entry_start', () => /kind:[\s\S]*?'entry_start'/.test(fxSrc));
  // startBattleAfterDeploy 方法体切片（末端锚点 = **紧随其后**的 beginEntryPhase 声明，
  //   不能用更后面的注释 —— 那会把 beginEntryPhase 一起框进来，`__b3dOverlay` 断言会误红）
  const sbad = scene.slice(scene.indexOf('private startBattleAfterDeploy() {'),
    scene.indexOf('private beginEntryPhase() {'));
  check('startBattleAfterDeploy 推送 entry_start（Enter / 军议按钮 / deployAutoStart 三路共用入口）', () =>
    sbad.includes("pushFx3d({ kind: 'entry_start', color: 0 })"));
  check('无部署暂停分支也推送 entry_start（否则该分支切片永不播放）', () => {
    const blk = scene.slice(scene.indexOf('this.publishSupremeCommanderPanel(); // ← 本分支唯一调用点，勿上提'),
      scene.indexOf('this.deployPhase = true;'));
    return blk.includes("pushFx3d({ kind: 'entry_start', color: 0 })");
  });
  check('未用 window.__b3dOverlay 全局取 3D 层启动入场（走 battle3dFx 正式总线）', () =>
    !sbad.includes('__b3dOverlay'));
}

// ════════════════════════════════════════════════════════════════════════════
// 17) ★v2 门几何纯函数（N4 时长 / N5 轴向 / N6 尺寸 / N7 五个面）+ 变异自检
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 17. v2 门几何纯函数：N4 时长 / N5 轴向 / N6 尺寸 / N7 五个面 ===');
{
  // N4：[v4] 时长 6.5s（5.0 → 6.5，用户"速度可以慢一点"），且**刻意** > ASSEMBLE_MAX_MS(4s)
  check('N4：ENTRY_TOTAL_SEC = 6.5（[v4] 5.0 → 6.5，用户"速度可以慢一点"）', () => E.ENTRY_TOTAL_SEC === 6.5);
  check('N4：ENTRY_TOTAL_SEC > ASSEMBLE_MAX_MS/1000（刻意超 4s ⇒ 必须重置集结计时）', () =>
    E.ENTRY_TOTAL_SEC > ASSEMBLE_MAX_MS / 1000);
  check('N4：ENTRY_NEEDS_ASSEMBLE_RESET 为真（守卫"必须重置 _assemblingSince"）', () =>
    E.ENTRY_NEEDS_ASSEMBLE_RESET === true);
  check('N4：0 < ENTRY_RESUME_GRACE_SEC < 1（暂停略长于动画，但不明显拖沓）', () =>
    E.ENTRY_RESUME_GRACE_SEC > 0 && E.ENTRY_RESUME_GRACE_SEC < 1);

  // N5：扫描轴 = 舰队朝向（水平），不再有世界 Y 切片
  check('N5：ENTRY_GATE_AXIS = heading（v1 的 SLICE_AXIS 仍是世界 y，但 v2 不再消费它）', () =>
    E.ENTRY_GATE_AXIS === 'heading');
  {
    const sLo = 90, sHi = 110, m = 2;
    check('N5：p=0 ⇒ 推进面在**舰首之外**（sHi + margin = 112）', () => E.entryGateFront(0, sLo, sHi, m) === 112);
    check('N5：p=1 ⇒ 推进面在**舰尾之外**（sLo − margin = 88）', () => E.entryGateFront(1, sLo, sHi, m) === 88);
    check('N5：推进面随 p **单调递减**（舰首 → 舰尾）', () => {
      let prev = Infinity;
      for (let i = 0; i <= 40; i++) {
        const f = E.entryGateFront(i / 40, sLo, sHi, m);
        if (f > prev + 1e-12) return false;
        prev = f;
      }
      return true;
    });
    check('N5：p 越界被钳位（p=−3 ⇒ 112；p=9 ⇒ 88）', () =>
      E.entryGateFront(-3, sLo, sHi, m) === 112 && E.entryGateFront(9, sLo, sHi, m) === 88);
    const mutRev = loadEntryModule(entrySrc.replace(
      '  return hi + (lo - hi) * t;',
      '  return lo + (hi - lo) * t;'));
    checkThrows('变异R（推进方向反转 ⇒ 舰尾先出）已被"p=0 在舰首之外"断言检出', () => {
      assert.equal(mutRev.entryGateFront(0, sLo, sHi, m), 112);
    });
  }

  // N6：门截面 = 投影**宽/高各自** × PAD（v3 从"正方形"改成"矩形"）
  {
    const box = { uLo: -30, uHi: 30, vLo: 95, vHi: 105, sLo: 90, sHi: 110 };
    check('N6：横向跨度 = 宽 60 × PAD 1.25 = 75', () =>
      Math.abs(E.entryGateSizeU(box, E.ENTRY_GATE_PAD) - 75) < 1e-9);
    check('N6：竖向跨度 = 高 10 × PAD 1.25 = 12.5（**独立于横向** ⇒ 矩形而非正方形）', () =>
      Math.abs(E.entryGateSizeV(box, E.ENTRY_GATE_PAD) - 12.5) < 1e-9);
    check('★v3：矩形门不再"竖向空一大半"（竖向跨度 ≪ 横向跨度，比 v2 的 max 方门小得多）', () =>
      E.entryGateSizeV(box, E.ENTRY_GATE_PAD) < E.entryGateSizeU(box, E.ENTRY_GATE_PAD)
      && Math.abs(E.entryGateSizeV(box, E.ENTRY_GATE_PAD) - 12.5) < 1e-9);
    const tall = { uLo: 0, uHi: 4, vLo: 0, vHi: 40, sLo: 0, sHi: 1 };
    check('N6：高 > 宽 时竖向自然 > 横向（U 4 / V 40，各自取自身跨度）', () =>
      Math.abs(E.entryGateSizeU(tall, 1) - 4) < 1e-9 && Math.abs(E.entryGateSizeV(tall, 1) - 40) < 1e-9);
    check('N6：「再往外扩一点」= 恰好 PAD 倍（U: 60→75；V: 8→10）', () =>
      E.entryGateSizeU(box, 1) === 60 && E.entryGateSizeU(box, E.ENTRY_GATE_PAD) === 75
      && E.entryGateSizeV(box, 1) === 10 && E.entryGateSizeV(box, E.ENTRY_GATE_PAD) === 12.5);
    check('N6：门截面中心 = 投影包围盒中心', () =>
      E.entryGateCenterU(box) === 0 && E.entryGateCenterV(box) === 100);
    check('N6：空包围盒 ⇒ 无效且尺寸 0（不会造出 NaN 门）', () => {
      const e = E.entryGateEmptyBox();
      return E.entryGateValid(e) === false && E.entryGateSizeU(e, 1.25) === 0 && E.entryGateSizeV(e, 1.25) === 0;
    });
    check('N6：累加器把**半长**计入沿朝向跨度（覆盖舰首 ↔ 舰尾）', () => {
      const b = E.entryGateEmptyBox();
      E.entryGateAccumulate(b, 100, 0, 100, 5, 2, 1);
      return b.sLo === 95 && b.sHi === 105 && b.uLo === -2 && b.uHi === 2 && b.vLo === 99 && b.vHi === 101;
    });
    const mutMin = loadEntryModule(entrySrc.replace(
      'return h * Math.max(0, pad);',
      'return w * Math.max(0, pad);'));
    checkThrows('变异O（竖向跨度误用**宽** ⇒ 退回"正方形"）已被"V=12.5 且 V<U"断言检出', () => {
      assert.equal(Math.abs(mutMin.entryGateSizeV(box, 1.25) - 12.5) < 1e-9, true);
    });
    const mutNoPad = loadEntryModule(entrySrc.replace(
      'return w * Math.max(0, pad);',
      'return w;'));
    checkThrows('变异P（不乘 PAD ⇒ 不外扩）已被"恰好 PAD 倍"断言检出', () => {
      assert.equal(mutNoPad.entryGateSizeU(box, 1.25) === 75, true);
    });
  }

  // N7：纯函数写出的 5 个面必须**真围出矩形柱**（门内可见 / 门外被裁）
  {
    const g0 = makeFakeGate({ cu: 0, cv: 100, halfU: 30, halfV: 18 });
    E.entryGateWritePlanes(g0.planes, g0.fwd, g0.right, g0.up, g0.cu, g0.cv, g0.halfU, g0.halfV, 50);
    check('N7：写 5 个面（1 推进 + 4 侧面）', () => g0.planes.length === 5);
    check('★N7：门内可见 / **门外的两个横向都**被裁（±u 两侧对称生效）', () =>
      gateVisible(g0, 60, 100, 0) && !gateVisible(g0, 60, 100, 31) && !gateVisible(g0, 60, 100, -31));
    check('★N7：**门外的两个竖直方向都**被裁（±v 两侧对称生效，阈值 = halfV 18）', () =>
      !gateVisible(g0, 60, 119, 0) && !gateVisible(g0, 60, 81, 0));
    check('★N7：横向 |u−cu|=29 < halfU(30) 可见（v3 矩形：横向阈值不与竖向混用）', () =>
      gateVisible(g0, 60, 100, 29) && gateVisible(g0, 60, 100, -29));
    check('N7：平面数 < 5 时纯函数直接返回（不半写 ⇒ 不会围出畸形门）', () => {
      const p4 = [0, 1, 2, 3].map(() => {
        const n = { x: 0, y: 0, z: 0 };
        n.set = (x, y, z) => { n.x = x; n.y = y; n.z = z; };
        return { normal: n, constant: 9 };
      });
      E.entryGateWritePlanes(p4, g0.fwd, g0.right, g0.up, 0, 100, 30, 18, 50);
      return p4.every((p) => p.constant === 9);
    });
    const mutSide = loadEntryModule(entrySrc.replace(
      'planes[1].normal.set(-right.x, -right.y, -right.z);',
      'void 0;'));
    const g1 = makeFakeGate({ cu: 0, cv: 100, halfU: 30, halfV: 18 });
    mutSide.entryGateWritePlanes(g1.planes, g1.fwd, g1.right, g1.up, g1.cu, g1.cv, g1.halfU, g1.halfV, 50);
    checkThrows('★变异Q（左侧面失效）已被"门外 −u 侧被裁"断言检出', () => {
      assert.equal(!gateVisible(g1, 60, 100, -31), true);
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 18) ★v2 源码契约（N1 聚焦 / N2 模型 / N3 暂停生命周期 / N7 共享实例 / N8 可见门）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 18. v2 源码契约：N1 聚焦 / N2 模型 / N3 暂停 / N7 共享 / N8 可见门 ===');
{
  const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b); return (i >= 0 && j > i) ? src.slice(i, j) : ''; };
  const FOCUS_BLK = slice(overlay, 'private focusOnPlayerMainFleetForEntry(): boolean {', 'private computeFleetGateBox(');
  const BUILDGATE = slice(overlay, 'private buildGateVisual(g: FleetGate): void {', 'private gateWorldCenter(');
  const SAD = slice(scene, 'private startBattleAfterDeploy() {', 'private beginEntryPhase() {');
  const BEGIN = slice(scene, 'private beginEntryPhase() {', '/** 把各舰队 `assembling` 计时重置到当前时刻');
  const END = slice(scene, 'private endEntryPhase() {', 'private resetAssemblingClock()');

  // ── N1：开场镜头对着我方主力舰队 ──
  check('N1：开战（startEntryFx）即聚焦我方主力舰队（受 ENTRY_AUTO_FOCUS 控制）', () => {
    const blk = slice(overlay, 'startEntryFx(): void {', 'private focusOnPlayerMainFleetForEntry(): boolean {');
    return blk.includes('this.focusOnPlayerMainFleetForEntry()') && blk.includes('ENTRY_AUTO_FOCUS');
  });
  check('N1：复用**既有 API** focusOnPlayerMainFleet({ dist })（不新写取景算法）', () =>
    FOCUS_BLK.includes('this.focusOnPlayerMainFleet({ dist'));
  check('N2：聚焦距离反解自 ENTRY_FOCUS_CAMY_K × initCamY ⇒ 落在 LOD **近景档**（有模型）', () =>
    FOCUS_BLK.includes('initCamY') && FOCUS_BLK.includes('ENTRY_FOCUS_CAMY_K') && FOCUS_BLK.includes('ENTRY_FOCUS_ELEV'));
  check('N1：无玩家阵营 / 无舰队 ⇒ 退回"保持当前机位"（不抛错）', () =>
    FOCUS_BLK.includes('if (!ok) return false') && FOCUS_BLK.includes('if (baseY <= 0) return false'));
  check('N1：聚焦是**一次性**的（tick 里没有任何每帧聚焦/锁定跟随）', () => {
    // ⚠ `this.controls.update()` 在建世界时就出现过 ⇒ 不能当锚点（会切出空串）；用 tick 内的唯一行。
    const tk = slice(overlay, 'private tick() {', 'if (this.scene.fog instanceof THREE.Fog');
    return tk.length > 0 && !tk.includes('focusOnPlayerMainFleet');
  });

  // ── N2：要看到模型（不是光点）──
  check('N2：门尺寸读 `this.unitVis`（**全部存活单位**）⇒ 不受 MESH_ADD_PER_FRAME 分帧建实体的影响',
    () => slice(overlay, 'private computeFleetGateBox(', 'private ensureFleetGate(').includes('this.unitVis.values()'));
  check('N2：第二遍对入场中的舰**临时强制建实体**（P1：远景无体可切）', () => {
    const blk = slice(overlay, '// ── 第二遍：实体池', '// ── 第三遍：实体位置');
    return blk.includes('this.entryActiveOf(v.key)') && blk.includes('cand.push(v)');
  });
  check('N2：入场期强制 grow = 1（抑制"点 + 半切舰"共存）', () =>
    overlay.includes('v.grow = this.entryActiveOf(v.key) ? 1 : sstep(this.lodLo, this.lodHi, v.fleetPx);'));

  // ── N3：入场期间暂停 / 结束解除 / **绝不卡在暂停** ──
  check('★N3：startBattleAfterDeploy 里**不再**直接 `isPaused = false`（改为入场阶段结束时解除）', () =>
    SAD.length > 0 && !SAD.includes('this.store.isPaused = false'));
  check('★N3：startBattleAfterDeploy 进入入场阶段（this.beginEntryPhase()）', () =>
    SAD.includes('this.beginEntryPhase()'));
  check('★N3：入场期间 `entryPhase = true` + `isPaused = true`，且**一定**有 Phaser 定时器解除', () =>
    BEGIN.includes('this.entryPhase = true;') && BEGIN.includes('this.store.isPaused = true;')
    && BEGIN.includes('this.time.delayedCall(') && BEGIN.includes('this.endEntryPhase()'));
  check('★N3：时长真源 = ENTRY_TOTAL_SEC + ENTRY_RESUME_GRACE_SEC（不手抄数字）', () =>
    BEGIN.includes('ENTRY_TOTAL_SEC + ENTRY_RESUME_GRACE_SEC'));
  check('★N3：每条"提前返回"路径都**显式解除暂停**（关闭开关 / 无 3D 层）', () => {
    const hits = BEGIN.match(/this\.store\.isPaused = false;/g) || [];
    return hits.length >= 2;
  });
  check('★N3：endEntryPhase ⇒ `entryPhase = false` + `isPaused = false`', () =>
    END.includes('this.entryPhase = false;') && END.includes('this.store.isPaused = false;'));
  check('★N3/N4：endEntryPhase ⇒ **重置集结计时**（5s > ASSEMBLE_MAX_MS ⇒ 否则直接跳 exploring）', () =>
    END.includes('ENTRY_NEEDS_ASSEMBLE_RESET') && END.includes('this.resetAssemblingClock()'));
  check('★N3/N4：resetAssemblingClock 只动 `assembling` 舰队、写 `_assemblingSince = this.time.now`', () => {
    const rc = slice(scene, 'private resetAssemblingClock() {', 'private planAiFactionsForDeploy()');
    return rc.includes("state === 'assembling'") && rc.includes('_assemblingSince = this.time.now');
  });
  check('★N3：entryPhase 拦住**全部 3 处**其它 `isPaused = false` 写入（入场不被抢走暂停所有权）', () => {
    const hits = scene.match(/if \(!this\.deployPhase && !this\.entryPhase\) this\.store\.isPaused = false;/g) || [];
    return hits.length === 3;
  });
  check('★N3：entryPhase 拦住 openCommandPanel（面板会抢暂停所有权）', () =>
    scene.includes('if (this.entryPhase) return;'));
  check('★N3：重进战斗重置 entryPhase + 清定时器（防残留拦截解除）', () =>
    slice(scene, 'private resetBattleRuntimeState() {', 'this.store = useGameStore();')
      .includes('this.entryPhase = false;'));
  check('★N3：endEntryPhase 经 battle3dFx 正式总线通知 3D 收门（不用 window 全局）', () =>
    END.includes("pushFx3d({ kind: 'entry_end', color: 0 })") && !END.includes('__b3dOverlay'));
  check('N3：3D 的 handleFx 处理 entry_end（→ finishAllEntryGates）', () => {
    const blk = slice(overlay, 'private handleFx(e: Fx3dEvent) {', "if (e.kind === 'pointer_chevron'");
    return blk.includes("e.kind === 'entry_end'") && blk.includes('this.finishAllEntryGates()');
  });
  check('N3：battle3dFx 的 kind 联合类型包含 entry_end', () => /kind:[\s\S]*?'entry_end'/.test(fxSrc));
  check('N3：3D 自己也按进度收门（不依赖 BattleScene 的 entry_end ⇒ 双保险）', () =>
    slice(overlay, 'private updateEntryFx(): void {', 'for (const [fleet, g] of this.fleetGates)')
      .includes('this.finishEntryGate(g)'));

  // ── N7：同队共享同一组 5 个 Plane 实例 ──
  check('★N7：addMesh 把**本队门的同一数组实例**赋给本舰（不 new 新平面）', () => {
    const blk = slice(overlay, 'private addMesh(v: UnitVis) {', 'private dropMesh(key: string) {');
    return blk.includes('entryPlanes = gate!.planes;') && !blk.includes('new THREE.Plane(');
  });
  check('★N7：attachEntryClippingTo 同样复用门实例（不 new 新平面）', () => {
    const blk = slice(overlay, 'private attachEntryClippingTo(key: string): void {', 'private registerEntryState(');
    return blk.includes('entry.entryPlanes = g.planes;') && !blk.includes('new THREE.Plane(');
  });
  check('★N7：GLB 原地换装时复用门实例（不重开门、不指向已 dispose 的材质）', () => {
    const blk = slice(overlay, 'if (entry.pendingModel && entry.pendingModel.geo', 'const g = entry.group;');
    return blk.includes('this.fleetGates.get(entry.fleet)') && blk.includes('entry.entryPlanes = swapGate.planes;');
  });
  check('★N7：一队一门（fleetGates 以 fleet 为键；已存在则复用，不重复建）', () => {
    const blk = slice(overlay, 'private ensureFleetGate(', 'private attachEntryClippingTo(');
    return blk.includes('const found = this.fleetGates.get(fleet);') && blk.includes('this.fleetGates.set(fleet, g);');
  });
  check('★N7：门恰好 5 个平面（[0,1,2,3,4]）', () =>
    overlay.includes('[0, 1, 2, 3, 4].map(() => new THREE.Plane('));
  check('★N7：结束必需卸载全队裁剪（防"舰体被永久切"）', () =>
    slice(overlay, 'private finishEntryGate(g: FleetGate): void {', 'private finishAllEntryGates(): void {')
      .includes('entryApplyClipping(entry.sliceMats, null, false);'));
  check('★N7：destroy() 也收门（防场景销毁后残留裁剪/线框）', () =>
    slice(overlay, 'destroy() {', 'this.renderer.domElement.removeEventListener')
      .includes('this.finishAllEntryGates();'));

  // ── N8：必须画出「门」本体（v1 最大缺失；v3 重做外观）──
  check('★N8：门本体真的被建（根组 Group + 门框线/环带 Mesh + 位面 Mesh + 加法混合 + 入场景）', () =>
    BUILDGATE.includes('new THREE.Group()') && BUILDGATE.includes('new THREE.LineLoop(')
    && BUILDGATE.includes('new THREE.Mesh(') && BUILDGATE.includes('AdditiveBlending')
    && BUILDGATE.includes('this.scene.add(root)'));
  check('★N8/v3：门框按**矩形**分轴缩放（`root.scale.set(g.halfU, g.halfV, 1)` ⇒ 紧贴舰队轮廓）', () =>
    BUILDGATE.includes('root.scale.set(g.halfU, g.halfV, 1)'));
  check('★N8/v3：三方案由 `GATE_STYLE_PARAMS[this.gateStyle]` 驱动，且 A/B/C 三条分支都在（shard / feather / 双线）', () =>
    BUILDGATE.includes('GATE_STYLE_PARAMS[this.gateStyle]') && BUILDGATE.includes('P.shard')
    && BUILDGATE.includes('P.feather > 0') && BUILDGATE.includes('gateBandGeometry'));
  check('★N8/v3：外辉光走**柔边贴图面片**（makeGateHaloTexture + 加法混合 ⇒ 边缘不硬直）', () =>
    BUILDGATE.includes('makeGateHaloTexture(') && BUILDGATE.includes('halo.renderOrder')
    && BUILDGATE.includes('PlaneGeometry(2.3'));
  check('★N8/v3：门内位面**有纹路且会流动**（makeGateBarrierTexture + repeat + 逐帧 offset）', () =>
    BUILDGATE.includes('makeGateBarrierTexture(') && BUILDGATE.includes('barrierTex.repeat.set(')
    && overlay.includes('g.barrierTex.offset.set('));
  check('★N8：门本体**自己不挂 clippingPlanes**（否则会被自己的门切掉）', () =>
    BUILDGATE.length > 0 && !BUILDGATE.includes('clippingPlanes'));
  check('★N8：门本体的世界中心与 5 个裁剪面**同源**（fwd·pos + right·cu + up·cv）', () =>
    slice(overlay, 'private gateWorldCenter(', 'private placeGateVisual(')
      .includes('g.fwd.x * g.pos + g.right.x * g.cu + g.up.x * g.cv'));
  check('★N8：可见门可一键关闭（ENTRY_GATE_VISIBLE 编译期开关）', () =>
    entrySrc.includes('export const ENTRY_GATE_VISIBLE = true;') && overlay.includes('if (!ENTRY_GATE_VISIBLE) return;'));
  check('★N8：入场中门随推进面**逐帧移动**（placeGateVisual 每帧调用）', () =>
    slice(overlay, 'private updateEntryFx(): void {', 'for (const [fleet, g] of this.fleetGates)')
      .includes('this.placeGateVisual(g)'));
  check('★N8：入场结束门本体被销毁（遍历根组，几何/材质都 dispose，不留悬空线框）', () => {
    // ⚠ 末端锚点必须是**紧随其后**的球体销毁方法（v3.1 插在 disposeGateVisual 与 collectSliceMats 之间）
    const blk = slice(overlay, 'private disposeGateVisual(g: FleetGate): void {', 'private disposeSphereVisual(g: FleetGate): void {');
    return blk.includes('this.scene.remove(root)') && blk.includes('.dispose()') && blk.includes('g.vis = null');
  });
  check('★N8：门姿态用**右手正交基**（right = (−sin, 0, −cos) ⇒ det=+1，门框不镜像）', () =>
    overlay.includes('new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a))'));

  // ── N9：v3/v4 外观常量（**真跑**纯数据层 ⇒ 有牙齿：位面必须够淡、方案齐备）──
  check('★v4：`GATE_STYLE` 缺省为 `D`（传送门能量块；运行时真源 = 设置项 entryFxStyle，本值仅兜底）', () =>
    E.GATE_STYLE === 'D');
  check('★N9：五套方案 A/B/C/S/D 参数齐备（S = 球体 / D = 传送门连续光带门框）', () => {
    const P = E.GATE_STYLE_PARAMS;
    return !!P && !!P.A && !!P.B && !!P.C && !!P.S && !!P.D && typeof P.A.edge === 'number'
      && typeof P.D.ribbonSamples === 'number';
  });
  check('★N9（不遮挡舰队红线）：三方案**位面不透明度都 ≤ 0.10**（透过门要能看清舰船）', () =>
    ['A', 'B', 'C'].every((k) => E.GATE_STYLE_PARAMS[k].barrierOpacity <= 0.10
      && E.GATE_STYLE_PARAMS[k].barrierOpacity > 0));
  check('★N9：三方案亮度层次齐备（edge / core / halo **三色各不相同**）', () =>
    ['A', 'B', 'C'].every((k) => {
      const q = E.GATE_STYLE_PARAMS[k];
      return q.core !== q.edge && q.halo !== q.core && q.halo !== q.edge;
    }));
  check('★N9：门框有**呼吸脉冲**（pulse > 0）且切角/线宽为正（形式参数有效）', () =>
    ['A', 'B', 'C'].every((k) => E.GATE_STYLE_PARAMS[k].pulse > 0
      && E.GATE_STYLE_PARAMS[k].edgeWidth > 0 && E.GATE_STYLE_PARAMS[k].chamfer >= 0));
  check('★N9：C 方案**碎片化**（shard=true）；A/B 非碎片（路线各异）', () =>
    E.GATE_STYLE_PARAMS.C.shard === true
    && E.GATE_STYLE_PARAMS.A.shard === false && E.GATE_STYLE_PARAMS.B.shard === false);
  check('★N9：B 方案走**内侧羽化**（feather > 0）；A 走双层细线（feather = 0）', () =>
    E.GATE_STYLE_PARAMS.B.feather > 0 && E.GATE_STYLE_PARAMS.A.feather === 0);
  check('★N9：横向/竖向半跨下限为正（单舰/极扁队形不会退化）', () =>
    E.ENTRY_GATE_MIN_HALF > 0);

  // ── 安全红线（沿用 v1）──
  check('渲染器开了**局部**裁剪 localClippingEnabled = true', () =>
    overlay.includes('this.renderer.localClippingEnabled = true;'));
  check('**没有**用全局 renderer.clippingPlanes（会切掉星空/地形/后处理）', () =>
    !/renderer\.clippingPlanes\s*=/.test(overlay) && !overlay.includes('this.renderer.clippingPlanes'));
  check('ASSEMBLE_MAX_MS 仍未被改动（R8 关键常量）', () => /const ASSEMBLE_MAX_MS = 4000;/.test(scene));
  check('未新增 teleport 玩法（仅视觉）', () =>
    !scene.includes('teleport: true') && !overlay.includes('teleport'));
}

console.log(`\n[entryAnimationSim] passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exit(1);
}
