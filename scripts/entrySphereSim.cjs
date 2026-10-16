/**
 * [六边形球体组装 / 消散入场 · v3.1 `GATE_STYLE = 'S'`] 离线台架。
 *
 * ── 为什么这样写（沿用本项目 R1 教训）────────────────────────────────────────
 * `block.includes('...')` 式断言**没有牙齿**：只对"整段删除"敏感，对取值/语义/行为
 * 完全不敏感（历史上 5 组变异全绿）。本台架因此：
 *   ① **真跑纯逻辑层** —— `require('../frontend/src/game/three/entrySphere.ts')`，
 *      并**变异模块源码**后重跑（改坏常量/分支/算法必须 FAIL ⇒ 证明断言有牙齿）；
 *   ② **真跑清理逻辑** —— `disposeTree` 用"假对象树 + 逐资源打点"真跑，
 *      断言 **创建的每一个几何/材质/贴图都被 dispose 恰好一次**（= 红队"零残留"红线）；
 *   ③ 源码契约层（少量，只用于防"整段删除"与"接线丢失"；行为由上面的真跑保证）。
 *
 * ── 被验证的关键命题 ───────────────────────────────────────────────────────
 *   · 球面 Voronoi：瓦片数正确、**每块顶点都在球面上（|v| ≈ R）**、顶点数 ≥ 5、
 *     瓦片互不重叠（Σ面积 ≤ 球面积）、**有缝隙且缝隙率 ≈ gapRatio**
 *   · **确定性**：同 seed 两次生成逐位一致
 *   · 三阶段时序：`t=0` 全部在球外 → `t=组装末` 全部就位 → `t=消散末` 全部飞散
 *   · 总时长 == `ENTRY_TOTAL_SEC`（5.0，那个常量**不得改动**）
 *   · 舰队"在球里出现"：`sphereRevealAmt` 的吸收/显现包络，**最晚一舰在消散开始前已完全显现**
 *   · 结束清理：`disposeTree` 释放次数 == 创建次数
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');

// 真源码（纯逻辑层；零 import ⇒ 可被 require / 也可被文本变异后重跑）
const S = require('../frontend/src/game/three/entrySphere.ts');
const E = require('../frontend/src/game/entrySlice.ts');

const sphereSrc = fs.readFileSync('./frontend/src/game/three/entrySphere.ts', 'utf8');
// ⚠ 变异自检用**归一化成 LF 的源码**（仓库里 `.ts` 是 CRLF；不归一化则含 `\n` 的变异串匹配不上 ⇒ 变异静默失效）
const sphereSrcLF = sphereSrc.replace(/\r\n/g, '\n');
const overlay = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');

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
// 通用：把 entrySphere.ts 源码编成"模块对象"（供变异自检重跑）
// ════════════════════════════════════════════════════════════════════════════
function loadSphereModule(src) {
  const names = [];
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  for (const m of src.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  let body = src.replace(/export\s+const\s+/g, 'const ').replace(/export\s+function\s+/g, 'function ');
  body = stripTypeScriptTypes(body);
  const factory = new Function(`${body}\nreturn { ${names.join(', ')} };`);
  return factory();
}

/** 真跑一次剖分；`mutate` 非空时先把源码改坏（用于反例自检）。 */
function build(mutate, opts = {}) {
  const M = mutate ? loadSphereModule(mutate(sphereSrcLF)) : S;
  return {
    M,
    set: M.buildSphereTiles({
      radius: opts.radius ?? 40,
      count: opts.count ?? M.SPHERE_TILE_COUNT,
      ...(opts.gapRatio !== undefined ? { gapRatio: opts.gapRatio } : {}),
    }),
  };
}

/** 逐位指纹（几何 + 全部动画随机量）—— 用于"确定性"断言。 */
function fingerprint(set) {
  return set.tiles.map((t) => [
    t.index, t.nv, t.startK, t.dispK, t.delay, t.dispDelay, t.spinA, t.spinB,
    Array.from(t.center).join('/'), Array.from(t.axis).join('/'), Array.from(t.verts).join('/'),
    Array.from(t.fan).join('/'),
  ].join(',')).join('|');
}

const RADIUS = 40;

// ════════════════════════════════════════════════════════════════════════════
// 1) 球面 Voronoi 几何（真跑）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 1. 球面 Voronoi：瓦片数 / 顶点数 / 顶点在球面 / 互不重叠 / 缝隙 ===');
{
  const { set } = build();
  const hist = {};
  let maxVerr = 0;
  let minCentroidDist = Infinity;
  let maxCentroidVerr = 0;
  let fanOk = true;
  for (const t of set.tiles) {
    hist[t.nv] = (hist[t.nv] || 0) + 1;
    for (let i = 0; i < t.nv; i++) {
      const m = Math.hypot(t.verts[i * 3], t.verts[i * 3 + 1], t.verts[i * 3 + 2]);
      maxVerr = Math.max(maxVerr, Math.abs(m - RADIUS));
    }
    maxCentroidVerr = Math.max(maxCentroidVerr,
      Math.abs(Math.hypot(t.center[0], t.center[1], t.center[2]) - RADIUS));
    if (t.fan.length !== t.nv * 3) fanOk = false;
    for (let i = 0; i < t.fan.length; i++) if (t.fan[i] > t.nv) fanOk = false;
  }
  for (let i = 0; i < set.tiles.length; i++) {
    for (let j = i + 1; j < set.tiles.length; j++) {
      const a = set.tiles[i].center, b = set.tiles[j].center;
      minCentroidDist = Math.min(minCentroidDist, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }

  check('瓦片数 == SPHERE_TILE_COUNT（120~180 区间内）', () =>
    set.tiles.length === S.SPHERE_TILE_COUNT
    && S.SPHERE_TILE_COUNT >= 120 && S.SPHERE_TILE_COUNT <= 180);
  check('每块瓦片顶点数 ≥ 5（参考图是六边形蜂窝；实测 5/6/7 混合）', () =>
    set.tiles.every((t) => t.nv >= 5));
  check('**多数是六边形**（≥ 50% ⇒ 观感确实是"六边形拼接"）', () =>
    (hist[6] || 0) / set.tiles.length >= 0.5);
  check('★每块顶点都在球面上（|v| ≈ R，误差 < 1e-6）', () => maxVerr < 1e-6);
  check('每块质心也在球面上（|center| ≈ R）', () => maxCentroidVerr < 1e-6);
  check('三角扇索引完整（= 3×顶点数，且索引 ≤ nv）', () => fanOk === true);
  check('★瓦片之间**不重叠**：Σ 球面面积 ≤ 球面积（重叠必然 Σ > 4π）', () =>
    set.coverage <= 1.0001);
  check('★瓦片之间**有缝隙**：Σ 球面面积 < 球面积（否则是严丝合缝）', () =>
    set.coverage < 1);
  check('★间隙率符合预期：coverage ≈ (1 − gapRatio)²', () =>
    Math.abs(set.coverage - (1 - S.SPHERE_GAP_RATIO) ** 2) < 0.02);
  check('gapRatio = 0 ⇒ 严丝合缝（coverage ≈ 1）—— 证明缝隙确实由 gapRatio 决定', () => {
    const z = build(null, { gapRatio: 0 }).set;
    return Math.abs(z.coverage - 1) < 0.01;
  });
  check('★瓦片质心两两间距 > 0（无重合瓦片）', () => minCentroidDist > 0);
  check('质心间距是"蜂窝格距"量级（0.15R ~ 0.45R）', () =>
    minCentroidDist > 0.15 * RADIUS && minCentroidDist < 0.45 * RADIUS);
  check('count = 180 也成立（用户允许区间 120~180 的上限）', () => {
    const big = build(null, { count: 180 }).set;
    return big.tiles.length === 180
      && big.tiles.every((t) => t.nv >= 5)
      && big.tiles.every((t) => {
        for (let i = 0; i < t.nv; i++) {
          const m = Math.hypot(t.verts[i * 3], t.verts[i * 3 + 1], t.verts[i * 3 + 2]);
          if (Math.abs(m - RADIUS) > 1e-6) return false;
        }
        return true;
      });
  });
  check('半径缩放线性：R=80 时顶点模长 ≈ 80（几何以球心为原点、可按 R 缩放）', () => {
    const d = build(null, { radius: 80 }).set;
    return d.tiles.every((t) => {
      for (let i = 0; i < t.nv; i++) {
        const m = Math.hypot(t.verts[i * 3], t.verts[i * 3 + 1], t.verts[i * 3 + 2]);
        if (Math.abs(m - 80) > 1e-6) return false;
      }
      return true;
    });
  });
  process.stdout.write(`  [info] 顶点数直方图 ${JSON.stringify(hist)} / coverage=${set.coverage.toFixed(4)}`
    + ` / 最小质心距=${minCentroidDist.toFixed(3)}（R=${RADIUS}）\n`);
}

// ════════════════════════════════════════════════════════════════════════════
// 2) 确定性（同 seed 逐位一致；不同 seed 布局不同）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 2. 确定性：同 seed 两次生成**逐位一致** ===');
{
  const a = build().set;
  const b = build().set;
  check('★同 seed 两次生成：几何 + 全部动画随机量逐位一致', () =>
    fingerprint(a) === fingerprint(b));
  check('不同 seed ⇒ 布局不同（证明 seed 真的参与生成）', () => {
    const c = S.buildSphereTiles({ radius: RADIUS, count: S.SPHERE_TILE_COUNT, seed: 12345 });
    return fingerprint(c) !== fingerprint(a);
  });
  check('确定性覆盖**逐瓦片随机延迟**（复刻"随机拼起来"的随机量也是确定的）', () =>
    a.tiles.every((t, i) => t.delay === b.tiles[i].delay && t.startK === b.tiles[i].startK
      && t.dispK === b.tiles[i].dispK && t.dispDelay === b.tiles[i].dispDelay));
}

// ════════════════════════════════════════════════════════════════════════════
// 3) 三阶段时序（真跑纯函数）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 3. 组装 / 完整 / 消散三阶段时序（真跑） ===');
{
  const { set } = build();
  const cfg = S.SPHERE_MOTION_DEFAULT;
  const motionsAt = (t) => set.tiles.map((x) => S.sphereTileMotion(x, t, cfg));
  const magAt = (t) => set.tiles.map((x, i) => RADIUS * S.sphereTileMotion(x, t, cfg).k);
  const holdStart = S.sphereHoldStart(cfg);
  const dispStart = S.sphereDisperseStart(cfg);
  const dispEnd = S.sphereDisperseEnd(cfg);

  check('★总时长 = 组装 + 完整 + 消散 + 余晖 = ENTRY_TOTAL_SEC（[v4] 6.5，与门**同源**）', () =>
    Math.abs(S.sphereTotalSec(cfg) - E.ENTRY_TOTAL_SEC) < 1e-9);
  check('阶段边界（[v4]）：组装 [0,2.6) / 完整 [2.6,4.2) / 消散 [4.2,6.2) / 余晖 [6.2,6.5]', () =>
    Math.abs(holdStart - 2.6) < 1e-9 && Math.abs(dispStart - 4.2) < 1e-9
    && Math.abs(dispEnd - 6.2) < 1e-9 && Math.abs(S.sphereTotalSec(cfg) - 6.5) < 1e-9);

  const m0 = motionsAt(0);
  check('★t=0 ⇒ 全部瓦片在**球外**（|pos| = R×k > R）', () => {
    const mags = magAt(0);
    return mags.every((m) => m > RADIUS + 1e-6);
  });
  check('t=0 ⇒ 径向因子 ≥ SPHERE_START_R_MIN（不是"贴着球面出发"）', () =>
    m0.every((m) => m.k >= S.SPHERE_START_R_MIN - 1e-9));
  check('t=0 ⇒ 全部瓦片**透明**（从零开始拼）', () => m0.every((m) => m.opacity === 0));
  check('t=0 ⇒ 阶段码 = 1（组装中）', () => m0.every((m) => m.phase === 1));

  const m1 = motionsAt(holdStart);
  check('★t=组装末(1.8) ⇒ 全部**就位**（k = 1 ⇒ |pos| = R）', () => {
    const mags = magAt(holdStart);
    return m1.every((m) => Math.abs(m.k - 1) < 1e-9)
      && mags.every((m) => Math.abs(m - RADIUS) < 1e-6);
  });
  check('t=组装末 ⇒ 全部不透明（拼合成完整球）', () => m1.every((m) => m.opacity === 1));
  check('t=组装末 ⇒ 阶段码 = 2（完整）', () => m1.every((m) => m.phase === 2));
  check('组装过程**径向单调内收**（每块 k 不增 ⇒ 不会"飞出去又回来"）', () =>
    set.tiles.every((t) => {
      let prev = Infinity;
      for (let i = 0; i <= 40; i++) {
        const k = S.sphereTileMotion(t, (holdStart * i) / 40, cfg).k;
        if (k > prev + 1e-12) return false;
        prev = k;
      }
      return true;
    }));
  check('组装过程**透明度单调不减**（0 → 1，不会闪一下）', () =>
    set.tiles.every((t) => {
      let prev = -1;
      for (let i = 0; i <= 40; i++) {
        const o = S.sphereTileMotion(t, (holdStart * i) / 40, cfg).opacity;
        if (o < prev - 1e-12) return false;
        prev = o;
      }
      return true;
    }));

  const mHold = motionsAt(dispStart - 1e-6);
  check('完整期(1.8~3.0) ⇒ 全部就位且不透明（球体"完整态"）', () =>
    mHold.every((m) => Math.abs(m.k - 1) < 1e-9 && m.opacity === 1 && m.phase === 2));
  check('完整期(1.8~3.0) ⇒ 全部朝向已归位（spin = 0 ⇒ 不再翻滚）', () =>
    mHold.every((m) => m.spin === 0));

  const m3 = motionsAt(dispEnd);
  check('★t=消散末(4.5) ⇒ 全部**飞散到球外**（|pos| > R）', () => {
    const mags = magAt(dispEnd);
    return m3.every((m) => m.k >= S.SPHERE_DISP_R_MIN - 1e-9)
      && mags.every((m) => m > RADIUS + 1e-6);
  });
  check('t=消散末 ⇒ 全部透明（瓦片全部收掉）', () => m3.every((m) => m.opacity === 0));
  check('t=消散末 ⇒ 全部在翻滚（spin ≠ 0）', () => m3.every((m) => m.spin !== 0));
  const m5 = motionsAt(S.sphereTotalSec(cfg));
  check('t=5.0（余晖末）⇒ 仍全部飞散且透明（不"复活"）', () =>
    m5.every((m) => m.phase === 4 && m.opacity === 0));
  const m99 = motionsAt(99);
  check('t 远超总时长 ⇒ 状态与 5.0 相同（不会"复活"）', () =>
    m99.every((m, i) => m.phase === m5[i].phase && m.opacity === m5[i].opacity && m.k === m5[i].k));

  check('消散过程**透明度单调不增**（1 → 0）', () =>
    set.tiles.every((t) => {
      let prev = Infinity;
      for (let i = 0; i <= 40; i++) {
        const o = S.sphereTileMotion(t, dispStart + ((dispEnd - dispStart) * i) / 40, cfg).opacity;
        if (o > prev + 1e-12) return false;
        prev = o;
      }
      return true;
    }));

  check('★逐瓦片**随机延迟**真的在 [0, stagger]（复刻"随机拼起来"）', () =>
    set.tiles.every((t) => t.delay >= 0 && t.delay <= S.SPHERE_TILE_STAGGER + 1e-12));
  check('★逐瓦片延迟**不全相同**（不是"齐刷刷一起到位"）', () => {
    const uniq = new Set(set.tiles.map((t) => t.delay.toFixed(6)));
    return uniq.size > set.tiles.length * 0.8;
  });
  check('消散延迟同样在 [0, dispStagger] 且不全相同', () => {
    const ds = set.tiles.map((t) => t.dispDelay);
    return ds.every((d) => d >= 0 && d <= S.SPHERE_DISP_STAGGER + 1e-12)
      && new Set(ds.map((d) => d.toFixed(6))).size > set.tiles.length * 0.8;
  });
  check('延迟上界受阶段时长约束（stagger < 组装时长 ⇒ 全部能在组装末前就位）', () =>
    S.SPHERE_TILE_STAGGER < S.SPHERE_ASSEMBLE_SEC
    && S.SPHERE_DISP_STAGGER < S.SPHERE_DISPERSE_SEC);

  check('核心球包络：两端 0、完整期满亮', () =>
    S.sphereCoreAmt(0, cfg) === 0 && S.sphereCoreAmt(holdStart, cfg) === 1
    && S.sphereCoreAmt(dispStart, cfg) === 1 && S.sphereCoreAmt(S.sphereTotalSec(cfg), cfg) === 0);
  check('紫辉光包络：开场 0、完整期满亮、余晖末收敛到 0（"余晖"= 残余淡出）', () =>
    S.sphereGlowAmt(0, cfg) === 0 && S.sphereGlowAmt(dispStart, cfg) === 1
    && S.sphereGlowAmt(S.sphereTotalSec(cfg), cfg) === 0);
  check('核心/辉光包络非负且有界（0..1）', () => {
    for (let i = 0; i <= 200; i++) {
      const t = (S.sphereTotalSec(cfg) * i) / 200;
      const c = S.sphereCoreAmt(t, cfg), g = S.sphereGlowAmt(t, cfg);
      if (c < 0 || c > 1 || g < 0 || g > 1) return false;
    }
    return true;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 4) 舰队"在球里出现"（显现包络）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 4. 舰队在球内显现（吸收 → 藏在球里 → 由内向外浮现） ===');
{
  const cfg = S.SPHERE_MOTION_DEFAULT;
  const RC = S.SPHERE_REVEAL_DEFAULT;
  const dispStart = S.sphereDisperseStart(cfg);
  check('reveal：t ≤ 0 ⇒ 1（入场未开始 ⇒ 舰队照常可见，不被误隐藏）', () =>
    S.sphereRevealAmt(0, 0, RC) === 1 && S.sphereRevealAmt(-3, 0, RC) === 1);
  check('reveal：吸收段末(0.35) ⇒ 0（开战瞬间舰队被"吸进球里"）', () =>
    S.sphereRevealAmt(RC.absorbSec, 0.3, RC) === 0);
  check('reveal：吸收段中点 ≈ 0.5（平滑起落，不"啪"地消失）', () =>
    Math.abs(S.sphereRevealAmt(RC.absorbSec / 2, 0, RC) - 0.5) < 1e-9);
  check('reveal：中间段（藏球里）恒为 0', () =>
    [0.6, 1.0, 1.3].every((t) => S.sphereRevealAmt(t, 0.0, RC) === 0));
  check('reveal：显现完成后 ⇒ 1', () =>
    S.sphereRevealAmt(RC.revealStart + RC.revealDur + 1e-6, 0, RC) === 1);
  check('reveal：**吸收段单调不增**（1 → 0，被吸进球里，不闪）', () => {
    let prev = Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = S.sphereRevealAmt((RC.absorbSec * i) / 100, 0, RC);
      if (v > prev + 1e-12) return false;
      prev = v;
    }
    return true;
  });
  check('reveal：**显现窗口内单调不减**（0 → 1，由内向外浮现，不闪）', () => {
    let prev = -1;
    const t0 = RC.revealStart + 0.2;
    for (let i = 0; i <= 100; i++) {
      const v = S.sphereRevealAmt(t0 + (RC.revealDur * i) / 100, 0.2, RC);
      if (v < prev - 1e-12) return false;
      prev = v;
    }
    return true;
  });
  check('★最晚一舰在**消散开始前**已完全显现（"舰队就在里面出现"必须发生在球体消散之前）', () =>
    RC.revealStart + RC.spread + RC.revealDur <= dispStart + 1e-9);
  check('★显现窗口与"球体完整期"重叠（是"球里"出现，不是球散了才出现）', () =>
    RC.revealStart >= S.SPHERE_ASSEMBLE_SEC * 0.6 && RC.revealStart < dispStart);
  check('reveal 逐舰错开：delay 越大，同一时刻系数越小（由内向外浮现）', () =>
    S.sphereRevealAmt(RC.revealStart + RC.revealDur * 0.5, 0.0, RC)
      > S.sphereRevealAmt(RC.revealStart + RC.revealDur * 0.5, RC.spread, RC));
  check('sphereRevealDelayByRadius：中心 → 0 / 边缘 → spread / 单调不减', () => {
    const d0 = S.sphereRevealDelayByRadius(0, 100, RC.spread);
    const d1 = S.sphereRevealDelayByRadius(100, 100, RC.spread);
    const dm = S.sphereRevealDelayByRadius(50, 100, RC.spread);
    return d0 === 0 && Math.abs(d1 - RC.spread) < 1e-12 && dm > d0 && dm < d1;
  });
  check('sphereRevealDelayByRadius：maxDist ≤ 0 ⇒ 0（不成 NaN）', () =>
    S.sphereRevealDelayByRadius(10, 0, RC.spread) === 0
    && S.sphereRevealDelayByRadius(10, -5, RC.spread) === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 5) 包围球拟合（球体尺寸真源）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 5. 舰队包围球拟合（保证"舰队在球里面"） ===');
{
  const items = [
    { x: 0, y: 0, z: 0, r: 5 },
    { x: 100, y: 0, z: 0, r: 5 },
    { x: 50, y: 30, z: -20, r: 3 },
  ];
  const fit = S.sphereBoundsFit(items, S.SPHERE_RADIUS_PAD, 20);
  check('★包围球把**所有舰（含半长）**包住', () => {
    for (const it of items) {
      const d = Math.hypot(it.x - fit.cx, it.y - fit.cy, it.z - fit.cz) + it.r;
      if (d > fit.r + 1e-9) return false;
    }
    return true;
  });
  check('球心 = 成员质心', () => Math.abs(fit.cx - 50) < 1e-9 && Math.abs(fit.cy - 10) < 1e-9);
  check('pad 生效（半径 = 最大包络 × pad；1.12 ⇒ 比裸包络大）', () => {
    const bare = S.sphereBoundsFit(items, 1, 0);
    return fit.r > bare.r && Math.abs(fit.r - bare.r * S.SPHERE_RADIUS_PAD) < 1e-6;
  });
  check('minR 生效（单舰 / 极小舰队时球不小于下限 ⇒ 不退化成"一个点"）', () => {
    const tiny = S.sphereBoundsFit([{ x: 0, y: 0, z: 0, r: 1 }], 1.12, 78);
    return Math.abs(tiny.r - 78) < 1e-9;
  });
  check('空队 ⇒ null（调用方据此不开球）', () =>
    S.sphereBoundsFit([], 1.12, 20) === null && S.sphereBoundsFit(null, 1.12, 20) === null);
}

// ════════════════════════════════════════════════════════════════════════════
// 6) ★结束清理：创建的每一个几何/材质/贴图都被 dispose **恰好一次**
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 6. 结束清理：dispose 计数 == 创建计数（红队"零残留"红线） ===');
{
  /** 造一个**与真实球体同构**的假对象树：N 块瓦片 ×（1 份共享几何 + 3 个材质）
   *  + 核心（几何+材质+贴图）+ 辉光（几何+材质+贴图）。逐资源打点统计释放次数。 */
  function makeFakeSphereTree(nTiles) {
    const stats = { geoCreated: 0, matCreated: 0, mapCreated: 0, geoDisposed: 0, matDisposed: 0, mapDisposed: 0 };
    const geoDisposeCount = new Map();   // 几何 → 释放次数（应为 1）
    const mkGeo = () => {
      stats.geoCreated += 1;
      const g = { dispose: () => { stats.geoDisposed += 1; geoDisposeCount.set(g, (geoDisposeCount.get(g) || 0) + 1); } };
      return g;
    };
    const mkMap = () => {
      stats.mapCreated += 1;
      return { dispose: () => { stats.mapDisposed += 1; } };
    };
    const mkMat = (withMap) => {
      stats.matCreated += 1;
      const m = { dispose: () => { stats.matDisposed += 1; }, map: withMap ? mkMap() : null };
      return m;
    };
    const root = { geometry: null, material: null, children: [] };
    for (let i = 0; i < nTiles; i++) {
      const shared = mkGeo();                     // 3 层共享
      const children = [mkMat(false), mkMat(false), mkMat(false)].map((m) => ({ geometry: shared, material: m }));
      root.children.push({ geometry: null, material: null, children });
    }
    root.children.push({ geometry: mkGeo(), material: mkMat(true), children: [] });   // 核心
    root.children.push({ geometry: mkGeo(), material: mkMat(true), children: [] });   // 辉光
    return { root, stats, geoDisposeCount };
  }

  const N = 7;
  const { root, stats, geoDisposeCount } = makeFakeSphereTree(N);
  const calls = S.disposeTree(root);

  const expectedCreated = N * 1 + N * 3 + 2 + 2 + 2;   // 瓦片几何 + 瓦片材质 + 核心 + 辉光 + 两张贴图
  check('★disposeTree 返回的释放次数 == 创建的资源数（零残留、零重复）', () =>
    calls === N * 4 + 6 && calls === expectedCreated && (N * 1 + 2) + (N * 3 + 2) + 2 === expectedCreated);
  check('★每一份**几何**都被释放（含 3 层共享的那份）', () =>
    stats.geoDisposed === stats.geoCreated);
  check('★共享几何**只释放一次**（3 层瓦片共用 1 份 ⇒ 不去重会释放 3 次，计数语义失真）', () => {
    for (const [, c] of geoDisposeCount) if (c !== 1) return false;
    return geoDisposeCount.size === stats.geoCreated;
  });
  check('★每一份**材质**都被释放', () => stats.matDisposed === stats.matCreated);
  check('★每一张**贴图**（核心/辉光）都被释放', () =>
    stats.mapDisposed === stats.mapCreated && stats.mapCreated === 2);
  check('disposeTree 对 null / undefined 安全（不抛错、返回 0）', () =>
    S.disposeTree(null) === 0 && S.disposeTree(undefined) === 0);
  check('disposeTree 处理**材质数组**与**空 children**（遍历实现健壮）', () => {
    let a = 0, b = 0;
    const t = {
      geometry: { dispose: () => { a += 1; } },
      material: [{ dispose: () => { b += 1; } }, { dispose: () => { b += 1; } }],
      children: [],
    };
    const n = S.disposeTree(t);
    return n === 3 && a === 1 && b === 2;
  });
  check('disposeTree 对**同一材质重复引用**也只释放一次', () => {
    let c = 0;
    const m = { dispose: () => { c += 1; } };
    const t = { geometry: null, material: null, children: [{ geometry: null, material: m }, { geometry: null, material: m }] };
    const n = S.disposeTree(t);
    return n === 1 && c === 1;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 7) 变异自检：改坏源码 ⇒ 对应断言必须 FAIL（证明断言"有牙齿"）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 7. 变异自检（改坏 entrySphere.ts ⇒ 断言必须能红） ===');
{
  // 变异 A：无视 gapRatio（瓦片严丝合缝）⇒ "有缝隙 / coverage ≈ (1−g)²" 必须红
  checkThrows('变异A（gapRatio 失效 ⇒ 无缝隙）已被"coverage ≈ (1−gap)²"断言检出', () => {
    const { set } = build((src) => src.replace('const s = 1 - Math.min(0.6, Math.max(0, gapRatio));', 'const s = 1;'));
    assert.equal(Math.abs(set.coverage - (1 - S.SPHERE_GAP_RATIO) ** 2) < 0.02, true);
  });

  // 变异 B：顶点不投影回球面（|v| ≠ R）⇒ "顶点在球面上"必须红
  checkThrows('变异B（顶点不投影回球面）已被"|v| ≈ R"断言检出', () => {
    const { set } = build((src) => src.replace('const L = Math.hypot(X, Y, Z) || 1;', 'const L = 1;'));
    let maxErr = 0;
    for (const t of set.tiles) {
      for (let i = 0; i < t.nv; i++) {
        maxErr = Math.max(maxErr, Math.abs(Math.hypot(t.verts[i * 3], t.verts[i * 3 + 1], t.verts[i * 3 + 2]) - RADIUS));
      }
    }
    assert.equal(maxErr < 1e-6, true);
  });

  // 变异 C：半平面裁剪保留错误一侧（单元被裁成外侧）⇒ 覆盖率/顶点数必红
  checkThrows('变异C（半平面裁剪方向反转）已被"coverage ≤ 1 且有缝隙量级"断言检出', () => {
    const { set } = build((src) => src.replace('if (fa <= 0) out.push(A);', 'if (fa >= 0) out.push(A);'));
    assert.equal(set.coverage <= 1.0001 && Math.abs(set.coverage - (1 - S.SPHERE_GAP_RATIO) ** 2) < 0.02, true);
  });

  // 变异 D：组装起点贴球面（k=1）⇒ "t=0 在球外"必须红
  checkThrows('变异D（组装起点 k=1 ⇒ 不走球外）已被"t=0 全部在球外"断言检出', () => {
    const M = loadSphereModule(sphereSrcLF.replace(
      'return { k: tile.startK + (1 - tile.startK) * e, opacity: tp, spin: tile.spinA * (1 - e), phase: 1 };',
      'return { k: 1, opacity: tp, spin: tile.spinA * (1 - e), phase: 1 };'));
    const s = M.buildSphereTiles({ radius: RADIUS, count: 24 });
    const mags = s.tiles.map((x) => RADIUS * M.sphereTileMotion(x, 0, M.SPHERE_MOTION_DEFAULT).k);
    assert.equal(mags.every((m) => m > RADIUS + 1e-6), true);
  });

  // 变异 E：组装的随机延迟全部置 0（齐刷刷一起到位）⇒ "不全相同"必须红
  checkThrows('变异E（组装延迟全部置 0 ⇒ 齐刷刷）已被"延迟不全相同"断言检出', () => {
    const M = loadSphereModule(sphereSrcLF.replace('const delay = rand() * SPHERE_TILE_STAGGER;', 'const delay = 0;'));
    const s = M.buildSphereTiles({ radius: RADIUS, count: 40 });
    const uniq = new Set(s.tiles.map((t) => t.delay.toFixed(6)));
    assert.equal(uniq.size > s.tiles.length * 0.8, true);
  });

  // 变异 F：总时长漏掉余晖（4.5 ≠ 5.0）⇒ "= ENTRY_TOTAL_SEC" 必须红
  checkThrows('变异F（总时长漏算余晖段）已被"= ENTRY_TOTAL_SEC"断言检出', () => {
    const M = loadSphereModule(sphereSrcLF.replace(
      'return cfg.assembleSec + cfg.holdSec + cfg.disperseSec + cfg.afterglowSec;',
      'return cfg.assembleSec + cfg.holdSec + cfg.disperseSec;'));
    assert.equal(Math.abs(M.sphereTotalSec(M.SPHERE_MOTION_DEFAULT) - E.ENTRY_TOTAL_SEC) < 1e-9, true);
  });

  // 变异 G：显现起始拖到消散开始之后（舰队在球散后才出现）⇒ 该红线必须红
  checkThrows('变异G（显现拖到消散之后 ⇒ "舰队没在球里出现"）已被时序断言检出', () => {
    const M = loadSphereModule(sphereSrcLF.replace(
      'revealStart: SPHERE_REVEAL_START,', 'revealStart: 4.0,'));
    const RC = M.SPHERE_REVEAL_DEFAULT;
    const dispStart = M.sphereDisperseStart(M.SPHERE_MOTION_DEFAULT);
    assert.equal(RC.revealStart + RC.spread + RC.revealDur <= dispStart + 1e-9, true);
  });

  // 变异 H：几何改用 Math.random（不确定性）⇒ "逐位一致"必须红
  checkThrows('变异H（几何改用 Math.random ⇒ 不确定）已被"确定性"断言检出', () => {
    const M = loadSphereModule(sphereSrcLF.replace(
      'const startK = randRange(rand, SPHERE_START_R_MIN, SPHERE_START_R_MAX);',
      'const startK = SPHERE_START_R_MIN + Math.random() * (SPHERE_START_R_MAX - SPHERE_START_R_MIN);'));
    const a = M.buildSphereTiles({ radius: RADIUS, count: 60 });
    const b = M.buildSphereTiles({ radius: RADIUS, count: 60 });
    const fp = (x) => x.tiles.map((t) => `${t.startK},${t.delay}`).join('|');
    assert.equal(fp(a) === fp(b), true);
  });

  // 变异 I：disposeTree 不去重 ⇒ "共享几何只释放一次"必须红
  checkThrows('变异I（disposeTree 不去重 ⇒ 共享几何释放多次）已被计数断言检出', () => {
    const M = loadSphereModule(sphereSrcLF.replace(
      'if (geo && typeof geo.dispose === \'function\' && !geos.has(geo)) {\n      geos.add(geo);\n      geo.dispose(); n += 1;\n    }',
      'if (geo && typeof geo.dispose === \'function\') {\n      geo.dispose(); n += 1;\n    }'));
    let geoDisposed = 0;
    const g = { dispose: () => { geoDisposed += 1; } };
    const root = { geometry: null, material: null, children: [
      { geometry: g, material: null }, { geometry: g, material: null }, { geometry: g, material: null },
    ] };
    M.disposeTree(root);
    assert.equal(geoDisposed === 1, true);
  });

  // 变异 J：disposeTree 不释放材质贴图 ⇒ "贴图也被释放"必须红
  checkThrows('变异J（disposeTree 不释放贴图）已被"贴图释放"断言检出', () => {
    const M = loadSphereModule(sphereSrcLF.replace(
      'const map = one.map;\n    if (map && typeof map.dispose === \'function\' && !mappers.has(map)) {\n      mappers.add(map);\n      map.dispose(); n += 1;\n    }',
      'void one.map;'));
    let mapDisposed = 0;
    const mat = { dispose: () => {}, map: { dispose: () => { mapDisposed += 1; } } };
    M.disposeTree({ geometry: null, material: mat, children: [] });
    assert.equal(mapDisposed === 1, true);
  });

  // 变异 K：包围球不把成员半长算进去 ⇒ "所有舰被包住"必须红
  checkThrows('变异K（包围球漏算成员半长）已被"所有舰（含半长）被包住"断言检出', () => {
    const M = loadSphereModule(sphereSrcLF.replace(
      'const d = Math.hypot(it.x - cx, it.y - cy, it.z - cz) + Math.max(0, it.r);',
      'const d = Math.hypot(it.x - cx, it.y - cy, it.z - cz);'));
    const items = [{ x: 0, y: 0, z: 0, r: 9 }, { x: 100, y: 0, z: 0, r: 9 }];
    const f = M.sphereBoundsFit(items, 1, 0);
    let ok = true;
    for (const it of items) {
      if (Math.hypot(it.x - f.cx, it.y - f.cy, it.z - f.cz) + it.r > f.r + 1e-9) ok = false;
    }
    assert.equal(ok, true);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 8) 参数一致性 + 源码接线契约（防"整段删除"/接线丢失；行为已由上面真跑保证）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 8. 参数一致性 + 接线契约 ===');
{
  const P = E.GATE_STYLE_PARAMS.S;
  check('★`GATE_STYLE` 默认 = `D`（传送门）；A/B/C/S 代码与参数完整保留（S = 球体）', () =>
    E.GATE_STYLE === 'D' && !!E.GATE_STYLE_PARAMS.A && !!E.GATE_STYLE_PARAMS.B && !!E.GATE_STYLE_PARAMS.C
    && !!E.GATE_STYLE_PARAMS.S);
  check('★外观常量与几何模块常量**一致**（防两处漂移）', () =>
    P.tileCount === S.SPHERE_TILE_COUNT
    && Math.abs(P.gapRatio - S.SPHERE_GAP_RATIO) < 1e-12
    && Math.abs(P.dispersion - S.SPHERE_DISPERSION_K) < 1e-12);
  check('★三层质感颜色齐备且**红/蓝两端不同**（色散镶边 > 发光层次 > 瓦片形状）', () =>
    typeof P.tileColor === 'number' && typeof P.coreColor === 'number' && typeof P.glowColor === 'number'
    && typeof P.dispA === 'number' && typeof P.dispB === 'number' && P.dispA !== P.dispB
    && P.dispA !== P.tileColor && P.dispB !== P.tileColor);
  check('瓦片近侧/远侧两色不同（复刻参考图 1/2 的"蓝白近侧 + 蓝紫远侧"层次）', () =>
    typeof P.tileFarColor === 'number' && P.tileFarColor !== P.tileColor);
  check('瓦片数在 120~180 之间', () => S.SPHERE_TILE_COUNT >= 120 && S.SPHERE_TILE_COUNT <= 180);
  check('亮心半径 < 球半径 < 辉光亮环半径 < 辉光面片半边长（层次由内到外、环外留柔边）', () =>
    S.SPHERE_CORE_R_K < 1 && S.SPHERE_GLOW_R_K > 1 && S.SPHERE_GLOW_HALF_K > S.SPHERE_GLOW_R_K);
  check('同屏球体数量有上限（性能：每球 ≈ 3×瓦片数 个 Mesh）', () =>
    S.SPHERE_MAX_INSTANCES >= 1 && S.SPHERE_MAX_INSTANCES <= 4);

  const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b); return (i >= 0 && j > i) ? src.slice(i, j) : ''; };
  const ENSURE = slice(overlay, 'private ensureFleetGate(fleet: any, now: number): FleetGate | undefined {', 'private attachEntryClippingTo(key: string): void {');
  const BUILD = slice(overlay, 'private buildSphereVisual(g: FleetGate): void {', 'private placeSphereVisual(');
  const PLACE = slice(overlay, 'private placeSphereVisual(g: FleetGate, elapsed: number): void {', 'private disposeSphereVisual(');
  const DISPOSE = slice(overlay, 'private disposeSphereVisual(g: FleetGate): void {', 'private entryRevealScale(');
  const UEF = slice(overlay, 'private updateEntryFx(): void {', 'for (const [fleet, g] of this.fleetGates)');
  const FIN = slice(overlay, 'private finishEntryGate(g: FleetGate): void {', 'private finishAllEntryGates(): void {');
  const ATTACH = slice(overlay, 'private attachEntryClippingTo(key: string): void {', 'private registerEntryState(');

  check('★ensureFleetGate：S 方案走球体（buildSphereVisual + placeSphereVisual），A/B/C/D 分支保留', () =>
    ENSURE.includes("if (this.gateStyle === 'S')") && ENSURE.includes('this.buildSphereVisual(g);')
    && ENSURE.includes('this.placeSphereVisual(g, 0);') && ENSURE.includes('this.buildGateVisual(g);')
    && ENSURE.includes('this.buildDoorVisual(g);'));
  check('★ensureFleetGate：球体数量上限（上限外返回 undefined ⇒ 不建门、不强制建实体）', () =>
    ENSURE.includes('this.spherePrimaryFleets(now).includes(fleet)') && ENSURE.includes('return undefined;'));
  check('★buildSphereVisual：真跑几何生成 + 三层瓦片 Mesh + 亮心 + 辉光 + 入场景', () =>
    BUILD.length > 0 && BUILD.includes('buildSphereTiles(') && BUILD.includes('THREE.AdditiveBlending')
    && BUILD.includes('this.scene.add(root)') && BUILD.includes('makeSphereCoreTexture(')
    && BUILD.includes('makeSphereGlowTexture('));
  check('★buildSphereVisual：每块瓦片 = 1 Group + **3 层**（主色 + 色散 A + 色散 B，沿法线微偏移）', () => {
    const hits = BUILD.match(/addLayer\(/g) || [];
    return hits.length === 3 && BUILD.includes('+dispOff') && BUILD.includes('-dispOff')
      && BUILD.includes('THREE.Group()');
  });
  check('★placeSphereVisual：逐瓦片写 position/quaternion/opacity（几何不重建）', () =>
    PLACE.length > 0 && PLACE.includes('sphereTileMotion(') && PLACE.includes('tv.group.position.copy(p)')
    && PLACE.includes('tv.mats[0].opacity =') && !PLACE.includes('buildSphereTiles('));
  check('★disposeSphereVisual：scene.remove + disposeTree（几何/材质/贴图）+ 置空 g.sphere', () =>
    DISPOSE.length > 0 && DISPOSE.includes('this.scene.remove(s.root)') && DISPOSE.includes('disposeTree(')
    && DISPOSE.includes('g.sphere = null'));
  check('★updateEntryFx：球体门每帧 placeSphereVisual（A/B/C 仍走 placeGateVisual）', () =>
    UEF.includes('this.placeSphereVisual(g, el)') && UEF.includes('this.placeGateVisual(g)'));
  check('★finishEntryGate：结束**必须**同时卸裁剪 + dispose 球体（零残留红线）', () =>
    FIN.includes('entryApplyClipping(entry.sliceMats, null, false);') && FIN.includes('this.disposeSphereVisual(g);'));
  check('★attachEntryClippingTo：S 方案**不挂裁剪**（舰队不被切；显现靠缩放淡入）', () =>
    ATTACH.includes("if (this.gateStyle === 'S') return;") && ATTACH.includes('entryApplyClipping(entry.sliceMats, entry.entryPlanes, true);'));
  check('★第三遍：按 `entryRevealScale` 做**缩放淡入**（"舰队在球里出现"）', () =>
    overlay.includes('this.entryRevealScale(v.key, now)')
    && overlay.includes('g.scale.setScalar(entry.baseScale * (0.25 + 0.75 * ge) * _minK * revealK)'));
  check('★addMesh / GLB 换装：S 方案不补挂裁剪（不指向已 dispose 的材质）', () => {
    const addMeshBlk = slice(overlay, 'private addMesh(v: UnitVis) {', 'private dropMesh(key: string) {');
    const swapBlk = slice(overlay, 'if (entry.pendingModel && entry.pendingModel.geo', 'const g = entry.group;');
    return addMeshBlk.includes("if (entryActive && this.gateStyle !== 'S')")
      && swapBlk.includes("if (swapGate && !swapGate.done && this.gateStyle !== 'S')");
  });
  check('★renderer 仍开**局部**裁剪、且未改用全局裁剪（A/B/C 回退路径不受影响）', () =>
    overlay.includes('this.renderer.localClippingEnabled = true;')
    && !/renderer\.clippingPlanes\s*=/.test(overlay));
  check('未新增 teleport 玩法（仅视觉）', () =>
    !overlay.includes('teleport'));
}

console.log(`\n[entrySphereSim] passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exit(1);
}
