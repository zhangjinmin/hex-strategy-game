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
// 11) 真跑 Wiring：Battle3DOverlay.updateEntryFx（原文切片 + 去型 + 执行）
// ════════════════════════════════════════════════════════════════════════════
const UEF_START = 'private updateEntryFx(): void {';
const UEF_END = 'this.entryGlow.instanceMatrix.needsUpdate = true;';

/** 编译 updateEntryFx 的**原文**（保留 `this.`，注入纯函数与常量）。 */
function compileUpdateEntryFx(mutate) {
  let body = extractUnique(overlay, UEF_START, UEF_END, UEF_END.length);
  body = body.split(UEF_START).join('');
  body += '\n}';   // 收掉 `if (this.entryGlow) {`（签名里的 `{` 已随签名一起被切掉，故只补 1 个）
  return compile(
    `(function(ENTRY_GLOW_MAX, SLICE_HALF_SPAN_K, SLICE_GLOW_SPAN_K, entryShipProgress, stepEntrySlice, entryApplyClipping, entryWritePlanes, E) {\n${body}\n})`,
    mutate,
  );
}

/** 造一个假的 overlay `this`（只提供被 updateEntryFx 消费的字段）。 */
function makeFakeOverlay({ states, ships, on = true }) {
  const glowCalls = [];
  const fakeGlow = {
    count: 0,
    instanceMatrix: { needsUpdate: false },
    setMatrixAt: (i, m) => { glowCalls.push({ i, pos: [m.px, m.py, m.pz], s: m.sx }); },
  };
  const dummy = {
    position: { set: (x, y, z) => { dummy._x = x; dummy._y = y; dummy._z = z; } },
    scale: { set: (x, y, z) => { dummy._sx = x; dummy._sy = y; dummy._sz = z; } },
    updateMatrix: () => {
      dummy.matrix = { px: dummy._x, py: dummy._y, pz: dummy._z, sx: dummy._sx };
    },
  };
  return {
    entryStates: states,
    ships,
    entryCfg: E.ENTRY_CFG_DEFAULT,
    entryGlow: fakeGlow,
    entryGlowDummy: dummy,
    entryFxOn: () => on,
    _glowCalls: glowCalls,
  };
}

const INJ = ['ENTRY_GLOW_MAX', 'SLICE_HALF_SPAN_K', 'SLICE_GLOW_SPAN_K', 'entryShipProgress', 'stepEntrySlice', 'entryApplyClipping', 'entryWritePlanes', 'E'];

function runUpdateEntryFx(fn, self, nowSec) {
  const realNow = performance.now;
  performance.now = () => nowSec * 1000;
  try {
    fn.call(self, E.ENTRY_GLOW_MAX, E.SLICE_HALF_SPAN_K, E.SLICE_GLOW_SPAN_K,
      E.entryShipProgress, E.stepEntrySlice, E.entryApplyClipping, E.entryWritePlanes, E);
  } finally {
    performance.now = realNow;
  }
}

console.log('\n=== 11. updateEntryFx 真跑：写平面常数 / 结束清裁剪 / 辉光同步 ===');
{
  const fn = compileUpdateEntryFx();
  const mkShip = (y, len) => ({ group: { position: { x: 10, y, z: -20 } }, u: { shipLen: len } });
  const half = 10 * E.SLICE_HALF_SPAN_K;
  const yLo = 100 - half;
  const yHi = 100 + half;

  // 场景 A：p = 0（刚开场）
  {
    const planes = [{ constant: E.entryPlaneInitConstant(1) }];
    const mats = [{ clippingPlanes: planes }];
    const states = new Map([['k1', { t0: 50, delay: 0, done: false }]]);
    const ships = new Map([['k1', { ...mkShip(100, 10), entryPlanes: planes, sliceMats: mats }]]);
    const self = makeFakeOverlay({ states, ships });
    runUpdateEntryFx(fn, self, 50);
    check('p=0 ⇒ 平面常数被推进到 yLo（不再停在初始值）', () =>
      Math.abs(planes[0].constant - yLo) < 1e-9);
    check('p=0 ⇒ 舰体内部采样点全不可见（平面在包围盒之外）', () =>
      SAMPLES.filter((y) => y > yLo + 1e-6 && y < yHi - 1e-6)
        .every((y) => !(1 * y <= planes[0].constant + 1e-9)));
    check('p=0 ⇒ 裁剪仍挂载（进场中，不误清）', () => mats[0].clippingPlanes === planes);
    check('p=0 ⇒ 状态未置 done（仍在入场）', () => states.get('k1').done === false);
    check('p=0 ⇒ 辉光计数 = 0（辉光包络两端为 0）', () => self.entryGlow.count === 0);
  }

  // 场景 B：中点（p ≈ 0.5）
  {
    const planes = [{ constant: 0 }];
    const mats = [{ clippingPlanes: planes }];
    const states = new Map([['k1', { t0: 50, delay: 0, done: false }]]);
    const ships = new Map([['k1', { ...mkShip(100, 10), entryPlanes: planes, sliceMats: mats }]]);
    const self = makeFakeOverlay({ states, ships });
    runUpdateEntryFx(fn, self, 50 + E.SLICE_DUR_PER_SHIP / 2);
    check('中点 ⇒ 平面常数 ≈ 包围盒中点', () =>
      Math.abs(planes[0].constant - (yLo + yHi) / 2) < 1e-9);
    check('中点 ⇒ 下半部可见 / 上半部不可见（真在"切"）', () =>
      (1 * yLo <= planes[0].constant) && !(1 * yHi <= planes[0].constant));
    check('中点 ⇒ 辉光生效（count = 1，位置 = 扫描平面）', () =>
      self.entryGlow.count === 1 && Math.abs(self._glowCalls[0].pos[1] - planes[0].constant) < 1e-9);
    check('中点 ⇒ 辉光盘半径 = 舰长 × SLICE_GLOW_SPAN_K', () =>
      Math.abs(self._glowCalls[0].s - 10 * E.SLICE_GLOW_SPAN_K) < 1e-9);
  }

  // 场景 C：t = 总时长（必须清空 clippingPlanes）
  {
    const planes = [{ constant: 0 }];
    const mats = [{ clippingPlanes: planes }];
    const states = new Map([['k1', { t0: 50, delay: 0.3, done: false }]]);
    const ships = new Map([['k1', { ...mkShip(100, 10), entryPlanes: planes, sliceMats: mats }]]);
    const self = makeFakeOverlay({ states, ships });
    runUpdateEntryFx(fn, self, 50 + 0.3 + E.SLICE_DUR_PER_SHIP + 1e-6);
    check('t=总时长 ⇒ clippingPlanes **已清空**（否则舰体被永久切）', () =>
      mats[0].clippingPlanes === null);
    check('t=总时长 ⇒ 状态置 done（不再逐帧空转）', () => states.get('k1').done === true);
    check('t=总时长 ⇒ 辉光计数归 0', () => self.entryGlow.count === 0);
  }

  // 场景 D：尚无实体 ⇒ 必须"保持等待"（绝不置 done，否则实体建好时错过入场）
  {
    const states = new Map([['k2', { t0: 50, delay: 0, done: false }]]);
    const self = makeFakeOverlay({ states, ships: new Map() });
    runUpdateEntryFx(fn, self, 50.1);
    check('尚无实体（远景/被池挤出）⇒ 状态**不置 done**（P1 的反面陷阱）', () =>
      states.get('k2').done === false);
    check('尚无实体 ⇒ 不抛错、辉光计数 0', () => self.entryGlow.count === 0);
    runUpdateEntryFx(fn, self, 50 + 99);
    check('尚无实体但时间早已超窗 ⇒ 置 done（不会永久强制建实体）', () =>
      states.get('k2').done === true);
  }

  // 场景 E：一键关闭（window.__entryFxEnabled = false / entryFxOn() = false）
  {
    const planes = [{ constant: 0 }];
    const mats = [{ clippingPlanes: planes }];
    const states = new Map([['k1', { t0: 50, delay: 0, done: false }]]);
    const ships = new Map([['k1', { ...mkShip(100, 10), entryPlanes: planes, sliceMats: mats }]]);
    const self = makeFakeOverlay({ states, ships, on: false });
    runUpdateEntryFx(fn, self, 50.1);
    check('一键关闭 ⇒ 立即清空 clippingPlanes（切换中途不残留）', () =>
      mats[0].clippingPlanes === null && states.get('k1').done === true);
  }
}

console.log('\n=== 12. updateEntryFx 变异自检（改坏 Wiring ⇒ 断言必须能红） ===');
{
  // 变异 F：结束分支被短路 ⇒ clippingPlanes 残留
  const fnF = compileUpdateEntryFx((s) => s.split('if (!on || p >= 1) {').join('if (false) {'));
  const planes = [{ constant: 0 }];
  const mats = [{ clippingPlanes: planes }];
  const states = new Map([['k1', { t0: 50, delay: 0, done: false }]]);
  const ships = new Map([['k1', { group: { position: { x: 0, y: 100, z: 0 } }, u: { shipLen: 10 }, entryPlanes: planes, sliceMats: mats }]]);
  const self = makeFakeOverlay({ states, ships });
  runUpdateEntryFx(fnF, self, 50 + 99);
  checkThrows('变异F（结束分支短路）已被"clippingPlanes 清空"断言检出', () => {
    assert.equal(mats[0].clippingPlanes, null);
  });

  // 变异 G：常数不写 ⇒ 平面停在初始值（永远不可见）
  const fnG = compileUpdateEntryFx((s) => s.split('if (entry.entryPlanes) entryWritePlanes(entry.entryPlanes, step.front);').join('if (false) {}'));
  {
    const planes = [{ constant: E.entryPlaneInitConstant(1) }];
    const mats = [{ clippingPlanes: planes }];
    const states = new Map([['k1', { t0: 50, delay: 0, done: false }]]);
    const ships = new Map([['k1', { group: { position: { x: 0, y: 100, z: 0 } }, u: { shipLen: 10 }, entryPlanes: planes, sliceMats: mats }]]);
    const self = makeFakeOverlay({ states, ships });
    runUpdateEntryFx(fnG, self, 110);
    checkThrows('变异G（不写平面常数）已被"中点 front"断言检出', () => {
      assert.equal(Math.abs(planes[0].constant - 100) < 1, true);
    });
  }

  // 变异 H：无实体也置 done ⇒ "实体建好时错过入场"
  const fnH = compileUpdateEntryFx((s) => s.split('if (!entry) return;').join('if (!entry) { st.done = true; return; }'));
  {
    const states = new Map([['k2', { t0: 50, delay: 0, done: false }]]);
    const self = makeFakeOverlay({ states, ships: new Map() });
    runUpdateEntryFx(fnH, self, 50.1);
    checkThrows('变异H（无实体即置 done）已被"保持等待"断言检出', () => {
      assert.equal(states.get('k2').done, false);
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
  const callIdx = block.indexOf('this.registerEntryState(key, u, now);');
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
check('扫描辉光层在构建期建立并被加入场景', () => {
  const block = overlay.slice(overlay.indexOf('private buildEntryGlow(): void {'), overlay.indexOf('private collectSliceMats('));
  return block.includes('new THREE.InstancedMesh(') && block.includes('this.scene.add(inst);')
    && block.includes('AdditiveBlending');
});
check('destroy() 清空入场状态与辉光引用', () => {
  const block = overlay.slice(overlay.indexOf('destroy() {'), overlay.indexOf('this.renderer.domElement.removeEventListener'));
  return block.includes('this.entryStates.clear()') && block.includes('this.entryGlow = null');
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
  const RES_START = 'private registerEntryState(key: string, u: any, now: number): void {';
  const RES_END = 'this.attachEntryClippingTo(key);';
  const SEF_START = 'startEntryFx(): void {';
  const SEF_END = 'this.entryStarted = true;';

  /** 编译 registerEntryState 的**原文**（保留 `this.`，注入窗口常量）。
   *  签名（含其 `{`）被整段切掉 ⇒ body 内无未闭合块，故**不补** `}`（外层 `})` 已闭合包装函数）。 */
  function compileRegisterEntryState(mutate) {
    let body = extractUnique(overlay, RES_START, RES_END, RES_END.length);
    body = body.split(RES_START).join('');
    // 签名被切掉 ⇒ 形参在此补回：`(W, key, u, now)` 与调用侧 `reg.call(self, W, key, u, now)` 对齐。
    return compile(`(function(ENTRY_REG_WINDOW_SEC, key, u, now) {\n${body}\n})`, mutate);
  }
  /** 编译 startEntryFx 的**原文**（同上：无未闭合块 ⇒ 不补 `}`）。 */
  function compileStartEntryFx(mutate) {
    let body = extractUnique(overlay, SEF_START, SEF_END, SEF_END.length);
    body = body.split(SEF_START).join('');
    return compile(`(function() {\n${body}\n})`, mutate);
  }

  /** 造一个只含 registerEntryState 消费字段的假 `this`（attach 用 spy 记录，不真的碰 three）。 */
  function makeRegSelf({ deployPhase, entryStarted, entryEpoch = 0, entryFxActive = true }) {
    const calls = [];
    return {
      entryStates: new Map(),
      entryEpoch,
      entryStarted,
      entryFxActive,
      battleScene: { deployPhase },
      attachEntryClippingTo: (k) => { calls.push(k); },
      _attachCalls: calls,
    };
  }
  const withNow = (sec, fn) => {
    const real = performance.now;
    performance.now = () => sec * 1000;
    try { return fn(); } finally { performance.now = real; }
  };

  const reg = compileRegisterEntryState();
  const start = compileStartEntryFx();
  const W = E.ENTRY_REG_WINDOW_SEC;

  // (a) 部署期不得登记（即便 entryStarted 已为真 —— 证明部署守卫**独立**生效）
  {
    const self = makeRegSelf({ deployPhase: true, entryStarted: true, entryEpoch: 100 });
    reg.call(self, W, 'k1', { _entryDelay: 0.4 }, 100.5);
    check('部署期（deployPhase=true）不得登记 ⇒ entryStates 保持空', () => self.entryStates.size === 0);
    check('部署期不得登记 ⇒ 也不补挂裁剪（attachEntryClippingTo 未被调用）', () => self._attachCalls.length === 0);
  }

  // (b) 开战前（entryStarted=false）不得登记 —— ★ 刻意给一个**窗口内**的 epoch，
  //     使唯一可能拦住登记的只有 entryStarted 门（否则窗口检查会"顺带"拦住，断言失去隔离性）
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: false, entryEpoch: 100 });
    reg.call(self, W, 'k1', { _entryDelay: 0.4 }, 100.1);
    check('未 startEntryFx（entryStarted=false）⇒ 不登记（与窗口无关）', () => self.entryStates.size === 0);
  }

  // (c) startEntryFx 真跑：显式重置纪元 + 清空 + 置开战标记
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: false, entryEpoch: 0 });
    self.entryStates.set('old', { t0: 1, delay: 0, done: false });   // 部署期残留（防御性清）
    withNow(123.5, () => start.call(self));
    check('startEntryFx ⇒ entryEpoch 被**显式**重置为当前时刻', () =>
      Math.abs(self.entryEpoch - 123.5) < 1e-9);
    check('startEntryFx ⇒ entryStarted = true', () => self.entryStarted === true);
    check('startEntryFx ⇒ 清空部署期残留登记', () => self.entryStates.size === 0);
  }

  // (d) 开战后首见单位被登记：t0 ≈ 当前时刻、delay 取自 _entryDelay、且补挂裁剪
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: false });
    withNow(100, () => start.call(self));
    reg.call(self, W, 'k1', { _entryDelay: 0.4 }, 100.01);
    check('开战后首见单位被登记（entryStates.size = 1）', () => self.entryStates.size === 1);
    check('开战后首见单位 t0 ≈ 当前时刻', () =>
      !!self.entryStates.get('k1') && Math.abs(self.entryStates.get('k1').t0 - 100.01) < 1e-9);
    check('登记时 delay 取自 2D 建舰期打的 `_entryDelay`', () =>
      Math.abs(self.entryStates.get('k1').delay - 0.4) < 1e-12);
    check('登记时给已建实体补挂裁剪（attachEntryClippingTo 被调用）', () => self._attachCalls.includes('k1'));
  }

  // (e) 窗口语义保留：窗口外首见不登记（迷雾发现 / 战后增援不触发切片）
  {
    const wide = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
    reg.call(wide, W, 'k9', {}, 100 + W + 0.5);
    check('入场窗口外（>ENTRY_REG_WINDOW_SEC）首见 ⇒ 不登记', () => wide.entryStates.size === 0);
    const inside = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
    reg.call(inside, W, 'k9', {}, 100 + W - 0.5);
    check('入场窗口内（<ENTRY_REG_WINDOW_SEC）首见 ⇒ 登记', () => inside.entryStates.size === 1);
  }

  // (f) 已登记不重复（推拉镜头不重播：t0 不被刷新）
  {
    const self = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
    reg.call(self, W, 'k1', { _entryDelay: 0 }, 100.1);
    reg.call(self, W, 'k1', { _entryDelay: 0.9 }, 100.2);
    check('已登记单位不重复登记（t0 保持 ⇒ 推拉镜头不重播）', () =>
      self.entryStates.size === 1 && Math.abs(self.entryStates.get('k1').t0 - 100.1) < 1e-9);
  }

  // 变异自检 —— 改坏必须 FAIL（证明上面每条断言都"有牙齿"）
  {
    // 变异 J：删掉"部署期不登记"守卫 ⇒ 部署期会登记
    const regJ = compileRegisterEntryState((s) =>
      s.split('if ((this.battleScene as any)?.deployPhase) return;').join('if (false) return;'));
    checkThrows('变异J（删掉部署守卫）已被"部署期不得登记"断言检出', () => {
      const self = makeRegSelf({ deployPhase: true, entryStarted: true, entryEpoch: 100 });
      regJ.call(self, W, 'k1', { _entryDelay: 0.4 }, 100.5);
      assert.equal(self.entryStates.size, 0);
    });

    // 变异 K：删掉"开战后才登记"门 ⇒ 未开战也登记
    const regK = compileRegisterEntryState((s) =>
      s.split('if (!this.entryStarted) return;').join('if (false) return;'));
    checkThrows('变异K（删掉 entryStarted 门）已被"未 startEntryFx 不登记"断言检出', () => {
      const self = makeRegSelf({ deployPhase: false, entryStarted: false, entryEpoch: 100 });
      regK.call(self, W, 'k1', { _entryDelay: 0.4 }, 100.1);
      assert.equal(self.entryStates.size, 0);
    });

    // 变异 L：startEntryFx 不写 epoch（回到惰性纪元）⇒ 纪元不被显式重置
    const startL = compileStartEntryFx((s) =>
      s.split('this.entryEpoch = performance.now() / 1000;').join(''));
    checkThrows('变异L（startEntryFx 不显式重置纪元）已被"纪元被重置"断言检出', () => {
      const self = makeRegSelf({ deployPhase: false, entryStarted: false, entryEpoch: 0 });
      withNow(123.5, () => startL.call(self));
      assert.equal(Math.abs(self.entryEpoch - 123.5) < 1e-9, true);
    });

    // 变异 M：登记后不补挂裁剪 ⇒ 部署期建好的实体会整舰可见、看不到切片
    const regM = compileRegisterEntryState((s) =>
      s.split('this.attachEntryClippingTo(key);').join(''));
    checkThrows('变异M（登记后不补挂裁剪）已被"补挂裁剪"断言检出', () => {
      const self = makeRegSelf({ deployPhase: false, entryStarted: true, entryEpoch: 100 });
      regM.call(self, W, 'k1', { _entryDelay: 0.4 }, 100.1);
      assert.equal(self._attachCalls.includes('k1'), true);
    });
  }

  // Wiring 契约（防"整段删除"；行为已由上面真跑覆盖）
  check('handleFx 处理 entry_start（→ this.startEntryFx）', () => {
    const blk = overlay.slice(overlay.indexOf('private handleFx(e: Fx3dEvent) {'),
      overlay.indexOf("if (e.kind === 'pointer_chevron'"));
    return blk.includes("e.kind === 'entry_start'") && blk.includes('this.startEntryFx()');
  });
  check('battle3dFx 的 kind 联合类型包含 entry_start', () => /kind:[\s\S]*?'entry_start'/.test(fxSrc));
  // startBattleAfterDeploy 方法体切片（末端锚点 = 下一个方法前的唯一注释，避开同名早现文本）
  const sbad = scene.slice(scene.indexOf('private startBattleAfterDeploy() {'),
    scene.indexOf('/** [V18-A · B-0] 为所有 AI 阵营生成战前计划'));
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

console.log(`\n[entryAnimationSim] passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exit(1);
}
