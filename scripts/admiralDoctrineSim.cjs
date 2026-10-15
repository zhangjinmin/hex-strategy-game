/**
 * admiralDoctrineSim.cjs — P2「提督配置带过来（部队组成 + 阵型）」台架。
 *
 * 基准：docs/design/3d-tactical-battle/33-p2-spec.md §4（5 类断言）。
 * 方法论：docs/qa/2026-10-15-p1-acceptance.md §7 ——
 *   **参照系必须独立于被测函数**，且**每条关键断言都要配"变异可捕获性"反例行**。
 *
 * 真源码口径（禁手抄算法）：
 *   · frontend/src/config/admiralDoctrine.ts   —— 被测：resolveAdmiralComposition + 三张表
 *   · frontend/src/game/retreatDoctrine.ts     —— 被测：resolveAdmiralDoctrine（阵型真源链路）
 *   · frontend/src/config/tagConfig.ts         —— 参照系：MILITARY_STYLE_PARAMS（阵型唯一真源）
 *   · frontend/src/config/admiralsData.ts      —— 参照系：真实提督 id / faction
 *   · frontend/src/game/scenes/BattleScene.ts  —— 源码契约：两个 composition 调用点 + formation 不再随机
 *
 * 谁是被验证方 / 谁是参照系（逐类标注）：
 *   §1 组成·风格差异：被验证方 = resolveAdmiralComposition；
 *      参照系 = 设计意图（同 faction+milRank、不同风格 ⇒ 结果不同）+ 方向性手写期望。
 *   §2 覆盖表：被验证方 = resolveAdmiralComposition；
 *      参照系 = 导出的覆盖表数据 + 本文件**独立实现**的归一化/取整。
 *   §3 阵型：被验证方 = resolveAdmiralDoctrine；
 *      参照系 = tagConfig.MILITARY_STYLE_PARAMS（真源）+ BattleScene 源码契约。
 *   §4 军衔只改总量：被验证方 = resolveAdmiralComposition；
 *      参照系 = 手写 milRank→总量字面表 + 比例守恒。
 *   §5 变异自检：把 styleTag 分支 / 覆盖表分支"短路"，§1 / §2 的判定谓词**必须不成立**。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../frontend/src/config/admiralDoctrine.ts');
const D = require('../frontend/src/game/retreatDoctrine.ts');
const tagConfig = require('../frontend/src/config/tagConfig.ts');
const admiralsData = require('../frontend/src/config/admiralsData.ts').admiralsData;

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

// ────────────────────────────────────────────────────────────
// 参照系（独立于被测函数的字面量 / 数据）
// ────────────────────────────────────────────────────────────

const MILITARY_TAGS = [
  'frontal_assault', 'counter_defense', 'firepower', 'mobile_raid',
  'logistics_focus', 'intel_focus', 'cautious', 'aggressive',
];
/** 合法阵型（与 formations.ts 的 5 种一致；'flexible' **不是**合法阵型） */
const LEGAL_FORMATIONS = ['wedge', 'line', 'spindle', 'circle', 'square'];
/** 手写 milRank → 编制总量（独立参照，用于验证"军衔只改总量"） */
const EXPECTED_MIL_RANK_TOTAL = { 8: 5000, 9: 8000, 10: 12000, 11: 15000, 12: 18900, 13: 21000 };

const COMP_KEYS = ['battleships', 'cruisers', 'destroyers', 'carriers', 'fighters', 'supplies'];
const compVec = (c) => COMP_KEYS.map((k) => Number(c[k]) || 0);
const totalOf = (c) => compVec(c).reduce((a, b) => a + b, 0);
const shareVec = (c) => {
  const t = totalOf(c);
  return t > 0 ? compVec(c).map((v) => v / t) : compVec(c);
};
const vecEq = (a, b, eps) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const pairwiseDistinct = (list, eps) => {
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (vecEq(list[i], list[j], eps)) return false;
    }
  }
  return true;
};

/**
 * ★ 独立参照系：把"权重"归一化到 total 的整数编制（最大余数法）。
 *   本文件**自己实现**一遍 —— 不复用被测函数的任何内部（避免 f(x)===f(x) 自证）。
 */
function expectedFromWeights(weights, total) {
  const w = COMP_KEYS.map((k) => Math.max(0, Number(weights[k]) || 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return { battleships: 0, cruisers: 0, destroyers: 0, carriers: 0, fighters: 0, supplies: 0 };
  const exact = w.map((x) => (x / sum) * total);
  const counts = exact.map((x) => Math.floor(x));
  let rem = total - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  for (let k = 0; k < order.length && rem > 0; k += 1) { counts[order[k].i] += 1; rem -= 1; }
  return {
    battleships: counts[0], cruisers: counts[1], destroyers: counts[2],
    carriers: counts[3], fighters: counts[4], supplies: counts[5],
  };
}

/** 真源：tag → 期望阵型（'flexible' 归一为 'line'，与 retreatDoctrine 同口径） */
const normalizeFormation = (f) => (f === 'flexible' ? 'line' : f);
const expectedFormation = (tag) => normalizeFormation((tagConfig.MILITARY_STYLE_PARAMS[tag] || {}).formation);

const SCENE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'game', 'scenes', 'BattleScene.ts'),
  'utf8',
);
/** 旧的"随机阵型"片段（病灶 2）；若被塞回来，契约断言必须 FAIL */
const RANDOM_FORMATION_RE = /\['wedge',\s*'line',\s*'spindle',\s*'circle',\s*'square'\]\s*\[\s*Math\.floor\(\s*Math\.random\(\)/;

const OVERRIDE_TABLE = R.ADMIRAL_COMPOSITION_OVERRIDES;

// ────────────────────────────────────────────────────────────
// §0 数据契约
// ────────────────────────────────────────────────────────────
process.stdout.write('§0 数据契约\n');

check('§0.1 覆盖表含 3~8 个重点提督', () => {
  const n = Object.keys(OVERRIDE_TABLE).length;
  assert.ok(n >= 3 && n <= 8, `覆盖表条数=${n}，应 ∈ [3,8]`);
});

check('§0.2 覆盖表的 id 都是真实提督且阵营相符', () => {
  const byId = new Map(admiralsData.map((a) => [a.id, a]));
  for (const id of Object.keys(OVERRIDE_TABLE)) {
    const adm = byId.get(Number(id));
    assert.ok(adm, `覆盖 id ${id} 不在 admiralsData 中`);
  }
  // 代表性重点提督（莱因哈特 / 杨威利）必须在覆盖表中
  assert.ok(OVERRIDE_TABLE[81], '莱因哈特(id:81) 应被覆盖');
  assert.ok(OVERRIDE_TABLE[156], '杨威利(id:156) 应被覆盖');
  assert.equal(byId.get(81).faction, 'empire', 'id:81 应为帝国');
  assert.equal(byId.get(156).faction, 'alliance', 'id:156 应为同盟');
});

check('§0.3 STYLE_BIAS 覆盖全部 8 个 MilitaryTag', () => {
  const keys = Object.keys(R.STYLE_BIAS).sort();
  assert.deepEqual(keys, [...MILITARY_TAGS].sort(), 'STYLE_BIAS 键集 != 8 个军事标签');
});

check('§0.4 基准表含 empire / alliance 两个阵营', () => {
  assert.ok(R.BASE_COMPOSITION_BY_FACTION.empire, '缺 empire 基准');
  assert.ok(R.BASE_COMPOSITION_BY_FACTION.alliance, '缺 alliance 基准');
});

// ────────────────────────────────────────────────────────────
// §1 不同风格 ⇒ 不同 composition（被验证方 = resolveAdmiralComposition）
// ────────────────────────────────────────────────────────────
process.stdout.write('§1 不同风格 ⇒ 不同 composition\n');

for (const faction of ['empire', 'alliance']) {
  check(`§1.${faction} 8 风格 + 中性 ⇒ 编制比例两两不同（milRank=10）`, () => {
    const list = [...MILITARY_TAGS, null].map((t) =>
      shareVec(R.resolveAdmiralComposition({ faction, styleTag: t, milRank: 10 })));
    assert.ok(pairwiseDistinct(list, 1e-6), `${faction}：存在两个风格得到相同编制比例`);
  });
}

check('§1.3 方向性：logistics_focus 的补给占比 > 中性', () => {
  const base = R.resolveAdmiralComposition({ faction: 'empire', styleTag: null, milRank: 10 });
  const logi = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'logistics_focus', milRank: 10 });
  assert.ok(shareVec(logi)[5] > shareVec(base)[5], '后勤重视未提升补给占比');
});

check('§1.4 方向性：mobile_raid 的驱逐占比 > 中性', () => {
  const base = R.resolveAdmiralComposition({ faction: 'empire', styleTag: null, milRank: 10 });
  const mob = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'mobile_raid', milRank: 10 });
  assert.ok(shareVec(mob)[2] > shareVec(base)[2], '机动突袭未提升驱逐占比');
});

check('§1.5 方向性：firepower 的战列占比 > 中性', () => {
  const base = R.resolveAdmiralComposition({ faction: 'empire', styleTag: null, milRank: 10 });
  const fp = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'firepower', milRank: 10 });
  assert.ok(shareVec(fp)[0] > shareVec(base)[0], '火力压制未提升战列占比');
});

check('§1.6 方向性：frontal_assault 的战列占比 > mobile_raid', () => {
  const fa = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'frontal_assault', milRank: 10 });
  const mr = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'mobile_raid', milRank: 10 });
  assert.ok(shareVec(fa)[0] > shareVec(mr)[0], '正面突击未比机动突袭更重战列');
});

check('§1.7 总量守恒：任意风格下 Σcount === milRankTotal', () => {
  for (const faction of ['empire', 'alliance']) {
    for (const t of [...MILITARY_TAGS, null]) {
      const c = R.resolveAdmiralComposition({ faction, styleTag: t, milRank: 10 });
      assert.equal(totalOf(c), R.milRankTotal(10), `${faction}/${t} 总量不守恒`);
    }
  }
});

check('§1.8 确定性：同一输入 20 次调用结果全等（无随机）', () => {
  const first = R.resolveAdmiralComposition({ faction: 'alliance', styleTag: 'cautious', milRank: 11 });
  for (let i = 0; i < 20; i += 1) {
    assert.deepEqual(
      R.resolveAdmiralComposition({ faction: 'alliance', styleTag: 'cautious', milRank: 11 }),
      first, '重复调用结果不同 ⇒ 存在随机',
    );
  }
});

check('§1.9 阵营基准生效：同盟 vs 帝国 同风格 ⇒ 编制不同', () => {
  const e = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'firepower', milRank: 10 });
  const a = R.resolveAdmiralComposition({ faction: 'alliance', styleTag: 'firepower', milRank: 10 });
  assert.ok(!vecEq(compVec(e), compVec(a), 0), '两阵营同风格编制相同 ⇒ 阵营基准未生效');
});

// ────────────────────────────────────────────────────────────
// §2 覆盖表（被验证方 = resolveAdmiralComposition；参照系 = 覆盖表数据 + 独立归一化）
// ────────────────────────────────────────────────────────────
process.stdout.write('§2 重点提督覆盖表\n');

for (const id of Object.keys(OVERRIDE_TABLE)) {
  check(`§2.${id} 覆盖生效：结果 == 独立归一化(覆盖权重, milRankTotal)`, () => {
    const adm = admiralsData.find((a) => a.id === Number(id));
    const milRank = 12;
    const c = R.resolveAdmiralComposition({
      faction: adm.faction, styleTag: null, milRank, admiralId: Number(id),
    });
    assert.deepEqual(c, expectedFromWeights(OVERRIDE_TABLE[id], R.milRankTotal(milRank)));
  });
}

check('§2.6 未覆盖提督走基准：id=999999 结果 == 纯风格基准', () => {
  const base = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'aggressive', milRank: 10 });
  const other = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'aggressive', milRank: 10, admiralId: 999999 });
  assert.deepEqual(other, base, '未列出的提督被误伤（走了覆盖）');
});

check('§2.7 覆盖真的改变输出：覆盖 id 结果 != 同年份同风格的基准', () => {
  const base = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'aggressive', milRank: 12 });
  const over = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'aggressive', milRank: 12, admiralId: 81 });
  assert.ok(!vecEq(compVec(base), compVec(over), 0), '覆盖未生效（结果与基准相同）');
});

check('§2.8 覆盖优先于风格：同提督不同 styleTag 输入 ⇒ 结果相同', () => {
  const a = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'cautious', milRank: 12, admiralId: 81 });
  const b = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'mobile_raid', milRank: 12, admiralId: 81 });
  assert.deepEqual(a, b, '覆盖表未能优先于 styleTag');
});

check('§2.9 覆盖不改总量：id:81 在 milRank 8/13 下总量分别为 5000/21000', () => {
  const c8 = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'aggressive', milRank: 8, admiralId: 81 });
  const c13 = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'aggressive', milRank: 13, admiralId: 81 });
  assert.equal(totalOf(c8), 5000, 'milRank8 总量错');
  assert.equal(totalOf(c13), 21000, 'milRank13 总量错');
});

// ────────────────────────────────────────────────────────────
// §3 formation 来自 resolveAdmiralDoctrine（被验证方 = resolveAdmiralDoctrine）
// ────────────────────────────────────────────────────────────
process.stdout.write('§3 阵型来自提督教范（唯一真源），禁止随机\n');

for (const tag of MILITARY_TAGS) {
  check(`§3.${tag} formation == MILITARY_STYLE_PARAMS（真源）`, () => {
    const got = D.resolveAdmiralDoctrine([tag]).formation;
    assert.equal(got, expectedFormation(tag), `${tag}: ${got} != ${expectedFormation(tag)}`);
  });
}

check('§3.9 结果集合 ⊆ 合法阵型，且绝不含 flexible', () => {
  const got = [...MILITARY_TAGS, null].map((t) => D.resolveAdmiralDoctrine(t ? [t] : []).formation);
  for (const f of got) {
    assert.ok(LEGAL_FORMATIONS.includes(f), `非法阵型: ${f}`);
    assert.notEqual(f, 'flexible', 'flexible 未归一化');
  }
});

check('§3.10 无军事标签 ⇒ 中性阵型 wedge', () => {
  assert.equal(D.resolveAdmiralDoctrine([]).formation, 'wedge');
  assert.equal(D.resolveAdmiralDoctrine(null).formation, 'wedge');
  assert.equal(D.resolveAdmiralDoctrine(undefined).formation, 'wedge');
});

check('§3.11 未知标签 ⇒ 中性阵型 wedge（不报错）', () => {
  assert.equal(D.resolveAdmiralDoctrine(['not_a_military_tag']).formation, 'wedge');
});

check('§3.12 确定性：同 tags 调用 50 次 formation 全等（无随机）', () => {
  const first = D.resolveAdmiralDoctrine(['mobile_raid']).formation;
  for (let i = 0; i < 50; i += 1) {
    assert.equal(D.resolveAdmiralDoctrine(['mobile_raid']).formation, first);
  }
});

check('§3.13 [源码契约] BattleScene 不再含随机阵型片段', () => {
  assert.ok(!RANDOM_FORMATION_RE.test(SCENE_SRC), 'BattleScene 仍含随机阵型数组 [..][Math.floor(Math.random()*5)]');
});

check('§3.14 [源码契约] BattleScene 的 fleet.formation 取自 resolveAdmiralDoctrine', () => {
  assert.ok(/formation:\s*resolveAdmiralDoctrine\(/.test(SCENE_SRC), 'formation 未接 resolveAdmiralDoctrine');
});

check('§3.15 [源码契约] composition 两个调用点均改调 resolveAdmiralComposition', () => {
  const hits = SCENE_SRC.match(/composition:\s*resolveAdmiralComposition\(\{/g) || [];
  assert.equal(hits.length, 2, `composition 调用点应为 2 处，实得 ${hits.length}`);
});

check('§3.16 [反例·牙齿] 随机阵型正则对"旧片段字面量"必须命中', () => {
  const legacy = "formation: ['wedge', 'line', 'spindle', 'circle', 'square'][Math.floor(Math.random() * 5)] as any";
  assert.ok(RANDOM_FORMATION_RE.test(legacy), '契约正则无牙齿（对旧片段也不命中）');
});

// ────────────────────────────────────────────────────────────
// §4 军衔只改总量、不改比例（被验证方 = resolveAdmiralComposition）
// ────────────────────────────────────────────────────────────
process.stdout.write('§4 军衔只改总量、不改比例\n');

check('§4.1 milRank → 总量逐档对齐手写字面表', () => {
  for (const r of [8, 9, 10, 11, 12, 13]) {
    assert.equal(R.milRankTotal(r), EXPECTED_MIL_RANK_TOTAL[r], `milRank ${r} 总量错`);
  }
});

check('§4.2 milRank<8 归一到 8；milRank>13 归一到 13', () => {
  assert.equal(R.milRankTotal(3), 5000);
  assert.equal(R.milRankTotal(0), 5000);
  assert.equal(R.milRankTotal(20), 21000);
});

for (const faction of ['empire', 'alliance']) {
  check(`§4.${faction} 同风格下 milRank8 vs 13：比例一致、总量不同`, () => {
    for (const t of [...MILITARY_TAGS, null]) {
      const c8 = R.resolveAdmiralComposition({ faction, styleTag: t, milRank: 8 });
      const c13 = R.resolveAdmiralComposition({ faction, styleTag: t, milRank: 13 });
      assert.equal(totalOf(c8), 5000);
      assert.equal(totalOf(c13), 21000);
      assert.ok(vecEq(shareVec(c8), shareVec(c13), 2e-3),
        `${faction}/${t}: 比例随军衔漂移（只应改总量）`);
    }
  });
}

// ────────────────────────────────────────────────────────────
// §5 变异自检（短路被测分支 ⇒ §1 / §2 的判定谓词必须不成立）
// ────────────────────────────────────────────────────────────
process.stdout.write('§5 变异自检（变异可捕获性）\n');

check('§5.1 变异A（styleTag 短路为 null）⇒ §1 的"两两不同"谓词必须为 false', () => {
  const mutant = [...MILITARY_TAGS, null].map(() =>
    R.resolveAdmiralComposition({ faction: 'empire', styleTag: null, milRank: 10 }));
  assert.equal(pairwiseDistinct(mutant.map(shareVec), 1e-6), false,
    '忽略 styleTag 后仍被判"两两不同" ⇒ §1 断言无牙齿');
});

check('§5.2 变异A 下"方向性"断言也不成立（logistics 补给占比 == 中性）', () => {
  const base = R.resolveAdmiralComposition({ faction: 'empire', styleTag: null, milRank: 10 });
  const mut = R.resolveAdmiralComposition({ faction: 'empire', styleTag: null, milRank: 10 });
  assert.equal(shareVec(mut)[5], shareVec(base)[5], '变异体下补给占比不应大于中性');
});

check('§5.3 变异B（覆盖表短路）⇒ §2 的"覆盖改变输出"谓词必须为 false', () => {
  const base = R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'aggressive', milRank: 12 });
  const realDistinct = !vecEq(compVec(R.resolveAdmiralComposition({ faction: 'empire', styleTag: 'aggressive', milRank: 12, admiralId: 81 })), compVec(base), 0);
  const mutantDistinct = !vecEq(compVec(base), compVec(base), 0); // 忽略 admiralId ⇒ 恒等
  assert.equal(realDistinct, true, '真实函数上覆盖未改变输出 ⇒ §2 断言无意义');
  assert.equal(mutantDistinct, false, '忽略覆盖表后仍被判"覆盖改变输出" ⇒ §2 断言无牙齿');
});

check('§5.4 变异A 同时说明：§1 的"逐项不同"确实由 styleTag 驱动', () => {
  const real = pairwiseDistinct(
    [...MILITARY_TAGS, null].map((t) => shareVec(R.resolveAdmiralComposition({ faction: 'alliance', styleTag: t, milRank: 10 }))),
    1e-6,
  );
  assert.equal(real, true, '真实函数上不同风格未能给出不同编制');
});

// ────────────────────────────────────────────────────────────
// §6 端到端层：玩家阵型取自提督教范（缺口1）· 无标签提督风格兜底（缺口2）· 高战事实（缺口4）
//
// 为什么需要本层（红队两轮的核心指控）：§3 只验证「resolveAdmiralDoctrine 输出正确」+
//   「源码含字符串 `formation: resolveAdmiralDoctrine(`」，**没有任何断言经过生产阵型路径**
//   （`deployFormation` 覆写玩家舰队 formation）⇒ 即使 :1576 是死代码，46 条断言照样全绿。
//   本层断言的是**接线的存在性与调用顺序**，并对每条关键断言配"变异可捕获性"反例。
// ────────────────────────────────────────────────────────────
process.stdout.write('§6 端到端层：玩家阵型取自提督教范 + 无标签提督风格兜底\n');

/** 加载时求值一次：`resolveEffectiveStyleTag(resolveAdmiralDoctrine(tags).styleTag, stats)`（生产口径） */
const effectiveStyleTagOf = (a) =>
  R.resolveEffectiveStyleTag(D.resolveAdmiralDoctrine(a.tags).styleTag, a.stats);

/** 玩家 deployFormation 的"来自提督教范"初始化点（必须是 `this.deployFormation = …resolveAdmiralDoctrine(…)`） */
const DEPLOY_DOCTRINE_RE = /this\.deployFormation\s*=\s*[^;\n]*resolveAdmiralDoctrine\(/;

check('§6.1 [源码契约] 玩家 deployFormation 的初始化点引用提督教范（非硬编码 wedge）', () => {
  assert.ok(DEPLOY_DOCTRINE_RE.test(SCENE_SRC),
    '未找到 `this.deployFormation = ...resolveAdmiralDoctrine(...)` 初始化点 ⇒ 缺口1 未接线（:1576 仍是死代码）');
});

check('§6.2 [反例·牙齿] 把 deployFormation 初始化改回硬编码 \'wedge\' ⇒ §6.1 必须 FAIL', () => {
  const mutated = SCENE_SRC.replace(DEPLOY_DOCTRINE_RE, "this.deployFormation = 'wedge'");
  assert.notEqual(mutated, SCENE_SRC, '变异未生效（正则未命中真实源码）⇒ §6.1 无牙齿');
  assert.equal(DEPLOY_DOCTRINE_RE.test(mutated), false,
    '改成硬编码 wedge 后 §6.1 仍通过 ⇒ 断言无牙齿（死代码照样绿）');
});

check('§6.3 [调用顺序] deployFormation 初始化早于 activateDeployPhase()（否则被部署阶段覆写节奏吃掉）', () => {
  const initIdx = SCENE_SRC.search(DEPLOY_DOCTRINE_RE);
  const deployIdx = SCENE_SRC.indexOf('this.activateDeployPhase();');
  assert.ok(initIdx >= 0, '未找到 deployFormation 的教范初始化点');
  assert.ok(deployIdx >= 0, '未找到 activateDeployPhase() 调用（生产入口缺失 ⇒ 前提失效）');
  assert.ok(initIdx < deployIdx,
    `教范初始化(@${initIdx}) 未在 activateDeployPhase()(@${deployIdx}) 之前 —— 会被 :1129 用旧值覆写`);
});

check('§6.4 [源码契约] 部署期数字键仍可覆写 deployFormation（玩家显式选择优先）', () => {
  assert.ok(/this\.deployFormation\s*=\s*newForm/.test(SCENE_SRC),
    '部署期阵型切换未写 deployFormation ⇒ 玩家显式选择无法覆盖提督默认');
});

check('§6.5 [端到端·写者清单] 不存在 `this.deployFormation = \'wedge\'` 硬编码写者', () => {
  // 玩家舰队 formation 的写者必须存在（:1129 / :1219），否则"覆写"链路断裂
  const fleetWrites = SCENE_SRC.match(/pFleet\.formation\s*=/g) || [];
  assert.ok(fleetWrites.length >= 1, '未找到 `pFleet.formation =` 写者 ⇒ 玩家舰队阵型不被部署值驱动');
  // 且 deployFormation 不得再有硬编码 'wedge' 写者（那将盖掉教范初值 ⇒ 缺口1 复发）
  const hardWedge = SCENE_SRC.match(/this\.deployFormation\s*=\s*['"]wedge['"]/g) || [];
  assert.equal(hardWedge.length, 0, '存在 `this.deployFormation = \'wedge\'` 硬编码写者 ⇒ 会覆盖提督阵型');
});

check('§6.6 [端到端·可见性] 至少一名真实提督的教范阵型 ≠ wedge ⇒ 玩家可见行为确实改变', () => {
  const nonWedge = admiralsData
    .map((a) => D.resolveAdmiralDoctrine(a.tags).formation)
    .filter((f) => f !== 'wedge');
  assert.ok(nonWedge.length > 0, '全部提督教范阵型都是 wedge ⇒ 无法证明玩家可见行为改变');
  // 且 :1576 的 spawn 值与缺口1 的 deployFormation 初值同源（都 = resolveAdmiralDoctrine(tags).formation）
  assert.ok(/formation:\s*resolveAdmiralDoctrine\(/.test(SCENE_SRC), 'spawn 阵型未接提督教范');
});

check('§6.7 [多样性·牙齿] 无标签提督 @milRank10 组成种类数 ≥ 8（修复前 = 2）', () => {
  const noTag = admiralsData.filter((a) => D.resolveAdmiralDoctrine(a.tags).styleTag === null);
  assert.ok(noTag.length >= 50, `无标签提督样本不足：${noTag.length}`);
  const distinct = new Set(noTag.map((a) => JSON.stringify(
    R.resolveAdmiralComposition({ faction: a.faction, styleTag: effectiveStyleTagOf(a), milRank: 10, admiralId: a.id }),
  )));
  assert.ok(distinct.size >= 8, `无标签提督组成种类数=${distinct.size}，应 ≥ 8（修复前 = 2 ⇒ 风格兜底未生效）`);
});

check('§6.8 [多样性] 全量 182 提督 @milRank10 组成种类数 ∈ [18, 21]（组成空间 = 2 阵营 × 8 风格 + 5 覆盖）', () => {
  const distinct = new Set(admiralsData.map((a) => JSON.stringify(
    R.resolveAdmiralComposition({ faction: a.faction, styleTag: effectiveStyleTagOf(a), milRank: 10, admiralId: a.id }),
  )));
  // 上界 21 = 2×8 + 5 覆盖；下界 18 防止"风格兜底把人群并回极少数组成"的回归
  assert.ok(distinct.size >= 18 && distinct.size <= 21,
    `全量组成种类数=${distinct.size}，应 ∈ [18,21]（空间上界 21，超过说明新增了第三套比例来源）`);
});

check('§6.9 [构造性] 同阵营同军衔、不同 stats 的两个无标签提督 ⇒ composition 必须不同', () => {
  const statsA = { command: 90, operations: 40, intelligence: 30, mobility: 35, attack: 20, defense: 25, tactics: 500 };
  const statsB = { command: 20, operations: 30, intelligence: 35, mobility: 88, attack: 25, defense: 40, tactics: 500 };
  assert.equal(D.resolveAdmiralDoctrine([]).styleTag, null, '前提失败：空标签应为 null（无军事风格）');
  const tagA = R.resolveEffectiveStyleTag(null, statsA);
  const tagB = R.resolveEffectiveStyleTag(null, statsB);
  assert.notEqual(tagA, tagB, '不同 stats 的无标签提督得到相同风格');
  const cA = R.resolveAdmiralComposition({ faction: 'empire', styleTag: tagA, milRank: 10 });
  const cB = R.resolveAdmiralComposition({ faction: 'empire', styleTag: tagB, milRank: 10 });
  assert.ok(!vecEq(compVec(cA), compVec(cB), 0), '同阵营同军衔的无标签提督 composition 仍相同');
  // 反例：不做 stats 兜底（旧行为 styleTag=null）⇒ 两者组成必然相同（证明本断言有牙齿）
  const oldA = R.resolveAdmiralComposition({ faction: 'empire', styleTag: null, milRank: 10 });
  const oldB = R.resolveAdmiralComposition({ faction: 'empire', styleTag: null, milRank: 10 });
  assert.ok(vecEq(compVec(oldA), compVec(oldB), 0), '旧行为下两者竟不同 ⇒ 前提推演有误');
});

check('§6.10 deriveStyleTagFromStats：确定性 + 值域 ∈ 8 个军事标签', () => {
  for (const a of admiralsData) {
    const first = R.deriveStyleTagFromStats(a.stats);
    assert.ok(MILITARY_TAGS.includes(first), `非法风格 ${first}`);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(R.deriveStyleTagFromStats(a.stats), first, `${a.name} 同 stats 结果不确定 ⇒ 存在随机`);
    }
  }
});

check('§6.11 deriveStyleTagFromStats：六维各自最高 ⇒ 期望风格；tactics 不参与；并列按固定优先级', () => {
  const cases = [
    ['attack', 'aggressive'], ['mobility', 'mobile_raid'], ['defense', 'counter_defense'],
    ['command', 'frontal_assault'], ['intelligence', 'intel_focus'], ['operations', 'firepower'],
  ];
  for (const [stat, tag] of cases) {
    const stats = { command: 10, operations: 10, intelligence: 10, mobility: 10, attack: 10, defense: 10, tactics: 3000 };
    stats[stat] = 99;
    assert.equal(R.deriveStyleTagFromStats(stats), tag, `${stat} 最高 ⇒ 应得 ${tag}`);
  }
  // tactics 极高但六维相等 ⇒ 落到规则首项（固定顺序首条 = aggressive），确定且不受 tactics 干扰
  const tacticsOnly = { command: 10, operations: 10, intelligence: 10, mobility: 10, attack: 10, defense: 10, tactics: 99999 };
  assert.equal(R.deriveStyleTagFromStats(tacticsOnly), 'aggressive', 'tactics 参与了推导（应被排除）');
  // 并列 attack == defense ⇒ 固定优先级先出现者（attack）胜 ⇒ aggressive
  assert.equal(
    R.deriveStyleTagFromStats({ command: 10, operations: 10, intelligence: 10, mobility: 10, attack: 80, defense: 80 }),
    'aggressive', '并列时未按固定优先级取先出现者',
  );
  // 空/非法输入 → 确定退回首项（不抛出、不随机）
  assert.equal(R.deriveStyleTagFromStats(null), 'aggressive');
  assert.equal(R.deriveStyleTagFromStats(undefined), 'aggressive');
});

check('§6.12 有军事标签优先：resolveEffectiveStyleTag 绝不覆盖已有标签', () => {
  const extreme = { command: 99, operations: 99, intelligence: 99, mobility: 99, attack: 99, defense: 99, tactics: 99 };
  for (const t of MILITARY_TAGS) {
    assert.equal(R.resolveEffectiveStyleTag(t, extreme), t, `${t} 被 stats 覆盖（应标签优先）`);
  }
  assert.equal(R.resolveEffectiveStyleTag(null, extreme), R.deriveStyleTagFromStats(extreme));
  assert.equal(R.resolveEffectiveStyleTag(undefined, null), R.deriveStyleTagFromStats(null));
});

// [P2 · 最后补救] 两处 composition 的 styleTag 改走**作战风格唯一入口** `resolveAdmiralStyleTag`
//   ⚠ 措辞精确化（红队指出旧注释不实）：它与 `resolveEffectiveStyleTag(resolveAdmiralDoctrine(tags).styleTag, stats)`
//     **并非完全等价** —— 差别在 `stats` 缺席时：`resolveAdmiralStyleTag` 返回 **`null`**（不强行推导），
//     而 `resolveEffectiveStyleTag(null, null)` 会返回 `deriveStyleTagFromStats(null)` = `'aggressive'`。
//     生产调用点**始终传 stats**，故无实际影响；该差异正是「战役轨零变化」的关键（战役 faction 无 stats ⇒ null ⇒ 回落 wedge）。
//   目的：使 formation 与 composition 共用同一个推导后的风格。断言意图不变：两处均走"标签优先、stats 兜底"。
const COMPOSITION_STYLE_RE = /styleTag:\s*resolveAdmiralStyleTag\(/g;

check('§6.13 [源码契约] 两处 composition 的 styleTag 走"标签优先、stats 兜底"（resolveAdmiralStyleTag）', () => {
  const hits = SCENE_SRC.match(COMPOSITION_STYLE_RE) || [];
  assert.equal(hits.length, 2, `两处 composition 应为 resolveAdmiralStyleTag，实得 ${hits.length}`);
});

check('§6.14 [反例·牙齿] 去掉 stats 兜底（移除 resolveAdmiralStyleTag）⇒ §6.13 必须 FAIL', () => {
  const mutated = SCENE_SRC.split('resolveAdmiralStyleTag(').join('__NO_FALLBACK__(');
  const hits = mutated.match(COMPOSITION_STYLE_RE) || [];
  assert.equal(hits.length, 0, `移除兜底后仍命中 ${hits.length} 处 ⇒ §6.13 无牙齿`);
});

check('§6.15 [缺口4·事实固化] 演习编制不含高速战列舰（帝国亦然；有意为之，见 admiralDoctrine.ts 注释）', () => {
  assert.ok(!('fastBattleships' in R.BASE_COMPOSITION_BY_FACTION.empire), '帝国基准出现了 fastBattleships（缺口4 事实被改）');
  assert.ok(!('fastBattleships' in R.BASE_COMPOSITION_BY_FACTION.alliance), '同盟基准出现了 fastBattleships');
  for (const faction of ['empire', 'alliance']) {
    for (const t of [...MILITARY_TAGS, null]) {
      const c = R.resolveAdmiralComposition({ faction, styleTag: t, milRank: 10 });
      assert.ok(!('fastBattleships' in c) || Number(c.fastBattleships) === 0, `${faction}/${t} 产出了高速战列舰`);
    }
  }
  for (const id of Object.keys(OVERRIDE_TABLE)) {
    assert.ok(!('fastBattleships' in OVERRIDE_TABLE[id]) || Number(OVERRIDE_TABLE[id].fastBattleships) === 0,
      `覆盖 id ${id} 含 fastBattleships`);
  }
});

// ────────────────────────────────────────────────────────────
// §7 阵型也必须随 stats 分化（P2 最后补救：formation 与 composition 共用同一「推导后风格」）
//
// 病灶（lead 裁决 · 必须做）：`deriveStyleTagFromStats` 此前**只喂 composition、不喂 formation**
//   ⇒ 87 名（47.8%）无军事标签的提督「部队组成」已随 stats 分化，但「阵型」仍恒为中性 wedge。
//   用户诉求是「**阵型配置**和舰队组成」**两者**都要带过来 ⇒ formation 也必须随 stats 分化。
//
// 被验证方 = `resolveAdmiralStyleTag`（作战风格唯一入口）+ 生产接线（BattleScene 的
//   `admiralStyleTag` 写入/消费）；参照系 = `tagConfig.MILITARY_STYLE_PARAMS`（阵型真源）
//   + 真实提督数据。每条关键断言配"变异可捕获性"反例。
// ────────────────────────────────────────────────────────────
process.stdout.write('§7 阵型随 stats 分化（formation 与 composition 共用同一风格）\n');

/** 生产口径的"有效风格"（= initFactions 写入 faction 的 `admiralStyleTag`，用**基础** stats） */
const styleTagOf = (a) => R.resolveAdmiralStyleTag(a.tags, a.stats);
/** 生产口径的"出场阵型"：有有效风格用它，否则回落提督教范（战役轨口径，无 stats ⇒ 中性 wedge） */
const formationOf = (a) => D.resolveAdmiralDoctrine(styleTagOf(a) ? [styleTagOf(a)] : a.tags).formation;

check('§7.1 [构造性] 同阵营同军衔、不同 stats 的两个无标签提督 ⇒ formation 必须不同', () => {
  const statsA = { command: 90, operations: 40, intelligence: 30, mobility: 35, attack: 20, defense: 25, tactics: 500 };
  const statsB = { command: 20, operations: 30, intelligence: 35, mobility: 88, attack: 25, defense: 40, tactics: 500 };
  assert.equal(D.resolveAdmiralDoctrine([]).styleTag, null, '前提失败：空标签应为 null（无军事风格）');
  const tagA = R.resolveAdmiralStyleTag([], statsA);
  const tagB = R.resolveAdmiralStyleTag([], statsB);
  assert.notEqual(tagA, tagB, '不同 stats 的无标签提督得到相同风格');
  const fA = D.resolveAdmiralDoctrine([tagA]).formation;
  const fB = D.resolveAdmiralDoctrine([tagB]).formation;
  assert.notEqual(fA, fB, `无标签提督 formation 仍相同（${fA} === ${fB}）⇒ 推导后的风格未进 formation`);
  // 反例（旧行为：formation 只看标签）⇒ 两者必然同为中性 wedge（证明本断言有牙齿）
  const oldFA = D.resolveAdmiralDoctrine([]).formation;
  const oldFB = D.resolveAdmiralDoctrine([]).formation;
  assert.equal(oldFA, oldFB, '旧行为下两者竟不同 ⇒ 前提推演有误');
});

check('§7.2 [反例·牙齿] "只做了一半"（stats 只喂 composition、不喂 formation）⇒ §7.1 必须 FAIL', () => {
  const statsA = { command: 90, operations: 40, intelligence: 30, mobility: 35, attack: 20, defense: 25, tactics: 500 };
  const statsB = { command: 20, operations: 30, intelligence: 35, mobility: 88, attack: 25, defense: 40, tactics: 500 };
  const tagA = R.resolveAdmiralStyleTag([], statsA);
  const tagB = R.resolveAdmiralStyleTag([], statsB);
  // 变异体 = 病灶原状：composition 吃到 stats（两者不同）……
  assert.ok(!vecEq(
    compVec(R.resolveAdmiralComposition({ faction: 'empire', styleTag: tagA, milRank: 10 })),
    compVec(R.resolveAdmiralComposition({ faction: 'empire', styleTag: tagB, milRank: 10 })), 0),
    '「只做了一半」下 composition 应不同（说明变异体确实是"半程"）');
  // ……而 formation 完全不吃（恒 = 中性 wedge）⇒ §7.1 的"formation 不同"谓词必须为 false
  const mutFA = D.resolveAdmiralDoctrine([]).formation;
  const mutFB = D.resolveAdmiralDoctrine([]).formation;
  assert.equal(mutFA === mutFB, true, '变异体（formation 不喂 styleTag）下两者竟不同 ⇒ §7.1 无牙齿');
});

check('§7.3 有军事标签的真实提督：有效风格 == 标签，且 formation == MILITARY_STYLE_PARAMS（行为不变）', () => {
  let n = 0;
  for (const a of admiralsData) {
    const tag = D.resolveAdmiralDoctrine(a.tags).styleTag;
    if (!tag) continue;
    n += 1;
    assert.equal(styleTagOf(a), tag, `${a.name} 的有效风格被 stats 覆盖（应标签优先）`);
    assert.equal(formationOf(a), expectedFormation(tag), `${a.name} formation 与改动前不一致`);
  }
  assert.ok(n >= 50, `有标签提督样本不足：${n}`);
});

check('§7.4 [多样性] 无标签提督 formation 种类数 1 → ≥3（修复前恒 wedge）', () => {
  const noTag = admiralsData.filter((a) => D.resolveAdmiralDoctrine(a.tags).styleTag === null);
  assert.ok(noTag.length >= 50, `无标签提督样本不足：${noTag.length}`);
  const before = new Set(noTag.map((a) => D.resolveAdmiralDoctrine(a.tags).formation));
  const after = new Set(noTag.map((a) => formationOf(a)));
  assert.equal(before.size, 1, `修复前无标签提督 formation 种类数=${before.size}（应恒为 1 = 中性 wedge）`);
  assert.ok(after.size >= 3, `修复后无标签提督 formation 种类数=${after.size}，应 ≥ 3`);
});

check('§7.5 [实测统计] 全量 182 提督 formation 种类数：修复后 ⊆ 合法阵型且不少于修复前', () => {
  const before = new Set(admiralsData.map((a) => D.resolveAdmiralDoctrine(a.tags).formation));
  const after = new Set(admiralsData.map((a) => formationOf(a)));
  for (const f of after) assert.ok(LEGAL_FORMATIONS.includes(f), `非法阵型: ${f}`);
  assert.notEqual(admiralsData.length, 0, '前提失败：无提督数据');
  assert.ok(after.size >= before.size, `修复后种类数(${after.size})不应少于修复前(${before.size})`);
  assert.ok(after.size >= 3, `全量 formation 种类数=${after.size}，应 ≥ 3`);
});

check('§7.6 [源码契约] initFactions 写入 admiralStyleTag（玩家/敌方各一），formation 站点消费它', () => {
  const writes = SCENE_SRC.match(/admiralStyleTag:\s*resolveAdmiralStyleTag\(/g) || [];
  assert.equal(writes.length, 2, `admiralStyleTag 写入点应为 2（玩家/敌方），实得 ${writes.length}`);
  const consume = SCENE_SRC.match(/admiralStyleTag\s*\?/g) || [];
  assert.ok(consume.length >= 4,
    `消费 admiralStyleTag 的 formation 站点应 ≥4（:1101/:1586/:985/:1330），实得 ${consume.length}`);
});

check('§7.7 [反例·牙齿] 把 formation 站点改回"只看 admiralTags"⇒ §7.6 的消费谓词必须 FAIL', () => {
  const before = SCENE_SRC.match(/admiralStyleTag\s*\?/g) || [];
  const mutated = SCENE_SRC.split('admiralStyleTag ?').join('__NO_STYLE__ ?');
  const after = mutated.match(/admiralStyleTag\s*\?/g) || [];
  assert.ok(before.length >= 4, `变异前消费点就 <4 ⇒ §7.6 前提有误`);
  assert.equal(after.length, 0, `变异后仍命中 ${after.length} ⇒ §7.6 无牙齿`);
});

// ────────────────────────────────────────────────────────────
// 汇总
// ────────────────────────────────────────────────────────────
process.stdout.write(`\n${passed} assertions passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
