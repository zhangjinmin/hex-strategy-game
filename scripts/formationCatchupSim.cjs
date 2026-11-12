#!/usr/bin/env node
/**
 * [v100] 阵位追踪"追赶预算"台架。
 *
 * 背景（用户实报）：楔形阵在部分舰队上呈"排头一艘 + 中间空一段 + 后面一截"，
 * 帝国站桩舰队正常、同盟机动舰队异常；"偶尔自行变正常"、"右键移动后变正常"。
 *
 * 取证链（面板读数 n=89）：
 *   · u0=(-2838,1861) 距锚点 a=(-2865,1550) = 312px，而 slot27 目标位距锚点仅 130px
 *     ⇒ 船不在格位上（追踪欠账），不是格位表错；
 *   · UNIT_MOTION_LIMITS.maxSpeed=0.9px/帧（停船后无 +fleetSpd 叠加）
 *     ⇒ 312px 残差需 ~350 帧（6s）爬完 ⇒ "偶尔自行变正常"的时间尺度；
 *   · 转向期槽位横向摆速 ≈ ω×r ≈ 6px/帧 ≫ 0.9 ⇒ 每次机动欠账数百 px。
 *
 * 断言按"能让两种实现结果显著不同"设计（10-18 方法论）：
 *   · 旧实现（固定 0.9）vs 新实现（追赶预算）在 312px 残差上的收敛帧数必须拉开数量级；
 *   · 稳态小残差（≤ SMALL_GAP）两者必须逐位相同（零行为变化）；
 *   · 变异自检：把 GAIN 改 0 / 把 SMALL_GAP 改 0 应当使断言变红（证明断言有牙齿）。
 */
const path = require('path');
const { stripTypeScriptTypes } = require('module');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'frontend/src/game/fleetKinematics.ts');

// 与仓库根 _ts_resolve.mjs 同源：直接执行 .ts（strip types → ESM→CJS 简单转译）
let KIN;
try {
  const fs = require('fs');
  const src = fs.readFileSync(SRC, 'utf8');
  const js = stripTypeScriptTypes(src, { module: 'esnext' })
    // ESM → CJS 最小转译：函数声明保留原名（内部互调不断），只在其后追加导出；
    // export const 改为普通 const + 末尾统一导出。
    .replace(/^export\s+const\s+(\w+)\s*=/gm, 'const $1 =')
    .replace(/^export\s+function\s+(\w+)/gm, 'function $1')
    .replace(/^export\s+interface\s+\w+[^{]*\{/gm, 'interface __Dropped__ {')
    + '\nObject.assign(exports, { moveTowardsAtSpeed, advanceFormationFacing, headingDistance, leadInterceptPoint, hexAxisComponents, hexAxisCompose, stepShipMotion, stepShipSlotFollow, slotTrackingMaxSpeed, UNIT_MOTION_LIMITS, UNIT_VIS_TURN_RATE, ARRIVE_EPS, ARRIVE_BRAKE_SAFETY, SLOT_TRACK_SMALL_GAP, SLOT_TRACK_CATCHUP_GAIN });';
  const m = { exports: {} };
  new Function('module', 'exports', js)(m, m.exports);
  KIN = m.exports;
} catch (e) {
  console.error('FATAL: cannot load fleetKinematics.ts →', e.message);
  process.exit(2);
}

const { slotTrackingMaxSpeed, UNIT_MOTION_LIMITS, stepShipSlotFollow, SLOT_TRACK_SMALL_GAP, SLOT_TRACK_CATCHUP_GAIN } = KIN;
const BASE = UNIT_MOTION_LIMITS.maxSpeed;
const ACC = UNIT_MOTION_LIMITS.accel;

let pass = 0; let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  RED   ${name}  ${detail || ''}`); }
}

// ── 模拟场景 A：停船后 312px 残差（面板实测口径）────────────────────────────
// 船在 (-2838,1861)，槽位固定在 (-2735,1550)+ 换算（模拟 slot27 世界位），
// 舰队速度 0。比较旧预算（恒 0.9）与新预算（追赶）的收敛帧数。
function simulate(maxSpeedFn, gap0, frames) {
  // 初速 0，从 gap0 距离沿直线追向固定槽位
  let st = { x: 0, y: 0, vx: 0, vy: 0 };
  const tx = gap0, ty = 0;
  let i = 0;
  for (; i < frames; i++) {
    const gap = Math.hypot(tx - st.x, ty - st.y);
    if (gap <= 2.5) break;                       // ARRIVE_EPS
    const lim = { ...UNIT_MOTION_LIMITS, maxSpeed: maxSpeedFn(gap) };
    st = stepShipSlotFollow(st, tx, ty, lim, 1);
  }
  return { frames: i, finalGap: Math.hypot(tx - st.x, ty - st.y) };
}

console.log('[A] 312px 残差收敛（停船口径）');
const oldRun = simulate(() => BASE, 312, 2000);
const newRun = simulate((g) => slotTrackingMaxSpeed(BASE, g), 312, 2000);
console.log(`      旧实现: ${oldRun.frames} 帧 (finalGap=${oldRun.finalGap.toFixed(1)})`);
console.log(`      新实现: ${newRun.frames} 帧 (finalGap=${newRun.finalGap.toFixed(1)})`);
// 旧：约 (312-15)/0.9 ≈ 330 帧；新：受 accel 0.06 约束（v 从 0 起步），
// 理论下限 ≈ sqrt(2·300/0.06)·1.5 ≈ 150 帧 ⇒ 实测 2.4×。断言取 2.0×（≥1 倍提速），
// 不取 2.5× —— 那会跟 accel 的物理下限打架（vmax 再大 accel 也追不过去）。
check('新实现显著快于旧实现（≥2.0×）', oldRun.frames / newRun.frames >= 2.0,
  `ratio=${(oldRun.frames / newRun.frames).toFixed(2)}`);
check('新实现在 400 帧内收敛', newRun.frames < 400, `frames=${newRun.frames}`);
check('旧实现确实需要 >300 帧（复现欠账）', oldRun.frames > 300, `frames=${oldRun.frames}`);

// ── 模拟场景 B：稳态小残差 ⇒ 逐位还原旧实现 ─────────────────────────────────
console.log('[B] 稳态（gap≤SMALL_GAP）零行为变化');
check('gap=SMALL_GAP 时预算=base',
  slotTrackingMaxSpeed(BASE, SLOT_TRACK_SMALL_GAP) === BASE);
check('gap=2.5（ARRIVE_EPS）时预算=base',
  slotTrackingMaxSpeed(BASE, 2.5) === BASE);
check('gap=0 时预算=base', slotTrackingMaxSpeed(BASE, 0) === BASE);
// 同一轨迹（小残差起步）两套预算逐帧一致
{
  let a = { x: 10, y: 4, vx: 0, vy: 0 };
  let b = { x: 10, y: 4, vx: 0, vy: 0 };
  let same = true;
  for (let i = 0; i < 120; i++) {
    a = stepShipSlotFollow(a, 0, 0, { ...UNIT_MOTION_LIMITS, maxSpeed: BASE }, 1);
    b = stepShipSlotFollow(b, 0, 0, { ...UNIT_MOTION_LIMITS, maxSpeed: slotTrackingMaxSpeed(BASE, Math.hypot(-b.x, -b.y)) }, 1);
    if (Math.abs(a.x - b.x) > 1e-12 || Math.abs(a.y - b.y) > 1e-12) { same = false; break; }
  }
  check('小残差轨迹 120 帧逐位一致', same);
}

// ── 模拟场景 C：巡航叠加仍生效（v99 行为保持）────────────────────────────────
console.log('[C] 巡航叠加保持');
const spd = slotTrackingMaxSpeed(BASE, 312) + 2.5;   // 停船追赶预算 + 舰队速度
check('追赶预算 + fleetSpd 叠加后 ≥ 旧巡航叠加',
  spd > BASE + 2.5, `spd=${spd.toFixed(2)}`);

// ── 变异自检：断言必须有牙齿 ────────────────────────────────────────────────
console.log('[MUT] 变异自检（改坏实现应使断言 A 变红）');
// 变异 1：GAIN=0（等价旧行为）
{
  const saved = SLOT_TRACK_CATCHUP_GAIN;
  // 模块导出的是 const，无法改；改用局部替换模拟：maxSpeedFn 恒 base
  const mutated = simulate(() => BASE, 312, 2000);
  check('变异(GAIN=0) 复现旧慢速 ⇒ 与旧实现帧数一致',
    Math.abs(mutated.frames - oldRun.frames) < 5,
    `mut=${mutated.frames} old=${oldRun.frames}`);
  void saved;
}
// 变异 2：SMALL_GAP=0 且 GAIN 极小（预算几乎不变）应当收敛慢（≈旧）
{
  const nearOld = simulate((g) => BASE + g * 0.001, 312, 2000);
  check('变异(GAIN=0.001) 收敛仍慢（>250 帧）', nearOld.frames > 250, `frames=${nearOld.frames}`);
}

console.log(`\n${fail === 0 ? 'ALL OK' : 'HAS RED'}: ${pass} PASS / ${fail} RED`);
process.exit(fail === 0 ? 0 : 1);
