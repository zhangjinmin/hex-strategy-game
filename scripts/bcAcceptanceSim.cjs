/**
 * bcAcceptanceSim.cjs — B+C 切片的**独立验收台架**（作者：general-purpose-5，非实施者）
 *
 * ── 这份台架的独立性从哪来 ──────────────────────────────────────────────
 * 1. **期望值全部是字面量**，禁止 `import` 被测量的常量。
 *    理由：本轮主要缺陷类型是"常量写错了"。若测试 import 那个常量，"常量被改错"在测试里就
 *    不可见 —— 测试会跟着一起改、一起绿（即 `f(x) === f(x)` 的自证）。
 *    ⚠ 这与"生产代码禁止写字面量"**不矛盾**：那条防跨文件漂移，这条防"测试跟着错"。
 *    ⚠ 禁止有人为了"统一风格"把下面的字面量改成 import。
 * 2. **夹具全部手写**：records 数组不调用 `recordKnownContact` 生成（否则落库写错会让夹具也错）。
 * 3. **不复用实施者的断言文件**。
 *
 * ── PENDING 与 FAIL 的区别 ───────────────────────────────────────────────
 * · PENDING = 模块/导出尚不存在（未实现，或导出名与规格不符）——**不计失败**，但会在末尾列出。
 * · FAIL    = 模块存在但断言不成立 —— **计入退出码**。
 * 这样本文件在实现落地前也能跑，用于自检台架本身是否可用。
 *
 * 用法：node scripts/bcAcceptanceSim.cjs
 *
 * ⚠ 口径：**以运行时摘要行 `PASS n / FAIL n / PENDING n` 为唯一口径**。
 *   不要用 `grep -c PASS` 之类去数（会把摘要行本身算进去，也会漏掉循环内产生的断言）。
 *   本条是踩过的坑：手抄条数会与实跑长期不一致，而"数字没实测"正是本文件要防的错误本身。
 *
 * ⚠ 汇报任何数字时，标注它属于哪一类（**汇报环节的同一类病**）：
 *   [实测] 夹具跑出来、与实现无关（附命令 + 原始输出行）  → 可作验收依据
 *   [推导] 由【规格常量】按公式**手算**（任何人代入都能复现） → 可作验收依据
 *   [基线] 跑被测实现得到的现状值（before/after 对照）      → **只做漂移对照，不可作门槛**
 *   [推算] 手算估计（"约 260px @0.9px/帧 ≈ 5s"）            → 只能当"该往哪个方向红"的预期
 *
 *   两条最容易犯的错：
 *   · 把 [推算] 当 [实测] 汇报 —— 把"没做"说成"做了"；
 *   · **把 [基线] 当门槛** —— "偏差 ≤10%" 只证明"没变糟"，不证明"变对了"。
 *     一个完全没改的实现也能与基线全等 ⇒ 全绿。这是"改了个寂寞"的最优伪装。
 *   ⇒ 门槛必须**独立于被测实现**：只能来自 [实测] 或 [推导]。
 *   ⇒ [推导] 的公式里若含被测函数的输出（如先调 `phaseThresholdsFrom` 再断言其值），
 *     即退化为 #1（抄被测值），应改判为 [基线]。
 *
 * ════════════════════════════════════════════════════════════════════════
 * 验收方法论（**适用于本项目所有台架，不只 B+C**）
 * ════════════════════════════════════════════════════════════════════════
 * 一个绿色的断言要同时回答三个问题，缺任何一个，绿色都不可信：
 *   ① 值对不对      → 期望独立于实现
 *   ② 在正确输入上测 → 输入跟随实现
 *   ③ 那个输入还构得成问题吗 → 采样前断言"结构上可采样"
 *
 * —— 四种"假绿"（测试通过，但没测到东西）——
 *  #1 期望抄了被测常量     ：常量写错时测试跟着错     → 期望值用【字面量】
 *  #2 取样点写死           ：常量改了、取样跑偏       → 输入【跟随】真值函数
 *  #3 区间宽度为 0         ：实现退化，断言落在空集上 → 【结构前置断言】
 *     （实例：far === approach 时，"两者之间的中点"退化成一个点）
 *     ⚠ 结构前置要断言"**分支可达**"（区间宽度 ≥ 下界），不只是"顺序正确"：
 *       严格不等式链只能拦住"全为 0"，拦不住"有序但极小"（4 > 3 > 2 > 1 px 带宽）。
 *  #4 分母退化           ：样本没了，指标变成常数     → 【比值/占比型先断言分母 ≥ 下限】
 *     （实例：空样本兜底成 1 ⇒ `|1/1−1| = 0 ≤ 0.10` 恒真）
 *  #5 分子恒 0 的上界断言 ：分母正常、但信号永远不出现 → 【正向对照】
 *     （实例：`翻转 ≤1`；若分档函数恒返回同一档，则 0 次翻转，断言恒真）
 *     ⚠ #4 与 #5 互补：#4 管"分母没了"，#5 管"分母在、但分子永远是 0"。
 *       判据方向速查里的 `≤ 配正向对照` 就是 #5 的通用形式。
 *
 * —— 判据方向速查 ——
 *   `≤` 型 → 必须配"该指标能变大"的正向对照（否则恒 0 即恒真）
 *   `≥` 型 → 必须配上限（防反向退化，如"全部落在同一档"）
 *   `===` 型 → 不用配（精确等值天然不空转）
 *   **占比/比值/分布统计型 → 无论方向，先断言分母 ≥ 样本量下限**
 *     （`0/0 === NaN`，而 NaN 与各比较运算符的结果各不相同，靠它"恰好变成红"是脆的）
 *
 * —— #6 容差纪律（最容易破，且破了看不出来）——
 *   **容差只能吸收"无法消除的噪声"，不能吸收"量错了"。**
 *   例：把命中距离当 `≤ 射程` 的证据 —— 但 `fireGate` 门控的是**开火瞬间**的距离；
 *       弹道飞行期间目标会移动，命中距离可以合法越界 ⇒ 你会看到 3~5% 越界，
 *       以为是插值噪声、给个 0.95 容差 —— **实际上是把"测量点选错了"永久埋掉**。
 *   ⇒ 先问"这个量的定义与判定时刻一致吗"，再谈给多大容差。
 *   ⇒ 容差一旦超过 5%，必须在 check 名字里写清"这 5% 是什么"（噪声来源），否则视为掩盖。
 *
 * —— #7 同源断言（#1 的延伸）——
 *   **证据不能取自被判定者本身，否则是同义反复。**
 *   例：门控写成 `d <= effectiveRange`，记录时也存 `{d, r: effectiveRange}`，再断言 `d <= r`
 *       ⇒ 恒真，只能抓"有人绕过门控"，抓不到"门控的射程值本身错了"。
 *   ⇒ 比对对象必须来自**规格常量**（如 `u.range`，地形只会更短）；
 *      若还想单独锁"没绕过门控"，另写一条**同一性断言**并明确标注它是同一性。
 *   ⇒ 判据：**"如果这个断言失败，是被测逻辑错了，还是我被自己的记录值骗了？"**
 *
 * —— #8 泄漏类断言（测"不该看见的东西有没有漏"）——
 *   需求是"某档不得泄露 X"时，断言必须写成 **"输出与 X 无关"**，而不是"输出看起来对"。
 *   例：`fuzzy` 不得泄露兵力 ⇒ 断言"该舰队的**标记数量**与 `units.length` 无关"
 *       （两个兵力不同的舰队，在 fuzzy 下标记数必须相同；若每单位一个符号，数一下就知道几艘）。
 *   ⇒ 做法：构造两个仅 `units.length` 不同的夹具，断言该档输出**逐项相等**。
 *   ⇒ 反例：只断言"标记存在" —— 它无法发现"标记数 = 舰数"这种泄漏。
 *
 * —— 哪类数字该字面量 ——
 *   被测对象的设计常量（阈值/比例/上限） → 期望里【必须字面量】（不能看答案）
 *   测试自己构造的输入参数（R/span/fleetId/N） → 【应当字面量】（题目要可复现）
 *     ⚠ 同一 check 用多组参数时，**把参数写进 check 名字**（如 `A2(span=2500,R=880)`），
 *       否则改夹具后红，会被误读成"实现坏了"。
 *   同一性断言的两边（`A === B`） → 【必须 import】两边
 *     （它问的是"两个符号是否指向同一个值"，不关心值等于多少；天然免疫 #1）
 *   `config/**` 里的常量 → **先问"这个数该不该变"，再决定**：
 *     承载设计意图（不该变） → 期望里写字面量，并注明"这是意图，不是抄值"
 *     只是可调参数（允许优化） → **不要断言它的值**，改断言关系/排序
 *        （写死 ⇒ 以后调参必红；import ⇒ 调参时它跟着动、等于没锁。两者都错）
 *     仅用于构造输入（取样点/夹具） → 允许 import
 *     ⚠ 漏掉第二行，人会一律写死当前值，把可调参数冻住 —— 这是"防抄值"的副作用。
 * ════════════════════════════════════════════════════════════════════════
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const BATTLE = path.join(SRC, 'game', 'battle');
/** SectorSweep 源文件路径（S2-08 静态断言用；定义在顶部避免 TDZ） */
const SECTOR_SWEEP_PATH = path.join(BATTLE, 'SectorSweep.ts');

let pass = 0;
const failures = [];
const pendings = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    process.stdout.write(`  FAIL ${name}: ${e.message}\n`);
  }
}
function pending(name, why) {
  pendings.push(`${name}（${why}）`);
  process.stdout.write(`  PEND ${name}（${why}）\n`);
}
function section(t) {
  process.stdout.write(`\n=== ${t} ===\n`);
}
/** 按"该特性是否已落地"决定 PENDING 还是硬断言（细粒度，见下 F_* 旗标） */
function checkGated(flag, name, fn) {
  if (!flag) {
    pending(name, '该特性未落地');
    return;
  }
  check(name, fn);
}
function approx(a, b, eps = 1e-6) {
  assert.ok(Number.isFinite(a), `期望有限数，实际 ${a}`);
  assert.ok(Math.abs(a - b) <= eps, `期望 ${b}±${eps}，实际 ${a}`);
}
/** 角度差（归一化到 (-π, π]） */
function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

// ── 懒加载：缺失即 PENDING，不抛 ────────────────────────────────────────
function load(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (e) {
    return { __missing: e.message };
  }
}
const INTEL = load('frontend/src/game/battle/intelFreshness.ts');
const SWEEP = load('frontend/src/game/battle/SectorSweep.ts');
const INTENT = load('frontend/src/game/battle/FleetIntentSystem.ts');
const TACT = load('frontend/src/game/TacticalCommandSystem.ts');
const INTEL_ARCHIVE = load('frontend/src/game/battle/IntelSystem.js');

/**
 * 细粒度旗标：**每个特性单独判定"是否已落地"**，而不是一个全局开关。
 *
 * 为什么不能用一个全局 IMPL：
 *   B+C 分 10 个 commit 落地。若 commit 1 建了 `intelFreshness.ts` 就翻全局开关，
 *   那么"IntelRecord 新字段"（commit 3）、"_searchDest 清理"（commit 6）等**尚未实现**的断言
 *   会立刻变成硬 FAIL ⇒ 提交后立刻一片红。
 *   ⇒ 而"提交后立刻一片红"正是"校验消耗信任"的入口：人会学会"刚提交时红是正常的"。
 * ⇒ 所以按特性分别 gate：只在该特性**声称已落地**之后才硬断言。
 */
const F_FRESH = fs.existsSync(path.join(BATTLE, 'intelFreshness.ts'));
const F_SWEEP = fs.existsSync(path.join(BATTLE, 'SectorSweep.ts'));
const F_MOVE = !INTENT.__missing && typeof INTENT.resolveMissionMove === 'function';

/** IntelRecord 是否真的落库了新字段（运行时探测，专防"只改 .d.ts"） */
const F_FIELDS = (() => {
  if (INTEL_ARCHIVE.__missing || typeof INTEL_ARCHIVE.recordKnownContact !== 'function') return false;
  try {
    const a = INTEL_ARCHIVE.createIntelArchive();
    const r = INTEL_ARCHIVE.recordKnownContact(a, {
      team: 1, targetId: 4242, kind: 'fleet', x: 0, y: 0, now: 0, strength: 1,
      factionId: 7, power: 1, vx: 0, vy: 0,
    });
    return r && r.factionId === 7;
  } catch (e) {
    return false;
  }
})();

const SCENE_SRC = (() => {
  const p = path.join(SRC, 'game', 'scenes', 'BattleScene.ts');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
})();
/** `_searchDest` 通道是否已接线（C1 落地标志） */
const F_DEST = /_searchDest/.test(SCENE_SRC);
/** `distanceOf` 注入口是否已存在（B2 落地标志） */
const F_DISTOF = (() => {
  const p = path.join(SRC, 'game', 'TacticalCommandSystem.ts');
  return fs.existsSync(p) && /distanceOf/.test(fs.readFileSync(p, 'utf8'));
})();

/**
 * `resolveMissionMove` 是否已**接线**到 BattleScene。
 *
 * 为什么要与 `F_MOVE` 分开：
 *   · S4-xx 测的是**纯函数本身** ⇒ 只要函数存在就该硬断言（`F_MOVE`）；
 *   · S6-04/05 测的是**调用方的接线**（不得再用 `tgt.x/tgt.y` 直赋 `_missionDest`）
 *     ⇒ 函数存在但还没接线时，旧代码当然还留着旧写法 ⇒ 此时报红是**误红**（"还没做"被当成"做错了"）。
 *   ⇒ 旗标必须对齐断言的真实依赖，而不是复用"同类功能"的旗标。
 */
/** `countLiveEnemyFactions` 是否已导出（僵尸阵营口径的唯一真源） */
const F_LIVE_FACTIONS = !!INTENT && !INTENT.__missing && typeof INTENT.countLiveEnemyFactions === 'function';
const F_MOVE_WIRED = !!INTENT && !INTENT.__missing
  && typeof INTENT.resolveMissionMove === 'function'
  && /\bresolveMissionMove\s*\(/.test(SCENE_SRC);

// 旗标可视：PENDING 时说清"是哪个特性还没落地"，避免"为什么这条一直 PEND"的来回问
process.stdout.write(
  `旗标 F_FRESH=${F_FRESH} F_SWEEP=${F_SWEEP} F_MOVE=${F_MOVE} F_MOVE_WIRED=${F_MOVE_WIRED} ` +
  `F_FIELDS=${F_FIELDS} F_DEST=${F_DEST} F_DISTOF=${F_DISTOF}\n`,
);
// "函数已存在但未接线"是一个**必须可见**的中间态：否则 S6-04/05 会永久 PENDING 而没人注意
if (F_MOVE && !F_MOVE_WIRED) {
  process.stdout.write('说明：F_MOVE=true 但未接线 ⇒ S6-04/05 保持 PENDING（等接线步骤），不是失败\n');
}

function missing(mod, name) {
  if (mod.__missing) return `模块不存在: ${mod.__missing.split('\n')[0]}`;
  if (typeof mod[name] !== 'function' && mod[name] === undefined) return `导出缺失: ${name}`;
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// S1 · intelFreshness（14 条）
// ══════════════════════════════════════════════════════════════════════
section('S1 intelFreshness 分档 / 唯一性 / 同源');

checkGated(F_FRESH, 'S1-01 声明唯一: export const INTEL_FRESH_MS', () => {
  const hits = walk(SRC).flatMap((f) => {
    const s = fs.readFileSync(f, 'utf8');
    return s.match(/export\s+const\s+INTEL_FRESH_MS\b/g) || [];
  });
  assert.equal(hits.length, 1, `期望恰好 1 处定义，实际 ${hits.length} 处`);
});
checkGated(F_FRESH, 'S1-02 声明唯一: export const INTEL_STALE_MS', () => {
  const hits = walk(SRC).flatMap((f) => {
    const s = fs.readFileSync(f, 'utf8');
    return s.match(/export\s+const\s+INTEL_STALE_MS\b/g) || [];
  });
  assert.equal(hits.length, 1, `期望恰好 1 处定义，实际 ${hits.length} 处`);
});

if (missing(INTEL, 'intelAgeTier')) {
  for (const n of ['S1-03', 'S1-04', 'S1-05', 'S1-06', 'S1-07', 'S1-08', 'S1-09', 'S1-10', 'S1-11', 'S1-12', 'S1-13']) {
    pending(n, missing(INTEL, 'intelAgeTier'));
  }
} else {
  const tier = (v) => INTEL.intelAgeTier(v);
  // 闭区间边界：10_000 / 25_000 归前一档
  check('S1-03 age=0 ⇒ fresh', () => assert.equal(tier(0), 'fresh'));
  check('S1-04 age=9999 ⇒ fresh', () => assert.equal(tier(9999), 'fresh'));
  check('S1-05 age=10000 ⇒ fresh（闭区间）', () => assert.equal(tier(10000), 'fresh'));
  check('S1-06 age=10001 ⇒ stale', () => assert.equal(tier(10001), 'stale'));
  check('S1-07 age=24999 ⇒ stale', () => assert.equal(tier(24999), 'stale'));
  check('S1-08 age=25000 ⇒ stale（闭区间）', () => assert.equal(tier(25000), 'stale'));
  check('S1-09 age=25001 ⇒ cold', () => assert.equal(tier(25001), 'cold'));
  // 非有限 / 负值：显式判空，不得依赖 NaN 比较的隐式行为
  check('S1-10 age=NaN ⇒ cold', () => assert.equal(tier(NaN), 'cold'));
  check('S1-11 age=Infinity ⇒ cold', () => assert.equal(tier(Infinity), 'cold'));
  check('S1-12 age=undefined ⇒ cold', () => assert.equal(tier(undefined), 'cold'));
  check('S1-13 age=-1 ⇒ fresh（时钟回拨：宁可当作刚看见）', () => assert.equal(tier(-1), 'fresh'));
}

if (INTEL.__missing || INTEL.CONTACT_TARGET_MAX_AGE_MS === undefined) {
  pending('S1-14 同源: CONTACT_TARGET_MAX_AGE_MS === INTEL_STALE_MS', '导出缺失');
} else {
  check('S1-14 同源: CONTACT_TARGET_MAX_AGE_MS === INTEL_STALE_MS', () => {
    assert.equal(INTEL.CONTACT_TARGET_MAX_AGE_MS, INTEL.INTEL_STALE_MS);
  });
}

// ══════════════════════════════════════════════════════════════════════
// S2 · SectorSweep 几何（6 条）
// 规格要求导出：sweepWaypoints({sectorIndex, origin, clueBearing, R}) → Point[4]
// ⚠ 无 fleetId：几何是纯的；每舰的"从哪个扇区开始"由 defaultSectorIndex 决定（签名即契约）。
// ══════════════════════════════════════════════════════════════════════
section('S2 SectorSweep 四腿几何');

const SWEEP_FN = SWEEP.__missing ? null : (SWEEP.sweepWaypoints || null);
if (!SWEEP_FN) {
  for (const n of ['S2-01', 'S2-02', 'S2-03', 'S2-04', 'S2-05', 'S2-06']) {
    pending(n, SWEEP.__missing ? '模块不存在' : '导出缺失: sweepWaypoints');
  }
} else {
  const R = 1000;
  const origin = { x: 0, y: 0 };
  const aim = { sectorIndex: 1, origin, clueBearing: 0, R };
  const wp = SWEEP_FN(aim);

  check('S2-01 返回 4 个航点', () => assert.equal(wp.length, 4));
  // 期望值 0.45 抄自规格，不 import SEARCH_LEG_RATIO
  check('S2-02 |WP0-origin| = 0.45R = 450', () => {
    approx(Math.hypot(wp[0].x - origin.x, wp[0].y - origin.y), 450, 1e-6);
  });
  check('S2-03 sectorIndex=1 时 WP0 方位 = clueBearing', () => {
    approx(angDiff(Math.atan2(wp[0].y, wp[0].x), 0), 0, 1e-9);
  });
  check('S2-04 sectorIndex=0/2 时偏向 ∓25°', () => {
    const a = SWEEP_FN({ ...aim, sectorIndex: 0 })[0];
    const b = SWEEP_FN({ ...aim, sectorIndex: 2 })[0];
    approx(angDiff(Math.atan2(a.y, a.x), -25 * Math.PI / 180), 0, 1e-9);
    approx(angDiff(Math.atan2(b.y, b.x), +25 * Math.PI / 180), 0, 1e-9);
  });
  check('S2-05 横向腿与轴线垂直（点积≈0）', () => {
    const d0 = { x: wp[0].x - origin.x, y: wp[0].y - origin.y };
    const d1 = { x: wp[1].x - wp[0].x, y: wp[1].y - wp[0].y };
    approx(d0.x * d1.x + d0.y * d1.y, 0, 1e-6);
  });
  check('S2-06 横向全宽 = 1.0R、回轴 = 0.5R', () => {
    approx(Math.hypot(wp[2].x - wp[1].x, wp[2].y - wp[1].y), 1000, 1e-6);
    approx(Math.hypot(wp[3].x - wp[2].x, wp[3].y - wp[2].y), 500, 1e-6);
  });

  // ── 接口面断言：行为断言看不见「模块暴露了什么」──────────────
  // ── S2-07 / S2-08：**契约型静态断言**（验收方重写版）──────────────────
  // 来源：实施方提出"导出面与签名也应当被锁"（提案），验收方评估后在此落地并重写。
  // 为什么必须是静态断言：
  //   · 导出面是**代码被写下的那一刻**就生效的性质，跑任何东西都不会"变坏"；
  //   · `SweepAim` 是 TS interface，**运行时被擦除** ⇒ 行为断言根本看不见它。
  // ⇒ 这正是"行为断言天生看不见形状"那条的实例（第 9 条）。
  check('S2-07 导出面恰好 4 项（多导出=邀请第二套派生）', () => {
    const EXPECTED = ['SECTOR_OFFSET_RAD', 'SWEEP_GEOMETRY', 'defaultSectorIndex', 'sweepWaypoints'];
    const actual = Object.keys(SWEEP).sort();
    assert.deepEqual(actual, EXPECTED.slice().sort(),
      `导出面不符；实际 [${actual.join(', ')}]`);
  });
  check('S2-08 SweepAim 字段恰好 4 项且不含 fleetId', () => {
    const src = fs.readFileSync(SECTOR_SWEEP_PATH, 'utf8');
    const block = src.match(/interface\s+SweepAim\s*\{([\s\S]*?)\n\}/);
    assert.ok(block, '未找到 interface SweepAim');
    const fields = [...block[1].matchAll(/^\s{2}(\w+)\s*[?]?:/gm)].map((m) => m[1]).sort();
    assert.deepEqual(fields, ['R', 'clueBearing', 'origin', 'sectorIndex'],
      `SweepAim 字段不符；实际 [${fields.join(', ')}]`);
  });
}

// ══════════════════════════════════════════════════════════════════════
// S3 · 确定性 + 扇区分配（2 条）
// 规格要求导出：defaultSectorIndex(fleetId) → 0|1|2
// ══════════════════════════════════════════════════════════════════════
section('S3 确定性 / 默认扇区分配');

if (!SWEEP_FN) {
  pending('S3-01 同入参两次调用逐位相等', 'sweepWaypoints 缺失');
} else {
  check('S3-01 同入参两次调用逐位相等', () => {
    const a = SWEEP_FN({ sectorIndex: 1, origin: { x: 3, y: 4 }, clueBearing: 0.7, R: 800 });
    const b = SWEEP_FN({ sectorIndex: 1, origin: { x: 3, y: 4 }, clueBearing: 0.7, R: 800 });
    assert.deepEqual(a, b);
  });
}

if (SWEEP.__missing || typeof SWEEP.defaultSectorIndex !== 'function') {
  pending('S3-02 defaultSectorIndex 覆盖三个扇区', '导出缺失: defaultSectorIndex');
} else {
  check('S3-02 defaultSectorIndex 覆盖三个扇区（20 个 fleetId 全出现）', () => {
    const seen = new Set();
    for (let id = 1; id <= 20; id += 1) seen.add(SWEEP.defaultSectorIndex(id));
    assert.equal(seen.size, 3, `实际只出现 ${[...seen].join(',')}`);
  });
}

// S3-03：`stableHash32` 必须**纯**——"确定性"是它存在的全部价值。
//
// ⚠ 为什么这条必须拆成"静态 + 行为"两半：
//   · `Math.random()` 能被行为测到（连续调用会变）；
//   · **`Date.now()` 在同一 tick 内返回值相同 ⇒ 行为测不到**（要到跨帧才漂移）。
//   ⇒ 所以"体内有没有时钟/随机"是**代码形状**问题，只能读源码静态判；
//     "同 id 是否恒定"是**可观测后果**，用行为判。
//   ⇒ 这也是本轮第 9 条：**能静态判的性质用静态断言，行为断言只看得到后果。**
//
// ⚠ 此处**不得** require `stableHash32` —— 它是模块私有（不导出），
//   一旦按导出名探测就会永远 PENDING（"悄悄停止检查"比没有更糟）。

check('S3-03 stableHash32 体内无时钟/随机（静态断言）', () => {
  const src = fs.readFileSync(SECTOR_SWEEP_PATH, 'utf8');
  const i = src.indexOf('function stableHash32');
  assert.ok(i >= 0, '未找到 stableHash32 定义');
  // 取函数体：从定义处到下一个顶层 `}` 换行
  const rest = src.slice(i);
  const end = rest.indexOf('\n}');
  const body = end >= 0 ? rest.slice(0, end) : rest;
  assert.ok(
    !/Date\.now|Math\.random|performance\.now|process\.hrtime/.test(body),
    'stableHash32 体内出现时钟/随机 —— 扇区分配会逐帧漂移',
  );
});

if (SWEEP.__missing || typeof SWEEP.defaultSectorIndex !== 'function') {
  pending('S3-04 defaultSectorIndex 同 id 多次调用恒定', '导出缺失: defaultSectorIndex');
} else {
  check('S3-04 defaultSectorIndex 同 id 连续 200 次恒定（行为断言）', () => {
    let first = null;
    for (let i = 0; i < 200; i += 1) {
      const v = SWEEP.defaultSectorIndex(7);
      if (first === null) first = v;
      else assert.equal(v, first, `第 ${i} 次返回 ${v}，与首次 ${first} 不同`);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
// S4 · settle 闸表（8 条）：computeForceRatio / canCommitSiege / resolveMissionMove
// ══════════════════════════════════════════════════════════════════════
section('S4 情报门 / siege 闸表');

/** 手写记录（**不调用** recordKnownContact，避免落库缺陷污染夹具） */
function rec(o) {
  return Object.assign(
    { targetId: 1, factionId: 11, x: 0, y: 0, ageMs: 3000, tier: 'fresh', power: 200, reliable: true },
    o,
  );
}

if (INTENT.__missing || typeof INTENT.resolveMissionMove !== 'function') {
  for (const n of ['S4-01', 'S4-02', 'S4-03', 'S4-04', 'S4-05']) {
    pending(n, INTENT.__missing ? '模块不存在' : '导出缺失: resolveMissionMove');
  }
} else {
  // ⚠ 只传 MissionMoveInput **实际声明**的 4 个字段：
  //   myTeam/myPower/myFleetCount/enemyLiveFactionCount/clueBearing/searchPoint/nowMs
  //   属于 computeForceRatio / canCommitSiege 与调用方，**不在这个签名里**。
  //   （台架也不该演示一个不存在的契约 —— 与删 `SweepAim.fleetId` 同一条规矩。）
  const base = {
    mission: { type: 'attack_fleet', targetId: 11 },
    myPos: { x: 0, y: 0 },
    records: [],
    enemyBaseRec: null,
  };
  const run = (o) => INTENT.resolveMissionMove(Object.assign({}, base, o));

  // A-1：无情报 ⇒ 去搜，不去追
  check('S4-01 空档案 ⇒ kind=search 且 dest=null', () => {
    const r = run({ records: [] });
    assert.equal(r.kind, 'search');
    assert.equal(r.dest, null);
  });
  // A-2a：fresh ⇒ 压上
  check('S4-02 fresh 档案 ⇒ kind=mission / stance=siege', () => {
    const r = run({ records: [rec({ x: 1200, y: 0, ageMs: 3000, tier: 'fresh' })] });
    assert.equal(r.kind, 'mission');
    assert.equal(r.stance, 'siege');
  });
  // A-2b：stale ⇒ 只朝那个方向摸
  check('S4-03 stale 档案 ⇒ kind=mission / stance=search', () => {
    const r = run({ records: [rec({ x: 1200, y: 0, ageMs: 18000, tier: 'stale' })] });
    assert.equal(r.kind, 'mission');
    assert.equal(r.stance, 'search');
  });
  // cold 不得当目标
  check('S4-04 cold 档案 ⇒ kind=search 且 dest=null', () => {
    const r = run({ records: [rec({ x: 1200, y: 0, ageMs: 40000, tier: 'cold' })] });
    assert.equal(r.kind, 'search');
    assert.equal(r.dest, null);
  });
  // 阵营 id 目标：取最新一条（ageMs 最小）
  check('S4-05 阵营 id 目标 ⇒ 取 ageMs 最小者', () => {
    const r = run({
      records: [
        rec({ targetId: 5, factionId: 11, x: 5000, y: 0, ageMs: 9000, tier: 'stale' }),
        rec({ targetId: 9, factionId: 11, x: 1200, y: 0, ageMs: 1000, tier: 'fresh' }),
      ],
    });
    const d5 = Math.hypot(r.dest.x - 5000, r.dest.y - 0);
    const d9 = Math.hypot(r.dest.x - 1200, r.dest.y - 0);
    assert.ok(d9 < d5, `应贴近 targetId=9（x=1200），实际 ${JSON.stringify(r.dest)}`);
  });

  // ── S4-11：tie-break 第二级 —— 同 ageMs 时取**离我最近** ────────────────
  // 第三级（targetId 字典序）**刻意不断言**：它只在"ageMs 相同且坐标完全相同"时才起作用，
  //   构造需要两支 id 不同、坐标相同的舰队，属于人为极端，且它的存在只为让"完全并列"可判定。
  //   （但它是真实逻辑：若第二级把 `<` 写成 `<=`，第三级会决定"最后一个赢"还是"第一个赢"。）
  check('S4-11 同 ageMs 时取离我最近者（tie-break 第二级）', () => {
    const r = run({
      records: [
        rec({ targetId: 5, factionId: 11, x: 900, y: 0, ageMs: 3000, tier: 'fresh' }),
        rec({ targetId: 9, factionId: 11, x: 100, y: 0, ageMs: 3000, tier: 'fresh' }),
      ],
    });
    const dNear = Math.hypot(r.dest.x - 100, r.dest.y - 0);
    assert.ok(dNear < 1e-6, `应取更近的 (100,0)；实际 dest=${JSON.stringify(r.dest)}`);
  });
}

// —— forceRatio 与 siege 闸：必须由纯函数导出，否则四条防线无法单测 ——
if (INTENT.__missing || typeof INTENT.computeForceRatio !== 'function') {
  for (const n of [
    'S4-06 空档案 ⇒ forceRatio = 1（不是 999）',
    'S4-14 分母纯净：power=null 不进分子也不进分母',
    'S4-15 样本全无效（cold/null）⇒ 仍为 1',
    'S4-16 stale 权重必须是 0.7（不是 1）',
    'S4-17 clamp 两端都生效（上限 6 / 下限 0.15）',
  ]) pending(n, '导出缺失: computeForceRatio');
} else {
  check('S4-06 空档案 ⇒ forceRatio = 1（不是 999）', () => {
    const v = INTENT.computeForceRatio({ myPower: 500, records: [] });
    assert.equal(v, 1);
    assert.notEqual(v, 999);
  });
  // ── S4-14：分母纯净 —— `power === null` 既**不进分子也不进分母** ─────────
  // 之所以要一组"能让两种算法结果显著不同"的数据：
  //   样本 = [100(fresh), 100(fresh), null(fresh)]，myPower = 200
  //   · 正确（丢弃 null）：200 / 100                = 2.0   ← 低于 2.30 ⇒ 不攻坚
  //   · 错误 A（null 当 0 进分子但计权重）：200/66.67 = 3.0   ← 越过 2.30 ⇒ 误判优势
  //   · 错误 B（丢弃样本但 Σw 仍用 3）：  200/66.67 = 3.0   ← 同上
  // ⇒ 三种算法给出 2.0 / 3.0 / 3.0，且**跨过 siege 阈值**，所以这条不只看"算得对"，还看"决策对不对"。
  check('S4-14 分母纯净：power=null 的样本既不进分子也不进分母（结果 = 2.0，不是 3.0）', () => {
    const v = INTENT.computeForceRatio({
      myPower: 200,
      records: [
        { targetId: 1, power: 100, tier: 'fresh' },
        { targetId: 2, power: 100, tier: 'fresh' },
        { targetId: 3, power: null, tier: 'fresh' },
      ],
    });
    assert.ok(Math.abs(v - 2.0) < 1e-9, `期望 2.0（丢弃 null）；实际 ${v}` +
      `（≈3.0 说明 null 被当 0 计入，或 Σw 把 null 样本也算了）`);
  });
  // ── S4-15：样本存在但**全部无效**（cold / null）⇒ 与"无情报"同处理 ────────
  // 这条与 S4-06 不同：S4-06 是空数组，这条是"有记录但一条都用不上"。
  //   若实现写成 `records.length === 0 ? 1 : …`，就会掉进 0/0 或除以 0，得到 NaN/Infinity。
  check('S4-15 样本全无效（cold/null）⇒ 仍为 1（不是 0/NaN/Infinity）', () => {
    const v = INTENT.computeForceRatio({
      myPower: 500,
      records: [
        { targetId: 1, power: 100, tier: 'cold' },
        { targetId: 2, power: null, tier: 'fresh' },
      ],
    });
    assert.equal(v, 1, `实际 ${v}`);
  });
  // ── S4-16：`stale` 的权重必须是 0.7（这条是"变异测试"逼出来的）───────────
  // 单靠 fresh/null 样本，把 `w = tier==='fresh' ? 1 : 0.7` 改成 `? 1 : 1` 也不会红 ——
  //   因为等权样本下加权与不加权结果相同。必须用**不等权重的样本**才能分辨：
  //   样本 [100(stale), 100(stale), 400(fresh)]，myPower = 450
  //     · 正确：(70+70+400)/2.4 = 225  ⇒ 450/225 = 2.00
  //     · 变异（stale 当 1）：(100+100+400)/3 = 200 ⇒ 450/200 = 2.25
  check('S4-16 stale 权重 = 0.7（结果 2.00，不是 2.25）', () => {
    const v = INTENT.computeForceRatio({
      myPower: 450,
      records: [
        { targetId: 1, power: 100, tier: 'stale' },
        { targetId: 2, power: 100, tier: 'stale' },
        { targetId: 3, power: 400, tier: 'fresh' },
      ],
    });
    assert.ok(Math.abs(v - 2.0) < 1e-9, `期望 2.00；实际 ${v}（2.25 ⇒ stale 被当成 1）`);
  });
  // ── S4-17：clamp 两端都生效 ───────────────────────────────────────────────
  // 上限 6：一支 100 打一支 1 ⇒ 原始 100 ⇒ 必须夹到 6，否则"绝对优势"会溢出到决策层；
  // 下限 0.15：1 打 1000 ⇒ 原始 0.001 ⇒ 必须夹到 0.15，否则"残兵"被算成毫无希望。
  check('S4-17 clamp 两端生效（上限 6 / 下限 0.15）', () => {
    const hi = INTENT.computeForceRatio({ myPower: 100, records: [{ targetId: 1, power: 1, tier: 'fresh' }] });
    assert.equal(hi, 6, `上限未生效：实际 ${hi}`);
    const lo = INTENT.computeForceRatio({ myPower: 1, records: [{ targetId: 1, power: 1000, tier: 'fresh' }] });
    assert.equal(lo, 0.15, `下限未生效：实际 ${lo}`);
  });
}

if (INTENT.__missing || typeof INTENT.canCommitSiege !== 'function') {
  for (const n of ['S4-07', 'S4-08', 'S4-12', 'S4-13', 'S4-18']) pending(n, '导出缺失: canCommitSiege');
} else {
  // ── 四条 siege 防线（互为反向守卫；缺一条，闸就会被调歪一个方向）──────────
  // 每条对应的反例都真实发生过：3v1（永不攻坚）、10v2（非对称修过头）、僵尸阵营（死闸）。
  // B-1：3 个敌阵营、只识别 1 支 ⇒ 拦住
  check('S4-07 3 敌阵营识 1 支 ⇒ 不许 siege', () => {
    assert.equal(INTENT.canCommitSiege({ forceRatio: 2.5, identifiedCount: 1, enemyLiveFactionCount: 3 }), false);
  });
  // B-2：敌方仅 1 支 ⇒ 允许（防"永不攻坚"：3v1/10v1 时 identified 上限就是 1）
  check('S4-08 敌 1 阵营识 1 支 + 2.5 倍 ⇒ 允许 siege', () => {
    assert.equal(INTENT.canCommitSiege({ forceRatio: 2.5, identifiedCount: 1, enemyLiveFactionCount: 1 }), true);
  });
  // B-3：10v2 —— 我方 10 支、敌方 1 阵营 2 支、两支全识别 ⇒ 必须允许
  //   锁的是"门槛不得随我方数量抬升"（这正是早期用 max(1, 我方数) 当分母时崩掉的形态）
  check('S4-12 10v2 识别 2 支 ⇒ 允许 siege（防非对称修过头）', () => {
    assert.equal(INTENT.canCommitSiege({ forceRatio: 2.5, identifiedCount: 2, enemyLiveFactionCount: 1 }), true);
  });
  // B-4：终盘僵尸阵营 —— 2 个 active 但只有 1 个还有舰队 ⇒ 调用侧口径应为 need=1 ⇒ 允许
  check('S4-13 终盘仅 1 个阵营有舰队 ⇒ need=1 ⇒ 允许 siege（防死闸）', () => {
    assert.equal(INTENT.canCommitSiege({ forceRatio: 2.5, identifiedCount: 1, enemyLiveFactionCount: 1 }), true);
  });
  // B-5：阈值边界 2.30 必须真的在判据里（这条也是变异测试逼出来的）──────
  // 单靠 2.5 的样本，把 `> 2.30` 改成 `> 2.0` 不会红（2.5 两边都过）⇒ 阈值本身没有被钉住。
  //   · 2.29 ⇒ false（差 0.01 就不该过）
  //   · 2.31 ⇒ true
  // ⚠ 2.30 属"受保护常量"（裁决已冻结）。若将来裁决允许调参，**本条需与裁决同步改**，
  //   而不是"因为它红了就去改阈值"。
  check('S4-18 优势阈值边界 2.30（2.29⇒false / 2.31⇒true）', () => {
    assert.equal(INTENT.canCommitSiege({ forceRatio: 2.29, identifiedCount: 1, enemyLiveFactionCount: 1 }), false,
      '2.29 不该过（阈值被调低了？）');
    assert.equal(INTENT.canCommitSiege({ forceRatio: 2.31, identifiedCount: 1, enemyLiveFactionCount: 1 }), true,
      '2.31 该过（阈值被调高了？）');
  });

  // ── S4-19：`countLiveEnemyFactions` 必须排除僵尸阵营 ──────────────────────
  // 为什么必须是纯函数而不是"源码审查"：源码审查不进回归面，下次重构照样退化、台架还绿。
  // 僵尸阵营 = `active: true` 但 `combatFleetCount === 0`（已被打光、尚未置 inactive）
  //   ⇒ 若把它数进去，`need` 会被抬到永远达不成 ⇒ **终盘永不攻坚**。
  // 三种情形都要覆盖，缺一条都会留下一个死闸方向。
  checkGated(F_LIVE_FACTIONS, 'S4-19 countLiveEnemyFactions 排除僵尸 / 未参战 / 空数组', () => {
    const f = INTENT.countLiveEnemyFactions;
    // ① 僵尸阵营不计（active 但无战斗舰队）
    assert.equal(f({ factions: [
      { id: 'a', active: true, combatFleetCount: 0 },
      { id: 'b', active: true, combatFleetCount: 2 },
    ] }), 1, '僵尸阵营被计入 ⇒ need 会永久偏高');
    // ② 未参战阵营不计（active=false 但仍有舰队）
    assert.equal(f({ factions: [{ id: 'c', active: false, combatFleetCount: 3 }] }), 0,
      '未参战阵营被计入');
    // ③ 空数组 ⇒ 0；且 0 经 canCommitSiege 的 max(1,·) 兜底后仍**允许**攻坚
    //    ← 这条防"空 ⇒ 永远不许"的死闸（若有人把 need 写成 max(0,·) 或对 0 特判）
    assert.equal(f({ factions: [] }), 0, '空数组结果应为 0');
    assert.equal(
      INTENT.canCommitSiege({ forceRatio: 3, identifiedCount: 1, enemyLiveFactionCount: 0 }),
      true,
      'enemyLiveFactionCount=0 时被闸死 ⇒ 终盘永不攻坚',
    );
  });
}


// ── S4-10：`MissionMoveInput` 的字段必须**恰好**是 4 个 ───────────────────
// 防"传了但不读"的参数回潮（与 SweepAim 删 fleetId 同一条规矩）：
//   myTeam / myPower / myFleetCount / enemyLiveFactionCount / clueBearing /
//   searchPoint / nowMs 都不属于本函数 —— 一旦有人"顺手加回来"，这条就红。
check('S4-10 MissionMoveInput 字段恰好 4 项（无"传了不读"的参数）', () => {
  const src = fs.readFileSync(path.join(BATTLE, 'FleetIntentSystem.ts'), 'utf8');
  const blk = src.match(/export interface MissionMoveInput\s*\{([\s\S]*?)\n\}/);
  assert.ok(blk, '未找到 interface MissionMoveInput');
  const fields = [...blk[1].matchAll(/^\s{2}(\w+)\s*[?]?:/gm)].map((m) => m[1]).sort();
  assert.deepEqual(fields, ['enemyBaseRec', 'mission', 'myPos', 'records'],
    `MissionMoveInput 字段不符；实际 [${fields.join(', ')}]`);
});

// ══════════════════════════════════════════════════════════════════════
// S5 · resolveMissionTargets.distanceOf 缺省不变（2 条）
// ══════════════════════════════════════════════════════════════════════
section('S5 resolveMissionTargets distanceOf 缺省语义');

if (TACT.__missing || typeof TACT.resolveMissionTargets !== 'function') {
  pending('S5-01 缺省 distanceOf ⇒ 仍按真实距离排序', '模块或导出缺失');
  pending('S5-02 全 Infinity ⇒ 保持输入序（稳定）', '模块或导出缺失');
} else {
  const mkFleet = (id, fac, x, units) => ({ id, factionId: fac, x, y: 0, units: new Array(units).fill({}) });
  const fleets = [mkFleet(5, 11, 5000, 3), mkFleet(9, 11, 1200, 3)];
  const isEnemy = (f) => f.factionId === 11;

  check('S5-01 缺省 distanceOf ⇒ 仍按真实距离排序（近者在前）', () => {
    const out = TACT.resolveMissionTargets(fleets, 11, { relation: isEnemy, from: { x: 0, y: 0 } });
    assert.deepEqual(out.map((f) => f.id), [9, 5]);
  });
  checkGated(F_DISTOF, 'S5-02 全 Infinity ⇒ 保持输入序（稳定、不按真距离）', () => {
    // ⚠ 实现要点：`Infinity - Infinity === NaN`，而 Array.sort 的比较函数返回 NaN 时
    //   顺序是**实现定义**的（V8 当前当 0，但不可依赖）。
    //   ⇒ 正确写法不是 `sort((a,b) => distanceOf(a) - distanceOf(b))`，
    //     而是"全部非有限 ⇒ 直接返回过滤后的数组，不排序"。
    const out = TACT.resolveMissionTargets(fleets, 11, {
      relation: isEnemy,
      from: { x: 0, y: 0 },
      distanceOf: () => Infinity,
    });
    assert.deepEqual(out.map((f) => f.id), [5, 9]);
  });
}


// ── S5-04：未知目标的哨兵基值必须**大于地图对角线** ────────────────────────
// 语义：未知目标用 `BASE + real` 排序，前提是"任何真实距离都 < BASE"。
//   · 物理约束：BASE > 对角线（hexRadius ≤ 50 ⇒ 跨度 ≤ 2500 ⇒ 对角线 ≈ 3536）
//   · 治理余量：×4（不是物理常数，只保证"不把仍然安全的较小基值判红"）
//   ⚠ 若有人把基值调到地图尺度内，"已知恒排在未知之前"会静默失效（不报错、只是顺序变了）。
check('S5-04 未知哨兵基值 > 4 × 地图对角线（物理约束 + 治理余量）', () => {
  const src = fs.readFileSync(path.join(SRC, 'game', 'scenes', 'BattleScene.ts'), 'utf8');
  const m = src.match(/UNKNOWN_TARGET_DIST_BASE\s*=\s*([0-9_eE+.]+)/);
  assert.ok(m, '未找到具名常量 UNKNOWN_TARGET_DIST_BASE（应先把它提成常量再断言）');
  const base = Number(m[1]);
  assert.ok(Number.isFinite(base), `基值不是有限数: ${m[1]}`);
  const MAX_SPAN = 50 * 50;              // hexRadius 上限 50 ⇒ 跨度 = hexRadius×50
  const DIAG = Math.SQRT2 * MAX_SPAN;    // 真实距离上界 ≈ 对角线 ≈ 3536
  assert.ok(base > 4 * DIAG, `基值 ${base} 未超过对角线的 4 倍（${Math.round(4 * DIAG)}）`);
});

// ══════════════════════════════════════════════════════════════════════
// S6 · 源码不变量（5 条）—— 这些只能在源码层锁
// ══════════════════════════════════════════════════════════════════════
section('S6 源码不变量（防"顺手改回去"）');

const SCENE = path.join(SRC, 'game', 'scenes', 'BattleScene.ts');
const sceneSrc = fs.existsSync(SCENE) ? fs.readFileSync(SCENE, 'utf8') : '';

function sliceFn(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) return '';
  const j = src.indexOf(endMarker, i + startMarker.length);
  return j < 0 ? src.slice(i) : src.slice(i, j);
}

check('S6-01 clearEnemies 逐字保留（0.1）', () => {
  assert.ok(
    sceneSrc.includes("const clearEnemies = visibleEnemies.filter(v => v.clarity === 'full')"),
    '那一行被改动了 —— 开火门可能被悄悄放宽',
  );
});

checkGated(F_DEST, 'S6-02 resolveFleetIntent 调用点 knownEnemy: null（0.4）', () => {
  assert.ok(/knownEnemy:\s*null/.test(sceneSrc), '未找到 `knownEnemy: null` —— 读真值的入口可能被填上');
});

checkGated(F_DEST, 'S6-03 三处 mission=null 均清理 _searchDest（0.6）', () => {
  const lines = sceneSrc.split('\n');
  const offenders = [];
  lines.forEach((l, i) => {
    if (!/\.mission\s*=\s*null/.test(l)) return;
    // 同一行或紧邻 3 行内必须出现 _searchDest = null
    const win = lines.slice(i, i + 4).join('\n');
    if (!/_searchDest\s*=\s*null/.test(win)) offenders.push(i + 1);
  });
  assert.deepEqual(offenders, [], `这些 mission=null 未清理 _searchDest: 行 ${offenders.join(',')}`);
});

checkGated(F_MOVE_WIRED, 'S6-04 attack_fleet 分支不得用 tgt.x/tgt.y 直赋 _missionDest（C-1）', () => {
  const blk = sliceFn(sceneSrc, "if (m.type === 'attack_fleet')", "} else if (m.type === 'capture_planet')");
  assert.ok(blk.length > 0, '未定位到 attack_fleet 分支');
  assert.ok(
    !/_missionDest\s*=\s*\{\s*x:\s*tgt\.x/.test(blk),
    '仍在用 tgt.x/tgt.y（活坐标）写 _missionDest —— 去全知失效',
  );
});

checkGated(F_MOVE_WIRED, 'S6-05 fuzzy 查证分支不得直赋 fz.ef.x（C-3）', () => {
  const blk = sliceFn(sceneSrc, "fuzzyTargets.length > 0", '} else if (fleet.stance === \'defend\')');
  assert.ok(blk.length > 0, '未定位到 fuzzyTargets 分支');
  assert.ok(
    !/fleetTargetX\s*=\s*fz\.ef\.x/.test(blk),
    '仍在直赋 fz.ef.x（活坐标）—— 去全知失效',
  );
});


// ── S6-06：调用方必须**先用 isKnownTrackReliable 过滤**再传给纯函数 ────────
// 背景：`resolveMissionMove` 刻意不判 `reliable`（避免第三套约定），
//   可靠性只在调用方判一次。⇒ 这条把"调用方契约"变成可断言的形状。
// ⚠ 若第 6 步用了别的过滤形式（例如先拼好数组再传），请告诉验收方改断言，**不要改实现去迁就断言**。
// ── S6-07：fuzzy 分支若仍使用活坐标，**必须量化**（"格级精度"语义）──────────
// 背景（已与实施方确认的语义）：
//   · 无档案时若完全不查证，会回到 v6 修掉的"视野边缘双方互判模糊 ⇒ 双双驻守"；
//   · 因此**接受**"fuzzy = 格级精度"：读一次活坐标，但吸附到 `2×hexRadius` 的格心。
//   ⚠ 这不是"去位置"，而是"去精确值" —— 规格本身允许"方位 + 距离"（信息等价或更强），
//     所以这是**在规格之内的取舍**，不是破例；但必须写进代码注释，否则后人会以为是遗漏。
// ⇒ 本条的职责：锁"必须量化"。删掉量化（改回直赋）必红。
checkGated(F_MOVE_WIRED, 'S6-07 fuzzy 分支的活坐标必须量化（格级精度）', () => {
  const blk = sliceFn(sceneSrc, "fuzzyTargets.length > 0", "} else if (fleet.stance === 'defend')");
  assert.ok(blk.length > 0, '未定位到 fuzzyTargets 分支');
  // ⚠ 先剔除注释行：注释里若举例写了 `fleetTargetX = fz.ef.x`（正是要警告的写法），
  //   不剔除就会把"提醒"当成"违规"（与 S7-03 剥注释同一个教训，这次我先自己踩到）。
  const usesTruth = blk.split('\n')
    .filter((l) => !/^\s*\//.test(l))
    .filter((l) => /fleetTarget[XY]\s*=/.test(l) && /fz\.ef\./.test(l));
  // 若已完全改成"只读档案"（不使用 fz.ef.），本条自动满足 —— 那是更好的形态，不算空转。
  //
  // 容忍形态（**断言跟结构，不跟写法**）：
  //   · 行内量化：`Math.round(fz.ef.x / cell) * cell`、或同行出现 `hexRadius`
  //   · **把量化抽成辅助函数**：只要 `fz.ef.x/y` 是某个调用的实参（`quantize(fz.ef.x)`），也算合规
  // ⇒ 裸写 `fleetTargetX = fz.ef.x` 或只做算术位移（`fz.ef.x + 5`）都会被判红 —— 那才是"没量化"。
  const QUANT = /Math\.(round|floor|ceil|trunc)\s*\(|hexRadius/;
  const WRAPPED = /\b[A-Za-z_$][\w$]*\s*\(\s*fz\.ef\.[xy]/;
  const bad = usesTruth.filter((l) => !QUANT.test(l) && !WRAPPED.test(l));
  assert.deepEqual(bad.map((l) => l.trim()), [],
    `下列赋值的活坐标未量化（模糊档会退化成"精确知道")：\n${bad.join('\n')}`);
});

checkGated(F_MOVE_WIRED, 'S6-06 接线处用 isKnownTrackReliable 过滤档案（调用方契约）', () => {
  const src = SCENE_SRC;
  const at = src.search(/resolveMissionMove\s*\(/);
  assert.ok(at >= 0, '未找到 resolveMissionMove 调用点');
  const window = src.slice(Math.max(0, at - 3000), at + 1500);
  assert.ok(
    /isKnownTrackReliable\s*\(/.test(window),
    'resolveMissionMove 调用附近未见 isKnownTrackReliable —— 可靠性可能没被过滤（档案的 reliable=false 会被当成可用）',
  );
});

// ══════════════════════════════════════════════════════════════════════
// S7 · 落库（2 条）：防 .js↔.d.ts 静默
// ══════════════════════════════════════════════════════════════════════
section('S7 IntelRecord 新字段落库');

if (INTEL_ARCHIVE.__missing || typeof INTEL_ARCHIVE.recordKnownContact !== 'function') {
  pending('S7-01 运行时能读到 4 个新字段', 'IntelSystem 模块或导出缺失');
} else {
  checkGated(F_FIELDS, 'S7-01 运行时能读到 factionId / power / vx / vy', () => {
    const arch = INTEL_ARCHIVE.createIntelArchive();
    const r = INTEL_ARCHIVE.recordKnownContact(arch, {
      team: 1, targetId: 42, kind: 'fleet', x: 100, y: 200, now: 9000,
      strength: 8, factionId: 7, power: 123, vx: 1.5, vy: -2.5,
    });
    assert.equal(r.factionId, 7, 'factionId 未落库（只改了 .d.ts？）');
    assert.equal(r.power, 123, 'power 未落库');
    assert.equal(r.vx, 1.5, 'vx 未落库');
    assert.equal(r.vy, -2.5, 'vy 未落库');
  });
}

// S7-03：**接线**断言 —— 落库 API 收得下 4 个字段 ≠ 调用方真的传了。
// ⚠ 分界：S7-01 证明"收得下"，S7-03 证明"传了"。
//   B+C 的核心链是"侦察报告 → 档案 → 目标解析/战力比/拦截点"，
//   报告点漏传 ⇒ 链断在中间，而 S7-01 仍会绿。
check('S7-03 所有 kind=fleet 的写入点都传了 4 字段（源码断言）', () => {
  const raw = fs.readFileSync(path.join(SRC, 'game', 'scenes', 'BattleScene.ts'), 'utf8');
  // ⚠ 必须先剥注释：否则"注释里写了 `power:`" 会让漏传的键被误判为已传
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const blocks = [...src.matchAll(/recordKnownContact\([^,]+,\s*\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  const fleetBlocks = blocks.filter((b) => b.includes("kind: 'fleet'"));
  assert.ok(fleetBlocks.length >= 3, `fleet 写入点只有 ${fleetBlocks.length} 处（预期 >=3）`);
  const NEED = ['factionId', 'power', 'vx', 'vy'];
  const bad = [];
  fleetBlocks.forEach((b, idx) => {
    const miss = NEED.filter((k) => !new RegExp(`${k}\\s*:`).test(b));
    if (miss.length) bad.push(`#${idx + 1} 缺 [${miss.join(',')}]`);
  });
  assert.deepEqual(bad, [], `有 fleet 写入点漏传字段：${bad.join(' | ')}`);
});

checkGated(F_FIELDS, 'S7-02 IntelSystem.d.ts 声明 4 个新字段', () => {
  const dts = path.join(BATTLE, 'IntelSystem.d.ts');
  assert.ok(fs.existsSync(dts), 'IntelSystem.d.ts 不存在');
  const s = fs.readFileSync(dts, 'utf8');
  for (const f of ['factionId', 'power', 'vx', 'vy']) {
    assert.ok(new RegExp(`${f}\\s*\\??:`).test(s), `IntelSystem.d.ts 缺字段 ${f}`);
  }
});

// ══════════════════════════════════════════════════════════════════════
// 汇总
// ══════════════════════════════════════════════════════════════════════
const total = pass + failures.length + pendings.length;
process.stdout.write(`\n──────── 汇总 ────────\nPASS ${pass}   FAIL ${failures.length}   PENDING ${pendings.length}   TOTAL ${total}\n`);
// ⚠ TOTAL 是隐含守恒量：每步的 TOTAL 变化必须能解释（加了 N 条 / 删了 N 条），
//   否则"某条断言被悄悄删掉"看不出来。

if (pendings.length > 0) {
  process.stdout.write('\n待实现（不计失败）：\n');
  pendings.forEach((p) => process.stdout.write(`  · ${p}\n`));
}
if (failures.length > 0) {
  process.stdout.write('\n失败项：\n');
  failures.forEach((f) => process.stdout.write(`  × ${f}\n`));
  process.exitCode = 1;
}

/** 递归列出 dir 下的 .ts/.js（跳过 node_modules / dist） */
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-verify') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|js)$/.test(name)) out.push(p);
  }
  return out;
}
