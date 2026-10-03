/**
 * Source-level regression harness for ship-level target selection (P1).
 * clusterAI.pickShip / scoreShipTarget + fireCoordinator.buildFocusTable.
 *
 * 台架铁律：require 真源码 .ts（不手抄常量/公式）；断言打行为（单调性/收敛率），
 * 不以"源码不含某字符串"替代行为判据（源码契约仅作补充）。
 */
// [v64] Node ESM 解析链不做扩展名推断：fireCoordinator.ts 内 `import './clusterAI'`
//   （vite/vue-tsc 标准写法）在 require() 激活 ESM 图时会 ERR_MODULE_NOT_FOUND。
//   此处挂同步解析钩子，对无扩展名的相对导入补 '.ts' 重试——只影响本台架进程。
const Module = require('node:module');
if (typeof Module.registerHooks === 'function') {
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        if (specifier.startsWith('.') && !/\.(ts|js|mjs|cjs|json)$/i.test(specifier)) {
          return nextResolve(specifier + '.ts', context);
        }
        throw err;
      }
    },
  });
}
const A = require('../frontend/src/game/clusterAI.ts');
const F = require('../frontend/src/game/fireCoordinator.ts');
const fs = require('node:fs');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++;
  else failed++;
}

/** 基准候选（atk50/2s ⇒ dps25，射程中部 440px，满血，不在集火表） */
const base = (over = {}) => ({
  id: 'x', hpPct: 1, dist: 440, dps: 25, focusRank: -1, attacker: false, ...over,
});

console.log('\n=== A. scoreShipTarget 评分单调性 ===');
{
  const s = (o) => A.scoreShipTarget(base(o));
  check('残血优先：hpPct 越低评分越高',
    s({ hpPct: 0.1 }) > s({ hpPct: 0.5 }) && s({ hpPct: 0.5 }) > s({ hpPct: 1 }),
    `${s({ hpPct: 0.1 }).toFixed(1)} > ${s({ hpPct: 0.5 }).toFixed(1)} > ${s({ hpPct: 1 }).toFixed(1)}`);
  check('威胁压制：dps 越高评分越高',
    s({ dps: 60 }) > s({ dps: 25 }) && s({ dps: 25 }) > s({ dps: 5 }),
    `${s({ dps: 60 }).toFixed(1)} > ${s({ dps: 25 }).toFixed(1)} > ${s({ dps: 5 }).toFixed(1)}`);
  check('就近优先：距离越近评分越高',
    s({ dist: 100 }) > s({ dist: 440 }) && s({ dist: 440 }) > s({ dist: 880 }),
    `${s({ dist: 100 }).toFixed(1)} > ${s({ dist: 440 }).toFixed(1)} > ${s({ dist: 880 }).toFixed(1)}`);
  check('集火表加权：rank 0>1>2 且均高于表外',
    s({ focusRank: 0 }) > s({ focusRank: 1 }) && s({ focusRank: 1 }) > s({ focusRank: 2 })
      && s({ focusRank: 2 }) > s({ focusRank: -1 }),
    `r0=${s({ focusRank: 0 }).toFixed(1)} r1=${s({ focusRank: 1 }).toFixed(1)} r2=${s({ focusRank: 2 }).toFixed(1)}`);
  check('rank 越界（3）不发加权', s({ focusRank: 3 }) === s({ focusRank: -1 }));
  check('复仇加权：attacker 高于同型非攻击者', s({ attacker: true }) > s({ attacker: false }));
  check('集火共识可压过补刀：rank0 满血 > 表外残血 10%',
    s({ focusRank: 0, hpPct: 1 }) > s({ focusRank: -1, hpPct: 0.1 }),
    `${s({ focusRank: 0, hpPct: 1 }).toFixed(1)} vs ${s({ focusRank: -1, hpPct: 0.1 }).toFixed(1)}`);
  check('补刀可压过集火第三顺位：表外 30% 血 > rank2 满血',
    s({ focusRank: -1, hpPct: 0.3 }) > s({ focusRank: 2, hpPct: 1 }),
    `${s({ focusRank: -1, hpPct: 0.3 }).toFixed(1)} vs ${s({ focusRank: 2, hpPct: 1 }).toFixed(1)}`);
}

console.log('\n=== B. pickShip 滞回与粘性 ===');
{
  const candA = base({ id: 'a', hpPct: 0.5 });
  const candB = base({ id: 'b', hpPct: 0.45 });   // 略优于 a，差距 < 12%
  const candC = base({ id: 'c', hpPct: 0.0 });    // 显著优于 a
  const p1 = A.pickShip([candA, candB], 'a');
  check('旧目标未落后 12% 以上则沿用（防帧间交替）', p1.target.id === 'a' && p1.keptPrev === true, p1.reason);
  const p2 = A.pickShip([candA, candC], 'a');
  check('新目标显著更优则切换', p2.target.id === 'c' && p2.keptPrev === false, p2.reason);
  const p3 = A.pickShip([candB, candC], 'gone');
  check('旧目标死亡/出界（不在候选）⇒ 直接换评分最高', p3.target.id === 'c' && p3.keptPrev === false);
  const p4 = A.pickShip([], 'a');
  check('无候选返回 null', p4.target === null);
  const p5 = A.pickShip([candA], undefined);
  check('无旧目标取评分最高', p5.target.id === 'a' && p5.keptPrev === false);
  const p6 = A.pickShip([candA, candB], 'b');
  check('粘性对称：以 b 为旧目标同样留住 b', p6.target.id === 'b' && p6.keptPrev === true);
}

console.log('\n=== C. buildFocusTable 集火表（共享黑板） ===');
{
  const mk = (id, over) => base({ id, ...over });
  const table = F.buildFocusTable([
    mk('弱满血', { hpPct: 1, dps: 5 }),
    mk('残血', { hpPct: 0.1, dps: 25 }),
    mk('高战', { hpPct: 1, dps: 60 }),
    mk('中危', { hpPct: 0.6, dps: 25 }),
  ]);
  check('表深 ≤ FOCUS_TABLE_SIZE', table.length === F.FOCUS_TABLE_SIZE, `len=${table.length}`);
  check('rank 连续且从 0 起', table.every((e, i) => e.rank === i));
  check('首目标 = 高威胁或残血（评分最高者）', table[0].id === '高战' || table[0].id === '残血', table.map((e) => e.id).join(','));
  check('评分单调：rank 越靠前 score 越高',
    table.every((e, i) => i === 0 || table[i - 1].score >= e.score));
  check('距离不参与表内排序（传 dist=0 口径）',
    F.buildFocusTable([mk('远', { dist: 880 }), mk('近', { dist: 100 })])[0].score
      === F.buildFocusTable([mk('远', { dist: 0 }), mk('近', { dist: 0 })])[0].score);
  check('空输入返回空表', F.buildFocusTable([]).length === 0);
  check('k=1 截断', F.buildFocusTable([mk('1'), mk('2'), mk('3')], 1).length === 1);
}

console.log('\n=== D. 集火收敛模拟（3 舰打同一目标命中率 > 70%） ===');
{
  // 三名射手距离偏好不同（各"想打"最近的残血），但集火表应把共识目标强加回来。
  const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let rounds = 0, converged = 0;
  let noFocusRounds = 0, noFocusConverged = 0;
  for (let scen = 0; scen < 300; scen++) {
    const r = rng(scen * 7919 + 1);
    const enemy = [];
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      enemy.push({ id: `E${i}`, hpPct: 0.3 + r() * 0.7, dps: 10 + r() * 50 });
    }
    // 舰队集火表（与 BattleScene 同口径：构造候选 → buildFocusTable）
    const table = F.buildFocusTable(enemy.map((e) => ({ ...e, dist: 0, focusRank: -1 })));
    const picks = [];
    const picksNoFocus = [];
    for (let s = 0; s < 3; s++) {
      // 每名射手对各敌舰距离不同（±扰动）⇒ 无集火时个人偏好分歧
      const cands = enemy.map((e) => ({
        ...e,
        dist: 100 + r() * 700,
        focusRank: (() => { const t = table.find((x) => x.id === e.id); return t ? t.rank : -1; })(),
        attacker: false,
      }));
      picks.push(A.pickShip(cands, null).target.id);
      picksNoFocus.push(A.pickShip(cands.map((c) => ({ ...c, focusRank: -1 })), null).target.id);
    }
    rounds++;
    if (picks[0] === picks[1] && picks[1] === picks[2]) converged++;
    noFocusRounds++;
    if (picksNoFocus[0] === picksNoFocus[1] && picksNoFocus[1] === picksNoFocus[2]) noFocusConverged++;
  }
  const rate = converged / rounds;
  const rateNoFocus = noFocusConverged / noFocusRounds;
  check('集火表下 3 舰同目标命中率 > 70%', rate > 0.7, `rate=${(rate * 100).toFixed(1)}%`);
  check('无集火表对照组命中率显著更低（集火表真实起效）', rateNoFocus < rate - 0.1,
    `noFocus=${(rateNoFocus * 100).toFixed(1)}% vs focus=${(rate * 100).toFixed(1)}%`);
}

console.log('\n=== E. 源码契约（补充判据，行为判据以上方为准） ===');
{
  const src = fs.readFileSync(`${__dirname}/../frontend/src/game/scenes/BattleScene.ts`, 'utf8');
  check('开火选舰不再均匀随机（inRangeUnits[...Math.random]）',
    !/inRangeUnits\[\s*Math\.floor\(\s*Math\.random/.test(src));
  check('开火选舰已接 pickShip', /pickShip\(/.test(src));
  check('集火表已接 buildFocusTable', /buildFocusTable\(/.test(src));
  check('舰级受击台账已写 _lastAttackerUid', /_lastAttackerUid\s*=\s*shipUidOf\(u\)/.test(src));
  check('追击点已接 leadInterceptPoint（3 处调用）',
    (src.match(/leadInterceptPoint\(/g) || []).length >= 3);
}

console.log(`\n${passed} assertions: ${passed} passed / ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
