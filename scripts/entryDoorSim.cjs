/**
 * [传送门·能量块组装/消散入场 · v4 `GATE_STYLE = 'D'` + 开场动画设置项] 离线台架。
 *
 * ── 为什么这样写（沿用本项目 R1 教训）────────────────────────────────────────
 * `block.includes('...')` 式断言**没有牙齿**。本台架因此：
 *   ① **真跑纯逻辑层** —— `require('../frontend/src/game/three/entryDoor.ts')`，
 *      并**变异模块源码**后重跑（改坏常量/分支/算法必须 FAIL ⇒ 证明断言有牙齿）；
 *   ② **真跑 Wiring** —— 把 `Battle3DOverlay.entryFxOn` / `startEntryFx` 的**原文**切出来
 *      （`stripTypeScriptTypes` + `new Function`）真跑，断言 `'off'` 时**不建对象 / 不聚焦**；
 *   ③ 源码契约层（少量，只用于防"整段删除"与"接线丢失"；行为由上面的真跑保证）。
 *
 * ── 被验证的关键命题 ───────────────────────────────────────────────────────
 *   · 门框能量块：数量（60~80）/ 均匀沿框分布 / 全部落在框上（max(|su|,|sv|)=1）/ 确定性
 *   · 三阶段时序：`t=0` 全部在**框外** → `t=组装末` 全部**精确就位**（u=su,v=sv,不透明）
 *     → `t=消散末` 全部**飞散到框外**且透明
 *   · 门"开启"：`doorApertureK` 0 → 1（组装前 60%）
 *   · 总时长：门 / 球 / `ENTRY_TOTAL_SEC` **三者同为 6.5**（用户"速度可以慢一点"）
 *   · 设置项 `entryFxStyle`：`'door'→'D'` / `'sphere'→'S'` / `'off'→null`；未设置 ⇒ 回退 `GATE_STYLE`
 *   · ★`'off'`：`entryFxOn()` 返回 false（不建任何特效对象）；`startEntryFx` **不聚焦**
 *   · ★`'off'` 不暂停：`BattleScene.beginEntryPhase` 有 `'off'` 提前返回且**显式 `isPaused=false`**
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');

// 真源码（纯逻辑层；零 import ⇒ 可被 require / 也可被文本变异后重跑）
const D = require('../frontend/src/game/three/entryDoor.ts');
const S = require('../frontend/src/game/three/entrySphere.ts');
const E = require('../frontend/src/game/entrySlice.ts');

const doorSrc = fs.readFileSync('./frontend/src/game/three/entryDoor.ts', 'utf8');
// ⚠ 变异自检用**归一化成 LF 的源码**（仓库里 `.ts` 是 CRLF；不归一化则含 `\n` 的变异串匹配不上 ⇒ 变异静默失效）
const doorSrcLF = doorSrc.replace(/\r\n/g, '\n');
const entrySrc = fs.readFileSync('./frontend/src/game/entrySlice.ts', 'utf8');
const entrySrcLF = entrySrc.replace(/\r\n/g, '\n');
const overlay = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');
const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const settingsStore = fs.readFileSync('./frontend/src/store/settingsStore.ts', 'utf8');
const settingsPanel = fs.readFileSync('./frontend/src/components/meta/SettingsPanel.vue', 'utf8');

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
// 通用：把 entryDoor.ts 源码编成"模块对象"（供变异自检重跑）
// ════════════════════════════════════════════════════════════════════════════
function loadDoorModule(src) {
  const names = [];
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  for (const m of src.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  let body = src.replace(/export\s+const\s+/g, 'const ').replace(/export\s+function\s+/g, 'function ');
  body = stripTypeScriptTypes(body);
  const factory = new Function(`${body}\nreturn { ${names.join(', ')} };`);
  return factory();
}
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

/** 唯一锚点抽取（锚点缺失 / 不唯一一律抛错）。
 *  说明：本台架**直接执行源码文本**，本项目 R1 教训要求"改坏必须红"。 */
function extractUnique(src, startMark, endMark) {
  const first = src.indexOf(startMark);
  if (first < 0) throw new Error(`锚点缺失: ${startMark}`);
  if (src.indexOf(startMark, first + 1) >= 0) throw new Error(`锚点不唯一: ${startMark}`);
  const end = src.indexOf(endMark, first + startMark.length);
  if (end < 0) throw new Error(`结束锚点缺失: ${endMark}`);
  return src.slice(first, end + endMark.length);
}
function compile(wrappedJs, mutate) {
  let js = wrappedJs;
  if (mutate) js = mutate(js);
  return new Function(`return ${stripTypeScriptTypes(js)};`)();
}

/** 真跑一次门块布局；`mutate` 非空时先把源码改坏（用于反例自检）。 */
function build(mutate, opts = {}) {
  const M = mutate ? loadDoorModule(mutate(doorSrcLF)) : D;
  return {
    M,
    set: M.buildDoorBlocks({
      ...(opts.count !== undefined ? { count: opts.count } : {}),
    }),
  };
}
/** 逐位指纹（槽位 + 全部动画随机量）—— 用于"确定性"断言。 */
function fingerprint(set) {
  return set.blocks.map((b) => [
    b.index, b.su, b.sv, b.edge, b.dv, b.du, b.sz, b.delay, b.ddu, b.ddv, b.ddz, b.dispDelay,
    b.spinA, b.spinB, Array.from(b.axis).join('/'),
  ].join(',')).join('|');
}

// ════════════════════════════════════════════════════════════════════════════
// 1) 门框块布局（真跑）：数量 / 沿框分布 / 在框上 / 确定性
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 1. 门框能量块：数量 / 沿框均匀分布 / 全在框上 / 确定性 ===');
{
  const { set } = build();
  const onFrame = set.blocks.every((b) => Math.abs(Math.max(Math.abs(b.su), Math.abs(b.sv)) - 1) < 1e-9);
  const hist = set.edgeHist;
  const minEdge = Math.min(...hist);

  check('块数 = DOOR_BLOCK_COUNT，且在用户给的 60~80 区间内', () =>
    set.blocks.length === D.DOOR_BLOCK_COUNT && D.DOOR_BLOCK_COUNT >= 60 && D.DOOR_BLOCK_COUNT <= 80);
  check('★每块都落在**矩形门框**上（max(|su|,|sv|) = 1）', () => onFrame === true);
  check('★四条边都有块（沿框均匀分布，任一边 ≥ 10 块）', () => minEdge >= 10);
  check('四边块数接近均匀（最大/最小 < 1.5 ⇒ 弧长均匀）', () =>
    Math.max(...hist) / minEdge < 1.5);
  check('槽位坐标在 [-1,1] 内（不会溢出到门框外）', () =>
    set.blocks.every((b) => Math.abs(b.su) <= 1 + 1e-9 && Math.abs(b.sv) <= 1 + 1e-9));
  check('块序号连续 0..count-1（无跳号）', () =>
    set.blocks.every((b, i) => b.index === i));
  check('★同 seed 两次生成：槽位 + 全部动画随机量**逐位一致**', () =>
    fingerprint(build().set) === fingerprint(build().set));
  check('不同 seed ⇒ 布局不同（证明 seed 真的参与生成）', () => {
    const a = build().set;
    const b = D.buildDoorBlocks({ count: D.DOOR_BLOCK_COUNT, seed: 0x1234 });
    return fingerprint(a) !== fingerprint(b);
  });
  check('count = 80 也成立（区间上限）', () => {
    const big = D.buildDoorBlocks({ count: 80 });
    return big.blocks.length === 80
      && big.blocks.every((b) => Math.abs(Math.max(Math.abs(b.su), Math.abs(b.sv)) - 1) < 1e-9);
  });
  check('组装起点径向偏移 = START_DRIFT_MIN..MAX（向外 ⇒ 供"t=0 在框外"）', () =>
    set.blocks.every((b) => {
      const m = Math.hypot(b.du, b.dv);
      return m >= D.DOOR_START_DRIFT_MIN - 1e-9 && m <= D.DOOR_START_DRIFT_MAX + 1e-9;
    }));
  check('消散终点径向偏移 = DISP_DRIFT_MIN..MAX（向外 ⇒ 供"消散末在框外"）', () =>
    set.blocks.every((b) => {
      const m = Math.hypot(b.ddu, b.ddv);
      return m >= D.DOOR_DISP_DRIFT_MIN - 1e-9 && m <= D.DOOR_DISP_DRIFT_MAX + 1e-9;
    }));
  check('★逐块**随机延迟不同**（不是齐刷刷一起到位；> 80% 唯一）', () =>
    new Set(set.blocks.map((b) => b.delay.toFixed(6))).size > set.blocks.length * 0.8);
  check('逐块翻滚角不全相同（有"各自旋转对齐"的观感）', () =>
    new Set(set.blocks.map((b) => b.spinA.toFixed(6))).size > set.blocks.length * 0.8);
  process.stdout.write(`  [info] 四边块数 [下,右,上,左] = ${JSON.stringify(hist)} / count=${set.blocks.length}\n`);
}

// ════════════════════════════════════════════════════════════════════════════
// 2) 三阶段时序（真跑纯函数）：t=0 框外 / 组装末就位 / 消散末飞散
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 2. 组装 / 完整 / 消散三阶段时序（真跑） ===');
{
  const { set } = build();
  const cfg = D.DOOR_MOTION_DEFAULT;
  const motionsAt = (t) => set.blocks.map((x) => D.doorBlockMotion(x, t, cfg));
  const outside = (m) => Math.abs(m.u) > 1 + 1e-9 || Math.abs(m.v) > 1 + 1e-9;
  const holdStart = D.doorHoldStart(cfg);
  const dispStart = D.doorDisperseStart(cfg);
  const dispEnd = D.doorDisperseEnd(cfg);

  check('相位边界：组装 [0,2.6) / 完整 [2.6,4.2) / 消散 [4.2,6.2) / 余晖 [6.2,6.5]', () =>
    Math.abs(holdStart - 2.6) < 1e-9 && Math.abs(dispStart - 4.2) < 1e-9
    && Math.abs(dispEnd - 6.2) < 1e-9 && Math.abs(D.doorTotalSec(cfg) - 6.5) < 1e-9);

  const m0 = motionsAt(0);
  check('★t=0 ⇒ 全部块在**门框之外**（|u|>1 或 |v|>1）—— 复刻"从框外飞入"', () =>
    m0.every((m) => outside(m)));
  check('t=0 ⇒ 全部块**透明**（从零开始拼）', () => m0.every((m) => m.opacity === 0));
  check('t=0 ⇒ 阶段码 = 1（组装中）', () => m0.every((m) => m.phase === 1));
  check('t=0 ⇒ 全部在门前方（z > 0 ⇒ 从舰首侧飞入）', () => m0.every((m) => m.z > 0));

  const m1 = motionsAt(holdStart);
  check('★t=组装末(2.6) ⇒ 全部**精确就位**（u=su / v=sv / z=0）', () =>
    m1.every((m, i) => Math.abs(m.u - set.blocks[i].su) < 1e-9
      && Math.abs(m.v - set.blocks[i].sv) < 1e-9 && Math.abs(m.z) < 1e-9));
  check('t=组装末 ⇒ 全部不透明（拼合成完整门框）', () => m1.every((m) => m.opacity === 1));
  check('t=组装末 ⇒ 阶段码 = 2（完整）', () => m1.every((m) => m.phase === 2));
  check('组装过程**到槽位距离单调内收**（不"飞出去又回来"）', () =>
    set.blocks.every((b) => {
      let prev = Infinity;
      for (let i = 0; i <= 40; i++) {
        const m = D.doorBlockMotion(b, (holdStart * i) / 40, cfg);
        const d = Math.hypot(m.u - b.su, m.v - b.sv);
        if (d > prev + 1e-12) return false;
        prev = d;
      }
      return true;
    }));
  check('组装过程**透明度单调不减**（0 → 1，不闪）', () =>
    set.blocks.every((b) => {
      let prev = -1;
      for (let i = 0; i <= 40; i++) {
        const o = D.doorBlockMotion(b, (holdStart * i) / 40, cfg).opacity;
        if (o < prev - 1e-12) return false;
        prev = o;
      }
      return true;
    }));

  const mHold = motionsAt(dispStart - 1e-6);
  check('完整期(2.6~4.2) ⇒ 全部就位且不透明（门框"完整态"）', () =>
    mHold.every((m) => m.opacity === 1 && m.phase === 2));
  check('完整期 ⇒ 全部朝向已归位（spin = 0 ⇒ 不再翻滚）', () => mHold.every((m) => m.spin === 0));

  const m3 = motionsAt(dispEnd);
  check('★t=消散末(6.2) ⇒ 全部**飞散到框外**（|u|>1 或 |v|>1）', () =>
    m3.every((m) => outside(m)));
  check('t=消散末 ⇒ 全部透明（块全部收掉）', () => m3.every((m) => m.opacity === 0));
  check('t=消散末 ⇒ 全部在翻滚（spin ≠ 0）', () => m3.every((m) => m.spin !== 0));
  const m5 = motionsAt(D.doorTotalSec(cfg));
  check('t=6.5（余晖末）⇒ 仍全部飞散且透明（不"复活"）', () =>
    m5.every((m) => m.phase === 4 && m.opacity === 0));
  const m99 = motionsAt(99);
  check('t 远超总时长 ⇒ 状态与 6.5 相同（不会"复活"）', () =>
    m99.every((m, i) => m.phase === m5[i].phase && m.opacity === m5[i].opacity && m.u === m5[i].u));
  check('消散过程**透明度单调不增**（1 → 0）', () =>
    set.blocks.every((b) => {
      let prev = Infinity;
      for (let i = 0; i <= 40; i++) {
        const o = D.doorBlockMotion(b, dispStart + ((dispEnd - dispStart) * i) / 40, cfg).opacity;
        if (o > prev + 1e-12) return false;
        prev = o;
      }
      return true;
    }));
  check('延迟上界受阶段时长约束（stagger < 组装时长 ⇒ 全部能在组装末前就位）', () =>
    D.DOOR_BLOCK_STAGGER < D.DOOR_ASSEMBLE_SEC && D.DOOR_DISP_STAGGER < D.DOOR_DISPERSE_SEC);
}

// ════════════════════════════════════════════════════════════════════════════
// 3) 门的"开启"动作 + 位面/飞散/扫描包络
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 3. 门"开启"动作 + 位面 / 扫描前沿包络 ===');
{
  const cfg = D.DOOR_MOTION_DEFAULT;
  check('★doorApertureK：t=0 ⇒ 0（门塌成一条线）；组装前 60% 末 ⇒ 1（展开成完整矩形）', () =>
    D.doorApertureK(0, cfg) === 0
    && D.doorApertureK(cfg.assembleSec * D.DOOR_APERTURE_FRAC, cfg) === 1);
  check('doorApertureK 单调不减且有界 0..1', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = D.doorApertureK((cfg.assembleSec * i) / 100, cfg);
      if (v < prev - 1e-12 || v < 0 || v > 1) return false;
      prev = v;
    }
    return true;
  });
  check('门框展开在**组装阶段内**完成（aperture 时长远短于组装 ⇒ 之后是"完整框"）', () =>
    cfg.assembleSec * D.DOOR_APERTURE_FRAC < cfg.assembleSec);

  check('doorBarrierAmt：两端 0、完整期满亮', () =>
    D.doorBarrierAmt(0, cfg) === 0 && D.doorBarrierAmt(D.doorHoldStart(cfg), cfg) === 1
    && D.doorBarrierAmt(D.doorDisperseStart(cfg), cfg) === 1
    && D.doorBarrierAmt(D.doorTotalSec(cfg), cfg) === 0);
  check('doorBarrierAmt 非负且有界（0..1）', () => {
    for (let i = 0; i <= 200; i++) {
      const v = D.doorBarrierAmt((D.doorTotalSec(cfg) * i) / 200, cfg);
      if (v < 0 || v > 1) return false;
    }
    return true;
  });
  check('★doorScanAmt（扫描前沿光带）：两端 0、中段满亮', () =>
    D.doorScanAmt(0) === 0 && D.doorScanAmt(0.5) === 1 && D.doorScanAmt(1) === 0);
  check('doorScanAmt 与 entryGlowAmt 同源（同一"两端起落"语义）', () =>
    [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].every((p) => D.doorScanAmt(p) === E.entryGlowAmt(p)));
  check('扫描光带厚度为正（DOOR_SCAN_BAND > 0 ⇒ 真有一条带）', () => D.DOOR_SCAN_BAND > 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 4) 参数一致性 + 总时长同源（门 / 球 / ENTRY_TOTAL_SEC 三者 = 6.5）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 4. 参数一致性 + 门/球/ENTRY_TOTAL_SEC 总时长同源 ===');
{
  const P = E.GATE_STYLE_PARAMS.D;
  check('★总时长三者**同源**：doorTotalSec = sphereTotalSec = ENTRY_TOTAL_SEC = 6.5', () =>
    Math.abs(D.doorTotalSec() - 6.5) < 1e-9
    && Math.abs(S.sphereTotalSec() - 6.5) < 1e-9
    && Math.abs(E.ENTRY_TOTAL_SEC - 6.5) < 1e-9
    && Math.abs(D.doorTotalSec() - E.ENTRY_TOTAL_SEC) < 1e-9
    && Math.abs(S.sphereTotalSec() - D.doorTotalSec()) < 1e-9);
  check('★ENTRY_NEEDS_ASSEMBLE_RESET 仍为 true（6.5 > 4 ⇒ 必须重置集结计时；表达式未被改动）', () =>
    E.ENTRY_NEEDS_ASSEMBLE_RESET === true && E.ENTRY_TOTAL_SEC > 4.0);
  check('★外观常量与几何模块**一致**（防两处漂移）：blockCount / dispersion', () =>
    P.blockCount === D.DOOR_BLOCK_COUNT
    && Math.abs(P.dispersion - D.DOOR_DISPERSION_K) < 1e-12);
  check('D 方案门框有**三层质感颜色**（能量块 / 亮心 / 外辉光）', () =>
    typeof P.blockColor === 'number' && typeof P.core === 'number' && typeof P.halo === 'number');
  check('★色散镶边**红/青两端不同**、且都不等于主色（轮廓微色散）', () =>
    typeof P.dispA === 'number' && typeof P.dispB === 'number'
    && P.dispA !== P.dispB && P.dispA !== P.blockColor && P.dispB !== P.blockColor);
  check('色散偏移是**微妙值**（0 < dispersion ≤ 0.02 ⇒ 窄丝带，不整圈粗红箍）', () =>
    P.dispersion > 0 && P.dispersion <= 0.02);
  check('扫描光带颜色存在（门"前缘"有明确色）', () => typeof P.scanColor === 'number');
  check('位面不透明度极小（≤ 0.12 ⇒ 透过门能看清舰队）', () =>
    P.barrierOpacity > 0 && P.barrierOpacity <= 0.12);
  check('块数在 60~80（用户给的数量级）', () => D.DOOR_BLOCK_COUNT >= 60 && D.DOOR_BLOCK_COUNT <= 80);
}

// ════════════════════════════════════════════════════════════════════════════
// 5) 设置项 entryFxStyle → 内部风格的**唯一映射**（真跑 + 变异自检）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 5. 设置项 entryFxStyle → 内部门风格（三取值 + 回退） ===');
{
  check('★ENTRY_FX_STYLE_DEFAULT = \'door\'（默认传送门 —— 用户认可门观感更好）', () =>
    E.ENTRY_FX_STYLE_DEFAULT === 'door');
  check('★\'door\' → \'D\'（传送门能量块）', () => E.gateStyleForEntryFx('door') === 'D');
  check('★\'sphere\' → \'S\'（六边形球体，**保留**）', () => E.gateStyleForEntryFx('sphere') === 'S');
  check('★\'off\' → null（完全跳过入场特效）', () => E.gateStyleForEntryFx('off') === null);
  check('未设置 / undefined / 非法值 ⇒ 回退编译期默认 GATE_STYLE', () =>
    E.gateStyleForEntryFx(undefined) === E.GATE_STYLE
    && E.gateStyleForEntryFx(null) === E.GATE_STYLE
    && E.gateStyleForEntryFx('bogus') === E.GATE_STYLE
    && E.GATE_STYLE === 'D');
  check('三取值映射**互不相同**（不会两值落到同一风格）', () => {
    const a = E.gateStyleForEntryFx('door'), b = E.gateStyleForEntryFx('sphere'), c = E.gateStyleForEntryFx('off');
    return a !== b && b !== c && a !== c;
  });

  // 变异：把 'sphere' 也映射回 D（两值落到同一风格）⇒ "互不相同"必须红
  const mutMap = loadEntryModule(entrySrcLF.replace(
    "if (fx === 'sphere') return 'S';",
    "if (fx === 'sphere') return 'D';"));
  checkThrows('变异（sphere 误映射回 D）已被"三取值互不相同"断言检出', () => {
    const a = mutMap.gateStyleForEntryFx('door'), b = mutMap.gateStyleForEntryFx('sphere'), c = mutMap.gateStyleForEntryFx('off');
    assert.equal(a !== b && b !== c && a !== c, true);
  });
  // 变异：'off' 不再返回 null（关闭失效）⇒ "off → null"必须红
  const mutOff = loadEntryModule(entrySrcLF.replace(
    "if (fx === 'off') return null;",
    "if (fx === 'off') return 'S';"));
  checkThrows('变异（off 不再跳过）已被"off → null"断言检出', () => {
    assert.equal(mutOff.gateStyleForEntryFx('off') === null, true);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 6) ★'off' 的**完整行为**：不建对象 / 不聚焦 / **不暂停**（真跑原文 + 契约）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 6. ★设置项 \'off\'：不建特效对象 / 不聚焦 / 不暂停 ===');
{
  // ── 真跑 entryFxOn 的**原文**（注入编译期开关；window 在 Node 为 undefined）──
  const FXON_START = 'private entryFxOn(): boolean {';
  const FXON_END = 'return !(w && w.__entryFxEnabled === false) && !this.entryFxOff;';
  function compileEntryFxOn(mutate) {
    let body = extractUnique(overlay, FXON_START, FXON_END);
    body = body.split(FXON_START).join('');
    return compile(`(function(SLICE_ENTRY_ENABLED_DEFAULT) {\nreturn function() {\n${body}\n};\n})`, mutate);
  }
  const fxOnFn = compileEntryFxOn();
  const runFxOn = (off) => {
    const self = { entryFxOff: off };
    return fxOnFn.call(self, E.SLICE_ENTRY_ENABLED_DEFAULT).call(self);
  };
  check('★entryFxOn：entryFxOff=true（设置 off）⇒ **false**（不建任何特效对象）', () => runFxOn(true) === false);
  check('entryFxOn：entryFxOff=false（door/sphere）⇒ **true**（照常播）', () => runFxOn(false) === true);

  // 变异：删掉 `&& !this.entryFxOff` ⇒ off 时仍返回 true ⇒ 断言必须红
  const fxOnMut = compileEntryFxOn((s) => s.split(' && !this.entryFxOff').join(''));
  checkThrows('变异（entryFxOn 忽略 off）已被"off ⇒ false"断言检出', () => {
    const self = { entryFxOff: true };
    assert.equal(fxOnMut.call(self, E.SLICE_ENTRY_ENABLED_DEFAULT).call(self), false);
  });

  // ── 真跑 startEntryFx 的**原文**：off 时**不聚焦**（否则会强行拉镜头 ⇒ 舰船跑出视野）──
  const SEF_START = 'startEntryFx(): void {';
  const SEF_END = 'if (ENTRY_AUTO_FOCUS && !this.entryFxOff) this.focusOnPlayerMainFleetForEntry();';
  function compileStartEntryFx(mutate) {
    let body = extractUnique(overlay, SEF_START, SEF_END);
    body = body.split(SEF_START).join('');
    return compile(`(function(ENTRY_AUTO_FOCUS) {\nreturn function() {\n${body}\n};\n})`, mutate);
  }
  const sefFn = compileStartEntryFx();
  const runStart = (off) => {
    let focused = 0;
    const self = {
      entryStates: new Map(), entryEpoch: 0, entryStarted: false, entryFxOff: off,
      finishAllEntryGates: () => {},
      focusOnPlayerMainFleetForEntry: () => { focused += 1; return true; },
    };
    sefFn.call(self, E.ENTRY_AUTO_FOCUS).call(self);
    return { focused, started: self.entryStarted };
  };
  check('★startEntryFx：off ⇒ **不聚焦**（不拉镜头），但仍置 entryStarted（无特效）', () => {
    const r = runStart(true);
    return r.focused === 0 && r.started === true;
  });
  check('startEntryFx：非 off ⇒ 聚焦我方主力舰队一次（N1 保留）', () => runStart(false).focused === 1);
  // 变异自检：删掉 `&& !this.entryFxOff` ⇒ off 时仍会聚焦（证明上一条断言有牙齿）
  const sefMut = compileStartEntryFx((s) => s.split('&& !this.entryFxOff').join(''));
  {
    const self = {
      entryStates: new Map(), entryEpoch: 0, entryStarted: false, entryFxOff: true,
      finishAllEntryGates: () => {}, _f: 0,
      focusOnPlayerMainFleetForEntry: () => { self._f += 1; return true; },
    };
    sefMut.call(self, E.ENTRY_AUTO_FOCUS).call(self);
    check('★变异自检：删掉 `&& !this.entryFxOff` 后 off 仍会聚焦（证明"off 不聚焦"断言有牙齿）', () => self._f === 1);
  }

  // ── 契约（防"整段删除"；行为已由真跑覆盖）──
  const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b); return (i >= 0 && j > i) ? src.slice(i, j) : ''; };
  check('构造器读取设置：`gateStyleForEntryFx(useSettingsStore().getEntryFxStyleValue())`', () =>
    overlay.includes('gateStyleForEntryFx(useSettingsStore().getEntryFxStyleValue())'));
  check('构造器把 null（off）落到 `entryFxOff`，非 null 落到 `gateStyle`', () =>
    overlay.includes('this.entryFxOff = mapped === null;') && overlay.includes('if (mapped) this.gateStyle = mapped;'));
  check('★ensureFleetGate 外观分派含 **D 分支**（buildDoorVisual + placeDoorVisual）', () => {
    const blk = slice(overlay, 'private ensureFleetGate(', 'private attachEntryClippingTo(');
    return blk.includes("} else if (this.gateStyle === 'D') {") && blk.includes('this.buildDoorVisual(g);')
      && blk.includes('this.placeDoorVisual(g, 0);');
  });
  check('★finishEntryGate 结束**必须** dispose 传送门（零残留红线）', () =>
    slice(overlay, 'private finishEntryGate(g: FleetGate): void {', 'private finishAllEntryGates(): void {')
      .includes('this.disposeDoorVisual(g);'));
  check('★updateEntryFx 每帧推进传送门（`this.placeDoorVisual(g, el)`）', () =>
    slice(overlay, 'private updateEntryFx(): void {', 'for (const [fleet, g] of this.fleetGates)')
      .includes('this.placeDoorVisual(g, el)'));
  check('★disposeDoorVisual：scene.remove + disposeTree（去重共享几何）+ 置空 g.door', () => {
    const blk = slice(overlay, 'private disposeDoorVisual(g: FleetGate): void {', 'private entryRevealScale(');
    return blk.includes('this.scene.remove(d.root)') && blk.includes('disposeTree(') && blk.includes('g.door = null');
  });

  // ── ★'off' 不暂停：BattleScene.beginEntryPhase 有 off 提前返回 + 显式解除暂停 ──
  check('★BattleScene.beginEntryPhase：off ⇒ 提前返回且**显式 `isPaused = false`**（绝不卡在暂停）', () =>
    scene.includes('if (this.entryFxDisabledBySetting()) { this.store.isPaused = false; return; }'));
  check('★BattleScene 的 off 判定复用**同一设置项** getEntryFxStyleValue() === \'off\'（与 3D 层同源）', () =>
    scene.includes("getEntryFxStyleValue() === 'off'"));
  check('★3D 层与 BattleScene **同判**（两边都读 getEntryFxStyleValue ⇒ 永不背离）', () =>
    overlay.includes('getEntryFxStyleValue()') && scene.includes('getEntryFxStyleValue()'));

  // ── 设置项本身（store / 迁移 / UI）──
  check('★settingsStore：entryFxStyle 默认 \'door\'', () =>
    settingsStore.includes("const entryFxStyle = ref<'door' | 'sphere' | 'off'>('door')"));
  check('★settingsStore：存量存档迁移（白名单校验，缺失/非法 ⇒ 回落 \'door\'）', () =>
    settingsStore.includes("data.entryFxStyle === 'door'") && settingsStore.includes('? data.entryFxStyle'));
  check('★settingsStore：写入持久化（save 含 entryFxStyle + settingsVersion 3）', () =>
    settingsStore.includes('entryFxStyle: entryFxStyle.value') && settingsStore.includes('settingsVersion: 3'));
  check('★settingsStore：auto-save watch 含 entryFxStyle；resetDefaults 恢复 \'door\'', () =>
    settingsStore.includes('battle3dShowFps, entryFxStyle]') && settingsStore.includes("entryFxStyle.value = 'door';"));
  check('★设置界面：新增「开场动画」下拉（传送门 / 能量球 / 关闭）', () =>
    settingsPanel.includes('开场动画') && settingsPanel.includes(':value="entryFx"')
    && settingsPanel.includes('<option value="door">') && settingsPanel.includes('<option value="sphere">')
    && settingsPanel.includes('<option value="off">'));
  check('★设置界面：onEntryFxChange 白名单（只接受三取值）', () =>
    settingsPanel.includes("v === 'door' || v === 'sphere' || v === 'off'"));
}

// ════════════════════════════════════════════════════════════════════════════
// 7) 变异自检：改坏 entryDoor.ts ⇒ 对应断言必须 FAIL（证明断言"有牙齿"）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 7. 变异自检（改坏 entryDoor.ts ⇒ 断言必须能红） ===');
{
  // 变异 A：组装起点径向偏移变小（< 1 ⇒ t=0 反而在框内）⇒ "t=0 在框外"必须红
  checkThrows('变异A（组装起点偏移过小 ⇒ t=0 不在框外）已被"t=0 框外"断言检出', () => {
    const M = loadDoorModule(doorSrcLF.replace(
      'const startMag = randRange(rand, DOOR_START_DRIFT_MIN, DOOR_START_DRIFT_MAX);',
      'const startMag = randRange(rand, 0, 0.2);'));
    const set = M.buildDoorBlocks({ count: 72 });
    const ok = set.blocks.map((b) => M.doorBlockMotion(b, 0, M.DOOR_MOTION_DEFAULT))
      .every((m) => Math.abs(m.u) > 1 + 1e-9 || Math.abs(m.v) > 1 + 1e-9);
    assert.equal(ok, true);
  });

  // 变异 B：不收缩（openK 恒 1 ⇒ 组装起点不再"从线展开"）⇒ "t=0 位置 = 槽位×START_OPEN_K + 径向偏移"必须红
  checkThrows('变异B（openK 恒 1 ⇒ 无"从线展开"）已被"t=0 槽位项被压缩"断言检出', () => {
    const M = loadDoorModule(doorSrcLF.replace(
      'const openK = DOOR_START_OPEN_K + (1 - DOOR_START_OPEN_K) * e;',
      'const openK = 1;'));
    const set = M.buildDoorBlocks({ count: 72 });
    const b = set.blocks.find((x) => Math.abs(x.su) > 0.9) || set.blocks[0];
    const m = M.doorBlockMotion(b, 0, M.DOOR_MOTION_DEFAULT);
    const expectedU = b.su * M.DOOR_START_OPEN_K + b.du;
    assert.equal(Math.abs(m.u - expectedU) < 1e-9, true);
  });

  // 变异 C：消散方向**朝内**（残余块缩向门心）⇒ "消散末在框外"必须红
  checkThrows('变异C（消散方向朝内 ⇒ 消散末仍在框内）已被"消散末框外"断言检出', () => {
    const M = loadDoorModule(doorSrcLF.replace(
      'const ddu = nx * dispMag, ddv = ny * dispMag;',
      'const ddu = -nx * dispMag, ddv = -ny * dispMag;'));
    const set = M.buildDoorBlocks({ count: 72 });
    const end = M.doorDisperseEnd(M.DOOR_MOTION_DEFAULT);
    const ok = set.blocks.map((b) => M.doorBlockMotion(b, end, M.DOOR_MOTION_DEFAULT))
      .every((m) => Math.abs(m.u) > 1 + 1e-9 || Math.abs(m.v) > 1 + 1e-9);
    assert.equal(ok, true);
  });

  // 变异 D：组装延迟全部置 0（齐刷刷）⇒ "延迟不全相同"必须红
  checkThrows('变异D（组装延迟全 0 ⇒ 齐刷刷）已被"延迟不同"断言检出', () => {
    const M = loadDoorModule(doorSrcLF.replace('const delay = rand() * DOOR_BLOCK_STAGGER;', 'const delay = 0;'));
    const set = M.buildDoorBlocks({ count: 72 });
    const uniq = new Set(set.blocks.map((b) => b.delay.toFixed(6)));
    assert.equal(uniq.size > set.blocks.length * 0.8, true);
  });

  // 变异 E：总时长漏掉余晖（6.2 ≠ 6.5）⇒ "三者同源"必须红
  checkThrows('变异E（总时长漏算余晖）已被"= ENTRY_TOTAL_SEC"断言检出', () => {
    const M = loadDoorModule(doorSrcLF.replace(
      'return cfg.assembleSec + cfg.holdSec + cfg.disperseSec + cfg.afterglowSec;',
      'return cfg.assembleSec + cfg.holdSec + cfg.disperseSec;'));
    assert.equal(Math.abs(M.doorTotalSec(M.DOOR_MOTION_DEFAULT) - E.ENTRY_TOTAL_SEC) < 1e-9, true);
  });

  // 变异 F：顶点不"按弧长均匀"（全部塞到角点）⇒ "四边都有块"必须红
  checkThrows('变异F（块全塞到同一角）已被"四边都有块"断言检出', () => {
    const M = loadDoorModule(doorSrcLF.replace(
      'const s = (i + 0.5) * per;',
      'const s = 0;'));
    const set = M.buildDoorBlocks({ count: 72 });
    assert.equal(Math.min(...set.edgeHist) >= 10, true);
  });

  // 变异 G：几何改用 Math.random（不确定性）⇒ "逐位一致"必须红
  checkThrows('变异G（起点偏移改用 Math.random ⇒ 不确定）已被"确定性"断言检出', () => {
    const M = loadDoorModule(doorSrcLF.replace(
      'const startMag = randRange(rand, DOOR_START_DRIFT_MIN, DOOR_START_DRIFT_MAX);',
      'const startMag = DOOR_START_DRIFT_MIN + Math.random() * (DOOR_START_DRIFT_MAX - DOOR_START_DRIFT_MIN);'));
    const a = M.buildDoorBlocks({ count: 72 });
    const b = M.buildDoorBlocks({ count: 72 });
    const fp = (x) => x.blocks.map((t) => `${t.du},${t.delay}`).join('|');
    assert.equal(fp(a) === fp(b), true);
  });

  // 变异 H：开启动作恒 1（一上来就是完整矩形，无"开启"感）⇒ "doorApertureK(0)=0"必须红
  checkThrows('变异H（开启动作失效 ⇒ 一上来就是完整框）已被"t=0 aperture=0"断言检出', () => {
    const M = loadDoorModule(doorSrcLF.replace(
      'return smooth01(clamp01(elapsed / dur));',
      'return 1;'));
    assert.equal(M.doorApertureK(0, M.DOOR_MOTION_DEFAULT) === 0, true);
  });
}

console.log(`\n[entryDoorSim] passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exit(1);
}
